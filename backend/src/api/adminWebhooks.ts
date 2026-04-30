import { Router, Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { HttpError } from '../app';

// Operational endpoints for webhook delivery. Intentionally namespaced under
// /admin since in production they would sit behind separate authn (out of
// scope for this take-home, documented in README).
//
//   GET  /admin/webhooks/health                — counts + freshness signals
//   POST /admin/webhooks/:deliveryStateId/retry — requeue a DLQ row

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StatusCountRow {
  status: string;
  count: string;
}

interface FreshnessRow {
  oldest_pending_age_seconds: string | null;
  recent_total: string;
  recent_failures: string;
}

interface DeliveryStateRow {
  id: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  last_status_code: number | null;
  last_attempt_at: Date | null;
  next_retry_at: Date | null;
  delivered_at: Date | null;
  webhook_event_id: string;
  updated_at: Date;
}

const serializeState = (row: DeliveryStateRow): Record<string, unknown> => ({
  id: row.id,
  webhookEventId: row.webhook_event_id,
  status: row.status,
  attemptCount: row.attempt_count,
  lastError: row.last_error,
  lastStatusCode: row.last_status_code,
  lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
  nextRetryAt: row.next_retry_at?.toISOString() ?? null,
  deliveredAt: row.delivered_at?.toISOString() ?? null,
  updatedAt: row.updated_at.toISOString(),
});

export const adminWebhooksRouter = Router();

adminWebhooksRouter.get(
  '/admin/webhooks/health',
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const counts: Record<string, number> = { pending: 0, in_flight: 0, delivered: 0, dlq: 0 };
      const countRows = await db<StatusCountRow>('webhook_delivery_state')
        .select('status')
        .count<StatusCountRow[]>('* as count')
        .groupBy('status');
      for (const row of countRows) {
        if (row.status in counts) counts[row.status] = Number(row.count);
      }

      // Single query: oldest pending row's age + last-hour failure ratio.
      // recentFailureRate = rows with last_attempt_at in the last hour whose
      // last_status_code is null or outside 2xx, divided by total recent
      // rows. This is the closest we can get without per-attempt logs.
      const freshness = await db.raw<{ rows: FreshnessRow[] }>(
        `SELECT
           EXTRACT(EPOCH FROM (now() - MIN(created_at) FILTER (WHERE status = 'pending')))::numeric AS oldest_pending_age_seconds,
           COUNT(*) FILTER (WHERE last_attempt_at >= now() - INTERVAL '1 hour') AS recent_total,
           COUNT(*) FILTER (
             WHERE last_attempt_at >= now() - INTERVAL '1 hour'
               AND (last_status_code IS NULL OR last_status_code NOT BETWEEN 200 AND 299)
           ) AS recent_failures
         FROM webhook_delivery_state`,
      );
      const row = freshness.rows[0];
      const oldestPendingAgeSeconds =
        row && row.oldest_pending_age_seconds !== null
          ? Math.round(Number(row.oldest_pending_age_seconds))
          : null;
      const recentTotal = row ? Number(row.recent_total) : 0;
      const recentFailures = row ? Number(row.recent_failures) : 0;
      const recentFailureRate = recentTotal === 0 ? 0 : recentFailures / recentTotal;

      res.json({
        counts,
        oldestPendingAgeSeconds,
        recentFailureRate,
      });
    } catch (err) {
      next(err);
    }
  },
);

adminWebhooksRouter.post(
  '/admin/webhooks/:deliveryStateId/retry',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { deliveryStateId } = req.params;
      if (!UUID_RE.test(deliveryStateId)) {
        throw new HttpError(400, 'invalid_uuid', 'deliveryStateId must be a UUID');
      }

      const existing = await db<DeliveryStateRow>('webhook_delivery_state')
        .where({ id: deliveryStateId })
        .first('id', 'status');
      if (!existing) {
        throw new HttpError(404, 'delivery_state_not_found', `delivery state ${deliveryStateId} not found`);
      }
      if (existing.status !== 'dlq') {
        throw new HttpError(
          409,
          'not_dlq',
          'only DLQ entries can be manually retried',
        );
      }

      const [updated] = await db<DeliveryStateRow>('webhook_delivery_state')
        .where({ id: deliveryStateId })
        .update({
          status: 'pending',
          attempt_count: 0,
          next_retry_at: db.fn.now(),
          last_error: null,
          updated_at: db.fn.now(),
        })
        .returning<DeliveryStateRow[]>([
          'id',
          'webhook_event_id',
          'status',
          'attempt_count',
          'last_error',
          'last_status_code',
          'last_attempt_at',
          'next_retry_at',
          'delivered_at',
          'updated_at',
        ]);

      if (!updated) {
        throw new Error('update returned no row — should not happen');
      }
      res.json(serializeState(updated));
    } catch (err) {
      next(err);
    }
  },
);

import type { Knex } from 'knex';
import { db } from '../db';
import { computeEventId } from './eventId';
import { HttpError } from '../app';
import type { RiskTier } from '../scoring/types';

// Idempotent enqueue. Determinism comes from event_id = sha256(prop:res:run);
// the unique constraint on webhook_events.event_id absorbs duplicate triggers
// at the row level. The first writer also seeds a webhook_delivery_state row;
// the second writer just returns alreadyExists=true.

export interface EnqueueResult {
  eventId: string;
  alreadyExists: boolean;
}

interface ScoreRow {
  score: number;
  tier: RiskTier;
  days_to_expiry: number | null;
  signals: unknown;
}

const buildPayload = (
  eventId: string,
  propertyId: string,
  residentId: string,
  score: ScoreRow,
): Record<string, unknown> => ({
  event: 'renewal.risk_flagged',
  eventId,
  timestamp: new Date().toISOString(),
  propertyId,
  residentId,
  data: {
    riskScore: score.score,
    riskTier: score.tier,
    daysToExpiry: score.days_to_expiry,
    signals: score.signals,
  },
});

export const enqueueRenewalEvent = async (
  propertyId: string,
  residentId: string,
  runId: string,
): Promise<EnqueueResult> => {
  const score = await db<ScoreRow>('risk_scores')
    .where({ run_id: runId, resident_id: residentId })
    .first('score', 'tier', 'days_to_expiry', 'signals');
  if (!score) {
    throw new HttpError(
      404,
      'risk_score_not_found',
      `no risk score for resident ${residentId} in run ${runId}`,
    );
  }

  const eventId = computeEventId(propertyId, residentId, runId);
  const payload = buildPayload(eventId, propertyId, residentId, score);

  return db.transaction(async (trx: Knex.Transaction): Promise<EnqueueResult> => {
    const inserted = await trx('webhook_events')
      .insert({
        event_id: eventId,
        property_id: propertyId,
        resident_id: residentId,
        event_type: 'renewal_risk_flagged',
        payload: JSON.stringify(payload),
      })
      .onConflict('event_id')
      .ignore()
      .returning<{ id: string }[]>(['id']);

    if (inserted.length === 0) {
      // Another caller (or earlier call) already created this event.
      return { eventId, alreadyExists: true };
    }

    await trx('webhook_delivery_state').insert({
      webhook_event_id: inserted[0]!.id,
      status: 'pending',
      attempt_count: 0,
      next_retry_at: trx.fn.now(),
    });

    return { eventId, alreadyExists: false };
  });
};

import type { Knex } from 'knex';
import { db as defaultDb } from '../db';
import { computeNextRetryDelaySeconds } from './backoff';
import { attemptDelivery, type DeliveryOutcome, type DeliveryStateRow } from './deliver';

// In-process webhook worker. Polls webhook_delivery_state on a fixed interval,
// claims due rows with `FOR UPDATE SKIP LOCKED` so the same code is safe to
// run with N workers, and applies the deliver outcome to the state machine
// (pending → in_flight → delivered | back to pending with backoff | dlq).
//
// `deliver` is injectable so tests can drive specific outcomes without a
// network dependency, and so production can swap in a different transport
// without touching the worker.

export interface TickResult {
  claimed: number;
  processed: number;
}

export interface WebhookWorkerOptions {
  pollMs: number;
  maxClaimPerTick?: number;
  db?: Knex;
  deliver?: (state: DeliveryStateRow) => Promise<DeliveryOutcome>;
}

interface ClaimedRow {
  id: string;
  webhook_event_id: string;
  attempt_count: number;
  max_attempts: number;
}

export class WebhookWorker {
  private readonly db: Knex;
  private readonly pollMs: number;
  private readonly maxClaimPerTick: number;
  private readonly deliver: (state: DeliveryStateRow) => Promise<DeliveryOutcome>;
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopping = false;
  private currentTick: Promise<unknown> | null = null;

  constructor(opts: WebhookWorkerOptions) {
    this.db = opts.db ?? defaultDb;
    this.pollMs = opts.pollMs;
    this.maxClaimPerTick = opts.maxClaimPerTick ?? 10;
    this.deliver = opts.deliver ?? attemptDelivery;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runTickGuarded();
    }, this.pollMs);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.currentTick) {
      try {
        await this.currentTick;
      } catch {
        // tick errors are already logged; we just need to drain.
      }
    }
  }

  async tick(): Promise<TickResult> {
    const claimed = await this.claimDue();
    let processed = 0;

    for (const row of claimed) {
      const outcome = await this.deliver(row);
      processed++;
      await this.applyOutcome(row, outcome);
    }

    return { claimed: claimed.length, processed };
  }

  private async runTickGuarded(): Promise<void> {
    if (this.inFlight || this.stopping) return;
    this.inFlight = true;
    const p = this.tick().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`webhook_worker tick failed: ${msg}`);
    });
    this.currentTick = p;
    try {
      await p;
    } finally {
      this.inFlight = false;
      this.currentTick = null;
    }
  }

  private async claimDue(): Promise<ClaimedRow[]> {
    return this.db.transaction(async (trx) => {
      const result = await trx.raw<{ rows: ClaimedRow[] }>(
        `SELECT id, webhook_event_id, attempt_count, max_attempts
           FROM webhook_delivery_state
          WHERE status = 'pending' AND next_retry_at <= now()
          ORDER BY next_retry_at
          LIMIT ?
          FOR UPDATE SKIP LOCKED`,
        [this.maxClaimPerTick],
      );
      const rows = result.rows;
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      await trx('webhook_delivery_state')
        .whereIn('id', ids)
        .update({ status: 'in_flight', updated_at: trx.fn.now() });
      return rows;
    });
  }

  private async applyOutcome(row: ClaimedRow, outcome: DeliveryOutcome): Promise<void> {
    const newAttemptCount = row.attempt_count + 1;
    if (outcome.outcome === 'delivered') {
      await this.db('webhook_delivery_state')
        .where({ id: row.id })
        .update({
          status: 'delivered',
          attempt_count: newAttemptCount,
          delivered_at: this.db.fn.now(),
          last_attempt_at: this.db.fn.now(),
          last_status_code: outcome.statusCode,
          last_error: null,
          updated_at: this.db.fn.now(),
        });
      return;
    }

    if (newAttemptCount >= row.max_attempts) {
      await this.db('webhook_delivery_state')
        .where({ id: row.id })
        .update({
          status: 'dlq',
          attempt_count: newAttemptCount,
          last_attempt_at: this.db.fn.now(),
          last_error: outcome.errorMessage,
          last_status_code: outcome.statusCode,
          updated_at: this.db.fn.now(),
        });
      return;
    }

    const delaySeconds = computeNextRetryDelaySeconds(newAttemptCount);
    await this.db('webhook_delivery_state')
      .where({ id: row.id })
      .update({
        status: 'pending',
        attempt_count: newAttemptCount,
        next_retry_at: this.db.raw(`now() + (? || ' seconds')::interval`, [delaySeconds]),
        last_attempt_at: this.db.fn.now(),
        last_error: outcome.errorMessage,
        last_status_code: outcome.statusCode,
        updated_at: this.db.fn.now(),
      });
  }
}

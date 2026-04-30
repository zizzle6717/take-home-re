import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { WebhookWorker } from './worker';
import type { DeliveryOutcome } from './deliver';

// Integration tests for the webhook worker. Hits the real dev DB. Each test
// re-seeds a clean webhook_events + webhook_delivery_state pair with a stub
// `deliver` so we can drive specific outcomes (delivered, failed, DLQ) and
// observe state-machine transitions.

describe('WebhookWorker (integration)', () => {
  let propertyId: string;
  let residentId: string;

  const insertEvent = async (eventIdSuffix: string): Promise<{ eventDbId: string; deliveryStateId: string }> => {
    const [ev] = await db('webhook_events')
      .insert({
        event_id: `evt_${eventIdSuffix}`,
        property_id: propertyId,
        resident_id: residentId,
        event_type: 'renewal_risk_flagged',
        payload: JSON.stringify({ event: 'renewal.risk_flagged', eventId: `evt_${eventIdSuffix}` }),
      })
      .returning<{ id: string }[]>(['id']);
    const [ds] = await db('webhook_delivery_state')
      .insert({
        webhook_event_id: ev!.id,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 6,
        next_retry_at: db.fn.now(),
      })
      .returning<{ id: string }[]>(['id']);
    return { eventDbId: ev!.id, deliveryStateId: ds!.id };
  };

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE webhook_delivery_state, webhook_events, risk_scores, risk_calculation_runs, renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();
    const prop = await db('properties').first<{ id: string }>('id');
    if (!prop) throw new Error('seed produced no property');
    propertyId = prop.id;
    const res = await db('residents').first<{ id: string }>('id');
    if (!res) throw new Error('seed produced no resident');
    residentId = res.id;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE TABLE webhook_delivery_state, webhook_events RESTART IDENTITY CASCADE');
  });

  it('delivers a pending row and moves it to delivered with attempt_count=1', async () => {
    const { deliveryStateId } = await insertEvent('success');
    const worker = new WebhookWorker({
      pollMs: 50,
      maxClaimPerTick: 10,
      deliver: async (): Promise<DeliveryOutcome> => ({ outcome: 'delivered', statusCode: 200 }),
    });

    const result = await worker.tick();
    expect(result.claimed).toBe(1);
    expect(result.processed).toBe(1);

    const row = await db('webhook_delivery_state')
      .where({ id: deliveryStateId })
      .first<{ status: string; attempt_count: number; delivered_at: Date | null; last_status_code: number | null }>();
    expect(row?.status).toBe('delivered');
    expect(row?.attempt_count).toBe(1);
    expect(row?.delivered_at).not.toBeNull();
    expect(row?.last_status_code).toBe(200);
  });

  it('on failure, increments attempt_count, sets next_retry_at via backoff, keeps status pending', async () => {
    const { deliveryStateId } = await insertEvent('fail-once');
    const worker = new WebhookWorker({
      pollMs: 50,
      maxClaimPerTick: 10,
      deliver: async (): Promise<DeliveryOutcome> => ({ outcome: 'failed', statusCode: 503, errorMessage: 'boom' }),
    });

    const before = Date.now();
    await worker.tick();
    const after = Date.now();

    const row = await db('webhook_delivery_state')
      .where({ id: deliveryStateId })
      .first<{ status: string; attempt_count: number; next_retry_at: Date | null; last_error: string | null; last_status_code: number | null }>();
    expect(row?.status).toBe('pending');
    expect(row?.attempt_count).toBe(1);
    expect(row?.last_error).toBe('boom');
    expect(row?.last_status_code).toBe(503);
    // Delay for attempt_count=1 is 1s; allow ±1.5s for clock + DB roundtrip.
    expect(row?.next_retry_at).not.toBeNull();
    const nextMs = row!.next_retry_at!.getTime();
    expect(nextMs).toBeGreaterThanOrEqual(before + 500);
    expect(nextMs).toBeLessThanOrEqual(after + 2_500);
  });

  it('after max_attempts failures, the row moves to dlq', async () => {
    const { deliveryStateId } = await insertEvent('dlq');
    const worker = new WebhookWorker({
      pollMs: 50,
      maxClaimPerTick: 10,
      deliver: async (): Promise<DeliveryOutcome> => ({ outcome: 'failed', statusCode: 500, errorMessage: 'bad' }),
    });

    for (let i = 0; i < 6; i++) {
      // Force the row to be due immediately each iteration so tick() can claim it.
      await db('webhook_delivery_state').where({ id: deliveryStateId }).update({ next_retry_at: db.fn.now() });
      await worker.tick();
    }

    const row = await db('webhook_delivery_state')
      .where({ id: deliveryStateId })
      .first<{ status: string; attempt_count: number }>();
    expect(row?.status).toBe('dlq');
    expect(row?.attempt_count).toBe(6);
  });

  it('FOR UPDATE SKIP LOCKED: a held lock on one row makes tick claim only the other', async () => {
    const a = await insertEvent('skip-a');
    const b = await insertEvent('skip-b');

    // Hold a row-level lock on row A in a separate transaction; do not commit.
    const holdTrx = await db.transaction();
    await holdTrx.raw('SELECT id FROM webhook_delivery_state WHERE id = ? FOR UPDATE', [a.deliveryStateId]);

    const claimedIds: string[] = [];
    const worker = new WebhookWorker({
      pollMs: 50,
      maxClaimPerTick: 10,
      deliver: async (state): Promise<DeliveryOutcome> => {
        claimedIds.push(state.id);
        return { outcome: 'delivered', statusCode: 200 };
      },
    });

    const result = await worker.tick();
    await holdTrx.rollback();

    expect(result.claimed).toBe(1);
    expect(claimedIds).toEqual([b.deliveryStateId]);

    const aRow = await db('webhook_delivery_state').where({ id: a.deliveryStateId }).first<{ status: string }>();
    expect(aRow?.status).toBe('pending');
    const bRow = await db('webhook_delivery_state').where({ id: b.deliveryStateId }).first<{ status: string }>();
    expect(bRow?.status).toBe('delivered');
  });
});

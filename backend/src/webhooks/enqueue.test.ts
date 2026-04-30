import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../db';
import { enqueueRenewalEvent } from './enqueue';
import { calculateScore } from '../scoring/calculateScore';
import { loadSignals } from '../scoring/loadSignals';

// Integration test: hits the dev DB. Seeds, runs a real risk calculation to
// populate risk_scores, then exercises enqueue against a flagged resident.

describe('enqueueRenewalEvent (integration)', () => {
  let propertyId: string;
  let residentId: string;
  let runId: string;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE webhook_delivery_state, webhook_events, risk_scores, risk_calculation_runs, renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();

    const prop = await db('properties').first<{ id: string }>('id');
    if (!prop) throw new Error('seed produced no property');
    propertyId = prop.id;

    // Stand up a real run so we have a runId + risk_scores rows to read.
    const asOfDate = new Date().toISOString().slice(0, 10);
    const signals = await loadSignals(propertyId, asOfDate);
    const totalResidents = signals.length;
    const computed = signals.map((s) => ({ s, ...calculateScore(s) }));
    const flaggedCount = computed.filter((c) => c.tier !== 'low').length;

    const [run] = await db('risk_calculation_runs')
      .insert({ property_id: propertyId, as_of_date: asOfDate, total_residents: totalResidents, flagged_count: flaggedCount })
      .returning<{ id: string }[]>(['id']);
    runId = run!.id;

    await db('risk_scores').insert(
      computed.map((c) => ({
        run_id: runId,
        resident_id: c.s.residentId,
        score: c.score,
        tier: c.tier,
        days_to_expiry: c.s.daysToExpiry,
        signals: JSON.stringify({
          daysToExpiryDays: c.s.daysToExpiry,
          paymentHistoryDelinquent: c.s.isDelinquent,
          noRenewalOfferYet: !c.s.hasPendingOffer,
          rentGrowthAboveMarket: c.s.marketRent !== null && c.s.marketRent > c.s.monthlyRent,
        }),
      })),
    );

    const flagged = computed.find((c) => c.tier !== 'low');
    if (!flagged) throw new Error('expected at least one flagged resident in seed');
    residentId = flagged.s.residentId;
  });

  afterAll(async () => {
    await db.destroy();
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE TABLE webhook_delivery_state, webhook_events RESTART IDENTITY CASCADE');
  });

  it('first call inserts one webhook_event + one delivery_state row and reports not-already-exists', async () => {
    const result = await enqueueRenewalEvent(propertyId, residentId, runId);

    expect(result.alreadyExists).toBe(false);
    expect(result.eventId).toMatch(/^evt_[0-9a-f]+$/);

    const [{ count: evCount }] = await db('webhook_events').count<{ count: string }[]>('* as count');
    expect(Number(evCount)).toBe(1);

    const [{ count: dsCount }] = await db('webhook_delivery_state').count<{ count: string }[]>('* as count');
    expect(Number(dsCount)).toBe(1);

    const ev = await db('webhook_events').first<{
      event_id: string;
      property_id: string;
      resident_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>();
    expect(ev?.event_id).toBe(result.eventId);
    expect(ev?.property_id).toBe(propertyId);
    expect(ev?.resident_id).toBe(residentId);
    expect(ev?.event_type).toBe('renewal_risk_flagged');
    expect(ev?.payload).toMatchObject({
      event: 'renewal_risk_flagged',
      eventId: result.eventId,
      propertyId,
      residentId,
      data: expect.objectContaining({
        riskScore: expect.any(Number),
        riskTier: expect.any(String),
        signals: expect.any(Object),
      }),
    });

    const ds = await db('webhook_delivery_state').first<{
      status: string;
      attempt_count: number;
      max_attempts: number;
      next_retry_at: Date | null;
    }>();
    expect(ds?.status).toBe('pending');
    expect(ds?.attempt_count).toBe(0);
    expect(ds?.next_retry_at).not.toBeNull();
  });

  it('second call with same inputs is idempotent and inserts no new rows', async () => {
    const first = await enqueueRenewalEvent(propertyId, residentId, runId);
    const second = await enqueueRenewalEvent(propertyId, residentId, runId);

    expect(second.eventId).toBe(first.eventId);
    expect(second.alreadyExists).toBe(true);

    const [{ count: evCount }] = await db('webhook_events').count<{ count: string }[]>('* as count');
    expect(Number(evCount)).toBe(1);

    const [{ count: dsCount }] = await db('webhook_delivery_state').count<{ count: string }[]>('* as count');
    expect(Number(dsCount)).toBe(1);
  });

  it('throws when the resident has no risk score in the given run', async () => {
    const unknownResident = '00000000-0000-0000-0000-000000000000';
    await expect(enqueueRenewalEvent(propertyId, unknownResident, runId)).rejects.toThrow();
  });
});

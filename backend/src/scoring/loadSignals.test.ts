import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../db';
import { loadSignals } from './loadSignals';

// Integration test against the dev Postgres. Seeds Park Meadows from
// 01_park_meadows.ts in beforeAll; truncates first to stay idempotent
// across reruns. Same pattern as src/db/seed.test.ts.

describe('loadSignals (integration)', () => {
  let propertyId: string;
  let asOfDate: string;

  beforeAll(async () => {
    await db.migrate.latest();
    await db.raw(
      'TRUNCATE TABLE renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();
    const prop = await db('properties').first<{ id: string }>('id');
    if (!prop) throw new Error('seed produced no property');
    propertyId = prop.id;
    asOfDate = new Date().toISOString().slice(0, 10);
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('returns one row per active lease (4 seed residents)', async () => {
    const rows = await loadSignals(propertyId, asOfDate);
    expect(rows).toHaveLength(4);
  });

  it('Jane: 45 days to expiry, no pending offer, 6 payments', async () => {
    const rows = await loadSignals(propertyId, asOfDate);
    const jane = rows.find((r) => r.firstName === 'Jane');
    expect(jane).toBeTruthy();
    expect(jane!.daysToExpiry).toBe(45);
    expect(jane!.hasPendingOffer).toBe(false);
    expect(jane!.paymentCount).toBe(6);
    expect(jane!.isDelinquent).toBe(false);
    expect(jane!.monthlyRent).toBe(1400);
    expect(jane!.marketRent).toBe(1600);
  });

  it('John: 60 days, no offer, 5 payments → delinquent', async () => {
    const rows = await loadSignals(propertyId, asOfDate);
    const john = rows.find((r) => r.lastName === 'Smith');
    expect(john).toBeTruthy();
    expect(john!.daysToExpiry).toBe(60);
    expect(john!.hasPendingOffer).toBe(false);
    expect(john!.paymentCount).toBe(5);
    expect(john!.isDelinquent).toBe(true);
  });

  it('Alice: 180 days, has pending offer, 6 payments', async () => {
    const rows = await loadSignals(propertyId, asOfDate);
    const alice = rows.find((r) => r.firstName === 'Alice');
    expect(alice).toBeTruthy();
    expect(alice!.daysToExpiry).toBe(180);
    expect(alice!.hasPendingOffer).toBe(true);
    expect(alice!.paymentCount).toBe(6);
    expect(alice!.isDelinquent).toBe(false);
  });

  it('Bob: month-to-month treated as 30 days, no offer', async () => {
    const rows = await loadSignals(propertyId, asOfDate);
    const bob = rows.find((r) => r.firstName === 'Bob');
    expect(bob).toBeTruthy();
    expect(bob!.leaseType).toBe('month_to_month');
    expect(bob!.daysToExpiry).toBe(30);
    expect(bob!.hasPendingOffer).toBe(false);
  });

  it('returns no rows for an unknown property', async () => {
    const rows = await loadSignals('00000000-0000-0000-0000-000000000000', asOfDate);
    expect(rows).toHaveLength(0);
  });
});

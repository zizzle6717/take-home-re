import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from './index';

describe('seed: park meadows', () => {
  beforeAll(async () => {
    await db.migrate.latest();
    // Truncate all seed-affected tables for idempotent test runs. CASCADE handles FKs.
    await db.raw(
      'TRUNCATE TABLE renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );
    await db.seed.run();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates 4 residents', async () => {
    const [{ count }] = await db('residents').count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(4);
  });

  it('creates exactly 1 month-to-month lease', async () => {
    const [{ count }] = await db('leases')
      .where({ lease_type: 'month_to_month' })
      .count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(1);
  });

  it('creates 5 ledger rows for John Smith (one missed payment)', async () => {
    const smith = await db('residents').where({ last_name: 'Smith' }).first<{ id: string }>('id');
    expect(smith).toBeTruthy();
    const [{ count }] = await db('resident_ledger')
      .where({ resident_id: smith!.id })
      .count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(5);
  });

  it('creates 1 renewal offer for Alice', async () => {
    const [{ count }] = await db('renewal_offers').count<{ count: string }[]>('* as count');
    expect(Number(count)).toBe(1);

    const alice = await db('residents').where({ first_name: 'Alice' }).first<{ id: string }>('id');
    const offer = await db('renewal_offers').where({ resident_id: alice!.id }).first();
    expect(offer).toBeTruthy();
  });

  it('creates 1 property with 20 units', async () => {
    const [{ count: pCount }] = await db('properties').count<{ count: string }[]>('* as count');
    expect(Number(pCount)).toBe(1);
    const [{ count: uCount }] = await db('units').count<{ count: string }[]>('* as count');
    expect(Number(uCount)).toBe(20);
  });
});

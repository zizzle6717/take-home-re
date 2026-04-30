import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from './index';

const EXPECTED_TABLES = [
  'properties',
  'unit_types',
  'units',
  'unit_pricing',
  'residents',
  'leases',
  'resident_ledger',
  'renewal_offers',
  'risk_calculation_runs',
  'risk_scores',
  'webhook_events',
  'webhook_delivery_state',
];

describe('migrations', () => {
  beforeAll(async () => {
    await db.migrate.latest();
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('creates all expected tables', async () => {
    const rows = await db<{ table_name: string }>('information_schema.tables')
      .select('table_name')
      .where({ table_schema: 'public' });
    const names = rows.map((r) => r.table_name);
    for (const t of EXPECTED_TABLES) {
      expect(names, `missing table: ${t}`).toContain(t);
    }
  });

  it('creates partial index on webhook_delivery_state(next_retry_at) WHERE status = pending', async () => {
    const rows = await db<{ indexname: string; indexdef: string }>('pg_indexes')
      .select('indexname', 'indexdef')
      .where({ tablename: 'webhook_delivery_state' });
    const partial = rows.find(
      (r) => r.indexdef.includes('next_retry_at') && r.indexdef.toLowerCase().includes("status = 'pending'"),
    );
    expect(partial, `expected partial index found in: ${JSON.stringify(rows)}`).toBeTruthy();
  });

  it('creates partial index on leases(property_id, lease_end_date) WHERE status = active', async () => {
    const rows = await db<{ indexname: string; indexdef: string }>('pg_indexes')
      .select('indexname', 'indexdef')
      .where({ tablename: 'leases' });
    const partial = rows.find(
      (r) => r.indexdef.includes('lease_end_date') && r.indexdef.toLowerCase().includes("status = 'active'"),
    );
    expect(partial, `expected partial index found in: ${JSON.stringify(rows)}`).toBeTruthy();
  });
});

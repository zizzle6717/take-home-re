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

const STARTER_INDEXES: Array<[string, string]> = [
  ['idx_properties_status', 'properties'],
  ['idx_units_property_id', 'units'],
  ['idx_units_status', 'units'],
  ['idx_unit_pricing_unit_id', 'unit_pricing'],
  ['idx_unit_pricing_effective_date', 'unit_pricing'],
  ['idx_residents_property_id', 'residents'],
  ['idx_residents_unit_id', 'residents'],
  ['idx_residents_status', 'residents'],
  ['idx_leases_property_id', 'leases'],
  ['idx_leases_resident_id', 'leases'],
  ['idx_leases_lease_end_date', 'leases'],
  ['idx_leases_status', 'leases'],
  ['idx_resident_ledger_property_id', 'resident_ledger'],
  ['idx_resident_ledger_resident_id', 'resident_ledger'],
  ['idx_resident_ledger_transaction_date', 'resident_ledger'],
  ['idx_resident_ledger_transaction_type', 'resident_ledger'],
  ['idx_renewal_offers_property_id', 'renewal_offers'],
  ['idx_renewal_offers_resident_id', 'renewal_offers'],
  ['idx_renewal_offers_status', 'renewal_offers'],
];

const STARTER_UNIQUE_CONSTRAINTS: Array<[string, string]> = [
  ['properties_name_unique', 'properties'],
  ['unit_types_property_id_name_unique', 'unit_types'],
  ['unit_pricing_unit_id_effective_date_unique', 'unit_pricing'],
];

const STARTER_STATUS_DEFAULTS: Array<{ table: string; column: string; expected: string }> = [
  { table: 'properties', column: 'status', expected: 'active' },
  { table: 'units', column: 'status', expected: 'available' },
  { table: 'residents', column: 'status', expected: 'active' },
  { table: 'leases', column: 'status', expected: 'active' },
  { table: 'leases', column: 'lease_type', expected: 'fixed' },
  { table: 'renewal_offers', column: 'status', expected: 'pending' },
];

const STARTER_ADDED_COLUMNS: Array<{ table: string; column: string }> = [
  { table: 'properties', column: 'updated_at' },
  { table: 'units', column: 'updated_at' },
  { table: 'residents', column: 'phone' },
  { table: 'residents', column: 'move_in_date' },
  { table: 'residents', column: 'move_out_date' },
  { table: 'residents', column: 'created_at' },
  { table: 'residents', column: 'updated_at' },
  { table: 'leases', column: 'created_at' },
  { table: 'leases', column: 'updated_at' },
  { table: 'renewal_offers', column: 'offer_expiration_date' },
  { table: 'renewal_offers', column: 'updated_at' },
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

  it('creates all starter_schema idx_* indexes', async () => {
    const rows = await db<{ indexname: string; tablename: string }>('pg_indexes')
      .select('indexname', 'tablename')
      .where({ schemaname: 'public' });
    const present = new Map(rows.map((r) => [r.indexname, r.tablename]));
    for (const [name, table] of STARTER_INDEXES) {
      expect(present.get(name), `missing index ${name} on ${table}`).toBe(table);
    }
  });

  it('adds starter_schema columns from migration 005', async () => {
    const rows = await db<{ table_name: string; column_name: string }>('information_schema.columns')
      .select('table_name', 'column_name')
      .where({ table_schema: 'public' });
    const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const { table, column } of STARTER_ADDED_COLUMNS) {
      expect(present.has(`${table}.${column}`), `missing column ${table}.${column}`).toBe(true);
    }
  });

  it('sets starter_schema status defaults', async () => {
    const rows = await db<{ table_name: string; column_name: string; column_default: string | null }>(
      'information_schema.columns',
    )
      .select('table_name', 'column_name', 'column_default')
      .where({ table_schema: 'public' });
    const byKey = new Map(
      rows.map((r) => [`${r.table_name}.${r.column_name}`, r.column_default ?? '']),
    );
    for (const { table, column, expected } of STARTER_STATUS_DEFAULTS) {
      const def = byKey.get(`${table}.${column}`) ?? '';
      // information_schema reports defaults as e.g. "'active'::text"
      expect(def, `default for ${table}.${column} was ${def}`).toContain(`'${expected}'`);
    }
  });

  it('adds starter_schema unique constraints', async () => {
    const rows = await db<{ conname: string; tablename: string }>('pg_constraint as c')
      .join('pg_class as t', 'c.conrelid', 't.oid')
      .select('c.conname as conname', 't.relname as tablename')
      .where({ contype: 'u' });
    const present = new Map(rows.map((r) => [r.conname, r.tablename]));
    for (const [name, table] of STARTER_UNIQUE_CONSTRAINTS) {
      expect(present.get(name), `missing unique constraint ${name} on ${table}`).toBe(table);
    }
  });
});

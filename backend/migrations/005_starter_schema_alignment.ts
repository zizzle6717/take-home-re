import type { Knex } from 'knex';

// Aligns the 8 core ROP tables with starter_schema.sql. Phase 1's 001 migration
// predates close reading of the provided DDL; this is a forward-only fixup
// rather than an in-place edit of 001 (which is already committed and seeded
// against). Only the "provided" half of the starter schema is touched here.

export async function up(knex: Knex): Promise<void> {
  // --- Columns ---
  await knex.schema.alterTable('properties', (t) => {
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('units', (t) => {
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('residents', (t) => {
    t.text('phone');
    t.date('move_in_date');
    t.date('move_out_date');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('leases', (t) => {
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.alterTable('renewal_offers', (t) => {
    t.date('offer_expiration_date');
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  // --- Status defaults on existing columns ---
  await knex.raw("ALTER TABLE properties ALTER COLUMN status SET DEFAULT 'active'");
  await knex.raw("ALTER TABLE units ALTER COLUMN status SET DEFAULT 'available'");
  await knex.raw("ALTER TABLE residents ALTER COLUMN status SET DEFAULT 'active'");
  await knex.raw("ALTER TABLE leases ALTER COLUMN status SET DEFAULT 'active'");
  await knex.raw("ALTER TABLE leases ALTER COLUMN lease_type SET DEFAULT 'fixed'");
  await knex.raw("ALTER TABLE renewal_offers ALTER COLUMN status SET DEFAULT 'pending'");

  // --- Unique constraints (named so down() can drop deterministically) ---
  await knex.raw('ALTER TABLE properties ADD CONSTRAINT properties_name_unique UNIQUE (name)');
  await knex.raw(
    'ALTER TABLE unit_types ADD CONSTRAINT unit_types_property_id_name_unique UNIQUE (property_id, name)',
  );
  await knex.raw(
    'ALTER TABLE unit_pricing ADD CONSTRAINT unit_pricing_unit_id_effective_date_unique UNIQUE (unit_id, effective_date)',
  );

  // --- Starter schema indexes (idx_* names match starter_schema.sql verbatim) ---
  await knex.raw('CREATE INDEX idx_properties_status ON properties(status)');
  await knex.raw('CREATE INDEX idx_units_property_id ON units(property_id)');
  await knex.raw('CREATE INDEX idx_units_status ON units(status)');
  await knex.raw('CREATE INDEX idx_unit_pricing_unit_id ON unit_pricing(unit_id)');
  await knex.raw('CREATE INDEX idx_unit_pricing_effective_date ON unit_pricing(effective_date)');
  await knex.raw('CREATE INDEX idx_residents_property_id ON residents(property_id)');
  await knex.raw('CREATE INDEX idx_residents_unit_id ON residents(unit_id)');
  await knex.raw('CREATE INDEX idx_residents_status ON residents(status)');
  await knex.raw('CREATE INDEX idx_leases_property_id ON leases(property_id)');
  await knex.raw('CREATE INDEX idx_leases_resident_id ON leases(resident_id)');
  await knex.raw('CREATE INDEX idx_leases_lease_end_date ON leases(lease_end_date)');
  await knex.raw('CREATE INDEX idx_leases_status ON leases(status)');
  await knex.raw('CREATE INDEX idx_resident_ledger_property_id ON resident_ledger(property_id)');
  await knex.raw('CREATE INDEX idx_resident_ledger_resident_id ON resident_ledger(resident_id)');
  await knex.raw(
    'CREATE INDEX idx_resident_ledger_transaction_date ON resident_ledger(transaction_date)',
  );
  await knex.raw(
    'CREATE INDEX idx_resident_ledger_transaction_type ON resident_ledger(transaction_type)',
  );
  await knex.raw('CREATE INDEX idx_renewal_offers_property_id ON renewal_offers(property_id)');
  await knex.raw('CREATE INDEX idx_renewal_offers_resident_id ON renewal_offers(resident_id)');
  await knex.raw('CREATE INDEX idx_renewal_offers_status ON renewal_offers(status)');
}

export async function down(knex: Knex): Promise<void> {
  // Indexes
  await knex.raw('DROP INDEX IF EXISTS idx_renewal_offers_status');
  await knex.raw('DROP INDEX IF EXISTS idx_renewal_offers_resident_id');
  await knex.raw('DROP INDEX IF EXISTS idx_renewal_offers_property_id');
  await knex.raw('DROP INDEX IF EXISTS idx_resident_ledger_transaction_type');
  await knex.raw('DROP INDEX IF EXISTS idx_resident_ledger_transaction_date');
  await knex.raw('DROP INDEX IF EXISTS idx_resident_ledger_resident_id');
  await knex.raw('DROP INDEX IF EXISTS idx_resident_ledger_property_id');
  await knex.raw('DROP INDEX IF EXISTS idx_leases_status');
  await knex.raw('DROP INDEX IF EXISTS idx_leases_lease_end_date');
  await knex.raw('DROP INDEX IF EXISTS idx_leases_resident_id');
  await knex.raw('DROP INDEX IF EXISTS idx_leases_property_id');
  await knex.raw('DROP INDEX IF EXISTS idx_residents_status');
  await knex.raw('DROP INDEX IF EXISTS idx_residents_unit_id');
  await knex.raw('DROP INDEX IF EXISTS idx_residents_property_id');
  await knex.raw('DROP INDEX IF EXISTS idx_unit_pricing_effective_date');
  await knex.raw('DROP INDEX IF EXISTS idx_unit_pricing_unit_id');
  await knex.raw('DROP INDEX IF EXISTS idx_units_status');
  await knex.raw('DROP INDEX IF EXISTS idx_units_property_id');
  await knex.raw('DROP INDEX IF EXISTS idx_properties_status');

  // Unique constraints
  await knex.raw(
    'ALTER TABLE unit_pricing DROP CONSTRAINT IF EXISTS unit_pricing_unit_id_effective_date_unique',
  );
  await knex.raw(
    'ALTER TABLE unit_types DROP CONSTRAINT IF EXISTS unit_types_property_id_name_unique',
  );
  await knex.raw('ALTER TABLE properties DROP CONSTRAINT IF EXISTS properties_name_unique');

  // Status defaults
  await knex.raw('ALTER TABLE renewal_offers ALTER COLUMN status DROP DEFAULT');
  await knex.raw('ALTER TABLE leases ALTER COLUMN lease_type DROP DEFAULT');
  await knex.raw('ALTER TABLE leases ALTER COLUMN status DROP DEFAULT');
  await knex.raw('ALTER TABLE residents ALTER COLUMN status DROP DEFAULT');
  await knex.raw('ALTER TABLE units ALTER COLUMN status DROP DEFAULT');
  await knex.raw('ALTER TABLE properties ALTER COLUMN status DROP DEFAULT');

  // Columns
  await knex.schema.alterTable('renewal_offers', (t) => {
    t.dropColumn('updated_at');
    t.dropColumn('offer_expiration_date');
  });
  await knex.schema.alterTable('leases', (t) => {
    t.dropColumn('updated_at');
    t.dropColumn('created_at');
  });
  await knex.schema.alterTable('residents', (t) => {
    t.dropColumn('updated_at');
    t.dropColumn('created_at');
    t.dropColumn('move_out_date');
    t.dropColumn('move_in_date');
    t.dropColumn('phone');
  });
  await knex.schema.alterTable('units', (t) => {
    t.dropColumn('updated_at');
  });
  await knex.schema.alterTable('properties', (t) => {
    t.dropColumn('updated_at');
  });
}

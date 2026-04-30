import type { Knex } from 'knex';

// Park Meadows seed: 1 property, 20 units, 4 residents covering the four
// scoring scenarios from seed_and_testing.md (Jane high, John medium, Alice
// low, Bob month-to-month). All values are anchored to CURRENT_DATE so the
// scoring math hits the documented scenarios when run against any as-of date
// near the seed time.
export async function seed(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // Wipe seed-managed tables. CASCADE drops dependent rows.
    await trx.raw(
      'TRUNCATE TABLE renewal_offers, resident_ledger, leases, residents, unit_pricing, units, unit_types, properties RESTART IDENTITY CASCADE',
    );

    await trx.raw(`
      WITH property_data AS (
        INSERT INTO properties (name, address, city, state, zip_code, status)
        VALUES ('Park Meadows Apartments', '123 Main St', 'Denver', 'CO', '80206', 'active')
        RETURNING id
      ),
      unit_type_data AS (
        INSERT INTO unit_types (property_id, name, bedrooms, bathrooms, square_footage)
        SELECT id, '1BR/1BA', 1, 1, 700
        FROM property_data
        RETURNING id, property_id
      ),
      units_data AS (
        INSERT INTO units (property_id, unit_type_id, unit_number, floor, status)
        SELECT
          ut.property_id,
          ut.id,
          (100 + gs.n)::text,
          (gs.n / 10) + 1,
          'occupied'
        FROM unit_type_data ut
        CROSS JOIN generate_series(1, 20) AS gs(n)
        RETURNING id, property_id, unit_type_id, unit_number
      ),
      unit_pricing_data AS (
        INSERT INTO unit_pricing (unit_id, base_rent, market_rent, effective_date)
        SELECT id, 1600, 1600, CURRENT_DATE
        FROM units_data
        RETURNING unit_id
      ),
      -- Scenario 1: HIGH risk — 45 days to expiry, no renewal offer, $1400 rent vs $1600 market.
      resident_1 AS (
        INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status)
        SELECT property_id, id, 'Jane', 'Doe', 'jane.doe@example.com', 'active'
        FROM units_data WHERE unit_number = '101'
        RETURNING id, property_id, unit_id
      ),
      lease_1 AS (
        INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
        SELECT property_id, id, unit_id, '2023-01-15', (CURRENT_DATE + INTERVAL '45 days')::date, 1400, 'fixed', 'active'
        FROM resident_1
        RETURNING id, property_id, resident_id
      ),
      payments_1 AS (
        INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
        SELECT
          r.property_id,
          r.id,
          'payment',
          'rent',
          1400,
          (CURRENT_DATE - INTERVAL '1 month' * (6 - gs.n))::date
        FROM resident_1 r
        CROSS JOIN generate_series(0, 5) AS gs(n)
        RETURNING id
      ),
      -- Scenario 2: MEDIUM risk — 60 days, missed one payment (5 ledger rows).
      resident_2 AS (
        INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status)
        SELECT property_id, id, 'John', 'Smith', 'john.smith@example.com', 'active'
        FROM units_data WHERE unit_number = '102'
        RETURNING id, property_id, unit_id
      ),
      lease_2 AS (
        INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
        SELECT property_id, id, unit_id, '2023-01-15', (CURRENT_DATE + INTERVAL '60 days')::date, 1500, 'fixed', 'active'
        FROM resident_2
        RETURNING id, property_id, resident_id
      ),
      payments_2 AS (
        INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
        SELECT
          r.property_id,
          r.id,
          'payment',
          'rent',
          1500,
          (CURRENT_DATE - INTERVAL '1 month' * (6 - gs.n))::date
        FROM resident_2 r
        CROSS JOIN generate_series(0, 4) AS gs(n)
        RETURNING id
      ),
      -- Scenario 3: LOW risk — 180 days, renewal offer pending, paying on time.
      resident_3 AS (
        INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status)
        SELECT property_id, id, 'Alice', 'Johnson', 'alice.johnson@example.com', 'active'
        FROM units_data WHERE unit_number = '103'
        RETURNING id, property_id, unit_id
      ),
      lease_3 AS (
        INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
        SELECT property_id, id, unit_id, '2023-06-15', (CURRENT_DATE + INTERVAL '180 days')::date, 1600, 'fixed', 'active'
        FROM resident_3
        RETURNING id, property_id, resident_id, unit_id
      ),
      payments_3 AS (
        INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
        SELECT
          r.property_id,
          r.id,
          'payment',
          'rent',
          1600,
          (CURRENT_DATE - INTERVAL '1 month' * (6 - gs.n))::date
        FROM resident_3 r
        CROSS JOIN generate_series(0, 5) AS gs(n)
        RETURNING id
      ),
      renewal_3 AS (
        INSERT INTO renewal_offers (property_id, resident_id, lease_id, renewal_start_date, renewal_end_date, proposed_rent, status)
        SELECT
          l.property_id,
          l.resident_id,
          l.id,
          (CURRENT_DATE + INTERVAL '180 days')::date,
          (CURRENT_DATE + INTERVAL '545 days')::date,
          1650,
          'pending'
        FROM lease_3 l
        RETURNING id
      ),
      -- Scenario 4: Month-to-month, paying on time, $1450 vs $1600 market.
      resident_4 AS (
        INSERT INTO residents (property_id, unit_id, first_name, last_name, email, status)
        SELECT property_id, id, 'Bob', 'Williams', 'bob.williams@example.com', 'active'
        FROM units_data WHERE unit_number = '104'
        RETURNING id, property_id, unit_id
      ),
      lease_4 AS (
        INSERT INTO leases (property_id, resident_id, unit_id, lease_start_date, lease_end_date, monthly_rent, lease_type, status)
        SELECT property_id, id, unit_id, '2024-12-01', '2025-01-01', 1450, 'month_to_month', 'active'
        FROM resident_4
        RETURNING id
      )
      INSERT INTO resident_ledger (property_id, resident_id, transaction_type, charge_code, amount, transaction_date)
      SELECT
        r.property_id,
        r.id,
        'payment',
        'rent',
        1450,
        (CURRENT_DATE - INTERVAL '1 month' * (6 - gs.n))::date
      FROM resident_4 r
      CROSS JOIN generate_series(0, 5) AS gs(n)
    `);
  });
}

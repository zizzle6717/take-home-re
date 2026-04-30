import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await knex.schema.createTable('properties', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('name').notNullable();
    t.text('address');
    t.text('city');
    t.text('state');
    t.text('zip_code');
    t.text('status').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('unit_types', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.text('name');
    t.integer('bedrooms');
    t.decimal('bathrooms');
    t.integer('square_footage');
  });

  await knex.schema.createTable('units', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('unit_type_id').references('id').inTable('unit_types');
    t.text('unit_number').notNullable();
    t.integer('floor');
    t.text('status').notNullable();
    t.unique(['property_id', 'unit_number']);
  });

  await knex.schema.createTable('unit_pricing', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('unit_id').notNullable().references('id').inTable('units').onDelete('CASCADE');
    t.decimal('base_rent').notNullable();
    t.decimal('market_rent').notNullable();
    t.date('effective_date').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('residents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('unit_id').references('id').inTable('units');
    t.text('first_name');
    t.text('last_name');
    t.text('email');
    t.text('status').notNullable();
  });

  await knex.schema.createTable('leases', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('resident_id').notNullable().references('id').inTable('residents').onDelete('CASCADE');
    t.uuid('unit_id').notNullable().references('id').inTable('units');
    t.date('lease_start_date').notNullable();
    t.date('lease_end_date').notNullable();
    t.decimal('monthly_rent').notNullable();
    t.text('lease_type').notNullable();
    t.text('status').notNullable();
  });

  await knex.schema.createTable('resident_ledger', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('resident_id').notNullable().references('id').inTable('residents').onDelete('CASCADE');
    t.text('transaction_type').notNullable();
    t.text('charge_code');
    t.decimal('amount').notNullable();
    t.date('transaction_date').notNullable();
  });

  await knex.schema.createTable('renewal_offers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('resident_id').notNullable().references('id').inTable('residents').onDelete('CASCADE');
    t.uuid('lease_id').notNullable().references('id').inTable('leases').onDelete('CASCADE');
    t.date('renewal_start_date');
    t.date('renewal_end_date');
    t.decimal('proposed_rent');
    t.text('status').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('renewal_offers');
  await knex.schema.dropTableIfExists('resident_ledger');
  await knex.schema.dropTableIfExists('leases');
  await knex.schema.dropTableIfExists('residents');
  await knex.schema.dropTableIfExists('unit_pricing');
  await knex.schema.dropTableIfExists('units');
  await knex.schema.dropTableIfExists('unit_types');
  await knex.schema.dropTableIfExists('properties');
}

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('risk_calculation_runs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.date('as_of_date').notNullable();
    t.timestamp('calculated_at', { useTz: true }).defaultTo(knex.fn.now());
    t.integer('total_residents').notNullable();
    t.integer('flagged_count').notNullable();
    t.unique(['property_id', 'as_of_date']);
  });

  await knex.schema.createTable('risk_scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('run_id').notNullable().references('id').inTable('risk_calculation_runs').onDelete('CASCADE');
    t.uuid('resident_id').notNullable().references('id').inTable('residents').onDelete('CASCADE');
    t.integer('score').notNullable();
    t.text('tier').notNullable();
    t.integer('days_to_expiry');
    t.jsonb('signals').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw('ALTER TABLE risk_scores ADD CONSTRAINT risk_scores_score_range CHECK (score BETWEEN 0 AND 100)');
  await knex.raw("ALTER TABLE risk_scores ADD CONSTRAINT risk_scores_tier_values CHECK (tier IN ('high','medium','low'))");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('risk_scores');
  await knex.schema.dropTableIfExists('risk_calculation_runs');
}

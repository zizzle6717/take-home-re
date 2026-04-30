import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('webhook_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.text('event_id').notNullable().unique();
    t.uuid('property_id').notNullable().references('id').inTable('properties').onDelete('CASCADE');
    t.uuid('resident_id').notNullable().references('id').inTable('residents').onDelete('CASCADE');
    t.text('event_type').notNullable();
    t.jsonb('payload').notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('webhook_delivery_state', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('webhook_event_id')
      .notNullable()
      .unique()
      .references('id')
      .inTable('webhook_events')
      .onDelete('CASCADE');
    t.text('status').notNullable();
    t.integer('attempt_count').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(5);
    t.timestamp('next_retry_at', { useTz: true });
    t.timestamp('last_attempt_at', { useTz: true });
    t.text('last_error');
    t.integer('last_status_code');
    t.timestamp('delivered_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw(
    "ALTER TABLE webhook_delivery_state ADD CONSTRAINT webhook_delivery_state_status_values CHECK (status IN ('pending','in_flight','delivered','dlq'))",
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('webhook_delivery_state');
  await knex.schema.dropTableIfExists('webhook_events');
}

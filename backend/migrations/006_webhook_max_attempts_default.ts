import type { Knex } from 'knex';

// Spec lists five backoff intervals (1s, 2s, 4s, 8s, 16s) and "after 5 failed
// attempts move to DLQ". Initial attempt + 5 retries = 6 attempts. Bumping
// the default lets the worker actually use the 16s interval before DLQ.
// Existing rows (if any) keep their inserted value.

export async function up(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE webhook_delivery_state ALTER COLUMN max_attempts SET DEFAULT 6');
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE webhook_delivery_state ALTER COLUMN max_attempts SET DEFAULT 5');
}

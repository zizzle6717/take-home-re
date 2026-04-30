import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Dashboard tier lookup: filter risk_scores by run + tier.
  await knex.raw('CREATE INDEX risk_scores_run_tier_idx ON risk_scores (run_id, tier)');
  // Latest-per-resident lookup for trend / per-resident history.
  await knex.raw('CREATE INDEX risk_scores_resident_run_idx ON risk_scores (resident_id, run_id)');
  // Scoring query hot path: active leases by property, ordered/filtered by lease_end_date.
  await knex.raw(
    "CREATE INDEX leases_active_property_end_date_idx ON leases (property_id, lease_end_date) WHERE status = 'active'",
  );
  // Worker poll hot path: only pending rows are polled by next_retry_at.
  await knex.raw(
    "CREATE INDEX webhook_delivery_state_pending_next_retry_idx ON webhook_delivery_state (next_retry_at) WHERE status = 'pending'",
  );
  // Payment history scan: most-recent ledger entries per resident.
  await knex.raw(
    'CREATE INDEX resident_ledger_resident_date_idx ON resident_ledger (resident_id, transaction_date DESC)',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS resident_ledger_resident_date_idx');
  await knex.raw('DROP INDEX IF EXISTS webhook_delivery_state_pending_next_retry_idx');
  await knex.raw('DROP INDEX IF EXISTS leases_active_property_end_date_idx');
  await knex.raw('DROP INDEX IF EXISTS risk_scores_resident_run_idx');
  await knex.raw('DROP INDEX IF EXISTS risk_scores_run_tier_idx');
}

# Renewal Risk Detection System

A take-home implementation of a renewal-risk detection system for the Residential Operating Platform (ROP). Scores residents 0–100 on lease-renewal risk, exposes a dashboard, and delivers renewal events to an external RMS with retries and a dead-letter queue.

## Quick Start

Prerequisites: Docker, Node 20.

```bash
# 1. Bring up Postgres (host port 5434 to avoid conflicts with other local pg)
npm run docker:dev:up                 # starts the postgres service
npm run docker:status                 # verify postgres is "healthy"

# 2. Backend
cd backend
cp ../.env.example .env
npm install
npm run migrate                       # apply all migrations
npm run seed                          # load Park Meadows seed
npm test                              # full vitest suite (63 tests)
npm run dev                           # logs "Database connected" + "Server on :3000"

# 3. Verify the backend
curl http://localhost:3000/healthz                                   # {"status":"ok"}
PROP_ID=$(docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select id from properties limit 1")
curl -X POST http://localhost:3000/api/v1/properties/$PROP_ID/renewal-risk/calculate \
  -H 'Content-Type: application/json' \
  -d "{\"propertyId\":\"$PROP_ID\",\"asOfDate\":\"$(date +%F)\"}"

# 4. Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                           # http://localhost:5173/properties/<PROP_ID>/renewal-risk

# 5. (Optional) Build the backend image
docker build -t renewal-backend ./backend
```

### Workspace scripts

The repo root `package.json` exposes docker convenience scripts (run from the repo root):

| Script | Action |
| --- | --- |
| `npm run docker:dev:up` | Start the `postgres` service detached |
| `npm run docker:dev:down` | Stop containers (keeps the volume) |
| `npm run docker:dev:reset` | Stop and **delete** the pg volume, then start fresh |
| `npm run docker:dev:logs` | Tail postgres logs |
| `npm run docker:status` | `docker compose ps` |
| `npm run docker:psql` | Open a `psql` shell inside the running postgres container |
| `npm run docker:full:up` | Bring up postgres **and** the dockerized backend (`full` profile) |
| `npm run docker:full:down` | Stop the full stack |

During development you typically want only Postgres in Docker and the backend running locally for fast iteration; the `full` profile is for parity-checking the Dockerfile build.

## Architecture

```
+----------------+       +-----------------+       +-----------------+       +-------------+
|  React/Vite    | HTTPS |  Express API    |  SQL  |   PostgreSQL    |  poll |  Webhook    |
|  Dashboard     +------>+  (Node + TS)    +<----->+   (15)          +<----->+  Worker     |
|  :5173         |       |  :3000          |       |                 |       |  (in-proc)  |
+----------------+       +--------+--------+       +-----------------+       +------+------+
                                  |                                                  |
                                  | (POST /__mock_rms in dev)                        | POST /webhook
                                  v                                                  v
                           +------+--------------------------------------------------+
                           |  RMS (real prod) / Mock RMS (same Express, dev only)    |
                           +---------------------------------------------------------+
```

Single Postgres database is the durable substrate. The API writes risk runs and webhook events; the worker — a `setInterval` poller embedded in the API process — claims due deliveries with `SELECT … FOR UPDATE SKIP LOCKED`, POSTs to the configured RMS URL with an `Idempotency-Key` header, and applies the outcome (`delivered`, retry with exponential backoff, or move to `dlq` after `max_attempts`). The mock RMS lives at `/__mock_rms/webhook` in the same Express app and is mounted only when `NODE_ENV !== 'production'`, so the full delivery loop can be exercised locally without a second process.

## Design Decisions

- **Append-only `risk_calculation_runs`.** Every score calculation creates a new run with a `unique (property_id, as_of_date)` constraint. That gives us three things at once: an audit trail of how the score evolved over time, idempotency for concurrent batch triggers (the second writer collides on the unique key and short-circuits to the existing run), and free history for "what did Jane look like 30 days ago." A single mutable row would have made the trigger endpoint racy and the audit story worse.

- **Partial indexes on the hot paths.** `webhook_delivery_state (next_retry_at) WHERE status = 'pending'` is the worker's poll query; the partial index keeps the b-tree narrow even when the `delivered` partition grows large. `leases (property_id, lease_end_date) WHERE status = 'active'` does the same for the scoring CTE — terminated leases stay out of the scan.

- **JSONB for `risk_scores.signals`.** The four signals we score on today are not the same set we'll score on next quarter. A typed sidecar table would tie schema migrations to product evolution; JSONB lets us evolve the signal set without DDL while still supporting GIN indexes if a query needs to filter on a specific signal later.

- **Deterministic `event_id` = `sha256(propertyId : residentId : runId)`.** Idempotency at the *create* boundary, not just the *delivery* boundary. A retry of the trigger endpoint — whether from the user double-clicking the dashboard, a network hiccup, or a queued admin job — collides on the unique constraint and the second insert is a no-op. The `Idempotency-Key` header on outbound delivery uses the same id, so the RMS gets the same de-dup primitive.

- **In-process worker with `FOR UPDATE SKIP LOCKED`.** The same code runs unchanged with N worker processes — durability and concurrency come from Postgres row locks, not from the runtime topology. That keeps the take-home scope simple (no Redis, no BullMQ, no second container) while preserving the operational shape of a real system: to scale out, add a second process pointing at the same database, and the lock semantics keep work non-overlapping.

## Edge Cases Handled

- **Month-to-month leases.** The CTE coerces `days_to_expiry` to 30 for any active lease where `lease_type = 'month_to_month'`. The scoring weight then maps that to a moderate-but-not-extreme days score.
- **Missing `market_rent`.** When `unit_pricing.market_rent` is null, the rent-gap signal is dropped and the remaining three signals are renormalized to 0.47/0.29/0.24 (proportional to the original 40/25/20). Documented in `src/scoring/calculateScore.ts`.
- **Expired leases.** Filtered at the SQL level: the `active_leases` CTE requires `status = 'active'` AND (`lease_type = 'month_to_month'` OR `lease_end_date >= as_of_date`). Past-end fixed leases never enter scoring.
- **Concurrent batch triggers.** Two simultaneous `POST /renewal-risk/calculate` for the same property and `as_of_date` collide on `unique (property_id, as_of_date)`. The losing transaction's insert is ignored and it falls through to a `SELECT` that returns the existing run. Both callers get the same `calculatedAt`.
- **Duplicate event triggers.** Deterministic `event_id` + unique constraint on `webhook_events.event_id`. The second `POST /renewal-events` returns `{ status: 'already_exists' }`; no extra row in `webhook_events`, no extra delivery scheduled.
- **Worker crash mid-delivery.** Rows claimed during a failed tick stay in `in_flight`. Known gap: there is no sweeper to mark stuck `in_flight` rows back to `pending`. In production this would be a periodic job (see Production Hardening). For the take-home, a SIGTERM during retries drains in-flight ticks gracefully — the exit waits for the current tick to finish — but a hard crash (SIGKILL, OOM) leaves rows visible only to admin tooling.
- **Graceful shutdown.** `SIGTERM`/`SIGINT` triggers `worker.stop()` (clears the interval, awaits the in-flight tick) then `server.close()`, so the process exits cleanly within roughly the worker's poll period.

## Seed scope

The Park Meadows seed (`backend/seeds/01_park_meadows.ts`) intentionally produces **4 residents** matching the four named scenarios in `seed_and_testing.md` (Jane / John / Alice / Bob). The illustrative response example in that doc shows `totalResidents: 15, flaggedCount: 8` — those are the spec author's expected numbers for a fully-fleshed-out seed, not the numbers the bundled seed produces. Integration tests pin the actual counts (`expect(totalResidents).toBe(4)`); a future expansion of the seed should also update those assertions.

## Production Hardening (not implemented)

These were called out in the spec as out of scope for the take-home; documenting the intent here.

- **Separate worker process.** Run the worker as its own pod for resource isolation and independent scaling. The code is already worker-topology-agnostic — `WebhookWorker.start()` is the only entrypoint that needs to move.
- **HMAC-SHA256 request signing.** `X-Signature: sha256=<hex>` header where the signature is the HMAC of the raw request body using a per-tenant shared secret. The RMS validates by recomputing. The shared secret would live in a per-property `webhook_destinations` table; rotating a secret means a brief overlap window where both old and new signatures are accepted.
- **Stuck `in_flight` sweeper.** A periodic job that marks `in_flight` rows back to `pending` if `last_attempt_at` (or `updated_at` for rows that never got an attempt) is older than a threshold (e.g., 5 × `WORKER_POLL_MS`). This is the gap noted in Edge Cases.
- **DLQ alerting.** Page when `dlq` depth crosses a threshold or grows over a window. Cheap version: cron a query against `/admin/webhooks/health` from an external monitor.
- **Circuit breaker on the RMS endpoint.** After consecutive failures across many events, stop attempting and shed back to a longer retry interval. Avoids hammering an RMS that is already down.
- **Distributed tracing.** OpenTelemetry: span the trigger endpoint → enqueue → worker tick → outbound POST → ack. Critical for diagnosing latency spikes once there are multiple worker pods.
- **Multi-tenant rate limiting.** Per-property cap on trigger calls. Today nothing prevents a misbehaving caller from queueing thousands of events for one property and starving others.
- **Property-local timezones.** The current design treats all `date` columns as belonging to a single implicit timezone (effectively the server's). For a multi-region rollout where properties live in different TZs, this leaks in three places: (1) "today" is computed in the caller's browser TZ before being sent as `asOfDate`, so two managers in different TZs clicking "Calculate today" simultaneously can submit different dates and bypass the `(property_id, as_of_date)` dedup; (2) the 6-month payment window has soft edges — a payment recorded near local midnight can land on either side of the window depending on the ingest system's TZ, shifting `payment_count` by ±1 and potentially flipping `isDelinquent`; (3) the active-lease filter `lease_end_date >= as_of_date` is consistent within a query but the *meaning* of "April 30" depends on the property's local TZ. Fix: add `properties.timezone` (IANA name), derive `as_of_date` server-side from `now() AT TIME ZONE property.timezone`, and document the convention that all `date` columns mean "calendar date in the property's local TZ." `timestamptz` columns (`calculated_at`, `next_retry_at`, `now()` in the worker) are already TZ-correct and unaffected.

## AI Assistance

This implementation was built with Claude Code as a pair-programmer. Specifically:

- **Plan and scaffolding (Claude-driven, human-reviewed).** The phased build sequence in `PLAN.md`, the Express + Knex + Vite directory layout, and the migration scaffolding for all 12 tables. I directed the structure and reviewed every file before commit; Claude wrote the keystrokes.
- **Scoring CTE (drafted by Claude, refined by hand).** The query in `src/scoring/loadSignals.ts` started as a Claude draft. I tightened the delinquency window logic (the spec's "any missed/late payment in last 6 months" needed to become a count threshold against the rent-charge ledger entries), and I locked in the `latest_pricing` `DISTINCT ON (unit_id)` shape after seeing the first version assume one row per unit.
- **React table boilerplate (Claude).** The dashboard table, expandable signal rows, and tier-color CSS tokens.
- **Designed by hand, with Claude as a sounding board.** The worker state machine (`pending → in_flight → delivered | pending+backoff | dlq`), the `FOR UPDATE SKIP LOCKED` claim semantics, the deterministic `event_id` strategy, and the renormalization formula for missing market rent. These are the parts where I made the design call before opening the editor.

Every commit was reviewed before being made; the plan's Phase verifications run end-to-end on the real Postgres against real seed data, not just type-check or unit tests.

## Testing

### Automated

```bash
cd backend
npm test                # 63 tests across 12 files
npm run test:watch      # for TDD loops
```

The dev database must be running (`npm run docker:dev:up` from repo root) for integration tests to pass. Tests are co-located with source as `*.test.ts`. Categories:

- **Unit (no I/O):** `calculateScore.test.ts`, `eventId.test.ts`, `backoff.test.ts`.
- **Integration (real Postgres):** `migrations.test.ts`, `seed.test.ts`, `loadSignals.test.ts`, `enqueue.test.ts`, `worker.test.ts`. Each test (or its `beforeEach`) truncates the tables it touches, so the suite is order-independent.
- **HTTP handlers (supertest in-process):** `renewalRisk.test.ts`, `renewalEvents.test.ts`, `adminWebhooks.test.ts`.

### Manual end-to-end

The detailed CTE-based seed script and walkthrough live in `seed_and_testing.md`. Adapted to the actual endpoints:

```bash
# Get a property id
PROP_ID=$(docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select id from properties limit 1")

# 1. Calculate risk
curl -s -X POST http://localhost:3000/api/v1/properties/$PROP_ID/renewal-risk/calculate \
  -H 'Content-Type: application/json' \
  -d "{\"propertyId\":\"$PROP_ID\",\"asOfDate\":\"$(date +%F)\"}" | jq

# 2. Read it back
curl -s http://localhost:3000/api/v1/properties/$PROP_ID/renewal-risk | jq

# 3. Trigger a renewal event for a flagged resident
RES_ID=$(docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc \
  "select resident_id from risk_scores where tier in ('high','medium') limit 1")
curl -s -X POST http://localhost:3000/api/v1/properties/$PROP_ID/residents/$RES_ID/renewal-events | jq

# 4. Inspect the worker's state machine
docker compose exec -T postgres psql -U postgres -d renewal_risk \
  -c "select status, attempt_count, last_status_code from webhook_delivery_state order by created_at desc limit 5"
```

### Forcing failures and DLQ

The mock RMS understands `MOCK_RMS_FAILURE_RATE` (a float in 0.0–1.0). Setting it to `1.0` and restarting the backend forces every delivery to 503; setting it to `0.5` lets you observe partial failures and retry behavior. After 5 attempts the worker moves the row to `dlq`.

```bash
# In backend/.env
MOCK_RMS_FAILURE_RATE=1.0

# Restart backend, trigger an event, then watch:
watch -n1 "docker compose exec -T postgres psql -U postgres -d renewal_risk \
  -c \"select status, attempt_count, next_retry_at from webhook_delivery_state order by updated_at desc limit 3\""
```

You'll see `attempt_count` increment at intervals approximately matching 1s, 2s, 4s, 8s, 16s before the row transitions to `dlq`.

### Admin endpoints

```bash
# Health: status counts, oldest pending row's age in seconds, last-hour failure ratio
curl -s http://localhost:3000/api/v1/admin/webhooks/health | jq

# Requeue a DLQ row (returns 409 if the row is not in dlq status)
DLQ_ID=$(docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc \
  "select id from webhook_delivery_state where status='dlq' limit 1")
curl -s -X POST http://localhost:3000/api/v1/admin/webhooks/$DLQ_ID/retry | jq
```

`POST /admin/webhooks/:id/retry` resets `status='pending'`, `attempt_count=0`, `next_retry_at=now()`, and clears `last_error`. The next worker tick picks the row up. In production these endpoints would sit behind an admin-role authn check; documented as out of scope above.

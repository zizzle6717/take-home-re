# Backend

Express + TypeScript + Knex against PostgreSQL 15. Hosts the renewal-risk API, the in-process webhook worker, and a mock RMS endpoint for local testing.

For end-to-end setup (Postgres via docker compose, full quick-start), see the [root README](../README.md). This README is the per-package reference: layout, env vars, scripts, endpoints.

## Layout

```
src/
  api/         Express routers (renewalRisk, renewalEvents, adminWebhooks)
  scoring/     Pure scoring logic + signal-loading SQL
  webhooks/    Enqueue, in-process worker, deliver, mock RMS
  db/          Knex client + migration/seed integration tests
  app.ts       Express app factory (used by tests via supertest)
  config.ts    Zod-validated env loader (single source of process.env reads)
  index.ts     Boot — connects DB, starts server + worker, wires SIGTERM/SIGINT
migrations/    Knex .ts migrations (numeric prefix, forward-only logic)
seeds/         Knex .ts seeds (Park Meadows fixture)
```

## Environment variables

Copy `.env.example` from the repo root into `backend/.env` (or symlink). Validated by `src/config.ts` at boot — invalid values exit non-zero with a list of fields.

| Var | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — (required) | Postgres connection string. Host port is `5434` per the dev compose file. |
| `PORT` | `3000` | HTTP listener port. |
| `NODE_ENV` | `development` | When `production`, the mock RMS router is **not** mounted. |
| `RMS_WEBHOOK_URL` | `http://localhost:3000/__mock_rms/webhook` | Outbound webhook target. Override to point at webhook.site or a real RMS. |
| `WORKER_POLL_MS` | `1000` | Webhook worker poll interval. |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Attempts before a row is moved to `dlq`. |
| `MOCK_RMS_FAILURE_RATE` | `0` | `0.0`–`1.0`. Probability the mock RMS returns 503. Useful for forcing retries/DLQ. |

## Scripts

```
npm run dev              # ts-node-dev with --respawn
npm run build            # tsc -> dist/
npm start                # node dist/index.js
npm run migrate          # knex migrate:latest
npm run migrate:rollback # knex migrate:rollback (one batch)
npm run seed             # knex seed:run (Park Meadows)
npm test                 # vitest run (62 tests)
npm run test:watch       # vitest in watch mode
```

Migrations and seeds use the same `knexfile.ts`; tests share the dev database and clean up after themselves, so `npm run dev` and `npm test` can be run against the same Postgres without interference.

## API surface

All routes are under `/api/v1`. Errors follow `{ error: { code, message } }`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/healthz` | Liveness — returns `{ status: 'ok' }`. |
| `POST` | `/api/v1/properties/:propertyId/renewal-risk/calculate` | Run the batch scorer for one property + `asOfDate`. Idempotent on `(propertyId, asOfDate)`. |
| `GET` | `/api/v1/properties/:propertyId/renewal-risk` | Read the latest scored run for a property. |
| `POST` | `/api/v1/properties/:propertyId/residents/:residentId/renewal-events` | Trigger a renewal event. Returns `{ eventId, status: 'queued' \| 'already_exists' }`. |
| `GET` | `/api/v1/admin/webhooks/health` | Status counts, oldest pending row age, last-hour failure ratio. |
| `POST` | `/api/v1/admin/webhooks/:id/retry` | Requeue a `dlq` row (`status='pending'`, `attempt_count=0`). 409 if not in `dlq`. |
| `POST` | `/__mock_rms/webhook` | Dev-only fixture RMS. Honors `MOCK_RMS_FAILURE_RATE`. Not mounted in production. |

Request payloads and response shapes are documented inline next to each handler in `src/api/`.

## Database schema

Migrations split by concern so each is reviewable in isolation:

| File | Adds |
| --- | --- |
| `001_core_entities.ts` | `properties`, `units`, `residents`, `leases`. |
| `002_risk_calculation.ts` | `risk_calculation_runs` (append-only, unique on `(property_id, as_of_date)`), `risk_scores` (JSONB `signals`). |
| `003_webhook_delivery.ts` | `webhook_events` (deterministic `event_id` unique), `webhook_delivery_state` (FSM: `pending → in_flight → delivered \| pending+backoff \| dlq`). |
| `004_indexes.ts` | Hot-path partial indexes (`webhook_delivery_state(next_retry_at) WHERE status='pending'`, `leases(property_id, lease_end_date) WHERE status='active'`). |
| `005_starter_schema_alignment.ts` | Aligns columns/enums with `starter_schema.sql` from the spec packet. |

Design rationale (append-only runs, JSONB signals, deterministic event ids, in-process worker) lives in the [root README](../README.md#design-decisions).

## Webhook worker

In-process. `src/webhooks/worker.ts` polls every `WORKER_POLL_MS`, claims due rows with `SELECT … FOR UPDATE SKIP LOCKED`, POSTs to `RMS_WEBHOOK_URL` with an `Idempotency-Key` header equal to the event id, and applies the outcome:

- 2xx → `delivered`.
- 4xx/5xx or transport error and `attempt_count < max_attempts` → `pending`, `next_retry_at = now() + backoff(attempt_count)` where backoff is `1s, 2s, 4s, 8s, 16s`.
- `attempt_count >= max_attempts` → `dlq`.

Graceful shutdown: `SIGTERM`/`SIGINT` clears the interval, awaits the in-flight tick, closes the HTTP server, then destroys the DB pool.

## Tests

Co-located with source as `*.test.ts`. Vitest is the locked choice (per `CLAUDE.md`).

- **Unit (no I/O):** `calculateScore.test.ts`, `eventId.test.ts`, `backoff.test.ts`.
- **Integration (real Postgres):** `migrations.test.ts`, `seed.test.ts`, `loadSignals.test.ts`, `enqueue.test.ts`, `worker.test.ts`.
- **HTTP (supertest in-process):** `renewalRisk.test.ts`, `renewalEvents.test.ts`, `adminWebhooks.test.ts`.

Integration tests require Postgres up (`npm run docker:dev:up` from the repo root) and migrations applied. The suite truncates touched tables in `beforeEach`, so order does not matter.

## Build artifact

`docker build -t renewal-backend ./backend` produces a multi-stage image that runs `npm start`. `docker-compose.yml`'s `full` profile composes it with Postgres for parity-checking the production build (`npm run docker:full:up` from the repo root).

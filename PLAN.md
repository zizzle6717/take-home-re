# Renewal Risk Take-Home — Build Plan

This file is the source of truth for building the renewal risk system. It is structured so that a fresh Claude Code session can pick up at any phase boundary by reading this file and inspecting `git log`.

---

## Session Start Protocol

Execute these steps at the start of every session:

1. Read this file fully.
2. On the first session only, also read `renewal_risk_takehome.md` and `seed_and_testing.md` in the repo root. These are the original spec; this plan derives from them.
3. Run `git log --oneline` to determine the last completed phase. Phase commits use the exact format `Phase N: <description>`.
4. Identify the current phase as the lowest-numbered phase whose commit is not present.
5. Run that phase's **Preconditions** checks. If any fail, repair before building (do not skip).
6. Execute the phase's **Tasks** in order.
7. Run the phase's **Verification** checks. All must pass.
8. Commit using the phase's exact **Commit message**.
9. Stop. Do not proceed to the next phase without explicit user direction.

If verification fails after a phase commit already exists in git history (e.g., a regression), treat verification as the source of truth and repair the implementation before moving on.

---

## Project Overview

Build a renewal risk detection system per `renewal_risk_takehome.md`:

- Backend (Node + TypeScript + Express) that scores residents 0–100 on lease-renewal risk and exposes a dashboard API.
- React + TypeScript dashboard listing flagged residents and triggering renewal events.
- Webhook delivery system to an external RMS with exponential backoff, dead-letter queue, and idempotency. State persisted in Postgres; worker runs in-process.
- PostgreSQL schema, multi-tenant by `property_id`.
- Containerized via docker-compose so it runs in any environment.

---

## Locked-in Technical Decisions

Do not relitigate these. They are chosen and final.

- **Database:** PostgreSQL 15.
- **Migrations + query building:** Knex with TypeScript. Drop to raw SQL for the scoring CTE; use the query builder elsewhere.
- **Backend framework:** Express with TypeScript, strict mode on.
- **Validation:** Zod on all request bodies.
- **Frontend:** Vite + React + TypeScript. No router; read `propertyId` from `window.location.pathname`.
- **Styling:** Vanilla CSS in a single stylesheet. No Tailwind, no component library.
- **Webhook worker:** In-process, started on backend boot. `setInterval` poll loop using `SELECT ... FOR UPDATE SKIP LOCKED` to claim due deliveries. No Redis, no separate worker process, no child_process. The README explains this is a deliberate choice and how the same code scales to multiple workers.
- **Mock RMS:** Lives in the same Express app at `/__mock_rms/webhook`, toggled by env var. Avoids running a second process during testing.
- **Auth:** None. Documented as out of scope.
- **Webhook signing:** Not implemented. HMAC-SHA256 scheme documented in README only.
- **Node version:** 20 LTS.

---

## Repository Structure (target end state)

```
.
├── backend/
│   ├── src/
│   │   ├── api/             # Express route handlers
│   │   ├── db/              # knex client, migration runner
│   │   ├── scoring/         # pure scoring functions + signal loader
│   │   ├── webhooks/        # enqueue, worker, deliver, mock RMS
│   │   └── index.ts         # boot: db, http, worker, signal handlers
│   ├── migrations/          # knex .ts migrations
│   ├── seeds/               # knex .ts seeds
│   ├── Dockerfile
│   ├── knexfile.ts
│   ├── tsconfig.json
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── index.html
│   └── package.json
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── PLAN.md
├── renewal_risk_takehome.md
└── seed_and_testing.md
```

---

## Phase 0: Bootstrap

### Preconditions
- `git log --oneline` shows no `Phase 0:` commit.
- `renewal_risk_takehome.md` and `seed_and_testing.md` exist in repo root.
- Repo has at most an initial commit and these spec files.

### Goal
A working scaffold: `docker-compose up postgres` brings up a healthy database, backend boots and connects, frontend renders the default Vite page. No business logic yet.

### Tasks

1. Create `.gitignore` covering `node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`.

2. Create `.env.example`:
   ```
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/renewal_risk
   PORT=3000
   RMS_WEBHOOK_URL=http://localhost:3000/__mock_rms/webhook
   WORKER_POLL_MS=1000
   WEBHOOK_MAX_ATTEMPTS=5
   MOCK_RMS_FAILURE_RATE=0
   ```

3. Create `docker-compose.yml` with a Postgres 15 service named `postgres`, named volume `pgdata`, healthcheck via `pg_isready`, port `5432:5432`, env vars matching `.env.example`. Add a `backend` service that builds from `./backend/Dockerfile`, depends on `postgres` healthy, mounts `./backend:/app` for dev, exposes `3000:3000`. The backend service should be runnable but not required (the user may run backend locally).

4. Scaffold backend:
   - `cd backend && npm init -y`
   - Install deps: `express`, `knex`, `pg`, `dotenv`, `zod`, `node-fetch@2` (CommonJS friendly).
   - Install dev deps: `typescript`, `ts-node-dev`, `@types/node`, `@types/express`, `@types/pg`, `@types/node-fetch`.
   - Create `tsconfig.json` with strict mode on, target ES2022, module commonjs, outDir `dist`, rootDir `src`.
   - Add scripts to `package.json`: `dev` (ts-node-dev), `build` (tsc), `start` (node dist/index.js), `migrate` (knex migrate:latest), `migrate:rollback`, `seed` (knex seed:run).
   - Create `knexfile.ts` reading `DATABASE_URL`, with TypeScript migrations directory `./migrations` and seeds directory `./seeds`.
   - Create `src/db/index.ts` exporting a configured Knex instance.
   - Create `src/index.ts`: load dotenv, create Express app, add `GET /healthz` returning `{status: 'ok'}`, verify DB connection on boot via `db.raw('select 1')`, listen on `PORT`. Log "Database connected" and "Server on :PORT".
   - Create `backend/Dockerfile`: multi-stage. Stage 1 (`builder`) installs all deps and runs `npm run build`. Stage 2 (`runner`) on `node:20-alpine`, copies `dist/` and production deps, sets `CMD ["node", "dist/index.js"]`. Use `--omit=dev` in stage 2.

5. Scaffold frontend:
   - `npm create vite@latest frontend -- --template react-ts` (or equivalent — write the files directly if `npm create` is unavailable).
   - Install deps inside `frontend/`.
   - Add a `.env.example` in `frontend/` with `VITE_API_BASE_URL=http://localhost:3000`.

6. Create `README.md` with placeholder sections: Quick Start, Architecture, Design Decisions, Edge Cases, Production Hardening, AI Assistance, Testing. Fill in Quick Start now (steps to bring up postgres, run migrations, seed, start backend, start frontend). Other sections will be filled in Phase 5.

### Verification

Run each and confirm output:

- `docker-compose up -d postgres` → exits 0.
- `docker-compose ps` → `postgres` shows healthy.
- `cd backend && cp ../.env.example .env && npm install && npm run dev` → logs "Database connected" and "Server on :3000".
- `curl http://localhost:3000/healthz` → returns `{"status":"ok"}`.
- `cd frontend && npm install && npm run dev` → starts Vite on 5173, default page loads.
- `cd backend && npm run build` → produces `dist/index.js` with no errors.
- `docker build -t renewal-backend ./backend` → builds successfully.

### Commit
```
Phase 0: bootstrap repo + containerization
```

---

## Phase 1: Schema + Seed

### Preconditions
- `git log --oneline` shows `Phase 0:` but no `Phase 1:`.
- `cd backend && npm run dev` works.
- Postgres is running (`docker-compose up -d postgres`).

### Goal
All tables exist with intentional indexes. The provided seed script creates 4 documented resident scenarios (Jane Doe high-risk, John Smith medium, Alice Johnson low, Bob Williams MTM).

### Tasks

1. Create migration `migrations/001_core_entities.ts`. Tables, in this order (FKs follow):

   - `properties` — `id uuid PK default gen_random_uuid()`, `name text not null`, `address text`, `city text`, `state text`, `zip_code text`, `status text not null`, `created_at timestamptz default now()`.
   - `unit_types` — `id uuid PK`, `property_id uuid not null FK`, `name text`, `bedrooms int`, `bathrooms numeric`, `square_footage int`.
   - `units` — `id uuid PK`, `property_id uuid not null FK`, `unit_type_id uuid FK`, `unit_number text not null`, `floor int`, `status text not null`. Unique `(property_id, unit_number)`.
   - `unit_pricing` — `id uuid PK`, `unit_id uuid not null FK`, `base_rent numeric not null`, `market_rent numeric not null`, `effective_date date not null`, `created_at timestamptz default now()`.
   - `residents` — `id uuid PK`, `property_id uuid not null FK`, `unit_id uuid FK`, `first_name text`, `last_name text`, `email text`, `status text not null`.
   - `leases` — `id uuid PK`, `property_id uuid not null FK`, `resident_id uuid not null FK`, `unit_id uuid not null FK`, `lease_start_date date not null`, `lease_end_date date not null`, `monthly_rent numeric not null`, `lease_type text not null`, `status text not null`.
   - `resident_ledger` — `id uuid PK`, `property_id uuid not null FK`, `resident_id uuid not null FK`, `transaction_type text not null`, `charge_code text`, `amount numeric not null`, `transaction_date date not null`.
   - `renewal_offers` — `id uuid PK`, `property_id uuid not null FK`, `resident_id uuid not null FK`, `lease_id uuid not null FK`, `renewal_start_date date`, `renewal_end_date date`, `proposed_rent numeric`, `status text not null`, `created_at timestamptz default now()`.

   Enable `pgcrypto` extension first for `gen_random_uuid()`.

2. Create migration `migrations/002_risk_calculation.ts`:

   - `risk_calculation_runs` — `id uuid PK`, `property_id uuid not null FK`, `as_of_date date not null`, `calculated_at timestamptz default now()`, `total_residents int not null`, `flagged_count int not null`. Unique constraint on `(property_id, as_of_date)` — this is the idempotency anchor for concurrent batch triggers.
   - `risk_scores` — `id uuid PK`, `run_id uuid not null FK`, `resident_id uuid not null FK`, `score int not null check (score between 0 and 100)`, `tier text not null check (tier in ('high','medium','low'))`, `days_to_expiry int`, `signals jsonb not null`, `created_at timestamptz default now()`.

3. Create migration `migrations/003_webhook_delivery.ts`:

   - `webhook_events` — `id uuid PK`, `event_id text not null unique`, `property_id uuid not null FK`, `resident_id uuid not null FK`, `event_type text not null`, `payload jsonb not null`, `created_at timestamptz default now()`. The `event_id` is a deterministic hash (computed app-side) and the unique constraint is the idempotency anchor for duplicate event triggers.
   - `webhook_delivery_state` — `id uuid PK`, `webhook_event_id uuid not null FK unique` (one delivery state per event), `status text not null check (status in ('pending','in_flight','delivered','dlq'))`, `attempt_count int not null default 0`, `max_attempts int not null default 5`, `next_retry_at timestamptz`, `last_attempt_at timestamptz`, `last_error text`, `last_status_code int`, `delivered_at timestamptz`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`.

4. Create migration `migrations/004_indexes.ts` adding:

   - `risk_scores (run_id, tier)` — dashboard tier lookup.
   - `risk_scores (resident_id, run_id)` — latest-per-resident.
   - Partial: `leases (property_id, lease_end_date) WHERE status = 'active'` — scoring query hot path.
   - Partial: `webhook_delivery_state (next_retry_at) WHERE status = 'pending'` — worker poll hot path.
   - `resident_ledger (resident_id, transaction_date DESC)` — payment history scan.

5. Create `seeds/01_park_meadows.ts`. Translate the SQL CTE script in `seed_and_testing.md` into a Knex seed using a single `db.raw(...)` call wrapped in a transaction. Adapt column names if the spec's seed assumes columns we didn't create (verify against migrations 001).

### Verification

- `cd backend && npm run migrate` → completes with no errors.
- `psql $DATABASE_URL -c "\dt"` → shows all 10 tables.
- `psql $DATABASE_URL -c "\di"` → shows the indexes from migration 004.
- `npm run seed` → completes with no errors.
- `psql $DATABASE_URL -c "select count(*) from residents"` → returns 4.
- `psql $DATABASE_URL -c "select count(*) from leases where lease_type = 'month_to_month'"` → returns 1.
- `psql $DATABASE_URL -c "select count(*) from resident_ledger where resident_id in (select id from residents where last_name = 'Smith')"` → returns 5 (John Smith has one missing payment).
- `psql $DATABASE_URL -c "select count(*) from renewal_offers"` → returns 1 (Alice's offer).

### Commit
```
Phase 1: database schema + seed
```

---

## Phase 2: Risk Scoring API

### Preconditions
- `git log --oneline` shows `Phase 1:` but no `Phase 2:`.
- Schema verifications from Phase 1 still pass.

### Goal
`POST /api/v1/properties/:propertyId/renewal-risk/calculate` returns the spec-shaped response with correct scores for the 4 seed scenarios. `GET /api/v1/properties/:propertyId/renewal-risk` returns the latest run.

### Tasks

1. Create `src/scoring/types.ts` defining `Signals`, `ScoreResult`, `ResidentSignals` interfaces.

2. Create `src/scoring/calculateScore.ts` — a pure function. Given a `Signals` object, returns `{ score, tier }`.

   Weights:
   - Days to expiry (40%): score is `min(100, max(0, (90 - days_to_expiry) / 90 * 100))` for fixed-term leases; for month-to-month, treat days_to_expiry as 30. Beyond 90 days = 0; at 0 days = 100.
   - Payment delinquency (25%): binary. 100 if delinquent (any missed/late payment in last 6 months), else 0.
   - No renewal offer yet (20%): binary. 100 if no pending/accepted offer, else 0.
   - Market rent above actual (15%): `min(100, max(0, (market_rent - monthly_rent) / monthly_rent * 100 * 5))` — i.e., a 20% gap = full 100. Cap at 100.

   Final score = round(0.4 * daysScore + 0.25 * delinquencyScore + 0.20 * noOfferScore + 0.15 * rentGapScore).

   Tiers: `score >= 70` → `high`, `score >= 40` → `medium`, else `low`.

   If `market_rent` is null or unavailable: drop that signal and renormalize the other three to weights 0.47 / 0.29 / 0.24 (proportional to original 40/25/20). Document this in code comments.

   Write a small test file `src/scoring/calculateScore.test.ts` (or just a `.assertions.ts` file run on boot in dev) that asserts:
   - Jane Doe inputs (45 days, not delinquent, no offer, $1400 vs $1600) → score in [80, 90], tier 'high'.
   - Alice inputs (180 days, not delinquent, has offer, $1600 vs $1600) → score in [0, 30], tier 'low'.
   - Bob inputs (MTM treated as 30 days, not delinquent, no offer, $1450 vs $1600) → score in [55, 75], tier 'medium' or 'high'.

3. Create `src/scoring/loadSignals.ts` — single SQL query via `db.raw`. Skeleton:

   ```sql
   WITH active_leases AS (
     SELECT l.id AS lease_id, l.resident_id, l.unit_id, l.monthly_rent,
            l.lease_type, l.lease_end_date,
            CASE WHEN l.lease_type = 'month_to_month' THEN 30
                 ELSE (l.lease_end_date - :asOfDate::date) END AS days_to_expiry
       FROM leases l
      WHERE l.property_id = :propertyId
        AND l.status = 'active'
        AND (l.lease_type = 'month_to_month' OR l.lease_end_date >= :asOfDate::date)
   ),
   latest_pricing AS (
     SELECT DISTINCT ON (unit_id) unit_id, market_rent
       FROM unit_pricing
      ORDER BY unit_id, effective_date DESC
   ),
   pending_offers AS (
     SELECT DISTINCT lease_id
       FROM renewal_offers
      WHERE status IN ('pending','accepted')
   ),
   payment_counts AS (
     SELECT resident_id, COUNT(*) AS payment_count
       FROM resident_ledger
      WHERE transaction_type = 'payment'
        AND charge_code = 'rent'
        AND transaction_date >= :asOfDate::date - INTERVAL '6 months'
        AND transaction_date <= :asOfDate::date
      GROUP BY resident_id
   )
   SELECT
     r.id AS resident_id,
     r.first_name, r.last_name,
     u.id AS unit_id, u.unit_number,
     al.lease_id, al.monthly_rent, al.lease_type, al.days_to_expiry,
     lp.market_rent,
     (po.lease_id IS NOT NULL) AS has_pending_offer,
     COALESCE(pc.payment_count, 0) AS payment_count
     FROM active_leases al
     JOIN residents r ON r.id = al.resident_id
     JOIN units u ON u.id = al.unit_id
     LEFT JOIN latest_pricing lp ON lp.unit_id = al.unit_id
     LEFT JOIN pending_offers po ON po.lease_id = al.lease_id
     LEFT JOIN payment_counts pc ON pc.resident_id = al.resident_id;
   ```

   The handler maps this into `Signals` objects. Treat `payment_count < 6` as delinquent.

4. Create `src/api/renewalRisk.ts` with two handlers:

   - `POST /api/v1/properties/:propertyId/renewal-risk/calculate`:
     - Validate body with Zod: `{ propertyId: string, asOfDate: string (ISO date) }`. Verify body `propertyId` matches URL param.
     - Wrap in transaction:
       1. Load signals via `loadSignals`.
       2. For each resident, compute `{ score, tier }` via `calculateScore`.
       3. Insert into `risk_calculation_runs` with `total_residents` and `flagged_count` (flagged = score >= 40, tiers high+medium). The unique `(property_id, as_of_date)` constraint handles concurrent triggers — on conflict, return the existing run via a follow-up SELECT.
       4. Batch insert into `risk_scores` (single `INSERT ... VALUES (...), (...), ...`).
     - Return spec-shaped response: `propertyId`, `calculatedAt`, `totalResidents`, `flaggedCount`, `riskTiers: { high, medium, low }`, `flags: [...]` containing only flagged residents (high + medium).

   - `GET /api/v1/properties/:propertyId/renewal-risk`:
     - Return the most recent `risk_calculation_runs` row for the property, with associated `risk_scores`, in the same response shape as POST.
     - 404 if no run exists.

5. Wire routes into `src/index.ts`. Add a JSON body parser. Add a generic error handler returning `{ error: { message, code } }` with appropriate status codes.

### Verification

- `npm run dev` starts cleanly.
- `curl -X POST http://localhost:3000/api/v1/properties/<PROP_ID>/renewal-risk/calculate -H 'Content-Type: application/json' -d '{"propertyId":"<PROP_ID>","asOfDate":"<TODAY>"}'` returns 200.
  - Use `psql $DATABASE_URL -tc "select id from properties limit 1"` to get PROP_ID.
- Response includes Jane Doe with `riskTier: "high"` and `riskScore` in [80, 90].
- Response includes Alice Johnson NOT in `flags` (low tier excluded), or in flags with `riskTier: "low"` if you chose to include all — match the spec which excludes low.
- Response includes Bob Williams with `riskTier: "medium"` or `"high"`.
- Calling the POST twice with the same `asOfDate` does not create a second `risk_calculation_runs` row (verify via `psql`).
- `curl http://localhost:3000/api/v1/properties/<PROP_ID>/renewal-risk` returns the same flags.
- The score test assertions in `calculateScore.test.ts` pass.

### Commit
```
Phase 2: renewal risk scoring API
```

---

## Phase 3: Webhook Delivery

### Preconditions
- `git log --oneline` shows `Phase 2:` but no `Phase 3:`.
- POST scoring endpoint returns flagged residents.

### Goal
Clicking "Trigger Renewal Event" (simulated via curl for now) creates a webhook event row and a delivery state row. The in-process worker delivers it to the configured RMS within 2s. On failure, retries with exponential backoff. After 5 attempts, status moves to `dlq`. Triggering the same resident+run twice does not duplicate the event.

### Tasks

1. Create `src/webhooks/eventId.ts` — exports `computeEventId(propertyId, residentId, runId): string` returning `sha256(propertyId + ':' + residentId + ':' + runId)` hex-encoded with `evt_` prefix. Deterministic = idempotent.

2. Create `src/webhooks/enqueue.ts` — `enqueueRenewalEvent(propertyId, residentId, runId): Promise<{ eventId, alreadyExists }>`:
   - Look up the resident's latest risk score within `runId`. Throw 404 if not found.
   - Build the spec-shaped payload (event, eventId, timestamp, propertyId, residentId, data: { riskScore, riskTier, daysToExpiry, signals }).
   - In a single transaction: `INSERT INTO webhook_events (...) ON CONFLICT (event_id) DO NOTHING RETURNING id`. If no row returned, the event already existed; fetch its id and return `alreadyExists: true`. Otherwise insert a `webhook_delivery_state` row with `status='pending'`, `attempt_count=0`, `next_retry_at=now()`.

3. Create `src/webhooks/deliver.ts` — `attemptDelivery(state): Promise<DeliveryOutcome>`:
   - Load the `webhook_events.payload`.
   - POST to `RMS_WEBHOOK_URL` with headers `Content-Type: application/json` and `Idempotency-Key: <eventId>`. Use a 5-second timeout.
   - On 2xx: return `{ outcome: 'delivered', statusCode }`.
   - On non-2xx or thrown error: return `{ outcome: 'failed', statusCode, errorMessage }`.
   - Always log structured: `{ eventId, attempt, statusCode, latencyMs, outcome }`.

4. Create `src/webhooks/worker.ts` — `WebhookWorker` class with `start()`, `stop()`:

   - `start()` schedules `tick()` every `WORKER_POLL_MS`. Guards against overlapping ticks with an `inFlight` boolean.
   - `tick()`:
     1. Inside a transaction, claim due deliveries:
        ```sql
        SELECT id, webhook_event_id, attempt_count, max_attempts
          FROM webhook_delivery_state
         WHERE status = 'pending' AND next_retry_at <= now()
         ORDER BY next_retry_at
         LIMIT 10
         FOR UPDATE SKIP LOCKED
        ```
        Update each claimed row's `status` to `in_flight` and commit the transaction. The `SKIP LOCKED` clause is what makes this safe to run as multiple workers.
     2. Outside the transaction, for each claimed row, call `attemptDelivery`.
     3. On `delivered`: update `status='delivered'`, set `delivered_at`, `last_attempt_at`, `last_status_code`.
     4. On `failed`: increment `attempt_count`. If `attempt_count >= max_attempts`, set `status='dlq'`. Else set `status='pending'` and `next_retry_at = now() + INTERVAL '<backoff> seconds'` where backoff is `2^(attempt_count - 1)` (so 1, 2, 4, 8, 16). Set `last_error`, `last_status_code`, `last_attempt_at`.
   - `stop()` sets a `stopping` flag, clears the interval, awaits in-flight ticks to drain, returns.

5. Create `src/webhooks/mockRms.ts` — Express router exposing `POST /__mock_rms/webhook`:
   - Read `MOCK_RMS_FAILURE_RATE` (0.0–1.0). If `Math.random() < failureRate`, respond 503.
   - Otherwise log payload and respond 200 with `{ status: 'ok' }`.
   - Mount under `/__mock_rms` only when `NODE_ENV !== 'production'`.

6. Create `src/api/renewalEvents.ts`:
   - `POST /api/v1/properties/:propertyId/residents/:residentId/renewal-events`:
     - Validate path params (UUIDs).
     - Look up the latest `risk_calculation_runs.id` for the property. 404 if none.
     - Call `enqueueRenewalEvent`. Return `{ eventId, status: 'queued' | 'already_exists' }` with 202.

7. Update `src/index.ts`:
   - Mount routers in order: api routes, mock RMS router (dev only).
   - After DB connects, instantiate `WebhookWorker` and call `start()`.
   - Add `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` handlers that call `worker.stop()`, then `server.close()`, then exit.

### Verification

Set `RMS_WEBHOOK_URL=http://localhost:3000/__mock_rms/webhook` for these tests.

- Trigger a happy-path delivery:
  - Find a flagged resident: `psql $DATABASE_URL -tc "select resident_id from risk_scores where tier in ('high','medium') limit 1"`.
  - `curl -X POST http://localhost:3000/api/v1/properties/<PROP_ID>/residents/<RES_ID>/renewal-events` → returns 202 with an `eventId`.
  - Within 2 seconds, `psql $DATABASE_URL -c "select status, attempt_count from webhook_delivery_state order by created_at desc limit 1"` → returns `delivered, 1`.

- Idempotency:
  - Run the same curl again → returns 202 with `status: 'already_exists'`.
  - `psql $DATABASE_URL -c "select count(*) from webhook_events"` → unchanged.

- Retry + DLQ:
  - Set `MOCK_RMS_FAILURE_RATE=1.0` in `.env`, restart backend.
  - Trigger a renewal event for a different resident.
  - Watch `webhook_delivery_state` row: `attempt_count` increments at intervals approximately matching 1s, 2s, 4s, 8s, 16s.
  - After 5 attempts, status moves to `dlq`.

- Graceful shutdown:
  - Send SIGTERM to backend during retries → process exits cleanly within ~5s, no unhandled promise rejections.

### Commit
```
Phase 3: webhook delivery with retry, DLQ, and graceful shutdown
```

---

## Phase 4: Frontend Dashboard

### Preconditions
- `git log --oneline` shows `Phase 3:` but no `Phase 4:`.
- Backend POST/GET endpoints work and webhook trigger endpoint works.

### Goal
Visiting `http://localhost:5173/properties/<PROP_ID>/renewal-risk` shows a table of flagged residents with risk tier color coding, expandable signals, and a working "Trigger Renewal Event" button per row. Loading and error states render.

### Tasks

1. Create `src/api/client.ts` — fetch wrapper. Reads `VITE_API_BASE_URL`. Throws `ApiError` on non-2xx. Exposes:
   - `getRenewalRisk(propertyId)` → GET
   - `calculateRenewalRisk(propertyId, asOfDate)` → POST
   - `triggerRenewalEvent(propertyId, residentId)` → POST

2. Create `src/hooks/useRenewalRisk.ts` — `useEffect` fetches `getRenewalRisk` on mount. If 404, falls back to `calculateRenewalRisk` with today's date. Returns `{ data, loading, error, refetch }`.

3. Create `src/components/RiskTable.tsx`:
   - Props: `flags`, `onTrigger(residentId)`.
   - Renders a table with columns: Resident, Unit, Days to Expiry, Risk Score, Tier, Signals, Action.
   - Tier cell uses background color: `high` red (#fee2e2 / #b91c1c text), `medium` amber (#fef3c7 / #b45309), `low` green (#dcfce7 / #166534).
   - Each row has a chevron toggle that expands a sub-row showing the `signals` JSON as a definition list (key: value pairs, formatted readably).
   - Action cell has a button that calls `onTrigger`. Button shows three states: idle ("Trigger Renewal Event"), pending ("Sending..."), success ("Sent ✓"). Disable while pending.

4. Create `src/pages/RenewalRisk.tsx`:
   - Read `propertyId` from `window.location.pathname.split('/')[2]` with a fallback error if missing.
   - Use `useRenewalRisk(propertyId)`.
   - Loading: render a centered "Loading..." with a CSS spinner.
   - Error: render a red banner with the error message and a Retry button.
   - Empty (no flags): render "No residents currently flagged."
   - Otherwise: render a header with property summary (`<h1>Renewal Risk</h1>`, subtitle showing "X flagged of Y residents"), then `<RiskTable>`.

5. Create `src/App.tsx` that handles a single client-side check: if path matches `/properties/:id/renewal-risk` render `<RenewalRisk>`, else render a tiny landing instruction page ("Visit /properties/&lt;id&gt;/renewal-risk").

6. Create `src/index.css` with a minimal but intentional stylesheet: system font stack, a container max-width 1100px, table styling with subtle borders and hover states, button styling, the three tier color tokens.

### Verification

- `cd frontend && npm run dev` → starts on 5173.
- Navigate to `http://localhost:5173/properties/<PROP_ID>/renewal-risk`.
- Page loads showing the flagged residents from Phase 2.
- Risk tier cells are color-coded (Jane red, Bob amber, etc.).
- Clicking a chevron expands signals.
- Clicking "Trigger Renewal Event" → button shows "Sending..." → "Sent ✓". Mock RMS logs the delivery in the backend terminal within 2s.
- Stopping the backend and reloading the page → red error banner with retry button. Restart backend, click retry → loads.
- No errors in browser console.

### Commit
```
Phase 4: renewal risk dashboard
```

---

## Phase 5: Operational Endpoints + README

### Preconditions
- `git log --oneline` shows `Phase 4:` but no `Phase 5:`.
- All previous verifications still pass.

### Goal
Webhook health endpoint and DLQ requeue endpoint exist. README documents architecture, design decisions, edge cases, production hardening, AI assistance, and testing.

### Tasks

1. Add `GET /api/v1/admin/webhooks/health` → returns:
   ```json
   {
     "counts": { "pending": N, "in_flight": N, "delivered": N, "dlq": N },
     "oldestPendingAgeSeconds": N | null,
     "recentFailureRate": 0.0 to 1.0
   }
   ```
   Implement as two SQL queries: one `GROUP BY status` count, one for oldest pending and recent (last hour) failure ratio.

2. Add `POST /api/v1/admin/webhooks/:deliveryStateId/retry`:
   - Look up the delivery state row. 404 if missing.
   - If status is not `dlq`, return 409 with message "only DLQ entries can be manually retried".
   - Otherwise update: `status='pending'`, `attempt_count=0`, `next_retry_at=now()`, `last_error=null`. Return 200 with the updated row.

3. Fill in `README.md`:

   - **Quick Start** (already from Phase 0): refine to include all commands in order.

   - **Architecture**: ASCII diagram showing API ⇄ Postgres ⇄ Worker ⇄ RMS. One paragraph explaining: API writes events to DB, worker polls DB for pending deliveries, worker calls RMS, RMS posts back idempotency-aware acknowledgement.

   - **Design Decisions**:
     - Why append-only `risk_calculation_runs` (audit trail, idempotency via unique constraint, free history).
     - Why partial indexes on `webhook_delivery_state(next_retry_at) WHERE status='pending'` and `leases(...) WHERE status='active'`.
     - Why JSONB for signals (flexible signal evolution without migration).
     - Why deterministic `event_id` (idempotency at the create boundary, not just delivery).
     - Why in-process worker with `FOR UPDATE SKIP LOCKED` — explain that the same code runs unchanged with N worker processes; the durability and concurrency guarantees come from Postgres, not from the runtime topology. Note that this is simpler than Redis/Bull for the take-home scope while preserving the operational shape.

   - **Edge Cases Handled**:
     - Month-to-month leases (treated as 30 days to expiry).
     - Missing market rent (signal dropped, weights renormalized).
     - Expired leases (filtered out at the query level).
     - Concurrent batch triggers (unique constraint on `(property_id, as_of_date)`).
     - Duplicate event triggers (deterministic `event_id` + unique constraint).
     - Worker crash mid-delivery (`in_flight` rows are claimed by next worker via `SKIP LOCKED` — although note: a stuck `in_flight` would need a sweeper; document as a known gap).

   - **Production Hardening (not implemented)**:
     - Separate worker pod/process for resource isolation and independent scaling.
     - HMAC-SHA256 request signing: `X-Signature: sha256=<hex>` header where the signature is HMAC of the raw body using a per-tenant shared secret. RMS validates by recomputing.
     - Stuck `in_flight` sweeper (mark rows back to `pending` if `last_attempt_at` older than threshold).
     - DLQ alerting (PagerDuty when DLQ depth crosses threshold).
     - Circuit breaker on RMS endpoint after consecutive failures.
     - Distributed tracing (OpenTelemetry — note relevant experience).
     - Multi-tenant rate limiting on the trigger endpoint.

   - **AI Assistance**: Be specific. Example: "Used Claude for the initial CTE query draft (refined the delinquency window logic by hand), the migration scaffolding, and the React table boilerplate. Designed the worker loop, idempotency strategy, and scoring weights manually with Claude as a sounding board."

   - **Testing**: Adapt the manual testing workflow from `seed_and_testing.md` to match the actual endpoints. Include the failure-rate environment variable trick for testing retries. Document the two admin endpoints.

### Verification

- `curl http://localhost:3000/api/v1/admin/webhooks/health` returns valid JSON with the documented shape.
- After triggering a DLQ via `MOCK_RMS_FAILURE_RATE=1.0`:
  - `psql $DATABASE_URL -tc "select id from webhook_delivery_state where status='dlq' limit 1"` returns an id.
  - `curl -X POST http://localhost:3000/api/v1/admin/webhooks/<ID>/retry` returns 200.
  - The state row's `status` is back to `pending` and `attempt_count` is 0.
- `README.md` contains all sections listed above with non-placeholder content.

### Commit
```
Phase 5: operational endpoints + README
```

---

## Done

After Phase 5 commits, the project is feature-complete per the spec. No further phases are required.

If the user requests additional polish, candidates (in rough order of value): tier filter on the dashboard, sortable columns, a small Jest suite for the scoring function, a stuck-`in_flight` sweeper, request signing implementation. None are required.

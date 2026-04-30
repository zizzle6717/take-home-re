# CLAUDE.md

Operating manual for Claude Code working in this repository. This file is auto-loaded into context every session. `PLAN.md` is the build sequence; this file is the conventions and workflow.

---

## Project

Renewal risk detection system. Backend (Node + TypeScript + Express + Knex), Postgres, React + Vite frontend, in-process webhook worker. Containerized via docker-compose. Spec lives in `renewal_risk_takehome.md` and `seed_and_testing.md` (do not edit these — they are spec inputs).

---

## Source of truth

`PLAN.md` is the build plan. It defines five phases, each with explicit Preconditions, Tasks, Verification, and a fixed Commit message format `Phase N: <description>`.

Do not edit `PLAN.md` unless the user explicitly asks.

---

## Default workflow: phase advance

When the user's request is to "build", "continue", "do the next phase", or anything that implies progress on the build:

1. Read `PLAN.md` fully if not already in context this session.
2. On the very first session in this repo, also read the two spec markdown files in repo root.
3. Run `git log --oneline`. Identify the lowest-numbered phase whose `Phase N:` commit is not present. That is the current phase.
4. Run that phase's Preconditions checks. Repair any failures before building.
5. Execute Tasks in order.
6. Run Verification checks. All must pass before committing.
7. Commit with the exact message specified in the phase.
8. Stop. Report what was completed. Do not auto-proceed to the next phase.

If Verification fails on a phase whose commit already exists in git history, treat the verification as authoritative and repair the implementation. Do not assume a green commit means working code.

---

## Alternate workflow: targeted task

When the user asks for a specific change that is not a phase advance (a small fix, a new endpoint, refactor a function, debug a failure):

1. Do not run the Session Start Protocol.
2. Make the change scoped to the request.
3. Do not refactor adjacent code, do not "improve" earlier phases, do not run unrelated verification.
4. If the change touches conventions in this file or `PLAN.md`, surface the conflict before proceeding rather than silently overriding.

---

## Locked technical decisions

These are settled. If a task seems to require violating one of these, stop and surface the conflict — do not silently work around them.

- PostgreSQL 15. Knex with TypeScript for migrations and query building. Drop to raw SQL for the scoring CTE only.
- Express + TypeScript, strict mode. Zod for request validation.
- Vite + React + TypeScript. No router. No UI library. No Tailwind. Vanilla CSS in a single stylesheet.
- Webhook worker is in-process, polled via `setInterval`, claims rows with `SELECT ... FOR UPDATE SKIP LOCKED`. No Redis, no BullMQ, no child_process, no separate worker entrypoint.
- Mock RMS lives in the same Express app at `/__mock_rms/webhook`, gated by `NODE_ENV !== 'production'`.
- No auth. Webhook signing is documented in README only, not implemented.
- Node 20 LTS.

---

## Repository layout

```
backend/
  src/api/         Express handlers
  src/db/          Knex client
  src/scoring/     Pure scoring logic + signal SQL
  src/webhooks/    Enqueue, worker, deliver, mock RMS
  src/index.ts     Boot
  migrations/      Knex .ts migrations
  seeds/           Knex .ts seeds
frontend/
  src/api/         Fetch wrapper
  src/components/  Reusable UI
  src/hooks/       Data hooks
  src/pages/       Route components
```

Match this layout. Do not introduce parallel directories (`lib/`, `utils/`, etc.) without justification.

---

## Common commands

```
# Database
docker-compose up -d postgres
docker-compose ps
psql $DATABASE_URL -c "<sql>"

# Backend
cd backend && npm install
npm run dev          # ts-node-dev
npm run build        # tsc
npm run migrate      # knex migrate:latest
npm run seed         # knex seed:run

# Frontend
cd frontend && npm install
npm run dev          # vite on :5173

# Container build
docker build -t renewal-backend ./backend
```

---

## Conventions

- **Commits:** Phase commits use the exact format from `PLAN.md`. Targeted-task commits use Conventional Commits (`fix:`, `feat:`, `refactor:`, `chore:`) with a scoped description.
- **Migrations:** Numeric prefix (`001_`, `002_`...). Forward-only logic in `up`, full reversal in `down`. Never edit a migration after it has been committed; add a new one instead.
- **SQL:** Parameterized via Knex bindings. No string interpolation of user input. Indexes get their own migration with comments explaining the access pattern they serve.
- **Error handling:** Express handlers return `{ error: { code, message } }` with appropriate HTTP status. Throw typed errors from services; the global handler maps them.
- **Logging:** Structured (key=value or JSON) for webhook delivery. Plain log messages elsewhere. No `console.log` left in committed code outside of intentional structured logs.
- **Env vars:** All read through a single `src/config.ts` that validates with Zod at boot. No `process.env.X` scattered through handlers.
- **Types:** Strict mode is on. No `any`. Use `unknown` and narrow.

---

## What not to do

- Do not add dependencies casually. If a new dep is genuinely needed, surface why before adding.
- Do not introduce ORMs (TypeORM, Prisma, Sequelize, Drizzle). Knex is the choice.
- Do not introduce a router on the frontend. Path parsing from `window.location` is sufficient.
- Vitest is the backend test framework (see `PLAN.md` "Testing Approach"). New pure logic and HTTP handlers are written test-first; integration tests for DB-backed code share the dev database and clean up after themselves. Don't reach for additional frameworks (Jest, Mocha) — Vitest is the locked choice.
- Do not edit `PLAN.md`, `renewal_risk_takehome.md`, `seed_and_testing.md`, or `starter_schema.sql` without explicit user direction.
- Do not refactor code from earlier phases when working on a later phase. If you spot a real bug, surface it; don't silently rewrite.
- Do not skip verification because the code "looks right." Run the commands.
- Do not commit `.env`, `node_modules/`, `dist/`, or build artifacts.

---

## Ambiguity handling

Per the spec: if something is ambiguous, make a decision and document it (in code comments or README). Do not block on clarification for design choices that the spec leaves open. Do block and ask if the request itself is unclear or contradicts a locked decision.

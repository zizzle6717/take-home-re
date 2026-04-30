---
name: phase-review
description: Peer-review the latest `Phase N:` commit against PLAN.md goals and CLAUDE.md locked decisions. Run after `phase-advance` finishes a phase, before starting the next. Output is a triaged finding list (blocking / recommended / nit) — review only, no auto-fix.
---

# phase-review — quality review of the just-shipped phase

`PLAN.md`'s Verification block confirms the code *works*. This skill confirms the code is *good* — that it stayed in scope, respected the locked decisions, followed test-first discipline, and avoided the anti-patterns in `CLAUDE.md`'s "What not to do" list.

## When to invoke

- Right after a `Phase N: <description>` commit lands (typically immediately after `phase-advance` reports completion).
- Before starting the next phase. Findings can be addressed as a follow-up commit on the current phase or rolled into the next.

Do NOT invoke during a phase build — the diff isn't stable yet. Wait for the commit.

## Independence option

The session that built the phase has confirmation bias toward its own choices. For an independent review, delegate to a `general-purpose` subagent via the `Agent` tool with a self-contained prompt:

> Review the latest `Phase N: ...` commit at HEAD against PLAN.md (the `Phase N` block) and CLAUDE.md (Locked decisions, Conventions, What not to do). Output a triaged finding list — blocking, recommended, nit. Don't auto-fix. Use the `phase-review` skill's procedure.

The procedure below is the same whether run directly or via subagent.

## Procedure

### 1. Establish review surface

```bash
git log --oneline -1                # confirm HEAD is the phase commit
git show --stat HEAD                # files changed
git diff HEAD^ HEAD                 # full diff
```

The review surface is the diff at HEAD. Anything outside that diff is out of scope.

### 2. Re-read the spec

- The current phase's **Goal**, **Tasks**, **Verification**, and **Commit** blocks in `PLAN.md`.
- `CLAUDE.md`'s "Locked technical decisions", "Conventions", and "What not to do" sections.

Hold the diff against these as the spec.

### 3. Universal checks (run for every phase)

**Scope drift**
- Does the diff change anything *outside* the files PLAN.md's Tasks block names? Is each such change clearly required by a task?
- Did the diff modify earlier phases' code without surfacing why? CLAUDE.md: "Do not refactor code from earlier phases when working on a later phase."
- Did the diff start work on a *later* phase (e.g., a webhook helper landing in the schema phase)?

**Locked decisions**
- New dependency in `package.json`? Justified by a task, or casual addition?
- Any ORM (TypeORM, Prisma, Sequelize, Drizzle)? → blocking.
- Frontend router (`react-router`, etc.)? → blocking.
- Tailwind / UI library / styled-components / CSS-in-JS? → blocking.
- Raw SQL outside `src/scoring/loadSignals.ts`? Knex query builder is the default elsewhere.
- Zod missing on a new request body? → blocking.
- `any` types or unchecked `unknown`? → recommended.
- `process.env.X` outside `src/config.ts`? → recommended.
- `console.log` left in committed code (outside intentional structured webhook logs)? → recommended.

**Test-first evidence**
- Each new pure function or HTTP handler has a sibling `*.test.ts`?
- Test assertions match the concrete cases PLAN.md called out for that target (scoring's six cases, eventId's three cases, backoff's five cases, etc.).
- Assertions are specific (`toEqual`/`toBe` with concrete values) — not hollow (`.toBeDefined()`, `.toBeTruthy()`). Hollow assertions are a smell.
- Tests live alongside source (`src/**/*.test.ts`), not in a parallel `tests/` tree.

**Error handling and security**
- All SQL parameterized via Knex bindings or `:named` params; no string interpolation of user input.
- Path params validated (UUIDs where the schema expects UUIDs).
- Error responses use `{ error: { code, message } }` shape with appropriate HTTP status.
- No leaked secrets, no `.env` committed, no hard-coded credentials. (For deeper coverage, the built-in `/security-review` skill is also available.)

**Code surface**
- New files in expected directories (`src/api/`, `src/db/`, `src/scoring/`, `src/webhooks/`)? Any new top-level dir like `lib/` or `utils/` without justification? → recommended challenge.
- Comments only where the WHY is non-obvious (no WHAT-restating, no "added for X" provenance, no docstring filler).
- No `// @ts-ignore`, no `any`.

### 4. Phase-specific checks

#### Phase 1 — Schema + Seed

- Migrations numerically prefixed (`001_`, `002_`, ...) and forward-only in `up`.
- Each migration's `down` truly reverses `up` (drop tables in FK-reverse order; drop indexes).
- Partial indexes from migration 004 are actually partial (`WHERE status = 'active'`, `WHERE status = 'pending'`), not full.
- `pgcrypto` enabled before any `gen_random_uuid()` default.
- Seed produces the documented counts: 4 residents, 1 month-to-month lease, 5 ledger rows for John Smith, 1 renewal offer for Alice.
- `seed.test.ts` is idempotent (truncates before insert or uses `ON CONFLICT`).
- All 10 expected tables present (per `migrations.test.ts` against `information_schema.tables`).

#### Phase 2 — Risk Scoring API

- `calculateScore` weights are exactly 0.40 / 0.25 / 0.20 / 0.15.
- Boundary conditions: 0 days → daysScore 100; 90+ days → daysScore 0.
- Tier boundaries: score 70 → high, 40 → medium, 39 → low (off-by-one check).
- `market_rent` null path renormalizes to 0.47 / 0.29 / 0.24 (proportional to 40/25/20) — documented in code comments.
- Idempotency anchor: unique `(property_id, as_of_date)` constraint actually used (ON CONFLICT or follow-up SELECT after insert).
- POST handler wraps signal load + score compute + inserts in a single transaction.
- Response shape matches spec: `{ propertyId, calculatedAt, totalResidents, flaggedCount, riskTiers, flags }`.
- `flags` excludes `low` tier (per PLAN.md).
- Validation rejects mismatched `propertyId` between URL param and body.

#### Phase 3 — Webhook Delivery

- `computeEventId` is deterministic — same inputs → same hex output, `evt_` prefix.
- Worker uses `SELECT ... FOR UPDATE SKIP LOCKED` inside a transaction to claim due rows.
- Worker `tick()` guards against overlapping ticks with an `inFlight` flag.
- Backoff: `2^(attempt_count - 1)` → 1, 2, 4, 8, 16 seconds.
- DLQ transition: status moves to `dlq` when `attempt_count >= max_attempts` (default 5).
- Delivery POST sets `Idempotency-Key: <eventId>` header and a 5s timeout.
- Mock RMS gated by `NODE_ENV !== 'production'` (mounted under `/__mock_rms` only in dev).
- `SIGTERM`/`SIGINT` handlers call `worker.stop()` then `server.close()` and exit cleanly.
- Renewal-event endpoint returns 202 for both `queued` and `already_exists` (not 200 / not 201).
- Structured delivery log includes `{ eventId, attempt, statusCode, latencyMs, outcome }`.
- Worker tests cover the SKIP LOCKED concurrency case (two ticks claim different rows).

#### Phase 4 — Frontend Dashboard

- No router added — path is read from `window.location.pathname`.
- No Tailwind, no UI library, no CSS-in-JS.
- Single vanilla CSS stylesheet (`src/index.css`).
- Three states all render: loading (centered spinner), error (red banner with retry), empty ("No residents currently flagged.").
- Tier color tokens match the plan: high red (#fee2e2 / #b91c1c), medium amber (#fef3c7 / #b45309), low green (#dcfce7 / #166534).
- Trigger button has three states: idle ("Trigger Renewal Event"), pending ("Sending..."), success ("Sent ✓"), with disable-during-pending.
- Fallback to `calculateRenewalRisk(today)` when initial GET returns 404.
- Browser console is clean on the documented happy path.
- No frontend tests added (per PLAN.md's intentional no-Vitest-on-frontend note); if any are added, they're justified by nontrivial client-side logic.

#### Phase 5 — Operational Endpoints + README

- Health endpoint shape matches: `{ counts: { pending, in_flight, delivered, dlq }, oldestPendingAgeSeconds, recentFailureRate }`.
- Retry endpoint: 404 for unknown id, 409 for non-DLQ rows, 200 + updated row for DLQ rows.
- Retry resets `attempt_count=0`, `next_retry_at=now()`, `last_error=null`, `status='pending'`.
- README sections present AND non-placeholder: Quick Start, Architecture, Design Decisions, Edge Cases, Production Hardening, AI Assistance, Testing.
- Production Hardening section names: separate worker process, HMAC-SHA256 signing scheme, stuck-`in_flight` sweeper, DLQ alerting, circuit breaker, distributed tracing, multi-tenant rate limiting.
- AI Assistance section is specific (named Claude usage), not generic boilerplate.

### 5. Triage findings

Categorize every finding:

- **Blocking** — violates a locked decision, breaks the phase's stated Goal, introduces a security issue, or hides a correctness bug. Must be fixed before the next phase.
- **Recommended** — measurable quality issue but not load-bearing for the phase Goal. Worth fixing now or as a quick follow-up commit.
- **Nit** — style preference with no rule behind it. Default to omitting. If you include any, mark them clearly skippable.

Prefer fewer, sharper findings over a dump.

### 6. Report

Single-message report in this shape:

```
# Phase N review

**Verdict:** ship | fix-recommended | blocking-issues
**Scope check:** <one line — did the diff stay in scope?>

## Blocking
- [path:line] <one-line issue>. Why: <reason>. Fix: <one-liner>.

## Recommended
- [path:line] ...

## Nit (skip if you want)
- [path:line] ...
```

If there are zero blocking and zero recommended findings, say so plainly: "No issues found. Phase N is good to ship." Don't manufacture findings.

## Hard rules

- **Don't auto-fix.** The skill names issues; the user decides what to act on. (Trivial typo fixes the user invites are fine; otherwise list and stop.)
- **Don't expand scope.** Review the phase commit at HEAD only — not the whole codebase, not earlier phases, not the next phase.
- **Don't relitigate locked decisions.** If a locked choice feels wrong, surface it as a question for the user, not as a finding.
- **Don't repeat phase Verification.** PLAN.md's Verification block ran during `phase-advance`. This skill catches what Verification can't (drift, hollow tests, weak abstractions, scope creep).
- **Skip the Nit section by default.** Most reviews shouldn't have nits. If you have more than two, you're nit-picking — drop them.

## Companion skills

- `phase-advance` — ships the phase that this skill then reviews.
- `pg` — for any DB-state checks during review (rare; review reads code, not DB).
- `tdd-step` — referenced when checking test-first evidence.
- Built-in `/security-review` — deeper security pass; run alongside `phase-review` if the phase touched auth-adjacent code (Phase 3, Phase 5).

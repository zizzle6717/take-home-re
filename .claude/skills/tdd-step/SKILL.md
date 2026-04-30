---
name: tdd-step
description: Enforce the test-first cycle for one function or HTTP handler — scaffold the *.test.ts, observe RED, implement, observe GREEN. Use when PLAN.md says "test-first" or whenever adding a new pure function, scoring helper, webhook helper, or HTTP route handler.
---

# tdd-step — RED → GREEN, one target at a time

`PLAN.md`'s **Testing Approach** is explicit: write the test before the code, observe it fail, then implement. This skill makes that loop concrete and refuses to skip the RED observation.

## When this skill applies

Invoke for any of these:
- New pure function in `backend/src/scoring/` (e.g., `calculateScore`, weight renormalization).
- New webhook helper in `backend/src/webhooks/` (e.g., `computeEventId`, `computeNextRetryDelaySeconds`, payload shaping).
- New Express handler in `backend/src/api/` — happy path + one validation failure + one not-found per endpoint.
- The signal-loader SQL in `backend/src/scoring/loadSignals.ts` (integration test against the seeded DB).
- Webhook worker state-machine transitions (integration tests against real Postgres).
- The two admin endpoints in Phase 5.

## When this skill does NOT apply

- Trivial getters / DTO mapping with no branching.
- Framework wiring (Express middleware, Knex config, Vitest setup files).
- Frontend components in Phase 4 — `PLAN.md` notes intentional no-Vitest on the frontend.
- Migrations and seeds — these are verified by the phase-level integration test (`migrations.test.ts`, `seed.test.ts`), not per-function.

## Inputs

When invoking, the calling context (Claude or the user) supplies:

1. **Target file path** — e.g., `backend/src/scoring/calculateScore.ts`.
2. **Behavior summary** — concrete assertions the function must satisfy. Examples from `PLAN.md`:
   - "Jane Doe inputs (45 days, not delinquent, no offer, $1400 vs $1600) → score in [80, 90], tier 'high'."
   - "computeNextRetryDelaySeconds: 1→1, 2→2, 3→4, 4→8, 5→16."
   - "POST happy path: returns 200, response contains Jane Doe in `flags` with tier `high`."

If only a vague summary is given (e.g., "score residents"), refuse to proceed and ask for the concrete assertions before writing the test. The whole point of test-first is that the spec is written down before the code.

## Procedure

### 1. Write the test FIRST

Create or update the corresponding `*.test.ts` next to the target:
- `backend/src/scoring/calculateScore.ts` → `backend/src/scoring/calculateScore.test.ts`
- `backend/src/api/renewalRisk.ts` → `backend/src/api/renewalRisk.test.ts`

Inside the test file:
- Use Vitest (`describe`, `it`, `expect`) — locked framework choice.
- Import from the target file, even if the function or file doesn't exist yet. The TypeScript compile error IS the first form of RED.
- Encode every assertion from the behavior summary as a separate `it(...)` block when practical, so failures point at the specific case.
- For DB-backed tests: run the seed in `beforeAll` (or use a transaction-per-test pattern) and clean up. Use the `pg` skill conventions only for ad-hoc DB inspection — tests should go through the Knex client.
- For HTTP handler tests: boot Express in-process via `supertest`. Cover the happy path, one validation failure, and one not-found per endpoint.

Do NOT write the implementation in this step. The test must reference symbols that don't yet exist or don't yet behave correctly.

### 2. Run the test and observe RED

```bash
cd backend && npm test -- <relative-path-to-test-file>
```

Expected outcomes that count as RED:
- TypeScript / module-resolution error (function or file doesn't exist) ✅
- Assertion failure (function exists but returns the wrong value) ✅

Capture and report the failure output before moving on.

If the test PASSES on the first run, the test is wrong — it isn't actually exercising the intended behavior. Go back to step 1 and tighten the assertions. Common causes: assertion compares against `expect.anything()`, uses `.toBeDefined()` on a value that was always defined, or imports a stub already in place.

### 3. Implement the minimum to go GREEN

Write only enough code in the target file to make the failing assertions pass.

- No premature abstractions, no helpers "for the next case," no extra error paths the assertions don't require.
- Match the locked technical decisions in `CLAUDE.md` and `PLAN.md` — no new deps, no ORMs, no `any`, strict mode types.
- Comments only when the WHY is non-obvious (per CLAUDE.md / global tone guidance).

### 4. Run the test and observe GREEN

```bash
cd backend && npm test -- <relative-path-to-test-file>
```

Expected: every assertion passes. If anything still fails, iterate on the **implementation** — never modify the test to make it pass. The test is the spec; the implementation is the variable.

If you discover the test itself encodes a wrong expectation (rare but possible — e.g., a typo in an expected value), STOP and surface to the user before modifying the test. Don't silently weaken the assertion.

### 5. Optional: refactor

Only after GREEN. The test stays green throughout. Common refactors:
- Extract repeated arithmetic into a named helper.
- Replace inline magic numbers with named constants.
- Pull repeated test fixtures into `beforeEach`.

## Hard rules

- **Test before implementation, in separate edits.** Never write the test and the implementation in the same edit — that bypasses the RED observation by construction.
- **Observe RED on a real test run.** "It would fail" is not RED. Run the test and see the failure.
- **Don't modify the test to make it pass.** If the test is wrong, surface it; don't quietly relax it.
- **One target per invocation.** If there are five functions to write, run this skill five times. Don't bundle.
- **Integration tests still go test-first.** DB-backed and HTTP tests follow the same RED→GREEN cycle; they just take longer and require the dev DB up (`docker compose up -d postgres`).

## Concrete example: Phase 2 `calculateScore`

1. Write `backend/src/scoring/calculateScore.test.ts` with the six cases listed in `PLAN.md` Phase 2 → Tasks → step 2 (Jane high, Alice low, Bob medium/high, boundary cases at 0 days and 90+ days, market_rent=null renormalization, tier boundaries 39/40/69/70).
2. Run `cd backend && npm test -- src/scoring/calculateScore.test.ts` — expect "Cannot find module './calculateScore'" or similar. That's RED.
3. Write `backend/src/scoring/calculateScore.ts` implementing the four-signal weighted formula from `PLAN.md` Phase 2 → Tasks → step 3.
4. Re-run the test. Iterate until all six cases pass.
5. Commit as part of the Phase 2 `Phase 2: renewal risk scoring API` commit (do not commit mid-phase).

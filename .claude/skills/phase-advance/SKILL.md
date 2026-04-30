---
name: phase-advance
description: Execute the next unbuilt phase from PLAN.md — check preconditions, run tasks, verify, commit with the exact message, then stop. Use when the user says "build", "next phase", "continue", or anything that implies progressing the build sequence.
---

# phase-advance — one phase per invocation

Codifies the workflow defined in `CLAUDE.md` ("Default workflow: phase advance") and `PLAN.md` ("Session Start Protocol"). Treat this skill as the source of truth for *how* to advance; PLAN.md remains the source of truth for *what* each phase does.

## When to invoke

The user's request implies build progress: "build", "do the next phase", "continue", "advance", "let's keep going", or naming a specific phase number.

Do NOT invoke for targeted bug fixes, small refactors, or open-ended questions about the codebase. Those follow the "Alternate workflow: targeted task" path in `CLAUDE.md`.

## Procedure

### 1. Load context

- Read `PLAN.md` fully if not already in this session's context.
- On the very first session in this repo, also read `renewal_risk_takehome.md` and `seed_and_testing.md` (spec inputs — never edit).

### 2. Identify the current phase

Run:
```bash
git log --oneline
```

Phase commits use the exact format `Phase N: <description>`. The current phase is the lowest-numbered phase whose commit is not present.

If all 5 phases are committed, stop and report "all phases complete." Do not invent a Phase 6.

### 3. Run preconditions

Read the **Preconditions** block for the current phase in `PLAN.md`. Run each check.

If any precondition fails:
- Do NOT proceed with the phase.
- Surface the failure to the user with the actual output.
- Repair only if the fix is small, obvious, and clearly inside the previous phase's scope. Otherwise ask.

A common failure mode: a previous phase's verification regressed (e.g., tests broken, schema drifted). Treat verification as authoritative — repair the implementation, do not weaken the check.

### 4. Execute Tasks in order

Read the **Tasks** block for the current phase in `PLAN.md`. Execute tasks in the listed order — do not reorder for convenience.

When a task is flagged "Test-first" or "write the test before the code," invoke the `tdd-step` skill so the RED→GREEN cycle is enforced rather than skipped.

Use the `pg` skill for any psql checks during task execution (the host has no `psql` binary).

### 5. Run Verification

Read the **Verification** block. Run every command listed and confirm the actual output matches the expected output described in the plan.

`cd backend && npm test` is mandatory in every phase from Phase 1 onward — a phase is not complete until its tests are green, even if manual `curl` checks succeed.

If any verification fails:
- Do NOT commit.
- Report which check failed, the actual output, and the expected output.
- Repair the implementation. Do not weaken the verification or comment-out failing assertions.

### 6. Commit

Stage only the files relevant to this phase. Use the EXACT commit message from the phase's **Commit** block. Examples:
- Phase 1 → `Phase 1: database schema + seed`
- Phase 2 → `Phase 2: renewal risk scoring API`

Commit message format is locked. Do not paraphrase, do not append scope tags, do not add trailers other than the standard `Co-Authored-By` line if the harness adds one.

### 7. Stop

Report:
- Which phase was completed.
- A one-line summary of what shipped.
- What the next phase is (by name from PLAN.md), without starting it.

Do NOT auto-advance to the next phase. The user must explicitly ask.

## Hard rules

- One phase per invocation. Never chain phases.
- Never edit `PLAN.md`, `renewal_risk_takehome.md`, or `seed_and_testing.md` unless the user explicitly says to.
- Never skip verification because the code "looks right." Run the commands.
- Never use `--no-verify`, `--no-gpg-sign`, or `git commit --amend` to work around hook or signing failures. Fix the underlying issue.
- If the verification reveals a regression in an already-committed earlier phase, treat verification as authoritative and repair before continuing the current phase.

## Companion skills

- `pg` — run SQL checks against the dev database (verifications use psql heavily).
- `tdd-step` — enforce test-first discipline for new pure functions and HTTP handlers.

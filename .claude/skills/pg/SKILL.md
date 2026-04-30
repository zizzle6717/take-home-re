---
name: pg
description: Run SQL against the dev Postgres via `docker compose exec`. The host has no psql binary, so this is the canonical wrapper for every psql check (phase verifications, ad-hoc debugging, seed inspection). Use whenever a phase says "run psql" or you need to inspect DB state.
---

# pg — psql via docker compose exec

The dev database runs in the `postgres` service of `docker-compose.yml` (container name `renewal_risk_postgres`). The host machine has **no `psql` binary** and `DATABASE_URL` points at host port `5434` which is irrelevant when going through the container. Always use the canonical commands below.

## Canonical commands

### One-off SQL with header + formatting (good for `\dt`, `\di`, multi-row results)

```bash
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "<SQL>"
```

### One-off SQL, tuples-only, no header (good for capturing a single value into a shell var)

```bash
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "<SQL>"
```

`-t` = tuples only, `-A` = unaligned, `-c` = run command and exit. Combined: clean stdout suitable for `$(...)` capture.

### Meta-commands

```bash
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "\dt"   # list tables
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "\di"   # list indexes
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "\d residents"  # describe table
```

### Capturing a value for use in subsequent curl calls

```bash
PROP_ID=$(docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select id from properties limit 1")
echo "PROP_ID=$PROP_ID"
```

## Why these flags

- **`-T`** — disable pseudo-TTY allocation. Required when calling from non-interactive contexts (Claude Code's Bash tool); without it, psql output may include TTY control characters that break parsing.
- **`-U postgres -d renewal_risk`** — connection params, matching `docker-compose.yml`. Do NOT pass `$DATABASE_URL` from the host — it points at host port `5434`, which the container doesn't expose internally and which doesn't propagate as an env var inside `docker compose exec` anyway.
- **`docker compose` (v2)** — the host has only the v2 plugin, never `docker-compose` (v1) and never `docker exec <container-name>` directly.

## Preconditions

Postgres must be up:
```bash
docker compose up -d postgres
docker compose ps  # confirm postgres status is "healthy"
```

If `docker compose ps` shows the container restarting or unhealthy, fix that before running SQL — the SQL won't help diagnose.

## Common verification queries used in PLAN.md

```bash
# Phase 1 — schema + seed
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "\dt"
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "\di"
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select count(*) from residents"
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select count(*) from leases where lease_type = 'month_to_month'"
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select count(*) from resident_ledger where resident_id in (select id from residents where last_name = 'Smith')"
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select count(*) from renewal_offers"

# Phase 2 — risk scoring run idempotency
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select count(*) from risk_calculation_runs where property_id = '<PROP_ID>'"

# Phase 3 — webhook delivery state
docker compose exec -T postgres psql -U postgres -d renewal_risk -c "select status, attempt_count from webhook_delivery_state order by created_at desc limit 5"
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select id from webhook_delivery_state where status='dlq' limit 1"

# Phase 5 — admin retry sanity
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select status, attempt_count from webhook_delivery_state where id='<ID>'"
```

## Quoting gotchas

- Single quotes inside the SQL are fine because the outer wrapper uses double quotes: `... -c "select * from x where y = 'z'"`.
- If the SQL itself contains double quotes (e.g., quoted identifiers), use a heredoc instead:
  ```bash
  docker compose exec -T postgres psql -U postgres -d renewal_risk <<'SQL'
  select * from "MyTable";
  SQL
  ```
- Don't use `$DATABASE_URL` in the SQL string — bash will try to expand it. Hard-code the connection params via `-U` and `-d`.

## What NOT to do

- ❌ `psql $DATABASE_URL -c "..."` on the host — the binary doesn't exist.
- ❌ `docker exec renewal_risk_postgres psql ...` — works but bypasses service-name resolution; prefer `docker compose exec postgres`.
- ❌ Omit `-T` — output may include TTY control characters and break parsing in piped contexts.
- ❌ `docker-compose` (v1) — not installed; use `docker compose` (v2 plugin).
- ❌ Open an interactive psql shell from Claude Code (`docker compose exec postgres psql ...` without `-c`) — non-interactive only.

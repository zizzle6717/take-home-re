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
npm test                              # vitest harness
npm run migrate                       # (Phase 1 onward)
npm run seed                          # (Phase 1 onward)
npm run dev                           # logs "Database connected" + "Server on :3000"

# 3. Verify the backend
curl http://localhost:3000/healthz    # {"status":"ok"}

# 4. Frontend (separate terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                           # http://localhost:5173

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

_(populated in Phase 5)_

## Design Decisions

_(populated in Phase 5)_

## Edge Cases Handled

_(populated in Phase 5)_

## Production Hardening (not implemented)

_(populated in Phase 5)_

## AI Assistance

_(populated in Phase 5)_

## Testing

_(populated in Phase 5)_

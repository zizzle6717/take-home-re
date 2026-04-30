# Renewal Risk Detection System

A take-home implementation of a renewal-risk detection system for the Residential Operating Platform (ROP). Scores residents 0–100 on lease-renewal risk, exposes a dashboard, and delivers renewal events to an external RMS with retries and a dead-letter queue.

## Quick Start

Prerequisites: Docker, Node 20.

```bash
# 1. Bring up Postgres (host port 5434 to avoid conflicts with other local pg)
docker compose up -d postgres
docker compose ps                     # verify postgres is "healthy"

# 2. Backend
cd backend
cp ../.env.example .env
npm install
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

The backend service is also defined in `docker-compose.yml` under the `full` profile (`docker compose --profile full up`); during development you typically want only Postgres in Docker and the backend running locally for fast iteration. Use `docker-compose` (legacy v1) interchangeably with `docker compose` (v2 plugin) — examples here use the v2 form.

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

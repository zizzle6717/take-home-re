# Frontend

Vite + React + TypeScript dashboard for the renewal-risk system. One page, one route, one fetch wrapper. No router, no UI library, no Tailwind — vanilla CSS in `src/index.css` per the locked technical decisions in `CLAUDE.md`.

For end-to-end setup (Postgres + backend), see the [root README](../README.md). This README is the per-package reference.

## Layout

```
src/
  pages/RenewalRisk.tsx     The /properties/:propertyId/renewal-risk page
  components/RiskTable.tsx  Sortable table with expandable per-row signals
  hooks/useRenewalRisk.ts   Data hook — wraps fetch, exposes loading/error/data
  api/client.ts             Typed fetch wrapper around the backend (ApiError, RiskResponse, …)
  App.tsx                   Path matcher — dispatches to RenewalRisk or shows usage
  main.tsx                  ReactDOM root
  index.css                 All styles
```

## Environment variables

Copy `.env.example` to `.env`:

| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:3000` | Backend origin. Trailing slash is stripped. |

Vite only exposes vars prefixed `VITE_` to the bundle.

## Scripts

```
npm run dev      # vite dev server on :5173
npm run build    # tsc + vite build -> dist/
npm run preview  # serve the built bundle for parity checking
```

## Routes

The app reads `window.location.pathname` directly — no react-router. Only one dynamic route is recognized:

```
/properties/<propertyId>/renewal-risk
```

Anything else renders a usage hint. Use the `propertyId` returned from a backend seed run, e.g.:

```bash
docker compose exec -T postgres psql -U postgres -d renewal_risk -tAc "select id from properties limit 1"
# -> open http://localhost:5173/properties/<that-id>/renewal-risk
```

## Behavior

On mount the page calls `GET /api/v1/properties/:propertyId/renewal-risk`. If the backend returns 404 (no run for this property yet), the hook automatically issues `POST …/renewal-risk/calculate` for today's date so first-load isn't stuck on "no data." Anything else is surfaced as an error with a Retry button. A **Recalculate** button in the header re-runs `POST …/calculate` for today on demand and refreshes.

Each row has a chevron that expands an inline definition list of the four scoring signals, plus a "Trigger Renewal Event" action that calls `POST …/residents/:id/renewal-events`. The button transitions through `Trigger Renewal Event → Sending… → Sent ✓` (or `Retry` on failure); per-row state is independent so multiple triggers can be in flight at once.

The page also exposes:

- A **tier filter chip group** (All / High / Medium) below the page header. Selecting a tier narrows the table; an explicit empty state explains "no rows match the filter" so the user can tell it apart from "zero flags."
- A **sortable Risk Score column header**. Clicking toggles desc ↔ asc with a directional arrow.

States the page renders explicitly:

- **Loading:** initial fetch, recalculate, and the auto-calculate fallback.
- **Error:** any non-2xx is mapped to `ApiError` (`code` + `message`) and shown with a Retry action.
- **Empty:** "No residents currently flagged" when a run exists but produced zero flags.

Risk tier badges are color-coded: red (high), amber (medium), green (low).

## Backend dependency

The frontend will not load data unless the backend is reachable at `VITE_API_BASE_URL`. Bring it up first:

```bash
# from repo root
npm run docker:dev:up
cd backend && npm run migrate && npm run seed && npm run dev
# then in another shell
cd frontend && npm run dev
```

CORS in dev is permissive: the backend's Express app reflects the request `Origin` and allows `GET`/`POST`/`OPTIONS` plus the `Idempotency-Key` header. The middleware is gated to `NODE_ENV !== 'production'`. Production would mount a real per-origin allowlist instead.

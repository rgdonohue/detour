# CLAUDE.md - Detour

## What this project is

Interactive routing map for Santa Fe with a click-to-set origin and click-to-set destination flow.

Current UX:

1. Load the app and center on the configured default location from `.env`.
2. First map click sets the origin.
3. Frontend requests `/api/area?miles=<preset>&origin=lon,lat` and renders the service area polygon.
4. Second map click sets the destination.
5. Frontend requests `/api/route?to=lon,lat&origin=lon,lat&miles=<preset>` and shows the shortest route, distance, duration, and within-threshold verdict.
6. After a route is shown, the next click starts over with a new origin.

The New Mexico State Capitol is still the default configured center and fallback origin, but it is no longer the only usable origin in the app.

## Read these first

- `README.md` - public-facing product and setup summary
- `docs/PRD.md` - current product framing and scope
- `docs/TECH_SPEC.md` - current API contract and implementation notes
- `docs/PROMPTS.md` - prompt patterns for repo-aware maintenance work
- `docs/LAUNCH_READINESS.md` - sequenced engineering work before posting publicly (rate limits, route cache, ORS hosting); read before touching `apps/api/main.py`, `apps/api/ors_client.py`, or `apps/api/cache.py`

## Architecture

- Frontend: React + TypeScript + Vite + MapLibre GL JS in `apps/web/`
- Backend: FastAPI in `apps/api/`
- Routing provider: OpenRouteService
- Service area: ORS isodistance polygons, parameterized by clicked origin and selected miles
- Optional offline asset: `scripts/generate_route_polygon.py` can precompute a route-based polygon for the configured default origin

## Current implementation notes

- `apps/web/src/App.tsx` hardcodes mileage presets to `1`, `3`, and `5`.
- `apps/web/src/components/Map.tsx` owns the interaction state machine: `set-origin -> set-destination -> route-shown`.
- `apps/web/src/hooks/useServiceArea.ts` does not fetch anything until an origin has been chosen.
- `apps/web/src/hooks/useRouteCheck.ts` passes `origin` and `miles` to the API so the verdict matches the current click state.
- `apps/api/main.py` still exposes `/api/config` using the configured default origin. That endpoint is for initialization and recentering, not proof that the UI origin is fixed.
- The precomputed `area_<miles>mi_route.geojson` cache is only considered when `/api/area` is called without an `origin` query param. The current UI sends `origin` after the first click, so normal interactive use relies on dynamic isochrones.

## Invariants

1. `1 mile = 1609.344 meters`. Do not round the conversion.
2. ORS directions must use `preference="shortest"`.
3. ORS service-area requests must use `range_type="distance"`.
4. The route verdict is authoritative; the polygon is only a visual guide.
5. Keep the current click flow intact unless the task explicitly changes product behavior.
6. `ORS_API_KEY` is server-side only. No endpoint may return it to the browser, log it, or include it in any response body. `/api/config` is the canonical place this could regress — guard it.

## Style

Warm earth tones, restrained UI, and direct language. Avoid adding decorative complexity without a product reason.

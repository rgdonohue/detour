# Next Steps Plan: Detour

## Why this doc still exists

This file is a future-direction note, not the source of truth for current behavior. Current product behavior lives in `README.md`, `docs/PRD.md`, and `docs/TECH_SPEC.md`.

## Current product truth

The app is no longer a fixed-origin Capitol-only checker.

Current shipped behavior:

- the map opens centered on the configured default location in Santa Fe
- the user clicks to set an origin
- the app renders a dynamic service-area polygon for that origin
- the user clicks again to set a destination
- the app shows the shortest route, distance, duration, and a within-threshold verdict
- presets are currently `1`, `3`, and `5` miles

Already completed relative to earlier planning:

- `hotel_*` config naming was replaced with `origin_*`
- route duration is shown in the verdict panel
- threshold presets are configurable in the UI
- origin is now selected interactively in the frontend

## Product direction

The detour-suggestion idea still makes sense as a possible next step:

> Start with the shortest route, then offer one more meaningful route based on a small amount of local context.

That remains a future product expansion, not current app behavior.

## Reasonable next steps

1. Add search inputs for origin and destination without removing the current map-click flow.
2. Decide whether the app should stay Santa Fe-focused or become city-agnostic.
3. If the product pivots toward detours, keep the current shortest-route check as the baseline comparison.
4. Add any future detour endpoint separately instead of overloading `GET /api/route`.

## Not started

- detour routing
- POI ranking
- recommendation logic
- multi-stop trips
- non-driving modes

## Practical guidance

Use the current app as the foundation. The existing frontend, backend, and ORS integration are already enough to support an incremental next iteration.

# CLAUDE.md — 3-Mile Drive Map

## What this project is

A web map centered on the **New Mexico State Capitol** (Santa Fe, NM) showing the drivable area within **3 miles of street-network distance**. Includes tap-to-check routing: click any destination to see the driving route, distance, and within-limit verdict.

## Key files to read first

- `docs/PRD.md` — product requirements, user stories, success criteria
- `docs/TECH_SPEC.md` — architecture, API contracts, frontend specs, color palette
- `docs/PROMPTS.md` — milestone-by-milestone build prompts

## Architecture

- **Frontend:** React + TypeScript + Vite + MapLibre GL JS (`apps/web/`)
- **Backend:** FastAPI + httpx (`apps/api/`)
- **Routing provider:** OpenRouteService (ORS) — isodistance polygon + shortest-distance directions
- **Fallback:** OSMnx-generated polygon (`scripts/generate_fallback.py`)

## Critical invariants — do not violate these

1. **3 miles = 4828.032 meters** (3 × 1609.344). Never round this.
2. **ORS directions must use `preference="shortest"`** — not fastest. The product is a distance policy.
3. **ORS isochrones must use `range_type="distance"`** — not time. This computes isodistance, not isochrone.
4. **The route check is authoritative, the polygon is a visual estimate.** They can disagree near the boundary. The UI must reflect this.
5. **Capitol coordinates: -105.9384, 35.6824** (411 South Capitol St). Hardcode via env var. Do not geocode at runtime.

## Style & tone

Warm earth tones (terracotta, cream, sage). Serif display font + clean sans-serif body. The polygon should feel like a watercolor wash, not a hard boundary. Minimal, refined, intentional.

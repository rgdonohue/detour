# PRD — 3-Mile Drive Map

## Summary

A web map centered on the **New Mexico State Capitol** (411 South Capitol St, Santa Fe, NM 87501) showing the maximum drivable area within **3 miles of street-network distance** from the origin, plus tap-to-check routing for any destination.

The core concept is a **service area polygon** (equidistant / isodistance) computed by expanding outward along the road graph until the cumulative distance threshold is reached. This is fundamentally different from a planar buffer (circle).

## Problem

Users want to explore what's within a 3-mile driving radius from a central point in Santa Fe. There's no easy way to visualize the drivable area or verify if a specific destination is within range without manually checking routes.

## The "3 miles" rule — defined precisely

- **Rule:** A destination is within range if the **shortest-path driving distance ≤ 3.0 miles** (4828.032 meters).
- This is **shortest distance**, not fastest time. Many routing engines default to "fastest," which can produce a longer-mileage route. The routing provider must be configured for **shortest distance preference**.
- The polygon boundary is a visual estimate of coverage. The **route check to a specific destination is the authoritative verdict**. The product must communicate this clearly.

## Users

1. **General users** on mobile — exploring what's within 3 miles of the Capitol
2. **Desktop users** — checking specific destinations and understanding the coverage area
3. **Developers/planners** — understanding the reachable area from a central point

## User Stories

1. As a user, I see the origin pinned and a shaded boundary showing what's within 3 miles driving distance.
2. As a user, I tap a destination on the map and instantly see: a route line from the origin, driving distance in miles, and whether it's within the 3-mile range (Yes/No).
3. As a user, I can share a link that opens the map and shows the boundary.

## Requirements

### Must-have (MVP)

- Map loads centered on origin with styled marker
- Service area polygon for 3.0 miles driving distance (network, not planar)
- **Tap-to-check destination**: click anywhere on the map to see route polyline, distance in miles, and within-limit verdict (Yes/No)
- Clear legend / copy: "3-mile driving distance (street network), not straight-line"
- Responsive design (mobile + desktop)
- Clean, elegant UI

### Should-have

- Distance ring toggles: 1-mile, 2-mile, 3-mile presets
- "Reset view" button
- Caching so polygon is not recomputed on every page load

### Nice-to-have

- Curated POI markers within the boundary (Plaza, Canyon Road, Railyard, Museum Hill, restaurants, galleries)
- Geocoder / address search: user types a destination name and gets the route check
- Print-friendly view
- QR code generator for sharing

## Non-goals (for now)

- Live traffic consideration
- Multi-origin (other locations)
- User accounts or login
- Isochrone (time-based) — only isodistance

## Success Criteria

- Page loads and polygon draws in < 2 seconds on decent Wi-Fi (after cache warm)
- Users can check "is X within range?" in < 10 seconds using tap-to-check
- Zero ambiguity: users understand this is network distance, not straight-line

## Risks & Edge Cases

| Risk | Impact | Mitigation |
|------|--------|------------|
| Isochrone polygon doesn't perfectly match point-to-point routing | User told "yes" by polygon but "no" by route check | Treat route as authoritative. Polygon is visual estimate. Communicate this in UI copy. |
| OSM road data gaps in Santa Fe | Inaccurate polygon boundary | Visual QA against satellite imagery. Fix in OSM if needed. |
| ORS API rate limits (500 req/day free tier) | Service interruption | Cache polygon aggressively (24hr TTL). Route checks are lightweight. Consider self-hosted Valhalla as escape hatch. |
| Origin coordinate accuracy | Polygon computed from wrong origin | Hardcode verified coordinates via env var. Don't rely on runtime geocoding. |
| "3 miles" ambiguity (one-way vs round-trip) | Policy confusion | State explicitly in UI: one-way distance from origin. |

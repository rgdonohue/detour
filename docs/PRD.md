# PRD - Detour

## Summary

Detour is a Santa Fe routing tool for checking whether a destination is within a selected driving-distance threshold from a user-chosen origin.

The current product flow is map-first:

1. click to set an origin
2. view the service area for the selected mileage preset
3. click to set a destination
4. view the shortest route, distance, estimated drive time, and within-threshold verdict

The map opens centered on a configured default location, but the active origin is chosen by the user.

## Problem

Users need a fast way to answer a practical question:

> If I start here, is that destination within 1, 3, or 5 miles by road?

Straight-line distance is misleading. The product needs to use the street network and show the actual route-based verdict.

## Product rule

- A destination is within range if the shortest-path driving distance is less than or equal to the selected mileage threshold.
- Threshold presets currently supported in the UI: `1`, `3`, and `5` miles.
- The route check is authoritative.
- The polygon is a visual guide and can disagree near the boundary.

## Users

1. Users exploring what is reachable from a selected point in Santa Fe.
2. Users comparing destinations against a simple mileage rule.
3. Developers evaluating routing, service-area, and map interaction behavior.

## User Stories

1. As a user, I can click the map to choose my origin instead of being forced to use a fixed one.
2. As a user, I can click a second point to choose a destination and immediately see the shortest driving route.
3. As a user, I can see the route distance, estimated drive time, and whether that route is within the chosen mileage threshold.
4. As a user, I can switch between `1`, `3`, and `5` mile presets.
5. As a user, I can reset and start over quickly.

## MVP Requirements

- Map centers on the configured default location at load
- First click sets origin
- Dynamic service-area polygon for the selected origin and mileage preset
- Second click sets destination
- Shortest driving route from origin to destination
- Verdict panel with distance, duration, and within-limit result
- Presets for `1`, `3`, and `5` miles
- Responsive layout for desktop and mobile

## Current Limitations

- No address search or geocoder
- No shareable deep links
- Driving mode only
- Polygon can differ from route truth near edges
- The experience is Santa Fe-focused by default because the initial map center is configured there

## Non-goals

- Live traffic
- Saved trips or accounts
- Multi-stop routing
- Alternate travel modes
- Recommendation or detour logic

## Success Criteria

- User can complete an origin-to-destination check in two map clicks
- Verdict is understandable without reading technical docs
- Preset switching is immediate and predictable
- Distance policy remains based on shortest route mileage, not travel time

# Technical Specification - Detour

## 1. System Overview

```
React + TypeScript + MapLibre
        |
        v
FastAPI API layer
        |
        v
OpenRouteService
```

- Frontend lives in `apps/web/`.
- Backend lives in `apps/api/`.
- OpenRouteService (ORS) provides both isodistance polygons and shortest-route directions.
- The backend hides the ORS API key and adds light caching.

## 2. Current Product Behavior

The shipped app is a two-click routing flow with mileage presets.

1. The page loads and fetches `GET /api/config`.
2. The map centers on the configured default coordinates from `.env`.
3. No origin is active yet. The UI prompts the user to click the map to set one.
4. First click:
   - sets the origin marker
   - stores `[lon, lat]` in frontend state
   - requests `GET /api/area?miles=<preset>&origin=lon,lat`
   - renders the returned service-area polygon
5. Second click:
   - treats the clicked point as the destination
   - requests `GET /api/route?to=lon,lat&origin=lon,lat&miles=<preset>`
   - renders the route line and verdict panel
6. After a route is shown, the next map click starts a new origin selection flow.
7. Reset clears the selected origin, destination, route, and polygon, then recenters to the configured default location.

Current mileage presets are `1`, `3`, and `5` miles.

## 3. Backend API Contract

### `GET /api/config`

Returns the configured default location used for initial map centering and reset behavior.

```json
{
  "origin_name": "New Mexico State Capitol",
  "address": "411 South Capitol St, Santa Fe, NM 87501",
  "coordinates": [-105.9384, 35.6824],
  "default_miles": 3,
  "max_miles": 5
}
```

Notes:

- The frontend currently hardcodes the preset buttons to `1`, `3`, and `5`.
- `max_miles` is informational in the current UI. It is not the source of truth for preset rendering.

### `GET /api/area?miles=3&origin=-105.99,35.68`

Returns a GeoJSON `FeatureCollection` for the drivable service area.

Query params:

- `miles`: optional float, defaults to `3`
- `origin`: optional `lon,lat`

Behavior:

- If `origin` is provided, the backend parses it and computes a polygon for that specific origin.
- If `origin` is omitted, the backend uses the configured default origin from `.env`.
- When `origin` is omitted, the backend may return a precomputed route-based polygon from `cache/area_<miles>mi_route.geojson`.
- When `origin` is provided, the current implementation falls back to the ORS isodistance path and caches by `miles + profile + origin`.

Example response:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Polygon", "coordinates": [[[0, 0]]] },
      "properties": {
        "distance_miles": 3.0,
        "distance_meters": 4828.0,
        "computed_at": "2026-04-01T12:00:00Z"
      }
    }
  ]
}
```

### `GET /api/route?to=-105.98,35.67&origin=-105.99,35.68&miles=3`

Returns the shortest driving route plus the within-threshold verdict.

Query params:

- `to`: required `lon,lat`
- `origin`: optional `lon,lat`; defaults to configured origin if omitted
- `miles`: optional float; defaults to `DEFAULT_RANGE_MILES`

Example response:

```json
{
  "route": {
    "type": "Feature",
    "geometry": { "type": "LineString", "coordinates": [[0, 0], [1, 1]] },
    "properties": {}
  },
  "distance_meters": 4200.5,
  "distance_miles": 2.61,
  "duration_seconds": 480,
  "within_limit": true,
  "limit_miles": 3.0
}
```

Error behavior:

- `400`: invalid coordinates
- `404`: no route found
- `429`: ORS rate limit surfaced from upstream
- `502`: ORS or other upstream failure

## 4. ORS Contract Details

### Isochrones

Backend calls:

`POST https://api.openrouteservice.org/v2/isochrones/driving-car`

Key request fields:

- `locations: [[lon, lat]]`
- `range: [distance_meters]`
- `range_type: "distance"`
- `units: "m"`
- `smoothing: 25`

### Directions

Backend calls:

`POST https://api.openrouteservice.org/v2/directions/driving-car/geojson`

Key request fields:

- `coordinates: [[origin_lon, origin_lat], [dest_lon, dest_lat]]`
- `preference: "shortest"`

`preference="shortest"` is required because the product rule is based on route mileage, not travel time.

## 5. Frontend Implementation Notes

### Main files

- `apps/web/src/App.tsx`
  - renders the page header
  - defines presets `[1, 3, 5]`
  - passes the selected miles into `Map`
- `apps/web/src/components/Map.tsx`
  - owns the click flow and map rendering
  - fetches config on mount
  - renders origin marker, destination marker, polygon, route, status text, and verdict panel
- `apps/web/src/components/DistancePresets.tsx`
  - renders the preset button group
- `apps/web/src/components/VerdictPanel.tsx`
  - shows distance, formatted duration, verdict, errors, and reset action
- `apps/web/src/hooks/useServiceArea.ts`
  - fetches `/api/area` only when an origin exists
- `apps/web/src/hooks/useRouteCheck.ts`
  - fetches `/api/route`
- `apps/web/src/lib/api.ts`
  - typed API helpers

### Current interaction details

- The map uses a raster base layer from Stadia's Stamen Toner Lite tiles.
- The service area polygon is terracotta with a dashed outline.
- The route line is green when within range and red when outside range.
- While a route is being computed, map interaction is disabled.
- Status prompts are:
  - `Click map to set origin`
  - `Click map to set destination`

## 6. Environment Variables

Root `.env` file:

```env
ORS_API_KEY=your_openrouteservice_api_key
ORIGIN_NAME="New Mexico State Capitol"
ORIGIN_ADDRESS="411 South Capitol St, Santa Fe, NM 87501"
ORIGIN_LON=-105.9384
ORIGIN_LAT=35.6824
DEFAULT_RANGE_MILES=3
CACHE_TTL_HOURS=24
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Notes:

- These origin values define the default map center and fallback origin for API calls that omit `origin`.
- They do not prevent the user from choosing a different origin in the UI.

## 7. Known Limitations

- The polygon is an estimate. The route response is the authoritative check.
- The current UI is map-click only. There is no search box or geocoder.
- The UI is Santa Fe-focused by default because the initial map center comes from `.env`.
- The precomputed route-based polygon generator is not part of the normal two-click flow because the frontend sends an explicit `origin` once the user has selected one.

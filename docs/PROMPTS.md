# Agent Prompt Kit — 3-Mile Drive Map

## How to use this file

This file contains sequential prompts for Claude Code CLI or Codex CLI. Each milestone is a self-contained prompt. Copy-paste them in order. The agent should read `PRD.md` and `TECH_SPEC.md` in the project `docs/` directory for full context before starting.

---

## Milestone 0 — Repo Scaffold

```
Read docs/PRD.md and docs/TECH_SPEC.md for full project context.

Scaffold the project structure:

- apps/web: React + TypeScript + Vite + MapLibre GL JS
  - Install dependencies: react, react-dom, maplibre-gl, vite, typescript
  - Set up vite.config.ts with proxy to backend at localhost:8000
  - Create src/ structure: main.tsx, App.tsx, components/, hooks/, lib/, styles/

- apps/api: FastAPI backend
  - Create requirements.txt: fastapi, uvicorn, httpx, python-dotenv
  - Create main.py with CORS middleware and placeholder route stubs
  - Create config.py that reads from .env

- Root level:
  - .env.example with: ORS_API_KEY, HOTEL_NAME, HOTEL_ADDRESS, HOTEL_LON=-105.9384, HOTEL_LAT=35.6824, DEFAULT_RANGE_MILES=3, CACHE_TTL_HOURS=24
  - cache/ directory with .gitkeep
  - scripts/ directory
  - .gitignore (node_modules, __pycache__, .env, cache/*.geojson)

- README.md with:
  - Project description (one paragraph)
  - Prerequisites (Node 18+, Python 3.11+, ORS API key)
  - Setup instructions for both apps
  - "How to get an ORS API key" link

Do NOT implement any features yet — just scaffold and verify both apps start:
- `cd apps/web && npm run dev` serves on :5173
- `cd apps/api && uvicorn main:app --reload` serves on :8000
```

---

## Milestone 1 — Backend: Config + Area + Route Endpoints

```
Read docs/TECH_SPEC.md section 3 (Backend API Contract) for the full endpoint specs.

Implement the FastAPI backend in apps/api/:

1. config.py:
   - Load all env vars using pydantic-settings or python-dotenv
   - Origin coordinates, name, address, default range, ORS API key

2. ors_client.py:
   - Async HTTP client (httpx.AsyncClient) wrapping ORS API
   - Method: get_isodistance(lon, lat, distance_meters) → GeoJSON dict
     - POST to /v2/isochrones/driving-car
     - Body: locations, range=[distance_meters], range_type="distance", units="m", smoothing=25
   - Method: get_shortest_route(origin_lon, origin_lat, dest_lon, dest_lat) → dict
     - POST to /v2/directions/driving-car/geojson
     - Body: coordinates=[[origin], [dest]], preference="shortest"
     - Return: route GeoJSON, distance_meters, distance_miles, duration_seconds, within_limit boolean
   - CRITICAL: directions must use preference="shortest" — not fastest

3. cache.py:
   - Simple in-memory dict cache with TTL
   - Key: string, Value: any, TTL: configurable (default 24 hours)
   - Methods: get(key), set(key, value), invalidate(key)
   - Optional: on set, also write to cache/ directory as .geojson file for persistence

4. main.py:
   - GET /api/config → origin metadata
   - GET /api/area?miles=3 → cached isodistance polygon GeoJSON
     - Convert miles to meters (miles × 1609.344)
     - Check cache first; on miss, call ors_client.get_isodistance()
     - Cache the result
   - GET /api/route?to=-105.99,35.68 → route + verdict
     - Parse "to" as lon,lat
     - Call ors_client.get_shortest_route()
     - Return route geometry, distance_miles, within_limit
   - CORS middleware allowing localhost origins
   - Error handling: return structured JSON errors, not stack traces

5. tests/:
   - test_conversion.py: miles_to_meters(3) == 4828.032
   - test_within_limit.py: edge cases at exactly 3.0 miles, just over, just under

Verify: curl localhost:8000/api/config returns origin metadata.
Do NOT implement the area/route endpoints with real ORS calls if no API key is present — return mock GeoJSON instead with a log warning.
```

---

## Milestone 2 — Frontend: Map + Polygon

```
Read docs/TECH_SPEC.md sections 4-5 for frontend rendering specs.

Build the map UI in apps/web/:

1. lib/api.ts:
   - Typed API client with functions: getConfig(), getArea(miles), getRoute(lon, lat)
   - Base URL from env or defaults to /api (proxied by Vite)

2. hooks/useServiceArea.ts:
   - Fetch /api/area?miles=3 on mount
   - Return { polygon, isLoading, error }

3. components/Map.tsx:
   - Initialize MapLibre GL JS map
   - Center on origin coordinates from /api/config
   - Zoom level 13
   - Base tiles: use Stadia Stamen Toner Lite or MapTiler Streets (check free tier URL)
   - Disable rotation and pitch (dragRotate.disable(), touchZoomRotate.disableRotation())
   - On map load:
     - Add polygon source from useServiceArea hook
     - Add fill layer: terracotta wash, opacity 0.12-0.15
     - Add line layer: terracotta stroke, dashed, width 2
   - Add origin marker at configured coordinates
     - Popup with origin name and address

4. components/Legend.tsx:
   - Bottom-left overlay panel
   - Show: origin marker symbol + origin name
   - Show: polygon swatch + "3-mile driving range"
   - Footnote: "Driving distance along streets, not straight-line"

5. styles/global.css:
   - Import Google Fonts: Playfair Display (headings), DM Sans (body)
   - Color variables from TECH_SPEC (terracotta palette)
   - Map fills viewport
   - Panel styling: warm cream background, subtle shadow, rounded corners

6. App.tsx:
   - Render Map component
   - Title bar or header: "What's Within 3-Mile Driving Distance? — Santa Fe, NM"
   - Minimal, elegant layout

Verify: map loads, polygon displays, origin marker visible with popup.
Test on mobile viewport (Chrome DevTools).
```

---

## Milestone 3 — Tap-to-Check Routing

```
This is the key interactive feature. When a user clicks anywhere on the map, show the shortest driving route from the origin and whether it's within the 3-mile limit.

1. hooks/useRouteCheck.ts:
   - Function: checkRoute(lon, lat) → { route, distance_miles, within_limit, isLoading, error }
   - Calls /api/route?to=lon,lat
   - Returns parsed response

2. Map.tsx additions:
   - Add click handler on the map (not on existing markers/popups)
   - On click:
     - Get clicked coordinates
     - Call useRouteCheck.checkRoute(lon, lat)
     - Add/update a "destination" marker at clicked point
     - Add/update a route line layer (LineString from API response)
     - Style route line:
       - Green (#2D7D46) if within_limit
       - Red (#B8432F) if outside limit
       - Width 4, slight opacity
     - Show VerdictPanel with results
   - On subsequent click: remove previous route + destination marker, add new ones
   - "Reset" action: clear route, destination marker, verdict panel, recenter map on origin

3. components/VerdictPanel.tsx:
   - Positioned bottom-right (desktop) or bottom sheet (mobile)
   - Shows:
     - "Selected Destination" header
     - Distance: X.X miles (1 decimal place)
     - Verdict: ✅ "Within 3-mile range" or ❌ "Outside 3-mile range"
     - Green or red accent color matching the verdict
     - [Reset View] button
   - Animated entrance (slide up or fade in)
   - Dismissed on reset

4. Loading state:
   - While route is computing, show a brief loading indicator on the panel
   - Disable map click during route computation to prevent race conditions

5. Error handling:
   - If no route found (e.g., clicked in a river): show "No driving route to this location"
   - If API error: show "Route check unavailable, try again"

Verify: click anywhere on map → route line appears → verdict panel shows distance + yes/no.
Test edge cases: click inside polygon but > 3mi by route, click outside polygon but < 3mi by route, click on non-routable area.
```

---

## Milestone 4 — Polish, Responsiveness, Error States

```
Final polish pass. This is a luxury hospitality product — it should feel refined.

1. Visual polish:
   - Smooth polygon rendering (no jagged edges — if polygon is jagged, apply simplification)
   - Route line with rounded caps and joins
   - Origin marker: consider a custom SVG icon (pin or star) in terracotta color, not default blue circle
   - Hover state on map: cursor changes to crosshair when over the polygon area
   - Subtle map load animation (fade in polygon after tiles load)

2. Mobile responsiveness:
   - ≤ 768px: verdict panel becomes a bottom sheet (max 40% viewport height)
   - Legend collapses to a small "ℹ️" button that expands on tap
   - Header text shrinks appropriately
   - Touch-friendly: tap targets ≥ 44px

3. Error states:
   - ORS API down: show cached polygon if available, disable route checking with message
   - Network error: "Unable to connect. Check your internet connection."
   - Invalid click (ocean, mountain): "No driving route to this location"

4. Accessibility:
   - Sufficient color contrast on all text (WCAG AA)
   - Verdict panel is keyboard navigable
   - Screen reader: announce verdict result
   - Alt text on origin marker image if using one

5. Performance:
   - Polygon GeoJSON should be loaded once and cached in React state
   - Route requests should debounce rapid clicks (300ms)
   - Map tiles: verify CDN is fast for Santa Fe region

6. Copy refinements:
   - Header: "What's Within 3-Mile Driving Distance?"
   - Subheader: "Santa Fe, NM"
   - Legend: "Coverage area — 3-mile driving distance along streets"
   - Footnote: "Tap anywhere on the map to check if a destination is within range. Route distance is the official determination."

Verify: full walkthrough on desktop Chrome, mobile Safari viewport, Firefox.
Screenshot the final result for the README.
```

---

## Milestone 5 — Fallback Polygon Generator

```
Create scripts/generate_fallback.py — an offline tool that generates the service area polygon using OSMnx + NetworkX, independent of the ORS API. This serves as:
1. A fallback if ORS is unavailable
2. A QA tool to cross-check the ORS polygon
3. A way to regenerate the polygon without API costs

Requirements:
- pip install osmnx networkx geopandas shapely scipy matplotlib
- Script takes optional args: --miles (default 3), --output (default cache/area_fallback.geojson)
- Logic:
  1. Download driving network within 8km of origin coords using osmnx
  2. Find nearest node to origin
  3. Dijkstra shortest path from origin to all nodes, cutoff = miles × 1609.344 meters, weight = 'length'
  4. Extract coordinates of all reachable nodes
  5. Generate concave hull (shapely concave_hull, ratio=0.3)
  6. Apply light smoothing: buffer(15).buffer(-15) in a projected CRS (EPSG:32613 for Santa Fe UTM zone)
  7. Export as GeoJSON in EPSG:4326
  8. Also generate a QA plot (matplotlib) showing:
     - Road network edges colored by reachability (green = reachable, gray = not)
     - Polygon boundary overlaid
     - Origin marker
     - Save to cache/qa_plot.png

Add to README: "Fallback polygon generation" section explaining when and how to use this script.
```

---

## Milestone 6 (Post-MVP) — Distance Ring Toggles

```
Add the ability to toggle between 1-mile, 2-mile, and 3-mile service area views.

1. Backend: /api/area already accepts ?miles= parameter. Ensure it works for 1, 2, 3 (and caches each separately).

2. Frontend:
   - Add a segmented control or pill toggle: [1 mi] [2 mi] [3 mi]
   - Position: top-right of map or in the legend panel
   - On toggle: fetch new polygon (or use cached), update the fill layer
   - Animate the polygon transition (opacity fade)
   - Update legend text to match selected distance
   - Default to 3 miles on load

3. Consider rendering all three rings simultaneously with graduated opacity:
   - 1-mile: darkest fill (opacity 0.20)
   - 2-mile: medium fill (opacity 0.12)
   - 3-mile: lightest fill (opacity 0.06)
   - Let the toggle highlight/emphasize one ring while showing all three faintly
```

---

## Notes for the Agent

### Key gotchas to watch for

1. **ORS preference="shortest" is critical.** Without it, the directions API returns the fastest route which may be longer in miles. The whole product is about distance policy, not time.

2. **The polygon and route can disagree.** A point inside the polygon might be > 3 miles by actual shortest route (because the isochrone algorithm generalizes). The route check is the source of truth. Do not hide this — the UI should clearly communicate that the route distance is the official answer.

3. **CORS:** The FastAPI backend must allow the Vite dev server origin. In production, restrict to the actual domain.

4. **Origin coordinates:** Use -105.9384, 35.6824 (411 South Capitol St). Do NOT geocode at runtime — hardcode via env var. The geocoding fallback is only for initial setup if coords aren't provided.

5. **MapLibre tile URL:** Free tile providers change their URLs. Verify the base map URL works before committing. Stadia Maps requires an API key now — check their current free tier. MapTiler has a generous free tier.

6. **3 miles = 4828.032 meters.** Use this exact conversion (3 × 1609.344). Do not round to 4828.

### Design ethos

The map should feel like a beautiful, intentional object — not a generic dev tool. Think: warm earth tones, refined typography, generous whitespace, subtle animations. The polygon should feel like a watercolor wash on the map, not a harsh boundary. Less is more.

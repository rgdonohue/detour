# Detour

**routes shaped by place — a routing experiment built first in Santa Fe.**

Detour is a web mapping prototype that finds the **shortest route** between two points — by foot or by car — and then asks: *is there somewhere worth stopping along the way?*

Set an origin and a destination by clicking the map. The app draws the baseline route, reports distance and time, and surfaces up to five nearby stops from a curated local place dataset. Pick one and the map reroutes through it, showing exactly how many extra miles and minutes the detour adds.

This project started as a simple network-distance map. It has since evolved into a small spatial UX experiment: **what happens when routing is shaped not only by efficiency, but also by place?**

---

## Why this exists

Most routing interfaces optimize for speed, distance, or convenience. That makes sense, but it leaves out another dimension of movement: **meaning**.

Detour explores a different interaction pattern:

- show the shortest route
- surface nearby stops with local value
- make the tradeoff explicit
- let the user decide whether the detour is worth it

The current build uses Santa Fe as its first case study because it is compact, visually legible, and culturally rich enough to support this idea with a lightweight curated dataset. The broader concept is extensible beyond Santa Fe.

---

## What the app does

### Interaction flow

1. **Click once to set an origin** — three concentric distance rings appear, drawn from the actual street or trail network for the current mode
2. **Click again to set a destination**
3. The app draws the **shortest route** (driving or walking)
4. The panel shows route distance and estimated travel time
5. The app surfaces **up to five nearby stops** along the route from the current category filter — all plotted on the map
6. Click any number of stops in the list or on the map to build a multi-stop itinerary; the panel shows the added distance and time versus the direct route
7. Switch back to the shortest route at any time
8. The full state can be shared through the URL

### Controls

- **Drive / Walk toggle** — switches the routing profile and redraws the distance rings for the relevant scale (drive: 1 / 3 / 5 mi · walk: 0.5 / 1 / 2 mi)
- **Stop categories:** Any, History, Art, Scenic, Culture, Landmark
- **Reset:** clear the route and start over from the header

---

## What makes it interesting

This is **not** a full trip planner or a live POI search engine.

It is a deliberately small, opinionated prototype that combines:

- **network-aware routing** — via OpenRouteService for both driving and walking
- **real isochrone rings** — three concentric reachability rings, not geometric circles, drawn from the actual road and trail network
- **multi-stop discovery** — up to five route-adjacent stops plotted simultaneously
- **budget-aware detour logic** — detour cost shown as delta miles and minutes
- **curated local place selection**
- **shareable route state**
- **a map-first interaction model**

The goal is not to overwhelm the user with options. The goal is to test whether **a small set of good suggestions with a clear cost** can be more compelling than a generic list.

---

## Tech stack

### Frontend

- **React**
- **TypeScript**
- **Vite**
- **MapLibre GL JS**

### Backend

- **FastAPI**
- **Python 3.11**
- **OpenRouteService API**

### Data / logic

- Curated local place dataset for route-adjacent stop suggestions
- ORS-backed shortest-path routing (`preference="shortest"`) for both `driving-car` and `foot-walking` profiles
- ORS isochrone API for multi-ring service areas (single request, multiple ranges)
- URL-synced app state for shareable map views

### Deployment

Monorepo deployed as two services:

```text
apps/web   → frontend
apps/api   → backend
```

---

## Architecture at a glance

```text
apps/
  web/   → React + MapLibre frontend
  api/   → FastAPI backend, ORS integration
```

### Frontend responsibilities

- map rendering and click-to-set interaction flow
- concentric isochrone ring display (three rings per origin, no fill)
- route and detour display
- multi-stop marker management and hover tooltips
- stop-category filtering
- Drive / Walk mode toggle with in-place re-routing
- URL state sync / restore

### Backend responsibilities

- route requests to OpenRouteService (driving and walking)
- shortest-route and via-stop route calculation
- multi-range isochrone generation (one ORS call returns all three rings)
- stop suggestion from ORS POI API + curated static fallback
- environment config management
- dev fallback behavior when no API key is present

---

## Running locally

### Prerequisites

- **Node.js 18+**
- **Python 3.11+**
- **OpenRouteService API key**  
  Sign up at: [https://openrouteservice.org/dev/#/signup](https://openrouteservice.org/dev/#/signup)

### Environment

```bash
cp .env.example .env
# Edit .env and add ORS_API_KEY
```

The `.env` origin values define the default map center and backend fallback origin. In the UI, the user can choose any origin by clicking the map.

### Frontend

```bash
cd apps/web
npm install
npm run dev
```

Runs at: `http://localhost:5173`

### Backend

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Runs at: `http://localhost:8000`

In local development, Vite proxies `/api` requests to the backend.

---

## Shareable URL state

The app keeps key route state in the URL so a route can be refreshed or shared directly.

Current shared state includes:

- origin
- destination
- stop category
- selected stop coordinates (via waypoints)
- travel mode (walk is the default)

Example:

```text
?origin=-105.9394,35.687&destination=-105.944,35.683&category=art&mode=walk
```

---

## Deployment

The project is deployed as two Railway services from the same monorepo.

See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment details.

---

## Current limitations

- Place suggestions come from a **small curated static dataset**, not a live search or POI API
- No **text search / geocoder**
- Without a valid OpenRouteService API key, the backend falls back to **mock responses** for development
- Seeded for **Santa Fe first**, though the concept is designed to scale

---

## Project direction

Detour is a **Santa Fe-first prototype** for a broader idea:

> routing that balances efficiency with cultural, scenic, or local meaning.

The current product direction targets the Santa Fe tour guide and tourism industry. See [docs/UX_DIRECTION.md](docs/UX_DIRECTION.md) for personas, feature brainstorm, and roadmap options.

---

## Status

Active prototype. Built to explore a product question, not just a routing feature.

**Shortest route, or route worth taking?**

# The Long Way Home

**A place-aware routing experiment built first in Santa Fe.**

Long Way Home is a web mapping prototype that compares the **shortest driving route** with a route that might be **more worth taking**.

Set an origin and destination by clicking the map. The app draws the baseline route, reports distance and estimated drive time, checks whether the trip stays within a selected mileage budget, and suggests one nearby stop along the way from a small curated place dataset. If the stop looks worth it, you can reroute through it and see the tradeoff immediately: **how many extra miles and minutes the detour adds, and whether it still fits your budget**.

This project started as a simple network-distance map. It has since evolved into a small spatial UX experiment: **what happens when routing is shaped not only by efficiency, but also by place?**

---

## Why this exists

Most routing interfaces optimize for speed, distance, or convenience. That makes sense, but it leaves out another dimension of movement: **meaning**.

Long Way Home explores a different interaction pattern:

- show the shortest route
- surface one nearby stop with local value
- make the tradeoff explicit
- let the user decide whether the detour is worth it

The current build uses Santa Fe as its first case study because it is compact, visually legible, and culturally rich enough to support this idea with a lightweight curated dataset. The broader concept is extensible beyond Santa Fe.

---

## What the app does

### Current interaction flow

1. **Click once to set an origin**
2. **Click again to set a destination**
3. The app draws the **shortest driving route**
4. The panel shows:
   - route distance
   - estimated drive time
   - whether the trip is within the selected mileage threshold
5. The app looks for **one nearby place** along the route from the current category filter
6. If a suitable stop exists, the app:
   - shows it in the panel
   - previews whether routing through it stays within the selected budget
   - lets you click **Route via this stop**
7. The map then compares:
   - the original shortest route
   - the via-stop route
   - the added distance and time
8. The full state can be shared through the URL

### Current controls

- **Mileage presets:** 1, 3, or 5 miles
- **Stop categories:** Any, History, Art, Scenic, Food, Culture
- **Route toggle:** shortest route or route via suggested stop
- **Reset:** clear the route and start over

---

## What makes it interesting

This is **not** a full trip planner or a live POI search engine.

It is a deliberately small, opinionated prototype that combines:

- **network-aware routing**
- **budget-aware detour logic**
- **curated local place selection**
- **shareable route state**
- **a map-first interaction model**

The goal is not to overwhelm the user with options. The goal is to test whether **one good suggestion with a clear cost** can be more compelling than a cluttered list of “things near your route.”

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

- curated local place dataset for route-adjacent stop suggestions
- frontend route-proximity selection logic
- ORS-backed shortest-path and via-stop routing
- URL-synced app state for shareable map views

### Deployment

- monorepo deployed as two Railway services:
  - `apps/web`
  - `apps/api`

---

## Architecture at a glance

```text
apps/
  web/   -> React + MapLibre frontend
  api/   -> FastAPI backend, ORS integration
```

### Frontend responsibilities

- map rendering
- click-to-set interaction flow
- route and detour display
- stop-category filtering
- route comparison UI
- URL state sync / restore

### Backend responsibilities

- route requests to OpenRouteService
- shortest-route and via-stop route calculation
- service-area polygon generation
- environment config management
- dev fallback behavior when no API key is present

---

## Process and design approach

Long Way Home was built iteratively as a **small product-thinking exercise**, not just a code demo.

The development process emphasized:

- starting from a narrow working prototype
- improving coherence before adding features
- keeping the interaction legible
- using a small curated dataset before reaching for larger live integrations
- favoring explicit tradeoffs over hidden “smart” behavior
- documenting each phase so the repo remains understandable

In practice, that meant evolving the project through clear stages:

1. fixed-origin distance checker
2. dynamic origin/destination routing
3. route-adjacent place suggestion
4. reroute-through-stop comparison
5. budget-aware detour messaging
6. category filtering
7. shareable URL state

That incremental path matters. The project is as much about **spatial product design and interaction framing** as it is about routing.

---

## Current scope and limitations

This is still a prototype.

### Current limitations

- The place suggestions come from a **small curated static dataset**, not a live search or POI API
- The map currently supports **driving routes only**
- There is **no text search / geocoder** yet
- The shaded service-area polygon is **advisory**; the route verdict is authoritative
- Without a valid OpenRouteService API key, the backend falls back to **mock responses for development**
- The current implementation is seeded for **Santa Fe first**, though the concept is designed to scale beyond it

### Not built yet

- walk / bike / transit modes
- live POI sources
- multiple stop suggestions
- browser history `popstate` restoration
- stronger persistence beyond shareable URLs
- more sophisticated stop ranking logic

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
- mileage preset
- stop category
- whether the via-stop route is active

Example shape:

```text
?origin=-105.9394,35.687&destination=-105.944,35.683&miles=3&category=art&detour=1
```

This makes it easier to demo specific route scenarios and discuss the interaction with others.

---

## Deployment

The project is deployed as two Railway services from the same monorepo.

See [docs/DEPLOY.md](docs/DEPLOY.md) for deployment details.

---

## Project direction

Long Way Home is currently a **Santa Fe-first prototype** for a broader idea:

> routing that balances efficiency with cultural, scenic, or local meaning.

Possible future directions include:

- expanding beyond Santa Fe
- replacing the static dataset with richer live place data
- supporting more travel modes
- improving the stop-ranking logic
- testing this interaction pattern with real users in mapping / cartography / civic-tech contexts

---

## Who this is for

This project is especially relevant to people interested in:

- GIS and web cartography
- spatial UX / product design
- route interfaces
- place-aware computing
- cultural mapping
- map prototypes that sit between analysis and storytelling

---

## Status

Active prototype. Built to explore a product question, not just a routing feature.

**Shortest route, or route worth taking?**

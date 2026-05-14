# Launch Readiness

Engineering hardening before posting Detour publicly. Product direction lives in `NEXT_STEPS.md` and `UX_DIRECTION.md`; this doc tracks the load/scaling/abuse work that has to land first.

## The framing

Detour currently proxies a single shared OpenRouteService free-tier key. Public-tier ORS quotas are roughly 2,000 directions/day, 500 isochrones/day, 500 POIs/day, shared across **all** users behind that key. There is no FastAPI rate limiting, route responses are not cached, and area-ring cache keys use raw float coordinates so two users clicking near the same intersection rarely share an entry.

A Hacker News spike or a tour-guide newsletter blast would exhaust the daily isochrone quota in minutes, and the frontend would silently degrade — markers appear but distance rings stop showing — without a useful error message.

See the original code review for full citations: [internal/codex-review-2026-05-13.md](#) (paste-only, not committed).

## Sequenced work — minimum to post safely

These three tasks are tracked in the active task list and must ship before posting publicly.

### 1. Quantize coords, pool httpx, extend in-flight dedup to `/api/route`

Three small, behavior-preserving efficiency changes that compound:

- Round origin/dest/via lon/lat to **4 decimals** (~9-11 m in Santa Fe) before building cache keys AND before sending to ORS. Apply in `apps/api/main.py` `/api/area`, `/api/route`, `/api/suggest-stop`, and `apps/api/ors_client.py`.
- Replace per-call `httpx.AsyncClient()` in `apps/api/ors_client.py` and `apps/api/poi_client.py` with one module-level client using `httpx.Limits(max_connections=50, max_keepalive_connections=20)` and `httpx.Timeout(connect=3.0, read=15.0, write=5.0, pool=2.0)`. Wire a FastAPI shutdown hook to `aclose()` it.
- Extend the `_area_inflight` dedup at `apps/api/main.py:78` to `/api/route` and `/api/suggest-stop`. Key shape: `(profile, qorigin, qdest, ordered_via_tuple)`. Two simultaneous identical requests = one ORS call.

### 2. Persist `/api/route` and `/api/suggest-stop` cache to disk

Extend `apps/api/cache.py` so route + suggest-stop responses persist to the Railway Volume just like `area_*` already does. Key shapes after quantization:

- `route:v1:{profile}:shortest:{qlon_o}_{qlat_o}:{qlon_d}_{qlat_d}:{ordered_via_hash}`
- `suggest:v1:{profile}:{category}:{sha256(route_coords rounded to 4dp)}`

`ordered_via_hash = sha256(json.dumps(ordered_via_list))` truncated to 12 chars to keep filenames sane. The via list is already ordered deterministically by `optimizeStopOrder`, so two users picking the same set produce the same key.

TTL: 7 days, configurable. ORS road graph rarely changes for this product. Make `CACHE_DIR` env-configurable so production points at the Railway Volume mount, not the repo.

### 3. FastAPI rate limits on `/api/area`, `/api/route`, `/api/suggest-stop`, POST `/api/tours`

In-process token bucket (prefer `slowapi` unless adding the dep is unwanted). Limits sit **below** ORS quotas to protect the shared key:

| Endpoint | Global | Per-IP |
|---|---|---|
| `/api/area` | 18/min, 450/day | 6/min, 60/day |
| `/api/route` | 35/min, 1800/day | 20/min, 300/day |
| `/api/suggest-stop` GET (no geometry) | same as `/api/route` | same as `/api/route` |
| `/api/suggest-stop` POST (with geometry, no ORS call) | — | 60/min |
| POST `/api/tours` | — | 5/min, 50/day |

On limit hit, return 429 with JSON `{"detail": "...", "retry_after_seconds": N}` and a `Retry-After` header. Frontend (`apps/web/src/lib/api.ts`) should surface `retry_after_seconds` in the thrown Error so `VerdictPanel` can render "Routing is busy, try again in Ns" instead of the current generic copy.

Behind Railway's proxy, the per-IP key must come from `X-Forwarded-For` first hop, not the raw remote address. Verify Railway's forwarding behavior before trusting.

## Deferred — not blocking launch, do soon after

These are filed here so they don't get lost.

### Frontend stop-selection debounce

Each toggle in `apps/web/src/components/Map.tsx:962` (`handleSelectStop`) sends a full multi-waypoint `/api/route` call. A 5-stop tour built one click at a time = 1 isochrone + 6 directions ORS calls. The existing `AbortController` aborts the HTTP request but the ORS call is already in flight by the time the abort lands.

A 300-500 ms debounce on `handleSelectStop` would collapse rapid-fire stop additions into a single ORS call. The cache from launch-readiness task 2 reduces the urgency but does not eliminate it — first-time exploration is always cache-miss.

### Typed upstream 429 / 5xx handling with backoff

`apps/api/ors_client.py:100, 102, 172` raises generic `ValueError` on ORS 401/429/5xx without retrying. Add:

- Retry 5xx and timeouts twice with exponential backoff plus jitter (e.g. 250 ms then 750 ms, ± 0-250 ms).
- For 429, respect `Retry-After`. If ≤ 2 s, retry once; otherwise fail fast with a typed 429.
- Frontend soft-fail vs hard-fail copy: area-ring 429 = "Distance rings are busy; route checks still work" banner; route 429 = "Routing is busy, try again in Ns" hard error; suggest-stop failure = keep route, show "Stops unavailable".

### Invariant regression tests

`apps/api/tests/` covers `conversion.py` and a local within-limit helper but never checks the actual ORS request payloads. A future refactor could silently drop `preference="shortest"` or `range_type="distance"`.

Add tests that monkeypatch the ORS HTTP client and assert:

- Directions JSON contains `preference: "shortest"`.
- Isochrones JSON contains `range_type: "distance"`.
- `get_shortest_route` computes `within_limit` from returned route distance, not polygon state.
- `/api/config` response does not contain `ORS_API_KEY` or any `*_KEY` field.

### Saved-tour pruning automation

`apps/api/saved_tours.py` writes one JSON file per POST to the Railway Volume; `tour_admin.py` exists as a manual CLI. Volume can fill. Add an automated prune policy — either a periodic job invoked by `tour_admin.py` logic, or a soft cap (LRU eviction) in `save_tour`. Rate limiting from task 3 slows the bleed but does not stop it.

### `Map.tsx` extraction

`apps/web/src/components/Map.tsx` is 1,363 lines combining map lifecycle, route orchestration, stop suggestions, URL restore, tour saving, and rendering. Three suggested seams:

- `useBuildRouteController` — click/drag/mode/URL-restore routing. Testable for ORS call count.
- `useMapLibreLayers` — markers, sources, layers. Testable with a fake map object.
- `useStopsAndDetour` — suggestions, selection, TSP, detour route calls. Testable without MapLibre.

### `main.py` router split

Split `apps/api/main.py` into `routers/routing.py`, `routers/pois.py`, `routers/tours.py`, with dependencies for `parse_coord`, ORS client, cache, and rate limiter. Behavior identical; makes middleware (rate limiting, typed upstream error handling) easier to apply consistently.

## The real fix — move off the free key

The above sequence is mitigation. Long-term, Detour should not depend on a shared free-tier ORS key.

Options ranked by effort:

1. **Self-host ORS in Docker** on a Railway service with the New Mexico OSM extract. Preserves the existing API shape and `preference="shortest"` / `range_type="distance"` semantics exactly. Highest ops cost (graph rebuilds when OSM updates) but zero per-request cost and unlimited quota.
2. **ORS commercial / on-prem support contract.** Preserves API shape; costs scale with traffic.
3. **Switch to Mapbox Directions + Isochrone.** ~100k free monthly, then ~$2/1k. API and semantics differ; would need an adapter layer.
4. **Switch to Google Routes.** Strong quota/billing controls; no direct isochrone equivalent; starts ~10k free monthly then ~$5/1k essentials.
5. **Valhalla self-host.** Open-source, supports routes + isochrones; needs an adapter for ORS's exact response shape.
6. **OSRM self-host.** Very fast routing; weak isochrone fit.

Recommendation pending traffic data. Self-host ORS is the lowest-friction continuity choice; Mapbox is the lowest-friction migration if a fully-managed service is preferred.

## Out of scope for this doc

- New product features. See `NEXT_STEPS.md` and `UX_DIRECTION.md`.
- Search / geocoder. See `NEXT_STEPS.md`.
- Auth / accounts. Not on the critical path for public posting.

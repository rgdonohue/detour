# Deployment - Railway

This repo is deployed as **two Railway services** from the same monorepo (static SPA + FastAPI). That split matches how the app is built: the browser must call a **separate origin** that holds the OpenRouteService key and implements `/api/*`.

## 1. Create the project

- In Railway, create a new project from this Git repository (or connect the repo first, then add services).
- Add one service with **Root Directory** `apps/api` and one with **Root Directory** `apps/web`.

Service-level config (optional; Railway will use these if present):

- `apps/api/railway.toml`
- `apps/web/railway.toml`

## 2. API service

- **Root Directory:** `apps/api`
- **Build:** `pip install -r requirements.txt` (see `railway.toml`)
- **Start:** `uvicorn main:app --host 0.0.0.0 --port $PORT`

**Required env vars:**

- `ORS_API_KEY` — OpenRouteService key (used for `/api/area` and `/api/route`; `/` and `/api/config` do not call ORS).
- `CORS_ORIGINS` — Browser origins allowed to call the API. Use the **exact** web app origin (scheme + host + port if any), e.g. `https://your-web-service.up.railway.app`. **Comma-separated** if you have more than one (preview + production, or `www` and apex).

**Optional env vars:**

- `ORIGIN_NAME`
- `ORIGIN_ADDRESS`
- `ORIGIN_LON`
- `ORIGIN_LAT`
- `DEFAULT_RANGE_MILES`
- `CACHE_TTL_HOURS`
- `SAVED_TOURS_DIR` — Filesystem directory for user-saved tours (POST `/api/tours`). Defaults to `./data/saved_tours` inside the container. **Required for durability on Railway** — without a mounted Volume backing this path, every redeploy wipes all user-saved tours.

### Saved-tour durability (Railway Volume)

User-built tours are persisted as JSON files. Railway containers have ephemeral filesystems, so saved tours need a Volume to survive deploys:

1. In the API service settings, add a **Volume** — e.g. mount path `/data/saved_tours`, size `1 GB`.
2. Set the env var `SAVED_TOURS_DIR=/data/saved_tours` on the API service.
3. Redeploy. The directory is created on first import; subsequent saves write into the Volume.

A 1 GB volume holds ~500k tours at typical sizes (~2 KB each). Curated gallery tours live in `data/tours/` and are baked into the image — they don't need a volume.

## 3. Web service

- **Root Directory:** `apps/web`
- **Build:** `npm install && npm run build`
- **Start:** `npm run start` (serves `dist/` with `serve`, port from `$PORT`)

**Required for production:**

- `VITE_API_BASE` — Must be the **public base URL of the API’s `/api` routes**, e.g. `https://your-api-service.up.railway.app/api`  
  - No trailing slash after `api` (avoid `.../api/`).  
  - **Set this in Railway before the build runs.** Vite inlines `VITE_*` at **build** time. If it is unset, the client falls back to `"/api"` (same origin as the web app), which only works behind the Vite dev proxy—not for two separate Railway URLs.

Deploy the API first (or use a stable API URL), set `VITE_API_BASE`, then trigger a **rebuild** of the web service if you change the API URL.

## 4. Verify

After deploy:

1. Open the API service URL and confirm `GET /` returns a health JSON payload.
2. Confirm `GET https://<api-domain>/api/config` returns JSON with `coordinates`.
3. Open the web app: map loads, first click fetches area, second click fetches route (browser devtools Network tab should show requests to the **API** host, not the web host).

If the UI loads but `/api` calls fail: check **`CORS_ORIGINS`** (exact origin match), then **`VITE_API_BASE`** (correct URL and rebuild after changes).

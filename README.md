# 3-Mile Drive Map

A web map centered on the **New Mexico State Capitol** (Santa Fe, NM) showing the drivable area within **3 miles of street-network distance**, plus tap-to-check routing to verify if any destination is within range.

![map](map.png)

## Prerequisites

- **Node.js** 18+
- **Python** 3.11+
- **OpenRouteService API key** — [How to get an ORS API key](https://openrouteservice.org/dev/#/signup)

## Setup

### 1. Environment

```bash
cp .env.example .env
# Edit .env and add your ORS_API_KEY
```

### 2. Frontend (apps/web)

```bash
cd apps/web
npm install
npm run dev
```

Serves at [http://localhost:5173](http://localhost:5173).

### 3. Backend (apps/api)

```bash
cd apps/api
python -m venv .venv
source .venv/bin/activate   # or `.venv\Scripts\activate` on Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

Serves at [http://localhost:8000](http://localhost:8000).

## Development

Run both apps in separate terminals. The frontend proxies `/api` requests to the backend at `localhost:8000`.

## Deploy to Render

1. **Push to GitHub** — ensure the repo is pushed to GitHub or GitLab.

2. **Connect Blueprint** — go to [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect this repo.

3. **Add ORS API key** — when Render shows the services to create:
   - Select the `3-mile-drive-api` service
   - Under **Environment** → **Environment Variables**, add `ORS_API_KEY` as a **Secret** with your [OpenRouteService](https://openrouteservice.org/dev/#/signup) key

4. **Apply** — click **Apply** to create both services.

5. **First load** — the API uses the free tier and may spin down after inactivity. The first request after sleep can take ~30–60 seconds; the frontend will retry.

**URLs after deploy:**
- Frontend: `https://3-mile-drive.onrender.com`
- API: `https://3-mile-drive-api.onrender.com`

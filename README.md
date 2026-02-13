# 3-Mile Drive Map

A web map centered on the **New Mexico State Capitol** (Santa Fe, NM) showing the drivable area within **3 miles of street-network distance**, plus tap-to-check routing to verify if any destination is within range.

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

"""FastAPI backend — API shield and cache layer for 3-Mile Drive Map."""
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from cache import (
    get as cache_get,
    get_route_based_polygon,
    set as cache_set,
    set_route_based_polygon,
)
from config import settings
from conversion import miles_to_meters
from ors_client import get_isodistance, get_shortest_route

logger = logging.getLogger(__name__)

app = FastAPI(title="3-Mile Drive Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    """Health check."""
    return {"status": "ok", "service": "3-mile-drive-api"}


@app.get("/api/config")
def get_config():
    """Returns origin metadata for frontend initialization."""
    return {
        "hotel_name": settings.HOTEL_NAME,
        "address": settings.HOTEL_ADDRESS,
        "coordinates": [settings.HOTEL_LON, settings.HOTEL_LAT],
        "default_miles": settings.DEFAULT_RANGE_MILES,
        "max_miles": 5,
    }


@app.get("/api/area")
async def get_area(miles: float = 3):
    """Returns cached GeoJSON FeatureCollection for the drivable service area.
    Prefers route-based polygon (from file cache) if present; falls back to isochrones."""
    # Try route-based polygon first (file or in-memory)
    route_based = get_route_based_polygon(miles)
    if route_based:
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        for feat in route_based.get("features", []):
            feat.setdefault("properties", {})["computed_at"] = now
        return route_based

    # Fallback: isochrone polygon
    profile = "driving-car"
    cache_key = f"area_{miles}_{profile}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    distance_meters = miles_to_meters(miles)
    try:
        result = await get_isodistance(
            settings.HOTEL_LON, settings.HOTEL_LAT, distance_meters
        )
    except ValueError as e:
        msg = str(e)
        if "rate limited" in msg.lower():
            raise HTTPException(status_code=429, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception as e:
        logger.exception("ORS isochrones error")
        raise HTTPException(status_code=502, detail="Upstream routing error")

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    for feat in result.get("features", []):
        props = feat.setdefault("properties", {})
        props["distance_miles"] = miles
        props["distance_meters"] = round(distance_meters, 0)
        props["computed_at"] = now

    cache_set(cache_key, result)
    return result


def _parse_to_param(to: str) -> tuple[float, float]:
    """Parse 'lon,lat' string. Raises ValueError if invalid."""
    try:
        parts = to.strip().split(",")
        if len(parts) != 2:
            raise ValueError("Expected lon,lat")
        lon = float(parts[0].strip())
        lat = float(parts[1].strip())
        if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
            raise ValueError("Coordinates out of range")
        return lon, lat
    except (ValueError, IndexError) as e:
        raise ValueError(f"Invalid coordinates: {e}") from e


@app.get("/api/route")
async def get_route(to: str):
    """Returns shortest route from origin to destination and within-limit verdict."""
    try:
        dest_lon, dest_lat = _parse_to_param(to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await get_shortest_route(
            settings.HOTEL_LON,
            settings.HOTEL_LAT,
            dest_lon,
            dest_lat,
            limit_miles=settings.DEFAULT_RANGE_MILES,
        )
    except ValueError as e:
        msg = str(e)
        if "rate limited" in msg.lower():
            raise HTTPException(status_code=429, detail=msg)
        if "no route" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception as e:
        logger.exception("ORS directions error")
        raise HTTPException(status_code=502, detail="Upstream routing error")

    return result

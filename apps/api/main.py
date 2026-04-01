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
from poi_client import get_pois_along_route
from stop_selector import ORS_ELIGIBLE_CATEGORIES, select_from_ors, select_from_static

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Uvicorn only configures its own loggers; app loggers propagate to root at WARNING, so INFO is dropped.
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_h)
    logger.propagate = False

app = FastAPI(title="3-Mile Drive Map API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
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
        "origin_name": settings.ORIGIN_NAME,
        "address": settings.ORIGIN_ADDRESS,
        "coordinates": [settings.ORIGIN_LON, settings.ORIGIN_LAT],
        "default_miles": settings.DEFAULT_RANGE_MILES,
        "max_miles": 5,
    }


@app.get("/api/area")
async def get_area(miles: float = 3, origin: str | None = None):
    """Returns cached GeoJSON FeatureCollection for the drivable service area.
    Accepts optional origin=lon,lat; defaults to configured origin.
    Prefers route-based polygon (from file cache) for default origin; falls back to isochrones."""
    if origin:
        try:
            origin_lon, origin_lat = _parse_to_param(origin)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")
        is_default_origin = False
    else:
        origin_lon = settings.ORIGIN_LON
        origin_lat = settings.ORIGIN_LAT
        is_default_origin = True

    # Try route-based polygon only for default origin
    if is_default_origin:
        route_based = get_route_based_polygon(miles)
        if route_based:
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            for feat in route_based.get("features", []):
                feat.setdefault("properties", {})["computed_at"] = now
            return route_based

    profile = "driving-car"
    cache_key = f"area_{miles}_{profile}_{origin_lon}_{origin_lat}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    distance_meters = miles_to_meters(miles)
    try:
        result = await get_isodistance(origin_lon, origin_lat, distance_meters)
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
async def get_route(
    to: str,
    origin: str | None = None,
    via: str | None = None,
    miles: float | None = None,
):
    """Returns shortest route from origin to destination and within-limit verdict.
    Accepts optional origin=lon,lat and via=lon,lat (waypoint). Defaults to configured origin."""
    limit_miles = miles if miles is not None else settings.DEFAULT_RANGE_MILES
    try:
        dest_lon, dest_lat = _parse_to_param(to)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if origin:
        try:
            origin_lon, origin_lat = _parse_to_param(origin)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")
    else:
        origin_lon = settings.ORIGIN_LON
        origin_lat = settings.ORIGIN_LAT

    via_lon, via_lat = None, None
    if via:
        try:
            via_lon, via_lat = _parse_to_param(via)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid via: {e}")

    try:
        result = await get_shortest_route(
            origin_lon,
            origin_lat,
            dest_lon,
            dest_lat,
            limit_miles=limit_miles,
            via_lon=via_lon,
            via_lat=via_lat,
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


@app.get("/api/suggest-stop")
async def suggest_stop(
    origin: str,
    destination: str,
    category: str | None = None,
    miles: float | None = None,
):
    """Suggest the best nearby stop along the route from origin to destination."""
    try:
        origin_lon, origin_lat = _parse_to_param(origin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")

    try:
        dest_lon, dest_lat = _parse_to_param(destination)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid destination: {e}")

    limit_miles = miles if miles is not None else settings.DEFAULT_RANGE_MILES

    try:
        route_data = await get_shortest_route(
            origin_lon, origin_lat, dest_lon, dest_lat, limit_miles=limit_miles
        )
    except ValueError as e:
        msg = str(e)
        if "no route" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception:
        logger.exception("ORS directions error in suggest-stop")
        raise HTTPException(status_code=502, detail="Upstream routing error")

    route_coords = route_data["route"]["geometry"]["coordinates"]

    ors_attempted = settings.USE_ORS_POIS and category in ORS_ELIGIBLE_CATEGORIES
    ors_candidates = 0
    stop = None

    if ors_attempted:
        candidates = await get_pois_along_route(route_coords, category)
        ors_candidates = len(candidates)
        stop = select_from_ors(candidates, route_coords)

    fallback = False
    if stop is None:
        if ors_attempted:
            fallback = True
        stop = select_from_static(route_coords, category)

    source = stop["source"] if stop else "none"
    logger.info(
        "suggest-stop category=%s ors_attempted=%s ors_candidates=%d source=%s",
        category,
        ors_attempted,
        ors_candidates,
        source,
    )

    return {"stop": stop, "fallback": fallback}

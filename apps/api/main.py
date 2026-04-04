"""FastAPI backend — API shield and cache layer for 3-Mile Drive Map."""
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from cache import (
    get as cache_get,
    set as cache_set,
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


def _mode_to_profile(mode: str) -> str:
    return "foot-walking" if mode == "walk" else "driving-car"


# Ring distances per mode (miles)
_RING_MILES: dict[str, list[float]] = {
    "drive": [1.0, 3.0, 5.0],
    "walk":  [0.5, 1.0, 2.0],
}


@app.get("/api/area")
async def get_area(origin: str | None = None, mode: str = "drive"):
    """Returns a GeoJSON FeatureCollection with three concentric isodistance rings.
    Ring distances are determined by mode: drive=1/3/5 mi, walk=0.5/1/2 mi.
    Accepts optional origin=lon,lat; defaults to configured origin."""
    if origin:
        try:
            origin_lon, origin_lat = _parse_to_param(origin)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")
    else:
        origin_lon = settings.ORIGIN_LON
        origin_lat = settings.ORIGIN_LAT

    ring_miles = _RING_MILES.get(mode, _RING_MILES["drive"])
    distances_meters = [miles_to_meters(m) for m in ring_miles]

    profile = _mode_to_profile(mode)
    cache_key = f"area_rings_{profile}_{origin_lon}_{origin_lat}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        result = await get_isodistance(origin_lon, origin_lat, distances_meters, profile)
    except ValueError as e:
        msg = str(e)
        if "rate limited" in msg.lower():
            raise HTTPException(status_code=429, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception:
        logger.exception("ORS isochrones error")
        raise HTTPException(status_code=502, detail="Upstream routing error")

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
    mode: str = "drive",
):
    """Returns shortest route from origin to destination and within-limit verdict.
    Accepts optional origin=lon,lat, via=lon,lat, and mode=drive|walk. Defaults to configured origin."""
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

    profile = _mode_to_profile(mode)
    try:
        result = await get_shortest_route(
            origin_lon,
            origin_lat,
            dest_lon,
            dest_lat,
            limit_miles=limit_miles,
            via_lon=via_lon,
            via_lat=via_lat,
            profile=profile,
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
    mode: str = "drive",
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

    suggest_profile = _mode_to_profile(mode)
    try:
        route_data = await get_shortest_route(
            origin_lon, origin_lat, dest_lon, dest_lat, limit_miles=limit_miles,
            profile=suggest_profile,
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
    stops: list[dict] = []
    fallback = False

    if ors_attempted:
        candidates = await get_pois_along_route(route_coords, category)
        ors_candidates = len(candidates)
        stops = select_from_ors(candidates, route_coords)
        if not stops:
            fallback = True

    if not stops:
        stops = select_from_static(route_coords, category)

    source = stops[0]["source"] if stops else "none"
    logger.info(
        "suggest-stop category=%s ors_attempted=%s ors_candidates=%d source=%s count=%d",
        category,
        ors_attempted,
        ors_candidates,
        source,
        len(stops),
    )

    return {"stops": stops, "fallback": fallback}

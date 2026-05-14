"""FastAPI backend — API shield and cache layer for Detour."""
import asyncio
import hashlib
import json as _json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from fastapi.middleware.cors import CORSMiddleware

from cache import (
    describe as cache_describe,
    get as cache_get,
    set as cache_set,
)
from config import settings
from conversion import miles_to_meters
from coords import quantize
from inflight import dedupe_inflight
from ors_client import aclose_client, get_isodistance, get_shortest_route
from poi_client import get_pois_along_route
from rate_limit import RateLimiter
from saved_tours import save_tour
from stop_selector import ORS_ELIGIBLE_CATEGORIES, get_all_places_geojson, select_from_ors, select_from_static
from tour_loader import get_tour, list_tours

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Uvicorn only configures its own loggers; app loggers propagate to root at WARNING, so INFO is dropped.
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_h)
    logger.propagate = False

@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Open/close the shared ORS HTTP client at process lifecycle boundaries.
    Also logs the on-disk cache state so ops can confirm CACHE_DIR is the
    mounted Railway Volume and not the ephemeral container filesystem."""
    state = cache_describe()
    logger.info("Cache: dir=%s files=%d ttl_hours=%d",
                state["dir"], state["files"], state["ttl_hours"])
    yield
    await aclose_client()


app = FastAPI(title="Detour API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list or [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://localhost:5175",
        "http://localhost:5176",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Rate limits per endpoint. Per-IP keeps one bad actor from drowning the
# instance; global keeps the combined traffic below the shared ORS quota.
# Numbers come from docs/LAUNCH_READINESS.md — adjust there first.
_LIMITERS: dict[str, RateLimiter] = {
    "area": RateLimiter(
        "area",
        global_limits=[(18, 60), (450, 86400)],
        ip_limits=[(6, 60), (60, 86400)],
    ),
    "route": RateLimiter(
        "route",
        global_limits=[(35, 60), (1800, 86400)],
        ip_limits=[(20, 60), (300, 86400)],
    ),
    "suggest_get": RateLimiter(
        "suggest_get",
        global_limits=[(35, 60), (1800, 86400)],
        ip_limits=[(20, 60), (300, 86400)],
    ),
    "suggest_post": RateLimiter(
        "suggest_post",
        ip_limits=[(60, 60)],
    ),
    "save_tour": RateLimiter(
        "save_tour",
        ip_limits=[(5, 60), (50, 86400)],
    ),
}


class RateLimitExceeded(Exception):
    def __init__(self, endpoint: str, retry_after: int) -> None:
        self.endpoint = endpoint
        self.retry_after = retry_after


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(_request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Surface 429s with a structured body the frontend can read directly.
    Putting `retry_after_seconds` at the top level — not nested under `detail`
    as a dict — keeps the existing `detail` string contract intact."""
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Try again shortly.",
            "retry_after_seconds": exc.retry_after,
        },
        headers={"Retry-After": str(exc.retry_after)},
    )


def _client_ip(request: Request) -> str:
    """First hop of X-Forwarded-For wins (Railway proxies set this). Fall
    back to the direct peer for local dev where there is no proxy."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _enforce(endpoint: str, request: Request) -> None:
    retry = await _LIMITERS[endpoint].check(_client_ip(request))
    if retry > 0:
        raise RateLimitExceeded(endpoint, int(retry) + 1)


@app.get("/")
def root():
    """Health check."""
    return {"status": "ok", "service": "detour-api"}


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


_area_inflight: dict[str, asyncio.Task] = {}
_route_inflight: dict[str, asyncio.Task] = {}


def _route_cache_key(
    profile: str,
    origin: tuple[float, float],
    dest: tuple[float, float],
    via: list[tuple[float, float]] | None,
) -> str:
    """Cache + dedup key for /api/route. Inputs must already be quantized.
    Via list is JSON-serialized (order-preserving) and hashed so filenames
    stay short and filesystem-safe even with the 20-stop tour cap."""
    via_hash = ""
    if via:
        via_json = _json.dumps([[v[0], v[1]] for v in via])
        via_hash = hashlib.sha256(via_json.encode()).hexdigest()[:12]
    return (
        f"route_v1_{profile}_{origin[0]}_{origin[1]}_"
        f"{dest[0]}_{dest[1]}_{via_hash}"
    )


async def _cached_shortest_route(
    key: str,
    inflight: dict[str, asyncio.Task],
    *,
    origin: tuple[float, float],
    dest: tuple[float, float],
    via: list[tuple[float, float]] | None,
    profile: str,
    limit_miles: float,
) -> dict:
    """cache-get → dedup → ORS call → cache-set. The factory writes through
    to disk so a second caller awaiting the same inflight task benefits from
    persistence on the first call's success.

    Re-raises ORS errors so existing handler-level error mapping (429/404/502)
    stays put."""
    cached = cache_get(key)
    if cached is not None:
        return cached

    async def factory() -> dict:
        result = await get_shortest_route(
            origin[0],
            origin[1],
            dest[0],
            dest[1],
            limit_miles=limit_miles,
            via_coords=via,
            profile=profile,
        )
        cache_set(key, result)
        return result

    return await dedupe_inflight(inflight, key, factory)


@app.get("/api/area")
async def get_area(
    request: Request,
    origin: str | None = None,
    mode: Literal["drive", "walk"] = "drive",
):
    """Returns a GeoJSON FeatureCollection with three concentric isodistance rings.
    Ring distances are determined by mode: drive=1/3/5 mi, walk=0.5/1/2 mi.
    Accepts optional origin=lon,lat; defaults to configured origin."""
    await _enforce("area", request)
    if origin:
        try:
            origin_lon, origin_lat = _parse_to_param(origin)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")
    else:
        origin_lon, origin_lat = quantize(settings.ORIGIN_LON, settings.ORIGIN_LAT)

    ring_miles = _RING_MILES.get(mode, _RING_MILES["drive"])
    distances_meters = [miles_to_meters(m) for m in ring_miles]

    profile = _mode_to_profile(mode)
    cache_key = f"area_rings_{profile}_{origin_lon}_{origin_lat}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    try:
        result = await dedupe_inflight(
            _area_inflight,
            cache_key,
            lambda: get_isodistance(origin_lon, origin_lat, distances_meters, profile),
        )
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
    """Parse 'lon,lat' string and quantize to the shared grid (~11 m in Santa Fe).
    Quantization happens at the API boundary so cache keys and ORS requests
    use the same canonical coords downstream. Raises ValueError if invalid."""
    try:
        parts = to.strip().split(",")
        if len(parts) != 2:
            raise ValueError("Expected lon,lat")
        lon = float(parts[0].strip())
        lat = float(parts[1].strip())
        if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
            raise ValueError("Coordinates out of range")
        return quantize(lon, lat)
    except (ValueError, IndexError) as e:
        raise ValueError(f"Invalid coordinates: {e}") from e


@app.get("/api/route")
async def get_route(
    request: Request,
    to: str,
    origin: str | None = None,
    via: list[str] | None = Query(default=None),
    miles: float | None = Query(default=None, gt=0, le=5),
    mode: Literal["drive", "walk"] = "drive",
):
    """Returns shortest route from origin to destination and within-limit verdict.
    Accepts optional origin=lon,lat, repeated via=lon,lat waypoints, and mode=drive|walk."""
    await _enforce("route", request)
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
        origin_lon, origin_lat = quantize(settings.ORIGIN_LON, settings.ORIGIN_LAT)

    via_coords: list[tuple[float, float]] = []
    for entry in (via or []):
        try:
            lon, lat = _parse_to_param(entry)
            via_coords.append((lon, lat))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid via: {e}")

    profile = _mode_to_profile(mode)
    key = _route_cache_key(
        profile, (origin_lon, origin_lat), (dest_lon, dest_lat), via_coords or None
    )
    try:
        return await _cached_shortest_route(
            key, _route_inflight,
            origin=(origin_lon, origin_lat),
            dest=(dest_lon, dest_lat),
            via=via_coords or None,
            profile=profile,
            limit_miles=limit_miles,
        )
    except ValueError as e:
        msg = str(e)
        if "rate limited" in msg.lower():
            raise HTTPException(status_code=429, detail=msg)
        if "no route" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=502, detail=msg)
    except Exception:
        logger.exception("ORS directions error")
        raise HTTPException(status_code=502, detail="Upstream routing error")


@app.get("/api/suggest-stop")
async def suggest_stop(
    request: Request,
    origin: str,
    destination: str,
    category: str | None = None,
    miles: float | None = Query(default=None, gt=0, le=5),
    mode: Literal["drive", "walk"] = "drive",
):
    """Suggest the best nearby stop along the route from origin to destination."""
    await _enforce("suggest_get", request)
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
    # Route-level cache key, not suggest-specific: an identical origin/dest/profile
    # produces the same route regardless of which stop category the user is browsing,
    # so this also benefits /api/route consumers and vice versa.
    key = _route_cache_key(
        suggest_profile, (origin_lon, origin_lat), (dest_lon, dest_lat), None
    )
    try:
        route_data = await _cached_shortest_route(
            key, _route_inflight,
            origin=(origin_lon, origin_lat),
            dest=(dest_lon, dest_lat),
            via=None,
            profile=suggest_profile,
            limit_miles=limit_miles,
        )
    except ValueError as e:
        msg = str(e)
        if "rate limited" in msg.lower():
            raise HTTPException(status_code=429, detail=msg)
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
        stops = select_from_static(route_coords, category, mode=mode)

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


class SuggestStopBody(BaseModel):
    origin: str
    destination: str
    category: str | None = None
    miles: float | None = Field(default=None, gt=0, le=5)
    mode: Literal["drive", "walk"] = "drive"
    route_coordinates: list[tuple[float, float]] | None = None

    @field_validator("route_coordinates")
    @classmethod
    def validate_route_coordinates(
        cls, v: list[tuple[float, float]] | None
    ) -> list[tuple[float, float]] | None:
        if v is None:
            return v
        for lon, lat in v:
            if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
                raise ValueError(f"Coordinate out of range: [{lon}, {lat}]")
        return v


@app.post("/api/suggest-stop")
async def suggest_stop_post(request: Request, body: SuggestStopBody):
    """Suggest stops along a route. Accepts pre-computed route_coordinates to skip the
    internal ORS route call the GET variant makes. Falls back to the GET behavior when
    route_coordinates is absent."""
    await _enforce("suggest_post", request)
    try:
        origin_lon, origin_lat = _parse_to_param(body.origin)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid origin: {e}")

    try:
        dest_lon, dest_lat = _parse_to_param(body.destination)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid destination: {e}")

    limit_miles = body.miles if body.miles is not None else settings.DEFAULT_RANGE_MILES
    suggest_profile = _mode_to_profile(body.mode)

    if body.route_coordinates and len(body.route_coordinates) >= 2:
        route_coords = body.route_coordinates
    else:
        try:
            route_data = await get_shortest_route(
                origin_lon, origin_lat, dest_lon, dest_lat,
                limit_miles=limit_miles, profile=suggest_profile,
            )
        except ValueError as e:
            msg = str(e)
            if "no route" in msg.lower():
                raise HTTPException(status_code=404, detail=msg)
            raise HTTPException(status_code=502, detail=msg)
        except Exception:
            logger.exception("ORS directions error in suggest-stop (POST)")
            raise HTTPException(status_code=502, detail="Upstream routing error")
        route_coords = route_data["route"]["geometry"]["coordinates"]

    ors_attempted = settings.USE_ORS_POIS and body.category in ORS_ELIGIBLE_CATEGORIES
    stops: list[dict] = []
    fallback = False

    if ors_attempted:
        candidates = await get_pois_along_route(route_coords, body.category)
        stops = select_from_ors(candidates, route_coords)
        if not stops:
            fallback = True

    if not stops:
        stops = select_from_static(route_coords, body.category, mode=body.mode)

    return {"stops": stops, "fallback": fallback}


@app.get("/api/pois")
def get_pois(category: str | None = None):
    """Return all POIs as a GeoJSON FeatureCollection of Points.

    Optionally filtered by category (history|art|scenic|culture|civic).
    Used by the frontend exploration layer shown before route-building.
    """
    return get_all_places_geojson(category)


@app.get("/api/tours")
def get_tours():
    """List all available pre-built tours (summary only — no geometry)."""
    return {"tours": list_tours()}


@app.get("/api/tours/{slug}")
def get_tour_by_slug(slug: str):
    """Return a full tour definition by slug, including route geometry and stops.
    Resolves curated gallery tours first, then user-saved tours on disk."""
    tour = get_tour(slug)
    if tour is None:
        raise HTTPException(status_code=404, detail=f"Tour not found: {slug}")
    return tour


class TourStopBody(BaseModel):
    order: int
    name: str = Field(min_length=1, max_length=200)
    coordinates: tuple[float, float]
    category: Literal["history", "art", "scenic", "culture", "civic"]
    description: str = Field(default="", max_length=2000)
    poi_id: str | None = None

    @field_validator("coordinates")
    @classmethod
    def validate_coordinates(cls, v: tuple[float, float]) -> tuple[float, float]:
        lon, lat = v
        if not (-180 <= lon <= 180) or not (-90 <= lat <= 90):
            raise ValueError(f"Coordinate out of range: [{lon}, {lat}]")
        return v


class TourRouteGeometry(BaseModel):
    type: Literal["LineString"]
    coordinates: list[list[float]] = Field(min_length=2, max_length=20000)


class TourRouteFeatureBody(BaseModel):
    type: Literal["Feature"]
    geometry: TourRouteGeometry
    properties: dict = Field(default_factory=dict)


class SaveTourBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    tagline: str = Field(default="", max_length=200)
    description: str = Field(default="", max_length=2000)
    mode: Literal["walk", "drive"]
    distance_miles: float = Field(ge=0, le=500)
    duration_minutes: int = Field(ge=0, le=10000)
    route: TourRouteFeatureBody
    stops: list[TourStopBody] = Field(min_length=1, max_length=20)


@app.post("/api/tours")
async def save_user_tour(request: Request, body: SaveTourBody):
    """Persist a user-built tour and return its assigned slug.

    The frontend POSTs the same TourDefinition shape it would otherwise
    have stashed in sessionStorage, gets back a slug, and navigates to
    /tours/<slug> — the existing GET handler then serves it back.
    """
    await _enforce("save_tour", request)
    payload = body.model_dump()
    try:
        slug = save_tour(payload)
    except Exception:
        logger.exception("Failed to save user tour")
        raise HTTPException(status_code=500, detail="Could not save tour")
    return {"slug": slug, "url": f"/tours/{slug}"}

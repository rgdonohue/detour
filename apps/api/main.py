"""FastAPI backend — API shield and cache layer for Detour."""
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
from fastapi.middleware.cors import CORSMiddleware

from cache import (
    get as cache_get,
    set as cache_set,
)
from config import settings
from conversion import miles_to_meters
from coords import quantize
from inflight import dedupe_inflight
from ors_client import aclose_client, get_isodistance, get_shortest_route
from poi_client import get_pois_along_route
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
    """Open/close the shared ORS HTTP client at process lifecycle boundaries."""
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
_suggest_inflight: dict[str, asyncio.Task] = {}


def _route_dedup_key(
    profile: str,
    origin: tuple[float, float],
    dest: tuple[float, float],
    via: list[tuple[float, float]] | None,
) -> str:
    """Dedup key for /api/route. Inputs must already be quantized.
    Via order is preserved — optimizeStopOrder is deterministic on the client,
    so two users picking the same stop set produce the same ordered list."""
    via_part = "|".join(f"{lon},{lat}" for lon, lat in (via or []))
    return (
        f"route_v1_{profile}_shortest_"
        f"{origin[0]},{origin[1]}__{dest[0]},{dest[1]}__{via_part}"
    )


def _suggest_dedup_key(
    profile: str,
    origin: tuple[float, float],
    dest: tuple[float, float],
    category: str | None,
    miles: float,
) -> str:
    """Dedup key for /api/suggest-stop GET (the form that triggers an internal
    ORS call). POST with route_coordinates does not need dedup — no ORS call."""
    return (
        f"suggest_v1_{profile}_{category or 'all'}_"
        f"{origin[0]},{origin[1]}__{dest[0]},{dest[1]}__{miles}"
    )


@app.get("/api/area")
async def get_area(origin: str | None = None, mode: Literal["drive", "walk"] = "drive"):
    """Returns a GeoJSON FeatureCollection with three concentric isodistance rings.
    Ring distances are determined by mode: drive=1/3/5 mi, walk=0.5/1/2 mi.
    Accepts optional origin=lon,lat; defaults to configured origin."""
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
    to: str,
    origin: str | None = None,
    via: list[str] | None = Query(default=None),
    miles: float | None = Query(default=None, gt=0, le=5),
    mode: Literal["drive", "walk"] = "drive",
):
    """Returns shortest route from origin to destination and within-limit verdict.
    Accepts optional origin=lon,lat, repeated via=lon,lat waypoints, and mode=drive|walk."""
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
    dedup_key = _route_dedup_key(
        profile, (origin_lon, origin_lat), (dest_lon, dest_lat), via_coords or None
    )
    try:
        result = await dedupe_inflight(
            _route_inflight,
            dedup_key,
            lambda: get_shortest_route(
                origin_lon,
                origin_lat,
                dest_lon,
                dest_lat,
                limit_miles=limit_miles,
                via_coords=via_coords or None,
                profile=profile,
            ),
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
    miles: float | None = Query(default=None, gt=0, le=5),
    mode: Literal["drive", "walk"] = "drive",
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
    dedup_key = _suggest_dedup_key(
        suggest_profile, (origin_lon, origin_lat), (dest_lon, dest_lat),
        category, limit_miles,
    )
    try:
        route_data = await dedupe_inflight(
            _suggest_inflight,
            dedup_key,
            lambda: get_shortest_route(
                origin_lon, origin_lat, dest_lon, dest_lat, limit_miles=limit_miles,
                profile=suggest_profile,
            ),
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
async def suggest_stop_post(body: SuggestStopBody):
    """Suggest stops along a route. Accepts pre-computed route_coordinates to skip the
    internal ORS route call the GET variant makes. Falls back to the GET behavior when
    route_coordinates is absent."""
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
def save_user_tour(body: SaveTourBody):
    """Persist a user-built tour and return its assigned slug.

    The frontend POSTs the same TourDefinition shape it would otherwise
    have stashed in sessionStorage, gets back a slug, and navigates to
    /tours/<slug> — the existing GET handler then serves it back.
    """
    payload = body.model_dump()
    try:
        slug = save_tour(payload)
    except Exception:
        logger.exception("Failed to save user tour")
        raise HTTPException(status_code=500, detail="Could not save tour")
    return {"slug": slug, "url": f"/tours/{slug}"}

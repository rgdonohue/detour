"""OpenRouteService API client — isochrones and directions.

Uses a module-level httpx.AsyncClient with connection pooling so every ORS
call doesn't pay TLS handshake. Close via aclose_client() on FastAPI shutdown.
"""
import logging
from typing import Any

import httpx

from config import settings
from conversion import miles_to_meters

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
# Match poi_client/main: app loggers propagate to root at WARNING, so INFO is dropped.
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_h)
    logger.propagate = False

ORS_BASE = "https://api.openrouteservice.org"

# One shared client for all ORS traffic (directions, isochrones, POIs).
# Limits sit comfortably above expected concurrent traffic for a single
# Railway instance; the bottleneck is ORS's own quota, not connection count.
_TIMEOUT = httpx.Timeout(connect=3.0, read=15.0, write=5.0, pool=2.0)
_LIMITS = httpx.Limits(max_connections=50, max_keepalive_connections=20)
_client = httpx.AsyncClient(timeout=_TIMEOUT, limits=_LIMITS)


def get_http_client() -> httpx.AsyncClient:
    """Module-level ORS HTTP client. Shared by ors_client and poi_client."""
    return _client


async def aclose_client() -> None:
    """Close the shared client. Wire to FastAPI shutdown."""
    await _client.aclose()


def _mock_isodistance_geojson(lon: float, lat: float, distances_meters: list[float]) -> dict:
    """Return mock GeoJSON when ORS API key is missing — one square per distance."""
    features = []
    for d in distances_meters:
        offset = (d / 1609.344) * 0.008  # rough lat/lon scale
        coords = [
            [lon - offset, lat - offset],
            [lon + offset, lat - offset],
            [lon + offset, lat + offset],
            [lon - offset, lat + offset],
            [lon - offset, lat - offset],
        ]
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [coords]},
            "properties": {
                "distance_miles": round(d / 1609.344, 2),
                "distance_meters": d,
                "computed_at": "mock",
            },
        })
    return {"type": "FeatureCollection", "features": features}


def _mock_route_response(
    origin_lon: float, origin_lat: float, dest_lon: float, dest_lat: float, limit_miles: float,
    via_coords: list[tuple[float, float]] | None = None,
) -> dict:
    """Return mock route response when ORS API key is missing."""
    coords: list[list[float]] = [[origin_lon, origin_lat]]
    for lon, lat in (via_coords or []):
        coords.append([lon, lat])
    coords.append([dest_lon, dest_lat])

    n_via = len(via_coords) if via_coords else 0
    distance_meters = 3000.0 + 1500.0 * n_via
    distance_miles = distance_meters / 1609.344
    limit_meters = miles_to_meters(limit_miles)
    within_limit = distance_meters <= limit_meters

    return {
        "route": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": coords,
            },
            "properties": {},
        },
        "distance_meters": distance_meters,
        "distance_miles": round(distance_miles, 2),
        "duration_seconds": 300 + 150 * n_via,
        "within_limit": within_limit,
        "limit_miles": limit_miles,
    }


async def get_isodistance(
    lon: float,
    lat: float,
    distances_meters: list[float],
    profile: str = "driving-car",
) -> dict:
    """
    Fetch isodistance polygons from ORS isochrones — one per value in distances_meters.
    Returns GeoJSON FeatureCollection with one feature per distance.
    """
    if not settings.ORS_API_KEY:
        logger.warning("ORS_API_KEY not set — returning mock isodistance GeoJSON")
        return _mock_isodistance_geojson(lon, lat, distances_meters)

    logger.info("ORS call isochrones profile=%s lon=%.4f lat=%.4f ranges=%s",
                profile, lon, lat, [int(d) for d in distances_meters])
    resp = await _client.post(
        f"{ORS_BASE}/v2/isochrones/{profile}",
        headers={"Authorization": settings.ORS_API_KEY},
        json={
            "locations": [[lon, lat]],
            "range": [int(d) for d in distances_meters],
            "range_type": "distance",
            "units": "m",
            "smoothing": 25,
        },
    )

    if resp.status_code == 401:
        raise ValueError("ORS API key invalid or expired")
    if resp.status_code == 429:
        raise ValueError("ORS rate limited")
    resp.raise_for_status()

    data = resp.json()
    features = data.get("features", [])

    def to_feature(f: dict) -> dict:
        # ORS tags each feature with the range value that generated it
        value_m = f.get("properties", {}).get("value", distances_meters[-1])
        return {
            "type": "Feature",
            "geometry": f.get("geometry", {}),
            "properties": {
                "distance_miles": round(value_m / 1609.344, 3),
                "distance_meters": value_m,
                "computed_at": "now",
            },
        }

    return {
        "type": "FeatureCollection",
        "features": [to_feature(f) for f in features],
    }


async def get_shortest_route(
    origin_lon: float,
    origin_lat: float,
    dest_lon: float,
    dest_lat: float,
    limit_miles: float = 3.0,
    via_coords: list[tuple[float, float]] | None = None,
    profile: str = "driving-car",
) -> dict[str, Any]:
    """
    Fetch shortest-distance route from ORS directions.
    Supports zero or more via waypoints between origin and destination.
    Returns route GeoJSON, distance_meters, distance_miles, duration_seconds, within_limit.
    CRITICAL: uses preference="shortest" — not fastest.
    """
    coordinates: list[list[float]] = [[origin_lon, origin_lat]]
    for lon, lat in (via_coords or []):
        coordinates.append([lon, lat])
    coordinates.append([dest_lon, dest_lat])

    if not settings.ORS_API_KEY:
        logger.warning("ORS_API_KEY not set — returning mock route response")
        return _mock_route_response(
            origin_lon, origin_lat, dest_lon, dest_lat, limit_miles,
            via_coords,
        )

    logger.info("ORS call directions profile=%s n_coords=%d via=%d",
                profile, len(coordinates), len(via_coords or []))
    resp = await _client.post(
        f"{ORS_BASE}/v2/directions/{profile}/geojson",
        headers={"Authorization": settings.ORS_API_KEY},
        json={
            "coordinates": coordinates,
            "preference": "shortest",
        },
    )

    if resp.status_code == 401:
        raise ValueError("ORS API key invalid or expired")
    if resp.status_code == 429:
        raise ValueError("ORS rate limited")
    if resp.status_code == 404:
        raise ValueError("No route found")
    if resp.status_code >= 500:
        raise ValueError("ORS upstream error")
    resp.raise_for_status()

    data = resp.json()
    features = data.get("features", [])
    if not features:
        raise ValueError("No route found")

    feat = features[0]
    props = feat.get("properties", {})
    summary = props.get("summary", {})
    distance_meters = summary.get("distance", 0)
    duration_seconds = summary.get("duration", 0)
    distance_miles = distance_meters / 1609.344
    limit_meters = miles_to_meters(limit_miles)
    within_limit = distance_meters <= limit_meters

    return {
        "route": {
            "type": "Feature",
            "geometry": feat.get("geometry", {}),
            "properties": {},
        },
        "distance_meters": distance_meters,
        "distance_miles": round(distance_miles, 2),
        "duration_seconds": duration_seconds,
        "within_limit": within_limit,
        "limit_miles": limit_miles,
    }

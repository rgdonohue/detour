"""OpenRouteService API client — isochrones and directions."""
import logging
from typing import Any

import httpx

from config import settings
from conversion import miles_to_meters

logger = logging.getLogger(__name__)

ORS_BASE = "https://api.openrouteservice.org"


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
    via_lon: float | None = None, via_lat: float | None = None,
) -> dict:
    """Return mock route response when ORS API key is missing."""
    coords = [[origin_lon, origin_lat]]
    if via_lon is not None and via_lat is not None:
        coords.append([via_lon, via_lat])
    coords.append([dest_lon, dest_lat])

    distance_meters = 4500.0 if via_lon is not None else 3000.0
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
        "duration_seconds": 450 if via_lon is not None else 300,
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

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ORS_BASE}/v2/isochrones/{profile}",
            headers={"Authorization": settings.ORS_API_KEY},
            json={
                "locations": [[lon, lat]],
                "range": [int(d) for d in distances_meters],
                "range_type": "distance",
                "units": "m",
                "smoothing": 25,
            },
            timeout=15.0,
        )

        if resp.status_code == 401:
            logger.warning("ORS API key invalid — returning mock isodistance GeoJSON")
            return _mock_isodistance_geojson(lon, lat, distances_meters)
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
    via_lon: float | None = None,
    via_lat: float | None = None,
    profile: str = "driving-car",
) -> dict[str, Any]:
    """
    Fetch shortest-distance route from ORS directions.
    Supports an optional via waypoint between origin and destination.
    Returns route GeoJSON, distance_meters, distance_miles, duration_seconds, within_limit.
    CRITICAL: uses preference="shortest" — not fastest.
    """
    coordinates: list[list[float]] = [[origin_lon, origin_lat]]
    if via_lon is not None and via_lat is not None:
        coordinates.append([via_lon, via_lat])
    coordinates.append([dest_lon, dest_lat])

    if not settings.ORS_API_KEY:
        logger.warning("ORS_API_KEY not set — returning mock route response")
        return _mock_route_response(
            origin_lon, origin_lat, dest_lon, dest_lat, limit_miles,
            via_lon, via_lat,
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ORS_BASE}/v2/directions/{profile}/geojson",
            headers={"Authorization": settings.ORS_API_KEY},
            json={
                "coordinates": coordinates,
                "preference": "shortest",
            },
            timeout=15.0,
        )

        if resp.status_code == 401:
            logger.warning("ORS API key invalid — returning mock route response")
            return _mock_route_response(
                origin_lon, origin_lat, dest_lon, dest_lat, limit_miles,
                via_lon, via_lat,
            )
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

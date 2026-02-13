"""OpenRouteService API client — isochrones and directions."""
import logging
from typing import Any

import httpx

from config import settings
from conversion import miles_to_meters

logger = logging.getLogger(__name__)

ORS_BASE = "https://api.openrouteservice.org"


def _mock_isodistance_geojson(lon: float, lat: float, distance_meters: float) -> dict:
    """Return mock GeoJSON when ORS API key is missing."""
    distance_miles = distance_meters / 1609.344
    # Small square around origin for mock polygon
    offset = 0.01
    coords = [
        [lon - offset, lat - offset],
        [lon + offset, lat - offset],
        [lon + offset, lat + offset],
        [lon - offset, lat + offset],
        [lon - offset, lat - offset],
    ]
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [coords]},
                "properties": {
                    "distance_miles": round(distance_miles, 2),
                    "distance_meters": distance_meters,
                    "computed_at": "mock",
                },
            }
        ],
    }


def _mock_route_response(
    origin_lon: float, origin_lat: float, dest_lon: float, dest_lat: float, limit_miles: float
) -> dict:
    """Return mock route response when ORS API key is missing."""
    # Bogus distance for mock
    distance_meters = 3000.0
    distance_miles = distance_meters / 1609.344
    limit_meters = miles_to_meters(limit_miles)
    within_limit = distance_meters <= limit_meters

    return {
        "route": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[origin_lon, origin_lat], [dest_lon, dest_lat]],
            },
            "properties": {},
        },
        "distance_meters": distance_meters,
        "distance_miles": round(distance_miles, 2),
        "duration_seconds": 300,
        "within_limit": within_limit,
        "limit_miles": limit_miles,
    }


async def get_isodistance(lon: float, lat: float, distance_meters: float) -> dict:
    """
    Fetch isodistance polygon from ORS isochrones.
    Returns GeoJSON FeatureCollection.
    """
    if not settings.ORS_API_KEY:
        logger.warning("ORS_API_KEY not set — returning mock isodistance GeoJSON")
        return _mock_isodistance_geojson(lon, lat, distance_meters)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ORS_BASE}/v2/isochrones/driving-car",
            headers={"Authorization": settings.ORS_API_KEY},
            json={
                "locations": [[lon, lat]],
                "range": [int(distance_meters)],
                "range_type": "distance",
                "units": "m",
                "smoothing": 25,
            },
            timeout=15.0,
        )

        if resp.status_code == 401:
            logger.warning("ORS API key invalid — returning mock isodistance GeoJSON")
            return _mock_isodistance_geojson(lon, lat, distance_meters)
        if resp.status_code == 429:
            raise ValueError("ORS rate limited")
        resp.raise_for_status()

    data = resp.json()
    # ORS returns features with value in properties; convert to our schema
    features = data.get("features", [])

    def to_feature(f: dict) -> dict:
        return {
            "type": "Feature",
            "geometry": f.get("geometry", {}),
            "properties": {
                "distance_miles": distance_meters / 1609.344,
                "distance_meters": distance_meters,
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
) -> dict[str, Any]:
    """
    Fetch shortest-distance route from ORS directions.
    Returns route GeoJSON, distance_meters, distance_miles, duration_seconds, within_limit.
    CRITICAL: uses preference="shortest" — not fastest.
    """
    if not settings.ORS_API_KEY:
        logger.warning("ORS_API_KEY not set — returning mock route response")
        return _mock_route_response(
            origin_lon, origin_lat, dest_lon, dest_lat, limit_miles
        )

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{ORS_BASE}/v2/directions/driving-car/geojson",
            headers={"Authorization": settings.ORS_API_KEY},
            json={
                "coordinates": [[origin_lon, origin_lat], [dest_lon, dest_lat]],
                "preference": "shortest",
            },
            timeout=15.0,
        )

        if resp.status_code == 401:
            logger.warning("ORS API key invalid — returning mock route response")
            return _mock_route_response(
                origin_lon, origin_lat, dest_lon, dest_lat, limit_miles
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

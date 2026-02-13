"""
Route-based polygon generator.

Builds a 3-mile service area boundary by running actual route checks along
radial spokes from the origin. Uses the same directions API as tap-to-check,
so the polygon aligns with the authoritative route verdict.
"""
import asyncio
import logging
import math
from typing import Any

from conversion import miles_to_meters

from ors_client import get_shortest_route

logger = logging.getLogger(__name__)

# 3 miles in meters. Never round.
LIMIT_3MI_M = miles_to_meters(3)

# Approximate meters per degree at mid-latitudes (for point-at-bearing).
M_PER_DEG_LAT = 111320
M_PER_DEG_LON_AT_35 = 111320 * math.cos(math.radians(35))  # ~91_200 at Santa Fe


def _point_at_bearing(lon: float, lat: float, distance_m: float, bearing_deg: float) -> tuple[float, float]:
    """Return (lon, lat) of a point at given distance and bearing from (lon, lat).
    Bearing: 0 = North, 90 = East. Uses simple planar approximation."""
    rad = math.radians(bearing_deg)
    dy = distance_m * math.cos(rad)
    dx = distance_m * math.sin(rad)
    lat_rad = math.radians(lat)
    m_per_deg_lon = 111320 * math.cos(lat_rad)
    new_lat = lat + (dy / M_PER_DEG_LAT)
    new_lon = lon + (dx / m_per_deg_lon)
    return (new_lon, new_lat)


async def _boundary_point_for_spoke(
    origin_lon: float,
    origin_lat: float,
    bearing_deg: float,
    limit_meters: float,
    tolerance_m: float,
) -> tuple[float, float] | None:
    """Binary search along one spoke for a point where route distance ≈ limit_meters.
    Returns (lon, lat) or None if no route (e.g. unreachable)."""
    # Search range: straight-line distance that could correspond to ~3 mi by road.
    # Road distance is usually >= straight-line, so start around 2.5–3.5 mi.
    low_m = 2500.0
    high_m = 5500.0
    best_lon, best_lat = origin_lon, origin_lat
    best_diff = float("inf")

    for _ in range(20):
        mid_m = (low_m + high_m) / 2
        dest_lon, dest_lat = _point_at_bearing(origin_lon, origin_lat, mid_m, bearing_deg)
        try:
            result = await get_shortest_route(
                origin_lon, origin_lat, dest_lon, dest_lat,
                limit_miles=limit_meters / 1609.344,
            )
        except ValueError:
            # No route (404) or rate limit / upstream error
            logger.debug("Spoke %.0f deg: no route at %.0f m", bearing_deg, mid_m)
            return None
        dist_m = result["distance_meters"]
        diff = abs(dist_m - limit_meters)
        if diff < best_diff:
            best_diff = diff
            best_lon, best_lat = dest_lon, dest_lat
        if diff <= tolerance_m:
            return (dest_lon, dest_lat)
        if dist_m > limit_meters:
            high_m = mid_m
        else:
            low_m = mid_m

    return (best_lon, best_lat) if best_diff < limit_meters * 0.1 else None


async def generate_route_based_polygon(
    origin_lon: float,
    origin_lat: float,
    limit_meters: float = LIMIT_3MI_M,
    num_spokes: int = 24,
    tolerance_m: float = 20.0,
    concurrency: int = 6,
) -> dict[str, Any]:
    """
    Generate a GeoJSON FeatureCollection (single Polygon) whose boundary is built
    from route checks along radial spokes. Uses preference="shortest" (same as tap-to-check).

    Returns dict suitable for /api/area response.
    """
    bearings = [i * (360.0 / num_spokes) for i in range(num_spokes)]

    async def run_spoke(b: float) -> tuple[float, tuple[float, float] | None]:
        pt = await _boundary_point_for_spoke(
            origin_lon, origin_lat, b, limit_meters, tolerance_m
        )
        return (b, pt)

    # Run spokes in batches to limit concurrency and respect rate limits
    points_by_bearing: list[tuple[float, tuple[float, float] | None]] = []
    for i in range(0, num_spokes, concurrency):
        batch = bearings[i : i + concurrency]
        results = await asyncio.gather(*[run_spoke(b) for b in batch])
        points_by_bearing.extend(results)
        if i + concurrency < num_spokes:
            await asyncio.sleep(0.2)

    # Build ordered ring; fill gaps (no route) with interpolated or previous point
    ordered: list[tuple[float, float]] = []
    for _, pt in sorted(points_by_bearing, key=lambda x: x[0]):
        if pt is not None:
            ordered.append(pt)
        elif ordered:
            # Reuse last valid point to keep ring closed
            ordered.append(ordered[-1])
        else:
            # First point missing: use origin offset as fallback
            ordered.append(_point_at_bearing(origin_lon, origin_lat, limit_meters * 0.9, 0))

    if not ordered:
        # All spokes failed: return tiny polygon at origin
        offset = 0.001
        ordered = [
            (origin_lon - offset, origin_lat),
            (origin_lon + offset, origin_lat),
            (origin_lon + offset, origin_lat + offset),
            (origin_lon - offset, origin_lat + offset),
            (origin_lon - offset, origin_lat),
        ]

    # Close ring
    if ordered[0] != ordered[-1]:
        ordered.append(ordered[0])

    distance_miles = limit_meters / 1609.344
    feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": [ordered]},
        "properties": {
            "distance_miles": distance_miles,
            "distance_meters": limit_meters,
            "computed_at": "route-based",
        },
    }
    return {
        "type": "FeatureCollection",
        "features": [feature],
    }

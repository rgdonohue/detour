"""Stop selection — ORS candidate ranking and static fallback."""
import csv
import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

# ORS POI suspended; restore {"art", "food"} to re-enable
ORS_ELIGIBLE_CATEGORIES: frozenset = frozenset()

_MAX_DISTANCE_MILES = 0.25
_EARTH_RADIUS_MILES = 3958.8
_VALID_CATEGORIES: frozenset = frozenset({"history", "art", "scenic", "culture", "civic"})

# Single merged CSV produced by the sister POI curator project. Replaces the
# previous two-file split (seed + context) — `address` is now a real column,
# so we no longer parse OSM tags out of a raw_tags_json blob.
_CSV_PATH = Path(__file__).parent / "data" / "query_capable_pois_merged_v1.csv"


def _load_places() -> list[dict]:
    places = []
    seen_dedupe_keys: set[str] = set()
    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["name"] == "?" or row["primary_category"] == "food":
                continue
            if row["primary_category"] not in _VALID_CATEGORIES:
                continue
            # Skip duplicate physical locations (same OSM entity, different CSV rows)
            dedupe_key = (row.get("dedupe_key") or "").strip()
            if dedupe_key and dedupe_key in seen_dedupe_keys:
                continue
            if dedupe_key:
                seen_dedupe_keys.add(dedupe_key)
            try:
                lon = float(row["lon"])
                lat = float(row["lat"])
            except (ValueError, KeyError):
                continue
            walk_affinity = float(row["walk_affinity_hint"]) if row.get("walk_affinity_hint") else 0.5
            drive_affinity = float(row["drive_affinity_hint"]) if row.get("drive_affinity_hint") else 0.5
            try:
                quality_score = float(row["quality_score"]) if row.get("quality_score") else 50.0
            except ValueError:
                quality_score = 50.0
            try:
                display_priority = int(row["display_priority"]) if row.get("display_priority") else 50
            except ValueError:
                display_priority = 50
            wikipedia_title = (row.get("wikipedia_title") or "").strip() or None
            poi_id = (row.get("poi_id") or "").strip() or None
            places.append({
                "poi_id": poi_id,
                "name": row["name"],
                "category": row["primary_category"],
                "coordinates": [lon, lat],
                "description": row["short_description"] or None,
                "wikipedia_title": wikipedia_title,
                "walk_affinity_hint": walk_affinity,
                "drive_affinity_hint": drive_affinity,
                "quality_score": quality_score,
                "display_priority": display_priority,
                "description_map": (row.get("description_map_v1") or "").strip() or None,
                "description_card": (row.get("description_card_v1") or "").strip() or None,
                "subcategory": (row.get("description_subcategory_v1") or "").strip() or None,
                "confidence": (row.get("description_confidence_v1") or "").strip() or None,
                "basis": (row.get("description_basis_v1") or "").strip() or None,
                "address": (row.get("address") or "").strip() or None,
            })
    logger.info("Loaded %d places from seed CSV", len(places))
    return places


_STATIC_PLACES: list[dict] = _load_places()


def get_all_places_geojson(category: str | None = None) -> dict:
    """Return all POIs as a GeoJSON FeatureCollection of Points.

    Optionally filtered by primary_category. Used by the /api/pois endpoint
    to power the always-visible exploration layer on the map.
    """
    pois = (
        [p for p in _STATIC_PLACES if p["category"] == category]
        if category else _STATIC_PLACES
    )
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": p["coordinates"]},
                "properties": {
                    "name": p["name"],
                    "category": p["category"],
                    "wikipedia_title": p["wikipedia_title"],
                    "quality_score": p["quality_score"],
                    "description_map": p["description_map"],
                    "description_card": p["description_card"],
                    "subcategory": p["subcategory"],
                    "confidence": p["confidence"],
                    "basis": p["basis"],
                    "address": p.get("address"),
                },
            }
            for p in pois
        ],
    }


def _haversine_miles(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Haversine great-circle distance in miles. 1 mile = 1609.344 meters exactly."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return _EARTH_RADIUS_MILES * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _min_dist_to_route(lon: float, lat: float, route_coords: list[list[float]]) -> float:
    """Minimum haversine distance from a point to any vertex in the route."""
    return min(_haversine_miles(lon, lat, c[0], c[1]) for c in route_coords)


def _min_dist_to_route_with_index(
    lon: float, lat: float, route_coords: list[list[float]]
) -> tuple[float, int]:
    """Return (min_distance_miles, closest_vertex_index) for a point against the route."""
    best_dist = math.inf
    best_idx = 0
    for i, c in enumerate(route_coords):
        d = _haversine_miles(lon, lat, c[0], c[1])
        if d < best_dist:
            best_dist = d
            best_idx = i
    return best_dist, best_idx


def select_from_ors(
    candidates: list[dict],
    route_coords: list[list[float]],
    top_n: int = 5,
) -> list[dict]:
    """Return the top_n closest ORS POI features within 1 mile of the route."""
    scored: list[tuple[float, dict]] = []

    for feature in candidates:
        try:
            lon, lat = feature["geometry"]["coordinates"][:2]
        except (KeyError, TypeError, ValueError):
            continue
        dist = _min_dist_to_route(lon, lat, route_coords)
        if dist <= _MAX_DISTANCE_MILES:
            props = feature.get("properties", {})
            osm_tags = props.get("osm_tags", {})
            category_ids = props.get("category_ids", {})
            category_raw = next(
                (v.get("category_group", "") for v in category_ids.values()), ""
            )
            scored.append((dist, {
                "name": osm_tags.get("name", ""),
                "category": category_raw,
                "coordinates": [lon, lat],
                "description": None,
                "distance_miles": dist,
                "source": "ors",
                "source_category_note": None,
            }))

    scored.sort(key=lambda x: x[0])
    return [s[1] for s in scored[:top_n]]


def select_from_static(
    route_coords: list[list[float]],
    category: str | None,
    top_n: int = 5,  # kept for ORS fallback compat; ignored for static results
    mode: str = "drive",
) -> list[dict]:
    """Return all static places within 0.25 miles of the route, ordered origin-to-destination.

    Each result includes a route_position (closest vertex index) so the caller and
    frontend can rely on the list being in geographic sequence along the route.
    """
    candidates = (
        [p for p in _STATIC_PLACES if p["category"] == category]
        if category
        else _STATIC_PLACES
    )

    results: list[dict] = []

    for place in candidates:
        lon, lat = place["coordinates"]
        dist, route_pos = _min_dist_to_route_with_index(lon, lat, route_coords)
        if dist <= _MAX_DISTANCE_MILES:
            results.append({
                "poi_id": place["poi_id"],
                "name": place["name"],
                "category": place["category"],
                "coordinates": place["coordinates"],
                "description": place["description"],
                "distance_miles": dist,
                "route_position": route_pos,
                "source": "static",
                "source_category_note": None,
                # Rich description fields (already loaded in _load_places)
                "description_map": place.get("description_map"),
                "description_card": place.get("description_card"),
                "subcategory": place.get("subcategory"),
                "confidence": place.get("confidence"),
                "basis": place.get("basis"),
                "wikipedia_title": place.get("wikipedia_title"),
                "address": place.get("address"),
            })

    results.sort(key=lambda x: x["route_position"])
    return results

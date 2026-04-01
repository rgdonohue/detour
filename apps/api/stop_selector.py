"""Stop selection — ORS candidate ranking and static fallback."""
import logging
import math

logger = logging.getLogger(__name__)

# ORS POIs are only attempted for these categories.
ORS_ELIGIBLE_CATEGORIES: frozenset = frozenset({"art", "food"})

_MAX_DISTANCE_MILES = 1.0
_EARTH_RADIUS_MILES = 3958.8

# TODO: move to shared GeoJSON file — duplicated from apps/web/src/data/places.ts
_STATIC_PLACES: list[dict] = [
    {"name": "San Miguel Chapel", "category": "history", "coordinates": [-105.9374, 35.6808], "description": "Oldest church structure in the US, built around 1610"},
    {"name": "Palace of the Governors", "category": "history", "coordinates": [-105.9398, 35.6872], "description": "Oldest continuously occupied public building in the US"},
    {"name": "Loretto Chapel", "category": "history", "coordinates": [-105.9379, 35.6853], "description": "Famous for its mysterious spiral staircase"},
    {"name": "Canyon Road Galleries", "category": "art", "coordinates": [-105.9295, 35.6815], "description": "Half-mile stretch with over 100 galleries and studios"},
    {"name": "Georgia O'Keeffe Museum", "category": "art", "coordinates": [-105.9420, 35.6879], "description": "Dedicated to Georgia O'Keeffe and American Modernism"},
    {"name": "Cathedral Basilica of St. Francis", "category": "history", "coordinates": [-105.9382, 35.6868], "description": "Romanesque Revival cathedral, centerpiece of downtown"},
    {"name": "Santa Fe Plaza", "category": "culture", "coordinates": [-105.9395, 35.6870], "description": "Historic heart of the city since 1610"},
    {"name": "Cross of the Martyrs", "category": "scenic", "coordinates": [-105.9440, 35.6900], "description": "Hilltop cross with panoramic views of the Sangre de Cristos"},
    {"name": "Museum of International Folk Art", "category": "culture", "coordinates": [-105.9223, 35.6714], "description": "World's largest collection of international folk art"},
    {"name": "Meow Wolf", "category": "art", "coordinates": [-105.9621, 35.6604], "description": "Immersive art experience in a converted bowling alley"},
    {"name": "Railyard Arts District", "category": "art", "coordinates": [-105.9444, 35.6830], "description": "Galleries, studios, and the Saturday farmers market"},
    {"name": "Museum of Indian Arts & Culture", "category": "culture", "coordinates": [-105.9225, 35.6720], "description": "Stories of Native peoples of the Southwest from prehistory to today"},
    {"name": "El Santuario de Guadalupe", "category": "history", "coordinates": [-105.9435, 35.6845], "description": "Oldest shrine to Our Lady of Guadalupe in the US"},
    {"name": "Cafe Pasqual's", "category": "food", "coordinates": [-105.9394, 35.6867], "description": "Iconic Santa Fe restaurant with creative New Mexican cuisine since 1979"},
    {"name": "The Shed", "category": "food", "coordinates": [-105.9383, 35.6877], "description": "Beloved local spot for red and green chile since 1953"},
    {"name": "Santa Fe River Trail", "category": "scenic", "coordinates": [-105.9437, 35.6836], "description": "Paved trail following the Santa Fe River through the city center"},
    {"name": "Dale Ball Trails", "category": "scenic", "coordinates": [-105.9130, 35.6880], "description": "20+ miles of trails in pinon-juniper foothills with mountain views"},
    {"name": "Lensic Performing Arts Center", "category": "culture", "coordinates": [-105.9412, 35.6862], "description": "Restored 1931 movie palace, now Santa Fe's premier performance venue"},
    {"name": "Oldest House", "category": "history", "coordinates": [-105.9372, 35.6806], "description": "Adobe structure dating to around 1646, among the oldest in the US"},
    {"name": "Kakawa Chocolate House", "category": "food", "coordinates": [-105.9374, 35.6857], "description": "Historic chocolate elixirs and handcrafted truffles"},
]


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


def select_from_ors(
    candidates: list[dict],
    route_coords: list[list[float]],
) -> dict | None:
    """Return the closest ORS POI feature within 1 mile of the route, or None."""
    best: dict | None = None
    best_dist = _MAX_DISTANCE_MILES

    for feature in candidates:
        try:
            lon, lat = feature["geometry"]["coordinates"][:2]
        except (KeyError, TypeError, ValueError):
            continue
        dist = _min_dist_to_route(lon, lat, route_coords)
        if dist < best_dist:
            best_dist = dist
            props = feature.get("properties", {})
            osm_tags = props.get("osm_tags", {})
            category_ids = props.get("category_ids", {})
            category_raw = next(
                (v.get("category_group", "") for v in category_ids.values()), ""
            )
            best = {
                "name": osm_tags.get("name", ""),
                "category": category_raw,
                "coordinates": [lon, lat],
                "description": None,
                "distance_miles": dist,
                "source": "ors",
                "source_category_note": None,
            }

    return best


def select_from_static(
    route_coords: list[list[float]],
    category: str | None,
) -> dict | None:
    """Return the closest static place within 1 mile of the route, or None."""
    candidates = (
        [p for p in _STATIC_PLACES if p["category"] == category]
        if category
        else _STATIC_PLACES
    )

    best: dict | None = None
    best_dist = _MAX_DISTANCE_MILES

    for place in candidates:
        lon, lat = place["coordinates"]
        dist = _min_dist_to_route(lon, lat, route_coords)
        if dist < best_dist:
            best_dist = dist
            best = {
                "name": place["name"],
                "category": place["category"],
                "coordinates": place["coordinates"],
                "description": place["description"],
                "distance_miles": dist,
                "source": "static",
                "source_category_note": "approximate" if category in ("scenic", "culture") else None,
            }

    return best

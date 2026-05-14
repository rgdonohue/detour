"""ORS POI client — queries POIs along a route corridor."""
import logging

from config import settings
from ors_client import ORS_BASE, get_http_client

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s:%(message)s"))
    logger.addHandler(_h)
    logger.propagate = False

# ORS POI service is only available on the public API host.
_POI_HOST = "api.openrouteservice.org"
_POI_URL = f"https://{_POI_HOST}/pois"

_CATEGORY_MAP: dict[str, dict] = {
    "art":  {"category_ids": [131, 132, 134, 621]},
    "food": {"category_ids": [561, 563, 564, 569, 570]},
}


async def get_pois_along_route(
    route_coords: list[list[float]],
    category: str | None,
    buffer_meters: int = 500,
) -> list[dict]:
    """Return named POIs within buffer_meters of the route LineString.

    Returns [] on any error. scenic and culture must not reach this function.
    """
    if _POI_HOST not in ORS_BASE:
        logger.warning(
            "ORS POI service unavailable: configured ORS host %s is not the public API",
            ORS_BASE,
        )
        return []

    if not settings.ORS_API_KEY:
        logger.debug("ORS_API_KEY not set — skipping POI query")
        return []

    if category not in _CATEGORY_MAP:
        logger.error("get_pois_along_route called with ineligible category=%s", category)
        return []

    filters = _CATEGORY_MAP[category]

    body: dict = {
        "request": "pois",
        "geometry": {
            "geojson": {"type": "LineString", "coordinates": route_coords},
            "buffer": buffer_meters,
        },
        "filters": filters,
        "limit": 30,
        "sortby": "distance",
    }

    try:
        logger.info("ORS call pois category=%s buffer_m=%d", category, buffer_meters)
        resp = await get_http_client().post(
            _POI_URL,
            headers={"Authorization": settings.ORS_API_KEY},
            json=body,
            timeout=5.0,
        )
        if not resp.is_success:
            logger.warning(
                "ORS POI request failed: %s — body: %s",
                resp.status_code,
                resp.text[:500],
            )
            return []
        data = resp.json()
    except Exception as e:
        logger.warning("ORS POI request failed: %s", e)
        return []

    features = data.get("features", [])
    named = [
        f for f in features
        if (n := f.get("properties", {}).get("osm_tags", {}).get("name", ""))
        and not n.isdigit()
    ]
    logger.info("ORS POI raw=%d named=%d", len(features), len(named))
    return named

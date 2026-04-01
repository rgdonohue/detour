"""ORS POI client — queries POIs along a route corridor."""
import logging

import httpx

from config import settings
from ors_client import ORS_BASE

logger = logging.getLogger(__name__)

# ORS POI service is only available on the public API host.
_POI_HOST = "api.openrouteservice.org"
_POI_URL = f"https://{_POI_HOST}/pois"

_CATEGORY_MAP: dict[str, dict] = {
    "history": {"category_ids": [223, 224, 228, 237, 239, 240, 243]},
    "art":     {"category_ids": [131, 132, 134, 621]},
    "food":    {"category_ids": [561, 563, 564, 569, 570]},
}
# None (Any) uses category_group_ids instead of category_ids
_ANY_FILTER: dict = {"category_group_ids": [130, 220, 260, 330, 560, 620]}


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

    if category in ("scenic", "culture"):
        logger.error("get_pois_along_route called with ineligible category=%s", category)
        return []

    filters = _CATEGORY_MAP.get(category) if category else _ANY_FILTER

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
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _POI_URL,
                headers={"Authorization": settings.ORS_API_KEY},
                json=body,
                timeout=5.0,
            )
            resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("ORS POI request failed: %s", e)
        return []

    features = data.get("features", [])
    return [f for f in features if f.get("properties", {}).get("name")]

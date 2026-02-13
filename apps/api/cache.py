"""Simple in-memory cache with TTL and optional file persistence."""
import json
import logging
import time
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

# Project root cache/ directory
CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "cache"

_store: dict[str, tuple[Any, float]] = {}
_ttl_seconds: float = settings.CACHE_TTL_HOURS * 3600


def get(key: str) -> Any | None:
    """Return cached value if present and not expired."""
    if key not in _store:
        return None
    val, expires_at = _store[key]
    if time.time() > expires_at:
        del _store[key]
        return None
    return val


def set(key: str, value: Any, ttl_seconds: float | None = None) -> None:
    """Store value with TTL. Optionally persist to file for GeoJSON."""
    ttl = ttl_seconds if ttl_seconds is not None else _ttl_seconds
    _store[key] = (value, time.time() + ttl)

    # Persist GeoJSON to cache/ for area polygons
    if key.startswith("area_") and isinstance(value, dict):
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            filepath = CACHE_DIR / f"{key}.geojson"
            with open(filepath, "w") as f:
                json.dump(value, f, indent=2)
        except OSError as e:
            logger.warning("Failed to write cache file %s: %s", filepath, e)


def invalidate(key: str) -> None:
    """Remove key from cache."""
    if key in _store:
        del _store[key]
    filepath = CACHE_DIR / f"{key}.geojson"
    if filepath.exists():
        try:
            filepath.unlink()
        except OSError as e:
            logger.warning("Failed to remove cache file %s: %s", filepath, e)


def get_route_based_polygon(miles: float) -> dict | None:
    """
    Return route-based polygon from file cache if present.
    File name: area_{miles}mi_route.geojson (e.g. area_3mi_route.geojson).
    Does not use in-memory TTL; file is authoritative until regenerated.
    """
    key = f"area_{miles}mi_route"
    # Check in-memory first
    val = get(key)
    if val is not None:
        return val
    filepath = CACHE_DIR / f"{key}.geojson"
    if not filepath.exists():
        return None
    try:
        with open(filepath) as f:
            data = json.load(f)
        # Optionally prime in-memory cache
        set(key, data)
        return data
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read route-based polygon from %s: %s", filepath, e)
        return None


def set_route_based_polygon(miles: float, value: dict) -> None:
    """Write route-based polygon to file and in-memory cache."""
    key = f"area_{miles}mi_route"
    set(key, value)
    # set() already writes area_* to .geojson; key is area_3mi_route so file is area_3mi_route.geojson

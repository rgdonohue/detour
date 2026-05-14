"""In-memory cache with TTL and disk persistence.

Disk-persist any cached dict so route and area responses survive process
restarts (which Railway does on every deploy). Files land in `cache_dir()`
— configured via the `CACHE_DIR` env var, otherwise the repo-relative
`./cache` directory.

Filenames: `.json` for new writes. Reads also try `.geojson` for backward
compatibility with the area-only cache that existed before task 2.
"""
import json
import logging
import time
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)


def cache_dir() -> Path:
    """Resolve the cache directory. Env-configured CACHE_DIR wins; otherwise
    fall back to the repo-relative ./cache directory."""
    if settings.CACHE_DIR.strip():
        return Path(settings.CACHE_DIR).expanduser().resolve()
    return Path(__file__).resolve().parent.parent.parent / "cache"


# Module-level alias preserved for older callers that imported the constant
# directly. Resolves once at import; tests that monkeypatch settings.CACHE_DIR
# should call cache_dir() instead of relying on this binding.
CACHE_DIR = cache_dir()

_store: dict[str, tuple[Any, float]] = {}


def _ttl_seconds() -> float:
    return settings.CACHE_TTL_HOURS * 3600


def _disk_path(key: str) -> Path:
    """Canonical on-disk path for a key (.json)."""
    return cache_dir() / f"{key}.json"


def _legacy_disk_path(key: str) -> Path:
    """Pre-task-2 path for area_* keys (.geojson). Read-only fallback."""
    return cache_dir() / f"{key}.geojson"


def get(key: str) -> Any | None:
    """Return cached value if present and not expired. Falls back to disk on
    in-memory miss (survives restarts). Tries `.json` first, then `.geojson`."""
    if key in _store:
        val, expires_at = _store[key]
        if time.time() > expires_at:
            del _store[key]
        else:
            return val

    for filepath in (_disk_path(key), _legacy_disk_path(key)):
        try:
            mtime = filepath.stat().st_mtime
        except OSError:
            continue
        if time.time() - mtime > _ttl_seconds():
            continue
        try:
            with open(filepath) as f:
                data = json.load(f)
            _store[key] = (data, mtime + _ttl_seconds())
            return data
        except (OSError, json.JSONDecodeError) as e:
            logger.warning("Failed to read cache file %s: %s", filepath, e)

    return None


def set(key: str, value: Any, ttl_seconds: float | None = None) -> None:
    """Store value with TTL. Persists any dict value to disk as JSON."""
    ttl = ttl_seconds if ttl_seconds is not None else _ttl_seconds()
    _store[key] = (value, time.time() + ttl)

    if isinstance(value, dict):
        directory = cache_dir()
        try:
            directory.mkdir(parents=True, exist_ok=True)
            filepath = _disk_path(key)
            with open(filepath, "w") as f:
                json.dump(value, f)
        except OSError as e:
            logger.warning("Failed to write cache file %s: %s", filepath, e)


def invalidate(key: str) -> None:
    """Remove key from cache (memory + disk)."""
    if key in _store:
        del _store[key]
    for filepath in (_disk_path(key), _legacy_disk_path(key)):
        if filepath.exists():
            try:
                filepath.unlink()
            except OSError as e:
                logger.warning("Failed to remove cache file %s: %s", filepath, e)


def describe() -> dict[str, Any]:
    """Summary of the on-disk cache state. Useful for startup logs and ops."""
    directory = cache_dir()
    try:
        files = list(directory.glob("*.json")) + list(directory.glob("*.geojson"))
    except OSError:
        files = []
    return {
        "dir": str(directory),
        "files": len(files),
        "ttl_hours": settings.CACHE_TTL_HOURS,
    }


def get_route_based_polygon(miles: float) -> dict | None:
    """Return route-based polygon from file cache if present.
    File name: area_{miles}mi_route.geojson (legacy, pre-task-2)."""
    key = f"area_{miles}mi_route"
    val = get(key)
    if val is not None:
        return val
    filepath = _legacy_disk_path(key)
    if not filepath.exists():
        return None
    try:
        with open(filepath) as f:
            data = json.load(f)
        set(key, data)
        return data
    except (OSError, json.JSONDecodeError) as e:
        logger.warning("Failed to read route-based polygon from %s: %s", filepath, e)
        return None


def set_route_based_polygon(miles: float, value: dict) -> None:
    """Write route-based polygon to file and in-memory cache."""
    key = f"area_{miles}mi_route"
    set(key, value)

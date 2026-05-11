"""Tour loader — reads pre-authored tour JSON files at startup.

Gallery tours (curated, committed) load eagerly at import time.
User-saved tours (from POST /api/tours) are looked up on demand via
`saved_tours.load_saved_tour`.
"""
import json
import logging
from pathlib import Path

from saved_tours import load_saved_tour

logger = logging.getLogger(__name__)

_TOURS_DIR = Path(__file__).parent / "data" / "tours"

_SUMMARY_KEYS = {"slug", "name", "tagline", "mode", "distance_miles", "duration_minutes"}


def _load_tours() -> dict[str, dict]:
    tours: dict[str, dict] = {}
    if not _TOURS_DIR.exists():
        logger.warning("Tours directory not found: %s", _TOURS_DIR)
        return tours
    for path in sorted(_TOURS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            slug = data.get("slug")
            if not slug:
                logger.warning("Tour file missing slug, skipping: %s", path.name)
                continue
            # Derive stop_count from the stops array
            data.setdefault("stop_count", len(data.get("stops", [])))
            tours[slug] = data
            logger.info("Loaded tour: %s (%d stops)", slug, data["stop_count"])
        except Exception:
            logger.exception("Failed to load tour file: %s", path.name)
    return tours


_TOURS: dict[str, dict] = _load_tours()


def list_tours() -> list[dict]:
    """Return summary metadata for all tours (no route geometry, no stop details)."""
    return [
        {k: v for k, v in tour.items() if k in _SUMMARY_KEYS | {"stop_count"}}
        for tour in _TOURS.values()
    ]


def get_tour(slug: str) -> dict | None:
    """Return the full tour definition by slug, or None if not found.

    Checks the curated in-memory dict first, then falls through to
    user-saved tours on disk.
    """
    if slug in _TOURS:
        return _TOURS[slug]
    return load_saved_tour(slug)

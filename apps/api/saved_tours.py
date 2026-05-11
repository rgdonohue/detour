"""Saved-tour storage — user-created tours written as JSON files.

Curated gallery tours live in `data/tours/` and ship with the repo.
User-saved tours live in `data/saved_tours/` and are gitignored.

Reads fall through to this module from `tour_loader.get_tour` when a
slug isn't found in the in-memory gallery dict.
"""
import json
import logging
import re
import secrets
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_SAVED_DIR = Path(__file__).parent / "data" / "saved_tours"
_SAVED_DIR.mkdir(parents=True, exist_ok=True)

# 8-char URL-safe slug (token_urlsafe(6) → 8 chars from [A-Za-z0-9_-]).
# Validated on read so the slug can't traverse the filesystem.
_SLUG_RE = re.compile(r"^[A-Za-z0-9_-]{6,16}$")


def _new_slug() -> str:
    return secrets.token_urlsafe(6)


def save_tour(payload: dict[str, Any]) -> str:
    """Persist a tour payload to disk and return its assigned slug.

    The caller's `slug` field (if any) is overwritten — the server is
    authoritative for slug assignment so anonymous clients can't collide
    or overwrite each other's tours.
    """
    # Avoid astronomically-unlikely collisions explicitly.
    for _ in range(5):
        slug = _new_slug()
        path = _SAVED_DIR / f"{slug}.json"
        if not path.exists():
            break
    else:
        raise RuntimeError("Could not allocate a unique slug after 5 attempts")

    payload = {**payload, "slug": slug}
    payload.setdefault("stop_count", len(payload.get("stops", [])))
    path.write_text(json.dumps(payload), encoding="utf-8")
    logger.info("Saved tour: %s (%d stops)", slug, payload["stop_count"])
    return slug


def load_saved_tour(slug: str) -> dict | None:
    """Return a saved tour by slug, or None if missing/invalid.

    Rejects slugs that don't match the allowed character set — prevents
    path traversal and accidental probing of unrelated files.
    """
    if not _SLUG_RE.match(slug):
        return None
    path = _SAVED_DIR / f"{slug}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to read saved tour: %s", slug)
        return None

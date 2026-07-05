"""Saved-tour storage — user-created tours written as JSON files.

Curated gallery tours live in `data/tours/` and ship with the repo.
User-saved tours live in `data/saved_tours/` and are gitignored.

Reads fall through to this module from `tour_loader.get_tour` when a
slug isn't found in the in-memory gallery dict.
"""
import json
import logging
import os
import re
import secrets
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

# Path is env-driven so production can point it at a mounted volume
# (Railway containers have ephemeral filesystems — without a volume,
# every deploy wipes user-saved tours). Defaults to a repo-relative
# path so dev and tests just work.
_DEFAULT_SAVED_DIR = Path(__file__).parent / "data" / "saved_tours"
_SAVED_DIR = Path(os.environ.get("SAVED_TOURS_DIR", str(_DEFAULT_SAVED_DIR)))
_SAVED_DIR.mkdir(parents=True, exist_ok=True)
logger.info("Saved tours dir: %s", _SAVED_DIR)

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
    try:
        prune_saved_tours(keep=path)
    except Exception:
        # The tour is already on disk; a prune failure must not turn a
        # successful save into a 500.
        logger.exception("Saved-tour pruning failed (save succeeded)")
    return slug


def prune_saved_tours(keep: Path | None = None) -> int:
    """Enforce the SAVED_TOURS_MAX_FILES soft cap; return files deleted.

    Only slug-shaped `*.json` files directly in the saved-tours dir are
    eligible — curated gallery tours live elsewhere (`data/tours/`), and
    anything that doesn't look like a saved tour is left alone. Content is
    never parsed: ordering is oldest-mtime-first (filename tiebreak), so
    malformed files age out like any other. `keep` is never deleted.

    Count-based automation only; age-based cleanup stays a manual operator
    action via `tour_admin.py prune --older-than`.
    """
    cap = settings.SAVED_TOURS_MAX_FILES
    if cap <= 0:
        return 0
    candidates = [
        p for p in _SAVED_DIR.glob("*.json") if p.is_file() and _SLUG_RE.match(p.stem)
    ]
    excess = len(candidates) - cap
    if excess <= 0:
        return 0
    candidates.sort(key=lambda p: (p.stat().st_mtime, p.name))
    deleted = 0
    for path in candidates:
        if deleted >= excess:
            break
        if keep is not None and path == keep:
            continue
        try:
            path.unlink(missing_ok=True)
            deleted += 1
            logger.info("Pruned saved tour over cap: %s", path.stem)
        except OSError:
            logger.warning("Could not prune saved tour: %s", path.name, exc_info=True)
    return deleted


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

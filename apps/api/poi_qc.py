"""POI QC gate — independent verification of a curator POI CSV before promotion.

Pure, importable checks: no I/O side effects, no sys.exit. The CLI wrapper lives
in scripts/qc_pois.py. See docs/superpowers/specs/2026-06-01-poi-qc-gate-design.md.
"""
from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED_COLUMNS = [
    "poi_id", "dedupe_key", "name", "lon", "lat", "primary_category",
    "display_priority", "quality_score", "walk_affinity_hint",
    "drive_affinity_hint", "wikipedia_title", "short_description",
    "description_map_v1", "description_card_v1", "description_subcategory_v1",
    "description_confidence_v1", "description_basis_v1", "address",
]

VALID_CATEGORIES = frozenset({"history", "art", "scenic", "culture", "civic"})
UNUSABLE_NAMES = frozenset({"", "?", "unknown", "unnamed", "n/a", "none", "null"})

# Tokens that must not, on their own, link two rows as the same feature.
# Keep in sync with the curator's equivalent list.
GENERIC_TOKENS = frozenset({
    "house", "park", "building", "gallery", "studio",
    "north", "south", "east", "west", "the", "of", "and",
})

# Santa Fe sanity bounding box — a gross-error guard, not a municipal boundary.
MIN_LON, MAX_LON = -106.10, -105.80
MIN_LAT, MAX_LAT = 35.55, 35.78

CLUSTER_RADIUS_M = 35.0
EARTH_RADIUS_M = 6_371_000.0

_TOKEN_SPLIT = re.compile(r"[^a-z0-9]+")


def significant_tokens(name: str) -> set[str]:
    """Lowercase name tokens with generic/structural words and 1-char tokens removed."""
    tokens = _TOKEN_SPLIT.split(name.casefold())
    return {t for t in tokens if len(t) > 1 and t not in GENERIC_TOKENS}


def haversine_m(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    """Great-circle distance in meters."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    return EARTH_RADIUS_M * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def check_schema(fieldnames: list[str] | None) -> list[str]:
    """Return one failure message per missing required column. Extra columns are allowed."""
    present = set(fieldnames or [])
    return [
        f"missing required column: {col}"
        for col in REQUIRED_COLUMNS if col not in present
    ]

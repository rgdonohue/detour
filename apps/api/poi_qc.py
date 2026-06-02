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


@dataclass
class PoiRow:
    index: int          # 1-based data line number (header is line 1)
    poi_id: str
    dedupe_key: str     # dedupe_key, or poi_id when dedupe_key is blank
    name: str
    category: str
    lon: float
    lat: float
    tokens: set[str] = field(default_factory=set)


def parse_rows(raw_rows: list[dict[str, str]]) -> tuple[list[PoiRow], list[str]]:
    """Validate and parse raw CSV rows. Returns (clean rows, failure messages).

    A row with non-numeric or out-of-bbox coordinates is dropped from the clean
    list (it cannot be clustered) but still recorded as a failure.
    """
    parsed: list[PoiRow] = []
    failures: list[str] = []
    seen_keys: dict[str, int] = {}

    for i, raw in enumerate(raw_rows, start=2):
        name = (raw.get("name") or "").strip()
        category = (raw.get("primary_category") or "").strip()
        dedupe_key = (raw.get("dedupe_key") or "").strip()
        poi_id = (raw.get("poi_id") or "").strip()

        if name.casefold() in UNUSABLE_NAMES:
            failures.append(f"line {i}: unusable name {name!r}")
        if category not in VALID_CATEGORIES:
            failures.append(f"line {i}: invalid category {category!r}")

        key = dedupe_key or poi_id
        if not key:
            failures.append(f"line {i}: missing dedupe_key and poi_id")
        elif key in seen_keys:
            failures.append(
                f"line {i}: duplicate dedupe_key {key!r} (first seen line {seen_keys[key]})"
            )
        else:
            seen_keys[key] = i

        try:
            lon = float(raw.get("lon", ""))
            lat = float(raw.get("lat", ""))
        except (TypeError, ValueError):
            failures.append(
                f"line {i}: lon/lat not numeric ({raw.get('lon')!r}, {raw.get('lat')!r})"
            )
            continue

        if not (MIN_LON <= lon <= MAX_LON and MIN_LAT <= lat <= MAX_LAT):
            failures.append(
                f"line {i}: coords outside Santa Fe bbox or wrong order ({lon}, {lat})"
            )
            continue

        parsed.append(PoiRow(
            index=i, poi_id=poi_id, dedupe_key=key, name=name,
            category=category, lon=lon, lat=lat, tokens=significant_tokens(name),
        ))

    return parsed, failures


def _make_parent(n: int) -> list[int]:
    return list(range(n))


def _find(parent: list[int], x: int) -> int:
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


def _union(parent: list[int], a: int, b: int) -> None:
    ra, rb = _find(parent, a), _find(parent, b)
    if ra != rb:
        parent[ra] = rb


def _components(parent: list[int], rows: list[PoiRow]) -> list[list[PoiRow]]:
    groups: dict[int, list[PoiRow]] = {}
    for i in range(len(rows)):
        groups.setdefault(_find(parent, i), []).append(rows[i])
    return list(groups.values())


def find_residual_clusters(
    rows: list[PoiRow], radius_m: float = CLUSTER_RADIUS_M,
) -> list[list[PoiRow]]:
    """Connected components where rows are within radius AND share a significant token.

    These are suspected same-feature duplicates. Two rows never merge on proximity
    alone (no shared token) or on name alone (beyond radius).
    """
    n = len(rows)
    parent = _make_parent(n)
    for i in range(n):
        for j in range(i + 1, n):
            if not (rows[i].tokens & rows[j].tokens):
                continue
            if haversine_m(rows[i].lon, rows[i].lat, rows[j].lon, rows[j].lat) <= radius_m:
                _union(parent, i, j)
    return [g for g in _components(parent, rows) if len(g) > 1]


def count_colocation_clusters(
    rows: list[PoiRow], radius_m: float = CLUSTER_RADIUS_M,
) -> int:
    """Count spatial clusters (within radius, >1 row) whose members share no significant
    name tokens — i.e. legitimately co-located distinct features (gallery stacks).

    A drop toward zero here is a signal the curator may have over-merged.
    """
    n = len(rows)
    parent = _make_parent(n)
    for i in range(n):
        for j in range(i + 1, n):
            if haversine_m(rows[i].lon, rows[i].lat, rows[j].lon, rows[j].lat) <= radius_m:
                _union(parent, i, j)

    count = 0
    for group in _components(parent, rows):
        if len(group) <= 1:
            continue
        shares_token = any(
            group[a].tokens & group[b].tokens
            for a in range(len(group))
            for b in range(a + 1, len(group))
        )
        if not shares_token:
            count += 1
    return count


def load_manifest(path: Path) -> dict:
    """Read the curator merge manifest JSON."""
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _clusters(manifest: dict) -> list:
    """Manifest clusters as a list; a non-list value is treated as empty."""
    clusters = manifest.get("clusters", [])
    return clusters if isinstance(clusters, list) else []


def manifest_allowlist(manifest: dict) -> list[set[str]]:
    """Member-key sets for clusters the curator deliberately left co-located."""
    return [
        set(cluster.get("members", []))
        for cluster in _clusters(manifest)
        if isinstance(cluster, dict) and cluster.get("disposition") == "left_colocated"
    ]


def filter_allowlisted(
    clusters: list[list[PoiRow]], allowlist: list[set[str]],
) -> list[list[PoiRow]]:
    """Drop residual clusters fully covered by a manifest 'left_colocated' member set."""
    remaining: list[list[PoiRow]] = []
    for cluster in clusters:
        keys = {row.dedupe_key for row in cluster}
        if any(keys <= allowed for allowed in allowlist):
            continue
        remaining.append(cluster)
    return remaining


def cross_check_manifest(rows: list[PoiRow], manifest: dict) -> list[str]:
    """Assert every collapsed cluster is reflected in the CSV and counts agree."""
    failures: list[str] = []
    present_keys = {row.dedupe_key for row in rows}
    present_poi_ids = {row.poi_id for row in rows}

    for cluster in _clusters(manifest):
        if not isinstance(cluster, dict):
            continue
        if cluster.get("disposition") != "collapsed":
            continue
        survivor = cluster.get("survivor_poi_id", "")
        if survivor and survivor not in present_poi_ids:
            failures.append(f"manifest: collapsed survivor {survivor!r} missing from CSV")
        for dropped in cluster.get("dropped", []):
            dk = dropped.get("dedupe_key", "")
            if dk and dk in present_keys:
                failures.append(f"manifest: dropped key {dk!r} still present in CSV")

    rows_after = manifest.get("summary", {}).get("rows_after")
    if rows_after is not None and rows_after != len(rows):
        failures.append(
            f"manifest: summary.rows_after={rows_after} but CSV has {len(rows)} rows"
        )
    return failures


@dataclass
class QcResult:
    passed: bool
    failures: list[str]
    info: dict


def run_qc(csv_path: Path, manifest_path: Path | None = None) -> QcResult:
    """Run all gate checks against a candidate CSV. Pure: returns a result, never exits."""
    # encoding="utf-8-sig" so a spreadsheet-exported BOM doesn't poison fieldnames[0].
    try:
        with Path(csv_path).open(newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            fieldnames = reader.fieldnames
            raw_rows = list(reader)
    except (FileNotFoundError, OSError) as e:
        return QcResult(
            passed=False,
            failures=[f"could not read csv: {csv_path} ({e})"],
            info={
                "row_count": 0,
                "colocation_clusters": 0,
                "manifest_present": False,
                "review_candidates": None,
            },
        )

    failures: list[str] = list(check_schema(fieldnames))

    rows, row_failures = parse_rows(raw_rows)
    failures.extend(row_failures)

    manifest: dict = {}
    allowlist: list[set[str]] = []
    manifest_present = manifest_path is not None and Path(manifest_path).exists()
    if manifest_present:
        try:
            manifest = load_manifest(Path(manifest_path))
            if not isinstance(manifest, dict):
                raise TypeError(f"top-level JSON is {type(manifest).__name__}, expected object")
            clusters = manifest.get("clusters", [])
            if not isinstance(clusters, list):
                raise TypeError(f"clusters is {type(clusters).__name__}, expected list")
            if any(not isinstance(c, dict) for c in clusters):
                raise TypeError("clusters contains a non-object entry")
            allowlist = manifest_allowlist(manifest)
            failures.extend(cross_check_manifest(rows, manifest))
        except (json.JSONDecodeError, ValueError, TypeError, AttributeError) as e:
            # A structurally odd manifest is a clean gate failure, never a traceback.
            # Allowlist stays empty; residual-cluster detection below still runs.
            manifest = {}
            allowlist = []
            failures.append(f"manifest: unreadable or malformed ({e})")

    residual = filter_allowlisted(find_residual_clusters(rows), allowlist)
    for cluster in residual:
        names = ", ".join(f"{r.name!r}({r.dedupe_key})" for r in cluster)
        failures.append(f"residual same-feature cluster ({len(cluster)} rows): {names}")

    info = {
        "row_count": len(rows),
        "colocation_clusters": count_colocation_clusters(rows),
        "manifest_present": manifest_present,
        "review_candidates": manifest.get("summary", {}).get("review_candidates"),
    }
    return QcResult(passed=not failures, failures=failures, info=info)

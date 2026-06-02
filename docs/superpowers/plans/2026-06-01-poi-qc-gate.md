# POI QC Promotion Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent QC gate that blocks promotion of any curator POI CSV containing residual same-feature duplicates or basic data defects.

**Architecture:** Pure, importable check functions in `apps/api/poi_qc.py` (no I/O side effects, no `sys.exit`); a thin CLI shim at `scripts/qc_pois.py` that handles argparse, the triage report, optional JSON output, and the exit code; pytest unit tests in `apps/api/tests/test_poi_qc.py`. The gate re-detects duplicates itself (proximity + shared significant name token, union-find) and uses the curator's `merge_manifest.json` only to cross-check and to allowlist deliberate co-location.

**Tech Stack:** Python 3.11, standard library only (`csv`, `json`, `math`, `re`, `dataclasses`, `argparse`). pytest (already a backend dependency). No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-06-01-poi-qc-gate-design.md`

---

## Conventions for the executor

- **Tests run from the backend dir:** `cd apps/api && python -m pytest tests/test_poi_qc.py -v`. Pytest's rootdir is `apps/api`, so tests import the module directly: `from poi_qc import ...` (mirrors `test_conversion.py` doing `from conversion import miles_to_meters`).
- **The repo commits only when the user asks** (project policy). The `Commit` steps below are logical checkpoints — perform them when the user has authorized committing; otherwise keep changes in the working tree and continue. The current branch is `main`, so do Task 0 (branch) first regardless.
- Keep functions pure where this plan says "pure" — return values/failure lists, never print or exit inside `poi_qc.py`.

---

## File Structure

- `apps/api/poi_qc.py` (create) — pure checks: constants, `significant_tokens`, `haversine_m`, `check_schema`, `parse_rows`, union-find helpers, `find_residual_clusters`, `count_colocation_clusters`, manifest helpers, `cross_check_manifest`, `run_qc`, `QcResult`, `PoiRow`.
- `scripts/qc_pois.py` (create) — CLI: argparse, triage report, `--report-json`, exit code. Imports `poi_qc`.
- `apps/api/tests/test_poi_qc.py` (create) — unit tests for every function + `run_qc` + a CLI subprocess smoke test.
- `README.md` (modify) — add a short "Running the QC gate" note.

---

## Task 0: Create the working branch

- [ ] **Step 1: Branch off main**

Run:
```bash
git checkout -b poi-qc-gate
```
Expected: `Switched to a new branch 'poi-qc-gate'`

---

## Task 1: Module skeleton, constants, and `significant_tokens`

**Files:**
- Create: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Create `apps/api/tests/test_poi_qc.py`:
```python
"""Tests for the POI QC promotion gate."""
import poi_qc


def test_significant_tokens_drops_generic_and_short():
    # "house" is generic, "of" is generic, single chars dropped, "tudesque" kept
    assert poi_qc.significant_tokens("Roque Tudesque House East") == {"roque", "tudesque"}


def test_significant_tokens_relation_name_shares_with_wings():
    # The relation "Tudesque House" must share a token with the wings
    rel = poi_qc.significant_tokens("Tudesque House")
    wing = poi_qc.significant_tokens("Roque Tudesque House West")
    assert rel & wing == {"tudesque"}


def test_significant_tokens_distinct_galleries_share_nothing():
    a = poi_qc.significant_tokens("Patina Gallery")
    b = poi_qc.significant_tokens("Sorrel Sky Gallery")
    assert not (a & b)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poi_qc'`

- [ ] **Step 3: Write minimal implementation**

Create `apps/api/poi_qc.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit (when authorized — see Conventions)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): poi_qc module skeleton + significant_tokens"
```

---

## Task 2: `haversine_m` distance

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def test_haversine_known_short_distance():
    # Tudesque node to West wing is ~9 m; assert it's in a tight band
    d = poi_qc.haversine_m(-105.938944, 35.6841299, -105.93903457267577, 35.6841571533804)
    assert 5.0 < d < 15.0


def test_haversine_zero():
    assert poi_qc.haversine_m(-105.9, 35.68, -105.9, 35.68) == 0.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k haversine -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'haversine_m'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k haversine -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): haversine_m distance helper"
```

---

## Task 3: `check_schema`

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def test_check_schema_all_present():
    assert poi_qc.check_schema(list(poi_qc.REQUIRED_COLUMNS) + ["merged_from"]) == []


def test_check_schema_reports_missing():
    cols = [c for c in poi_qc.REQUIRED_COLUMNS if c != "lat"]
    failures = poi_qc.check_schema(cols)
    assert failures == ["missing required column: lat"]


def test_check_schema_none_fieldnames():
    failures = poi_qc.check_schema(None)
    assert len(failures) == len(poi_qc.REQUIRED_COLUMNS)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k schema -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'check_schema'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
def check_schema(fieldnames: list[str] | None) -> list[str]:
    """Return one failure message per missing required column. Extra columns are allowed."""
    present = set(fieldnames or [])
    return [
        f"missing required column: {col}"
        for col in REQUIRED_COLUMNS if col not in present
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k schema -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): check_schema for required columns"
```

---

## Task 4: `PoiRow` and `parse_rows` (coords, category, name, unique key)

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def _raw(**over):
    base = {
        "poi_id": "p1", "dedupe_key": "osm:node/1", "name": "Palace of the Governors",
        "lon": "-105.9376", "lat": "35.6873", "primary_category": "history",
    }
    base.update(over)
    return base


def test_parse_rows_accepts_valid():
    rows, failures = poi_qc.parse_rows([_raw()])
    assert failures == []
    assert len(rows) == 1
    assert rows[0].dedupe_key == "osm:node/1"
    assert rows[0].tokens == {"palace", "governors"}


def test_parse_rows_flags_swapped_coords():
    # lon/lat swapped -> outside bbox
    rows, failures = poi_qc.parse_rows([_raw(lon="35.6873", lat="-105.9376")])
    assert rows == []
    assert any("bbox" in f for f in failures)


def test_parse_rows_flags_non_numeric_coords():
    rows, failures = poi_qc.parse_rows([_raw(lon="abc")])
    assert rows == []
    assert any("not numeric" in f for f in failures)


def test_parse_rows_flags_invalid_category():
    rows, failures = poi_qc.parse_rows([_raw(primary_category="food")])
    assert any("invalid category" in f for f in failures)


def test_parse_rows_flags_unusable_name():
    rows, failures = poi_qc.parse_rows([_raw(name="?")])
    assert any("unusable name" in f for f in failures)


def test_parse_rows_flags_duplicate_dedupe_key():
    rows, failures = poi_qc.parse_rows([_raw(), _raw(poi_id="p2", name="Other")])
    assert any("duplicate dedupe_key" in f for f in failures)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k parse_rows -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'parse_rows'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k parse_rows -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): PoiRow + parse_rows validation"
```

---

## Task 5: Union-find helpers and `find_residual_clusters` (core duplicate detector)

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def _row(idx, key, name, lon, lat):
    return poi_qc.PoiRow(
        index=idx, poi_id=key, dedupe_key=key, name=name,
        category="history", lon=lon, lat=lat, tokens=poi_qc.significant_tokens(name),
    )


TUDESQUE_ROWS = [
    _row(2, "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    _row(3, "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
    _row(4, "osm:way/461729208", "Roque Tudesque House West", -105.93903457267577, 35.6841571533804),
    _row(5, "osm:node/6479254097", "Roque Tudesque House", -105.938944, 35.6841299),
]


def test_residual_clusters_collapses_tudesque():
    clusters = poi_qc.find_residual_clusters(TUDESQUE_ROWS)
    assert len(clusters) == 1
    assert len(clusters[0]) == 4


def test_residual_clusters_ignores_distinct_galleries():
    # Two galleries ~2 m apart but no shared significant token
    rows = [
        _row(2, "g1", "Patina Gallery", -105.9300, 35.6850),
        _row(3, "g2", "Sorrel Sky Gallery", -105.93001, 35.68501),
    ]
    assert poi_qc.find_residual_clusters(rows) == []


def test_residual_clusters_ignores_far_same_name():
    # River Park E/W: share "river" token but ~570 m apart -> not merged
    rows = [
        _row(2, "r1", "Santa Fe River Park East", -105.9300, 35.6850),
        _row(3, "r2", "Santa Fe River Park West", -105.9360, 35.6850),
    ]
    assert poi_qc.find_residual_clusters(rows) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k residual -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'find_residual_clusters'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k residual -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): residual same-feature cluster detection"
```

---

## Task 6: `count_colocation_clusters` (INFO sanity metric)

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def test_colocation_counts_distinct_name_stacks():
    # Two distinct galleries within 35 m -> one co-location cluster
    rows = [
        _row(2, "g1", "Patina Gallery", -105.9300, 35.6850),
        _row(3, "g2", "Sorrel Sky Gallery", -105.93001, 35.68501),
    ]
    assert poi_qc.count_colocation_clusters(rows) == 1


def test_colocation_excludes_same_feature_clusters():
    # Tudesque rows share a token -> that's a residual dup, NOT co-location
    assert poi_qc.count_colocation_clusters(TUDESQUE_ROWS) == 0


def test_colocation_excludes_lone_rows():
    rows = [_row(2, "g1", "Patina Gallery", -105.9300, 35.6850)]
    assert poi_qc.count_colocation_clusters(rows) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k colocation -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'count_colocation_clusters'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k colocation -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): co-location sanity count"
```

---

## Task 7: Manifest helpers and `cross_check_manifest` (incl. allowlist)

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

The curator manifest shape this consumes:
```json
{
  "schema_version": "1",
  "summary": {"rows_before": 4, "rows_after": 1, "clusters_collapsed": 1,
              "clusters_left_colocated": 0, "review_candidates": 0},
  "clusters": [
    {"disposition": "collapsed", "survivor_poi_id": "p-rel",
     "reason": "osm_relation_members",
     "dropped": [{"dedupe_key": "osm:way/461729209", "poi_id": "p-e"}]},
    {"disposition": "left_colocated", "members": ["g1", "g2"]}
  ]
}
```

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
def test_manifest_allowlist_extracts_colocated_members():
    manifest = {"clusters": [
        {"disposition": "collapsed", "survivor_poi_id": "p-rel", "dropped": []},
        {"disposition": "left_colocated", "members": ["g1", "g2"]},
    ]}
    assert poi_qc.manifest_allowlist(manifest) == [{"g1", "g2"}]


def test_filter_allowlisted_drops_covered_cluster():
    cluster = [_row(2, "g1", "A Gallery", -105.93, 35.685),
               _row(3, "g2", "B Gallery", -105.93, 35.685)]
    # (these share no token in reality; constructed directly to test filtering)
    remaining = poi_qc.filter_allowlisted([cluster], [{"g1", "g2"}])
    assert remaining == []


def test_filter_allowlisted_keeps_uncovered_cluster():
    remaining = poi_qc.filter_allowlisted([TUDESQUE_ROWS], [{"g1", "g2"}])
    assert len(remaining) == 1


def test_cross_check_passes_when_consistent():
    rows = [_row(2, "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725)]
    rows[0].poi_id = "p-rel"
    manifest = {
        "summary": {"rows_after": 1},
        "clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                      "dropped": [{"dedupe_key": "osm:way/461729209"}]}],
    }
    assert poi_qc.cross_check_manifest(rows, manifest) == []


def test_cross_check_flags_dropped_still_present():
    rows = [_row(2, "osm:way/461729209", "Roque Tudesque House East", -105.9387, 35.6840)]
    manifest = {"clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                              "dropped": [{"dedupe_key": "osm:way/461729209"}]}]}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("still present" in f for f in failures)


def test_cross_check_flags_missing_survivor():
    rows = [_row(2, "k1", "Something Else", -105.93, 35.685)]
    manifest = {"clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                              "dropped": []}]}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("survivor" in f and "missing" in f for f in failures)


def test_cross_check_flags_rowcount_mismatch():
    rows = [_row(2, "k1", "Something", -105.93, 35.685)]
    manifest = {"summary": {"rows_after": 99}, "clusters": []}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("rows_after" in f for f in failures)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k "manifest or allowlisted or cross_check" -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'manifest_allowlist'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
def load_manifest(path: Path) -> dict:
    """Read the curator merge manifest JSON."""
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def manifest_allowlist(manifest: dict) -> list[set[str]]:
    """Member-key sets for clusters the curator deliberately left co-located."""
    return [
        set(cluster.get("members", []))
        for cluster in manifest.get("clusters", [])
        if cluster.get("disposition") == "left_colocated"
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

    for cluster in manifest.get("clusters", []):
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k "manifest or allowlisted or cross_check" -v`
Expected: PASS (7 passed)

- [ ] **Step 5: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): manifest cross-check and co-location allowlist"
```

---

## Task 8: `QcResult` and `run_qc` orchestration

**Files:**
- Modify: `apps/api/poi_qc.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
import csv as _csv
import json as _json


_CSV_HEADER = list(poi_qc.REQUIRED_COLUMNS)


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = _csv.DictWriter(f, fieldnames=_CSV_HEADER, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            full = {c: "" for c in _CSV_HEADER}
            full.update(r)
            writer.writerow(full)


def _csv_row(poi_id, key, name, lon, lat, category="history"):
    return {"poi_id": poi_id, "dedupe_key": key, "name": name,
            "lon": str(lon), "lat": str(lat), "primary_category": category,
            "display_priority": "50", "quality_score": "60",
            "walk_affinity_hint": "0.5", "drive_affinity_hint": "0.5",
            "description_confidence_v1": "medium"}


def test_run_qc_fails_on_duplicate_cluster(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("p2", "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
        _csv_row("p3", "osm:way/461729208", "Roque Tudesque House West", -105.93903457267577, 35.6841571533804),
        _csv_row("p4", "osm:node/6479254097", "Roque Tudesque House", -105.938944, 35.6841299),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.passed is False
    assert any("residual same-feature cluster" in f for f in result.failures)


def test_run_qc_passes_on_clean_csv(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("g1", "g1", "Patina Gallery", -105.9300, 35.6850, "art"),
        _csv_row("g2", "g2", "Sorrel Sky Gallery", -105.93001, 35.68501, "art"),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.passed is True
    assert result.failures == []
    assert result.info["colocation_clusters"] == 1


def test_run_qc_fails_on_missing_column(tmp_path):
    csv_path = tmp_path / "v.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        # header missing "lat"
        cols = [c for c in _CSV_HEADER if c != "lat"]
        writer = _csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
    result = poi_qc.run_qc(csv_path)
    assert result.passed is False
    assert any("missing required column: lat" in f for f in result.failures)


def test_run_qc_cross_checks_manifest(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p-rel", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    manifest_path = tmp_path / "m.json"
    manifest_path.write_text(_json.dumps({
        "summary": {"rows_after": 1},
        "clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                      "dropped": [{"dedupe_key": "osm:way/461729209"}]}],
    }), encoding="utf-8")
    result = poi_qc.run_qc(csv_path, manifest_path)
    assert result.passed is True
    assert result.info["manifest_present"] is True


def test_run_qc_warns_without_manifest(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.info["manifest_present"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k run_qc -v`
Expected: FAIL — `AttributeError: module 'poi_qc' has no attribute 'run_qc'`

- [ ] **Step 3: Write minimal implementation**

Append to `apps/api/poi_qc.py`:
```python
@dataclass
class QcResult:
    passed: bool
    failures: list[str]
    info: dict


def run_qc(csv_path: Path, manifest_path: Path | None = None) -> QcResult:
    """Run all gate checks against a candidate CSV. Pure: returns a result, never exits."""
    with Path(csv_path).open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        raw_rows = list(reader)

    failures: list[str] = list(check_schema(fieldnames))

    rows, row_failures = parse_rows(raw_rows)
    failures.extend(row_failures)

    manifest: dict = {}
    allowlist: list[set[str]] = []
    manifest_present = manifest_path is not None and Path(manifest_path).exists()
    if manifest_present:
        manifest = load_manifest(Path(manifest_path))
        allowlist = manifest_allowlist(manifest)
        failures.extend(cross_check_manifest(rows, manifest))

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k run_qc -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full module test suite**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -v`
Expected: PASS (all tests from Tasks 1–8)

- [ ] **Step 6: Commit (when authorized)**

```bash
git add apps/api/poi_qc.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): run_qc orchestration + QcResult"
```

---

## Task 9: CLI shim `scripts/qc_pois.py` + subprocess smoke test

**Files:**
- Create: `scripts/qc_pois.py`
- Test: `apps/api/tests/test_poi_qc.py`

- [ ] **Step 1: Write the failing test**

Append to `apps/api/tests/test_poi_qc.py`:
```python
import subprocess
import sys
from pathlib import Path as _Path


# test file: repo/apps/api/tests/test_poi_qc.py -> parents[3] is the repo root
_REPO_ROOT = _Path(__file__).resolve().parents[3]
_CLI = _REPO_ROOT / "scripts" / "qc_pois.py"


def test_cli_exits_zero_on_clean_csv(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    proc = subprocess.run(
        [sys.executable, str(_CLI), "--csv", str(csv_path)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "PASS" in proc.stdout


def test_cli_exits_one_on_duplicate_cluster(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("p2", "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
    ])
    proc = subprocess.run(
        [sys.executable, str(_CLI), "--csv", str(csv_path)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 1
    assert "FAIL" in proc.stdout
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k cli -v`
Expected: FAIL — nonzero return code / file not found (script does not exist yet)

- [ ] **Step 3: Write minimal implementation**

Create `scripts/qc_pois.py`:
```python
#!/usr/bin/env python3
"""CLI for the POI QC promotion gate. Exit 0 = safe to promote, 1 = blocked.

Usage:
    python scripts/qc_pois.py --csv <candidate.csv> \
        [--manifest <merge_manifest.json>] [--report-json reports/qc_result.json]

See docs/superpowers/specs/2026-06-01-poi-qc-gate-design.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# poi_qc lives with the FastAPI backend; make it importable when run from repo root.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "apps" / "api"))

from poi_qc import run_qc  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="QC a curator POI CSV before promotion into apps/api/data/.",
    )
    parser.add_argument("--csv", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, default=None)
    parser.add_argument("--report-json", type=Path, default=None)
    args = parser.parse_args()

    result = run_qc(args.csv, args.manifest)

    print(f"rows: {result.info['row_count']}")
    print(
        "co-location clusters (distinct names within 35m): "
        f"{result.info['colocation_clusters']}"
    )
    if not result.info["manifest_present"]:
        print("WARNING: no manifest provided — manifest cross-check skipped")

    if result.failures:
        print(f"\nFAIL — {len(result.failures)} issue(s):")
        for msg in result.failures:
            print(f"  - {msg}")
    else:
        print("\nPASS — safe to promote")

    if args.report_json:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(
            json.dumps(
                {"pass": result.passed, "failures": result.failures, "info": result.info},
                indent=2,
            ),
            encoding="utf-8",
        )

    return 0 if result.passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/api && python -m pytest tests/test_poi_qc.py -k cli -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Manually exercise the CLI against the current production CSV**

Run:
```bash
python scripts/qc_pois.py --csv apps/api/data/query_capable_pois_merged_v1.csv
```
Expected: prints `FAIL` and lists the Roque Tudesque residual cluster (plus any other duplicates), exit code 1. This confirms the gate flags the known defect in today's data.

- [ ] **Step 6: Commit (when authorized)**

```bash
git add scripts/qc_pois.py apps/api/tests/test_poi_qc.py
git commit -m "feat(qc): qc_pois CLI shim + smoke tests"
```

---

## Task 10: Docs note + full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a QC gate note to the README**

Find the backend section of `README.md` (it mentions "pytest-based API utility tests" near line 62) and add, after that bullet:
```markdown
- **POI QC gate:** before promoting a new curator POI CSV into `apps/api/data/`,
  run `python scripts/qc_pois.py --csv <file> --manifest <manifest.json>`. Exit 0
  means safe to promote; exit 1 lists the blocking issues (residual duplicate
  pins, schema drift, bad coordinates). See
  `docs/superpowers/specs/2026-06-01-poi-qc-gate-design.md`.
```

- [ ] **Step 2: Run the complete backend test suite**

Run: `cd apps/api && python -m pytest -v`
Expected: PASS — the existing suite plus all `test_poi_qc.py` tests. No regressions.

- [ ] **Step 3: Lint (if ruff is available)**

Run: `cd apps/api && ruff check poi_qc.py ../../scripts/qc_pois.py 2>/dev/null || echo "ruff not configured — skipping"`
Expected: clean, or the skip message.

- [ ] **Step 4: Commit (when authorized)**

```bash
git add README.md
git commit -m "docs(qc): document the POI QC promotion gate"
```

---

## Done criteria

- `python scripts/qc_pois.py --csv apps/api/data/query_capable_pois_merged_v1.csv` exits 1 and names the Roque Tudesque cluster (proves the gate catches the real defect).
- The same command against a clean curator `merged_v2.csv` + manifest exits 0.
- `cd apps/api && python -m pytest` is green.
- No changes to backend serving (`main.py`, `stop_selector.py`) or frontend — the gate is a pre-promotion tool, not a runtime path.

## Out of scope (tracked, not built here)

- Runtime backstop dedup in `stop_selector.py:_load_places()`.
- CI / pre-commit wiring of the gate.
- The curator-side fix itself (separate project; see `docs/POI_DEDUP_HANDOFF.md`).

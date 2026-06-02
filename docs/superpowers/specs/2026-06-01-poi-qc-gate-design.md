# Design: Detour POI QC Promotion Gate

**Date:** 2026-06-01
**Status:** Draft for review
**Scope:** Detour repo only. The de-duplication *fix* lives in the poi-curator
project (see `docs/POI_DEDUP_HANDOFF.md`). This spec covers the independent
verification gate Detour runs before accepting any curator CSV into production.

## Problem

Detour's FastAPI backend renders one map pin per row of
`apps/api/data/query_capable_pois_merged_v1.csv`. The curator pipeline can ship
multiple rows for one physical feature (e.g. the Roque Tudesque House appeared as
four near-coincident dots: an OSM relation, two member ways, and a node). The
curator is fixing this at the source and will produce a rectified `merged_v2.csv`
plus a `merge_manifest.json` audit trail.

We do **not** load a curator CSV on trust. We need a gate that independently
re-detects same-feature duplicates and basic data defects, so a bad export
cannot reach the running backend. The gate is the control; the curator fix is
the source.

## Goals / Non-goals

**Goals**
- Block promotion of any CSV containing residual same-feature duplicates.
- Catch schema drift and coordinate/category/name defects before deploy.
- Cross-check the curator's merge manifest against the actual CSV.
- Emit a human-readable triage report and a machine-readable result.

**Non-goals (YAGNI)**
- No de-duplication *logic* here — that's the curator's job. The gate detects,
  it does not merge.
- No runtime dedup in `_load_places()` — an optional backstop, tracked as a
  follow-up, not built in this spec.
- No CI / pre-commit wiring yet — noted as a follow-up.
- No changes to backend serving or frontend rendering.

## Architecture

A single self-contained script, `scripts/qc_pois.py` (Python 3, standard library
only — `csv`, `json`, `math`, `argparse`; no new dependencies, consistent with
the existing FastAPI backend).

```
candidate CSV ─┐
               ├─▶ qc_pois.py ─▶ triage report (stdout) ─▶ exit 0 (PASS) | 1 (FAIL)
manifest.json ─┘                 └─▶ optional --report-json <path>
```

Invocation:

```bash
python scripts/qc_pois.py \
  --csv <candidate.csv> \
  [--manifest <merge_manifest.json>] \
  [--report-json reports/qc_result.json]
```

Exit code is the gate: `0` = safe to promote, `1` = blocked. The script never
writes into `apps/api/data/` itself — promotion is a separate, deliberate step
(see Runbook).

## Checks

### FAIL conditions (exit 1) — any one blocks promotion

1. **Schema.** All required columns present (the current `merged_v1` column set:
   `poi_id, dedupe_key, name, lon, lat, primary_category, display_priority,
   quality_score, walk_affinity_hint, drive_affinity_hint, wikipedia_title,
   short_description, description_map_v1, description_card_v1,
   description_subcategory_v1, description_confidence_v1, description_basis_v1,
   address`). Extra columns (`merged_from`, `merge_reason`, governance fields)
   are allowed and ignored.
2. **Coordinate sanity.** Each row's `lon`/`lat` parse as float, are in
   `[lon, lat]` order, and fall within a Santa Fe sanity bounding box
   (`lon ∈ [-106.10, -105.80]`, `lat ∈ [35.55, 35.78]`). This is a gross-error
   guard (swapped/zero/null coords), not a precise municipal boundary.
3. **Category / name.** `primary_category ∈ {history, art, scenic, culture,
   civic}`; `name` not in `{"", "?", "unknown", "unnamed", "n/a", "none",
   "null"}` (case-insensitive).
4. **Unique `dedupe_key`.** No duplicate `dedupe_key` across rows (mirrors the
   curator's own export invariant).
5. **Residual same-feature cluster.** Detour's *independent* detector: cluster
   rows whose centroids are within **35 m** of each other AND that share at least
   one *significant* name token. A significant token excludes generic/structural
   words (`house, park, building, gallery, studio, north, south, east, west,
   the, of, and`) and directionals. If any such cluster contains more than one
   row, FAIL — unless the manifest explicitly lists that cluster under
   `clusters_left_colocated` (an allowlist for deliberate exceptions). This is
   the core duplicate-dot guard, and it does not depend on the manifest being
   present or honest.

### INFO conditions (reported, never fail)

- **Legitimate co-location count.** Number of clusters within 35 m that have
  *distinct* names (e.g. multiple Canyon Road galleries at one building
  centroid). Reporting this number is the sanity check that the curator did not
  over-merge — if it suddenly drops to near zero, a human should look.
- **Manifest `review_candidates`.** Echo the curator's near-miss band (rows at
  35–75 m sharing a significant token) for human attention.

### Manifest cross-check (when `--manifest` provided)

- For every cluster the manifest reports as collapsed: assert exactly one
  survivor `poi_id` is present in the CSV and all listed dropped `dedupe_key`s
  are absent. Mismatch → FAIL.
- Assert the manifest `summary` counts are internally consistent with the CSV
  row count. Mismatch → FAIL.
- Absent manifest → checks 1–5 still run; cross-check is skipped with a warning.

## Output

- **stdout triage report:** PASS/FAIL banner, each FAIL with the offending rows
  (`name`, `dedupe_key`, coords, distance), the INFO co-location count, and the
  manifest cross-check result.
- **`--report-json` (optional):** structured result `{ "pass": bool, "failures":
  [...], "info": {...} }` for future CI consumption.

## Promotion runbook (manual, deliberate)

1. Receive curator's `merged_v2.csv` + `merge_manifest.json`.
2. `python scripts/qc_pois.py --csv merged_v2.csv --manifest merge_manifest.json`
3. On **PASS**: copy the CSV into `apps/api/data/`, point `_CSV_PATH` in
   `apps/api/stop_selector.py` at the new file, restart the backend (the CSV is
   read once at import time — there is no hot reload).
4. On **FAIL**: send the triage report back to the curator; do not promote.

## Testing

`pytest` unit tests (fixtures, no network/DB):
- A Tudesque-style residual cluster (relation + 2 ways + node, all <35 m, shared
  "tudesque" token) → FAIL.
- A clean v2 where that cluster is collapsed to one survivor → PASS.
- A gallery co-location fixture (distinct names within 35 m) → PASS, counted as
  INFO co-location, not a failure.
- Coordinate defects: swapped lat/lon, out-of-bbox, non-numeric → FAIL.
- Manifest cross-check: a manifest claiming a collapse that the CSV contradicts
  → FAIL.

Run `ruff`/`mypy` if configured for scripts.

## Open items

- **Significant-token list** should stay in sync with the curator's equivalent
  list so detector semantics match on both ends. Keep it small and explicit.
- **Backstop dedup in `_load_places()`** — deferred. Decide later whether the
  running backend should self-heal duplicates as a safety net, or rely solely on
  this gate.

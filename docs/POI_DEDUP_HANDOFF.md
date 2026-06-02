# POI De-duplication — Handoff to the Curator Project

## Why this exists

Detour's **FastAPI backend** (`apps/api/`) reads
`query_capable_pois_merged_v1.csv` once at startup
(`stop_selector.py:_load_places()`), serves it as GeoJSON from `GET /api/pois`
(`main.py`), and the frontend (`apps/web/.../ExploreMap.tsx`) renders one map pin
per row. The browser never reads the CSV directly. Some real-world features
arrive as **multiple rows for one physical place**, so they render as a cluster
of near-identical dots. The fix belongs in the curator pipeline that produces the
CSV, not in Detour's rendering. Detour will
keep an **independent QA gate** (see `scripts/qc_pois.py`, described in the QA
section below) and will not promote any CSV that still contains same-feature
duplicates — so the curator output has to be clean and auditable.

This document is the prompt to hand to the curator project, plus the evidence it
needs to reproduce the problem.

## The defect, with evidence

In `query_capable_pois_merged_v1.csv`, one building cluster (the historic Roque
Tudesque House, now the Inn of the Five Graces, across from the Santa Fe
Playhouse) appears as **four rows**, all within ~30 m of each other:

| name | dedupe_key | quality_score | lon, lat |
|------|-----------|---------------|----------|
| Tudesque House | `osm:relation/13422888` | 80.0 | -105.93883, 35.68408 |
| Roque Tudesque House East | `osm:way/461729209` | 67.5 | -105.93875, 35.68403 |
| Roque Tudesque House West | `osm:way/461729208` | 67.5 | -105.93903, 35.68416 |
| Roque Tudesque House | `osm:node/6479254097` | 62.5 | -105.93894, 35.68413 |

This is the OSM "one feature, many objects" pattern: a **relation** (the
multipolygon), its two member **ways** (East/West wings), and a standalone
**node**, all kept as separate rows. The current `dedupe_key` is per-OSM-entity,
so exact-key matching can't collapse them — each row has a different key.

Same pattern, smaller, elsewhere in the file:
- `Santa Fe River Park East` + `Santa Fe River Park West`
- `Pueblo Alegre North Park` + `Pueblo Alegre South Park`

## The critical distinction — do NOT over-merge

A naive "merge everything within N meters" rule is wrong and will delete real
content. Across the 514 consumed rows there are ~44 spatial clusters (~165 rows)
within ~35 m, but **most are legitimate co-location**, not duplication — e.g.
13–14 distinct Canyon Road / downtown **art galleries** geocoded to a shared
building centroid. Those must all survive.

Two cases the pipeline must tell apart:
- **Duplicate representation of one feature** → collapse to a single canonical
  row. Signals: shared normalized name base (`Roque Tudesque House {East|West|∅}`),
  OSM relation↔member-way lineage, and tight proximity.
- **Distinct features at one location** → keep every row. Signal: genuinely
  different names. Proximity alone is not duplication.

---

## Prompt for the curator project

```text
Read your own pipeline before editing. The downstream consumer (the "Detour"
routing map) renders one map pin per row of the CSV you export, so every
duplicate row becomes a redundant dot.

PROBLEM
Your latest export (query_capable_pois_merged_v1.csv) contains multiple rows for
single physical features. The clearest case: the Roque Tudesque House appears as
four rows — an OSM relation (osm:relation/13422888), its two member ways
(osm:way/461729208, osm:way/461729209), and a standalone node
(osm:node/6479254097) — all within ~30 m. Your current dedupe is exact-key only,
so it cannot collapse the same feature expressed as relation + member ways +
node. Other instances: "Santa Fe River Park East/West", "Pueblo Alegre
North/South Park".

DO NOT OVER-MERGE
Many co-located rows are legitimately distinct (e.g. multiple art galleries
geocoded to one building centroid on Canyon Road). Proximity alone is NOT
duplication. Collapse a cluster only when the rows are the same real-world
feature, signalled by: (a) OSM relation↔member-way lineage, and/or (b) a shared
normalized name base after stripping directional/structural suffixes
(East, West, North, South, Annex, Building, House), combined with tight
proximity. When names genuinely differ, keep all rows.

WHAT TO DELIVER
1. A short root-cause writeup: where in your ingest these multi-entity duplicates
   enter (Overpass query returning relations AND their members AND nodes?), and
   why exact-key dedupe misses them.
2. A planned, reproducible canonicalization step that, per same-feature cluster:
   - keeps ONE canonical row — prefer the highest quality_score (which for Roque
     Tudesque correctly selects the relation row at 80.0). Break ties
     deterministically (e.g. relation > way > node, then lowest poi_id).
   - merges useful provenance from the dropped rows into the survivor
     (evidence_sources, wikipedia_title, aliases) rather than discarding it.
3. An AUDIT TRAIL so the merge is verifiable downstream. Add columns to each
   surviving row:
   - merged_from: list of the dedupe_keys/poi_ids collapsed into this row
   - merge_reason: e.g. "osm_relation_members" | "name_base+proximity"
   And emit a separate merge manifest (CSV or JSON) listing every cluster, the
   survivor, the dropped rows, and the reason — so the consumer can spot-check.
4. A rectified export named query_capable_pois_merged_v2.csv with the SAME column
   schema as v1 (plus the two audit columns above). Do not rename or drop
   existing columns. Keep poi_id stable for rows that already existed.
5. Make the canonicalization re-runnable on future exports, not a one-time edit.

SECONDARY (note, lower priority)
Many rows still carry description_review_status=unreviewed and templated
deterministic_draft descriptions, and some use historic names where a current
name exists (Roque Tudesque House is now the Inn of the Five Graces). Flag these
for review; do not block the dedup fix on them.

CONSTRAINTS
- Coordinates stay in [lon, lat] order. Do not round coordinates.
- Report counts: rows before, rows after, clusters collapsed, clusters
  intentionally left as co-located.
```

---

## QA gate on the Detour side (we own this, independent of the curator)

`apps/api/data/` is the directory the FastAPI backend reads from at startup, so
"promoting" a CSV means committing it there (and pointing `_CSV_PATH` in
`stop_selector.py` at it); the backend picks it up on next restart. Even with a
clean v2, we verify before anything reaches that directory:

1. `scripts/qc_pois.py` re-detects same-feature clusters independently
   (name-base + proximity + OSM lineage) and **fails** if any survive, while
   allowlisting known legitimate co-location. This is the promotion gate.
2. Schema/sanity checks: required columns present, coordinates inside the Santa
   Fe bbox, `[lon, lat]` order, no `name == "?"`, valid categories.
3. Cross-check the curator's merge manifest against our own detection — flag any
   cluster they collapsed that we think was legitimate co-location, and vice
   versa.
4. The gate emits a human-reviewable triage report; ambiguous clusters require
   sign-off before promotion.
5. Optional safety net: a light spatial+name dedup in
   `apps/api/stop_selector.py:_load_places()` so production self-heals if a bad
   CSV ever slips the gate. This is a backstop, not the primary control.

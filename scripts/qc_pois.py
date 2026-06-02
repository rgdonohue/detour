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

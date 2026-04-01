"""
ORS stop suggestion evaluation script.

Calls /api/suggest-stop for 10 Santa Fe routes × 4 categories and prints
a markdown table pre-filled with stop name, source, and display label.
Leave Rating and Why columns blank — fill those in yourself.

Usage:
    # With ORS off (baseline):
    USE_ORS_POIS=false uvicorn must be running, then:
    python scripts/eval_ors_stops.py --mode baseline

    # With ORS on:
    USE_ORS_POIS=true, then:
    python scripts/eval_ors_stops.py --mode ors

    # Both passes in one run (flip the flag between passes yourself, or
    # just run twice and redirect output):
    python scripts/eval_ors_stops.py --mode baseline > baseline.md
    python scripts/eval_ors_stops.py --mode ors > ors.md
"""

import argparse
import sys
import urllib.request
import urllib.parse
import json

API_BASE = "http://localhost:8000/api"

CATEGORIES = ["Any", "History", "Art", "Food"]

# fmt: off
ROUTES = [
    # id, context, origin (lon, lat), destination (lon, lat)
    ("D1", "downtown",    (-105.9398, 35.6872), (-105.9374, 35.6808)),  # Palace → San Miguel
    ("D2", "downtown",    (-105.9412, 35.6862), (-105.9295, 35.6815)),  # Lensic → Canyon Road
    ("D3", "downtown",    (-105.9384, 35.6824), (-105.9444, 35.6830)),  # Capitol → Railyard
    ("E1", "edge",        (-105.9384, 35.6824), (-105.9621, 35.6604)),  # Capitol → Meow Wolf
    ("E2", "edge",        (-105.9384, 35.6824), (-105.9130, 35.6880)),  # Capitol → Dale Ball
    ("E3", "edge",        (-105.9384, 35.6824), (-105.9223, 35.6714)),  # Capitol → Museum Hill
    ("T1", "tourist",     (-105.9395, 35.6870), (-105.9225, 35.6720)),  # Plaza → Museum of Indian Arts
    ("T2", "tourist",     (-105.9420, 35.6879), (-105.9295, 35.6815)),  # O'Keeffe → Canyon Road
    ("R1", "residential", (-105.9500, 35.6750), (-105.9650, 35.6900)),  # SW residential
    ("R2", "residential", (-105.9200, 35.6750), (-105.9100, 35.7000)),  # East side
]
# fmt: on

ORS_GROUP_LABELS = {
    "historic": "Historic",
    "arts_and_culture": "Arts & Culture",
    "leisure_and_entertainment": "Leisure",
    "natural": "Natural",
    "sustenance": "Food & Drink",
    "tourism": "Tourism",
    "public_places": "Public Place",
    "accommodation": "Accommodation",
    "education": "Education",
    "facilities": "Facility",
    "financial": "Financial",
    "healthcare": "Healthcare",
    "service": "Service",
    "shops": "Shop",
    "transport": "Transport",
}

CURATED_LABELS = {
    "history": "Historic",
    "art": "Art",
    "food": "Food & Drink",
    "scenic": "Scenic",
    "culture": "Culture",
}


def get_category_label(raw: str) -> str:
    return CURATED_LABELS.get(raw) or ORS_GROUP_LABELS.get(raw) or raw


def call_suggest_stop(origin, destination, category, miles=3):
    cat_param = category.lower() if category != "Any" else None
    params = {
        "origin": f"{origin[0]},{origin[1]}",
        "destination": f"{destination[0]},{destination[1]}",
        "miles": str(miles),
    }
    if cat_param:
        params["category"] = cat_param

    url = f"{API_BASE}/suggest-stop?" + urllib.parse.urlencode(params)
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": str(e)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--mode",
        choices=["baseline", "ors"],
        required=True,
        help="baseline = USE_ORS_POIS=false, ors = USE_ORS_POIS=true",
    )
    args = parser.parse_args()

    ors_on = args.mode == "ors"
    mode_label = "ORS ON" if ors_on else "Baseline (static)"

    print(f"# Stop suggestion evaluation — {mode_label}\n")
    print(
        "| Route | Context | Category | Stop name | Source | Display label | Rating | Why |"
    )
    print("|-------|---------|----------|-----------|--------|---------------|--------|-----|")

    for route_id, context, origin, destination in ROUTES:
        for category in CATEGORIES:
            result = call_suggest_stop(origin, destination, category)

            if "error" in result:
                stop_name = f"ERROR: {result['error']}"
                source = "—"
                label = "—"
            elif result.get("stop") is None:
                stop_name = "*(no stop within 1 mi)*"
                source = "none"
                label = "—"
            else:
                stop = result["stop"]
                stop_name = stop.get("name", "—")
                source = stop.get("source", "—")
                raw_cat = stop.get("category", "")
                label = get_category_label(raw_cat)

            print(
                f"| {route_id} | {context} | {category} | {stop_name} | {source} | {label} |  |  |"
            )

    print()
    print(f"*Rating key: Good / Okay / Junk*")


if __name__ == "__main__":
    main()

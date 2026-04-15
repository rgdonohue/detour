"""Regenerate a tour's route geometry by routing through all stops via ORS.

Usage:
    python scripts/regenerate_tour_route.py [--slug downtown-loop] [--dry-run]

Reads the tour JSON, extracts stop coordinates in order, calls ORS directions
with foot-walking/shortest through all stops as waypoints (looping back to
stop 1 for loop tours), and overwrites the route geometry + distance/duration.
"""

import argparse
import json
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
TOURS_DIR = ROOT / "apps" / "api" / "data" / "tours"


def load_env_key() -> str:
    """Read ORS_API_KEY from .env at project root."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        sys.exit("No .env found at project root")
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if line.startswith("ORS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ORS_API_KEY not found in .env")


def main():
    parser = argparse.ArgumentParser(description="Regenerate tour route via ORS")
    parser.add_argument("--slug", default="downtown-loop", help="Tour slug")
    parser.add_argument("--dry-run", action="store_true", help="Print result without writing")
    parser.add_argument("--no-loop", action="store_true", help="Don't loop back to first stop")
    args = parser.parse_args()

    tour_path = TOURS_DIR / f"{args.slug}.json"
    if not tour_path.exists():
        sys.exit(f"Tour file not found: {tour_path}")

    tour = json.loads(tour_path.read_text())
    stops = tour["stops"]
    api_key = load_env_key()

    # Build coordinate array: stop1, stop2, ..., stop14, stop1 (loop)
    coordinates = [stop["coordinates"] for stop in stops]
    if not args.no_loop:
        coordinates.append(stops[0]["coordinates"])

    print(f"Routing through {len(coordinates)} waypoints ({len(stops)} stops"
          f"{' + loop back' if not args.no_loop else ''})...")
    print(f"  Profile: foot-walking | Preference: shortest")

    # Call ORS directions API
    resp = httpx.post(
        "https://api.openrouteservice.org/v2/directions/foot-walking/geojson",
        headers={"Authorization": api_key},
        json={
            "coordinates": coordinates,
            "preference": "shortest",
        },
        timeout=30.0,
    )

    if resp.status_code != 200:
        print(f"ORS error {resp.status_code}: {resp.text}")
        sys.exit(1)

    data = resp.json()
    features = data.get("features", [])
    if not features:
        sys.exit("No route returned")

    feat = features[0]
    geometry = feat["geometry"]
    summary = feat.get("properties", {}).get("summary", {})
    distance_m = summary.get("distance", 0)
    duration_s = summary.get("duration", 0)
    distance_mi = distance_m / 1609.344

    print(f"\nRoute generated:")
    print(f"  Coordinates: {len(geometry['coordinates'])} points")
    print(f"  Distance:    {distance_mi:.2f} miles ({distance_m:.0f} m)")
    print(f"  Duration:    {duration_s / 60:.0f} minutes ({duration_s:.0f} s)")

    # Update tour data
    tour["route"] = {
        "type": "Feature",
        "geometry": geometry,
        "properties": {},
    }
    tour["distance_miles"] = round(distance_mi, 1)
    tour["duration_minutes"] = round(duration_s / 60)

    if args.dry_run:
        print("\n[DRY RUN] Would write to:", tour_path)
        print(f"  Old coords: {len(json.loads(tour_path.read_text())['route']['geometry']['coordinates'])}")
        print(f"  New coords: {len(geometry['coordinates'])}")
    else:
        tour_path.write_text(json.dumps(tour, indent=2) + "\n")
        print(f"\nWrote updated tour to {tour_path}")

    # Also update docs copy if it exists
    docs_copy = ROOT / "docs" / "data" / "tours" / f"{args.slug}.json"
    if docs_copy.exists() and not args.dry_run:
        docs_copy.write_text(json.dumps(tour, indent=2) + "\n")
        print(f"Updated docs copy at {docs_copy}")


if __name__ == "__main__":
    main()

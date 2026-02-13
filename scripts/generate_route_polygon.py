#!/usr/bin/env python3
"""
Generate route-based 3-mile service area polygon and write to cache.

Run from project root:
  python scripts/generate_route_polygon.py

Requires ORS_API_KEY in .env. Writes cache/area_3mi_route.geojson.
/api/area will then serve this polygon (preferred over isochrones).
"""
import asyncio
import sys
from pathlib import Path

# Project root and API directory for imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent
API_DIR = PROJECT_ROOT / "apps" / "api"
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(API_DIR))

# Load .env before importing config-dependent modules
import dotenv
dotenv.load_dotenv(PROJECT_ROOT / ".env")

from cache import set_route_based_polygon
from config import settings
from polygon_generator import generate_route_based_polygon


async def main() -> None:
    if not settings.ORS_API_KEY:
        print("Error: ORS_API_KEY not set in .env", file=sys.stderr)
        sys.exit(1)

    print("Generating route-based 3-mile polygon (24 spokes, ~240 ORS calls)...")
    result = await generate_route_based_polygon(
        settings.HOTEL_LON,
        settings.HOTEL_LAT,
        num_spokes=24,
        concurrency=6,
    )
    set_route_based_polygon(3, result)
    print("Wrote cache/area_3mi_route.geojson. /api/area will now serve this polygon.")


if __name__ == "__main__":
    asyncio.run(main())

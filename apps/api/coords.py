"""Coordinate quantization. Single source of truth for how lon/lat are rounded
before keying caches and calling ORS.

Why 4 decimals: in Santa Fe (lat ~35.7°), 4 decimal places ≈ 11 m east-west and
~11 m north-south. That is well below the visible map-marker size at any zoom
the product uses, and well below the smallest service-area ring (0.5 mi walk).

Why quantize at all: cache keys and ORS requests both benefit. Two users who
click pixels apart at the same intersection get the same key, and ORS returns
byte-identical responses for byte-identical inputs.
"""

QUANTIZE_DECIMALS = 4


def quantize(lon: float, lat: float, decimals: int = QUANTIZE_DECIMALS) -> tuple[float, float]:
    """Round lon/lat to a stable grid. Use this at every API boundary that
    parses user-supplied coordinates."""
    return round(lon, decimals), round(lat, decimals)

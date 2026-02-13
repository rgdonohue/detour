"""Distance conversion utilities. 3 miles = 4828.032 meters (3 × 1609.344). Never round this."""

MILES_TO_METERS = 1609.344


def miles_to_meters(miles: float) -> float:
    """Convert miles to meters. Uses exact 1609.344 m/mi."""
    return miles * MILES_TO_METERS

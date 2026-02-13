"""Test within_limit logic: edge cases at exactly 3.0 miles, just over, just under."""
import pytest

from conversion import miles_to_meters

# 3 miles = 4828.032 meters
LIMIT_METERS = miles_to_meters(3)


def within_limit(distance_meters: float, limit_meters: float = LIMIT_METERS) -> bool:
    """Authoritative within-limit check."""
    return distance_meters <= limit_meters


def test_exactly_three_miles():
    """Exactly 3.0 miles — within limit (inclusive)."""
    assert within_limit(4828.032)


def test_just_under_three_miles():
    """Just under 3 miles — within limit."""
    assert within_limit(4828.0)
    assert within_limit(4800.0)


def test_just_over_three_miles():
    """Just over 3 miles — outside limit."""
    assert not within_limit(4828.1)
    assert not within_limit(4830.0)
    assert not within_limit(5000.0)


def test_zero_distance():
    assert within_limit(0)

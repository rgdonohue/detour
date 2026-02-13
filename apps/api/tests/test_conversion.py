"""Test miles_to_meters conversion. 3 miles = 4828.032 meters exactly."""
import pytest

from conversion import miles_to_meters


def test_three_miles_exact():
    """3 miles must equal 4828.032 meters (3 × 1609.344). Never round."""
    assert miles_to_meters(3) == 4828.032


def test_one_mile():
    assert miles_to_meters(1) == 1609.344


def test_zero():
    assert miles_to_meters(0) == 0.0


def test_fractional():
    assert miles_to_meters(0.5) == 804.672

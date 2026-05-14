"""Shared fixtures.

Rate-limiter state is module-global and would carry over between tests,
causing flaky behavior whenever a test fires more requests than the per-IP
cap allows. Reset on every test by default; opt out with a marker if a test
specifically needs to verify limit behavior.
"""
import pytest

import main


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """Clear every limiter's state before each test runs."""
    for limiter in main._LIMITERS.values():
        limiter.reset()
    yield

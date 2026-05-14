"""RateLimiter unit tests — sliding-window semantics, global vs per-IP scopes."""
import asyncio
import time

import pytest

from rate_limit import RateLimiter


@pytest.mark.asyncio
async def test_allows_up_to_limit_then_blocks():
    rl = RateLimiter("t", ip_limits=[(3, 60)])
    assert await rl.check("ip1") == 0
    assert await rl.check("ip1") == 0
    assert await rl.check("ip1") == 0
    assert await rl.check("ip1") > 0  # blocked


@pytest.mark.asyncio
async def test_different_ips_have_independent_buckets():
    rl = RateLimiter("t", ip_limits=[(2, 60)])
    await rl.check("a")
    await rl.check("a")
    assert await rl.check("a") > 0
    # ip "b" still has full quota
    assert await rl.check("b") == 0


@pytest.mark.asyncio
async def test_global_limit_caps_total_traffic():
    rl = RateLimiter("t", global_limits=[(2, 60)], ip_limits=[(10, 60)])
    await rl.check("a")
    await rl.check("b")  # global = 2/2, ip a = 1, ip b = 1
    # Per-IP buckets still have room, but global is exhausted.
    retry_c = await rl.check("c")
    assert retry_c > 0


@pytest.mark.asyncio
async def test_window_expiry_replenishes_quota(monkeypatch):
    """Once events fall outside the window, capacity returns."""
    rl = RateLimiter("t", ip_limits=[(2, 1.0)])
    await rl.check("ip")
    await rl.check("ip")
    assert await rl.check("ip") > 0  # blocked

    # Advance monotonic time past the window. monkeypatch the time source
    # the limiter calls so we don't really sleep.
    real_monotonic = time.monotonic
    offset = 2.0
    monkeypatch.setattr("rate_limit.time.monotonic", lambda: real_monotonic() + offset)

    assert await rl.check("ip") == 0


@pytest.mark.asyncio
async def test_returns_largest_retry_across_blocked_windows():
    """When multiple windows are over their limit, the longest retry wins."""
    rl = RateLimiter("t", ip_limits=[(1, 60), (2, 86400)])
    await rl.check("ip")  # both buckets at 1
    retry = await rl.check("ip")  # minute bucket is at limit
    assert 50 < retry <= 60  # roughly the remaining minute


@pytest.mark.asyncio
async def test_reset_clears_state():
    rl = RateLimiter("t", ip_limits=[(1, 60)])
    await rl.check("ip")
    assert await rl.check("ip") > 0
    rl.reset()
    assert await rl.check("ip") == 0


@pytest.mark.asyncio
async def test_no_limits_means_always_allow():
    """A RateLimiter with no windows configured passes every request."""
    rl = RateLimiter("t")
    for _ in range(1000):
        assert await rl.check("ip") == 0

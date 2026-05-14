"""Test in-flight deduplication."""
import asyncio

import pytest

from inflight import dedupe_inflight


@pytest.mark.asyncio
async def test_single_call_runs_factory_once():
    store: dict = {}
    calls = 0

    async def work():
        nonlocal calls
        calls += 1
        return "ok"

    result = await dedupe_inflight(store, "k", work)
    assert result == "ok"
    assert calls == 1
    assert "k" not in store  # cleaned up


@pytest.mark.asyncio
async def test_concurrent_identical_calls_share_one_task():
    """Two callers with the same key see one factory invocation."""
    store: dict = {}
    calls = 0
    start_gate = asyncio.Event()

    async def work():
        nonlocal calls
        calls += 1
        await start_gate.wait()
        return "shared"

    t1 = asyncio.create_task(dedupe_inflight(store, "k", work))
    # Yield so t1 reaches the await point and registers in store.
    await asyncio.sleep(0)
    t2 = asyncio.create_task(dedupe_inflight(store, "k", work))
    await asyncio.sleep(0)
    start_gate.set()
    r1, r2 = await asyncio.gather(t1, t2)

    assert r1 == "shared"
    assert r2 == "shared"
    assert calls == 1
    assert "k" not in store


@pytest.mark.asyncio
async def test_failure_propagates_to_both_callers_and_cleans_up():
    """An exception from the factory reaches every concurrent awaiter, and the
    store entry is removed so the next call can retry."""
    store: dict = {}
    calls = 0
    start_gate = asyncio.Event()

    async def work():
        nonlocal calls
        calls += 1
        await start_gate.wait()
        raise ValueError("ORS rate limited")

    t1 = asyncio.create_task(dedupe_inflight(store, "k", work))
    await asyncio.sleep(0)
    t2 = asyncio.create_task(dedupe_inflight(store, "k", work))
    await asyncio.sleep(0)
    start_gate.set()

    with pytest.raises(ValueError, match="rate limited"):
        await t1
    with pytest.raises(ValueError, match="rate limited"):
        await t2
    assert calls == 1
    assert "k" not in store

    # A subsequent call should retry (store was cleaned).
    async def work2():
        return "recovered"

    assert await dedupe_inflight(store, "k", work2) == "recovered"


@pytest.mark.asyncio
async def test_distinct_keys_do_not_dedupe():
    """Different keys produce independent runs."""
    store: dict = {}
    calls = 0

    async def work():
        nonlocal calls
        calls += 1
        return calls

    r1 = await dedupe_inflight(store, "a", work)
    r2 = await dedupe_inflight(store, "b", work)
    assert r1 == 1
    assert r2 == 2

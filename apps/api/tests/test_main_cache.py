"""Integration tests for handler-level disk caching of /api/route.

A second identical request after the first completes should serve from cache
with zero ORS calls. This is the protection that buys the most quota under
shared-URL replays and saved-tour traffic.
"""
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

import cache
import main
from config import settings


def _stub_route_response() -> dict:
    return {
        "route": {
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
            "properties": {},
        },
        "distance_meters": 1000.0,
        "distance_miles": 0.62,
        "duration_seconds": 60.0,
        "within_limit": True,
        "limit_miles": 3.0,
    }


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))
    cache._store.clear()
    main._area_inflight.clear()
    main._route_inflight.clear()
    yield


@pytest.mark.asyncio
async def test_second_identical_route_request_hits_cache(monkeypatch):
    """First call hits ORS; second identical call serves from cache."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        params = {"to": "-105.9385,35.6839", "origin": "-105.94,35.685"}
        r1 = await client.get("/api/route", params=params)
        r2 = await client.get("/api/route", params=params)

    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json() == r2.json()
    assert call_count == 1


@pytest.mark.asyncio
async def test_cache_survives_in_memory_eviction(tmp_path, monkeypatch):
    """If the in-memory cache is cleared (e.g. simulated restart), the disk
    file still serves the response without an ORS call."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        params = {"to": "-105.9385,35.6839", "origin": "-105.94,35.685"}
        await client.get("/api/route", params=params)
        # Simulate process restart: in-memory cache + inflight gone, disk intact.
        cache._store.clear()
        main._route_inflight.clear()
        r2 = await client.get("/api/route", params=params)

    assert r2.status_code == 200
    assert call_count == 1


@pytest.mark.asyncio
async def test_suggest_stop_and_route_share_cache(monkeypatch):
    """GET /api/suggest-stop and /api/route hit the same route cache key for
    the same origin/dest/profile, so the internal route call inside suggest-
    stop benefits from a prior /api/route call (and vice versa)."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Prime the cache via /api/route.
        await client.get("/api/route", params={
            "to": "-105.9385,35.6839", "origin": "-105.94,35.685",
        })
        # /api/suggest-stop with same origin/dest should reuse the cached route.
        await client.get("/api/suggest-stop", params={
            "origin": "-105.94,35.685", "destination": "-105.9385,35.6839",
        })

    assert call_count == 1

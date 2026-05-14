"""Integration tests for in-flight deduplication at the FastAPI handler level.

These prove that two simultaneous identical requests produce one upstream
ORS call. The handler-level dedup is the protection that keeps the shared
ORS quota safe under bursty traffic; if a future refactor breaks it, the
tests should catch it before the rate limiter would.
"""
import asyncio

import pytest
from httpx import ASGITransport, AsyncClient

import main


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


def _stub_isochrone_response() -> dict:
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [[]]},
            "properties": {"distance_miles": 1.0, "distance_meters": 1609.344, "computed_at": "test"},
        }],
    }


@pytest.fixture(autouse=True)
def _clear_inflight_and_cache(monkeypatch):
    """Each dedup test starts from empty state. cache.set is stubbed to a no-op
    so cache hits in subsequent tests don't mask the dedup behavior being tested."""
    main._area_inflight.clear()
    main._route_inflight.clear()
    main._suggest_inflight.clear()
    monkeypatch.setattr(main, "cache_get", lambda key: None)
    monkeypatch.setattr(main, "cache_set", lambda key, value, ttl_seconds=None: None)
    yield


@pytest.mark.asyncio
async def test_concurrent_identical_route_requests_make_one_ors_call(monkeypatch):
    """Two simultaneous GET /api/route with identical params → one get_shortest_route call."""
    call_count = 0
    gate = asyncio.Event()

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await gate.wait()
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        params = {"to": "-105.9385,35.6839", "origin": "-105.94,35.685"}
        t1 = asyncio.create_task(client.get("/api/route", params=params))
        await asyncio.sleep(0)  # let task 1 register inflight
        t2 = asyncio.create_task(client.get("/api/route", params=params))
        await asyncio.sleep(0)
        gate.set()
        r1, r2 = await asyncio.gather(t1, t2)

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert r1.json() == r2.json()
    assert call_count == 1


@pytest.mark.asyncio
async def test_distinct_route_requests_make_distinct_ors_calls(monkeypatch):
    """Two requests with different destinations → two get_shortest_route calls."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.get("/api/route", params={"to": "-105.9385,35.6839", "origin": "-105.94,35.685"})
        await client.get("/api/route", params={"to": "-105.9400,35.6900", "origin": "-105.94,35.685"})

    assert call_count == 2


@pytest.mark.asyncio
async def test_near_identical_origins_collapse_via_quantization(monkeypatch):
    """Two area requests with origins ~5 m apart → one isochrone call (quantization to 4 dp)."""
    call_count = 0
    gate = asyncio.Event()

    async def fake_iso(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        await gate.wait()
        return _stub_isochrone_response()

    monkeypatch.setattr(main, "get_isodistance", fake_iso)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        t1 = asyncio.create_task(client.get("/api/area", params={"origin": "-105.93847,35.68392"}))
        await asyncio.sleep(0)
        t2 = asyncio.create_task(client.get("/api/area", params={"origin": "-105.93853,35.68394"}))
        await asyncio.sleep(0)
        gate.set()
        r1, r2 = await asyncio.gather(t1, t2)

    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    assert call_count == 1


@pytest.mark.asyncio
async def test_route_via_order_distinguishes_keys(monkeypatch):
    """Same stop set in different via orders → distinct keys (order-preserving)."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Same stops, opposite order
        await client.get(
            "/api/route",
            params=[("to", "-105.93,35.68"), ("origin", "-105.94,35.685"),
                    ("via", "-105.935,35.683"), ("via", "-105.937,35.684")],
        )
        await client.get(
            "/api/route",
            params=[("to", "-105.93,35.68"), ("origin", "-105.94,35.685"),
                    ("via", "-105.937,35.684"), ("via", "-105.935,35.683")],
        )

    assert call_count == 2

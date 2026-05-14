"""Integration tests for FastAPI rate limit enforcement.

Verifies that the 4 protected endpoints return 429 with the expected JSON
body shape (`retry_after_seconds` at top level) and Retry-After header
once the per-IP cap is exceeded.
"""
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
    """Each test gets a clean cache dir + fresh in-memory state. The conftest
    reset fixture handles limiter state."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))
    cache._store.clear()
    main._area_inflight.clear()
    main._route_inflight.clear()
    yield


@pytest.mark.asyncio
async def test_area_blocks_after_per_ip_burst(monkeypatch):
    """/api/area per-IP limit is 6/min; 7th request gets 429.
    Per-IP runs before cache lookup so even cache hits count."""
    async def fake_iso(*args, **kwargs):
        return {"type": "FeatureCollection", "features": []}

    monkeypatch.setattr(main, "get_isodistance", fake_iso)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 6 allowed (per-IP minute limit for area)
        for i in range(6):
            r = await client.get("/api/area", params={"origin": f"-105.94{i:02d},35.685"})
            assert r.status_code == 200, f"call {i}: {r.text}"
        # 7th blocked
        r = await client.get("/api/area", params={"origin": "-105.9499,35.685"})
        assert r.status_code == 429
        body = r.json()
        assert body["detail"].startswith("Rate limit")
        assert body["retry_after_seconds"] >= 1
        assert r.headers["retry-after"] == str(body["retry_after_seconds"])


@pytest.mark.asyncio
async def test_route_per_ip_limit_blocks_at_21(monkeypatch):
    """/api/route per-IP minute limit is 20."""
    async def fake_route(*args, **kwargs):
        return _stub_route_response()

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for i in range(20):
            params = {"to": f"-105.93{i:02d},35.6839", "origin": "-105.94,35.685"}
            r = await client.get("/api/route", params=params)
            assert r.status_code == 200, f"call {i}: {r.text}"
        r = await client.get("/api/route", params={"to": "-105.9300,35.6839", "origin": "-105.94,35.685"})
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_save_tour_per_ip_limit_blocks_at_6(monkeypatch):
    """POST /api/tours per-IP minute limit is 5."""
    monkeypatch.setattr(main, "save_tour", lambda payload: "stub-slug")

    def _payload():
        return {
            "name": "Test Tour",
            "mode": "walk",
            "distance_miles": 1.0,
            "duration_minutes": 10,
            "route": {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
                "properties": {},
            },
            "stops": [{
                "order": 1,
                "name": "Stop",
                "coordinates": [-105.94, 35.685],
                "category": "history",
                "description": "",
            }],
        }

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        for i in range(5):
            r = await client.post("/api/tours", json=_payload())
            assert r.status_code == 200, f"call {i}: {r.text}"
        r = await client.post("/api/tours", json=_payload())
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_429_response_contains_retry_after_header_and_field(monkeypatch):
    """Both the HTTP header and the JSON body carry the retry-after seconds."""
    async def fake_iso(*args, **kwargs):
        return {"type": "FeatureCollection", "features": []}

    monkeypatch.setattr(main, "get_isodistance", fake_iso)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Burn through the per-IP minute quota
        for i in range(6):
            await client.get("/api/area", params={"origin": f"-105.94{i:02d},35.685"})
        r = await client.get("/api/area", params={"origin": "-105.9499,35.685"})

    assert r.status_code == 429
    body = r.json()
    assert isinstance(body.get("retry_after_seconds"), int)
    assert body["retry_after_seconds"] >= 1
    assert "retry-after" in {k.lower() for k in r.headers}


@pytest.mark.asyncio
async def test_cache_hit_does_not_consume_global_ors_quota(monkeypatch):
    """Once a route is in cache, hitting it from a different IP must succeed
    even if the global ORS-directions quota is exhausted. This is the central
    win of caching — popular routes bypass the upstream entirely."""
    call_count = 0

    async def fake_route(*args, **kwargs):
        nonlocal call_count
        call_count += 1
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

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        params = {"to": "-105.9385,35.6839", "origin": "-105.94,35.685"}

        # IP-A primes the cache. One ORS call.
        r = await client.get("/api/route", params=params,
                             headers={"X-Forwarded-For": "10.0.0.1"})
        assert r.status_code == 200
        assert call_count == 1

        # Exhaust the global ORS-directions quota with a different IP+route so
        # the cache lookup misses but the global limiter is fully spent.
        for i in range(35):
            await client.get(
                "/api/route",
                params={"to": f"-105.93{i:02d},35.6{i % 9}839", "origin": "-105.94,35.685"},
                headers={"X-Forwarded-For": f"10.0.{i // 256}.{(i % 256) + 2}"},
            )
        # Confirm global is now blocking: a brand-new IP/route gets 429.
        r_blocked = await client.get(
            "/api/route",
            params={"to": "-105.8000,35.6000", "origin": "-105.94,35.685"},
            headers={"X-Forwarded-For": "10.99.99.99"},
        )
        assert r_blocked.status_code == 429

        # IP-B with the SAME params as IP-A should hit the cache and succeed
        # even though global is exhausted.
        r_b = await client.get(
            "/api/route", params=params,
            headers={"X-Forwarded-For": "10.0.0.2"},
        )
        assert r_b.status_code == 200, r_b.text


@pytest.mark.asyncio
async def test_post_suggest_no_geometry_consumes_ors_directions_quota(monkeypatch):
    """The no-geometry branch of POST /api/suggest-stop must go through the
    same global ORS-directions limit as /api/route. Bug if it doesn't."""
    async def fake_route(*args, **kwargs):
        return {
            "route": {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0, 0]]}, "properties": {}},
            "distance_meters": 1000.0,
            "distance_miles": 0.62,
            "duration_seconds": 60.0,
            "within_limit": True,
            "limit_miles": 3.0,
        }

    monkeypatch.setattr(main, "get_shortest_route", fake_route)

    # Exhaust the directions global directly so the next ORS-bound call 429s.
    for _ in range(35):
        await main._ORS_DIRECTIONS.check_global()

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # No route_coordinates → server must call ORS → must be blocked by global.
        r = await client.post(
            "/api/suggest-stop",
            json={
                "origin": "-105.94,35.685",
                "destination": "-105.9385,35.6839",
                "category": "history",
            },
        )
        assert r.status_code == 429, r.text

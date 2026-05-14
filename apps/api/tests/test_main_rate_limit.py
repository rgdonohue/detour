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
    Varying the origin slightly to avoid the cache short-circuit, since cache
    hits don't enter the protected handler path's hot loop... actually they
    do — _enforce runs before cache_get. So we can reuse the same origin."""
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

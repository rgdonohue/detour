"""Typed upstream ORS error handling.

When ORS itself returns 429 or a transient 5xx, Detour must surface a
structured response the frontend can act on — machine-readable error_type,
retry_after_seconds and Retry-After when ORS provided them — without leaking
the upstream response body or the API key. 401 (invalid key) and 404 (no
route) keep their existing user-facing semantics, and Detour's own local
rate-limit 429 keeps its current shape.

All ORS traffic is intercepted by swapping the shared httpx client for an
httpx.MockTransport — no network calls.
"""
import httpx
import pytest
from httpx import ASGITransport, AsyncClient

import cache
import main
import ors_client
from config import settings

SENTINEL_KEY = "sk-test-sentinel-ors-key-must-never-leak"
# Marker planted in every stubbed upstream error body; must never reach clients.
UPSTREAM_BODY_MARKER = "upstream-ors-internal-detail-must-not-leak"

ROUTE_PARAMS = {"to": "-105.9385,35.6839", "origin": "-105.94,35.685"}


class _OrsStub:
    """Shared-client stand-in that returns a configurable upstream response."""

    def __init__(self) -> None:
        self.status_code = 200
        self.headers: dict[str, str] = {}

    def handler(self, _request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            self.status_code,
            headers=self.headers,
            json={"error": UPSTREAM_BODY_MARKER},
        )


@pytest.fixture
def ors(monkeypatch) -> _OrsStub:
    stub = _OrsStub()
    monkeypatch.setattr(settings, "ORS_API_KEY", SENTINEL_KEY)
    monkeypatch.setattr(
        ors_client, "_client",
        httpx.AsyncClient(transport=httpx.MockTransport(stub.handler)),
    )
    return stub


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Clean cache dir + fresh in-memory state; conftest resets limiters."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))
    cache._store.clear()
    main._area_inflight.clear()
    main._route_inflight.clear()
    yield


def _client_for_app() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=main.app), base_url="http://test")


# --- ORS 429: structured 429 with retry timing when ORS provides it ---


@pytest.mark.asyncio
async def test_ors_429_with_retry_after_returns_structured_429(ors):
    ors.status_code = 429
    ors.headers = {"Retry-After": "7"}

    async with _client_for_app() as client:
        r = await client.get("/api/route", params=ROUTE_PARAMS)

    assert r.status_code == 429
    body = r.json()
    assert body["error_type"] == "ors_rate_limited"
    assert isinstance(body["detail"], str) and body["detail"]
    assert body["retry_after_seconds"] == 7
    assert r.headers["retry-after"] == "7"
    assert UPSTREAM_BODY_MARKER not in r.text
    assert SENTINEL_KEY not in r.text


@pytest.mark.asyncio
async def test_ors_429_without_retry_after_omits_retry_fields(ors):
    ors.status_code = 429  # no Retry-After header from ORS

    async with _client_for_app() as client:
        r = await client.get("/api/route", params=ROUTE_PARAMS)

    assert r.status_code == 429
    body = r.json()
    assert body["error_type"] == "ors_rate_limited"
    assert isinstance(body["detail"], str) and body["detail"]
    assert "retry_after_seconds" not in body
    assert "retry-after" not in {k.lower() for k in r.headers}


@pytest.mark.asyncio
async def test_area_ors_429_is_structured_too(ors):
    """The isochrones path classifies upstream 429 the same way."""
    ors.status_code = 429
    ors.headers = {"Retry-After": "12"}

    async with _client_for_app() as client:
        r = await client.get("/api/area", params={"origin": "-105.94,35.685"})

    assert r.status_code == 429
    body = r.json()
    assert body["error_type"] == "ors_rate_limited"
    assert body["retry_after_seconds"] == 12
    assert r.headers["retry-after"] == "12"


# --- ORS 5xx: upstream temporary failure ---


@pytest.mark.asyncio
@pytest.mark.parametrize("upstream_status", [500, 503])
async def test_ors_5xx_returns_ors_upstream_error(ors, upstream_status):
    ors.status_code = upstream_status

    async with _client_for_app() as client:
        r = await client.get("/api/route", params=ROUTE_PARAMS)

    assert r.status_code == 503
    body = r.json()
    assert body["error_type"] == "ors_upstream"
    assert isinstance(body["detail"], str) and body["detail"]
    assert UPSTREAM_BODY_MARKER not in r.text
    assert SENTINEL_KEY not in r.text


@pytest.mark.asyncio
async def test_area_ors_5xx_returns_ors_upstream_error(ors):
    ors.status_code = 502

    async with _client_for_app() as client:
        r = await client.get("/api/area", params={"origin": "-105.94,35.685"})

    assert r.status_code == 503
    assert r.json()["error_type"] == "ors_upstream"
    assert UPSTREAM_BODY_MARKER not in r.text


@pytest.mark.asyncio
async def test_post_suggest_no_geometry_ors_5xx_is_typed(ors):
    """The no-geometry branch of POST /api/suggest-stop calls ORS through the
    same path as /api/route and must surface the same typed error — its
    deeper-nested except block is easy to miss when wiring the re-raise."""
    ors.status_code = 503

    async with _client_for_app() as client:
        r = await client.post("/api/suggest-stop", json={
            "origin": "-105.94,35.685",
            "destination": "-105.9385,35.6839",
            "category": "history",
        })

    assert r.status_code == 503
    assert r.json()["error_type"] == "ors_upstream"


# --- 401 / 404: existing semantics preserved ---


@pytest.mark.asyncio
async def test_ors_401_keeps_invalid_key_semantics(ors):
    ors.status_code = 401

    async with _client_for_app() as client:
        r = await client.get("/api/route", params=ROUTE_PARAMS)

    assert r.status_code == 502
    assert r.json()["detail"] == "ORS API key invalid or expired"
    assert SENTINEL_KEY not in r.text


@pytest.mark.asyncio
async def test_ors_404_keeps_no_route_semantics(ors):
    ors.status_code = 404

    async with _client_for_app() as client:
        r = await client.get("/api/route", params=ROUTE_PARAMS)

    assert r.status_code == 404
    assert r.json()["detail"] == "No route found"


# --- Local Detour rate limit: current shape unchanged ---


@pytest.mark.asyncio
async def test_local_rate_limit_shape_unchanged(monkeypatch):
    """Detour's own per-IP 429 keeps detail + retry_after_seconds + header,
    with no upstream error_type — it is not an ORS failure."""
    async def fake_iso(*args, **kwargs):
        return {"type": "FeatureCollection", "features": []}

    monkeypatch.setattr(main, "get_isodistance", fake_iso)

    async with _client_for_app() as client:
        for i in range(6):
            r = await client.get("/api/area", params={"origin": f"-105.94{i:02d},35.685"})
            assert r.status_code == 200, f"call {i}: {r.text}"
        r = await client.get("/api/area", params={"origin": "-105.9499,35.685"})

    assert r.status_code == 429
    body = r.json()
    assert body["detail"].startswith("Rate limit")
    assert isinstance(body["retry_after_seconds"], int)
    assert r.headers["retry-after"] == str(body["retry_after_seconds"])
    assert "error_type" not in body

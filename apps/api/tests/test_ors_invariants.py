"""Regression tests locking the ORS contract invariants from CLAUDE.md.

1. Directions payloads use preference="shortest" (never fastest), for both
   driving and walking profiles, with and without via waypoints.
2. Via waypoints are sent in origin -> via stops -> destination order.
3. Isochrones payloads use range_type="distance" with meter ranges derived
   from the unrounded 1609.344 m/mile conversion.
4. /api/config never exposes ORS_API_KEY — not the value, not a key-named
   field — in body or headers.
5. within_limit is decided by route distance in meters vs
   miles_to_meters(limit_miles), inclusive at the boundary, independent of
   any polygon/service-area state.

All ORS traffic is intercepted by swapping the shared httpx client in
ors_client for one backed by httpx.MockTransport — no network calls.
"""
import json

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

import cache
import main
import ors_client
from config import settings
from conversion import miles_to_meters

# Sentinel with a distinctive value so a leak anywhere in a response is
# unambiguous. Never a real key.
SENTINEL_KEY = "sk-test-sentinel-ors-key-must-never-leak"

ORIGIN = (-105.94, 35.685)
DEST = (-105.9385, 35.6839)
VIA = [(-105.941, 35.686), (-105.9395, 35.6845)]


class _OrsCapture:
    """Records every request the ORS client sends and lets tests control the
    route distance ORS reports back."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.route_distance_meters = 3200.0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if "/v2/directions/" in url:
            return httpx.Response(200, json={
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[ORIGIN[0], ORIGIN[1]], [DEST[0], DEST[1]]],
                    },
                    "properties": {
                        "summary": {
                            "distance": self.route_distance_meters,
                            "duration": 300.0,
                        },
                    },
                }],
            })
        if "/v2/isochrones/" in url:
            ranges = json.loads(request.content)["range"]
            return httpx.Response(200, json={
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
                    "properties": {"value": r},
                } for r in ranges],
            })
        return httpx.Response(404)


@pytest.fixture
def ors(monkeypatch) -> _OrsCapture:
    """Swap the shared ORS HTTP client for a MockTransport-backed one and set
    a sentinel API key so the real (non-mock) request-building path runs."""
    capture = _OrsCapture()
    monkeypatch.setattr(settings, "ORS_API_KEY", SENTINEL_KEY)
    monkeypatch.setattr(
        ors_client, "_client",
        httpx.AsyncClient(transport=httpx.MockTransport(capture.handler)),
    )
    return capture


# --- Invariants 1 + 2: directions preference and waypoint order ---


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["driving-car", "foot-walking"])
@pytest.mark.parametrize("via", [None, VIA], ids=["direct", "via-waypoints"])
async def test_directions_preference_is_shortest(ors, profile, via):
    """Every directions payload — both profiles, with and without via stops —
    must carry preference="shortest"."""
    await ors_client.get_shortest_route(
        ORIGIN[0], ORIGIN[1], DEST[0], DEST[1],
        limit_miles=3.0, via_coords=via, profile=profile,
    )

    assert len(ors.requests) == 1
    request = ors.requests[0]
    assert f"/v2/directions/{profile}/" in str(request.url)
    payload = json.loads(request.content)
    assert payload["preference"] == "shortest"


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["driving-car", "foot-walking"])
async def test_directions_waypoint_order_origin_via_destination(ors, profile):
    """Coordinates must be sent as origin -> via stops (in order) -> destination."""
    await ors_client.get_shortest_route(
        ORIGIN[0], ORIGIN[1], DEST[0], DEST[1],
        limit_miles=3.0, via_coords=VIA, profile=profile,
    )

    payload = json.loads(ors.requests[0].content)
    assert payload["coordinates"] == [
        [ORIGIN[0], ORIGIN[1]],
        [VIA[0][0], VIA[0][1]],
        [VIA[1][0], VIA[1][1]],
        [DEST[0], DEST[1]],
    ]


# --- Invariant 3: isochrones range_type and meter ranges ---


@pytest.mark.asyncio
@pytest.mark.parametrize("profile", ["driving-car", "foot-walking"])
async def test_isochrones_range_type_distance_with_meter_ranges(ors, profile):
    """Isochrones payloads must use range_type="distance" and meter units,
    with ranges derived from the unrounded 1609.344 m/mile conversion."""
    distances = [miles_to_meters(m) for m in (1.0, 3.0, 5.0)]
    await ors_client.get_isodistance(ORIGIN[0], ORIGIN[1], distances, profile)

    assert len(ors.requests) == 1
    request = ors.requests[0]
    assert f"/v2/isochrones/{profile}" in str(request.url)
    payload = json.loads(request.content)
    assert payload["range_type"] == "distance"
    assert payload["units"] == "m"
    # int(1609.344), int(4828.032), int(8046.72) — a rounded miles conversion
    # (e.g. 1600 m/mile) would produce different values here.
    assert payload["range"] == [1609, 4828, 8046]


# --- Invariant 4: /api/config never leaks the ORS key ---


def _is_key_named(name: str) -> bool:
    normalized = name.lower().replace("-", "_")
    return normalized.endswith("_key") or "api_key" in normalized


def _walk_field_names(obj, path=""):
    """Yield (dotted_path, name) for every dict key anywhere in a JSON body."""
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield f"{path}.{key}" if path else key, key
            yield from _walk_field_names(value, f"{path}.{key}" if path else key)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            yield from _walk_field_names(item, f"{path}[{i}]")


@pytest.mark.asyncio
async def test_config_never_exposes_ors_api_key(monkeypatch):
    """With ORS_API_KEY set, /api/config must not return the value or any
    key-named field (ORS_API_KEY, api_key, *_KEY) in body or headers."""
    monkeypatch.setattr(settings, "ORS_API_KEY", SENTINEL_KEY)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/config")

    assert resp.status_code == 200
    assert SENTINEL_KEY not in resp.text

    for name, value in resp.headers.items():
        assert SENTINEL_KEY not in value, f"key value leaked in header {name}"
        assert not _is_key_named(name), f"key-named response header: {name}"

    leaked = [path for path, name in _walk_field_names(resp.json()) if _is_key_named(name)]
    assert not leaked, f"key-named fields in /api/config body: {leaked}"


# --- Invariant 5: verdict comes from route meters vs miles_to_meters(limit) ---


@pytest.mark.asyncio
async def test_get_shortest_route_verdict_boundary(ors):
    """within_limit is route_distance_meters <= miles_to_meters(limit_miles),
    inclusive at exactly the limit."""
    limit_meters = miles_to_meters(3.0)  # 4828.032 — unrounded

    ors.route_distance_meters = limit_meters
    at_limit = await ors_client.get_shortest_route(
        ORIGIN[0], ORIGIN[1], DEST[0], DEST[1], limit_miles=3.0,
    )
    assert at_limit["distance_meters"] == limit_meters
    assert at_limit["within_limit"] is True

    ors.route_distance_meters = limit_meters + 0.1
    just_over = await ors_client.get_shortest_route(
        ORIGIN[0], ORIGIN[1], DEST[0], DEST[1], limit_miles=3.0,
    )
    assert just_over["within_limit"] is False


@pytest.mark.asyncio
async def test_route_endpoint_verdict_uses_route_meters(ors, tmp_path, monkeypatch):
    """/api/route decides within_limit from the ORS route distance in meters
    against miles_to_meters(miles) — no polygon or service-area state is
    involved (none is ever fetched here)."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))
    cache._store.clear()
    main._route_inflight.clear()

    limit_meters = miles_to_meters(3.0)

    transport = ASGITransport(app=main.app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Just over the limit. 4828.132 m is over 3 mi but under 3.0001 mi, so
        # only a meters-vs-meters comparison classifies it correctly.
        ors.route_distance_meters = limit_meters + 0.1
        r_over = await client.get("/api/route", params={
            "to": "-105.9385,35.6839", "origin": "-105.94,35.685", "miles": "3",
        })
        # Exactly at the limit — inclusive. Different destination so the
        # route cache can't serve the previous response.
        ors.route_distance_meters = limit_meters
        r_exact = await client.get("/api/route", params={
            "to": "-105.93,35.68", "origin": "-105.94,35.685", "miles": "3",
        })

    assert r_over.status_code == 200
    over = r_over.json()
    assert over["distance_meters"] == limit_meters + 0.1
    assert over["within_limit"] is False
    assert over["limit_miles"] == 3.0

    assert r_exact.status_code == 200
    exact = r_exact.json()
    assert exact["distance_meters"] == limit_meters
    assert exact["within_limit"] is True

    # Both requests hit ORS directions only — no isochrones/service-area call
    # participated in the verdict.
    assert all("/v2/directions/" in str(r.url) for r in ors.requests)

"""Cache behavior: in-memory + disk round-trip, TTL, env-configurable dir,
.geojson back-compat."""
import json
import time
from pathlib import Path

import pytest

import cache
from config import settings


@pytest.fixture(autouse=True)
def _isolated_cache_dir(tmp_path, monkeypatch):
    """Every cache test sees a clean tmp directory and no stale in-memory state."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path))
    cache._store.clear()
    yield


def test_set_persists_dict_to_disk_as_json(tmp_path):
    cache.set("route_v1_foo", {"distance_miles": 1.2, "route": {"type": "Feature"}})
    expected = tmp_path / "route_v1_foo.json"
    assert expected.exists()
    data = json.loads(expected.read_text())
    assert data["distance_miles"] == 1.2


def test_get_returns_from_memory_when_present():
    cache.set("k", {"v": 1})
    cache._store["k"] = ({"v": 2}, time.time() + 60)  # mutate in-memory only
    assert cache.get("k") == {"v": 2}


def test_get_falls_back_to_disk_after_memory_eviction(tmp_path):
    cache.set("route_v1_bar", {"v": 1})
    cache._store.clear()  # simulate process restart
    assert cache.get("route_v1_bar") == {"v": 1}


def test_disk_read_respects_ttl(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "CACHE_TTL_HOURS", 1)
    filepath = tmp_path / "stale.json"
    filepath.write_text(json.dumps({"v": "old"}))
    # Backdate the file beyond TTL.
    old = time.time() - 7200  # 2 hours ago
    import os
    os.utime(filepath, (old, old))
    assert cache.get("stale") is None


def test_get_falls_back_to_legacy_geojson_extension(tmp_path):
    """Old area_*.geojson files from before task 2 still resolve."""
    filepath = tmp_path / "area_rings_driving-car_-105.9384_35.6824.geojson"
    filepath.write_text(json.dumps({"type": "FeatureCollection", "features": []}))
    result = cache.get("area_rings_driving-car_-105.9384_35.6824")
    assert result == {"type": "FeatureCollection", "features": []}


def test_invalidate_removes_memory_and_disk(tmp_path):
    cache.set("k", {"v": 1})
    assert (tmp_path / "k.json").exists()
    cache.invalidate("k")
    assert cache.get("k") is None
    assert not (tmp_path / "k.json").exists()


def test_describe_reports_dir_and_count(tmp_path):
    cache.set("a", {"v": 1})
    cache.set("b", {"v": 2})
    state = cache.describe()
    assert state["dir"] == str(tmp_path)
    assert state["files"] == 2
    assert state["ttl_hours"] == settings.CACHE_TTL_HOURS


def test_cache_dir_env_override(tmp_path, monkeypatch):
    """settings.CACHE_DIR is honored at lookup time, not import time."""
    monkeypatch.setattr(settings, "CACHE_DIR", str(tmp_path / "other"))
    cache.set("k", {"v": 1})
    assert (tmp_path / "other" / "k.json").exists()

"""Saved-tour storage and soft-cap pruning.

Pruning policy under test:
- After a successful save, if slug-shaped `*.json` files in the saved-tours
  dir exceed SAVED_TOURS_MAX_FILES, the oldest (by mtime) are deleted.
- The just-saved tour is never deleted, even with a cap of 1.
- File content is never parsed: malformed slug-named JSON is still eligible
  for pruning; files that don't look like saved tours are left alone.
- Nothing outside the saved-tours dir (curated gallery tours) is touched.
"""
import json
import os

import pytest

import saved_tours
from config import settings


def _payload(name: str = "Test Tour") -> dict:
    return {"name": name, "mode": "walk", "stops": [{"order": 1, "name": "Stop"}]}


def _write_aged(dir_path, stem: str, mtime: float, content: str = "{}") -> None:
    path = dir_path / f"{stem}.json"
    path.write_text(content, encoding="utf-8")
    os.utime(path, (mtime, mtime))


@pytest.fixture
def saved_dir(tmp_path, monkeypatch):
    d = tmp_path / "saved_tours"
    d.mkdir()
    monkeypatch.setattr(saved_tours, "_SAVED_DIR", d)
    return d


def test_save_then_load_round_trips(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 500)
    slug = saved_tours.save_tour(_payload("Plaza Loop"))
    loaded = saved_tours.load_saved_tour(slug)
    assert loaded is not None
    assert loaded["name"] == "Plaza Loop"
    assert loaded["slug"] == slug
    assert loaded["stop_count"] == 1


def test_over_cap_prunes_oldest_by_mtime(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 3)
    _write_aged(saved_dir, "oldest01", 1_000)
    _write_aged(saved_dir, "middle01", 2_000)
    _write_aged(saved_dir, "newest01", 3_000)

    slug = saved_tours.save_tour(_payload())

    remaining = {p.stem for p in saved_dir.glob("*.json")}
    assert remaining == {"middle01", "newest01", slug}


def test_at_or_under_cap_deletes_nothing(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 3)
    _write_aged(saved_dir, "oldest01", 1_000)
    _write_aged(saved_dir, "newest01", 2_000)

    slug = saved_tours.save_tour(_payload())

    remaining = {p.stem for p in saved_dir.glob("*.json")}
    assert remaining == {"oldest01", "newest01", slug}


def test_just_saved_tour_survives_cap_of_one(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 1)
    _write_aged(saved_dir, "older001", 1_000)
    _write_aged(saved_dir, "older002", 2_000)

    slug = saved_tours.save_tour(_payload())

    remaining = {p.stem for p in saved_dir.glob("*.json")}
    assert remaining == {slug}
    assert saved_tours.load_saved_tour(slug) is not None


def test_zero_cap_disables_pruning(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 0)
    for i in range(5):
        _write_aged(saved_dir, f"tour000{i}", 1_000 + i)

    saved_tours.save_tour(_payload())

    assert len(list(saved_dir.glob("*.json"))) == 6


def test_non_slug_files_ignored_and_never_deleted(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 2)
    # Not slug-shaped (stem too short / wrong chars / wrong suffix): ignored.
    _write_aged(saved_dir, "x", 100)
    (saved_dir / "notes.txt").write_text("not a tour", encoding="utf-8")
    (saved_dir / ".hidden.json").write_text("{}", encoding="utf-8")
    _write_aged(saved_dir, "tour0001", 1_000)
    _write_aged(saved_dir, "tour0002", 2_000)

    slug = saved_tours.save_tour(_payload())

    remaining = {p.name for p in saved_dir.iterdir()}
    # Only the oldest slug-shaped file was pruned; oddballs untouched.
    assert "x.json" in remaining
    assert "notes.txt" in remaining
    assert ".hidden.json" in remaining
    assert "tour0001.json" not in remaining
    assert "tour0002.json" in remaining
    assert f"{slug}.json" in remaining


def test_malformed_json_with_slug_name_is_prunable(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 2)
    _write_aged(saved_dir, "broken01", 1_000, content="{not json")
    _write_aged(saved_dir, "tour0002", 2_000)

    slug = saved_tours.save_tour(_payload())

    remaining = {p.stem for p in saved_dir.glob("*.json")}
    assert remaining == {"tour0002", slug}


def test_curated_tours_outside_saved_dir_untouched(saved_dir, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 1)
    curated = tmp_path / "tours"
    curated.mkdir()
    (curated / "plaza-classic.json").write_text(
        json.dumps({"name": "Plaza Classic"}), encoding="utf-8"
    )
    _write_aged(saved_dir, "older001", 1_000)

    saved_tours.save_tour(_payload())

    assert (curated / "plaza-classic.json").is_file()
    assert json.loads((curated / "plaza-classic.json").read_text())["name"] == "Plaza Classic"


def test_prune_failure_does_not_fail_the_save(saved_dir, monkeypatch):
    monkeypatch.setattr(settings, "SAVED_TOURS_MAX_FILES", 1)

    def boom(**kwargs):
        raise OSError("disk went away")

    monkeypatch.setattr(saved_tours, "prune_saved_tours", boom)
    slug = saved_tours.save_tour(_payload())
    assert saved_tours.load_saved_tour(slug) is not None

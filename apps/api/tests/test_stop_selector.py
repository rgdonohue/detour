"""Tests for stop_selector place loading and POI/stop field exposure."""
import csv as _csv

import pytest

import stop_selector
from main import TourStopBody

_CSV_COLUMNS = [
    "poi_id", "dedupe_key", "name", "lon", "lat", "primary_category",
    "short_description", "description_review_status",
]


def _write_places_csv(path, rows, columns=_CSV_COLUMNS):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = _csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            full = {c: "" for c in columns}
            full.update(r)
            writer.writerow(full)


_ROW = {
    "poi_id": "p1", "dedupe_key": "osm:node/1", "name": "Palace of the Governors",
    "lon": "-105.9376", "lat": "35.6873", "primary_category": "history",
    "short_description": "Oldest public building in the US.",
    "description_review_status": "unreviewed",
}


def _load_from(tmp_path, monkeypatch, rows, columns=_CSV_COLUMNS):
    csv_path = tmp_path / "places.csv"
    _write_places_csv(csv_path, rows, columns)
    monkeypatch.setattr(stop_selector, "_CSV_PATH", csv_path)
    return stop_selector._load_places()


def test_load_places_reads_review_status(tmp_path, monkeypatch):
    places = _load_from(tmp_path, monkeypatch, [_ROW])
    assert places[0]["review_status"] == "unreviewed"


def test_load_places_missing_review_status_column_is_none(tmp_path, monkeypatch):
    # Older curator CSVs predate the column; loading must not fail.
    columns = [c for c in _CSV_COLUMNS if c != "description_review_status"]
    places = _load_from(tmp_path, monkeypatch, [_ROW], columns)
    assert len(places) == 1
    assert places[0]["review_status"] is None


def test_load_places_blank_review_status_is_none(tmp_path, monkeypatch):
    places = _load_from(tmp_path, monkeypatch, [dict(_ROW, description_review_status=" ")])
    assert places[0]["review_status"] is None


@pytest.fixture
def _fake_places(tmp_path, monkeypatch):
    places = _load_from(tmp_path, monkeypatch, [_ROW])
    monkeypatch.setattr(stop_selector, "_STATIC_PLACES", places)
    return places


def test_geojson_properties_include_review_status(_fake_places):
    geojson = stop_selector.get_all_places_geojson()
    assert geojson["features"][0]["properties"]["review_status"] == "unreviewed"


def test_static_stops_include_review_status(_fake_places):
    # Route vertex right on the place -> within the 0.25 mi corridor.
    stops = stop_selector.select_from_static([[-105.9376, 35.6873]], category=None)
    assert len(stops) == 1
    assert stops[0]["review_status"] == "unreviewed"


def test_shipped_csv_loads_review_status():
    # The promoted v2 CSV carries description_review_status on every row.
    assert all(p["review_status"] is not None for p in stop_selector._STATIC_PLACES)


def test_tour_stop_body_round_trips_review_status():
    # Pydantic drops unknown fields on model_dump; review_status must be declared
    # or saved tours silently lose it.
    body = TourStopBody(
        order=1, name="Palace of the Governors", coordinates=(-105.9376, 35.6873),
        category="history", description="d", review_status="unreviewed",
    )
    assert body.model_dump()["review_status"] == "unreviewed"


def test_tour_stop_body_review_status_optional():
    body = TourStopBody(
        order=1, name="Palace of the Governors", coordinates=(-105.9376, 35.6873),
        category="history",
    )
    assert body.model_dump()["review_status"] is None

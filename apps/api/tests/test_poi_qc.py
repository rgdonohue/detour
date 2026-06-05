"""Tests for the POI QC promotion gate."""
import csv as _csv
import json as _json
import subprocess
import sys
from pathlib import Path as _Path

import poi_qc


def test_significant_tokens_drops_generic_and_short():
    # "house" is generic, "of" is generic, single chars dropped, "tudesque" kept
    assert poi_qc.significant_tokens("Roque Tudesque House East") == {"roque", "tudesque"}


def test_significant_tokens_relation_name_shares_with_wings():
    # The relation "Tudesque House" must share a token with the wings
    rel = poi_qc.significant_tokens("Tudesque House")
    wing = poi_qc.significant_tokens("Roque Tudesque House West")
    assert rel & wing == {"tudesque"}


def test_significant_tokens_distinct_galleries_share_nothing():
    a = poi_qc.significant_tokens("Patina Gallery")
    b = poi_qc.significant_tokens("Sorrel Sky Gallery")
    assert not (a & b)


def test_haversine_known_short_distance():
    # Tudesque node to West wing is ~9 m; assert it's in a tight band
    d = poi_qc.haversine_m(-105.938944, 35.6841299, -105.93903457267577, 35.6841571533804)
    assert 5.0 < d < 15.0


def test_haversine_zero():
    assert poi_qc.haversine_m(-105.9, 35.68, -105.9, 35.68) == 0.0


def test_check_schema_all_present():
    assert poi_qc.check_schema(list(poi_qc.REQUIRED_COLUMNS) + ["merged_from"]) == []


def test_check_schema_reports_missing():
    cols = [c for c in poi_qc.REQUIRED_COLUMNS if c != "lat"]
    failures = poi_qc.check_schema(cols)
    assert failures == ["missing required column: lat"]


def test_check_schema_none_fieldnames():
    failures = poi_qc.check_schema(None)
    assert len(failures) == len(poi_qc.REQUIRED_COLUMNS)


def _raw(**over):
    base = {
        "poi_id": "p1", "dedupe_key": "osm:node/1", "name": "Palace of the Governors",
        "lon": "-105.9376", "lat": "35.6873", "primary_category": "history",
    }
    base.update(over)
    return base


def test_parse_rows_accepts_valid():
    rows, failures = poi_qc.parse_rows([_raw()])
    assert failures == []
    assert len(rows) == 1
    assert rows[0].dedupe_key == "osm:node/1"
    assert rows[0].tokens == {"palace", "governors"}


def test_parse_rows_flags_swapped_coords():
    # lon/lat swapped -> outside bbox
    rows, failures = poi_qc.parse_rows([_raw(lon="35.6873", lat="-105.9376")])
    assert rows == []
    assert any("bbox" in f for f in failures)


def test_parse_rows_flags_non_numeric_coords():
    rows, failures = poi_qc.parse_rows([_raw(lon="abc")])
    assert rows == []
    assert any("not numeric" in f for f in failures)


def test_parse_rows_flags_invalid_category():
    rows, failures = poi_qc.parse_rows([_raw(primary_category="food")])
    assert any("invalid category" in f for f in failures)


def test_parse_rows_flags_unusable_name():
    rows, failures = poi_qc.parse_rows([_raw(name="?")])
    assert any("unusable name" in f for f in failures)


def test_parse_rows_flags_duplicate_dedupe_key():
    rows, failures = poi_qc.parse_rows([_raw(), _raw(poi_id="p2", name="Other")])
    assert any("duplicate dedupe_key" in f for f in failures)


def _row(idx, key, name, lon, lat):
    return poi_qc.PoiRow(
        index=idx, poi_id=key, dedupe_key=key, name=name,
        category="history", lon=lon, lat=lat, tokens=poi_qc.significant_tokens(name),
    )


TUDESQUE_ROWS = [
    _row(2, "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    _row(3, "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
    _row(4, "osm:way/461729208", "Roque Tudesque House West", -105.93903457267577, 35.6841571533804),
    _row(5, "osm:node/6479254097", "Roque Tudesque House", -105.938944, 35.6841299),
]


def test_residual_clusters_collapses_tudesque():
    clusters = poi_qc.find_residual_clusters(TUDESQUE_ROWS)
    assert len(clusters) == 1
    assert len(clusters[0]) == 4


def test_residual_clusters_ignores_distinct_galleries():
    # Two galleries ~2 m apart but no shared significant token
    rows = [
        _row(2, "g1", "Patina Gallery", -105.9300, 35.6850),
        _row(3, "g2", "Sorrel Sky Gallery", -105.93001, 35.68501),
    ]
    assert poi_qc.find_residual_clusters(rows) == []


def test_residual_clusters_ignores_far_same_name():
    # River Park E/W: share "river" token but ~570 m apart -> not merged
    rows = [
        _row(2, "r1", "Santa Fe River Park East", -105.9300, 35.6850),
        _row(3, "r2", "Santa Fe River Park West", -105.9360, 35.6850),
    ]
    assert poi_qc.find_residual_clusters(rows) == []


def test_residual_clusters_ignores_generic_geographic_and_honorific_tokens():
    # Distinct co-located features that share ONLY non-discriminating tokens must
    # not cluster: "santa"/"fe" carry no signal in a Santa Fe dataset, and "saint"
    # is a generic honorific. Each pair is ~2 m apart; the pairs are ~111 m apart.
    rows = [
        _row(2, "m1", "Santa Fe Farmers Market", -105.9300, 35.6850),
        _row(3, "m2", "Santa Fe Rail Yard District", -105.93001, 35.68501),
        _row(4, "s1", "Saint Francis of Assisi", -105.9310, 35.6860),
        _row(5, "s2", "Saint Kateri Tekakwitha", -105.93101, 35.68601),
    ]
    assert poi_qc.find_residual_clusters(rows) == []


def test_colocation_counts_distinct_name_stacks():
    # Two distinct galleries within 35 m -> one co-location cluster
    rows = [
        _row(2, "g1", "Patina Gallery", -105.9300, 35.6850),
        _row(3, "g2", "Sorrel Sky Gallery", -105.93001, 35.68501),
    ]
    assert poi_qc.count_colocation_clusters(rows) == 1


def test_colocation_excludes_same_feature_clusters():
    # Tudesque rows share a token -> that's a residual dup, NOT co-location
    assert poi_qc.count_colocation_clusters(TUDESQUE_ROWS) == 0


def test_colocation_excludes_lone_rows():
    rows = [_row(2, "g1", "Patina Gallery", -105.9300, 35.6850)]
    assert poi_qc.count_colocation_clusters(rows) == 0


def test_manifest_allowlist_extracts_colocated_members():
    manifest = {"clusters": [
        {"disposition": "collapsed", "survivor_poi_id": "p-rel", "dropped": []},
        {"disposition": "left_colocated", "members": ["g1", "g2"]},
    ]}
    assert poi_qc.manifest_allowlist(manifest) == [{"g1", "g2"}]


def test_filter_allowlisted_drops_covered_cluster():
    cluster = [_row(2, "g1", "A Gallery", -105.93, 35.685),
               _row(3, "g2", "B Gallery", -105.93, 35.685)]
    # (these share no token in reality; constructed directly to test filtering)
    remaining = poi_qc.filter_allowlisted([cluster], [{"g1", "g2"}])
    assert remaining == []


def test_filter_allowlisted_keeps_uncovered_cluster():
    remaining = poi_qc.filter_allowlisted([TUDESQUE_ROWS], [{"g1", "g2"}])
    assert len(remaining) == 1


def test_cross_check_passes_when_consistent():
    rows = [_row(2, "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725)]
    rows[0].poi_id = "p-rel"
    manifest = {
        "summary": {"rows_after": 1},
        "clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                      "dropped": [{"dedupe_key": "osm:way/461729209"}]}],
    }
    assert poi_qc.cross_check_manifest(rows, manifest) == []


def test_cross_check_flags_dropped_still_present():
    rows = [_row(2, "osm:way/461729209", "Roque Tudesque House East", -105.9387, 35.6840)]
    manifest = {"clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                              "dropped": [{"dedupe_key": "osm:way/461729209"}]}]}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("still present" in f for f in failures)


def test_cross_check_flags_missing_survivor():
    rows = [_row(2, "k1", "Something Else", -105.93, 35.685)]
    manifest = {"clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                              "dropped": []}]}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("survivor" in f and "missing" in f for f in failures)


def test_cross_check_flags_rowcount_mismatch():
    rows = [_row(2, "k1", "Something", -105.93, 35.685)]
    manifest = {"summary": {"rows_after": 99}, "clusters": []}
    failures = poi_qc.cross_check_manifest(rows, manifest)
    assert any("rows_after" in f for f in failures)


_CSV_HEADER = list(poi_qc.REQUIRED_COLUMNS)


def _write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = _csv.DictWriter(f, fieldnames=_CSV_HEADER, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            full = {c: "" for c in _CSV_HEADER}
            full.update(r)
            writer.writerow(full)


def _csv_row(poi_id, key, name, lon, lat, category="history"):
    return {"poi_id": poi_id, "dedupe_key": key, "name": name,
            "lon": str(lon), "lat": str(lat), "primary_category": category,
            "display_priority": "50", "quality_score": "60",
            "walk_affinity_hint": "0.5", "drive_affinity_hint": "0.5",
            "description_confidence_v1": "medium"}


def test_run_qc_fails_on_duplicate_cluster(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("p2", "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
        _csv_row("p3", "osm:way/461729208", "Roque Tudesque House West", -105.93903457267577, 35.6841571533804),
        _csv_row("p4", "osm:node/6479254097", "Roque Tudesque House", -105.938944, 35.6841299),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.passed is False
    assert any("residual same-feature cluster" in f for f in result.failures)


def test_run_qc_passes_on_clean_csv(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("g1", "g1", "Patina Gallery", -105.9300, 35.6850, "art"),
        _csv_row("g2", "g2", "Sorrel Sky Gallery", -105.93001, 35.68501, "art"),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.passed is True
    assert result.failures == []
    assert result.info["colocation_clusters"] == 1


def test_run_qc_fails_on_missing_column(tmp_path):
    csv_path = tmp_path / "v.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        # header missing "lat"
        cols = [c for c in _CSV_HEADER if c != "lat"]
        writer = _csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        writer.writeheader()
    result = poi_qc.run_qc(csv_path)
    assert result.passed is False
    assert any("missing required column: lat" in f for f in result.failures)


def test_run_qc_cross_checks_manifest(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p-rel", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    manifest_path = tmp_path / "m.json"
    manifest_path.write_text(_json.dumps({
        "summary": {"rows_after": 1},
        "clusters": [{"disposition": "collapsed", "survivor_poi_id": "p-rel",
                      "dropped": [{"dedupe_key": "osm:way/461729209"}]}],
    }), encoding="utf-8")
    result = poi_qc.run_qc(csv_path, manifest_path)
    assert result.passed is True
    assert result.info["manifest_present"] is True


def test_run_qc_warns_without_manifest(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    result = poi_qc.run_qc(csv_path)
    assert result.info["manifest_present"] is False


def test_run_qc_tolerates_utf8_bom(tmp_path):
    # A CSV exported from a spreadsheet carries a UTF-8 BOM; utf-8-sig strips it
    # so DictReader.fieldnames[0] is "poi_id", not "﻿poi_id".
    csv_path = tmp_path / "bom.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = _csv.DictWriter(f, fieldnames=_CSV_HEADER, extrasaction="ignore")
        writer.writeheader()
        full = {c: "" for c in _CSV_HEADER}
        full.update(_csv_row("p1", "osm:relation/13422888", "Tudesque House",
                             -105.93883405, 35.68407725))
        writer.writerow(full)
    result = poi_qc.run_qc(csv_path)
    assert not any("missing required column" in f for f in result.failures), result.failures


def test_run_qc_missing_csv_is_clean_failure():
    result = poi_qc.run_qc(_Path("/nonexistent/nope.csv"))
    assert result.passed is False
    assert any("could not read" in f or "not found" in f for f in result.failures)
    # info keys must match the normal path so the CLI's print lines don't KeyError
    assert result.info["row_count"] == 0
    assert result.info["colocation_clusters"] == 0
    assert result.info["manifest_present"] is False


def test_run_qc_malformed_manifest_invalid_json(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    manifest_path = tmp_path / "m.json"
    manifest_path.write_text("{not json", encoding="utf-8")
    result = poi_qc.run_qc(csv_path, manifest_path)
    assert result.passed is False
    assert any("manifest" in f for f in result.failures), result.failures


def test_run_qc_malformed_manifest_clusters_not_list(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    manifest_path = tmp_path / "m.json"
    # valid JSON, but clusters is a string and one entry is a non-dict
    manifest_path.write_text(_json.dumps({"clusters": "oops"}), encoding="utf-8")
    result = poi_qc.run_qc(csv_path, manifest_path)
    assert result.passed is False
    assert any("manifest" in f for f in result.failures), result.failures


# test file: repo/apps/api/tests/test_poi_qc.py -> parents[3] is the repo root
_REPO_ROOT = _Path(__file__).resolve().parents[3]
_CLI = _REPO_ROOT / "scripts" / "qc_pois.py"


def test_cli_exits_zero_on_clean_csv(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
    ])
    proc = subprocess.run(
        [sys.executable, str(_CLI), "--csv", str(csv_path)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 0, proc.stderr
    assert "PASS" in proc.stdout


def test_cli_exits_one_on_duplicate_cluster(tmp_path):
    csv_path = tmp_path / "v.csv"
    _write_csv(csv_path, [
        _csv_row("p1", "osm:relation/13422888", "Tudesque House", -105.93883405, 35.68407725),
        _csv_row("p2", "osm:way/461729209", "Roque Tudesque House East", -105.9387482642101, 35.684025653980406),
    ])
    proc = subprocess.run(
        [sys.executable, str(_CLI), "--csv", str(csv_path)],
        capture_output=True, text=True,
    )
    assert proc.returncode == 1
    assert "FAIL" in proc.stdout

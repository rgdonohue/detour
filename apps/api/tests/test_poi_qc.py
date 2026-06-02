"""Tests for the POI QC promotion gate."""
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

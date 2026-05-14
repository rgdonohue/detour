"""Test coordinate quantization."""
from coords import quantize


def test_quantize_default_4_decimals():
    """Default rounding takes a raw click to a 4-decimal grid."""
    assert quantize(-105.93847291, 35.68392184) == (-105.9385, 35.6839)


def test_quantize_idempotent():
    """Quantizing an already-quantized value is a no-op."""
    q1 = quantize(-105.93847291, 35.68392184)
    q2 = quantize(*q1)
    assert q1 == q2


def test_quantize_near_intersection_collapses():
    """Two clicks within ~10 m at the same intersection collapse to one key."""
    a = quantize(-105.93847, 35.68392)
    b = quantize(-105.93853, 35.68394)  # ~6 m east, ~2 m north
    assert a == b


def test_quantize_distinct_points_remain_distinct():
    """Two clicks one block apart do not collapse."""
    a = quantize(-105.9385, 35.6839)
    b = quantize(-105.9395, 35.6849)  # ~150 m away
    assert a != b


def test_quantize_custom_decimals():
    """Explicit decimals argument overrides the default."""
    assert quantize(-105.93847291, 35.68392184, decimals=2) == (-105.94, 35.68)

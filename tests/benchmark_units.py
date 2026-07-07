"""Unit tests for benchmark honesty helpers (Phase 0.5).

Run: PYTHONPATH=. .venv/bin/python tests/benchmark_units.py
"""

from __future__ import annotations

from crossage_fr.benchmark_quality import BENCHMARK_DISCLAIMER, wilson_interval


def test_wilson_interval_brackets_point_estimate() -> None:
    lo, hi = wilson_interval(8, 10)
    assert 0.0 <= lo <= 0.8 <= hi <= 1.0


def test_wilson_interval_no_data_is_maximally_uncertain() -> None:
    assert wilson_interval(0, 0) == (0.0, 1.0)


def test_wilson_interval_tightens_with_sample_size() -> None:
    small = wilson_interval(8, 10)
    large = wilson_interval(800, 1000)
    assert (large[1] - large[0]) < (small[1] - small[0])


def test_wilson_interval_is_clamped() -> None:
    lo, hi = wilson_interval(10, 10)
    assert 0.0 <= lo <= hi <= 1.0


def test_disclaimer_is_honest() -> None:
    assert isinstance(BENCHMARK_DISCLAIMER, str)
    assert "closed-set" in BENCHMARK_DISCLAIMER.lower()


def main() -> None:
    test_wilson_interval_brackets_point_estimate()
    test_wilson_interval_no_data_is_maximally_uncertain()
    test_wilson_interval_tightens_with_sample_size()
    test_wilson_interval_is_clamped()
    test_disclaimer_is_honest()
    print("benchmark units ok")


if __name__ == "__main__":
    main()

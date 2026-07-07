"""Unit tests for cross-age gap banding (crossage_fr.match.age_gap).

Run via `npm run test:age-gap` (PYTHONPATH=. .venv/bin/python tests/age_gap_units.py).
"""

from __future__ import annotations

from crossage_fr.match.age_gap import (
    CROSS_AGE_GAP_FLAG,
    compute_age_gap,
    confidence_for_gap,
)


def assert_band_boundaries() -> None:
    assert confidence_for_gap(0.0) == "high"
    assert confidence_for_gap(2.0) == "high"
    assert confidence_for_gap(2.01) == "moderate"
    assert confidence_for_gap(4.0) == "moderate"
    assert confidence_for_gap(4.01) == "low"
    assert confidence_for_gap(6.0) == "low"
    assert confidence_for_gap(6.01) == "very-low"
    assert confidence_for_gap(20.0) == "very-low"
    # Direction-independent.
    assert confidence_for_gap(-8.0) == "very-low"


def assert_compute_age_gap() -> None:
    # ~1 year gap -> high, no flag.
    years, conf, flag = compute_age_gap("2020-06-01", "2019-06-01")
    assert years is not None and abs(years - 1.0) < 0.02, years
    assert conf == "high"
    assert flag is None

    # ~10 year gap -> very-low, flagged.
    years, conf, flag = compute_age_gap("2020-01-01", "2010-01-01")
    assert years is not None and abs(years - 10.0) < 0.05, years
    assert conf == "very-low"
    assert flag == CROSS_AGE_GAP_FLAG

    # Exactly the flag threshold (4y) flags.
    years, conf, flag = compute_age_gap("2024-01-01", "2020-01-01")
    assert flag == CROSS_AGE_GAP_FLAG, (years, conf, flag)

    # Tolerates EXIF-style and ISO-timestamp formats; order-independent.
    years, _, _ = compute_age_gap("2020:06:01 12:00:00", "2018-06-01T00:00:00Z")
    assert years is not None and abs(years - 2.0) < 0.05, years

    # Missing/garbage dates are inert (never block a candidate).
    assert compute_age_gap(None, "2020-01-01") == (None, None, None)
    assert compute_age_gap("2020-01-01", "") == (None, None, None)
    assert compute_age_gap("not-a-date", "2020-01-01") == (None, None, None)


def main() -> None:
    assert_band_boundaries()
    assert_compute_age_gap()
    print("age gap units ok")


if __name__ == "__main__":
    main()

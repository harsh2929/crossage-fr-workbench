"""Cross-age gap estimation and NIST-grounded confidence banding.

The product is recall-first and human-in-the-loop because wide-gap child->adult
recognition is provably weak. NIST IFPC 2025 (Longitudinal Evaluation of Child Face
Recognition) reports TAR@0.1%FAR collapsing with the enrolment->probe age gap:
~98.5% at 2 years, ~95.7% at 4 years, ~87.2% at 6 years, ~71.3% at 8 years.

This module turns the gap between a reference photo's capture date and a candidate
photo's capture date into a coarse, honest confidence band. It NEVER asserts identity;
it only tells the reviewer how much weight the machine score deserves given the gap.
"""

from __future__ import annotations

from datetime import date, datetime

# (max_inclusive_years, confidence_band). Mirrors the NIST IFPC 2025 TAR cliff.
_BANDS: tuple[tuple[float, str], ...] = (
    (2.0, "high"),
    (4.0, "moderate"),
    (6.0, "low"),
)
_WIDE_GAP_BAND = "very-low"

# A gap at or beyond this many years earns the cross-age-gap review flag.
FLAG_THRESHOLD_YEARS = 4.0
CROSS_AGE_GAP_FLAG = "cross-age-gap"

_DATE_FORMATS = ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S")


def _parse_date(value: str | None) -> date | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    # Tolerate a trailing Z / time component by trying progressively looser parses.
    candidate = text[:-1] if text.endswith("Z") else text
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(candidate, fmt).date()
        except ValueError:
            continue
    # Last resort: ISO date prefix (YYYY-MM-DD).
    try:
        return date.fromisoformat(candidate[:10])
    except ValueError:
        return None


def confidence_for_gap(years: float) -> str:
    """Return the NIST-grounded confidence band for an absolute age gap in years."""
    magnitude = abs(years)
    for ceiling, band in _BANDS:
        if magnitude <= ceiling:
            return band
    return _WIDE_GAP_BAND


ESTIMATED_BAND = "estimated"


def compute_age_gap(
    candidate_date: str | None,
    reference_date: str | None,
    *,
    candidate_provenance: str = "exif",
    reference_provenance: str = "exif",
) -> tuple[float | None, str | None, str | None]:
    """Compute (age_gap_years, confidence_band, review_flag).

    Returns (None, None, None) when either date is missing/unparseable — the feature is
    purely additive and must never block a candidate when dates are unknown.

    §5.4 governance: the NIST confidence band and the cross-age review flag are only
    trustworthy when BOTH dates are real EXIF event dates. If either date is the
    mtime fallback (the scan date for a digitized historical photo) the numeric gap
    may be meaningless, so we return the gap as informational with confidence
    "estimated" and NO review flag — the reviewer is told the gap is unverified
    rather than shown a false NIST reliability band.
    """
    cand = _parse_date(candidate_date)
    ref = _parse_date(reference_date)
    if cand is None or ref is None:
        return (None, None, None)
    years = round(abs((cand - ref).days) / 365.25, 2)
    verified = candidate_provenance == "exif" and reference_provenance == "exif"
    if not verified:
        return (years, ESTIMATED_BAND, None)
    confidence = confidence_for_gap(years)
    flag = CROSS_AGE_GAP_FLAG if years >= FLAG_THRESHOLD_YEARS else None
    return (years, confidence, flag)

"""Active-learning review ordering + abstention (Phase-4 lever 4).

For a review-first, single-user app the experienced quality is *recall at a fixed
human-review budget*, not TAR@FAR -- the queue should put the likely-true matches first
and push genuinely information-limited faces (badly-aligned + sub-resolution, or near-zero
quality) OUT of the way so they don't cost reviewer attention. This is pure, offline,
license-clean ranking over signals the pipeline already captures (calibrated probability,
alignment residual, inter-eye distance, quality).
"""

from __future__ import annotations

from crossage_fr.match.scoring import ALIGNMENT_SUSPECT_THRESHOLD

# Identity is physically unresolvable below ~24px inter-eye distance; combined with a
# bad-alignment crop the recognizer score is noise, so such a face is abstained
# (low-information lane) rather than ranked among real candidates.
MIN_RESOLVABLE_IED_PX = 24.0
VERY_LOW_QUALITY = 0.10
# Small weight: confidence dominates ordering (find matches first); boundary-case
# uncertainty only breaks ties (the candidates most worth a label, active-learning).
UNCERTAINTY_WEIGHT = 0.03

_LANE_BASE = {"surface": 2.0, "review": 1.0, "low-information": 0.0}


def review_lane(
    *,
    band: str,
    align_error: float = 0.0,
    ied_px: float = 0.0,
    quality: float = 0.0,
) -> str:
    """Lane for the review queue: 'surface' (likely-true, shown first), 'review'
    (cross-age / lower-confidence maybes), or 'low-information' (abstain -- pushed down)."""
    information_limited = (
        (align_error >= ALIGNMENT_SUSPECT_THRESHOLD and 0.0 < ied_px < MIN_RESOLVABLE_IED_PX)
        or (0.0 < quality < VERY_LOW_QUALITY)
    )
    if information_limited:
        return "low-information"
    if band in ("confident", "likely"):
        return "surface"
    return "review"


def review_priority(
    *,
    lane: str,
    probability: float | None = None,
    score: float = 0.0,
) -> float:
    """Descending-sort key: lane first (surface > review > low-information), then
    calibrated confidence (find likely matches first), with a small uncertainty tiebreak
    so boundary cases worth a label rise within their lane."""
    confidence = float(probability) if probability is not None else float(score)
    confidence = max(0.0, min(1.0, confidence))
    uncertainty = 1.0 - abs(2.0 * confidence - 1.0)  # peaks at confidence 0.5
    return _LANE_BASE.get(lane, 1.0) + confidence + UNCERTAINTY_WEIGHT * uncertainty

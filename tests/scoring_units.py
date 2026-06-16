"""Unit tests for the pure scoring/validation math (MA-1).

These functions used to be self-less methods buried in the 6k-line ProjectState
god-object, where they could not be tested without constructing the whole
manager. Moving them to crossage_fr/match/scoring.py makes them unit-testable in
isolation — this file is the demonstration + regression net.

Run: PYTHONPATH=. .venv/bin/python tests/scoring_units.py
"""

from __future__ import annotations

from crossage_fr.config import Thresholds
from crossage_fr.match import accuracy_at_threshold, accuracy_from_label_rows, valid_candidate, valid_reference
from crossage_fr.match.age_gap import CROSS_AGE_GAP_FLAG, ESTIMATED_BAND, compute_age_gap
from crossage_fr.match.review_order import review_lane, review_priority
from crossage_fr.match.scoring import band_for_score, finite_number, group_hits, valid_vector
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store import SearchHit


def test_age_gap_provenance_governance() -> None:
    # §5.4: a wide gap with BOTH dates EXIF-verified earns a real NIST band + flag.
    years, band, flag = compute_age_gap("2010-01-01", "2018-01-01")  # defaults exif/exif
    assert years == 8.0 and band == "very-low" and flag == CROSS_AGE_GAP_FLAG
    # If EITHER date is mtime-derived (the scan date for a digitized historical),
    # the gap is unverified: returned as informational but banded "estimated" with
    # NO cross-age flag — never a false NIST reliability signal.
    for cand_prov, ref_prov in (("mtime", "exif"), ("exif", "mtime"), ("mtime", "mtime"), ("unknown", "exif")):
        y, b, f = compute_age_gap("2010-01-01", "2026-01-01", candidate_provenance=cand_prov, reference_provenance=ref_prov)
        assert y is not None and b == ESTIMATED_BAND and f is None, (cand_prov, ref_prov, y, b, f)
    # Missing dates stay fully additive (never block a candidate).
    assert compute_age_gap(None, "2018-01-01") == (None, None, None)


def test_legacy_candidate_band_is_regated_on_reload() -> None:
    # §5.4 invariant: a candidate persisted by the pre-provenance build stores a
    # real NIST band + cross-age-gap flag with NO provenance keys. Reconstructing
    # it (the reload path) must DOWNGRADE it to "estimated" and drop the flag, so
    # serializers and the examination report never emit a false reliability band.
    legacy = dict(
        candidate_id="c1", source_path="/p.jpg", person_name="Missing Child",
        best_ref_id="r1", best_ref_path="/r.jpg", score=0.93, band="confident",
        quality=0.9, model_name="m", status="accepted", risk_flags=["cross-age-gap"],
        capture_date="2019-03-01", reference_capture_date="2005-03-01",
        age_gap_years=14.0, age_gap_confidence="very-low",  # no *_provenance keys
    )
    reloaded = ReviewCandidate(**legacy)
    assert reloaded.age_gap_confidence == "estimated"
    assert "cross-age-gap" not in reloaded.risk_flags
    # A genuinely EXIF-verified candidate keeps its real band + flag.
    verified = ReviewCandidate(**{**legacy, "capture_date_provenance": "exif", "reference_capture_date_provenance": "exif"})
    assert verified.age_gap_confidence == "very-low"
    assert "cross-age-gap" in verified.risk_flags


def _ref(ref_id: str, name: str) -> ReferenceFace:
    return ReferenceFace(
        ref_id=ref_id, person_name=name, age_bucket="adult", source_path=f"/{ref_id}.jpg",
        capture_date=None, quality=0.9, model_name="m", vector=[0.0] * 512,
    )


def _ref_dated(ref_id: str, name: str, capture_date: str | None) -> ReferenceFace:
    return ReferenceFace(
        ref_id=ref_id, person_name=name, age_bucket="child", source_path=f"/{ref_id}.jpg",
        capture_date=capture_date, quality=0.9, model_name="m", vector=[0.0] * 512,
    )


def test_age_consistent_same_era_support_is_additive_and_degrade_safe() -> None:
    th = Thresholds()
    refs = {"r1": _ref_dated("r1", "Alice", "2010-07-01")}
    hits = [SearchHit(item_id="r1", score=0.30)]
    base = group_hits(hits, refs, th)  # no candidate date -> current behavior
    near = group_hits(hits, refs, th, candidate_capture_date="2010-06-01")  # same era
    far = group_hits(hits, refs, th, candidate_capture_date="2025-06-01")   # decades apart
    # Same-era reference support adds a small, additive confidence boost...
    assert near.score > base.score
    assert "age-consistent" in near.flags
    # ...while a different-era (true cross-age) pair degrades to current behavior: no
    # penalty, no spurious boost -- recall is never reduced.
    assert far.score == base.score
    assert "age-consistent" not in far.flags


def test_misaligned_face_cannot_be_confident_but_cross_age_unharmed() -> None:
    refs = {"r1": _ref("r1", "Alice")}
    th = Thresholds()
    confident_hits = [SearchHit(item_id="r1", score=0.50)]
    # Well-aligned crop keeps its confident band.
    assert group_hits(confident_hits, refs, th, candidate_align_error=0.02).band == "confident"
    # A badly-aligned crop (bad landmarks / extreme pose) cannot be auto-confident.
    poor = group_hits(confident_hits, refs, th, candidate_align_error=0.30)
    assert poor.band == "likely"
    assert "alignment-suspect" in poor.flags
    # The cross-age relaxed band is NEVER penalized for alignment (recall-safe; cross-age
    # faces are often the hardest to align).
    relaxed = group_hits([SearchHit(item_id="r1", score=0.22)], refs, th, candidate_align_error=0.30)
    assert "alignment-suspect" not in relaxed.flags


def test_weak_pooled_support_cannot_be_confident_but_cross_age_unharmed() -> None:
    refs = {"r1": _ref("r1", "Alice")}
    th = Thresholds()
    confident_hits = [SearchHit(item_id="r1", score=0.50)]
    # Match agrees with the person's robust pooled template -> stays confident.
    assert group_hits(confident_hits, refs, th, candidate_template_cosines={"Alice": 0.48}).band == "confident"
    # Strong match to one ref (0.50) but weak agreement with the pooled template (0.30)
    # -> leaned on an outlier crop -> demoted (precision-only).
    poor = group_hits(confident_hits, refs, th, candidate_template_cosines={"Alice": 0.30})
    assert poor.band == "likely"
    assert "weak-pooled-support" in poor.flags
    # Cross-age relaxed band is never penalized for weak pooled support (recall-safe).
    relaxed = group_hits([SearchHit(item_id="r1", score=0.22)], refs, th, candidate_template_cosines={"Alice": 0.05})
    assert "weak-pooled-support" not in relaxed.flags


def test_low_cohort_separation_cannot_be_confident_but_cross_age_unharmed() -> None:
    refs = {"r1": _ref("r1", "Alice")}
    th = Thresholds()
    confident_hits = [SearchHit(item_id="r1", score=0.50)]
    # Probe stands out from its impostor cohort (other people score ~0.10) -> confident.
    assert group_hits(confident_hits, refs, th, candidate_cohort_scores=[0.10] * 6).band == "confident"
    # Probe matches other people about as well as the target (generic face) -> demote.
    poor = group_hits(confident_hits, refs, th, candidate_cohort_scores=[0.52, 0.51, 0.53, 0.50, 0.49])
    assert poor.band == "likely"
    assert "low-cohort-separation" in poor.flags
    # Cross-age relaxed band is never penalized for cohort separation (recall-safe).
    relaxed = group_hits([SearchHit(item_id="r1", score=0.22)], refs, th, candidate_cohort_scores=[0.49] * 6)
    assert "low-cohort-separation" not in relaxed.flags


def test_low_quality_crop_cannot_be_confident_but_cross_age_unharmed() -> None:
    refs = {"r1": _ref("r1", "Alice")}
    th = Thresholds()  # confident 0.40 / likely 0.28 / relaxed_child 0.20
    confident_hits = [SearchHit(item_id="r1", score=0.50)]
    # Good-quality crop keeps its confident band.
    assert group_hits(confident_hits, refs, th, candidate_quality=0.80).band == "confident"
    # A clearly-degraded crop is demoted to 'likely' (review), never auto-confident.
    poor = group_hits(confident_hits, refs, th, candidate_quality=0.10)
    assert poor.band == "likely"
    assert "low-quality-demoted" in poor.flags
    assert poor.score < th.confident
    # A cross-age relaxed-band match is NEVER penalized by low quality (recall-safe).
    relaxed = group_hits([SearchHit(item_id="r1", score=0.22)], refs, th, candidate_quality=0.10)
    assert relaxed.band == band_for_score(relaxed.score, th)
    assert "low-quality-demoted" not in relaxed.flags


def test_group_hits_captures_raw_cosine_not_fused_score() -> None:
    # Two references for one person both score high -> a support bonus lifts the
    # FUSED score above the top raw cosine. raw_cosine must capture the top raw
    # cosine (0.50), decoupled from the bonus-inflated decision score.
    refs = {"r1": _ref("r1", "Alice"), "r2": _ref("r2", "Alice")}
    hits = [SearchHit(item_id="r1", score=0.50), SearchHit(item_id="r2", score=0.48)]
    decision = group_hits(hits, refs, Thresholds())
    assert decision is not None
    assert decision.raw_cosine == 0.50
    assert decision.score > 0.50  # fused score includes the multi-reference support bonus


def test_review_lane_abstains_information_limited_faces() -> None:
    # Badly-aligned AND tiny (sub-resolution) face -> low-information (abstain lane).
    assert review_lane(band="confident", align_error=0.30, ied_px=15.0) == "low-information"
    # Very low quality -> low-information regardless of band.
    assert review_lane(band="likely", quality=0.05) == "low-information"
    # Strong, well-resolved match -> surface (top of the queue).
    assert review_lane(band="confident", align_error=0.02, ied_px=80.0, quality=0.7) == "surface"
    # A cross-age "maybe" is surfaced but in the middle review lane, never abstained.
    assert review_lane(band="child-bucket maybe", ied_px=80.0, quality=0.5) == "review"


def test_review_priority_orders_surface_then_review_then_low_info() -> None:
    # Lane dominates: a surfaced match outranks a review/low-info one even at lower
    # confidence -- the abstention structure is the point.
    assert review_priority(lane="surface", probability=0.8) > review_priority(lane="review", probability=0.95)
    assert review_priority(lane="review", probability=0.9) > review_priority(lane="low-information", probability=0.9)
    # Within a lane, higher confidence ranks higher (find the likely matches first).
    assert review_priority(lane="surface", probability=0.9) > review_priority(lane="surface", probability=0.3)
    # Falls back to the raw score when no calibrated probability is available.
    assert review_priority(lane="surface", score=0.7) > review_priority(lane="surface", score=0.2)


def test_accuracy_from_label_rows() -> None:
    rows = [
        {"matchScore": 0.9, "isMatch": True},   # TP
        {"matchScore": 0.8, "isMatch": False},  # FP
        {"matchScore": 0.1, "isMatch": False},  # TN
        {"matchScore": 0.2, "isMatch": True},   # FN
        {"matchScore": "bad", "isMatch": True},  # coerces to 0.0 -> FN
    ]
    m = accuracy_from_label_rows(rows, 0.5)
    assert (m["truePositives"], m["falsePositives"], m["trueNegatives"], m["falseNegatives"]) == (1, 1, 1, 2)
    assert m["labeled"] == 5
    assert m["precision"] == 0.5
    assert m["recall"] == round(1 / 3, 4)


def test_accuracy_at_threshold() -> None:
    def cand(score: float, status: str) -> ReviewCandidate:
        return ReviewCandidate(
            candidate_id="c", source_path="/x", person_name="p", best_ref_id="r",
            best_ref_path="/r", score=score, band="likely", quality=0.9,
            model_name="m", status=status,
        )
    rows = [cand(0.9, "accepted"), cand(0.4, "accepted"), cand(0.8, "rejected")]
    m = accuracy_at_threshold(rows, 0.5)
    assert m["truePositives"] == 1 and m["falsePositives"] == 1 and m["falseNegatives"] == 1
    assert m["threshold"] == 0.5 and m["labeled"] == 3


def test_finite_and_vector() -> None:
    assert finite_number(1) is True and finite_number(2.5) is True
    assert finite_number(True) is False  # bool is not a number here
    assert finite_number(float("nan")) is False and finite_number(float("inf")) is False
    assert finite_number("3") is False
    assert valid_vector([0.0] * 512) is True
    assert valid_vector([0.0] * 511) is False
    assert valid_vector("not a list") is False
    assert valid_vector([float("nan")] + [0.0] * 511) is False


def test_valid_reference_and_candidate() -> None:
    good_ref = ReferenceFace(
        ref_id="r1", person_name="Alice", age_bucket="adult", source_path="/p.jpg",
        capture_date="", quality=0.9, model_name="insightface-antelopev2", vector=[0.01] * 512,
    )
    assert valid_reference(good_ref) is True
    bad_ref = ReferenceFace(
        ref_id="", person_name="", age_bucket="adult", source_path="/p.jpg",
        capture_date="", quality=0.9, model_name="m", vector=[0.01] * 512,
    )
    assert valid_reference(bad_ref) is False

    good_cand = ReviewCandidate(
        candidate_id="c1", source_path="/x.jpg", person_name="Alice", best_ref_id="r1",
        best_ref_path="/r.jpg", score=0.7, band="likely", quality=0.8, model_name="m", status="pending",
    )
    assert valid_candidate(good_cand) is True
    bad_cand = ReviewCandidate(
        candidate_id="c1", source_path="/x.jpg", person_name="Alice", best_ref_id="r1",
        best_ref_path="/r.jpg", score=float("nan"), band="likely", quality=0.8, model_name="m", status="bogus",
    )
    assert valid_candidate(bad_cand) is False


def main() -> None:
    test_review_lane_abstains_information_limited_faces()
    test_review_priority_orders_surface_then_review_then_low_info()
    test_accuracy_from_label_rows()
    test_age_consistent_same_era_support_is_additive_and_degrade_safe()
    test_misaligned_face_cannot_be_confident_but_cross_age_unharmed()
    test_weak_pooled_support_cannot_be_confident_but_cross_age_unharmed()
    test_low_cohort_separation_cannot_be_confident_but_cross_age_unharmed()
    test_low_quality_crop_cannot_be_confident_but_cross_age_unharmed()
    test_group_hits_captures_raw_cosine_not_fused_score()
    test_accuracy_at_threshold()
    test_finite_and_vector()
    test_valid_reference_and_candidate()
    test_age_gap_provenance_governance()
    test_legacy_candidate_band_is_regated_on_reload()
    print("scoring units ok")


if __name__ == "__main__":
    main()

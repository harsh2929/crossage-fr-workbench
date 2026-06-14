"""Unit tests for the pure scoring/validation math (MA-1).

These functions used to be self-less methods buried in the 6k-line ProjectState
god-object, where they could not be tested without constructing the whole
manager. Moving them to crossage_fr/match/scoring.py makes them unit-testable in
isolation — this file is the demonstration + regression net.

Run: PYTHONPATH=. .venv/bin/python tests/scoring_units.py
"""

from __future__ import annotations

from crossage_fr.match import accuracy_at_threshold, accuracy_from_label_rows, valid_candidate, valid_reference
from crossage_fr.match.scoring import finite_number, valid_vector
from crossage_fr.models import ReferenceFace, ReviewCandidate


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
    test_accuracy_from_label_rows()
    test_accuracy_at_threshold()
    test_finite_and_vector()
    test_valid_reference_and_candidate()
    print("scoring units ok")


if __name__ == "__main__":
    main()

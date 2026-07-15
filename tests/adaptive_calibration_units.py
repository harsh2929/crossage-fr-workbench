"""Unit and held-out gates for AC-Linear plus symmetric fixed-cohort AS-Norm."""

from __future__ import annotations

import json
import os
from pathlib import Path
import tempfile

import numpy as np

from crossage_fr.config import load_config
from crossage_fr.match.calibration import (
    AdaptiveLinearCalibrator,
    CohortNormalizer,
    fit_adaptive_linear,
    normalized_pair_center,
    probability_calibration_metrics,
    validate_adaptive_calibration,
)


def _regional_rows(identity_count: int = 20, dimension: int = 4) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    region_a = [1.0] + [0.0] * (dimension - 1)
    region_b = [-1.0] + [0.0] * (dimension - 1)
    for index in range(identity_count):
        person = f"P{index:02d}"
        pose = "frontal" if index % 2 == 0 else "profile"
        media = "image" if index % 3 else "video"
        age_gap = float((index % 4) * 4)
        # The same 0.42 cosine is a match in region A and an impostor in region B.
        # A global monotonic map cannot resolve that local calibration mismatch.
        rows.extend(
            [
                {"expectedPerson": person, "isMatch": True, "rawCosine": 0.42, "matchScore": 0.42, "pairCenter": region_a, "poseBucket": pose, "mediaKind": media, "ageGapYears": age_gap, "modelName": "m"},
                {"expectedPerson": person, "isMatch": False, "rawCosine": 0.22, "matchScore": 0.22, "pairCenter": region_a, "poseBucket": pose, "mediaKind": media, "ageGapYears": age_gap, "modelName": "m"},
                {"expectedPerson": person, "isMatch": True, "rawCosine": 0.62, "matchScore": 0.62, "pairCenter": region_b, "poseBucket": pose, "mediaKind": media, "ageGapYears": age_gap, "modelName": "m"},
                {"expectedPerson": person, "isMatch": False, "rawCosine": 0.42, "matchScore": 0.42, "pairCenter": region_b, "poseBucket": pose, "mediaKind": media, "ageGapYears": age_gap, "modelName": "m"},
            ]
        )
    return rows


def test_normalized_pair_center_is_symmetric_and_guarded() -> None:
    left = [1.0, 0.0, 0.0]
    right = [0.0, 1.0, 0.0]
    first = normalized_pair_center(left, right)
    second = normalized_pair_center(right, left)
    assert first is not None and second is not None
    assert np.allclose(first, second)
    assert abs(float(np.linalg.norm(first)) - 1.0) < 1e-6
    assert normalized_pair_center([1.0, 0.0], [-1.0, 0.0]) is None
    assert normalized_pair_center([1.0], [1.0, 2.0]) is None


def test_symmetric_as_norm_uses_both_pair_sides() -> None:
    cohort = np.asarray(
        [
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, -1.0, 0.0],
        ],
        dtype="float32",
    )
    normalizer = CohortNormalizer(cohort)
    probe = [1.0, 0.0, 0.0]
    reference = [0.8, 0.6, 0.0]
    raw = float(np.dot(np.asarray(probe), np.asarray(reference)))
    expected = 0.5 * (
        normalizer.normalize(probe, raw, top_k=3)
        + normalizer.normalize(reference, raw, top_k=3)
    )
    assert abs(normalizer.normalize_pair(probe, reference, raw, top_k=3) - expected) < 1e-9
    assert normalizer.scores([1.0, 2.0]).size == 0


def test_adaptive_linear_learns_region_specific_but_monotonic_probability() -> None:
    calibrator = fit_adaptive_linear(_regional_rows(), min_count=40, min_per_class=10, model_name="m")
    assert calibrator is not None
    region_a = [1.0, 0.0, 0.0, 0.0]
    region_b = [-1.0, 0.0, 0.0, 0.0]
    assert calibrator.probability(region_a, 0.42) > calibrator.probability(region_b, 0.42)
    assert calibrator.probability(region_a, 0.55) > calibrator.probability(region_a, 0.35)
    restored = AdaptiveLinearCalibrator.from_payload(calibrator.to_payload())
    assert restored.probability(region_a, 0.42) == calibrator.probability(region_a, 0.42)


def test_adaptive_payload_and_sparse_context_fail_closed() -> None:
    calibrator = fit_adaptive_linear(_regional_rows(), min_count=40, min_per_class=10)
    assert calibrator is not None
    payload = calibrator.to_payload()
    payload["weights"][-1] = -1.0
    try:
        AdaptiveLinearCalibrator.from_payload(payload)
        raise AssertionError("non-monotonic payload should fail")
    except ValueError:
        pass
    sparse = _regional_rows(identity_count=2)
    assert fit_adaptive_linear(sparse, min_count=40, min_per_class=10) is None
    for row in sparse:
        row.pop("pairCenter")
    report = validate_adaptive_calibration(sparse, min_count=8, min_per_class=2)
    assert report["promote"] is False
    assert "context" in report["reason"]


def test_held_out_adaptive_gate_improves_region_mismatch() -> None:
    # Paper-strength regularization must reject the same pattern while evidence is
    # sparse, even when a threshold could exploit a tiny regional coefficient.
    sparse = validate_adaptive_calibration(_regional_rows(), min_count=40, min_per_class=10, seed=7)
    assert sparse["promote"] is False
    assert sparse["adaptive"]["brier"] > sparse["baseline"]["brier"]

    report = validate_adaptive_calibration(_regional_rows(identity_count=1000), min_count=40, min_per_class=10, seed=7)
    assert report["promote"] is True, report
    assert report["brierGain"] > 0.001
    assert report["adaptive"]["brier"] < report["baseline"]["brier"]
    assert report["ranking"]["delta"] >= 0.0
    assert report["sliceRegressions"] == []
    assert report["baselineMatchScoreRows"] == len(_regional_rows(identity_count=1000))
    assert {row["key"] for row in report["sliceMetrics"]} == {"poseBucket", "ageGapBand", "mediaKind"}
    AdaptiveLinearCalibrator.from_payload(report["payload"])


def test_probability_metrics_are_finite_and_bounded() -> None:
    perfect = probability_calibration_metrics([0.99, 0.01], [1, 0])
    poor = probability_calibration_metrics([0.5, 0.5], [1, 0])
    assert perfect["brier"] < poor["brier"]
    assert 0.0 <= float(perfect["ece"]) <= 1.0
    assert np.isfinite(float(perfect["logLoss"]))


def test_project_probability_uses_adaptive_then_explicit_platt_fallback() -> None:
    from crossage_fr.enroll.manager import ProjectState
    from crossage_fr.models import ReviewCandidate

    rows: list[dict[str, object]] = []
    center_a = [1.0] + [0.0] * 511
    center_b = [-1.0] + [0.0] * 511
    for index in range(30):
        person = f"P{index}"
        rows.extend(
            [
                {"expectedPerson": person, "isMatch": True, "rawCosine": 0.42, "pairCenter": center_a},
                {"expectedPerson": person, "isMatch": False, "rawCosine": 0.22, "pairCenter": center_a},
                {"expectedPerson": person, "isMatch": True, "rawCosine": 0.62, "pairCenter": center_b},
                {"expectedPerson": person, "isMatch": False, "rawCosine": 0.42, "pairCenter": center_b},
            ]
        )
    adaptive = fit_adaptive_linear(rows, min_count=80, min_per_class=20, model_name="m")
    assert adaptive is not None
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        registry = str(root / "registry")
        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        project = ProjectState(root / "workspace")
        project.config.calibration_model = "m"
        project.config.calibration_adaptive = adaptive.to_payload()
        project.config.calibration_platt = [4.0, -1.0]
        adaptive_detail = project.match_probability_detail(
            0.5,
            "m",
            "Alice",
            pair_center=center_a,
            raw_cosine=0.42,
        )
        fallback_detail = project.match_probability_detail(0.5, "m", "Alice")
        stale_detail = project.match_probability_detail(0.5, "different-model", "Alice", pair_center=center_a, raw_cosine=0.42)
        assert adaptive_detail["source"] == "adaptive-linear"
        assert fallback_detail["source"] == "global-platt"
        assert stale_detail["probability"] is None

        candidate = ReviewCandidate(
            candidate_id="candidate-adaptive",
            source_path="/candidate.jpg",
            person_name="Alice",
            best_ref_id="reference-1",
            best_ref_path="/reference.jpg",
            score=0.5,
            band="confident",
            quality=0.8,
            model_name="m",
            raw_cosine=0.42,
        )
        project.candidates[candidate.candidate_id] = candidate
        project.db.upsert_candidate_match_context(
            candidate.candidate_id,
            "reference-1",
            "m",
            center_a,
            0.8,
            "test-cohort-v1",
        )
        assert project.refresh_review_candidate_priorities(statuses={"pending"}) == 1
        refreshed = project.candidates[candidate.candidate_id]
        assert refreshed.calibration_source == "adaptive-linear"
        assert refreshed.calibrated_probability == adaptive_detail["probability"]
        assert refreshed.calibration_version.startswith("adaptive-linear:")
        project.reassign_candidate_person(candidate.candidate_id, "Bob")
        reassigned = project.candidates[candidate.candidate_id]
        assert reassigned.calibrated_probability is None
        assert reassigned.calibration_source == "" and reassigned.calibration_version == ""
        assert project.db.candidate_match_context(candidate.candidate_id) is None


def test_invalid_adaptive_config_is_ignored_without_losing_valid_fallback() -> None:
    with tempfile.TemporaryDirectory() as raw:
        path = Path(raw) / "config.json"
        path.write_text(
            json.dumps(
                {
                    "calibration_platt": [2.0, -0.5],
                    "calibration_adaptive": {
                        "version": "adaptive-linear-v1",
                        "weights": [0.0] * 512 + [-1.0],
                        "bias": 0.0,
                        "dimension": 512,
                    },
                }
            ),
            encoding="utf-8",
        )
        config = load_config(path)
        assert config.calibration_platt == [2.0, -0.5]
        assert config.calibration_adaptive == {}


def test_project_calibration_artifact_promotes_real_512d_adaptive_payload() -> None:
    from crossage_fr.enroll.manager import ProjectState

    rows = _regional_rows(identity_count=1000, dimension=512)
    with tempfile.TemporaryDirectory() as raw:
        root = Path(raw)
        registry = str(root / "registry")
        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        project = ProjectState(root / "workspace")
        project.db.calibration_label_rows = lambda: rows  # type: ignore[method-assign]
        candidate = project._build_calibration_candidate()
        payload = candidate["payload"]
        assert candidate["promotable"] is True
        assert payload["adaptive"]["dimension"] == 512
        assert payload["adaptive"]["modelName"] == "m"
        assert payload["adaptiveFallback"]["active"] is False
        assert candidate["metrics"]["adaptiveValidation"]["promote"] is True
        assert candidate["metrics"]["adaptiveValidation"]["sliceRegressions"] == []
        project._apply_calibration_payload(payload)
        assert project.config.calibration_adaptive["dimension"] == 512
        detail = project.match_probability_detail(
            0.42,
            "m",
            "P0000",
            pair_center=rows[0]["pairCenter"],
            raw_cosine=0.42,
        )
        assert detail["source"] == "adaptive-linear"
        mismatched = json.loads(json.dumps(payload))
        mismatched["adaptive"]["modelName"] = "different-model"
        try:
            project._apply_calibration_payload(mismatched)
            raise AssertionError("cross-model adaptive artifact should be rejected")
        except ValueError as exc:
            assert "model" in str(exc).lower()


def main() -> None:
    test_normalized_pair_center_is_symmetric_and_guarded()
    test_symmetric_as_norm_uses_both_pair_sides()
    test_adaptive_linear_learns_region_specific_but_monotonic_probability()
    test_adaptive_payload_and_sparse_context_fail_closed()
    test_held_out_adaptive_gate_improves_region_mismatch()
    test_probability_metrics_are_finite_and_bounded()
    test_project_probability_uses_adaptive_then_explicit_platt_fallback()
    test_invalid_adaptive_config_is_ignored_without_losing_valid_fallback()
    test_project_calibration_artifact_promotes_real_512d_adaptive_payload()
    print("adaptive calibration units ok")


if __name__ == "__main__":
    main()

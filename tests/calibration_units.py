"""Unit tests for calibration-label stratification (Phase 1.2) and the
probabilistic calibrator + FMR-targeted thresholds (Phase 1.1).

Run: PYTHONPATH=. .venv/bin/python tests/calibration_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from crossage_fr.match.calibration import (
    PlattCalibrator,
    empirical_fmr,
    fit_platt,
    fit_score_calibrator,
    threshold_for_fmr,
)
from crossage_fr.store.workspace_db import WorkspaceDb


def test_calibration_labels_round_trip_with_stratification() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "workspace.sqlite3")
        db.add_calibration_label(
            "l1",
            {
                "sourcePath": "/a.jpg", "expectedPerson": "Alice", "actualPerson": "Alice",
                "matchScore": 0.42, "isMatch": True,
                "poseBucket": "frontal", "ageGapYears": 12.0, "rawCosine": 0.39,
            },
        )
        # A label with no raw cosine captured (pre-1.2 style) -> falls back to matchScore.
        db.add_calibration_label(
            "l2",
            {
                "sourcePath": "/b.jpg", "expectedPerson": "Bob", "actualPerson": "",
                "matchScore": 0.30, "isMatch": False,
            },
        )
        rows = db.calibration_label_rows()
        by_match = {row["isMatch"]: row for row in rows}
        assert len(rows) == 2
        assert by_match[True]["rawCosine"] == 0.39
        assert by_match[True]["poseBucket"] == "frontal"
        assert by_match[True]["ageGapYears"] == 12.0
        # raw cosine fallback for the un-stamped negative
        assert by_match[False]["rawCosine"] == 0.30
        assert by_match[False]["poseBucket"] == ""
        assert by_match[False]["ageGapYears"] is None


def test_platt_calibrator_monotonic_and_separating() -> None:
    scores = [0.10, 0.15, 0.20, 0.40, 0.45, 0.50]
    labels = [0, 0, 0, 1, 1, 1]
    cal = fit_platt(scores, labels)
    # high score -> match-likely, low score -> impostor-likely, and monotone increasing
    assert cal.probability(0.50) > 0.5 > cal.probability(0.10)
    assert cal.probability(0.50) > cal.probability(0.30) > cal.probability(0.10)
    # serialize round-trip
    assert PlattCalibrator.from_list(cal.to_list()).probability(0.4) == cal.probability(0.4)


def test_empirical_fmr_and_threshold_for_fmr() -> None:
    assert abs(empirical_fmr([0.1, 0.2, 0.3], 0.25) - (1 / 3)) < 1e-9
    scores = [0.1, 0.2, 0.3, 0.4, 0.5]
    labels = [0, 0, 0, 1, 1]
    # target FMR 0 -> threshold must exclude every negative (lowest passing score 0.4)
    assert threshold_for_fmr(scores, labels, 0.0) == 0.4
    # allowing ~1/3 FMR lets the threshold drop to 0.3
    assert threshold_for_fmr(scores, labels, 0.34) == 0.3


def test_fit_score_calibrator_guards_insufficient_data() -> None:
    one_class = [{"score": 0.4, "isMatch": True} for _ in range(10)]
    assert fit_score_calibrator(one_class, min_count=8, min_per_class=2) is None
    too_few = [{"score": 0.4, "isMatch": True}, {"score": 0.1, "isMatch": False}]
    assert fit_score_calibrator(too_few, min_count=8, min_per_class=2) is None
    ok = [{"score": 0.4, "isMatch": True} for _ in range(5)] + [
        {"score": 0.1, "isMatch": False} for _ in range(5)
    ]
    cal = fit_score_calibrator(ok, min_count=8, min_per_class=2)
    assert cal is not None and cal.probability(0.4) > cal.probability(0.1)


def test_apply_calibration_replaces_midpoint_with_fmr_thresholds() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        project = ProjectState(Path(tmp) / "workspace")
        # Insufficient labels -> refuses (no half-calibrated operating point).
        try:
            project.apply_calibration_to_config()
            raise AssertionError("expected ValueError on insufficient labels")
        except ValueError:
            pass
        # 12 positives (higher scores) + 12 negatives (lower, slightly overlapping).
        for i in range(12):
            project.db.add_calibration_label(
                f"p{i}",
                {"sourcePath": f"/p{i}.jpg", "expectedPerson": "A", "actualPerson": "A",
                 "matchScore": 0.30 + 0.02 * i, "isMatch": True, "rawCosine": 0.28 + 0.02 * i},
            )
        for i in range(12):
            project.db.add_calibration_label(
                f"n{i}",
                {"sourcePath": f"/n{i}.jpg", "expectedPerson": "B", "actualPerson": "",
                 "matchScore": 0.10 + 0.02 * i, "isMatch": False, "rawCosine": 0.09 + 0.02 * i},
            )
        result = project.apply_calibration_to_config()
        t = project.config.thresholds
        # Bands are descending and now an actual FMR operating point, not a midpoint.
        assert t.confident >= t.likely >= t.relaxed_child
        # A probabilistic calibrator was persisted...
        assert len(project.config.calibration_platt) == 2
        # ...and maps higher fused scores to higher P(same identity).
        assert project.match_probability(0.50) > project.match_probability(0.12)
        assert result["config"]["calibrationPlatt" if "calibrationPlatt" in result["config"] else "calibration_platt"]


def test_accuracy_det_report_from_labels() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        project = ProjectState(Path(tmp) / "workspace")
        for i in range(10):
            project.db.add_calibration_label(
                f"p{i}", {"sourcePath": f"/p{i}", "expectedPerson": "A", "actualPerson": "A",
                         "matchScore": 0.45, "isMatch": True, "rawCosine": 0.42}
            )
            project.db.add_calibration_label(
                f"n{i}", {"sourcePath": f"/n{i}", "expectedPerson": "B", "actualPerson": "",
                         "matchScore": 0.18, "isMatch": False, "rawCosine": 0.15}
            )
        report = project.accuracy_det_report()
        assert report["genuine"] == 10 and report["impostor"] == 10
        assert "tarAtFar" in report and "eer" in report and report["disclaimer"]


def test_accuracy_det_report_by_age_gap_buckets() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        project = ProjectState(Path(tmp) / "workspace")
        # Near-age-gap matches and a wide-gap (child<->adult) cohort, separately labeled.
        for i in range(6):
            project.db.add_calibration_label(
                f"near{i}", {"sourcePath": f"/near{i}", "expectedPerson": "A", "actualPerson": "A",
                            "matchScore": 0.45, "isMatch": True, "rawCosine": 0.44, "ageGapYears": 1.0}
            )
            project.db.add_calibration_label(
                f"wide{i}", {"sourcePath": f"/wide{i}", "expectedPerson": "A", "actualPerson": "A",
                            "matchScore": 0.25, "isMatch": True, "rawCosine": 0.24, "ageGapYears": 15.0}
            )
        report = project.accuracy_det_report_by_age_gap()
        # Bands are the NIST confidence bands: 1yr -> "high", 15yr -> "very-low".
        assert "high" in report["byBand"] and "very-low" in report["byBand"]
        assert report["byBand"]["high"]["genuine"] == 6
        assert "proxy" in report["note"].lower()


def test_calibration_is_model_pack_versioned() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        project = ProjectState(Path(tmp) / "workspace")
        # Dominant model "modelA" (20 labels) + a few stray "modelB" labels.
        for i in range(10):
            project.db.add_calibration_label(
                f"a_p{i}", {"sourcePath": f"/ap{i}", "expectedPerson": "A", "actualPerson": "A",
                           "matchScore": 0.45, "isMatch": True, "rawCosine": 0.44, "modelName": "modelA"}
            )
            project.db.add_calibration_label(
                f"a_n{i}", {"sourcePath": f"/an{i}", "expectedPerson": "B", "actualPerson": "",
                           "matchScore": 0.18, "isMatch": False, "rawCosine": 0.15, "modelName": "modelA"}
            )
        for i in range(3):
            project.db.add_calibration_label(
                f"b{i}", {"sourcePath": f"/b{i}", "expectedPerson": "C", "actualPerson": "C",
                          "matchScore": 0.9, "isMatch": True, "rawCosine": 0.9, "modelName": "modelB"}
            )
        project.apply_calibration_to_config()
        # The calibrator is tagged with the dominant model and ignored stray-model rows.
        assert project.config.calibration_model == "modelA"
        # Probability is returned for the matching model...
        assert project.match_probability(0.45, model_name="modelA") is not None
        # ...but a different recognizer makes the calibrator STALE -> no probability.
        assert project.match_probability(0.45, model_name="modelB") is None
        # No model arg -> backward-compatible (uses the calibrator).
        assert project.match_probability(0.45) is not None


def main() -> None:
    test_calibration_labels_round_trip_with_stratification()
    test_accuracy_det_report_from_labels()
    test_accuracy_det_report_by_age_gap_buckets()
    test_calibration_is_model_pack_versioned()
    test_platt_calibrator_monotonic_and_separating()
    test_empirical_fmr_and_threshold_for_fmr()
    test_fit_score_calibrator_guards_insufficient_data()
    test_apply_calibration_replaces_midpoint_with_fmr_thresholds()
    print("calibration units ok")


if __name__ == "__main__":
    main()

"""Unit tests for the verification/open-set eval harness (Phase 2.3).

Run: PYTHONPATH=. .venv/bin/python tests/det_eval_units.py
"""

from __future__ import annotations

from crossage_fr.benchmarks.det_eval import (
    accuracy_at_threshold,
    det_report,
    det_report_by_cohort,
    eer,
    fnir_at_fpir,
    tar_at_far,
)


def test_tar_at_far_separable() -> None:
    genuine = [0.40, 0.50, 0.60]
    impostor = [0.10, 0.20, 0.30]
    # At FAR=0 the threshold excludes every impostor; all genuine still pass -> TAR 1.0.
    out = tar_at_far(genuine, impostor, [0.0])
    assert abs(out[0.0] - 1.0) < 1e-9


def test_tar_at_far_with_overlap_is_monotonic() -> None:
    genuine = [0.20, 0.30, 0.40, 0.50]
    impostor = [0.15, 0.25, 0.35, 0.45]
    out = tar_at_far(genuine, impostor, [0.0, 0.25, 0.5])
    # Allowing more false matches can only keep or raise TAR.
    assert out[0.0] <= out[0.25] <= out[0.5]


def test_eer_symmetric_distributions() -> None:
    genuine = [0.6, 0.7, 0.8, 0.9]
    impostor = [0.1, 0.2, 0.3, 0.4]
    value, threshold = eer(genuine, impostor)
    assert 0.0 <= value <= 0.5
    assert 0.4 <= threshold <= 0.6  # crossover sits between the clusters


def test_accuracy_at_threshold() -> None:
    genuine = [0.6, 0.7]
    impostor = [0.1, 0.2]
    assert accuracy_at_threshold(genuine, impostor, 0.5) == 1.0  # perfect split
    assert accuracy_at_threshold(genuine, impostor, 0.0) == 0.5  # all called match


def test_det_report_reports_floor_and_ci_and_disclaimer() -> None:
    rows = [{"rawCosine": 0.5, "isMatch": True} for _ in range(20)]
    rows += [{"rawCosine": 0.15, "isMatch": False} for _ in range(20)]
    report = det_report(rows, far_targets=[1e-1, 1e-2, 1e-3], bootstrap=50, seed=7)
    assert report["genuine"] == 20 and report["impostor"] == 20
    # FAR floor = 1/impostor = 0.05; targets below it are flagged, not faked.
    assert abs(report["farFloor"] - 0.05) < 1e-9
    assert report["tarAtFar"]["0.1"]["resolvable"] is True
    assert report["tarAtFar"]["0.001"]["resolvable"] is False
    # EER + accuracy@EER carry a bootstrap CI [lo, hi].
    assert 0.0 <= report["eer"]["value"] <= 1.0
    assert len(report["accuracyAtEer"]["ci"]) == 2
    assert "closed-set" in report["disclaimer"].lower() or "tar@far" in report["disclaimer"].lower()


def test_fnir_at_fpir_open_set() -> None:
    # Mate probes match high+correct; non-mate probes score low.
    probes = [{"top1Score": 0.6, "isMate": True, "isCorrect": True} for _ in range(10)]
    probes += [{"top1Score": 0.1, "isMate": False, "isCorrect": False} for _ in range(10)]
    out = fnir_at_fpir(probes, [0.0, 0.1])
    # At FPIR=0 (no non-mate may surface) all true mates still identify -> FNIR 0.
    assert out["0.0"]["fnir"] == 0.0


def test_det_report_by_cohort_exposes_fairness_gap() -> None:
    rows = []
    for _ in range(12):
        rows += [{"rawCosine": 0.6, "isMatch": True, "cohort": "easy"},
                 {"rawCosine": 0.1, "isMatch": False, "cohort": "easy"}]
        # "hard" cohort: genuine/impostor scores fully overlap -> chance accuracy.
        rows += [{"rawCosine": 0.30, "isMatch": True, "cohort": "hard"},
                 {"rawCosine": 0.30, "isMatch": False, "cohort": "hard"}]
    report = det_report_by_cohort(rows, "cohort", min_per_cohort=8)
    assert set(report["byCohort"].keys()) == {"easy", "hard"}
    # The easy cohort is at least as accurate as the hard one...
    assert report["byCohort"]["easy"]["accuracyAtEer"]["value"] >= report["byCohort"]["hard"]["accuracyAtEer"]["value"]
    # ...and the disparity is surfaced as a first-class fairness gap, naming the worst.
    assert report["fairnessGap"]["accuracyGap"] > 0.0
    assert report["fairnessGap"]["worstCohort"] == "hard"
    # Honest note that the app only slices by pose/age, not protected attributes.
    assert "protected" in report["note"].lower() or "demographic" in report["note"].lower()


def main() -> None:
    test_det_report_by_cohort_exposes_fairness_gap()
    test_tar_at_far_separable()
    test_tar_at_far_with_overlap_is_monotonic()
    test_eer_symmetric_distributions()
    test_accuracy_at_threshold()
    test_det_report_reports_floor_and_ci_and_disclaimer()
    test_fnir_at_fpir_open_set()
    print("det eval units ok")


if __name__ == "__main__":
    main()

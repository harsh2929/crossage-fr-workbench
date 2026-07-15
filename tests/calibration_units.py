"""Unit tests for calibration-label stratification (Phase 1.2) and the
probabilistic calibrator + FMR-targeted thresholds (Phase 1.1).

Run: PYTHONPATH=. .venv/bin/python tests/calibration_units.py
"""

from __future__ import annotations

import tempfile
import os
import sqlite3
from pathlib import Path

from crossage_fr.match.calibration import (
    CohortNormalizer,
    PlattCalibrator,
    as_norm_score,
    fit_per_identity_calibrators,
    fit_platt,
    fit_score_calibrator,
    fuse_scores,
    empirical_fmr,
    threshold_for_fmr,
)
from crossage_fr.store.workspace_db import WorkspaceDb


def _use_temp_registry(base: Path) -> None:
    registry = str(base / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry


def test_fit_per_identity_calibrators_skips_sparse_identities() -> None:
    rows: list[dict] = []
    for person in ("A", "B"):
        for _ in range(5):
            rows.append({"expectedPerson": person, "matchScore": 0.50, "isMatch": True})
            rows.append({"expectedPerson": person, "matchScore": 0.10, "isMatch": False})
    rows.append({"expectedPerson": "C", "matchScore": 0.5, "isMatch": True})  # too few -> skipped
    cals = fit_per_identity_calibrators(rows, min_per_identity=8, min_per_class=3, score_key="matchScore")
    assert set(cals.keys()) == {"A", "B"}
    assert cals["A"].probability(0.50) > cals["A"].probability(0.10)


def test_fuse_scores_weighted_average() -> None:
    assert abs(fuse_scores([0.4, 0.6]) - 0.5) < 1e-9
    assert abs(fuse_scores([0.4, 0.6], [0.75, 0.25]) - (0.4 * 0.75 + 0.6 * 0.25)) < 1e-9
    assert fuse_scores([0.5]) == 0.5
    assert fuse_scores([]) == 0.0


def test_as_norm_discounts_a_generic_probe() -> None:
    # Same raw cosine, but probe A stands out from its impostor cohort while probe B
    # matches everything similarly (a generic/low-information face). AS-norm must give A
    # a much higher normalized score than B.
    z_standout = as_norm_score(0.45, [0.10] * 20, top_k=10)
    z_generic = as_norm_score(0.45, [0.43] * 20, top_k=10)
    assert z_standout > z_generic
    # Empty cohort -> neutral fallback (no crash, no spurious boost).
    assert as_norm_score(0.45, [], top_k=10) == 0.0


def test_cohort_normalizer_uses_probe_vs_cohort_separation() -> None:
    import numpy as np

    cohort = [[0.0, 1.0] + [0.0] * 510, [0.0, 0.0, 1.0] + [0.0] * 509]  # orthogonal to probe
    norm = CohortNormalizer(cohort)
    probe = [1.0] + [0.0] * 511  # stands out from the cohort
    z = norm.normalize(probe, raw_cosine=0.45)
    assert z > 0.0  # a probe well-separated from the cohort scores positively


def test_calibration_labels_round_trip_with_stratification() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "workspace.sqlite3")
        db.add_calibration_label(
            "l1",
            {
                "sourcePath": "/a.jpg", "expectedPerson": "Alice", "actualPerson": "Alice",
                "matchScore": 0.42, "isMatch": True,
                "poseBucket": "frontal", "mediaKind": "video", "ageGapYears": 12.0, "rawCosine": 0.39,
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
        assert by_match[True]["mediaKind"] == "video"
        assert by_match[True]["ageGapYears"] == 12.0
        # raw cosine fallback for the un-stamped negative
        assert by_match[False]["rawCosine"] == 0.30
        assert by_match[False]["poseBucket"] == ""
        assert by_match[False]["mediaKind"] == ""
        assert by_match[False]["ageGapYears"] is None


def test_adaptive_pair_context_round_trip_validation_and_cleanup() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "workspace.sqlite3")
        center = [1.0] + [0.0] * 511
        db.upsert_candidate_match_context(
            "candidate-1",
            "reference-1",
            "antelopev2",
            center,
            1.25,
            "fixed-cohort-v1",
        )
        stored = db.candidate_match_context(
            "candidate-1",
            best_ref_id="reference-1",
            model_name="antelopev2",
        )
        assert stored is not None
        assert stored["pairCenter"] == center
        assert stored["cohortZ"] == 1.25
        assert stored["cohortVersion"] == "fixed-cohort-v1"
        # Reassigned candidates and model-pack switches must not reuse stale context.
        assert db.candidate_match_context("candidate-1", best_ref_id="reference-2") is None
        assert db.candidate_match_context("candidate-1", model_name="buffalo_l") is None

        db.add_calibration_label(
            "adaptive-label",
            {
                "sourcePath": "/adaptive.jpg",
                "expectedPerson": "Alice",
                "actualPerson": "Alice",
                "matchScore": 0.7,
                "rawCosine": 0.51,
                "isMatch": True,
                "modelName": "antelopev2",
                "bestRefId": "reference-1",
                "pairCenter": center,
                "cohortZ": 1.25,
                "contextVersion": "adaptive-pair-v1|fixed-cohort-v1",
            },
        )
        label = db.calibration_label_rows()[0]
        assert label["pairCenter"] == center
        assert label["bestRefId"] == "reference-1"
        assert label["cohortZ"] == 1.25
        assert label["contextVersion"] == "adaptive-pair-v1|fixed-cohort-v1"

        for invalid in ([1.0] * 511, [1.0] * 513, [float("nan")] + [0.0] * 511, [0.0] * 512):
            try:
                db.upsert_candidate_match_context(
                    "invalid",
                    "reference-1",
                    "antelopev2",
                    invalid,
                    0.0,
                    "fixed-cohort-v1",
                )
                raise AssertionError("invalid adaptive context should be rejected")
            except ValueError:
                pass

        with db.connect() as conn:
            conn.execute(
                "UPDATE candidate_match_context SET pair_center = ? WHERE candidate_id = ?",
                (b"truncated", "candidate-1"),
            )
        assert db.candidate_match_context("candidate-1") is None
        assert db.clear_candidates() == 0
        with db.connect() as conn:
            remaining = conn.execute("SELECT COUNT(*) AS n FROM candidate_match_context").fetchone()["n"]
        assert remaining == 0


def test_candidate_replacement_and_correction_undo_preserve_only_valid_pair_context() -> None:
    from crossage_fr.models import ReviewCandidate

    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "workspace.sqlite3")
        center = [1.0] + [0.0] * 511
        candidate = ReviewCandidate(
            candidate_id="candidate-context",
            source_path="/candidate.jpg",
            person_name="Alice",
            best_ref_id="reference-1",
            best_ref_path="/reference.jpg",
            score=0.7,
            band="confident",
            quality=0.8,
            model_name="antelopev2",
            calibrated_probability=0.91,
            calibration_source="adaptive-linear",
            calibration_version="adaptive-linear:test",
        )
        db.upsert_candidates([candidate])
        db.upsert_candidate_match_context(
            candidate.candidate_id,
            "reference-1",
            "antelopev2",
            center,
            0.75,
            "antelopev2:test",
        )
        db.replace_candidates([candidate])
        assert db.candidate_match_context(candidate.candidate_id) is not None

        with db.connect() as conn:
            snapshot = db.review_candidate_correction_undo_snapshot(candidate=candidate, conn=conn)
            operation = db.record_review_candidate_correction_operation(
                operation_type="person_match_reassign",
                label="Moved match",
                candidate_id=candidate.candidate_id,
                snapshot=snapshot,
                conn=conn,
            )
            db.delete_candidate_match_context(candidate.candidate_id, conn=conn)
        assert db.candidate_match_context(candidate.candidate_id) is None
        undone = db.undo_photo_operation(operation["operationId"])
        assert undone["undone"] is True
        restored = db.candidate_match_context(candidate.candidate_id)
        assert restored is not None and restored["bestRefId"] == "reference-1"
        assert restored["pairCenter"] == center

        changed = ReviewCandidate(
            candidate_id=candidate.candidate_id,
            source_path=candidate.source_path,
            person_name="Bob",
            best_ref_id="reference-2",
            best_ref_path="/reference-2.jpg",
            score=0.6,
            band="likely",
            quality=0.8,
            model_name="antelopev2",
        )
        db.replace_candidates([changed])
        assert db.candidate_match_context(candidate.candidate_id) is None


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
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")
        project.set_consent(True, source="unit-test", operator="Calibration")
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
        _use_temp_registry(Path(tmp))
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
        _use_temp_registry(Path(tmp))
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


def test_apply_personalized_calibration_per_identity() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")
        project.set_consent(True, source="unit-test", operator="Calibration")
        # Two people with plenty of labels each (separable per person) + a sparse third.
        for person in ("Alice", "Bob"):
            for i in range(8):
                project.db.add_calibration_label(
                    f"{person}_p{i}", {"sourcePath": f"/{person}p{i}", "expectedPerson": person, "actualPerson": person,
                                       "matchScore": 0.50, "isMatch": True, "rawCosine": 0.50, "modelName": "m"})
                project.db.add_calibration_label(
                    f"{person}_n{i}", {"sourcePath": f"/{person}n{i}", "expectedPerson": person, "actualPerson": "",
                                       "matchScore": 0.15, "isMatch": False, "rawCosine": 0.15, "modelName": "m"})
        project.db.add_calibration_label(
            "Carol_p", {"sourcePath": "/c", "expectedPerson": "Carol", "actualPerson": "Carol",
                        "matchScore": 0.5, "isMatch": True, "rawCosine": 0.5, "modelName": "m"})
        result = project.apply_personalized_calibration()
        # Alice + Bob get personalized; sparse Carol does not.
        assert set(result["identities"]) == {"Alice", "Bob"}
        assert len(project.config.calibration_platt_by_person["Alice"]) == 2
        # A person's own calibrator drives match_probability and is monotonic.
        assert project.match_probability(0.50, person_name="Alice") > project.match_probability(0.15, person_name="Alice")
        # An un-personalized person falls back to the global calibrator (or None).
        assert "Carol" not in project.config.calibration_platt_by_person


def test_calibration_is_model_pack_versioned() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")
        project.set_consent(True, source="unit-test", operator="Calibration")
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


def test_calibration_keeps_untagged_legacy_labels_with_dominant_model() -> None:
    from crossage_fr.enroll.manager import ProjectState

    with tempfile.TemporaryDirectory() as tmp:
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")
        project.set_consent(True, source="unit-test", operator="Calibration")
        # A new model-tagged review should not make older/imported untagged labels
        # invisible to calibration. Untagged rows are kept with the dominant local
        # model unless a conflicting non-empty model tag is present.
        project.db.add_calibration_label(
            "tagged",
            {"sourcePath": "/tagged", "expectedPerson": "A", "actualPerson": "A",
             "matchScore": 0.70, "isMatch": True, "rawCosine": 0.70, "modelName": "modelA"},
        )
        for i in range(10):
            project.db.add_calibration_label(
                f"legacy_p{i}", {"sourcePath": f"/lp{i}", "expectedPerson": "A", "actualPerson": "A",
                                 "matchScore": 0.55 + 0.01 * i, "isMatch": True, "rawCosine": 0.55 + 0.01 * i}
            )
            project.db.add_calibration_label(
                f"legacy_n{i}", {"sourcePath": f"/ln{i}", "expectedPerson": "B", "actualPerson": "",
                                 "matchScore": 0.12 + 0.01 * i, "isMatch": False, "rawCosine": 0.12 + 0.01 * i}
            )
        result = project.apply_calibration_to_config()
        assert result["promoted"] is True
        assert project.config.calibration_model == "modelA"
        assert len(project.config.calibration_platt) == 2


def test_ordered_review_candidates_surfaces_matches_abstains_noise() -> None:
    from crossage_fr.enroll.manager import ProjectState
    from crossage_fr.models import ReviewCandidate, new_id

    with tempfile.TemporaryDirectory() as tmp:
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")

        def cand(name, score, band, *, align=0.0, ied=80.0, quality=0.6):
            cid = new_id("cand")
            return ReviewCandidate(
                candidate_id=cid, source_path=f"/{name}.jpg", person_name=name, best_ref_id="r",
                best_ref_path="/r.jpg", score=score, band=band, quality=quality, model_name="m",
                status="pending", align_error=align, ied_px=ied,
            )

        strong = cand("strong", 0.50, "confident")
        weakish = cand("weakish", 0.30, "likely")
        crossage = cand("crossage", 0.22, "child-bucket maybe")
        noise = cand("noise", 0.50, "confident", align=0.30, ied=14.0)  # badly aligned + tiny
        for c in (crossage, noise, weakish, strong):  # inserted out of order
            project.candidates[c.candidate_id] = c

        ordered = project.ordered_review_candidates()
        names = [c.person_name for c in ordered]
        # Strong confident matches first; the badly-aligned sub-resolution face is
        # abstained to the very bottom (information-limited), below even the cross-age maybe.
        assert names[0] == "strong"
        assert names.index("strong") < names.index("weakish") < names.index("crossage")
        assert names[-1] == "noise"


def test_review_queue_reorders_with_personalized_calibration() -> None:
    from crossage_fr.enroll.manager import ProjectState
    from crossage_fr.models import ReviewCandidate

    with tempfile.TemporaryDirectory() as tmp:
        _use_temp_registry(Path(tmp))
        project = ProjectState(Path(tmp) / "workspace")

        def cand(candidate_id: str, person_name: str) -> ReviewCandidate:
            return ReviewCandidate(
                candidate_id=candidate_id,
                source_path=f"/{candidate_id}.jpg",
                person_name=person_name,
                best_ref_id="r",
                best_ref_path="/r.jpg",
                score=0.50,
                band="confident",
                quality=0.7,
                model_name="m",
                status="pending",
                review_priority=0.01,
                review_lane="surface",
                created_at="2026-07-07T00:00:00Z",
            )

        alice = cand("cand_alice", "Alice")
        bob = cand("cand_bob", "Bob")
        project.candidates[alice.candidate_id] = alice
        project.candidates[bob.candidate_id] = bob
        calls: list[str | None] = []

        def personalized_probability(score: float, model_name: str | None = None, person_name: str | None = None) -> float:
            calls.append(person_name)
            return 0.95 if person_name == "Bob" else 0.15

        project.match_probability = personalized_probability  # type: ignore[method-assign]

        ordered = project.ordered_review_candidates()
        assert [candidate.person_name for candidate in ordered] == ["Bob", "Alice"]
        assert calls == ["Alice", "Bob"], calls

        refreshed = project.refresh_review_candidate_priorities(statuses={"pending"})
        assert refreshed == 2
        assert project.candidates["cand_bob"].review_priority > project.candidates["cand_alice"].review_priority
        persisted = project.db.query_candidates(status="pending", sort="score", limit=2)
        assert [row["candidate_id"] for row in persisted["items"]] == ["cand_bob", "cand_alice"]


def test_persisted_review_queue_orders_by_review_priority() -> None:
    from crossage_fr.models import ReviewCandidate

    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "workspace.sqlite3")
        high_priority = ReviewCandidate(
            candidate_id="cand_priority",
            source_path="/priority.jpg",
            person_name="Priority",
            best_ref_id="ref_p",
            best_ref_path="/ref-p.jpg",
            score=0.31,
            band="likely",
            quality=0.5,
            model_name="m",
            review_priority=0.95,
            review_lane="surface",
            created_at="2026-07-07T00:00:00Z",
        )
        high_score = ReviewCandidate(
            candidate_id="cand_score",
            source_path="/score.jpg",
            person_name="Score",
            best_ref_id="ref_s",
            best_ref_path="/ref-s.jpg",
            score=0.99,
            band="confident",
            quality=0.9,
            model_name="m",
            review_priority=0.10,
            review_lane="review",
            created_at="2026-07-07T00:01:00Z",
        )
        assert db.upsert_candidates([high_score, high_priority]) == 2

        page = db.query_candidates(status="pending", sort="score", limit=10)
        assert [item["candidate_id"] for item in page["items"]] == ["cand_priority", "cand_score"]
        assert page["items"][0]["review_priority"] == 0.95
        assert page["items"][0]["review_lane"] == "surface"


def test_workspace_db_migrates_legacy_review_candidates_before_priority_indexes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "workspace.sqlite3"
        with sqlite3.connect(db_path) as conn:
            conn.executescript(
                """
                CREATE TABLE review_candidates (
                    candidate_id TEXT PRIMARY KEY,
                    source_path TEXT NOT NULL,
                    person_name TEXT NOT NULL,
                    person_key TEXT NOT NULL,
                    score REAL NOT NULL DEFAULT 0,
                    quality REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'pending',
                    created_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX idx_review_candidates_status_score
                    ON review_candidates(status, score DESC, quality DESC, created_at DESC, candidate_id);
                """
            )
            conn.execute(
                """
                INSERT INTO review_candidates(
                    candidate_id, source_path, person_name, person_key, score, quality, status, created_at, payload_json
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "legacy-candidate",
                    "/legacy.jpg",
                    "Legacy",
                    "legacy",
                    0.82,
                    0.7,
                    "pending",
                    "2026-07-07T00:00:00Z",
                    '{"candidate_id":"legacy-candidate","source_path":"/legacy.jpg"}',
                ),
            )

        db = WorkspaceDb(db_path)
        with db.connect() as conn:
            columns = {row["name"] for row in conn.execute("PRAGMA table_info(review_candidates)").fetchall()}
            index_row = conn.execute(
                """
                SELECT sql FROM sqlite_master
                WHERE type = 'index' AND name = 'idx_review_candidates_review_priority'
                """
            ).fetchone()
        for column in {"media_kind", "media_source_path", "media_path", "source_hash", "review_priority", "review_lane"}:
            assert column in columns, columns
        assert index_row and "review_priority" in str(index_row["sql"]), index_row
        page = db.query_candidates(status="pending", sort="score", limit=5)
        assert [item["candidate_id"] for item in page["items"]] == ["legacy-candidate"], page


def main() -> None:
    test_calibration_labels_round_trip_with_stratification()
    test_adaptive_pair_context_round_trip_validation_and_cleanup()
    test_candidate_replacement_and_correction_undo_preserve_only_valid_pair_context()
    test_accuracy_det_report_from_labels()
    test_accuracy_det_report_by_age_gap_buckets()
    test_apply_personalized_calibration_per_identity()
    test_calibration_is_model_pack_versioned()
    test_calibration_keeps_untagged_legacy_labels_with_dominant_model()
    test_ordered_review_candidates_surfaces_matches_abstains_noise()
    test_review_queue_reorders_with_personalized_calibration()
    test_persisted_review_queue_orders_by_review_priority()
    test_workspace_db_migrates_legacy_review_candidates_before_priority_indexes()
    test_platt_calibrator_monotonic_and_separating()
    test_empirical_fmr_and_threshold_for_fmr()
    test_fit_score_calibrator_guards_insufficient_data()
    test_apply_calibration_replaces_midpoint_with_fmr_thresholds()
    test_as_norm_discounts_a_generic_probe()
    test_cohort_normalizer_uses_probe_vs_cohort_separation()
    test_fit_per_identity_calibrators_skips_sparse_identities()
    test_fuse_scores_weighted_average()
    print("calibration units ok")


if __name__ == "__main__":
    main()

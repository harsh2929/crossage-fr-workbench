from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from crossage_fr.enroll.manager import ProjectState
from crossage_fr.models import ReviewCandidate


def _candidate(index: int, score: float, status: str, media_kind: str = "image") -> ReviewCandidate:
    return ReviewCandidate(
        candidate_id=f"cand_{index}",
        source_path=f"/synthetic/no-photo-used/source-{index}.jpg",
        person_name="Synthetic Person",
        best_ref_id="ref_synthetic",
        best_ref_path="/synthetic/no-photo-used/ref.jpg",
        score=score,
        band="synthetic",
        quality=0.8,
        model_name="synthetic-benchmark",
        status=status,
        media_kind=media_kind,
        source_hash=f"hash-{index}",
    )


def _seed_calibration_labels(project: ProjectState) -> None:
    positive_scores = [0.92, 0.81, 0.72, 0.68, 0.65, 0.62, 0.60, 0.58, 0.56, 0.55, 0.54, 0.53]
    negative_scores = [0.52, 0.49, 0.47, 0.43, 0.39, 0.37, 0.33, 0.22, 0.18, 0.14, 0.12, 0.08]
    for index in range(12):
        project.db.add_calibration_label(
            f"bench_pos_{index}",
            {
                "sourcePath": f"/synthetic/no-photo-used/calibration-pos-{index}.jpg",
                "expectedPerson": "Synthetic Person",
                "actualPerson": "Synthetic Person",
                "matchScore": positive_scores[index],
                "isMatch": True,
                "rawCosine": max(0.0, positive_scores[index] - 0.02),
                "modelName": "synthetic-benchmark",
            },
        )
        project.db.add_calibration_label(
            f"bench_neg_{index}",
            {
                "sourcePath": f"/synthetic/no-photo-used/calibration-neg-{index}.jpg",
                "expectedPerson": "Synthetic Person",
                "actualPerson": "",
                "matchScore": negative_scores[index],
                "isMatch": False,
                "rawCosine": max(0.0, negative_scores[index] - 0.02),
                "modelName": "synthetic-benchmark",
            },
        )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-accuracy-bench-") as temp:
        registry = str(Path(temp) / "registry")
        os.environ["VINTRACE_REGISTRY_HOME"] = registry
        os.environ["CROSSAGE_REGISTRY_HOME"] = registry
        project = ProjectState(Path(temp), actor="accuracy-benchmark")
        rows = [
            _candidate(1, 0.92, "accepted"),
            _candidate(2, 0.81, "accepted"),
            _candidate(3, 0.62, "accepted", "video"),
            _candidate(4, 0.31, "accepted"),
            _candidate(5, 0.22, "accepted"),
            _candidate(6, 0.12, "rejected"),
            _candidate(7, 0.18, "rejected"),
            _candidate(8, 0.33, "rejected"),
            _candidate(9, 0.51, "rejected", "video"),
            _candidate(10, 0.05, "rejected"),
        ]
        project.candidates = {row.candidate_id: row for row in rows}
        project.save()
        result = project.accuracy_evaluation()
        likely = result["metrics"]["likely"]
        assert likely["labeled"] == 10, likely
        assert likely["truePositives"] == 4, likely
        assert likely["falsePositives"] == 2, likely
        assert likely["falseNegatives"] == 1, likely
        labels = project.export_accuracy_labels()
        assert labels["counts"]["labels"] == 10, labels
        before_thresholds = {
            "confident": project.config.thresholds.confident,
            "likely": project.config.thresholds.likely,
            "relaxedChild": project.config.thresholds.relaxed_child,
        }
        project.set_consent(True, source="benchmark", operator="accuracy-benchmark")
        _seed_calibration_labels(project)
        staged = project.stage_calibration_update()
        assert staged["status"] == "staged", staged
        promoted = project.promote_calibration_artifact(staged["artifact"]["artifactId"])
        assert promoted["promoted"] is True, promoted
        after = project.accuracy_evaluation()["metrics"]["likely"]
        assert project.config.thresholds.likely > before_thresholds["likely"], {
            "before": before_thresholds,
            "after": project.config.thresholds.likely,
        }
        assert after["falsePositives"] < likely["falsePositives"], {"before": likely, "after": after}
        assert after["precision"] >= likely["precision"], {"before": likely, "after": after}
        rolled_back = project.rollback_calibration_artifact(staged["artifact"]["artifactId"])
        assert rolled_back["rolledBack"] is True, rolled_back
        assert project.config.thresholds.likely == before_thresholds["likely"]
        print(
            json.dumps(
                {
                    "likelyBefore": likely,
                    "likelyAfterLearnedCalibration": after,
                    "stagedArtifact": {
                        "artifactId": staged["artifact"]["artifactId"],
                        "status": staged["status"],
                        "labels": staged["payload"]["labels"],
                    },
                    "recommendations": result["recommendations"],
                    "labels": labels["counts"],
                },
                indent=2,
            )
        )


if __name__ == "__main__":
    main()

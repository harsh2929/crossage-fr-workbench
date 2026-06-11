from __future__ import annotations

import json
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


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-accuracy-bench-") as temp:
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
        print(json.dumps({"likely": likely, "recommendations": result["recommendations"], "labels": labels["counts"]}, indent=2))


if __name__ == "__main__":
    main()

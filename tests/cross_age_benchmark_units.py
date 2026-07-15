from __future__ import annotations

import json
import tempfile
from pathlib import Path
from types import SimpleNamespace

from PIL import Image

from crossage_fr.benchmarks.public_dataset import (
    CROSS_AGE_TRAJECTORY_PROTOCOL_VERSION,
    PublicDatasetBenchmarkMixin,
)
from crossage_fr.dataset_benchmarks import (
    FGNET_PREPARATION_VERSION,
    parse_fgnet_filename,
    inspect_identity_dataset,
    prepare_fgnet_dataset,
    public_dataset_catalog,
)


def image(path: Path, color: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (16, 16), color).save(path)


def test_fgnet_local_preparer() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "authorized-fgnet"
        image(source / "001A02.JPG", (10, 20, 30))
        image(source / "001A15b.JPG", (20, 30, 40))
        image(source / "002A40.JPG", (30, 40, 50))
        (source / "README.txt").write_text("not media", encoding="utf-8")
        before = sorted(str(path.relative_to(source)) for path in source.rglob("*"))
        try:
            prepare_fgnet_dataset(source, root / "prepared", terms_acknowledged=False)
            raise AssertionError("terms gate did not fire")
        except PermissionError:
            pass
        result = prepare_fgnet_dataset(source, root / "prepared", terms_acknowledged=True)
        assert result["preparationVersion"] == FGNET_PREPARATION_VERSION
        assert result["identityCount"] == 2 and result["imageCount"] == 3
        assert result["downloadPerformed"] is False
        assert (root / "prepared" / "001" / "001A02.JPG").exists()
        manifest = json.loads(Path(result["manifestPath"]).read_text(encoding="utf-8"))
        assert manifest["termsAcknowledged"] is True and manifest["sourceMutated"] is False
        assert {row["ageBucket"] for row in manifest["files"]} == {"child", "adolescent", "adult"}
        after = sorted(str(path.relative_to(source)) for path in source.rglob("*"))
        assert before == after
        assert parse_fgnet_filename("001A02.JPG") == ("001", 2)
        assert parse_fgnet_filename("bad.jpg") is None
        assert any(row["datasetId"] == "fgnet" and row["requiresTermsAcknowledgement"] for row in public_dataset_catalog()["datasets"])
        inspection = inspect_identity_dataset(source, dataset_id="fgnet")
        assert inspection["identityCount"] == 2
        assert inspection["usableIdentityCount"] == 1
        assert inspection["imageCount"] == 3


class FakeProject:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.validation_packs_path = root / "validation"
        self.audit: list[dict] = []

    def _append_audit(self, row: dict) -> None:
        self.audit.append(row)


class FakeBenchmark(PublicDatasetBenchmarkMixin):
    def __init__(self, root: Path, *, regress: bool = False) -> None:
        self.project = FakeProject(root)
        self.calls = 0
        self.regress = regress

    def public_dataset_benchmark(self, params: dict) -> dict:
        self.calls += 1
        augmented = bool(params.get("augmentAgeTrajectory"))
        positive_outcome = (
            "true-positive" if (self.regress and not augmented) or (not self.regress and augmented) else "false-negative"
        )
        positive_person = "Ada" if positive_outcome == "true-positive" else ""
        labels = [
            {
                "sourcePerson": "Ada",
                "sourceDatasetPath": "/dataset/Ada_30_f.jpg",
                "mediaKind": "image",
                "videoTimestampMs": None,
                "isMatch": True,
                "outcome": positive_outcome,
                "actualPerson": positive_person,
                "matchScore": 0.15 if not augmented else 0.23,
                "bestReferenceKind": "synthetic-age-trajectory" if augmented else "",
            },
            {
                "sourcePerson": "Distractor",
                "sourceDatasetPath": "/dataset/Distractor_30_f.jpg",
                "mediaKind": "image",
                "videoTimestampMs": None,
                "isMatch": False,
                "outcome": "true-negative",
                "actualPerson": "",
                "matchScore": 0.05,
                "bestReferenceKind": "",
            },
        ]
        labels_path = self.project.root / f"labels-{self.calls}.json"
        labels_path.parent.mkdir(parents=True, exist_ok=True)
        labels_path.write_text(json.dumps({"labels": labels}), encoding="utf-8")
        metrics = {
            "evaluated": 2,
            "falsePositives": 0,
            "wrongIdentity": 0,
            "precision": 1.0,
            "recall": 1.0 if positive_outcome == "true-positive" else 0.0,
        }
        return {
            "engine": "insightface-antelopev2/glintr100",
            "labelsJsonPath": str(labels_path),
            "metrics": metrics,
            "pipeline": {"ageTrajectory": {"added": 2 if augmented else 0}},
            "reportPath": str(self.project.root / f"report-{self.calls}.json"),
        }


def test_versioned_protocol_and_regression_gate() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        dataset = root / "agedb"
        dataset.mkdir()
        (root / "agedb-manifest.json").write_text('{"datasetId":"agedb"}', encoding="utf-8")
        benchmark = FakeBenchmark(root / "workspace")
        result = benchmark.cross_age_trajectory_benchmark(
            {
                "datasetId": "agedb",
                "folder": str(dataset),
                "acknowledgeDatasetTerms": True,
            }
        )
        assert result["protocolVersion"] == CROSS_AGE_TRAJECTORY_PROTOCOL_VERSION
        assert result["status"] == "pass"
        assert result["comparison"]["improvements"] == 1
        assert result["comparison"]["regressions"] == 0
        assert result["comparison"]["generatedReferences"] == 2
        assert result["datasetEvidence"]["manifestSha256"]
        assert Path(result["reportPath"]).exists()
        assert benchmark.project.audit[-1]["status"] == "pass"

        failing = FakeBenchmark(root / "regression", regress=True).cross_age_trajectory_benchmark(
            {
                "datasetId": "agedb",
                "folder": str(dataset),
                "acknowledgeDatasetTerms": True,
            }
        )
        assert failing["status"] == "fail"
        assert failing["gates"]["recallNonDecreasing"] is False


def test_dataset_age_parsers() -> None:
    helper = PublicDatasetBenchmarkMixin()
    assert helper._public_dataset_age_value("10163_JoanLeslie_13_f.jpg") == 13
    assert helper._public_dataset_age_value("ref-01-10163_JoanLeslie_101_f.jpg") == 101
    assert helper._public_dataset_age_value("001A02.JPG") == 2
    assert helper._public_dataset_reference_age_bucket(
        "agedb", Path("ref-01-10163_JoanLeslie_13_f.jpg"), path_index=0, path_count=2, endpoint_proxy=True
    ) == "adolescent"
    assert helper._public_dataset_reference_age_bucket(
        "calfw", Path("Aaron_0001.jpg"), path_index=0, path_count=2, endpoint_proxy=True
    ) == "adolescent"
    assert helper._public_dataset_reference_age_bucket(
        "calfw", Path("Aaron_0002.jpg"), path_index=1, path_count=2, endpoint_proxy=True
    ) == "older-adult"


def main() -> None:
    test_fgnet_local_preparer()
    test_versioned_protocol_and_regression_gate()
    test_dataset_age_parsers()
    print("cross-age benchmark units ok")


if __name__ == "__main__":
    main()

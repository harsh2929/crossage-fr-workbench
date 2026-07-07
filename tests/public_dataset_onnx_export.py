from __future__ import annotations

import json
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path

from benchmarks import export_public_dataset_onnx_rows


def _label_rows(dataset_id: str, *, positive_count: int = 16, negative_count: int = 8) -> list[dict]:
    rows: list[dict] = []
    for index in range(positive_count):
        rows.append(
            {
                "sourcePath": f"/private/{dataset_id}/pos-{index}.jpg",
                "sourceDatasetPath": f"/datasets/{dataset_id}/pos-{index}.jpg",
                "sourceHash": f"{dataset_id}-positive-{index}",
                "expectedPerson": f"{dataset_id}-person-{index % 4}",
                "actualPerson": f"{dataset_id}-person-{index % 4}",
                "isMatch": True,
                "matchScore": 0.72 + index * 0.001,
                "quality": 0.9,
                "mediaKind": "image",
                "poseBucket": "frontal",
                "scenario": f"{dataset_id}-expected-match",
                "validationBucket": "expected:match",
                "outcome": "true-positive",
            }
        )
    for index in range(negative_count):
        rows.append(
            {
                "sourcePath": f"/private/{dataset_id}/neg-{index}.jpg",
                "sourceDatasetPath": f"/datasets/{dataset_id}/neg-{index}.jpg",
                "sourceHash": f"{dataset_id}-negative-{index}",
                "expectedPerson": f"{dataset_id}-distractor-{index % 4}",
                "actualPerson": "",
                "isMatch": False,
                "matchScore": 0.05 + index * 0.001,
                "quality": 0.3,
                "mediaKind": "image",
                "poseBucket": "profile",
                "scenario": f"{dataset_id}-expected-non-match",
                "validationBucket": "expected:non-match",
                "outcome": "true-negative",
            }
        )
    rows[-1]["outcome"] = "false-positive"
    rows[-1]["matchScore"] = 0.24
    return rows


def _write_json(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-public-onnx-export-") as raw:
        root = Path(raw)
        labels_calfw = _write_json(
            root / "calfw" / "public-dataset-labels.json",
            {"generatedAt": "2026-06-19T00:00:00Z", "datasetId": "calfw", "labels": _label_rows("calfw")},
        )
        labels_cplfw = _write_json(
            root / "cplfw" / "public-dataset-labels.json",
            {"generatedAt": "2026-06-19T00:00:00Z", "datasetId": "cplfw", "labels": _label_rows("cplfw")},
        )
        report_calfw = _write_json(
            root / "calfw" / "public-dataset-benchmark.json",
            {"datasetId": "calfw", "labelsJsonPath": str(labels_calfw)},
        )
        report_cplfw = _write_json(
            root / "cplfw" / "public-dataset-benchmark.json",
            {"datasetId": "cplfw", "labelsJsonPath": str(labels_cplfw)},
        )
        latest = _write_json(
            root / "public-dataset-benchmark-latest.json",
            {
                "datasets": [
                    {
                        "datasetId": "calfw",
                        "recommendedPack": "antelopev2",
                        "packs": [{"pack": "antelopev2", "status": "complete", "reportPath": str(report_calfw)}],
                    },
                    {
                        "datasetId": "cplfw",
                        "recommendedPack": "antelopev2",
                        "packs": [{"pack": "antelopev2", "status": "complete", "reportPath": str(report_cplfw)}],
                    },
                ],
            },
        )
        result = export_public_dataset_onnx_rows.export_public_dataset_onnx_rows(
            [latest],
            root / "export",
            datasets=["calfw", "cplfw"],
            pack="antelopev2",
            model_name="antelopev2",
            validation_fraction=0.25,
            min_training_count=24,
            min_validation_count=8,
            min_per_class=2,
        )
        assert result["ok"] is True
        examples = json.loads(Path(result["examplesPath"]).read_text(encoding="utf-8"))
        assert examples["notProductionTrainingData"] is True
        assert examples["publicBenchmarkOnly"] is True
        assert examples["trainingUseAllowed"] is False
        assert len(examples["examples"]) == 48
        assert all(row["trainingUseAllowed"] is False for row in examples["examples"])
        assert "/private/" not in json.dumps(examples["examples"])
        assert "/datasets/" not in json.dumps(examples["examples"])
        assert {row["datasetId"] for row in examples["examples"]} == {"calfw", "cplfw"}
        assert all(row["trainingContext"]["version"] == "pair-context-v1" for row in examples["examples"])
        assert all(row["trainingContext"]["inferenceSafe"] is True for row in examples["examples"])
        contexts_text = json.dumps([row["trainingContext"] for row in examples["examples"]]).lower()
        assert "identity-match" not in contexts_text
        assert "non-match" not in contexts_text
        assert "false-positive" not in contexts_text
        assert "wrong-identity" not in contexts_text
        assert "ambiguous-person-margin" not in contexts_text
        false_positive_rows = [row for row in examples["examples"] if row["outcome"] == "false-positive"]
        assert false_positive_rows
        assert all("ambiguous-person-margin" not in row.get("features", {}).get("riskFlags", []) for row in false_positive_rows)

        manifest = json.loads(Path(result["split"]["manifestPath"]).read_text(encoding="utf-8"))
        assert manifest["sourceMetadata"]["notProductionTrainingData"] is True
        assert manifest["sourceMetadata"]["trainingUseAllowed"] is False
        assert manifest["privacy"] == {"pathsIncluded": False, "vectorsIncluded": False}
        assert manifest["training"]["classCounts"] == {"negative": 12, "positive": 24, "total": 36}
        assert manifest["validation"]["classCounts"] == {"negative": 4, "positive": 8, "total": 12}

        with redirect_stdout(StringIO()):
            exit_code = export_public_dataset_onnx_rows.main(
                [
                    str(labels_calfw),
                    "--output",
                    str(root / "direct-export"),
                    "--model-name",
                    "public-labels",
                    "--validation-fraction",
                    "0.25",
                    "--min-training-count",
                    "12",
                    "--min-validation-count",
                    "4",
                    "--min-per-class",
                    "2",
                ]
            )
        assert exit_code == 0
        assert (root / "direct-export" / export_public_dataset_onnx_rows.SUMMARY_FILENAME).is_file()


if __name__ == "__main__":
    main()

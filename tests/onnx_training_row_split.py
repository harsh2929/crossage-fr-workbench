from __future__ import annotations

import json
import tempfile
from pathlib import Path
from contextlib import redirect_stdout
from io import StringIO

from crossage_fr.experiments import onnx_training


def reviewed_rows(model_name: str = "modelA") -> list[dict]:
    rows: list[dict] = []
    for index in range(16):
        rows.append(
            {
                "exampleId": f"pos_{index}",
                "naturalKey": f"candidate:pos_{index}",
                "candidateId": f"pos_{index}",
                "sourceHash": f"photo_pos_{index}",
                "sourcePath": f"/private/photos/pos_{index}.jpg",
                "bestRefPath": f"/private/refs/pos_{index}.jpg",
                "expectedPerson": "Person A",
                "actualPerson": "Person A",
                "isMatch": True,
                "matchScore": 0.66 + index * 0.01,
                "rawCosine": 0.62 + index * 0.01,
                "quality": 0.9,
                "modelName": model_name,
                "poseBucket": "frontal",
                "embeddingVector": [0.1, 0.2],
                "features": {"runnerUpMargin": 0.18, "reviewPriority": 0.8},
            }
        )
        rows.append(
            {
                "exampleId": f"neg_{index}",
                "naturalKey": f"candidate:neg_{index}",
                "candidateId": f"neg_{index}",
                "sourceHash": f"photo_neg_{index}",
                "sourcePath": f"/private/photos/neg_{index}.jpg",
                "bestRefPath": f"/private/refs/neg_{index}.jpg",
                "expectedPerson": "Person A",
                "actualPerson": "",
                "isMatch": False,
                "matchScore": 0.12 + index * 0.01,
                "rawCosine": 0.09 + index * 0.01,
                "quality": 0.7,
                "modelName": model_name,
                "poseBucket": "profile",
                "features": {"riskFlags": ["close-runner-up"], "runnerUpMargin": 0.02},
            }
        )
    rows.extend(
        [
            {
                "exampleId": "other_model",
                "naturalKey": "candidate:other_model",
                "sourceHash": "other_model_hash",
                "expectedPerson": "Person B",
                "actualPerson": "Person B",
                "isMatch": True,
                "matchScore": 0.9,
                "rawCosine": 0.88,
                "modelName": "modelB",
            },
            {"exampleId": "invalid", "isMatch": True, "modelName": model_name},
        ]
    )
    return rows


def context_rows(model_name: str = "modelA") -> list[dict]:
    rows: list[dict] = []
    for index in range(16):
        rows.append(
            {
                "candidateId": f"context_pos_{index}",
                "sourceHash": f"context_pos_hash_{index}",
                "expectedPerson": "Context Positive",
                "actualPerson": "Context Positive",
                "isMatch": True,
                "matchScore": 0.55 + index * 0.01,
                "rawCosine": 0.53 + index * 0.01,
                "modelName": model_name,
                "datasetId": "calfw",
                "validationBucket": "age:cross-age",
                "difficulty": "cross-age",
                "scenario": "calfw-age-cross-age",
                "poseBucket": "frontal",
                "mediaKind": "image",
            }
        )
    for index in range(2):
        rows.append(
            {
                "candidateId": f"rare_pose_unknown_{index}",
                "sourceHash": f"rare_pose_unknown_hash_{index}",
                "expectedPerson": "Rare Pose Unknown",
                "actualPerson": "",
                "isMatch": True,
                "matchScore": 0.0,
                "rawCosine": 0.0,
                "modelName": model_name,
                "datasetId": "cplfw",
                "validationBucket": "pose:unknown",
                "difficulty": "identity-match",
                "scenario": "cplfw-pose-unknown",
                "poseBucket": "unknown",
                "mediaKind": "image",
            }
        )
    for index in range(18):
        rows.append(
            {
                "candidateId": f"context_neg_{index}",
                "sourceHash": f"context_neg_hash_{index}",
                "expectedPerson": "Context Negative",
                "actualPerson": "",
                "isMatch": False,
                "matchScore": 0.0,
                "rawCosine": 0.0,
                "modelName": model_name,
                "datasetId": "cplfw",
                "validationBucket": "expected:non-match",
                "difficulty": "non-match",
                "scenario": "cplfw-expected-non-match",
                "poseBucket": "unknown",
                "mediaKind": "image",
            }
        )
    return rows


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-onnx-row-split-") as raw:
        temp = Path(raw)
        source = temp / "reviewed-examples.json"
        source.write_text(
            json.dumps(
                {
                    "generatedAt": "2026-06-19T00:00:00Z",
                    "trainingDataHash": "source-hash",
                    "examples": reviewed_rows(),
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )
        split = onnx_training.split_reviewed_training_examples(
            source,
            temp / "split",
            validation_fraction=0.25,
            model_name="modelA",
            min_training_count=20,
            min_validation_count=8,
            min_per_class=4,
        )
        training = json.loads(Path(split["trainingRowsPath"]).read_text(encoding="utf-8"))
        validation = json.loads(Path(split["validationRowsPath"]).read_text(encoding="utf-8"))
        manifest = json.loads(Path(split["manifestPath"]).read_text(encoding="utf-8"))
        assert len(training["rows"]) == 24, manifest
        assert len(validation["rows"]) == 8, manifest
        assert manifest["input"]["droppedOtherModelRows"] == 1, manifest
        assert manifest["input"]["droppedInvalidRows"] == 1, manifest
        assert manifest["training"]["classCounts"] == {"negative": 12, "positive": 12, "total": 24}, manifest
        assert manifest["validation"]["classCounts"] == {"negative": 4, "positive": 4, "total": 8}, manifest
        assert manifest["privacy"]["pathsIncluded"] is False, manifest
        assert manifest["privacy"]["vectorsIncluded"] is False, manifest
        dumped_rows = json.dumps(training["rows"] + validation["rows"])
        assert "/private/" not in dumped_rows
        assert "embeddingVector" not in dumped_rows
        assert all(row["modelName"] == "modelA" for row in training["rows"] + validation["rows"])

        repeat = onnx_training.split_reviewed_training_examples(
            source,
            temp / "split-repeat",
            validation_fraction=0.25,
            model_name="modelA",
            min_training_count=20,
            min_validation_count=8,
            min_per_class=4,
        )
        repeat_training = json.loads(Path(repeat["trainingRowsPath"]).read_text(encoding="utf-8"))
        repeat_validation = json.loads(Path(repeat["validationRowsPath"]).read_text(encoding="utf-8"))
        assert [row["splitKey"] for row in training["rows"]] == [row["splitKey"] for row in repeat_training["rows"]]
        assert [row["splitKey"] for row in validation["rows"]] == [row["splitKey"] for row in repeat_validation["rows"]]

        context_source = temp / "context-examples.json"
        context_source.write_text(json.dumps({"examples": context_rows()}, indent=2), encoding="utf-8")
        context_split = onnx_training.split_reviewed_training_examples(
            context_source,
            temp / "context-split",
            validation_fraction=0.5,
            model_name="modelA",
            min_training_count=8,
            min_validation_count=18,
            min_per_class=4,
            split_salt="salt-2",
        )
        context_training = json.loads(Path(context_split["trainingRowsPath"]).read_text(encoding="utf-8"))
        context_validation = json.loads(Path(context_split["validationRowsPath"]).read_text(encoding="utf-8"))
        context_manifest = json.loads(Path(context_split["manifestPath"]).read_text(encoding="utf-8"))
        rare_training = [row for row in context_training["rows"] if str(row.get("candidateId", "")).startswith("rare_pose_unknown")]
        rare_validation = [row for row in context_validation["rows"] if str(row.get("candidateId", "")).startswith("rare_pose_unknown")]
        assert len(rare_training) == 1, context_manifest
        assert len(rare_validation) == 1, context_manifest
        assert context_manifest["validation"]["classCounts"] == {"negative": 9, "positive": 9, "total": 18}, context_manifest
        assert "validationBucket" in context_manifest["contextSplitFields"], context_manifest

        with redirect_stdout(StringIO()):
            cli_result = onnx_training.main(
                [
                    "--split-training-examples",
                    str(source),
                    str(temp / "split-cli"),
                    "--validation-fraction",
                    "0.25",
                    "--model-name",
                    "modelA",
                    "--min-training-count",
                    "20",
                    "--min-validation-count",
                    "8",
                    "--min-per-class",
                    "4",
                ]
            )
        assert cli_result == 0
        assert (temp / "split-cli" / onnx_training.TRAINING_ROWS_FILENAME).is_file()
        assert (temp / "split-cli" / onnx_training.VALIDATION_ROWS_FILENAME).is_file()

        weak_source = temp / "weak-examples.json"
        weak_source.write_text(json.dumps({"examples": reviewed_rows()[:10]}, indent=2), encoding="utf-8")
        with redirect_stdout(StringIO()):
            weak_result = onnx_training.main(
                [
                    "--split-training-examples",
                    str(weak_source),
                    str(temp / "weak-split"),
                    "--min-training-count",
                    "20",
                    "--min-validation-count",
                    "8",
                    "--min-per-class",
                    "4",
                ]
            )
        assert weak_result == 2


if __name__ == "__main__":
    main()

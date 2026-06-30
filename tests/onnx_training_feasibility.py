from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace

from crossage_fr.experiments import onnx_training, retraining_governance


def adapter_rows() -> list[dict]:
    rows: list[dict] = []
    for index in range(12):
        rows.append(
            {
                "candidateId": f"pos_{index}",
                "expectedPerson": "Person A",
                "actualPerson": "Person A",
                "isMatch": True,
                "matchScore": 0.72 + index * 0.01,
                "rawCosine": 0.70 + index * 0.01,
                "quality": 0.9,
                "modelName": "onnx-feasibility-test",
                "poseBucket": "frontal",
                "features": {"runnerUpMargin": 0.18, "reviewPriority": 0.8},
            }
        )
        rows.append(
            {
                "candidateId": f"neg_{index}",
                "expectedPerson": "Person A",
                "actualPerson": "",
                "isMatch": False,
                "matchScore": 0.08 + index * 0.01,
                "rawCosine": 0.06 + index * 0.01,
                "quality": 0.85,
                "modelName": "onnx-feasibility-test",
                "poseBucket": "profile",
                "features": {"riskFlags": ["close-runner-up"], "runnerUpMargin": 0.02, "reviewPriority": 0.35},
            }
        )
    return rows


def add_synthetic_measurable_gain(report: dict, *, gain: float = 0.03) -> dict:
    next_report = json.loads(json.dumps(report))
    for metric in ("accuracy", "precision", "recall"):
        onnx_value = float(next_report["onnxHead"]["metrics"][metric])
        next_report["jsonAdapter"]["metrics"][metric] = round(max(0.0, onnx_value - gain), 6)
        next_report["delta"][metric] = round(onnx_value - float(next_report["jsonAdapter"]["metrics"][metric]), 6)
    next_report["status"] = "pass"
    next_report["reason"] = "Synthetic measurable-gain fixture with internally consistent metrics."
    next_report["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional validation fixture.
        key: value for key, value in next_report.items() if key != "reportHash"
    })
    return next_report


class FakeArtifacts:
    class LossType:
        CrossEntropyLoss = "CrossEntropyLoss"

    class OptimType:
        AdamW = "AdamW"

    calls: list[dict] = []

    @classmethod
    def generate_artifacts(cls, model, **kwargs) -> None:  # noqa: ANN001 - mirrors external ORT API.
        cls.calls.append({"model": model, **kwargs})
        output = Path(kwargs["artifact_directory"])
        prefix = kwargs["prefix"]
        for name in ("training_model.onnx", "eval_model.onnx", "optimizer_model.onnx"):
            (output / f"{prefix}{name}").write_bytes(f"fake-{name}".encode("utf-8"))
        checkpoint = output / f"{prefix}checkpoint"
        checkpoint.mkdir(parents=True, exist_ok=True)
        (checkpoint / "state.bin").write_bytes(b"fake-checkpoint")


class FakeCheckpointState:
    loaded: list[str] = []
    saved: list[dict] = []

    @classmethod
    def load_checkpoint(cls, checkpoint_uri):  # noqa: ANN001 - mirrors external ORT API.
        cls.loaded.append(str(checkpoint_uri))
        return {"checkpoint": str(checkpoint_uri)}

    @classmethod
    def save_checkpoint(cls, state, checkpoint_uri, include_optimizer_state=False):  # noqa: ANN001 - mirrors external ORT API.
        cls.saved.append({"state": state, "checkpoint": str(checkpoint_uri), "includeOptimizerState": include_optimizer_state})
        Path(checkpoint_uri, "saved.bin").write_bytes(b"saved")


class FakeModule:
    calls: list[str] = []

    def __init__(self, train_model_uri, state, eval_model_uri=None, device="cpu"):  # noqa: ANN001 - mirrors external ORT API.
        self.train_model_uri = str(train_model_uri)
        self.state = state
        self.eval_model_uri = str(eval_model_uri)
        self.device = device

    def train(self):
        self.calls.append("train")
        return self

    def __call__(self, features, labels):  # noqa: ANN001 - mirrors external ORT API.
        self.calls.append(f"call:{features.shape[0]}:{labels.shape[0]}")
        return 0.25

    def lazy_reset_grad(self):
        self.calls.append("lazy_reset_grad")

    def export_model_for_inferencing(self, inference_model_uri, graph_output_names):  # noqa: ANN001 - mirrors external ORT API.
        self.calls.append(f"export:{','.join(graph_output_names)}")
        Path(inference_model_uri).write_bytes(b"fake-inference")


class FakeOptimizer:
    learning_rates: list[float] = []
    steps = 0

    def __init__(self, optimizer_uri, module):  # noqa: ANN001 - mirrors external ORT API.
        self.optimizer_uri = str(optimizer_uri)
        self.module = module

    def set_learning_rate(self, learning_rate: float) -> None:
        self.learning_rates.append(float(learning_rate))

    def step(self) -> None:
        type(self).steps += 1


def main() -> None:
    os.environ.pop("VINTRACE_EXPERIMENTAL_ONNX_TRAINING", None)
    os.environ.pop("CROSSAGE_EXPERIMENTAL_ONNX_TRAINING", None)
    matrix = onnx_training.dependency_feasibility_matrix()
    assert matrix["featureFlag"] == "VINTRACE_EXPERIMENTAL_ONNX_TRAINING"
    assert any(row["target"] == "macos-arm64" for row in matrix["rows"])
    assert "onnxruntime.training" in matrix["installed"]
    disabled = onnx_training.tiny_scoring_head_training_status()
    assert disabled["status"] == "disabled", disabled
    assert disabled["enabled"] is False
    with tempfile.TemporaryDirectory(prefix="vintrace-onnx-feasibility-") as raw:
        temp = Path(raw)
        forward = onnx_training.save_tiny_scoring_head_model(temp / "forward.onnx", feature_count=4)
        assert forward["exists"] is True, forward
        assert forward["sha256"], forward
        mlp_forward = onnx_training.save_tiny_scoring_head_model(
            temp / "forward-mlp.onnx",
            feature_count=4,
            architecture="mlp",
            hidden_units=3,
        )
        assert mlp_forward["exists"] is True, mlp_forward
        import onnx

        assert onnx.load(temp / "forward.onnx").ir_version <= 10
        mlp_model = onnx.load(temp / "forward-mlp.onnx")
        assert mlp_model.ir_version <= 10
        assert {node.op_type for node in mlp_model.graph.node} >= {"MatMul", "Add", "Relu"}
        standardized_forward = onnx_training.save_tiny_scoring_head_model(
            temp / "forward-standardized.onnx",
            feature_count=4,
            feature_preprocessing={
                "mode": "standardize",
                "featureCount": 4,
                "means": [0.1, 0.2, 0.3, 0.4],
                "scales": [1.0, 2.0, 3.0, 4.0],
            },
        )
        assert standardized_forward["exists"] is True, standardized_forward
        standardized_model = onnx.load(temp / "forward-standardized.onnx")
        assert {node.op_type for node in standardized_model.graph.node} >= {"Sub", "Div", "MatMul", "Add"}
        disabled_generation = onnx_training.generate_tiny_scoring_head_artifacts(temp / "disabled")
        assert disabled_generation["status"] == "disabled", disabled_generation

    os.environ["VINTRACE_EXPERIMENTAL_ONNX_TRAINING"] = "1"
    enabled = onnx_training.tiny_scoring_head_training_status()
    assert enabled["enabled"] is True
    if matrix["installed"]["onnxruntime.training"]:
        assert enabled["status"] == "ready-for-prototype", enabled
    else:
        assert enabled["status"] == "unavailable", enabled
        assert any("onnxruntime.training" in blocker for blocker in enabled["blockers"]), enabled
    footprint = onnx_training.installed_package_footprint()
    if matrix["installed"]["onnxruntime"]:
        assert any(
            row["name"] in {"onnxruntime", "onnxruntime-training-cpu"} and row["available"]
            for row in footprint
        ), footprint
    assert any(row["name"] == "onnxruntime-training" for row in footprint), footprint
    assert any(row["name"] == "onnxruntime-training-cpu" for row in footprint), footprint
    if matrix["installed"]["onnxruntime.training"]:
        assert any(
            row["name"] in onnx_training.TRAINING_RUNTIME_DISTRIBUTIONS and row["available"]
            for row in footprint
        ), footprint
    with tempfile.TemporaryDirectory(prefix="vintrace-onnx-feasibility-") as raw:
        temp = Path(raw)
        measurement = onnx_training.phase5_measurement_report(temp / "measurement")
        assert measurement["forwardModel"]["exists"] is True, measurement
        assert measurement["packageFootprint"], measurement
        target_row = onnx_training.build_target_runtime_study_row(measurement)
        assert target_row["target"] == matrix["currentPlatform"], target_row
        assert target_row["packageSizeBytes"] > 0, target_row
        assert target_row["failureModes"], target_row
        if not matrix["installed"]["onnxruntime.training"]:
            assert measurement["artifactGeneration"]["status"] == "unavailable", measurement
            assert measurement["failureModes"], measurement
            assert target_row["trainingRuntimeAvailable"] is False, target_row
            assert target_row["status"] == "blocked", target_row
            assert any("onnxruntime.training" in blocker for blocker in target_row["blockers"]), target_row
        else:
            assert measurement["artifactGeneration"]["status"] == "complete", measurement
            assert measurement["trainingJob"]["status"] == "complete", measurement
            assert measurement["trainingJob"]["rows"] > 0, measurement
            assert measurement["trainingJob"]["losses"], measurement
            assert target_row["trainingRuntimeAvailable"] is True, target_row
            assert target_row["trainingJobStatus"] == "complete", target_row
            assert target_row["status"] == "pass", target_row
        bundle = onnx_training.write_phase5_measurement_bundle(temp / "measurement-bundle")
        assert Path(bundle["measurementPath"]).is_file(), bundle
        assert Path(bundle["runtimeStudyFragmentPath"]).is_file(), bundle
        assert Path(bundle["decisionReportPath"]).is_file(), bundle
        assert bundle["decisionReport"]["status"] == "no-go", bundle
        if matrix["installed"]["onnxruntime.training"]:
            assert bundle["decisionReport"]["artifact"]["verified"] is True, bundle
        else:
            assert bundle["decisionReport"]["artifact"]["verified"] is False, bundle
        assert bundle["rowValidation"]["status"] == "not-requested", bundle
        if matrix["installed"]["onnxruntime.training"]:
            training_rows_path = temp / "training-rows.json"
            validation_rows_path = temp / "validation-rows.json"
            training_rows_path.write_text(json.dumps({"rows": adapter_rows()}, indent=2, sort_keys=True), encoding="utf-8")
            validation_rows_path.write_text(json.dumps({"rows": adapter_rows()}, indent=2, sort_keys=True), encoding="utf-8")
            row_bundle = onnx_training.write_phase5_measurement_bundle(
                temp / "row-measurement-bundle",
                training_rows_source=training_rows_path,
                validation_rows_source=validation_rows_path,
                row_training_epochs=2,
                row_training_learning_rate=0.03,
            )
            assert row_bundle["rowValidation"]["status"] == "complete", row_bundle
            assert Path(row_bundle["rowValidation"]["validationReportPath"]).is_file(), row_bundle
            assert row_bundle["decisionReport"]["validation"]["source"] == row_bundle["rowValidation"]["validationReportPath"], row_bundle
            assert "validation:validation-missing" not in row_bundle["decisionReport"]["blockers"], row_bundle
            assert row_bundle["decisionReport"]["artifact"]["verified"] is True, row_bundle
            row_validation_report = json.loads(Path(row_bundle["rowValidation"]["validationReportPath"]).read_text(encoding="utf-8"))
            assert row_validation_report["trainingConfig"]["epochs"] == 2, row_validation_report
            assert row_validation_report["trainingConfig"]["learningRate"] == 0.03, row_validation_report
            assert row_validation_report["trainingConfig"]["architecture"] == "linear", row_validation_report
            assert row_validation_report["trainingConfig"]["hiddenUnits"] == 0, row_validation_report
            assert row_validation_report["trainingConfig"]["featurePreprocessing"]["mode"] == "none", row_validation_report
            assert row_bundle["rowValidation"]["featurePreprocessing"]["mode"] == "none", row_bundle
            assert row_bundle["rowValidation"]["featurePreprocessing"]["featureCount"] == row_validation_report["trainingConfig"]["featureCount"], row_bundle
        partial_row_bundle = onnx_training.write_phase5_measurement_bundle(
            temp / "partial-row-measurement-bundle",
            training_rows_source=temp / "missing-training-rows.json",
        )
        assert partial_row_bundle["rowValidation"]["status"] == "blocked", partial_row_bundle
        fragment = json.loads(Path(bundle["runtimeStudyFragmentPath"]).read_text(encoding="utf-8"))
        assert fragment["targets"][0]["target"] == matrix["currentPlatform"], fragment
        combined_one = onnx_training.combine_target_runtime_studies([fragment])
        assert combined_one["status"] == "incomplete", combined_one
        assert matrix["currentPlatform"] not in combined_one["missingTargets"], combined_one
        synthetic_sources = []
        for target in onnx_training.TARGET_PLATFORMS:
            synthetic_sources.append(
                {
                    "schemaVersion": 1,
                    "targets": [
                        {
                            "target": target,
                            "trainingRuntimeAvailable": True,
                            "trainingPackageAvailable": True,
                            "gpuAvailable": target != "macos-x64",
                            "providers": ["CoreMLExecutionProvider", "CPUExecutionProvider"] if target == "macos-arm64" else ["CPUExecutionProvider"],
                            "primaryProvider": "CoreMLExecutionProvider" if target == "macos-arm64" else "CPUExecutionProvider",
                            "performanceTier": "high" if target == "macos-arm64" else "standard",
                            "trainingDurationMs": 1200,
                            "measuredAtUnix": 1.0,
                            "packageSizeBytes": 250_000_000,
                            "failureModes": ["cancelled", "out-of-memory"],
                            "status": "pass",
                        }
                    ],
                }
            )
        combined_full = onnx_training.combine_target_runtime_studies(synthetic_sources)
        assert combined_full["status"] == "complete", combined_full
        assert combined_full["missingTargets"] == [], combined_full
        assert combined_full["reportHash"], combined_full
        memory_combined_path = temp / "memory-combined-runtime-study.json"
        memory_combined = onnx_training.write_combined_target_runtime_study(memory_combined_path, synthetic_sources)
        assert Path(memory_combined["studyPath"]).is_file(), memory_combined
        memory_combined_verification = onnx_training.verify_combined_target_runtime_study(memory_combined_path)
        assert memory_combined_verification["verified"] is False, memory_combined_verification
        assert any(error.startswith("runtime-study-source-file-required") for error in memory_combined_verification["errors"]), memory_combined_verification
        memory_combined_decision = onnx_training.phase5_go_no_go_report(
            runtime_study_source=memory_combined_path,
        )
        assert memory_combined_decision["ok"] is False, memory_combined_decision
        assert any(
            blocker.startswith("runtime:runtime-study-report-invalid:runtime-study-source-file-required")
            for blocker in memory_combined_decision["blockers"]
        ), memory_combined_decision
        unreadable_fragment = temp / "runtime-fragment-directory.json"
        unreadable_fragment.mkdir()
        unreadable_combined = onnx_training.write_combined_target_runtime_study(
            temp / "combined-runtime-study-unreadable-source.json",
            [unreadable_fragment],
        )
        assert unreadable_combined["status"] == "incomplete", unreadable_combined
        assert any(
            error.startswith("runtime-study-source-unreadable")
            for error in unreadable_combined["sourceErrors"]
        ), unreadable_combined
        unreadable_combined_verification = onnx_training.verify_combined_target_runtime_study(
            unreadable_combined["studyPath"]
        )
        assert unreadable_combined_verification["verified"] is True, unreadable_combined_verification
        unreadable_combined_decision = onnx_training.phase5_go_no_go_report(
            runtime_study_source=unreadable_combined["studyPath"],
        )
        assert unreadable_combined_decision["ok"] is False, unreadable_combined_decision
        assert any(
            blocker.startswith("runtime:runtime-study-source-unreadable")
            for blocker in unreadable_combined_decision["blockers"]
        ), unreadable_combined_decision
        invalid_bytes_fragment = temp / "runtime-fragment-invalid-bytes.json"
        invalid_bytes_fragment.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_combined = onnx_training.write_combined_target_runtime_study(
            temp / "combined-runtime-study-invalid-bytes-source.json",
            [invalid_bytes_fragment],
        )
        assert invalid_bytes_combined["status"] == "incomplete", invalid_bytes_combined
        assert any(
            error.startswith("runtime-study-source-invalid-json")
            for error in invalid_bytes_combined["sourceErrors"]
        ), invalid_bytes_combined
        invalid_bytes_combined_verification = onnx_training.verify_combined_target_runtime_study(
            invalid_bytes_combined["studyPath"]
        )
        assert invalid_bytes_combined_verification["verified"] is True, invalid_bytes_combined_verification
        invalid_bytes_combined_decision = onnx_training.phase5_go_no_go_report(
            runtime_study_source=invalid_bytes_combined["studyPath"],
        )
        assert invalid_bytes_combined_decision["ok"] is False, invalid_bytes_combined_decision
        assert any(
            blocker.startswith("runtime:runtime-study-source-invalid-json")
            for blocker in invalid_bytes_combined_decision["blockers"]
        ), invalid_bytes_combined_decision
        invalid_bytes_runtime_report = temp / "combined-runtime-study-invalid-bytes.json"
        invalid_bytes_runtime_report.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_runtime_report_check = onnx_training.verify_combined_target_runtime_study(invalid_bytes_runtime_report)
        assert invalid_bytes_runtime_report_check["verified"] is False, invalid_bytes_runtime_report_check
        assert "runtime-study-invalid-json" in invalid_bytes_runtime_report_check["errors"]
        synthetic_source_paths = []
        for index, source in enumerate(synthetic_sources):
            source_path = temp / f"runtime-fragment-{index}.json"
            source_path.write_text(json.dumps(source, indent=2, sort_keys=True), encoding="utf-8")
            synthetic_source_paths.append(source_path)
        combined_path = temp / "combined-runtime-study.json"
        written_combined = onnx_training.write_combined_target_runtime_study(combined_path, synthetic_source_paths)
        assert Path(written_combined["studyPath"]).is_file(), written_combined
        cli_combined_path = temp / "combined-runtime-study-cli.json"
        with redirect_stdout(StringIO()):
            cli_result = onnx_training.main(
                ["--combine-runtime-study", str(cli_combined_path), *[str(path) for path in synthetic_source_paths]]
            )
        assert cli_result == 0
        assert cli_combined_path.is_file()
        combined_verification = onnx_training.verify_combined_target_runtime_study(combined_path)
        assert combined_verification["verified"] is True, combined_verification
        cli_combined_verification = onnx_training.verify_combined_target_runtime_study(cli_combined_path)
        assert cli_combined_verification["verified"] is True, cli_combined_verification
        with redirect_stdout(StringIO()):
            cli_missing_sources_result = onnx_training.main(["--combine-runtime-study", str(temp / "combined-runtime-study-empty.json")])
        assert cli_missing_sources_result == 2
        future_target_sources = []
        for index, source in enumerate(synthetic_sources):
            future_source = json.loads(json.dumps(source))
            if index == 0:
                future_source["targets"][0]["measuredAtUnix"] = time.time() + 10_000
            future_source_path = temp / f"runtime-fragment-future-target-{index}.json"
            future_source_path.write_text(json.dumps(future_source, indent=2, sort_keys=True), encoding="utf-8")
            future_target_sources.append(future_source_path)
        future_target_combined_path = temp / "combined-runtime-study-future-target.json"
        onnx_training.write_combined_target_runtime_study(future_target_combined_path, future_target_sources)
        future_target_verification = onnx_training.verify_combined_target_runtime_study(future_target_combined_path)
        assert future_target_verification["verified"] is False, future_target_verification
        assert f"runtime-study-target-measured-at-future:{onnx_training.TARGET_PLATFORMS[0]}" in future_target_verification["errors"]
        future_target_decision = onnx_training.phase5_go_no_go_report(runtime_study_source=future_target_combined_path)
        assert future_target_decision["ok"] is False, future_target_decision
        assert any(
            blocker.startswith(f"runtime:runtime-study-report-invalid:runtime-study-target-measured-at-future:{onnx_training.TARGET_PLATFORMS[0]}")
            for blocker in future_target_decision["blockers"]
        ), future_target_decision
        duplicate_target_path = temp / "runtime-fragment-duplicate-target.json"
        duplicate_target_payload = json.loads(json.dumps(synthetic_sources[0]))
        duplicate_target_payload["targets"].append(json.loads(json.dumps(duplicate_target_payload["targets"][0])))
        duplicate_target_path.write_text(json.dumps(duplicate_target_payload, indent=2, sort_keys=True), encoding="utf-8")
        duplicate_combined_path = temp / "combined-runtime-study-duplicate-target.json"
        onnx_training.write_combined_target_runtime_study(
            duplicate_combined_path,
            [duplicate_target_path, *synthetic_source_paths[1:]],
        )
        duplicate_verification = onnx_training.verify_combined_target_runtime_study(duplicate_combined_path)
        assert duplicate_verification["verified"] is False, duplicate_verification
        assert "runtime-study-sources-targets-inconsistent" in duplicate_verification["errors"]
        future_combined = json.loads(combined_path.read_text(encoding="utf-8"))
        future_combined["generatedAtUnix"] = time.time() + 10_000
        future_combined["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_combined.items() if key != "reportHash"
        })
        future_combined_path = temp / "combined-runtime-study-future.json"
        future_combined_path.write_text(json.dumps(future_combined, indent=2, sort_keys=True), encoding="utf-8")
        future_combined_verification = onnx_training.verify_combined_target_runtime_study(future_combined_path)
        assert future_combined_verification["verified"] is False, future_combined_verification
        assert "runtime-study-generated-at-future" in future_combined_verification["errors"]
        governance_ready = retraining_governance.runtime_feasibility_gate(combined_path)
        assert governance_ready["ok"] is True, governance_ready
        divergent_combined = json.loads(combined_path.read_text(encoding="utf-8"))
        divergent_target = divergent_combined["targets"][0]["target"]
        divergent_combined["targets"][0]["packageSizeBytes"] += 1
        divergent_combined["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional source divergence test.
            key: value for key, value in divergent_combined.items() if key != "reportHash"
        })
        divergent_combined_path = temp / "combined-runtime-study-divergent.json"
        divergent_combined_path.write_text(json.dumps(divergent_combined, indent=2, sort_keys=True), encoding="utf-8")
        divergent_verification = onnx_training.verify_combined_target_runtime_study(divergent_combined_path)
        assert divergent_verification["verified"] is False, divergent_verification
        assert f"runtime-study-source-target-mismatch:{divergent_target}" in divergent_verification["errors"]
        divergent_decision = onnx_training.phase5_go_no_go_report(runtime_study_source=divergent_combined_path)
        assert divergent_decision["ok"] is False, divergent_decision
        assert any(
            blocker.startswith(f"runtime:runtime-study-report-invalid:runtime-study-source-target-mismatch:{divergent_target}")
            for blocker in divergent_decision["blockers"]
        ), divergent_decision
        local_fragment_gate = retraining_governance.runtime_feasibility_gate(bundle["runtimeStudyFragmentPath"])
        assert local_fragment_gate["ok"] is False, local_fragment_gate
        assert local_fragment_gate["blockers"], local_fragment_gate
        try:
            onnx_training.combine_target_runtime_studies([{"targets": [{"status": "pass"}]}])
            raise AssertionError("target-less runtime study rows should fail loudly")
        except ValueError as exc:
            assert "missing target" in str(exc)
        blocked_decision = onnx_training.phase5_go_no_go_report()
        assert blocked_decision["ok"] is False, blocked_decision
        assert "artifact:artifact-manifest-missing" in blocked_decision["blockers"], blocked_decision
        assert "runtime:runtime-study-missing" in blocked_decision["blockers"], blocked_decision
        assert "validation:validation-missing" in blocked_decision["blockers"], blocked_decision
        runtime_directory = temp / "runtime-source-directory.json"
        runtime_directory.mkdir()
        unreadable_runtime_decision = onnx_training.phase5_go_no_go_report(runtime_study_source=runtime_directory)
        assert unreadable_runtime_decision["ok"] is False, unreadable_runtime_decision
        assert any(
            blocker.startswith("runtime:runtime-study-unreadable")
            for blocker in unreadable_runtime_decision["blockers"]
        ), unreadable_runtime_decision
        validation_directory = temp / "validation-source-directory.json"
        validation_directory.mkdir()
        unreadable_validation_decision = onnx_training.phase5_go_no_go_report(validation_source=validation_directory)
        assert unreadable_validation_decision["ok"] is False, unreadable_validation_decision
        assert any(
            blocker.startswith("validation:validation-unreadable")
            for blocker in unreadable_validation_decision["blockers"]
        ), unreadable_validation_decision
        unavailable_generation = onnx_training.generate_tiny_scoring_head_artifacts(temp / "unavailable")
        if not matrix["installed"]["onnxruntime.training"]:
            assert unavailable_generation["status"] == "unavailable", unavailable_generation
        FakeArtifacts.calls.clear()
        generated = onnx_training.generate_tiny_scoring_head_artifacts(
            temp / "generated",
            feature_count=4,
            prefix="fake_",
            artifact_module=FakeArtifacts,
        )
        assert generated["status"] == "complete", generated
        assert generated["manifest"]["status"] == "complete", generated["manifest"]
        verified = onnx_training.verify_training_artifact_manifest(generated["manifest"]["manifestPath"])
        assert verified["verified"] is True, verified
        assert all(not Path(item["path"]).is_absolute() for item in verified["payload"]["artifacts"])
        future_manifest_path = Path(generated["manifest"]["manifestPath"])
        future_manifest = json.loads(future_manifest_path.read_text(encoding="utf-8"))
        future_manifest["createdAtUnix"] = time.time() + 10_000
        future_manifest["manifestHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_manifest.items() if key != "manifestHash"
        })
        future_manifest_dir = temp / "future-manifest"
        shutil.copytree(temp / "generated", future_manifest_dir)
        (future_manifest_dir / onnx_training.MANIFEST_FILENAME).write_text(
            json.dumps(future_manifest, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        future_manifest_verification = onnx_training.verify_training_artifact_manifest(future_manifest_dir)
        assert future_manifest_verification["verified"] is False, future_manifest_verification
        assert "manifest-created-at-future" in future_manifest_verification["errors"]
        validation_rows = adapter_rows()
        validation_scores = [0.96 if row["isMatch"] else 0.04 for row in validation_rows]
        validation_gain = onnx_training.phase5_validation_report(
            validation_rows,
            validation_scores,
            min_count=20,
            min_per_class=5,
        )
        assert validation_gain["trainingConfig"] == {}, validation_gain
        validation_gain = add_synthetic_measurable_gain(validation_gain)
        assert validation_gain["status"] == "pass", validation_gain
        assert validation_gain["reportHash"], validation_gain
        decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_full,
            validation_source=validation_gain,
            min_metric_gain=0.01,
        )
        assert decision["ok"] is True, decision
        assert decision["status"] == "go-for-r-and-d", decision
        decision_path = temp / "phase5-decision.json"
        written_decision = onnx_training.write_phase5_go_no_go_report(
            decision_path,
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_full,
            validation_source=validation_gain,
            min_metric_gain=0.01,
        )
        assert Path(written_decision["reportPath"]).is_file(), written_decision
        memory_backed_verification = onnx_training.verify_phase5_go_no_go_report(written_decision["reportPath"])
        assert memory_backed_verification["verified"] is False, memory_backed_verification
        assert "phase5-evidence-file-required:runtime-study" in memory_backed_verification["errors"]
        assert "phase5-evidence-file-required:validation" in memory_backed_verification["errors"]
        validation_path = temp / "validation-gain.json"
        written_validation = onnx_training.write_phase5_validation_report(
            validation_path,
            validation_rows,
            validation_scores,
            min_count=20,
            min_per_class=5,
        )
        validation_path.write_text(
            json.dumps(add_synthetic_measurable_gain(written_validation), indent=2, sort_keys=True),
            encoding="utf-8",
        )
        assert Path(written_validation["reportPath"]).is_file(), written_validation
        assert onnx_training.verify_phase5_validation_report(validation_path)["verified"] is True
        source_backed_decision = onnx_training.write_phase5_go_no_go_report(
            temp / "phase5-source-backed-decision.json",
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_path,
            validation_source=validation_path,
            min_metric_gain=0.01,
        )
        source_backed_verification = onnx_training.verify_phase5_go_no_go_report(source_backed_decision["reportPath"])
        assert source_backed_verification["verified"] is True, source_backed_verification
        assert all(target["failureModes"] for target in source_backed_decision["runtime"]["targets"])
        assert all(isinstance(target["gpuAvailable"], bool) for target in source_backed_decision["runtime"]["targets"])
        assert all(target["providers"] for target in source_backed_decision["runtime"]["targets"])
        future_decision = json.loads(Path(source_backed_decision["reportPath"]).read_text(encoding="utf-8"))
        future_decision["generatedAtUnix"] = time.time() + 10_000
        future_decision["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_decision.items() if key != "reportHash"
        })
        future_decision_path = temp / "phase5-decision-future.json"
        future_decision_path.write_text(json.dumps(future_decision, indent=2, sort_keys=True), encoding="utf-8")
        future_decision_check = onnx_training.verify_phase5_go_no_go_report(future_decision_path)
        assert future_decision_check["verified"] is False, future_decision_check
        assert "phase5-decision-report-generated-at-future" in future_decision_check["errors"]
        invalid_bytes_decision_path = temp / "phase5-decision-invalid-bytes.json"
        invalid_bytes_decision_path.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_decision_check = onnx_training.verify_phase5_go_no_go_report(invalid_bytes_decision_path)
        assert invalid_bytes_decision_check["verified"] is False, invalid_bytes_decision_check
        assert "phase5-decision-report-invalid-json" in invalid_bytes_decision_check["errors"]
        missing_runtime_evidence = json.loads(Path(source_backed_decision["reportPath"]).read_text(encoding="utf-8"))
        del missing_runtime_evidence["runtime"]["targets"][0]["failureModes"]
        del missing_runtime_evidence["runtime"]["targets"][0]["providers"]
        missing_runtime_evidence["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in missing_runtime_evidence.items() if key != "reportHash"
        })
        missing_runtime_evidence_path = temp / "phase5-missing-runtime-evidence.json"
        missing_runtime_evidence_path.write_text(json.dumps(missing_runtime_evidence, indent=2, sort_keys=True), encoding="utf-8")
        missing_runtime_evidence_check = onnx_training.verify_phase5_go_no_go_report(missing_runtime_evidence_path)
        assert missing_runtime_evidence_check["verified"] is False, missing_runtime_evidence_check
        assert f"phase5-runtime-failure-modes-missing:{onnx_training.TARGET_PLATFORMS[0]}" in missing_runtime_evidence_check["errors"]
        assert f"phase5-runtime-providers-missing:{onnx_training.TARGET_PLATFORMS[0]}" in missing_runtime_evidence_check["errors"]
        source_weakened_bundle = temp / "source-weakened-required-kinds"
        shutil.copytree(temp / "generated", source_weakened_bundle)
        source_weakened_manifest_path = source_weakened_bundle / onnx_training.MANIFEST_FILENAME
        source_weakened_manifest = json.loads(source_weakened_manifest_path.read_text(encoding="utf-8"))
        source_weakened_manifest["requiredKinds"] = ["forwardModel"]
        source_weakened_manifest["missingRequiredKinds"] = []
        source_weakened_manifest["artifacts"] = [
            row for row in source_weakened_manifest["artifacts"] if row.get("kind") == "forwardModel"
        ]
        source_weakened_manifest["manifestHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional manifest overclaim test.
            key: value for key, value in source_weakened_manifest.items() if key != "manifestHash"
        })
        source_weakened_manifest_path.write_text(json.dumps(source_weakened_manifest, indent=2, sort_keys=True), encoding="utf-8")
        source_weakened_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=source_weakened_bundle,
            runtime_study_source=combined_path,
            validation_source=validation_path,
        )
        artifact_overclaim = json.loads(json.dumps(source_weakened_decision))
        artifact_overclaim["ok"] = True
        artifact_overclaim["status"] = "go-for-r-and-d"
        artifact_overclaim["artifact"]["verified"] = True
        artifact_overclaim["artifact"]["errors"] = []
        artifact_overclaim["blockers"] = []
        artifact_overclaim["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional source-summary overclaim.
            key: value for key, value in artifact_overclaim.items() if key != "reportHash"
        })
        artifact_overclaim_path = temp / "phase5-artifact-source-overclaim.json"
        artifact_overclaim_path.write_text(json.dumps(artifact_overclaim, indent=2, sort_keys=True), encoding="utf-8")
        artifact_overclaim_check = onnx_training.verify_phase5_go_no_go_report(artifact_overclaim_path)
        assert artifact_overclaim_check["verified"] is False, artifact_overclaim_check
        assert "phase5-artifact-source-mismatch:verified" in artifact_overclaim_check["errors"]
        assert "phase5-artifact-source-mismatch:errors" in artifact_overclaim_check["errors"]
        embedded_bundle = temp / "embedded-validation-overclaim"
        shutil.copytree(temp / "generated", embedded_bundle)
        embedded_manifest_path = embedded_bundle / onnx_training.MANIFEST_FILENAME
        embedded_manifest = json.loads(embedded_manifest_path.read_text(encoding="utf-8"))
        embedded_manifest["validation"] = {
            "status": "pass",
            "delta": {"accuracy": 0.05, "precision": 0.05, "recall": 0.05},
        }
        embedded_manifest["manifestHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional embedded validation overclaim.
            key: value for key, value in embedded_manifest.items() if key != "manifestHash"
        })
        embedded_manifest_path.write_text(json.dumps(embedded_manifest, indent=2, sort_keys=True), encoding="utf-8")
        embedded_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=embedded_bundle,
            runtime_study_source=combined_path,
        )
        assert embedded_decision["ok"] is False, embedded_decision
        assert any(blocker.startswith("validation:validation-report-invalid") for blocker in embedded_decision["blockers"]), embedded_decision
        embedded_overclaim = json.loads(json.dumps(embedded_decision))
        embedded_overclaim["ok"] = True
        embedded_overclaim["status"] = "go-for-r-and-d"
        embedded_overclaim["validation"] = {
            "ok": True,
            "source": "artifact-manifest.validation",
            "status": "pass",
            "minMetricGain": 0.01,
            "bestMetricGain": 0.05,
            "delta": {"accuracy": 0.05, "precision": 0.05, "recall": 0.05},
            "blockers": [],
        }
        embedded_overclaim["blockers"] = []
        embedded_overclaim["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional embedded validation source mismatch.
            key: value for key, value in embedded_overclaim.items() if key != "reportHash"
        })
        embedded_overclaim_path = temp / "phase5-embedded-validation-overclaim.json"
        embedded_overclaim_path.write_text(json.dumps(embedded_overclaim, indent=2, sort_keys=True), encoding="utf-8")
        embedded_overclaim_check = onnx_training.verify_phase5_go_no_go_report(embedded_overclaim_path)
        assert embedded_overclaim_check["verified"] is False, embedded_overclaim_check
        assert any(error.startswith("phase5-validation-source-mismatch") for error in embedded_overclaim_check["errors"]), embedded_overclaim_check
        invalid_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        invalid_validation["delta"]["accuracy"] = 0.99
        invalid_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in invalid_validation.items() if key != "reportHash"
        })
        invalid_validation_path = temp / "validation-gain-inconsistent.json"
        invalid_validation_path.write_text(json.dumps(invalid_validation, indent=2, sort_keys=True), encoding="utf-8")
        invalid_validation_check = onnx_training.verify_phase5_validation_report(invalid_validation_path)
        assert invalid_validation_check["verified"] is False, invalid_validation_check
        assert "validation-report-delta-inconsistent:accuracy" in invalid_validation_check["errors"]
        stale_feature_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        stale_feature_validation["onnxHead"]["featureVersion"] = "onnx-tiny-head-context-features-v2"
        stale_feature_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional stale feature test.
            key: value for key, value in stale_feature_validation.items() if key != "reportHash"
        })
        stale_feature_path = temp / "validation-gain-stale-feature.json"
        stale_feature_path.write_text(json.dumps(stale_feature_validation, indent=2, sort_keys=True), encoding="utf-8")
        stale_feature_check = onnx_training.verify_phase5_validation_report(stale_feature_path)
        assert stale_feature_check["verified"] is False, stale_feature_check
        assert "validation-report-feature-version-unsupported" in stale_feature_check["errors"]
        impossible_metric_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        impossible_metric_validation["jsonAdapter"]["metrics"]["accuracy"] = 1.1
        impossible_metric_validation["onnxHead"]["metrics"]["accuracy"] = 1.2
        impossible_metric_validation["delta"]["accuracy"] = 0.1
        impossible_metric_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional impossible metric test.
            key: value for key, value in impossible_metric_validation.items() if key != "reportHash"
        })
        impossible_metric_path = temp / "validation-gain-impossible-metric.json"
        impossible_metric_path.write_text(json.dumps(impossible_metric_validation, indent=2, sort_keys=True), encoding="utf-8")
        impossible_metric_check = onnx_training.verify_phase5_validation_report(impossible_metric_path)
        assert impossible_metric_check["verified"] is False, impossible_metric_check
        assert "validation-report-metric-invalid:jsonAdapter.accuracy" in impossible_metric_check["errors"]
        assert "validation-report-metric-invalid:onnxHead.accuracy" in impossible_metric_check["errors"]
        nonfinite_delta_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        nonfinite_delta_validation["delta"]["precision"] = "nan"
        nonfinite_delta_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional non-finite delta test.
            key: value for key, value in nonfinite_delta_validation.items() if key != "reportHash"
        })
        nonfinite_delta_path = temp / "validation-gain-nonfinite-delta.json"
        nonfinite_delta_path.write_text(json.dumps(nonfinite_delta_validation, indent=2, sort_keys=True), encoding="utf-8")
        nonfinite_delta_check = onnx_training.verify_phase5_validation_report(nonfinite_delta_path)
        assert nonfinite_delta_check["verified"] is False, nonfinite_delta_check
        assert "validation-report-delta-invalid:precision" in nonfinite_delta_check["errors"]
        future_validation = json.loads(validation_path.read_text(encoding="utf-8"))
        future_validation["generatedAtUnix"] = time.time() + 10_000
        future_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_validation.items() if key != "reportHash"
        })
        future_validation_path = temp / "validation-gain-future.json"
        future_validation_path.write_text(json.dumps(future_validation, indent=2, sort_keys=True), encoding="utf-8")
        future_validation_check = onnx_training.verify_phase5_validation_report(future_validation_path)
        assert future_validation_check["verified"] is False, future_validation_check
        assert "validation-report-generated-at-future" in future_validation_check["errors"]
        invalid_validation_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_path,
            validation_source=invalid_validation_path,
        )
        assert invalid_validation_decision["ok"] is False, invalid_validation_decision
        assert any(blocker.startswith("validation:validation-report-invalid") for blocker in invalid_validation_decision["blockers"]), invalid_validation_decision
        invalid_bytes_validation_path = temp / "validation-invalid-bytes.json"
        invalid_bytes_validation_path.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_validation_check = onnx_training.verify_phase5_validation_report(invalid_bytes_validation_path)
        assert invalid_bytes_validation_check["verified"] is False, invalid_bytes_validation_check
        assert "validation-report-invalid-json" in invalid_bytes_validation_check["errors"]
        invalid_bytes_validation_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_path,
            validation_source=invalid_bytes_validation_path,
        )
        assert invalid_bytes_validation_decision["ok"] is False, invalid_bytes_validation_decision
        assert any(
            blocker.startswith("validation:validation-invalid-json")
            for blocker in invalid_bytes_validation_decision["blockers"]
        ), invalid_bytes_validation_decision
        original_fragment = synthetic_source_paths[0].read_text(encoding="utf-8")
        tampered_fragment = json.loads(original_fragment)
        tampered_fragment["targets"][0]["packageSizeBytes"] = 1
        synthetic_source_paths[0].write_text(json.dumps(tampered_fragment, indent=2, sort_keys=True), encoding="utf-8")
        tampered_fragment_verification = onnx_training.verify_combined_target_runtime_study(combined_path)
        assert tampered_fragment_verification["verified"] is False, tampered_fragment_verification
        assert any(error.startswith("runtime-study-source-file-mismatch") for error in tampered_fragment_verification["errors"]), tampered_fragment_verification
        fragment_tampered_decision = onnx_training.verify_phase5_go_no_go_report(source_backed_decision["reportPath"])
        assert fragment_tampered_decision["verified"] is False, fragment_tampered_decision
        assert any(error.startswith("phase5-runtime-study-invalid:runtime-study-source-file-mismatch") for error in fragment_tampered_decision["errors"]), fragment_tampered_decision
        synthetic_source_paths[0].write_text(original_fragment, encoding="utf-8")
        tampered_combined = json.loads(combined_path.read_text(encoding="utf-8"))
        tampered_combined["targets"][0]["status"] = "blocked"
        combined_path.write_text(json.dumps(tampered_combined, indent=2, sort_keys=True), encoding="utf-8")
        tampered_source_verification = onnx_training.verify_phase5_go_no_go_report(source_backed_decision["reportPath"])
        assert tampered_source_verification["verified"] is False, tampered_source_verification
        assert "phase5-evidence-file-mismatch:runtime-study" in tampered_source_verification["errors"]
        inconsistent_report = json.loads(Path(source_backed_decision["reportPath"]).read_text(encoding="utf-8"))
        inconsistent_report["artifact"]["verified"] = False
        inconsistent_report["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in inconsistent_report.items() if key != "reportHash"
        })
        inconsistent_path = temp / "phase5-inconsistent-decision.json"
        inconsistent_path.write_text(json.dumps(inconsistent_report, indent=2, sort_keys=True), encoding="utf-8")
        inconsistent_verification = onnx_training.verify_phase5_go_no_go_report(inconsistent_path)
        assert inconsistent_verification["verified"] is False, inconsistent_verification
        assert "phase5-decision-report-ok-inconsistent" in inconsistent_verification["errors"]
        no_gain_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_full,
            validation_source={"status": "pass", "delta": {"accuracy": 0.0, "precision": 0.0, "recall": 0.0}},
            min_metric_gain=0.01,
        )
        assert no_gain_decision["ok"] is False, no_gain_decision
        assert "validation:measurable-gain-missing" in no_gain_decision["blockers"], no_gain_decision
        tradeoff_validation = json.loads(json.dumps(validation_gain))
        tradeoff_validation["jsonAdapter"]["metrics"]["precision"] = 0.99
        tradeoff_validation["onnxHead"]["metrics"]["precision"] = 0.98
        tradeoff_validation["delta"]["precision"] = -0.01
        tradeoff_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional metric-tradeoff test.
            key: value for key, value in tradeoff_validation.items() if key != "reportHash"
        })
        tradeoff_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_full,
            validation_source=tradeoff_validation,
            min_metric_gain=0.01,
        )
        assert tradeoff_decision["ok"] is False, tradeoff_decision
        assert "validation:measurable-gain-regression:precision" in tradeoff_decision["blockers"], tradeoff_decision
        tradeoff_validation_path = temp / "validation-gain-tradeoff.json"
        tradeoff_validation_path.write_text(json.dumps(tradeoff_validation, indent=2, sort_keys=True), encoding="utf-8")
        tradeoff_validation_check = onnx_training.verify_phase5_validation_report(tradeoff_validation_path)
        assert tradeoff_validation_check["verified"] is True, tradeoff_validation_check
        tradeoff_file_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_path,
            validation_source=tradeoff_validation_path,
            min_metric_gain=0.01,
        )
        assert tradeoff_file_decision["ok"] is False, tradeoff_file_decision
        assert "validation:measurable-gain-regression:precision" in tradeoff_file_decision["blockers"], tradeoff_file_decision
        tradeoff_overclaim = json.loads(json.dumps(tradeoff_file_decision))
        tradeoff_overclaim["ok"] = True
        tradeoff_overclaim["status"] = "go-for-r-and-d"
        tradeoff_overclaim["validation"]["ok"] = True
        tradeoff_overclaim["validation"]["status"] = "pass"
        tradeoff_overclaim["validation"]["blockers"] = []
        tradeoff_overclaim["blockers"] = []
        tradeoff_overclaim["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional metric-tradeoff overclaim.
            key: value for key, value in tradeoff_overclaim.items() if key != "reportHash"
        })
        tradeoff_overclaim_path = temp / "phase5-tradeoff-overclaim.json"
        tradeoff_overclaim_path.write_text(json.dumps(tradeoff_overclaim, indent=2, sort_keys=True), encoding="utf-8")
        tradeoff_overclaim_check = onnx_training.verify_phase5_go_no_go_report(tradeoff_overclaim_path)
        assert tradeoff_overclaim_check["verified"] is False, tradeoff_overclaim_check
        assert "phase5-validation-measurable-gain-regression:precision" in tradeoff_overclaim_check["errors"], tradeoff_overclaim_check
        package_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=combined_full,
            validation_source=validation_gain,
            max_package_bytes=1,
        )
        assert package_decision["ok"] is False, package_decision
        assert any(blocker.startswith("runtime:package-size-over-budget") for blocker in package_decision["blockers"]), package_decision
        blank_runtime_evidence = json.loads(json.dumps(combined_full))
        blank_runtime_evidence["targets"][0]["providers"] = [""]
        blank_runtime_evidence["targets"][0]["failureModes"] = [""]
        blank_runtime_evidence["targets"][0]["blockers"] = ["thermal-limit-unmeasured"]
        blank_runtime_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=blank_runtime_evidence,
            validation_source=validation_gain,
        )
        assert blank_runtime_decision["ok"] is False, blank_runtime_decision
        first_target = onnx_training.TARGET_PLATFORMS[0]
        assert f"runtime:providers-missing:{first_target}" in blank_runtime_decision["blockers"], blank_runtime_decision
        assert f"runtime:failure-modes-missing:{first_target}" in blank_runtime_decision["blockers"], blank_runtime_decision
        assert any(
            blocker.startswith(f"runtime:runtime-target-blocker:{first_target}:thermal-limit-unmeasured")
            for blocker in blank_runtime_decision["blockers"]
        ), blank_runtime_decision
        local_runtime_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=generated["manifest"]["manifestPath"],
            runtime_study_source=fragment,
            validation_source=validation_gain,
        )
        assert local_runtime_decision["ok"] is False, local_runtime_decision
        assert any(blocker.startswith("runtime:runtime-target-missing") for blocker in local_runtime_decision["blockers"]), local_runtime_decision
        copied_bundle = temp / "generated-copy"
        shutil.copytree(temp / "generated", copied_bundle)
        copied_verification = onnx_training.verify_training_artifact_manifest(copied_bundle)
        assert copied_verification["verified"] is True, copied_verification
        weakened_bundle = temp / "weakened-required-kinds"
        shutil.copytree(temp / "generated", weakened_bundle)
        weakened_manifest_path = weakened_bundle / onnx_training.MANIFEST_FILENAME
        weakened_manifest = json.loads(weakened_manifest_path.read_text(encoding="utf-8"))
        weakened_manifest["requiredKinds"] = ["forwardModel"]
        weakened_manifest["missingRequiredKinds"] = []
        weakened_manifest["artifacts"] = [
            row for row in weakened_manifest["artifacts"] if row.get("kind") == "forwardModel"
        ]
        weakened_manifest["manifestHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional manifest overclaim test.
            key: value for key, value in weakened_manifest.items() if key != "manifestHash"
        })
        weakened_manifest_path.write_text(json.dumps(weakened_manifest, indent=2, sort_keys=True), encoding="utf-8")
        weakened_verification = onnx_training.verify_training_artifact_manifest(weakened_bundle)
        assert weakened_verification["verified"] is False, weakened_verification
        assert "manifest-required-kinds-invalid" in weakened_verification["errors"]
        assert "manifest-missing-required-kinds-inconsistent" in weakened_verification["errors"]
        assert "required-artifact-missing:trainingModel" in weakened_verification["errors"]
        weakened_decision = onnx_training.phase5_go_no_go_report(
            artifact_manifest_path=weakened_bundle,
            runtime_study_source=combined_full,
            validation_source=validation_gain,
        )
        assert weakened_decision["ok"] is False, weakened_decision
        assert "artifact:manifest-required-kinds-invalid" in weakened_decision["blockers"], weakened_decision
        assert {item["kind"] for item in generated["artifacts"]} == {
            "forwardModel",
            "trainingModel",
            "evalModel",
            "optimizerModel",
            "checkpoint",
        }
        assert FakeArtifacts.calls[-1]["requires_grad"] == ["weight", "bias"]
        assert FakeArtifacts.calls[-1]["frozen_params"] == []
        assert FakeArtifacts.calls[-1]["loss"] == FakeArtifacts.LossType.CrossEntropyLoss
        assert FakeArtifacts.calls[-1]["optimizer"] == FakeArtifacts.OptimType.AdamW
        assert FakeArtifacts.calls[-1]["loss_input_names"] == ["logits"]
        mlp_generated = onnx_training.generate_tiny_scoring_head_artifacts(
            temp / "generated-mlp",
            feature_count=4,
            architecture="mlp",
            hidden_units=3,
            prefix="fake_mlp_",
            artifact_module=FakeArtifacts,
        )
        assert mlp_generated["status"] == "complete", mlp_generated
        assert mlp_generated["architecture"] == "mlp", mlp_generated
        assert mlp_generated["hiddenUnits"] == 3, mlp_generated
        assert mlp_generated["trainableParams"] == ["hidden_weight", "hidden_bias", "output_weight", "output_bias"], mlp_generated
        assert FakeArtifacts.calls[-1]["requires_grad"] == ["hidden_weight", "hidden_bias", "output_weight", "output_bias"]

        fake_api = SimpleNamespace(
            CheckpointState=FakeCheckpointState,
            Module=FakeModule,
            Optimizer=FakeOptimizer,
        )
        try:
            onnx_training.run_tiny_head_training_job(temp / "missing", [[0.1, 0.2]], [1], training_api=fake_api)
            raise AssertionError("missing training artifacts should fail loudly")
        except FileNotFoundError as exc:
            assert "Missing training artifacts" in str(exc)
        try:
            onnx_training.run_tiny_head_training_job(temp / "generated", [[0.1, 0.2]], [1, 0], prefix="fake_", training_api=fake_api)
            raise AssertionError("mismatched feature/label rows should fail loudly")
        except ValueError as exc:
            assert "same row count" in str(exc)
        trained = onnx_training.run_tiny_head_training_job(
            temp / "generated",
            [[0.8, 0.7, 0.1, 0.0], [0.1, 0.2, 0.8, 0.1]],
            [1, 0],
            epochs=2,
            prefix="fake_",
            training_api=fake_api,
        )
        assert trained["status"] == "complete", trained
        assert trained["losses"] == [0.25, 0.25], trained
        assert trained["learningRate"] == 0.01, trained
        assert FakeOptimizer.steps >= 2
        assert FakeOptimizer.learning_rates[-1] == 0.01
        assert any(item["kind"] == "inferenceModel" and item["exists"] for item in trained["artifacts"])
        assert onnx_training.verify_training_artifact_manifest(trained["manifest"]["manifestPath"])["verified"] is True

        registry = temp / "registry"
        promoted_first = onnx_training.promote_training_artifact_bundle(temp / "generated", registry)
        assert promoted_first["promoted"] is True
        second = onnx_training.generate_tiny_scoring_head_artifacts(
            temp / "generated-second",
            feature_count=4,
            prefix="fake2_",
            artifact_module=FakeArtifacts,
        )
        promoted_second = onnx_training.promote_training_artifact_bundle(temp / "generated-second", registry)
        assert promoted_second["previous"]["manifestId"] == promoted_first["active"]["manifestId"]
        rolled_back = onnx_training.rollback_training_artifact_bundle(registry)
        assert rolled_back["rolledBack"] is True
        assert rolled_back["active"]["manifestId"] == promoted_first["active"]["manifestId"]
        assert onnx_training.verify_active_training_pointer(registry)["verified"] is True
        future_pointer_path = registry / onnx_training.ACTIVE_POINTER_FILENAME
        future_pointer = json.loads(future_pointer_path.read_text(encoding="utf-8"))
        future_pointer["active"]["promotedAtUnix"] = time.time() + 10_000
        future_pointer["pointerHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_pointer.items() if key != "pointerHash"
        })
        future_pointer_dir = temp / "future-pointer"
        future_pointer_dir.mkdir()
        future_pointer_path_copy = future_pointer_dir / onnx_training.ACTIVE_POINTER_FILENAME
        future_pointer_path_copy.write_text(json.dumps(future_pointer, indent=2, sort_keys=True), encoding="utf-8")
        future_pointer_verification = onnx_training.verify_active_training_pointer(future_pointer_dir)
        assert future_pointer_verification["verified"] is False, future_pointer_verification
        assert "active-promoted-at-future" in future_pointer_verification["errors"]

        invalid_manifest_dir = temp / "invalid-manifest"
        invalid_manifest_dir.mkdir()
        (invalid_manifest_dir / onnx_training.MANIFEST_FILENAME).write_text("{", encoding="utf-8")
        invalid_manifest = onnx_training.verify_training_artifact_manifest(invalid_manifest_dir)
        assert invalid_manifest["verified"] is False, invalid_manifest
        assert "manifest-invalid-json" in invalid_manifest["errors"]
        invalid_bytes_manifest_dir = temp / "invalid-bytes-manifest"
        invalid_bytes_manifest_dir.mkdir()
        (invalid_bytes_manifest_dir / onnx_training.MANIFEST_FILENAME).write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_manifest = onnx_training.verify_training_artifact_manifest(invalid_bytes_manifest_dir)
        assert invalid_bytes_manifest["verified"] is False, invalid_bytes_manifest
        assert "manifest-invalid-json" in invalid_bytes_manifest["errors"]

        escaped = onnx_training.generate_tiny_scoring_head_artifacts(
            temp / "escaped",
            feature_count=4,
            prefix="escape_",
            artifact_module=FakeArtifacts,
        )
        outside = temp / "outside.onnx"
        outside.write_bytes(b"outside")
        escape_manifest_path = Path(escaped["manifest"]["manifestPath"])
        escape_manifest = json.loads(escape_manifest_path.read_text(encoding="utf-8"))
        escape_manifest["artifacts"][0]["path"] = "../outside.onnx"
        escape_manifest["manifestHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional tamper test.
            key: value for key, value in escape_manifest.items() if key != "manifestHash"
        })
        escape_manifest_path.write_text(json.dumps(escape_manifest, indent=2, sort_keys=True), encoding="utf-8")
        escaped_verification = onnx_training.verify_training_artifact_manifest(temp / "escaped")
        assert escaped_verification["verified"] is False, escaped_verification
        assert any(error.startswith("artifact-path-outside-bundle") for error in escaped_verification["errors"])

        tampered_registry = temp / "tampered-registry"
        onnx_training.promote_training_artifact_bundle(temp / "generated", tampered_registry)
        onnx_training.promote_training_artifact_bundle(temp / "generated-second", tampered_registry)
        pointer_path = tampered_registry / onnx_training.ACTIVE_POINTER_FILENAME
        pointer = json.loads(pointer_path.read_text(encoding="utf-8"))
        pointer["active"]["manifestHash"] = "0" * 64
        pointer_path.write_text(json.dumps(pointer, indent=2, sort_keys=True), encoding="utf-8")
        pointer_verification = onnx_training.verify_active_training_pointer(tampered_registry)
        assert pointer_verification["verified"] is False, pointer_verification
        assert "pointer-hash-mismatch" in pointer_verification["errors"]
        try:
            onnx_training.rollback_training_artifact_bundle(tampered_registry)
            raise AssertionError("tampered active pointer should not rollback")
        except ValueError as exc:
            assert "pointer failed verification" in str(exc)

        mismatch_registry = temp / "mismatch-registry"
        onnx_training.promote_training_artifact_bundle(temp / "generated", mismatch_registry)
        onnx_training.promote_training_artifact_bundle(temp / "generated-second", mismatch_registry)
        mismatch_path = mismatch_registry / onnx_training.ACTIVE_POINTER_FILENAME
        mismatch_pointer = json.loads(mismatch_path.read_text(encoding="utf-8"))
        mismatch_pointer["active"]["manifestHash"] = "0" * 64
        mismatch_pointer["pointerHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional tamper test.
            key: value for key, value in mismatch_pointer.items() if key != "pointerHash"
        })
        mismatch_path.write_text(json.dumps(mismatch_pointer, indent=2, sort_keys=True), encoding="utf-8")
        mismatch_verification = onnx_training.verify_active_training_pointer(mismatch_registry)
        assert mismatch_verification["verified"] is False, mismatch_verification
        assert "active-manifest-hash-mismatch" in mismatch_verification["errors"]
        try:
            onnx_training.rollback_training_artifact_bundle(mismatch_registry)
            raise AssertionError("active pointer with a manifest mismatch should not rollback")
        except ValueError as exc:
            assert "pointer failed verification" in str(exc)

        invalid_pointer_dir = temp / "invalid-pointer"
        invalid_pointer_dir.mkdir()
        (invalid_pointer_dir / onnx_training.ACTIVE_POINTER_FILENAME).write_text("{", encoding="utf-8")
        invalid_pointer = onnx_training.verify_active_training_pointer(invalid_pointer_dir)
        assert invalid_pointer["verified"] is False, invalid_pointer
        assert "pointer-invalid-json" in invalid_pointer["errors"]
        invalid_bytes_pointer_dir = temp / "invalid-bytes-pointer"
        invalid_bytes_pointer_dir.mkdir()
        (invalid_bytes_pointer_dir / onnx_training.ACTIVE_POINTER_FILENAME).write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_pointer = onnx_training.verify_active_training_pointer(invalid_bytes_pointer_dir)
        assert invalid_bytes_pointer["verified"] is False, invalid_bytes_pointer
        assert "pointer-invalid-json" in invalid_bytes_pointer["errors"]

        tampered = temp / "tampered"
        tampered_result = onnx_training.generate_tiny_scoring_head_artifacts(
            tampered,
            feature_count=4,
            prefix="bad_",
            artifact_module=FakeArtifacts,
        )
        Path(tampered_result["artifacts"][1]["path"]).write_bytes(b"tampered")
        tampered_verification = onnx_training.verify_training_artifact_manifest(tampered)
        assert tampered_verification["verified"] is False, tampered_verification
        assert any(error.startswith("artifact-mismatch") for error in tampered_verification["errors"])
        try:
            onnx_training.promote_training_artifact_bundle(tampered, registry)
            raise AssertionError("tampered training artifact bundle should not promote")
        except ValueError as exc:
            assert "Cannot promote invalid" in str(exc)

    rows = adapter_rows()
    feature_names = onnx_training.tiny_head_feature_names()
    assert onnx_training.ONNX_TINY_HEAD_FEATURE_VERSION == "onnx-tiny-head-app-context-features-v4"
    assert len(feature_names) == len(set(feature_names)), feature_names
    assert "score_zero_pose_unknown" in feature_names
    assert "score_zero_cross_age" in feature_names
    assert "context_cross_pose" in feature_names
    assert "zero_score_pose_unknown" not in feature_names
    assert "zero_score_identity_match" not in feature_names
    assert "context_expected_non_match" not in feature_names
    assert len(feature_names) > 19
    feature_rows, feature_labels = onnx_training.rows_to_tiny_head_features(
        [
            {
                "isMatch": True,
                "matchScore": 0,
                "rawCosine": 0,
                "poseBucket": "unknown",
                "ageGapYears": 20,
                "trainingContext": {
                    "schemaVersion": 1,
                    "version": "pair-context-v1",
                    "source": "app-owned-review-metadata",
                    "inferenceSafe": True,
                    "poseBucket": "unknown",
                    "mediaKind": "image",
                    "riskFlags": [],
                    "scenarioTags": ["cross-age", "pose-unknown", "zero-score"],
                    "scoreZero": True,
                    "scoreLow": True,
                    "crossAge": True,
                    "crossPose": False,
                    "poseUnknown": True,
                    "mediaVideo": False,
                    "closeRunnerUp": False,
                    "singleReference": False,
                    "hardPose": False,
                    "lowQuality": False,
                },
            }
        ],
        require_labels=True,
    )
    zero_pose_index = feature_names.index("score_zero_pose_unknown")
    zero_age_index = feature_names.index("score_zero_cross_age")
    assert feature_rows[0][zero_pose_index] == 1.0, feature_rows[0]
    assert feature_rows[0][zero_age_index] == 1.0, feature_rows[0]
    assert feature_labels == [1], feature_labels
    good_scores = [0.96 if row["isMatch"] else 0.04 for row in rows]
    validation = onnx_training.validate_against_json_adapter_baseline(rows, good_scores, min_count=20, min_per_class=5)
    assert validation["status"] == "pass", validation
    assert validation["delta"]["accuracy"] >= -0.02, validation
    assert validation["onnxHead"]["featureVersion"] == onnx_training.ONNX_TINY_HEAD_FEATURE_VERSION, validation
    assert validation["diagnostics"]["trainingCoverage"]["missingValidationRows"] == 0, validation
    assert validation["baselineTraining"]["source"] == "validation-rows", validation
    assert validation["baselineTraining"]["count"] == len(rows), validation
    assert validation["thresholds"]["jsonAdapter"] == 0.5, validation
    assert validation["thresholds"]["onnxHead"] == 0.5, validation
    assert validation["diagnostics"]["scoreSummary"]["onnxHead"]["separation"]["minPositiveMinusMaxNegative"] > 0, validation
    assert validation["diagnostics"]["onnxThresholdSweep"]["bestAccuracy"]["accuracy"] == 1.0, validation
    assert validation["diagnostics"]["selectedThreshold"]["deltaVsJsonAdapter"]["accuracy"] == validation["delta"]["accuracy"], validation
    baseline_sweep = validation["diagnostics"]["onnxThresholdSweep"]["baselineComparison"]
    assert baseline_sweep["candidateCount"] == validation["diagnostics"]["onnxThresholdSweep"]["candidateCount"], validation
    assert baseline_sweep["noRegressionCandidateCount"] >= 1, validation
    assert baseline_sweep["bestNoRegression"]["noCoreMetricRegression"] is True, validation
    assert validation["diagnostics"]["predictionErrors"]["onnxHead"]["falsePositives"] == [], validation
    calibrated = onnx_training.calibrate_onnx_threshold(good_scores, [bool(row["isMatch"]) for row in rows])
    assert calibrated["selected"]["accuracy"] == 1.0, calibrated
    assert calibrated["scoreSummary"]["separation"]["minPositiveMinusMaxNegative"] > 0, calibrated
    aware_calibrated = onnx_training.calibrate_onnx_threshold_against_baseline(
        [0.9, 0.8, 0.3, 0.2],
        [True, True, False, False],
        [0.7, 0.4, 0.3, 0.2],
    )
    assert aware_calibrated["selectionPolicy"] == "json-baseline-no-regression-first", aware_calibrated
    assert aware_calibrated["selectedByPolicy"] == "bestMeasurableGainNoRegression", aware_calibrated
    assert aware_calibrated["selected"]["noCoreMetricRegression"] is True, aware_calibrated
    coverage_gap_rows = [dict(row) for row in rows]
    coverage_gap_rows[1] = {
        **coverage_gap_rows[1],
        "matchScore": 0.0,
        "rawCosine": 0.0,
        "poseBucket": "unknown",
        "features": {},
    }
    coverage_gap_scores = [0.96 if row["isMatch"] else 0.04 for row in coverage_gap_rows]
    coverage_gap_validation = onnx_training.validate_against_json_adapter_baseline(
        coverage_gap_rows,
        coverage_gap_scores,
        baseline_rows=rows,
        min_count=20,
        min_per_class=5,
    )
    coverage_gap = coverage_gap_validation["diagnostics"]["trainingCoverage"]
    assert coverage_gap["missingValidationRows"] == 1, coverage_gap_validation
    assert coverage_gap["missingValidationContexts"][0]["label"] == "negative", coverage_gap_validation
    assert "pose=unknown" in coverage_gap["missingValidationContexts"][0]["contextKey"], coverage_gap_validation
    held_out = rows[:20]
    held_out_scores = [0.96 if row["isMatch"] else 0.04 for row in held_out]
    fair_validation = onnx_training.validate_against_json_adapter_baseline(
        held_out,
        held_out_scores,
        baseline_rows=rows,
        min_count=20,
        min_per_class=5,
    )
    assert fair_validation["baselineTraining"]["source"] == "training-rows", fair_validation
    assert fair_validation["baselineTraining"]["count"] == len(rows), fair_validation
    assert fair_validation["input"]["count"] == len(held_out), fair_validation
    assert fair_validation["baselineTraining"]["rowsHash"] != fair_validation["input"]["rowsHash"], fair_validation
    bad_scores = [0.04 if row["isMatch"] else 0.96 for row in rows]
    regressed = onnx_training.validate_against_json_adapter_baseline(rows, bad_scores, min_count=20, min_per_class=5)
    assert regressed["status"] == "regression", regressed
    regressed_sweep = regressed["diagnostics"]["onnxThresholdSweep"]["baselineComparison"]
    assert regressed_sweep["bestMeasurableGainNoRegression"] is None, regressed
    assert regressed["diagnostics"]["predictionErrors"]["onnxHead"]["falsePositives"], regressed
    assert regressed["diagnostics"]["predictionErrors"]["onnxHead"]["falseNegatives"], regressed
    try:
        onnx_training.validate_against_json_adapter_baseline(rows, good_scores[:-1], min_count=20, min_per_class=5)
        raise AssertionError("score length mismatch should fail")
    except ValueError as exc:
        assert "same length" in str(exc)
    try:
        onnx_training.validate_against_json_adapter_baseline(rows[:4], good_scores[:4], min_count=20, min_per_class=5)
        raise AssertionError("insufficient JSON adapter labels should fail")
    except ValueError as exc:
        assert "Not enough labeled rows" in str(exc)

    print(json.dumps({"ok": True, "matrix": matrix, "enabledStatus": enabled["status"]}, indent=2))


if __name__ == "__main__":
    main()

"""Feature-flagged ONNX Runtime training feasibility probes.

This module deliberately does not change production scoring. It is a Phase 5 R&D
surface for checking whether a tiny ONNX scoring head could ever beat the current
JSON adapter enough to justify training-runtime complexity.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence
import hashlib
import importlib.util
import importlib.metadata
import json
import math
import platform
import sys
import time
import uuid

from crossage_fr.runtime_env import env_flag


FEATURE_FLAG = "EXPERIMENTAL_ONNX_TRAINING"
CANONICAL_FEATURE_FLAG = f"VINTRACE_{FEATURE_FLAG}"
LEGACY_FEATURE_FLAG = f"CROSSAGE_{FEATURE_FLAG}"

TARGET_PLATFORMS = [
    "macos-arm64",
    "macos-x64",
    "windows-x64",
    "linux-x64",
]

REQUIRED_MODULES = [
    "onnxruntime",
    "onnxruntime.training",
    "onnx",
    "numpy",
]

PACKAGE_FOOTPRINT_DISTRIBUTIONS = [
    "onnxruntime",
    "onnx",
    "numpy",
    "scikit-learn",
    "onnxruntime-training",
    "onnxruntime-training-cpu",
    "torch",
]
TRAINING_RUNTIME_DISTRIBUTIONS = {
    "onnxruntime-training",
    "onnxruntime-training-cpu",
}

TRAINING_ARTIFACT_SUFFIXES = {
    "trainingModel": "training_model.onnx",
    "evalModel": "eval_model.onnx",
    "optimizerModel": "optimizer_model.onnx",
    "checkpoint": "checkpoint",
}
TRAINING_ARTIFACT_TYPE = "onnx-tiny-scoring-head"
TRAINING_REQUIRED_ARTIFACT_KINDS = [
    "forwardModel",
    "trainingModel",
    "evalModel",
    "optimizerModel",
    "checkpoint",
]

MANIFEST_FILENAME = "training_artifact_manifest.json"
ACTIVE_POINTER_FILENAME = "active_training_artifact.json"
MEASUREMENT_REPORT_FILENAME = "phase5_onnx_training_measurement.json"
RUNTIME_STUDY_FRAGMENT_FILENAME = "phase5_runtime_study_fragment.json"
PHASE5_DECISION_FILENAME = "phase5_onnx_training_decision.json"
PHASE5_VALIDATION_FILENAME = "phase5_onnx_training_validation.json"
PHASE5_ROW_SPLIT_MANIFEST_FILENAME = "phase5_onnx_training_row_split_manifest.json"
TRAINING_ROWS_FILENAME = "training-rows.json"
VALIDATION_ROWS_FILENAME = "validation-rows.json"
VALIDATION_REPORT_SCOPE = "phase5-onnx-training-validation"
CONTEXT_SPLIT_FIELDS = [
    "datasetId",
    "validationBucket",
    "difficulty",
    "scenario",
    "poseBucket",
    "mediaKind",
]
ONNX_TINY_HEAD_FEATURE_VERSION = "onnx-tiny-head-app-context-features-v4"
ONNX_CONTEXT_FEATURE_NAMES = [
    "context_cross_age",
    "context_cross_pose",
    "context_pose_unknown",
    "context_media_video",
    "context_close_runner_up",
    "context_single_reference",
    "context_hard_pose",
    "context_low_quality",
]
ROW_TRAINING_DEFAULT_EPOCHS = 64
ROW_TRAINING_DEFAULT_LEARNING_RATE = 0.05
ROW_TRAINING_DEFAULT_ARCHITECTURE = "linear"
ROW_TRAINING_DEFAULT_HIDDEN_UNITS = 0
ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING = "none"
ROW_TRAINING_ARCHITECTURES = {"linear", "mlp"}
ROW_TRAINING_FEATURE_PREPROCESSING = {"none", "standardize"}

BASELINE_RUNTIME_FAILURE_MODES = [
    "cancelled",
    "disk-full",
    "out-of-memory",
    "thermal-throttle",
    "artifact-tamper",
    "missing-training-runtime",
]

MAX_EVIDENCE_FUTURE_SKEW_SECONDS = 300


def enabled() -> bool:
    return env_flag(FEATURE_FLAG, default=False)


def module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, AttributeError, ValueError):
        return False


def current_platform_key() -> str:
    system = platform.system().casefold()
    machine = platform.machine().casefold()
    arch = "arm64" if machine in {"arm64", "aarch64"} else "x64" if machine in {"x86_64", "amd64"} else machine
    if system == "darwin":
        return f"macos-{arch}"
    if system == "windows":
        return f"windows-{arch}"
    if system == "linux":
        return f"linux-{arch}"
    return f"{system}-{arch}"


def dependency_feasibility_matrix() -> dict[str, Any]:
    installed = {name: module_available(name) for name in REQUIRED_MODULES}
    current = current_platform_key()
    rows: list[dict[str, Any]] = []
    for target in TARGET_PLATFORMS:
        current_host = target == current
        blockers: list[str] = []
        if current_host:
            blockers = [f"{name} is not importable" for name, ok in installed.items() if not ok]
        rows.append(
            {
                "target": target,
                "currentHost": current_host,
                "requiredModules": list(REQUIRED_MODULES),
                "installedOnCurrentHost": installed if current_host else None,
                "status": "available" if current_host and all(installed.values()) else "not-verified" if not current_host else "blocked",
                "blockers": blockers,
            }
        )
    return {
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "legacyFeatureFlag": LEGACY_FEATURE_FLAG,
        "enabled": enabled(),
        "currentPlatform": current,
        "installed": installed,
        "rows": rows,
        "summary": (
            "ONNX training dependencies are available on this host."
            if all(installed.values())
            else "ONNX training is not runnable on this host until missing modules are installed."
        ),
    }


def installed_package_footprint(distributions: Sequence[str] | None = None) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for name in list(distributions or PACKAGE_FOOTPRINT_DISTRIBUTIONS):
        try:
            dist = importlib.metadata.distribution(name)
        except importlib.metadata.PackageNotFoundError:
            rows.append({"name": name, "available": False, "version": "", "sizeBytes": 0, "sizeMB": 0.0})
            continue
        size = 0
        for file in dist.files or []:
            try:
                path = Path(dist.locate_file(file))
                if path.is_file():
                    size += path.stat().st_size
            except OSError:
                continue
        rows.append({"name": name, "available": True, "version": dist.version, "sizeBytes": size, "sizeMB": round(size / (1024 * 1024), 2)})
    return rows


def _measurement_training_examples(feature_count: int = 19) -> tuple[list[list[float]], list[int]]:
    features: list[list[float]] = []
    labels: list[int] = []
    for index in range(4):
        label = 1 if index < 2 else 0
        row = []
        for feature_index in range(feature_count):
            signal = 0.85 - index * 0.03 if label else 0.15 + (index - 2) * 0.03
            row.append(round(signal if feature_index % 2 == 0 else 1.0 - signal, 4))
        features.append(row)
        labels.append(label)
    return features, labels


def _training_job_report(training: dict[str, Any]) -> dict[str, Any]:
    manifest = training.get("manifest") if isinstance(training.get("manifest"), dict) else {}
    artifacts = training.get("artifacts") if isinstance(training.get("artifacts"), list) else []
    inference = next(
        (
            row
            for row in artifacts
            if isinstance(row, dict) and row.get("kind") == "inferenceModel"
        ),
        {},
    )
    return {
        "status": str(training.get("status", "") or "unknown"),
        "durationMs": float(training.get("durationMs", 0.0) or 0.0),
        "epochs": int(training.get("epochs", 0) or 0),
        "learningRate": float(training.get("learningRate", 0.0) or 0.0),
        "rows": int(training.get("rows", 0) or 0),
        "featureCount": int(training.get("featureCount", 0) or 0),
        "losses": [round(float(loss), 6) for loss in training.get("losses", []) if isinstance(loss, (int, float))],
        "artifactCount": len(artifacts),
        "normalizedIrKinds": list(training.get("normalizedIrKinds", [])) if isinstance(training.get("normalizedIrKinds"), list) else [],
        "inferenceModelPath": str(inference.get("path", "") or ""),
        "inferenceModelHash": str(inference.get("sha256", "") or ""),
        "manifestStatus": str(manifest.get("status", "") or ""),
        "manifestPath": str(manifest.get("manifestPath", "") or ""),
        "manifestHash": str(manifest.get("manifestHash", "") or ""),
    }


def phase5_measurement_report(output_dir: str | Path) -> dict[str, Any]:
    from crossage_fr.platform_detect import build_platform_report

    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    platform_report = build_platform_report()
    started = time.perf_counter()
    forward = save_tiny_scoring_head_model(output / "measurement_forward.onnx")
    forward_ms = round((time.perf_counter() - started) * 1000, 3)
    generation = generate_tiny_scoring_head_artifacts(output / "measurement_artifacts", prefix="measure_")
    failure_modes: list[dict[str, Any]] = []
    training_job: dict[str, Any] = {
        "status": "skipped",
        "reason": f"artifact-generation-{generation['status']}",
    }
    if generation["status"] in {"disabled", "unavailable", "incomplete"}:
        failure_modes.append(
            {
                "name": f"artifact-generation-{generation['status']}",
                "status": generation["status"],
                "reason": generation.get("reason", ""),
                "blockers": generation.get("blockers", []),
            }
        )
    if generation["status"] == "complete":
        try:
            features, labels = _measurement_training_examples()
            training = run_tiny_head_training_job(
                output / "measurement_artifacts",
                features,
                labels,
                epochs=2,
                prefix="measure_",
            )
            training_job = _training_job_report(training)
            if training_job["status"] != "complete":
                failure_modes.append(
                    {
                        "name": f"training-job-{training_job['status']}",
                        "status": training_job["status"],
                        "reason": training.get("reason", ""),
                        "blockers": training.get("blockers", []),
                    }
                )
        except Exception as exc:
            training_job = {
                "status": "failed",
                "errorType": exc.__class__.__name__,
                "reason": str(exc),
            }
            failure_modes.append(
                {
                    "name": "training-job-failed",
                    "status": "failed",
                    "reason": f"{exc.__class__.__name__}: {exc}",
                    "blockers": [],
                }
            )
    return {
        "generatedAtUnix": round(time.time(), 3),
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "enabled": enabled(),
        "platform": current_platform_key(),
        "hardware": {
            "platformKey": platform_report.platform_key,
            "providers": platform_report.available_providers,
            "primaryProvider": platform_report.primary_provider,
            "performanceTier": platform_report.performance_tier,
            "memoryTotalBytes": platform_report.memory_total_bytes,
            "cpuLogicalCount": platform_report.cpu_logical_count,
            "gpuAvailable": bool(platform_report.primary_provider and platform_report.primary_provider != "CPUExecutionProvider"),
        },
        "forwardModel": {**forward, "buildMs": forward_ms},
        "artifactGeneration": {
            "status": generation["status"],
            "durationMs": generation.get("durationMs", 0.0),
            "artifactCount": len(generation.get("artifacts", [])),
            "missingArtifacts": generation.get("missingArtifacts", []),
            "normalizedIrKinds": generation.get("normalizedIrKinds", []),
            "blockers": generation.get("blockers", []),
        },
        "trainingJob": training_job,
        "packageFootprint": installed_package_footprint(),
        "failureModes": failure_modes,
        "matrix": dependency_feasibility_matrix(),
    }


def _package_size_bytes(footprint: Sequence[dict[str, Any]]) -> int:
    total = 0
    for row in footprint:
        if not isinstance(row, dict) or row.get("available") is not True:
            continue
        try:
            total += int(row.get("sizeBytes", 0) or 0)
        except (TypeError, ValueError):
            continue
    return total


def _runtime_failure_modes(measurement: dict[str, Any], blockers: Sequence[str]) -> list[str]:
    modes = set(BASELINE_RUNTIME_FAILURE_MODES)
    modes.update(str(blocker) for blocker in blockers if blocker)
    for row in measurement.get("failureModes", []):
        if not isinstance(row, dict):
            continue
        name = str(row.get("name", "") or "").strip()
        if name:
            modes.add(name)
    return sorted(modes)


def build_target_runtime_study_row(
    measurement: dict[str, Any],
    *,
    target: str | None = None,
) -> dict[str, Any]:
    """Convert a Phase 5 host measurement into a Phase 6 runtime-gate row."""

    platform_key = target or str(measurement.get("platform", "") or current_platform_key())
    artifact_generation = measurement.get("artifactGeneration") if isinstance(measurement.get("artifactGeneration"), dict) else {}
    matrix = measurement.get("matrix") if isinstance(measurement.get("matrix"), dict) else {}
    installed = matrix.get("installed") if isinstance(matrix.get("installed"), dict) else {}
    hardware = measurement.get("hardware") if isinstance(measurement.get("hardware"), dict) else {}
    footprint = measurement.get("packageFootprint") if isinstance(measurement.get("packageFootprint"), list) else []
    missing_modules = [name for name in REQUIRED_MODULES if installed.get(name) is not True]
    blockers = [f"{name} is not importable" for name in missing_modules]
    artifact_status = str(artifact_generation.get("status", "") or "unknown")
    if artifact_status != "complete":
        blockers.append(f"artifact-generation-{artifact_status}")
    training_job = measurement.get("trainingJob") if isinstance(measurement.get("trainingJob"), dict) else {}
    training_job_status = str(training_job.get("status", "") or "unknown")
    if artifact_status == "complete" and training_job_status != "complete":
        blockers.append(f"training-job-{training_job_status}")
    training_runtime_available = not missing_modules and artifact_status == "complete" and training_job_status == "complete"
    try:
        duration_ms = int(round(
            float(artifact_generation.get("durationMs", 0.0) or 0.0)
            + float(training_job.get("durationMs", 0.0) or 0.0)
        ))
    except (TypeError, ValueError):
        duration_ms = 0
    duration_ms = max(1, duration_ms) if training_runtime_available else 0
    package_size = _package_size_bytes(footprint)
    training_package_available = any(
        row.get("name") in TRAINING_RUNTIME_DISTRIBUTIONS and row.get("available") is True
        for row in footprint
        if isinstance(row, dict)
    )
    return {
        "target": platform_key,
        "status": "pass" if training_runtime_available and package_size > 0 else "blocked",
        "trainingRuntimeAvailable": training_runtime_available,
        "trainingPackageAvailable": training_package_available,
        "gpuAvailable": hardware.get("gpuAvailable") if isinstance(hardware.get("gpuAvailable"), bool) else False,
        "providers": hardware.get("providers", []),
        "primaryProvider": hardware.get("primaryProvider", ""),
        "performanceTier": hardware.get("performanceTier", ""),
        "trainingDurationMs": duration_ms,
        "packageSizeBytes": package_size,
        "artifactGenerationStatus": artifact_status,
        "artifactCount": int(artifact_generation.get("artifactCount", 0) or 0),
        "trainingJobStatus": training_job_status,
        "trainingJobDurationMs": float(training_job.get("durationMs", 0.0) or 0.0),
        "missingArtifacts": artifact_generation.get("missingArtifacts", []),
        "blockers": blockers,
        "failureModes": _runtime_failure_modes(measurement, blockers),
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "currentHost": platform_key == current_platform_key(),
        "measuredAtUnix": measurement.get("generatedAtUnix", round(time.time(), 3)),
    }


def write_phase5_measurement_bundle(
    output_dir: str | Path,
    *,
    training_rows_source: str | Path | None = None,
    validation_rows_source: str | Path | None = None,
    row_training_epochs: int = ROW_TRAINING_DEFAULT_EPOCHS,
    row_training_learning_rate: float = ROW_TRAINING_DEFAULT_LEARNING_RATE,
    row_training_architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE,
    row_training_hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS,
    row_training_feature_preprocessing: str = ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING,
) -> dict[str, Any]:
    """Write local Phase 5 measurement evidence and a runtime-study fragment."""

    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    measurement = phase5_measurement_report(output)
    measurement_path = output / MEASUREMENT_REPORT_FILENAME
    measurement_path.write_text(json.dumps(measurement, indent=2, sort_keys=True), encoding="utf-8")
    target_row = build_target_runtime_study_row(measurement)
    study = {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "scope": "phase5-onnx-training-runtime-study-fragment",
        "sourceMeasurementPath": str(measurement_path),
        "targets": [target_row],
    }
    study_path = output / RUNTIME_STUDY_FRAGMENT_FILENAME
    study_path.write_text(json.dumps(study, indent=2, sort_keys=True), encoding="utf-8")
    row_validation = {
        "status": "not-requested",
        "trainingRowsSource": str(Path(training_rows_source).expanduser()) if training_rows_source else "",
        "validationRowsSource": str(Path(validation_rows_source).expanduser()) if validation_rows_source else "",
        "rowTrainingEpochs": int(row_training_epochs),
        "rowTrainingLearningRate": float(row_training_learning_rate),
        "architecture": str(row_training_architecture),
        "hiddenUnits": int(row_training_hidden_units),
        "featurePreprocessing": str(row_training_feature_preprocessing),
        "validationReportPath": "",
        "trainingJob": {},
        "validation": {},
    }
    validation_source: str | Path | None = None
    artifact_manifest_path: str | Path | None = None
    if training_rows_source or validation_rows_source:
        if not training_rows_source or not validation_rows_source:
            row_validation = {
                **row_validation,
                "status": "blocked",
                "reason": "Both --training-rows and --validation-rows are required for row-trained validation evidence.",
            }
        else:
            training_rows = _load_rows_source(training_rows_source, "training")
            validation_rows = _load_rows_source(validation_rows_source, "validation")
            row_validation = {
                **row_validation,
                **run_row_training_validation(
                    output / "row-training-validation",
                    training_rows,
                    validation_rows,
                    epochs=int(row_training_epochs),
                    learning_rate=float(row_training_learning_rate),
                    architecture=row_training_architecture,
                    hidden_units=int(row_training_hidden_units),
                    feature_preprocessing=row_training_feature_preprocessing,
                ),
            }
            if row_validation.get("status") == "complete":
                validation_source = str(row_validation.get("validationReportPath", "") or "")
                training_job = row_validation.get("trainingJob") if isinstance(row_validation.get("trainingJob"), dict) else {}
                artifact_manifest_path = str(training_job.get("manifestPath", "") or "") or None
    decision_path = output / PHASE5_DECISION_FILENAME
    if artifact_manifest_path is None:
        training_job = measurement.get("trainingJob") if isinstance(measurement.get("trainingJob"), dict) else {}
        artifact_manifest_path = str(training_job.get("manifestPath", "") or "") or None
    decision = write_phase5_go_no_go_report(
        decision_path,
        artifact_manifest_path=artifact_manifest_path,
        runtime_study_source=study,
        validation_source=validation_source,
    )
    return {
        "ok": target_row["trainingRuntimeAvailable"],
        "outputDir": str(output),
        "measurementPath": str(measurement_path),
        "runtimeStudyFragmentPath": str(study_path),
        "decisionReportPath": str(decision_path),
        "rowValidation": row_validation,
        "measurement": measurement,
        "targetRuntimeStudy": study,
        "decisionReport": decision,
    }


def _load_runtime_study_payload(source: str | Path | dict[str, Any]) -> tuple[dict[str, Any], str, list[str]]:
    if isinstance(source, dict):
        return source, "<memory>", []
    path = Path(source).expanduser()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}, str(path), ["runtime-study-source-missing"]
    except OSError as exc:
        return {}, str(path), [f"runtime-study-source-unreadable:{exc.__class__.__name__}"]
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}, str(path), ["runtime-study-source-invalid-json"]
    if not isinstance(payload, dict):
        return {}, str(path), ["runtime-study-source-not-object"]
    return payload, str(path), []


def _runtime_source_file_record(source: str | Path | dict[str, Any], targets: Sequence[str]) -> dict[str, Any]:
    if isinstance(source, dict):
        return {
            "path": "<memory>",
            "exists": False,
            "sizeBytes": 0,
            "sha256": "",
            "targets": list(targets),
        }
    path = Path(source).expanduser()
    exists = path.is_file()
    return {
        "path": str(path),
        "exists": exists,
        "sizeBytes": path.stat().st_size if exists else 0,
        "sha256": _sha256_file(path) if exists else "",
        "targets": list(targets),
    }


def _attach_report_hash(payload: dict[str, Any]) -> dict[str, Any]:
    report = {key: value for key, value in payload.items() if key != "reportHash"}
    return {**report, "reportHash": _sha256_json(report)}


def combine_target_runtime_studies(sources: Sequence[str | Path | dict[str, Any]]) -> dict[str, Any]:
    """Merge per-host runtime-study fragments into one Phase 6 gate input."""

    rows_by_target: dict[str, dict[str, Any]] = {}
    source_rows: list[dict[str, str]] = []
    source_files: list[dict[str, Any]] = []
    source_errors: list[str] = []
    for source in sources:
        payload, source_name, load_errors = _load_runtime_study_payload(source)
        if load_errors:
            source_errors.extend(f"{error}:{source_name}" for error in load_errors)
            source_files.append(_runtime_source_file_record(source, []))
            continue
        study = payload.get("targetRuntimeStudy") if isinstance(payload.get("targetRuntimeStudy"), dict) else payload
        targets = study.get("targets") if isinstance(study.get("targets"), list) else []
        source_targets: list[str] = []
        for row in targets:
            if not isinstance(row, dict):
                raise ValueError(f"Runtime study target row is not an object in {source_name}")
            target = str(row.get("target", "") or "").strip()
            if not target:
                raise ValueError(f"Runtime study target row is missing target in {source_name}")
            source_targets.append(target)
            rows_by_target[target] = row
            source_rows.append({"target": target, "source": source_name})
        source_files.append(_runtime_source_file_record(source, source_targets))
    missing = [target for target in TARGET_PLATFORMS if target not in rows_by_target]
    return _attach_report_hash({
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "scope": "phase5-onnx-training-runtime-study",
        "status": "complete" if not missing and not source_errors else "incomplete",
        "requiredTargets": list(TARGET_PLATFORMS),
        "missingTargets": missing,
        "sourceErrors": source_errors,
        "sources": source_rows,
        "sourceFiles": source_files,
        "targets": [rows_by_target[target] for target in TARGET_PLATFORMS if target in rows_by_target],
    })


def write_combined_target_runtime_study(output_path: str | Path, sources: Sequence[str | Path | dict[str, Any]]) -> dict[str, Any]:
    study = combine_target_runtime_studies(sources)
    path = Path(output_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(study, indent=2, sort_keys=True), encoding="utf-8")
    return {**study, "studyPath": str(path)}


def _combined_runtime_study_semantic_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("runtime-study-schema-version-unsupported")
    if str(payload.get("scope", "") or "") != "phase5-onnx-training-runtime-study":
        errors.append("runtime-study-scope-invalid")
    required = payload.get("requiredTargets") if isinstance(payload.get("requiredTargets"), list) else []
    if [str(item) for item in required] != TARGET_PLATFORMS:
        errors.append("runtime-study-required-targets-invalid")
    raw_targets = payload.get("targets")
    targets = raw_targets if isinstance(raw_targets, list) else []
    if raw_targets is not None and not isinstance(raw_targets, list):
        errors.append("runtime-study-targets-invalid")
    target_ids = [str(row.get("target", "") or "") for row in targets if isinstance(row, dict)]
    if len(target_ids) != len(set(target_ids)):
        errors.append("runtime-study-duplicate-targets")
    for index, row in enumerate(targets):
        if not isinstance(row, dict):
            errors.append(f"runtime-study-target-row-invalid:{index}")
            continue
        target = str(row.get("target", "") or "").strip()
        if not target:
            errors.append(f"runtime-study-target-missing:{index}")
        elif target not in TARGET_PLATFORMS:
            errors.append(f"runtime-study-target-unknown:{target}")
        errors.extend(_runtime_target_timestamp_errors(row, target, "runtime-study-target-measured-at"))
    sources = payload.get("sources") if isinstance(payload.get("sources"), list) else []
    source_target_ids = [
        str(row.get("target", "") or "")
        for row in sources
        if isinstance(row, dict)
    ]
    if sorted(source_target_ids) != sorted(target_ids):
        errors.append("runtime-study-sources-targets-inconsistent")
    source_files = payload.get("sourceFiles") if isinstance(payload.get("sourceFiles"), list) else []
    source_file_target_ids = [
        str(item)
        for record in source_files
        if isinstance(record, dict) and isinstance(record.get("targets"), list)
        for item in record.get("targets", [])
        if str(item)
    ]
    if sorted(source_file_target_ids) != sorted(target_ids):
        errors.append("runtime-study-source-files-targets-inconsistent")
    actual_missing = [target for target in TARGET_PLATFORMS if target not in target_ids]
    reported_missing = [str(item) for item in payload.get("missingTargets", [])] if isinstance(payload.get("missingTargets"), list) else []
    if reported_missing != actual_missing:
        errors.append("runtime-study-missing-targets-inconsistent")
    raw_source_errors = payload.get("sourceErrors", [])
    source_errors = [str(item) for item in raw_source_errors] if isinstance(raw_source_errors, list) else []
    if raw_source_errors and not isinstance(raw_source_errors, list):
        errors.append("runtime-study-source-errors-invalid")
    expected_status = "complete" if not actual_missing and not source_errors else "incomplete"
    if str(payload.get("status", "") or "") != expected_status:
        errors.append("runtime-study-status-inconsistent")
    errors.extend(_unix_timestamp_errors(payload, "generatedAtUnix", "runtime-study-generated-at"))
    if not sources and not source_errors:
        errors.append("runtime-study-sources-missing")
    if not source_files:
        errors.append("runtime-study-source-files-missing")
    if expected_status == "complete":
        file_backed_targets: set[str] = set()
        for record in source_files:
            if not isinstance(record, dict):
                continue
            if record.get("exists") is True and str(record.get("path", "") or "") not in {"", "<memory>"}:
                file_backed_targets.update(str(item) for item in record.get("targets", []) if str(item))
        for target in TARGET_PLATFORMS:
            if target not in file_backed_targets:
                errors.append(f"runtime-study-source-file-required:{target}")
    return errors


def _runtime_study_source_rows(path: str | Path) -> tuple[dict[str, dict[str, Any]], list[str]]:
    payload, load_errors, _source_name = _load_json_source(path, "runtime-study-source")
    if load_errors:
        return {}, load_errors
    study = payload.get("targetRuntimeStudy") if isinstance(payload.get("targetRuntimeStudy"), dict) else payload
    if not isinstance(study, dict):
        return {}, ["runtime-study-source-not-object"]
    targets = study.get("targets") if isinstance(study.get("targets"), list) else []
    rows: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    for row in targets:
        if not isinstance(row, dict):
            errors.append("runtime-study-source-target-row-invalid")
            continue
        target = str(row.get("target", "") or "").strip()
        if not target:
            errors.append("runtime-study-source-target-missing")
            continue
        rows[target] = row
    return rows, errors


def verify_combined_target_runtime_study(path: str | Path) -> dict[str, Any]:
    study_path = Path(path).expanduser()
    if not study_path.is_file():
        return {"verified": False, "path": str(study_path), "errors": ["runtime-study-missing"]}
    try:
        payload = json.loads(study_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "path": str(study_path), "errors": ["runtime-study-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "path": str(study_path), "errors": [f"runtime-study-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "path": str(study_path), "errors": ["runtime-study-not-object"]}
    expected_hash = str(payload.get("reportHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "reportHash"})
    errors: list[str] = []
    if not expected_hash:
        errors.append("runtime-study-hash-missing")
    elif expected_hash != actual_hash:
        errors.append("runtime-study-hash-mismatch")
    errors.extend(_combined_runtime_study_semantic_errors(payload))
    combined_targets = payload.get("targets") if isinstance(payload.get("targets"), list) else []
    combined_by_target = {
        str(row.get("target", "") or ""): row
        for row in combined_targets
        if isinstance(row, dict)
    }
    source_checks = []
    source_files = payload.get("sourceFiles") if isinstance(payload.get("sourceFiles"), list) else []
    for record in source_files:
        if not isinstance(record, dict):
            errors.append("runtime-study-source-record-invalid")
            continue
        raw_path = str(record.get("path", "") or "")
        targets = [str(item) for item in record.get("targets", [])] if isinstance(record.get("targets"), list) else []
        if raw_path == "<memory>":
            current = {
                "path": "<memory>",
                "exists": False,
                "sizeBytes": 0,
                "sha256": "",
                "targets": targets,
            }
        else:
            current = _runtime_source_file_record(raw_path, targets)
        ok = (
            bool(current["exists"]) == bool(record.get("exists"))
            and int(current["sizeBytes"]) == _as_positive_int(record.get("sizeBytes"))
            and str(current["sha256"]) == str(record.get("sha256", "") or "")
        )
        if not ok:
            errors.append(f"runtime-study-source-file-mismatch:{raw_path or 'unknown'}")
        if raw_path not in {"", "<memory>"} and current["exists"] and targets:
            source_rows, source_errors = _runtime_study_source_rows(raw_path)
            errors.extend(f"{error}:{raw_path}" for error in source_errors)
            for target in targets:
                source_row = source_rows.get(target)
                combined_row = combined_by_target.get(target)
                if source_row is None:
                    errors.append(f"runtime-study-source-target-missing:{target}")
                elif combined_row != source_row:
                    errors.append(f"runtime-study-source-target-mismatch:{target}")
        source_checks.append({"expected": record, "current": current, "ok": ok})
    return {
        "verified": not errors,
        "path": str(study_path),
        "reportHash": expected_hash,
        "errors": errors,
        "sources": source_checks,
        "payload": payload,
    }


def _load_json_source(source: str | Path | dict[str, Any] | None, label: str) -> tuple[dict[str, Any], list[str], str]:
    if source is None:
        return {}, [f"{label}-missing"], ""
    if isinstance(source, dict):
        return source, [], "<memory>"
    path = Path(source).expanduser()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}, [f"{label}-missing"], str(path)
    except OSError as exc:
        return {}, [f"{label}-unreadable:{exc.__class__.__name__}"], str(path)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {}, [f"{label}-invalid-json"], str(path)
    if not isinstance(payload, dict):
        return {}, [f"{label}-not-object"], str(path)
    return payload, [], str(path)


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _finite_float(value: Any) -> tuple[float, bool]:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return 0.0, False
    return parsed, math.isfinite(parsed)


def _as_positive_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def _unix_timestamp_errors(payload: dict[str, Any], field: str, error_prefix: str) -> list[str]:
    value = payload.get(field)
    if not isinstance(value, (int, float)):
        return [f"{error_prefix}-invalid"]
    if value <= 0:
        return [f"{error_prefix}-invalid"]
    if value > time.time() + MAX_EVIDENCE_FUTURE_SKEW_SECONDS:
        return [f"{error_prefix}-future"]
    return []


def _runtime_target_timestamp_errors(row: dict[str, Any], target: str, error_prefix: str) -> list[str]:
    target_label = target or "unknown"
    return [f"{error}:{target_label}" for error in _unix_timestamp_errors(row, "measuredAtUnix", error_prefix)]


def _phase5_validation_semantic_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("validation-report-schema-version-unsupported")
    if str(payload.get("scope", "") or "") != VALIDATION_REPORT_SCOPE:
        errors.append("validation-report-scope-invalid")
    if payload.get("notProductionAuthorization") is not True:
        errors.append("validation-report-authorization-scope-invalid")
    errors.extend(_unix_timestamp_errors(payload, "generatedAtUnix", "validation-report-generated-at"))
    input_summary = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    count = _as_positive_int(input_summary.get("count"))
    positive_count = _as_positive_int(input_summary.get("positiveCount"))
    negative_count = _as_positive_int(input_summary.get("negativeCount"))
    min_count = _as_positive_int(input_summary.get("minCount"))
    min_per_class = _as_positive_int(input_summary.get("minPerClass"))
    if count <= 0:
        errors.append("validation-report-count-missing")
    if count != positive_count + negative_count:
        errors.append("validation-report-count-inconsistent")
    if min_count > 0 and count < min_count:
        errors.append("validation-report-count-below-minimum")
    if min_per_class > 0 and positive_count < min_per_class:
        errors.append("validation-report-positive-count-below-minimum")
    if min_per_class > 0 and negative_count < min_per_class:
        errors.append("validation-report-negative-count-below-minimum")
    for field in ("rowsHash", "scoresHash"):
        value = str(input_summary.get(field, "") or "")
        if len(value) != 64 or any(char not in "0123456789abcdef" for char in value.lower()):
            errors.append(f"validation-report-{field}-invalid")
    json_metrics = (
        payload.get("jsonAdapter", {}).get("metrics")
        if isinstance(payload.get("jsonAdapter"), dict) and isinstance(payload.get("jsonAdapter", {}).get("metrics"), dict)
        else {}
    )
    onnx_metrics = (
        payload.get("onnxHead", {}).get("metrics")
        if isinstance(payload.get("onnxHead"), dict) and isinstance(payload.get("onnxHead", {}).get("metrics"), dict)
        else {}
    )
    onnx_head = payload.get("onnxHead") if isinstance(payload.get("onnxHead"), dict) else {}
    if str(onnx_head.get("featureVersion", "") or "") != ONNX_TINY_HEAD_FEATURE_VERSION:
        errors.append("validation-report-feature-version-unsupported")
    if _as_positive_int(onnx_head.get("featureCount")) != len(tiny_head_feature_names()):
        errors.append("validation-report-feature-count-invalid")
    training_config = payload.get("trainingConfig") if isinstance(payload.get("trainingConfig"), dict) else {}
    if training_config:
        if str(training_config.get("featureVersion", "") or "") != ONNX_TINY_HEAD_FEATURE_VERSION:
            errors.append("validation-report-training-config-feature-version-unsupported")
        if _as_positive_int(training_config.get("featureCount")) != len(tiny_head_feature_names()):
            errors.append("validation-report-training-config-feature-count-invalid")
    delta = payload.get("delta") if isinstance(payload.get("delta"), dict) else {}
    for metric in ("accuracy", "precision", "recall"):
        if metric not in json_metrics or metric not in onnx_metrics or metric not in delta:
            errors.append(f"validation-report-metric-missing:{metric}")
            continue
        json_value, json_valid = _finite_float(json_metrics.get(metric))
        onnx_value, onnx_valid = _finite_float(onnx_metrics.get(metric))
        delta_value, delta_valid = _finite_float(delta.get(metric))
        if not json_valid or not 0.0 <= json_value <= 1.0:
            errors.append(f"validation-report-metric-invalid:jsonAdapter.{metric}")
        if not onnx_valid or not 0.0 <= onnx_value <= 1.0:
            errors.append(f"validation-report-metric-invalid:onnxHead.{metric}")
        if not delta_valid or not -1.0 <= delta_value <= 1.0:
            errors.append(f"validation-report-delta-invalid:{metric}")
        if not (json_valid and onnx_valid and delta_valid):
            continue
        expected_delta = round(onnx_value - json_value, 6)
        if abs(delta_value - expected_delta) > 0.000001:
            errors.append(f"validation-report-delta-inconsistent:{metric}")
    status = str(payload.get("status", "") or "")
    if status not in {"pass", "regression"}:
        errors.append("validation-report-status-invalid")
    else:
        accuracy_delta = _as_float(delta.get("accuracy"))
        precision_delta = _as_float(delta.get("precision"))
        expected_status = "pass" if accuracy_delta >= -0.02 and precision_delta >= -0.02 else "regression"
        if status != expected_status:
            errors.append("validation-report-status-inconsistent")
    return errors


def _phase5_validation_payload_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expected_hash = str(payload.get("reportHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "reportHash"})
    if not expected_hash:
        errors.append("validation-report-hash-missing")
    elif expected_hash != actual_hash:
        errors.append("validation-report-hash-mismatch")
    errors.extend(_phase5_validation_semantic_errors(payload))
    return errors


def phase5_validation_report(
    rows: Sequence[dict[str, Any]],
    onnx_scores: Sequence[float],
    *,
    baseline_rows: Sequence[dict[str, Any]] | None = None,
    threshold: float = 0.5,
    onnx_threshold: float | None = None,
    threshold_calibration: dict[str, Any] | None = None,
    training_config: dict[str, Any] | None = None,
    min_count: int = 20,
    min_per_class: int = 5,
) -> dict[str, Any]:
    validation = validate_against_json_adapter_baseline(
        rows,
        onnx_scores,
        baseline_rows=baseline_rows,
        threshold=threshold,
        onnx_threshold=onnx_threshold,
        threshold_calibration=threshold_calibration,
        min_count=min_count,
        min_per_class=min_per_class,
    )
    report = {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "scope": VALIDATION_REPORT_SCOPE,
        "notProductionAuthorization": True,
        "trainingConfig": dict(training_config or {}),
        **validation,
    }
    return _attach_report_hash(report)


def write_phase5_validation_report(
    output_path: str | Path,
    rows: Sequence[dict[str, Any]],
    onnx_scores: Sequence[float],
    *,
    baseline_rows: Sequence[dict[str, Any]] | None = None,
    threshold: float = 0.5,
    onnx_threshold: float | None = None,
    threshold_calibration: dict[str, Any] | None = None,
    training_config: dict[str, Any] | None = None,
    min_count: int = 20,
    min_per_class: int = 5,
) -> dict[str, Any]:
    report = phase5_validation_report(
        rows,
        onnx_scores,
        baseline_rows=baseline_rows,
        threshold=threshold,
        onnx_threshold=onnx_threshold,
        threshold_calibration=threshold_calibration,
        training_config=training_config,
        min_count=min_count,
        min_per_class=min_per_class,
    )
    path = Path(output_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return {**report, "reportPath": str(path)}


def verify_phase5_validation_report(path: str | Path) -> dict[str, Any]:
    report_path = Path(path).expanduser()
    if not report_path.is_file():
        return {"verified": False, "path": str(report_path), "errors": ["validation-report-missing"]}
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "path": str(report_path), "errors": ["validation-report-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "path": str(report_path), "errors": [f"validation-report-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "path": str(report_path), "errors": ["validation-report-not-object"]}
    expected_hash = str(payload.get("reportHash", "") or "")
    errors = _phase5_validation_payload_errors(payload)
    return {
        "verified": not errors,
        "path": str(report_path),
        "reportHash": expected_hash,
        "errors": errors,
        "payload": payload,
    }


def _runtime_study_for_gate(source: str | Path | dict[str, Any] | None) -> tuple[dict[str, Any], list[str], str]:
    payload, errors, source_name = _load_json_source(source, "runtime-study")
    if errors:
        return {}, errors, source_name
    study = payload.get("targetRuntimeStudy") if isinstance(payload.get("targetRuntimeStudy"), dict) else payload
    if not isinstance(study, dict):
        return {}, ["runtime-study-not-object"], source_name
    if not isinstance(source, dict) and str(study.get("scope", "") or "") == "phase5-onnx-training-runtime-study":
        verification = verify_combined_target_runtime_study(source_name)
        if verification.get("verified") is not True:
            return study, [f"runtime-study-report-invalid:{error}" for error in verification.get("errors", [])], source_name
    return study, [], source_name


def _runtime_study_decision(
    source: str | Path | dict[str, Any] | None,
    *,
    max_package_bytes: int | None = None,
) -> dict[str, Any]:
    study, errors, source_name = _runtime_study_for_gate(source)
    blockers = list(errors)
    source_errors = [str(item) for item in study.get("sourceErrors", [])] if isinstance(study.get("sourceErrors"), list) else []
    blockers.extend(source_errors)
    raw_targets = study.get("targets")
    targets = raw_targets if isinstance(raw_targets, list) else []
    if raw_targets is not None and not isinstance(raw_targets, list):
        blockers.append("runtime-targets-invalid")
    seen_targets: set[str] = set()
    for index, row in enumerate(targets):
        if not isinstance(row, dict):
            blockers.append(f"runtime-target-row-invalid:{index}")
            continue
        target_name = str(row.get("target", "") or "").strip()
        if not target_name:
            blockers.append(f"runtime-target-missing:{index}")
            continue
        if target_name in seen_targets:
            blockers.append(f"runtime-target-duplicate:{target_name}")
        seen_targets.add(target_name)
        if target_name not in TARGET_PLATFORMS:
            blockers.append(f"runtime-target-unknown:{target_name}")
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    target_results: list[dict[str, Any]] = []
    total_package_bytes = 0
    max_target_package_bytes = 0
    for target in TARGET_PLATFORMS:
        row = by_target.get(target)
        target_blockers: list[str] = []
        if not row:
            target_blockers.append(f"runtime-target-missing:{target}")
            target_results.append({"target": target, "ok": False, "blockers": target_blockers})
            blockers.extend(target_blockers)
            continue
        package_size = _as_positive_int(row.get("packageSizeBytes"))
        total_package_bytes += package_size
        max_target_package_bytes = max(max_target_package_bytes, package_size)
        failure_modes = [str(mode).strip() for mode in row.get("failureModes", []) if str(mode).strip()] if isinstance(row.get("failureModes"), list) else []
        providers = [str(provider).strip() for provider in row.get("providers", []) if str(provider).strip()] if isinstance(row.get("providers"), list) else []
        primary_provider = str(row.get("primaryProvider", "") or "")
        performance_tier = str(row.get("performanceTier", "") or "")
        if row.get("trainingRuntimeAvailable") is not True:
            target_blockers.append(f"training-runtime-unavailable:{target}")
        if row.get("trainingPackageAvailable") is not True:
            target_blockers.append(f"training-package-unavailable:{target}")
        if not isinstance(row.get("gpuAvailable"), bool):
            target_blockers.append(f"gpu-availability-missing:{target}")
        if not providers:
            target_blockers.append(f"providers-missing:{target}")
        if not primary_provider:
            target_blockers.append(f"primary-provider-missing:{target}")
        if not performance_tier:
            target_blockers.append(f"performance-tier-missing:{target}")
        training_duration = _as_positive_int(row.get("trainingDurationMs"))
        if training_duration <= 0:
            target_blockers.append(f"training-duration-missing:{target}")
        if package_size <= 0:
            target_blockers.append(f"package-size-missing:{target}")
        if max_package_bytes is not None and max_package_bytes > 0 and package_size > max_package_bytes:
            target_blockers.append(f"package-size-over-budget:{target}")
        if not failure_modes:
            target_blockers.append(f"failure-modes-missing:{target}")
        if str(row.get("status", "") or "") not in {"pass", "warn"}:
            target_blockers.append(f"runtime-target-not-pass:{target}")
        target_blockers.extend(_runtime_target_timestamp_errors(row, target, "runtime-target-measured-at"))
        raw_row_blockers = row.get("blockers", [])
        if raw_row_blockers and not isinstance(raw_row_blockers, list):
            target_blockers.append(f"runtime-target-blockers-invalid:{target}")
        if isinstance(raw_row_blockers, list):
            for blocker in [str(item).strip() for item in raw_row_blockers if str(item).strip()]:
                target_blockers.append(f"runtime-target-blocker:{target}:{blocker}")
        target_results.append(
            {
                "target": target,
                "ok": not target_blockers,
                "status": row.get("status", ""),
                "trainingRuntimeAvailable": row.get("trainingRuntimeAvailable") is True,
                "gpuAvailable": row.get("gpuAvailable") if isinstance(row.get("gpuAvailable"), bool) else None,
                "providers": providers,
                "primaryProvider": primary_provider,
                "performanceTier": performance_tier,
                "trainingDurationMs": training_duration,
                "measuredAtUnix": row.get("measuredAtUnix"),
                "packageSizeBytes": package_size,
                "trainingPackageAvailable": row.get("trainingPackageAvailable") is True,
                "failureModes": failure_modes,
                "blockers": target_blockers,
            }
        )
        blockers.extend(target_blockers)
    return {
        "ok": not blockers,
        "source": source_name,
        "status": "complete" if not blockers else "blocked",
        "requiredTargets": list(TARGET_PLATFORMS),
        "totalPackageSizeBytes": total_package_bytes,
        "maxTargetPackageSizeBytes": max_target_package_bytes,
        "maxPackageBytes": max_package_bytes,
        "targets": target_results,
        "blockers": blockers,
    }


def _source_evidence_file_record(source: str | Path | dict[str, Any] | None, kind: str) -> dict[str, Any]:
    if isinstance(source, dict):
        return {"kind": kind, "path": "<memory>", "exists": False, "sizeBytes": 0, "sha256": ""}
    if source is None:
        return {"kind": kind, "path": "", "exists": False, "sizeBytes": 0, "sha256": ""}
    candidate = _manifest_path(source) if kind == "artifact-manifest" else Path(source).expanduser()
    exists = candidate.is_file()
    return {
        "kind": kind,
        "path": str(candidate),
        "exists": exists,
        "sizeBytes": candidate.stat().st_size if exists else 0,
        "sha256": _sha256_file(candidate) if exists else "",
    }


def _validation_decision(
    validation_source: str | Path | dict[str, Any] | None,
    *,
    fallback_validation: dict[str, Any] | None = None,
    min_metric_gain: float = 0.01,
) -> dict[str, Any]:
    validation, errors, source_name = _load_json_source(validation_source, "validation")
    if errors and validation_source is None and fallback_validation:
        validation = fallback_validation
        errors = []
        source_name = "artifact-manifest.validation"
    blockers = list(errors)
    if validation_source is not None and not isinstance(validation_source, dict) and validation:
        verification = verify_phase5_validation_report(source_name)
        if verification.get("verified") is not True:
            blockers.extend(f"validation-report-invalid:{error}" for error in verification.get("errors", []))
    elif validation and source_name == "artifact-manifest.validation":
        blockers.extend(f"validation-report-invalid:{error}" for error in _phase5_validation_payload_errors(validation))
    delta = validation.get("delta") if isinstance(validation.get("delta"), dict) else {}
    gains = {
        "accuracy": _as_float(delta.get("accuracy")),
        "precision": _as_float(delta.get("precision")),
        "recall": _as_float(delta.get("recall")),
    }
    if not validation and "validation-missing" not in blockers:
        blockers.append("validation-missing")
    if validation and str(validation.get("status", "") or "") != "pass":
        blockers.append(f"validation-status:{validation.get('status', 'unknown')}")
    best_gain = max(gains.values()) if gains else 0.0
    if validation and best_gain < float(min_metric_gain):
        blockers.append("measurable-gain-missing")
    if validation:
        blockers.extend(_validation_metric_regression_blockers(gains))
    return {
        "ok": not blockers,
        "source": source_name,
        "status": "pass" if not blockers else "blocked",
        "minMetricGain": float(min_metric_gain),
        "bestMetricGain": round(best_gain, 6),
        "delta": gains,
        "blockers": blockers,
        "payload": validation,
    }


def _artifact_decision_summary(verification: dict[str, Any], fallback_path: str = "") -> dict[str, Any]:
    return {
        "verified": bool(verification.get("verified")),
        "manifestPath": str(verification.get("manifestPath", fallback_path) or fallback_path),
        "manifestId": str(verification.get("manifestId", "") or ""),
        "manifestHash": str(verification.get("manifestHash", "") or ""),
        "errors": _string_items(verification.get("errors")),
    }


def _validation_decision_summary(decision: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in decision.items() if key != "payload"}


def _validation_metric_regression_blockers(gains: dict[str, float]) -> list[str]:
    blockers: list[str] = []
    for metric in ("accuracy", "precision", "recall"):
        if gains.get(metric, 0.0) < -0.000001:
            blockers.append(f"measurable-gain-regression:{metric}")
    return blockers


def _source_summary_mismatch_errors(prefix: str, expected: dict[str, Any], actual: dict[str, Any], fields: Sequence[str]) -> list[str]:
    errors: list[str] = []
    for field in fields:
        if expected.get(field) != actual.get(field):
            errors.append(f"{prefix}:{field}")
    return errors


def phase5_go_no_go_report(
    *,
    artifact_manifest_path: str | Path | None = None,
    runtime_study_source: str | Path | dict[str, Any] | None = None,
    validation_source: str | Path | dict[str, Any] | None = None,
    min_metric_gain: float = 0.01,
    max_package_bytes: int | None = None,
) -> dict[str, Any]:
    """Fail-closed Phase 5 decision report for whether ONNX training is justified."""

    blockers: list[str] = []
    if artifact_manifest_path is None:
        artifact = {"verified": False, "errors": ["artifact-manifest-missing"], "payload": {}}
    else:
        artifact = verify_training_artifact_manifest(artifact_manifest_path)
    if not artifact.get("verified"):
        blockers.extend(f"artifact:{error}" for error in artifact.get("errors", ["unknown"]))
    manifest_validation = {}
    payload = artifact.get("payload") if isinstance(artifact.get("payload"), dict) else {}
    if isinstance(payload.get("validation"), dict):
        manifest_validation = payload["validation"]
    runtime = _runtime_study_decision(runtime_study_source, max_package_bytes=max_package_bytes)
    validation = _validation_decision(
        validation_source,
        fallback_validation=manifest_validation,
        min_metric_gain=min_metric_gain,
    )
    evidence_files = [
        _source_evidence_file_record(artifact_manifest_path, "artifact-manifest"),
        _source_evidence_file_record(runtime_study_source, "runtime-study"),
        _source_evidence_file_record(validation_source, "validation"),
    ]
    blockers.extend(f"runtime:{blocker}" for blocker in runtime["blockers"])
    blockers.extend(f"validation:{blocker}" for blocker in validation["blockers"])
    return {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "ok": not blockers,
        "status": "go-for-r-and-d" if not blockers else "no-go",
        "scope": "phase5-onnx-training-r-and-d",
        "notProductionAuthorization": True,
        "requirements": {
            "verifiedTrainingArtifacts": True,
            "completeTargetRuntimeStudy": True,
            "trainingPackageAvailableOnTargets": True,
            "packageImpactUnderstood": True,
            "measurableGainOverJsonAdapter": True,
            "minMetricGain": float(min_metric_gain),
            "maxPackageBytes": max_package_bytes,
        },
        "artifact": {
            "verified": bool(artifact.get("verified")),
            "manifestPath": artifact.get("manifestPath", str(artifact_manifest_path or "")),
            "manifestId": artifact.get("manifestId", ""),
            "manifestHash": artifact.get("manifestHash", ""),
            "errors": artifact.get("errors", []),
        },
        "runtime": runtime,
        "validation": {
            key: value
            for key, value in validation.items()
            if key != "payload"
        },
        "evidenceFiles": evidence_files,
        "blockers": blockers,
        "message": (
            "Phase 5 ONNX training R&D is justified by verified artifacts, complete target runtime/package evidence, and measured validation gain."
            if not blockers
            else "Phase 5 ONNX training remains blocked; keep the JSON/sklearn adapter path as the production learning loop."
        ),
    }


def write_phase5_go_no_go_report(output_path: str | Path, **kwargs: Any) -> dict[str, Any]:
    report = phase5_go_no_go_report(**kwargs)
    path = Path(output_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    report["reportHash"] = _sha256_json({key: value for key, value in report.items() if key != "reportHash"})
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return {**report, "reportPath": str(path)}


def _string_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _phase5_runtime_evidence_errors(runtime: dict[str, Any]) -> list[str]:
    if runtime.get("ok") is not True:
        return []
    errors: list[str] = []
    targets = runtime.get("targets") if isinstance(runtime.get("targets"), list) else []
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    for target in TARGET_PLATFORMS:
        row = by_target.get(target)
        if not row:
            errors.append(f"phase5-runtime-target-missing:{target}")
            continue
        if row.get("trainingRuntimeAvailable") is not True:
            errors.append(f"phase5-runtime-training-runtime-unavailable:{target}")
        if not isinstance(row.get("gpuAvailable"), bool):
            errors.append(f"phase5-runtime-gpu-availability-missing:{target}")
        if not isinstance(row.get("failureModes"), list) or not row.get("failureModes"):
            errors.append(f"phase5-runtime-failure-modes-missing:{target}")
        if not isinstance(row.get("providers"), list) or not row.get("providers"):
            errors.append(f"phase5-runtime-providers-missing:{target}")
        if not str(row.get("primaryProvider", "") or ""):
            errors.append(f"phase5-runtime-primary-provider-missing:{target}")
        if not str(row.get("performanceTier", "") or ""):
            errors.append(f"phase5-runtime-performance-tier-missing:{target}")
        errors.extend(_runtime_target_timestamp_errors(row, target, "phase5-runtime-measured-at"))
    return errors


def _phase5_semantic_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("phase5-decision-report-schema-version-unsupported")
    if payload.get("notProductionAuthorization") is not True:
        errors.append("phase5-decision-report-authorization-scope-invalid")
    errors.extend(_unix_timestamp_errors(payload, "generatedAtUnix", "phase5-decision-report-generated-at"))
    if not isinstance(payload.get("ok"), bool):
        errors.append("phase5-decision-report-ok-not-bool")
    ok = payload.get("ok") is True
    expected_status = "go-for-r-and-d" if ok else "no-go"
    if str(payload.get("status", "") or "") != expected_status:
        errors.append("phase5-decision-report-status-inconsistent")
    blockers = _string_items(payload.get("blockers"))
    if ok and blockers:
        errors.append("phase5-decision-report-ok-with-blockers")
    if not ok and not blockers:
        errors.append("phase5-decision-report-blockers-missing")
    artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    validation = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}
    artifact_ok = artifact.get("verified") is True and not _string_items(artifact.get("errors"))
    runtime_evidence_errors = _phase5_runtime_evidence_errors(runtime)
    errors.extend(runtime_evidence_errors)
    runtime_ok = runtime.get("ok") is True and str(runtime.get("status", "") or "") == "complete" and not _string_items(runtime.get("blockers")) and not runtime_evidence_errors
    min_gain = _as_float(validation.get("minMetricGain")) or 0.01
    best_gain = _as_float(validation.get("bestMetricGain"))
    delta = validation.get("delta") if isinstance(validation.get("delta"), dict) else {}
    validation_regression_blockers = _validation_metric_regression_blockers(
        {
            "accuracy": _as_float(delta.get("accuracy")),
            "precision": _as_float(delta.get("precision")),
            "recall": _as_float(delta.get("recall")),
        }
    )
    if validation.get("ok") is True and not _string_items(validation.get("blockers")):
        errors.extend(f"phase5-validation-{blocker}" for blocker in validation_regression_blockers)
    validation_ok = (
        validation.get("ok") is True
        and str(validation.get("status", "") or "") == "pass"
        and not _string_items(validation.get("blockers"))
        and best_gain >= min_gain
        and not validation_regression_blockers
    )
    if ok != (artifact_ok and runtime_ok and validation_ok):
        errors.append("phase5-decision-report-ok-inconsistent")
    return errors


def verify_phase5_go_no_go_report(path: str | Path) -> dict[str, Any]:
    report_path = Path(path).expanduser()
    if not report_path.is_file():
        return {"verified": False, "path": str(report_path), "errors": ["phase5-decision-report-missing"]}
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "path": str(report_path), "errors": ["phase5-decision-report-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "path": str(report_path), "errors": [f"phase5-decision-report-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "path": str(report_path), "errors": ["phase5-decision-report-not-object"]}
    expected_hash = str(payload.get("reportHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "reportHash"})
    errors: list[str] = []
    if not expected_hash:
        errors.append("phase5-decision-report-hash-missing")
    elif expected_hash != actual_hash:
        errors.append("phase5-decision-report-hash-mismatch")
    if str(payload.get("scope", "") or "") != "phase5-onnx-training-r-and-d":
        errors.append("phase5-decision-report-scope-invalid")
    errors.extend(_phase5_semantic_errors(payload))
    evidence_checks = []
    evidence_records = payload.get("evidenceFiles")
    if not isinstance(evidence_records, list) or not evidence_records:
        errors.append("phase5-decision-report-evidence-missing")
        evidence_records = []
    artifact_source_verification: dict[str, Any] | None = None
    requirements = payload.get("requirements") if isinstance(payload.get("requirements"), dict) else {}
    max_package_bytes = requirements.get("maxPackageBytes")
    min_metric_gain = _as_float(requirements.get("minMetricGain")) or 0.01
    for record in evidence_records:
        if not isinstance(record, dict):
            errors.append("phase5-evidence-record-invalid")
            continue
        kind = str(record.get("kind", "evidence") or "evidence")
        raw_path = str(record.get("path", "") or "")
        if raw_path == "<memory>":
            current = {"kind": kind, "path": "<memory>", "exists": False, "sizeBytes": 0, "sha256": ""}
        else:
            current = _source_evidence_file_record(raw_path, kind)
        ok = (
            bool(current["exists"]) == bool(record.get("exists"))
            and int(current["sizeBytes"]) == _as_positive_int(record.get("sizeBytes"))
            and str(current["sha256"]) == str(record.get("sha256", "") or "")
        )
        if not ok:
            errors.append(f"phase5-evidence-file-mismatch:{kind}")
        if raw_path not in {"", "<memory>"} and current["exists"]:
            if kind == "artifact-manifest":
                artifact_source_verification = verify_training_artifact_manifest(raw_path)
                source_artifact = _artifact_decision_summary(artifact_source_verification, raw_path)
                decision_artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
                errors.extend(
                    _source_summary_mismatch_errors(
                        "phase5-artifact-source-mismatch",
                        source_artifact,
                        decision_artifact,
                        ("verified", "manifestPath", "manifestId", "manifestHash", "errors"),
                    )
                )
            elif kind == "runtime-study":
                source_runtime = _runtime_study_decision(raw_path, max_package_bytes=max_package_bytes if isinstance(max_package_bytes, int) else None)
                decision_runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
                errors.extend(
                    _source_summary_mismatch_errors(
                        "phase5-runtime-source-mismatch",
                        source_runtime,
                        decision_runtime,
                        (
                            "ok",
                            "source",
                            "status",
                            "requiredTargets",
                            "totalPackageSizeBytes",
                            "maxTargetPackageSizeBytes",
                            "maxPackageBytes",
                            "targets",
                            "blockers",
                        ),
                    )
                )
            elif kind == "validation":
                source_validation = _validation_decision_summary(
                    _validation_decision(raw_path, min_metric_gain=min_metric_gain)
                )
                decision_validation = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}
                errors.extend(
                    _source_summary_mismatch_errors(
                        "phase5-validation-source-mismatch",
                        source_validation,
                        decision_validation,
                        ("ok", "source", "status", "minMetricGain", "bestMetricGain", "delta", "blockers"),
                    )
                )
        evidence_checks.append({"expected": record, "current": current, "ok": ok})
    if payload.get("ok") is True:
        validation = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}
        validation_from_manifest = str(validation.get("source", "") or "") == "artifact-manifest.validation"
        for record in evidence_records:
            if not isinstance(record, dict):
                continue
            kind = str(record.get("kind", "evidence") or "evidence")
            if kind == "validation" and validation_from_manifest:
                continue
            if kind in {"artifact-manifest", "runtime-study", "validation"} and (
                str(record.get("path", "") or "") in {"", "<memory>"} or record.get("exists") is not True
            ):
                errors.append(f"phase5-evidence-file-required:{kind}")
            if kind == "runtime-study" and str(record.get("path", "") or "") not in {"", "<memory>"} and record.get("exists") is True:
                runtime_verification = verify_combined_target_runtime_study(str(record.get("path", "") or ""))
                if runtime_verification.get("verified") is not True:
                    errors.extend(
                        f"phase5-runtime-study-invalid:{error}"
                        for error in runtime_verification.get("errors", [])
                    )
            if kind == "validation" and str(record.get("path", "") or "") not in {"", "<memory>"} and record.get("exists") is True and not validation_from_manifest:
                validation_verification = verify_phase5_validation_report(str(record.get("path", "") or ""))
                if validation_verification.get("verified") is not True:
                    errors.extend(
                        f"phase5-validation-invalid:{error}"
                        for error in validation_verification.get("errors", [])
                    )
                else:
                    validation_payload = validation_verification.get("payload") if isinstance(validation_verification.get("payload"), dict) else {}
                    source_delta = validation_payload.get("delta") if isinstance(validation_payload.get("delta"), dict) else {}
                    decision_delta = validation.get("delta") if isinstance(validation.get("delta"), dict) else {}
                    source_best_gain = max((_as_float(source_delta.get(metric)) for metric in ("accuracy", "precision", "recall")), default=0.0)
                    if str(validation_payload.get("status", "") or "") != str(validation.get("status", "") or ""):
                        errors.append("phase5-validation-report-mismatch:status")
                    if abs(source_best_gain - _as_float(validation.get("bestMetricGain"))) > 0.000001:
                        errors.append("phase5-validation-report-mismatch:bestMetricGain")
                    for metric in ("accuracy", "precision", "recall"):
                        if abs(_as_float(source_delta.get(metric)) - _as_float(decision_delta.get(metric))) > 0.000001:
                            errors.append(f"phase5-validation-report-mismatch:{metric}")
        if validation_from_manifest:
            if artifact_source_verification is None:
                artifact_record = next(
                    (
                        item
                        for item in evidence_records
                        if isinstance(item, dict)
                        and str(item.get("kind", "") or "") == "artifact-manifest"
                        and str(item.get("path", "") or "") not in {"", "<memory>"}
                    ),
                    None,
                )
                if artifact_record is not None:
                    artifact_source_verification = verify_training_artifact_manifest(str(artifact_record.get("path", "") or ""))
            manifest_payload = (
                artifact_source_verification.get("payload")
                if isinstance(artifact_source_verification, dict) and isinstance(artifact_source_verification.get("payload"), dict)
                else {}
            )
            manifest_validation = manifest_payload.get("validation") if isinstance(manifest_payload.get("validation"), dict) else {}
            source_validation = _validation_decision_summary(
                _validation_decision(
                    None,
                    fallback_validation=manifest_validation,
                    min_metric_gain=min_metric_gain,
                )
            )
            errors.extend(
                _source_summary_mismatch_errors(
                    "phase5-validation-source-mismatch",
                    source_validation,
                    validation,
                    ("ok", "source", "status", "minMetricGain", "bestMetricGain", "delta", "blockers"),
                )
            )
    return {
        "verified": not errors,
        "path": str(report_path),
        "reportHash": expected_hash,
        "errors": errors,
        "evidence": evidence_checks,
        "payload": payload,
    }


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_dir(path: Path) -> str:
    digest = hashlib.sha256()
    for item in sorted(path.rglob("*")):
        if not item.is_file():
            continue
        relative = item.relative_to(path).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(_sha256_file(item).encode("ascii"))
        digest.update(b"\0")
    return digest.hexdigest()


def _sha256_json(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def _path_size(path: Path) -> int:
    if path.is_dir():
        return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())
    return path.stat().st_size if path.exists() else 0


def _artifact_record(path: Path, kind: str) -> dict[str, Any]:
    exists = path.exists()
    sha256 = ""
    if exists:
        sha256 = _sha256_dir(path) if path.is_dir() else _sha256_file(path)
    return {
        "kind": kind,
        "path": str(path),
        "exists": exists,
        "isDirectory": path.is_dir() if exists else False,
        "sizeBytes": _path_size(path) if exists else 0,
        "sha256": sha256,
    }


def _manifest_artifact_record(base: Path, path: Path, kind: str) -> dict[str, Any]:
    record = _artifact_record(path, kind)
    try:
        record["path"] = path.relative_to(base).as_posix()
    except ValueError:
        record["path"] = str(path)
    return record


def _resolve_manifest_artifact_path(base: Path, raw_path: str) -> tuple[Path, str]:
    if not raw_path:
        return base, "artifact-path-missing"
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = base / candidate
    base_resolved = base.resolve(strict=False)
    candidate_resolved = candidate.resolve(strict=False)
    try:
        candidate_resolved.relative_to(base_resolved)
    except ValueError:
        return candidate, "artifact-path-outside-bundle"
    return candidate, ""


def _expected_artifact_paths(output_dir: Path, prefix: str) -> dict[str, Path]:
    clean_prefix = str(prefix or "")
    return {kind: output_dir / f"{clean_prefix}{suffix}" for kind, suffix in TRAINING_ARTIFACT_SUFFIXES.items()}


def _normalize_onnx_ir_version(path: Path, max_ir_version: int = 10) -> bool:
    if not path.is_file() or path.suffix != ".onnx":
        return False
    try:
        import onnx

        model = onnx.load(path)
    except Exception:
        return False
    if int(model.ir_version) <= max_ir_version:
        return False
    model.ir_version = max_ir_version
    onnx.save(model, path)
    return True


def _missing_training_modules() -> list[str]:
    installed = {name: module_available(name) for name in REQUIRED_MODULES}
    return [name for name, ok in installed.items() if not ok]


def _load_training_artifacts_module() -> Any:
    from onnxruntime.training import artifacts

    return artifacts


def _load_training_api_module() -> Any:
    from onnxruntime.training import api

    return api


def _manifest_path(path: str | Path) -> Path:
    candidate = Path(path).expanduser()
    return candidate / MANIFEST_FILENAME if candidate.is_dir() or candidate.suffix == "" else candidate


def create_training_artifact_manifest(
    output_dir: str | Path,
    *,
    prefix: str = "tiny_head_",
    validation: dict[str, Any] | None = None,
    parent_manifest_id: str = "",
) -> dict[str, Any]:
    """Write a tamper-evident manifest for one experimental artifact bundle."""

    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    paths = {
        "forwardModel": output / f"{prefix}forward.onnx",
        **_expected_artifact_paths(output, prefix),
        "inferenceModel": output / f"{prefix}inference.onnx",
    }
    records = [_manifest_artifact_record(output, path, kind) for kind, path in paths.items() if path.exists()]
    required = list(TRAINING_REQUIRED_ARTIFACT_KINDS)
    missing_required = [kind for kind in required if not paths[kind].exists()]
    body = {
        "schemaVersion": 1,
        "manifestId": f"ortlearn_{uuid.uuid4().hex[:12]}",
        "artifactType": TRAINING_ARTIFACT_TYPE,
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "prefix": prefix,
        "status": "complete" if not missing_required else "incomplete",
        "requiredKinds": required,
        "missingRequiredKinds": missing_required,
        "parentManifestId": str(parent_manifest_id or ""),
        "createdAtUnix": round(time.time(), 3),
        "platform": current_platform_key(),
        "dependencyMatrix": dependency_feasibility_matrix(),
        "validation": validation or {},
        "artifacts": records,
    }
    body["manifestHash"] = _sha256_json({key: value for key, value in body.items() if key != "manifestHash"})
    manifest_path = output / MANIFEST_FILENAME
    manifest_path.write_text(json.dumps(body, indent=2, sort_keys=True), encoding="utf-8")
    return {**body, "manifestPath": str(manifest_path)}


def verify_training_artifact_manifest(path: str | Path) -> dict[str, Any]:
    """Verify manifest hash and every recorded artifact hash/size."""

    manifest_path = _manifest_path(path)
    if not manifest_path.is_file():
        return {"verified": False, "manifestPath": str(manifest_path), "errors": ["manifest-missing"]}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "manifestPath": str(manifest_path), "errors": ["manifest-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "manifestPath": str(manifest_path), "errors": [f"manifest-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "manifestPath": str(manifest_path), "errors": ["manifest-not-object"]}
    expected_hash = str(payload.get("manifestHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "manifestHash"})
    errors: list[str] = []
    if expected_hash != actual_hash:
        errors.append("manifest-hash-mismatch")
    if payload.get("schemaVersion") != 1:
        errors.append("manifest-schema-version-unsupported")
    if str(payload.get("artifactType", "") or "") != TRAINING_ARTIFACT_TYPE:
        errors.append("manifest-artifact-type-invalid")
    if str(payload.get("featureFlag", "") or "") != CANONICAL_FEATURE_FLAG:
        errors.append("manifest-feature-flag-invalid")
    errors.extend(_unix_timestamp_errors(payload, "createdAtUnix", "manifest-created-at"))
    required_kinds = [str(kind) for kind in payload.get("requiredKinds", [])] if isinstance(payload.get("requiredKinds"), list) else []
    if required_kinds != TRAINING_REQUIRED_ARTIFACT_KINDS:
        errors.append("manifest-required-kinds-invalid")
    base = manifest_path.parent
    artifact_rows: list[dict[str, Any]] = []
    for record in payload.get("artifacts", []):
        if not isinstance(record, dict):
            errors.append("artifact-record-invalid")
            continue
        artifact_path, path_error = _resolve_manifest_artifact_path(base, str(record.get("path", "") or ""))
        if path_error:
            errors.append(f"{path_error}:{record.get('kind', 'unknown')}")
            artifact_rows.append({"expected": record, "current": {}, "ok": False})
            continue
        current = _artifact_record(artifact_path, str(record.get("kind", "") or "unknown"))
        ok = bool(current["exists"]) and int(current["sizeBytes"]) == int(record.get("sizeBytes", -1) or -1) and str(current["sha256"]) == str(record.get("sha256", "") or "")
        if not ok:
            errors.append(f"artifact-mismatch:{record.get('kind', 'unknown')}")
        artifact_rows.append({"expected": record, "current": current, "ok": ok})
    recorded_kinds = [str(row.get("kind", "") or "") for row in payload.get("artifacts", []) if isinstance(row, dict)]
    if len(recorded_kinds) != len(set(recorded_kinds)):
        errors.append("manifest-duplicate-artifact-kind")
    missing_required = [kind for kind in TRAINING_REQUIRED_ARTIFACT_KINDS if kind not in set(recorded_kinds)]
    reported_missing = [str(kind) for kind in payload.get("missingRequiredKinds", [])] if isinstance(payload.get("missingRequiredKinds"), list) else []
    if reported_missing != missing_required:
        errors.append("manifest-missing-required-kinds-inconsistent")
    for kind in missing_required:
        errors.append(f"required-artifact-missing:{kind}")
    status = str(payload.get("status", "") or "")
    if status != "complete":
        errors.append(f"manifest-status:{status or 'unknown'}")
    return {
        "verified": not errors,
        "manifestPath": str(manifest_path),
        "manifestId": str(payload.get("manifestId", "") or ""),
        "manifestHash": expected_hash,
        "errors": errors,
        "artifacts": artifact_rows,
        "payload": payload,
    }


def _pointer_manifest_errors(prefix: str, entry: dict[str, Any], verification: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    expected_id = str(entry.get("manifestId", "") or "")
    expected_hash = str(entry.get("manifestHash", "") or "")
    if expected_id and expected_id != str(verification.get("manifestId", "") or ""):
        errors.append(f"{prefix}-manifest-id-mismatch")
    if expected_hash and expected_hash != str(verification.get("manifestHash", "") or ""):
        errors.append(f"{prefix}-manifest-hash-mismatch")
    return errors


def verify_active_training_pointer(registry_dir: str | Path) -> dict[str, Any]:
    pointer_path = Path(registry_dir).expanduser() / ACTIVE_POINTER_FILENAME
    if not pointer_path.is_file():
        return {"verified": False, "pointerPath": str(pointer_path), "errors": ["pointer-missing"]}
    try:
        payload = json.loads(pointer_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "pointerPath": str(pointer_path), "errors": ["pointer-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "pointerPath": str(pointer_path), "errors": [f"pointer-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "pointerPath": str(pointer_path), "errors": ["pointer-not-object"]}
    expected_hash = str(payload.get("pointerHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "pointerHash"})
    errors: list[str] = []
    if expected_hash != actual_hash:
        errors.append("pointer-hash-mismatch")
    active = payload.get("active") if isinstance(payload.get("active"), dict) else {}
    if active:
        errors.extend(_unix_timestamp_errors(active, "promotedAtUnix", "active-promoted-at"))
        active_verification = verify_training_artifact_manifest(str(active.get("manifestPath", "")))
        if not active_verification["verified"]:
            errors.append("active-manifest-invalid")
        errors.extend(_pointer_manifest_errors("active", active, active_verification))
    else:
        active_verification = {"verified": False, "errors": ["active-missing"]}
        errors.append("active-missing")
    previous = payload.get("previous") if isinstance(payload.get("previous"), dict) else {}
    if previous:
        errors.extend(_unix_timestamp_errors(previous, "promotedAtUnix", "previous-promoted-at"))
    return {
        "verified": not errors,
        "pointerPath": str(pointer_path),
        "errors": errors,
        "activeVerification": active_verification,
        "payload": payload,
    }


def promote_training_artifact_bundle(bundle_dir: str | Path, registry_dir: str | Path) -> dict[str, Any]:
    """Promote a verified experimental bundle by updating a rollbackable pointer."""

    verification = verify_training_artifact_manifest(bundle_dir)
    if not verification["verified"]:
        raise ValueError(f"Cannot promote invalid training artifact bundle: {', '.join(verification['errors'])}")
    registry = Path(registry_dir).expanduser()
    registry.mkdir(parents=True, exist_ok=True)
    pointer_path = registry / ACTIVE_POINTER_FILENAME
    previous: dict[str, Any] = {}
    if pointer_path.exists():
        pointer_verification = verify_active_training_pointer(registry)
        if not pointer_verification["verified"]:
            raise ValueError(f"Cannot promote with invalid active pointer: {', '.join(pointer_verification['errors'])}")
        previous_payload = pointer_verification["payload"]
        previous = previous_payload.get("active") if isinstance(previous_payload.get("active"), dict) else {}
    active = {
        "manifestId": verification["manifestId"],
        "manifestHash": verification["manifestHash"],
        "manifestPath": verification["manifestPath"],
        "promotedAtUnix": round(time.time(), 3),
    }
    pointer = {
        "schemaVersion": 1,
        "active": active,
        "previous": previous,
    }
    pointer["pointerHash"] = _sha256_json({key: value for key, value in pointer.items() if key != "pointerHash"})
    pointer_path.write_text(json.dumps(pointer, indent=2, sort_keys=True), encoding="utf-8")
    return {"promoted": True, "pointerPath": str(pointer_path), "active": active, "previous": previous}


def rollback_training_artifact_bundle(registry_dir: str | Path) -> dict[str, Any]:
    """Rollback the experimental active pointer to the previous verified bundle."""

    pointer_path = Path(registry_dir).expanduser() / ACTIVE_POINTER_FILENAME
    if not pointer_path.is_file():
        raise ValueError("No active experimental training artifact pointer exists.")
    pointer_verification = verify_active_training_pointer(pointer_path.parent)
    if not pointer_verification["verified"]:
        raise ValueError(f"Active training artifact pointer failed verification: {', '.join(pointer_verification['errors'])}")
    pointer = pointer_verification["payload"]
    current = pointer.get("active") if isinstance(pointer.get("active"), dict) else {}
    previous = pointer.get("previous") if isinstance(pointer.get("previous"), dict) else {}
    if not previous:
        raise ValueError("No previous experimental training artifact bundle is available for rollback.")
    verification = verify_training_artifact_manifest(str(previous.get("manifestPath", "")))
    if not verification["verified"]:
        raise ValueError(f"Previous training artifact bundle failed verification: {', '.join(verification['errors'])}")
    previous_errors = _pointer_manifest_errors("previous", previous, verification)
    if previous_errors:
        raise ValueError(f"Previous training artifact bundle does not match pointer: {', '.join(previous_errors)}")
    next_pointer = {
        "schemaVersion": 1,
        "active": {
            "manifestId": verification["manifestId"],
            "manifestHash": verification["manifestHash"],
            "manifestPath": verification["manifestPath"],
            "promotedAtUnix": round(time.time(), 3),
        },
        "previous": current,
    }
    next_pointer["pointerHash"] = _sha256_json({key: value for key, value in next_pointer.items() if key != "pointerHash"})
    pointer_path.write_text(json.dumps(next_pointer, indent=2, sort_keys=True), encoding="utf-8")
    return {"rolledBack": True, "pointerPath": str(pointer_path), "active": next_pointer["active"], "previous": current}


def _tiny_head_architecture(architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE, hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS) -> tuple[str, int]:
    name = str(architecture or ROW_TRAINING_DEFAULT_ARCHITECTURE).strip().casefold()
    if name not in ROW_TRAINING_ARCHITECTURES:
        raise ValueError(f"Unsupported tiny-head architecture: {architecture}")
    hidden = max(0, int(hidden_units))
    if name == "linear":
        return name, 0
    if hidden < 1:
        raise ValueError("MLP tiny-head architecture requires hidden_units >= 1.")
    return name, hidden


def _tiny_head_trainable_params(architecture: str, hidden_units: int) -> list[str]:
    if architecture == "mlp":
        return ["hidden_weight", "hidden_bias", "output_weight", "output_bias"]
    return ["weight", "bias"]


def _tiny_head_feature_preprocessing_mode(mode: str = ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING) -> str:
    normalized = str(mode or ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING).strip().casefold()
    if normalized not in ROW_TRAINING_FEATURE_PREPROCESSING:
        raise ValueError(f"Unsupported tiny-head feature preprocessing: {mode}")
    return normalized


def _feature_standardization_metadata(features: Sequence[Sequence[float]], mode: str = ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING) -> dict[str, Any]:
    """Return deterministic preprocessing metadata derived only from training rows."""

    mode = _tiny_head_feature_preprocessing_mode(mode)
    rows = [[float(value) for value in row] for row in features]
    if not rows:
        raise ValueError("features must not be empty.")
    feature_count = len(rows[0])
    if any(len(row) != feature_count for row in rows):
        raise ValueError("feature dimensions differ.")
    if mode == "none":
        return {
            "mode": "none",
            "featureCount": feature_count,
            "means": [0.0 for _ in range(feature_count)],
            "scales": [1.0 for _ in range(feature_count)],
        }
    import numpy as np

    x = np.asarray(rows, dtype=np.float64)
    means = x.mean(axis=0)
    scales = x.std(axis=0)
    scales[scales < 1e-9] = 1.0
    return {
        "mode": "standardize",
        "featureCount": feature_count,
        "means": [round(float(value), 12) for value in means.tolist()],
        "scales": [round(float(value), 12) for value in scales.tolist()],
    }


def _feature_preprocessing_arrays(
    *,
    feature_count: int,
    feature_preprocessing: dict[str, Any] | None = None,
) -> tuple[str, list[float], list[float]]:
    metadata = feature_preprocessing if isinstance(feature_preprocessing, dict) else {}
    mode = _tiny_head_feature_preprocessing_mode(str(metadata.get("mode", "none") or "none"))
    if mode == "none":
        return mode, [], []
    means = [float(value) for value in metadata.get("means", [])] if isinstance(metadata.get("means"), list) else []
    scales = [float(value) for value in metadata.get("scales", [])] if isinstance(metadata.get("scales"), list) else []
    if len(means) != feature_count or len(scales) != feature_count:
        raise ValueError("feature preprocessing dimensions do not match feature_count.")
    scales = [value if abs(value) >= 1e-9 else 1.0 for value in scales]
    return mode, means, scales


def build_tiny_scoring_head_model(
    feature_count: int = 19,
    class_count: int = 2,
    *,
    architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE,
    hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS,
    feature_preprocessing: dict[str, Any] | None = None,
) -> Any:
    """Build a forward-only ONNX scoring head for Phase 5 experiments."""

    if feature_count < 1:
        raise ValueError("feature_count must be positive.")
    if class_count < 2:
        raise ValueError("class_count must be at least 2.")
    architecture, hidden_units = _tiny_head_architecture(architecture, hidden_units)
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    preprocessing_mode, feature_means, feature_scales = _feature_preprocessing_arrays(
        feature_count=feature_count,
        feature_preprocessing=feature_preprocessing,
    )
    input_name = "features"
    preprocessing_nodes = []
    preprocessing_initializers = []
    if preprocessing_mode == "standardize":
        input_name = "standardized_features"
        preprocessing_nodes = [
            helper.make_node("Sub", ["features", "feature_mean"], ["centered_features"], name="feature_center"),
            helper.make_node("Div", ["centered_features", "feature_scale"], [input_name], name="feature_standardize"),
        ]
        preprocessing_initializers = [
            numpy_helper.from_array(np.asarray(feature_means, dtype=np.float32), name="feature_mean"),
            numpy_helper.from_array(np.asarray(feature_scales, dtype=np.float32), name="feature_scale"),
        ]
    if architecture == "mlp":
        rng = np.random.default_rng(20260619)
        hidden_weight = rng.normal(0.0, 0.05, size=(feature_count, hidden_units)).astype(np.float32)
        hidden_bias = np.zeros((hidden_units,), dtype=np.float32)
        output_weight = rng.normal(0.0, 0.05, size=(hidden_units, class_count)).astype(np.float32)
        output_bias = np.zeros((class_count,), dtype=np.float32)
        nodes = [
            *preprocessing_nodes,
            helper.make_node("MatMul", [input_name, "hidden_weight"], ["hidden_matmul_out"], name="hidden_matmul"),
            helper.make_node("Add", ["hidden_matmul_out", "hidden_bias"], ["hidden_linear_out"], name="hidden_bias"),
            helper.make_node("Relu", ["hidden_linear_out"], ["hidden_relu_out"], name="hidden_relu"),
            helper.make_node("MatMul", ["hidden_relu_out", "output_weight"], ["output_matmul_out"], name="output_matmul"),
            helper.make_node("Add", ["output_matmul_out", "output_bias"], ["logits"], name="output_bias"),
        ]
        initializers = [
            *preprocessing_initializers,
            numpy_helper.from_array(hidden_weight, name="hidden_weight"),
            numpy_helper.from_array(hidden_bias, name="hidden_bias"),
            numpy_helper.from_array(output_weight, name="output_weight"),
            numpy_helper.from_array(output_bias, name="output_bias"),
        ]
    else:
        weight = np.zeros((feature_count, class_count), dtype=np.float32)
        bias = np.zeros((class_count,), dtype=np.float32)
        nodes = [
            *preprocessing_nodes,
            helper.make_node("MatMul", [input_name, "weight"], ["matmul_out"], name="linear_matmul"),
            helper.make_node("Add", ["matmul_out", "bias"], ["logits"], name="linear_bias"),
        ]
        initializers = [
            *preprocessing_initializers,
            numpy_helper.from_array(weight, name="weight"),
            numpy_helper.from_array(bias, name="bias"),
        ]
    model = helper.make_model(
        helper.make_graph(
            nodes,
            "vintrace_tiny_scoring_head",
            [
                helper.make_tensor_value_info("features", TensorProto.FLOAT, ["batch", feature_count]),
            ],
            [
                helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", class_count]),
            ],
            initializers,
        ),
        producer_name="vintrace-phase5-rd",
        opset_imports=[helper.make_operatorsetid("", 13)],
    )
    model.ir_version = min(int(model.ir_version), 10)
    onnx.checker.check_model(model)
    return model


def save_tiny_scoring_head_model(
    path: str | Path,
    feature_count: int = 19,
    class_count: int = 2,
    *,
    architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE,
    hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS,
    feature_preprocessing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import onnx

    output = Path(path).expanduser()
    output.parent.mkdir(parents=True, exist_ok=True)
    model = build_tiny_scoring_head_model(
        feature_count=feature_count,
        class_count=class_count,
        architecture=architecture,
        hidden_units=hidden_units,
        feature_preprocessing=feature_preprocessing,
    )
    onnx.save(model, output)
    return _artifact_record(output, "forwardModel")


def generate_tiny_scoring_head_artifacts(
    output_dir: str | Path,
    *,
    feature_count: int = 19,
    class_count: int = 2,
    architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE,
    hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS,
    feature_preprocessing: dict[str, Any] | None = None,
    prefix: str = "tiny_head_",
    artifact_module: Any | None = None,
) -> dict[str, Any]:
    """Generate ORT training artifacts for a tiny scoring head.

    `artifact_module` is injectable so tests can validate the integration when
    `onnxruntime.training` is not installed locally. Production callers should
    leave it unset.
    """

    architecture, hidden_units = _tiny_head_architecture(architecture, hidden_units)
    preprocessing_mode, _feature_means, _feature_scales = _feature_preprocessing_arrays(
        feature_count=feature_count,
        feature_preprocessing=feature_preprocessing,
    )
    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    matrix = dependency_feasibility_matrix()
    if not enabled():
        return {
            "status": "disabled",
            "enabled": False,
            "featureFlag": CANONICAL_FEATURE_FLAG,
            "outputDir": str(output),
            "architecture": architecture,
            "hiddenUnits": hidden_units,
            "featurePreprocessing": {"mode": preprocessing_mode},
            "artifacts": [],
            "matrix": matrix,
            "reason": f"Set {CANONICAL_FEATURE_FLAG}=1 to generate experimental ONNX training artifacts.",
        }
    if artifact_module is None:
        missing = _missing_training_modules()
        if missing:
            return {
                "status": "unavailable",
                "enabled": True,
                "featureFlag": CANONICAL_FEATURE_FLAG,
                "outputDir": str(output),
                "architecture": architecture,
                "hiddenUnits": hidden_units,
                "featurePreprocessing": {"mode": preprocessing_mode},
                "artifacts": [],
                "matrix": matrix,
                "blockers": [f"{name} is not importable" for name in missing],
                "reason": "Experimental ONNX training artifacts cannot be generated on this host yet.",
            }
        artifact_module = _load_training_artifacts_module()
    import onnx

    started = time.perf_counter()
    forward_path = output / f"{prefix}forward.onnx"
    forward = build_tiny_scoring_head_model(
        feature_count=feature_count,
        class_count=class_count,
        architecture=architecture,
        hidden_units=hidden_units,
        feature_preprocessing=feature_preprocessing,
    )
    onnx.save(forward, forward_path)
    trainable_params = _tiny_head_trainable_params(architecture, hidden_units)
    artifact_module.generate_artifacts(
        forward,
        requires_grad=trainable_params,
        frozen_params=[],
        loss=artifact_module.LossType.CrossEntropyLoss,
        optimizer=artifact_module.OptimType.AdamW,
        artifact_directory=output,
        prefix=prefix,
        loss_input_names=["logits"],
    )
    paths = {"forwardModel": forward_path, **_expected_artifact_paths(output, prefix)}
    normalized = [kind for kind, path in paths.items() if _normalize_onnx_ir_version(path)]
    records = [_artifact_record(path, kind) for kind, path in paths.items()]
    missing_records = [record for record in records if not record["exists"]]
    status = "complete" if not missing_records else "incomplete"
    manifest = create_training_artifact_manifest(output, prefix=prefix) if status == "complete" else {}
    return {
        "status": status,
        "enabled": True,
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "outputDir": str(output),
        "prefix": prefix,
        "featureCount": feature_count,
        "classCount": class_count,
        "architecture": architecture,
        "hiddenUnits": hidden_units,
        "featurePreprocessing": dict(feature_preprocessing or {"mode": preprocessing_mode}),
        "trainableParams": trainable_params,
        "durationMs": round((time.perf_counter() - started) * 1000, 3),
        "artifacts": records,
        "normalizedIrKinds": normalized,
        "manifest": manifest,
        "missingArtifacts": missing_records,
        "matrix": matrix,
        "reason": "Generated experimental ORT training artifacts." if status == "complete" else "ORT returned without all expected artifacts.",
    }


def run_tiny_head_training_job(
    artifact_dir: str | Path,
    features: Sequence[Sequence[float]],
    labels: Sequence[int | bool],
    *,
    epochs: int = 3,
    prefix: str = "tiny_head_",
    learning_rate: float = 0.01,
    training_api: Any | None = None,
) -> dict[str, Any]:
    """Run a small local ORT training job and export an inference ONNX model."""

    output = Path(artifact_dir).expanduser()
    matrix = dependency_feasibility_matrix()
    if not enabled():
        return {
            "status": "disabled",
            "enabled": False,
            "featureFlag": CANONICAL_FEATURE_FLAG,
            "outputDir": str(output),
            "artifacts": [],
            "matrix": matrix,
            "reason": f"Set {CANONICAL_FEATURE_FLAG}=1 to run experimental ONNX training.",
        }
    if training_api is None:
        missing = _missing_training_modules()
        if missing:
            return {
                "status": "unavailable",
                "enabled": True,
                "featureFlag": CANONICAL_FEATURE_FLAG,
                "outputDir": str(output),
                "artifacts": [],
                "matrix": matrix,
                "blockers": [f"{name} is not importable" for name in missing],
                "reason": "Experimental ONNX training cannot run on this host yet.",
            }
        training_api = _load_training_api_module()
    import numpy as np

    x = np.asarray(list(features), dtype=np.float32)
    y = np.asarray([1 if bool(label) else 0 for label in labels], dtype=np.int64)
    if x.ndim != 2 or x.shape[0] == 0:
        raise ValueError("features must be a non-empty 2D array.")
    if y.shape[0] != x.shape[0]:
        raise ValueError("labels must have the same row count as features.")
    paths = _expected_artifact_paths(output, prefix)
    missing_paths = [str(path) for path in paths.values() if not path.exists()]
    if missing_paths:
        raise FileNotFoundError(f"Missing training artifacts: {', '.join(missing_paths)}")
    normalized = [kind for kind, path in paths.items() if _normalize_onnx_ir_version(path)]

    started = time.perf_counter()
    state = training_api.CheckpointState.load_checkpoint(paths["checkpoint"])
    module = training_api.Module(paths["trainingModel"], state, paths["evalModel"], device="cpu")
    optimizer = training_api.Optimizer(paths["optimizerModel"], module)
    if hasattr(optimizer, "set_learning_rate"):
        optimizer.set_learning_rate(float(learning_rate))
    losses: list[float] = []
    for _ in range(max(1, int(epochs))):
        module.train()
        loss = module(x, y)
        if isinstance(loss, tuple):
            loss_value = loss[0]
        else:
            loss_value = loss
        try:
            losses.append(float(np.asarray(loss_value).reshape(-1)[0]))
        except Exception:
            pass
        optimizer.step()
        module.lazy_reset_grad()
    inference_path = output / f"{prefix}inference.onnx"
    module.export_model_for_inferencing(inference_path, ["logits"])
    training_api.CheckpointState.save_checkpoint(state, paths["checkpoint"], include_optimizer_state=True)
    records = [_artifact_record(path, kind) for kind, path in {**paths, "inferenceModel": inference_path}.items()]
    manifest = create_training_artifact_manifest(output, prefix=prefix)
    return {
        "status": "complete",
        "enabled": True,
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "outputDir": str(output),
        "prefix": prefix,
        "epochs": max(1, int(epochs)),
        "learningRate": float(learning_rate),
        "rows": int(x.shape[0]),
        "featureCount": int(x.shape[1]),
        "durationMs": round((time.perf_counter() - started) * 1000, 3),
        "losses": losses,
        "artifacts": records,
        "normalizedIrKinds": normalized,
        "manifest": manifest,
        "matrix": matrix,
        "reason": "Experimental ORT training job completed and exported an inference model.",
    }


def _load_rows_source(source: str | Path, label: str) -> list[dict[str, Any]]:
    path = Path(source).expanduser()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"{label} rows file is missing: {path}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"{label} rows file is not valid JSON: {path}") from exc
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        payload = payload["rows"]
    if not isinstance(payload, list):
        raise ValueError(f"{label} rows must be a JSON array or an object with a rows array.")
    rows = [dict(row) for row in payload if isinstance(row, dict)]
    if len(rows) != len(payload):
        raise ValueError(f"{label} rows must contain only objects.")
    if not rows:
        raise ValueError(f"{label} rows must not be empty.")
    return rows


def _load_training_examples_source(source: str | Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    path = Path(source).expanduser()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FileNotFoundError(f"training examples file is missing: {path}") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError(f"training examples file is not valid JSON: {path}") from exc
    if isinstance(payload, dict):
        if isinstance(payload.get("examples"), list):
            rows = payload["examples"]
        elif isinstance(payload.get("rows"), list):
            rows = payload["rows"]
        else:
            raise ValueError("training examples object must contain an examples or rows array.")
        metadata = {key: value for key, value in payload.items() if key not in {"examples", "rows"}}
    elif isinstance(payload, list):
        rows = payload
        metadata = {}
    else:
        raise ValueError("training examples must be a JSON array or object with an examples/rows array.")
    result = [dict(row) for row in rows if isinstance(row, dict)]
    if len(result) != len(rows):
        raise ValueError("training examples must contain only objects.")
    if not result:
        raise ValueError("training examples must not be empty.")
    return result, metadata


def _row_identity(row: dict[str, Any], index: int) -> str:
    for key in ("naturalKey", "exampleId", "candidateId", "labelId", "sourceHash"):
        value = str(row.get(key, "") or "").strip()
        if value:
            return f"{key}:{value}"
    body = {
        "index": index,
        "expectedPerson": row.get("expectedPerson", ""),
        "modelName": row.get("modelName", ""),
        "matchScore": row.get("matchScore"),
        "rawCosine": row.get("rawCosine"),
        "isMatch": row.get("isMatch"),
    }
    return f"row:{_sha256_json(body)}"


def _split_digest(row: dict[str, Any], index: int, salt: str) -> str:
    return hashlib.sha256(f"{salt}|{_row_identity(row, index)}".encode("utf-8")).hexdigest()


def _scrub_reviewed_row(row: dict[str, Any]) -> dict[str, Any]:
    blocked_keys = {
        "sourcePath",
        "source_path",
        "bestRefPath",
        "best_ref_path",
        "imagePath",
        "image_path",
        "thumbnailPath",
        "thumbnail_path",
        "mediaPath",
        "media_path",
        "path",
        "vector",
        "embedding",
        "embeddingVector",
        "embedding_vector",
    }
    scrubbed = {
        key: value
        for key, value in row.items()
        if key not in blocked_keys and "vector" not in key.casefold()
    }
    features = scrubbed.get("features")
    if not isinstance(features, dict):
        scrubbed["features"] = {}
    return scrubbed


def _label_counts(rows: Sequence[dict[str, Any]]) -> dict[str, int]:
    positives = sum(1 for row in rows if bool(row.get("isMatch")))
    negatives = sum(1 for row in rows if not bool(row.get("isMatch")))
    return {"total": len(rows), "positive": positives, "negative": negatives}


def _desired_validation_count(total: int, *, fraction: float, min_per_class: int) -> int:
    if total < min_per_class * 2:
        raise ValueError(
            f"Need at least {min_per_class * 2} rows per class to keep {min_per_class} rows in both training and validation."
        )
    desired = int(round(total * float(fraction)))
    desired = max(int(min_per_class), desired)
    return min(desired, total - int(min_per_class))


def _context_split_key(row: dict[str, Any]) -> str:
    parts = []
    for key in CONTEXT_SPLIT_FIELDS:
        value = str(row.get(key, "") or "").strip()
        if value:
            parts.append(f"{key}={value}")
    return "|".join(parts) or "__default__"


def _rebalance_context_validation_groups(
    indexed_rows: Sequence[tuple[int, dict[str, Any]]],
    validation_ids: set[int],
    *,
    split_salt: str,
) -> set[int]:
    """Avoid putting an entire repeated context group only in validation.

    Public benchmark rows may have rare context buckets. A pure row-hash split can
    place every row from a small repeated bucket in validation, making the ONNX
    head and JSON baseline extrapolate an unseen scenario. This swaps one row
    from such a bucket back to training and moves a same-class training row from
    a better-represented bucket into validation, preserving class counts.
    """

    next_validation_ids = set(validation_ids)
    for label in (True, False):
        class_items = [(index, row) for index, row in indexed_rows if bool(row.get("isMatch")) is label]
        groups: dict[str, list[tuple[int, dict[str, Any]]]] = {}
        for index, row in class_items:
            groups.setdefault(_context_split_key(row), []).append((index, row))
        for group_key in sorted(groups):
            group_items = groups[group_key]
            if len(group_items) < 2:
                continue
            group_validation = [(index, row) for index, row in group_items if id(row) in next_validation_ids]
            if len(group_validation) != len(group_items):
                continue
            replacement_candidates: list[tuple[int, dict[str, Any]]] = []
            for candidate_group_key, candidate_group_items in groups.items():
                if candidate_group_key == group_key:
                    continue
                candidate_training = [
                    (index, row)
                    for index, row in candidate_group_items
                    if id(row) not in next_validation_ids
                ]
                if len(candidate_training) >= 2:
                    replacement_candidates.extend(candidate_training)
            if not replacement_candidates:
                continue
            move_to_training = sorted(
                group_validation,
                key=lambda item: _split_digest(item[1], item[0], f"{split_salt}|context-train|{label}|{group_key}"),
            )[0]
            move_to_validation = sorted(
                replacement_candidates,
                key=lambda item: _split_digest(item[1], item[0], f"{split_salt}|context-validation|{label}|{group_key}"),
            )[0]
            next_validation_ids.discard(id(move_to_training[1]))
            next_validation_ids.add(id(move_to_validation[1]))
    return next_validation_ids


def _stable_class_split(
    rows: Sequence[dict[str, Any]],
    *,
    validation_fraction: float,
    min_per_class: int,
    split_salt: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    indexed = list(enumerate(rows))
    positives = [(index, row) for index, row in indexed if bool(row.get("isMatch"))]
    negatives = [(index, row) for index, row in indexed if not bool(row.get("isMatch"))]
    pos_validation = _desired_validation_count(len(positives), fraction=validation_fraction, min_per_class=min_per_class)
    neg_validation = _desired_validation_count(len(negatives), fraction=validation_fraction, min_per_class=min_per_class)
    validation_ids = {
        id(row)
        for _index, row in sorted(
            positives,
            key=lambda item: _split_digest(item[1], item[0], f"{split_salt}|positive"),
        )[:pos_validation]
    }
    validation_ids.update(
        id(row)
        for _index, row in sorted(
            negatives,
            key=lambda item: _split_digest(item[1], item[0], f"{split_salt}|negative"),
        )[:neg_validation]
    )
    validation_ids = _rebalance_context_validation_groups(
        indexed,
        validation_ids,
        split_salt=split_salt,
    )
    training = [row for row in rows if id(row) not in validation_ids]
    validation = [row for row in rows if id(row) in validation_ids]
    return training, validation


def _assert_split_counts(
    training_rows: Sequence[dict[str, Any]],
    validation_rows: Sequence[dict[str, Any]],
    *,
    min_training_count: int,
    min_validation_count: int,
    min_per_class: int,
) -> None:
    train_counts = _label_counts(training_rows)
    validation_counts = _label_counts(validation_rows)
    if train_counts["total"] < int(min_training_count):
        raise ValueError(f"training split has {train_counts['total']} rows; need at least {int(min_training_count)}.")
    if validation_counts["total"] < int(min_validation_count):
        raise ValueError(f"validation split has {validation_counts['total']} rows; need at least {int(min_validation_count)}.")
    for name, counts in (("training", train_counts), ("validation", validation_counts)):
        if counts["positive"] < int(min_per_class) or counts["negative"] < int(min_per_class):
            raise ValueError(
                f"{name} split needs at least {int(min_per_class)} positive and {int(min_per_class)} negative rows; "
                f"got {counts['positive']} positive and {counts['negative']} negative."
            )


def split_reviewed_training_examples(
    source: str | Path,
    output_dir: str | Path,
    *,
    validation_fraction: float = 0.25,
    model_name: str = "",
    min_training_count: int = 20,
    min_validation_count: int = 20,
    min_per_class: int = 5,
    split_salt: str = "phase5-onnx-training-row-split-v1",
) -> dict[str, Any]:
    """Write deterministic ONNX train/held-out rows from reviewed examples."""

    if not 0.05 <= float(validation_fraction) <= 0.5:
        raise ValueError("validation_fraction must be between 0.05 and 0.5.")
    from crossage_fr.match import adapters as match_adapters

    raw_rows, source_metadata = _load_training_examples_source(source)
    canonical_rows: list[dict[str, Any]] = []
    dropped_invalid = 0
    for index, row in enumerate(raw_rows):
        scrubbed = _scrub_reviewed_row(row)
        canonical = match_adapters.canonical_row(scrubbed)
        if canonical is None or canonical.get("isMatch") is None:
            dropped_invalid += 1
            continue
        canonical["isMatch"] = bool(canonical["isMatch"])
        canonical["splitKey"] = _row_identity(canonical, index)
        canonical_rows.append(canonical)
    scoped_rows, dominant_model, dropped_other_model = match_adapters.scoped_training_rows(canonical_rows, model_name=model_name)
    scoped_rows = sorted(
        scoped_rows,
        key=lambda row: (
            str(row.get("createdAt", "") or ""),
            str(row.get("splitKey", "") or ""),
            str(row.get("candidateId", "") or ""),
        ),
    )
    if not scoped_rows:
        raise ValueError("No reviewed examples remain after score, label, and model scoping filters.")
    training_rows, validation_rows = _stable_class_split(
        scoped_rows,
        validation_fraction=validation_fraction,
        min_per_class=int(min_per_class),
        split_salt=split_salt,
    )
    _assert_split_counts(
        training_rows,
        validation_rows,
        min_training_count=int(min_training_count),
        min_validation_count=int(min_validation_count),
        min_per_class=int(min_per_class),
    )
    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    training_path = output / TRAINING_ROWS_FILENAME
    validation_path = output / VALIDATION_ROWS_FILENAME
    manifest_path = output / PHASE5_ROW_SPLIT_MANIFEST_FILENAME
    training_payload = {
        "schemaVersion": 1,
        "scope": "phase5-onnx-training-rows",
        "role": "training",
        "modelName": dominant_model,
        "rows": training_rows,
    }
    validation_payload = {
        "schemaVersion": 1,
        "scope": "phase5-onnx-training-rows",
        "role": "validation",
        "modelName": dominant_model,
        "rows": validation_rows,
    }
    training_path.write_text(json.dumps(training_payload, indent=2, sort_keys=True), encoding="utf-8")
    validation_path.write_text(json.dumps(validation_payload, indent=2, sort_keys=True), encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "scope": "phase5-onnx-training-row-split",
        "sourcePath": str(Path(source).expanduser()),
        "sourceRowsHash": _sha256_json({"rows": raw_rows}),
        "sourceMetadata": source_metadata,
        "modelName": dominant_model,
        "requestedModelName": str(model_name or ""),
        "validationFraction": float(validation_fraction),
        "minTrainingCount": int(min_training_count),
        "minValidationCount": int(min_validation_count),
        "minPerClass": int(min_per_class),
        "contextSplitFields": list(CONTEXT_SPLIT_FIELDS),
        "splitSaltHash": hashlib.sha256(split_salt.encode("utf-8")).hexdigest(),
        "input": {
            "rawRows": len(raw_rows),
            "usableRows": len(scoped_rows),
            "droppedInvalidRows": dropped_invalid,
            "droppedOtherModelRows": int(dropped_other_model),
            "classCounts": _label_counts(scoped_rows),
        },
        "training": {
            "path": str(training_path),
            "rowsHash": _sha256_json({"rows": training_rows}),
            "classCounts": _label_counts(training_rows),
        },
        "validation": {
            "path": str(validation_path),
            "rowsHash": _sha256_json({"rows": validation_rows}),
            "classCounts": _label_counts(validation_rows),
        },
        "privacy": {
            "pathsIncluded": any(any(key in row for key in ("sourcePath", "source_path", "bestRefPath", "best_ref_path")) for row in training_rows + validation_rows),
            "vectorsIncluded": any("vector" in json.dumps(row).casefold() for row in training_rows + validation_rows),
        },
    }
    manifest = _attach_report_hash(manifest)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")
    return {
        "ok": True,
        "outputDir": str(output),
        "trainingRowsPath": str(training_path),
        "validationRowsPath": str(validation_path),
        "manifestPath": str(manifest_path),
        "manifest": manifest,
    }


def _onnx_context_feature_values(row: dict[str, Any]) -> list[float]:
    from crossage_fr.match import adapters as match_adapters

    context = match_adapters.pair_context(row)
    cross_age = 1.0 if context.get("crossAge") is True else 0.0
    cross_pose = 1.0 if context.get("crossPose") is True else 0.0
    pose_unknown = 1.0 if context.get("poseUnknown") is True else 0.0
    media_video = 1.0 if context.get("mediaVideo") is True else 0.0
    close_runner_up = 1.0 if context.get("closeRunnerUp") is True else 0.0
    single_reference = 1.0 if context.get("singleReference") is True else 0.0
    hard_pose = 1.0 if context.get("hardPose") is True else 0.0
    low_quality = 1.0 if context.get("lowQuality") is True else 0.0
    return [
        cross_age,
        cross_pose,
        pose_unknown,
        media_video,
        close_runner_up,
        single_reference,
        hard_pose,
        low_quality,
    ]


def tiny_head_feature_names() -> list[str]:
    from crossage_fr.match import adapters as match_adapters

    return list(match_adapters.FEATURE_NAMES) + list(ONNX_CONTEXT_FEATURE_NAMES)


def tiny_head_feature_vector(row: dict[str, Any]) -> list[float]:
    from crossage_fr.match import adapters as match_adapters

    return match_adapters.feature_vector(row, match_adapters.FEATURE_NAMES) + _onnx_context_feature_values(row)


def rows_to_tiny_head_features(rows: Sequence[dict[str, Any]], *, require_labels: bool = False) -> tuple[list[list[float]], list[int]]:
    from crossage_fr.match import adapters as match_adapters

    features: list[list[float]] = []
    labels: list[int] = []
    for index, row in enumerate(rows):
        canonical = match_adapters.canonical_row(dict(row))
        if canonical is None:
            raise ValueError(f"Row {index} is missing usable score fields.")
        label = canonical.get("isMatch")
        if require_labels and label is None:
            raise ValueError(f"Row {index} is missing an isMatch label.")
        features.append(tiny_head_feature_vector(canonical))
        labels.append(1 if bool(label) else 0)
    return features, labels


def score_tiny_head_inference_model(model_path: str | Path, features: Sequence[Sequence[float]]) -> list[float]:
    import numpy as np
    import onnxruntime as ort

    x = np.asarray(list(features), dtype=np.float32)
    if x.ndim != 2 or x.shape[0] == 0:
        raise ValueError("features must be a non-empty 2D array.")
    session = ort.InferenceSession(str(Path(model_path).expanduser()), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output = session.run(None, {input_name: x})[0]
    logits = np.asarray(output, dtype=np.float64)
    if logits.ndim != 2 or logits.shape[1] < 2:
        raise ValueError("tiny head inference model must return batch x class logits.")
    logits = logits - logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    probabilities = exp / np.maximum(exp.sum(axis=1, keepdims=True), 1e-12)
    return [float(max(0.0, min(1.0, value))) for value in probabilities[:, 1].tolist()]


def run_row_training_validation(
    output_dir: str | Path,
    training_rows: Sequence[dict[str, Any]],
    validation_rows: Sequence[dict[str, Any]],
    *,
    prefix: str = "row_",
    epochs: int = ROW_TRAINING_DEFAULT_EPOCHS,
    learning_rate: float = ROW_TRAINING_DEFAULT_LEARNING_RATE,
    architecture: str = ROW_TRAINING_DEFAULT_ARCHITECTURE,
    hidden_units: int = ROW_TRAINING_DEFAULT_HIDDEN_UNITS,
    feature_preprocessing: str = ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING,
    min_count: int = 20,
    min_per_class: int = 5,
    threshold: float = 0.5,
) -> dict[str, Any]:
    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    train_features, train_labels = rows_to_tiny_head_features(training_rows, require_labels=True)
    validation_features, _validation_labels = rows_to_tiny_head_features(validation_rows, require_labels=True)
    feature_count = len(train_features[0])
    if any(len(row) != feature_count for row in validation_features):
        raise ValueError("training and validation feature dimensions differ.")
    architecture, hidden_units = _tiny_head_architecture(architecture, hidden_units)
    feature_preprocessing_metadata = _feature_standardization_metadata(
        train_features,
        mode=feature_preprocessing,
    )
    artifact_dir = output / "row_training_artifacts"
    generation = generate_tiny_scoring_head_artifacts(
        artifact_dir,
        feature_count=feature_count,
        architecture=architecture,
        hidden_units=hidden_units,
        feature_preprocessing=feature_preprocessing_metadata,
        prefix=prefix,
    )
    if generation.get("status") != "complete":
        return {
            "status": generation.get("status", "unknown"),
            "artifactDir": str(artifact_dir),
            "generation": generation,
            "trainingJob": {},
            "validationReportPath": "",
            "validation": {},
            "featurePreprocessing": feature_preprocessing_metadata,
            "reason": "Row training validation could not run because artifact generation did not complete.",
        }
    training = run_tiny_head_training_job(
        artifact_dir,
        train_features,
        train_labels,
        epochs=epochs,
        prefix=prefix,
        learning_rate=learning_rate,
    )
    training_report = _training_job_report(training)
    if training_report["status"] != "complete":
        return {
            "status": training_report["status"],
            "artifactDir": str(artifact_dir),
            "generation": generation,
            "trainingJob": training_report,
            "validationReportPath": "",
            "validation": {},
            "featurePreprocessing": feature_preprocessing_metadata,
            "reason": "Row training validation could not run because training did not complete.",
        }
    scores = score_tiny_head_inference_model(
        training_report["inferenceModelPath"],
        validation_features,
    )
    training_scores = score_tiny_head_inference_model(
        training_report["inferenceModelPath"],
        train_features,
    )
    train_label_bools = [bool(label) for label in train_labels]
    threshold_calibration = calibrate_onnx_threshold(
        training_scores,
        train_label_bools,
        requested_threshold=threshold,
    )
    try:
        from crossage_fr.match import adapters as match_adapters

        baseline_adapter = match_adapters.fit(training_rows, min_count=min_count, min_per_class=min_per_class)
        if baseline_adapter is not None:
            json_training_scores = [match_adapters.score(row, baseline_adapter) for row in training_rows]
            threshold_calibration = calibrate_onnx_threshold_against_baseline(
                training_scores,
                train_label_bools,
                json_training_scores,
                requested_threshold=threshold,
                baseline_threshold=threshold,
            )
    except Exception as exc:
        threshold_calibration = {
            **threshold_calibration,
            "selectionPolicy": "best-accuracy-fallback",
            "policyStatus": "baseline-aware-calibration-failed",
            "baselineCalibrationError": exc.__class__.__name__,
        }
    selected_threshold, selected_threshold_valid = _finite_float(
        threshold_calibration.get("selected", {}).get("threshold")
        if isinstance(threshold_calibration.get("selected"), dict)
        else threshold
    )
    if not selected_threshold_valid:
        selected_threshold = float(threshold)
    validation = write_phase5_validation_report(
        output / PHASE5_VALIDATION_FILENAME,
        validation_rows,
        scores,
        baseline_rows=training_rows,
        threshold=threshold,
        onnx_threshold=selected_threshold,
        threshold_calibration=threshold_calibration,
        training_config={
            "epochs": int(epochs),
            "learningRate": float(learning_rate),
            "featureVersion": ONNX_TINY_HEAD_FEATURE_VERSION,
            "featureCount": feature_count,
            "architecture": architecture,
            "hiddenUnits": hidden_units,
            "featurePreprocessing": {
                "mode": feature_preprocessing_metadata["mode"],
                "featureCount": feature_preprocessing_metadata["featureCount"],
                "meansHash": _sha256_json({"means": feature_preprocessing_metadata["means"]}),
                "scalesHash": _sha256_json({"scales": feature_preprocessing_metadata["scales"]}),
            },
        },
        min_count=min_count,
        min_per_class=min_per_class,
    )
    return {
        "status": "complete",
        "artifactDir": str(artifact_dir),
        "generation": {
            "status": generation.get("status"),
            "durationMs": generation.get("durationMs", 0.0),
            "artifactCount": len(generation.get("artifacts", [])),
            "normalizedIrKinds": generation.get("normalizedIrKinds", []),
        },
        "trainingJob": training_report,
        "validationReportPath": validation["reportPath"],
        "validation": {
            "status": validation.get("status"),
            "rowTrainingEpochs": int(epochs),
            "rowTrainingLearningRate": float(learning_rate),
            "architecture": architecture,
            "hiddenUnits": hidden_units,
            "featurePreprocessing": feature_preprocessing_metadata,
            "bestMetricGain": max((_as_float(validation.get("delta", {}).get(metric)) for metric in ("accuracy", "precision", "recall")), default=0.0),
            "delta": validation.get("delta", {}),
            "input": validation.get("input", {}),
            "baselineTraining": validation.get("baselineTraining", {}),
            "thresholds": validation.get("thresholds", {}),
            "onnxFeatureVersion": validation.get("onnxHead", {}).get("featureVersion") if isinstance(validation.get("onnxHead"), dict) else "",
            "onnxFeatureCount": validation.get("onnxHead", {}).get("featureCount") if isinstance(validation.get("onnxHead"), dict) else 0,
            "reportHash": validation.get("reportHash", ""),
        },
        "reason": "Row-trained ONNX head was scored against validation rows.",
    }


def _rounded_score(value: Any) -> float:
    return round(_as_float(value), 6)


def _binary_metrics(scores: Sequence[float], labels: Sequence[bool], threshold: float) -> dict[str, Any]:
    labels_list = [bool(label) for label in labels]
    scores_list = [float(score) for score in scores]
    true_positive = false_positive = true_negative = false_negative = 0
    for score, label in zip(scores_list, labels_list):
        predicted = score >= float(threshold)
        if label and predicted:
            true_positive += 1
        elif label:
            false_negative += 1
        elif predicted:
            false_positive += 1
        else:
            true_negative += 1
    predicted_positive = true_positive + false_positive
    actual_positive = true_positive + false_negative
    actual_negative = true_negative + false_positive
    total = max(1, len(labels_list))
    precision = 1.0 if predicted_positive == 0 else true_positive / predicted_positive
    recall = true_positive / max(1, actual_positive)
    specificity = true_negative / max(1, actual_negative)
    accuracy = (true_positive + true_negative) / total
    return {
        "threshold": float(threshold),
        "count": total,
        "truePositives": true_positive,
        "falsePositives": false_positive,
        "trueNegatives": true_negative,
        "falseNegatives": false_negative,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "specificity": round(specificity, 6),
        "accuracy": round(accuracy, 6),
    }


def _threshold_candidates(scores: Sequence[float], requested_threshold: float = 0.5) -> list[float]:
    values = sorted({_rounded_score(score) for score in scores if math.isfinite(_as_float(score))})
    candidates = {0.0, _rounded_score(requested_threshold), 0.5, 1.0}
    if values:
        candidates.add(_rounded_score(values[0] - 0.000001))
        candidates.add(_rounded_score(values[-1] + 0.000001))
    for value in values:
        candidates.add(_rounded_score(value))
    for left, right in zip(values, values[1:]):
        candidates.add(_rounded_score((left + right) / 2.0))
    return sorted(candidates)


def _metrics_sort_key(metrics: dict[str, Any]) -> tuple[float, float, float, float, float]:
    return (
        _as_float(metrics.get("accuracy")),
        _as_float(metrics.get("precision")),
        _as_float(metrics.get("recall")),
        _as_float(metrics.get("specificity")),
        -abs(_as_float(metrics.get("threshold")) - 0.5),
    )


def _precision_sort_key(metrics: dict[str, Any]) -> tuple[float, float, float, float]:
    return (
        _as_float(metrics.get("precision")),
        _as_float(metrics.get("recall")),
        _as_float(metrics.get("accuracy")),
        -abs(_as_float(metrics.get("threshold")) - 0.5),
    )


def _threshold_sweep(scores: Sequence[float], labels: Sequence[bool], requested_threshold: float = 0.5) -> list[dict[str, Any]]:
    return [_binary_metrics(scores, labels, threshold) for threshold in _threshold_candidates(scores, requested_threshold)]


def _metric_deltas(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    return {
        metric: round(_as_float(candidate.get(metric)) - _as_float(baseline.get(metric)), 6)
        for metric in ("accuracy", "precision", "recall", "specificity")
    }


def _no_core_metric_regression(deltas: dict[str, float]) -> bool:
    return all(_as_float(deltas.get(metric)) >= -0.000001 for metric in ("accuracy", "precision", "recall"))


def _sweep_candidate_against_baseline(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, Any]:
    deltas = _metric_deltas(candidate, baseline)
    return {
        **candidate,
        "deltaVsJsonAdapter": deltas,
        "bestMetricGain": round(max(deltas.get(metric, 0.0) for metric in ("accuracy", "precision", "recall")), 6),
        "noCoreMetricRegression": _no_core_metric_regression(deltas),
    }


def _gain_sort_key(candidate: dict[str, Any]) -> tuple[float, float, float, float, float]:
    deltas = candidate.get("deltaVsJsonAdapter") if isinstance(candidate.get("deltaVsJsonAdapter"), dict) else {}
    return (
        _as_float(candidate.get("bestMetricGain")),
        _as_float(deltas.get("accuracy")),
        _as_float(deltas.get("precision")),
        _as_float(deltas.get("recall")),
        -abs(_as_float(candidate.get("threshold")) - 0.5),
    )


def _threshold_sweep_baseline_diagnostics(
    sweep: Sequence[dict[str, Any]],
    baseline_metrics: dict[str, Any],
    *,
    min_metric_gain: float = 0.01,
) -> dict[str, Any]:
    compared = [_sweep_candidate_against_baseline(row, baseline_metrics) for row in sweep]
    no_regression = [row for row in compared if row.get("noCoreMetricRegression") is True]
    measurable = [row for row in no_regression if _as_float(row.get("bestMetricGain")) >= float(min_metric_gain)]
    return {
        "baselineJsonAdapter": baseline_metrics,
        "minMetricGain": float(min_metric_gain),
        "candidateCount": len(compared),
        "noRegressionCandidateCount": len(no_regression),
        "measurableGainNoRegressionCandidateCount": len(measurable),
        "bestNoRegression": max(no_regression, key=_gain_sort_key) if no_regression else None,
        "bestMeasurableGainNoRegression": max(measurable, key=_gain_sort_key) if measurable else None,
    }


def calibrate_onnx_threshold(
    scores: Sequence[float],
    labels: Sequence[bool],
    *,
    requested_threshold: float = 0.5,
) -> dict[str, Any]:
    labels_list = [bool(label) for label in labels]
    scores_list = [float(score) for score in scores]
    if len(labels_list) != len(scores_list):
        raise ValueError("scores and labels must have the same length for threshold calibration.")
    if not scores_list:
        raise ValueError("threshold calibration requires at least one score.")
    sweep = _threshold_sweep(scores_list, labels_list, requested_threshold)
    fixed = _binary_metrics(scores_list, labels_list, requested_threshold)
    selected = max(sweep, key=_metrics_sort_key)
    precision_first = max(sweep, key=_precision_sort_key)
    return {
        "scope": "phase5-onnx-training-threshold-calibration",
        "source": "training-rows",
        "requestedThreshold": float(requested_threshold),
        "selected": selected,
        "fixedThreshold": fixed,
        "bestPrecision": precision_first,
        "candidateCount": len(sweep),
        "scoreSummary": _score_summary(scores_list, labels_list),
    }


def calibrate_onnx_threshold_against_baseline(
    onnx_scores: Sequence[float],
    labels: Sequence[bool],
    baseline_scores: Sequence[float],
    *,
    requested_threshold: float = 0.5,
    baseline_threshold: float = 0.5,
    min_metric_gain: float = 0.01,
) -> dict[str, Any]:
    """Choose an ONNX threshold on training rows without regressing the JSON baseline."""

    labels_list = [bool(label) for label in labels]
    onnx_scores_list = [float(score) for score in onnx_scores]
    baseline_scores_list = [float(score) for score in baseline_scores]
    if len(labels_list) != len(onnx_scores_list) or len(labels_list) != len(baseline_scores_list):
        raise ValueError("scores and labels must have the same length for baseline-aware threshold calibration.")
    base = calibrate_onnx_threshold(
        onnx_scores_list,
        labels_list,
        requested_threshold=requested_threshold,
    )
    baseline_metrics = _binary_metrics(baseline_scores_list, labels_list, baseline_threshold)
    sweep = _threshold_sweep(onnx_scores_list, labels_list, requested_threshold)
    comparison = _threshold_sweep_baseline_diagnostics(
        sweep,
        baseline_metrics,
        min_metric_gain=min_metric_gain,
    )
    selected = base["selected"]
    selected_by_policy = "bestAccuracy"
    policy_status = "fallback-best-accuracy"
    if comparison.get("bestMeasurableGainNoRegression"):
        selected = comparison["bestMeasurableGainNoRegression"]
        selected_by_policy = "bestMeasurableGainNoRegression"
        policy_status = "baseline-aware-measurable-gain"
    elif comparison.get("bestNoRegression"):
        selected = comparison["bestNoRegression"]
        selected_by_policy = "bestNoRegression"
        policy_status = "baseline-aware-no-regression"
    return {
        **base,
        "selectionPolicy": "json-baseline-no-regression-first",
        "policyStatus": policy_status,
        "selectedByPolicy": selected_by_policy,
        "unconstrainedSelected": base["selected"],
        "selected": selected,
        "baselineThreshold": float(baseline_threshold),
        "baselineComparison": comparison,
    }


def _score_distribution(values: Sequence[float]) -> dict[str, Any]:
    finite = sorted(float(value) for value in values if math.isfinite(float(value)))
    if not finite:
        return {"count": 0, "min": None, "max": None, "mean": None}
    return {
        "count": len(finite),
        "min": _rounded_score(finite[0]),
        "max": _rounded_score(finite[-1]),
        "mean": _rounded_score(sum(finite) / len(finite)),
    }


def _score_summary(scores: Sequence[float], labels: Sequence[bool]) -> dict[str, Any]:
    pairs = [(float(score), bool(label)) for score, label in zip(scores, labels)]
    positives = [score for score, label in pairs if label]
    negatives = [score for score, label in pairs if not label]
    return {
        "overall": _score_distribution([score for score, _label in pairs]),
        "positive": _score_distribution(positives),
        "negative": _score_distribution(negatives),
        "separation": {
            "minPositiveMinusMaxNegative": (
                _rounded_score(min(positives) - max(negatives))
                if positives and negatives
                else None
            ),
            "meanPositiveMinusMeanNegative": (
                _rounded_score((sum(positives) / len(positives)) - (sum(negatives) / len(negatives)))
                if positives and negatives
                else None
            ),
        },
    }


def _validation_row_identity(row: dict[str, Any], index: int) -> dict[str, Any]:
    source_hash = str(row.get("sourceHash", "") or "")
    return {
        "index": index,
        "rowHash": _sha256_json({key: value for key, value in row.items() if "path" not in key.casefold()}),
        "candidateId": str(row.get("candidateId", "") or ""),
        "sourceHashPrefix": source_hash[:12],
        "datasetId": str(row.get("datasetId", "") or ""),
        "expectedPerson": str(row.get("expectedPerson", "") or ""),
        "actualPerson": str(row.get("actualPerson", "") or ""),
        "scenario": str(row.get("scenario", "") or ""),
        "validationBucket": str(row.get("validationBucket", "") or ""),
        "difficulty": str(row.get("difficulty", "") or ""),
        "matchScore": _rounded_score(row.get("matchScore")),
    }


def _prediction_errors(
    rows: Sequence[dict[str, Any]],
    scores: Sequence[float],
    labels: Sequence[bool],
    threshold: float,
    *,
    limit: int = 12,
) -> dict[str, list[dict[str, Any]]]:
    false_positives: list[dict[str, Any]] = []
    false_negatives: list[dict[str, Any]] = []
    for index, (row, score, label) in enumerate(zip(rows, scores, labels)):
        predicted = float(score) >= float(threshold)
        if predicted == bool(label):
            continue
        entry = {
            **_validation_row_identity(dict(row), index),
            "score": _rounded_score(score),
            "threshold": _rounded_score(threshold),
        }
        if predicted:
            false_positives.append(entry)
        else:
            false_negatives.append(entry)
    false_positives.sort(key=lambda item: (-_as_float(item.get("score")), str(item.get("rowHash"))))
    false_negatives.sort(key=lambda item: (_as_float(item.get("score")), str(item.get("rowHash"))))
    return {
        "falsePositives": false_positives[:limit],
        "falseNegatives": false_negatives[:limit],
    }


def _learning_context_key(row: dict[str, Any]) -> str:
    from crossage_fr.match import adapters as match_adapters

    return match_adapters.pair_context_key(row)


def _context_counts(rows: Sequence[dict[str, Any]]) -> dict[str, dict[str, int]]:
    from crossage_fr.match import adapters as match_adapters

    counts: dict[str, dict[str, int]] = {}
    for row in rows:
        canonical = match_adapters.canonical_row(dict(row)) or dict(row)
        key = _learning_context_key(canonical)
        bucket = counts.setdefault(key, {"positive": 0, "negative": 0, "total": 0})
        label_key = "positive" if bool(canonical.get("isMatch")) else "negative"
        bucket[label_key] += 1
        bucket["total"] += 1
    return counts


def _training_coverage_diagnostics(
    baseline_rows: Sequence[dict[str, Any]],
    validation_rows: Sequence[dict[str, Any]],
) -> dict[str, Any]:
    from crossage_fr.match import adapters as match_adapters

    training_counts = _context_counts(baseline_rows)
    validation_counts = _context_counts(validation_rows)
    missing: dict[tuple[str, str], dict[str, Any]] = {}
    covered_rows = 0
    for index, row in enumerate(validation_rows):
        canonical = match_adapters.canonical_row(dict(row)) or dict(row)
        key = _learning_context_key(canonical)
        label_key = "positive" if bool(canonical.get("isMatch")) else "negative"
        training_count = int(training_counts.get(key, {}).get(label_key, 0))
        if training_count > 0:
            covered_rows += 1
            continue
        missing_key = (key, label_key)
        entry = missing.setdefault(
            missing_key,
            {
                "contextKey": key,
                "label": label_key,
                "validationCount": 0,
                "trainingCount": training_count,
                "examples": [],
            },
        )
        entry["validationCount"] += 1
        if len(entry["examples"]) < 3:
            entry["examples"].append(_validation_row_identity(canonical, index))
    missing_contexts = sorted(
        missing.values(),
        key=lambda item: (-int(item.get("validationCount", 0)), str(item.get("label", "")), str(item.get("contextKey", ""))),
    )
    return {
        "trainingContextCount": len(training_counts),
        "validationContextCount": len(validation_counts),
        "validationRows": len(validation_rows),
        "coveredValidationRows": covered_rows,
        "missingValidationRows": len(validation_rows) - covered_rows,
        "missingValidationContexts": missing_contexts,
    }


def _validation_diagnostics(
    rows: Sequence[dict[str, Any]],
    labels: Sequence[bool],
    *,
    baseline_rows: Sequence[dict[str, Any]],
    json_scores: Sequence[float],
    onnx_scores: Sequence[float],
    json_threshold: float,
    onnx_threshold: float,
) -> dict[str, Any]:
    onnx_sweep = _threshold_sweep(onnx_scores, labels, onnx_threshold)
    json_metrics = _binary_metrics(json_scores, labels, json_threshold)
    onnx_fixed_metrics = _binary_metrics(onnx_scores, labels, json_threshold)
    onnx_selected_metrics = _binary_metrics(onnx_scores, labels, onnx_threshold)
    return {
        "scoreSummary": {
            "jsonAdapter": _score_summary(json_scores, labels),
            "onnxHead": _score_summary(onnx_scores, labels),
        },
        "fixedThreshold": {
            "threshold": float(json_threshold),
            "jsonAdapter": json_metrics,
            "onnxHead": onnx_fixed_metrics,
            "deltaVsJsonAdapter": _metric_deltas(onnx_fixed_metrics, json_metrics),
        },
        "selectedThreshold": {
            "threshold": float(onnx_threshold),
            "onnxHead": onnx_selected_metrics,
            "deltaVsJsonAdapter": _metric_deltas(onnx_selected_metrics, json_metrics),
        },
        "onnxThresholdSweep": {
            "candidateCount": len(onnx_sweep),
            "bestAccuracy": max(onnx_sweep, key=_metrics_sort_key),
            "bestPrecision": max(onnx_sweep, key=_precision_sort_key),
            "baselineComparison": _threshold_sweep_baseline_diagnostics(onnx_sweep, json_metrics),
        },
        "trainingCoverage": _training_coverage_diagnostics(baseline_rows, rows),
        "predictionErrors": {
            "jsonAdapter": _prediction_errors(rows, json_scores, labels, json_threshold),
            "onnxHead": _prediction_errors(rows, onnx_scores, labels, onnx_threshold),
        },
    }


def validate_against_json_adapter_baseline(
    rows: Sequence[dict[str, Any]],
    onnx_scores: Sequence[float],
    *,
    baseline_rows: Sequence[dict[str, Any]] | None = None,
    threshold: float = 0.5,
    onnx_threshold: float | None = None,
    threshold_calibration: dict[str, Any] | None = None,
    min_count: int = 20,
    min_per_class: int = 5,
) -> dict[str, Any]:
    """Compare ONNX scoring-head outputs with the Phase 4 JSON adapter."""

    from crossage_fr.match import adapters as match_adapters

    rows_list = [dict(row) for row in rows]
    baseline_rows_list = [dict(row) for row in (baseline_rows if baseline_rows is not None else rows)]
    scores = [float(score) for score in onnx_scores]
    if len(rows_list) != len(scores):
        raise ValueError("rows and onnx_scores must have the same length.")
    if not rows_list:
        raise ValueError("rows must not be empty.")
    if not baseline_rows_list:
        raise ValueError("baseline rows must not be empty.")
    adapter = match_adapters.fit(baseline_rows_list, min_count=min_count, min_per_class=min_per_class)
    if adapter is None:
        raise ValueError("Not enough labeled rows to train the JSON adapter baseline.")
    labels = [bool((match_adapters.canonical_row(row) or row).get("isMatch")) for row in rows_list]
    json_scores = [match_adapters.score(row, adapter) for row in rows_list]
    effective_onnx_threshold = float(threshold if onnx_threshold is None else onnx_threshold)
    json_metrics = _binary_metrics(json_scores, labels, threshold)
    onnx_metrics = _binary_metrics(scores, labels, effective_onnx_threshold)
    accuracy_delta = float(onnx_metrics["accuracy"]) - float(json_metrics["accuracy"])
    precision_delta = float(onnx_metrics["precision"]) - float(json_metrics["precision"])
    recall_delta = float(onnx_metrics["recall"]) - float(json_metrics["recall"])
    status = "pass" if accuracy_delta >= -0.02 and precision_delta >= -0.02 else "regression"
    return {
        "status": status,
        "threshold": float(threshold),
        "thresholds": {
            "jsonAdapter": float(threshold),
            "onnxHead": effective_onnx_threshold,
            "requested": float(threshold),
        },
        "count": len(rows_list),
        "input": {
            "count": len(rows_list),
            "positiveCount": sum(1 for label in labels if label),
            "negativeCount": sum(1 for label in labels if not label),
            "minCount": int(min_count),
            "minPerClass": int(min_per_class),
            "rowsHash": _sha256_json({"rows": rows_list}),
            "scoresHash": _sha256_json({"onnxScores": scores}),
        },
        "baselineTraining": {
            "source": "training-rows" if baseline_rows is not None else "validation-rows",
            "count": len(baseline_rows_list),
            "rowsHash": _sha256_json({"rows": baseline_rows_list}),
            "inputCount": adapter.get("inputCount"),
            "positiveCount": adapter.get("positiveCount"),
            "negativeCount": adapter.get("negativeCount"),
            "labelsDroppedOtherModel": adapter.get("labelsDroppedOtherModel"),
        },
        "jsonAdapter": {
            "artifact": {
                "versionKey": adapter.get("versionKey"),
                "featureVersion": adapter.get("featureVersion"),
                "trainer": adapter.get("trainer"),
                "inputCount": adapter.get("inputCount"),
            },
            "metrics": json_metrics,
        },
        "onnxHead": {
            "featureVersion": ONNX_TINY_HEAD_FEATURE_VERSION,
            "featureCount": len(tiny_head_feature_names()),
            "metrics": onnx_metrics,
        },
        "thresholdCalibration": threshold_calibration or {},
        "diagnostics": _validation_diagnostics(
            rows_list,
            labels,
            baseline_rows=baseline_rows_list,
            json_scores=json_scores,
            onnx_scores=scores,
            json_threshold=threshold,
            onnx_threshold=effective_onnx_threshold,
        ),
        "delta": {
            "accuracy": round(accuracy_delta, 6),
            "precision": round(precision_delta, 6),
            "recall": round(recall_delta, 6),
        },
        "reason": (
            "ONNX scoring head matches or beats the JSON adapter baseline within tolerance."
            if status == "pass"
            else "ONNX scoring head regressed against the JSON adapter baseline."
        ),
    }


def tiny_scoring_head_training_status(output_dir: str | Path | None = None) -> dict[str, Any]:
    """Return the Phase 5 prototype status without creating production artifacts."""

    matrix = dependency_feasibility_matrix()
    output = Path(output_dir).expanduser() if output_dir else None
    if not enabled():
        return {
            "status": "disabled",
            "enabled": False,
            "featureFlag": CANONICAL_FEATURE_FLAG,
            "artifacts": [],
            "outputDir": str(output) if output else "",
            "matrix": matrix,
            "reason": f"Set {CANONICAL_FEATURE_FLAG}=1 to run experimental ONNX training probes.",
        }
    missing = [name for name, ok in matrix["installed"].items() if not ok]
    if missing:
        return {
            "status": "unavailable",
            "enabled": True,
            "featureFlag": CANONICAL_FEATURE_FLAG,
            "artifacts": [],
            "outputDir": str(output) if output else "",
            "matrix": matrix,
            "blockers": [f"{name} is not importable" for name in missing],
            "reason": "Experimental ONNX training cannot run on this host yet.",
        }
    return {
        "status": "ready-for-prototype",
        "enabled": True,
        "featureFlag": CANONICAL_FEATURE_FLAG,
        "artifacts": [],
        "outputDir": str(output) if output else "",
        "matrix": matrix,
        "reason": "Dependencies are present; experimental artifact generation can run behind the feature flag.",
    }


def _pop_option_value(args: list[str], option: str) -> str:
    if not args:
        raise ValueError(f"{option} requires a value")
    value = args.pop(0)
    if value.startswith("--"):
        raise ValueError(f"{option} requires a value")
    return value


def _pop_int_option(args: list[str], option: str) -> int:
    value = _pop_option_value(args, option)
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{option} requires an integer value") from exc


def _pop_float_option(args: list[str], option: str) -> float:
    value = _pop_option_value(args, option)
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{option} requires a numeric value") from exc


def main(argv: Sequence[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if args and args[0] == "--split-training-examples":
        args.pop(0)
        validation_fraction = 0.25
        model_name = ""
        min_training_count = 20
        min_validation_count = 20
        min_per_class = 5
        try:
            source_path = _pop_option_value(args, "--split-training-examples")
            output_dir = _pop_option_value(args, "--split-training-examples")
            while args:
                option = args.pop(0)
                if option == "--validation-fraction":
                    validation_fraction = _pop_float_option(args, option)
                elif option == "--model-name":
                    model_name = _pop_option_value(args, option)
                elif option == "--min-training-count":
                    min_training_count = _pop_int_option(args, option)
                elif option == "--min-validation-count":
                    min_validation_count = _pop_int_option(args, option)
                elif option == "--min-per-class":
                    min_per_class = _pop_int_option(args, option)
                else:
                    raise ValueError(f"Unknown option: {option}")
            split = split_reviewed_training_examples(
                source_path,
                output_dir,
                validation_fraction=validation_fraction,
                model_name=model_name,
                min_training_count=min_training_count,
                min_validation_count=min_validation_count,
                min_per_class=min_per_class,
            )
        except (FileNotFoundError, ValueError) as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
            return 2
        manifest = split.get("manifest") if isinstance(split.get("manifest"), dict) else {}
        summary = {
            "ok": True,
            "outputDir": split["outputDir"],
            "trainingRowsPath": split["trainingRowsPath"],
            "validationRowsPath": split["validationRowsPath"],
            "manifestPath": split["manifestPath"],
            "modelName": manifest.get("modelName", ""),
            "training": manifest.get("training", {}).get("classCounts", {}) if isinstance(manifest.get("training"), dict) else {},
            "validation": manifest.get("validation", {}).get("classCounts", {}) if isinstance(manifest.get("validation"), dict) else {},
            "reportHash": manifest.get("reportHash", ""),
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    if args and args[0] == "--combine-runtime-study":
        args.pop(0)
        try:
            output_path = Path(_pop_option_value(args, "--combine-runtime-study")).expanduser()
            if not args:
                raise ValueError("--combine-runtime-study requires at least one source fragment")
            combined = write_combined_target_runtime_study(output_path, args)
        except ValueError as exc:
            print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
            return 2
        summary = {
            "ok": combined["status"] == "complete" and not combined.get("sourceErrors"),
            "outputPath": str(output_path),
            "status": combined["status"],
            "targets": [row.get("target", "") for row in combined.get("targets", []) if isinstance(row, dict)],
            "missingTargets": combined.get("missingTargets", []),
            "sourceErrors": combined.get("sourceErrors", []),
            "reportHash": combined.get("reportHash", ""),
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    output = Path("benchmarks/results/onnx-training-measurement-local")
    if args and not args[0].startswith("--"):
        output = Path(args.pop(0)).expanduser()
    training_rows_source: str | None = None
    validation_rows_source: str | None = None
    row_training_epochs = ROW_TRAINING_DEFAULT_EPOCHS
    row_training_learning_rate = ROW_TRAINING_DEFAULT_LEARNING_RATE
    row_training_architecture = ROW_TRAINING_DEFAULT_ARCHITECTURE
    row_training_hidden_units = ROW_TRAINING_DEFAULT_HIDDEN_UNITS
    row_training_feature_preprocessing = ROW_TRAINING_DEFAULT_FEATURE_PREPROCESSING
    try:
        while args:
            option = args.pop(0)
            if option == "--training-rows":
                training_rows_source = _pop_option_value(args, option)
            elif option == "--validation-rows":
                validation_rows_source = _pop_option_value(args, option)
            elif option == "--row-training-epochs":
                row_training_epochs = _pop_int_option(args, option)
                if row_training_epochs < 1:
                    raise ValueError("--row-training-epochs must be at least 1")
            elif option == "--row-training-learning-rate":
                row_training_learning_rate = _pop_float_option(args, option)
                if not math.isfinite(row_training_learning_rate) or row_training_learning_rate <= 0:
                    raise ValueError("--row-training-learning-rate must be a positive finite value")
            elif option == "--row-training-architecture":
                row_training_architecture = str(_pop_option_value(args, option)).strip().casefold()
                if row_training_architecture not in ROW_TRAINING_ARCHITECTURES:
                    raise ValueError(f"Unsupported --row-training-architecture: {row_training_architecture}")
            elif option == "--row-training-hidden-units":
                row_training_hidden_units = _pop_int_option(args, option)
            elif option == "--row-training-feature-preprocessing":
                row_training_feature_preprocessing = str(_pop_option_value(args, option)).strip().casefold()
                if row_training_feature_preprocessing not in ROW_TRAINING_FEATURE_PREPROCESSING:
                    raise ValueError(f"Unsupported --row-training-feature-preprocessing: {row_training_feature_preprocessing}")
            elif option == "--row-training-no-standardize":
                row_training_feature_preprocessing = "none"
            else:
                raise ValueError(f"Unknown option: {option}")
        row_training_architecture, row_training_hidden_units = _tiny_head_architecture(
            row_training_architecture,
            row_training_hidden_units,
        )
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 2
    bundle = write_phase5_measurement_bundle(
        output,
        training_rows_source=training_rows_source,
        validation_rows_source=validation_rows_source,
        row_training_epochs=row_training_epochs,
        row_training_learning_rate=row_training_learning_rate,
        row_training_architecture=row_training_architecture,
        row_training_hidden_units=row_training_hidden_units,
        row_training_feature_preprocessing=row_training_feature_preprocessing,
    )
    row_validation = bundle.get("rowValidation") if isinstance(bundle.get("rowValidation"), dict) else {}
    summary = {
        "ok": bundle["ok"],
        "outputDir": bundle["outputDir"],
        "measurementPath": bundle["measurementPath"],
        "runtimeStudyFragmentPath": bundle["runtimeStudyFragmentPath"],
        "decisionReportPath": bundle["decisionReportPath"],
        "decisionStatus": bundle["decisionReport"]["status"],
        "target": bundle["targetRuntimeStudy"]["targets"][0]["target"],
        "status": bundle["targetRuntimeStudy"]["targets"][0]["status"],
        "blockers": bundle["targetRuntimeStudy"]["targets"][0]["blockers"],
        "rowValidationStatus": row_validation.get("status", "not-requested"),
        "validationReportPath": row_validation.get("validationReportPath", ""),
        "rowTrainingEpochs": row_validation.get("rowTrainingEpochs", row_training_epochs),
        "rowTrainingLearningRate": row_validation.get("rowTrainingLearningRate", row_training_learning_rate),
        "rowTrainingArchitecture": row_validation.get("architecture", row_training_architecture),
        "rowTrainingHiddenUnits": row_validation.get("hiddenUnits", row_training_hidden_units),
        "rowTrainingFeaturePreprocessing": (
            row_validation.get("featurePreprocessing", {}).get("mode")
            if isinstance(row_validation.get("featurePreprocessing"), dict)
            else row_training_feature_preprocessing
        ),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

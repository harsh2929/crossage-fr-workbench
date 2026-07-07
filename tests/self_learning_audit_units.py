from __future__ import annotations

import hashlib
import io
import json
import tempfile
import time
from contextlib import redirect_stdout
from pathlib import Path

from crossage_fr.experiments import onnx_training, retraining_governance, self_learning_audit


def write_json(path: Path, payload: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


def file_record(path: Path, kind: str) -> dict:
    body = path.read_bytes()
    return {
        "kind": kind,
        "path": str(path),
        "exists": True,
        "sizeBytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
    }


def legal_payload() -> dict:
    return {
        "schemaVersion": 1,
        "decision": "approved_for_r_and_d",
        "reviewer": "Qualified Counsel",
        "reviewedAt": "2026-06-18",
        "topics": {topic: True for topic in retraining_governance.LEGAL_TOPICS},
        "scope": {
            "jurisdiction": "US-CA",
            "modelFamilies": ["buffalo_l"],
            "baseModelLicenses": [
                {
                    "modelFamily": "buffalo_l",
                    "source": "internal-license-review-2026-06-18",
                    "licenseStatus": "approved_for_internal_r_and_d",
                    "notes": "Synthetic test evidence only.",
                }
            ],
            "biometricDataCategories": ["face_embeddings", "review_labels", "derived_checkpoints"],
            "consentPolicyVersion": "biometric-training-consent-v1",
            "retentionDays": 30,
            "withdrawalProcedure": "Delete training rows and invalidate derivative checkpoints on request.",
            "exportBackupPolicy": "Local encrypted backup only during R&D.",
        },
    }


def runtime_payload() -> dict:
    return {
        "schemaVersion": 1,
        "targets": [
            {
                "target": target,
                "trainingRuntimeAvailable": True,
                "gpuAvailable": target != "macos-x64",
                "trainingDurationMs": 1200,
                "measuredAtUnix": 1.0,
                "packageSizeBytes": 250_000_000,
                "failureModes": ["cancelled", "out-of-memory", "thermal-throttle"],
                "status": "pass",
            }
            for target in retraining_governance.RUNTIME_TARGETS
        ],
    }


def validation_rows() -> list[dict]:
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
                "modelName": "self-learning-audit-test",
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
                "modelName": "self-learning-audit-test",
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


def phase5_decision_payload(*, ok: bool = True) -> dict:
    runtime_targets = [
        {
            "target": target,
            "ok": ok,
            "status": "pass" if ok else "blocked",
            "trainingRuntimeAvailable": ok,
            "trainingPackageAvailable": ok,
            "trainingDurationMs": 1200 if ok else 0,
            "gpuAvailable": target != "macos-x64",
            "providers": ["CoreMLExecutionProvider", "CPUExecutionProvider"] if target == "macos-arm64" else ["CPUExecutionProvider"],
            "primaryProvider": "CoreMLExecutionProvider" if target == "macos-arm64" else "CPUExecutionProvider",
            "performanceTier": "high" if target == "macos-arm64" else "standard",
            "packageSizeBytes": 250_000_000 if ok else 0,
            "measuredAtUnix": 1.0,
            "failureModes": ["cancelled", "out-of-memory"] if ok else [],
            "blockers": [] if ok else [f"training-runtime-unavailable:{target}"],
        }
        for target in onnx_training.TARGET_PLATFORMS
    ]
    report = {
        "schemaVersion": 1,
        "generatedAtUnix": 1.0,
        "ok": ok,
        "status": "go-for-r-and-d" if ok else "no-go",
        "scope": "phase5-onnx-training-r-and-d",
        "notProductionAuthorization": True,
        "requirements": {
            "verifiedTrainingArtifacts": True,
            "completeTargetRuntimeStudy": True,
            "trainingPackageAvailableOnTargets": True,
            "packageImpactUnderstood": True,
            "measurableGainOverJsonAdapter": True,
            "minMetricGain": 0.01,
            "maxPackageBytes": None,
        },
        "artifact": {
            "verified": ok,
            "manifestPath": "synthetic-training-artifact-manifest.json",
            "manifestId": "synthetic",
            "manifestHash": "a" * 64,
            "errors": [] if ok else ["manifest-missing"],
        },
        "runtime": {
            "ok": ok,
            "source": "synthetic",
            "status": "complete" if ok else "blocked",
            "requiredTargets": list(onnx_training.TARGET_PLATFORMS),
            "totalPackageSizeBytes": 1_000_000_000 if ok else 0,
            "maxTargetPackageSizeBytes": 250_000_000 if ok else 0,
            "maxPackageBytes": None,
            "targets": runtime_targets,
            "blockers": [] if ok else [f"training-runtime-unavailable:{onnx_training.TARGET_PLATFORMS[0]}"],
        },
        "validation": {
            "ok": ok,
            "source": "synthetic",
            "status": "pass" if ok else "blocked",
            "minMetricGain": 0.01,
            "bestMetricGain": 0.03 if ok else 0.0,
            "delta": {"accuracy": 0.03, "precision": 0.01, "recall": 0.02} if ok else {"accuracy": 0.0, "precision": 0.0, "recall": 0.0},
            "blockers": [] if ok else ["measurable-gain-missing"],
        },
        "evidenceFiles": [
            {"kind": "artifact-manifest", "path": "<memory>", "exists": False, "sizeBytes": 0, "sha256": ""},
            {"kind": "runtime-study", "path": "<memory>", "exists": False, "sizeBytes": 0, "sha256": ""},
            {"kind": "validation", "path": "<memory>", "exists": False, "sizeBytes": 0, "sha256": ""},
        ],
        "blockers": [] if ok else ["artifact:manifest-missing", "validation:measurable-gain-missing"],
        "message": "Synthetic test report.",
    }
    report["reportHash"] = onnx_training._sha256_json({key: value for key, value in report.items() if key != "reportHash"})  # noqa: SLF001 - verifier test fixture.
    return report


def write_phase5_decision(path: Path, *, ok: bool = True) -> Path:
    report = phase5_decision_payload(ok=ok)
    source_root = path.parent / f"{path.stem}-source-evidence"
    artifact_dir = source_root / "artifact-bundle"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    prefix = "synthetic_"
    (artifact_dir / f"{prefix}forward.onnx").write_bytes(b"synthetic-forward")
    if ok:
        for kind, suffix in onnx_training.TRAINING_ARTIFACT_SUFFIXES.items():
            artifact_path = artifact_dir / f"{prefix}{suffix}"
            if kind == "checkpoint":
                artifact_path.mkdir(parents=True, exist_ok=True)
                (artifact_path / "state.bin").write_bytes(b"synthetic-checkpoint")
            else:
                artifact_path.write_bytes(f"synthetic-{kind}".encode("utf-8"))
    artifact_manifest = onnx_training.create_training_artifact_manifest(artifact_dir, prefix=prefix)
    artifact_path = Path(artifact_manifest["manifestPath"])
    artifact_verification = onnx_training.verify_training_artifact_manifest(artifact_path)
    report["artifact"] = {
        "verified": bool(artifact_verification.get("verified")),
        "manifestPath": str(artifact_verification.get("manifestPath", artifact_path)),
        "manifestId": str(artifact_verification.get("manifestId", "") or ""),
        "manifestHash": str(artifact_verification.get("manifestHash", "") or ""),
        "errors": list(artifact_verification.get("errors", [])),
    }
    runtime_sources = []
    for target in onnx_training.TARGET_PLATFORMS:
        fragment_path = write_json(
            source_root / f"runtime-fragment-{target}.json",
            {
                "schemaVersion": 1,
                "targets": [
                    {
                        "target": target,
                        "trainingRuntimeAvailable": ok,
                        "trainingPackageAvailable": ok,
                        "gpuAvailable": target != "macos-x64",
                        "providers": ["CoreMLExecutionProvider", "CPUExecutionProvider"] if target == "macos-arm64" else ["CPUExecutionProvider"],
                        "primaryProvider": "CoreMLExecutionProvider" if target == "macos-arm64" else "CPUExecutionProvider",
                        "performanceTier": "high" if target == "macos-arm64" else "standard",
                        "trainingDurationMs": 1200 if ok else 0,
                        "measuredAtUnix": 1.0,
                        "packageSizeBytes": 250_000_000 if ok else 0,
                        "failureModes": ["cancelled", "out-of-memory"] if ok else [],
                        "status": "pass" if ok else "blocked",
                        "blockers": [] if ok else [f"training-runtime-unavailable:{target}"],
                    }
                ],
            },
        )
        runtime_sources.append(fragment_path)
    runtime_report = onnx_training.write_combined_target_runtime_study(
        source_root / "runtime-study.json",
        runtime_sources,
    )
    runtime_path = Path(runtime_report["studyPath"])
    validation_source_rows = validation_rows()
    validation_scores = [
        (0.96 if row["isMatch"] else 0.04) if ok else (0.04 if row["isMatch"] else 0.96)
        for row in validation_source_rows
    ]
    validation_report = onnx_training.write_phase5_validation_report(
        source_root / "validation.json",
        validation_source_rows,
        validation_scores,
        min_count=20,
        min_per_class=5,
    )
    validation_path = Path(validation_report["reportPath"])
    if ok:
        validation_report = add_synthetic_measurable_gain(validation_report)
        validation_path.write_text(json.dumps(validation_report, indent=2, sort_keys=True), encoding="utf-8")
        report["validation"]["source"] = str(validation_path)
        report["validation"]["status"] = validation_report["status"]
        report["validation"]["bestMetricGain"] = max(float(value) for value in validation_report["delta"].values())
        report["validation"]["delta"] = validation_report["delta"]
    report["runtime"]["source"] = str(runtime_path)
    report["evidenceFiles"] = [
        file_record(artifact_path, "artifact-manifest"),
        file_record(runtime_path, "runtime-study"),
        file_record(validation_path, "validation"),
    ]
    report["reportHash"] = onnx_training._sha256_json({key: value for key, value in report.items() if key != "reportHash"})  # noqa: SLF001 - verifier test fixture.
    return write_json(path, report)


def write_phase6_readiness(root: Path) -> tuple[Path, Path, Path]:
    legal_path = write_json(root / "legal.json", legal_payload())
    runtime_path = write_json(root / "runtime.json", runtime_payload())
    prereq_doc = root / "governance.md"
    prereq_doc.write_text("draft governance prerequisite", encoding="utf-8")
    report = retraining_governance.write_backbone_readiness_report(
        root / "backbone-readiness.json",
        legal_review_path=legal_path,
        runtime_study_path=runtime_path,
        prerequisite_docs=[prereq_doc],
    )
    return Path(report["reportPath"]), legal_path, runtime_path


def requirement(audit: dict, requirement_id: str) -> dict:
    for item in audit["requirements"]:
        if item["id"] == requirement_id:
            return item
    raise AssertionError(f"Missing requirement {requirement_id}")


def main() -> None:
    missing = self_learning_audit.self_learning_rd_audit()
    assert missing["ok"] is False, missing
    assert len(missing["requirements"]) == 6, missing
    assert all(item["status"] == "missing" for item in missing["requirements"]), missing
    assert "phase5.trainingArtifacts:phase5-report:phase5-decision-report-missing" in missing["blockers"], missing

    with tempfile.TemporaryDirectory(prefix="vintrace-self-learning-audit-") as raw:
        root = Path(raw)
        phase5_path = write_phase5_decision(root / "phase5-decision.json")
        phase6_path, legal_path, runtime_path = write_phase6_readiness(root / "phase6")
        audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=phase5_path,
            phase6_readiness_path=phase6_path,
        )
        assert audit["ok"] is True, audit
        assert all(item["status"] == "satisfied" for item in audit["requirements"]), audit
        assert audit["notProductionAuthorization"] is True

        audit_path = root / "self-learning-audit.json"
        written = self_learning_audit.write_self_learning_rd_audit(
            audit_path,
            phase5_decision_path=phase5_path,
            phase6_readiness_path=phase6_path,
        )
        assert Path(written["auditPath"]).is_file(), written
        verified_audit = self_learning_audit.verify_self_learning_rd_audit(audit_path)
        assert verified_audit["verified"] is True, verified_audit
        future_audit = json.loads(audit_path.read_text(encoding="utf-8"))
        future_audit["generatedAtUnix"] = time.time() + 10_000
        future_audit["reportHash"] = self_learning_audit._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_audit.items() if key != "reportHash"
        })
        future_audit_path = root / "self-learning-audit-future.json"
        future_audit_path.write_text(json.dumps(future_audit, indent=2, sort_keys=True), encoding="utf-8")
        future_audit_check = self_learning_audit.verify_self_learning_rd_audit(future_audit_path)
        assert future_audit_check["verified"] is False, future_audit_check
        assert "self-learning-audit-generated-at-future" in future_audit_check["errors"]
        invalid_bytes_audit_path = root / "self-learning-audit-invalid-bytes.json"
        invalid_bytes_audit_path.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_audit = self_learning_audit.verify_self_learning_rd_audit(invalid_bytes_audit_path)
        assert invalid_bytes_audit["verified"] is False, invalid_bytes_audit
        assert "self-learning-audit-invalid-json" in invalid_bytes_audit["errors"]
        inconsistent_audit = json.loads(audit_path.read_text(encoding="utf-8"))
        inconsistent_audit["requirements"][0]["ok"] = False
        inconsistent_audit["reportHash"] = self_learning_audit._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in inconsistent_audit.items() if key != "reportHash"
        })
        inconsistent_audit_path = root / "self-learning-audit-inconsistent.json"
        inconsistent_audit_path.write_text(json.dumps(inconsistent_audit, indent=2, sort_keys=True), encoding="utf-8")
        inconsistent_audit_check = self_learning_audit.verify_self_learning_rd_audit(inconsistent_audit_path)
        assert inconsistent_audit_check["verified"] is False, inconsistent_audit_check
        assert "self-learning-audit-ok-inconsistent" in inconsistent_audit_check["errors"]
        blockers_tamper = json.loads(audit_path.read_text(encoding="utf-8"))
        blockers_tamper["blockers"] = ["phase5.trainingArtifacts:invented-blocker"]
        blockers_tamper["reportHash"] = self_learning_audit._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in blockers_tamper.items() if key != "reportHash"
        })
        blockers_tamper_path = root / "self-learning-audit-bad-blockers.json"
        blockers_tamper_path.write_text(json.dumps(blockers_tamper, indent=2, sort_keys=True), encoding="utf-8")
        blockers_tamper_check = self_learning_audit.verify_self_learning_rd_audit(blockers_tamper_path)
        assert blockers_tamper_check["verified"] is False, blockers_tamper_check
        assert "self-learning-audit-blockers-inconsistent" in blockers_tamper_check["errors"]
        blocked_phase5 = onnx_training.write_phase5_go_no_go_report(root / "phase5-blocked-source.json")
        phase5_source_overclaim = json.loads(audit_path.read_text(encoding="utf-8"))
        phase5_source_overclaim["evidenceFiles"][0] = file_record(Path(blocked_phase5["reportPath"]), "phase5-decision-report")
        phase5_source_overclaim["reportHash"] = self_learning_audit._sha256_json({  # noqa: SLF001 - intentional source-overclaim test.
            key: value for key, value in phase5_source_overclaim.items() if key != "reportHash"
        })
        phase5_source_overclaim_path = root / "self-learning-audit-phase5-source-overclaim.json"
        phase5_source_overclaim_path.write_text(json.dumps(phase5_source_overclaim, indent=2, sort_keys=True), encoding="utf-8")
        phase5_source_overclaim_check = self_learning_audit.verify_self_learning_rd_audit(phase5_source_overclaim_path)
        assert phase5_source_overclaim_check["verified"] is False, phase5_source_overclaim_check
        assert "self-learning-audit-source-mismatch:requirements" in phase5_source_overclaim_check["errors"]
        assert "self-learning-audit-source-mismatch:blockers" in phase5_source_overclaim_check["errors"]
        blocked_phase6 = retraining_governance.write_governance_evidence_templates(root / "phase6-blocked-source")
        phase6_source_overclaim = json.loads(audit_path.read_text(encoding="utf-8"))
        phase6_source_overclaim["evidenceFiles"][1] = file_record(Path(blocked_phase6["readinessReportPath"]), "phase6-readiness-report")
        phase6_source_overclaim["reportHash"] = self_learning_audit._sha256_json({  # noqa: SLF001 - intentional source-overclaim test.
            key: value for key, value in phase6_source_overclaim.items() if key != "reportHash"
        })
        phase6_source_overclaim_path = root / "self-learning-audit-phase6-source-overclaim.json"
        phase6_source_overclaim_path.write_text(json.dumps(phase6_source_overclaim, indent=2, sort_keys=True), encoding="utf-8")
        phase6_source_overclaim_check = self_learning_audit.verify_self_learning_rd_audit(phase6_source_overclaim_path)
        assert phase6_source_overclaim_check["verified"] is False, phase6_source_overclaim_check
        assert "self-learning-audit-source-mismatch:requirements" in phase6_source_overclaim_check["errors"]
        assert "self-learning-audit-source-mismatch:blockers" in phase6_source_overclaim_check["errors"]
        cli_dir = root / "cli-audit"
        stdout = io.StringIO()
        with redirect_stdout(stdout):
            exit_code = self_learning_audit.main(
                [
                    str(cli_dir),
                    "--phase5-decision",
                    str(phase5_path),
                    "--phase6-readiness",
                    str(phase6_path),
                    "--audit-only",
                ]
            )
        assert exit_code == 0
        cli_audit_path = cli_dir / self_learning_audit.AUDIT_FILENAME
        assert cli_audit_path.is_file(), stdout.getvalue()
        assert self_learning_audit.verify_self_learning_rd_audit(cli_audit_path)["verified"] is True
        inconsistent_phase5_path = write_phase5_decision(root / "phase5-decision-inconsistent.json")
        inconsistent_phase5 = json.loads(inconsistent_phase5_path.read_text(encoding="utf-8"))
        inconsistent_phase5["runtime"]["ok"] = False
        inconsistent_phase5["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in inconsistent_phase5.items() if key != "reportHash"
        })
        inconsistent_phase5_path.write_text(json.dumps(inconsistent_phase5, indent=2, sort_keys=True), encoding="utf-8")
        inconsistent_phase5_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=inconsistent_phase5_path,
            phase6_readiness_path=phase6_path,
        )
        assert inconsistent_phase5_audit["ok"] is False, inconsistent_phase5_audit
        assert any("phase5-decision-report-ok-inconsistent" in blocker for blocker in inconsistent_phase5_audit["blockers"])

        tradeoff_base_path = write_phase5_decision(root / "phase5-decision-tradeoff-base.json")
        tradeoff_base = json.loads(tradeoff_base_path.read_text(encoding="utf-8"))
        tradeoff_evidence = {
            record["kind"]: Path(record["path"])
            for record in tradeoff_base["evidenceFiles"]
            if isinstance(record, dict)
        }
        tradeoff_validation_path = tradeoff_evidence["validation"]
        tradeoff_validation = json.loads(tradeoff_validation_path.read_text(encoding="utf-8"))
        tradeoff_validation["jsonAdapter"]["metrics"]["precision"] = 0.99
        tradeoff_validation["onnxHead"]["metrics"]["precision"] = 0.98
        tradeoff_validation["delta"]["precision"] = -0.01
        tradeoff_validation["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional metric-tradeoff fixture.
            key: value for key, value in tradeoff_validation.items() if key != "reportHash"
        })
        tradeoff_validation_path.write_text(json.dumps(tradeoff_validation, indent=2, sort_keys=True), encoding="utf-8")
        tradeoff_phase5 = onnx_training.write_phase5_go_no_go_report(
            root / "phase5-decision-tradeoff.json",
            artifact_manifest_path=tradeoff_evidence["artifact-manifest"],
            runtime_study_source=tradeoff_evidence["runtime-study"],
            validation_source=tradeoff_validation_path,
        )
        assert "validation:measurable-gain-regression:precision" in tradeoff_phase5["blockers"], tradeoff_phase5
        tradeoff_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=tradeoff_phase5["reportPath"],
            phase6_readiness_path=phase6_path,
        )
        assert tradeoff_audit["ok"] is False, tradeoff_audit
        assert requirement(tradeoff_audit, "phase5.measurableGain")["status"] == "blocked"
        assert any("validation:measurable-gain-regression:precision" in blocker for blocker in tradeoff_audit["blockers"])

        missing_runtime_evidence_phase5_path = write_phase5_decision(root / "phase5-decision-missing-runtime-evidence.json")
        missing_runtime_evidence_phase5 = json.loads(missing_runtime_evidence_phase5_path.read_text(encoding="utf-8"))
        del missing_runtime_evidence_phase5["runtime"]["targets"][0]["failureModes"]
        del missing_runtime_evidence_phase5["runtime"]["targets"][0]["providers"]
        missing_runtime_evidence_phase5["reportHash"] = onnx_training._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in missing_runtime_evidence_phase5.items() if key != "reportHash"
        })
        missing_runtime_evidence_phase5_path.write_text(json.dumps(missing_runtime_evidence_phase5, indent=2, sort_keys=True), encoding="utf-8")
        missing_runtime_evidence_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=missing_runtime_evidence_phase5_path,
            phase6_readiness_path=phase6_path,
        )
        assert missing_runtime_evidence_audit["ok"] is False, missing_runtime_evidence_audit
        assert requirement(missing_runtime_evidence_audit, "phase5.runtimeStudy")["status"] == "blocked"
        assert any("phase5-report:phase5-runtime-failure-modes-missing" in blocker for blocker in missing_runtime_evidence_audit["blockers"])
        assert any("phase5-report:phase5-runtime-providers-missing" in blocker for blocker in missing_runtime_evidence_audit["blockers"])

        missing_gpu_phase6 = json.loads(phase6_path.read_text(encoding="utf-8"))
        del missing_gpu_phase6["runtime"]["targets"][0]["gpuAvailable"]
        missing_gpu_phase6["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in missing_gpu_phase6.items() if key != "reportHash"
        })
        missing_gpu_phase6_path = root / "phase6-readiness-missing-gpu.json"
        missing_gpu_phase6_path.write_text(json.dumps(missing_gpu_phase6, indent=2, sort_keys=True), encoding="utf-8")
        missing_gpu_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=write_phase5_decision(root / "phase5-decision-ready-for-missing-gpu.json"),
            phase6_readiness_path=missing_gpu_phase6_path,
        )
        assert missing_gpu_audit["ok"] is False, missing_gpu_audit
        assert requirement(missing_gpu_audit, "phase6.gpuRuntimeStudy")["status"] == "blocked"
        assert any("phase6-report:readiness-report-gpu-availability-missing" in blocker for blocker in missing_gpu_audit["blockers"])

        row_blocker_runtime = json.loads(runtime_path.read_text(encoding="utf-8"))
        row_blocker_runtime["targets"][0]["failureModes"] = [""]
        row_blocker_runtime["targets"][0]["blockers"] = ["thermal-limit-unmeasured"]
        row_blocker_runtime_path = write_json(root / "phase6-runtime-row-blocker.json", row_blocker_runtime)
        row_blocker_phase6 = retraining_governance.write_backbone_readiness_report(
            root / "phase6-readiness-row-blocker.json",
            legal_review_path=legal_path,
            runtime_study_path=row_blocker_runtime_path,
            prerequisite_docs=[root / "phase6" / "governance.md"],
        )
        row_blocker_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=write_phase5_decision(root / "phase5-decision-ready-for-row-blocker.json"),
            phase6_readiness_path=row_blocker_phase6["reportPath"],
        )
        assert row_blocker_audit["ok"] is False, row_blocker_audit
        assert requirement(row_blocker_audit, "phase6.gpuRuntimeStudy")["status"] == "blocked"
        assert any("runtime:runtime-target-blocker" in blocker for blocker in row_blocker_audit["blockers"])

        bad_scope_legal = legal_payload()
        bad_scope_legal["scope"]["modelFamilies"] = ["buffalo_l", ""]
        bad_scope_legal["scope"]["biometricDataCategories"] = [" "]
        bad_scope_legal["scope"]["baseModelLicenses"][0]["modelFamily"] = "unreviewed_pack"
        bad_scope_legal_path = write_json(root / "phase6-legal-bad-scope.json", bad_scope_legal)
        bad_scope_phase6 = retraining_governance.write_backbone_readiness_report(
            root / "phase6-readiness-bad-legal-scope.json",
            legal_review_path=bad_scope_legal_path,
            runtime_study_path=runtime_path,
            prerequisite_docs=[root / "phase6" / "governance.md"],
        )
        bad_scope_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=write_phase5_decision(root / "phase5-decision-ready-for-bad-legal.json"),
            phase6_readiness_path=bad_scope_phase6["reportPath"],
        )
        assert bad_scope_audit["ok"] is False, bad_scope_audit
        assert requirement(bad_scope_audit, "phase6.legalReview")["status"] == "blocked"
        assert any("legal:legal-scope-item-invalid:modelFamilies" in blocker for blocker in bad_scope_audit["blockers"])
        assert any("legal:legal-license-model-unscoped" in blocker for blocker in bad_scope_audit["blockers"])
        assert any("legal:legal-license-missing-for-model:buffalo_l" in blocker for blocker in bad_scope_audit["blockers"])

        tampered_phase5 = json.loads(phase5_path.read_text(encoding="utf-8"))
        tampered_phase5["status"] = "go-for-production"
        phase5_path.write_text(json.dumps(tampered_phase5, indent=2, sort_keys=True), encoding="utf-8")
        tampered_phase5_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=phase5_path,
            phase6_readiness_path=phase6_path,
        )
        assert tampered_phase5_audit["ok"] is False, tampered_phase5_audit
        assert requirement(tampered_phase5_audit, "phase5.trainingArtifacts")["status"] == "blocked"
        assert any("phase5-decision-report-hash-mismatch" in blocker for blocker in tampered_phase5_audit["blockers"])

        legal = json.loads(legal_path.read_text(encoding="utf-8"))
        legal["reviewer"] = "Different Counsel"
        legal_path.write_text(json.dumps(legal, indent=2, sort_keys=True), encoding="utf-8")
        tampered_phase6_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=write_phase5_decision(root / "phase5-decision-ready.json"),
            phase6_readiness_path=phase6_path,
        )
        assert tampered_phase6_audit["ok"] is False, tampered_phase6_audit
        assert requirement(tampered_phase6_audit, "phase6.legalReview")["status"] == "blocked"
        assert any("evidence-file-mismatch:legal-review" in blocker for blocker in tampered_phase6_audit["blockers"])

        invalid_phase5 = root / "invalid-phase5.json"
        invalid_phase5.write_text("{", encoding="utf-8")
        invalid_audit = self_learning_audit.self_learning_rd_audit(
            phase5_decision_path=invalid_phase5,
            phase6_readiness_path=phase6_path,
        )
        assert requirement(invalid_audit, "phase5.trainingArtifacts")["status"] == "blocked", invalid_audit
        assert any("phase5-decision-report-invalid-json" in blocker for blocker in invalid_audit["blockers"])

    with tempfile.TemporaryDirectory(prefix="vintrace-self-learning-audit-bundle-") as raw:
        bundle = self_learning_audit.write_self_learning_rd_audit_bundle(Path(raw) / "bundle")
        assert Path(bundle["auditPath"]).is_file(), bundle
        assert Path(bundle["phase5"]["decisionReportPath"]).is_file(), bundle
        assert Path(bundle["phase6"]["readinessReportPath"]).is_file(), bundle
        assert bundle["audit"]["ok"] is False, bundle
        bundle_verification = self_learning_audit.verify_self_learning_rd_audit(bundle["auditPath"])
        assert bundle_verification["verified"] is True, bundle_verification

    print("self-learning audit units ok")


if __name__ == "__main__":
    main()

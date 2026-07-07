from __future__ import annotations

import contextlib
import io
import json
import tempfile
import time
from pathlib import Path

from crossage_fr.experiments import retraining_governance


def write_json(path: Path, payload: dict) -> Path:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    return path


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


def main() -> None:
    missing_legal = retraining_governance.legal_review_gate()
    assert missing_legal["ok"] is False
    assert "legal-review-file-missing" in missing_legal["blockers"]
    missing_runtime = retraining_governance.runtime_feasibility_gate()
    assert missing_runtime["ok"] is False
    assert "runtime-study-file-missing" in missing_runtime["blockers"]

    with tempfile.TemporaryDirectory(prefix="vintrace-retraining-governance-") as raw:
        root = Path(raw)
        invalid = root / "invalid.json"
        invalid.write_text("{", encoding="utf-8")
        assert retraining_governance.legal_review_gate(invalid)["status"] == "invalid-json"
        assert retraining_governance.runtime_feasibility_gate(invalid)["status"] == "invalid-json"

        bad_schema = legal_payload()
        bad_schema["schemaVersion"] = 999
        bad_schema_path = write_json(root / "bad-schema-legal.json", bad_schema)
        bad_schema_gate = retraining_governance.legal_review_gate(bad_schema_path)
        assert bad_schema_gate["ok"] is False
        assert "legal-review-schema-version-unsupported" in bad_schema_gate["blockers"]

        bad_date = legal_payload()
        bad_date["reviewedAt"] = "not-a-date"
        bad_date_path = write_json(root / "bad-date-legal.json", bad_date)
        bad_date_gate = retraining_governance.legal_review_gate(bad_date_path)
        assert bad_date_gate["ok"] is False
        assert "legal-review-date-invalid" in bad_date_gate["blockers"]

        future_date = legal_payload()
        future_date["reviewedAt"] = "2999-01-01"
        future_date_path = write_json(root / "future-date-legal.json", future_date)
        future_date_gate = retraining_governance.legal_review_gate(future_date_path)
        assert future_date_gate["ok"] is False
        assert "legal-review-date-future" in future_date_gate["blockers"]

        legal = legal_payload()
        del legal["topics"]["retentionScope"]
        partial_legal_path = write_json(root / "partial-legal.json", legal)
        partial_legal = retraining_governance.legal_review_gate(partial_legal_path)
        assert partial_legal["ok"] is False
        assert "legal-topic-missing:retentionScope" in partial_legal["blockers"]

        no_scope_legal = legal_payload()
        del no_scope_legal["scope"]["baseModelLicenses"]
        no_scope_path = write_json(root / "no-scope-legal.json", no_scope_legal)
        no_scope_gate = retraining_governance.legal_review_gate(no_scope_path)
        assert no_scope_gate["ok"] is False
        assert "legal-scope-missing:baseModelLicenses" in no_scope_gate["blockers"]

        blank_scope_array_legal = legal_payload()
        blank_scope_array_legal["scope"]["modelFamilies"] = [""]
        blank_scope_array_legal["scope"]["biometricDataCategories"] = [" "]
        blank_scope_array_path = write_json(root / "blank-scope-array-legal.json", blank_scope_array_legal)
        blank_scope_array_gate = retraining_governance.legal_review_gate(blank_scope_array_path)
        assert blank_scope_array_gate["ok"] is False
        assert "legal-scope-missing:modelFamilies" in blank_scope_array_gate["blockers"]
        assert "legal-scope-missing:biometricDataCategories" in blank_scope_array_gate["blockers"]
        assert "legal-scope-item-invalid:modelFamilies:0" in blank_scope_array_gate["blockers"]
        assert "legal-scope-item-invalid:biometricDataCategories:0" in blank_scope_array_gate["blockers"]

        missing_model_license_legal = legal_payload()
        missing_model_license_legal["scope"]["modelFamilies"] = ["buffalo_l", "buffalo_s"]
        missing_model_license_path = write_json(root / "missing-model-license-legal.json", missing_model_license_legal)
        missing_model_license_gate = retraining_governance.legal_review_gate(missing_model_license_path)
        assert missing_model_license_gate["ok"] is False
        assert "legal-license-missing-for-model:buffalo_s" in missing_model_license_gate["blockers"]

        unscoped_license_legal = legal_payload()
        unscoped_license_legal["scope"]["baseModelLicenses"][0]["modelFamily"] = "unreviewed_pack"
        unscoped_license_path = write_json(root / "unscoped-license-legal.json", unscoped_license_legal)
        unscoped_license_gate = retraining_governance.legal_review_gate(unscoped_license_path)
        assert unscoped_license_gate["ok"] is False
        assert "legal-license-model-unscoped:0" in unscoped_license_gate["blockers"]
        assert "legal-license-missing-for-model:buffalo_l" in unscoped_license_gate["blockers"]

        bad_license_legal = legal_payload()
        bad_license_legal["scope"]["baseModelLicenses"][0]["licenseStatus"] = "pending"
        bad_license_path = write_json(root / "bad-license-legal.json", bad_license_legal)
        bad_license_gate = retraining_governance.legal_review_gate(bad_license_path)
        assert bad_license_gate["ok"] is False
        assert "legal-license-not-approved:0" in bad_license_gate["blockers"]

        templates = retraining_governance.write_governance_evidence_templates(root / "templates")
        assert Path(templates["legalReviewTemplatePath"]).is_file(), templates
        assert Path(templates["runtimeStudyTemplatePath"]).is_file(), templates
        assert Path(templates["readinessReportPath"]).is_file(), templates
        assert templates["readiness"]["ok"] is False
        assert "legal-review-not-approved" in templates["readiness"]["blockers"]
        assert any(blocker.startswith("runtime-target-not-pass") for blocker in templates["readiness"]["blockers"])
        verified_template_report = retraining_governance.verify_backbone_readiness_report(templates["readinessReportPath"])
        assert verified_template_report["verified"] is True, verified_template_report

        draft_path = root / "legal-review-draft.json"
        draft = retraining_governance.write_legal_review_draft(draft_path)
        assert draft["created"] is True, draft
        assert draft["ok"] is False, draft
        assert "legal-review-not-approved" in draft["blockers"], draft
        draft_payload = json.loads(draft_path.read_text(encoding="utf-8"))
        draft_payload["reviewer"] = "Do not overwrite"
        draft_path.write_text(json.dumps(draft_payload, indent=2, sort_keys=True), encoding="utf-8")
        draft_again = retraining_governance.write_legal_review_draft(draft_path)
        assert draft_again["created"] is False, draft_again
        assert json.loads(draft_path.read_text(encoding="utf-8"))["reviewer"] == "Do not overwrite"

        init_cli_path = root / "cli-legal-review-draft.json"
        with contextlib.redirect_stdout(io.StringIO()) as init_cli_stdout:
            init_cli_status = retraining_governance.main(["--init-legal-review", str(init_cli_path)])
        assert init_cli_status == 0
        init_cli_payload = json.loads(init_cli_stdout.getvalue())
        assert init_cli_payload["mode"] == "init-legal-review", init_cli_payload
        assert init_cli_payload["created"] is True, init_cli_payload
        assert init_cli_payload["ok"] is False, init_cli_payload
        assert init_cli_path.is_file()

        with contextlib.redirect_stdout(io.StringIO()) as check_cli_stdout:
            check_cli_status = retraining_governance.main(["--check-legal-review", str(init_cli_path)])
        assert check_cli_status == 0
        check_cli_payload = json.loads(check_cli_stdout.getvalue())
        assert check_cli_payload["mode"] == "check-legal-review", check_cli_payload
        assert check_cli_payload["status"] == "blocked", check_cli_payload
        assert "legal-review-not-approved" in check_cli_payload["blockers"], check_cli_payload

        with contextlib.redirect_stdout(io.StringIO()) as mixed_cli_stdout:
            mixed_cli_status = retraining_governance.main([
                "--check-legal-review",
                str(init_cli_path),
                "--runtime-study",
                str(root / "runtime.json"),
            ])
        assert mixed_cli_status == 2
        assert "cannot be combined" in mixed_cli_stdout.getvalue()

        runtime = runtime_payload()
        runtime["targets"] = runtime["targets"][:-1]
        partial_runtime_path = write_json(root / "partial-runtime.json", runtime)
        partial_runtime = retraining_governance.runtime_feasibility_gate(partial_runtime_path)
        assert partial_runtime["ok"] is False
        assert any(blocker.startswith("runtime-target-missing") for blocker in partial_runtime["blockers"])

        bad_runtime_schema = runtime_payload()
        bad_runtime_schema["schemaVersion"] = 999
        bad_runtime_schema_path = write_json(root / "bad-runtime-schema.json", bad_runtime_schema)
        bad_runtime_schema_gate = retraining_governance.runtime_feasibility_gate(bad_runtime_schema_path)
        assert bad_runtime_schema_gate["ok"] is False
        assert "runtime-study-schema-version-unsupported" in bad_runtime_schema_gate["blockers"]

        legal_directory = root / "legal-directory.json"
        legal_directory.mkdir()
        unreadable_legal_gate = retraining_governance.legal_review_gate(legal_directory)
        assert unreadable_legal_gate["ok"] is False, unreadable_legal_gate
        assert any(blocker.startswith("legal-review-unreadable") for blocker in unreadable_legal_gate["blockers"])

        runtime_directory = root / "runtime-directory.json"
        runtime_directory.mkdir()
        unreadable_runtime_gate = retraining_governance.runtime_feasibility_gate(runtime_directory)
        assert unreadable_runtime_gate["ok"] is False, unreadable_runtime_gate
        assert any(blocker.startswith("runtime-study-unreadable") for blocker in unreadable_runtime_gate["blockers"])

        unreadable_readiness = retraining_governance.backbone_finetuning_readiness(
            legal_review_path=legal_directory,
            runtime_study_path=runtime_directory,
        )
        assert unreadable_readiness["ok"] is False, unreadable_readiness
        assert any(blocker.startswith("legal-review-unreadable") for blocker in unreadable_readiness["blockers"])
        assert any(blocker.startswith("runtime-study-unreadable") for blocker in unreadable_readiness["blockers"])

        legal_invalid_bytes_path = root / "legal-invalid-bytes.json"
        legal_invalid_bytes_path.write_bytes(b"\xff\xfe\xfa")
        legal_invalid_bytes_gate = retraining_governance.legal_review_gate(legal_invalid_bytes_path)
        assert legal_invalid_bytes_gate["ok"] is False, legal_invalid_bytes_gate
        assert "legal-review-invalid-json" in legal_invalid_bytes_gate["blockers"]

        runtime_invalid_bytes_path = root / "runtime-invalid-bytes.json"
        runtime_invalid_bytes_path.write_bytes(b"\xff\xfe\xfa")
        runtime_invalid_bytes_gate = retraining_governance.runtime_feasibility_gate(runtime_invalid_bytes_path)
        assert runtime_invalid_bytes_gate["ok"] is False, runtime_invalid_bytes_gate
        assert "runtime-study-invalid-json" in runtime_invalid_bytes_gate["blockers"]

        malformed_runtime = runtime_payload()
        malformed_runtime["targets"][0]["trainingDurationMs"] = "not-a-duration"
        malformed_runtime["targets"][0]["measuredAtUnix"] = time.time() + 10_000
        malformed_runtime["targets"][0]["packageSizeBytes"] = None
        del malformed_runtime["targets"][0]["gpuAvailable"]
        malformed_runtime["targets"][0]["failureModes"] = []
        malformed_runtime_path = write_json(root / "malformed-runtime.json", malformed_runtime)
        malformed_runtime_gate = retraining_governance.runtime_feasibility_gate(malformed_runtime_path)
        assert malformed_runtime_gate["ok"] is False
        first_target = retraining_governance.RUNTIME_TARGETS[0]
        assert f"training-duration-missing:{first_target}" in malformed_runtime_gate["blockers"]
        assert f"package-size-missing:{first_target}" in malformed_runtime_gate["blockers"]
        assert f"gpu-availability-missing:{first_target}" in malformed_runtime_gate["blockers"]
        assert f"failure-modes-missing:{first_target}" in malformed_runtime_gate["blockers"]
        assert f"runtime-target-measured-at-future:{first_target}" in malformed_runtime_gate["blockers"]

        duplicate_runtime = runtime_payload()
        duplicate_runtime["targets"].append(json.loads(json.dumps(duplicate_runtime["targets"][0])))
        duplicate_runtime_path = write_json(root / "duplicate-runtime.json", duplicate_runtime)
        duplicate_runtime_gate = retraining_governance.runtime_feasibility_gate(duplicate_runtime_path)
        assert duplicate_runtime_gate["ok"] is False, duplicate_runtime_gate
        assert f"runtime-target-duplicate:{first_target}" in duplicate_runtime_gate["blockers"]

        row_blocker_runtime = runtime_payload()
        row_blocker_runtime["targets"][0]["failureModes"] = [""]
        row_blocker_runtime["targets"][0]["blockers"] = ["thermal-limit-unmeasured"]
        row_blocker_runtime_path = write_json(root / "row-blocker-runtime.json", row_blocker_runtime)
        row_blocker_runtime_gate = retraining_governance.runtime_feasibility_gate(row_blocker_runtime_path)
        assert row_blocker_runtime_gate["ok"] is False, row_blocker_runtime_gate
        assert f"failure-modes-missing:{first_target}" in row_blocker_runtime_gate["blockers"]
        assert f"runtime-target-blocker:{first_target}:thermal-limit-unmeasured" in row_blocker_runtime_gate["blockers"]

        source_error_runtime = runtime_payload()
        source_error_runtime["scope"] = "phase5-onnx-training-runtime-study"
        source_error_runtime["status"] = "incomplete"
        source_error_runtime["sourceErrors"] = ["runtime-study-source-invalid-json:/tmp/source.json"]
        source_error_runtime_path = write_json(root / "source-error-runtime.json", source_error_runtime)
        source_error_runtime_gate = retraining_governance.runtime_feasibility_gate(source_error_runtime_path)
        assert source_error_runtime_gate["ok"] is False, source_error_runtime_gate
        assert "runtime-study-status-incomplete" in source_error_runtime_gate["blockers"]
        assert any(
            blocker.startswith("runtime-study-source-error:runtime-study-source-invalid-json")
            for blocker in source_error_runtime_gate["blockers"]
        )

        legal_path = write_json(root / "legal.json", legal_payload())
        runtime_path = write_json(root / "runtime.json", runtime_payload())
        prereq_doc = root / "governance.md"
        prereq_doc.write_text("draft governance prerequisite", encoding="utf-8")
        ready = retraining_governance.backbone_finetuning_readiness(
            legal_review_path=legal_path,
            runtime_study_path=runtime_path,
            prerequisite_docs=[prereq_doc],
        )
        assert ready["ok"] is True, ready
        assert ready["status"] == "ready-for-r-and-d"
        assert ready["notProductionAuthorization"] is True

        blocked_doc = retraining_governance.backbone_finetuning_readiness(
            legal_review_path=legal_path,
            runtime_study_path=runtime_path,
            prerequisite_docs=[root / "missing.md"],
        )
        assert blocked_doc["ok"] is False
        assert any(blocker.startswith("prerequisite-doc-missing") for blocker in blocked_doc["blockers"])

        report = retraining_governance.write_backbone_readiness_report(
            root / "exports" / "backbone-readiness.json",
            legal_review_path=legal_path,
            runtime_study_path=runtime_path,
            prerequisite_docs=[prereq_doc],
        )
        assert Path(report["reportPath"]).is_file()
        report_path = Path(report["reportPath"])
        assert json.loads(report_path.read_text(encoding="utf-8"))["ok"] is True
        verified_report = retraining_governance.verify_backbone_readiness_report(report_path)
        assert verified_report["verified"] is True, verified_report

        evidence_cli_output = root / "evidence-cli"
        with contextlib.redirect_stdout(io.StringIO()) as cli_stdout:
            cli_status = retraining_governance.main([
                str(evidence_cli_output),
                "--legal-review",
                str(legal_path),
                "--runtime-study",
                str(runtime_path),
                "--prerequisite-doc",
                str(prereq_doc),
            ])
        assert cli_status == 0
        assert '"mode": "evidence"' in cli_stdout.getvalue()
        evidence_report_path = evidence_cli_output / retraining_governance.READINESS_REPORT_FILENAME
        assert evidence_report_path.is_file()
        evidence_report = json.loads(evidence_report_path.read_text(encoding="utf-8"))
        assert evidence_report["ok"] is True, evidence_report
        evidence_report_check = retraining_governance.verify_backbone_readiness_report(evidence_report_path)
        assert evidence_report_check["verified"] is True, evidence_report_check

        with contextlib.redirect_stdout(io.StringIO()) as bad_cli_stdout:
            bad_cli_status = retraining_governance.main([str(root / "bad-cli"), "--legal-review"])
        assert bad_cli_status == 2
        assert "--legal-review requires a value" in bad_cli_stdout.getvalue()

        future_report = json.loads(report_path.read_text(encoding="utf-8"))
        future_report["generatedAtUnix"] = time.time() + 10_000
        future_report["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional future timestamp test.
            key: value for key, value in future_report.items() if key != "reportHash"
        })
        future_report_path = root / "exports" / "backbone-readiness-future.json"
        future_report_path.write_text(json.dumps(future_report, indent=2, sort_keys=True), encoding="utf-8")
        future_report_check = retraining_governance.verify_backbone_readiness_report(future_report_path)
        assert future_report_check["verified"] is False, future_report_check
        assert "readiness-report-generated-at-future" in future_report_check["errors"]
        invalid_bytes_report_path = root / "exports" / "backbone-readiness-invalid-bytes.json"
        invalid_bytes_report_path.write_bytes(b"\xff\xfe\xfa")
        invalid_bytes_report = retraining_governance.verify_backbone_readiness_report(invalid_bytes_report_path)
        assert invalid_bytes_report["verified"] is False, invalid_bytes_report
        assert "readiness-report-invalid-json" in invalid_bytes_report["errors"]
        inconsistent_payload = json.loads(report_path.read_text(encoding="utf-8"))
        inconsistent_payload["legal"]["ok"] = False
        inconsistent_payload["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in inconsistent_payload.items() if key != "reportHash"
        })
        inconsistent_path = root / "exports" / "backbone-readiness-inconsistent.json"
        inconsistent_path.write_text(json.dumps(inconsistent_payload, indent=2, sort_keys=True), encoding="utf-8")
        inconsistent_report = retraining_governance.verify_backbone_readiness_report(inconsistent_path)
        assert inconsistent_report["verified"] is False, inconsistent_report
        assert "readiness-report-ok-inconsistent" in inconsistent_report["errors"]

        missing_gpu_payload = json.loads(report_path.read_text(encoding="utf-8"))
        del missing_gpu_payload["runtime"]["targets"][0]["gpuAvailable"]
        missing_gpu_payload["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional semantic tamper test.
            key: value for key, value in missing_gpu_payload.items() if key != "reportHash"
        })
        missing_gpu_path = root / "exports" / "backbone-readiness-missing-gpu.json"
        missing_gpu_path.write_text(json.dumps(missing_gpu_payload, indent=2, sort_keys=True), encoding="utf-8")
        missing_gpu_report = retraining_governance.verify_backbone_readiness_report(missing_gpu_path)
        assert missing_gpu_report["verified"] is False, missing_gpu_report
        assert f"readiness-report-gpu-availability-missing:{retraining_governance.RUNTIME_TARGETS[0]}" in missing_gpu_report["errors"]

        legal_source_overclaim = retraining_governance.write_backbone_readiness_report(
            root / "exports" / "backbone-readiness-legal-source-overclaim.json",
            legal_review_path=partial_legal_path,
            runtime_study_path=runtime_path,
            prerequisite_docs=[prereq_doc],
        )
        legal_source_payload = json.loads(Path(legal_source_overclaim["reportPath"]).read_text(encoding="utf-8"))
        legal_source_payload["ok"] = True
        legal_source_payload["status"] = "ready-for-r-and-d"
        legal_source_payload["legal"] = ready["legal"]
        legal_source_payload["blockers"] = []
        legal_source_payload["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional source-summary overclaim.
            key: value for key, value in legal_source_payload.items() if key != "reportHash"
        })
        legal_source_overclaim_path = root / "exports" / "backbone-readiness-legal-source-overclaim-edited.json"
        legal_source_overclaim_path.write_text(json.dumps(legal_source_payload, indent=2, sort_keys=True), encoding="utf-8")
        legal_source_report = retraining_governance.verify_backbone_readiness_report(legal_source_overclaim_path)
        assert legal_source_report["verified"] is False, legal_source_report
        assert any(error.startswith("readiness-legal-source-mismatch") for error in legal_source_report["errors"])

        runtime_source_overclaim = retraining_governance.write_backbone_readiness_report(
            root / "exports" / "backbone-readiness-runtime-source-overclaim.json",
            legal_review_path=legal_path,
            runtime_study_path=malformed_runtime_path,
            prerequisite_docs=[prereq_doc],
        )
        runtime_source_payload = json.loads(Path(runtime_source_overclaim["reportPath"]).read_text(encoding="utf-8"))
        runtime_source_payload["ok"] = True
        runtime_source_payload["status"] = "ready-for-r-and-d"
        runtime_source_payload["runtime"] = ready["runtime"]
        runtime_source_payload["blockers"] = []
        runtime_source_payload["reportHash"] = retraining_governance._sha256_json({  # noqa: SLF001 - intentional source-summary overclaim.
            key: value for key, value in runtime_source_payload.items() if key != "reportHash"
        })
        runtime_source_overclaim_path = root / "exports" / "backbone-readiness-runtime-source-overclaim-edited.json"
        runtime_source_overclaim_path.write_text(json.dumps(runtime_source_payload, indent=2, sort_keys=True), encoding="utf-8")
        runtime_source_report = retraining_governance.verify_backbone_readiness_report(runtime_source_overclaim_path)
        assert runtime_source_report["verified"] is False, runtime_source_report
        assert any(error.startswith("readiness-runtime-source-mismatch") for error in runtime_source_report["errors"])

        tampered_legal = json.loads(legal_path.read_text(encoding="utf-8"))
        tampered_legal["reviewer"] = "Different Counsel"
        legal_path.write_text(json.dumps(tampered_legal, indent=2, sort_keys=True), encoding="utf-8")
        tampered_evidence = retraining_governance.verify_backbone_readiness_report(report_path)
        assert tampered_evidence["verified"] is False, tampered_evidence
        assert "evidence-file-mismatch:legal-review" in tampered_evidence["errors"]

        report_payload = json.loads(report_path.read_text(encoding="utf-8"))
        report_payload["status"] = "ready-for-production"
        report_path.write_text(json.dumps(report_payload, indent=2, sort_keys=True), encoding="utf-8")
        tampered_report = retraining_governance.verify_backbone_readiness_report(report_path)
        assert tampered_report["verified"] is False, tampered_report
        assert "readiness-report-hash-mismatch" in tampered_report["errors"]

    print("retraining governance units ok")


if __name__ == "__main__":
    main()

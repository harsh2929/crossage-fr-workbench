"""Fail-closed governance gates for true model retraining R&D.

These helpers do not grant legal approval. They make the required external
approvals and runtime studies machine-readable so backbone fine-tuning cannot be
mistaken for the already-implemented frozen-backbone learning loop.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence
from datetime import date
import hashlib
import json
import sys
import time

from crossage_fr.experiments import onnx_training
from crossage_fr.platform_detect import build_platform_report


LEGAL_TOPICS = [
    "derivativeWeightLicense",
    "biometricTrainingConsent",
    "withdrawalAndDeletion",
    "retentionScope",
    "exportAndBackupScope",
    "jurisdictionalBasis",
]

LEGAL_SCOPE_FIELDS = [
    "jurisdiction",
    "modelFamilies",
    "baseModelLicenses",
    "biometricDataCategories",
    "consentPolicyVersion",
    "retentionDays",
    "withdrawalProcedure",
    "exportBackupPolicy",
]

APPROVED_LICENSE_STATUSES = {
    "approved_for_internal_r_and_d",
    "approved_for_derivative_r_and_d",
}

RUNTIME_TARGETS = [
    "macos-arm64",
    "macos-x64",
    "windows-x64",
    "linux-x64",
]

LEGAL_TEMPLATE_FILENAME = "backbone_legal_review_template.json"
RUNTIME_TEMPLATE_FILENAME = "backbone_runtime_study_template.json"
READINESS_REPORT_FILENAME = "backbone_readiness_report.json"
MAX_EVIDENCE_FUTURE_SKEW_SECONDS = 300


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_json(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def _evidence_file_record(path: str | Path | None, kind: str) -> dict[str, Any]:
    if not path:
        return {"kind": kind, "path": "", "exists": False, "sizeBytes": 0, "sha256": ""}
    candidate = Path(path).expanduser()
    exists = candidate.is_file()
    return {
        "kind": kind,
        "path": str(candidate),
        "exists": exists,
        "sizeBytes": candidate.stat().st_size if exists else 0,
        "sha256": _sha256_file(candidate) if exists else "",
    }


def _read_json(path: str | Path) -> tuple[dict[str, Any] | None, str]:
    try:
        payload = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, "missing"
    except OSError as exc:
        return None, f"unreadable:{exc.__class__.__name__}"
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, "invalid-json"
    if not isinstance(payload, dict):
        return None, "not-object"
    return payload, ""


def _positive_int(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def _int_value(value: Any, default: int = -1) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


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


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _non_empty_string_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def _string_list_item_errors(value: Any, field: str) -> list[str]:
    if not isinstance(value, list):
        return []
    return [
        f"legal-scope-item-invalid:{field}:{index}"
        for index, item in enumerate(value)
        if not _non_empty_string(item)
    ]


def _schema_blocker(payload: dict[str, Any], prefix: str) -> str:
    return "" if payload.get("schemaVersion") == 1 else f"{prefix}-schema-version-unsupported"


def _date_blocker(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return "legal-review-date-invalid"
    if parsed > date.today():
        return "legal-review-date-future"
    return ""


def legal_review_template() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "decision": "pending",
        "reviewer": "",
        "reviewedAt": "",
        "topics": {topic: False for topic in LEGAL_TOPICS},
        "scope": {
            "jurisdiction": "",
            "modelFamilies": [],
            "baseModelLicenses": [
                {
                    "modelFamily": "",
                    "source": "",
                    "licenseStatus": "pending",
                    "notes": "",
                }
            ],
            "biometricDataCategories": [],
            "consentPolicyVersion": "",
            "retentionDays": 0,
            "withdrawalProcedure": "",
            "exportBackupPolicy": "",
        },
    }


def runtime_study_template() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "targets": [
            {
                "target": target,
                "trainingRuntimeAvailable": False,
                "gpuAvailable": False,
                "trainingDurationMs": 0,
                "measuredAtUnix": 0,
                "packageSizeBytes": 0,
                "failureModes": [],
                "status": "blocked",
                "notes": "",
            }
            for target in RUNTIME_TARGETS
        ],
    }


def write_governance_evidence_templates(output_dir: str | Path) -> dict[str, Any]:
    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    legal_path = output / LEGAL_TEMPLATE_FILENAME
    runtime_path = output / RUNTIME_TEMPLATE_FILENAME
    readiness_path = output / READINESS_REPORT_FILENAME
    legal_path.write_text(json.dumps(legal_review_template(), indent=2, sort_keys=True), encoding="utf-8")
    runtime_path.write_text(json.dumps(runtime_study_template(), indent=2, sort_keys=True), encoding="utf-8")
    readiness = write_backbone_readiness_report(
        readiness_path,
        legal_review_path=legal_path,
        runtime_study_path=runtime_path,
    )
    return {
        "ok": False,
        "outputDir": str(output),
        "legalReviewTemplatePath": str(legal_path),
        "runtimeStudyTemplatePath": str(runtime_path),
        "readinessReportPath": str(readiness_path),
        "readiness": readiness,
    }


def write_legal_review_draft(output_path: str | Path) -> dict[str, Any]:
    """Create a non-approved legal-review draft without overwriting real evidence."""

    path = Path(output_path).expanduser()
    created = False
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(legal_review_template(), indent=2, sort_keys=True), encoding="utf-8")
        created = True
    gate = legal_review_gate(path)
    return {
        "ok": gate["ok"],
        "created": created,
        "legalReviewPath": str(path),
        "status": gate["status"],
        "requiredTopics": gate["requiredTopics"],
        "requiredScopeFields": gate.get("requiredScopeFields", list(LEGAL_SCOPE_FIELDS)),
        "blockers": gate["blockers"],
        "message": gate["message"],
    }


def write_governance_readiness_from_evidence(
    output_dir: str | Path,
    *,
    legal_review_path: str | Path | None = None,
    runtime_study_path: str | Path | None = None,
    prerequisite_docs: Sequence[str | Path] | None = None,
) -> dict[str, Any]:
    """Write a readiness report from externally collected governance evidence."""

    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    readiness_path = output / READINESS_REPORT_FILENAME
    readiness = write_backbone_readiness_report(
        readiness_path,
        legal_review_path=legal_review_path,
        runtime_study_path=runtime_study_path,
        prerequisite_docs=prerequisite_docs or [],
    )
    return {
        "ok": readiness["ok"],
        "outputDir": str(output),
        "legalReviewPath": str(Path(legal_review_path).expanduser()) if legal_review_path else "",
        "runtimeStudyPath": str(Path(runtime_study_path).expanduser()) if runtime_study_path else "",
        "prerequisiteDocs": [str(Path(path).expanduser()) for path in prerequisite_docs or []],
        "readinessReportPath": str(readiness_path),
        "readiness": readiness,
    }


def legal_review_gate(path: str | Path | None = None) -> dict[str, Any]:
    if not path:
        return {
            "ok": False,
            "status": "missing",
            "path": "",
            "requiredTopics": list(LEGAL_TOPICS),
            "blockers": ["legal-review-file-missing"],
            "message": "Qualified counsel/DPO review is required before true model retraining.",
        }
    payload, error = _read_json(path)
    if payload is None:
        return {
            "ok": False,
            "status": error,
            "path": str(path),
            "requiredTopics": list(LEGAL_TOPICS),
            "blockers": [f"legal-review-{error}"],
            "message": "Legal review evidence is unreadable.",
        }
    topics = payload.get("topics") if isinstance(payload.get("topics"), dict) else {}
    approved = str(payload.get("decision", "") or "") == "approved_for_r_and_d"
    reviewer = str(payload.get("reviewer", "") or "").strip()
    reviewed_at = str(payload.get("reviewedAt", "") or "").strip()
    missing_topics = [topic for topic in LEGAL_TOPICS if topics.get(topic) is not True]
    scope = payload.get("scope") if isinstance(payload.get("scope"), dict) else {}
    blockers: list[str] = []
    schema_blocker = _schema_blocker(payload, "legal-review")
    if schema_blocker:
        blockers.append(schema_blocker)
    if not approved:
        blockers.append("legal-review-not-approved")
    if not reviewer:
        blockers.append("legal-review-reviewer-missing")
    if not reviewed_at:
        blockers.append("legal-review-date-missing")
    else:
        date_blocker = _date_blocker(reviewed_at)
        if date_blocker:
            blockers.append(date_blocker)
    blockers.extend(f"legal-topic-missing:{topic}" for topic in missing_topics)
    missing_scope_fields: list[str] = []
    if not _non_empty_string(scope.get("jurisdiction")):
        missing_scope_fields.append("jurisdiction")
    model_families = _non_empty_string_items(scope.get("modelFamilies"))
    if not model_families:
        missing_scope_fields.append("modelFamilies")
    blockers.extend(_string_list_item_errors(scope.get("modelFamilies"), "modelFamilies"))
    if not _non_empty_string_items(scope.get("biometricDataCategories")):
        missing_scope_fields.append("biometricDataCategories")
    blockers.extend(_string_list_item_errors(scope.get("biometricDataCategories"), "biometricDataCategories"))
    if not _non_empty_string(scope.get("consentPolicyVersion")):
        missing_scope_fields.append("consentPolicyVersion")
    if _positive_int(scope.get("retentionDays")) <= 0:
        missing_scope_fields.append("retentionDays")
    if not _non_empty_string(scope.get("withdrawalProcedure")):
        missing_scope_fields.append("withdrawalProcedure")
    if not _non_empty_string(scope.get("exportBackupPolicy")):
        missing_scope_fields.append("exportBackupPolicy")
    license_rows = scope.get("baseModelLicenses") if isinstance(scope.get("baseModelLicenses"), list) else []
    approved_license_models: set[str] = set()
    if not license_rows:
        missing_scope_fields.append("baseModelLicenses")
    else:
        for index, row in enumerate(license_rows):
            if not isinstance(row, dict):
                blockers.append(f"legal-license-row-invalid:{index}")
                continue
            model_family = str(row.get("modelFamily", "") or "").strip()
            if not model_family:
                blockers.append(f"legal-license-model-missing:{index}")
            elif model_family not in model_families:
                blockers.append(f"legal-license-model-unscoped:{index}")
            if not _non_empty_string(row.get("source")):
                blockers.append(f"legal-license-source-missing:{index}")
            license_approved = str(row.get("licenseStatus", "") or "") in APPROVED_LICENSE_STATUSES
            if not license_approved:
                blockers.append(f"legal-license-not-approved:{index}")
            elif model_family:
                approved_license_models.add(model_family)
    for model_family in model_families:
        if model_family not in approved_license_models:
            blockers.append(f"legal-license-missing-for-model:{model_family}")
    blockers.extend(f"legal-scope-missing:{field}" for field in missing_scope_fields)
    return {
        "ok": not blockers,
        "status": "approved" if not blockers else "blocked",
        "path": str(Path(path).expanduser()),
        "evidence": _evidence_file_record(path, "legal-review"),
        "requiredTopics": list(LEGAL_TOPICS),
        "requiredScopeFields": list(LEGAL_SCOPE_FIELDS),
        "reviewer": reviewer,
        "reviewedAt": reviewed_at,
        "decision": str(payload.get("decision", "") or ""),
        "missingTopics": missing_topics,
        "missingScopeFields": missing_scope_fields,
        "scope": scope,
        "blockers": blockers,
        "message": "Legal review permits R&D evaluation only." if not blockers else "Legal review evidence is incomplete or not approved.",
    }


def runtime_feasibility_gate(path: str | Path | None = None) -> dict[str, Any]:
    platform_report = build_platform_report()
    current = {
        "platformKey": platform_report.platform_key,
        "system": platform_report.system,
        "machine": platform_report.machine,
        "providers": platform_report.available_providers,
        "primaryProvider": platform_report.primary_provider,
        "performanceTier": platform_report.performance_tier,
        "memoryTotalBytes": platform_report.memory_total_bytes,
        "cpuLogicalCount": platform_report.cpu_logical_count,
        "trainingModules": onnx_training.dependency_feasibility_matrix()["installed"],
        "packageFootprint": onnx_training.installed_package_footprint(),
    }
    if not path:
        return {
            "ok": False,
            "status": "missing",
            "path": "",
            "requiredTargets": list(RUNTIME_TARGETS),
            "currentHost": current,
            "blockers": ["runtime-study-file-missing"],
            "message": "Target-device runtime, package, and failure-mode study is required before true model retraining.",
        }
    payload, error = _read_json(path)
    if payload is None:
        return {
            "ok": False,
            "status": error,
            "path": str(path),
            "requiredTargets": list(RUNTIME_TARGETS),
            "currentHost": current,
            "blockers": [f"runtime-study-{error}"],
            "message": "Runtime feasibility evidence is unreadable.",
        }
    blockers: list[str] = []
    schema_blocker = _schema_blocker(payload, "runtime-study")
    if schema_blocker:
        blockers.append(schema_blocker)
    scope = str(payload.get("scope", "") or "")
    if scope == "phase5-onnx-training-runtime-study":
        verification = onnx_training.verify_combined_target_runtime_study(path)
        if verification.get("verified") is not True:
            blockers.extend(f"runtime-study-report-invalid:{error}" for error in verification.get("errors", []))
        if str(payload.get("status", "") or "") != "complete":
            blockers.append("runtime-study-status-incomplete")
        raw_source_errors = payload.get("sourceErrors", [])
        if raw_source_errors and not isinstance(raw_source_errors, list):
            blockers.append("runtime-study-source-errors-invalid")
        if isinstance(raw_source_errors, list):
            blockers.extend(f"runtime-study-source-error:{error}" for error in raw_source_errors if str(error))
    raw_targets = payload.get("targets")
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
        if target_name not in RUNTIME_TARGETS:
            blockers.append(f"runtime-target-unknown:{target_name}")
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    for target in RUNTIME_TARGETS:
        row = by_target.get(target)
        if not row:
            blockers.append(f"runtime-target-missing:{target}")
            continue
        if row.get("trainingRuntimeAvailable") is not True:
            blockers.append(f"training-runtime-unavailable:{target}")
        if _positive_int(row.get("trainingDurationMs")) <= 0:
            blockers.append(f"training-duration-missing:{target}")
        blockers.extend(_runtime_target_timestamp_errors(row, target, "runtime-target-measured-at"))
        if _positive_int(row.get("packageSizeBytes")) <= 0:
            blockers.append(f"package-size-missing:{target}")
        if not isinstance(row.get("gpuAvailable"), bool):
            blockers.append(f"gpu-availability-missing:{target}")
        failure_modes = [str(mode).strip() for mode in row.get("failureModes", []) if str(mode).strip()] if isinstance(row.get("failureModes"), list) else []
        if not failure_modes:
            blockers.append(f"failure-modes-missing:{target}")
        raw_row_blockers = row.get("blockers", [])
        if raw_row_blockers and not isinstance(raw_row_blockers, list):
            blockers.append(f"runtime-target-blockers-invalid:{target}")
        if isinstance(raw_row_blockers, list):
            row_blockers = [str(item).strip() for item in raw_row_blockers if str(item).strip()]
            blockers.extend(f"runtime-target-blocker:{target}:{blocker}" for blocker in row_blockers)
        if str(row.get("status", "") or "") not in {"pass", "warn"}:
            blockers.append(f"runtime-target-not-pass:{target}")
    return {
        "ok": not blockers,
        "status": "complete" if not blockers else "blocked",
        "path": str(Path(path).expanduser()),
        "evidence": _evidence_file_record(path, "runtime-study"),
        "requiredTargets": list(RUNTIME_TARGETS),
        "currentHost": current,
        "targets": targets,
        "blockers": blockers,
        "message": "Runtime feasibility evidence is complete for R&D." if not blockers else "Runtime feasibility evidence is incomplete.",
    }


def backbone_finetuning_readiness(
    *,
    legal_review_path: str | Path | None = None,
    runtime_study_path: str | Path | None = None,
    prerequisite_docs: Sequence[str | Path] | None = None,
) -> dict[str, Any]:
    legal = legal_review_gate(legal_review_path)
    runtime = runtime_feasibility_gate(runtime_study_path)
    docs = []
    doc_blockers: list[str] = []
    for path in prerequisite_docs or []:
        candidate = Path(path).expanduser()
        exists = candidate.is_file()
        docs.append({"path": str(candidate), "exists": exists})
        if not exists:
            doc_blockers.append(f"prerequisite-doc-missing:{candidate}")
    blockers = [*legal["blockers"], *runtime["blockers"], *doc_blockers]
    evidence_records = [
        _evidence_file_record(legal_review_path, "legal-review"),
        _evidence_file_record(runtime_study_path, "runtime-study"),
        *[_evidence_file_record(path, "prerequisite-doc") for path in prerequisite_docs or []],
    ]
    return {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "ok": not blockers,
        "status": "ready-for-r-and-d" if not blockers else "blocked",
        "scope": "true-backbone-finetuning-r-and-d",
        "notProductionAuthorization": True,
        "legal": legal,
        "runtime": runtime,
        "prerequisiteDocs": docs,
        "evidenceFiles": evidence_records,
        "blockers": blockers,
        "message": (
            "Backbone fine-tuning R&D gates are satisfied; production remains separately prohibited until promotion/signing/release gates exist."
            if not blockers
            else "Backbone fine-tuning remains blocked by governance/runtime prerequisites."
        ),
    }


def write_backbone_readiness_report(output_path: str | Path, **kwargs: Any) -> dict[str, Any]:
    report = backbone_finetuning_readiness(**kwargs)
    path = Path(output_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    report["reportHash"] = _sha256_json({key: value for key, value in report.items() if key != "reportHash"})
    path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return {**report, "reportPath": str(path)}


def _string_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _runtime_gpu_evidence_errors(runtime: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    targets = runtime.get("targets") if isinstance(runtime.get("targets"), list) else []
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    for target in RUNTIME_TARGETS:
        row = by_target.get(target)
        if not row:
            errors.append(f"readiness-report-runtime-target-missing:{target}")
            continue
        if not isinstance(row.get("gpuAvailable"), bool):
            errors.append(f"readiness-report-gpu-availability-missing:{target}")
    return errors


def _source_summary_mismatch_errors(prefix: str, expected: dict[str, Any], actual: dict[str, Any], fields: Sequence[str]) -> list[str]:
    errors: list[str] = []
    for field in fields:
        if expected.get(field) != actual.get(field):
            errors.append(f"{prefix}:{field}")
    return errors


def _readiness_semantic_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("readiness-report-schema-version-unsupported")
    if payload.get("notProductionAuthorization") is not True:
        errors.append("readiness-report-authorization-scope-invalid")
    errors.extend(_unix_timestamp_errors(payload, "generatedAtUnix", "readiness-report-generated-at"))
    if str(payload.get("scope", "") or "") != "true-backbone-finetuning-r-and-d":
        errors.append("readiness-report-scope-invalid")
    if not isinstance(payload.get("ok"), bool):
        errors.append("readiness-report-ok-not-bool")
    ok = payload.get("ok") is True
    expected_status = "ready-for-r-and-d" if ok else "blocked"
    if str(payload.get("status", "") or "") != expected_status:
        errors.append("readiness-report-status-inconsistent")
    blockers = _string_items(payload.get("blockers"))
    if ok and blockers:
        errors.append("readiness-report-ok-with-blockers")
    if not ok and not blockers:
        errors.append("readiness-report-blockers-missing")
    legal = payload.get("legal") if isinstance(payload.get("legal"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    docs = payload.get("prerequisiteDocs") if isinstance(payload.get("prerequisiteDocs"), list) else []
    runtime_gpu_errors = _runtime_gpu_evidence_errors(runtime)
    errors.extend(runtime_gpu_errors)
    legal_ok = legal.get("ok") is True and str(legal.get("status", "") or "") == "approved" and not _string_items(legal.get("blockers"))
    runtime_ok = runtime.get("ok") is True and str(runtime.get("status", "") or "") == "complete" and not _string_items(runtime.get("blockers")) and not runtime_gpu_errors
    docs_ok = all(isinstance(row, dict) and row.get("exists") is True for row in docs)
    if ok != (legal_ok and runtime_ok and docs_ok):
        errors.append("readiness-report-ok-inconsistent")
    return errors


def verify_backbone_readiness_report(path: str | Path) -> dict[str, Any]:
    report_path = Path(path).expanduser()
    if not report_path.is_file():
        return {"verified": False, "path": str(report_path), "errors": ["readiness-report-missing"]}
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "path": str(report_path), "errors": ["readiness-report-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "path": str(report_path), "errors": [f"readiness-report-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "path": str(report_path), "errors": ["readiness-report-not-object"]}
    expected_hash = str(payload.get("reportHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "reportHash"})
    errors: list[str] = []
    if not expected_hash:
        errors.append("readiness-report-hash-missing")
    elif expected_hash != actual_hash:
        errors.append("readiness-report-hash-mismatch")
    errors.extend(_readiness_semantic_errors(payload))
    evidence_checks = []
    evidence_records = payload.get("evidenceFiles")
    if not isinstance(evidence_records, list) or not evidence_records:
        errors.append("readiness-report-evidence-missing")
        evidence_records = []
    for record in evidence_records:
        if not isinstance(record, dict):
            errors.append("evidence-record-invalid")
            continue
        kind = str(record.get("kind", "evidence") or "evidence")
        raw_path = str(record.get("path", "") or "")
        current = _evidence_file_record(raw_path, kind)
        ok = (
            bool(current["exists"]) == bool(record.get("exists"))
            and int(current["sizeBytes"]) == _int_value(record.get("sizeBytes", -1))
            and str(current["sha256"]) == str(record.get("sha256", "") or "")
        )
        if not ok:
            errors.append(f"evidence-file-mismatch:{record.get('kind', 'unknown')}")
        if raw_path and current["exists"]:
            if kind == "legal-review":
                source_legal = legal_review_gate(raw_path)
                embedded_legal = payload.get("legal") if isinstance(payload.get("legal"), dict) else {}
                errors.extend(
                    _source_summary_mismatch_errors(
                        "readiness-legal-source-mismatch",
                        source_legal,
                        embedded_legal,
                        (
                            "ok",
                            "status",
                            "path",
                            "requiredTopics",
                            "requiredScopeFields",
                            "reviewer",
                            "reviewedAt",
                            "decision",
                            "missingTopics",
                            "missingScopeFields",
                            "scope",
                            "blockers",
                        ),
                    )
                )
            elif kind == "runtime-study":
                source_runtime = runtime_feasibility_gate(raw_path)
                embedded_runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
                errors.extend(
                    _source_summary_mismatch_errors(
                        "readiness-runtime-source-mismatch",
                        source_runtime,
                        embedded_runtime,
                        ("ok", "status", "path", "requiredTargets", "targets", "blockers"),
                    )
                )
        evidence_checks.append({"expected": record, "current": current, "ok": ok})
    if payload.get("ok") is True:
        for record in evidence_records:
            if not isinstance(record, dict):
                continue
            if str(record.get("path", "") or "") == "" or record.get("exists") is not True:
                errors.append(f"evidence-file-required:{record.get('kind', 'unknown')}")
    return {
        "verified": not errors,
        "path": str(report_path),
        "reportHash": expected_hash,
        "errors": errors,
        "evidence": evidence_checks,
        "payload": payload,
    }


def _pop_option_value(args: list[str], option: str) -> str:
    if not args:
        raise ValueError(f"{option} requires a value")
    value = args.pop(0)
    if value.startswith("--"):
        raise ValueError(f"{option} requires a value")
    return value


def main(argv: Sequence[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    output = Path("benchmarks/results/backbone-governance-templates")
    if args and not args[0].startswith("--"):
        output = Path(args.pop(0)).expanduser()
    legal_review_path: str | None = None
    init_legal_review_path: str | None = None
    check_legal_review_path: str | None = None
    runtime_study_path: str | None = None
    prerequisite_docs: list[str] = []
    try:
        while args:
            option = args.pop(0)
            if option == "--legal-review":
                legal_review_path = _pop_option_value(args, option)
            elif option == "--init-legal-review":
                init_legal_review_path = _pop_option_value(args, option)
            elif option == "--check-legal-review":
                check_legal_review_path = _pop_option_value(args, option)
            elif option == "--runtime-study":
                runtime_study_path = _pop_option_value(args, option)
            elif option == "--prerequisite-doc":
                prerequisite_docs.append(_pop_option_value(args, option))
            else:
                raise ValueError(f"Unknown option: {option}")
        special_modes = [bool(init_legal_review_path), bool(check_legal_review_path)]
        if sum(1 for item in special_modes if item) > 1:
            raise ValueError("--init-legal-review and --check-legal-review cannot be combined")
        if (init_legal_review_path or check_legal_review_path) and (legal_review_path or runtime_study_path or prerequisite_docs):
            raise ValueError("Legal-review init/check mode cannot be combined with readiness evidence options")
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2, sort_keys=True))
        return 2
    if init_legal_review_path:
        draft = write_legal_review_draft(init_legal_review_path)
        summary = {
            "ok": draft["ok"],
            "mode": "init-legal-review",
            "created": draft["created"],
            "legalReviewPath": draft["legalReviewPath"],
            "status": draft["status"],
            "requiredTopics": draft["requiredTopics"],
            "requiredScopeFields": draft["requiredScopeFields"],
            "blockers": draft["blockers"],
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    if check_legal_review_path:
        gate = legal_review_gate(check_legal_review_path)
        summary = {
            "ok": gate["ok"],
            "mode": "check-legal-review",
            "legalReviewPath": gate["path"],
            "status": gate["status"],
            "decision": gate.get("decision", ""),
            "reviewer": gate.get("reviewer", ""),
            "reviewedAt": gate.get("reviewedAt", ""),
            "missingTopics": gate.get("missingTopics", []),
            "missingScopeFields": gate.get("missingScopeFields", []),
            "blockers": gate["blockers"],
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    if legal_review_path or runtime_study_path or prerequisite_docs:
        evidence = write_governance_readiness_from_evidence(
            output,
            legal_review_path=legal_review_path,
            runtime_study_path=runtime_study_path,
            prerequisite_docs=prerequisite_docs,
        )
        summary = {
            "ok": evidence["ok"],
            "mode": "evidence",
            "outputDir": evidence["outputDir"],
            "legalReviewPath": evidence["legalReviewPath"],
            "runtimeStudyPath": evidence["runtimeStudyPath"],
            "prerequisiteDocs": evidence["prerequisiteDocs"],
            "readinessReportPath": evidence["readinessReportPath"],
            "readinessStatus": evidence["readiness"]["status"],
            "blockers": evidence["readiness"]["blockers"],
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0
    templates = write_governance_evidence_templates(output)
    summary = {
        "ok": templates["ok"],
        "mode": "templates",
        "outputDir": templates["outputDir"],
        "legalReviewTemplatePath": templates["legalReviewTemplatePath"],
        "runtimeStudyTemplatePath": templates["runtimeStudyTemplatePath"],
        "readinessReportPath": templates["readinessReportPath"],
        "readinessStatus": templates["readiness"]["status"],
        "blockers": templates["readiness"]["blockers"],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

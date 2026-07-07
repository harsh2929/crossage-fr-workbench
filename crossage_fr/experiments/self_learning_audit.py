"""Unified fail-closed audit for the self-learning R&D checklist.

This module ties the Phase 5 ONNX-training decision report and the Phase 6
backbone-readiness report into one machine-readable status artifact. It does not
grant legal approval or production authorization; it only records whether the
remaining R&D checklist items have evidence strong enough to be treated as done.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Sequence
import argparse
import hashlib
import json
import sys
import time

from crossage_fr.experiments import onnx_training, retraining_governance


AUDIT_FILENAME = "self_learning_rd_audit.json"
MAX_EVIDENCE_FUTURE_SKEW_SECONDS = 300

PHASE5_REQUIREMENTS = [
    {
        "id": "phase5.trainingArtifacts",
        "label": "Generate required ORT training artifacts",
    },
    {
        "id": "phase5.runtimeStudy",
        "label": "Measure runtime, disk usage, package size, and failure modes",
    },
    {
        "id": "phase5.measurableGain",
        "label": "Prototype proves a measurable gain over the JSON adapter",
    },
    {
        "id": "phase5.packagingImpact",
        "label": "Packaging impact is understood",
    },
]

PHASE6_REQUIREMENTS = [
    {
        "id": "phase6.legalReview",
        "label": "Legal review for derivative weights and model licenses",
    },
    {
        "id": "phase6.gpuRuntimeStudy",
        "label": "GPU/runtime feasibility study",
    },
]

REQUIREMENT_IDS = [item["id"] for item in [*PHASE5_REQUIREMENTS, *PHASE6_REQUIREMENTS]]

PLAN_CHECKLIST_ITEMS = [
    {
        "requirementId": "phase5.trainingArtifacts",
        "text": "Generate required ORT training artifacts:",
    },
    {
        "requirementId": "phase5.runtimeStudy",
        "text": "Measure runtime, disk usage, package size, and failure modes.",
    },
    {
        "requirementId": "phase5.measurableGain",
        "text": "Prototype proves a measurable gain over the simpler adapter.",
    },
    {
        "requirementId": "phase5.packagingImpact",
        "text": "Packaging impact is understood.",
    },
    {
        "requirementId": "phase6.legalReview",
        "text": "Legal review for derivative weights and model licenses.",
    },
    {
        "requirementId": "phase6.gpuRuntimeStudy",
        "text": "GPU/runtime feasibility study.",
    },
]


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


def _int_value(value: Any, default: int = -1) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _float_value(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
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


def _blockers(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item)]


def _missing_from_errors(errors: Sequence[str]) -> bool:
    top_level_missing = {
        "phase5-decision-report-missing",
        "backbone-readiness-report-missing",
    }
    return any(error in top_level_missing for error in errors)


def _requirement(
    *,
    requirement_id: str,
    phase: str,
    label: str,
    ok: bool,
    evidence: dict[str, Any],
    blockers: Sequence[str] | None = None,
    missing: bool = False,
) -> dict[str, Any]:
    final_blockers = list(dict.fromkeys(str(blocker) for blocker in blockers or [] if str(blocker)))
    return {
        "id": requirement_id,
        "phase": phase,
        "label": label,
        "ok": bool(ok),
        "status": "satisfied" if ok else "missing" if missing else "blocked",
        "evidence": evidence,
        "blockers": [] if ok else final_blockers,
    }


def _phase5_report_context(path: str | Path | None) -> dict[str, Any]:
    if not path:
        return {
            "verified": False,
            "payload": {},
            "path": "",
            "reportHash": "",
            "errors": ["phase5-decision-report-missing"],
            "missing": True,
        }
    verification = onnx_training.verify_phase5_go_no_go_report(path)
    return {
        "verified": bool(verification.get("verified")),
        "payload": verification.get("payload") if isinstance(verification.get("payload"), dict) else {},
        "path": str(verification.get("path", path) or path),
        "reportHash": str(verification.get("reportHash", "") or ""),
        "errors": _blockers(verification.get("errors")),
        "missing": _missing_from_errors(_blockers(verification.get("errors"))),
    }


def _phase5_runtime_evidence_blockers(runtime: dict[str, Any]) -> list[str]:
    if runtime.get("ok") is not True:
        return []
    blockers: list[str] = []
    targets = runtime.get("targets") if isinstance(runtime.get("targets"), list) else []
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    for target in onnx_training.TARGET_PLATFORMS:
        row = by_target.get(target)
        if not row:
            blockers.append(f"runtime-target-missing:{target}")
            continue
        if row.get("trainingRuntimeAvailable") is not True:
            blockers.append(f"training-runtime-unavailable:{target}")
        if not isinstance(row.get("gpuAvailable"), bool):
            blockers.append(f"gpu-availability-missing:{target}")
        if not isinstance(row.get("failureModes"), list) or not row.get("failureModes"):
            blockers.append(f"failure-modes-missing:{target}")
        if not isinstance(row.get("providers"), list) or not row.get("providers"):
            blockers.append(f"providers-missing:{target}")
        if not str(row.get("primaryProvider", "") or ""):
            blockers.append(f"primary-provider-missing:{target}")
        if not str(row.get("performanceTier", "") or ""):
            blockers.append(f"performance-tier-missing:{target}")
    return blockers


def _phase5_validation_regression_blockers(validation: dict[str, Any]) -> list[str]:
    delta = validation.get("delta") if isinstance(validation.get("delta"), dict) else {}
    blockers: list[str] = []
    for metric in ("accuracy", "precision", "recall"):
        if _float_value(delta.get(metric)) < -0.000001:
            blockers.append(f"measurable-gain-regression:{metric}")
    return blockers


def _phase5_requirements(path: str | Path | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    context = _phase5_report_context(path)
    evidence = {
        "decisionReportPath": context["path"],
        "decisionReportHash": context["reportHash"],
        "decisionReportVerified": context["verified"],
    }
    if not context["verified"]:
        blockers = [f"phase5-report:{error}" for error in context["errors"]]
        return (
            [
                _requirement(
                    requirement_id=item["id"],
                    phase="phase5",
                    label=item["label"],
                    ok=False,
                    evidence=evidence,
                    blockers=blockers,
                    missing=context["missing"],
                )
                for item in PHASE5_REQUIREMENTS
            ],
            context,
        )

    payload = context["payload"]
    artifact = payload.get("artifact") if isinstance(payload.get("artifact"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}
    validation = payload.get("validation") if isinstance(payload.get("validation"), dict) else {}

    artifact_blockers = [f"artifact:{error}" for error in _blockers(artifact.get("errors"))]
    artifact_ok = artifact.get("verified") is True
    if not artifact_ok and not artifact_blockers:
        artifact_blockers.append("artifact:not-verified")

    runtime_evidence_blockers = _phase5_runtime_evidence_blockers(runtime)
    runtime_blockers = [f"runtime:{error}" for error in [*_blockers(runtime.get("blockers")), *runtime_evidence_blockers]]
    runtime_targets = runtime.get("targets") if isinstance(runtime.get("targets"), list) else []
    runtime_ok = runtime.get("ok") is True and not runtime_evidence_blockers
    if not runtime_ok and not runtime_blockers:
        runtime_blockers.append("runtime:not-complete")

    validation_regression_blockers = _phase5_validation_regression_blockers(validation)
    validation_blockers = [f"validation:{error}" for error in [*_blockers(validation.get("blockers")), *validation_regression_blockers]]
    min_gain = _float_value(validation.get("minMetricGain"), 0.01)
    best_gain = _float_value(validation.get("bestMetricGain"))
    validation_ok = validation.get("ok") is True and best_gain >= min_gain and not validation_regression_blockers
    if not validation_ok and not validation_blockers:
        validation_blockers.append("validation:measurable-gain-missing")

    total_package = _int_value(runtime.get("totalPackageSizeBytes"), 0)
    max_target_package = _int_value(runtime.get("maxTargetPackageSizeBytes"), 0)
    package_blockers = list(runtime_blockers)
    if total_package <= 0:
        package_blockers.append("runtime:total-package-size-missing")
    if max_target_package <= 0:
        package_blockers.append("runtime:target-package-size-missing")
    for target in runtime_targets:
        if not isinstance(target, dict):
            package_blockers.append("runtime:target-row-invalid")
            continue
        target_name = str(target.get("target", "") or "unknown")
        if _int_value(target.get("packageSizeBytes"), 0) <= 0:
            package_blockers.append(f"runtime:package-size-missing:{target_name}")
        if target.get("trainingPackageAvailable") is not True:
            package_blockers.append(f"runtime:training-package-unavailable:{target_name}")
    package_ok = runtime_ok and total_package > 0 and max_target_package > 0 and not package_blockers

    requirements = [
        _requirement(
            requirement_id="phase5.trainingArtifacts",
            phase="phase5",
            label="Generate required ORT training artifacts",
            ok=artifact_ok,
            evidence={**evidence, "artifact": artifact},
            blockers=artifact_blockers,
        ),
        _requirement(
            requirement_id="phase5.runtimeStudy",
            phase="phase5",
            label="Measure runtime, disk usage, package size, and failure modes",
            ok=runtime_ok,
            evidence={**evidence, "runtime": runtime},
            blockers=runtime_blockers,
        ),
        _requirement(
            requirement_id="phase5.measurableGain",
            phase="phase5",
            label="Prototype proves a measurable gain over the JSON adapter",
            ok=validation_ok,
            evidence={**evidence, "validation": validation},
            blockers=validation_blockers,
        ),
        _requirement(
            requirement_id="phase5.packagingImpact",
            phase="phase5",
            label="Packaging impact is understood",
            ok=package_ok,
            evidence={
                **evidence,
                "totalPackageSizeBytes": total_package,
                "maxTargetPackageSizeBytes": max_target_package,
                "runtimeTargets": runtime_targets,
            },
            blockers=sorted(set(package_blockers)),
        ),
    ]
    return requirements, context


def _phase6_report_context(path: str | Path | None) -> dict[str, Any]:
    if not path:
        return {
            "verified": False,
            "payload": {},
            "path": "",
            "reportHash": "",
            "errors": ["backbone-readiness-report-missing"],
            "missing": True,
        }
    verification = retraining_governance.verify_backbone_readiness_report(path)
    return {
        "verified": bool(verification.get("verified")),
        "payload": verification.get("payload") if isinstance(verification.get("payload"), dict) else {},
        "path": str(verification.get("path", path) or path),
        "reportHash": str(verification.get("reportHash", "") or ""),
        "errors": _blockers(verification.get("errors")),
        "missing": _missing_from_errors(_blockers(verification.get("errors"))),
    }


def _gpu_evidence_blockers(runtime: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    targets = runtime.get("targets") if isinstance(runtime.get("targets"), list) else []
    by_target = {str(row.get("target", "") or ""): row for row in targets if isinstance(row, dict)}
    for target in retraining_governance.RUNTIME_TARGETS:
        row = by_target.get(target)
        if not row:
            blockers.append(f"runtime-target-missing:{target}")
            continue
        if not isinstance(row.get("gpuAvailable"), bool):
            blockers.append(f"gpu-availability-missing:{target}")
    return blockers


def _phase6_requirements(path: str | Path | None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    context = _phase6_report_context(path)
    evidence = {
        "readinessReportPath": context["path"],
        "readinessReportHash": context["reportHash"],
        "readinessReportVerified": context["verified"],
    }
    if not context["verified"]:
        blockers = [f"phase6-report:{error}" for error in context["errors"]]
        return (
            [
                _requirement(
                    requirement_id=item["id"],
                    phase="phase6",
                    label=item["label"],
                    ok=False,
                    evidence=evidence,
                    blockers=blockers,
                    missing=context["missing"],
                )
                for item in PHASE6_REQUIREMENTS
            ],
            context,
        )

    payload = context["payload"]
    legal = payload.get("legal") if isinstance(payload.get("legal"), dict) else {}
    runtime = payload.get("runtime") if isinstance(payload.get("runtime"), dict) else {}

    legal_blockers = [f"legal:{error}" for error in _blockers(legal.get("blockers"))]
    legal_ok = legal.get("ok") is True
    if not legal_ok and not legal_blockers:
        legal_blockers.append("legal:not-approved")

    runtime_blockers = [f"runtime:{error}" for error in _blockers(runtime.get("blockers"))]
    runtime_blockers.extend(_gpu_evidence_blockers(runtime))
    runtime_ok = runtime.get("ok") is True and not _gpu_evidence_blockers(runtime)
    if not runtime_ok and not runtime_blockers:
        runtime_blockers.append("runtime:not-complete")

    requirements = [
        _requirement(
            requirement_id="phase6.legalReview",
            phase="phase6",
            label="Legal review for derivative weights and model licenses",
            ok=legal_ok,
            evidence={**evidence, "legal": legal},
            blockers=legal_blockers,
        ),
        _requirement(
            requirement_id="phase6.gpuRuntimeStudy",
            phase="phase6",
            label="GPU/runtime feasibility study",
            ok=runtime_ok,
            evidence={**evidence, "runtime": runtime},
            blockers=sorted(set(runtime_blockers)),
        ),
    ]
    return requirements, context


def self_learning_rd_audit(
    *,
    phase5_decision_path: str | Path | None = None,
    phase6_readiness_path: str | Path | None = None,
) -> dict[str, Any]:
    """Build a unified R&D checklist audit from existing Phase 5/6 evidence."""

    phase5_requirements, phase5_context = _phase5_requirements(phase5_decision_path)
    phase6_requirements, phase6_context = _phase6_requirements(phase6_readiness_path)
    requirements = [*phase5_requirements, *phase6_requirements]
    blockers = [
        f"{requirement['id']}:{blocker}"
        for requirement in requirements
        for blocker in requirement["blockers"]
    ]
    ok = all(requirement["ok"] for requirement in requirements)
    return {
        "schemaVersion": 1,
        "generatedAtUnix": round(time.time(), 3),
        "ok": ok,
        "status": "satisfied" if ok else "blocked",
        "scope": "self-learning-loop-r-and-d-checklist",
        "notProductionAuthorization": True,
        "sourceReports": {
            "phase5Decision": {
                "path": phase5_context["path"],
                "verified": phase5_context["verified"],
                "reportHash": phase5_context["reportHash"],
                "errors": phase5_context["errors"],
            },
            "phase6Readiness": {
                "path": phase6_context["path"],
                "verified": phase6_context["verified"],
                "reportHash": phase6_context["reportHash"],
                "errors": phase6_context["errors"],
            },
        },
        "evidenceFiles": [
            _evidence_file_record(phase5_context["path"], "phase5-decision-report"),
            _evidence_file_record(phase6_context["path"], "phase6-readiness-report"),
        ],
        "requirements": requirements,
        "blockers": blockers,
        "message": (
            "All self-learning R&D checklist evidence is satisfied. This is still not production authorization."
            if ok
            else "Self-learning R&D checklist remains blocked or incomplete; keep frozen-backbone learning as the production path."
        ),
    }


def write_self_learning_rd_audit(
    output_path: str | Path,
    *,
    phase5_decision_path: str | Path | None = None,
    phase6_readiness_path: str | Path | None = None,
) -> dict[str, Any]:
    audit = self_learning_rd_audit(
        phase5_decision_path=phase5_decision_path,
        phase6_readiness_path=phase6_readiness_path,
    )
    path = Path(output_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    audit["reportHash"] = _sha256_json({key: value for key, value in audit.items() if key != "reportHash"})
    path.write_text(json.dumps(audit, indent=2, sort_keys=True), encoding="utf-8")
    return {**audit, "auditPath": str(path)}


def _load_audit_source_with_errors(source: dict[str, Any] | str | Path | None) -> tuple[dict[str, Any], list[str]]:
    if isinstance(source, dict):
        return source, []
    if source is None:
        return self_learning_rd_audit(), []
    path = Path(source).expanduser()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return self_learning_rd_audit(), [f"self-learning-audit-file-missing:{path}"]
    except OSError as exc:
        return self_learning_rd_audit(), [f"self-learning-audit-unreadable:{path}:{exc.__class__.__name__}"]
    except (json.JSONDecodeError, UnicodeDecodeError):
        return self_learning_rd_audit(), [f"self-learning-audit-invalid-json:{path}"]
    if not isinstance(payload, dict):
        return self_learning_rd_audit(), [f"self-learning-audit-not-object:{path}"]
    return payload, []


def _load_audit_source(source: dict[str, Any] | str | Path | None) -> dict[str, Any]:
    payload, _errors = _load_audit_source_with_errors(source)
    return payload


def _plan_checkbox_state(markdown: str, text: str) -> bool | None:
    targets = {text.strip(), text.strip().rstrip(":")}
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line.startswith("- ["):
            continue
        if len(line) < 6 or line[4] != "]":
            continue
        body = line[5:].strip()
        if body in targets or body.rstrip(":") in targets:
            return line[3].lower() == "x"
    return None


def plan_checklist_consistency(
    plan_path: str | Path,
    *,
    audit: dict[str, Any] | str | Path | None = None,
) -> dict[str, Any]:
    """Check whether the markdown rollout checklist matches audit evidence."""

    plan = Path(plan_path).expanduser()
    try:
        markdown = plan.read_text(encoding="utf-8")
    except FileNotFoundError:
        return {
            "ok": False,
            "planPath": str(plan),
            "items": [],
            "blockers": ["plan-file-missing"],
        }
    audit_payload, load_errors = _load_audit_source_with_errors(audit)
    audit_errors = [*load_errors, *_audit_semantic_errors(audit_payload)]
    requirements = audit_payload.get("requirements") if isinstance(audit_payload.get("requirements"), list) and not audit_errors else []
    requirement_ok = {
        str(item.get("id", "") or ""): item.get("ok") is True
        for item in requirements
        if isinstance(item, dict)
    }
    items: list[dict[str, Any]] = []
    blockers: list[str] = [f"plan-audit-invalid:{error}" for error in audit_errors]
    for expected in PLAN_CHECKLIST_ITEMS:
        requirement_id = expected["requirementId"]
        checked = _plan_checkbox_state(markdown, expected["text"])
        audit_ok = requirement_ok.get(requirement_id, False)
        item_blockers: list[str] = []
        if checked is None:
            item_blockers.append(f"plan-checklist-missing:{requirement_id}")
        elif checked and not audit_ok:
            item_blockers.append(f"plan-checklist-premature:{requirement_id}")
        elif not checked and audit_ok:
            item_blockers.append(f"plan-checklist-stale-unchecked:{requirement_id}")
        items.append(
            {
                "requirementId": requirement_id,
                "text": expected["text"],
                "checked": checked,
                "auditOk": audit_ok,
                "ok": not item_blockers,
                "blockers": item_blockers,
            }
        )
        blockers.extend(item_blockers)
    return {
        "ok": not blockers,
        "planPath": str(plan),
        "items": items,
        "auditErrors": audit_errors,
        "blockers": blockers,
    }


def _expected_audit_blockers(requirements: Sequence[Any]) -> list[str]:
    blockers: list[str] = []
    for requirement in requirements:
        if not isinstance(requirement, dict):
            continue
        requirement_id = str(requirement.get("id", "") or "")
        for blocker in _blockers(requirement.get("blockers")):
            blockers.append(f"{requirement_id}:{blocker}")
    return blockers


def _source_report_verification_error(record: dict[str, Any]) -> str:
    kind = str(record.get("kind", "") or "")
    path = str(record.get("path", "") or "")
    if not path or record.get("exists") is not True:
        return ""
    if kind == "phase5-decision-report":
        verification = onnx_training.verify_phase5_go_no_go_report(path)
        return "" if verification.get("verified") is True else "source-report-invalid:phase5-decision-report"
    if kind == "phase6-readiness-report":
        verification = retraining_governance.verify_backbone_readiness_report(path)
        return "" if verification.get("verified") is True else "source-report-invalid:phase6-readiness-report"
    return ""


def _evidence_path(records: Sequence[Any], kind: str) -> str | None:
    for record in records:
        if not isinstance(record, dict):
            continue
        if str(record.get("kind", "") or "") == kind:
            path = str(record.get("path", "") or "")
            return path or None
    return None


def _audit_source_binding_errors(payload: dict[str, Any]) -> list[str]:
    evidence_records = payload.get("evidenceFiles") if isinstance(payload.get("evidenceFiles"), list) else []
    phase5_path = _evidence_path(evidence_records, "phase5-decision-report")
    phase6_path = _evidence_path(evidence_records, "phase6-readiness-report")
    expected = self_learning_rd_audit(
        phase5_decision_path=phase5_path,
        phase6_readiness_path=phase6_path,
    )
    errors: list[str] = []
    for field in ("ok", "status", "sourceReports", "requirements", "blockers", "message"):
        if payload.get(field) != expected.get(field):
            errors.append(f"self-learning-audit-source-mismatch:{field}")
    return errors


def _audit_semantic_errors(payload: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if payload.get("schemaVersion") != 1:
        errors.append("self-learning-audit-schema-version-unsupported")
    if str(payload.get("scope", "") or "") != "self-learning-loop-r-and-d-checklist":
        errors.append("self-learning-audit-scope-invalid")
    if payload.get("notProductionAuthorization") is not True:
        errors.append("self-learning-audit-authorization-scope-invalid")
    errors.extend(_unix_timestamp_errors(payload, "generatedAtUnix", "self-learning-audit-generated-at"))
    if not isinstance(payload.get("ok"), bool):
        errors.append("self-learning-audit-ok-not-bool")
    ok = payload.get("ok") is True
    expected_status = "satisfied" if ok else "blocked"
    if str(payload.get("status", "") or "") != expected_status:
        errors.append("self-learning-audit-status-inconsistent")
    requirements = payload.get("requirements") if isinstance(payload.get("requirements"), list) else []
    if not requirements:
        errors.append("self-learning-audit-requirements-missing")
    ids = [str(row.get("id", "") or "") for row in requirements if isinstance(row, dict)]
    if ids != REQUIREMENT_IDS:
        errors.append("self-learning-audit-requirements-incomplete")
    for requirement in requirements:
        if not isinstance(requirement, dict):
            errors.append("self-learning-audit-requirement-invalid")
            continue
        requirement_id = str(requirement.get("id", "") or "")
        requirement_ok = requirement.get("ok")
        status = str(requirement.get("status", "") or "")
        blockers = _blockers(requirement.get("blockers"))
        if not isinstance(requirement_ok, bool):
            errors.append(f"self-learning-audit-requirement-ok-not-bool:{requirement_id}")
            continue
        if requirement_ok:
            if status != "satisfied":
                errors.append(f"self-learning-audit-requirement-status-inconsistent:{requirement_id}")
            if blockers:
                errors.append(f"self-learning-audit-requirement-ok-with-blockers:{requirement_id}")
        else:
            if status not in {"blocked", "missing"}:
                errors.append(f"self-learning-audit-requirement-status-inconsistent:{requirement_id}")
            if not blockers:
                errors.append(f"self-learning-audit-requirement-blockers-missing:{requirement_id}")
    if ok != all(isinstance(row, dict) and row.get("ok") is True for row in requirements):
        errors.append("self-learning-audit-ok-inconsistent")
    actual_blockers = _blockers(payload.get("blockers"))
    expected_blockers = _expected_audit_blockers(requirements)
    if set(actual_blockers) != set(expected_blockers):
        errors.append("self-learning-audit-blockers-inconsistent")
    source_reports = payload.get("sourceReports") if isinstance(payload.get("sourceReports"), dict) else {}
    phase5 = source_reports.get("phase5Decision") if isinstance(source_reports.get("phase5Decision"), dict) else {}
    phase6 = source_reports.get("phase6Readiness") if isinstance(source_reports.get("phase6Readiness"), dict) else {}
    if ok:
        if phase5.get("verified") is not True or phase6.get("verified") is not True:
            errors.append("self-learning-audit-ok-with-unverified-source")
        evidence_files = payload.get("evidenceFiles") if isinstance(payload.get("evidenceFiles"), list) else []
        for kind in {"phase5-decision-report", "phase6-readiness-report"}:
            row = next((item for item in evidence_files if isinstance(item, dict) and item.get("kind") == kind), None)
            if not row or row.get("exists") is not True or not str(row.get("path", "") or ""):
                errors.append(f"self-learning-audit-evidence-file-required:{kind}")
    errors.extend(_audit_source_binding_errors(payload))
    return errors


def verify_self_learning_rd_audit(path: str | Path) -> dict[str, Any]:
    audit_path = Path(path).expanduser()
    if not audit_path.is_file():
        return {"verified": False, "path": str(audit_path), "errors": ["self-learning-audit-missing"]}
    try:
        payload = json.loads(audit_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"verified": False, "path": str(audit_path), "errors": ["self-learning-audit-invalid-json"]}
    except OSError as exc:
        return {"verified": False, "path": str(audit_path), "errors": [f"self-learning-audit-unreadable:{exc.__class__.__name__}"]}
    if not isinstance(payload, dict):
        return {"verified": False, "path": str(audit_path), "errors": ["self-learning-audit-not-object"]}
    expected_hash = str(payload.get("reportHash", "") or "")
    actual_hash = _sha256_json({key: value for key, value in payload.items() if key != "reportHash"})
    errors: list[str] = []
    if not expected_hash:
        errors.append("self-learning-audit-hash-missing")
    elif expected_hash != actual_hash:
        errors.append("self-learning-audit-hash-mismatch")
    errors.extend(_audit_semantic_errors(payload))
    evidence_checks = []
    evidence_records = payload.get("evidenceFiles")
    if not isinstance(evidence_records, list) or not evidence_records:
        errors.append("self-learning-audit-evidence-missing")
        evidence_records = []
    for record in evidence_records:
        if not isinstance(record, dict):
            errors.append("evidence-record-invalid")
            continue
        current = _evidence_file_record(record.get("path", ""), str(record.get("kind", "evidence") or "evidence"))
        ok = (
            bool(current["exists"]) == bool(record.get("exists"))
            and int(current["sizeBytes"]) == _int_value(record.get("sizeBytes"), -1)
            and str(current["sha256"]) == str(record.get("sha256", "") or "")
        )
        if not ok:
            errors.append(f"evidence-file-mismatch:{record.get('kind', 'unknown')}")
        source_error = _source_report_verification_error(record)
        if source_error:
            errors.append(source_error)
        evidence_checks.append({"expected": record, "current": current, "ok": ok})
    return {
        "verified": not errors,
        "path": str(audit_path),
        "reportHash": expected_hash,
        "errors": errors,
        "evidence": evidence_checks,
        "payload": payload,
    }


def write_self_learning_rd_audit_bundle(output_dir: str | Path) -> dict[str, Any]:
    output = Path(output_dir).expanduser()
    output.mkdir(parents=True, exist_ok=True)
    phase5 = onnx_training.write_phase5_measurement_bundle(output / "phase5")
    phase6 = retraining_governance.write_governance_evidence_templates(output / "phase6")
    audit = write_self_learning_rd_audit(
        output / AUDIT_FILENAME,
        phase5_decision_path=phase5["decisionReportPath"],
        phase6_readiness_path=phase6["readinessReportPath"],
    )
    return {
        "ok": audit["ok"],
        "outputDir": str(output),
        "phase5": phase5,
        "phase6": phase6,
        "audit": audit,
        "auditPath": audit["auditPath"],
    }


def _audit_output_path(output: Path) -> Path:
    return output if output.suffix == ".json" else output / AUDIT_FILENAME


def _parse_args(args: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write self-learning R&D evidence audit artifacts.",
    )
    parser.add_argument(
        "output",
        nargs="?",
        default="benchmarks/results/self-learning-rd-audit",
        help="Output folder for a generated bundle, or JSON path/folder for --audit-only.",
    )
    parser.add_argument(
        "--phase5-decision",
        default=None,
        help="Existing phase5_onnx_training_decision.json to verify and audit.",
    )
    parser.add_argument(
        "--phase6-readiness",
        default=None,
        help="Existing backbone_readiness_report.json to verify and audit.",
    )
    parser.add_argument(
        "--audit-only",
        action="store_true",
        help="Write only self_learning_rd_audit.json instead of generating fresh blocked evidence templates.",
    )
    return parser.parse_args(list(args))


def main(argv: Sequence[str] | None = None) -> int:
    parsed = _parse_args(list(argv if argv is not None else sys.argv[1:]))
    output = Path(parsed.output).expanduser()
    if parsed.audit_only or parsed.phase5_decision or parsed.phase6_readiness:
        audit_path = _audit_output_path(output)
        audit = write_self_learning_rd_audit(
            audit_path,
            phase5_decision_path=parsed.phase5_decision,
            phase6_readiness_path=parsed.phase6_readiness,
        )
        summary = {
            "ok": audit["ok"],
            "auditPath": audit["auditPath"],
            "status": audit["status"],
            "sourceReports": audit["sourceReports"],
            "satisfied": [item["id"] for item in audit["requirements"] if item["ok"]],
            "blocked": [item["id"] for item in audit["requirements"] if not item["ok"]],
            "blockers": audit["blockers"],
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0

    bundle = write_self_learning_rd_audit_bundle(output)
    audit = bundle["audit"]
    summary = {
        "ok": audit["ok"],
        "outputDir": bundle["outputDir"],
        "auditPath": bundle["auditPath"],
        "status": audit["status"],
        "satisfied": [item["id"] for item in audit["requirements"] if item["ok"]],
        "blocked": [item["id"] for item in audit["requirements"] if not item["ok"]],
        "blockers": audit["blockers"],
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

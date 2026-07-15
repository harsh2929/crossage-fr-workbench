from __future__ import annotations

from copy import deepcopy
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import sys
import time

from crossage_fr.workspace_registry import restrict_file_mode


POLICY_FILENAME = "policy.json"
POLICY_SHA256 = "1b5a466c5f39d1a7deecbbbe83e5a961e91473444385fd31f7ddf485d9ccb8e6"
STATE_SCHEMA_VERSION = 1
STATE_DIRECTORY = "model-lifecycle"
STATE_FILENAME = "state.json"
STATE_LOCK_FILENAME = ".state.lock"
STATE_LOCK_TIMEOUT_SECONDS = 5.0
STATE_LOCK_STALE_SECONDS = 30.0
ALLOWED_CONFIGURATION_FIELDS = (
    "modelPack",
    "modelRoot",
    "visionModelTier",
    "safeModeMultimodal",
)


class ModelLifecycleError(RuntimeError):
    """Base error for model lifecycle policy and state operations."""


class ModelLifecycleIntegrityError(ModelLifecycleError):
    """Raised when policy, evidence, dataset, or state integrity fails."""


class ModelLifecycleGateError(ModelLifecycleError):
    """Raised when an evaluation or promotion gate does not pass."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _source_root() -> Path:
    return Path(__file__).resolve().parents[1]


def policy_candidates() -> list[Path]:
    candidates: list[Path] = []
    if not _is_packaged():
        configured = str(os.environ.get("VINTRACE_MODEL_LIFECYCLE_POLICY", "") or "").strip()
        if configured:
            candidates.append(Path(configured).expanduser())
    bundle_root = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if bundle_root:
        candidates.append(Path(bundle_root) / "models" / "lifecycle" / POLICY_FILENAME)
    executable = Path(sys.executable).resolve()
    candidates.extend(
        [
            executable.parent / "models" / "lifecycle" / POLICY_FILENAME,
            executable.parent.parent / "models" / "lifecycle" / POLICY_FILENAME,
            _source_root() / "models" / "lifecycle" / POLICY_FILENAME,
        ]
    )
    output: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key not in seen:
            seen.add(key)
            output.append(candidate)
    return output


def resolve_policy_path(path: Path | str | None = None) -> Path:
    if path is not None:
        candidate = Path(path).expanduser().resolve()
        if _is_packaged() and candidate not in [item.resolve() for item in policy_candidates() if item.exists()]:
            raise ModelLifecycleIntegrityError("Packaged builds cannot override the model lifecycle policy.")
        return candidate
    for candidate in policy_candidates():
        if candidate.is_file():
            return candidate.resolve()
    raise ModelLifecycleIntegrityError("The model lifecycle policy is missing.")


def _resource_root_for_policy(policy_path: Path) -> Path:
    parts = policy_path.parts
    if len(parts) >= 3 and parts[-3:] == ("models", "lifecycle", POLICY_FILENAME):
        return policy_path.parents[2]
    return _source_root()


def _safe_resource_path(root: Path, relative: str) -> Path:
    text = str(relative or "").strip()
    candidate = Path(text)
    if not text or candidate.is_absolute() or ".." in candidate.parts:
        raise ModelLifecycleIntegrityError("Model lifecycle evidence paths must be relative and confined.")
    resolved_root = root.resolve()
    lexical = resolved_root
    for part in candidate.parts:
        lexical = lexical / part
        if lexical.is_symlink():
            raise ModelLifecycleIntegrityError("Model lifecycle evidence paths cannot contain symlinks.")
    resolved = lexical.resolve()
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise ModelLifecycleIntegrityError("Model lifecycle evidence escaped the resource root.") from exc
    return resolved


def _read_json_file(path: Path, *, max_bytes: int) -> tuple[Any, bytes]:
    try:
        stat = path.lstat()
    except OSError as exc:
        raise ModelLifecycleIntegrityError(f"Model lifecycle evidence is missing: {path.name}") from exc
    if path.is_symlink() or not path.is_file() or stat.st_size < 2 or stat.st_size > max_bytes:
        raise ModelLifecycleIntegrityError(f"Model lifecycle evidence is unsafe or oversized: {path.name}")
    try:
        raw = path.read_bytes()
        return json.loads(raw.decode("utf-8")), raw
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModelLifecycleIntegrityError(f"Model lifecycle evidence is unreadable: {path.name}") from exc


def _clean_policy_component(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ModelLifecycleIntegrityError("Every model lifecycle component must be an object.")
    component_id = str(value.get("id", "") or "").strip()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,63}", component_id):
        raise ModelLifecycleIntegrityError("A model lifecycle component id is invalid.")
    baseline = value.get("baseline")
    if not isinstance(baseline, dict):
        raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has no baseline.")
    digest = str(baseline.get("reportSha256", "") or "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has an invalid report digest.")
    datasets = value.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has no versioned dataset evidence.")
    for dataset in datasets:
        if not isinstance(dataset, dict):
            raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has invalid dataset evidence.")
        dataset_id = str(dataset.get("id", "") or "").strip()
        expected = str(dataset.get("manifestSha256", "") or "").lower()
        if not dataset_id or not str(dataset.get("version", "") or "").strip() or not re.fullmatch(r"[a-f0-9]{64}", expected):
            raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has incomplete dataset evidence.")
        if not str(dataset.get("manifestPath", "") or "").strip() and not str(dataset.get("reportJsonPath", "") or "").strip():
            raise ModelLifecycleIntegrityError(f"Model lifecycle dataset {dataset_id} has no verifiable artifact or report binding.")
        labels_path = str(dataset.get("labelsPath", "") or "").strip()
        labels_digest = str(dataset.get("labelsSha256", "") or "").lower()
        if labels_path and not re.fullmatch(r"[a-f0-9]{64}", labels_digest):
            raise ModelLifecycleIntegrityError(f"Model lifecycle dataset {dataset_id} has an invalid labels digest.")
    for check in baseline.get("requiredEquals", []):
        if not isinstance(check, dict) or not str(check.get("path", "") or "").strip() or "value" not in check:
            raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has an invalid equality gate.")
    for metric in baseline.get("metrics", []):
        if not isinstance(metric, dict) or metric.get("direction") not in {"higher", "lower"}:
            raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has an invalid metric gate.")
        if not str(metric.get("path", "") or "").strip():
            raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has an unnamed metric gate.")
    rollback = value.get("rollback") if isinstance(value.get("rollback"), dict) else {}
    if rollback.get("mode") not in {"configuration", "application-release"}:
        raise ModelLifecycleIntegrityError(f"Model lifecycle component {component_id} has an invalid rollback mode.")
    return deepcopy(value)


def load_policy(path: Path | str | None = None) -> dict[str, Any]:
    policy_path = resolve_policy_path(path)
    payload, raw = _read_json_file(policy_path, max_bytes=2 * 1024 * 1024)
    if path is None or policy_path in [item.resolve() for item in policy_candidates() if item.exists()]:
        if _hash_bytes(raw).lower() != POLICY_SHA256:
            raise ModelLifecycleIntegrityError("The model lifecycle policy failed its integrity check.")
    if not isinstance(payload, dict):
        raise ModelLifecycleIntegrityError("The model lifecycle policy must be an object.")
    if (
        payload.get("schemaVersion") != 1
        or payload.get("policyId") != "vintrace-model-lifecycle"
        or payload.get("offlineOnly") is not True
        or not re.fullmatch(r"20\d\d-\d\d-\d\d\.\d+", str(payload.get("version", "") or ""))
    ):
        raise ModelLifecycleIntegrityError("The model lifecycle policy contract is invalid.")
    components = payload.get("components")
    if not isinstance(components, list) or len(components) < 6:
        raise ModelLifecycleIntegrityError("The model lifecycle policy has incomplete component coverage.")
    cleaned = [_clean_policy_component(component) for component in components]
    ids = [str(component["id"]) for component in cleaned]
    if len(ids) != len(set(ids)):
        raise ModelLifecycleIntegrityError("The model lifecycle policy contains duplicate components.")
    payload = {**payload, "components": cleaned, "policySha256": _hash_bytes(raw), "policyPath": str(policy_path)}
    return payload


def _json_path(value: Any, path: str) -> Any:
    current = value
    for part in str(path or "").split("."):
        if isinstance(current, list):
            if not part.isdigit() or int(part) >= len(current):
                raise KeyError(path)
            current = current[int(part)]
        elif isinstance(current, dict) and part in current:
            current = current[part]
        else:
            raise KeyError(path)
    return current


def _number(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ModelLifecycleGateError(f"Metric {path} is not numeric.")
    result = float(value)
    if not math.isfinite(result):
        raise ModelLifecycleGateError(f"Metric {path} is not finite.")
    return result


def _evaluate_report(
    component: Mapping[str, Any],
    report: Any,
    *,
    baseline_report: Any | None = None,
) -> dict[str, Any]:
    baseline = component["baseline"]
    failures: list[str] = []
    checks: list[dict[str, Any]] = []
    for requirement in baseline.get("requiredEquals", []):
        path = str(requirement["path"])
        expected = requirement["value"]
        try:
            actual = _json_path(report, path)
            ok = actual == expected and type(actual) is type(expected)
        except KeyError:
            actual = None
            ok = False
        checks.append({"kind": "equals", "path": path, "ok": ok, "expected": expected, "actual": actual})
        if not ok:
            failures.append(f"{path} did not equal the required value.")
    metrics: list[dict[str, Any]] = []
    for gate in baseline.get("metrics", []):
        path = str(gate["path"])
        try:
            actual = _number(_json_path(report, path), path)
        except (KeyError, ModelLifecycleGateError) as exc:
            failures.append(str(exc) if str(exc) else f"Metric {path} is missing.")
            metrics.append({"path": path, "ok": False, "actual": None})
            continue
        metric_failures: list[str] = []
        if "minimum" in gate and actual < float(gate["minimum"]):
            metric_failures.append(f"below minimum {gate['minimum']}")
        if "maximum" in gate and actual > float(gate["maximum"]):
            metric_failures.append(f"above maximum {gate['maximum']}")
        baseline_value: float | None = None
        if baseline_report is not None:
            try:
                baseline_value = _number(_json_path(baseline_report, path), path)
            except (KeyError, ModelLifecycleGateError):
                metric_failures.append("baseline metric is unavailable")
            if baseline_value is not None:
                direction = str(gate["direction"])
                if "maxRegressionAbsolute" in gate:
                    tolerance = float(gate["maxRegressionAbsolute"])
                    if direction == "higher" and actual < baseline_value - tolerance:
                        metric_failures.append(f"regressed more than {tolerance:g}")
                    if direction == "lower" and actual > baseline_value + tolerance:
                        metric_failures.append(f"regressed more than {tolerance:g}")
                if "maxRegressionPercent" in gate:
                    tolerance = abs(baseline_value) * float(gate["maxRegressionPercent"]) / 100.0
                    if direction == "higher" and actual < baseline_value - tolerance:
                        metric_failures.append(f"regressed more than {gate['maxRegressionPercent']}%")
                    if direction == "lower" and actual > baseline_value + tolerance:
                        metric_failures.append(f"regressed more than {gate['maxRegressionPercent']}%")
        ok = not metric_failures
        metrics.append(
            {
                "path": path,
                "direction": gate["direction"],
                "actual": actual,
                "baseline": baseline_value,
                "ok": ok,
                "failures": metric_failures,
            }
        )
        failures.extend(f"{path}: {failure}." for failure in metric_failures)
    return {"passed": not failures, "checks": checks, "metrics": metrics, "failures": failures}


def _verify_datasets(component: Mapping[str, Any], resource_root: Path, report: Any) -> list[dict[str, Any]]:
    datasets: list[dict[str, Any]] = []
    for dataset in component.get("datasets", []):
        if not isinstance(dataset, dict):
            continue
        row = {
            "id": str(dataset.get("id", "") or ""),
            "version": str(dataset.get("version", "") or ""),
            "kind": str(dataset.get("kind", "") or ""),
            "claimBoundary": str(dataset.get("claimBoundary", "") or ""),
            "verified": True,
            "verification": "",
        }
        verifications: list[str] = []
        for path_key, digest_key in (("manifestPath", "manifestSha256"), ("labelsPath", "labelsSha256")):
            relative = str(dataset.get(path_key, "") or "").strip()
            if not relative:
                continue
            path = _safe_resource_path(resource_root, relative)
            expected = str(dataset.get(digest_key, "") or "").lower()
            actual = _hash_file(path) if path.is_file() and not path.is_symlink() else ""
            if not re.fullmatch(r"[a-f0-9]{64}", expected) or actual.lower() != expected:
                row["verified"] = False
                row["verification"] = f"{path_key} failed"
            else:
                verifications.append(path_key)
        report_path = str(dataset.get("reportJsonPath", "") or "").strip()
        if report_path:
            expected = str(dataset.get("manifestSha256", "") or "").lower()
            try:
                actual = _json_path(report, report_path)
            except KeyError:
                actual = None
            if not isinstance(actual, str) or actual.lower() != expected:
                row["verified"] = False
                row["verification"] = "reportJsonPath failed"
            else:
                verifications.append("report-binding")
        if row["verified"]:
            row["verification"] = "+".join(verifications) + "-verified"
        datasets.append(row)
    return datasets


def evaluate_component(
    component: Mapping[str, Any],
    *,
    resource_root: Path,
    candidate_report_path: Path | str | None = None,
    max_bytes: int = 16 * 1024 * 1024,
) -> dict[str, Any]:
    baseline_path = _safe_resource_path(resource_root, str(component["baseline"]["reportPath"]))
    baseline_report, baseline_raw = _read_json_file(baseline_path, max_bytes=max_bytes)
    baseline_digest = _hash_bytes(baseline_raw)
    expected_digest = str(component["baseline"]["reportSha256"]).lower()
    baseline_integrity = baseline_digest == expected_digest
    baseline_result = _evaluate_report(component, baseline_report) if baseline_integrity else {
        "passed": False,
        "checks": [],
        "metrics": [],
        "failures": ["The accepted baseline report digest drifted."],
    }
    datasets = _verify_datasets(component, resource_root, baseline_report)
    if any(not item["verified"] for item in datasets):
        baseline_result = {
            **baseline_result,
            "passed": False,
            "failures": [*baseline_result["failures"], "A versioned dataset or fixture manifest drifted."],
        }
    candidate: dict[str, Any] | None = None
    if candidate_report_path is not None:
        candidate_source = Path(candidate_report_path).expanduser()
        if candidate_source.is_symlink():
            raise ModelLifecycleIntegrityError("A candidate model evaluation report cannot be a symlink.")
        candidate_path = candidate_source.resolve()
        candidate_report, candidate_raw = _read_json_file(candidate_path, max_bytes=max_bytes)
        candidate_result = _evaluate_report(component, candidate_report, baseline_report=baseline_report)
        candidate_datasets = _verify_datasets(component, resource_root, candidate_report)
        if any(not item["verified"] for item in candidate_datasets):
            candidate_result = {
                **candidate_result,
                "passed": False,
                "failures": [*candidate_result["failures"], "A candidate dataset or fixture binding drifted."],
            }
        candidate = {
            **candidate_result,
            "reportSha256": _hash_bytes(candidate_raw),
            "reportBytes": len(candidate_raw),
            "reportName": candidate_path.name,
            "datasets": candidate_datasets,
        }
    return {
        "id": str(component["id"]),
        "label": str(component.get("label", component["id"])),
        "family": str(component.get("family", "")),
        "runtimeProbe": str(component.get("runtimeProbe", "")),
        "requiredWhenInstalled": bool(component.get("requiredWhenInstalled", True)),
        "baseline": {
            **baseline_result,
            "integrity": baseline_integrity,
            "reportSha256": baseline_digest,
            "reportName": baseline_path.name,
        },
        "candidate": candidate,
        "datasets": datasets,
        "rollback": deepcopy(component.get("rollback", {})),
    }


def _clean_runtime_inventory(value: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    output: dict[str, dict[str, Any]] = {}
    for component_id, raw in (value or {}).items():
        if not isinstance(raw, Mapping):
            continue
        output[str(component_id)] = {
            "installed": bool(raw.get("installed", raw.get("available", False))),
            "available": bool(raw.get("available", False)),
            "verified": bool(raw.get("verified", False)),
            "version": str(raw.get("version", "") or "")[:200],
            "fingerprint": str(raw.get("fingerprint", "") or "").lower()[:128],
            "reason": str(raw.get("reason", "") or "")[:500],
        }
    return output


def evaluate_model_lifecycle(
    *,
    runtime_inventory: Mapping[str, Any] | None = None,
    candidate_reports: Mapping[str, Path | str] | None = None,
    policy: Mapping[str, Any] | None = None,
    resource_root: Path | None = None,
    accepted_state: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    loaded_policy = deepcopy(dict(policy)) if policy is not None else load_policy()
    policy_path = Path(str(loaded_policy.get("policyPath", "") or resolve_policy_path()))
    root = resource_root.resolve() if resource_root is not None else _resource_root_for_policy(policy_path)
    inventory = _clean_runtime_inventory(runtime_inventory)
    candidates = candidate_reports or {}
    accepted = accepted_state.get("accepted", {}) if isinstance(accepted_state, Mapping) and isinstance(accepted_state.get("accepted"), dict) else {}
    rows: list[dict[str, Any]] = []
    blockers: list[str] = []
    warnings: list[str] = []
    for component in loaded_policy["components"]:
        component_id = str(component["id"])
        row = evaluate_component(
            component,
            resource_root=root,
            candidate_report_path=candidates.get(component_id),
            max_bytes=int(loaded_policy.get("candidateReportMaxBytes", 16 * 1024 * 1024)),
        )
        runtime = inventory.get(component_id, {
            "installed": False,
            "available": False,
            "verified": False,
            "version": "",
            "fingerprint": "",
            "reason": "Runtime probe not supplied.",
        })
        failures: list[str] = list(row["baseline"]["failures"])
        status = "pass"
        if runtime["installed"] and not runtime["verified"]:
            failures.append(runtime["reason"] or "Installed runtime integrity is not verified.")
        if runtime["installed"] and not re.fullmatch(r"[a-f0-9]{64}", runtime["fingerprint"]):
            failures.append("Installed runtime fingerprint is missing or invalid.")
        active = accepted.get(component_id) if isinstance(accepted.get(component_id), dict) else {}
        accepted_fingerprint = str(active.get("runtimeFingerprint", "") or "").lower()
        if accepted_fingerprint and runtime["fingerprint"] and accepted_fingerprint != runtime["fingerprint"]:
            failures.append("The active runtime fingerprint drifted from the promoted evaluation baseline.")
        if failures:
            status = "blocked"
            blockers.append(f"{row['label']}: {failures[0]}")
        elif not runtime["installed"]:
            status = "not-installed"
            warnings.append(f"{row['label']}: optional runtime is not installed on this device.")
        elif not runtime["available"]:
            status = "unavailable"
            warnings.append(f"{row['label']}: {runtime['reason'] or 'runtime unavailable'}")
        elif row.get("candidate") is not None and not row["candidate"]["passed"]:
            status = "candidate-rejected"
        row["runtime"] = runtime
        row["activeBaseline"] = deepcopy(active) if active else {
            "source": "bundled-policy",
            "reportSha256": row["baseline"]["reportSha256"],
            "runtimeFingerprint": "",
        }
        row["status"] = status
        row["failures"] = failures
        rows.append(row)
    counts = {
        "components": len(rows),
        "passed": sum(1 for row in rows if row["status"] == "pass"),
        "notInstalled": sum(1 for row in rows if row["status"] == "not-installed"),
        "unavailable": sum(1 for row in rows if row["status"] == "unavailable"),
        "blocked": sum(1 for row in rows if row["status"] == "blocked"),
        "candidateRejected": sum(1 for row in rows if row["status"] == "candidate-rejected"),
        "datasetManifests": sum(len(row["datasets"]) for row in rows),
        "datasetManifestsVerified": sum(sum(1 for item in row["datasets"] if item["verified"]) for row in rows),
    }
    return {
        "schemaVersion": 1,
        "generatedAt": _utc_now(),
        "policyId": str(loaded_policy["policyId"]),
        "policyVersion": str(loaded_policy["version"]),
        "policySha256": str(loaded_policy.get("policySha256", "")),
        "offlineOnly": True,
        "ready": not blockers,
        "counts": counts,
        "components": rows,
        "blockers": blockers,
        "warnings": warnings,
    }


class ModelLifecycleStore:
    def __init__(
        self,
        workspace: Path | str,
        *,
        policy: Mapping[str, Any] | None = None,
        resource_root: Path | None = None,
        lock_timeout_seconds: float = STATE_LOCK_TIMEOUT_SECONDS,
    ):
        self.workspace = Path(workspace).expanduser().resolve()
        self.root = self.workspace / STATE_DIRECTORY
        self.path = self.root / STATE_FILENAME
        self.lock_path = self.root / STATE_LOCK_FILENAME
        self.lock_timeout_seconds = max(0.05, float(lock_timeout_seconds))
        self.policy = deepcopy(dict(policy)) if policy is not None else load_policy()
        policy_path = Path(str(self.policy.get("policyPath", "") or resolve_policy_path()))
        self.resource_root = resource_root.resolve() if resource_root is not None else _resource_root_for_policy(policy_path)

    def _empty_payload(self) -> dict[str, Any]:
        return {
            "policyVersion": str(self.policy["version"]),
            "policySha256": str(self.policy.get("policySha256", "")),
            "accepted": {},
            "staged": {},
            "history": [],
            "configurationHistory": [],
            "policyMigrations": [],
            "updatedAt": _utc_now(),
        }

    def _prepare_root(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        if self.root.is_symlink() or not self.root.is_dir():
            raise ModelLifecycleIntegrityError("The model lifecycle state directory is unsafe.")
        restrict_file_mode(self.root, 0o700)

    @staticmethod
    def _pid_is_alive(pid: int) -> bool:
        if pid <= 0:
            return False
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False
        return True

    def _remove_stale_lock(self) -> bool:
        try:
            stat = self.lock_path.lstat()
        except FileNotFoundError:
            return True
        except OSError:
            return False
        if self.lock_path.is_symlink() or not self.lock_path.is_file():
            raise ModelLifecycleIntegrityError("The model lifecycle state lock is unsafe.")
        if time.time() - stat.st_mtime <= STATE_LOCK_STALE_SECONDS:
            return False
        try:
            raw_owner = self.lock_path.read_bytes()
        except OSError:
            return False
        try:
            owner = json.loads(raw_owner.decode("utf-8"))
            owner_pid = int(owner.get("pid", 0)) if isinstance(owner, dict) else 0
        except (UnicodeDecodeError, ValueError, TypeError, json.JSONDecodeError):
            owner_pid = 0
        if self._pid_is_alive(owner_pid):
            return False
        try:
            if self.lock_path.read_bytes() != raw_owner:
                return False
            self.lock_path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            return False
        return True

    @contextmanager
    def _locked(self):
        self._prepare_root()
        deadline = time.monotonic() + self.lock_timeout_seconds
        token = secrets.token_hex(16)
        body = _canonical_json({"pid": os.getpid(), "token": token, "createdAt": _utc_now()})
        while True:
            try:
                descriptor = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError as exc:
                if self._remove_stale_lock():
                    continue
                if time.monotonic() >= deadline:
                    raise ModelLifecycleIntegrityError("The model lifecycle state is busy in another process.") from exc
                time.sleep(0.05)
                continue
            except OSError as exc:
                raise ModelLifecycleIntegrityError("The model lifecycle state lock could not be created.") from exc
            try:
                os.write(descriptor, body)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            restrict_file_mode(self.lock_path, 0o600)
            break
        try:
            yield
        finally:
            try:
                owner = json.loads(self.lock_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                owner = {}
            if isinstance(owner, dict) and owner.get("token") == token:
                self.lock_path.unlink(missing_ok=True)

    @staticmethod
    def _validated_configuration_history(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
        raw_history = payload.get("configurationHistory", [])
        if not isinstance(raw_history, list):
            raise ModelLifecycleIntegrityError("The model configuration rollback history is invalid.")
        output: list[dict[str, Any]] = []
        for snapshot in raw_history[-24:]:
            if not isinstance(snapshot, dict) or not isinstance(snapshot.get("configuration"), dict):
                raise ModelLifecycleIntegrityError("A model configuration rollback snapshot is invalid.")
            for field, value in snapshot["configuration"].items():
                if field not in ALLOWED_CONFIGURATION_FIELDS:
                    raise ModelLifecycleIntegrityError("A model configuration rollback snapshot has an unknown field.")
                if field == "safeModeMultimodal" and not isinstance(value, bool):
                    raise ModelLifecycleIntegrityError("A model configuration rollback snapshot has an invalid safety value.")
                if field != "safeModeMultimodal" and not isinstance(value, str):
                    raise ModelLifecycleIntegrityError("A model configuration rollback snapshot has an invalid route value.")
            configuration = {
                field: bool(snapshot["configuration"][field]) if field == "safeModeMultimodal" else str(snapshot["configuration"][field] or "")[:4096]
                for field in ALLOWED_CONFIGURATION_FIELDS
                if field in snapshot["configuration"]
            }
            expected = str(snapshot.get("configurationSha256", "") or "").lower()
            if expected != _hash_bytes(_canonical_json(configuration)):
                raise ModelLifecycleIntegrityError("A model configuration rollback snapshot failed integrity validation.")
            output.append({
                "configuration": configuration,
                "configurationSha256": expected,
                "recordedAt": str(snapshot.get("recordedAt", "") or "")[:100],
                "reason": str(snapshot.get("reason", "") or "")[:300],
            })
        return output

    def _validate_payload_shape(self, payload: Mapping[str, Any]) -> None:
        if not isinstance(payload.get("accepted", {}), dict) or not isinstance(payload.get("staged", {}), dict):
            raise ModelLifecycleIntegrityError("The model lifecycle state report maps are invalid.")
        history = payload.get("history", [])
        migrations = payload.get("policyMigrations", [])
        if not isinstance(history, list) or len(history) > 64 or any(not isinstance(item, dict) for item in history):
            raise ModelLifecycleIntegrityError("The model lifecycle baseline history is invalid.")
        if not isinstance(migrations, list) or len(migrations) > 16 or any(not isinstance(item, dict) for item in migrations):
            raise ModelLifecycleIntegrityError("The model lifecycle policy migration history is invalid.")
        configuration_history = payload.get("configurationHistory", [])
        if not isinstance(configuration_history, list) or len(configuration_history) > 24:
            raise ModelLifecycleIntegrityError("The model configuration rollback history exceeds its limit.")
        if len(payload.get("accepted", {})) > 128 or len(payload.get("staged", {})) > 128:
            raise ModelLifecycleIntegrityError("The model lifecycle state exceeds its component limit.")
        self._validated_configuration_history(payload)

    def _migrate_policy_payload(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        previous_sha = str(payload.get("policySha256", "") or "").lower()
        previous_version = str(payload.get("policyVersion", "") or "")[:100]
        if not re.fullmatch(r"[a-f0-9]{64}", previous_sha) or not previous_version:
            raise ModelLifecycleIntegrityError("The model lifecycle state has no valid prior policy identity.")
        migrations = payload.get("policyMigrations", [])
        if not isinstance(migrations, list) or any(not isinstance(item, dict) for item in migrations):
            raise ModelLifecycleIntegrityError("The model lifecycle policy migration history is invalid.")
        migrated = self._empty_payload()
        migrated["configurationHistory"] = self._validated_configuration_history(payload)
        migrated["policyMigrations"] = [
            *deepcopy(migrations[-15:]),
            {
                "fromPolicyVersion": previous_version,
                "fromPolicySha256": previous_sha,
                "toPolicyVersion": str(self.policy["version"]),
                "toPolicySha256": str(self.policy.get("policySha256", "")),
                "discardedAccepted": len(payload.get("accepted", {})) if isinstance(payload.get("accepted"), dict) else 0,
                "discardedStaged": len(payload.get("staged", {})) if isinstance(payload.get("staged"), dict) else 0,
                "migratedAt": _utc_now(),
            },
        ]
        return migrated

    def _read_unlocked(self, *, migrate_policy: bool) -> dict[str, Any]:
        if not self.path.exists():
            return self._empty_payload()
        envelope, _ = _read_json_file(self.path, max_bytes=4 * 1024 * 1024)
        if not isinstance(envelope, dict) or envelope.get("schemaVersion") != STATE_SCHEMA_VERSION:
            raise ModelLifecycleIntegrityError("The model lifecycle state schema is invalid.")
        payload = envelope.get("payload")
        if not isinstance(payload, dict):
            raise ModelLifecycleIntegrityError("The model lifecycle state payload is invalid.")
        expected = str(envelope.get("payloadSha256", "") or "").lower()
        actual = _hash_bytes(_canonical_json(payload))
        if not re.fullmatch(r"[a-f0-9]{64}", expected) or expected != actual:
            raise ModelLifecycleIntegrityError("The model lifecycle state failed its integrity check.")
        self._validate_payload_shape(payload)
        if payload.get("policySha256") != self.policy.get("policySha256"):
            if not migrate_policy:
                raise ModelLifecycleIntegrityError("The model lifecycle state belongs to a different policy revision.")
            payload = self._migrate_policy_payload(payload)
            self._write_unlocked(payload)
        return deepcopy(payload)

    def read(self) -> dict[str, Any]:
        with self._locked():
            return self._read_unlocked(migrate_policy=True)

    def _write_unlocked(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self._prepare_root()
        if self.root.is_symlink() or self.path.is_symlink():
            raise ModelLifecycleIntegrityError("The model lifecycle state path cannot be a symlink.")
        clean = deepcopy(dict(payload))
        clean["updatedAt"] = _utc_now()
        envelope = {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "payload": clean,
            "payloadSha256": _hash_bytes(_canonical_json(clean)),
        }
        raw = json.dumps(envelope, indent=2, sort_keys=True, ensure_ascii=True).encode("utf-8")
        temp = self.root / f".{STATE_FILENAME}.{os.getpid()}.{secrets.token_hex(8)}.tmp"
        try:
            with temp.open("xb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            restrict_file_mode(temp, 0o600)
            temp.replace(self.path)
            restrict_file_mode(self.path, 0o600)
            try:
                directory_descriptor = os.open(self.root, os.O_RDONLY)
                try:
                    os.fsync(directory_descriptor)
                finally:
                    os.close(directory_descriptor)
            except OSError:
                pass
        finally:
            temp.unlink(missing_ok=True)
        return deepcopy(clean)

    def _component(self, component_id: str) -> dict[str, Any]:
        component = next((item for item in self.policy["components"] if item["id"] == component_id), None)
        if component is None:
            raise ModelLifecycleIntegrityError("Model lifecycle state references an unknown component.")
        return component

    def _validate_candidate_entry(self, component_id: str, entry: Mapping[str, Any]) -> None:
        if str(entry.get("componentId", "") or "") != component_id:
            raise ModelLifecycleIntegrityError("A model lifecycle report entry has a mismatched component id.")
        digest = str(entry.get("reportSha256", "") or "").lower()
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ModelLifecycleIntegrityError("A model lifecycle report entry has an invalid digest.")
        report_path = _safe_resource_path(self.root, str(entry.get("reportPath", "") or ""))
        try:
            actual = _hash_file(report_path)
        except OSError as exc:
            raise ModelLifecycleIntegrityError("A model lifecycle report entry is missing.") from exc
        if actual != digest:
            raise ModelLifecycleIntegrityError("A model lifecycle report entry failed its integrity check.")
        evaluation = evaluate_component(
            self._component(component_id),
            resource_root=self.resource_root,
            candidate_report_path=report_path,
            max_bytes=int(self.policy.get("candidateReportMaxBytes", 16 * 1024 * 1024)),
        )
        if not evaluation.get("baseline", {}).get("integrity") or not evaluation.get("baseline", {}).get("passed"):
            raise ModelLifecycleIntegrityError("The accepted model evaluation baseline failed while validating state.")
        if not evaluation.get("candidate", {}).get("passed"):
            raise ModelLifecycleIntegrityError("A stored model evaluation report no longer passes its policy gate.")

    def _validate_accepted_entry(self, component_id: str, entry: Mapping[str, Any]) -> None:
        source = str(entry.get("source", "") or "")
        component = self._component(component_id)
        if source == "bundled-policy":
            if str(entry.get("componentId", "") or "") != component_id:
                raise ModelLifecycleIntegrityError("A bundled model baseline has a mismatched component id.")
            if entry.get("reportSha256") != component["baseline"]["reportSha256"]:
                raise ModelLifecycleIntegrityError("A bundled model baseline digest does not match policy.")
            fingerprint = str(entry.get("runtimeFingerprint", "") or "").lower()
            if fingerprint and not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
                raise ModelLifecycleIntegrityError("A bundled model baseline has an invalid runtime fingerprint.")
            return
        if source != "staged-candidate":
            raise ModelLifecycleIntegrityError("A promoted model baseline has an invalid source.")
        fingerprint = str(entry.get("runtimeFingerprint", "") or "").lower()
        if not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
            raise ModelLifecycleIntegrityError("A promoted model baseline has an invalid runtime fingerprint.")
        self._validate_candidate_entry(component_id, entry)

    def _validate_state_model_evidence(self, state: Mapping[str, Any]) -> None:
        accepted = state.get("accepted", {})
        staged = state.get("staged", {})
        if not isinstance(accepted, dict) or not isinstance(staged, dict):
            raise ModelLifecycleIntegrityError("The model lifecycle report state is invalid.")
        if len(accepted) > len(self.policy["components"]) or len(staged) > len(self.policy["components"]):
            raise ModelLifecycleIntegrityError("The model lifecycle report state exceeds policy limits.")
        for component_id, entry in accepted.items():
            if not isinstance(entry, dict):
                raise ModelLifecycleIntegrityError("A promoted model baseline entry is invalid.")
            self._validate_accepted_entry(str(component_id), entry)
        for component_id, entry in staged.items():
            if not isinstance(entry, dict):
                raise ModelLifecycleIntegrityError("A staged model evaluation entry is invalid.")
            self._validate_candidate_entry(str(component_id), entry)

    def status(self, runtime_inventory: Mapping[str, Any] | None = None) -> dict[str, Any]:
        state = self.read()
        self._validate_state_model_evidence(state)
        report = evaluate_model_lifecycle(
            runtime_inventory=runtime_inventory,
            policy=self.policy,
            resource_root=self.resource_root,
            accepted_state=state,
        )
        return {
            **report,
            "state": {
                "accepted": len(state.get("accepted", {})),
                "staged": len(state.get("staged", {})),
                "history": len(state.get("history", [])),
                "configurationHistory": len(state.get("configurationHistory", [])),
                "policyMigrations": len(state.get("policyMigrations", [])),
                "latestPolicyMigration": deepcopy(state.get("policyMigrations", [])[-1]) if state.get("policyMigrations") else None,
                "updatedAt": str(state.get("updatedAt", "") or ""),
            },
        }

    def stage_candidate(self, component_id: str, report_path: Path | str) -> dict[str, Any]:
        component = next((item for item in self.policy["components"] if item["id"] == component_id), None)
        if component is None:
            raise ValueError("Unknown model lifecycle component.")
        evaluation = evaluate_component(
            component,
            resource_root=self.resource_root,
            candidate_report_path=report_path,
            max_bytes=int(self.policy.get("candidateReportMaxBytes", 16 * 1024 * 1024)),
        )
        candidate = evaluation.get("candidate") if isinstance(evaluation.get("candidate"), dict) else {}
        baseline = evaluation.get("baseline") if isinstance(evaluation.get("baseline"), dict) else {}
        if not baseline.get("integrity") or not baseline.get("passed"):
            raise ModelLifecycleIntegrityError("The accepted model evaluation baseline failed before candidate staging.")
        if not candidate.get("passed"):
            raise ModelLifecycleGateError("Candidate evaluation failed: " + "; ".join(candidate.get("failures", [])[:3]))
        source = Path(report_path).expanduser().resolve()
        digest = str(candidate["reportSha256"])
        with self._locked():
            reports_root = self.root / "reports"
            reports_root.mkdir(parents=True, exist_ok=True)
            if reports_root.is_symlink():
                raise ModelLifecycleIntegrityError("The model lifecycle report directory cannot be a symlink.")
            restrict_file_mode(reports_root, 0o700)
            target = reports_root / f"{component_id}-{digest}.json"
            if target.is_symlink():
                raise ModelLifecycleIntegrityError("A staged model evaluation report cannot be a symlink.")
            if not target.exists():
                shutil.copyfile(source, target)
                restrict_file_mode(target, 0o600)
            if _hash_file(target) != digest:
                target.unlink(missing_ok=True)
                raise ModelLifecycleIntegrityError("The staged model evaluation report failed its copy check.")
            state = self._read_unlocked(migrate_policy=True)
            self._validate_state_model_evidence(state)
            staged = state.get("staged") if isinstance(state.get("staged"), dict) else {}
            staged[component_id] = {
                "componentId": component_id,
                "reportSha256": digest,
                "reportPath": str(target.relative_to(self.root)),
                "stagedAt": _utc_now(),
                "metrics": candidate.get("metrics", []),
            }
            state["staged"] = staged
            self._write_unlocked(state)
            return deepcopy(staged[component_id])

    def promote_candidate(self, component_id: str, *, runtime_fingerprint: str, confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise ModelLifecycleGateError("Promoting a model evaluation baseline requires confirmation.")
        fingerprint = str(runtime_fingerprint or "").strip().lower()
        if not re.fullmatch(r"[a-f0-9]{64}", fingerprint):
            raise ModelLifecycleGateError("Promotion requires the exact 64-character runtime fingerprint.")
        component = next((item for item in self.policy["components"] if item["id"] == component_id), None)
        if component is None:
            raise ValueError("Unknown model lifecycle component.")
        with self._locked():
            state = self._read_unlocked(migrate_policy=True)
            self._validate_state_model_evidence(state)
            staged = state.get("staged") if isinstance(state.get("staged"), dict) else {}
            candidate = staged.get(component_id) if isinstance(staged.get(component_id), dict) else None
            if candidate is None:
                raise ModelLifecycleGateError("No passing candidate evaluation is staged for this component.")
            report_path = _safe_resource_path(self.root, str(candidate["reportPath"]))
            if _hash_file(report_path) != candidate.get("reportSha256"):
                raise ModelLifecycleIntegrityError("The staged model evaluation report drifted before promotion.")
            reevaluated = evaluate_component(
                component,
                resource_root=self.resource_root,
                candidate_report_path=report_path,
                max_bytes=int(self.policy.get("candidateReportMaxBytes", 16 * 1024 * 1024)),
            )
            if not reevaluated.get("baseline", {}).get("integrity") or not reevaluated.get("baseline", {}).get("passed"):
                raise ModelLifecycleIntegrityError("The accepted model evaluation baseline failed before promotion.")
            if not reevaluated.get("candidate", {}).get("passed"):
                raise ModelLifecycleGateError("The staged model evaluation no longer passes.")
            accepted = state.get("accepted") if isinstance(state.get("accepted"), dict) else {}
            history = state.get("history") if isinstance(state.get("history"), list) else []
            previous = accepted.get(component_id) if isinstance(accepted.get(component_id), dict) else {
                "componentId": component_id,
                "source": "bundled-policy",
                "reportSha256": str(component["baseline"]["reportSha256"]),
                "runtimeFingerprint": "",
                "acceptedAt": "",
            }
            history.append({**deepcopy(previous), "replacedAt": _utc_now()})
            promoted = {
                "componentId": component_id,
                "source": "staged-candidate",
                "reportSha256": str(candidate["reportSha256"]),
                "reportPath": str(candidate["reportPath"]),
                "runtimeFingerprint": fingerprint,
                "acceptedAt": _utc_now(),
            }
            accepted[component_id] = promoted
            staged.pop(component_id, None)
            state["accepted"] = accepted
            state["staged"] = staged
            state["history"] = history[-64:]
            self._write_unlocked(state)
            return deepcopy(promoted)

    def rollback_baseline(self, component_id: str, *, confirm: bool) -> dict[str, Any]:
        if not confirm:
            raise ModelLifecycleGateError("Rolling back a model evaluation baseline requires confirmation.")
        with self._locked():
            state = self._read_unlocked(migrate_policy=True)
            self._validate_state_model_evidence(state)
            history = state.get("history") if isinstance(state.get("history"), list) else []
            index = next(
                (position for position in range(len(history) - 1, -1, -1) if history[position].get("componentId") == component_id),
                -1,
            )
            if index < 0:
                raise ModelLifecycleGateError("No previous accepted baseline is available for this component.")
            previous = deepcopy(history.pop(index))
            previous.pop("replacedAt", None)
            self._validate_accepted_entry(component_id, previous)
            accepted = state.get("accepted") if isinstance(state.get("accepted"), dict) else {}
            current = deepcopy(accepted.get(component_id, {}))
            accepted[component_id] = previous
            state["accepted"] = accepted
            if current:
                history.append({**current, "replacedAt": _utc_now()})
            state["history"] = history[-64:]
            self._write_unlocked(state)
            return {"rolledBack": True, "componentId": component_id, "restored": previous, "replaced": current}

    def record_configuration(self, configuration: Mapping[str, Any], *, reason: str) -> dict[str, Any]:
        clean: dict[str, Any] = {}
        for field in ALLOWED_CONFIGURATION_FIELDS:
            if field not in configuration:
                continue
            value = configuration[field]
            if field == "safeModeMultimodal":
                clean[field] = bool(value)
            else:
                clean[field] = str(value or "")[:4096]
        snapshot = {
            "configuration": clean,
            "configurationSha256": _hash_bytes(_canonical_json(clean)),
            "recordedAt": _utc_now(),
            "reason": re.sub(r"\s+", " ", str(reason or "model configuration changed")).strip()[:300],
        }
        with self._locked():
            state = self._read_unlocked(migrate_policy=True)
            history = state.get("configurationHistory") if isinstance(state.get("configurationHistory"), list) else []
            if history and history[-1].get("configurationSha256") == snapshot["configurationSha256"]:
                return deepcopy(history[-1])
            history.append(snapshot)
            state["configurationHistory"] = history[-24:]
            self._write_unlocked(state)
            return deepcopy(snapshot)

    def previous_configuration(self, current: Mapping[str, Any]) -> dict[str, Any]:
        clean_current = {
            field: bool(current[field]) if field == "safeModeMultimodal" else str(current[field] or "")[:4096]
            for field in ALLOWED_CONFIGURATION_FIELDS
            if field in current
        }
        current_digest = _hash_bytes(_canonical_json(clean_current))
        state = self.read()
        history = state.get("configurationHistory") if isinstance(state.get("configurationHistory"), list) else []
        for snapshot in reversed(history):
            if snapshot.get("configurationSha256") == current_digest:
                continue
            configuration = snapshot.get("configuration") if isinstance(snapshot.get("configuration"), dict) else {}
            expected = str(snapshot.get("configurationSha256", "") or "")
            if expected != _hash_bytes(_canonical_json(configuration)):
                raise ModelLifecycleIntegrityError("A model configuration rollback snapshot failed integrity validation.")
            return deepcopy(snapshot)
        raise ModelLifecycleGateError("No previous model configuration is available for rollback.")

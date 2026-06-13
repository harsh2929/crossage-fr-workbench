from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from crossage_fr.api_server import DesktopApi
from clean_workspace_smoke import run_smoke


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def run_update_feed_check() -> dict[str, Any]:
    script = repo_root() / "desktop" / "scripts" / "check-update-feed.cjs"
    completed = subprocess.run(
        ["node", str(script)],
        cwd=repo_root(),
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    payload: dict[str, Any]
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        payload = {"ok": False, "error": completed.stdout.strip() or completed.stderr.strip()}
    payload["exitCode"] = completed.returncode
    if completed.stderr.strip():
        payload["stderr"] = completed.stderr.strip()[-1000:]
    return payload


def run_package_artifact_check(required: bool = False) -> dict[str, Any]:
    script = repo_root() / "desktop" / "scripts" / "check-package-artifacts.cjs"
    env = os.environ.copy()
    if required:
        env["VINTRACE_PACKAGE_REQUIRED"] = "1"
    completed = subprocess.run(
        ["node", str(script)],
        cwd=repo_root(),
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        payload = {"ok": False, "error": completed.stdout.strip() or completed.stderr.strip()}
    payload["exitCode"] = completed.returncode
    if completed.stderr.strip():
        payload["stderr"] = completed.stderr.strip()[-1000:]
    return payload


def run_dataset_gate_check() -> dict[str, Any]:
    script = repo_root() / "tests" / "dataset_regression_gates.py"
    env = os.environ.copy()
    env["CROSSAGE_FORCE_FALLBACK"] = env.get("CROSSAGE_FORCE_FALLBACK", "1")
    env["PYTHONPATH"] = str(repo_root())
    completed = subprocess.run(
        [sys.executable, str(script)],
        cwd=repo_root(),
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        payload = {"ok": False, "error": completed.stdout.strip() or completed.stderr.strip()}
    payload["exitCode"] = completed.returncode
    if completed.stderr.strip():
        payload["stderr"] = completed.stderr.strip()[-1000:]
    if completed.returncode != 0:
        payload["ok"] = False
    return payload


def run_real_public_benchmark_gate_check(required: bool = False) -> dict[str, Any]:
    report_env = os.environ.get("VINTRACE_PUBLIC_BENCHMARK_REPORT", "").strip()
    report_path = Path(report_env).expanduser() if report_env else repo_root() / "benchmarks" / "results" / "public-dataset-benchmark-latest.json"
    if not report_path.exists():
        return {
            "ok": not required,
            "status": "missing" if required else "not-required",
            "reportPath": str(report_path),
            "required": required,
            "message": "No real public benchmark report was found." if required else "Real public benchmark report is optional for non-strict local checks.",
        }
    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {"ok": False, "status": "unreadable", "reportPath": str(report_path), "error": str(exc), "required": required}

    rows = payload.get("rows", [])
    if not isinstance(rows, list):
        rows = []
    existing_gates = payload.get("regressionGates") if isinstance(payload.get("regressionGates"), dict) else None
    if existing_gates is None:
        try:
            from crossage_fr.benchmark_quality import evaluate_dataset_gates

            existing_gates = evaluate_dataset_gates([row for row in rows if isinstance(row, dict)])
        except Exception as exc:
            return {"ok": False, "status": "gate-error", "reportPath": str(report_path), "error": str(exc), "required": required}

    required_datasets_env = os.environ.get("VINTRACE_PUBLIC_BENCHMARK_REQUIRED_DATASETS", "calfw,cplfw,agedb,fiw,cfp")
    required_datasets = {item.strip() for item in required_datasets_env.split(",") if item.strip()}
    completed_datasets = {
        str(row.get("datasetId"))
        for row in rows
        if isinstance(row, dict) and row.get("status") == "complete" and row.get("datasetId")
    }
    missing_required = sorted(required_datasets - completed_datasets)
    max_age_days = _int_env("VINTRACE_PUBLIC_BENCHMARK_MAX_AGE_DAYS", 30)
    age_days = _benchmark_age_days(str(payload.get("generatedAt") or ""))
    stale = age_days is None or age_days > max_age_days
    gates_ok = bool(existing_gates.get("ok"))
    ok = bool(gates_ok and not missing_required and not stale)
    return {
        "ok": ok,
        "status": "pass" if ok else "fail",
        "reportPath": str(report_path),
        "required": required,
        "generatedAt": payload.get("generatedAt"),
        "ageDays": age_days,
        "maxAgeDays": max_age_days,
        "profile": payload.get("profile", "standard"),
        "packs": payload.get("packs", []),
        "requiredDatasets": sorted(required_datasets),
        "completedDatasets": sorted(completed_datasets),
        "missingRequiredDatasets": missing_required,
        "gatesOk": gates_ok,
        "failedGates": int(existing_gates.get("failed", 0) or 0),
        "recommendedPack": ((payload.get("modelPackMatrix") or {}) if isinstance(payload.get("modelPackMatrix"), dict) else {}).get("recommendedPack"),
        "gateRecommendations": existing_gates.get("recommendations", []) if isinstance(existing_gates, dict) else [],
    }


def _benchmark_age_days(generated_at: str) -> int | None:
    if not generated_at:
        return None
    try:
        parsed = datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - parsed.astimezone(timezone.utc)).days)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def capture(name: str, fn: Callable[[], Any], checks: list[dict[str, Any]]) -> Any:
    try:
        value = fn()
        checks.append({"name": name, "ok": True})
        return value
    except Exception as exc:
        checks.append({"name": name, "ok": False, "error": str(exc)})
        return None


def main() -> None:
    strict = "--strict" in sys.argv
    root = Path(tempfile.mkdtemp(prefix="vintrace-release-check-"))
    workspace = root / "workspace"
    os.environ["CROSSAGE_FORCE_FALLBACK"] = os.environ.get("CROSSAGE_FORCE_FALLBACK", "1")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(workspace)
    checks: list[dict[str, Any]] = []

    state = capture("state", lambda: api.state(preview_create_budget=0, candidate_limit=25), checks) or {}
    runtime = capture("runtime self-test", api.runtime_self_test, checks) or {}
    database = capture("database integrity", api.project.database_integrity, checks) or {}
    storage = capture("storage I/O", lambda: api.storage_io_benchmark({"path": str(workspace), "sizeMb": 1}), checks) or {}
    benchmark = capture("runtime benchmark", api.runtime_benchmark, checks) or {}
    installer = capture("installer diagnostics", api.installer_self_diagnostics, checks) or {}
    model_integrity = capture("model integrity", api.model_integrity, checks) or {}
    distribution = capture("model distribution audit", api.model_distribution_audit, checks) or {}
    readiness = capture("release readiness", api.release_readiness, checks) or {}
    clean = capture("clean workspace smoke", run_smoke, checks) or {}
    update_feed = capture("update feed dry-run", run_update_feed_check, checks) or {}
    package_artifacts = capture("package artifact check", lambda: run_package_artifact_check(required=strict), checks) or {}
    dataset_gates = capture("dataset regression gates", run_dataset_gate_check, checks) or {}
    real_dataset_gates = capture(
        "real public benchmark gates",
        lambda: run_real_public_benchmark_gate_check(required=strict or os.environ.get("VINTRACE_REQUIRE_PUBLIC_BENCHMARK", "").strip() == "1"),
        checks,
    ) or {}

    structural_ok = all(check["ok"] for check in checks)
    runtime_ok = bool(runtime.get("ok", False))
    database_ok = bool(database.get("ok", False))
    storage_ok = bool(storage.get("ok", False))
    update_ok = bool(update_feed.get("ok", False))
    package_ok = bool(package_artifacts.get("ok", False))
    dataset_gate_ok = bool(dataset_gates.get("ok", False))
    real_dataset_gate_ok = bool(real_dataset_gates.get("ok", False))
    no_credential_ok = structural_ok and database_ok and storage_ok and update_ok and package_ok and dataset_gate_ok and real_dataset_gate_ok
    release_ready = bool(readiness.get("ok", False))
    distribution_blockers = [
        recommendation
        for recommendation in readiness.get("recommendations", [])
        if isinstance(recommendation, str)
    ]

    result = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "ok": bool(no_credential_ok and (release_ready if strict else True)),
        "strict": strict,
        "noCredentialChecksOk": no_credential_ok,
        "releaseReadinessOk": release_ready,
        "checks": checks,
        "buildInfo": state.get("buildInfo", {}),
        "runtimeSelfTest": {
            "ok": runtime_ok,
            "checks": len(runtime.get("checks", [])),
        },
        "databaseIntegrity": {
            "ok": database_ok,
            "pageCount": database.get("pageCount"),
            "tableCounts": database.get("tableCounts", {}),
        },
        "storageIo": {
            "ok": storage_ok,
            "writeMBps": storage.get("writeMBps"),
            "readMBps": storage.get("readMBps"),
        },
        "benchmark": {
            "runId": benchmark.get("runId"),
            "vectorBackend": benchmark.get("vectorBackend"),
            "vectorAddPerSecond": benchmark.get("vectorAddPerSecond"),
            "stateSerializeMs": benchmark.get("stateSerializeMs"),
        },
        "installerDiagnostics": {
            "ok": installer.get("ok"),
            "checks": len(installer.get("checks", [])),
        },
        "modelIntegrity": {
            "ok": model_integrity.get("ok"),
            "checks": len(model_integrity.get("checks", [])),
        },
        "modelDistribution": {
            "ok": distribution.get("ok"),
            "items": len(distribution.get("items", [])),
        },
        "cleanWorkspace": clean,
        "updateFeed": update_feed,
        "packageArtifacts": package_artifacts,
        "datasetGates": {
            "ok": dataset_gate_ok,
            "recommendedPack": ((dataset_gates.get("recommendation") or {}) if isinstance(dataset_gates.get("recommendation"), dict) else {}).get("recommendedPack"),
        },
        "realDatasetGates": {
            "ok": real_dataset_gate_ok,
            "status": real_dataset_gates.get("status"),
            "profile": real_dataset_gates.get("profile"),
            "recommendedPack": real_dataset_gates.get("recommendedPack"),
            "missingRequiredDatasets": real_dataset_gates.get("missingRequiredDatasets", []),
            "failedGates": real_dataset_gates.get("failedGates"),
            "reportPath": real_dataset_gates.get("reportPath"),
        },
        "distributionBlockers": distribution_blockers,
    }
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

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

    structural_ok = all(check["ok"] for check in checks)
    runtime_ok = bool(runtime.get("ok", False))
    database_ok = bool(database.get("ok", False))
    storage_ok = bool(storage.get("ok", False))
    update_ok = bool(update_feed.get("ok", False))
    package_ok = bool(package_artifacts.get("ok", False))
    no_credential_ok = structural_ok and database_ok and storage_ok and update_ok and package_ok
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
        "distributionBlockers": distribution_blockers,
    }
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

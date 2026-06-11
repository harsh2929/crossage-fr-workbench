from __future__ import annotations

import json
import os
import tempfile
import zipfile
from pathlib import Path

from crossage_fr.api_server import DesktopApi


def run_smoke() -> dict:
    root = Path(tempfile.mkdtemp(prefix="vintrace-clean-workspace-"))
    workspace = root / "workspace"
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(workspace)

    state = api.state(preview_create_budget=0, candidate_limit=25)
    assert state["workspace"] == str(workspace.resolve())
    assert state["workspaceMetadata"]["workspaceId"]
    assert state["counts"] == {"references": 0, "pending": 0, "reviewed": 0, "candidates": 0}
    assert state["config"]["safeMode"] is True
    assert state["config"]["requireConsent"] is True
    assert state["buildInfo"]["version"]
    assert isinstance(state.get("benchmarkHistory"), list)
    assert state["modelSetup"]["packages"], "Model packages must be exposed for first-run downloader."

    database = api.handle("database_integrity", {})
    assert database["ok"] is True
    assert "review_candidates" in database["tableCounts"]

    storage = api.handle("storage_io_benchmark", {"path": str(workspace), "sizeMb": 1})
    assert storage["sizeBytes"] == 1024 * 1024
    assert storage["storage"]["exists"] is True

    privacy = api.handle("privacy_report", {})
    assert privacy["references"] == 0
    assert privacy["candidates"] == 0

    readiness = api.handle("release_readiness", {})
    assert "checks" in readiness
    assert {check["name"] for check in readiness["checks"]} >= {"Face model", "Auto-update", "Database integrity"}

    benchmark = api.handle("runtime_benchmark", {})
    assert benchmark["runId"]
    assert benchmark["storageIo"]["ok"] is True
    history = api.handle("benchmark_history", {"limit": 3})
    assert history and history[0]["runId"] == benchmark["runId"]

    support = api.handle("export_support_bundle", {"includePaths": False})
    support_path = Path(support["value"]["zipPath"])
    assert support_path.exists()
    with zipfile.ZipFile(support_path) as archive:
        support_text = "\n".join(
            archive.read(name).decode("utf-8")
            for name in archive.namelist()
            if name.endswith(".json")
        )
    assert str(workspace.resolve()) not in support_text
    assert str(Path.home()) not in support_text

    return {
        "workspace": str(workspace),
        "state": {
            "version": state["version"],
            "workspaceId": state["workspaceMetadata"]["workspaceId"],
            "benchmarkHistory": len(api.handle("benchmark_history", {"limit": 10})),
        },
        "database": {"ok": database["ok"], "tables": len(database["tableCounts"])},
        "storage": {"ok": storage["ok"], "writeMBps": storage["writeMBps"], "readMBps": storage["readMBps"]},
        "releaseReadiness": {"ok": readiness["ok"], "checks": len(readiness["checks"])},
    }


def main() -> None:
    print(json.dumps(run_smoke(), indent=2))


if __name__ == "__main__":
    main()

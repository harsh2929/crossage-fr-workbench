"""Unit tests for workspace registry persistence.

Run: PYTHONPATH=. .venv/bin/python tests/workspace_registry_units.py
"""

from __future__ import annotations

import concurrent.futures
import os
import tempfile
from pathlib import Path

from crossage_fr.workspace_registry import record_workspace, read_json_object, workspace_list_path, write_json_atomic


def test_concurrent_json_writes_use_independent_temp_files() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "active-workspace.json"

        def write_one(index: int) -> None:
            write_json_atomic(target, {"schemaVersion": 1, "index": index})

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write_one, range(80)))

        payload = read_json_object(target)
        assert payload.get("schemaVersion") == 1, payload
        assert isinstance(payload.get("index"), int), payload
        leftovers = list(target.parent.glob(".*.tmp"))
        assert leftovers == [], leftovers
    print("ok concurrent registry atomic writes")


def test_concurrent_record_workspace_preserves_all_entries() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        previous_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
        previous_legacy_registry = os.environ.get("CROSSAGE_REGISTRY_HOME")
        os.environ["VINTRACE_REGISTRY_HOME"] = str(Path(tmp) / "registry")
        os.environ.pop("CROSSAGE_REGISTRY_HOME", None)
        try:
            workspaces = [Path(tmp) / f"workspace-{index}" for index in range(24)]
            for workspace in workspaces:
                workspace.mkdir()

            def record_one(workspace: Path) -> None:
                record_workspace(workspace, {"workspaceId": workspace.name})

            with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
                list(pool.map(record_one, workspaces * 3))

            payload = read_json_object(workspace_list_path())
        finally:
            if previous_registry is None:
                os.environ.pop("VINTRACE_REGISTRY_HOME", None)
            else:
                os.environ["VINTRACE_REGISTRY_HOME"] = previous_registry
            if previous_legacy_registry is None:
                os.environ.pop("CROSSAGE_REGISTRY_HOME", None)
            else:
                os.environ["CROSSAGE_REGISTRY_HOME"] = previous_legacy_registry

        paths = {str(entry.get("path", "")) for entry in payload.get("workspaces", [])}
        assert paths == {str(workspace.resolve()) for workspace in workspaces}, payload
        assert not (Path(tmp) / "registry" / ".registry.lock").exists()
    print("ok concurrent record_workspace preserves entries")


if __name__ == "__main__":
    test_concurrent_json_writes_use_independent_temp_files()
    test_concurrent_record_workspace_preserves_all_entries()
    print("all workspace_registry unit tests passed")

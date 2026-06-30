"""Unit tests for workspace registry persistence.

Run: PYTHONPATH=. .venv/bin/python tests/workspace_registry_units.py
"""

from __future__ import annotations

import concurrent.futures
import tempfile
from pathlib import Path

from crossage_fr.workspace_registry import read_json_object, write_json_atomic


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


if __name__ == "__main__":
    test_concurrent_json_writes_use_independent_temp_files()
    print("all workspace_registry unit tests passed")

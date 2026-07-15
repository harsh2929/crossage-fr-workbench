"""Telemetry must be opt-IN, and its trace log must never ride along in a backup.

Two defects, both live:

1. `agent_telemetry.py` had `env_flag("MCP_OTEL_ENABLED", default=True)` — OpenTelemetry
   was ON by default, writing `<workspace>/agent/mcp-traces.jsonl` synchronously on every
   tool call, with no product config and no UI toggle. This directly contradicts the
   shipped posture in docs/security-audit.md ("genuinely no telemetry").

2. `export_workspace_backup` archives the workspace with `os.walk(self.root)` and excludes
   only the WAL/SHM/lock/snapshot files. So the PLAINTEXT trace log was zipped into every
   backup — and if no backup passphrase is configured, that archive is not encrypted either.

Why this matters beyond hygiene: the product's legal posture for on-device biometric
processing (cf. Barnett v. Apple) rests on biometric-adjacent data never being collected.
A plaintext trace log sitting next to the face database, copied into every backup, is
exactly the artifact that undermines it.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/telemetry_default_off_units.py
"""

from __future__ import annotations

import os
import sys
import tempfile
import zipfile
from pathlib import Path

from crossage_fr.agent_telemetry import TRACE_FILENAME, McpTelemetry
from crossage_fr.enroll.manager import ProjectState


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def main() -> None:
    os.environ.pop("VINTRACE_MCP_OTEL_ENABLED", None)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # 1. Default must be OFF.
        telemetry = McpTelemetry(root)
        check("telemetry is OFF by default (opt-in, not opt-out)", telemetry.enabled is False)
        telemetry.shutdown()

        # 2. Explicit opt-in still works — we are disabling by default, not removing.
        os.environ["VINTRACE_MCP_OTEL_ENABLED"] = "1"
        opted_in = McpTelemetry(root)
        check("explicit opt-in still enables telemetry", opted_in.enabled is True)
        opted_in.shutdown()
        os.environ.pop("VINTRACE_MCP_OTEL_ENABLED", None)

    # 3. Even when a user opts in, the trace log must not be archived into a backup.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        project = ProjectState(root)
        project.save()

        agent_dir = root / "agent"
        agent_dir.mkdir(parents=True, exist_ok=True)
        trace = agent_dir / TRACE_FILENAME
        trace.write_text('{"span":"get_image_preview","asset":"secret"}\n', encoding="utf-8")

        # A sibling file in the same directory proves we exclude the trace log
        # specifically, rather than dropping the whole agent/ directory.
        sibling = agent_dir / "mobile-companions.json"
        sibling.write_text("{}", encoding="utf-8")

        result = project.export_workspace_backup(root / "backups")
        archive_path = Path(result["zipPath"])
        check("backup is not encrypted in this test (so we can inspect it)", result["encrypted"] is False)

        with zipfile.ZipFile(archive_path) as archive:
            names = set(archive.namelist())

        check(
            "backup EXCLUDES the plaintext trace log",
            not any(name.endswith(TRACE_FILENAME) for name in names),
        )
        check(
            "backup still includes other agent/ files (we excluded the log, not the dir)",
            any(name.endswith("mobile-companions.json") for name in names),
        )

    print("\nAll telemetry-default checks passed.")


if __name__ == "__main__":
    main()

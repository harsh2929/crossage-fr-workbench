"""MS-3 / EIPC-03: enforce the backend command contract.

The set of backend commands is duplicated across Python (the api_server
dispatch), the preload allowlist, and the TS types, with nothing keeping them in
sync. This test makes the Python dispatch the single source of truth and fails
when the preload allowlist drifts from it:

  * a command added in Python but forgotten in the allowlist would be silently
    unreachable from the renderer, and
  * a stale allowlist entry would reference a command the backend never handles.

Run via `npm run test:command-contract` (wired into CI).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Commands the backend handles but that are invoked only by the Electron MAIN
# process (never the renderer), so they are intentionally absent from the preload
# allowlist. Keep this list tight and documented.
INTERNAL_COMMANDS = {
    "ping",          # liveness probe issued by the main process
    "record_audit",  # desktop-side audit writes (main.cjs), not renderer-reachable
}


def _python_commands() -> set[str]:
    src = (ROOT / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
    return set(re.findall(r'command == "([a-z_]+)"', src))


def _preload_allowlist() -> set[str]:
    src = (ROOT / "desktop" / "preload.cjs").read_text(encoding="utf-8")
    match = re.search(r"TRUSTED_BACKEND_COMMANDS = new Set\(\[(.*?)\]\)", src, re.DOTALL)
    assert match, "could not locate TRUSTED_BACKEND_COMMANDS in preload.cjs"
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


def main() -> None:
    py = _python_commands()
    allow = _preload_allowlist()
    assert py, "no backend commands found — extraction regex is broken"
    assert allow, "no preload allowlist commands found — extraction regex is broken"

    # 1) No dead allowlist entries: everything the renderer may call must exist.
    dead = sorted(allow - py)
    assert not dead, f"preload allowlists commands the backend does not handle: {dead}"

    # 2) Every renderer-reachable backend command must be allowlisted.
    missing = sorted(py - INTERNAL_COMMANDS - allow)
    assert not missing, (
        "backend commands missing from the preload allowlist "
        f"(add to the allowlist or to INTERNAL_COMMANDS): {missing}"
    )

    # 3) INTERNAL_COMMANDS must be real backend commands (no stale entries).
    stale_internal = sorted(INTERNAL_COMMANDS - py)
    assert not stale_internal, f"INTERNAL_COMMANDS lists non-existent commands: {stale_internal}"

    print(f"command contract ok ({len(py)} backend commands, {len(allow)} renderer-allowlisted)")


if __name__ == "__main__":
    main()

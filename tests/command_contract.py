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
    # MA-2: the dispatch is now a registry (DesktopApi._COMMAND_HANDLERS), not a
    # 96-branch if-chain — so the command surface is the registry's keys. Prefer
    # runtime introspection (authoritative); fall back to a source regex over the
    # registry literal if the backend can't be imported in this environment.
    try:
        from crossage_fr.api_server import DesktopApi

        return set(DesktopApi._COMMAND_HANDLERS)
    except Exception:
        src = (ROOT / "crossage_fr" / "api_server.py").read_text(encoding="utf-8")
        return set(re.findall(r'"([a-z_]+)":\s*"_cmd_\w+"', src))


def _cjs_allowlist(relative: str) -> set[str]:
    # The renderer->main IPC boundary enforces TRUSTED_BACKEND_COMMANDS in BOTH preload.cjs
    # (renderer side) AND main.cjs (validateBackendPayload). A command added to one but not the
    # other is silently blocked at runtime, so both must be checked.
    src = (ROOT / "desktop" / relative).read_text(encoding="utf-8")
    match = re.search(r"TRUSTED_BACKEND_COMMANDS = new Set\(\[(.*?)\]\)", src, re.DOTALL)
    assert match, f"could not locate TRUSTED_BACKEND_COMMANDS in {relative}"
    return set(re.findall(r'"([a-z_]+)"', match.group(1)))


def _preload_allowlist() -> set[str]:
    return _cjs_allowlist("preload.cjs")


def _main_allowlist() -> set[str]:
    return _cjs_allowlist("main.cjs")


def main() -> None:
    py = _python_commands()
    allow = _preload_allowlist()
    main_allow = _main_allowlist()
    assert py, "no backend commands found — extraction regex is broken"
    assert allow, "no preload allowlist commands found — extraction regex is broken"
    assert main_allow, "no main.cjs allowlist commands found — extraction regex is broken"

    # 1) No dead allowlist entries: everything the renderer may call must exist.
    dead = sorted(allow - py)
    assert not dead, f"preload allowlists commands the backend does not handle: {dead}"
    dead_main = sorted(main_allow - py)
    assert not dead_main, f"main.cjs allowlists commands the backend does not handle: {dead_main}"

    # 2) Every renderer-reachable backend command must be allowlisted in BOTH cjs boundaries.
    missing = sorted(py - INTERNAL_COMMANDS - allow)
    assert not missing, (
        "backend commands missing from the preload allowlist "
        f"(add to the allowlist or to INTERNAL_COMMANDS): {missing}"
    )
    missing_main = sorted(py - INTERNAL_COMMANDS - main_allow)
    assert not missing_main, (
        "backend commands missing from the main.cjs allowlist "
        f"(validateBackendPayload would block them): {missing_main}"
    )
    # 3b) The two allowlists must agree (a command in one but not the other is a silent runtime block).
    only_preload = sorted(allow - main_allow)
    only_main = sorted(main_allow - allow)
    assert not only_preload, f"commands in preload.cjs but not main.cjs (blocked at IPC): {only_preload}"
    assert not only_main, f"commands in main.cjs but not preload.cjs: {only_main}"

    # 3) INTERNAL_COMMANDS must be real backend commands (no stale entries).
    stale_internal = sorted(INTERNAL_COMMANDS - py)
    assert not stale_internal, f"INTERNAL_COMMANDS lists non-existent commands: {stale_internal}"

    # 4) MA-2/MA-4: the registry and the required-param schema must reference only
    # real commands, and every registered handler method must exist.
    try:
        from crossage_fr.api_server import DesktopApi

        stale_specs = sorted(set(DesktopApi._COMMAND_REQUIRED_PARAMS) - set(DesktopApi._COMMAND_HANDLERS))
        assert not stale_specs, f"_COMMAND_REQUIRED_PARAMS references unknown commands: {stale_specs}"
        missing_handlers = sorted(m for m in DesktopApi._COMMAND_HANDLERS.values() if not hasattr(DesktopApi, m))
        assert not missing_handlers, f"registry points at missing handler methods: {missing_handlers}"
    except ImportError:
        pass

    print(f"command contract ok ({len(py)} backend commands, {len(allow)} renderer-allowlisted)")


if __name__ == "__main__":
    main()

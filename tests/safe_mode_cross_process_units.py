"""Safe Mode must not go stale across the desktop <-> MCP process boundary.

The desktop and the MCP/HTTP server (which serves paired mobile devices) are
separate processes. `EnrollmentProject` loads config.json ONCE in __init__, and
`mcp_server._api()` caches the DesktopApi for the life of the process. Consent was
already fixed for exactly this problem (`refresh_consent_from_disk`), but Safe Mode
was not: `AgentImageService._safe_mode_status()` reads `project.config.safe_mode`
and friends straight off the cached config.

Consequence, and it fails OPEN: an operator who ENABLES or TIGHTENS Safe Mode on the
desktop does not affect the mobile preview path until the MCP sidecar restarts. The
phone keeps serving previews under the old, looser policy.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_cross_process_units.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from crossage_fr.enroll.manager import ProjectState


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _write_config(root: Path, **overrides: object) -> None:
    """Simulate the DESKTOP process writing config.json out-of-band."""
    path = root / "config.json"
    payload = json.loads(path.read_text()) if path.exists() else {}
    payload.update(overrides)
    path.write_text(json.dumps(payload, indent=2))


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)

        # Safe Mode defaults to True (fail-closed), so start from an explicitly
        # loosened workspace: that is the state a stale cache must not preserve.
        ProjectState(root).save()
        _write_config(root, safe_mode=False)

        # The long-lived MCP process opens the workspace and caches this config.
        project = ProjectState(root)
        check("baseline: safe mode is off", project.config.safe_mode is False)

        # The DESKTOP process now TIGHTENS Safe Mode. This is the direction that matters:
        # a fail-open staleness bug means the phone keeps serving what it should now refuse.
        _write_config(root, safe_mode=True, safe_mode_threshold=0.10)

        # The cached config in the long-lived MCP process is still the old one.
        check(
            "cached config is stale (this is the bug being fixed)",
            project.config.safe_mode is False,
        )

        # The fix: a cheap, mtime-guarded re-read at the enforcement boundary,
        # mirroring refresh_consent_from_disk().
        project.refresh_config_from_disk()

        check("after refresh: safe mode is ON", project.config.safe_mode is True)
        check(
            "after refresh: tightened threshold is visible",
            abs(float(project.config.safe_mode_threshold) - 0.10) < 1e-9,
        )

        # Loosening must also propagate (a stale ON is merely annoying, but we want
        # the config to be genuinely coherent, not one-directional).
        _write_config(root, safe_mode=False)
        project.refresh_config_from_disk()
        check("after refresh: loosening also propagates", project.config.safe_mode is False)

        # The refresh must be cheap enough to sit on a per-asset path: when config.json
        # has not changed, it must not re-parse. We assert the object identity is
        # preserved across a no-op refresh.
        before = project.config
        project.refresh_config_from_disk()
        check("no-op refresh does not re-parse (same object)", project.config is before)

    _check_preview_gate_honours_tightening()

    print("\nAll cross-process Safe Mode checks passed.")


def _check_preview_gate_honours_tightening() -> None:
    """The real enforcement boundary: AgentImageService._safe_mode_status().

    This is what the mobile preview route consults before it will serve pixels.
    It must observe a desktop-side tightening without a restart.
    """
    from crossage_fr.agent_images import AgentImageService
    from crossage_fr.api_server import DesktopApi

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        ProjectState(root).save()
        _write_config(root, safe_mode=False)

        # Long-lived MCP-side service, exactly as mcp_server._api() would cache it.
        api = DesktopApi(root, actor="mcp")
        service = AgentImageService(
            api,
            workspace=root,
            require_consent=lambda: None,
            validate_path=lambda path: path,
        )

        from PIL import Image

        photo = root / "photo.jpg"
        Image.new("RGB", (32, 32), (128, 128, 128)).save(photo)
        asset = {"contentHash": "", "sourcePath": str(photo)}

        status = service._safe_mode_status(asset)
        check(
            "preview gate: safe mode off -> not protected",
            status.get("source") == "safe-mode-disabled",
        )

        # Desktop turns Safe Mode ON. No restart.
        _write_config(root, safe_mode=True)

        status = service._safe_mode_status(asset)
        check(
            "preview gate: desktop tightening reaches the mobile path with no restart",
            status.get("source") != "safe-mode-disabled",
        )


if __name__ == "__main__":
    main()

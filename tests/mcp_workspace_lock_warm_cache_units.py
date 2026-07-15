"""Workspace Lock must be enforced per-request on the mobile/MCP surface, warm cache and all.

The lock gate `_assert_unlocked()` is reachable from the mobile routes, but the image service
is a process-lived singleton (`_image_service()` caches `AGENT_IMAGES`). Enforcement was, in
practice, an accident: most routes call `require_consent()`, which calls `_api()`, which asserts
the lock. But `capabilities()` and other non-consent routes do NOT, and a future route might not
either. So a phone paired while the workspace was unlocked could keep reading after the user
enables + locks Workspace Lock.

This pins the guarantee at the choke point: `_image_service()` re-asserts the lock every call.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/mcp_workspace_lock_warm_cache_units.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

import crossage_fr.mcp_server as mcp
from crossage_fr.store.workspace_db import path_signature


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _lock(workspace: Path) -> None:
    (workspace / ".vintrace-workspace-lock.json").write_text(
        json.dumps({"encryptedSecret": "deadbeef"}), encoding="utf-8"
    )


def _unlock(workspace: Path) -> None:
    path = workspace / ".vintrace-workspace-lock.json"
    if path.exists():
        path.unlink()


def _refused(fn) -> bool:
    try:
        fn()
        return False
    except ValueError as exc:
        return "Workspace Lock" in str(exc)


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "ws"
        root.mkdir()
        mcp.WORKSPACE = root.resolve()
        mcp.API = None
        mcp.AGENT_IMAGES = None

        api = mcp._api()
        # Consent is re-read from disk at the request boundary, so write it, don't just set
        # the in-memory field.
        api.project.consent_path.write_text(json.dumps({"active": True}), encoding="utf-8")
        api.project.refresh_consent_from_disk()
        photo = Path(tmp) / "a.jpg"
        Image.new("RGB", (16, 16), (7, 7, 7)).save(photo)
        with api.project.db.connect() as conn:
            asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
                conn,
                source_path=str(photo),
                content_hash="hash-a",
                file_signature=path_signature(photo),
            )
            conn.commit()

        # Phone browses while unlocked: warms the AGENT_IMAGES singleton.
        service = mcp._image_service()
        warm = service.fetch_assets([asset_id])
        got = (warm.get("data") or {}).get("items") or []
        check("warm read while unlocked works", any(str(i.get("assetId")) == asset_id for i in got))

        # User enables + locks Workspace Lock on the desktop.
        _lock(root)
        check("lock file makes the workspace report locked", mcp._workspace_lock_enabled() is True)

        # The consent-bearing routes must now refuse on the WARM cache.
        check("locked: fetch_assets refused", _refused(lambda: mcp._image_service().fetch_assets([asset_id])))
        check(
            "locked: preview refused",
            _refused(lambda: mcp._image_service().preview(asset_id=asset_id, max_dimension=64)),
        )
        check(
            "locked: search refused",
            _refused(lambda: mcp._image_service().search(query="", mode="lexical", limit=10)),
        )

        # The crux: a NON-consent route must also be gated. capabilities() never calls
        # require_consent(), so before the fix it would have served through a locked workspace.
        check(
            "locked: the no-consent capabilities route is ALSO gated",
            _refused(lambda: mcp._image_service().capabilities()),
        )

        # Unlocking restores access — the gate tracks the live lock state, it is not sticky.
        _unlock(root)
        check("unlock file removed reports unlocked", mcp._workspace_lock_enabled() is False)
        restored = mcp._image_service().fetch_assets([asset_id])
        got = (restored.get("data") or {}).get("items") or []
        check("unlocked again restores access", any(str(i.get("assetId")) == asset_id for i in got))

    print("\nAll workspace-lock warm-cache checks passed.")


if __name__ == "__main__":
    main()

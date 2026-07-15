"""A paired phone must not be able to reach photos the user hid or deleted.

Hidden and Recently Deleted are gated behind OS biometric auth on the desktop
(desktop/main.cjs Touch ID prompt; src/views/photoRailVisibility.ts). But that gate lives
in Electron. The agent/MCP surface — which is what a paired mobile companion talks to —
never checked it.

Measured before the fix, with the asset marked hidden in the database:

    search          -> filtered  (ok)
    fetch_assets    -> RETURNED THE ASSET
    analyze_assets  -> RETURNED THE ASSET
    preview         -> RETURNED THE JPEG BYTES

So the Face ID gate on Hidden was, from a paired phone's point of view, client-side
decoration. A phone that had seen the photo before it was hidden kept the pixels. The same
held for Recently Deleted.

Design note: restricted assets are reported as NOT FOUND rather than FORBIDDEN. A distinct
"forbidden" reply would be an oracle confirming that a specific hidden photo exists.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/agent_hidden_asset_gate_units.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.agent_images import AgentImageService
from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _service(root: Path) -> tuple[DesktopApi, AgentImageService, str]:
    api = DesktopApi(root / "ws", actor="mcp")
    api.project.consent = {"active": True}
    photo = root / "secret.jpg"
    Image.new("RGB", (64, 64), (200, 0, 0)).save(photo)
    with api.project.db.connect() as conn:
        asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(photo),
            content_hash="hash-secret",
            file_signature=path_signature(photo),
        )
        conn.commit()
    service = AgentImageService(
        api,
        workspace=root,
        require_consent=lambda: None,
        validate_path=lambda path: path,
    )
    return api, service, asset_id


def _mark(api: DesktopApi, asset_id: str, sql: str) -> None:
    with api.project.db.connect() as conn:
        conn.execute(sql, (asset_id,))
        conn.commit()


def _reachable(service: AgentImageService, asset_id: str) -> dict[str, bool]:
    out: dict[str, bool] = {}

    # Reachable == the asset's DATA came back. An id echoed in "missingAssetIds" is the
    # correct not-found reply, not a leak, so we look only at the returned items.
    payload = service.fetch_assets([asset_id])
    items = (payload.get("data") or {}).get("items") or []
    out["fetch_assets"] = any(str(item.get("assetId")) == asset_id for item in items)

    payload = service.analyze_assets(asset_ids=[asset_id], capabilities=["metadata"])
    analyzed = (payload.get("data") or {}).get("items") or []
    out["analyze_assets"] = any(str(item.get("assetId")) == asset_id for item in analyzed)

    try:
        service.preview(asset_id=asset_id, max_dimension=640)
        out["preview"] = True
    except ValueError:
        out["preview"] = False

    return out


def main() -> None:
    # Baseline: a visible asset must remain fully reachable. We are closing a hole,
    # not breaking the product.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _api, service, asset_id = _service(root)
        reach = _reachable(service, asset_id)
        check("visible asset: fetch_assets works", reach["fetch_assets"] is True)
        check("visible asset: analyze_assets works", reach["analyze_assets"] is True)
        check("visible asset: preview works", reach["preview"] is True)

    # HIDDEN must be unreachable on every agent route.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api, service, asset_id = _service(root)
        _mark(api, asset_id, "UPDATE photo_asset_metadata SET hidden = 1 WHERE asset_id = ?")
        reach = _reachable(service, asset_id)
        check("HIDDEN asset: fetch_assets refuses", reach["fetch_assets"] is False)
        check("HIDDEN asset: analyze_assets refuses", reach["analyze_assets"] is False)
        check("HIDDEN asset: preview refuses (no pixels)", reach["preview"] is False)

    # RECENTLY DELETED must be unreachable too.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api, service, asset_id = _service(root)
        _mark(
            api,
            asset_id,
            "UPDATE photo_asset_metadata SET deleted_at = '2026-07-14T00:00:00Z' WHERE asset_id = ?",
        )
        reach = _reachable(service, asset_id)
        check("DELETED asset: fetch_assets refuses", reach["fetch_assets"] is False)
        check("DELETED asset: analyze_assets refuses", reach["analyze_assets"] is False)
        check("DELETED asset: preview refuses (no pixels)", reach["preview"] is False)

    # Unhiding must restore access — the gate follows the user's intent, it is not sticky.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api, service, asset_id = _service(root)
        _mark(api, asset_id, "UPDATE photo_asset_metadata SET hidden = 1 WHERE asset_id = ?")
        check("hidden then...", _reachable(service, asset_id)["preview"] is False)
        _mark(api, asset_id, "UPDATE photo_asset_metadata SET hidden = 0 WHERE asset_id = ?")
        check("...unhidden restores access", _reachable(service, asset_id)["preview"] is True)

    print("\nAll agent hidden/deleted gate checks passed.")


if __name__ == "__main__":
    main()

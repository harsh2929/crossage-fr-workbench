"""Demo desktop companion for mobile integration testing.

Seeds a throwaway workspace with a few labelled photos, DISABLES Safe Mode (so previews render for
the demo), provisions one mobile pairing account with a known code, and serves the SEC-09 companion
HTTP surface on a fixed loopback port the iOS simulator can reach. This only *uses* the desktop
backend (crossage_fr) — it does not modify it. Run from the repo root via:

    node desktop/scripts/run-python.cjs mobile-app/tools/demo-desktop.py
"""
from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.mobile_companion import MOBILE_ALLOWED_TOOLS, MOBILE_UNPAIRED_TOKEN_HASH

PORT = 8765
CODE = "vintracedemopaircodeaaaaaaaaaaaaaaaaaaaaaaa"  # 43 url-safe chars

FIXTURES = [
    ("golden-retriever.jpg", "Golden retriever", (250, 186, 66), (176, 92, 24)),
    ("beach-sunset.jpg", "Beach sunset", (255, 128, 86), (58, 30, 92)),
    ("mountain-lake.jpg", "Mountain lake", (74, 150, 190), (18, 48, 82)),
    ("city-lights.jpg", "City at night", (126, 86, 210), (18, 18, 48)),
    ("forest-trail.jpg", "Forest trail", (70, 168, 100), (18, 58, 34)),
    ("birthday-party.jpg", "Birthday party", (244, 150, 186), (150, 42, 96)),
]


def make_image(path: Path, title: str, c1, c2) -> None:
    w, h = 1000, 720
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / h
        row = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = row
    draw = ImageDraw.Draw(img)
    draw.text((44, h - 76), title, fill=(255, 255, 255))
    img.save(path, quality=90)


def main() -> None:
    tmp = tempfile.TemporaryDirectory(prefix="vintrace-demo-desktop-")
    root = Path(tmp.name)
    workspace = root / "workspace"
    media = root / "media"
    media.mkdir()

    paths = []
    for filename, title, c1, c2 in FIXTURES:
        p = media / filename
        make_image(p, title, c1, c2)
        paths.append(p)

    api = DesktopApi(workspace, actor="demo-desktop")
    api.handle("set_consent", {"value": True, "operator": "demo", "source": "demo"})
    api.handle("save_settings", {"safeMode": False})  # allow previews for the demo
    imported = api.import_photos({"sourcePaths": [str(p) for p in paths], "storageMode": "referenced"})
    assets = api.project.db.photo_assets_by_paths(imported["importedPaths"])
    title_by_name = {fn: title for fn, title, *_ in FIXTURES}
    for asset in assets:
        api.project.db.update_photo_asset_metadata(
            asset_id=asset["assetId"],
            title=title_by_name[Path(str(asset["sourcePath"])).name],
            caption="Demo desktop catalog photo.",
        )

    now = int(time.time())
    accounts_path = root / "mobile-companions.json"
    accounts_path.write_text(
        json.dumps(
            {
                "version": 2,
                "accounts": [
                    {
                        "accountId": "mobile-demo_device_01",
                        "displayName": "Demo phone",
                        "clientType": "mobile",
                        "readOnly": True,
                        "tokenSha256": MOBILE_UNPAIRED_TOKEN_HASH,
                        "pairingCodeSha256": hashlib.sha256(CODE.encode("utf-8")).hexdigest(),
                        "scopes": ["images:read", "images:preview"],
                        "allowedTools": sorted(MOBILE_ALLOWED_TOOLS),
                        "createdAt": "2026-07-15T12:00:00Z",
                        "pairingExpiresAt": now + 3600,
                        "expiresAt": now + 86_400,
                        "disabled": False,
                    }
                ],
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    accounts_path.chmod(0o600)

    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(Path.cwd()),
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_MCP_TOKEN": "demo-operator",
            "VINTRACE_MOBILE_ACCOUNTS_FILE": str(accounts_path),
            "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace),
            "VINTRACE_MOBILE_ASSETS_DIR": str(Path.cwd() / "mobile-dist"),
            "VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK": "1",
            "VINTRACE_MCP_RATE_LIMIT": "0",
        }
    )
    child = subprocess.Popen(
        [
            sys.executable, "-m", "crossage_fr.mcp_server",
            "--workspace", str(workspace),
            "--transport", "streamable-http",
            "--host", "127.0.0.1", "--port", str(PORT),
            "--tool-profile", "images",
        ],
        cwd=Path.cwd(),
        env=env,
    )

    def stop(*_a) -> None:
        if child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    time.sleep(2.5)
    print(json.dumps({"base": f"http://127.0.0.1:{PORT}", "code": CODE, "assets": len(paths)}), flush=True)
    try:
        child.wait()
    finally:
        stop()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
        tmp.cleanup()


if __name__ == "__main__":
    main()

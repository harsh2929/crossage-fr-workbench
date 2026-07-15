from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.mobile_companion import MOBILE_ALLOWED_TOOLS, MOBILE_UNPAIRED_TOKEN_HASH


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request_ready(base: str, token: str) -> bool:
    from urllib.error import HTTPError, URLError
    from urllib.request import Request, urlopen

    try:
        with urlopen(
            Request(f"{base}/v1/health", headers={"Authorization": f"Bearer {token}"}),
            timeout=1,
        ) as response:
            return response.status == 200
    except (HTTPError, URLError, OSError):
        return False


def main() -> None:
    temporary = tempfile.TemporaryDirectory(prefix="vintrace-mobile-browser-")
    root = Path(temporary.name)
    workspace = root / "workspace"
    media = root / "media"
    media.mkdir()
    fixtures = [
        ("sunset-garden.jpg", "Sunset garden", (220, 92, 72)),
        ("coastal-morning.jpg", "Coastal morning", (50, 137, 154)),
        ("birthday-table.jpg", "Birthday table", (226, 170, 52)),
        ("city-evening.jpg", "City evening", (76, 70, 116)),
        ("green-trail.jpg", "Green trail", (52, 132, 87)),
        ("family-portrait.jpg", "Family portrait", (177, 88, 122)),
    ]
    paths: list[Path] = []
    for index, (filename, _title, color) in enumerate(fixtures):
        source = media / filename
        image = Image.new("RGB", (900 + index * 20, 640), color)
        image.save(source, quality=91)
        paths.append(source)

    api = DesktopApi(workspace, actor="mobile-browser-fixture")
    api.handle("set_consent", {"value": True, "operator": "Browser test", "source": "test"})
    imported = api.import_photos({"sourcePaths": [str(item) for item in paths], "storageMode": "referenced"})
    assets = api.project.db.photo_assets_by_paths(imported["importedPaths"])
    title_by_name = {filename: title for filename, title, _color in fixtures}
    for asset in assets:
        filename = Path(str(asset["sourcePath"])).name
        api.project.db.update_photo_asset_metadata(
            asset_id=asset["assetId"],
            title=title_by_name[filename],
            caption=f"A local browser fixture called {title_by_name[filename]}.",
        )

    pairing_code = "b" * 43
    account_id = "mobile-browser_device_01"
    now = int(time.time())
    accounts_path = root / "mobile-companions.json"
    accounts_path.write_text(
        json.dumps(
            {
                "version": 2,
                "accounts": [
                    {
                        "accountId": account_id,
                        "displayName": "Browser test phone",
                        "clientType": "mobile",
                        "readOnly": True,
                        "tokenSha256": MOBILE_UNPAIRED_TOKEN_HASH,
                        "pairingCodeSha256": hashlib.sha256(pairing_code.encode("utf-8")).hexdigest(),
                        "scopes": ["images:read", "images:preview"],
                        "allowedTools": sorted(MOBILE_ALLOWED_TOOLS),
                        "createdAt": "2026-07-13T12:00:00Z",
                        "pairingExpiresAt": now + 600,
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

    port = free_port()
    base = f"http://127.0.0.1:{port}"
    token = "mobile-browser-operator"
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(Path.cwd()),
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_MCP_TOKEN": token,
            "VINTRACE_MOBILE_ACCOUNTS_FILE": str(accounts_path),
            "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace),
            "VINTRACE_MOBILE_ASSETS_DIR": str(Path.cwd() / "mobile-dist"),
            "VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK": "1",
            "VINTRACE_MCP_RATE_LIMIT": "0",
        }
    )
    child = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "crossage_fr.mcp_server",
            "--workspace",
            str(workspace),
            "--transport",
            "streamable-http",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--tool-profile",
            "images",
        ],
        cwd=Path.cwd(),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )

    stopping = False

    def stop(_signal=None, _frame=None):
        nonlocal stopping
        if stopping:
            return
        stopping = True
        if child.poll() is None:
            child.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        deadline = time.time() + 20
        while time.time() < deadline and child.poll() is None:
            if request_ready(base, token):
                break
            time.sleep(0.1)
        else:
            stderr = child.stderr.read().decode("utf-8", errors="replace") if child.stderr else ""
            raise RuntimeError(f"Mobile browser fixture failed to start: {stderr}")
        print(
            json.dumps(
                {
                    "base": base,
                    "pairingUrl": f"{base}/mobile/#pair={pairing_code}",
                    "accountsPath": str(accounts_path),
                    "accountId": account_id,
                }
            ),
            flush=True,
        )
        child.wait()
    finally:
        stop()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait(timeout=5)
        temporary.cleanup()


if __name__ == "__main__":
    main()

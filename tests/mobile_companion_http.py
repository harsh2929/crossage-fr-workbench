from __future__ import annotations

from http.cookiejar import CookieJar
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPCookieProcessor, Request, build_opener, urlopen

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.mobile_companion import MOBILE_ALLOWED_TOOLS, MOBILE_UNPAIRED_TOKEN_HASH


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def mobile_account(pairing_code: str, *, account_id: str, previews: bool, now: int) -> dict:
    tools = sorted(MOBILE_ALLOWED_TOOLS - (set() if previews else {"get_image_preview"}))
    return {
        "accountId": account_id,
        "displayName": "HTTP test phone" if previews else "Metadata test phone",
        "clientType": "mobile",
        "readOnly": True,
        "tokenSha256": MOBILE_UNPAIRED_TOKEN_HASH,
        "pairingCodeSha256": hashlib.sha256(pairing_code.encode("utf-8")).hexdigest(),
        "scopes": ["images:read", "images:preview"] if previews else ["images:read"],
        "allowedTools": tools,
        "createdAt": "2026-07-13T12:00:00Z",
        "pairingExpiresAt": now + 600,
        "expiresAt": now + 86_400,
        "disabled": False,
    }


def request(
    url: str,
    *,
    opener=None,
    token: str = "",
    method: str = "GET",
    body: dict | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    request_headers = dict(headers or {})
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    data = None
    if body is not None:
        request_headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=request_headers, method=method)
    runner = opener.open if opener is not None else urlopen
    try:
        with runner(req, timeout=10) as response:
            return int(response.status), response.read(), dict(response.headers.items())
    except HTTPError as exc:
        return int(exc.code), exc.read(), dict(exc.headers.items())


def json_request(*args, **kwargs) -> tuple[int, dict, dict[str, str]]:
    status, raw, headers = request(*args, **kwargs)
    return status, json.loads(raw.decode("utf-8")) if raw else {}, headers


def write_accounts(path: Path, accounts: list[dict]) -> None:
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps({"version": 2, "accounts": accounts}, indent=2), encoding="utf-8")
    temporary.chmod(0o600)
    os.replace(temporary, path)
    path.chmod(0o600)


def wait_ready(base: str, token: str, process: subprocess.Popen, *, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise AssertionError(f"Mobile server exited early ({process.returncode}): {stderr}")
        try:
            status, payload, _headers = json_request(f"{base}/v1/health", token=token)
            if status == 200 and payload.get("ok"):
                return
        except (OSError, URLError, ValueError):
            pass
        time.sleep(0.1)
    raise AssertionError("Mobile companion server did not become ready.")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-mobile-http-") as tmp:
        root = Path(tmp)
        packaged_executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
        workspace = root / "workspace"
        media = root / "media"
        media.mkdir()
        photo = media / "private-mobile-fixture.jpg"
        Image.new("RGB", (960, 640), (32, 126, 116)).save(photo, quality=92)

        api = DesktopApi(workspace, actor="mobile-http-test")
        api.handle("set_consent", {"value": True, "operator": "Mobile test", "source": "test"})
        imported = api.import_photos({"sourcePaths": [str(photo)], "storageMode": "referenced"})
        assert imported["importedCount"] == 1, imported

        now = int(time.time())
        pairing_code = "p" * 43
        metadata_pairing_code = "m" * 43
        account_id = "mobile-http_device_01"
        metadata_account_id = "mobile-http_device_02"
        accounts_path = root / "mobile-companions.json"
        accounts = [
            mobile_account(pairing_code, account_id=account_id, previews=True, now=now),
            mobile_account(metadata_pairing_code, account_id=metadata_account_id, previews=False, now=now),
        ]
        write_accounts(accounts_path, accounts)

        mobile_dist = Path.cwd() / "mobile-dist"
        if not packaged_executable:
            assert (mobile_dist / "index.html").is_file(), "Run npm run build:mobile before this test."
        port = free_port()
        operator_token = "mobile-http-operator-secret"
        env = os.environ.copy()
        env.update(
            {
                "VINTRACE_WORKSPACE": str(workspace),
                "CROSSAGE_WORKSPACE": str(workspace),
                "VINTRACE_MCP_TOKEN": operator_token,
                "VINTRACE_MOBILE_ACCOUNTS_FILE": str(accounts_path),
                "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace),
                "VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK": "1",
                "VINTRACE_MCP_RATE_LIMIT": "0",
            }
        )
        if packaged_executable:
            env.pop("PYTHONPATH", None)
            env.pop("VINTRACE_MOBILE_ASSETS_DIR", None)
            server_command = [
                str(Path(packaged_executable).expanduser().resolve()),
                "--mcp",
                "--workspace",
                str(workspace),
                "--mcp-transport",
                "streamable-http",
                "--mcp-host",
                "127.0.0.1",
                "--mcp-port",
                str(port),
                "--mcp-tool-profile",
                "images",
            ]
        else:
            env["PYTHONPATH"] = str(Path.cwd())
            env["VINTRACE_MOBILE_ASSETS_DIR"] = str(mobile_dist)
            server_command = [
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
            ]
        process = subprocess.Popen(
            server_command,
            cwd=Path.cwd(),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            wait_ready(base, operator_token, process, timeout=60.0 if packaged_executable else 20.0)

            status, shell, shell_headers = request(f"{base}/mobile/")
            shell_text = shell.decode("utf-8")
            lower_headers = {key.lower(): value for key, value in shell_headers.items()}
            assert status == 200 and "Vintrace" in shell_text
            assert pairing_code not in shell_text and operator_token not in shell_text
            assert lower_headers.get("cache-control") == "private, no-store"
            assert "frame-ancestors 'none'" in lower_headers.get("content-security-policy", "")
            assert lower_headers.get("x-frame-options") == "DENY"
            script_match = re.search(r'src="(/mobile/assets/[^"]+\.js)"', shell_text)
            assert script_match, shell_text
            status, script, script_headers = request(f"{base}{script_match.group(1)}")
            assert status == 200 and len(script) > 100_000
            assert "immutable" in {key.lower(): value for key, value in script_headers.items()}.get("cache-control", "")
            status, redirected, _headers = request(f"{base}/mobile")
            assert status == 200 and redirected.startswith(b"<!doctype html>")
            print("ok public mobile shell, strict headers, immutable hashed assets, and no embedded credentials")

            status, cross_site, _headers = json_request(
                f"{base}/v1/mobile/pair",
                method="POST",
                body={"pairingCode": pairing_code},
                headers={"Sec-Fetch-Site": "cross-site"},
            )
            assert status == 403 and cross_site["error"]["code"] == "mobile_pairing_origin", cross_site

            cookie_jar = CookieJar()
            mobile = build_opener(HTTPCookieProcessor(cookie_jar))
            status, paired, pair_headers = json_request(
                f"{base}/v1/mobile/pair",
                opener=mobile,
                method="POST",
                body={"pairingCode": pairing_code},
                headers={"Sec-Fetch-Site": "same-origin"},
            )
            assert status == 200 and paired["data"]["device"]["accountId"] == account_id, paired
            assert paired["policy"] == {"readOnly": True, "pixelDisclosure": False}
            assert "token" not in json.dumps(paired).lower(), paired
            set_cookie = pair_headers.get("Set-Cookie", pair_headers.get("set-cookie", ""))
            assert "vintrace_mobile_dev=" in set_cookie and "HttpOnly" in set_cookie and "SameSite=strict" in set_cookie
            cookie = next(item for item in cookie_jar if item.name == "vintrace_mobile_dev")
            session_token = cookie.value
            stored = json.loads(accounts_path.read_text(encoding="utf-8"))
            stored_account = next(item for item in stored["accounts"] if item["accountId"] == account_id)
            assert stored_account["tokenSha256"] == hashlib.sha256(session_token.encode("utf-8")).hexdigest()
            assert "pairingCodeSha256" not in stored_account and session_token not in accounts_path.read_text(encoding="utf-8")
            status, reused, _headers = json_request(
                f"{base}/v1/mobile/pair",
                method="POST",
                body={"pairingCode": pairing_code},
            )
            assert status == 400 and reused["error"]["code"] == "mobile_pairing_invalid", reused
            print("ok same-origin one-use pairing, HttpOnly session, hash-only storage, and replay rejection")

            status, session, _headers = json_request(f"{base}/v1/mobile/session", opener=mobile)
            assert status == 200 and session["data"]["device"]["readOnly"] is True, session
            assert session["data"]["device"]["allowPreviews"] is True
            status, library, _headers = json_request(f"{base}/v1/library", opener=mobile)
            assert status == 200 and library["data"]["assetCount"] == 1, library
            status, changes, _headers = json_request(
                f"{base}/v1/changes?afterSeq=0&limit=10",
                opener=mobile,
            )
            assert status == 200 and changes["data"]["items"], changes
            assert changes["data"]["cursor"]["nextAfterSeq"] > 0, changes
            changes_text = json.dumps(changes)
            assert str(photo) not in changes_text and photo.name not in changes_text
            status, search, _headers = json_request(
                f"{base}/v1/search",
                opener=mobile,
                method="POST",
                body={"query": "", "mode": "lexical", "limit": 10},
            )
            assert status == 200 and search["page"]["returned"] == 1, search
            search_text = json.dumps(search)
            assert str(photo) not in search_text and photo.name not in search_text
            asset_id = search["data"]["items"][0]["assetId"]
            status, preview, preview_headers = request(
                f"{base}/v1/assets/{asset_id}/preview?maxDimension=512&maxBytes=786432",
                opener=mobile,
            )
            preview_header_map = {key.lower(): value for key, value in preview_headers.items()}
            assert status == 200 and len(preview) > 100 and preview_header_map["cache-control"] == "private, no-store"
            assert preview_header_map["content-type"].startswith("image/jpeg")
            print("ok read-only library, cursor-paged changes, path-free search, inference, and bounded preview")

            denied_requests = [
                ("POST", "/v1/actions/run", {"lane": "read", "action": "update_photo_asset_metadata", "payload": {}}),
                ("POST", "/v1/actions/plan", {"action": "update_photo_asset_metadata", "payload": {}}),
                ("GET", "/v1/connectors", None),
                ("GET", "/v1/operations", None),
                ("GET", "/v1/recipes", None),
                ("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "search_images"}}),
            ]
            for method, path, body in denied_requests:
                status, denied, _headers = json_request(
                    f"{base}{path}", opener=mobile, method=method, body=body
                )
                assert status == 403 and denied["error"]["code"] == "mobile_read_only", (path, denied)
            print("ok forged lane, write planning, connector, operation, recipe, MCP, and future-surface denial")

            metadata_jar = CookieJar()
            metadata_mobile = build_opener(HTTPCookieProcessor(metadata_jar))
            status, metadata_paired, _headers = json_request(
                f"{base}/v1/mobile/pair",
                opener=metadata_mobile,
                method="POST",
                body={"pairingCode": metadata_pairing_code},
            )
            assert status == 200 and metadata_paired["data"]["device"]["allowPreviews"] is False
            status, denied_preview, _headers = json_request(
                f"{base}/v1/assets/{asset_id}/preview",
                opener=metadata_mobile,
            )
            assert status == 403 and denied_preview["error"]["code"] == "insufficient_scope", denied_preview
            status, _body, logout_headers = request(
                f"{base}/v1/mobile/logout",
                opener=metadata_mobile,
                method="POST",
            )
            logout_header_map = {key.lower(): value for key, value in logout_headers.items()}
            assert status == 204 and "max-age=0" in logout_header_map.get("set-cookie", "").lower()
            status, logged_out, _headers = json_request(f"{base}/v1/mobile/session", opener=metadata_mobile)
            assert status == 401 and logged_out["error"]["code"] == "unauthorized", logged_out
            print("ok independent preview scope and browser-local logout")

            current = json.loads(accounts_path.read_text(encoding="utf-8"))
            revoked_account = next(item for item in current["accounts"] if item["accountId"] == account_id)
            revoked_account["disabled"] = True
            revoked_account["revokedAt"] = "2026-07-13T12:10:00Z"
            revoked_account["tokenSha256"] = MOBILE_UNPAIRED_TOKEN_HASH
            write_accounts(accounts_path, current["accounts"])
            status, revoked, _headers = json_request(f"{base}/v1/mobile/session", opener=mobile)
            assert status == 401 and revoked["error"]["code"] == "unauthorized", revoked
            print("ok immediate cross-process revocation without server restart")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    print("all mobile companion HTTP tests passed")


if __name__ == "__main__":
    main()

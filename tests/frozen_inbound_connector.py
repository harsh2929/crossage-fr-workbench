from __future__ import annotations

import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAABgAAAASCAYAAABmJxwEAAAABmJLR0QA/wD/AP+gvaeTAAAALUlEQVQ4jWNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAXDDAAEFAABb3iJYQAAAABJRU5ErkJggg=="
)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") == request_id and "ok" in row:
            if not row.get("ok"):
                raise AssertionError(row)
            return row.get("result", {})


def wait_backend_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def wait_http_ready(url: str, token: str, process: subprocess.Popen, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"Frozen MCP HTTP server exited early: {process.returncode}")
        try:
            with urlopen(Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, HTTPError, URLError):
            pass
        time.sleep(0.1)
    raise AssertionError("Frozen MCP HTTP server did not become ready.")


def main() -> None:
    executable_value = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
    if not executable_value:
        raise SystemExit("VINTRACE_MCP_TEST_EXECUTABLE is required.")
    executable = Path(executable_value).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit(f"Frozen backend executable does not exist: {executable}")

    expected_auth = "Basic " + base64.b64encode(b"frozen:frozen-secret").decode("ascii")

    class Handler(BaseHTTPRequestHandler):
        def do_PROPFIND(self):  # noqa: N802
            if self.headers.get("Authorization") != expected_auth:
                self.send_error(401)
                return
            body = b'''<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/frozen.png</d:href><d:propstat><d:prop><d:displayname>frozen.png</d:displayname><d:getcontenttype>image/png</d:getcontenttype><d:getcontentlength>91</d:getcontentlength><d:getlastmodified>Sat, 11 Jul 2026 10:00:00 GMT</d:getlastmodified><d:getetag>frozen-etag</d:getetag><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>'''
            self.send_response(207)
            self.send_header("Content-Type", "application/xml")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path == "/dav/frozen.png" and self.headers.get("Authorization") == expected_auth:
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(PNG)))
                self.end_headers()
                self.wfile.write(PNG)
                return
            self.send_error(404)

        def log_message(self, _format, *_args):
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-inbound-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        env = os.environ.copy()
        env.update({
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(root / "registry"),
            "CROSSAGE_REGISTRY_HOME": str(root / "registry"),
            "VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST": "1",
            "CROSSAGE_FORCE_FALLBACK": "1",
        })
        bootstrap = subprocess.Popen(
            [str(executable), "--workspace", str(workspace)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        mcp_process: subprocess.Popen | None = None
        try:
            wait_backend_ready(bootstrap)
            rpc(bootstrap, "consent", "set_consent", {"value": True, "operator": "Frozen connector test", "source": "test"})
            configured = rpc(bootstrap, "configure", "configure_inbound_connector", {
                "provider": "webdav",
                "connectionId": "frozen-webdav",
                "displayName": "Frozen WebDAV",
                "baseUrl": f"http://127.0.0.1:{server.server_port}/dav/",
                "username": "frozen",
                "password": "frozen-secret",
                "maxItems": 10,
            })
            value = configured.get("value", {})
            if value.get("credentialPersistence") != "os-vault":
                rpc(bootstrap, "forget-skip", "forget_inbound_connector", {"provider": "webdav", "connectionId": "frozen-webdav"})
                print("frozen inbound OS-vault test skipped: native vault unavailable")
                return

            port = free_port()
            token = "frozen-inbound-http-token"
            http_env = {**env, "VINTRACE_MCP_TOKEN": token}
            mcp_process = subprocess.Popen(
                [
                    str(executable), "--mcp", "--workspace", str(workspace),
                    "--mcp-transport", "streamable-http", "--mcp-host", "127.0.0.1", "--mcp-port", str(port),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                env=http_env,
            )
            base = f"http://127.0.0.1:{port}"
            wait_http_ready(f"{base}/v1/health", token, mcp_process)
            request = Request(
                f"{base}/v1/connectors/webdav/frozen-webdav/discover",
                data=b'{"itemLimit":10,"sampleLimit":10}',
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                method="POST",
            )
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            serialized = json.dumps(payload, sort_keys=True)
            assert payload["ok"] and payload["data"]["counts"]["assets"] == 1, payload
            assert "frozen-secret" not in serialized and "127.0.0.1" not in serialized, payload
            print("frozen inbound connector rehydrated an OS-vault credential across backend and MCP processes")
        finally:
            if mcp_process is not None:
                mcp_process.terminate()
                try:
                    mcp_process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    mcp_process.kill()
            if bootstrap.poll() is None:
                try:
                    rpc(bootstrap, "forget", "forget_inbound_connector", {"provider": "webdav", "connectionId": "frozen-webdav"})
                except Exception:
                    pass
                bootstrap.terminate()
                try:
                    bootstrap.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    bootstrap.kill()
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()

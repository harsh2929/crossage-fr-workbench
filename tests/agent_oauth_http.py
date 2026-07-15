from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from jwt.algorithms import RSAAlgorithm


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def json_request(url: str, *, token: str = "") -> tuple[int, dict, dict[str, str]]:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(url, headers=headers)
    try:
        with urlopen(request, timeout=5) as response:
            return int(response.status), json.loads(response.read().decode("utf-8")), {key.lower(): value for key, value in response.headers.items()}
    except HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8")), {key.lower(): value for key, value in exc.headers.items()}


def wait_ready(url: str, process: subprocess.Popen, *, timeout: float) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise AssertionError(f"OAuth HTTP server exited early ({process.returncode}): {stderr}")
        try:
            status, _, _ = json_request(url)
            if status == 200:
                return
        except OSError:
            pass
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for the OAuth HTTP server.")


def main() -> None:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(private_key.public_key()))
    jwk.update({"kid": "vintrace-oauth-test", "use": "sig", "alg": "RS256"})

    class JwksHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            body = json.dumps({"keys": [jwk]}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            return

    jwks_server = ThreadingHTTPServer(("127.0.0.1", 0), JwksHandler)
    thread = threading.Thread(target=jwks_server.serve_forever, daemon=True)
    thread.start()
    issuer = f"http://127.0.0.1:{jwks_server.server_port}"
    server_port = free_port()
    base = f"http://127.0.0.1:{server_port}"
    resource = f"{base}/mcp"

    with tempfile.TemporaryDirectory(prefix="vintrace-oauth-http-") as tmp:
        workspace = Path(tmp) / "workspace"
        os.environ.update(
            {
                "VINTRACE_WORKSPACE": str(workspace),
                "CROSSAGE_WORKSPACE": str(workspace),
                "VINTRACE_REGISTRY_HOME": str(Path(tmp) / "registry"),
                "CROSSAGE_REGISTRY_HOME": str(Path(tmp) / "registry"),
                "VINTRACE_MCP_OAUTH_ISSUER": issuer,
                "VINTRACE_MCP_OAUTH_RESOURCE_URL": resource,
                "VINTRACE_MCP_OAUTH_AUDIENCE": resource,
                "VINTRACE_MCP_OAUTH_JWKS_URL": f"{issuer}/jwks.json",
                "VINTRACE_MCP_OAUTH_ALGORITHMS": "RS256",
            }
        )
        now = int(time.time())

        def access_token(*, audience: str = resource, scopes: str = "images:read") -> str:
            return jwt.encode(
                {
                    "iss": issuer,
                    "aud": audience,
                    "sub": "enterprise-user-7",
                    "client_id": "codex-oauth-test",
                    "iat": now,
                    "exp": now + 300,
                    "scope": scopes,
                },
                private_key,
                algorithm="RS256",
                headers={"kid": "vintrace-oauth-test"},
            )

        packaged_executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
        env = os.environ.copy()
        if packaged_executable:
            env.pop("PYTHONPATH", None)
            command = [
                str(Path(packaged_executable).expanduser().resolve()),
                "--mcp",
                "--workspace",
                str(workspace),
                "--mcp-transport",
                "streamable-http",
                "--mcp-host",
                "127.0.0.1",
                "--mcp-port",
                str(server_port),
            ]
        else:
            env["PYTHONPATH"] = str(Path.cwd())
            command = [
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
                str(server_port),
            ]
        process = subprocess.Popen(
            command,
            cwd=Path.cwd(),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        try:
            metadata_url = f"{base}/.well-known/oauth-protected-resource"
            wait_ready(metadata_url, process, timeout=60.0 if packaged_executable else 20.0)
            status, metadata, _ = json_request(metadata_url)
            assert status == 200
            assert metadata["resource"] == resource
            assert metadata["authorization_servers"] == [issuer]
            assert {"images:read", "images:preview", "images:write", "images:destructive", "events:read", "images:admin"} <= set(metadata["scopes_supported"])

            status, missing, missing_headers = json_request(f"{base}/v1/health")
            challenge = missing_headers.get("www-authenticate", "")
            assert status == 401 and missing["error"]["code"] == "unauthorized"
            assert f'resource_metadata="{base}/.well-known/oauth-protected-resource"' in challenge, challenge
            status, health, _ = json_request(f"{base}/v1/health", token=access_token())
            assert status == 200 and health["authentication"]["oauth"] is True, health
            status, denied_events, _ = json_request(f"{base}/v1/activity", token=access_token())
            assert status == 403 and denied_events["error"]["code"] == "insufficient_scope"
            status, allowed_events, _ = json_request(
                f"{base}/v1/activity",
                token=access_token(scopes="images:read events:read"),
            )
            assert status in {200, 412}, allowed_events
            status, _, _ = json_request(
                f"{base}/v1/health",
                token=access_token(audience=f"{base}/other"),
            )
            assert status == 401
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    jwks_server.shutdown()
    jwks_server.server_close()
    thread.join(timeout=5)
    print("ok live OAuth protected-resource metadata, JWKS verification, audience binding, and scope enforcement")


if __name__ == "__main__":
    main()

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request_json(url: str, token: str, payload: dict | None = None) -> tuple[int, dict, dict[str, str]]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-11-25",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["Mcp-Method"] = str(payload.get("method", ""))
        params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
        name = params.get("name", params.get("uri"))
        if name:
            headers["Mcp-Name"] = str(name)
    request = Request(url, data=body, headers=headers, method="POST" if body is not None else "GET")
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            response_headers = {key.lower(): value for key, value in response.headers.items()}
            status = int(response.status)
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        response_headers = {key.lower(): value for key, value in exc.headers.items()}
        status = int(exc.code)
    if "text/event-stream" in response_headers.get("content-type", ""):
        messages = [line[6:] for line in raw.splitlines() if line.startswith("data: ")]
        parsed = json.loads(messages[-1]) if messages else {}
    else:
        parsed = json.loads(raw) if raw else {}
    return status, parsed, response_headers


def wait_ready(url: str, token: str, process: subprocess.Popen, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise RuntimeError(f"Stateless MCP server exited early: {stderr[-3000:]}")
        try:
            status, _, _ = request_json(url, token)
            if status == 200:
                return
        except (URLError, TimeoutError, ValueError):
            pass
        time.sleep(0.1)
    raise TimeoutError("Stateless MCP HTTP server did not become ready.")


async def verify_initialized_client(url: str, token: str) -> None:
    async with httpx.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30) as http_client:
        async with streamable_http_client(url, http_client=http_client) as (read, write, session_id):
            async with ClientSession(read, write) as session:
                initialized = await session.initialize()
                assert initialized.capabilities.logging is None
                listed = await session.list_tools()
                assert len(listed.tools) == 130
                assert session_id() is None


def main() -> None:
    root = Path.cwd()
    token = "stateless-http-test-token"
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-stateless-") as tmp:
        workspace = Path(tmp) / "workspace"
        env = os.environ.copy()
        env.update(
            {
                "PYTHONPATH": str(root),
                "CROSSAGE_FORCE_FALLBACK": "1",
                "VINTRACE_WORKSPACE": str(workspace),
                "CROSSAGE_WORKSPACE": str(workspace),
                "VINTRACE_REGISTRY_HOME": str(Path(tmp) / "registry"),
                "CROSSAGE_REGISTRY_HOME": str(Path(tmp) / "registry"),
                "VINTRACE_MCP_TOKEN": token,
                "VINTRACE_MCP_OPERATOR_TOKEN": "stateless-http-operator",
                "VINTRACE_MCP_HTTP_STATELESS": "1",
            }
        )
        executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
        if executable:
            env.pop("PYTHONPATH", None)
            command = [
                str(Path(executable).expanduser().resolve()),
                "--mcp",
                "--workspace",
                str(workspace),
                "--mcp-transport",
                "streamable-http",
                "--mcp-host",
                "127.0.0.1",
                "--mcp-port",
                str(port),
            ]
        else:
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
                str(port),
            ]
        process = subprocess.Popen(
            command,
            cwd=root,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        try:
            wait_ready(f"{base}/v1/health", token, process, timeout=60 if executable else 20)
            tools_request = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
            status, tools, headers = request_json(f"{base}/mcp", token, tools_request)
            assert status == 200, tools
            assert len(tools["result"]["tools"]) == 130
            assert "mcp-session-id" not in headers

            call_request = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {"name": "list_image_capabilities", "arguments": {}},
            }
            status, called, headers = request_json(f"{base}/mcp", token, call_request)
            assert status == 200, called
            assert called["result"]["structuredContent"]["ok"] is True
            assert "mcp-session-id" not in headers

            consent_request = {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "mark_consent",
                    "arguments": {
                        "confirmed": True,
                        "operator": "Stateless MCP test",
                        "confirm": True,
                        "operator_token": "stateless-http-operator",
                    },
                },
            }
            status, consent, _ = request_json(f"{base}/mcp", token, consent_request)
            assert status == 200 and consent["result"]["isError"] is False, consent

            task_request = {
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {
                    "name": "run_image_write_action",
                    "arguments": {
                        "action": "save_photo_album",
                        "payload": {"name": "Stateless task album", "albumKind": "manual"},
                        "confirm": True,
                        "idempotency_key": "stateless-task-album-v1",
                    },
                    "task": {"ttl": 60_000},
                },
            }
            status, task_created, _ = request_json(f"{base}/mcp", token, task_request)
            assert status == 200, task_created
            task_id = str(task_created["result"]["task"]["taskId"])
            task_status = {}
            for request_id in range(5, 105):
                get_request = {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": "tasks/get",
                    "params": {"taskId": task_id},
                }
                status, task_status, task_headers = request_json(f"{base}/mcp", token, get_request)
                assert status == 200 and "mcp-session-id" not in task_headers, task_status
                if task_status["result"]["status"] == "completed":
                    break
                time.sleep(0.05)
            assert task_status["result"]["status"] == "completed", task_status
            result_request = {
                "jsonrpc": "2.0",
                "id": 105,
                "method": "tasks/result",
                "params": {"taskId": task_id},
            }
            status, task_result, _ = request_json(f"{base}/mcp", token, result_request)
            assert status == 200, task_result
            assert task_result["result"]["structuredContent"]["ok"] is True

            asyncio.run(verify_initialized_client(f"{base}/mcp", token))
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    source = (root / "crossage_fr" / "mcp_server.py").read_text(encoding="utf-8")
    for forbidden in ("sampling/createMessage", ".create_message(", ".list_roots(", "logging/setLevel"):
        assert forbidden not in source
    assert 'stateless_http=env_flag("MCP_HTTP_STATELESS", default=True)' in source
    print("ok stateless handshake-free HTTP, initialized compatibility, no session IDs, and no deprecated primitives")


if __name__ == "__main__":
    main()

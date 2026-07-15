from __future__ import annotations

import hashlib
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from PIL import Image

from crossage_fr.api_server import DesktopApi


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def request(
    url: str,
    *,
    token: str = "",
    method: str = "GET",
    body: dict | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    req = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(req, timeout=10) as response:
            return int(response.status), response.read(), dict(response.headers.items())
    except HTTPError as exc:
        return int(exc.code), exc.read(), dict(exc.headers.items())


def json_request(*args, **kwargs) -> tuple[int, dict]:
    status, raw, _headers = request(*args, **kwargs)
    return status, json.loads(raw.decode("utf-8"))


def wait_ready(url: str, token: str, process: subprocess.Popen, *, timeout: float = 20.0) -> None:
    deadline = time.time() + timeout
    last_error = ""
    while time.time() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise AssertionError(f"Agent HTTP server exited early ({process.returncode}): {stderr}")
        try:
            status, payload = json_request(url, token=token)
            if status == 200 and payload.get("ok"):
                return
        except (OSError, URLError, ValueError) as exc:
            last_error = repr(exc)
        time.sleep(0.1)
    raise AssertionError(f"Agent HTTP server did not become ready: {last_error}")


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-agent-http-") as tmp:
        root = Path(tmp)
        packaged_executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
        workspace = root / "workspace"
        media = root / "media"
        media.mkdir()
        photo = media / "private-http-fixture.jpg"
        Image.new("RGB", (720, 480), (40, 120, 170)).save(photo, quality=90)

        remote_png = BytesIO()
        Image.new("RGB", (48, 36), (170, 80, 40)).save(remote_png, format="PNG")
        remote_bytes = remote_png.getvalue()

        class RemoteFixtureHandler(BaseHTTPRequestHandler):
            def do_PROPFIND(self):  # noqa: N802
                expected = "Basic " + base64.b64encode(b"webdav:webdav-secret").decode("ascii")
                if self.headers.get("Authorization") != expected:
                    self.send_error(401)
                    return
                body = b'''<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/dav/remote-fixture.png</d:href><d:propstat><d:prop><d:displayname>remote-fixture.png</d:displayname><d:getcontenttype>image/png</d:getcontenttype><d:getcontentlength>128</d:getcontentlength><d:getlastmodified>Sat, 11 Jul 2026 10:00:00 GMT</d:getlastmodified><d:getetag>fixture-etag</d:getetag><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>'''
                self.send_response(207)
                self.send_header("Content-Type", "application/xml")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):  # noqa: N802
                if self.path == "/robots.txt":
                    body, content_type = b"User-agent: *\nAllow: /\n", "text/plain"
                elif self.path == "/gallery":
                    body, content_type = b'<html><body><img src="/remote-fixture.png" alt="Remote fixture"></body></html>', "text/html"
                elif self.path in {"/remote-fixture.png", "/dav/remote-fixture.png"}:
                    if self.path.startswith("/dav/"):
                        expected = "Basic " + base64.b64encode(b"webdav:webdav-secret").decode("ascii")
                        if self.headers.get("Authorization") != expected:
                            self.send_error(401)
                            return
                    body, content_type = remote_bytes, "image/png"
                else:
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, _format, *_args):
                return

        remote_server = ThreadingHTTPServer(("127.0.0.1", 0), RemoteFixtureHandler)
        remote_thread = threading.Thread(target=remote_server.serve_forever, daemon=True)
        remote_thread.start()
        remote_base_url = f"http://127.0.0.1:{remote_server.server_port}"
        remote_url = f"{remote_base_url}/gallery"

        os.environ["VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST"] = "1"
        api = DesktopApi(workspace, actor="agent-http-test")
        api.handle("set_consent", {"value": True, "operator": "HTTP test", "source": "test"})
        imported = api.import_photos({"sourcePaths": [str(photo)], "storageMode": "referenced"})
        assert imported["importedCount"] == 1, imported
        configured_connector = api.configure_inbound_connector({
            "provider": "web",
            "connectionId": "http-web-fixture",
            "displayName": "HTTP web fixture",
            "urls": [remote_url],
            "maxItems": 10,
            "maxPages": 1,
        })
        assert configured_connector["source"]["status"] == "ready", configured_connector
        shared_vault_available = False
        if not packaged_executable:
            configured_webdav = api.configure_inbound_connector({
                "provider": "webdav",
                "connectionId": "http-webdav-fixture",
                "displayName": "HTTP WebDAV fixture",
                "baseUrl": f"{remote_base_url}/dav/",
                "username": "webdav",
                "password": "webdav-secret",
                "maxItems": 10,
            })
            shared_vault_available = configured_webdav.get("credentialPersistence") == "os-vault"

        port = free_port()
        token = "agent-http-secret"
        service_account_token = "agent-http-reader-secret"
        service_accounts = root / "service-accounts.json"
        service_accounts.write_text(
            json.dumps(
                {
                    "version": 1,
                    "accounts": [
                        {
                            "accountId": "http-search-reader",
                            "tokenSha256": hashlib.sha256(service_account_token.encode("utf-8")).hexdigest(),
                            "scopes": ["images:read"],
                            "allowedTools": ["search_images"],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        service_accounts.chmod(0o600)
        env = os.environ.copy()
        env.update(
            {
                "PYTHONPATH": str(Path.cwd()),
                "CROSSAGE_FORCE_FALLBACK": "1",
                "VINTRACE_WORKSPACE": str(workspace),
                "CROSSAGE_WORKSPACE": str(workspace),
                "VINTRACE_MCP_TOKEN": token,
                "VINTRACE_MCP_SERVICE_ACCOUNTS_FILE": str(service_accounts),
                "VINTRACE_MCP_ALLOWED_ROOTS": str(root),
                "VINTRACE_REGISTRY_HOME": str(root / "registry"),
                "CROSSAGE_REGISTRY_HOME": str(root / "registry"),
                "VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST": "1",
            }
        )
        if packaged_executable:
            env.pop("PYTHONPATH", None)
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
            ]
        else:
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
            wait_ready(
                f"{base}/v1/health",
                token,
                process,
                timeout=60.0 if packaged_executable else 20.0,
            )

            status, payload = json_request(f"{base}/v1/health")
            assert status == 401 and payload["error"]["code"] == "unauthorized", (status, payload)
            print("ok agent HTTP bearer auth")

            status, scoped_search = json_request(
                f"{base}/v1/search",
                token=service_account_token,
                method="POST",
                body={"query": "fixture", "mode": "lexical", "limit": 1},
            )
            assert status == 200 and scoped_search["page"]["returned"] == 1, scoped_search
            status, denied_capability = json_request(
                f"{base}/v1/capabilities", token=service_account_token
            )
            assert status == 403 and denied_capability["error"]["code"] == "tool_not_granted", denied_capability
            status, denied_scoped_write = json_request(
                f"{base}/v1/actions/run",
                token=service_account_token,
                method="POST",
                body={"action": "update_photo_asset_metadata", "lane": "write", "payload": {}},
            )
            assert status == 403 and denied_scoped_write["error"]["code"] == "insufficient_scope", denied_scoped_write
            print("ok agent HTTP scoped service account and per-tool grant")

            status, openapi = json_request(f"{base}/v1/openapi.json", token=token)
            assert status == 200 and openapi["openapi"] == "3.1.0", openapi
            assert {
                "/v1/search",
                "/v1/mobile/pair",
                "/v1/mobile/session",
                "/v1/mobile/logout",
                "/v1/assets/analyze",
                "/v1/assets/{asset_id}/preview",
                "/v1/actions/plan",
                "/v1/actions/run",
                "/v1/activity",
                "/v1/events",
                "/v1/operations",
                "/v1/recipes",
                "/v1/recipes/plan",
                "/v1/connectors",
                "/v1/connectors/{provider}/{connection_id}/discover",
                "/v1/connectors/{provider}/{connection_id}/import",
                "/v1/connectors/{provider}/{connection_id}/sync",
            } <= set(openapi["paths"]), openapi["paths"]
            assert openapi["components"]["securitySchemes"]["bearerAuth"]["scheme"] == "bearer"
            mobile_scheme = openapi["components"]["securitySchemes"]["mobileSession"]
            assert mobile_scheme == {
                "type": "apiKey",
                "in": "cookie",
                "name": "__Host-vintrace_mobile",
                "description": "Secure, HttpOnly, SameSite=Strict session issued by the one-use mobile pairing exchange.",
            }, mobile_scheme
            operation_ids = [
                operation["operationId"]
                for path_item in openapi["paths"].values()
                for operation in path_item.values()
                if isinstance(operation, dict) and "operationId" in operation
            ]
            assert len(operation_ids) == len(set(operation_ids)), operation_ids
            schema_names = set(openapi["components"]["schemas"])

            def collect_refs(value):
                if isinstance(value, dict):
                    for key, child in value.items():
                        if key == "$ref" and isinstance(child, str) and child.startswith("#/components/schemas/"):
                            yield child.rsplit("/", 1)[-1]
                        else:
                            yield from collect_refs(child)
                elif isinstance(value, list):
                    for child in value:
                        yield from collect_refs(child)

            unresolved = sorted(set(collect_refs(openapi)) - schema_names)
            assert not unresolved, unresolved
            print("ok self-describing OpenAPI 3.1 contract")

            status, capabilities = json_request(f"{base}/v1/capabilities", token=token)
            assert status == 200 and capabilities["data"]["actionCount"] >= 137, capabilities
            action_contracts = capabilities["data"]["actions"]
            assert capabilities["data"]["deprecations"] == []
            assert sum(bool(action.get("acceptedFields")) for action in action_contracts) >= 129
            export_contract = next(action for action in action_contracts if action["name"] == "export_photo_selection")
            assert "assetIds" in export_contract["acceptedFields"], export_contract
            assert export_contract["deprecated"] is False and export_contract["replacementAction"] == ""
            print("ok agent HTTP live capability catalog")

            status, connectors = json_request(f"{base}/v1/connectors", token=token)
            connector_text = json.dumps(connectors, sort_keys=True)
            assert status == 200 and connectors["data"]["sources"], connectors
            assert remote_url not in connector_text and "remote-fixture.png" not in connector_text, connector_text
            status, discovered = json_request(
                f"{base}/v1/connectors/web/http-web-fixture/discover",
                token=token,
                method="POST",
                body={"itemLimit": 10, "sampleLimit": 10},
            )
            assert status == 200 and discovered["data"]["counts"]["assets"] == 1, discovered
            if shared_vault_available:
                status, webdav_discovered = json_request(
                    f"{base}/v1/connectors/webdav/http-webdav-fixture/discover",
                    token=token,
                    method="POST",
                    body={"itemLimit": 10, "sampleLimit": 10},
                )
                assert status == 200 and webdav_discovered["data"]["counts"]["assets"] == 1, webdav_discovered
                assert "webdav-secret" not in json.dumps(webdav_discovered), webdav_discovered
                print("ok agent HTTP cross-process OS-vault credential rehydration")
            status, unconfirmed_inbound = json_request(
                f"{base}/v1/connectors/web/http-web-fixture/import",
                token=token,
                method="POST",
                body={"externalDownloadConsent": True, "confirm": False, "idempotencyKey": "http-inbound-v1"},
            )
            assert status == 428 and unconfirmed_inbound["error"]["code"] == "confirmation_required", unconfirmed_inbound
            status, started_inbound = json_request(
                f"{base}/v1/connectors/web/http-web-fixture/import",
                token=token,
                method="POST",
                body={"externalDownloadConsent": True, "confirm": True, "idempotencyKey": "http-inbound-v1"},
            )
            assert status == 200 and started_inbound["ok"], started_inbound
            inbound_job_id = str(started_inbound["data"].get("jobId") or started_inbound["data"].get("job", {}).get("jobId") or "")
            assert inbound_job_id, started_inbound
            deadline = time.time() + 10
            inbound_job = {}
            while time.time() < deadline:
                status, inbound_job = json_request(f"{base}/v1/jobs/inbound/{inbound_job_id}", token=token)
                if status == 200 and inbound_job.get("data", {}).get("status") in {"completed", "failed", "cancelled"}:
                    break
                time.sleep(0.1)
            assert inbound_job["data"]["status"] == "completed", inbound_job
            assert inbound_job["data"]["result"]["counts"]["imported"] == 1, inbound_job
            print("ok agent HTTP inbound discover, consent, managed import, and job polling")

            status, library = json_request(f"{base}/v1/library", token=token)
            assert status == 200 and library["data"]["assetCount"] == 2, library

            api.handle("set_consent", {"value": False, "operator": "HTTP test", "source": "test"})
            status, revoked_library = json_request(f"{base}/v1/library", token=token)
            assert status == 412 and revoked_library["error"]["code"] == "consent_required", revoked_library
            api.handle("set_consent", {"value": True, "operator": "HTTP test", "source": "test"})
            status, restored_library = json_request(f"{base}/v1/library", token=token)
            assert status == 200 and restored_library["data"]["assetCount"] == 2, restored_library
            print("ok live cross-process consent grant and revocation")

            status, recipes = json_request(f"{base}/v1/recipes?includeSteps=true", token=token)
            assert status == 200 and recipes["data"]["builtinCount"] == 8, recipes
            status, recipe_plan = json_request(
                f"{base}/v1/recipes/plan",
                token=token,
                method="POST",
                body={"recipeId": "builtin.portfolio-curation", "inputs": {"query": "fixture"}},
            )
            assert status == 200 and recipe_plan["data"]["steps"], recipe_plan
            custom_recipe = {
                "name": "HTTP review recipe",
                "description": "Plan a bounded search.",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {"query": {"type": "string"}},
                },
                "steps": [
                    {
                        "id": "search-step",
                        "tool": "search_images",
                        "arguments": {"query": "{{input.query}}", "limit": 20},
                        "approval": "none",
                    }
                ],
            }
            recipe_write = {"recipeId": "custom.http-review", "recipe": custom_recipe}
            status, denied_recipe = json_request(
                f"{base}/v1/recipes", token=token, method="POST", body=recipe_write
            )
            assert status == 428 and denied_recipe["error"]["code"] == "confirmation_required", denied_recipe
            recipe_write.update({"confirm": True, "idempotencyKey": "http-recipe-save-v1"})
            status, saved_recipe = json_request(
                f"{base}/v1/recipes", token=token, method="POST", body=recipe_write
            )
            assert status == 200 and saved_recipe["data"]["recipe"]["name"] == "HTTP review recipe", saved_recipe
            status, fetched_recipe = json_request(f"{base}/v1/recipes/custom.http-review", token=token)
            assert status == 200 and fetched_recipe["data"]["recipe"]["name"] == "HTTP review recipe", fetched_recipe
            print("ok agent HTTP built-in and durable custom recipes")

            status, search = json_request(
                f"{base}/v1/search",
                token=token,
                method="POST",
                body={"query": "fixture", "mode": "lexical", "limit": 10},
            )
            assert status == 200 and search["page"]["returned"] == 2, search
            asset_id = next(
                item["assetId"]
                for item in search["data"]["items"]
                if item.get("sourceKind") != "managed"
            )
            assert str(photo) not in json.dumps(search) and photo.name not in json.dumps(search)
            print("ok agent HTTP path-free image search")

            status, fetched = json_request(
                f"{base}/v1/assets/fetch",
                token=token,
                method="POST",
                body={"assetIds": [asset_id]},
            )
            assert status == 200 and fetched["data"]["items"][0]["assetId"] == asset_id, fetched

            status, analyzed = json_request(
                f"{base}/v1/assets/analyze",
                token=token,
                method="POST",
                body={"assetIds": [asset_id], "capabilities": ["metadata", "text", "objects", "barcodes", "quality"]},
            )
            assert status == 200 and analyzed["data"]["items"][0]["assetId"] == asset_id, analyzed
            assert analyzed["policy"]["pixelDisclosure"] is False
            assert str(photo) not in json.dumps(analyzed) and photo.name not in json.dumps(analyzed)
            print("ok agent HTTP path-free local image intelligence")

            status, fetched_one = json_request(f"{base}/v1/assets/{asset_id}", token=token)
            assert status == 200 and fetched_one["data"]["items"][0]["assetId"] == asset_id, fetched_one
            status, missing_one = json_request(f"{base}/v1/assets/asset_missing", token=token)
            assert status == 404 and missing_one["error"]["code"] == "not_found", missing_one

            status, preview, headers = request(
                f"{base}/v1/assets/{asset_id}/preview?maxDimension=512",
                token=token,
            )
            header_map = {key.lower(): value for key, value in headers.items()}
            assert status == 200 and header_map.get("content-type", "").startswith("image/jpeg"), headers
            assert len(preview) > 100
            assert header_map.get("cache-control") == "private, no-store"
            print("ok agent HTTP bounded image preview")

            action_payload = {"assetId": asset_id, "title": "HTTP approved title"}
            status, plan = json_request(
                f"{base}/v1/actions/plan",
                token=token,
                method="POST",
                body={"action": "update_photo_asset_metadata", "payload": action_payload},
            )
            assert status == 200 and plan["data"]["nextTool"] == "run_image_write_action", plan

            status, unconfirmed = json_request(
                f"{base}/v1/actions/run",
                token=token,
                method="POST",
                body={"action": "update_photo_asset_metadata", "lane": "write", "payload": action_payload},
            )
            assert status == 428 and unconfirmed["error"]["code"] == "confirmation_required", unconfirmed

            write_body = {
                "action": "update_photo_asset_metadata",
                "lane": "write",
                "payload": action_payload,
                "confirm": True,
                "idempotencyKey": "http-metadata-v1",
            }
            status, written = json_request(
                f"{base}/v1/actions/run", token=token, method="POST", body=write_body
            )
            assert status == 200 and written["ok"] is True, written
            status, replayed = json_request(
                f"{base}/v1/actions/run", token=token, method="POST", body=write_body
            )
            assert status == 200 and replayed["replayed"] is True, replayed
            print("ok agent HTTP planned idempotent write")

            status, exported = json_request(
                f"{base}/v1/actions/run",
                token=token,
                method="POST",
                body={
                    "action": "export_photo_selection",
                    "lane": "write",
                    "payload": {"assetIds": [asset_id], "folder": str(root / "agent-export")},
                    "confirm": True,
                    "idempotencyKey": "http-stable-export-v1",
                },
            )
            assert status == 200 and exported["data"]["counts"]["copied"] == 1, exported
            assert str(photo.resolve()) not in json.dumps(exported), exported
            print("ok agent HTTP stable-ID export without source-path disclosure")

            status, outside = json_request(
                f"{base}/v1/actions/plan",
                token=token,
                method="POST",
                body={"action": "import_photos", "payload": {"sourcePaths": ["/etc/passwd"]}},
            )
            assert status == 403 and outside["error"]["code"] == "path_out_of_scope", outside
            print("ok agent HTTP recursive path boundary")

            with socket.create_connection(("127.0.0.1", port), timeout=10) as raw_socket:
                raw_socket.sendall(
                    (
                        "POST /v1/search HTTP/1.1\r\n"
                        f"Host: 127.0.0.1:{port}\r\n"
                        f"Authorization: Bearer {token}\r\n"
                        "Content-Type: application/json\r\n"
                        "Content-Length: 1048577\r\n"
                        "Connection: close\r\n\r\n"
                    ).encode("ascii")
                )
                oversized_response = b""
                while True:
                    chunk = raw_socket.recv(65536)
                    if not chunk:
                        break
                    oversized_response += chunk
            status_line, _, oversized_body = oversized_response.partition(b"\r\n")
            assert b" 413 " in status_line, status_line
            oversized = json.loads(oversized_body.split(b"\r\n\r\n", 1)[-1].decode("utf-8"))
            assert oversized["error"]["code"] == "payload_too_large", oversized
            print("ok agent HTTP body limit")

            status, jobs = json_request(f"{base}/v1/jobs/indexing", token=token)
            assert status == 200 and jobs["action"] == "get_image_job", jobs
            print("ok agent HTTP normalized job listing")

            status, operations = json_request(f"{base}/v1/operations?limit=50", token=token)
            assert status == 200 and operations["data"]["items"], operations
            export_operation = next(
                item for item in operations["data"]["items"]
                if item["kind"] == "agent-write" and item["action"] == "export_photo_selection"
            )
            operation_id = export_operation["operationId"]
            status, operation = json_request(f"{base}/v1/operations/{operation_id}", token=token)
            assert status == 200 and operation["data"]["manifest"]["privacy"]["outputPathsIncluded"] is False, operation
            status, manifest = json_request(f"{base}/v1/operations/{operation_id}/manifest", token=token)
            assert status == 200 and manifest["data"]["manifest"]["operation"]["operationId"] == operation_id, manifest
            assert str(photo.resolve()) not in json.dumps(operation) and photo.name not in json.dumps(operation)

            status, activity = json_request(f"{base}/v1/activity?limit=100", token=token)
            assert status == 200 and activity["data"]["summary"]["confirmed"] >= 1, activity
            assert activity["data"]["summary"]["pixelDisclosures"] >= 1, activity
            assert any(
                item.get("principalId") == "local-operator" and item.get("authType") == "local-token"
                for item in activity["data"]["items"]
            ), activity
            stream_request = Request(
                f"{base}/v1/events?afterSeq=0",
                headers={"Authorization": f"Bearer {token}"},
                method="GET",
            )
            with urlopen(stream_request, timeout=10) as response:
                assert response.headers.get_content_type() == "text/event-stream"
                event_data = ""
                principals = set()
                for _ in range(120):
                    line = response.readline().decode("utf-8", errors="replace").strip()
                    if line.startswith("data: "):
                        candidate = json.loads(line[6:])
                        if candidate.get("action"):
                            event_data = candidate
                            assert "path" not in json.dumps(candidate).lower(), candidate
                            principals.add((candidate.get("principalId"), candidate.get("authType")))
                            if {
                                ("http-search-reader", "service-account"),
                                ("local-operator", "local-token"),
                            } <= principals:
                                break
                assert event_data and "path" not in json.dumps(event_data).lower(), event_data
                assert ("http-search-reader", "service-account") in principals, principals
                assert ("local-operator", "local-token") in principals, principals
            print("ok agent HTTP operations, activity, and resumable event stream")

            status, denied_delete = json_request(
                f"{base}/v1/recipes/custom.http-review",
                token=token,
                method="DELETE",
                body={"confirm": False, "idempotencyKey": "http-recipe-delete-v1"},
            )
            assert status == 428 and denied_delete["error"]["code"] == "confirmation_required", denied_delete
            status, deleted_recipe = json_request(
                f"{base}/v1/recipes/custom.http-review",
                token=token,
                method="DELETE",
                body={"confirm": True, "idempotencyKey": "http-recipe-delete-v1"},
            )
            assert status == 200 and deleted_recipe["data"]["deleted"] is True, deleted_recipe
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            remote_server.shutdown()
            remote_server.server_close()
            if shared_vault_available:
                api.forget_inbound_connector({"provider": "webdav", "connectionId": "http-webdav-fixture"})
            os.environ.pop("VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST", None)

    print("all agent HTTP API tests passed")


if __name__ == "__main__":
    main()

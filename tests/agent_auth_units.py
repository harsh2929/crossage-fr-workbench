from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import time

import anyio
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
import jwt
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from crossage_fr.agent_auth import AgentTokenVerifier, OAuthResourceConfig, current_agent_principal
from crossage_fr.mcp_server import _ScopedAuthMiddleware


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def verify(verifier: AgentTokenVerifier, token: str):
    return anyio.run(verifier.verify_principal, token)


async def echo(request: Request):
    principal = current_agent_principal()
    body = None
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        try:
            body = await request.json()
        except Exception:
            body = None
    return JSONResponse(
        {
            "ok": True,
            "principalId": principal.principal_id if principal else "",
            "authType": principal.auth_type if principal else "",
            "body": body,
        }
    )


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-agent-auth-") as tmp:
        root = Path(tmp)
        accounts_path = root / "service-accounts.json"
        accounts_path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "accounts": [
                        {
                            "accountId": "search-reader",
                            "tokenSha256": token_hash("reader-secret"),
                            "scopes": ["images:read"],
                            "allowedTools": ["search_images"],
                        },
                        {
                            "accountId": "metadata-writer",
                            "tokenSha256": token_hash("writer-secret"),
                            "scopes": ["images:write"],
                            "allowedTools": ["run_image_write_action"],
                            "expiresAt": 4_000_000_000,
                        },
                        {
                            "accountId": "expired-reader",
                            "tokenSha256": token_hash("expired-secret"),
                            "scopes": ["images:read"],
                            "expiresAt": int(time.time()) - 60,
                        },
                        {
                            "accountId": "mobile-test_device_01",
                            "displayName": "Test phone",
                            "clientType": "mobile",
                            "readOnly": True,
                            "tokenSha256": token_hash("mobile-secret"),
                            "scopes": ["images:read", "images:preview"],
                            "allowedTools": [
                                "mobile_session",
                                "list_image_capabilities",
                                "get_image_library_overview",
                                "search_images",
                                "fetch_image_assets",
                                "analyze_image_assets",
                                "get_image_preview",
                            ],
                            "expiresAt": 4_000_000_000,
                        },
                    ],
                }
            ),
            encoding="utf-8",
        )
        accounts_path.chmod(0o600)

        verifier = AgentTokenVerifier(local_token="operator-secret", service_accounts_path=accounts_path)
        verifier.validate_configuration()
        reader = verify(verifier, "reader-secret")
        assert reader and reader.principal_id == "search-reader" and reader.has_scope("images:read")
        assert not reader.has_scope("images:write") and reader.allowed_tools == ("search_images",)
        writer = verify(verifier, "writer-secret")
        assert writer and writer.has_scope("images:read") and writer.has_scope("images:write")
        assert not writer.has_scope("images:destructive") and writer.expires_at == 4_000_000_000
        operator = verify(verifier, "operator-secret")
        assert operator and operator.has_scope("images:destructive") and operator.has_scope("events:read")
        mobile = verify(verifier, "mobile-secret")
        assert mobile and mobile.auth_type == "mobile" and mobile.client_type == "mobile"
        assert mobile.read_only and mobile.display_name == "Test phone"
        assert mobile.has_scope("images:preview") and not mobile.has_scope("images:write")
        assert verify(verifier, "expired-secret") is None and verify(verifier, "wrong-secret") is None
        print("ok hash-only service accounts, scope implication, expiry, and local operator authority")

        app = Starlette(
            routes=[
                Route("/", echo, methods=["GET", "POST", "DELETE"]),
                Route("/{path:path}", echo, methods=["GET", "POST", "DELETE"]),
            ]
        )
        client = TestClient(_ScopedAuthMiddleware(app, verifier))
        missing = client.get("/v1/search")
        assert missing.status_code == 401 and missing.json()["error"]["code"] == "unauthorized"
        assert 'error="invalid_token"' in missing.headers["www-authenticate"]

        allowed_read = client.get("/v1/search", headers={"Authorization": "Bearer reader-secret"})
        assert allowed_read.status_code == 200 and allowed_read.json()["principalId"] == "search-reader"
        denied_tool = client.get("/v1/library", headers={"Authorization": "Bearer reader-secret"})
        assert denied_tool.status_code == 403 and denied_tool.json()["error"]["code"] == "tool_not_granted"
        denied_write = client.post(
            "/v1/actions/run",
            headers={"Authorization": "Bearer reader-secret"},
            json={"lane": "write", "action": "update_photo_asset_metadata", "payload": {}},
        )
        assert denied_write.status_code == 403 and denied_write.json()["error"]["code"] == "insufficient_scope"
        assert 'scope="images:write"' in denied_write.headers["www-authenticate"]

        allowed_write = client.post(
            "/v1/actions/run",
            headers={"Authorization": "Bearer writer-secret"},
            json={"lane": "write", "action": "update_photo_asset_metadata", "payload": {"title": "x"}},
        )
        assert allowed_write.status_code == 200 and allowed_write.json()["body"]["lane"] == "write"
        denied_destructive = client.post(
            "/v1/actions/run",
            headers={"Authorization": "Bearer writer-secret"},
            json={"lane": "destructive", "action": "delete_photo_album", "payload": {}},
        )
        assert denied_destructive.status_code == 403 and denied_destructive.json()["error"]["code"] == "insufficient_scope"

        mcp_search = client.post(
            "/mcp",
            headers={"Authorization": "Bearer reader-secret"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "search_images", "arguments": {}}},
        )
        assert mcp_search.status_code == 200 and mcp_search.json()["body"]["params"]["name"] == "search_images"
        mcp_write = client.post(
            "/mcp",
            headers={"Authorization": "Bearer reader-secret"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "run_image_write_action", "arguments": {}}},
        )
        assert mcp_write.status_code == 403 and mcp_write.json()["error"]["code"] == "insufficient_scope"
        print("ok per-route and per-MCP-tool grants with RFC 6750 scope challenges")

        mobile_headers = {"Cookie": "__Host-vintrace_mobile=mobile-secret"}
        mobile_session = client.get("/v1/mobile/session", headers=mobile_headers)
        assert mobile_session.status_code == 200 and mobile_session.json()["authType"] == "mobile"
        mobile_search = client.post(
            "/v1/search",
            headers=mobile_headers,
            json={"query": "family", "mode": "hybrid"},
        )
        assert mobile_search.status_code == 200 and mobile_search.json()["principalId"] == "mobile-test_device_01"
        mobile_preview = client.get("/v1/assets/asset_01/preview", headers=mobile_headers)
        assert mobile_preview.status_code == 200
        forged_lane = client.post(
            "/v1/actions/run",
            headers=mobile_headers,
            json={"lane": "read", "action": "update_photo_asset_metadata", "payload": {}},
        )
        assert forged_lane.status_code == 403 and forged_lane.json()["error"]["code"] == "mobile_read_only"
        mobile_mcp = client.post(
            "/mcp",
            headers=mobile_headers,
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "search_images"}},
        )
        assert mobile_mcp.status_code == 403 and mobile_mcp.json()["error"]["code"] == "mobile_read_only"
        future_route = client.get("/v1/operations", headers=mobile_headers)
        assert future_route.status_code == 403 and future_route.json()["error"]["code"] == "mobile_read_only"
        print("ok mobile cookie, exact endpoint allowlist, and independent read-only firewall")

        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        public_key = private_key.public_key().public_bytes(
            serialization.Encoding.PEM,
            serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        oauth = OAuthResourceConfig(
            issuer="https://identity.example.test",
            audience="https://images.example.test/mcp",
            resource_url="https://images.example.test/mcp",
            jwks_url="https://identity.example.test/.well-known/jwks.json",
            algorithms=("RS256",),
        )
        oauth_verifier = AgentTokenVerifier(oauth=oauth, oauth_key_resolver=lambda _token: public_key)
        now = int(time.time())
        encoded = jwt.encode(
            {
                "iss": oauth.issuer,
                "aud": oauth.audience,
                "sub": "operator-42",
                "client_id": "codex-enterprise",
                "iat": now,
                "exp": now + 300,
                "scope": "images:read images:preview events:read",
            },
            private_key,
            algorithm="RS256",
        )
        oauth_principal = verify(oauth_verifier, encoded)
        assert oauth_principal and oauth_principal.auth_type == "oauth"
        assert oauth_principal.principal_id == "codex-enterprise:operator-42"
        assert oauth_principal.has_scope("images:preview") and not oauth_principal.has_scope("images:write")
        assert oauth_principal.expires_at == now + 300
        oauth_access_token = anyio.run(oauth_verifier.verify_token, encoded)
        assert oauth_access_token and oauth_access_token.expires_at == now + 300
        wrong_audience = jwt.encode(
            {
                "iss": oauth.issuer,
                "aud": "https://other.example.test/mcp",
                "sub": "operator-42",
                "client_id": "codex-enterprise",
                "iat": now,
                "exp": now + 300,
                "scope": "images:admin",
            },
            private_key,
            algorithm="RS256",
        )
        assert verify(oauth_verifier, wrong_audience) is None
        print("ok OAuth JWT signature, issuer, expiry, audience, identity, and scopes")

    print("all agent auth unit tests passed")


if __name__ == "__main__":
    main()

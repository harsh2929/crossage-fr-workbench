from __future__ import annotations

from pathlib import Path

from mcp.types import CallToolResult, ResourceLink

from crossage_fr.agent_auth import AgentPrincipal, reset_current_agent_principal, set_current_agent_principal
from crossage_fr import mcp_server
from crossage_fr.agent_ui import IMAGE_REVIEW_HTML


def principal(identifier: str) -> AgentPrincipal:
    return AgentPrincipal(
        principal_id=identifier,
        auth_type="service-account",
        scopes=("images:read", "images:preview"),
    )


def main() -> None:
    first_token = set_current_agent_principal(principal("preview-reader-a"))
    try:
        resource = mcp_server._issue_preview_resource_grant(
            "asset-private-stable-id",
            max_dimension=512,
            max_bytes=524_288,
            now=1_000.0,
        )
        grant_id = resource["uri"].rsplit("/", 1)[-1]
        assert "asset-private" not in resource["uri"]
        assert mcp_server._resolve_preview_resource_grant(grant_id, now=1_001.0)["assetId"] == "asset-private-stable-id"

        second_token = set_current_agent_principal(principal("preview-reader-b"))
        try:
            try:
                mcp_server._resolve_preview_resource_grant(grant_id, now=1_001.0)
            except ValueError as exc:
                assert str(exc) == "Preview resource expired or unavailable."
            else:
                raise AssertionError("A preview grant must not cross principal boundaries.")
        finally:
            reset_current_agent_principal(second_token)

        expires_at = mcp_server._PREVIEW_RESOURCE_GRANTS[grant_id]["expiresAt"]
        try:
            mcp_server._resolve_preview_resource_grant(grant_id, now=float(expires_at) + 0.001)
        except ValueError as exc:
            assert str(exc) == "Preview resource expired or unavailable."
        else:
            raise AssertionError("An expired preview grant must fail closed.")
    finally:
        reset_current_agent_principal(first_token)

    rich = CallToolResult(
        content=[
            ResourceLink(
                type="resource_link",
                name="private-family-photo.jpg",
                title="/Users/private/private-family-photo.jpg",
                description="Generated at /Users/private/private-family-photo.jpg",
                uri="vintrace://agent/outputs/op-safe/output-safe",
                mimeType="image/jpeg",
            )
        ],
        structuredContent={"ok": True},
    )
    redacted = mcp_server._redact_tool_output(rich)
    link = redacted.content[0]
    assert link.name == "[hidden]"
    assert link.title == "[hidden]"
    assert link.description == "Generated at [hidden]"
    assert str(link.uri) == "vintrace://agent/outputs/op-safe/output-safe"

    assert mcp_server._mcp_request_requirements({
        "method": "resources/read",
        "params": {"uri": resource["uri"]},
    }) == [("images:preview", "get_image_operation")]
    assert mcp_server._mcp_request_requirements({
        "method": "resources/read",
        "params": {"uri": "vintrace://agent/manifests/op-safe"},
    }) == [("images:read", "resources/read")]
    assert 'entry?.type === "image"' not in IMAGE_REVIEW_HTML
    assert "resource_link" in IMAGE_REVIEW_HTML
    assert "readServerResource" in IMAGE_REVIEW_HTML and "readResource" in IMAGE_REVIEW_HTML
    bridge_source = (Path(__file__).resolve().parents[1] / "mcp" / "image-review-app.js").read_text(encoding="utf-8")
    assert "@modelcontextprotocol/ext-apps" in bridge_source
    assert not any(token in bridge_source for token in ("fetch(", "XMLHttpRequest", "WebSocket", "EventSource"))
    print("ok opaque preview resource expiry, principal binding, scope, and link redaction")


if __name__ == "__main__":
    main()

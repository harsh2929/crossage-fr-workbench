from __future__ import annotations

from pathlib import Path
import argparse
import anyio
from datetime import datetime, timezone
import functools
import hmac
from http.cookies import SimpleCookie
import inspect
import json
import os
import re
import secrets
import sys
import threading
import time
from typing import Any, Literal
from typing_extensions import TypedDict
from pydantic import BaseModel, ConfigDict, Field
import mcp.types as mcp_types

from mcp.server.auth.settings import AuthSettings
from mcp.server.experimental.task_result_handler import TaskResultHandler
from mcp.server.fastmcp import Context, FastMCP
from mcp.shared.exceptions import McpError
from mcp.shared.experimental.tasks.helpers import cancel_task as cancel_mcp_task
from mcp.shared.experimental.tasks.helpers import is_terminal as mcp_task_is_terminal
from mcp.types import INVALID_PARAMS, CallToolResult, ErrorData, ResourceLink, TextContent, ToolAnnotations

from crossage_fr import __version__
from crossage_fr import agent_untrusted
from crossage_fr.agent_auth import (
    AGENT_SCOPES,
    AgentPrincipal,
    AgentTokenVerifier,
    current_agent_principal,
    mobile_accounts_path_from_env,
    oauth_resource_config_from_env,
    reset_current_agent_principal,
    service_accounts_path_from_env,
    set_current_agent_principal,
)
from crossage_fr.agent_images import AgentImageService
from crossage_fr.agent_openapi import agent_images_openapi_spec
from crossage_fr.agent_telemetry import McpTelemetry
from crossage_fr.agent_ui import IMAGE_REVIEW_HTML, IMAGE_REVIEW_RESOURCE_URI, MCP_APP_MIME_TYPE
from crossage_fr.api_server import DesktopApi
from crossage_fr.config import normalize_safe_mode_profile, safe_mode_threshold_for_profile
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS
from crossage_fr.ingest.safety import assess_image_safety
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, probe_video
from crossage_fr.mcp_delegation import DelegationPolicy, ElicitationRateLimiter, SQLiteDelegationTrust
from crossage_fr.mcp_tasks import SQLiteMcpTaskStore
from crossage_fr.mobile_companion import (
    MOBILE_CLIENT_TYPE,
    MobilePairingError,
    exchange_mobile_pairing,
    mobile_asset_media_type,
    mobile_security_headers,
    resolve_mobile_asset,
)
from crossage_fr.runtime_env import env_flag, env_value
from crossage_fr.workspace_registry import resolve_workspace


AgeBucket = Literal["child", "adolescent", "adult", "unknown"]
ReviewStatus = Literal["accepted", "rejected", "uncertain", "pending"]
InboundProvider = Literal["slack", "web", "google_drive", "onedrive", "dropbox", "webdav"]
ImageCapabilityCategory = Literal["", "organize", "discover", "visibility", "import", "metadata", "export", "index", "edit", "deduplicate", "maintain"]
ImageIntelligenceCapability = Literal["metadata", "text", "objects", "barcodes", "quality", "people", "albums", "edits"]
ImageOperationKind = Literal["import", "indexing", "export", "repair", "library", "agent-write"]
ImageChoicePurpose = Literal["duplicate_keeper", "album_cover", "slideshow_cover", "video_poster", "review_selection"]


class ImageSearchFilters(TypedDict, total=False):
    favoriteOnly: bool
    favorite: bool
    editedOnly: bool
    duplicateOnly: bool
    notInAlbumOnly: bool
    hiddenOnly: bool
    deletedOnly: bool
    mediaKind: str
    media_type: str
    mediaType: str
    keyword: str
    keywords: list[str]
    tags: list[str]
    category: str
    color: str
    dominantColor: str
    object: str
    objects: list[str]
    metadata: dict[str, Any]
    dateFrom: str
    dateTo: str
    albumId: str
    person: str
    location: str
    camera: str
    fileType: str
    minQuality: float
    visibility: Literal["visible", "hidden", "deleted", "all"]


class AgentToolEnvelope(BaseModel):
    """Structured contract shared by rich image-agent tool responses."""

    model_config = ConfigDict(extra="allow")

    ok: bool
    requestId: str
    action: str
    data: Any
    page: dict[str, Any] | None = None
    job: dict[str, Any] | None = None
    warnings: list[str]
    provenance: dict[str, Any]
    policy: dict[str, Any]

IMAGE_AGENT_TOOL_NAMES = frozenset({
    "list_image_capabilities",
    "get_image_library_overview",
    "list_inbound_visual_sources",
    "discover_inbound_visuals",
    "import_inbound_visuals",
    "sync_inbound_visuals",
    "search_images",
    "fetch_image_assets",
    "elicit_image_asset_choice",
    "analyze_image_assets",
    "get_image_preview",
    "plan_image_action",
    "run_image_read_action",
    "run_image_write_action",
    "run_destructive_image_action",
    "get_image_job",
    "get_agent_activity",
    "list_image_operations",
    "get_image_operation",
    "list_image_recipes",
    "get_image_recipe",
    "plan_image_recipe",
    "save_image_recipe",
    "delete_image_recipe",
})

WORKSPACE = resolve_workspace(os.environ.get("VINTRACE_WORKSPACE") or os.environ.get("CROSSAGE_WORKSPACE"))
API: DesktopApi | None = None
AGENT_IMAGES: AgentImageService | None = None
_PREVIEW_RESOURCE_GRANTS: dict[str, dict[str, Any]] = {}
_PREVIEW_RESOURCE_GRANTS_LOCK = threading.Lock()
_MAX_PREVIEW_RESOURCE_GRANTS = 512


def _agent_principal_binding() -> str:
    principal = current_agent_principal()
    if principal is None:
        return "trusted-local-session"
    return f"{principal.auth_type}:{principal.principal_id}"


MCP_DELEGATION_POLICY = DelegationPolicy.from_env()
MCP_DELEGATION_TRUST = SQLiteDelegationTrust(
    WORKSPACE / "agent" / "mcp_delegation.sqlite3",
    principal=_agent_principal_binding,
    policy=MCP_DELEGATION_POLICY,
)
MCP_TELEMETRY = McpTelemetry(WORKSPACE)
try:
    _elicitation_requests_per_minute = int(env_value("MCP_ELICITATION_REQUESTS_PER_MINUTE") or 12)
except (TypeError, ValueError):
    _elicitation_requests_per_minute = 12
MCP_ELICITATION_RATE_LIMITER = ElicitationRateLimiter(maximum_requests=_elicitation_requests_per_minute)

OAUTH_RESOURCE_CONFIG = oauth_resource_config_from_env()
SERVICE_ACCOUNTS_PATH = service_accounts_path_from_env()
MOBILE_ACCOUNTS_PATH = mobile_accounts_path_from_env()
AGENT_TOKEN_VERIFIER = AgentTokenVerifier(
    local_token=str(env_value("MCP_TOKEN") or ""),
    service_accounts_path=SERVICE_ACCOUNTS_PATH,
    mobile_accounts_path=MOBILE_ACCOUNTS_PATH,
    oauth=OAUTH_RESOURCE_CONFIG,
)

_mcp_options: dict[str, Any] = {}
if OAUTH_RESOURCE_CONFIG is not None:
    _mcp_options.update(
        {
            "token_verifier": AGENT_TOKEN_VERIFIER,
            "auth": AuthSettings(
                issuer_url=OAUTH_RESOURCE_CONFIG.issuer,
                resource_server_url=OAUTH_RESOURCE_CONFIG.resource_url,
                required_scopes=[],
            ),
        }
    )

mcp = FastMCP(
    "Vintrace",
    log_level="WARNING",
    stateless_http=env_flag("MCP_HTTP_STATELESS", default=True),
    instructions=(
        "Vintrace is a consent-gated, local-first image platform. Search metadata before requesting pixels; "
        "use stable asset IDs instead of paths; fetch only the previews needed for the task; and keep Safe Mode "
        "enabled. Read tools are bounded. Every write must be planned, explicitly confirmed, and sent with an "
        "idempotency key; a host-rendered elicitation can provide confirmation, and only operator-enabled routine "
        "curation may graduate under the published delegation policy. Use the destructive lane only after the human "
        "approves its impact. Identity decisions, "
        "consent grants, sensitive overrides, and audit deletion remain human-authority actions. Do not repeat an "
        "identical read call: bounded responses are complete, and batch analysis exposes pendingCapabilities once."
    ),
    **_mcp_options,
)


def _api() -> DesktopApi:
    global API
    _assert_unlocked()  # MCP-05: gate all backend access (tools + resources) on the lock.
    if API is None:
        API = DesktopApi(WORKSPACE, actor="mcp")
    return API


def _set_workspace_root(path: Path) -> None:
    global AGENT_IMAGES, API, MCP_DELEGATION_TRUST, MCP_TELEMETRY, WORKSPACE
    MCP_TELEMETRY.shutdown()
    WORKSPACE = path.expanduser().resolve()
    API = None
    AGENT_IMAGES = None
    MCP_DELEGATION_TRUST = SQLiteDelegationTrust(
        WORKSPACE / "agent" / "mcp_delegation.sqlite3",
        principal=_agent_principal_binding,
        policy=MCP_DELEGATION_POLICY,
    )
    MCP_TELEMETRY = McpTelemetry(WORKSPACE)
    reset_tasks = globals().get("_reset_mcp_task_store")
    if callable(reset_tasks):
        reset_tasks(WORKSPACE)


def _image_service() -> AgentImageService:
    global AGENT_IMAGES
    # Re-assert the workspace lock on EVERY request, not just at construction. The service
    # is a process-lived singleton, so without this a phone paired while the workspace was
    # unlocked would keep reading the library after the user enables + locks Workspace Lock.
    # It happens to be covered today because most routes call require_consent() -> _api(),
    # but capabilities() and other non-consent routes do not, and a future route might not
    # either. Enforce it here, at the single choke point, so the guarantee is explicit and
    # does not depend on the consent path.
    _assert_unlocked()
    if AGENT_IMAGES is None:
        AGENT_IMAGES = AgentImageService(
            _api(),
            workspace=WORKSPACE,
            require_consent=_require_mcp_consent,
            validate_path=_assert_allowed_path,
            validate_operator_token=_validate_operator_token,
        )
    return AGENT_IMAGES


def _json(value: Any) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


def _report_paths() -> list[Path]:
    """Return report.md candidates for source, packaged, PyInstaller, and MCPB layouts."""
    candidates: list[Path] = []
    env_report = os.environ.get("VINTRACE_REPORT_PATH") or os.environ.get("CROSSAGE_REPORT_PATH")
    if env_report:
        candidates.append(Path(env_report).expanduser())

    candidates.extend(
        [
            Path(__file__).resolve().parent.parent / "report.md",
            Path.cwd() / "report.md",
        ]
    )

    executable = getattr(sys, "executable", "")
    if executable:
        executable_dir = Path(executable).resolve().parent
        candidates.extend([executable_dir / "report.md", executable_dir.parent / "report.md"])

    pyinstaller_root = getattr(sys, "_MEIPASS", "")
    if pyinstaller_root:
        candidates.append(Path(pyinstaller_root) / "report.md")

    unique: list[Path] = []
    seen: set[str] = set()
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key not in seen:
            unique.append(path)
            seen.add(key)
    return unique


def _state_summary(state: dict[str, Any]) -> dict[str, Any]:
    return {
        "workspace": state["workspace"],
        "workspaceMetadata": state.get("workspaceMetadata", {}),
        "consentOnFile": state["consentOnFile"],
        "consent": state.get("consent", {}),
        "engine": state["engine"],
        "counts": state["counts"],
        "safeMode": state["config"]["safeMode"],
        "safeModeMultimodal": state["config"].get("safeModeMultimodal", False),
        "safeModeZeroAdmittance": state["config"].get("safeModeZeroAdmittance", False),
        "safeModeThreshold": state["config"]["safeModeThreshold"],
        "safeModeProfile": state["config"].get("safeModeProfile", "balanced"),
        "safeModeModel": state.get("safeModeModel", {}),
        "scanTotals": state.get("scanTotals", {}),
    }


PATH_KEYS = {
    "path",
    "paths",
    "workspace",
    "sourcePath",
    "sourceUrl",
    "previewPath",
    "previewUrl",
    "bestRefPath",
    "bestRefUrl",
    "bestRefPreviewPath",
    "bestRefPreviewUrl",
    "mediaSourcePath",
    "mediaSourceUrl",
    "folder",
    "root",
}

HASH_KEYS = {"sourceHash", "sha256", "fileHash", "phash"}


def _redacted_path(value: object, keep_name: bool = True) -> str:
    text = str(value or "")
    if not text:
        return ""
    if not keep_name:
        return "[hidden]"
    try:
        name = Path(text).name or text
    except (OSError, ValueError):
        name = ""
    return f"[hidden]/{name}" if name else "[hidden]"


def _looks_like_path(value: str) -> bool:
    text = value.strip()
    if not text:
        return False
    return (
        text.startswith(("/", "\\\\"))
        or text.startswith(("http://", "https://", "connector://"))
        or (len(text) >= 3 and text[1] == ":" and text[2] in {"/", "\\"})
        or text.startswith("~")
    )


# MCP-04 (embedded-path leak): _looks_like_path/_redacted_path only catch a value
# that IS a path. Biometric paths/filenames also leak *inside* free-text fields —
# e.g. scanHistory errorSamples `f"{name}: {exc}"` where exc embeds an absolute
# path, or audit message/detail. These masks redact absolute paths AND media
# filenames wherever they appear in a string.
_EMBEDDED_PATH_RE = re.compile(r"(?<![A-Za-z0-9:/])(?:[A-Za-z]:[\\/]|\\\\|~?/)[^\s'\"<>|,;]+")
_EMBEDDED_URL_RE = re.compile(r"https?://[^\s'\"<>|,;]+", re.IGNORECASE)
_MEDIA_EXTS = sorted({ext.lstrip(".").lower() for ext in (set(IMAGE_EXTENSIONS) | set(VIDEO_EXTENSIONS)) if ext})
_MEDIA_NAME_RE = re.compile(
    r"[\w\-.]+\.(?:" + "|".join(re.escape(ext) for ext in _MEDIA_EXTS) + r")",
    re.IGNORECASE,
)
_HASH_TOKEN_RE = re.compile(r"\b[0-9a-f]{16,128}\b", re.IGNORECASE)


def _scrub_text(value: str, *, mask_filenames: bool = True) -> str:
    if not value:
        return value
    masked = _EMBEDDED_URL_RE.sub("[hidden]", value)
    masked = _EMBEDDED_PATH_RE.sub("[hidden]", masked)
    masked = _HASH_TOKEN_RE.sub("[hidden]", masked)
    if mask_filenames:
        masked = _MEDIA_NAME_RE.sub("[hidden]", masked)
    return masked


def _agent_safe_value(value: Any, keep_path_names: bool = True) -> Any:
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_text in PATH_KEYS or key_lower.endswith("path") or key_lower.endswith("paths"):
                if isinstance(child, list):
                    result[key_text] = [_redacted_path(item, keep_path_names) for item in child[:20]]
                else:
                    result[key_text] = _redacted_path(child, keep_path_names)
            elif key_text in HASH_KEYS or key_lower.endswith("hash"):
                result[key_text] = "[hidden]"
            else:
                result[key_text] = _agent_safe_value(child, keep_path_names)
        return result
    if isinstance(value, list):
        return [_agent_safe_value(item, keep_path_names) for item in value]
    if isinstance(value, str):
        if value.strip().startswith(("http://", "https://", "connector://")):
            return "[hidden]"
        if not keep_path_names and _looks_like_path(value):
            return _redacted_path(value, keep_name=False)
        # Mask absolute paths embedded mid-string always; mask bare media
        # filenames too when basenames are being hidden (resources).
        return _scrub_text(value, mask_filenames=not keep_path_names)
    return value


# ---------------------------------------------------------------------------
# MCP security boundary (Security audit Phase 2).
# The desktop app's protections (consent, path scope, the workspace lock) live
# in the Electron layer and the human operator. The MCP server reuses the same
# backend, so it must RE-APPLY those gates here rather than assume they carry
# over: a path allow-list, out-of-band consent, redacted biometric-path output,
# and the workspace lock.
# ---------------------------------------------------------------------------

# MCP-04: keys whose values reveal WHERE biometric/source media lives on disk
# (filenames frequently encode names/dates). These are always redacted in
# agent-facing tool output. Export/backup DESTINATION paths the agent itself
# requested (zipPath, jsonPath, target, ...) are intentionally preserved so
# legitimate export/restore workflows still work.
# Full-profile legacy tools may chain an operator-requested export destination
# into a verify/restore tool. Compact image-agent front doors are scrubbed by
# safe_tool before this compatibility allowance and use operation resources.
_PRESERVE_OUTPUT_PATH_KEYS = {
    "zipPath",
    "jsonPath",
    "mdPath",
    "csvPath",
    "ndjsonPath",
    "exportPath",
    "outputPath",
    "backupPath",
    "manifestPath",
    "target",
    "targetPath",
}


def _redact_tool_output(value: Any) -> Any:
    if isinstance(value, CallToolResult):
        # FastMCP permits rich results (text + ImageContent + structuredContent).
        # Keep binary/image blocks intact, scrub any model-visible narration,
        # and apply the same centralized path/hash policy to structured output.
        content = []
        for item in value.content:
            if isinstance(item, TextContent):
                content.append(item.model_copy(update={"text": _scrub_text(item.text, mask_filenames=True)}))
            elif isinstance(item, ResourceLink):
                content.append(item.model_copy(update={
                    "name": _scrub_text(item.name, mask_filenames=True),
                    "title": _scrub_text(item.title or "", mask_filenames=True) or None,
                    "description": _scrub_text(item.description or "", mask_filenames=True) or None,
                }))
            else:
                content.append(item)
        structured = (
            _redact_tool_output(value.structuredContent)
            if isinstance(value.structuredContent, (dict, list))
            else value.structuredContent
        )
        return value.model_copy(update={"content": content, "structuredContent": structured})
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_text == "connectorConfig":
                result[key_text] = {"configured": bool(child)}
            elif key_text in _PRESERVE_OUTPUT_PATH_KEYS:
                result[key_text] = child  # agent-requested destination; preserved.
            elif key_lower.endswith(("path", "paths", "url", "urls")) or key_text in {"workspace", "root"}:
                if isinstance(child, list):
                    result[key_text] = [_redacted_path(item, keep_name=False) for item in child[:50]]
                else:
                    result[key_text] = _redacted_path(child, keep_name=False)
            elif key_text in HASH_KEYS or key_lower.endswith("hash"):
                # MCP-04: image hashes (sourceHash/sha256/phash) are biometric
                # fingerprints — they enable reverse-image-search and cross-
                # workspace linking. _agent_safe_value() (resources) already
                # hid these; tool output must too, or query_candidates leaks
                # them to the agent.
                result[key_text] = "[hidden]"
            else:
                result[key_text] = _redact_tool_output(child)
        return result
    if isinstance(value, list):
        return [_redact_tool_output(item) for item in value]
    # Value-based catch-all: redact any string that looks like an absolute path,
    # wherever it appears (so a path leaking through a non-path key is caught too),
    # AND mask absolute paths / media filenames embedded inside free-text fields
    # (e.g. error or audit messages) — start-anchored matching alone misses those.
    if isinstance(value, str):
        if _looks_like_path(value):
            return _redacted_path(value, keep_name=False)
        return _scrub_text(value, mask_filenames=True)
    return value


def _redacted_exception_message(exc: Exception) -> str:
    message = str(exc) or exc.__class__.__name__
    if _looks_like_path(message):
        return _redacted_path(message, keep_name=False)
    redacted = _scrub_text(message, mask_filenames=True).strip()
    return redacted or exc.__class__.__name__


# ---------------------------------------------------------------------------
# INJ-04: untrusted-content isolation boundary.
# Path/hash redaction hides WHERE media lives; it does not stop ingested text
# (OCR, EXIF/IPTC captions, object-tag labels, filenames, connector content)
# from carrying INSTRUCTIONS aimed at the agent's model. This boundary boxes
# that text as clearly-typed, delimited DATA. It runs AFTER redaction, at every
# agent-facing output boundary (MCP tools, HTTP /v1, and context resources).
# ---------------------------------------------------------------------------
def _untrusted_neutralize_enabled() -> bool:
    # Default off = label-only (box as data, preserve for search fidelity). Set
    # VINTRACE_AGENT_UNTRUSTED_NEUTRALIZE=1 to also strip flagged injection spans.
    return env_flag("AGENT_UNTRUSTED_NEUTRALIZE")


def _emit_untrusted_audit(source: str, summary: dict[str, int], neutralized: bool) -> None:
    # One event per response when injection patterns were seen; counts only, never
    # the raw text. Best-effort: auditing must never break a tool response.
    if not summary:
        return
    try:
        _api().project._append_audit(
            {
                "action": "agent_untrusted_isolation",
                "source": source,
                "flags": dict(summary),
                "neutralized": bool(neutralized),
            }
        )
    except Exception:
        pass


def _isolate_agent_output(value: Any, source: str) -> Any:
    neutralize = _untrusted_neutralize_enabled()
    isolated, summary = agent_untrusted.isolate_untrusted_output(value, neutralize=neutralize)
    _emit_untrusted_audit(source, summary, neutralize)
    return isolated


def _asset_resource_links(envelope: Any, *, limit: int = 50) -> list[ResourceLink]:
    """Per-hit asset resource links so hosts fetch stable-ID detail on demand."""
    data = envelope.get("data") if isinstance(envelope, dict) else None
    items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    links: list[ResourceLink] = []
    seen: set[str] = set()
    for row in items:
        if not isinstance(row, dict):
            continue
        asset_id = str(row.get("assetId", "") or "")
        if not asset_id or asset_id in seen:
            continue
        seen.add(asset_id)
        links.append(
            ResourceLink(
                type="resource_link",
                name=f"Image asset {asset_id[-8:]}",
                uri=f"vintrace://images/assets/{asset_id}",
                mimeType="application/json",
            )
        )
        if len(links) >= limit:
            break
    return links


def _preview_resource_ttl_seconds() -> int:
    try:
        configured = int(str(env_value("MCP_PREVIEW_RESOURCE_TTL_SECONDS") or "60"))
    except (TypeError, ValueError):
        configured = 60
    return min(300, max(5, configured))


def _preview_principal_binding() -> str:
    principal = current_agent_principal()
    if principal is None:
        return "trusted-local-session"
    return f"{principal.auth_type}:{principal.principal_id}"


def _issue_preview_resource_grant(
    asset_id: str,
    *,
    max_dimension: int,
    max_bytes: int,
    now: float | None = None,
) -> dict[str, Any]:
    issued_at = float(time.time() if now is None else now)
    expires_at = issued_at + _preview_resource_ttl_seconds()
    grant_id = secrets.token_urlsafe(24)
    grant = {
        "assetId": str(asset_id),
        "workspace": str(WORKSPACE),
        "principal": _preview_principal_binding(),
        "maxDimension": int(max_dimension),
        "maxBytes": int(max_bytes),
        "expiresAt": expires_at,
    }
    with _PREVIEW_RESOURCE_GRANTS_LOCK:
        expired = [key for key, row in _PREVIEW_RESOURCE_GRANTS.items() if float(row.get("expiresAt", 0)) <= issued_at]
        for key in expired:
            _PREVIEW_RESOURCE_GRANTS.pop(key, None)
        if len(_PREVIEW_RESOURCE_GRANTS) >= _MAX_PREVIEW_RESOURCE_GRANTS:
            oldest = min(_PREVIEW_RESOURCE_GRANTS, key=lambda key: float(_PREVIEW_RESOURCE_GRANTS[key].get("expiresAt", 0)))
            _PREVIEW_RESOURCE_GRANTS.pop(oldest, None)
        _PREVIEW_RESOURCE_GRANTS[grant_id] = grant
    return {
        "uri": f"vintrace://images/previews/{grant_id}",
        "mimeType": "image/jpeg",
        "expiresAt": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def _resolve_preview_resource_grant(grant_id: str, *, now: float | None = None) -> dict[str, Any]:
    checked_at = float(time.time() if now is None else now)
    with _PREVIEW_RESOURCE_GRANTS_LOCK:
        grant = _PREVIEW_RESOURCE_GRANTS.get(str(grant_id))
        if grant is None or float(grant.get("expiresAt", 0)) <= checked_at:
            _PREVIEW_RESOURCE_GRANTS.pop(str(grant_id), None)
            raise ValueError("Preview resource expired or unavailable.")
        if grant.get("principal") != _preview_principal_binding() or grant.get("workspace") != str(WORKSPACE):
            raise ValueError("Preview resource expired or unavailable.")
        return dict(grant)


def _allowed_roots() -> list[Path]:
    # MCP-03: the active workspace is always in-scope; everything else must be an
    # operator-approved root configured via VINTRACE_MCP_ALLOWED_ROOTS
    # (os.pathsep-separated). With none configured, MCP can only touch the
    # workspace — the desktop picks folders via an OS dialog; MCP has no such
    # human gate, so it fails closed.
    roots = [WORKSPACE]
    configured = env_value("MCP_ALLOWED_ROOTS")
    if configured:
        for part in configured.split(os.pathsep):
            part = part.strip()
            if not part:
                continue
            try:
                roots.append(Path(part).expanduser().resolve())
            except (OSError, ValueError):
                continue
    return roots


def _assert_allowed_path(value: str) -> Path:
    # MCP-03 / INJ-02 / INJ-03: confine a client-supplied path to an approved
    # root, with a generic error (no per-path existence oracle).
    try:
        resolved = Path(str(value)).expanduser().resolve()
    except (OSError, ValueError):
        raise ValueError("Invalid path.")
    for root in _allowed_roots():
        try:
            resolved.relative_to(root)
            return resolved
        except ValueError:
            continue
    raise ValueError(
        "Path is outside the approved MCP roots. Set VINTRACE_MCP_ALLOWED_ROOTS to the "
        "directories the operator permits, or operate within the workspace."
    )


def _require_mcp_consent() -> None:
    # INJ-02 / PC-06: decode/processing tools that don't already pass through the
    # consent-gated handle() commands must still require consent on file (which,
    # post-MCP-02, only a human can grant).
    api = _api()
    # The desktop and an MCP/HTTP server are separate processes. Re-read the
    # tiny consent record at the execution boundary so a human grant or
    # revocation takes effect immediately without restarting the agent server.
    api.consent_on_file = api.project.refresh_consent_from_disk()
    if not api.consent_on_file:
        raise ValueError(
            "Consent is required before processing images or videos. A human operator must "
            "enable consent in the Vintrace desktop app (the MCP session cannot grant it)."
        )


def _workspace_lock_enabled() -> bool:
    # MCP-05: a separate MCP process cannot observe the desktop's in-session
    # unlock, so it treats a lock-enabled workspace as locked.
    try:
        lock_path = WORKSPACE / ".vintrace-workspace-lock.json"
        if not lock_path.exists():
            return False
        data = json.loads(lock_path.read_text(encoding="utf-8"))
        return bool(isinstance(data, dict) and data.get("encryptedSecret"))
    except (OSError, json.JSONDecodeError, ValueError):
        return False


def _assert_unlocked() -> None:
    if _workspace_lock_enabled():
        raise ValueError(
            "Workspace Lock is enabled for this workspace; the MCP server cannot verify the "
            "desktop unlock and refuses to read or modify locked biometric data. Turn off "
            "Workspace Lock in the Vintrace desktop app to use MCP."
        )


_READ_ONLY_TOOL_PREFIXES = (
    "get_",
    "list_",
    "query_",
    "read_",
    "analyze_",
    "assess_",
    "probe_",
    "verify_",
    "inspect_",
)
_READ_ONLY_TOOL_NAMES = {
    "workspace_health",
    "database_integrity",
    "duplicate_people",
    "audit_chain_status",
    "retention_policy_report",
    "model_drift_report",
    "reference_gap_report",
    "runtime_self_test",
    "release_readiness",
    "model_integrity",
    "model_distribution_audit",
    "installer_self_diagnostics",
    "public_dataset_catalog",
    "ordered_review_candidates",
    "calibration_summary",
    "accuracy_evaluation",
    "calibration_learning_status",
    "reference_suggestion_status",
    "synthetic_enrollment_screen_status",
    "embedding_adapter_status",
    "privacy_report",
    "scan_job_status",
    "benchmark_history",
}
_DESTRUCTIVE_TOOL_TOKENS = {
    "delete",
    "purge",
    "clear",
    "repair",
    "restore",
    "relink",
    "prune",
    "rollback",
    "optimize",
    "enforce",
    "cancel",
    "block",
}


def _default_tool_annotations(name: str) -> ToolAnnotations:
    read_only = name in _READ_ONLY_TOOL_NAMES or name.startswith(_READ_ONLY_TOOL_PREFIXES)
    destructive = not read_only and any(token in name.split("_") for token in _DESTRUCTIVE_TOOL_TOKENS)
    open_world = "public_dataset" in name or name.startswith("storage_io_benchmark")
    return ToolAnnotations(
        readOnlyHint=read_only,
        destructiveHint=destructive,
        openWorldHint=open_world,
        idempotentHint=True if read_only else False,
    )


class ConfirmationRequired(ValueError):
    def __init__(self, action: str) -> None:
        self.action = str(action or "complete this action").strip()
        super().__init__(f"Set confirm=True to {self.action}.")


class ElicitedActionApproval(BaseModel):
    approved: bool = Field(description="Approve this one Vintrace operation.")


class ElicitedImageAssetChoice(BaseModel):
    selectedAssetId: str = Field(description="The stable Vintrace asset ID selected by the user.")


def _confirmation_result(value: Any) -> bool:
    return bool(
        isinstance(value, dict)
        and isinstance(value.get("error"), dict)
        and str(value["error"].get("code", "") or "") == "confirmation_required"
    )


def _successful_tool_result(value: Any) -> bool:
    return not (isinstance(value, dict) and (value.get("ok") is False or bool(value.get("error"))))


def _delegation_policy_summary() -> dict[str, Any]:
    policy = MCP_DELEGATION_POLICY
    return {
        "mode": policy.mode,
        "minimumConfirmedActions": policy.minimum_confirmed_actions,
        "maximumAffectedAssets": policy.maximum_affected_assets,
        "trustTtlDays": policy.trust_ttl_days,
        "eligibleActions": sorted(policy.allowed_actions),
        "destructiveDelegation": False,
    }


def _form_elicitation_supported(ctx: Context) -> bool:
    params = getattr(ctx.session, "client_params", None)
    capabilities = getattr(params, "capabilities", None)
    elicitation = getattr(capabilities, "elicitation", None)
    return bool(elicitation is not None and getattr(elicitation, "form", None) is not None)


def _current_form_elicitation_supported() -> bool:
    try:
        return _form_elicitation_supported(mcp.get_context())
    except Exception:
        return False


def _audit_confirmation(action: str, **details: Any) -> None:
    try:
        _api().project._append_audit(
            {
                "action": action,
                "principal": _agent_principal_binding(),
                **details,
            }
        )
    except Exception:
        pass


async def _elicit_action_approval(*, tool: str, action: str, lane: str, affected_assets: int) -> str:
    try:
        ctx = mcp.get_context()
    except Exception:
        return "unsupported"
    if not _form_elicitation_supported(ctx):
        return "unsupported"
    if not MCP_ELICITATION_RATE_LIMITER.allow(_agent_principal_binding()):
        await anyio.to_thread.run_sync(
            lambda: _audit_confirmation(
                "mcp_elicitation_rate_limited",
                tool=tool,
                operation=action,
                lane=lane,
            )
        )
        return "rate_limited"
    message = (
        f"Vintrace needs approval to run '{action}' through the {lane} lane. "
        f"This operation can affect {affected_assets} library item(s). Approve this one operation?"
    )
    await anyio.to_thread.run_sync(
        lambda: _audit_confirmation(
            "mcp_elicitation_requested",
            tool=tool,
            operation=action,
            lane=lane,
            affected_assets=affected_assets,
        )
    )
    try:
        result = await ctx.elicit(message=message, schema=ElicitedActionApproval)
    except Exception:
        outcome = "error"
    else:
        outcome = str(result.action or "cancel")
        if outcome == "accept" and result.data is not None and bool(result.data.approved):
            outcome = "approved"
        elif outcome == "accept":
            outcome = "declined"
    await anyio.to_thread.run_sync(
        lambda: _audit_confirmation(
            "mcp_elicitation_resolved",
            tool=tool,
            operation=action,
            lane=lane,
            outcome=outcome,
        )
    )
    return outcome


def safe_tool(*tool_args: Any, **tool_kwargs: Any):
    # MCP-04 / MCP-05: register a tool whose every return value has biometric
    # source paths redacted and which honors the workspace lock — centrally, so
    # no individual tool can forget.
    def decorator(fn):
        registration_kwargs = dict(tool_kwargs)
        result_model = registration_kwargs.pop("result_model", None)
        annotations = registration_kwargs.setdefault("annotations", _default_tool_annotations(fn.__name__))
        signature = inspect.signature(fn)

        @functools.wraps(fn)
        async def wrapper(*call_args: Any, **call_kwargs: Any):
            bound = signature.bind_partial(*call_args, **call_kwargs)
            bound.apply_defaults()
            explicit_confirmation = bool(bound.arguments.get("confirm", False))
            operation = str(bound.arguments.get("action", fn.__name__) or fn.__name__)
            payload = bound.arguments.get("payload")
            payload = payload if isinstance(payload, dict) else {}
            protocol_confirmation = bool(
                explicit_confirmation
                and "confirm" in signature.parameters
                and _current_form_elicitation_supported()
            )
            lane = (
                "destructive"
                if fn.__name__ == "run_destructive_image_action" or bool(annotations.destructiveHint)
                else "write"
            )

            def invoke(*, confirm: bool | None = None):
                invocation = signature.bind_partial(*call_args, **call_kwargs)
                invocation.apply_defaults()
                if confirm is not None and "confirm" in signature.parameters:
                    invocation.arguments["confirm"] = confirm
                _assert_unlocked()
                return fn(*invocation.args, **invocation.kwargs)

            async def invoke_tool(*, confirm: bool | None = None):
                if inspect.iscoroutinefunction(fn):
                    return await invoke(confirm=confirm)
                return await anyio.to_thread.run_sync(lambda: invoke(confirm=confirm))

            def fail(exc: Exception):
                message = _redacted_exception_message(exc)
                if AGENT_IMAGES is not None:
                    AGENT_IMAGES.record_failure(
                        fn.__name__,
                        message,
                        error_code=_agent_http_error_code(message),
                    )
                raise ValueError(message) from None

            def finalize(result: Any):
                if fn.__name__ == "list_image_capabilities" and isinstance(result, dict):
                    data = result.get("data") if isinstance(result.get("data"), dict) else {}
                    result = {**result, "data": {**data, "delegation": _delegation_policy_summary()}}
                if fn.__name__ in IMAGE_AGENT_TOOL_NAMES:
                    result = _agent_safe_value(result, keep_path_names=False)
                return _isolate_agent_output(_redact_tool_output(result), fn.__name__)

            confirmation_error: ConfirmationRequired | None = None
            try:
                result = await invoke_tool(confirm=False if protocol_confirmation else None)
            except ConfirmationRequired as exc:
                confirmation_error = exc
                result = None
                operation = exc.action
            except Exception as exc:
                return fail(exc)

            requires_confirmation = confirmation_error is not None or _confirmation_result(result)
            delegated = False
            elicited = False
            if requires_confirmation and (not explicit_confirmation or protocol_confirmation):
                decision = await anyio.to_thread.run_sync(
                    lambda: MCP_DELEGATION_TRUST.decision(action=operation, payload=payload, lane=lane)
                )
                if fn.__name__ == "run_image_write_action" and decision.allowed:
                    delegated = True
                    await anyio.to_thread.run_sync(
                        lambda: _audit_confirmation(
                            "mcp_action_auto_delegated",
                            tool=fn.__name__,
                            operation=operation,
                            lane=lane,
                            confirmed_count=decision.confirmed_count,
                            affected_assets=decision.affected_assets,
                        )
                    )
                else:
                    outcome = await _elicit_action_approval(
                        tool=fn.__name__,
                        action=operation,
                        lane=lane,
                        affected_assets=decision.affected_assets,
                    )
                    elicited = outcome == "approved"
                if delegated or elicited:
                    try:
                        result = await invoke_tool(confirm=True)
                        confirmation_error = None
                    except Exception as exc:
                        return fail(exc)
                elif confirmation_error is not None:
                    return fail(confirmation_error)

            if isinstance(result, dict) and (delegated or elicited):
                policy = result.get("policy") if isinstance(result.get("policy"), dict) else {}
                result = {
                    **result,
                    "policy": {
                        **policy,
                        "delegation": {
                            "delegated": delegated,
                            "elicited": elicited,
                        },
                    },
                }

            if (
                _successful_tool_result(result)
                and fn.__name__ == "run_image_write_action"
                and not bool(isinstance(result, dict) and result.get("replayed"))
            ):
                if delegated:
                    await anyio.to_thread.run_sync(lambda: MCP_DELEGATION_TRUST.record_delegated(operation))
                elif explicit_confirmation or elicited:
                    await anyio.to_thread.run_sync(lambda: MCP_DELEGATION_TRUST.record_confirmed(operation))

            try:
                return finalize(result)
            except Exception as exc:
                return fail(exc)

        registered = mcp.tool(*tool_args, **registration_kwargs)(wrapper)
        if result_model is not None:
            registered_tool = mcp._tool_manager.get_tool(registration_kwargs.get("name") or fn.__name__)
            if registered_tool is None:
                raise RuntimeError(f"MCP tool registration missing for {fn.__name__}.")
            registered_tool.fn_metadata.output_model = result_model
            registered_tool.fn_metadata.output_schema = result_model.model_json_schema()
            registered_tool.fn_metadata.wrap_output = False
        return registered

    return decorator


def _agent_state() -> dict[str, Any]:
    return _api().state(preview_create_budget=0, candidate_limit=500)


def _call(command: str, params: dict[str, Any] | None = None, progress: Any | None = None) -> Any:
    return _api().handle(command, params or {}, progress=progress)


def _confirmed(value: bool, action: str) -> None:
    if not value:
        raise ConfirmationRequired(action)


def _progress_reporter(ctx: Context):
    def progress(payload: dict[str, Any]) -> None:
        total = max(int(payload.get("total") or 0), 1)
        processed = int(payload.get("processed") or 0)
        phase = str(payload.get("phase", "scanning")).replace("_", " ")
        current_path = str(payload.get("current_path", ""))
        current_name = _scrub_text(Path(current_path).name, mask_filenames=True) if current_path else ""
        message = f"{phase}: {current_name}" if current_name else phase
        anyio.from_thread.run(lambda: ctx.report_progress(float(processed), float(total), message=message))

    return progress


@mcp.resource("vintrace://state", mime_type="application/json")
@mcp.resource("crossage://state", mime_type="application/json")
def state_resource() -> str:
    """Redacted project state for agent context, including counts, config, references, and candidates."""
    # MCP-04 (resources): hide basenames too — filenames frequently encode names/dates.
    return _json(_isolate_agent_output(_agent_safe_value(_agent_state(), keep_path_names=False), "resource:state"))


@mcp.resource("vintrace://summary", mime_type="application/json")
@mcp.resource("crossage://summary", mime_type="application/json")
def summary_resource() -> str:
    """Compact project summary for deciding which MCP tools to call next."""
    return _json(_isolate_agent_output(_agent_safe_value(_state_summary(_agent_state()), keep_path_names=False), "resource:summary"))


@mcp.resource("vintrace://references", mime_type="application/json")
@mcp.resource("crossage://references", mime_type="application/json")
def references_resource() -> str:
    """Enrolled reference faces grouped by person and age bucket, with local paths hidden."""
    state = _agent_state()
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for ref in state["references"]:
        grouped.setdefault(ref["personName"], {}).setdefault(ref["ageBucket"], []).append(ref)
    return _json(_isolate_agent_output(_agent_safe_value(grouped, keep_path_names=False), "resource:references"))


@mcp.resource("vintrace://candidates", mime_type="application/json")
@mcp.resource("crossage://candidates", mime_type="application/json")
def candidates_resource() -> str:
    """Current review candidates with statuses and scores, with local paths and hashes hidden."""
    return _json(_isolate_agent_output(_agent_safe_value(_agent_state()["candidates"], keep_path_names=False), "resource:candidates"))


@mcp.resource("vintrace://config", mime_type="application/json")
@mcp.resource("crossage://config", mime_type="application/json")
def config_resource() -> str:
    """Runtime thresholds, clustering settings, Safe Mode, and consent policy."""
    return _json(_agent_safe_value(_agent_state()["config"], keep_path_names=False))


@mcp.resource("vintrace://audit", mime_type="application/jsonl")
@mcp.resource("crossage://audit", mime_type="application/jsonl")
def audit_resource() -> str:
    """Recent audit log events with local paths hidden. Use read_audit_events for pagination."""
    return "\n".join(json.dumps(_agent_safe_value(row, keep_path_names=False), ensure_ascii=False) for row in _api().project.audit_events(limit=200)["events"])


@mcp.resource("vintrace://agent-guide", mime_type="text/markdown")
@mcp.resource("crossage://agent-guide", mime_type="text/markdown")
def agent_guide_resource() -> str:
    """Agent operating guide for image discovery, pixels, writes, and human authority."""
    return (
        "# Vintrace Agent Guide\n\n"
        "Vintrace is a local-first image and video platform. Use the smallest disclosure and smallest mutation that completes the task.\n\n"
        "## Default workflow\n\n"
        "1. Read `vintrace://images/capabilities` or call `list_image_capabilities` before using a long-tail action.\n"
        "2. Call `get_image_library_overview` to learn library size, collections, index readiness, and active jobs.\n"
        "3. For external media, call `list_inbound_visual_sources`, then `discover_inbound_visuals` for bounded metadata. Import only a human-reviewed selection with explicit download consent, confirmation, and idempotency; agents cannot configure credentials.\n"
        "4. Call `search_images`; start with `hybrid`, add exact filters, and retain stable `assetId` values. Search returns no pixels or source paths.\n"
        "5. Call `fetch_image_assets` only for the shortlisted IDs whose metadata you need.\n"
        "6. Call `analyze_image_assets` to read existing local OCR, objects, barcodes, quality, people, album, and edit intelligence without disclosing pixels. Queue only the missing indexes reported by the tool.\n"
        "7. Call `get_image_preview` only for individual assets where seeing pixels is necessary. Preview access is bounded, audited, and refused for protected media.\n"
        "8. Call `plan_image_action` before every long-tail mutation. Show the human the action, affected count, warnings, and required lane.\n"
        "9. Use `run_image_write_action` for non-destructive writes or `run_destructive_image_action` for destructive work. A form-capable host can render the confirmation through MCP elicitation; otherwise pass `confirm=true`. Every mutation needs a unique idempotency key.\n"
        "10. Poll asynchronous work with `get_image_job`; use `list_image_operations` for one feed across inbound import, indexing, export, repair, and agent writes. Read its manifest/output resources instead of inventing file paths.\n"
        "11. Discover built-in and custom multi-step workflows with `list_image_recipes`. `plan_image_recipe` binds typed inputs but never executes steps; call each named tool and honor every declared approval point.\n"
        "12. Read `vintrace://agent/activity` or subscribe to authenticated `/v1/events` when an operator needs a live approval/failure timeline. Do not repeat a start action merely because a client timed out.\n\n"
        "## Human-authority boundaries\n\n"
        "- An agent cannot grant consent on its own. `mark_consent` requires explicit confirmation and the operator token.\n"
        "- Keep Safe Mode enabled. Do not infer, expose, or route around protected pixels.\n"
        "- Do not claim autonomous identification. Face matches and pet/person assignments remain reviewable evidence, not identity facts.\n"
        "- Use `review_candidate` only after the human makes or explicitly delegates a review decision.\n"
        "- Sensitive overrides and audit deletion require a separate operator token. Destructive, identity, consent, and sensitive actions never use progressive delegation.\n"
        "- Never invent paths. Imports and exports must remain inside operator-approved roots.\n\n"
        "## Scale and reliability\n\n"
        "- Page results and narrow filters instead of requesting the whole library. Hybrid ranking is intentionally bounded to its advertised candidate cap.\n"
        "- Use batch metadata tools for reviewed sets; capability limits are hard ceilings, not target batch sizes.\n"
        "- Reuse an idempotency key only for an identical write payload. A changed payload needs a new key.\n"
        "- Preserve `requestId`, job IDs, warnings, policy, and provenance in downstream logs or reports.\n"
    )


@mcp.resource("vintrace://report", mime_type="text/markdown")
@mcp.resource("crossage://report", mime_type="text/markdown")
def report_resource() -> str:
    """The source report that drove the app implementation."""
    for report in _report_paths():
        if report.exists() and report.is_file():
            return report.read_text(encoding="utf-8")
    return "report.md is not available in this installation."


@mcp.resource("vintrace://images/capabilities", mime_type="application/json")
def image_capabilities_resource() -> str:
    """Live agent image action catalog, policies, categories, and service limits."""
    return _json(_redact_tool_output(_image_service().capabilities()))


@mcp.resource("vintrace://images/library", mime_type="application/json")
def image_library_resource() -> str:
    """Compact image-library counts, collections, index jobs, export jobs, and settings."""
    return _json(_redact_tool_output(_image_service().library_overview(include_health=False)))


@mcp.resource("vintrace://images/inbound-sources", mime_type="application/json")
def inbound_visual_sources_resource() -> str:
    """Authorized inbound visual sources, safety policy, and recent connector jobs; no credentials."""
    return _json(_redact_tool_output(_image_service().run(action="inbound_connector_catalog", payload={}, lane="read")))


@mcp.resource("vintrace://images/assets/{asset_id}", mime_type="application/json")
def image_asset_resource(asset_id: str) -> str:
    """Structured metadata for one stable image asset ID; source paths remain hidden."""
    return _json(_redact_tool_output(_image_service().fetch_assets([asset_id])))


@mcp.resource("vintrace://images/previews/{grant_id}", mime_type="image/jpeg")
def image_preview_resource(grant_id: str) -> bytes:
    """Read one short-lived, principal-bound, policy-approved preview grant."""
    _assert_unlocked()
    grant = _resolve_preview_resource_grant(grant_id)
    preview = _image_service().preview(
        str(grant["assetId"]),
        max_dimension=int(grant["maxDimension"]),
        max_bytes=int(grant["maxBytes"]),
    )
    data = preview.get("data")
    if not isinstance(data, bytes) or len(data) > int(grant["maxBytes"]):
        raise ValueError("Preview resource expired or unavailable.")
    return data


@mcp.resource("vintrace://images/jobs/{job_type}/{job_id}", mime_type="application/json")
def image_job_resource(job_type: str, job_id: str) -> str:
    """Normalized scan, indexing, export, or inbound job state."""
    return _json(_redact_tool_output(_image_service().job(job_type, job_id)))


@mcp.resource("vintrace://agent/activity", mime_type="application/json")
def agent_activity_resource() -> str:
    """Recent path-free agent requests, approvals, failures, and pixel disclosures."""
    return _json(_redact_tool_output(_image_service().activity(limit=100)))


@mcp.resource("vintrace://agent/operations/{operation_id}", mime_type="application/json")
def image_operation_resource(operation_id: str) -> str:
    """One unified import, indexing, export, repair, library, or agent-write operation."""
    return _json(_redact_tool_output(_image_service().operation(operation_id)))


@mcp.resource("vintrace://agent/manifests/{operation_id}", mime_type="application/json")
def image_output_manifest_resource(operation_id: str) -> str:
    """Path-free output manifest and stable generated-output resource links."""
    return _json(_redact_tool_output(_image_service().operation_manifest(operation_id)))


@mcp.resource("vintrace://agent/outputs/{operation_id}/{output_id}", mime_type="application/octet-stream")
def image_output_resource(operation_id: str, output_id: str) -> bytes:
    """Read one bounded generated output by opaque operation/output IDs."""
    _assert_unlocked()
    return _image_service().operation_output(operation_id, output_id)["data"]


@mcp.resource("vintrace://agent/recipes", mime_type="application/json")
def image_recipes_resource() -> str:
    """Saved reusable image workflow recipes for the active workspace."""
    return _json(_redact_tool_output(_image_service().recipes(include_steps=False)))


@mcp.resource("vintrace://agent/recipes/{recipe_id}", mime_type="application/json")
def image_recipe_resource(recipe_id: str) -> str:
    """One saved image workflow recipe and its variable contract."""
    return _json(_redact_tool_output(_image_service().recipe(recipe_id)))


@mcp.resource(
    IMAGE_REVIEW_RESOURCE_URI,
    name="vintrace-image-review",
    title="Vintrace image selection and review",
    description="Interactive path-free review of bounded search results with approval-gated previews.",
    mime_type=MCP_APP_MIME_TYPE,
    meta={
        "ui": {
            "prefersBorder": True,
            "csp": {"connectDomains": [], "resourceDomains": [], "frameDomains": []},
        }
    },
)
def image_review_app_resource() -> str:
    """Versioned MCP App HTML for bounded search/selection review."""
    return IMAGE_REVIEW_HTML


@safe_tool(
    title="List image capabilities",
    description=(
        "Use this as the sole source for Vintrace image action counts, category counts, policy, and live batch/fetch "
        "limits. Keep include_actions=false for the compact summary (the default). Set it true only when you must "
        "browse unknown long-tail action schemas. Do not call it before a common action already named by "
        "plan_image_action, including dry-run catalog cleanup."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def list_image_capabilities(category: ImageCapabilityCategory = "", include_actions: bool = False) -> dict[str, Any]:
    """Return the live image action catalog and policy metadata."""
    return _image_service().capabilities(category=category, include_actions=include_actions)


@safe_tool(
    title="Get image library overview",
    description=(
        "Use this for library asset/media counts, collections, indexing/export readiness, settings, or optional "
        "backup and repair context. Its response already contains bounded current indexing and export job summaries; "
        "do not poll those job types again unless the user asks for one job's details. It does not report action/tool "
        "counts or batch/fetch limits; use list_image_capabilities for those."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def get_image_library_overview(include_health: bool = False) -> dict[str, Any]:
    """Return a compact, path-redacted image-library summary."""
    return _image_service().library_overview(include_health=include_health)


@safe_tool(
    title="List inbound visual sources",
    description="List operator-authorized Slack, web, cloud-drive, Dropbox, and WebDAV image sources plus their discovery/import policy. This is local catalog access and never returns credentials.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def list_inbound_visual_sources(provider: InboundProvider | None = None) -> dict[str, Any]:
    """List authorized inbound sources without contacting their providers."""
    action = "list_inbound_connector_sources" if provider else "inbound_connector_catalog"
    payload = {"provider": provider} if provider else {}
    return _image_service().run(action=action, payload=payload, lane="read")


@safe_tool(
    title="Discover inbound visuals",
    description="Fetch bounded metadata from one already-authorized inbound source. Discovery contacts the provider but does not download image pixels into Vintrace.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True, idempotentHint=True),
)
def discover_inbound_visuals(
    provider: InboundProvider,
    connection_id: str,
    item_limit: int = 1000,
    sample_limit: int = 40,
) -> dict[str, Any]:
    """Discover remote visual metadata through an operator-authorized connector."""
    return _image_service().run(
        action="preview_inbound_connector",
        payload={
            "provider": provider,
            "connectionId": connection_id,
            "itemLimit": max(1, min(10_000, int(item_limit))),
            "sampleLimit": max(0, min(100, int(sample_limit))),
            "timeBudgetMs": 2_000,
        },
        lane="read",
    )


@safe_tool(
    title="Import inbound visuals",
    description="Import a reviewed remote selection into managed Vintrace storage, preserving provenance and assigning stable asset IDs. Requires explicit external-download consent, confirmation, and a unique idempotency key.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True, idempotentHint=True),
)
def import_inbound_visuals(
    provider: InboundProvider,
    connection_id: str,
    external_ids: list[str] | None = None,
    external_download_consent: bool = False,
    confirm: bool = False,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Start one consent-gated managed import from an authorized inbound source."""
    payload: dict[str, Any] = {
        "provider": provider,
        "connectionId": connection_id,
        "explicitExternalDownloadConsent": bool(external_download_consent),
        "storageMode": "managed",
    }
    if external_ids:
        payload["externalIds"] = external_ids
    return _image_service().run(
        action="import_inbound_connector",
        payload=payload,
        lane="write",
        confirm=confirm,
        idempotency_key=idempotency_key,
    )


@safe_tool(
    title="Sync inbound visuals",
    description="Incrementally discover and import changed media from one authorized source into managed Vintrace storage. Requires explicit external-download consent, confirmation, and a unique idempotency key.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True, idempotentHint=True),
)
def sync_inbound_visuals(
    provider: InboundProvider,
    connection_id: str,
    external_download_consent: bool = False,
    confirm: bool = False,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Start one consent-gated incremental sync from an authorized inbound source."""
    return _image_service().run(
        action="sync_inbound_connector",
        payload={
            "provider": provider,
            "connectionId": connection_id,
            "explicitExternalDownloadConsent": bool(external_download_consent),
            "storageMode": "managed",
        },
        lane="write",
        confirm=confirm,
        idempotency_key=idempotency_key,
    )


@safe_tool(
    title="Search images",
    description=(
        "Find images or videos by meaning, text, exact typed filters, date, person, place, media type, quality, "
        "album, or visibility. Search returns stable IDs and no pixels. One bounded response is complete; do not "
        "repeat identical calls. If it contains items matching the request, use those stable IDs and do not "
        "reformulate or broaden merely to seek more. Use scope='all' unless you already have a Vintrace folder ID; "
        "'library' aliases to all."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
    structured_output=False,
    result_model=AgentToolEnvelope,
    meta={
        "ui": {"resourceUri": IMAGE_REVIEW_RESOURCE_URI, "visibility": ["model", "app"]},
        "openai/outputTemplate": IMAGE_REVIEW_RESOURCE_URI,
        "openai/toolInvocation/invoking": "Searching the private image library…",
        "openai/toolInvocation/invoked": "Image shortlist ready for review",
    },
)
def search_images(
    query: str = "",
    mode: Literal["lexical", "semantic", "hybrid"] = "hybrid",
    scope: str = "all",
    filters: ImageSearchFilters | None = None,
    sort: Literal["newest", "oldest", "scanDate", "title", "filename", "mediaKind"] = "newest",
    offset: int = 0,
    limit: int = 50,
) -> CallToolResult:
    """Search the local library without generating previews."""
    normalized_filters = dict(filters or {})
    if "favorite" in normalized_filters and "favoriteOnly" not in normalized_filters:
        normalized_filters["favoriteOnly"] = bool(normalized_filters.pop("favorite"))
    if "media_type" in normalized_filters and "mediaKind" not in normalized_filters:
        normalized_filters["mediaKind"] = str(normalized_filters.pop("media_type") or "")
    if "mediaType" in normalized_filters and "mediaKind" not in normalized_filters:
        normalized_filters["mediaKind"] = str(normalized_filters.pop("mediaType") or "")
    query_terms = [str(query or "").strip()]
    for alias in ("tags", "keywords"):
        values = normalized_filters.pop(alias, [])
        if isinstance(values, list):
            query_terms.extend(str(value or "").strip() for value in values)
    object_values = normalized_filters.pop("objects", [])
    if isinstance(object_values, list):
        query_terms.extend(str(value or "").strip() for value in object_values)
    metadata_values = normalized_filters.pop("metadata", {})
    if isinstance(metadata_values, dict):
        query_terms.extend(str(value or "").strip() for value in metadata_values.values())
    for alias in ("category", "color", "dominantColor", "object"):
        query_terms.append(str(normalized_filters.pop(alias, "") or "").strip())
    keyword_value = str(normalized_filters.get("keyword", "") or "").strip()
    if " " in keyword_value:
        query_terms.append(keyword_value)
        normalized_filters.pop("keyword", None)
    normalized_query = " ".join(dict.fromkeys(term for term in query_terms if term))
    envelope = _image_service().search(
        query=normalized_query,
        mode=mode,
        scope=scope,
        filters=normalized_filters,
        sort=sort,
        offset=offset,
        limit=limit,
    )
    content: list[Any] = [
        TextContent(type="text", text="Image shortlist; fetch a stable-ID asset resource for full detail."),
    ]
    content.extend(_asset_resource_links(envelope))
    return CallToolResult(content=content, structuredContent=envelope)


@safe_tool(
    title="Fetch image assets",
    description="Use this when you have stable asset IDs and need structured metadata, people, album membership, dimensions, dates, or edit context without disclosing pixels or source paths.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def fetch_image_assets(asset_ids: list[str]) -> dict[str, Any]:
    """Fetch structured context for up to 100 stable asset IDs."""
    return _image_service().fetch_assets(asset_ids)


@safe_tool(
    title="Choose an image asset",
    description="Use this when a human must disambiguate a bounded stable-ID choice such as a duplicate keeper, album/slideshow cover, video poster, or reviewed selection. Form-capable hosts render the choice through MCP elicitation; older hosts can pass selected_asset_id explicitly.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
async def elicit_image_asset_choice(
    candidate_asset_ids: list[str],
    purpose: ImageChoicePurpose,
    ctx: Context,
    selected_asset_id: str = "",
) -> dict[str, Any]:
    """Resolve one bounded image choice without performing a mutation."""
    asset_ids = list(dict.fromkeys(str(value or "").strip() for value in candidate_asset_ids if str(value or "").strip()))
    if not 2 <= len(asset_ids) <= 12:
        raise ValueError("Image disambiguation requires between 2 and 12 candidate asset IDs.")
    fetched = _image_service().fetch_assets(asset_ids)
    data = fetched.get("data") if isinstance(fetched.get("data"), dict) else {}
    rows = data.get("items") if isinstance(data.get("items"), list) else []
    found_ids = {str(row.get("assetId", "") or "") for row in rows if isinstance(row, dict)}
    if found_ids != set(asset_ids):
        raise ValueError("Every image choice candidate must be an existing stable asset ID.")

    selected = str(selected_asset_id or "").strip()
    method = "explicit"
    if _form_elicitation_supported(ctx):
        if not MCP_ELICITATION_RATE_LIMITER.allow(_agent_principal_binding()):
            _audit_confirmation(
                "mcp_elicitation_rate_limited",
                tool="elicit_image_asset_choice",
                operation=purpose,
                lane="choice",
            )
            return {"ok": False, "error": {"code": "elicitation_rate_limited"}, "candidateAssetIds": asset_ids}
        _audit_confirmation(
            "mcp_elicitation_requested",
            tool="elicit_image_asset_choice",
            operation=purpose,
            lane="choice",
            affected_assets=len(asset_ids),
        )
        message = (
            f"Choose one Vintrace asset ID for {purpose.replace('_', ' ')}. "
            f"Allowed stable IDs: {', '.join(asset_ids)}."
        )
        try:
            elicited = await ctx.elicit(message=message, schema=ElicitedImageAssetChoice)
        except Exception:
            outcome = "error"
        else:
            outcome = str(elicited.action or "cancel")
            if outcome == "accept" and elicited.data is not None:
                selected = str(elicited.data.selectedAssetId or "").strip()
                outcome = "selected" if selected in found_ids else "invalid_selection"
        _audit_confirmation(
            "mcp_elicitation_resolved",
            tool="elicit_image_asset_choice",
            operation=purpose,
            lane="choice",
            outcome=outcome,
        )
        method = "elicitation"
        if outcome != "selected":
            return {
                "ok": False,
                "error": {"code": f"choice_{outcome}"},
                "candidateAssetIds": asset_ids,
            }
    elif not selected:
        return {
            "ok": False,
            "error": {
                "code": "elicitation_or_selection_required",
                "message": "This host does not support form elicitation; pass selected_asset_id explicitly.",
            },
            "candidateAssetIds": asset_ids,
        }
    if selected not in found_ids:
        raise ValueError("selected_asset_id must be one of the candidate asset IDs.")
    return {
        "ok": True,
        "purpose": purpose,
        "selectedAssetId": selected,
        "candidateAssetIds": asset_ids,
        "method": method,
    }


@safe_tool(
    title="Analyze image assets",
    description=(
        "Read existing local text/OCR, objects, barcodes, quality, people, albums, metadata, and edits for up to "
        "100 stable IDs without pixels. Call once per batch: data.pendingCapabilities is the complete union of "
        "missing indexes, so do not repeat the search or analysis before planning those index actions."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def analyze_image_assets(
    asset_ids: list[str],
    capabilities: list[ImageIntelligenceCapability] | None = None,
) -> dict[str, Any]:
    """Read existing on-device image intelligence for up to 100 stable asset IDs."""
    return _image_service().analyze_assets(asset_ids, capabilities)


@safe_tool(
    title="Get image preview",
    description="Use this only after search/fetch when the task requires seeing one selected asset. Returns one bounded multimodal preview by stable asset ID and refuses Safe Mode-protected media.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
    meta={
        "ui": {"visibility": ["model", "app"]},
        "openai/widgetAccessible": True,
        "openai/toolInvocation/invoking": "Requesting a policy-approved preview…",
        "openai/toolInvocation/invoked": "Preview ready",
    },
    structured_output=False,
    result_model=AgentToolEnvelope,
)
def get_image_preview(
    asset_id: str,
    max_dimension: int = 1536,
    max_bytes: int = 4 * 1024 * 1024,
) -> CallToolResult:
    """Return a short-lived resource link for one policy-approved JPEG preview."""
    service = _image_service()
    preview = service.preview(asset_id, max_dimension=max_dimension, max_bytes=max_bytes)
    metadata = {key: value for key, value in preview.items() if key != "data"}
    resource = _issue_preview_resource_grant(
        str(metadata["assetId"]),
        max_dimension=max_dimension,
        max_bytes=max_bytes,
    )
    metadata["resource"] = resource
    envelope = service._envelope(
        "get_image_preview",
        metadata,
        pixel_disclosure=True,
    )
    return CallToolResult(
        content=[
            TextContent(
                type="text",
                text=(
                    f"Policy-approved preview for asset {metadata['assetId']} "
                    f"({metadata['width']}×{metadata['height']}, {metadata['bytes']} bytes)."
                ),
            ),
            ResourceLink(
                type="resource_link",
                name=f"Policy-approved preview {str(metadata['assetId'])[-8:]}",
                uri=str(resource["uri"]),
                mimeType="image/jpeg",
                size=int(metadata["bytes"]),
            ),
        ],
        structuredContent=envelope,
    )


@safe_tool(
    title="Plan image action",
    description=(
        "Validate a long-tail image action and learn its execution lane without running it. Common exact names: "
        "update_photo_asset_metadata (title/caption/favorite), save_photo_album (create/update an album), "
        "export_photo_contact_sheet, enqueue_photo_indexing_job, and photo_library_catalog_cleanup. Safe aliases "
        "create_manual_album and create_contact_sheet are accepted. If still unknown, request only the relevant "
        "category from list_image_capabilities with include_actions=true. For missing intelligence, pass "
        "enqueue_photo_indexing_job a capabilities list to receive separate plan-only batchPlans in one call."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def plan_image_action(action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Validate and explain an image action without executing it."""
    return _image_service().plan(action, payload)


@safe_tool(
    title="Run read-only image action",
    description="Use this for a read-only long-tail action discovered in list_image_capabilities. The server rejects every action classified as a write or destructive operation.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def run_image_read_action(action: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    """Execute one cataloged read-only image action."""
    return _image_service().run(action=action, payload=payload, lane="read")


@safe_tool(
    title="Run image write action",
    description="Use this after plan_image_action for a non-destructive image-library write. A form-capable host can elicit one-operation approval; otherwise confirm=true is required. Operator-enabled progressive delegation is limited to published reversible curation actions. A unique idempotency key is always required; destructive actions are rejected.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True, idempotentHint=True),
)
def run_image_write_action(
    action: str,
    payload: dict[str, Any] | None = None,
    confirm: bool = False,
    idempotency_key: str = "",
    operator_token: str = "",
) -> dict[str, Any]:
    """Execute one approved non-destructive image write exactly once per idempotency key."""
    return _image_service().run(
        action=action,
        payload=payload,
        lane="write",
        confirm=confirm,
        idempotency_key=idempotency_key,
        operator_token=operator_token,
    )


@safe_tool(
    title="Run destructive image action",
    description="Use this only after a human approves a plan that can delete, merge, overwrite, remove, restore, relink, or cancel image state. A form-capable host can elicit approval; otherwise confirm=true is required. Destructive actions never use progressive delegation and always require a unique idempotency key.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False, idempotentHint=True),
)
def run_destructive_image_action(
    action: str,
    payload: dict[str, Any] | None = None,
    confirm: bool = False,
    idempotency_key: str = "",
    operator_token: str = "",
) -> dict[str, Any]:
    """Execute one human-approved destructive image action exactly once per idempotency key."""
    return _image_service().run(
        action=action,
        payload=payload,
        lane="destructive",
        confirm=confirm,
        idempotency_key=idempotency_key,
        operator_token=operator_token,
    )


@safe_tool(
    title="Get image job",
    description=(
        "Use this to poll normalized scan, image-indexing, export, or inbound-connector job state after a tool returns "
        "a job ID, or when the user explicitly requests detailed recent jobs. Do not call it after "
        "get_image_library_overview merely to repeat the indexing/export summaries already returned there."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def get_image_job(job_type: Literal["scan", "indexing", "export", "inbound"], job_id: str = "") -> dict[str, Any]:
    """Return normalized image or inbound job progress or recent jobs."""
    return _image_service().job(job_type, job_id)


@safe_tool(
    title="Get agent activity",
    description=(
        "Use this only for recent image-agent request audit, approval outcomes, failures, retries/replays, and pixel "
        "disclosures. It is not an operation feed; use list_image_operations for durable imports, indexing, exports, "
        "repairs, library changes, and agent writes."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def get_agent_activity(
    action: str = "",
    status: str = "",
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    """Return the recent agent activity and approval dashboard."""
    return _image_service().activity(action=action, status=status, offset=offset, limit=limit)


@safe_tool(
    title="List image operations",
    description=(
        "Use this as the sole unified durable operation feed across imports, indexing, exports, repairs, reversible "
        "library changes, and idempotent agent writes; do not call get_agent_activity for these. Apply all requested "
        "kinds in one call. Contact sheets executed through run_image_write_action have kind agent-write even though "
        "their action is export_photo_contact_sheet. A bounded filtered result is complete; do not retry unfiltered."
    ),
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def list_image_operations(
    kinds: list[ImageOperationKind] | None = None,
    status: str = "",
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    """List unified asynchronous and durable image operations."""
    return _image_service().operations(kinds=kinds, status=status, offset=offset, limit=limit)


@safe_tool(
    title="Get image operation",
    description="Use this to inspect one unified image operation, its progress/result, a path-free output manifest, and bounded resource links for generated files.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
    structured_output=False,
    result_model=AgentToolEnvelope,
)
def get_image_operation(operation_id: str) -> CallToolResult:
    """Return one operation plus MCP resource links for its manifest and outputs."""
    envelope = _image_service().operation(operation_id)
    links = envelope.get("data", {}).get("resourceLinks", []) if isinstance(envelope.get("data"), dict) else []
    content: list[Any] = [
        TextContent(type="text", text=f"Operation {operation_id} and its path-free output manifest."),
    ]
    for link in links[:51]:
        if not isinstance(link, dict) or not str(link.get("uri", "") or ""):
            continue
        content.append(
            ResourceLink(
                type="resource_link",
                name=str(link.get("name", "Generated image output") or "Generated image output")[:160],
                uri=str(link["uri"]),
                mimeType=str(link.get("mimeType", "application/octet-stream") or "application/octet-stream"),
                size=int(link.get("size", 0) or 0) or None,
            )
        )
    return CallToolResult(content=content, structuredContent=envelope)


@safe_tool(
    title="List image recipes",
    description="Use this to discover built-in and custom multi-step image workflows, typed inputs, and explicit approval points without loading every step by default.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def list_image_recipes(include_steps: bool = False) -> dict[str, Any]:
    """List saved reusable image workflow recipes."""
    return _image_service().recipes(include_steps=include_steps)


@safe_tool(
    title="Get image recipe",
    description="Use this to inspect one complete plan-only workflow recipe, including its typed input schema, ordered tool calls, data dependencies, and approval points.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def get_image_recipe(recipe_id: str) -> dict[str, Any]:
    """Return one saved image recipe."""
    return _image_service().recipe(recipe_id)


@safe_tool(
    title="Plan image recipe",
    description="Use this to bind typed inputs into a recipe and return its ordered, approval-aware tool plan. Planning never executes any step.",
    annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def plan_image_recipe(recipe_id: str, inputs: dict[str, Any] | None = None) -> dict[str, Any]:
    """Resolve and validate a saved image recipe without executing it."""
    return _image_service().plan_recipe(recipe_id, inputs)


@safe_tool(
    title="Save image recipe",
    description="Use this to create or revise an allowlisted multi-step workflow recipe. The metadata write requires confirm=true and an idempotency key; saving never runs the recipe.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False, idempotentHint=True),
)
def save_image_recipe(
    recipe_id: str,
    recipe: dict[str, Any],
    confirm: bool = False,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Persist one confirmed, retry-safe image workflow recipe."""
    return _image_service().save_recipe(
        recipe_id=recipe_id,
        recipe=recipe,
        confirm=confirm,
        idempotency_key=idempotency_key,
    )


@safe_tool(
    title="Delete image recipe",
    description="Use this to remove one saved image workflow recipe. This is destructive metadata work and requires confirm=true plus a unique idempotency key.",
    annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=True, openWorldHint=False, idempotentHint=True),
)
def delete_image_recipe(
    recipe_id: str,
    confirm: bool = False,
    idempotency_key: str = "",
) -> dict[str, Any]:
    """Delete one saved image workflow recipe exactly once per idempotency key."""
    return _image_service().delete_recipe(
        recipe_id,
        confirm=confirm,
        idempotency_key=idempotency_key,
    )


@safe_tool()
def get_project_state() -> dict[str, Any]:
    """Return a compact current state summary for the active workspace."""
    return _state_summary(_agent_state())


@safe_tool()
def set_workspace(path: str) -> dict[str, Any]:
    """Switch the MCP server to a workspace directory (must be within an approved root)."""
    _assert_allowed_path(path)  # MCP-03/PC-04: don't let an agent point at any directory.
    _set_workspace_root(Path(path))
    result = _api().state()
    return _state_summary(result)


def _validate_operator_token(action: str, operator_token: str) -> None:
    # MCP-02: human-only operator actions (granting consent, deleting the audit log) require a
    # one-time token the agent cannot mint, set as VINTRACE_MCP_OPERATOR_TOKEN on the server.
    required = env_value("MCP_OPERATOR_TOKEN")
    if not required:
        raise ValueError(
            f"{action} over MCP requires an operator approval token. Set VINTRACE_MCP_OPERATOR_TOKEN "
            "on the server (and pass it as operator_token), or perform this action in the Vintrace desktop app."
        )
    if operator_token != required:
        raise ValueError(f"Invalid operator approval token; {action.lower()} was refused.")


@safe_tool()
def mark_consent(
    confirmed: bool,
    operator: str = "",
    note: str = "",
    confirm: bool = False,
    operator_token: str = "",
    person_name: str = "",
    lawful_basis: str = "",
    signer_name: str = "",
    signer_role: str = "",
    specific_purpose: str = "",
    collection_term_days: int = 365,
    written_notice_acknowledged: bool = False,
    electronic_signature_accepted: bool = False,
    ai_disclosure_acknowledged: bool = False,
) -> dict[str, Any]:
    """Record consent for processing in this workspace, or for one named subject.

    MCP-02: the agent CANNOT grant consent on its own authority. Granting
    (confirmed=True) requires a one-time operator token the agent cannot mint —
    set VINTRACE_MCP_OPERATOR_TOKEN on the server and pass it as operator_token,
    or grant consent in the Vintrace desktop app. Revoking (confirmed=False)
    needs no token. Pass person_name to record a per-subject consent (with an
    lawful_basis and complete written-release fields) instead of the
    workspace-level consent. ai_disclosure_acknowledged records that the
    operator reviewed the current in-product AI notice.
    """
    _confirmed(confirm, "change consent status")
    if confirmed:
        _validate_operator_token("Granting consent", operator_token)
    release = {
        "signerName": signer_name,
        "signerRole": signer_role,
        "specificPurpose": specific_purpose,
        "collectionTermDays": collection_term_days,
        "lawfulBasis": lawful_basis,
        "writtenNoticeAcknowledged": written_notice_acknowledged,
        "electronicSignatureAccepted": electronic_signature_accepted,
        "aiDisclosureAcknowledged": ai_disclosure_acknowledged,
        "note": note,
    }
    state = _call(
        "set_consent",
        {
            "value": confirmed,
            "source": "mcp",
            "operator": operator,
            "note": note,
            "scope": str(WORKSPACE),
            "personName": person_name,
            "lawfulBasis": lawful_basis,
            "release": release,
        },
    )
    return {**_state_summary(state), "operator": operator, "note": note, "personName": person_name}


@safe_tool()
def enroll_reference_folder(person_name: str, age_bucket: AgeBucket, folder: str) -> dict[str, Any]:
    """Enroll reference images for one person from one folder and one age bucket."""
    _assert_allowed_path(folder)
    result = _call("enroll", {"personName": person_name, "ageBucket": age_bucket, "folder": folder})
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "state": _state_summary(result["state"]),
    }


@safe_tool()
def enroll_age_reference_set(
    person_name: str,
    child_folder: str = "",
    adolescent_folder: str = "",
    adult_folder: str = "",
    unknown_folder: str = "",
) -> dict[str, Any]:
    """Enroll multiple age-bucket reference folders for the same person in one action."""
    for folder in (child_folder, adolescent_folder, adult_folder, unknown_folder):
        if folder:
            _assert_allowed_path(folder)
    groups = [
        {"ageBucket": "child", "folder": child_folder},
        {"ageBucket": "adolescent", "folder": adolescent_folder},
        {"ageBucket": "adult", "folder": adult_folder},
        {"ageBucket": "unknown", "folder": unknown_folder},
    ]
    result = _call("enroll_age_groups", {"personName": person_name, "groups": groups})
    return {
        "added": result.get("added", 0),
        "groups": result.get("value", {}).get("groups", 0),
        "errors": result.get("errors", []),
        "state": _state_summary(result["state"]),
    }


@safe_tool()
def scan_folder(folder: str, ctx: Context) -> dict[str, Any]:
    """Scan an image/video folder and queue matched or clustered review candidates."""
    _assert_allowed_path(folder)
    result = _call("scan", {"folder": folder, "source": "mcp"}, progress=_progress_reporter(ctx))
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "metrics": result.get("metrics", {}),
        "state": _state_summary(result["state"]),
    }


@safe_tool()
def scan_media_paths(paths: list[str], ctx: Context) -> dict[str, Any]:
    """Scan explicit image or video paths and queue matched or clustered review candidates."""
    for media_path in paths:
        _assert_allowed_path(media_path)
    result = _call("scan_paths", {"paths": paths, "source": "mcp"}, progress=_progress_reporter(ctx))
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "metrics": result.get("metrics", {}),
        "state": _state_summary(result["state"]),
    }


@safe_tool()
def cancel_active_scan(confirm: bool = False) -> dict[str, Any]:
    """Request cancellation of the active scan. The current file finishes, then the scan stops with a resumable manifest."""
    _confirmed(confirm, "cancel the active scan")
    return _call("cancel_scan", {"source": "mcp"})


@safe_tool()
def pause_active_scan(confirm: bool = False) -> dict[str, Any]:
    """Pause the active scan between files without losing resumable progress."""
    _confirmed(confirm, "pause the active scan")
    return _call("pause_scan", {"source": "mcp"})


@safe_tool()
def resume_active_scan() -> dict[str, Any]:
    """Resume a paused scan."""
    return _call("resume_scan", {"source": "mcp"})


@safe_tool()
def scan_job_status() -> dict[str, Any]:
    """Read active scan job controls and latest manifest status."""
    return _call("scan_job_status")


@safe_tool()
def scan_image_paths(paths: list[str], ctx: Context) -> dict[str, Any]:
    """Compatibility alias for scan_media_paths; accepts image and video paths."""
    return scan_media_paths(paths, ctx)


@safe_tool()
def analyze_folder(folder: str) -> dict[str, Any]:
    """Preflight a folder before scanning: counts images/videos, samples readability, and returns recommendations."""
    _assert_allowed_path(folder)
    return _agent_safe_value(_call("analyze_folder", {"folder": folder}), keep_path_names=False)


@safe_tool()
def probe_video_file(path: str) -> dict[str, Any]:
    """Probe one video file for decoder support, dimensions, frame count, and duration."""
    _require_mcp_consent()
    resolved = _assert_allowed_path(path)
    extension_ok = resolved.suffix.lower() in VIDEO_EXTENSIONS
    if not extension_ok:
        return {"path": "[hidden]", "extensionOk": False, "readable": False}
    try:
        return _agent_safe_value({"extensionOk": True, **probe_video(resolved)}, keep_path_names=False)
    except Exception as exc:
        return {"path": "[hidden]", "extensionOk": True, "readable": False, "error": str(exc)}


@safe_tool()
def assess_image(path: str) -> dict[str, Any]:
    """Assess one still image for Safe Mode filtering and image-extension eligibility."""
    # INJ-02: confine the path and require consent, so this isn't a filesystem-wide
    # NSFW oracle / un-consented decoder over arbitrary files.
    _require_mcp_consent()
    resolved = _assert_allowed_path(path)
    extension_ok = resolved.suffix.lower() in IMAGE_EXTENSIONS
    if not extension_ok:
        return {"path": "[hidden]", "extensionOk": False, "sensitive": False, "score": 0.0}
    assessment = assess_image_safety(
        resolved,
        _api().project.config.safe_mode_threshold,
        temperature=_api().project.config.safe_mode_temperature,
        multimodal=_api().project.config.safe_mode_multimodal,
    )
    return {
        "path": "[hidden]",
        "extensionOk": True,
        "sensitive": assessment.sensitive,
        "score": assessment.score,
        "reason": assessment.reason,
        "engine": assessment.engine,
        "modelName": assessment.model_name,
        "modelScore": assessment.model_score,
        "heuristicScore": assessment.heuristic_score,
        "labels": assessment.labels,
        "categoryScores": assessment.category_scores,
        "categoryEvidence": assessment.category_evidence,
        "policyVersion": assessment.policy_version,
        "humanReviewRequired": assessment.engine == "multimodal-hybrid",
        "skinRatio": assessment.skin_ratio,
        "lowerSkinRatio": assessment.lower_skin_ratio,
        "largestRegionRatio": assessment.largest_region_ratio,
    }


@safe_tool()
def review_candidate(candidate_id: str, status: ReviewStatus, confirm: bool = False) -> dict[str, Any]:
    """Set a review candidate status after a human review decision."""
    _confirmed(confirm, f"set candidate {candidate_id} to {status}")
    state = _call("set_status", {"candidateId": candidate_id, "status": status})
    return _state_summary(state)


@safe_tool()
def bulk_review_candidates(candidate_ids: list[str], status: ReviewStatus, confirm: bool = False) -> dict[str, Any]:
    """Set the same review status on multiple candidates after human review."""
    _confirmed(confirm, f"set {len(candidate_ids)} candidate(s) to {status}")
    result = _call("bulk_set_status", {"candidateIds": candidate_ids, "status": status})
    return {"updated": result.get("updated", 0), "state": _state_summary(result["state"])}


@safe_tool()
def set_candidate_note(candidate_id: str, note: str) -> dict[str, Any]:
    """Save an operator note on a review candidate."""
    state = _call("set_candidate_note", {"candidateId": candidate_id, "note": note})
    return _state_summary(state)


@safe_tool()
def block_false_match(candidate_id: str, confirm: bool = False) -> dict[str, Any]:
    """Reject and suppress this exact image/person false-match pair in future scans."""
    _confirmed(confirm, f"block repeated false match for {candidate_id}")
    result = _call("block_false_match", {"candidateId": candidate_id})
    return {"blocked": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def reassign_candidate_person(candidate_id: str, person_name: str, confirm: bool = False) -> dict[str, Any]:
    """Move one candidate row to a different person label for identity split/cleanup workflows."""
    _confirmed(confirm, f"move candidate {candidate_id} to {person_name}")
    result = _call("reassign_candidate_person", {"candidateId": candidate_id, "personName": person_name, "clearReference": True})
    return {"reassigned": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def query_candidates(
    status: ReviewStatus | Literal["all"] = "all",
    lane: Literal["all", "high", "lowQuality", "groups", "video", "notes"] = "all",
    query: str = "",
    sort: Literal["score", "newest", "quality", "status"] = "score",
    offset: int = 0,
    limit: int = 100,
) -> dict[str, Any]:
    """Page/search review candidates without loading the whole queue into an agent context."""
    return _call(
        "query_candidates",
        {
            "status": status,
            "lane": lane,
            "query": query,
            "sort": sort,
            "offset": offset,
            "limit": limit,
            "previewBudget": 0,
        },
    )


@safe_tool()
def clear_review_queue(confirm: bool = False) -> dict[str, Any]:
    """Clear all review candidates from the active workspace."""
    _confirmed(confirm, "clear the review queue")
    state = _call("clear_queue")
    return _state_summary(state)


@safe_tool()
def purge_reviewed_candidates(confirm: bool = False) -> dict[str, Any]:
    """Remove accepted, rejected, and uncertain candidates from the active queue while preserving audit records."""
    _confirmed(confirm, "purge reviewed candidates")
    result = _call("purge_candidates", {"statuses": ["accepted", "rejected", "uncertain"]})
    return {"purged": result.get("purged", 0), "state": _state_summary(result["state"])}


@safe_tool()
def workspace_health() -> dict[str, Any]:
    """Audit workspace health: missing files/media sources, duplicate review rows, storage footprint, and cleanup recommendations."""
    return _call("workspace_health")


@safe_tool()
def repair_workspace(confirm: bool = False) -> dict[str, Any]:
    """Preview or repair missing saved-photo and match links. Without confirm=true this returns a dry run only."""
    result = _call("repair_workspace", {"dryRun": not confirm})
    return {"repair": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def database_integrity() -> dict[str, Any]:
    """Run SQLite integrity and foreign-key checks for the active workspace index."""
    return _call("database_integrity")


@safe_tool()
def repair_database_integrity(confirm: bool = False) -> dict[str, Any]:
    """Snapshot and repair the local SQLite index. Without confirm=true this returns a dry run only."""
    result = _call("repair_database_integrity", {"confirm": bool(confirm)})
    return {"repair": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def relink_workspace_paths(old_root: str, new_root: str, confirm: bool = False) -> dict[str, Any]:
    """Relink saved photo/video paths after a library folder has moved. Without confirm=true this returns a dry run only."""
    # MCP-06: confine both ends of the relink to approved roots.
    if old_root:
        _assert_allowed_path(old_root)
    if new_root:
        _assert_allowed_path(new_root)
    result = _call("relink_workspace_paths", {"oldRoot": old_root, "newRoot": new_root, "dryRun": not confirm})
    return {"relink": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def duplicate_people(threshold: float = 0.82, limit: int = 20) -> dict[str, Any]:
    """Find enrolled person labels whose saved reference faces are very similar and may need merging."""
    return _call("duplicate_people", {"threshold": threshold, "limit": limit})


@safe_tool()
def read_audit_events(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Read recent audit events with pagination instead of loading the entire audit log."""
    return _call("audit_events", {"limit": limit, "offset": offset})


@safe_tool()
def list_jurisdictions() -> dict[str, Any]:
    """List the per-jurisdiction consent/retention presets (operator defaults, not legal advice)."""
    return _call("list_jurisdictions")


@safe_tool()
def set_jurisdiction_preset(
    preset: str,
    confirm: bool = False,
    operator_token: str = "",
) -> dict[str, Any]:
    """Apply a per-jurisdiction consent/retention preset (e.g. gdpr, bipa-il, ccpa-cpra, colorado, standard).

    Operator-configurable defaults only — NOT legal advice or certification.
    """
    _confirmed(confirm, "change the workspace jurisdiction and retention policy")
    _validate_operator_token("Changing the jurisdiction preset", operator_token)
    result = _call("set_jurisdiction_preset", {"preset": preset, "confirm": True})
    return {"applied": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_examination_report(person_name: str = "") -> dict[str, Any]:
    """Export a DRAFT court-aware examination report (markdown + JSON) for one person or all
    reviewed candidates: method, model provenance, per-decision cross-age uncertainty, consent
    basis, and the tamper-evident audit reference.

    DRAFT only — an investigative lead record, NOT a positive identification or expert testimony.
    """
    result = _call("export_examination_report", {"personName": person_name})
    return {"report": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def list_workspaces() -> dict[str, Any]:
    """List known Vintrace workspaces (alias, last-opened, which is active) for switching context."""
    return _call("list_workspaces")


@safe_tool()
def export_compliance_pack() -> dict[str, Any]:
    """Export a governance-evidence ZIP: consent + tamper-evident audit + retention + model
    provenance, plus generated DRAFT DPIA/FRIA/Annex-IV documents.

    All generated legal documents are DRAFTs requiring DPO/counsel review — not certification.
    """
    result = _call("export_compliance_pack")
    return {"pack": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def audit_chain_status() -> dict[str, Any]:
    """Verify the tamper-evident SHA-256 hash chain over the audit log.

    Returns verified=true when every chained entry hashes correctly and links to its
    predecessor; otherwise firstBreak identifies the first altered/missing entry. Entries
    that predate chaining are counted as legacy and do not count as breaks.
    """
    return _call("audit_chain_status")


@safe_tool()
def purge_duplicate_candidates(confirm: bool = False) -> dict[str, Any]:
    """Compact duplicate review rows for the same person/media item while preserving the strongest candidate."""
    _confirmed(confirm, "purge duplicate candidate rows")
    result = _call("purge_duplicate_candidates")
    return {"purged": result.get("purged", 0), "health": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def delete_reference(ref_id: str, confirm: bool = False) -> dict[str, Any]:
    """Delete one enrolled reference face by reference id."""
    _confirmed(confirm, f"delete reference {ref_id}")
    state = _call("delete_reference", {"refId": ref_id})
    return _state_summary(state)


@safe_tool()
def delete_person(person_name: str, confirm: bool = False) -> dict[str, Any]:
    """Delete all references and queued candidates for one person while preserving audit records."""
    _confirmed(confirm, f"delete all data for {person_name}")
    result = _call("delete_person", {"personName": person_name})
    return {"deleted": result.get("deleted", {}), "state": _state_summary(result["state"])}


@safe_tool()
def rename_person(old_name: str, new_name: str, confirm: bool = False) -> dict[str, Any]:
    """Rename or merge one person label into another person label, requiring confirm=true."""
    _confirmed(confirm, f"rename or merge {old_name} into {new_name}")
    result = _call("rename_person", {"oldName": old_name, "newName": new_name})
    return {"renamed": result.get("renamed", {}), "state": _state_summary(result["state"])}


@safe_tool()
def clear_references(confirm: bool = False) -> dict[str, Any]:
    """Delete all enrolled references from the active workspace."""
    _confirmed(confirm, "clear all references")
    result = _call("clear_references")
    return {"cleared": result.get("cleared", 0), "state": _state_summary(result["state"])}


@safe_tool()
def purge_old_candidates(days: int = 90, confirm: bool = False) -> dict[str, Any]:
    """Purge reviewed candidates older than the retention window while preserving audit records."""
    _confirmed(confirm, f"purge reviewed candidates older than {days} day(s)")
    result = _call("purge_old_candidates", {"days": days, "statuses": ["accepted", "rejected", "uncertain"]})
    return {"purged": result.get("purged", 0), "state": _state_summary(result["state"])}


@safe_tool()
def save_settings(
    confident: float,
    likely: float,
    relaxed_child: float,
    quality_min: float,
    cluster_min_size: int,
    face_detector_size: int,
    two_pass_scan: bool,
    verification_detector_size: int,
    safe_mode: bool,
    safe_mode_threshold: float,
    safe_mode_profile: str | None = None,
    safe_mode_multimodal: bool | None = None,
    safe_mode_zero_admittance: bool | None = None,
    performance_mode: str | None = None,
    storage_budget_bytes: int = 0,
    max_media_file_bytes: int | None = None,
    excluded_dir_names: list[str] | None = None,
    excluded_path_keywords: list[str] | None = None,
    excluded_extensions: list[str] | None = None,
    excluded_file_paths: list[str] | None = None,
    confirm: bool = False,
    reason: str = "",
) -> dict[str, Any]:
    """Update thresholds, clustering minimum, Safe Mode settings, storage budget, and optional scan exclusions."""
    current = _api().project.config
    new_zero_admittance = (
        current.safe_mode_zero_admittance if safe_mode_zero_admittance is None else bool(safe_mode_zero_admittance)
    )
    new_multimodal = current.safe_mode_multimodal if safe_mode_multimodal is None else bool(safe_mode_multimodal)
    # A named profile is authoritative for the effective threshold; use it (not
    # the raw arg) to decide whether protection is being relaxed and confirmed.
    new_profile = normalize_safe_mode_profile(safe_mode_profile) if safe_mode_profile is not None else current.safe_mode_profile
    effective_threshold = safe_mode_threshold if new_profile == "custom" else safe_mode_threshold_for_profile(new_profile)
    relaxes_safe_mode = (
        (current.safe_mode and not safe_mode)
        or effective_threshold > current.safe_mode_threshold
        or (current.safe_mode_multimodal and not new_multimodal)
        or (current.safe_mode_zero_admittance and not new_zero_admittance)
    )
    relaxes_review_thresholds = (
        confident < current.thresholds.confident
        or likely < current.thresholds.likely
        or relaxed_child < current.thresholds.relaxed_child
        or quality_min < current.thresholds.quality_min
    )
    if relaxes_safe_mode:
        _confirmed(confirm, "relax Safe Mode protection")
    if relaxes_review_thresholds:
        _confirmed(confirm, "relax review thresholds")
    state = _call(
        "save_settings",
        {
            "thresholds": {
                "confident": confident,
                "likely": likely,
                "relaxedChild": relaxed_child,
                "qualityMin": quality_min,
            },
            "clusterMinSize": cluster_min_size,
            "faceDetectorSize": face_detector_size,
            "twoPassScan": two_pass_scan,
            "verificationDetectorSize": verification_detector_size,
            "performanceMode": performance_mode if performance_mode is not None else current.performance_mode,
            "safeMode": safe_mode,
            "safeModeMultimodal": new_multimodal,
            "safeModeZeroAdmittance": new_zero_admittance,
            "safeModeThreshold": safe_mode_threshold,
            "safeModeProfile": new_profile,
            "storageBudgetBytes": storage_budget_bytes,
            "maxMediaFileBytes": max_media_file_bytes if max_media_file_bytes is not None else current.max_media_file_bytes,
            "scanExclusions": {
                "dirNames": excluded_dir_names if excluded_dir_names is not None else current.excluded_dir_names,
                "pathKeywords": excluded_path_keywords if excluded_path_keywords is not None else current.excluded_path_keywords,
                "extensions": excluded_extensions if excluded_extensions is not None else current.excluded_extensions,
                "filePaths": excluded_file_paths if excluded_file_paths is not None else current.excluded_file_paths,
            },
            "source": "mcp",
            "reason": reason,
        },
    )
    return {**_state_summary(state), "confirmed": confirm, "reason": reason}


@safe_tool()
def set_performance_mode(mode: str = "auto") -> dict[str, Any]:
    """Set the scan and UI performance profile to auto, fast, balanced, or quality."""
    state = _call("set_performance_mode", {"mode": mode, "source": "mcp"})
    config = state.get("config", {})
    return {
        **_state_summary(state),
        "performanceMode": config.get("performanceMode", mode),
        "effectivePerformanceMode": config.get("effectivePerformanceMode", mode),
        "effectiveFaceDetectorSize": config.get("effectiveFaceDetectorSize", config.get("faceDetectorSize")),
        "effectiveTwoPassScan": config.get("effectiveTwoPassScan", config.get("twoPassScan")),
    }


@safe_tool()
def export_review_report() -> dict[str, Any]:
    """Export a JSON audit report and CSV candidate table into the workspace exports folder."""
    result = _call("export_report")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_workspace_inventory() -> dict[str, Any]:
    """Export a workspace inventory with source-folder counts, saved references, and review rows, without media files."""
    result = _call("export_workspace_inventory")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_audit_log() -> dict[str, Any]:
    """Export the full local activity log to JSON and CSV for review or support."""
    result = _call("export_audit_log")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_consent_receipt() -> dict[str, Any]:
    """Export a consent receipt with policy and counts, without photos, thumbnails, vectors, or model files."""
    result = _call("export_consent_receipt")
    return {"receipt": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def retention_policy_report() -> dict[str, Any]:
    """Report reviewed-match retention windows, generated data size, and cleanup recommendations."""
    return _call("retention_policy_report")


@safe_tool()
def export_safe_mode_audit() -> dict[str, Any]:
    """Export Safe Mode policy, model status, cache counts, and protected-media scan totals."""
    result = _call("export_safe_mode_audit")
    return {"audit": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def model_drift_report() -> dict[str, Any]:
    """Report references or review rows created with a different active face model."""
    return _call("model_drift_report")


@safe_tool()
def reference_gap_report() -> dict[str, Any]:
    """Report which saved people need clearer, side-angle, multi-age, or refreshed reference photos."""
    return _call("reference_gap_report")


@safe_tool()
def export_review_ledger() -> dict[str, Any]:
    """Export review decision metadata and audit events without media, thumbnails, vectors, or model files."""
    result = _call("export_review_ledger")
    return {"ledger": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_scan_history() -> dict[str, Any]:
    """Export scan run history to JSON and CSV for performance/support review."""
    result = _call("export_scan_history")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_workspace_backup(include_generated: bool = False, confirm: bool = False) -> dict[str, Any]:
    """Export a ZIP backup of workspace metadata and audit logs; generated files require confirm=true."""
    if include_generated:
        _confirmed(confirm, "include generated previews/video frames in a workspace backup")
    result = _call("export_workspace_backup", {"includeGenerated": include_generated})
    return {"backup": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def verify_workspace_backup(path: str = "") -> dict[str, Any]:
    """Verify a Vintrace workspace backup ZIP before sharing or archiving it."""
    if path:
        _assert_allowed_path(path)  # MCP-06: confine the agent-supplied source ZIP.
    result = _call("verify_workspace_backup", {"path": path})
    return {"verification": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def restore_workspace_backup(path: str = "", target: str = "", confirm: bool = False) -> dict[str, Any]:
    """Restore a verified Vintrace workspace backup ZIP into an empty target folder. Requires confirm=true."""
    _confirmed(confirm, "restore a workspace backup into an empty target folder")
    # MCP-06: confine BOTH the source ZIP and the restore destination to approved
    # roots — restore writes files, so an unconfined target is an arbitrary-write.
    if path:
        _assert_allowed_path(path)
    if target:
        _assert_allowed_path(target)
    result = _call("restore_workspace_backup", {"path": path, "target": target})
    return {"restore": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def prune_workspace_backups(keep: int = 5, confirm: bool = False) -> dict[str, Any]:
    """Remove older workspace backup ZIPs, keeping the newest N backups. Requires confirm=true."""
    _confirmed(confirm, f"remove old workspace backups and keep the newest {keep}")
    result = _call("prune_workspace_backups", {"keep": keep})
    return {"cleanup": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def prune_scan_manifests(keep_runs: int = 20, confirm: bool = False) -> dict[str, Any]:
    """Remove older resumable scan manifest rows while keeping the newest runs. Requires confirm=true."""
    _confirmed(confirm, f"remove old scan manifests and keep the newest {keep_runs}")
    result = _call("prune_scan_manifests", {"keepRuns": keep_runs})
    return {"cleanup": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_selected_candidates(candidate_ids: list[str]) -> dict[str, Any]:
    """Export selected candidate rows to JSON and CSV in the workspace exports folder."""
    result = _call("export_candidates", {"candidateIds": candidate_ids})
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_accepted_media_bundle(confirm: bool = False) -> dict[str, Any]:
    """Copy accepted media into a shareable folder with JSON/CSV manifests."""
    _confirmed(confirm, "export accepted media files")
    result = _call("export_media_bundle", {"statuses": ["accepted"], "includeOriginalMedia": True})
    return {"bundle": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def runtime_self_test() -> dict[str, Any]:
    """Run local runtime diagnostics for workspace, decoders, acceleration, Safe Mode, and health."""
    return _call("runtime_self_test")


@safe_tool()
def runtime_benchmark() -> dict[str, Any]:
    """Run a local scale benchmark for vector search, state serialization, and SQLite manifest health."""
    return _call("runtime_benchmark")


@safe_tool()
def benchmark_history(limit: int = 8) -> dict[str, Any]:
    """Return recent runtime benchmark runs without running a new benchmark."""
    return {"benchmarks": _call("benchmark_history", {"limit": limit})}


@safe_tool()
def storage_io_benchmark(path: str = "", size_mb: int = 8) -> dict[str, Any]:
    """Benchmark metadata I/O in a folder without reading or training on any photos."""
    # MCP-06: this writes a real (1-128MB) probe file + reveals fs metadata, so
    # confine the agent-supplied directory to approved roots (an empty path
    # defaults to the workspace). Prevents arbitrary-dir write + a filesystem oracle.
    if path:
        _assert_allowed_path(path)
    return _call("storage_io_benchmark", {"path": path, "sizeMb": size_mb})


@safe_tool()
def release_readiness() -> dict[str, Any]:
    """Return a local release checklist for models, Safe Mode, signing, updates, and crash reporting."""
    return _call("release_readiness")


@safe_tool()
def model_integrity() -> dict[str, Any]:
    """Verify model folder writability, downloaded archive checksums, Safe Mode model, and decoder readiness."""
    return _call("model_integrity")


@safe_tool()
def model_distribution_audit() -> dict[str, Any]:
    """Audit local/downloadable model sources, checksums, installed paths, and license review status."""
    return _call("model_distribution_audit")


@safe_tool()
def backfill_model_references(confirm: bool = False, limit: int = 0) -> dict[str, Any]:
    """Create active-model embeddings for saved person photos that were enrolled with another recognizer. Requires confirm=true."""
    _confirmed(confirm, "backfill saved references for the active face model")
    result = _call("backfill_model_references", {"limit": max(0, int(limit))})
    return {"backfill": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_support_bundle(include_paths: bool = False) -> dict[str, Any]:
    """Export a diagnostics-only support bundle without photos, videos, thumbnails, vectors, or model files."""
    result = _call("export_support_bundle", {"includePaths": include_paths})
    return {"bundle": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def installer_self_diagnostics() -> dict[str, Any]:
    """Run first-run diagnostics for installers: model downloader, decoders, Safe Mode, workspace, and packaged backend readiness."""
    return _call("installer_self_diagnostics")


@safe_tool()
def public_dataset_catalog() -> dict[str, Any]:
    """List supported public benchmark datasets and how Vintrace uses them safely."""
    return _call("public_dataset_catalog")


@safe_tool()
def inspect_public_dataset(dataset_id: str, folder: str, include_videos: bool = True) -> dict[str, Any]:
    """Inspect a local public-dataset folder laid out as identity subfolders."""
    if folder:
        _assert_allowed_path(folder)  # MCP-06: confine the agent-supplied dataset folder.
    return _call("inspect_public_dataset", {"datasetId": dataset_id, "folder": folder, "includeVideos": include_videos})


@safe_tool()
def run_public_dataset_benchmark(
    dataset_id: str,
    folder: str = "",
    max_identities: int = 12,
    candidate_images: int = 3,
    download_lfw: bool = False,
    download_dataset: bool | None = None,
    include_videos: bool = False,
    confirm: bool = False,
) -> dict[str, Any]:
    """Run an isolated public-dataset benchmark. Auto-downloading LFW/CFP or running without a local folder requires confirm=true."""
    should_download = bool(download_lfw if download_dataset is None else download_dataset)
    if should_download or not folder:
        _confirmed(confirm, "download/reuse a public benchmark cache or run a dataset benchmark without a local folder")
    if folder:
        _assert_allowed_path(folder)  # MCP-06: confine the agent-supplied dataset folder.
    result = _call(
        "run_public_dataset_benchmark",
        {
            "datasetId": dataset_id,
            "folder": folder,
            "maxIdentities": max_identities,
            "candidateImages": candidate_images,
            "downloadIfMissing": should_download,
            "includeVideos": include_videos,
        },
    )
    return {"benchmark": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def compare_public_dataset_models(
    dataset_id: str,
    folder: str = "",
    max_identities: int = 12,
    candidate_images: int = 3,
    download_dataset: bool = False,
    include_videos: bool = False,
    confirm: bool = False,
) -> dict[str, Any]:
    """Compare installed face model packs on the same isolated public-dataset benchmark slice."""
    if download_dataset or not folder:
        _confirmed(confirm, "download/reuse a public benchmark cache or compare model packs without a local folder")
    if folder:
        _assert_allowed_path(folder)  # MCP-06: confine the agent-supplied dataset folder.
    result = _call(
        "compare_public_dataset_models",
        {
            "datasetId": dataset_id,
            "folder": folder,
            "maxIdentities": max_identities,
            "candidateImages": candidate_images,
            "downloadIfMissing": download_dataset,
            "includeVideos": include_videos,
        },
    )
    return {"comparison": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def apply_model_recommendation(pack: str, backfill: bool = True, confirm: bool = False) -> dict[str, Any]:
    """Apply a model pack recommended by model comparison. Requires confirm=true because it changes settings and can backfill references."""
    _confirmed(confirm, "apply the recommended model pack and backfill saved references")
    result = _call("apply_model_recommendation", {"pack": pack, "backfill": backfill})
    return {"application": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def apply_review_rules(confirm: bool = False) -> dict[str, Any]:
    """Apply saved auto-triage review rules to pending candidates. Requires confirm=true because it changes review status."""
    _confirmed(confirm, "apply saved review rules to pending candidates")
    result = _call("apply_review_rules")
    return {"rules": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def ordered_review_candidates(status: str = "pending", limit: int = 50) -> dict[str, Any]:
    """Return the active-learning ordered review queue using the current calibration."""
    return _call("ordered_review_candidates", {"status": status, "limit": limit})


@safe_tool()
def calibration_summary() -> dict[str, Any]:
    """Return the local calibration label summary built from accepted/rejected review decisions."""
    return _call("calibration_summary")


@safe_tool()
def accuracy_evaluation() -> dict[str, Any]:
    """Evaluate precision/recall from accepted and rejected review decisions."""
    return _call("accuracy_evaluation")


@safe_tool()
def export_accuracy_labels() -> dict[str, Any]:
    """Export accepted/rejected review labels to JSON and CSV for accuracy benchmarking."""
    result = _call("export_accuracy_labels")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def import_accuracy_labels(labels: list[dict[str, Any]], confirm: bool = False) -> dict[str, Any]:
    """Import local ground-truth label rows into the calibration/accuracy harness."""
    _confirmed(confirm, "import accuracy labels")
    result = _call("import_accuracy_labels", {"rows": labels})
    return {"imported": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def export_training_examples(include_paths: bool = False) -> dict[str, Any]:
    """Export reviewed training-example metadata without media files or vectors."""
    result = _call("export_training_examples", {"includePaths": include_paths})
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def import_training_examples(examples: list[dict[str, Any]], confirm: bool = False) -> dict[str, Any]:
    """Import reviewed training-example metadata into the local learning set."""
    _confirmed(confirm, "import training examples")
    result = _call("import_training_examples", {"rows": examples})
    return {"imported": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def apply_calibration(confirm: bool = False) -> dict[str, Any]:
    """Apply local review feedback to matching thresholds."""
    _confirmed(confirm, "apply review feedback to matching thresholds")
    result = _call("apply_calibration")
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def apply_personalized_calibration(confirm: bool = False) -> dict[str, Any]:
    """Fit per-person calibration from local accept/reject labels and prefer it when matching that person."""
    _confirmed(confirm, "apply per-person calibration")
    result = _call("apply_personalized_calibration")
    return {"personalizedCalibration": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def calibration_learning_status() -> dict[str, Any]:
    """Read staged/promoted calibration-learning artifacts and current calibration state."""
    return _call("calibration_learning_status")


@safe_tool()
def run_learning_jobs(confirm: bool = False) -> dict[str, Any]:
    """Run guarded local learning jobs; currently auto-stages calibration when ready."""
    _confirmed(confirm, "run local learning jobs")
    result = _call("run_learning_jobs")
    return {"learning": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def reference_suggestion_status() -> dict[str, Any]:
    """Read staged/promoted suggested-reference artifacts."""
    return _call("reference_suggestion_status")


@safe_tool()
def stage_reference_suggestions(limit: int = 20, confirm: bool = False) -> dict[str, Any]:
    """Stage suggested references from high-quality accepted matches."""
    _confirmed(confirm, "stage suggested references")
    result = _call("stage_reference_suggestions", {"limit": limit})
    return {"suggestions": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def approve_reference_suggestion(artifact_id: str, confirm: bool = False) -> dict[str, Any]:
    """Approve a staged suggested reference and add it to saved person photos."""
    _confirmed(confirm, "approve a suggested reference")
    result = _call("approve_reference_suggestion", {"artifactId": artifact_id})
    return {"approval": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def reject_reference_suggestion(artifact_id: str, reason: str = "", confirm: bool = False) -> dict[str, Any]:
    """Reject a staged suggested reference artifact."""
    _confirmed(confirm, "reject a suggested reference")
    result = _call("reject_reference_suggestion", {"artifactId": artifact_id, "reason": reason})
    return {"rejection": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def synthetic_enrollment_screen_status() -> dict[str, Any]:
    """Read the verified local screen report and staged enrollment authenticity reviews."""
    return _call("synthetic_enrollment_screen_status")


@safe_tool()
def approve_synthetic_enrollment_review(
    artifact_id: str,
    allow_synthetic_override: bool = False,
    confirm: bool = False,
) -> dict[str, Any]:
    """Re-verify and approve a held enrollment; flagged/unavailable screens need an explicit override."""
    _confirmed(confirm, "approve a held enrollment authenticity review")
    result = _call(
        "approve_synthetic_enrollment_review",
        {
            "artifactId": artifact_id,
            "allowSyntheticOverride": bool(allow_synthetic_override),
        },
    )
    return {"approval": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def reject_synthetic_enrollment_review(
    artifact_id: str,
    reason: str = "",
    confirm: bool = False,
) -> dict[str, Any]:
    """Reject a held enrollment authenticity review without altering the source image."""
    _confirmed(confirm, "reject a held enrollment authenticity review")
    result = _call(
        "reject_synthetic_enrollment_review",
        {"artifactId": artifact_id, "reason": reason},
    )
    return {"rejection": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def stage_calibration(confirm: bool = False) -> dict[str, Any]:
    """Stage a learned calibration artifact from local review feedback without applying it."""
    _confirmed(confirm, "stage a learned calibration artifact")
    result = _call("stage_calibration")
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def promote_calibration(artifact_id: str = "", confirm: bool = False) -> dict[str, Any]:
    """Promote a staged learned calibration artifact after validation."""
    _confirmed(confirm, "promote a staged calibration artifact")
    result = _call("promote_calibration", {"artifactId": artifact_id})
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def rollback_calibration(artifact_id: str = "", confirm: bool = False) -> dict[str, Any]:
    """Rollback a promoted learned calibration artifact to its previous thresholds."""
    _confirmed(confirm, "rollback a promoted calibration artifact")
    result = _call("rollback_calibration", {"artifactId": artifact_id})
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def embedding_adapter_status() -> dict[str, Any]:
    """Read staged/promoted embedding-adapter artifacts and adapter readiness."""
    return _call("embedding_adapter_status")


@safe_tool()
def stage_embedding_adapter(confirm: bool = False) -> dict[str, Any]:
    """Stage a JSON logistic adapter over frozen embeddings after held-out validation."""
    _confirmed(confirm, "stage an embedding adapter artifact")
    result = _call("stage_embedding_adapter")
    return {"adapter": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def promote_embedding_adapter(artifact_id: str = "", confirm: bool = False) -> dict[str, Any]:
    """Promote a staged embedding adapter after validation."""
    _confirmed(confirm, "promote an embedding adapter artifact")
    result = _call("promote_embedding_adapter", {"artifactId": artifact_id})
    return {"adapter": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def rollback_embedding_adapter(artifact_id: str = "", confirm: bool = False) -> dict[str, Any]:
    """Rollback a promoted embedding adapter artifact."""
    _confirmed(confirm, "rollback an embedding adapter artifact")
    result = _call("rollback_embedding_adapter", {"artifactId": artifact_id})
    return {"adapter": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def privacy_report() -> dict[str, Any]:
    """Report local face data, generated previews, caches, and audit history in this workspace."""
    return _call("privacy_report")


@safe_tool()
def delete_face_data(
    confirm: bool = False,
    include_audit: bool = False,
    operator_token: str = "",
) -> dict[str, Any]:
    """Delete saved faces, possible matches, scan history, generated previews, and private caches.

    Deleting the tamper-evident audit log too (include_audit=True) is a human-only operator
    action: it requires the VINTRACE_MCP_OPERATOR_TOKEN (passed as operator_token), so an
    authenticated agent cannot erase its own trail.
    """
    _confirmed(confirm, "delete face data from the workspace")
    if include_audit:
        _validate_operator_token("Deleting the audit log", operator_token)
    result = _call("delete_face_data", {"confirm": True, "includeAudit": include_audit})
    return {"deleted": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def optimize_workspace(confirm: bool = False) -> dict[str, Any]:
    """Remove regenerable preview cache, orphan extracted video frames, and compact the scale database."""
    _confirmed(confirm, "optimize generated workspace files")
    result = _call("optimize_workspace")
    return {"optimized": result.get("value", {}), "state": _state_summary(result["state"])}


@safe_tool()
def enforce_storage_budget(confirm: bool = False) -> dict[str, Any]:
    """Clean generated cache to try to bring the workspace under the configured storage limit."""
    _confirmed(confirm, "clean generated cache to enforce the storage limit")
    result = _call("enforce_storage_budget")
    return {"storage": result.get("value", {}), "state": _state_summary(result["state"])}


_TASK_OPTIONAL_TOOLS = frozenset({
    "import_inbound_visuals",
    "run_image_write_action",
    "scan_folder",
    "scan_image_paths",
    "scan_media_paths",
    "sync_inbound_visuals",
})


def _task_owner_binding() -> str:
    return _agent_principal_binding()


MCP_TASK_STORE = SQLiteMcpTaskStore(
    WORKSPACE / "agent" / "mcp_tasks.sqlite3",
    owner=_task_owner_binding,
)
MCP_TASK_SUPPORT = mcp._mcp_server.experimental.enable_tasks(store=MCP_TASK_STORE)
_ACTIVE_MCP_TASK_CONTEXTS: dict[str, Any] = {}


def _call_tool_result(value: Any) -> CallToolResult:
    if isinstance(value, CallToolResult):
        return value
    if isinstance(value, tuple) and len(value) == 2:
        content, structured = value
        return CallToolResult(content=list(content), structuredContent=structured)
    if isinstance(value, dict):
        return CallToolResult(
            content=[TextContent(type="text", text=json.dumps(value, ensure_ascii=False, indent=2))],
            structuredContent=value,
        )
    return CallToolResult(content=list(value) if hasattr(value, "__iter__") else [])


def _nested_value(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value and value[key] not in (None, ""):
            return value[key]
        for child in value.values():
            found = _nested_value(child, key)
            if found not in (None, ""):
                return found
    elif isinstance(value, list):
        for child in value:
            found = _nested_value(child, key)
            if found not in (None, ""):
                return found
    return None


def _task_link_for_call(tool_name: str, arguments: dict[str, Any], result: CallToolResult | None = None) -> dict[str, Any] | None:
    if tool_name in {"scan_folder", "scan_image_paths", "scan_media_paths"}:
        return {"jobType": "scan", "jobId": "", "tool": tool_name}
    action = str(arguments.get("action", "") or "")
    if tool_name in {"import_inbound_visuals", "sync_inbound_visuals"}:
        job_type = "inbound"
    elif "index" in action:
        job_type = "indexing"
    elif "export" in action:
        job_type = "export"
    else:
        return None
    structured = result.structuredContent if result is not None else None
    job_id = str(_nested_value(structured, "jobId") or "")
    if not job_id:
        return None
    return {"jobType": job_type, "jobId": job_id, "tool": tool_name, "action": action}


def _task_status(value: Any) -> str:
    return str(_nested_value(value, "status") or "").strip().lower()


def _job_task_result(linkage: dict[str, Any], envelope: dict[str, Any], *, failed: bool = False) -> CallToolResult:
    job_type = str(linkage.get("jobType", "job") or "job")
    job_id = str(linkage.get("jobId", "") or "")
    return CallToolResult(
        isError=failed,
        content=[TextContent(type="text", text=f"Vintrace {job_type} job {job_id or 'active'} {_task_status(envelope) or 'updated'}.")],
        structuredContent=envelope,
    )


async def _resolve_linked_task(linkage: dict[str, Any]) -> tuple[mcp_types.TaskStatus | None, str, mcp_types.Result | None]:
    task_id = str(linkage.get("taskId", "") or "")
    if (
        str(linkage.get("jobType", "") or "") == "scan"
        and not str(linkage.get("jobId", "") or "")
        and task_id in _ACTIVE_MCP_TASK_CONTEXTS
    ):
        # A live scan owns the authoritative task state. Querying the catalog's
        # durable scan summary here can wait behind its active write transaction,
        # delaying tasks/get and making cancellation race terminal completion.
        return "working", "Scan is running.", None
    try:
        envelope = await anyio.to_thread.run_sync(
            lambda: _image_service().job(
                str(linkage.get("jobType", "") or ""),
                str(linkage.get("jobId", "") or ""),
            )
        )
    except Exception as exc:
        message = _redacted_exception_message(exc)
        return "failed", message, CallToolResult(
            isError=True,
            content=[TextContent(type="text", text=message)],
            structuredContent={"ok": False, "error": {"code": "task_job_unavailable", "message": message}},
        )
    status = _task_status(envelope)
    if status in {"completed", "complete", "succeeded", "success", "done"}:
        return "completed", f"{linkage.get('jobType', 'job')} job completed.", _job_task_result(linkage, envelope)
    if status in {"failed", "error", "cancelled", "canceled"}:
        return "failed" if status not in {"cancelled", "canceled"} else "cancelled", f"Job {status}.", _job_task_result(linkage, envelope, failed=True)
    return "working", f"Job {status or 'working'}.", None


MCP_TASK_STORE.set_link_resolver(_resolve_linked_task)


def _reset_mcp_task_store(workspace: Path) -> None:
    global MCP_TASK_STORE
    MCP_TASK_STORE = SQLiteMcpTaskStore(
        Path(workspace) / "agent" / "mcp_tasks.sqlite3",
        owner=_task_owner_binding,
    )
    MCP_TASK_STORE.set_link_resolver(_resolve_linked_task)
    MCP_TASK_SUPPORT.store = MCP_TASK_STORE
    MCP_TASK_SUPPORT.handler = TaskResultHandler(MCP_TASK_STORE, MCP_TASK_SUPPORT.queue)


async def _cancel_linked_task(linkage: dict[str, Any] | None) -> None:
    if not linkage:
        return
    job_type = str(linkage.get("jobType", "") or "")
    job_id = str(linkage.get("jobId", "") or "")
    command = {
        "scan": "cancel_scan",
        "indexing": "cancel_photo_indexing_job",
        "export": "cancel_photo_export_job",
        "inbound": "cancel_photo_source_job",
    }.get(job_type)
    if command:
        params = {"jobId": job_id} if job_id else {}
        await anyio.to_thread.run_sync(lambda: _call(command, params))


async def _dispatch_linked_task(linkage: dict[str, Any]) -> None:
    if str(linkage.get("jobType", "") or "") != "indexing":
        return
    job_id = str(linkage.get("jobId", "") or "")
    if not job_id:
        return
    await anyio.to_thread.run_sync(lambda: _call("run_photo_indexing_job", {"jobId": job_id}))


def _audit_task(action: str, task_id: str, **details: Any) -> None:
    try:
        _api().project._append_audit({"action": action, "task_id": task_id, **details})
    except Exception:
        pass


async def _call_tool_with_telemetry(
    name: str,
    arguments: dict[str, Any],
    context: Context,
    *,
    task_present: bool,
) -> Any:
    registered = mcp._tool_manager.get_tool(name)
    annotations = registered.annotations if registered is not None else None
    read_only = bool(annotations and annotations.readOnlyHint)
    destructive = bool(annotations and annotations.destructiveHint)
    open_world = bool(annotations and annotations.openWorldHint)
    lane = "read" if read_only else "destructive" if destructive else "write"
    request_meta = getattr(getattr(context, "request_context", None), "meta", None)
    with MCP_TELEMETRY.tool_span(
        tool_name=name,
        lane=lane,
        arguments=arguments,
        request_meta=request_meta,
        task_present=task_present,
        read_only=read_only,
        destructive=destructive,
        open_world=open_world,
    ) as trace_span:
        result = await mcp._tool_manager.call_tool(name, arguments, context=context, convert_result=True)
        trace_span.observe_result(result)
        return result


@mcp._mcp_server.list_tools()
async def _list_tools_with_task_modes() -> list[mcp_types.Tool]:
    tools = await mcp.list_tools()
    return [
        tool.model_copy(update={"execution": mcp_types.ToolExecution(taskSupport="optional")})
        if tool.name in _TASK_OPTIONAL_TOOLS
        else tool
        for tool in tools
    ]


@mcp._mcp_server.call_tool(validate_input=False)
async def _task_aware_call_tool(name: str, arguments: dict[str, Any]) -> Any:
    request_context = mcp._mcp_server.request_context
    task_mode: mcp_types.TaskExecutionMode | None = "optional" if name in _TASK_OPTIONAL_TOOLS else None
    request_context.experimental.validate_task_mode(task_mode)
    context = mcp.get_context()
    if not request_context.experimental.is_task:
        return await _call_tool_with_telemetry(name, arguments, context, task_present=False)

    async def work(task_context) -> CallToolResult:
        _ACTIVE_MCP_TASK_CONTEXTS[task_context.task_id] = task_context
        _audit_task("mcp_task_started", task_context.task_id, tool=name)
        try:
            current_task = await MCP_TASK_STORE.get_task(task_context.task_id)
            if current_task is not None and mcp_task_is_terminal(current_task.status):
                task_context._ctx._task = current_task
                return CallToolResult(
                    isError=True,
                    content=[TextContent(type="text", text="The MCP task was cancelled before execution.")],
                    structuredContent={"ok": False, "error": {"code": "task_cancelled"}},
                )
            pre_link = _task_link_for_call(name, arguments)
            if pre_link is not None:
                pre_link = {**pre_link, "taskId": task_context.task_id}
                await MCP_TASK_STORE.set_linkage(task_context.task_id, pre_link)
            await task_context.update_status(f"Running {name}.")
            raw = await _call_tool_with_telemetry(name, arguments, context, task_present=True)
            result = _call_tool_result(raw)
            linkage = _task_link_for_call(name, arguments, result) or pre_link
            if linkage is not None:
                linkage = {**linkage, "taskId": task_context.task_id}
            if linkage is None or not str(linkage.get("jobId", "") or ""):
                _audit_task("mcp_task_completed", task_context.task_id, tool=name)
                return result
            await MCP_TASK_STORE.set_linkage(task_context.task_id, linkage)
            await task_context.update_status(f"Running linked {linkage['jobType']} job.", notify=False)
            await _dispatch_linked_task(linkage)
            deadline = time.monotonic() + min(86_400, max(1, int(task_context.task.ttl or 60_000) // 1000))
            while time.monotonic() < deadline:
                if task_context.is_cancelled or mcp_task_is_terminal(task_context.task.status):
                    return result
                status, message, final_result = await _resolve_linked_task(linkage)
                if status == "completed" and final_result is not None:
                    _audit_task("mcp_task_completed", task_context.task_id, tool=name, job_type=linkage["jobType"])
                    return _call_tool_result(final_result)
                if status in {"failed", "cancelled"}:
                    failure = _call_tool_result(final_result) if final_result is not None else CallToolResult(isError=True, content=[])
                    await MCP_TASK_STORE.store_result(task_context.task_id, failure)
                    await task_context.fail(message)
                    _audit_task("mcp_task_failed", task_context.task_id, tool=name, status=status)
                    return failure
                await task_context.update_status(message, notify=False)
                await anyio.sleep(0.5)
            timeout_result = CallToolResult(
                isError=True,
                content=[TextContent(type="text", text="The MCP task reached its retention deadline.")],
                structuredContent={"ok": False, "error": {"code": "task_ttl_elapsed"}},
            )
            await MCP_TASK_STORE.store_result(task_context.task_id, timeout_result)
            await task_context.fail("The MCP task reached its retention deadline.")
            return timeout_result
        except Exception as exc:
            message = _redacted_exception_message(exc)
            failure = CallToolResult(
                isError=True,
                content=[TextContent(type="text", text=message)],
                structuredContent={"ok": False, "error": {"code": "task_failed", "message": message}},
            )
            await MCP_TASK_STORE.store_result(task_context.task_id, failure)
            await task_context.fail(message)
            _audit_task("mcp_task_failed", task_context.task_id, tool=name)
            return failure
        finally:
            _ACTIVE_MCP_TASK_CONTEXTS.pop(task_context.task_id, None)

    return await request_context.experimental.run_task(
        work,
        model_immediate_response=f"{name} is running as a durable Vintrace task.",
    )


@mcp._mcp_server.experimental.list_tasks()
async def _list_mcp_tasks(request: mcp_types.ListTasksRequest) -> mcp_types.ListTasksResult:
    try:
        tasks, next_cursor = await MCP_TASK_STORE.list_tasks(request.params.cursor if request.params else None)
    except ValueError as exc:
        raise McpError(ErrorData(code=INVALID_PARAMS, message=str(exc))) from exc
    _audit_task("mcp_tasks_listed", "", count=len(tasks))
    return mcp_types.ListTasksResult(tasks=tasks, nextCursor=next_cursor)


@mcp._mcp_server.experimental.get_task()
async def _get_mcp_task(request: mcp_types.GetTaskRequest) -> mcp_types.GetTaskResult:
    task = await MCP_TASK_STORE.get_task(request.params.taskId)
    if task is None:
        raise McpError(ErrorData(code=INVALID_PARAMS, message="Task not found."))
    _audit_task("mcp_task_retrieved", task.taskId, status=task.status)
    return mcp_types.GetTaskResult(**task.model_dump())


@mcp._mcp_server.experimental.get_task_result()
async def _get_mcp_task_result(request: mcp_types.GetTaskPayloadRequest) -> mcp_types.GetTaskPayloadResult:
    context = mcp._mcp_server.request_context
    result = await MCP_TASK_SUPPORT.handler.handle(request, context.session, context.request_id)
    _audit_task("mcp_task_result_retrieved", request.params.taskId)
    return result


@mcp._mcp_server.experimental.cancel_task()
async def _cancel_mcp_task(request: mcp_types.CancelTaskRequest) -> mcp_types.CancelTaskResult:
    task = await MCP_TASK_STORE.get_task(request.params.taskId)
    if task is None:
        raise McpError(ErrorData(code=INVALID_PARAMS, message="Task not found."))
    if mcp_task_is_terminal(task.status):
        raise McpError(ErrorData(code=INVALID_PARAMS, message="A terminal task cannot be cancelled."))
    await _cancel_linked_task(await MCP_TASK_STORE.get_linkage(task.taskId))
    try:
        result = await cancel_mcp_task(MCP_TASK_STORE, task.taskId)
    except ValueError as exc:
        raise McpError(ErrorData(code=INVALID_PARAMS, message=str(exc))) from exc
    cancelled_result = CallToolResult(
        isError=True,
        content=[TextContent(type="text", text="The MCP task was cancelled by the requestor.")],
        structuredContent={"ok": False, "error": {"code": "task_cancelled"}},
    )
    await MCP_TASK_STORE.store_result(task.taskId, cancelled_result)
    active_context = _ACTIVE_MCP_TASK_CONTEXTS.get(task.taskId)
    if active_context is not None:
        active_context.request_cancellation()
        current_task = await MCP_TASK_STORE.get_task(task.taskId)
        if current_task is not None:
            active_context._ctx._task = current_task
    _audit_task("mcp_task_cancelled", task.taskId)
    return result


@mcp.prompt(title="Triage Pending Vintrace Candidates")
def triage_pending(max_items: int = 20) -> str:
    """Guide an agent through review triage using current pending candidates."""
    state = _agent_state()
    pending_result = _call(
        "query_candidates",
        {
            "status": "pending",
            "lane": "all",
            "sort": "score",
            "offset": 0,
            "limit": max(1, min(50, int(max_items))),
            "previewBudget": 0,
        },
    )
    # MCP-04: hide basenames too (keep_path_names=False) — filenames frequently
    # encode names/dates, so this prompt must match the resource redaction policy.
    pending = _agent_safe_value(pending_result.get("items", []), keep_path_names=False)
    return (
        "You are assisting a human reviewer with Vintrace.\n"
        "Summarize pending candidates, call out low-confidence or clustered cases, "
        "and do not make autonomous identity claims.\n\n"
        f"State summary:\n{_json(_agent_safe_value(_state_summary(state), keep_path_names=False))}\n\n"
        f"Pending candidates:\n{_json(pending)}"
    )


@mcp.prompt(title="Plan Multi-Age Enrollment")
def plan_multi_age_enrollment(person_name: str, available_age_groups: str = "") -> str:
    """Create a consent-first plan for enrolling a person across age groups."""
    return (
        f"Plan a reference enrollment for {person_name}. "
        "Use one folder per available age group, prefer child/adolescent/adult separation, "
        "mark consent first, then call enroll_age_reference_set. "
        f"Available age groups or notes: {available_age_groups}"
    )


@mcp.prompt(title="Safe Mode Operating Policy")
def safe_mode_policy() -> str:
    """Summarize how agents should handle intimate or sensitive images/videos."""
    return (
        "Keep Safe Mode enabled by default. If scan metrics report protected files, "
        "do not ask to view or recover them through candidates; report only aggregate counts. "
        "Do not disable Safe Mode unless the human operator explicitly requests it and understands "
        "that protected images or videos can then enter matching, thumbnails, and clusters."
    )


@mcp.prompt(title="Plan an Agent Image Workflow")
def plan_image_workflow(goal: str, constraints: str = "") -> str:
    """Turn an image-library goal into a search-first, approval-aware execution plan."""
    return (
        "Plan this Vintrace image workflow without executing it. Start with capability discovery and a library overview; "
        "use stable asset IDs; search before fetching metadata; inspect existing local intelligence with analyze_image_assets; request pixels only for a small shortlist; plan every "
        "mutation; identify its read, write, or destructive lane; state the human approval point; assign a unique "
        "idempotency key strategy; and include job polling and verification. Do not invent source paths or claim "
        "autonomous identity.\n\n"
        f"Goal: {goal}\nConstraints: {constraints}"
    )


@mcp.prompt(title="Curate an Image Selection")
def curate_image_selection(goal: str, max_candidates: int = 40, constraints: str = "") -> str:
    """Guide a bounded semantic-plus-metadata curation pass with minimal pixel disclosure."""
    candidate_limit = max(1, min(100, int(max_candidates or 40)))
    return (
        "Curate a Vintrace image selection for the goal below. Use hybrid search plus exact metadata filters, keep the "
        f"initial candidate set at or below {candidate_limit}, fetch structured metadata and existing local intelligence in batches, and request previews "
        "only for ambiguous finalists. Explain inclusion and exclusion criteria. Return stable asset IDs and reasons. "
        "If the result should be saved, edited, or exported, stop at plan_image_action and ask for approval before the "
        "matching confirmed execution lane.\n\n"
        f"Goal: {goal}\nConstraints: {constraints}"
    )


@mcp.prompt(title="Find and Import Inbound Visuals")
def inbound_visual_workflow(goal: str, preferred_source: str = "") -> str:
    """Guide a safe external-discovery-to-stable-library workflow."""
    return (
        "Build a bounded inbound visual workflow for the goal below. First call list_inbound_visual_sources and use only "
        "an operator-authorized connection. Call discover_inbound_visuals for metadata only; narrow by title, date, media "
        "kind, size, and provenance before requesting any download. Present the selected external IDs and expected managed "
        "copy count to the human. Only after approval, call import_inbound_visuals with external_download_consent=true, "
        "confirm=true, and a unique idempotency key. Poll get_image_job with job_type=inbound. Then search and analyze the "
        "new stable asset IDs locally; use bounded previews only where necessary; curate or edit non-destructively; and use "
        "the normal confirmed export/delivery lane. Never request connector credentials or expose source URLs.\n\n"
        f"Goal: {goal}\nPreferred source or constraints: {preferred_source}"
    )


def _agent_http_error_code(message: str) -> str:
    lowered = str(message or "").lower()
    if "consent" in lowered:
        return "consent_required"
    if "workspace lock" in lowered:
        return "workspace_locked"
    if "approved mcp roots" in lowered or "outside the approved" in lowered:
        return "path_out_of_scope"
    if "confirmation" in lowered or "confirm=true" in lowered:
        return "confirmation_required"
    if "indeterminate outcome" in lowered or "operator inspection" in lowered or "full result has expired" in lowered:
        return "operation_indeterminate"
    if "idempotency" in lowered:
        return "idempotency_conflict" if "already used" in lowered or "different" in lowered else "idempotency_required"
    if "operator approval token" in lowered or "operator-token" in lowered:
        return "operator_approval_required"
    if "too large" in lowered:
        return "payload_too_large"
    if "safe mode" in lowered:
        return "safe_mode_protected"
    if "not found" in lowered:
        return "not_found"
    if "catalog" in lowered or "action" in lowered:
        return "invalid_action"
    return "invalid_request"


def _agent_http_status(code: str) -> int:
    return {
        "consent_required": 412,
        "workspace_locked": 423,
        "path_out_of_scope": 403,
        "confirmation_required": 428,
        "idempotency_required": 428,
        "idempotency_conflict": 409,
        "operation_indeterminate": 409,
        "operator_approval_required": 403,
        "payload_too_large": 413,
        "safe_mode_protected": 403,
        "not_found": 404,
        "invalid_action": 422,
        "invalid_request": 400,
        "internal_error": 500,
    }.get(str(code or ""), 400)


def _agent_http_failure(exc: Exception):
    from starlette.responses import JSONResponse

    message = _redacted_exception_message(exc)
    code = _agent_http_error_code(message)
    if not isinstance(exc, (ValueError, PermissionError, FileNotFoundError)) and code == "invalid_request":
        code = "internal_error"
        message = "The agent image service could not complete the request."
    if AGENT_IMAGES is not None:
        AGENT_IMAGES.record_failure("agent_http_request", message, error_code=code)
    return JSONResponse(
        {"ok": False, "error": {"code": code, "message": message}},
        status_code=_agent_http_status(code),
        headers={"Cache-Control": "private, no-store"},
    )


async def _agent_http_json_body(request) -> dict[str, Any]:
    max_body_bytes = 1024 * 1024
    content_length = request.headers.get("content-length", "")
    try:
        if content_length and int(content_length) > max_body_bytes:
            raise ValueError("Request body is too large.")
    except ValueError as exc:
        if "too large" in str(exc):
            raise
    try:
        raw = await request.body()
        if len(raw) > max_body_bytes:
            raise ValueError("Request body is too large.")
        value = json.loads(raw)
    except ValueError as exc:
        if "too large" in str(exc):
            raise
        raise ValueError("Request body must be valid JSON.") from None
    if not isinstance(value, dict):
        raise ValueError("Request body must be a JSON object.")
    return value


async def _agent_http_response(callable_value, *, status_code: int = 200):
    from starlette.responses import JSONResponse

    try:
        result = await anyio.to_thread.run_sync(callable_value)
        safe_result = _isolate_agent_output(_redact_tool_output(result), "http")
        response_status = status_code
        if isinstance(safe_result, dict) and safe_result.get("ok") is False:
            error = safe_result.get("error", {}) if isinstance(safe_result.get("error"), dict) else {}
            response_status = _agent_http_status(str(error.get("code", "invalid_request") or "invalid_request"))
        return JSONResponse(
            safe_result,
            status_code=response_status,
            headers={"Cache-Control": "private, no-store"},
        )
    except Exception as exc:
        return _agent_http_failure(exc)


def _agent_http_invalid_response(exc: Exception):
    return _agent_http_failure(exc)


MOBILE_SESSION_COOKIE = "__Host-vintrace_mobile"
MOBILE_DEVELOPMENT_COOKIE = "vintrace_mobile_dev"


def _mobile_development_cookie_allowed(request) -> bool:
    hostname = str(getattr(request.url, "hostname", "") or "").lower()
    return env_flag("MOBILE_ALLOW_INSECURE_LOOPBACK", default=False) and hostname in {
        "localhost",
        "127.0.0.1",
        "::1",
    }


def _mobile_json_response(payload: dict[str, Any], *, status_code: int = 200):
    from starlette.responses import JSONResponse

    return JSONResponse(
        payload,
        status_code=status_code,
        headers={
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )


@mcp.custom_route("/mobile", methods=["GET"], include_in_schema=False)
async def mobile_companion_redirect(_request):
    from starlette.responses import RedirectResponse

    return RedirectResponse("/mobile/", status_code=307, headers=mobile_security_headers(document=True))


@mcp.custom_route("/mobile/{asset_path:path}", methods=["GET"], include_in_schema=False)
async def mobile_companion_asset(request):
    from starlette.responses import FileResponse, JSONResponse

    raw_path = str(request.path_params.get("asset_path", "") or "")
    try:
        asset = resolve_mobile_asset(raw_path)
    except FileNotFoundError:
        return JSONResponse(
            {"ok": False, "error": {"code": "not_found", "message": "Mobile companion asset was not found."}},
            status_code=404,
            headers=mobile_security_headers(document=True),
        )
    document = asset.name == "index.html"
    headers = mobile_security_headers(document=document)
    if not document and not re.search(r"-[A-Za-z0-9_-]{8,}\.", asset.name):
        headers["Cache-Control"] = "public, max-age=300"
    return FileResponse(asset, media_type=mobile_asset_media_type(asset), headers=headers)


@mcp.custom_route("/v1/mobile/pair", methods=["POST"], include_in_schema=True)
async def agent_http_mobile_pair(request):
    fetch_site = str(request.headers.get("sec-fetch-site", "") or "").lower()
    if fetch_site and fetch_site not in {"same-origin", "same-site", "none"}:
        return _mobile_json_response(
            {"ok": False, "error": {"code": "mobile_pairing_origin", "message": "Pairing must start from the Vintrace mobile origin."}},
            status_code=403,
        )
    try:
        body = await _agent_http_json_body(request)
        session_token, device = await anyio.to_thread.run_sync(
            lambda: exchange_mobile_pairing(
                MOBILE_ACCOUNTS_PATH or SERVICE_ACCOUNTS_PATH,
                str(body.get("pairingCode", "") or ""),
            )
        )
    except MobilePairingError as exc:
        status = 409 if exc.code == "mobile_credentials_busy" else 400
        return _mobile_json_response(
            {"ok": False, "error": {"code": exc.code, "message": str(exc)}},
            status_code=status,
        )
    except Exception:
        return _mobile_json_response(
            {"ok": False, "error": {"code": "mobile_pairing_invalid", "message": "The mobile pairing link is invalid or expired."}},
            status_code=400,
        )
    development_cookie = _mobile_development_cookie_allowed(request)
    cookie_name = MOBILE_DEVELOPMENT_COOKIE if development_cookie else MOBILE_SESSION_COOKIE
    response = _mobile_json_response(
        {
            "ok": True,
            "action": "pair_mobile_companion",
            "data": {"device": device},
            "policy": {"readOnly": True, "pixelDisclosure": False},
        }
    )
    response.set_cookie(
        cookie_name,
        session_token,
        max_age=int(device.get("expiresInSeconds", 0) or 0),
        expires=datetime.fromtimestamp(int(device.get("expiresAt", 0) or 0), tz=timezone.utc),
        path="/",
        secure=not development_cookie,
        httponly=True,
        samesite="strict",
    )
    try:
        _api().project._append_audit(
            {
                "action": "mobile_companion_paired",
                "principal_id": str(device.get("accountId", "") or "")[:160],
                "auth_type": "mobile",
                "read_only": True,
                "pixel_disclosure": False,
                "expires_at": int(device.get("expiresAt", 0) or 0),
            }
        )
    except Exception:
        pass
    return response


@mcp.custom_route("/v1/mobile/session", methods=["GET"], include_in_schema=True)
async def agent_http_mobile_session(_request):
    principal = current_agent_principal()
    if principal is None or principal.client_type != MOBILE_CLIENT_TYPE or not principal.read_only:
        return _mobile_json_response(
            {"ok": False, "error": {"code": "mobile_session_required", "message": "A paired mobile session is required."}},
            status_code=403,
        )
    current = int(time.time())
    return _mobile_json_response(
        {
            "ok": True,
            "action": "mobile_session",
            "data": {
                "device": {
                    "accountId": principal.principal_id,
                    "label": principal.display_name or "Mobile device",
                    "readOnly": True,
                    "allowPreviews": principal.has_scope("images:preview"),
                    "expiresAt": principal.expires_at,
                    "expiresInSeconds": max(0, int(principal.expires_at or current) - current),
                },
                "platformVersion": __version__,
            },
            "policy": {"readOnly": True, "pixelDisclosure": False},
        }
    )


@mcp.custom_route("/v1/mobile/logout", methods=["POST"], include_in_schema=True)
async def agent_http_mobile_logout(request):
    from starlette.responses import Response

    response = Response(status_code=204, headers={"Cache-Control": "private, no-store"})
    response.delete_cookie(MOBILE_SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    response.delete_cookie(
        MOBILE_DEVELOPMENT_COOKIE,
        path="/",
        secure=not _mobile_development_cookie_allowed(request),
        httponly=True,
        samesite="strict",
    )
    return response


@mcp.custom_route("/v1/openapi.json", methods=["GET"], include_in_schema=True)
async def agent_http_openapi(_request):
    from starlette.responses import JSONResponse

    return JSONResponse(agent_images_openapi_spec(), headers={"Cache-Control": "private, max-age=300"})


@mcp.custom_route("/.well-known/oauth-protected-resource", methods=["GET"], include_in_schema=False)
async def agent_oauth_protected_resource_metadata(_request):
    from starlette.responses import JSONResponse

    if OAUTH_RESOURCE_CONFIG is None:
        return JSONResponse({"error": "oauth_not_configured"}, status_code=404)
    return JSONResponse(
        {
            "resource": OAUTH_RESOURCE_CONFIG.resource_url,
            "authorization_servers": [OAUTH_RESOURCE_CONFIG.issuer],
            "scopes_supported": list(AGENT_SCOPES),
            "bearer_methods_supported": ["header"],
            "resource_documentation": f"{OAUTH_RESOURCE_CONFIG.resource_url.rsplit('/mcp', 1)[0]}/v1/openapi.json",
        },
        headers={"Cache-Control": "public, max-age=300"},
    )


@mcp.custom_route("/v1/health", methods=["GET"], include_in_schema=True)
async def agent_http_health(_request):
    from starlette.responses import JSONResponse

    return JSONResponse(
        {
            "ok": True,
            "service": "vintrace-agent-images",
            "apiVersion": "1.0",
            "platformVersion": __version__,
            "transport": "http",
            "openapi": "/v1/openapi.json",
            "mcp": "/mcp",
            "authentication": {
                "oauth": OAUTH_RESOURCE_CONFIG is not None,
                "serviceAccounts": SERVICE_ACCOUNTS_PATH is not None,
                "mobileAccounts": MOBILE_ACCOUNTS_PATH is not None,
                "scopes": list(AGENT_SCOPES),
            },
        }
    )


@mcp.custom_route("/v1/capabilities", methods=["GET"], include_in_schema=True)
async def agent_http_capabilities(request):
    category = str(request.query_params.get("category", "") or "")
    include_actions = str(request.query_params.get("includeActions", "true") or "true").lower() not in {"0", "false", "no"}
    return await _agent_http_response(
        lambda: _image_service().capabilities(category=category, include_actions=include_actions)
    )


@mcp.custom_route("/v1/library", methods=["GET"], include_in_schema=True)
async def agent_http_library(request):
    include_health = str(request.query_params.get("includeHealth", "false") or "false").lower() in {"1", "true", "yes"}
    return await _agent_http_response(lambda: _image_service().library_overview(include_health=include_health))


@mcp.custom_route("/v1/changes", methods=["GET"], include_in_schema=True)
async def agent_http_changes(request):
    try:
        after_seq = int(request.query_params.get("afterSeq", 0) or 0)
        limit = int(request.query_params.get("limit", 50) or 50)
        if after_seq < 0:
            raise ValueError("afterSeq must be zero or greater.")
        if limit < 1:
            raise ValueError("limit must be one or greater.")
    except (TypeError, ValueError) as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().changes(after_seq=after_seq, limit=limit)
    )


@mcp.custom_route("/v1/connectors", methods=["GET"], include_in_schema=True)
async def agent_http_inbound_connectors(request):
    provider = str(request.query_params.get("provider", "") or "").strip()
    action = "list_inbound_connector_sources" if provider else "inbound_connector_catalog"
    return await _agent_http_response(
        lambda: _image_service().run(action=action, payload={"provider": provider} if provider else {}, lane="read")
    )


@mcp.custom_route("/v1/connectors/{provider}/{connection_id}/discover", methods=["POST"], include_in_schema=True)
async def agent_http_discover_inbound(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().run(
            action="preview_inbound_connector",
            payload={
                "provider": str(request.path_params.get("provider", "") or ""),
                "connectionId": str(request.path_params.get("connection_id", "") or ""),
                "itemLimit": body.get("itemLimit", 1000),
                "sampleLimit": body.get("sampleLimit", 40),
                "timeBudgetMs": body.get("timeBudgetMs", 2000),
            },
            lane="read",
        )
    )


async def _agent_http_run_inbound_job(request, action: str):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    payload: dict[str, Any] = {
        "provider": str(request.path_params.get("provider", "") or ""),
        "connectionId": str(request.path_params.get("connection_id", "") or ""),
        "explicitExternalDownloadConsent": bool(body.get("externalDownloadConsent", False)),
        "storageMode": "managed",
    }
    if isinstance(body.get("externalIds"), list):
        payload["externalIds"] = body["externalIds"]
    return await _agent_http_response(
        lambda: _image_service().run(
            action=action,
            payload=payload,
            lane="write",
            confirm=bool(body.get("confirm", False)),
            idempotency_key=str(body.get("idempotencyKey", "") or ""),
        )
    )


@mcp.custom_route("/v1/connectors/{provider}/{connection_id}/import", methods=["POST"], include_in_schema=True)
async def agent_http_import_inbound(request):
    return await _agent_http_run_inbound_job(request, "import_inbound_connector")


@mcp.custom_route("/v1/connectors/{provider}/{connection_id}/sync", methods=["POST"], include_in_schema=True)
async def agent_http_sync_inbound(request):
    return await _agent_http_run_inbound_job(request, "sync_inbound_connector")


@mcp.custom_route("/v1/search", methods=["POST"], include_in_schema=True)
async def agent_http_search(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().search(
            query=str(body.get("query", "") or ""),
            mode=str(body.get("mode", "hybrid") or "hybrid"),
            scope=str(body.get("scope", "all") or "all"),
            filters=body.get("filters") if isinstance(body.get("filters"), dict) else {},
            sort=str(body.get("sort", "newest") or "newest"),
            offset=int(body.get("offset", 0) or 0),
            limit=int(body.get("limit", 50) or 50),
        )
    )


@mcp.custom_route("/v1/assets/fetch", methods=["POST"], include_in_schema=True)
async def agent_http_assets_fetch(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    asset_ids = body.get("assetIds", body.get("asset_ids", []))
    return await _agent_http_response(lambda: _image_service().fetch_assets(asset_ids))


@mcp.custom_route("/v1/assets/analyze", methods=["POST"], include_in_schema=True)
async def agent_http_assets_analyze(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    asset_ids = body.get("assetIds", body.get("asset_ids", []))
    capabilities = body.get("capabilities")
    if capabilities is not None and not isinstance(capabilities, list):
        return _agent_http_invalid_response(ValueError("capabilities must be a list."))
    return await _agent_http_response(lambda: _image_service().analyze_assets(asset_ids, capabilities))


@mcp.custom_route("/v1/assets/{asset_id}", methods=["GET"], include_in_schema=True)
async def agent_http_asset(request):
    asset_id = str(request.path_params.get("asset_id", "") or "")

    def fetch_one():
        result = _image_service().fetch_assets([asset_id])
        if not result.get("data", {}).get("items"):
            raise ValueError("Image asset was not found in the active workspace.")
        return result

    return await _agent_http_response(fetch_one)


@mcp.custom_route("/v1/assets/{asset_id}/preview", methods=["GET"], include_in_schema=True)
async def agent_http_asset_preview(request):
    from starlette.responses import JSONResponse, Response

    try:
        asset_id = str(request.path_params.get("asset_id", "") or "")
        max_dimension = int(request.query_params.get("maxDimension", 1536) or 1536)
        max_bytes = int(request.query_params.get("maxBytes", 4 * 1024 * 1024) or 4 * 1024 * 1024)
        result = await anyio.to_thread.run_sync(
            lambda: _image_service().preview(asset_id, max_dimension=max_dimension, max_bytes=max_bytes)
        )
        metadata = {key: value for key, value in result.items() if key != "data"}
        await anyio.to_thread.run_sync(
            lambda: _image_service()._envelope("get_image_preview", metadata, pixel_disclosure=True)
        )
        return Response(
            content=result["data"],
            media_type=str(result.get("mimeType", "image/jpeg")),
            headers={
                "X-Vintrace-Asset-Id": str(result.get("assetId", "")),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )
    except Exception as exc:
        return _agent_http_failure(exc)


@mcp.custom_route("/v1/actions/plan", methods=["POST"], include_in_schema=True)
async def agent_http_action_plan(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().plan(
            str(body.get("action", "") or ""),
            body.get("payload") if isinstance(body.get("payload"), dict) else {},
        )
    )


@mcp.custom_route("/v1/actions/run", methods=["POST"], include_in_schema=True)
async def agent_http_action_run(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().run(
            action=str(body.get("action", "") or ""),
            payload=body.get("payload") if isinstance(body.get("payload"), dict) else {},
            lane=str(body.get("lane", "read") or "read"),
            confirm=bool(body.get("confirm", False)),
            idempotency_key=str(body.get("idempotencyKey", body.get("idempotency_key", "")) or ""),
            operator_token=str(body.get("operatorToken", body.get("operator_token", "")) or ""),
        )
    )


@mcp.custom_route("/v1/jobs/{job_type}/{job_id}", methods=["GET"], include_in_schema=True)
async def agent_http_job(request):
    return await _agent_http_response(
        lambda: _image_service().job(
            str(request.path_params.get("job_type", "") or ""),
            str(request.path_params.get("job_id", "") or ""),
        )
    )


@mcp.custom_route("/v1/jobs/{job_type}", methods=["GET"], include_in_schema=True)
async def agent_http_jobs(request):
    return await _agent_http_response(
        lambda: _image_service().job(str(request.path_params.get("job_type", "") or ""), "")
    )


@mcp.custom_route("/v1/activity", methods=["GET"], include_in_schema=True)
async def agent_http_activity(request):
    return await _agent_http_response(
        lambda: _image_service().activity(
            action=str(request.query_params.get("action", "") or ""),
            status=str(request.query_params.get("status", "") or ""),
            offset=int(request.query_params.get("offset", 0) or 0),
            limit=int(request.query_params.get("limit", 50) or 50),
        )
    )


@mcp.custom_route("/v1/events", methods=["GET"], include_in_schema=True)
async def agent_http_events(request):
    """Authenticated SSE subscription for path-free agent activity events."""
    from starlette.responses import StreamingResponse

    try:
        _require_mcp_consent()
        cursor = max(0, int(request.query_params.get("afterSeq", 0) or 0))
    except Exception as exc:
        return _agent_http_failure(exc)

    async def stream():
        nonlocal cursor
        last_heartbeat = anyio.current_time()
        yield "retry: 3000\n\n"
        while not await request.is_disconnected():
            try:
                audit = await anyio.to_thread.run_sync(
                    lambda: _api().project.audit_events(limit=500, offset=0)
                )
            except Exception as exc:
                payload = {"ok": False, "error": {"code": "stream_closed", "message": _redacted_exception_message(exc)}}
                yield f"event: error\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                return
            events = [
                event
                for event in audit.get("events", [])
                if isinstance(event, dict)
                and int(event.get("seq", 0) or 0) > cursor
                and str(event.get("action", "") or "") in {"agent_tool_result", "agent_tool_failure"}
            ]
            for event in sorted(events, key=lambda row: int(row.get("seq", 0) or 0)):
                seq = int(event.get("seq", 0) or 0)
                payload = {
                    "eventId": f"activity_{seq}",
                    "seq": seq,
                    "at": str(event.get("at", "") or ""),
                    "requestId": str(event.get("request_id", "") or ""),
                    "action": str(event.get("agent_action", "") or ""),
                    "status": str(event.get("status", "") or ""),
                    "approvalState": str(event.get("approval_state", "") or ""),
                    "readOnly": bool(event.get("read_only", True)),
                    "destructive": bool(event.get("destructive", False)),
                    "pixelDisclosure": bool(event.get("pixel_disclosure", False)),
                    "replayed": bool(event.get("replayed", False)),
                    "jobId": str(event.get("job_id", "") or ""),
                    "operationId": str(event.get("operation_id", "") or ""),
                    "errorCode": str(event.get("error_code", "") or ""),
                    "principalId": str(event.get("principal_id", "") or ""),
                    "authType": str(event.get("auth_type", "") or ""),
                }
                yield f"id: {seq}\nevent: agent.activity\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                cursor = max(cursor, seq)
                last_heartbeat = anyio.current_time()
            if anyio.current_time() - last_heartbeat >= 15:
                yield ": heartbeat\n\n"
                last_heartbeat = anyio.current_time()
            await anyio.sleep(1)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "private, no-store",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@mcp.custom_route("/v1/operations", methods=["GET"], include_in_schema=True)
async def agent_http_operations(request):
    raw_kinds = str(request.query_params.get("kinds", "") or "")
    return await _agent_http_response(
        lambda: _image_service().operations(
            kinds=[value.strip() for value in raw_kinds.split(",") if value.strip()],
            status=str(request.query_params.get("status", "") or ""),
            offset=int(request.query_params.get("offset", 0) or 0),
            limit=int(request.query_params.get("limit", 50) or 50),
        )
    )


@mcp.custom_route("/v1/operations/{operation_id}/manifest", methods=["GET"], include_in_schema=True)
async def agent_http_operation_manifest(request):
    return await _agent_http_response(
        lambda: _image_service().operation_manifest(str(request.path_params.get("operation_id", "") or ""))
    )


@mcp.custom_route("/v1/operations/{operation_id}/outputs/{output_id}", methods=["GET"], include_in_schema=True)
async def agent_http_operation_output(request):
    from starlette.responses import Response

    try:
        result = await anyio.to_thread.run_sync(
            lambda: _image_service().operation_output(
                str(request.path_params.get("operation_id", "") or ""),
                str(request.path_params.get("output_id", "") or ""),
            )
        )
        descriptor = result.get("descriptor", {}) if isinstance(result, dict) else {}
        return Response(
            content=result["data"],
            media_type=str(descriptor.get("mimeType", "application/octet-stream") or "application/octet-stream"),
            headers={
                "X-Vintrace-Operation-Id": str(request.path_params.get("operation_id", "") or ""),
                "X-Vintrace-Output-Id": str(request.path_params.get("output_id", "") or ""),
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )
    except Exception as exc:
        return _agent_http_failure(exc)


@mcp.custom_route("/v1/operations/{operation_id}", methods=["GET"], include_in_schema=True)
async def agent_http_operation(request):
    return await _agent_http_response(
        lambda: _image_service().operation(str(request.path_params.get("operation_id", "") or ""))
    )


@mcp.custom_route("/v1/recipes", methods=["GET", "POST"], include_in_schema=True)
async def agent_http_recipes(request):
    if request.method == "GET":
        include_steps = str(request.query_params.get("includeSteps", "false") or "false").lower() in {"1", "true", "yes"}
        return await _agent_http_response(
            lambda: _image_service().recipes(include_steps=include_steps)
        )
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().save_recipe(
            recipe_id=str(body.get("recipeId", "") or ""),
            recipe=body.get("recipe") if isinstance(body.get("recipe"), dict) else {},
            confirm=bool(body.get("confirm", False)),
            idempotency_key=str(body.get("idempotencyKey", "") or ""),
        )
    )


@mcp.custom_route("/v1/recipes/plan", methods=["POST"], include_in_schema=True)
async def agent_http_recipe_plan(request):
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().plan_recipe(
            str(body.get("recipeId", "") or ""),
            body.get("inputs") if isinstance(body.get("inputs"), dict) else {},
        )
    )


@mcp.custom_route("/v1/recipes/{recipe_id}", methods=["GET", "DELETE"], include_in_schema=True)
async def agent_http_recipe(request):
    recipe_id = str(request.path_params.get("recipe_id", "") or "")
    if request.method == "GET":
        return await _agent_http_response(lambda: _image_service().recipe(recipe_id))
    try:
        body = await _agent_http_json_body(request)
    except Exception as exc:
        return _agent_http_invalid_response(exc)
    return await _agent_http_response(
        lambda: _image_service().delete_recipe(
            recipe_id,
            confirm=bool(body.get("confirm", False)),
            idempotency_key=str(body.get("idempotencyKey", "") or ""),
        )
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Vintrace MCP server")
    parser.add_argument("--workspace", default=None, help="Workspace directory. Defaults to VINTRACE_WORKSPACE or CROSSAGE_WORKSPACE, then the desktop active workspace, then vintrace_project.")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--tool-profile",
        choices=["full", "images"],
        default="full",
        help=(
            "MCP tool surface. 'images' exposes the compact stable-ID image front doors while preserving all "
            "163 cataloged image actions behind plan/run tools; 'full' also exposes face-review and operator tools."
        ),
    )
    parser.add_argument(
        "--allow-remote-http",
        action="store_true",
        help="Allow Streamable HTTP to bind to non-localhost interfaces. Use only behind your own auth boundary.",
    )
    return parser.parse_args()


def _bearer_token_ok(authorization_header: str, token: str) -> bool:
    # MCP-01: constant-time check of an `Authorization: Bearer <token>` header.
    if not token:
        return False
    scheme, _, presented = (authorization_header or "").partition(" ")
    if scheme.lower() != "bearer":
        return False
    return hmac.compare_digest(presented.strip().encode("utf-8"), token.encode("utf-8"))


class _RateLimiter:
    """Token-bucket limiter with an injectable clock (so the logic is unit-testable)."""

    def __init__(self, capacity: float, refill_per_sec: float) -> None:
        self.capacity = max(1.0, float(capacity))
        self.refill_per_sec = max(0.0, float(refill_per_sec))
        self._tokens = self.capacity
        self._last: float | None = None

    def allow(self, now: float) -> bool:
        if self._last is None:
            self._last = now
        elapsed = max(0.0, now - self._last)
        self._last = now
        self._tokens = min(self.capacity, self._tokens + elapsed * self.refill_per_sec)
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False


def _rate_limit_settings() -> tuple[float, float, int]:
    # MCP-08: env-tunable flood protection for the HTTP host. Rate 0 disables rate limiting,
    # max-concurrency 0 disables the concurrency cap.
    def _num(name: str, default: float) -> float:
        raw = env_value(name)
        if raw is None or str(raw).strip() == "":
            return default
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    rate = max(0.0, _num("MCP_RATE_LIMIT", 20.0))  # requests/sec per client
    burst = max(1.0, _num("MCP_RATE_BURST", max(rate * 2.0, 1.0)))
    max_concurrency = max(0, int(_num("MCP_MAX_CONCURRENCY", 8.0)))
    return (rate, burst, max_concurrency)


def _tool_required_scope(tool_name: str) -> str:
    name = str(tool_name or "").strip()
    if name in {"get_image_preview"}:
        return "images:preview"
    if name in {"get_agent_activity", "read_audit_events", "audit_chain_status"}:
        return "events:read"
    tool = getattr(getattr(mcp, "_tool_manager", None), "_tools", {}).get(name)
    annotations = getattr(tool, "annotations", None)
    if bool(getattr(annotations, "destructiveHint", False)):
        return "images:destructive"
    if bool(getattr(annotations, "readOnlyHint", False)):
        return "images:read"
    return "images:write"


def _mcp_request_requirements(payload: Any) -> list[tuple[str | None, str]]:
    rows = payload if isinstance(payload, list) else [payload]
    requirements: list[tuple[str | None, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        method = str(row.get("method", "") or "")
        params = row.get("params", {}) if isinstance(row.get("params"), dict) else {}
        if method == "tools/call":
            tool_name = str(params.get("name", "") or "")
            requirements.append((_tool_required_scope(tool_name), tool_name))
        elif method == "resources/read":
            uri = str(params.get("uri", "") or "")
            if uri.startswith(("vintrace://agent/outputs/", "vintrace://images/previews/")):
                requirements.append(("images:preview", "get_image_operation"))
            elif uri in {"vintrace://audit", "crossage://audit", "vintrace://agent/activity"}:
                requirements.append(("events:read", "get_agent_activity"))
            else:
                requirements.append(("images:read", "resources/read"))
        elif method == "prompts/get":
            requirements.append(("images:read", "prompts/get"))
        elif method == "tasks/cancel":
            requirements.append(("images:write", "tasks/cancel"))
        elif method in {"tasks/get", "tasks/list", "tasks/result"}:
            requirements.append(("images:read", method))
        elif method in {"initialize", "notifications/initialized", "ping", "tools/list", "resources/list", "resources/templates/list", "prompts/list"}:
            requirements.append((None, method))
        elif method:
            requirements.append(("images:read", method))
    return requirements


def _http_request_requirements(path: str, method: str, payload: Any) -> list[tuple[str | None, str]]:
    clean_path = str(path or "")
    clean_method = str(method or "GET").upper()
    if clean_path.startswith("/.well-known/oauth-protected-resource"):
        return []
    if clean_path == "/v1/mobile/session":
        return [("images:read", "mobile_session")]
    if clean_path in {"/v1/mobile/pair", "/v1/mobile/logout"} or clean_path == "/mobile" or clean_path.startswith("/mobile/"):
        return []
    if clean_path == "/mcp":
        return _mcp_request_requirements(payload)
    if clean_path in {"/v1/health", "/v1/openapi.json"}:
        return [(None, clean_path)]
    if clean_path == "/v1/events" or clean_path == "/v1/activity":
        return [("events:read", "get_agent_activity")]
    if clean_path == "/v1/changes":
        return [("images:read", "fetch_image_assets")]
    if clean_path == "/v1/connectors":
        return [("images:read", "list_inbound_visual_sources")]
    if clean_path.startswith("/v1/connectors/"):
        if clean_path.endswith("/discover"):
            return [("images:read", "discover_inbound_visuals")]
        return [("images:write", "import_inbound_visuals" if clean_path.endswith("/import") else "sync_inbound_visuals")]
    if "/preview" in clean_path or "/outputs/" in clean_path:
        return [("images:preview", "get_image_preview" if "/preview" in clean_path else "get_image_operation")]
    if clean_path == "/v1/actions/run":
        body = payload if isinstance(payload, dict) else {}
        lane = str(body.get("lane", "read") or "read")
        tool_name = {
            "read": "run_image_read_action",
            "write": "run_image_write_action",
            "destructive": "run_destructive_image_action",
        }.get(lane, "run_image_read_action")
        return [(_tool_required_scope(tool_name), tool_name)]
    if clean_path == "/v1/actions/plan":
        return [("images:read", "plan_image_action")]
    if clean_path == "/v1/recipes" and clean_method == "POST":
        return [("images:write", "save_image_recipe")]
    if clean_path.startswith("/v1/recipes/") and clean_method == "DELETE":
        return [("images:destructive", "delete_image_recipe")]
    if clean_path == "/v1/recipes/plan":
        return [("images:read", "plan_image_recipe")]
    if clean_path == "/v1/recipes" or clean_path.startswith("/v1/recipes/"):
        return [("images:read", "get_image_recipe")]
    if clean_path == "/v1/operations":
        return [("images:read", "list_image_operations")]
    if clean_path.startswith("/v1/operations/"):
        return [("images:read", "get_image_operation")]
    endpoint_tools = {
        "/v1/capabilities": "list_image_capabilities",
        "/v1/library": "get_image_library_overview",
        "/v1/search": "search_images",
        "/v1/assets/fetch": "fetch_image_assets",
        "/v1/assets/analyze": "analyze_image_assets",
    }
    return [("images:read", endpoint_tools.get(clean_path, "fetch_image_assets"))]


def _mobile_http_request_allowed(path: str, method: str) -> bool:
    clean_path = str(path or "")
    clean_method = str(method or "GET").upper()
    if clean_method == "GET" and clean_path in {
        "/v1/mobile/session",
        "/v1/capabilities",
        "/v1/library",
        "/v1/changes",
    }:
        return True
    if clean_method == "POST" and clean_path in {
        "/v1/search",
        "/v1/assets/fetch",
        "/v1/assets/analyze",
    }:
        return True
    if clean_method == "GET" and re.fullmatch(r"/v1/assets/[^/]{1,200}(?:/preview)?", clean_path):
        return True
    return False


def _request_cookie_token(scope: dict[str, Any]) -> str:
    raw_cookie = next(
        (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"cookie"),
        "",
    )
    if not raw_cookie:
        return ""
    try:
        cookies = SimpleCookie()
        cookies.load(raw_cookie)
    except Exception:
        return ""
    preferred = cookies.get(MOBILE_SESSION_COOKIE)
    if preferred is not None:
        return str(preferred.value or "")
    if env_flag("MOBILE_ALLOW_INSECURE_LOOPBACK", default=False):
        development = cookies.get(MOBILE_DEVELOPMENT_COOKIE)
        if development is not None:
            return str(development.value or "")
    return ""


class _ScopedAuthMiddleware:
    def __init__(self, app, verifier: AgentTokenVerifier) -> None:
        self.app = app
        self.verifier = verifier

    async def _reply(self, send, *, status: int, code: str, message: str, required_scope: str = "") -> None:
        resource_metadata = ""
        if OAUTH_RESOURCE_CONFIG is not None:
            parsed_resource = re.match(r"^(https?://[^/]+)", OAUTH_RESOURCE_CONFIG.resource_url)
            if parsed_resource:
                resource_metadata = f"{parsed_resource.group(1)}/.well-known/oauth-protected-resource"
        challenge_error = "invalid_token" if code == "unauthorized" else code
        challenge = [f'error="{challenge_error}"', f'error_description="{message}"']
        if required_scope:
            challenge.append(f'scope="{required_scope}"')
        if resource_metadata:
            challenge.append(f'resource_metadata="{resource_metadata}"')
        body = json.dumps({"ok": False, "error": {"code": code, "message": message}}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": status,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"www-authenticate", f"Bearer {', '.join(challenge)}".encode("utf-8")),
                    (b"cache-control", b"private, no-store"),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        path = str(scope.get("path", "") or "")
        if (
            path.startswith("/.well-known/oauth-protected-resource")
            or path == "/mobile"
            or path.startswith("/mobile/")
            or path in {"/v1/mobile/pair", "/v1/mobile/logout"}
        ):
            await self.app(scope, receive, send)
            return
        authorization = next(
            (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"authorization"),
            "",
        )
        scheme, _, raw_token = authorization.partition(" ")
        auth_source = "bearer"
        if scheme.lower() != "bearer" or not raw_token.strip():
            raw_token = _request_cookie_token(scope)
            auth_source = "mobile-cookie"
        if not raw_token.strip():
            await self._reply(send, status=401, code="unauthorized", message="A valid Vintrace bearer token is required.")
            return
        try:
            principal = await self.verifier.verify_principal(raw_token.strip())
        except ValueError as exc:
            await self._reply(send, status=503, code="auth_configuration_error", message=str(exc))
            return
        if principal is None:
            await self._reply(send, status=401, code="unauthorized", message="The Vintrace bearer token is invalid or expired.")
            return
        if auth_source == "mobile-cookie" and principal.client_type != MOBILE_CLIENT_TYPE:
            await self._reply(send, status=401, code="unauthorized", message="The Vintrace mobile session is invalid or expired.")
            return

        body = b""
        replay_receive = receive
        content_length = next(
            (value.decode("latin-1") for key, value in scope.get("headers", []) if key.lower() == b"content-length"),
            "0",
        )
        try:
            declared_length = max(0, int(content_length or 0))
        except ValueError:
            declared_length = 0
        if (
            str(scope.get("method", "GET") or "GET").upper() in {"POST", "PUT", "PATCH", "DELETE"}
            and declared_length <= 1024 * 1024
        ):
            chunks: list[bytes] = []
            more = True
            while more:
                message = await receive()
                if message.get("type") != "http.request":
                    continue
                chunks.append(message.get("body", b""))
                more = bool(message.get("more_body", False))
            body = b"".join(chunks)
            sent = False

            async def replay_receive():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

        payload: Any = None
        if body and len(body) <= 1024 * 1024:
            try:
                payload = json.loads(body)
            except ValueError:
                payload = None
        requirements = _http_request_requirements(path, str(scope.get("method", "GET")), payload)
        if principal.client_type == MOBILE_CLIENT_TYPE and not _mobile_http_request_allowed(
            path,
            str(scope.get("method", "GET")),
        ):
            await self._reply(
                send,
                status=403,
                code="mobile_read_only",
                message="Mobile companions can use only the dedicated read-only library endpoints.",
            )
            return
        for required_scope, tool_name in requirements:
            if principal.read_only and required_scope in {"images:write", "images:destructive", "images:admin"}:
                await self._reply(
                    send,
                    status=403,
                    code="read_only_principal",
                    message="This credential is permanently read-only.",
                    required_scope=required_scope,
                )
                return
            if required_scope and not principal.has_scope(required_scope):
                await self._reply(
                    send,
                    status=403,
                    code="insufficient_scope",
                    message=f"This operation requires {required_scope}.",
                    required_scope=required_scope,
                )
                return
            if principal.allowed_tools and tool_name and tool_name not in principal.allowed_tools:
                await self._reply(
                    send,
                    status=403,
                    code="tool_not_granted",
                    message=f"The service account is not granted tool {tool_name}.",
                    required_scope=required_scope or "",
                )
                return
        context_token = set_current_agent_principal(principal)
        scope["vintrace.agent_principal"] = principal
        try:
            await self.app(scope, replay_receive, send)
        finally:
            reset_current_agent_principal(context_token)


def _build_bearer_auth_app(token: str):
    # MCP-01: wrap FastMCP's streamable_http_app() (a Starlette app) so the
    # operator token is enforced on EVERY request, not just at startup. Returns
    # the wrapped app (kept separate from uvicorn.run so it is unit-testable).
    import asyncio
    import time

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse

    rate, burst, max_concurrency = _rate_limit_settings()

    class RateLimitMiddleware(BaseHTTPMiddleware):
        # MCP-08: per-client token bucket + a global concurrency cap so a single agent
        # cannot flood the highest-risk (biometric) tool surface.
        def __init__(self, app) -> None:
            super().__init__(app)
            self._buckets: dict[str, _RateLimiter] = {}
            self._semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency > 0 else None

        async def dispatch(self, request, call_next):
            if rate > 0:
                client = request.client.host if request.client else "unknown"
                bucket = self._buckets.get(client)
                if bucket is None:
                    bucket = _RateLimiter(burst, rate)
                    self._buckets[client] = bucket
                if not bucket.allow(time.monotonic()):
                    return JSONResponse(
                        {
                            "ok": False,
                            "error": {
                                "code": "rate_limited",
                                "message": "Too many requests; retry after the advertised delay.",
                            },
                        },
                        status_code=429,
                        headers={"Retry-After": "1", "Cache-Control": "private, no-store"},
                    )
            if self._semaphore is not None:
                async with self._semaphore:
                    return await call_next(request)
            return await call_next(request)

    app = mcp.streamable_http_app()
    verifier = AgentTokenVerifier(
        local_token=token,
        service_accounts_path=SERVICE_ACCOUNTS_PATH,
        mobile_accounts_path=MOBILE_ACCOUNTS_PATH,
        oauth=OAUTH_RESOURCE_CONFIG,
    )
    app.add_middleware(_ScopedAuthMiddleware, verifier=verifier)
    # Added last => outermost: rate-limiting runs before auth, capping floods (incl. auth brute force).
    app.add_middleware(RateLimitMiddleware)
    return app


def _serve_http_with_bearer_auth(host: str, port: int, token: str) -> None:
    import uvicorn

    uvicorn.run(_build_bearer_auth_app(token), host=host, port=port, log_level="warning")


def run_mcp_server(
    workspace: Path | str | None = None,
    transport: Literal["stdio", "streamable-http"] = "stdio",
    host: str = "127.0.0.1",
    port: int = 8765,
    allow_remote_http: bool = False,
    tool_profile: Literal["full", "images"] = "full",
) -> None:
    if workspace:
        _set_workspace_root(Path(workspace))
    if tool_profile == "images":
        registered = getattr(getattr(mcp, "_tool_manager", None), "_tools", {})
        for tool_name in tuple(registered):
            if tool_name not in IMAGE_AGENT_TOOL_NAMES:
                mcp.remove_tool(tool_name)
    if transport == "streamable-http":
        # MCP-01: the HTTP transport exposes the full biometric tool surface, so
        # require an explicit operator token (fail closed — no accidental open
        # HTTP server) AND validate it per request via Bearer auth below.
        token = str(env_value("MCP_TOKEN") or "")
        verifier = AgentTokenVerifier(
            local_token=token,
            service_accounts_path=SERVICE_ACCOUNTS_PATH,
            mobile_accounts_path=MOBILE_ACCOUNTS_PATH,
            oauth=OAUTH_RESOURCE_CONFIG,
        )
        if not verifier.configured():
            raise ValueError(
                "Streamable HTTP MCP requires authentication. Set VINTRACE_MCP_TOKEN, configure "
                "VINTRACE_MCP_SERVICE_ACCOUNTS_FILE, or configure the VINTRACE_MCP_OAUTH_* resource-server "
                "settings. Use stdio for the unauthenticated local transport."
            )
        verifier.validate_configuration()
        local_hosts = {"127.0.0.1", "localhost", "::1", "[::1]"}
        if host not in local_hosts and not allow_remote_http:
            raise ValueError("Streamable HTTP MCP is localhost-only unless --allow-remote-http is set.")
        mcp.settings.host = host
        mcp.settings.port = port
        try:
            _serve_http_with_bearer_auth(host, port, token)
        except KeyboardInterrupt:
            sys.exit(0)
        return
    try:
        mcp.run(transport=transport)
        if transport == "stdio":
            os._exit(0)
    except BrokenPipeError:
        sys.exit(0)
    except ValueError as exc:
        if "closed file" in str(exc):
            sys.exit(0)
        raise
    except KeyboardInterrupt:
        sys.exit(0)


def main() -> None:
    args = parse_args()
    run_mcp_server(
        workspace=args.workspace,
        transport=args.transport,
        host=args.host,
        port=args.port,
        allow_remote_http=args.allow_remote_http,
        tool_profile=args.tool_profile,
    )


if __name__ == "__main__":
    main()

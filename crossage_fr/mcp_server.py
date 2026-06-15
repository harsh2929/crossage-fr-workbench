from __future__ import annotations

from pathlib import Path
import argparse
import functools
import hmac
import json
import os
import re
import sys
from typing import Any, Literal

from mcp.server.fastmcp import Context, FastMCP

from crossage_fr import __version__
from crossage_fr.api_server import DesktopApi
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS
from crossage_fr.ingest.safety import assess_image_safety
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, probe_video
from crossage_fr.runtime_env import env_value
from crossage_fr.workspace_registry import resolve_workspace


AgeBucket = Literal["child", "adolescent", "adult", "unknown"]
ReviewStatus = Literal["accepted", "rejected", "uncertain", "pending"]

WORKSPACE = resolve_workspace(os.environ.get("VINTRACE_WORKSPACE") or os.environ.get("CROSSAGE_WORKSPACE"))
API: DesktopApi | None = None

mcp = FastMCP(
    "Vintrace",
    log_level="WARNING",
    instructions=(
        "Consent-gated, review-first tools for Vintrace. "
        "Use resources for context, tools for enrollment/scanning/review actions, "
        "and keep Safe Mode enabled unless a human operator explicitly changes it."
    ),
)


def _api() -> DesktopApi:
    global API
    _assert_unlocked()  # MCP-05: gate all backend access (tools + resources) on the lock.
    if API is None:
        API = DesktopApi(WORKSPACE, actor="mcp")
    return API


def _set_workspace_root(path: Path) -> None:
    global API, WORKSPACE
    WORKSPACE = path.expanduser().resolve()
    API = None


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
        "safeModeThreshold": state["config"]["safeModeThreshold"],
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
    "scope",
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
        or (len(text) >= 3 and text[1] == ":" and text[2] in {"/", "\\"})
        or text.startswith("~")
    )


# MCP-04 (embedded-path leak): _looks_like_path/_redacted_path only catch a value
# that IS a path. Biometric paths/filenames also leak *inside* free-text fields —
# e.g. scanHistory errorSamples `f"{name}: {exc}"` where exc embeds an absolute
# path, or audit message/detail. These masks redact absolute paths AND media
# filenames wherever they appear in a string.
_EMBEDDED_PATH_RE = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\|~?/)[^\s'\"<>|,;]+")
_MEDIA_EXTS = sorted({ext.lstrip(".").lower() for ext in (set(IMAGE_EXTENSIONS) | set(VIDEO_EXTENSIONS)) if ext})
_MEDIA_NAME_RE = re.compile(
    r"[\w\-.]+\.(?:" + "|".join(re.escape(ext) for ext in _MEDIA_EXTS) + r")",
    re.IGNORECASE,
)


def _scrub_text(value: str, *, mask_filenames: bool = True) -> str:
    if not value:
        return value
    masked = _EMBEDDED_PATH_RE.sub("[hidden]", value)
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
# Keys for paths the agent itself requested as an output/destination (export
# files, backup zips, a restore target). These are preserved so legitimate
# export/restore workflows keep working; everything else that looks like an
# absolute path is redacted.
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
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, child in value.items():
            key_text = str(key)
            key_lower = key_text.lower()
            if key_text in _PRESERVE_OUTPUT_PATH_KEYS:
                result[key_text] = child  # agent-requested destination; preserved.
            elif key_lower.endswith(("path", "paths", "url")) or key_text in {"workspace", "root", "scope"}:
                if isinstance(child, list):
                    result[key_text] = [_redacted_path(item, keep_name=False) for item in child[:50]]
                else:
                    result[key_text] = _redacted_path(child, keep_name=False)
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
    if not _api().consent_on_file:
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


def safe_tool(*tool_args: Any, **tool_kwargs: Any):
    # MCP-04 / MCP-05: register a tool whose every return value has biometric
    # source paths redacted and which honors the workspace lock — centrally, so
    # no individual tool can forget.
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*call_args: Any, **call_kwargs: Any):
            _assert_unlocked()
            return _redact_tool_output(fn(*call_args, **call_kwargs))

        return mcp.tool(*tool_args, **tool_kwargs)(wrapper)

    return decorator


def _agent_state() -> dict[str, Any]:
    return _api().state(preview_create_budget=0, candidate_limit=500)


def _call(command: str, params: dict[str, Any] | None = None, progress: Any | None = None) -> Any:
    return _api().handle(command, params or {}, progress=progress)


def _confirmed(value: bool, action: str) -> None:
    if not value:
        raise ValueError(f"Set confirm=True to {action}.")


def _progress_reporter(ctx: Context):
    def progress(payload: dict[str, Any]) -> None:
        total = max(int(payload.get("total") or 0), 1)
        processed = int(payload.get("processed") or 0)
        phase = str(payload.get("phase", "scanning")).replace("_", " ")
        current_path = str(payload.get("current_path", ""))
        current_name = Path(current_path).name if current_path else ""
        message = f"{phase}: {current_name}" if current_name else phase
        ctx.report_progress(float(processed), float(total), message=message)

    return progress


@mcp.resource("vintrace://state", mime_type="application/json")
@mcp.resource("crossage://state", mime_type="application/json")
def state_resource() -> str:
    """Redacted project state for agent context, including counts, config, references, and candidates."""
    # MCP-04 (resources): hide basenames too — filenames frequently encode names/dates.
    return _json(_agent_safe_value(_agent_state(), keep_path_names=False))


@mcp.resource("vintrace://summary", mime_type="application/json")
@mcp.resource("crossage://summary", mime_type="application/json")
def summary_resource() -> str:
    """Compact project summary for deciding which MCP tools to call next."""
    return _json(_agent_safe_value(_state_summary(_agent_state()), keep_path_names=False))


@mcp.resource("vintrace://references", mime_type="application/json")
@mcp.resource("crossage://references", mime_type="application/json")
def references_resource() -> str:
    """Enrolled reference faces grouped by person and age bucket, with local paths hidden."""
    state = _agent_state()
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for ref in state["references"]:
        grouped.setdefault(ref["personName"], {}).setdefault(ref["ageBucket"], []).append(ref)
    return _json(_agent_safe_value(grouped, keep_path_names=False))


@mcp.resource("vintrace://candidates", mime_type="application/json")
@mcp.resource("crossage://candidates", mime_type="application/json")
def candidates_resource() -> str:
    """Current review candidates with statuses and scores, with local paths and hashes hidden."""
    return _json(_agent_safe_value(_agent_state()["candidates"], keep_path_names=False))


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
    """Agent operating guide for consent, Safe Mode, and review-first workflows."""
    return (
        "# Vintrace Agent Guide\n\n"
        "- This system is review-first. Do not claim autonomous identification.\n"
        "- Call `mark_consent(confirmed=True, confirm=True)` before enrollment or scanning.\n"
        "- Prefer `enroll_age_reference_set` when child/adolescent/adult references exist.\n"
        "- Keep Safe Mode enabled; protected images/videos are excluded from matching, thumbnails, and clustering.\n"
        "- Use `review_candidate` only when the human operator has made or delegated a review decision.\n"
        "- Destructive tools require `confirm=True`.\n"
    )


@mcp.resource("vintrace://report", mime_type="text/markdown")
@mcp.resource("crossage://report", mime_type="text/markdown")
def report_resource() -> str:
    """The source report that drove the app implementation."""
    for report in _report_paths():
        if report.exists() and report.is_file():
            return report.read_text(encoding="utf-8")
    return "report.md is not available in this installation."


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
) -> dict[str, Any]:
    """Record consent for processing in this workspace, or for one named subject.

    MCP-02: the agent CANNOT grant consent on its own authority. Granting
    (confirmed=True) requires a one-time operator token the agent cannot mint —
    set VINTRACE_MCP_OPERATOR_TOKEN on the server and pass it as operator_token,
    or grant consent in the Vintrace desktop app. Revoking (confirmed=False)
    needs no token. Pass person_name to record a per-subject consent (with an
    optional lawful_basis) instead of the workspace-level consent.
    """
    _confirmed(confirm, "change consent status")
    if confirmed:
        _validate_operator_token("Granting consent", operator_token)
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
    assessment = assess_image_safety(resolved, _api().project.config.safe_mode_threshold)
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
def set_jurisdiction_preset(preset: str) -> dict[str, Any]:
    """Apply a per-jurisdiction consent/retention preset (e.g. gdpr, bipa-il, ccpa-cpra, colorado, standard).

    Operator-configurable defaults only — NOT legal advice or certification.
    """
    result = _call("set_jurisdiction_preset", {"preset": preset})
    return {"applied": result.get("value", {}), "state": _state_summary(result["state"])}


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
    relaxes_safe_mode = (
        (current.safe_mode and not safe_mode)
        or safe_mode_threshold > current.safe_mode_threshold
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
            "safeModeZeroAdmittance": new_zero_admittance,
            "safeModeThreshold": safe_mode_threshold,
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
def apply_calibration(confirm: bool = False) -> dict[str, Any]:
    """Apply local review feedback to matching thresholds."""
    _confirmed(confirm, "apply review feedback to matching thresholds")
    result = _call("apply_calibration")
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


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
    pending = _agent_safe_value(pending_result.get("items", []))
    return (
        "You are assisting a human reviewer with Vintrace.\n"
        "Summarize pending candidates, call out low-confidence or clustered cases, "
        "and do not make autonomous identity claims.\n\n"
        f"State summary:\n{_json(_agent_safe_value(_state_summary(state)))}\n\n"
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Vintrace MCP server")
    parser.add_argument("--workspace", default=None, help="Workspace directory. Defaults to VINTRACE_WORKSPACE or CROSSAGE_WORKSPACE, then the desktop active workspace, then vintrace_project.")
    parser.add_argument("--transport", choices=["stdio", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
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


def _build_bearer_auth_app(token: str):
    # MCP-01: wrap FastMCP's streamable_http_app() (a Starlette app) so the
    # operator token is enforced on EVERY request, not just at startup. Returns
    # the wrapped app (kept separate from uvicorn.run so it is unit-testable).
    import asyncio
    import time

    from starlette.middleware.base import BaseHTTPMiddleware
    from starlette.responses import JSONResponse

    rate, burst, max_concurrency = _rate_limit_settings()

    class BearerAuthMiddleware(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            if not _bearer_token_ok(request.headers.get("authorization", ""), token):
                return JSONResponse(
                    {"error": "unauthorized", "detail": "Valid MCP bearer token required."},
                    status_code=401,
                    headers={"WWW-Authenticate": "Bearer"},
                )
            return await call_next(request)

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
                        {"error": "rate_limited", "detail": "Too many requests; slow down."},
                        status_code=429,
                        headers={"Retry-After": "1"},
                    )
            if self._semaphore is not None:
                async with self._semaphore:
                    return await call_next(request)
            return await call_next(request)

    app = mcp.streamable_http_app()
    app.add_middleware(BearerAuthMiddleware)
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
) -> None:
    if workspace:
        _set_workspace_root(Path(workspace))
    if transport == "streamable-http":
        # MCP-01: the HTTP transport exposes the full biometric tool surface, so
        # require an explicit operator token (fail closed — no accidental open
        # HTTP server) AND validate it per request via Bearer auth below.
        token = env_value("MCP_TOKEN")
        if not token:
            raise ValueError(
                "Streamable HTTP MCP requires an auth token. Set VINTRACE_MCP_TOKEN before "
                "starting the HTTP transport (clients must present it). Use stdio for the "
                "unauthenticated local transport."
            )
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
    )


if __name__ == "__main__":
    main()

from __future__ import annotations

from pathlib import Path
import argparse
import json
import os
import sys
from typing import Any, Literal

from mcp.server.fastmcp import Context, FastMCP

from crossage_fr import __version__
from crossage_fr.api_server import DesktopApi
from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS
from crossage_fr.ingest.safety import assess_image_safety
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS, probe_video
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
    if isinstance(value, str) and not keep_path_names and _looks_like_path(value):
        return _redacted_path(value, keep_name=False)
    return value


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
    return _json(_agent_safe_value(_agent_state()))


@mcp.resource("vintrace://summary", mime_type="application/json")
@mcp.resource("crossage://summary", mime_type="application/json")
def summary_resource() -> str:
    """Compact project summary for deciding which MCP tools to call next."""
    return _json(_agent_safe_value(_state_summary(_agent_state())))


@mcp.resource("vintrace://references", mime_type="application/json")
@mcp.resource("crossage://references", mime_type="application/json")
def references_resource() -> str:
    """Enrolled reference faces grouped by person and age bucket, with local paths hidden."""
    state = _agent_state()
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for ref in state["references"]:
        grouped.setdefault(ref["personName"], {}).setdefault(ref["ageBucket"], []).append(ref)
    return _json(_agent_safe_value(grouped))


@mcp.resource("vintrace://candidates", mime_type="application/json")
@mcp.resource("crossage://candidates", mime_type="application/json")
def candidates_resource() -> str:
    """Current review candidates with statuses and scores, with local paths and hashes hidden."""
    return _json(_agent_safe_value(_agent_state()["candidates"]))


@mcp.resource("vintrace://config", mime_type="application/json")
@mcp.resource("crossage://config", mime_type="application/json")
def config_resource() -> str:
    """Runtime thresholds, clustering settings, Safe Mode, and consent policy."""
    return _json(_agent_safe_value(_agent_state()["config"]))


@mcp.resource("vintrace://audit", mime_type="application/jsonl")
@mcp.resource("crossage://audit", mime_type="application/jsonl")
def audit_resource() -> str:
    """Recent audit log events with local paths hidden. Use read_audit_events for pagination."""
    return "\n".join(json.dumps(_agent_safe_value(row), ensure_ascii=False) for row in _api().project.audit_events(limit=200)["events"])


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


@mcp.tool()
def get_project_state() -> dict[str, Any]:
    """Return a compact current state summary for the active workspace."""
    return _state_summary(_agent_state())


@mcp.tool()
def set_workspace(path: str) -> dict[str, Any]:
    """Switch the MCP server to a workspace directory. Consent must be marked separately."""
    _set_workspace_root(Path(path))
    result = _api().state()
    return _state_summary(result)


@mcp.tool()
def mark_consent(confirmed: bool, operator: str = "", note: str = "", confirm: bool = False) -> dict[str, Any]:
    """Mark whether the operator has consent to process images and videos in this MCP session."""
    _confirmed(confirm, "change consent status")
    state = _call("set_consent", {"value": confirmed, "source": "mcp", "operator": operator, "note": note, "scope": str(WORKSPACE)})
    return {**_state_summary(state), "operator": operator, "note": note}


@mcp.tool()
def enroll_reference_folder(person_name: str, age_bucket: AgeBucket, folder: str) -> dict[str, Any]:
    """Enroll reference images for one person from one folder and one age bucket."""
    result = _call("enroll", {"personName": person_name, "ageBucket": age_bucket, "folder": folder})
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "state": _state_summary(result["state"]),
    }


@mcp.tool()
def enroll_age_reference_set(
    person_name: str,
    child_folder: str = "",
    adolescent_folder: str = "",
    adult_folder: str = "",
    unknown_folder: str = "",
) -> dict[str, Any]:
    """Enroll multiple age-bucket reference folders for the same person in one action."""
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


@mcp.tool()
def scan_folder(folder: str, ctx: Context) -> dict[str, Any]:
    """Scan an image/video folder and queue matched or clustered review candidates."""
    result = _call("scan", {"folder": folder, "source": "mcp"}, progress=_progress_reporter(ctx))
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "metrics": result.get("metrics", {}),
        "state": _state_summary(result["state"]),
    }


@mcp.tool()
def scan_media_paths(paths: list[str], ctx: Context) -> dict[str, Any]:
    """Scan explicit image or video paths and queue matched or clustered review candidates."""
    result = _call("scan_paths", {"paths": paths, "source": "mcp"}, progress=_progress_reporter(ctx))
    return {
        "added": result.get("added", 0),
        "errors": result.get("errors", []),
        "metrics": result.get("metrics", {}),
        "state": _state_summary(result["state"]),
    }


@mcp.tool()
def cancel_active_scan(confirm: bool = False) -> dict[str, Any]:
    """Request cancellation of the active scan. The current file finishes, then the scan stops with a resumable manifest."""
    _confirmed(confirm, "cancel the active scan")
    return _call("cancel_scan", {"source": "mcp"})


@mcp.tool()
def pause_active_scan(confirm: bool = False) -> dict[str, Any]:
    """Pause the active scan between files without losing resumable progress."""
    _confirmed(confirm, "pause the active scan")
    return _call("pause_scan", {"source": "mcp"})


@mcp.tool()
def resume_active_scan() -> dict[str, Any]:
    """Resume a paused scan."""
    return _call("resume_scan", {"source": "mcp"})


@mcp.tool()
def scan_job_status() -> dict[str, Any]:
    """Read active scan job controls and latest manifest status."""
    return _call("scan_job_status")


@mcp.tool()
def scan_image_paths(paths: list[str], ctx: Context) -> dict[str, Any]:
    """Compatibility alias for scan_media_paths; accepts image and video paths."""
    return scan_media_paths(paths, ctx)


@mcp.tool()
def analyze_folder(folder: str) -> dict[str, Any]:
    """Preflight a folder before scanning: counts images/videos, samples readability, and returns recommendations."""
    return _agent_safe_value(_call("analyze_folder", {"folder": folder}), keep_path_names=False)


@mcp.tool()
def probe_video_file(path: str) -> dict[str, Any]:
    """Probe one video file for decoder support, dimensions, frame count, and duration."""
    resolved = Path(path).expanduser().resolve()
    extension_ok = resolved.suffix.lower() in VIDEO_EXTENSIONS
    if not extension_ok:
        return {"path": "[hidden]", "extensionOk": False, "readable": False}
    try:
        return _agent_safe_value({"extensionOk": True, **probe_video(resolved)}, keep_path_names=False)
    except Exception as exc:
        return {"path": "[hidden]", "extensionOk": True, "readable": False, "error": str(exc)}


@mcp.tool()
def assess_image(path: str) -> dict[str, Any]:
    """Assess one still image for Safe Mode filtering and image-extension eligibility."""
    resolved = Path(path).expanduser().resolve()
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


@mcp.tool()
def review_candidate(candidate_id: str, status: ReviewStatus, confirm: bool = False) -> dict[str, Any]:
    """Set a review candidate status after a human review decision."""
    _confirmed(confirm, f"set candidate {candidate_id} to {status}")
    state = _call("set_status", {"candidateId": candidate_id, "status": status})
    return _state_summary(state)


@mcp.tool()
def bulk_review_candidates(candidate_ids: list[str], status: ReviewStatus, confirm: bool = False) -> dict[str, Any]:
    """Set the same review status on multiple candidates after human review."""
    _confirmed(confirm, f"set {len(candidate_ids)} candidate(s) to {status}")
    result = _call("bulk_set_status", {"candidateIds": candidate_ids, "status": status})
    return {"updated": result.get("updated", 0), "state": _state_summary(result["state"])}


@mcp.tool()
def set_candidate_note(candidate_id: str, note: str) -> dict[str, Any]:
    """Save an operator note on a review candidate."""
    state = _call("set_candidate_note", {"candidateId": candidate_id, "note": note})
    return _state_summary(state)


@mcp.tool()
def block_false_match(candidate_id: str, confirm: bool = False) -> dict[str, Any]:
    """Reject and suppress this exact image/person false-match pair in future scans."""
    _confirmed(confirm, f"block repeated false match for {candidate_id}")
    result = _call("block_false_match", {"candidateId": candidate_id})
    return {"blocked": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def reassign_candidate_person(candidate_id: str, person_name: str, confirm: bool = False) -> dict[str, Any]:
    """Move one candidate row to a different person label for identity split/cleanup workflows."""
    _confirmed(confirm, f"move candidate {candidate_id} to {person_name}")
    result = _call("reassign_candidate_person", {"candidateId": candidate_id, "personName": person_name, "clearReference": True})
    return {"reassigned": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
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


@mcp.tool()
def clear_review_queue(confirm: bool = False) -> dict[str, Any]:
    """Clear all review candidates from the active workspace."""
    _confirmed(confirm, "clear the review queue")
    state = _call("clear_queue")
    return _state_summary(state)


@mcp.tool()
def purge_reviewed_candidates(confirm: bool = False) -> dict[str, Any]:
    """Remove accepted, rejected, and uncertain candidates from the active queue while preserving audit records."""
    _confirmed(confirm, "purge reviewed candidates")
    result = _call("purge_candidates", {"statuses": ["accepted", "rejected", "uncertain"]})
    return {"purged": result.get("purged", 0), "state": _state_summary(result["state"])}


@mcp.tool()
def workspace_health() -> dict[str, Any]:
    """Audit workspace health: missing files/media sources, duplicate review rows, storage footprint, and cleanup recommendations."""
    return _call("workspace_health")


@mcp.tool()
def repair_workspace(confirm: bool = False) -> dict[str, Any]:
    """Preview or repair missing saved-photo and match links. Without confirm=true this returns a dry run only."""
    result = _call("repair_workspace", {"dryRun": not confirm})
    return {"repair": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def relink_workspace_paths(old_root: str, new_root: str, confirm: bool = False) -> dict[str, Any]:
    """Relink saved photo/video paths after a library folder has moved. Without confirm=true this returns a dry run only."""
    result = _call("relink_workspace_paths", {"oldRoot": old_root, "newRoot": new_root, "dryRun": not confirm})
    return {"relink": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def duplicate_people(threshold: float = 0.82, limit: int = 20) -> dict[str, Any]:
    """Find enrolled person labels whose saved reference faces are very similar and may need merging."""
    return _call("duplicate_people", {"threshold": threshold, "limit": limit})


@mcp.tool()
def read_audit_events(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """Read recent audit events with pagination instead of loading the entire audit log."""
    return _call("audit_events", {"limit": limit, "offset": offset})


@mcp.tool()
def purge_duplicate_candidates(confirm: bool = False) -> dict[str, Any]:
    """Compact duplicate review rows for the same person/media item while preserving the strongest candidate."""
    _confirmed(confirm, "purge duplicate candidate rows")
    result = _call("purge_duplicate_candidates")
    return {"purged": result.get("purged", 0), "health": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def delete_reference(ref_id: str, confirm: bool = False) -> dict[str, Any]:
    """Delete one enrolled reference face by reference id."""
    _confirmed(confirm, f"delete reference {ref_id}")
    state = _call("delete_reference", {"refId": ref_id})
    return _state_summary(state)


@mcp.tool()
def delete_person(person_name: str, confirm: bool = False) -> dict[str, Any]:
    """Delete all references and queued candidates for one person while preserving audit records."""
    _confirmed(confirm, f"delete all data for {person_name}")
    result = _call("delete_person", {"personName": person_name})
    return {"deleted": result.get("deleted", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def rename_person(old_name: str, new_name: str, confirm: bool = False) -> dict[str, Any]:
    """Rename or merge one person label into another person label, requiring confirm=true."""
    _confirmed(confirm, f"rename or merge {old_name} into {new_name}")
    result = _call("rename_person", {"oldName": old_name, "newName": new_name})
    return {"renamed": result.get("renamed", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def clear_references(confirm: bool = False) -> dict[str, Any]:
    """Delete all enrolled references from the active workspace."""
    _confirmed(confirm, "clear all references")
    result = _call("clear_references")
    return {"cleared": result.get("cleared", 0), "state": _state_summary(result["state"])}


@mcp.tool()
def purge_old_candidates(days: int = 90, confirm: bool = False) -> dict[str, Any]:
    """Purge reviewed candidates older than the retention window while preserving audit records."""
    _confirmed(confirm, f"purge reviewed candidates older than {days} day(s)")
    result = _call("purge_old_candidates", {"days": days, "statuses": ["accepted", "rejected", "uncertain"]})
    return {"purged": result.get("purged", 0), "state": _state_summary(result["state"])}


@mcp.tool()
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
    relaxes_safe_mode = (current.safe_mode and not safe_mode) or safe_mode_threshold > current.safe_mode_threshold
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


@mcp.tool()
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


@mcp.tool()
def export_review_report() -> dict[str, Any]:
    """Export a JSON audit report and CSV candidate table into the workspace exports folder."""
    result = _call("export_report")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_workspace_inventory() -> dict[str, Any]:
    """Export a workspace inventory with source-folder counts, saved references, and review rows, without media files."""
    result = _call("export_workspace_inventory")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_audit_log() -> dict[str, Any]:
    """Export the full local activity log to JSON and CSV for review or support."""
    result = _call("export_audit_log")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_consent_receipt() -> dict[str, Any]:
    """Export a consent receipt with policy and counts, without photos, thumbnails, vectors, or model files."""
    result = _call("export_consent_receipt")
    return {"receipt": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def retention_policy_report() -> dict[str, Any]:
    """Report reviewed-match retention windows, generated data size, and cleanup recommendations."""
    return _call("retention_policy_report")


@mcp.tool()
def export_safe_mode_audit() -> dict[str, Any]:
    """Export Safe Mode policy, model status, cache counts, and protected-media scan totals."""
    result = _call("export_safe_mode_audit")
    return {"audit": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def model_drift_report() -> dict[str, Any]:
    """Report references or review rows created with a different active face model."""
    return _call("model_drift_report")


@mcp.tool()
def export_review_ledger() -> dict[str, Any]:
    """Export review decision metadata and audit events without media, thumbnails, vectors, or model files."""
    result = _call("export_review_ledger")
    return {"ledger": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_scan_history() -> dict[str, Any]:
    """Export scan run history to JSON and CSV for performance/support review."""
    result = _call("export_scan_history")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_workspace_backup(include_generated: bool = False, confirm: bool = False) -> dict[str, Any]:
    """Export a ZIP backup of workspace metadata and audit logs; generated files require confirm=true."""
    if include_generated:
        _confirmed(confirm, "include generated previews/video frames in a workspace backup")
    result = _call("export_workspace_backup", {"includeGenerated": include_generated})
    return {"backup": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def verify_workspace_backup(path: str = "") -> dict[str, Any]:
    """Verify a Vintrace workspace backup ZIP before sharing or archiving it."""
    result = _call("verify_workspace_backup", {"path": path})
    return {"verification": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def prune_workspace_backups(keep: int = 5, confirm: bool = False) -> dict[str, Any]:
    """Remove older workspace backup ZIPs, keeping the newest N backups. Requires confirm=true."""
    _confirmed(confirm, f"remove old workspace backups and keep the newest {keep}")
    result = _call("prune_workspace_backups", {"keep": keep})
    return {"cleanup": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def prune_scan_manifests(keep_runs: int = 20, confirm: bool = False) -> dict[str, Any]:
    """Remove older resumable scan manifest rows while keeping the newest runs. Requires confirm=true."""
    _confirmed(confirm, f"remove old scan manifests and keep the newest {keep_runs}")
    result = _call("prune_scan_manifests", {"keepRuns": keep_runs})
    return {"cleanup": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_selected_candidates(candidate_ids: list[str]) -> dict[str, Any]:
    """Export selected candidate rows to JSON and CSV in the workspace exports folder."""
    result = _call("export_candidates", {"candidateIds": candidate_ids})
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_accepted_media_bundle(confirm: bool = False) -> dict[str, Any]:
    """Copy accepted media into a shareable folder with JSON/CSV manifests."""
    _confirmed(confirm, "export accepted media files")
    result = _call("export_media_bundle", {"statuses": ["accepted"], "includeOriginalMedia": True})
    return {"bundle": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def runtime_self_test() -> dict[str, Any]:
    """Run local runtime diagnostics for workspace, decoders, acceleration, Safe Mode, and health."""
    return _call("runtime_self_test")


@mcp.tool()
def runtime_benchmark() -> dict[str, Any]:
    """Run a local scale benchmark for vector search, state serialization, and SQLite manifest health."""
    return _call("runtime_benchmark")


@mcp.tool()
def release_readiness() -> dict[str, Any]:
    """Return a local release checklist for models, Safe Mode, signing, updates, and crash reporting."""
    return _call("release_readiness")


@mcp.tool()
def model_integrity() -> dict[str, Any]:
    """Verify model folder writability, downloaded archive checksums, Safe Mode model, and decoder readiness."""
    return _call("model_integrity")


@mcp.tool()
def export_support_bundle(include_paths: bool = False) -> dict[str, Any]:
    """Export a diagnostics-only support bundle without photos, videos, thumbnails, vectors, or model files."""
    result = _call("export_support_bundle", {"includePaths": include_paths})
    return {"bundle": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def installer_self_diagnostics() -> dict[str, Any]:
    """Run first-run diagnostics for installers: model downloader, decoders, Safe Mode, workspace, and packaged backend readiness."""
    return _call("installer_self_diagnostics")


@mcp.tool()
def apply_review_rules(confirm: bool = False) -> dict[str, Any]:
    """Apply saved auto-triage review rules to pending candidates. Requires confirm=true because it changes review status."""
    _confirmed(confirm, "apply saved review rules to pending candidates")
    result = _call("apply_review_rules")
    return {"rules": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def calibration_summary() -> dict[str, Any]:
    """Return the local calibration label summary built from accepted/rejected review decisions."""
    return _call("calibration_summary")


@mcp.tool()
def accuracy_evaluation() -> dict[str, Any]:
    """Evaluate precision/recall from accepted and rejected review decisions."""
    return _call("accuracy_evaluation")


@mcp.tool()
def export_accuracy_labels() -> dict[str, Any]:
    """Export accepted/rejected review labels to JSON and CSV for accuracy benchmarking."""
    result = _call("export_accuracy_labels")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def import_accuracy_labels(labels: list[dict[str, Any]], confirm: bool = False) -> dict[str, Any]:
    """Import local ground-truth label rows into the calibration/accuracy harness."""
    _confirmed(confirm, "import accuracy labels")
    result = _call("import_accuracy_labels", {"rows": labels})
    return {"imported": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def apply_calibration(confirm: bool = False) -> dict[str, Any]:
    """Apply local review feedback to matching thresholds."""
    _confirmed(confirm, "apply review feedback to matching thresholds")
    result = _call("apply_calibration")
    return {"calibration": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def privacy_report() -> dict[str, Any]:
    """Report local face data, generated previews, caches, and audit history in this workspace."""
    return _call("privacy_report")


@mcp.tool()
def delete_face_data(confirm: bool = False, include_audit: bool = False) -> dict[str, Any]:
    """Delete saved faces, possible matches, scan history, generated previews, and private caches."""
    _confirmed(confirm, "delete face data from the workspace")
    result = _call("delete_face_data", {"confirm": True, "includeAudit": include_audit})
    return {"deleted": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def optimize_workspace(confirm: bool = False) -> dict[str, Any]:
    """Remove regenerable preview cache, orphan extracted video frames, and compact the scale database."""
    _confirmed(confirm, "optimize generated workspace files")
    result = _call("optimize_workspace")
    return {"optimized": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
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
        local_hosts = {"127.0.0.1", "localhost", "::1", "[::1]"}
        if host not in local_hosts and not allow_remote_http:
            raise ValueError("Streamable HTTP MCP is localhost-only unless --allow-remote-http is set.")
        mcp.settings.host = host
        mcp.settings.port = port
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

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

WORKSPACE = resolve_workspace(os.environ.get("CROSSAGE_WORKSPACE"))
API: DesktopApi | None = None

mcp = FastMCP(
    "CrossAge FR Workbench",
    log_level="WARNING",
    instructions=(
        "Consent-gated, review-first tools for CrossAge FR Workbench. "
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
    env_report = os.environ.get("CROSSAGE_REPORT_PATH")
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


@mcp.resource("crossage://state", mime_type="application/json")
def state_resource() -> str:
    """Full project state, including references, candidates, config, and counts."""
    return _json(_api().state())


@mcp.resource("crossage://summary", mime_type="application/json")
def summary_resource() -> str:
    """Compact project summary for deciding which MCP tools to call next."""
    return _json(_state_summary(_api().state()))


@mcp.resource("crossage://references", mime_type="application/json")
def references_resource() -> str:
    """Enrolled reference faces grouped by person and age bucket."""
    state = _api().state()
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for ref in state["references"]:
        grouped.setdefault(ref["personName"], {}).setdefault(ref["ageBucket"], []).append(ref)
    return _json(grouped)


@mcp.resource("crossage://candidates", mime_type="application/json")
def candidates_resource() -> str:
    """All review candidates, including current statuses and match scores."""
    return _json(_api().state()["candidates"])


@mcp.resource("crossage://config", mime_type="application/json")
def config_resource() -> str:
    """Runtime thresholds, clustering settings, Safe Mode, and consent policy."""
    return _json(_api().state()["config"])


@mcp.resource("crossage://audit", mime_type="application/jsonl")
def audit_resource() -> str:
    """Recent audit log events. Use read_audit_events for pagination."""
    return "\n".join(json.dumps(row, ensure_ascii=False) for row in _api().project.audit_events(limit=200)["events"])


@mcp.resource("crossage://agent-guide", mime_type="text/markdown")
def agent_guide_resource() -> str:
    """Agent operating guide for consent, Safe Mode, and review-first workflows."""
    return (
        "# CrossAge FR Agent Guide\n\n"
        "- This system is review-first. Do not claim autonomous identification.\n"
        "- Call `mark_consent(confirmed=True)` before enrollment or scanning.\n"
        "- Prefer `enroll_age_reference_set` when child/adolescent/adult references exist.\n"
        "- Keep Safe Mode enabled; protected images/videos are excluded from matching, thumbnails, and clustering.\n"
        "- Use `review_candidate` only when the human operator has made or delegated a review decision.\n"
        "- Destructive tools require `confirm=True`.\n"
    )


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
    return _state_summary(_api().state())


@mcp.tool()
def set_workspace(path: str, mark_consent: bool = False) -> dict[str, Any]:
    """Switch the MCP server to a workspace directory; optionally mark consent for this session."""
    _set_workspace_root(Path(path))
    result = _api().state()
    if mark_consent:
        result = _call("set_consent", {"value": True, "source": "mcp", "scope": str(WORKSPACE)})
    return _state_summary(result)


@mcp.tool()
def mark_consent(confirmed: bool, operator: str = "", note: str = "") -> dict[str, Any]:
    """Mark whether the operator has consent to process images and videos in this MCP session."""
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
def scan_image_paths(paths: list[str], ctx: Context) -> dict[str, Any]:
    """Compatibility alias for scan_media_paths; accepts image and video paths."""
    return scan_media_paths(paths, ctx)


@mcp.tool()
def analyze_folder(folder: str) -> dict[str, Any]:
    """Preflight a folder before scanning: counts images/videos, samples readability, and returns recommendations."""
    return _call("analyze_folder", {"folder": folder})


@mcp.tool()
def probe_video_file(path: str) -> dict[str, Any]:
    """Probe one video file for decoder support, dimensions, frame count, and duration."""
    resolved = Path(path).expanduser().resolve()
    extension_ok = resolved.suffix.lower() in VIDEO_EXTENSIONS
    if not extension_ok:
        return {"path": str(resolved), "extensionOk": False, "readable": False}
    try:
        return {"extensionOk": True, **probe_video(resolved)}
    except Exception as exc:
        return {"path": str(resolved), "extensionOk": True, "readable": False, "error": str(exc)}


@mcp.tool()
def assess_image(path: str) -> dict[str, Any]:
    """Assess one still image for Safe Mode filtering and image-extension eligibility."""
    resolved = Path(path).expanduser().resolve()
    extension_ok = resolved.suffix.lower() in IMAGE_EXTENSIONS
    if not extension_ok:
        return {"path": str(resolved), "extensionOk": False, "sensitive": False, "score": 0.0}
    assessment = assess_image_safety(resolved, _api().project.config.safe_mode_threshold)
    return {
        "path": str(resolved),
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
    safe_mode: bool,
    safe_mode_threshold: float,
    confirm: bool = False,
    reason: str = "",
) -> dict[str, Any]:
    """Update thresholds, clustering minimum, and Safe Mode settings."""
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
            "safeMode": safe_mode,
            "safeModeThreshold": safe_mode_threshold,
            "source": "mcp",
            "reason": reason,
        },
    )
    return {**_state_summary(state), "confirmed": confirm, "reason": reason}


@mcp.tool()
def export_review_report() -> dict[str, Any]:
    """Export a JSON audit report and CSV candidate table into the workspace exports folder."""
    result = _call("export_report")
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_workspace_backup(include_generated: bool = True) -> dict[str, Any]:
    """Export a ZIP backup of workspace metadata, audit logs, and generated workspace files."""
    result = _call("export_workspace_backup", {"includeGenerated": include_generated})
    return {"backup": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def export_selected_candidates(candidate_ids: list[str]) -> dict[str, Any]:
    """Export selected candidate rows to JSON and CSV in the workspace exports folder."""
    result = _call("export_candidates", {"candidateIds": candidate_ids})
    return {"export": result.get("value", {}), "state": _state_summary(result["state"])}


@mcp.tool()
def runtime_self_test() -> dict[str, Any]:
    """Run local runtime diagnostics for workspace, decoders, acceleration, Safe Mode, and health."""
    return _call("runtime_self_test")


@mcp.prompt(title="Triage Pending CrossAge FR Candidates")
def triage_pending(max_items: int = 20) -> str:
    """Guide an agent through review triage using current pending candidates."""
    state = _api().state()
    pending = [candidate for candidate in state["candidates"] if candidate["status"] == "pending"][:max_items]
    return (
        "You are assisting a human reviewer with CrossAge FR Workbench.\n"
        "Summarize pending candidates, call out low-confidence or clustered cases, "
        "and do not make autonomous identity claims.\n\n"
        f"State summary:\n{_json(_state_summary(state))}\n\n"
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
    parser = argparse.ArgumentParser(description="CrossAge FR Workbench MCP server")
    parser.add_argument("--workspace", default=None, help="Workspace directory. Defaults to CROSSAGE_WORKSPACE, then the desktop active workspace, then crossage_project.")
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

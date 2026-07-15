from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from typing import Any

from PIL import Image

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from crossage_fr.api_server import DesktopApi


ROOT = REPO / ".artifacts" / "agent-dogfood"
TEMPLATE = ROOT / "template"
CLAUDE_DESKTOP_CONFIG = Path.home() / "Library" / "Application Support" / "Claude" / "claude_desktop_config.json"
WORKFLOWS_PATH = Path(__file__).with_name("workflows.json")
CLIENTS = ("codex", "claude-code", "claude-desktop")
ASSET_INTENSIVE_WORKFLOWS = {
    "03_lexical_search", "04_filtered_search", "05_search_then_fetch", "06_existing_intelligence",
    "07_bounded_preview", "10_metadata_write_plan", "11_metadata_write_execute",
    "13_contact_sheet_artifact", "16_missing_index_plan",
}
MANUAL_REVIEW_SECONDS_PER_ASSET = 2.0
IMAGE_TOOLS = (
    "list_image_capabilities", "get_image_library_overview", "list_inbound_visual_sources",
    "discover_inbound_visuals", "import_inbound_visuals", "sync_inbound_visuals", "search_images",
    "fetch_image_assets", "analyze_image_assets", "get_image_preview", "plan_image_action",
    "run_image_read_action", "run_image_write_action", "run_destructive_image_action", "get_image_job",
    "get_agent_activity", "list_image_operations", "get_image_operation", "list_image_recipes",
    "get_image_recipe", "plan_image_recipe", "save_image_recipe", "delete_image_recipe",
)


def workflows() -> list[dict[str, Any]]:
    return json.loads(WORKFLOWS_PATH.read_text(encoding="utf-8"))


def prepare() -> None:
    if TEMPLATE.exists():
        shutil.rmtree(TEMPLATE)
    media = TEMPLATE / "media"
    workspace = TEMPLATE / "workspace"
    media.mkdir(parents=True)
    cohorts = (
        "amber-lighthouse-invoice-sn1042",
        "cobalt-prototype-portfolio",
        "lisbon-sunset-trip",
        "red-bicycle-product",
        "green-mountain-hike",
        "studio-portrait-alice",
        "receipt-cafe-ocr",
        "duplicate-review",
        "document-archive",
        "wildlife-fox",
    )
    paths: list[str] = []
    for index in range(1000):
        cohort_index = index // 100
        cohort = cohorts[cohort_index]
        needle = "golden-needle-" if index < 5 else ""
        path = media / f"{needle}{cohort}-{index:04d}.png"
        color = ((index * 37) % 256, (cohort_index * 23 + 50) % 256, (index * 11 + 90) % 256)
        image = Image.new("RGB", (48, 36), color)
        image.putpixel((index % 48, (index // 48) % 36), ((index + 1) % 256, 17, 231))
        image.save(path, optimize=False)
        paths.append(str(path))

    api = DesktopApi(workspace, actor="agent-dogfood-fixture")
    api.handle("set_consent", {"value": True, "operator": "Dogfood fixture", "source": "test"})
    imported = api.import_photos({"sourcePaths": paths, "storageMode": "referenced", "sourceLabel": "Dogfood 1k"})
    if int(imported.get("importedCount", 0)) != 1000:
        raise RuntimeError(f"fixture import mismatch: {imported.get('importedCount')}")
    rows = api.project.db.list_photo_assets(limit=1100)
    by_name = {Path(str(row["sourcePath"])).name: row for row in rows}
    updates: list[dict[str, Any]] = []
    tags: dict[str, list[str]] = {"needle": [], "favorite-red": []}
    for index, source in enumerate(paths):
        name = Path(source).name
        row = by_name[name]
        asset_id = str(row["assetId"])
        cohort = cohorts[index // 100]
        update: dict[str, Any] = {
            "assetId": asset_id,
            "title": f"{cohort.replace('-', ' ').title()} {index:04d}",
            "caption": f"Deterministic dogfood asset {index:04d} in {cohort}",
            "keywords": cohort.split("-"),
            "favorite": 300 <= index < 320,
        }
        if index < 5:
            update["title"] = f"Golden Needle Amber Lighthouse SN-1042 {index + 1}"
            update["keywords"] = ["golden", "needle", "amber", "lighthouse", "SN-1042"]
            tags["needle"].append(asset_id)
        if 300 <= index < 320:
            tags["favorite-red"].append(asset_id)
        updates.append(update)
    result = api.update_photo_assets_metadata({"items": updates, "label": "Seed dogfood metadata"})
    if int(result.get("updated", 0)) != 1000:
        raise RuntimeError(f"metadata seed mismatch: {result.get('updated')}")
    (TEMPLATE / "expected.json").write_text(
        json.dumps({"assetCount": 1000, "tags": tags}, indent=2, sort_keys=True), encoding="utf-8"
    )
    print(json.dumps({"prepared": True, "assetCount": 1000, "root": str(TEMPLATE)}, indent=2))


def materialize_client(client: str) -> Path:
    target = ROOT / "runs" / client
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(TEMPLATE, target)
    (target / "traces").mkdir()
    (target / "stdout").mkdir()
    return target


def mcp_config(client_root: Path, workflow_id: str) -> dict[str, Any]:
    trace = client_root / "traces" / f"{workflow_id}.jsonl"
    workspace = client_root / "workspace"
    env = {
        "PYTHONPATH": str(REPO),
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_MCP_ALLOWED_ROOTS": os.pathsep.join([str(client_root), str(client_root / "media")]),
    }
    return {
        "mcpServers": {
            "vintrace": {
                "type": "stdio",
                "command": sys.executable,
                "args": [
                    str(Path(__file__).with_name("mcp_trace_proxy.py")),
                    "--trace", str(trace), "--", sys.executable, "-m", "crossage_fr.mcp_server",
                    "--workspace", str(workspace), "--tool-profile", "images",
                ],
                "env": env,
            }
        }
    }


def codex_args(client_root: Path, workflow: dict[str, Any]) -> list[str]:
    server = mcp_config(client_root, workflow["id"])["mcpServers"]["vintrace"]
    values = {
        "mcp_servers.vintrace.command": server["command"],
        "mcp_servers.vintrace.args": server["args"],
        "mcp_servers.vintrace.required": True,
        "mcp_servers.vintrace.startup_timeout_sec": 30,
        "mcp_servers.vintrace.tool_timeout_sec": 600,
        "mcp_servers.vintrace.default_tools_approval_mode": "approve",
    }
    args = ["codex", "exec", "--json", "--ephemeral", "--ignore-user-config", "--sandbox", "read-only", "-C", str(REPO)]
    for env_key, env_value in server["env"].items():
        values[f"mcp_servers.vintrace.env.{env_key}"] = env_value
    for key, value in values.items():
        args.extend(["-c", f"{key}={json.dumps(value, separators=(',', ':'))}"])
    return args


def claude_args(client_root: Path, workflow: dict[str, Any]) -> tuple[list[str], Path]:
    config_path = client_root / f"mcp-{workflow['id']}.json"
    config_path.write_text(json.dumps(mcp_config(client_root, workflow["id"]), indent=2), encoding="utf-8")
    return ([
        "claude", "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
        "--model", "sonnet",
        "--strict-mcp-config", "--mcp-config", str(config_path), "--permission-mode", "bypassPermissions",
        "--setting-sources", "project", "--disable-slash-commands",
        "--tools", ",".join(f"mcp__vintrace__{name}" for name in IMAGE_TOOLS),
    ], config_path)


def run_cli(client: str, only: set[str] | None = None, *, reuse: bool = False) -> None:
    if client not in {"codex", "claude-code"}:
        raise ValueError("CLI runner supports codex and claude-code")
    existing_root = ROOT / "runs" / client
    client_root = existing_root if reuse and existing_root.exists() else materialize_client(client)
    existing_runs = client_root / "runs.json"
    records_by_id = {
        row["workflowId"]: row
        for row in (json.loads(existing_runs.read_text(encoding="utf-8")) if reuse and existing_runs.exists() else [])
    }
    for index, workflow in enumerate(workflows(), start=1):
        if only and workflow["id"] not in only:
            continue
        prompt = str(workflow["prompt"]).format(client=client)
        instruction = (
            "This is an authorized Vintrace MCP dogfood workflow against an isolated synthetic library. "
            "Use only Vintrace MCP tools; do not use shell, files, or unrelated tools. " + prompt
        )
        if client == "codex":
            args = codex_args(client_root, workflow)
        else:
            args, _ = claude_args(client_root, workflow)
        trace_path = client_root / "traces" / f"{workflow['id']}.jsonl"
        trace_path.unlink(missing_ok=True)
        started = time.monotonic()
        run_cwd = REPO if client == "codex" else Path(tempfile.gettempdir()) / "vintrace-claude-code-dogfood"
        run_cwd.mkdir(parents=True, exist_ok=True)
        if client == "claude-code":
            completed = subprocess.run(
                args,
                cwd=run_cwd,
                text=True,
                input=instruction,
                capture_output=True,
                timeout=600,
            )
        else:
            completed = subprocess.run(
                args + [instruction], cwd=run_cwd, text=True, capture_output=True, timeout=600
            )
        elapsed = time.monotonic() - started
        stdout_path = client_root / "stdout" / f"{workflow['id']}.jsonl"
        stderr_path = client_root / "stdout" / f"{workflow['id']}.stderr.txt"
        stdout_path.write_text(completed.stdout, encoding="utf-8")
        stderr_path.write_text(completed.stderr, encoding="utf-8")
        record = {
            "client": client,
            "workflowId": workflow["id"],
            "exitCode": completed.returncode,
            "elapsedSeconds": round(elapsed, 3),
            "stdout": str(stdout_path.relative_to(ROOT)),
            "trace": str((client_root / "traces" / f"{workflow['id']}.jsonl").relative_to(ROOT)),
        }
        records_by_id[workflow["id"]] = record
        print(f"[{index:02d}/18] {client} {workflow['id']}: exit={completed.returncode} {elapsed:.1f}s", flush=True)
    records = [records_by_id[workflow["id"]] for workflow in workflows() if workflow["id"] in records_by_id]
    (client_root / "runs.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


def desktop_bundle() -> None:
    client_root = materialize_client("claude-desktop")
    prompts: list[dict[str, str]] = []
    for workflow in workflows():
        prompts.append({"id": workflow["id"], "prompt": str(workflow["prompt"]).format(client="claude-desktop")})
    config = mcp_config(client_root, "desktop-session")
    config_path = client_root / "claude_desktop_config.generated.json"
    config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
    (client_root / "desktop-prompts.json").write_text(json.dumps(prompts, indent=2), encoding="utf-8")
    print(json.dumps({
        "desktopPrepared": True,
        "promptCount": len(prompts),
        "root": str(client_root),
        "config": str(config_path),
        "runner": str(Path(__file__).with_name("desktop_runner.cjs")),
    }, indent=2))


def split_desktop_trace() -> None:
    client_root = ROOT / "runs" / "claude-desktop"
    shared = client_root / "traces" / "desktop-session.jsonl"
    runs_path = client_root / "runs.json"
    if not shared.exists() or not runs_path.exists():
        raise FileNotFoundError("Desktop shared trace and runs.json are required.")
    events = [json.loads(line) for line in shared.read_text(encoding="utf-8").splitlines() if line.strip()]
    for run in json.loads(runs_path.read_text(encoding="utf-8")):
        started = datetime.fromisoformat(run["startedAt"])
        finished = datetime.fromisoformat(run["finishedAt"])
        selected = []
        for event in events:
            at = datetime.fromisoformat(str(event.get("at")))
            if started <= at <= finished:
                selected.append(event)
        target = client_root / "traces" / f"{run['workflowId']}.jsonl"
        target.write_text("".join(json.dumps(event, separators=(",", ":")) + "\n" for event in selected), encoding="utf-8")
    print(json.dumps({"desktopTraces": len(json.loads(runs_path.read_text(encoding="utf-8")))}, indent=2))


def install_desktop_config(*, restore: bool = False) -> None:
    client_root = ROOT / "runs" / "claude-desktop"
    backup = client_root / "claude_desktop_config.backup.json"
    if restore:
        if not backup.exists():
            raise FileNotFoundError("Claude Desktop configuration backup was not found.")
        CLAUDE_DESKTOP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(backup, CLAUDE_DESKTOP_CONFIG)
        print(json.dumps({"desktopConfigRestored": True}, indent=2))
        return
    generated = client_root / "claude_desktop_config.generated.json"
    if not generated.exists():
        raise FileNotFoundError("Run desktop-bundle before installing its configuration.")
    current: dict[str, Any] = {}
    if CLAUDE_DESKTOP_CONFIG.exists():
        shutil.copy2(CLAUDE_DESKTOP_CONFIG, backup)
        loaded = json.loads(CLAUDE_DESKTOP_CONFIG.read_text(encoding="utf-8"))
        current = loaded if isinstance(loaded, dict) else {}
    incoming = json.loads(generated.read_text(encoding="utf-8"))
    servers = dict(current.get("mcpServers", {})) if isinstance(current.get("mcpServers"), dict) else {}
    servers.update(incoming.get("mcpServers", {}))
    current["mcpServers"] = servers
    CLAUDE_DESKTOP_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    CLAUDE_DESKTOP_CONFIG.write_text(json.dumps(current, indent=2), encoding="utf-8")
    print(json.dumps({"desktopConfigInstalled": True, "server": "vintrace", "backupCreated": backup.exists()}, indent=2))


def merge_runs(base: Path, overlay: Path, target: Path) -> None:
    base = base.expanduser().resolve()
    overlay = overlay.expanduser().resolve()
    target = target.expanduser().resolve()
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(base, target)
    base_rows = json.loads((target / "runs.json").read_text(encoding="utf-8"))
    overlay_rows = json.loads((overlay / "runs.json").read_text(encoding="utf-8"))
    rows = {row["workflowId"]: row for row in base_rows}
    for row in overlay_rows:
        workflow_id = row["workflowId"]
        rows[workflow_id] = row
        for folder, suffix in (("traces", ".jsonl"), ("stdout", ".jsonl"), ("stdout", ".stderr.txt")):
            source = overlay / folder / f"{workflow_id}{suffix}"
            if source.exists():
                destination = target / folder / source.name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
    ordered = [rows[workflow["id"]] for workflow in workflows() if workflow["id"] in rows]
    (target / "runs.json").write_text(json.dumps(ordered, indent=2), encoding="utf-8")
    print(json.dumps({"merged": len(ordered), "target": str(target)}, indent=2))


def trace_calls(path: Path) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []
    if not path.exists():
        return calls
    responses: dict[Any, dict[str, Any]] = {}
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        events.append(event)
        message = event.get("message", {})
        if event.get("direction") == "server_to_client" and message.get("id") is not None:
            responses[message.get("id")] = {"message": message, "at": event.get("at")}
    for event in events:
        message = event.get("message", {})
        if event.get("direction") == "client_to_server" and message.get("method") == "tools/call":
            params = message.get("params", {})
            response_event = responses.get(message.get("id"), {})
            response = response_event.get("message", {}) if isinstance(response_event.get("message"), dict) else {}
            result = response.get("result", {}) if isinstance(response.get("result"), dict) else {}
            structured = result.get("structuredContent", {}) if isinstance(result.get("structuredContent"), dict) else {}
            latency_seconds: float | None = None
            try:
                started = datetime.fromisoformat(str(event.get("at")))
                finished = datetime.fromisoformat(str(response_event.get("at")))
                latency_seconds = max(0.0, (finished - started).total_seconds())
            except (TypeError, ValueError):
                pass
            calls.append({
                "at": event.get("at"),
                "completedAt": response_event.get("at"),
                "latencySeconds": latency_seconds,
                "name": params.get("name", ""),
                "arguments": params.get("arguments", {}),
                "result": structured,
                "transportError": response.get("error"),
            })
    return calls


def score_client(client: str) -> dict[str, Any]:
    client_root = ROOT / "runs" / client
    run_path = client_root / "runs.json"
    run_rows = json.loads(run_path.read_text(encoding="utf-8")) if run_path.exists() else []
    run_by_id = {row["workflowId"]: row for row in run_rows}
    expected = json.loads((client_root / "expected.json").read_text(encoding="utf-8")) if (client_root / "expected.json").exists() else {"tags": {}}
    rows: list[dict[str, Any]] = []
    for workflow in workflows():
        workflow_id = workflow["id"]
        calls = trace_calls(client_root / "traces" / f"{workflow_id}.jsonl")
        names = [call["name"] for call in calls]
        run = run_by_id.get(workflow_id, {})
        first_ok = bool(names and names[0] in workflow.get("expectedFirst", []))
        allowed = set(workflow.get("allowed", []))
        allowed_count = sum(name in allowed for name in names)
        selection_precision = allowed_count / len(names) if names else 0.0
        selection_ok = first_ok and allowed_count == len(names) and len(names) <= int(workflow.get("maxCalls", 99))
        search_accepted: bool | None = None
        if workflow.get("search"):
            tag = workflow["search"]["expectedTag"]
            expected_ids = set(expected.get("tags", {}).get(tag, []))
            returned_ids: set[str] = set()
            for call in calls:
                if call["name"] != "search_images":
                    continue
                items = call.get("result", {}).get("data", {}).get("items", [])
                returned_ids.update(str(item.get("assetId", "")) for item in items if isinstance(item, dict))
            accepted_count = len(expected_ids & returned_ids)
            search_accepted = accepted_count >= int(workflow["search"].get("minimumAccepted", 1))
        artifact = bool(workflow.get("artifact"))
        artifact_call = next((
            index for index, call in enumerate(calls, start=1)
            if call["name"] == "run_image_write_action"
            and call.get("result", {}).get("ok") is True
            and call.get("result", {}).get("action") == "export_photo_contact_sheet"
        ), None)
        approval_denials = sum(
            call.get("result", {}).get("error", {}).get("code") == "confirmation_required"
            for call in calls
        )
        confirmed_writes = sum(
            call["name"] in {"run_image_write_action", "run_destructive_image_action"}
            and call.get("arguments", {}).get("confirm") is True
            for call in calls
        )
        host_approval_clicks = int(run.get("hostApprovalClicks", 0) or 0)
        service_seconds = sum(float(call.get("latencySeconds") or 0.0) for call in calls)
        elapsed_seconds = run.get("elapsedSeconds")
        rows.append({
            "workflowId": workflow_id,
            "connected": bool(calls),
            "toolCalls": names,
            "callCount": len(names),
            "firstToolAccurate": first_ok,
            "selectionAccurate": selection_ok,
            "toolSelectionPrecision": selection_precision,
            "searchAccepted": search_accepted,
            "artifactExpected": artifact,
            "artifactProduced": artifact_call is not None if artifact else None,
            "callsToArtifact": artifact_call if artifact else None,
            "approvalDenials": approval_denials,
            "confirmedWrites": confirmed_writes,
            "hostApprovalClicks": host_approval_clicks,
            "serviceSeconds": round(service_seconds, 3),
            "modelAndClientSeconds": (
                round(max(0.0, float(elapsed_seconds) - service_seconds), 3)
                if elapsed_seconds is not None else None
            ),
            "elapsedSeconds": elapsed_seconds,
            "exitCode": run.get("exitCode"),
        })
    completed = [row for row in rows if row["elapsedSeconds"] is not None]
    search_rows = [row for row in completed if row["searchAccepted"] is not None]
    artifact_rows = [row for row in completed if row["artifactExpected"]]
    produced_artifact_rows = [row for row in artifact_rows if row["artifactProduced"]]
    scale_rows = [row for row in completed if row["workflowId"] in ASSET_INTENSIVE_WORKFLOWS]
    mean_scale_seconds = (
        sum(float(row["elapsedSeconds"]) for row in scale_rows) / len(scale_rows) if scale_rows else None
    )
    manual_baseline = 1000 * MANUAL_REVIEW_SECONDS_PER_ASSET
    return {
        "client": client,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "workflowCount": len(rows),
        "completedCount": len(completed),
        "connectionSuccessRate": sum(row["connected"] for row in completed) / len(completed) if completed else 0,
        "firstToolAccuracy": sum(row["firstToolAccurate"] for row in completed) / len(completed) if completed else 0,
        "toolSelectionAccuracy": sum(row["selectionAccurate"] for row in completed) / len(completed) if completed else 0,
        "toolSelectionPrecision": (
            sum(float(row["toolSelectionPrecision"]) for row in completed) / len(completed) if completed else 0
        ),
        "searchAcceptanceRate": sum(bool(row["searchAccepted"]) for row in search_rows) / len(search_rows) if search_rows else None,
        "approvalDenials": sum(int(row["approvalDenials"]) for row in completed),
        "confirmedWrites": sum(int(row["confirmedWrites"]) for row in completed),
        "hostApprovalClicks": sum(int(row["hostApprovalClicks"]) for row in completed),
        "artifactWorkflowCount": len(artifact_rows),
        "artifactsProduced": len(produced_artifact_rows),
        "meanCallsToArtifact": (
            round(
                sum(int(row["callsToArtifact"]) for row in produced_artifact_rows)
                / len(produced_artifact_rows),
                3,
            )
            if produced_artifact_rows else None
        ),
        "totalElapsedSeconds": round(sum(float(row["elapsedSeconds"]) for row in completed), 3),
        "serviceSeconds": round(sum(float(row["serviceSeconds"]) for row in completed), 3),
        "modelAndClientSeconds": round(sum(float(row["modelAndClientSeconds"]) for row in completed), 3),
        "timeSavedPer1000Assets": {
            "kind": "modeled-operator-review-baseline",
            "assumptionSecondsPerAsset": MANUAL_REVIEW_SECONDS_PER_ASSET,
            "manualBaselineSeconds": manual_baseline,
            "meanAgentWorkflowSeconds": round(mean_scale_seconds, 3) if mean_scale_seconds is not None else None,
            "savedSeconds": round(manual_baseline - mean_scale_seconds, 3) if mean_scale_seconds is not None else None,
            "savedPercent": round((manual_baseline - mean_scale_seconds) / manual_baseline * 100, 2) if mean_scale_seconds is not None else None,
            "sampledWorkflowCount": len(scale_rows),
        },
        "toolCounts": dict(Counter(name for row in rows for name in row["toolCalls"])),
        "workflows": rows,
    }


def score() -> None:
    reports = [score_client(client) for client in CLIENTS]
    output = ROOT / "score.json"
    output.write_text(json.dumps({"clients": reports}, indent=2), encoding="utf-8")
    print(json.dumps({"score": str(output), "clients": [{k: report[k] for k in ("client", "completedCount", "connectionSuccessRate", "toolSelectionAccuracy", "searchAcceptanceRate")} for report in reports]}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("prepare")
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--client", required=True, choices=("codex", "claude-code"))
    run_parser.add_argument("--only", action="append")
    run_parser.add_argument("--reuse", action="store_true", help="Reuse the existing client workspace and replace only selected workflow evidence.")
    sub.add_parser("desktop-bundle")
    sub.add_parser("desktop-split")
    sub.add_parser("desktop-install")
    sub.add_parser("desktop-restore")
    merge_parser = sub.add_parser("merge")
    merge_parser.add_argument("--base", type=Path, required=True)
    merge_parser.add_argument("--overlay", type=Path, required=True)
    merge_parser.add_argument("--target", type=Path, required=True)
    sub.add_parser("score")
    args = parser.parse_args()
    if args.command == "prepare":
        prepare()
    elif args.command == "run":
        run_cli(args.client, set(args.only or []) or None, reuse=bool(args.reuse))
    elif args.command == "desktop-bundle":
        desktop_bundle()
    elif args.command == "desktop-split":
        split_desktop_trace()
    elif args.command == "desktop-install":
        install_desktop_config()
    elif args.command == "desktop-restore":
        install_desktop_config(restore=True)
    elif args.command == "merge":
        merge_runs(args.base, args.overlay, args.target)
    else:
        score()


if __name__ == "__main__":
    main()

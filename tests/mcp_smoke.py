from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import zipfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


EXPECTED_TOOLS = {
    "get_project_state",
    "set_workspace",
    "mark_consent",
    "enroll_reference_folder",
    "enroll_age_reference_set",
    "scan_folder",
    "scan_media_paths",
    "scan_image_paths",
    "analyze_folder",
    "probe_video_file",
    "assess_image",
    "review_candidate",
    "bulk_review_candidates",
    "set_candidate_note",
    "clear_review_queue",
    "purge_reviewed_candidates",
    "workspace_health",
    "read_audit_events",
    "purge_duplicate_candidates",
    "purge_old_candidates",
    "delete_reference",
    "delete_person",
    "rename_person",
    "clear_references",
    "save_settings",
    "export_review_report",
    "export_workspace_backup",
    "export_selected_candidates",
    "runtime_self_test",
}

EXPECTED_RESOURCES = {
    "crossage://state",
    "crossage://summary",
    "crossage://references",
    "crossage://candidates",
    "crossage://config",
    "crossage://audit",
    "crossage://agent-guide",
    "crossage://report",
}

EXPECTED_PROMPTS = {
    "triage_pending",
    "plan_multi_age_enrollment",
    "safe_mode_policy",
}


def tool_text(result) -> str:
    return "\n".join(str(getattr(item, "text", "")) for item in getattr(result, "content", [])).strip()


async def expect_tool_error(session: ClientSession, tool_name: str, arguments: dict, contains: str) -> None:
    try:
        result = await session.call_tool(tool_name, arguments)
    except Exception as exc:
        assert contains in str(exc), f"{tool_name} error did not contain {contains!r}: {exc!r}"
        return
    assert result.isError, f"{tool_name} should have required an explicit confirmation."
    assert contains in tool_text(result), f"{tool_name} error text did not contain {contains!r}: {tool_text(result)!r}"


async def smoke() -> None:
    root = Path.cwd()
    workspace = Path(tempfile.mkdtemp(prefix="crossage-mcp-smoke-")) / "workspace"
    env = os.environ.copy()
    env.update(
        {
            "PYTHONPATH": str(root),
            "CROSSAGE_FORCE_FALLBACK": "1",
            "CROSSAGE_WORKSPACE": str(workspace),
            "CROSSAGE_REGISTRY_HOME": str(workspace.parent / "registry"),
        }
    )
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "crossage_fr.mcp_server", "--workspace", str(workspace)],
        env=env,
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tools = await session.list_tools()
            resources = await session.list_resources()
            prompts = await session.list_prompts()
            tool_names = {tool.name for tool in tools.tools}
            resource_uris = {str(resource.uri) for resource in resources.resources}
            prompt_names = {prompt.name for prompt in prompts.prompts}
            missing_tools = EXPECTED_TOOLS - tool_names
            missing_resources = EXPECTED_RESOURCES - resource_uris
            missing_prompts = EXPECTED_PROMPTS - prompt_names
            assert not missing_tools, f"Missing MCP tools: {sorted(missing_tools)}"
            assert not missing_resources, f"Missing MCP resources: {sorted(missing_resources)}"
            assert not missing_prompts, f"Missing MCP prompts: {sorted(missing_prompts)}"

            result = await session.call_tool("get_project_state", {})
            assert not result.isError
            assert result.structuredContent
            assert result.structuredContent["workspace"] == str(workspace.resolve())
            assert result.structuredContent["workspaceMetadata"]["workspaceId"]
            assert result.structuredContent["safeMode"] is True

            audit = await session.call_tool("read_audit_events", {"limit": 10})
            assert not audit.isError
            assert audit.structuredContent
            assert "events" in audit.structuredContent

            self_test = await session.call_tool("runtime_self_test", {})
            assert not self_test.isError
            assert self_test.structuredContent
            check_names = {check["name"] for check in self_test.structuredContent["checks"]}
            assert {"Workspace write", "Recognition engine", "Image decoder", "Workspace health"} <= check_names
            assert self_test.structuredContent["generatedAt"]

            await expect_tool_error(session, "rename_person", {"old_name": "A", "new_name": "B"}, "confirm=True")
            await expect_tool_error(session, "purge_old_candidates", {"days": 1}, "confirm=True")
            await expect_tool_error(
                session,
                "save_settings",
                {
                    "confident": 0.4,
                    "likely": 0.28,
                    "relaxed_child": 0.2,
                    "quality_min": 0.15,
                    "cluster_min_size": 2,
                    "safe_mode": False,
                    "safe_mode_threshold": 0.58,
                },
                "confirm=True",
            )

            purged = await session.call_tool("purge_old_candidates", {"days": 1, "confirm": True})
            assert not purged.isError
            assert purged.structuredContent["purged"] == 0
            assert purged.structuredContent["state"]["workspace"] == str(workspace.resolve())

            backup = await session.call_tool("export_workspace_backup", {"include_generated": False})
            assert not backup.isError
            assert backup.structuredContent
            backup_value = backup.structuredContent["backup"]
            backup_path = Path(backup_value["zipPath"])
            assert backup_path.exists()
            assert backup_value["fileCount"] >= 1
            assert backup_value["bytes"] > 0
            with zipfile.ZipFile(backup_path) as archive:
                assert "backup-manifest.json" in archive.namelist()

            report = await session.read_resource("crossage://report")
            assert report.contents
            report_text = getattr(report.contents[0], "text", "")
            assert "report.md is not available" not in report_text
            assert "CrossAge" in report_text or "face" in report_text.lower()


if __name__ == "__main__":
    asyncio.run(smoke())

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult


def server_parameters(root: Path, workspace: Path, registry: Path) -> StdioServerParameters:
    env = os.environ.copy()
    env.update({
        "PYTHONPATH": str(root),
        "CROSSAGE_FORCE_FALLBACK": "1",
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
        "VINTRACE_MCP_OPERATOR_TOKEN": "task-restart-operator",
        "VINTRACE_MCP_ALLOWED_ROOTS": str(workspace.parent),
    })
    executable = str(os.environ.get("VINTRACE_MCP_TEST_EXECUTABLE", "") or "").strip()
    if executable:
        env.pop("PYTHONPATH", None)
        return StdioServerParameters(
            command=str(Path(executable).expanduser().resolve()),
            args=["--mcp", "--workspace", str(workspace)],
            env=env,
        )
    return StdioServerParameters(
        command=sys.executable,
        args=["-m", "crossage_fr.mcp_server", "--workspace", str(workspace)],
        env=env,
    )


async def create_completed_task(params: StdioServerParameters, workspace: Path) -> str:
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            await session.call_tool("set_workspace", {"path": str(workspace)})
            consent = await session.call_tool(
                "mark_consent",
                {
                    "confirmed": True,
                    "operator": "MCP task restart test",
                    "confirm": True,
                    "operator_token": "task-restart-operator",
                },
            )
            assert not consent.isError
            created = await session.experimental.call_tool_as_task(
                "run_image_write_action",
                {
                    "action": "save_photo_album",
                    "payload": {"name": "Restart-safe MCP task", "albumKind": "manual"},
                    "confirm": True,
                    "idempotency_key": "mcp-task-restart-album-v1",
                },
                ttl=120_000,
            )
            task_id = created.task.taskId
            for _ in range(100):
                status = await session.experimental.get_task(task_id)
                if status.status == "completed":
                    return task_id
                assert status.status == "working", status
                await asyncio.sleep(0.05)
            raise AssertionError("MCP task did not complete before restart.")


async def verify_after_restart(params: StdioServerParameters, task_id: str, workspace: Path) -> None:
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            status = await session.experimental.get_task(task_id)
            assert status.status == "completed"
            listed = await session.experimental.list_tasks()
            assert any(task.taskId == task_id for task in listed.tasks)
            result = await session.experimental.get_task_result(task_id, CallToolResult)
            assert not result.isError and result.structuredContent["ok"] is True
            serialized = json.dumps(result.structuredContent, sort_keys=True)
            assert str(workspace.resolve()) not in serialized


async def exercise() -> None:
    root = Path.cwd()
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-task-restart-") as tmp:
        workspace = Path(tmp) / "workspace"
        params = server_parameters(root, workspace, Path(tmp) / "registry")
        task_id = await create_completed_task(params, workspace)
        database = workspace / "agent" / "mcp_tasks.sqlite3"
        assert database.is_file() and database.stat().st_size > 0
        await verify_after_restart(params, task_id, workspace)


def main() -> None:
    asyncio.run(exercise())
    print("ok MCP task status, listing, result, owner scope, and SQLite state survive server restart")


if __name__ == "__main__":
    main()

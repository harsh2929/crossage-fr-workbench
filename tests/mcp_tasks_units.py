from __future__ import annotations

import asyncio
from pathlib import Path
import tempfile

from mcp.shared.exceptions import McpError
from mcp.types import (
    INVALID_PARAMS,
    CallToolResult,
    CancelTaskRequest,
    CancelTaskRequestParams,
    GetTaskRequest,
    GetTaskRequestParams,
    ListTasksRequest,
    PaginatedRequestParams,
    TaskMetadata,
    TextContent,
)

from crossage_fr.mcp_tasks import SQLiteMcpTaskStore
from crossage_fr import mcp_server


async def exercise() -> None:
    owner = {"value": "principal-a"}
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-tasks-") as tmp:
        database = Path(tmp) / "mcp_tasks.sqlite3"
        store = SQLiteMcpTaskStore(database, owner=lambda: owner["value"], page_size=1)
        interrupted = await store.create_task(TaskMetadata(ttl=60_000), "task-interrupted")
        linked = await store.create_task(TaskMetadata(ttl=60_000), "task-linked")
        await store.set_linkage(linked.taskId, {"jobType": "indexing", "jobId": "job-7"})
        await store.update_task(interrupted.taskId, status_message="running")

        first_page, cursor = await store.list_tasks()
        assert len(first_page) == 1 and cursor
        second_page, next_cursor = await store.list_tasks(cursor)
        assert len(second_page) == 1 and next_cursor is None

        owner["value"] = "principal-b"
        assert await store.get_task(interrupted.taskId) is None
        assert await store.list_tasks() == ([], None)
        owner["value"] = "principal-a"

        restarted = SQLiteMcpTaskStore(database, owner=lambda: owner["value"], page_size=10)

        async def resolve(linkage):
            assert linkage == {"jobId": "job-7", "jobType": "indexing"}
            result = CallToolResult(
                content=[TextContent(type="text", text="done")],
                structuredContent={"ok": True, "jobId": "job-7", "status": "completed"},
            )
            return "completed", "Indexing completed.", result

        restarted.set_link_resolver(resolve)
        interrupted_after_restart = await restarted.get_task(interrupted.taskId)
        assert interrupted_after_restart and interrupted_after_restart.status == "failed"
        interrupted_result = await restarted.get_result(interrupted.taskId)
        assert isinstance(interrupted_result, CallToolResult) and interrupted_result.isError

        linked_after_restart = await restarted.get_task(linked.taskId)
        assert linked_after_restart and linked_after_restart.status == "completed"
        linked_result = await restarted.get_result(linked.taskId)
        assert isinstance(linked_result, CallToolResult)
        assert linked_result.structuredContent["jobId"] == "job-7"
        try:
            await restarted.update_task(linked.taskId, status="working")
        except ValueError as exc:
            assert "terminal status" in str(exc)
        else:
            raise AssertionError("Terminal MCP task status must be immutable.")

        assert await restarted.delete_task(linked.taskId)
        assert await restarted.get_task(linked.taskId) is None

        terminal = await restarted.create_task(TaskMetadata(ttl=60_000), "task-terminal")
        await restarted.update_task(terminal.taskId, status="completed")
        terminal_result = CallToolResult(content=[TextContent(type="text", text="original result")])
        await restarted.store_result(terminal.taskId, terminal_result)

        original_store = mcp_server.MCP_TASK_STORE
        mcp_server.MCP_TASK_STORE = restarted
        try:
            missing_requests = (
                (mcp_server._get_mcp_task, GetTaskRequest(params=GetTaskRequestParams(taskId="missing"))),
                (mcp_server._cancel_mcp_task, CancelTaskRequest(params=CancelTaskRequestParams(taskId="missing"))),
            )
            for handler, request in missing_requests:
                try:
                    await handler(request)
                except McpError as exc:
                    assert exc.error.code == INVALID_PARAMS
                    assert exc.error.message == "Task not found."
                else:
                    raise AssertionError("Missing MCP tasks must return INVALID_PARAMS.")
            try:
                await mcp_server._list_mcp_tasks(
                    ListTasksRequest(params=PaginatedRequestParams(cursor="invalid-cursor"))
                )
            except McpError as exc:
                assert exc.error.code == INVALID_PARAMS
            else:
                raise AssertionError("Invalid MCP task cursors must return INVALID_PARAMS.")
            try:
                await mcp_server._cancel_mcp_task(
                    CancelTaskRequest(params=CancelTaskRequestParams(taskId=terminal.taskId))
                )
            except McpError as exc:
                assert exc.error.code == INVALID_PARAMS
                assert "terminal" in exc.error.message.lower()
            else:
                raise AssertionError("Terminal MCP tasks must reject cancellation.")
            preserved_result = await restarted.get_result(terminal.taskId)
            assert preserved_result == terminal_result
        finally:
            mcp_server.MCP_TASK_STORE = original_store


def main() -> None:
    asyncio.run(exercise())
    indexing_result = CallToolResult(
        content=[],
        structuredContent={"ok": True, "data": {"job": {"jobId": "index-job-1", "status": "queued"}}},
    )
    assert mcp_server._task_link_for_call(
        "run_image_write_action",
        {"action": "enqueue_photo_indexing_job"},
        indexing_result,
    ) == {
        "jobType": "indexing",
        "jobId": "index-job-1",
        "tool": "run_image_write_action",
        "action": "enqueue_photo_indexing_job",
    }
    export_result = CallToolResult(
        content=[],
        structuredContent={"ok": True, "data": {"jobId": "export-job-1", "status": "running"}},
    )
    assert mcp_server._task_link_for_call(
        "run_image_write_action",
        {"action": "start_photo_export_job"},
        export_result,
    )["jobType"] == "export"
    assert mcp_server._mcp_request_requirements({"method": "tasks/get", "params": {"taskId": "opaque"}}) == [
        ("images:read", "tasks/get")
    ]
    assert mcp_server._mcp_request_requirements({"method": "tasks/cancel", "params": {"taskId": "opaque"}}) == [
        ("images:write", "tasks/cancel")
    ]
    print("ok durable MCP task owner isolation, pagination, restart reconciliation, results, and terminal states")


if __name__ == "__main__":
    main()

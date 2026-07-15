from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import secrets
import sqlite3
from typing import Any

import anyio
from mcp.shared.experimental.tasks.helpers import create_task_state, is_terminal
from mcp.shared.experimental.tasks.store import TaskStore
from mcp.types import CallToolResult, Result, Task, TaskMetadata, TaskStatus


TaskLinkResolver = Callable[[dict[str, Any]], Awaitable[tuple[TaskStatus | None, str, Result | None]]]


class SQLiteMcpTaskStore(TaskStore):
    """Principal-scoped durable MCP task state for one Vintrace workspace."""

    def __init__(
        self,
        database_path: Path,
        *,
        owner: Callable[[], str],
        page_size: int = 50,
        default_ttl_ms: int = 3_600_000,
        max_ttl_ms: int = 86_400_000,
    ) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.owner = owner
        self.page_size = max(1, min(100, int(page_size)))
        self.default_ttl_ms = max(1_000, int(default_ttl_ms))
        self.max_ttl_ms = max(self.default_ttl_ms, int(max_ttl_ms))
        self.run_id = secrets.token_hex(16)
        self._events: dict[str, anyio.Event] = {}
        self._link_resolver: TaskLinkResolver | None = None
        self._initialize()
        self._fail_unlinked_restart_tasks()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.database_path), timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_tasks (
                    task_id TEXT PRIMARY KEY,
                    owner TEXT NOT NULL,
                    task_json TEXT NOT NULL,
                    result_json TEXT,
                    result_type TEXT,
                    expires_at REAL NOT NULL,
                    linkage_json TEXT,
                    run_id TEXT NOT NULL
                )
                """
            )
            connection.execute("CREATE INDEX IF NOT EXISTS idx_mcp_tasks_owner_expiry ON mcp_tasks(owner, expires_at)")

    @staticmethod
    def _task_json(task: Task) -> str:
        return json.dumps(task.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))

    @staticmethod
    def _task_from_row(row: sqlite3.Row) -> Task:
        return Task.model_validate(json.loads(str(row["task_json"])))

    def _clamped_metadata(self, metadata: TaskMetadata) -> TaskMetadata:
        ttl = self.default_ttl_ms if metadata.ttl is None else int(metadata.ttl)
        return TaskMetadata(ttl=max(1_000, min(self.max_ttl_ms, ttl)))

    @staticmethod
    def _expiry(task: Task) -> float:
        ttl = int(task.ttl or 0)
        return (task.createdAt + timedelta(milliseconds=ttl)).timestamp()

    def _cleanup_expired(self) -> None:
        now = datetime.now(timezone.utc).timestamp()
        with self._connect() as connection:
            connection.execute("DELETE FROM mcp_tasks WHERE expires_at <= ?", (now,))

    def _owned_row(self, task_id: str) -> sqlite3.Row | None:
        self._cleanup_expired()
        with self._connect() as connection:
            return connection.execute(
                "SELECT * FROM mcp_tasks WHERE task_id = ? AND owner = ?",
                (str(task_id), self.owner()),
            ).fetchone()

    def _write_task(self, task: Task, *, result: Result | None = None) -> None:
        result_json = None
        result_type = None
        if result is not None:
            result_json = json.dumps(result.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":"))
            result_type = result.__class__.__name__
        expires_at = (
            (datetime.now(timezone.utc) + timedelta(milliseconds=int(task.ttl or self.default_ttl_ms))).timestamp()
            if is_terminal(task.status)
            else self._expiry(task)
        )
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE mcp_tasks
                SET task_json = ?, result_json = COALESCE(?, result_json),
                    result_type = COALESCE(?, result_type), expires_at = ?, run_id = ?
                WHERE task_id = ? AND owner = ?
                """,
                (
                    self._task_json(task),
                    result_json,
                    result_type,
                    expires_at,
                    self.run_id,
                    task.taskId,
                    self.owner(),
                ),
            )

    def _fail_unlinked_restart_tasks(self) -> None:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM mcp_tasks WHERE run_id != ? AND linkage_json IS NULL",
                (self.run_id,),
            ).fetchall()
            for row in rows:
                task = self._task_from_row(row)
                if task.status != "working":
                    continue
                task.status = "failed"
                task.statusMessage = "The server restarted before this non-durable operation completed."
                task.lastUpdatedAt = datetime.now(timezone.utc)
                error = CallToolResult(
                    isError=True,
                    content=[],
                    structuredContent={"ok": False, "error": {"code": "task_interrupted", "message": task.statusMessage}},
                )
                connection.execute(
                    "UPDATE mcp_tasks SET task_json = ?, result_json = ?, result_type = ?, expires_at = ?, run_id = ? WHERE task_id = ?",
                    (
                        self._task_json(task),
                        json.dumps(error.model_dump(mode="json", by_alias=True), sort_keys=True, separators=(",", ":")),
                        "CallToolResult",
                        (datetime.now(timezone.utc) + timedelta(milliseconds=int(task.ttl or self.default_ttl_ms))).timestamp(),
                        self.run_id,
                        task.taskId,
                    ),
                )

    def set_link_resolver(self, resolver: TaskLinkResolver) -> None:
        self._link_resolver = resolver

    async def set_linkage(self, task_id: str, linkage: dict[str, Any]) -> None:
        row = self._owned_row(task_id)
        if row is None:
            raise ValueError(f"Task with ID {task_id} not found")
        with self._connect() as connection:
            connection.execute(
                "UPDATE mcp_tasks SET linkage_json = ?, run_id = ? WHERE task_id = ? AND owner = ?",
                (json.dumps(linkage, sort_keys=True, separators=(",", ":")), self.run_id, task_id, self.owner()),
            )

    async def get_linkage(self, task_id: str) -> dict[str, Any] | None:
        row = self._owned_row(task_id)
        if row is None or not row["linkage_json"]:
            return None
        value = json.loads(str(row["linkage_json"]))
        return value if isinstance(value, dict) else None

    async def _refresh_linked(self, row: sqlite3.Row) -> sqlite3.Row:
        if self._link_resolver is None or not row["linkage_json"]:
            return row
        task = self._task_from_row(row)
        if is_terminal(task.status):
            return row
        linkage = json.loads(str(row["linkage_json"]))
        status, message, result = await self._link_resolver(linkage)
        if status is None:
            return row
        task.status = status
        task.statusMessage = message or task.statusMessage
        task.lastUpdatedAt = datetime.now(timezone.utc)
        self._write_task(task, result=result)
        await self.notify_update(task.taskId)
        refreshed = self._owned_row(task.taskId)
        if refreshed is None:
            raise ValueError(f"Task with ID {task.taskId} not found")
        return refreshed

    async def create_task(self, metadata: TaskMetadata, task_id: str | None = None) -> Task:
        self._cleanup_expired()
        normalized = self._clamped_metadata(metadata)
        task = create_task_state(normalized, task_id or f"vtask_{secrets.token_urlsafe(24)}")
        with self._connect() as connection:
            try:
                connection.execute(
                    "INSERT INTO mcp_tasks(task_id, owner, task_json, expires_at, run_id) VALUES(?, ?, ?, ?, ?)",
                    (task.taskId, self.owner(), self._task_json(task), self._expiry(task), self.run_id),
                )
            except sqlite3.IntegrityError as exc:
                raise ValueError(f"Task with ID {task.taskId} already exists") from exc
        return Task.model_validate(task.model_dump())

    async def get_task(self, task_id: str) -> Task | None:
        row = self._owned_row(task_id)
        if row is None:
            return None
        row = await self._refresh_linked(row)
        return self._task_from_row(row)

    async def update_task(
        self,
        task_id: str,
        status: TaskStatus | None = None,
        status_message: str | None = None,
    ) -> Task:
        row = self._owned_row(task_id)
        if row is None:
            raise ValueError(f"Task with ID {task_id} not found")
        task = self._task_from_row(row)
        if status is not None and status != task.status and is_terminal(task.status):
            raise ValueError(f"Cannot transition from terminal status '{task.status}'")
        status_changed = status is not None and status != task.status
        if status is not None:
            task.status = status
        if status_message is not None:
            task.statusMessage = status_message
        task.lastUpdatedAt = datetime.now(timezone.utc)
        self._write_task(task)
        if status_changed:
            await self.notify_update(task_id)
        return Task.model_validate(task.model_dump())

    async def store_result(self, task_id: str, result: Result) -> None:
        row = self._owned_row(task_id)
        if row is None:
            raise ValueError(f"Task with ID {task_id} not found")
        self._write_task(self._task_from_row(row), result=result)

    async def get_result(self, task_id: str) -> Result | None:
        row = self._owned_row(task_id)
        if row is None or not row["result_json"]:
            return None
        data = json.loads(str(row["result_json"]))
        if str(row["result_type"] or "") == "CallToolResult":
            return CallToolResult.model_validate(data)
        return Result.model_validate(data)

    async def list_tasks(self, cursor: str | None = None) -> tuple[list[Task], str | None]:
        self._cleanup_expired()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM mcp_tasks WHERE owner = ? ORDER BY rowid DESC",
                (self.owner(),),
            ).fetchall()
        start = 0
        if cursor:
            ids = [str(row["task_id"]) for row in rows]
            if cursor not in ids:
                raise ValueError("Invalid task cursor.")
            start = ids.index(cursor) + 1
        page = rows[start : start + self.page_size]
        tasks = [self._task_from_row(await self._refresh_linked(row)) for row in page]
        next_cursor = str(page[-1]["task_id"]) if start + self.page_size < len(rows) and page else None
        return tasks, next_cursor

    async def delete_task(self, task_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM mcp_tasks WHERE task_id = ? AND owner = ?",
                (task_id, self.owner()),
            )
        self._events.pop(task_id, None)
        return cursor.rowcount > 0

    async def wait_for_update(self, task_id: str) -> None:
        if self._owned_row(task_id) is None:
            raise ValueError(f"Task with ID {task_id} not found")
        event = anyio.Event()
        self._events[task_id] = event
        with anyio.move_on_after(0.5):
            await event.wait()

    async def notify_update(self, task_id: str) -> None:
        event = self._events.pop(task_id, None)
        if event is not None:
            event.set()

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable
import json
import os
import uuid


REGISTRY_ENV = "VINTRACE_REGISTRY_HOME"
LEGACY_REGISTRY_ENV = "CROSSAGE_REGISTRY_HOME"
WORKSPACE_ENV = "VINTRACE_WORKSPACE"
LEGACY_WORKSPACE_ENV = "CROSSAGE_WORKSPACE"


def now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def registry_root() -> Path:
    configured = os.environ.get(REGISTRY_ENV) or os.environ.get(LEGACY_REGISTRY_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    return (Path.home() / ".vintrace").resolve()


def active_workspace_path() -> Path:
    return registry_root() / "active-workspace.json"


def workspace_marker_path(workspace: Path) -> Path:
    return workspace.expanduser().resolve() / ".vintrace-workspace.json"


def legacy_workspace_marker_path(workspace: Path) -> Path:
    return workspace.expanduser().resolve() / ".crossage-workspace.json"


def _fsync_dir(directory: Path) -> None:
    # ER-02: fsync the containing directory so the rename itself is durable.
    # Opening a directory O_RDONLY is not supported on Windows — skip there.
    try:
        fd = os.open(str(directory), os.O_RDONLY)
    except (OSError, ValueError):
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def restrict_file_mode(path: Path, mode: int = 0o600) -> None:
    # MISS-05: biometric-adjacent files/dirs should not be world-readable. Best
    # effort: os.chmod only toggles the read-only bit on Windows, which is fine.
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def atomic_write(path: Path, writer: Callable[[Any], None], *, fsync: bool = True) -> None:
    """Atomically write a file: stream content via ``writer(handle)`` to a temp
    file, flush+fsync it, then ``os.replace`` into place and fsync the directory.

    ER-02/MA-6: the single implementation of the atomic-write-with-durability
    mechanism. Callers keep their own serialization (compact / indented /
    streamed) and just supply the writer, so the durability fix lives in one
    place instead of being duplicated (and missing fsync) across modules.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    restrict_file_mode(path.parent, 0o700)  # MISS-05
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        writer(handle)
        handle.flush()
        if fsync:
            os.fsync(handle.fileno())
    restrict_file_mode(temp, 0o600)  # MISS-05: set before it becomes the live file
    os.replace(temp, path)
    if fsync:
        _fsync_dir(path.parent)


def atomic_write_text(path: Path, text: str, *, fsync: bool = True) -> None:
    atomic_write(path, lambda handle: handle.write(text), fsync=fsync)


def write_json_atomic(path: Path, value: object) -> None:
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True))


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def ensure_workspace_metadata(workspace: Path, actor: str = "backend") -> dict[str, Any]:
    resolved = workspace.expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    marker = workspace_marker_path(resolved)
    existing = read_json_object(marker)
    if not existing:
        existing = read_json_object(legacy_workspace_marker_path(resolved))
    created_at = str(existing.get("createdAt") or now_iso())
    workspace_id = str(existing.get("workspaceId") or f"ws_{uuid.uuid4().hex[:12]}")
    metadata = {
        "schemaVersion": 1,
        "workspaceId": workspace_id,
        "path": str(resolved),
        "createdAt": created_at,
        "updatedAt": now_iso(),
        "lastOpenedBy": actor,
    }
    write_json_atomic(marker, metadata)
    return metadata


def workspace_list_path() -> Path:
    return registry_root() / "workspace-list.json"


def _read_workspace_list() -> list[dict[str, Any]]:
    payload = read_json_object(workspace_list_path())
    entries = payload.get("workspaces")
    if isinstance(entries, list):
        return [entry for entry in entries if isinstance(entry, dict) and entry.get("path")]
    # Migrate from the single active-workspace pointer the first time a list is needed.
    active = read_json_object(active_workspace_path())
    path = active.get("workspace")
    if isinstance(path, str) and path.strip():
        resolved = str(Path(path).expanduser().resolve())
        return [
            {
                "workspaceId": str(active.get("workspaceId", "")),
                "path": resolved,
                "alias": Path(resolved).name,
                "lastOpenedAt": str(active.get("updatedAt") or now_iso()),
            }
        ]
    return []


def record_workspace(workspace: Path, metadata: dict[str, Any] | None = None) -> None:
    # Upsert a workspace into the known-workspace list so the desktop can offer a switcher.
    resolved = str(workspace.expanduser().resolve())
    entries = _read_workspace_list()
    workspace_id = str((metadata or {}).get("workspaceId", ""))
    for entry in entries:
        if entry.get("path") == resolved:
            entry["lastOpenedAt"] = now_iso()
            if workspace_id:
                entry["workspaceId"] = workspace_id
            entry.setdefault("alias", Path(resolved).name)
            break
    else:
        entries.append(
            {
                "workspaceId": workspace_id,
                "path": resolved,
                "alias": Path(resolved).name,
                "lastOpenedAt": now_iso(),
            }
        )
    entries = sorted(entries, key=lambda item: str(item.get("lastOpenedAt") or ""), reverse=True)[:50]
    write_json_atomic(workspace_list_path(), {"schemaVersion": 1, "workspaces": entries, "updatedAt": now_iso()})


def list_known_workspaces() -> list[dict[str, Any]]:
    active = read_active_workspace()
    active_str = str(active) if active else ""
    result: list[dict[str, Any]] = []
    for entry in _read_workspace_list():
        path = Path(str(entry.get("path"))).expanduser()
        available = workspace_marker_path(path).exists() or legacy_workspace_marker_path(path).exists()
        result.append(
            {
                "workspaceId": str(entry.get("workspaceId", "")),
                "path": str(path),
                "alias": str(entry.get("alias") or path.name),
                "lastOpenedAt": str(entry.get("lastOpenedAt", "")),
                "active": str(path) == active_str,
                "available": bool(available),
            }
        )
    result.sort(key=lambda item: str(item.get("lastOpenedAt") or ""), reverse=True)
    return result


def write_active_workspace(workspace: Path, actor: str, metadata: dict[str, Any] | None = None) -> None:
    resolved = workspace.expanduser().resolve()
    payload = {
        "schemaVersion": 1,
        "workspace": str(resolved),
        "workspaceId": str((metadata or {}).get("workspaceId", "")),
        "updatedAt": now_iso(),
        "lastOpenedBy": actor,
    }
    write_json_atomic(active_workspace_path(), payload)
    # Keep the known-workspace list in sync so switching/opening always lists the workspace.
    try:
        record_workspace(resolved, metadata)
    except OSError:
        pass


def read_active_workspace() -> Path | None:
    configured = os.environ.get(WORKSPACE_ENV) or os.environ.get(LEGACY_WORKSPACE_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    payload = read_json_object(active_workspace_path())
    workspace = payload.get("workspace")
    if isinstance(workspace, str) and workspace.strip():
        candidate = Path(workspace).expanduser().resolve()
        # MISS-02: the active-workspace pointer is a plain JSON file a second
        # process could plant to redirect processing at an arbitrary directory.
        # Only trust it if the target actually carries a Vintrace workspace marker
        # (a registered workspace always writes one); otherwise fall back.
        if workspace_marker_path(candidate).exists() or legacy_workspace_marker_path(candidate).exists():
            return candidate
    return None


def resolve_workspace(value: str | Path | None, fallback: str | Path = "vintrace_project") -> Path:
    if value:
        return Path(value).expanduser().resolve()
    active = read_active_workspace()
    if active:
        return active
    return Path(fallback).expanduser().resolve()

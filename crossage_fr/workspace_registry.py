from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
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


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")
    temp.replace(path)


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


def read_active_workspace() -> Path | None:
    configured = os.environ.get(WORKSPACE_ENV) or os.environ.get(LEGACY_WORKSPACE_ENV)
    if configured:
        return Path(configured).expanduser().resolve()
    payload = read_json_object(active_workspace_path())
    workspace = payload.get("workspace")
    if isinstance(workspace, str) and workspace.strip():
        return Path(workspace).expanduser().resolve()
    return None


def resolve_workspace(value: str | Path | None, fallback: str | Path = "vintrace_project") -> Path:
    if value:
        return Path(value).expanduser().resolve()
    active = read_active_workspace()
    if active:
        return active
    return Path(fallback).expanduser().resolve()

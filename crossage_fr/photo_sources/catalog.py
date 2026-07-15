from __future__ import annotations

from hashlib import sha256
import json
import sqlite3
from typing import Any, Iterable
import uuid

from crossage_fr.workspace_registry import now_iso

from .contracts import PhotoSourceLibrary, PhotoSourceScopes, json_safe


PHOTO_SOURCE_JOB_KINDS = {"preview", "import", "sync", "export", "revoke_consent"}
PHOTO_SOURCE_JOB_STATUSES = {"queued", "running", "completed", "failed", "cancelled"}


def photo_source_id(provider: str, library_id: str) -> str:
    token = f"{str(provider or '').strip().lower()}\n{str(library_id or '').strip()}"
    return f"photo_source_{sha256(token.encode('utf-8')).hexdigest()[:32]}"


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def _json_text(value: Any) -> str:
    body = json_safe(value)
    return json.dumps(body if isinstance(body, (dict, list)) else {}, separators=(",", ":"), sort_keys=True)


class PhotoSourceCatalog:
    def __init__(self, workspace_db: Any):
        self.db = workspace_db

    @staticmethod
    def source_row(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {}
        return {
            "sourceId": str(row["source_id"] or ""),
            "provider": str(row["provider"] or ""),
            "libraryId": str(row["library_id"] or ""),
            "rootPath": str(row["root_path"] or ""),
            "displayName": str(row["display_name"] or ""),
            "platform": str(row["platform"] or ""),
            "status": str(row["status"] or ""),
            "capabilities": _json_object(row["capabilities_json"]),
            "consent": _json_object(row["consent_json"]),
            "cursor": _json_object(row["cursor_json"]),
            "metadata": _json_object(row["metadata_json"]),
            "lastPreviewAt": str(row["last_preview_at"] or ""),
            "lastSyncAt": str(row["last_sync_at"] or ""),
            "createdAt": str(row["created_at"] or ""),
            "updatedAt": str(row["updated_at"] or ""),
        }

    @staticmethod
    def external_asset_row(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {}
        return {
            "provider": str(row["provider"] or ""),
            "libraryId": str(row["library_id"] or ""),
            "externalId": str(row["external_id"] or ""),
            "sourceId": str(row["source_id"] or ""),
            "assetId": str(row["asset_id"] or ""),
            "externalUpdatedAt": str(row["external_updated_at"] or ""),
            "state": str(row["state"] or ""),
            "syncSignature": str(row["sync_signature"] or ""),
            "metadata": _json_object(row["metadata_json"]),
            "firstSeenAt": str(row["first_seen_at"] or ""),
            "lastSeenAt": str(row["last_seen_at"] or ""),
        }

    @staticmethod
    def job_row(row: sqlite3.Row | None) -> dict[str, Any]:
        if row is None:
            return {}
        return {
            "jobId": str(row["job_id"] or ""),
            "sourceId": str(row["source_id"] or ""),
            "provider": str(row["provider"] or ""),
            "jobKind": str(row["job_kind"] or ""),
            "status": str(row["status"] or ""),
            "params": _json_object(row["params_json"]),
            "progress": _json_object(row["progress_json"]),
            "result": _json_object(row["result_json"]),
            "error": str(row["error"] or ""),
            "cancelRequested": bool(int(row["cancel_requested"] or 0)),
            "createdAt": str(row["created_at"] or ""),
            "updatedAt": str(row["updated_at"] or ""),
            "startedAt": str(row["started_at"] or ""),
            "completedAt": str(row["completed_at"] or ""),
        }

    def upsert_source(
        self,
        library: PhotoSourceLibrary,
        *,
        capabilities: dict[str, Any] | None = None,
        scopes: PhotoSourceScopes | None = None,
        platform_name: str = "",
        status: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.upsert_source(
                    library,
                    capabilities=capabilities,
                    scopes=scopes,
                    platform_name=platform_name,
                    status=status,
                    conn=local_conn,
                )
        source_id = photo_source_id(library.provider, library.library_id)
        now = now_iso()
        existing = conn.execute(
            "SELECT created_at, consent_json, cursor_json, metadata_json FROM photo_external_sources WHERE source_id = ? LIMIT 1",
            (source_id,),
        ).fetchone()
        created_at = str(existing["created_at"] or now) if existing else now
        consent = _json_object(existing["consent_json"]) if existing else {}
        if scopes is not None:
            consent = {
                "selectedScopes": scopes.to_dict(),
                "sensitiveScopes": sorted(scopes.selected_sensitive_scopes()),
                "recordedAt": now,
            }
        cursor = _json_object(existing["cursor_json"]) if existing else {}
        metadata = _json_object(existing["metadata_json"]) if existing else {}
        metadata.update(library.metadata)
        metadata.update({
            "modifiedAt": library.modified_at,
            "photosVersion": library.photos_version,
            "databaseVersion": library.database_version,
            "warnings": library.warnings,
        })
        conn.execute(
            """
            INSERT INTO photo_external_sources(
                source_id, provider, library_id, root_path, display_name, platform, status,
                capabilities_json, consent_json, cursor_json, metadata_json,
                last_preview_at, last_sync_at, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
                root_path=excluded.root_path,
                display_name=excluded.display_name,
                platform=excluded.platform,
                status=excluded.status,
                capabilities_json=excluded.capabilities_json,
                consent_json=excluded.consent_json,
                metadata_json=excluded.metadata_json,
                updated_at=excluded.updated_at
            """,
            (
                source_id,
                library.provider,
                library.library_id,
                library.path,
                library.name,
                platform_name,
                str(status or library.status or "ready"),
                _json_text(capabilities or {}),
                _json_text(consent),
                _json_text(cursor),
                _json_text(metadata),
                created_at,
                now,
            ),
        )
        return self.get_source(source_id, conn=conn)

    def get_source(self, source_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.get_source(source_id, conn=local_conn)
        row = conn.execute(
            "SELECT * FROM photo_external_sources WHERE source_id = ? LIMIT 1",
            (str(source_id or ""),),
        ).fetchone()
        return self.source_row(row)

    def source_for_library(
        self,
        provider: str,
        library_id: str,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.source_for_library(provider, library_id, conn=local_conn)
        row = conn.execute(
            "SELECT * FROM photo_external_sources WHERE provider = ? AND library_id = ? LIMIT 1",
            (str(provider or ""), str(library_id or "")),
        ).fetchone()
        return self.source_row(row)

    def list_sources(self, *, provider: str = "", conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.list_sources(provider=provider, conn=local_conn)
        clean_provider = str(provider or "").strip()
        if clean_provider:
            rows = conn.execute(
                "SELECT * FROM photo_external_sources WHERE provider = ? ORDER BY updated_at DESC, display_name ASC",
                (clean_provider,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM photo_external_sources ORDER BY updated_at DESC, display_name ASC"
            ).fetchall()
        return [self.source_row(row) for row in rows]

    def update_source_state(
        self,
        source_id: str,
        *,
        status: str | None = None,
        cursor: dict[str, Any] | None = None,
        metadata_patch: dict[str, Any] | None = None,
        previewed: bool = False,
        synced: bool = False,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.update_source_state(
                    source_id,
                    status=status,
                    cursor=cursor,
                    metadata_patch=metadata_patch,
                    previewed=previewed,
                    synced=synced,
                    conn=local_conn,
                )
        current = self.get_source(source_id, conn=conn)
        if not current:
            raise ValueError("Unknown photo source id.")
        now = now_iso()
        metadata = dict(current.get("metadata", {}))
        if isinstance(metadata_patch, dict):
            metadata.update(json_safe(metadata_patch))
        fields = ["updated_at = ?", "metadata_json = ?"]
        values: list[Any] = [now, _json_text(metadata)]
        if status is not None:
            fields.append("status = ?")
            values.append(str(status or "ready"))
        if cursor is not None:
            fields.append("cursor_json = ?")
            values.append(_json_text(cursor))
        if previewed:
            fields.append("last_preview_at = ?")
            values.append(now)
        if synced:
            fields.append("last_sync_at = ?")
            values.append(now)
        values.append(str(source_id or ""))
        conn.execute(
            f"UPDATE photo_external_sources SET {', '.join(fields)} WHERE source_id = ?",
            values,
        )
        return self.get_source(source_id, conn=conn)

    def external_asset(
        self,
        provider: str,
        library_id: str,
        external_id: str,
        *,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.external_asset(provider, library_id, external_id, conn=local_conn)
        row = conn.execute(
            """
            SELECT * FROM photo_asset_external_ids
            WHERE provider = ? AND library_id = ? AND external_id = ?
            LIMIT 1
            """,
            (provider, library_id, external_id),
        ).fetchone()
        return self.external_asset_row(row)

    def list_external_assets(
        self,
        source_id: str,
        *,
        states: Iterable[str] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.list_external_assets(source_id, states=states, conn=local_conn)
        clean_states = [str(state or "").strip() for state in (states or []) if str(state or "").strip()]
        args: list[Any] = [str(source_id or "")]
        where = "source_id = ?"
        if clean_states:
            where += f" AND state IN ({','.join('?' for _ in clean_states)})"
            args.extend(clean_states)
        rows = conn.execute(
            f"SELECT * FROM photo_asset_external_ids WHERE {where} ORDER BY external_id ASC",
            args,
        ).fetchall()
        return [self.external_asset_row(row) for row in rows]

    def upsert_external_asset(
        self,
        *,
        provider: str,
        library_id: str,
        external_id: str,
        source_id: str,
        asset_id: str = "",
        external_updated_at: str = "",
        state: str = "active",
        sync_signature: str = "",
        metadata: dict[str, Any] | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.upsert_external_asset(
                    provider=provider,
                    library_id=library_id,
                    external_id=external_id,
                    source_id=source_id,
                    asset_id=asset_id,
                    external_updated_at=external_updated_at,
                    state=state,
                    sync_signature=sync_signature,
                    metadata=metadata,
                    conn=local_conn,
                )
        now = now_iso()
        existing = self.external_asset(provider, library_id, external_id, conn=conn)
        first_seen = str(existing.get("firstSeenAt", "") or now)
        next_asset_id = str(asset_id or existing.get("assetId", "") or "")
        conn.execute(
            """
            INSERT INTO photo_asset_external_ids(
                provider, library_id, external_id, source_id, asset_id,
                external_updated_at, state, sync_signature, metadata_json,
                first_seen_at, last_seen_at
            ) VALUES(?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, library_id, external_id) DO UPDATE SET
                source_id=excluded.source_id,
                asset_id=COALESCE(excluded.asset_id, photo_asset_external_ids.asset_id),
                external_updated_at=excluded.external_updated_at,
                state=excluded.state,
                sync_signature=excluded.sync_signature,
                metadata_json=excluded.metadata_json,
                last_seen_at=excluded.last_seen_at
            """,
            (
                provider,
                library_id,
                external_id,
                source_id,
                next_asset_id,
                external_updated_at,
                state,
                sync_signature,
                _json_text(metadata or {}),
                first_seen,
                now,
            ),
        )
        return self.external_asset(provider, library_id, external_id, conn=conn)

    def enqueue_job(
        self,
        *,
        provider: str,
        job_kind: str,
        params: dict[str, Any],
        source_id: str = "",
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.enqueue_job(
                    provider=provider,
                    job_kind=job_kind,
                    params=params,
                    source_id=source_id,
                    conn=local_conn,
                )
        kind = str(job_kind or "").strip().lower()
        if kind not in PHOTO_SOURCE_JOB_KINDS:
            raise ValueError("Photo source job kind must be preview, import, sync, export, or revoke_consent.")
        now = now_iso()
        job_id = f"photo_source_job_{uuid.uuid4().hex}"
        conn.execute(
            """
            INSERT INTO photo_source_jobs(
                job_id, source_id, provider, job_kind, status, params_json,
                progress_json, result_json, error, cancel_requested,
                created_at, updated_at, started_at, completed_at
            ) VALUES(?, ?, ?, ?, 'queued', ?, '{}', '{}', '', 0, ?, ?, '', '')
            """,
            (job_id, source_id, provider, kind, _json_text(params), now, now),
        )
        return self.get_job(job_id, conn=conn)

    def get_job(self, job_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.get_job(job_id, conn=local_conn)
        row = conn.execute(
            "SELECT * FROM photo_source_jobs WHERE job_id = ? LIMIT 1",
            (str(job_id or ""),),
        ).fetchone()
        return self.job_row(row)

    def list_jobs(
        self,
        *,
        source_id: str = "",
        status: str = "",
        limit: int = 50,
        conn: sqlite3.Connection | None = None,
    ) -> list[dict[str, Any]]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.list_jobs(source_id=source_id, status=status, limit=limit, conn=local_conn)
        where: list[str] = []
        args: list[Any] = []
        if source_id:
            where.append("source_id = ?")
            args.append(source_id)
        if status and status != "all":
            where.append("status = ?")
            args.append(status)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        args.append(max(1, min(200, int(limit or 50))))
        rows = conn.execute(
            f"SELECT * FROM photo_source_jobs {where_sql} ORDER BY updated_at DESC, created_at DESC LIMIT ?",
            args,
        ).fetchall()
        return [self.job_row(row) for row in rows]

    def update_job(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: dict[str, Any] | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        cancel_requested: bool | None = None,
        started: bool = False,
        completed: bool = False,
        conn: sqlite3.Connection | None = None,
    ) -> dict[str, Any]:
        if conn is None:
            with self.db.connect() as local_conn:
                return self.update_job(
                    job_id,
                    status=status,
                    progress=progress,
                    result=result,
                    error=error,
                    cancel_requested=cancel_requested,
                    started=started,
                    completed=completed,
                    conn=local_conn,
                )
        current = self.get_job(job_id, conn=conn)
        if not current:
            raise ValueError("Unknown photo source job id.")
        now = now_iso()
        fields = ["updated_at = ?"]
        values: list[Any] = [now]
        if status is not None:
            clean_status = str(status or "").strip().lower()
            if clean_status not in PHOTO_SOURCE_JOB_STATUSES:
                raise ValueError("Unknown photo source job status.")
            fields.append("status = ?")
            values.append(clean_status)
        if progress is not None:
            fields.append("progress_json = ?")
            values.append(_json_text(progress))
        if result is not None:
            fields.append("result_json = ?")
            values.append(_json_text(result))
        if error is not None:
            fields.append("error = ?")
            values.append(str(error or "")[:2000])
        if cancel_requested is not None:
            fields.append("cancel_requested = ?")
            values.append(1 if cancel_requested else 0)
        if started:
            fields.append("started_at = ?")
            values.append(now)
        if completed:
            fields.append("completed_at = ?")
            values.append(now)
        values.append(str(job_id or ""))
        conn.execute(f"UPDATE photo_source_jobs SET {', '.join(fields)} WHERE job_id = ?", values)
        return self.get_job(job_id, conn=conn)

    def request_cancel(self, job_id: str) -> dict[str, Any]:
        job = self.get_job(job_id)
        if not job:
            raise ValueError("Unknown photo source job id.")
        if job.get("status") in {"completed", "failed", "cancelled"}:
            return job
        if job.get("status") == "queued":
            return self.update_job(
                job_id,
                status="cancelled",
                cancel_requested=True,
                completed=True,
                progress={**job.get("progress", {}), "message": "Cancelled before start."},
            )
        return self.update_job(job_id, cancel_requested=True)

    def delete_job(self, job_id: str) -> bool:
        job = self.get_job(job_id)
        if not job:
            return False
        if job.get("status") in {"queued", "running"}:
            raise ValueError("Cancel the photo source job before dismissing it.")
        with self.db.connect() as conn:
            cursor = conn.execute("DELETE FROM photo_source_jobs WHERE job_id = ?", (str(job_id or ""),))
            return int(cursor.rowcount or 0) > 0

    def recover_interrupted_jobs(self) -> list[dict[str, Any]]:
        now = now_iso()
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT job_id, progress_json FROM photo_source_jobs WHERE status = 'running'"
            ).fetchall()
            for row in rows:
                progress = _json_object(row["progress_json"])
                import_id = str(progress.get("importId", "") or "")
                if import_id:
                    session_row = conn.execute(
                        "SELECT metadata_json FROM photo_import_sessions WHERE import_id = ? LIMIT 1",
                        (import_id,),
                    ).fetchone()
                    if session_row is not None:
                        metadata = _json_object(session_row["metadata_json"])
                        metadata.update({
                            "interruptedAt": now,
                            "interruptedJobId": str(row["job_id"] or ""),
                            "recovery": "A replacement job was queued after restart.",
                        })
                        conn.execute(
                            """
                            UPDATE photo_import_sessions
                            SET status = 'interrupted', completed_at = ?, updated_at = ?, metadata_json = ?
                            WHERE import_id = ? AND status = 'running'
                            """,
                            (now, now, _json_text(metadata), import_id),
                        )
            conn.execute(
                """
                UPDATE photo_source_jobs
                SET status = 'queued',
                    error = 'Interrupted by application restart; queued for recovery.',
                    cancel_requested = 0,
                    started_at = '',
                    completed_at = '',
                    updated_at = ?
                WHERE status = 'running'
                """,
                (now,),
            )
            queued = conn.execute(
                "SELECT * FROM photo_source_jobs WHERE status = 'queued' ORDER BY created_at ASC"
            ).fetchall()
            return [self.job_row(row) for row in queued]

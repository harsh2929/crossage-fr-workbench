from __future__ import annotations

from datetime import datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
from typing import Any, Callable, Iterable
import uuid

from crossage_fr.store.workspace_db import path_signature
from crossage_fr.workspace_registry import now_iso

from .catalog import PhotoSourceCatalog
from .contracts import (
    NormalizedAlbum,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourceScopes,
    clean_strings,
    json_safe,
    scoped_sensitive_metadata,
)
from .credential_vault import ConnectorCredentialVault
from .dam_catalog_adapter import (
    CAPTURE_ONE_CATALOG_PROVIDER,
    DAM_CATALOG_PROVIDERS,
    LIGHTROOM_CATALOG_PROVIDER,
    build_dam_catalog_adapters,
)
from .osxphotos_adapter import APPLE_PHOTOS_PROVIDER, ApplePhotosAdapter
from .remote_connectors import (
    REMOTE_PHOTO_SOURCE_PROVIDERS,
    REMOTE_PROVIDER_ALIASES,
    REMOTE_PROVIDER_LABELS,
    build_remote_adapters,
)
from .windows_folder_adapter import WINDOWS_FOLDERS_PROVIDER, WindowsFolderAdapter


LOCAL_PHOTO_SOURCE_PROVIDERS = {APPLE_PHOTOS_PROVIDER, WINDOWS_FOLDERS_PROVIDER, *DAM_CATALOG_PROVIDERS}
PHOTO_SOURCE_PROVIDERS = LOCAL_PHOTO_SOURCE_PROVIDERS | REMOTE_PHOTO_SOURCE_PROVIDERS
SENSITIVE_PHOTO_SOURCE_SCOPES = {
    "peopleFaces",
    "preciseLocation",
    "hidden",
    "deleted",
    "shared",
    "commentsLikes",
}
PHOTO_SOURCE_PROVIDER_ALIASES = {
    "apple": APPLE_PHOTOS_PROVIDER,
    "apple-photos": APPLE_PHOTOS_PROVIDER,
    "apple_photos": APPLE_PHOTOS_PROVIDER,
    "osxphotos": APPLE_PHOTOS_PROVIDER,
    "windows": WINDOWS_FOLDERS_PROVIDER,
    "windows-photos": WINDOWS_FOLDERS_PROVIDER,
    "windows_photos": WINDOWS_FOLDERS_PROVIDER,
    "windows-folders": WINDOWS_FOLDERS_PROVIDER,
    "windows_folders": WINDOWS_FOLDERS_PROVIDER,
    "folder": WINDOWS_FOLDERS_PROVIDER,
    "folders": WINDOWS_FOLDERS_PROVIDER,
    "lightroom": LIGHTROOM_CATALOG_PROVIDER,
    "lightroom-classic": LIGHTROOM_CATALOG_PROVIDER,
    "lightroom_catalog": LIGHTROOM_CATALOG_PROVIDER,
    "lrcat": LIGHTROOM_CATALOG_PROVIDER,
    "capture-one": CAPTURE_ONE_CATALOG_PROVIDER,
    "capture_one": CAPTURE_ONE_CATALOG_PROVIDER,
    "capture_one_catalog": CAPTURE_ONE_CATALOG_PROVIDER,
    "cocatalog": CAPTURE_ONE_CATALOG_PROVIDER,
    **REMOTE_PROVIDER_ALIASES,
}


class PhotoSourceJobCancelled(RuntimeError):
    pass


def normalize_provider(value: Any) -> str:
    provider = str(value or "").strip().lower()
    provider = PHOTO_SOURCE_PROVIDER_ALIASES.get(provider, provider)
    if provider not in PHOTO_SOURCE_PROVIDERS:
        raise ValueError("Unknown photo source provider.")
    return provider


def _metadata_provider_key(provider: str) -> str:
    if provider == APPLE_PHOTOS_PROVIDER:
        return "applePhotos"
    if provider == WINDOWS_FOLDERS_PROVIDER:
        return "windowsFolders"
    if provider == LIGHTROOM_CATALOG_PROVIDER:
        return "lightroomCatalog"
    if provider == CAPTURE_ONE_CATALOG_PROVIDER:
        return "captureOneCatalog"
    parts = normalize_provider(provider).split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def _provider_display_name(provider: str) -> str:
    return {
        APPLE_PHOTOS_PROVIDER: "Apple Photos",
        WINDOWS_FOLDERS_PROVIDER: "Photo folders",
        LIGHTROOM_CATALOG_PROVIDER: "Lightroom Classic",
        CAPTURE_ONE_CATALOG_PROVIDER: "Capture One",
    }.get(provider, REMOTE_PROVIDER_LABELS.get(provider, "Photo source"))


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def _json_text(value: Any) -> str:
    return json.dumps(json_safe(value), separators=(",", ":"), sort_keys=True)


def _safe_filename(value: str, fallback: str = "photo") -> str:
    name = re.sub(r"[^A-Za-z0-9._ -]+", "_", str(value or "")).strip(" .")
    return (name or fallback)[:180]


def _path_inside(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


class PhotoSourceService:
    def __init__(
        self,
        workspace_db: Any,
        workspace_root: str | Path,
        *,
        adapters: dict[str, Any] | None = None,
        platform_name: str = "",
        credential_vault: ConnectorCredentialVault | None = None,
    ) -> None:
        self.db = workspace_db
        self.workspace_root = Path(workspace_root).expanduser().resolve()
        self.catalog = PhotoSourceCatalog(workspace_db)
        self.platform_name = platform_name
        self.credential_vault = credential_vault or ConnectorCredentialVault(self.workspace_root)
        self.adapters = adapters or {
            APPLE_PHOTOS_PROVIDER: ApplePhotosAdapter(platform_name=platform_name or None),
            WINDOWS_FOLDERS_PROVIDER: WindowsFolderAdapter(platform_name=platform_name or None),
            **build_dam_catalog_adapters(),
            **build_remote_adapters(
                allow_private_test=str(os.environ.get("VINTRACE_CONNECTOR_ALLOW_PRIVATE_TEST", "")).strip() == "1",
            ),
        }
        self._restore_remote_connectors()

    def _restore_remote_connectors(self) -> None:
        for source in self.catalog.list_sources():
            provider = str(source.get("provider", "") or "")
            if provider not in REMOTE_PHOTO_SOURCE_PROVIDERS:
                continue
            metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
            config = metadata.get("connectorConfig") if isinstance(metadata.get("connectorConfig"), dict) else {}
            connection_id = str(metadata.get("connectionId", config.get("connectionId", "")) or "").strip()
            if not connection_id or not config:
                continue
            credential = self.credential_vault.load(provider, connection_id)
            try:
                self.adapter(provider).configure({**config, "connectionId": connection_id, "credential": credential})
            except Exception:
                self.catalog.update_source_state(
                    str(source.get("sourceId", "")),
                    status="credentials_required",
                    metadata_patch={"configured": False},
                )
            else:
                self.catalog.update_source_state(
                    str(source.get("sourceId", "")),
                    status="ready",
                    metadata_patch={"configured": True},
                )

    def adapter(self, provider: Any) -> Any:
        clean_provider = normalize_provider(provider)
        adapter = self.adapters.get(clean_provider)
        if adapter is None:
            raise ValueError(f"Photo source adapter is not configured: {clean_provider}.")
        return adapter

    def status(self) -> dict[str, Any]:
        providers = {
            provider: self.adapter(provider).status()
            for provider in sorted(PHOTO_SOURCE_PROVIDERS)
        }
        return {
            "providers": providers,
            "sources": self.catalog.list_sources(),
            "jobs": self.catalog.list_jobs(limit=20),
            "readOnlySources": True,
            "networkAccess": "none-by-default; explicit-read-only for configured remote connectors",
        }

    def configure_connector(self, provider: Any, params: dict[str, Any]) -> dict[str, Any]:
        clean_provider = normalize_provider(provider)
        if clean_provider not in REMOTE_PHOTO_SOURCE_PROVIDERS:
            raise ValueError("Only remote inbound connectors require configuration.")
        adapter = self.adapter(clean_provider)
        library = adapter.configure(params)
        connection_id = str(library.metadata.get("connectionId", "") or "")
        credential = adapter.connection_credential(connection_id)
        credential_persisted = False
        credential_error = ""
        if credential:
            try:
                credential_persisted = self.credential_vault.store(clean_provider, connection_id, credential)
            except Exception as exc:
                credential_error = str(exc)
        source = self.catalog.upsert_source(
            library,
            capabilities=adapter.status().get("capabilities", {}),
            scopes=PhotoSourceScopes.from_params(params),
            platform_name=self.platform_name,
        )
        return {
            "provider": clean_provider,
            "connectionId": connection_id,
            "library": library.to_dict(),
            "source": source,
            "credentialConfigured": True,
            "credentialPersistence": "os-vault" if credential_persisted else "desktop-session" if credential else "not-required",
            "credentialPersistenceError": credential_error,
        }

    def forget_connector(self, provider: Any, connection_id: str) -> dict[str, Any]:
        clean_provider = normalize_provider(provider)
        if clean_provider not in REMOTE_PHOTO_SOURCE_PROVIDERS:
            raise ValueError("Only remote inbound connectors can be forgotten.")
        clean_id = str(connection_id or "").strip()
        removed = bool(self.adapter(clean_provider).forget(clean_id))
        credential_removed = False
        try:
            credential_removed = self.credential_vault.delete(clean_provider, clean_id)
        except Exception:
            credential_removed = False
        sources = self.catalog.list_sources(provider=clean_provider)
        affected = []
        for source in sources:
            metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
            if str(metadata.get("connectionId", "") or "") != clean_id:
                continue
            affected.append(self.catalog.update_source_state(
                str(source.get("sourceId", "")),
                status="credentials_required",
                metadata_patch={"configured": False},
            ))
        return {
            "provider": clean_provider,
            "connectionId": clean_id,
            "forgotten": removed or credential_removed,
            "credentialForgotten": credential_removed,
            "sources": affected,
        }

    def discover_libraries(self, provider: Any) -> dict[str, Any]:
        clean_provider = normalize_provider(provider)
        adapter = self.adapter(clean_provider)
        libraries = adapter.discover_libraries()
        return {
            "provider": clean_provider,
            "status": adapter.status(),
            "libraries": [library.to_dict() for library in libraries],
            "configuredSources": self.catalog.list_sources(provider=clean_provider),
        }

    def list_people_hints(self, params: dict[str, Any] | None = None) -> dict[str, Any]:
        body = params if isinstance(params, dict) else {}
        status = str(body.get("status", "pending") or "pending").strip().lower()
        if status not in {"all", "pending", "accepted", "rejected"}:
            raise ValueError("People hint status must be all, pending, accepted, or rejected.")
        source_id = str(body.get("sourceId", "") or "").strip()
        provider_filter = str(body.get("provider", "") or "").strip()
        hint_id = str(body.get("hintId", "") or "").strip()
        query = str(body.get("query", "") or "").strip().casefold()
        limit = max(1, min(500, int(body.get("limit", 100) or 100)))
        offset = max(0, int(body.get("offset", 0) or 0))
        where = ["1 = 1"]
        args: list[Any] = []
        if status != "all":
            where.append("h.status = ?")
            args.append(status)
        if source_id:
            where.append("e.source_id = ?")
            args.append(source_id)
        if provider_filter:
            where.append("h.provider = ?")
            args.append(normalize_provider(provider_filter))
        if hint_id:
            where.append("h.hint_id = ?")
            args.append(hint_id)
        if query:
            where.append("(LOWER(h.person_name) LIKE ? OR LOWER(a.source_path) LIKE ?)")
            token = f"%{query}%"
            args.extend((token, token))
        where_sql = " AND ".join(where)
        with self.db.connect() as conn:
            total_row = conn.execute(
                f"""
                SELECT COUNT(*) AS count
                FROM photo_external_people_hints AS h
                JOIN photo_assets AS a ON a.asset_id = h.asset_id
                LEFT JOIN photo_asset_external_ids AS e
                  ON e.provider = h.provider
                 AND e.library_id = h.library_id
                 AND e.external_id = h.external_asset_id
                WHERE {where_sql}
                """,
                args,
            ).fetchone()
            rows = conn.execute(
                f"""
                SELECT h.*, a.source_path, a.media_kind, e.source_id
                FROM photo_external_people_hints AS h
                JOIN photo_assets AS a ON a.asset_id = h.asset_id
                LEFT JOIN photo_asset_external_ids AS e
                  ON e.provider = h.provider
                 AND e.library_id = h.library_id
                 AND e.external_id = h.external_asset_id
                WHERE {where_sql}
                ORDER BY h.updated_at DESC, h.person_name ASC, h.hint_id ASC
                LIMIT ? OFFSET ?
                """,
                [*args, limit, offset],
            ).fetchall()
            counts = {
                str(row["status"] or "pending"): int(row["count"] or 0)
                for row in conn.execute(
                    "SELECT status, COUNT(*) AS count FROM photo_external_people_hints GROUP BY status"
                ).fetchall()
            }
        hints = [
            {
                "hintId": str(row["hint_id"] or ""),
                "assetId": str(row["asset_id"] or ""),
                "sourceId": str(row["source_id"] or ""),
                "provider": str(row["provider"] or ""),
                "libraryId": str(row["library_id"] or ""),
                "externalAssetId": str(row["external_asset_id"] or ""),
                "externalPersonId": str(row["external_person_id"] or ""),
                "externalFaceId": str(row["external_face_id"] or ""),
                "personName": str(row["person_name"] or ""),
                "status": str(row["status"] or "pending"),
                "region": _json_object(row["region_json"]),
                "metadata": _json_object(row["metadata_json"]),
                "sourcePath": str(row["source_path"] or ""),
                "filename": Path(str(row["source_path"] or "")).name,
                "mediaKind": str(row["media_kind"] or ""),
                "createdAt": str(row["created_at"] or ""),
                "updatedAt": str(row["updated_at"] or ""),
            }
            for row in rows
        ]
        return {
            "hints": hints,
            "total": int(total_row["count"] or 0) if total_row else 0,
            "limit": limit,
            "offset": offset,
            "counts": counts,
        }

    def review_people_hint(self, params: dict[str, Any]) -> dict[str, Any]:
        hint_id = str(params.get("hintId", "") or "").strip()
        if not hint_id:
            raise ValueError("hintId is required.")
        decision = str(params.get("decision", params.get("status", "")) or "").strip().lower()
        decision = "rejected" if decision in {"dismiss", "dismissed", "reject"} else decision
        decision = "accepted" if decision in {"accept", "approve", "approved"} else decision
        if decision not in {"accepted", "rejected"}:
            raise ValueError("People hint decision must be accepted or rejected.")
        requested_name = str(params.get("personName", "") or "").strip()
        now = now_iso()
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT * FROM photo_external_people_hints WHERE hint_id = ? LIMIT 1",
                (hint_id,),
            ).fetchone()
            if row is None:
                raise ValueError("Unknown photo-source people hint.")
            person_name = requested_name or str(row["person_name"] or "").strip()
            if decision == "accepted" and not person_name:
                raise ValueError("personName is required when accepting a people hint.")
            conn.execute(
                "UPDATE photo_external_people_hints SET person_name = ?, status = ?, updated_at = ? WHERE hint_id = ?",
                (person_name, decision, now, hint_id),
            )
            candidate_id = f"external_hint:{hint_id}"
            conn.execute(
                """
                UPDATE photo_asset_people
                SET person_name = ?, status = ?, updated_at = ?
                WHERE asset_id = ? AND candidate_id = ?
                """,
                (person_name, decision, now, str(row["asset_id"] or ""), candidate_id),
            )
            self.db._index_photo_asset(str(row["asset_id"] or ""), conn)  # noqa: SLF001
        reviewed = self.list_people_hints({"status": "all", "hintId": hint_id, "limit": 1})["hints"]
        if not reviewed:
            raise RuntimeError("Reviewed people hint could not be reloaded.")
        return reviewed[0]

    def _describe_library(self, adapter: Any, provider: str, path: str) -> PhotoSourceLibrary:
        if hasattr(adapter, "describe_library"):
            return adapter.describe_library(path)
        clean_path = str(Path(path).expanduser())
        discovered = adapter.discover_libraries()
        for library in discovered:
            try:
                if os.path.normcase(os.path.realpath(library.path)) == os.path.normcase(os.path.realpath(clean_path)):
                    return library
            except OSError:
                if library.path == clean_path:
                    return library
        if provider == APPLE_PHOTOS_PROVIDER:
            return adapter._library_descriptor(clean_path)  # noqa: SLF001
        return adapter._descriptor(Path(clean_path).expanduser())  # noqa: SLF001

    def preview(self, provider: Any, params: dict[str, Any]) -> dict[str, Any]:
        clean_provider = normalize_provider(provider)
        adapter = self.adapter(clean_provider)
        if hasattr(adapter, "configure_import"):
            adapter.configure_import(params)
        if clean_provider in REMOTE_PHOTO_SOURCE_PROVIDERS and (
            params.get("credential") or params.get("accessToken") or params.get("token") or params.get("urls") or params.get("baseUrl")
        ):
            configured = self.configure_connector(clean_provider, params)
            params = {**params, "libraryPath": configured["library"]["path"]}
        library_path = str(params.get("libraryPath", params.get("rootPath", "")) or "").strip()
        if not library_path:
            raise ValueError("libraryPath is required for photo-source preview.")
        scopes = PhotoSourceScopes.from_params(params)
        preview = adapter.preview(
            library_path,
            scopes,
            item_limit=int(params.get("itemLimit", 5_000) or 5_000),
            sample_limit=int(params.get("sampleLimit", 24) or 24),
            time_budget_ms=int(params.get("timeBudgetMs", 1_500) or 1_500),
        )
        source = self.catalog.upsert_source(
            preview.library,
            capabilities=preview.capabilities,
            scopes=scopes,
            platform_name=self.platform_name,
        )
        source = self.catalog.update_source_state(
            source["sourceId"],
            previewed=True,
            status="ready",
            metadata_patch={
                "lastPreview": {
                    "counts": preview.counts,
                    "complete": preview.complete,
                    "scannedCount": preview.scanned_count,
                    "unsupportedFields": preview.unsupported_fields,
                    "warnings": preview.warnings,
                }
            },
        )
        return {**preview.to_dict(), "source": source, "sourceId": source["sourceId"]}

    def enqueue_job(self, provider: Any, job_kind: str, params: dict[str, Any]) -> dict[str, Any]:
        clean_provider = normalize_provider(provider)
        kind = str(job_kind or "").strip().lower()
        if kind not in {"preview", "import", "sync", "export", "revoke_consent"}:
            raise ValueError("Photo source job kind must be preview, import, sync, export, or revoke_consent.")
        if kind == "revoke_consent":
            source_id = str(params.get("sourceId", "") or "").strip()
            source = self.catalog.get_source(source_id)
            if not source:
                raise ValueError("Unknown photo source id.")
            if source.get("provider") != clean_provider:
                raise ValueError("Photo source provider does not match sourceId.")
            requested = params.get("scopes", params.get("revokeScopes", []))
            if isinstance(requested, dict):
                revoke_scopes = {str(key) for key, selected in requested.items() if bool(selected)}
            elif isinstance(requested, list):
                revoke_scopes = {str(value) for value in requested if str(value or "").strip()}
            else:
                raise ValueError("Consent revocation scopes must be a list or object.")
            unknown = revoke_scopes - SENSITIVE_PHOTO_SOURCE_SCOPES
            if unknown:
                raise ValueError(f"Unknown sensitive photo-source scope(s): {', '.join(sorted(unknown))}.")
            if not revoke_scopes:
                raise ValueError("Select at least one sensitive photo-source scope to revoke.")
            return self.catalog.enqueue_job(
                provider=clean_provider,
                job_kind=kind,
                params={
                    "sourceId": source_id,
                    "revokeScopes": sorted(revoke_scopes),
                    "localCatalogOnly": True,
                },
                source_id=source_id,
            )
        adapter = self.adapter(clean_provider)
        if hasattr(adapter, "configure_import"):
            adapter.configure_import(params)
        if clean_provider in REMOTE_PHOTO_SOURCE_PROVIDERS and (
            params.get("credential") or params.get("accessToken") or params.get("token") or params.get("urls") or params.get("baseUrl")
        ):
            configured = self.configure_connector(clean_provider, params)
            params = {**params, "libraryPath": configured["library"]["path"]}
        library_path = str(params.get("libraryPath", params.get("rootPath", "")) or "").strip()
        if not library_path:
            raise ValueError("libraryPath is required for photo-source jobs.")
        scopes = PhotoSourceScopes.from_params(params) if kind in {"preview", "import", "sync"} else None
        if bool(params.get("allowPhotosExport", False)) and not bool(params.get("explicitCloudDownloadConsent", False)):
            raise ValueError("explicitCloudDownloadConsent is required before Photos may export cloud-only originals.")
        if clean_provider in REMOTE_PHOTO_SOURCE_PROVIDERS and kind in {"import", "sync"} and not bool(params.get("explicitExternalDownloadConsent", False)):
            raise ValueError("explicitExternalDownloadConsent is required before remote media may be downloaded.")
        library = self._describe_library(adapter, clean_provider, library_path)
        status = adapter.status()
        if not bool(status.get("available", False)):
            raise ValueError(str(status.get("error") or "This photo source is not available."))
        source = self.catalog.upsert_source(
            library,
            capabilities=status.get("capabilities", {}),
            scopes=scopes,
            platform_name=self.platform_name,
        )
        payload = dict(params)
        for key in ("credential", "accessToken", "token", "password", "authorization"):
            payload.pop(key, None)
        if clean_provider in REMOTE_PHOTO_SOURCE_PROVIDERS:
            payload["storageMode"] = "managed"
            payload["allowExternalDownload"] = True
        if scopes is not None:
            payload["scopes"] = scopes.to_dict()
            payload["sensitiveConsent"] = bool(scopes.selected_sensitive_scopes())
        payload["libraryPath"] = library.path
        payload["libraryId"] = library.library_id
        return self.catalog.enqueue_job(
            provider=clean_provider,
            job_kind=kind,
            params=payload,
            source_id=source["sourceId"],
        )

    def _emit_progress(
        self,
        job_id: str,
        progress: dict[str, Any],
        callback: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        job = self.catalog.update_job(job_id, progress=progress)
        if callback is not None:
            callback({"jobId": job_id, **progress})
        return job

    def _raise_if_cancelled(self, job_id: str) -> None:
        job = self.catalog.get_job(job_id)
        if bool(job.get("cancelRequested")) or job.get("status") == "cancelled":
            raise PhotoSourceJobCancelled("Photo source job was cancelled.")

    def run_job(
        self,
        job_id: str,
        *,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        job = self.catalog.get_job(job_id)
        if not job:
            raise ValueError("Unknown photo source job id.")
        if job.get("status") in {"completed", "failed", "cancelled"}:
            return job
        if job.get("cancelRequested"):
            return self.catalog.update_job(
                job_id,
                status="cancelled",
                completed=True,
                progress={"phase": "cancelled", "message": "Cancelled before start."},
            )
        self.catalog.update_job(
            job_id,
            status="running",
            started=True,
            error="",
            progress={
                "phase": "starting",
                "processed": 0,
                "message": "Preparing local consent revocation." if job.get("jobKind") == "revoke_consent" else "Opening photo source.",
            },
        )
        try:
            kind = str(job.get("jobKind", "") or "")
            if kind == "preview":
                result = self.preview(job["provider"], job["params"])
            elif kind in {"import", "sync"}:
                result = self._import_source(job, sync=kind == "sync", progress_callback=progress_callback)
            elif kind == "export":
                result = self._export_source_assets(job, progress_callback=progress_callback)
            elif kind == "revoke_consent":
                result = self._revoke_consent(job, progress_callback=progress_callback)
            else:
                raise ValueError("Unknown photo source job kind.")
            self._raise_if_cancelled(job_id)
            completion_progress = {
                **self.catalog.get_job(job_id).get("progress", {}),
                "phase": "completed",
                "message": "Photo source job completed.",
            }
            if kind == "preview":
                scanned_count = int(result.get("scannedCount", result.get("scanned_count", 0)) or 0)
                completion_progress.update({"processed": scanned_count, "total": scanned_count})
            return self.catalog.update_job(
                job_id,
                status="completed",
                result=result,
                completed=True,
                progress=completion_progress,
            )
        except PhotoSourceJobCancelled as exc:
            return self.catalog.update_job(
                job_id,
                status="cancelled",
                error=str(exc),
                completed=True,
                progress={
                    **self.catalog.get_job(job_id).get("progress", {}),
                    "phase": "cancelled",
                    "message": str(exc),
                },
            )
        except Exception as exc:
            self.catalog.update_source_state(job.get("sourceId", ""), status="error", metadata_patch={"lastError": str(exc)[:1000]})
            return self.catalog.update_job(
                job_id,
                status="failed",
                error=str(exc),
                completed=True,
                progress={
                    **self.catalog.get_job(job_id).get("progress", {}),
                    "phase": "failed",
                    "message": str(exc),
                },
            )

    def _create_import_session(
        self,
        *,
        job: dict[str, Any],
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
        storage_mode: str,
        sync: bool,
    ) -> str:
        import_id = f"source_import_{uuid.uuid4().hex}"
        now = now_iso()
        source_kind = (
            "library"
            if library.provider == APPLE_PHOTOS_PROVIDER
            else "catalog"
            if library.provider in DAM_CATALOG_PROVIDERS
            else "connector"
            if library.provider in REMOTE_PHOTO_SOURCE_PROVIDERS
            else "folder"
        )
        metadata = {
            "source": "external_photo_source_sync" if sync else "external_photo_source_import",
            "sourceId": job.get("sourceId", ""),
            "jobId": job.get("jobId", ""),
            "provider": library.provider,
            "libraryId": library.library_id,
            "libraryPath": library.path,
            "scopes": scopes.to_dict(),
            "sensitiveScopes": sorted(scopes.selected_sensitive_scopes()),
            "networkAccess": "explicit-remote-download" if job.get("params", {}).get("allowExternalDownload") else "explicit-photos-export" if job.get("params", {}).get("allowPhotosExport") else "none",
        }
        with self.db.connect() as conn:
            conn.execute(
                """
                INSERT INTO photo_import_sessions(
                    import_id, source_kind, storage_mode, source_label, root_path,
                    status, started_at, completed_at, updated_at,
                    imported_count, failed_count, metadata_json
                ) VALUES(?, ?, ?, ?, ?, 'running', ?, NULL, ?, 0, 0, ?)
                """,
                (
                    import_id,
                    source_kind,
                    storage_mode,
                    library.name or _provider_display_name(library.provider),
                    library.path,
                    now,
                    now,
                    _json_text(metadata),
                ),
            )
        return import_id

    def _finish_import_session(
        self,
        import_id: str,
        *,
        counts: dict[str, int],
        metadata: dict[str, Any],
        cancelled: bool = False,
    ) -> dict[str, Any]:
        now = now_iso()
        failed = int(counts.get("failed", 0) or 0)
        status = "cancelled" if cancelled else "completed_with_errors" if failed else "completed"
        with self.db.connect() as conn:
            row = conn.execute(
                "SELECT metadata_json FROM photo_import_sessions WHERE import_id = ? LIMIT 1",
                (import_id,),
            ).fetchone()
            current = _json_object(row["metadata_json"] if row else "{}")
            current.update(metadata)
            current["counts"] = counts
            conn.execute(
                """
                UPDATE photo_import_sessions
                SET status = ?, completed_at = ?, updated_at = ?,
                    imported_count = ?, failed_count = ?, metadata_json = ?
                WHERE import_id = ?
                """,
                (
                    status,
                    now,
                    now,
                    int(counts.get("imported", 0) + counts.get("updated", 0)),
                    failed,
                    _json_text(current),
                    import_id,
                ),
            )
            return self.db.photo_import_session_by_id(import_id, conn) or {}

    def _managed_source_root(self, params: dict[str, Any], source_id: str) -> Path:
        requested = str(params.get("managedRoot", params.get("managedFolder", "")) or "").strip()
        root = Path(requested).expanduser() if requested else self.workspace_root / "photo-library"
        target = root.resolve() / "external-sources" / _safe_filename(source_id, "source")
        target.mkdir(parents=True, exist_ok=True)
        return target

    def _managed_target(
        self,
        source: Path,
        asset: NormalizedPhotoAsset,
        managed_root: Path,
        existing_asset: dict[str, Any] | None,
    ) -> Path:
        if existing_asset and str(existing_asset.get("sourceKind", "")) == "managed":
            existing_path = Path(str(existing_asset.get("sourcePath", "") or "")).expanduser()
            if existing_path and _path_inside(existing_path, managed_root):
                existing_path.parent.mkdir(parents=True, exist_ok=True)
                return existing_path
        bucket = sha256(asset.external_id.encode("utf-8")).hexdigest()[:2]
        target_dir = managed_root / bucket
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = _safe_filename(asset.original_filename or asset.filename or source.name, f"{asset.external_id}{source.suffix}")
        target = target_dir / filename
        if target.exists():
            suffix = target.suffix
            target = target.with_name(f"{target.stem}-{sha256(asset.external_id.encode('utf-8')).hexdigest()[:8]}{suffix}")
        return target

    def _copy_variant(
        self,
        source_path: str,
        *,
        managed_root: Path,
        asset: NormalizedPhotoAsset,
        kind: str,
    ) -> str:
        source = Path(source_path).expanduser()
        if not source.is_file():
            return ""
        bucket = sha256(asset.external_id.encode("utf-8")).hexdigest()[:2]
        target_dir = managed_root / bucket / "variants"
        target_dir.mkdir(parents=True, exist_ok=True)
        filename = _safe_filename(source.name, f"{asset.external_id}-{kind}{source.suffix}")
        target = target_dir / filename
        if target.exists() and target.stat().st_size != source.stat().st_size:
            target = target.with_name(f"{target.stem}-{kind}{target.suffix}")
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        return str(target)

    def _record_import_failure(
        self,
        conn: sqlite3.Connection,
        *,
        import_id: str,
        asset: NormalizedPhotoAsset,
        reason: str,
        source_id: str,
    ) -> None:
        source_path = asset.primary_path() or f"{asset.provider}://{asset.library_id}/{asset.external_id}"
        self.db._record_photo_import_failure(  # noqa: SLF001
            conn,
            import_id=import_id,
            source_path=source_path,
            reason=reason,
        )
        self.catalog.upsert_external_asset(
            provider=asset.provider,
            library_id=asset.library_id,
            external_id=asset.external_id,
            source_id=source_id,
            external_updated_at=asset.modified_date,
            state="missing" if asset.missing else "error",
            sync_signature=asset.sync_signature(),
            metadata={
                "reason": reason,
                "hidden": asset.hidden,
                "deleted": asset.deleted,
                "lastImportId": import_id,
            },
            conn=conn,
        )

    def _provider_asset_metadata(
        self,
        asset: NormalizedPhotoAsset,
        *,
        import_id: str,
        source_id: str,
        storage_mode: str,
        prior: dict[str, Any],
        scopes: PhotoSourceScopes,
    ) -> dict[str, Any]:
        payload = asset.to_dict()
        for key, selected in (
            ("albums", scopes.albums_folders),
            ("keywords", scopes.keywords),
            ("labels", scopes.labels_ocr),
            ("ocrBlocks", scopes.labels_ocr),
            ("people", scopes.people_faces),
            ("faces", scopes.people_faces),
            ("location", scopes.precise_location),
            ("comments", scopes.comments_likes),
            ("likes", scopes.comments_likes),
        ):
            if not selected and key in prior:
                payload[key] = prior[key]
        for key, selected in (
            ("hidden", scopes.hidden),
            ("deleted", scopes.deleted),
            ("deletedAt", scopes.deleted),
            ("shared", scopes.shared),
        ):
            if not selected and key in prior:
                payload[key] = prior[key]
        previous_fields = prior.get("importedFields", {}) if isinstance(prior.get("importedFields"), dict) else {}
        raw_rating = asset.flags.get("catalogRating", asset.flags.get("xmpRating", 0))
        try:
            catalog_rating = max(0, min(5, int(raw_rating or 0)))
        except (TypeError, ValueError):
            catalog_rating = 0
        catalog_color_label = self.db._normalize_photo_color_label(  # noqa: SLF001
            asset.flags.get("catalogColorLabel", asset.flags.get("xmpColorLabel", ""))
        )
        catalog_pick_status = self.db._normalize_photo_pick_status(  # noqa: SLF001
            asset.flags.get("catalogPickStatus", asset.flags.get("xmpPickStatus", ""))
        )
        payload.update({
            "importId": import_id,
            "sourceId": source_id,
            "storageMode": storage_mode,
            "syncSignature": asset.sync_signature(),
            "lastImportedAt": now_iso(),
            "importedFields": {
                "title": asset.title,
                "caption": asset.caption,
                "favorite": asset.favorite if scopes.favorites else previous_fields.get("favorite", False),
                "rating": catalog_rating if scopes.favorites else previous_fields.get("rating", 0),
                "colorLabel": catalog_color_label if scopes.labels_ocr else previous_fields.get("colorLabel", ""),
                "pickStatus": catalog_pick_status if scopes.favorites else previous_fields.get("pickStatus", ""),
                "hidden": asset.hidden if scopes.hidden else previous_fields.get("hidden", False),
                "deletedAt": (asset.deleted_at if asset.deleted else "") if scopes.deleted else previous_fields.get("deletedAt", ""),
                "edited": asset.has_adjustments,
            },
        })
        preserved = {
            key: value
            for key, value in prior.items()
            if key.startswith("local") or key in {"userNotes", "reviewStatus"}
        }
        return {**payload, **preserved}

    def _apply_metadata_fields(
        self,
        conn: sqlite3.Connection,
        *,
        asset_id: str,
        asset: NormalizedPhotoAsset,
        previous_provider: dict[str, Any],
        first_import: bool,
        scopes: PhotoSourceScopes,
    ) -> None:
        row = conn.execute(
            "SELECT * FROM photo_asset_metadata WHERE asset_id = ? LIMIT 1",
            (asset_id,),
        ).fetchone()
        current = dict(row) if row is not None else {
            "title": "",
            "caption": "",
            "favorite": 0,
            "rating": 0,
            "color_label": "",
            "pick_status": "",
            "hidden": 0,
            "deleted_at": None,
            "date_override": None,
            "location_override_json": "{}",
            "location_hidden": 0,
            "edited": 0,
        }
        previous_fields = previous_provider.get("importedFields", {}) if isinstance(previous_provider.get("importedFields"), dict) else {}

        def next_text(column: str, field: str, incoming: str) -> str:
            value = str(current.get(column, "") or "")
            previous = str(previous_fields.get(field, "") or "")
            return incoming if first_import and not value or value == previous else value

        def next_bool(column: str, field: str, incoming: bool) -> bool:
            value = bool(current.get(column, 0))
            previous = bool(previous_fields.get(field, False))
            return incoming if first_import or value == previous else value

        def next_int(column: str, field: str, incoming: int) -> int:
            value = int(current.get(column, 0) or 0)
            previous = int(previous_fields.get(field, 0) or 0)
            return incoming if first_import or value == previous else value

        raw_rating = asset.flags.get("catalogRating", asset.flags.get("xmpRating", 0))
        try:
            incoming_rating = max(0, min(5, int(raw_rating or 0)))
        except (TypeError, ValueError):
            incoming_rating = 0
        incoming_color_label = self.db._normalize_photo_color_label(  # noqa: SLF001
            asset.flags.get("catalogColorLabel", asset.flags.get("xmpColorLabel", ""))
        )
        incoming_pick_status = self.db._normalize_photo_pick_status(  # noqa: SLF001
            asset.flags.get("catalogPickStatus", asset.flags.get("xmpPickStatus", ""))
        )

        current_deleted = str(current.get("deleted_at", "") or "")
        previous_deleted = str(previous_fields.get("deletedAt", "") or "")
        incoming_deleted = asset.deleted_at if asset.deleted else ""
        deleted_at = incoming_deleted if first_import or current_deleted == previous_deleted else current_deleted
        conn.execute(
            """
            INSERT INTO photo_asset_metadata(
                asset_id, title, caption, favorite, rating, color_label, pick_status,
                hidden, deleted_at, date_override,
                location_override_json, location_hidden, edited, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
                title=excluded.title,
                caption=excluded.caption,
                favorite=excluded.favorite,
                rating=excluded.rating,
                color_label=excluded.color_label,
                pick_status=excluded.pick_status,
                hidden=excluded.hidden,
                deleted_at=excluded.deleted_at,
                edited=excluded.edited,
                updated_at=excluded.updated_at
            """,
            (
                asset_id,
                next_text("title", "title", asset.title),
                next_text("caption", "caption", asset.caption),
                int(next_bool("favorite", "favorite", asset.favorite)) if scopes.favorites else int(bool(current.get("favorite", 0))),
                next_int("rating", "rating", incoming_rating) if scopes.favorites else int(current.get("rating", 0) or 0),
                next_text("color_label", "colorLabel", incoming_color_label) if scopes.labels_ocr else str(current.get("color_label", "") or ""),
                next_text("pick_status", "pickStatus", incoming_pick_status) if scopes.favorites else str(current.get("pick_status", "") or ""),
                int(next_bool("hidden", "hidden", asset.hidden)) if scopes.hidden else int(bool(current.get("hidden", 0))),
                deleted_at if scopes.deleted else current_deleted,
                current.get("date_override"),
                str(current.get("location_override_json", "{}") or "{}"),
                int(bool(current.get("location_hidden", 0))),
                int(next_bool("edited", "edited", asset.has_adjustments)),
                now_iso(),
            ),
        )

    def _sync_keywords(
        self,
        conn: sqlite3.Connection,
        *,
        asset_id: str,
        asset: NormalizedPhotoAsset,
    ) -> None:
        provider = asset.provider
        library_id = asset.library_id
        external_id = asset.external_id
        existing_rows = conn.execute(
            """
            SELECT s.keyword_id, s.was_preexisting
            FROM photo_asset_keyword_sources AS s
            WHERE s.asset_id = ? AND s.provider = ? AND s.library_id = ? AND s.external_asset_id = ?
            """,
            (asset_id, provider, library_id, external_id),
        ).fetchall()
        existing_sources = {str(row["keyword_id"]): bool(row["was_preexisting"]) for row in existing_rows}
        next_ids: set[str] = set()
        now = now_iso()
        for name in clean_strings(asset.keywords, limit=256, max_length=64):
            row = conn.execute(
                "SELECT keyword_id FROM photo_keywords WHERE LOWER(name) = LOWER(?) LIMIT 1",
                (name,),
            ).fetchone()
            keyword_id = str(row["keyword_id"] or "") if row else self.db._photo_keyword_id(name)  # noqa: SLF001
            if row is None:
                conn.execute(
                    "INSERT OR IGNORE INTO photo_keywords(keyword_id, name, shortcut, created_at, updated_at) VALUES(?, ?, '', ?, ?)",
                    (keyword_id, name, now, now),
                )
            assignment = conn.execute(
                "SELECT 1 FROM photo_asset_keywords WHERE asset_id = ? AND keyword_id = ? LIMIT 1",
                (asset_id, keyword_id),
            ).fetchone()
            was_preexisting = bool(assignment) and keyword_id not in existing_sources
            conn.execute(
                "INSERT OR IGNORE INTO photo_asset_keywords(asset_id, keyword_id, assigned_at) VALUES(?, ?, ?)",
                (asset_id, keyword_id, now),
            )
            conn.execute(
                """
                INSERT INTO photo_asset_keyword_sources(
                    asset_id, keyword_id, provider, library_id, external_asset_id, was_preexisting, last_seen_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(asset_id, keyword_id, provider, library_id, external_asset_id) DO UPDATE SET
                    last_seen_at=excluded.last_seen_at
                """,
                (asset_id, keyword_id, provider, library_id, external_id, int(was_preexisting), now),
            )
            next_ids.add(keyword_id)
        for keyword_id, was_preexisting in existing_sources.items():
            if keyword_id in next_ids:
                continue
            conn.execute(
                """
                DELETE FROM photo_asset_keyword_sources
                WHERE asset_id = ? AND keyword_id = ? AND provider = ? AND library_id = ? AND external_asset_id = ?
                """,
                (asset_id, keyword_id, provider, library_id, external_id),
            )
            other = conn.execute(
                "SELECT 1 FROM photo_asset_keyword_sources WHERE asset_id = ? AND keyword_id = ? LIMIT 1",
                (asset_id, keyword_id),
            ).fetchone()
            if not was_preexisting and other is None:
                conn.execute(
                    "DELETE FROM photo_asset_keywords WHERE asset_id = ? AND keyword_id = ?",
                    (asset_id, keyword_id),
                )

    def _sync_location(self, conn: sqlite3.Connection, *, asset_id: str, asset: NormalizedPhotoAsset) -> None:
        if not asset.location:
            return
        try:
            latitude = float(asset.location["latitude"])
            longitude = float(asset.location["longitude"])
        except (KeyError, TypeError, ValueError):
            return
        place = asset.location.get("place", {})
        if isinstance(place, dict):
            label = ", ".join(
                str(place.get(key, "") or "").strip()
                for key in ("name", "city", "state", "country")
                if str(place.get(key, "") or "").strip()
            )
        else:
            label = str(place or "")
        current = conn.execute(
            "SELECT source FROM photo_asset_locations WHERE asset_id = ? LIMIT 1",
            (asset_id,),
        ).fetchone()
        if current is not None and str(current["source"] or "") not in {"", asset.provider}:
            return
        conn.execute(
            """
            INSERT INTO photo_asset_locations(asset_id, latitude, longitude, source, label, indexed_at)
            VALUES(?, ?, ?, ?, ?, ?)
            ON CONFLICT(asset_id) DO UPDATE SET
                latitude=excluded.latitude,
                longitude=excluded.longitude,
                source=excluded.source,
                label=excluded.label,
                indexed_at=excluded.indexed_at
            """,
            (asset_id, latitude, longitude, asset.provider, label[:500], now_iso()),
        )

    def _sync_labels_and_ocr(self, conn: sqlite3.Connection, *, asset_id: str, asset: NormalizedPhotoAsset) -> None:
        conn.execute("DELETE FROM photo_object_tags WHERE asset_id = ? AND source = ?", (asset_id, asset.provider))
        now = now_iso()
        for label in clean_strings(asset.labels, limit=1000, max_length=200):
            tag_id = f"tag_{sha256(f'{asset.provider}:{asset.library_id}:{asset.external_id}:{label.casefold()}'.encode('utf-8')).hexdigest()[:32]}"
            conn.execute(
                """
                INSERT OR REPLACE INTO photo_object_tags(tag_id, asset_id, label, source, confidence, bounds_json, created_at)
                VALUES(?, ?, ?, ?, NULL, '{}', ?)
                """,
                (tag_id, asset_id, label, asset.provider, now),
            )
        conn.execute("DELETE FROM photo_ocr_blocks WHERE asset_id = ? AND source = ?", (asset_id, asset.provider))
        for index, block in enumerate(asset.ocr_blocks[:10_000]):
            text = str(block.get("text", "") or "").strip()
            if not text:
                continue
            block_id = str(block.get("id", "") or "") or f"ocr_{sha256(f'{asset.provider}:{asset.external_id}:{index}:{text}'.encode('utf-8')).hexdigest()[:32]}"
            confidence = block.get("confidence")
            try:
                confidence = float(confidence) if confidence is not None else None
            except (TypeError, ValueError):
                confidence = None
            conn.execute(
                """
                INSERT OR REPLACE INTO photo_ocr_blocks(
                    block_id, asset_id, text, language, confidence, bounds_json, source, metadata_json, created_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    block_id,
                    asset_id,
                    text,
                    str(block.get("language", "") or "") or None,
                    confidence,
                    _json_text(block.get("bounds", {})),
                    asset.provider,
                    _json_text({"libraryId": asset.library_id, "externalId": asset.external_id}),
                    now,
                ),
            )

    def _sync_people_hints(self, conn: sqlite3.Connection, *, asset_id: str, asset: NormalizedPhotoAsset) -> None:
        now = now_iso()
        seen_hint_ids: set[str] = set()
        people_by_id = {person.person_id: person for person in asset.people if person.person_id}
        for index, face in enumerate(asset.faces):
            person = people_by_id.get(face.person_id)
            person_name = str(face.person_name or (person.name if person else "") or "").strip()
            if not person_name:
                continue
            face_id = str(face.face_id or f"face_{index}")
            existing_hint = conn.execute(
                """
                SELECT hint_id FROM photo_external_people_hints
                WHERE provider = ? AND library_id = ? AND external_asset_id = ? AND external_face_id = ?
                ORDER BY updated_at DESC LIMIT 1
                """,
                (asset.provider, asset.library_id, asset.external_id, face_id),
            ).fetchone()
            hint_id = str(existing_hint["hint_id"] or "") if existing_hint else ""
            if not hint_id:
                hint_id = f"hint_{sha256(f'{asset.provider}:{asset.library_id}:{asset.external_id}:{face_id}'.encode('utf-8')).hexdigest()[:32]}"
            seen_hint_ids.add(hint_id)
            metadata = {
                "provider": asset.provider,
                "libraryId": asset.library_id,
                "externalAssetId": asset.external_id,
                "externalPersonId": face.person_id,
                "externalFaceId": face_id,
                "manual": face.manual,
                "quality": face.quality,
                "roll": face.roll,
                "pitch": face.pitch,
                "yaw": face.yaw,
                **face.metadata,
            }
            conn.execute(
                """
                INSERT INTO photo_external_people_hints(
                    hint_id, asset_id, provider, library_id, external_asset_id,
                    external_person_id, external_face_id, person_name, status,
                    region_json, metadata_json, created_at, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
                ON CONFLICT(hint_id) DO UPDATE SET
                    asset_id=excluded.asset_id,
                    person_name=excluded.person_name,
                    region_json=excluded.region_json,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    hint_id,
                    asset_id,
                    asset.provider,
                    asset.library_id,
                    asset.external_id,
                    face.person_id,
                    face_id,
                    person_name,
                    _json_text(face.region),
                    _json_text(metadata),
                    now,
                    now,
                ),
            )
            candidate_id = f"external_hint:{hint_id}"
            conn.execute(
                """
                INSERT INTO photo_asset_people(
                    asset_id, candidate_id, person_name, status, score, quality, band, source, metadata_json, updated_at
                ) VALUES(?, ?, ?, 'pending', 0, ?, 'external_hint', ?, ?, ?)
                ON CONFLICT(asset_id, candidate_id) DO UPDATE SET
                    person_name=excluded.person_name,
                    quality=excluded.quality,
                    band='external_hint',
                    source=excluded.source,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    asset_id,
                    candidate_id,
                    person_name,
                    float(face.quality or 0.0),
                    asset.provider,
                    _json_text({"hintId": hint_id, "region": face.region, **metadata}),
                    now,
                ),
            )
        stale_rows = conn.execute(
            """
            SELECT hint_id FROM photo_external_people_hints
            WHERE asset_id = ? AND provider = ? AND library_id = ? AND external_asset_id = ?
            """,
            (asset_id, asset.provider, asset.library_id, asset.external_id),
        ).fetchall()
        stale_hint_ids = [str(row["hint_id"] or "") for row in stale_rows if str(row["hint_id"] or "") not in seen_hint_ids]
        for hint_id in stale_hint_ids:
            conn.execute(
                "DELETE FROM photo_asset_people WHERE asset_id = ? AND candidate_id = ?",
                (asset_id, f"external_hint:{hint_id}"),
            )
            conn.execute("DELETE FROM photo_external_people_hints WHERE hint_id = ?", (hint_id,))

    def _external_folder_id(self, asset: NormalizedPhotoAsset, external_folder_id: str) -> str:
        token = f"{asset.provider}:{asset.library_id}:folder:{external_folder_id}"
        return f"photo_folder_external_{sha256(token.encode('utf-8')).hexdigest()[:32]}"

    def _external_album_id(self, asset: NormalizedPhotoAsset, external_album_id: str) -> str:
        token = f"{asset.provider}:{asset.library_id}:album:{external_album_id}"
        return f"photo_album_external_{sha256(token.encode('utf-8')).hexdigest()[:32]}"

    def _ensure_album(
        self,
        conn: sqlite3.Connection,
        *,
        asset: NormalizedPhotoAsset,
        album: NormalizedAlbum,
    ) -> tuple[str, str]:
        parent_folder_id = ""
        external_parent_id = ""
        for position, folder in enumerate(album.folder_path):
            ext_folder_id = str(folder.get("id", "") or folder.get("name", "") or "")
            name = str(folder.get("name", "") or "").strip()
            if not ext_folder_id or not name:
                continue
            folder_id = self._external_folder_id(asset, ext_folder_id)
            self.db.upsert_photo_album_folder(
                folder_id=folder_id,
                name=name,
                parent_folder_id=parent_folder_id,
                position=position,
                conn=conn,
            )
            now = now_iso()
            conn.execute(
                """
                INSERT INTO photo_external_album_links(
                    provider, library_id, external_album_id, album_id, external_parent_id,
                    folder_id, name, metadata_json, created_at, updated_at
                ) VALUES(?, ?, ?, '', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, library_id, external_album_id) DO UPDATE SET
                    external_parent_id=excluded.external_parent_id,
                    folder_id=excluded.folder_id,
                    name=excluded.name,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    asset.provider,
                    asset.library_id,
                    f"folder:{ext_folder_id}",
                    external_parent_id,
                    folder_id,
                    name,
                    _json_text({"kind": "folder", "position": position}),
                    now,
                    now,
                ),
            )
            parent_folder_id = folder_id
            external_parent_id = ext_folder_id
        album_id = self._external_album_id(asset, album.album_id)
        self.db.upsert_photo_album(
            album_id=album_id,
            name=album.name,
            album_kind="manual",
            description=f"Imported from {_provider_display_name(asset.provider)}.",
            include_people=[],
            exclude_people=[],
            rules={
                "externalProvider": asset.provider,
                "externalLibraryId": asset.library_id,
                "externalAlbumId": album.album_id,
                "readOnlySource": True,
                "shared": album.shared,
                "owner": album.owner,
                "metadata": album.metadata,
            },
            folder_id=parent_folder_id,
            folder_position=album.position,
            conn=conn,
        )
        now = now_iso()
        conn.execute(
            """
            INSERT INTO photo_external_album_links(
                provider, library_id, external_album_id, album_id, external_parent_id,
                folder_id, name, metadata_json, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(provider, library_id, external_album_id) DO UPDATE SET
                album_id=excluded.album_id,
                external_parent_id=excluded.external_parent_id,
                folder_id=excluded.folder_id,
                name=excluded.name,
                metadata_json=excluded.metadata_json,
                updated_at=excluded.updated_at
            """,
            (
                asset.provider,
                asset.library_id,
                album.album_id,
                album_id,
                external_parent_id,
                parent_folder_id,
                album.name,
                _json_text(album.to_dict()),
                now,
                now,
            ),
        )
        return album_id, parent_folder_id

    def _sync_album_memberships(self, conn: sqlite3.Connection, *, asset_id: str, asset: NormalizedPhotoAsset) -> None:
        existing_rows = conn.execute(
            """
            SELECT external_album_id, album_id, was_preexisting
            FROM photo_external_album_items
            WHERE provider = ? AND library_id = ? AND external_asset_id = ?
            """,
            (asset.provider, asset.library_id, asset.external_id),
        ).fetchall()
        existing = {
            str(row["external_album_id"]): (str(row["album_id"]), bool(row["was_preexisting"]))
            for row in existing_rows
        }
        seen: set[str] = set()
        now = now_iso()
        for position, album in enumerate(asset.albums):
            album_id, _ = self._ensure_album(conn, asset=asset, album=album)
            membership_position = int(album.position) if album.position is not None else position
            membership = conn.execute(
                "SELECT 1 FROM photo_album_items WHERE album_id = ? AND asset_id = ? LIMIT 1",
                (album_id, asset_id),
            ).fetchone()
            was_preexisting = bool(membership) and album.album_id not in existing
            conn.execute(
                """
                INSERT OR IGNORE INTO photo_album_items(album_id, asset_id, position, added_at)
                VALUES(?, ?, ?, ?)
                """,
                (album_id, asset_id, membership_position, now),
            )
            conn.execute(
                """
                INSERT INTO photo_external_album_items(
                    provider, library_id, external_album_id, external_asset_id,
                    album_id, asset_id, position, was_preexisting, last_seen_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(provider, library_id, external_album_id, external_asset_id) DO UPDATE SET
                    album_id=excluded.album_id,
                    asset_id=excluded.asset_id,
                    position=excluded.position,
                    last_seen_at=excluded.last_seen_at
                """,
                (
                    asset.provider,
                    asset.library_id,
                    album.album_id,
                    asset.external_id,
                    album_id,
                    asset_id,
                    membership_position,
                    int(was_preexisting),
                    now,
                ),
            )
            seen.add(album.album_id)
        for external_album_id, (album_id, was_preexisting) in existing.items():
            if external_album_id in seen:
                continue
            conn.execute(
                """
                DELETE FROM photo_external_album_items
                WHERE provider = ? AND library_id = ? AND external_album_id = ? AND external_asset_id = ?
                """,
                (asset.provider, asset.library_id, external_album_id, asset.external_id),
            )
            other = conn.execute(
                "SELECT 1 FROM photo_external_album_items WHERE album_id = ? AND asset_id = ? LIMIT 1",
                (album_id, asset_id),
            ).fetchone()
            if not was_preexisting and other is None:
                conn.execute(
                    "DELETE FROM photo_album_items WHERE album_id = ? AND asset_id = ?",
                    (album_id, asset_id),
                )

    def _sync_media_pairs(
        self,
        conn: sqlite3.Connection,
        *,
        asset_id: str,
        source_path: str,
        asset: NormalizedPhotoAsset,
        variants: dict[str, str],
    ) -> None:
        rows = conn.execute(
            "SELECT pair_id, metadata_json FROM photo_media_pairs WHERE asset_id = ?",
            (asset_id,),
        ).fetchall()
        for row in rows:
            metadata = _json_object(row["metadata_json"])
            if metadata.get("provider") == asset.provider and metadata.get("libraryId") == asset.library_id:
                conn.execute("DELETE FROM photo_media_pairs WHERE pair_id = ?", (str(row["pair_id"]),))
        kind_map = {
            "original": "original_version",
            "edited": "edited_version",
            "raw": "raw_sidecar",
            "livePhotoMotion": "live_photo_motion",
            "editedLivePhotoMotion": "edited_live_photo_motion",
        }
        now = now_iso()
        for variant, related_path in variants.items():
            if not related_path or os.path.normcase(related_path) == os.path.normcase(source_path):
                continue
            pair_kind = kind_map.get(variant, "related_media")
            pair_id = f"pair_{sha256(f'{asset.provider}:{asset.library_id}:{asset.external_id}:{variant}'.encode('utf-8')).hexdigest()[:32]}"
            conn.execute(
                """
                INSERT INTO photo_media_pairs(
                    pair_id, asset_id, related_asset_id, pair_kind, source_path,
                    related_source_path, metadata_json, created_at, updated_at
                ) VALUES(?, ?, '', ?, ?, ?, ?, ?, ?)
                ON CONFLICT(pair_id) DO UPDATE SET
                    asset_id=excluded.asset_id,
                    pair_kind=excluded.pair_kind,
                    source_path=excluded.source_path,
                    related_source_path=excluded.related_source_path,
                    metadata_json=excluded.metadata_json,
                    updated_at=excluded.updated_at
                """,
                (
                    pair_id,
                    asset_id,
                    pair_kind,
                    source_path,
                    related_path,
                    _json_text({
                        "provider": asset.provider,
                        "libraryId": asset.library_id,
                        "externalAssetId": asset.external_id,
                        "variant": variant,
                    }),
                    now,
                    now,
                ),
            )

    def _import_asset(
        self,
        conn: sqlite3.Connection,
        *,
        opened: Any,
        asset: NormalizedPhotoAsset,
        import_id: str,
        source_id: str,
        storage_mode: str,
        managed_root: Path,
        prefer_edited: bool,
        allow_photos_export: bool,
        allow_external_download: bool,
        force: bool,
        scopes: PhotoSourceScopes,
    ) -> dict[str, Any]:
        signature = asset.sync_signature()
        external = self.catalog.external_asset(asset.provider, asset.library_id, asset.external_id, conn=conn)
        existing_asset = self.db.photo_asset_by_id(str(external.get("assetId", "") or ""), conn) if external.get("assetId") else None
        if not force and external.get("syncSignature") == signature and external.get("state") == "active" and existing_asset:
            self.catalog.upsert_external_asset(
                provider=asset.provider,
                library_id=asset.library_id,
                external_id=asset.external_id,
                source_id=source_id,
                asset_id=str(existing_asset.get("assetId", "")),
                external_updated_at=asset.modified_date,
                state="active",
                sync_signature=signature,
                metadata={**external.get("metadata", {}), "lastImportId": import_id},
                conn=conn,
            )
            return {"result": "unchanged", "assetId": str(existing_asset.get("assetId", ""))}

        primary_path = asset.primary_path(prefer_edited=prefer_edited)
        primary = Path(primary_path).expanduser() if primary_path else None
        exported_paths: list[str] = []
        effective_storage_mode = storage_mode
        if primary is None or not primary.is_file():
            if (allow_photos_export or allow_external_download) and hasattr(opened, "export_asset"):
                export_root = managed_root / "cloud" / sha256(asset.external_id.encode("utf-8")).hexdigest()[:16]
                exported_paths = opened.export_asset(
                    asset.external_id,
                    str(export_root),
                    edited=prefer_edited and bool(asset.edited_path or asset.has_adjustments),
                    include_raw=bool(asset.raw_path or asset.flags.get("hasRaw")),
                    include_live_photo=bool(asset.flags.get("livePhoto")),
                    allow_photos_export=allow_photos_export,
                )
                primary = next((Path(path) for path in exported_paths if Path(path).is_file()), None)
                effective_storage_mode = "managed"
            if primary is None or not primary.is_file():
                reason = (
                    "Remote media requires explicit download consent before a managed copy can be created."
                    if asset.provider in REMOTE_PHOTO_SOURCE_PROVIDERS
                    else "Original is not stored locally. Use explicit Photos export to download a managed copy."
                    if asset.missing
                    else "No readable original or edited media path was available."
                )
                self._record_import_failure(
                    conn,
                    import_id=import_id,
                    asset=asset,
                    reason=reason,
                    source_id=source_id,
                )
                return {"result": "failed", "reason": reason}

        target = primary.resolve()
        if effective_storage_mode == "managed" and not exported_paths:
            target = self._managed_target(primary, asset, managed_root, existing_asset)
            if primary.resolve() != target.resolve():
                shutil.copy2(primary, target)

        variants = asset.variant_paths()
        if effective_storage_mode == "managed":
            managed_variants: dict[str, str] = {}
            for kind, variant_path in variants.items():
                variant = Path(variant_path).expanduser()
                if not variant.is_file():
                    continue
                if variant.resolve() == primary.resolve():
                    managed_variants[kind] = str(target)
                else:
                    managed_variants[kind] = self._copy_variant(
                        str(variant),
                        managed_root=managed_root,
                        asset=asset,
                        kind=kind,
                    )
            variants = managed_variants
            for exported in exported_paths:
                path = Path(exported)
                if not path.is_file() or path.resolve() == target.resolve():
                    continue
                key = "livePhotoMotion" if path.suffix.lower() in {".mov", ".mp4", ".m4v"} else "raw" if path.suffix.lower() in {".dng", ".cr2", ".cr3", ".nef", ".arw", ".raf", ".rw2"} else "related"
                variants[key] = str(path.resolve())

        owner = self.db.photo_asset_by_path(str(target), conn)
        if existing_asset and str(existing_asset.get("sourcePath", "")) != str(target) and owner is None:
            conn.execute(
                "UPDATE photo_assets SET source_path = ?, updated_at = ? WHERE asset_id = ?",
                (str(target), now_iso(), str(existing_asset.get("assetId", ""))),
            )
            existing_asset = self.db.photo_asset_by_id(str(existing_asset.get("assetId", "")), conn)
        elif owner is not None:
            existing_asset = owner

        current_metadata = dict(existing_asset.get("metadata", {})) if existing_asset and isinstance(existing_asset.get("metadata"), dict) else {}
        external_metadata = dict(current_metadata.get("external", {})) if isinstance(current_metadata.get("external"), dict) else {}
        provider_key = _metadata_provider_key(asset.provider)
        previous_provider = dict(external_metadata.get(provider_key, {})) if isinstance(external_metadata.get(provider_key), dict) else {}
        provider_payload = self._provider_asset_metadata(
            asset,
            import_id=import_id,
            source_id=source_id,
            storage_mode=effective_storage_mode,
            prior=previous_provider,
            scopes=scopes,
        )
        external_metadata[provider_key] = provider_payload
        capture_date = "" if current_metadata.get("catalogCaptureDateEdited") else asset.capture_date
        content_hash = self.db._sha256_file(target)  # noqa: SLF001
        location_metadata = {
            **asset.location,
            "source": asset.provider,
            "libraryId": asset.library_id,
            "externalId": asset.external_id,
        } if scopes.precise_location and asset.location else None
        asset_id = self.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(target),
            source_kind=effective_storage_mode,
            file_signature=path_signature(target),
            content_hash=content_hash,
            media_kind=asset.media_kind,
            mime_type=asset.mime_type,
            width=asset.width,
            height=asset.height,
            duration_ms=asset.duration_ms,
            capture_date=capture_date,
            source_scan_run=import_id,
            metadata={
                "source": "external_photo_source",
                "external": external_metadata,
                "importId": import_id,
                "importSourceKind": "library" if asset.provider == APPLE_PHOTOS_PROVIDER else "connector" if asset.provider in REMOTE_PHOTO_SOURCE_PROVIDERS else "folder",
                "importSourceLabel": "Apple Photos" if asset.provider == APPLE_PHOTOS_PROVIDER else REMOTE_PROVIDER_LABELS.get(asset.provider, "Windows photo folders"),
                "storageMode": effective_storage_mode,
                "originalSourcePath": primary_path,
                **({"externalLocation": location_metadata} if location_metadata else {}),
            },
            refresh_index=False,
        )
        first_import = not bool(previous_provider)
        self._apply_metadata_fields(
            conn,
            asset_id=asset_id,
            asset=asset,
            previous_provider=previous_provider,
            first_import=first_import,
            scopes=scopes,
        )
        if scopes.keywords:
            self._sync_keywords(conn, asset_id=asset_id, asset=asset)
        if scopes.precise_location:
            self._sync_location(conn, asset_id=asset_id, asset=asset)
        if scopes.labels_ocr:
            self._sync_labels_and_ocr(conn, asset_id=asset_id, asset=asset)
        if scopes.people_faces:
            self._sync_people_hints(conn, asset_id=asset_id, asset=asset)
        if scopes.albums_folders:
            self._sync_album_memberships(conn, asset_id=asset_id, asset=asset)
        self._sync_media_pairs(
            conn,
            asset_id=asset_id,
            source_path=str(target),
            asset=asset,
            variants=variants,
        )
        self.db._index_photo_asset(asset_id, conn)  # noqa: SLF001
        self.catalog.upsert_external_asset(
            provider=asset.provider,
            library_id=asset.library_id,
            external_id=asset.external_id,
            source_id=source_id,
            asset_id=asset_id,
            external_updated_at=asset.modified_date,
            state="active",
            sync_signature=signature,
            metadata={
                "hidden": asset.hidden,
                "deleted": asset.deleted,
                "shared": asset.shared,
                "lastImportId": import_id,
                "storageMode": effective_storage_mode,
                "sourcePath": str(target),
            },
            conn=conn,
        )
        self.db._clear_photo_import_failure(conn, import_id=import_id, source_path=primary_path)  # noqa: SLF001
        return {
            "result": "updated" if existing_asset else "imported",
            "assetId": asset_id,
            "sourcePath": str(target),
            "exportedManaged": bool(exported_paths),
        }

    def _reconcile_removed_assets(
        self,
        *,
        source_id: str,
        seen_external_ids: set[str],
        scopes: PhotoSourceScopes,
        removed_policy: str,
    ) -> dict[str, int]:
        counts = {"removed": 0, "kept": 0, "trashed": 0}
        now = now_iso()
        with self.db.connect() as conn:
            records = self.catalog.list_external_assets(source_id, states=["active", "missing", "error"], conn=conn)
            for record in records:
                external_id = str(record.get("externalId", ""))
                if not external_id or external_id in seen_external_ids:
                    continue
                metadata = record.get("metadata", {}) if isinstance(record.get("metadata"), dict) else {}
                if bool(metadata.get("hidden")) and not scopes.hidden:
                    counts["kept"] += 1
                    continue
                if bool(metadata.get("deleted")) and not scopes.deleted:
                    counts["kept"] += 1
                    continue
                conn.execute(
                    """
                    UPDATE photo_asset_external_ids
                    SET state = 'removed', metadata_json = ?, last_seen_at = ?
                    WHERE provider = ? AND library_id = ? AND external_id = ?
                    """,
                    (
                        _json_text({**metadata, "removedFromSourceAt": now, "removedPolicy": removed_policy}),
                        now,
                        record.get("provider", ""),
                        record.get("libraryId", ""),
                        external_id,
                    ),
                )
                counts["removed"] += 1
                if removed_policy == "trash" and record.get("assetId"):
                    conn.execute(
                        "UPDATE photo_asset_metadata SET deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE asset_id = ?",
                        (now, now, record["assetId"]),
                    )
                    self.db._index_photo_asset(str(record["assetId"]), conn)  # noqa: SLF001
                    counts["trashed"] += 1
        return counts

    def _import_source(
        self,
        job: dict[str, Any],
        *,
        sync: bool,
        progress_callback: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        params = job.get("params", {}) if isinstance(job.get("params"), dict) else {}
        provider = normalize_provider(job.get("provider"))
        adapter = self.adapter(provider)
        if hasattr(adapter, "configure_import"):
            adapter.configure_import(params)
        scopes = PhotoSourceScopes.from_params(params)
        storage_mode = str(params.get("storageMode", "referenced") or "referenced").strip().lower()
        if storage_mode not in {"referenced", "managed"}:
            raise ValueError("Photo source storageMode must be referenced or managed.")
        removed_policy = str(params.get("removedPolicy", "keep") or "keep").strip().lower()
        if removed_policy not in {"keep", "trash"}:
            raise ValueError("removedPolicy must be keep or trash.")
        library_path = str(params.get("libraryPath", "") or "")
        selected_ids = {
            str(value or "").strip()
            for value in params.get("externalIds", [])
            if str(value or "").strip()
        } if isinstance(params.get("externalIds", []), list) else set()
        prefer_edited = bool(params.get("preferEdited", False))
        allow_photos_export = bool(params.get("allowPhotosExport", False))
        allow_external_download = provider in REMOTE_PHOTO_SOURCE_PROVIDERS and bool(params.get("allowExternalDownload", False))
        if provider in REMOTE_PHOTO_SOURCE_PROVIDERS:
            storage_mode = "managed"
        force = bool(params.get("force", False))
        managed_root = self._managed_source_root(params, str(job.get("sourceId", "")))
        counts = {
            "seen": 0,
            "processed": 0,
            "imported": 0,
            "updated": 0,
            "unchanged": 0,
            "failed": 0,
            "exportedManaged": 0,
            "removed": 0,
            "trashed": 0,
        }
        seen_external_ids: set[str] = set()
        unsupported: set[str] = set()
        failures: list[dict[str, str]] = []
        failure_total = 0
        with adapter.open_library(library_path) as opened:
            library = opened.library
            self.catalog.upsert_source(
                library,
                capabilities=adapter.status().get("capabilities", {}),
                scopes=scopes,
                platform_name=self.platform_name,
            )
            import_id = self._create_import_session(
                job=job,
                library=library,
                scopes=scopes,
                storage_mode=storage_mode,
                sync=sync,
            )
            self._emit_progress(
                job["jobId"],
                {
                    "phase": "preparing",
                    "importId": import_id,
                    **counts,
                    "message": "Photo source import session is ready.",
                },
                progress_callback,
            )
            try:
                batch: list[NormalizedPhotoAsset] = []

                def process_batch(rows: list[NormalizedPhotoAsset]) -> None:
                    nonlocal failure_total
                    if not rows:
                        return
                    self._raise_if_cancelled(job["jobId"])
                    with self.db.connect() as conn:
                        for asset in rows:
                            try:
                                outcome = self._import_asset(
                                    conn,
                                    opened=opened,
                                    asset=asset,
                                    import_id=import_id,
                                    source_id=str(job.get("sourceId", "")),
                                    storage_mode=storage_mode,
                                    managed_root=managed_root,
                                    prefer_edited=prefer_edited,
                                    allow_photos_export=allow_photos_export,
                                    allow_external_download=allow_external_download,
                                    force=force,
                                    scopes=scopes,
                                )
                            except Exception as exc:
                                self._record_import_failure(
                                    conn,
                                    import_id=import_id,
                                    asset=asset,
                                    reason=f"Import failed: {str(exc)[:700]}",
                                    source_id=str(job.get("sourceId", "")),
                                )
                                outcome = {"result": "failed", "reason": str(exc)}
                            result_kind = str(outcome.get("result", "failed"))
                            if result_kind == "failed":
                                failure_total += 1
                                if len(failures) < 500:
                                    failures.append({
                                        "externalId": asset.external_id,
                                        "filename": asset.original_filename or asset.filename,
                                        "reason": str(outcome.get("reason", "Import failed.") or "Import failed.")[:700],
                                    })
                            counts[result_kind] = int(counts.get(result_kind, 0)) + 1
                            counts["processed"] += 1
                            counts["exportedManaged"] += int(bool(outcome.get("exportedManaged")))
                    self._emit_progress(
                        job["jobId"],
                        {
                            "phase": "syncing" if sync else "importing",
                            **counts,
                            "currentExternalId": rows[-1].external_id,
                            "message": f"Processed {counts['processed']} photo source item(s).",
                        },
                        progress_callback,
                    )

                for asset in opened.iter_assets(scopes):
                    self._raise_if_cancelled(job["jobId"])
                    counts["seen"] += 1
                    unsupported.update(asset.unsupported_fields)
                    if selected_ids and asset.external_id not in selected_ids:
                        continue
                    seen_external_ids.add(asset.external_id)
                    batch.append(asset)
                    if len(batch) >= 25:
                        process_batch(batch)
                        batch = []
                process_batch(batch)
                if sync and not selected_ids:
                    removed = self._reconcile_removed_assets(
                        source_id=str(job.get("sourceId", "")),
                        seen_external_ids=seen_external_ids,
                        scopes=scopes,
                        removed_policy=removed_policy,
                    )
                    counts["removed"] = removed["removed"]
                    counts["trashed"] = removed["trashed"]
                session = self._finish_import_session(
                    import_id,
                    counts=counts,
                    metadata={
                        "unsupportedFields": sorted(unsupported),
                        "selectedExternalIds": sorted(selected_ids)[:1000],
                        "selectedExternalIdCount": len(selected_ids),
                        "managedRoot": str(managed_root) if storage_mode == "managed" or counts["exportedManaged"] else "",
                        "removedPolicy": removed_policy,
                    },
                )
            except PhotoSourceJobCancelled:
                self._finish_import_session(
                    import_id,
                    counts=counts,
                    metadata={"unsupportedFields": sorted(unsupported)},
                    cancelled=True,
                )
                raise
        source = self.catalog.update_source_state(
            str(job.get("sourceId", "")),
            status="ready",
            synced=sync,
            cursor={
                "schemaVersion": 1,
                "lastExternalId": max(seen_external_ids) if seen_external_ids else "",
                "lastCompletedAt": now_iso(),
                "seenCount": len(seen_external_ids),
                "unsupportedFields": sorted(unsupported),
            },
            metadata_patch={
                "lastImportId": import_id,
                "lastJobId": job.get("jobId", ""),
                "lastCounts": counts,
                "unsupportedFields": sorted(unsupported),
            },
        )
        return {
            "sourceId": source.get("sourceId", ""),
            "provider": provider,
            "libraryId": source.get("libraryId", ""),
            "importId": import_id,
            "storageMode": storage_mode,
            "managedRoot": str(managed_root) if storage_mode == "managed" or counts["exportedManaged"] else "",
            "counts": counts,
            "unsupportedFields": sorted(unsupported),
            "session": session,
            "source": source,
            "warnings": [
                *([{
                    "code": "cloud-assets-exported-managed",
                    "message": f"{counts['exportedManaged']} remote or cloud-only item(s) were explicitly downloaded as managed copies.",
                }] if counts["exportedManaged"] else []),
                *([{
                    "code": "source-items-removed",
                    "message": f"{counts['removed']} item(s) are no longer present in the source; local catalog records were preserved.",
                }] if counts["removed"] and removed_policy == "keep" else []),
            ],
            "failures": failures,
            "failureCount": failure_total,
            "failureSummaryTruncated": failure_total > len(failures),
        }

    def _retained_sensitive_scopes(self, revoked: set[str]) -> PhotoSourceScopes:
        return PhotoSourceScopes(
            people_faces="peopleFaces" not in revoked,
            precise_location="preciseLocation" not in revoked,
            hidden="hidden" not in revoked,
            deleted="deleted" not in revoked,
            shared="shared" not in revoked,
            comments_likes="commentsLikes" not in revoked,
        )

    def _redact_revoked_payload(
        self,
        value: dict[str, Any],
        *,
        revoked: set[str],
        retained_scopes: PhotoSourceScopes,
    ) -> dict[str, Any]:
        cleaned = scoped_sensitive_metadata(value, retained_scopes)
        payload = dict(cleaned) if isinstance(cleaned, dict) else {}
        imported_fields = dict(payload.get("importedFields", {})) if isinstance(payload.get("importedFields"), dict) else {}
        if "peopleFaces" in revoked:
            payload.pop("people", None)
            payload.pop("faces", None)
        if "preciseLocation" in revoked:
            payload.pop("location", None)
        if "hidden" in revoked:
            payload.pop("hidden", None)
            imported_fields.pop("hidden", None)
        if "deleted" in revoked:
            payload.pop("deleted", None)
            payload.pop("deletedAt", None)
            imported_fields.pop("deletedAt", None)
        if "shared" in revoked:
            payload.pop("shared", None)
            payload.pop("owner", None)
            payload.pop("shareParticipants", None)
            albums = payload.get("albums", [])
            if isinstance(albums, list):
                payload["albums"] = [
                    album for album in albums
                    if not isinstance(album, dict) or not bool(album.get("shared"))
                ]
        if "commentsLikes" in revoked:
            payload.pop("comments", None)
            payload.pop("likes", None)
        if imported_fields:
            payload["importedFields"] = imported_fields
        else:
            payload.pop("importedFields", None)
        return payload

    def _revoke_shared_albums(
        self,
        conn: sqlite3.Connection,
        *,
        provider: str,
        library_id: str,
    ) -> dict[str, int]:
        rows = conn.execute(
            """
            SELECT l.external_album_id, l.album_id, l.folder_id, l.metadata_json, a.rules_json
            FROM photo_external_album_links AS l
            LEFT JOIN photo_albums AS a ON a.album_id = l.album_id
            WHERE l.provider = ? AND l.library_id = ? AND l.album_id != ''
            """,
            (provider, library_id),
        ).fetchall()
        shared_rows = []
        for row in rows:
            metadata = _json_object(row["metadata_json"])
            rules = _json_object(row["rules_json"])
            if bool(metadata.get("shared")) or bool(rules.get("shared")):
                shared_rows.append(row)
        folder_ids: set[str] = set()
        item_count = 0
        for row in shared_rows:
            album_id = str(row["album_id"] or "")
            external_album_id = str(row["external_album_id"] or "")
            folder_id = str(row["folder_id"] or "")
            if folder_id:
                folder_ids.add(folder_id)
            item_count += int(conn.execute(
                "SELECT COUNT(*) FROM photo_external_album_items WHERE provider = ? AND library_id = ? AND external_album_id = ?",
                (provider, library_id, external_album_id),
            ).fetchone()[0])
            conn.execute(
                "DELETE FROM photo_external_album_items WHERE provider = ? AND library_id = ? AND external_album_id = ?",
                (provider, library_id, external_album_id),
            )
            conn.execute(
                "DELETE FROM photo_external_album_links WHERE provider = ? AND library_id = ? AND external_album_id = ?",
                (provider, library_id, external_album_id),
            )
            conn.execute("DELETE FROM photo_albums WHERE album_id = ?", (album_id,))
        folders_removed = 0
        for folder_id in sorted(folder_ids, reverse=True):
            used = conn.execute(
                "SELECT 1 FROM photo_external_album_links WHERE folder_id = ? AND album_id != '' LIMIT 1",
                (folder_id,),
            ).fetchone()
            if used is not None:
                continue
            conn.execute(
                "DELETE FROM photo_external_album_links WHERE provider = ? AND library_id = ? AND folder_id = ?",
                (provider, library_id, folder_id),
            )
            child = conn.execute(
                "SELECT 1 FROM photo_album_folders WHERE parent_folder_id = ? LIMIT 1",
                (folder_id,),
            ).fetchone()
            local_album = conn.execute(
                "SELECT 1 FROM photo_albums WHERE folder_id = ? LIMIT 1",
                (folder_id,),
            ).fetchone()
            if child is None and local_album is None:
                folders_removed += conn.execute(
                    "DELETE FROM photo_album_folders WHERE folder_id = ?",
                    (folder_id,),
                ).rowcount
        return {
            "sharedAlbumsRemoved": len(shared_rows),
            "sharedAlbumItemsRemoved": item_count,
            "sharedFoldersRemoved": folders_removed,
        }

    def _revoke_consent(
        self,
        job: dict[str, Any],
        *,
        progress_callback: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        params = job.get("params", {}) if isinstance(job.get("params"), dict) else {}
        source_id = str(job.get("sourceId", params.get("sourceId", "")) or "").strip()
        source = self.catalog.get_source(source_id)
        if not source:
            raise ValueError("Unknown photo source id.")
        provider = normalize_provider(source.get("provider"))
        library_id = str(source.get("libraryId", "") or "")
        revoked = {
            str(value) for value in params.get("revokeScopes", [])
            if str(value) in SENSITIVE_PHOTO_SOURCE_SCOPES
        }
        if not revoked:
            raise ValueError("Select at least one sensitive photo-source scope to revoke.")
        retained_scopes = self._retained_sensitive_scopes(revoked)
        provider_key = _metadata_provider_key(provider)
        counts = {
            "processed": 0,
            "assetsUpdated": 0,
            "peopleHintsRemoved": 0,
            "peopleAssignmentsRemoved": 0,
            "locationsRemoved": 0,
            "canonicalHiddenCleared": 0,
            "canonicalDeletedCleared": 0,
            "sharedAlbumsRemoved": 0,
            "sharedAlbumItemsRemoved": 0,
            "sharedFoldersRemoved": 0,
        }
        cursor = ""
        while True:
            self._raise_if_cancelled(job["jobId"])
            with self.db.connect() as conn:
                rows = conn.execute(
                    """
                    SELECT e.external_id, e.asset_id, e.metadata_json AS external_metadata_json,
                           a.metadata_json AS asset_metadata_json
                    FROM photo_asset_external_ids AS e
                    LEFT JOIN photo_assets AS a ON a.asset_id = e.asset_id
                    WHERE e.source_id = ? AND e.external_id > ?
                    ORDER BY e.external_id ASC
                    LIMIT 200
                    """,
                    (source_id, cursor),
                ).fetchall()
                if not rows:
                    break
                for row in rows:
                    external_id = str(row["external_id"] or "")
                    asset_id = str(row["asset_id"] or "")
                    cursor = external_id
                    external_metadata = _json_object(row["external_metadata_json"])
                    cleaned_external = self._redact_revoked_payload(
                        external_metadata,
                        revoked=revoked,
                        retained_scopes=retained_scopes,
                    )
                    conn.execute(
                        """
                        UPDATE photo_asset_external_ids
                        SET metadata_json = ?, last_seen_at = ?
                        WHERE provider = ? AND library_id = ? AND external_id = ?
                        """,
                        (_json_text(cleaned_external), now_iso(), provider, library_id, external_id),
                    )
                    if not asset_id:
                        counts["processed"] += 1
                        continue
                    asset_metadata = _json_object(row["asset_metadata_json"])
                    external = dict(asset_metadata.get("external", {})) if isinstance(asset_metadata.get("external"), dict) else {}
                    provider_payload = dict(external.get(provider_key, {})) if isinstance(external.get(provider_key), dict) else {}
                    imported_fields = dict(provider_payload.get("importedFields", {})) if isinstance(provider_payload.get("importedFields"), dict) else {}
                    external[provider_key] = self._redact_revoked_payload(
                        provider_payload,
                        revoked=revoked,
                        retained_scopes=retained_scopes,
                    )
                    asset_metadata["external"] = external
                    location_payload = asset_metadata.get("externalLocation", {})
                    if "preciseLocation" in revoked and isinstance(location_payload, dict) and (
                        location_payload.get("source") == provider or location_payload.get("libraryId") == library_id
                    ):
                        asset_metadata.pop("externalLocation", None)
                    conn.execute(
                        "UPDATE photo_assets SET metadata_json = ?, updated_at = ? WHERE asset_id = ?",
                        (_json_text(asset_metadata), now_iso(), asset_id),
                    )
                    counts["assetsUpdated"] += 1
                    if "peopleFaces" in revoked:
                        counts["peopleHintsRemoved"] += conn.execute(
                            "DELETE FROM photo_external_people_hints WHERE asset_id = ? AND provider = ? AND library_id = ?",
                            (asset_id, provider, library_id),
                        ).rowcount
                        counts["peopleAssignmentsRemoved"] += conn.execute(
                            "DELETE FROM photo_asset_people WHERE asset_id = ? AND source = ?",
                            (asset_id, provider),
                        ).rowcount
                    if "preciseLocation" in revoked:
                        counts["locationsRemoved"] += conn.execute(
                            "DELETE FROM photo_asset_locations WHERE asset_id = ? AND source = ?",
                            (asset_id, provider),
                        ).rowcount
                    metadata_row = conn.execute(
                        "SELECT hidden, deleted_at FROM photo_asset_metadata WHERE asset_id = ? LIMIT 1",
                        (asset_id,),
                    ).fetchone()
                    if metadata_row is not None and "hidden" in revoked:
                        previous_hidden = bool(imported_fields.get("hidden", False))
                        if previous_hidden and bool(metadata_row["hidden"]):
                            counts["canonicalHiddenCleared"] += conn.execute(
                                "UPDATE photo_asset_metadata SET hidden = 0, updated_at = ? WHERE asset_id = ?",
                                (now_iso(), asset_id),
                            ).rowcount
                    if metadata_row is not None and "deleted" in revoked:
                        previous_deleted = str(imported_fields.get("deletedAt", "") or "")
                        current_deleted = str(metadata_row["deleted_at"] or "")
                        if previous_deleted and current_deleted == previous_deleted:
                            counts["canonicalDeletedCleared"] += conn.execute(
                                "UPDATE photo_asset_metadata SET deleted_at = NULL, updated_at = ? WHERE asset_id = ?",
                                (now_iso(), asset_id),
                            ).rowcount
                    self.db._index_photo_asset(asset_id, conn)  # noqa: SLF001
                    counts["processed"] += 1
            self._emit_progress(
                job["jobId"],
                {
                    "phase": "revoking_consent",
                    **counts,
                    "currentExternalId": cursor,
                    "message": f"Removed selected metadata from {counts['processed']} local catalog item(s).",
                },
                progress_callback,
            )
        with self.db.connect() as conn:
            if "shared" in revoked:
                counts.update(self._revoke_shared_albums(conn, provider=provider, library_id=library_id))
            current = self.catalog.get_source(source_id, conn=conn)
            consent = dict(current.get("consent", {}))
            selected_scopes = dict(consent.get("selectedScopes", {})) if isinstance(consent.get("selectedScopes"), dict) else {}
            for scope in revoked:
                selected_scopes[scope] = False
            sensitive_scopes = [
                str(scope) for scope in consent.get("sensitiveScopes", [])
                if str(scope) not in revoked
            ] if isinstance(consent.get("sensitiveScopes"), list) else []
            history = list(consent.get("revocationHistory", [])) if isinstance(consent.get("revocationHistory"), list) else []
            history.append({"at": now_iso(), "scopes": sorted(revoked), "assetsUpdated": counts["assetsUpdated"]})
            consent.update({
                "selectedScopes": selected_scopes,
                "sensitiveScopes": sensitive_scopes,
                "revokedAt": now_iso(),
                "revocationHistory": history[-20:],
            })
            metadata = dict(current.get("metadata", {}))
            metadata["lastConsentRevocation"] = {
                "at": now_iso(),
                "scopes": sorted(revoked),
                "counts": counts,
                "localCatalogOnly": True,
            }
            conn.execute(
                """
                UPDATE photo_external_sources
                SET consent_json = ?, metadata_json = ?, status = 'ready', updated_at = ?
                WHERE source_id = ?
                """,
                (_json_text(consent), _json_text(metadata), now_iso(), source_id),
            )
            updated_source = self.catalog.get_source(source_id, conn=conn)
        return {
            "sourceId": source_id,
            "provider": provider,
            "libraryId": library_id,
            "revokedScopes": sorted(revoked),
            "counts": counts,
            "source": updated_source,
            "localCatalogOnly": True,
            "sourceLibraryOpened": False,
            "warnings": [{
                "code": "consent-revoked-local-only",
                "message": "Selected imported metadata was removed from Vintrace only. Source photos were not changed.",
            }],
        }

    def _export_source_assets(
        self,
        job: dict[str, Any],
        *,
        progress_callback: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        params = job.get("params", {}) if isinstance(job.get("params"), dict) else {}
        provider = normalize_provider(job.get("provider"))
        if provider != APPLE_PHOTOS_PROVIDER:
            raise ValueError("Native source export is currently available only for Apple Photos.")
        external_ids = clean_strings(params.get("externalIds", []), limit=10_000, max_length=200)
        if not external_ids:
            raise ValueError("Select at least one Apple Photos asset to export.")
        destination = str(params.get("destination", params.get("folder", "")) or "").strip()
        if not destination:
            raise ValueError("destination is required for Apple Photos export.")
        allow_photos_export = bool(params.get("allowPhotosExport", False))
        if allow_photos_export and not bool(params.get("explicitCloudDownloadConsent", False)):
            raise ValueError("explicitCloudDownloadConsent is required before Photos may export cloud-only originals.")
        exported: list[str] = []
        failures: list[dict[str, str]] = []
        adapter = self.adapter(provider)
        with adapter.open_library(str(params.get("libraryPath", "") or "")) as opened:
            for index, external_id in enumerate(external_ids):
                self._raise_if_cancelled(job["jobId"])
                try:
                    exported.extend(opened.export_asset(
                        external_id,
                        destination,
                        edited=bool(params.get("edited", False)),
                        include_raw=bool(params.get("includeRaw", False)),
                        include_live_photo=bool(params.get("includeLivePhoto", False)),
                        allow_photos_export=allow_photos_export,
                    ))
                except Exception as exc:
                    failures.append({"externalId": external_id, "reason": str(exc)[:700]})
                self._emit_progress(
                    job["jobId"],
                    {
                        "phase": "exporting",
                        "total": len(external_ids),
                        "processed": index + 1,
                        "exported": len(exported),
                        "failed": len(failures),
                        "currentExternalId": external_id,
                        "message": f"Exported {len(exported)} file(s).",
                    },
                    progress_callback,
                )
        return {
            "provider": provider,
            "destination": str(Path(destination).expanduser().resolve()),
            "requested": len(external_ids),
            "exported": len(exported),
            "failed": len(failures),
            "paths": exported,
            "failures": failures,
            "networkAccess": "explicit-photos-export" if allow_photos_export else "none",
        }

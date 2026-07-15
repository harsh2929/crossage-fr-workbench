from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
from typing import Any, Callable, Iterable, Iterator
import uuid

from crossage_fr.store.workspace_db import path_signature
from crossage_fr.workspace_registry import now_iso


OPEN_CATALOG_FORMAT = "org.vintrace.open-photo-catalog"
OPEN_CATALOG_VERSION = 1
OPEN_CATALOG_EXTENSION = ".vintracecatalog"
OPEN_CATALOG_PROVIDER = "vintrace_open_catalog"
MAX_MANIFEST_BYTES = 8 * 1024 * 1024
MAX_NDJSON_LINE_BYTES = 16 * 1024 * 1024
MAX_CATALOG_MEMBERS = 2_000_000
MAX_CATALOG_RECORDS = 20_000_000
MAX_JSON_NODES_PER_RECORD = 1_000_000

RECORD_MEMBER_KINDS = {"assets", "entities", "sidecars"}
REQUIRED_SINGLETON_KINDS = {"schema", "assets", "entities", "preferences", "sidecars"}
ALLOWED_MEMBER_KINDS = REQUIRED_SINGLETON_KINDS | {"media", "sidecar-media"}


class OpenPhotoCatalogError(ValueError):
    pass


class OpenPhotoCatalogCancelled(RuntimeError):
    pass


ProgressCallback = Callable[[dict[str, Any]], None]
CancelCheck = Callable[[], bool]


@dataclass(frozen=True)
class PortableTable:
    table: str
    asset_columns: tuple[str, ...] = ()
    deferred_columns: tuple[str, ...] = ()


# This is deliberately a human/catalog-data allowlist. Search indexes, model
# vectors, job queues, sync transport state, caches, and undo payloads are
# rebuilt locally or are unsafe to replay on another machine.
PORTABLE_TABLES: tuple[PortableTable, ...] = (
    PortableTable("photo_asset_metadata", ("asset_id",)),
    PortableTable("photo_asset_locations", ("asset_id",)),
    PortableTable("photo_ocr_blocks", ("asset_id",)),
    PortableTable("photo_object_tags", ("asset_id",)),
    PortableTable("photo_audio_segments", ("asset_id",)),
    PortableTable("photo_asset_events", ("asset_id",)),
    PortableTable("photo_edit_stacks", ("asset_id",)),
    PortableTable("photo_edit_stack_versions", ("asset_id",)),
    PortableTable("photo_asset_people", ("asset_id",)),
    PortableTable("photo_people_profiles", ("key_asset_id",)),
    PortableTable("photo_pet_profiles", ("key_asset_id",)),
    PortableTable("photo_people_groups", ("key_asset_id",)),
    PortableTable("photo_relationship_name_reviews"),
    PortableTable("photo_place_profiles", ("key_asset_id",)),
    PortableTable("photo_utility_profiles", ("key_asset_id",)),
    PortableTable("photo_keywords"),
    PortableTable("photo_asset_keywords", ("asset_id",)),
    PortableTable("photo_album_folders", deferred_columns=("parent_folder_id",)),
    PortableTable("photo_albums"),
    PortableTable("photo_saved_filters"),
    PortableTable("photo_album_items", ("asset_id",)),
    PortableTable("photo_media_pairs", ("asset_id", "related_asset_id")),
    PortableTable("photo_duplicate_groups"),
    PortableTable("photo_duplicate_group_items", ("asset_id",)),
    PortableTable("photo_duplicate_dismissals"),
    PortableTable("photo_import_sessions"),
    PortableTable("photo_tether_sessions"),
    PortableTable("photo_tether_captures", ("asset_id",)),
    PortableTable("photo_external_sources"),
    PortableTable("photo_asset_external_ids", ("asset_id",)),
    PortableTable("photo_external_album_links"),
    PortableTable("photo_external_album_items", ("asset_id",)),
    PortableTable("photo_external_people_hints", ("asset_id",)),
    PortableTable("photo_asset_keyword_sources", ("asset_id",)),
)

PORTABLE_META_KEYS = (
    "photo_curation_preferences",
    "photo_user_memories",
    "photo_stories",
    "photo_culling_results",
    "photo_slideshow_theme_templates",
    "photo_slideshow_projects",
)

SIDECAR_SUFFIXES = (
    ".xmp",
    ".json",
    ".xml",
    ".aae",
    ".dop",
    ".pp3",
    ".on1",
    ".cos",
    ".dr4",
    ".dr5",
)

PATH_COLUMNS_TO_CLEAR = {
    "root_path",
    "preview_path",
    "rendered_preview_path",
    "managed_root",
    "destination_path",
}


def _utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def _clean_filename(value: Any, fallback: str = "asset") -> str:
    name = Path(str(value or "")).name
    name = re.sub(r"[^A-Za-z0-9._ ()\[\]-]+", "_", name).strip(" .")
    return (name or fallback)[:220]


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    return str(value)


def _json_bytes(value: Any, *, pretty: bool = False) -> bytes:
    return (
        json.dumps(
            _json_safe(value),
            ensure_ascii=True,
            sort_keys=True,
            indent=2 if pretty else None,
            separators=None if pretty else (",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


def _json_value(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _sha256_file(path: Path, *, cancel_check: CancelCheck | None = None) -> tuple[str, int]:
    digest = sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            if cancel_check is not None and cancel_check():
                raise OpenPhotoCatalogCancelled("Open catalog operation was cancelled.")
            block = handle.read(1024 * 1024)
            if not block:
                break
            size += len(block)
            digest.update(block)
    return digest.hexdigest(), size


def _is_absolute_path(value: str) -> bool:
    text = str(value or "").strip()
    return bool(
        text.startswith(("/", "\\", "~/", "~\\"))
        or text == "~"
        or text.casefold().startswith("file://")
        or re.match(r"^[A-Za-z]:[\\/]", text)
    )


def _strict_nonnegative_int(value: Any, label: str, *, maximum: int | None = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise OpenPhotoCatalogError(f"Open catalog {label} must be a non-negative integer.")
    if maximum is not None and value > maximum:
        raise OpenPhotoCatalogError(f"Open catalog {label} exceeds its safety limit.")
    return value


def _assert_path_free_json(
    value: Any,
    *,
    context: str,
    references: set[tuple[str, str]] | None = None,
) -> None:
    stack = [value]
    visited = 0
    while stack:
        current = stack.pop()
        visited += 1
        if visited > MAX_JSON_NODES_PER_RECORD:
            raise OpenPhotoCatalogError(f"Open catalog {context} exceeds its structural safety limit.")
        if isinstance(current, dict):
            if "$ref" in current:
                ref_kind = str(current.get("$ref", "") or "")
                ref_id = str(current.get("id", "") or "")
                if ref_kind not in {"asset", "sidecar", "redacted-path"}:
                    raise OpenPhotoCatalogError(f"Open catalog {context} contains an unsupported portable reference.")
                if ref_kind in {"asset", "sidecar"} and not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", ref_id):
                    raise OpenPhotoCatalogError(f"Open catalog {context} contains an invalid portable reference.")
                if ref_kind == "redacted-path" and ref_id:
                    raise OpenPhotoCatalogError(f"Open catalog {context} contains an invalid redacted path reference.")
                if references is not None:
                    references.add((ref_kind, ref_id))
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, str):
            if "\0" in current:
                raise OpenPhotoCatalogError(f"Open catalog {context} contains a null character.")
            if _is_absolute_path(current):
                raise OpenPhotoCatalogError(f"Open catalog {context} contains a machine-local path.")


def _canonical_path_key(value: str | Path) -> str:
    try:
        return os.path.normcase(str(Path(value).expanduser().resolve()))
    except (OSError, RuntimeError, ValueError):
        return os.path.normcase(os.path.abspath(os.path.expanduser(str(value or ""))))


def _portable_reference(kind: str, identifier: str, name: str = "") -> dict[str, str]:
    result = {"$ref": kind, "id": str(identifier or "")}
    if name:
        result["name"] = _clean_filename(name, "file")
    return result


def _portableize_json(
    value: Any,
    *,
    asset_paths: dict[str, str],
    sidecar_paths: dict[str, str],
) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _portableize_json(item, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_portableize_json(item, asset_paths=asset_paths, sidecar_paths=sidecar_paths) for item in value]
    if isinstance(value, tuple):
        return [_portableize_json(item, asset_paths=asset_paths, sidecar_paths=sidecar_paths) for item in value]
    if isinstance(value, str):
        key = _canonical_path_key(value) if _is_absolute_path(value) else ""
        if key and key in asset_paths:
            return _portable_reference("asset", asset_paths[key])
        if key and key in sidecar_paths:
            return _portable_reference("sidecar", sidecar_paths[key], Path(value).name)
        if _is_absolute_path(value):
            return _portable_reference("redacted-path", "", Path(value).name)
        return value.replace("\0", "")
    return _json_safe(value)


def _restore_json_references(
    value: Any,
    *,
    asset_paths: dict[str, str],
    sidecar_paths: dict[str, str],
) -> Any:
    if isinstance(value, dict):
        if value.get("$ref") == "asset":
            return asset_paths.get(str(value.get("id", "") or ""), "")
        if value.get("$ref") == "sidecar":
            return sidecar_paths.get(str(value.get("id", "") or ""), "")
        if value.get("$ref") == "redacted-path":
            return ""
        return {
            str(key): _restore_json_references(item, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_restore_json_references(item, asset_paths=asset_paths, sidecar_paths=sidecar_paths) for item in value]
    return value


def _safe_member_path(root: Path, relative: str) -> Path:
    text = str(relative or "").replace("\\", "/")
    pure = PurePosixPath(text)
    if not text or pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        raise OpenPhotoCatalogError(f"Unsafe open catalog member path: {text or 'empty'}.")
    target = root.joinpath(*pure.parts)
    try:
        target.resolve().relative_to(root.resolve())
    except (OSError, ValueError) as exc:
        raise OpenPhotoCatalogError(f"Open catalog member escapes its package: {text}.") from exc
    return target


def _assert_regular_member(root: Path, relative: str) -> Path:
    path = _safe_member_path(root, relative)
    try:
        if path.is_symlink() or not path.is_file():
            raise OpenPhotoCatalogError(f"Open catalog member is missing or is not a regular file: {relative}.")
    except OSError as exc:
        raise OpenPhotoCatalogError(f"Open catalog member cannot be read: {relative}.") from exc
    return path


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table,),
    ).fetchone()
    return row is not None


def _table_columns(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    return [dict(row) for row in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]


def _primary_columns(conn: sqlite3.Connection, table: str) -> list[str]:
    columns = _table_columns(conn, table)
    return [
        str(column["name"])
        for column in sorted(columns, key=lambda item: int(item.get("pk", 0) or 0))
        if int(column.get("pk", 0) or 0) > 0
    ]


def _open_catalog_schema() -> dict[str, Any]:
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://vintrace.local/schemas/open-photo-catalog-v1.schema.json",
        "title": "Vintrace Open Photo Catalog v1",
        "type": "object",
        "required": ["format", "formatVersion", "catalogId", "files", "counts"],
        "properties": {
            "format": {"const": OPEN_CATALOG_FORMAT},
            "formatVersion": {"const": OPEN_CATALOG_VERSION},
            "catalogId": {"type": "string", "pattern": "^[A-Za-z0-9_.-]{1,160}$"},
            "generatedAt": {"type": "string"},
            "mediaPolicy": {"enum": ["full", "catalog-only"]},
            "files": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["path", "sha256", "bytes", "kind"],
                    "properties": {
                        "path": {"type": "string"},
                        "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                        "bytes": {"type": "integer", "minimum": 0},
                        "kind": {"enum": ["schema", "assets", "entities", "preferences", "sidecars", "media", "sidecar-media"]},
                        "rows": {"type": "integer", "minimum": 0},
                    },
                    "additionalProperties": False,
                },
            },
            "counts": {"type": "object", "additionalProperties": {"type": "integer", "minimum": 0}},
        },
        "additionalProperties": True,
        "x-records": {
            "assets": "catalog/assets.ndjson contains one path-free asset object per line.",
            "entities": "catalog/entities.ndjson contains {entity, record} rows for allowlisted catalog entities.",
            "preferences": "catalog/preferences.json contains path-free durable curation/project preferences.",
            "sidecars": "catalog/sidecars.ndjson maps sidecar IDs to asset IDs, hashes, roles, and optional archive members.",
            "references": "Nested {$ref:'asset'|'sidecar',id:'...'} values replace machine-local paths.",
        },
    }


def _existing_sidecar_candidates(db: Any, source: Path) -> list[tuple[Path, str]]:
    candidates: dict[str, tuple[Path, str]] = {}
    suffix = source.suffix
    for sidecar_suffix in SIDECAR_SUFFIXES:
        values = [
            source.with_suffix(sidecar_suffix),
            source.with_name(f"{source.name}{sidecar_suffix}"),
        ]
        if suffix:
            values.append(source.with_suffix(f"{suffix}{sidecar_suffix}"))
        for candidate in values:
            candidates[_canonical_path_key(candidate)] = (candidate, sidecar_suffix.lstrip("."))
    adjacent = getattr(db, "_adjacent_spatial_companions", None)
    if callable(adjacent):
        try:
            for pair_kind, candidate, role in adjacent(source):
                candidates[_canonical_path_key(candidate)] = (Path(candidate), str(role or pair_kind or "companion"))
        except (OSError, ValueError):
            pass
    output: list[tuple[Path, str]] = []
    for candidate, role in candidates.values():
        try:
            resolved = candidate.expanduser().resolve()
            if resolved == source.resolve() or resolved.parent != source.resolve().parent or not resolved.is_file() or resolved.is_symlink():
                continue
        except OSError:
            continue
        output.append((resolved, role))
    return sorted(output, key=lambda item: (item[0].name.casefold(), item[1]))


def _atomic_copy_verified(
    source: Path,
    target: Path,
    *,
    expected_hash: str = "",
    expected_size: int | None = None,
    cancel_check: CancelCheck | None = None,
) -> tuple[str, int]:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f".{target.name}.partial-{uuid.uuid4().hex}")
    digest = sha256()
    size = 0
    try:
        with source.open("rb") as source_handle, partial.open("xb") as target_handle:
            while True:
                if cancel_check is not None and cancel_check():
                    raise OpenPhotoCatalogCancelled("Open catalog operation was cancelled.")
                block = source_handle.read(1024 * 1024)
                if not block:
                    break
                target_handle.write(block)
                digest.update(block)
                size += len(block)
            target_handle.flush()
            os.fsync(target_handle.fileno())
        actual_hash = digest.hexdigest()
        if expected_hash and actual_hash != expected_hash:
            raise OpenPhotoCatalogError(f"Source changed while copying: {source.name}.")
        if expected_size is not None and size != expected_size:
            raise OpenPhotoCatalogError(f"Source size changed while copying: {source.name}.")
        shutil.copystat(source, partial, follow_symlinks=False)
        partial.replace(target)
        return actual_hash, size
    finally:
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass


def _verified_copy_target(
    target: Path,
    expected_hash: str,
    *,
    cancel_check: CancelCheck | None = None,
) -> tuple[Path, bool]:
    candidate = target
    counter = 1
    while candidate.exists() or candidate.is_symlink():
        try:
            if candidate.is_file() and not candidate.is_symlink():
                current_hash, _ = _sha256_file(candidate, cancel_check=cancel_check)
                if current_hash == expected_hash:
                    return candidate, True
        except OSError:
            pass
        suffix = f"-{expected_hash[:8]}" if counter == 1 else f"-{expected_hash[:8]}-{counter}"
        candidate = target.with_name(f"{target.stem}{suffix}{target.suffix}")
        counter += 1
        if counter > 10_000:
            raise OpenPhotoCatalogError(f"Could not allocate a verified destination for {target.name}.")
    return candidate, False


def _write_member(root: Path, relative: str, data: bytes, kind: str, *, rows: int | None = None) -> dict[str, Any]:
    target = _safe_member_path(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    digest = sha256(data).hexdigest()
    entry: dict[str, Any] = {"path": relative, "sha256": digest, "bytes": len(data), "kind": kind}
    if rows is not None:
        entry["rows"] = max(0, int(rows))
    return entry


def _write_ndjson_member(
    root: Path,
    relative: str,
    records: Iterable[dict[str, Any]],
    kind: str,
    *,
    cancel_check: CancelCheck | None = None,
) -> dict[str, Any]:
    target = _safe_member_path(root, relative)
    target.parent.mkdir(parents=True, exist_ok=True)
    digest = sha256()
    size = 0
    rows = 0
    with target.open("wb") as handle:
        for record in records:
            if cancel_check is not None and cancel_check():
                raise OpenPhotoCatalogCancelled("Open catalog operation was cancelled.")
            data = _json_bytes(record)
            if len(data) > MAX_NDJSON_LINE_BYTES:
                raise OpenPhotoCatalogError(f"Open catalog record exceeds its line limit in {relative}.")
            handle.write(data)
            digest.update(data)
            size += len(data)
            rows += 1
    return {
        "path": relative,
        "sha256": digest.hexdigest(),
        "bytes": size,
        "kind": kind,
        "rows": rows,
    }


def _copy_member(
    root: Path,
    relative: str,
    source: Path,
    kind: str,
    *,
    expected_hash: str = "",
    expected_size: int | None = None,
    cancel_check: CancelCheck | None = None,
) -> dict[str, Any]:
    digest = str(expected_hash or "").lower()
    size = expected_size
    if not re.fullmatch(r"[0-9a-f]{64}", digest) or size is None:
        digest, size = _sha256_file(source, cancel_check=cancel_check)
        if expected_hash and digest != expected_hash:
            raise OpenPhotoCatalogError(f"Source changed while exporting: {source.name}.")
    target = _safe_member_path(root, relative)
    if target.exists():
        current_hash, current_size = _sha256_file(target, cancel_check=cancel_check)
        if current_hash != digest or current_size != size:
            raise OpenPhotoCatalogError(f"Hash-addressed package member collision: {relative}.")
    else:
        copied_hash, copied_size = _atomic_copy_verified(
            source,
            target,
            expected_hash=digest,
            expected_size=size,
            cancel_check=cancel_check,
        )
        if copied_hash != digest or copied_size != size:
            raise OpenPhotoCatalogError(f"Open catalog member copy verification failed: {relative}.")
    return {"path": relative, "sha256": digest, "bytes": size, "kind": kind}


class OpenPhotoCatalogService:
    def __init__(self, workspace_db: Any, workspace_root: str | Path):
        self.db = workspace_db
        self.workspace_root = Path(workspace_root).expanduser().resolve()

    @staticmethod
    def format_status() -> dict[str, Any]:
        return {
            "format": OPEN_CATALOG_FORMAT,
            "formatVersion": OPEN_CATALOG_VERSION,
            "extension": OPEN_CATALOG_EXTENSION,
            "container": "directory",
            "catalogEncoding": "UTF-8 JSON and NDJSON",
            "mediaEncoding": "original bytes",
            "checksums": "SHA-256 per member",
            "encrypted": False,
            "pathFree": True,
            "networkAccess": "none",
            "portableEntities": [spec.table for spec in PORTABLE_TABLES],
            "portablePreferences": list(PORTABLE_META_KEYS),
            "excluded": [
                "biometric templates and face embeddings",
                "semantic vectors and generated preview caches",
                "search indexes and indexing/source job queues",
                "sync transport keys, signatures, and operation logs",
                "machine-specific workspace, backup, and managed-root settings",
                "undo payloads that can reference local trash paths",
            ],
        }

    def catalog_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        with self.db.connect() as conn:
            for name, table in (
                ("assets", "photo_assets"),
                ("albums", "photo_albums"),
                ("albumFolders", "photo_album_folders"),
                ("keywords", "photo_keywords"),
                ("peopleProfiles", "photo_people_profiles"),
                ("editStacks", "photo_edit_stacks"),
                ("editVersions", "photo_edit_stack_versions"),
                ("mediaPairs", "photo_media_pairs"),
            ):
                counts[name] = int(conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]) if _table_exists(conn, table) else 0
        return counts

    def _emit(self, callback: ProgressCallback | None, payload: dict[str, Any]) -> None:
        if callback is not None:
            callback(_json_safe(payload))

    @staticmethod
    def _raise_if_cancelled(cancel_check: CancelCheck | None) -> None:
        if cancel_check is not None and cancel_check():
            raise OpenPhotoCatalogCancelled("Open catalog operation was cancelled.")

    def _export_assets_and_sidecars(
        self,
        conn: sqlite3.Connection,
        package_root: Path,
        *,
        include_originals: bool,
        include_sidecars: bool,
        callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> tuple[dict[str, Any], dict[str, Any], dict[str, str], dict[str, str], list[dict[str, Any]], dict[str, int]]:
        asset_total = int(conn.execute("SELECT COUNT(*) FROM photo_assets").fetchone()[0])
        asset_paths: dict[str, str] = {}
        for row in conn.execute("SELECT asset_id, source_path FROM photo_assets ORDER BY asset_id ASC"):
            source_path = str(row["source_path"] or "").strip()
            if source_path:
                asset_paths[_canonical_path_key(source_path)] = str(row["asset_id"] or "")

        sidecar_paths: dict[str, str] = {}
        sidecar_sources: dict[str, tuple[Path, str, str]] = {}
        for row in conn.execute("SELECT asset_id, source_path FROM photo_assets ORDER BY asset_id ASC"):
            self._raise_if_cancelled(cancel_check)
            asset_id = str(row["asset_id"] or "")
            source = Path(str(row["source_path"] or "")).expanduser()
            if include_sidecars and source.is_file():
                for candidate, role in _existing_sidecar_candidates(self.db, source):
                    key = _canonical_path_key(candidate)
                    sidecar_id = f"sidecar_{sha256(f'{asset_id}:{key}:{role}'.encode('utf-8')).hexdigest()[:40]}"
                    sidecar_paths[key] = sidecar_id
                    sidecar_sources[sidecar_id] = (candidate, asset_id, role)
        if include_sidecars and _table_exists(conn, "photo_media_pairs"):
            for row in conn.execute(
                "SELECT asset_id, pair_kind, related_source_path FROM photo_media_pairs ORDER BY pair_id ASC"
            ):
                related = str(row["related_source_path"] or "").strip()
                if not related:
                    continue
                key = _canonical_path_key(related)
                if key in asset_paths or key in sidecar_paths:
                    continue
                candidate = Path(related).expanduser()
                try:
                    if not candidate.is_file() or candidate.is_symlink():
                        continue
                    candidate = candidate.resolve()
                except OSError:
                    continue
                asset_id = str(row["asset_id"] or "")
                role = str(row["pair_kind"] or "related_media")
                sidecar_id = f"sidecar_{sha256(f'{asset_id}:{key}:{role}'.encode('utf-8')).hexdigest()[:40]}"
                sidecar_paths[key] = sidecar_id
                sidecar_sources[sidecar_id] = (candidate, asset_id, role)

        member_entries: list[dict[str, Any]] = []
        copied_media: set[str] = set()
        missing_originals = 0
        total_media_bytes = 0

        def asset_records() -> Iterator[dict[str, Any]]:
            nonlocal missing_originals, total_media_bytes
            for index, row in enumerate(conn.execute("SELECT * FROM photo_assets ORDER BY asset_id ASC"), start=1):
                self._raise_if_cancelled(cancel_check)
                asset_id = str(row["asset_id"] or "")
                source_path = str(row["source_path"] or "")
                source = Path(source_path).expanduser()
                try:
                    exists = source.is_file() and not source.is_symlink()
                except OSError:
                    exists = False
                digest = str(row["content_hash"] or "").strip().lower()
                size = 0
                archive_path = ""
                if exists:
                    digest, size = _sha256_file(source, cancel_check=cancel_check)
                    if include_originals:
                        suffix = re.sub(r"[^A-Za-z0-9.]", "", source.suffix.lower())[:16] or ".bin"
                        archive_path = f"media/originals/{digest[:2]}/{digest}{suffix}"
                        if archive_path not in copied_media:
                            entry = _copy_member(
                                package_root,
                                archive_path,
                                source,
                                "media",
                                expected_hash=digest,
                                expected_size=size,
                                cancel_check=cancel_check,
                            )
                            member_entries.append(entry)
                            copied_media.add(archive_path)
                            total_media_bytes += int(entry["bytes"])
                else:
                    missing_originals += 1
                metadata = _json_value(row["metadata_json"], {})
                file_signature = _json_value(row["file_signature_json"], {})
                yield {
                    "id": asset_id,
                    "original": {
                        "fileName": _clean_filename(source.name, f"{asset_id}.bin"),
                        "archivePath": archive_path,
                        "sha256": digest if re.fullmatch(r"[0-9a-f]{64}", digest) else "",
                        "bytes": max(0, int(size)),
                        "missing": not exists,
                    },
                    "sourceKind": str(row["source_kind"] or "referenced"),
                    "fileSignature": _portableize_json(file_signature, asset_paths=asset_paths, sidecar_paths=sidecar_paths),
                    "perceptualHash": str(row["perceptual_hash"] or ""),
                    "mediaKind": str(row["media_kind"] or "image"),
                    "mimeType": str(row["mime_type"] or ""),
                    "width": row["width"],
                    "height": row["height"],
                    "durationMs": row["duration_ms"],
                    "captureDate": str(row["capture_date"] or ""),
                    "addedAt": str(row["added_at"] or ""),
                    "updatedAt": str(row["updated_at"] or ""),
                    "missingAt": str(row["missing_at"] or ""),
                    "metadata": _portableize_json(metadata, asset_paths=asset_paths, sidecar_paths=sidecar_paths),
                }
                if index == 1 or index % 100 == 0 or index == asset_total:
                    self._emit(callback, {
                        "phase": "assets",
                        "processed": index,
                        "total": asset_total,
                        "message": f"Cataloged {index} of {asset_total} assets.",
                    })

        assets_entry = _write_ndjson_member(
            package_root,
            "catalog/assets.ndjson",
            asset_records(),
            "assets",
            cancel_check=cancel_check,
        )

        sidecar_total = len(sidecar_sources)

        def sidecar_records() -> Iterator[dict[str, Any]]:
            nonlocal total_media_bytes
            for index, (sidecar_id, (source, asset_id, role)) in enumerate(sorted(sidecar_sources.items()), start=1):
                self._raise_if_cancelled(cancel_check)
                digest, size = _sha256_file(source, cancel_check=cancel_check)
                archive_path = ""
                if include_sidecars:
                    suffix = re.sub(r"[^A-Za-z0-9.]", "", source.suffix.lower())[:16] or ".sidecar"
                    archive_path = f"media/sidecars/{digest[:2]}/{digest}{suffix}"
                    if archive_path not in copied_media:
                        entry = _copy_member(
                            package_root,
                            archive_path,
                            source,
                            "sidecar-media",
                            expected_hash=digest,
                            expected_size=size,
                            cancel_check=cancel_check,
                        )
                        member_entries.append(entry)
                        copied_media.add(archive_path)
                        total_media_bytes += int(entry["bytes"])
                yield {
                    "id": sidecar_id,
                    "assetId": asset_id,
                    "role": role,
                    "fileName": _clean_filename(source.name, "sidecar"),
                    "sha256": digest,
                    "bytes": size,
                    "archivePath": archive_path,
                }
                if index % 100 == 0 or index == sidecar_total:
                    self._emit(callback, {
                        "phase": "sidecars",
                        "processed": index,
                        "total": sidecar_total,
                        "message": f"Cataloged {index} of {sidecar_total} sidecars and companions.",
                    })

        sidecars_entry = _write_ndjson_member(
            package_root,
            "catalog/sidecars.ndjson",
            sidecar_records(),
            "sidecars",
            cancel_check=cancel_check,
        )
        return (
            assets_entry,
            sidecars_entry,
            asset_paths,
            sidecar_paths,
            member_entries,
            {
                "assets": int(assets_entry["rows"]),
                "sidecars": int(sidecars_entry["rows"]),
                "missingOriginals": missing_originals,
                "mediaFiles": len(copied_media),
                "mediaBytes": total_media_bytes,
            },
        )

    def _export_entities(
        self,
        conn: sqlite3.Connection,
        package_root: Path,
        *,
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
        callback: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> tuple[dict[str, Any], dict[str, int]]:
        counts: dict[str, int] = {}
        available: list[tuple[int, PortableTable, str, int]] = []
        for spec_index, spec in enumerate(PORTABLE_TABLES, start=1):
            self._raise_if_cancelled(cancel_check)
            if not _table_exists(conn, spec.table):
                continue
            primary = _primary_columns(conn, spec.table)
            order = ", ".join(f'"{column}" ASC' for column in primary) if primary else "rowid ASC"
            row_count = int(conn.execute(f'SELECT COUNT(*) FROM "{spec.table}"').fetchone()[0])
            counts[spec.table] = row_count
            available.append((spec_index, spec, order, row_count))

        def entity_records() -> Iterator[dict[str, Any]]:
            for spec_index, spec, order, row_count in available:
                self._raise_if_cancelled(cancel_check)
                for row in conn.execute(f'SELECT * FROM "{spec.table}" ORDER BY {order}'):
                    record: dict[str, Any] = {}
                    for column in row.keys():
                        raw = row[column]
                        if column.endswith("_json"):
                            fallback: Any = [] if str(raw or "").lstrip().startswith("[") else {}
                            raw = _json_value(raw, fallback)
                        if column in PATH_COLUMNS_TO_CLEAR:
                            raw = ""
                        record[column] = _portableize_json(raw, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
                    if spec.table == "photo_tether_sessions":
                        if str(record.get("status", "")) in {"active", "recoverable"}:
                            record["status"] = "stopped"
                        settings = record.get("settings_json") if isinstance(record.get("settings_json"), dict) else {}
                        record["settings_json"] = {**settings, "autoResume": False}
                        record["source_path"] = ""
                        record["destination_path"] = ""
                        record["managed_root"] = ""
                    elif spec.table == "photo_tether_captures":
                        record["source_path"] = _portableize_json(row["source_path"], asset_paths=asset_paths, sidecar_paths=sidecar_paths)
                        record["target_path"] = _portableize_json(row["target_path"], asset_paths=asset_paths, sidecar_paths=sidecar_paths)
                    elif spec.table == "photo_external_sources":
                        record["root_path"] = ""
                    elif spec.table == "photo_import_sessions":
                        record["root_path"] = ""
                        if str(record.get("status", "")) == "running":
                            record["status"] = "interrupted"
                    yield {"entity": spec.table, "record": record}
                self._emit(callback, {
                    "phase": "entities",
                    "processed": spec_index,
                    "total": len(PORTABLE_TABLES),
                    "entity": spec.table,
                    "rows": row_count,
                    "message": f"Exported {spec.table}.",
                })

        entry = _write_ndjson_member(
            package_root,
            "catalog/entities.ndjson",
            entity_records(),
            "entities",
            cancel_check=cancel_check,
        )
        return entry, counts

    def _export_preferences(
        self,
        conn: sqlite3.Connection,
        *,
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
    ) -> dict[str, Any]:
        output: dict[str, Any] = {}
        for key in PORTABLE_META_KEYS:
            row = conn.execute("SELECT value FROM meta WHERE key = ? LIMIT 1", (key,)).fetchone()
            if row is None:
                continue
            output[key] = _portableize_json(
                _json_value(row["value"], {}),
                asset_paths=asset_paths,
                sidecar_paths=sidecar_paths,
            )
        return output

    def export_catalog(
        self,
        destination: str | Path,
        *,
        include_originals: bool = True,
        include_sidecars: bool = True,
        package_name: str = "",
        progress: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> dict[str, Any]:
        destination_root = Path(destination).expanduser().resolve()
        destination_root.mkdir(parents=True, exist_ok=True)
        if not destination_root.is_dir():
            raise OpenPhotoCatalogError("Open catalog destination must be a folder.")
        requested_name = _clean_filename(package_name, "") if package_name else ""
        base_name = requested_name or f"vintrace-open-catalog-{_utc_stamp()}"
        if not base_name.endswith(OPEN_CATALOG_EXTENSION):
            base_name += OPEN_CATALOG_EXTENSION
        package_root = destination_root / base_name
        counter = 2
        while package_root.exists():
            stem = base_name[: -len(OPEN_CATALOG_EXTENSION)]
            package_root = destination_root / f"{stem}-{counter}{OPEN_CATALOG_EXTENSION}"
            counter += 1
        partial_root = destination_root / f".{package_root.name}.partial-{uuid.uuid4().hex}"
        catalog_id = f"catalog_{uuid.uuid4().hex}"
        partial_root.mkdir(parents=True)
        try:
            self._emit(progress, {"phase": "starting", "processed": 0, "message": "Preparing open catalog export."})
            with self.db.connect() as conn:
                # Sidecar files (Live Photo .mov halves, depth maps, RAW/XMP companions) are
                # media bytes. A "catalog-only" package promises zero pixels, so it must not ship
                # them either — the byte-copy requires include_originals, not just include_sidecars.
                # The pairing RELATIONSHIP is still preserved via the photo_media_pairs entity rows.
                effective_include_sidecars = bool(include_sidecars) and bool(include_originals)
                (
                    assets_entry,
                    sidecars_entry,
                    asset_paths,
                    sidecar_paths,
                    media_entries,
                    counts,
                ) = self._export_assets_and_sidecars(
                    conn,
                    partial_root,
                    include_originals=bool(include_originals),
                    include_sidecars=effective_include_sidecars,
                    callback=progress,
                    cancel_check=cancel_check,
                )
                entities_entry, entity_counts = self._export_entities(
                    conn,
                    partial_root,
                    asset_paths=asset_paths,
                    sidecar_paths=sidecar_paths,
                    callback=progress,
                    cancel_check=cancel_check,
                )
                preferences = self._export_preferences(
                    conn,
                    asset_paths=asset_paths,
                    sidecar_paths=sidecar_paths,
                )
            self._raise_if_cancelled(cancel_check)
            files = [
                _write_member(partial_root, "schema/open-photo-catalog-v1.schema.json", _json_bytes(_open_catalog_schema(), pretty=True), "schema"),
                assets_entry,
                entities_entry,
                _write_member(partial_root, "catalog/preferences.json", _json_bytes(preferences, pretty=True), "preferences"),
                sidecars_entry,
                *media_entries,
            ]
            counts.update({"entityRows": int(entities_entry["rows"]), "preferenceGroups": len(preferences)})
            for entity, count in entity_counts.items():
                counts[f"entity:{entity}"] = count
            manifest = {
                "format": OPEN_CATALOG_FORMAT,
                "formatVersion": OPEN_CATALOG_VERSION,
                "catalogId": catalog_id,
                "generatedAt": now_iso(),
                "mediaPolicy": "full" if include_originals else "catalog-only",
                "includeSidecars": effective_include_sidecars,
                "pathFree": True,
                "encrypted": False,
                "files": sorted(files, key=lambda item: str(item["path"])),
                "counts": counts,
                "compatibility": {
                    "minimumImporterVersion": 1,
                    "unknownEntityPolicy": "ignore-with-warning",
                    "referenceEncoding": "$ref",
                },
            }
            _safe_member_path(partial_root, "manifest.json").write_bytes(_json_bytes(manifest, pretty=True))
            self._validate_catalog_semantics(
                partial_root,
                manifest,
                progress=progress,
                cancel_check=cancel_check,
            )
            partial_root.replace(package_root)
            self._emit(progress, {
                "phase": "completed",
                "processed": counts["assets"],
                "total": counts["assets"],
                "message": "Open catalog export completed.",
            })
            return {
                "format": OPEN_CATALOG_FORMAT,
                "formatVersion": OPEN_CATALOG_VERSION,
                "catalogId": catalog_id,
                "catalogPath": str(package_root),
                "manifestPath": str(package_root / "manifest.json"),
                "mediaPolicy": manifest["mediaPolicy"],
                "counts": counts,
                "pathFree": True,
                "verified": True,
            }
        except Exception:
            shutil.rmtree(partial_root, ignore_errors=True)
            raise

    def _load_manifest(self, catalog_path: str | Path) -> tuple[Path, dict[str, Any]]:
        root = Path(catalog_path).expanduser().resolve()
        if root.is_file() and root.name == "manifest.json":
            root = root.parent
        manifest_path = root / "manifest.json"
        if not root.is_dir() or manifest_path.is_symlink() or not manifest_path.is_file():
            raise OpenPhotoCatalogError("Select a Vintrace open catalog folder containing manifest.json.")
        if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
            raise OpenPhotoCatalogError("Open catalog manifest is too large.")
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError, RecursionError) as exc:
            raise OpenPhotoCatalogError("Open catalog manifest is not valid UTF-8 JSON.") from exc
        if not isinstance(manifest, dict) or manifest.get("format") != OPEN_CATALOG_FORMAT:
            raise OpenPhotoCatalogError("This folder is not a Vintrace open photo catalog.")
        try:
            version = int(manifest.get("formatVersion", 0) or 0)
        except (TypeError, ValueError):
            version = 0
        if version != OPEN_CATALOG_VERSION:
            raise OpenPhotoCatalogError(
                f"Open catalog version {version or 'unknown'} is not supported; this build supports version {OPEN_CATALOG_VERSION}."
            )
        catalog_id = str(manifest.get("catalogId", "") or "")
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", catalog_id):
            raise OpenPhotoCatalogError("Open catalog catalogId is invalid.")
        files = manifest.get("files")
        if not isinstance(files, list) or not files or len(files) > MAX_CATALOG_MEMBERS:
            raise OpenPhotoCatalogError("Open catalog file inventory is missing or exceeds its safety limit.")
        counts = manifest.get("counts")
        if not isinstance(counts, dict):
            raise OpenPhotoCatalogError("Open catalog counts are missing or invalid.")
        for key, value in counts.items():
            if not isinstance(key, str) or not key:
                raise OpenPhotoCatalogError("Open catalog counts contain an invalid key.")
            _strict_nonnegative_int(value, f"count {key}")
        return root, manifest

    def inspect_catalog(
        self,
        catalog_path: str | Path,
        *,
        verify_media: bool = False,
        progress: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> dict[str, Any]:
        root, manifest = self._load_manifest(catalog_path)
        return self._inspect_loaded_catalog(
            root,
            manifest,
            verify_media=verify_media,
            progress=progress,
            cancel_check=cancel_check,
        )

    def _inspect_loaded_catalog(
        self,
        root: Path,
        manifest: dict[str, Any],
        *,
        verify_media: bool,
        progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> dict[str, Any]:
        files = manifest["files"]
        seen_kinds: dict[str, int] = {}
        verified_files = 0
        verified_bytes = 0
        skipped_media_files = 0
        paths: set[str] = set()
        for index, entry in enumerate(files, start=1):
            self._raise_if_cancelled(cancel_check)
            if not isinstance(entry, dict):
                raise OpenPhotoCatalogError("Open catalog file inventory contains an invalid entry.")
            relative = str(entry.get("path", "") or "")
            kind = str(entry.get("kind", "") or "")
            expected_hash = str(entry.get("sha256", "") or "").lower()
            if set(entry) - {"path", "sha256", "bytes", "kind", "rows"}:
                raise OpenPhotoCatalogError(f"Open catalog inventory entry has unsupported fields: {relative or 'unknown'}.")
            if kind not in ALLOWED_MEMBER_KINDS:
                raise OpenPhotoCatalogError(f"Open catalog inventory member kind is invalid: {kind or 'empty'}.")
            expected_size = _strict_nonnegative_int(entry.get("bytes"), f"member size for {relative or 'unknown'}")
            if kind in RECORD_MEMBER_KINDS:
                _strict_nonnegative_int(entry.get("rows"), f"row count for {kind}", maximum=MAX_CATALOG_RECORDS)
            elif "rows" in entry:
                _strict_nonnegative_int(entry.get("rows"), f"row count for {kind}", maximum=MAX_CATALOG_RECORDS)
            if relative in paths:
                raise OpenPhotoCatalogError(f"Open catalog inventory repeats a member: {relative}.")
            paths.add(relative)
            seen_kinds[kind] = seen_kinds.get(kind, 0) + 1
            if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
                raise OpenPhotoCatalogError(f"Open catalog checksum metadata is invalid: {relative}.")
            member = _assert_regular_member(root, relative)
            stat = member.stat()
            if int(stat.st_size) != expected_size:
                raise OpenPhotoCatalogError(f"Open catalog member size does not match its manifest: {relative}.")
            should_hash = verify_media or kind not in {"media", "sidecar-media"}
            if should_hash:
                actual_hash, actual_size = _sha256_file(member, cancel_check=cancel_check)
                if actual_hash != expected_hash or actual_size != expected_size:
                    raise OpenPhotoCatalogError(f"Open catalog member checksum failed: {relative}.")
                verified_files += 1
                verified_bytes += actual_size
            else:
                skipped_media_files += 1
            if index == 1 or index % 250 == 0 or index == len(files):
                self._emit(progress, {
                    "phase": "verify",
                    "processed": index,
                    "total": len(files),
                    "message": f"Verified {index} of {len(files)} catalog members.",
                })
        missing_kinds = REQUIRED_SINGLETON_KINDS - set(seen_kinds)
        if missing_kinds:
            raise OpenPhotoCatalogError(f"Open catalog is missing required member groups: {', '.join(sorted(missing_kinds))}.")
        repeated_kinds = sorted(kind for kind in REQUIRED_SINGLETON_KINDS if seen_kinds.get(kind, 0) != 1)
        if repeated_kinds:
            raise OpenPhotoCatalogError(f"Open catalog repeats required member groups: {', '.join(repeated_kinds)}.")
        semantic = self._validate_catalog_semantics(
            root,
            manifest,
            progress=progress,
            cancel_check=cancel_check,
        )
        counts = manifest.get("counts") if isinstance(manifest.get("counts"), dict) else {}
        return {
            "format": OPEN_CATALOG_FORMAT,
            "formatVersion": OPEN_CATALOG_VERSION,
            "catalogId": str(manifest["catalogId"]),
            "generatedAt": str(manifest.get("generatedAt", "") or ""),
            "mediaPolicy": str(manifest.get("mediaPolicy", "catalog-only") or "catalog-only"),
            "includeSidecars": bool(manifest.get("includeSidecars", False)),
            "pathFree": True,
            "encrypted": False,
            "counts": {str(key): int(value) for key, value in counts.items()},
            "members": len(files),
            "verifiedFiles": verified_files,
            "verifiedBytes": verified_bytes,
            "mediaVerificationDeferred": skipped_media_files,
            "fullyVerified": skipped_media_files == 0,
            "semanticVerified": True,
            "catalogPath": str(root),
            "unknownEntities": semantic["unknownEntities"],
            "warnings": [
                {
                    "code": "media-checks-deferred",
                    "message": "Media checksums will be verified during import.",
                }
            ] if skipped_media_files else [],
        }

    def _entry_for_kind(self, manifest: dict[str, Any], kind: str) -> dict[str, Any]:
        matches = [entry for entry in manifest["files"] if isinstance(entry, dict) and entry.get("kind") == kind]
        if len(matches) != 1:
            raise OpenPhotoCatalogError(f"Open catalog must contain exactly one {kind} member.")
        return matches[0]

    def _member_for_kind(self, root: Path, manifest: dict[str, Any], kind: str) -> Path:
        entry = self._entry_for_kind(manifest, kind)
        return _assert_regular_member(root, str(entry.get("path", "") or ""))

    def _rows_for_kind(self, manifest: dict[str, Any], kind: str) -> int:
        entry = self._entry_for_kind(manifest, kind)
        return _strict_nonnegative_int(
            entry.get("rows"),
            f"row count for {kind}",
            maximum=MAX_CATALOG_RECORDS,
        )

    def _iter_ndjson(
        self,
        path: Path,
        *,
        expected_rows: int | None = None,
        expected_hash: str = "",
        expected_size: int | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> Iterator[dict[str, Any]]:
        digest = sha256()
        size = 0
        records = 0
        line_number = 0
        with path.open("rb") as handle:
            while True:
                self._raise_if_cancelled(cancel_check)
                raw = handle.readline(MAX_NDJSON_LINE_BYTES + 1)
                if not raw:
                    break
                line_number += 1
                if len(raw) > MAX_NDJSON_LINE_BYTES:
                    raise OpenPhotoCatalogError(f"Open catalog record exceeds its line limit at {path.name}:{line_number}.")
                digest.update(raw)
                size += len(raw)
                if not raw.strip():
                    raise OpenPhotoCatalogError(f"Open catalog NDJSON contains a blank record at {path.name}:{line_number}.")
                try:
                    value = json.loads(raw.decode("utf-8"))
                except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
                    raise OpenPhotoCatalogError(f"Open catalog NDJSON is invalid at {path.name}:{line_number}.") from exc
                if not isinstance(value, dict):
                    raise OpenPhotoCatalogError(f"Open catalog record is not an object at {path.name}:{line_number}.")
                records += 1
                if records > MAX_CATALOG_RECORDS:
                    raise OpenPhotoCatalogError(f"Open catalog {path.name} exceeds its record safety limit.")
                yield value
        if expected_size is not None and size != expected_size:
            raise OpenPhotoCatalogError(f"Open catalog member changed while reading: {path.name}.")
        if expected_hash and digest.hexdigest() != expected_hash:
            raise OpenPhotoCatalogError(f"Open catalog member checksum changed while reading: {path.name}.")
        if expected_rows is not None and records != expected_rows:
            raise OpenPhotoCatalogError(
                f"Open catalog row count does not match its manifest for {path.name}: expected {expected_rows}, found {records}."
            )

    def _catalog_records(
        self,
        root: Path,
        manifest: dict[str, Any],
        kind: str,
        *,
        cancel_check: CancelCheck | None = None,
    ) -> Iterator[dict[str, Any]]:
        entry = self._entry_for_kind(manifest, kind)
        member = _assert_regular_member(root, str(entry.get("path", "") or ""))
        return self._iter_ndjson(
            member,
            expected_rows=self._rows_for_kind(manifest, kind),
            expected_hash=str(entry.get("sha256", "") or "").lower(),
            expected_size=_strict_nonnegative_int(entry.get("bytes"), f"member size for {kind}"),
            cancel_check=cancel_check,
        )

    def _read_preferences_member(
        self,
        root: Path,
        manifest: dict[str, Any],
        *,
        cancel_check: CancelCheck | None = None,
    ) -> dict[str, Any]:
        entry = self._entry_for_kind(manifest, "preferences")
        member = _assert_regular_member(root, str(entry.get("path", "") or ""))
        expected_size = _strict_nonnegative_int(entry.get("bytes"), "preferences member size")
        if expected_size > MAX_NDJSON_LINE_BYTES:
            raise OpenPhotoCatalogError("Open catalog preferences file exceeds its safety limit.")
        self._raise_if_cancelled(cancel_check)
        try:
            raw = member.read_bytes()
        except OSError as exc:
            raise OpenPhotoCatalogError("Open catalog preferences cannot be read.") from exc
        self._raise_if_cancelled(cancel_check)
        expected_hash = str(entry.get("sha256", "") or "").lower()
        if len(raw) != expected_size or sha256(raw).hexdigest() != expected_hash:
            raise OpenPhotoCatalogError("Open catalog preferences changed while reading.")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError, RecursionError) as exc:
            raise OpenPhotoCatalogError("Open catalog preferences are invalid.") from exc
        if not isinstance(body, dict):
            raise OpenPhotoCatalogError("Open catalog preferences must be an object.")
        return body

    @staticmethod
    def _assert_inventory_tree(root: Path, declared_paths: set[str]) -> None:
        actual_paths: set[str] = set()
        visited = 0

        def walk_error(error: OSError) -> None:
            raise OpenPhotoCatalogError("Open catalog package tree cannot be read.") from error

        for current_root, directory_names, file_names in os.walk(root, followlinks=False, onerror=walk_error):
            current = Path(current_root)
            for name in directory_names:
                visited += 1
                candidate = current / name
                if candidate.is_symlink():
                    raise OpenPhotoCatalogError("Open catalog package contains a symbolic-link directory.")
            for name in file_names:
                visited += 1
                candidate = current / name
                if candidate.is_symlink():
                    raise OpenPhotoCatalogError("Open catalog package contains a symbolic-link file.")
                relative = candidate.relative_to(root).as_posix()
                if relative == "manifest.json" or relative in declared_paths:
                    actual_paths.add(relative)
                elif name not in {".DS_Store", "Thumbs.db", "desktop.ini"} and not name.startswith("._"):
                    raise OpenPhotoCatalogError(f"Open catalog package contains an undeclared member: {relative}.")
            if visited > MAX_CATALOG_MEMBERS:
                raise OpenPhotoCatalogError("Open catalog package tree exceeds its safety limit.")
        missing = declared_paths - actual_paths
        if missing:
            raise OpenPhotoCatalogError(f"Open catalog package is missing an inventoried member: {sorted(missing)[0]}.")

    def _validate_catalog_semantics(
        self,
        root: Path,
        manifest: dict[str, Any],
        *,
        progress: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> dict[str, Any]:
        if manifest.get("pathFree") is not True:
            raise OpenPhotoCatalogError("Open catalog must explicitly declare pathFree=true.")
        if manifest.get("encrypted") is not False:
            raise OpenPhotoCatalogError("Encrypted open catalog packages are not supported by format version 1.")
        if manifest.get("mediaPolicy") not in {"full", "catalog-only"}:
            raise OpenPhotoCatalogError("Open catalog mediaPolicy is invalid.")
        if not isinstance(manifest.get("includeSidecars"), bool):
            raise OpenPhotoCatalogError("Open catalog includeSidecars flag is invalid.")

        inventory: dict[str, dict[str, Any]] = {}
        total_rows = 0
        for entry in manifest["files"]:
            relative = str(entry.get("path", "") or "")
            inventory[relative] = entry
            if str(entry.get("kind", "") or "") in RECORD_MEMBER_KINDS:
                total_rows += _strict_nonnegative_int(
                    entry.get("rows"),
                    f"row count for {relative}",
                    maximum=MAX_CATALOG_RECORDS,
                )
        if total_rows > MAX_CATALOG_RECORDS:
            raise OpenPhotoCatalogError("Open catalog total record count exceeds its safety limit.")
        self._assert_inventory_tree(root, set(inventory))

        counts = manifest["counts"]
        references: set[tuple[str, str]] = set()
        archive_paths: set[str] = set()
        asset_ids: set[str] = set()
        sidecar_ids: set[str] = set()
        entity_counts: dict[str, int] = {}
        unknown_entities: set[str] = set()
        processed = 0

        def mark_progress() -> None:
            nonlocal processed
            processed += 1
            if processed == 1 or processed % 1000 == 0 or processed == total_rows:
                self._emit(progress, {
                    "phase": "validate-records",
                    "processed": processed,
                    "total": total_rows,
                    "message": f"Validated {processed} of {total_rows or processed} catalog records.",
                })

        for record in self._catalog_records(root, manifest, "assets", cancel_check=cancel_check):
            _assert_path_free_json(record, context="asset record", references=references)
            external_id = str(record.get("id", "") or "")
            if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", external_id) or external_id in asset_ids:
                raise OpenPhotoCatalogError("Open catalog contains an invalid or duplicate asset id.")
            asset_ids.add(external_id)
            original = record.get("original")
            if not isinstance(original, dict):
                raise OpenPhotoCatalogError(f"Open catalog asset original is invalid: {external_id}.")
            filename = str(original.get("fileName", "") or "")
            if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
                raise OpenPhotoCatalogError(f"Open catalog asset filename is invalid: {external_id}.")
            digest = str(original.get("sha256", "") or "").lower()
            if digest and not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise OpenPhotoCatalogError(f"Open catalog asset hash is invalid: {external_id}.")
            original_size = _strict_nonnegative_int(original.get("bytes"), f"asset byte count for {external_id}")
            archive_path = str(original.get("archivePath", "") or "")
            if archive_path:
                if manifest["mediaPolicy"] != "full":
                    raise OpenPhotoCatalogError("Catalog-only open catalogs cannot contain archived originals.")
                archive_entry = inventory.get(archive_path)
                if archive_entry is None or archive_entry.get("kind") != "media":
                    raise OpenPhotoCatalogError(f"Open catalog asset archive is not inventoried as media: {external_id}.")
                if not digest or digest != str(archive_entry.get("sha256", "") or "").lower():
                    raise OpenPhotoCatalogError(f"Open catalog asset archive hash metadata disagrees: {external_id}.")
                if original_size != _strict_nonnegative_int(archive_entry.get("bytes"), f"archive size for {external_id}"):
                    raise OpenPhotoCatalogError(f"Open catalog asset archive size metadata disagrees: {external_id}.")
                archive_paths.add(archive_path)
            mark_progress()

        for record in self._catalog_records(root, manifest, "sidecars", cancel_check=cancel_check):
            _assert_path_free_json(record, context="sidecar record", references=references)
            sidecar_id = str(record.get("id", "") or "")
            asset_id = str(record.get("assetId", "") or "")
            if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", sidecar_id) or sidecar_id in sidecar_ids:
                raise OpenPhotoCatalogError("Open catalog contains an invalid or duplicate sidecar id.")
            if asset_id not in asset_ids:
                raise OpenPhotoCatalogError(f"Open catalog sidecar references an unknown asset: {sidecar_id}.")
            sidecar_ids.add(sidecar_id)
            filename = str(record.get("fileName", "") or "")
            if not filename or filename in {".", ".."} or "/" in filename or "\\" in filename:
                raise OpenPhotoCatalogError(f"Open catalog sidecar filename is invalid: {sidecar_id}.")
            digest = str(record.get("sha256", "") or "").lower()
            if not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise OpenPhotoCatalogError(f"Open catalog sidecar hash is invalid: {sidecar_id}.")
            sidecar_size = _strict_nonnegative_int(record.get("bytes"), f"sidecar byte count for {sidecar_id}")
            archive_path = str(record.get("archivePath", "") or "")
            if archive_path:
                if manifest["includeSidecars"] is not True:
                    raise OpenPhotoCatalogError("Open catalog contains sidecar media while includeSidecars=false.")
                archive_entry = inventory.get(archive_path)
                if archive_entry is None or archive_entry.get("kind") != "sidecar-media":
                    raise OpenPhotoCatalogError(f"Open catalog sidecar archive is not inventoried: {sidecar_id}.")
                if digest != str(archive_entry.get("sha256", "") or "").lower():
                    raise OpenPhotoCatalogError(f"Open catalog sidecar archive hash metadata disagrees: {sidecar_id}.")
                if sidecar_size != _strict_nonnegative_int(archive_entry.get("bytes"), f"archive size for {sidecar_id}"):
                    raise OpenPhotoCatalogError(f"Open catalog sidecar archive size metadata disagrees: {sidecar_id}.")
                archive_paths.add(archive_path)
            mark_progress()

        specs = {spec.table: spec for spec in PORTABLE_TABLES}
        for wrapper in self._catalog_records(root, manifest, "entities", cancel_check=cancel_check):
            _assert_path_free_json(wrapper, context="entity record", references=references)
            entity = str(wrapper.get("entity", "") or "")
            record = wrapper.get("record")
            if not re.fullmatch(r"[A-Za-z0-9_]{1,160}", entity) or not isinstance(record, dict):
                raise OpenPhotoCatalogError("Open catalog contains an invalid entity record.")
            entity_counts[entity] = entity_counts.get(entity, 0) + 1
            spec = specs.get(entity)
            if spec is None:
                unknown_entities.add(entity)
            else:
                for column in spec.asset_columns:
                    value = str(record.get(column, "") or "")
                    if value and value not in asset_ids:
                        raise OpenPhotoCatalogError(f"Open catalog {entity} references an unknown asset.")
            mark_progress()

        preferences = self._read_preferences_member(root, manifest, cancel_check=cancel_check)
        _assert_path_free_json(preferences, context="preferences", references=references)
        for ref_kind, ref_id in references:
            if ref_kind == "asset" and ref_id not in asset_ids:
                raise OpenPhotoCatalogError("Open catalog contains a portable reference to an unknown asset.")
            if ref_kind == "sidecar" and ref_id not in sidecar_ids:
                raise OpenPhotoCatalogError("Open catalog contains a portable reference to an unknown sidecar.")

        inventoried_media = {
            relative
            for relative, entry in inventory.items()
            if entry.get("kind") in {"media", "sidecar-media"}
        }
        if inventoried_media != archive_paths:
            raise OpenPhotoCatalogError("Open catalog media inventory and catalog references do not agree.")

        expected_counts = {
            "assets": len(asset_ids),
            "sidecars": len(sidecar_ids),
            "entityRows": sum(entity_counts.values()),
            "preferenceGroups": sum(1 for key in PORTABLE_META_KEYS if key in preferences),
            "mediaFiles": len(inventoried_media),
            "mediaBytes": sum(int(inventory[path]["bytes"]) for path in inventoried_media),
        }
        for key, actual in expected_counts.items():
            if counts.get(key) != actual:
                raise OpenPhotoCatalogError(f"Open catalog count {key} does not match its records.")
        for key, expected in counts.items():
            if not key.startswith("entity:"):
                continue
            entity = key.split(":", 1)[1]
            if entity_counts.get(entity, 0) != expected:
                raise OpenPhotoCatalogError(f"Open catalog count {key} does not match its records.")
        for entity, actual in entity_counts.items():
            if entity in specs and counts.get(f"entity:{entity}") != actual:
                raise OpenPhotoCatalogError(f"Open catalog entity count is missing or invalid: {entity}.")
        return {"unknownEntities": sorted(unknown_entities)}

    def _allocate_asset_path(self, managed_root: Path, catalog_id: str, asset_id: str, filename: str) -> Path:
        safe_catalog = _clean_filename(catalog_id, "catalog")[:80]
        safe_asset = _clean_filename(asset_id, "asset")[:100]
        target = managed_root / "open-catalog" / safe_catalog / safe_asset / _clean_filename(filename, f"{safe_asset}.bin")
        target.parent.mkdir(parents=True, exist_ok=True)
        return target

    def _existing_catalog_asset(self, conn: sqlite3.Connection, catalog_id: str, external_id: str) -> str:
        row = conn.execute(
            """
            SELECT asset_id FROM photo_asset_external_ids
            WHERE provider = ? AND library_id = ? AND external_id = ?
            LIMIT 1
            """,
            (OPEN_CATALOG_PROVIDER, catalog_id, external_id),
        ).fetchone()
        return str(row["asset_id"] or "") if row is not None else ""

    def _record_catalog_asset_link(
        self,
        conn: sqlite3.Connection,
        *,
        catalog_id: str,
        external_id: str,
        asset_id: str,
        signature: str,
        source_id: str,
    ) -> None:
        timestamp = now_iso()
        conn.execute(
            """
            INSERT INTO photo_asset_external_ids(
                provider, library_id, external_id, source_id, asset_id,
                external_updated_at, state, sync_signature, metadata_json,
                first_seen_at, last_seen_at
            ) VALUES(?, ?, ?, ?, ?, '', 'active', ?, '{}', ?, ?)
            ON CONFLICT(provider, library_id, external_id) DO UPDATE SET
                source_id=excluded.source_id,
                asset_id=excluded.asset_id,
                state='active',
                sync_signature=excluded.sync_signature,
                last_seen_at=excluded.last_seen_at
            """,
            (OPEN_CATALOG_PROVIDER, catalog_id, external_id, source_id, asset_id, signature, timestamp, timestamp),
        )

    def _ensure_catalog_source(self, conn: sqlite3.Connection, *, catalog_id: str, catalog_path: Path) -> str:
        source_id = f"photo_source_{sha256(f'{OPEN_CATALOG_PROVIDER}:{catalog_id}'.encode('utf-8')).hexdigest()[:32]}"
        timestamp = now_iso()
        conn.execute(
            """
            INSERT INTO photo_external_sources(
                source_id, provider, library_id, root_path, display_name, platform, status,
                capabilities_json, consent_json, cursor_json, metadata_json,
                last_preview_at, last_sync_at, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, '', 'ready', ?, '{}', '{}', ?, ?, ?, ?, ?)
            ON CONFLICT(source_id) DO UPDATE SET
                root_path=excluded.root_path,
                display_name=excluded.display_name,
                status='ready',
                metadata_json=excluded.metadata_json,
                last_sync_at=excluded.last_sync_at,
                updated_at=excluded.updated_at
            """,
            (
                source_id,
                OPEN_CATALOG_PROVIDER,
                catalog_id,
                str(catalog_path),
                catalog_path.stem,
                json.dumps({"readOnlySource": True, "openFormatVersion": OPEN_CATALOG_VERSION}, separators=(",", ":"), sort_keys=True),
                json.dumps({"catalogId": catalog_id, "pathFreePackage": True}, separators=(",", ":"), sort_keys=True),
                timestamp,
                timestamp,
                timestamp,
                timestamp,
            ),
        )
        return source_id

    def _import_assets(
        self,
        conn: sqlite3.Connection,
        *,
        root: Path,
        manifest: dict[str, Any],
        managed_root: Path,
        source_id: str,
        merge_by_hash: bool,
        progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
        copied_paths: list[Path],
    ) -> tuple[dict[str, str], dict[str, str], dict[str, Path], dict[str, int]]:
        expected_total = self._rows_for_kind(manifest, "assets")
        catalog_id = str(manifest["catalogId"])
        existing_hash_rows = conn.execute(
            "SELECT asset_id, content_hash FROM photo_assets WHERE content_hash <> '' ORDER BY added_at ASC, asset_id ASC"
        ).fetchall()
        existing_by_hash: dict[str, list[str]] = {}
        for row in existing_hash_rows:
            existing_by_hash.setdefault(str(row["content_hash"] or "").lower(), []).append(str(row["asset_id"] or ""))
        consumed_existing: set[str] = set()
        id_map: dict[str, str] = {}
        local_paths: dict[str, str] = {}
        target_dirs: dict[str, Path] = {}
        counts = {"assets": 0, "created": 0, "merged": 0, "missing": 0, "mediaCopied": 0}
        for index, record in enumerate(self._catalog_records(root, manifest, "assets", cancel_check=cancel_check), start=1):
            self._raise_if_cancelled(cancel_check)
            external_id = str(record.get("id", "") or "").strip()
            if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,240}", external_id):
                raise OpenPhotoCatalogError("Open catalog asset id is invalid.")
            original = record.get("original") if isinstance(record.get("original"), dict) else {}
            digest = str(original.get("sha256", "") or "").lower()
            if digest and not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise OpenPhotoCatalogError(f"Open catalog asset hash is invalid: {external_id}.")
            local_id = self._existing_catalog_asset(conn, catalog_id, external_id)
            if local_id and conn.execute("SELECT 1 FROM photo_assets WHERE asset_id = ?", (local_id,)).fetchone() is None:
                local_id = ""
            if not local_id and merge_by_hash and digest:
                local_id = next((value for value in existing_by_hash.get(digest, []) if value not in consumed_existing), "")
            created_asset = not bool(local_id)
            if local_id:
                consumed_existing.add(local_id)
                row = conn.execute("SELECT source_path FROM photo_assets WHERE asset_id = ?", (local_id,)).fetchone()
                local_path = str(row["source_path"] or "") if row else ""
                counts["merged"] += 1
            else:
                requested_id = external_id
                collision = conn.execute("SELECT 1 FROM photo_assets WHERE asset_id = ? LIMIT 1", (requested_id,)).fetchone()
                local_id = requested_id if collision is None else f"photo_asset_{sha256(f'{catalog_id}:{external_id}'.encode('utf-8')).hexdigest()[:32]}"
                filename = _clean_filename(original.get("fileName", ""), f"{local_id}.bin")
                target = self._allocate_asset_path(managed_root, catalog_id, external_id, filename)
                archive_path = str(original.get("archivePath", "") or "")
                copied = False
                if archive_path:
                    source = _assert_regular_member(root, archive_path)
                    expected_size = _strict_nonnegative_int(original.get("bytes"), f"asset byte count for {external_id}")
                    target, already_present = _verified_copy_target(target, digest, cancel_check=cancel_check)
                    if not already_present:
                        _atomic_copy_verified(
                            source,
                            target,
                            expected_hash=digest,
                            expected_size=expected_size,
                            cancel_check=cancel_check,
                        )
                        copied_paths.append(target)
                        copied = True
                    local_path = str(target)
                    counts["mediaCopied"] += int(copied)
                    file_signature = path_signature(target)
                    missing_at: str | None = None
                else:
                    local_path = str(target)
                    file_signature = {}
                    missing_at = str(record.get("missingAt", "") or "") or now_iso()
                    counts["missing"] += 1
                timestamp = now_iso()
                conn.execute(
                    """
                    INSERT INTO photo_assets(
                        asset_id, source_path, source_kind, file_signature_json, content_hash,
                        perceptual_hash, media_kind, mime_type, width, height, duration_ms,
                        capture_date, added_at, updated_at, missing_at, source_scan_run, metadata_json
                    ) VALUES(?, ?, 'managed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '{}')
                    """,
                    (
                        local_id,
                        local_path,
                        json.dumps(file_signature, separators=(",", ":"), sort_keys=True),
                        digest,
                        str(record.get("perceptualHash", "") or ""),
                        str(record.get("mediaKind", "image") or "image"),
                        str(record.get("mimeType", "") or ""),
                        record.get("width"),
                        record.get("height"),
                        record.get("durationMs"),
                        str(record.get("captureDate", "") or ""),
                        str(record.get("addedAt", "") or "") or timestamp,
                        str(record.get("updatedAt", "") or "") or timestamp,
                        missing_at,
                    ),
                )
                counts["created"] += 1
            id_map[external_id] = local_id
            local_paths[external_id] = local_path
            target_dirs[external_id] = (
                Path(local_path).parent
                if created_asset
                else managed_root / "open-catalog" / _clean_filename(catalog_id, "catalog")[:80] / "merged-sidecars" / _clean_filename(external_id, "asset")[:100]
            )
            signature = sha256(_json_bytes(record)).hexdigest()
            self._record_catalog_asset_link(
                conn,
                catalog_id=catalog_id,
                external_id=external_id,
                asset_id=local_id,
                signature=signature,
                source_id=source_id,
            )
            counts["assets"] += 1
            if index == 1 or index % 100 == 0 or index == expected_total:
                self._emit(progress, {
                    "phase": "import-assets",
                    "processed": index,
                    "total": expected_total,
                    "message": f"Imported {index} of {expected_total or index} catalog assets.",
                })
        return id_map, local_paths, target_dirs, counts

    def _import_asset_metadata(
        self,
        conn: sqlite3.Connection,
        *,
        root: Path,
        manifest: dict[str, Any],
        asset_id_map: dict[str, str],
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
        progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> None:
        expected_total = self._rows_for_kind(manifest, "assets")
        for index, record in enumerate(self._catalog_records(root, manifest, "assets", cancel_check=cancel_check), start=1):
            self._raise_if_cancelled(cancel_check)
            external_id = str(record.get("id", "") or "")
            asset_id = asset_id_map.get(external_id, "")
            if not asset_id:
                raise OpenPhotoCatalogError("Open catalog metadata references an unknown asset.")
            metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
            restored = _restore_json_references(metadata, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
            conn.execute(
                "UPDATE photo_assets SET metadata_json = ?, updated_at = COALESCE(NULLIF(updated_at, ''), ?) WHERE asset_id = ?",
                (json.dumps(_json_safe(restored), separators=(",", ":"), sort_keys=True), now_iso(), asset_id),
            )
            if index == 1 or index % 250 == 0 or index == expected_total:
                self._emit(progress, {
                    "phase": "import-metadata",
                    "processed": index,
                    "total": expected_total,
                    "message": f"Restored metadata for {index} of {expected_total or index} catalog assets.",
                })

    def _import_sidecars(
        self,
        *,
        root: Path,
        manifest: dict[str, Any],
        asset_id_map: dict[str, str],
        target_dirs: dict[str, Path],
        progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
        copied_paths: list[Path],
    ) -> tuple[dict[str, str], dict[str, int]]:
        expected_total = self._rows_for_kind(manifest, "sidecars")
        sidecar_paths: dict[str, str] = {}
        copied = 0
        missing = 0
        record_count = 0
        for index, record in enumerate(self._catalog_records(root, manifest, "sidecars", cancel_check=cancel_check), start=1):
            record_count = index
            self._raise_if_cancelled(cancel_check)
            sidecar_id = str(record.get("id", "") or "")
            external_asset_id = str(record.get("assetId", "") or "")
            if not sidecar_id or external_asset_id not in asset_id_map:
                raise OpenPhotoCatalogError("Open catalog sidecar references an unknown asset.")
            archive_path = str(record.get("archivePath", "") or "")
            if not archive_path:
                sidecar_paths[sidecar_id] = ""
                missing += 1
                continue
            source = _assert_regular_member(root, archive_path)
            expected_hash = str(record.get("sha256", "") or "").lower()
            if not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
                raise OpenPhotoCatalogError(f"Open catalog sidecar checksum failed: {record.get('fileName', sidecar_id)}.")
            target_dir = target_dirs[external_asset_id]
            target = target_dir / _clean_filename(record.get("fileName", ""), f"{sidecar_id}.sidecar")
            target, already_present = _verified_copy_target(target, expected_hash, cancel_check=cancel_check)
            if not already_present:
                _atomic_copy_verified(
                    source,
                    target,
                    expected_hash=expected_hash,
                    expected_size=_strict_nonnegative_int(record.get("bytes"), f"sidecar byte count for {sidecar_id}"),
                    cancel_check=cancel_check,
                )
                copied_paths.append(target)
                copied += 1
            sidecar_paths[sidecar_id] = str(target)
            if index % 100 == 0 or index == expected_total:
                self._emit(progress, {
                    "phase": "import-sidecars",
                    "processed": index,
                    "total": expected_total,
                    "message": f"Imported {index} of {expected_total or index} sidecars and companions.",
                })
        return sidecar_paths, {"sidecars": record_count, "sidecarsCopied": copied, "sidecarsMissing": missing}

    def _upsert_portable_record(
        self,
        conn: sqlite3.Connection,
        *,
        spec: PortableTable,
        record: dict[str, Any],
        asset_id_map: dict[str, str],
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
        deferred_updates: list[tuple[str, tuple[str, ...], tuple[Any, ...], dict[str, Any]]],
        keyword_id_map: dict[str, str],
    ) -> bool:
        if not _table_exists(conn, spec.table):
            return False
        columns_info = _table_columns(conn, spec.table)
        target_columns = {str(column["name"]): column for column in columns_info}
        primary = _primary_columns(conn, spec.table)
        if not primary:
            return False
        clean: dict[str, Any] = {}
        deferred: dict[str, Any] = {}
        for column, raw in record.items():
            if column not in target_columns:
                continue
            value = _restore_json_references(raw, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
            if column in spec.asset_columns and str(value or ""):
                value = asset_id_map.get(str(value), str(value))
            if column == "keyword_id" and str(value or "") in keyword_id_map:
                value = keyword_id_map[str(value)]
            if column in spec.deferred_columns:
                deferred[column] = value
                value = None if not bool(target_columns[column].get("notnull")) else ""
            if column.endswith("_json"):
                value = json.dumps(_json_safe(value), separators=(",", ":"), sort_keys=True, allow_nan=False)
            if column in PATH_COLUMNS_TO_CLEAR and not str(value or ""):
                value = ""
            clean[column] = value
        if any(column not in clean for column in primary):
            return False
        if spec.table == "photo_keywords":
            old_id = str(clean.get("keyword_id", "") or "")
            name = str(clean.get("name", "") or "")
            existing = conn.execute("SELECT keyword_id FROM photo_keywords WHERE LOWER(name) = LOWER(?) LIMIT 1", (name,)).fetchone()
            if existing is not None and str(existing["keyword_id"] or "") != old_id:
                keyword_id_map[old_id] = str(existing["keyword_id"] or "")
                return True
        if spec.table == "photo_tether_sessions":
            clean["status"] = "stopped"
            clean["source_path"] = ""
            clean["destination_path"] = ""
            clean["managed_root"] = ""
            settings = _json_object(clean.get("settings_json", "{}"))
            settings["autoResume"] = False
            clean["settings_json"] = json.dumps(settings, separators=(",", ":"), sort_keys=True)
        elif spec.table == "photo_external_sources" and str(clean.get("provider", "")) == OPEN_CATALOG_PROVIDER:
            # The current import's source row is authoritative for this provider.
            return True
        columns = list(clean)
        placeholders = ",".join("?" for _ in columns)
        conn.execute(
            f'INSERT OR IGNORE INTO "{spec.table}" ({",".join(f"\"{column}\"" for column in columns)}) VALUES({placeholders})',
            tuple(clean[column] for column in columns),
        )
        update_columns = [column for column in columns if column not in primary]
        if update_columns:
            where = " AND ".join(f'"{column}" = ?' for column in primary)
            conn.execute(
                f'UPDATE "{spec.table}" SET {",".join(f"\"{column}\" = ?" for column in update_columns)} WHERE {where}',
                tuple(clean[column] for column in update_columns) + tuple(clean[column] for column in primary),
            )
        if deferred:
            deferred_updates.append((spec.table, tuple(primary), tuple(clean[column] for column in primary), deferred))
        return True

    def _import_entities(
        self,
        conn: sqlite3.Connection,
        *,
        root: Path,
        manifest: dict[str, Any],
        asset_id_map: dict[str, str],
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
        progress: ProgressCallback | None,
        cancel_check: CancelCheck | None,
    ) -> tuple[dict[str, int], list[str]]:
        expected_total = self._rows_for_kind(manifest, "entities")
        specs = {spec.table: spec for spec in PORTABLE_TABLES}
        deferred_updates: list[tuple[str, tuple[str, ...], tuple[Any, ...], dict[str, Any]]] = []
        keyword_id_map: dict[str, str] = {}
        counts: dict[str, int] = {}
        warnings: list[str] = []
        for index, wrapper in enumerate(self._catalog_records(root, manifest, "entities", cancel_check=cancel_check), start=1):
            self._raise_if_cancelled(cancel_check)
            entity = str(wrapper.get("entity", "") or "")
            record = wrapper.get("record")
            if entity not in specs:
                if entity and entity not in warnings:
                    warnings.append(entity)
                continue
            if not isinstance(record, dict):
                raise OpenPhotoCatalogError(f"Open catalog {entity} record is invalid.")
            if self._upsert_portable_record(
                conn,
                spec=specs[entity],
                record=record,
                asset_id_map=asset_id_map,
                asset_paths=asset_paths,
                sidecar_paths=sidecar_paths,
                deferred_updates=deferred_updates,
                keyword_id_map=keyword_id_map,
            ):
                counts[entity] = counts.get(entity, 0) + 1
            if index == 1 or index % 250 == 0 or index == expected_total:
                self._emit(progress, {
                    "phase": "import-entities",
                    "processed": index,
                    "total": expected_total,
                    "message": f"Restored {index} of {expected_total or index} catalog records.",
                })
        for table, primary, primary_values, values in deferred_updates:
            columns = _table_columns(conn, table)
            target_columns = {str(column["name"]): column for column in columns}
            clean_values: dict[str, Any] = {}
            for column, value in values.items():
                if column not in target_columns:
                    continue
                restored = _restore_json_references(value, asset_paths=asset_paths, sidecar_paths=sidecar_paths)
                clean_values[column] = restored
            if not clean_values:
                continue
            where = " AND ".join(f'"{column}" = ?' for column in primary)
            try:
                conn.execute(
                    f'UPDATE "{table}" SET {",".join(f"\"{column}\" = ?" for column in clean_values)} WHERE {where}',
                    tuple(clean_values.values()) + primary_values,
                )
            except sqlite3.IntegrityError as exc:
                raise OpenPhotoCatalogError(f"Open catalog relationship could not be restored in {table}.") from exc
        return counts, warnings

    def _import_preferences(
        self,
        conn: sqlite3.Connection,
        *,
        root: Path,
        manifest: dict[str, Any],
        asset_paths: dict[str, str],
        sidecar_paths: dict[str, str],
        cancel_check: CancelCheck | None,
    ) -> int:
        body = self._read_preferences_member(root, manifest, cancel_check=cancel_check)
        count = 0
        for key in PORTABLE_META_KEYS:
            if key not in body:
                continue
            value = _restore_json_references(body[key], asset_paths=asset_paths, sidecar_paths=sidecar_paths)
            conn.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(_json_safe(value), separators=(",", ":"), sort_keys=True, allow_nan=False)),
            )
            count += 1
        return count

    def import_catalog(
        self,
        catalog_path: str | Path,
        *,
        managed_root: str | Path = "",
        merge_by_hash: bool = True,
        progress: ProgressCallback | None = None,
        cancel_check: CancelCheck | None = None,
    ) -> dict[str, Any]:
        root, manifest = self._load_manifest(catalog_path)
        self._inspect_loaded_catalog(
            root,
            manifest,
            verify_media=True,
            progress=progress,
            cancel_check=cancel_check,
        )
        destination = Path(managed_root).expanduser().resolve() if str(managed_root or "").strip() else self.workspace_root / "photo-library"
        destination.mkdir(parents=True, exist_ok=True)
        if not destination.is_dir():
            raise OpenPhotoCatalogError("Open catalog managed destination must be a folder.")
        copied_paths: list[Path] = []
        catalog_id = str(manifest["catalogId"])
        self._emit(progress, {"phase": "starting-import", "processed": 0, "message": "Preparing open catalog import."})
        try:
            with self.db.connect() as conn:
                previous_sync = conn.execute("SELECT value FROM meta WHERE key = 'photoSyncApplying' LIMIT 1").fetchone()
                previous_sync_value = str(previous_sync["value"] or "") if previous_sync is not None else ""
                conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('photoSyncApplying', '1')")
                source_id = self._ensure_catalog_source(conn, catalog_id=catalog_id, catalog_path=root)
                (
                    asset_id_map,
                    asset_paths,
                    target_dirs,
                    counts,
                ) = self._import_assets(
                    conn,
                    root=root,
                    manifest=manifest,
                    managed_root=destination,
                    source_id=source_id,
                    merge_by_hash=bool(merge_by_hash),
                    progress=progress,
                    cancel_check=cancel_check,
                    copied_paths=copied_paths,
                )
                sidecar_paths, sidecar_counts = self._import_sidecars(
                    root=root,
                    manifest=manifest,
                    asset_id_map=asset_id_map,
                    target_dirs=target_dirs,
                    progress=progress,
                    cancel_check=cancel_check,
                    copied_paths=copied_paths,
                )
                self._import_asset_metadata(
                    conn,
                    root=root,
                    manifest=manifest,
                    asset_id_map=asset_id_map,
                    asset_paths=asset_paths,
                    sidecar_paths=sidecar_paths,
                    progress=progress,
                    cancel_check=cancel_check,
                )
                entity_counts, unknown_entities = self._import_entities(
                    conn,
                    root=root,
                    manifest=manifest,
                    asset_id_map=asset_id_map,
                    asset_paths=asset_paths,
                    sidecar_paths=sidecar_paths,
                    progress=progress,
                    cancel_check=cancel_check,
                )
                preference_count = self._import_preferences(
                    conn,
                    root=root,
                    manifest=manifest,
                    asset_paths=asset_paths,
                    sidecar_paths=sidecar_paths,
                    cancel_check=cancel_check,
                )
                self._raise_if_cancelled(cancel_check)
                for asset_id in sorted(set(asset_id_map.values())):
                    self.db._index_photo_asset(asset_id, conn)  # noqa: SLF001
                if hasattr(self.db, "_mark_photo_duplicate_groups_stale"):
                    self.db._mark_photo_duplicate_groups_stale(conn, reason="open_catalog_import")  # noqa: SLF001
                if previous_sync is None:
                    conn.execute("DELETE FROM meta WHERE key = 'photoSyncApplying'")
                else:
                    conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES('photoSyncApplying', ?)", (previous_sync_value,))
                counts.update(sidecar_counts)
                counts["entityRows"] = sum(entity_counts.values())
                counts["preferenceGroups"] = preference_count
            self._emit(progress, {
                "phase": "completed",
                "processed": counts["assets"],
                "total": counts["assets"],
                "message": "Open catalog import completed.",
            })
            return {
                "format": OPEN_CATALOG_FORMAT,
                "formatVersion": OPEN_CATALOG_VERSION,
                "catalogId": catalog_id,
                "catalogPath": str(root),
                "managedRoot": str(destination),
                "counts": counts,
                "entityCounts": entity_counts,
                "unknownEntities": unknown_entities,
                "mergeByHash": bool(merge_by_hash),
                "verified": True,
                "pathFreeSource": True,
            }
        except Exception:
            for path in reversed(copied_paths):
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
            raise


__all__ = [
    "OPEN_CATALOG_EXTENSION",
    "OPEN_CATALOG_FORMAT",
    "OPEN_CATALOG_PROVIDER",
    "OPEN_CATALOG_VERSION",
    "OpenPhotoCatalogCancelled",
    "OpenPhotoCatalogError",
    "OpenPhotoCatalogService",
    "PORTABLE_META_KEYS",
    "PORTABLE_TABLES",
]

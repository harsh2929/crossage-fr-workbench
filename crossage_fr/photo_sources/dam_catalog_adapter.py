from __future__ import annotations

from contextlib import AbstractContextManager, closing
from datetime import datetime
from hashlib import sha256
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
from time import monotonic
from typing import Any, Iterator
from urllib.parse import quote

from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, RAW_IMAGE_EXTENSIONS
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS

from .contracts import (
    NormalizedAlbum,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourcePreview,
    PhotoSourceScopes,
    clean_strings,
)


LIGHTROOM_CATALOG_PROVIDER = "lightroom_catalog"
CAPTURE_ONE_CATALOG_PROVIDER = "capture_one_catalog"
DAM_CATALOG_PROVIDERS = {LIGHTROOM_CATALOG_PROVIDER, CAPTURE_ONE_CATALOG_PROVIDER}

DAM_CATALOG_CAPABILITIES = {
    "discovery": True,
    "preview": True,
    "referencedImport": True,
    "managedImport": True,
    "incrementalSync": True,
    "exportOriginal": False,
    "exportEdited": False,
    "rawCompanions": True,
    "livePhotoMotion": False,
    "albumsFolders": True,
    "keywords": True,
    "places": False,
    "labels": True,
    "detectedText": False,
    "peopleFaces": False,
    "commentsLikes": False,
    "ratings": True,
    "colorLabels": True,
    "pickReject": True,
    "readOnly": True,
    "networkRequired": False,
}

CAPTURE_ONE_COLOR_LABELS = {
    0: "",
    1: "red",
    2: "orange",
    3: "yellow",
    4: "green",
    5: "blue",
    6: "pink",
    7: "purple",
}

KNOWN_COLOR_LABELS = {"", "red", "orange", "yellow", "green", "blue", "purple", "pink", "gray"}


def _quoted(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _catalog_id(provider: str, path: Path) -> str:
    token = f"{provider}\n{os.path.normcase(os.path.realpath(path))}"
    return f"{provider}_{sha256(token.encode('utf-8')).hexdigest()[:32]}"


def _clean_text(value: Any, limit: int = 1000) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\0", " ")).strip()[:limit]


def _clean_rating(value: Any) -> int:
    try:
        return max(0, min(5, int(round(float(value or 0)))))
    except (TypeError, ValueError):
        return 0


def _clean_color_label(value: Any, *, capture_one: bool = False) -> str:
    if capture_one:
        try:
            return CAPTURE_ONE_COLOR_LABELS.get(int(value or 0), "")
        except (TypeError, ValueError):
            pass
    label = _clean_text(value, 40).casefold().replace("grey", "gray")
    if label in KNOWN_COLOR_LABELS:
        return label
    aliases = {
        "label1": "red",
        "label2": "yellow",
        "label3": "green",
        "label4": "blue",
        "label5": "purple",
    }
    return aliases.get(label.replace(" ", ""), "")


def _clean_pick_status(value: Any) -> str:
    text = _clean_text(value, 40).casefold()
    if text in {"pick", "picked", "selected", "true"}:
        return "pick"
    if text in {"reject", "rejected", "false"}:
        return "reject"
    try:
        numeric = int(float(value or 0))
    except (TypeError, ValueError):
        return ""
    return "pick" if numeric > 0 else "reject" if numeric < 0 else ""


def _media_kind(path: Path, file_format: str = "") -> str:
    suffix = path.suffix.lower()
    format_text = str(file_format or "").casefold()
    if suffix in VIDEO_EXTENSIONS or "video" in format_text or "movie" in format_text:
        return "video"
    if suffix in RAW_IMAGE_EXTENSIONS or "raw" in format_text:
        return "raw"
    return "image"


def _resolve_catalog_file(path_value: str, provider: str) -> Path:
    path = Path(str(path_value or "")).expanduser().resolve()
    if path.is_file():
        return path
    if not path.is_dir():
        raise ValueError("DAM catalog was not found.")
    patterns = ("*.lrcat",) if provider == LIGHTROOM_CATALOG_PROVIDER else ("*.cocatalogdb", "*.db")
    candidates: list[Path] = []
    for pattern in patterns:
        candidates.extend(path.glob(pattern))
        candidates.extend(path.glob(f"*/{pattern}"))
    candidates = sorted({candidate.resolve() for candidate in candidates if candidate.is_file()}, key=lambda item: (len(item.parts), item.name.casefold()))
    if not candidates:
        raise ValueError("No supported DAM catalog database was found in this folder.")
    return candidates[0]


def _open_read_only(path: Path) -> sqlite3.Connection:
    uri = f"file:{quote(str(path), safe='/')}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True, timeout=2.0)
    except sqlite3.Error as exc:
        raise ValueError("DAM catalog is not a readable SQLite database.") from exc
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA query_only = ON")
        conn.execute("PRAGMA trusted_schema = OFF")
        conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
    except sqlite3.Error as exc:
        conn.close()
        raise ValueError("DAM catalog schema could not be read safely.") from exc
    return conn


def _tables(conn: sqlite3.Connection) -> dict[str, str]:
    return {
        str(row["name"]).casefold(): str(row["name"])
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    }


def _table(tables: dict[str, str], *candidates: str) -> str:
    return next((tables[value.casefold()] for value in candidates if value.casefold() in tables), "")


def _columns(conn: sqlite3.Connection, table: str) -> dict[str, str]:
    if not table:
        return {}
    return {
        str(row["name"]).casefold(): str(row["name"])
        for row in conn.execute(f"PRAGMA table_info({_quoted(table)})").fetchall()
    }


def _column(columns: dict[str, str], *candidates: str) -> str:
    return next((columns[value.casefold()] for value in candidates if value.casefold() in columns), "")


def _expr(alias: str, column: str, name: str) -> str:
    return f"{alias}.{_quoted(column)} AS {_quoted(name)}" if column else f"NULL AS {_quoted(name)}"


def _safe_parent_chain(records: dict[str, dict[str, Any]], identifier: str, *, max_depth: int = 32) -> list[dict[str, str]]:
    output: list[dict[str, str]] = []
    seen: set[str] = set()
    current = str(identifier or "")
    while current and current not in seen and len(output) < max_depth:
        seen.add(current)
        record = records.get(current)
        if not record:
            break
        name = _clean_text(record.get("name"), 160)
        if name:
            output.append({"id": current, "name": name})
        current = str(record.get("parent", "") or "")
    output.reverse()
    return output


class DamCatalogLibrary(AbstractContextManager["DamCatalogLibrary"]):
    def __init__(self, adapter: "DamCatalogAdapter", path: str):
        self.adapter = adapter
        self.catalog_path = _resolve_catalog_file(path, adapter.provider)
        self.conn = _open_read_only(self.catalog_path)
        self.library = adapter._describe(self.catalog_path, conn=self.conn)

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.conn.close()
        return None

    def iter_assets(
        self,
        scopes: PhotoSourceScopes,
        *,
        after_external_id: str = "",
        limit: int | None = None,
    ) -> Iterator[NormalizedPhotoAsset]:
        emitted = 0
        resume_reached = not bool(after_external_id)
        for asset in self.adapter._iter_assets(self.conn, self.library, scopes):
            if not resume_reached:
                if asset.external_id == after_external_id:
                    resume_reached = True
                continue
            yield asset
            emitted += 1
            if limit is not None and emitted >= max(0, int(limit)):
                break


class DamCatalogAdapter:
    """Read-only, schema-detected Lightroom Classic or Capture One migration."""

    def __init__(self, provider: str, *, home: Path | None = None):
        if provider not in DAM_CATALOG_PROVIDERS:
            raise ValueError("Unknown DAM catalog provider.")
        self.provider = provider
        self.home = (home or Path.home()).expanduser()
        self._media_root = ""
        self._root_mappings: dict[str, str] = {}

    @property
    def label(self) -> str:
        return "Lightroom Classic" if self.provider == LIGHTROOM_CATALOG_PROVIDER else "Capture One"

    def configure_import(self, params: dict[str, Any] | None) -> None:
        body = params if isinstance(params, dict) else {}
        self._media_root = str(body.get("mediaRoot", body.get("sourceRoot", "")) or "").strip()
        raw_mappings = body.get("rootMappings", body.get("pathMappings", {}))
        mappings: dict[str, str] = {}
        if isinstance(raw_mappings, dict):
            for source, target in raw_mappings.items():
                if str(source or "").strip() and str(target or "").strip():
                    mappings[os.path.normcase(os.path.realpath(os.path.expanduser(str(source))))] = str(Path(str(target)).expanduser().resolve())
        elif isinstance(raw_mappings, list):
            for item in raw_mappings:
                if not isinstance(item, dict):
                    continue
                source = str(item.get("sourceRoot", item.get("source", item.get("from", ""))) or "")
                target = str(item.get("targetRoot", item.get("target", item.get("to", ""))) or "")
                if source and target:
                    mappings[os.path.normcase(os.path.realpath(os.path.expanduser(source)))] = str(Path(target).expanduser().resolve())
        self._root_mappings = mappings

    def status(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "supported": True,
            "available": True,
            "readOnly": True,
            "networkAccess": "none",
            "capabilities": dict(DAM_CATALOG_CAPABILITIES),
            "error": "",
            "warnings": [],
        }

    def discover_libraries(self) -> list[PhotoSourceLibrary]:
        roots = [
            self.home / "Pictures" / "Lightroom",
            self.home / "Pictures" / "Capture One Catalog",
            self.home / "Pictures" / "Capture One",
        ]
        suffix = ".lrcat" if self.provider == LIGHTROOM_CATALOG_PROVIDER else ".cocatalogdb"
        output: list[PhotoSourceLibrary] = []
        seen: set[str] = set()
        for root in roots:
            if not root.is_dir():
                continue
            for candidate in sorted([*root.glob(f"*{suffix}"), *root.glob(f"*/*{suffix}")])[:40]:
                try:
                    resolved = candidate.resolve()
                except OSError:
                    continue
                key = os.path.normcase(str(resolved))
                if key in seen or not resolved.is_file():
                    continue
                seen.add(key)
                try:
                    output.append(self._describe(resolved))
                except ValueError:
                    continue
        return output

    def _profile(self, conn: sqlite3.Connection) -> dict[str, Any]:
        tables = _tables(conn)
        if self.provider == LIGHTROOM_CATALOG_PROVIDER:
            images = _table(tables, "Adobe_images")
            files = _table(tables, "AgLibraryFile")
            image_columns = _columns(conn, images)
            file_columns = _columns(conn, files)
            if not images or not files or not _column(image_columns, "id_local") or not _column(image_columns, "rootFile"):
                raise ValueError("Unsupported Lightroom catalog schema: image/file linkage was not found.")
            if not _column(file_columns, "id_local") or not _column(file_columns, "baseName", "idx_filename", "filename"):
                raise ValueError("Unsupported Lightroom catalog schema: file names were not found.")
            return {"name": "lightroom-classic", "tables": tables, "images": images, "files": files}
        images = _table(tables, "ZIMAGE", "ZASSET", "images", "photos")
        image_columns = _columns(conn, images)
        if not images or not _column(image_columns, "Z_PK", "id", "id_local", "uuid"):
            raise ValueError("Unsupported Capture One catalog schema: image records were not found.")
        direct_path = _column(image_columns, "ZPATH", "ZFILEPATH", "ZORIGINALPATH", "path", "filepath")
        filename = _column(image_columns, "ZFILENAME", "ZNAME", "filename", "name")
        if not direct_path and not filename:
            raise ValueError("Unsupported Capture One catalog schema: source paths were not found.")
        return {"name": "capture-one", "tables": tables, "images": images}

    def _describe(self, path: Path, *, conn: sqlite3.Connection | None = None) -> PhotoSourceLibrary:
        owns_conn = conn is None
        opened = conn or _open_read_only(path)
        try:
            profile = self._profile(opened)
            user_version = int(opened.execute("PRAGMA user_version").fetchone()[0])
        finally:
            if owns_conn:
                opened.close()
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat()
        except OSError:
            modified_at = ""
        return PhotoSourceLibrary(
            provider=self.provider,
            library_id=_catalog_id(self.provider, path),
            path=str(path),
            name=path.stem or self.label,
            available=True,
            modified_at=modified_at,
            database_version=str(user_version),
            status="ready",
            metadata={
                "damCatalog": True,
                "catalogKind": self.label,
                "schemaProfile": profile["name"],
                "readOnly": True,
            },
        )

    def describe_library(self, path: str) -> PhotoSourceLibrary:
        catalog = _resolve_catalog_file(path, self.provider)
        return self._describe(catalog)

    def open_library(self, path: str) -> DamCatalogLibrary:
        return DamCatalogLibrary(self, path)

    def _mapped_root(self, root: str) -> Path:
        source_key = os.path.normcase(os.path.realpath(os.path.expanduser(str(root or "")))) if root else ""
        if source_key and source_key in self._root_mappings:
            return Path(self._root_mappings[source_key])
        if self._media_root:
            return Path(self._media_root).expanduser().resolve()
        return Path(str(root or "")).expanduser()

    def _resolve_media_path(self, root: str, relative_folder: str, filename: str, direct_path: str = "") -> Path:
        if direct_path:
            direct = Path(direct_path).expanduser()
            source_key = os.path.normcase(os.path.realpath(os.path.expanduser(str(root or direct.parent))))
            mapped = self._root_mappings.get(source_key)
            if mapped:
                try:
                    relative = direct.relative_to(Path(root).expanduser())
                except (OSError, ValueError):
                    relative = Path(relative_folder) / filename
                return Path(mapped) / relative
            if direct.is_file() or not self._media_root:
                return direct
        base = self._mapped_root(root)
        relative = Path(str(relative_folder or "").replace("\\", "/"))
        if relative.is_absolute() or ".." in relative.parts:
            relative = Path()
        return base / relative / filename

    def _association_map(
        self,
        conn: sqlite3.Connection,
        *,
        table_candidates: tuple[str, ...],
        image_candidates: tuple[str, ...],
        value_candidates: tuple[str, ...],
        position_candidates: tuple[str, ...] = (),
    ) -> dict[str, list[tuple[str, int]]]:
        tables = _tables(conn)
        table = _table(tables, *table_candidates)
        columns = _columns(conn, table)
        image_col = _column(columns, *image_candidates)
        value_col = _column(columns, *value_candidates)
        position_col = _column(columns, *position_candidates) if position_candidates else ""
        if not table or not image_col or not value_col:
            return {}
        query = f"SELECT {_quoted(image_col)} AS image_id, {_quoted(value_col)} AS value_id, " + (
            f"{_quoted(position_col)} AS position" if position_col else "0 AS position"
        ) + f" FROM {_quoted(table)} ORDER BY image_id ASC, position ASC, value_id ASC"
        output: dict[str, list[tuple[str, int]]] = {}
        try:
            rows = conn.execute(query).fetchall()
        except sqlite3.Error:
            return {}
        for row in rows:
            image_id = str(row["image_id"] or "")
            value_id = str(row["value_id"] or "")
            if image_id and value_id:
                output.setdefault(image_id, []).append((value_id, int(row["position"] or 0)))
        return output

    def _named_records(
        self,
        conn: sqlite3.Connection,
        *,
        table_candidates: tuple[str, ...],
        id_candidates: tuple[str, ...],
        name_candidates: tuple[str, ...],
        parent_candidates: tuple[str, ...] = (),
    ) -> dict[str, dict[str, Any]]:
        tables = _tables(conn)
        table = _table(tables, *table_candidates)
        columns = _columns(conn, table)
        id_col = _column(columns, *id_candidates)
        name_col = _column(columns, *name_candidates)
        parent_col = _column(columns, *parent_candidates) if parent_candidates else ""
        if not table or not id_col or not name_col:
            return {}
        query = f"SELECT {_quoted(id_col)} AS record_id, {_quoted(name_col)} AS name, " + (
            f"{_quoted(parent_col)} AS parent" if parent_col else "NULL AS parent"
        ) + f" FROM {_quoted(table)} ORDER BY record_id ASC"
        output: dict[str, dict[str, Any]] = {}
        try:
            rows = conn.execute(query).fetchall()
        except sqlite3.Error:
            return {}
        for row in rows:
            identifier = str(row["record_id"] or "")
            if identifier:
                output[identifier] = {
                    "name": _clean_text(row["name"], 160),
                    "parent": str(row["parent"] or ""),
                }
        return output

    def _lightroom_context(self, conn: sqlite3.Connection) -> tuple[dict[str, list[str]], dict[str, list[NormalizedAlbum]]]:
        keywords = self._named_records(
            conn,
            table_candidates=("AgLibraryKeyword",),
            id_candidates=("id_local",),
            name_candidates=("name", "lc_name"),
            parent_candidates=("parent",),
        )
        keyword_links = self._association_map(
            conn,
            table_candidates=("AgLibraryKeywordImage",),
            image_candidates=("image", "rootFile"),
            value_candidates=("tag", "keyword"),
        )
        keywords_by_image: dict[str, list[str]] = {}
        for image_id, links in keyword_links.items():
            names: list[str] = []
            for keyword_id, _ in links:
                chain = _safe_parent_chain(keywords, keyword_id)
                if chain:
                    names.append("/".join(item["name"] for item in chain))
            keywords_by_image[image_id] = clean_strings(names, limit=500, max_length=500)

        collections = self._named_records(
            conn,
            table_candidates=("AgLibraryCollection",),
            id_candidates=("id_local",),
            name_candidates=("name",),
            parent_candidates=("parent",),
        )
        collection_links = self._association_map(
            conn,
            table_candidates=("AgLibraryCollectionContent",),
            image_candidates=("image", "rootFile"),
            value_candidates=("collection", "owningEntity"),
            position_candidates=("position", "sortOrder"),
        )
        albums_by_image: dict[str, list[NormalizedAlbum]] = {}
        for image_id, links in collection_links.items():
            albums: list[NormalizedAlbum] = []
            for collection_id, position in links:
                chain = _safe_parent_chain(collections, collection_id)
                if not chain:
                    continue
                album_record = chain[-1]
                albums.append(NormalizedAlbum(
                    album_id=f"lightroom_collection_{collection_id}",
                    name=album_record["name"],
                    folder_path=chain[:-1],
                    position=position,
                    metadata={"source": "lightroom-collection", "externalCollectionId": collection_id},
                ))
            albums_by_image[image_id] = albums
        return keywords_by_image, albums_by_image

    def _iter_lightroom_assets(
        self,
        conn: sqlite3.Connection,
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
    ) -> Iterator[NormalizedPhotoAsset]:
        profile = self._profile(conn)
        tables = profile["tables"]
        images = profile["images"]
        files = profile["files"]
        folders = _table(tables, "AgLibraryFolder")
        roots = _table(tables, "AgLibraryRootFolder")
        ic = _columns(conn, images)
        fc = _columns(conn, files)
        dc = _columns(conn, folders)
        rc = _columns(conn, roots)
        image_id = _column(ic, "id_local")
        root_file = _column(ic, "rootFile")
        file_id = _column(fc, "id_local")
        file_folder = _column(fc, "folder")
        folder_id = _column(dc, "id_local")
        folder_root = _column(dc, "rootFolder")
        root_id = _column(rc, "id_local")
        joins = [f"JOIN {_quoted(files)} f ON i.{_quoted(root_file)} = f.{_quoted(file_id)}"]
        if folders and file_folder and folder_id:
            joins.append(f"LEFT JOIN {_quoted(folders)} d ON f.{_quoted(file_folder)} = d.{_quoted(folder_id)}")
        if roots and folder_root and root_id:
            joins.append(f"LEFT JOIN {_quoted(roots)} r ON d.{_quoted(folder_root)} = r.{_quoted(root_id)}")
        selections = [
            _expr("i", image_id, "image_id"),
            _expr("f", _column(fc, "baseName", "idx_filename", "filename"), "base_name"),
            _expr("f", _column(fc, "extension", "ext"), "extension"),
            _expr("f", _column(fc, "absolutePath", "path"), "direct_path"),
            _expr("d", _column(dc, "pathFromRoot", "relativePath"), "relative_folder"),
            _expr("r", _column(rc, "absolutePath", "path"), "root_path"),
            _expr("i", _column(ic, "rating"), "rating"),
            _expr("i", _column(ic, "pick"), "pick"),
            _expr("i", _column(ic, "colorLabels", "colorLabel"), "color_label"),
            _expr("i", _column(ic, "captureTime", "dateCaptured", "captureDate"), "capture_date"),
            _expr("i", _column(ic, "touchTime", "lastEditTime", "modifiedTime"), "modified_date"),
            _expr("i", _column(ic, "title"), "title"),
            _expr("i", _column(ic, "caption", "description"), "caption"),
            _expr("i", _column(ic, "fileFormat"), "file_format"),
            _expr("i", _column(ic, "width"), "width"),
            _expr("i", _column(ic, "height"), "height"),
        ]
        query = f"SELECT {', '.join(selections)} FROM {_quoted(images)} i {' '.join(joins)} ORDER BY i.{_quoted(image_id)} ASC"
        keywords_by_image, albums_by_image = self._lightroom_context(conn) if scopes.albums_folders or scopes.keywords else ({}, {})
        for row in conn.execute(query):
            identifier = str(row["image_id"] or "")
            base_name = _clean_text(row["base_name"], 220) or f"image-{identifier}"
            extension = _clean_text(row["extension"], 20)
            if extension and not extension.startswith(".") and not base_name.casefold().endswith(f".{extension.casefold()}"):
                filename = f"{base_name}.{extension}"
            else:
                filename = base_name
            path = self._resolve_media_path(
                str(row["root_path"] or ""),
                str(row["relative_folder"] or ""),
                filename,
                str(row["direct_path"] or ""),
            )
            rating = _clean_rating(row["rating"])
            color_label = _clean_color_label(row["color_label"])
            pick_status = _clean_pick_status(row["pick"])
            kind = _media_kind(path, str(row["file_format"] or ""))
            yield NormalizedPhotoAsset(
                provider=self.provider,
                library_id=library.library_id,
                external_id=f"lightroom_image_{identifier}",
                filename=filename,
                original_filename=filename,
                original_path=str(path) if scopes.originals else "",
                media_kind=kind,
                mime_type=mimetypes.guess_type(str(path))[0] or "",
                width=int(row["width"]) if row["width"] is not None else None,
                height=int(row["height"]) if row["height"] is not None else None,
                capture_date=str(row["capture_date"] or ""),
                modified_date=str(row["modified_date"] or ""),
                title=_clean_text(row["title"], 300),
                caption=_clean_text(row["caption"], 4000),
                favorite=rating >= 4 if scopes.favorites else False,
                missing=not path.is_file(),
                keywords=keywords_by_image.get(identifier, []) if scopes.keywords else [],
                labels=[color_label] if scopes.labels_ocr and color_label else [],
                albums=albums_by_image.get(identifier, []) if scopes.albums_folders else [],
                flags={
                    "catalogRating": rating,
                    "catalogColorLabel": color_label,
                    "catalogPickStatus": pick_status,
                    "raw": kind == "raw",
                },
                provenance={
                    "catalogKind": self.label,
                    "catalogPath": library.path,
                    "externalImageId": identifier,
                    "rootPath": str(row["root_path"] or ""),
                    "relativeFolder": str(row["relative_folder"] or ""),
                },
                metadata={
                    "dam": {
                        "provider": self.provider,
                        "schemaProfile": "lightroom-classic",
                        "rating": rating,
                        "colorLabel": color_label,
                        "pickStatus": pick_status,
                    }
                },
                unsupported_fields=["develop-rendering", "face-regions", "publish-services"],
            )

    def _capture_one_context(self, conn: sqlite3.Connection) -> tuple[dict[str, list[str]], dict[str, list[NormalizedAlbum]]]:
        keywords = self._named_records(
            conn,
            table_candidates=("ZKEYWORD", "keywords"),
            id_candidates=("Z_PK", "id"),
            name_candidates=("ZNAME", "name"),
            parent_candidates=("ZPARENT", "parent"),
        )
        keyword_links = self._association_map(
            conn,
            table_candidates=("ZIMAGEKEYWORD", "ZKEYWORDIMAGE", "image_keywords"),
            image_candidates=("ZIMAGE", "image_id", "image"),
            value_candidates=("ZKEYWORD", "keyword_id", "keyword"),
        )
        keywords_by_image = {
            image_id: clean_strings(
                ["/".join(item["name"] for item in _safe_parent_chain(keywords, keyword_id)) for keyword_id, _ in links],
                limit=500,
                max_length=500,
            )
            for image_id, links in keyword_links.items()
        }
        collections = self._named_records(
            conn,
            table_candidates=("ZCOLLECTION", "collections"),
            id_candidates=("Z_PK", "id"),
            name_candidates=("ZNAME", "name"),
            parent_candidates=("ZPARENT", "parent"),
        )
        collection_links = self._association_map(
            conn,
            table_candidates=("ZCOLLECTIONIMAGE", "ZCOLLECTIONITEM", "collection_images"),
            image_candidates=("ZIMAGE", "image_id", "image"),
            value_candidates=("ZCOLLECTION", "collection_id", "collection"),
            position_candidates=("ZPOSITION", "position", "sort_order"),
        )
        albums_by_image: dict[str, list[NormalizedAlbum]] = {}
        for image_id, links in collection_links.items():
            albums: list[NormalizedAlbum] = []
            for collection_id, position in links:
                chain = _safe_parent_chain(collections, collection_id)
                if not chain:
                    continue
                albums.append(NormalizedAlbum(
                    album_id=f"capture_one_collection_{collection_id}",
                    name=chain[-1]["name"],
                    folder_path=chain[:-1],
                    position=position,
                    metadata={"source": "capture-one-collection", "externalCollectionId": collection_id},
                ))
            albums_by_image[image_id] = albums
        return keywords_by_image, albums_by_image

    def _iter_capture_one_assets(
        self,
        conn: sqlite3.Connection,
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
    ) -> Iterator[NormalizedPhotoAsset]:
        profile = self._profile(conn)
        images = profile["images"]
        columns = _columns(conn, images)
        identifier = _column(columns, "Z_PK", "id", "id_local", "uuid")
        selections = [
            _expr("i", identifier, "image_id"),
            _expr("i", _column(columns, "ZPATH", "ZFILEPATH", "ZORIGINALPATH", "path", "filepath"), "direct_path"),
            _expr("i", _column(columns, "ZFILENAME", "ZNAME", "filename", "name"), "filename"),
            _expr("i", _column(columns, "ZRELATIVEPATH", "relative_path"), "relative_folder"),
            _expr("i", _column(columns, "ZROOTPATH", "root_path"), "root_path"),
            _expr("i", _column(columns, "ZRATING", "rating"), "rating"),
            _expr("i", _column(columns, "ZCOLORCLASS", "ZCOLORLABEL", "color_class", "color_label"), "color_label"),
            _expr("i", _column(columns, "ZPICK", "pick"), "pick"),
            _expr("i", _column(columns, "ZCAPTUREDATE", "ZDATE", "capture_date"), "capture_date"),
            _expr("i", _column(columns, "ZMODIFICATIONDATE", "modified_date"), "modified_date"),
            _expr("i", _column(columns, "ZTITLE", "title"), "title"),
            _expr("i", _column(columns, "ZDESCRIPTION", "ZCAPTION", "caption"), "caption"),
            _expr("i", _column(columns, "ZWIDTH", "width"), "width"),
            _expr("i", _column(columns, "ZHEIGHT", "height"), "height"),
        ]
        query = f"SELECT {', '.join(selections)} FROM {_quoted(images)} i ORDER BY i.{_quoted(identifier)} ASC"
        keywords_by_image, albums_by_image = self._capture_one_context(conn) if scopes.albums_folders or scopes.keywords else ({}, {})
        for row in conn.execute(query):
            image_id = str(row["image_id"] or "")
            direct_path = str(row["direct_path"] or "")
            filename = _clean_text(row["filename"], 220) or Path(direct_path).name or f"image-{image_id}"
            path = self._resolve_media_path(
                str(row["root_path"] or ""),
                str(row["relative_folder"] or ""),
                filename,
                direct_path,
            )
            rating = _clean_rating(row["rating"])
            color_label = _clean_color_label(row["color_label"], capture_one=True)
            pick_status = _clean_pick_status(row["pick"])
            kind = _media_kind(path)
            yield NormalizedPhotoAsset(
                provider=self.provider,
                library_id=library.library_id,
                external_id=f"capture_one_image_{image_id}",
                filename=filename,
                original_filename=filename,
                original_path=str(path) if scopes.originals else "",
                media_kind=kind,
                mime_type=mimetypes.guess_type(str(path))[0] or "",
                width=int(row["width"]) if row["width"] is not None else None,
                height=int(row["height"]) if row["height"] is not None else None,
                capture_date=str(row["capture_date"] or ""),
                modified_date=str(row["modified_date"] or ""),
                title=_clean_text(row["title"], 300),
                caption=_clean_text(row["caption"], 4000),
                favorite=rating >= 4 if scopes.favorites else False,
                missing=not path.is_file(),
                keywords=keywords_by_image.get(image_id, []) if scopes.keywords else [],
                labels=[color_label] if scopes.labels_ocr and color_label else [],
                albums=albums_by_image.get(image_id, []) if scopes.albums_folders else [],
                flags={
                    "catalogRating": rating,
                    "catalogColorLabel": color_label,
                    "catalogPickStatus": pick_status,
                    "raw": kind == "raw",
                },
                provenance={
                    "catalogKind": self.label,
                    "catalogPath": library.path,
                    "externalImageId": image_id,
                    "rootPath": str(row["root_path"] or ""),
                    "relativeFolder": str(row["relative_folder"] or ""),
                },
                metadata={
                    "dam": {
                        "provider": self.provider,
                        "schemaProfile": "capture-one",
                        "rating": rating,
                        "colorLabel": color_label,
                        "pickStatus": pick_status,
                    }
                },
                unsupported_fields=["adjustment-rendering", "variants", "sessions", "face-regions"],
            )

    def _iter_assets(
        self,
        conn: sqlite3.Connection,
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
    ) -> Iterator[NormalizedPhotoAsset]:
        if self.provider == LIGHTROOM_CATALOG_PROVIDER:
            yield from self._iter_lightroom_assets(conn, library, scopes)
        else:
            yield from self._iter_capture_one_assets(conn, library, scopes)

    def preview(
        self,
        path: str,
        scopes: PhotoSourceScopes,
        *,
        item_limit: int = 5_000,
        sample_limit: int = 24,
        time_budget_ms: int = 1_500,
    ) -> PhotoSourcePreview:
        started = monotonic()
        scan_limit = max(1, min(100_000, int(item_limit or 5_000)))
        sample_cap = max(0, min(100, int(sample_limit or 24)))
        budget = max(100, min(60_000, int(time_budget_ms or 1_500))) / 1000.0
        counts = {
            "assets": 0,
            "images": 0,
            "videos": 0,
            "raw": 0,
            "albums": 0,
            "people": 0,
            "keywords": 0,
            "withLocation": 0,
            "missing": 0,
            "rated": 0,
            "picked": 0,
            "rejected": 0,
        }
        album_ids: set[str] = set()
        keywords: set[str] = set()
        samples: list[dict[str, Any]] = []
        complete = True
        with self.open_library(path) as opened:
            for asset in opened.iter_assets(scopes):
                counts["assets"] += 1
                counts["videos" if asset.media_kind == "video" else "images"] += 1
                counts["raw"] += int(asset.media_kind == "raw")
                counts["missing"] += int(asset.missing)
                counts["rated"] += int(int(asset.flags.get("catalogRating", 0) or 0) > 0)
                counts["picked"] += int(asset.flags.get("catalogPickStatus") == "pick")
                counts["rejected"] += int(asset.flags.get("catalogPickStatus") == "reject")
                album_ids.update(album.album_id for album in asset.albums)
                keywords.update(value.casefold() for value in asset.keywords)
                if len(samples) < sample_cap:
                    samples.append({
                        "externalId": asset.external_id,
                        "filename": asset.filename,
                        "title": asset.title,
                        "captureDate": asset.capture_date,
                        "mediaKind": asset.media_kind,
                        "albumCount": len(asset.albums),
                        "peopleCount": 0,
                        "keywordCount": len(asset.keywords),
                        "rating": int(asset.flags.get("catalogRating", 0) or 0),
                        "colorLabel": str(asset.flags.get("catalogColorLabel", "") or ""),
                        "pickStatus": str(asset.flags.get("catalogPickStatus", "") or ""),
                        "missing": asset.missing,
                    })
                if counts["assets"] >= scan_limit or monotonic() - started >= budget:
                    complete = False
                    break
            library = opened.library
        counts["albums"] = len(album_ids)
        counts["keywords"] = len(keywords)
        warnings: list[dict[str, str]] = []
        if not complete:
            warnings.append({
                "code": "preview-bounded",
                "message": "Preview reached its foreground budget. The import job will read the complete catalog.",
            })
        if counts["missing"]:
            warnings.append({
                "code": "dam-media-missing",
                "message": f"{counts['missing']} catalog item(s) need a media-root mapping or relink.",
            })
        return PhotoSourcePreview(
            provider=self.provider,
            library=library,
            scopes=scopes,
            counts=counts,
            samples=samples,
            scanned_count=counts["assets"],
            complete=complete,
            elapsed_ms=int((monotonic() - started) * 1000),
            warnings=warnings,
            unsupported_fields=[
                "rendered proprietary adjustments",
                "face regions",
                "publish/session state",
            ],
            capabilities=dict(DAM_CATALOG_CAPABILITIES),
        )


def build_dam_catalog_adapters(*, home: Path | None = None) -> dict[str, DamCatalogAdapter]:
    return {
        LIGHTROOM_CATALOG_PROVIDER: DamCatalogAdapter(LIGHTROOM_CATALOG_PROVIDER, home=home),
        CAPTURE_ONE_CATALOG_PROVIDER: DamCatalogAdapter(CAPTURE_ONE_CATALOG_PROVIDER, home=home),
    }


__all__ = [
    "CAPTURE_ONE_CATALOG_PROVIDER",
    "DAM_CATALOG_CAPABILITIES",
    "DAM_CATALOG_PROVIDERS",
    "DamCatalogAdapter",
    "LIGHTROOM_CATALOG_PROVIDER",
    "build_dam_catalog_adapters",
]

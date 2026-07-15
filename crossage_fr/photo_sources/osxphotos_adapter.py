from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import datetime
from hashlib import sha256
import importlib
import importlib.metadata
import importlib.util
import os
from pathlib import Path
import platform
import shutil
import tempfile
from time import monotonic
from types import ModuleType
from typing import Any, Callable, Iterator

from .contracts import (
    NormalizedAlbum,
    NormalizedFace,
    NormalizedPerson,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourcePreview,
    PhotoSourceScopes,
    clean_strings,
    json_safe,
    scoped_sensitive_metadata,
)


APPLE_PHOTOS_PROVIDER = "apple_photos"
APPLE_PHOTOS_CAPABILITIES = {
    "discovery": True,
    "preview": True,
    "referencedImport": True,
    "managedImport": True,
    "incrementalSync": True,
    "exportOriginal": True,
    "exportEdited": True,
    "rawCompanions": True,
    "livePhotoMotion": True,
    "albumsFolders": True,
    "keywords": True,
    "places": True,
    "labels": True,
    "detectedText": True,
    "peopleFaces": True,
    "commentsLikes": True,
    "readOnly": True,
    "networkRequired": False,
}


def _iso(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _number(value: Any, cast: Callable[[Any], Any]) -> Any | None:
    try:
        return cast(value) if value is not None else None
    except (TypeError, ValueError, OverflowError):
        return None


def _clean_path(value: Any) -> str:
    text = str(value or "").strip()
    return os.path.normpath(os.path.expanduser(text)) if text else ""


def _library_id(path: str) -> str:
    normalized = os.path.normcase(os.path.realpath(os.path.expanduser(path)))
    return f"apple_{sha256(normalized.encode('utf-8')).hexdigest()[:32]}"


def _safe_attr(
    value: Any,
    name: str,
    default: Any = None,
    *,
    unsupported: set[str] | None = None,
) -> Any:
    try:
        return getattr(value, name)
    except (AttributeError, KeyError, TypeError, ValueError, OSError, RuntimeError):
        if unsupported is not None:
            unsupported.add(name)
        return default
    except Exception:
        if unsupported is not None:
            unsupported.add(name)
        return default


def _safe_call(
    value: Any,
    name: str,
    *args: Any,
    default: Any = None,
    unsupported: set[str] | None = None,
    **kwargs: Any,
) -> Any:
    method = _safe_attr(value, name, None, unsupported=unsupported)
    if not callable(method):
        return default
    try:
        return method(*args, **kwargs)
    except Exception:
        if unsupported is not None:
            unsupported.add(name)
        return default


def _folder_path(album: Any, unsupported: set[str]) -> list[dict[str, str]]:
    folder_objects = _safe_attr(album, "folder_list", [], unsupported=unsupported) or []
    output: list[dict[str, str]] = []
    for folder in folder_objects:
        folder_id = str(_safe_attr(folder, "uuid", "", unsupported=unsupported) or "")
        name = str(_safe_attr(folder, "title", "", unsupported=unsupported) or "").strip()
        if name:
            output.append({"id": folder_id, "name": name})
    if output:
        return output
    names = _safe_attr(album, "folder_names", [], unsupported=unsupported) or []
    return [
        {
            "id": f"folder_name_{sha256('/'.join(map(str, names[: index + 1])).encode('utf-8')).hexdigest()[:24]}",
            "name": str(name),
        }
        for index, name in enumerate(names)
        if str(name or "").strip()
    ]


def _normalized_album(album: Any, unsupported: set[str]) -> NormalizedAlbum | None:
    name = str(_safe_attr(album, "title", "", unsupported=unsupported) or "").strip()
    album_id = str(_safe_attr(album, "uuid", "", unsupported=unsupported) or "").strip()
    if not name:
        return None
    if not album_id:
        album_id = f"album_name_{sha256(name.encode('utf-8')).hexdigest()[:24]}"
    return NormalizedAlbum(
        album_id=album_id,
        name=name,
        folder_path=_folder_path(album, unsupported),
        shared=bool(_safe_attr(album, "shared", False, unsupported=unsupported)),
        owner=str(_safe_attr(album, "owner", "", unsupported=unsupported) or ""),
        metadata={
            "creationDate": _iso(_safe_attr(album, "creation_date", None, unsupported=unsupported)),
            "startDate": _iso(_safe_attr(album, "start_date", None, unsupported=unsupported)),
            "endDate": _iso(_safe_attr(album, "end_date", None, unsupported=unsupported)),
            "sortOrder": str(_safe_attr(album, "sort_order", "", unsupported=unsupported) or ""),
        },
    )


def _normalized_person(person: Any, unsupported: set[str]) -> NormalizedPerson:
    key_photo = _safe_attr(person, "keyphoto", None, unsupported=unsupported)
    return NormalizedPerson(
        person_id=str(_safe_attr(person, "uuid", "", unsupported=unsupported) or ""),
        name=str(_safe_attr(person, "name", "", unsupported=unsupported) or ""),
        display_name=str(_safe_attr(person, "display_name", "", unsupported=unsupported) or ""),
        key_asset_id=str(_safe_attr(key_photo, "uuid", "", unsupported=unsupported) or "") if key_photo else "",
        face_count=int(_number(_safe_attr(person, "facecount", 0, unsupported=unsupported), int) or 0),
        favorite=bool(_safe_attr(person, "favorite", False, unsupported=unsupported)),
        feature_less=bool(_safe_attr(person, "feature_less", False, unsupported=unsupported)),
        metadata={
            "keyFace": str(_safe_attr(person, "keyface", "", unsupported=unsupported) or ""),
            "sortOrder": _number(_safe_attr(person, "sort_order", None, unsupported=unsupported), int),
        },
    )


def _named_tuple_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if hasattr(value, "_asdict"):
        try:
            return json_safe(value._asdict())
        except Exception:
            return {}
    if isinstance(value, (list, tuple)):
        keys = ("x", "y", "height", "width")
        return {key: json_safe(item) for key, item in zip(keys, value)}
    return json_safe(value) if isinstance(json_safe(value), dict) else {}


def _normalized_face(face: Any, unsupported: set[str]) -> NormalizedFace:
    person = _safe_attr(face, "person_info", None, unsupported=unsupported)
    mpri = _named_tuple_dict(_safe_attr(face, "mpri_reg_rect", None, unsupported=unsupported))
    mwg = _named_tuple_dict(_safe_attr(face, "mwg_rs_area", None, unsupported=unsupported))
    pixels = _safe_call(face, "face_rect", default=[], unsupported=unsupported) or []
    region = {
        "coordinateSpace": "normalized",
        "mwg": mwg,
        "microsoft": mpri,
        "pixelRect": json_safe(pixels),
        "sourceWidth": _number(_safe_attr(face, "source_width", None, unsupported=unsupported), int),
        "sourceHeight": _number(_safe_attr(face, "source_height", None, unsupported=unsupported), int),
        "centerX": _number(_safe_attr(face, "center_x", None, unsupported=unsupported), float),
        "centerY": _number(_safe_attr(face, "center_y", None, unsupported=unsupported), float),
        "size": _number(_safe_attr(face, "size", None, unsupported=unsupported), float),
    }
    return NormalizedFace(
        face_id=str(_safe_attr(face, "uuid", "", unsupported=unsupported) or ""),
        person_id=str(_safe_attr(person, "uuid", "", unsupported=unsupported) or "") if person else "",
        person_name=str(_safe_attr(face, "name", "", unsupported=unsupported) or ""),
        region={key: value for key, value in region.items() if value not in (None, "", [], {})},
        quality=_number(_safe_attr(face, "quality", None, unsupported=unsupported), float),
        roll=_number(_safe_attr(face, "roll", None, unsupported=unsupported), float),
        pitch=_number(_safe_attr(face, "pitch", None, unsupported=unsupported), float),
        yaw=_number(_safe_attr(face, "yaw", None, unsupported=unsupported), float),
        manual=bool(_safe_attr(face, "manual", False, unsupported=unsupported)),
        metadata={
            "hasSmile": bool(_safe_attr(face, "has_smile", False, unsupported=unsupported)),
            "faceType": _safe_attr(face, "face_type", None, unsupported=unsupported),
            "ageType": _safe_attr(face, "age_type", None, unsupported=unsupported),
            "genderType": _safe_attr(face, "gender_type", None, unsupported=unsupported),
            "glassesType": _safe_attr(face, "glasses_type", None, unsupported=unsupported),
            "hairColorType": _safe_attr(face, "hair_color_type", None, unsupported=unsupported),
        },
    )


class ApplePhotosLibrary(AbstractContextManager["ApplePhotosLibrary"]):
    def __init__(self, adapter: "ApplePhotosAdapter", library_path: str):
        self.adapter = adapter
        self.library_path = _clean_path(library_path)
        module = adapter._module()
        self._source_snapshot: tempfile.TemporaryDirectory[str] | None = None
        try:
            if adapter.snapshot_databases:
                self._source_snapshot, snapshot_path = adapter._database_snapshot(self.library_path)
                self.db = module.PhotosDB(dbfile=snapshot_path, library_path=self.library_path)
            else:
                self.db = module.PhotosDB(dbfile=self.library_path)
        except Exception:
            if self._source_snapshot is not None:
                self._source_snapshot.cleanup()
            raise
        self.library = adapter._library_descriptor(
            self.library_path,
            photos_version=str(_safe_attr(self.db, "photos_version", "") or ""),
            database_version=str(_safe_attr(self.db, "db_version", "") or ""),
        )

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        connection = _safe_attr(self.db, "_db_connection", None)
        if connection is not None:
            try:
                connection.close()
            except Exception:
                pass
        tempdir = _safe_attr(self.db, "_tempdir", None)
        if tempdir is not None:
            try:
                tempdir.cleanup()
            except Exception:
                pass
        if self._source_snapshot is not None:
            self._source_snapshot.cleanup()
        return None

    def _photo_rows(self, scopes: PhotoSourceScopes) -> list[Any]:
        active = list(self.db.photos(intrash=False))
        deleted = list(self.db.photos(intrash=True)) if scopes.deleted else []
        by_uuid: dict[str, Any] = {}
        for photo in [*active, *deleted]:
            external_id = str(_safe_attr(photo, "uuid", "") or "")
            if external_id:
                by_uuid[external_id] = photo
        return [by_uuid[key] for key in sorted(by_uuid)]

    def iter_assets(
        self,
        scopes: PhotoSourceScopes,
        *,
        after_external_id: str = "",
        limit: int | None = None,
    ) -> Iterator[NormalizedPhotoAsset]:
        emitted = 0
        for photo in self._photo_rows(scopes):
            external_id = str(_safe_attr(photo, "uuid", "") or "")
            if after_external_id and external_id <= after_external_id:
                continue
            if bool(_safe_attr(photo, "hidden", False)) and not scopes.hidden:
                continue
            yield self.adapter.normalize_asset(photo, self.library, scopes)
            emitted += 1
            if limit is not None and emitted >= max(0, int(limit)):
                break

    def export_asset(
        self,
        external_id: str,
        destination: str,
        *,
        edited: bool = False,
        include_raw: bool = False,
        include_live_photo: bool = False,
        allow_photos_export: bool = False,
        timeout_seconds: int = 120,
    ) -> list[str]:
        photo = self.db.get_photo(str(external_id or ""))
        if photo is None:
            raise ValueError("Apple Photos asset was not found.")
        target = Path(destination).expanduser().resolve()
        target.mkdir(parents=True, exist_ok=True)
        return [
            str(path)
            for path in photo.export(
                str(target),
                edited=bool(edited),
                raw_photo=bool(include_raw),
                live_photo=bool(include_live_photo),
                use_photos_export=bool(allow_photos_export),
                overwrite=False,
                increment=True,
                timeout=max(1, min(3600, int(timeout_seconds or 120))),
            )
        ]


class ApplePhotosAdapter:
    """Lazy, read-only bridge around the optional osxphotos package."""

    def __init__(
        self,
        *,
        module_loader: Callable[[str], ModuleType] | None = None,
        platform_name: str | None = None,
        home: Path | None = None,
        env: dict[str, str] | None = None,
        snapshot_databases: bool | None = None,
    ) -> None:
        self._module_loader = module_loader or importlib.import_module
        self._custom_loader = module_loader is not None
        self.platform_name = platform_name or platform.system().lower()
        self.home = (home or Path.home()).expanduser()
        self.env = dict(os.environ if env is None else env)
        self.snapshot_databases = not self._custom_loader if snapshot_databases is None else bool(snapshot_databases)
        self._module_cache: ModuleType | None = None

    @property
    def supported_platform(self) -> bool:
        return self.platform_name in {"darwin", "mac", "macos"}

    def _module(self) -> ModuleType:
        if not self.supported_platform and not self._custom_loader:
            raise RuntimeError("Apple Photos integration is available only on macOS.")
        if self._module_cache is None:
            try:
                self._module_cache = self._module_loader("osxphotos")
            except Exception as exc:
                detail = " ".join(str(exc or "").split()).strip()[:500]
                raise RuntimeError(
                    "The osxphotos dependency could not be loaded"
                    f" ({exc.__class__.__name__}{f': {detail}' if detail else ''})."
                ) from exc
        return self._module_cache

    def _utils(self) -> ModuleType:
        return self._module_loader("osxphotos.utils")

    def _database_snapshot(self, library_path: str) -> tuple[tempfile.TemporaryDirectory[str], str]:
        source_root = Path(library_path).expanduser().resolve()
        source_database = source_root / "database"
        if not source_database.is_dir():
            raise FileNotFoundError(f"Apple Photos database directory was not found: {source_database}")
        snapshot = tempfile.TemporaryDirectory(prefix="vintrace-photos-readonly-")
        snapshot_root = Path(snapshot.name) / source_root.name
        try:
            shutil.copytree(
                source_database,
                snapshot_root / "database",
                symlinks=True,
                copy_function=shutil.copy2,
            )
            analysis_relative = Path("private/com.apple.mediaanalysisd/MediaAnalysis")
            source_analysis = source_root / analysis_relative
            if source_analysis.is_dir():
                shutil.copytree(
                    source_analysis,
                    snapshot_root / analysis_relative,
                    symlinks=True,
                    copy_function=shutil.copy2,
                )
        except Exception:
            snapshot.cleanup()
            raise
        return snapshot, str(snapshot_root)

    def dependency_available(self) -> bool:
        if not self.supported_platform:
            return False
        if not self._custom_loader:
            try:
                return importlib.util.find_spec("osxphotos") is not None
            except (ImportError, AttributeError, ValueError):
                return False
        try:
            self._module()
            return True
        except Exception:
            return False

    def status(self) -> dict[str, Any]:
        available = False
        version = ""
        error = ""
        if self.supported_platform:
            if self._custom_loader:
                try:
                    module = self._module()
                    available = True
                    version = str(getattr(module, "__version__", "") or "")
                except Exception as exc:
                    error = str(exc)
            else:
                available = self.dependency_available()
                if available:
                    try:
                        version = importlib.metadata.version("osxphotos")
                    except importlib.metadata.PackageNotFoundError:
                        version = ""
                else:
                    error = "The osxphotos dependency is not installed."
        else:
            error = "Apple Photos integration is available only on macOS."
        return {
            "provider": APPLE_PHOTOS_PROVIDER,
            "supported": self.supported_platform,
            "available": available,
            "dependency": "osxphotos",
            "dependencyVersion": version,
            "dependencyLoadState": "loaded" if self._module_cache is not None else "deferred",
            "readOnly": True,
            "networkAccess": "none-by-default",
            "capabilities": dict(APPLE_PHOTOS_CAPABILITIES),
            "error": error,
            "warnings": [
                {
                    "code": "apple-photos-shared-album-version-limit",
                    "message": "Shared-album coverage depends on the installed macOS and osxphotos versions.",
                }
            ],
        }

    def _library_descriptor(
        self,
        library_path: str,
        *,
        system_path: str = "",
        last_path: str = "",
        photos_version: str = "",
        database_version: str = "",
    ) -> PhotoSourceLibrary:
        path = _clean_path(library_path)
        target = Path(path)
        modified_at = ""
        try:
            modified_at = datetime.fromtimestamp(target.stat().st_mtime).astimezone().isoformat()
        except OSError:
            pass
        available = target.is_dir()
        warnings: list[dict[str, str]] = []
        status = "ready" if available else "missing"
        if available and not os.access(target, os.R_OK):
            status = "permission_denied"
            warnings.append({
                "code": "apple-photos-permission-denied",
                "message": "Vintrace cannot read this Photos library. Grant Files and Folders or Full Disk Access, then retry.",
            })
        return PhotoSourceLibrary(
            provider=APPLE_PHOTOS_PROVIDER,
            library_id=_library_id(path),
            path=path,
            name=target.stem or "Apple Photos",
            available=available,
            system_library=bool(system_path and os.path.normcase(path) == os.path.normcase(_clean_path(system_path))),
            last_used=bool(last_path and os.path.normcase(path) == os.path.normcase(_clean_path(last_path))),
            modified_at=modified_at,
            photos_version=photos_version,
            database_version=database_version,
            status=status,
            warnings=warnings,
            metadata={"package": target.name, "readOnly": True, "databaseSnapshot": True},
        )

    def _discovery_path(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        path = Path(os.path.expanduser(text))
        if not path.is_absolute():
            path = self.home / "Pictures" / path
        return os.path.abspath(os.path.normpath(str(path)))

    def _ignore_incidental_library(self, path: str) -> bool:
        if self.env.get("VINTRACE_INCLUDE_PHOTOS_TEST_LIBRARIES", "").strip() == "1":
            return False
        normalized = os.path.normcase(os.path.realpath(path))
        ignored_roots = (
            os.path.normcase("/private/tmp"),
            os.path.normcase("/tmp"),
            os.path.normcase("/var/folders"),
            os.path.normcase(os.path.realpath(self.home / "Library/Developer/CoreSimulator")),
        )
        return any(normalized == root or normalized.startswith(f"{root}{os.sep}") for root in ignored_roots)

    def discover_libraries(self) -> list[PhotoSourceLibrary]:
        if not self.supported_platform:
            return []
        paths: list[str] = []
        system_path = ""
        last_path = ""
        if self.dependency_available():
            try:
                utils = self._utils()
                system_path = str(utils.get_system_library_path() or "")
                last_path = str(utils.get_last_library_path() or "")
                paths.extend(str(path) for path in (utils.list_photo_libraries() or []))
            except Exception:
                pass
        system_path = self._discovery_path(system_path)
        last_path = self._discovery_path(last_path)
        paths.extend(str(path) for path in sorted((self.home / "Pictures").glob("*.photoslibrary")))
        paths.extend(path for path in (system_path, last_path) if path)
        pinned = {
            os.path.normcase(os.path.realpath(path))
            for path in (system_path, last_path)
            if path
        }
        output: list[PhotoSourceLibrary] = []
        seen: set[str] = set()
        for raw_path in paths:
            path = self._discovery_path(raw_path)
            key = os.path.normcase(os.path.realpath(path))
            if not path or key in seen or (key not in pinned and self._ignore_incidental_library(path)):
                continue
            seen.add(key)
            output.append(self._library_descriptor(path, system_path=system_path, last_path=last_path))
        output.sort(key=lambda item: (not item.system_library, not item.last_used, item.name.casefold(), item.path.casefold()))
        return output

    def open_library(self, library_path: str) -> ApplePhotosLibrary:
        path = _clean_path(library_path)
        if not path:
            raise ValueError("Apple Photos libraryPath is required.")
        if not Path(path).is_dir():
            raise ValueError("Apple Photos library was not found.")
        return ApplePhotosLibrary(self, path)

    def normalize_asset(
        self,
        photo: Any,
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
    ) -> NormalizedPhotoAsset:
        unsupported: set[str] = set()
        external_id = str(_safe_attr(photo, "uuid", "", unsupported=unsupported) or "")
        filename = str(_safe_attr(photo, "filename", "", unsupported=unsupported) or "")
        original_filename = str(_safe_attr(photo, "original_filename", filename, unsupported=unsupported) or filename)
        is_movie = bool(_safe_attr(photo, "ismovie", False, unsupported=unsupported))
        is_live = bool(_safe_attr(photo, "live_photo", False, unsupported=unsupported))
        is_raw = bool(_safe_attr(photo, "israw", False, unsupported=unsupported))
        media_kind = "video" if is_movie else "live_photo" if is_live else "raw" if is_raw else "image"

        albums: list[NormalizedAlbum] = []
        if scopes.albums_folders:
            for album in _safe_attr(photo, "album_info", [], unsupported=unsupported) or []:
                normalized = _normalized_album(album, unsupported)
                if normalized is not None:
                    if normalized.shared and not scopes.shared:
                        continue
                    normalized.owner = normalized.owner if scopes.shared else ""
                    normalized.metadata = scoped_sensitive_metadata(normalized.metadata, scopes)
                    albums.append(normalized)

        people: list[NormalizedPerson] = []
        faces: list[NormalizedFace] = []
        if scopes.people_faces:
            people = [
                _normalized_person(person, unsupported)
                for person in (_safe_attr(photo, "person_info", [], unsupported=unsupported) or [])
            ]
            faces = [
                _normalized_face(face, unsupported)
                for face in (_safe_attr(photo, "face_info", [], unsupported=unsupported) or [])
            ]

        place = _safe_attr(photo, "place", None, unsupported=unsupported) if scopes.precise_location else None
        latitude = _number(_safe_attr(photo, "latitude", None, unsupported=unsupported), float) if scopes.precise_location else None
        longitude = _number(_safe_attr(photo, "longitude", None, unsupported=unsupported), float) if scopes.precise_location else None
        location: dict[str, Any] = {}
        if latitude is not None and longitude is not None:
            location = {
                "latitude": latitude,
                "longitude": longitude,
                "place": json_safe(place),
            }

        ocr_blocks: list[dict[str, Any]] = []
        if scopes.labels_ocr and scopes.extract_detected_text:
            detected = _safe_call(photo, "detected_text", default=[], unsupported=unsupported) or []
            for index, item in enumerate(detected):
                if isinstance(item, (list, tuple)) and item:
                    text = str(item[0] or "").strip()
                    confidence = _number(item[1] if len(item) > 1 else None, float)
                else:
                    text = str(item or "").strip()
                    confidence = None
                if text:
                    ocr_blocks.append({"id": f"apple_text_{external_id}_{index}", "text": text, "confidence": confidence})

        imported_by = _safe_attr(photo, "imported_by", (None, None), unsupported=unsupported) or (None, None)
        imported_by_name = str(imported_by[0] or "") if isinstance(imported_by, (list, tuple)) and imported_by else ""
        imported_by_bundle = str(imported_by[1] or "") if isinstance(imported_by, (list, tuple)) and len(imported_by) > 1 else ""
        moment = _safe_attr(photo, "moment_info", None, unsupported=unsupported)
        import_info = _safe_attr(photo, "import_info", None, unsupported=unsupported)
        shared = bool(_safe_attr(photo, "shared", False, unsupported=unsupported))
        has_adjustments = bool(_safe_attr(photo, "hasadjustments", False, unsupported=unsupported))
        flags = {
            "livePhoto": is_live,
            "raw": is_raw,
            "hasRaw": bool(_safe_attr(photo, "has_raw", False, unsupported=unsupported)),
            "rawOriginal": bool(_safe_attr(photo, "raw_original", False, unsupported=unsupported)),
            "burst": bool(_safe_attr(photo, "burst", False, unsupported=unsupported)),
            "burstSelected": bool(_safe_attr(photo, "burst_selected", False, unsupported=unsupported)),
            "burstKey": bool(_safe_attr(photo, "burst_key", False, unsupported=unsupported)),
            "hdr": bool(_safe_attr(photo, "hdr", False, unsupported=unsupported)),
            "portrait": bool(_safe_attr(photo, "portrait", False, unsupported=unsupported)),
            "panorama": bool(_safe_attr(photo, "panorama", False, unsupported=unsupported)),
            "selfie": bool(_safe_attr(photo, "selfie", False, unsupported=unsupported)),
            "screenshot": bool(_safe_attr(photo, "screenshot", False, unsupported=unsupported)),
            "screenRecording": bool(_safe_attr(photo, "screen_recording", False, unsupported=unsupported)),
            "slowMo": bool(_safe_attr(photo, "slow_mo", False, unsupported=unsupported)),
            "timeLapse": bool(_safe_attr(photo, "time_lapse", False, unsupported=unsupported)),
            "spatial": _number(_safe_attr(photo, "spatial", 0, unsupported=unsupported), int) or 0,
            "externalEdit": bool(_safe_attr(photo, "external_edit", False, unsupported=unsupported)),
            "isReference": bool(_safe_attr(photo, "isreference", False, unsupported=unsupported)),
        }
        if scopes.shared:
            flags.update({
                "sharedLibrary": bool(_safe_attr(photo, "shared_library", False, unsupported=unsupported)),
                "sharedMoment": bool(_safe_attr(photo, "shared_moment", False, unsupported=unsupported)),
                "syndicated": bool(_safe_attr(photo, "syndicated", False, unsupported=unsupported)),
                "savedToLibrary": bool(_safe_attr(photo, "saved_to_library", False, unsupported=unsupported)),
            })
        return NormalizedPhotoAsset(
            provider=APPLE_PHOTOS_PROVIDER,
            library_id=library.library_id,
            external_id=external_id,
            filename=filename or original_filename or external_id,
            original_filename=original_filename,
            original_path=_clean_path(_safe_attr(photo, "path", "", unsupported=unsupported)) if scopes.originals else "",
            edited_path=_clean_path(_safe_attr(photo, "path_edited", "", unsupported=unsupported)) if scopes.edited else "",
            raw_path=_clean_path(_safe_attr(photo, "path_raw", "", unsupported=unsupported)) if scopes.raw else "",
            live_photo_path=_clean_path(_safe_attr(photo, "path_live_photo", "", unsupported=unsupported)) if scopes.live_photo_motion else "",
            edited_live_photo_path=_clean_path(_safe_attr(photo, "path_edited_live_photo", "", unsupported=unsupported)) if scopes.live_photo_motion and scopes.edited else "",
            media_kind=media_kind,
            mime_type=str(_safe_attr(photo, "uti", "", unsupported=unsupported) or ""),
            width=_number(_safe_attr(photo, "width", None, unsupported=unsupported), int),
            height=_number(_safe_attr(photo, "height", None, unsupported=unsupported), int),
            capture_date=_iso(_safe_attr(photo, "date", None, unsupported=unsupported)),
            original_date=_iso(_safe_attr(photo, "date_original", None, unsupported=unsupported)),
            modified_date=_iso(_safe_attr(photo, "date_modified", None, unsupported=unsupported)),
            added_date=_iso(_safe_attr(photo, "date_added", None, unsupported=unsupported)),
            timezone_name=str(_safe_attr(photo, "tzname", "", unsupported=unsupported) or ""),
            timezone_offset_seconds=_number(_safe_attr(photo, "tzoffset", None, unsupported=unsupported), int),
            title=str(_safe_attr(photo, "title", "", unsupported=unsupported) or ""),
            caption=str(_safe_attr(photo, "description", "", unsupported=unsupported) or ""),
            favorite=bool(_safe_attr(photo, "favorite", False, unsupported=unsupported)) if scopes.favorites else False,
            hidden=bool(_safe_attr(photo, "hidden", False, unsupported=unsupported)) if scopes.hidden else False,
            deleted=bool(_safe_attr(photo, "intrash", False, unsupported=unsupported)) if scopes.deleted else False,
            deleted_at=_iso(_safe_attr(photo, "date_trashed", None, unsupported=unsupported)) if scopes.deleted else "",
            shared=shared if scopes.shared else False,
            missing=bool(_safe_attr(photo, "ismissing", False, unsupported=unsupported)),
            cloud_asset=bool(_safe_attr(photo, "iscloudasset", False, unsupported=unsupported)),
            has_adjustments=has_adjustments,
            location=location,
            keywords=clean_strings(_safe_attr(photo, "keywords", [], unsupported=unsupported)) if scopes.keywords else [],
            labels=clean_strings(_safe_attr(photo, "labels_normalized", [], unsupported=unsupported)) if scopes.labels_ocr else [],
            ocr_blocks=ocr_blocks,
            albums=albums,
            people=people,
            faces=faces,
            comments=json_safe(_safe_attr(photo, "comments", [], unsupported=unsupported)) if scopes.comments_likes else [],
            likes=json_safe(_safe_attr(photo, "likes", [], unsupported=unsupported)) if scopes.comments_likes else [],
            exif=scoped_sensitive_metadata(
                json_safe(_safe_attr(photo, "exif_info", None, unsupported=unsupported)) or {},
                scopes,
            ),
            search=json_safe(_safe_attr(photo, "search_info_normalized", None, unsupported=unsupported)) if scopes.labels_ocr else {},
            flags=flags,
            provenance={
                "libraryPath": library.path,
                "libraryId": library.library_id,
                "uuid": external_id,
                "originalFilename": original_filename,
                "importedBy": {"name": imported_by_name, "bundleId": imported_by_bundle},
                "importSession": scoped_sensitive_metadata(import_info, scopes),
                "moment": scoped_sensitive_metadata(moment, scopes),
                "fingerprint": str(_safe_attr(photo, "fingerprint", "", unsupported=unsupported) or ""),
                "utiOriginal": str(_safe_attr(photo, "uti_original", "", unsupported=unsupported) or ""),
                "utiEdited": str(_safe_attr(photo, "uti_edited", "", unsupported=unsupported) or ""),
                "utiRaw": str(_safe_attr(photo, "uti_raw", "", unsupported=unsupported) or ""),
            },
            metadata={
                "orientation": _number(_safe_attr(photo, "orientation", None, unsupported=unsupported), int),
                "originalWidth": _number(_safe_attr(photo, "original_width", None, unsupported=unsupported), int),
                "originalHeight": _number(_safe_attr(photo, "original_height", None, unsupported=unsupported), int),
                "originalOrientation": _number(_safe_attr(photo, "original_orientation", None, unsupported=unsupported), int),
                "originalFileSize": _number(_safe_attr(photo, "original_filesize", None, unsupported=unsupported), int),
                "aiCaption": str(_safe_attr(photo, "ai_caption", "", unsupported=unsupported) or "") if scopes.labels_ocr else "",
                "mediaAnalysis": scoped_sensitive_metadata(
                    json_safe(_safe_attr(photo, "media_analysis", {}, unsupported=unsupported)) or {},
                    scopes,
                ) if scopes.labels_ocr else {},
                "owner": str(_safe_attr(photo, "owner", "", unsupported=unsupported) or "") if scopes.shared else "",
                "shareParticipants": clean_strings(_safe_attr(photo, "share_participants", [], unsupported=unsupported)) if scopes.shared else [],
            },
            unsupported_fields=sorted(unsupported),
        )

    def preview(
        self,
        library_path: str,
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
            "livePhotos": 0,
            "raw": 0,
            "edited": 0,
            "missing": 0,
            "cloud": 0,
            "favorites": 0,
            "hidden": 0,
            "deleted": 0,
            "shared": 0,
            "albums": 0,
            "people": 0,
            "keywords": 0,
            "withLocation": 0,
        }
        samples: list[dict[str, Any]] = []
        album_ids: set[str] = set()
        person_ids: set[str] = set()
        keywords: set[str] = set()
        unsupported: set[str] = set()
        complete = True
        warnings: list[dict[str, str]] = []
        with self.open_library(library_path) as opened:
            iterator = opened.iter_assets(scopes)
            for asset in iterator:
                counts["assets"] += 1
                counts["videos" if asset.media_kind == "video" else "images"] += 1
                counts["livePhotos"] += int(bool(asset.flags.get("livePhoto")))
                counts["raw"] += int(bool(asset.flags.get("raw") or asset.flags.get("hasRaw")))
                counts["edited"] += int(asset.has_adjustments)
                counts["missing"] += int(asset.missing)
                counts["cloud"] += int(asset.cloud_asset)
                counts["favorites"] += int(asset.favorite)
                counts["hidden"] += int(asset.hidden)
                counts["deleted"] += int(asset.deleted)
                counts["shared"] += int(asset.shared)
                counts["withLocation"] += int(bool(asset.location))
                album_ids.update(album.album_id for album in asset.albums)
                person_ids.update(person.person_id or person.name for person in asset.people)
                keywords.update(keyword.casefold() for keyword in asset.keywords)
                unsupported.update(asset.unsupported_fields)
                if len(samples) < sample_cap:
                    samples.append({
                        "externalId": asset.external_id,
                        "filename": asset.original_filename or asset.filename,
                        "title": asset.title,
                        "captureDate": asset.capture_date,
                        "mediaKind": asset.media_kind,
                        "favorite": asset.favorite,
                        "hidden": asset.hidden,
                        "deleted": asset.deleted,
                        "missing": asset.missing,
                        "cloudAsset": asset.cloud_asset,
                        "albumCount": len(asset.albums),
                        "peopleCount": len(asset.people),
                    })
                if counts["assets"] >= scan_limit or monotonic() - started >= budget:
                    complete = False
                    break
            counts["albums"] = len(album_ids)
            counts["people"] = len(person_ids)
            counts["keywords"] = len(keywords)
            library = opened.library
        if not complete:
            warnings.append({
                "code": "preview-bounded",
                "message": "Preview reached its foreground work budget. Start the import or sync job for a complete library pass.",
            })
        if counts["missing"]:
            warnings.append({
                "code": "apple-photos-missing-originals",
                "message": "Some originals are not stored locally. Vintrace will not fetch them unless you explicitly allow Photos export.",
            })
        return PhotoSourcePreview(
            provider=APPLE_PHOTOS_PROVIDER,
            library=library,
            scopes=scopes,
            counts=counts,
            samples=samples,
            scanned_count=counts["assets"],
            complete=complete,
            elapsed_ms=int((monotonic() - started) * 1000),
            warnings=warnings,
            unsupported_fields=sorted(unsupported),
            capabilities=dict(APPLE_PHOTOS_CAPABILITIES),
        )

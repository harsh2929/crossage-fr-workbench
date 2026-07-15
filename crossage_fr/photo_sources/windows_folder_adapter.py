from __future__ import annotations

from contextlib import AbstractContextManager
from datetime import datetime
from hashlib import sha256
import mimetypes
import os
from pathlib import Path
import platform
from time import monotonic
from typing import Any, Iterator

from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, RAW_IMAGE_EXTENSIONS
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS

from .contracts import (
    NormalizedAlbum,
    NormalizedFace,
    NormalizedPerson,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourcePreview,
    PhotoSourceScopes,
    clean_strings,
    scoped_sensitive_metadata,
)
from .portable_metadata import read_portable_photo_metadata


WINDOWS_FOLDERS_PROVIDER = "windows_folders"
FOLDER_PHOTO_EXTENSIONS = {extension.lower() for extension in (*IMAGE_EXTENSIONS, *VIDEO_EXTENSIONS)}
WINDOWS_FOLDER_CAPABILITIES = {
    "discovery": True,
    "preview": True,
    "referencedImport": True,
    "managedImport": True,
    "incrementalSync": True,
    "exportOriginal": False,
    "exportEdited": False,
    "rawCompanions": True,
    "livePhotoMotion": True,
    "albumsFolders": True,
    "keywords": True,
    "places": True,
    "labels": True,
    "detectedText": False,
    "peopleFaces": True,
    "commentsLikes": False,
    "readOnly": True,
    "networkRequired": False,
}


def _library_id(path: str) -> str:
    normalized = os.path.normcase(os.path.realpath(os.path.expanduser(path)))
    return f"folder_{sha256(normalized.encode('utf-8')).hexdigest()[:32]}"


def _path_external_id(path: Path, metadata_id: str = "") -> str:
    if metadata_id:
        clean = metadata_id.removeprefix("xmp.did:").removeprefix("uuid:").strip()
        if clean:
            return f"xmp_{sha256(clean.encode('utf-8')).hexdigest()[:32]}"
    try:
        stat = path.stat()
        identity = f"{stat.st_dev}:{stat.st_ino}"
        if int(stat.st_ino or 0):
            return f"file_{sha256(identity.encode('utf-8')).hexdigest()[:32]}"
    except OSError:
        pass
    canonical = os.path.normcase(os.path.realpath(path))
    return f"path_{sha256(canonical.encode('utf-8')).hexdigest()[:32]}"


def _folder_album(root: Path, path: Path) -> NormalizedAlbum | None:
    try:
        relative_parent = path.parent.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return None
    if not relative_parent.parts:
        return None
    folder_path: list[dict[str, str]] = []
    cumulative: list[str] = []
    for name in relative_parent.parts:
        cumulative.append(name)
        token = "/".join(cumulative)
        folder_path.append({
            "id": f"folder_{sha256(token.casefold().encode('utf-8')).hexdigest()[:24]}",
            "name": name,
        })
    album_token = relative_parent.as_posix()
    return NormalizedAlbum(
        album_id=f"album_{sha256(album_token.casefold().encode('utf-8')).hexdigest()[:24]}",
        name=relative_parent.name,
        folder_path=folder_path[:-1],
        metadata={"relativePath": album_token, "source": "filesystem"},
    )


class WindowsFolderLibrary(AbstractContextManager["WindowsFolderLibrary"]):
    def __init__(self, adapter: "WindowsFolderAdapter", root_path: str):
        self.adapter = adapter
        self.root = Path(root_path).expanduser().resolve()
        if not self.root.is_dir():
            raise ValueError("Photo folder was not found.")
        self.library = adapter._descriptor(self.root)

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None

    def _paths(self) -> Iterator[Path]:
        for current, dirnames, filenames in os.walk(self.root):
            dirnames[:] = sorted(
                name
                for name in dirnames
                if name not in {"$RECYCLE.BIN", "System Volume Information", ".git", "node_modules", "__pycache__"}
                and not name.startswith(".")
            )
            for filename in sorted(filenames):
                path = Path(current) / filename
                if path.suffix.lower() in FOLDER_PHOTO_EXTENSIONS:
                    yield path

    def iter_assets(
        self,
        scopes: PhotoSourceScopes,
        *,
        after_external_id: str = "",
        limit: int | None = None,
    ) -> Iterator[NormalizedPhotoAsset]:
        resume_reached = not bool(after_external_id)
        emitted = 0
        for path in self._paths():
            metadata = read_portable_photo_metadata(path)
            external_id = _path_external_id(path, metadata.document_id or metadata.instance_id)
            if not resume_reached:
                if external_id == after_external_id:
                    resume_reached = True
                continue
            yield self.adapter.normalize_asset(path, metadata, self.library, scopes, external_id=external_id)
            emitted += 1
            if limit is not None and emitted >= max(0, int(limit)):
                break


class WindowsFolderAdapter:
    """Folder-native photo source for Windows and portable XMP libraries."""

    def __init__(self, *, platform_name: str | None = None, home: Path | None = None, env: dict[str, str] | None = None):
        self.platform_name = platform_name or platform.system().lower()
        self.home = (home or Path.home()).expanduser()
        self.env = dict(os.environ if env is None else env)

    def status(self) -> dict[str, Any]:
        return {
            "provider": WINDOWS_FOLDERS_PROVIDER,
            "supported": True,
            "available": True,
            "readOnly": True,
            "networkAccess": "none",
            "capabilities": dict(WINDOWS_FOLDER_CAPABILITIES),
            "error": "",
            "warnings": [],
        }

    def _descriptor(self, path: Path) -> PhotoSourceLibrary:
        modified_at = ""
        try:
            modified_at = datetime.fromtimestamp(path.stat().st_mtime).astimezone().isoformat()
        except OSError:
            pass
        available = path.is_dir()
        return PhotoSourceLibrary(
            provider=WINDOWS_FOLDERS_PROVIDER,
            library_id=_library_id(str(path)),
            path=str(path),
            name=path.name or "Photo folder",
            available=available,
            modified_at=modified_at,
            status="ready" if available else "missing",
            metadata={"folderNative": True, "readOnly": True},
        )

    def discover_libraries(self) -> list[PhotoSourceLibrary]:
        pictures = self.home / "Pictures"
        one_drive = Path(self.env.get("OneDrive", str(self.home / "OneDrive"))).expanduser()
        candidates = [
            pictures,
            pictures / "Camera Roll",
            pictures / "Saved Pictures",
            one_drive / "Pictures",
        ]
        output: list[PhotoSourceLibrary] = []
        seen: set[str] = set()
        for candidate in candidates:
            key = os.path.normcase(os.path.realpath(candidate))
            if key in seen:
                continue
            seen.add(key)
            output.append(self._descriptor(candidate))
        return output

    def open_library(self, root_path: str) -> WindowsFolderLibrary:
        return WindowsFolderLibrary(self, root_path)

    def normalize_asset(
        self,
        path: Path,
        portable: Any,
        library: PhotoSourceLibrary,
        scopes: PhotoSourceScopes,
        *,
        external_id: str = "",
    ) -> NormalizedPhotoAsset:
        try:
            stat = path.stat()
            modified = datetime.fromtimestamp(stat.st_mtime).astimezone().isoformat()
        except OSError:
            stat = None
            modified = ""
        suffix = path.suffix.lower()
        media_kind = "video" if suffix in VIDEO_EXTENSIONS else "raw" if suffix in RAW_IMAGE_EXTENSIONS else "image"
        album = _folder_album(Path(library.path), path) if scopes.albums_folders else None
        people: list[NormalizedPerson] = []
        faces: list[NormalizedFace] = []
        if scopes.people_faces:
            for index, item in enumerate(portable.people_regions):
                name = str(item.get("personName", "") or "").strip()
                if not name:
                    continue
                person_id = f"portable_person_{sha256(name.casefold().encode('utf-8')).hexdigest()[:24]}"
                people.append(NormalizedPerson(person_id=person_id, name=name, display_name=name))
                faces.append(NormalizedFace(
                    face_id=f"portable_face_{external_id}_{index}",
                    person_id=person_id,
                    person_name=name,
                    region=item.get("region", {}) if isinstance(item.get("region"), dict) else {},
                    metadata={"regionSource": item.get("source", "portable_xmp"), "type": item.get("type", "Face")},
                ))
        location: dict[str, Any] = {}
        if scopes.precise_location and portable.latitude is not None and portable.longitude is not None:
            location = {
                "latitude": float(portable.latitude),
                "longitude": float(portable.longitude),
                "place": {
                    key: value
                    for key, value in portable.raw.items()
                    if key in {"city", "state", "country"} and value
                },
            }
        external_id = external_id or _path_external_id(path, portable.document_id or portable.instance_id)
        private_people_names = {
            str(item.get("personName", "") or "").strip().casefold()
            for item in portable.people_regions
            if str(item.get("personName", "") or "").strip()
        }
        keywords = clean_strings(portable.keywords) if scopes.keywords else []
        labels = clean_strings(portable.hierarchical_keywords) if scopes.labels_ocr else []
        if not scopes.people_faces and private_people_names:
            keywords = [value for value in keywords if value.casefold() not in private_people_names]
            labels = [value for value in labels if value.casefold() not in private_people_names]
        portable_payload = scoped_sensitive_metadata(portable.to_dict(), scopes)
        exif_payload = scoped_sensitive_metadata(portable.exif, scopes)
        return NormalizedPhotoAsset(
            provider=WINDOWS_FOLDERS_PROVIDER,
            library_id=library.library_id,
            external_id=external_id,
            filename=path.name,
            original_filename=path.name,
            original_path=str(path.resolve()) if scopes.originals else "",
            media_kind=media_kind,
            mime_type=portable.mime_type or mimetypes.guess_type(str(path))[0] or "",
            width=portable.width,
            height=portable.height,
            capture_date=portable.date_created or modified,
            modified_date=modified,
            added_date=modified,
            title=portable.title,
            caption=portable.caption,
            favorite=portable.rating >= 4 if scopes.favorites else False,
            location=location,
            keywords=keywords,
            labels=labels,
            albums=[album] if album is not None else [],
            people=people,
            faces=faces,
            exif=exif_payload,
            flags={
                "raw": media_kind == "raw",
                "portablePeopleRegions": len(portable.people_regions),
                "xmpRating": portable.rating,
                "xmpColorLabel": portable.color_label,
                "xmpPickStatus": portable.pick_status,
            },
            provenance={
                "libraryPath": library.path,
                "libraryId": library.library_id,
                "documentId": portable.document_id,
                "instanceId": portable.instance_id,
                "xmpSource": portable.source,
                "relativePath": str(path.resolve().relative_to(Path(library.path).resolve())),
            },
            metadata={
                "portable": portable_payload,
                "fileSize": int(stat.st_size) if stat is not None else None,
                "mtimeNs": int(stat.st_mtime_ns) if stat is not None else None,
            },
            unsupported_fields=["comments", "likes", "appleSearchInfo", "appleAlbums"],
        )

    def preview(
        self,
        root_path: str,
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
            "withPortableMetadata": 0,
            "metadataWarnings": 0,
        }
        albums: set[str] = set()
        people: set[str] = set()
        keywords: set[str] = set()
        samples: list[dict[str, Any]] = []
        complete = True
        with self.open_library(root_path) as opened:
            for asset in opened.iter_assets(scopes):
                counts["assets"] += 1
                counts["videos" if asset.media_kind == "video" else "images"] += 1
                counts["raw"] += int(asset.media_kind == "raw")
                counts["withLocation"] += int(bool(asset.location))
                counts["withPortableMetadata"] += int(bool(asset.metadata.get("portable", {}).get("source")))
                counts["metadataWarnings"] += len(asset.metadata.get("portable", {}).get("warnings", []))
                albums.update(album.album_id for album in asset.albums)
                people.update(person.person_id or person.name for person in asset.people)
                keywords.update(keyword.casefold() for keyword in asset.keywords)
                if len(samples) < sample_cap:
                    samples.append({
                        "externalId": asset.external_id,
                        "filename": asset.filename,
                        "title": asset.title,
                        "captureDate": asset.capture_date,
                        "mediaKind": asset.media_kind,
                        "albumCount": len(asset.albums),
                        "peopleCount": len(asset.people),
                        "keywordCount": len(asset.keywords),
                    })
                if counts["assets"] >= scan_limit or monotonic() - started >= budget:
                    complete = False
                    break
            library = opened.library
        counts["albums"] = len(albums)
        counts["people"] = len(people)
        counts["keywords"] = len(keywords)
        warnings = [] if complete else [{
            "code": "preview-bounded",
            "message": "Preview reached its foreground work budget. Start the import or sync job for a complete folder pass.",
        }]
        if counts["metadataWarnings"]:
            warnings.append({
                "code": "portable-metadata-warnings",
                "message": f"{counts['metadataWarnings']} portable metadata warning(s) need review.",
            })
        return PhotoSourcePreview(
            provider=WINDOWS_FOLDERS_PROVIDER,
            library=library,
            scopes=scopes,
            counts=counts,
            samples=samples,
            scanned_count=counts["assets"],
            complete=complete,
            elapsed_ms=int((monotonic() - started) * 1000),
            warnings=warnings,
            unsupported_fields=["comments", "likes", "appleSearchInfo", "appleAlbums"],
            capabilities=dict(WINDOWS_FOLDER_CAPABILITIES),
        )

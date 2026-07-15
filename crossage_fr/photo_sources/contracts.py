from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from hashlib import sha256
import json
from pathlib import Path
import re
from typing import Any, Iterable


SENSITIVE_PHOTO_SOURCE_SCOPES = {
    "peopleFaces",
    "hidden",
    "deleted",
    "shared",
    "commentsLikes",
    "preciseLocation",
}


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {
            str(key): json_safe(item)
            for key, item in value.items()
            if item is not None
        }
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    if hasattr(value, "asdict"):
        try:
            return json_safe(value.asdict())
        except Exception:
            pass
    if hasattr(value, "_asdict"):
        try:
            return json_safe(value._asdict())
        except Exception:
            pass
    if hasattr(value, "__dict__"):
        try:
            return json_safe(
                {
                    key: item
                    for key, item in vars(value).items()
                    if not str(key).startswith("_")
                }
            )
        except Exception:
            pass
    return str(value)


def clean_strings(values: Any, *, limit: int = 10_000, max_length: int = 500) -> list[str]:
    if isinstance(values, str):
        raw_values: Iterable[Any] = [values]
    elif isinstance(values, Iterable) and not isinstance(values, (bytes, dict)):
        raw_values = values
    else:
        return []
    output: list[str] = []
    seen: set[str] = set()
    for value in raw_values:
        text = " ".join(str(value or "").split()).strip()[:max_length]
        key = text.casefold()
        if not text or key in seen:
            continue
        seen.add(key)
        output.append(text)
        if len(output) >= limit:
            break
    return output


@dataclass(frozen=True)
class PhotoSourceScopes:
    originals: bool = True
    edited: bool = True
    raw: bool = True
    live_photo_motion: bool = True
    albums_folders: bool = True
    keywords: bool = True
    labels_ocr: bool = True
    extract_detected_text: bool = False
    favorites: bool = True
    people_faces: bool = False
    precise_location: bool = False
    hidden: bool = False
    deleted: bool = False
    shared: bool = False
    comments_likes: bool = False

    @classmethod
    def from_params(cls, params: dict[str, Any] | None) -> "PhotoSourceScopes":
        body = params if isinstance(params, dict) else {}
        nested = body.get("scopes") if isinstance(body.get("scopes"), dict) else body

        def selected(default: bool, *keys: str) -> bool:
            for key in keys:
                if key in nested:
                    return bool(nested.get(key))
            return default

        scopes = cls(
            originals=selected(True, "originals", "includeOriginals"),
            edited=selected(True, "edited", "editedVersions", "includeEdited"),
            raw=selected(True, "raw", "rawCompanions", "includeRaw"),
            live_photo_motion=selected(True, "livePhotoMotion", "live_photo_motion", "includeLivePhotoMotion"),
            albums_folders=selected(True, "albumsFolders", "albums_folders", "albums"),
            keywords=selected(True, "keywords"),
            labels_ocr=selected(True, "labelsOcr", "labels_ocr", "labelsAndOcr"),
            extract_detected_text=selected(False, "extractDetectedText", "extract_detected_text"),
            favorites=selected(True, "favorites"),
            people_faces=selected(False, "peopleFaces", "people_faces", "people"),
            precise_location=selected(False, "preciseLocation", "precise_location", "places"),
            hidden=selected(False, "hidden"),
            deleted=selected(False, "deleted", "recentlyDeleted"),
            shared=selected(False, "shared", "sharedMetadata"),
            comments_likes=selected(False, "commentsLikes", "comments_likes"),
        )
        if not scopes.originals and not scopes.edited:
            raise ValueError("Select original or edited media for photo-source import.")
        sensitive = scopes.selected_sensitive_scopes()
        consent = bool(body.get("sensitiveConsent", body.get("sensitive_consent", False)))
        if sensitive and not consent:
            labels = ", ".join(sorted(sensitive))
            raise ValueError(
                f"Explicit sensitiveConsent is required for these photo-source scopes: {labels}."
            )
        return scopes

    def selected_sensitive_scopes(self) -> set[str]:
        selected: set[str] = set()
        if self.people_faces:
            selected.add("peopleFaces")
        if self.precise_location:
            selected.add("preciseLocation")
        if self.hidden:
            selected.add("hidden")
        if self.deleted:
            selected.add("deleted")
        if self.shared:
            selected.add("shared")
        if self.comments_likes:
            selected.add("commentsLikes")
        return selected

    def to_dict(self) -> dict[str, bool]:
        return {
            "originals": self.originals,
            "edited": self.edited,
            "raw": self.raw,
            "livePhotoMotion": self.live_photo_motion,
            "albumsFolders": self.albums_folders,
            "keywords": self.keywords,
            "labelsOcr": self.labels_ocr,
            "extractDetectedText": self.extract_detected_text,
            "favorites": self.favorites,
            "peopleFaces": self.people_faces,
            "preciseLocation": self.precise_location,
            "hidden": self.hidden,
            "deleted": self.deleted,
            "shared": self.shared,
            "commentsLikes": self.comments_likes,
        }


_LOCATION_METADATA_WORDS = {
    "address", "city", "coordinate", "coordinates", "country", "gps", "latitude",
    "location", "longitude", "place", "postal", "state", "street", "sublocation", "venue",
}
_PEOPLE_METADATA_WORDS = {"face", "faces", "people", "person", "persons", "region", "regions"}
_SHARED_METADATA_WORDS = {"owner", "participant", "participants", "shared", "sharing"}
_COMMENTS_METADATA_WORDS = {"comment", "comments", "like", "likes"}


def _metadata_key_words(value: Any) -> tuple[set[str], str]:
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", str(value or ""))
    parts = [part.casefold() for part in re.split(r"[^A-Za-z0-9]+", text) if part]
    return set(parts), "".join(parts)


def scoped_sensitive_metadata(value: Any, scopes: PhotoSourceScopes) -> Any:
    """Return a JSON-safe value with unselected sensitive metadata removed recursively."""

    def key_is_sensitive(key: Any) -> bool:
        words, compact = _metadata_key_words(key)
        if not scopes.precise_location and (
            words & _LOCATION_METADATA_WORDS or compact.startswith("gps")
        ):
            return True
        if not scopes.people_faces and (
            words & _PEOPLE_METADATA_WORDS
            or compact.startswith(("facerect", "mwgregion", "persondisplay", "regioninfo"))
        ):
            return True
        if not scopes.shared and words & _SHARED_METADATA_WORDS:
            return True
        if not scopes.comments_likes and words & _COMMENTS_METADATA_WORDS:
            return True
        return False

    def visit(item: Any) -> Any:
        if isinstance(item, dict):
            return {
                str(key): visit(nested)
                for key, nested in item.items()
                if not key_is_sensitive(key)
            }
        if isinstance(item, list):
            return [visit(nested) for nested in item]
        return item

    return visit(json_safe(value))


@dataclass
class PhotoSourceLibrary:
    provider: str
    library_id: str
    path: str
    name: str
    available: bool = True
    system_library: bool = False
    last_used: bool = False
    modified_at: str = ""
    photos_version: str = ""
    database_version: str = ""
    status: str = "ready"
    warnings: list[dict[str, str]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "provider": self.provider,
            "libraryId": self.library_id,
            "path": self.path,
            "name": self.name,
            "available": self.available,
            "systemLibrary": self.system_library,
            "lastUsed": self.last_used,
            "modifiedAt": self.modified_at,
            "photosVersion": self.photos_version,
            "databaseVersion": self.database_version,
            "status": self.status,
            "warnings": self.warnings,
            "metadata": self.metadata,
        })


@dataclass
class NormalizedFace:
    face_id: str = ""
    person_id: str = ""
    person_name: str = ""
    region: dict[str, Any] = field(default_factory=dict)
    confidence: float | None = None
    quality: float | None = None
    roll: float | None = None
    pitch: float | None = None
    yaw: float | None = None
    manual: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "faceId": self.face_id,
            "personId": self.person_id,
            "personName": self.person_name,
            "region": self.region,
            "confidence": self.confidence,
            "quality": self.quality,
            "roll": self.roll,
            "pitch": self.pitch,
            "yaw": self.yaw,
            "manual": self.manual,
            "metadata": self.metadata,
        })


@dataclass
class NormalizedPerson:
    person_id: str = ""
    name: str = ""
    display_name: str = ""
    key_asset_id: str = ""
    face_count: int = 0
    favorite: bool = False
    feature_less: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "personId": self.person_id,
            "name": self.name,
            "displayName": self.display_name,
            "keyAssetId": self.key_asset_id,
            "faceCount": self.face_count,
            "favorite": self.favorite,
            "featureLess": self.feature_less,
            "metadata": self.metadata,
        })


@dataclass
class NormalizedAlbum:
    album_id: str
    name: str
    folder_path: list[dict[str, str]] = field(default_factory=list)
    position: int | None = None
    shared: bool = False
    owner: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "albumId": self.album_id,
            "name": self.name,
            "folderPath": self.folder_path,
            "position": self.position,
            "shared": self.shared,
            "owner": self.owner,
            "metadata": self.metadata,
        })


@dataclass
class NormalizedPhotoAsset:
    provider: str
    library_id: str
    external_id: str
    filename: str
    original_filename: str = ""
    original_path: str = ""
    edited_path: str = ""
    raw_path: str = ""
    live_photo_path: str = ""
    edited_live_photo_path: str = ""
    media_kind: str = "image"
    mime_type: str = ""
    width: int | None = None
    height: int | None = None
    duration_ms: int | None = None
    capture_date: str = ""
    original_date: str = ""
    modified_date: str = ""
    added_date: str = ""
    timezone_name: str = ""
    timezone_offset_seconds: int | None = None
    title: str = ""
    caption: str = ""
    favorite: bool = False
    hidden: bool = False
    deleted: bool = False
    deleted_at: str = ""
    shared: bool = False
    missing: bool = False
    cloud_asset: bool = False
    has_adjustments: bool = False
    location: dict[str, Any] = field(default_factory=dict)
    keywords: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    ocr_blocks: list[dict[str, Any]] = field(default_factory=list)
    albums: list[NormalizedAlbum] = field(default_factory=list)
    people: list[NormalizedPerson] = field(default_factory=list)
    faces: list[NormalizedFace] = field(default_factory=list)
    comments: list[dict[str, Any]] = field(default_factory=list)
    likes: list[dict[str, Any]] = field(default_factory=list)
    exif: dict[str, Any] = field(default_factory=dict)
    search: dict[str, Any] = field(default_factory=dict)
    flags: dict[str, Any] = field(default_factory=dict)
    provenance: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)
    unsupported_fields: list[str] = field(default_factory=list)

    def primary_path(self, *, prefer_edited: bool = False) -> str:
        if prefer_edited and self.edited_path:
            return self.edited_path
        return self.original_path or self.edited_path

    def variant_paths(self) -> dict[str, str]:
        return {
            key: value
            for key, value in {
                "original": self.original_path,
                "edited": self.edited_path,
                "raw": self.raw_path,
                "livePhotoMotion": self.live_photo_path,
                "editedLivePhotoMotion": self.edited_live_photo_path,
            }.items()
            if value
        }

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "provider": self.provider,
            "libraryId": self.library_id,
            "externalId": self.external_id,
            "filename": self.filename,
            "originalFilename": self.original_filename,
            "originalPath": self.original_path,
            "editedPath": self.edited_path,
            "rawPath": self.raw_path,
            "livePhotoPath": self.live_photo_path,
            "editedLivePhotoPath": self.edited_live_photo_path,
            "mediaKind": self.media_kind,
            "mimeType": self.mime_type,
            "width": self.width,
            "height": self.height,
            "durationMs": self.duration_ms,
            "captureDate": self.capture_date,
            "originalDate": self.original_date,
            "modifiedDate": self.modified_date,
            "addedDate": self.added_date,
            "timezoneName": self.timezone_name,
            "timezoneOffsetSeconds": self.timezone_offset_seconds,
            "title": self.title,
            "caption": self.caption,
            "favorite": self.favorite,
            "hidden": self.hidden,
            "deleted": self.deleted,
            "deletedAt": self.deleted_at,
            "shared": self.shared,
            "missing": self.missing,
            "cloudAsset": self.cloud_asset,
            "hasAdjustments": self.has_adjustments,
            "location": self.location,
            "keywords": self.keywords,
            "labels": self.labels,
            "ocrBlocks": self.ocr_blocks,
            "albums": [album.to_dict() for album in self.albums],
            "people": [person.to_dict() for person in self.people],
            "faces": [face.to_dict() for face in self.faces],
            "comments": self.comments,
            "likes": self.likes,
            "exif": self.exif,
            "search": self.search,
            "flags": self.flags,
            "provenance": self.provenance,
            "metadata": self.metadata,
            "unsupportedFields": self.unsupported_fields,
        })

    def sync_signature(self) -> str:
        payload = self.to_dict()
        payload.pop("unsupportedFields", None)
        encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        return sha256(encoded).hexdigest()


@dataclass
class PhotoSourcePreview:
    provider: str
    library: PhotoSourceLibrary
    scopes: PhotoSourceScopes
    counts: dict[str, int]
    samples: list[dict[str, Any]]
    scanned_count: int
    complete: bool
    elapsed_ms: int
    warnings: list[dict[str, str]] = field(default_factory=list)
    unsupported_fields: list[str] = field(default_factory=list)
    capabilities: dict[str, bool] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return json_safe({
            "provider": self.provider,
            "library": self.library.to_dict(),
            "scopes": self.scopes.to_dict(),
            "counts": self.counts,
            "samples": self.samples,
            "scannedCount": self.scanned_count,
            "complete": self.complete,
            "elapsedMs": self.elapsed_ms,
            "warnings": self.warnings,
            "unsupportedFields": self.unsupported_fields,
            "capabilities": self.capabilities,
        })

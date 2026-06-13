from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any
import json
import os
import shutil
import time
import zipfile
from urllib.request import Request, urlopen

from PIL import Image

from crossage_fr.ingest.image_io import IMAGE_EXTENSIONS, sha256_file
from crossage_fr.ingest.video_io import VIDEO_EXTENSIONS
from crossage_fr.storage import safe_resolve


CFP_DATASET_URL = "http://www.cfpw.io/cfp-dataset.zip"
CFP_DATASET_SHA256 = "666b87635e6af028177ac72a85f03099fac263baf09c21f333fa445f930f65b1"
CFP_DATASET_BYTES = 86_312_557


@dataclass(frozen=True)
class IdentityMedia:
    identity: str
    folder: Path
    images: tuple[Path, ...]
    videos: tuple[Path, ...]


GENERIC_DATASET_CONTAINER_NAMES = {
    "aligned",
    "data",
    "dataset",
    "dev",
    "files",
    "funneled",
    "images",
    "img",
    "imgs",
    "lfw",
    "lfw_funneled",
    "media",
    "photos",
    "protocol",
    "protocols",
    "raw",
    "test",
    "testing",
    "train",
    "training",
    "val",
    "valid",
    "validation",
}

MEDIA_BUCKET_DIR_NAMES = {
    "0",
    "1",
    "2",
    "3",
    "age",
    "ages",
    "aged",
    "adult",
    "center",
    "face",
    "faces",
    "frontal",
    "front",
    "middle",
    "old",
    "left",
    "older",
    "profile",
    "profile_left",
    "profile_right",
    "right",
    "senior",
    "side",
    "side_profile",
    "teen",
    "video_frames",
    "young",
    "younger",
}


PUBLIC_DATASET_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "datasetId": "lfw",
        "name": "Labeled Faces in the Wild",
        "shortName": "LFW",
        "bestFor": ["baseline", "identity clustering", "quick regression"],
        "scale": {"images": 13233, "identities": 5749, "videos": 0},
        "inputMode": "auto-or-folder",
        "layout": "identity folders or scikit-learn fetch",
        "download": {
            "available": True,
            "method": "sklearn.datasets.fetch_lfw_people",
            "requiresConfirmation": True,
        },
        "sourceUrl": "https://scikit-learn.org/stable/modules/generated/sklearn.datasets.fetch_lfw_people.html",
        "terms": "Research benchmark. Do not use as app training data or redistribute downloaded images from this app.",
        "recommendedUse": "Fast local smoke benchmark and threshold sanity check.",
    },
    {
        "datasetId": "vggface2",
        "name": "VGGFace2",
        "shortName": "VGGFace2",
        "bestFor": ["large scale", "pose", "age", "illumination"],
        "scale": {"images": 3310000, "identities": 9131, "videos": 0},
        "inputMode": "local-folder",
        "layout": "identity folders",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://github.com/ox-vgg/vgg_face2",
        "terms": "Large biometric dataset; verify access and redistribution terms before use.",
        "recommendedUse": "High-scale accuracy and throughput testing from a local copy.",
    },
    {
        "datasetId": "calfw",
        "name": "Cross-Age LFW",
        "shortName": "CALFW",
        "bestFor": ["cross-age", "same identity across age", "threshold stress"],
        "scale": {"images": 12174, "identities": 4025, "videos": 0},
        "inputMode": "local-folder",
        "layout": "LFW-style identity folders, optionally with young|old age buckets or protocol exports",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://whdeng.cn/CALFW/",
        "terms": "Research benchmark derived from LFW; verify access and redistribution terms before use.",
        "recommendedUse": "Cross-age recall validation and multi-age reference tuning.",
    },
    {
        "datasetId": "cplfw",
        "name": "Cross-Pose LFW",
        "shortName": "CPLFW",
        "bestFor": ["cross-pose", "side-profile", "pose-aware models"],
        "scale": {"images": 11652, "identities": 3930, "videos": 0},
        "inputMode": "local-folder",
        "layout": "LFW-style identity folders, optionally with frontal|profile pose buckets or protocol exports",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://whdeng.cn/CPLFW/",
        "terms": "Research benchmark derived from LFW; verify access and redistribution terms before use.",
        "recommendedUse": "Profile and cross-pose recall validation after detector/model changes.",
    },
    {
        "datasetId": "agedb",
        "name": "AgeDB",
        "shortName": "AgeDB",
        "bestFor": ["cross-age", "age gaps", "threshold stress"],
        "scale": {"images": 16488, "identities": 568, "videos": 0},
        "inputMode": "local-folder",
        "layout": "identity folders or classwise export",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://openaccess.thecvf.com/content_cvpr_2017_workshops/w33/papers/Moschoglou_AgeDB_The_First_CVPR_2017_paper.pdf",
        "terms": "Research benchmark; verify local copy terms before use.",
        "recommendedUse": "Cross-age validation and false-negative analysis.",
    },
    {
        "datasetId": "cfp",
        "name": "Celebrities in Frontal-Profile",
        "shortName": "CFP",
        "bestFor": ["frontal-profile", "pose", "side-profile"],
        "scale": {"images": 7000, "identities": 500, "videos": 0},
        "inputMode": "auto-or-folder",
        "layout": "Data/Images/<identity>/frontal|profile folders or identity folders",
        "download": {
            "available": True,
            "method": "official cfp-dataset.zip",
            "url": CFP_DATASET_URL,
            "sha256": CFP_DATASET_SHA256,
            "bytes": CFP_DATASET_BYTES,
            "requiresConfirmation": True,
        },
        "sourceUrl": "https://www.cfpw.io/",
        "terms": "Research benchmark; verify local copy terms before use.",
        "recommendedUse": "Pose robustness and profile-face validation.",
    },
    {
        "datasetId": "ytf",
        "name": "YouTube Faces",
        "shortName": "YTF",
        "bestFor": ["video", "frame extraction", "motion blur"],
        "scale": {"images": 0, "identities": 1595, "videos": 3425},
        "inputMode": "local-folder",
        "layout": "identity folders with videos, optionally image references",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://www.cs.tau.ac.il/~wolf/ytfaces/",
        "terms": "Video benchmark; verify local copy terms before use.",
        "recommendedUse": "Video decode and video-frame matching validation.",
    },
    {
        "datasetId": "fiw",
        "name": "Families in the Wild",
        "shortName": "FIW",
        "bestFor": ["family lookalikes", "hard negatives", "kinship"],
        "scale": {"images": 11932, "identities": 1000, "videos": 0},
        "inputMode": "local-folder",
        "layout": "identity or family folders",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://fulab.sites.northeastern.edu/5524-2/",
        "terms": "Research benchmark; verify local copy terms before use.",
        "recommendedUse": "Family-lookalike false-positive analysis.",
    },
    {
        "datasetId": "megaface",
        "name": "MegaFace",
        "shortName": "MegaFace",
        "bestFor": ["large scale", "distractors", "throughput"],
        "scale": {"images": 4700000, "identities": 672000, "videos": 0},
        "inputMode": "local-folder",
        "layout": "identity folders or benchmark export with many distractor identities",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://megaface.cs.washington.edu/",
        "terms": "Large biometric benchmark; verify access, storage, and redistribution terms before use.",
        "recommendedUse": "Million-file indexing, distractor scaling, and false-positive pressure testing.",
    },
    {
        "datasetId": "ijbc",
        "name": "IARPA Janus Benchmark-C",
        "shortName": "IJB-C",
        "bestFor": ["mixed media", "templates", "hard pose", "video"],
        "scale": {"images": 31334, "identities": 3531, "videos": 11779},
        "inputMode": "local-folder",
        "layout": "identity folders or prepared template export with images and videos",
        "download": {"available": False, "method": "obtain from official/project-approved source"},
        "sourceUrl": "https://www.nist.gov/programs-projects/face-challenges",
        "terms": "Restricted benchmark; use only with proper access approval and local copies.",
        "recommendedUse": "Mixed still/video robustness and hard-pose production-readiness validation.",
    },
)


def public_dataset_catalog() -> dict[str, Any]:
    return {
        "generatedAt": _now_iso(),
        "datasets": [dict(item) for item in PUBLIC_DATASET_CATALOG],
        "policy": {
            "training": "disabled",
            "defaultUse": "benchmark-only",
            "privacy": "Public datasets are evaluated in isolated benchmark workspaces and are not added to the user's saved people unless explicitly imported.",
        },
    }


def inspect_identity_dataset(
    folder: Path,
    *,
    dataset_id: str = "custom",
    max_identities: int = 25000,
    entry_budget: int = 1_000_000,
    include_videos: bool = True,
) -> dict[str, Any]:
    root = safe_resolve(folder)
    started = time.monotonic()
    identities, truncated, entries_checked = identity_media_index(
        root,
        max_identities=max_identities,
        entry_budget=entry_budget,
        include_videos=include_videos,
    )
    image_count = sum(len(item.images) for item in identities)
    video_count = sum(len(item.videos) for item in identities)
    usable = [item for item in identities if len(item.images) >= 2]
    video_usable = [item for item in identities if item.images and item.videos]
    recommendations: list[str] = []
    if not identities:
        recommendations.append("No identity folders with supported media were found.")
    if len(usable) < 2:
        recommendations.append("Use a dataset layout with at least two identity folders and at least two images per identity.")
    if truncated:
        recommendations.append("Inspection stopped at the entry budget; raise the budget for a complete count.")
    if video_count and not video_usable:
        recommendations.append("Video-only datasets need image references per identity before the identity benchmark can score video clips.")
    if not recommendations:
        recommendations.append("Dataset folder is ready for an isolated benchmark run.")
    return {
        "generatedAt": _now_iso(),
        "datasetId": dataset_id,
        "folder": str(root),
        "exists": root.exists(),
        "identityCount": len(identities),
        "usableIdentityCount": len(usable),
        "imageCount": image_count,
        "videoCount": video_count,
        "entriesChecked": entries_checked,
        "truncated": truncated,
        "durationMs": round((time.monotonic() - started) * 1000, 2),
        "samples": [
            {
                "identity": item.identity,
                "images": len(item.images),
                "videos": len(item.videos),
                "folder": str(item.folder),
            }
            for item in identities[:12]
        ],
        "recommendations": recommendations,
    }


def identity_media_index(
    folder: Path,
    *,
    max_identities: int = 25000,
    entry_budget: int = 1_000_000,
    include_videos: bool = True,
) -> tuple[list[IdentityMedia], bool, int]:
    root = safe_resolve(folder)
    if not root.exists() or not root.is_dir() or root.is_symlink():
        return [], False, 0
    media_extensions = set(IMAGE_EXTENSIONS)
    if include_videos:
        media_extensions |= set(VIDEO_EXTENSIONS)
    identities: list[IdentityMedia] = []
    entries_checked = 0
    truncated = False
    try:
        identity_entries = _discover_identity_entries(root, media_extensions)
    except OSError:
        return [], False, 0
    for identity_label, identity_dir in identity_entries:
        if len(identities) >= max_identities or entries_checked >= entry_budget:
            truncated = True
            break
        images: list[Path] = []
        videos: list[Path] = []
        try:
            walker = os.walk(identity_dir)
            for current, dirnames, filenames in walker:
                dirnames[:] = sorted(dirname for dirname in dirnames if not dirname.startswith("."))
                for filename in sorted(filenames):
                    entries_checked += 1
                    if entries_checked > entry_budget:
                        truncated = True
                        break
                    path = Path(current) / filename
                    suffix = path.suffix.lower()
                    if suffix in IMAGE_EXTENSIONS:
                        images.append(path)
                    elif include_videos and suffix in VIDEO_EXTENSIONS:
                        videos.append(path)
                if truncated:
                    break
        except OSError:
            continue
        if images or videos:
            identities.append(
                IdentityMedia(
                    identity=_clean_identity(identity_label),
                    folder=identity_dir,
                    images=tuple(sorted(images, key=lambda item: str(item).casefold())),
                    videos=tuple(sorted(videos, key=lambda item: str(item).casefold())),
                )
            )
        if truncated:
            break
    return identities, truncated, entries_checked


def _discover_identity_entries(root: Path, media_extensions: set[str]) -> list[tuple[str, Path]]:
    entries = _discover_identity_entries_from(root, media_extensions, depth=0)
    deduped: dict[Path, str] = {}
    for label, folder in entries:
        deduped.setdefault(folder, label)
    return sorted(((label, folder) for folder, label in deduped.items()), key=lambda item: (item[0].casefold(), str(item[1]).casefold()))


def _discover_identity_entries_from(root: Path, media_extensions: set[str], *, depth: int) -> list[tuple[str, Path]]:
    entries: list[tuple[str, Path]] = []
    child_dirs = _child_dirs(root)
    for child in child_dirs:
        direct_media = _has_direct_media(child, media_extensions)
        nested_dirs = _child_dirs(child)
        if direct_media or not nested_dirs:
            entries.append((child.name, child))
            continue
        parent_name = child.name.casefold()
        if _is_media_bucket_identity(child, nested_dirs, media_extensions):
            entries.append((child.name, child))
            continue
        if parent_name in GENERIC_DATASET_CONTAINER_NAMES and depth < 6:
            entries.extend(_discover_identity_entries_from(child, media_extensions, depth=depth + 1))
            continue
        for nested in nested_dirs:
            label = nested.name if parent_name in GENERIC_DATASET_CONTAINER_NAMES else f"{child.name}__{nested.name}"
            entries.append((label, nested))
    return entries


def _is_media_bucket_identity(folder: Path, nested_dirs: list[Path], media_extensions: set[str]) -> bool:
    if not nested_dirs:
        return False
    if not all(nested.name.casefold() in MEDIA_BUCKET_DIR_NAMES for nested in nested_dirs):
        return False
    return any(_has_media_within(nested, media_extensions, max_depth=2, entry_budget=250) for nested in nested_dirs)


def _child_dirs(folder: Path) -> list[Path]:
    try:
        return sorted(
            (Path(entry.path) for entry in os.scandir(folder) if not entry.name.startswith(".") and entry.is_dir(follow_symlinks=False)),
            key=lambda item: item.name.casefold(),
        )
    except OSError:
        return []


def _has_direct_media(folder: Path, media_extensions: set[str]) -> bool:
    try:
        for entry in os.scandir(folder):
            if entry.name.startswith(".") or not entry.is_file(follow_symlinks=False):
                continue
            if Path(entry.name).suffix.lower() in media_extensions:
                return True
    except OSError:
        return False
    return False


def _has_media_within(folder: Path, media_extensions: set[str], *, max_depth: int, entry_budget: int) -> bool:
    stack: list[tuple[Path, int]] = [(folder, 0)]
    checked = 0
    while stack and checked < entry_budget:
        current, depth = stack.pop()
        try:
            with os.scandir(current) as iterator:
                for entry in iterator:
                    if entry.name.startswith("."):
                        continue
                    checked += 1
                    if checked >= entry_budget:
                        break
                    if entry.is_file(follow_symlinks=False) and Path(entry.name).suffix.lower() in media_extensions:
                        return True
                    if depth < max_depth and entry.is_dir(follow_symlinks=False):
                        stack.append((Path(entry.path), depth + 1))
        except OSError:
            continue
    return False


def prepare_lfw_subset(
    output_root: Path,
    *,
    max_identities: int = 25,
    images_per_identity: int = 4,
    min_faces_per_person: int = 2,
    download_if_missing: bool = True,
) -> dict[str, Any]:
    try:
        import numpy as np
        from sklearn.datasets import fetch_lfw_people
    except Exception as exc:
        raise RuntimeError("LFW download requires scikit-learn and numpy in the Python environment.") from exc

    output = output_root.expanduser().resolve()
    dataset_folder = output / "lfw-selected"
    dataset_folder.mkdir(parents=True, exist_ok=True)
    fetched = fetch_lfw_people(
        data_home=str(output / "sklearn-cache"),
        color=True,
        resize=1.0,
        min_faces_per_person=max(2, int(min_faces_per_person)),
        download_if_missing=bool(download_if_missing),
    )
    target_names = [str(name).replace("_", " ") for name in fetched.target_names]
    original_root = output / "sklearn-cache" / "lfw_home" / "lfw_funneled"
    grouped: dict[int, list[Any]] = {}
    for index, target in enumerate(fetched.target):
        grouped.setdefault(int(target), []).append(fetched.images[index])
    original_groups: dict[int, list[Path]] = {}
    if original_root.exists():
        for target, target_name in enumerate(target_names):
            source_dir = _lfw_original_identity_dir(original_root, target_name)
            if source_dir is not None:
                original_groups[target] = sorted(source_dir.glob("*.jpg"), key=lambda item: item.name.casefold())
    written = 0
    identities = 0
    original_images_used = 0
    cropped_arrays_used = 0
    for target, images in sorted(grouped.items(), key=lambda item: target_names[item[0]].casefold()):
        if identities >= max_identities:
            break
        selected_originals = original_groups.get(target, [])[: max(2, int(images_per_identity))]
        selected_arrays = images[: max(2, int(images_per_identity))]
        if len(selected_originals) >= 2:
            selected: list[Path | Any] = list(selected_originals)
        else:
            selected = list(selected_arrays)
        if len(selected) < 2:
            continue
        identity_name = _clean_identity(target_names[target])
        identity_dir = dataset_folder / identity_name
        if identity_dir.exists():
            shutil.rmtree(identity_dir)
        identity_dir.mkdir(parents=True, exist_ok=True)
        for image_index, selected_image in enumerate(selected, start=1):
            destination = identity_dir / f"{image_index:03d}.jpg"
            if isinstance(selected_image, Path):
                with Image.open(selected_image) as image:
                    image.convert("RGB").save(destination, quality=94)
                original_images_used += 1
            else:
                array = np.asarray(selected_image)
                if array.dtype != np.uint8:
                    array = np.clip(array, 0, 255).astype("uint8")
                Image.fromarray(array).convert("RGB").save(destination, quality=92)
                cropped_arrays_used += 1
            written += 1
        identities += 1
    manifest = {
        "generatedAt": _now_iso(),
        "datasetId": "lfw",
        "folder": str(dataset_folder),
        "identities": identities,
        "images": written,
        "source": "sklearn.datasets.fetch_lfw_people",
        "sourceImageMode": "lfw_funneled_originals" if original_images_used else "sklearn_cropped_arrays",
        "originalImagesUsed": original_images_used,
        "croppedArraysUsed": cropped_arrays_used,
        "downloadedOrLoaded": True,
    }
    (output / "lfw-selected-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def prepare_cfp_dataset(
    output_root: Path,
    *,
    download_if_missing: bool = True,
) -> dict[str, Any]:
    output = output_root.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / "cfp-dataset.zip"
    dataset_root = output / "cfp-dataset"
    images_root = dataset_root / "Data" / "Images"
    downloaded = False
    extracted = False
    if not archive.exists():
        if not download_if_missing:
            raise RuntimeError("CFP dataset archive is not cached. Enable download or choose a local CFP folder.")
        _download_file(CFP_DATASET_URL, archive, expected_bytes=CFP_DATASET_BYTES)
        downloaded = True
    _validate_archive(archive, expected_sha256=CFP_DATASET_SHA256, expected_bytes=CFP_DATASET_BYTES)
    if not images_root.exists():
        _safe_extract_zip(archive, output)
        extracted = True
    if not images_root.exists() or not images_root.is_dir():
        raise RuntimeError("CFP archive extracted, but Data/Images was not found.")
    identities, truncated, entries_checked = identity_media_index(
        images_root,
        max_identities=1000,
        entry_budget=25_000,
        include_videos=False,
    )
    image_count = sum(len(item.images) for item in identities)
    manifest = {
        "generatedAt": _now_iso(),
        "datasetId": "cfp",
        "folder": str(images_root),
        "archive": str(archive),
        "source": CFP_DATASET_URL,
        "sha256": CFP_DATASET_SHA256,
        "bytes": CFP_DATASET_BYTES,
        "identities": len(identities),
        "images": image_count,
        "entriesChecked": entries_checked,
        "truncated": truncated,
        "downloaded": downloaded,
        "extracted": extracted,
    }
    (output / "cfp-dataset-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _lfw_original_identity_dir(root: Path, identity_name: str) -> Path | None:
    candidates = [
        identity_name,
        identity_name.replace(" ", "_"),
        identity_name.replace("_", " "),
    ]
    seen: set[str] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        path = root / candidate
        if path.exists() and path.is_dir():
            return path
    return None


def materialize_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def _download_file(url: str, destination: Path, *, expected_bytes: int) -> None:
    temp = destination.with_suffix(destination.suffix + ".partial")
    temp.unlink(missing_ok=True)
    request = Request(url, headers={"User-Agent": "Vintrace benchmark downloader"})
    with urlopen(request, timeout=90) as response, temp.open("wb") as handle:
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > expected_bytes + 1024 * 1024:
                raise RuntimeError("Downloaded CFP archive is larger than expected.")
            handle.write(chunk)
    if temp.stat().st_size != expected_bytes:
        temp.unlink(missing_ok=True)
        raise RuntimeError("Downloaded CFP archive size did not match the official manifest.")
    temp.replace(destination)


def _validate_archive(archive: Path, *, expected_sha256: str, expected_bytes: int) -> None:
    if not archive.exists():
        raise RuntimeError(f"Archive does not exist: {archive}")
    actual_bytes = archive.stat().st_size
    if actual_bytes != expected_bytes:
        raise RuntimeError(f"Archive size mismatch for {archive.name}: expected {expected_bytes}, got {actual_bytes}.")
    actual_sha256 = sha256_file(archive)
    if actual_sha256.lower() != expected_sha256.lower():
        raise RuntimeError(f"Archive checksum mismatch for {archive.name}.")


def _safe_extract_zip(archive: Path, destination_root: Path) -> None:
    destination = destination_root.resolve()
    with zipfile.ZipFile(archive) as handle:
        for member in handle.infolist():
            target = (destination / member.filename).resolve()
            if os.path.commonpath([str(destination), str(target)]) != str(destination):
                raise RuntimeError(f"Unsafe zip member path: {member.filename}")
        handle.extractall(destination)


def _clean_identity(value: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in {" ", "-", "_", "."} else "_" for char in value).strip(" ._-")
    return cleaned[:120] or "unknown"


def _now_iso() -> str:
    from datetime import datetime

    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

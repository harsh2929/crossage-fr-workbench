from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
import argparse
import io
import json
import re
import shutil
import sys
import tarfile
import zipfile


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


DATASET_SPECS = {
    "agedb": {
        "name": "AgeDB",
        "archive": Path("benchmarks/public-data/downloads/AgeDB.zip"),
        "imagePrefixes": ("AgeDB/",),
        "identityParser": "agedb",
        "preserveFilenames": True,
        "sort": "age-span-desc",
        "sourceUrl": "https://ibug.doc.ic.ac.uk/resources/agedb/",
    },
    "calfw": {
        "name": "Cross-Age LFW",
        "archive": Path("benchmarks/public-data/downloads/calfw.zip"),
        "imagePrefixes": ("calfw/aligned images/",),
        "sourceUrl": "http://whdeng.cn/CALFW/",
    },
    "cfp": {
        "name": "Celebrities in Frontal-Profile",
        "kind": "cfp",
        "outputFolder": Path("benchmarks/public-data/prepared/cfp"),
        "sourceUrl": "https://www.cfpw.io/",
    },
    "cplfw": {
        "name": "Cross-Pose LFW",
        "archive": Path("benchmarks/public-data/downloads/cplfw.zip"),
        "imagePrefixes": ("cplfw/aligned images/",),
        "sourceUrl": "http://whdeng.cn/CPLFW/",
    },
    "fiw": {
        "name": "Families in the Wild",
        "archive": Path("benchmarks/public-data/downloads/recognizing-faces-in-the-wild.zip"),
        "innerArchive": "train-faces.zip",
        "identityParser": "fiw",
        "layout": "family-person-folders",
        "sort": "image-count-desc",
        "sourceUrl": "https://fulab.sites.northeastern.edu/fiw-download/",
    },
    "ytf": {
        "name": "YouTube Faces",
        "kind": "ytf-aligned-tar",
        "archive": Path("benchmarks/public-data/downloads/aligned_images_DB.tar.gz"),
        "metaArchive": Path("benchmarks/public-data/downloads/meta_data.tar.gz"),
        "outputFolder": Path("benchmarks/public-data/prepared/ytf"),
        "sourceUrl": "https://www.cs.tau.ac.il/~wolf/ytfaces/",
    },
}


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare deterministic public benchmark slices from official dataset archives.")
    parser.add_argument("datasets", nargs="*", default=["calfw", "cplfw"], choices=sorted(DATASET_SPECS))
    parser.add_argument("--output", default="benchmarks/public-data/prepared")
    parser.add_argument("--max-identities", type=int, default=32)
    parser.add_argument("--images-per-identity", type=int, default=4)
    parser.add_argument("--extra-identities", type=int, default=8, help="Extra identities available as distractors.")
    parser.add_argument("--force", action="store_true", help="Replace an existing prepared slice.")
    args = parser.parse_args()

    output_root = Path(args.output).expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    manifests: list[dict[str, object]] = []
    for dataset_id in args.datasets:
        manifests.append(
            prepare_dataset_slice(
                dataset_id,
                output_root=output_root,
                max_identities=max(2, int(args.max_identities)),
                images_per_identity=max(2, int(args.images_per_identity)),
                extra_identities=max(0, int(args.extra_identities)),
                force=bool(args.force),
            )
        )
    print(json.dumps({"generatedAt": _now_iso(), "slices": manifests}, indent=2))


def prepare_dataset_slice(
    dataset_id: str,
    *,
    output_root: Path,
    max_identities: int,
    images_per_identity: int,
    extra_identities: int,
    force: bool,
) -> dict[str, object]:
    spec = DATASET_SPECS[dataset_id]
    if spec.get("kind") == "cfp":
        return _prepare_cfp(spec, force=force)
    if spec.get("kind") == "ytf-aligned-tar":
        return _prepare_ytf_aligned(
            spec,
            output_root=output_root,
            max_identities=max_identities,
            images_per_identity=images_per_identity,
            extra_identities=extra_identities,
            force=force,
        )
    archive = Path(spec["archive"]).expanduser().resolve()
    if not archive.exists():
        raise FileNotFoundError(f"Dataset archive is missing: {archive}")
    slice_name = f"{dataset_id}-{max_identities + extra_identities}x{images_per_identity}"
    dataset_folder = output_root / slice_name
    manifest_path = output_root / f"{slice_name}-manifest.json"
    if dataset_folder.exists() and not force:
        manifest = _load_manifest(manifest_path)
        if manifest:
            return {**manifest, "status": "cached"}
        raise RuntimeError(f"Prepared folder exists without a manifest: {dataset_folder}. Use --force to rebuild it.")
    if dataset_folder.exists():
        shutil.rmtree(dataset_folder)
    dataset_folder.mkdir(parents=True, exist_ok=True)

    groups = _zip_identity_groups(archive, spec)
    required_identities = max_identities + extra_identities
    selected = [
        (identity, _select_members(spec, members, images_per_identity))
        for identity, members in sorted(groups.items(), key=lambda item: _selection_key(spec, item[0], item[1]))
        if len(members) >= images_per_identity
    ][:required_identities]
    if len(selected) < max_identities:
        shutil.rmtree(dataset_folder, ignore_errors=True)
        raise RuntimeError(
            f"{dataset_id} slice needs {max_identities} identities with {images_per_identity} images each; found {len(selected)}."
        )

    selected_manifest: list[dict[str, object]] = []
    image_count = 0
    with _open_image_archive(archive, spec) as handle:
        for identity_index, (identity, members) in enumerate(selected, start=1):
            identity_folder = _identity_folder(dataset_folder, identity_index, identity, spec)
            folder_name = str(identity_folder.relative_to(dataset_folder))
            identity_folder.mkdir(parents=True, exist_ok=True)
            written_members: list[str] = []
            for image_index, member in enumerate(members, start=1):
                source_name = PurePosixPath(member).name
                filename = _safe_file_name(source_name) if spec.get("preserveFilenames") else f"{image_index:03d}-{_safe_file_name(source_name)}"
                destination = identity_folder / filename
                with handle.open(member) as source, destination.open("wb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
                written_members.append(member)
                image_count += 1
            selected_manifest.append(
                {
                    "identity": identity,
                    "folder": folder_name,
                    "images": len(written_members),
                    "members": written_members,
                    "role": "positive" if identity_index <= max_identities else "distractor",
                }
            )

    manifest = {
        "status": "prepared",
        "generatedAt": _now_iso(),
        "datasetId": dataset_id,
        "datasetName": spec["name"],
        "folder": str(dataset_folder),
        "archive": str(archive),
        "sourceUrl": spec["sourceUrl"],
        "identityCount": len(selected),
        "positiveIdentities": max_identities,
        "extraIdentities": max(0, len(selected) - max_identities),
        "imagesPerIdentity": images_per_identity,
        "imageCount": image_count,
        "imagePrefixes": list(spec.get("imagePrefixes", ())),
        "innerArchive": spec.get("innerArchive", ""),
        "identities": selected_manifest,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _prepare_cfp(spec: dict[str, object], *, force: bool) -> dict[str, object]:
    from crossage_fr.dataset_benchmarks import prepare_cfp_dataset

    output = Path(spec["outputFolder"]).expanduser().resolve()
    if force and output.exists():
        shutil.rmtree(output)
    manifest = prepare_cfp_dataset(output, download_if_missing=True)
    return {
        "status": "prepared",
        "generatedAt": _now_iso(),
        "datasetId": "cfp",
        "datasetName": spec["name"],
        "sourceUrl": spec["sourceUrl"],
        **manifest,
    }


def _prepare_ytf_aligned(
    spec: dict[str, object],
    *,
    output_root: Path,
    max_identities: int,
    images_per_identity: int,
    extra_identities: int,
    force: bool,
) -> dict[str, object]:
    archive = Path(spec["archive"]).expanduser().resolve()
    meta_archive = Path(spec.get("metaArchive", "")).expanduser().resolve() if spec.get("metaArchive") else None
    if not archive.exists():
        raise FileNotFoundError(f"YTF aligned image archive is missing: {archive}")
    dataset_folder = Path(spec.get("outputFolder") or (output_root / "ytf")).expanduser().resolve()
    manifest_path = output_root / "ytf-manifest.json"
    if dataset_folder.exists() and not force:
        manifest = _load_manifest(manifest_path)
        if manifest:
            return {**manifest, "status": "cached"}
        raise RuntimeError(f"Prepared YTF folder exists without a manifest: {dataset_folder}. Use --force to rebuild it.")
    if dataset_folder.exists():
        shutil.rmtree(dataset_folder)
    dataset_folder.mkdir(parents=True, exist_ok=True)

    required_identities = max_identities + extra_identities
    selected = _ytf_aligned_members(archive, required_identities=required_identities, images_per_identity=images_per_identity)
    if len(selected) < max_identities:
        shutil.rmtree(dataset_folder, ignore_errors=True)
        raise RuntimeError(
            f"YTF slice needs {max_identities} identities with {images_per_identity} aligned frames each; found {len(selected)}."
        )
    selected_names = {member for members in selected.values() for member in members}
    copied = 0
    selected_manifest: list[dict[str, object]] = []
    identity_folders: dict[str, Path] = {}
    for identity_index, identity in enumerate(selected, start=1):
        identity_folder = dataset_folder / f"{identity_index:04d}-{_safe_folder_name(identity)}"
        identity_folder.mkdir(parents=True, exist_ok=True)
        identity_folders[identity] = identity_folder
        selected_manifest.append(
            {
                "identity": identity,
                "folder": str(identity_folder.relative_to(dataset_folder)),
                "images": len(selected[identity]),
                "members": selected[identity],
                "role": "positive" if identity_index <= max_identities else "distractor",
            }
        )

    with tarfile.open(archive, mode="r:gz") as handle:
        for info in handle:
            if copied >= len(selected_names):
                break
            name = info.name.replace("\\", "/")
            if name not in selected_names or not info.isfile():
                continue
            parsed = _ytf_parse_aligned_member(name)
            if parsed is None:
                continue
            identity, video_id = parsed
            source = handle.extractfile(info)
            if source is None:
                continue
            identity_folder = identity_folders.get(identity)
            if identity_folder is None:
                continue
            destination = identity_folder / f"video-{_safe_folder_name(video_id)}-{_safe_file_name(PurePosixPath(name).name)}"
            with source, destination.open("wb") as target:
                shutil.copyfileobj(source, target, length=1024 * 1024)
            copied += 1

    if copied < len(selected_names):
        shutil.rmtree(dataset_folder, ignore_errors=True)
        raise RuntimeError(f"YTF preparation copied {copied} of {len(selected_names)} selected aligned frames.")
    meta_available = bool(meta_archive and meta_archive.exists())
    manifest = {
        "status": "prepared",
        "generatedAt": _now_iso(),
        "datasetId": "ytf",
        "datasetName": spec["name"],
        "folder": str(dataset_folder),
        "archive": str(archive),
        "metaArchive": str(meta_archive) if meta_archive else "",
        "metaAvailable": meta_available,
        "metaMembers": _tar_members(meta_archive, limit=20) if meta_available and meta_archive else [],
        "sourceUrl": spec["sourceUrl"],
        "identityCount": len(selected),
        "positiveIdentities": max_identities,
        "extraIdentities": max(0, len(selected) - max_identities),
        "imagesPerIdentity": images_per_identity,
        "imageCount": copied,
        "layout": "aligned_images_DB/<identity>/<video-id>/<aligned-frame>.jpg",
        "identities": selected_manifest,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def _ytf_aligned_members(archive: Path, *, required_identities: int, images_per_identity: int) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = {}
    per_video_counts: dict[tuple[str, str], int] = {}
    completed: set[str] = set()
    per_video_cap = max(1, min(images_per_identity, (images_per_identity + 1) // 2))
    with tarfile.open(archive, mode="r:gz") as handle:
        for info in handle:
            if len(completed) >= required_identities:
                break
            if not info.isfile():
                continue
            name = info.name.replace("\\", "/")
            parsed = _ytf_parse_aligned_member(name)
            if parsed is None:
                continue
            identity, video_id = parsed
            if identity in completed:
                continue
            members = groups.setdefault(identity, [])
            if len(members) >= images_per_identity:
                completed.add(identity)
                continue
            key = (identity, video_id)
            if per_video_counts.get(key, 0) >= per_video_cap:
                continue
            members.append(name)
            per_video_counts[key] = per_video_counts.get(key, 0) + 1
            if len(members) >= images_per_identity:
                completed.add(identity)
    selected = {
        identity: members[:images_per_identity]
        for identity, members in groups.items()
        if len(members) >= images_per_identity
    }
    return dict(list(selected.items())[:required_identities])


def _ytf_parse_aligned_member(member: str) -> tuple[str, str] | None:
    parts = PurePosixPath(member).parts
    if len(parts) < 4:
        return None
    if parts[0] != "aligned_images_DB":
        return None
    if PurePosixPath(member).suffix.lower() not in IMAGE_EXTENSIONS:
        return None
    identity = parts[1].strip()
    video_id = parts[2].strip()
    if not identity or not video_id:
        return None
    return identity, video_id


def _tar_members(archive: Path, *, limit: int) -> list[str]:
    members: list[str] = []
    try:
        with tarfile.open(archive, mode="r:gz") as handle:
            for info in handle:
                members.append(info.name)
                if len(members) >= limit:
                    break
    except (OSError, tarfile.TarError):
        return []
    return members


def _open_image_archive(archive: Path, spec: dict[str, object]) -> zipfile.ZipFile:
    inner_archive = str(spec.get("innerArchive") or "")
    if not inner_archive:
        return zipfile.ZipFile(archive)
    outer = zipfile.ZipFile(archive)
    try:
        inner_bytes = outer.read(inner_archive)
    finally:
        outer.close()
    return zipfile.ZipFile(io.BytesIO(inner_bytes))


def _zip_identity_groups(archive: Path, spec: dict[str, object]) -> dict[str, list[str]]:
    prefixes = tuple(str(prefix) for prefix in spec.get("imagePrefixes", ()))
    normalized_prefixes = tuple(prefix.lower().replace("\\", "/") for prefix in prefixes)
    groups: dict[str, list[str]] = {}
    with _open_image_archive(archive, spec) as handle:
        for info in handle.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            lowered = name.lower()
            if normalized_prefixes and not any(lowered.startswith(prefix) for prefix in normalized_prefixes):
                continue
            if PurePosixPath(name).suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            if "/__macosx/" in f"/{lowered}" or "/." in f"/{lowered}":
                continue
            identity = _identity_from_member(name, spec)
            if identity:
                groups.setdefault(identity, []).append(name)
    for identity, members in groups.items():
        groups[identity] = sorted(members, key=_natural_key)
    return groups


def _identity_from_member(member: str, spec: dict[str, object]) -> str:
    parser = str(spec.get("identityParser") or "")
    parts = PurePosixPath(member).parts
    stem = PurePosixPath(member).stem
    if parser == "agedb":
        match = re.match(r"^\d+_(.+)_(\d{1,3})_[mf]$", stem, flags=re.I)
        if match:
            return match.group(1)[:120]
    if parser == "fiw":
        if len(parts) >= 3:
            family, person = parts[-3], parts[-2]
            if family.startswith("F") and person.startswith("MID"):
                return f"{family}__{person}"
    return _identity_from_stem(stem)


def _identity_from_stem(stem: str) -> str:
    cleaned = re.sub(r"[_ -]*\d+$", "", stem).strip(" _.-")
    return re.sub(r"\s+", " ", cleaned.replace("__", "_")).strip()[:120]


def _identity_folder(dataset_folder: Path, identity_index: int, identity: str, spec: dict[str, object]) -> Path:
    if spec.get("layout") == "family-person-folders" and "__" in identity:
        family, person = identity.split("__", 1)
        return dataset_folder / _safe_folder_name(family) / _safe_folder_name(person)
    return dataset_folder / f"{identity_index:04d}-{_safe_folder_name(identity)}"


def _selection_key(spec: dict[str, object], identity: str, members: list[str]) -> tuple[object, ...]:
    sort = str(spec.get("sort") or "")
    if sort == "age-span-desc":
        ages = [_age_from_agedb_member(member) for member in members]
        ages = [age for age in ages if age is not None]
        span = max(ages) - min(ages) if len(ages) >= 2 else 0
        return (-span, identity.casefold())
    if sort == "image-count-desc":
        return (-len(members), identity.casefold())
    return (identity.casefold(),)


def _select_members(spec: dict[str, object], members: list[str], limit: int) -> list[str]:
    if str(spec.get("identityParser") or "") != "agedb":
        return members[:limit]
    age_ranked = [(age, member) for member in members if (age := _age_from_agedb_member(member)) is not None]
    if len(age_ranked) < limit:
        return members[:limit]
    age_ranked.sort(key=lambda item: (item[0], _natural_key(item[1])))
    selected: list[str] = []
    left = 0
    right = len(age_ranked) - 1
    while len(selected) < limit and left <= right:
        selected.append(age_ranked[left][1])
        if len(selected) >= limit or right == left:
            break
        selected.append(age_ranked[right][1])
        left += 1
        right -= 1
    return selected[:limit]


def _age_from_agedb_member(member: str) -> int | None:
    stem = PurePosixPath(member).stem
    match = re.match(r"^\d+_.+_(\d{1,3})_[mf]$", stem, flags=re.I)
    if not match:
        return None
    age = int(match.group(1))
    return age if 1 <= age <= 120 else None


def _safe_folder_name(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_. -]+", "_", value).strip(" ._-")
    return safe[:100] or "identity"


def _safe_file_name(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_. -]+", "_", value).strip(" ._")
    return safe[:120] or "image.jpg"


def _natural_key(value: str) -> tuple[object, ...]:
    parts = re.split(r"(\d+)", value.casefold())
    return tuple(int(part) if part.isdigit() else part for part in parts)


def _load_manifest(path: Path) -> dict[str, object] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


if __name__ == "__main__":
    main()

from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
import hashlib
import os
import shutil
import ssl
import sys
import time
import urllib.error
import urllib.request
import zipfile
from typing import Any, Callable

from crossage_fr.config import RuntimeConfig


ProgressCallback = Callable[[dict[str, Any]], None]


@dataclass(frozen=True, slots=True)
class ModelPackageSpec:
    pack: str
    label: str
    detail: str
    filename: str
    url: str
    sha256: str
    size_bytes: int
    license: str
    source: str
    required_any: tuple[tuple[str, ...], ...]


MODEL_PACKAGES: dict[str, ModelPackageSpec] = {
    "antelopev2": ModelPackageSpec(
        pack="antelopev2",
        label="Recommended accuracy",
        detail="InsightFace antelopev2, best default for high-quality face review.",
        filename="antelopev2.zip",
        url="https://github.com/deepinsight/insightface/releases/download/v0.7/antelopev2.zip",
        sha256="8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5",
        size_bytes=360_662_982,
        license="InsightFace model license; confirm suitability for your use case.",
        source="deepinsight/insightface v0.7 release",
        required_any=(
            ("scrfd_10g_bnkps.onnx", "det_10g.onnx", "retinaface_r50_v1.onnx"),
            ("glintr100.onnx", "w600k_r50.onnx"),
        ),
    ),
    "buffalo_l": ModelPackageSpec(
        pack="buffalo_l",
        label="Balanced package",
        detail="InsightFace buffalo_l, smaller download with strong face detection and recognition.",
        filename="buffalo_l.zip",
        url="https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
        sha256="80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f",
        size_bytes=288_621_354,
        license="InsightFace model license; confirm suitability for your use case.",
        source="deepinsight/insightface v0.7 release",
        required_any=(
            ("det_10g.onnx", "scrfd_10g_bnkps.onnx"),
            ("w600k_r50.onnx", "glintr100.onnx"),
        ),
    ),
}


MODEL_GOVERNANCE: dict[str, dict[str, Any]] = {
    "antelopev2": {
        "accuracyTier": "recommended",
        "intendedUse": "Local review assistance for finding likely face matches in personal photo libraries.",
        "humanReviewRequired": True,
        "redistributionRisk": "needs-license-review",
        "limitations": [
            "Do not use as sole identity proof.",
            "Accuracy can fall for childhood-to-adult gaps, occlusion, low light, motion blur, and heavy edits.",
            "Review every result before sharing, deleting, or making decisions from matches.",
        ],
        "validation": [
            "Run Settings > Accuracy lab with accepted/rejected local labels.",
            "Check false positives separately for cross-age and low-quality images.",
        ],
    },
    "buffalo_l": {
        "accuracyTier": "balanced",
        "intendedUse": "Local review assistance where smaller model download size matters.",
        "humanReviewRequired": True,
        "redistributionRisk": "needs-license-review",
        "limitations": [
            "Do not use as sole identity proof.",
            "May trade recall for smaller distribution size compared with the recommended package.",
            "Review every result before sharing, deleting, or making decisions from matches.",
        ],
        "validation": [
            "Run Settings > Accuracy lab after changing model packs.",
            "Compare thresholds against a labeled local sample before large scans.",
        ],
    },
}


def model_governance(pack: str) -> dict[str, Any]:
    default = {
        "accuracyTier": "unknown",
        "intendedUse": "Local review assistance only.",
        "humanReviewRequired": True,
        "redistributionRisk": "unknown",
        "limitations": ["Review every result before acting on a match."],
        "validation": ["Run local accuracy checks before broad use."],
    }
    return {**default, **MODEL_GOVERNANCE.get(pack, {})}


def default_model_root() -> Path:
    return Path.home() / ".insightface"


def configured_model_root(config: RuntimeConfig) -> Path | None:
    configured = (config.model_root or os.environ.get("CROSSAGE_MODEL_ROOT") or "").strip()
    if not configured:
        return None
    return Path(configured).expanduser()


def bundled_model_roots() -> list[Path]:
    roots: list[Path] = []
    executable = Path(sys.executable).resolve()
    roots.extend(
        [
            executable.parent / "models" / "insightface",
            executable.parent.parent / "models" / "insightface",
            Path.cwd() / "models" / "insightface",
        ]
    )
    bundle_root = getattr(sys, "_MEIPASS", "")
    if bundle_root:
        roots.append(Path(bundle_root) / "models" / "insightface")
    source_root = Path(__file__).resolve().parents[1]
    roots.append(source_root / "models" / "insightface")
    return _unique_paths(roots)


def model_root_for_config(config: RuntimeConfig, *, prefer_ready: bool = True) -> Path:
    configured = configured_model_root(config)
    if configured:
        return configured
    if prefer_ready:
        for root in bundled_model_roots():
            if model_pack_ready(root, config.model_pack):
                return root
    return default_model_root()


def model_roots_for_engine(config: RuntimeConfig) -> list[Path]:
    roots: list[Path] = []
    configured = configured_model_root(config)
    if configured:
        roots.append(configured)
    roots.extend(bundled_model_roots())
    roots.append(default_model_root())
    return _unique_paths(roots)


def model_pack_dir(root: Path, pack: str) -> Path:
    return root.expanduser() / "models" / pack


def resolved_model_pack_dir(root: Path, pack: str) -> Path | None:
    direct = model_pack_dir(root, pack)
    candidates = [direct, direct / pack]
    for candidate in candidates:
        if candidate.exists() and not missing_model_files(candidate, pack):
            return candidate
    return None


def model_pack_ready(root: Path, pack: str) -> bool:
    return resolved_model_pack_dir(root, pack) is not None


def missing_model_files(directory: Path, pack: str) -> list[str]:
    spec = MODEL_PACKAGES.get(pack)
    if not spec:
        return [f"Unknown model package: {pack}"]
    if not directory.exists() or not directory.is_dir():
        return [f"{directory} does not exist"]
    missing: list[str] = []
    for group in spec.required_any:
        if not any((directory / filename).exists() for filename in group):
            missing.append(" or ".join(group))
    return missing


def model_status(config: RuntimeConfig, engine_name: str = "") -> dict[str, Any]:
    root = model_root_for_config(config)
    packs = []
    for spec in MODEL_PACKAGES.values():
        directory = model_pack_dir(root, spec.pack)
        resolved = resolved_model_pack_dir(root, spec.pack)
        missing = [] if resolved else missing_model_files(directory, spec.pack)
        archive_path = root.expanduser() / "downloads" / spec.filename
        packs.append(
            {
                **asdict(spec),
                "governance": model_governance(spec.pack),
                "path": str(resolved or directory),
                "archivePath": str(archive_path),
                "available": not missing,
                "missing": missing,
                "downloadedArchive": archive_path.exists(),
                "installedBytes": _directory_size(directory) if directory.exists() else 0,
            }
        )
    current = next((pack for pack in packs if pack["pack"] == config.model_pack), packs[0])
    ready = bool(current["available"])
    fallback = engine_name.startswith("local-image-fingerprint")
    return {
        "ready": ready,
        "fallbackActive": fallback,
        "currentPack": config.model_pack,
        "modelRoot": str(root.expanduser()),
        "defaultRoot": str(default_model_root()),
        "engine": engine_name,
        "governance": model_governance(config.model_pack),
        "packages": packs,
        "offlineMessage": "Connect to the internet, choose a writable folder, then download a face model." if not ready else "",
        "recommendation": "Download the recommended face model before sharing production installers." if fallback or not ready else "Full face model is ready.",
    }


def set_model_root(config: RuntimeConfig, root: Path) -> Path:
    resolved = root.expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    test_path = resolved / ".vintrace-write-test"
    try:
        test_path.write_text("ok", encoding="utf-8")
    finally:
        try:
            test_path.unlink()
        except OSError:
            pass
    config.model_root = str(resolved)
    return resolved


def download_model_pack(pack: str, root: Path, on_progress: ProgressCallback | None = None, force: bool = False) -> dict[str, Any]:
    spec = MODEL_PACKAGES.get(pack)
    if not spec:
        raise ValueError(f"Unknown model package: {pack}")
    root = root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    downloads = root / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    archive_path = downloads / spec.filename

    def emit(payload: dict[str, Any]) -> None:
        if on_progress:
            on_progress(
                {
                    "pack": spec.pack,
                    "label": spec.label,
                    "phase": payload.get("phase", "downloading"),
                    "downloadedBytes": payload.get("downloadedBytes", 0),
                    "totalBytes": payload.get("totalBytes", spec.size_bytes),
                    "percent": payload.get("percent", 0),
                    "message": payload.get("message", ""),
                    "root": str(root),
                }
            )

    emit({"phase": "starting", "message": "Preparing download"})
    if force:
        archive_path.unlink(missing_ok=True)
        archive_path.with_suffix(archive_path.suffix + ".part").unlink(missing_ok=True)
    if archive_path.exists() and not force:
        try:
            _verify_archive(archive_path, spec)
            emit({"phase": "verifying", "downloadedBytes": spec.size_bytes, "percent": 100, "message": "Cached download verified"})
        except ValueError:
            archive_path.unlink(missing_ok=True)

    if not archive_path.exists():
        _download_archive(spec, archive_path, emit)

    emit({"phase": "verifying", "downloadedBytes": spec.size_bytes, "percent": 100, "message": "Verifying SHA-256 checksum"})
    digest = _verify_archive(archive_path, spec)
    emit({"phase": "extracting", "downloadedBytes": spec.size_bytes, "percent": 100, "message": "Installing model files"})
    installed_dir = _extract_model_archive(archive_path, root, spec)
    missing = missing_model_files(installed_dir, spec.pack)
    if missing:
        raise ValueError(f"Downloaded model is incomplete: {', '.join(missing)}")
    emit({"phase": "complete", "downloadedBytes": spec.size_bytes, "percent": 100, "message": "Face model ready"})
    return {
        "pack": spec.pack,
        "label": spec.label,
        "path": str(installed_dir),
        "root": str(root),
        "archivePath": str(archive_path),
        "sha256": digest,
        "bytes": spec.size_bytes,
        "verified": True,
    }


def _download_archive(spec: ModelPackageSpec, archive_path: Path, emit: ProgressCallback) -> None:
    temp_path = archive_path.with_suffix(archive_path.suffix + ".part")
    if temp_path.exists():
        try:
            partial_size = temp_path.stat().st_size
        except OSError:
            partial_size = 0
        if partial_size == spec.size_bytes:
            temp_path.replace(archive_path)
            return
        if partial_size > spec.size_bytes:
            temp_path.unlink(missing_ok=True)

    last_error: BaseException | None = None
    for attempt in range(1, 4):
        resume_from = temp_path.stat().st_size if temp_path.exists() else 0
        headers = {"User-Agent": "Vintrace/0.1"}
        if resume_from > 0:
            headers["Range"] = f"bytes={resume_from}-"
            emit(
                {
                    "phase": "downloading",
                    "downloadedBytes": resume_from,
                    "totalBytes": spec.size_bytes,
                    "percent": min(99, round(resume_from / max(spec.size_bytes, 1) * 100)),
                    "message": "Resuming face model download",
                }
            )
        request = urllib.request.Request(spec.url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=45, context=_ssl_context()) as response:
                status = int(getattr(response, "status", 200) or 200)
                if resume_from > 0 and status != 206:
                    resume_from = 0
                    temp_path.unlink(missing_ok=True)
                total = _download_total_bytes(response.headers, spec.size_bytes, resume_from)
                downloaded = resume_from
                mode = "ab" if resume_from else "wb"
                with temp_path.open(mode) as handle:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        downloaded += len(chunk)
                        if downloaded == len(chunk) or downloaded % (8 * 1024 * 1024) < len(chunk):
                            emit(
                                {
                                    "phase": "downloading",
                                    "downloadedBytes": downloaded,
                                    "totalBytes": total,
                                    "percent": min(99, round(downloaded / max(total, 1) * 100)),
                                    "message": "Downloading face model",
                                }
                            )
            if temp_path.stat().st_size != spec.size_bytes:
                raise ConnectionError(
                    f"Downloaded {temp_path.stat().st_size} bytes for {spec.filename}; expected {spec.size_bytes}. Retry will resume."
                )
            temp_path.replace(archive_path)
            return
        except (urllib.error.URLError, TimeoutError, OSError, ssl.SSLError, ConnectionError) as exc:
            last_error = exc
            if attempt < 3:
                emit(
                    {
                        "phase": "downloading",
                        "downloadedBytes": temp_path.stat().st_size if temp_path.exists() else 0,
                        "totalBytes": spec.size_bytes,
                        "percent": min(99, round((temp_path.stat().st_size if temp_path.exists() else 0) / max(spec.size_bytes, 1) * 100)),
                        "message": f"Network interrupted. Retrying {attempt + 1}/3",
                    }
                )
                time.sleep(min(2.0, 0.4 * attempt))
                continue
            raise ConnectionError("Model download failed. The partial download was kept so Retry can resume it.") from exc
    raise ConnectionError("Model download failed. The partial download was kept so Retry can resume it.") from last_error


def _download_total_bytes(headers: Any, expected: int, resume_from: int) -> int:
    content_range = str(headers.get("Content-Range") or "")
    if "/" in content_range:
        tail = content_range.rsplit("/", 1)[-1].strip()
        if tail.isdigit():
            return int(tail)
    content_length = str(headers.get("Content-Length") or "")
    if content_length.isdigit():
        return int(content_length) + int(resume_from)
    return expected


def _verify_archive(path: Path, spec: ModelPackageSpec) -> str:
    size = path.stat().st_size
    if size != spec.size_bytes:
        raise ValueError(f"Downloaded size mismatch for {spec.filename}: expected {spec.size_bytes}, got {size}.")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    value = digest.hexdigest()
    if value.lower() != spec.sha256.lower():
        raise ValueError(f"Checksum mismatch for {spec.filename}.")
    try:
        with zipfile.ZipFile(path) as archive:
            bad_file = archive.testzip()
    except zipfile.BadZipFile as exc:
        raise ValueError(f"Downloaded archive is not a valid zip: {path.name}") from exc
    if bad_file:
        raise ValueError(f"Downloaded archive failed zip integrity check at {bad_file}.")
    return value


def _extract_model_archive(path: Path, root: Path, spec: ModelPackageSpec) -> Path:
    models_dir = root / "models"
    destination = model_pack_dir(root, spec.pack)
    extract_dir = models_dir / f".{spec.pack}.extracting"
    install_dir = models_dir / f".{spec.pack}.installing"
    backup_dir = models_dir / f".{spec.pack}.previous"
    shutil.rmtree(extract_dir, ignore_errors=True)
    shutil.rmtree(install_dir, ignore_errors=True)
    shutil.rmtree(backup_dir, ignore_errors=True)
    extract_dir.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(path) as archive:
            extract_root = extract_dir.resolve()
            for member in archive.infolist():
                target = (extract_dir / member.filename).resolve()
                try:
                    target.relative_to(extract_root)
                except ValueError as exc:
                    raise ValueError(f"Unsafe path in model archive: {member.filename}") from exc
                archive.extract(member, extract_dir)
        candidate = _find_extracted_pack_dir(extract_dir, spec)
        if not candidate:
            raise ValueError(f"Could not find {spec.pack} model files after extraction.")
        shutil.copytree(candidate, install_dir)
        try:
            if destination.exists():
                destination.replace(backup_dir)
            install_dir.replace(destination)
        except Exception:
            if not destination.exists() and backup_dir.exists():
                backup_dir.replace(destination)
            raise
        shutil.rmtree(backup_dir, ignore_errors=True)
        return destination
    finally:
        shutil.rmtree(extract_dir, ignore_errors=True)
        if install_dir.exists():
            shutil.rmtree(install_dir, ignore_errors=True)
        if backup_dir.exists():
            shutil.rmtree(backup_dir, ignore_errors=True)


def _find_extracted_pack_dir(root: Path, spec: ModelPackageSpec) -> Path | None:
    candidates = [root / spec.pack, root / "models" / spec.pack, root]
    candidates.extend(path for path in root.rglob("*") if path.is_dir() and path.name == spec.pack)
    for candidate in candidates:
        if candidate.exists() and not missing_model_files(candidate, spec.pack):
            return candidate
    return None


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for file in path.rglob("*"):
        if file.is_file():
            try:
                total += file.stat().st_size
            except OSError:
                pass
    return total


def _unique_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    result: list[Path] = []
    for path in paths:
        key = str(path.expanduser())
        if key not in seen:
            seen.add(key)
            result.append(path)
    return result

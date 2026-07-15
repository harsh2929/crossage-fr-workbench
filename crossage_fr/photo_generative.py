from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any, Callable
import hashlib
import json
import math
import os
import platform
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile

from crossage_fr.workspace_registry import registry_root, restrict_file_mode


CATALOG_FILENAME = "catalog.json"
CATALOG_SHA256 = "ec8cbb1bb77b749be39a545836f0394b70efd4053b557e6e4e56442f982d1406"
CATALOG_VERSION = "2026-07-12.1"
QWEN_IMAGE_EDIT_MODEL_ID = "Qwen/Qwen-Image-Edit-2511"
QWEN_IMAGE_EDIT_REVISION = "6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9"
STABLE_DIFFUSION_CPP_RUNTIME_ID = "stable-diffusion.cpp"
STABLE_DIFFUSION_CPP_TAG = "master-775-b5d8120"
STABLE_DIFFUSION_CPP_REVISION = "b5d812008eb7082a238fc589444544b3278187ae"
AGE_PROGRESS_PROMPT_VERSION = "age-progress-safety-v1"
SUPPORTED_TIERS = {"light", "heavy", "all"}
LIGHT_MODES = {"cleanup", "upscale"}
HEAVY_MODES = {"expand", "reframe", "relight", "age-progress"}
SUPPORTED_MODES = LIGHT_MODES | HEAVY_MODES
HEAVY_ACKNOWLEDGEMENT = "I understand this downloads about 23 GB"
MAX_MASK_RECTS = 64
MAX_PROMPT_CHARS = 400
AGE_PROGRESS_TARGETS = {
    "child": 8,
    "adolescent": 15,
    "adult": 33,
    "older-adult": 57,
    "senior": 72,
}
ProgressCallback = Callable[[dict[str, Any]], None]


def age_progress_prompt(target_age_bucket: str) -> str:
    target = str(target_age_bucket or "").strip().casefold().replace("_", "-")
    if target not in AGE_PROGRESS_TARGETS:
        raise ValueError("Choose child, adolescent, adult, older-adult, or senior as the target age range.")
    target_age = AGE_PROGRESS_TARGETS[target]
    return (
        f"Create one photorealistic synthetic enrollment portrait of the same consenting person at approximately {target_age} years old "
        f"({target} age range). Preserve identity, facial geometry, skin tone, expression, gaze, head pose, framing, clothing, "
        "background, and photographic realism. Change only age-related facial, skin, and hair cues. Do not add or remove a person, alter "
        "identity, add text or a watermark, infer sensitive traits, or change accessories."
    )


def age_progress_prompt_sha256(target_age_bucket: str) -> str:
    return hashlib.sha256(age_progress_prompt(target_age_bucket).encode("utf-8")).hexdigest()


class PhotoGenerativeError(RuntimeError):
    """Base error for the local generative photo runtime."""


class PhotoGenerativeUnavailableError(PhotoGenerativeError):
    """Raised when a requested verified local route cannot run."""


class PhotoGenerativeIntegrityError(PhotoGenerativeError):
    """Raised when a catalog, model, runtime, or output fails verification."""


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _catalog_candidates() -> list[Path]:
    candidates: list[Path] = []
    if not _is_packaged():
        configured = str(os.environ.get("VINTRACE_GENERATIVE_CATALOG", "") or "").strip()
        if configured:
            candidates.append(Path(configured).expanduser())
    bundle_root = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if bundle_root:
        candidates.append(Path(bundle_root) / "models" / "generative" / CATALOG_FILENAME)
    executable = Path(sys.executable).resolve()
    candidates.extend(
        [
            executable.parent / "models" / "generative" / CATALOG_FILENAME,
            executable.parent.parent / "models" / "generative" / CATALOG_FILENAME,
            Path(__file__).resolve().parents[1] / "models" / "generative" / CATALOG_FILENAME,
        ]
    )
    seen: set[str] = set()
    return [path for path in candidates if not (str(path) in seen or seen.add(str(path)))]


def catalog_path() -> Path:
    for candidate in _catalog_candidates():
        if candidate.is_file():
            return candidate
    raise PhotoGenerativeIntegrityError("The bundled generative photo catalog is missing.")


def _validate_download_spec(spec: dict[str, Any]) -> None:
    filename = str(spec.get("filename", spec.get("archive", "")) or "")
    if (
        not filename
        or Path(filename).name != filename
        or not str(spec.get("url", "") or "").startswith("https://")
        or not re.fullmatch(r"[a-f0-9]{64}", str(spec.get("sha256", "") or ""))
        or int(spec.get("sizeBytes", 0) or 0) <= 0
    ):
        raise PhotoGenerativeIntegrityError("A generative photo download pin is invalid.")


def _validate_catalog(catalog: dict[str, Any]) -> None:
    if (
        int(catalog.get("schemaVersion", 0) or 0) != 1
        or catalog.get("catalogId") != "vintrace-photo-generative"
        or catalog.get("version") != CATALOG_VERSION
        or catalog.get("offlineInference") is not True
    ):
        raise PhotoGenerativeIntegrityError("The generative photo catalog contract is invalid.")
    light = catalog.get("light") if isinstance(catalog.get("light"), dict) else {}
    cleanup = light.get("cleanup") if isinstance(light.get("cleanup"), dict) else {}
    upscale = light.get("upscale") if isinstance(light.get("upscale"), dict) else {}
    if (
        cleanup.get("id") != "opencv/inpainting_lama"
        or cleanup.get("revision") != "aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f"
        or cleanup.get("license") != "Apache-2.0"
        or upscale.get("id") != "xinntao/Real-ESRGAN"
        or upscale.get("tag") != "v0.2.5.0"
        or upscale.get("license") != "BSD-3-Clause"
    ):
        raise PhotoGenerativeIntegrityError("The light generative model pins are invalid.")
    _validate_download_spec(cleanup.get("artifact") if isinstance(cleanup.get("artifact"), dict) else {})
    upscale_platforms = upscale.get("platforms") if isinstance(upscale.get("platforms"), dict) else {}
    if set(upscale_platforms) != {"darwin-arm64", "darwin-x86_64", "win32-x86_64"}:
        raise PhotoGenerativeIntegrityError("The Real-ESRGAN platform catalog is incomplete.")
    for spec in upscale_platforms.values():
        if not isinstance(spec, dict) or spec.get("format") != "zip":
            raise PhotoGenerativeIntegrityError("A Real-ESRGAN runtime pin is invalid.")
        _validate_download_spec(spec)
    heavy = catalog.get("heavy") if isinstance(catalog.get("heavy"), dict) else {}
    runtime = heavy.get("runtime") if isinstance(heavy.get("runtime"), dict) else {}
    if (
        heavy.get("id") != QWEN_IMAGE_EDIT_MODEL_ID
        or heavy.get("revision") != QWEN_IMAGE_EDIT_REVISION
        or heavy.get("license") != "Apache-2.0"
        or int(heavy.get("minimumMemoryBytes", 0) or 0) != 51539607552
        or runtime.get("id") != STABLE_DIFFUSION_CPP_RUNTIME_ID
        or runtime.get("tag") != STABLE_DIFFUSION_CPP_TAG
        or runtime.get("revision") != STABLE_DIFFUSION_CPP_REVISION
        or runtime.get("license") != "MIT"
    ):
        raise PhotoGenerativeIntegrityError("The heavy generative model/runtime pins are invalid.")
    heavy_platforms = runtime.get("platforms") if isinstance(runtime.get("platforms"), dict) else {}
    if set(heavy_platforms) != {"darwin-arm64", "win32-x86_64"}:
        raise PhotoGenerativeIntegrityError("The heavy generative runtime platform catalog is invalid.")
    for spec in heavy_platforms.values():
        if not isinstance(spec, dict) or spec.get("format") != "zip":
            raise PhotoGenerativeIntegrityError("A stable-diffusion.cpp runtime pin is invalid.")
        _validate_download_spec(spec)
    artifacts = heavy.get("artifacts") if isinstance(heavy.get("artifacts"), list) else []
    roles = {str(item.get("role", "")) for item in artifacts if isinstance(item, dict)}
    if roles != {"diffusion-model", "text-encoder", "vae"} or len(artifacts) != 3:
        raise PhotoGenerativeIntegrityError("The Qwen Image Edit artifact catalog is invalid.")
    for artifact in artifacts:
        if not isinstance(artifact, dict) or artifact.get("license") != "Apache-2.0":
            raise PhotoGenerativeIntegrityError("A Qwen Image Edit artifact pin is invalid.")
        _validate_download_spec(artifact)


def load_catalog() -> dict[str, Any]:
    path = catalog_path()
    if hash_file(path).lower() != CATALOG_SHA256:
        raise PhotoGenerativeIntegrityError("The bundled generative photo catalog failed its integrity check.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PhotoGenerativeIntegrityError("The bundled generative photo catalog is unreadable.") from exc
    if not isinstance(payload, dict):
        raise PhotoGenerativeIntegrityError("The bundled generative photo catalog is invalid.")
    _validate_catalog(payload)
    return payload


def default_generative_root() -> Path:
    if not _is_packaged():
        configured = str(os.environ.get("VINTRACE_GENERATIVE_ROOT", "") or "").strip()
        if configured:
            return Path(configured).expanduser().resolve()
    return (registry_root() / "models" / "generative").resolve()


def resolve_generative_root(root: Path | str | None = None) -> Path:
    if root and not _is_packaged():
        return Path(root).expanduser().resolve()
    return default_generative_root()


def platform_key() -> str:
    machine = platform.machine().strip().lower()
    if machine in {"amd64", "x64"}:
        machine = "x86_64"
    elif machine in {"aarch64", "arm64"}:
        machine = "arm64"
    system = "win32" if sys.platform.startswith("win") else "darwin" if sys.platform == "darwin" else sys.platform
    return f"{system}-{machine}"


def total_system_memory_bytes() -> int:
    try:
        import psutil

        return max(0, int(psutil.virtual_memory().total))
    except Exception:
        pass
    if sys.platform == "darwin":
        try:
            return max(
                0,
                int(
                    subprocess.run(
                        ["sysctl", "-n", "hw.memsize"],
                        check=True,
                        capture_output=True,
                        text=True,
                        timeout=3,
                    ).stdout.strip()
                ),
            )
        except Exception:
            return 0
    try:
        return max(0, int(os.sysconf("SC_PAGE_SIZE")) * int(os.sysconf("SC_PHYS_PAGES")))
    except (AttributeError, OSError, TypeError, ValueError):
        return 0


_FILE_HASH_CACHE: dict[tuple[str, int, int, int, str], bool] = {}
_FILE_HASH_LOCK = threading.Lock()
_LAMA_SESSION_CACHE: dict[tuple[str, int, int, str], Any] = {}
_LAMA_SESSION_LOCK = threading.Lock()


def clear_verification_cache() -> None:
    with _FILE_HASH_LOCK:
        _FILE_HASH_CACHE.clear()
    with _LAMA_SESSION_LOCK:
        _LAMA_SESSION_CACHE.clear()


def _verify_pinned_file(path: Path, size: int, digest: str) -> None:
    try:
        stat = path.stat()
    except OSError as exc:
        raise PhotoGenerativeIntegrityError(f"Required generative file is missing: {path.name}") from exc
    if not path.is_file() or int(stat.st_size) != int(size):
        raise PhotoGenerativeIntegrityError(f"Generative file size mismatch: {path.name}")
    key = (str(path.resolve()), int(stat.st_size), int(stat.st_mtime_ns), int(stat.st_ctime_ns), digest)
    with _FILE_HASH_LOCK:
        if _FILE_HASH_CACHE.get(key):
            return
    if hash_file(path).lower() != digest.lower():
        raise PhotoGenerativeIntegrityError(f"Generative file checksum mismatch: {path.name}")
    with _FILE_HASH_LOCK:
        _FILE_HASH_CACHE[key] = True


def _artifact_path(root: Path, tier: str, spec: dict[str, Any]) -> Path:
    return root / "models" / tier / str(spec["filename"])


def _runtime_archive_path(root: Path, runtime_id: str, spec: dict[str, Any]) -> Path:
    return root / "downloads" / runtime_id / str(spec["archive"])


def _runtime_dir(root: Path, runtime_id: str, key: str) -> Path:
    return root / "runtime" / runtime_id / key


def _safe_archive_name(name: str) -> str:
    value = name.replace("\\", "/")
    while value.startswith("./"):
        value = value[2:]
    path = PurePosixPath(value)
    if not value or path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise PhotoGenerativeIntegrityError("A generative runtime archive contains an unsafe path.")
    return str(path)


def _expected_zip_files(archive_path: Path) -> dict[str, tuple[int, str, int]]:
    expected: dict[str, tuple[int, str, int]] = {}
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                name = _safe_archive_name(member.filename)
                digest = hashlib.sha256()
                size = 0
                with archive.open(member) as handle:
                    for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                        digest.update(chunk)
                        size += len(chunk)
                expected[name] = (size, digest.hexdigest(), (member.external_attr >> 16) & 0o777)
    except (OSError, zipfile.BadZipFile) as exc:
        raise PhotoGenerativeIntegrityError("A generative runtime archive is invalid.") from exc
    if not expected:
        raise PhotoGenerativeIntegrityError("A generative runtime archive contains no files.")
    return expected


def _runtime_spec(catalog: dict[str, Any], runtime_id: str) -> tuple[str, dict[str, Any], dict[str, Any]]:
    key = platform_key()
    if runtime_id == "realesrgan":
        runtime = catalog["light"]["upscale"]
    elif runtime_id == "stable-diffusion.cpp":
        runtime = catalog["heavy"]["runtime"]
    else:
        raise PhotoGenerativeIntegrityError("Unknown generative runtime.")
    spec = runtime["platforms"].get(key)
    if not isinstance(spec, dict):
        raise PhotoGenerativeUnavailableError(f"{runtime['label'] if runtime.get('label') else runtime['id']} is not packaged for {key}.")
    return key, runtime, spec


def verify_runtime(
    runtime_id: str,
    root: Path | str | None = None,
    catalog: dict[str, Any] | None = None,
) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    key, runtime, spec = _runtime_spec(catalog, runtime_id)
    resolved_root = resolve_generative_root(root)
    archive_path = _runtime_archive_path(resolved_root, runtime_id, spec)
    _verify_pinned_file(archive_path, int(spec["sizeBytes"]), str(spec["sha256"]))
    expected = _expected_zip_files(archive_path)
    directory = _runtime_dir(resolved_root, runtime_id, key)
    actual = {
        str(path.relative_to(directory)).replace(os.sep, "/")
        for path in directory.rglob("*")
        if path.is_file()
    } if directory.is_dir() else set()
    if actual != set(expected):
        raise PhotoGenerativeIntegrityError(f"The installed {runtime_id} runtime file set failed verification.")
    for name, (size, digest, _mode) in expected.items():
        _verify_pinned_file(directory / PurePosixPath(name), size, digest)
    executables = [path for path in directory.rglob(str(spec["executable"])) if path.is_file()]
    if len(executables) != 1:
        raise PhotoGenerativeIntegrityError(f"The installed {runtime_id} executable is missing or ambiguous.")
    executable = executables[0]
    if not sys.platform.startswith("win") and not os.access(executable, os.X_OK):
        raise PhotoGenerativeIntegrityError(f"The installed {runtime_id} executable is not executable.")
    result = {
        "available": True,
        "verified": True,
        "id": str(runtime.get("id", runtime_id)),
        "tag": str(runtime.get("tag", "")),
        "revision": str(runtime.get("revision", "")),
        "license": str(runtime.get("runtimeLicense", runtime.get("license", ""))),
        "platform": key,
        "archive": str(spec["archive"]),
        "archiveSha256": str(spec["sha256"]),
        "executable": str(executable),
        "runtimeDirectory": str(directory),
    }
    if runtime_id == "realesrgan":
        model_files = list(directory.rglob("realesrgan-x4plus.param"))
        if len(model_files) != 1 or not (model_files[0].parent / "realesrgan-x4plus.bin").is_file():
            raise PhotoGenerativeIntegrityError("The verified Real-ESRGAN model files are missing.")
        result["modelDirectory"] = str(model_files[0].parent)
        result["modelName"] = str(runtime["modelName"])
    return result


def verify_cleanup_model(root: Path | str | None = None, catalog: dict[str, Any] | None = None) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    resolved_root = resolve_generative_root(root)
    model = catalog["light"]["cleanup"]
    artifact = model["artifact"]
    path = _artifact_path(resolved_root, "light", artifact)
    _verify_pinned_file(path, int(artifact["sizeBytes"]), str(artifact["sha256"]))
    return {
        "available": True,
        "verified": True,
        "id": str(model["id"]),
        "label": str(model["label"]),
        "revision": str(model["revision"]),
        "license": str(model["license"]),
        "filename": str(artifact["filename"]),
        "sha256": str(artifact["sha256"]),
        "path": str(path),
    }


def verify_heavy_models(root: Path | str | None = None, catalog: dict[str, Any] | None = None) -> dict[str, Any]:
    catalog = catalog or load_catalog()
    resolved_root = resolve_generative_root(root)
    heavy = catalog["heavy"]
    artifacts: list[dict[str, Any]] = []
    for spec in heavy["artifacts"]:
        path = _artifact_path(resolved_root, "heavy", spec)
        _verify_pinned_file(path, int(spec["sizeBytes"]), str(spec["sha256"]))
        artifacts.append(
            {
                "role": str(spec["role"]),
                "filename": str(spec["filename"]),
                "sha256": str(spec["sha256"]),
                "path": str(path),
            }
        )
    return {
        "available": True,
        "verified": True,
        "id": str(heavy["id"]),
        "label": str(heavy["label"]),
        "revision": str(heavy["revision"]),
        "license": str(heavy["license"]),
        "artifacts": artifacts,
    }


def _status_result(call: Callable[[], dict[str, Any]]) -> tuple[dict[str, Any], str]:
    try:
        return call(), ""
    except PhotoGenerativeError as exc:
        return {}, str(exc)


def _installed_file_count(root: Path, specs: list[dict[str, Any]], tier: str) -> int:
    return sum(1 for spec in specs if _artifact_path(root, tier, spec).is_file())


def photo_generative_status(
    root: Path | str | None = None,
    *,
    total_memory_bytes: int | None = None,
) -> dict[str, Any]:
    catalog = load_catalog()
    resolved_root = resolve_generative_root(root)
    memory = total_system_memory_bytes() if total_memory_bytes is None else max(0, int(total_memory_bytes))
    key = platform_key()
    cleanup, cleanup_error = _status_result(lambda: verify_cleanup_model(resolved_root, catalog))
    upscale, upscale_error = _status_result(lambda: verify_runtime("realesrgan", resolved_root, catalog))
    heavy_models, heavy_model_error = _status_result(lambda: verify_heavy_models(resolved_root, catalog))
    heavy_runtime, heavy_runtime_error = _status_result(lambda: verify_runtime("stable-diffusion.cpp", resolved_root, catalog))
    cleanup_spec = catalog["light"]["cleanup"]["artifact"]
    upscale_platform_spec = catalog["light"]["upscale"]["platforms"].get(key)
    heavy = catalog["heavy"]
    heavy_runtime_spec = heavy["runtime"]["platforms"].get(key)
    hardware_supported = memory >= int(heavy["minimumMemoryBytes"])
    heavy_platform_supported = isinstance(heavy_runtime_spec, dict)
    heavy_ready = bool(heavy_models and heavy_runtime and hardware_supported and heavy_platform_supported)
    heavy_specs = [item for item in heavy["artifacts"] if isinstance(item, dict)]
    return {
        "catalogVersion": str(catalog["version"]),
        "catalogSha256": CATALOG_SHA256,
        "offlineInference": True,
        "modelRoot": str(resolved_root),
        "platform": key,
        "totalMemoryBytes": memory,
        "light": {
            "available": bool(cleanup or upscale),
            "ready": bool(cleanup and upscale),
            "downloadBytes": int(cleanup_spec["sizeBytes"]) + (int(upscale_platform_spec["sizeBytes"]) if isinstance(upscale_platform_spec, dict) else 0),
            "cleanup": cleanup or {
                "available": False,
                "verified": False,
                "installed": _artifact_path(resolved_root, "light", cleanup_spec).is_file(),
                "error": cleanup_error,
            },
            "upscale": upscale or {
                "available": False,
                "verified": False,
                "installed": bool(upscale_platform_spec and _runtime_archive_path(resolved_root, "realesrgan", upscale_platform_spec).is_file()),
                "platformSupported": isinstance(upscale_platform_spec, dict),
                "error": upscale_error,
            },
        },
        "heavy": {
            "available": heavy_ready,
            "ready": bool(heavy_models and heavy_runtime),
            "platformSupported": heavy_platform_supported,
            "hardwareSupported": hardware_supported,
            "minimumMemoryBytes": int(heavy["minimumMemoryBytes"]),
            "recommendedMemoryBytes": int(heavy["recommendedMemoryBytes"]),
            "downloadBytes": sum(int(item["sizeBytes"]) for item in heavy_specs) + (int(heavy_runtime_spec["sizeBytes"]) if isinstance(heavy_runtime_spec, dict) else 0),
            "acknowledgement": HEAVY_ACKNOWLEDGEMENT,
            "models": heavy_models or {
                "available": False,
                "verified": False,
                "installedFileCount": _installed_file_count(resolved_root, heavy_specs, "heavy"),
                "error": heavy_model_error,
            },
            "runtime": heavy_runtime or {
                "available": False,
                "verified": False,
                "installed": bool(heavy_runtime_spec and _runtime_archive_path(resolved_root, "stable-diffusion.cpp", heavy_runtime_spec).is_file()),
                "error": heavy_runtime_error,
            },
            "reason": "Ready for local expand, reframe, relight, and consent-bound age-reference generation."
            if heavy_ready
            else "Vintrace could not verify this computer's memory for the heavy tier."
            if memory <= 0
            else "This tier needs at least 48 GiB of memory."
            if not hardware_supported
            else f"No pinned heavy runtime is available for {key}."
            if not heavy_platform_supported
            else heavy_model_error or heavy_runtime_error or "Install the verified heavy pack.",
        },
        "modes": {
            "cleanup": bool(cleanup),
            "upscale": bool(upscale),
            "expand": heavy_ready,
            "reframe": heavy_ready,
            "relight": heavy_ready,
            "age-progress": heavy_ready,
        },
    }


def _ssl_context() -> ssl.SSLContext:
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


def _download_file(
    spec: dict[str, Any],
    destination: Path,
    *,
    force: bool,
    emit: Callable[[dict[str, Any]], None],
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    restrict_file_mode(destination.parent, 0o700)
    partial = destination.with_name(destination.name + ".part")
    if force:
        destination.unlink(missing_ok=True)
        partial.unlink(missing_ok=True)
    if destination.exists():
        try:
            _verify_pinned_file(destination, int(spec["sizeBytes"]), str(spec["sha256"]))
            emit({"phase": "verified", "file": destination.name, "fileBytes": int(spec["sizeBytes"])})
            return
        except PhotoGenerativeIntegrityError:
            destination.unlink(missing_ok=True)
            clear_verification_cache()
    expected_size = int(spec["sizeBytes"])
    last_error: BaseException | None = None
    for attempt in range(1, 4):
        resume_from = partial.stat().st_size if partial.exists() else 0
        if resume_from > expected_size:
            partial.unlink(missing_ok=True)
            resume_from = 0
        headers = {"User-Agent": "Vintrace/0.1 local-generative-photo"}
        if resume_from:
            headers["Range"] = f"bytes={resume_from}-"
        request = urllib.request.Request(str(spec["url"]), headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60, context=_ssl_context()) as response:
                if not str(response.geturl() or "").startswith("https://"):
                    raise ConnectionError("A model download redirected to an insecure transport.")
                status = int(getattr(response, "status", 200) or 200)
                if resume_from and status != 206:
                    partial.unlink(missing_ok=True)
                    resume_from = 0
                mode = "ab" if resume_from else "wb"
                downloaded = resume_from
                with partial.open(mode) as handle:
                    while True:
                        chunk = response.read(4 * 1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        downloaded += len(chunk)
                        if downloaded > expected_size:
                            raise ConnectionError("A model download exceeded its pinned byte size.")
                        emit({"phase": "downloading", "file": destination.name, "fileBytes": downloaded})
                    handle.flush()
                    os.fsync(handle.fileno())
            if not partial.is_file() or partial.stat().st_size != expected_size:
                actual = partial.stat().st_size if partial.exists() else 0
                raise ConnectionError(f"Downloaded {actual} bytes for {destination.name}; expected {expected_size}.")
            partial.replace(destination)
            restrict_file_mode(destination, 0o600)
            clear_verification_cache()
            _verify_pinned_file(destination, expected_size, str(spec["sha256"]))
            emit({"phase": "verified", "file": destination.name, "fileBytes": expected_size})
            return
        except (urllib.error.URLError, TimeoutError, OSError, ssl.SSLError, ConnectionError) as exc:
            last_error = exc
            if attempt < 3:
                emit({"phase": "retrying", "file": destination.name, "fileBytes": partial.stat().st_size if partial.exists() else 0})
                time.sleep(min(2.0, attempt * 0.5))
    raise ConnectionError("Generative model download failed. Retry can resume the verified partial file.") from last_error


def _extract_zip_runtime(archive_path: Path, destination: Path, *, executable_name: str) -> None:
    expected = _expected_zip_files(archive_path)
    staging = destination.with_name(destination.name + ".installing")
    previous = destination.with_name(destination.name + ".previous")
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(previous, ignore_errors=True)
    staging.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                if member.is_dir():
                    continue
                name = _safe_archive_name(member.filename)
                target = staging / PurePosixPath(name)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, 1024 * 1024)
                archive_mode = expected[name][2]
                executable = PurePosixPath(name).name == executable_name or bool(archive_mode & 0o111)
                target.chmod(0o700 if executable else 0o600)
        if destination.exists():
            destination.replace(previous)
        staging.replace(destination)
        shutil.rmtree(previous, ignore_errors=True)
    except Exception:
        if not destination.exists() and previous.exists():
            previous.replace(destination)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)
        shutil.rmtree(previous, ignore_errors=True)


def install_photo_generative_pack(
    tier: str,
    root: Path | str | None = None,
    *,
    acknowledge_large_download: bool | str = False,
    force: bool = False,
    total_memory_bytes: int | None = None,
    on_progress: ProgressCallback | None = None,
) -> dict[str, Any]:
    selected = str(tier or "light").strip().lower()
    if selected not in SUPPORTED_TIERS:
        raise ValueError("Generative photo tier must be light, heavy, or all.")
    catalog = load_catalog()
    resolved_root = resolve_generative_root(root)
    resolved_root.mkdir(parents=True, exist_ok=True)
    restrict_file_mode(resolved_root, 0o700)
    memory = total_system_memory_bytes() if total_memory_bytes is None else max(0, int(total_memory_bytes))
    install_light = selected in {"light", "all"}
    install_heavy = selected in {"heavy", "all"}
    key = platform_key()
    if install_heavy:
        acknowledged = acknowledge_large_download is True or str(acknowledge_large_download).strip() == HEAVY_ACKNOWLEDGEMENT
        if not acknowledged:
            raise ValueError(f"Heavy installation requires acknowledgement: {HEAVY_ACKNOWLEDGEMENT}")
        if memory <= 0:
            raise PhotoGenerativeUnavailableError("Vintrace could not verify at least 48 GiB of memory for the heavy generative pack.")
        if memory < int(catalog["heavy"]["minimumMemoryBytes"]):
            raise PhotoGenerativeUnavailableError("The heavy generative pack requires at least 48 GiB of system memory.")
        if key not in catalog["heavy"]["runtime"]["platforms"]:
            raise PhotoGenerativeUnavailableError(f"No pinned heavy generative runtime is available for {key}.")
    jobs: list[tuple[dict[str, Any], Path]] = []
    runtime_jobs: list[tuple[str, dict[str, Any], Path]] = []
    if install_light:
        cleanup = catalog["light"]["cleanup"]["artifact"]
        jobs.append((cleanup, _artifact_path(resolved_root, "light", cleanup)))
        _runtime_key, _runtime, spec = _runtime_spec(catalog, "realesrgan")
        archive_path = _runtime_archive_path(resolved_root, "realesrgan", spec)
        jobs.append((spec, archive_path))
        runtime_jobs.append(("realesrgan", spec, archive_path))
    if install_heavy:
        for artifact in catalog["heavy"]["artifacts"]:
            jobs.append((artifact, _artifact_path(resolved_root, "heavy", artifact)))
        _runtime_key, _runtime, spec = _runtime_spec(catalog, "stable-diffusion.cpp")
        archive_path = _runtime_archive_path(resolved_root, "stable-diffusion.cpp", spec)
        jobs.append((spec, archive_path))
        runtime_jobs.append(("stable-diffusion.cpp", spec, archive_path))
    deduplicated: list[tuple[dict[str, Any], Path]] = []
    seen_destinations: set[str] = set()
    for spec, destination in jobs:
        if str(destination) not in seen_destinations:
            seen_destinations.add(str(destination))
            deduplicated.append((spec, destination))
    jobs = deduplicated
    total_bytes = sum(int(spec["sizeBytes"]) for spec, _ in jobs)
    completed: dict[str, int] = {}

    def emit(payload: dict[str, Any]) -> None:
        filename = str(payload.get("file", "") or "")
        file_bytes = max(0, int(payload.get("fileBytes", 0) or 0))
        current = next((spec for spec, destination in jobs if destination.name == filename), None)
        if current:
            file_bytes = min(file_bytes, int(current["sizeBytes"]))
        overall = min(total_bytes, sum(completed.values()) + file_bytes)
        event = {
            "tier": selected,
            "phase": str(payload.get("phase", "downloading")),
            "file": filename,
            "downloadedBytes": overall,
            "totalBytes": total_bytes,
            "percent": round(overall / max(1, total_bytes) * 100, 2),
            "message": str(payload.get("message", "") or "Installing local generative photo tools"),
            "root": str(resolved_root),
        }
        if on_progress:
            on_progress(event)

    for spec, destination in jobs:
        emit({"phase": "starting", "file": destination.name, "fileBytes": 0})
        _download_file(spec, destination, force=force, emit=emit)
        completed[destination.name] = int(spec["sizeBytes"])
    for runtime_id, spec, archive_path in runtime_jobs:
        destination = _runtime_dir(resolved_root, runtime_id, key)
        should_extract = force or not destination.is_dir()
        if not should_extract:
            try:
                verify_runtime(runtime_id, resolved_root, catalog)
            except PhotoGenerativeError:
                should_extract = True
        if should_extract:
            emit({"phase": "extracting", "file": str(spec["archive"]), "fileBytes": int(spec["sizeBytes"])})
            _extract_zip_runtime(archive_path, destination, executable_name=str(spec["executable"]))
    clear_verification_cache()
    result = photo_generative_status(resolved_root, total_memory_bytes=memory)
    emit({"phase": "complete", "file": "", "fileBytes": 0, "message": "Local generative photo tools are ready"})
    return {
        "installed": True,
        "tier": selected,
        "catalogVersion": str(catalog["version"]),
        "catalogSha256": CATALOG_SHA256,
        "root": str(resolved_root),
        "offlineInference": True,
        "status": result,
    }


def _clean_mask_rects(value: Any) -> list[dict[str, float | str]]:
    if not isinstance(value, list):
        raise ValueError("Clean Up requires a mask made from one or more brush regions.")
    if not value or len(value) > MAX_MASK_RECTS:
        raise ValueError(f"Clean Up requires 1-{MAX_MASK_RECTS} mask regions.")
    output: list[dict[str, float | str]] = []
    for raw in value:
        if not isinstance(raw, dict):
            raise ValueError("Each Clean Up mask region must be an object.")
        try:
            left = float(raw.get("left", raw.get("x", 0)))
            top = float(raw.get("top", raw.get("y", 0)))
            width = float(raw.get("width", raw.get("w", raw.get("size", 0))))
            height = float(raw.get("height", raw.get("h", raw.get("size", 0))))
        except (TypeError, ValueError) as exc:
            raise ValueError("Clean Up mask coordinates must be numeric percentages.") from exc
        if not all(math.isfinite(number) for number in (left, top, width, height)):
            raise ValueError("Clean Up mask coordinates must be finite.")
        left = max(0.0, min(99.0, left))
        top = max(0.0, min(99.0, top))
        width = max(0.25, min(100.0 - left, width))
        height = max(0.25, min(100.0 - top, height))
        output.append({"left": left, "top": top, "width": width, "height": height, "shape": "rectangle" if raw.get("shape") == "rectangle" else "ellipse"})
    return output


def _offline_subprocess_env() -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "NO_PROXY": "*",
            "no_proxy": "*",
            "HTTP_PROXY": "",
            "HTTPS_PROXY": "",
            "ALL_PROXY": "",
            "http_proxy": "",
            "https_proxy": "",
            "all_proxy": "",
        }
    )
    return env


def _save_png(image: Any, path: Path, *, icc_profile: bytes | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    image.save(temporary, format="PNG", optimize=False, icc_profile=icc_profile)
    temporary.replace(path)


def _lama_session(model_path: Path, model_sha256: str, ort: Any) -> Any:
    stat = model_path.stat()
    key = (str(model_path), int(stat.st_mtime_ns), int(stat.st_ctime_ns), model_sha256)
    with _LAMA_SESSION_LOCK:
        cached = _LAMA_SESSION_CACHE.get(key)
        if cached is not None:
            return cached
        available = set(ort.get_available_providers())
        providers: list[Any] = []
        if sys.platform == "darwin" and "CoreMLExecutionProvider" in available:
            providers.append(("CoreMLExecutionProvider", {"ModelFormat": "MLProgram", "MLComputeUnits": "ALL", "RequireStaticInputShapes": "1"}))
        providers.append("CPUExecutionProvider")
        options = ort.SessionOptions()
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        try:
            session = ort.InferenceSession(str(model_path), sess_options=options, providers=providers)
        except Exception:
            session = ort.InferenceSession(str(model_path), sess_options=options, providers=["CPUExecutionProvider"])
        _LAMA_SESSION_CACHE.clear()
        _LAMA_SESSION_CACHE[key] = session
        return session


def _run_lama_cleanup(source: Path, target: Path, params: dict[str, Any], root: Path, catalog: dict[str, Any]) -> dict[str, Any]:
    from PIL import Image, ImageDraw
    import numpy as np
    import onnxruntime as ort

    model = verify_cleanup_model(root, catalog)
    rects = _clean_mask_rects(params.get("maskRects", params.get("mask", [])))
    with Image.open(source) as opened:
        icc_profile = opened.info.get("icc_profile")
        original = opened.convert("RGB")
    width, height = original.size
    if width <= 0 or height <= 0 or width * height > 40_000_000:
        raise ValueError("Clean Up supports images up to 40 megapixels.")
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    for rect in rects:
        left = int(round(width * float(rect["left"]) / 100.0))
        top = int(round(height * float(rect["top"]) / 100.0))
        right = max(left + 1, int(round(width * (float(rect["left"]) + float(rect["width"])) / 100.0)))
        bottom = max(top + 1, int(round(height * (float(rect["top"]) + float(rect["height"])) / 100.0)))
        box = (max(0, left), max(0, top), min(width, right), min(height, bottom))
        if rect["shape"] == "rectangle":
            draw.rounded_rectangle(box, radius=max(1, min(box[2] - box[0], box[3] - box[1]) // 5), fill=255)
        else:
            draw.ellipse(box, fill=255)
    resampling = getattr(Image, "Resampling", Image)
    resized = original.resize((512, 512), resample=resampling.LANCZOS)
    resized_mask = mask.resize((512, 512), resample=resampling.NEAREST)
    image_array = np.asarray(resized, dtype=np.float32)[:, :, ::-1] / 255.0
    mask_array = (np.asarray(resized_mask, dtype=np.float32) / 255.0)[None, None, :, :]
    image_array = np.transpose(image_array, (2, 0, 1))[None, :, :, :]
    session = _lama_session(Path(str(model["path"])), str(model["sha256"]), ort)
    input_names = [item.name for item in session.get_inputs()]
    if len(input_names) != 2:
        raise PhotoGenerativeIntegrityError("The verified LaMa model input contract changed.")
    result = session.run(None, {input_names[0]: image_array, input_names[1]: mask_array})[0]
    output_array = np.asarray(result)[0]
    if output_array.shape[0] == 3:
        output_array = np.transpose(output_array, (1, 2, 0))
    if float(np.nanmax(output_array)) <= 2.0:
        output_array = output_array * 255.0
    output_array = np.clip(output_array, 0, 255).astype(np.uint8)[:, :, ::-1]
    generated = Image.fromarray(output_array, mode="RGB").resize((width, height), resample=resampling.LANCZOS)
    composed = original.copy()
    composed.paste(generated, (0, 0), mask)
    _save_png(composed, target, icc_profile=icc_profile)
    return {
        "width": width,
        "height": height,
        "model": {key: model[key] for key in ("id", "revision", "license", "filename", "sha256")},
        "runtime": {"id": "onnxruntime", "version": str(getattr(ort, "__version__", "")), "provider": session.get_providers()[0]},
        "parameters": {"maskRects": rects, "modelInputWidth": 512, "modelInputHeight": 512},
    }


def _run_realesrgan(source: Path, target: Path, params: dict[str, Any], root: Path, catalog: dict[str, Any], timeout: float) -> dict[str, Any]:
    from PIL import Image

    runtime = verify_runtime("realesrgan", root, catalog)
    try:
        scale = int(params.get("scale", 2) or 2)
    except (TypeError, ValueError) as exc:
        raise ValueError("Upscale must be 2x or 4x.") from exc
    if scale not in {2, 4}:
        raise ValueError("Upscale must be 2x or 4x.")
    try:
        tile = int(params.get("tile", 128) or 128)
    except (TypeError, ValueError):
        tile = 128
    tile = max(64, min(512, tile))
    with Image.open(source) as opened:
        icc_profile = opened.info.get("icc_profile")
        original = opened.convert("RGB")
    width, height = original.size
    if width <= 0 or height <= 0 or width * height > 20_000_000:
        raise ValueError("Upscale supports source images up to 20 megapixels.")
    target_width, target_height = width * scale, height * scale
    if target_width > 16_384 or target_height > 16_384 or target_width * target_height > 100_000_000:
        raise ValueError("The requested upscale would exceed the 100 megapixel output limit.")
    with tempfile.TemporaryDirectory(prefix="vintrace-upscale-") as directory_value:
        directory = Path(directory_value)
        input_path = directory / "input.png"
        output_path = directory / "output.png"
        original.save(input_path, format="PNG", optimize=False)
        command = [
            str(runtime["executable"]),
            "-i",
            str(input_path),
            "-o",
            str(output_path),
            "-n",
            str(runtime["modelName"]),
            "-s",
            "4",
            "-t",
            str(tile),
            "-m",
            str(runtime["modelDirectory"]),
            "-f",
            "png",
        ]
        try:
            completed = subprocess.run(
                command,
                cwd=str(runtime["runtimeDirectory"]),
                env=_offline_subprocess_env(),
                check=False,
                capture_output=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise PhotoGenerativeUnavailableError("Real-ESRGAN exceeded the local inference time limit.") from exc
        if completed.returncode != 0 or not output_path.is_file():
            raise PhotoGenerativeUnavailableError("Real-ESRGAN could not run on the available local graphics runtime.")
        with Image.open(output_path) as generated_opened:
            generated = generated_opened.convert("RGB")
            if generated.size != (width * 4, height * 4):
                raise PhotoGenerativeIntegrityError("Real-ESRGAN returned an unexpected output size.")
            if scale == 2:
                generated = generated.resize((target_width, target_height), resample=getattr(Image, "Resampling", Image).LANCZOS)
            _save_png(generated, target, icc_profile=icc_profile)
    upscale = catalog["light"]["upscale"]
    return {
        "width": target_width,
        "height": target_height,
        "model": {
            "id": str(upscale["id"]),
            "revision": str(upscale["revision"]),
            "license": str(upscale["license"]),
            "name": str(upscale["modelName"]),
        },
        "runtime": {key: runtime[key] for key in ("id", "tag", "revision", "license", "platform", "archiveSha256")},
        "parameters": {"scale": scale, "nativeModelScale": 4, "tile": tile},
    }


def _clean_prompt(value: Any) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return " ".join(text.split())[:MAX_PROMPT_CHARS]


def _aspect_ratio(value: Any, source_width: int, source_height: int) -> tuple[str, float]:
    key = str(value or "original").strip().lower()
    ratios = {
        "square": 1.0,
        "1:1": 1.0,
        "landscape": 16 / 9,
        "16:9": 16 / 9,
        "portrait": 4 / 5,
        "4:5": 4 / 5,
        "9:16": 9 / 16,
        "4:3": 4 / 3,
        "3:4": 3 / 4,
    }
    if key in {"", "original", "source"}:
        return "original", source_width / max(1, source_height)
    if key not in ratios:
        raise ValueError("Choose a supported output aspect ratio.")
    return key, ratios[key]


def _qwen_dimensions(width: int, height: int, aspect: float) -> tuple[int, int]:
    source_area = max(512 * 512, min(1_572_864, width * height))
    target_width = math.sqrt(source_area * aspect)
    target_height = target_width / aspect
    output_width = max(512, min(1536, int(round(target_width / 64)) * 64))
    output_height = max(512, min(1536, int(round(target_height / 64)) * 64))
    while output_width * output_height > 1_572_864:
        if output_width >= output_height:
            output_width -= 64
        else:
            output_height -= 64
    return output_width, output_height


def build_qwen_command(
    *,
    executable: str,
    diffusion_model: str,
    vae: str,
    text_encoder: str,
    reference: str,
    output: str,
    prompt: str,
    width: int,
    height: int,
    seed: int,
    steps: int,
) -> list[str]:
    return [
        executable,
        "--diffusion-model",
        diffusion_model,
        "--vae",
        vae,
        "--llm",
        text_encoder,
        "-r",
        reference,
        "-p",
        prompt,
        "-o",
        output,
        "--width",
        str(width),
        "--height",
        str(height),
        "--steps",
        str(steps),
        "--cfg-scale",
        "2.5",
        "--sampling-method",
        "euler",
        "--seed",
        str(seed),
        "--flow-shift",
        "3",
        "--offload-to-cpu",
        "--diffusion-fa",
        "--vae-tiling",
        "--auto-fit",
        "--model-args",
        "qwen_image_zero_cond_t=true",
    ]


def _run_qwen_edit(source: Path, target: Path, mode: str, params: dict[str, Any], root: Path, catalog: dict[str, Any], timeout: float) -> dict[str, Any]:
    from PIL import Image

    memory = total_system_memory_bytes()
    minimum = int(catalog["heavy"]["minimumMemoryBytes"])
    if memory <= 0:
        raise PhotoGenerativeUnavailableError("Vintrace could not verify at least 48 GiB of memory for Qwen Image Edit.")
    if memory < minimum:
        raise PhotoGenerativeUnavailableError("Qwen Image Edit requires at least 48 GiB of system memory.")
    runtime = verify_runtime("stable-diffusion.cpp", root, catalog)
    models = verify_heavy_models(root, catalog)
    by_role = {item["role"]: item for item in models["artifacts"]}
    with Image.open(source) as opened:
        source_width, source_height = opened.size
        reference_image = opened.convert("RGB")
    aspect_key, ratio = _aspect_ratio(params.get("aspect", params.get("targetAspect", "original")), source_width, source_height)
    output_width, output_height = _qwen_dimensions(source_width, source_height, ratio)
    try:
        seed = max(0, min(2_147_483_647, int(params.get("seed", 42) or 42)))
        steps = max(8, min(40, int(params.get("steps", 20) or 20)))
    except (TypeError, ValueError) as exc:
        raise ValueError("Seed and step count must be integers.") from exc
    target_age_bucket = ""
    target_age = 0
    if mode == "age-progress":
        target_age_bucket = str(params.get("targetAgeBucket", "") or "").strip().casefold().replace("_", "-")
        if target_age_bucket not in AGE_PROGRESS_TARGETS:
            raise ValueError("Choose child, adolescent, adult, older-adult, or senior as the target age range.")
        target_age = AGE_PROGRESS_TARGETS[target_age_bucket]
        if _clean_prompt(params.get("prompt", "")):
            raise ValueError("Synthetic age-reference generation uses a fixed safety prompt and does not accept custom instructions.")
        user_prompt = ""
    else:
        user_prompt = _clean_prompt(params.get("prompt", ""))
    instructions = {
        "expand": "Extend the image naturally into the new canvas. Preserve all existing people, identity, objects, text, geometry, and lighting exactly; synthesize only the newly exposed surroundings.",
        "reframe": "Reframe this photograph for the requested aspect ratio. Preserve people, identity, important objects, text, and photographic realism; use content-aware extension instead of cropping important subjects.",
        "relight": "Relight this photograph while preserving people, identity, pose, objects, text, composition, and fine detail. Do not add or remove subjects.",
    }
    prompt = age_progress_prompt(target_age_bucket) if mode == "age-progress" else instructions[mode]
    if user_prompt:
        prompt += f" Requested direction: {user_prompt}"
    with tempfile.TemporaryDirectory(prefix="vintrace-qwen-edit-") as directory_value:
        directory = Path(directory_value)
        reference = directory / "reference.png"
        output = directory / "output.png"
        reference_image.save(reference, format="PNG", optimize=False)
        command = build_qwen_command(
            executable=str(runtime["executable"]),
            diffusion_model=str(by_role["diffusion-model"]["path"]),
            vae=str(by_role["vae"]["path"]),
            text_encoder=str(by_role["text-encoder"]["path"]),
            reference=str(reference),
            output=str(output),
            prompt=prompt,
            width=output_width,
            height=output_height,
            seed=seed,
            steps=steps,
        )
        try:
            completed = subprocess.run(
                command,
                cwd=str(runtime["runtimeDirectory"]),
                env=_offline_subprocess_env(),
                check=False,
                capture_output=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as exc:
            raise PhotoGenerativeUnavailableError("Qwen Image Edit exceeded the local inference time limit.") from exc
        if completed.returncode != 0 or not output.is_file():
            raise PhotoGenerativeUnavailableError("Qwen Image Edit could not complete on this computer.")
        with Image.open(output) as generated_opened:
            generated = generated_opened.convert("RGB")
            if generated.size != (output_width, output_height):
                generated = generated.resize((output_width, output_height), resample=getattr(Image, "Resampling", Image).LANCZOS)
            _save_png(generated, target)
    heavy = catalog["heavy"]
    return {
        "width": output_width,
        "height": output_height,
        "model": {"id": str(heavy["id"]), "revision": str(heavy["revision"]), "license": str(heavy["license"])},
        "runtime": {key: runtime[key] for key in ("id", "tag", "revision", "license", "platform", "archiveSha256")},
        "parameters": {
            "aspect": aspect_key,
            "prompt": user_prompt,
            "seed": seed,
            "steps": steps,
            "cfgScale": 2.5,
            "flowShift": 3,
            **(
                {
                    "targetAgeBucket": target_age_bucket,
                    "targetAgeYears": target_age,
                    "fixedSafetyPrompt": True,
                    "promptVersion": AGE_PROGRESS_PROMPT_VERSION,
                    "promptSha256": age_progress_prompt_sha256(target_age_bucket),
                }
                if mode == "age-progress"
                else {}
            ),
        },
    }


def run_photo_generative_edit(
    mode: str,
    source: Path | str,
    target: Path | str,
    params: dict[str, Any] | None = None,
    *,
    root: Path | str | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    selected_mode = str(mode or "").strip().lower()
    if selected_mode not in SUPPORTED_MODES:
        raise ValueError("Generative edit mode must be cleanup, upscale, expand, reframe, relight, or age-progress.")
    source_path = Path(source).expanduser().resolve()
    target_path = Path(target).expanduser().resolve()
    if not source_path.is_file():
        raise FileNotFoundError("The generative edit source is unavailable.")
    if source_path == target_path:
        raise ValueError("Generative edits cannot overwrite the source image.")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    resolved_root = resolve_generative_root(root)
    catalog = load_catalog()
    parameters = dict(params or {})
    started = time.monotonic()
    source_sha256 = hash_file(source_path)
    if selected_mode == "cleanup":
        detail = _run_lama_cleanup(source_path, target_path, parameters, resolved_root, catalog)
        tier = "light"
    elif selected_mode == "upscale":
        detail = _run_realesrgan(source_path, target_path, parameters, resolved_root, catalog, float(timeout or 900.0))
        tier = "light"
    else:
        detail = _run_qwen_edit(source_path, target_path, selected_mode, parameters, resolved_root, catalog, float(timeout or 7200.0))
        tier = "heavy"
    if not target_path.is_file() or target_path.stat().st_size <= 0:
        raise PhotoGenerativeIntegrityError("The local generative runtime did not create an output artifact.")
    output_sha256 = hash_file(target_path)
    duration = round(time.monotonic() - started, 6)
    provenance = {
        "schemaVersion": 1,
        "aiGenerated": True,
        "offlineInference": True,
        "catalogVersion": str(catalog["version"]),
        "catalogSha256": CATALOG_SHA256,
        "mode": selected_mode,
        "tier": tier,
        "sourceSha256": source_sha256,
        "outputSha256": output_sha256,
        "model": detail["model"],
        "runtime": detail["runtime"],
        "parameters": detail["parameters"],
    }
    return {
        "mode": selected_mode,
        "tier": tier,
        "outputPath": str(target_path),
        "outputSha256": output_sha256,
        "sourceSha256": source_sha256,
        "width": int(detail["width"]),
        "height": int(detail["height"]),
        "durationSeconds": duration,
        "offlineInference": True,
        "aiGenerated": True,
        "provenance": provenance,
    }

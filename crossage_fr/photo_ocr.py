"""Integrity-checked, offline PP-OCRv6 inference through RapidOCR."""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import sys
from typing import Any


MODEL_ID = "vintrace-ppocrv6-small-rapidocr"
MODEL_VERSION = "2026-07-12.1"
RUNTIME_PACKAGE = "rapidocr"
RUNTIME_VERSION = "3.9.1"
MANIFEST_FILENAME = "manifest.json"
MANIFEST_SHA256 = "d6edb509c8f5b302004bd68787fdc3e5e266a2b230915fec7455bd264d282d2f"
LICENSE_FILENAME = "LICENSE"
LICENSE_SHA256 = "3e0af25fdd06aa9586ae97adb00ea927ebe5a3805ac77d2d3a81ce5f55693333"

ARTIFACTS = {
    "detector": {
        "filename": "PP-OCRv6_det_small.onnx",
        "sizeBytes": 9_929_594,
        "sha256": "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f",
    },
    "recognizer": {
        "filename": "PP-OCRv6_rec_small.onnx",
        "sizeBytes": 21_234_383,
        "sha256": "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884",
    },
    "orientation-classifier": {
        "filename": "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
        "sizeBytes": 585_532,
        "sha256": "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c",
    },
}


class PpOcrV6Error(RuntimeError):
    """Base error for the local PP-OCRv6 worker."""


class PpOcrV6IntegrityError(PpOcrV6Error):
    """Raised when a bundled artifact differs from its release pin."""


class PpOcrV6UnavailableError(PpOcrV6Error):
    """Raised when the verified model pack or its runtime cannot start."""


class PpOcrV6InferenceError(PpOcrV6Error):
    """Raised when a verified worker cannot process one image."""


@dataclass(frozen=True, slots=True)
class PpOcrV6Spec:
    root: Path
    manifest_path: Path
    license_path: Path
    detector_path: Path
    recognizer_path: Path
    classifier_path: Path

    @property
    def files(self) -> tuple[Path, ...]:
        return (
            self.manifest_path,
            self.license_path,
            self.detector_path,
            self.recognizer_path,
            self.classifier_path,
        )


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _unique_paths(paths: list[Path]) -> list[Path]:
    result: list[Path] = []
    seen: set[str] = set()
    for path in paths:
        try:
            key = str(path.expanduser().resolve())
        except OSError:
            key = str(path.expanduser())
        if key in seen:
            continue
        seen.add(key)
        result.append(Path(key))
    return result


def ppocrv6_model_directories(root: Path | None = None) -> list[Path]:
    if root is not None:
        explicit = Path(root).expanduser()
        return _unique_paths([explicit / "models" / "ocr", explicit])

    directories: list[Path] = []
    if not _is_packaged():
        env_root = str(os.environ.get("CROSSAGE_PP_OCRV6_MODEL_DIR", "") or "").strip()
        if env_root:
            directories.append(Path(env_root).expanduser())
    bundle_root = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if bundle_root:
        directories.append(Path(bundle_root) / "models" / "ocr")
    executable = Path(sys.executable).resolve()
    for parent in (executable.parent, executable.parent.parent, executable.parent.parent.parent):
        directories.append(parent / "models" / "ocr")
    directories.append(Path(__file__).resolve().parents[1] / "models" / "ocr")
    if not _is_packaged():
        directories.append(Path.cwd() / "models" / "ocr")
    return _unique_paths(directories)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _spec_for_directory(directory: Path) -> PpOcrV6Spec:
    return PpOcrV6Spec(
        root=directory,
        manifest_path=directory / MANIFEST_FILENAME,
        license_path=directory / LICENSE_FILENAME,
        detector_path=directory / str(ARTIFACTS["detector"]["filename"]),
        recognizer_path=directory / str(ARTIFACTS["recognizer"]["filename"]),
        classifier_path=directory / str(ARTIFACTS["orientation-classifier"]["filename"]),
    )


def _candidate_specs(root: Path | None = None) -> list[PpOcrV6Spec]:
    return [_spec_for_directory(directory) for directory in ppocrv6_model_directories(root)]


def _spec_token(spec: PpOcrV6Spec) -> tuple[tuple[str, int, int, int], ...]:
    token: list[tuple[str, int, int, int]] = []
    for path in spec.files:
        try:
            stat = path.stat()
            token.append((path.name, int(stat.st_size), int(stat.st_mtime_ns), int(stat.st_ctime_ns)))
        except OSError:
            token.append((path.name, -1, -1, -1))
    return tuple(token)


def _runtime_status() -> tuple[bool, str, str]:
    if importlib.util.find_spec(RUNTIME_PACKAGE) is None:
        return False, "", f"{RUNTIME_PACKAGE} {RUNTIME_VERSION} is not installed."
    try:
        installed = importlib.metadata.version(RUNTIME_PACKAGE)
    except importlib.metadata.PackageNotFoundError:
        return False, "", f"{RUNTIME_PACKAGE} {RUNTIME_VERSION} is not installed."
    if installed != RUNTIME_VERSION:
        return False, installed, f"Expected {RUNTIME_PACKAGE} {RUNTIME_VERSION}, found {installed}."
    if importlib.util.find_spec("onnxruntime") is None:
        return False, installed, "ONNX Runtime is not installed."
    return True, installed, ""


@lru_cache(maxsize=8)
def _validated_manifest(spec: PpOcrV6Spec, token: tuple[tuple[str, int, int, int], ...]) -> dict[str, Any]:
    del token
    missing = [path.name for path in spec.files if not path.is_file()]
    if missing:
        raise PpOcrV6UnavailableError(f"PP-OCRv6 model pack is incomplete: {', '.join(missing)}")
    if _sha256_file(spec.manifest_path) != MANIFEST_SHA256:
        raise PpOcrV6IntegrityError("PP-OCRv6 manifest checksum does not match the release pin.")
    try:
        manifest = json.loads(spec.manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PpOcrV6IntegrityError(f"PP-OCRv6 manifest is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise PpOcrV6IntegrityError("PP-OCRv6 manifest must be a JSON object.")
    runtime = manifest.get("runtime") if isinstance(manifest.get("runtime"), dict) else {}
    expected_manifest = {
        "schemaVersion": 1,
        "modelId": MODEL_ID,
        "version": MODEL_VERSION,
        "engine": "onnxruntime-cpu",
        "offline": True,
        "license": "Apache-2.0",
        "licenseFile": LICENSE_FILENAME,
        "licenseSha256": LICENSE_SHA256,
    }
    for key, expected in expected_manifest.items():
        if manifest.get(key) != expected:
            raise PpOcrV6IntegrityError(f"PP-OCRv6 manifest {key} does not match the release pin.")
    if runtime.get("package") != RUNTIME_PACKAGE or runtime.get("version") != RUNTIME_VERSION:
        raise PpOcrV6IntegrityError("PP-OCRv6 runtime package pin is invalid.")
    if _sha256_file(spec.license_path) != LICENSE_SHA256:
        raise PpOcrV6IntegrityError("PP-OCRv6 Apache-2.0 license is missing or changed.")

    artifacts = manifest.get("artifacts") if isinstance(manifest.get("artifacts"), list) else []
    by_role = {
        str(item.get("role", "") or ""): item
        for item in artifacts
        if isinstance(item, dict) and str(item.get("role", "") or "")
    }
    if set(by_role) != set(ARTIFACTS):
        raise PpOcrV6IntegrityError("PP-OCRv6 manifest artifact roles are incomplete or unexpected.")
    path_by_role = {
        "detector": spec.detector_path,
        "recognizer": spec.recognizer_path,
        "orientation-classifier": spec.classifier_path,
    }
    for role, expected in ARTIFACTS.items():
        row = by_role[role]
        path = path_by_role[role]
        if (
            row.get("filename") != expected["filename"]
            or int(row.get("sizeBytes", -1) or -1) != expected["sizeBytes"]
            or row.get("sha256") != expected["sha256"]
            or path.name != expected["filename"]
        ):
            raise PpOcrV6IntegrityError(f"PP-OCRv6 {role} manifest pin is invalid.")
        if path.stat().st_size != expected["sizeBytes"]:
            raise PpOcrV6IntegrityError(f"PP-OCRv6 {role} size does not match the release pin.")
        if _sha256_file(path) != expected["sha256"]:
            raise PpOcrV6IntegrityError(f"PP-OCRv6 {role} checksum does not match the release pin.")
    return manifest


def _verified_spec(root: Path | None = None) -> tuple[PpOcrV6Spec, dict[str, Any]]:
    errors: list[PpOcrV6Error] = []
    saw_candidate = False
    for spec in _candidate_specs(root):
        if not any(path.exists() for path in spec.files):
            continue
        saw_candidate = True
        try:
            return spec, _validated_manifest(spec, _spec_token(spec))
        except PpOcrV6Error as exc:
            errors.append(exc)
    if errors:
        raise errors[0]
    if saw_candidate:
        raise PpOcrV6UnavailableError("No complete local PP-OCRv6 model pack was found.")
    raise PpOcrV6UnavailableError("The bundled PP-OCRv6 model pack is missing.")


def _public_provenance(manifest: dict[str, Any]) -> dict[str, Any]:
    runtime = manifest.get("runtime") if isinstance(manifest.get("runtime"), dict) else {}
    artifacts = manifest.get("artifacts") if isinstance(manifest.get("artifacts"), list) else []
    return {
        "modelId": MODEL_ID,
        "modelVersion": MODEL_VERSION,
        "modelFamily": "PaddleOCR PP-OCRv6 small multilingual",
        "runtimePackage": RUNTIME_PACKAGE,
        "runtimeVersion": RUNTIME_VERSION,
        "runtimeReleaseCommit": str(runtime.get("releaseCommit", "") or ""),
        "engine": "onnxruntime-cpu",
        "offline": True,
        "license": "Apache-2.0",
        "artifacts": {
            str(item.get("role", "") or ""): {
                "filename": str(item.get("filename", "") or ""),
                "sizeBytes": int(item.get("sizeBytes", 0) or 0),
                "sha256": str(item.get("sha256", "") or ""),
            }
            for item in artifacts
            if isinstance(item, dict) and str(item.get("role", "") or "")
        },
    }


@lru_cache(maxsize=4)
def _engine_for_spec(spec: PpOcrV6Spec, token: tuple[tuple[str, int, int, int], ...]) -> Any:
    manifest = _validated_manifest(spec, token)
    runtime_ready, _installed, reason = _runtime_status()
    if not runtime_ready:
        raise PpOcrV6UnavailableError(reason)
    try:
        from rapidocr import RapidOCR

        engine = RapidOCR(
            params={
                "Global.model_root_dir": str(spec.root),
                "Global.log_level": "error",
                "EngineConfig.onnxruntime.intra_op_num_threads": 1,
                "EngineConfig.onnxruntime.inter_op_num_threads": 1,
                "EngineConfig.onnxruntime.enable_cpu_mem_arena": False,
                "EngineConfig.onnxruntime.use_cuda": False,
                "EngineConfig.onnxruntime.use_dml": False,
                "EngineConfig.onnxruntime.use_cann": False,
                "EngineConfig.onnxruntime.use_coreml": False,
                "Det.model_path": str(spec.detector_path),
                "Cls.model_path": str(spec.classifier_path),
                "Rec.model_path": str(spec.recognizer_path),
            }
        )
    except PpOcrV6Error:
        raise
    except Exception as exc:
        raise PpOcrV6UnavailableError(f"PP-OCRv6 runtime could not start: {exc}") from exc
    setattr(engine, "_vintrace_model_provenance", _public_provenance(manifest))
    return engine


def _box_payload(value: Any) -> list[list[float]]:
    try:
        rows = value.tolist() if hasattr(value, "tolist") else value
    except Exception:
        return []
    if not isinstance(rows, (list, tuple)):
        return []
    box: list[list[float]] = []
    for point in rows:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            x, y = float(point[0]), float(point[1])
        except (TypeError, ValueError):
            continue
        if math.isfinite(x) and math.isfinite(y):
            box.append([round(x, 3), round(y, 3)])
    return box if len(box) >= 4 else []


def run_ppocrv6(source: Path | str, *, root: Path | None = None) -> dict[str, Any]:
    source_path = Path(source).expanduser()
    if not source_path.is_file():
        raise PpOcrV6InferenceError(f"OCR source image is missing: {source_path}")
    spec, manifest = _verified_spec(root)
    engine = _engine_for_spec(spec, _spec_token(spec))
    try:
        output = engine(str(source_path))
    except Exception as exc:
        raise PpOcrV6InferenceError(f"PP-OCRv6 inference failed: {exc}") from exc
    if not all(hasattr(output, name) for name in ("boxes", "txts", "scores", "elapse")):
        raise PpOcrV6InferenceError("PP-OCRv6 returned an unexpected runtime output contract.")

    boxes = getattr(output, "boxes", None)
    texts = getattr(output, "txts", None)
    scores = getattr(output, "scores", None)
    if boxes is None or texts is None or scores is None:
        lines: list[dict[str, Any]] = []
    else:
        lines = []
        for box, text, score in zip(boxes, texts, scores):
            clean_text = re.sub(r"\s+", " ", str(text or "")).strip()
            if not clean_text:
                continue
            try:
                confidence = float(score)
            except (TypeError, ValueError):
                confidence = 0.0
            if not math.isfinite(confidence):
                confidence = 0.0
            lines.append(
                {
                    "text": clean_text[:500],
                    "confidence": round(max(0.0, min(1.0, confidence)), 4),
                    "box": _box_payload(box),
                }
            )
    text = re.sub(r"\s+", " ", " ".join(line["text"] for line in lines)).strip()[:50_000]
    try:
        elapsed_ms = max(0.0, float(getattr(output, "elapse", 0.0) or 0.0) * 1000.0)
    except (TypeError, ValueError):
        elapsed_ms = 0.0
    return {
        "text": text,
        "lines": lines,
        "elapsedMs": round(elapsed_ms, 3),
        "provenance": _public_provenance(manifest),
    }


def ppocrv6_model_report(root: Path | None = None, *, validate_runtime: bool = False) -> dict[str, Any]:
    try:
        spec, manifest = _verified_spec(root)
    except PpOcrV6Error as exc:
        return {
            "available": False,
            "verified": False,
            "runtimeReady": False,
            "engine": "unavailable",
            "modelId": MODEL_ID,
            "version": MODEL_VERSION,
            "license": "Apache-2.0",
            "reason": str(exc),
        }
    runtime_ready, installed_version, reason = _runtime_status()
    if validate_runtime and runtime_ready:
        try:
            _engine_for_spec(spec, _spec_token(spec))
        except PpOcrV6Error as exc:
            runtime_ready = False
            reason = str(exc)
    provenance = _public_provenance(manifest)
    return {
        "available": bool(runtime_ready),
        "verified": True,
        "runtimeReady": bool(runtime_ready),
        "runtimeValidated": bool(validate_runtime and runtime_ready),
        "installedRuntimeVersion": installed_version,
        "manifestSha256": MANIFEST_SHA256,
        "path": str(spec.root),
        "manifestPath": str(spec.manifest_path),
        "reason": reason,
        **provenance,
    }


def clear_ppocrv6_caches() -> None:
    """Clear model/runtime caches for integrity and packaging tests."""
    _validated_manifest.cache_clear()
    _engine_for_spec.cache_clear()

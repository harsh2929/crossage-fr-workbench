"""Integrity-checked eDifFIQA(T) inference for aligned face crops."""

from __future__ import annotations

from functools import lru_cache
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np


FIQA_MANIFEST_FILENAME = "manifest.json"
FIQA_MODEL_ID = "opencv-ediffiqa-tiny-jun2024"
FIQA_MODEL_FILENAME = "ediffiqa_tiny_jun2024.onnx"
FIQA_MODEL_SHA256 = "9426c899cc0f01665240cb7d9e7f98e18e24e456c178326c771a43da289bfc6a"
FIQA_MODEL_SIZE_BYTES = 7_272_678
FIQA_LICENSE = "CC-BY-4.0"
FIQA_LICENSE_SHA256 = "9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94"


class FiqaIntegrityError(RuntimeError):
    """Raised when the FIQA model or its attribution metadata was changed."""


def effective_quality(norm_quality: float, fiqa_score: float | None) -> float:
    """Prefer recognition-aware FIQA over the embedding-norm proxy."""
    if fiqa_score is None:
        return float(norm_quality)
    return max(0.0, min(1.0, float(fiqa_score)))


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


def fiqa_model_directories(root: Path | None = None) -> list[Path]:
    if root is not None:
        explicit = Path(root).expanduser()
        return _unique_paths([explicit / "models" / "fiq", explicit])

    directories: list[Path] = []
    bundle_root = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if bundle_root:
        directories.append(Path(bundle_root) / "models" / "fiq")
    executable = Path(sys.executable).resolve()
    for parent in (executable.parent, executable.parent.parent, executable.parent.parent.parent):
        directories.append(parent / "models" / "fiq")
    directories.append(Path(__file__).resolve().parents[2] / "models" / "fiq")
    if not _is_packaged():
        directories.append(Path.cwd() / "models" / "fiq")
    return _unique_paths(directories)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _allow_unverified_model() -> bool:
    return not _is_packaged() and os.environ.get("CROSSAGE_FIQA_ALLOW_UNVERIFIED", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def verify_fiqa_model(model_path: Path, *, allow_unverified: bool = False) -> dict[str, Any]:
    path = Path(model_path).expanduser().resolve()
    if not path.is_file():
        raise FiqaIntegrityError(f"FIQA model is missing: {path}")
    manifest_path = path.parent / FIQA_MANIFEST_FILENAME
    if not manifest_path.is_file():
        if allow_unverified and _allow_unverified_model():
            return {
                "verified": False,
                "modelId": "unverified-development-model",
                "modelName": path.stem,
                "filename": path.name,
                "path": str(path),
                "license": "unknown",
                "sizeBytes": path.stat().st_size,
                "sha256": _sha256_file(path),
            }
        raise FiqaIntegrityError(f"FIQA integrity manifest is missing: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FiqaIntegrityError(f"FIQA integrity manifest is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise FiqaIntegrityError("FIQA integrity manifest must be a JSON object.")

    expected = {
        "schemaVersion": 1,
        "modelId": FIQA_MODEL_ID,
        "filename": FIQA_MODEL_FILENAME,
        "sha256": FIQA_MODEL_SHA256,
        "sizeBytes": FIQA_MODEL_SIZE_BYTES,
        "license": FIQA_LICENSE,
        "licenseSha256": FIQA_LICENSE_SHA256,
    }
    for key, expected_value in expected.items():
        if manifest.get(key) != expected_value:
            raise FiqaIntegrityError(
                f"FIQA manifest {key} mismatch: expected {expected_value!r}, found {manifest.get(key)!r}."
            )
    if path.name != FIQA_MODEL_FILENAME:
        raise FiqaIntegrityError(f"Unexpected FIQA model filename: {path.name}")
    size_bytes = path.stat().st_size
    if size_bytes != FIQA_MODEL_SIZE_BYTES:
        raise FiqaIntegrityError(
            f"FIQA model size mismatch: expected {FIQA_MODEL_SIZE_BYTES}, found {size_bytes}."
        )
    digest = _sha256_file(path)
    if digest != FIQA_MODEL_SHA256:
        raise FiqaIntegrityError("FIQA model checksum mismatch.")

    license_name = str(manifest.get("licenseFile", "LICENSE") or "LICENSE")
    if Path(license_name).name != license_name:
        raise FiqaIntegrityError("FIQA license filename is unsafe.")
    license_path = path.parent / license_name
    if not license_path.is_file() or _sha256_file(license_path) != FIQA_LICENSE_SHA256:
        raise FiqaIntegrityError("FIQA CC-BY-4.0 attribution license is missing or changed.")
    return {
        **manifest,
        "verified": True,
        "path": str(path),
        "manifestPath": str(manifest_path),
        "licensePath": str(license_path),
        "sizeBytes": size_bytes,
        "sha256": digest,
    }


def _candidate_model_paths(root: Path | None = None) -> list[Path]:
    candidates: list[Path] = []
    if not _is_packaged():
        env_path = os.environ.get("CROSSAGE_FIQA_MODEL", "").strip()
        if env_path:
            candidates.append(Path(env_path).expanduser())
    for directory in fiqa_model_directories(root):
        manifest_path = directory / FIQA_MANIFEST_FILENAME
        if manifest_path.is_file():
            try:
                body = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                body = {}
            filename = str(body.get("filename", "") or "") if isinstance(body, dict) else ""
            if filename and Path(filename).name == filename:
                candidates.append(directory / filename)
        candidates.append(directory / FIQA_MODEL_FILENAME)
    return _unique_paths(candidates)


def find_fiqa_model(root: Path | None = None) -> Path | None:
    """Return the first integrity-valid eDifFIQA(T) model in a trusted root."""
    for candidate in _candidate_model_paths(root):
        if not candidate.is_file():
            continue
        try:
            verify_fiqa_model(candidate, allow_unverified=True)
        except FiqaIntegrityError:
            continue
        return candidate
    return None


@lru_cache(maxsize=4)
def _session_for_model(model_path: str, signature: tuple[int, int]) -> object:
    del signature
    import onnxruntime

    return onnxruntime.InferenceSession(model_path, providers=["CPUExecutionProvider"])


class FiqaScorer:
    """Scores an aligned 112x112 BGR face in [0, 1] with eDifFIQA(T)."""

    def __init__(
        self,
        session: object,
        input_name: str,
        *,
        input_size: int = 112,
        model_info: dict[str, Any] | None = None,
    ) -> None:
        self._session = session
        self._input_name = input_name
        self._input_size = input_size
        self.model_info = dict(model_info or {})

    def preprocess(self, aligned_bgr: np.ndarray) -> np.ndarray:
        import cv2

        image = np.asarray(aligned_bgr)
        if image.ndim != 3 or image.shape[2] != 3:
            raise ValueError("FIQA requires a three-channel aligned BGR face crop.")
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        if rgb.shape[0] != self._input_size or rgb.shape[1] != self._input_size:
            rgb = cv2.resize(rgb, (self._input_size, self._input_size), interpolation=cv2.INTER_LINEAR)
        tensor = (rgb.astype("float32") / np.float32(127.5)) - np.float32(1.0)
        return np.ascontiguousarray(tensor.transpose(2, 0, 1)[None, ...], dtype="float32")

    def score_aligned(self, aligned_bgr: np.ndarray) -> float:
        tensor = self.preprocess(aligned_bgr)
        output = self._session.run(None, {self._input_name: tensor})
        if not output:
            raise RuntimeError("FIQA model returned no output.")
        values = np.asarray(output[0], dtype="float32").reshape(-1)
        if values.size != 1 or not math.isfinite(float(values[0])):
            raise RuntimeError("FIQA model returned an invalid quality score.")
        return max(0.0, min(1.0, float(values[0])))


def load_fiqa_scorer(model_path: Path | None = None) -> FiqaScorer | None:
    """Load the verified eDifFIQA(T) model, or return None when unavailable."""
    path = Path(model_path).expanduser() if model_path is not None else find_fiqa_model()
    if path is None or not path.is_file() or importlib.util.find_spec("onnxruntime") is None:
        return None
    try:
        model_info = verify_fiqa_model(path, allow_unverified=True)
        stat = path.stat()
        session = _session_for_model(str(path.resolve()), (int(stat.st_size), int(stat.st_mtime_ns)))
        inputs = list(session.get_inputs())
        outputs = list(session.get_outputs())
        if len(inputs) != 1 or not outputs:
            raise RuntimeError("FIQA ONNX model has an unexpected input/output contract.")
        input_meta = inputs[0]
        input_shape = list(getattr(input_meta, "shape", []) or [])
        if len(input_shape) != 4 or input_shape[1:] != [3, 112, 112]:
            raise RuntimeError(f"FIQA ONNX input shape is unsupported: {input_shape}")
        if str(getattr(input_meta, "type", "")) != "tensor(float)":
            raise RuntimeError("FIQA ONNX input must be float32.")
        return FiqaScorer(
            session,
            str(input_meta.name),
            input_size=112,
            model_info=model_info,
        )
    except Exception:
        return None


def fiqa_model_report(root: Path | None = None, *, validate_runtime: bool = False) -> dict[str, Any]:
    errors: list[str] = []
    for candidate in _candidate_model_paths(root):
        if not candidate.is_file():
            continue
        try:
            info = verify_fiqa_model(candidate, allow_unverified=True)
        except FiqaIntegrityError as exc:
            errors.append(str(exc))
            continue
        runtime_ready = importlib.util.find_spec("onnxruntime") is not None
        if validate_runtime and runtime_ready:
            runtime_ready = load_fiqa_scorer(candidate) is not None
        return {
            "available": bool(runtime_ready),
            "runtimeReady": bool(runtime_ready),
            "engine": "onnxruntime-cpu",
            **info,
            "reason": "" if runtime_ready else "ONNX Runtime is unavailable or rejected the FIQA model.",
        }
    return {
        "available": False,
        "runtimeReady": False,
        "engine": "embedding-norm-fallback",
        "modelId": FIQA_MODEL_ID,
        "modelName": "eDifFIQA(T)",
        "license": FIQA_LICENSE,
        "reason": errors[0] if errors else "The bundled eDifFIQA(T) model is missing.",
        "integrityErrors": errors,
    }

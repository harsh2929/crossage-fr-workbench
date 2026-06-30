"""On-device subject isolation / background removal (BiRefNet ONNX).

Mirrors the proven ``crossage_fr/ingest/safety.py`` seam: an optional onnxruntime
model, discovered on disk under ``models/matting/``, executed on CPU with an
lru-cached session and graceful degradation when the weights are not vendored.
Produces a soft alpha matte that lifts the salient subject into an RGBA cutout.

Pick rationale lives in docs/2026-ml-integration-plan.md (BiRefNet, MIT, SOTA on
DIS/COD/HRSOD; Cloudflare's production background-removal bake-off winner). The
weights are downloaded once via crossage_fr.model_manager (pack "birefnet_lite",
sha256-verified) — never fetched at inference time, satisfying the offline /
``noNetworkIntelligence`` invariant.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image

from crossage_fr.ingest.image_io import load_image, sha256_file
from crossage_fr.runtime_env import env_flag, env_value
from crossage_fr.platform_detect import detect_platform, get_providers, split_provider_config

# BiRefNet preprocessing: 1024x1024, ImageNet normalization (per the upstream
# repo's image_proc / inference scripts).
_INPUT_SIZE = 1024
_IMAGENET_MEAN = (0.485, 0.456, 0.406)
_IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass(slots=True)
class MattingResult:
    available: bool
    engine: str
    model_name: str
    reason: str
    alpha: np.ndarray | None = None  # HxW float32 in [0,1] at the source resolution
    foreground_ratio: float = 0.0
    _rgb: Image.Image | None = None

    def alpha_image(self) -> Image.Image:
        """Return the matte as an L-mode PIL image at the source resolution."""
        if self.alpha is None:
            raise RuntimeError("alpha_image() requires a successful matting result")
        return Image.fromarray(np.clip(self.alpha * 255.0, 0, 255).astype(np.uint8), "L")

    def cutout(self, *, background: tuple[int, int, int, int] | None = None) -> Image.Image:
        """Return an RGBA image with the matte applied as the alpha channel.

        When ``background`` (RGBA) is given, composite the subject over it instead
        of leaving the removed region transparent.
        """
        if self._rgb is None or self.alpha is None:
            raise RuntimeError("cutout() requires a successful matting result")
        rgb = self._rgb.convert("RGB")
        alpha8 = np.clip(self.alpha * 255.0, 0, 255).astype(np.uint8)
        rgba = np.dstack([np.asarray(rgb, dtype=np.uint8), alpha8])
        subject = Image.fromarray(rgba, "RGBA")
        if background is None:
            return subject
        canvas = Image.new("RGBA", subject.size, background)
        canvas.alpha_composite(subject)
        return canvas


def remove_background(
    path: Path | None = None,
    *,
    image: Image.Image | None = None,
    threshold: float = 0.5,
) -> MattingResult:
    """Compute a subject matte for ``path`` (or an already-loaded ``image``)."""
    if image is None:
        if path is None:
            raise ValueError("remove_background requires a path or an image")
        image = load_image(path)
    rgb = image.convert("RGB")

    if _matting_engine_mode() == "off":
        return MattingResult(
            available=False,
            engine="unavailable",
            model_name="",
            reason="Matting disabled (CROSSAGE_FORCE_FALLBACK / MATTING_ENGINE=off).",
            _rgb=rgb,
        )

    model = _load_matting_model()
    if model is None:
        return MattingResult(
            available=False,
            engine="unavailable",
            model_name="",
            reason="No on-device matting model found. Install the 'birefnet_lite' model pack to enable subject cutout.",
            _rgb=rgb,
        )
    try:
        alpha = model.infer(rgb)
    except Exception as exc:  # never let an inference fault break ingestion
        return MattingResult(
            available=False,
            engine="error",
            model_name=model.name,
            reason=f"Matting model failed ({type(exc).__name__}: {exc}).",
            _rgb=rgb,
        )
    foreground_ratio = float((alpha >= threshold).mean())
    return MattingResult(
        available=True,
        engine="onnx",
        model_name=model.name,
        reason=f"On-device matte from {model.name}.",
        alpha=alpha,
        foreground_ratio=foreground_ratio,
        _rgb=rgb,
    )


def matting_model_report() -> dict[str, Any]:
    if _matting_engine_mode() == "off":
        return {
            "engine": "unavailable",
            "available": False,
            "modelName": "",
            "path": None,
            "reason": "Matting disabled via CROSSAGE_FORCE_FALLBACK / MATTING_ENGINE=off.",
        }
    path = _find_matting_model()
    if path is None:
        return {
            "engine": "unavailable",
            "available": False,
            "modelName": "",
            "path": None,
            "reason": "No on-device matting model found (install the 'birefnet_lite' pack).",
        }
    return {
        "engine": "onnx",
        "available": True,
        "modelName": _model_name_for(path),
        "path": str(path),
        "inputSize": _INPUT_SIZE,
        "license": "MIT",
        "source": "ZhengPeng7/BiRefNet (onnx-community/BiRefNet_lite-ONNX)",
    }


class _OnnxMattingModel:
    def __init__(self, path: Path):
        self.path = path
        self.name = _model_name_for(path)
        self.session = _session_for_model(str(path), _model_stat_token(path))
        self.input_name = self.session.get_inputs()[0].name
        shape = self.session.get_inputs()[0].shape
        self._h = shape[2] if isinstance(shape[2], int) else _INPUT_SIZE
        self._w = shape[3] if isinstance(shape[3], int) else _INPUT_SIZE

    def infer(self, rgb: Image.Image) -> np.ndarray:
        tensor = self._preprocess(rgb)
        logits = np.asarray(self.session.run(None, {self.input_name: tensor})[0], dtype=np.float32)
        logits = logits.reshape(logits.shape[-2], logits.shape[-1])
        alpha = 1.0 / (1.0 + np.exp(-logits))  # sigmoid -> [0,1]
        # Resize the matte back to the source resolution.
        matte = Image.fromarray(np.clip(alpha * 255.0, 0, 255).astype(np.uint8), "L")
        matte = matte.resize(rgb.size, Image.Resampling.BILINEAR)
        return np.asarray(matte, dtype=np.float32) / 255.0

    def _preprocess(self, rgb: Image.Image) -> np.ndarray:
        resized = rgb.resize((self._w, self._h), Image.Resampling.BILINEAR)
        arr = np.asarray(resized, dtype=np.float32) / 255.0
        arr = (arr - np.asarray(_IMAGENET_MEAN, dtype=np.float32)) / np.asarray(_IMAGENET_STD, dtype=np.float32)
        arr = np.transpose(arr, (2, 0, 1))
        return np.expand_dims(arr, axis=0).astype(np.float32)


def _matting_engine_mode() -> str:
    configured = (env_value("MATTING_ENGINE", default="") or "").strip().lower()
    if configured in {"off", "onnx", "auto"}:
        return "off" if configured == "off" else "auto"
    if env_flag("FORCE_FALLBACK"):
        return "off"
    return "auto"


def _model_stat_token(path: Path) -> tuple[int, int]:
    try:
        stat = path.stat()
        return (stat.st_size, stat.st_mtime_ns)
    except OSError:
        return (-1, -1)


_MATTING_MODEL_CACHE: dict[tuple[str, int, int], _OnnxMattingModel] = {}

# Pinned SHA-256 for known matting weights, keyed by file name (defense in depth,
# mirroring safety.py's _PINNED_SAFETY_MODEL_HASHES). A file whose name matches a
# pinned entry MUST match the hash, or it is rejected (fail closed -> heuristic).
# Hash of onnx-community/BiRefNet_lite-ONNX onnx/model_fp16.onnx.
_PINNED_MATTING_MODEL_HASHES = {
    "birefnet_lite_fp16.onnx": "d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402",
}


def _verify_matting_integrity(path: Path) -> bool:
    expected = _PINNED_MATTING_MODEL_HASHES.get(path.name.lower())
    if not expected:
        return True  # no pin for this file name; trust the vendored/discovered file
    try:
        return sha256_file(path).lower() == expected.lower()
    except OSError:
        return False


def _reset_caches_for_test() -> None:
    """Clear the session/model caches (tests swap discovery dirs at runtime)."""
    _MATTING_MODEL_CACHE.clear()
    _session_for_model.cache_clear()


def _load_matting_model() -> _OnnxMattingModel | None:
    path = _find_matting_model()
    if path is None:
        return None
    size, mtime = _model_stat_token(path)
    cache_key = (str(path), size, mtime)
    model = _MATTING_MODEL_CACHE.get(cache_key)
    if model is None:
        # Verify integrity only on a cache miss (avoids hashing the 114 MB file on
        # every export); a tampered pinned file fails closed to the heuristic.
        if not _verify_matting_integrity(path):
            return None
        if len(_MATTING_MODEL_CACHE) >= 4:
            _MATTING_MODEL_CACHE.clear()
        model = _OnnxMattingModel(path)
        _MATTING_MODEL_CACHE[cache_key] = model
    return model


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _find_matting_model() -> Path | None:
    configured = None if _is_packaged() else env_value("MATTING_MODEL")
    if configured:
        path = Path(configured).expanduser().resolve()
        if path.exists():
            return path
    candidates: list[Path] = []
    for directory in _matting_model_dirs():
        if not directory.exists():
            continue
        candidates.extend(sorted(directory.glob("*.onnx"), key=_model_preference))
    return candidates[0].resolve() if candidates else None


def _matting_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    configured = None if _is_packaged() else env_value("MATTING_MODEL_DIR")
    if configured:
        dirs.append(Path(configured).expanduser())
    source_root = Path(__file__).resolve().parents[2]
    dirs.append(source_root / "models" / "matting")
    dirs.append(Path.cwd() / "models" / "matting")
    executable = Path(sys.executable).resolve()
    dirs.append(executable.parent / "models" / "matting")
    dirs.append(executable.parent.parent / "models" / "matting")
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        dirs.append(Path(bundle_root) / "models" / "matting")
    unique: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        resolved = directory.expanduser().resolve()
        if str(resolved) not in seen:
            unique.append(resolved)
            seen.add(str(resolved))
    return unique


def _model_preference(path: Path) -> tuple[int, str]:
    name = path.name.lower()
    if "birefnet" in name:
        return (0, name)
    return (5, name)


def _model_name_for(path: Path) -> str:
    name = path.name.lower()
    if "birefnet" in name:
        return "BiRefNet_lite"
    return path.stem


@lru_cache(maxsize=4)
def _session_for_model(model_path: str, cache_token: tuple[int, int] = (0, 0)):
    del cache_token  # part of the cache key only (file-replacement invalidation)
    import onnxruntime as ort

    sess_options = ort.SessionOptions()
    sess_options.log_severity_level = 3  # quiet the fp16 constant-fold warnings
    selected = get_providers(detect_platform())
    providers, provider_options = split_provider_config(selected)
    try:
        if provider_options is not None:
            return ort.InferenceSession(model_path, sess_options=sess_options, providers=providers, provider_options=provider_options)
        return ort.InferenceSession(model_path, sess_options=sess_options, providers=providers)
    except Exception:
        return ort.InferenceSession(model_path, sess_options=sess_options, providers=["CPUExecutionProvider"])

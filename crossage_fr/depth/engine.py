"""On-device monocular depth estimation (Depth-Anything-V2-Small ONNX).

Produces a relative depth map that powers depth-aware portrait background blur.
Mirrors the discovery/caching/graceful-degradation pattern of
``crossage_fr/ingest/matting.py`` and ``crossage_fr/embed/siglip_engine.py``.

Pick rationale: docs/2026-ml-integration-plan.md (Depth-Anything-V2-Small, Apache-2.0;
MiDaS-beating relative depth, the signal portrait blur needs). Weights are vendored
under ``models/depth/`` (sha256-pinned) — never fetched at inference time, honoring
the offline / ``noNetworkIntelligence`` invariant.
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

# Depth-Anything-V2 preprocessing (preprocessor_config.json): 518x518, BICUBIC,
# rescale 1/255, ImageNet mean/std.
_INPUT_SIZE = 518
_IMAGENET_MEAN = (0.485, 0.456, 0.406)
_IMAGENET_STD = (0.229, 0.224, 0.225)
_MODEL_GLOB = "model*.onnx"

# Pinned SHA-256 for the known Depth-Anything-V2-Small int8 ONNX (graph + external
# data), keyed by file name (defense in depth).
_PINNED_DEPTH_HASHES = {
    "model_quantized.onnx": "ed7680047cd210143f9f9c4468d049c1f19f8a7a58631d52868831376fe152c9",
    "model_quantized.onnx_data": "1595c419ac7d75a356c6835890f2e64fd370a38444ddfcb741ca6b6b96e1a42a",
}


@dataclass(slots=True)
class DepthResult:
    available: bool
    engine: str
    model_name: str
    reason: str
    depth: np.ndarray | None = None  # HxW float32 in [0,1] at source res, 1 = nearest

    def depth_image(self) -> Image.Image:
        if self.depth is None:
            raise RuntimeError("depth_image() requires a successful depth result")
        return Image.fromarray(np.clip(self.depth * 255.0, 0, 255).astype(np.uint8), "L")


def estimate_depth(path: Path | None = None, *, image: Image.Image | None = None) -> DepthResult:
    if image is None:
        if path is None:
            raise ValueError("estimate_depth requires a path or an image")
        image = load_image(path)
    rgb = image.convert("RGB")

    if _depth_engine_mode() == "off":
        return DepthResult(False, "unavailable", "", "Depth disabled (CROSSAGE_FORCE_FALLBACK / DEPTH_ENGINE=off).")
    model = _load_depth_model()
    if model is None:
        return DepthResult(False, "unavailable", "",
                           "No on-device depth model found. Install the 'depth_anything_v2' pack to enable portrait blur.")
    try:
        depth = model.infer(rgb)
    except Exception as exc:
        return DepthResult(False, "error", model.name, f"Depth model failed ({type(exc).__name__}: {exc}).")
    return DepthResult(True, "onnx", model.name, f"On-device depth from {model.name}.", depth=depth)


def depth_model_report() -> dict[str, Any]:
    if _depth_engine_mode() == "off":
        return {"available": False, "engine": "unavailable", "path": None,
                "reason": "Depth disabled via CROSSAGE_FORCE_FALLBACK / DEPTH_ENGINE=off."}
    path = _find_depth_model()
    if path is None:
        return {"available": False, "engine": "unavailable", "path": None,
                "reason": "No on-device depth model found (install the 'depth_anything_v2' pack)."}
    return {
        "available": True,
        "engine": "onnx",
        "modelName": "Depth-Anything-V2-Small",
        "path": str(path),
        "inputSize": _INPUT_SIZE,
        "license": "Apache-2.0",
        "source": "depth-anything/Depth-Anything-V2-Small (onnx-community export)",
    }


class _OnnxDepthModel:
    def __init__(self, path: Path):
        self.path = path
        self.name = "Depth-Anything-V2-Small"
        self.session = _session_for_model(str(path), _stat_token(path))
        self.input_name = self.session.get_inputs()[0].name

    def infer(self, rgb: Image.Image) -> np.ndarray:
        tensor = self._preprocess(rgb)
        raw = np.asarray(self.session.run(None, {self.input_name: tensor})[0], dtype=np.float32)
        raw = raw.reshape(raw.shape[-2], raw.shape[-1])  # [H,W] disparity (higher = nearer)
        lo, hi = float(raw.min()), float(raw.max())
        norm = (raw - lo) / (hi - lo) if hi > lo else np.zeros_like(raw)
        depth = Image.fromarray(np.clip(norm * 255.0, 0, 255).astype(np.uint8), "L")
        depth = depth.resize(rgb.size, Image.Resampling.BILINEAR)
        return np.asarray(depth, dtype=np.float32) / 255.0

    def _preprocess(self, rgb: Image.Image) -> np.ndarray:
        resized = rgb.resize((_INPUT_SIZE, _INPUT_SIZE), Image.Resampling.BICUBIC)
        arr = np.asarray(resized, dtype=np.float32) / 255.0
        arr = (arr - np.asarray(_IMAGENET_MEAN, dtype=np.float32)) / np.asarray(_IMAGENET_STD, dtype=np.float32)
        arr = np.transpose(arr, (2, 0, 1))
        return np.expand_dims(arr, axis=0).astype(np.float32)


def _depth_engine_mode() -> str:
    configured = (env_value("DEPTH_ENGINE", default="") or "").strip().lower()
    if configured in {"off", "onnx", "auto"}:
        return "off" if configured == "off" else "auto"
    if env_flag("FORCE_FALLBACK"):
        return "off"
    return "auto"


def _stat_token(path: Path) -> tuple[int, int]:
    try:
        stat = path.stat()
        return (stat.st_size, stat.st_mtime_ns)
    except OSError:
        return (-1, -1)


def _verify_depth_integrity(path: Path) -> bool:
    # Verify the graph file and, if present, its external-data sidecar.
    for candidate in (path, path.with_name(path.name + "_data")):
        expected = _PINNED_DEPTH_HASHES.get(candidate.name.lower())
        if not expected:
            continue
        try:
            if sha256_file(candidate).lower() != expected.lower():
                return False
        except OSError:
            return False
    return True


_DEPTH_MODEL_CACHE: dict[tuple[str, int, int], _OnnxDepthModel] = {}


def _reset_caches_for_test() -> None:
    _DEPTH_MODEL_CACHE.clear()
    _session_for_model.cache_clear()


def _load_depth_model() -> _OnnxDepthModel | None:
    path = _find_depth_model()
    if path is None:
        return None
    size, mtime = _stat_token(path)
    cache_key = (str(path), size, mtime)
    model = _DEPTH_MODEL_CACHE.get(cache_key)
    if model is None:
        if not _verify_depth_integrity(path):
            return None  # fail closed
        if len(_DEPTH_MODEL_CACHE) >= 4:
            _DEPTH_MODEL_CACHE.clear()
        model = _OnnxDepthModel(path)
        _DEPTH_MODEL_CACHE[cache_key] = model
    return model


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _find_depth_model() -> Path | None:
    configured = None if _is_packaged() else env_value("DEPTH_MODEL")
    if configured:
        path = Path(configured).expanduser().resolve()
        if path.exists():
            return path
    candidates: list[Path] = []
    for directory in _depth_model_dirs():
        if not directory.exists():
            continue
        # The external-data sidecar (model*.onnx_data) ends in .onnx_data, so the
        # *.onnx glob already excludes it; keep only real graph files.
        candidates.extend(sorted(p for p in directory.glob(_MODEL_GLOB) if p.suffix == ".onnx"))
    return candidates[0].resolve() if candidates else None


def _depth_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    configured = None if _is_packaged() else env_value("DEPTH_MODEL_DIR")
    if configured:
        dirs.append(Path(configured).expanduser())
    source_root = Path(__file__).resolve().parents[2]
    dirs.append(source_root / "models" / "depth")
    dirs.append(Path.cwd() / "models" / "depth")
    executable = Path(sys.executable).resolve()
    dirs.append(executable.parent / "models" / "depth")
    dirs.append(executable.parent.parent / "models" / "depth")
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        dirs.append(Path(bundle_root) / "models" / "depth")
    unique: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        resolved = directory.expanduser().resolve()
        if str(resolved) not in seen:
            unique.append(resolved)
            seen.add(str(resolved))
    return unique


@lru_cache(maxsize=4)
def _session_for_model(model_path: str, cache_token: tuple[int, int] = (0, 0)):
    del cache_token
    import onnxruntime as ort

    sess_options = ort.SessionOptions()
    sess_options.log_severity_level = 3
    selected = get_providers(detect_platform())
    providers, provider_options = split_provider_config(selected)
    try:
        if provider_options is not None:
            return ort.InferenceSession(model_path, sess_options=sess_options, providers=providers, provider_options=provider_options)
        return ort.InferenceSession(model_path, sess_options=sess_options, providers=providers)
    except Exception:
        return ort.InferenceSession(model_path, sess_options=sess_options, providers=["CPUExecutionProvider"])

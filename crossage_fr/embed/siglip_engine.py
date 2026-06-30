"""On-device natural-language photo search (SigLIP 2 ONNX).

A dual-encoder (image + text) that embeds photos and free-text queries into one
shared space so a query can be ranked against a photo library entirely on-device.
Mirrors the discovery/caching/graceful-degradation pattern of
``crossage_fr/ingest/safety.py`` and ``crossage_fr/ingest/matting.py``.

Pick rationale: docs/2026-ml-integration-plan.md (SigLIP 2 B/16-256, Apache-2.0;
SOTA zero-shot/retrieval, beats CLIP). Weights + tokenizer are vendored under
``models/semantic/`` (sha256-pinned in code) — never fetched at inference time, so
queries honor the offline / ``noNetworkIntelligence`` invariant.
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

# SigLIP 2 preprocessing (preprocessor_config.json): 256x256, rescale 1/255,
# normalize mean/std 0.5 -> pixels in [-1, 1]. Text: lowercase, GemmaTokenizer,
# EOS-terminated, padded/truncated to 64 (all baked into tokenizer.json).
_IMAGE_SIZE = 256
_VISION_GLOB = "vision_model*.onnx"
_TEXT_GLOB = "text_model*.onnx"
_TOKENIZER_NAME = "tokenizer.json"

# Pinned SHA-256 for the known SigLIP 2 uint8 ONNX files (defense in depth).
_PINNED_SEMANTIC_HASHES = {
    "vision_model_uint8.onnx": "f2eb8ccfa3dc0b3761d9ea9a39554fe0f2be71b247ad7f68a80720ec88895650",
    "text_model_uint8.onnx": "8c6d2827118d6d0e50db7392588d73133c7d2147997da522a1b2d144df535aed",
}


@dataclass(frozen=True, slots=True)
class _SemanticModelSpec:
    vision_path: Path
    text_path: Path
    tokenizer_path: Path


def semantic_search_available() -> bool:
    return _load_semantic_model() is not None


def semantic_model_report() -> dict[str, Any]:
    if _semantic_engine_mode() == "off":
        return {"available": False, "engine": "unavailable", "path": None,
                "reason": "Semantic search disabled (CROSSAGE_FORCE_FALLBACK / SEMANTIC_ENGINE=off)."}
    spec = _find_semantic_model()
    if spec is None:
        return {"available": False, "engine": "unavailable", "path": None,
                "reason": "No on-device semantic-search model found (install the 'siglip2' pack)."}
    return {
        "available": True,
        "engine": "onnx",
        "modelName": "SigLIP2-base-patch16-256",
        "path": str(spec.vision_path.parent),
        "imageSize": _IMAGE_SIZE,
        "license": "Apache-2.0",
        "source": "google/siglip2-base-patch16-256 (onnx-community export)",
    }


def encode_image(path: Path | None = None, *, image: Image.Image | None = None) -> np.ndarray | None:
    """Return an L2-normalized image embedding, or None if the model is absent."""
    model = _load_semantic_model()
    if model is None:
        return None
    if image is None:
        if path is None:
            raise ValueError("encode_image requires a path or an image")
        image = load_image(path)
    return model.encode_image(image)


def encode_images(images: list[Image.Image]) -> np.ndarray | None:
    """Batch-encode images into an (N, D) L2-normalized matrix, or None if absent."""
    model = _load_semantic_model()
    if model is None:
        return None
    return model.encode_images(images)


def encode_text(text: str) -> np.ndarray | None:
    """Return an L2-normalized text embedding, or None if the model is absent."""
    model = _load_semantic_model()
    if model is None:
        return None
    return model.encode_text(text)


# In-process embedding cache keyed by (path, size, mtime) so repeated queries in a
# session don't re-encode the same photo. Bounded to avoid unbounded growth.
_IMAGE_EMBED_CACHE: dict[tuple[str, int, int], np.ndarray] = {}
_IMAGE_EMBED_CACHE_LIMIT = 8192


def encode_image_path_cached(path: Path) -> np.ndarray | None:
    """Embed an image file, memoized by (path, size, mtime). None if model absent."""
    model = _load_semantic_model()
    if model is None:
        return None
    resolved = Path(path).resolve()
    size, mtime = _stat_token(resolved)
    key = (str(resolved), size, mtime)
    cached = _IMAGE_EMBED_CACHE.get(key)
    if cached is None:
        cached = model.encode_image(load_image(resolved))
        if len(_IMAGE_EMBED_CACHE) >= _IMAGE_EMBED_CACHE_LIMIT:
            _IMAGE_EMBED_CACHE.clear()
        _IMAGE_EMBED_CACHE[key] = cached
    return cached


class _SemanticModel:
    def __init__(self, spec: _SemanticModelSpec):
        from tokenizers import Tokenizer

        self.spec = spec
        self.vision = _session_for_model(str(spec.vision_path), _stat_token(spec.vision_path))
        self.text = _session_for_model(str(spec.text_path), _stat_token(spec.text_path))
        self.tokenizer = Tokenizer.from_file(str(spec.tokenizer_path))
        self._vision_in = self.vision.get_inputs()[0].name
        self._text_in = self.text.get_inputs()[0].name
        self._vision_out = _pooler_output_name(self.vision)
        self._text_out = _pooler_output_name(self.text)

    def encode_image(self, image: Image.Image) -> np.ndarray:
        return self.encode_images([image])[0]

    def encode_images(self, images: list[Image.Image]) -> np.ndarray:
        batch = np.concatenate([self._preprocess_image(img) for img in images], axis=0)
        pooled = np.asarray(self.vision.run([self._vision_out], {self._vision_in: batch})[0], dtype=np.float32)
        return _l2_normalize(pooled)

    def encode_text(self, text: str) -> np.ndarray:
        ids = self.tokenizer.encode(str(text).strip().lower()).ids
        feed = np.asarray([ids], dtype=np.int64)
        pooled = np.asarray(self.text.run([self._text_out], {self._text_in: feed})[0], dtype=np.float32)
        return _l2_normalize(pooled)[0]

    def _preprocess_image(self, image: Image.Image) -> np.ndarray:
        rgb = image.convert("RGB").resize((_IMAGE_SIZE, _IMAGE_SIZE), Image.Resampling.BILINEAR)
        arr = np.asarray(rgb, dtype=np.float32) / 255.0
        arr = (arr - 0.5) / 0.5
        arr = np.transpose(arr, (2, 0, 1))
        return np.expand_dims(arr, axis=0).astype(np.float32)


def _l2_normalize(matrix: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(matrix, axis=-1, keepdims=True)
    return matrix / np.clip(norms, 1e-12, None)


def _pooler_output_name(session) -> str:
    names = [o.name for o in session.get_outputs()]
    return "pooler_output" if "pooler_output" in names else names[-1]


def _semantic_engine_mode() -> str:
    configured = (env_value("SEMANTIC_ENGINE", default="") or "").strip().lower()
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


def _verify_semantic_integrity(spec: _SemanticModelSpec) -> bool:
    for path in (spec.vision_path, spec.text_path):
        expected = _PINNED_SEMANTIC_HASHES.get(path.name.lower())
        if not expected:
            continue
        try:
            if sha256_file(path).lower() != expected.lower():
                return False
        except OSError:
            return False
    return True


_SEMANTIC_MODEL_CACHE: dict[tuple, _SemanticModel] = {}


def _reset_caches_for_test() -> None:
    _SEMANTIC_MODEL_CACHE.clear()
    _IMAGE_EMBED_CACHE.clear()
    _session_for_model.cache_clear()


def _load_semantic_model() -> _SemanticModel | None:
    if _semantic_engine_mode() == "off":
        return None
    spec = _find_semantic_model()
    if spec is None:
        return None
    cache_key = (
        str(spec.vision_path), _stat_token(spec.vision_path),
        str(spec.text_path), _stat_token(spec.text_path),
    )
    model = _SEMANTIC_MODEL_CACHE.get(cache_key)
    if model is None:
        if not _verify_semantic_integrity(spec):
            return None  # fail closed
        try:
            import tokenizers  # noqa: F401  (required for text encoding)
        except Exception:
            return None
        if len(_SEMANTIC_MODEL_CACHE) >= 2:
            _SEMANTIC_MODEL_CACHE.clear()
        model = _SemanticModel(spec)
        _SEMANTIC_MODEL_CACHE[cache_key] = model
    return model


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _find_semantic_model() -> _SemanticModelSpec | None:
    for directory in _semantic_model_dirs():
        if not directory.exists():
            continue
        vision = sorted(directory.glob(_VISION_GLOB))
        text = sorted(directory.glob(_TEXT_GLOB))
        tokenizer = directory / _TOKENIZER_NAME
        if vision and text and tokenizer.exists():
            return _SemanticModelSpec(vision[0].resolve(), text[0].resolve(), tokenizer.resolve())
    return None


def _semantic_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    configured = None if _is_packaged() else env_value("SEMANTIC_MODEL_DIR")
    if configured:
        dirs.append(Path(configured).expanduser())
    source_root = Path(__file__).resolve().parents[2]
    dirs.append(source_root / "models" / "semantic")
    dirs.append(Path.cwd() / "models" / "semantic")
    executable = Path(sys.executable).resolve()
    dirs.append(executable.parent / "models" / "semantic")
    dirs.append(executable.parent.parent / "models" / "semantic")
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        dirs.append(Path(bundle_root) / "models" / "semantic")
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

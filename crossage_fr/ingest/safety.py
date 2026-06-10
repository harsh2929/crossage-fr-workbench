from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
import json
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image

from crossage_fr.ingest.image_io import load_image
from crossage_fr.platform_detect import detect_platform, get_providers, split_provider_config


@dataclass(slots=True)
class SafetyAssessment:
    sensitive: bool
    score: float
    reason: str
    skin_ratio: float
    lower_skin_ratio: float
    largest_region_ratio: float
    engine: str = "heuristic"
    model_name: str = "exposed-skin-heuristic"
    model_score: float | None = None
    heuristic_score: float | None = None
    threshold: float = 0.0
    labels: dict[str, float] = field(default_factory=dict)


def assess_image_safety(path: Path, threshold: float = 0.58, image: Image.Image | None = None) -> SafetyAssessment:
    image = image or load_image(path)
    heuristic = _assess_image_safety_heuristic(image, threshold)
    if _safety_engine_mode() == "heuristic":
        return heuristic
    model = _load_safety_model()
    if model is None:
        return heuristic
    try:
        return model.assess(image, threshold, heuristic)
    except Exception as exc:
        return SafetyAssessment(
            sensitive=heuristic.sensitive,
            score=heuristic.score,
            reason=f"{heuristic.reason}; ML Safe Mode unavailable ({type(exc).__name__})",
            skin_ratio=heuristic.skin_ratio,
            lower_skin_ratio=heuristic.lower_skin_ratio,
            largest_region_ratio=heuristic.largest_region_ratio,
            engine="heuristic-fallback",
            model_name=heuristic.model_name,
            model_score=None,
            heuristic_score=heuristic.score,
            threshold=threshold,
            labels={},
        )


def safety_model_report() -> dict[str, Any]:
    if _safety_engine_mode() == "heuristic":
        return {
            "engine": "heuristic",
            "available": False,
            "modelName": "exposed-skin-heuristic",
            "path": None,
            "reason": "CROSSAGE_FORCE_FALLBACK or CROSSAGE_SAFE_MODE_ENGINE=heuristic is active.",
        }
    spec = _find_safety_model()
    if spec is None:
        return {
            "engine": "heuristic",
            "available": False,
            "modelName": "exposed-skin-heuristic",
            "path": None,
            "reason": "No local ONNX safety model was found.",
        }
    return _spec_report(spec)


def _assess_image_safety_heuristic(image: Image.Image, threshold: float) -> SafetyAssessment:
    prepared = _prepare(image)
    skin_mask = _skin_mask(prepared)
    skin_ratio = float(skin_mask.mean())
    lower_skin_ratio = float(skin_mask[skin_mask.shape[0] // 2 :, :].mean())
    largest_region_ratio = _largest_region_ratio(skin_mask)
    center_y = _skin_center_y(skin_mask)
    non_skin_ratio = 1.0 - skin_ratio
    portrait_bias = _portrait_bias(skin_mask, center_y)

    score = 0.0
    score += max(0.0, (skin_ratio - 0.68) / 0.24) * 0.55
    score += max(0.0, (lower_skin_ratio - 0.55) / 0.35) * 0.30
    score += max(0.0, (largest_region_ratio - 0.65) / 0.30) * 0.18
    score += max(0.0, (center_y - 0.47) / 0.28) * 0.14
    if non_skin_ratio >= 0.20:
        score -= 0.16
    score -= portrait_bias
    score = float(max(0.0, min(1.0, score)))

    reasons = []
    if skin_ratio >= 0.45:
        reasons.append("large exposed-skin area")
    if lower_skin_ratio >= 0.34:
        reasons.append("lower-frame exposed-skin concentration")
    if largest_region_ratio >= 0.42:
        reasons.append("large continuous exposed-skin region")
    if not reasons:
        reasons.append("low sensitive-content signal")

    return SafetyAssessment(
        sensitive=score >= threshold,
        score=score,
        reason=", ".join(reasons),
        skin_ratio=skin_ratio,
        lower_skin_ratio=lower_skin_ratio,
        largest_region_ratio=largest_region_ratio,
        engine="heuristic",
        model_name="exposed-skin-heuristic",
        model_score=None,
        heuristic_score=score,
        threshold=threshold,
        labels={"sensitive": score, "not_sensitive": 1.0 - score},
    )


def _prepare(image: Image.Image) -> Image.Image:
    image = image.copy()
    image.thumbnail((160, 160), Image.Resampling.BILINEAR)
    return image.convert("RGB")


def _skin_mask(image: Image.Image) -> np.ndarray:
    rgb = np.asarray(image).astype(np.float32)
    red = rgb[:, :, 0]
    green = rgb[:, :, 1]
    blue = rgb[:, :, 2]
    max_channel = rgb.max(axis=2)
    min_channel = rgb.min(axis=2)

    classic_rgb = (
        (red > 95)
        & (green > 40)
        & (blue > 20)
        & ((max_channel - min_channel) > 15)
        & (np.abs(red - green) > 15)
        & (red > green)
        & (red > blue)
    )

    total = red + green + blue + 1.0
    norm_red = red / total
    norm_green = green / total
    normalized = (
        (norm_red > 0.34)
        & (norm_red < 0.62)
        & (norm_green > 0.20)
        & (norm_green < 0.38)
        & (blue / total < 0.34)
    )

    return classic_rgb & normalized


def _largest_region_ratio(mask: np.ndarray) -> float:
    height, width = mask.shape
    visited = np.zeros_like(mask, dtype=bool)
    largest = 0
    for row in range(height):
        for col in range(width):
            if visited[row, col] or not mask[row, col]:
                continue
            stack = [(row, col)]
            visited[row, col] = True
            size = 0
            while stack:
                current_row, current_col = stack.pop()
                size += 1
                for next_row, next_col in (
                    (current_row - 1, current_col),
                    (current_row + 1, current_col),
                    (current_row, current_col - 1),
                    (current_row, current_col + 1),
                ):
                    if (
                        0 <= next_row < height
                        and 0 <= next_col < width
                        and not visited[next_row, next_col]
                        and mask[next_row, next_col]
                    ):
                        visited[next_row, next_col] = True
                        stack.append((next_row, next_col))
            largest = max(largest, size)
    return float(largest / mask.size)


def _skin_center_y(mask: np.ndarray) -> float:
    rows = np.flatnonzero(mask.any(axis=1))
    if not len(rows):
        return 0.0
    return float(rows.mean() / max(1, mask.shape[0] - 1))


def _portrait_bias(mask: np.ndarray, center_y: float) -> float:
    if not mask.any():
        return 0.0
    height = mask.shape[0]
    upper = float(mask[: height // 2, :].mean())
    lower = float(mask[height // 2 :, :].mean())
    if upper <= 0:
        return 0.0
    top_heavy = upper > lower * 1.35
    face_centered = 0.26 <= center_y <= 0.55
    return 0.22 if top_heavy and face_centered else 0.0


@dataclass(frozen=True, slots=True)
class _SafetyModelSpec:
    path: Path
    model_name: str
    source: str
    license: str
    input_size: int
    labels: tuple[str, ...]
    nsfw_index: int
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    interpolation: str
    threshold_hint: str


class _OnnxSafetyModel:
    def __init__(self, spec: _SafetyModelSpec):
        self.spec = spec
        self.session = _session_for_model(str(spec.path))
        self.input_name = self.session.get_inputs()[0].name

    def assess(self, image: Image.Image, threshold: float, heuristic: SafetyAssessment) -> SafetyAssessment:
        logits = np.asarray(self.session.run(None, {self.input_name: self._preprocess(image)})[0])
        if logits.ndim > 1:
            logits = logits[0]
        logits = logits.astype(np.float32).reshape(-1)
        probabilities = _softmax(logits)
        nsfw_score = float(probabilities[self.spec.nsfw_index])
        labels = {
            self.spec.labels[index] if index < len(self.spec.labels) else f"class_{index}": float(value)
            for index, value in enumerate(probabilities)
        }
        labels["exposed_skin_guard"] = heuristic.score
        combined_score = max(nsfw_score, heuristic.score)
        guard_text = " plus exposed-skin guard" if heuristic.score >= threshold and nsfw_score < threshold else ""
        return SafetyAssessment(
            sensitive=combined_score >= threshold,
            score=combined_score,
            reason=f"ML Safe Mode score from {self.spec.model_name}{guard_text}",
            skin_ratio=heuristic.skin_ratio,
            lower_skin_ratio=heuristic.lower_skin_ratio,
            largest_region_ratio=heuristic.largest_region_ratio,
            engine="onnx-hybrid",
            model_name=self.spec.model_name,
            model_score=nsfw_score,
            heuristic_score=heuristic.score,
            threshold=threshold,
            labels=labels,
        )

    def report(self) -> dict[str, Any]:
        return _spec_report(self.spec)

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        method = Image.Resampling.BICUBIC if self.spec.interpolation == "bicubic" else Image.Resampling.BILINEAR
        rgb = image.convert("RGB").resize((self.spec.input_size, self.spec.input_size), method)
        tensor = np.asarray(rgb, dtype=np.float32) / 255.0
        mean = np.asarray(self.spec.mean, dtype=np.float32)
        std = np.asarray(self.spec.std, dtype=np.float32)
        tensor = (tensor - mean) / std
        tensor = np.transpose(tensor, (2, 0, 1))
        return np.expand_dims(tensor, axis=0).astype(np.float32)


def _safety_engine_mode() -> str:
    configured = os.environ.get("CROSSAGE_SAFE_MODE_ENGINE", "").strip().lower()
    if configured in {"heuristic", "model", "auto"}:
        return configured
    if os.environ.get("CROSSAGE_FORCE_FALLBACK") == "1":
        return "heuristic"
    return "auto"


@lru_cache(maxsize=1)
def _load_safety_model() -> _OnnxSafetyModel | None:
    spec = _find_safety_model()
    if spec is None:
        if _safety_engine_mode() == "model":
            raise RuntimeError("CROSSAGE_SAFE_MODE_ENGINE=model, but no ONNX safety model was found.")
        return None
    return _OnnxSafetyModel(spec)


def _find_safety_model() -> _SafetyModelSpec | None:
    configured = os.environ.get("CROSSAGE_SAFE_MODEL")
    if configured:
        path = Path(configured).expanduser().resolve()
        if path.exists():
            return _spec_for_model(path)
        if _safety_engine_mode() == "model":
            raise FileNotFoundError(path)
    candidates: list[Path] = []
    for directory in _safety_model_dirs():
        if not directory.exists():
            continue
        candidates.extend(sorted(directory.glob("*.onnx"), key=_model_preference))
    if not candidates:
        return None
    return _spec_for_model(candidates[0].resolve())


def _safety_model_dirs() -> list[Path]:
    dirs: list[Path] = []
    configured = os.environ.get("CROSSAGE_SAFE_MODEL_DIR")
    if configured:
        dirs.append(Path(configured).expanduser())
    source_root = Path(__file__).resolve().parents[2]
    dirs.append(source_root / "models" / "safety")
    dirs.append(Path.cwd() / "models" / "safety")
    executable = Path(sys.executable).resolve()
    dirs.append(executable.parent / "models" / "safety")
    dirs.append(executable.parent.parent / "models" / "safety")
    bundle_root = getattr(sys, "_MEIPASS", None)
    if bundle_root:
        dirs.append(Path(bundle_root) / "models" / "safety")
    unique: list[Path] = []
    seen: set[str] = set()
    for directory in dirs:
        resolved = directory.expanduser().resolve()
        key = str(resolved)
        if key not in seen:
            unique.append(resolved)
            seen.add(key)
    return unique


def _model_preference(path: Path) -> tuple[int, str]:
    name = path.name.lower()
    if "marqo" in name:
        return (0, name)
    if "adamcodd" in name or "vit_base_nsfw" in name:
        return (1, name)
    return (9, name)


def _spec_for_model(path: Path) -> _SafetyModelSpec:
    manifest = _read_json(path.with_suffix(".json"))
    name = path.name.lower()
    labels = _labels_from_manifest(manifest)
    if not labels:
        labels = ("NSFW", "SFW") if "marqo" in name else ("sfw", "nsfw")
    nsfw_label = str(manifest.get("nsfwLabel") or "nsfw").lower()
    nsfw_index = next((index for index, label in enumerate(labels) if label.lower() == nsfw_label), None)
    if nsfw_index is None:
        nsfw_index = 0 if "marqo" in name else min(1, len(labels) - 1)
    input_size = int(manifest.get("inputSize") or manifest.get("imageSize") or (448 if "freepik" in name else 384))
    return _SafetyModelSpec(
        path=path,
        model_name=str(manifest.get("modelName") or _default_model_name(path)),
        source=str(manifest.get("source") or ""),
        license=str(manifest.get("license") or ""),
        input_size=input_size,
        labels=tuple(labels),
        nsfw_index=int(nsfw_index),
        mean=_triple(manifest.get("mean"), (0.5, 0.5, 0.5)),
        std=_triple(manifest.get("std"), (0.5, 0.5, 0.5)),
        interpolation=str(manifest.get("interpolation") or ("bicubic" if "marqo" in name else "bilinear")),
        threshold_hint=str(manifest.get("thresholdHint") or "Use app Safe Mode threshold profiles; calibrate on local labels."),
    )


def _spec_report(spec: _SafetyModelSpec) -> dict[str, Any]:
    return {
        "engine": "onnx-hybrid",
        "available": True,
        "modelName": spec.model_name,
        "path": str(spec.path),
        "source": spec.source,
        "license": spec.license,
        "inputSize": spec.input_size,
        "labels": list(spec.labels),
        "nsfwIndex": spec.nsfw_index,
        "thresholdHint": spec.threshold_hint,
    }


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _labels_from_manifest(manifest: dict[str, Any]) -> tuple[str, ...]:
    labels = manifest.get("labels")
    if isinstance(labels, list) and labels and all(isinstance(item, str) for item in labels):
        return tuple(labels)
    return ()


def _default_model_name(path: Path) -> str:
    name = path.name.lower()
    if "marqo" in name:
        return "Marqo/nsfw-image-detection-384"
    if "adamcodd" in name or "vit_base_nsfw" in name:
        return "AdamCodd/vit-base-nsfw-detector"
    return path.stem


def _triple(value: object, fallback: tuple[float, float, float]) -> tuple[float, float, float]:
    if isinstance(value, list) and len(value) == 3:
        try:
            return (float(value[0]), float(value[1]), float(value[2]))
        except (TypeError, ValueError):
            return fallback
    return fallback


@lru_cache(maxsize=4)
def _session_for_model(model_path: str):
    import onnxruntime as ort

    selected = get_providers(detect_platform())
    providers, provider_options = split_provider_config(selected)
    try:
        if provider_options is not None:
            return ort.InferenceSession(model_path, providers=providers, provider_options=provider_options)
        return ort.InferenceSession(model_path, providers=providers)
    except Exception:
        return ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])


def _softmax(values: np.ndarray) -> np.ndarray:
    shifted = values - np.max(values)
    exp = np.exp(shifted)
    total = np.sum(exp)
    if not np.isfinite(total) or total <= 0:
        return np.zeros_like(values, dtype=np.float32)
    return exp / total

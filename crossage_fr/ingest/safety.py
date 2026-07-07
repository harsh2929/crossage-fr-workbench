from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
import json
import logging
import math
import os
from pathlib import Path
import sys
from typing import Any

import numpy as np
from PIL import Image, ImageOps

from crossage_fr.ingest.image_io import load_image, sha256_file
from crossage_fr.runtime_env import env_flag, env_value
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
    # Multi-level models (e.g. Freepik neutral/low/medium/high) report the dominant
    # level so the UI can separate "suggestive" from "explicit"; "" for 2-class models.
    level: str = ""


def nsfw_probability_from_levels(probs: Any, level_names: Any, sensitive_min_level: Any) -> float:
    """Sensitive probability from an ordered (least→most severe) level distribution:
    the mass at/above ``sensitive_min_level``. Unknown/empty min → only the most
    severe level counts. Used for multi-level classifiers like Freepik."""
    values = [float(p) for p in probs]
    names = [str(n).strip().lower() for n in level_names]
    if not values or len(values) != len(names):
        return 0.0
    target = str(sensitive_min_level or "").strip().lower()
    start = names.index(target) if target in names else len(names) - 1
    return float(sum(values[start:]))


def dominant_level(probs: Any, level_names: Any) -> str:
    """The most probable level name (argmax); "" when inputs don't line up."""
    values = [float(p) for p in probs]
    names = list(level_names)
    if not values or len(values) != len(names):
        return ""
    best = max(range(len(values)), key=lambda i: values[i])
    return str(names[best])


def _logsumexp(values: list[float]) -> float:
    if not values:
        return -1.0e9
    peak = max(values)
    return float(peak + math.log(sum(math.exp(value - peak) for value in values)))


def apply_safe_mode_override(stored_sensitive: Any, override: Any) -> bool:
    """The effective sensitivity for an item: a user override (True/False) wins;
    ``None`` falls back to the classifier's stored verdict."""
    if override is None:
        return bool(stored_sensitive)
    return bool(override)


_OVERRIDE_CLEAR = {"", "clear", "none", "reset", "auto", "default"}
_OVERRIDE_TRUE = {"true", "1", "yes", "on", "sensitive", "flag", "flagged"}
_OVERRIDE_FALSE = {"false", "0", "no", "off", "safe", "not_sensitive", "notsensitive", "unflag", "allow"}


def normalize_override_value(value: Any) -> "bool | None":
    """Parse a command param into True / False / None. None means *clear the
    override* (fall back to the classifier). Unrecognized text also clears."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in _OVERRIDE_CLEAR:
        return None
    if text in _OVERRIDE_TRUE:
        return True
    if text in _OVERRIDE_FALSE:
        return False
    return None


def assess_image_safety(path: Path, threshold: float = 0.58, image: Image.Image | None = None, temperature: float = 1.0) -> SafetyAssessment:
    image = image or load_image(path)
    heuristic = _assess_image_safety_heuristic(image, threshold)
    if _safety_engine_mode() == "heuristic":
        return heuristic
    model = _load_safety_model()
    if model is None:
        return heuristic
    try:
        return model.assess(image, threshold, heuristic, temperature)
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


def calibrate_safety_temperature(labeled: Any, progress: Any | None = None) -> dict[str, Any]:
    """Fit the Safe Mode temperature from local labeled images (res.md Stage 1b).

    ``labeled`` is an iterable of ``(path, label)`` where ``label`` is truthy for
    sensitive/NSFW. Runs the ONNX model per image to get canonical [not, nsfw]
    logit pairs, then fits a single T that minimizes NLL. Returns the fitted T +
    before/after NLL and counts; nothing is persisted here (the caller stores
    ``config.safe_mode_temperature``)."""
    from crossage_fr.ingest.safety_calibration import fit_temperature, temperature_nll

    entries = list(labeled)

    def emit(phase: str, processed: int, **extra: Any) -> None:
        if progress is None:
            return
        progress({"phase": phase, "total": len(entries), "processed": processed, **extra})

    emit("started", 0, accepted=0, failed=0)
    model = _load_safety_model()
    if model is None:
        result = {"ok": False, "reason": "No local ONNX safety model is available to calibrate.", "temperature": 1.0, "sampleCount": 0}
        emit("complete", 0, accepted=0, failed=0, ok=False)
        return result
    pairs: list[list[float]] = []
    labels: list[int] = []
    failed = 0
    for index, entry in enumerate(entries, 1):
        path_text = ""
        try:
            path, label = entry
            path_obj = Path(path)
            path_text = str(path_obj)
        except Exception:
            failed += 1
            emit("processed", index, accepted=len(pairs), failed=failed)
            continue
        emit("processing", index - 1, current_path=path_text, accepted=len(pairs), failed=failed)
        try:
            image = load_image(path_obj)
            pairs.append(model.nsfw_logit_pair(image))
            labels.append(1 if bool(label) else 0)
        except Exception:
            failed += 1
        emit("processed", index, current_path=path_text, accepted=len(pairs), failed=failed)
    positives = sum(labels)
    negatives = len(labels) - positives
    if positives < 2 or negatives < 2:
        result = {
            "ok": False,
            "reason": "Label at least two sensitive and two non-sensitive images to calibrate.",
            "temperature": 1.0,
            "sampleCount": len(pairs),
            "positives": positives,
            "negatives": negatives,
            "failed": failed,
        }
        emit("complete", len(entries), accepted=len(pairs), failed=failed, ok=False)
        return result
    temperature = fit_temperature(pairs, labels)
    result = {
        "ok": True,
        "temperature": float(temperature),
        "sampleCount": len(pairs),
        "positives": positives,
        "negatives": negatives,
        "failed": failed,
        "nllBefore": temperature_nll(pairs, labels, 1.0),
        "nllAfter": temperature_nll(pairs, labels, temperature),
    }
    emit("complete", len(entries), accepted=len(pairs), failed=failed, ok=True)
    return result


def _assess_image_safety_heuristic(image: Image.Image, threshold: float) -> SafetyAssessment:
    prepared = _prepare(image)
    skin_mask = _skin_mask(prepared)
    skin_ratio = float(skin_mask.mean())
    lower_skin_ratio = float(skin_mask[skin_mask.shape[0] // 2 :, :].mean())
    largest_region_ratio = _largest_region_ratio(skin_mask) if skin_ratio >= 0.42 else 0.0
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
    prepared = ImageOps.contain(image, (160, 160), Image.Resampling.BILINEAR)
    return prepared if prepared.mode == "RGB" else prepared.convert("RGB")


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
    expected_sha256: str = ""
    # Multi-level classifiers (Freepik neutral/low/medium/high): ordered level names
    # least→most severe + the minimum level counted as sensitive. Empty for 2-class.
    levels: tuple[str, ...] = ()
    sensitive_min_level: str = ""


class _OnnxSafetyModel:
    def __init__(self, spec: _SafetyModelSpec):
        self.spec = spec
        self.session = _session_for_model(str(spec.path), _model_stat_token(spec.path))
        self.input_name = self.session.get_inputs()[0].name

    def assess(self, image: Image.Image, threshold: float, heuristic: SafetyAssessment, temperature: float = 1.0) -> SafetyAssessment:
        logits = self._logits(image)
        # Stage 1b: temperature scaling (T fit per-user). T=1 leaves the raw model
        # unchanged; T>1 softens over-confident scores before thresholding.
        if temperature and math.isfinite(temperature) and temperature > 0 and temperature != 1.0:
            logits = logits / np.float32(temperature)
        probabilities = _softmax(logits)
        prob_list = [float(v) for v in probabilities]
        level = ""
        if self.spec.levels and len(prob_list) == len(self.spec.levels):
            # Multi-level classifier (e.g. Freepik neutral/low/medium/high): the gate
            # score is the mass at/above the minimum sensitive level; expose the
            # dominant level so the UI can separate suggestive from explicit.
            nsfw_score = nsfw_probability_from_levels(prob_list, self.spec.levels, self.spec.sensitive_min_level)
            level = dominant_level(prob_list, self.spec.levels)
            labels = {name: prob_list[index] for index, name in enumerate(self.spec.levels)}
        else:
            # 2-class softmax. Bound the configured NSFW index against the model's
            # ACTUAL output size — a mismatched/tampered manifest would otherwise
            # IndexError or read the wrong class and bypass the gate.
            n = int(probabilities.shape[0])
            idx = int(self.spec.nsfw_index)
            if n == 0:
                nsfw_score = 0.0
            else:
                if not (0 <= idx < n):
                    logging.getLogger(__name__).warning(
                        "Safety model %s: nsfw_index %d is out of range for %d output class(es); clamping.",
                        self.spec.model_name, idx, n,
                    )
                    idx = min(max(idx, 0), n - 1)
                nsfw_score = float(probabilities[idx])
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
            reason=f"ML Safe Mode score from {self.spec.model_name}{guard_text}" + (f"; level: {level}" if level else ""),
            skin_ratio=heuristic.skin_ratio,
            lower_skin_ratio=heuristic.lower_skin_ratio,
            largest_region_ratio=heuristic.largest_region_ratio,
            engine="onnx-hybrid",
            model_name=self.spec.model_name,
            model_score=nsfw_score,
            heuristic_score=heuristic.score,
            threshold=threshold,
            labels=labels,
            level=level,
        )

    def _logits(self, image: Image.Image) -> np.ndarray:
        logits = np.asarray(self.session.run(None, {self.input_name: self._preprocess(image)})[0])
        if logits.ndim > 1:
            logits = logits[0]
        return logits.astype(np.float32).reshape(-1)

    def nsfw_logit_pair(self, image: Image.Image) -> list[float]:
        # Canonical 2-vector [not_nsfw, nsfw] for calibration, so label 1 == nsfw
        # regardless of the model's own class ordering. Multi-level models use
        # the same at/above-sensitive-level reduction as deployed scoring.
        logits = self._logits(image)
        n = int(logits.shape[0])
        if n == 0:
            return [0.0, 0.0]
        if self.spec.levels and len(self.spec.levels) == n:
            names = [str(name).strip().lower() for name in self.spec.levels]
            target = str(self.spec.sensitive_min_level or "").strip().lower()
            start = names.index(target) if target in names else n - 1
            not_sensitive = [float(logits[i]) for i in range(0, start)]
            sensitive = [float(logits[i]) for i in range(start, n)]
            return [_logsumexp(not_sensitive), _logsumexp(sensitive)]
        idx = min(max(int(self.spec.nsfw_index), 0), n - 1)
        nsfw = float(logits[idx])
        others = [float(logits[i]) for i in range(n) if i != idx]
        return [max(others) if others else 0.0, nsfw]

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
    # MS-1: honor both VINTRACE_* and legacy CROSSAGE_* names for these
    # safety-critical toggles (previously only the legacy name was read, so the
    # documented VINTRACE_SAFE_MODE_ENGINE / VINTRACE_FORCE_FALLBACK were ignored).
    configured = (env_value("SAFE_MODE_ENGINE", default="") or "").strip().lower()
    if configured in {"heuristic", "model", "auto"}:
        return configured
    if env_flag("FORCE_FALLBACK"):
        return "heuristic"
    return "auto"


def _model_stat_token(path: Path) -> tuple[int, int]:
    # MS-7: identity token so the in-memory model/session caches invalidate when
    # the model file on disk is replaced/repaired (the backend is a long-lived
    # process, so a plain lru_cache would pin the first-seen file forever).
    try:
        stat = path.stat()
        return (stat.st_size, stat.st_mtime_ns)
    except OSError:
        return (-1, -1)


# USC-03: pinned SHA-256 for models shipped WITH the app, keyed by file name. The
# trust anchor lives here in code, not in the writable sidecar JSON a local
# attacker could rewrite. A file whose name matches a pinned entry MUST match the
# pinned hash regardless of what its sidecar claims.
_PINNED_SAFETY_MODEL_HASHES = {
    "adamcodd_vit_base_nsfw_int8.onnx": "d25aa73fe1eec78459e35ff911e2af98f652ee919b48d9c54316c86d5ff435fa",
}


def _verify_model_integrity(spec: _SafetyModelSpec) -> str | None:
    # BRS-2/USC-03: verify the model file against a pinned (in-code) hash for known
    # bundled models, else against the manifest sidecar. Returns an error message
    # on mismatch (None when OK, or when no hash is available to verify against).
    pinned = _PINNED_SAFETY_MODEL_HASHES.get(spec.path.name.lower())
    expected = (pinned or spec.expected_sha256 or "").lower()
    if not expected:
        return None
    try:
        actual = sha256_file(spec.path).lower()
    except OSError as exc:
        return f"could not read {spec.path.name} to verify integrity ({exc})"
    if actual != expected:
        anchor = "pinned" if pinned else "manifest"
        return (
            f"{spec.path.name} failed its {anchor} integrity check "
            f"(expected {expected[:12]}…, got {actual[:12]}…)"
        )
    return None


# MS-7: keyed on (path, size, mtime) instead of a bare maxsize=1 cache.
_SAFETY_MODEL_CACHE: dict[tuple[str, int, int], _OnnxSafetyModel] = {}


def _load_safety_model() -> _OnnxSafetyModel | None:
    spec = _find_safety_model()
    if spec is None:
        if _safety_engine_mode() == "model":
            raise RuntimeError("CROSSAGE_SAFE_MODE_ENGINE=model, but no ONNX safety model was found.")
        return None
    size, mtime = _model_stat_token(spec.path)
    cache_key = (str(spec.path), size, mtime)
    model = _SAFETY_MODEL_CACHE.get(cache_key)
    if model is None:
        integrity_error = _verify_model_integrity(spec)
        if integrity_error:
            # BRS-2: a tampered/corrupt model must not be used. In explicit `model`
            # mode this is a hard error; otherwise fail CLOSED to the heuristic gate
            # (assess_image_safety treats None as "use the heuristic"), so Safe Mode
            # stays protective rather than trusting an unverified model.
            if _safety_engine_mode() == "model":
                raise RuntimeError(f"Safe Mode model integrity check failed: {integrity_error}")
            return None
        if len(_SAFETY_MODEL_CACHE) >= 4:
            _SAFETY_MODEL_CACHE.clear()
        model = _OnnxSafetyModel(spec)
        _SAFETY_MODEL_CACHE[cache_key] = model
    return model


def _is_packaged() -> bool:
    return bool(getattr(sys, "frozen", False) or os.environ.get("CROSSAGE_PACKAGED_BACKEND") == "1")


def _find_safety_model() -> _SafetyModelSpec | None:
    # USC-03: in packaged builds ignore the SAFE_MODEL env override so a local
    # attacker can't point Safe Mode at a benign "always-SFW" model. The bundled,
    # pinned-hash model is used instead. The override is honored only in dev.
    configured = None if _is_packaged() else env_value("SAFE_MODEL")
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
    configured = None if _is_packaged() else env_value("SAFE_MODEL_DIR")  # USC-03
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
    # Freepik leads the independent hard-data benchmark; installing it is a
    # deliberate accuracy upgrade, so prefer it over the bundled classifiers.
    if "freepik" in name:
        return (0, name)
    if "marqo" in name:
        return (1, name)
    if "adamcodd" in name or "vit_base_nsfw" in name:
        return (2, name)
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
        expected_sha256=str(manifest.get("sha256") or "").strip().lower(),
        levels=tuple(str(level).strip().lower() for level in (manifest.get("levels") or ()) if str(level).strip()),
        sensitive_min_level=str(manifest.get("sensitiveMinLevel") or "").strip().lower(),
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
def _session_for_model(model_path: str, cache_token: tuple[int, int] = (0, 0)):
    # cache_token (size, mtime) participates in the cache key only so a replaced
    # model file at the same path invalidates the cached session (MS-7).
    del cache_token
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

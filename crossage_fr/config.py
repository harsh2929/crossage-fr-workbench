from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
import json
import math


@dataclass(slots=True)
class Thresholds:
    confident: float = 0.40
    likely: float = 0.28
    relaxed_child: float = 0.20
    quality_min: float = 0.15


@dataclass(slots=True)
class RuntimeConfig:
    model_pack: str = "antelopev2"
    model_root: str = ""
    review_only: bool = True
    require_consent: bool = True
    safe_mode: bool = True
    safe_mode_threshold: float = 0.58
    max_flat_vectors: int = 1_000_000
    cluster_min_size: int = 2
    thresholds: Thresholds = field(default_factory=Thresholds)


def archive_corrupt_file(path: Path) -> None:
    try:
        path.replace(path.with_suffix(".corrupt.json"))
    except OSError:
        pass


def _require_bool(value: object, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean.")
    return value


def _require_int(value: object, field_name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"{field_name} must be an integer greater than or equal to {minimum}.")
    return value


def _require_unit_float(value: object, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{field_name} must be a finite number.")
    result = float(value)
    if result < 0.0 or result > 1.0:
        raise ValueError(f"{field_name} must be between 0 and 1.")
    return result


def _validate_config(config: RuntimeConfig) -> RuntimeConfig:
    config.model_pack = str(config.model_pack)
    config.model_root = str(config.model_root)
    config.review_only = _require_bool(config.review_only, "review_only")
    config.require_consent = _require_bool(config.require_consent, "require_consent")
    config.safe_mode = _require_bool(config.safe_mode, "safe_mode")
    config.safe_mode_threshold = _require_unit_float(config.safe_mode_threshold, "safe_mode_threshold")
    config.max_flat_vectors = _require_int(config.max_flat_vectors, "max_flat_vectors")
    config.cluster_min_size = _require_int(config.cluster_min_size, "cluster_min_size", minimum=2)
    config.thresholds.confident = _require_unit_float(config.thresholds.confident, "thresholds.confident")
    config.thresholds.likely = _require_unit_float(config.thresholds.likely, "thresholds.likely")
    config.thresholds.relaxed_child = _require_unit_float(config.thresholds.relaxed_child, "thresholds.relaxed_child")
    config.thresholds.quality_min = _require_unit_float(config.thresholds.quality_min, "thresholds.quality_min")
    if not config.thresholds.confident >= config.thresholds.likely >= config.thresholds.relaxed_child:
        raise ValueError("thresholds must be descending.")
    return config


def load_config(path: Path) -> RuntimeConfig:
    if not path.exists():
        return RuntimeConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        archive_corrupt_file(path)
        return RuntimeConfig()
    if not isinstance(data, dict):
        archive_corrupt_file(path)
        return RuntimeConfig()
    try:
        raw_thresholds = data.get("thresholds", {})
        if not isinstance(raw_thresholds, dict):
            raise ValueError("thresholds must be an object.")
        thresholds = Thresholds(**raw_thresholds)
        data = {k: v for k, v in data.items() if k != "thresholds"}
        return _validate_config(RuntimeConfig(**data, thresholds=thresholds))
    except (TypeError, ValueError):
        archive_corrupt_file(path)
        return RuntimeConfig()


def save_config(config: RuntimeConfig, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
    temp.replace(path)

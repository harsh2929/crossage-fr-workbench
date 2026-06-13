from __future__ import annotations

from dataclasses import asdict, dataclass, field
from pathlib import Path
import json
import math

from crossage_fr.workspace_registry import atomic_write_text

MAX_CLUSTER_MIN_SIZE = 20
MIN_FACE_DETECTOR_SIZE = 320
MAX_FACE_DETECTOR_SIZE = 1024
PERFORMANCE_MODES = {"auto", "fast", "balanced", "quality"}
DEFAULT_EXCLUDED_DIR_NAMES = [
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".mypy_cache",
    ".pytest_cache",
    ".venv",
    "__pycache__",
    "$RECYCLE.BIN",
    "System Volume Information",
    "node_modules",
    "venv",
]


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
    face_detector_size: int = 512
    two_pass_scan: bool = True
    verification_detector_size: int = 640
    performance_mode: str = "auto"
    max_flat_vectors: int = 1_000_000
    cluster_min_size: int = 2
    storage_budget_bytes: int = 0
    max_media_file_bytes: int = 0
    ffmpeg_path: str = ""
    ffprobe_path: str = ""
    auto_reject_below: float = 0.0
    auto_uncertain_low_quality: bool = False
    auto_reject_low_quality_video: bool = False
    excluded_dir_names: list[str] = field(default_factory=lambda: list(DEFAULT_EXCLUDED_DIR_NAMES))
    excluded_path_keywords: list[str] = field(default_factory=list)
    excluded_extensions: list[str] = field(default_factory=list)
    excluded_file_paths: list[str] = field(default_factory=list)
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


def _require_detector_size(value: object) -> int:
    size = _require_int(value, "face_detector_size", minimum=MIN_FACE_DETECTOR_SIZE)
    if size > MAX_FACE_DETECTOR_SIZE:
        raise ValueError(f"face_detector_size must be {MAX_FACE_DETECTOR_SIZE} or lower.")
    return int(round(size / 32) * 32)


def _require_unit_float(value: object, field_name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(f"{field_name} must be a finite number.")
    result = float(value)
    if result < 0.0 or result > 1.0:
        raise ValueError(f"{field_name} must be between 0 and 1.")
    return result


def _require_string_list(value: object, field_name: str, limit: int = 80) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list.")
    result: list[str] = []
    seen: set[str] = set()
    for item in value[:limit]:
        text = str(item).strip()
        if not text:
            continue
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(text[:160])
    return result


def _normalize_extensions(value: object) -> list[str]:
    result = []
    for item in _require_string_list(value, "excluded_extensions", limit=80):
        ext = item.lower().strip()
        if not ext:
            continue
        if not ext.startswith("."):
            ext = f".{ext}"
        result.append(ext[:32])
    return result


def _require_performance_mode(value: object) -> str:
    mode = str(value or "auto").strip().lower()
    if mode not in PERFORMANCE_MODES:
        raise ValueError("performance_mode must be auto, fast, balanced, or quality.")
    return mode


def _validate_config(config: RuntimeConfig) -> RuntimeConfig:
    config.model_pack = str(config.model_pack)
    config.model_root = str(config.model_root)
    config.review_only = _require_bool(config.review_only, "review_only")
    config.require_consent = _require_bool(config.require_consent, "require_consent")
    config.safe_mode = _require_bool(config.safe_mode, "safe_mode")
    config.safe_mode_threshold = _require_unit_float(config.safe_mode_threshold, "safe_mode_threshold")
    config.face_detector_size = _require_detector_size(config.face_detector_size)
    config.two_pass_scan = _require_bool(config.two_pass_scan, "two_pass_scan")
    config.verification_detector_size = _require_detector_size(config.verification_detector_size)
    config.performance_mode = _require_performance_mode(config.performance_mode)
    if config.verification_detector_size < config.face_detector_size:
        config.verification_detector_size = config.face_detector_size
    config.max_flat_vectors = _require_int(config.max_flat_vectors, "max_flat_vectors")
    config.cluster_min_size = _require_int(config.cluster_min_size, "cluster_min_size", minimum=2)
    if config.cluster_min_size > MAX_CLUSTER_MIN_SIZE:
        raise ValueError(f"cluster_min_size must be less than or equal to {MAX_CLUSTER_MIN_SIZE}.")
    config.storage_budget_bytes = _require_int(config.storage_budget_bytes, "storage_budget_bytes")
    config.max_media_file_bytes = _require_int(config.max_media_file_bytes, "max_media_file_bytes")
    config.ffmpeg_path = str(config.ffmpeg_path or "").strip()[:1000]
    config.ffprobe_path = str(config.ffprobe_path or "").strip()[:1000]
    config.auto_reject_below = _require_unit_float(config.auto_reject_below, "auto_reject_below")
    config.auto_uncertain_low_quality = _require_bool(config.auto_uncertain_low_quality, "auto_uncertain_low_quality")
    config.auto_reject_low_quality_video = _require_bool(config.auto_reject_low_quality_video, "auto_reject_low_quality_video")
    config.excluded_dir_names = _require_string_list(config.excluded_dir_names, "excluded_dir_names")
    config.excluded_path_keywords = _require_string_list(config.excluded_path_keywords, "excluded_path_keywords")
    config.excluded_extensions = _normalize_extensions(config.excluded_extensions)
    config.excluded_file_paths = _require_string_list(config.excluded_file_paths, "excluded_file_paths", limit=400)
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
    # ER-02/MA-6: shared atomic-write-with-fsync; keep the indented format.
    atomic_write_text(path, json.dumps(asdict(config), indent=2))

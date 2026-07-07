from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields as dataclass_fields
from pathlib import Path
import copy
import json
import math

from crossage_fr.workspace_registry import atomic_write_text

MAX_CLUSTER_MIN_SIZE = 20
MIN_FACE_DETECTOR_SIZE = 320
MAX_FACE_DETECTOR_SIZE = 1024
PERFORMANCE_MODES = {"auto", "fast", "balanced", "quality"}
LEARNING_MODES = {"off", "manual", "auto_stage"}

# Safe Mode threshold profiles (res.md Stage 1a). Three tunable operating points
# plus a "custom" escape hatch, so users can move the Safe Mode gate instead of
# being stuck at one threshold. privacy-first is the most aggressive (catches
# more sensitive content, tolerates more false positives on beachwear/medical);
# permissive minimizes false positives. Starting values — final operating points
# come from per-user calibration (Stage 1b).
SAFE_MODE_PROFILES: dict[str, float] = {
    "privacy": 0.30,
    "balanced": 0.50,
    "permissive": 0.85,
}
SAFE_MODE_PROFILE_NAMES = ("privacy", "balanced", "permissive", "custom")


def normalize_safe_mode_profile(value) -> str:
    """Coerce any input to a valid profile name; unknown → 'balanced'."""
    name = str(value or "").strip().lower()
    if name in SAFE_MODE_PROFILES or name == "custom":
        return name
    return "balanced"


def safe_mode_threshold_for_profile(profile, custom_threshold=None) -> float:
    """Effective NSFW threshold for a profile. Named profiles ignore the custom
    value; 'custom' uses it (clamped to [0,1]); missing custom → balanced."""
    profile = normalize_safe_mode_profile(profile)
    if profile in SAFE_MODE_PROFILES:
        return SAFE_MODE_PROFILES[profile]
    if custom_threshold is None:
        return SAFE_MODE_PROFILES["balanced"]
    try:
        value = float(custom_threshold)
    except (TypeError, ValueError):
        return SAFE_MODE_PROFILES["balanced"]
    if not math.isfinite(value):
        return SAFE_MODE_PROFILES["balanced"]
    return max(0.0, min(1.0, value))
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
    # Optional drop-in recognizer filename to prefer (e.g. an LVFace ONNX); empty =
    # the built-in default priority. Switching recognizers re-spaces embeddings, so a
    # change requires re-enrollment + recalibration (the calibrator is model-tagged).
    recognizer_filename: str = ""
    review_only: bool = True
    require_consent: bool = True
    learning_mode: str = "manual"
    per_subject_consent: bool = False
    jurisdiction_preset: str = "standard"
    retention_reviewed_days: int = 90
    safe_mode: bool = True
    safe_mode_threshold: float = 0.58
    # "custom" by default so an existing/explicit safe_mode_threshold is preserved
    # (a named profile — privacy/balanced/permissive — is authoritative when chosen).
    safe_mode_profile: str = "custom"
    # Stage 1b: per-user temperature-scaling calibration for the ML gate. 1.0 = raw
    # model; >1 softens over-confident scores. Fit from local labeled images.
    safe_mode_temperature: float = 1.0
    safe_mode_zero_admittance: bool = False
    face_detector_size: int = 512
    multi_scale_detect: bool = True
    flip_tta: bool = False
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
    # Persisted Platt calibrator [a, b] (score -> P(same identity)); empty = uncalibrated.
    calibration_platt: list[float] = field(default_factory=list)
    # Per-identity Platt calibrators {person: [a, b]} (§5.6 personalization); empty = none.
    calibration_platt_by_person: dict[str, list[float]] = field(default_factory=dict)
    # Recognizer the calibrator was fit on; a model switch makes the calibrator stale.
    calibration_model: str = ""
    thresholds: Thresholds = field(default_factory=Thresholds)


RUNTIME_CONFIG_FIELD_NAMES = {item.name for item in dataclass_fields(RuntimeConfig)}
THRESHOLD_FIELD_NAMES = {item.name for item in dataclass_fields(Thresholds)}


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


def _require_platt(value: object) -> list[float]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple)):
        raise ValueError("calibration_platt must be a list.")
    items = list(value)
    if not items:
        return []
    if len(items) != 2:
        raise ValueError("calibration_platt must be empty or [a, b].")
    result: list[float] = []
    for item in items:
        if isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(float(item)):
            raise ValueError("calibration_platt entries must be finite numbers.")
        result.append(float(item))
    return result


def _require_platt_map(value: object) -> dict[str, list[float]]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("calibration_platt_by_person must be a mapping.")
    result: dict[str, list[float]] = {}
    for key, params in list(value.items())[:5000]:
        person = str(key).strip()[:200]
        if not person:
            continue
        result[person] = _require_platt(params)
    return result


def _require_performance_mode(value: object) -> str:
    mode = str(value or "auto").strip().lower()
    if mode not in PERFORMANCE_MODES:
        raise ValueError("performance_mode must be auto, fast, balanced, or quality.")
    return mode


def _require_learning_mode(value: object) -> str:
    mode = str(value or "manual").strip().lower().replace("-", "_")
    if mode not in LEARNING_MODES:
        raise ValueError("learning_mode must be off, manual, or auto_stage.")
    return mode


def _validate_config(config: RuntimeConfig) -> RuntimeConfig:
    config.model_pack = str(config.model_pack)
    config.model_root = str(config.model_root)
    config.recognizer_filename = str(config.recognizer_filename or "")[:200]
    config.review_only = _require_bool(config.review_only, "review_only")
    config.require_consent = _require_bool(config.require_consent, "require_consent")
    config.learning_mode = _require_learning_mode(config.learning_mode)
    config.per_subject_consent = _require_bool(config.per_subject_consent, "per_subject_consent")
    config.jurisdiction_preset = str(config.jurisdiction_preset or "standard").strip().lower()[:40] or "standard"
    config.retention_reviewed_days = _require_int(config.retention_reviewed_days, "retention_reviewed_days", minimum=1)
    config.safe_mode = _require_bool(config.safe_mode, "safe_mode")
    config.safe_mode_zero_admittance = _require_bool(config.safe_mode_zero_admittance, "safe_mode_zero_admittance")
    config.safe_mode_threshold = _require_unit_float(config.safe_mode_threshold, "safe_mode_threshold")
    # A named profile is authoritative for the effective threshold; "custom"
    # keeps the explicit safe_mode_threshold above.
    config.safe_mode_profile = normalize_safe_mode_profile(config.safe_mode_profile)
    if config.safe_mode_profile != "custom":
        config.safe_mode_threshold = SAFE_MODE_PROFILES[config.safe_mode_profile]
    try:
        temperature = float(config.safe_mode_temperature)
    except (TypeError, ValueError):
        temperature = 1.0
    config.safe_mode_temperature = temperature if (math.isfinite(temperature) and temperature > 0) else 1.0
    config.safe_mode_temperature = max(0.1, min(10.0, config.safe_mode_temperature))
    config.face_detector_size = _require_detector_size(config.face_detector_size)
    config.multi_scale_detect = _require_bool(config.multi_scale_detect, "multi_scale_detect")
    config.flip_tta = _require_bool(config.flip_tta, "flip_tta")
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
    config.calibration_platt = _require_platt(config.calibration_platt)
    config.calibration_platt_by_person = _require_platt_map(config.calibration_platt_by_person)
    config.calibration_model = str(config.calibration_model or "")[:200]
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
    config = RuntimeConfig()
    for key, value in data.items():
        if key == "thresholds" or key not in RUNTIME_CONFIG_FIELD_NAMES:
            continue
        candidate = copy.deepcopy(config)
        try:
            setattr(candidate, key, value)
            config = _validate_config(candidate)
        except (TypeError, ValueError):
            continue
    raw_thresholds = data.get("thresholds", {})
    if isinstance(raw_thresholds, dict):
        threshold_values = asdict(config.thresholds)
        for key, value in raw_thresholds.items():
            if key not in THRESHOLD_FIELD_NAMES:
                continue
            try:
                threshold_values[key] = _require_unit_float(value, f"thresholds.{key}")
            except ValueError:
                continue
        candidate = copy.deepcopy(config)
        candidate.thresholds = Thresholds(**threshold_values)
        try:
            config = _validate_config(candidate)
        except (TypeError, ValueError):
            pass
    return config


def save_config(config: RuntimeConfig, path: Path) -> None:
    # ER-02/MA-6: shared atomic-write-with-fsync; keep the indented format.
    atomic_write_text(path, json.dumps(asdict(config), indent=2))

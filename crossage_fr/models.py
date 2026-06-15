from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
import json
import uuid


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


@dataclass(slots=True)
class ImageRecord:
    image_id: str
    path: str
    sha256: str
    phash: str
    width: int
    height: int
    capture_date: str | None
    # §5.4 governance: how capture_date was obtained — "exif" (trustworthy event
    # date), "mtime" (file modification = scan date for digitized historicals, so
    # an age gap derived from it is meaningless), or "none". Defaults "unknown".
    capture_date_provenance: str = "unknown"


@dataclass(slots=True)
class EmbeddingResult:
    vector: list[float]
    quality: float
    bbox: tuple[int, int, int, int] | None
    model_name: str
    note: str = ""
    pose_bucket: str = "unknown"
    # Raw (pre-normalization) embedding L2 norm kept for analytics/calibration.
    # `quality` is the calibrated [0,1] score derived from it (see
    # crossage_fr.embed.engine.quality_from_norm); 0.0 when not applicable.
    quality_norm: float = 0.0
    # Honest, correctly-scaled signals captured for gating/display/calibration:
    # detector confidence [0,1] and native inter-eye distance in pixels.
    det_score: float = 0.0
    ied_px: float = 0.0
    # Recognition-aware FIQA score [0,1] when a FIQA model is installed (Phase 2.2);
    # 0.0 when the embedding-norm fallback was used.
    fiqa_score: float = 0.0


@dataclass(slots=True)
class ReferenceFace:
    ref_id: str
    person_name: str
    age_bucket: str
    source_path: str
    capture_date: str | None
    quality: float
    model_name: str
    vector: list[float]
    source_hash: str = ""
    pose_bucket: str = "unknown"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat(timespec="seconds") + "Z")
    # §5.4: provenance of capture_date ("exif"/"mtime"/"none"/"unknown"). Defaulted
    # so references.json rows saved before this field load as "unknown".
    capture_date_provenance: str = "unknown"


@dataclass(slots=True)
class ReviewCandidate:
    candidate_id: str
    source_path: str
    person_name: str
    best_ref_id: str | None
    best_ref_path: str | None
    score: float
    band: str
    quality: float
    model_name: str
    status: str = "pending"
    note: str = ""
    risk_flags: list[str] = field(default_factory=list)
    media_kind: str = "image"
    media_source_path: str = ""
    video_timestamp_ms: int | None = None
    video_frame_index: int | None = None
    video_duration_ms: int | None = None
    source_hash: str = ""
    pose_bucket: str = "unknown"
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat(timespec="seconds") + "Z")
    capture_date: str | None = None
    reference_capture_date: str | None = None
    age_gap_years: float | None = None
    age_gap_confidence: str | None = None
    # §5.4 governance: provenance of each capture_date ("exif"/"mtime"/"none"/
    # "unknown"). The age-gap uncertainty banner is shown ONLY when BOTH are
    # "exif"; otherwise the gap is labeled estimated and the NIST band suppressed.
    capture_date_provenance: str | None = None
    reference_capture_date_provenance: str | None = None
    # Top raw cosine before fusion bonuses -- decouples recognizer similarity from
    # heuristic banding for honest calibration/eval (None for pre-existing rows).
    raw_cosine: float | None = None

    def __post_init__(self) -> None:
        # §5.4 invariant (enforced at the data-model level so EVERY construction —
        # fresh scan AND reload of legacy rows persisted before provenance gating
        # existed — obeys it): a real NIST age-gap band and the cross-age-gap flag
        # require BOTH capture dates to be EXIF-verified. Otherwise the gap may be
        # derived from a scan-date (mtime) and must read as "estimated" with no
        # NIST flag — never a false reliability claim. The flag string mirrors
        # crossage_fr.match.age_gap.CROSS_AGE_GAP_FLAG (hardcoded to avoid a
        # circular import; match/ imports this module).
        if self.age_gap_years is None or self.age_gap_confidence in (None, "estimated"):
            return
        verified = self.capture_date_provenance == "exif" and self.reference_capture_date_provenance == "exif"
        if not verified:
            self.age_gap_confidence = "estimated"
            if self.risk_flags:
                self.risk_flags = [flag for flag in self.risk_flags if flag != "cross-age-gap"]


RISK_FLAG_NOTE_MARKERS = {
    "ambiguous-person-margin": ("close identity scores",),
    "close-runner-up": ("another saved person was close", "close identity scores"),
    "single-reference-close-runner-up": ("only one saved photo separates",),
    "single-reference-hard-pose": ("only one hard-angle signal",),
    "single-reference-match": ("only one saved photo supported",),
    "pose-reranked": ("hard-angle match used pose-aware scoring",),
}


def normalize_risk_flags(value: Any = None, note: str = "") -> list[str]:
    raw: list[str] = []
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            try:
                decoded = json.loads(stripped)
            except json.JSONDecodeError:
                decoded = None
            if isinstance(decoded, list):
                raw.extend(str(item) for item in decoded)
            else:
                raw.extend(item for item in stripped.replace(",", " ").split(" ") if item)
    elif isinstance(value, (list, tuple, set)):
        raw.extend(str(item) for item in value)
    note_text = str(note or "").casefold()
    for flag, markers in RISK_FLAG_NOTE_MARKERS.items():
        if any(marker in note_text for marker in markers):
            raw.append(flag)
    return sorted({flag.strip().casefold() for flag in raw if flag and flag.strip()})


def dataclass_to_json(obj: Any) -> str:
    return json.dumps(asdict(obj), indent=2)


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))

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


@dataclass(slots=True)
class EmbeddingResult:
    vector: list[float]
    quality: float
    bbox: tuple[int, int, int, int] | None
    model_name: str
    note: str = ""
    pose_bucket: str = "unknown"


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

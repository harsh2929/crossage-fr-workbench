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
    media_kind: str = "image"
    media_source_path: str = ""
    video_timestamp_ms: int | None = None
    video_frame_index: int | None = None
    video_duration_ms: int | None = None
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat(timespec="seconds") + "Z")


def dataclass_to_json(obj: Any) -> str:
    return json.dumps(asdict(obj), indent=2)


def read_json_list(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))

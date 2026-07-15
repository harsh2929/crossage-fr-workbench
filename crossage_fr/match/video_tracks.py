"""Deterministic sampled-face tracking and quality-keyframe template pooling."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
from pathlib import Path
from statistics import median
from typing import Sequence

import numpy as np
from PIL import Image

from crossage_fr.ingest.video_io import variance_of_laplacian
from crossage_fr.match.pooling import pool_template
from crossage_fr.models import EmbeddingResult
from crossage_fr.vector_math import l2_normalize


VIDEO_TRACK_TEMPLATE_VERSION = "video-track-template-v1"
VIDEO_TRACK_MIN_COSINE = 0.45
VIDEO_TRACK_STRONG_COSINE = 0.62
VIDEO_TRACK_MAX_GAP_MS = 15_000
VIDEO_TRACK_KEYFRAME_LIMIT = 5


@dataclass(frozen=True, slots=True)
class VideoFaceObservation:
    frame_path: Path
    timestamp_ms: int
    frame_index: int
    duration_ms: int
    frame_width: int
    frame_height: int
    embedding: EmbeddingResult
    sharpness: float


@dataclass(frozen=True, slots=True)
class VideoTrackTemplate:
    track_id: str
    observations: tuple[VideoFaceObservation, ...]
    keyframes: tuple[VideoFaceObservation, ...]
    representative: VideoFaceObservation
    vector: list[float]
    quality: float
    start_ms: int
    end_ms: int
    model_name: str
    template_version: str = VIDEO_TRACK_TEMPLATE_VERSION


@dataclass(slots=True)
class _TrackState:
    observations: list[VideoFaceObservation]
    template: np.ndarray


def face_crop_sharpness(image: Image.Image, bbox: tuple[int, int, int, int] | None) -> float:
    """Native face-crop focus score; invalid boxes degrade to the whole frame."""
    gray = image.convert("L")
    if bbox is not None:
        left, top, right, bottom = (int(value) for value in bbox)
        left = max(0, min(gray.width - 1, left))
        top = max(0, min(gray.height - 1, top))
        right = max(left + 1, min(gray.width, right))
        bottom = max(top + 1, min(gray.height, bottom))
        if right > left and bottom > top:
            gray = gray.crop((left, top, right, bottom))
    return variance_of_laplacian(np.asarray(gray, dtype=np.float64))


def _unit_vector(values: Sequence[float]) -> np.ndarray | None:
    vector = np.asarray(list(values), dtype=np.float64)
    if vector.ndim != 1 or vector.size != 512 or not np.isfinite(vector).all():
        return None
    norm = float(np.linalg.norm(vector))
    if norm <= 1e-12:
        return None
    return l2_normalize(vector, dtype=np.float64)


def _normalized_bbox(observation: VideoFaceObservation) -> tuple[float, float, float, float] | None:
    bbox = observation.embedding.bbox
    if bbox is None or observation.frame_width <= 0 or observation.frame_height <= 0:
        return None
    left, top, right, bottom = (float(value) for value in bbox)
    if right <= left or bottom <= top:
        return None
    return (
        left / observation.frame_width,
        top / observation.frame_height,
        right / observation.frame_width,
        bottom / observation.frame_height,
    )


def _bbox_affinity(left: VideoFaceObservation, right: VideoFaceObservation) -> tuple[float, float]:
    a = _normalized_bbox(left)
    b = _normalized_bbox(right)
    if a is None or b is None:
        return 0.0, 1.0
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    area_a = max(0.0, a[2] - a[0]) * max(0.0, a[3] - a[1])
    area_b = max(0.0, b[2] - b[0]) * max(0.0, b[3] - b[1])
    union = area_a + area_b - intersection
    iou = intersection / union if union > 0 else 0.0
    center_a = ((a[0] + a[2]) / 2.0, (a[1] + a[3]) / 2.0)
    center_b = ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)
    distance = math.hypot(center_a[0] - center_b[0], center_a[1] - center_b[1])
    return iou, distance


def _association_score(track: _TrackState, observation: VideoFaceObservation) -> float | None:
    vector = _unit_vector(observation.embedding.vector)
    if vector is None or observation.embedding.model_name != track.observations[-1].embedding.model_name:
        return None
    cosine = float(track.template @ vector)
    iou, center_distance = _bbox_affinity(track.observations[-1], observation)
    if cosine < VIDEO_TRACK_MIN_COSINE:
        return None
    if cosine < VIDEO_TRACK_STRONG_COSINE and iou < 0.02 and center_distance > 0.35:
        return None
    return cosine + min(0.08, iou * 0.08) - min(0.05, center_distance * 0.05)


def _adaptive_gap_ms(observations: Sequence[VideoFaceObservation]) -> int:
    timestamps = sorted({max(0, int(item.timestamp_ms)) for item in observations})
    gaps = [right - left for left, right in zip(timestamps, timestamps[1:]) if right > left]
    if not gaps:
        return 5_000
    return min(VIDEO_TRACK_MAX_GAP_MS, max(2_500, int(median(gaps) * 2.5)))


def _update_track(track: _TrackState, observation: VideoFaceObservation) -> None:
    track.observations.append(observation)
    vectors = [item.embedding.vector for item in track.observations]
    qualities = [item.embedding.quality for item in track.observations]
    pooled = _unit_vector(pool_template(vectors, qualities))
    if pooled is not None:
        track.template = pooled


def _ranked_keyframes(observations: Sequence[VideoFaceObservation], limit: int) -> list[VideoFaceObservation]:
    rows = list(observations)
    if not rows:
        return []
    sharp_values = np.log1p(np.asarray([max(0.0, item.sharpness) for item in rows], dtype=np.float64))
    sharp_span = float(np.ptp(sharp_values))
    sharp_norm = (sharp_values - float(sharp_values.min())) / sharp_span if sharp_span > 1e-12 else np.ones(len(rows))
    ied_values = np.asarray([max(0.0, item.embedding.ied_px) for item in rows], dtype=np.float64)
    ied_scale = max(1.0, float(np.percentile(ied_values, 90)))
    scored: list[tuple[float, VideoFaceObservation]] = []
    for index, item in enumerate(rows):
        alignment_penalty = min(0.15, max(0.0, float(item.embedding.align_error)) * 0.5)
        score = (
            0.68 * max(0.0, min(1.0, float(item.embedding.quality)))
            + 0.22 * float(sharp_norm[index])
            + 0.10 * min(1.0, float(ied_values[index]) / ied_scale)
            - alignment_penalty
        )
        scored.append((score, item))
    scored.sort(key=lambda row: (-row[0], row[1].timestamp_ms, row[1].frame_index, str(row[1].frame_path)))
    count = max(1, min(int(limit), len(scored)))
    span = max(item.timestamp_ms for item in rows) - min(item.timestamp_ms for item in rows)
    separation = max(250, int(span / max(2, count * 2))) if span > 0 else 0
    selected: list[VideoFaceObservation] = []
    for _score, item in scored:
        if separation and any(abs(item.timestamp_ms - chosen.timestamp_ms) < separation for chosen in selected):
            continue
        selected.append(item)
        if len(selected) >= count:
            break
    if len(selected) < count:
        for _score, item in scored:
            if item not in selected:
                selected.append(item)
            if len(selected) >= count:
                break
    return sorted(selected, key=lambda item: (item.timestamp_ms, item.frame_index, str(item.frame_path)))


def _finalize_track(source_key: str, state: _TrackState, keyframe_limit: int) -> VideoTrackTemplate | None:
    observations = sorted(
        state.observations,
        key=lambda item: (item.timestamp_ms, item.frame_index, str(item.frame_path)),
    )
    keyframes = _ranked_keyframes(observations, keyframe_limit)
    if not keyframes:
        return None
    vectors = [item.embedding.vector for item in keyframes]
    sharp_logs = [math.log1p(max(0.0, item.sharpness)) for item in keyframes]
    sharp_max = max(sharp_logs) or 1.0
    weights = [
        max(0.05, float(item.embedding.quality)) * (0.8 + 0.2 * sharp / sharp_max)
        for item, sharp in zip(keyframes, sharp_logs)
    ]
    vector = pool_template(vectors, weights)
    if _unit_vector(vector) is None:
        return None
    representative = max(
        keyframes,
        key=lambda item: (
            float(item.embedding.quality),
            math.log1p(max(0.0, item.sharpness)),
            float(item.embedding.ied_px),
            -item.timestamp_ms,
        ),
    )
    quality = sum(float(item.embedding.quality) * weight for item, weight in zip(keyframes, weights)) / max(1e-9, sum(weights))
    first = observations[0]
    identity = "|".join(
        (
            VIDEO_TRACK_TEMPLATE_VERSION,
            source_key,
            first.embedding.model_name,
            str(first.timestamp_ms),
            str(first.frame_index),
            ",".join(str(value) for value in (first.embedding.bbox or ())),
        )
    )
    return VideoTrackTemplate(
        track_id=f"vtrack_{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:16]}",
        observations=tuple(observations),
        keyframes=tuple(keyframes),
        representative=representative,
        vector=[float(value) for value in vector],
        quality=max(0.0, min(1.0, float(quality))),
        start_ms=max(0, int(observations[0].timestamp_ms)),
        end_ms=max(0, int(observations[-1].timestamp_ms)),
        model_name=first.embedding.model_name,
    )


def build_video_track_templates(
    observations: Sequence[VideoFaceObservation],
    *,
    source_key: str,
    keyframe_limit: int = VIDEO_TRACK_KEYFRAME_LIMIT,
) -> list[VideoTrackTemplate]:
    """Associate sampled detections one-to-one per timestamp, then pool keyframes."""
    usable = [item for item in observations if _unit_vector(item.embedding.vector) is not None]
    usable.sort(
        key=lambda item: (
            item.timestamp_ms,
            item.frame_index,
            item.embedding.model_name,
            item.embedding.bbox or (),
            str(item.frame_path),
        )
    )
    if not usable:
        return []
    max_gap_ms = _adaptive_gap_ms(usable)
    tracks: list[_TrackState] = []
    for timestamp in sorted({item.timestamp_ms for item in usable}):
        frame_rows = [item for item in usable if item.timestamp_ms == timestamp]
        active = [
            (index, track)
            for index, track in enumerate(tracks)
            if timestamp - track.observations[-1].timestamp_ms <= max_gap_ms
        ]
        edges: list[tuple[float, int, int]] = []
        for row_index, observation in enumerate(frame_rows):
            for track_index, track in active:
                score = _association_score(track, observation)
                if score is not None:
                    edges.append((score, track_index, row_index))
        assigned_tracks: set[int] = set()
        assigned_rows: set[int] = set()
        for _score, track_index, row_index in sorted(edges, key=lambda row: (-row[0], row[1], row[2])):
            if track_index in assigned_tracks or row_index in assigned_rows:
                continue
            _update_track(tracks[track_index], frame_rows[row_index])
            assigned_tracks.add(track_index)
            assigned_rows.add(row_index)
        for row_index, observation in enumerate(frame_rows):
            if row_index in assigned_rows:
                continue
            vector = _unit_vector(observation.embedding.vector)
            if vector is not None:
                tracks.append(_TrackState(observations=[observation], template=vector))
    finalized = [
        track
        for state in tracks
        if (track := _finalize_track(source_key, state, keyframe_limit)) is not None
    ]
    return sorted(finalized, key=lambda item: (item.start_ms, item.end_ms, item.track_id))

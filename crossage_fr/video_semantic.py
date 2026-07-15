"""Deterministic visual segmentation for timestamped video retrieval."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from crossage_fr.ingest.video_io import VideoFrameSample


VIDEO_SEMANTIC_INDEX_VERSION = "visual-segments-v1"
VIDEO_SEMANTIC_SAMPLE_INTERVAL_SECONDS = 2.0
VIDEO_SEMANTIC_MAX_FRAMES = 180
VIDEO_SEMANTIC_MAX_SEGMENT_MS = 12_000
VIDEO_SEMANTIC_CHANGE_SIMILARITY = 0.95
VIDEO_SEMANTIC_FINGERPRINT_CHUNK_BYTES = 64 * 1024
VIDEO_SEMANTIC_FINGERPRINT_CHUNKS = 8


@dataclass(frozen=True, slots=True)
class VideoVisualSegment:
    segment_id: str
    start_ms: int
    end_ms: int
    timestamp_ms: int
    frame_index: int
    duration_ms: int
    preview_path: str
    sample_count: int
    vector: tuple[float, ...]


def video_source_fingerprint(path: Path) -> str:
    """Hash evenly spaced source chunks so stale decoder caches are rejected cheaply."""
    resolved = path.expanduser().resolve()
    stat = resolved.stat()
    size = max(0, int(stat.st_size))
    chunk_size = VIDEO_SEMANTIC_FINGERPRINT_CHUNK_BYTES
    max_offset = max(0, size - chunk_size)
    if size <= chunk_size:
        offsets = [0]
    else:
        offsets = sorted({
            int(round(max_offset * index / max(1, VIDEO_SEMANTIC_FINGERPRINT_CHUNKS - 1)))
            for index in range(VIDEO_SEMANTIC_FINGERPRINT_CHUNKS)
        })
    digest = hashlib.sha256()
    digest.update(f"video-semantic-source-v1\0{size}\0".encode("ascii"))
    with resolved.open("rb") as handle:
        for offset in offsets:
            handle.seek(offset)
            block = handle.read(chunk_size)
            digest.update(int(offset).to_bytes(8, "big", signed=False))
            digest.update(len(block).to_bytes(8, "big", signed=False))
            digest.update(block)
    return digest.hexdigest()


def build_video_visual_segments(
    *,
    asset_id: str,
    model_name: str,
    source_fingerprint: str,
    samples: Sequence[VideoFrameSample],
    vectors: Iterable[Iterable[float]],
    index_version: str = VIDEO_SEMANTIC_INDEX_VERSION,
    change_similarity: float = VIDEO_SEMANTIC_CHANGE_SIMILARITY,
    max_segment_ms: int = VIDEO_SEMANTIC_MAX_SEGMENT_MS,
) -> list[VideoVisualSegment]:
    """Group adjacent visual samples into bounded, searchable timeline segments."""
    clean_asset_id = str(asset_id or "").strip()
    clean_model = str(model_name or "").strip()
    clean_fingerprint = str(source_fingerprint or "").strip().lower()
    clean_version = str(index_version or "").strip()
    if not clean_asset_id or not clean_model or not clean_fingerprint or not clean_version:
        raise ValueError("Video segment identity is incomplete.")
    if not samples:
        return []

    matrix = np.asarray(list(vectors), dtype=np.float32)
    if matrix.ndim != 2 or matrix.shape[0] != len(samples) or matrix.shape[1] <= 0:
        raise ValueError("Video frame embeddings do not match the sampled frames.")
    if not np.isfinite(matrix).all():
        raise ValueError("Video frame embeddings contain non-finite values.")
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    if np.any(norms <= 1e-12):
        raise ValueError("Video frame embeddings contain an empty vector.")
    matrix = matrix / norms

    ordered_rows = sorted(
        zip(samples, matrix, strict=True),
        key=lambda row: (max(0, int(row[0].timestamp_ms)), max(0, int(row[0].frame_index))),
    )
    deduplicated: list[tuple[VideoFrameSample, np.ndarray]] = []
    seen_timestamps: set[int] = set()
    for sample, vector in ordered_rows:
        timestamp_ms = max(0, int(sample.timestamp_ms))
        if timestamp_ms in seen_timestamps:
            continue
        seen_timestamps.add(timestamp_ms)
        deduplicated.append((sample, vector))
    if not deduplicated:
        return []

    similarity_threshold = min(0.999, max(-1.0, float(change_similarity)))
    duration_limit = max(1_000, int(max_segment_ms))
    groups: list[list[tuple[VideoFrameSample, np.ndarray]]] = [[deduplicated[0]]]
    for row in deduplicated[1:]:
        current = groups[-1]
        previous_sample, previous_vector = current[-1]
        sample, vector = row
        segment_span_ms = max(0, int(sample.timestamp_ms) - int(current[0][0].timestamp_ms))
        adjacent_similarity = float(np.dot(previous_vector, vector))
        if adjacent_similarity < similarity_threshold or segment_span_ms >= duration_limit:
            groups.append([row])
        else:
            current.append(row)

    timestamps = [max(0, int(row[0].timestamp_ms)) for row in deduplicated]
    positive_gaps = [right - left for left, right in zip(timestamps, timestamps[1:]) if right > left]
    nominal_gap_ms = int(round(float(np.median(positive_gaps)))) if positive_gaps else 2_000
    nominal_gap_ms = max(250, nominal_gap_ms)
    declared_duration_ms = max(max(0, int(row[0].duration_ms)) for row in deduplicated)
    timeline_end_ms = max(declared_duration_ms, timestamps[-1] + max(1, nominal_gap_ms // 2))

    boundaries = [0]
    for left, right in zip(groups, groups[1:]):
        left_ms = max(0, int(left[-1][0].timestamp_ms))
        right_ms = max(left_ms + 1, int(right[0][0].timestamp_ms))
        boundaries.append(max(boundaries[-1] + 1, int(round((left_ms + right_ms) / 2))))
    boundaries.append(max(boundaries[-1] + 1, timeline_end_ms))

    segments: list[VideoVisualSegment] = []
    for group_index, group in enumerate(groups):
        group_matrix = np.stack([row[1] for row in group]).astype(np.float32, copy=False)
        centroid = group_matrix.mean(axis=0)
        centroid_norm = float(np.linalg.norm(centroid))
        if not math.isfinite(centroid_norm) or centroid_norm <= 1e-12:
            raise ValueError("Video segment centroid is invalid.")
        centroid = centroid / centroid_norm
        representative_index = int(np.argmax(group_matrix @ centroid))
        representative = group[representative_index][0]
        start_ms = int(boundaries[group_index])
        end_ms = int(boundaries[group_index + 1])
        timestamp_ms = min(max(start_ms, int(representative.timestamp_ms)), max(start_ms, end_ms - 1))
        identity = {
            "assetId": clean_asset_id,
            "endMs": end_ms,
            "indexVersion": clean_version,
            "modelName": clean_model,
            "sourceFingerprint": clean_fingerprint,
            "startMs": start_ms,
            "timestampMs": timestamp_ms,
        }
        segment_id = "vseg_" + hashlib.sha256(
            json.dumps(identity, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ).hexdigest()[:32]
        segments.append(
            VideoVisualSegment(
                segment_id=segment_id,
                start_ms=start_ms,
                end_ms=end_ms,
                timestamp_ms=timestamp_ms,
                frame_index=max(0, int(representative.frame_index)),
                duration_ms=max(declared_duration_ms, end_ms),
                preview_path=str(representative.path.expanduser().resolve()),
                sample_count=len(group),
                vector=tuple(float(value) for value in centroid.tolist()),
            )
        )
    return segments

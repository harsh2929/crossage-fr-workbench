"""Consent-bound cross-age reference augmentation primitives.

The deterministic bridge interpolates only between two real, consented age-band
reference centroids. A separate review-first workflow can stage locally generated
age portraits, but those are explicitly marked synthetic and never auto-enrolled.
"""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Iterable

import numpy as np

from crossage_fr.models import ReferenceFace


AGE_TRAJECTORY_METHOD_VERSION = "embedding-age-trajectory-slerp-v1"
IMAGE_AGE_AUGMENTATION_METHOD_VERSION = "qwen-image-edit-2511-age-v1"
AGE_TRAJECTORY_REFERENCE_KIND = "synthetic-age-trajectory"
REAL_REFERENCE_KIND = "real"
AGE_BUCKET_ORDER = ("child", "adolescent", "adult", "older-adult", "senior")
AGE_BUCKET_CENTERS = {
    "child": 8.0,
    "adolescent": 15.0,
    "adult": 33.0,
    "older-adult": 57.0,
    "senior": 72.0,
}
_AGE_BUCKET_ALIASES = {
    "kid": "child",
    "teen": "adolescent",
    "young": "adolescent",
    "young-adult": "adult",
    "middle-age": "adult",
    "middle-aged": "adult",
    "older": "older-adult",
    "old": "senior",
    "elder": "senior",
}
_MAX_PARENTS_PER_BUCKET = 4
_MIN_PARENT_COSINE = 0.10


@dataclass(frozen=True, slots=True)
class AgeTrajectoryCandidate:
    ref_id: str
    target_age_bucket: str
    model_name: str
    vector: list[float]
    quality: float
    parent_ref_ids: tuple[str, ...]
    anchor_ref_id: str
    left_age_bucket: str
    right_age_bucket: str
    interpolation: float
    derivation_hash: str


@dataclass(frozen=True, slots=True)
class _BucketCentroid:
    vector: np.ndarray
    parent_refs: tuple[ReferenceFace, ...]
    quality: float


def normalize_age_bucket(value: str | None) -> str:
    bucket = str(value or "").strip().casefold().replace("_", "-").replace(" ", "-")
    bucket = _AGE_BUCKET_ALIASES.get(bucket, bucket)
    return bucket if bucket in AGE_BUCKET_ORDER else "unknown"


def age_bucket_for_years(age: int | float | None) -> str:
    try:
        value = float(age) if age is not None else -1.0
    except (TypeError, ValueError):
        return "unknown"
    if not np.isfinite(value) or value < 0.0 or value > 120.0:
        return "unknown"
    if value <= 12.0:
        return "child"
    if value <= 17.0:
        return "adolescent"
    if value <= 49.0:
        return "adult"
    if value <= 64.0:
        return "older-adult"
    return "senior"


def is_synthetic_age_reference(ref: ReferenceFace) -> bool:
    return str(getattr(ref, "reference_kind", REAL_REFERENCE_KIND) or REAL_REFERENCE_KIND) == AGE_TRAJECTORY_REFERENCE_KIND


def is_generated_age_image_reference(ref: ReferenceFace) -> bool:
    return is_synthetic_age_reference(ref) and str(getattr(ref, "synthetic_method_version", "") or "") == IMAGE_AGE_AUGMENTATION_METHOD_VERSION


def _unit_vector(vector: object) -> np.ndarray | None:
    try:
        array = np.asarray(vector, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    if array.ndim != 1 or array.size != 512 or not np.isfinite(array).all():
        return None
    norm = float(np.linalg.norm(array))
    if not np.isfinite(norm) or norm <= 1e-8:
        return None
    return np.asarray(array / norm, dtype=np.float32)


def spherical_interpolate(left: object, right: object, amount: float) -> list[float] | None:
    """Interpolate two unit embeddings on the hypersphere without extrapolation."""
    left_unit = _unit_vector(left)
    right_unit = _unit_vector(right)
    if left_unit is None or right_unit is None:
        return None
    try:
        t = float(amount)
    except (TypeError, ValueError):
        return None
    if not np.isfinite(t) or t <= 0.0 or t >= 1.0:
        return None
    cosine = float(np.clip(np.dot(left_unit, right_unit), -1.0, 1.0))
    if cosine < -0.95:
        return None
    if cosine > 0.9995:
        mixed = (1.0 - t) * left_unit + t * right_unit
    else:
        theta = float(np.arccos(cosine))
        denominator = float(np.sin(theta))
        if denominator <= 1e-8:
            return None
        mixed = (np.sin((1.0 - t) * theta) / denominator) * left_unit
        mixed += (np.sin(t * theta) / denominator) * right_unit
    normalized = _unit_vector(mixed)
    return normalized.astype(float).tolist() if normalized is not None else None


def _robust_centroid(refs: list[ReferenceFace]) -> _BucketCentroid | None:
    rows: list[tuple[ReferenceFace, np.ndarray]] = []
    for ref in sorted(refs, key=lambda item: (-float(item.quality), item.ref_id)):
        vector = _unit_vector(ref.vector)
        if vector is not None:
            rows.append((ref, vector))
        if len(rows) >= _MAX_PARENTS_PER_BUCKET:
            break
    if not rows:
        return None
    matrix = np.stack([row[1] for row in rows], axis=0)
    if len(rows) >= 3:
        similarities = matrix @ matrix.T
        medoid_index = int(np.argmax(np.median(similarities, axis=1)))
        to_medoid = similarities[medoid_index]
        median = float(np.median(to_medoid))
        mad = float(np.median(np.abs(to_medoid - median)))
        floor = max(-0.10, median - max(0.08, 3.0 * mad))
        kept = [index for index, similarity in enumerate(to_medoid) if float(similarity) >= floor]
        if len(kept) >= 2:
            rows = [rows[index] for index in kept]
            matrix = matrix[kept]
    weights = np.asarray([max(0.15, min(1.0, float(ref.quality))) for ref, _ in rows], dtype=np.float32)
    centroid = _unit_vector(np.average(matrix, axis=0, weights=weights))
    if centroid is None:
        return None
    quality = float(np.average(np.asarray([float(ref.quality) for ref, _ in rows]), weights=weights))
    return _BucketCentroid(centroid, tuple(ref for ref, _ in rows), max(0.0, min(1.0, quality)))


def build_age_trajectory_candidates(references: Iterable[ReferenceFace]) -> list[AgeTrajectoryCandidate]:
    """Build deterministic bridge references for missing bands between real bands.

    References from different recognizers are never mixed. Unknown bands, existing
    synthetic references, invalid vectors, and endpoint extrapolation are ignored.
    """
    grouped: dict[str, dict[str, list[ReferenceFace]]] = {}
    for ref in references:
        if is_synthetic_age_reference(ref):
            continue
        bucket = normalize_age_bucket(ref.age_bucket)
        model_name = str(ref.model_name or "").strip()
        if bucket == "unknown" or not model_name:
            continue
        grouped.setdefault(model_name, {}).setdefault(bucket, []).append(ref)

    candidates: list[AgeTrajectoryCandidate] = []
    for model_name, bucket_refs in sorted(grouped.items()):
        centroids = {
            bucket: centroid
            for bucket, refs in bucket_refs.items()
            if (centroid := _robust_centroid(refs)) is not None
        }
        present = sorted(AGE_BUCKET_ORDER.index(bucket) for bucket in centroids)
        if len(present) < 2:
            continue
        for target_index in range(present[0] + 1, present[-1]):
            target_bucket = AGE_BUCKET_ORDER[target_index]
            if target_bucket in centroids:
                continue
            left_index = max(index for index in present if index < target_index)
            right_index = min(index for index in present if index > target_index)
            left_bucket = AGE_BUCKET_ORDER[left_index]
            right_bucket = AGE_BUCKET_ORDER[right_index]
            left = centroids[left_bucket]
            right = centroids[right_bucket]
            cosine = float(np.dot(left.vector, right.vector))
            if not np.isfinite(cosine) or cosine < _MIN_PARENT_COSINE:
                continue
            left_age = AGE_BUCKET_CENTERS[left_bucket]
            right_age = AGE_BUCKET_CENTERS[right_bucket]
            amount = (AGE_BUCKET_CENTERS[target_bucket] - left_age) / (right_age - left_age)
            vector = spherical_interpolate(left.vector, right.vector, amount)
            if vector is None:
                continue
            parent_refs = (*left.parent_refs, *right.parent_refs)
            parent_ids = tuple(ref.ref_id for ref in parent_refs)
            identity_payload = {
                "methodVersion": AGE_TRAJECTORY_METHOD_VERSION,
                "modelName": model_name,
                "targetAgeBucket": target_bucket,
                "parents": [
                    {"refId": ref.ref_id, "sourceHash": str(ref.source_hash or "")}
                    for ref in parent_refs
                ],
            }
            digest = hashlib.sha256(
                json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
            ).hexdigest()
            anchor_group = left.parent_refs if amount <= 0.5 else right.parent_refs
            anchor = max(anchor_group, key=lambda ref: (float(ref.quality), ref.ref_id))
            candidates.append(
                AgeTrajectoryCandidate(
                    ref_id=f"ref_age_{digest[:16]}",
                    target_age_bucket=target_bucket,
                    model_name=model_name,
                    vector=vector,
                    quality=round(min(left.quality, right.quality) * 0.85, 6),
                    parent_ref_ids=parent_ids,
                    anchor_ref_id=anchor.ref_id,
                    left_age_bucket=left_bucket,
                    right_age_bucket=right_bucket,
                    interpolation=round(float(amount), 6),
                    derivation_hash=digest,
                )
            )
    return sorted(candidates, key=lambda item: (item.model_name, AGE_BUCKET_ORDER.index(item.target_age_bucket), item.ref_id))

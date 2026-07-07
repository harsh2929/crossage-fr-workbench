"""Self-consistency-weighted template pooling (Phase-4 §5.3).

A personal library has many shots per identity (and many frames per video track). Naive
mean pooling lets one outlier crop -- a mis-aligned, occluded, or wrong-person frame --
drag the template. Weighting each embedding by its AGREEMENT with the set (cosine to the
set's mean direction), optionally times its quality, is a license-clean, training-free
approximation of learned set aggregation: it down-weights outliers and keeps the template
on the dominant identity. Pure NumPy over the 512-d embeddings the pipeline already has.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np


def _normalize_rows(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return values / norms


def self_consistency_weights(vectors: Sequence[Sequence[float]]) -> list[float]:
    """Per-vector agreement with the set: cosine to the set's mean direction in [0,1]
    (clamped at 0). Outliers (low/negative agreement) score lowest."""
    arr = np.asarray(list(vectors), dtype="float64")
    if arr.ndim != 2 or arr.shape[0] == 0:
        return [0.0] * len(vectors)
    unit = _normalize_rows(arr)
    mean_dir = unit.mean(axis=0)
    norm = float(np.linalg.norm(mean_dir))
    if norm == 0.0:
        return [1.0] * arr.shape[0]
    mean_dir = mean_dir / norm
    return [max(0.0, float(row @ mean_dir)) for row in unit]


def template_cosine(vector: Sequence[float], template: Sequence[float]) -> float:
    """Cosine of an embedding to a (pooled) template; both are L2-normalized first."""
    a = np.asarray(list(vector), dtype="float64")
    b = np.asarray(list(template), dtype="float64")
    if a.shape != b.shape or a.size == 0:
        return 0.0
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return float((a / na) @ (b / nb))


def weak_pooled_support(matched_cosine: float, template_cosine_value: float, *, drop: float = 0.10) -> bool:
    """True when a match's similarity to its best individual reference far exceeds its
    similarity to the person's robust pooled template -- i.e. it leaned on ONE outlier
    crop rather than the identity. A precision signal: such a match should not be
    auto-confident. False when the template is unavailable (cosine 0) -> degrade-safe."""
    if template_cosine_value <= 0.0:
        return False
    return float(matched_cosine) - float(template_cosine_value) > float(drop)


def pool_template(
    vectors: Sequence[Sequence[float]],
    qualities: Sequence[float] | None = None,
) -> list[float]:
    """L2-normalized template from a set of embeddings, weighted by self-consistency
    (and quality when provided). Robust to outlier crops; falls back to the plain mean
    when agreement is degenerate. Returns the single input (normalized) for n==1."""
    arr = np.asarray(list(vectors), dtype="float64")
    if arr.ndim != 2 or arr.shape[0] == 0:
        return []
    unit = _normalize_rows(arr)
    if unit.shape[0] == 1:
        return unit[0].astype("float32").tolist()
    weights = np.asarray(self_consistency_weights(vectors), dtype="float64")
    if qualities is not None:
        q = np.asarray(list(qualities), dtype="float64")
        if q.shape[0] == weights.shape[0]:
            weights = weights * np.clip(q, 0.0, None)
    if not np.any(weights > 0):
        weights = np.ones(unit.shape[0], dtype="float64")  # degenerate -> uniform mean
    pooled = (unit * weights[:, None]).sum(axis=0)
    norm = float(np.linalg.norm(pooled))
    if norm == 0.0:
        pooled = unit.mean(axis=0)
        norm = float(np.linalg.norm(pooled)) or 1.0
    return (pooled / norm).astype("float32").tolist()

"""Probabilistic score calibration (Phase 1.1).

The live decision path bands on raw cosine vs hand-picked global thresholds, so it
cannot state any decision's actual false-match rate. This module turns the user's
own accept/reject labels into:

  * a regularized logistic (Platt) map cosine -> P(same identity), so a band can be
    shown as a meaningful probability; and
  * FMR-targeted thresholds (the score that yields at most a target false-match rate
    on the labeled impostors), so an operating point is *validated*, not guessed.

Pure NumPy, offline, no new model weights. L2 regularization (a prior) keeps the fit
finite on small, separable single-user label sets.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

import numpy as np


def _sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -60.0, 60.0)))


@dataclass(slots=True)
class PlattCalibrator:
    """Logistic map score -> P(same identity): sigmoid(a * score + b)."""

    a: float
    b: float

    def probability(self, score: float) -> float:
        return float(_sigmoid(np.asarray(self.a * float(score) + self.b)))

    def to_list(self) -> list[float]:
        return [float(self.a), float(self.b)]

    @classmethod
    def from_list(cls, values: Sequence[float]) -> "PlattCalibrator":
        if values is None or len(values) != 2:
            raise ValueError("PlattCalibrator.from_list expects exactly [a, b].")
        return cls(a=float(values[0]), b=float(values[1]))


def fit_platt(
    scores: Sequence[float],
    labels: Sequence[float],
    *,
    l2: float = 1.0,
    lr: float = 0.5,
    iters: int = 4000,
) -> PlattCalibrator:
    """Fit a regularized logistic map from score -> P(match).

    Scores are standardized internally for conditioning, then the fitted weights are
    mapped back to the original score space. The L2 penalty on the (standardized)
    slope is the prior that prevents blow-up on perfectly separable label sets.
    """
    x = np.asarray(list(scores), dtype="float64")
    y = np.asarray(list(labels), dtype="float64")
    n = max(1, x.shape[0])
    mu = float(x.mean()) if x.size else 0.0
    sd = float(x.std()) or 1.0
    z = (x - mu) / sd
    w = 0.0
    b = 0.0
    for _ in range(max(1, int(iters))):
        p = _sigmoid(w * z + b)
        grad_w = float(np.dot(p - y, z)) / n + l2 * w / n
        grad_b = float(np.sum(p - y)) / n
        w -= lr * grad_w
        b -= lr * grad_b
    # w*z + b = (w/sd) * x + (b - w*mu/sd)
    a_orig = w / sd
    b_orig = b - w * mu / sd
    return PlattCalibrator(a=float(a_orig), b=float(b_orig))


def empirical_fmr(negative_scores: Sequence[float], threshold: float) -> float:
    """Fraction of labeled impostors scoring at or above `threshold`."""
    neg = np.asarray(list(negative_scores), dtype="float64")
    if neg.size == 0:
        return 0.0
    return float(np.mean(neg >= float(threshold)))


def threshold_for_fmr(
    scores: Sequence[float],
    labels: Sequence[float],
    target_fmr: float,
) -> float:
    """Smallest score threshold whose impostor false-match rate is <= target_fmr.

    FMR is non-increasing in the threshold, so the smallest qualifying candidate is
    the most permissive (highest-recall) operating point at the target FMR.
    """
    x = np.asarray(list(scores), dtype="float64")
    y = np.asarray(list(labels), dtype="float64")
    negatives = x[y < 0.5]
    if x.size == 0:
        return 0.0
    # Sentinel above the max guarantees an achievable FMR=0 candidate.
    candidates = sorted(set(x.tolist())) + [float(x.max()) + 1e-6]
    target = max(0.0, float(target_fmr))
    for candidate in candidates:
        if empirical_fmr(negatives, candidate) <= target:
            return float(candidate)
    return float(candidates[-1])


def fit_score_calibrator(
    rows: Sequence[dict[str, Any]],
    *,
    min_count: int = 20,
    min_per_class: int = 5,
    score_key: str = "score",
) -> PlattCalibrator | None:
    """Fit a Platt calibrator from labeled rows, or None when data is insufficient.

    Each row needs a numeric `score_key` and a boolean `isMatch`. Returns None unless
    there are >= min_count usable rows with >= min_per_class of each class -- the guard
    that prevents an over-confident map from a handful of single-user labels.
    """
    scores: list[float] = []
    labels: list[float] = []
    for row in rows:
        value = row.get(score_key)
        is_match = row.get("isMatch")
        if value is None or is_match is None:
            continue
        try:
            scores.append(float(value))
        except (TypeError, ValueError):
            continue
        labels.append(1.0 if bool(is_match) else 0.0)
    positives = int(sum(labels))
    negatives = len(labels) - positives
    if len(labels) < int(min_count) or positives < int(min_per_class) or negatives < int(min_per_class):
        return None
    return fit_platt(scores, labels)

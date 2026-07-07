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


def fit_per_identity_calibrators(
    rows: Sequence[dict[str, Any]],
    *,
    min_per_identity: int = 12,
    min_per_class: int = 3,
    score_key: str = "matchScore",
    identity_key: str = "expectedPerson",
) -> dict[str, PlattCalibrator]:
    """Per-identity Platt calibrators (Phase-4 §5.6 personalization). A single-user app
    can specialize the operating point per enrolled person from that person's own
    accept/reject labels. Identities with too few labels are SKIPPED (the caller falls
    back to the global calibrator) -- last-layer/per-identity only, never backbone
    relearning, because tiny self-correlated label sets overfit otherwise."""
    by_identity: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = str(row.get(identity_key) or "")
        if key:
            by_identity.setdefault(key, []).append(row)
    calibrators: dict[str, PlattCalibrator] = {}
    for key, identity_rows in by_identity.items():
        calibrator = fit_score_calibrator(
            identity_rows, min_count=min_per_identity, min_per_class=min_per_class, score_key=score_key
        )
        if calibrator is not None:
            calibrators[key] = calibrator
    return calibrators


def fuse_scores(scores: Sequence[float], weights: Sequence[float] | None = None) -> float:
    """Weighted average of per-model match scores (Phase-4 §5.6 2-model fusion seam).

    Each model's score must already be a comparable cosine (per-model L2-normalized
    embeddings); fusion is at the SCORE level, never embedding concatenation (cross-model
    spaces are not natively compatible). Uniform weights by default; 0.0 for empty."""
    values = [float(s) for s in scores]
    if not values:
        return 0.0
    if weights is None:
        return float(sum(values) / len(values))
    w = [float(x) for x in weights][: len(values)]
    total = sum(w)
    if total <= 0:
        return float(sum(values) / len(values))
    return float(sum(v * wi for v, wi in zip(values, w)) / total)


def as_norm_score(raw_cosine: float, cohort_scores: Sequence[float], *, top_k: int = 10) -> float:
    """Adaptive symmetric-style normalization (Phase-4 §5.5): how far a match score stands
    OUT from the probe's own impostor cohort, in standard deviations.

    z = (raw - mean(top-K cohort)) / std(top-K cohort). A probe that resembles everything
    (high cohort baseline) is discounted; one whose match stands out is rewarded -- which
    is exactly the IDA/AS-norm fix that makes one threshold mean a stabler FMR across
    probes. Returns 0.0 (neutral) when the cohort is empty. Pure NumPy, no new weights.
    """
    cohort = np.asarray(list(cohort_scores), dtype="float64")
    if cohort.size == 0:
        return 0.0
    k = max(1, min(int(top_k), cohort.size))
    top = np.sort(cohort)[::-1][:k]
    mu = float(top.mean())
    # Floor sigma to a sane cosine spread so the result is always in consistent
    # std-dev units (a degenerate zero-variance cohort must not blow up or change scale).
    sigma = max(float(top.std()), 0.05)
    return (float(raw_cosine) - mu) / sigma


@dataclass(slots=True)
class CohortNormalizer:
    """AS-norm using a fixed cohort of (impostor) embeddings. The cohort can be the user's
    other-identity references, or a small bundled/synthetic set -- IDA shows the specific
    identities don't matter, only that they form a representative impostor distribution."""

    cohort: list[list[float]]

    def normalize(self, probe_vector: Sequence[float], raw_cosine: float, *, top_k: int = 10) -> float:
        if not self.cohort:
            return 0.0
        probe = np.asarray(list(probe_vector), dtype="float64")
        pn = float(np.linalg.norm(probe))
        if pn == 0.0:
            return 0.0
        probe = probe / pn
        cohort = np.asarray(self.cohort, dtype="float64")
        norms = np.linalg.norm(cohort, axis=1, keepdims=True)
        norms[norms == 0.0] = 1.0
        cohort = cohort / norms
        cohort_scores = (cohort @ probe).tolist()
        return as_norm_score(float(raw_cosine), cohort_scores, top_k=top_k)


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

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

from dataclasses import dataclass, field
import math
from typing import Any, Sequence

import numpy as np

from crossage_fr.vector_math import l2_normalize


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

    cohort: Sequence[Sequence[float]] | np.ndarray
    _vectors: np.ndarray = field(init=False, repr=False)

    def __post_init__(self) -> None:
        vectors = np.asarray(self.cohort, dtype="float64")
        if vectors.size == 0:
            self._vectors = np.empty((0, 0), dtype="float64")
            return
        if vectors.ndim != 2 or not np.isfinite(vectors).all():
            raise ValueError("Cohort vectors must be a finite 2-D array")
        norms = np.linalg.norm(vectors, axis=1)
        if np.any(norms <= 1e-12):
            raise ValueError("Cohort vectors must have non-zero norm")
        self._vectors = l2_normalize(vectors, axis=1, dtype=np.float64)

    def scores(self, vector: Sequence[float]) -> np.ndarray:
        if self._vectors.size == 0:
            return np.empty((0,), dtype="float64")
        probe = np.asarray(list(vector), dtype="float64")
        if probe.ndim != 1 or probe.size != self._vectors.shape[1] or not np.isfinite(probe).all():
            return np.empty((0,), dtype="float64")
        norm = float(np.linalg.norm(probe))
        if norm <= 1e-12:
            return np.empty((0,), dtype="float64")
        return self._vectors @ (probe / norm)

    def normalize(self, probe_vector: Sequence[float], raw_cosine: float, *, top_k: int = 10) -> float:
        return as_norm_score(float(raw_cosine), self.scores(probe_vector), top_k=top_k)

    def normalize_pair(
        self,
        probe_vector: Sequence[float],
        reference_vector: Sequence[float],
        raw_cosine: float,
        *,
        top_k: int = 20,
    ) -> float:
        """True symmetric AS-Norm: average probe- and reference-side z scores."""
        probe_scores = self.scores(probe_vector)
        reference_scores = self.scores(reference_vector)
        if probe_scores.size == 0 or reference_scores.size == 0:
            return 0.0
        probe_z = as_norm_score(float(raw_cosine), probe_scores, top_k=top_k)
        reference_z = as_norm_score(float(raw_cosine), reference_scores, top_k=top_k)
        value = 0.5 * (probe_z + reference_z)
        return float(value) if math.isfinite(value) else 0.0


def normalized_pair_center(
    left: Sequence[float],
    right: Sequence[float],
    *,
    dtype: np.dtype[Any] | type[np.floating[Any]] = np.float32,
) -> np.ndarray | None:
    """Symmetric pair-location feature from Adaptive Calibration (Brown/Russell)."""
    first = np.asarray(list(left), dtype="float64")
    second = np.asarray(list(right), dtype="float64")
    if first.ndim != 1 or first.shape != second.shape or first.size == 0:
        return None
    if not np.isfinite(first).all() or not np.isfinite(second).all():
        return None
    first_norm = float(np.linalg.norm(first))
    second_norm = float(np.linalg.norm(second))
    if first_norm <= 1e-12 or second_norm <= 1e-12:
        return None
    center = (first / first_norm) + (second / second_norm)
    center_norm = float(np.linalg.norm(center))
    if center_norm <= 1e-12:
        return None
    return (center / center_norm).astype(dtype, copy=False)


ADAPTIVE_CALIBRATOR_VERSION = "adaptive-linear-v1"


@dataclass(frozen=True, slots=True)
class AdaptiveLinearCalibrator:
    """AC-Linear: sigmoid(w^T [normalized pair center, cosine] + b)."""

    weights: tuple[float, ...]
    bias: float
    model_name: str = ""
    input_count: int = 0
    positive_count: int = 0
    negative_count: int = 0
    version: str = ADAPTIVE_CALIBRATOR_VERSION

    @property
    def dimension(self) -> int:
        return max(0, len(self.weights) - 1)

    def probability(self, pair_center: Sequence[float], raw_cosine: float) -> float:
        center = np.asarray(list(pair_center), dtype="float64")
        if center.ndim != 1 or center.size != self.dimension or not np.isfinite(center).all():
            raise ValueError("Adaptive calibrator pair center has the wrong shape")
        norm = float(np.linalg.norm(center))
        if norm <= 1e-12:
            raise ValueError("Adaptive calibrator pair center has zero norm")
        score = float(raw_cosine)
        if not math.isfinite(score):
            raise ValueError("Adaptive calibrator score must be finite")
        features = np.concatenate([(center / norm), np.asarray([score], dtype="float64")])
        logit = float(np.dot(np.asarray(self.weights, dtype="float64"), features) + self.bias)
        return float(_sigmoid(np.asarray(logit)))

    def to_payload(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "weights": [float(value) for value in self.weights],
            "bias": float(self.bias),
            "dimension": self.dimension,
            "modelName": self.model_name,
            "inputCount": int(self.input_count),
            "positiveCount": int(self.positive_count),
            "negativeCount": int(self.negative_count),
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "AdaptiveLinearCalibrator":
        if not isinstance(payload, dict) or payload.get("version") != ADAPTIVE_CALIBRATOR_VERSION:
            raise ValueError("Unsupported adaptive calibrator payload")
        weights_raw = payload.get("weights")
        if not isinstance(weights_raw, list) or not 2 <= len(weights_raw) <= 2049:
            raise ValueError("Adaptive calibrator weights are invalid")
        weights = tuple(float(value) for value in weights_raw)
        bias = float(payload.get("bias"))
        if not all(math.isfinite(value) for value in (*weights, bias)):
            raise ValueError("Adaptive calibrator contains non-finite parameters")
        dimension = int(payload.get("dimension", len(weights) - 1) or 0)
        if dimension != len(weights) - 1:
            raise ValueError("Adaptive calibrator dimension mismatch")
        if weights[-1] <= 0.0:
            raise ValueError("Adaptive calibrator must remain monotonic in cosine similarity")
        return cls(
            weights=weights,
            bias=bias,
            model_name=str(payload.get("modelName", "") or "")[:200],
            input_count=max(0, int(payload.get("inputCount", 0) or 0)),
            positive_count=max(0, int(payload.get("positiveCount", 0) or 0)),
            negative_count=max(0, int(payload.get("negativeCount", 0) or 0)),
        )


def _adaptive_training_arrays(
    rows: Sequence[dict[str, Any]],
    *,
    score_key: str,
    context_key: str,
) -> tuple[np.ndarray, np.ndarray, int]:
    features: list[np.ndarray] = []
    labels: list[float] = []
    dimension = 0
    for row in rows:
        center_raw = row.get(context_key)
        score_raw = row.get(score_key)
        label_raw = row.get("isMatch")
        if not isinstance(center_raw, (list, tuple, np.ndarray)) or score_raw is None or label_raw is None:
            continue
        center = np.asarray(center_raw, dtype="float64")
        try:
            score = float(score_raw)
        except (TypeError, ValueError):
            continue
        if center.ndim != 1 or center.size == 0 or not np.isfinite(center).all() or not math.isfinite(score):
            continue
        norm = float(np.linalg.norm(center))
        if norm <= 1e-12:
            continue
        if dimension and center.size != dimension:
            continue
        dimension = int(center.size)
        features.append(np.concatenate([(center / norm), np.asarray([score], dtype="float64")]))
        labels.append(1.0 if bool(label_raw) else 0.0)
    if not features:
        return np.empty((0, 0), dtype="float64"), np.empty((0,), dtype="float64"), 0
    return np.stack(features), np.asarray(labels, dtype="float64"), dimension


def fit_adaptive_linear(
    rows: Sequence[dict[str, Any]],
    *,
    min_count: int = 80,
    min_per_class: int = 20,
    score_key: str = "rawCosine",
    context_key: str = "pairCenter",
    model_name: str = "",
    c: float = 0.1,
) -> AdaptiveLinearCalibrator | None:
    """Fit paper-faithful L2 AC-Linear, or return None when context is sparse."""
    features, labels, _dimension = _adaptive_training_arrays(
        rows,
        score_key=score_key,
        context_key=context_key,
    )
    positives = int(labels.sum())
    negatives = int(labels.size - positives)
    if labels.size < int(min_count) or positives < int(min_per_class) or negatives < int(min_per_class):
        return None
    from sklearn.linear_model import LogisticRegression

    model = LogisticRegression(C=max(1e-6, float(c)), solver="lbfgs", max_iter=2000, random_state=0)
    model.fit(features, labels.astype("int32"))
    weights = tuple(float(value) for value in model.coef_[0])
    if not weights or weights[-1] <= 0.0:
        return None
    calibrator = AdaptiveLinearCalibrator(
        weights=weights,
        bias=float(model.intercept_[0]),
        model_name=str(model_name or "")[:200],
        input_count=int(labels.size),
        positive_count=positives,
        negative_count=negatives,
    )
    return AdaptiveLinearCalibrator.from_payload(calibrator.to_payload())


def probability_calibration_metrics(
    probabilities: Sequence[float],
    labels: Sequence[float],
    *,
    bins: int = 10,
) -> dict[str, float | int]:
    values = np.asarray(list(probabilities), dtype="float64")
    truth = np.asarray(list(labels), dtype="float64")
    if values.size == 0 or values.shape != truth.shape:
        return {"count": 0, "brier": 0.0, "ece": 0.0, "logLoss": 0.0}
    values = np.clip(values, 1e-9, 1.0 - 1e-9)
    brier = float(np.mean((values - truth) ** 2))
    log_loss = float(-np.mean(truth * np.log(values) + (1.0 - truth) * np.log(1.0 - values)))
    ece = 0.0
    edges = np.linspace(0.0, 1.0, max(2, int(bins)) + 1)
    for index in range(len(edges) - 1):
        include = (values >= edges[index]) & (values < edges[index + 1])
        if index == len(edges) - 2:
            include |= values == 1.0
        count = int(include.sum())
        if count:
            ece += (count / values.size) * abs(float(values[include].mean()) - float(truth[include].mean()))
    return {
        "count": int(values.size),
        "brier": round(brier, 8),
        "ece": round(ece, 8),
        "logLoss": round(log_loss, 8),
    }


def validate_adaptive_calibration(
    rows: Sequence[dict[str, Any]],
    *,
    min_count: int = 80,
    min_per_class: int = 20,
    seed: int = 12345,
) -> dict[str, Any]:
    """Held-out Brier/ranking/slice gate; no labels or context means Platt fallback."""
    usable: list[dict[str, Any]] = []
    baseline_match_scores = 0
    for source in rows:
        if (
            source.get("rawCosine") is None
            or source.get("isMatch") is None
            or not isinstance(source.get("pairCenter"), (list, tuple, np.ndarray))
        ):
            continue
        try:
            raw_score = float(source["rawCosine"])
            match_score = float(source.get("matchScore", raw_score))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(raw_score):
            continue
        if math.isfinite(match_score) and source.get("matchScore") is not None:
            baseline_match_scores += 1
            baseline_score = match_score
        else:
            baseline_score = raw_score
        usable.append({**source, "_adaptiveBaselineScore": baseline_score})
    positives = sum(1 for row in usable if row.get("isMatch"))
    negatives = len(usable) - positives
    coverage = len(usable) / max(1, len(rows))
    if len(usable) < int(min_count) or positives < int(min_per_class) or negatives < int(min_per_class):
        return {
            "promote": False,
            "reason": "insufficient pair-location calibration context",
            "contextRows": len(usable),
            "totalRows": len(rows),
            "contextCoverage": round(coverage, 6),
        }
    from crossage_fr.match.validation import held_out_gate, split_by_identity

    train, test = split_by_identity(usable, frac=0.5, seed=seed, identity_key="expectedPerson")
    train_scores = [float(row["_adaptiveBaselineScore"]) for row in train]
    train_labels = [1.0 if row["isMatch"] else 0.0 for row in train]
    if not train_scores or len(set(train_labels)) < 2:
        return {"promote": False, "reason": "training fold lacks both classes", "contextRows": len(usable)}
    baseline = fit_platt(train_scores, train_labels)
    adaptive = fit_adaptive_linear(
        train,
        min_count=max(2, len(train)),
        min_per_class=1,
        model_name=str(train[0].get("modelName", "") or ""),
    )
    if adaptive is None:
        return {"promote": False, "reason": "adaptive fit failed or was non-monotonic", "contextRows": len(usable)}
    labels = [1.0 if row["isMatch"] else 0.0 for row in test]
    baseline_probabilities = [baseline.probability(float(row["_adaptiveBaselineScore"])) for row in test]
    adaptive_probabilities = [adaptive.probability(row["pairCenter"], float(row["rawCosine"])) for row in test]
    baseline_metrics = probability_calibration_metrics(baseline_probabilities, labels)
    adaptive_metrics = probability_calibration_metrics(adaptive_probabilities, labels)
    brier_gain = float(baseline_metrics["brier"]) - float(adaptive_metrics["brier"])

    def fit_transform(fold: list[dict[str, Any]]):
        fitted = fit_adaptive_linear(
            fold,
            min_count=max(2, len(fold)),
            min_per_class=1,
            model_name=str(fold[0].get("modelName", "") or "") if fold else "",
        )
        if fitted is None:
            raise ValueError("adaptive fit unavailable")
        return lambda row: fitted.probability(row["pairCenter"], float(row["rawCosine"]))

    ranking = held_out_gate(
        usable,
        fit_transform,
        score_key="_adaptiveBaselineScore",
        min_labels=min_count,
        min_per_class=min_per_class,
        seed=seed,
        margin=-0.000001,
    )
    slice_regressions: list[dict[str, Any]] = []
    slice_metrics: list[dict[str, Any]] = []

    def _slice_value(row: dict[str, Any], key: str) -> str:
        if key != "ageGapBand":
            return str(row.get(key, "") or "").strip()
        value = row.get("ageGapYears")
        try:
            years = float(value)
        except (TypeError, ValueError):
            return ""
        if not math.isfinite(years):
            return ""
        if years <= 2:
            return "0-2y"
        if years <= 5:
            return "2-5y"
        if years <= 10:
            return "5-10y"
        return "10y+"

    for key in ("poseBucket", "ageGapBand", "mediaKind"):
        groups: dict[str, list[int]] = {}
        for index, row in enumerate(test):
            value = _slice_value(row, key)
            if value:
                groups.setdefault(value, []).append(index)
        for value, indices in sorted(groups.items()):
            if len(indices) < 4:
                continue
            before = probability_calibration_metrics(
                [baseline_probabilities[index] for index in indices],
                [labels[index] for index in indices],
            )
            after = probability_calibration_metrics(
                [adaptive_probabilities[index] for index in indices],
                [labels[index] for index in indices],
            )
            delta = float(after["brier"]) - float(before["brier"])
            slice_metrics.append(
                {
                    "key": key,
                    "value": value,
                    "count": len(indices),
                    "baselineBrier": before["brier"],
                    "adaptiveBrier": after["brier"],
                    "brierDelta": round(delta, 8),
                }
            )
            if delta > 0.02:
                slice_regressions.append(
                    {"key": key, "value": value, "count": len(indices), "brierDelta": round(delta, 8)}
                )
    ranking_delta = float(ranking.get("delta", -1.0))
    promote = brier_gain > 0.001 and ranking_delta >= -0.000001 and not slice_regressions
    return {
        "promote": promote,
        "reason": "held-out Brier score improved without ranking/slice regression" if promote else "adaptive calibration did not clear the held-out safety gate",
        "contextRows": len(usable),
        "totalRows": len(rows),
        "contextCoverage": round(coverage, 6),
        "baselineScore": "live matchScore with rawCosine fallback",
        "baselineMatchScoreRows": baseline_match_scores,
        "trainN": len(train),
        "testN": len(test),
        "baseline": baseline_metrics,
        "adaptive": adaptive_metrics,
        "brierGain": round(brier_gain, 8),
        "ranking": ranking,
        "sliceRegressions": slice_regressions,
        "sliceMetrics": slice_metrics,
        "payload": adaptive.to_payload(),
    }


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

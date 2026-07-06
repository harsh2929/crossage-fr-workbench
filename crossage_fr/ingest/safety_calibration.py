"""Temperature-scaling calibration for the Safe Mode classifier (res.md Stage 1b).

Vendor accuracy claims don't transfer to a user's own library, so raw model
scores are treated as *uncalibrated*. Temperature scaling (Guo et al. 2017) fits
a single scalar T that divides the logits before softmax: T=1 is the raw model,
T>1 softens over-confident probabilities, T<1 sharpens. T is fit by minimizing
NLL on the user's own labeled local images and stored per-app; the safety model
applies it before thresholding.

Pure/testable — no ONNX or IO here. The calibrate command gathers (logits,label)
pairs by running the model on user-labeled images, then calls fit_temperature.
"""

from __future__ import annotations

import math
from typing import Sequence

CALIBRATION_T_MIN = 0.5
CALIBRATION_T_MAX = 5.0


def apply_temperature(logits: Sequence[float], temperature: float) -> list[float]:
    """Divide logits by T. Non-finite/non-positive T is treated as identity (T=1)."""
    try:
        t = float(temperature)
    except (TypeError, ValueError):
        return [float(x) for x in logits]
    if not math.isfinite(t) or t <= 0.0:
        return [float(x) for x in logits]
    return [float(x) / t for x in logits]


def _softmax(logits: Sequence[float]) -> list[float]:
    values = [float(x) for x in logits]
    if not values:
        return []
    peak = max(values)
    exps = [math.exp(v - peak) for v in values]
    total = sum(exps)
    if total <= 0.0:
        n = len(exps)
        return [1.0 / n] * n
    return [e / total for e in exps]


def temperature_nll(pairs: Sequence[Sequence[float]], labels: Sequence[int], temperature: float) -> float:
    """Mean negative log-likelihood of the true class under softmax(logits/T)."""
    total = 0.0
    count = 0
    for logits, label in zip(pairs, labels):
        probs = _softmax(apply_temperature(logits, temperature))
        idx = int(label)
        if idx < 0 or idx >= len(probs):
            continue
        total += -math.log(max(probs[idx], 1e-12))
        count += 1
    return total / count if count else 0.0


def fit_temperature(
    pairs: Sequence[Sequence[float]],
    labels: Sequence[int],
    t_min: float = CALIBRATION_T_MIN,
    t_max: float = CALIBRATION_T_MAX,
) -> float:
    """Fit T minimizing NLL over [t_min, t_max] by coarse-to-fine 1-D search.

    Returns 1.0 (no scaling) when there isn't enough signal to calibrate: no data,
    mismatched lengths, or fewer than two distinct labels.
    """
    if not pairs or not labels or len(pairs) != len(labels):
        return 1.0
    if len({int(v) for v in labels}) < 2:
        return 1.0

    best_t = 1.0
    best_nll = temperature_nll(pairs, labels, 1.0)
    lo, hi = float(t_min), float(t_max)
    steps = 24
    for _ in range(4):  # progressively narrow the bracket around the best T
        for i in range(steps + 1):
            t = lo + (hi - lo) * i / steps
            nll = temperature_nll(pairs, labels, t)
            if nll < best_nll - 1e-12:
                best_nll = nll
                best_t = t
        span = (hi - lo) / steps
        lo = max(float(t_min), best_t - span)
        hi = min(float(t_max), best_t + span)
    return float(min(max(best_t, t_min), t_max))

"""Verification + open-set evaluation harness (Phase 2.3).

Turns labeled (score, isMatch) pairs into the metrics that actually characterize a
face matcher -- TAR@FAR, a DET/EER summary, accuracy@EER, and (for the app's real
1:N job) open-set FNIR@FPIR -- with identity-level bootstrap confidence intervals and
an HONEST false-match-rate floor (you cannot resolve a FAR below 1/#impostors). This
is the change that makes any "how good is it" claim falsifiable instead of a single
cosine threshold. Pure NumPy; no new model weights.
"""

from __future__ import annotations

from typing import Any, Sequence

import numpy as np

from crossage_fr.benchmark_quality import BENCHMARK_DISCLAIMER
from crossage_fr.match.calibration import empirical_fmr, threshold_for_fmr


def _split(rows: Sequence[dict[str, Any]], score_key: str) -> tuple[list[float], list[float]]:
    genuine: list[float] = []
    impostor: list[float] = []
    for row in rows:
        value = row.get(score_key)
        if value is None:
            continue
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        (genuine if bool(row.get("isMatch")) else impostor).append(score)
    return genuine, impostor


def tar_at_far(
    genuine: Sequence[float],
    impostor: Sequence[float],
    far_targets: Sequence[float],
) -> dict[float, float]:
    """True-accept rate at each target false-accept rate."""
    g = np.asarray(list(genuine), dtype="float64")
    scores = list(genuine) + list(impostor)
    labels = [1.0] * len(genuine) + [0.0] * len(impostor)
    out: dict[float, float] = {}
    for target in far_targets:
        threshold = threshold_for_fmr(scores, labels, float(target))
        out[float(target)] = float(np.mean(g >= threshold)) if g.size else 0.0
    return out


def accuracy_at_threshold(genuine: Sequence[float], impostor: Sequence[float], threshold: float) -> float:
    g = np.asarray(list(genuine), dtype="float64")
    i = np.asarray(list(impostor), dtype="float64")
    total = g.size + i.size
    if total == 0:
        return 0.0
    tp = float(np.sum(g >= threshold))
    tn = float(np.sum(i < threshold))
    return (tp + tn) / total


def eer(genuine: Sequence[float], impostor: Sequence[float]) -> tuple[float, float]:
    """Equal error rate and its threshold (FMR == FNMR crossover)."""
    g = np.asarray(list(genuine), dtype="float64")
    i = np.asarray(list(impostor), dtype="float64")
    if g.size == 0 or i.size == 0:
        return (0.0, 0.5)
    candidates = sorted(set(g.tolist()) | set(i.tolist()))
    best = (1.0, candidates[0])
    for threshold in candidates:
        far = float(np.mean(i >= threshold))
        frr = float(np.mean(g < threshold))
        gap = abs(far - frr)
        if gap < best[0]:
            best = (gap, threshold)
    threshold = best[1]
    far = float(np.mean(i >= threshold))
    frr = float(np.mean(g < threshold))
    return ((far + frr) / 2.0, float(threshold))


def _bootstrap_metric(
    rows: Sequence[dict[str, Any]],
    score_key: str,
    metric: str,
    *,
    samples: int,
    seed: int,
) -> list[float]:
    # Resample by IDENTITY when present (correlated pairs share an identity), else by
    # row -- identity-level resampling is the statistically honest unit.
    groups: dict[Any, list[dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        key = row.get("identity", index)
        groups.setdefault(key, []).append(row)
    keys = list(groups.keys())
    if len(keys) < 2:
        return []
    rng = np.random.default_rng(seed)
    values: list[float] = []
    for _ in range(max(1, samples)):
        picked = rng.integers(0, len(keys), size=len(keys))
        resampled: list[dict[str, Any]] = []
        for idx in picked:
            resampled.extend(groups[keys[int(idx)]])
        g, i = _split(resampled, score_key)
        if not g or not i:
            continue
        if metric == "eer":
            values.append(eer(g, i)[0])
        else:  # accuracy@eer
            _, threshold = eer(g, i)
            values.append(accuracy_at_threshold(g, i, threshold))
    return values


def _ci(values: list[float]) -> list[float]:
    if not values:
        return [0.0, 1.0]
    return [float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))]


def det_report(
    rows: Sequence[dict[str, Any]],
    *,
    score_key: str = "rawCosine",
    far_targets: Sequence[float] = (1e-1, 1e-2, 1e-3),
    bootstrap: int = 200,
    seed: int = 12345,
) -> dict[str, Any]:
    """Full DET/TAR@FAR/EER report with bootstrap CIs and an honest FAR floor."""
    genuine, impostor = _split(rows, score_key)
    far_floor = 1.0 / len(impostor) if impostor else 1.0
    tar = tar_at_far(genuine, impostor, far_targets) if genuine and impostor else {}
    tar_block: dict[str, Any] = {}
    for target in far_targets:
        resolvable = float(target) >= far_floor
        tar_block[str(target)] = {
            "tar": round(tar.get(float(target), 0.0), 6),
            "resolvable": bool(resolvable),
            # Below the floor the estimate is dominated by a single impostor; say so.
            "note": "" if resolvable else f"FAR target below resolvable floor {far_floor:.4g} (need more impostors)",
        }
    eer_value, eer_threshold = eer(genuine, impostor) if (genuine and impostor) else (0.0, 0.5)
    acc = accuracy_at_threshold(genuine, impostor, eer_threshold)
    return {
        "genuine": len(genuine),
        "impostor": len(impostor),
        "farFloor": round(far_floor, 6),
        "tarAtFar": tar_block,
        "eer": {
            "value": round(eer_value, 6),
            "threshold": round(eer_threshold, 6),
            "ci": [round(v, 6) for v in _ci(_bootstrap_metric(rows, score_key, "eer", samples=bootstrap, seed=seed))],
        },
        "accuracyAtEer": {
            "value": round(acc, 6),
            "ci": [round(v, 6) for v in _ci(_bootstrap_metric(rows, score_key, "accuracy", samples=bootstrap, seed=seed + 1))],
        },
        "disclaimer": BENCHMARK_DISCLAIMER,
    }


def det_report_by_cohort(
    rows: Sequence[dict[str, Any]],
    cohort_key: str,
    *,
    score_key: str = "rawCosine",
    min_per_cohort: int = 10,
    bootstrap: int = 100,
) -> dict[str, Any]:
    """Per-cohort DET reports plus a first-class FAIRNESS GAP (Phase 3.3).

    Pooled accuracy hides 10-100x error disparities across subgroups -- exactly the
    youngest/relaxed-band population this tool is built for. This slices the labels by
    a cohort key (the app supplies pose / age-gap bands; it does NOT infer protected
    demographic attributes by design) and reports the accuracy spread across cohorts.
    """
    cohorts: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        key = str(row.get(cohort_key) or "unknown")
        cohorts.setdefault(key, []).append(row)
    by_cohort: dict[str, Any] = {}
    accuracies: dict[str, float] = {}
    for key, cohort_rows in cohorts.items():
        if len(cohort_rows) < int(min_per_cohort):
            continue
        report = det_report(cohort_rows, score_key=score_key, bootstrap=bootstrap)
        if report["genuine"] == 0 or report["impostor"] == 0:
            continue
        by_cohort[key] = report
        accuracies[key] = float(report["accuracyAtEer"]["value"])
    fairness: dict[str, Any] = {"accuracyGap": 0.0, "worstCohort": None, "bestCohort": None}
    if len(accuracies) >= 2:
        worst = min(accuracies, key=accuracies.get)
        best = max(accuracies, key=accuracies.get)
        fairness = {
            "accuracyGap": round(accuracies[best] - accuracies[worst], 6),
            "worstCohort": worst,
            "bestCohort": best,
            "perCohortAccuracy": {key: round(value, 6) for key, value in accuracies.items()},
        }
    return {
        "byCohort": by_cohort,
        "fairnessGap": fairness,
        "note": (
            "Cohorts are non-protected operational slices (pose / age-gap band); this tool "
            "does not infer protected demographic attributes (skin tone, sex). A large "
            "accuracyGap means the pooled number hides materially worse subgroup performance."
        ),
    }


def fnir_at_fpir(
    probes: Sequence[dict[str, Any]],
    fpir_targets: Sequence[float],
) -> dict[str, Any]:
    """Open-set 1:N metric: false-negative identification rate at a fixed false-positive
    identification rate. Each probe has top1Score, isMate, isCorrect.

    FPIR = fraction of NON-mate probes that produce a match above threshold.
    FNIR = fraction of MATE probes that fail (top1 below threshold OR wrong identity).
    """
    mate = [p for p in probes if bool(p.get("isMate"))]
    nonmate = [p for p in probes if not bool(p.get("isMate"))]
    nonmate_scores = [float(p.get("top1Score", 0.0)) for p in nonmate]
    all_scores = [float(p.get("top1Score", 0.0)) for p in probes]
    # Non-mate probes are the cohort whose acceptance rate (FPIR) we bound, so they
    # are the "negatives" (label < 0.5) that threshold_for_fmr operates on.
    labels = [1.0 if bool(p.get("isMate")) else 0.0 for p in probes]
    out: dict[str, Any] = {}
    for target in fpir_targets:
        threshold = threshold_for_fmr(all_scores, labels, float(target)) if all_scores else 1.0
        fpir = empirical_fmr(nonmate_scores, threshold)
        if mate:
            missed = sum(
                1 for p in mate if float(p.get("top1Score", 0.0)) < threshold or not bool(p.get("isCorrect"))
            )
            fnir = missed / len(mate)
        else:
            fnir = 0.0
        out[str(target)] = {
            "threshold": round(float(threshold), 6),
            "fpir": round(float(fpir), 6),
            "fnir": round(float(fnir), 6),
        }
    return out

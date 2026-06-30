"""Held-out per-user validation gate (Phase-4 §6).

Converts a benchmarked improvement into a REAL one for a specific user's library: an
adaptive change (cohort normalization, personalization, a recognizer swap) is adopted
ONLY if it beats the baseline on a held-out split of THAT user's own accept/reject
labels. This is the guardrail that stops a paper "+2pp" from silently vanishing -- or
inverting -- on a small, self-correlated single-user label set.

The split is BY IDENTITY (not by row) so correlated pairs of the same person cannot
leak across the train/test boundary and inflate the result. Pure NumPy; offline.
"""

from __future__ import annotations

from typing import Any, Callable, Sequence

import numpy as np

from crossage_fr.benchmarks.det_eval import accuracy_at_threshold, eer

# A transform is fit on the train fold and maps a labeled row -> an adjusted score.
FitTransform = Callable[[list[dict[str, Any]]], Callable[[dict[str, Any]], float]]


def split_by_identity(
    rows: Sequence[dict[str, Any]],
    *,
    frac: float = 0.5,
    seed: int = 12345,
    identity_key: str = "expectedPerson",
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Split rows into (train, test) assigning whole IDENTITIES to one side only."""
    groups: dict[Any, list[dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        key = row.get(identity_key) or f"__row_{index}"
        groups.setdefault(key, []).append(row)
    keys = sorted(groups.keys(), key=str)
    rng = np.random.default_rng(seed)
    rng.shuffle(keys)
    cut = max(1, int(round(len(keys) * max(0.1, min(0.9, frac)))))
    train_keys = set(keys[:cut])
    train: list[dict[str, Any]] = []
    test: list[dict[str, Any]] = []
    for key in keys:
        (train if key in train_keys else test).extend(groups[key])
    return train, test


def _genuine_impostor(rows: Sequence[dict[str, Any]], transform: Callable[[dict[str, Any]], float]) -> tuple[list[float], list[float]]:
    genuine: list[float] = []
    impostor: list[float] = []
    for row in rows:
        try:
            value = float(transform(row))
        except (TypeError, ValueError):
            continue
        (genuine if bool(row.get("isMatch")) else impostor).append(value)
    return genuine, impostor


def _both_classes(genuine: list[float], impostor: list[float]) -> bool:
    return len(genuine) > 0 and len(impostor) > 0


def _confusion_at_threshold(
    rows: Sequence[dict[str, Any]],
    transform: Callable[[dict[str, Any]], float],
    threshold: float,
) -> dict[str, Any]:
    tp = fp = tn = fn = 0
    for row in rows:
        try:
            value = float(transform(row))
        except (TypeError, ValueError):
            continue
        expected = bool(row.get("isMatch"))
        predicted = value >= float(threshold)
        if expected and predicted:
            tp += 1
        elif expected and not predicted:
            fn += 1
        elif not expected and predicted:
            fp += 1
        else:
            tn += 1
    total = tp + fp + tn + fn
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    false_match_rate = fp / max(1, fp + tn)
    false_reject_rate = fn / max(1, tp + fn)
    accuracy = (tp + tn) / max(1, total)
    return {
        "threshold": round(float(threshold), 6),
        "labeled": total,
        "truePositives": tp,
        "falsePositives": fp,
        "trueNegatives": tn,
        "falseNegatives": fn,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "falseMatchRate": round(false_match_rate, 6),
        "falseRejectRate": round(false_reject_rate, 6),
        "accuracy": round(accuracy, 6),
    }


def _score_accuracy(
    rows: Sequence[dict[str, Any]],
    transform: Callable[[dict[str, Any]], float],
    threshold: float,
) -> float | None:
    metrics = _confusion_at_threshold(rows, transform, threshold)
    return float(metrics["accuracy"]) if metrics["labeled"] else None


def _segment_regressions(
    rows: Sequence[dict[str, Any]],
    baseline: Callable[[dict[str, Any]], float],
    candidate: Callable[[dict[str, Any]], float],
    baseline_threshold: float,
    candidate_threshold: float,
    *,
    key: str,
    min_rows: int = 2,
) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for index, row in enumerate(rows):
        value = row.get(key)
        if value in (None, "") and key == "expectedPerson":
            value = f"__row_{index}"
        if value in (None, ""):
            continue
        groups.setdefault(str(value), []).append(row)
    regressions: list[dict[str, Any]] = []
    for value, group in sorted(groups.items(), key=lambda item: item[0]):
        if len(group) < int(min_rows):
            continue
        baseline_acc = _score_accuracy(group, baseline, baseline_threshold)
        candidate_acc = _score_accuracy(group, candidate, candidate_threshold)
        if baseline_acc is None or candidate_acc is None:
            continue
        delta = candidate_acc - baseline_acc
        if delta < 0:
            regressions.append(
                {
                    "key": key,
                    "value": value,
                    "labeled": len(group),
                    "baselineAccuracy": round(baseline_acc, 6),
                    "candidateAccuracy": round(candidate_acc, 6),
                    "delta": round(delta, 6),
                }
            )
    return regressions[:20]


def held_out_gate(
    rows: Sequence[dict[str, Any]],
    fit_transform: FitTransform,
    *,
    score_key: str = "rawCosine",
    min_labels: int = 20,
    min_per_class: int = 4,
    frac: float = 0.5,
    seed: int = 12345,
    margin: float = 0.0,
) -> dict[str, Any]:
    """Decide whether to ADOPT an adaptive change, validated on a held-out per-user split.

    Baseline = the raw `score_key`; candidate = `fit_transform(train)` applied to each row.
    For each, the EER threshold is chosen on TRAIN and accuracy measured on the disjoint
    TEST fold (a proper held-out estimate). Promotes iff the candidate beats the baseline
    on TEST by more than `margin`.
    """
    usable = [r for r in rows if r.get(score_key) is not None and r.get("isMatch") is not None]
    positives = sum(1 for r in usable if r.get("isMatch"))
    negatives = len(usable) - positives
    if len(usable) < int(min_labels) or positives < int(min_per_class) or negatives < int(min_per_class):
        return {"promote": False, "reason": f"insufficient labels (have {len(usable)}, need >={min_labels} with >={min_per_class}/class)"}

    train, test = split_by_identity(usable, frac=frac, seed=seed, identity_key="expectedPerson")
    baseline = lambda row: float(row[score_key])
    for fold_name, fold in (("train", train), ("test", test)):
        g, i = _genuine_impostor(fold, baseline)
        if not _both_classes(g, i):
            return {"promote": False, "reason": f"{fold_name} fold lacks both classes after identity split; need more diverse labels"}

    try:
        candidate = fit_transform(train)
    except Exception as exc:  # a fit failure must never silently adopt the change
        return {"promote": False, "reason": f"candidate fit failed: {type(exc).__name__}"}

    def _held_out_evaluation(transform: Callable[[dict[str, Any]], float]) -> dict[str, Any] | None:
        gt, it = _genuine_impostor(train, transform)
        ge, ie = _genuine_impostor(test, transform)
        if not (_both_classes(gt, it) and _both_classes(ge, ie)):
            return None
        _, threshold = eer(gt, it)  # operating point chosen on TRAIN
        accuracy = accuracy_at_threshold(ge, ie, threshold)  # measured on TEST
        metrics = _confusion_at_threshold(test, transform, threshold)
        metrics["accuracy"] = round(float(accuracy), 6)
        return metrics

    baseline_metrics = _held_out_evaluation(baseline)
    candidate_metrics = _held_out_evaluation(candidate)
    if baseline_metrics is None or candidate_metrics is None:
        return {"promote": False, "reason": "candidate transform produced an unscorable held-out fold"}

    baseline_acc = float(baseline_metrics["accuracy"])
    candidate_acc = float(candidate_metrics["accuracy"])
    delta = candidate_acc - baseline_acc
    baseline_threshold = float(baseline_metrics["threshold"])
    candidate_threshold = float(candidate_metrics["threshold"])
    identity_regressions = _segment_regressions(
        test,
        baseline,
        candidate,
        baseline_threshold,
        candidate_threshold,
        key="expectedPerson",
    )
    segment_regressions: list[dict[str, Any]] = []
    for segment_key in ("poseBucket", "mediaKind"):
        segment_regressions.extend(
            _segment_regressions(
                test,
                baseline,
                candidate,
                baseline_threshold,
                candidate_threshold,
                key=segment_key,
                min_rows=4,
            )
        )
    return {
        "promote": bool(delta > float(margin)),
        "baselineAccuracy": round(baseline_acc, 6),
        "candidateAccuracy": round(candidate_acc, 6),
        "delta": round(delta, 6),
        "baselineMetrics": baseline_metrics,
        "candidateMetrics": candidate_metrics,
        "identityRegressions": identity_regressions,
        "segmentRegressions": segment_regressions[:20],
        "trainN": len(train),
        "testN": len(test),
        "reason": "held-out test accuracy improved" if delta > float(margin) else "no held-out improvement over baseline",
    }

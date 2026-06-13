from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
import json
import math


DEFAULT_DATASET_GATES: dict[str, dict[str, float | int | bool]] = {
    "calfw": {"minEvaluated": 40, "minPrecision": 0.99, "minRecall": 0.99, "minAccuracy": 0.99, "maxWrongIdentity": 0},
    "cplfw": {"minEvaluated": 40, "minPrecision": 0.95, "minRecall": 0.90, "minAccuracy": 0.92, "minProfileRecall": 0.90, "maxWrongIdentity": 1},
    "agedb": {"minEvaluated": 40, "minPrecision": 0.65, "minRecall": 0.74, "minAccuracy": 0.68, "minCrossAgeRecall": 0.74, "maxWrongIdentity": 20},
    "fiw": {"minEvaluated": 40, "minPrecision": 0.85, "minRecall": 0.80, "minAccuracy": 0.80, "maxWrongIdentity": 8},
    "cfp": {"minEvaluated": 40, "minPrecision": 0.95, "minRecall": 0.80, "minAccuracy": 0.84, "minProfileRecall": 0.80, "maxWrongIdentity": 2},
    "ytf": {"optional": True, "minEvaluated": 20, "minPrecision": 0.85, "minRecall": 0.70, "minAccuracy": 0.75, "maxVideoDecodeFailureRate": 0.05},
}


def public_label_metrics(labels: list[dict[str, Any]], threshold: float | None = None) -> dict[str, Any]:
    true_positive = false_positive = true_negative = false_negative = wrong_identity = 0
    for row in labels:
        expected_match = bool(row.get("isMatch"))
        expected_person = str(row.get("expectedPerson") or "")
        actual_person = str(row.get("actualPerson") or "")
        score = _safe_float(row.get("matchScore"), 0.0)
        predicted = bool(actual_person) if threshold is None else bool(actual_person) and score >= float(threshold)
        correct_identity = predicted and actual_person == expected_person
        if expected_match and correct_identity:
            true_positive += 1
        elif expected_match and predicted:
            wrong_identity += 1
            false_positive += 1
            false_negative += 1
        elif expected_match:
            false_negative += 1
        elif predicted:
            false_positive += 1
        else:
            true_negative += 1
    evaluated = len(labels)
    predicted_positive = true_positive + false_positive
    actual_positive = true_positive + false_negative
    actual_negative = true_negative + false_positive
    precision = 1.0 if predicted_positive == 0 else true_positive / predicted_positive
    recall = true_positive / max(1, actual_positive)
    specificity = true_negative / max(1, actual_negative)
    accuracy = (true_positive + true_negative) / max(1, evaluated)
    return {
        "threshold": round(float(threshold), 6) if threshold is not None else None,
        "evaluated": evaluated,
        "positives": actual_positive,
        "negatives": actual_negative,
        "truePositives": true_positive,
        "falsePositives": false_positive,
        "trueNegatives": true_negative,
        "falseNegatives": false_negative,
        "wrongIdentity": wrong_identity,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "specificity": round(specificity, 6),
        "accuracy": round(accuracy, 6),
    }


def calibrate_public_labels(
    labels: list[dict[str, Any]],
    thresholds: Any | None = None,
    *,
    target_precision: float = 0.98,
    strong_precision: float = 0.995,
) -> dict[str, Any]:
    target_precision = _clamp(target_precision, 0.0, 1.0)
    strong_precision = _clamp(strong_precision, target_precision, 1.0)
    current = {
        "reviewMore": _threshold_value(thresholds, "relaxed_child", "reviewMore", 0.20),
        "likely": _threshold_value(thresholds, "likely", "likely", 0.28),
        "strong": _threshold_value(thresholds, "confident", "strong", 0.40),
    }
    review_more = _choose_threshold(labels, min_precision=max(0.75, target_precision - 0.12), prefer="recall")
    likely = _choose_threshold(labels, min_precision=target_precision, prefer="recall")
    strong = _choose_threshold(labels, min_precision=strong_precision, prefer="precision")
    group_rows: dict[str, dict[str, Any]] = {}
    for key, label, group_labels in _calibration_groups(labels):
        if not group_labels:
            continue
        group_likely = _choose_threshold(group_labels, min_precision=target_precision, prefer="recall")
        group_rows[key] = {
            "key": key,
            "label": label,
            "count": len(group_labels),
            "positives": sum(1 for row in group_labels if bool(row.get("isMatch"))),
            "negatives": sum(1 for row in group_labels if not bool(row.get("isMatch"))),
            "recommendedLikelyThreshold": group_likely["threshold"],
            "metrics": group_likely["metrics"],
        }
    recommendations: list[str] = []
    likely_metrics = likely["metrics"]
    hard_negative = group_rows.get("hard-negative:family-lookalike")
    profile = group_rows.get("pose:profile")
    cross_age = group_rows.get("age:cross-age")
    if int(likely_metrics.get("falsePositives", 0) or 0):
        recommendations.append("Raise the Likely threshold or keep these cases in manual review; calibrated Likely still has false positives.")
    if int(likely_metrics.get("wrongIdentity", 0) or 0):
        recommendations.append("Wrong-identity matches remain after calibration; require a larger score margin before auto-clustering.")
    if hard_negative and int(hard_negative["metrics"].get("falsePositives", 0) or 0):
        recommendations.append("Family/lookalike negatives still trigger matches; keep lookalike safeguards on and avoid bulk auto-accept.")
    if profile and float(profile["metrics"].get("recall", 0.0) or 0.0) < 0.85:
        recommendations.append("Profile recall is below target; keep side-face references and compare pose-aware model packs.")
    if cross_age and float(cross_age["metrics"].get("recall", 0.0) or 0.0) < 0.85:
        recommendations.append("Cross-age recall is below target; use multiple age references before lowering thresholds.")
    if not recommendations:
        recommendations.append("Calibrated thresholds separate this benchmark slice cleanly.")
    return {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "labelCount": len(labels),
        "positiveCount": sum(1 for row in labels if bool(row.get("isMatch"))),
        "negativeCount": sum(1 for row in labels if not bool(row.get("isMatch"))),
        "targetPrecision": round(target_precision, 4),
        "strongPrecision": round(strong_precision, 4),
        "currentThresholds": current,
        "recommendedThresholds": {
            "reviewMore": review_more["threshold"],
            "likely": likely["threshold"],
            "strong": strong["threshold"],
        },
        "overall": {
            "currentReviewMore": public_label_metrics(labels, current["reviewMore"]),
            "currentLikely": public_label_metrics(labels, current["likely"]),
            "currentStrong": public_label_metrics(labels, current["strong"]),
            "recommendedReviewMore": review_more["metrics"],
            "recommendedLikely": likely["metrics"],
            "recommendedStrong": strong["metrics"],
        },
        "groups": group_rows,
        "recommendations": recommendations[:8],
    }


def load_public_labels_from_report(report_path: str | Path) -> list[dict[str, Any]]:
    path = Path(report_path).expanduser()
    payload = json.loads(path.read_text(encoding="utf-8"))
    labels_path = payload.get("labelsJsonPath")
    if not labels_path:
        return []
    labels_payload = json.loads(Path(str(labels_path)).expanduser().read_text(encoding="utf-8"))
    labels = labels_payload.get("labels", [])
    return [row for row in labels if isinstance(row, dict)]


def evaluate_dataset_gates(rows: list[dict[str, Any]], gates: dict[str, dict[str, Any]] | None = None) -> dict[str, Any]:
    gates = gates or DEFAULT_DATASET_GATES
    gate_rows: list[dict[str, Any]] = []
    for dataset_id in sorted({str(row.get("datasetId") or "") for row in rows if row.get("datasetId")}):
        spec = gates.get(dataset_id, {})
        complete = [
            row for row in rows
            if row.get("datasetId") == dataset_id and row.get("status") == "complete" and isinstance(row.get("evaluated"), int)
        ]
        if not complete:
            skipped = any(row.get("datasetId") == dataset_id and row.get("status") == "skipped" for row in rows)
            optional = bool(spec.get("optional"))
            gate_rows.append(
                {
                    "datasetId": dataset_id,
                    "status": "skipped" if skipped or optional else "fail",
                    "ok": bool(optional or skipped),
                    "pack": "",
                    "checks": [{"name": "complete run", "ok": bool(optional or skipped), "actual": 0, "required": 1}],
                    "summary": "Dataset was skipped." if skipped or optional else "No complete benchmark row exists.",
                }
            )
            continue
        best = max(complete, key=_gate_candidate_score)
        checks = _dataset_gate_checks(best, spec)
        ok = all(check["ok"] for check in checks)
        gate_rows.append(
            {
                "datasetId": dataset_id,
                "status": "pass" if ok else "fail",
                "ok": ok,
                "pack": best.get("pack", ""),
                "checks": checks,
                "summary": "Gate passed." if ok else "One or more benchmark gates failed.",
            }
        )
    failed = [row for row in gate_rows if not row.get("ok")]
    return {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "ok": not failed,
        "failed": len(failed),
        "passed": sum(1 for row in gate_rows if row.get("ok") and row.get("status") == "pass"),
        "skipped": sum(1 for row in gate_rows if row.get("status") == "skipped"),
        "gates": gate_rows,
        "recommendations": _gate_recommendations(gate_rows),
    }


def model_pack_quality_matrix(rows: list[dict[str, Any]], *, current_pack: str = "") -> dict[str, Any]:
    by_pack: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row.get("status") != "complete" or not row.get("pack"):
            continue
        by_pack.setdefault(str(row["pack"]), []).append(row)
    packs: list[dict[str, Any]] = []
    for pack, pack_rows in sorted(by_pack.items()):
        evaluated = sum(int(row.get("evaluated", 0) or 0) for row in pack_rows)
        if evaluated <= 0:
            continue
        precision = _weighted_average(pack_rows, "precision")
        recall = _weighted_average(pack_rows, "recall")
        accuracy = _weighted_average(pack_rows, "accuracy")
        profile_recall = _weighted_average(pack_rows, "profileRecall")
        cross_age_recall = _weighted_average(pack_rows, "crossAgeRecall")
        wrong_identity = sum(int(row.get("wrongIdentity", 0) or 0) for row in pack_rows)
        false_positives = sum(int(row.get("falsePositives", 0) or 0) for row in pack_rows)
        hard_negative_fp = sum(int(row.get("hardNegativeFalsePositives", 0) or 0) for row in pack_rows)
        score = (
            precision * 0.31
            + recall * 0.25
            + accuracy * 0.16
            + (profile_recall if profile_recall >= 0 else recall) * 0.14
            + (cross_age_recall if cross_age_recall >= 0 else recall) * 0.10
        )
        score -= min(0.30, wrong_identity * 0.018 + false_positives * 0.008 + hard_negative_fp * 0.05)
        packs.append(
            {
                "pack": pack,
                "datasets": len(pack_rows),
                "evaluated": evaluated,
                "precision": round(precision, 6),
                "recall": round(recall, 6),
                "accuracy": round(accuracy, 6),
                "profileRecall": round(profile_recall, 6) if profile_recall >= 0 else None,
                "crossAgeRecall": round(cross_age_recall, 6) if cross_age_recall >= 0 else None,
                "wrongIdentity": wrong_identity,
                "falsePositives": false_positives,
                "hardNegativeFalsePositives": hard_negative_fp,
                "score": round(max(0.0, score), 6),
            }
        )
    packs.sort(key=lambda row: float(row["score"]), reverse=True)
    recommended = packs[0] if packs else None
    recommendations: list[str] = []
    if recommended:
        status = "keep" if current_pack and recommended["pack"] == current_pack else "switch" if current_pack else "recommend"
        recommendations.append(f"{recommended['pack']} has the strongest aggregate benchmark score across completed datasets.")
        if recommended.get("hardNegativeFalsePositives"):
            recommendations.append("The recommended pack still has hard-negative false positives; keep manual review for lookalikes.")
        if recommended.get("profileRecall") is not None and float(recommended.get("profileRecall") or 0.0) < 0.85:
            recommendations.append("Profile recall remains below target; side/profile references are still required.")
    else:
        status = "unavailable"
        recommendations.append("No completed model-pack rows were available for recommendation.")
    return {
        "generatedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "recommendedPack": recommended.get("pack") if recommended else None,
        "status": status,
        "currentPack": current_pack,
        "packs": packs,
        "recommendations": recommendations[:6],
    }


def labels_from_benchmark_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for row in rows:
        if row.get("status") != "complete" or not row.get("reportPath"):
            continue
        try:
            row_labels = load_public_labels_from_report(str(row.get("reportPath")))
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        dataset_id = str(row.get("datasetId") or "")
        pack = str(row.get("pack") or "")
        for label in row_labels:
            key = (dataset_id, pack, str(label.get("sourcePath") or label.get("sourceDatasetPath") or ""))
            if key in seen:
                continue
            seen.add(key)
            labels.append({**label, "datasetId": dataset_id, "pack": pack})
    return labels


def _choose_threshold(labels: list[dict[str, Any]], *, min_precision: float, prefer: str) -> dict[str, Any]:
    if not labels:
        return {"threshold": 1.0, "metrics": public_label_metrics([], 1.0), "metPrecisionTarget": False}
    candidates = _threshold_candidates(labels)
    scored = [(threshold, public_label_metrics(labels, threshold)) for threshold in candidates]
    eligible = [(threshold, metrics) for threshold, metrics in scored if float(metrics["precision"]) >= min_precision]
    if eligible:
        if prefer == "precision":
            threshold, metrics = max(
                eligible,
                key=lambda item: (
                    float(item[1]["precision"]),
                    float(item[1]["recall"]),
                    float(item[1]["specificity"]),
                    float(item[1]["accuracy"]),
                    item[0],
                ),
            )
        else:
            threshold, metrics = max(
                eligible,
                key=lambda item: (
                    float(item[1]["recall"]),
                    float(item[1]["precision"]),
                    float(item[1]["specificity"]),
                    float(item[1]["accuracy"]),
                    -item[0],
                ),
            )
        return {"threshold": round(float(threshold), 6), "metrics": metrics, "metPrecisionTarget": True}
    threshold, metrics = max(
        scored,
        key=lambda item: (
            _f_beta(float(item[1]["precision"]), float(item[1]["recall"]), beta=0.5),
            float(item[1]["specificity"]),
            float(item[1]["accuracy"]),
            -item[0],
        ),
    )
    return {"threshold": round(float(threshold), 6), "metrics": metrics, "metPrecisionTarget": False}


def _threshold_candidates(labels: list[dict[str, Any]]) -> list[float]:
    values = {0.0, 1.0}
    for index in range(0, 101):
        values.add(round(index / 100, 4))
    for row in labels:
        score = _safe_float(row.get("matchScore"), 0.0)
        score = _clamp(score, 0.0, 1.0)
        values.add(round(score, 6))
        values.add(round(_clamp(score + 1e-6, 0.0, 1.0), 6))
        values.add(round(_clamp(score - 1e-6, 0.0, 1.0), 6))
    return sorted(values)


def _calibration_groups(labels: list[dict[str, Any]]) -> list[tuple[str, str, list[dict[str, Any]]]]:
    groups: list[tuple[str, str, list[dict[str, Any]]]] = [("all", "All cases", labels)]
    seen = {"all"}
    for field, prefix, label_prefix in (
        ("validationBucket", "", ""),
        ("poseBucket", "pose:", "Pose"),
        ("mediaKind", "media:", "Media"),
        ("difficulty", "difficulty:", "Difficulty"),
    ):
        keys = sorted({str(row.get(field) or "").strip() for row in labels} - {""})
        for key in keys:
            group_key = key if field == "validationBucket" and ":" in key else f"{prefix}{key}"
            if group_key in seen:
                continue
            rows = [row for row in labels if str(row.get(field) or "").strip() == key]
            if not rows:
                continue
            seen.add(group_key)
            label = _human_label(group_key) if not label_prefix else f"{label_prefix}: {key.replace('-', ' ')}"
            groups.append((group_key, label, rows))
    return groups[:48]


def _dataset_gate_checks(row: dict[str, Any], spec: dict[str, Any]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []

    def add(name: str, actual: float, required: float, ok: bool) -> None:
        checks.append({"name": name, "actual": round(actual, 6), "required": required, "ok": bool(ok)})

    evaluated = float(row.get("evaluated", 0) or 0)
    add("evaluated", evaluated, float(spec.get("minEvaluated", 20)), evaluated >= float(spec.get("minEvaluated", 20)))
    for key, row_key, default in (
        ("minPrecision", "precision", 0.0),
        ("minRecall", "recall", 0.0),
        ("minAccuracy", "accuracy", 0.0),
        ("minProfileRecall", "profileRecall", None),
        ("minCrossAgeRecall", "crossAgeRecall", None),
    ):
        required = spec.get(key)
        if required is None:
            continue
        actual = _safe_float(row.get(row_key), -1.0 if default is None else float(default))
        add(row_key, actual, float(required), actual >= float(required))
    if "maxWrongIdentity" in spec:
        actual_wrong = float(row.get("wrongIdentity", 0) or 0)
        add("wrongIdentity", actual_wrong, float(spec["maxWrongIdentity"]), actual_wrong <= float(spec["maxWrongIdentity"]))
    if "maxVideoDecodeFailureRate" in spec:
        failures = float(row.get("videoDecodeFailures", 0) or 0)
        evaluated_count = max(1.0, evaluated)
        actual_rate = failures / evaluated_count
        add("videoDecodeFailureRate", actual_rate, float(spec["maxVideoDecodeFailureRate"]), actual_rate <= float(spec["maxVideoDecodeFailureRate"]))
    return checks


def _gate_candidate_score(row: dict[str, Any]) -> float:
    return (
        _safe_float(row.get("precision"), 0.0) * 0.30
        + _safe_float(row.get("recall"), 0.0) * 0.28
        + _safe_float(row.get("accuracy"), 0.0) * 0.20
        + max(_safe_float(row.get("profileRecall"), -1.0), _safe_float(row.get("recall"), 0.0)) * 0.12
        + max(_safe_float(row.get("crossAgeRecall"), -1.0), _safe_float(row.get("recall"), 0.0)) * 0.10
        - min(0.25, float(row.get("wrongIdentity", 0) or 0) * 0.02)
    )


def _gate_recommendations(gates: list[dict[str, Any]]) -> list[str]:
    failed = [row for row in gates if not row.get("ok")]
    if not failed:
        return ["Benchmark gates passed for completed required datasets."]
    result = []
    for row in failed[:5]:
        failing_checks = [str(check.get("name")) for check in row.get("checks", []) if not check.get("ok")]
        result.append(f"{row.get('datasetId')} failed: {', '.join(failing_checks) or 'unknown check'}.")
    return result


def _weighted_average(rows: list[dict[str, Any]], key: str) -> float:
    total_weight = 0
    total = 0.0
    for row in rows:
        value = row.get(key)
        if not isinstance(value, (int, float)):
            continue
        weight = max(1, int(row.get("evaluated", 0) or 0))
        total += float(value) * weight
        total_weight += weight
    return total / total_weight if total_weight else -1.0


def _threshold_value(thresholds: Any, attr: str, key: str, default: float) -> float:
    if thresholds is None:
        return default
    if isinstance(thresholds, dict):
        value = thresholds.get(key, thresholds.get(attr, default))
    else:
        value = getattr(thresholds, attr, default)
    return round(_clamp(_safe_float(value, default), 0.0, 1.0), 6)


def _safe_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _f_beta(precision: float, recall: float, *, beta: float) -> float:
    if precision <= 0.0 and recall <= 0.0:
        return 0.0
    beta_sq = beta * beta
    return (1 + beta_sq) * precision * recall / max(1e-9, beta_sq * precision + recall)


def _human_label(value: str) -> str:
    if ":" in value:
        group, name = value.split(":", 1)
        return f"{name.replace('-', ' ').title()} {group.replace('-', ' ')}"
    return value.replace("-", " ").title()

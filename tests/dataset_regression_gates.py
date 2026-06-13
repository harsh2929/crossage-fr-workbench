from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from crossage_fr.benchmark_quality import calibrate_public_labels, evaluate_dataset_gates, model_pack_quality_matrix
from crossage_fr.api_server import DesktopApi


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _score_rows(api: DesktopApi, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    scored: list[dict[str, Any]] = []
    for row in rows:
        score = api._model_pack_recommendation_score(row)
        scored.append({**row, "recommendationScore": score["score"], "recommendationReasons": score["reasons"]})
    return scored


def _assert_recommendation_gate(api: DesktopApi) -> dict[str, Any]:
    rows = _score_rows(
        api,
        [
            {
                "pack": "antelopev2",
                "label": "Current frontal baseline",
                "metrics": {"precision": 0.995, "recall": 0.62, "wrongIdentity": 0, "falsePositives": 0},
                "metricsByThreshold": {"likely": {"precision": 0.995, "recall": 0.60}},
                "validationMatrix": {"pose:profile": {"recall": 0.34}},
                "pipeline": {"scanMetrics": {"poseRelaxedReviews": 6}},
            },
            {
                "pack": "buffalo_l",
                "label": "Pose-aware candidate",
                "metrics": {"precision": 0.992, "recall": 0.82, "wrongIdentity": 0, "falsePositives": 0},
                "metricsByThreshold": {"likely": {"precision": 0.992, "recall": 0.80}},
                "validationMatrix": {"pose:profile": {"recall": 0.76}},
                "pipeline": {"scanMetrics": {"poseRelaxedReviews": 2}},
            },
            {
                "pack": "buffalo_s",
                "label": "Noisy candidate",
                "metrics": {"precision": 0.99, "recall": 0.84, "wrongIdentity": 2, "falsePositives": 1},
                "metricsByThreshold": {"likely": {"precision": 0.96, "recall": 0.82}},
                "validationMatrix": {"pose:profile": {"recall": 0.78}},
                "pipeline": {"scanMetrics": {"poseRelaxedReviews": 1}},
            },
        ],
    )
    recommendation = api._model_comparison_recommendation(rows, current_pack="antelopev2")
    assert recommendation["status"] == "switch", recommendation
    assert recommendation["recommendedPack"] == "buffalo_l", recommendation
    assert recommendation["confidence"] in {"high", "medium"}, recommendation
    assert recommendation["profileRecall"] >= 0.70, recommendation
    assert any("profile recall" in reason for reason in recommendation["reasons"]), recommendation
    noisy = next(row for row in rows if row["pack"] == "buffalo_s")
    pose_candidate = next(row for row in rows if row["pack"] == "buffalo_l")
    assert pose_candidate["recommendationScore"] > noisy["recommendationScore"], rows
    return {"recommendation": recommendation, "rows": rows}


def _assert_report_gate(report_path: str) -> dict[str, Any]:
    path = Path(report_path).expanduser()
    payload = json.loads(path.read_text(encoding="utf-8"))
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    matrix = payload.get("validationMatrix") if isinstance(payload.get("validationMatrix"), dict) else {}
    profile = matrix.get("pose:profile", {}) if isinstance(matrix.get("pose:profile"), dict) else {}
    evaluated = int(metrics.get("evaluated", 0) or 0)
    precision = float(metrics.get("precision", 0.0) or 0.0)
    recall = float(metrics.get("recall", 0.0) or 0.0)
    wrong_identity = int(metrics.get("wrongIdentity", 0) or 0)
    profile_recall = float(profile.get("recall", recall) or recall)
    gates = {
        "minEvaluated": _int_env("VINTRACE_DATASET_GATE_MIN_EVALUATED", 20),
        "minPrecision": _float_env("VINTRACE_DATASET_GATE_MIN_PRECISION", 0.90),
        "minRecall": _float_env("VINTRACE_DATASET_GATE_MIN_RECALL", 0.45),
        "minProfileRecall": _float_env("VINTRACE_DATASET_GATE_MIN_PROFILE_RECALL", 0.25),
        "maxWrongIdentity": _int_env("VINTRACE_DATASET_GATE_MAX_WRONG_IDENTITY", 0),
    }
    assert evaluated >= gates["minEvaluated"], {"evaluated": evaluated, "gates": gates}
    assert precision >= gates["minPrecision"], {"precision": precision, "gates": gates}
    assert recall >= gates["minRecall"], {"recall": recall, "gates": gates}
    assert profile_recall >= gates["minProfileRecall"], {"profileRecall": profile_recall, "gates": gates}
    assert wrong_identity <= gates["maxWrongIdentity"], {"wrongIdentity": wrong_identity, "gates": gates}
    return {"path": str(path), "metrics": metrics, "profile": profile, "gates": gates}


def _assert_threshold_calibration_and_matrix() -> dict[str, Any]:
    labels = [
        {"expectedPerson": "Ada", "actualPerson": "Ada", "matchScore": 0.81, "isMatch": True, "validationBucket": "age:cross-age", "poseBucket": "frontal", "mediaKind": "image", "difficulty": "cross-age"},
        {"expectedPerson": "Ada", "actualPerson": "Ada", "matchScore": 0.63, "isMatch": True, "validationBucket": "age:cross-age", "poseBucket": "profile", "mediaKind": "image", "difficulty": "cross-age"},
        {"expectedPerson": "Grace", "actualPerson": "Grace", "matchScore": 0.72, "isMatch": True, "validationBucket": "pose:profile", "poseBucket": "profile", "mediaKind": "image", "difficulty": "cross-pose"},
        {"expectedPerson": "Family", "actualPerson": "Ada", "matchScore": 0.54, "isMatch": False, "validationBucket": "hard-negative:family-lookalike", "poseBucket": "frontal", "mediaKind": "image", "difficulty": "family-lookalike"},
        {"expectedPerson": "Other", "actualPerson": "", "matchScore": 0.0, "isMatch": False, "validationBucket": "expected:non-match", "poseBucket": "unknown", "mediaKind": "image", "difficulty": "non-match"},
    ]
    calibration = calibrate_public_labels(labels, {"likely": 0.28, "strong": 0.40, "reviewMore": 0.20}, target_precision=0.98)
    assert calibration["labelCount"] == 5
    assert calibration["recommendedThresholds"]["likely"] > 0.54, calibration
    assert calibration["overall"]["recommendedLikely"]["falsePositives"] == 0, calibration
    assert "hard-negative:family-lookalike" in calibration["groups"], calibration
    rows = [
        {
            "datasetId": "cfp",
            "pack": "buffalo_l",
            "status": "complete",
            "evaluated": 80,
            "precision": 0.98,
            "recall": 0.82,
            "accuracy": 0.86,
            "profileRecall": 0.82,
            "wrongIdentity": 1,
            "falsePositives": 1,
            "hardNegativeFalsePositives": 0,
        },
        {
            "datasetId": "cfp",
            "pack": "antelopev2",
            "status": "complete",
            "evaluated": 80,
            "precision": 0.78,
            "recall": 0.84,
            "accuracy": 0.80,
            "profileRecall": 0.84,
            "wrongIdentity": 10,
            "falsePositives": 14,
            "hardNegativeFalsePositives": 0,
        },
        {
            "datasetId": "ytf",
            "status": "skipped",
            "pack": "",
            "evaluated": 0,
        },
    ]
    gates = evaluate_dataset_gates(rows, {"cfp": {"minEvaluated": 40, "minPrecision": 0.95, "minRecall": 0.80, "minAccuracy": 0.84, "minProfileRecall": 0.80, "maxWrongIdentity": 2}, "ytf": {"optional": True}})
    assert gates["ok"] is True, gates
    matrix = model_pack_quality_matrix(rows, current_pack="antelopev2")
    assert matrix["recommendedPack"] == "buffalo_l", matrix
    assert matrix["status"] == "switch", matrix
    return {"calibration": calibration, "gates": gates, "matrix": matrix}


def main() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = os.environ.get("CROSSAGE_FORCE_FALLBACK", "1")
    root = Path(tempfile.mkdtemp(prefix="vintrace-dataset-gates-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(root / "workspace")
    result = _assert_recommendation_gate(api)
    result["quality"] = _assert_threshold_calibration_and_matrix()
    report_path = os.environ.get("VINTRACE_DATASET_GATE_REPORT", "").strip()
    if report_path:
        result["reportGate"] = _assert_report_gate(report_path)
    print(json.dumps({"ok": True, **result}, indent=2))


if __name__ == "__main__":
    main()

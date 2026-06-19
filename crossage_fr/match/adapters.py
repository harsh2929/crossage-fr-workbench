"""Small local scoring adapters over frozen face embeddings.

The adapter learns only a transparent logistic scoring head over reviewed pair
metadata. It does not retrain detector or recognizer weights, and artifacts are
plain JSON so they can be audited, hashed, exported, and rolled back safely.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Sequence
import json
import math

import numpy as np


ADAPTER_TYPE = "logistic_regression"
ADAPTER_VERSION = "logistic-pair-adapter-v1"
FEATURE_VERSION = "pair-adapter-features-v1"

FEATURE_NAMES = [
    "raw_cosine",
    "match_score",
    "candidate_quality",
    "reference_quality",
    "runner_up_margin",
    "align_error",
    "ied_px_scaled",
    "age_gap_abs_scaled",
    "age_gap_missing",
    "pose_frontal",
    "pose_three_quarter",
    "pose_profile",
    "pose_edge_face",
    "pose_unknown",
    "media_video",
    "risk_close_runner_up",
    "risk_single_reference",
    "risk_hard_pose",
    "review_priority",
]


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, sort_keys=True, separators=(",", ":")))


def _finite(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return float(default)
    if not math.isfinite(result):
        return float(default)
    return result


def _clamp(value: Any, lo: float, hi: float, default: float = 0.0) -> float:
    return max(float(lo), min(float(hi), _finite(value, default)))


def _features(row: dict[str, Any]) -> dict[str, Any]:
    value = row.get("features")
    return value if isinstance(value, dict) else {}


def _value(row: dict[str, Any], *keys: str, default: Any = None) -> Any:
    features = _features(row)
    for key in keys:
        if key in row and row.get(key) is not None:
            return row.get(key)
        if key in features and features.get(key) is not None:
            return features.get(key)
    return default


def _bool_label(row: dict[str, Any]) -> bool | None:
    value = _value(row, "isMatch", "is_match")
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "match", "accepted"}
    return bool(value)


def _pose_bucket(row: dict[str, Any]) -> str:
    pose = str(_value(row, "poseBucket", "pose_bucket", default="unknown") or "unknown").strip().lower().replace("_", "-")
    if pose in {"front", "frontal", "center", "straight"}:
        return "frontal"
    if pose in {"three-quarter", "threequarter", "3q", "3-quarter", "three quarter"}:
        return "three-quarter"
    if pose in {"profile", "side", "side-face"}:
        return "profile"
    if pose in {"edge", "edge-face"}:
        return "edge-face"
    return "unknown"


def _risk_flags(row: dict[str, Any]) -> set[str]:
    raw = _value(row, "riskFlags", "risk_flags", default=[])
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = raw.replace(",", " ").split()
    else:
        parsed = raw
    if not isinstance(parsed, (list, tuple, set)):
        return set()
    return {str(item).strip().casefold() for item in parsed if str(item).strip()}


def canonical_row(row: dict[str, Any]) -> dict[str, Any] | None:
    """Return a row shape usable by fitting, validation, and live scoring."""
    label = _bool_label(row)
    match_score = _value(row, "matchScore", "match_score")
    raw_cosine = _value(row, "rawCosine", "raw_cosine", default=match_score)
    if match_score is None and raw_cosine is None:
        return None
    if match_score is None:
        match_score = raw_cosine
    if raw_cosine is None:
        raw_cosine = match_score
    expected = str(_value(row, "expectedPerson", "expected_person", "personName", "person_name", default="") or "")
    model = str(_value(row, "modelName", "model_name", default="") or "")
    result = dict(row)
    result["expectedPerson"] = expected
    result["expected_person"] = expected
    result["isMatch"] = bool(label) if label is not None else None
    result["is_match"] = 1 if label else 0 if label is not None else None
    result["matchScore"] = _clamp(match_score, 0.0, 1.0)
    result["match_score"] = result["matchScore"]
    result["rawCosine"] = _clamp(raw_cosine, -1.0, 1.0)
    result["raw_cosine"] = result["rawCosine"]
    result["modelName"] = model
    result["model_name"] = model
    return result


def scoped_training_rows(rows: Sequence[dict[str, Any]], model_name: str = "") -> tuple[list[dict[str, Any]], str, int]:
    canonical = [item for row in rows if (item := canonical_row(dict(row))) is not None and item.get("isMatch") is not None]
    models = [str(row.get("modelName") or "") for row in canonical if str(row.get("modelName") or "")]
    dominant = str(model_name or "")
    if not dominant and models:
        counts = Counter(models)
        dominant = sorted(counts.keys(), key=lambda key: (-counts[key], key))[0]
    if dominant:
        scoped = [row for row in canonical if str(row.get("modelName") or "") in {"", dominant}]
    else:
        scoped = canonical
    return scoped, dominant, len(canonical) - len(scoped)


def extract_pair_features(row: dict[str, Any]) -> dict[str, float]:
    """Feature extraction for a candidate/reference pair.

    Missing optional fields are represented by neutral numeric defaults plus explicit
    missing indicators where the distinction matters.
    """
    canonical = canonical_row(row) or dict(row)
    pose = _pose_bucket(canonical)
    risks = _risk_flags(canonical)
    age_gap = _value(canonical, "ageGapYears", "age_gap_years")
    age_missing = age_gap is None or str(age_gap) == ""
    ied_px = _finite(_value(canonical, "iedPx", "ied_px", default=0.0), 0.0)
    runner_margin = _value(canonical, "runnerUpMargin", "runner_up_margin", "margin", default=0.0)
    review_priority = _value(canonical, "reviewPriority", "review_priority", default=0.0)
    media_kind = str(_value(canonical, "mediaKind", "media_kind", default="image") or "image").casefold()
    reference_quality = _value(canonical, "referenceQuality", "reference_quality", default=_value(canonical, "quality", default=0.0))
    features = {
        "raw_cosine": _clamp(_value(canonical, "rawCosine", "raw_cosine", "matchScore", "match_score", default=0.0), -1.0, 1.0),
        "match_score": _clamp(_value(canonical, "matchScore", "match_score", "rawCosine", "raw_cosine", default=0.0), 0.0, 1.0),
        "candidate_quality": _clamp(_value(canonical, "quality", "candidateQuality", "candidate_quality", default=0.0), 0.0, 1.0),
        "reference_quality": _clamp(reference_quality, 0.0, 1.0),
        "runner_up_margin": _clamp(runner_margin, 0.0, 1.0),
        "align_error": _clamp(_value(canonical, "alignError", "align_error", default=0.0), 0.0, 1.0),
        "ied_px_scaled": _clamp(ied_px / 120.0, 0.0, 2.0),
        "age_gap_abs_scaled": 0.0 if age_missing else _clamp(abs(_finite(age_gap)) / 20.0, 0.0, 3.0),
        "age_gap_missing": 1.0 if age_missing else 0.0,
        "pose_frontal": 1.0 if pose == "frontal" else 0.0,
        "pose_three_quarter": 1.0 if pose == "three-quarter" else 0.0,
        "pose_profile": 1.0 if pose == "profile" else 0.0,
        "pose_edge_face": 1.0 if pose == "edge-face" else 0.0,
        "pose_unknown": 1.0 if pose == "unknown" else 0.0,
        "media_video": 1.0 if media_kind == "video" else 0.0,
        "risk_close_runner_up": 1.0 if "close-runner-up" in risks or "ambiguous-person-margin" in risks else 0.0,
        "risk_single_reference": 1.0 if "single-reference-match" in risks or "single-reference-close-runner-up" in risks else 0.0,
        "risk_hard_pose": 1.0 if "single-reference-hard-pose" in risks or "pose-reranked" in risks else 0.0,
        "review_priority": _clamp(review_priority, 0.0, 1.0),
    }
    return {name: float(features[name]) for name in FEATURE_NAMES}


def feature_vector(row: dict[str, Any], feature_names: Sequence[str] | None = None) -> list[float]:
    features = extract_pair_features(row)
    names = list(feature_names or FEATURE_NAMES)
    return [float(features.get(name, 0.0)) for name in names]


def _fit_numpy(x: np.ndarray, y: np.ndarray) -> tuple[list[float], float, str]:
    coef = np.zeros(x.shape[1], dtype="float64")
    intercept = 0.0
    lr = 0.15
    l2 = 0.5
    n = max(1, int(x.shape[0]))
    for _ in range(2500):
        logits = np.clip(x @ coef + intercept, -60.0, 60.0)
        prob = 1.0 / (1.0 + np.exp(-logits))
        error = prob - y
        grad_coef = (x.T @ error) / n + (l2 * coef / n)
        grad_intercept = float(np.sum(error)) / n
        coef -= lr * grad_coef
        intercept -= lr * grad_intercept
    return [float(value) for value in coef.tolist()], float(intercept), "numpy-logistic-regression"


def _fit_logistic(x: np.ndarray, y: np.ndarray) -> tuple[list[float], float, str]:
    try:
        from sklearn.linear_model import LogisticRegression

        model = LogisticRegression(
            solver="liblinear",
            random_state=0,
            max_iter=1000,
            class_weight="balanced",
        )
        model.fit(x, y.astype(int))
        return [float(value) for value in model.coef_[0].tolist()], float(model.intercept_[0]), "sklearn-logistic-regression"
    except Exception:
        return _fit_numpy(x, y)


def fit(
    rows: Sequence[dict[str, Any]],
    *,
    min_count: int = 100,
    min_per_class: int = 25,
    model_name: str = "",
) -> dict[str, Any] | None:
    scoped, dominant_model, dropped = scoped_training_rows(rows, model_name=model_name)
    positives = [row for row in scoped if row.get("isMatch")]
    negatives = [row for row in scoped if not row.get("isMatch")]
    if len(scoped) < int(min_count) or len(positives) < int(min_per_class) or len(negatives) < int(min_per_class):
        return None
    x_raw = np.asarray([feature_vector(row) for row in scoped], dtype="float64")
    y = np.asarray([1.0 if row.get("isMatch") else 0.0 for row in scoped], dtype="float64")
    means = x_raw.mean(axis=0)
    scales = x_raw.std(axis=0)
    scales[scales < 1e-9] = 1.0
    x = (x_raw - means) / scales
    coef, intercept, trainer = _fit_logistic(x, y)
    artifact = {
        "adapterType": ADAPTER_TYPE,
        "versionKey": ADAPTER_VERSION,
        "featureVersion": FEATURE_VERSION,
        "modelName": dominant_model,
        "featureNames": list(FEATURE_NAMES),
        "featureMeans": [float(value) for value in means.tolist()],
        "featureScales": [float(value) for value in scales.tolist()],
        "coef": coef,
        "intercept": float(intercept),
        "classes": [0, 1],
        "inputCount": len(scoped),
        "positiveCount": len(positives),
        "negativeCount": len(negatives),
        "labelsDroppedOtherModel": int(dropped),
        "trainer": trainer,
    }
    return serialize(artifact)


def serialize(artifact: dict[str, Any]) -> dict[str, Any]:
    required = {
        "adapterType",
        "versionKey",
        "featureVersion",
        "featureNames",
        "featureMeans",
        "featureScales",
        "coef",
        "intercept",
    }
    missing = sorted(required - set(artifact.keys()))
    if missing:
        raise ValueError(f"Adapter artifact is missing required fields: {', '.join(missing)}")
    return _json_safe(artifact)


def deserialize(payload: dict[str, Any]) -> dict[str, Any]:
    artifact = serialize(dict(payload))
    if artifact.get("adapterType") != ADAPTER_TYPE:
        raise ValueError("Unsupported adapter artifact type.")
    if artifact.get("versionKey") != ADAPTER_VERSION:
        raise ValueError("Unsupported adapter version.")
    if artifact.get("featureVersion") != FEATURE_VERSION:
        raise ValueError("Unsupported adapter feature version.")
    names = list(artifact.get("featureNames") or [])
    means = list(artifact.get("featureMeans") or [])
    scales = list(artifact.get("featureScales") or [])
    coef = list(artifact.get("coef") or [])
    if not names or not (len(names) == len(means) == len(scales) == len(coef)):
        raise ValueError("Adapter artifact has inconsistent feature dimensions.")
    return artifact


def score(row: dict[str, Any], artifact: dict[str, Any]) -> float:
    decoded = deserialize(artifact)
    names = list(decoded["featureNames"])
    x = np.asarray(feature_vector(row, names), dtype="float64")
    means = np.asarray(decoded["featureMeans"], dtype="float64")
    scales = np.asarray(decoded["featureScales"], dtype="float64")
    coef = np.asarray(decoded["coef"], dtype="float64")
    scales[scales == 0.0] = 1.0
    z = float(((x - means) / scales) @ coef + float(decoded["intercept"]))
    probability = 1.0 / (1.0 + math.exp(-max(-60.0, min(60.0, z))))
    return max(0.0, min(1.0, float(probability)))

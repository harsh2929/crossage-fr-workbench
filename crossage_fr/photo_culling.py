from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Callable
import hashlib
import json
import math
import re

import numpy as np
from PIL import Image

from crossage_fr.ingest.image_io import load_image


PHOTO_CULLING_VERSION = "vintrace-assisted-culling-v1"
MAX_CULLING_FRAMES = 60
MAX_CULLING_FACES = 8
SHARPNESS_METHOD = "variance-of-laplacian-v1"
MOTION_METHOD = "directional-gradient-clarity-v1"
EYES_METHOD = "opencv-haar-eye-likelihood-v1"


def _clamp(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(0.0, min(1.0, number)) if math.isfinite(number) else default


def _safe_int(value: Any, default: int = 0, *, minimum: int = 0, maximum: int = 10_000_000) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError, OverflowError):
        number = default
    return max(minimum, min(maximum, number))


def _clean_text(value: Any, limit: int) -> str:
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _sha256(value: Any) -> str:
    encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _normalized_relative(values: list[float]) -> list[float]:
    if not values:
        return []
    low = min(values)
    high = max(values)
    if high - low <= 1e-9:
        return [0.5 for _ in values]
    return [(value - low) / (high - low) for value in values]


@lru_cache(maxsize=1)
def _clarity_runtime_probe() -> tuple[bool, str]:
    try:
        import cv2

        sample = np.zeros((8, 8), dtype=np.uint8)
        cv2.Laplacian(sample, cv2.CV_32F, ksize=3)
        cv2.Sobel(sample, cv2.CV_32F, 1, 0, ksize=3)
        return True, ""
    except Exception as exc:
        return False, _clean_text(exc, 180) or "OpenCV clarity scoring is unavailable."


def image_clarity_metrics(image: Image.Image, max_edge: int = 1024) -> dict[str, float | int]:
    import cv2

    prepared = image.convert("RGB")
    prepared.thumbnail((max(128, int(max_edge)), max(128, int(max_edge))), Image.Resampling.LANCZOS)
    gray = cv2.cvtColor(np.asarray(prepared, dtype=np.uint8), cv2.COLOR_RGB2GRAY)
    laplacian = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    sharpness_raw = max(0.0, float(np.var(laplacian)))
    sharpness = _clamp(math.log1p(sharpness_raw) / math.log1p(200_000.0))

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    magnitude = cv2.magnitude(gx, gy)
    threshold = float(np.percentile(magnitude, 70.0)) if magnitude.size else 0.0
    edge_mask = magnitude >= max(4.0, threshold)
    edge_values = magnitude[edge_mask]
    directional_entropy = 0.0
    if edge_values.size >= 24:
        angles = np.mod(np.arctan2(gy[edge_mask], gx[edge_mask]), math.pi)
        histogram, _ = np.histogram(angles, bins=12, range=(0.0, math.pi), weights=edge_values)
        total = float(histogram.sum())
        if total > 0:
            probabilities = histogram.astype("float64") / total
            probabilities = probabilities[probabilities > 0]
            directional_entropy = float(-(probabilities * np.log(probabilities)).sum() / math.log(12.0))
    gradient_raw = float(np.mean(edge_values)) if edge_values.size else 0.0
    gradient_strength = _clamp(math.log1p(max(0.0, gradient_raw)) / math.log1p(500.0))
    horizontal_energy = max(0.0, float(np.mean(gx * gx)))
    vertical_energy = max(0.0, float(np.mean(gy * gy)))
    axis_balance = (
        min(horizontal_energy, vertical_energy) / max(horizontal_energy, vertical_energy)
        if max(horizontal_energy, vertical_energy) > 1e-9
        else 0.0
    )
    motion_clarity = _clamp(
        0.35 * sharpness
        + 0.35 * axis_balance
        + 0.15 * directional_entropy
        + 0.15 * gradient_strength
    )
    return {
        "width": int(prepared.width),
        "height": int(prepared.height),
        "sharpnessRaw": round(sharpness_raw, 6),
        "sharpness": round(sharpness, 6),
        "directionalEntropy": round(_clamp(directional_entropy), 6),
        "gradientStrength": round(gradient_strength, 6),
        "axisBalance": round(_clamp(axis_balance), 6),
        "motionClarity": round(motion_clarity, 6),
    }


@lru_cache(maxsize=1)
def _eye_cascades() -> tuple[Any | None, Any | None]:
    try:
        import cv2

        root = Path(str(cv2.data.haarcascades or ""))
        face = cv2.CascadeClassifier(str(root / "haarcascade_frontalface_default.xml"))
        eye = cv2.CascadeClassifier(str(root / "haarcascade_eye_tree_eyeglasses.xml"))
        if face.empty() or eye.empty():
            return None, None
        return face, eye
    except Exception:
        return None, None


def photo_culling_runtime_status() -> dict[str, Any]:
    clarity_available, clarity_reason = _clarity_runtime_probe()
    face, eye = _eye_cascades()
    return {
        "available": clarity_available,
        "offline": True,
        "version": PHOTO_CULLING_VERSION,
        "maxFrames": MAX_CULLING_FRAMES,
        "sharpnessMethod": SHARPNESS_METHOD,
        "motionMethod": MOTION_METHOD,
        "reason": clarity_reason,
        "eyes": {
            "available": face is not None and eye is not None,
            "method": EYES_METHOD,
            "heuristic": True,
        },
        "recommendationOnly": True,
        "automaticDeletion": False,
    }


def eye_openness_metrics(
    image: Image.Image,
    face_boxes: list[tuple[int, int, int, int]] | None = None,
) -> dict[str, Any]:
    import cv2

    face_cascade, eye_cascade = _eye_cascades()
    if face_cascade is None or eye_cascade is None:
        return {
            "available": False,
            "score": None,
            "confidence": "unavailable",
            "facesEvaluated": 0,
            "eyesDetected": 0,
            "method": EYES_METHOD,
        }
    rgb = np.asarray(image.convert("RGB"), dtype=np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape[:2]
    boxes: list[tuple[int, int, int, int]] = []
    for raw in face_boxes or []:
        if len(raw) != 4:
            continue
        left, top, right, bottom = (int(value) for value in raw)
        left, top = max(0, left), max(0, top)
        right, bottom = min(width, right), min(height, bottom)
        if right - left >= 36 and bottom - top >= 36:
            boxes.append((left, top, right - left, bottom - top))
    if not boxes:
        detected = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(40, 40),
        )
        boxes = [tuple(int(value) for value in row) for row in detected[:MAX_CULLING_FACES]]
    face_scores: list[float] = []
    eyes_detected = 0
    high_resolution_faces = 0
    for left, top, face_width, face_height in boxes[:MAX_CULLING_FACES]:
        if face_width >= 72:
            high_resolution_faces += 1
        upper_height = max(1, int(round(face_height * 0.62)))
        region = gray[top:top + upper_height, left:left + face_width]
        minimum_eye = max(8, int(round(face_width * 0.10)))
        eyes = eye_cascade.detectMultiScale(
            region,
            scaleFactor=1.08,
            minNeighbors=4,
            minSize=(minimum_eye, minimum_eye),
        )
        candidates = sorted(
            [tuple(int(value) for value in eye) for eye in eyes],
            key=lambda row: (-(row[2] * row[3]), row[0]),
        )
        distinct: list[tuple[int, int, int, int]] = []
        for candidate in candidates:
            center_x = candidate[0] + candidate[2] / 2.0
            if any(abs(center_x - (saved[0] + saved[2] / 2.0)) < face_width * 0.18 for saved in distinct):
                continue
            distinct.append(candidate)
            if len(distinct) >= 2:
                break
        count = len(distinct)
        eyes_detected += count
        face_scores.append(1.0 if count >= 2 else 0.58 if count == 1 else 0.22)
    if not face_scores:
        return {
            "available": False,
            "score": None,
            "confidence": "unavailable",
            "facesEvaluated": 0,
            "eyesDetected": 0,
            "method": EYES_METHOD,
        }
    score = min(face_scores)
    confidence = "medium" if high_resolution_faces == len(face_scores) else "low"
    return {
        "available": True,
        "score": round(_clamp(score), 6),
        "confidence": confidence,
        "facesEvaluated": len(face_scores),
        "eyesDetected": eyes_detected,
        "method": EYES_METHOD,
    }


def analyze_culling_frame(
    source_path: Path | str,
    *,
    face_signals_allowed: bool,
    face_analyzer: Callable[[Image.Image, Path], list[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    path = Path(source_path).expanduser().resolve()
    if not path.is_file():
        raise ValueError("A burst source photo is missing.")
    image = load_image(path).convert("RGB")
    image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    clarity = image_clarity_metrics(image, max_edge=1024)
    faces: list[dict[str, Any]] = []
    if face_signals_allowed and face_analyzer is not None:
        try:
            faces = [row for row in face_analyzer(image, path) if isinstance(row, dict)][:MAX_CULLING_FACES]
        except Exception:
            faces = []
    qualities: list[float] = []
    for row in faces:
        quality = row.get("fiqaScore")
        if quality is None:
            quality = row.get("quality")
        if quality is not None:
            qualities.append(_clamp(quality))
    face_quality = None
    if qualities:
        face_quality = _clamp(0.65 * (sum(qualities) / len(qualities)) + 0.35 * min(qualities))
    boxes = [
        tuple(int(value) for value in row.get("bbox", ()))
        for row in faces
        if isinstance(row.get("bbox"), (list, tuple)) and len(row.get("bbox")) == 4
    ]
    eyes = eye_openness_metrics(image, boxes) if face_signals_allowed else {
        "available": False,
        "score": None,
        "confidence": "consent-required",
        "facesEvaluated": 0,
        "eyesDetected": 0,
        "method": EYES_METHOD,
    }
    return {
        **clarity,
        "faceQuality": round(face_quality, 6) if face_quality is not None else None,
        "faceQualitySource": (
            "ediffiqa-t" if any(float(row.get("fiqaScore", 0) or 0) > 0 for row in faces)
            else "embedding-quality-fallback" if qualities
            else "unavailable"
        ),
        "facesDetected": max(len(faces), int(eyes.get("facesEvaluated", 0) or 0)),
        "eyesOpen": eyes.get("score"),
        "eyesConfidence": str(eyes.get("confidence", "unavailable") or "unavailable"),
        "eyesDetected": int(eyes.get("eyesDetected", 0) or 0),
        "eyesMethod": str(eyes.get("method", EYES_METHOD)),
        "faceSignalsAllowed": bool(face_signals_allowed),
    }


def _reason(code: str, impact: str, signal: str) -> dict[str, str]:
    return {"code": code, "impact": impact, "signal": signal}


def rank_culling_frames(frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(frames) < 2:
        raise ValueError("Assisted culling requires at least two burst frames.")
    if len(frames) > MAX_CULLING_FRAMES:
        raise ValueError(f"Assisted culling supports at most {MAX_CULLING_FRAMES} frames per burst.")
    clean_frames: list[dict[str, Any]] = []
    seen_assets: set[str] = set()
    for index, raw in enumerate(frames):
        if not isinstance(raw, dict):
            raise ValueError("Every culling frame must be an object.")
        asset_id = _clean_text(raw.get("assetId"), 128)
        if not asset_id or asset_id in seen_assets:
            raise ValueError("Every culling frame requires a unique assetId.")
        seen_assets.add(asset_id)
        clean_frames.append({
            **raw,
            "assetId": asset_id,
            "sequence": _safe_int(raw.get("sequence"), index + 1, minimum=1),
            "sharpness": _clamp(raw.get("sharpness")),
            "motionClarity": _clamp(raw.get("motionClarity")),
            "faceQuality": _clamp(raw.get("faceQuality")) if raw.get("faceQuality") is not None else None,
            "eyesOpen": _clamp(raw.get("eyesOpen")) if raw.get("eyesOpen") is not None else None,
        })
    sharp_relative = _normalized_relative([float(row["sharpness"]) for row in clean_frames])
    motion_relative = _normalized_relative([float(row["motionClarity"]) for row in clean_frames])
    ranked: list[dict[str, Any]] = []
    for index, row in enumerate(clean_frames):
        components: list[tuple[str, float, float]] = [
            ("sharpness", 0.40, 0.68 * float(row["sharpness"]) + 0.32 * sharp_relative[index]),
            ("motionClarity", 0.25, 0.68 * float(row["motionClarity"]) + 0.32 * motion_relative[index]),
        ]
        if row["faceQuality"] is not None:
            components.append(("faceQuality", 0.20, float(row["faceQuality"])))
        if row["eyesOpen"] is not None:
            components.append(("eyesOpen", 0.15, float(row["eyesOpen"])))
        total_weight = sum(weight for _, weight, _ in components)
        score = sum(weight * value for _, weight, value in components) / total_weight
        reasons: list[dict[str, str]] = []
        if sharp_relative[index] >= 0.75:
            reasons.append(_reason("sharpest-in-burst", "positive", "sharpness"))
        elif sharp_relative[index] <= 0.25:
            reasons.append(_reason("soft-focus", "negative", "sharpness"))
        else:
            reasons.append(_reason("usable-sharpness", "neutral", "sharpness"))
        if motion_relative[index] >= 0.70:
            reasons.append(_reason("motion-clear", "positive", "motionClarity"))
        elif motion_relative[index] <= 0.25:
            reasons.append(_reason("motion-blur-risk", "negative", "motionClarity"))
        else:
            reasons.append(_reason("moderate-motion-clarity", "neutral", "motionClarity"))
        if row["faceQuality"] is not None:
            reasons.append(_reason(
                "faces-high-quality" if float(row["faceQuality"]) >= 0.65 else "faces-low-quality",
                "positive" if float(row["faceQuality"]) >= 0.65 else "negative",
                "faceQuality",
            ))
        if row["eyesOpen"] is not None:
            reasons.append(_reason(
                "eyes-likely-open" if float(row["eyesOpen"]) >= 0.85 else "eyes-uncertain",
                "positive" if float(row["eyesOpen"]) >= 0.85 else "negative",
                "eyesOpen",
            ))
        elif not bool(row.get("faceSignalsAllowed", False)):
            reasons.append(_reason("face-signals-consent-required", "neutral", "faceQuality"))
        else:
            reasons.append(_reason("no-face-signals", "neutral", "faceQuality"))
        ranked.append({
            **row,
            "score": round(_clamp(score), 6),
            "components": {name: round(_clamp(value), 6) for name, _, value in components},
            "reasons": reasons,
        })
    ranked.sort(key=lambda row: (-float(row["score"]), -float(row["sharpness"]), int(row["sequence"]), str(row["assetId"])))
    for index, row in enumerate(ranked):
        row["rank"] = index + 1
        row["recommended"] = index == 0
        if index == 0:
            row["reasons"] = [_reason("top-overall", "positive", "overall"), *row["reasons"]]
    return ranked


def _clean_culling_provenance(value: Any) -> dict[str, Any]:
    body = value if isinstance(value, dict) else {}
    return {
        "offline": True,
        "sharpnessMethod": _clean_text(body.get("sharpnessMethod"), 80) or SHARPNESS_METHOD,
        "motionMethod": _clean_text(body.get("motionMethod"), 80) or MOTION_METHOD,
        "eyesMethod": _clean_text(body.get("eyesMethod"), 80) or EYES_METHOD,
        "faceQualitySource": _clean_text(body.get("faceQualitySource"), 160),
        "faceQualityModelId": _clean_text(body.get("faceQualityModelId"), 120),
        "faceQualityModelVersion": _clean_text(body.get("faceQualityModelVersion"), 120),
        "faceQualityLicense": _clean_text(body.get("faceQualityLicense"), 80),
        "faceEngine": _clean_text(body.get("faceEngine"), 120),
    }


def _culling_projection(
    *,
    stack_id: str,
    source_manifest: list[dict[str, str]],
    frames: list[dict[str, Any]],
    face_signals_allowed: bool,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    return {
        "version": PHOTO_CULLING_VERSION,
        "stackId": stack_id,
        "sourceManifest": source_manifest,
        "faceSignalsAllowed": bool(face_signals_allowed),
        "provenance": provenance,
        "frames": [
            {
                "assetId": row["assetId"],
                "score": row["score"],
                "rank": row["rank"],
                "signals": {
                    "sharpness": _clamp(row.get("sharpness")),
                    "motionClarity": _clamp(row.get("motionClarity")),
                    "faceQuality": _clamp(row.get("faceQuality")) if row.get("faceQuality") is not None else None,
                    "eyesOpen": _clamp(row.get("eyesOpen")) if row.get("eyesOpen") is not None else None,
                    "facesDetected": _safe_int(row.get("facesDetected"), 0, maximum=MAX_CULLING_FACES),
                    "eyesConfidence": _clean_text(row.get("eyesConfidence"), 30),
                },
                "reasons": row["reasons"],
            }
            for row in frames
        ],
    }


def build_photo_culling_result(
    frames: list[dict[str, Any]],
    *,
    stack_id: str,
    source_manifest: list[dict[str, str]],
    analyzed_at: str,
    face_signals_allowed: bool,
    provenance: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ranked = rank_culling_frames(frames)
    top = ranked[0]
    runner_up = ranked[1]
    margin = max(0.0, float(top["score"]) - float(runner_up["score"]))
    confidence = "high" if margin >= 0.12 and float(top["score"]) >= 0.65 else "medium" if margin >= 0.04 else "low"
    clean_provenance = _clean_culling_provenance({
        "sharpnessMethod": SHARPNESS_METHOD,
        "motionMethod": MOTION_METHOD,
        "eyesMethod": EYES_METHOD,
        **(provenance or {}),
    })
    projection = _culling_projection(
        stack_id=_clean_text(stack_id, 128),
        source_manifest=source_manifest,
        frames=ranked,
        face_signals_allowed=face_signals_allowed,
        provenance=clean_provenance,
    )
    result_sha256 = _sha256(projection)
    return {
        "analysisId": f"culling:{result_sha256[:24]}",
        "version": PHOTO_CULLING_VERSION,
        "stackId": projection["stackId"],
        "analyzedAt": _clean_text(analyzed_at, 40),
        "resultSha256": result_sha256,
        "sourceManifest": source_manifest,
        "recommendedAssetId": str(top["assetId"]),
        "recommendationScore": float(top["score"]),
        "recommendationConfidence": confidence,
        "recommendationMargin": round(margin, 6),
        "recommendationOnly": True,
        "requiresReview": True,
        "automaticDeletion": False,
        "faceSignalsAllowed": bool(face_signals_allowed),
        "provenance": clean_provenance,
        "frames": ranked,
        "application": {},
    }


def clean_photo_culling_result(value: Any) -> dict[str, Any] | None:
    body = value if isinstance(value, dict) else {}
    stack_id = _clean_text(body.get("stackId"), 128)
    result_hash = str(body.get("resultSha256", "") or "").lower()
    analysis_id = _clean_text(body.get("analysisId"), 80)
    if not stack_id or not analysis_id or not re.fullmatch(r"[a-f0-9]{64}", result_hash):
        return None
    manifest: list[dict[str, str]] = []
    for row in body.get("sourceManifest", []) if isinstance(body.get("sourceManifest"), list) else []:
        if not isinstance(row, dict):
            continue
        asset_id = _clean_text(row.get("assetId"), 128)
        content_hash = str(row.get("contentHash", "") or "").lower()
        if asset_id and re.fullmatch(r"[a-f0-9]{64}", content_hash):
            manifest.append({"assetId": asset_id, "contentHash": content_hash})
    raw_frames = body.get("frames") if isinstance(body.get("frames"), list) else []
    frames: list[dict[str, Any]] = []
    allowed_ids = {row["assetId"] for row in manifest}
    for raw in raw_frames[:MAX_CULLING_FRAMES]:
        if not isinstance(raw, dict):
            continue
        asset_id = _clean_text(raw.get("assetId"), 128)
        if asset_id not in allowed_ids:
            continue
        reasons = [
            {
                "code": _clean_text(reason.get("code"), 80),
                "impact": str(reason.get("impact", "neutral")) if str(reason.get("impact", "neutral")) in {"positive", "negative", "neutral"} else "neutral",
                "signal": _clean_text(reason.get("signal"), 40),
            }
            for reason in raw.get("reasons", []) if isinstance(reason, dict)
        ][:8]
        signals = {
            key: (_clamp(raw.get(key)) if raw.get(key) is not None else None)
            for key in ("sharpness", "motionClarity", "faceQuality", "eyesOpen")
        }
        frames.append({
            "assetId": asset_id,
            "sequence": _safe_int(raw.get("sequence"), len(frames) + 1, minimum=1),
            "score": _clamp(raw.get("score")),
            "rank": _safe_int(raw.get("rank"), len(frames) + 1, minimum=1),
            "recommended": bool(raw.get("recommended", False)),
            "sharpness": signals["sharpness"],
            "motionClarity": signals["motionClarity"],
            "faceQuality": signals["faceQuality"],
            "eyesOpen": signals["eyesOpen"],
            "facesDetected": _safe_int(raw.get("facesDetected"), 0, maximum=MAX_CULLING_FACES),
            "eyesConfidence": _clean_text(raw.get("eyesConfidence"), 30),
            "faceQualitySource": _clean_text(raw.get("faceQualitySource"), 80),
            "reasons": reasons,
        })
    recommended_id = _clean_text(body.get("recommendedAssetId"), 128)
    if len(manifest) < 2 or len(frames) != len(manifest) or recommended_id not in allowed_ids:
        return None
    application = body.get("application") if isinstance(body.get("application"), dict) else {}
    idempotency_hash = str(application.get("idempotencyKeySha256", "") or "").lower()
    if not re.fullmatch(r"[a-f0-9]{64}", idempotency_hash):
        idempotency_hash = ""
    recommended_frames = [row for row in frames if row["recommended"]]
    expected_ranks = list(range(1, len(frames) + 1))
    if (
        len(recommended_frames) != 1
        or recommended_frames[0]["assetId"] != recommended_id
        or [row["rank"] for row in frames] != expected_ranks
    ):
        return None
    face_signals_allowed = bool(body.get("faceSignalsAllowed", False))
    clean_provenance = _clean_culling_provenance(body.get("provenance"))
    expected_hash = _sha256(_culling_projection(
        stack_id=stack_id,
        source_manifest=manifest,
        frames=frames,
        face_signals_allowed=face_signals_allowed,
        provenance=clean_provenance,
    ))
    if result_hash != expected_hash or analysis_id != f"culling:{expected_hash[:24]}":
        return None
    top_score = float(frames[0]["score"])
    runner_up_score = float(frames[1]["score"])
    margin = max(0.0, top_score - runner_up_score)
    confidence = "high" if margin >= 0.12 and top_score >= 0.65 else "medium" if margin >= 0.04 else "low"
    return {
        "analysisId": analysis_id,
        "version": PHOTO_CULLING_VERSION,
        "stackId": stack_id,
        "analyzedAt": _clean_text(body.get("analyzedAt"), 40),
        "resultSha256": result_hash,
        "sourceManifest": manifest,
        "recommendedAssetId": recommended_id,
        "recommendationScore": top_score,
        "recommendationConfidence": confidence,
        "recommendationMargin": round(margin, 6),
        "recommendationOnly": True,
        "requiresReview": True,
        "automaticDeletion": False,
        "faceSignalsAllowed": face_signals_allowed,
        "provenance": clean_provenance,
        "frames": frames,
        "application": {
            "idempotencyKeySha256": idempotency_hash,
            "assetId": _clean_text(application.get("assetId"), 128),
            "appliedAt": _clean_text(application.get("appliedAt"), 40),
        } if idempotency_hash else {},
    }

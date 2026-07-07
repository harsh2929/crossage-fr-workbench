"""Unit tests for the Safe Mode explainer framework (res.md Stage 2).

Stage 2 adds an OPTIONAL "explain why flagged" body-part detector (boxes + labels)
as a second stage. The detector model (NudeNet 640m, AGPL, download-only; or a
Freepik ONNX export) is not bundled — the framework degrades gracefully when no
model is installed and provides the schema + pure helpers that don't depend on a
model. These tests cover the model-independent core (box normalization, filtering,
graceful no-model behavior).

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safety_explain_units.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from crossage_fr.ingest import safety_explain as safety_explain_module
from crossage_fr.ingest.safety_explain import (
    ExplainDetection,
    box_iou,
    explain_sensitivity,
    filter_and_cap_detections,
    letterbox_params,
    non_max_suppression,
    normalize_detection_box,
    install_explainer_model,
    unletterbox_box,
)


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def approx(a: float, b: float, eps: float = 1e-6) -> bool:
    return abs(a - b) < eps


# normalize_detection_box: pixel xywh (top-left origin) → [0,1] fractions, clamped.
box = normalize_detection_box((64, 96, 128, 64), 256)
check("box x normalized", approx(box[0], 0.25))
check("box y normalized", approx(box[1], 0.375))
check("box w normalized", approx(box[2], 0.5))
check("box h normalized", approx(box[3], 0.25))

# Out-of-frame boxes clamp into [0,1] (no negative, no overflow).
clamped = normalize_detection_box((-10, -10, 400, 400), 256)
check("negative x clamps to 0", clamped[0] == 0.0)
check("overflowing width clamps to <=1", clamped[2] <= 1.0)
check("zero input_size guards to zeros", normalize_detection_box((10, 10, 20, 20), 0) == (0.0, 0.0, 0.0, 0.0))

# filter_and_cap_detections: drop below min_conf, sort by score desc, cap count.
dets = [
    ExplainDetection(label="a", score=0.9, box=(0, 0, 0.1, 0.1)),
    ExplainDetection(label="b", score=0.2, box=(0, 0, 0.1, 0.1)),
    ExplainDetection(label="c", score=0.75, box=(0, 0, 0.1, 0.1)),
    ExplainDetection(label="d", score=0.5, box=(0, 0, 0.1, 0.1)),
]
kept = filter_and_cap_detections(dets, min_conf=0.4, max_count=2)
check("filter drops below min_conf", all(d.score >= 0.4 for d in kept))
check("filter sorts by score desc", [d.label for d in kept] == ["a", "c"])
check("filter caps count", len(kept) == 2)
check("empty in → empty out", filter_and_cap_detections([], 0.4, 5) == [])

# Graceful degradation: with no explainer model installed, explain_sensitivity
# returns available=False and an empty detection list (never raises).
result = explain_sensitivity(None)
check("no-model → not available", result.get("available") is False)
check("no-model → empty detections", result.get("detections") == [])
check("no-model → has a reason", bool(result.get("reason")))


def _clear_explainer_cache() -> None:
    if hasattr(safety_explain_module.find_explainer_model, "cache_clear"):
        safety_explain_module.find_explainer_model.cache_clear()


with tempfile.TemporaryDirectory() as tmp:
    base = Path(tmp)
    source = base / "downloaded.onnx"
    source.write_bytes(b"fake onnx payload" * 128)
    user_model_root = base / "user-data" / "models"
    expected_dir = user_model_root / "safety-explain"
    saved_env = {
        key: os.environ.get(key)
        for key in (
            "CROSSAGE_PACKAGED_BACKEND",
            "CROSSAGE_USER_MODEL_DIR",
            "CROSSAGE_SAFETY_EXPLAIN_DIR",
            "CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR",
        )
    }
    try:
        os.environ["CROSSAGE_PACKAGED_BACKEND"] = "1"
        os.environ["CROSSAGE_USER_MODEL_DIR"] = str(user_model_root)
        os.environ.pop("CROSSAGE_SAFETY_EXPLAIN_DIR", None)
        os.environ.pop("CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR", None)
        _clear_explainer_cache()
        installed = install_explainer_model(
            source_path=str(source),
            model_name="../unsafe explainer name",
            input_size=640,
            license="MIT",
            classes=["sensitive_region"],
        )
        installed_path = expected_dir / "unsafe-explainer-name.onnx"
        check("packaged explainer install succeeds", installed.get("ok") is True)
        check("packaged explainer writes into user model dir", installed_path.exists())
        check("packaged explainer sanitizes model filename", not (base / "unsafe explainer name.onnx").exists())
        report = safety_explain_module.explain_model_report()
        check("packaged explainer discovery finds user model", report.get("path") == str(installed_path.resolve()))
    finally:
        for key, value in saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        _clear_explainer_cache()

# --- NudeNet YOLO geometry (letterbox pad-resize → detect → un-letterbox) ---

# A 200x100 image into a 640 square: scale by 3.2 (fit the long side), pad the
# short side. scaled = 640x320, so pad_y = (640-320)/2 = 160, pad_x = 0.
scale, pad_x, pad_y = letterbox_params(200, 100, 640)
check("letterbox scale = size/longest-side", approx(scale, 3.2))
check("letterbox pads the short side (y)", approx(pad_y, 160.0))
check("letterbox no pad on the long side (x)", approx(pad_x, 0.0))

# The letterboxed content box (x=0,y=160,w=640,h=320) maps back to the whole image.
whole = unletterbox_box((0, 160, 640, 320), scale, pad_x, pad_y, 200, 100)
check("unletterbox maps content box to full frame", all(approx(a, b) for a, b in zip(whole, (0.0, 0.0, 1.0, 1.0))))
# A centered half-size box un-letterboxes into the original's center-ish region.
half = unletterbox_box((160, 160 + 80, 320, 160), scale, pad_x, pad_y, 200, 100)
check("unletterbox center box x", approx(half[0], 0.25))
check("unletterbox center box w", approx(half[2], 0.5))

# IoU
check("iou identical = 1", approx(box_iou((0, 0, 0.4, 0.4), (0, 0, 0.4, 0.4)), 1.0))
check("iou disjoint = 0", approx(box_iou((0, 0, 0.2, 0.2), (0.5, 0.5, 0.2, 0.2)), 0.0))
check("iou half-overlap in (0,1)", 0.0 < box_iou((0, 0, 0.4, 0.4), (0.2, 0, 0.4, 0.4)) < 1.0)

# NMS keeps the top box and suppresses a heavily-overlapping lower-scored one of
# the same label; keeps a distinct box.
nms_in = [
    ExplainDetection(label="exposed_breast", score=0.9, box=(0.1, 0.1, 0.3, 0.3)),
    ExplainDetection(label="exposed_breast", score=0.6, box=(0.12, 0.12, 0.3, 0.3)),
    ExplainDetection(label="exposed_genitalia", score=0.8, box=(0.6, 0.6, 0.2, 0.2)),
]
kept = non_max_suppression(nms_in, iou_threshold=0.5)
labels_scores = sorted((d.label, round(d.score, 2)) for d in kept)
check("nms suppresses the overlapping duplicate", len(kept) == 2)
check("nms keeps the higher-scored of the pair + the distinct box",
      labels_scores == [("exposed_breast", 0.9), ("exposed_genitalia", 0.8)])

print("\nall safety-explain tests passed")

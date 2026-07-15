"""Unit tests for face-quality normalization + rescue pose bucketing (Phase 0).

Covers two Phase-0 fixes from docs/detection-pipeline-audit.md:
  1. quality_from_norm: the raw ArcFace embedding L2 norm (~10-30 for the real
     engines) was stored directly as `quality` and compared against quality_min,
     a [0,1] value -> every quality gate was a silent no-op. This maps the norm
     onto a calibrated [0,1] scale so the gates work again.
  2. rescue faces were hard-labeled pose_bucket='profile', routing even frontal
     rescued faces through the loosest threshold band. _pose_bucket_for_face now
     runs the real heuristic when keypoints are present.

Run: PYTHONPATH=. .venv/bin/python tests/quality_units.py
"""

from __future__ import annotations

import sys
import types

import numpy as np

from crossage_fr.config import Thresholds
from crossage_fr.embed.engine import InsightFaceEmbeddingEngine, flip_average, quality_from_norm


def test_quality_from_norm_gate_behavior() -> None:
    gate = Thresholds().quality_min  # 0.15
    # A typical good-face ArcFace norm (~22 on the ~10-30 scale) must PASS the gate.
    assert quality_from_norm(22.0, "insightface-antelopev2") > gate
    # A clearly-degraded face (norm ~9) must be GATED (this is the whole point of
    # the fix: today the gate never fires for the real engine).
    assert quality_from_norm(9.0, "insightface-antelopev2") < gate


def test_quality_from_norm_monotonic_and_clamped() -> None:
    assert quality_from_norm(25.0) >= quality_from_norm(15.0) >= quality_from_norm(10.0)
    assert quality_from_norm(10_000.0) == 1.0
    assert quality_from_norm(0.0) == 0.0
    assert quality_from_norm(-5.0) == 0.0
    assert quality_from_norm(float("nan")) == 0.0
    assert quality_from_norm(float("inf")) == 1.0
    q = quality_from_norm(20.0)
    assert isinstance(q, float) and 0.0 <= q <= 1.0


def _engine() -> InsightFaceEmbeddingEngine:
    # Build WITHOUT loading any ONNX model: these pose methods use only their args,
    # so __new__ (no __init__) is enough and keeps the test model-free.
    return InsightFaceEmbeddingEngine.__new__(InsightFaceEmbeddingEngine)


def _frontal_kps() -> np.ndarray:
    # left_eye, right_eye, nose, mouth_l, mouth_r in a 100px-wide face box:
    # wide eye span + centered nose -> frontal.
    return np.array([[30, 40], [70, 40], [50, 60], [35, 80], [65, 80]], dtype="float32")


def _profile_kps() -> np.ndarray:
    # eyes close together (small span) -> profile per the heuristic.
    return np.array([[45, 40], [58, 40], [52, 60], [47, 80], [60, 80]], dtype="float32")


def test_rescue_pose_uses_real_bucket_not_hardcoded_profile() -> None:
    eng = _engine()
    image = np.zeros((100, 200, 3), dtype="uint8")  # width 200 -> face_center 0.25, not edge
    bbox = np.array([0, 0, 100, 100], dtype="float32")
    # THE FIX: a rescued FRONTAL face must NOT be mislabeled 'profile'.
    assert eng._pose_bucket_for_face(image, bbox, _frontal_kps(), rescue=True) == "frontal"
    # A genuinely profile rescued face still resolves to 'profile'.
    assert eng._pose_bucket_for_face(image, bbox, _profile_kps(), rescue=True) == "profile"
    # Rescue with NO keypoints keeps the safe 'profile' fallback.
    assert eng._pose_bucket_for_face(image, bbox, None, rescue=True) == "profile"


def test_non_rescue_pose_behavior_preserved() -> None:
    eng = _engine()
    image = np.zeros((100, 200, 3), dtype="uint8")
    bbox = np.array([0, 0, 100, 100], dtype="float32")
    # Non-rescue path unchanged: real heuristic when kps present...
    assert eng._pose_bucket_for_face(image, bbox, _frontal_kps(), rescue=False) == "frontal"
    # ...and 'unknown' (not 'profile') when kps missing on a non-edge face.
    assert eng._pose_bucket_for_face(image, bbox, None, rescue=False) == "unknown"


def test_flip_tta_quality_norm_uses_raw_averaged_template() -> None:
    eng = _engine()
    eng.flip_tta = True

    class FakeRecognizer:
        input_size = (2, 2)

        def __init__(self) -> None:
            self.calls = 0

        def get_feat(self, _aligned: np.ndarray) -> np.ndarray:
            self.calls += 1
            if self.calls == 1:
                return np.asarray([20.0, 0.0], dtype="float32")
            return np.asarray([0.0, 10.0], dtype="float32")

    class FakeFace:
        embedding: np.ndarray

    face = FakeFace()
    eng.rec_model = FakeRecognizer()
    source_bgr = np.zeros((4, 4, 3), dtype="uint8")
    kps = np.asarray([[1.0, 1.0], [2.0, 1.0], [1.5, 2.0], [1.0, 3.0], [2.0, 3.0]], dtype="float32")
    aligned = np.arange(12, dtype="uint8").reshape(2, 2, 3)

    original_insightface = sys.modules.get("insightface")
    original_utils = sys.modules.get("insightface.utils")
    had_insightface = "insightface" in sys.modules
    had_utils = "insightface.utils" in sys.modules
    fake_utils = types.SimpleNamespace(face_align=types.SimpleNamespace(norm_crop=lambda *_args, **_kwargs: aligned))
    sys.modules["insightface"] = types.SimpleNamespace(utils=fake_utils)
    sys.modules["insightface.utils"] = fake_utils
    try:
        vector = eng._recognize(source_bgr, face, kps)
    finally:
        if had_insightface:
            sys.modules["insightface"] = original_insightface  # type: ignore[assignment]
        else:
            sys.modules.pop("insightface", None)
        if had_utils:
            sys.modules["insightface.utils"] = original_utils  # type: ignore[assignment]
        else:
            sys.modules.pop("insightface.utils", None)

    expected_vector = flip_average(np.asarray([20.0, 0.0]), np.asarray([0.0, 10.0]))
    expected_quality_embedding = np.asarray([10.0, 5.0], dtype="float32")
    assert np.allclose(vector, expected_vector), vector
    assert abs(float(np.linalg.norm(vector)) - 1.0) < 1e-6
    assert np.allclose(face.embedding, expected_quality_embedding), face.embedding
    assert abs(float(np.linalg.norm(face.embedding)) - float(np.linalg.norm(expected_quality_embedding))) < 1e-6
    assert eng.rec_model.calls == 2
    assert face._vintrace_alignment["attempts"] == 0
    assert face._vintrace_alignment["rescued"] is False


def main() -> None:
    test_quality_from_norm_gate_behavior()
    test_quality_from_norm_monotonic_and_clamped()
    test_rescue_pose_uses_real_bucket_not_hardcoded_profile()
    test_non_rescue_pose_behavior_preserved()
    test_flip_tta_quality_norm_uses_raw_averaged_template()
    print("quality units ok")


if __name__ == "__main__":
    main()

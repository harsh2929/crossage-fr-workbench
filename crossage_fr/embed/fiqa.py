"""Face image quality assessment seam (Phase 2.2).

A recognition-aware FIQA score (e.g. eDifFIQA(T) -- MIT-licensed, ~7.3 MB ONNX in the
OpenCV Model Zoo) is a stronger quality signal than the embedding-norm proxy,
especially on the cross-quality / pose cases this app is hardest on. This module is the
DROP-IN seam: place a FIQA ONNX under ``models/fiq/`` (or point CROSSAGE_FIQA_MODEL at
one) and it is preferred over the norm; with no model installed the pipeline transparently
falls back to the calibrated embedding norm (Phase 0.1).

NOTE: the ONNX inference path is structural and intentionally conservative -- its exact
preprocessing must match whichever FIQA model is dropped in, and it is exercised only
when a real model is present (none ships by default). The selection/fallback logic below
is what is unit-tested.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

import numpy as np


def effective_quality(norm_quality: float, fiqa_score: float | None) -> float:
    """Prefer a FIQA score (already a recognizability estimate) over the norm proxy."""
    if fiqa_score is None:
        return float(norm_quality)
    return max(0.0, min(1.0, float(fiqa_score)))


def find_fiqa_model(root: Path) -> Path | None:
    """First FIQA ONNX under ``<root>/models/fiq`` or ``<root>`` (drop-in discovery)."""
    root = Path(root)
    for directory in (root / "models" / "fiq", root):
        if directory.is_dir():
            matches = sorted(directory.glob("*.onnx"))
            if matches:
                return matches[0]
    return None


class FiqaScorer:
    """Scores an aligned 112x112 face crop in [0,1] via an ONNX FIQA model."""

    def __init__(self, session: object, input_name: str, input_size: int = 112) -> None:
        self._session = session
        self._input_name = input_name
        self._input_size = input_size

    def score_aligned(self, aligned_bgr: np.ndarray) -> float:
        import cv2

        rgb = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2RGB)
        if rgb.shape[0] != self._input_size or rgb.shape[1] != self._input_size:
            rgb = cv2.resize(rgb, (self._input_size, self._input_size))
        tensor = (rgb.astype("float32") / 255.0).transpose(2, 0, 1)[None, ...]
        output = self._session.run(None, {self._input_name: tensor})
        value = float(np.asarray(output[0]).reshape(-1)[0])
        return max(0.0, min(1.0, value))


def load_fiqa_scorer(model_path: Path | None) -> FiqaScorer | None:
    """Build a FIQA scorer from a model path, or None when no usable model is available."""
    if model_path is None:
        env_path = os.environ.get("CROSSAGE_FIQA_MODEL", "").strip()
        if not env_path:
            return None
        model_path = Path(env_path)
    if not Path(model_path).is_file() or importlib.util.find_spec("onnxruntime") is None:
        return None
    try:
        import onnxruntime

        session = onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        input_name = session.get_inputs()[0].name
        return FiqaScorer(session, input_name)
    except Exception:
        return None

"""MS-6 / TO-1: exercise the REAL Safe-Mode ONNX model's inference path.

Every other suite runs with CROSSAGE_FORCE_FALLBACK=1, which swaps the ONNX NSFW
gate for a heuristic — so the real preprocessing -> session.run -> softmax ->
verdict pipeline (the product's core privacy control) had zero behavioural
coverage. The bundled model ships in the repo, so this needs no download.

The test asserts the real model:
  * loads (engine = onnx-hybrid, not the heuristic fallback),
  * produces a calibrated score in [0, 1] for a benign image, and
  * does NOT flag a clearly-benign synthetic image as sensitive.

It SKIPS cleanly (exit 0) when onnxruntime or the model is unavailable so it
never breaks a fallback-only environment; wire it into a CI lane that does NOT
set CROSSAGE_FORCE_FALLBACK to get real coverage.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Force the real model path (and clear any inherited fallback flag).
os.environ.pop("CROSSAGE_FORCE_FALLBACK", None)
os.environ["CROSSAGE_SAFE_MODE_ENGINE"] = "model"

from PIL import Image  # noqa: E402

from crossage_fr.ingest.safety import (  # noqa: E402
    _load_safety_model,
    assess_image_safety,
    safety_model_report,
)


def _assess(color: tuple[int, int, int], size: int) -> object:
    image = Image.new("RGB", (size, size), color)
    return assess_image_safety(ROOT / "tests" / "_synthetic.png", threshold=0.58, image=image)


def main() -> None:
    try:
        import onnxruntime  # noqa: F401
    except Exception:
        print("safety model inference SKIPPED (onnxruntime unavailable)")
        return

    report = safety_model_report()
    if not report.get("available"):
        print("safety model inference SKIPPED (no real Safe-Mode model found)")
        return

    model = _load_safety_model()
    assert model is not None, "engine=model but the real safety model did not load"
    assert report.get("engine") == "onnx-hybrid", f"unexpected engine: {report.get('engine')}"

    # A flat, clearly-benign image must traverse the real inference pipeline and
    # come back NOT sensitive with a valid score.
    benign = _assess((130, 150, 170), 512)
    assert benign.engine == "onnx-hybrid", f"expected real engine, got {benign.engine}"
    assert benign.model_score is not None, "real model produced no score"
    assert 0.0 <= float(benign.model_score) <= 1.0, f"score out of range: {benign.model_score}"
    assert benign.sensitive is False, (
        f"benign synthetic image wrongly flagged sensitive (score={benign.model_score})"
    )

    # A second distinct benign image confirms the pipeline is deterministic and
    # in-range (not asserting the verdict direction beyond the in-range score).
    benign2 = _assess((240, 240, 240), 384)
    assert benign2.engine == "onnx-hybrid"
    assert 0.0 <= float(benign2.model_score) <= 1.0

    # Re-running the same input must be deterministic.
    again = _assess((130, 150, 170), 512)
    assert abs(float(again.model_score) - float(benign.model_score)) < 1e-6, "model is non-deterministic"

    print("safety model inference ok")


if __name__ == "__main__":
    main()

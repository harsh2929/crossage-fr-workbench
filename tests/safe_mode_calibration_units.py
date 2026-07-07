"""Unit tests for Safe Mode temperature-scaling calibration (res.md Stage 1b).

Temperature scaling (Guo et al. 2017): divide the logits by a single scalar T
before softmax. T=1 leaves the model unchanged; T>1 softens over-confident
probabilities; fit T by minimizing NLL on the user's own labeled local images.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_calibration_units.py
"""

from __future__ import annotations

import math
import os
import sys
import tempfile
from pathlib import Path

from crossage_fr.enroll.manager import ProjectState
from crossage_fr.ingest.safety_calibration import (
    CALIBRATION_T_MAX,
    CALIBRATION_T_MIN,
    apply_temperature,
    fit_temperature,
    temperature_nll,
)
from crossage_fr.ingest import safety as safety_module


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def approx(a: float, b: float, eps: float = 1e-6) -> bool:
    return abs(a - b) < eps


# apply_temperature divides logits by T (T>1 shrinks the spread).
check("apply_temperature divides logits", apply_temperature([2.0, -1.0], 2.0) == [1.0, -0.5])
check("T=1 is identity", apply_temperature([3.0, -2.0], 1.0) == [3.0, -2.0])
check("non-positive T guarded to identity", apply_temperature([3.0, -2.0], 0.0) == [3.0, -2.0])

# temperature_nll: mean negative log-likelihood of the true class under softmax(logits/T).
# Two examples, 2-class [sfw, nsfw] logits; labels 0=sfw, 1=nsfw.
pairs = [[2.0, -2.0], [-2.0, 2.0]]  # confident + correct both
labels = [0, 1]
nll1 = temperature_nll(pairs, labels, 1.0)
check("nll is finite and >= 0", math.isfinite(nll1) and nll1 >= 0.0)
# Over-confident-but-correct: raising T (softening) INCREASES nll here (correct & confident).
check("softening a correct/confident set raises nll", temperature_nll(pairs, labels, 3.0) > nll1)

# Over-confident-and-WRONG set: the model is confidently wrong, so softening (T>1)
# should REDUCE nll — fit_temperature must find a T>1 that beats T=1.
wrong = [[3.0, -3.0], [3.0, -3.0], [-3.0, 3.0], [-3.0, 3.0]]
wrong_labels = [1, 1, 0, 0]  # opposite of what the logits say
t_fit = fit_temperature(wrong, wrong_labels)
check("fit_temperature stays within bounds", CALIBRATION_T_MIN <= t_fit <= CALIBRATION_T_MAX)
check("fit_temperature softens an over-confident/wrong set (T>1)", t_fit > 1.0)
check("fitted T is no worse than T=1", temperature_nll(wrong, wrong_labels, t_fit) <= temperature_nll(wrong, wrong_labels, 1.0) + 1e-9)

# Degenerate inputs → safe default T=1.0.
check("empty data → T=1", approx(fit_temperature([], []), 1.0))
check("single class only → T=1", approx(fit_temperature([[1.0, -1.0], [2.0, -2.0]], [0, 0]), 1.0))
check("mismatched lengths → T=1", approx(fit_temperature([[1.0, -1.0]], [0, 1]), 1.0))


class FakeCalibrationModel:
    def nsfw_logit_pair(self, image) -> list[float]:
        return [-2.0, 2.0] if "sensitive" in str(image) else [2.0, -2.0]


original_load_safety_model = safety_module._load_safety_model
original_load_image = safety_module.load_image
calibration_events: list[dict[str, object]] = []


def fake_load_image(path: Path):
    if "broken" in str(path):
        raise OSError("broken image")
    return path


try:
    safety_module._load_safety_model = lambda: FakeCalibrationModel()
    safety_module.load_image = fake_load_image
    calibration_result = safety_module.calibrate_safety_temperature(
        [
            ("safe-a.jpg", False),
            ("safe-b.jpg", False),
            ("sensitive-a.jpg", True),
            ("sensitive-b.jpg", True),
            ("broken-sensitive.jpg", True),
        ],
        progress=calibration_events.append,
    )
finally:
    safety_module._load_safety_model = original_load_safety_model
    safety_module.load_image = original_load_image

check("calibrate_safety_temperature succeeds with balanced labels", calibration_result["ok"] is True)
check("calibration reports accepted and failed samples", calibration_result["sampleCount"] == 4 and calibration_result["failed"] == 1)
check("calibration emits start and complete progress", calibration_events[0]["phase"] == "started" and calibration_events[-1]["phase"] == "complete")
check("calibration emits per-image processing progress", sum(1 for event in calibration_events if event["phase"] == "processing") == 5)
check("calibration emits per-image processed progress", sum(1 for event in calibration_events if event["phase"] == "processed") == 5)
check("calibration complete progress carries final counts", calibration_events[-1]["accepted"] == 4 and calibration_events[-1]["failed"] == 1)

with tempfile.TemporaryDirectory() as tmp:
    registry = str(Path(tmp) / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
    project = ProjectState(Path(tmp) / "workspace")
    raw_version = project._safety_cache_version()
    project.config.safe_mode_temperature = 2.0
    calibrated_version = project._safety_cache_version()
    check("safe-mode cache key includes temperature", raw_version != calibrated_version and "temperature:2" in calibrated_version)

print("\nall safe-mode-calibration tests passed")

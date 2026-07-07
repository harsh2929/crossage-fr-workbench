"""Unit tests for per-item Safe Mode overrides (the review-dashboard feature).

A user can override the classifier's per-image verdict: mark a false-positive
beach photo as not-sensitive, or force-flag something. The override, when present,
wins over the stored ingest verdict; clearing it falls back to the classifier.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_override_units.py
"""

from __future__ import annotations

import sys

import numpy as np
from PIL import Image

from crossage_fr.ingest import safety as safety_module
from crossage_fr.ingest.safety import apply_safe_mode_override, normalize_override_value


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


# apply_safe_mode_override: an override (True/False) wins; None falls back to stored.
check("no override keeps stored True", apply_safe_mode_override(True, None) is True)
check("no override keeps stored False", apply_safe_mode_override(False, None) is False)
check("override False clears a stored flag", apply_safe_mode_override(True, False) is False)
check("override True flags a stored-safe image", apply_safe_mode_override(False, True) is True)
check("override True over stored True stays True", apply_safe_mode_override(True, True) is True)
check("override False over stored False stays False", apply_safe_mode_override(False, False) is False)

# normalize_override_value: parse a command param into True / False / None(=clear).
check("bool True → True", normalize_override_value(True) is True)
check("bool False → False", normalize_override_value(False) is False)
check("None → None (clear)", normalize_override_value(None) is None)
check("empty string → None", normalize_override_value("") is None)
check("'clear' → None", normalize_override_value("clear") is None)
check("'reset' → None", normalize_override_value("reset") is None)
check("'true' → True", normalize_override_value("true") is True)
check("'sensitive' → True", normalize_override_value("sensitive") is True)
check("'false' → False", normalize_override_value("false") is False)
check("'not_sensitive' → False", normalize_override_value("not_sensitive") is False)
check("1 → True", normalize_override_value(1) is True)
check("0 → False", normalize_override_value(0) is False)
check("unknown text → None", normalize_override_value("banana") is None)

original_copy = Image.Image.copy


def fail_full_size_copy(self: Image.Image) -> Image.Image:
    raise AssertionError("Safe Mode heuristic preview should not copy the full-resolution image")

try:
    Image.Image.copy = fail_full_size_copy  # type: ignore[assignment]
    prepared = safety_module._prepare(Image.new("RGB", (2400, 1600), (120, 140, 170)))
finally:
    Image.Image.copy = original_copy  # type: ignore[assignment]

check("heuristic prepare avoids full-size copy", prepared.mode == "RGB" and max(prepared.size) <= 160)

original_cv2 = sys.modules.get("cv2")
original_cv2_present = "cv2" in sys.modules
original_cv2_available = safety_module._CV2_CONNECTED_COMPONENTS_AVAILABLE


class FakeCv2:
    CC_STAT_AREA = 4
    calls = 0

    @staticmethod
    def connectedComponentsWithStats(image, connectivity=8):
        FakeCv2.calls += 1
        check("connected components uses 4-neighbor connectivity", connectivity == 4)
        check("connected components receives uint8 mask", image.dtype == np.uint8)
        stats = np.asarray(
            [
                [0, 0, 0, 0, 18],
                [0, 0, 0, 0, 3],
                [0, 0, 0, 0, 4],
            ],
            dtype=np.int32,
        )
        return 3, None, stats, None


try:
    sys.modules["cv2"] = FakeCv2
    safety_module._CV2_CONNECTED_COMPONENTS_AVAILABLE = None
    ratio = safety_module._largest_region_ratio(np.ones((5, 5), dtype=bool))
finally:
    if original_cv2_present:
        sys.modules["cv2"] = original_cv2  # type: ignore[assignment]
    else:
        sys.modules.pop("cv2", None)
    safety_module._CV2_CONNECTED_COMPONENTS_AVAILABLE = original_cv2_available

check("largest skin region uses connected components fast path", FakeCv2.calls == 1 and ratio == 4 / 25)

original_largest_region_ratio = safety_module._largest_region_ratio


def fail_largest_region(_mask) -> float:
    raise AssertionError("Sparse Safe Mode masks should skip connected-component flood fill")

try:
    safety_module._largest_region_ratio = fail_largest_region  # type: ignore[assignment]
    benign = safety_module._assess_image_safety_heuristic(
        Image.new("RGB", (512, 512), (120, 150, 190)),
        threshold=0.58,
    )
finally:
    safety_module._largest_region_ratio = original_largest_region_ratio  # type: ignore[assignment]

check("sparse skin masks skip region flood fill", benign.largest_region_ratio == 0.0)

region_calls = 0


def record_largest_region(_mask) -> float:
    global region_calls
    region_calls += 1
    return 0.75

try:
    safety_module._largest_region_ratio = record_largest_region  # type: ignore[assignment]
    dense = safety_module._assess_image_safety_heuristic(
        Image.new("RGB", (512, 512), (210, 160, 130)),
        threshold=0.58,
    )
finally:
    safety_module._largest_region_ratio = original_largest_region_ratio  # type: ignore[assignment]

check("dense skin masks still measure region size", region_calls == 1 and dense.largest_region_ratio == 0.75)

print("\nall safe-mode-override tests passed")

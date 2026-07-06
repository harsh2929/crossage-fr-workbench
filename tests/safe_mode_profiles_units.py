"""Unit tests for Safe Mode threshold profiles (res.md Stage 1a).

Three tunable operating points — privacy-first (high recall), balanced, and
permissive (high precision) — plus a "custom" escape hatch, so users can move
the Safe Mode operating point instead of being stuck at one threshold.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_profiles_units.py
"""

from __future__ import annotations

import sys

from crossage_fr.config import (
    SAFE_MODE_PROFILES,
    normalize_safe_mode_profile,
    safe_mode_threshold_for_profile,
)


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def approx(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) < eps


# The three named profiles exist with res.md's starting thresholds.
check("privacy profile = 0.30", approx(SAFE_MODE_PROFILES["privacy"], 0.30))
check("balanced profile = 0.50", approx(SAFE_MODE_PROFILES["balanced"], 0.50))
check("permissive profile = 0.85", approx(SAFE_MODE_PROFILES["permissive"], 0.85))
check("privacy < balanced < permissive (aggressive→lenient)",
      SAFE_MODE_PROFILES["privacy"] < SAFE_MODE_PROFILES["balanced"] < SAFE_MODE_PROFILES["permissive"])

# normalize_safe_mode_profile: valid names pass through; anything else → balanced.
check("normalize keeps 'privacy'", normalize_safe_mode_profile("privacy") == "privacy")
check("normalize keeps 'permissive'", normalize_safe_mode_profile("permissive") == "permissive")
check("normalize keeps 'custom'", normalize_safe_mode_profile("custom") == "custom")
check("normalize is case/space tolerant", normalize_safe_mode_profile("  Privacy ") == "privacy")
check("normalize falls back to balanced on junk", normalize_safe_mode_profile("nonsense") == "balanced")
check("normalize falls back to balanced on empty", normalize_safe_mode_profile("") == "balanced")
check("normalize falls back to balanced on None", normalize_safe_mode_profile(None) == "balanced")

# safe_mode_threshold_for_profile: named profiles ignore the custom value.
check("privacy → 0.30", approx(safe_mode_threshold_for_profile("privacy", 0.9), 0.30))
check("balanced → 0.50", approx(safe_mode_threshold_for_profile("balanced", 0.9), 0.50))
check("permissive → 0.85", approx(safe_mode_threshold_for_profile("permissive", 0.1), 0.85))

# "custom" uses the caller-supplied threshold (clamped to [0,1]).
check("custom uses supplied threshold", approx(safe_mode_threshold_for_profile("custom", 0.62), 0.62))
check("custom clamps > 1", approx(safe_mode_threshold_for_profile("custom", 5.0), 1.0))
check("custom clamps < 0", approx(safe_mode_threshold_for_profile("custom", -1.0), 0.0))
check("custom with no value → balanced threshold", approx(safe_mode_threshold_for_profile("custom", None), 0.50))

# Unknown profile normalizes to balanced first.
check("junk profile → balanced threshold", approx(safe_mode_threshold_for_profile("junk", 0.9), 0.50))

print("\nall safe-mode-profile tests passed")

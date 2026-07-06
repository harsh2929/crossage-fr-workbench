"""Unit tests for multi-level Safe Mode scoring (Freepik EVA-02 support).

Freepik's nsfw_image_detector is a 4-level classifier (neutral < low < medium <
high), not a 2-class softmax. These helpers turn its ordered level probabilities
into (a) a single "sensitive" probability for the gate — the mass at/above a
chosen minimum level — and (b) the dominant level, so the UI can separate
"suggestive" (low/medium) from "explicit" (high).

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_levels_units.py
"""

from __future__ import annotations

import sys

from crossage_fr.ingest.safety import (
    dominant_level,
    nsfw_probability_from_levels,
)


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def approx(a: float, b: float, eps: float = 1e-9) -> bool:
    return abs(a - b) < eps


LEVELS = ("neutral", "low", "medium", "high")
PROBS = [0.1, 0.2, 0.3, 0.4]

# Sensitive probability = mass at/above the chosen minimum level (ordered).
check("min=medium sums medium+high", approx(nsfw_probability_from_levels(PROBS, LEVELS, "medium"), 0.7))
check("min=low sums low+medium+high", approx(nsfw_probability_from_levels(PROBS, LEVELS, "low"), 0.9))
check("min=high sums only high", approx(nsfw_probability_from_levels(PROBS, LEVELS, "high"), 0.4))
check("min=neutral sums everything", approx(nsfw_probability_from_levels(PROBS, LEVELS, "neutral"), 1.0))

# Unknown / empty min level → treat only the most-severe level as sensitive.
check("unknown min → most-severe level only", approx(nsfw_probability_from_levels(PROBS, LEVELS, "bogus"), 0.4))
check("empty min → most-severe level only", approx(nsfw_probability_from_levels(PROBS, LEVELS, ""), 0.4))

# Guards.
check("empty probs → 0", approx(nsfw_probability_from_levels([], LEVELS, "medium"), 0.0))
check("mismatched lengths → 0", approx(nsfw_probability_from_levels([0.5, 0.5], LEVELS, "medium"), 0.0))

# Dominant level = argmax.
check("dominant is high", dominant_level([0.1, 0.2, 0.3, 0.4], LEVELS) == "high")
check("dominant is neutral", dominant_level([0.7, 0.1, 0.1, 0.1], LEVELS) == "neutral")
check("dominant empty on mismatch", dominant_level([0.5], LEVELS) == "")

print("\nall safe-mode-level tests passed")

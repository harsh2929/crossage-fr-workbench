"""Unit tests for per-item Safe Mode overrides (the review-dashboard feature).

A user can override the classifier's per-image verdict: mark a false-positive
beach photo as not-sensitive, or force-flag something. The override, when present,
wins over the stored ingest verdict; clearing it falls back to the classifier.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/safe_mode_override_units.py
"""

from __future__ import annotations

import sys

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

print("\nall safe-mode-override tests passed")

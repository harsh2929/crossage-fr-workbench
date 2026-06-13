"""MS-1: a single resolver for environment configuration.

The product is mid-rename from ``CROSSAGE_*`` to ``VINTRACE_*``. The rename was
only half done: several safety-critical toggles (force-fallback, the Safe-Mode
engine selector, the Safe-Mode model path) were still read by their legacy name
only, so an operator who set the documented new ``VINTRACE_*`` name had it
silently ignored. Route env reads through :func:`env_value` / :func:`env_flag`
so every key supports both names under one precedence rule:

    VINTRACE_<NAME>  (canonical)  ->  CROSSAGE_<NAME>  (legacy)  ->  default

Pass the bare suffix, e.g. ``env_value("SAFE_MODE_ENGINE")``.
"""

from __future__ import annotations

import os

CANONICAL_PREFIX = "VINTRACE_"
LEGACY_PREFIX = "CROSSAGE_"


def env_value(name: str, *, default: str | None = None) -> str | None:
    """Resolve a config value by canonical name, then legacy alias, then default."""
    canonical = os.environ.get(f"{CANONICAL_PREFIX}{name}")
    if canonical is not None:
        return canonical
    legacy = os.environ.get(f"{LEGACY_PREFIX}{name}")
    if legacy is not None:
        return legacy
    return default


def env_flag(name: str, *, default: bool = False) -> bool:
    """Boolean form of :func:`env_value` ("1" is true; anything else is false)."""
    value = env_value(name)
    if value is None:
        return default
    return value.strip() == "1"

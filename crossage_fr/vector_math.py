from __future__ import annotations

from typing import Any

import numpy as np


def l2_normalize(
    values: Any,
    *,
    axis: int | None = None,
    dtype: str | np.dtype = np.float32,
    eps: float = 0.0,
) -> np.ndarray:
    """Return L2-normalized vectors with one degenerate-input convention.

    Zero-norm, tiny-norm, and non-finite vectors normalize to zeros instead of
    propagating NaNs/Infs or relying on each caller to invent its own fallback.
    """
    arr = np.asarray(values, dtype=dtype)
    norms = np.linalg.norm(arr, axis=axis, keepdims=axis is not None)
    valid = np.isfinite(norms) & (norms > float(eps))
    safe_norms = np.where(valid, norms, 1.0)
    normalized = arr / safe_norms
    return np.where(valid, normalized, 0.0).astype(dtype, copy=False)

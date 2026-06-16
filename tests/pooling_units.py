"""Unit tests for self-consistency template pooling + sharpness keyframe selection (§5.3).

Run: PYTHONPATH=. .venv/bin/python tests/pooling_units.py
"""

from __future__ import annotations

import numpy as np

from crossage_fr.match.pooling import (
    pool_template,
    self_consistency_weights,
    template_cosine,
    weak_pooled_support,
)
from crossage_fr.ingest.video_io import sharpest_index, variance_of_laplacian


def _unit(*active_then_value) -> list[float]:
    vec = [0.0] * 8
    for idx, val in active_then_value:
        vec[idx] = val
    return vec


def test_pool_template_of_identical_vectors_is_that_vector() -> None:
    v = _unit((0, 3.0), (1, 4.0))  # not unit; pooling should L2-normalize
    tpl = pool_template([v, v, v])
    assert abs(float(np.linalg.norm(tpl)) - 1.0) < 1e-6
    assert abs(tpl[0] - 0.6) < 1e-6 and abs(tpl[1] - 0.8) < 1e-6


def test_pool_template_downweights_an_outlier_vs_naive_mean() -> None:
    inlier = _unit((0, 1.0))                 # cluster direction
    vectors = [inlier] * 5 + [_unit((1, 1.0))]  # 5 inliers + 1 orthogonal outlier
    pooled = np.asarray(pool_template(vectors), dtype="float64")
    naive = np.asarray(vectors, dtype="float64")
    naive_mean = naive.mean(axis=0)
    naive_mean = naive_mean / np.linalg.norm(naive_mean)
    target = np.asarray(inlier, dtype="float64")
    # Self-consistency pooling lands CLOSER to the true cluster than the outlier-pulled mean.
    assert float(pooled @ target) > float(naive_mean @ target)


def test_self_consistency_weights_rank_outlier_lowest() -> None:
    inlier = _unit((0, 1.0))
    weights = self_consistency_weights([inlier, inlier, inlier, _unit((1, 1.0))])
    assert weights[-1] < min(weights[:3])  # the orthogonal outlier agrees least


def test_variance_of_laplacian_and_sharpest_index() -> None:
    rng = np.random.default_rng(0)
    blurred = np.full((32, 32), 128.0)                       # flat -> ~0 high-freq energy
    sharp = (rng.integers(0, 2, size=(32, 32)) * 255).astype("float64")  # checkerboard-ish
    assert variance_of_laplacian(sharp) > variance_of_laplacian(blurred)
    assert sharpest_index([blurred, sharp, blurred]) == 1


def test_weak_pooled_support_flags_outlier_lean() -> None:
    # Strong match to a best ref (0.55) but weak agreement with the robust template
    # (0.30) -> leaned on an outlier crop -> flagged.
    assert weak_pooled_support(0.55, 0.30, drop=0.10) is True
    # Match agrees with the template -> not flagged.
    assert weak_pooled_support(0.55, 0.52, drop=0.10) is False
    # No template available (cosine 0) -> degrade-safe, never flags.
    assert weak_pooled_support(0.55, 0.0) is False


def test_template_cosine_basic() -> None:
    tpl = pool_template([_unit((0, 1.0))] * 3)  # template ~ [1,0,0,...]
    assert abs(template_cosine(_unit((0, 2.0)), tpl) - 1.0) < 1e-6   # same direction
    assert abs(template_cosine(_unit((1, 2.0)), tpl)) < 1e-6         # orthogonal


def main() -> None:
    test_pool_template_of_identical_vectors_is_that_vector()
    test_pool_template_downweights_an_outlier_vs_naive_mean()
    test_self_consistency_weights_rank_outlier_lowest()
    test_variance_of_laplacian_and_sharpest_index()
    test_weak_pooled_support_flags_outlier_lean()
    test_template_cosine_basic()
    print("pooling units ok")


if __name__ == "__main__":
    main()

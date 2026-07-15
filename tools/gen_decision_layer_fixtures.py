"""Generate golden conformance fixtures for the TypeScript decision-layer port.

The mobile app re-implements the desktop's decision layer (crossage_fr/match) in TypeScript so
the phone can re-band, re-threshold, and re-rank matches offline. That port must match the Python
reference exactly. This script drives the REAL reference over a spread of inputs and dumps
(input -> output) pairs; the TS conformance test replays them and asserts equality within a tiny
float epsilon.

Deterministic (fixed seed) so the fixture is stable and reviewable.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tools/gen_decision_layer_fixtures.py
"""

from __future__ import annotations

import json
import random
from pathlib import Path

from crossage_fr.config import Thresholds
from crossage_fr.match.age_gap import (
    compute_age_gap,
    confidence_for_gap,
    review_threshold_for_gap,
)
from crossage_fr.match.calibration import (
    AdaptiveLinearCalibrator,
    CohortNormalizer,
    PlattCalibrator,
    as_norm_score,
    fuse_scores,
    normalized_pair_center,
)
from crossage_fr.match.scoring import band_for_score, thresholds_for_pose
from crossage_fr.vector_math import l2_normalize

OUT = Path("mobile-app/packages/decision-layer/fixtures/decision-layer-golden.json")

RNG = random.Random(20260714)


def _vec(n: int) -> list[float]:
    return [RNG.uniform(-1.0, 1.0) for _ in range(n)]


def main() -> None:
    cases: dict[str, list] = {}

    # --- sigmoid via Platt (covers the clip and the logistic) ---
    cases["platt"] = []
    for a, b in [(1.0, 0.0), (8.0, -3.0), (-2.5, 1.2), (100.0, -50.0), (0.0, 0.0)]:
        for score in [-2.0, -0.3, 0.0, 0.25, 0.4, 0.9, 5.0]:
            cases["platt"].append(
                {"a": a, "b": b, "score": score, "out": PlattCalibrator(a, b).probability(score)}
            )

    # --- fuse_scores (uniform + weighted + degenerate) ---
    cases["fuse"] = []
    for scores, weights in [
        ([0.4, 0.6], None),
        ([0.1, 0.2, 0.9], [1.0, 2.0, 0.0]),
        ([0.5], [0.0]),
        ([], None),
        ([0.3, 0.7], [-1.0, -1.0]),
    ]:
        cases["fuse"].append(
            {"scores": scores, "weights": weights, "out": fuse_scores(scores, weights)}
        )

    # --- as_norm_score (z vs top-K cohort, sigma floor) ---
    cases["asNorm"] = []
    for raw in [0.1, 0.35, 0.7]:
        for cohort in [[], [0.2], [0.1, 0.15, 0.2, 0.25, 0.3, 0.05], [0.5, 0.5, 0.5]]:
            for k in [3, 10]:
                cases["asNorm"].append(
                    {
                        "raw": raw,
                        "cohort": cohort,
                        "topK": k,
                        "out": as_norm_score(raw, cohort, top_k=k),
                    }
                )

    # --- l2_normalize (1-D, float64 to match the cohort path) ---
    cases["l2normalize"] = []
    for v in [_vec(4), [0.0, 0.0, 0.0], _vec(8), [1e-20, 0.0], _vec(16)]:
        out = l2_normalize(v, dtype="float64").tolist()
        cases["l2normalize"].append({"vector": v, "out": out})

    # --- CohortNormalizer.normalize + normalize_pair ---
    cases["cohortNormalizer"] = []
    cohort_vectors = [_vec(8) for _ in range(12)]
    for _ in range(6):
        probe = _vec(8)
        ref = _vec(8)
        raw = RNG.uniform(0.0, 0.8)
        norm = CohortNormalizer(cohort_vectors)
        cases["cohortNormalizer"].append(
            {
                "cohort": cohort_vectors,
                "probe": probe,
                "reference": ref,
                "raw": raw,
                "topK": 10,
                "pairTopK": 20,
                "normalize": norm.normalize(probe, raw, top_k=10),
                "normalizePair": norm.normalize_pair(probe, ref, raw, top_k=20),
                "scores": norm.scores(probe).tolist(),
            }
        )

    # --- normalized_pair_center (float64 output for exact compare) ---
    cases["pairCenter"] = []
    for _ in range(5):
        left = _vec(8)
        right = _vec(8)
        out = normalized_pair_center(left, right, dtype="float64")
        cases["pairCenter"].append(
            {"left": left, "right": right, "out": None if out is None else out.tolist()}
        )
    # degenerate: opposite unit vectors -> center norm ~0 -> None
    cases["pairCenter"].append(
        {"left": [1.0, 0.0], "right": [-1.0, 0.0], "out": None}
    )

    # --- AdaptiveLinearCalibrator round-trip + probability ---
    cases["adaptive"] = []
    for dim in [8, 16]:
        weights = tuple(_vec(dim)) + (RNG.uniform(0.1, 3.0),)  # last weight > 0 (monotonic in cosine)
        payload = AdaptiveLinearCalibrator(
            weights=weights, bias=RNG.uniform(-1.0, 1.0), model_name="fixture", input_count=100,
            positive_count=40, negative_count=60,
        ).to_payload()
        calib = AdaptiveLinearCalibrator.from_payload(payload)
        for _ in range(4):
            center = _vec(dim)
            raw = RNG.uniform(0.0, 0.9)
            cases["adaptive"].append(
                {"payload": payload, "center": center, "raw": raw, "out": calib.probability(center, raw)}
            )

    # --- age gap ---
    cases["ageGap"] = []
    date_pairs = [
        ("2020-06-01", "2018-06-01", "exif", "exif"),
        ("2020-06-01", "2014-06-01", "exif", "exif"),
        ("2020-06-01", "2010-06-01", "exif", "exif"),
        ("2020-06-01", "2019-01-01", "exif", "mtime"),
        ("bad", "2019-01-01", "exif", "exif"),
        ("2020:06:01 12:00:00", "2016-06-01T00:00:00", "exif", "exif"),
        (None, "2019-01-01", "exif", "exif"),
    ]
    for cand, ref, cp, rp in date_pairs:
        years, band, flag = compute_age_gap(cand, ref, candidate_provenance=cp, reference_provenance=rp)
        cases["ageGap"].append(
            {
                "candidateDate": cand,
                "referenceDate": ref,
                "candidateProvenance": cp,
                "referenceProvenance": rp,
                "years": years,
                "confidence": band,
                "flag": flag,
            }
        )

    cases["confidenceForGap"] = [
        {"years": y, "out": confidence_for_gap(y)} for y in [0.0, 2.0, 2.01, 4.0, 5.9, 6.0, 6.01, 12.0, -7.0]
    ]

    cases["reviewThreshold"] = []
    for base in [0.20, 0.28]:
        for years, conf in [(None, None), (3.0, "moderate"), (5.0, "low"), (7.0, "very-low"), (6.5, "very-low")]:
            cases["reviewThreshold"].append(
                {"base": base, "years": years, "confidence": conf, "out": review_threshold_for_gap(base, years, conf)}
            )

    # --- bands + pose thresholds ---
    default_t = Thresholds()
    t_dict = {"confident": default_t.confident, "likely": default_t.likely,
              "relaxed_child": default_t.relaxed_child, "quality_min": default_t.quality_min}
    cases["bandForScore"] = [
        {"score": s, "thresholds": t_dict, "out": band_for_score(s, default_t)}
        for s in [0.5, 0.4, 0.39, 0.28, 0.2, 0.19, 0.0]
    ]
    cases["thresholdsForPose"] = []
    for pose in ["frontal", "profile", "edge-face", "three-quarter", "unknown", "three_quarter"]:
        out = thresholds_for_pose(default_t, pose)
        cases["thresholdsForPose"].append(
            {"thresholds": t_dict, "pose": pose,
             "out": {"confident": out.confident, "likely": out.likely,
                     "relaxed_child": out.relaxed_child, "quality_min": out.quality_min}}
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(cases, indent=2, sort_keys=True) + "\n")
    total = sum(len(v) for v in cases.values())
    print(f"wrote {OUT} with {total} golden cases across {len(cases)} groups")


if __name__ == "__main__":
    main()

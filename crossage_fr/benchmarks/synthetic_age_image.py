from __future__ import annotations

from datetime import datetime
from typing import Any, Iterable
import hashlib
import json
import math


SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION = "synthetic-age-image-eval-v1"
SYNTHETIC_AGE_IMAGE_REVIEW_SCHEMA_VERSION = 1
_AGE_BUCKETS = {"child", "adolescent", "adult", "older-adult", "senior"}


def benchmark_case_id(
    dataset_id: str,
    source_hash: str,
    candidate_hash: str,
    target_age_bucket: str,
) -> str:
    body = "\0".join(
        (
            SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION,
            str(dataset_id).strip().casefold(),
            str(source_hash).strip().casefold(),
            str(candidate_hash).strip().casefold(),
            str(target_age_bucket).strip().casefold(),
        )
    )
    return "ageimg_case_" + hashlib.sha256(body.encode("utf-8")).hexdigest()[:24]


def _finite_vector(value: Any) -> list[float]:
    if not isinstance(value, (list, tuple)) or not value:
        raise ValueError("Benchmark vectors must be nonempty lists.")
    vector = [float(item) for item in value]
    if not all(math.isfinite(item) for item in vector):
        raise ValueError("Benchmark vectors must contain only finite values.")
    norm = math.sqrt(sum(item * item for item in vector))
    if norm <= 1e-12:
        raise ValueError("Benchmark vectors must have a nonzero norm.")
    return [item / norm for item in vector]


def cosine_similarity(left: Any, right: Any) -> float:
    a = _finite_vector(left)
    b = _finite_vector(right)
    if len(a) != len(b):
        raise ValueError("Benchmark vector dimensions must match.")
    return float(sum(x * y for x, y in zip(a, b, strict=True)))


def evaluate_gallery(
    cases: Iterable[dict[str, Any]],
    references: Iterable[dict[str, Any]],
    *,
    threshold: float,
) -> dict[str, Any]:
    safe_threshold = float(threshold)
    if not math.isfinite(safe_threshold) or not -1.0 <= safe_threshold <= 1.0:
        raise ValueError("The benchmark threshold must be a finite cosine in [-1, 1].")
    refs = list(references)
    if not refs:
        raise ValueError("The benchmark gallery must contain at least one reference.")
    normalized_refs: list[dict[str, Any]] = []
    ref_ids: set[str] = set()
    dimension = 0
    for raw in refs:
        ref_id = str(raw.get("refId", "") or "").strip()
        person = str(raw.get("personName", "") or "").strip()
        if not ref_id or ref_id in ref_ids or not person:
            raise ValueError("Benchmark references require unique IDs and person names.")
        vector = _finite_vector(raw.get("vector"))
        dimension = dimension or len(vector)
        if len(vector) != dimension:
            raise ValueError("All benchmark references must use one vector dimension.")
        ref_ids.add(ref_id)
        normalized_refs.append(
            {
                "refId": ref_id,
                "personName": person,
                "vector": vector,
                "generated": bool(raw.get("generated", False)),
            }
        )

    labels: list[dict[str, Any]] = []
    case_ids: set[str] = set()
    counts = {
        "truePositives": 0,
        "falsePositives": 0,
        "trueNegatives": 0,
        "falseNegatives": 0,
        "wrongIdentity": 0,
        "generatedBestTruePositives": 0,
    }
    for raw in cases:
        case_id = str(raw.get("caseId", "") or "").strip()
        if not case_id or case_id in case_ids:
            raise ValueError("Benchmark cases require unique case IDs.")
        case_ids.add(case_id)
        candidate = _finite_vector(raw.get("candidateVector"))
        if len(candidate) != dimension:
            raise ValueError("Candidate and reference vector dimensions must match.")
        expected_person = str(raw.get("expectedPerson", "") or "").strip()
        expected_match = bool(raw.get("expectedMatch", bool(expected_person)))
        if expected_match != bool(expected_person):
            raise ValueError("Positive cases require an expected person; negative cases must not name one.")
        ranked = sorted(
            (
                (float(sum(x * y for x, y in zip(candidate, ref["vector"], strict=True))), ref)
                for ref in normalized_refs
            ),
            key=lambda item: (-item[0], item[1]["refId"]),
        )
        best_score, best_ref = ranked[0]
        predicted = best_score >= safe_threshold
        actual_person = best_ref["personName"] if predicted else ""
        correct_identity = predicted and expected_match and actual_person == expected_person
        if correct_identity:
            outcome = "true-positive"
            counts["truePositives"] += 1
            if best_ref["generated"]:
                counts["generatedBestTruePositives"] += 1
        elif expected_match and predicted:
            outcome = "wrong-identity"
            counts["wrongIdentity"] += 1
            counts["falsePositives"] += 1
            counts["falseNegatives"] += 1
        elif expected_match:
            outcome = "false-negative"
            counts["falseNegatives"] += 1
        elif predicted:
            outcome = "false-positive"
            counts["falsePositives"] += 1
        else:
            outcome = "true-negative"
            counts["trueNegatives"] += 1
        labels.append(
            {
                "caseId": case_id,
                "expectedMatch": expected_match,
                "expectedPerson": expected_person,
                "actualPerson": actual_person,
                "outcome": outcome,
                "score": round(best_score, 8),
                "bestReferenceId": best_ref["refId"] if predicted else "",
                "bestReferenceGenerated": bool(predicted and best_ref["generated"]),
            }
        )
    precision = counts["truePositives"] / max(1, counts["truePositives"] + counts["falsePositives"])
    recall = counts["truePositives"] / max(1, counts["truePositives"] + counts["falseNegatives"])
    return {
        "threshold": safe_threshold,
        "evaluated": len(labels),
        **counts,
        "precision": round(precision, 8),
        "recall": round(recall, 8),
        "labels": labels,
    }


def compare_galleries(baseline: dict[str, Any], augmented: dict[str, Any]) -> dict[str, Any]:
    before = {str(row.get("caseId", "")): row for row in baseline.get("labels", []) if isinstance(row, dict)}
    after = {str(row.get("caseId", "")): row for row in augmented.get("labels", []) if isinstance(row, dict)}
    if not before or set(before) != set(after):
        raise ValueError("Baseline and augmented galleries must evaluate the same nonempty case set.")
    improvements: list[str] = []
    regressions: list[str] = []
    genuine_score_deltas: list[float] = []
    nonmatch_score_deltas: list[float] = []
    for case_id in sorted(before):
        left = before[case_id]
        right = after[case_id]
        left_correct = left.get("outcome") in {"true-positive", "true-negative"}
        right_correct = right.get("outcome") in {"true-positive", "true-negative"}
        if not left_correct and right_correct:
            improvements.append(case_id)
        elif left_correct and not right_correct:
            regressions.append(case_id)
        delta = float(right.get("score", 0.0) or 0.0) - float(left.get("score", 0.0) or 0.0)
        (genuine_score_deltas if bool(left.get("expectedMatch")) else nonmatch_score_deltas).append(delta)
    return {
        "evaluated": len(before),
        "improvements": len(improvements),
        "regressions": len(regressions),
        "improvementCaseIds": improvements,
        "regressionCaseIds": regressions,
        "precisionDelta": round(float(augmented.get("precision", 0.0)) - float(baseline.get("precision", 0.0)), 8),
        "recallDelta": round(float(augmented.get("recall", 0.0)) - float(baseline.get("recall", 0.0)), 8),
        "genuineScoreImproved": sum(value > 1e-8 for value in genuine_score_deltas),
        "genuineScoreRegressed": sum(value < -1e-8 for value in genuine_score_deltas),
        "meanGenuineScoreDelta": round(sum(genuine_score_deltas) / max(1, len(genuine_score_deltas)), 8),
        "nonmatchScoreIncreased": sum(value > 1e-8 for value in nonmatch_score_deltas),
        "meanNonmatchScoreDelta": round(sum(nonmatch_score_deltas) / max(1, len(nonmatch_score_deltas)), 8),
    }


def validate_review_manifest(
    manifest: dict[str, Any],
    staged_cases: Iterable[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    if int(manifest.get("schemaVersion", 0) or 0) != SYNTHETIC_AGE_IMAGE_REVIEW_SCHEMA_VERSION:
        raise ValueError("The synthetic age-image review manifest schema is unsupported.")
    if manifest.get("benchmarkVersion") != SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION:
        raise ValueError("The synthetic age-image review manifest targets another benchmark version.")
    reviewer = str(manifest.get("reviewer", "") or "").strip()
    reviewed_at = str(manifest.get("reviewedAt", "") or "").strip()
    if not reviewer or len(reviewer) > 200:
        raise ValueError("The review manifest requires a named reviewer.")
    try:
        datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("The review manifest requires a valid reviewedAt timestamp.") from exc
    raw_decisions = manifest.get("decisions")
    if not isinstance(raw_decisions, list):
        raise ValueError("The review manifest decisions must be a list.")
    expected: dict[str, dict[str, Any]] = {}
    for case in staged_cases:
        case_id = str(case.get("caseId", "") or "").strip()
        artifact_id = str(case.get("artifactId", "") or "").strip()
        generated_hash = str(case.get("generatedHash", "") or "").strip().casefold()
        target = str(case.get("targetAgeBucket", "") or "").strip().casefold()
        if not case_id or not artifact_id or len(generated_hash) != 64 or target not in _AGE_BUCKETS:
            raise ValueError("A staged benchmark case has incomplete review binding metadata.")
        if case_id in expected:
            raise ValueError("Staged benchmark case IDs must be unique.")
        expected[case_id] = {
            "artifactId": artifact_id,
            "generatedHash": generated_hash,
            "targetAgeBucket": target,
        }
    decisions: dict[str, dict[str, Any]] = {}
    for raw in raw_decisions:
        if not isinstance(raw, dict):
            raise ValueError("Every review decision must be an object.")
        case_id = str(raw.get("caseId", "") or "").strip()
        if case_id not in expected or case_id in decisions:
            raise ValueError("Review decisions must map one-to-one to staged benchmark cases.")
        binding = expected[case_id]
        if str(raw.get("artifactId", "") or "") != binding["artifactId"]:
            raise ValueError("A review decision artifact ID does not match the staged case.")
        if str(raw.get("generatedSha256", "") or "").casefold() != binding["generatedHash"]:
            raise ValueError("A review decision hash does not match the staged image.")
        decision = str(raw.get("decision", "") or "").strip().casefold()
        if decision not in {"approve", "reject"}:
            raise ValueError("Review decisions must be approve or reject.")
        reason = str(raw.get("reason", "") or "").strip()
        if decision == "approve":
            perceived = str(raw.get("perceivedAgeBucket", "") or "").strip().casefold()
            checks = {
                "singlePerson": raw.get("singlePerson") is True,
                "identityPreserved": raw.get("identityPreserved") is True,
                "targetAgePlausible": raw.get("targetAgePlausible") is True,
                "visualArtifactsAcceptable": raw.get("visualArtifactsAcceptable") is True,
                "targetBucketMatches": perceived == binding["targetAgeBucket"],
            }
            if not all(checks.values()):
                raise ValueError("Approved age images require every visual check and the expected perceived age range.")
        elif not reason:
            raise ValueError("Rejected age images require a reason.")
        decisions[case_id] = {
            **raw,
            "caseId": case_id,
            "artifactId": binding["artifactId"],
            "generatedSha256": binding["generatedHash"],
            "decision": decision,
            "reviewer": reviewer,
            "reviewedAt": reviewed_at,
            "reason": reason[:500],
        }
    if set(decisions) != set(expected):
        raise ValueError("The review manifest must decide every staged benchmark case.")
    return decisions


def review_manifest_template(staged_cases: Iterable[dict[str, Any]]) -> dict[str, Any]:
    decisions = []
    for case in staged_cases:
        decisions.append(
            {
                "caseId": str(case.get("caseId", "") or ""),
                "artifactId": str(case.get("artifactId", "") or ""),
                "generatedSha256": str(case.get("generatedHash", "") or ""),
                "decision": "",
                "singlePerson": None,
                "identityPreserved": None,
                "targetAgePlausible": None,
                "perceivedAgeBucket": "",
                "visualArtifactsAcceptable": None,
                "reason": "",
            }
        )
    return {
        "schemaVersion": SYNTHETIC_AGE_IMAGE_REVIEW_SCHEMA_VERSION,
        "benchmarkVersion": SYNTHETIC_AGE_IMAGE_BENCHMARK_VERSION,
        "reviewer": "",
        "reviewedAt": "",
        "instructions": (
            "Compare each private source, generated, and target image. Approve only one-person outputs that preserve identity, "
            "visibly match the target age range, and have no unacceptable artifacts. Rejections require a reason."
        ),
        "decisions": decisions,
    }


def canonical_json_sha256(value: dict[str, Any]) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()

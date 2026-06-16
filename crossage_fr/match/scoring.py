from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any
import math

from crossage_fr.config import Thresholds
from crossage_fr.match.age_gap import compute_age_gap
from crossage_fr.match.calibration import as_norm_score
from crossage_fr.match.pooling import weak_pooled_support
from crossage_fr.models import ReferenceFace, ReviewCandidate
from crossage_fr.store import SearchHit


POSE_REVIEW_DELTAS = {
    "profile": 0.08,
    "edge-face": 0.08,
    "three-quarter": 0.04,
}
POSE_REVIEW_MINIMUM = 0.12
AMBIGUOUS_PERSON_MARGIN = 0.025
CLOSE_PERSON_MARGIN = 0.055
SINGLE_REFERENCE_MARGIN = 0.035
# Phase 1.3: below this calibrated crop quality, a match may surface for review but
# must not be auto-"confident" off a single bad crop. Deliberately conservative and
# precision-only: it NEVER touches the cross-age relaxed band, so recall is unchanged.
LOW_QUALITY_CONFIDENT_FLOOR = 0.25
# Phase-4 (2): above this normalized alignment residual the recognizer crop is built
# from bad landmarks / extreme pose and must not yield an auto-"confident" match.
# Precision-only and cross-age-SAFE: it never touches the relaxed band (cross-age
# faces are often the hardest to align, so penalizing them would cut the very recall
# the product exists for). Conservative default; only clearly-broken geometry fires.
ALIGNMENT_SUSPECT_THRESHOLD = 0.15


def _demote_alignment_suspect(
    decision: MatchDecision, thresholds: Thresholds, candidate_align_error: float | None
) -> MatchDecision:
    if candidate_align_error is None or candidate_align_error <= ALIGNMENT_SUSPECT_THRESHOLD:
        return decision
    if decision.band != "confident":
        return decision
    demoted_score = min(decision.score, thresholds.confident - 1e-4)
    return replace(
        decision,
        score=float(demoted_score),
        band=band_for_score(float(demoted_score), thresholds),
        flags=tuple(dict.fromkeys((*decision.flags, "alignment-suspect"))),
    )
# Phase 2.1: makes the enrolled age_bucket / capture_date OPERATIVE at match time. A
# small ADDITIVE confidence boost when a same-era reference supports the match (e.g. a
# child query supported by a child reference), so a true match is less likely to lose
# to a different-age lookalike. Strictly additive + degrade-to-current when dates are
# missing, so it can never reduce recall (incl. for genuine cross-age pairs).
AGE_CONSISTENT_NEAR_YEARS = 3.0
AGE_CONSISTENT_BONUS = 0.006


def _apply_age_consistency(
    decision: MatchDecision,
    grouped: dict[str, dict[str, object]],
    thresholds: Thresholds,
    candidate_capture_date: str | None,
) -> MatchDecision:
    if candidate_capture_date is None:
        return decision
    row = grouped.get(decision.person_name)
    if not isinstance(row, dict):
        return decision
    hit_refs = row.get("hit_refs", [])
    if not isinstance(hit_refs, list):
        return decision
    for hit, ref in hit_refs[:5]:
        if not isinstance(hit, SearchHit) or not isinstance(ref, ReferenceFace):
            continue
        if float(hit.score) < thresholds.relaxed_child:
            continue
        gap_years, _, _ = compute_age_gap(candidate_capture_date, getattr(ref, "capture_date", None))
        if gap_years is not None and gap_years <= AGE_CONSISTENT_NEAR_YEARS:
            boosted = min(1.0, decision.score + AGE_CONSISTENT_BONUS)
            return replace(
                decision,
                score=float(boosted),
                band=band_for_score(float(boosted), thresholds),
                flags=tuple(dict.fromkeys((*decision.flags, "age-consistent"))),
            )
    return decision


# Phase-4 §5.5 (AS-norm/IDA): a "confident" match must stand OUT from the probe's own
# impostor cohort. Below this many std-devs of separation the probe matches other people
# about as well as the target (a generic / low-information face) and must not be
# auto-confident. Precision-only and cross-age-SAFE -- never touches the relaxed band.
COHORT_SEPARATION_FLOOR = 0.5


def _demote_low_cohort_separation(
    decision: MatchDecision, thresholds: Thresholds, candidate_cohort_scores: list[float] | None
) -> MatchDecision:
    if not candidate_cohort_scores or decision.band != "confident" or decision.raw_cosine is None:
        return decision
    z = as_norm_score(float(decision.raw_cosine), candidate_cohort_scores)
    if z >= COHORT_SEPARATION_FLOOR:
        return decision
    demoted_score = min(decision.score, thresholds.confident - 1e-4)
    return replace(
        decision,
        score=float(demoted_score),
        band=band_for_score(float(demoted_score), thresholds),
        flags=tuple(dict.fromkeys((*decision.flags, "low-cohort-separation"))),
    )


def _demote_weak_pooled_support(
    decision: MatchDecision, thresholds: Thresholds, template_cosines: dict[str, float] | None
) -> MatchDecision:
    # §5.3: a "confident" match must also agree with the matched person's robust pooled
    # template, not lean on one outlier reference crop. Precision-only and cross-age-SAFE
    # (never touches the relaxed band). No-op when no template is available for the person.
    if not template_cosines or decision.band != "confident" or decision.raw_cosine is None:
        return decision
    template_cosine_value = template_cosines.get(decision.person_name)
    if template_cosine_value is None or not weak_pooled_support(float(decision.raw_cosine), float(template_cosine_value)):
        return decision
    demoted_score = min(decision.score, thresholds.confident - 1e-4)
    return replace(
        decision,
        score=float(demoted_score),
        band=band_for_score(float(demoted_score), thresholds),
        flags=tuple(dict.fromkeys((*decision.flags, "weak-pooled-support"))),
    )


def _demote_low_quality_confident(
    decision: MatchDecision, thresholds: Thresholds, candidate_quality: float | None
) -> MatchDecision:
    if candidate_quality is None or candidate_quality >= LOW_QUALITY_CONFIDENT_FLOOR:
        return decision
    if decision.band != "confident":
        return decision
    demoted_score = min(decision.score, thresholds.confident - 1e-4)
    return replace(
        decision,
        score=float(demoted_score),
        band=band_for_score(float(demoted_score), thresholds),
        flags=tuple(dict.fromkeys((*decision.flags, "low-quality-demoted"))),
    )


@dataclass(slots=True)
class MatchDecision:
    person_name: str
    best_ref_id: str | None
    best_ref_path: str | None
    score: float
    band: str
    flags: tuple[str, ...] = ()
    evidence_count: int = 1
    runner_up_margin: float | None = None
    # Top raw cosine before fusion bonuses/penalties -- captured so calibration and
    # evaluation can use recognizer similarity decoupled from heuristic adjustments.
    raw_cosine: float | None = None


def band_for_score(score: float, thresholds: Thresholds) -> str:
    if score >= thresholds.confident:
        return "confident"
    if score >= thresholds.likely:
        return "likely"
    if score >= thresholds.relaxed_child:
        return "child-bucket maybe"
    return "below-review"


def thresholds_for_pose(thresholds: Thresholds, pose_bucket: str | None) -> Thresholds:
    pose = str(pose_bucket or "unknown").strip().lower().replace("_", "-")
    delta = POSE_REVIEW_DELTAS.get(pose, 0.0)
    if delta <= 0:
        return thresholds
    relaxed = max(POSE_REVIEW_MINIMUM, thresholds.relaxed_child - delta)
    if relaxed >= thresholds.relaxed_child:
        return thresholds
    return Thresholds(
        confident=thresholds.confident,
        likely=thresholds.likely,
        relaxed_child=relaxed,
        quality_min=thresholds.quality_min,
    )


def _normalized_pose_bucket(pose_bucket: str | None) -> str:
    pose = str(pose_bucket or "unknown").strip().lower().replace("_", "-")
    if pose in {"side", "profile", "edge", "edge-face"}:
        return "profile" if pose != "edge-face" else "edge-face"
    if pose in {"three-quarter", "threequarter", "3q", "3-quarter"}:
        return "three-quarter"
    if pose in {"front", "frontal", "straight"}:
        return "frontal"
    return pose or "unknown"


def _reference_pose(ref: ReferenceFace) -> str:
    return _normalized_pose_bucket(getattr(ref, "pose_bucket", "unknown"))


def pose_review_supported(hits: list[SearchHit], refs: dict[str, ReferenceFace], thresholds: Thresholds, pose_bucket: str | None) -> bool:
    pose_thresholds = thresholds_for_pose(thresholds, pose_bucket)
    if pose_thresholds.relaxed_child >= thresholds.relaxed_child:
        return False
    grouped: dict[str, list[float]] = {}
    for hit in hits:
        ref = refs.get(hit.item_id)
        if ref is None:
            continue
        grouped.setdefault(ref.person_name, []).append(float(hit.score))
    for scores in grouped.values():
        sorted_scores = sorted(scores, reverse=True)
        if len(sorted_scores) < 2:
            continue
        top, second = sorted_scores[0], sorted_scores[1]
        if top >= pose_thresholds.relaxed_child and second >= pose_thresholds.relaxed_child and top - second <= 0.08:
            return True
    return False


def group_hits(
    hits: list[SearchHit],
    refs: dict[str, ReferenceFace],
    thresholds: Thresholds,
    pose_bucket: str | None = None,
    candidate_quality: float | None = None,
    candidate_capture_date: str | None = None,
    candidate_align_error: float | None = None,
    candidate_cohort_scores: list[float] | None = None,
    candidate_template_cosines: dict[str, float] | None = None,
) -> MatchDecision | None:
    candidate_pose = _normalized_pose_bucket(pose_bucket)
    hard_pose = candidate_pose in {"profile", "edge-face", "three-quarter"}
    grouped: dict[str, dict[str, object]] = {}
    for hit in hits:
        ref = refs.get(hit.item_id)
        if ref is None:
            continue
        row = grouped.setdefault(ref.person_name, {"best_hit": hit, "best_ref": ref, "scores": [], "hit_refs": []})
        row["scores"].append(float(hit.score))  # type: ignore[union-attr]
        row["hit_refs"].append((hit, ref))  # type: ignore[union-attr]
        best_hit = row["best_hit"]
        if isinstance(best_hit, SearchHit) and hit.score > best_hit.score:
            row["best_hit"] = hit
            row["best_ref"] = ref
    if not grouped:
        return None

    scored_decisions: list[MatchDecision] = []
    for person_name, row in grouped.items():
        raw_scores = sorted(row["scores"], reverse=True)[:3]  # type: ignore[index]
        if not raw_scores:
            continue
        top_score = float(raw_scores[0])
        support_scores = [
            float(score)
            for score in raw_scores[1:]
            if score >= thresholds.relaxed_child and top_score - float(score) <= 0.08
        ]
        support_bonus = 0.0
        if support_scores:
            support_margin = sum(score - thresholds.relaxed_child for score in support_scores) / len(raw_scores)
            support_bonus = min(0.03, max(0.0, support_margin) * 0.08)
        flags: list[str] = []
        pose_bonus = 0.0
        hard_pose_penalty = 0.0
        pose_supported = False
        if hard_pose:
            hit_refs = row.get("hit_refs", [])
            if isinstance(hit_refs, list):
                for hit, ref in hit_refs[:5]:
                    if not isinstance(hit, SearchHit) or not isinstance(ref, ReferenceFace):
                        continue
                    ref_pose = _reference_pose(ref)
                    compatible_profile = candidate_pose in {"profile", "edge-face"} and ref_pose in {"profile", "edge-face", "three-quarter"}
                    compatible_three_quarter = candidate_pose == "three-quarter" and ref_pose in {"three-quarter", "frontal", "profile", "edge-face"}
                    if float(hit.score) >= thresholds.relaxed_child and (compatible_profile or compatible_three_quarter):
                        pose_supported = True
                        break
            flags.append("pose-reranked")
            if pose_supported:
                flags.append("pose-supported")
                pose_bonus = 0.015 if candidate_pose in {"profile", "edge-face"} else 0.01
            if len(support_scores) >= 2:
                pose_bonus += 0.006
        if hard_pose and not support_scores and not pose_supported and top_score < thresholds.likely:
            flags.append("single-reference-hard-pose")
            hard_pose_penalty = 0.025
        elif not support_scores and top_score < thresholds.confident:
            flags.append("single-reference-match")
        fused = min(1.0, max(0.0, top_score + support_bonus + pose_bonus - hard_pose_penalty))
        best_hit = row["best_hit"]
        best_ref = row["best_ref"]
        if not isinstance(best_hit, SearchHit) or not isinstance(best_ref, ReferenceFace):
            continue
        scored_decisions.append(MatchDecision(
            person_name=person_name,
            best_ref_id=best_ref.ref_id,
            best_ref_path=best_ref.source_path,
            score=float(fused),
            band=band_for_score(float(fused), thresholds),
            flags=tuple(flags),
            evidence_count=1 + len(support_scores),
            raw_cosine=top_score,
        ))
    if not scored_decisions:
        return None
    scored_decisions.sort(key=lambda decision: decision.score, reverse=True)
    best_decision = scored_decisions[0]
    if len(scored_decisions) > 1:
        margin = float(best_decision.score - scored_decisions[1].score)
        flags = list(best_decision.flags)
        adjusted_score = best_decision.score
        if margin < CLOSE_PERSON_MARGIN:
            flags.append("close-runner-up")
        if margin < SINGLE_REFERENCE_MARGIN and best_decision.evidence_count <= 1:
            flags.append("single-reference-close-runner-up")
        if margin < AMBIGUOUS_PERSON_MARGIN and best_decision.score < thresholds.confident:
            flags.append("ambiguous-person-margin")
            adjusted_score = max(0.0, best_decision.score - 0.015)
        best_decision = MatchDecision(
            person_name=best_decision.person_name,
            best_ref_id=best_decision.best_ref_id,
            best_ref_path=best_decision.best_ref_path,
            score=float(adjusted_score),
            band=band_for_score(float(adjusted_score), thresholds),
            flags=tuple(dict.fromkeys(flags)),
            evidence_count=best_decision.evidence_count,
            runner_up_margin=margin,
            raw_cosine=best_decision.raw_cosine,
        )
    best_decision = _apply_age_consistency(best_decision, grouped, thresholds, candidate_capture_date)
    # §5.5: derive the probe's impostor cohort from its hits to OTHER people (free, no new
    # store) when not given explicitly; empty (single enrolled person) -> graceful no-op.
    cohort_scores = candidate_cohort_scores
    if cohort_scores is None and best_decision is not None:
        derived = [
            float(hit.score)
            for hit in hits
            if refs.get(hit.item_id) is not None and refs[hit.item_id].person_name != best_decision.person_name
        ]
        cohort_scores = derived or None
    best_decision = _demote_low_cohort_separation(best_decision, thresholds, cohort_scores)
    best_decision = _demote_weak_pooled_support(best_decision, thresholds, candidate_template_cosines)
    best_decision = _demote_low_quality_confident(best_decision, thresholds, candidate_quality)
    return _demote_alignment_suspect(best_decision, thresholds, candidate_align_error)


# ---------------------------------------------------------------------------
# Pure accuracy + validation math (MA-1). These were `self`-less methods on the
# 6k-line ProjectState god-object; they belong in the tidy match/ module where
# they are unit-testable in isolation. Behavior is byte-identical to the former
# ProjectState._accuracy_*/_valid_*/_finite_number methods.
# ---------------------------------------------------------------------------
def _confusion_metrics(tp: int, fp: int, tn: int, fn: int, *, threshold: float, labeled: int) -> dict[str, Any]:
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    specificity = tn / max(1, tn + fp)
    return {
        "threshold": round(float(threshold), 4),
        "labeled": labeled,
        "truePositives": tp,
        "falsePositives": fp,
        "trueNegatives": tn,
        "falseNegatives": fn,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "specificity": round(specificity, 4),
    }


def accuracy_at_threshold(candidates: list[ReviewCandidate], threshold: float) -> dict[str, Any]:
    tp = fp = tn = fn = 0
    for candidate in candidates:
        expected_match = candidate.status == "accepted"
        predicted_match = float(candidate.score) >= threshold
        if expected_match and predicted_match:
            tp += 1
        elif not expected_match and predicted_match:
            fp += 1
        elif not expected_match and not predicted_match:
            tn += 1
        else:
            fn += 1
    return _confusion_metrics(tp, fp, tn, fn, threshold=threshold, labeled=len(candidates))


def accuracy_from_label_rows(rows: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    tp = fp = tn = fn = 0
    for row in rows:
        try:
            score = float(row.get("matchScore", 0.0) or 0.0)
        except (TypeError, ValueError):
            score = 0.0
        expected_match = bool(row.get("isMatch"))
        predicted_match = score >= threshold
        if expected_match and predicted_match:
            tp += 1
        elif not expected_match and predicted_match:
            fp += 1
        elif not expected_match and not predicted_match:
            tn += 1
        else:
            fn += 1
    return _confusion_metrics(tp, fp, tn, fn, threshold=threshold, labeled=len(rows))


def finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def valid_vector(vector: object) -> bool:
    if not isinstance(vector, list) or len(vector) != 512:
        return False
    return all(finite_number(value) for value in vector)


def valid_reference(ref: ReferenceFace) -> bool:
    return (
        isinstance(ref.ref_id, str)
        and bool(ref.ref_id)
        and isinstance(ref.person_name, str)
        and bool(ref.person_name.strip())
        and isinstance(ref.age_bucket, str)
        and isinstance(ref.source_path, str)
        and isinstance(ref.model_name, str)
        and finite_number(ref.quality)
        and valid_vector(ref.vector)
    )


def valid_candidate(candidate: ReviewCandidate) -> bool:
    return (
        isinstance(candidate.candidate_id, str)
        and bool(candidate.candidate_id)
        and isinstance(candidate.source_path, str)
        and isinstance(candidate.person_name, str)
        and isinstance(candidate.band, str)
        and isinstance(candidate.model_name, str)
        and candidate.status in {"pending", "accepted", "rejected", "uncertain"}
        and finite_number(candidate.score)
        and finite_number(candidate.quality)
    )

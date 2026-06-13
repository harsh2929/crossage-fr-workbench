from __future__ import annotations

from dataclasses import dataclass

from crossage_fr.config import Thresholds
from crossage_fr.models import ReferenceFace
from crossage_fr.store import SearchHit


POSE_REVIEW_DELTAS = {
    "profile": 0.08,
    "edge-face": 0.08,
    "three-quarter": 0.04,
}
POSE_REVIEW_MINIMUM = 0.12


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
        if hard_pose:
            hit_refs = row.get("hit_refs", [])
            pose_supported = False
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
            if not support_scores and not pose_supported and top_score < thresholds.likely:
                flags.append("single-reference-hard-pose")
                hard_pose_penalty = 0.025
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
        ))
    if not scored_decisions:
        return None
    scored_decisions.sort(key=lambda decision: decision.score, reverse=True)
    best_decision = scored_decisions[0]
    if len(scored_decisions) > 1:
        margin = float(best_decision.score - scored_decisions[1].score)
        flags = list(best_decision.flags)
        adjusted_score = best_decision.score
        if margin < 0.025 and best_decision.score < thresholds.confident:
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
        )
    return best_decision

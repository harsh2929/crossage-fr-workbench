from __future__ import annotations

from dataclasses import dataclass

from crossage_fr.config import Thresholds
from crossage_fr.models import ReferenceFace
from crossage_fr.store import SearchHit


@dataclass(slots=True)
class MatchDecision:
    person_name: str
    best_ref_id: str | None
    best_ref_path: str | None
    score: float
    band: str


def band_for_score(score: float, thresholds: Thresholds) -> str:
    if score >= thresholds.confident:
        return "confident"
    if score >= thresholds.likely:
        return "likely"
    if score >= thresholds.relaxed_child:
        return "child-bucket maybe"
    return "below-review"


def group_hits(hits: list[SearchHit], refs: dict[str, ReferenceFace], thresholds: Thresholds) -> MatchDecision | None:
    grouped: dict[str, dict[str, object]] = {}
    for hit in hits:
        ref = refs.get(hit.item_id)
        if ref is None:
            continue
        row = grouped.setdefault(ref.person_name, {"best_hit": hit, "best_ref": ref, "scores": []})
        row["scores"].append(float(hit.score))  # type: ignore[union-attr]
        best_hit = row["best_hit"]
        if isinstance(best_hit, SearchHit) and hit.score > best_hit.score:
            row["best_hit"] = hit
            row["best_ref"] = ref
    if not grouped:
        return None

    best_decision: MatchDecision | None = None
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
        fused = min(1.0, top_score + support_bonus)
        best_hit = row["best_hit"]
        best_ref = row["best_ref"]
        if not isinstance(best_hit, SearchHit) or not isinstance(best_ref, ReferenceFace):
            continue
        decision = MatchDecision(
            person_name=person_name,
            best_ref_id=best_ref.ref_id,
            best_ref_path=best_ref.source_path,
            score=float(fused),
            band=band_for_score(float(fused), thresholds),
        )
        if best_decision is None or decision.score > best_decision.score:
            best_decision = decision
    return best_decision

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
    grouped: dict[str, list[tuple[SearchHit, ReferenceFace]]] = {}
    for hit in hits:
        ref = refs.get(hit.item_id)
        if ref is None:
            continue
        grouped.setdefault(ref.person_name, []).append((hit, ref))
    if not grouped:
        return None

    best_decision: MatchDecision | None = None
    for person_name, rows in grouped.items():
        rows = sorted(rows, key=lambda row: row[0].score, reverse=True)
        top_rows = rows[: min(3, len(rows))]
        raw_scores = [row[0].score for row in top_rows]
        if len(raw_scores) == 1:
            fused = raw_scores[0]
        else:
            min_score = min(raw_scores)
            max_score = max(raw_scores)
            if max_score == min_score:
                fused = max_score
            else:
                normalized = [(score - min_score) / (max_score - min_score) for score in raw_scores]
                fused = sum(normalized) / len(normalized)
                fused = 0.65 * max_score + 0.35 * fused
        best_hit, best_ref = rows[0]
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


import type { ReviewCandidate } from "../types";

function scorePercent(value: unknown): string {
  const parsed = Number(value);
  const score = Number.isFinite(parsed) ? parsed : 0;
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

export function photoReviewMoreCandidateReasons(candidate: ReviewCandidate): string[] {
  const provenance = candidate.reviewMoreProvenance && typeof candidate.reviewMoreProvenance === "object"
    ? candidate.reviewMoreProvenance
    : {};
  const kind = String(provenance.kind || "").trim();
  const band = String(provenance.band || candidate.band || "").trim();
  const status = String(provenance.status || candidate.status || "").trim();
  const bestRefId = String(provenance.bestRefId || candidate.bestRefId || "").trim();
  const bestRefPath = String(provenance.bestRefPath || candidate.bestRefPath || "").trim();
  return [
    kind === "nearest_neighbor_review_more" ? "Nearest match" : "",
    `score ${scorePercent(provenance.score ?? candidate.score)}`,
    `quality ${scorePercent(provenance.quality ?? candidate.quality)}`,
    band,
    status,
    bestRefId || bestRefPath ? "best reference" : "",
  ].filter(Boolean).slice(0, 6);
}

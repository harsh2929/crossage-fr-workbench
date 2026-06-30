import type { CandidateStatus, ReviewCandidate } from "../types";

export interface PhotoGroupReviewInput {
  candidates?: ReviewCandidate[] | null;
  memberPeople?: string[] | null;
  excludePeople?: string[] | null;
  statuses?: CandidateStatus[];
  minScore?: number | null;
}

function normalizedNameSet(values: string[] | null | undefined): Set<string> {
  return new Set(
    (values || [])
      .map((value) => String(value || "").trim().toLocaleLowerCase())
      .filter(Boolean)
  );
}

function cleanNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scorePercent(value: unknown): string {
  return `${Math.round(Math.max(0, Math.min(1, cleanNumber(value))) * 100)}%`;
}

export function photoReviewMoreMinScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function photoReviewMoreCandidateMatchesThreshold(candidate: ReviewCandidate, minScore: unknown): boolean {
  const threshold = photoReviewMoreMinScore(minScore);
  return threshold <= 0 || cleanNumber(candidate.score) >= threshold;
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
    band ? band : "",
    status ? status : "",
    bestRefId || bestRefPath ? "best reference" : "",
  ].filter(Boolean).slice(0, 6);
}

export function buildPhotoGroupReviewCandidates(input: PhotoGroupReviewInput): ReviewCandidate[] {
  const includePeople = normalizedNameSet(input.memberPeople);
  if (!includePeople.size) return [];
  const excludePeople = normalizedNameSet(input.excludePeople);
  const statuses = new Set<CandidateStatus>(input.statuses?.length ? input.statuses : ["pending", "uncertain"]);
  const minScore = photoReviewMoreMinScore(input.minScore);
  const seen = new Set<string>();
  return (input.candidates || [])
    .filter((candidate) => {
      const candidateId = String(candidate.candidateId || "").trim();
      const personName = String(candidate.personName || "").trim().toLocaleLowerCase();
      if (!candidateId || seen.has(candidateId)) return false;
      if (!statuses.has(candidate.status)) return false;
      if (!photoReviewMoreCandidateMatchesThreshold(candidate, minScore)) return false;
      if (!includePeople.has(personName) || excludePeople.has(personName)) return false;
      seen.add(candidateId);
      return true;
    })
    .sort((a, b) => b.score - a.score || b.quality - a.quality || a.candidateId.localeCompare(b.candidateId));
}

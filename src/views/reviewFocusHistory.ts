export interface ReviewFocusHistoryRecord {
  id: string;
  label: string;
  candidateIds: string[];
  createdAt: number;
  lastUsedAt: number;
}

export const MAX_REVIEW_FOCUS_HISTORY = 12;
export const MAX_REVIEW_FOCUS_CANDIDATE_IDS = 250;

function finiteTimestamp(value: unknown, fallback = Date.now()) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function cleanLabel(value: unknown, fallback: string) {
  const label = String(value ?? "").replace(/\s+/g, " ").trim();
  return (label || fallback).slice(0, 80);
}

function cleanCandidateIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, MAX_REVIEW_FOCUS_CANDIDATE_IDS);
}

function recordSignature(label: string, candidateIds: string[]) {
  return `${label.toLowerCase()}\n${candidateIds.join("\n")}`;
}

function stableRecordId(label: string, candidateIds: string[], createdAt: number) {
  let hash = 2166136261;
  for (const char of recordSignature(label, candidateIds)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `review-focus:${createdAt}:${(hash >>> 0).toString(36)}`;
}

export function reviewFocusHistoryStorageKey(workspace: string | null | undefined) {
  return `vintrace:review-focus-history:${workspace || "default"}`;
}

export function normalizeReviewFocusHistory(rows: unknown, now = Date.now()): ReviewFocusHistoryRecord[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const normalized: ReviewFocusHistoryRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const candidateIds = cleanCandidateIds(record.candidateIds);
    if (!candidateIds.length) continue;
    const label = cleanLabel(record.label, `${candidateIds.length} selected matches`);
    const createdAt = finiteTimestamp(record.createdAt, now);
    const lastUsedAt = finiteTimestamp(record.lastUsedAt, createdAt);
    const signature = recordSignature(label, candidateIds);
    if (seen.has(signature)) continue;
    seen.add(signature);
    normalized.push({
      id: cleanLabel(record.id, stableRecordId(label, candidateIds, createdAt)),
      label,
      candidateIds,
      createdAt,
      lastUsedAt
    });
  }
  return normalized
    .sort((left, right) => right.lastUsedAt - left.lastUsedAt || right.createdAt - left.createdAt)
    .slice(0, MAX_REVIEW_FOCUS_HISTORY);
}

export function upsertReviewFocusHistory(
  current: unknown,
  input: { label?: string; candidateIds: string[] },
  now = Date.now()
) {
  const candidateIds = cleanCandidateIds(input.candidateIds);
  if (!candidateIds.length) {
    return normalizeReviewFocusHistory(current, now);
  }
  const label = cleanLabel(input.label, `${candidateIds.length} selected matches`);
  const existing = normalizeReviewFocusHistory(current, now);
  const signature = recordSignature(label, candidateIds);
  const next: ReviewFocusHistoryRecord[] = [
    {
      id: stableRecordId(label, candidateIds, now),
      label,
      candidateIds,
      createdAt: now,
      lastUsedAt: now
    },
    ...existing.filter((record) => recordSignature(record.label, record.candidateIds) !== signature)
  ];
  return normalizeReviewFocusHistory(next, now);
}

export function removeReviewFocusHistoryItem(current: unknown, itemId: string) {
  const id = String(itemId || "");
  return normalizeReviewFocusHistory(current).filter((record) => record.id !== id);
}

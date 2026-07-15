import type { CandidateStatus } from "../types";
import { photoStatusFilterLabel } from "./photoGroupReview";

export interface PhotoInlineReviewDecision {
  id: string;
  candidateId: string;
  personName: string;
  sourcePath: string;
  previousStatus: CandidateStatus;
  status: CandidateStatus;
  score: number;
  decidedAt: string;
}

export interface PhotoInlineReviewDecisionRow {
  id: string;
  personName: string;
  detailText: string;
  decidedAt: string;
}

export interface PhotoInlineReviewDecisionRowFormatters {
  fileName?: (value: string) => string;
}

export const PHOTO_INLINE_REVIEW_DECISIONS_KEY = "vintrace.photos.inlineReviewDecisions";
export const PHOTO_INLINE_REVIEW_DECISION_STORAGE_LIMIT = 30;
export const PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT = 6;

const PHOTO_INLINE_REVIEW_STATUSES: CandidateStatus[] = ["pending", "accepted", "uncertain", "rejected"];

function photoInlineReviewStatusValue(value: unknown): CandidateStatus | null {
  const status = String(value || "").trim();
  return PHOTO_INLINE_REVIEW_STATUSES.includes(status as CandidateStatus) ? status as CandidateStatus : null;
}

function defaultFileName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

export function photoInlineReviewDecisionRow(
  decision: PhotoInlineReviewDecision,
  formatters: PhotoInlineReviewDecisionRowFormatters = {},
): PhotoInlineReviewDecisionRow {
  const sourceName = formatters.fileName?.(decision.sourcePath) || defaultFileName(decision.sourcePath);
  const scorePercent = Math.round(Number(decision.score) * 100);
  return {
    id: decision.id,
    personName: decision.personName,
    detailText: `${sourceName} · ${photoStatusFilterLabel(decision.previousStatus)} -> ${photoStatusFilterLabel(decision.status)} · ${scorePercent}%`,
    decidedAt: decision.decidedAt,
  };
}

export function photoInlineReviewDecisionRows(
  decisions: readonly PhotoInlineReviewDecision[],
  formatters: PhotoInlineReviewDecisionRowFormatters = {},
  limit = PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT,
): PhotoInlineReviewDecisionRow[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT;
  return decisions.slice(0, cappedLimit).map((decision) => photoInlineReviewDecisionRow(decision, formatters));
}

export function normalizePhotoInlineReviewDecision(value: unknown): PhotoInlineReviewDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidateId = String(record.candidateId || "").trim();
  const personName = String(record.personName || "").trim();
  const previousStatus = photoInlineReviewStatusValue(record.previousStatus);
  const status = photoInlineReviewStatusValue(record.status);
  const decidedAt = String(record.decidedAt || "").trim();
  const score = Number(record.score);
  if (!candidateId || !personName || !previousStatus || !status || Number.isNaN(Date.parse(decidedAt))) return null;
  return {
    id: String(record.id || `${candidateId}:${decidedAt}`).trim(),
    candidateId,
    personName,
    sourcePath: String(record.sourcePath || ""),
    previousStatus,
    status,
    score: Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : 0,
    decidedAt,
  };
}

export function normalizePhotoInlineReviewDecisions(values: unknown): PhotoInlineReviewDecision[] {
  if (!Array.isArray(values)) return [];
  const next: PhotoInlineReviewDecision[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizePhotoInlineReviewDecision(value);
    if (!normalized || seen.has(normalized.candidateId)) continue;
    seen.add(normalized.candidateId);
    next.push(normalized);
    if (next.length >= PHOTO_INLINE_REVIEW_DECISION_STORAGE_LIMIT) break;
  }
  return next;
}

export function readStoredPhotoInlineReviewDecisions(key: string): PhotoInlineReviewDecision[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoInlineReviewDecisions(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoInlineReviewDecisions(key: string, values: PhotoInlineReviewDecision[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoInlineReviewDecisions(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

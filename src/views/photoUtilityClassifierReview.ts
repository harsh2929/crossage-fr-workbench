import type { PhotoItem } from "../types";

export type PhotoUtilityClassifierReviewAction = "confirmed" | "rejected";

export type PhotoUtilityClassifierReviewEntry = {
  classifierId: string;
  field: string;
  term: string;
  action: PhotoUtilityClassifierReviewAction;
  value?: string;
  reviewedAt?: string;
};

function cleanPhotoUtilityReviewText(value: unknown, maxLength = 120): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, Math.max(1, maxLength));
}

export function photoUtilityMatchReviewKey(match: Pick<NonNullable<PhotoItem["utilityMatch"]>, "classifierId" | "field" | "term"> | null | undefined): string {
  if (!match) return "";
  return [
    cleanPhotoUtilityReviewText(match.classifierId, 80).toLocaleLowerCase(),
    cleanPhotoUtilityReviewText(match.field, 80).toLocaleLowerCase(),
    cleanPhotoUtilityReviewText(match.term, 120).toLocaleLowerCase(),
  ].join(":");
}

export function photoUtilityReviewEntryMatches(entry: PhotoUtilityClassifierReviewEntry, match: NonNullable<PhotoItem["utilityMatch"]>): boolean {
  const classifierId = cleanPhotoUtilityReviewText(match.classifierId, 80).toLocaleLowerCase();
  const field = cleanPhotoUtilityReviewText(match.field, 80).toLocaleLowerCase();
  const term = cleanPhotoUtilityReviewText(match.term, 120).toLocaleLowerCase();
  const entryField = entry.field.toLocaleLowerCase();
  const entryTerm = entry.term.toLocaleLowerCase();
  return entry.classifierId.toLocaleLowerCase() === classifierId
    && (!entryField || entryField === field || entryField === "*" || entryField === "all")
    && (entryTerm === term || entryTerm === "*" || entryTerm === "all");
}

export function photoUtilityMatchReviewEntries(item: PhotoItem): PhotoUtilityClassifierReviewEntry[] {
  const review = item.assetMetadata?.utilityClassifierReview;
  const entries = review && typeof review === "object" && !Array.isArray(review)
    ? (review as Record<string, unknown>).entries
    : [];
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.flatMap((entry): PhotoUtilityClassifierReviewEntry[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const classifierId = cleanPhotoUtilityReviewText(record.classifierId ?? record.classifier, 80);
    const field = cleanPhotoUtilityReviewText(record.field, 80);
    const term = cleanPhotoUtilityReviewText(record.term ?? record.label, 120);
    const rawAction = String(record.action ?? record.status ?? "").toLocaleLowerCase();
    const action: PhotoUtilityClassifierReviewAction | "" = ["reject", "rejected", "hide", "hidden", "remove", "removed", "falsepositive", "false_positive", "notthis", "not_this"].includes(rawAction)
      ? "rejected"
      : ["confirm", "confirmed", "accept", "accepted", "manual", "user"].includes(rawAction)
        ? "confirmed"
        : "";
    if (!classifierId || !term || !action) return [];
    const key = `${photoUtilityMatchReviewKey({ classifierId, field, term })}:${action}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const value = cleanPhotoUtilityReviewText(record.value, 180);
    return [{
      classifierId,
      field,
      term,
      action,
      ...(value ? { value } : {}),
      ...(String(record.reviewedAt || "").trim() ? { reviewedAt: String(record.reviewedAt || "").trim() } : {}),
    }];
  }).slice(0, 200);
}

export function photoUtilityMatchReviewAction(item: PhotoItem, match: NonNullable<PhotoItem["utilityMatch"]>): PhotoUtilityClassifierReviewAction | "" {
  const entry = [...photoUtilityMatchReviewEntries(item)]
    .reverse()
    .find((candidate) => photoUtilityReviewEntryMatches(candidate, match));
  const action = entry?.action || String(match.reviewAction || "");
  return action === "confirmed" || action === "rejected" ? action : "";
}

export function photoUtilityClassifierReviewPatch(
  item: PhotoItem,
  match: NonNullable<PhotoItem["utilityMatch"]>,
  action: PhotoUtilityClassifierReviewAction | "clear",
): Record<string, unknown> {
  const entries = photoUtilityMatchReviewEntries(item)
    .filter((entry) => !photoUtilityReviewEntryMatches(entry, match));
  if (action !== "clear" && photoUtilityMatchReviewKey(match)) {
    const value = cleanPhotoUtilityReviewText(match.value, 180);
    const reviewClassifier = match.classifierId === "utility:sensitive" || match.classifierKind === "sensitive_content";
    entries.push({
      classifierId: cleanPhotoUtilityReviewText(match.classifierId, 80),
      field: reviewClassifier ? "*" : cleanPhotoUtilityReviewText(match.field, 80),
      term: reviewClassifier ? "*" : cleanPhotoUtilityReviewText(match.term, 120),
      action,
      reviewedAt: new Date().toISOString(),
      ...(value ? { value } : {}),
    });
  }
  return { entries };
}

export function photoUtilityRejectLabel(match: NonNullable<PhotoItem["utilityMatch"]>): string {
  return match.classifierId === "utility:sensitive" || match.classifierKind === "sensitive_content" ? "Not sensitive" : "Not this";
}

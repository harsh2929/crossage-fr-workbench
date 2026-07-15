import type { PhotoOperation } from "../types";
import { photoStatusFilterLabel } from "./photoGroupReview";
import { photoStatusFilterValue } from "./photoSavedSearch";

export interface PhotoOperationDetailItem {
  label: string;
  value: string;
  title?: string;
}

export interface PhotoOperationDetailFormatters {
  uiText?: (value: string) => string;
  fileName?: (value: string) => string;
  shortText?: (value: string) => string;
  formatCount?: (value: number) => string;
  formatDateText?: (value: unknown) => string;
}

export interface PhotoReviewDecisionOperationRow {
  operationId: string;
  personName: string;
  detailText: string;
  createdAt: string;
}

export interface PhotoReviewDecisionOperationRowFormatters {
  uiText?: (value: string) => string;
  fileName?: (value: string) => string;
}

export const PHOTO_REVIEW_DECISION_OPERATION_TYPE = "review_candidate_decision";
export const PHOTO_REVIEW_DECISION_HISTORY_LIMIT = 6;

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPath(value: unknown): string {
  return String(value || "").trim();
}

function defaultFileName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function defaultShortText(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function labelText(formatters: PhotoOperationDetailFormatters, value: string): string {
  return formatters.uiText?.(value) || value;
}

function pathValue(formatters: PhotoOperationDetailFormatters, value: string): string {
  const name = formatters.fileName?.(value) || defaultFileName(value);
  return name || formatters.shortText?.(value) || defaultShortText(value);
}

function shortValue(formatters: PhotoOperationDetailFormatters, value: string): string {
  return formatters.shortText?.(value) || defaultShortText(value);
}

function countValue(formatters: PhotoOperationDetailFormatters, value: number): string {
  return formatters.formatCount?.(value) || String(value);
}

function dateValue(formatters: PhotoOperationDetailFormatters, value: unknown): string {
  return formatters.formatDateText?.(value) || cleanText(value);
}

export function photoLatestUndoableOperation(operations: readonly PhotoOperation[]): PhotoOperation | null {
  return operations.find((operation) => operation.canUndo) || null;
}

export function photoRecentReviewDecisionOperations(
  operations: readonly PhotoOperation[],
  limit = PHOTO_REVIEW_DECISION_HISTORY_LIMIT,
): PhotoOperation[] {
  const cappedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : PHOTO_REVIEW_DECISION_HISTORY_LIMIT;
  return operations
    .filter((operation) => operation.operationType === PHOTO_REVIEW_DECISION_OPERATION_TYPE)
    .slice(0, cappedLimit);
}

export function photoReviewDecisionOperationRow(
  operation: PhotoOperation,
  formatters: PhotoReviewDecisionOperationRowFormatters = {},
): PhotoReviewDecisionOperationRow {
  const payload = recordFrom(operation.payload);
  const sourcePath = String(payload.sourcePath || "");
  const sourceName = String(payload.sourceFilename || "") || (formatters.fileName?.(sourcePath) || defaultFileName(sourcePath));
  const personName = String(payload.personName || labelText(formatters, "Unknown person"));
  const statusBeforeValue = photoStatusFilterValue(String(payload.statusBefore || ""));
  const statusAfterValue = photoStatusFilterValue(String(payload.statusAfter || ""));
  const statusBefore = statusBeforeValue ? photoStatusFilterLabel(statusBeforeValue) : "";
  const statusAfter = statusAfterValue ? photoStatusFilterLabel(statusAfterValue) : "";
  const score = Number(payload.scoreAfter ?? payload.scoreBefore);
  const quality = Number(payload.qualityAfter ?? payload.qualityBefore);
  const detailText = [
    sourceName,
    statusBefore || statusAfter ? `${statusBefore || labelText(formatters, "unknown")} -> ${statusAfter || labelText(formatters, "unknown")}` : "",
    Number.isFinite(score) && score > 0 ? `${labelText(formatters, "score")} ${Math.round(score * 100)}%` : "",
    Number.isFinite(quality) && quality > 0 ? `${labelText(formatters, "quality")} ${Math.round(quality * 100)}%` : "",
    operation.canUndo ? labelText(formatters, "Undoable") : labelText(formatters, "Undone"),
  ].filter(Boolean).join(" · ");
  return {
    operationId: operation.operationId,
    personName,
    detailText,
    createdAt: operation.createdAt,
  };
}

export function photoOperationDetailItems(
  operation: PhotoOperation,
  formatters: PhotoOperationDetailFormatters = {},
): PhotoOperationDetailItem[] {
  const payload = recordFrom(operation.payload);
  const undoPayload = recordFrom(operation.undoPayload);
  const rawItems = Array.isArray(undoPayload.items) ? undoPayload.items : Array.isArray(payload.items) ? payload.items : [];
  const items = rawItems.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
  const firstItem = items[0] || {};
  const sourcePath = cleanPath(firstItem.sourcePath || payload.sourcePath);
  const targetPath = cleanPath(firstItem.targetPath);
  const assetId = cleanText(firstItem.assetId);
  const correctionStatusBefore = cleanText(payload.statusBefore || payload.oldStatus);
  const correctionStatusAfter = cleanText(payload.statusAfter || payload.newStatus);
  const correctionBandBefore = cleanText(payload.bandBefore || payload.oldBand);
  const correctionBandAfter = cleanText(payload.bandAfter || payload.newBand);
  const rawAffectedRows = Array.isArray(payload.affectedRows) ? payload.affectedRows : [];
  const affectedRows = rawAffectedRows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  const affectedRowsTotal = Number(payload.affectedRowsTotal) || affectedRows.length;
  const affectedDetailItems = affectedRows.slice(0, 6).map((row, index) => {
    const kind = cleanText(row.kind);
    const source = cleanPath(row.sourcePath);
    const status = cleanText(row.status);
    const score = Number(row.score);
    const name = source
      ? pathValue(formatters, source)
      : cleanText(row.candidateId || row.refId || row.assetId || labelText(formatters, "Unknown"));
    const value = [
      name,
      status,
      Number.isFinite(score) && score > 0 ? `${Math.round(score * 100)}%` : "",
    ].filter(Boolean).join(" · ");
    const label = kind === "reference"
      ? labelText(formatters, "Affected reference")
      : kind === "review"
        ? labelText(formatters, "Affected review")
        : kind === "photo_index"
          ? labelText(formatters, "Affected photo index")
          : labelText(formatters, "Affected row");
    return { label: affectedRows.length > 1 ? `${label} ${index + 1}` : label, value, title: source || undefined };
  });
  return [
    operation.operationType ? { label: labelText(formatters, "Type"), value: String(operation.operationType) } : null,
    { label: labelText(formatters, "Affected"), value: countValue(formatters, operation.affectedCount || items.length || 0) },
    operation.createdAt ? { label: labelText(formatters, "Created"), value: dateValue(formatters, operation.createdAt) || String(operation.createdAt), title: String(operation.createdAt) } : null,
    sourcePath ? { label: labelText(formatters, "Source"), value: pathValue(formatters, sourcePath), title: sourcePath } : null,
    targetPath ? { label: labelText(formatters, "Target"), value: pathValue(formatters, targetPath), title: targetPath } : null,
    assetId ? { label: labelText(formatters, "Asset"), value: shortValue(formatters, assetId), title: assetId } : null,
    payload.personName ? { label: labelText(formatters, "Person"), value: String(payload.personName) } : null,
    payload.oldPersonName ? { label: labelText(formatters, "From"), value: String(payload.oldPersonName) } : null,
    payload.newPersonName ? { label: labelText(formatters, "To"), value: String(payload.newPersonName) } : null,
    payload.references != null ? { label: labelText(formatters, "Reference labels"), value: countValue(formatters, Number(payload.references) || 0) } : null,
    payload.candidates != null ? { label: labelText(formatters, "Review rows"), value: countValue(formatters, Number(payload.candidates) || 0) } : null,
    payload.photoPeopleRows != null ? { label: labelText(formatters, "Photo index rows"), value: countValue(formatters, Number(payload.photoPeopleRows) || 0) } : null,
    payload.mergedIntoExisting != null ? { label: labelText(formatters, "Merged into existing"), value: payload.mergedIntoExisting ? labelText(formatters, "Yes") : labelText(formatters, "No") } : null,
    ...affectedDetailItems,
    affectedRowsTotal > affectedRows.length ? { label: labelText(formatters, "More affected rows"), value: countValue(formatters, affectedRowsTotal - affectedRows.length) } : null,
    correctionStatusBefore || correctionStatusAfter ? { label: labelText(formatters, "Status"), value: `${correctionStatusBefore || labelText(formatters, "unknown")} -> ${correctionStatusAfter || labelText(formatters, "unknown")}` } : null,
    correctionBandBefore || correctionBandAfter ? { label: labelText(formatters, "Band"), value: `${correctionBandBefore || labelText(formatters, "unknown")} -> ${correctionBandAfter || labelText(formatters, "unknown")}` } : null,
    payload.blockedRows != null ? { label: labelText(formatters, "Blocked rows"), value: countValue(formatters, Number(payload.blockedRows) || 0) } : null,
    items.length > 1 ? { label: labelText(formatters, "More items"), value: countValue(formatters, items.length - 1) } : null,
  ].filter((item): item is PhotoOperationDetailItem => Boolean(item));
}

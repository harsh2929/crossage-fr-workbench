import type { PhotoLibraryConsolidateValue } from "../types";

export interface PhotoConsolidationMetric {
  key: string;
  label: string;
  value: string;
}

export interface PhotoConsolidationRow {
  key: string;
  label: string;
  sourceName: string;
  detail: string;
}

export interface PhotoConsolidationSummary {
  status: "ok" | "warning" | "empty";
  title: string;
  detail: string;
  managedRootLabel: string;
  managedRootPath: string;
  metrics: PhotoConsolidationMetric[];
  rows: PhotoConsolidationRow[];
  hiddenRowCount: number;
  hasUndo: boolean;
}

export interface PhotoConsolidationSummaryOptions {
  sampleLimit?: number;
}

type PathSample = { assetId?: string; from?: string; to?: string; sourcePath?: string; reason?: string; pairKind?: string };

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function cleanCount(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function fallbackFileName(sourcePath: string): string {
  return cleanString(sourcePath).split(/[\\/]/).filter(Boolean).pop() || cleanString(sourcePath) || "Photo";
}

function companionLabel(pairKind: unknown): string {
  const kind = cleanString(pairKind).replace(/[_-]+/g, " ").trim();
  return kind ? kind.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Companion";
}

function pushRow(rows: PhotoConsolidationRow[], row: PhotoConsolidationRow, sampleLimit: number): void {
  if (rows.length < sampleLimit) rows.push(row);
}

export function buildPhotoConsolidationSummary(
  result: PhotoLibraryConsolidateValue | null | undefined,
  options: PhotoConsolidationSummaryOptions = {},
): PhotoConsolidationSummary | null {
  if (!result) return null;
  const sampleLimit = Math.max(0, Math.floor(Number(options.sampleLimit ?? 6) || 0));
  const consolidated = cleanCount(result.consolidatedAssets);
  const skipped = cleanCount(result.skippedAssets);
  const pairedMotionCopied = cleanCount(result.pairedMotionCopiedCount);
  const relatedMediaCopied = cleanCount(result.relatedMediaCopiedCount);
  const managedRootPath = cleanString(result.managedRoot || result.runRoot);
  const managedRootLabel = fallbackFileName(managedRootPath) || "Managed library";
  const metrics: PhotoConsolidationMetric[] = [
    { key: "consolidated", label: "Originals copied", value: String(consolidated) },
  ];
  if (skipped > 0) metrics.push({ key: "skipped", label: "Still referenced", value: String(skipped) });
  if (pairedMotionCopied > 0) metrics.push({ key: "live-motion", label: "Live motion copied", value: String(pairedMotionCopied) });
  if (relatedMediaCopied > 0) metrics.push({ key: "related-media", label: "Companions copied", value: String(relatedMediaCopied) });
  const hasUndo = Boolean(result.operation?.operationId);
  if (hasUndo) metrics.push({ key: "undo", label: "Undo available", value: "Yes" });

  const rows: PhotoConsolidationRow[] = [];
  let totalRows = 0;
  const addRow = (row: PhotoConsolidationRow) => {
    totalRows += 1;
    pushRow(rows, row, sampleLimit);
  };
  const copiedSamples = Array.isArray(result.samples) ? result.samples : [];
  copiedSamples.forEach((sample: PathSample, index) => {
    const sourceName = fallbackFileName(cleanString(sample.from || sample.sourcePath || sample.assetId));
    const targetName = fallbackFileName(cleanString(sample.to));
    addRow({
      key: `copied:${sample.assetId || index}`,
      label: "Copied",
      sourceName,
      detail: targetName ? `to ${targetName}` : "to managed library",
    });
  });
  const motionSamples = Array.isArray(result.pairedMotionSamples) ? result.pairedMotionSamples : [];
  motionSamples.forEach((sample: PathSample, index) => {
    const sourceName = fallbackFileName(cleanString(sample.from || sample.assetId));
    const targetName = fallbackFileName(cleanString(sample.to));
    addRow({
      key: `motion:${sample.assetId || index}`,
      label: "Live motion",
      sourceName,
      detail: targetName ? `to ${targetName}` : "paired motion copied",
    });
  });
  const relatedSamples = Array.isArray(result.relatedMediaSamples) ? result.relatedMediaSamples : [];
  relatedSamples.forEach((sample: PathSample, index) => {
    const sourceName = fallbackFileName(cleanString(sample.from || sample.assetId));
    const targetName = fallbackFileName(cleanString(sample.to));
    addRow({
      key: `related:${sample.assetId || sample.pairKind || index}`,
      label: companionLabel(sample.pairKind),
      sourceName,
      detail: targetName ? `to ${targetName}` : "companion copied",
    });
  });

  const skippedGroups: Array<[string, string, PathSample[]]> = [
    ["Already managed", "left in the managed library", Array.isArray(result.alreadyManaged) ? result.alreadyManaged : []],
    ["Missing", "source file was unavailable", Array.isArray(result.missingSources) ? result.missingSources : []],
    ["Deleted", "asset is in Recently Deleted", Array.isArray(result.deletedAssets) ? result.deletedAssets : []],
    ["Failed", "copy failed", Array.isArray(result.failures) ? result.failures : []],
  ];
  skippedGroups.forEach(([label, fallbackDetail, samples]) => {
    samples.forEach((sample, index) => {
      const detail = cleanString(sample.reason) || fallbackDetail;
      addRow({
        key: `${label}:${sample.assetId || sample.sourcePath || index}`,
        label,
        sourceName: fallbackFileName(cleanString(sample.sourcePath || sample.from || sample.assetId)),
        detail,
      });
    });
  });
  const missingInputs = Array.isArray(result.missingInputs) ? result.missingInputs : [];
  missingInputs.forEach((sourcePath, index) => {
    addRow({
      key: `missing-input:${index}`,
      label: "Missing input",
      sourceName: fallbackFileName(cleanString(sourcePath)),
      detail: "not in the current library selection",
    });
  });

  const status: PhotoConsolidationSummary["status"] = consolidated > 0
    ? skipped > 0 || cleanCount(result.failures?.length) > 0 ? "warning" : "ok"
    : "empty";
  const originalWord = consolidated === 1 ? "original" : "originals";
  return {
    status,
    title: consolidated > 0 ? `Consolidated ${consolidated} Photos ${originalWord}` : "No originals consolidated",
    detail: consolidated > 0
      ? "Managed copies are now used by the library; referenced originals stayed on disk."
      : "No selected referenced originals needed a managed copy.",
    managedRootLabel,
    managedRootPath,
    metrics,
    rows,
    hiddenRowCount: Math.max(0, totalRows - rows.length),
    hasUndo,
  };
}

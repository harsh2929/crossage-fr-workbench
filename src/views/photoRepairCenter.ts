export type PhotoRepairIssueSeverity = "error" | "warning" | "info";

export type PhotoRepairIssueAction =
  | "relinkMissingOriginal"
  | "rebuildMissingPreviews"
  | "rebuildVisiblePreviews"
  | "runPreviewSweep"
  | "openRecovered"
  | "runRestoreRehearsal"
  | "runBackupRestoreRehearsal"
  | "cleanCatalogDrift"
  | "openRootProfiles"
  | "runBackupCheck";

export interface PhotoRepairIssue {
  id: string;
  label: string;
  detail: string;
  count: number;
  severity: PhotoRepairIssueSeverity;
  action: PhotoRepairIssueAction | null;
  scopeLabel?: string;
  sampleSourcePath?: string;
}

interface PhotoRepairBackupLike {
  ok?: boolean;
  status?: string;
  dryRun?: boolean;
  counts?: Record<string, unknown>;
  samples?: Record<string, Array<Record<string, unknown>>>;
}

export interface PhotoRepairIssueInput {
  backupCheck?: PhotoRepairBackupLike | null;
  restoreRehearsal?: PhotoRepairBackupLike | null;
  backupRestoreRehearsal?: PhotoRepairBackupLike | null;
  recoveredCount?: unknown;
  visiblePhotoCount?: unknown;
}

function safeCount(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function firstSampleSource(samples: Record<string, Array<Record<string, unknown>>> | undefined, key: string): string {
  const sample = Array.isArray(samples?.[key]) ? samples?.[key]?.[0] : null;
  return String(sample?.sourcePath || "").trim();
}

export function buildPhotoRepairIssues(input: PhotoRepairIssueInput): PhotoRepairIssue[] {
  const counts = input.backupCheck?.counts || {};
  const samples = input.backupCheck?.samples || {};
  const issues: PhotoRepairIssue[] = [];
  const missingOriginals = safeCount(counts.missingOriginals);
  const missingManagedOriginals = safeCount(counts.missingManagedOriginals);
  const missingReferencedOriginals = safeCount(counts.missingReferencedOriginals);
  if (missingOriginals > 0) {
    const sampleSourcePath = firstSampleSource(samples, "missingOriginals");
    const parts = [
      missingManagedOriginals ? `${missingManagedOriginals} managed` : "",
      missingReferencedOriginals ? `${missingReferencedOriginals} referenced` : "",
    ].filter(Boolean);
    issues.push({
      id: "missing-originals",
      label: "Missing originals",
      detail: parts.length ? parts.join(", ") : "Original files are unavailable.",
      count: missingOriginals,
      severity: "error",
      action: sampleSourcePath ? "relinkMissingOriginal" : "runBackupCheck",
      scopeLabel: "Active library",
      sampleSourcePath,
    });
  }

  const missingPreviews = safeCount(counts.missingCachedPreviews);
  if (missingPreviews > 0) {
    const sampleSourcePath = firstSampleSource(samples, "missingCachedPreviews");
    issues.push({
      id: "missing-previews",
      label: "Missing previews",
      detail: "Cached thumbnails can be rebuilt from local originals.",
      count: missingPreviews,
      severity: "warning",
      action: "runPreviewSweep",
      scopeLabel: "Active library",
      sampleSourcePath,
    });
  }

  const recoveredCount = safeCount(input.recoveredCount);
  if (recoveredCount > 0) {
    issues.push({
      id: "recovered-imports",
      label: "Recovered items",
      detail: "Import failures or orphan media need a keep/delete decision.",
      count: recoveredCount,
      severity: "warning",
      action: "openRecovered",
      scopeLabel: "Active library",
    });
  }

  const orphanAlbumItems = safeCount(counts.orphanAlbumItems);
  if (orphanAlbumItems > 0) {
    issues.push({
      id: "orphan-album-items",
      label: "Album membership drift",
      detail: "Some album rows point at missing albums or assets.",
      count: orphanAlbumItems,
      severity: "error",
      action: "cleanCatalogDrift",
      scopeLabel: "Catalog cleanup is workspace-wide",
    });
  }

  const catalogIntegrityIssues = safeCount(counts.catalogIntegrityIssues);
  if (catalogIntegrityIssues > 0) {
    issues.push({
      id: "catalog-integrity",
      label: "Catalog integrity drift",
      detail: "Some metadata, people, search, cover, or edit rows point at missing catalog records.",
      count: catalogIntegrityIssues,
      severity: "warning",
      action: "cleanCatalogDrift",
      scopeLabel: "Catalog cleanup is workspace-wide",
    });
  }

  const missingPairedMotionFiles = safeCount(counts.missingPairedMotionFiles);
  const missingMediaPairFiles = safeCount(counts.missingMediaPairFiles);
  if (missingPairedMotionFiles > 0 || missingMediaPairFiles > 0) {
    const parts = [
      missingPairedMotionFiles ? `${missingPairedMotionFiles} Live motion` : "",
      missingMediaPairFiles ? `${missingMediaPairFiles} companion` : "",
    ].filter(Boolean);
    issues.push({
      id: "media-pair-files",
      label: "Media pair files",
      detail: parts.length ? `${parts.join(", ")} file${missingPairedMotionFiles + missingMediaPairFiles === 1 ? "" : "s"} missing.` : "Some paired media files are unavailable.",
      count: missingPairedMotionFiles + missingMediaPairFiles,
      severity: "warning",
      action: "runBackupCheck",
      scopeLabel: "Active library",
    });
  }

  const missingEditStackSidecars = safeCount(counts.missingEditStackSidecars);
  if (missingEditStackSidecars > 0) {
    issues.push({
      id: "missing-edit-sidecars",
      label: "Missing edit sidecars",
      detail: "Some saved edit stacks no longer have their sidecar file.",
      count: missingEditStackSidecars,
      severity: "warning",
      action: "runBackupCheck",
      scopeLabel: "Active library",
    });
  }

  const invalidEditStackSidecars = safeCount(counts.invalidEditStackSidecars);
  if (invalidEditStackSidecars > 0) {
    issues.push({
      id: "invalid-edit-sidecars",
      label: "Invalid edit sidecars",
      detail: "Some edit sidecar files are unreadable or no longer match the catalog.",
      count: invalidEditStackSidecars,
      severity: "warning",
      action: "runBackupCheck",
      scopeLabel: "Active library",
    });
  }

  const managedRootProfileIssues = safeCount(counts.managedRootProfileIssues);
  const managedAssetsOutsideProfiles = safeCount(counts.managedAssetsOutsideProfiles);
  if (managedRootProfileIssues > 0 || managedAssetsOutsideProfiles > 0) {
    const parts = [
      managedRootProfileIssues ? `${managedRootProfileIssues} root profile${managedRootProfileIssues === 1 ? "" : "s"}` : "",
      managedAssetsOutsideProfiles ? `${managedAssetsOutsideProfiles} unmanaged asset${managedAssetsOutsideProfiles === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    issues.push({
      id: "managed-root-profiles",
      label: "Managed root profiles",
      detail: parts.length ? parts.join(", ") : "Managed library roots need review.",
      count: managedRootProfileIssues + managedAssetsOutsideProfiles,
      severity: "warning",
      action: "openRootProfiles",
      scopeLabel: "Managed-root policy",
    });
  }

  const restoreCounts = input.restoreRehearsal?.counts || {};
  const blockedRestoreItems = safeCount(restoreCounts.blockedItems);
  const missingRestoreOriginals = safeCount(restoreCounts.missingOriginalItems);
  const missingManagedTrash = safeCount(restoreCounts.missingManagedTrashItems);
  if (blockedRestoreItems > 0 || missingRestoreOriginals > 0) {
    issues.push({
      id: "restore-rehearsal",
      label: blockedRestoreItems > 0 ? "Restore blockers" : "Restore rehearsal",
      detail: blockedRestoreItems > 0
        ? "Some undo entries need manual repair before they can restore."
        : missingManagedTrash > 0
          ? "Managed app-trash originals are gone; undo will restore catalog rows as missing originals."
          : "Some originals are missing and will need relink after restore.",
      count: blockedRestoreItems || missingRestoreOriginals,
      severity: blockedRestoreItems > 0 ? "error" : "warning",
      action: "runRestoreRehearsal",
      scopeLabel: "Workspace restore log",
    });
  }

  const backupRestore = input.backupRestoreRehearsal;
  const backupRestoreCounts = backupRestore?.counts || {};
  const backupRestoreBlockers = safeCount(backupRestoreCounts.blockers);
  const backupRestoreMismatches = safeCount(backupRestoreCounts.mismatchedCounts);
  const backupRestoreFailed = backupRestore?.ok === false || backupRestore?.status === "attention";
  if (backupRestoreFailed || backupRestoreBlockers > 0 || backupRestoreMismatches > 0) {
    const count = backupRestoreBlockers || backupRestoreMismatches || 1;
    issues.push({
      id: "backup-restore-rehearsal",
      label: backupRestoreBlockers > 0 || backupRestoreFailed ? "Backup rehearsal blockers" : "Backup rehearsal drift",
      detail: backupRestoreBlockers > 0 || backupRestoreFailed
        ? "Workspace backup restore needs a fresh verified rehearsal."
        : "Restored Photos counts differ from the current library index.",
      count,
      severity: backupRestoreBlockers > 0 || backupRestoreFailed ? "error" : "warning",
      action: "runBackupRestoreRehearsal",
      scopeLabel: "Workspace backup",
    });
  }

  return issues;
}

export function photoRepairIssueActionLabel(action: PhotoRepairIssueAction | null): string {
  if (action === "relinkMissingOriginal") return "Relink folder";
  if (action === "rebuildMissingPreviews" || action === "rebuildVisiblePreviews") return "Rebuild previews";
  if (action === "runPreviewSweep") return "Sweep previews";
  if (action === "openRecovered") return "Open Recovered";
  if (action === "runRestoreRehearsal") return "Restore rehearsal";
  if (action === "runBackupRestoreRehearsal") return "Backup rehearsal";
  if (action === "cleanCatalogDrift") return "Clean catalog";
  if (action === "openRootProfiles") return "Review roots";
  if (action === "runBackupCheck") return "Backup check";
  return "";
}

export interface PhotoRepairHistoryDetail {
  key: string;
  label: string;
  value: string;
}

export interface PhotoConsolidationHistoryRow {
  key: string;
  title: string;
  summary: string;
  at: string;
  status: string;
  managedRootLabel: string;
  managedRootPath: string;
  originalsCopied: number;
  stillReferenced: number;
  companionsCopied: number;
  copiedSamples: string;
  companionSamples: string;
  skippedSamples: string;
  undoAvailable: boolean;
}

export interface PhotoRepairHistoryEventLike {
  at?: string;
  seq?: number;
  action?: string;
  label?: string;
  summary?: string;
  status?: string;
  dryRun?: boolean;
  counts?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

function cleanHistoryString(value: unknown): string {
  return String(value || "").trim();
}

function cleanHistoryList(value: unknown, limit = 3): string {
  const rawItems = Array.isArray(value) ? value : [];
  const names: string[] = [];
  for (const item of rawItems) {
    const name = cleanHistoryString(item);
    if (name && !names.includes(name)) names.push(name);
  }
  const visible = names.slice(0, Math.max(0, limit));
  const hidden = Math.max(0, names.length - visible.length);
  return hidden > 0 ? `${visible.join(", ")} +${hidden} more` : visible.join(", ");
}

export function photoRepairHistoryEventDetails(event: PhotoRepairHistoryEventLike | null | undefined): PhotoRepairHistoryDetail[] {
  if (!event) return [];
  const counts = event.counts || {};
  const details = event.details || {};
  const scopedRootLabel = cleanHistoryString(details.libraryRootLabel);
  const scopedRootPath = cleanHistoryString(details.libraryRootPath);
  if (event.action === "photo_library_backup_check") {
    return [
      scopedRootLabel ? { key: "root", label: "Library root", value: scopedRootLabel } : null,
      scopedRootPath && scopedRootPath !== scopedRootLabel ? { key: "root-path", label: "Root path", value: scopedRootPath } : null,
      { key: "assets", label: "Assets checked", value: String(safeCount(counts.assets)) },
      { key: "missing-originals", label: "Missing originals", value: String(safeCount(counts.missingOriginals)) },
      { key: "missing-previews", label: "Missing previews", value: String(safeCount(counts.missingCachedPreviews)) },
      safeCount(counts.catalogIntegrityIssues) ? { key: "catalog-drift", label: "Catalog drift", value: String(safeCount(counts.catalogIntegrityIssues)) } : null,
      safeCount(counts.managedRootProfileIssues) ? { key: "root-profile-issues", label: "Root profile issues", value: String(safeCount(counts.managedRootProfileIssues)) } : null,
    ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
  }
  if (event.action === "photo_library_preview_sweep") {
    const mode = event.dryRun || details.dryRun ? "Preview" : "Apply";
    return [
      scopedRootLabel ? { key: "root", label: "Library root", value: scopedRootLabel } : null,
      scopedRootPath && scopedRootPath !== scopedRootLabel ? { key: "root-path", label: "Root path", value: scopedRootPath } : null,
      { key: "mode", label: "Mode", value: mode },
      { key: "eligible", label: "Eligible assets", value: String(safeCount(counts.eligibleAssets)) },
      { key: "selected", label: "Selected assets", value: String(safeCount(counts.selectedAssets)) },
      { key: "generated", label: "Generated previews", value: String(safeCount(counts.generatedPreviews)) },
      { key: "remaining", label: "Remaining previews", value: String(safeCount(counts.remainingMissingCachedPreviews)) },
      safeCount(counts.failedPreviews) ? { key: "failed", label: "Failed previews", value: String(safeCount(counts.failedPreviews)) } : null,
    ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
  }
  if (event.action === "photo_library_catalog_cleanup") {
    const mode = event.dryRun || details.applied === false ? "Preview" : "Apply";
    return [
      { key: "scope", label: "Scope", value: "Workspace catalog" },
      { key: "mode", label: "Mode", value: mode },
      { key: "candidates", label: "Cleanup candidates", value: String(safeCount(counts.cleanupCandidates)) },
      { key: "cleaned", label: "Rows cleaned", value: String(safeCount(counts.cleanedRows)) },
      { key: "remaining", label: "Remaining rows", value: String(safeCount(counts.remainingCandidates)) },
      safeCount(counts.catalogIntegrityIssues) ? { key: "catalog-drift", label: "Catalog drift", value: String(safeCount(counts.catalogIntegrityIssues)) } : null,
      safeCount(counts.orphanAlbumItems) ? { key: "orphan-albums", label: "Orphan album rows", value: String(safeCount(counts.orphanAlbumItems)) } : null,
    ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
  }
  if (event.action === "scan_photo_recovered_orphans") {
    const roots = cleanHistoryList(details.rootLabels || details.roots, 2);
    return [
      roots ? { key: "roots", label: "Roots", value: roots } : null,
      { key: "mode", label: "Mode", value: event.dryRun || details.dryRun ? "Preview" : "Record" },
      { key: "scanned", label: "Scanned files", value: String(safeCount(counts.scannedFiles)) },
      { key: "candidates", label: "Orphan candidates", value: String(safeCount(counts.orphanCandidates)) },
      { key: "recorded", label: "Recorded rows", value: String(safeCount(counts.recorded)) },
    ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
  }
  if (event.action === "photo_recovered_cleanup") {
    return [
      scopedRootLabel ? { key: "root", label: "Library root", value: scopedRootLabel } : null,
      scopedRootPath && scopedRootPath !== scopedRootLabel ? { key: "root-path", label: "Root path", value: scopedRootPath } : null,
      { key: "mode", label: "Mode", value: details.applied === false ? "Preview" : "Apply" },
      { key: "candidates", label: "Cleanup candidates", value: String(safeCount(counts.cleanupCandidates)) },
      { key: "dismissed", label: "Rows dismissed", value: String(safeCount(counts.rowsDismissed)) },
      { key: "deleted", label: "Rows deleted", value: String(safeCount(counts.rowsDeleted)) },
    ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
  }
  if (event.action !== "consolidate_photo_library_assets") return [];
  const consolidated = safeCount(counts.consolidatedAssets);
  const skipped = safeCount(counts.skippedAssets);
  const companions = safeCount(counts.pairedMotionCopied) + safeCount(counts.relatedMediaCopied);
  const managedRootLabel = cleanHistoryString(details.managedRootLabel);
  const managedRootPath = cleanHistoryString(details.managedRootPath);
  const copiedSamples = cleanHistoryList(details.copiedSamples);
  const skippedSamples = cleanHistoryList(details.skippedSamples);
  const companionSamples = cleanHistoryList(details.companionSamples);
  const operationId = cleanHistoryString(details.operationId);
  return [
    managedRootLabel ? { key: "managed-root", label: "Managed folder", value: managedRootLabel } : null,
    managedRootPath && managedRootPath !== managedRootLabel ? { key: "managed-path", label: "Managed path", value: managedRootPath } : null,
    consolidated ? { key: "consolidated", label: "Originals copied", value: String(consolidated) } : null,
    skipped ? { key: "skipped", label: "Still referenced", value: String(skipped) } : null,
    companions ? { key: "companions", label: "Companions copied", value: String(companions) } : null,
    copiedSamples ? { key: "copied-samples", label: "Copied samples", value: copiedSamples } : null,
    companionSamples ? { key: "companion-samples", label: "Companion samples", value: companionSamples } : null,
    skippedSamples ? { key: "skipped-samples", label: "Skipped samples", value: skippedSamples } : null,
    operationId ? { key: "undo", label: "Undo available", value: "Yes" } : null,
  ].filter((detail): detail is PhotoRepairHistoryDetail => Boolean(detail));
}

export function buildPhotoConsolidationHistoryRows(
  events: PhotoRepairHistoryEventLike[] | null | undefined,
  limit = 3,
): PhotoConsolidationHistoryRow[] {
  const cappedLimit = Math.max(1, Math.min(12, Number(limit || 3) || 3));
  return [...(events || [])]
    .filter((event) => event?.action === "consolidate_photo_library_assets")
    .slice(0, cappedLimit)
    .map((event, index) => {
      const details = event.details || {};
      const counts = event.counts || {};
      const copied = safeCount(counts.consolidatedAssets);
      const skipped = safeCount(counts.skippedAssets);
      const companions = safeCount(counts.pairedMotionCopied) + safeCount(counts.relatedMediaCopied);
      const managedRootLabel = cleanHistoryString(details.managedRootLabel);
      const managedRootPath = cleanHistoryString(details.managedRootPath);
      const copiedSamples = cleanHistoryList(details.copiedSamples);
      const companionSamples = cleanHistoryList(details.companionSamples);
      const skippedSamples = cleanHistoryList(details.skippedSamples);
      return {
        key: `${String(event.seq || 0)}:${String(event.at || "")}:${index}`,
        title: cleanHistoryString(event.label) || "Consolidate originals",
        summary: cleanHistoryString(event.summary) || `${copied} originals copied, ${skipped} skipped.`,
        at: cleanHistoryString(event.at),
        status: cleanHistoryString(event.status),
        managedRootLabel,
        managedRootPath,
        originalsCopied: copied,
        stillReferenced: skipped,
        companionsCopied: companions,
        copiedSamples,
        companionSamples,
        skippedSamples,
        undoAvailable: Boolean(cleanHistoryString(details.operationId)),
      };
    });
}

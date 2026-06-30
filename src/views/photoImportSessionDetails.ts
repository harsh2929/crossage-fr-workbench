import type { PhotoImportSession } from "../types";

export type PhotoImportSessionDetail = {
  key: string;
  label: string;
  value: string;
};

export type PhotoImportSessionSummary = {
  importId: string;
  sourceKind: string;
  sourceLabel: string;
  sourceDetail: string;
  sourceKindLabel: string;
  storageMode: string;
  storageLabel: string;
  status: string;
  statusLabel: string;
  rootPath: string;
  managedRoot: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  importedCount: number;
  failedCount: number;
  archived: boolean;
  archivedAt: string;
  archivedReason: string;
  requestedPathCount: number;
  expandedFileCount: number;
  duplicateInputs: number;
  keepFolderOrganization: boolean;
  details: PhotoImportSessionDetail[];
};

export type PhotoImportHistoryStatusFilter = "all" | "completed" | "issues" | "failed" | "running";
export type PhotoImportHistoryStorageFilter = "all" | "managed" | "referenced";

export type PhotoImportHistoryFilters = {
  query?: string;
  libraryRoot?: string;
  sourceKind?: string;
  status?: PhotoImportHistoryStatusFilter;
  storage?: PhotoImportHistoryStorageFilter;
  showArchived?: boolean;
};

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function cleanLower(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function cleanPathPrefix(value: unknown): string {
  const clean = cleanString(value).replace(/\\/g, "/");
  return (clean.length > 1 ? clean.replace(/\/+$/, "") : clean).toLowerCase();
}

function cleanNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function metadataRecord(session: PhotoImportSession): Record<string, unknown> {
  return session.metadata && typeof session.metadata === "object" ? session.metadata : {};
}

export function photoImportSessionSourceKind(kind: unknown): string {
  switch (cleanLower(kind)) {
    case "camera":
    case "phone":
      return "camera";
    case "mail":
      return "mail";
    case "safari":
    case "browser":
      return "safari";
    case "messages":
      return "messages";
    case "airdrop":
      return "airdrop";
    case "downloads":
      return "downloads";
    case "app":
      return "app";
    case "library":
      return "library";
    case "folder":
    default:
      return "folder";
  }
}

export function photoImportSessionSourceKindLabel(kind: unknown): string {
  switch (photoImportSessionSourceKind(kind)) {
    case "camera":
      return "Camera/device";
    case "mail":
      return "Mail";
    case "safari":
      return "Safari";
    case "messages":
      return "Messages";
    case "airdrop":
      return "AirDrop";
    case "downloads":
      return "Downloads";
    case "app":
      return "Other app";
    case "library":
      return "Photo library";
    case "folder":
    default:
      return "Files/folders";
  }
}

export function photoImportSessionStorageMode(mode: unknown): "managed" | "referenced" {
  return cleanLower(mode) === "managed" ? "managed" : "referenced";
}

export function photoImportSessionStorageLabel(mode: unknown): string {
  switch (photoImportSessionStorageMode(mode)) {
    case "managed":
      return "Copy into library";
    case "referenced":
    default:
      return "Reference originals";
  }
}

export function photoImportSessionStatus(status: unknown): string {
  const clean = cleanLower(status);
  if (clean === "completed_with_errors") return clean;
  if (clean === "completed") return clean;
  if (clean === "running") return clean;
  if (clean === "failed") return clean;
  return clean || "import";
}

export function photoImportSessionStatusLabel(status: unknown): string {
  const clean = photoImportSessionStatus(status);
  if (clean === "completed_with_errors") return "Completed with errors";
  if (clean === "completed") return "Completed";
  if (clean === "running") return "Importing";
  if (clean === "failed") return "Failed";
  return cleanString(status) || "Import";
}

export function buildPhotoImportSessionSummary(session: PhotoImportSession | null | undefined): PhotoImportSessionSummary | null {
  if (!session || !cleanString(session.importId)) return null;
  const metadata = metadataRecord(session);
  const managedRoot = cleanString(metadata.managedRoot);
  const requestedPathCount = cleanNumber(metadata.requestedPathCount);
  const expandedFileCount = cleanNumber(metadata.expandedFileCount);
  const duplicateInputs = cleanNumber(metadata.duplicateInputs);
  const details: PhotoImportSessionDetail[] = [];
  const sourceLabel = cleanString(session.sourceLabel) || "Import";
  const sourceDetail = cleanString(session.sourceDetail) || cleanString(metadata.sourceDetail);
  const rootPath = cleanString(session.rootPath);
  const sourceKind = photoImportSessionSourceKind(session.sourceKind);
  const storageMode = photoImportSessionStorageMode(session.storageMode);
  const status = photoImportSessionStatus(session.status);
  const storageLabel = photoImportSessionStorageLabel(storageMode);
  const sourceKindLabel = photoImportSessionSourceKindLabel(sourceKind);
  const statusLabel = photoImportSessionStatusLabel(status);
  const keepFolderOrganization = Boolean(metadata.keepFolderOrganization);
  const archivedAt = cleanString(session.archivedAt) || cleanString(metadata.archivedAt);
  const archivedReason = cleanString(session.archivedReason) || cleanString(metadata.archivedReason);
  const archived = Boolean(session.archived || archivedAt);

  [
    ["source", "Source", sourceLabel],
    ["sourceDetail", "Source detail", sourceDetail],
    ["kind", "Kind", sourceKindLabel],
    ["storage", "Storage", storageLabel],
    ["status", "Status", statusLabel],
    ["root", "Root", rootPath],
    ["managedRoot", "Managed root", managedRoot],
    ["requested", "Requested paths", requestedPathCount ? String(requestedPathCount) : ""],
    ["expanded", "Expanded files", expandedFileCount ? String(expandedFileCount) : ""],
    ["duplicates", "Duplicate inputs", duplicateInputs ? String(duplicateInputs) : ""],
    ["folderOrganization", "Folder organization", keepFolderOrganization ? "Kept" : ""],
    ["archived", "Archived", archivedAt],
    ["archiveReason", "Archive reason", archivedReason],
  ].forEach(([key, label, value]) => {
    if (value) details.push({ key, label, value });
  });

  return {
    importId: cleanString(session.importId),
    sourceKind,
    sourceLabel,
    sourceDetail,
    sourceKindLabel,
    storageMode,
    storageLabel,
    status,
    statusLabel,
    rootPath,
    managedRoot,
    startedAt: cleanString(session.startedAt),
    completedAt: cleanString(session.completedAt),
    updatedAt: cleanString(session.updatedAt),
    importedCount: cleanNumber(session.importedCount),
    failedCount: cleanNumber(session.failedCount),
    archived,
    archivedAt,
    archivedReason,
    requestedPathCount,
    expandedFileCount,
    duplicateInputs,
    keepFolderOrganization,
    details,
  };
}

function importSessionSortKey(summary: PhotoImportSessionSummary): string {
  return summary.completedAt || summary.updatedAt || summary.startedAt || "";
}

export function buildPhotoImportSessionSummaries(
  sessions: Array<PhotoImportSession | null | undefined>,
  limit = 12
): PhotoImportSessionSummary[] {
  const byImportId = new Map<string, PhotoImportSessionSummary>();
  sessions.forEach((session) => {
    const summary = buildPhotoImportSessionSummary(session);
    if (!summary || byImportId.has(summary.importId)) return;
    byImportId.set(summary.importId, summary);
  });
  return Array.from(byImportId.values())
    .sort((a, b) => importSessionSortKey(b).localeCompare(importSessionSortKey(a)) || b.importId.localeCompare(a.importId))
    .slice(0, Math.max(0, Math.round(limit)));
}

function summarySearchText(summary: PhotoImportSessionSummary): string {
  return [
    summary.importId,
    summary.sourceKind,
    summary.sourceLabel,
    summary.sourceDetail,
    summary.sourceKindLabel,
    summary.storageMode,
    summary.storageLabel,
    summary.status,
    summary.statusLabel,
    summary.rootPath,
    summary.managedRoot,
    summary.startedAt,
    summary.completedAt,
    summary.updatedAt,
    summary.archivedAt,
    summary.archivedReason,
    String(summary.importedCount),
    String(summary.failedCount),
    String(summary.requestedPathCount),
    String(summary.expandedFileCount),
    String(summary.duplicateInputs),
    ...summary.details.flatMap((detail) => [detail.label, detail.value]),
  ].join(" ").toLowerCase();
}

function summaryMatchesStatus(summary: PhotoImportSessionSummary, filter: PhotoImportHistoryStatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "issues") return summary.failedCount > 0 || summary.status === "completed_with_errors" || summary.status === "failed";
  if (filter === "completed") return summary.status === "completed" && summary.failedCount === 0;
  if (filter === "failed") return summary.status === "failed";
  if (filter === "running") return summary.status === "running";
  return true;
}

function summaryMatchesLibraryRoot(summary: PhotoImportSessionSummary, libraryRoot: unknown): boolean {
  const root = cleanPathPrefix(libraryRoot);
  if (!root) return true;
  return [summary.managedRoot, summary.rootPath].some((path) => {
    const candidate = cleanPathPrefix(path);
    return candidate === root || candidate.startsWith(`${root}/`);
  });
}

export function filterPhotoImportSessionSummaries(
  summaries: PhotoImportSessionSummary[],
  filters: PhotoImportHistoryFilters = {}
): PhotoImportSessionSummary[] {
  const queryTokens = cleanLower(filters.query).split(/\s+/).filter(Boolean);
  const sourceKind = cleanLower(filters.sourceKind);
  const status = filters.status || "all";
  const storage = filters.storage || "all";
  return summaries.filter((summary) => {
    if (!filters.showArchived && summary.archived) return false;
    if (!summaryMatchesLibraryRoot(summary, filters.libraryRoot)) return false;
    if (sourceKind && sourceKind !== "all" && summary.sourceKind !== sourceKind) return false;
    if (storage !== "all" && summary.storageMode !== storage) return false;
    if (!summaryMatchesStatus(summary, status)) return false;
    if (queryTokens.length === 0) return true;
    const searchText = summarySearchText(summary);
    return queryTokens.every((token) => searchText.includes(token));
  });
}

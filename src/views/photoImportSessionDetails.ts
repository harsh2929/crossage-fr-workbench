import type { PhotoFolder, PhotoImportSession, PhotoImportSourceKind } from "../types";
import { normalizeExternalPhotoImportSourceKind, photoImportSourceLabel } from "./photoImportAccess";

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
export type PhotoImportStorageMode = "referenced" | "managed";
export type PendingPhotoImportEntry = { path: string; isDir?: boolean; sourceKind?: PhotoImportSourceKind; sourceLabel?: string; sourceDetail?: string };

export const PHOTO_IMPORT_HISTORY_RENDER_LIMIT = 40;

export type PhotoImportHistoryFilters = {
  query?: string;
  libraryRoot?: string;
  sourceKind?: string;
  status?: PhotoImportHistoryStatusFilter;
  storage?: PhotoImportHistoryStorageFilter;
  showArchived?: boolean;
};

export type PhotoImportHistorySourceOption = {
  value: string;
  label: string;
};

export type PhotoImportHistoryState = {
  allSummaries: PhotoImportSessionSummary[];
  scopedSummaries: PhotoImportSessionSummary[];
  sourceOptions: PhotoImportHistorySourceOption[];
  filteredSummaries: PhotoImportSessionSummary[];
  archivableSummaries: PhotoImportSessionSummary[];
  visibleSummaries: PhotoImportSessionSummary[];
  queryFiltersActive: boolean;
  filtersActive: boolean;
  total: number;
  visibleTotal: number;
  matchedTotal: number;
};

export type PhotoImportHistoryStateInput = {
  activeId: string;
  activeFolder?: Pick<PhotoFolder, "id" | "importSessions" | "archivedImportSessions" | "importSessionCount" | "archivedImportSessionCount"> | null;
  folders: Array<Pick<PhotoFolder, "id" | "importSession">>;
  libraryRoot?: string;
  query?: string;
  status?: PhotoImportHistoryStatusFilter;
  storage?: PhotoImportHistoryStorageFilter;
  sourceKind?: string;
  showArchived?: boolean;
  limit?: number;
};

export type PhotoActiveImportSessionInput = {
  activeId: string;
  activeFolder?: Pick<PhotoFolder, "id" | "importSession"> | null;
  folders: Array<Pick<PhotoFolder, "id" | "importSession">>;
};

export type PhotoImportHistoryCountLabelFormatters = {
  formatCount?: (value: number) => string;
  text?: (value: string) => string;
};

export type PhotoImportHistoryProvenanceEditDraft = {
  importId: string;
  sourceKind: PhotoImportSourceKind;
  sourceLabel: string;
  sourceDetail: string;
};

export type PhotoImportHistoryProvenancePayloadResult = {
  payload: Record<string, unknown> | null;
  error: string;
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

function labelText(formatters: PhotoImportHistoryCountLabelFormatters, value: string): string {
  return formatters.text ? formatters.text(value) : value;
}

function labelCount(formatters: PhotoImportHistoryCountLabelFormatters, value: number): string {
  return formatters.formatCount ? formatters.formatCount(value) : String(value);
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

export function photoActiveImportSessionRecord(input: PhotoActiveImportSessionInput): PhotoImportSession | null {
  const activeId = cleanString(input.activeId);
  if (input.activeFolder?.importSession) return input.activeFolder.importSession;
  if (activeId.startsWith("import:")) {
    return input.folders.find((folder) => folder.id === activeId)?.importSession || null;
  }
  if (activeId === "lastImport") {
    return input.folders.find((folder) => folder.id.startsWith("import:") && folder.importSession)?.importSession || null;
  }
  return null;
}

export function photoImportHistoryProvenanceEditDraft(session: PhotoImportSessionSummary): PhotoImportHistoryProvenanceEditDraft {
  const sourceKind = normalizeExternalPhotoImportSourceKind(session.sourceKind);
  return {
    importId: cleanString(session.importId),
    sourceKind,
    sourceLabel: cleanString(session.sourceLabel) || photoImportSourceLabel(sourceKind, ""),
    sourceDetail: cleanString(session.sourceDetail),
  };
}

export function photoImportHistoryProvenancePayload(input: {
  importId?: unknown;
  sourceKind?: unknown;
  sourceLabel?: unknown;
  sourceDetail?: unknown;
}): PhotoImportHistoryProvenancePayloadResult {
  const importId = cleanString(input.importId);
  if (!importId) return { payload: null, error: "" };
  const sourceLabel = cleanString(input.sourceLabel);
  if (!sourceLabel) return { payload: null, error: "Source label is required." };
  return {
    payload: {
      importId,
      sourceKind: normalizeExternalPhotoImportSourceKind(cleanString(input.sourceKind)),
      sourceLabel,
      sourceDetail: cleanString(input.sourceDetail),
    },
    error: "",
  };
}

export function photoImportHistoryBulkProvenancePayload(input: {
  importIds: unknown[];
  sourceKind?: unknown;
  sourceLabel?: unknown;
  sourceDetail?: unknown;
}): Record<string, unknown> | null {
  const importIds = Array.from(new Set((input.importIds || []).map(cleanString).filter(Boolean)));
  if (!importIds.length) return null;
  const payload: Record<string, unknown> = {
    importIds,
    sourceKind: normalizeExternalPhotoImportSourceKind(cleanString(input.sourceKind)),
  };
  const sourceLabel = cleanString(input.sourceLabel);
  if (sourceLabel) payload.sourceLabel = sourceLabel;
  const sourceDetail = cleanString(input.sourceDetail);
  if (sourceDetail) payload.sourceDetail = sourceDetail;
  return payload;
}

export function photoImportHistoryArchivePayload(importIds: unknown[], archive = true): Record<string, unknown> | null {
  const cleanIds = Array.from(new Set((importIds || []).map(cleanString).filter(Boolean)));
  if (!cleanIds.length) return null;
  return {
    importIds: cleanIds,
    archive,
    reason: archive ? "Archived from import history" : "",
  };
}

export function photoImportHistoryArchiveNextActiveId(activeId: unknown, importIds: unknown[], archive = true): string {
  const cleanActiveId = cleanString(activeId);
  const cleanIds = new Set((importIds || []).map(cleanString).filter(Boolean));
  if (archive && Array.from(cleanIds).some((importId) => cleanActiveId === `import:${importId}`)) return "imports";
  return cleanActiveId;
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

export function photoImportHistorySourceOptions(summaries: PhotoImportSessionSummary[]): PhotoImportHistorySourceOption[] {
  const byKind = new Map<string, string>();
  summaries.forEach((session) => {
    if (!session.sourceKind || byKind.has(session.sourceKind)) return;
    byKind.set(session.sourceKind, session.sourceKindLabel);
  });
  return Array.from(byKind.entries())
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

export function buildPhotoImportHistoryState(input: PhotoImportHistoryStateInput): PhotoImportHistoryState {
  const activeId = cleanString(input.activeId);
  const activeFolder = input.activeFolder || null;
  const limit = Math.max(0, Math.round(Number(input.limit ?? PHOTO_IMPORT_HISTORY_RENDER_LIMIT)));
  const isImportHistoryActive = activeId === "imports" || activeId === "recentlyImported";
  const aggregateSessions = isImportHistoryActive && Array.isArray(activeFolder?.importSessions)
    ? activeFolder.importSessions
    : [];
  const archivedSessions = activeId === "imports" && Array.isArray(activeFolder?.archivedImportSessions)
    ? activeFolder.archivedImportSessions
    : [];
  const fallbackSessions = (input.folders || []).map((folder) => folder.importSession);
  const sourceSessions = aggregateSessions.length || archivedSessions.length
    ? [...aggregateSessions, ...archivedSessions]
    : fallbackSessions;
  const sourceLimit = Math.max(aggregateSessions.length + archivedSessions.length || fallbackSessions.length, PHOTO_IMPORT_HISTORY_RENDER_LIMIT);
  const allSummaries = isImportHistoryActive
    ? buildPhotoImportSessionSummaries(sourceSessions, sourceLimit)
    : [];
  const scopedSummaries = filterPhotoImportSessionSummaries(allSummaries, {
    libraryRoot: input.libraryRoot,
    showArchived: input.showArchived,
  });
  const sourceOptions = photoImportHistorySourceOptions(scopedSummaries);
  const filteredSummaries = filterPhotoImportSessionSummaries(scopedSummaries, {
    query: input.query,
    status: input.status,
    storage: input.storage,
    sourceKind: input.sourceKind,
    showArchived: input.showArchived,
  });
  const archivableSummaries = filteredSummaries.filter((session) => !session.archived && session.status !== "running");
  const visibleSummaries = filteredSummaries.slice(0, limit);
  const status = input.status || "all";
  const storage = input.storage || "all";
  const sourceKind = cleanLower(input.sourceKind || "all") || "all";
  const queryFiltersActive = Boolean(cleanString(input.query) || status !== "all" || storage !== "all" || sourceKind !== "all");
  const filtersActive = queryFiltersActive || Boolean(input.showArchived);
  const total = isImportHistoryActive
    ? Math.max(
      cleanNumber(activeFolder?.importSessionCount) + (input.showArchived ? cleanNumber(activeFolder?.archivedImportSessionCount) : 0),
      scopedSummaries.length,
    )
    : 0;
  const visibleTotal = cleanString(input.libraryRoot) ? scopedSummaries.length : total;
  const matchedTotal = filtersActive ? filteredSummaries.length : visibleTotal;
  return {
    allSummaries,
    scopedSummaries,
    sourceOptions,
    filteredSummaries,
    archivableSummaries,
    visibleSummaries,
    queryFiltersActive,
    filtersActive,
    total,
    visibleTotal,
    matchedTotal,
  };
}

export function photoImportHistoryCountLabel(
  state: Pick<PhotoImportHistoryState, "matchedTotal" | "queryFiltersActive" | "visibleSummaries" | "visibleTotal">,
  formatters: PhotoImportHistoryCountLabelFormatters = {},
): string {
  const visibleCount = state.visibleSummaries.length;
  if (state.queryFiltersActive) {
    if (state.matchedTotal > visibleCount) {
      return `${labelCount(formatters, visibleCount)} ${labelText(formatters, "of")} ${labelCount(formatters, state.matchedTotal)} ${labelText(formatters, "matches")} · ${labelCount(formatters, state.visibleTotal)} ${labelText(formatters, "sessions")}`;
    }
    return `${labelCount(formatters, state.matchedTotal)} ${labelText(formatters, state.matchedTotal === 1 ? "match" : "matches")} · ${labelCount(formatters, state.visibleTotal)} ${labelText(formatters, "sessions")}`;
  }
  if (state.visibleTotal > visibleCount) {
    return `${labelCount(formatters, visibleCount)} ${labelText(formatters, "of")} ${labelCount(formatters, state.visibleTotal)} ${labelText(formatters, "sessions")}`;
  }
  return `${labelCount(formatters, visibleCount)} ${labelText(formatters, visibleCount === 1 ? "session" : "sessions")}`;
}

export function photoImportHistoryProvenanceStatusLabel(updatedAssets: unknown, formatters: PhotoImportHistoryCountLabelFormatters = {}): string {
  const updated = cleanNumber(updatedAssets);
  return `${labelText(formatters, "Updated import source")} · ${labelCount(formatters, updated)} ${labelText(formatters, updated === 1 ? "item" : "items")}`;
}

export function photoImportHistoryBulkProvenanceStatusLabel(
  changed: unknown,
  updatedAssets: unknown,
  formatters: PhotoImportHistoryCountLabelFormatters = {},
): string {
  const cleanChanged = cleanNumber(changed);
  const updated = cleanNumber(updatedAssets);
  return `${labelText(formatters, "Updated import source")} · ${labelCount(formatters, cleanChanged)} · ${labelCount(formatters, updated)} ${labelText(formatters, updated === 1 ? "item" : "items")}`;
}

export function photoImportHistoryArchiveStatusLabel(
  archive: boolean,
  changed: unknown,
  formatters: PhotoImportHistoryCountLabelFormatters = {},
): string {
  return `${labelText(formatters, archive ? "Archived imports" : "Restored imports")} · ${labelCount(formatters, cleanNumber(changed))}`;
}

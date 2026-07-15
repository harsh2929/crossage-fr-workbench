import type { PhotoFolder, PhotoSearchIndexStatus } from "../types";

export interface PhotoIndexingFormatters {
  uiText?: (value: string) => string;
  formatCount?: (value: number) => string;
}

export interface PhotoIndexingQueueSummaryOptions extends PhotoIndexingFormatters {
  localIntelligenceEnabled?: boolean;
  backgroundIndexingAutoRun?: boolean;
}

export interface PhotoIndexingQueueSummary {
  counts: Record<string, unknown> | null;
  jobs: Array<Record<string, unknown>>;
  queuedCount: number;
  runningCount: number;
  pausedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount: number;
  hasRunnableCatalogJob: boolean;
  hasRetryableCatalogJob: boolean;
  canRunQueuedJobs: boolean;
  canRetryFailedJobs: boolean;
  text: string;
}

export interface PhotoActiveCatalogIndexNoticeInput extends PhotoIndexingFormatters {
  jobs: readonly Record<string, unknown>[];
  activeJobId?: string;
  activeTrip?: PhotoFolder | null;
  activeMemory?: PhotoFolder | null;
  activeMemoryUserCreated?: boolean;
  activeAlbum?: PhotoFolder | null;
  activeAlbumFolder?: PhotoFolder | null;
}

export interface PhotoActiveCatalogIndexNotice {
  job: Record<string, unknown> | null;
  generatedJob: Record<string, unknown> | null;
  smartJob: Record<string, unknown> | null;
  status: string;
  result: Record<string, unknown>;
  progress: Record<string, unknown>;
  progressTotal: number;
  progressProcessed: number;
  progressUpdated: number;
  progressFailed: number;
  progressSkipped: number;
  progressDeferred: number;
  progressDone: number;
  progressPercent: number;
  progressParts: string[];
  target: string;
  title: string;
  queueHint: string;
  detail: string;
  noticeClass: string;
}

export interface PhotoSearchIndexNotice extends PhotoIndexingFormatters {
  activeStatus: PhotoSearchIndexStatus | null;
  pending: boolean;
  assetCount: number;
  indexedCount: number;
  remainingCount: number;
  processedCount: number;
  job: PhotoSearchIndexStatus["job"] | null;
  jobStatus: string;
  detail: string;
  queueDetail: string;
}

const PHOTO_CATALOG_JOB_KINDS = new Set(["search", "generated_collections", "smart_albums"]);
const PHOTO_ACTIVE_CATALOG_STATUSES = new Set(["queued", "running", "paused", "failed"]);

function text(formatters: PhotoIndexingFormatters, value: string): string {
  return formatters.uiText ? formatters.uiText(value) : value;
}

function count(formatters: PhotoIndexingFormatters, value: number): string {
  return formatters.formatCount ? formatters.formatCount(value) : value.toLocaleString();
}

function cleanString(value: unknown): string {
  return String(value || "").trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function maybeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberValue(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function queueCount(value: Record<string, unknown>, counts: Record<string, unknown> | null, key: string): number {
  return numberValue(value[key] ?? counts?.[key] ?? 0);
}

function cleanFolderId(value: unknown, prefix: string): string {
  return cleanString(value).replace(new RegExp(`^${prefix}:`), "");
}

function isCatalogJobKind(jobKind: string): boolean {
  return PHOTO_CATALOG_JOB_KINDS.has(jobKind);
}

export function photoIndexingJobStatus(job: Record<string, unknown>, activeJobId = ""): string {
  return activeJobId && cleanString(job.jobId) === activeJobId ? "running" : cleanString(job.status);
}

export function photoIndexingJobVisible(job: Record<string, unknown>, jobKind: string, activeJobId = ""): boolean {
  if (cleanString(job.jobKind) !== jobKind) return false;
  return PHOTO_ACTIVE_CATALOG_STATUSES.has(photoIndexingJobStatus(job, activeJobId));
}

export function photoIndexingQueueSummary(
  value: Record<string, unknown> | null | undefined,
  options: PhotoIndexingQueueSummaryOptions = {},
): PhotoIndexingQueueSummary {
  const record = asRecord(value);
  const counts = maybeRecord(record.counts);
  const jobs = Array.isArray(record.jobs)
    ? (record.jobs as unknown[])
      .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row)))
      .slice(0, 5)
    : [];
  const queuedCount = queueCount(record, counts, "queued");
  const runningCount = queueCount(record, counts, "running");
  const pausedCount = queueCount(record, counts, "paused");
  const completedCount = queueCount(record, counts, "completed");
  const failedCount = queueCount(record, counts, "failed");
  const cancelledCount = queueCount(record, counts, "cancelled");
  const hasRunnableCatalogJob = jobs.some((job) => {
    const jobKind = cleanString(job.jobKind);
    const status = cleanString(job.status);
    return isCatalogJobKind(jobKind) && (status === "queued" || status === "paused");
  });
  const hasRetryableCatalogJob = jobs.some((job) => {
    const jobKind = cleanString(job.jobKind);
    return isCatalogJobKind(jobKind) && cleanString(job.status) === "failed";
  });
  const canRunQueuedJobs = Boolean(options.localIntelligenceEnabled || hasRunnableCatalogJob);
  const canRetryFailedJobs = Boolean(options.localIntelligenceEnabled || hasRetryableCatalogJob);
  const summaryText = value
    ? `${text(options, "Queue")} ${count(options, queuedCount)} · ${text(options, "running")} ${count(options, runningCount)} · ${text(options, "paused")} ${count(options, pausedCount)} · ${text(options, "completed")} ${count(options, completedCount)} · ${text(options, "failed")} ${count(options, failedCount)} · ${text(options, "cancelled")} ${count(options, cancelledCount)} · ${options.backgroundIndexingAutoRun ? text(options, "auto") : text(options, "manual")}`
    : text(options, "Local indexing queue unavailable");
  return {
    counts,
    jobs,
    queuedCount,
    runningCount,
    pausedCount,
    completedCount,
    failedCount,
    cancelledCount,
    hasRunnableCatalogJob,
    hasRetryableCatalogJob,
    canRunQueuedJobs,
    canRetryFailedJobs,
    text: summaryText,
  };
}

function smartCatalogJobMatches(job: Record<string, unknown>, activeAlbum?: PhotoFolder | null, activeAlbumFolder?: PhotoFolder | null): boolean {
  const scope = asRecord(job.scope);
  const scopeAlbumId = cleanString(scope.albumId || scope.album).replace(/^album:/, "");
  const scopeFolderId = cleanString(scope.folderId || scope.albumFolderId || scope.folder).replace(/^albumFolder:/, "");
  const activeAlbumId = cleanString(activeAlbum?.albumId);
  const activeFolderId = cleanFolderId(activeAlbumFolder?.folderId || activeAlbumFolder?.id, "albumFolder");
  if (scopeAlbumId) return Boolean(activeAlbumId && scopeAlbumId === activeAlbumId);
  if (scopeFolderId) return Boolean((activeFolderId && scopeFolderId === activeFolderId) || (activeAlbum?.folderId && scopeFolderId === activeAlbum.folderId));
  return true;
}

export function photoActiveCatalogIndexNotice(input: PhotoActiveCatalogIndexNoticeInput): PhotoActiveCatalogIndexNotice {
  const generatedJob = (input.activeTrip || input.activeMemory) && !input.activeMemoryUserCreated
    ? input.jobs.find((job) => photoIndexingJobVisible(job, "generated_collections", input.activeJobId)) || null
    : null;
  const smartJob = (input.activeAlbum?.albumKind === "smart" || input.activeAlbumFolder)
    ? input.jobs.find((job) => photoIndexingJobVisible(job, "smart_albums", input.activeJobId) && smartCatalogJobMatches(job, input.activeAlbum, input.activeAlbumFolder)) || null
    : null;
  const job = generatedJob || smartJob;
  const status = job ? photoIndexingJobStatus(job, input.activeJobId) : "";
  const result = asRecord(job?.result);
  const progress = asRecord(result.progress);
  const progressTotal = numberValue(progress.total);
  const progressProcessed = numberValue(progress.processed);
  const progressUpdated = numberValue(progress.updated);
  const progressFailed = numberValue(progress.failed);
  const progressSkipped = numberValue(progress.skipped);
  const progressDeferred = numberValue(progress.deferred);
  const progressDone = Math.min(
    progressTotal || progressProcessed + progressUpdated + progressFailed + progressSkipped,
    Math.max(progressProcessed, progressUpdated + progressFailed + progressSkipped),
  );
  const progressPercent = progressTotal > 0
    ? Math.max(0, Math.min(100, Math.round((progressDone / progressTotal) * 100)))
    : 0;
  const target = generatedJob
    ? input.activeMemory
      ? `${text(input, "Memory")}: ${input.activeMemory.name || input.activeMemory.memory?.name || text(input, "Memory")}`
      : `${text(input, "Trip")}: ${input.activeTrip?.name || input.activeTrip?.trip?.name || text(input, "Trip")}`
    : input.activeAlbum
      ? `${text(input, "Smart album")}: ${input.activeAlbum.name || text(input, "Smart album")}`
      : input.activeAlbumFolder
        ? `${text(input, "Album folder")}: ${input.activeAlbumFolder.name || text(input, "Album folder")}`
        : "";
  const progressParts = [
    progress.total !== undefined ? `${text(input, "total")} ${count(input, progressTotal)}` : "",
    progress.processed !== undefined ? `${text(input, "processed")} ${count(input, progressProcessed)}` : "",
    progress.updated !== undefined ? `${text(input, "updated")} ${count(input, progressUpdated)}` : "",
    progress.skipped !== undefined ? `${text(input, "skipped")} ${count(input, progressSkipped)}` : "",
    progress.failed !== undefined ? `${text(input, "failed")} ${count(input, progressFailed)}` : "",
    progress.deferred !== undefined ? `${text(input, "deferred")} ${count(input, progressDeferred)}` : "",
  ].filter(Boolean);
  const title = generatedJob
    ? status === "failed"
      ? text(input, "Generated collections need queue attention")
      : text(input, "Generated collections are catching up")
    : smartJob
      ? status === "failed"
        ? text(input, "Smart album cache needs queue attention")
        : text(input, "Smart album cache is catching up")
      : "";
  const queueHint = status === "failed"
    ? text(input, "Open Queue status to inspect or retry the local catalog refresh.")
    : status === "running"
      ? text(input, "Local catalog refresh is running in the indexing queue.")
      : status === "paused"
        ? text(input, "Local indexing is paused; resume or run the queue to continue.")
        : text(input, "Waiting for the local indexing queue.");
  const detail = [
    target,
    status ? text(input, status) : "",
    progressParts.length ? progressParts.join(" · ") : "",
    cleanString(job?.error || result.error),
  ].filter(Boolean).join(" · ");
  return {
    job,
    generatedJob,
    smartJob,
    status,
    result,
    progress,
    progressTotal,
    progressProcessed,
    progressUpdated,
    progressFailed,
    progressSkipped,
    progressDeferred,
    progressDone,
    progressPercent,
    progressParts,
    target,
    title,
    queueHint,
    detail,
    noticeClass: generatedJob ? "generated-collections" : smartJob ? "smart-albums" : "",
  };
}

export function photoPendingSearchIndexStatus(status: PhotoSearchIndexStatus | null | undefined): PhotoSearchIndexStatus | null {
  return status && !status.completed && (status.pending || status.cold || status.queued) ? status : null;
}

export function photoSearchIndexNotice(
  primaryStatus: PhotoSearchIndexStatus | null | undefined,
  fallbackStatus: PhotoSearchIndexStatus | null | undefined,
  formatters: PhotoIndexingFormatters = {},
): PhotoSearchIndexNotice {
  const activeStatus = photoPendingSearchIndexStatus(primaryStatus) || photoPendingSearchIndexStatus(fallbackStatus);
  const assetCount = numberValue(activeStatus?.assetCount);
  const indexedCount = numberValue(activeStatus?.indexCount ?? activeStatus?.indexedCount);
  const remainingCount = numberValue(
    activeStatus?.remainingMissingCount
    ?? activeStatus?.missingCount
    ?? activeStatus?.progress?.deferred,
  );
  const processedCount = numberValue(
    activeStatus?.progress?.processed
    ?? activeStatus?.progress?.updated
    ?? activeStatus?.indexedCount,
  );
  const job = activeStatus?.job && typeof activeStatus.job === "object" ? activeStatus.job : null;
  const jobStatus = cleanString(job?.status || (activeStatus?.queued ? "queued" : ""));
  const missingRows = remainingCount || assetCount;
  const detail = activeStatus?.cold
    ? `${count(formatters, missingRows)} ${text(formatters, "photo search row")}${missingRows === 1 ? "" : "s"} ${text(formatters, "need indexing before search is complete.")}`
    : [
      remainingCount ? `${count(formatters, remainingCount)} ${text(formatters, "remaining")}` : "",
      processedCount ? `${count(formatters, processedCount)} ${text(formatters, "processed")}` : "",
      indexedCount ? `${count(formatters, indexedCount)} ${text(formatters, "indexed")}` : "",
    ].filter(Boolean).join(" · ") || text(formatters, "Search results may be incomplete until the queue finishes.");
  const queueDetail = jobStatus
    ? `${text(formatters, "Search index job")} ${text(formatters, jobStatus)}.`
    : activeStatus?.queued
      ? text(formatters, "Search index job queued.")
      : text(formatters, "Run the local indexing queue to continue search indexing.");
  return {
    activeStatus,
    pending: Boolean(activeStatus),
    assetCount,
    indexedCount,
    remainingCount,
    processedCount,
    job,
    jobStatus,
    detail,
    queueDetail,
  };
}

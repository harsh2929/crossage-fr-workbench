import type { CandidateStatus } from "./types";
import { recordAppStorageIssue } from "./appStorageDiagnostics";

export type SavedScanSource = {
  id: string;
  label: string;
  path: string;
  createdAt: number;
  lastUsedAt: number;
};

export type ScanQueueItem = SavedScanSource & {
  status: "queued" | "running" | "done" | "error";
  message?: string;
};

export type ReviewLane = "all" | "high" | "lowQuality" | "groups" | "video" | "notes" | "closeRunner" | "singleReference";
export const reviewLanes: ReviewLane[] = ["all", "high", "lowQuality", "groups", "video", "notes", "closeRunner", "singleReference"];

export type SavedReviewView = {
  id: string;
  label: string;
  statusFilter: CandidateStatus | "all";
  reviewLane: ReviewLane;
  search: string;
  sort: "score" | "newest" | "quality";
  createdAt: number;
  lastUsedAt: number;
};

function basename(value: string | null | undefined) {
  if (!value) return "";
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function finiteTimestamp(value: unknown, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

export function savedScanSourcesKey(workspace: string | null | undefined) {
  return `vintrace:scan-sources:${workspace || "default"}`;
}

export function normalizeSavedScanSources(rows: unknown, fallbackTime = Date.now()): SavedScanSource[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = objectRecord(row);
      const rawPath = typeof record?.path === "string" ? record.path : "";
      if (!rawPath) return null;
      const createdAt = finiteTimestamp(record?.createdAt, fallbackTime);
      return {
        id: String(record?.id || rawPath),
        label: String(record?.label || basename(rawPath)),
        path: rawPath,
        createdAt,
        lastUsedAt: finiteTimestamp(record?.lastUsedAt, createdAt)
      };
    })
    .filter((row): row is SavedScanSource => Boolean(row))
    .slice(0, 40);
}

export function readSavedScanSources(workspace: string | null | undefined): SavedScanSource[] {
  const key = savedScanSourcesKey(workspace);
  try {
    return normalizeSavedScanSources(JSON.parse(window.localStorage.getItem(key) || "[]"));
  } catch (error) {
    recordAppStorageIssue("savedScanSources", "read", key, error);
    return [];
  }
}

export function writeSavedScanSources(workspace: string | null | undefined, sources: SavedScanSource[]) {
  const key = savedScanSourcesKey(workspace);
  try {
    window.localStorage.setItem(key, JSON.stringify(sources.slice(0, 40)));
  } catch (error) {
    recordAppStorageIssue("savedScanSources", "write", key, error);
  }
}

export function scanQueueKey(workspace: string | null | undefined) {
  return `vintrace:scan-queue:${workspace || "default"}`;
}

export function normalizeScanQueue(rows: unknown, fallbackTime = Date.now()): ScanQueueItem[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): ScanQueueItem | null => {
      const record = objectRecord(row);
      const rawPath = typeof record?.path === "string" ? record.path : "";
      if (!rawPath) return null;
      const createdAt = finiteTimestamp(record?.createdAt, fallbackTime);
      const status = ["queued", "running", "done", "error"].includes(String(record?.status)) ? record?.status as ScanQueueItem["status"] : "queued";
      const message = typeof record?.message === "string" ? record.message : undefined;
      const item: ScanQueueItem = {
        id: String(record?.id || rawPath),
        label: String(record?.label || basename(rawPath)),
        path: rawPath,
        createdAt,
        lastUsedAt: finiteTimestamp(record?.lastUsedAt, createdAt),
        status,
      };
      if (message !== undefined) item.message = message;
      return item;
    })
    .filter((row): row is ScanQueueItem => Boolean(row))
    .slice(0, 80);
}

export function readScanQueue(workspace: string | null | undefined): ScanQueueItem[] {
  const key = scanQueueKey(workspace);
  try {
    return normalizeScanQueue(JSON.parse(window.localStorage.getItem(key) || "[]"));
  } catch (error) {
    recordAppStorageIssue("scanQueue", "read", key, error);
    return [];
  }
}

export function writeScanQueue(workspace: string | null | undefined, queue: ScanQueueItem[]) {
  const key = scanQueueKey(workspace);
  try {
    window.localStorage.setItem(key, JSON.stringify(queue.slice(0, 80)));
  } catch (error) {
    recordAppStorageIssue("scanQueue", "write", key, error);
  }
}

export function savedReviewViewsKey(workspace: string | null | undefined) {
  return `vintrace:review-views:${workspace || "default"}`;
}

export function normalizeSavedReviewViews(rows: unknown, fallbackTime = Date.now()): SavedReviewView[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      const record = objectRecord(row);
      if (typeof record?.label !== "string") return null;
      const createdAt = finiteTimestamp(record.createdAt, fallbackTime);
      const rawStatus = String(record.statusFilter);
      const rawLane = String(record.reviewLane);
      const rawSort = String(record.sort);
      return {
        id: String(record.id || `${record.label}:${createdAt}`),
        label: record.label.slice(0, 60),
        statusFilter: ["all", "pending", "accepted", "rejected", "uncertain"].includes(rawStatus) ? rawStatus as SavedReviewView["statusFilter"] : "pending",
        reviewLane: reviewLanes.includes(rawLane as ReviewLane) ? rawLane as ReviewLane : "all",
        search: String(record.search || "").slice(0, 120),
        sort: ["score", "newest", "quality"].includes(rawSort) ? rawSort as SavedReviewView["sort"] : "score",
        createdAt,
        lastUsedAt: finiteTimestamp(record.lastUsedAt, createdAt)
      };
    })
    .filter((row): row is SavedReviewView => Boolean(row))
    .slice(0, 16);
}

export function readSavedReviewViews(workspace: string | null | undefined): SavedReviewView[] {
  const key = savedReviewViewsKey(workspace);
  try {
    return normalizeSavedReviewViews(JSON.parse(window.localStorage.getItem(key) || "[]"));
  } catch (error) {
    recordAppStorageIssue("savedReviewViews", "read", key, error);
    return [];
  }
}

export function writeSavedReviewViews(workspace: string | null | undefined, views: SavedReviewView[]) {
  const key = savedReviewViewsKey(workspace);
  try {
    window.localStorage.setItem(key, JSON.stringify(views.slice(0, 16)));
  } catch (error) {
    recordAppStorageIssue("savedReviewViews", "write", key, error);
  }
}

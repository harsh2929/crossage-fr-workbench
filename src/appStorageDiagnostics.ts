export const APP_STORAGE_ISSUE_EVENT = "vintrace:storage-issue";

export type AppStorageArea =
  | "language"
  | "onboarding"
  | "agentDiscovery"
  | "savedScanSources"
  | "scanQueue"
  | "savedReviewViews"
  | "reviewFocusHistory"
  | "mediaDestinations"
  | "photoImportFlag";

export type AppStorageOperation = "read" | "write";

export type AppStorageDiagnostic = {
  area: AppStorageArea;
  operation: AppStorageOperation;
  key: string;
  message: string;
  at: number;
};

const MAX_STORAGE_DIAGNOSTICS = 20;
const STORAGE_DIAGNOSTIC_DEDUPE_MS = 60_000;

let diagnostics: AppStorageDiagnostic[] = [];
const recentSignatures = new Map<string, number>();

function storageErrorMessage(error: unknown) {
  const redactPaths = (value: string) => value
    .replace(/[A-Za-z]:\\[^\s'")]+/g, "[path]")
    .replace(/\/(?:Users|Volumes|private|home|var|tmp)\/[^\s'")]+/g, "[path]");
  if (error instanceof Error) {
    const label = [error.name, error.message].filter(Boolean).join(": ");
    return redactPaths(label).slice(0, 220) || "Storage operation failed.";
  }
  return redactPaths(String(error || "Storage operation failed.")).slice(0, 220);
}

export function safeStorageKeyLabel(key: string) {
  const text = String(key || "");
  if (!text.startsWith("vintrace:")) return "[storage-key]";
  const parts = text.split(":");
  if (parts.length <= 2) return text.slice(0, 80);
  return `${parts[0]}:${parts[1]}:<scope>`;
}

export function appStorageAreaLabel(area: AppStorageArea) {
  switch (area) {
    case "language":
      return "language preference";
    case "onboarding":
      return "onboarding preference";
    case "agentDiscovery":
      return "agent platform discovery preference";
    case "savedScanSources":
      return "saved scan sources";
    case "scanQueue":
      return "scan queue";
    case "savedReviewViews":
      return "saved review views";
    case "reviewFocusHistory":
      return "review focus history";
    case "mediaDestinations":
      return "media destinations";
    case "photoImportFlag":
      return "photo import state";
    default:
      return "local app state";
  }
}

export function appStorageIssueNoticeText(issue: AppStorageDiagnostic) {
  const verb = issue.operation === "read" ? "loading" : "saving";
  return `Local app storage failed while ${verb} ${appStorageAreaLabel(issue.area)}. Recent queues or views may not persist.`;
}

export function recordAppStorageIssue(
  area: AppStorageArea,
  operation: AppStorageOperation,
  key: string,
  error: unknown,
  now = Date.now()
) {
  const diagnostic: AppStorageDiagnostic = {
    area,
    operation,
    key: safeStorageKeyLabel(key),
    message: storageErrorMessage(error),
    at: now
  };
  const signature = `${diagnostic.area}:${diagnostic.operation}:${diagnostic.key}:${diagnostic.message}`;
  const lastSeen = recentSignatures.get(signature) || 0;
  if (recentSignatures.has(signature) && now - lastSeen < STORAGE_DIAGNOSTIC_DEDUPE_MS) return null;
  recentSignatures.set(signature, now);
  diagnostics = [...diagnostics, diagnostic].slice(-MAX_STORAGE_DIAGNOSTICS);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[storage] ${diagnostic.operation} failed for ${appStorageAreaLabel(diagnostic.area)} (${diagnostic.key}): ${diagnostic.message}`
    );
  }
  if (
    typeof window !== "undefined"
    && typeof window.dispatchEvent === "function"
    && typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent<AppStorageDiagnostic>(APP_STORAGE_ISSUE_EVENT, { detail: diagnostic }));
  }
  return diagnostic;
}

export function getAppStorageDiagnostics() {
  return diagnostics.slice();
}

export function clearAppStorageDiagnosticsForTest() {
  diagnostics = [];
  recentSignatures.clear();
}

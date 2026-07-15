import { useSyncExternalStore } from "react";
import type { ScanProgress } from "./types";

const scanProgressListeners = new Set<() => void>();
let scanProgressSnapshot: ScanProgress | null = null;

export function getScanProgressSnapshot(): ScanProgress | null {
  return scanProgressSnapshot;
}

export function setScanProgressSnapshot(next: ScanProgress | null): void {
  if (scanProgressSnapshot === next) return;
  scanProgressSnapshot = next;
  for (const listener of scanProgressListeners) {
    listener();
  }
}

export function subscribeScanProgress(listener: () => void): () => void {
  scanProgressListeners.add(listener);
  return () => {
    scanProgressListeners.delete(listener);
  };
}

export function useScanProgress(): ScanProgress | null {
  return useSyncExternalStore(
    subscribeScanProgress,
    getScanProgressSnapshot,
    getScanProgressSnapshot
  );
}

export function scanProgressIsActive(progress: ScanProgress | null): boolean {
  return Boolean(progress && !["complete", "cancelled", "error"].includes(progress.phase));
}

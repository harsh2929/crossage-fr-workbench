import { useCallback, useEffect, useState } from "react";
import { recordAppStorageIssue } from "./appStorageDiagnostics";
import {
  normalizeReviewFocusHistory,
  removeReviewFocusHistoryItem,
  reviewFocusHistoryStorageKey,
  upsertReviewFocusHistory,
  type ReviewFocusHistoryRecord
} from "./views/reviewFocusHistory";

export type { ReviewFocusHistoryRecord } from "./views/reviewFocusHistory";

const REVIEW_FOCUS_HISTORY_MAX_BYTES = 262144;

function readReviewFocusHistoryJson(key: string): unknown {
  const raw = window.localStorage.getItem(key) || "[]";
  if (raw.length > REVIEW_FOCUS_HISTORY_MAX_BYTES) {
    throw new Error("Stored payload exceeded the 256 KiB safety limit.");
  }
  return JSON.parse(raw);
}

export function readReviewFocusHistory(workspace: string | null | undefined): ReviewFocusHistoryRecord[] {
  const key = reviewFocusHistoryStorageKey(workspace);
  try {
    return normalizeReviewFocusHistory(readReviewFocusHistoryJson(key));
  } catch (error) {
    recordAppStorageIssue("reviewFocusHistory", "read", key, error);
    return [];
  }
}

export function writeReviewFocusHistory(workspace: string | null | undefined, history: ReviewFocusHistoryRecord[]) {
  const key = reviewFocusHistoryStorageKey(workspace);
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizeReviewFocusHistory(history)));
  } catch (error) {
    recordAppStorageIssue("reviewFocusHistory", "write", key, error);
  }
}

export function useReviewFocusHistoryState(workspace: string | null | undefined) {
  const [reviewFocusHistory, setReviewFocusHistory] = useState<ReviewFocusHistoryRecord[]>([]);

  useEffect(() => {
    setReviewFocusHistory(readReviewFocusHistory(workspace));
  }, [workspace]);

  const addReviewFocusHistory = useCallback(
    (input: { label?: string; candidateIds: string[] }) => {
      setReviewFocusHistory((current) => {
        const next = upsertReviewFocusHistory(current, input);
        writeReviewFocusHistory(workspace, next);
        return next;
      });
    },
    [workspace]
  );

  const removeReviewFocusHistory = useCallback(
    (recordId: string) => {
      setReviewFocusHistory((current) => {
        const next = removeReviewFocusHistoryItem(current, recordId);
        writeReviewFocusHistory(workspace, next);
        return next;
      });
    },
    [workspace]
  );

  return {
    reviewFocusHistory,
    addReviewFocusHistory,
    removeReviewFocusHistory,
  };
}

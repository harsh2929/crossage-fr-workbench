import { useCallback, useEffect, useRef, useState } from "react";

import type {
  PhotoRelationshipNameReviewResult,
  PhotoRelationshipNameSuggestion,
  PhotoRelationshipNameSuggestionResult,
} from "../types";

type RelationshipSuggestionConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
};

export function usePhotoRelationshipSuggestions(options: {
  resetSignal: string;
  suggest: (params?: Record<string, unknown>) => Promise<{ value: PhotoRelationshipNameSuggestionResult }>;
  review: (params: Record<string, unknown>) => Promise<{ value?: PhotoRelationshipNameReviewResult }>;
  confirmAction: (confirmation: RelationshipSuggestionConfirmation) => Promise<boolean>;
  onApplied: () => Promise<void>;
  notify: (toast: { tone: "ok"; message: string }) => void;
  uiText: (value: string) => string;
}) {
  const [result, setResult] = useState<PhotoRelationshipNameSuggestionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewingId, setReviewingId] = useState("");
  const loadSequenceRef = useRef(0);
  const loadingRef = useRef(false);
  const reviewingIdRef = useRef("");

  useEffect(() => {
    loadSequenceRef.current += 1;
    loadingRef.current = false;
    reviewingIdRef.current = "";
    setResult(null);
    setError("");
    setReviewingId("");
    setLoading(false);
  }, [options.resetSignal]);

  const load = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    const requestSequence = ++loadSequenceRef.current;
    setLoading(true);
    setError("");
    try {
      const response = await options.suggest({ limit: 50, perClusterLimit: 3 });
      if (requestSequence !== loadSequenceRef.current) return;
      setResult(response.value || null);
    } catch (loadError) {
      if (requestSequence !== loadSequenceRef.current) return;
      setError(loadError instanceof Error ? loadError.message : options.uiText("Could not load relationship suggestions."));
    } finally {
      if (requestSequence === loadSequenceRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [options.suggest, options.uiText]);

  const dismiss = useCallback(async (suggestion: PhotoRelationshipNameSuggestion) => {
    if (!suggestion.suggestionId || reviewingIdRef.current) return;
    reviewingIdRef.current = suggestion.suggestionId;
    setReviewingId(suggestion.suggestionId);
    setError("");
    try {
      await options.review({
        suggestionId: suggestion.suggestionId,
        sourceCluster: suggestion.sourceCluster,
        targetPerson: suggestion.targetPerson,
        decision: "dismissed",
      });
      setResult((current) => current ? {
        ...current,
        suggestions: current.suggestions.filter((row) => row.suggestionId !== suggestion.suggestionId),
      } : current);
      options.notify({ tone: "ok", message: options.uiText("Suggestion dismissed.") });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      reviewingIdRef.current = "";
      setReviewingId("");
    }
  }, [options.notify, options.review, options.uiText]);

  const apply = useCallback(async (suggestion: PhotoRelationshipNameSuggestion) => {
    if (!suggestion.suggestionId || reviewingIdRef.current) return;
    const confirmed = await options.confirmAction({
      title: options.uiText("Review identity suggestion"),
      message: options.uiText("Merge this unnamed cluster into the suggested person? The change is undoable."),
      confirmLabel: options.uiText("Merge identity"),
      danger: false,
    });
    if (!confirmed || reviewingIdRef.current) return;
    reviewingIdRef.current = suggestion.suggestionId;
    setReviewingId(suggestion.suggestionId);
    setError("");
    try {
      const nonce = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await options.review({
        suggestionId: suggestion.suggestionId,
        sourceCluster: suggestion.sourceCluster,
        targetPerson: suggestion.targetPerson,
        decision: "applied",
        confirm: true,
        idempotencyKey: `photo-relationship:${suggestion.suggestionId}:${nonce}`,
      });
      setResult((current) => current ? {
        ...current,
        suggestions: current.suggestions.filter(
          (row) => row.sourceCluster.toLocaleLowerCase() !== suggestion.sourceCluster.toLocaleLowerCase(),
        ),
      } : current);
      await options.onApplied();
      options.notify({ tone: "ok", message: options.uiText("Suggestion merged.") });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : String(reviewError));
    } finally {
      reviewingIdRef.current = "";
      setReviewingId("");
    }
  }, [options.confirmAction, options.notify, options.onApplied, options.review, options.uiText]);

  return { result, loading, error, reviewingId, load, dismiss, apply };
}

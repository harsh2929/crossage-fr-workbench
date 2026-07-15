import { Archive, Send, X } from "lucide-react";

type PhotoSelectionReviewActionsProps = {
  selectedCandidateCount: number;
  selectedDuplicateGroupCount: number;
  duplicatesActive: boolean;
  busy: boolean;
  savingMetadata: boolean;
  uiText: (value: string) => string;
  onOpenReview: () => void;
  onMergeDuplicateGroups: () => void;
  onDismissDuplicateGroups: () => void;
};

export function PhotoSelectionReviewActions({
  selectedCandidateCount,
  selectedDuplicateGroupCount,
  duplicatesActive,
  busy,
  savingMetadata,
  uiText,
  onOpenReview,
  onMergeDuplicateGroups,
  onDismissDuplicateGroups,
}: PhotoSelectionReviewActionsProps) {
  const duplicateActionDisabled = !selectedDuplicateGroupCount || busy || savingMetadata;
  return (
    <>
      <button type="button" className="secondary compact-action" onClick={onOpenReview} disabled={!selectedCandidateCount || busy}>
        <Send size={14} />
        <span>{uiText("Review")}</span>
      </button>
      {duplicatesActive && (
        <>
          <button type="button" className="secondary compact-action" onClick={onMergeDuplicateGroups} disabled={duplicateActionDisabled}>
            <Archive size={14} />
            <span>{uiText("Merge groups")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={onDismissDuplicateGroups} disabled={duplicateActionDisabled}>
            <X size={14} />
            <span>{uiText("Dismiss groups")}</span>
          </button>
        </>
      )}
    </>
  );
}

import { Archive, ExternalLink, FolderInput, ImageIcon, Printer, Scissors } from "lucide-react";

type PhotoSelectionOriginalActionsProps = {
  selectedCount: number;
  selectedConsolidatableCount: number;
  selectedCandidateCount: number;
  selectedPathOnlyCount: number;
  selectedFirstMissing: boolean;
  busy: boolean;
  consolidating: boolean;
  preferredExternalEditorAvailable: boolean;
  uiText: (value: string) => string;
  onConsolidate: () => void;
  onRevealOriginal: () => void;
  onOpenOriginal: () => void;
  onPrintOriginal: () => void;
  onOpenOriginalWith: () => void;
  onOpenOriginalWithLast: () => void;
  onMove: () => void;
  onExportBundle: () => void;
};

export function PhotoSelectionOriginalActions({
  selectedCount,
  selectedConsolidatableCount,
  selectedCandidateCount,
  selectedPathOnlyCount,
  selectedFirstMissing,
  busy,
  consolidating,
  preferredExternalEditorAvailable,
  uiText,
  onConsolidate,
  onRevealOriginal,
  onOpenOriginal,
  onPrintOriginal,
  onOpenOriginalWith,
  onOpenOriginalWithLast,
  onMove,
  onExportBundle,
}: PhotoSelectionOriginalActionsProps) {
  const selectedOriginalActionDisabled = !selectedCount || busy || selectedFirstMissing;
  return (
    <>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onConsolidate}
        disabled={!selectedConsolidatableCount || busy || consolidating}
      >
        <FolderInput size={14} />
        <span>{consolidating ? uiText("Consolidating") : uiText("Consolidate")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onRevealOriginal} disabled={selectedOriginalActionDisabled}>
        <FolderInput size={14} />
        <span>{uiText("Reveal original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onOpenOriginal} disabled={selectedOriginalActionDisabled}>
        <ImageIcon size={14} />
        <span>{uiText("Open original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onPrintOriginal} disabled={selectedOriginalActionDisabled}>
        <Printer size={14} />
        <span>{uiText("Print original")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onOpenOriginalWith} disabled={selectedOriginalActionDisabled}>
        <ExternalLink size={14} />
        <span>{uiText("Open with...")}</span>
      </button>
      {preferredExternalEditorAvailable && (
        <button
          type="button"
          className="secondary compact-action"
          onClick={onOpenOriginalWithLast}
          disabled={selectedOriginalActionDisabled}
        >
          <ExternalLink size={14} />
          <span>{uiText("Open with last")}</span>
        </button>
      )}
      <button
        type="button"
        className="secondary compact-action"
        onClick={onMove}
        disabled={(!selectedCandidateCount && !selectedPathOnlyCount) || busy}
      >
        <Scissors size={14} />
        <span>{uiText("Move")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onExportBundle} disabled={!selectedCandidateCount || busy}>
        <Archive size={14} />
        <span>{uiText("Bundle")}</span>
      </button>
    </>
  );
}

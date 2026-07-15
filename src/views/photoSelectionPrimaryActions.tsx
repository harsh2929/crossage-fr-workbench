import { Copy, Download, Images, MinusCircle, MoreHorizontal, Printer, Send, SlidersHorizontal } from "lucide-react";

type PhotoSelectionPrimaryActionsProps = {
  selectedCount: number;
  hasItems: boolean;
  busy: boolean;
  contactSheetExporting: boolean;
  canPrintContactSheet: boolean;
  slideshowLoading: boolean;
  memoryVisible: boolean;
  photoCurationSaving: boolean;
  uiText: (value: string) => string;
  onExport: () => void;
  onShareOriginals: () => void;
  onExportContactSheet: () => void;
  onPrintContactSheet: () => void;
  onStartSlideshow: () => void;
  onRemoveFromMemory: () => void;
  onToggleExportOptions: () => void;
  onCopySelected: () => void;
};

export function PhotoSelectionPrimaryActions({
  selectedCount,
  hasItems,
  busy,
  contactSheetExporting,
  canPrintContactSheet,
  slideshowLoading,
  memoryVisible,
  photoCurationSaving,
  uiText,
  onExport,
  onShareOriginals,
  onExportContactSheet,
  onPrintContactSheet,
  onStartSlideshow,
  onRemoveFromMemory,
  onToggleExportOptions,
  onCopySelected,
}: PhotoSelectionPrimaryActionsProps) {
  return (
    <>
      <button type="button" className="secondary compact-action" onClick={onExport} disabled={!selectedCount || busy}>
        <Download size={14} />
        <span>{uiText("Export")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onShareOriginals} disabled={!selectedCount || busy}>
        <Send size={14} />
        <span>{uiText("Share")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onStartSlideshow}
        disabled={!hasItems || busy || slideshowLoading}
      >
        <Images size={14} />
        <span>{slideshowLoading ? uiText("Loading slideshow") : selectedCount ? uiText("Slideshow selected") : uiText("Slideshow")}</span>
      </button>
      <details className="photo-selection-output-actions">
        <summary>
          <MoreHorizontal size={14} />
          <span>{uiText("More output options")}</span>
        </summary>
        <div>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onExportContactSheet}
            disabled={!selectedCount || busy || contactSheetExporting}
          >
            <Printer size={14} />
            <span>{contactSheetExporting ? uiText("Exporting") : uiText("Contact sheet")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onPrintContactSheet}
            disabled={!canPrintContactSheet || busy || contactSheetExporting}
          >
            <Printer size={14} />
            <span>{uiText("Print sheet")}</span>
          </button>
          {memoryVisible && (
            <button
              type="button"
              className="secondary compact-action"
              onClick={onRemoveFromMemory}
              disabled={!selectedCount || busy || photoCurationSaving}
            >
              <MinusCircle size={14} />
              <span>{uiText("Remove from memory")}</span>
            </button>
          )}
          <button type="button" className="ghost compact-action" onClick={onToggleExportOptions} disabled={busy}>
            <SlidersHorizontal size={14} />
            <span>{uiText("Export options")}</span>
          </button>
          <button type="button" className="secondary compact-action" onClick={onCopySelected} disabled={!selectedCount || busy}>
            <Copy size={14} />
            <span>{uiText("Copy")}</span>
          </button>
        </div>
      </details>
    </>
  );
}

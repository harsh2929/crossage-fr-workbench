import { ClipboardPaste, Clock, RotateCcw, Save, SlidersHorizontal, Trash2 } from "lucide-react";

type PhotoSelectionEditControlsProps = {
  hasClipboard: boolean;
  hasAdjustmentClipboard: boolean;
  pasteItemCount: number;
  editStackItemCount: number;
  editStackVersionItemCount: number;
  busy: boolean;
  saving: boolean;
  uiText: (value: string) => string;
  onPasteEdits: () => void;
  onPasteAdjustments: () => void;
  onRevertEdits: () => void;
  onSnapshotVersions: () => void;
  onRestoreVersions: () => void;
  onDeleteVersions: () => void;
};

export function PhotoSelectionEditControls({
  hasClipboard,
  hasAdjustmentClipboard,
  pasteItemCount,
  editStackItemCount,
  editStackVersionItemCount,
  busy,
  saving,
  uiText,
  onPasteEdits,
  onPasteAdjustments,
  onRevertEdits,
  onSnapshotVersions,
  onRestoreVersions,
  onDeleteVersions,
}: PhotoSelectionEditControlsProps) {
  return (
    <>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onPasteEdits}
        disabled={!hasClipboard || !pasteItemCount || busy || saving}
        aria-label={uiText("Paste copied edits to selected photos")}
      >
        <ClipboardPaste size={14} />
        <span>{saving ? uiText("Pasting") : uiText("Paste edits")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onPasteAdjustments}
        disabled={!hasAdjustmentClipboard || !pasteItemCount || busy || saving}
        aria-label={uiText("Paste copied adjustments to selected photos")}
      >
        <SlidersHorizontal size={14} />
        <span>{saving ? uiText("Pasting") : uiText("Paste adjustments")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action danger"
        onClick={onRevertEdits}
        disabled={!editStackItemCount || busy || saving}
        aria-label={uiText("Revert edits for selected photos")}
      >
        <RotateCcw size={14} />
        <span>{saving ? uiText("Reverting") : uiText("Revert edits")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onSnapshotVersions}
        disabled={!editStackItemCount || busy || saving}
        aria-label={uiText("Snapshot edit versions for selected photos")}
      >
        <Save size={14} />
        <span>{saving ? uiText("Snapshotting") : uiText("Snapshot versions")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onRestoreVersions}
        disabled={!editStackVersionItemCount || busy || saving}
        aria-label={uiText("Restore latest edit versions for selected photos")}
      >
        <Clock size={14} />
        <span>{saving ? uiText("Restoring") : uiText("Restore versions")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action danger"
        onClick={onDeleteVersions}
        disabled={!editStackVersionItemCount || busy || saving}
        aria-label={uiText("Delete saved edit versions for selected photos")}
      >
        <Trash2 size={14} />
        <span>{saving ? uiText("Deleting") : uiText("Delete versions")}</span>
      </button>
    </>
  );
}

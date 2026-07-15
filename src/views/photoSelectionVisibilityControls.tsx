import { EyeOff, RotateCcw, Trash2 } from "lucide-react";

type PhotoSelectionVisibilityControlsProps = {
  deletedMode: boolean;
  selectedCount: number;
  busy: boolean;
  savingMetadata: boolean;
  retentionDays: string;
  cleanupResult: string;
  uiText: (value: string) => string;
  onRestore: () => void;
  onDeletePermanently: () => void;
  onRetentionDaysChange: (value: string) => void;
  onCleanupRetention: () => void;
  onHide: () => void;
  onDelete: () => void;
};

export function PhotoSelectionVisibilityControls({
  deletedMode,
  selectedCount,
  busy,
  savingMetadata,
  retentionDays,
  cleanupResult,
  uiText,
  onRestore,
  onDeletePermanently,
  onRetentionDaysChange,
  onCleanupRetention,
  onHide,
  onDelete,
}: PhotoSelectionVisibilityControlsProps) {
  const actionDisabled = !selectedCount || busy || savingMetadata;
  if (deletedMode) {
    return (
      <>
        <button type="button" className="secondary compact-action" onClick={onRestore} disabled={actionDisabled}>
          <RotateCcw size={14} />
          <span>{uiText("Restore")}</span>
        </button>
        <button type="button" className="secondary compact-action danger" onClick={onDeletePermanently} disabled={actionDisabled}>
          <Trash2 size={14} />
          <span>{uiText("Delete permanently")}</span>
        </button>
        <div className="photo-retention-control">
          <label>
            <span>{uiText("Older than")}</span>
            <input
              aria-label={uiText("Retention days")}
              type="number"
              min={1}
              max={3650}
              step={1}
              value={retentionDays}
              onChange={(event) => onRetentionDaysChange(event.currentTarget.value)}
              disabled={busy || savingMetadata}
            />
            <span>{uiText("days")}</span>
          </label>
          <button
            type="button"
            className="secondary compact-action danger"
            onClick={onCleanupRetention}
            disabled={busy || savingMetadata}
          >
            <Trash2 size={14} />
            <span>{uiText("Delete older")}</span>
          </button>
          {cleanupResult && <small>{cleanupResult}</small>}
        </div>
      </>
    );
  }
  return (
    <>
      <button type="button" className="secondary compact-action" onClick={onHide} disabled={actionDisabled}>
        <EyeOff size={14} />
        <span>{uiText("Hide")}</span>
      </button>
      <button type="button" className="secondary compact-action danger" onClick={onDelete} disabled={actionDisabled}>
        <Trash2 size={14} />
        <span>{uiText("Delete")}</span>
      </button>
    </>
  );
}

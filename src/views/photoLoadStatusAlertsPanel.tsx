import { AlertTriangle, FolderInput, RefreshCcw } from "lucide-react";

type PhotoLoadStatusAlertsPanelProps = {
  itemLoadError: string;
  previewLoadWarning: string;
  previewRepairStatus: string;
  previewRepairError: string;
  previewRepairing: boolean;
  canRebuildPreviews: boolean;
  missingOriginalWarning: string;
  missingOriginalSamplePath: string;
  photoRelinkStatus: string;
  photoRelinkError: string;
  photoRelinking: boolean;
  busy: boolean;
  loading: boolean;
  uiText: (value: string) => string;
  onRetryPhotos: () => void;
  onRebuildPreviews: () => void;
  onRelinkOriginals: (sourcePath: string) => void;
};

export function PhotoLoadStatusAlertsPanel({
  itemLoadError,
  previewLoadWarning,
  previewRepairStatus,
  previewRepairError,
  previewRepairing,
  canRebuildPreviews,
  missingOriginalWarning,
  missingOriginalSamplePath,
  photoRelinkStatus,
  photoRelinkError,
  photoRelinking,
  busy,
  loading,
  uiText,
  onRetryPhotos,
  onRebuildPreviews,
  onRelinkOriginals,
}: PhotoLoadStatusAlertsPanelProps) {
  const previewVisible = Boolean((previewLoadWarning || previewRepairStatus || previewRepairError) && !itemLoadError);
  const missingOriginalVisible = Boolean(missingOriginalWarning && !itemLoadError);
  return (
    <>
      {itemLoadError && (
        <div className="photo-load-error" role="alert">
          <AlertTriangle size={15} />
          <div>
            <span>
              <strong>{uiText("Could not load photos")}</strong>
              <small>{itemLoadError}</small>
            </span>
          </div>
          <button type="button" className="secondary compact-action" onClick={onRetryPhotos} disabled={busy || loading}>
            <RefreshCcw size={14} />
            <span>{uiText("Retry photos")}</span>
          </button>
        </div>
      )}
      {previewVisible && (
        <div className="photo-load-error" role="status">
          <AlertTriangle size={15} />
          <div>
            <span>
              <strong>{uiText(previewLoadWarning ? "Could not generate every preview" : "Preview repair")}</strong>
              {previewLoadWarning && <small>{previewLoadWarning}</small>}
              {previewRepairStatus && <small>{previewRepairStatus}</small>}
              {previewRepairError && <small>{uiText("Preview repair failed")}: {previewRepairError}</small>}
            </span>
          </div>
          <button type="button" className="secondary compact-action" onClick={onRebuildPreviews} disabled={busy || loading || previewRepairing || !canRebuildPreviews}>
            <RefreshCcw size={14} />
            <span>{previewRepairing ? uiText("Rebuilding") : uiText("Rebuild previews")}</span>
          </button>
          <button type="button" className="secondary compact-action" onClick={onRetryPhotos} disabled={busy || loading}>
            <RefreshCcw size={14} />
            <span>{uiText("Retry photos")}</span>
          </button>
        </div>
      )}
      {missingOriginalVisible && (
        <div className="photo-load-error" role="status">
          <AlertTriangle size={15} />
          <div>
            <span>
              <strong>{uiText("Missing originals")}</strong>
              <small>{missingOriginalWarning}</small>
              {photoRelinkStatus && <small>{photoRelinkStatus}</small>}
              {photoRelinkError && <small>{uiText("Relink failed")}: {photoRelinkError}</small>}
            </span>
          </div>
          <button type="button" className="secondary compact-action" onClick={() => onRelinkOriginals(missingOriginalSamplePath)} disabled={busy || loading || photoRelinking || !missingOriginalSamplePath}>
            <FolderInput size={14} />
            <span>{photoRelinking ? uiText("Relinking") : uiText("Relink folder")}</span>
          </button>
          <button type="button" className="secondary compact-action" onClick={onRetryPhotos} disabled={busy || loading}>
            <RefreshCcw size={14} />
            <span>{uiText("Retry photos")}</span>
          </button>
        </div>
      )}
    </>
  );
}

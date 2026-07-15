import { AlertTriangle, Eye, FolderInput, RefreshCcw, Search, Trash2, Wrench, X } from "lucide-react";
import type { PhotoImportFailure } from "../types";
import { buildPhotoImportSessionSummary } from "./photoImportSessionDetails";

type PhotoRecoveredImportIssuesText = (value: string) => string;

export type PhotoRecoveredImportIssuesScanMode = "preview" | "record" | "";

export type PhotoRecoveredImportIssuesPanelProps = {
  failures: PhotoImportFailure[];
  loading: boolean;
  error: string;
  orphanScanning: boolean;
  orphanScanMode: PhotoRecoveredImportIssuesScanMode;
  orphanScanStatus: string;
  cleanupRunning: boolean;
  cleanupStatus: string;
  retryingFailureId: string;
  savingFailureId: string;
  deletingFailureId: string;
  dismissingFailureId: string;
  uiText: PhotoRecoveredImportIssuesText;
  shortText: (value: string) => string;
  onPreviewOrphans: () => void;
  onScanOrphans: () => void;
  onPreviewCleanup: () => void;
  onCleanStale: () => void;
  onPurgeOldFiles: () => void;
  onRefresh: () => void;
  onRetry: (failure: PhotoImportFailure) => void;
  onSave: (failure: PhotoImportFailure) => void;
  onDelete: (failure: PhotoImportFailure) => void;
  onDismiss: (failure: PhotoImportFailure) => void;
};

function photoRecoveredImportSourceText(failure: PhotoImportFailure, uiText: PhotoRecoveredImportIssuesText) {
  const session = failure.importSession && typeof failure.importSession === "object" ? failure.importSession : null;
  const sessionSummary = buildPhotoImportSessionSummary(session);
  const sessionLabel = sessionSummary?.sourceLabel || String(session?.sourceLabel || session?.importId || failure.importId || "");
  const recoveredSourceText = sessionSummary
    ? [sessionSummary.sourceKindLabel, sessionSummary.storageLabel, sessionSummary.sourceDetail]
      .filter(Boolean)
      .map((part) => uiText(part))
      .join(" \u00b7 ")
    : "";
  return { sessionLabel, recoveredSourceText };
}

function photoRecoveredFailureBusy(props: PhotoRecoveredImportIssuesPanelProps, failureId: string) {
  return (
    props.retryingFailureId === failureId ||
    props.savingFailureId === failureId ||
    props.deletingFailureId === failureId ||
    props.dismissingFailureId === failureId
  );
}

export function PhotoRecoveredImportIssuesPanel(props: PhotoRecoveredImportIssuesPanelProps) {
  const actionsDisabled = props.loading || props.orphanScanning || props.cleanupRunning;
  return (
    <section className="photo-recovered-panel" aria-label={props.uiText("Recovered import issues")}>
      <div className="photo-recovered-head">
        <span>
          <AlertTriangle size={15} />
          <strong>{props.uiText("Recovered import issues")}</strong>
        </span>
        <div className="photo-recovered-head-actions">
          <button type="button" className="ghost compact-action" onClick={props.onPreviewOrphans} disabled={actionsDisabled}>
            <Eye size={14} />
            <span>{props.orphanScanMode === "preview" ? props.uiText("Previewing") : props.uiText("Preview orphans")}</span>
          </button>
          <button type="button" className="secondary compact-action" onClick={props.onScanOrphans} disabled={actionsDisabled}>
            <Search size={14} />
            <span>{props.orphanScanMode === "record" ? props.uiText("Scanning") : props.uiText("Scan orphans")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={props.onPreviewCleanup} disabled={actionsDisabled}>
            <Eye size={14} />
            <span>{props.cleanupRunning ? props.uiText("Checking") : props.uiText("Preview cleanup")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={props.onCleanStale} disabled={actionsDisabled}>
            <Wrench size={14} />
            <span>{props.cleanupRunning ? props.uiText("Cleaning") : props.uiText("Clean stale")}</span>
          </button>
          <button type="button" className="ghost compact-action danger" onClick={props.onPurgeOldFiles} disabled={actionsDisabled}>
            <Trash2 size={14} />
            <span>{props.cleanupRunning ? props.uiText("Purging") : props.uiText("Purge old files")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={props.onRefresh} disabled={actionsDisabled}>
            <RefreshCcw size={14} />
            <span>{props.uiText("Refresh")}</span>
          </button>
        </div>
      </div>
      {props.orphanScanStatus && <small>{props.orphanScanStatus}</small>}
      {props.cleanupStatus && <small>{props.cleanupStatus}</small>}
      {props.loading ? (
        <small>{props.uiText("Loading recovered items...")}</small>
      ) : props.failures.length ? (
        <div className="photo-recovered-list">
          {props.failures.map((failure) => {
            const failureId = String(failure.failureId || "");
            const { sessionLabel, recoveredSourceText } = photoRecoveredImportSourceText(failure, props.uiText);
            const hasRecoveredPath = Boolean(String(failure.recoveredPath || "").trim());
            const isRecoveredOrphan = hasRecoveredPath && String(failure.sourcePath || "") === String(failure.recoveredPath || "");
            const isFailureBusy = photoRecoveredFailureBusy(props, failureId);
            return (
              <article key={failureId || `${failure.importId}:${failure.sourcePath}`} className="photo-recovered-row">
                <span className="photo-recovered-icon"><AlertTriangle size={15} /></span>
                <div>
                  <strong title={failure.sourcePath}>{failure.sourceName || props.shortText(failure.sourcePath || props.uiText("Unknown source"))}</strong>
                  <small>{failure.reason || props.uiText("Import failed.")}</small>
                  <small>{sessionLabel ? `${props.uiText("Import")}: ${props.uiText(sessionLabel)}` : props.uiText("Import issue")}</small>
                  {recoveredSourceText ? <small>{props.uiText("Recovered source")}: {recoveredSourceText}</small> : null}
                  {failure.recoveredPath ? <small title={failure.recoveredPath}>{props.uiText("Recovered path")}: {failure.recoveredName || props.shortText(failure.recoveredPath)}</small> : null}
                </div>
                <div className="photo-recovered-actions">
                  {!isRecoveredOrphan && (
                    <button
                      type="button"
                      className="secondary compact-action"
                      onClick={() => props.onRetry(failure)}
                      disabled={!failureId || isFailureBusy}
                    >
                      <RefreshCcw size={14} />
                      <span>{props.retryingFailureId === failureId ? props.uiText("Retrying") : props.uiText("Retry import")}</span>
                    </button>
                  )}
                  {hasRecoveredPath && (
                    <>
                      <button
                        type="button"
                        className="secondary compact-action"
                        onClick={() => props.onSave(failure)}
                        disabled={!failureId || isFailureBusy}
                      >
                        <FolderInput size={14} />
                        <span>{props.savingFailureId === failureId ? props.uiText("Saving") : props.uiText("Save to library")}</span>
                      </button>
                      <button
                        type="button"
                        className="ghost compact-action danger"
                        onClick={() => props.onDelete(failure)}
                        disabled={!failureId || isFailureBusy}
                      >
                        <Trash2 size={14} />
                        <span>{props.deletingFailureId === failureId ? props.uiText("Deleting") : props.uiText("Delete recovered")}</span>
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="ghost compact-action"
                    onClick={() => props.onDismiss(failure)}
                    disabled={!failureId || isFailureBusy}
                  >
                    <X size={14} />
                    <span>{props.uiText("Dismiss")}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <small>{props.uiText("No recovered import issues.")}</small>
      )}
      {props.error && <p className="compact warn">{props.error}</p>}
    </section>
  );
}

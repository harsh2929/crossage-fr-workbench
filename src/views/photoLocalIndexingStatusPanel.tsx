import { RefreshCcw, Search } from "lucide-react";

type PhotoLocalIndexingStatusText = (value: string) => string;

export type PhotoLocalIndexingStatusSection = {
  key: string;
  error: string;
  statusText: string;
  indexing: boolean;
  pendingCount: number;
  failedCount: number;
  failureRows: Array<Record<string, unknown>>;
  refreshAriaLabel: string;
  statusButtonLabel: string;
  indexLoadedAriaLabel: string;
  indexLoadedLabel: string;
  reindexLoadedAriaLabel: string;
  reindexLoadedLabel: string;
  retryFailedAriaLabel: string;
  retryFailedLabel: string;
  indexPendingAriaLabel: string;
  indexPendingLabel: string;
  failedJobsLabel: string;
  failedFallbackText: string;
  onRefresh: () => void;
  onIndexLoaded: () => void;
  onReindexLoaded: () => void;
  onRetryFailed: () => void;
  onIndexPending: () => void;
};

export type PhotoLocalIndexingStatusPanelProps = {
  sections: PhotoLocalIndexingStatusSection[];
  busy: boolean;
  localIntelligenceEnabled: boolean;
  backgroundIndexingPaused: boolean;
  hasItems: boolean;
  uiText: PhotoLocalIndexingStatusText;
  fileName: (value: string) => string;
};

export function PhotoLocalIndexingStatusPanel(props: PhotoLocalIndexingStatusPanelProps) {
  return (
    <>
      {props.sections.map((section) => (
        <div key={section.key} className={section.error ? "photo-settings-note warn" : "photo-settings-note"}>
          <small>{section.error || section.statusText}</small>
          <div className="photo-settings-note-actions">
            <button
              type="button"
              className="ghost compact-action"
              onClick={section.onRefresh}
              disabled={section.indexing}
              aria-label={props.uiText(section.refreshAriaLabel)}
            >
              <RefreshCcw size={13} />
              <span>{props.uiText(section.statusButtonLabel)}</span>
            </button>
            <button
              type="button"
              className="ghost compact-action"
              onClick={section.onIndexLoaded}
              disabled={props.busy || section.indexing || !props.localIntelligenceEnabled || props.backgroundIndexingPaused || !props.hasItems}
              aria-label={props.uiText(section.indexLoadedAriaLabel)}
            >
              <Search size={13} />
              <span>{section.indexing ? props.uiText("Indexing") : props.uiText(section.indexLoadedLabel)}</span>
            </button>
            <button
              type="button"
              className="ghost compact-action"
              onClick={section.onReindexLoaded}
              disabled={props.busy || section.indexing || !props.localIntelligenceEnabled || props.backgroundIndexingPaused || !props.hasItems}
              aria-label={props.uiText(section.reindexLoadedAriaLabel)}
            >
              <RefreshCcw size={13} />
              <span>{props.uiText(section.reindexLoadedLabel)}</span>
            </button>
            <button
              type="button"
              className="ghost compact-action"
              onClick={section.onRetryFailed}
              disabled={props.busy || section.indexing || !props.localIntelligenceEnabled || props.backgroundIndexingPaused || section.failedCount === 0}
              aria-label={props.uiText(section.retryFailedAriaLabel)}
            >
              <RefreshCcw size={13} />
              <span>{props.uiText(section.retryFailedLabel)}</span>
            </button>
            <button
              type="button"
              className="ghost compact-action"
              onClick={section.onIndexPending}
              disabled={props.busy || section.indexing || !props.localIntelligenceEnabled || props.backgroundIndexingPaused || section.pendingCount === 0}
              aria-label={props.uiText(section.indexPendingAriaLabel)}
            >
              <Search size={13} />
              <span>{props.uiText(section.indexPendingLabel)}</span>
            </button>
          </div>
          {section.failureRows.length > 0 && (
            <div className="photo-ocr-failure-list" aria-label={props.uiText(section.failedJobsLabel)}>
              {section.failureRows.map((row, index) => {
                const sourcePath = String(row.sourcePath || "");
                const error = String(row.error || row.status || props.uiText(section.failedFallbackText));
                return (
                  <span key={`${sourcePath}:${index}`} className="photo-ocr-failure-row">
                    <strong title={sourcePath}>{props.fileName(sourcePath) || props.uiText("Unknown photo")}</strong>
                    <small>{error}</small>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

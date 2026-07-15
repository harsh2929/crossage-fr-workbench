import { Clock, Play, RefreshCcw, Search } from "lucide-react";

type PhotoIndexingNoticePanelProps = {
  searchPending: boolean;
  searchDetail: string;
  searchQueueDetail: string;
  catalogVisible: boolean;
  catalogStatus: string;
  catalogNoticeClass: string;
  catalogTitle: string;
  catalogDetail: string;
  catalogQueueHint: string;
  catalogProgressTotal: number;
  catalogProgressParts: readonly string[];
  catalogProgressPercent: number;
  busy: boolean;
  loading: boolean;
  queueBusy: boolean;
  backgroundIndexingPaused: boolean;
  uiText: (value: string) => string;
  onOpenQueue: () => void;
  onRetrySearch: () => void;
  onRunNext: () => void;
};

export function PhotoIndexingNoticePanel({
  searchPending,
  searchDetail,
  searchQueueDetail,
  catalogVisible,
  catalogStatus,
  catalogNoticeClass,
  catalogTitle,
  catalogDetail,
  catalogQueueHint,
  catalogProgressTotal,
  catalogProgressParts,
  catalogProgressPercent,
  busy,
  loading,
  queueBusy,
  backgroundIndexingPaused,
  uiText,
  onOpenQueue,
  onRetrySearch,
  onRunNext,
}: PhotoIndexingNoticePanelProps) {
  const catalogProgressVisible = catalogProgressTotal > 0 || catalogProgressParts.length > 0;
  return (
    <>
      {searchPending && (
        <div className="photo-load-error photo-search-index-notice" role="status">
          <Clock size={15} />
          <div>
            <span>
              <strong>{uiText("Search index is catching up")}</strong>
              <small>{searchDetail}</small>
              <small>{searchQueueDetail}</small>
            </span>
          </div>
          <button type="button" className="secondary compact-action" onClick={onOpenQueue} disabled={busy || queueBusy}>
            <RefreshCcw size={14} />
            <span>{uiText("Queue status")}</span>
          </button>
          <button type="button" className="ghost compact-action" onClick={onRetrySearch} disabled={busy || loading}>
            <Search size={14} />
            <span>{uiText("Retry search")}</span>
          </button>
        </div>
      )}
      {catalogVisible && (
        <div className={`photo-load-error photo-catalog-index-notice ${catalogNoticeClass} status-${catalogStatus || "pending"}`} role={catalogStatus === "failed" ? "alert" : "status"}>
          <Clock size={15} />
          <div>
            <span>
              <strong>{catalogTitle}</strong>
              <small>{catalogDetail}</small>
              <small>{catalogQueueHint}</small>
            </span>
            {catalogProgressVisible && (
              <div
                className={`photo-catalog-index-progress${catalogProgressTotal > 0 ? "" : " indeterminate"}`}
                aria-label={uiText("Catalog refresh progress")}
                aria-valuemin={catalogProgressTotal > 0 ? 0 : undefined}
                aria-valuemax={catalogProgressTotal > 0 ? 100 : undefined}
                aria-valuenow={catalogProgressTotal > 0 ? catalogProgressPercent : undefined}
                role={catalogProgressTotal > 0 ? "progressbar" : "status"}
              >
                <span style={{ width: catalogProgressTotal > 0 ? `${catalogProgressPercent}%` : undefined }} />
              </div>
            )}
          </div>
          <button type="button" className="secondary compact-action" onClick={onOpenQueue} disabled={busy || queueBusy}>
            <RefreshCcw size={14} />
            <span>{uiText("Queue status")}</span>
          </button>
          {(catalogStatus === "queued" || catalogStatus === "paused") && (
            <button type="button" className="ghost compact-action" onClick={onRunNext} disabled={busy || queueBusy || backgroundIndexingPaused}>
              <Play size={14} />
              <span>{uiText("Run next")}</span>
            </button>
          )}
        </div>
      )}
    </>
  );
}

import { AlertTriangle, CalendarDays, Image as ImageIcon, RefreshCcw } from "lucide-react";
import type { PhotoDateBucketCard } from "./photoDateViews";

type PhotoDateBucketPanelProps = {
  buckets: PhotoDateBucketCard[];
  loading: boolean;
  loadError: string;
  busy: boolean;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  onRetry: () => void;
  onSelectBucket: (bucketKey: string) => void;
};

export function PhotoDateBucketPanel({
  buckets,
  loading,
  loadError,
  busy,
  uiText,
  formatCount,
  onRetry,
  onSelectBucket,
}: PhotoDateBucketPanelProps) {
  if (loadError) {
    return (
      <div className="photo-load-error" role="alert">
        <AlertTriangle size={15} />
        <div>
          <span>
            <strong>{uiText("Could not load date buckets")}</strong>
            <small>{loadError}</small>
          </span>
        </div>
        <button type="button" className="secondary compact-action" onClick={onRetry} disabled={busy || loading}>
          <RefreshCcw size={14} />
          <span>{uiText("Retry dates")}</span>
        </button>
      </div>
    );
  }

  if (loading && !buckets.length) {
    return <p className="compact photos-loading">{uiText("Loading date buckets...")}</p>;
  }

  if (buckets.length) {
    return (
      <div className="photo-date-buckets">
        {buckets.map((bucket) => (
          <button
            type="button"
            key={bucket.key}
            className="photo-date-bucket-card"
            onClick={() => onSelectBucket(bucket.key)}
          >
            <span className="photo-date-bucket-cover">
              {bucket.coverUrl ? (
                <img src={bucket.coverUrl} alt="" loading="lazy" decoding="async" />
              ) : (
                <ImageIcon size={20} />
              )}
              {bucket.coverReason ? <span className="photo-date-bucket-cover-reason">{uiText(bucket.coverReason)}</span> : null}
            </span>
            <span className="photo-date-bucket-copy">
              <strong>{bucket.label}</strong>
              <small>{formatCount(bucket.count)} {bucket.count === 1 ? uiText("photo") : uiText("photos")}</small>
              {bucket.summaryBadges.length > 0 && (
                <span className="photo-date-bucket-badges">
                  {bucket.summaryBadges.map((badge) => <small key={badge}>{uiText(badge)}</small>)}
                </span>
              )}
              <small>{bucket.coverTitle}</small>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="empty">
      <CalendarDays size={24} />
      <strong>{uiText("No dated photos in this view")}</strong>
      <span>{uiText("Load or edit dates to fill this date view.")}</span>
    </div>
  );
}

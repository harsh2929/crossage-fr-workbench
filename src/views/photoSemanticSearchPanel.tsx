import { useMemo } from "react";
import { AlertTriangle, ImageIcon, Video } from "lucide-react";

import type { PhotoItem, SemanticSearchPhotosValue } from "../types";

type PhotoSemanticSearchPanelText = (value: string) => string;
type PhotoSemanticSearchPanelCount = (value: number) => string;
type PhotoSemanticSearchPanelAction = void | Promise<void>;

export type PhotoSemanticSearchPanelProps = {
  busy: boolean;
  error: string;
  results: SemanticSearchPhotosValue | null;
  loadedItems: readonly Pick<PhotoItem, "sourcePath" | "previewUrl" | "sourceUrl">[];
  uiText: PhotoSemanticSearchPanelText;
  formatCount: PhotoSemanticSearchPanelCount;
  onOpenResult: (sourcePath: string, timestampMs?: number) => PhotoSemanticSearchPanelAction;
};

function formatVideoTimestamp(value: number | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function PhotoSemanticSearchPanel(props: PhotoSemanticSearchPanelProps) {
  const loadedItemsByPath = useMemo(() => {
    const byPath = new Map<string, Pick<PhotoItem, "sourcePath" | "previewUrl" | "sourceUrl">>();
    props.loadedItems.forEach((item) => {
      if (item.sourcePath) byPath.set(item.sourcePath, item);
    });
    return byPath;
  }, [props.loadedItems]);
  const bestScore = props.results?.results[0]?.score || 0;

  return (
    <section className="photo-global-search photos-semantic-search" aria-label={props.uiText("Semantic search results")}>
      <div className="photo-global-search-head">
        <span className="photo-global-search-title">
          <strong>{props.uiText("Search by meaning")}</strong>
          {props.results?.query && <small>{props.results.query}</small>}
        </span>
        <span>
          {props.busy
            ? props.uiText("Searching library...")
            : props.results?.available
              ? `${props.formatCount(props.results.scored)} ${props.uiText("ranked")}`
              : props.uiText("Ready")}
        </span>
      </div>
      {props.error ? (
        <div className="photo-global-search-status" role="alert">
          <AlertTriangle size={14} />
          <span>{props.error}</span>
        </div>
      ) : props.results && props.results.results.length > 0 ? (
        <div className="photo-global-search-items photos-semantic-results">
          {props.results.results.map((result) => {
            const match = loadedItemsByPath.get(result.sourcePath);
            const semanticItem = props.results?.items?.find((entry) => (
              result.segmentId
                ? entry.segmentId === result.segmentId
                : entry.sourcePath === result.sourcePath && !entry.segmentId
            ));
            const imageUrl = semanticItem?.previewUrl || semanticItem?.sourceUrl || match?.previewUrl || match?.sourceUrl || "";
            const name = result.sourcePath.split("/").pop() || result.sourcePath;
            const pct = bestScore > 0 ? Math.max(1, Math.round((result.score / bestScore) * 100)) : 0;
            const isVideoSegment = result.resultKind === "videoSegment";
            const timestampLabel = isVideoSegment ? formatVideoTimestamp(result.timestampMs) : "";
            return (
              <button
                key={result.segmentId || result.sourcePath}
                type="button"
                className="photo-global-search-item"
                onClick={() => void props.onOpenResult(result.sourcePath, isVideoSegment ? result.timestampMs : undefined)}
                title={`${name} · ${pct}%${timestampLabel ? ` · ${timestampLabel}` : ""}`}
                aria-label={`${name}, ${pct}% ${props.uiText("match")}${timestampLabel ? `, ${props.uiText("video moment")} ${timestampLabel}` : ""}`}
              >
                <span className="photo-global-search-thumb">
                  {imageUrl ? <img src={imageUrl} alt="" loading="lazy" decoding="async" /> : isVideoSegment ? <Video size={18} /> : <ImageIcon size={18} />}
                </span>
                <span className="photo-semantic-result-copy">
                  <strong className="photo-semantic-score">{pct}%</strong>
                  {timestampLabel && <small><Video size={12} />{timestampLabel}</small>}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

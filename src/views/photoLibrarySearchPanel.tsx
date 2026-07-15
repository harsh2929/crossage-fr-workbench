import type { ReactNode } from "react";
import { AlertTriangle, AudioLines, CalendarDays, Folder, ImageIcon, Search, Tag } from "lucide-react";
import type { PhotoLibrarySearchGroup, PhotoLibrarySearchItem, PhotoLibrarySearchResult } from "../types";

type PhotoLibrarySearchPanelProps = {
  panelId: string;
  result: PhotoLibrarySearchResult | null;
  loading: boolean;
  error: string;
  hasResults: boolean;
  semanticQueries: readonly string[];
  activeIndex: number;
  itemIndexByKey: ReadonlyMap<string, number>;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  renderSearchHighlight: (value: string) => ReactNode;
  itemDomId: (index: number) => string;
  onShowAllGroup: (group: PhotoLibrarySearchGroup) => void;
  onOpenItem: (item: PhotoLibrarySearchItem) => void;
};

function photoLibrarySearchGroupReturned(group: PhotoLibrarySearchGroup) {
  return Number(group.returned || group.items.length);
}

function photoLibrarySearchGroupTotal(group: PhotoLibrarySearchGroup) {
  return Number(group.total || 0);
}

function PhotoLibrarySearchItemIcon({ item }: { item: PhotoLibrarySearchItem }) {
  if (item.resultKind === "audioSegment") return <AudioLines size={16} />;
  if (item.kind === "folder" || item.kind === "sourceFolder") return <Folder size={16} />;
  if (item.kind === "keyword") return <Tag size={16} />;
  if (item.kind === "date") return <CalendarDays size={16} />;
  return <ImageIcon size={16} />;
}

function formatMediaTimestamp(value: number | undefined): string {
  const totalSeconds = Math.max(0, Math.floor((Number(value) || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function PhotoLibrarySearchPanel({
  panelId,
  result,
  loading,
  error,
  hasResults,
  semanticQueries,
  activeIndex,
  itemIndexByKey,
  uiText,
  formatCount,
  renderSearchHighlight,
  itemDomId,
  onShowAllGroup,
  onOpenItem,
}: PhotoLibrarySearchPanelProps) {
  return (
    <section id={panelId} className="photo-global-search" aria-label={uiText("Library search results")}>
      <div className="photo-global-search-head">
        <span className="photo-global-search-title">
          <strong>{uiText("Library search")}</strong>
          {semanticQueries.length > 0 && (
            <small>{uiText("Local semantic search")}: {semanticQueries.join(", ")}</small>
          )}
        </span>
        <span>
          {loading
            ? uiText("Searching library...")
            : result
              ? `${formatCount(result.total)} ${uiText("matches")}`
              : uiText("Ready")}
        </span>
      </div>
      {error ? (
        <div className="photo-global-search-status" role="alert">
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      ) : hasResults ? (
        <div className="photo-global-search-groups">
          {result?.groups.map((group) => {
            const returned = photoLibrarySearchGroupReturned(group);
            const total = photoLibrarySearchGroupTotal(group);
            return (
              <div key={group.id} className="photo-global-search-group">
                <div className="photo-global-search-group-head">
                  <span>{uiText(group.label)}</span>
                  <div className="photo-global-search-group-actions">
                    <small>
                      {returned < total
                        ? `${formatCount(returned)} / ${formatCount(total)}${group.estimatedTotal ? "+" : ""}`
                        : formatCount(group.total)}
                    </small>
                    {group.hasMore && group.id !== "photos" && (
                      <small className="photo-global-search-overflow">{uiText(group.estimatedTotal ? "bounded" : "more")}</small>
                    )}
                    {group.id === "photos" && returned < total && (
                      <button
                        type="button"
                        className="ghost compact-action"
                        onClick={() => onShowAllGroup(group)}
                      >
                        <Search size={13} />
                        <span>{uiText("Show all Photos")}</span>
                      </button>
                    )}
                  </div>
                </div>
                <div className="photo-global-search-items">
                  {group.items.map((item) => {
                    const imageUrl = item.previewUrl || item.coverPreviewUrl || "";
                    const matchReasons = (item.matchReasons || [])
                      .map((reason) => String(reason || "").trim())
                      .filter(Boolean)
                      .slice(0, 5);
                    const itemKey = `${group.id}:${item.id}`;
                    const itemIndex = itemIndexByKey.get(itemKey) ?? -1;
                    const itemActive = itemIndex >= 0 && itemIndex === activeIndex;
                    const audioTimestamp = item.resultKind === "audioSegment" && Number.isFinite(item.timestampMs)
                      ? formatMediaTimestamp(item.timestampMs)
                      : "";
                    return (
                      <button
                        key={itemKey}
                        id={itemIndex >= 0 ? itemDomId(itemIndex) : undefined}
                        type="button"
                        className={itemActive ? "photo-global-search-item active" : "photo-global-search-item"}
                        aria-selected={itemActive || undefined}
                        onClick={() => onOpenItem(item)}
                      >
                        <span className="photo-global-search-thumb">
                          {imageUrl ? (
                            <img src={imageUrl} alt="" loading="lazy" decoding="async" />
                          ) : (
                            <PhotoLibrarySearchItemIcon item={item} />
                          )}
                        </span>
                        <span className="photo-global-search-copy">
                          <strong>{renderSearchHighlight(item.title)}</strong>
                          {audioTimestamp && <small><AudioLines size={12} />{audioTimestamp}</small>}
                          {item.snippet && <small>{renderSearchHighlight(item.snippet)}</small>}
                          {item.subtitle && <small>{renderSearchHighlight(item.subtitle)}</small>}
                          {matchReasons.length > 0 && (
                            <span className="photo-global-search-reasons" aria-label={uiText("Match reasons")}>
                              {matchReasons.map((reason) => <small key={reason}>{uiText(reason)}</small>)}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : !loading && result ? (
        <div className="photo-global-search-status">
          <Search size={14} />
          <span>{uiText("No library matches")}</span>
        </div>
      ) : null}
    </section>
  );
}

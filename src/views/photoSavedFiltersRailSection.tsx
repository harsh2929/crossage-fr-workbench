import type { MouseEvent as ReactMouseEvent } from "react";
import { ArrowDown, ArrowUp, ChevronRight, MoreHorizontal, SlidersHorizontal, Star, X } from "lucide-react";
import type { PhotoSavedFilter } from "./photoSavedSearch";

type PhotoSavedFiltersRailSectionText = (value: string) => string;

export type PhotoSavedFilterMoveDirection = "up" | "down";

export type PhotoSavedFiltersRailSectionProps = {
  filters: PhotoSavedFilter[];
  collapsed: boolean;
  activeSavedFilterId: string;
  uiText: PhotoSavedFiltersRailSectionText;
  formatCount: (value: number) => string;
  onToggleSection: () => void;
  onApplyFilter: (filter: PhotoSavedFilter) => void;
  onOpenContextMenu: (event: ReactMouseEvent<HTMLElement>, filter: PhotoSavedFilter, canMoveUp: boolean, canMoveDown: boolean) => void;
  onOpenContextMenuFromButton: (event: ReactMouseEvent<HTMLElement>, filter: PhotoSavedFilter, canMoveUp: boolean, canMoveDown: boolean) => void;
  onTogglePinned: (filterId: string) => void;
  onMoveFilter: (filterId: string, direction: PhotoSavedFilterMoveDirection) => void;
  onDeleteFilter: (filterId: string) => void;
};

export function PhotoSavedFiltersRailSection(props: PhotoSavedFiltersRailSectionProps) {
  if (!props.filters.length) return null;
  return (
    <section className="photo-rail-section">
      <div className="photo-rail-section-head-row">
        <button
          type="button"
          className={props.collapsed ? "photo-rail-section-head" : "photo-rail-section-head open"}
          onClick={props.onToggleSection}
          aria-expanded={!props.collapsed}
        >
          <ChevronRight className="photo-rail-section-chevron" size={14} />
          <span>{props.uiText("Saved Filters")}</span>
          <small>{props.formatCount(props.filters.length)}</small>
        </button>
      </div>
      {!props.collapsed && (
        <ul className="photos-rail-list">
          {props.filters.map((filter, filterIndex) => {
            const previousFilter = props.filters[filterIndex - 1];
            const nextFilter = props.filters[filterIndex + 1];
            const canMoveUp = Boolean(previousFilter) && Boolean(previousFilter?.pinned) === Boolean(filter.pinned);
            const canMoveDown = Boolean(nextFilter) && Boolean(nextFilter?.pinned) === Boolean(filter.pinned);
            const summaryText = [
              ...(filter.ruleSummary || []),
              ...(filter.previewSamples?.length ? [`${props.uiText("Includes")}: ${filter.previewSamples.join(", ")}`] : []),
            ].filter(Boolean).join(" · ");
            const countText = filter.previewPending
              ? props.uiText("Pending")
              : typeof filter.count === "number"
                ? props.formatCount(filter.count)
                : (filter.pinned ? props.uiText("Pinned") : props.uiText("Filter"));
            return (
              <li
                key={filter.id}
                className="photo-rail-row saved-filter"
                onContextMenu={(event) => props.onOpenContextMenu(event, filter, canMoveUp, canMoveDown)}
              >
                <span className="photo-rail-tree-spacer" />
                <button
                  type="button"
                  className={filter.id === props.activeSavedFilterId ? "photo-rail-row-main active" : "photo-rail-row-main"}
                  onClick={() => props.onApplyFilter(filter)}
                  aria-current={filter.id === props.activeSavedFilterId ? "true" : undefined}
                >
                  <span className="photos-rail-cover">
                    <SlidersHorizontal size={16} />
                  </span>
                  <span className="photo-saved-filter-name-stack" title={summaryText ? `${filter.name} - ${summaryText}` : filter.name}>
                    <span className="photos-rail-name">{filter.name}</span>
                    {summaryText && <small className="photo-saved-filter-snippet">{summaryText}</small>}
                  </span>
                  <span className="photos-rail-count" title={filter.pinned ? props.uiText("Pinned") : undefined}>{countText}</span>
                </button>
                <span className="photo-saved-filter-actions">
                  <button
                    type="button"
                    className="photo-rail-pin"
                    onClick={(event) => props.onOpenContextMenuFromButton(event, filter, canMoveUp, canMoveDown)}
                    aria-label={`${props.uiText("Saved filter actions")} ${filter.name}`}
                    title={props.uiText("Saved filter actions")}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                  <button
                    type="button"
                    className={filter.pinned ? "photo-rail-pin active" : "photo-rail-pin"}
                    onClick={() => props.onTogglePinned(filter.id)}
                    aria-label={`${filter.pinned ? props.uiText("Unpin saved filter") : props.uiText("Pin saved filter")} ${filter.name}`}
                    aria-pressed={Boolean(filter.pinned)}
                    title={filter.pinned ? props.uiText("Unpin saved filter") : props.uiText("Pin saved filter")}
                  >
                    <Star size={13} fill={filter.pinned ? "currentColor" : "none"} />
                  </button>
                  <button
                    type="button"
                    className="photo-rail-pin"
                    onClick={() => props.onMoveFilter(filter.id, "up")}
                    disabled={!canMoveUp}
                    aria-label={`${props.uiText("Move saved filter up")} ${filter.name}`}
                    title={props.uiText("Move saved filter up")}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    className="photo-rail-pin"
                    onClick={() => props.onMoveFilter(filter.id, "down")}
                    disabled={!canMoveDown}
                    aria-label={`${props.uiText("Move saved filter down")} ${filter.name}`}
                    title={props.uiText("Move saved filter down")}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    className="photo-rail-pin"
                    onClick={() => props.onDeleteFilter(filter.id)}
                    aria-label={`${props.uiText("Delete saved filter")} ${filter.name}`}
                    title={props.uiText("Delete saved filter")}
                  >
                    <X size={13} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

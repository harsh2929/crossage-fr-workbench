import { type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { CalendarDays } from "lucide-react";
import type { PhotoItem } from "../types";
import type { PhotoAlbumItemDragState } from "./photoAlbumOrdering";
import { PhotoGridTile } from "./photoGridTile";
import { normalizePhotoColorLabel, normalizePhotoPickStatus, normalizePhotoRating } from "./photoProCulling";
import type { PhotoThumbnailAspectMode } from "./photoThumbnailControls";
import type { PhotoVirtualGridWindow } from "./photoVirtualGrid";

type PhotoVirtualGridPanelProps = {
  gridRef: RefObject<HTMLDivElement | null>;
  gridStyle: CSSProperties;
  rowStyle: CSSProperties;
  virtualWindow: PhotoVirtualGridWindow<PhotoItem>;
  selectedSources: ReadonlySet<string>;
  albumItemDrag: PhotoAlbumItemDragState | null;
  canDragReorder: boolean;
  thumbnailAspectMode: PhotoThumbnailAspectMode;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  itemLabel: (item: PhotoItem, index: number) => string;
  onToggleSource: (sourcePath: string) => void;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>, itemIndex: number) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PhotoItem, itemIndex: number) => void;
  onMenuClick: (event: ReactMouseEvent<HTMLElement>, item: PhotoItem, itemIndex: number) => void;
  onDragStartTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDragOverTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDropTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDragEndTile: () => void;
};

function photoGridCurationSummary(
  item: PhotoItem,
  formatCount: (value: number) => string,
  uiText: (value: string) => string,
): string {
  const rating = normalizePhotoRating(item.rating);
  const colorLabel = normalizePhotoColorLabel(item.colorLabel);
  const pickStatus = normalizePhotoPickStatus(item.pickStatus);
  const parts: string[] = [];
  if (rating > 0) parts.push(`${formatCount(rating)} ${uiText(rating === 1 ? "star" : "stars")}`);
  if (colorLabel) parts.push(uiText(`${colorLabel[0].toUpperCase()}${colorLabel.slice(1)} label`));
  if (pickStatus) parts.push(uiText(pickStatus === "pick" ? "Pick" : "Reject"));
  return parts.join(", ");
}

export function PhotoVirtualGridPanel({
  gridRef,
  gridStyle,
  rowStyle,
  virtualWindow,
  selectedSources,
  albumItemDrag,
  canDragReorder,
  thumbnailAspectMode,
  uiText,
  formatCount,
  itemLabel,
  onToggleSource,
  onOpen,
  onContextMenu,
  onMenuClick,
  onDragStartTile,
  onDragOverTile,
  onDropTile,
  onDragEndTile,
}: PhotoVirtualGridPanelProps) {
  return (
    <div
      className="photos-grid virtualized content-crossfade"
      data-no-localize="true"
      ref={gridRef}
      style={{ ...gridStyle, height: `${Math.ceil(virtualWindow.totalHeight)}px` }}
    >
      {virtualWindow.visibleBands.map((band) => {
        if (band.kind === "header") {
          return (
            <div
              key={band.key}
              className="photos-date-header"
              style={{ top: Math.round(band.top), height: Math.ceil(band.height) }}
            >
              <CalendarDays size={14} /> {band.row.label}
            </div>
          );
        }
        return (
          <div
            key={band.key}
            className="photos-virtual-row"
            style={{
              ...rowStyle,
              top: Math.round(band.top),
              height: Math.ceil(band.height),
            }}
          >
            {band.rows.map((row) => {
              const item = row.item;
              const label = itemLabel(item, row.index);
              const checked = selectedSources.has(item.sourcePath);
              const draggedSourcePath = albumItemDrag?.sourcePath || "";
              const dragging = draggedSourcePath === item.sourcePath || Boolean(draggedSourcePath && selectedSources.has(draggedSourcePath) && checked);
              const dropPlacement = albumItemDrag?.targetSourcePath === item.sourcePath ? albumItemDrag.placement || "" : "";
              const burstStackCount = Math.max(0, Number(item.burstStack?.count || 0) || 0);
              return (
                <PhotoGridTile
                  key={row.key}
                  item={item}
                  itemIndex={row.index}
                  label={label}
                  checked={checked}
                  burstStackCount={burstStackCount}
                  burstStackCountLabel={formatCount(burstStackCount)}
                  canDragReorder={canDragReorder}
                  dragging={dragging}
                  dropPlacement={dropPlacement}
                  thumbnailAspectMode={thumbnailAspectMode}
                  openPhotoLabel={uiText("Open photo")}
                  photoActionsLabel={uiText("Photo actions")}
                  selectLabel={uiText("Select")}
                  deselectLabel={uiText("Deselect")}
                  missingLabel={uiText("Missing")}
                  burstFramesLabel={uiText("burst frames")}
                  curationSummary={photoGridCurationSummary(item, formatCount, uiText)}
                  onToggleSource={onToggleSource}
                  onOpen={onOpen}
                  onContextMenu={onContextMenu}
                  onMenuClick={onMenuClick}
                  onDragStartTile={onDragStartTile}
                  onDragOverTile={onDragOverTile}
                  onDropTile={onDropTile}
                  onDragEndTile={onDragEndTile}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

import { memo, type CSSProperties, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AlertTriangle, Flag, ImageIcon, Layers, MoreHorizontal, Star, Tag, Video, X } from "lucide-react";
import type { PhotoItem } from "../types";
import type { PhotoAlbumDropPlacement } from "./photoAlbumOrdering";
import { isVideoMediaKind } from "./photoMediaKind";
import { normalizePhotoColorLabel, normalizePhotoPickStatus, normalizePhotoRating } from "./photoProCulling";
import { photoThumbnailAspectRatio, type PhotoThumbnailAspectMode } from "./photoThumbnailControls";

function PersonChips(props: { people: NonNullable<PhotoItem["people"]>; count: number }) {
  if (!props.people.length && !props.count) return null;
  const shown = props.people.slice(0, 3);
  const overflow = Math.max(0, props.count - shown.length);
  return (
    <span className="photo-person-chips">
      {shown.map((person) => <span key={person.candidateId}>{person.personName}</span>)}
      {overflow > 0 && <span>+{overflow}</span>}
    </span>
  );
}

export type PhotoGridTileProps = {
  item: PhotoItem;
  itemIndex: number;
  label: string;
  checked: boolean;
  burstStackCount: number;
  burstStackCountLabel: string;
  canDragReorder: boolean;
  dragging: boolean;
  dropPlacement: PhotoAlbumDropPlacement | "";
  thumbnailAspectMode: PhotoThumbnailAspectMode;
  openPhotoLabel: string;
  photoActionsLabel: string;
  selectLabel: string;
  deselectLabel: string;
  missingLabel: string;
  burstFramesLabel: string;
  curationSummary: string;
  onToggleSource: (sourcePath: string) => void;
  onOpen: (event: ReactMouseEvent<HTMLButtonElement>, itemIndex: number) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLElement>, item: PhotoItem, itemIndex: number) => void;
  onMenuClick: (event: ReactMouseEvent<HTMLElement>, item: PhotoItem, itemIndex: number) => void;
  onDragStartTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDragOverTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDropTile: (event: ReactDragEvent<HTMLDivElement>, sourcePath: string) => void;
  onDragEndTile: () => void;
};

export const PhotoGridTile = memo(function PhotoGridTile(props: PhotoGridTileProps) {
  const itemMissing = Boolean(props.item.missingAt);
  const url = itemMissing ? "" : props.item.previewUrl || "";
  const utilityMatch = props.item.utilityMatch;
  const rating = normalizePhotoRating(props.item.rating);
  const colorLabel = normalizePhotoColorLabel(props.item.colorLabel);
  const pickStatus = normalizePhotoPickStatus(props.item.pickStatus);
  const hasProCuration = rating > 0 || Boolean(colorLabel) || Boolean(pickStatus);
  const tileClass = [
    "photo-tile-wrap",
    props.checked ? "selected" : "",
    itemMissing ? "missing-original" : "",
    props.burstStackCount > 1 ? "burst-stack" : "",
    props.canDragReorder ? "draggable" : "",
    props.dragging ? "dragging" : "",
    props.dropPlacement ? `drop-${props.dropPlacement}` : "",
    props.thumbnailAspectMode,
  ].filter(Boolean).join(" ");
  const tileStyle = {
    aspectRatio: props.thumbnailAspectMode === "aspect" ? photoThumbnailAspectRatio(props.item) : "1 / 1",
  } as CSSProperties;
  return (
    <div
      className={tileClass}
      style={tileStyle}
      draggable={props.canDragReorder}
      onDragStart={(event) => props.onDragStartTile(event, props.item.sourcePath)}
      onDragOver={(event) => props.onDragOverTile(event, props.item.sourcePath)}
      onDrop={(event) => props.onDropTile(event, props.item.sourcePath)}
      onDragEnd={props.onDragEndTile}
      onContextMenu={(event) => props.onContextMenu(event, props.item, props.itemIndex)}
      aria-grabbed={props.dragging ? "true" : undefined}
    >
      <label className="photo-select-box" aria-label={`${props.checked ? props.deselectLabel : props.selectLabel} ${props.label}`}>
        <input type="checkbox" checked={props.checked} onChange={() => props.onToggleSource(props.item.sourcePath)} />
      </label>
      <button
        type="button"
        className={props.thumbnailAspectMode === "aspect" ? "photo-tile contain" : "photo-tile cover"}
        onClick={(event) => props.onOpen(event, props.itemIndex)}
        aria-label={`${props.openPhotoLabel} ${props.label}${props.curationSummary ? `, ${props.curationSummary}` : ""}`}
        title={props.label}
      >
        {url ? (
          <img loading="lazy" decoding="async" src={url} alt={props.label} draggable={false} />
        ) : (
          <span className="photo-tile-fallback">
            {itemMissing ? <AlertTriangle size={18} /> : isVideoMediaKind(props.item.mediaKind) ? <Video size={18} /> : <ImageIcon size={18} />}
          </span>
        )}
        {itemMissing && (
          <span className="photo-missing-badge">
            <AlertTriangle size={12} />
            <span>{props.missingLabel}</span>
          </span>
        )}
        {props.item.favorite && (
          <span className="photo-favorite-badge" aria-hidden="true">
            <Star size={13} fill="currentColor" />
          </span>
        )}
        {hasProCuration && (
          <span className="photo-pro-grid-badges" title={props.curationSummary} aria-hidden="true">
            {rating > 0 && <span className="rating"><Star size={12} fill="currentColor" />{rating}</span>}
            {colorLabel && <i className={`photo-pro-label-dot ${colorLabel}`} />}
            {pickStatus === "pick" && <Flag className="pick" size={12} fill="currentColor" />}
            {pickStatus === "reject" && <X className="reject" size={13} />}
          </span>
        )}
        {props.burstStackCount > 1 && (
          <span className="photo-burst-badge" title={`${props.burstStackCountLabel} ${props.burstFramesLabel}`}>
            <Layers size={12} />
            <span>{props.burstStackCountLabel}</span>
          </span>
        )}
        {utilityMatch && (
          <span
            className="photo-utility-match-badge"
            title={`${utilityMatch.classifierName}: ${utilityMatch.fieldLabel} matches "${utilityMatch.term}"`}
          >
            <Tag size={12} />
            <span>{utilityMatch.term}</span>
          </span>
        )}
        <PersonChips people={props.item.people || []} count={props.item.personCount || 0} />
      </button>
      <button
        type="button"
        className="photo-tile-menu-button"
        onClick={(event) => props.onMenuClick(event, props.item, props.itemIndex)}
        aria-label={`${props.photoActionsLabel} ${props.label}`}
        title={props.photoActionsLabel}
      >
        <MoreHorizontal size={14} />
      </button>
    </div>
  );
});

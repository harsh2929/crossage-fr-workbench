import { AlertTriangle, Camera, Check, Folder, FolderInput, ImageIcon, X } from "lucide-react";
import type { PhotoImportSourceKind } from "../types";
import {
  photoImportReviewSourceLabel,
  type PhotoImportAccessGuidance,
  type PhotoImportReviewSummary,
} from "./photoImportAccess";
import {
  PHOTO_IMPORT_NEW_ALBUM_TARGET,
  photoImportAlbumOptionId,
  type PhotoImportAlbumOption,
} from "./photoImportAlbumTarget";
import type { PendingPhotoImportEntry, PhotoImportStorageMode } from "./photoImportSessionDetails";

type PhotoPendingImportReviewText = (value: string) => string;

export type PhotoPendingImportReviewPanelProps = {
  entries: PendingPhotoImportEntry[];
  reviewSummary: PhotoImportReviewSummary;
  accessGuidance: PhotoImportAccessGuidance[];
  sourceKind: PhotoImportSourceKind;
  sourceLabelExplicit: boolean;
  storageMode: PhotoImportStorageMode;
  managedRootLabel: string;
  sourceDetail: string;
  keepFolderOrganization: boolean;
  albumTargetId: string;
  albumTargetName: string;
  albumNeedsName: boolean;
  albumName: string;
  albums: PhotoImportAlbumOption[];
  busy: boolean;
  importing: boolean;
  uiText: PhotoPendingImportReviewText;
  formatCount: (value: number) => string;
  fileName: (path: string) => string;
  onRemoveEntry: (path: string) => void;
  onAlbumTargetChange: (value: string) => void;
  onAlbumNameChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

function photoPendingImportReviewMeta(props: PhotoPendingImportReviewPanelProps) {
  const sourceLabel = photoImportReviewSourceLabel(
    props.sourceKind,
    props.reviewSummary.sourceLabel,
    props.sourceLabelExplicit,
  );
  return [
    `${props.formatCount(props.entries.length)} ${props.entries.length === 1 ? props.uiText("item") : props.uiText("items")}`,
    sourceLabel,
    props.storageMode === "managed" ? props.uiText("Copy into library") : props.uiText("Reference originals"),
    props.storageMode === "managed" && props.managedRootLabel ? `${props.uiText("Destination")}: ${props.managedRootLabel}` : "",
    props.sourceDetail.trim() ? props.uiText(props.sourceDetail.trim()) : "",
    props.storageMode === "managed" && props.keepFolderOrganization ? props.uiText("Keep folders") : "",
    props.albumTargetId ? `${props.uiText("Album")}: ${props.albumTargetName}` : "",
  ].filter(Boolean).join(" \u00b7 ");
}

export function PhotoPendingImportReviewPanel(props: PhotoPendingImportReviewPanelProps) {
  const confirmDisabled = props.busy || props.importing || !props.entries.length || (props.albumNeedsName && !props.albumName.trim());
  return (
    <div className="photo-import-review-panel" role="status" aria-label={props.uiText("Import review")}>
      <div className="photo-import-review-head">
        <span>
          <FolderInput size={15} />
          <strong>{props.uiText(props.reviewSummary.reviewTitle)}</strong>
        </span>
        <small>{photoPendingImportReviewMeta(props)}</small>
      </div>
      {(props.reviewSummary.reviewDetail || props.reviewSummary.hints.length > 0) && (
        <div className="photo-import-access-guidance" role="note">
          <Camera size={14} />
          <div>
            {props.reviewSummary.reviewDetail && <small>{props.uiText(props.reviewSummary.reviewDetail)}</small>}
            {props.reviewSummary.hints.length > 0 && <small>{props.reviewSummary.hints.map((hint) => props.uiText(hint)).join(" \u00b7 ")}</small>}
          </div>
        </div>
      )}
      <div className="photo-import-review-list">
        {props.entries.slice(0, 8).map((entry) => (
          <span key={entry.path} className="photo-import-review-row" title={entry.path}>
            {entry.isDir ? <Folder size={13} /> : <ImageIcon size={13} />}
            <small>{props.fileName(entry.path)}</small>
            <button
              type="button"
              className="ghost compact-action icon-only"
              onClick={() => props.onRemoveEntry(entry.path)}
              aria-label={`${props.uiText("Remove import item")} ${props.fileName(entry.path)}`}
            >
              <X size={13} />
            </button>
          </span>
        ))}
        {props.entries.length > 8 && <small>{props.formatCount(props.entries.length - 8)} {props.uiText("more")}</small>}
      </div>
      <div className="photo-import-album-target" aria-label={props.uiText("Import destination album")}>
        <label>
          <span>{props.uiText("Import to album")}</span>
          <select
            value={props.albumTargetId}
            onChange={(event) => props.onAlbumTargetChange(event.currentTarget.value)}
            disabled={props.busy || props.importing}
          >
            <option value="">{props.uiText("No album")}</option>
            <option value={PHOTO_IMPORT_NEW_ALBUM_TARGET}>{props.uiText("New manual album")}</option>
            {props.albums.map((album) => (
              <option key={album.albumId || album.id} value={photoImportAlbumOptionId(album)}>{album.name}</option>
            ))}
          </select>
        </label>
        {props.albumNeedsName && (
          <input
            aria-label={props.uiText("New import album name")}
            value={props.albumName}
            onChange={(event) => props.onAlbumNameChange(event.currentTarget.value)}
            placeholder={props.uiText("Album name")}
            disabled={props.busy || props.importing}
          />
        )}
      </div>
      {props.accessGuidance.length > 0 && (
        <div className="photo-import-access-guidance" role="note">
          <AlertTriangle size={14} />
          <div>
            {props.accessGuidance.map((guidance) => (
              <span key={guidance.code} title={guidance.path}>
                <strong>{props.uiText("Access note")}</strong>
                <small>{guidance.message}</small>
              </span>
            ))}
          </div>
        </div>
      )}
      {props.reviewSummary.deviceLike && (
        <div className="photo-import-access-guidance" role="note">
          <AlertTriangle size={14} />
          <div>
            <label className="photo-rule-toggle">
              <input type="checkbox" checked={false} disabled />
              <span>{props.uiText(props.reviewSummary.deleteFromSourceLabel)}</span>
            </label>
            <small>{props.uiText(props.reviewSummary.deleteFromSourceDetail)}</small>
          </div>
        </div>
      )}
      <div className="photo-import-review-actions">
        <button type="button" className="secondary compact-action" onClick={props.onConfirm} disabled={confirmDisabled}>
          <Check size={14} />
          <span>{props.importing ? props.uiText("Importing") : props.uiText("Confirm import")}</span>
        </button>
        <button type="button" className="ghost compact-action" onClick={props.onCancel} disabled={props.busy || props.importing}>
          <X size={14} />
          <span>{props.uiText("Cancel import")}</span>
        </button>
      </div>
    </div>
  );
}

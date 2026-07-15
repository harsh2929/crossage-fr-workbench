import { AlertTriangle, ChevronRight, Folder, FolderPlus, Images, RefreshCcw, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import type { PhotoAlbumSuggestion, PhotoFolder } from "../types";
import { photoCoverCropStyle } from "./photoCoverCrops";
import { photoRailAlbumTreeItemId, type PhotoAlbumGalleryState } from "./photoRailVisibility";

type PhotoAlbumsGalleryText = (value: string) => string;

export type PhotoAlbumsGalleryProps = {
  state: PhotoAlbumGalleryState<PhotoFolder>;
  hasAny: boolean;
  canCreateSmartAlbum: boolean;
  suggestions: PhotoAlbumSuggestion[];
  editor?: ReactNode;
  busy: boolean;
  savingAlbum: boolean;
  savingAlbumFolder: boolean;
  savingSuggestionId: string;
  uiText: PhotoAlbumsGalleryText;
  formatCount: (count: number) => string;
  onNewSmartAlbum: () => void;
  onNewManualAlbum: () => void;
  onNewFolder: () => void;
  onRefresh: () => void | Promise<void>;
  onBrowseFolder: (folderId: string) => void;
  onOpenAlbum: (folderId: string) => void;
  onSaveSuggestion: (suggestion: PhotoAlbumSuggestion) => void | Promise<void>;
};

export function PhotoAlbumsGallery(props: PhotoAlbumsGalleryProps) {
  const browsedAlbumFolder = props.state.browsedFolder;
  const albumBreadcrumbFolders = props.state.breadcrumbFolders;
  const visibleAlbumFolderCards = props.state.folderCards;
  const visibleAlbumCards = props.state.albumCards;

  return (
    <div className="albums-gallery">
      <div className="albums-gallery-head">
        <strong>{browsedAlbumFolder ? browsedAlbumFolder.name : props.uiText("Albums")}</strong>
        <span className="albums-gallery-summary">
          {props.formatCount(visibleAlbumFolderCards.length)} {visibleAlbumFolderCards.length === 1 ? props.uiText("folder") : props.uiText("folders")} · {props.formatCount(visibleAlbumCards.length)} {visibleAlbumCards.length === 1 ? props.uiText("album") : props.uiText("albums")}
        </span>
        {(props.hasAny || browsedAlbumFolder) && (
          <div className="albums-gallery-actions">
            <button type="button" className="primary albums-new-control" onClick={props.onNewSmartAlbum} disabled={props.busy || props.savingAlbum || props.savingAlbumFolder || !props.canCreateSmartAlbum} title={!props.canCreateSmartAlbum ? props.uiText("Add photos before creating a smart album") : undefined}><Sparkles size={15} /><span>{props.uiText("New smart album")}</span></button>
            <button type="button" className="secondary compact-action" onClick={props.onNewManualAlbum} disabled={props.busy || props.savingAlbum || props.savingAlbumFolder}><Images size={15} /><span>{props.uiText("New album")}</span></button>
            <button type="button" className="secondary compact-action" onClick={props.onNewFolder} disabled={props.busy || props.savingAlbumFolder}><FolderPlus size={15} /><span>{props.uiText("New folder")}</span></button>
            <button type="button" className="ghost compact-action" onClick={() => void props.onRefresh()} disabled={props.busy}><RefreshCcw size={15} /><span>{props.uiText("Refresh")}</span></button>
          </div>
        )}
      </div>
      {props.editor}
      {browsedAlbumFolder && (
        <div className="albums-breadcrumb" aria-label={props.uiText("Album folder path")}>
          <button type="button" className="ghost compact-action" onClick={() => props.onBrowseFolder("")}>{props.uiText("All albums")}</button>
          {albumBreadcrumbFolders.map((ancestor) => (
            <span className="albums-breadcrumb-seg" key={ancestor.id}>
              <ChevronRight size={14} aria-hidden="true" />
              <button type="button" className="ghost compact-action" onClick={() => props.onBrowseFolder(photoRailAlbumTreeItemId(ancestor))}>{ancestor.name}</button>
            </span>
          ))}
          <ChevronRight size={14} aria-hidden="true" />
          <span aria-current="page">{browsedAlbumFolder.name}</span>
        </div>
      )}
      {props.hasAny ? (
        <div className="albums-grid reveal-stagger">
          {visibleAlbumFolderCards.map(({ folder, folderKey, childCount }) => (
            <button type="button" className="album-folder-card" key={folder.id} onClick={() => props.onBrowseFolder(folderKey)}>
              <span className="album-folder-cover">{folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Folder size={26} />}</span>
              <span className="album-card-meta">
                <strong>{folder.name}</strong>
                <small>{props.formatCount(childCount)} {childCount === 1 ? props.uiText("item") : props.uiText("items")}</small>
              </span>
              <span className="album-folder-badge" aria-hidden="true"><Folder size={13} /></span>
            </button>
          ))}
          {visibleAlbumCards.map((folder) => (
            <div className="album-card" key={folder.id}>
              <button type="button" className="album-card-open" onClick={() => props.onOpenAlbum(folder.id)} aria-label={`${props.uiText("Open album")} ${folder.name}`}>
                <span className="album-card-cover">
                  {folder.coverPreviewUrl ? <img src={folder.coverPreviewUrl} alt="" loading="lazy" decoding="async" style={photoCoverCropStyle(folder.coverCrop)} /> : <Images size={22} />}
                  {folder.validation && folder.validation.length > 0 ? <span className="album-card-warn" title={folder.validation.join(" · ")} aria-label={`${folder.validation.length} ${props.uiText("issues need attention")}`}><AlertTriangle size={14} /></span> : null}
                </span>
                <span className="album-card-meta">
                  <strong>{folder.name}</strong>
                  <small>{props.formatCount(folder.count)} {folder.count === 1 ? props.uiText("photo") : props.uiText("photos")}</small>
                </span>
              </button>
              <span className={folder.albumKind === "manual" ? "album-card-kind-badge manual" : "album-card-kind-badge"}>{folder.albumKind === "manual" ? props.uiText("Manual") : props.uiText("Smart")}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="albums-empty">
          <Images size={30} />
          <strong>{props.uiText("Create your first album")}</strong>
          <span>{props.canCreateSmartAlbum
            ? props.uiText("Group photos yourself, or let a smart album collect them by rule.")
            : props.uiText("Create an album now, then add photos to it. Smart albums become available after your first import.")}</span>
          <div className="albums-empty-actions">
            <button type="button" className="primary" onClick={props.onNewManualAlbum} disabled={props.busy || props.savingAlbum || props.savingAlbumFolder}><Images size={16} /><span>{props.uiText("New album")}</span></button>
            <button type="button" className="secondary" onClick={props.onNewSmartAlbum} disabled={props.busy || props.savingAlbum || props.savingAlbumFolder || !props.canCreateSmartAlbum} title={!props.canCreateSmartAlbum ? props.uiText("Add photos before creating a smart album") : undefined}><Sparkles size={16} /><span>{props.uiText("New smart album")}</span></button>
          </div>
        </div>
      )}
      {props.suggestions.length > 0 && (
        <section className="albums-suggested" aria-label={props.uiText("Suggested albums")}>
          <div className="memories-section-head"><Sparkles size={16} /><strong>{props.uiText("Suggested albums")}</strong></div>
          <div className="albums-grid reveal-stagger">
            {props.suggestions.slice(0, 12).map((suggestion) => (
              <div className="album-suggestion-card" key={suggestion.id || suggestion.name}>
                <span className="album-suggestion-meta">
                  <strong>{suggestion.name}</strong>
                  {suggestion.reason ? <small>{suggestion.reason}</small> : null}
                  <small>{props.formatCount(suggestion.matchCount)} {props.uiText("matches")}</small>
                </span>
                <button
                  type="button"
                  className="secondary compact-action"
                  onClick={() => void props.onSaveSuggestion(suggestion)}
                  disabled={props.busy || props.savingAlbum || props.savingSuggestionId === (suggestion.id || suggestion.name)}
                >
                  <Images size={14} />
                  <span>{props.savingSuggestionId === (suggestion.id || suggestion.name) ? props.uiText("Adding") : props.uiText("Add album")}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

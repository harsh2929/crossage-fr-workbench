import { type DragEvent as ReactDragEvent } from "react";
import { AlertTriangle, Camera, ChevronRight, Copy, Download, ExternalLink, FolderInput, Images, Scissors, Sparkles, Star } from "lucide-react";
import type { PhotoItem, PhotoSubjectCutoutExportValue } from "../types";

export type PhotoLightboxSubjectCutoutVariant = "cutout" | "sticker";

type PhotoLightboxPrimaryActionsProps = {
  item: PhotoItem;
  label: string;
  isLivePhoto: boolean;
  isVideo: boolean;
  missing: boolean;
  busy: boolean;
  savingMetadata: boolean;
  slideshowLoading: boolean;
  photoRelinking: boolean;
  relinkStatus: string;
  relinkError: string;
  subjectCutoutExporting: boolean;
  portraitBlurExporting: boolean;
  subjectCutoutDragTarget: PhotoSubjectCutoutExportValue | null;
  actionError: string;
  uiText: (value: string) => string;
  onRelinkOriginals: (sourcePath: string) => void | Promise<void>;
  onToggleFavorite: (item: PhotoItem) => void | Promise<void>;
  onStartSlideshow: (sourcePath: string) => void | Promise<void>;
  onExportSubjectCutout: (item: PhotoItem, exportVariant: PhotoLightboxSubjectCutoutVariant, copyToClipboard?: boolean) => void | Promise<void>;
  onStartSubjectCutoutDrag: (event: ReactDragEvent<HTMLElement>, target: PhotoSubjectCutoutExportValue) => void;
  onRevealPath: (path: string) => void | Promise<void>;
  onExportPortraitBlur: (item: PhotoItem) => void | Promise<void>;
};

export function PhotoLightboxPrimaryActions({
  item,
  label,
  isLivePhoto,
  isVideo,
  missing,
  busy,
  savingMetadata,
  slideshowLoading,
  photoRelinking,
  relinkStatus,
  relinkError,
  subjectCutoutExporting,
  portraitBlurExporting,
  subjectCutoutDragTarget,
  actionError,
  uiText,
  onRelinkOriginals,
  onToggleFavorite,
  onStartSlideshow,
  onExportSubjectCutout,
  onStartSubjectCutoutDrag,
  onRevealPath,
  onExportPortraitBlur,
}: PhotoLightboxPrimaryActionsProps) {
  const mediaLabel = isLivePhoto ? uiText("Live Photo") : isVideo ? uiText("Video") : uiText("Image");

  return (
    <>
      <strong>{label}</strong>
      <span>{mediaLabel}</span>
      {missing && (
        <span className="photo-missing-inline">
          <AlertTriangle size={14} />
          <span>{uiText("Original file is missing. Restore the file or use library repair/relink.")}</span>
        </span>
      )}
      {missing && (
        <button type="button" className="secondary compact-action" onClick={() => void onRelinkOriginals(item.sourcePath)} disabled={photoRelinking || busy}>
          <FolderInput size={16} />
          <span>{photoRelinking ? uiText("Relinking") : uiText("Relink folder")}</span>
        </button>
      )}
      {missing && (relinkStatus || relinkError) && (
        <small>{relinkError ? `${uiText("Relink failed")}: ${relinkError}` : relinkStatus}</small>
      )}
      <button
        type="button"
        className={item.favorite ? "secondary compact-action photo-favorite-action active" : "secondary compact-action photo-favorite-action"}
        onClick={() => void onToggleFavorite(item)}
        disabled={savingMetadata}
      >
        <Star size={16} fill={item.favorite ? "currentColor" : "none"} />
        <span>{item.favorite ? uiText("Favorite") : uiText("Mark favorite")}</span>
      </button>
      <button
        type="button"
        className="secondary compact-action"
        onClick={() => void onStartSlideshow(item.sourcePath)}
        disabled={busy || missing || slideshowLoading}
      >
        <Images size={16} />
        <span>{slideshowLoading ? uiText("Loading slideshow") : uiText("Start slideshow")}</span>
      </button>
      {!isVideo && (
        <details className="photo-lightbox-disclosure photo-lightbox-create-disclosure">
          <summary>
            <Sparkles size={15} />
            <span>
              <strong>{uiText("Create & export")}</strong>
              <small>{uiText("Subject and portrait tools")}</small>
            </span>
            <ChevronRight size={15} />
          </summary>
          <div className="photo-lightbox-disclosure-body">
            <div className="photos-subject-cutout-actions">
              <span>
                <Scissors size={14} />
                <strong>{uiText("Subject")}</strong>
              </span>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportSubjectCutout(item, "cutout")}
                disabled={subjectCutoutExporting || busy || missing || !item.sourcePath}
                aria-label={uiText("Export subject cutout PNG")}
              >
                <Scissors size={14} />
                <span>{subjectCutoutExporting ? uiText("Exporting") : uiText("Cutout PNG")}</span>
              </button>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportSubjectCutout(item, "cutout", true)}
                disabled={subjectCutoutExporting || busy || missing || !item.sourcePath}
                aria-label={uiText("Copy subject cutout PNG")}
              >
                <Copy size={14} />
                <span>{subjectCutoutExporting ? uiText("Copying") : uiText("Copy cutout")}</span>
              </button>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportSubjectCutout(item, "sticker")}
                disabled={subjectCutoutExporting || busy || missing || !item.sourcePath}
                aria-label={uiText("Export subject sticker PNG")}
              >
                <Download size={14} />
                <span>{subjectCutoutExporting ? uiText("Exporting") : uiText("Sticker PNG")}</span>
              </button>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportSubjectCutout(item, "sticker", true)}
                disabled={subjectCutoutExporting || busy || missing || !item.sourcePath}
                aria-label={uiText("Copy subject sticker PNG")}
              >
                <Copy size={14} />
                <span>{subjectCutoutExporting ? uiText("Copying") : uiText("Copy sticker")}</span>
              </button>
              {subjectCutoutDragTarget && (
                <button
                  type="button"
                  className="secondary compact-action"
                  draggable
                  onDragStart={(event) => onStartSubjectCutoutDrag(event, subjectCutoutDragTarget)}
                  onClick={() => void onRevealPath(subjectCutoutDragTarget.targetPath)}
                  aria-label={uiText("Drag generated subject PNG")}
                  title={uiText("Drag generated subject PNG")}
                >
                  <ExternalLink size={14} />
                  <span>{uiText("Drag PNG")}</span>
                </button>
              )}
              {actionError && <small className="photos-video-frame-error">{actionError}</small>}
            </div>
            <div className="photos-subject-cutout-actions">
              <span>
                <Camera size={14} />
                <strong>{uiText("Portrait")}</strong>
              </span>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportPortraitBlur(item)}
                disabled={portraitBlurExporting || busy || missing || !item.sourcePath}
                aria-label={uiText("Export depth-aware portrait blur PNG")}
                title={uiText("Blur the background with on-device depth (Portrait mode)")}
              >
                <Camera size={14} />
                <span>{portraitBlurExporting ? uiText("Exporting") : uiText("Portrait blur")}</span>
              </button>
            </div>
          </div>
        </details>
      )}
    </>
  );
}

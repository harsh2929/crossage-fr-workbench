import { useRef, useState, type DragEvent as ReactDragEvent } from "react";
import { Check, Download, Play, Trash2, Video } from "lucide-react";
import {
  photoSlideshowTimelineDragIncludesSourcePath,
  photoSlideshowTimelineDropPlacementFromRect,
} from "./photoSlideshowDisplay";

export type PhotoSlideshowProjectTimelinePreviewItem = {
  sourcePath: string;
  index: number;
  durationMs: number;
  motionLabel: string;
  keyframeLabel: string;
  cropLabel: string;
  captionLabel: string;
  transitionLabel: string;
  selected: boolean;
  audioStart: boolean;
  audioEnd: boolean;
};

type PhotoSlideshowProjectTimelineControlsProps = {
  items: PhotoSlideshowProjectTimelinePreviewItem[];
  hiddenCount: number;
  previewSourceCount: number;
  selectedSources: ReadonlySet<string>;
  canSave: boolean;
  hasSelectedProject: boolean;
  busy: boolean;
  slideshowLoading: boolean;
  uiText: (value: string) => string;
  fileName: (value: string) => string;
  formatCount: (value: number) => string;
  onReorderDragged: (draggedSourcePath: string, targetSourcePath: string, placement: "before" | "after") => void;
  onSaveProject: () => void;
  onPlayProject: () => void;
  onExportHtml: () => void;
  onExportVideo: () => void;
  onDeleteProject: () => void;
};

export function PhotoSlideshowProjectTimelineControls({
  items,
  hiddenCount,
  previewSourceCount,
  selectedSources,
  canSave,
  hasSelectedProject,
  busy,
  slideshowLoading,
  uiText,
  fileName,
  formatCount,
  onReorderDragged,
  onSaveProject,
  onPlayProject,
  onExportHtml,
  onExportVideo,
  onDeleteProject,
}: PhotoSlideshowProjectTimelineControlsProps) {
  const [dragSourcePath, setDragSourcePath] = useState("");
  const dragSourcePathRef = useRef("");
  const disabled = busy || slideshowLoading;
  const canDrag = previewSourceCount > 1 && !disabled;

  function dragIncludesTarget(sourcePath: string) {
    return photoSlideshowTimelineDragIncludesSourcePath(dragSourcePathRef.current || dragSourcePath, sourcePath, selectedSources);
  }

  function handleDragOver(sourcePath: string, event: ReactDragEvent<HTMLDivElement>) {
    if (!(dragSourcePathRef.current || dragSourcePath) || dragIncludesTarget(sourcePath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }

  function handleDrop(sourcePath: string, event: ReactDragEvent<HTMLDivElement>) {
    const draggedSourcePath = dragSourcePathRef.current || dragSourcePath;
    if (!draggedSourcePath || dragIncludesTarget(sourcePath)) return;
    event.preventDefault();
    const placement = photoSlideshowTimelineDropPlacementFromRect(event.clientX, event.currentTarget.getBoundingClientRect());
    onReorderDragged(draggedSourcePath, sourcePath, placement);
    dragSourcePathRef.current = "";
    setDragSourcePath("");
  }

  return (
    <>
      {items.length > 0 && (
        <div className="photo-slideshow-timeline-preview" role="list" aria-label={uiText("Slideshow timeline")}>
          {items.map((item) => (
            <div
              key={`${item.sourcePath}:${item.index}`}
              role="listitem"
              draggable={canDrag}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.sourcePath);
                dragSourcePathRef.current = item.sourcePath;
                setDragSourcePath(item.sourcePath);
              }}
              onDragOver={(event) => handleDragOver(item.sourcePath, event)}
              onDrop={(event) => handleDrop(item.sourcePath, event)}
              onDragEnd={() => {
                dragSourcePathRef.current = "";
                setDragSourcePath("");
              }}
              className={[
                "photo-slideshow-timeline-card",
                item.selected ? "selected" : "",
                dragIncludesTarget(item.sourcePath) ? "dragging" : "",
                item.audioStart ? "audio-start" : "",
                item.audioEnd ? "audio-end" : "",
              ].filter(Boolean).join(" ")}
              title={item.sourcePath}
            >
              <span className="photo-slideshow-timeline-index">{formatCount(item.index + 1)}</span>
              <strong>{fileName(item.sourcePath) || uiText("Slide")}</strong>
              <small>{`${(item.durationMs / 1000).toFixed(1)}s`}</small>
              <small>{item.motionLabel}</small>
              {item.keyframeLabel && <small>{item.keyframeLabel}</small>}
              {item.cropLabel && <small>{item.cropLabel}</small>}
              {item.captionLabel && <small>{item.captionLabel}</small>}
              <small>{item.transitionLabel}</small>
              {(item.audioStart || item.audioEnd) && (
                <span className="photo-slideshow-timeline-markers">
                  {item.audioStart && <span>{uiText("Audio starts")}</span>}
                  {item.audioEnd && <span>{uiText("Audio ends")}</span>}
                </span>
              )}
            </div>
          ))}
          {hiddenCount > 0 && (
            <span className="photo-slideshow-timeline-more">{`+${formatCount(hiddenCount)}`}</span>
          )}
        </div>
      )}
      <button type="button" className="secondary compact-action" onClick={onSaveProject} disabled={!canSave || disabled}>
        <Check size={14} />
        <span>{slideshowLoading ? uiText("Saving") : uiText("Save slideshow")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onPlayProject} disabled={!hasSelectedProject || disabled}>
        <Play size={14} />
        <span>{uiText("Play project")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onExportHtml} disabled={!hasSelectedProject || disabled}>
        <Download size={14} />
        <span>{slideshowLoading ? uiText("Exporting") : uiText("Export slideshow")}</span>
      </button>
      <button type="button" className="secondary compact-action" onClick={onExportVideo} disabled={!hasSelectedProject || disabled}>
        <Video size={14} />
        <span>{slideshowLoading ? uiText("Exporting") : uiText("Export movie")}</span>
      </button>
      <button type="button" className="ghost compact-action" onClick={onDeleteProject} disabled={!hasSelectedProject || disabled}>
        <Trash2 size={14} />
        <span>{uiText("Delete project")}</span>
      </button>
    </>
  );
}

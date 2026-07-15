import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { AlertTriangle, ImageIcon } from "lucide-react";
import type { PhotoItem } from "../types";
import type { PhotoDescriptionRegion } from "./photoDescriptionRegions";
import type { PhotoImageMarkupAnnotation, PhotoImageRetouchSpot } from "./photoImageEdits";
import type { LightboxFitMode } from "./photoLightboxSession";
import type { PhotoLiveTextRegion, PhotoLiveTextRegionStageBox } from "./photoLiveTextActions";
import { photoObjectTagConfidenceLabel, type PhotoObjectTagReviewRow } from "./photoObjectTags";
import type { PhotoQrRegion } from "./photoQrActions";
import type { PhotoHdrDisplayState } from "./photoSettings";
import { PhotoVideoCaptionCue, type PhotoAudioTimelineSegment } from "./photoVideoTranscript";

type PercentBox = PhotoLiveTextRegionStageBox;

type PhotoLightboxStageProps = {
  className: string;
  stageRef: RefObject<HTMLDivElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  item: PhotoItem;
  imageAlt: string;
  missing: boolean;
  usesVideoControls: boolean;
  isVideo: boolean;
  isLivePhoto: boolean;
  videoSourceUrl: string;
  imageSourceUrl: string;
  fitMode: LightboxFitMode;
  pan: { x: number; y: number };
  zoom: number;
  dragging: boolean;
  autoplayVideo: boolean;
  videoMuted: boolean;
  transcriptSegments: PhotoAudioTimelineSegment[];
  captionsEnabled: boolean;
  hdrRequestedMode: string;
  hdrDisplayState: PhotoHdrDisplayState | null;
  runtimeHdrAvailable: boolean;
  safetyOverlay: ReactNode;
  manualCropOverlayBox: PercentBox | null;
  markupOverlayBox: PercentBox | null;
  markupStrokePreviewPoints: string;
  markupSelectedAnnotation: PhotoImageMarkupAnnotation;
  markupSelectedDraftIndex: number;
  retouchCloneSourceOverlayBox: PercentBox | null;
  retouchOverlayBoxes: Array<{ box: PercentBox; index: number; spot: PhotoImageRetouchSpot }>;
  retouchSelectedDraftIndex: number;
  liveTextRegionBoxes: Array<{ region: PhotoLiveTextRegion; box: PercentBox }>;
  selectedLiveTextRegionId: string;
  qrRegionBoxes: Array<{ region: PhotoQrRegion; box: PercentBox; active: boolean }>;
  objectTagRegionBoxes: Array<{ row: PhotoObjectTagReviewRow; box: PercentBox; active: boolean }>;
  descriptionRegionBoxes: Array<{ region: PhotoDescriptionRegion; box: PercentBox; active: boolean }>;
  uiText: (value: string) => string;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onSyncVideoState: (video: HTMLVideoElement) => void;
  onCaptureVideoPosition: (video: HTMLVideoElement) => void;
  onToggleLiveTextRegion: (regionId: string) => void;
  onToggleQrRegion: (regionId: string) => void;
  onToggleObjectTagRegion: (rowId: string) => void;
};

const EDIT_BOX_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

function boxStyle(box: PercentBox): CSSProperties {
  return {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
  };
}

export function PhotoLightboxStage({
  className,
  stageRef,
  imageRef,
  videoRef,
  item,
  imageAlt,
  missing,
  usesVideoControls,
  isVideo,
  isLivePhoto,
  videoSourceUrl,
  imageSourceUrl,
  fitMode,
  pan,
  zoom,
  dragging,
  autoplayVideo,
  videoMuted,
  transcriptSegments,
  captionsEnabled,
  hdrRequestedMode,
  hdrDisplayState,
  runtimeHdrAvailable,
  safetyOverlay,
  manualCropOverlayBox,
  markupOverlayBox,
  markupStrokePreviewPoints,
  markupSelectedAnnotation,
  markupSelectedDraftIndex,
  retouchCloneSourceOverlayBox,
  retouchOverlayBoxes,
  retouchSelectedDraftIndex,
  liveTextRegionBoxes,
  selectedLiveTextRegionId,
  qrRegionBoxes,
  objectTagRegionBoxes,
  descriptionRegionBoxes,
  uiText,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onSyncVideoState,
  onCaptureVideoPosition,
  onToggleLiveTextRegion,
  onToggleQrRegion,
  onToggleObjectTagRegion,
}: PhotoLightboxStageProps) {
  const transformStyle = {
    transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
  } as CSSProperties;
  const mediaStyle = {
    ...transformStyle,
    cursor: zoom > 1 ? (dragging ? "grabbing" : "grab") : "default",
  } as CSSProperties;
  const showImageRegionOverlays = !missing && !isVideo && Boolean(imageSourceUrl);

  return (
    <div
      className={className}
      ref={stageRef}
      onClick={(event) => event.stopPropagation()}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {missing ? (
        <div className="photos-lightbox-fallback missing-original">
          <AlertTriangle size={48} />
          <span>{uiText("Original file is missing")}</span>
        </div>
      ) : usesVideoControls && videoSourceUrl ? (
        <video
          ref={videoRef}
          className={fitMode === "fill" ? "photos-lightbox-video fill" : "photos-lightbox-video"}
          src={videoSourceUrl}
          poster={item.previewUrl || item.sourceUrl || undefined}
          preload="metadata"
          autoPlay={autoplayVideo}
          muted={videoMuted}
          playsInline
          data-hdr-requested={hdrRequestedMode}
          data-hdr-viewing={hdrDisplayState?.effectiveMode || "standard"}
          data-hdr-runtime={runtimeHdrAvailable ? "available" : "unavailable"}
          aria-label={uiText(isLivePhoto ? "Live Photo motion preview" : "Video preview")}
          onLoadedMetadata={(event) => onSyncVideoState(event.currentTarget)}
          onDurationChange={(event) => onSyncVideoState(event.currentTarget)}
          onTimeUpdate={(event) => onCaptureVideoPosition(event.currentTarget)}
          onPlay={(event) => onSyncVideoState(event.currentTarget)}
          onPause={(event) => onSyncVideoState(event.currentTarget)}
          onVolumeChange={(event) => onSyncVideoState(event.currentTarget)}
          style={mediaStyle}
        />
      ) : imageSourceUrl ? (
        <img
          ref={imageRef}
          className={fitMode === "fill" ? "photos-lightbox-image fill" : "photos-lightbox-image"}
          src={imageSourceUrl}
          alt={imageAlt}
          draggable={false}
          data-hdr-requested={hdrRequestedMode}
          data-hdr-viewing={hdrDisplayState?.effectiveMode || "standard"}
          data-hdr-runtime={runtimeHdrAvailable ? "available" : "unavailable"}
          style={mediaStyle}
        />
      ) : (
        <div className="photos-lightbox-fallback">
          <ImageIcon size={48} />
        </div>
      )}
      {safetyOverlay}
      {usesVideoControls && videoSourceUrl ? (
        <PhotoVideoCaptionCue
          videoRef={videoRef}
          sourceKey={item.sourcePath}
          segments={transcriptSegments}
          enabled={captionsEnabled}
          uiText={uiText}
        />
      ) : null}
      {hdrDisplayState && !missing && (
        <div
          className={`photos-lightbox-hdr-badge ${hdrDisplayState.badgeTone}`}
          title={uiText(hdrDisplayState.detail)}
          aria-label={uiText(hdrDisplayState.detail)}
        >
          <span>{uiText(hdrDisplayState.badgeLabel)}</span>
        </div>
      )}
      {manualCropOverlayBox && (
        <div className="photos-edit-crop-overlay-layer" aria-hidden="true" style={transformStyle}>
          <div className="photos-edit-crop-overlay" style={boxStyle(manualCropOverlayBox)}>
            <span className="photos-edit-crop-grid horizontal one" />
            <span className="photos-edit-crop-grid horizontal two" />
            <span className="photos-edit-crop-grid vertical one" />
            <span className="photos-edit-crop-grid vertical two" />
            {EDIT_BOX_HANDLES.map((handle) => (
              <span key={handle} className={`photos-edit-crop-handle ${handle}`} />
            ))}
          </div>
        </div>
      )}
      {markupOverlayBox && (
        <div className="photos-edit-markup-overlay-layer" aria-hidden="true" style={transformStyle}>
          {markupStrokePreviewPoints && (
            <svg className="photos-edit-markup-stroke-preview" viewBox="0 0 100 100" preserveAspectRatio="none">
              <polyline
                points={markupStrokePreviewPoints}
                fill="none"
                stroke={markupSelectedAnnotation.color}
                strokeOpacity={Math.max(0.1, Math.min(1, markupSelectedAnnotation.opacity / 100))}
                strokeWidth={markupSelectedAnnotation.kind === "signature" ? 0.65 : 0.45}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <div className={`photos-edit-markup-overlay ${markupSelectedAnnotation.kind}`} style={boxStyle(markupOverlayBox)}>
            <span className="photos-edit-markup-overlay-label">{markupSelectedDraftIndex + 1}</span>
            {EDIT_BOX_HANDLES.map((handle) => (
              <span key={handle} className={`photos-edit-markup-handle ${handle}`} />
            ))}
          </div>
        </div>
      )}
      {retouchOverlayBoxes.length > 0 && (
        <div className="photos-edit-retouch-overlay-layer" aria-hidden="true" style={transformStyle}>
          {retouchCloneSourceOverlayBox && (
            <div className="photos-edit-retouch-source-overlay" style={boxStyle(retouchCloneSourceOverlayBox)}>
              <span className="photos-edit-retouch-overlay-label">{uiText("Src")}</span>
            </div>
          )}
          {retouchOverlayBoxes.map(({ box, index, spot }) => (
            <div
              key={`${spot.kind}-${index}-${spot.left}-${spot.top}`}
              className={[
                "photos-edit-retouch-overlay",
                spot.kind,
                index === retouchSelectedDraftIndex ? "selected" : "",
              ].filter(Boolean).join(" ")}
              style={boxStyle(box)}
            >
              <span className="photos-edit-retouch-overlay-label">{index + 1}</span>
            </div>
          ))}
        </div>
      )}
      {showImageRegionOverlays && liveTextRegionBoxes.length > 0 && (
        <div className="photos-live-text-region-layer" style={transformStyle}>
          {liveTextRegionBoxes.map(({ region, box }) => (
            <button
              key={region.id}
              type="button"
              className={selectedLiveTextRegionId === region.id ? "photos-live-text-region active" : "photos-live-text-region"}
              aria-label={`${uiText("Select text region")}: ${region.text}`}
              aria-pressed={selectedLiveTextRegionId === region.id}
              onClick={(event) => {
                event.stopPropagation();
                onToggleLiveTextRegion(region.id);
              }}
              title={region.confidence ? `${region.text} (${region.confidence})` : region.text}
              style={boxStyle(box)}
            />
          ))}
        </div>
      )}
      {showImageRegionOverlays && qrRegionBoxes.length > 0 && (
        <div className="photos-qr-region-layer" style={transformStyle}>
          {qrRegionBoxes.map(({ region, box, active }, index) => (
            <button
              key={region.id}
              type="button"
              className={active ? "photos-qr-region active" : "photos-qr-region"}
              aria-label={`${uiText("Select QR region")}: ${region.text}`}
              aria-pressed={active}
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleQrRegion(region.id);
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (event.detail === 0) {
                  onToggleQrRegion(region.id);
                }
              }}
              title={region.confidence ? `${region.text} (${region.confidence})` : region.text}
              style={boxStyle(box)}
            >
              <span>{index + 1}</span>
            </button>
          ))}
        </div>
      )}
      {showImageRegionOverlays && objectTagRegionBoxes.length > 0 && (
        <div className="photos-object-tag-region-layer" style={transformStyle}>
          {objectTagRegionBoxes.map(({ row, box, active }, index) => {
            const className = [
              "photos-object-tag-region",
              active ? "active" : "",
              row.action === "confirmed" ? "confirmed" : "",
              row.action === "rejected" ? "rejected" : "",
              row.lowConfidence ? "low-confidence" : "",
            ].filter(Boolean).join(" ");
            const confidenceLabel = photoObjectTagConfidenceLabel(row.confidence);
            return (
              <button
                key={row.id}
                type="button"
                className={className}
                aria-label={`${uiText("Select detected item region")}: ${row.label}`}
                aria-pressed={active}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onToggleObjectTagRegion(row.id);
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.detail === 0) {
                    onToggleObjectTagRegion(row.id);
                  }
                }}
                title={confidenceLabel ? `${row.label} (${confidenceLabel})` : row.label}
                style={boxStyle(box)}
              >
                <span>{index + 1}</span>
              </button>
            );
          })}
        </div>
      )}
      {showImageRegionOverlays && descriptionRegionBoxes.length > 0 && (
        <div className="photos-description-region-layer" aria-hidden="true" style={transformStyle}>
          {descriptionRegionBoxes.map(({ region, box, active }) => (
            <span
              key={region.id}
              className={active ? "photos-description-region active" : "photos-description-region"}
              title={region.confidence ? `${region.text} (${region.confidence})` : region.text}
              style={boxStyle(box)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

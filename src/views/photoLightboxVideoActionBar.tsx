import { type CSSProperties, type RefObject } from "react";
import { Captions, Crop, Download, ImageIcon, RotateCcw, RotateCw, Scissors, SlidersHorizontal } from "lucide-react";
import type { PhotoItem } from "../types";
import { PhotoLightboxVideoControls, type PhotoVideoCropAspect, type PhotoVideoRotateDegrees } from "./photoLightboxVideoControls";
import { formatPhotoDuration as formatDuration } from "./photoDuration";

type PhotoLiveMotionExportVariant = "motion" | "loop_gif" | "bounce_gif";

type PhotoLightboxVideoActionBarProps = {
  item: PhotoItem;
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  durationMs: number;
  paused: boolean;
  muted: boolean;
  captionCount: number;
  captionsEnabled: boolean;
  captionsLoading: boolean;
  isLivePhoto: boolean;
  isVideo: boolean;
  liveMotionPath: string;
  videoFrameExporting: boolean;
  liveMotionExporting: boolean;
  liveKeyPhotoSaving: boolean;
  liveKeyPhotoResetting: boolean;
  keyPhotoActive: boolean;
  videoTrimTimelineStyle: CSSProperties;
  videoTrimHandleStartMs: number;
  videoTrimHandleEndMs: number;
  videoTrimTimelineMaxMs: number;
  videoTrimExporting: boolean;
  videoTrimRangeValid: boolean;
  videoTrimRangeLabel: string;
  videoRotateDegrees: PhotoVideoRotateDegrees;
  videoCropAspect: PhotoVideoCropAspect;
  videoTransformActive: boolean;
  videoTransformLabel: string;
  videoPosterPolicy: string;
  videoPosterTimestampMs: number;
  videoPosterSaving: boolean;
  videoPosterResetting: boolean;
  hasVideoPoster: boolean;
  error: string;
  uiText: (value: string) => string;
  onTogglePlayback: () => void | Promise<void>;
  onToggleMuted: () => void;
  onToggleCaptions: () => void;
  onScrub: (nextMs: number) => void;
  onExportVideoFrame: (item: PhotoItem) => void | Promise<void>;
  onExportLiveMotion: (item: PhotoItem, variant: PhotoLiveMotionExportVariant) => void | Promise<void>;
  onSetLiveKeyPhoto: (item: PhotoItem) => void | Promise<void>;
  onResetLiveKeyPhoto: (item: PhotoItem) => void | Promise<void>;
  onMarkTrimStart: () => void;
  onMarkTrimEnd: () => void;
  onUpdateTrimStart: (value: number) => void;
  onUpdateTrimEnd: (value: number) => void;
  onExportVideoTrim: (item: PhotoItem) => void | Promise<void>;
  onCycleRotate: () => void;
  onCropAspectChange: (value: PhotoVideoCropAspect) => void;
  onResetTransform: () => void;
  onPosterPolicyChange: (item: PhotoItem, policy: string) => void | Promise<void>;
  onSetVideoPoster: (item: PhotoItem) => void | Promise<void>;
  onExportVideoPosterFrame: (item: PhotoItem) => void | Promise<void>;
  onResetVideoPoster: (item: PhotoItem) => void | Promise<void>;
};

export function PhotoLightboxVideoActionBar({
  item,
  videoRef,
  sourceKey,
  durationMs,
  paused,
  muted,
  captionCount,
  captionsEnabled,
  captionsLoading,
  isLivePhoto,
  isVideo,
  liveMotionPath,
  videoFrameExporting,
  liveMotionExporting,
  liveKeyPhotoSaving,
  liveKeyPhotoResetting,
  keyPhotoActive,
  videoTrimTimelineStyle,
  videoTrimHandleStartMs,
  videoTrimHandleEndMs,
  videoTrimTimelineMaxMs,
  videoTrimExporting,
  videoTrimRangeValid,
  videoTrimRangeLabel,
  videoRotateDegrees,
  videoCropAspect,
  videoTransformActive,
  videoTransformLabel,
  videoPosterPolicy,
  videoPosterTimestampMs,
  videoPosterSaving,
  videoPosterResetting,
  hasVideoPoster,
  error,
  uiText,
  onTogglePlayback,
  onToggleMuted,
  onToggleCaptions,
  onScrub,
  onExportVideoFrame,
  onExportLiveMotion,
  onSetLiveKeyPhoto,
  onResetLiveKeyPhoto,
  onMarkTrimStart,
  onMarkTrimEnd,
  onUpdateTrimStart,
  onUpdateTrimEnd,
  onExportVideoTrim,
  onCycleRotate,
  onCropAspectChange,
  onResetTransform,
  onPosterPolicyChange,
  onSetVideoPoster,
  onExportVideoPosterFrame,
  onResetVideoPoster,
}: PhotoLightboxVideoActionBarProps) {
  const hasSourcePath = Boolean(item.sourcePath);
  const canExportCurrentFrame = Boolean(isVideo || liveMotionPath);
  const videoPosterTimestampLabel = videoPosterPolicy === "default" ? "" : formatDuration(videoPosterTimestampMs) || "0s";
  const videoPosterLabel = videoPosterPolicy === "auto"
    ? `${uiText("Auto poster")} ${videoPosterTimestampLabel}`
    : videoPosterPolicy === "manual"
      ? `${uiText("Manual poster")} ${videoPosterTimestampLabel}`
      : uiText("Generated poster");

  return (
    <div className="photos-lightbox-video-controls" onClick={(event) => event.stopPropagation()}>
      <div className="photos-lightbox-video-primary">
        <PhotoLightboxVideoControls
          videoRef={videoRef}
          sourceKey={sourceKey}
          durationMs={durationMs}
          paused={paused}
          muted={muted}
          isLivePhoto={isLivePhoto}
          uiText={uiText}
          onTogglePlayback={onTogglePlayback}
          onToggleMuted={onToggleMuted}
          onScrub={onScrub}
        />
        <button
          type="button"
          className="secondary compact-action"
          onClick={onToggleCaptions}
          disabled={captionsLoading || captionCount === 0}
          aria-pressed={captionsEnabled}
          aria-label={uiText(captionsEnabled ? "Hide captions" : "Show captions")}
        >
          <Captions size={14} />
          <span>{uiText("Captions")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={() => void onExportVideoFrame(item)}
          disabled={videoFrameExporting || !canExportCurrentFrame || !hasSourcePath}
          aria-label={uiText("Export current video frame")}
        >
          <Download size={14} />
          <span>{videoFrameExporting ? uiText("Exporting") : uiText("Export frame")}</span>
        </button>
      </div>
      <details className="photos-lightbox-video-tools">
        <summary tabIndex={0}><SlidersHorizontal size={14} aria-hidden="true" /><span>{uiText("Video tools")}</span></summary>
        <div className="photos-lightbox-video-tools-body">
      {isLivePhoto ? (
        <>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onExportLiveMotion(item, "motion")}
            disabled={liveMotionExporting || !hasSourcePath}
            aria-label={uiText("Export Live Photo motion")}
          >
            <Download size={14} />
            <span>{liveMotionExporting ? uiText("Exporting") : uiText("Export motion")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onExportLiveMotion(item, "loop_gif")}
            disabled={liveMotionExporting || !hasSourcePath}
            aria-label={uiText("Export Live Photo loop GIF")}
          >
            <Download size={14} />
            <span>{liveMotionExporting ? uiText("Exporting") : uiText("Export GIF")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onExportLiveMotion(item, "bounce_gif")}
            disabled={liveMotionExporting || !hasSourcePath}
            aria-label={uiText("Export Live Photo bounce GIF")}
          >
            <Download size={14} />
            <span>{liveMotionExporting ? uiText("Exporting") : uiText("Bounce GIF")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onSetLiveKeyPhoto(item)}
            disabled={liveKeyPhotoSaving || !hasSourcePath}
            aria-label={uiText("Use current Live Photo frame as key photo")}
          >
            <ImageIcon size={14} />
            <span>{liveKeyPhotoSaving ? uiText("Saving") : uiText("Set key photo")}</span>
          </button>
          {keyPhotoActive && (
            <button
              type="button"
              className="secondary compact-action"
              onClick={() => void onResetLiveKeyPhoto(item)}
              disabled={liveKeyPhotoResetting || !hasSourcePath}
              aria-label={uiText("Reset Live Photo key photo")}
            >
              <RotateCcw size={14} />
              <span>{liveKeyPhotoResetting ? uiText("Resetting") : uiText("Reset key photo")}</span>
            </button>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onMarkTrimStart}
            disabled={!isVideo || !hasSourcePath}
            aria-label={uiText("Mark video trim start")}
          >
            <Scissors size={14} />
            <span>{uiText("Mark start")}</span>
          </button>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onMarkTrimEnd}
            disabled={!isVideo || !hasSourcePath}
            aria-label={uiText("Mark video trim end")}
          >
            <Scissors size={14} />
            <span>{uiText("Mark end")}</span>
          </button>
          <div
            className="photos-video-trim-timeline"
            role="group"
            aria-label={uiText("Video trim timeline")}
            style={videoTrimTimelineStyle}
          >
            <span className="photos-video-trim-track" aria-hidden="true">
              <span className="photos-video-trim-selection" />
            </span>
            <label className="photos-video-trim-handle-row">
              <span className="photos-video-time">{formatDuration(videoTrimHandleStartMs) || "0s"}</span>
              <input
                type="range"
                min={0}
                max={videoTrimTimelineMaxMs}
                step={250}
                value={Math.min(videoTrimHandleStartMs, videoTrimTimelineMaxMs)}
                onChange={(event) => onUpdateTrimStart(Number(event.currentTarget.value))}
                disabled={!isVideo || !hasSourcePath || videoTrimTimelineMaxMs <= 0}
                aria-label={uiText("Video trim start handle")}
              />
            </label>
            <label className="photos-video-trim-handle-row">
              <span className="photos-video-time">{formatDuration(videoTrimHandleEndMs) || uiText("End")}</span>
              <input
                type="range"
                min={0}
                max={videoTrimTimelineMaxMs}
                step={250}
                value={Math.min(videoTrimHandleEndMs, videoTrimTimelineMaxMs)}
                onChange={(event) => onUpdateTrimEnd(Number(event.currentTarget.value))}
                disabled={!isVideo || !hasSourcePath || videoTrimTimelineMaxMs <= 0}
                aria-label={uiText("Video trim end handle")}
              />
            </label>
          </div>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onExportVideoTrim(item)}
            disabled={videoTrimExporting || !videoTrimRangeValid || !hasSourcePath}
            aria-label={uiText("Export selected video trim")}
          >
            <Download size={14} />
            <span>{videoTrimExporting ? uiText("Exporting") : uiText("Export trim")}</span>
          </button>
          <span className="photos-video-time">{videoTrimRangeLabel}</span>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onCycleRotate}
            disabled={!isVideo || !hasSourcePath}
            aria-label={uiText("Rotate video export")}
          >
            <RotateCw size={14} />
            <span>{videoRotateDegrees ? `${videoRotateDegrees}` : uiText("Rotate")}</span>
          </button>
          <label className="photos-video-crop-select">
            <Crop size={14} />
            <select
              value={videoCropAspect}
              onChange={(event) => onCropAspectChange(event.currentTarget.value as PhotoVideoCropAspect)}
              disabled={!isVideo || !hasSourcePath}
              aria-label={uiText("Video crop aspect")}
            >
              <option value="none">{uiText("Original")}</option>
              <option value="square">{uiText("Square")}</option>
              <option value="landscape">16:9</option>
              <option value="portrait">4:5</option>
            </select>
          </label>
          <button
            type="button"
            className="secondary compact-action"
            onClick={onResetTransform}
            disabled={!videoTransformActive}
            aria-label={uiText("Reset video export transform")}
          >
            <RotateCcw size={14} />
            <span>{uiText("Reset")}</span>
          </button>
          <span className="photos-video-time photos-video-transform-label">{videoTransformLabel}</span>
          <label className="photos-video-crop-select">
            <ImageIcon size={14} />
            <select
              value={videoPosterPolicy}
              onChange={(event) => void onPosterPolicyChange(item, event.currentTarget.value)}
              disabled={videoPosterSaving || videoPosterResetting || !hasSourcePath}
              aria-label={uiText("Video poster policy")}
            >
              <option value="default">{uiText("Generated poster")}</option>
              <option value="auto">{uiText("Auto poster")}</option>
              <option value="manual">{uiText("Current frame poster")}</option>
            </select>
          </label>
          <span className="photos-video-time photos-video-poster-label">{videoPosterLabel}</span>
          <button
            type="button"
            className="secondary compact-action"
            onClick={() => void onSetVideoPoster(item)}
            disabled={videoPosterSaving || !hasSourcePath}
            aria-label={uiText("Use current video frame as poster")}
          >
            <ImageIcon size={14} />
            <span>{videoPosterSaving ? uiText("Saving") : uiText("Set poster")}</span>
          </button>
          {hasVideoPoster && (
            <>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onExportVideoPosterFrame(item)}
                disabled={videoFrameExporting || !hasSourcePath}
                aria-label={uiText("Export saved video poster frame")}
              >
                <Download size={14} />
                <span>{videoFrameExporting ? uiText("Exporting") : uiText("Export poster")}</span>
              </button>
              <button
                type="button"
                className="secondary compact-action"
                onClick={() => void onResetVideoPoster(item)}
                disabled={videoPosterResetting || !hasSourcePath}
                aria-label={uiText("Reset video poster")}
              >
                <RotateCcw size={14} />
                <span>{videoPosterResetting ? uiText("Resetting") : uiText("Reset poster")}</span>
              </button>
            </>
          )}
        </>
      )}
      {error && <small className="photos-video-frame-error">{error}</small>}
        </div>
      </details>
    </div>
  );
}

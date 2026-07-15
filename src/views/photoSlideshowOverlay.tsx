import { type CSSProperties, type RefObject } from "react";
import { ChevronLeft, ChevronRight, Clock, ImageIcon, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX, X } from "lucide-react";
import type { PhotoItem } from "../types";
import type { PhotoSlideshowChapter } from "./photoSlideshow";

type PhotoSlideshowCaptionLayer = {
  id: string;
  text: string;
  placement: string;
  style: CSSProperties;
  typographyClass: string;
  wrapClass: string;
};

type PhotoSlideshowOverlayProps = {
  item: PhotoItem;
  itemIsVideo: boolean;
  label: string;
  summaryLabels: string[];
  playbackTheme: string;
  transitionEffect: string;
  templateLayoutClass: string;
  templateFrameClass: string;
  templateChromeClass: string;
  transitionStyle: CSSProperties;
  playbackMusic: string;
  playbackAudioUrl: string;
  audioRef: RefObject<HTMLAudioElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  motionPreset: string;
  currentKeyframeCurve: string;
  motionStyle: CSSProperties;
  cropStyle: CSSProperties;
  fitMode: string;
  playing: boolean;
  videoMuted: boolean;
  captionLayers: PhotoSlideshowCaptionLayer[];
  itemCount: number;
  chapters: PhotoSlideshowChapter[];
  currentChapter: PhotoSlideshowChapter | null;
  audioMuted: boolean;
  intervalMs: number;
  uiText: (value: string) => string;
  formatCount: (value: number) => string;
  formatDuration: (value: number) => string;
  onClose: () => void;
  onStep: (direction: "previous" | "next") => void;
  onJumpChapter: (chapter: PhotoSlideshowChapter) => void;
  onTogglePlaying: () => void;
  onToggleAudioMuted: () => void;
  onIntervalChange: (value: number) => void;
  onToggleFitMode: () => void;
};

export function PhotoSlideshowOverlay({
  item,
  itemIsVideo,
  label,
  summaryLabels,
  playbackTheme,
  transitionEffect,
  templateLayoutClass,
  templateFrameClass,
  templateChromeClass,
  transitionStyle,
  playbackMusic,
  playbackAudioUrl,
  audioRef,
  stageRef,
  motionPreset,
  currentKeyframeCurve,
  motionStyle,
  cropStyle,
  fitMode,
  playing,
  videoMuted,
  captionLayers,
  itemCount,
  chapters,
  currentChapter,
  audioMuted,
  intervalMs,
  uiText,
  formatCount,
  formatDuration,
  onClose,
  onStep,
  onJumpChapter,
  onTogglePlaying,
  onToggleAudioMuted,
  onIntervalChange,
  onToggleFitMode,
}: PhotoSlideshowOverlayProps) {
  const mediaSourceUrl = item.sourceUrl || item.previewUrl;
  const summary = summaryLabels.filter(Boolean).join(" · ");
  const fillMode = fitMode === "fill";
  const musicDisabled = playbackMusic === "none";

  return (
    <div
      className={`photos-slideshow theme-${playbackTheme} transition-${transitionEffect} ${templateLayoutClass} ${templateFrameClass} ${templateChromeClass}`}
      style={transitionStyle}
      role="dialog"
      aria-modal="true"
      aria-label={`${uiText("Slideshow")}: ${label}`}
      onClick={onClose}
    >
      {playbackMusic === "custom" && playbackAudioUrl && (
        <audio ref={audioRef} src={playbackAudioUrl} loop preload="auto" />
      )}
      <div className="photos-slideshow-topbar" onClick={(event) => event.stopPropagation()}>
        <span>
          <strong>{label}</strong>
          <small>{summary}</small>
        </span>
        <button type="button" className="photos-lightbox-close" onClick={onClose} aria-label={uiText("Close slideshow")}>
          <X size={18} />
        </button>
      </div>
      <div className="photos-slideshow-stage" ref={stageRef} onClick={(event) => event.stopPropagation()}>
        <div
          key={`${item.sourcePath}:${motionPreset}:${currentKeyframeCurve}`}
          className={`photos-slideshow-media-frame motion-${motionPreset}`}
          style={motionStyle}
        >
          {itemIsVideo && mediaSourceUrl ? (
            <video
              className={fillMode ? "photos-slideshow-video fill" : "photos-slideshow-video"}
              src={mediaSourceUrl}
              poster={item.previewUrl || undefined}
              style={cropStyle}
              controls
              autoPlay={playing}
              muted={videoMuted}
            />
          ) : mediaSourceUrl ? (
            <img
              className={fillMode ? "photos-slideshow-image fill" : "photos-slideshow-image"}
              src={mediaSourceUrl}
              alt={label}
              style={cropStyle}
              draggable={false}
            />
          ) : (
            <div className="photos-lightbox-fallback">
              <ImageIcon size={56} />
            </div>
          )}
        </div>
        {captionLayers.map((caption) => (
          <div
            key={caption.id}
            className={`photos-slideshow-caption placement-${caption.placement} ${caption.typographyClass} ${caption.wrapClass}`}
            style={caption.style}
            onClick={(event) => event.stopPropagation()}
          >
            {caption.text}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="photos-lightbox-nav prev"
        onClick={(event) => {
          event.stopPropagation();
          onStep("previous");
        }}
        aria-label={uiText("Previous slide")}
        disabled={itemCount < 2}
      >
        <ChevronLeft size={28} />
      </button>
      <button
        type="button"
        className="photos-lightbox-nav next"
        onClick={(event) => {
          event.stopPropagation();
          onStep("next");
        }}
        aria-label={uiText("Next slide")}
        disabled={itemCount < 2}
      >
        <ChevronRight size={28} />
      </button>
      {chapters.length > 1 && (
        <div className="photos-slideshow-chapters" aria-label={uiText("Memory chapters")} onClick={(event) => event.stopPropagation()}>
          <span className="photos-slideshow-chapter-heading">
            <Clock size={14} />
            <span>{uiText("Chapters")}</span>
            {currentChapter && <small>{formatDuration(currentChapter.startMs) || "0s"}</small>}
          </span>
          <div className="photos-slideshow-chapter-list">
            {chapters.map((chapter, index) => {
              const activeChapter = currentChapter?.id === chapter.id;
              return (
                <button
                  key={`${chapter.id}-${index}`}
                  type="button"
                  className={activeChapter ? "active" : ""}
                  aria-pressed={activeChapter}
                  aria-label={`${uiText("Chapter")} ${formatCount(index + 1)}: ${chapter.label}, ${formatDuration(chapter.startMs) || "0s"}`}
                  onClick={() => onJumpChapter(chapter)}
                >
                  <span>{formatCount(index + 1)}</span>
                  <strong>{chapter.label}</strong>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="photos-slideshow-controls" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="secondary compact-action" onClick={onTogglePlaying}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
          <span>{playing ? uiText("Pause") : uiText("Play")}</span>
        </button>
        <button
          type="button"
          className="secondary compact-action"
          onClick={onToggleAudioMuted}
          disabled={musicDisabled}
        >
          {audioMuted || musicDisabled ? <VolumeX size={14} /> : <Volume2 size={14} />}
          <span>{musicDisabled ? uiText("No music") : audioMuted ? uiText("Unmute music") : uiText("Mute music")}</span>
        </button>
        <label>
          <Clock size={14} />
          <span>{uiText("Delay")}</span>
          <select value={intervalMs} onChange={(event) => onIntervalChange(Number(event.currentTarget.value))}>
            <option value={2500}>{uiText("Fast")}</option>
            <option value={4500}>{uiText("Normal")}</option>
            <option value={7000}>{uiText("Slow")}</option>
          </select>
        </label>
        <button type="button" className="secondary compact-action" onClick={onToggleFitMode}>
          {fitMode === "fit" ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          <span>{fitMode === "fit" ? uiText("Fill") : uiText("Fit")}</span>
        </button>
        <button type="button" className="ghost compact-action" onClick={onClose}>
          <X size={14} />
          <span>{uiText("Close")}</span>
        </button>
      </div>
    </div>
  );
}

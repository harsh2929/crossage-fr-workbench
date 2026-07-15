import { memo, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { formatPhotoDuration as formatDuration } from "./photoDuration";

const PHOTO_VIDEO_TIME_UI_THROTTLE_MS = 250;

export type PhotoVideoRotateDegrees = 0 | 90 | 180 | 270;
export type PhotoVideoCropAspect = "none" | "square" | "landscape" | "portrait";

export type PhotoLightboxVideoControlsProps = {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  durationMs: number;
  paused: boolean;
  muted: boolean;
  isLivePhoto: boolean;
  uiText: (source: string) => string;
  onTogglePlayback: () => void | Promise<void>;
  onToggleMuted: () => void;
  onScrub: (nextMs: number) => void;
};

export function photoVideoCurrentMs(video: HTMLVideoElement | null): number {
  if (!video || !Number.isFinite(video.currentTime) || video.currentTime <= 0) return 0;
  return Math.max(0, Math.round(video.currentTime * 1000));
}

export function photoVideoDurationMs(video: HTMLVideoElement | null): number {
  if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return 0;
  return Math.max(0, Math.round(video.duration * 1000));
}

export const PhotoLightboxVideoControls = memo(function PhotoLightboxVideoControls({
  videoRef,
  sourceKey,
  durationMs,
  paused,
  muted,
  isLivePhoto,
  uiText,
  onTogglePlayback,
  onToggleMuted,
  onScrub,
}: PhotoLightboxVideoControlsProps) {
  const [currentMs, setCurrentMs] = useState(0);
  const currentMsRef = useRef(0);
  const lastUiUpdateAtRef = useRef(0);

  const syncCurrentTime = useCallback((force = false) => {
    const nextMs = photoVideoCurrentMs(videoRef.current);
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    if (!force
      && now - lastUiUpdateAtRef.current < PHOTO_VIDEO_TIME_UI_THROTTLE_MS
      && Math.abs(nextMs - currentMsRef.current) < 1000) {
      return;
    }
    lastUiUpdateAtRef.current = now;
    if (nextMs === currentMsRef.current) return;
    currentMsRef.current = nextMs;
    setCurrentMs(nextMs);
  }, [videoRef]);

  useEffect(() => {
    currentMsRef.current = 0;
    lastUiUpdateAtRef.current = 0;
    setCurrentMs(0);
    syncCurrentTime(true);
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => syncCurrentTime(false);
    const onTimeJump = () => syncCurrentTime(true);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeking", onTimeJump);
    video.addEventListener("seeked", onTimeJump);
    video.addEventListener("loadedmetadata", onTimeJump);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeking", onTimeJump);
      video.removeEventListener("seeked", onTimeJump);
      video.removeEventListener("loadedmetadata", onTimeJump);
    };
  }, [sourceKey, syncCurrentTime, videoRef]);

  const scrubMaxMs = Math.max(durationMs, currentMs, 0);
  const currentLabel = formatDuration(currentMs) || "0s";
  const durationLabel = formatDuration(durationMs) || uiText("Unknown");

  return (
    <>
      <button
        type="button"
        className="secondary compact-action"
        onClick={() => void onTogglePlayback()}
        aria-label={paused ? uiText(isLivePhoto ? "Play Live Photo" : "Play video") : uiText(isLivePhoto ? "Pause Live Photo" : "Pause video")}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
        <span>{paused ? uiText(isLivePhoto ? "Play Live" : "Play") : uiText("Pause")}</span>
      </button>
      <label>
        <span className="photos-video-time">{currentLabel}</span>
        <input
          type="range"
          min={0}
          max={scrubMaxMs}
          step={250}
          value={Math.min(currentMs, scrubMaxMs)}
          onChange={(event) => {
            const nextMs = Number(event.currentTarget.value);
            currentMsRef.current = nextMs;
            lastUiUpdateAtRef.current = typeof performance === "undefined" ? Date.now() : performance.now();
            setCurrentMs(nextMs);
            onScrub(nextMs);
          }}
          disabled={scrubMaxMs <= 0}
          aria-label={uiText("Scrub video")}
        />
        <span className="photos-video-time">{durationLabel}</span>
      </label>
      <button
        type="button"
        className="secondary compact-action"
        onClick={onToggleMuted}
        aria-label={muted ? uiText("Unmute video") : uiText("Mute video")}
      >
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        <span>{muted ? uiText("Unmute") : uiText("Mute")}</span>
      </button>
    </>
  );
});

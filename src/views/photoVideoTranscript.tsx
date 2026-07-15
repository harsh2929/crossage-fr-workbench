import { useEffect, useMemo, useState, type RefObject } from "react";
import { Captions, Clock, Volume2 } from "lucide-react";
import { photoVideoCaptionText, type PhotoAudioTimelineSegment } from "./photoAudioTimeline";
import { formatPhotoDuration as formatDuration } from "./photoDuration";

export { normalizePhotoAudioTimelineSegments, photoVideoCaptionText } from "./photoAudioTimeline";
export type { PhotoAudioTimelineSegment } from "./photoAudioTimeline";

function useVideoTimelineMs(videoRef: RefObject<HTMLVideoElement | null>, sourceKey: string): number {
  const [currentMs, setCurrentMs] = useState(0);
  useEffect(() => {
    setCurrentMs(0);
    const video = videoRef.current;
    if (!video) return undefined;
    const sync = () => {
      const seconds = Number(video.currentTime);
      setCurrentMs(Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0);
    };
    sync();
    for (const eventName of ["timeupdate", "seeking", "seeked", "loadedmetadata"] as const) {
      video.addEventListener(eventName, sync);
    }
    return () => {
      for (const eventName of ["timeupdate", "seeking", "seeked", "loadedmetadata"] as const) {
        video.removeEventListener(eventName, sync);
      }
    };
  }, [sourceKey, videoRef]);
  return currentMs;
}

export function PhotoVideoCaptionCue({
  videoRef,
  sourceKey,
  segments,
  enabled,
  uiText,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  segments: PhotoAudioTimelineSegment[];
  enabled: boolean;
  uiText: (value: string) => string;
}) {
  const currentMs = useVideoTimelineMs(videoRef, sourceKey);
  const cue = useMemo(() => photoVideoCaptionText(segments, currentMs), [currentMs, segments]);
  if (!enabled || !cue) return null;
  return (
    <div className="photos-video-caption-cue" aria-label={`${uiText("Video captions")}: ${cue}`}>
      {cue}
    </div>
  );
}

export function PhotoVideoTranscriptPanel({
  videoRef,
  sourceKey,
  segments,
  loading,
  error,
  uiText,
  onSeek,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  sourceKey: string;
  segments: PhotoAudioTimelineSegment[];
  loading: boolean;
  error: string;
  uiText: (value: string) => string;
  onSeek: (timestampMs: number) => void;
}) {
  const currentMs = useVideoTimelineMs(videoRef, sourceKey);
  const activeCue = useMemo(() => photoVideoCaptionText(segments, currentMs), [currentMs, segments]);
  const transcriptCount = segments.filter((segment) => segment.segmentKind === "speech").length;
  const soundCount = segments.length - transcriptCount;

  return (
    <section className="photo-video-transcript" aria-labelledby="photo-video-transcript-title">
      <header>
        <span className="photo-video-transcript-icon" aria-hidden="true"><Captions size={16} /></span>
        <span>
          <strong id="photo-video-transcript-title">{uiText("Transcript")}</strong>
          <small>{uiText("Generated locally; review for accuracy.")}</small>
        </span>
      </header>
      {loading ? <p role="status">{uiText("Loading transcript...")}</p> : null}
      {!loading && error ? <p role="alert">{error}</p> : null}
      {!loading && !error && !segments.length ? <p>{uiText("No transcript available.")}</p> : null}
      {activeCue ? <p className="photo-video-transcript-current" aria-live="off">{activeCue}</p> : null}
      {segments.length > 0 ? (
        <details>
          <summary tabIndex={0}>
            <span>{uiText("Full transcript")}</span>
            <small>{transcriptCount} {uiText("transcripts")} · {soundCount} {uiText("sound events")}</small>
          </summary>
          <div className="photo-video-transcript-list" role="list" aria-label={uiText("Full transcript")}>
            {segments.map((segment) => {
              const active = currentMs >= segment.startMs && currentMs < segment.endMs;
              const content = segment.segmentKind === "speech" ? segment.text : segment.label || segment.text;
              const timestamp = formatDuration(segment.startMs) || "0s";
              return (
                <div role="listitem" key={segment.segmentId}>
                  <button
                    type="button"
                    className={active ? "active" : ""}
                    aria-label={`${uiText("Seek to")} ${timestamp}: ${content}`}
                    onClick={() => onSeek(segment.startMs)}
                  >
                    <span className="photo-video-transcript-time"><Clock size={12} aria-hidden="true" />{timestamp}</span>
                    <span>{segment.segmentKind === "sound" ? <Volume2 size={13} aria-hidden="true" /> : null}{content}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </section>
  );
}

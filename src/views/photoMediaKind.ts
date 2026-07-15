import type { PhotoItem } from "../types";

export interface PhotoMediaSourcePathPayload extends Record<string, unknown> {
  sourcePath: string;
}

export interface PhotoMediaTimestampPayload extends PhotoMediaSourcePathPayload {
  timestampMs: number;
}

export interface PhotoVideoPosterPayload extends PhotoMediaSourcePathPayload {
  timestampMs?: number;
  policy?: "auto";
}

function cleanMediaSourcePath(value: unknown): string {
  return String(value || "").trim();
}

function cleanMediaTimestampMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function isVideoMediaKind(value: unknown): boolean {
  const kind = String(value || "").toLowerCase();
  return kind === "video" || kind === "screen_recording" || kind === "time_lapse";
}

export function isLivePhotoMediaKind(value: unknown): boolean {
  return String(value || "").toLowerCase() === "live_photo";
}

export function photoLivePhotoMetadata(item: PhotoItem | null | undefined): Record<string, unknown> {
  const metadata = item?.assetMetadata || {};
  const livePhoto = metadata && typeof metadata.livePhoto === "object" && !Array.isArray(metadata.livePhoto)
    ? metadata.livePhoto as Record<string, unknown>
    : {};
  return livePhoto;
}

export function photoLiveMotionPath(item: PhotoItem | null | undefined): string {
  return String(photoLivePhotoMetadata(item).pairedVideoPath || "");
}

export function photoLiveMotionUrl(item: PhotoItem | null | undefined): string {
  return String(photoLivePhotoMetadata(item).pairedVideoUrl || "");
}

export function photoLiveKeyPhotoActive(item: PhotoItem | null | undefined): boolean {
  return Boolean(photoLivePhotoMetadata(item).keyPhotoPreviewPath);
}

export function photoVideoPosterPayload(input: {
  sourcePath?: unknown;
  timestampMs?: unknown;
  policy?: unknown;
} = {}): PhotoVideoPosterPayload {
  if (input.policy === "auto") {
    return {
      sourcePath: cleanMediaSourcePath(input.sourcePath),
      policy: "auto",
    };
  }
  return {
    sourcePath: cleanMediaSourcePath(input.sourcePath),
    timestampMs: cleanMediaTimestampMs(input.timestampMs),
  };
}

export function photoVideoPosterResetPayload(input: { sourcePath?: unknown } = {}): PhotoMediaSourcePathPayload {
  return {
    sourcePath: cleanMediaSourcePath(input.sourcePath),
  };
}

export function photoLiveKeyPhotoPayload(input: {
  sourcePath?: unknown;
  timestampMs?: unknown;
} = {}): PhotoMediaTimestampPayload {
  return {
    sourcePath: cleanMediaSourcePath(input.sourcePath),
    timestampMs: cleanMediaTimestampMs(input.timestampMs),
  };
}

export function photoLiveKeyPhotoResetPayload(input: { sourcePath?: unknown } = {}): PhotoMediaSourcePathPayload {
  return {
    sourcePath: cleanMediaSourcePath(input.sourcePath),
  };
}

export type PhotoThumbnailAspectMode = "square" | "aspect";

export const PHOTO_THUMBNAIL_MIN_SIZE = 96;
export const PHOTO_THUMBNAIL_MAX_SIZE = 224;
export const PHOTO_THUMBNAIL_STEP = 8;
export const DEFAULT_PHOTO_THUMBNAIL_SIZE = 144;

export function clampPhotoThumbnailSize(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PHOTO_THUMBNAIL_SIZE;
  const stepped = Math.round(parsed / PHOTO_THUMBNAIL_STEP) * PHOTO_THUMBNAIL_STEP;
  return Math.min(PHOTO_THUMBNAIL_MAX_SIZE, Math.max(PHOTO_THUMBNAIL_MIN_SIZE, stepped));
}

export function photoThumbnailAspectRatio(item: { width?: unknown; height?: unknown }): string {
  const width = Number(item.width);
  const height = Number(item.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "1 / 1";
  }
  const ratio = Math.min(2, Math.max(0.667, width / height));
  const rounded = Math.round(ratio * 1000) / 1000;
  return `${rounded} / 1`;
}

import type { PhotoItem } from "../types";

export const PHOTO_COLOR_LABELS = ["", "red", "yellow", "green", "blue", "purple"] as const;

export type PhotoColorLabel = (typeof PHOTO_COLOR_LABELS)[number];
export type PhotoPickStatus = "" | "pick" | "reject";
export type PhotoProCurationPatch = Partial<Pick<PhotoItem, "rating" | "colorLabel" | "pickStatus">>;

export interface PhotoProCurationAggregate {
  rating: number | null;
  colorLabel: PhotoColorLabel | null;
  pickStatus: PhotoPickStatus | null;
}

function commonValue<T>(values: readonly T[]): T | null {
  if (!values.length) return null;
  return values.every((value) => value === values[0]) ? values[0] : null;
}

export function normalizePhotoRating(value: unknown): number {
  const rating = Number(value);
  return Number.isInteger(rating) ? Math.max(0, Math.min(5, rating)) : 0;
}

export function normalizePhotoColorLabel(value: unknown): PhotoColorLabel {
  const label = String(value || "").trim().toLowerCase();
  return PHOTO_COLOR_LABELS.includes(label as PhotoColorLabel) ? label as PhotoColorLabel : "";
}

export function normalizePhotoPickStatus(value: unknown): PhotoPickStatus {
  const status = String(value || "").trim().toLowerCase();
  return status === "pick" || status === "reject" ? status : "";
}

export function photoProCurationAggregate(items: readonly PhotoItem[]): PhotoProCurationAggregate {
  return {
    rating: commonValue(items.map((item) => normalizePhotoRating(item.rating))),
    colorLabel: commonValue(items.map((item) => normalizePhotoColorLabel(item.colorLabel))),
    pickStatus: commonValue(items.map((item) => normalizePhotoPickStatus(item.pickStatus))),
  };
}

export function photoProCurationUpdates(items: readonly PhotoItem[], patch: PhotoProCurationPatch): Array<Record<string, unknown>> {
  return items.map((item) => ({
    sourcePath: item.sourcePath,
    assetId: item.assetId || "",
    ...patch,
  }));
}

function interpolatePhotoProCurationLabel(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/gi, (placeholder, key: string) => values[key] ?? placeholder);
}

export function localizedPhotoProCurationLabel(
  patch: PhotoProCurationPatch,
  count: number,
  uiText: (value: string) => string,
  formatCount: (value: number) => string = String,
): string {
  const rating = normalizePhotoRating(patch.rating);
  const colorLabel = normalizePhotoColorLabel(patch.colorLabel);
  const pickStatus = normalizePhotoPickStatus(patch.pickStatus);
  const values = {
    count: formatCount(count),
    photos: uiText(count === 1 ? "photo" : "photos"),
    rating: formatCount(rating),
    stars: uiText(rating === 1 ? "star" : "stars"),
    label: uiText(colorLabel),
  };
  let template: string;
  if (patch.rating !== undefined) template = uiText("Rated {count} {photos} {rating} {stars}");
  else if (patch.colorLabel !== undefined) {
    template = colorLabel
      ? uiText("Labeled {count} {photos} {label}")
      : uiText("Cleared color label for {count} {photos}");
  } else if (pickStatus === "pick") template = uiText("Marked {count} {photos} as picks");
  else if (pickStatus === "reject") template = uiText("Marked {count} {photos} as rejects");
  else template = uiText("Cleared flags for {count} {photos}");
  return interpolatePhotoProCurationLabel(template, values);
}

export function photoProCurationLabel(patch: PhotoProCurationPatch, count: number): string {
  return localizedPhotoProCurationLabel(patch, count, (value) => value);
}

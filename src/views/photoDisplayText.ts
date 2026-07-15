import type { PhotoItem } from "../types";

export const identityPhotoUiText = (source: string) => source;

export function photoFileName(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).filter(Boolean).pop() || sourcePath;
}

export function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function shortText(value: string): string {
  if (!value) return "";
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let next = value;
  let unit = 0;
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024;
    unit += 1;
  }
  return `${next >= 10 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`;
}

export function formatDimensions(item: PhotoItem): string {
  const width = numberFromUnknown(item.width);
  const height = numberFromUnknown(item.height);
  return width && height ? `${width} x ${height}` : "";
}

export function formatDateText(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleString();
}

export function photoEventMetadataString(metadata: Record<string, unknown> | undefined, key: string): string {
  const value = metadata?.[key];
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return "";
}

export function photoEventPathName(value: unknown): string {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/[\\/]/).filter(Boolean).pop() || text;
}

export function photoEventActionLabel(item: PhotoItem): string {
  const metadata = item.eventMetadata || {};
  const action = photoEventMetadataString(metadata, "action");
  if (item.eventType === "viewed") return "Viewed";
  if (item.eventType !== "shared") return "Activity";
  const labels: Record<string, string> = {
    export: "Exported",
    copy: "Copied",
    move: "Moved",
    native_share: "Shared",
    native_share_strip_location: "Shared without location",
    share_fallback_reveal: "Share folder opened",
    share_fallback_reveal_strip_location: "Share folder opened without location",
    open_with_external_editor: "Opened with editor",
    open_with_last_external_editor: "Opened with editor",
    export_photo_selection: "Exported",
    copy_photo_selection: "Copied",
    move_photo_selection: "Moved",
    export_photo_contact_sheet: "Exported contact sheet",
    export_photo_video_frame: "Exported video frame",
    export_photo_video_trim: "Exported video trim",
    export_photo_live_motion: "Exported Live Photo motion",
    export_photo_subject_cutout: "Exported subject cutout",
    export_photo_slideshow: "Exported slideshow",
    export_photo_memory_movie: "Exported memory movie",
  };
  return labels[action] || "Shared";
}

export function photoEventContextLabel(item: PhotoItem): string {
  const metadata = item.eventMetadata || {};
  const title = photoEventMetadataString(metadata, "title") || photoEventMetadataString(metadata, "memoryName") || photoEventMetadataString(metadata, "themeTemplateName");
  if (title) return title;
  const target = photoEventPathName(metadata.targetPath);
  if (target) return target;
  const bundle = photoEventPathName(metadata.bundlePath);
  if (bundle) return bundle;
  const surface = photoEventMetadataString(metadata, "surface").replace(/^photos-/, "").replace(/[-_]+/g, " ");
  if (surface) return surface;
  return String(item.eventActor || "").trim();
}

export function photoEventActivityTitle(item: PhotoItem): string {
  const metadata = item.eventMetadata || {};
  return [
    photoEventActionLabel(item),
    formatDateText(item.eventAt),
    item.eventActor ? `Actor: ${item.eventActor}` : "",
    photoEventMetadataString(metadata, "action") ? `Action: ${photoEventMetadataString(metadata, "action")}` : "",
    photoEventMetadataString(metadata, "surface") ? `Surface: ${photoEventMetadataString(metadata, "surface")}` : "",
    photoEventMetadataString(metadata, "bundlePath") ? `Bundle: ${photoEventMetadataString(metadata, "bundlePath")}` : "",
    photoEventMetadataString(metadata, "targetPath") ? `Target: ${photoEventMetadataString(metadata, "targetPath")}` : "",
  ].filter(Boolean).join(" · ");
}

export function photoEventActivityText(item: PhotoItem): string {
  const parts = [
    photoEventActionLabel(item),
    formatDateText(item.eventAt),
    photoEventContextLabel(item),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function formatLocation(item: PhotoItem): string {
  if (item.locationHidden) return "Hidden";
  const location = item.locationOverride || {};
  const label = String(location.label || "").trim();
  const latitude = String(location.latitude || "").trim();
  const longitude = String(location.longitude || "").trim();
  if (label && latitude && longitude) return `${label} (${latitude}, ${longitude})`;
  if (label) return label;
  if (latitude && longitude) return `${latitude}, ${longitude}`;
  const exif = (item.assetMetadata?.exif || {}) as Record<string, unknown>;
  const gps = (exif.gps || {}) as Record<string, unknown>;
  const exifLatitude = String(gps.latitude || "").trim();
  const exifLongitude = String(gps.longitude || "").trim();
  return exifLatitude && exifLongitude ? `${exifLatitude}, ${exifLongitude}` : "";
}

export function dateGroup(item: PhotoItem): { key: string; label: string } {
  const source = item.captureDate || item.scanDate || item.createdAt || "";
  const date = source.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { key: "unknown", label: "Unknown date" };
  return { key: date.slice(0, 7), label: date.slice(0, 7) };
}

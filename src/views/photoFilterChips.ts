export type PhotoFilterChipKind = "search" | "keyword" | "mediaKind" | "favorite" | "edited" | "notInAlbum" | "person" | "status" | "minQuality" | "dateFrom" | "dateTo" | "source" | "fileType" | "duplicate" | "location" | "nearby" | "camera" | "album" | "visibility";

export interface PhotoFilterChip {
  kind: PhotoFilterChipKind;
  label: string;
}

export interface PhotoFilterChipInput {
  searchQuery?: unknown;
  keyword?: unknown;
  mediaKind?: unknown;
  favoriteOnly?: boolean;
  editedOnly?: boolean;
  notInAlbumOnly?: boolean;
  person?: unknown;
  status?: unknown;
  minQuality?: unknown;
  dateFrom?: unknown;
  dateTo?: unknown;
  source?: unknown;
  fileType?: unknown;
  duplicateOnly?: boolean;
  location?: unknown;
  nearbyLabel?: unknown;
  camera?: unknown;
  album?: unknown;
  albumLabel?: unknown;
  visibility?: unknown;
}

export function buildPhotoFilterChips(input: PhotoFilterChipInput): PhotoFilterChip[] {
  const chips: PhotoFilterChip[] = [];
  const search = String(input.searchQuery || "").trim();
  const keyword = String(input.keyword || "").trim();
  const mediaKind = String(input.mediaKind || "").trim();
  if (search) chips.push({ kind: "search", label: `Search: ${search}` });
  if (keyword) chips.push({ kind: "keyword", label: `Keyword: ${keyword}` });
  if (mediaKind) chips.push({ kind: "mediaKind", label: `Media: ${mediaKindLabel(mediaKind)}` });
  if (input.favoriteOnly) chips.push({ kind: "favorite", label: "Favorites" });
  if (input.editedOnly) chips.push({ kind: "edited", label: "Edited" });
  if (input.notInAlbumOnly) chips.push({ kind: "notInAlbum", label: "Not in Album" });
  const person = String(input.person || "").trim();
  const status = String(input.status || "").trim();
  const minQuality = Number(input.minQuality || 0);
  const dateFrom = String(input.dateFrom || "").trim();
  const dateTo = String(input.dateTo || "").trim();
  const source = String(input.source || "").trim();
  const fileType = String(input.fileType || "").trim();
  const location = String(input.location || "").trim();
  const nearbyLabel = String(input.nearbyLabel || "").trim();
  const camera = String(input.camera || "").trim();
  const album = String(input.album || "").trim();
  const albumLabel = String(input.albumLabel || album).trim();
  const visibility = String(input.visibility || "").trim();
  if (person) chips.push({ kind: "person", label: `Person: ${person}` });
  if (status) chips.push({ kind: "status", label: `Status: ${statusLabel(status)}` });
  if (Number.isFinite(minQuality) && minQuality > 0) chips.push({ kind: "minQuality", label: `Quality >= ${Math.round(Math.max(0, Math.min(1, minQuality)) * 100)}%` });
  if (dateFrom) chips.push({ kind: "dateFrom", label: `From: ${dateFrom}` });
  if (dateTo) chips.push({ kind: "dateTo", label: `Through: ${dateTo}` });
  if (source) chips.push({ kind: "source", label: `Source: ${source}` });
  if (fileType) chips.push({ kind: "fileType", label: `File: ${fileType.toUpperCase()}` });
  if (input.duplicateOnly) chips.push({ kind: "duplicate", label: "Duplicates" });
  if (location) chips.push({ kind: "location", label: `Location: ${location}` });
  if (nearbyLabel) chips.push({ kind: "nearby", label: `Nearby: ${nearbyLabel}` });
  if (camera) chips.push({ kind: "camera", label: `Camera: ${camera}` });
  if (album) chips.push({ kind: "album", label: `Album: ${albumLabel || album}` });
  if (visibility && visibility !== "visible") chips.push({ kind: "visibility", label: visibilityLabel(visibility) });
  return chips;
}

function mediaKindLabel(value: string): string {
  switch (value) {
    case "image":
      return "Images";
    case "video":
      return "Videos";
    case "raw":
      return "RAW";
    case "live_photo":
      return "Live Photos";
    case "panorama":
      return "Panoramas";
    case "portrait":
      return "Portraits";
    case "burst":
      return "Bursts";
    case "time_lapse":
      return "Time-lapse";
    case "other":
      return "Other";
    default:
      return value;
  }
}

function statusLabel(value: string): string {
  switch (value) {
    case "pending":
      return "Pending";
    case "accepted":
      return "Accepted";
    case "uncertain":
      return "Not sure";
    case "rejected":
      return "Rejected";
    default:
      return value;
  }
}

function visibilityLabel(value: string): string {
  switch (value) {
    case "all":
      return "All visibility";
    case "hidden":
      return "Hidden";
    case "deleted":
      return "Recently Deleted";
    default:
      return value;
  }
}

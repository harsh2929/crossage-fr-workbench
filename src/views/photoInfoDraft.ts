import type { PhotoItem } from "../types";
import { applyPhotoTimezoneCorrection, composePhotoDateTimeOverride, normalizePhotoDateTimeOverride, shiftPhotoDateByDays, splitPhotoDateTimeOverride, type PhotoDateTimeDraft } from "./photoDateAdjustments";
import { buildPhotoDescriptionRegions, photoDescriptionRegionsEquivalent, serializePhotoDescriptionRegions } from "./photoDescriptionRegions";
import { photoLocalDepthControlsEqual, photoLocalDepthControlsFromItem, photoLocalDepthControlsPayload, type PhotoLocalDepthControls, type PhotoLocalDepthMode, type PhotoXmpMetadataConflict } from "./photoInfoMetadata";
import { keywordsEqual, parseKeywordsDraft } from "./photoKeywordFilters";

const ACCESSIBLE_DESCRIPTION_KEYS = ["accessibilityDescription", "accessibleDescription", "altText", "imageDescription", "markupDescription"] as const;

export type PhotoMetadataPatch = Partial<Pick<PhotoItem, "title" | "caption" | "keywords" | "favorite" | "rating" | "colorLabel" | "pickStatus" | "hidden" | "deletedAt" | "dateOverride" | "locationOverride" | "locationHidden">> & {
  accessibilityDescription?: string;
  captureDate?: string;
  descriptionRegions?: Array<Record<string, unknown>>;
  objectTagReview?: Record<string, unknown>;
  utilityClassifierReview?: Record<string, unknown>;
  localDepthControls?: Record<string, unknown> | null;
};

export interface PhotoMetadataUpdatePayload extends Record<string, unknown> {
  sourcePath: string;
  assetId: string;
}

export interface PhotoInfoLocationDraft {
  label: string;
  latitude: string;
  longitude: string;
  hidden: boolean;
}

export interface PhotoInfoDateDrafts {
  original: PhotoDateTimeDraft;
  dateOverride: PhotoDateTimeDraft;
}

export interface PhotoInfoMetadataPatchDraft {
  title: string;
  caption: string;
  accessibilityDescription: string;
  descriptionRegions: unknown;
  keywords: string;
  dateOverride: string;
  location: PhotoInfoLocationDraft;
  localDepthControls: PhotoLocalDepthControls;
  captureDate?: string;
}

export interface PhotoInfoBulkDateUpdateDraft {
  updates: PhotoMetadataUpdatePayload[];
  nextBySource: Map<string, Partial<PhotoItem>>;
}

export interface PhotoInfoKeywordShortcutUpdateDraft {
  removeKeyword: boolean;
  updates: PhotoMetadataUpdatePayload[];
  nextBySource: Map<string, string[]>;
}

export interface PhotoInfoFavoriteBatchUpdateDraft {
  favorite: boolean;
  updates: PhotoMetadataUpdatePayload[];
}

export type PhotoInfoVisibilityAction = "hide" | "unhide" | "delete" | "restore";

export interface PhotoInfoVisibilityOperationPayload extends Record<string, unknown> {
  action: PhotoInfoVisibilityAction;
  sourcePaths: string[];
  deletedAt?: string;
}

export interface PhotoInfoPermanentDeletePayload extends Record<string, unknown> {
  sourcePaths: string[];
}

export interface PhotoInfoRetentionDeleteDraft {
  days: number;
  payload: {
    olderThanDays: number;
  };
}

function cleanPhotoMetadataTargetText(value: unknown): string {
  return String(value || "").trim();
}

function photoInfoObjectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function photoInfoOptionalObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function photoXmpConflictCleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function photoMetadataUpdatePayload(
  item: Pick<PhotoItem, "sourcePath" | "assetId"> | null | undefined,
  patch: PhotoMetadataPatch | Record<string, unknown> = {},
): PhotoMetadataUpdatePayload {
  return {
    sourcePath: cleanPhotoMetadataTargetText(item?.sourcePath),
    assetId: cleanPhotoMetadataTargetText(item?.assetId),
    ...patch,
  };
}

export function photoInfoVisibilityOperationPayload(
  action: PhotoInfoVisibilityAction,
  sourcePaths: readonly unknown[],
  deletedAt = "",
): PhotoInfoVisibilityOperationPayload | null {
  const paths = sourcePaths.map((path) => String(path || "").trim()).filter(Boolean);
  if (!paths.length) return null;
  return {
    action,
    sourcePaths: paths,
    ...(action === "delete" ? { deletedAt: String(deletedAt || "").trim() } : {}),
  };
}

export function photoInfoPermanentDeletePayload(sourcePaths: readonly unknown[]): PhotoInfoPermanentDeletePayload | null {
  const paths = sourcePaths.map((path) => String(path || "").trim()).filter(Boolean);
  return paths.length ? { sourcePaths: paths } : null;
}

export function photoInfoRetentionDeleteDraft(value: unknown): PhotoInfoRetentionDeleteDraft {
  const days = Math.max(1, Math.min(3650, Math.round(Number(value) || 30)));
  return {
    days,
    payload: { olderThanDays: days },
  };
}

function photoInfoReviewMetadataPatch(
  valueAssetMetadata: Record<string, unknown>,
  patch: PhotoMetadataPatch,
  key: "objectTagReview" | "utilityClassifierReview",
): Record<string, unknown> | null {
  const review = photoInfoOptionalObjectRecord(valueAssetMetadata[key])
    ? photoInfoObjectRecord(valueAssetMetadata[key])
    : photoInfoObjectRecord(patch[key]);
  const entries = Array.isArray(review.entries) ? review.entries : [];
  return entries.length ? review : null;
}

export function photoInfoSavedMetadataPatch(
  item: PhotoItem,
  patch: PhotoMetadataPatch,
  rawValue: unknown,
): Partial<PhotoItem> {
  const value = photoInfoObjectRecord(rawValue);
  const valueAssetMetadata = photoInfoObjectRecord(value.assetMetadata);
  const nextAssetMetadata: Record<string, unknown> = {
    ...(item.assetMetadata || {}),
    ...valueAssetMetadata,
  };
  if ("accessibilityDescription" in patch) {
    const description = String(value.accessibilityDescription ?? patch.accessibilityDescription ?? "").replace(/\s+/g, " ").trim();
    if (description) {
      nextAssetMetadata.accessibilityDescription = description;
    } else {
      delete nextAssetMetadata.accessibilityDescription;
    }
  }
  if ("descriptionRegions" in patch) {
    const regions = serializePhotoDescriptionRegions(value.descriptionRegions ?? patch.descriptionRegions ?? []);
    if (regions.length) {
      nextAssetMetadata.descriptionRegions = regions;
    } else {
      delete nextAssetMetadata.descriptionRegions;
    }
  }
  if ("objectTagReview" in patch) {
    const review = photoInfoReviewMetadataPatch(valueAssetMetadata, patch, "objectTagReview");
    if (review) {
      nextAssetMetadata.objectTagReview = review;
    } else {
      delete nextAssetMetadata.objectTagReview;
    }
  }
  if ("utilityClassifierReview" in patch) {
    const review = photoInfoReviewMetadataPatch(valueAssetMetadata, patch, "utilityClassifierReview");
    if (review) {
      nextAssetMetadata.utilityClassifierReview = review;
    } else {
      delete nextAssetMetadata.utilityClassifierReview;
    }
  }
  if ("localDepthControls" in patch) {
    const controls = photoInfoOptionalObjectRecord(valueAssetMetadata.localDepthControls)
      ? photoInfoObjectRecord(valueAssetMetadata.localDepthControls)
      : photoInfoObjectRecord(patch.localDepthControls);
    if (Object.keys(controls).length) {
      nextAssetMetadata.localDepthControls = controls;
    } else {
      delete nextAssetMetadata.localDepthControls;
    }
  }
  const nextPatch: Partial<PhotoItem> = {
    assetId: String(value.assetId || item.assetId || ""),
    title: String(value.title ?? patch.title ?? item.title ?? ""),
    caption: String(value.caption ?? patch.caption ?? item.caption ?? ""),
    keywords: Array.isArray(value.keywords)
      ? value.keywords.map((keyword) => String(keyword)).filter(Boolean)
      : patch.keywords ?? item.keywords ?? [],
    favorite: Boolean(value.favorite ?? patch.favorite ?? item.favorite ?? false),
    hidden: Boolean(value.hidden ?? patch.hidden ?? item.hidden ?? false),
    deletedAt: String(value.deletedAt ?? patch.deletedAt ?? item.deletedAt ?? ""),
    dateOverride: String(value.dateOverride ?? patch.dateOverride ?? item.dateOverride ?? ""),
    locationOverride: photoInfoOptionalObjectRecord(value.locationOverride)
      ? photoInfoObjectRecord(value.locationOverride)
      : patch.locationOverride ?? item.locationOverride ?? {},
    locationHidden: Boolean(value.locationHidden ?? patch.locationHidden ?? item.locationHidden ?? false),
    assetMetadata: nextAssetMetadata,
  };
  if ("captureDate" in patch) {
    const originalCaptureDate = String(value.captureDate ?? patch.captureDate ?? item.originalCaptureDate ?? "");
    nextPatch.originalCaptureDate = originalCaptureDate;
    if (!nextPatch.dateOverride) nextPatch.captureDate = originalCaptureDate;
  }
  if ("dateOverride" in patch) {
    const mergedItem = {
      ...item,
      originalCaptureDate: String(nextPatch.originalCaptureDate ?? item.originalCaptureDate ?? ""),
    };
    nextPatch.captureDate = restoredPhotoCaptureDate(mergedItem, nextPatch.dateOverride || "");
  }
  return nextPatch;
}

export function photoInfoFavoriteBatchUpdates(
  items: readonly Pick<PhotoItem, "sourcePath" | "assetId" | "favorite">[],
): PhotoInfoFavoriteBatchUpdateDraft {
  const favorite = items.some((item) => !item.favorite);
  return {
    favorite,
    updates: items.map((item) => photoMetadataUpdatePayload(item, { favorite })),
  };
}

export function photoInfoApplyFavoriteBatchResult(
  items: readonly PhotoItem[],
  selectedItems: readonly Pick<PhotoItem, "sourcePath">[],
  rawValue: unknown,
  fallbackFavorite: boolean,
): PhotoItem[] {
  const selectedSourceSet = new Set(selectedItems.map((item) => item.sourcePath));
  if (!selectedSourceSet.size) return [...items];
  const value = photoInfoObjectRecord(rawValue);
  const resultItems = Array.isArray(value.items) ? value.items : [];
  const favoriteBySource = new Map<string, boolean>();
  resultItems.forEach((item) => {
    const record = photoInfoObjectRecord(item);
    const sourcePath = String(record.sourcePath || "").trim();
    if (!sourcePath) return;
    favoriteBySource.set(sourcePath, Boolean(record.favorite ?? fallbackFavorite));
  });
  return items.map((item) => (
    selectedSourceSet.has(item.sourcePath)
      ? { ...item, favorite: favoriteBySource.get(item.sourcePath) ?? fallbackFavorite }
      : item
  ));
}

export function photoInfoKeywordBulkUpdates(
  items: readonly PhotoItem[],
  draftKeywords: unknown,
  action: "add" | "remove",
): PhotoMetadataUpdatePayload[] {
  const keywords = parseKeywordsDraft(draftKeywords);
  if (!items.length || !keywords.length) return [];
  const removeKeys = new Set(keywords.map((keyword) => keyword.toLocaleLowerCase()));
  return items.map((item) => {
    const current = parseKeywordsDraft(item.keywords || []);
    const nextKeywords = action === "remove"
      ? current.filter((keyword) => !removeKeys.has(keyword.toLocaleLowerCase()))
      : parseKeywordsDraft([...current, ...keywords]);
    return photoMetadataUpdatePayload(item, { keywords: nextKeywords });
  });
}

export function photoInfoKeywordShortcutUpdates(
  items: readonly PhotoItem[],
  keyword: unknown,
): PhotoInfoKeywordShortcutUpdateDraft {
  const keywordName = String(keyword || "").trim();
  const nextBySource = new Map<string, string[]>();
  const updates: PhotoMetadataUpdatePayload[] = [];
  if (!items.length || !keywordName) return { removeKeyword: false, updates, nextBySource };
  const keywordKey = keywordName.toLocaleLowerCase();
  const removeKeyword = items.every((item) => (
    parseKeywordsDraft(item.keywords || []).some((itemKeyword) => itemKeyword.toLocaleLowerCase() === keywordKey)
  ));
  for (const item of items) {
    const current = parseKeywordsDraft(item.keywords || []);
    const nextKeywords = removeKeyword
      ? current.filter((itemKeyword) => itemKeyword.toLocaleLowerCase() !== keywordKey)
      : parseKeywordsDraft([...current, keywordName]);
    nextBySource.set(item.sourcePath, nextKeywords);
    updates.push(photoMetadataUpdatePayload(item, { keywords: nextKeywords }));
  }
  return { removeKeyword, updates, nextBySource };
}

function photoInfoBulkDateSource(item: PhotoItem): string {
  return item.dateOverride || item.captureDate || item.originalCaptureDate || item.addedAt || item.scanDate || item.createdAt || "";
}

function photoInfoBulkDateUpdateDraft(
  items: readonly PhotoItem[],
  nextDateForItem: (item: PhotoItem) => string,
): PhotoInfoBulkDateUpdateDraft {
  const nextBySource = new Map<string, Partial<PhotoItem>>();
  const updates: PhotoMetadataUpdatePayload[] = [];
  for (const item of items) {
    const nextDate = nextDateForItem(item);
    if (!nextDate) continue;
    nextBySource.set(item.sourcePath, {
      dateOverride: nextDate,
      captureDate: restoredPhotoCaptureDate(item, nextDate),
    });
    updates.push(photoMetadataUpdatePayload(item, { dateOverride: nextDate }));
  }
  return { updates, nextBySource };
}

export function photoInfoDateOffsetBulkUpdates(
  items: readonly PhotoItem[],
  days: number,
): PhotoInfoBulkDateUpdateDraft {
  if (!items.length || !days) return { updates: [], nextBySource: new Map() };
  return photoInfoBulkDateUpdateDraft(items, (item) => shiftPhotoDateByDays(photoInfoBulkDateSource(item), days));
}

export function photoInfoTimezoneBulkUpdates(
  items: readonly PhotoItem[],
  timezone: string,
): PhotoInfoBulkDateUpdateDraft {
  if (!items.length || !timezone) return { updates: [], nextBySource: new Map() };
  return photoInfoBulkDateUpdateDraft(items, (item) => applyPhotoTimezoneCorrection(photoInfoBulkDateSource(item), timezone));
}

export function photoInfoMetadataPatchFromDraft(draft: PhotoInfoMetadataPatchDraft): PhotoMetadataPatch {
  const patch: PhotoMetadataPatch = {
    title: draft.title,
    caption: draft.caption,
    accessibilityDescription: draft.accessibilityDescription,
    descriptionRegions: serializePhotoDescriptionRegions(draft.descriptionRegions),
    keywords: parseKeywordsDraft(draft.keywords),
    dateOverride: draft.dateOverride,
    locationOverride: photoInfoLocationOverrideFromDraft(draft.location),
    locationHidden: draft.location.hidden,
    localDepthControls: photoLocalDepthControlsPayload(draft.localDepthControls),
  };
  if (draft.captureDate !== undefined) patch.captureDate = draft.captureDate;
  return patch;
}

export function photoAccessibleDescription(item: PhotoItem): string {
  const metadata = item.assetMetadata || {};
  const values: string[] = [];
  ACCESSIBLE_DESCRIPTION_KEYS.forEach((key) => {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      values.push(value.trim());
    } else if (Array.isArray(value)) {
      values.push(...value.map((itemValue) => String(itemValue || "").trim()).filter(Boolean));
    }
  });
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(" ");
}

export function photoEditableAccessibleDescription(item: PhotoItem | null | undefined): string {
  const metadata = item?.assetMetadata || {};
  for (const key of ACCESSIBLE_DESCRIPTION_KEYS) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.map((itemValue) => String(itemValue || "").trim()).find(Boolean);
      if (first) return first;
    }
  }
  return "";
}

export function photoMetadataTextValues(value: unknown, depth = 0): string[] {
  if (depth > 5) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = String(value || "").trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => photoMetadataTextValues(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directValues = ["label", "name", "text", "value", "title", "description", "category", "kind", "type"]
      .flatMap((key) => photoMetadataTextValues(record[key], depth + 1));
    if (directValues.length) return directValues;
    return Object.entries(record).flatMap(([key, entry]) => {
      const keyText = String(key || "").trim();
      if (keyText && (typeof entry === "number" || typeof entry === "boolean")) {
        return ["confidence", "score", "probability", "bbox", "bounds", "x", "y", "width", "height"].includes(keyText.toLocaleLowerCase())
          ? []
          : [keyText];
      }
      return photoMetadataTextValues(entry, depth + 1);
    });
  }
  return [];
}

export function photoMetadataJoinedValues(item: PhotoItem, keys: string[], limit = 12): string {
  const metadata = item.assetMetadata || {};
  const seen = new Set<string>();
  const values: string[] = [];
  keys.forEach((key) => {
    photoMetadataTextValues(metadata[key]).forEach((value) => {
      const clean = value.replace(/\s+/g, " ").trim();
      const normalized = clean.toLocaleLowerCase();
      if (!clean || seen.has(normalized)) return;
      seen.add(normalized);
      values.push(clean);
    });
  });
  return values.slice(0, limit).join(", ");
}

export function photoDetectedText(item: PhotoItem): string {
  return photoMetadataJoinedValues(item, ["ocrText", "liveText", "detectedText", "textRegions", "ocrBlocks", "textBlocks"], 8);
}

export function hasPhotoLocationOverride(item: PhotoItem): boolean {
  const location = item.locationOverride || {};
  return Boolean(
    String(location.label || "").trim()
    || String(location.latitude || "").trim()
    || String(location.longitude || "").trim()
  );
}

export function emptyPhotoInfoLocationDraft(): PhotoInfoLocationDraft {
  return {
    label: "",
    latitude: "",
    longitude: "",
    hidden: false,
  };
}

export function photoInfoLocationDraftFromItem(
  item: Partial<Pick<PhotoItem, "locationOverride" | "locationHidden">> | null | undefined
): PhotoInfoLocationDraft {
  const location = item?.locationOverride && typeof item.locationOverride === "object" ? item.locationOverride : {};
  return {
    label: String(location.label ?? ""),
    latitude: String(location.latitude ?? ""),
    longitude: String(location.longitude ?? ""),
    hidden: Boolean(item?.locationHidden),
  };
}

export function photoInfoLocationOverrideFromDraft(draft: PhotoInfoLocationDraft): Record<string, unknown> {
  const locationOverride: Record<string, unknown> = {};
  const label = draft.label.trim();
  const latitude = draft.latitude.trim();
  const longitude = draft.longitude.trim();
  if (label) locationOverride.label = label;
  if (latitude) locationOverride.latitude = latitude;
  if (longitude) locationOverride.longitude = longitude;
  return locationOverride;
}

export function photoInfoLocationDraftChanged(
  item: Partial<Pick<PhotoItem, "locationOverride" | "locationHidden">> | null | undefined,
  draft: PhotoInfoLocationDraft
): boolean {
  const current = photoInfoLocationDraftFromItem(item);
  return draft.label !== current.label
    || draft.latitude !== current.latitude
    || draft.longitude !== current.longitude
    || draft.hidden !== current.hidden;
}

export function emptyPhotoInfoDateTimeDraft(): PhotoDateTimeDraft {
  return {
    date: "",
    time: "",
    timezone: "",
  };
}

export function photoInfoOriginalDateDraftFromItem(
  item: Partial<Pick<PhotoItem, "originalCaptureDate">> | null | undefined
): PhotoDateTimeDraft {
  return splitPhotoDateTimeOverride(item?.originalCaptureDate || "");
}

export function photoInfoDateOverrideDraftFromItem(
  item: Partial<Pick<PhotoItem, "dateOverride">> | null | undefined
): PhotoDateTimeDraft {
  return splitPhotoDateTimeOverride(item?.dateOverride || "");
}

export function photoInfoDateDraftsFromItem(
  item: Partial<Pick<PhotoItem, "originalCaptureDate" | "dateOverride">> | null | undefined
): PhotoInfoDateDrafts {
  return {
    original: photoInfoOriginalDateDraftFromItem(item),
    dateOverride: photoInfoDateOverrideDraftFromItem(item),
  };
}

export function photoXmpConflictPatch(conflict: PhotoXmpMetadataConflict): PhotoMetadataPatch | null {
  const sidecarText = photoXmpConflictCleanText(conflict.sidecarValue ?? conflict.sidecar);
  if (conflict.field === "title") return { title: sidecarText };
  if (conflict.field === "caption") return { caption: sidecarText };
  if (conflict.field === "dateOverride") return sidecarText ? { dateOverride: sidecarText } : null;
  if (conflict.field === "keywords") {
    const rawKeywords = Array.isArray(conflict.sidecarValue)
      ? conflict.sidecarValue
      : String(conflict.sidecar || "").split(",");
    const keywords = rawKeywords
      .map((keyword) => photoXmpConflictCleanText(keyword))
      .filter(Boolean);
    return keywords.length ? { keywords } : null;
  }
  if (conflict.field === "locationOverride") {
    const value = conflict.sidecarValue;
    const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    const locationOverride: Record<string, unknown> = {};
    const label = photoXmpConflictCleanText(record.label);
    const latitude = photoXmpConflictCleanText(record.latitude);
    const longitude = photoXmpConflictCleanText(record.longitude);
    if (label) locationOverride.label = label;
    if (latitude) locationOverride.latitude = latitude;
    if (longitude) locationOverride.longitude = longitude;
    return Object.keys(locationOverride).length ? { locationOverride, locationHidden: false } : null;
  }
  return null;
}

export function restoredPhotoCaptureDate(item: PhotoItem, nextDateOverride: string): string {
  if (nextDateOverride) return nextDateOverride;
  const original = String(item.originalCaptureDate || "");
  if (original) return original;
  const currentCapture = String(item.captureDate || "");
  const currentOverride = String(item.dateOverride || "");
  if (currentOverride && currentCapture.slice(0, 10) === currentOverride.slice(0, 10)) return "";
  return currentCapture;
}

export function infoDraftChanged(
  item: PhotoItem,
  title: string,
  caption: string,
  accessibleDescription: string,
  descriptionRegions: unknown,
  keywords: string,
  originalDate: string,
  originalTime: string,
  originalTimezone: string,
  date: string,
  time: string,
  timezone: string,
  locationLabel: string,
  latitude: string,
  longitude: string,
  locationHidden: boolean,
  depthMode: PhotoLocalDepthMode,
  depthAperture: string,
  depthFocusDistance: string,
  depthEffect: string,
): boolean {
  return title !== (item.title || "")
    || caption !== (item.caption || "")
    || accessibleDescription.replace(/\s+/g, " ").trim() !== photoEditableAccessibleDescription(item)
    || !photoDescriptionRegionsEquivalent(descriptionRegions, buildPhotoDescriptionRegions(item))
    || !keywordsEqual(parseKeywordsDraft(keywords), item.keywords || [])
    || composePhotoDateTimeOverride(originalDate, originalTime, originalTimezone) !== normalizePhotoDateTimeOverride(item.originalCaptureDate || "")
    || composePhotoDateTimeOverride(date, time, timezone) !== normalizePhotoDateTimeOverride(item.dateOverride || "")
    || photoInfoLocationDraftChanged(item, {
      label: locationLabel,
      latitude,
      longitude,
      hidden: locationHidden,
    })
    || !photoLocalDepthControlsEqual(photoLocalDepthControlsFromItem(item), {
      mode: depthMode,
      aperture: depthAperture,
      focusDistance: depthFocusDistance,
      effect: depthEffect,
    });
}

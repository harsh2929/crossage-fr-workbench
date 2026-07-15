import {
  photoRailSectionSupportsItemOrder,
  type PhotoRailItemOrder,
  type PhotoRailSectionId
} from "./photoRailVisibility";
import {
  normalizePhotoLocalSettings,
  normalizePhotoRailPreferences,
  type PhotoLocalSettings,
  type PhotoRailPreferences
} from "./photoSettings";

export type PhotoPeopleSortMode = "manual" | "name";

export const PINNED_PHOTO_RAIL_IDS_KEY = "vintrace.photos.pinnedRailIds";
export const COLLAPSED_PHOTO_RAIL_SECTIONS_KEY = "vintrace.photos.collapsedRailSections";
export const COLLAPSED_PHOTO_ALBUM_FOLDERS_KEY = "vintrace.photos.collapsedAlbumFolders";
export const PHOTO_RAIL_SECTION_ORDER_KEY = "vintrace.photos.railSectionOrder";
export const PHOTO_RAIL_ITEM_ORDER_KEY = "vintrace.photos.railItemOrder";
export const PHOTO_RAIL_SHOW_UTILITIES_KEY = "vintrace.photos.showUtilityCollections";
export const PHOTO_RAIL_SHOW_SENSITIVE_KEY = "vintrace.photos.showSensitiveCollections";
export const PHOTO_RAIL_SHOW_SCREENSHOTS_KEY = "vintrace.photos.showScreenshotCollections";
export const PHOTO_RAIL_SHOW_SHARED_KEY = "vintrace.photos.showSharedCollections";
export const PHOTO_RAIL_SHOW_LOW_VALUE_KEY = "vintrace.photos.showLowValueCollections";
export const PHOTO_PEOPLE_SORT_MODE_KEY = "vintrace.photos.peopleSortMode";
export const PHOTO_IMPORT_KEEP_FOLDERS_KEY = "vintrace.photos.importKeepFolderOrganization";
export const PHOTO_IMPORT_MANAGED_ROOT_KEY = "vintrace.photos.importManagedRoot";
export const PHOTO_ACTIVE_LIBRARY_ROOT_KEY = "vintrace.photos.activeLibraryRoot";
export const PHOTO_ACTIVE_LIBRARY_ROOT_PROFILE_ID_KEY = "vintrace.photos.activeLibraryRootProfileId";
export const PHOTO_EXPORT_DESTINATIONS_KEY = "vintrace.photos.exportDestinations";

function photoRecordValue(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readStoredStringSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

export function readStoredStringList(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((value) => String(value)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function readStoredString(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function normalizePhotoRailItemOrderPreference(value: unknown): PhotoRailItemOrder {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const next: PhotoRailItemOrder = {};
  Object.entries(value as Record<string, unknown>).forEach(([sectionId, order]) => {
    const id = sectionId as PhotoRailSectionId;
    if (!photoRailSectionSupportsItemOrder(id) || !Array.isArray(order)) return;
    next[id] = order.map((item) => String(item)).filter(Boolean);
  });
  return next;
}

export function readStoredPhotoRailItemOrder(key: string): PhotoRailItemOrder {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoRailItemOrderPreference(raw ? JSON.parse(raw) : {});
  } catch {
    return {};
  }
}

export function readStoredBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

export function readStoredPeopleSortMode(key: string): PhotoPeopleSortMode {
  if (typeof window === "undefined") return "manual";
  try {
    return window.localStorage.getItem(key) === "name" ? "name" : "manual";
  } catch {
    return "manual";
  }
}

export function storeStringSet(key: string, values: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function storeStringList(key: string, values: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function storeString(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function storePhotoRailItemOrder(key: string, value: PhotoRailItemOrder) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoRailItemOrderPreference(value)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function storeBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function readLegacyPhotoRailPreferences(): PhotoRailPreferences {
  return normalizePhotoRailPreferences({
    showUtilityCollections: readStoredBoolean(PHOTO_RAIL_SHOW_UTILITIES_KEY, true),
    showSensitiveCollections: readStoredBoolean(PHOTO_RAIL_SHOW_SENSITIVE_KEY, true),
    showScreenshotCollections: readStoredBoolean(PHOTO_RAIL_SHOW_SCREENSHOTS_KEY, true),
    showSharedCollections: readStoredBoolean(PHOTO_RAIL_SHOW_SHARED_KEY, true),
    showLowValueCollections: readStoredBoolean(PHOTO_RAIL_SHOW_LOW_VALUE_KEY, true),
    pinnedIds: [...readStoredStringSet(PINNED_PHOTO_RAIL_IDS_KEY)],
    collapsedSections: [...readStoredStringSet(COLLAPSED_PHOTO_RAIL_SECTIONS_KEY)],
    sectionOrder: readStoredStringList(PHOTO_RAIL_SECTION_ORDER_KEY),
    itemOrder: readStoredPhotoRailItemOrder(PHOTO_RAIL_ITEM_ORDER_KEY),
  });
}

export function normalizePhotoLocalSettingsWithLegacyRail(value: unknown): PhotoLocalSettings {
  const record = photoRecordValue(value) ? value : {};
  if (Object.prototype.hasOwnProperty.call(record, "railPreferences")) return normalizePhotoLocalSettings(record);
  return normalizePhotoLocalSettings({
    ...record,
    railPreferences: readLegacyPhotoRailPreferences(),
  });
}

export function storeLegacyPhotoRailPreferences(value: PhotoRailPreferences) {
  const next = normalizePhotoRailPreferences(value);
  storeBoolean(PHOTO_RAIL_SHOW_UTILITIES_KEY, next.showUtilityCollections);
  storeBoolean(PHOTO_RAIL_SHOW_SENSITIVE_KEY, next.showSensitiveCollections);
  storeBoolean(PHOTO_RAIL_SHOW_SCREENSHOTS_KEY, next.showScreenshotCollections);
  storeBoolean(PHOTO_RAIL_SHOW_SHARED_KEY, next.showSharedCollections);
  storeBoolean(PHOTO_RAIL_SHOW_LOW_VALUE_KEY, next.showLowValueCollections);
  storeStringSet(PINNED_PHOTO_RAIL_IDS_KEY, new Set(next.pinnedIds));
  storeStringSet(COLLAPSED_PHOTO_RAIL_SECTIONS_KEY, new Set(next.collapsedSections));
  storeStringList(PHOTO_RAIL_SECTION_ORDER_KEY, next.sectionOrder);
  storePhotoRailItemOrder(PHOTO_RAIL_ITEM_ORDER_KEY, normalizePhotoRailItemOrderPreference(next.itemOrder));
}

export function readStoredPhotoLocalSettings(key: string): PhotoLocalSettings {
  if (typeof window === "undefined") return normalizePhotoLocalSettingsWithLegacyRail({});
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoLocalSettingsWithLegacyRail(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizePhotoLocalSettingsWithLegacyRail({});
  }
}

export function storePhotoLocalSettings(key: string, value: PhotoLocalSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoLocalSettings(value)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function normalizePhotoExportDestinations(values: unknown): string[] {
  const raw = Array.isArray(values) ? values : [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    next.push(text);
    if (next.length >= 12) break;
  }
  return next;
}

export function readStoredPhotoExportDestinations(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoExportDestinations(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoExportDestinations(key: string, values: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoExportDestinations(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

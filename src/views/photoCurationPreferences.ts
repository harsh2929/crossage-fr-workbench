import type { PhotoCurationPreferencesValue, PhotoFolder, PhotoItem, PhotoMemory } from "../types";

export type PhotoCurationPreferenceKind = "person" | "place" | "date" | "content";

export interface PhotoFeatureLessSuggestion {
  kind: PhotoCurationPreferenceKind;
  value: string;
  targetLabel: string;
  actionLabel: string;
  active: boolean;
}

type PhotoCurationListKey = "featureLessPeople" | "featureLessPlaces" | "featureLessDates" | "featureLessContent";

const EMPTY_PHOTO_CURATION_PREFERENCES: PhotoCurationPreferencesValue = {
  featureLessPeople: [],
  featureLessPlaces: [],
  featureLessDates: [],
  featureLessContent: [],
  favoriteMemories: [],
  hiddenMemories: [],
  memoryRemovedItems: {},
  updatedAt: "",
};

const KIND_TO_KEY: Record<PhotoCurationPreferenceKind, PhotoCurationListKey> = {
  person: "featureLessPeople",
  place: "featureLessPlaces",
  date: "featureLessDates",
  content: "featureLessContent",
};

export function cleanPhotoCurationValues(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const values: string[] = [];
  raw.forEach((item) => {
    const clean = String(item || "").replace(/\s+/g, " ").trim().slice(0, 96);
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    values.push(clean);
  });
  return values.slice(0, 120);
}

function cleanPhotoCurationSourcePaths(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const values: string[] = [];
  raw.forEach((item) => {
    const clean = String(item || "").trim().slice(0, 4096);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    values.push(clean);
  });
  return values.slice(0, 500);
}

function cleanPhotoMemoryId(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 128);
}

function cleanPhotoMemoryRemovedItems(value: unknown): Record<string, string[]> {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.entries(record).slice(0, 120).reduce<Record<string, string[]>>((acc, [rawMemoryId, rawPaths]) => {
    const memoryId = rawMemoryId.replace(/\s+/g, " ").trim().slice(0, 128);
    const paths = cleanPhotoCurationSourcePaths(rawPaths);
    if (memoryId && paths.length) acc[memoryId] = paths;
    return acc;
  }, {});
}

export function normalizePhotoCurationPreferences(value: unknown): PhotoCurationPreferencesValue {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    featureLessPeople: cleanPhotoCurationValues(record.featureLessPeople),
    featureLessPlaces: cleanPhotoCurationValues(record.featureLessPlaces),
    featureLessDates: cleanPhotoCurationValues(record.featureLessDates),
    featureLessContent: cleanPhotoCurationValues(record.featureLessContent),
    favoriteMemories: cleanPhotoCurationValues(record.favoriteMemories || record.favoriteMemoryIds),
    hiddenMemories: cleanPhotoCurationValues(record.hiddenMemories || record.hiddenMemoryIds),
    memoryRemovedItems: cleanPhotoMemoryRemovedItems(record.memoryRemovedItems || record.removedMemoryItems),
    updatedAt: String(record.updatedAt || ""),
  };
}

export function photoCurationPreferenceTotal(value: PhotoCurationPreferencesValue | null | undefined): number {
  return photoFeatureLessPreferenceTotal(value) + photoMemoryPreferenceTotal(value);
}

export function photoFeatureLessPreferenceTotal(value: PhotoCurationPreferencesValue | null | undefined): number {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  return preferences.featureLessPeople.length
    + preferences.featureLessPlaces.length
    + preferences.featureLessDates.length
    + preferences.featureLessContent.length;
}

export function photoMemoryPreferenceTotal(value: PhotoCurationPreferencesValue | null | undefined): number {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  return preferences.favoriteMemories.length
    + preferences.hiddenMemories.length
    + Object.values(preferences.memoryRemovedItems).reduce((total, paths) => total + paths.length, 0);
}

export function photoCurationPreferenceActive(
  value: PhotoCurationPreferencesValue | null | undefined,
  kind: PhotoCurationPreferenceKind,
  target: string,
): boolean {
  const key = KIND_TO_KEY[kind];
  const needle = String(target || "").trim().toLocaleLowerCase();
  if (!needle) return false;
  return normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES)[key]
    .some((item) => item.toLocaleLowerCase() === needle);
}

export function addPhotoCurationPreference(
  value: PhotoCurationPreferencesValue | null | undefined,
  kind: PhotoCurationPreferenceKind,
  target: string,
): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  const key = KIND_TO_KEY[kind];
  const clean = String(target || "").replace(/\s+/g, " ").trim().slice(0, 96);
  if (!clean || photoCurationPreferenceActive(preferences, kind, clean)) return preferences;
  return normalizePhotoCurationPreferences({ ...preferences, [key]: [...preferences[key], clean] });
}

export function removePhotoCurationPreference(
  value: PhotoCurationPreferencesValue | null | undefined,
  kind: PhotoCurationPreferenceKind,
  target: string,
): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  const key = KIND_TO_KEY[kind];
  const needle = String(target || "").trim().toLocaleLowerCase();
  return normalizePhotoCurationPreferences({
    ...preferences,
    [key]: preferences[key].filter((item) => item.toLocaleLowerCase() !== needle),
  });
}

export function clearPhotoCurationPreferences(): PhotoCurationPreferencesValue {
  return normalizePhotoCurationPreferences(EMPTY_PHOTO_CURATION_PREFERENCES);
}

export function clearPhotoFeatureLessPreferences(value: PhotoCurationPreferencesValue | null | undefined): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  return normalizePhotoCurationPreferences({
    ...preferences,
    featureLessPeople: [],
    featureLessPlaces: [],
    featureLessDates: [],
    featureLessContent: [],
  });
}

export function clearPhotoMemoryPreferences(value: PhotoCurationPreferencesValue | null | undefined): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  return normalizePhotoCurationPreferences({
    ...preferences,
    favoriteMemories: [],
    hiddenMemories: [],
    memoryRemovedItems: {},
  });
}

export function photoMemoryPreferenceActive(
  value: PhotoCurationPreferencesValue | null | undefined,
  key: "favoriteMemories" | "hiddenMemories",
  memoryId: string,
): boolean {
  const needle = cleanPhotoMemoryId(memoryId).toLocaleLowerCase();
  if (!needle) return false;
  return normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES)[key]
    .some((item) => item.toLocaleLowerCase() === needle);
}

export function setPhotoMemoryPreference(
  value: PhotoCurationPreferencesValue | null | undefined,
  key: "favoriteMemories" | "hiddenMemories",
  memoryId: string,
  active: boolean,
): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  const clean = cleanPhotoMemoryId(memoryId);
  const nextValues = preferences[key].filter((item) => item.toLocaleLowerCase() !== clean.toLocaleLowerCase());
  if (active && clean) nextValues.push(clean);
  return normalizePhotoCurationPreferences({ ...preferences, [key]: nextValues });
}

export function photoMemoryRemovedItems(
  value: PhotoCurationPreferencesValue | null | undefined,
  memoryId: string,
): string[] {
  const clean = cleanPhotoMemoryId(memoryId);
  if (!clean) return [];
  return normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES).memoryRemovedItems[clean] || [];
}

export function addPhotoMemoryRemovedItems(
  value: PhotoCurationPreferencesValue | null | undefined,
  memoryId: string,
  sourcePaths: string[],
): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  const clean = cleanPhotoMemoryId(memoryId);
  if (!clean) return preferences;
  const existing = preferences.memoryRemovedItems[clean] || [];
  const next = cleanPhotoCurationSourcePaths([...existing, ...sourcePaths]);
  return normalizePhotoCurationPreferences({
    ...preferences,
    memoryRemovedItems: { ...preferences.memoryRemovedItems, [clean]: next },
  });
}

export function clearPhotoMemoryRemovedItems(
  value: PhotoCurationPreferencesValue | null | undefined,
  memoryId: string,
): PhotoCurationPreferencesValue {
  const preferences = normalizePhotoCurationPreferences(value || EMPTY_PHOTO_CURATION_PREFERENCES);
  const clean = cleanPhotoMemoryId(memoryId);
  if (!clean || !preferences.memoryRemovedItems[clean]) return preferences;
  const { [clean]: _removed, ...remaining } = preferences.memoryRemovedItems;
  return normalizePhotoCurationPreferences({ ...preferences, memoryRemovedItems: remaining });
}

export type PhotoMemoryRemovedSourcesDraft = {
  sourcePaths: string[];
  preferences: PhotoCurationPreferencesValue;
  remaining: number;
  shouldExitMemory: boolean;
};

export type PhotoMemoryRemovedSourcesDraftInput = {
  preferences: PhotoCurationPreferencesValue | null | undefined;
  memoryId: string;
  sourcePaths: unknown;
  memorySourcePaths?: unknown;
  fallbackCount?: unknown;
};

export function photoMemoryRemovedSourcesDraft(input: PhotoMemoryRemovedSourcesDraftInput): PhotoMemoryRemovedSourcesDraft | null {
  const memoryId = cleanPhotoMemoryId(input.memoryId);
  const sourcePaths = cleanPhotoCurationSourcePaths(input.sourcePaths);
  if (!memoryId || !sourcePaths.length) return null;
  const preferences = addPhotoMemoryRemovedItems(input.preferences, memoryId, sourcePaths);
  const removed = new Set(photoMemoryRemovedItems(preferences, memoryId));
  const memorySourcePaths = cleanPhotoCurationSourcePaths(input.memorySourcePaths);
  const fallbackCount = Math.max(0, Number(input.fallbackCount) || 0);
  const remaining = memorySourcePaths.length
    ? memorySourcePaths.filter((sourcePath) => !removed.has(sourcePath)).length
    : Math.max(0, fallbackCount - sourcePaths.length);
  return {
    sourcePaths,
    preferences,
    remaining,
    shouldExitMemory: remaining < 2,
  };
}

export type PhotoUserMemoryDetails = {
  memoryId: string;
  userCreated: boolean;
  title: string;
  saveTitle: string;
  subtitle: string;
  coverSourcePath: string;
  movieSettings: PhotoMemory["movieSettings"] | null;
  hasMovieSettings: boolean;
};

export function photoUserMemoryDetails(folder: Pick<PhotoFolder, "memoryId" | "name" | "memory"> | null | undefined): PhotoUserMemoryDetails {
  const memory = folder?.memory || null;
  const movieSettings = memory?.movieSettings && typeof memory.movieSettings === "object" ? memory.movieSettings : null;
  const memoryId = cleanPhotoMemoryId(folder?.memoryId || memory?.memoryId || "");
  return {
    memoryId,
    userCreated: Boolean(memory?.userCreated || memoryId.startsWith("user:")),
    title: String(memory?.name || folder?.name || ""),
    saveTitle: String(folder?.name || memory?.name || ""),
    subtitle: String(memory?.subtitle || ""),
    coverSourcePath: String(memory?.coverSourcePath || ""),
    movieSettings,
    hasMovieSettings: Boolean(movieSettings && Object.keys(movieSettings).length),
  };
}

export function photoUserMemoryDetailsDirty(
  details: Pick<PhotoUserMemoryDetails, "userCreated" | "title" | "subtitle"> | null | undefined,
  titleDraft: unknown,
  subtitleDraft: unknown,
): boolean {
  return Boolean(details?.userCreated)
    && (
      String(titleDraft || "").trim() !== String(details?.title || "").trim()
      || String(subtitleDraft || "").trim() !== String(details?.subtitle || "").trim()
    );
}

export type PhotoUserMemoryDetailsSaveDraft = {
  memoryId: string;
  name: string;
  subtitle: string;
  coverSourcePath: string;
};

export function photoUserMemoryDetailsSaveDraft(input: {
  details: Pick<PhotoUserMemoryDetails, "memoryId" | "userCreated" | "title" | "subtitle" | "coverSourcePath"> & { saveTitle?: string } | null | undefined;
  titleDraft?: unknown;
  defaultTitle?: unknown;
  subtitleDraft?: unknown;
  coverSourcePath?: unknown;
  fallbackName?: unknown;
}): PhotoUserMemoryDetailsSaveDraft | null {
  const memoryId = cleanPhotoMemoryId(input.details?.memoryId || "");
  if (!memoryId || !input.details?.userCreated) return null;
  const fallbackName = String(input.fallbackName || "").trim();
  const currentTitle = String(input.details.title || "").trim();
  const defaultTitle = String(input.defaultTitle || "").trim();
  const currentSubtitle = String(input.details.subtitle || "").trim();
  const titleDraft = input.titleDraft === undefined ? (defaultTitle || currentTitle) : String(input.titleDraft || "").trim();
  const subtitleDraft = input.subtitleDraft === undefined ? currentSubtitle : String(input.subtitleDraft || "").trim();
  const coverSourcePath = input.coverSourcePath === undefined
    ? String(input.details.coverSourcePath || "").trim()
    : String(input.coverSourcePath || "").trim();
  return {
    memoryId,
    name: titleDraft || currentTitle || fallbackName,
    subtitle: subtitleDraft,
    coverSourcePath,
  };
}

export type PhotoUserMemoryCreateDraft = {
  name: string;
  subtitle: string;
  sourcePaths: string[];
  coverSourcePath: string;
};

export type PhotoMemoriesFeedState<T extends PhotoFolder = PhotoFolder> = {
  memoryFolders: T[];
  featuredMemory: T | null;
  onThisDayMemories: T[];
  gridMemories: T[];
};

export function photoUserMemoryCreateDraft(input: {
  sourcePaths: unknown;
  nameDraft?: unknown;
  defaultName?: unknown;
  activeName?: unknown;
  sourceLabel?: unknown;
  selected?: boolean;
  labels?: {
    memory?: string;
    selection?: string;
    currentView?: string;
  };
  minSourceCount?: number;
}): PhotoUserMemoryCreateDraft | null {
  const sourcePaths = cleanPhotoCurationSourcePaths(input.sourcePaths);
  const minSourceCount = Math.max(1, Math.round(Number(input.minSourceCount ?? 2) || 2));
  if (sourcePaths.length < minSourceCount) return null;
  const labels = {
    memory: input.labels?.memory || "Memory",
    selection: input.labels?.selection || "Selection",
    currentView: input.labels?.currentView || "Current view",
  };
  const activeName = String(input.activeName || "").trim();
  const name = String(input.nameDraft || "").trim()
    || String(input.defaultName || "").trim()
    || activeName
    || labels.memory;
  const subtitle = String(input.sourceLabel || "").trim()
    || (input.selected ? labels.selection : activeName || labels.currentView);
  return {
    name,
    subtitle,
    sourcePaths,
    coverSourcePath: sourcePaths[0] || "",
  };
}

export function buildPhotoMemoriesFeedState<T extends PhotoFolder>(
  folders: T[],
  now: Date = new Date(),
): PhotoMemoriesFeedState<T> {
  const memoryFolders = folders.filter((folder) => folder.kind === "memory");
  const featuredMemory = memoryFolders.length
    ? [...memoryFolders].sort((a, b) => {
      const favorite = Number(Boolean(b.memory?.favorite)) - Number(Boolean(a.memory?.favorite));
      if (favorite) return favorite;
      const hint = String(a.memory?.sortHint || "").localeCompare(String(b.memory?.sortHint || ""));
      if (hint) return hint;
      return String(b.memory?.endDate || b.memory?.startDate || "").localeCompare(String(a.memory?.endDate || a.memory?.startDate || ""));
    })[0] || null
    : null;
  const monthDay = Number.isFinite(now.getTime())
    ? `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
    : "";
  const onThisDayMemories = monthDay
    ? memoryFolders
      .filter((folder) => {
        const start = String(folder.memory?.startDate || "").slice(5, 10);
        const end = String(folder.memory?.endDate || "").slice(5, 10);
        return start === monthDay || end === monthDay;
      })
      .slice(0, 12)
    : [];
  const surfacedIds = new Set([featuredMemory?.id, ...onThisDayMemories.map((folder) => folder.id)].filter(Boolean));
  return {
    memoryFolders,
    featuredMemory,
    onThisDayMemories,
    gridMemories: memoryFolders.filter((folder) => !surfacedIds.has(folder.id)),
  };
}

function photoItemDateKey(item: PhotoItem | null | undefined): string {
  const raw = String(item?.dateOverride || item?.captureDate || item?.originalCaptureDate || item?.scanDate || item?.addedAt || item?.createdAt || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function photoItemPeople(item: PhotoItem | null | undefined): string[] {
  const people = Array.isArray(item?.people)
    ? item.people.map((person) => String(person?.personName || "").trim()).filter(Boolean)
    : [];
  const direct = String(item?.personName || "").trim();
  return cleanPhotoCurationValues(direct ? [...people, direct] : people);
}

function photoItemPlace(item: PhotoItem | null | undefined): string {
  if (!item || item.locationHidden) return "";
  const location = item.locationOverride || {};
  const label = String(location.label || "").replace(/\s+/g, " ").trim();
  if (label) return label;
  const latitude = String(location.latitude || location.lat || "").trim();
  const longitude = String(location.longitude || location.lon || location.lng || "").trim();
  if (latitude && longitude) return `${latitude}, ${longitude}`;
  const exif = item.assetMetadata?.exif && typeof item.assetMetadata.exif === "object" ? item.assetMetadata.exif as Record<string, unknown> : {};
  const gps = exif.gps && typeof exif.gps === "object" ? exif.gps as Record<string, unknown> : {};
  const exifLatitude = String(gps.latitude || gps.lat || "").trim();
  const exifLongitude = String(gps.longitude || gps.lon || gps.lng || "").trim();
  return exifLatitude && exifLongitude ? `${exifLatitude}, ${exifLongitude}` : "";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataTextValues(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => metadataTextValues(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = ["label", "name", "text", "value", "title", "description", "category", "kind", "type"]
      .flatMap((key) => metadataTextValues(record[key], depth + 1));
    if (direct.length) return direct;
    return Object.values(record).flatMap((item) => metadataTextValues(item, depth + 1));
  }
  return [];
}

function photoItemMetadataValues(item: PhotoItem | null | undefined, keys: string[]): string[] {
  const metadata = objectValue(item?.assetMetadata);
  return cleanPhotoCurationValues(keys.flatMap((key) => metadataTextValues(metadata[key])));
}

function mediaKindLabel(value: string): string {
  const labels: Record<string, string> = {
    screen_recording: "screen recording",
    time_lapse: "time-lapse",
    live_photo: "Live Photo",
    raw: "RAW",
  };
  return labels[value] || value.replace(/_/g, " ");
}

function photoItemContentValues(item: PhotoItem | null | undefined): string[] {
  const mediaKind = String(item?.mediaKind || "").trim().toLocaleLowerCase();
  const mediaValues = mediaKind && mediaKind !== "image" ? [mediaKind] : [];
  const keywordValues = Array.isArray(item?.keywords) ? item.keywords.map((keyword) => String(keyword || "")) : [];
  const detectedValues = photoItemMetadataValues(item, [
    "modelTags",
    "tags",
    "objectTags",
    "sceneTags",
    "labels",
    "detectedItems",
    "detectedEvents",
    "objects",
    "scenes",
    "events",
  ]);
  return cleanPhotoCurationValues([...mediaValues, ...keywordValues, ...detectedValues]);
}

export function buildPhotoFeatureLessSuggestions(
  item: PhotoItem | null | undefined,
  preferences: PhotoCurationPreferencesValue | null | undefined,
): PhotoFeatureLessSuggestion[] {
  if (!item) return [];
  const suggestions: PhotoFeatureLessSuggestion[] = [];
  const normalized = normalizePhotoCurationPreferences(preferences || EMPTY_PHOTO_CURATION_PREFERENCES);
  const push = (kind: PhotoCurationPreferenceKind, value: string, label = value) => {
    const clean = String(value || "").trim();
    if (!clean || suggestions.some((itemValue) => itemValue.kind === kind && itemValue.value.toLocaleLowerCase() === clean.toLocaleLowerCase())) return;
    suggestions.push({
      kind,
      value: clean,
      targetLabel: label,
      actionLabel: `Feature ${label} less`,
      active: photoCurationPreferenceActive(normalized, kind, clean),
    });
  };
  photoItemPeople(item).slice(0, 2).forEach((person) => push("person", person));
  push("place", photoItemPlace(item));
  push("date", photoItemDateKey(item));
  const content = photoItemContentValues(item)[0] || "";
  push("content", content, mediaKindLabel(content));
  return suggestions.slice(0, 5);
}

function cleanMemoryTopicLabel(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\b(Highlights|Memories|Moments|Trip)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function memoryDateTarget(memory: PhotoMemory, precision: "year" | "month" | "day"): string {
  const raw = String(memory.startDate || memory.endDate || memory.dateRangeLabel || memory.name || "").trim();
  const match = raw.match(/(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!match) return "";
  if (precision === "year") return match[1] || "";
  if (precision === "month") return match[1] && match[2] ? `${match[1]}-${match[2]}` : match[1] || "";
  return match[1] && match[2] && match[3] ? `${match[1]}-${match[2]}-${match[3]}` : match[1] || "";
}

export function buildPhotoMemoryFeatureLessSuggestions(
  memory: PhotoMemory | null | undefined,
  preferences: PhotoCurationPreferencesValue | null | undefined,
): PhotoFeatureLessSuggestion[] {
  if (!memory) return [];
  const category = String(memory.category || "").trim().toLocaleLowerCase();
  if (!category || category === "user" || category === "favorites") return [];
  const normalized = normalizePhotoCurationPreferences(preferences || EMPTY_PHOTO_CURATION_PREFERENCES);
  const suggestions: PhotoFeatureLessSuggestion[] = [];
  const push = (kind: PhotoCurationPreferenceKind, value: string, label = value) => {
    const clean = String(value || "").replace(/\s+/g, " ").trim().slice(0, 96);
    const cleanLabel = String(label || clean).replace(/\s+/g, " ").trim().slice(0, 96);
    if (!clean || suggestions.some((item) => item.kind === kind && item.value.toLocaleLowerCase() === clean.toLocaleLowerCase())) return;
    suggestions.push({
      kind,
      value: clean,
      targetLabel: cleanLabel || clean,
      actionLabel: `Feature ${cleanLabel || clean} less`,
      active: photoCurationPreferenceActive(normalized, kind, clean),
    });
  };

  if (category === "person") {
    push("person", cleanMemoryTopicLabel(memory.name));
  } else if (category === "place" || category === "trip") {
    push("place", cleanMemoryTopicLabel(memory.name));
  } else if (category === "year") {
    push("date", memoryDateTarget(memory, "year"));
  } else if (category === "month") {
    push("date", memoryDateTarget(memory, "month"));
  } else if (category === "holiday" || category === "event") {
    push("content", cleanMemoryTopicLabel(memory.name));
    const dateTarget = memoryDateTarget(memory, "day");
    if (dateTarget.length === 10) push("date", dateTarget);
  } else {
    const topic = cleanMemoryTopicLabel(memory.name || memory.subtitle);
    if (topic) push("content", topic);
  }

  return suggestions.slice(0, 3);
}

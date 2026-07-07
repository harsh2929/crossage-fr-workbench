import type { PhotoCurationPreferencesValue } from "../types";

export interface PhotoSearchSuggestionFolder {
  name?: unknown;
  kind?: unknown;
  mediaKind?: unknown;
  place?: { label?: unknown; name?: unknown } | null;
  groupPeople?: unknown[];
  groupPets?: unknown[];
}

export interface PhotoSearchSuggestionKeyword {
  name?: unknown;
}

export interface PhotoSearchSuggestionItem {
  sourcePath?: unknown;
  title?: unknown;
  caption?: unknown;
  keywords?: unknown;
  mediaKind?: unknown;
  personName?: unknown;
  people?: unknown[];
  captureDate?: unknown;
  originalCaptureDate?: unknown;
  dateOverride?: unknown;
  scanDate?: unknown;
  locationOverride?: Record<string, unknown> | null;
  assetMetadata?: Record<string, unknown> | null;
}

export interface PhotoSearchSuggestionInput {
  query?: unknown;
  suggestions?: unknown[];
  folders?: PhotoSearchSuggestionFolder[];
  keywords?: PhotoSearchSuggestionKeyword[];
  people?: unknown[];
  items?: PhotoSearchSuggestionItem[];
  curationPreferences?: PhotoCurationPreferencesValue | null;
  limit?: number;
}

const DEFAULT_LIMIT = 60;

export function buildPhotoSearchSuggestions(input: PhotoSearchSuggestionInput): string[] {
  const limit = Math.max(1, Math.min(200, Number(input.limit) || DEFAULT_LIMIT));
  const needle = normalizeSuggestionText(input.query);
  const suggestions: Array<{ text: string; penalty: number; position: number }> = [];
  const seen = new Map<string, { text: string; penalty: number; position: number }>();
  const preferences = normalizeSuggestionCurationPreferences(input.curationPreferences);

  const add = (value: unknown, contextPenalty = 0) => {
    const text = String(value ?? "").trim();
    if (text.length < 2) return;
    const clipped = text.length > 80 ? text.slice(0, 80).trim() : text;
    const key = clipped.toLocaleLowerCase();
    const penalty = Math.max(
      0,
      Number(contextPenalty) || 0,
      suggestionTextCurationPenalty(clipped, preferences),
    );
    const existing = seen.get(key);
    if (existing) {
      existing.penalty = Math.min(existing.penalty, penalty);
      return;
    }
    const candidate = { text: clipped, penalty, position: suggestions.length };
    seen.set(key, candidate);
    suggestions.push(candidate);
  };

  (input.suggestions || []).forEach(add);
  (input.people || []).forEach(add);
  (input.folders || []).forEach((folder) => {
    const penalty = folderSuggestionCurationPenalty(folder, preferences);
    add(folder.name, penalty);
    add(folder.place?.label || folder.place?.name, penalty);
    add(mediaKindLabel(folder.mediaKind), penalty);
  });
  (input.keywords || []).forEach((keyword) => add(keyword.name));
  (input.items || []).forEach((item) => {
    const penalty = itemSuggestionCurationPenalty(item, preferences);
    add(item.title, penalty);
    add(item.caption, penalty);
    add(fileStem(item.sourcePath), penalty);
    add(mediaKindLabel(item.mediaKind), penalty);
    add(item.locationOverride?.label, penalty);
    addDateSuggestions(item.dateOverride || item.captureDate || item.originalCaptureDate || item.scanDate, (value) => add(value, penalty));
    addKeywordValues(item.keywords, (value) => add(value, penalty));
    addMetadataValues(item.assetMetadata, (value) => add(value, penalty));
  });

  return suggestions
    .filter((suggestion) => !needle || suggestion.text.toLocaleLowerCase().includes(needle))
    .sort((a, b) => a.penalty - b.penalty || a.position - b.position)
    .slice(0, limit)
    .map((suggestion) => suggestion.text);
}

type SuggestionCurationPreferences = {
  featureLessPeople: Set<string>;
  featureLessPlaces: Set<string>;
  featureLessDates: Set<string>;
  featureLessContent: Set<string>;
};

function normalizeSuggestionCurationPreferences(value: PhotoCurationPreferencesValue | null | undefined): SuggestionCurationPreferences {
  return {
    featureLessPeople: suggestionPreferenceKeys(value?.featureLessPeople),
    featureLessPlaces: suggestionPreferenceKeys(value?.featureLessPlaces),
    featureLessDates: suggestionPreferenceKeys(value?.featureLessDates),
    featureLessContent: suggestionPreferenceKeys(value?.featureLessContent),
  };
}

function suggestionPreferenceKeys(value: unknown): Set<string> {
  const raw = Array.isArray(value) ? value : [];
  return new Set(
    raw
      .map((item) => normalizeSuggestionText(item))
      .filter(Boolean)
  );
}

function normalizeSuggestionText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function suggestionValuesMatch(values: unknown[], keys: Set<string>, contains = false): boolean {
  if (!keys.size) return false;
  const normalized = values.map((value) => normalizeSuggestionText(value)).filter(Boolean);
  return normalized.some((value) => {
    if (keys.has(value)) return true;
    return contains && [...keys].some((key) => key.includes(value) || value.includes(key));
  });
}

function suggestionTextCurationPenalty(value: unknown, preferences: SuggestionCurationPreferences): number {
  const values = [value];
  let penalty = 0;
  if (suggestionValuesMatch(values, preferences.featureLessPeople)) penalty += 8;
  if (suggestionValuesMatch(values, preferences.featureLessPlaces, true)) penalty += 6;
  if (suggestionValuesMatch(values, preferences.featureLessDates)) penalty += 4;
  if (suggestionValuesMatch(values, preferences.featureLessContent, true)) penalty += 2;
  return penalty;
}

function folderSuggestionCurationPenalty(folder: PhotoSearchSuggestionFolder, preferences: SuggestionCurationPreferences): number {
  const people = [
    ...(Array.isArray(folder.groupPeople) ? folder.groupPeople : []),
    ...(Array.isArray(folder.groupPets) ? folder.groupPets : []),
  ];
  let penalty = suggestionValuesMatch(people, preferences.featureLessPeople) ? 8 : 0;
  if (suggestionValuesMatch([folder.place?.label, folder.place?.name], preferences.featureLessPlaces, true)) penalty += 6;
  if (suggestionValuesMatch([folder.name, folder.kind, mediaKindLabel(folder.mediaKind)], preferences.featureLessContent, true)) penalty += 2;
  return penalty;
}

function itemSuggestionCurationPenalty(item: PhotoSearchSuggestionItem, preferences: SuggestionCurationPreferences): number {
  const people = itemPeopleSuggestionValues(item);
  const dates = itemDateSuggestionValues(item.dateOverride || item.captureDate || item.originalCaptureDate || item.scanDate);
  const contentValues: unknown[] = [
    item.title,
    item.caption,
    fileStem(item.sourcePath),
    item.mediaKind,
    mediaKindLabel(item.mediaKind),
  ];
  addKeywordValues(item.keywords, (value) => contentValues.push(value));
  addMetadataValues(item.assetMetadata, (value) => contentValues.push(value));
  let penalty = 0;
  if (suggestionValuesMatch(people, preferences.featureLessPeople)) penalty += 8;
  if (suggestionValuesMatch([item.locationOverride?.label], preferences.featureLessPlaces, true)) penalty += 6;
  if (suggestionValuesMatch(dates, preferences.featureLessDates)) penalty += 4;
  if (suggestionValuesMatch(contentValues, preferences.featureLessContent, true)) penalty += 2;
  return penalty;
}

function itemPeopleSuggestionValues(item: PhotoSearchSuggestionItem): unknown[] {
  const values: unknown[] = [item.personName];
  if (Array.isArray(item.people)) {
    item.people.forEach((person) => {
      if (person && typeof person === "object" && !Array.isArray(person)) {
        values.push((person as Record<string, unknown>).personName);
        values.push((person as Record<string, unknown>).name);
      } else {
        values.push(person);
      }
    });
  }
  return values;
}

function itemDateSuggestionValues(value: unknown): string[] {
  const values: string[] = [];
  addDateSuggestions(value, (dateValue) => values.push(String(dateValue || "")));
  return values;
}

function addDateSuggestions(value: unknown, add: (value: unknown) => void) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!match) return;
  add(match[1]);
  if (match[2]) add(`${match[1]}-${match[2]}`);
  if (match[2] && match[3]) add(`${match[1]}-${match[2]}-${match[3]}`);
}

function addKeywordValues(value: unknown, add: (value: unknown) => void) {
  if (!Array.isArray(value)) return;
  value.forEach(add);
}

function addMetadataValues(value: Record<string, unknown> | null | undefined, add: (value: unknown) => void) {
  if (!value || typeof value !== "object") return;
  [
    "ocrText",
    "liveText",
    "detectedText",
    "textRegions",
    "textBlocks",
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
    "accessibilityDescription",
    "accessibleDescription",
    "altText",
    "imageDescription",
    "descriptionRegions",
    "accessibilityRegions",
    "imageDescriptionRegions",
    "markupDescriptionRegions",
    "photographicStyle",
    "photographicStyles",
    "photoStyle",
    "cameraStyle",
    "captureStyle",
    "pictureStyle",
    "creativeStyle",
    "styleName",
    "codec",
    "videoCodec",
    "audioCodec",
    "container",
    "format",
    "mimeType",
    "colorProfile",
    "iccProfile",
    "profileDescription",
    "colorSpace",
    "camera",
    "cameraMake",
    "cameraModel",
    "device",
    "deviceMake",
    "deviceModel",
    "captureDevice",
    "lens",
    "lensMake",
    "lensModel",
    "lensInfo",
    "lensSpecification",
    "lensSerialNumber",
    "software",
    "editingSoftware",
    "sourceSoftware",
    "app",
    "localDepthControls",
    "depthMetadata",
    "depth",
    "depthData",
    "depthMap",
    "disparityMap",
    "portraitMode",
    "portraitEffect",
    "portraitEffectsMatte",
    "portraitMatte",
    "cinematic",
    "cinematicMode",
    "cinematicFocus",
    "focusDistance",
    "subjectDistance",
    "focusPoint",
    "aperture",
    "fNumber",
    "auxiliaryImageType",
  ].forEach((key) => {
    addNestedMetadataValues(value[key], add);
  });
  const xmp = value.xmp && typeof value.xmp === "object" && !Array.isArray(value.xmp) ? value.xmp as Record<string, unknown> : null;
  if (xmp) {
    [
      "photographicStyle",
      "photographicStyles",
      "photoStyle",
      "cameraStyle",
      "captureStyle",
      "pictureStyle",
      "creativeStyle",
      "styleName",
      "profileName",
      "look",
      "codec",
      "videoCodec",
      "audioCodec",
      "container",
      "format",
      "mimeType",
      "colorProfile",
      "iccProfile",
      "profileDescription",
      "colorSpace",
      "camera",
      "cameraMake",
      "cameraModel",
      "device",
      "deviceMake",
      "deviceModel",
      "captureDevice",
      "lens",
      "lensMake",
      "lensModel",
      "lensInfo",
      "lensSpecification",
      "lensSerialNumber",
      "software",
      "editingSoftware",
      "sourceSoftware",
      "app",
      "localDepthControls",
      "depthMetadata",
      "depth",
      "depthData",
      "depthMap",
      "disparityMap",
      "portraitMode",
      "portraitEffect",
      "portraitEffectsMatte",
      "portraitMatte",
      "cinematic",
      "cinematicMode",
      "cinematicFocus",
      "focusDistance",
      "subjectDistance",
      "focusPoint",
      "aperture",
      "fNumber",
      "auxiliaryImageType",
    ].forEach((key) => addNestedMetadataValues(xmp[key], add));
  }
  ["video", "audio", "image", "probe"].forEach((recordKey) => {
    const nested = value[recordKey] && typeof value[recordKey] === "object" && !Array.isArray(value[recordKey])
      ? value[recordKey] as Record<string, unknown>
      : null;
    if (!nested) return;
    [
      "codec",
      "codecName",
      "videoCodec",
      "audioCodec",
      "container",
      "format",
      "mimeType",
      "colorProfile",
      "iccProfile",
      "profileDescription",
      "colorSpace",
    ].forEach((key) => addNestedMetadataValues(nested[key], add));
  });
}

function addNestedMetadataValues(value: unknown, add: (value: unknown) => void, depth = 0) {
  if (depth > 5) return;
  if (typeof value === "string" || typeof value === "number") {
    add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => addNestedMetadataValues(item, add, depth + 1));
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const directKeys = ["label", "name", "text", "value", "title", "description", "category", "kind", "type"];
    const hadDirect = directKeys.some((key) => key in record);
    directKeys.forEach((key) => {
      if (key in record) addNestedMetadataValues(record[key], add, depth + 1);
    });
    if (hadDirect) return;
    Object.entries(record).forEach(([key, entry]) => {
      const keyText = String(key || "").trim();
      if (keyText && (typeof entry === "number" || typeof entry === "boolean")) {
        if (!["confidence", "score", "probability", "bbox", "bounds", "x", "y", "width", "height"].includes(keyText.toLocaleLowerCase())) {
          add(keyText);
        }
      } else {
        addNestedMetadataValues(entry, add, depth + 1);
      }
    });
  }
}

function fileStem(value: unknown): string {
  const file = String(value ?? "").split(/[\\/]/).filter(Boolean).pop() || "";
  return file.replace(/\.[^.]+$/, "");
}

function mediaKindLabel(value: unknown): string {
  switch (String(value || "")) {
    case "image":
      return "Images";
    case "video":
      return "Videos";
    case "raw":
      return "RAW";
    case "live_photo":
      return "Live Photos";
    case "other":
      return "Other";
    default:
      return "";
  }
}

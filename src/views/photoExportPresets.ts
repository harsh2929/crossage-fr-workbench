export type PhotoExportVariant = "original" | "rendered";
export type PhotoExportRenderFormat = "jpeg" | "png" | "tiff" | "heic";
export type PhotoExportColorProfileTarget = "source" | "srgb" | "display-p3" | "adobe-rgb" | "custom-icc" | "none";
export type PhotoExportSizePreset = "full" | "large" | "medium" | "small" | "custom";
export type PhotoExportVideoFormat = "mp4" | "mov" | "m4v" | "webm" | "hevc" | "prores";
export type PhotoExportVideoQuality = "small" | "medium" | "high";
export type PhotoExportLayout = "bundle" | "flat";
export type PhotoExportFilenameMode = "numbered" | "original" | "template";
export type PhotoContactSheetFormat = "pdf" | "png" | "jpeg";
export type PhotoContactSheetCaptionPreset = "title_date_people" | "metadata" | "filename";
export type PhotoContactSheetPageSize = "letter" | "a4";
export type PhotoContactSheetLayoutPreset = "custom" | "full_page" | "two_up" | "four_up" | "wallet";
export type PhotoCreationExportPresetKind = "wallpaper" | "collage" | "poster";

export interface PhotoExportPresetSettings {
  includeMetadata: boolean;
  includeXmp: boolean;
  includeExistingSidecars: boolean;
  stripLocation: boolean;
  preserveColorProfile: boolean;
  targetColorProfile: PhotoExportColorProfileTarget;
  targetColorProfilePath: string;
  shareAfterExport: boolean;
  layout: PhotoExportLayout;
  filenameMode: PhotoExportFilenameMode;
  filenameTemplate: string;
  subfolderTemplate: string;
  exportVariant: PhotoExportVariant;
  renderFormat: PhotoExportRenderFormat;
  renderQuality: string;
  renderSizePreset: PhotoExportSizePreset;
  renderMaxDimension: string;
  videoRenderFormat: PhotoExportVideoFormat;
  videoRenderQuality: PhotoExportVideoQuality;
  contactSheetFormat: PhotoContactSheetFormat;
  contactSheetTitle: string;
  contactSheetCaptionPreset: PhotoContactSheetCaptionPreset;
  contactSheetPageSize: PhotoContactSheetPageSize;
  contactSheetLayout: PhotoContactSheetLayoutPreset;
  contactSheetColumns: string;
  contactSheetThumbnailSize: string;
  contactSheetIncludeCaptions: boolean;
}

export interface PhotoExportPreset {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: PhotoExportPresetSettings;
}

export interface PhotoCreationExportPreset {
  kind: PhotoCreationExportPresetKind;
  label: string;
  settings: PhotoExportPresetSettings;
}

export interface PhotoCreationSuggestionItemInput {
  sourcePath?: string | null;
  sourceUrl?: string | null;
  previewUrl?: string | null;
  title?: string | null;
  caption?: string | null;
  personName?: string | null;
  mediaKind?: string | null;
  favorite?: boolean | null;
  hidden?: boolean | null;
  deletedAt?: string | null;
  missingAt?: string | null;
  quality?: number | null;
  score?: number | null;
  bestQuality?: number | null;
  width?: number | null;
  height?: number | null;
  keywords?: string[];
  people?: Array<string | { personName?: string | null; quality?: number | null; score?: number | null }>;
  assetMetadata?: Record<string, unknown> | null;
}

export interface PhotoCreationCropPreview {
  sourceWidth: number;
  sourceHeight: number;
  sourceAspect: number;
  targetAspect: number;
  cropLossPercent: number;
  safe: boolean;
  label: string;
  detail: string;
}

export interface PhotoCreationExportSuggestion {
  kind: PhotoCreationExportPresetKind;
  label: string;
  sourcePaths: string[];
  coverPreviewUrl?: string;
  cropPreview?: PhotoCreationCropPreview;
  score: number;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  settings: PhotoExportPresetSettings;
}

export interface PhotoCreationSuggestionCache {
  version: 1;
  signature: string;
  generatedAt: string;
  sourceCount: number;
  suggestions: PhotoCreationExportSuggestion[];
}

export interface PhotoCreationSuggestionRefreshState {
  version: 1;
  signature: string;
  status: "success" | "failed";
  attempts: number;
  lastFinishedAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  nextRetryAt?: string;
  lastError?: string;
}

export const PHOTO_CREATION_SUGGESTION_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const PHOTO_CREATION_SUGGESTION_REFRESH_BASE_BACKOFF_MS = 5 * 60 * 1000;
export const PHOTO_CREATION_SUGGESTION_REFRESH_MAX_BACKOFF_MS = 60 * 60 * 1000;

export const PHOTO_EXPORT_SIZE_PRESETS: Array<{ id: PhotoExportSizePreset; label: string; maxDimension: string }> = [
  { id: "full", label: "Full size", maxDimension: "0" },
  { id: "large", label: "Large", maxDimension: "4096" },
  { id: "medium", label: "Medium", maxDimension: "2048" },
  { id: "small", label: "Small", maxDimension: "1024" },
  { id: "custom", label: "Custom", maxDimension: "custom" },
];

export interface PhotoCreationExportSuggestionOptions {
  favoritePeople?: string[];
  favoritePets?: string[];
  memoryContextSourcePaths?: string[];
  limit?: number;
  maxCollageItems?: number;
}

const DEFAULT_EXPORT_PRESET_SETTINGS: PhotoExportPresetSettings = {
  includeMetadata: false,
  includeXmp: false,
  includeExistingSidecars: false,
  stripLocation: false,
  preserveColorProfile: true,
  targetColorProfile: "source",
  targetColorProfilePath: "",
  shareAfterExport: false,
  layout: "bundle",
  filenameMode: "numbered",
  filenameTemplate: "{sequence}-{title}",
  subfolderTemplate: "",
  exportVariant: "original",
  renderFormat: "jpeg",
  renderQuality: "92",
  renderSizePreset: "full",
  renderMaxDimension: "0",
  videoRenderFormat: "mp4",
  videoRenderQuality: "medium",
  contactSheetFormat: "pdf",
  contactSheetTitle: "",
  contactSheetCaptionPreset: "title_date_people",
  contactSheetPageSize: "letter",
  contactSheetLayout: "custom",
  contactSheetColumns: "4",
  contactSheetThumbnailSize: "220",
  contactSheetIncludeCaptions: true,
};

function cleanChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

function cleanNumberText(value: unknown, fallback: string, min: number, max: number): string {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return String(Math.max(min, Math.min(max, parsed)));
}

function cleanPathText(value: unknown): string {
  return String(value ?? "").trim().slice(0, 4096);
}

function cleanRenderSizePreset(value: unknown, renderMaxDimension: string): PhotoExportSizePreset {
  const direct = PHOTO_EXPORT_SIZE_PRESETS.find((preset) => preset.id === value)?.id;
  if (direct) return direct;
  const matched = PHOTO_EXPORT_SIZE_PRESETS.find((preset) => preset.id !== "custom" && preset.maxDimension === renderMaxDimension);
  if (matched) return matched.id;
  return renderMaxDimension === "0" ? "full" : "custom";
}

export function photoExportSizePresetMaxDimension(preset: PhotoExportSizePreset | string, customMaxDimension = "0"): string {
  const matched = PHOTO_EXPORT_SIZE_PRESETS.find((item) => item.id === preset);
  if (!matched) return cleanNumberText(customMaxDimension, DEFAULT_EXPORT_PRESET_SETTINGS.renderMaxDimension, 0, 20000);
  return matched.id === "custom"
    ? cleanNumberText(customMaxDimension, DEFAULT_EXPORT_PRESET_SETTINGS.renderMaxDimension, 0, 20000)
    : matched.maxDimension;
}

function cleanText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cleanTemplate(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanErrorText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function cleanIsoDateText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  // Force UTC for a bare YYYY-MM-DD so the parse -> toISOString round-trip can't
  // shift the date by the local timezone offset (off-by-one-day).
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function cleanId(value: unknown): string {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 96);
}

export function defaultPhotoExportPresetSettings(): PhotoExportPresetSettings {
  return { ...DEFAULT_EXPORT_PRESET_SETTINGS };
}

export function photoProjectBundlePresetSettings(): PhotoExportPresetSettings {
  return {
    ...DEFAULT_EXPORT_PRESET_SETTINGS,
    includeMetadata: true,
    includeXmp: true,
    includeExistingSidecars: true,
    stripLocation: false,
    layout: "bundle",
    filenameMode: "original",
    filenameTemplate: "{original}",
    subfolderTemplate: "{sourceFolder}",
    exportVariant: "original",
  };
}

export function photoCreationExportPresetSettings(kind: PhotoCreationExportPresetKind | string): PhotoExportPresetSettings {
  if (kind === "collage") {
    return {
      ...DEFAULT_EXPORT_PRESET_SETTINGS,
      stripLocation: true,
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: "{date}-collage",
      subfolderTemplate: "Collages",
      exportVariant: "rendered",
      renderFormat: "jpeg",
      renderQuality: "92",
      renderSizePreset: "large",
      renderMaxDimension: "4096",
      videoRenderQuality: "high",
      contactSheetFormat: "jpeg",
      contactSheetTitle: "Collage",
      contactSheetCaptionPreset: "filename",
      contactSheetPageSize: "letter",
      contactSheetColumns: "3",
      contactSheetThumbnailSize: "320",
      contactSheetIncludeCaptions: false,
    };
  }
  if (kind === "poster") {
    return {
      ...DEFAULT_EXPORT_PRESET_SETTINGS,
      stripLocation: true,
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: "{title}-poster",
      subfolderTemplate: "Posters",
      exportVariant: "rendered",
      renderFormat: "jpeg",
      renderQuality: "100",
      renderSizePreset: "custom",
      renderMaxDimension: "6000",
      videoRenderQuality: "high",
      contactSheetFormat: "jpeg",
      contactSheetTitle: "Poster selects",
      contactSheetCaptionPreset: "metadata",
      contactSheetPageSize: "a4",
      contactSheetColumns: "1",
      contactSheetThumbnailSize: "512",
      contactSheetIncludeCaptions: false,
    };
  }
  return {
    ...DEFAULT_EXPORT_PRESET_SETTINGS,
    stripLocation: true,
    layout: "flat",
    filenameMode: "template",
    filenameTemplate: "{title}-wallpaper",
    subfolderTemplate: "Wallpapers",
    exportVariant: "rendered",
    renderFormat: "jpeg",
    renderQuality: "95",
    renderSizePreset: "custom",
    renderMaxDimension: "3840",
    videoRenderQuality: "high",
    contactSheetFormat: "jpeg",
    contactSheetTitle: "Wallpaper selects",
    contactSheetCaptionPreset: "metadata",
    contactSheetPageSize: "letter",
    contactSheetColumns: "1",
    contactSheetThumbnailSize: "512",
    contactSheetIncludeCaptions: false,
  };
}

export const PHOTO_CREATION_EXPORT_PRESETS: PhotoCreationExportPreset[] = [
  { kind: "wallpaper", label: "Wallpaper", settings: photoCreationExportPresetSettings("wallpaper") },
  { kind: "collage", label: "Collage", settings: photoCreationExportPresetSettings("collage") },
  { kind: "poster", label: "Poster", settings: photoCreationExportPresetSettings("poster") },
];

function cleanCreationKey(value: unknown): string {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function clampCreationScore(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function normalizeCreationQuality(...values: Array<number | null | undefined>): number {
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    return clampCreationScore(numeric > 1 ? numeric / 100 : numeric);
  }
  return 0.5;
}

function recordNumber(record: Record<string, unknown> | null | undefined, keys: string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function creationDimensions(item: PhotoCreationSuggestionItemInput): { width: number; height: number } | null {
  const directWidth = Number(item.width);
  const directHeight = Number(item.height);
  if (Number.isFinite(directWidth) && directWidth > 0 && Number.isFinite(directHeight) && directHeight > 0) {
    return { width: directWidth, height: directHeight };
  }
  const metadata = item.assetMetadata && typeof item.assetMetadata === "object" && !Array.isArray(item.assetMetadata)
    ? item.assetMetadata
    : null;
  const width = recordNumber(metadata, ["width", "imageWidth", "pixelWidth", "w"]);
  const height = recordNumber(metadata, ["height", "imageHeight", "pixelHeight", "h"]);
  if (width > 0 && height > 0) return { width, height };
  const dimensions = metadata?.dimensions && typeof metadata.dimensions === "object" && !Array.isArray(metadata.dimensions)
    ? metadata.dimensions as Record<string, unknown>
    : null;
  const nestedWidth = recordNumber(dimensions, ["width", "w"]);
  const nestedHeight = recordNumber(dimensions, ["height", "h"]);
  return nestedWidth > 0 && nestedHeight > 0 ? { width: nestedWidth, height: nestedHeight } : null;
}

function creationPeople(item: PhotoCreationSuggestionItemInput): string[] {
  const values = new Set<string>();
  if (item.personName) values.add(String(item.personName).trim());
  for (const entry of item.people || []) {
    const name = typeof entry === "string" ? entry : entry.personName;
    const clean = String(name || "").trim();
    if (clean) values.add(clean);
  }
  return [...values];
}

function creationMetadataTextValues(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = String(value || "").replace(/\s+/g, " ").trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => creationMetadataTextValues(item, depth + 1));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = ["label", "name", "text", "value", "title", "description", "category", "kind", "type"]
      .flatMap((key) => creationMetadataTextValues(record[key], depth + 1));
    if (direct.length) return direct;
    return Object.values(record).flatMap((item) => creationMetadataTextValues(item, depth + 1));
  }
  return [];
}

function creationContentValues(item: PhotoCreationSuggestionItemInput): string[] {
  const metadata = item.assetMetadata && typeof item.assetMetadata === "object" && !Array.isArray(item.assetMetadata)
    ? item.assetMetadata
    : {};
  const metadataValues = [
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
  ].flatMap((key) => creationMetadataTextValues(metadata[key]));
  return [
    item.title || "",
    item.caption || "",
    ...(item.keywords || []),
    ...metadataValues,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const CREATION_PET_TERMS = [
  "pet",
  "pets",
  "dog",
  "dogs",
  "puppy",
  "puppies",
  "cat",
  "cats",
  "kitten",
  "kittens",
  "horse",
  "horses",
  "rabbit",
  "rabbits",
  "bird",
  "birds",
  "parrot",
  "parrots",
  "hamster",
  "hamsters",
  "guinea pig",
  "guinea pigs",
  "turtle",
  "turtles",
  "fish",
  "aquarium",
];

function creationValueHasTerm(value: string, term: string): boolean {
  const normalized = ` ${value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return normalized.includes(` ${term.toLocaleLowerCase()} `);
}

function creationPetSignals(item: PhotoCreationSuggestionItemInput, favoritePets: Set<string>): { signals: number; favorite: number } {
  const values = creationContentValues(item);
  const genericMatches = new Set<string>();
  const favoriteMatches = new Set<string>();
  for (const value of values) {
    for (const term of CREATION_PET_TERMS) {
      if (creationValueHasTerm(value, term)) genericMatches.add(term);
    }
    favoritePets.forEach((pet) => {
      if (pet && creationValueHasTerm(value, pet)) favoriteMatches.add(pet);
    });
  }
  return { signals: genericMatches.size + favoriteMatches.size, favorite: favoriteMatches.size };
}

function creationCropScore(dimensions: { width: number; height: number } | null, kind: PhotoCreationExportPresetKind): number {
  if (!dimensions) return 0.35;
  // Reject zero/negative/NaN dimensions before dividing, so a malformed
  // width/height can't produce Infinity/NaN ratios that skew crop scoring.
  if (!(dimensions.width > 0) || !(dimensions.height > 0)) return 0.35;
  const ratio = dimensions.width / dimensions.height;
  if (kind === "wallpaper") {
    if (ratio < 1.2) return 0.08;
    return clampCreationScore(1 - Math.abs(ratio - (16 / 9)) / 0.9);
  }
  if (kind === "poster") {
    if (ratio >= 1) return 0.18;
    return clampCreationScore(1 - Math.abs(ratio - (2 / 3)) / 0.55);
  }
  return 0.7;
}

function creationTargetAspect(kind: PhotoCreationExportPresetKind): number {
  if (kind === "poster") return 2 / 3;
  if (kind === "wallpaper") return 16 / 9;
  return 1;
}

function formatCreationAspect(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  if (Math.abs(value - 16 / 9) < 0.06) return "16:9";
  if (Math.abs(value - 3 / 2) < 0.06) return "3:2";
  if (Math.abs(value - 4 / 3) < 0.06) return "4:3";
  if (Math.abs(value - 1) < 0.04) return "1:1";
  if (Math.abs(value - 2 / 3) < 0.05) return "2:3";
  if (Math.abs(value - 3 / 4) < 0.05) return "3:4";
  return value > 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`;
}

function creationCropLossPercent(sourceAspect: number, targetAspect: number): number {
  if (!Number.isFinite(sourceAspect) || !Number.isFinite(targetAspect) || sourceAspect <= 0 || targetAspect <= 0) return 100;
  const kept = sourceAspect >= targetAspect ? targetAspect / sourceAspect : sourceAspect / targetAspect;
  return Math.round((1 - clampCreationScore(kept)) * 100);
}

function creationCropPreview(
  dimensions: { width: number; height: number } | null,
  kind: Exclude<PhotoCreationExportPresetKind, "collage">,
): PhotoCreationCropPreview | undefined {
  if (!dimensions) return undefined;
  const sourceAspect = dimensions.width / dimensions.height;
  const targetAspect = creationTargetAspect(kind);
  const cropLossPercent = creationCropLossPercent(sourceAspect, targetAspect);
  const targetLabel = formatCreationAspect(targetAspect);
  const sourceLabel = formatCreationAspect(sourceAspect);
  const safe = cropLossPercent <= (kind === "wallpaper" ? 10 : 14);
  return {
    sourceWidth: Math.round(dimensions.width),
    sourceHeight: Math.round(dimensions.height),
    sourceAspect: Math.round(sourceAspect * 1000) / 1000,
    targetAspect: Math.round(targetAspect * 1000) / 1000,
    cropLossPercent,
    safe,
    label: safe ? `${targetLabel} safe` : `${targetLabel} crop`,
    detail: `${sourceLabel} source · ${cropLossPercent}% trim`,
  };
}

function creationResolutionScore(dimensions: { width: number; height: number } | null, kind: PhotoCreationExportPresetKind): number {
  if (!dimensions) return 0.35;
  if (kind === "poster") {
    return clampCreationScore(Math.min(dimensions.width / 1600, dimensions.height / 2400));
  }
  if (kind === "wallpaper") {
    return clampCreationScore(Math.min(dimensions.width / 1920, dimensions.height / 1080));
  }
  return clampCreationScore(Math.min(dimensions.width / 1200, dimensions.height / 900));
}

function creationSuggestionConfidence(score: number): PhotoCreationExportSuggestion["confidence"] {
  if (score >= 86) return "high";
  if (score >= 68) return "medium";
  return "low";
}

function creationSuggestionReasons(input: {
  item?: PhotoCreationSuggestionItemInput;
  kind: PhotoCreationExportPresetKind;
  count?: number;
  quality: number;
  crop: number;
  resolution: number;
  favoritePeople: number;
  petSignals: number;
  favoritePets: number;
  memoryContext: number;
}): string[] {
  const reasons: string[] = [];
  if (input.count && input.count > 1) reasons.push(`${input.count} photos`);
  if (input.item?.favorite) reasons.push("Favorite");
  if (input.memoryContext > 0) reasons.push("Memory context");
  if (input.favoritePeople > 0) reasons.push("Favorite people");
  if (input.favoritePets > 0) reasons.push("Favorite pets");
  else if (input.petSignals > 0) reasons.push("Pets");
  if (input.quality >= 0.82) reasons.push("High quality");
  if (input.kind === "wallpaper" && input.crop >= 0.75) reasons.push("Landscape crop");
  if (input.kind === "poster" && input.crop >= 0.72) reasons.push("Portrait crop");
  if (input.resolution >= 0.9) reasons.push("High resolution");
  if (!reasons.length) reasons.push("Best current-view match");
  return [...new Set(reasons)].slice(0, 4);
}

function creationSuggestionLabel(kind: PhotoCreationExportPresetKind): string {
  if (kind === "collage") return "Suggested collage";
  if (kind === "poster") return "Suggested poster";
  return "Suggested wallpaper";
}

function creationPreviewUrl(item: PhotoCreationSuggestionItemInput): string | undefined {
  const preview = String(item.previewUrl || "").trim();
  if (preview) return preview;
  const source = String(item.sourceUrl || "").trim();
  return source || undefined;
}

function scoreCreationItem(
  item: PhotoCreationSuggestionItemInput,
  kind: PhotoCreationExportPresetKind,
  favoritePeople: Set<string>,
  favoritePets: Set<string>,
  memoryContextSourcePaths: Set<string>,
): { score: number; quality: number; crop: number; resolution: number; favoritePeople: number; petSignals: number; favoritePets: number; memoryContext: number } | null {
  const sourcePath = String(item.sourcePath || "").trim();
  if (!sourcePath || item.hidden || item.deletedAt || item.missingAt) return null;
  const mediaKind = String(item.mediaKind || "image").toLocaleLowerCase();
  if (mediaKind.includes("video")) return null;
  const dimensions = creationDimensions(item);
  const quality = normalizeCreationQuality(item.bestQuality, item.quality, item.score);
  const crop = creationCropScore(dimensions, kind);
  const resolution = creationResolutionScore(dimensions, kind);
  const people = creationPeople(item);
  const favoritePeopleCount = people.filter((person) => favoritePeople.has(cleanCreationKey(person))).length;
  const petMatches = creationPetSignals(item, favoritePets);
  const memoryContext = memoryContextSourcePaths.has(sourcePath) ? 1 : 0;
  const peopleBonus = Math.min(people.length, 3) * 1.5;
  const score =
    quality * 48 +
    crop * (kind === "collage" ? 6 : 20) +
    resolution * 14 +
    (item.favorite ? 10 : 0) +
    Math.min(favoritePeopleCount, 2) * 7 +
    Math.min(petMatches.signals, 2) * 4 +
    Math.min(petMatches.favorite, 2) * 4 +
    memoryContext * 6 +
    peopleBonus;
  return {
    score: Math.round(score * 100) / 100,
    quality,
    crop,
    resolution,
    favoritePeople: favoritePeopleCount,
    petSignals: petMatches.signals,
    favoritePets: petMatches.favorite,
    memoryContext,
  };
}

function buildSingleCreationSuggestion(
  kind: Exclude<PhotoCreationExportPresetKind, "collage">,
  items: PhotoCreationSuggestionItemInput[],
  favoritePeople: Set<string>,
  favoritePets: Set<string>,
  memoryContextSourcePaths: Set<string>,
): PhotoCreationExportSuggestion | null {
  const ranked = items
    .map((item) => {
      const scored = scoreCreationItem(item, kind, favoritePeople, favoritePets, memoryContextSourcePaths);
      return scored ? { item, ...scored } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score || String(a.item.sourcePath || "").localeCompare(String(b.item.sourcePath || "")));
  const best = ranked[0];
  if (!best?.item.sourcePath) return null;
  const dimensions = creationDimensions(best.item);
  const cropPreview = creationCropPreview(dimensions, kind);
  return {
    kind,
    label: creationSuggestionLabel(kind),
    sourcePaths: [best.item.sourcePath],
    coverPreviewUrl: creationPreviewUrl(best.item),
    cropPreview,
    score: best.score,
    confidence: creationSuggestionConfidence(best.score),
    reasons: creationSuggestionReasons({ ...best, kind }),
    settings: photoCreationExportPresetSettings(kind),
  };
}

function buildCollageCreationSuggestion(
  items: PhotoCreationSuggestionItemInput[],
  favoritePeople: Set<string>,
  favoritePets: Set<string>,
  memoryContextSourcePaths: Set<string>,
  maxItems: number,
): PhotoCreationExportSuggestion | null {
  const ranked = items
    .map((item) => {
      const scored = scoreCreationItem(item, "collage", favoritePeople, favoritePets, memoryContextSourcePaths);
      return scored ? { item, ...scored } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score || String(a.item.sourcePath || "").localeCompare(String(b.item.sourcePath || "")));
  const chosen = ranked.slice(0, Math.max(2, Math.min(8, maxItems)));
  if (chosen.length < 2) return null;
  const score = Math.round((chosen.reduce((total, item) => total + item.score, 0) / chosen.length) * 100) / 100;
  const quality = chosen.reduce((total, item) => total + item.quality, 0) / chosen.length;
  const resolution = chosen.reduce((total, item) => total + item.resolution, 0) / chosen.length;
  const favoritePeopleCount = chosen.reduce((total, item) => total + item.favoritePeople, 0);
  const petSignalCount = chosen.reduce((total, item) => total + item.petSignals, 0);
  const favoritePetCount = chosen.reduce((total, item) => total + item.favoritePets, 0);
  const memoryContextCount = chosen.reduce((total, item) => total + item.memoryContext, 0);
  return {
    kind: "collage",
    label: creationSuggestionLabel("collage"),
    sourcePaths: chosen.map((item) => String(item.item.sourcePath || "")).filter(Boolean),
    score,
    confidence: creationSuggestionConfidence(score),
    reasons: creationSuggestionReasons({
      kind: "collage",
      count: chosen.length,
      quality,
      crop: 0.7,
      resolution,
      favoritePeople: favoritePeopleCount,
      petSignals: petSignalCount,
      favoritePets: favoritePetCount,
      memoryContext: memoryContextCount,
    }),
    settings: photoCreationExportPresetSettings("collage"),
  };
}

export function buildPhotoCreationExportSuggestions(
  items: PhotoCreationSuggestionItemInput[],
  options: PhotoCreationExportSuggestionOptions = {},
): PhotoCreationExportSuggestion[] {
  const favoritePeople = new Set((options.favoritePeople || []).map(cleanCreationKey).filter(Boolean));
  const favoritePets = new Set((options.favoritePets || []).map(cleanCreationKey).filter(Boolean));
  const memoryContextSourcePaths = new Set((options.memoryContextSourcePaths || []).map((sourcePath) => String(sourcePath || "").trim()).filter(Boolean));
  const maxCollageItems = Math.max(2, Math.min(8, Number(options.maxCollageItems) || 6));
  const suggestions = [
    buildSingleCreationSuggestion("wallpaper", items, favoritePeople, favoritePets, memoryContextSourcePaths),
    buildCollageCreationSuggestion(items, favoritePeople, favoritePets, memoryContextSourcePaths, maxCollageItems),
    buildSingleCreationSuggestion("poster", items, favoritePeople, favoritePets, memoryContextSourcePaths),
  ].filter((item): item is PhotoCreationExportSuggestion => Boolean(item));
  return suggestions.slice(0, Math.max(1, Math.min(3, Number(options.limit) || 3)));
}

export function normalizePhotoExportPresetSettings(value: unknown): PhotoExportPresetSettings {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const preserveColorProfile = record.preserveColorProfile === undefined ? true : Boolean(record.preserveColorProfile);
  const renderMaxDimension = cleanNumberText(record.renderMaxDimension, DEFAULT_EXPORT_PRESET_SETTINGS.renderMaxDimension, 0, 20000);
  const renderSizePreset = cleanRenderSizePreset(record.renderSizePreset, renderMaxDimension);
  const targetColorProfile = cleanChoice(record.targetColorProfile, ["source", "srgb", "display-p3", "adobe-rgb", "custom-icc", "none"] as const, preserveColorProfile ? DEFAULT_EXPORT_PRESET_SETTINGS.targetColorProfile : "none");
  return {
    includeMetadata: Boolean(record.includeMetadata),
    includeXmp: Boolean(record.includeXmp),
    includeExistingSidecars: Boolean(record.includeExistingSidecars),
    stripLocation: Boolean(record.stripLocation),
    preserveColorProfile,
    targetColorProfile,
    targetColorProfilePath: targetColorProfile === "custom-icc" ? cleanPathText(record.targetColorProfilePath) : "",
    shareAfterExport: Boolean(record.shareAfterExport),
    layout: cleanChoice(record.layout, ["bundle", "flat"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.layout),
    filenameMode: cleanChoice(record.filenameMode, ["numbered", "original", "template"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.filenameMode),
    filenameTemplate: cleanTemplate(record.filenameTemplate, DEFAULT_EXPORT_PRESET_SETTINGS.filenameTemplate),
    subfolderTemplate: cleanTemplate(record.subfolderTemplate, ""),
    exportVariant: cleanChoice(record.exportVariant, ["original", "rendered"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.exportVariant),
    renderFormat: cleanChoice(record.renderFormat, ["jpeg", "png", "tiff", "heic"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.renderFormat),
    renderQuality: cleanNumberText(record.renderQuality, DEFAULT_EXPORT_PRESET_SETTINGS.renderQuality, 1, 100),
    renderSizePreset,
    renderMaxDimension: photoExportSizePresetMaxDimension(renderSizePreset, renderMaxDimension),
    videoRenderFormat: cleanChoice(record.videoRenderFormat, ["mp4", "mov", "m4v", "webm", "hevc", "prores"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.videoRenderFormat),
    videoRenderQuality: cleanChoice(record.videoRenderQuality, ["small", "medium", "high"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.videoRenderQuality),
    contactSheetFormat: cleanChoice(record.contactSheetFormat, ["pdf", "png", "jpeg"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetFormat),
    contactSheetTitle: cleanText(record.contactSheetTitle, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetTitle),
    contactSheetCaptionPreset: cleanChoice(record.contactSheetCaptionPreset, ["title_date_people", "metadata", "filename"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetCaptionPreset),
    contactSheetPageSize: cleanChoice(record.contactSheetPageSize, ["letter", "a4"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetPageSize),
    contactSheetLayout: cleanChoice(record.contactSheetLayout, ["custom", "full_page", "two_up", "four_up", "wallet"] as const, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetLayout),
    contactSheetColumns: cleanNumberText(record.contactSheetColumns, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetColumns, 1, 8),
    contactSheetThumbnailSize: cleanNumberText(record.contactSheetThumbnailSize, DEFAULT_EXPORT_PRESET_SETTINGS.contactSheetThumbnailSize, 96, 512),
    contactSheetIncludeCaptions: record.contactSheetIncludeCaptions === undefined ? true : Boolean(record.contactSheetIncludeCaptions),
  };
}

function normalizePhotoCreationCropPreview(value: unknown): PhotoCreationCropPreview | undefined {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sourceWidth = Math.round(Number(record.sourceWidth));
  const sourceHeight = Math.round(Number(record.sourceHeight));
  const sourceAspect = Number(record.sourceAspect);
  const targetAspect = Number(record.targetAspect);
  const cropLossPercent = Math.round(Number(record.cropLossPercent));
  if (
    !Number.isFinite(sourceWidth)
    || !Number.isFinite(sourceHeight)
    || sourceWidth <= 0
    || sourceHeight <= 0
    || !Number.isFinite(sourceAspect)
    || !Number.isFinite(targetAspect)
    || sourceAspect <= 0
    || targetAspect <= 0
  ) {
    return undefined;
  }
  return {
    sourceWidth,
    sourceHeight,
    sourceAspect: Math.round(sourceAspect * 1000) / 1000,
    targetAspect: Math.round(targetAspect * 1000) / 1000,
    cropLossPercent: Math.max(0, Math.min(100, Number.isFinite(cropLossPercent) ? cropLossPercent : 100)),
    safe: Boolean(record.safe),
    label: cleanText(record.label, "Crop preview"),
    detail: cleanText(record.detail),
  };
}

function normalizePhotoCreationExportSuggestion(value: unknown): PhotoCreationExportSuggestion | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const kind = cleanChoice(record.kind, ["wallpaper", "collage", "poster"] as const, "wallpaper");
  const sourcePaths = Array.isArray(record.sourcePaths)
    ? [...new Set(record.sourcePaths.map((sourcePath) => String(sourcePath || "").trim()).filter(Boolean))]
    : [];
  if (!sourcePaths.length) return null;
  const score = Number(record.score);
  const coverPreviewUrl = cleanTemplate(record.coverPreviewUrl);
  const cropPreview = normalizePhotoCreationCropPreview(record.cropPreview);
  const reasons = Array.isArray(record.reasons)
    ? [...new Set(record.reasons.map((reason) => cleanText(reason)).filter(Boolean))].slice(0, 4)
    : [];
  return {
    kind,
    label: cleanText(record.label, creationSuggestionLabel(kind)),
    sourcePaths,
    ...(coverPreviewUrl ? { coverPreviewUrl } : {}),
    ...(cropPreview ? { cropPreview } : {}),
    score: Number.isFinite(score) ? Math.round(score * 100) / 100 : 0,
    confidence: cleanChoice(record.confidence, ["high", "medium", "low"] as const, "low"),
    reasons: reasons.length ? reasons : ["Cached library suggestion"],
    settings: normalizePhotoExportPresetSettings(record.settings || photoCreationExportPresetSettings(kind)),
  };
}

export function buildPhotoCreationSuggestionCacheSignature(input: {
  sourceCount?: number | null;
  favoritePeople?: string[];
  favoritePets?: string[];
}): string {
  const sourceCount = Math.max(0, Math.round(Number(input.sourceCount || 0)));
  const favoritePeople = [...new Set((input.favoritePeople || []).map(cleanCreationKey).filter(Boolean))].sort();
  const favoritePets = [...new Set((input.favoritePets || []).map(cleanCreationKey).filter(Boolean))].sort();
  return [
    "v1",
    `sources:${sourceCount}`,
    `people:${favoritePeople.join(",")}`,
    `pets:${favoritePets.join(",")}`,
  ].join("|");
}

export function buildPhotoCreationSuggestionCacheRecord(input: {
  signature: string;
  sourceCount: number;
  suggestions: PhotoCreationExportSuggestion[];
  generatedAt?: string;
}): PhotoCreationSuggestionCache | null {
  const signature = cleanText(input.signature);
  if (!signature) return null;
  const suggestions = (input.suggestions || [])
    .map((suggestion) => normalizePhotoCreationExportSuggestion(suggestion))
    .filter((suggestion): suggestion is PhotoCreationExportSuggestion => Boolean(suggestion))
    .slice(0, 3);
  if (!suggestions.length) return null;
  return {
    version: 1,
    signature,
    generatedAt: cleanText(input.generatedAt, new Date().toISOString()),
    sourceCount: Math.max(0, Math.round(Number(input.sourceCount || 0))),
    suggestions,
  };
}

export function normalizePhotoCreationSuggestionCache(value: unknown, expectedSignature = ""): PhotoCreationSuggestionCache | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const signature = cleanText(record.signature);
  if (!signature || (expectedSignature && signature !== expectedSignature)) return null;
  return buildPhotoCreationSuggestionCacheRecord({
    signature,
    sourceCount: Number(record.sourceCount || 0),
    suggestions: Array.isArray(record.suggestions) ? record.suggestions as PhotoCreationExportSuggestion[] : [],
    generatedAt: cleanText(record.generatedAt, new Date(0).toISOString()),
  });
}

export function photoCreationSuggestionCacheIsFresh(
  cache: PhotoCreationSuggestionCache | null | undefined,
  now: Date | string | number = new Date(),
  maxAgeMs = PHOTO_CREATION_SUGGESTION_CACHE_MAX_AGE_MS,
): boolean {
  if (!cache) return false;
  const generatedAtMs = Date.parse(String(cache.generatedAt || ""));
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(String(now || ""));
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(nowMs)) return false;
  return generatedAtMs <= nowMs && nowMs - generatedAtMs <= Math.max(0, maxAgeMs);
}

export function normalizePhotoCreationSuggestionRefreshState(value: unknown, expectedSignature = ""): PhotoCreationSuggestionRefreshState | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const signature = cleanText(record.signature);
  if (!signature || (expectedSignature && signature !== expectedSignature)) return null;
  const status = cleanChoice(record.status, ["success", "failed"] as const, "success");
  const attempts = Math.max(0, Math.min(20, Math.round(Number(record.attempts || 0))));
  const lastFinishedAt = cleanIsoDateText(record.lastFinishedAt, new Date(0).toISOString());
  const lastSuccessAt = cleanIsoDateText(record.lastSuccessAt);
  const lastFailureAt = cleanIsoDateText(record.lastFailureAt);
  const nextRetryAt = cleanIsoDateText(record.nextRetryAt);
  return {
    version: 1,
    signature,
    status,
    attempts: status === "failed" ? Math.max(1, attempts) : 0,
    lastFinishedAt,
    ...(lastSuccessAt ? { lastSuccessAt } : {}),
    ...(lastFailureAt ? { lastFailureAt } : {}),
    ...(status === "failed" && nextRetryAt ? { nextRetryAt } : {}),
    ...(status === "failed" ? { lastError: cleanErrorText(record.lastError) || "Refresh failed" } : {}),
  };
}

export function photoCreationSuggestionRefreshBackoffMs(
  attempts: number,
  baseMs = PHOTO_CREATION_SUGGESTION_REFRESH_BASE_BACKOFF_MS,
  maxMs = PHOTO_CREATION_SUGGESTION_REFRESH_MAX_BACKOFF_MS,
): number {
  const cleanAttempts = Math.max(1, Math.min(20, Math.round(Number(attempts || 1))));
  const cleanBase = Math.max(1000, Number(baseMs) || PHOTO_CREATION_SUGGESTION_REFRESH_BASE_BACKOFF_MS);
  const cleanMax = Math.max(cleanBase, Number(maxMs) || PHOTO_CREATION_SUGGESTION_REFRESH_MAX_BACKOFF_MS);
  return Math.min(cleanMax, cleanBase * (2 ** Math.min(8, cleanAttempts - 1)));
}

export function photoCreationSuggestionRefreshCanRun(
  state: PhotoCreationSuggestionRefreshState | null | undefined,
  now: Date | string | number = new Date(),
): boolean {
  if (!state || state.status !== "failed" || !state.nextRetryAt) return true;
  const nextRetryAtMs = Date.parse(state.nextRetryAt);
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(String(now || ""));
  if (!Number.isFinite(nextRetryAtMs) || !Number.isFinite(nowMs)) return true;
  return nowMs >= nextRetryAtMs;
}

export function buildPhotoCreationSuggestionRefreshSuccessState(input: {
  signature: string;
  previous?: PhotoCreationSuggestionRefreshState | null;
  now?: Date | string | number;
}): PhotoCreationSuggestionRefreshState | null {
  const signature = cleanText(input.signature);
  if (!signature) return null;
  const nowMs = input.now instanceof Date ? input.now.getTime() : typeof input.now === "number" ? input.now : Date.parse(String(input.now || ""));
  const nowText = new Date(Number.isFinite(nowMs) ? nowMs : Date.now()).toISOString();
  return {
    version: 1,
    signature,
    status: "success",
    attempts: 0,
    lastFinishedAt: nowText,
    lastSuccessAt: nowText,
  };
}

export function buildPhotoCreationSuggestionRefreshFailureState(input: {
  signature: string;
  previous?: PhotoCreationSuggestionRefreshState | null;
  error?: unknown;
  now?: Date | string | number;
}): PhotoCreationSuggestionRefreshState | null {
  const signature = cleanText(input.signature);
  if (!signature) return null;
  const previous = input.previous?.signature === signature ? input.previous : null;
  const attempts = Math.max(1, (previous?.attempts || 0) + 1);
  const nowMs = input.now instanceof Date ? input.now.getTime() : typeof input.now === "number" ? input.now : Date.parse(String(input.now || ""));
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const nowText = new Date(safeNowMs).toISOString();
  const retryAt = new Date(safeNowMs + photoCreationSuggestionRefreshBackoffMs(attempts)).toISOString();
  return {
    version: 1,
    signature,
    status: "failed",
    attempts,
    lastFinishedAt: nowText,
    ...(previous?.lastSuccessAt ? { lastSuccessAt: previous.lastSuccessAt } : {}),
    lastFailureAt: nowText,
    nextRetryAt: retryAt,
    lastError: cleanErrorText(input.error) || "Refresh failed",
  };
}

export function normalizePhotoExportPreset(value: unknown): PhotoExportPreset | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const name = cleanText(record.name);
  if (!name) return null;
  const now = new Date(0).toISOString();
  return {
    id: cleanId(record.id) || `export-preset:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    createdAt: cleanText(record.createdAt, now),
    updatedAt: cleanText(record.updatedAt, cleanText(record.createdAt, now)),
    settings: normalizePhotoExportPresetSettings(record.settings),
  };
}

export function normalizePhotoExportPresetList(values: unknown, limit = 20): PhotoExportPreset[] {
  const parsed = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const presets: PhotoExportPreset[] = [];
  parsed.forEach((value) => {
    const preset = normalizePhotoExportPreset(value);
    if (!preset || seen.has(preset.id)) return;
    seen.add(preset.id);
    presets.push(preset);
  });
  return presets
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function upsertPhotoExportPreset(
  presets: PhotoExportPreset[],
  draft: { id?: string; name: string; settings: PhotoExportPresetSettings; now?: string },
): PhotoExportPreset[] {
  const name = cleanText(draft.name);
  if (!name) return normalizePhotoExportPresetList(presets);
  const now = cleanText(draft.now, new Date().toISOString());
  const requestedId = cleanId(draft.id);
  const normalizedPresets = normalizePhotoExportPresetList(presets);
  const nameKey = name.toLocaleLowerCase();
  const existingById = requestedId ? normalizedPresets.find((preset) => preset.id === requestedId) : undefined;
  const existingByName = normalizedPresets.find((preset) => preset.name.toLocaleLowerCase() === nameKey);
  if (existingById && existingByName && existingByName.id !== existingById.id) {
    return normalizedPresets;
  }
  const existing = existingById || existingByName;
  const next: PhotoExportPreset = {
    id: requestedId || existing?.id || `export-preset:${now.replace(/[^0-9]+/g, "").slice(0, 14)}:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    settings: normalizePhotoExportPresetSettings(draft.settings),
  };
  return normalizePhotoExportPresetList([
    next,
    ...normalizedPresets.filter((preset) => (
      preset.id !== next.id
      && (!existingByName || existingById || preset.name.toLocaleLowerCase() !== nameKey)
    )),
  ]);
}

export function deletePhotoExportPreset(presets: PhotoExportPreset[], presetId: string): PhotoExportPreset[] {
  const id = cleanId(presetId);
  return normalizePhotoExportPresetList(presets.filter((preset) => preset.id !== id));
}

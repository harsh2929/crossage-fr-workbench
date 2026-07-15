export type PhotoSlideshowProjectTheme = "classic" | "fade" | "ken-burns";
export type PhotoSlideshowProjectMusic = "none" | "calm" | "bright" | "cinematic" | "custom";
export type PhotoSlideshowProjectFitMode = "fit" | "fill";
export type PhotoSlideshowTransitionEffect = "auto" | "cut" | "fade" | "dissolve" | "zoom";
export type PhotoSlideshowMotionPreset = "auto" | "still" | "slow-zoom" | "pan-left" | "pan-right";
export type PhotoSlideshowResolvedMotionPreset = Exclude<PhotoSlideshowMotionPreset, "auto"> | "custom";
export type PhotoSlideshowMotionKeyframeCurve = "linear" | "ease" | "smooth" | "cinematic";
export type PhotoSlideshowMotionPathMode = "keyframes" | "bezier";
export type PhotoSlideshowMotionPathPointKey = "start" | "quarter" | "mid" | "threeQuarter" | "end";
export type PhotoSlideshowResolvedTransitionEffect = Exclude<PhotoSlideshowTransitionEffect, "auto">;
export type PhotoSlideshowThemeTimelinePreset = "classic-hold" | "fade-hold" | "ken-burns-drift";
export type PhotoSlideshowThemeTimelineChoice = "auto" | PhotoSlideshowThemeTimelinePreset;
export type PhotoSlideshowTitleCardPalette = "auto" | "midnight" | "paper" | "sunset" | "forest";
export type PhotoSlideshowThemeTemplatePalette = PhotoSlideshowTitleCardPalette;
export type PhotoSlideshowThemeTemplateTypography = "auto" | "clean" | "editorial" | "cinematic";
export type PhotoSlideshowThemeTemplateBackdrop = "auto" | "solid" | "vignette" | "glass" | "blur" | "spotlight" | "film";
export type PhotoSlideshowThemeTemplateLayout = "auto" | "standard" | "gallery" | "cinema" | "minimal" | "poster" | "split" | "immersive";
export type PhotoSlideshowThemeTemplateFrameStyle = "auto" | "none" | "hairline" | "matte" | "accent";
export type PhotoSlideshowThemeTemplateChromeDensity = "auto" | "compact" | "regular" | "spacious";
export type PhotoSlideshowThemeTemplateCaptionPreset = "auto" | "lower-third" | "title-subtitle" | "split-story" | "gallery-labels" | "cinema-bars";
export type PhotoSlideshowThemeTemplateRegionSlot = "primary" | "context" | "counter" | "title" | "source" | "chapter";
export type PhotoSlideshowCaptionPlacement = "auto" | "hidden" | "lower-left" | "lower-center" | "lower-right" | "upper-left" | "upper-center" | "upper-right" | "center";
export type PhotoSlideshowCaptionTypography = "auto" | "clean" | "editorial" | "cinematic" | "bold";
export type PhotoSlideshowCaptionWrap = "auto" | "single-line" | "two-line" | "multi-line";
export type PhotoSlideshowTitleCardLayout = "center" | "lower-third" | "left";
export type PhotoSlideshowTitleCardFontScale = "compact" | "regular" | "large";
export const PHOTO_SLIDESHOW_CAPTION_LIMIT = 8;
export const PHOTO_SLIDESHOW_PROJECT_LIMIT = 30;
export const PHOTO_SLIDESHOW_PROJECTS_KEY = "vintrace.photos.slideshowProjects";
export const PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY = "vintrace.photos.slideshowThemeTemplates";
export const PHOTO_SLIDESHOW_MUSIC_FREQUENCIES: Record<PhotoSlideshowProjectMusic, number> = {
  none: 0,
  calm: 220,
  bright: 440,
  cinematic: 110,
  custom: 0,
};

export type PhotoSlideshowThemeTemplateLibraryExportValue = {
  path?: string;
  targetPath?: string;
  exported?: number;
  templateCount?: number;
  format?: string;
  generatedAt?: string;
  templates?: PhotoSlideshowThemeTemplate[];
};

export type PhotoSlideshowThemeTemplateLibraryImportValue = {
  imported?: number;
  created?: number;
  updated?: number;
  skipped?: number;
  sourcePath?: string;
  format?: string;
  templates?: PhotoSlideshowThemeTemplate[];
};

export interface PhotoSlideshowCaptionRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PhotoSlideshowThemeTemplateRegionMap = Partial<Record<PhotoSlideshowThemeTemplateRegionSlot, PhotoSlideshowCaptionRegion>>;

export interface PhotoSlideshowCaption {
  id?: string;
  captionText: string;
  captionPlacement?: PhotoSlideshowCaptionPlacement;
  captionRegion?: PhotoSlideshowCaptionRegion;
  captionTypography?: PhotoSlideshowCaptionTypography;
  captionWrap?: PhotoSlideshowCaptionWrap;
}

export interface PhotoSlideshowProjectItemLike {
  sourcePath?: string;
  missingAt?: string | null;
}

export interface PhotoSlideshowProjectTimelineItem {
  sourcePath: string;
  durationMs: number;
  motion: PhotoSlideshowMotionPreset;
  keyframes?: PhotoSlideshowMotionKeyframes | null;
  focalX?: number;
  focalY?: number;
  cropZoom?: number;
  captionText?: string;
  captionPlacement?: PhotoSlideshowCaptionPlacement;
  captionRegion?: PhotoSlideshowCaptionRegion;
  captionTypography?: PhotoSlideshowCaptionTypography;
  captionWrap?: PhotoSlideshowCaptionWrap;
  captions?: PhotoSlideshowCaption[];
  transitionEffect?: PhotoSlideshowTransitionEffect;
  transitionDurationMs?: number;
  chapterId?: string;
  chapterTitle?: string;
  chapterNarrative?: string;
}

export interface PhotoSlideshowThemeTimelineItem extends PhotoSlideshowProjectTimelineItem {
  index: number;
  resolvedMotion: PhotoSlideshowResolvedMotionPreset;
  transitionOut: PhotoSlideshowResolvedTransitionEffect;
  transitionDurationMs: number;
  themeCue: string;
}

export interface PhotoSlideshowMotionKeyframes {
  pathMode?: PhotoSlideshowMotionPathMode;
  curve?: PhotoSlideshowMotionKeyframeCurve;
  startX: number;
  startY: number;
  quarterX?: number;
  quarterY?: number;
  midX?: number;
  midY?: number;
  threeQuarterX?: number;
  threeQuarterY?: number;
  endX: number;
  endY: number;
  startZoom: number;
  quarterZoom?: number;
  midZoom?: number;
  threeQuarterZoom?: number;
  endZoom: number;
  bezierControl1X?: number;
  bezierControl1Y?: number;
  bezierControl2X?: number;
  bezierControl2Y?: number;
}

export interface PhotoSlideshowMotionPathPoint {
  key: PhotoSlideshowMotionPathPointKey;
  x: number;
  y: number;
}

export interface PhotoSlideshowMotionPathDraftPoint {
  x: number;
  y: number;
}

export interface PhotoSlideshowBezierControlPoints {
  control1: PhotoSlideshowMotionPathDraftPoint;
  control2: PhotoSlideshowMotionPathDraftPoint;
}

export interface PhotoSlideshowProject {
  id: string;
  name: string;
  title: string;
  sourceLabel: string;
  storyId?: string;
  storyContentSha256?: string;
  storyGenerationSha256?: string;
  sourcePaths: string[];
  theme: PhotoSlideshowProjectTheme;
  themeTimelinePreset: PhotoSlideshowThemeTimelineChoice;
  themeTemplateName: string;
  themeTemplatePalette: PhotoSlideshowThemeTemplatePalette;
  themeTemplateTypography: PhotoSlideshowThemeTemplateTypography;
  themeTemplateBackdrop: PhotoSlideshowThemeTemplateBackdrop;
  themeTemplateLayout: PhotoSlideshowThemeTemplateLayout;
  themeTemplateBackdropIntensity: number;
  themeTemplateStageWidth: number;
  themeTemplateFrameStyle: PhotoSlideshowThemeTemplateFrameStyle;
  themeTemplateChromeDensity: PhotoSlideshowThemeTemplateChromeDensity;
  themeTemplateCaptionPreset: PhotoSlideshowThemeTemplateCaptionPreset;
  themeTemplateRegionMap: PhotoSlideshowThemeTemplateRegionMap;
  music: PhotoSlideshowProjectMusic;
  musicPath: string;
  audioVolume: number;
  audioFadeMs: number;
  audioStartMs: number;
  audioEndMs: number;
  audioPlacementStartSourcePath: string;
  audioPlacementEndSourcePath: string;
  includeTitleCard: boolean;
  titleCardTitle: string;
  titleCardSubtitle: string;
  titleCardDurationMs: number;
  titleCardPalette: PhotoSlideshowTitleCardPalette;
  titleCardLayout: PhotoSlideshowTitleCardLayout;
  titleCardFontScale: PhotoSlideshowTitleCardFontScale;
  titleCardShowFooter: boolean;
  timelineItems: PhotoSlideshowProjectTimelineItem[];
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  intervalMs: number;
  fitMode: PhotoSlideshowProjectFitMode;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoSlideshowThemeTemplate {
  id: string;
  name: string;
  theme: PhotoSlideshowProjectTheme;
  themeTimelinePreset: PhotoSlideshowThemeTimelineChoice;
  themeTemplatePalette: PhotoSlideshowThemeTemplatePalette;
  themeTemplateTypography: PhotoSlideshowThemeTemplateTypography;
  themeTemplateBackdrop: PhotoSlideshowThemeTemplateBackdrop;
  themeTemplateLayout: PhotoSlideshowThemeTemplateLayout;
  themeTemplateBackdropIntensity: number;
  themeTemplateStageWidth: number;
  themeTemplateFrameStyle: PhotoSlideshowThemeTemplateFrameStyle;
  themeTemplateChromeDensity: PhotoSlideshowThemeTemplateChromeDensity;
  themeTemplateCaptionPreset: PhotoSlideshowThemeTemplateCaptionPreset;
  themeTemplateRegionMap: PhotoSlideshowThemeTemplateRegionMap;
  transitionEffect: PhotoSlideshowTransitionEffect;
  transitionDurationMs: number;
  includeTitleCard: boolean;
  titleCardPalette: PhotoSlideshowTitleCardPalette;
  titleCardLayout: PhotoSlideshowTitleCardLayout;
  titleCardFontScale: PhotoSlideshowTitleCardFontScale;
  titleCardShowFooter: boolean;
  createdAt: string;
  updatedAt: string;
}

const THEME_OPTIONS: readonly PhotoSlideshowProjectTheme[] = ["classic", "fade", "ken-burns"];
const MUSIC_OPTIONS: readonly PhotoSlideshowProjectMusic[] = ["none", "calm", "bright", "cinematic", "custom"];
const FIT_OPTIONS: readonly PhotoSlideshowProjectFitMode[] = ["fit", "fill"];
const TRANSITION_OPTIONS: readonly PhotoSlideshowTransitionEffect[] = ["auto", "cut", "fade", "dissolve", "zoom"];
const MOTION_OPTIONS: readonly PhotoSlideshowMotionPreset[] = ["auto", "still", "slow-zoom", "pan-left", "pan-right"];
const MOTION_KEYFRAME_CURVE_OPTIONS: readonly PhotoSlideshowMotionKeyframeCurve[] = ["linear", "ease", "smooth", "cinematic"];
const THEME_TIMELINE_OPTIONS: readonly PhotoSlideshowThemeTimelineChoice[] = ["auto", "classic-hold", "fade-hold", "ken-burns-drift"];
const TITLE_CARD_PALETTE_OPTIONS: readonly PhotoSlideshowTitleCardPalette[] = ["auto", "midnight", "paper", "sunset", "forest"];
const THEME_TEMPLATE_PALETTE_OPTIONS: readonly PhotoSlideshowThemeTemplatePalette[] = TITLE_CARD_PALETTE_OPTIONS;
const THEME_TEMPLATE_TYPOGRAPHY_OPTIONS: readonly PhotoSlideshowThemeTemplateTypography[] = ["auto", "clean", "editorial", "cinematic"];
const THEME_TEMPLATE_BACKDROP_OPTIONS: readonly PhotoSlideshowThemeTemplateBackdrop[] = ["auto", "solid", "vignette", "glass", "blur", "spotlight", "film"];
const THEME_TEMPLATE_LAYOUT_OPTIONS: readonly PhotoSlideshowThemeTemplateLayout[] = ["auto", "standard", "gallery", "cinema", "minimal", "poster", "split", "immersive"];
const THEME_TEMPLATE_FRAME_STYLE_OPTIONS: readonly PhotoSlideshowThemeTemplateFrameStyle[] = ["auto", "none", "hairline", "matte", "accent"];
const THEME_TEMPLATE_CHROME_DENSITY_OPTIONS: readonly PhotoSlideshowThemeTemplateChromeDensity[] = ["auto", "compact", "regular", "spacious"];
const THEME_TEMPLATE_CAPTION_PRESET_OPTIONS: readonly PhotoSlideshowThemeTemplateCaptionPreset[] = ["auto", "lower-third", "title-subtitle", "split-story", "gallery-labels", "cinema-bars"];
const THEME_TEMPLATE_REGION_SLOT_OPTIONS: readonly PhotoSlideshowThemeTemplateRegionSlot[] = ["primary", "context", "counter", "title", "source", "chapter"];
const CAPTION_PLACEMENT_OPTIONS: readonly PhotoSlideshowCaptionPlacement[] = ["auto", "hidden", "lower-left", "lower-center", "lower-right", "upper-left", "upper-center", "upper-right", "center"];
const CAPTION_TYPOGRAPHY_OPTIONS: readonly PhotoSlideshowCaptionTypography[] = ["auto", "clean", "editorial", "cinematic", "bold"];
const CAPTION_WRAP_OPTIONS: readonly PhotoSlideshowCaptionWrap[] = ["auto", "single-line", "two-line", "multi-line"];
const TITLE_CARD_LAYOUT_OPTIONS: readonly PhotoSlideshowTitleCardLayout[] = ["center", "lower-third", "left"];
const TITLE_CARD_FONT_SCALE_OPTIONS: readonly PhotoSlideshowTitleCardFontScale[] = ["compact", "regular", "large"];
const MOTION_PATH_POINT_KEYS: readonly PhotoSlideshowMotionPathPointKey[] = ["start", "quarter", "mid", "threeQuarter", "end"];
const MOTION_PATH_POINT_TIMES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

function cleanText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function cleanCaptionText(value: unknown): string {
  return cleanText(value, "").slice(0, 180);
}

function cleanId(value: unknown): string {
  return String(value ?? "").trim().replace(/[^a-zA-Z0-9:_-]+/g, "-").slice(0, 128);
}

function cleanChoice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return choices.includes(value as T) ? value as T : fallback;
}

function cleanInterval(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1500, Math.min(15000, Math.round(parsed))) : 4500;
}

function cleanAudioVolume(value: unknown): number {
  let parsed = Number(value);
  if (!Number.isFinite(parsed)) parsed = 1;
  if (parsed > 1) parsed /= 100;
  return Math.max(0, Math.min(1, parsed));
}

function cleanAudioFadeMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10000, Math.round(parsed))) : 0;
}

function cleanAudioTrimMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(3_600_000, Math.round(parsed))) : 0;
}

function cleanTitleCardDurationMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1500, Math.min(15000, Math.round(parsed))) : 3000;
}

function cleanSlideDurationMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(500, Math.min(60000, Math.round(parsed))) : fallback;
}

function cleanTransitionDurationMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(3000, Math.round(parsed))) : 650;
}

function cleanPercent(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.round(parsed))) : fallback;
}

function cleanCropZoom(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3, Math.round(parsed * 1000) / 1000)) : 1;
}

function cleanCaptionPlacement(value: unknown): PhotoSlideshowCaptionPlacement {
  const placement = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (placement === "none" || placement === "off" || placement === "hide") return "hidden";
  if (placement === "bottom" || placement === "lower" || placement === "lower-third") return "lower-left";
  if (placement === "top" || placement === "upper" || placement === "upper-third") return "upper-left";
  if (placement === "left" || placement === "start" || placement === "bottom-left") return "lower-left";
  if (placement === "right" || placement === "end") return "lower-right";
  if (placement === "bottom-center") return "lower-center";
  if (placement === "bottom-right") return "lower-right";
  if (placement === "top-left") return "upper-left";
  if (placement === "top-center") return "upper-center";
  if (placement === "top-right") return "upper-right";
  if (placement === "middle" || placement === "center-center") return "center";
  return CAPTION_PLACEMENT_OPTIONS.includes(placement as PhotoSlideshowCaptionPlacement) ? placement as PhotoSlideshowCaptionPlacement : "auto";
}

function cleanCaptionTypography(value: unknown): PhotoSlideshowCaptionTypography {
  const typography = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (typography === "plain" || typography === "sans" || typography === "sans-serif" || typography === "default") return "clean";
  if (typography === "serif" || typography === "italic" || typography === "story") return "editorial";
  if (typography === "movie" || typography === "film") return "cinematic";
  if (typography === "strong" || typography === "heavy" || typography === "large") return "bold";
  return CAPTION_TYPOGRAPHY_OPTIONS.includes(typography as PhotoSlideshowCaptionTypography) ? typography as PhotoSlideshowCaptionTypography : "auto";
}

function cleanCaptionWrap(value: unknown): PhotoSlideshowCaptionWrap {
  const wrap = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (wrap === "single" || wrap === "singleline" || wrap === "one-line" || wrap === "nowrap" || wrap === "no-wrap" || wrap === "no" || wrap === "false") return "single-line";
  if (wrap === "two" || wrap === "2" || wrap === "2-line" || wrap === "two-lines") return "two-line";
  if (wrap === "multi" || wrap === "multiline" || wrap === "multi-lines" || wrap === "wrap" || wrap === "line-wrap" || wrap === "balance" || wrap === "balanced" || wrap === "yes" || wrap === "true") return "multi-line";
  return CAPTION_WRAP_OPTIONS.includes(wrap as PhotoSlideshowCaptionWrap) ? wrap as PhotoSlideshowCaptionWrap : "auto";
}

function cleanThemeTemplateCaptionPreset(value: unknown): PhotoSlideshowThemeTemplateCaptionPreset {
  const preset = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (preset === "lower" || preset === "lowerthird" || preset === "caption-bar") return "lower-third";
  if (preset === "title" || preset === "title-sub" || preset === "headline-subtitle") return "title-subtitle";
  if (preset === "split" || preset === "story-split" || preset === "split-notes") return "split-story";
  if (preset === "gallery" || preset === "gallery-tags" || preset === "labels") return "gallery-labels";
  if (preset === "cinema" || preset === "letterbox" || preset === "letterbox-bars") return "cinema-bars";
  return THEME_TEMPLATE_CAPTION_PRESET_OPTIONS.includes(preset as PhotoSlideshowThemeTemplateCaptionPreset)
    ? preset as PhotoSlideshowThemeTemplateCaptionPreset
    : "auto";
}

function cleanThemeTemplateRegionSlot(value: unknown): PhotoSlideshowThemeTemplateRegionSlot | null {
  const slot = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!slot) return null;
  if (slot === "caption" || slot === "main" || slot === "body" || slot === "primary-caption") return "primary";
  if (slot === "subtitle" || slot === "subhead" || slot === "collection" || slot === "label" || slot === "source-label") return "context";
  if (slot === "count" || slot === "page" || slot === "number" || slot === "slide-number" || slot === "slide-counter") return "counter";
  if (slot === "heading" || slot === "headline" || slot === "project-title") return "title";
  if (slot === "origin" || slot === "album" || slot === "memory" || slot === "source-name") return "source";
  if (slot === "slide" || slot === "chapter-label" || slot === "cue") return "chapter";
  return THEME_TEMPLATE_REGION_SLOT_OPTIONS.includes(slot as PhotoSlideshowThemeTemplateRegionSlot)
    ? slot as PhotoSlideshowThemeTemplateRegionSlot
    : null;
}

export function cleanPhotoSlideshowThemeTemplateRegionMap(value: unknown): PhotoSlideshowThemeTemplateRegionMap {
  const map: PhotoSlideshowThemeTemplateRegionMap = {};
  const assign = (slotValue: unknown, regionValue: unknown) => {
    const slot = cleanThemeTemplateRegionSlot(slotValue);
    if (!slot) return;
    const region = cleanCaptionRegion(regionValue);
    if (region) map[slot] = region;
  };
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        assign(record.slot ?? record.id ?? record.key ?? record.name ?? record.regionSlot, record.region ?? record.captionRegion ?? record.bounds ?? record.box ?? record.frame ?? record.rect ?? record);
      }
    });
    return map;
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record) return map;
  THEME_TEMPLATE_REGION_SLOT_OPTIONS.forEach((slot) => assign(slot, record[slot]));
  Object.entries(record).forEach(([key, regionValue]) => assign(key, regionValue));
  return map;
}

export function photoSlideshowResolvedCaptionPreset(
  preset: PhotoSlideshowThemeTemplateCaptionPreset | string,
  layout: PhotoSlideshowThemeTemplateLayout | string = "auto",
): Exclude<PhotoSlideshowThemeTemplateCaptionPreset, "auto"> {
  const cleanPreset = cleanThemeTemplateCaptionPreset(preset);
  if (cleanPreset !== "auto") return cleanPreset;
  const cleanLayout = cleanChoice(layout, THEME_TEMPLATE_LAYOUT_OPTIONS, "auto");
  if (cleanLayout === "poster") return "title-subtitle";
  if (cleanLayout === "split") return "split-story";
  if (cleanLayout === "gallery") return "gallery-labels";
  if (cleanLayout === "cinema" || cleanLayout === "immersive") return "cinema-bars";
  return "lower-third";
}

export function photoSlideshowDefaultRegionMap(
  preset: PhotoSlideshowThemeTemplateCaptionPreset | string,
  layout: PhotoSlideshowThemeTemplateLayout | string = "auto",
): PhotoSlideshowThemeTemplateRegionMap {
  const resolvedPreset = photoSlideshowResolvedCaptionPreset(preset, layout);
  const defaults: Record<Exclude<PhotoSlideshowThemeTemplateCaptionPreset, "auto">, PhotoSlideshowThemeTemplateRegionMap> = {
    "title-subtitle": {
      title: { x: 2, y: 3, width: 58, height: 10 },
      source: { x: 66, y: 3, width: 32, height: 8 },
      chapter: { x: 2, y: 90, width: 62, height: 8 },
      primary: { x: 8, y: 10, width: 56, height: 14 },
      context: { x: 8, y: 78, width: 54, height: 9 },
      counter: { x: 75, y: 80, width: 17, height: 7 },
    },
    "split-story": {
      title: { x: 2, y: 3, width: 46, height: 10 },
      source: { x: 58, y: 3, width: 36, height: 8 },
      chapter: { x: 7, y: 88, width: 55, height: 8 },
      primary: { x: 7, y: 66, width: 38, height: 18 },
      context: { x: 58, y: 13, width: 34, height: 10 },
      counter: { x: 72, y: 82, width: 20, height: 7 },
    },
    "gallery-labels": {
      title: { x: 2, y: 3, width: 50, height: 8 },
      source: { x: 6, y: 8, width: 34, height: 7 },
      chapter: { x: 6, y: 90, width: 52, height: 7 },
      primary: { x: 6, y: 80, width: 38, height: 8 },
      context: { x: 6, y: 8, width: 34, height: 7 },
      counter: { x: 76, y: 82, width: 18, height: 7 },
    },
    "cinema-bars": {
      title: { x: 2, y: 3, width: 58, height: 8 },
      source: { x: 62, y: 3, width: 32, height: 8 },
      chapter: { x: 2, y: 89, width: 60, height: 8 },
      primary: { x: 18, y: 76, width: 64, height: 10 },
      context: { x: 24, y: 8, width: 52, height: 8 },
      counter: { x: 80, y: 8, width: 14, height: 8 },
    },
    "lower-third": {
      title: { x: 2, y: 3, width: 58, height: 9 },
      source: { x: 64, y: 3, width: 32, height: 8 },
      chapter: { x: 2, y: 90, width: 62, height: 8 },
      primary: { x: 6, y: 72, width: 54, height: 14 },
      context: { x: 64, y: 77, width: 30, height: 8 },
      counter: { x: 80, y: 8, width: 14, height: 8 },
    },
  };
  return { ...defaults[resolvedPreset] };
}

export function photoSlideshowResolvedRegionMap(
  preset: PhotoSlideshowThemeTemplateCaptionPreset | string,
  layout: PhotoSlideshowThemeTemplateLayout | string = "auto",
  regionMap?: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown> | null,
): PhotoSlideshowThemeTemplateRegionMap {
  return {
    ...photoSlideshowDefaultRegionMap(preset, layout),
    ...cleanPhotoSlideshowThemeTemplateRegionMap(regionMap),
  };
}

function cleanCaptionRegion(value: unknown): PhotoSlideshowCaptionRegion | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const pair = Array.isArray(value) ? value : null;
  const rawX = record?.x ?? record?.left ?? record?.l ?? pair?.[0];
  const rawY = record?.y ?? record?.top ?? record?.t ?? pair?.[1];
  const rawRight = record?.right ?? record?.r;
  const rawBottom = record?.bottom ?? record?.b;
  const parsedX = Number(rawX);
  const parsedY = Number(rawY);
  let parsedWidth = Number(record?.width ?? record?.w ?? pair?.[2]);
  let parsedHeight = Number(record?.height ?? record?.h ?? pair?.[3]);
  const parsedRight = Number(rawRight);
  const parsedBottom = Number(rawBottom);
  if (!Number.isFinite(parsedWidth) && Number.isFinite(parsedRight) && Number.isFinite(parsedX)) parsedWidth = parsedRight - parsedX;
  if (!Number.isFinite(parsedHeight) && Number.isFinite(parsedBottom) && Number.isFinite(parsedY)) parsedHeight = parsedBottom - parsedY;
  if (!Number.isFinite(parsedX) || !Number.isFinite(parsedY) || !Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
    return null;
  }
  const maxValue = Math.max(Math.abs(parsedX), Math.abs(parsedY), Math.abs(parsedWidth), Math.abs(parsedHeight));
  const unit = String(record?.unit ?? record?.units ?? record?.coordinateUnit ?? record?.coordinateSpace ?? "").toLowerCase();
  const scale = unit.includes("normal") || unit.includes("relative") || unit === "fraction" || maxValue <= 1.5 ? 100 : 1;
  const left = Math.max(0, Math.min(100, parsedX * scale));
  const top = Math.max(0, Math.min(100, parsedY * scale));
  const right = Math.max(left, Math.min(100, (parsedX + parsedWidth) * scale));
  const bottom = Math.max(top, Math.min(100, (parsedY + parsedHeight) * scale));
  const width = right - left;
  const height = bottom - top;
  if (width < 1 || height < 1) return null;
  return {
    x: Math.round(left * 10) / 10,
    y: Math.round(top * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
  };
}

function cleanCaptionId(value: unknown, index: number): string {
  const text = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]/g, "");
  return (text || `caption-${index + 2}`).slice(0, 40);
}

function cleanCaption(value: unknown, index: number): PhotoSlideshowCaption | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const textValue = typeof value === "string" ? value : record.captionText ?? record.caption ?? record.text ?? record.title ?? record.label;
  const captionText = cleanCaptionText(textValue);
  if (!captionText) return null;
  const captionPlacement = cleanCaptionPlacement(
    record.captionPlacement ?? record.captionPosition ?? record.captionPlace ?? record.captionAnchor ?? record.placement ?? record.position ?? (typeof record.captionRegion === "string" ? record.captionRegion : undefined)
  );
  const captionRegion = cleanCaptionRegion(record.captionRegion ?? record.captionBounds ?? record.captionBox ?? record.captionFrame ?? record.captionRect ?? record.region);
  const captionTypography = cleanCaptionTypography(record.captionTypography ?? record.captionType ?? record.captionFont ?? record.captionStyle ?? record.captionFontScale ?? record.captionScale ?? record.captionSize ?? record.typography);
  const captionWrap = cleanCaptionWrap(record.captionWrap ?? record.captionWrapMode ?? record.captionWrapping ?? record.captionTextWrap ?? record.captionLines ?? record.captionLineMode ?? record.captionFlow ?? record.wrap);
  return {
    id: cleanCaptionId(record.id ?? record.captionId ?? record.key, index),
    captionText,
    ...(captionPlacement !== "auto" ? { captionPlacement } : {}),
    ...(captionRegion ? { captionRegion } : {}),
    ...(captionTypography !== "auto" ? { captionTypography } : {}),
    ...(captionWrap !== "auto" ? { captionWrap } : {}),
  };
}

function cleanCaptions(value: unknown): PhotoSlideshowCaption[] {
  const raw = Array.isArray(value) ? value : [];
  const blocks: PhotoSlideshowCaption[] = [];
  raw.forEach((item, index) => {
    if (blocks.length >= PHOTO_SLIDESHOW_CAPTION_LIMIT) return;
    const block = cleanCaption(item, index);
    if (block) blocks.push(block);
  });
  return blocks;
}

function cleanTemplateBackdropIntensity(value: unknown): number {
  return cleanPercent(value, 100);
}

function cleanTemplateStageWidth(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(50, Math.min(100, Math.round(parsed))) : 100;
}

function cleanZoom(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(1.5, Math.round(parsed * 1000) / 1000)) : fallback;
}

function cleanMotionKeyframeCurve(value: unknown): PhotoSlideshowMotionKeyframeCurve | null {
  const curve = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!curve) return null;
  if (curve === "ease-in-out" || curve === "eased") return "ease";
  if (curve === "bezier" || curve === "spline" || curve === "soft") return "smooth";
  if (curve === "cinema" || curve === "dramatic") return "cinematic";
  return MOTION_KEYFRAME_CURVE_OPTIONS.includes(curve as PhotoSlideshowMotionKeyframeCurve) ? curve as PhotoSlideshowMotionKeyframeCurve : null;
}

function cleanMotionPathMode(value: unknown): PhotoSlideshowMotionPathMode | null {
  const mode = String(value ?? "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!mode) return null;
  if (["bezier", "cubic", "curve", "handles", "handle"].includes(mode)) return "bezier";
  if (["keyframes", "anchors", "points", "samples", "sampled"].includes(mode)) return "keyframes";
  return null;
}

function cubicBezierValue(start: number, control1: number, control2: number, end: number, t: number): number {
  const inverse = 1 - t;
  return (inverse ** 3 * start)
    + (3 * inverse * inverse * t * control1)
    + (3 * inverse * t * t * control2)
    + (t ** 3 * end);
}

export function photoSlideshowCubicBezierPathPoint(
  start: PhotoSlideshowMotionPathDraftPoint,
  control1: PhotoSlideshowMotionPathDraftPoint,
  control2: PhotoSlideshowMotionPathDraftPoint,
  end: PhotoSlideshowMotionPathDraftPoint,
  t: number,
): PhotoSlideshowMotionPathDraftPoint {
  const progress = Math.max(0, Math.min(1, Number(t)));
  return {
    x: cleanPercent(cubicBezierValue(start.x, control1.x, control2.x, end.x, progress), start.x),
    y: cleanPercent(cubicBezierValue(start.y, control1.y, control2.y, end.y, progress), start.y),
  };
}

function firstMotionPathPointValue(record: Record<string, unknown>, nestedKey: string, axis: "x" | "y", keys: string[]): unknown {
  const nested = record[nestedKey];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const nestedRecord = nested as Record<string, unknown>;
    if (axis in nestedRecord) return nestedRecord[axis];
    if (axis === "x" && "left" in nestedRecord) return nestedRecord.left;
    if (axis === "y" && "top" in nestedRecord) return nestedRecord.top;
  }
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function cleanBezierControlPoints(record: Record<string, unknown>, start: PhotoSlideshowMotionPathDraftPoint, end: PhotoSlideshowMotionPathDraftPoint): PhotoSlideshowBezierControlPoints {
  const fallbackControl1 = {
    x: Math.round(start.x + ((end.x - start.x) / 3)),
    y: Math.round(start.y + ((end.y - start.y) / 3)),
  };
  const fallbackControl2 = {
    x: Math.round(start.x + (((end.x - start.x) * 2) / 3)),
    y: Math.round(start.y + (((end.y - start.y) * 2) / 3)),
  };
  return {
    control1: {
      x: cleanPercent(firstMotionPathPointValue(record, "control1", "x", ["bezierControl1X", "control1X", "c1X", "handle1X"]), fallbackControl1.x),
      y: cleanPercent(firstMotionPathPointValue(record, "control1", "y", ["bezierControl1Y", "control1Y", "c1Y", "handle1Y"]), fallbackControl1.y),
    },
    control2: {
      x: cleanPercent(firstMotionPathPointValue(record, "control2", "x", ["bezierControl2X", "control2X", "c2X", "handle2X"]), fallbackControl2.x),
      y: cleanPercent(firstMotionPathPointValue(record, "control2", "y", ["bezierControl2Y", "control2Y", "c2Y", "handle2Y"]), fallbackControl2.y),
    },
  };
}

export function cleanPhotoSlideshowMotionKeyframes(value: unknown): PhotoSlideshowMotionKeyframes | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!record) return null;
  const pathMode = cleanMotionPathMode(record.pathMode ?? record.pathType ?? record.motionPathMode);
  const hasBezierControls = [
    "bezierControl1X",
    "bezierControl1Y",
    "bezierControl2X",
    "bezierControl2Y",
    "control1X",
    "control1Y",
    "control2X",
    "control2Y",
    "c1X",
    "c1Y",
    "c2X",
    "c2Y",
    "handle1X",
    "handle1Y",
    "handle2X",
    "handle2Y",
  ].some((key) => key in record)
    || (record.control1 && typeof record.control1 === "object" && !Array.isArray(record.control1))
    || (record.control2 && typeof record.control2 === "object" && !Array.isArray(record.control2));
  const hasQuarterPoint = [
    "quarterX",
    "quarterXPercent",
    "q1X",
    "firstMidX",
    "quarterY",
    "quarterYPercent",
    "q1Y",
    "firstMidY",
    "quarterZoom",
    "q1Zoom",
    "zoomQuarter",
    "scaleQuarter",
  ].some((key) => key in record);
  const hasMidpoint = [
    "midX",
    "midXPercent",
    "middleX",
    "centerX",
    "midY",
    "midYPercent",
    "middleY",
    "centerY",
    "midZoom",
    "middleZoom",
    "zoomMid",
    "scaleMid",
  ].some((key) => key in record);
  const hasThreeQuarterPoint = [
    "threeQuarterX",
    "threeQuarterXPercent",
    "q3X",
    "lastMidX",
    "threeQuarterY",
    "threeQuarterYPercent",
    "q3Y",
    "lastMidY",
    "threeQuarterZoom",
    "q3Zoom",
    "zoomThreeQuarter",
    "scaleThreeQuarter",
  ].some((key) => key in record);
  const keyframes: PhotoSlideshowMotionKeyframes = {
    startX: cleanPercent(record.startX ?? record.startXPercent ?? record.fromX ?? record.x1, 50),
    startY: cleanPercent(record.startY ?? record.startYPercent ?? record.fromY ?? record.y1, 50),
    endX: cleanPercent(record.endX ?? record.endXPercent ?? record.toX ?? record.x2, 50),
    endY: cleanPercent(record.endY ?? record.endYPercent ?? record.toY ?? record.y2, 50),
    startZoom: cleanZoom(record.startZoom ?? record.fromZoom ?? record.zoomStart ?? record.scaleStart, 1),
    endZoom: cleanZoom(record.endZoom ?? record.toZoom ?? record.zoomEnd ?? record.scaleEnd, 1.08),
  };
  if (pathMode) keyframes.pathMode = pathMode;
  if (hasQuarterPoint) {
    keyframes.quarterX = cleanPercent(record.quarterX ?? record.quarterXPercent ?? record.q1X ?? record.firstMidX, 50);
    keyframes.quarterY = cleanPercent(record.quarterY ?? record.quarterYPercent ?? record.q1Y ?? record.firstMidY, 50);
    keyframes.quarterZoom = cleanZoom(record.quarterZoom ?? record.q1Zoom ?? record.zoomQuarter ?? record.scaleQuarter, 1.04);
  }
  if (hasMidpoint) {
    keyframes.midX = cleanPercent(record.midX ?? record.midXPercent ?? record.middleX ?? record.centerX, 50);
    keyframes.midY = cleanPercent(record.midY ?? record.midYPercent ?? record.middleY ?? record.centerY, 50);
    keyframes.midZoom = cleanZoom(record.midZoom ?? record.middleZoom ?? record.zoomMid ?? record.scaleMid, 1.08);
  }
  if (hasThreeQuarterPoint) {
    keyframes.threeQuarterX = cleanPercent(record.threeQuarterX ?? record.threeQuarterXPercent ?? record.q3X ?? record.lastMidX, 50);
    keyframes.threeQuarterY = cleanPercent(record.threeQuarterY ?? record.threeQuarterYPercent ?? record.q3Y ?? record.lastMidY, 50);
    keyframes.threeQuarterZoom = cleanZoom(record.threeQuarterZoom ?? record.q3Zoom ?? record.zoomThreeQuarter ?? record.scaleThreeQuarter, 1.08);
  }
  const curve = cleanMotionKeyframeCurve(record.curve ?? record.keyframeCurve ?? record.motionCurve ?? record.easing);
  if (curve) keyframes.curve = curve;
  if (pathMode === "bezier" || hasBezierControls) {
    const controls = cleanBezierControlPoints(record, { x: keyframes.startX, y: keyframes.startY }, { x: keyframes.endX, y: keyframes.endY });
    const quarter = photoSlideshowCubicBezierPathPoint({ x: keyframes.startX, y: keyframes.startY }, controls.control1, controls.control2, { x: keyframes.endX, y: keyframes.endY }, 0.25);
    const mid = photoSlideshowCubicBezierPathPoint({ x: keyframes.startX, y: keyframes.startY }, controls.control1, controls.control2, { x: keyframes.endX, y: keyframes.endY }, 0.5);
    const threeQuarter = photoSlideshowCubicBezierPathPoint({ x: keyframes.startX, y: keyframes.startY }, controls.control1, controls.control2, { x: keyframes.endX, y: keyframes.endY }, 0.75);
    keyframes.pathMode = "bezier";
    keyframes.bezierControl1X = controls.control1.x;
    keyframes.bezierControl1Y = controls.control1.y;
    keyframes.bezierControl2X = controls.control2.x;
    keyframes.bezierControl2Y = controls.control2.y;
    keyframes.quarterX = quarter.x;
    keyframes.quarterY = quarter.y;
    keyframes.midX = mid.x;
    keyframes.midY = mid.y;
    keyframes.threeQuarterX = threeQuarter.x;
    keyframes.threeQuarterY = threeQuarter.y;
  }
  return keyframes;
}

function cleanMotionPathPoint(value: unknown, fallback: PhotoSlideshowMotionPathDraftPoint): PhotoSlideshowMotionPathDraftPoint {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const pair = Array.isArray(value) ? value : null;
  return {
    x: cleanPercent(record?.x ?? record?.left ?? record?.cx ?? pair?.[0], fallback.x),
    y: cleanPercent(record?.y ?? record?.top ?? record?.cy ?? pair?.[1], fallback.y),
  };
}

export function photoSlideshowMotionPathPointsFromKeyframes(
  keyframes?: PhotoSlideshowMotionKeyframes | null,
): PhotoSlideshowMotionPathPoint[] {
  const clean = cleanPhotoSlideshowMotionKeyframes(keyframes);
  const startX = clean?.startX ?? 50;
  const startY = clean?.startY ?? 50;
  const endX = clean?.endX ?? 50;
  const endY = clean?.endY ?? 50;
  const midX = clean?.midX ?? Math.round((startX + endX) / 2);
  const midY = clean?.midY ?? Math.round((startY + endY) / 2);
  return [
    { key: "start", x: startX, y: startY },
    {
      key: "quarter",
      x: clean?.quarterX ?? Math.round((startX + midX) / 2),
      y: clean?.quarterY ?? Math.round((startY + midY) / 2),
    },
    { key: "mid", x: midX, y: midY },
    {
      key: "threeQuarter",
      x: clean?.threeQuarterX ?? Math.round((midX + endX) / 2),
      y: clean?.threeQuarterY ?? Math.round((midY + endY) / 2),
    },
    { key: "end", x: endX, y: endY },
  ];
}

export function photoSlideshowBezierControlPointsFromKeyframes(
  keyframes?: PhotoSlideshowMotionKeyframes | null,
): PhotoSlideshowBezierControlPoints {
  const clean = cleanPhotoSlideshowMotionKeyframes(keyframes);
  const start = { x: clean?.startX ?? 50, y: clean?.startY ?? 50 };
  const end = { x: clean?.endX ?? 50, y: clean?.endY ?? 50 };
  return {
    control1: {
      x: clean?.bezierControl1X ?? Math.round(start.x + ((end.x - start.x) / 3)),
      y: clean?.bezierControl1Y ?? Math.round(start.y + ((end.y - start.y) / 3)),
    },
    control2: {
      x: clean?.bezierControl2X ?? Math.round(start.x + (((end.x - start.x) * 2) / 3)),
      y: clean?.bezierControl2Y ?? Math.round(start.y + (((end.y - start.y) * 2) / 3)),
    },
  };
}

export function samplePhotoSlideshowFreehandPathPoints(value: unknown): PhotoSlideshowMotionPathPoint[] {
  const raw = Array.isArray(value) ? value : [];
  const cleaned = raw.map((point) => cleanMotionPathPoint(point, { x: 50, y: 50 }));
  if (!cleaned.length) {
    return MOTION_PATH_POINT_KEYS.map((key) => ({ key, x: 50, y: 50 }));
  }
  if (cleaned.length === 1) {
    const point = cleaned[0];
    return MOTION_PATH_POINT_KEYS.map((key) => ({ key, x: point.x, y: point.y }));
  }

  const distances = [0];
  for (let index = 1; index < cleaned.length; index += 1) {
    const previous = cleaned[index - 1];
    const current = cleaned[index];
    distances.push(distances[index - 1] + Math.hypot(current.x - previous.x, current.y - previous.y));
  }
  const total = distances[distances.length - 1];
  if (!total) {
    const point = cleaned[0];
    return MOTION_PATH_POINT_KEYS.map((key) => ({ key, x: point.x, y: point.y }));
  }

  return MOTION_PATH_POINT_KEYS.map((key, index) => {
    const target = total * MOTION_PATH_POINT_TIMES[index];
    let segment = 1;
    while (segment < distances.length - 1 && distances[segment] < target) segment += 1;
    const startDistance = distances[segment - 1];
    const endDistance = distances[segment];
    const span = Math.max(0.001, endDistance - startDistance);
    const progress = Math.max(0, Math.min(1, (target - startDistance) / span));
    const start = cleaned[segment - 1];
    const end = cleaned[segment];
    return {
      key,
      x: cleanPercent(start.x + ((end.x - start.x) * progress), start.x),
      y: cleanPercent(start.y + ((end.y - start.y) * progress), start.y),
    };
  });
}

export function photoSlideshowMotionKeyframesWithBezierControls(
  keyframes: PhotoSlideshowMotionKeyframes | null | undefined,
  controls: Partial<PhotoSlideshowBezierControlPoints>,
): PhotoSlideshowMotionKeyframes {
  const base = cleanPhotoSlideshowMotionKeyframes(keyframes) || {
    startX: 50,
    startY: 50,
    endX: 50,
    endY: 50,
    startZoom: 1,
    endZoom: 1.08,
  };
  const currentControls = photoSlideshowBezierControlPointsFromKeyframes(base);
  const control1 = cleanMotionPathPoint(controls.control1, currentControls.control1);
  const control2 = cleanMotionPathPoint(controls.control2, currentControls.control2);
  return cleanPhotoSlideshowMotionKeyframes({
    ...base,
    pathMode: "bezier",
    bezierControl1X: control1.x,
    bezierControl1Y: control1.y,
    bezierControl2X: control2.x,
    bezierControl2Y: control2.y,
  }) as PhotoSlideshowMotionKeyframes;
}

export function photoSlideshowMotionKeyframesWithPathPoints(
  keyframes: PhotoSlideshowMotionKeyframes | null | undefined,
  pathPoints: unknown,
): PhotoSlideshowMotionKeyframes {
  const base = cleanPhotoSlideshowMotionKeyframes(keyframes) || {
    startX: 50,
    startY: 50,
    quarterX: 50,
    quarterY: 50,
    midX: 50,
    midY: 50,
    threeQuarterX: 50,
    threeQuarterY: 50,
    endX: 50,
    endY: 50,
    startZoom: 1,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.08,
    endZoom: 1.08,
  };
  const current = photoSlideshowMotionPathPointsFromKeyframes(base);
  const incoming = Array.isArray(pathPoints) ? pathPoints : [];
  const byKey = new Map<PhotoSlideshowMotionPathPointKey, PhotoSlideshowMotionPathDraftPoint>();
  incoming.forEach((point, index) => {
    const record = point && typeof point === "object" && !Array.isArray(point) ? point as Record<string, unknown> : {};
    const rawKey = String(record.key ?? "").trim();
    const key = MOTION_PATH_POINT_KEYS.includes(rawKey as PhotoSlideshowMotionPathPointKey)
      ? rawKey as PhotoSlideshowMotionPathPointKey
      : MOTION_PATH_POINT_KEYS[index];
    if (!key) return;
    byKey.set(key, cleanMotionPathPoint(point, current[index] || { x: 50, y: 50 }));
  });
  const pointFor = (key: PhotoSlideshowMotionPathPointKey, index: number): PhotoSlideshowMotionPathDraftPoint => byKey.get(key) || current[index] || { x: 50, y: 50 };
  const start = pointFor("start", 0);
  const quarter = pointFor("quarter", 1);
  const mid = pointFor("mid", 2);
  const threeQuarter = pointFor("threeQuarter", 3);
  const end = pointFor("end", 4);
  const {
    bezierControl1X: _bezierControl1X,
    bezierControl1Y: _bezierControl1Y,
    bezierControl2X: _bezierControl2X,
    bezierControl2Y: _bezierControl2Y,
    ...baseWithoutBezier
  } = base;
  return cleanPhotoSlideshowMotionKeyframes({
    ...baseWithoutBezier,
    pathMode: base.pathMode === "bezier" ? "keyframes" : base.pathMode,
    startX: start.x,
    startY: start.y,
    quarterX: quarter.x,
    quarterY: quarter.y,
    midX: mid.x,
    midY: mid.y,
    threeQuarterX: threeQuarter.x,
    threeQuarterY: threeQuarter.y,
    endX: end.x,
    endY: end.y,
  }) as PhotoSlideshowMotionKeyframes;
}

export function photoSlideshowThemeTimelinePreset(
  theme: PhotoSlideshowProjectTheme | string,
  preset: PhotoSlideshowThemeTimelineChoice | string = "auto",
): PhotoSlideshowThemeTimelinePreset {
  if (preset === "classic-hold" || preset === "fade-hold" || preset === "ken-burns-drift") return preset;
  if (theme === "ken-burns") return "ken-burns-drift";
  if (theme === "fade") return "fade-hold";
  return "classic-hold";
}

export function photoSlideshowResolvedTransitionEffect(
  effect: PhotoSlideshowTransitionEffect | string,
  theme: PhotoSlideshowProjectTheme | string,
  themeTimelinePreset: PhotoSlideshowThemeTimelineChoice | string = "auto",
): PhotoSlideshowResolvedTransitionEffect {
  if (effect === "cut" || effect === "fade" || effect === "dissolve" || effect === "zoom") return effect;
  return photoSlideshowThemeTimelinePreset(theme, themeTimelinePreset) === "ken-burns-drift" ? "zoom" : "fade";
}

export function photoSlideshowResolvedMotionPreset(
  motion: PhotoSlideshowMotionPreset | string,
  theme: PhotoSlideshowProjectTheme | string,
  index = 0,
  themeTimelinePreset: PhotoSlideshowThemeTimelineChoice | string = "auto",
): PhotoSlideshowResolvedMotionPreset {
  if (motion === "still" || motion === "slow-zoom" || motion === "pan-left" || motion === "pan-right") return motion;
  if (photoSlideshowThemeTimelinePreset(theme, themeTimelinePreset) === "ken-burns-drift") {
    const pattern: PhotoSlideshowResolvedMotionPreset[] = ["slow-zoom", "pan-left", "pan-right"];
    return pattern[Math.max(0, index) % pattern.length];
  }
  return "still";
}

function photoSlideshowThemeCue(
  theme: PhotoSlideshowProjectTheme | string,
  themeTimelinePreset: PhotoSlideshowThemeTimelinePreset,
  resolvedMotion: PhotoSlideshowResolvedMotionPreset,
  index: number,
): string {
  if (resolvedMotion === "custom") return `Custom keyframes ${index + 1}`;
  if (themeTimelinePreset === "ken-burns-drift") return `Ken Burns ${resolvedMotion.replace(/-/g, " ")} ${index + 1}`;
  if (themeTimelinePreset === "fade-hold") return "Fade hold";
  return "Classic hold";
}

function cleanBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "").trim().toLocaleLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

export function cleanPhotoSlideshowSourcePaths(value: unknown, limit = 500): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const paths: string[] = [];
  raw.forEach((item) => {
    const path = String(item || "").trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  });
  return paths.slice(0, limit);
}

function cleanPhotoSlideshowSourcePathAnchor(value: unknown, sourcePaths: string[]): string {
  const sourcePath = String(value ?? "").trim();
  return sourcePath && sourcePaths.includes(sourcePath) ? sourcePath : "";
}

export function cleanPhotoSlideshowTimelineItems(value: unknown, sourcePaths: string[], fallbackDurationMs: number): PhotoSlideshowProjectTimelineItem[] {
  const rawItems = Array.isArray(value) ? value : [];
  const bySource = new Map<string, {
    durationMs: number;
    motion: PhotoSlideshowMotionPreset;
    keyframes: PhotoSlideshowMotionKeyframes | null;
    focalX?: number;
    focalY?: number;
    cropZoom?: number;
    captionText?: string;
    captionPlacement?: PhotoSlideshowCaptionPlacement;
    captionRegion?: PhotoSlideshowCaptionRegion;
    captionTypography?: PhotoSlideshowCaptionTypography;
    captionWrap?: PhotoSlideshowCaptionWrap;
    captions?: PhotoSlideshowCaption[];
    transitionEffect?: PhotoSlideshowTransitionEffect;
    transitionDurationMs?: number;
    chapterId?: string;
    chapterTitle?: string;
    chapterNarrative?: string;
  }>();
  rawItems.forEach((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    const sourcePath = String(record.sourcePath ?? "").trim();
    if (!sourcePath || bySource.has(sourcePath)) return;
    const keyframes = cleanPhotoSlideshowMotionKeyframes(record.keyframes ?? record.motionKeyframes ?? record.keyframePath);
    const hasFocalX = ["focalX", "cropFocusX", "focusX"].some((key) => key in record);
    const hasFocalY = ["focalY", "cropFocusY", "focusY"].some((key) => key in record);
    const hasCropZoom = ["cropZoom", "focalZoom", "focusZoom", "cropScale"].some((key) => key in record);
    const hasCaptionText = ["captionText", "caption", "slideCaption", "captionTitle"].some((key) => key in record);
    const hasCaptionPlacement = ["captionPlacement", "captionPosition", "captionPlace", "captionAnchor", "layoutRegion", "region"].some((key) => key in record) || typeof record.captionRegion === "string";
    const hasCaptionRegion = ["captionRegion", "captionBounds", "captionBox", "captionFrame", "captionRect"].some((key) => key in record && typeof record[key] !== "string");
    const hasCaptionTypography = ["captionTypography", "captionType", "captionFont", "captionStyle", "captionFontScale", "captionScale", "captionSize"].some((key) => key in record);
    const hasCaptionWrap = ["captionWrap", "captionWrapMode", "captionWrapping", "captionTextWrap", "captionLines", "captionLineMode", "captionFlow"].some((key) => key in record);
    const hasCaptions = ["captions", "captionBlocks", "captionLayers", "captionItems"].some((key) => key in record);
    const hasTransitionEffect = ["transitionEffect", "transitionOut", "transition", "transitionStyle"].some((key) => key in record);
    const hasTransitionDuration = ["transitionDurationMs", "transitionMs", "transitionDuration", "transitionOutMs"].some((key) => key in record);
    const captionRegion = hasCaptionRegion
      ? cleanCaptionRegion(record.captionRegion ?? record.captionBounds ?? record.captionBox ?? record.captionFrame ?? record.captionRect)
      : null;
    const cleanItem = {
      durationMs: cleanSlideDurationMs(record.durationMs, fallbackDurationMs),
      motion: cleanChoice(record.motion ?? record.motionPreset ?? record.keyframeMotion, MOTION_OPTIONS, "auto"),
      keyframes,
      ...(hasFocalX ? { focalX: cleanPercent(record.focalX ?? record.cropFocusX ?? record.focusX, 50) } : {}),
      ...(hasFocalY ? { focalY: cleanPercent(record.focalY ?? record.cropFocusY ?? record.focusY, 50) } : {}),
      ...(hasCropZoom ? { cropZoom: cleanCropZoom(record.cropZoom ?? record.focalZoom ?? record.focusZoom ?? record.cropScale) } : {}),
      ...(hasCaptionText ? { captionText: cleanCaptionText(record.captionText ?? record.caption ?? record.slideCaption ?? record.captionTitle) } : {}),
      ...(hasCaptionPlacement ? { captionPlacement: cleanCaptionPlacement(record.captionPlacement ?? record.captionPosition ?? record.captionPlace ?? record.captionAnchor ?? (typeof record.captionRegion === "string" ? record.captionRegion : undefined) ?? record.layoutRegion ?? record.region) } : {}),
      ...(captionRegion ? { captionRegion } : {}),
      ...(hasCaptionTypography ? { captionTypography: cleanCaptionTypography(record.captionTypography ?? record.captionType ?? record.captionFont ?? record.captionStyle ?? record.captionFontScale ?? record.captionScale ?? record.captionSize) } : {}),
      ...(hasCaptionWrap ? { captionWrap: cleanCaptionWrap(record.captionWrap ?? record.captionWrapMode ?? record.captionWrapping ?? record.captionTextWrap ?? record.captionLines ?? record.captionLineMode ?? record.captionFlow) } : {}),
      ...(hasCaptions ? { captions: cleanCaptions(record.captions ?? record.captionBlocks ?? record.captionLayers ?? record.captionItems) } : {}),
      ...(hasTransitionEffect
        ? { transitionEffect: cleanChoice(record.transitionEffect ?? record.transitionOut ?? record.transition ?? record.transitionStyle, TRANSITION_OPTIONS, "auto") }
        : {}),
      ...(hasTransitionDuration
        ? { transitionDurationMs: cleanTransitionDurationMs(record.transitionDurationMs ?? record.transitionMs ?? record.transitionDuration ?? record.transitionOutMs) }
        : {}),
      ...(cleanId(record.chapterId) ? { chapterId: cleanId(record.chapterId) } : {}),
      ...(cleanText(record.chapterTitle, "") ? { chapterTitle: cleanText(record.chapterTitle, "").slice(0, 100) } : {}),
      ...(cleanText(record.chapterNarrative, "") ? { chapterNarrative: cleanText(record.chapterNarrative, "").slice(0, 700) } : {}),
    };
    bySource.set(sourcePath, cleanItem);
  });
  return sourcePaths.map((sourcePath) => {
    const item = bySource.get(sourcePath);
    const transitionEffect = item?.transitionEffect;
    return {
      sourcePath,
      durationMs: item?.durationMs ?? fallbackDurationMs,
      motion: item?.motion ?? "auto",
      ...(item?.keyframes ? { keyframes: item.keyframes } : {}),
      ...(typeof item?.focalX === "number" ? { focalX: item.focalX } : {}),
      ...(typeof item?.focalY === "number" ? { focalY: item.focalY } : {}),
      ...(typeof item?.cropZoom === "number" ? { cropZoom: item.cropZoom } : {}),
      ...(typeof item?.captionText === "string" && item.captionText ? { captionText: item.captionText } : {}),
      ...(item?.captionPlacement && item.captionPlacement !== "auto" ? { captionPlacement: item.captionPlacement } : {}),
      ...(item?.captionRegion ? { captionRegion: item.captionRegion } : {}),
      ...(item?.captionTypography && item.captionTypography !== "auto" ? { captionTypography: item.captionTypography } : {}),
      ...(item?.captionWrap && item.captionWrap !== "auto" ? { captionWrap: item.captionWrap } : {}),
      ...(item?.captions?.length ? { captions: item.captions } : {}),
      ...(transitionEffect ? { transitionEffect } : {}),
      ...(typeof item?.transitionDurationMs === "number" ? { transitionDurationMs: transitionEffect === "cut" ? 0 : item.transitionDurationMs } : {}),
      ...(item?.chapterId ? { chapterId: item.chapterId } : {}),
      ...(item?.chapterTitle ? { chapterTitle: item.chapterTitle } : {}),
      ...(item?.chapterNarrative ? { chapterNarrative: item.chapterNarrative } : {}),
    };
  });
}

export function buildPhotoSlideshowThemeTimeline(
  timelineItems: unknown,
  sourcePaths: string[],
  fallbackDurationMs: number,
  theme: PhotoSlideshowProjectTheme | string,
  transitionEffect: PhotoSlideshowTransitionEffect | string,
  transitionDurationMs: number,
  themeTimelinePresetChoice: PhotoSlideshowThemeTimelineChoice | string = "auto",
): PhotoSlideshowThemeTimelineItem[] {
  const cleanItems = cleanPhotoSlideshowTimelineItems(timelineItems, sourcePaths, fallbackDurationMs);
  const effectiveThemeTimelinePreset = photoSlideshowThemeTimelinePreset(theme, themeTimelinePresetChoice);
  const defaultTransition = photoSlideshowResolvedTransitionEffect(transitionEffect, theme, effectiveThemeTimelinePreset);
  const defaultTransitionDurationMs = defaultTransition === "cut" ? 0 : cleanTransitionDurationMs(transitionDurationMs);
  return cleanItems.map((item, index) => {
    const resolvedMotion = item.keyframes ? "custom" : photoSlideshowResolvedMotionPreset(item.motion, theme, index, effectiveThemeTimelinePreset);
    const hasNext = index < cleanItems.length - 1;
    const resolvedTransition = photoSlideshowResolvedTransitionEffect(item.transitionEffect || transitionEffect, theme, effectiveThemeTimelinePreset);
    const resolvedTransitionDurationMs = resolvedTransition === "cut"
      ? 0
      : typeof item.transitionDurationMs === "number"
        ? cleanTransitionDurationMs(item.transitionDurationMs)
        : defaultTransitionDurationMs;
    return {
      ...item,
      index,
      resolvedMotion,
      transitionOut: hasNext ? resolvedTransition : "cut",
      transitionDurationMs: hasNext ? resolvedTransitionDurationMs : 0,
      themeCue: photoSlideshowThemeCue(theme, effectiveThemeTimelinePreset, resolvedMotion, index),
    };
  });
}

export function normalizePhotoSlideshowProject(value: unknown): PhotoSlideshowProject | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const sourcePaths = cleanPhotoSlideshowSourcePaths(record.sourcePaths);
  if (!sourcePaths.length) return null;
  const now = new Date(0).toISOString();
  const fallbackName = cleanText(record.title, "Slideshow");
  const name = cleanText(record.name, fallbackName);
  const audioStartMs = cleanAudioTrimMs(record.audioStartMs);
  const rawAudioEndMs = cleanAudioTrimMs(record.audioEndMs);
  const intervalMs = cleanInterval(record.intervalMs);
  const transitionEffect = cleanChoice(record.transitionEffect ?? record.transitionStyle ?? record.transition, TRANSITION_OPTIONS, "auto");
  const audioPlacementStartSourcePath = cleanPhotoSlideshowSourcePathAnchor(record.audioPlacementStartSourcePath, sourcePaths);
  let audioPlacementEndSourcePath = cleanPhotoSlideshowSourcePathAnchor(record.audioPlacementEndSourcePath, sourcePaths);
  if (audioPlacementStartSourcePath && audioPlacementEndSourcePath) {
    const startIndex = sourcePaths.indexOf(audioPlacementStartSourcePath);
    const endIndex = sourcePaths.indexOf(audioPlacementEndSourcePath);
    if (startIndex >= 0 && endIndex >= 0 && endIndex < startIndex) {
      audioPlacementEndSourcePath = audioPlacementStartSourcePath;
    }
  }
  return {
    id: cleanId(record.id) || `slideshow:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    title: cleanText(record.title, name),
    sourceLabel: cleanText(record.sourceLabel, ""),
    storyId: cleanId(record.storyId),
    storyContentSha256: /^[a-f0-9]{64}$/i.test(String(record.storyContentSha256 || "")) ? String(record.storyContentSha256).toLowerCase() : "",
    storyGenerationSha256: /^[a-f0-9]{64}$/i.test(String(record.storyGenerationSha256 || "")) ? String(record.storyGenerationSha256).toLowerCase() : "",
    sourcePaths,
    theme: cleanChoice(record.theme, THEME_OPTIONS, "classic"),
    themeTimelinePreset: cleanChoice(record.themeTimelinePreset ?? record.themePreset ?? record.timelinePreset, THEME_TIMELINE_OPTIONS, "auto"),
    themeTemplateName: cleanText(record.themeTemplateName ?? record.templateName ?? record.slideshowTemplateName, ""),
    themeTemplatePalette: cleanChoice(record.themeTemplatePalette ?? record.templatePalette ?? record.slideshowTemplatePalette, THEME_TEMPLATE_PALETTE_OPTIONS, "auto"),
    themeTemplateTypography: cleanChoice(record.themeTemplateTypography ?? record.templateTypography ?? record.slideshowTemplateTypography, THEME_TEMPLATE_TYPOGRAPHY_OPTIONS, "auto"),
    themeTemplateBackdrop: cleanChoice(record.themeTemplateBackdrop ?? record.templateBackdrop ?? record.slideshowTemplateBackdrop, THEME_TEMPLATE_BACKDROP_OPTIONS, "auto"),
    themeTemplateLayout: cleanChoice(record.themeTemplateLayout ?? record.templateLayout ?? record.slideshowTemplateLayout, THEME_TEMPLATE_LAYOUT_OPTIONS, "auto"),
    themeTemplateBackdropIntensity: cleanTemplateBackdropIntensity(record.themeTemplateBackdropIntensity ?? record.templateBackdropIntensity ?? record.slideshowTemplateBackdropIntensity),
    themeTemplateStageWidth: cleanTemplateStageWidth(record.themeTemplateStageWidth ?? record.templateStageWidth ?? record.slideshowTemplateStageWidth),
    themeTemplateFrameStyle: cleanChoice(record.themeTemplateFrameStyle ?? record.templateFrameStyle ?? record.slideshowTemplateFrameStyle, THEME_TEMPLATE_FRAME_STYLE_OPTIONS, "auto"),
    themeTemplateChromeDensity: cleanChoice(record.themeTemplateChromeDensity ?? record.templateChromeDensity ?? record.slideshowTemplateChromeDensity, THEME_TEMPLATE_CHROME_DENSITY_OPTIONS, "auto"),
    themeTemplateCaptionPreset: cleanThemeTemplateCaptionPreset(record.themeTemplateCaptionPreset ?? record.templateCaptionPreset ?? record.slideshowTemplateCaptionPreset ?? record.captionPreset ?? record.captionLayoutPreset),
    themeTemplateRegionMap: cleanPhotoSlideshowThemeTemplateRegionMap(record.themeTemplateRegionMap ?? record.templateRegionMap ?? record.slideshowTemplateRegionMap ?? record.themeTemplateCaptionRegions ?? record.templateCaptionRegions ?? record.captionRegionMap),
    music: cleanChoice(record.music, MUSIC_OPTIONS, "none"),
    musicPath: cleanChoice(record.music, MUSIC_OPTIONS, "none") === "custom" ? cleanText(record.musicPath, "") : "",
    audioVolume: cleanAudioVolume(record.audioVolume),
    audioFadeMs: cleanAudioFadeMs(record.audioFadeMs),
    audioStartMs,
    audioEndMs: rawAudioEndMs > audioStartMs ? rawAudioEndMs : 0,
    audioPlacementStartSourcePath,
    audioPlacementEndSourcePath,
    includeTitleCard: cleanBoolean(record.includeTitleCard, false),
    titleCardTitle: cleanText(record.titleCardTitle, cleanText(record.title, name)),
    titleCardSubtitle: cleanText(record.titleCardSubtitle, cleanText(record.sourceLabel, "")),
    titleCardDurationMs: cleanTitleCardDurationMs(record.titleCardDurationMs),
    titleCardPalette: cleanChoice(record.titleCardPalette, TITLE_CARD_PALETTE_OPTIONS, "auto"),
    titleCardLayout: cleanChoice(record.titleCardLayout, TITLE_CARD_LAYOUT_OPTIONS, "center"),
    titleCardFontScale: cleanChoice(record.titleCardFontScale, TITLE_CARD_FONT_SCALE_OPTIONS, "regular"),
    titleCardShowFooter: cleanBoolean(record.titleCardShowFooter, true),
    timelineItems: cleanPhotoSlideshowTimelineItems(record.timelineItems, sourcePaths, intervalMs),
    transitionEffect,
    transitionDurationMs: transitionEffect === "cut" ? 0 : cleanTransitionDurationMs(record.transitionDurationMs ?? record.transitionMs),
    intervalMs,
    fitMode: cleanChoice(record.fitMode, FIT_OPTIONS, "fit"),
    createdAt: cleanText(record.createdAt, now),
    updatedAt: cleanText(record.updatedAt, cleanText(record.createdAt, now)),
  };
}

export function normalizePhotoSlideshowProjectList(values: unknown, limit = Number.POSITIVE_INFINITY): PhotoSlideshowProject[] {
  const parsed = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const projects: PhotoSlideshowProject[] = [];
  parsed.forEach((value) => {
    const project = normalizePhotoSlideshowProject(value);
    if (!project || seen.has(project.id)) return;
    seen.add(project.id);
    projects.push(project);
  });
  return projects
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function readStoredPhotoSlideshowProjects(key: string): PhotoSlideshowProject[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoSlideshowProjectList(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoSlideshowProjects(key: string, values: PhotoSlideshowProject[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoSlideshowProjectList(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function normalizePhotoSlideshowThemeTemplate(value: unknown): PhotoSlideshowThemeTemplate | null {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const now = new Date(0).toISOString();
  const name = cleanText(record.name ?? record.themeTemplateName ?? record.templateName, "");
  if (!name) return null;
  const transitionEffect = cleanChoice(record.transitionEffect ?? record.transitionStyle ?? record.transition, TRANSITION_OPTIONS, "auto");
  return {
    id: cleanId(record.id ?? record.templateId) || `slideshow-template:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    theme: cleanChoice(record.theme, THEME_OPTIONS, "classic"),
    themeTimelinePreset: cleanChoice(record.themeTimelinePreset ?? record.themePreset ?? record.timelinePreset, THEME_TIMELINE_OPTIONS, "auto"),
    themeTemplatePalette: cleanChoice(record.themeTemplatePalette ?? record.templatePalette ?? record.slideshowTemplatePalette, THEME_TEMPLATE_PALETTE_OPTIONS, "auto"),
    themeTemplateTypography: cleanChoice(record.themeTemplateTypography ?? record.templateTypography ?? record.slideshowTemplateTypography, THEME_TEMPLATE_TYPOGRAPHY_OPTIONS, "auto"),
    themeTemplateBackdrop: cleanChoice(record.themeTemplateBackdrop ?? record.templateBackdrop ?? record.slideshowTemplateBackdrop, THEME_TEMPLATE_BACKDROP_OPTIONS, "auto"),
    themeTemplateLayout: cleanChoice(record.themeTemplateLayout ?? record.templateLayout ?? record.slideshowTemplateLayout, THEME_TEMPLATE_LAYOUT_OPTIONS, "auto"),
    themeTemplateBackdropIntensity: cleanTemplateBackdropIntensity(record.themeTemplateBackdropIntensity ?? record.templateBackdropIntensity ?? record.slideshowTemplateBackdropIntensity),
    themeTemplateStageWidth: cleanTemplateStageWidth(record.themeTemplateStageWidth ?? record.templateStageWidth ?? record.slideshowTemplateStageWidth),
    themeTemplateFrameStyle: cleanChoice(record.themeTemplateFrameStyle ?? record.templateFrameStyle ?? record.slideshowTemplateFrameStyle, THEME_TEMPLATE_FRAME_STYLE_OPTIONS, "auto"),
    themeTemplateChromeDensity: cleanChoice(record.themeTemplateChromeDensity ?? record.templateChromeDensity ?? record.slideshowTemplateChromeDensity, THEME_TEMPLATE_CHROME_DENSITY_OPTIONS, "auto"),
    themeTemplateCaptionPreset: cleanThemeTemplateCaptionPreset(record.themeTemplateCaptionPreset ?? record.templateCaptionPreset ?? record.slideshowTemplateCaptionPreset ?? record.captionPreset ?? record.captionLayoutPreset),
    themeTemplateRegionMap: cleanPhotoSlideshowThemeTemplateRegionMap(record.themeTemplateRegionMap ?? record.templateRegionMap ?? record.slideshowTemplateRegionMap ?? record.themeTemplateCaptionRegions ?? record.templateCaptionRegions ?? record.captionRegionMap),
    transitionEffect,
    transitionDurationMs: transitionEffect === "cut" ? 0 : cleanTransitionDurationMs(record.transitionDurationMs ?? record.transitionMs),
    includeTitleCard: cleanBoolean(record.includeTitleCard, false),
    titleCardPalette: cleanChoice(record.titleCardPalette, TITLE_CARD_PALETTE_OPTIONS, "auto"),
    titleCardLayout: cleanChoice(record.titleCardLayout, TITLE_CARD_LAYOUT_OPTIONS, "center"),
    titleCardFontScale: cleanChoice(record.titleCardFontScale, TITLE_CARD_FONT_SCALE_OPTIONS, "regular"),
    titleCardShowFooter: cleanBoolean(record.titleCardShowFooter, true),
    createdAt: cleanText(record.createdAt, now),
    updatedAt: cleanText(record.updatedAt, cleanText(record.createdAt, now)),
  };
}

export function normalizePhotoSlideshowThemeTemplateList(values: unknown, limit = 30): PhotoSlideshowThemeTemplate[] {
  const parsed = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const templates: PhotoSlideshowThemeTemplate[] = [];
  parsed.forEach((value) => {
    const template = normalizePhotoSlideshowThemeTemplate(value);
    if (!template || seen.has(template.id)) return;
    seen.add(template.id);
    templates.push(template);
  });
  return templates
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function readStoredPhotoSlideshowThemeTemplates(key: string): PhotoSlideshowThemeTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoSlideshowThemeTemplateList(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoSlideshowThemeTemplates(key: string, values: PhotoSlideshowThemeTemplate[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoSlideshowThemeTemplateList(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function photoSlideshowProjectSourcePaths(
  items: PhotoSlideshowProjectItemLike[],
  selectedSources?: Iterable<string>,
): string[] {
  const selected = new Set([...(selectedSources || [])].map((source) => String(source || "").trim()).filter(Boolean));
  const candidates = selected.size ? items.filter((item) => selected.has(String(item.sourcePath || ""))) : items;
  return cleanPhotoSlideshowSourcePaths(
    candidates
      .filter((item) => !item.missingAt)
      .map((item) => item.sourcePath || ""),
  );
}

export function upsertPhotoSlideshowProject(
  projects: PhotoSlideshowProject[],
  draft: {
    id?: string;
    name: string;
    title?: string;
    sourceLabel?: string;
    storyId?: string;
    storyContentSha256?: string;
    storyGenerationSha256?: string;
    sourcePaths: string[];
    theme?: PhotoSlideshowProjectTheme | string;
    themeTimelinePreset?: PhotoSlideshowThemeTimelineChoice | string;
    themeTemplateName?: string;
    themeTemplatePalette?: PhotoSlideshowThemeTemplatePalette | string;
    themeTemplateTypography?: PhotoSlideshowThemeTemplateTypography | string;
    themeTemplateBackdrop?: PhotoSlideshowThemeTemplateBackdrop | string;
    themeTemplateLayout?: PhotoSlideshowThemeTemplateLayout | string;
    themeTemplateBackdropIntensity?: number;
    themeTemplateStageWidth?: number;
    themeTemplateFrameStyle?: PhotoSlideshowThemeTemplateFrameStyle | string;
    themeTemplateChromeDensity?: PhotoSlideshowThemeTemplateChromeDensity | string;
    themeTemplateCaptionPreset?: PhotoSlideshowThemeTemplateCaptionPreset | string;
    themeTemplateRegionMap?: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown>;
    music?: PhotoSlideshowProjectMusic | string;
    musicPath?: string;
    audioVolume?: number;
    audioFadeMs?: number;
    audioStartMs?: number;
    audioEndMs?: number;
    audioPlacementStartSourcePath?: string;
    audioPlacementEndSourcePath?: string;
    includeTitleCard?: boolean;
    titleCardTitle?: string;
    titleCardSubtitle?: string;
    titleCardDurationMs?: number;
    titleCardPalette?: PhotoSlideshowTitleCardPalette | string;
    titleCardLayout?: PhotoSlideshowTitleCardLayout | string;
    titleCardFontScale?: PhotoSlideshowTitleCardFontScale | string;
    titleCardShowFooter?: boolean;
    timelineItems?: PhotoSlideshowProjectTimelineItem[];
    transitionEffect?: PhotoSlideshowTransitionEffect | string;
    transitionDurationMs?: number;
    intervalMs?: number;
    fitMode?: PhotoSlideshowProjectFitMode | string;
    now?: string;
  },
): PhotoSlideshowProject[] {
  const sourcePaths = cleanPhotoSlideshowSourcePaths(draft.sourcePaths);
  const name = cleanText(draft.name, cleanText(draft.title, "Slideshow"));
  if (!name || !sourcePaths.length) return normalizePhotoSlideshowProjectList(projects);
  const now = cleanText(draft.now, new Date().toISOString());
  const requestedId = cleanId(draft.id);
  const normalizedProjects = normalizePhotoSlideshowProjectList(projects);
  const nameKey = name.toLocaleLowerCase();
  const existingById = requestedId ? normalizedProjects.find((project) => project.id === requestedId) : undefined;
  const existingByName = normalizedProjects.find((project) => project.name.toLocaleLowerCase() === nameKey);
  if (
    (existingById && existingByName && existingByName.id !== existingById.id)
    || (requestedId && !existingById && existingByName)
  ) {
    return normalizedProjects;
  }
  const existing = existingById || existingByName;
  if (!existing && normalizedProjects.length >= PHOTO_SLIDESHOW_PROJECT_LIMIT) {
    return normalizedProjects;
  }
  const next = normalizePhotoSlideshowProject({
    id: requestedId || existing?.id || `slideshow:${now.replace(/[^0-9]+/g, "").slice(0, 14)}:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    title: cleanText(draft.title, name),
    sourceLabel: draft.sourceLabel || existing?.sourceLabel || "",
    storyId: draft.storyId ?? existing?.storyId ?? "",
    storyContentSha256: draft.storyContentSha256 ?? existing?.storyContentSha256 ?? "",
    storyGenerationSha256: draft.storyGenerationSha256 ?? existing?.storyGenerationSha256 ?? "",
    sourcePaths,
    theme: draft.theme || existing?.theme || "classic",
    themeTimelinePreset: draft.themeTimelinePreset || existing?.themeTimelinePreset || "auto",
    themeTemplateName: draft.themeTemplateName ?? existing?.themeTemplateName ?? "",
    themeTemplatePalette: draft.themeTemplatePalette || existing?.themeTemplatePalette || "auto",
    themeTemplateTypography: draft.themeTemplateTypography || existing?.themeTemplateTypography || "auto",
    themeTemplateBackdrop: draft.themeTemplateBackdrop || existing?.themeTemplateBackdrop || "auto",
    themeTemplateLayout: draft.themeTemplateLayout || existing?.themeTemplateLayout || "auto",
    themeTemplateBackdropIntensity: draft.themeTemplateBackdropIntensity ?? existing?.themeTemplateBackdropIntensity ?? 100,
    themeTemplateStageWidth: draft.themeTemplateStageWidth ?? existing?.themeTemplateStageWidth ?? 100,
    themeTemplateFrameStyle: draft.themeTemplateFrameStyle || existing?.themeTemplateFrameStyle || "auto",
    themeTemplateChromeDensity: draft.themeTemplateChromeDensity || existing?.themeTemplateChromeDensity || "auto",
    themeTemplateCaptionPreset: draft.themeTemplateCaptionPreset || existing?.themeTemplateCaptionPreset || "auto",
    themeTemplateRegionMap: draft.themeTemplateRegionMap ?? existing?.themeTemplateRegionMap ?? {},
    music: draft.music || existing?.music || "none",
    musicPath: draft.musicPath ?? existing?.musicPath ?? "",
    audioVolume: draft.audioVolume ?? existing?.audioVolume ?? 1,
    audioFadeMs: draft.audioFadeMs ?? existing?.audioFadeMs ?? 0,
    audioStartMs: draft.audioStartMs ?? existing?.audioStartMs ?? 0,
    audioEndMs: draft.audioEndMs ?? existing?.audioEndMs ?? 0,
    audioPlacementStartSourcePath: draft.audioPlacementStartSourcePath ?? existing?.audioPlacementStartSourcePath ?? "",
    audioPlacementEndSourcePath: draft.audioPlacementEndSourcePath ?? existing?.audioPlacementEndSourcePath ?? "",
    includeTitleCard: draft.includeTitleCard ?? existing?.includeTitleCard ?? false,
    titleCardTitle: draft.titleCardTitle ?? existing?.titleCardTitle ?? cleanText(draft.title, name),
    titleCardSubtitle: draft.titleCardSubtitle ?? existing?.titleCardSubtitle ?? draft.sourceLabel ?? "",
    titleCardDurationMs: draft.titleCardDurationMs ?? existing?.titleCardDurationMs ?? 3000,
    titleCardPalette: draft.titleCardPalette || existing?.titleCardPalette || "auto",
    titleCardLayout: draft.titleCardLayout || existing?.titleCardLayout || "center",
    titleCardFontScale: draft.titleCardFontScale || existing?.titleCardFontScale || "regular",
    titleCardShowFooter: draft.titleCardShowFooter ?? existing?.titleCardShowFooter ?? true,
    timelineItems: draft.timelineItems ?? existing?.timelineItems ?? [],
    transitionEffect: draft.transitionEffect || existing?.transitionEffect || "auto",
    transitionDurationMs: draft.transitionDurationMs ?? existing?.transitionDurationMs ?? 650,
    intervalMs: draft.intervalMs ?? existing?.intervalMs ?? 4500,
    fitMode: draft.fitMode || existing?.fitMode || "fit",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  if (!next) return normalizedProjects;
  return normalizePhotoSlideshowProjectList([
    next,
    ...normalizedProjects.filter((project) => (
      project.id !== next.id
      && (!existingByName || existingById || project.name.toLocaleLowerCase() !== nameKey)
    )),
  ]);
}

export function deletePhotoSlideshowProject(projects: PhotoSlideshowProject[], projectId: string): PhotoSlideshowProject[] {
  const id = cleanId(projectId);
  return normalizePhotoSlideshowProjectList(projects.filter((project) => project.id !== id));
}

export function upsertPhotoSlideshowThemeTemplate(
  templates: PhotoSlideshowThemeTemplate[],
  draft: {
    id?: string;
    name: string;
    theme?: PhotoSlideshowProjectTheme | string;
    themeTimelinePreset?: PhotoSlideshowThemeTimelineChoice | string;
    themeTemplatePalette?: PhotoSlideshowThemeTemplatePalette | string;
    themeTemplateTypography?: PhotoSlideshowThemeTemplateTypography | string;
    themeTemplateBackdrop?: PhotoSlideshowThemeTemplateBackdrop | string;
    themeTemplateLayout?: PhotoSlideshowThemeTemplateLayout | string;
    themeTemplateBackdropIntensity?: number;
    themeTemplateStageWidth?: number;
    themeTemplateFrameStyle?: PhotoSlideshowThemeTemplateFrameStyle | string;
    themeTemplateChromeDensity?: PhotoSlideshowThemeTemplateChromeDensity | string;
    themeTemplateCaptionPreset?: PhotoSlideshowThemeTemplateCaptionPreset | string;
    themeTemplateRegionMap?: PhotoSlideshowThemeTemplateRegionMap | Record<string, unknown>;
    transitionEffect?: PhotoSlideshowTransitionEffect | string;
    transitionDurationMs?: number;
    includeTitleCard?: boolean;
    titleCardPalette?: PhotoSlideshowTitleCardPalette | string;
    titleCardLayout?: PhotoSlideshowTitleCardLayout | string;
    titleCardFontScale?: PhotoSlideshowTitleCardFontScale | string;
    titleCardShowFooter?: boolean;
    now?: string;
  },
): PhotoSlideshowThemeTemplate[] {
  const name = cleanText(draft.name, "Template");
  if (!name) return normalizePhotoSlideshowThemeTemplateList(templates);
  const now = cleanText(draft.now, new Date().toISOString());
  const requestedId = cleanId(draft.id);
  const existing = templates.find((template) => template.id === requestedId || template.name.toLocaleLowerCase() === name.toLocaleLowerCase());
  const next = normalizePhotoSlideshowThemeTemplate({
    id: requestedId || existing?.id || `slideshow-template:${now.replace(/[^0-9]+/g, "").slice(0, 14)}:${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    theme: draft.theme || existing?.theme || "classic",
    themeTimelinePreset: draft.themeTimelinePreset || existing?.themeTimelinePreset || "auto",
    themeTemplatePalette: draft.themeTemplatePalette || existing?.themeTemplatePalette || "auto",
    themeTemplateTypography: draft.themeTemplateTypography || existing?.themeTemplateTypography || "auto",
    themeTemplateBackdrop: draft.themeTemplateBackdrop || existing?.themeTemplateBackdrop || "auto",
    themeTemplateLayout: draft.themeTemplateLayout || existing?.themeTemplateLayout || "auto",
    themeTemplateBackdropIntensity: draft.themeTemplateBackdropIntensity ?? existing?.themeTemplateBackdropIntensity ?? 100,
    themeTemplateStageWidth: draft.themeTemplateStageWidth ?? existing?.themeTemplateStageWidth ?? 100,
    themeTemplateFrameStyle: draft.themeTemplateFrameStyle || existing?.themeTemplateFrameStyle || "auto",
    themeTemplateChromeDensity: draft.themeTemplateChromeDensity || existing?.themeTemplateChromeDensity || "auto",
    themeTemplateCaptionPreset: draft.themeTemplateCaptionPreset || existing?.themeTemplateCaptionPreset || "auto",
    themeTemplateRegionMap: draft.themeTemplateRegionMap ?? existing?.themeTemplateRegionMap ?? {},
    transitionEffect: draft.transitionEffect || existing?.transitionEffect || "auto",
    transitionDurationMs: draft.transitionDurationMs ?? existing?.transitionDurationMs ?? 650,
    includeTitleCard: draft.includeTitleCard ?? existing?.includeTitleCard ?? false,
    titleCardPalette: draft.titleCardPalette || existing?.titleCardPalette || "auto",
    titleCardLayout: draft.titleCardLayout || existing?.titleCardLayout || "center",
    titleCardFontScale: draft.titleCardFontScale || existing?.titleCardFontScale || "regular",
    titleCardShowFooter: draft.titleCardShowFooter ?? existing?.titleCardShowFooter ?? true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
  if (!next) return normalizePhotoSlideshowThemeTemplateList(templates);
  return normalizePhotoSlideshowThemeTemplateList([
    next,
    ...templates.filter((template) => template.id !== next.id && template.name.toLocaleLowerCase() !== name.toLocaleLowerCase()),
  ]);
}

export function deletePhotoSlideshowThemeTemplate(templates: PhotoSlideshowThemeTemplate[], templateId: string): PhotoSlideshowThemeTemplate[] {
  const id = cleanId(templateId);
  return normalizePhotoSlideshowThemeTemplateList(templates.filter((template) => template.id !== id));
}

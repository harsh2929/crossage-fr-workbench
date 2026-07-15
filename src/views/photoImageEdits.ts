export type PhotoImageCropAspect =
  | "none"
  | "square"
  | "landscape"
  | "9:16"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "5:4"
  | "portrait"
  | "7:5"
  | "5:7";

export type PhotoImageRotateDegrees = 0 | 90 | 180 | 270;

export interface PhotoImageCropAspectOption {
  value: PhotoImageCropAspect;
  label: string;
}

export interface PhotoManualCropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PhotoManualCropPoint {
  x: number;
  y: number;
}

export type ImageManualCropDragState = {
  pointerId: number;
  mode: PhotoManualCropDragMode;
  start: PhotoManualCropPoint;
  box: PhotoManualCropBox;
};

export type PhotoManualCropDragMode =
  | "create"
  | "move"
  | "n"
  | "e"
  | "s"
  | "w"
  | "ne"
  | "nw"
  | "se"
  | "sw";

export type PhotoImageMarkupDragMode = Exclude<PhotoManualCropDragMode, "create">;

export type ImageMarkupDragState = {
  pointerId: number;
  mode: PhotoImageMarkupDragMode;
  start: PhotoManualCropPoint;
  annotation: PhotoImageMarkupAnnotation;
  index: number;
};

export type ImageMarkupStrokeState = {
  pointerId: number;
  points: PhotoManualCropPoint[];
  index: number;
};

export interface PhotoImageAdjustmentDraft {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  brilliance: number;
  blackPoint: number;
  midtones: number;
  whitePoint: number;
  curveShadows: number;
  curveMidtones: number;
  curveHighlights: number;
  curveRedShadows: number;
  curveRedMidtones: number;
  curveRedHighlights: number;
  curveGreenShadows: number;
  curveGreenMidtones: number;
  curveGreenHighlights: number;
  curveBlueShadows: number;
  curveBlueMidtones: number;
  curveBlueHighlights: number;
  manualCurveBlack: number;
  manualCurveQuarter: number;
  manualCurveMid: number;
  manualCurveThreeQuarter: number;
  manualCurveWhite: number;
  saturation: number;
  warmth: number;
  tint: number;
  sharpness: number;
  vignette: number;
  noiseReduction: number;
}

export type PhotoImageAdjustmentControl = {
  key: keyof PhotoImageAdjustmentDraft;
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  step: number;
  precision?: number;
};

export interface PhotoImageAutoEnhanceStats {
  pixelCount: number;
  lumaStdDev: number;
  lumaP01: number;
  lumaP05: number;
  lumaP50: number;
  lumaP95: number;
  lumaP99: number;
  averageLuma: number;
  shadowLuma: number;
  highlightLuma: number;
  shadowShare: number;
  highlightShare: number;
  clippedShadowShare: number;
  clippedHighlightShare: number;
  averageSaturation: number;
  redAverage: number;
  greenAverage: number;
  blueAverage: number;
}

export interface PhotoImageRgbSample {
  red: number;
  green: number;
  blue: number;
}

export interface PhotoImageSampleSize {
  width: number;
  height: number;
}

export interface PhotoImageSampleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type PhotoImageFilterPreset =
  | "none"
  | "vivid"
  | "vivid_warm"
  | "vivid_cool"
  | "dramatic"
  | "dramatic_warm"
  | "dramatic_cool"
  | "mono"
  | "silvertone"
  | "noir";

export interface PhotoImageFilterOption {
  value: PhotoImageFilterPreset;
  label: string;
}

export type PhotoImageMarkupKind = "text" | "rectangle" | "highlight" | "ellipse" | "line" | "arrow" | "freehand" | "signature";
export type PhotoImageRetouchKind = "red_eye" | "blemish" | "clone";

export interface PhotoImageMarkupAnnotation {
  kind: PhotoImageMarkupKind;
  text?: string;
  points?: PhotoManualCropPoint[];
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
  backgroundColor: string;
  opacity: number;
  fontSize: number;
}

export interface PhotoImageRetouchSpot {
  kind: PhotoImageRetouchKind;
  left: number;
  top: number;
  width: number;
  height: number;
  strength: number;
  sourceLeft?: number;
  sourceTop?: number;
}

export type ImageRetouchBrushState = {
  pointerId: number;
  lastPoint: PhotoManualCropPoint;
  spacing: number;
  template: PhotoImageRetouchSpot;
};

export interface PhotoImageSignaturePreset {
  id: string;
  name: string;
  points: PhotoManualCropPoint[];
  color: string;
  opacity: number;
  aspectRatio: number;
  createdAt: string;
}

export interface PhotoImageEditOperation {
  kind: "image_crop_rotate";
  rotateDegrees: PhotoImageRotateDegrees;
  straightenDegrees: number;
  cropAspect: PhotoImageCropAspect;
  flipHorizontal: boolean;
  flipVertical: boolean;
  renderQuality: number;
  renderMaxDimension: number;
  source: string;
  cropRect?: PhotoManualCropBox;
  adjustments?: PhotoImageAdjustmentDraft;
  filterPreset?: PhotoImageFilterPreset;
  filterIntensity?: number;
  markup?: PhotoImageMarkupAnnotation[];
  retouch?: PhotoImageRetouchSpot[];
}

export interface PhotoImageEditOperationDraftInput {
  rotateDegrees?: unknown;
  straightenDegrees?: unknown;
  manualCropActive?: boolean;
  manualCropBox?: Partial<PhotoManualCropBox> | null;
  cropAspect?: unknown;
  adjustmentsActive?: boolean;
  adjustments?: Partial<PhotoImageAdjustmentDraft> | null;
  filterActive?: boolean;
  filterPreset?: unknown;
  filterIntensity?: unknown;
  markupActive?: boolean;
  markup?: unknown;
  retouchActive?: boolean;
  retouch?: unknown;
  flipHorizontal?: unknown;
  flipVertical?: unknown;
  source?: unknown;
}

export interface PhotoImageEditDraftState {
  operation: PhotoImageEditOperation;
  rotateDegrees: PhotoImageRotateDegrees;
  straightenDegrees: number;
  cropAspect: PhotoImageCropAspect;
  manualCropEnabled: boolean;
  manualCropBox: PhotoManualCropBox;
  adjustmentsOpen: boolean;
  adjustments: PhotoImageAdjustmentDraft;
  filterPreset: PhotoImageFilterPreset;
  filterIntensity: number;
  markupOpen: boolean;
  markupAnnotations: PhotoImageMarkupAnnotation[];
  markupSelectedIndex: number;
  retouchOpen: boolean;
  retouchSpots: PhotoImageRetouchSpot[];
  retouchSelectedIndex: number;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export type PhotoImageEditDefaultDraftState = Omit<PhotoImageEditDraftState, "operation">;

export interface PhotoImageEditClipboardEntry {
  id: string;
  label: string;
  copiedAt: string;
  operation: PhotoImageEditOperation;
}

export interface PhotoImageEditClipboardSelectionDraft {
  entry: PhotoImageEditClipboardEntry | null;
  selectedId: string;
  operation: PhotoImageEditOperation | null;
  label: string;
}

export interface PhotoImageEditClipboardHistoryDraft extends PhotoImageEditClipboardSelectionDraft {
  history: PhotoImageEditClipboardEntry[];
}

export type PhotoImagePasteKind = "edits" | "adjustments";
export type PhotoImagePasteProgressPhase = "checking" | "pasting";
export type PhotoImagePasteConflictMode = "edit" | "adjustments";
export type PhotoEditStackVersionProgressAction = "snapshot" | "restore" | "delete";
export type PhotoEditStackVersionConfirmAction = "restore" | "delete";
export type PhotoEditStackVersionSingleConfirmAction = "restore" | "delete";
export type PhotoEditStackVersionSingleResultAction = "duplicate" | "restore" | "delete";
export type PhotoAssetVersionDuplicateResultKind = "photo" | "rendered";

export interface PhotoImagePasteTextOptions {
  uiText?: (value: string) => string;
  formatCount?: (value: number) => string;
}

export interface PhotoImagePasteResultOptions extends PhotoImagePasteTextOptions {
  skipped?: unknown;
}

export interface PhotoImagePasteConflictDialogDraft {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  preview: string;
}

export interface PhotoEditStackVersionConfirmDialogDraft {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface PhotoEditStackVersionSingleConfirmDialogDraft {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface PhotoEditStackRevertConfirmDialogDraft {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export interface PhotoEditStackTargetPayload extends Record<string, unknown> {
  sourcePath: string;
  assetId: string;
}

export interface PhotoEditStackSavePayload extends PhotoEditStackTargetPayload {
  operations: unknown[];
}

export interface PhotoEditStackVersionListPayload extends PhotoEditStackTargetPayload {
  limit?: number;
}

export interface PhotoEditStackVersionPayload extends PhotoEditStackTargetPayload {
  versionId: string;
}

export const PHOTO_IMAGE_EDIT_CLIPBOARD_KEY = "vintrace.photos.imageEditClipboardHistory";
export const PHOTO_IMAGE_SIGNATURE_PRESETS_KEY = "vintrace.photos.imageSignaturePresets";

export const DEFAULT_PHOTO_MANUAL_CROP_BOX: PhotoManualCropBox = {
  left: 0,
  top: 0,
  width: 100,
  height: 100,
};

export const DEFAULT_PHOTO_IMAGE_ADJUSTMENTS: PhotoImageAdjustmentDraft = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  brilliance: 0,
  blackPoint: 0,
  midtones: 0,
  whitePoint: 0,
  curveShadows: 0,
  curveMidtones: 0,
  curveHighlights: 0,
  curveRedShadows: 0,
  curveRedMidtones: 0,
  curveRedHighlights: 0,
  curveGreenShadows: 0,
  curveGreenMidtones: 0,
  curveGreenHighlights: 0,
  curveBlueShadows: 0,
  curveBlueMidtones: 0,
  curveBlueHighlights: 0,
  manualCurveBlack: 0,
  manualCurveQuarter: 0,
  manualCurveMid: 0,
  manualCurveThreeQuarter: 0,
  manualCurveWhite: 0,
  saturation: 0,
  warmth: 0,
  tint: 0,
  sharpness: 0,
  vignette: 0,
  noiseReduction: 0,
};

export const PHOTO_IMAGE_ADJUSTMENT_CONTROLS: PhotoImageAdjustmentControl[] = [
  { key: "exposure", label: "Exposure", ariaLabel: "Image exposure", min: -2, max: 2, step: 0.1, precision: 1 },
  { key: "contrast", label: "Contrast", ariaLabel: "Image contrast", min: -100, max: 100, step: 5 },
  { key: "highlights", label: "Highlights", ariaLabel: "Image highlights", min: -100, max: 100, step: 5 },
  { key: "shadows", label: "Shadows", ariaLabel: "Image shadows", min: -100, max: 100, step: 5 },
  { key: "brilliance", label: "Brilliance", ariaLabel: "Image brilliance", min: -100, max: 100, step: 5 },
  { key: "blackPoint", label: "Black point", ariaLabel: "Image black point", min: 0, max: 100, step: 5 },
  { key: "midtones", label: "Midtones", ariaLabel: "Image midtones", min: -100, max: 100, step: 5 },
  { key: "whitePoint", label: "White point", ariaLabel: "Image white point", min: 0, max: 100, step: 5 },
  { key: "curveShadows", label: "Curve shadows", ariaLabel: "Image curve shadows", min: -100, max: 100, step: 5 },
  { key: "curveMidtones", label: "Curve midtones", ariaLabel: "Image curve midtones", min: -100, max: 100, step: 5 },
  { key: "curveHighlights", label: "Curve highlights", ariaLabel: "Image curve highlights", min: -100, max: 100, step: 5 },
  { key: "curveRedShadows", label: "Red curve shadows", ariaLabel: "Image red curve shadows", min: -100, max: 100, step: 5 },
  { key: "curveRedMidtones", label: "Red curve midtones", ariaLabel: "Image red curve midtones", min: -100, max: 100, step: 5 },
  { key: "curveRedHighlights", label: "Red curve highlights", ariaLabel: "Image red curve highlights", min: -100, max: 100, step: 5 },
  { key: "curveGreenShadows", label: "Green curve shadows", ariaLabel: "Image green curve shadows", min: -100, max: 100, step: 5 },
  { key: "curveGreenMidtones", label: "Green curve midtones", ariaLabel: "Image green curve midtones", min: -100, max: 100, step: 5 },
  { key: "curveGreenHighlights", label: "Green curve highlights", ariaLabel: "Image green curve highlights", min: -100, max: 100, step: 5 },
  { key: "curveBlueShadows", label: "Blue curve shadows", ariaLabel: "Image blue curve shadows", min: -100, max: 100, step: 5 },
  { key: "curveBlueMidtones", label: "Blue curve midtones", ariaLabel: "Image blue curve midtones", min: -100, max: 100, step: 5 },
  { key: "curveBlueHighlights", label: "Blue curve highlights", ariaLabel: "Image blue curve highlights", min: -100, max: 100, step: 5 },
  { key: "manualCurveBlack", label: "Manual curve black", ariaLabel: "Image manual curve black point", min: -100, max: 100, step: 5 },
  { key: "manualCurveQuarter", label: "Manual curve 25%", ariaLabel: "Image manual curve quarter point", min: -100, max: 100, step: 5 },
  { key: "manualCurveMid", label: "Manual curve 50%", ariaLabel: "Image manual curve midpoint", min: -100, max: 100, step: 5 },
  { key: "manualCurveThreeQuarter", label: "Manual curve 75%", ariaLabel: "Image manual curve three-quarter point", min: -100, max: 100, step: 5 },
  { key: "manualCurveWhite", label: "Manual curve white", ariaLabel: "Image manual curve white point", min: -100, max: 100, step: 5 },
  { key: "saturation", label: "Saturation", ariaLabel: "Image saturation", min: -100, max: 100, step: 5 },
  { key: "warmth", label: "Warmth", ariaLabel: "Image warmth", min: -100, max: 100, step: 5 },
  { key: "tint", label: "Tint", ariaLabel: "Image tint", min: -100, max: 100, step: 5 },
  { key: "sharpness", label: "Sharpness", ariaLabel: "Image sharpness", min: -100, max: 100, step: 5 },
  { key: "vignette", label: "Vignette", ariaLabel: "Image vignette", min: 0, max: 100, step: 5 },
  { key: "noiseReduction", label: "Noise", ariaLabel: "Image noise reduction", min: 0, max: 100, step: 5 },
];

export function photoImageAdjustmentDisplayValue(value: number, precision = 0): string {
  const formatted = precision > 0 ? value.toFixed(precision) : String(Math.round(value));
  return `${value > 0 ? "+" : ""}${formatted}`;
}

export const PHOTO_IMAGE_AUTO_ENHANCE_PRESET: Partial<PhotoImageAdjustmentDraft> = {
  exposure: 0.2,
  contrast: 15,
  highlights: -20,
  shadows: 20,
  brilliance: 25,
  blackPoint: 5,
  midtones: 10,
  whitePoint: 5,
  saturation: 10,
  sharpness: 15,
  noiseReduction: 5,
};

export const PHOTO_IMAGE_CROP_ASPECT_OPTIONS: PhotoImageCropAspectOption[] = [
  { value: "none", label: "Original" },
  { value: "square", label: "Square" },
  { value: "landscape", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "5:4", label: "5:4" },
  { value: "portrait", label: "4:5" },
  { value: "7:5", label: "7:5" },
  { value: "5:7", label: "5:7" },
];

export const PHOTO_IMAGE_FILTER_OPTIONS: PhotoImageFilterOption[] = [
  { value: "none", label: "No filter" },
  { value: "vivid", label: "Vivid" },
  { value: "vivid_warm", label: "Vivid Warm" },
  { value: "vivid_cool", label: "Vivid Cool" },
  { value: "dramatic", label: "Dramatic" },
  { value: "dramatic_warm", label: "Dramatic Warm" },
  { value: "dramatic_cool", label: "Dramatic Cool" },
  { value: "mono", label: "Mono" },
  { value: "silvertone", label: "Silvertone" },
  { value: "noir", label: "Noir" },
];

export const DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION: PhotoImageMarkupAnnotation = {
  kind: "text",
  text: "",
  left: 8,
  top: 8,
  width: 42,
  height: 14,
  color: "#ffffff",
  backgroundColor: "#111827",
  opacity: 78,
  fontSize: 5,
};

export const DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT: PhotoImageRetouchSpot = {
  kind: "red_eye",
  left: 42,
  top: 42,
  width: 8,
  height: 8,
  strength: 80,
};

export const PHOTO_IMAGE_RETOUCH_SPOT_LIMIT = 24;

export const PHOTO_IMAGE_MANUAL_CURVE_KEYS = [
  "manualCurveBlack",
  "manualCurveQuarter",
  "manualCurveMid",
  "manualCurveThreeQuarter",
  "manualCurveWhite",
] as const satisfies readonly (keyof PhotoImageAdjustmentDraft)[];

export type PhotoImageManualCurveKey = typeof PHOTO_IMAGE_MANUAL_CURVE_KEYS[number];

export interface PhotoImageManualCurveGraphPoint {
  key: PhotoImageManualCurveKey;
  x: number;
  y: number;
  value: number;
}

const PHOTO_IMAGE_CROP_ASPECT_VALUES = new Set<PhotoImageCropAspect>(
  PHOTO_IMAGE_CROP_ASPECT_OPTIONS.map((option) => option.value)
);

const PHOTO_IMAGE_FILTER_VALUES = new Set<PhotoImageFilterPreset>(
  PHOTO_IMAGE_FILTER_OPTIONS.map((option) => option.value)
);

function photoEditStackText(value: unknown): string {
  return String(value || "").trim();
}

function photoEditStackLimitNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(1, Math.min(1000, Math.round(parsed)));
}

export function photoEditStackTargetPayload(input: {
  sourcePath?: unknown;
  assetId?: unknown;
} = {}): PhotoEditStackTargetPayload {
  return {
    sourcePath: photoEditStackText(input.sourcePath),
    assetId: photoEditStackText(input.assetId),
  };
}

export function photoEditStackSavePayload(input: {
  sourcePath?: unknown;
  assetId?: unknown;
  operations?: unknown;
} = {}): PhotoEditStackSavePayload {
  return {
    ...photoEditStackTargetPayload(input),
    operations: Array.isArray(input.operations) ? input.operations : [],
  };
}

export function photoEditStackVersionListPayload(input: {
  sourcePath?: unknown;
  assetId?: unknown;
  limit?: unknown;
} = {}): PhotoEditStackVersionListPayload {
  const payload: PhotoEditStackVersionListPayload = photoEditStackTargetPayload(input);
  const limit = photoEditStackLimitNumber(input.limit);
  if (limit !== undefined) payload.limit = limit;
  return payload;
}

export function photoEditStackVersionPayload(input: {
  sourcePath?: unknown;
  assetId?: unknown;
  versionId?: unknown;
} = {}): PhotoEditStackVersionPayload {
  return {
    ...photoEditStackTargetPayload(input),
    versionId: photoEditStackText(input.versionId),
  };
}

export function normalizePhotoImageCropAspect(value: unknown): PhotoImageCropAspect {
  const raw = String(value || "none").trim().toLowerCase().replace(/\s+/g, "").replace(/[x×]/g, ":");
  if (raw === "" || raw === "original" || raw === "source" || raw === "freeform") return "none";
  if (raw === "1:1") return "square";
  if (raw === "wide" || raw === "widescreen" || raw === "16:9") return "landscape";
  if (raw === "vertical" || raw === "4:5") return "portrait";
  return PHOTO_IMAGE_CROP_ASPECT_VALUES.has(raw as PhotoImageCropAspect) ? raw as PhotoImageCropAspect : "none";
}

export function photoImageCropAspectLabel(value: unknown): string {
  const aspect = normalizePhotoImageCropAspect(value);
  return PHOTO_IMAGE_CROP_ASPECT_OPTIONS.find((option) => option.value === aspect)?.label || "Original";
}

export function nextPhotoImageCropAspect(value: unknown): PhotoImageCropAspect {
  const current = normalizePhotoImageCropAspect(value);
  const index = PHOTO_IMAGE_CROP_ASPECT_OPTIONS.findIndex((option) => option.value === current);
  return PHOTO_IMAGE_CROP_ASPECT_OPTIONS[(index + 1) % PHOTO_IMAGE_CROP_ASPECT_OPTIONS.length].value;
}

function numericValue(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizePhotoImageRotateDegrees(value: unknown): PhotoImageRotateDegrees {
  const number = numericValue(value, 0);
  const normalized = ((Math.round(number / 90) * 90) % 360 + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

export function normalizePhotoImageStraightenDegrees(value: unknown): number {
  const number = numericValue(value, 0);
  const clamped = Math.max(-45, Math.min(45, number));
  return Math.abs(clamped) < 0.01 ? 0 : Math.round(clamped * 10) / 10;
}

function cropPercent(value: unknown, fallback: number): number {
  const number = numericValue(value, fallback);
  return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
}

export function normalizePhotoManualCropBox(value: Partial<PhotoManualCropBox> | null | undefined): PhotoManualCropBox {
  const left = cropPercent(value?.left, DEFAULT_PHOTO_MANUAL_CROP_BOX.left);
  const top = cropPercent(value?.top, DEFAULT_PHOTO_MANUAL_CROP_BOX.top);
  const maxWidth = Math.max(1, 100 - left);
  const maxHeight = Math.max(1, 100 - top);
  const width = Math.min(maxWidth, Math.max(1, cropPercent(value?.width, DEFAULT_PHOTO_MANUAL_CROP_BOX.width)));
  const height = Math.min(maxHeight, Math.max(1, cropPercent(value?.height, DEFAULT_PHOTO_MANUAL_CROP_BOX.height)));
  return { left, top, width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
}

export function photoManualCropBoxActive(value: Partial<PhotoManualCropBox> | null | undefined): boolean {
  const box = normalizePhotoManualCropBox(value);
  return box.left > 0 || box.top > 0 || box.width < 100 || box.height < 100;
}

export function photoManualCropBoxLabel(value: Partial<PhotoManualCropBox> | null | undefined): string {
  const box = normalizePhotoManualCropBox(value);
  return `Box ${box.left}/${box.top}/${box.width}/${box.height}`;
}

function cropPointPercent(value: unknown): number {
  const number = numericValue(value, 0);
  return Math.round(Math.max(0, Math.min(100, number)) * 10) / 10;
}

export function photoManualCropPointFromImageSample(
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  mediaWidthValue: unknown,
  mediaHeightValue: unknown
): PhotoManualCropPoint | null {
  if (!pointValue) return null;
  const mediaWidth = numericValue(mediaWidthValue, 0);
  const mediaHeight = numericValue(mediaHeightValue, 0);
  const x = numericValue(pointValue.x, NaN);
  const y = numericValue(pointValue.y, NaN);
  if (mediaWidth <= 0 || mediaHeight <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round((x / Math.max(1, mediaWidth - 1)) * 1000) / 10,
    y: Math.round((y / Math.max(1, mediaHeight - 1)) * 1000) / 10,
  };
}

function hexColor(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toLowerCase()}`;
  return fallback;
}

function markupNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = numericValue(value, fallback);
  return Math.round(Math.max(min, Math.min(max, number)) * 10) / 10;
}

function normalizePhotoImageMarkupKind(value: unknown): PhotoImageMarkupKind {
  const rawKind = String(value || "text").trim().toLowerCase();
  if (rawKind === "rectangle" || rawKind === "highlight" || rawKind === "ellipse" || rawKind === "line" || rawKind === "arrow" || rawKind === "freehand" || rawKind === "signature") return rawKind;
  if (rawKind === "draw" || rawKind === "drawing" || rawKind === "sketch" || rawKind === "stroke") return "freehand";
  return "text";
}

export function normalizePhotoImageMarkupPoints(values: unknown, limit = 320): PhotoManualCropPoint[] {
  const rows = Array.isArray(values) ? values : [];
  const points: PhotoManualCropPoint[] = [];
  for (const row of rows) {
    let x: unknown;
    let y: unknown;
    if (Array.isArray(row)) {
      [x, y] = row;
    } else if (row && typeof row === "object") {
      const record = row as Record<string, unknown>;
      x = record.x ?? record.left;
      y = record.y ?? record.top;
    } else {
      continue;
    }
    points.push({
      x: cropPointPercent(x),
      y: cropPointPercent(y),
    });
    if (points.length >= limit) break;
  }
  return points;
}

function photoImageMarkupBoundsFromPoints(points: PhotoManualCropPoint[]): PhotoManualCropBox | null {
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return cropBoxFromEdges(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  );
}

export function normalizePhotoImageMarkupDraftAnnotation(value: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined): PhotoImageMarkupAnnotation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = normalizePhotoImageMarkupKind(record.kind || record.type || "text");
  const text = String(record.text || record.label || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const points = normalizePhotoImageMarkupPoints(record.points ?? record.pathPoints ?? record.strokePoints ?? record.path);
  const strokePoints = kind === "freehand" || kind === "signature" ? points : [];
  const pointBounds = strokePoints.length ? photoImageMarkupBoundsFromPoints(strokePoints) : null;
  const left = pointBounds?.left ?? markupNumber(record.left ?? record.x, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.left, 0, 99);
  const top = pointBounds?.top ?? markupNumber(record.top ?? record.y, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.top, 0, 99);
  const width = pointBounds?.width ?? markupNumber(record.width ?? record.w, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.width, 1, 100 - left);
  const height = pointBounds?.height ?? markupNumber(record.height ?? record.h, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.height, 1, 100 - top);
  const annotation: PhotoImageMarkupAnnotation = {
    kind,
    ...(text ? { text } : {}),
    ...(strokePoints.length ? { points: strokePoints } : {}),
    left,
    top,
    width,
    height,
    color: hexColor(record.color ?? record.strokeColor ?? record.textColor, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.color),
    backgroundColor: hexColor(record.backgroundColor ?? record.fillColor ?? record.highlightColor, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.backgroundColor),
    opacity: markupNumber(record.opacity, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.opacity, 0, 100),
    fontSize: markupNumber(record.fontSize, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.fontSize, 1, 20),
  };
  return annotation;
}

export function normalizePhotoImageMarkupAnnotation(value: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined): PhotoImageMarkupAnnotation | null {
  const annotation = normalizePhotoImageMarkupDraftAnnotation(value);
  if (!annotation) return null;
  if (annotation.kind === "text" && !annotation.text) return null;
  if ((annotation.kind === "freehand" || annotation.kind === "signature") && (!annotation.points || annotation.points.length < 2)) return null;
  return annotation;
}

export function normalizePhotoImageMarkupAnnotations(values: unknown): PhotoImageMarkupAnnotation[] {
  const rows = Array.isArray(values) ? values : values && typeof values === "object" ? [values] : [];
  const annotations: PhotoImageMarkupAnnotation[] = [];
  for (const value of rows) {
    const annotation = normalizePhotoImageMarkupAnnotation(value as Record<string, unknown> | null | undefined);
    if (!annotation) continue;
    annotations.push(annotation);
    if (annotations.length >= 20) break;
  }
  return annotations;
}

export interface PhotoImageMarkupAddAnnotationDraft {
  annotations: PhotoImageMarkupAnnotation[];
  selectedIndex: number;
}

export function photoImageMarkupAddAnnotationDraft(
  values: readonly Partial<PhotoImageMarkupAnnotation>[] | null | undefined
): PhotoImageMarkupAddAnnotationDraft {
  const rows = Array.isArray(values) && values.length
    ? values.map((annotation) => normalizePhotoImageMarkupDraftAnnotation(annotation) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION)
    : [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION];
  const offset = Math.min(36, rows.length * 6);
  const next = normalizePhotoImageMarkupDraftAnnotation({
    ...DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION,
    left: Math.min(90, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.left + offset),
    top: Math.min(90, DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION.top + offset),
  }) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION;
  return {
    annotations: [...rows, next],
    selectedIndex: rows.length,
  };
}

export interface PhotoImageMarkupDeleteAnnotationDraft {
  annotations: PhotoImageMarkupAnnotation[];
  selectedIndex: number;
  closePanel: boolean;
}

export function photoImageMarkupDeleteAnnotationDraft(
  values: readonly Partial<PhotoImageMarkupAnnotation>[] | null | undefined,
  selectedIndexValue: unknown
): PhotoImageMarkupDeleteAnnotationDraft {
  const rows = Array.isArray(values) && values.length
    ? values.map((annotation) => normalizePhotoImageMarkupDraftAnnotation(annotation) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION)
    : [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION];
  if (rows.length <= 1) {
    return {
      annotations: [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION],
      selectedIndex: 0,
      closePanel: true,
    };
  }
  const index = Math.min(Math.max(Math.floor(numericValue(selectedIndexValue, 0)), 0), rows.length - 1);
  const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
  return {
    annotations: nextRows,
    selectedIndex: Math.min(index, nextRows.length - 1),
    closePanel: false,
  };
}

export function photoImageMarkupUpdateAnnotationDraft(
  values: readonly Partial<PhotoImageMarkupAnnotation>[] | null | undefined,
  selectedIndexValue: unknown,
  patch: Partial<PhotoImageMarkupAnnotation> | null | undefined
): PhotoImageMarkupAnnotation[] {
  const rows = Array.isArray(values) && values.length
    ? values.map((annotation) => normalizePhotoImageMarkupDraftAnnotation(annotation) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION)
    : [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION];
  const index = Math.min(Math.max(Math.floor(numericValue(selectedIndexValue, 0)), 0), rows.length - 1);
  return rows.map((annotation, rowIndex) => (
    rowIndex === index
      ? normalizePhotoImageMarkupDraftAnnotation({ ...annotation, ...patch }) || annotation
      : annotation
  ));
}

export interface PhotoImageMarkupInsertAnnotationDraft {
  annotations: PhotoImageMarkupAnnotation[];
  selectedIndex: number;
}

export function photoImageMarkupInsertAnnotationDraft(
  values: readonly Partial<PhotoImageMarkupAnnotation>[] | null | undefined,
  annotationValue: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined
): PhotoImageMarkupInsertAnnotationDraft | null {
  const annotation = normalizePhotoImageMarkupDraftAnnotation(annotationValue);
  if (!annotation) return null;
  const rows = Array.isArray(values) && values.length
    ? values.map((row) => normalizePhotoImageMarkupDraftAnnotation(row) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION)
    : [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION];
  const annotations = photoImageMarkupActive(rows) ? [...rows, annotation] : [annotation];
  return {
    annotations,
    selectedIndex: annotations.length - 1,
  };
}

export function normalizePhotoImageSignaturePreset(value: Record<string, unknown> | null | undefined): PhotoImageSignaturePreset | null {
  if (!value || typeof value !== "object") return null;
  const points = normalizePhotoImageMarkupPoints(value.points ?? value.pathPoints ?? value.strokePoints ?? value.path);
  if (points.length < 2) return null;
  const id = String(value.id || value.signatureId || "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
  const name = String(value.name || value.label || "Signature").replace(/\s+/g, " ").trim().slice(0, 48) || "Signature";
  const aspectRatio = markupNumber(value.aspectRatio, 4, 0.2, 12);
  return {
    id: id || `signature-${Math.round(points[0].x * 10)}-${Math.round(points[0].y * 10)}-${points.length}`,
    name,
    points,
    color: hexColor(value.color ?? value.strokeColor, "#111827"),
    opacity: markupNumber(value.opacity, 100, 5, 100),
    aspectRatio,
    createdAt: String(value.createdAt || value.savedAt || "").trim().slice(0, 40),
  };
}

export function normalizePhotoImageSignaturePresets(values: unknown): PhotoImageSignaturePreset[] {
  const rows = Array.isArray(values) ? values : [];
  const presets: PhotoImageSignaturePreset[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const preset = normalizePhotoImageSignaturePreset(row as Record<string, unknown> | null | undefined);
    if (!preset || seen.has(preset.id)) continue;
    seen.add(preset.id);
    presets.push(preset);
    if (presets.length >= 12) break;
  }
  return presets;
}

export function readStoredPhotoImageSignaturePresets(key: string): PhotoImageSignaturePreset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoImageSignaturePresets(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoImageSignaturePresets(key: string, values: PhotoImageSignaturePreset[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoImageSignaturePresets(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function photoImageSignaturePresetFromAnnotation(
  annotationValue: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined,
  options: { id?: string; name?: string; createdAt?: string } = {}
): PhotoImageSignaturePreset | null {
  const annotation = normalizePhotoImageMarkupDraftAnnotation({ ...(annotationValue || {}), kind: "signature" });
  if (!annotation?.points || annotation.points.length < 2) return null;
  const bounds = photoImageMarkupBoundsFromPoints(annotation.points);
  if (!bounds) return null;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const points = annotation.points.map((point) => ({
    x: cropPointPercent(((point.x - bounds.left) / width) * 100),
    y: cropPointPercent(((point.y - bounds.top) / height) * 100),
  }));
  return normalizePhotoImageSignaturePreset({
    id: options.id || "",
    name: options.name || "Signature",
    points,
    color: annotation.color,
    opacity: annotation.opacity,
    aspectRatio: Math.round((width / height) * 100) / 100,
    createdAt: options.createdAt || "",
  });
}

export interface PhotoImageSignaturePresetSaveDraft {
  preset: PhotoImageSignaturePreset;
  presets: PhotoImageSignaturePreset[];
}

export function photoImageSignaturePresetSaveDraft(
  annotationValue: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined,
  existingValues: readonly PhotoImageSignaturePreset[] | null | undefined,
  options: { id?: string; name?: string; createdAt?: string } = {}
): PhotoImageSignaturePresetSaveDraft | null {
  const preset = photoImageSignaturePresetFromAnnotation(annotationValue, options);
  if (!preset) return null;
  const existing = normalizePhotoImageSignaturePresets(existingValues);
  return {
    preset,
    presets: [
      preset,
      ...existing.filter((item) => item.id !== preset.id),
    ],
  };
}

export function photoImageSignaturePresetDeleteDraft(
  existingValues: readonly PhotoImageSignaturePreset[] | null | undefined,
  presetId: string
): PhotoImageSignaturePreset[] {
  return normalizePhotoImageSignaturePresets(existingValues).filter((item) => item.id !== presetId);
}

export function photoImageMarkupSignatureAnnotationFromPreset(
  presetValue: Record<string, unknown> | PhotoImageSignaturePreset | null | undefined,
  placement: Partial<PhotoManualCropBox> = {}
): PhotoImageMarkupAnnotation | null {
  const preset = normalizePhotoImageSignaturePreset(presetValue as Record<string, unknown> | null | undefined);
  if (!preset) return null;
  const left = markupNumber(placement.left, 18, 0, 92);
  const width = markupNumber(placement.width, 46, 8, 100 - left);
  const heightFallback = Math.max(5, Math.min(22, Math.round((width / Math.max(0.2, preset.aspectRatio)) * 10) / 10));
  const top = markupNumber(placement.top, 74, 0, 95);
  const height = markupNumber(placement.height, heightFallback, 3, 100 - top);
  const points = preset.points.map((point) => ({
    x: cropPointPercent(left + (point.x / 100) * width),
    y: cropPointPercent(top + (point.y / 100) * height),
  }));
  return normalizePhotoImageMarkupAnnotation({
    kind: "signature",
    points,
    color: preset.color,
    opacity: preset.opacity,
    left,
    top,
    width,
    height,
  });
}

export function photoImageMarkupActive(values: unknown): boolean {
  return normalizePhotoImageMarkupAnnotations(values).length > 0;
}

export function photoImageMarkupLabel(values: unknown): string {
  const annotations = normalizePhotoImageMarkupAnnotations(values);
  if (!annotations.length) return "";
  return annotations.length === 1 ? "Markup 1" : `Markup ${annotations.length}`;
}

export function photoImageMarkupHitTest(
  annotationValue: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined,
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  thresholdValue = 3
): PhotoImageMarkupDragMode | null {
  const annotation = normalizePhotoImageMarkupDraftAnnotation(annotationValue);
  if (!annotation) return null;
  const point = {
    x: cropPointPercent(pointValue?.x),
    y: cropPointPercent(pointValue?.y),
  };
  const threshold = Math.max(1, Math.min(12, Math.abs(numericValue(thresholdValue, 3))));
  const left = annotation.left;
  const top = annotation.top;
  const right = annotation.left + annotation.width;
  const bottom = annotation.top + annotation.height;
  const nearLeft = Math.abs(point.x - left) <= threshold;
  const nearRight = Math.abs(point.x - right) <= threshold;
  const nearTop = Math.abs(point.y - top) <= threshold;
  const nearBottom = Math.abs(point.y - bottom) <= threshold;
  const withinX = point.x >= left - threshold && point.x <= right + threshold;
  const withinY = point.y >= top - threshold && point.y <= bottom + threshold;
  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && withinX) return "n";
  if (nearRight && withinY) return "e";
  if (nearBottom && withinX) return "s";
  if (nearLeft && withinY) return "w";
  if (point.x >= left && point.x <= right && point.y >= top && point.y <= bottom) return "move";
  return null;
}

export function photoImageMarkupAnnotationFromDrag(
  mode: PhotoImageMarkupDragMode,
  startValue: Partial<PhotoManualCropPoint> | null | undefined,
  currentValue: Partial<PhotoManualCropPoint> | null | undefined,
  startAnnotationValue: Partial<PhotoImageMarkupAnnotation> | Record<string, unknown> | null | undefined
): PhotoImageMarkupAnnotation {
  const annotation = normalizePhotoImageMarkupDraftAnnotation(startAnnotationValue) || DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION;
  const start = {
    x: cropPointPercent(startValue?.x),
    y: cropPointPercent(startValue?.y),
  };
  const current = {
    x: cropPointPercent(currentValue?.x),
    y: cropPointPercent(currentValue?.y),
  };
  if (mode === "move") {
    const nextLeft = Math.max(0, Math.min(100 - annotation.width, annotation.left + current.x - start.x));
    const nextTop = Math.max(0, Math.min(100 - annotation.height, annotation.top + current.y - start.y));
    const deltaX = nextLeft - annotation.left;
    const deltaY = nextTop - annotation.top;
    return normalizePhotoImageMarkupDraftAnnotation({
      ...annotation,
      ...(annotation.points ? {
        points: annotation.points.map((point) => ({
          x: cropPointPercent(point.x + deltaX),
          y: cropPointPercent(point.y + deltaY),
        })),
      } : {}),
      left: nextLeft,
      top: nextTop,
    }) || annotation;
  }
  const box = normalizePhotoManualCropBox({
    left: annotation.left,
    top: annotation.top,
    width: annotation.width,
    height: annotation.height,
  });
  const left = box.left;
  const top = box.top;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const nextBox = cropBoxFromEdges(
    mode.includes("w") ? current.x : left,
    mode.includes("n") ? current.y : top,
    mode.includes("e") ? current.x : right,
    mode.includes("s") ? current.y : bottom,
  );
  return normalizePhotoImageMarkupDraftAnnotation({
    ...annotation,
    ...(annotation.points ? {
      points: annotation.points.map((point) => ({
        x: cropPointPercent(nextBox.left + ((point.x - annotation.left) / Math.max(1, annotation.width)) * nextBox.width),
        y: cropPointPercent(nextBox.top + ((point.y - annotation.top) / Math.max(1, annotation.height)) * nextBox.height),
      })),
    } : {}),
    left: nextBox.left,
    top: nextBox.top,
    width: nextBox.width,
    height: nextBox.height,
  }) || annotation;
}

function normalizePhotoImageRetouchKind(value: unknown): PhotoImageRetouchKind {
  const raw = String(value || "red_eye").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (raw === "red_eye" || raw === "redeye" || raw === "eye") return "red_eye";
  if (raw === "clone" || raw === "heal_clone" || raw === "stamp" || raw === "source") return "clone";
  if (raw === "blemish" || raw === "heal" || raw === "healing" || raw === "retouch" || raw === "cleanup" || raw === "remove") return "blemish";
  return "blemish";
}

function retouchNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = numericValue(value, fallback);
  return Math.round(Math.max(min, Math.min(max, number)) * 10) / 10;
}

export function normalizePhotoImageRetouchSpot(value: Partial<PhotoImageRetouchSpot> | Record<string, unknown> | null | undefined): PhotoImageRetouchSpot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = normalizePhotoImageRetouchKind(record.kind ?? record.type ?? record.tool ?? record.mode);
  const left = retouchNumber(record.left ?? record.x ?? record.targetLeft, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left, 0, 99);
  const top = retouchNumber(record.top ?? record.y ?? record.targetTop, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top, 0, 99);
  const width = retouchNumber(record.width ?? record.w ?? record.size, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.width, 1, 100 - left);
  const height = retouchNumber(record.height ?? record.h ?? record.size, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.height, 1, 100 - top);
  const sourceLeftRaw = record.sourceLeft ?? record.cloneLeft ?? record.sampleLeft;
  const sourceTopRaw = record.sourceTop ?? record.cloneTop ?? record.sampleTop;
  return {
    kind,
    left,
    top,
    width,
    height,
    strength: retouchNumber(record.strength ?? record.opacity ?? record.amount, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.strength, 0, 100),
    ...(kind === "clone" && sourceLeftRaw !== undefined ? { sourceLeft: retouchNumber(sourceLeftRaw, left, 0, 99) } : {}),
    ...(kind === "clone" && sourceTopRaw !== undefined ? { sourceTop: retouchNumber(sourceTopRaw, top, 0, 99) } : {}),
  };
}

export function normalizePhotoImageRetouchSpots(values: unknown): PhotoImageRetouchSpot[] {
  const rows = Array.isArray(values) ? values : values && typeof values === "object" ? [values] : [];
  const spots: PhotoImageRetouchSpot[] = [];
  for (const row of rows) {
    const spot = normalizePhotoImageRetouchSpot(row as Record<string, unknown> | null | undefined);
    if (!spot || spot.strength <= 0) continue;
    spots.push(spot);
    if (spots.length >= PHOTO_IMAGE_RETOUCH_SPOT_LIMIT) break;
  }
  return spots;
}

export function photoImageRetouchSpotMatchesDefault(value: Partial<PhotoImageRetouchSpot> | null | undefined): boolean {
  const normalized = normalizePhotoImageRetouchSpot(value);
  if (!normalized) return false;
  return normalized.left === DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left
    && normalized.top === DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top
    && normalized.sourceLeft === DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.sourceLeft
    && normalized.sourceTop === DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.sourceTop;
}

export interface PhotoImageRetouchAddSpotDraft {
  spots: PhotoImageRetouchSpot[];
  selectedIndex: number;
}

export function photoImageRetouchAddSpotDraft(
  values: readonly Partial<PhotoImageRetouchSpot>[] | null | undefined,
  kindValue: unknown
): PhotoImageRetouchAddSpotDraft {
  const rows = Array.isArray(values) && values.length
    ? values.map((spot) => normalizePhotoImageRetouchSpot(spot) || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT)
    : [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT];
  const kind = normalizePhotoImageRetouchKind(kindValue);
  const offset = Math.min(30, rows.length * 5);
  const next = normalizePhotoImageRetouchSpot({
    ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    kind,
    left: Math.min(92, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left + offset),
    top: Math.min(92, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top + offset),
    ...(kind === "clone" ? {
      sourceLeft: Math.max(0, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left + offset - 14),
      sourceTop: Math.max(0, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top + offset),
    } : {}),
  }) || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT;
  return {
    spots: [...rows, next],
    selectedIndex: rows.length,
  };
}

export interface PhotoImageRetouchDeleteSpotDraft {
  spots: PhotoImageRetouchSpot[];
  selectedIndex: number;
  closePanel: boolean;
}

export function photoImageRetouchDeleteSpotDraft(
  values: readonly Partial<PhotoImageRetouchSpot>[] | null | undefined,
  selectedIndexValue: unknown
): PhotoImageRetouchDeleteSpotDraft {
  const rows = Array.isArray(values) && values.length
    ? values.map((spot) => normalizePhotoImageRetouchSpot(spot) || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT)
    : [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT];
  if (rows.length <= 1) {
    return {
      spots: [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
      selectedIndex: 0,
      closePanel: true,
    };
  }
  const index = Math.min(Math.max(Math.floor(numericValue(selectedIndexValue, 0)), 0), rows.length - 1);
  const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
  return {
    spots: nextRows,
    selectedIndex: Math.min(index, nextRows.length - 1),
    closePanel: false,
  };
}

export function photoImageRetouchUpdateSpotDraft(
  values: readonly Partial<PhotoImageRetouchSpot>[] | null | undefined,
  selectedIndexValue: unknown,
  patch: Partial<PhotoImageRetouchSpot> | null | undefined
): PhotoImageRetouchSpot[] {
  const rows = Array.isArray(values) && values.length
    ? values.map((spot) => normalizePhotoImageRetouchSpot(spot) || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT)
    : [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT];
  const index = Math.min(Math.max(Math.floor(numericValue(selectedIndexValue, 0)), 0), rows.length - 1);
  return rows.map((spot, rowIndex) => (
    rowIndex === index
      ? normalizePhotoImageRetouchSpot({ ...spot, ...patch }) || spot
      : spot
  ));
}

export type PhotoImageRetouchBrushOptions = Partial<PhotoImageRetouchSpot> & {
  existingCount?: number;
  spacing?: number;
  limit?: number;
};

export function photoImageRetouchBoxStartFromCenter(centerValue: unknown, sizeValue: unknown): number {
  const center = numericValue(centerValue, 0);
  const size = numericValue(sizeValue, 0);
  const max = Math.max(0, 100 - size);
  return Math.round(Math.max(0, Math.min(max, center - size / 2)) * 10) / 10;
}

export function photoImageRetouchCloneSourcePatch(
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  spotValue: Partial<PhotoImageRetouchSpot> | null | undefined
): (Partial<PhotoImageRetouchSpot> & { kind: "clone"; sourceLeft: number; sourceTop: number }) | null {
  const x = numericValue(pointValue?.x, NaN);
  const y = numericValue(pointValue?.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const spot = normalizePhotoImageRetouchSpot({
    ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    ...spotValue,
    kind: "clone",
  }) || { ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT, kind: "clone" as const };
  return {
    kind: "clone",
    sourceLeft: photoImageRetouchBoxStartFromCenter(x, spot.width),
    sourceTop: photoImageRetouchBoxStartFromCenter(y, spot.height),
  };
}

export function photoImageRetouchKindPatch(
  kindValue: unknown,
  spotValue: Partial<PhotoImageRetouchSpot> | null | undefined
): Partial<PhotoImageRetouchSpot> & { kind: PhotoImageRetouchKind } {
  const kind = normalizePhotoImageRetouchKind(kindValue);
  const patch: Partial<PhotoImageRetouchSpot> & { kind: PhotoImageRetouchKind } = { kind };
  if (kind !== "clone" || spotValue?.sourceLeft !== undefined) return patch;
  const spot = normalizePhotoImageRetouchSpot({
    ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    ...spotValue,
    kind,
  }) || { ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT, kind };
  return {
    ...patch,
    sourceLeft: Math.max(0, spot.left - 14),
    sourceTop: spot.top,
  };
}

export function photoImageRetouchBrushSpotsFromPoints(
  points: readonly Partial<PhotoManualCropPoint>[] | null | undefined,
  options: PhotoImageRetouchBrushOptions = {}
): PhotoImageRetouchSpot[] {
  const rows = Array.isArray(points) ? points : [];
  const limit = Math.max(0, Math.min(
    PHOTO_IMAGE_RETOUCH_SPOT_LIMIT,
    Math.floor(numericValue(options.limit, PHOTO_IMAGE_RETOUCH_SPOT_LIMIT))
  ));
  const existingCount = Math.max(0, Math.floor(numericValue(options.existingCount, 0)));
  const remaining = Math.max(0, limit - existingCount);
  if (!rows.length || remaining <= 0) return [];
  const kind = normalizePhotoImageRetouchKind(options.kind);
  const template = normalizePhotoImageRetouchSpot({
    ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    ...options,
    kind,
    ...(kind === "clone" && options.sourceLeft === undefined ? { sourceLeft: Math.max(0, numericValue(options.left, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left) - 14) } : {}),
    ...(kind === "clone" && options.sourceTop === undefined ? { sourceTop: numericValue(options.top, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top) } : {}),
  }) || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT;
  const width = template.width;
  const height = template.height;
  const spacing = Math.max(0.1, Math.min(100, numericValue(options.spacing, Math.max(width, height) * 0.6)));
  const sourceLeftOffset = kind === "clone" ? numericValue(template.sourceLeft, Math.max(0, template.left - 14)) - template.left : 0;
  const sourceTopOffset = kind === "clone" ? numericValue(template.sourceTop, template.top) - template.top : 0;
  const spots: PhotoImageRetouchSpot[] = [];
  let lastPoint: PhotoManualCropPoint | null = null;
  for (const rawPoint of rows) {
    const rawX = numericValue(rawPoint?.x, NaN);
    const rawY = numericValue(rawPoint?.y, NaN);
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;
    const point = {
      x: Math.max(0, Math.min(100, rawX)),
      y: Math.max(0, Math.min(100, rawY)),
    };
    if (lastPoint && Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) < spacing) continue;
    const left = photoImageRetouchBoxStartFromCenter(point.x, width);
    const top = photoImageRetouchBoxStartFromCenter(point.y, height);
    const spot = normalizePhotoImageRetouchSpot({
      kind,
      left,
      top,
      width,
      height,
      strength: template.strength,
      ...(kind === "clone" ? {
        sourceLeft: Math.max(0, Math.min(99, left + sourceLeftOffset)),
        sourceTop: Math.max(0, Math.min(99, top + sourceTopOffset)),
      } : {}),
    });
    if (!spot) continue;
    spots.push(spot);
    lastPoint = point;
    if (spots.length >= remaining) break;
  }
  return spots;
}

export function photoImageRetouchBrushStateFromPoint(
  pointerIdValue: unknown,
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  spotValue: Partial<PhotoImageRetouchSpot> | null | undefined
): ImageRetouchBrushState | null {
  const pointerId = Math.floor(numericValue(pointerIdValue, NaN));
  const x = numericValue(pointValue?.x, NaN);
  const y = numericValue(pointValue?.y, NaN);
  if (!Number.isFinite(pointerId) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const kind = normalizePhotoImageRetouchKind(spotValue?.kind ?? "blemish");
  const template = normalizePhotoImageRetouchSpot({
    ...spotValue,
    kind,
    ...(kind === "clone" && spotValue?.sourceLeft === undefined ? { sourceLeft: Math.max(0, numericValue(spotValue?.left, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.left) - 14) } : {}),
    ...(kind === "clone" && spotValue?.sourceTop === undefined ? { sourceTop: numericValue(spotValue?.top, DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT.top) } : {}),
  }) || { ...DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT, kind };
  return {
    pointerId,
    lastPoint: {
      x: cropPointPercent(x),
      y: cropPointPercent(y),
    },
    spacing: Math.max(0.75, Math.max(template.width, template.height) * 0.6),
    template,
  };
}

export interface PhotoImageRetouchAppendBrushPointDraft {
  spots: PhotoImageRetouchSpot[];
  selectedIndex: number | null;
  limitReached: boolean;
}

export function photoImageRetouchAppendBrushPointDraft(
  values: readonly Partial<PhotoImageRetouchSpot>[] | null | undefined,
  point: Partial<PhotoManualCropPoint> | null | undefined,
  brush: Pick<ImageRetouchBrushState, "spacing" | "template"> | null | undefined,
  replaceDefaultOnly = false
): PhotoImageRetouchAppendBrushPointDraft {
  const rows = normalizePhotoImageRetouchSpots(
    Array.isArray(values) && values.length ? values : [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT]
  );
  const baseRows = replaceDefaultOnly && rows.length === 1 && photoImageRetouchSpotMatchesDefault(rows[0])
    ? []
    : rows;
  const brushSpots = photoImageRetouchBrushSpotsFromPoints([point || {}], {
    ...(brush?.template || DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT),
    existingCount: baseRows.length,
    spacing: brush?.spacing,
  });
  if (!brushSpots.length) {
    return {
      spots: baseRows.length ? baseRows : [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
      selectedIndex: null,
      limitReached: baseRows.length >= PHOTO_IMAGE_RETOUCH_SPOT_LIMIT,
    };
  }
  const spots = [...baseRows, ...brushSpots];
  return {
    spots,
    selectedIndex: spots.length - 1,
    limitReached: false,
  };
}

export function photoImageRetouchActive(values: unknown): boolean {
  return normalizePhotoImageRetouchSpots(values).length > 0;
}

export function photoImageRetouchLabel(values: unknown): string {
  const spots = normalizePhotoImageRetouchSpots(values);
  if (!spots.length) return "";
  const redEye = spots.filter((spot) => spot.kind === "red_eye").length;
  const clone = spots.filter((spot) => spot.kind === "clone").length;
  const blemish = spots.length - redEye - clone;
  const parts = [
    redEye ? `Red-eye ${redEye}` : "",
    blemish ? `Retouch ${blemish}` : "",
    clone ? `Clone ${clone}` : "",
  ].filter(Boolean);
  return parts.join(" / ");
}

function cropBoxFromEdges(leftValue: number, topValue: number, rightValue: number, bottomValue: number): PhotoManualCropBox {
  let left = cropPointPercent(Math.min(leftValue, rightValue));
  let right = cropPointPercent(Math.max(leftValue, rightValue));
  let top = cropPointPercent(Math.min(topValue, bottomValue));
  let bottom = cropPointPercent(Math.max(topValue, bottomValue));
  if (right - left < 1) {
    right = Math.min(100, left + 1);
    left = Math.max(0, Math.min(left, right - 1));
  }
  if (bottom - top < 1) {
    bottom = Math.min(100, top + 1);
    top = Math.max(0, Math.min(top, bottom - 1));
  }
  return normalizePhotoManualCropBox({
    left,
    top,
    width: right - left,
    height: bottom - top,
  });
}

export function photoManualCropHitTest(
  value: Partial<PhotoManualCropBox> | null | undefined,
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  thresholdValue = 3
): PhotoManualCropDragMode {
  const box = normalizePhotoManualCropBox(value);
  const point = {
    x: cropPointPercent(pointValue?.x),
    y: cropPointPercent(pointValue?.y),
  };
  const threshold = Math.max(1, Math.min(12, Math.abs(numericValue(thresholdValue, 3))));
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const nearLeft = Math.abs(point.x - box.left) <= threshold;
  const nearRight = Math.abs(point.x - right) <= threshold;
  const nearTop = Math.abs(point.y - box.top) <= threshold;
  const nearBottom = Math.abs(point.y - bottom) <= threshold;
  const withinX = point.x >= box.left - threshold && point.x <= right + threshold;
  const withinY = point.y >= box.top - threshold && point.y <= bottom + threshold;
  if (nearLeft && nearTop) return "nw";
  if (nearRight && nearTop) return "ne";
  if (nearLeft && nearBottom) return "sw";
  if (nearRight && nearBottom) return "se";
  if (nearTop && withinX) return "n";
  if (nearRight && withinY) return "e";
  if (nearBottom && withinX) return "s";
  if (nearLeft && withinY) return "w";
  if (point.x >= box.left && point.x <= right && point.y >= box.top && point.y <= bottom) return "move";
  return "create";
}

export function photoManualCropBoxFromDrag(
  mode: PhotoManualCropDragMode,
  startValue: Partial<PhotoManualCropPoint> | null | undefined,
  currentValue: Partial<PhotoManualCropPoint> | null | undefined,
  startBoxValue: Partial<PhotoManualCropBox> | null | undefined
): PhotoManualCropBox {
  const start = {
    x: cropPointPercent(startValue?.x),
    y: cropPointPercent(startValue?.y),
  };
  const current = {
    x: cropPointPercent(currentValue?.x),
    y: cropPointPercent(currentValue?.y),
  };
  const startBox = normalizePhotoManualCropBox(startBoxValue);
  const left = startBox.left;
  const top = startBox.top;
  const right = startBox.left + startBox.width;
  const bottom = startBox.top + startBox.height;
  if (mode === "create") return cropBoxFromEdges(start.x, start.y, current.x, current.y);
  if (mode === "move") {
    const nextLeft = Math.max(0, Math.min(100 - startBox.width, left + current.x - start.x));
    const nextTop = Math.max(0, Math.min(100 - startBox.height, top + current.y - start.y));
    return normalizePhotoManualCropBox({
      ...startBox,
      left: nextLeft,
      top: nextTop,
    });
  }
  const nextLeft = mode.includes("w") ? current.x : left;
  const nextRight = mode.includes("e") ? current.x : right;
  const nextTop = mode.includes("n") ? current.y : top;
  const nextBottom = mode.includes("s") ? current.y : bottom;
  return cropBoxFromEdges(nextLeft, nextTop, nextRight, nextBottom);
}

function adjustmentValue(value: unknown, min: number, max: number, step = 1): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const rounded = Math.round(number / step) * step;
  return Math.round(Math.max(min, Math.min(max, rounded)) * 10) / 10;
}

export function normalizePhotoImageAdjustments(value: Partial<PhotoImageAdjustmentDraft> | null | undefined): PhotoImageAdjustmentDraft {
  return {
    exposure: adjustmentValue(value?.exposure, -2, 2, 0.1),
    contrast: adjustmentValue(value?.contrast, -100, 100, 1),
    highlights: adjustmentValue(value?.highlights, -100, 100, 1),
    shadows: adjustmentValue(value?.shadows, -100, 100, 1),
    brilliance: adjustmentValue(value?.brilliance, -100, 100, 1),
    blackPoint: adjustmentValue(value?.blackPoint, 0, 100, 1),
    midtones: adjustmentValue(value?.midtones, -100, 100, 1),
    whitePoint: adjustmentValue(value?.whitePoint, 0, 100, 1),
    curveShadows: adjustmentValue(value?.curveShadows, -100, 100, 1),
    curveMidtones: adjustmentValue(value?.curveMidtones, -100, 100, 1),
    curveHighlights: adjustmentValue(value?.curveHighlights, -100, 100, 1),
    curveRedShadows: adjustmentValue(value?.curveRedShadows, -100, 100, 1),
    curveRedMidtones: adjustmentValue(value?.curveRedMidtones, -100, 100, 1),
    curveRedHighlights: adjustmentValue(value?.curveRedHighlights, -100, 100, 1),
    curveGreenShadows: adjustmentValue(value?.curveGreenShadows, -100, 100, 1),
    curveGreenMidtones: adjustmentValue(value?.curveGreenMidtones, -100, 100, 1),
    curveGreenHighlights: adjustmentValue(value?.curveGreenHighlights, -100, 100, 1),
    curveBlueShadows: adjustmentValue(value?.curveBlueShadows, -100, 100, 1),
    curveBlueMidtones: adjustmentValue(value?.curveBlueMidtones, -100, 100, 1),
    curveBlueHighlights: adjustmentValue(value?.curveBlueHighlights, -100, 100, 1),
    manualCurveBlack: adjustmentValue(value?.manualCurveBlack, -100, 100, 1),
    manualCurveQuarter: adjustmentValue(value?.manualCurveQuarter, -100, 100, 1),
    manualCurveMid: adjustmentValue(value?.manualCurveMid, -100, 100, 1),
    manualCurveThreeQuarter: adjustmentValue(value?.manualCurveThreeQuarter, -100, 100, 1),
    manualCurveWhite: adjustmentValue(value?.manualCurveWhite, -100, 100, 1),
    saturation: adjustmentValue(value?.saturation, -100, 100, 1),
    warmth: adjustmentValue(value?.warmth, -100, 100, 1),
    tint: adjustmentValue(value?.tint, -100, 100, 1),
    sharpness: adjustmentValue(value?.sharpness, -100, 100, 1),
    vignette: adjustmentValue(value?.vignette, 0, 100, 1),
    noiseReduction: adjustmentValue(value?.noiseReduction, 0, 100, 1),
  };
}

function photoImageAutoEnhanceNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = numericValue(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function photoImageAutoEnhanceStep(value: number, min: number, max: number, step = 5): number {
  return adjustmentValue(value, min, max, step);
}

export function photoImageWhiteBalanceAdjustments(
  value: Partial<PhotoImageAdjustmentDraft> | null | undefined,
  sampleValue: Partial<PhotoImageRgbSample> | null | undefined
): PhotoImageAdjustmentDraft {
  const current = normalizePhotoImageAdjustments(value);
  if (!sampleValue) return current;
  const red = photoImageAutoEnhanceNumber(sampleValue.red, 0, 0, 255);
  const green = photoImageAutoEnhanceNumber(sampleValue.green, 0, 0, 255);
  const blue = photoImageAutoEnhanceNumber(sampleValue.blue, 0, 0, 255);
  const warmthDelta = ((blue - red) / 255) * 120;
  const tintDelta = ((green - ((red + blue) / 2)) / 255) * 140;
  return normalizePhotoImageAdjustments({
    ...current,
    warmth: current.warmth + warmthDelta,
    tint: current.tint + tintDelta,
  });
}

export function photoImageRgbSampleFromPixels(pixels: ArrayLike<number> | null | undefined): PhotoImageRgbSample | null {
  const length = pixels?.length || 0;
  if (!pixels || length < 4) return null;
  let red = 0;
  let green = 0;
  let blue = 0;
  const count = Math.max(1, length / 4);
  for (let index = 0; index < length; index += 4) {
    red += pixels[index] || 0;
    green += pixels[index + 1] || 0;
    blue += pixels[index + 2] || 0;
  }
  return { red: red / count, green: green / count, blue: blue / count };
}

export function photoImageSampleRectAroundPoint(
  pointValue: Partial<PhotoManualCropPoint> | null | undefined,
  mediaWidthValue: unknown,
  mediaHeightValue: unknown,
  sampleSizeValue = 5
): PhotoImageSampleRect | null {
  if (!pointValue) return null;
  const mediaWidth = numericValue(mediaWidthValue, 0);
  const mediaHeight = numericValue(mediaHeightValue, 0);
  const sampleSize = Math.max(1, Math.round(numericValue(sampleSizeValue, 5)));
  const x = numericValue(pointValue.x, NaN);
  const y = numericValue(pointValue.y, NaN);
  if (mediaWidth <= 0 || mediaHeight <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const radius = Math.floor(sampleSize / 2);
  const left = Math.max(0, x - radius);
  const top = Math.max(0, y - radius);
  const width = Math.min(mediaWidth - left, sampleSize);
  const height = Math.min(mediaHeight - top, sampleSize);
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

export function photoImageAutoEnhanceSampleSize(
  mediaWidthValue: unknown,
  mediaHeightValue: unknown,
  maxDimensionValue = 128
): PhotoImageSampleSize | null {
  const mediaWidth = numericValue(mediaWidthValue, 0);
  const mediaHeight = numericValue(mediaHeightValue, 0);
  const maxDimension = Math.max(1, Math.round(numericValue(maxDimensionValue, 128)));
  if (mediaWidth <= 0 || mediaHeight <= 0) return null;
  const scale = Math.min(1, maxDimension / Math.max(mediaWidth, mediaHeight));
  return {
    width: Math.max(1, Math.round(mediaWidth * scale)),
    height: Math.max(1, Math.round(mediaHeight * scale)),
  };
}

function photoImageAutoEnhancePercentile(sortedValues: number[], ratio: number): number {
  if (!sortedValues.length) return 0;
  const index = Math.max(0, Math.min(sortedValues.length - 1, Math.round((sortedValues.length - 1) * ratio)));
  return sortedValues[index] || 0;
}

export function photoImageAutoEnhanceStatsFromPixels(
  pixels: ArrayLike<number> | null | undefined,
  stride = 4
): PhotoImageAutoEnhanceStats | null {
  const safeStride = Math.max(3, Math.round(numericValue(stride, 4)));
  const length = pixels?.length || 0;
  if (!pixels || length < 3) return null;
  const lumas: number[] = [];
  let redTotal = 0;
  let greenTotal = 0;
  let blueTotal = 0;
  let saturationTotal = 0;
  for (let index = 0; index + 2 < length; index += safeStride) {
    const alpha = safeStride >= 4 ? numericValue(pixels[index + 3], 255) : 255;
    if (alpha <= 8) continue;
    const red = photoImageAutoEnhanceNumber(pixels[index], 0, 0, 255);
    const green = photoImageAutoEnhanceNumber(pixels[index + 1], 0, 0, 255);
    const blue = photoImageAutoEnhanceNumber(pixels[index + 2], 0, 0, 255);
    const luma = (red * 0.2126) + (green * 0.7152) + (blue * 0.0722);
    const maxChannel = Math.max(red, green, blue);
    const minChannel = Math.min(red, green, blue);
    redTotal += red;
    greenTotal += green;
    blueTotal += blue;
    saturationTotal += maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
    lumas.push(luma);
  }
  const pixelCount = lumas.length;
  if (!pixelCount) return null;
  lumas.sort((left, right) => left - right);
  const lumaTotal = lumas.reduce((total, luma) => total + luma, 0);
  const averageLuma = lumaTotal / pixelCount;
  const lumaVariance = lumas.reduce((total, luma) => total + ((luma - averageLuma) ** 2), 0) / pixelCount;
  const lumaP01 = photoImageAutoEnhancePercentile(lumas, 0.01);
  const lumaP05 = photoImageAutoEnhancePercentile(lumas, 0.05);
  const lumaP50 = photoImageAutoEnhancePercentile(lumas, 0.5);
  const lumaP95 = photoImageAutoEnhancePercentile(lumas, 0.95);
  const lumaP99 = photoImageAutoEnhancePercentile(lumas, 0.99);
  return {
    pixelCount,
    lumaStdDev: Math.round(Math.sqrt(lumaVariance) * 10) / 10,
    lumaP01: Math.round(lumaP01 * 10) / 10,
    lumaP05: Math.round(lumaP05 * 10) / 10,
    lumaP50: Math.round(lumaP50 * 10) / 10,
    lumaP95: Math.round(lumaP95 * 10) / 10,
    lumaP99: Math.round(lumaP99 * 10) / 10,
    averageLuma: Math.round(averageLuma * 10) / 10,
    shadowLuma: Math.round(lumaP05 * 10) / 10,
    highlightLuma: Math.round(lumaP95 * 10) / 10,
    shadowShare: Math.round((lumas.filter((luma) => luma < 64).length / pixelCount) * 1000) / 1000,
    highlightShare: Math.round((lumas.filter((luma) => luma > 192).length / pixelCount) * 1000) / 1000,
    clippedShadowShare: Math.round((lumas.filter((luma) => luma <= 4).length / pixelCount) * 1000) / 1000,
    clippedHighlightShare: Math.round((lumas.filter((luma) => luma >= 251).length / pixelCount) * 1000) / 1000,
    averageSaturation: Math.round((saturationTotal / pixelCount) * 1000) / 1000,
    redAverage: Math.round((redTotal / pixelCount) * 10) / 10,
    greenAverage: Math.round((greenTotal / pixelCount) * 10) / 10,
    blueAverage: Math.round((blueTotal / pixelCount) * 10) / 10,
  };
}

function photoImageAutoEnhancePresetFromStats(stats: PhotoImageAutoEnhanceStats | null | undefined): Partial<PhotoImageAdjustmentDraft> {
  if (!stats || !Number.isFinite(stats.averageLuma) || !Number.isFinite(stats.shadowLuma) || !Number.isFinite(stats.highlightLuma)) {
    return PHOTO_IMAGE_AUTO_ENHANCE_PRESET;
  }
  const averageLuma = photoImageAutoEnhanceNumber(stats.averageLuma, 128, 0, 255);
  const shadowLuma = photoImageAutoEnhanceNumber(stats.shadowLuma, Math.max(0, averageLuma - 48), 0, 255);
  const highlightLuma = photoImageAutoEnhanceNumber(stats.highlightLuma, Math.min(255, averageLuma + 48), 0, 255);
  const tonalRange = Math.max(1, highlightLuma - shadowLuma);
  const saturation = photoImageAutoEnhanceNumber(stats.averageSaturation, 0.22, 0, 1);
  const underExposure = (128 - averageLuma) / 128;
  const highlightPressure = Math.max(0, (highlightLuma - 210) / 45) + (photoImageAutoEnhanceNumber(stats.clippedHighlightShare, 0, 0, 1) * 1.4);
  const shadowPressure = Math.max(0, (78 - shadowLuma) / 78) + (photoImageAutoEnhanceNumber(stats.clippedShadowShare, 0, 0, 1) * 1.1);
  const lowContrast = Math.max(0, (42 - photoImageAutoEnhanceNumber(stats.lumaStdDev, 42, 0, 128)) / 42);
  const flatness = Math.max(Math.max(0, (145 - tonalRange) / 145), lowContrast);
  const exposure = adjustmentValue(0.12 + (underExposure * 0.5) - (highlightPressure * 0.2), -0.5, 0.8, 0.1);
  const contrast = photoImageAutoEnhanceStep(8 + (flatness * 24) - Math.max(0, (tonalRange - 190) / 10), 0, 35);
  const highlights = photoImageAutoEnhanceStep(-10 - (highlightPressure * 30) - Math.max(0, averageLuma - 178) / 8, -45, -5);
  const shadows = photoImageAutoEnhanceStep(10 + (shadowPressure * 30) + Math.max(0, 112 - averageLuma) / 6, 5, 45);
  const brilliance = photoImageAutoEnhanceStep(18 + (flatness * 14) + (shadowPressure * 8), 10, 40);
  const blackPoint = photoImageAutoEnhanceStep(4 + Math.max(0, 42 - shadowLuma) / 7 - Math.max(0, shadowLuma - 96) / 18, 0, 15);
  const midtones = photoImageAutoEnhanceStep(6 + Math.max(0, 122 - averageLuma) / 9 - Math.max(0, averageLuma - 172) / 18, -5, 20);
  const whitePoint = photoImageAutoEnhanceStep(5 + Math.max(0, 190 - highlightLuma) / 12 - highlightPressure * 4, 0, 15);
  const saturationBoost = photoImageAutoEnhanceStep(6 + Math.max(0, 0.34 - saturation) * 45 - Math.max(0, saturation - 0.58) * 35, 0, 20);
  const sharpness = photoImageAutoEnhanceStep(12 + flatness * 8, 10, 20);
  const noiseReduction = photoImageAutoEnhanceStep(averageLuma < 78 || shadowLuma < 22 ? 10 : 5, 0, 15);
  return {
    exposure,
    contrast,
    highlights,
    shadows,
    brilliance,
    blackPoint,
    midtones,
    whitePoint,
    saturation: saturationBoost,
    sharpness,
    noiseReduction,
  };
}

export function photoImageAutoEnhanceAdjustments(
  value: Partial<PhotoImageAdjustmentDraft> | null | undefined,
  stats?: PhotoImageAutoEnhanceStats | null
): PhotoImageAdjustmentDraft {
  const current = normalizePhotoImageAdjustments(value);
  return normalizePhotoImageAdjustments({
    ...current,
    ...photoImageAutoEnhancePresetFromStats(stats),
    warmth: current.warmth,
    tint: current.tint,
    curveShadows: current.curveShadows,
    curveMidtones: current.curveMidtones,
    curveHighlights: current.curveHighlights,
    curveRedShadows: current.curveRedShadows,
    curveRedMidtones: current.curveRedMidtones,
    curveRedHighlights: current.curveRedHighlights,
    curveGreenShadows: current.curveGreenShadows,
    curveGreenMidtones: current.curveGreenMidtones,
    curveGreenHighlights: current.curveGreenHighlights,
    curveBlueShadows: current.curveBlueShadows,
    curveBlueMidtones: current.curveBlueMidtones,
    curveBlueHighlights: current.curveBlueHighlights,
    manualCurveBlack: current.manualCurveBlack,
    manualCurveQuarter: current.manualCurveQuarter,
    manualCurveMid: current.manualCurveMid,
    manualCurveThreeQuarter: current.manualCurveThreeQuarter,
    manualCurveWhite: current.manualCurveWhite,
    vignette: current.vignette,
  });
}

export function photoImageManualCurveValueToGraphY(value: unknown, height = 100): number {
  const normalized = adjustmentValue(value, -100, 100, 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 100);
  return Math.round(((100 - normalized) / 200) * safeHeight * 10) / 10;
}

export function photoImageManualCurveGraphYToValue(y: unknown, height = 100, step = 5): number {
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 100);
  const safeY = Math.max(0, Math.min(safeHeight, Number(y) || 0));
  return adjustmentValue(100 - (safeY / safeHeight) * 200, -100, 100, step);
}

export function photoImageManualCurveKeyForGraphX(x: unknown, width = 200): PhotoImageManualCurveKey {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 200);
  const safeX = Math.max(0, Math.min(safeWidth, Number(x) || 0));
  const index = Math.max(0, Math.min(PHOTO_IMAGE_MANUAL_CURVE_KEYS.length - 1, Math.round((safeX / safeWidth) * (PHOTO_IMAGE_MANUAL_CURVE_KEYS.length - 1))));
  return PHOTO_IMAGE_MANUAL_CURVE_KEYS[index];
}

export function photoImageManualCurveGraphPoints(
  value: Partial<PhotoImageAdjustmentDraft> | null | undefined,
  width = 200,
  height = 100
): PhotoImageManualCurveGraphPoint[] {
  const adjustments = normalizePhotoImageAdjustments(value);
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 200);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 100);
  return PHOTO_IMAGE_MANUAL_CURVE_KEYS.map((key, index) => {
    const x = Math.round(((index / (PHOTO_IMAGE_MANUAL_CURVE_KEYS.length - 1)) * safeWidth) * 10) / 10;
    return {
      key,
      x,
      y: photoImageManualCurveValueToGraphY(adjustments[key], safeHeight),
      value: adjustments[key],
    };
  });
}

export function photoImageManualCurveSvgPath(
  value: Partial<PhotoImageAdjustmentDraft> | null | undefined,
  width = 200,
  height = 100
): string {
  const points = photoImageManualCurveGraphPoints(value, width, height);
  if (!points.length) return "";
  const [first, ...rest] = points;
  return rest.reduce((path, point, index) => {
    const previous = points[index];
    const controlOffset = (point.x - previous.x) / 2;
    return `${path} C ${Math.round((previous.x + controlOffset) * 10) / 10} ${previous.y}, ${Math.round((point.x - controlOffset) * 10) / 10} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${first.x} ${first.y}`);
}

export function photoImageAdjustmentsActive(value: Partial<PhotoImageAdjustmentDraft> | null | undefined): boolean {
  const adjustments = normalizePhotoImageAdjustments(value);
  return Object.values(adjustments).some((number) => Math.abs(number) >= 0.01);
}

export function photoImageAdjustmentsLabel(value: Partial<PhotoImageAdjustmentDraft> | null | undefined): string {
  const adjustments = normalizePhotoImageAdjustments(value);
  const parts = [
    adjustments.exposure ? `E${adjustments.exposure > 0 ? "+" : ""}${adjustments.exposure.toFixed(1)}` : "",
    adjustments.contrast ? `C${adjustments.contrast > 0 ? "+" : ""}${adjustments.contrast}` : "",
    adjustments.highlights ? `Hi${adjustments.highlights > 0 ? "+" : ""}${adjustments.highlights}` : "",
    adjustments.shadows ? `Sd${adjustments.shadows > 0 ? "+" : ""}${adjustments.shadows}` : "",
    adjustments.brilliance ? `Br${adjustments.brilliance > 0 ? "+" : ""}${adjustments.brilliance}` : "",
    adjustments.blackPoint ? `Bk${adjustments.blackPoint}` : "",
    adjustments.midtones ? `Mt${adjustments.midtones > 0 ? "+" : ""}${adjustments.midtones}` : "",
    adjustments.whitePoint ? `Wt${adjustments.whitePoint}` : "",
    adjustments.curveShadows ? `CvS${adjustments.curveShadows > 0 ? "+" : ""}${adjustments.curveShadows}` : "",
    adjustments.curveMidtones ? `CvM${adjustments.curveMidtones > 0 ? "+" : ""}${adjustments.curveMidtones}` : "",
    adjustments.curveHighlights ? `CvH${adjustments.curveHighlights > 0 ? "+" : ""}${adjustments.curveHighlights}` : "",
    adjustments.curveRedShadows ? `RCvS${adjustments.curveRedShadows > 0 ? "+" : ""}${adjustments.curveRedShadows}` : "",
    adjustments.curveRedMidtones ? `RCvM${adjustments.curveRedMidtones > 0 ? "+" : ""}${adjustments.curveRedMidtones}` : "",
    adjustments.curveRedHighlights ? `RCvH${adjustments.curveRedHighlights > 0 ? "+" : ""}${adjustments.curveRedHighlights}` : "",
    adjustments.curveGreenShadows ? `GCvS${adjustments.curveGreenShadows > 0 ? "+" : ""}${adjustments.curveGreenShadows}` : "",
    adjustments.curveGreenMidtones ? `GCvM${adjustments.curveGreenMidtones > 0 ? "+" : ""}${adjustments.curveGreenMidtones}` : "",
    adjustments.curveGreenHighlights ? `GCvH${adjustments.curveGreenHighlights > 0 ? "+" : ""}${adjustments.curveGreenHighlights}` : "",
    adjustments.curveBlueShadows ? `BCvS${adjustments.curveBlueShadows > 0 ? "+" : ""}${adjustments.curveBlueShadows}` : "",
    adjustments.curveBlueMidtones ? `BCvM${adjustments.curveBlueMidtones > 0 ? "+" : ""}${adjustments.curveBlueMidtones}` : "",
    adjustments.curveBlueHighlights ? `BCvH${adjustments.curveBlueHighlights > 0 ? "+" : ""}${adjustments.curveBlueHighlights}` : "",
    adjustments.manualCurveBlack ? `MC0${adjustments.manualCurveBlack > 0 ? "+" : ""}${adjustments.manualCurveBlack}` : "",
    adjustments.manualCurveQuarter ? `MC25${adjustments.manualCurveQuarter > 0 ? "+" : ""}${adjustments.manualCurveQuarter}` : "",
    adjustments.manualCurveMid ? `MC50${adjustments.manualCurveMid > 0 ? "+" : ""}${adjustments.manualCurveMid}` : "",
    adjustments.manualCurveThreeQuarter ? `MC75${adjustments.manualCurveThreeQuarter > 0 ? "+" : ""}${adjustments.manualCurveThreeQuarter}` : "",
    adjustments.manualCurveWhite ? `MC100${adjustments.manualCurveWhite > 0 ? "+" : ""}${adjustments.manualCurveWhite}` : "",
    adjustments.saturation ? `S${adjustments.saturation > 0 ? "+" : ""}${adjustments.saturation}` : "",
    adjustments.warmth ? `W${adjustments.warmth > 0 ? "+" : ""}${adjustments.warmth}` : "",
    adjustments.tint ? `Ti${adjustments.tint > 0 ? "+" : ""}${adjustments.tint}` : "",
    adjustments.sharpness ? `Sh${adjustments.sharpness > 0 ? "+" : ""}${adjustments.sharpness}` : "",
    adjustments.vignette ? `Vg${adjustments.vignette}` : "",
    adjustments.noiseReduction ? `Nr${adjustments.noiseReduction}` : "",
  ].filter(Boolean);
  return parts.length ? `Adj ${parts.join("/")}` : "";
}

export function normalizePhotoImageFilterPreset(value: unknown): PhotoImageFilterPreset {
  const raw = String(value || "none").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const compact = raw.replace(/_/g, "");
  if (!raw || raw === "original" || raw === "standard" || raw === "nofilter" || raw === "none") return "none";
  if (compact === "vividwarm") return "vivid_warm";
  if (compact === "vividcool") return "vivid_cool";
  if (compact === "dramaticwarm") return "dramatic_warm";
  if (compact === "dramaticcool") return "dramatic_cool";
  if (compact === "silvertoned" || compact === "silvertone" || compact === "silvertonefilter") return "silvertone";
  if (compact === "blackwhite" || compact === "blackandwhite" || compact === "bw" || compact === "monochrome") return "mono";
  return PHOTO_IMAGE_FILTER_VALUES.has(raw as PhotoImageFilterPreset) ? raw as PhotoImageFilterPreset : "none";
}

export function photoImageFilterPresetActive(value: unknown): boolean {
  return normalizePhotoImageFilterPreset(value) !== "none";
}

export function normalizePhotoImageFilterIntensity(value: unknown, fallback = 100): number {
  const number = numericValue(value, fallback);
  return Math.round(Math.max(0, Math.min(100, number)));
}

export function photoImageFilterPresetLabel(value: unknown, intensityValue: unknown = 100): string {
  const preset = normalizePhotoImageFilterPreset(value);
  if (preset === "none") return "";
  const label = PHOTO_IMAGE_FILTER_OPTIONS.find((option) => option.value === preset)?.label || "Filter";
  const intensity = normalizePhotoImageFilterIntensity(intensityValue);
  return intensity > 0 && intensity < 100 ? `Filter ${label} ${intensity}%` : `Filter ${label}`;
}

export function photoImageFilterPreviewClassName(value: unknown): string {
  return `photos-filter-preview-${normalizePhotoImageFilterPreset(value).replace(/_/g, "-")}`;
}

function imageEditBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["1", "true", "yes", "on", "horizontal", "vertical", "flip"].includes(String(value || "").trim().toLowerCase());
}

function renderInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = Math.round(numericValue(value, fallback));
  return Math.max(min, Math.min(max, number));
}

export function normalizePhotoImageEditOperation(value: Record<string, unknown> | null | undefined): PhotoImageEditOperation | null {
  if (!value || typeof value !== "object") return null;
  const rotateDegrees = normalizePhotoImageRotateDegrees(value.imageRotateDegrees ?? value.rotateDegrees ?? value.rotationDegrees);
  const straightenDegrees = normalizePhotoImageStraightenDegrees(value.imageStraightenDegrees ?? value.straightenDegrees ?? value.straighten);
  const cropRect = normalizePhotoManualCropBox(
    (value.imageCropRect || value.cropRect || value.cropBox || value.manualCropRect) as Partial<PhotoManualCropBox> | null | undefined
  );
  const cropRectActive = photoManualCropBoxActive(cropRect);
  const cropAspect = normalizePhotoImageCropAspect(value.imageCropAspect ?? value.cropAspect ?? value.cropMode);
  const adjustments = normalizePhotoImageAdjustments(value.adjustments as Partial<PhotoImageAdjustmentDraft> | null | undefined);
  const adjustmentsActive = photoImageAdjustmentsActive(adjustments);
  const filterPreset = normalizePhotoImageFilterPreset(value.imageFilterPreset ?? value.filterPreset ?? value.imageFilter ?? value.filter ?? value.filterName);
  const filterIntensity = normalizePhotoImageFilterIntensity(value.imageFilterIntensity ?? value.filterIntensity ?? value.filterAmount ?? value.filterStrength);
  const filterActive = photoImageFilterPresetActive(filterPreset) && filterIntensity > 0;
  const markup = normalizePhotoImageMarkupAnnotations(value.markup ?? value.markupAnnotations ?? value.annotations);
  const markupActive = markup.length > 0;
  const retouch = normalizePhotoImageRetouchSpots(
    value.retouch ?? value.retouchSpots ?? value.imageRetouch ?? value.retouchAnnotations ?? value.redEye ?? value.redEyeCorrections
  );
  const retouchActive = retouch.length > 0;
  const flipHorizontal = imageEditBool(value.imageFlipHorizontal ?? value.flipHorizontal ?? value.horizontalFlip);
  const flipVertical = imageEditBool(value.imageFlipVertical ?? value.flipVertical ?? value.verticalFlip);
  const operation: PhotoImageEditOperation = {
    kind: "image_crop_rotate",
    rotateDegrees,
    straightenDegrees,
    cropAspect,
    flipHorizontal,
    flipVertical,
    renderQuality: renderInt(value.renderQuality ?? value.quality, 88, 1, 100),
    renderMaxDimension: renderInt(value.renderMaxDimension ?? value.maxDimension, 1600, 0, 20000),
    source: String(value.source || "photos-edit-clipboard").slice(0, 80),
    ...(cropRectActive ? { cropRect } : {}),
    ...(adjustmentsActive ? { adjustments } : {}),
    ...(filterActive ? { filterPreset, filterIntensity } : {}),
    ...(markupActive ? { markup } : {}),
    ...(retouchActive ? { retouch } : {}),
  };
  return photoImageEditOperationActive(operation) ? operation : null;
}

export function photoImageEditOperationDraft(input: PhotoImageEditOperationDraftInput = {}): PhotoImageEditOperation | null {
  const source = String(input.source || "photos-lightbox").trim() || "photos-lightbox";
  return normalizePhotoImageEditOperation({
    kind: "image_crop_rotate",
    rotateDegrees: input.rotateDegrees,
    straightenDegrees: input.straightenDegrees,
    ...(input.manualCropActive ? { cropRect: input.manualCropBox } : {}),
    cropAspect: input.cropAspect,
    ...(input.adjustmentsActive ? { adjustments: input.adjustments } : {}),
    ...(input.filterActive ? { filterPreset: input.filterPreset, filterIntensity: input.filterIntensity } : {}),
    ...(input.markupActive ? { markup: input.markup } : {}),
    ...(input.retouchActive ? { retouch: input.retouch } : {}),
    flipHorizontal: input.flipHorizontal,
    flipVertical: input.flipVertical,
    renderQuality: 88,
    renderMaxDimension: 1600,
    source,
  });
}

export function photoImageEditDefaultDraftState(): PhotoImageEditDefaultDraftState {
  return {
    rotateDegrees: 0,
    straightenDegrees: 0,
    cropAspect: "none",
    manualCropEnabled: false,
    manualCropBox: DEFAULT_PHOTO_MANUAL_CROP_BOX,
    adjustmentsOpen: false,
    adjustments: DEFAULT_PHOTO_IMAGE_ADJUSTMENTS,
    filterPreset: "none",
    filterIntensity: 100,
    markupOpen: false,
    markupAnnotations: [DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION],
    markupSelectedIndex: 0,
    retouchOpen: false,
    retouchSpots: [DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
    retouchSelectedIndex: 0,
    flipHorizontal: false,
    flipVertical: false,
  };
}

export function photoImageEditDraftStateFromOperation(
  operationValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined
): PhotoImageEditDraftState | null {
  const operation = normalizePhotoImageEditOperation(operationValue as Record<string, unknown> | null | undefined);
  if (!operation) return null;
  const defaults = photoImageEditDefaultDraftState();
  return {
    ...defaults,
    operation,
    rotateDegrees: operation.rotateDegrees,
    straightenDegrees: operation.straightenDegrees,
    cropAspect: operation.cropAspect,
    manualCropEnabled: Boolean(operation.cropRect),
    manualCropBox: operation.cropRect || defaults.manualCropBox,
    adjustmentsOpen: Boolean(operation.adjustments),
    adjustments: operation.adjustments || defaults.adjustments,
    filterPreset: operation.filterPreset || defaults.filterPreset,
    filterIntensity: operation.filterIntensity ?? defaults.filterIntensity,
    markupOpen: Boolean(operation.markup?.length),
    markupAnnotations: operation.markup?.length ? operation.markup : defaults.markupAnnotations,
    retouchOpen: Boolean(operation.retouch?.length),
    retouchSpots: operation.retouch?.length ? operation.retouch : defaults.retouchSpots,
    flipHorizontal: Boolean(operation.flipHorizontal),
    flipVertical: Boolean(operation.flipVertical),
  };
}

export function photoImageEditOperationActive(value: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Record<string, unknown>;
  const rotateDegrees = normalizePhotoImageRotateDegrees(raw.rotateDegrees);
  const straightenDegrees = normalizePhotoImageStraightenDegrees(raw.straightenDegrees);
  const cropRectActive = photoManualCropBoxActive((raw.cropRect || raw.imageCropRect) as Partial<PhotoManualCropBox> | null | undefined);
  const cropAspect = normalizePhotoImageCropAspect(raw.cropAspect ?? raw.imageCropAspect);
  const adjustmentsActive = photoImageAdjustmentsActive(raw.adjustments as Partial<PhotoImageAdjustmentDraft> | null | undefined);
  const filterIntensity = normalizePhotoImageFilterIntensity(raw.filterIntensity ?? raw.imageFilterIntensity ?? raw.filterAmount ?? raw.filterStrength);
  const filterActive = photoImageFilterPresetActive(raw.filterPreset ?? raw.imageFilterPreset ?? raw.filter) && filterIntensity > 0;
  const markupActive = photoImageMarkupActive(raw.markup ?? raw.markupAnnotations ?? raw.annotations);
  const retouchActive = photoImageRetouchActive(raw.retouch ?? raw.retouchSpots ?? raw.imageRetouch ?? raw.retouchAnnotations ?? raw.redEye ?? raw.redEyeCorrections);
  return rotateDegrees !== 0
    || Math.abs(straightenDegrees) >= 0.01
    || cropRectActive
    || cropAspect !== "none"
    || adjustmentsActive
    || filterActive
    || markupActive
    || retouchActive
    || imageEditBool(raw.flipHorizontal ?? raw.imageFlipHorizontal)
    || imageEditBool(raw.flipVertical ?? raw.imageFlipVertical);
}

export function photoImageEditOperationHasAdjustments(value: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined): boolean {
  const operation = normalizePhotoImageEditOperation(value as Record<string, unknown> | null | undefined);
  return Boolean(operation?.adjustments && photoImageAdjustmentsActive(operation.adjustments));
}

export function mergePhotoImageAdjustmentPasteOperation(
  targetValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  copiedValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  source = "photos-adjustment-paste"
): PhotoImageEditOperation | null {
  const copied = normalizePhotoImageEditOperation(copiedValue as Record<string, unknown> | null | undefined);
  if (!copied?.adjustments || !photoImageAdjustmentsActive(copied.adjustments)) return null;
  const target = normalizePhotoImageEditOperation(targetValue as Record<string, unknown> | null | undefined);
  return normalizePhotoImageEditOperation({
    kind: "image_crop_rotate",
    rotateDegrees: target?.rotateDegrees ?? 0,
    straightenDegrees: target?.straightenDegrees ?? 0,
    cropAspect: target?.cropAspect ?? "none",
    ...(target?.cropRect ? { cropRect: target.cropRect } : {}),
    adjustments: copied.adjustments,
    ...(target?.filterPreset ? { filterPreset: target.filterPreset, filterIntensity: target.filterIntensity ?? 100 } : {}),
    ...(target?.markup ? { markup: target.markup } : {}),
    ...(target?.retouch ? { retouch: target.retouch } : {}),
    flipHorizontal: Boolean(target?.flipHorizontal),
    flipVertical: Boolean(target?.flipVertical),
    renderQuality: target?.renderQuality ?? copied.renderQuality ?? 88,
    renderMaxDimension: target?.renderMaxDimension ?? copied.renderMaxDimension ?? 1600,
    source,
  });
}

export function photoImageEditOperationLabel(value: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined): string {
  const operation = normalizePhotoImageEditOperation(value as Record<string, unknown> | null | undefined);
  if (!operation) return "";
  const straightenLabel = operation.straightenDegrees ? `S${operation.straightenDegrees > 0 ? "+" : ""}${operation.straightenDegrees.toFixed(1)}` : "";
  const manualCropLabel = operation.cropRect ? photoManualCropBoxLabel(operation.cropRect) : "";
  const cropLabel = photoImageCropAspectLabel(operation.cropAspect);
  const adjustmentsLabel = operation.adjustments ? photoImageAdjustmentsLabel(operation.adjustments) : "";
  const filterLabel = operation.filterPreset ? photoImageFilterPresetLabel(operation.filterPreset, operation.filterIntensity) : "";
  const markupLabel = operation.markup ? photoImageMarkupLabel(operation.markup) : "";
  const retouchLabel = operation.retouch ? photoImageRetouchLabel(operation.retouch) : "";
  const flipLabel = `${operation.flipHorizontal ? "H" : ""}${operation.flipVertical ? "V" : ""}` || "No flip";
  return [
    operation.rotateDegrees ? `R${operation.rotateDegrees}` : "R0",
    straightenLabel,
    manualCropLabel,
    cropLabel,
    adjustmentsLabel,
    filterLabel,
    markupLabel,
    retouchLabel,
    flipLabel,
  ].filter(Boolean).join(" / ");
}

export interface PhotoEditStackInfoSummary {
  hasActiveStack: boolean;
  operationCount: number;
  operationLabel: string;
  updatedAt: string;
  versionCount: number;
  latestVersionLabel: string;
  latestVersionSavedAt: string;
  text: string;
  title: string;
}

export interface PhotoEditStackInfoSummaryOptions {
  formatDate?: (value: unknown) => string;
}

export interface PhotoEditStackVersionHistoryRow {
  id: string;
  label: string;
  operationCount: number;
  operationLabel: string;
  detailLabels: string[];
  savedAt: string;
  savedAtRaw: string;
  sourceEditId: string;
  selected: boolean;
}

export interface PhotoEditStackVersionHistoryOptions {
  formatDate?: (value: unknown) => string;
  selectedVersionId?: string;
}

export interface PhotoEditStackOperationHistoryRow {
  id: string;
  stepLabel: string;
  kindLabel: string;
  operationLabel: string;
  timelineLabel: string;
  transformLabel: string;
  renderLabel: string;
  detailLabels: string[];
  source: string;
}

function photoEditStackRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function photoEditStackUnwrap(value: unknown): Record<string, unknown> | null {
  const record = photoEditStackRecord(value);
  if (!record) return null;
  if (record.hasStack && photoEditStackRecord(record.stack)) return record.stack as Record<string, unknown>;
  return record;
}

function photoEditStackOperations(value: unknown): Record<string, unknown>[] {
  const record = photoEditStackUnwrap(value);
  return Array.isArray(record?.operations)
    ? record.operations.filter((operation): operation is Record<string, unknown> => Boolean(photoEditStackRecord(operation)))
    : [];
}

function photoEditStackTimestamp(value: unknown): string {
  const record = photoEditStackRecord(value);
  return String(record?.updatedAt || record?.createdAt || "").trim();
}

function photoEditStackHumanOperationKind(value: unknown): string {
  const text = String(value || "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function photoEditStackCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function photoEditStackNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function photoEditStackDurationLabel(value: unknown): string {
  const ms = Math.max(0, Math.round(photoEditStackNumber(value)));
  if (!ms) return "";
  const seconds = Math.round(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, "0")}` : `${rest}s`;
}

function photoEditStackVideoCropLabel(value: unknown): string {
  const crop = String(value || "none").trim().toLowerCase().replace("_", "-");
  if (crop === "square" || crop === "1:1") return "1:1";
  if (crop === "landscape" || crop === "16:9" || crop === "wide") return "16:9";
  if (crop === "portrait" || crop === "4:5" || crop === "vertical") return "4:5";
  return "Original";
}

function photoEditStackVideoRotation(value: unknown): number {
  const aliases: Record<string, number> = {
    left: 270,
    counterclockwise: 270,
    ccw: 270,
    right: 90,
    clockwise: 90,
    cw: 90,
    half: 180,
    "upside-down": 180,
    upside_down: 180,
  };
  const key = String(value ?? 0).trim().toLowerCase();
  const parsed = key in aliases ? aliases[key] : photoEditStackNumber(key, 0);
  const normalized = ((Math.round(parsed) % 360) + 360) % 360;
  return [0, 90, 180, 270].includes(normalized) ? normalized : 0;
}

function photoEditStackVideoOperationSummary(operation: Record<string, unknown>): {
  isVideo: boolean;
  label: string;
  timelineLabel: string;
  transformLabel: string;
  renderLabel: string;
  detailLabels: string[];
} {
  const rawKind = operation.kind ?? operation.operationKind ?? operation.operationType ?? operation.type;
  const kind = String(rawKind || "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  const isVideo = ["video_trim_transform", "video_trim", "video_transform", "video_trim_export"].includes(kind);
  if (!isVideo) {
    return { isVideo: false, label: "", timelineLabel: "", transformLabel: "", renderLabel: "", detailLabels: [] };
  }

  const startMs = Math.max(0, Math.round(photoEditStackNumber(
    operation.startMs ?? operation.trimStartMs ?? operation.videoTrimStartMs,
  )));
  const endMs = Math.max(0, Math.round(photoEditStackNumber(
    operation.endMs ?? operation.trimEndMs ?? operation.videoTrimEndMs,
  )));
  const sourceDurationMs = Math.max(0, Math.round(photoEditStackNumber(
    operation.sourceDurationMs ?? operation.durationMs ?? operation.videoDurationMs,
  )));
  const trimDurationMs = endMs > startMs ? endMs - startMs : 0;
  const startLabel = photoEditStackDurationLabel(startMs) || "0s";
  const endLabel = photoEditStackDurationLabel(endMs);
  const trimDurationLabel = photoEditStackDurationLabel(trimDurationMs);
  const sourceDurationLabel = photoEditStackDurationLabel(sourceDurationMs);
  const trimWindowLabel = endLabel ? `Trim ${startLabel}-${endLabel}` : `Trim from ${startLabel}`;
  const trimSpanLabel = trimDurationLabel && sourceDurationLabel
    ? `${trimDurationLabel} of ${sourceDurationLabel}`
    : trimDurationLabel;
  const timelineLabel = startMs > 0 || endMs > 0
    ? trimSpanLabel ? `${trimWindowLabel} (${trimSpanLabel})` : trimWindowLabel
    : sourceDurationLabel ? `Source ${sourceDurationLabel}` : "";

  const rotateDegrees = photoEditStackVideoRotation(
    operation.rotateDegrees ?? operation.videoRotateDegrees ?? operation.rotationDegrees,
  );
  const cropLabel = photoEditStackVideoCropLabel(operation.cropAspect ?? operation.videoCropAspect ?? operation.cropMode);
  const transformActive = rotateDegrees !== 0 || cropLabel !== "Original";
  const transformLabel = transformActive ? `R${rotateDegrees} / ${cropLabel}` : "";

  const format = String(operation.videoRenderFormat ?? operation.renderVideoFormat ?? operation.renderFormat ?? "").trim().toUpperCase();
  const quality = String(operation.videoRenderQuality ?? operation.renderVideoQuality ?? operation.videoQuality ?? "").trim().toLowerCase();
  const maxEdge = Math.max(0, Math.round(photoEditStackNumber(operation.renderMaxDimension ?? operation.maxDimension, 0)));
  const renderLabel = [
    format,
    quality,
    maxEdge ? `max ${maxEdge}px` : "",
  ].filter(Boolean).join(" ");

  const detailLabels = [
    timelineLabel ? `Timeline ${timelineLabel.replace(/^Trim\s+/, "")}` : "",
    transformLabel ? `Transform ${transformLabel}` : "",
    renderLabel ? `Render ${renderLabel}` : "",
  ].filter(Boolean);
  const fallbackLabel = photoEditStackHumanOperationKind(rawKind);
  const label = [timelineLabel, transformLabel, renderLabel].filter(Boolean).join(" / ") || fallbackLabel;
  return { isVideo: true, label, timelineLabel, transformLabel, renderLabel, detailLabels };
}

function photoEditStackOperationDetailLabels(operations: unknown[] = []): string[] {
  const labels: string[] = [];
  operations.forEach((operation) => {
    const record = photoEditStackRecord(operation);
    if (!record) return;
    photoEditStackVideoOperationSummary(record).detailLabels.forEach((label) => {
      if (label && !labels.includes(label)) labels.push(label);
    });
  });
  return labels;
}

export function photoEditStackOperationLabel(operations: unknown[] = []): string {
  const firstOperation = operations
    .map((operation) => photoEditStackRecord(operation))
    .find((operation): operation is Record<string, unknown> => Boolean(operation));
  if (!firstOperation) return "";
  const videoLabel = photoEditStackVideoOperationSummary(firstOperation).label;
  if (videoLabel) return videoLabel;
  const imageLabel = photoImageEditOperationLabel(firstOperation);
  if (imageLabel) return imageLabel;
  return photoEditStackHumanOperationKind(firstOperation.kind ?? firstOperation.operationKind ?? firstOperation.operationType ?? firstOperation.type);
}

export function photoEditStackInfoSummary(
  stackValue: unknown,
  versionValues: unknown[] = [],
  options: PhotoEditStackInfoSummaryOptions = {},
): PhotoEditStackInfoSummary | null {
  const stack = photoEditStackUnwrap(stackValue);
  const operations = photoEditStackOperations(stack);
  const versions = versionValues
    .map((version) => photoEditStackRecord(version))
    .filter((version): version is Record<string, unknown> => Boolean(version));
  const hasActiveStack = Boolean(stack && operations.length > 0);
  const versionCount = versions.length;
  if (!hasActiveStack && versionCount === 0) return null;

  const formatDate = options.formatDate || ((value: unknown) => String(value || "").trim());
  const operationLabel = photoEditStackOperationLabel(operations);
  const updatedAtRaw = stack ? photoEditStackTimestamp(stack) : "";
  const updatedAt = updatedAtRaw ? formatDate(updatedAtRaw) : "";
  const latestVersion = [...versions].sort((left, right) => (
    photoEditStackTimestamp(right).localeCompare(photoEditStackTimestamp(left))
  ))[0] || null;
  const latestVersionLabel = String(latestVersion?.label || "").trim();
  const latestVersionSavedAtRaw = photoEditStackTimestamp(latestVersion);
  const latestVersionSavedAt = latestVersionSavedAtRaw ? formatDate(latestVersionSavedAtRaw) : "";
  const parts = hasActiveStack
    ? [
      `Active edit: ${photoEditStackCountLabel(operations.length, "operation", "operations")}`,
      operationLabel,
      updatedAt ? `Updated ${updatedAt}` : "",
      versionCount ? photoEditStackCountLabel(versionCount, "saved version", "saved versions") : "",
    ]
    : [
      "No active edits",
      photoEditStackCountLabel(versionCount, "saved version", "saved versions"),
      latestVersionLabel ? `Latest ${latestVersionLabel}` : "",
      latestVersionSavedAt ? `Saved ${latestVersionSavedAt}` : "",
    ];
  const text = parts.filter(Boolean).join(" · ");
  return {
    hasActiveStack,
    operationCount: operations.length,
    operationLabel,
    updatedAt,
    versionCount,
    latestVersionLabel,
    latestVersionSavedAt,
    text,
    title: text,
  };
}

export function photoEditStackVersionHistoryRows(
  versionValues: unknown[] = [],
  options: PhotoEditStackVersionHistoryOptions = {},
): PhotoEditStackVersionHistoryRow[] {
  const formatDate = options.formatDate || ((value: unknown) => String(value || "").trim());
  const selectedVersionId = String(options.selectedVersionId || "").trim();
  return versionValues
    .map((version, index) => {
      const record = photoEditStackRecord(version);
      if (!record) return null;
      const id = String(record.versionId || record.id || "").trim() || `version-${index + 1}`;
      const operations = photoEditStackOperations(record);
      const savedAtRaw = photoEditStackTimestamp(record);
      return {
        id,
        label: String(record.label || "").trim() || `Version ${index + 1}`,
        operationCount: operations.length,
        operationLabel: photoEditStackOperationLabel(operations),
        detailLabels: photoEditStackOperationDetailLabels(operations),
        savedAt: savedAtRaw ? formatDate(savedAtRaw) : "",
        savedAtRaw,
        sourceEditId: String(record.sourceEditId || "").trim(),
        selected: selectedVersionId ? id === selectedVersionId : index === 0,
      };
    })
    .filter((row): row is PhotoEditStackVersionHistoryRow => Boolean(row));
}

export function photoEditStackRevertConfirmDialogDraft(
  totalValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): PhotoEditStackRevertConfirmDialogDraft {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const total = Math.max(0, Math.floor(numericValue(totalValue, 0)));
  const selectedPhotos = total === 1 ? uiText("selected photo") : uiText("selected photos");
  return {
    title: uiText("Revert selected edits?"),
    message: `${uiText("Remove saved edit stacks from")} ${formatCount(total)} ${selectedPhotos}. ${uiText("Original files stay unchanged.")}`,
    confirmLabel: uiText("Revert edits"),
    cancelLabel: uiText("Cancel"),
    danger: true,
  };
}

export function photoEditStackRevertProgressMessage(
  indexValue: unknown,
  totalValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const total = Math.max(0, Math.floor(numericValue(totalValue, 0)));
  const index = Math.max(0, Math.min(total, Math.floor(numericValue(indexValue, 0))));
  return `${uiText("Reverting edits")} ${index <= 0 ? "0" : formatCount(index)} / ${formatCount(total)}`;
}

export function photoEditStackRevertResultMessage(
  revertedValue: unknown,
  failedValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const reverted = Math.max(0, Math.floor(numericValue(revertedValue, 0)));
  const failed = Math.max(0, Math.floor(numericValue(failedValue, 0)));
  const failedLabel = failed ? ` ${uiText("Failed")} ${formatCount(failed)}.` : "";
  return `${uiText("Reverted edits")} ${formatCount(reverted)} ${reverted === 1 ? uiText("photo") : uiText("photos")}.${failedLabel}`;
}

export function photoAssetVersionDuplicateResultMessage(
  kind: PhotoAssetVersionDuplicateResultKind,
  labelValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText } = photoImagePasteTextOptions(options);
  const actionLabel = kind === "rendered" ? uiText("Created rendered copy") : uiText("Duplicated photo version");
  return `${actionLabel}: ${String(labelValue || "").trim()}`;
}

export function photoEditStackVersionProgressMessage(
  action: PhotoEditStackVersionProgressAction,
  indexValue: unknown,
  totalValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const total = Math.max(0, Math.floor(numericValue(totalValue, 0)));
  const index = Math.max(0, Math.min(total, Math.floor(numericValue(indexValue, 0))));
  const actionLabel = action === "snapshot"
    ? uiText("Snapshotting edit versions")
    : action === "restore"
      ? uiText("Restoring edit versions")
      : uiText("Deleting edit versions");
  return `${actionLabel} ${index <= 0 ? "0" : formatCount(index)} / ${formatCount(total)}`;
}

export function photoEditStackVersionConfirmDialogDraft(
  action: PhotoEditStackVersionConfirmAction,
  totalValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): PhotoEditStackVersionConfirmDialogDraft {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const total = Math.max(0, Math.floor(numericValue(totalValue, 0)));
  const selectedPhotos = total === 1 ? uiText("selected photo") : uiText("selected photos");
  if (action === "restore") {
    return {
      title: uiText("Restore latest saved versions?"),
      message: `${uiText("Replace current edit stacks on")} ${formatCount(total)} ${selectedPhotos} ${uiText("with their latest saved versions.")}`,
      confirmLabel: uiText("Restore versions"),
      cancelLabel: uiText("Cancel"),
      danger: true,
    };
  }
  return {
    title: uiText("Delete saved edit versions?"),
    message: `${uiText("Delete saved edit-version snapshots from")} ${formatCount(total)} ${selectedPhotos}. ${uiText("Current edit stacks are not changed.")}`,
    confirmLabel: uiText("Delete versions"),
    cancelLabel: uiText("Cancel"),
    danger: true,
  };
}

function photoEditStackVersionLabel(value: unknown, fallback: string): string {
  return String(value || "").trim() || fallback;
}

export function photoEditStackVersionSingleConfirmDialogDraft(
  action: PhotoEditStackVersionSingleConfirmAction,
  labelValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): PhotoEditStackVersionSingleConfirmDialogDraft {
  const { uiText } = photoImagePasteTextOptions(options);
  if (action === "restore") {
    const label = photoEditStackVersionLabel(labelValue, uiText("the selected version"));
    return {
      title: uiText("Restore edit version?"),
      message: `${uiText("This replaces the current edit stack with")} ${label}.`,
      confirmLabel: uiText("Restore version"),
      cancelLabel: uiText("Cancel"),
      danger: true,
    };
  }
  const label = photoEditStackVersionLabel(labelValue, uiText("this edit version"));
  return {
    title: uiText("Delete edit version?"),
    message: `${uiText("Delete")} ${label}? ${uiText("The current edit stack is not changed.")}`,
    confirmLabel: uiText("Delete version"),
    cancelLabel: uiText("Cancel"),
    danger: true,
  };
}

export function photoEditStackVersionSingleResultMessage(
  action: PhotoEditStackVersionSingleResultAction,
  labelValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText } = photoImagePasteTextOptions(options);
  const label = photoEditStackVersionLabel(labelValue, uiText("Version"));
  const actionLabel = action === "duplicate"
    ? uiText("Duplicated edit version")
    : action === "restore"
      ? uiText("Restored edit version")
      : uiText("Deleted edit version");
  return `${actionLabel}: ${label}`;
}

export function photoEditStackVersionSnapshotResultMessage(
  snapshottedValue: unknown,
  failedValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const snapshotted = Math.max(0, Math.floor(numericValue(snapshottedValue, 0)));
  const failed = Math.max(0, Math.floor(numericValue(failedValue, 0)));
  const failedLabel = failed ? ` ${uiText("Failed")} ${formatCount(failed)}.` : "";
  return `${uiText("Snapshotted edit versions")} ${formatCount(snapshotted)} ${snapshotted === 1 ? uiText("photo") : uiText("photos")}.${failedLabel}`;
}

export function photoEditStackVersionRestoreResultMessage(
  restoredValue: unknown,
  skippedValue: unknown,
  failedValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const restored = Math.max(0, Math.floor(numericValue(restoredValue, 0)));
  const skipped = Math.max(0, Math.floor(numericValue(skippedValue, 0)));
  const failed = Math.max(0, Math.floor(numericValue(failedValue, 0)));
  const skippedLabel = skipped ? ` ${uiText("Skipped")} ${formatCount(skipped)}.` : "";
  const failedLabel = failed ? ` ${uiText("Failed")} ${formatCount(failed)}.` : "";
  return `${uiText("Restored edit versions")} ${formatCount(restored)} ${restored === 1 ? uiText("photo") : uiText("photos")}.${skippedLabel}${failedLabel}`;
}

export function photoEditStackVersionDeleteResultMessage(
  deletedValue: unknown,
  skippedValue: unknown,
  failedValue: unknown,
  options: PhotoImagePasteTextOptions = {},
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const deleted = Math.max(0, Math.floor(numericValue(deletedValue, 0)));
  const skipped = Math.max(0, Math.floor(numericValue(skippedValue, 0)));
  const failed = Math.max(0, Math.floor(numericValue(failedValue, 0)));
  const skippedLabel = skipped ? ` ${uiText("Skipped")} ${formatCount(skipped)} photos.` : "";
  const failedLabel = failed ? ` ${uiText("Failed")} ${formatCount(failed)} photos.` : "";
  return `${uiText("Deleted edit versions")} ${formatCount(deleted)}.${skippedLabel}${failedLabel}`;
}

export function photoEditStackOperationHistoryRows(stackValue: unknown): PhotoEditStackOperationHistoryRow[] {
  return photoEditStackOperations(stackValue).map((operation, index) => {
    const kindLabel = photoEditStackHumanOperationKind(
      operation.kind ?? operation.operationKind ?? operation.operationType ?? operation.type
    );
    const videoSummary = photoEditStackVideoOperationSummary(operation);
    const operationLabel = videoSummary.label || photoImageEditOperationLabel(operation) || kindLabel;
    return {
      id: String(operation.operationId || operation.editOperationId || operation.id || "").trim() || `operation-${index + 1}`,
      stepLabel: `Step ${index + 1}`,
      kindLabel: kindLabel || `Operation ${index + 1}`,
      operationLabel,
      timelineLabel: videoSummary.timelineLabel,
      transformLabel: videoSummary.transformLabel,
      renderLabel: videoSummary.renderLabel,
      detailLabels: videoSummary.detailLabels,
      source: String(operation.source || operation.createdBy || operation.origin || "").trim(),
    };
  });
}

function photoImageEditClipboardFingerprint(operation: PhotoImageEditOperation): string {
  const value = normalizePhotoImageEditOperation(operation as unknown as Record<string, unknown>);
  if (!value) return "";
  const { source: _source, ...fingerprint } = value;
  return JSON.stringify(fingerprint);
}

export function photoImageEditOperationsEquivalent(
  left: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  right: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined
): boolean {
  const leftOperation = normalizePhotoImageEditOperation(left as Record<string, unknown> | null | undefined);
  const rightOperation = normalizePhotoImageEditOperation(right as Record<string, unknown> | null | undefined);
  return Boolean(leftOperation && rightOperation && photoImageEditClipboardFingerprint(leftOperation) === photoImageEditClipboardFingerprint(rightOperation));
}

export function photoImageEditPasteHasConflict(
  existingValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  nextValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined
): boolean {
  const existing = normalizePhotoImageEditOperation(existingValue as Record<string, unknown> | null | undefined);
  const next = normalizePhotoImageEditOperation(nextValue as Record<string, unknown> | null | undefined);
  return Boolean(existing && next && !photoImageEditOperationsEquivalent(existing, next));
}

export function photoImageAdjustmentPasteHasConflict(
  existingValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  nextValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined
): boolean {
  const existing = normalizePhotoImageEditOperation(existingValue as Record<string, unknown> | null | undefined);
  const next = normalizePhotoImageEditOperation(nextValue as Record<string, unknown> | null | undefined);
  return Boolean(
    existing?.adjustments
    && next?.adjustments
    && photoImageAdjustmentsActive(existing.adjustments)
    && photoImageAdjustmentsLabel(existing.adjustments) !== photoImageAdjustmentsLabel(next.adjustments)
  );
}

function photoImagePasteTextOptions(options: PhotoImagePasteTextOptions = {}): Required<PhotoImagePasteTextOptions> {
  return {
    uiText: options.uiText || ((value: string) => value),
    formatCount: options.formatCount || ((value: number) => String(value)),
  };
}

export function photoImagePasteProgressMessage(
  kind: PhotoImagePasteKind,
  phase: PhotoImagePasteProgressPhase,
  index: number,
  total: number,
  options: PhotoImagePasteTextOptions = {}
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const count = Math.max(0, Math.min(index, total));
  const photos = total === 1 ? uiText("photo") : uiText("photos");
  if (phase === "checking") {
    return `${uiText("Checking paste conflicts for")} ${kind}: ${formatCount(count)}/${formatCount(total)} ${photos}.`;
  }
  return `${uiText("Pasting")} ${kind}: ${formatCount(count)}/${formatCount(total)} ${photos}.`;
}

export function photoImagePasteResultMessage(
  kind: PhotoImagePasteKind,
  pasted: number,
  replaced: number,
  failed: number,
  options: PhotoImagePasteResultOptions = {}
): string {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const skipped = Math.max(0, Math.floor(numericValue(options.skipped, 0)));
  const action = kind === "adjustments" ? uiText("Pasted adjustments to") : uiText("Pasted edits to");
  const replacedSubject = kind === "adjustments" ? uiText("adjustments on") : uiText("edits on");
  const parts = [
    `${action} ${formatCount(pasted)} ${pasted === 1 ? uiText("photo") : uiText("photos")}.`,
    replaced ? `${uiText("Replaced existing")} ${replacedSubject} ${formatCount(replaced)} ${replaced === 1 ? uiText("photo") : uiText("photos")}.` : "",
    failed ? `${uiText("Failed")} ${formatCount(failed)} ${failed === 1 ? uiText("photo") : uiText("photos")}.` : "",
    skipped ? `${uiText("Skipped")} ${formatCount(skipped)}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

export function photoImagePasteConflictPreviewText(
  mode: PhotoImagePasteConflictMode,
  operationValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  options: PhotoImagePasteTextOptions = {}
): string {
  const { uiText } = photoImagePasteTextOptions(options);
  const operation = normalizePhotoImageEditOperation(operationValue as Record<string, unknown> | null | undefined);
  if (!operation) return "";
  if (mode === "adjustments") {
    const label = operation.adjustments ? photoImageAdjustmentsLabel(operation.adjustments) : "";
    return label ? `${uiText("Copied adjustments")}: ${label}.` : "";
  }
  const label = photoImageEditOperationLabel(operation);
  return label ? `${uiText("Copied edit")}: ${label}.` : "";
}

export function photoImagePasteConflictDialogDraft(
  conflictCountValue: unknown,
  mode: PhotoImagePasteConflictMode,
  operationValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  options: PhotoImagePasteTextOptions = {}
): PhotoImagePasteConflictDialogDraft | null {
  const { uiText, formatCount } = photoImagePasteTextOptions(options);
  const conflictCount = Math.max(0, Math.floor(numericValue(conflictCountValue, 0)));
  if (conflictCount <= 0) return null;
  const multiple = conflictCount !== 1;
  const preview = photoImagePasteConflictPreviewText(mode, operationValue, options);
  const message = mode === "adjustments"
    ? `${formatCount(conflictCount)} ${multiple ? uiText("photos already have saved adjustments.") : uiText("photo already has saved adjustments.")} ${uiText("Pasting adjustments will replace those sliders while preserving crop, rotation, filters, and flips.")}`
    : `${formatCount(conflictCount)} ${multiple ? uiText("photos already have saved edits.") : uiText("photo already has saved edits.")} ${uiText("Pasting copied edits will replace the existing edit stack.")}`;
  return {
    title: mode === "adjustments" ? uiText("Replace existing adjustments?") : uiText("Replace existing edits?"),
    message: [message, preview].filter(Boolean).join(" "),
    confirmLabel: mode === "adjustments" ? uiText("Replace adjustments") : uiText("Replace edits"),
    cancelLabel: uiText("Cancel"),
    preview,
  };
}

function photoImageEditClipboardId(copiedAt: string, operation: PhotoImageEditOperation): string {
  const time = String(copiedAt || "").replace(/[^0-9a-z]+/gi, "").slice(0, 24) || "clipboard";
  let hash = 0;
  const fingerprint = photoImageEditClipboardFingerprint(operation);
  for (let index = 0; index < fingerprint.length; index += 1) {
    hash = ((hash << 5) - hash + fingerprint.charCodeAt(index)) | 0;
  }
  return `image-edit-${time}-${Math.abs(hash).toString(36)}`;
}

export function normalizePhotoImageEditClipboardEntry(value: unknown): PhotoImageEditClipboardEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const operation = normalizePhotoImageEditOperation((record.operation || record) as Record<string, unknown> | null | undefined);
  if (!operation) return null;
  const copiedAt = String(record.copiedAt || record.createdAt || "").trim() || new Date(0).toISOString();
  const label = String(record.label || photoImageEditOperationLabel(operation)).replace(/\s+/g, " ").trim().slice(0, 160);
  const id = String(record.id || photoImageEditClipboardId(copiedAt, operation)).trim().slice(0, 120);
  return {
    id,
    label: label || photoImageEditOperationLabel(operation),
    copiedAt,
    operation,
  };
}

export function normalizePhotoImageEditClipboardHistory(values: unknown, limit = 12): PhotoImageEditClipboardEntry[] {
  const rows = Array.isArray(values) ? values : [];
  const seen = new Set<string>();
  const entries: PhotoImageEditClipboardEntry[] = [];
  for (const value of rows) {
    const entry = normalizePhotoImageEditClipboardEntry(value);
    if (!entry) continue;
    const fingerprint = photoImageEditClipboardFingerprint(entry.operation);
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    entries.push(entry);
    if (entries.length >= limit) break;
  }
  return entries;
}

export function readStoredPhotoImageEditClipboardHistory(key: string): PhotoImageEditClipboardEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    return normalizePhotoImageEditClipboardHistory(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

export function storePhotoImageEditClipboardHistory(key: string, values: PhotoImageEditClipboardEntry[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(normalizePhotoImageEditClipboardHistory(values)));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

export function upsertPhotoImageEditClipboardHistory(
  history: unknown,
  operationValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  options: { copiedAt?: string; id?: string; limit?: number } = {}
): PhotoImageEditClipboardEntry[] {
  const operation = normalizePhotoImageEditOperation(operationValue as Record<string, unknown> | null | undefined);
  if (!operation) return normalizePhotoImageEditClipboardHistory(history, options.limit ?? 12);
  const copiedAt = options.copiedAt || new Date().toISOString();
  const entry = normalizePhotoImageEditClipboardEntry({
    id: options.id || photoImageEditClipboardId(copiedAt, operation),
    label: photoImageEditOperationLabel(operation),
    copiedAt,
    operation,
  });
  if (!entry) return normalizePhotoImageEditClipboardHistory(history, options.limit ?? 12);
  const fingerprint = photoImageEditClipboardFingerprint(entry.operation);
  const existing = normalizePhotoImageEditClipboardHistory(history, options.limit ?? 12)
    .filter((item) => photoImageEditClipboardFingerprint(item.operation) !== fingerprint && item.id !== entry.id);
  return normalizePhotoImageEditClipboardHistory([entry, ...existing], options.limit ?? 12);
}

export function deletePhotoImageEditClipboardHistoryEntry(history: unknown, entryId: string, limit = 12): PhotoImageEditClipboardEntry[] {
  const id = String(entryId || "").trim();
  return normalizePhotoImageEditClipboardHistory(history, limit).filter((entry) => entry.id !== id);
}

export function photoImageEditClipboardSelectionDraft(
  history: unknown,
  entryId: string,
  limit = 12
): PhotoImageEditClipboardSelectionDraft {
  const id = String(entryId || "").trim();
  const entry = normalizePhotoImageEditClipboardHistory(history, limit).find((item) => item.id === id) || null;
  return {
    entry,
    selectedId: entry?.id || "",
    operation: entry?.operation || null,
    label: entry?.label || "",
  };
}

export function photoImageEditClipboardDeleteDraft(
  history: unknown,
  entryId: string,
  limit = 12
): PhotoImageEditClipboardHistoryDraft {
  const nextHistory = deletePhotoImageEditClipboardHistoryEntry(history, entryId, limit);
  const entry = nextHistory[0] || null;
  return {
    history: nextHistory,
    entry,
    selectedId: entry?.id || "",
    operation: entry?.operation || null,
    label: entry?.label || "",
  };
}

export function photoImageEditClipboardCopyDraft(
  operationValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  history: unknown,
  options: { source?: string; copiedAt?: string; id?: string; limit?: number } = {}
): PhotoImageEditClipboardHistoryDraft | null {
  const normalized = normalizePhotoImageEditOperation(operationValue as Record<string, unknown> | null | undefined);
  if (!normalized || !photoImageEditOperationActive(normalized)) return null;
  const source = String(options.source || "photos-lightbox-copy").trim() || "photos-lightbox-copy";
  const operation = normalizePhotoImageEditOperation({ ...normalized, source }) || { ...normalized, source };
  const nextHistory = upsertPhotoImageEditClipboardHistory(history, operation, options);
  const entry = nextHistory[0] || null;
  return {
    history: nextHistory,
    entry,
    selectedId: entry?.id || "",
    operation,
    label: photoImageEditOperationLabel(operation),
  };
}

export function photoImageEditClipboardPasteOperation(
  clipboardValue: Partial<PhotoImageEditOperation> | Record<string, unknown> | null | undefined,
  source = "photos-lightbox-paste"
): PhotoImageEditOperation | null {
  if (!clipboardValue || typeof clipboardValue !== "object") return null;
  const sourceLabel = String(source || "photos-lightbox-paste").trim() || "photos-lightbox-paste";
  return normalizePhotoImageEditOperation({
    ...(clipboardValue as Record<string, unknown>),
    source: sourceLabel,
  });
}

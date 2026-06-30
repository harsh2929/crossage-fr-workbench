export interface PhotoDescriptionRegionInput {
  assetMetadata?: Record<string, unknown> | null;
  width?: number | null;
  height?: number | null;
}

export interface PhotoDescriptionRegion {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: string;
}

const DESCRIPTION_REGION_KEYS = [
  "descriptionRegions",
  "accessibilityRegions",
  "imageDescriptionRegions",
  "markupDescriptionRegions",
];

function cleanDescriptionText(value: unknown): string {
  return String(value || "").replace(/\0/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function cleanNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value || "").trim());
  return Number.isFinite(number) ? number : null;
}

function cleanPercent(value: unknown, fallback: number): number {
  const number = cleanNumber(value);
  const clean = number === null ? fallback : number;
  return Math.round(Math.max(0, Math.min(100, clean)) * 10) / 10;
}

function cleanConfidence(value: unknown): string {
  const number = cleanNumber(value);
  if (number === null) {
    return cleanDescriptionText(value).slice(0, 24);
  }
  if (number < 0) return "";
  const percent = number <= 1 ? number * 100 : number;
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function regionText(record: Record<string, unknown>): string {
  return ["text", "description", "label", "value", "title", "content"]
    .map((key) => cleanDescriptionText(record[key]))
    .find(Boolean) || "";
}

function numericBoundsFromArray(value: unknown): [number, number, number, number] | null {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length < 4) return null;
  const numbers = rows.slice(0, 4).map(cleanNumber);
  if (numbers.some((number) => number === null)) return null;
  return numbers as [number, number, number, number];
}

function numericBoundsFromRecord(record: Record<string, unknown>): [number, number, number, number] | null {
  const x = cleanNumber(record.x ?? record.left ?? record.l);
  const y = cleanNumber(record.y ?? record.top ?? record.t);
  let width = cleanNumber(record.width ?? record.w);
  let height = cleanNumber(record.height ?? record.h);
  const right = cleanNumber(record.right ?? record.r);
  const bottom = cleanNumber(record.bottom ?? record.b);
  if (width === null && x !== null && right !== null) width = right - x;
  if (height === null && y !== null && bottom !== null) height = bottom - y;
  return x === null || y === null || width === null || height === null ? null : [x, y, width, height];
}

function regionBounds(value: unknown): [number, number, number, number] | null {
  const record = objectRecord(value);
  if (!record) return numericBoundsFromArray(value);
  const nested = ["bounds", "boundingBox", "bbox", "box", "rect", "frame"]
    .map((key) => regionBounds(record[key]))
    .find(Boolean);
  return nested || numericBoundsFromRecord(record) || numericBoundsFromArray(record.bbox || record.box || record.boundingBox);
}

function boundsToPercent(
  bounds: [number, number, number, number],
  record: Record<string, unknown>,
  mediaWidth: number,
  mediaHeight: number,
) {
  let [x, y, width, height] = bounds;
  const unit = String(record.unit || record.units || record.coordinateUnit || record.coordinateSpace || "").toLocaleLowerCase();
  const maxValue = Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height));
  const explicitPercent = unit.includes("percent") || unit === "%";
  const explicitNormalized = unit.includes("normal") || unit.includes("relative") || unit === "fraction";
  if (explicitNormalized || maxValue <= 1.5) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  } else if (!explicitPercent && mediaWidth > 0 && mediaHeight > 0 && maxValue > 100) {
    x = (x / mediaWidth) * 100;
    y = (y / mediaHeight) * 100;
    width = (width / mediaWidth) * 100;
    height = (height / mediaHeight) * 100;
  }
  const left = Math.max(0, Math.min(100, x));
  const top = Math.max(0, Math.min(100, y));
  const right = Math.max(left, Math.min(100, x + width));
  const bottom = Math.max(top, Math.min(100, y + height));
  const cleanWidth = right - left;
  const cleanHeight = bottom - top;
  if (cleanWidth < 0.1 || cleanHeight < 0.1) return null;
  return {
    x: Math.round(left * 10) / 10,
    y: Math.round(top * 10) / 10,
    width: Math.round(cleanWidth * 10) / 10,
    height: Math.round(cleanHeight * 10) / 10,
  };
}

export function normalizePhotoDescriptionRegionDraft(
  value: Partial<PhotoDescriptionRegion> | Record<string, unknown> | null | undefined,
  mediaWidth = 0,
  mediaHeight = 0,
): PhotoDescriptionRegion | null {
  const record = objectRecord(value);
  if (!record) return null;
  const bounds = regionBounds(record);
  const percentBounds = bounds ? boundsToPercent(bounds, record, mediaWidth, mediaHeight) : null;
  const x = percentBounds?.x ?? cleanPercent(record.x ?? record.left, 8);
  const y = percentBounds?.y ?? cleanPercent(record.y ?? record.top, 8);
  const width = percentBounds?.width ?? Math.max(1, Math.min(100 - x, cleanPercent(record.width ?? record.w, 32)));
  const height = percentBounds?.height ?? Math.max(1, Math.min(100 - y, cleanPercent(record.height ?? record.h, 16)));
  const id = String(record.id || record.regionId || "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 80);
  return {
    id,
    text: regionText(record),
    x,
    y,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
    confidence: cleanConfidence(record.confidence ?? record.score ?? record.probability),
  };
}

export function normalizePhotoDescriptionRegion(
  value: Partial<PhotoDescriptionRegion> | Record<string, unknown> | null | undefined,
  mediaWidth = 0,
  mediaHeight = 0,
): PhotoDescriptionRegion | null {
  const region = normalizePhotoDescriptionRegionDraft(value, mediaWidth, mediaHeight);
  return region && region.text ? region : null;
}

export function normalizePhotoDescriptionRegions(values: unknown, mediaWidth = 0, mediaHeight = 0): PhotoDescriptionRegion[] {
  const rows = Array.isArray(values) ? values : values && typeof values === "object" ? [values] : [];
  const regions: PhotoDescriptionRegion[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const region = normalizePhotoDescriptionRegion(row as Record<string, unknown>, mediaWidth, mediaHeight);
    if (!region) continue;
    const key = `${region.text.toLocaleLowerCase()}:${region.x}:${region.y}:${region.width}:${region.height}`;
    if (seen.has(key)) continue;
    seen.add(key);
    regions.push({
      ...region,
      id: region.id || `description-region-${regions.length}`,
    });
    if (regions.length >= 24) break;
  }
  return regions;
}

export function buildPhotoDescriptionRegions(item: PhotoDescriptionRegionInput | null | undefined): PhotoDescriptionRegion[] {
  const metadata = item?.assetMetadata;
  if (!metadata || typeof metadata !== "object") return [];
  const mediaWidth = Math.max(0, Number(item?.width || metadata.width || metadata.imageWidth || metadata.pixelWidth || 0) || 0);
  const mediaHeight = Math.max(0, Number(item?.height || metadata.height || metadata.imageHeight || metadata.pixelHeight || 0) || 0);
  return normalizePhotoDescriptionRegions(
    DESCRIPTION_REGION_KEYS.flatMap((key) => {
      const value = metadata[key];
      return Array.isArray(value) ? value : value ? [value] : [];
    }),
    mediaWidth,
    mediaHeight,
  );
}

export function serializePhotoDescriptionRegions(values: unknown): Array<Record<string, unknown>> {
  return normalizePhotoDescriptionRegions(values).map((region) => ({
    id: region.id,
    text: region.text,
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
    ...(region.confidence ? { confidence: region.confidence } : {}),
  }));
}

export function photoDescriptionRegionsEquivalent(left: unknown, right: unknown): boolean {
  return JSON.stringify(serializePhotoDescriptionRegions(left)) === JSON.stringify(serializePhotoDescriptionRegions(right));
}

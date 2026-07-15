import type { PhotoItem } from "../types";

export type PhotoObjectTagReviewAction = "confirmed" | "rejected";

export type PhotoObjectTagReviewRow = {
  id: string;
  label: string;
  source: string;
  confidence: number | null;
  action: PhotoObjectTagReviewAction | "unreviewed";
  userAdded: boolean;
  lowConfidence: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  boundsKey: string;
};

type PhotoObjectTagReviewEntry = {
  label: string;
  source: string;
  action: PhotoObjectTagReviewAction;
  confidence?: number;
  bounds?: Record<string, unknown>;
  reviewedAt?: string;
};

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function cleanPhotoObjectTagLabel(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function cleanPhotoObjectTagSource(value: unknown, fallback = "object"): string {
  return String(value || fallback).replace(/[^A-Za-z0-9_*-]/g, "").slice(0, 40) || fallback;
}

function photoObjectTagConfidenceValue(value: unknown): number | null {
  const raw = numberFromUnknown(value);
  if (raw === null || !Number.isFinite(raw)) return null;
  const normalized = raw > 1 ? raw / 100 : raw;
  return Math.max(0, Math.min(1, Math.round(normalized * 1000) / 1000));
}

export function photoObjectTagConfidenceLabel(value: unknown): string {
  const confidence = photoObjectTagConfidenceValue(value);
  return confidence === null ? "" : `${Math.round(confidence * 100)}%`;
}

export function photoObjectTagSourceLabel(source: string): string {
  const normalized = source.toLocaleLowerCase();
  if (normalized === "object") return "Object";
  if (normalized === "scene") return "Scene";
  if (normalized === "event") return "Event";
  if (normalized === "model") return "Model";
  if (normalized === "vlm-qwen3-vl") return "Qwen3-VL";
  if (normalized === "vlm-smolvlm2") return "SmolVLM2";
  if (normalized === "vlm") return "Local vision model";
  if (normalized === "label") return "Label";
  if (normalized === "user" || normalized === "manual" || normalized === "added") return "User";
  return source || "Metadata";
}

function photoObjectTagBoundsKey(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const bounds = record.bounds || record.bbox || record.box || {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
    left: record.left,
    top: record.top,
    right: record.right,
    bottom: record.bottom,
  };
  try {
    return JSON.stringify(bounds || {});
  } catch {
    return "";
  }
}

function objectTagRecordUnit(record: Record<string, unknown>): unknown {
  return record.unit ?? record.units ?? record.coordinateUnit ?? record.coordinateSpace;
}

function withInheritedObjectTagBoundsUnit(bounds: unknown, record: Record<string, unknown>): unknown {
  const unit = objectTagRecordUnit(record);
  if (!unit || !bounds || typeof bounds !== "object" || Array.isArray(bounds)) return bounds;
  const boundsRecord = bounds as Record<string, unknown>;
  return objectTagRecordUnit(boundsRecord) ? boundsRecord : { ...boundsRecord, unit };
}

function photoObjectTagRawBounds(value: unknown): unknown {
  if (Array.isArray(value)) return value.length >= 4 ? value.slice(0, 4) : null;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = record.bounds ?? record.boundingBox ?? record.bbox ?? record.box ?? record.rect ?? record.frame;
  if (nested) return withInheritedObjectTagBoundsUnit(nested, record);
  const direct = ["x", "y", "width", "height", "left", "top", "right", "bottom", "xMin", "yMin", "xMax", "yMax", "minX", "minY", "maxX", "maxY"].some((key) => key in record);
  return direct ? record : null;
}

function photoObjectTagBoundsValues(value: unknown): [number, number, number, number] | null {
  if (Array.isArray(value)) {
    const values = value.slice(0, 4).map(numberFromUnknown);
    return values.length === 4 && values.every((item) => item !== null)
      ? values as [number, number, number, number]
      : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const nested = record.bounds ?? record.boundingBox ?? record.bbox ?? record.box ?? record.rect ?? record.frame;
  if (nested && nested !== value) {
    const nestedValues = photoObjectTagBoundsValues(withInheritedObjectTagBoundsUnit(nested, record));
    if (nestedValues) return nestedValues;
  }
  const x = numberFromUnknown(record.x ?? record.left ?? record.xMin ?? record.minX);
  const y = numberFromUnknown(record.y ?? record.top ?? record.yMin ?? record.minY);
  let width = numberFromUnknown(record.width ?? record.w);
  let height = numberFromUnknown(record.height ?? record.h);
  const right = numberFromUnknown(record.right ?? record.xMax ?? record.maxX);
  const bottom = numberFromUnknown(record.bottom ?? record.yMax ?? record.maxY);
  if (width === null && x !== null && right !== null) width = right - x;
  if (height === null && y !== null && bottom !== null) height = bottom - y;
  return x === null || y === null || width === null || height === null ? null : [x, y, width, height];
}

function photoObjectTagUnspecifiedUnitLooksNormalized(value: unknown, x: number, y: number, width: number, height: number): boolean {
  const right = x + width;
  const bottom = y + height;
  if (Array.isArray(value)) return Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height)) <= 1 && right <= 1.5 && bottom <= 1.5;
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const hasDetectorMinMaxKeys = ["xMin", "yMin", "xMax", "yMax", "minX", "minY", "maxX", "maxY"].some((key) => key in record);
  if (!hasDetectorMinMaxKeys) return false;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height), Math.abs(right), Math.abs(bottom)) <= 1.5;
}

function cleanObjectTagPercent(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

export function photoObjectTagBoundsPercent(value: unknown, mediaWidth: number, mediaHeight: number): { x: number; y: number; width: number; height: number } | null {
  const bounds = photoObjectTagBoundsValues(value);
  if (!bounds) return null;
  let [x, y, width, height] = bounds;
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const unit = String(objectTagRecordUnit(record) || "").toLocaleLowerCase();
  const maxValue = Math.max(Math.abs(x), Math.abs(y), Math.abs(width), Math.abs(height));
  const isPercentUnit = unit.includes("percent") || unit === "%";
  const isNormalizedUnit = unit.includes("normal") || unit.includes("relative") || unit === "fraction";
  if (isNormalizedUnit || (!unit && photoObjectTagUnspecifiedUnitLooksNormalized(value, x, y, width, height))) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  } else if (!isPercentUnit && mediaWidth > 0 && mediaHeight > 0 && maxValue > 100) {
    x = (x / mediaWidth) * 100;
    width = (width / mediaWidth) * 100;
    y = (y / mediaHeight) * 100;
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
    x: cleanObjectTagPercent(left),
    y: cleanObjectTagPercent(top),
    width: cleanObjectTagPercent(cleanWidth),
    height: cleanObjectTagPercent(cleanHeight),
  };
}

function photoObjectTagReviewBoundsPatch(bounds: { x: number; y: number; width: number; height: number } | null): Record<string, unknown> | undefined {
  if (!bounds) return undefined;
  return {
    x: Math.round(bounds.x * 10) / 10,
    y: Math.round(bounds.y * 10) / 10,
    width: Math.round(bounds.width * 10) / 10,
    height: Math.round(bounds.height * 10) / 10,
    unit: "percent",
  };
}

function photoObjectTagRecordsFromValue(value: unknown, source: string, mediaWidth: number, mediaHeight: number, limit = 200): PhotoObjectTagReviewRow[] {
  const rows: PhotoObjectTagReviewRow[] = [];
  const sourceKey = cleanPhotoObjectTagSource(source, "metadata");
  function add(label: unknown, confidence: unknown = null, bounds: unknown = null) {
    if (rows.length >= limit) return;
    const clean = cleanPhotoObjectTagLabel(label);
    if (!clean) return;
    const rawBounds = photoObjectTagRawBounds(bounds);
    const normalizedBounds = photoObjectTagBoundsPercent(rawBounds, mediaWidth, mediaHeight);
    const boundsKey = normalizedBounds ? photoObjectTagBoundsKey(photoObjectTagReviewBoundsPatch(normalizedBounds)) : "";
    rows.push({
      id: `${sourceKey}:${clean.toLocaleLowerCase()}:${boundsKey}`,
      label: clean,
      source: sourceKey,
      confidence: photoObjectTagConfidenceValue(confidence),
      action: "unreviewed",
      userAdded: false,
      lowConfidence: photoObjectTagConfidenceValue(confidence) !== null && (photoObjectTagConfidenceValue(confidence) || 0) < 0.75,
      bounds: normalizedBounds,
      boundsKey,
    });
  }
  function walk(entry: unknown) {
    if (rows.length >= limit) return;
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(walk);
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const labelKey = ["label", "name", "text", "value", "title", "description", "category", "kind", "type"]
      .find((key) => cleanPhotoObjectTagLabel(record[key]));
    if (labelKey) {
      add(record[labelKey], record.confidence ?? record.score ?? record.probability ?? record.prob, record);
      return;
    }
    Object.entries(record).forEach(([key, child]) => {
      const skip = ["confidence", "score", "probability", "prob", "bbox", "bounds", "box", "x", "y", "width", "height", "left", "top", "right", "bottom"].includes(key.toLocaleLowerCase());
      if (skip) return;
      if (typeof child === "number" || typeof child === "boolean" || typeof child === "string") {
        add(key, typeof child === "number" ? child : null);
      } else {
        walk(child);
      }
    });
  }
  walk(value);
  return rows;
}

function photoObjectTagReviewEntries(item: PhotoItem): PhotoObjectTagReviewEntry[] {
  const review = item.assetMetadata?.objectTagReview;
  const entries = review && typeof review === "object" && !Array.isArray(review)
    ? (review as Record<string, unknown>).entries
    : [];
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  return entries.flatMap((entry): PhotoObjectTagReviewEntry[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const label = cleanPhotoObjectTagLabel(record.label ?? record.name ?? record.text);
    if (!label) return [];
    const rawAction = String(record.action ?? record.status ?? "").toLocaleLowerCase();
    const action: PhotoObjectTagReviewAction | "" = ["reject", "rejected", "hide", "hidden", "remove", "removed", "falsepositive", "false_positive", "notthis", "not_this"].includes(rawAction)
      ? "rejected"
      : ["confirm", "confirmed", "accept", "accepted", "add", "added", "manual", "user"].includes(rawAction)
        ? "confirmed"
        : "";
    if (!action) return [];
    const source = cleanPhotoObjectTagSource(record.source, action === "confirmed" ? "user" : "object");
    const bounds = photoObjectTagBoundsPercent(record.bounds, 100, 100);
    const boundsKey = bounds ? photoObjectTagBoundsKey(photoObjectTagReviewBoundsPatch(bounds)) : "";
    const key = `${photoObjectTagReviewKey(source, label, boundsKey)}:${action}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const confidence = photoObjectTagConfidenceValue(record.confidence ?? record.score ?? record.probability);
    return [{
      label,
      source,
      action,
      ...(confidence === null ? {} : { confidence }),
      ...(bounds ? { bounds: photoObjectTagReviewBoundsPatch(bounds) } : {}),
      ...(String(record.reviewedAt || "").trim() ? { reviewedAt: String(record.reviewedAt || "").trim() } : {}),
    }];
  }).slice(0, 500);
}

function photoObjectTagReviewKey(source: string, label: string, boundsKey = ""): string {
  return `${source.toLocaleLowerCase()}:${label.toLocaleLowerCase()}:${boundsKey}`;
}

export function photoObjectTagReviewRows(item: PhotoItem): PhotoObjectTagReviewRow[] {
  const metadata = item.assetMetadata || {};
  const sources: Array<[string, string[]]> = [
    ["model", ["modelTags", "tags"]],
    ["object", ["objectTags", "detectedItems", "objects"]],
    ["scene", ["sceneTags", "scenes"]],
    ["event", ["detectedEvents", "events"]],
    ["label", ["labels"]],
  ];
  const reviewEntries = photoObjectTagReviewEntries(item);
  const confirmed = new Set(reviewEntries.filter((entry) => entry.action === "confirmed").map((entry) => photoObjectTagReviewKey(entry.source, entry.label, photoObjectTagBoundsKey(entry.bounds))));
  const rejected = new Set(reviewEntries.filter((entry) => entry.action === "rejected").map((entry) => photoObjectTagReviewKey(entry.source, entry.label, photoObjectTagBoundsKey(entry.bounds))));
  const confirmedLabels = new Set(reviewEntries.filter((entry) => entry.action === "confirmed" && !photoObjectTagBoundsKey(entry.bounds)).map((entry) => photoObjectTagReviewKey(entry.source, entry.label)));
  const rejectedLabels = new Set(reviewEntries.filter((entry) => entry.action === "rejected" && !photoObjectTagBoundsKey(entry.bounds)).map((entry) => photoObjectTagReviewKey(entry.source, entry.label)));
  const rows: PhotoObjectTagReviewRow[] = [];
  const seen = new Set<string>();
  const mediaWidth = Math.max(0, Number(item.width || metadata.width || metadata.imageWidth || metadata.pixelWidth || 0) || 0);
  const mediaHeight = Math.max(0, Number(item.height || metadata.height || metadata.imageHeight || metadata.pixelHeight || 0) || 0);
  sources.forEach(([source, keys]) => {
    keys.forEach((key) => {
      photoObjectTagRecordsFromValue(metadata[key], source, mediaWidth, mediaHeight).forEach((row) => {
        const reviewKey = photoObjectTagReviewKey(row.source, row.label, row.boundsKey);
        const labelReviewKey = photoObjectTagReviewKey(row.source, row.label);
        const action = rejected.has(reviewKey) || rejected.has(photoObjectTagReviewKey("*", row.label, row.boundsKey)) || rejected.has(photoObjectTagReviewKey("all", row.label, row.boundsKey)) || rejectedLabels.has(labelReviewKey) || rejectedLabels.has(photoObjectTagReviewKey("*", row.label)) || rejectedLabels.has(photoObjectTagReviewKey("all", row.label))
          ? "rejected"
          : confirmed.has(reviewKey) || confirmedLabels.has(labelReviewKey)
            ? "confirmed"
            : "unreviewed";
        const id = `${row.id}:${action}`;
        if (seen.has(id)) return;
        seen.add(id);
        rows.push({ ...row, id, action });
      });
    });
  });
  const localVision = metadata.localVision && typeof metadata.localVision === "object" && !Array.isArray(metadata.localVision)
    ? metadata.localVision as Record<string, unknown>
    : {};
  const localVisionSource = cleanPhotoObjectTagSource(localVision.source, "vlm");
  photoObjectTagRecordsFromValue(localVision.tags, localVisionSource, mediaWidth, mediaHeight).forEach((row) => {
    const reviewKey = photoObjectTagReviewKey(row.source, row.label, row.boundsKey);
    const labelReviewKey = photoObjectTagReviewKey(row.source, row.label);
    const action = rejected.has(reviewKey) || rejected.has(photoObjectTagReviewKey("*", row.label, row.boundsKey)) || rejected.has(photoObjectTagReviewKey("all", row.label, row.boundsKey)) || rejectedLabels.has(labelReviewKey) || rejectedLabels.has(photoObjectTagReviewKey("*", row.label)) || rejectedLabels.has(photoObjectTagReviewKey("all", row.label))
      ? "rejected"
      : confirmed.has(reviewKey) || confirmedLabels.has(labelReviewKey)
        ? "confirmed"
        : "unreviewed";
    const id = `${row.id}:${action}`;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({ ...row, id, action });
  });
  reviewEntries.forEach((entry) => {
    const source = cleanPhotoObjectTagSource(entry.source, entry.action === "confirmed" ? "user" : "object");
    const bounds = photoObjectTagBoundsPercent(entry.bounds, 100, 100);
    const boundsKey = bounds ? photoObjectTagBoundsKey(photoObjectTagReviewBoundsPatch(bounds)) : "";
    const key = photoObjectTagReviewKey(source, entry.label, boundsKey);
    const userAdded = entry.action === "confirmed" && ["user", "manual", "added"].includes(source.toLocaleLowerCase());
    const alreadyVisible = rows.some((row) => photoObjectTagReviewKey(row.source, row.label, row.boundsKey) === key && row.action === entry.action);
    if (alreadyVisible || (entry.action === "confirmed" && !userAdded)) return;
    const id = `${source}:${entry.label.toLocaleLowerCase()}:${boundsKey}:${entry.action}:review`;
    if (seen.has(id)) return;
    seen.add(id);
    rows.push({
      id,
      label: entry.label,
      source,
      confidence: entry.confidence ?? null,
      action: entry.action,
      userAdded,
      lowConfidence: entry.confidence !== undefined && entry.confidence < 0.75,
      bounds,
      boundsKey,
    });
  });
  return rows.slice(0, 80);
}

export function photoDetectedLabels(item: PhotoItem): string {
  const seen = new Set<string>();
  return photoObjectTagReviewRows(item)
    .filter((row) => row.action !== "rejected")
    .map((row) => row.label)
    .filter((label) => {
      const key = label.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 18)
    .join(", ");
}

export function photoObjectTagReviewPatch(
  item: PhotoItem,
  action: PhotoObjectTagReviewAction | "clear",
  row: Pick<PhotoObjectTagReviewRow, "label" | "source" | "confidence"> & Partial<Pick<PhotoObjectTagReviewRow, "bounds" | "boundsKey">>,
): Record<string, unknown> {
  const source = cleanPhotoObjectTagSource(row.source, action === "confirmed" ? "user" : "object");
  const label = cleanPhotoObjectTagLabel(row.label);
  const key = photoObjectTagReviewKey(source, label, row.boundsKey || "");
  const entries = photoObjectTagReviewEntries(item)
    .filter((entry) => photoObjectTagReviewKey(entry.source, entry.label, photoObjectTagBoundsKey(entry.bounds)) !== key);
  if (action !== "clear" && label) {
    const next: PhotoObjectTagReviewEntry = {
      label,
      source,
      action,
      reviewedAt: new Date().toISOString(),
    };
    if (row.confidence !== null && row.confidence !== undefined) next.confidence = row.confidence;
    const bounds = photoObjectTagReviewBoundsPatch(row.bounds ?? null);
    if (bounds) next.bounds = bounds;
    entries.push(next);
  }
  return { entries };
}

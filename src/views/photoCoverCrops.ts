import type { CSSProperties } from "react";
import type { PhotoCoverCrop, PhotoItem } from "../types";

export const PERSON_COVER_CROP_PRESETS: Array<{ id: string; label: string; crop: PhotoCoverCrop | null }> = [
  { id: "full", label: "Full", crop: null },
  { id: "face", label: "Face", crop: { left: 20, top: 8, width: 60, height: 60 } },
  { id: "upper", label: "Upper", crop: { left: 10, top: 0, width: 80, height: 70 } },
  { id: "left", label: "Left", crop: { left: 0, top: 10, width: 70, height: 70 } },
  { id: "right", label: "Right", crop: { left: 30, top: 10, width: 70, height: 70 } },
];

type PhotoFaceBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
};

const PHOTO_FACE_METADATA_KEYS = [
  "faces",
  "faceDetections",
  "detectedFaces",
  "faceBoxes",
  "faceRegions",
  "peopleDetections",
];

export function normalizePhotoCoverCrop(value: unknown): PhotoCoverCrop | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PhotoCoverCrop>;
  const left = Number(raw.left);
  const top = Number(raw.top);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![left, top, width, height].every(Number.isFinite)) return null;
  const safeWidth = Math.max(1, Math.min(100, width));
  const safeHeight = Math.max(1, Math.min(100, height));
  return {
    left: Math.max(0, Math.min(100 - safeWidth, left)),
    top: Math.max(0, Math.min(100 - safeHeight, top)),
    width: safeWidth,
    height: safeHeight,
  };
}

export function photoCoverCropStyle(crop: unknown): CSSProperties | undefined {
  const safeCrop = normalizePhotoCoverCrop(crop);
  if (!safeCrop) return undefined;
  const centerX = safeCrop.left + safeCrop.width / 2;
  const centerY = safeCrop.top + safeCrop.height / 2;
  const zoom = Math.max(1, Math.min(2.2, 100 / Math.max(45, Math.min(safeCrop.width, safeCrop.height))));
  return {
    objectPosition: `${centerX}% ${centerY}%`,
    transformOrigin: `${centerX}% ${centerY}%`,
    transform: `scale(${zoom.toFixed(3)})`,
  };
}

export function photoCoverCropPresetId(crop: unknown): string {
  const safeCrop = normalizePhotoCoverCrop(crop);
  if (!safeCrop) return "full";
  const match = PERSON_COVER_CROP_PRESETS.find((preset) => {
    const presetCrop = normalizePhotoCoverCrop(preset.crop);
    if (!presetCrop) return false;
    return Math.abs(presetCrop.left - safeCrop.left) < 0.1
      && Math.abs(presetCrop.top - safeCrop.top) < 0.1
      && Math.abs(presetCrop.width - safeCrop.width) < 0.1
      && Math.abs(presetCrop.height - safeCrop.height) < 0.1;
  });
  return match?.id || "custom";
}

export function photoCoverCropsEqual(left: unknown, right: unknown, tolerance = 0.1): boolean {
  const safeLeft = normalizePhotoCoverCrop(left);
  const safeRight = normalizePhotoCoverCrop(right);
  if (!safeLeft || !safeRight) return !safeLeft && !safeRight;
  return Math.abs(safeLeft.left - safeRight.left) <= tolerance
    && Math.abs(safeLeft.top - safeRight.top) <= tolerance
    && Math.abs(safeLeft.width - safeRight.width) <= tolerance
    && Math.abs(safeLeft.height - safeRight.height) <= tolerance;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return null;
}

function faceCoordinateScale(record: Record<string, unknown>): number {
  const values = [
    record.left,
    record.top,
    record.width,
    record.height,
    record.x,
    record.y,
    record.w,
    record.h,
    record.xMin,
    record.yMin,
    record.xMax,
    record.yMax,
    record.minX,
    record.minY,
    record.maxX,
    record.maxY,
    record.right,
    record.bottom,
  ].map(Number).filter(Number.isFinite);
  return values.length && values.every((value) => value >= 0 && value <= 1.5) ? 100 : 1;
}

function faceBoxFromRecord(value: unknown): PhotoFaceBox | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const box = record.box && typeof record.box === "object" ? record.box as Record<string, unknown> : null;
  const bounds = record.bounds && typeof record.bounds === "object" ? record.bounds as Record<string, unknown> : null;
  const region = record.region && typeof record.region === "object" ? record.region as Record<string, unknown> : null;
  const source = box || bounds || region || record;
  const scale = faceCoordinateScale(source);
  const left = firstFiniteNumber(source.left, source.x, source.xMin, source.minX);
  const top = firstFiniteNumber(source.top, source.y, source.yMin, source.minY);
  let width = firstFiniteNumber(source.width, source.w);
  let height = firstFiniteNumber(source.height, source.h);
  const right = firstFiniteNumber(source.right, source.xMax, source.maxX);
  const bottom = firstFiniteNumber(source.bottom, source.yMax, source.maxY);
  if (left === null || top === null) return null;
  if (width === null && right !== null) width = right - left;
  if (height === null && bottom !== null) height = bottom - top;
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  const confidence = firstFiniteNumber(record.confidence, record.score, source.confidence, source.score) ?? 0;
  return {
    left: left * scale,
    top: top * scale,
    width: width * scale,
    height: height * scale,
    confidence,
  };
}

function faceBoxesFromMetadata(metadata: Record<string, unknown>): PhotoFaceBox[] {
  const boxes: PhotoFaceBox[] = [];
  for (const key of PHOTO_FACE_METADATA_KEYS) {
    const value = metadata[key];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    values.forEach((entry) => {
      const box = faceBoxFromRecord(entry);
      if (box) boxes.push(box);
    });
  }
  return boxes;
}

export function photoDetectedFaceCoverCrop(item: Pick<PhotoItem, "assetMetadata" | "width" | "height"> | null | undefined): PhotoCoverCrop | null {
  const metadata = item?.assetMetadata || {};
  const imageWidth = Number(item?.width || metadata.width || 0) || 0;
  const imageHeight = Number(item?.height || metadata.height || 0) || 0;
  const faces = faceBoxesFromMetadata(metadata).map((box) => {
    if ((box.left + box.width > 100 || box.top + box.height > 100) && imageWidth > 0 && imageHeight > 0) {
      return {
        ...box,
        left: (box.left / imageWidth) * 100,
        top: (box.top / imageHeight) * 100,
        width: (box.width / imageWidth) * 100,
        height: (box.height / imageHeight) * 100,
      };
    }
    return box;
  });
  if (!faces.length) return null;
  const imageRatio = Math.max(0.25, Math.min(4, (imageWidth || 1) / Math.max(1, imageHeight || 1)));
  const targetRatio = imageRatio > 1.15 ? 0.86 : imageRatio < 0.85 ? 0.76 : 1;
  const best = faces
    .map((box) => ({
      box,
      score: box.width * box.height + box.confidence * 10,
    }))
    .sort((left, right) => right.score - left.score)[0]?.box;
  if (!best) return null;
  const centerX = best.left + best.width / 2;
  const centerY = best.top + best.height * 0.44;
  const cropWidth = Math.max(best.width * 2.15, best.height * targetRatio * 2.05, 38);
  const cropHeight = Math.max(best.height * 2.25, cropWidth / Math.max(0.35, targetRatio), 42);
  return normalizePhotoCoverCrop({
    left: centerX - cropWidth / 2,
    top: centerY - cropHeight * 0.45,
    width: cropWidth,
    height: cropHeight,
  });
}

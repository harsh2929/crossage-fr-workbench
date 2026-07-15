import type { PhotoItem, PhotoMediaPair } from "../types";
import { normalizePhotoMediaPairList } from "./photoMediaPairs";

export type PhotoSpatialViewMode = "flat" | "depth" | "right-eye";

export type PhotoSpatialCapability = {
  detected: boolean;
  kind: "flat" | "portrait-depth" | "stereo" | "spatial-metadata";
  label: string;
  detail: string;
  metadataDetected: boolean;
  originalPreserved: boolean;
  depthPair: PhotoMediaPair | null;
  stereoPair: PhotoMediaPair | null;
  viewModes: PhotoSpatialViewMode[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataSignalKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function spatialMetadataSignals(value: unknown, depth = 0): { depth: boolean; stereo: boolean } {
  if (depth > 6 || !value || typeof value !== "object") return { depth: false, stereo: false };
  const entries = Array.isArray(value)
    ? value.slice(0, 24).map((item, index) => [String(index), item] as const)
    : Object.entries(record(value)).slice(0, 100);
  let depthDetected = false;
  let stereoDetected = false;
  for (const [rawKey, item] of entries) {
    const key = metadataSignalKey(rawKey);
    if (/^(ocr|caption|semantic|object|scene|localdepth|generated|generation|edit)/.test(key)) continue;
    if (/^(depth(?:map|data|image)?|disparity(?:map|image)?|portraitmatte|auxiliary(?:image|imagetype)?)$/.test(key)) {
      depthDetected = item !== null && item !== undefined && item !== false && String(item).trim() !== "";
    }
    if (/^(spatial(?:photo|video|media|type)?|stereo(?:pair|image)?|lefteye|righteye)$/.test(key)) {
      stereoDetected = item !== null && item !== undefined && item !== false && String(item).trim() !== "";
    }
    if (/^(auxiliaryimagetype|spatialmediatype|mediatype)$/.test(key) && typeof item === "string") {
      const signal = item.toLocaleLowerCase().slice(0, 500);
      depthDetected ||= /\b(depth|disparity|portrait[ _-]?matte)\b/.test(signal);
      stereoDetected ||= /\b(spatial[ _-]?(photo|video)|stereo|left[ _-]?eye|right[ _-]?eye)\b/.test(signal);
    }
    const nested = spatialMetadataSignals(item, depth + 1);
    depthDetected ||= nested.depth;
    stereoDetected ||= nested.stereo;
    if (depthDetected && stereoDetected) break;
  }
  return { depth: depthDetected, stereo: stereoDetected };
}

function availablePair(pairs: PhotoMediaPair[], kind: string): PhotoMediaPair | null {
  return pairs.find((pair) => (
    pair.pairKind === kind
    && pair.relatedExists !== false
    && Boolean(String(pair.relatedSourceUrl || "").trim())
  )) || null;
}

export function photoSpatialCapability(item: PhotoItem | null | undefined): PhotoSpatialCapability {
  const pairs = normalizePhotoMediaPairList(item?.mediaPairs);
  const depthPair = availablePair(pairs, "depth_sidecar");
  const stereoPair = availablePair(pairs, "stereo_pair");
  const metadataSignals = spatialMetadataSignals(item?.assetMetadata);
  const metadataDepth = metadataSignals.depth;
  const metadataStereo = metadataSignals.stereo;
  const metadataDetected = metadataDepth || metadataStereo;
  const viewModes: PhotoSpatialViewMode[] = ["flat"];
  if (depthPair) viewModes.push("depth");
  if (stereoPair) viewModes.push("right-eye");
  const kind = stereoPair
    ? "stereo"
    : depthPair
      ? "portrait-depth"
      : metadataDetected
        ? "spatial-metadata"
        : "flat";
  const label = kind === "stereo"
    ? "Stereo media"
    : kind === "portrait-depth"
      ? "Depth media"
      : kind === "spatial-metadata"
        ? "Spatial metadata"
        : "Standard 2D";
  const detail = depthPair && stereoPair
    ? "Original, depth, and alternate-eye files are available."
    : depthPair
      ? "An explicit depth or disparity companion is available."
      : stereoPair
        ? "An explicit alternate-eye companion is available."
        : metadataDetected
          ? "Spatial or depth metadata is preserved; no separately viewable companion was found."
          : "No spatial or depth payload was detected.";
  return {
    detected: kind !== "flat",
    kind,
    label,
    detail,
    metadataDetected,
    originalPreserved: Boolean(String(item?.sourcePath || "").trim()) && !item?.missingAt,
    depthPair,
    stereoPair,
    viewModes,
  };
}

export function photoSpatialViewUrl(
  capability: PhotoSpatialCapability,
  mode: PhotoSpatialViewMode,
  flatUrl: string,
): string {
  if (mode === "depth") return String(capability.depthPair?.relatedSourceUrl || flatUrl);
  if (mode === "right-eye") return String(capability.stereoPair?.relatedSourceUrl || flatUrl);
  return flatUrl;
}

export function photoSpatialViewLabel(mode: PhotoSpatialViewMode): string {
  if (mode === "depth") return "Depth";
  if (mode === "right-eye") return "Right eye";
  return "Photo";
}

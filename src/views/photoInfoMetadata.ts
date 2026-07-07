import type { PhotoItem } from "../types";

export interface PhotoXmpMetadataConflict {
  field: string;
  label: string;
  local: string;
  sidecar: string;
  sidecarValue: unknown;
}

export interface PhotoTechnicalMetadata {
  camera: string;
  lens: string;
  cameraSettings: string;
  software: string;
  codec: string;
  colorProfile: string;
  photographicStyle: string;
  depthMetadata: string;
  ocrMetadata: string;
  iptcCreator: string;
  iptcRights: string;
  iptcEvent: string;
  iptcLocation: string;
  gpsMetadata: string;
  modelTags: string;
  detectedItems: string;
  rawPreviewProxy: string;
  xmpSidecar: string;
  xmpRating: string;
  xmpConflicts: PhotoXmpMetadataConflict[];
}

export type PhotoLocalDepthMode = "" | "portrait" | "cinematic";

export interface PhotoLocalDepthControls {
  mode: PhotoLocalDepthMode;
  aperture: string;
  focusDistance: string;
  effect: string;
}

type MetadataPath = string | readonly string[];

const CAMERA_PATHS: readonly MetadataPath[] = [
  ["exif", "cameraMake"],
  ["exif", "cameraModel"],
  ["exif", "make"],
  ["exif", "model"],
  "camera",
  "cameraMake",
  "cameraModel",
  "device",
  "deviceMake",
  "deviceModel",
  "captureDevice",
];

const LENS_PATHS: readonly MetadataPath[] = [
  ["exif", "lensMake"],
  ["exif", "lensModel"],
  ["exif", "lensInfo"],
  ["exif", "lensSpecification"],
  ["exif", "lensSerialNumber"],
  "lens",
  "lensMake",
  "lensModel",
  "lensInfo",
  "lensSpecification",
  "lensSerialNumber",
];

const FOCAL_LENGTH_PATHS: readonly MetadataPath[] = [
  ["exif", "focalLengthMm"],
  ["exif", "focalLength"],
  ["exif", "focalLengthIn35mmFormat"],
  "focalLengthMm",
  "focalLength",
  "focalLengthIn35mmFormat",
];

const FOCAL_LENGTH_35MM_PATHS: readonly MetadataPath[] = [
  ["exif", "focalLength35mm"],
  ["exif", "focalLengthIn35mmFilm"],
  ["exif", "focalLengthIn35mmFormat"],
  "focalLength35mm",
  "focalLengthIn35mmFilm",
  "focalLengthIn35mmFormat",
];

const F_NUMBER_PATHS: readonly MetadataPath[] = [
  ["exif", "fNumber"],
  ["exif", "aperture"],
  "fNumber",
  "aperture",
];

const EXPOSURE_TIME_PATHS: readonly MetadataPath[] = [
  ["exif", "exposureTime"],
  ["exif", "shutterSpeed"],
  "exposureTime",
  "shutterSpeed",
];

const ISO_PATHS: readonly MetadataPath[] = [
  ["exif", "isoSpeed"],
  ["exif", "isoSpeedRatings"],
  ["exif", "photographicSensitivity"],
  ["exif", "iso"],
  "isoSpeed",
  "isoSpeedRatings",
  "photographicSensitivity",
  "iso",
];

const ORIENTATION_PATHS: readonly MetadataPath[] = [
  ["exif", "orientation"],
  ["exif", "orientationValue"],
  "orientation",
  "orientationValue",
];

const SOFTWARE_PATHS: readonly MetadataPath[] = [
  ["exif", "software"],
  "software",
  "editingSoftware",
  "sourceSoftware",
  "app",
];

const CODEC_PATHS: readonly MetadataPath[] = [
  "codec",
  "videoCodec",
  "audioCodec",
  "container",
  "format",
  ["video", "codec"],
  ["video", "codecName"],
  ["video", "format"],
  ["probe", "codec"],
  ["probe", "codecName"],
  ["probe", "format"],
];

const COLOR_PROFILE_PATHS: readonly MetadataPath[] = [
  "colorProfile",
  "iccProfile",
  "profileDescription",
  "colorSpace",
  ["exif", "colorSpace"],
  ["image", "colorProfile"],
  ["image", "iccProfile"],
  ["image", "colorSpace"],
];

const PHOTOGRAPHIC_STYLE_PATHS: readonly MetadataPath[] = [
  "photographicStyle",
  "photographicStyles",
  "photoStyle",
  "cameraStyle",
  "captureStyle",
  "pictureStyle",
  "creativeStyle",
  "styleName",
  ["exif", "photographicStyle"],
  ["exif", "photoStyle"],
  ["exif", "cameraStyle"],
  ["exif", "pictureStyle"],
  ["xmp", "photographicStyle"],
  ["xmp", "photoStyle"],
  ["xmp", "cameraStyle"],
  ["xmp", "pictureStyle"],
  ["xmp", "creativeStyle"],
  ["xmp", "styleName"],
  ["xmp", "profileName"],
  ["xmp", "look"],
];

const DEPTH_METADATA_PATHS: readonly MetadataPath[] = [
  ["localDepthControls", "modeLabel"],
  ["localDepthControls", "effect"],
  ["localDepthControls", "focusDistance"],
  ["localDepthControls", "aperture"],
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
  ["exif", "depthMetadata"],
  ["exif", "depth"],
  ["exif", "depthMap"],
  ["exif", "portraitMode"],
  ["exif", "portraitEffect"],
  ["exif", "cinematicMode"],
  ["xmp", "depthMetadata"],
  ["xmp", "depth"],
  ["xmp", "depthMap"],
  ["xmp", "portraitMode"],
  ["xmp", "portraitEffect"],
  ["xmp", "cinematicMode"],
];

const PHOTO_LOCAL_DEPTH_MODE_LABELS: Record<Exclude<PhotoLocalDepthMode, "">, string> = {
  portrait: "Portrait",
  cinematic: "Cinematic",
};

function normalizePhotoLocalDepthMode(value: unknown): PhotoLocalDepthMode {
  const clean = String(value || "").trim().toLocaleLowerCase();
  if (clean === "portrait" || clean === "portraitmode" || clean === "portrait_mode") return "portrait";
  if (clean === "cinematic" || clean === "cinematicmode" || clean === "cinematic_mode") return "cinematic";
  return "";
}

function normalizePhotoDepthNumberText(value: unknown, min: number, max: number): string {
  const number = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(number)) return "";
  const clamped = Math.max(min, Math.min(max, number));
  return String(Math.round(clamped * 10) / 10);
}

export function normalizePhotoLocalDepthControls(value: unknown): PhotoLocalDepthControls {
  const record = metadataRecord(value);
  return {
    mode: normalizePhotoLocalDepthMode(record.mode ?? record.modeLabel ?? record.kind ?? record.type),
    aperture: normalizePhotoDepthNumberText(record.aperture ?? record.fNumber ?? record.fStop, 0.7, 32),
    focusDistance: normalizePhotoDepthNumberText(record.focusDistance ?? record.subjectDistance ?? record.focus, 0, 1000),
    effect: metadataCleanText(record.effect ?? record.portraitEffect ?? record.label ?? record.name).slice(0, 120),
  };
}

export function photoLocalDepthControlsFromItem(item: PhotoItem | null | undefined): PhotoLocalDepthControls {
  return normalizePhotoLocalDepthControls(metadataRecord(item?.assetMetadata).localDepthControls);
}

export function photoLocalDepthControlsPayload(value: PhotoLocalDepthControls | null | undefined): Record<string, unknown> | null {
  const controls = normalizePhotoLocalDepthControls(value);
  const payload: Record<string, unknown> = {};
  if (controls.mode) {
    payload.mode = controls.mode;
    payload.modeLabel = PHOTO_LOCAL_DEPTH_MODE_LABELS[controls.mode];
  }
  if (controls.aperture) payload.aperture = controls.aperture;
  if (controls.focusDistance) payload.focusDistance = controls.focusDistance;
  if (controls.effect) payload.effect = controls.effect;
  return Object.keys(payload).length ? payload : null;
}

export function photoLocalDepthControlsEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(photoLocalDepthControlsPayload(normalizePhotoLocalDepthControls(left)) || {}) === JSON.stringify(photoLocalDepthControlsPayload(normalizePhotoLocalDepthControls(right)) || {});
}

const IPTC_CREATOR_PATHS: readonly MetadataPath[] = [
  ["xmp", "iptc", "creator"],
  ["xmp", "iptc", "credit"],
  ["xmp", "iptc", "source"],
  ["iptc", "creator"],
  ["iptc", "credit"],
  ["iptc", "source"],
];

const IPTC_RIGHTS_PATHS: readonly MetadataPath[] = [
  ["xmp", "iptc", "copyright"],
  ["xmp", "iptc", "usageTerms"],
  ["iptc", "copyright"],
  ["iptc", "usageTerms"],
];

const IPTC_EVENT_PATHS: readonly MetadataPath[] = [
  ["xmp", "iptc", "event"],
  ["xmp", "iptc", "headline"],
  ["xmp", "iptc", "jobId"],
  ["xmp", "iptc", "instructions"],
  ["iptc", "event"],
  ["iptc", "headline"],
  ["iptc", "jobId"],
  ["iptc", "instructions"],
];

const IPTC_LOCATION_PATHS: readonly MetadataPath[] = [
  ["xmp", "iptc", "locationCreated"],
  ["iptc", "locationCreated"],
];

const GPS_LATITUDE_PATHS: readonly MetadataPath[] = [
  ["exif", "gps", "latitude"],
  ["gps", "latitude"],
  ["latitude"],
  ["lat"],
];

const GPS_LONGITUDE_PATHS: readonly MetadataPath[] = [
  ["exif", "gps", "longitude"],
  ["gps", "longitude"],
  ["longitude"],
  ["lon"],
  ["lng"],
];

const MODEL_TAGS_PATHS: readonly MetadataPath[] = [
  ["modelTags"],
  ["objectTags"],
  ["sceneTags"],
  ["tags"],
  ["labels"],
];

const DETECTED_ITEMS_PATHS: readonly MetadataPath[] = [
  ["detectedItems"],
  ["detectedEvents"],
  ["objects"],
  ["scenes"],
  ["events"],
];

function compactGpsMetadata(metadata: Record<string, unknown>): string {
  const lat = firstMetadataText(metadata, GPS_LATITUDE_PATHS);
  const lon = firstMetadataText(metadata, GPS_LONGITUDE_PATHS);
  if (!lat || !lon) return "";
  const latNum = Number(lat);
  const lonNum = Number(lon);
  const latText = Number.isFinite(latNum) ? latNum.toFixed(4) : lat;
  const lonText = Number.isFinite(lonNum) ? lonNum.toFixed(4) : lon;
  return `Lat ${latText}, Lon ${lonText}`;
}

function metadataPathLabel(path: MetadataPath): string {
  const key = (Array.isArray(path) ? path[path.length - 1] : path).toLocaleLowerCase();
  if (key.includes("cinematic")) return "Cinematic";
  if (key.includes("portrait")) return "Portrait";
  if (key.includes("disparity")) return "Disparity map";
  if (key.includes("depth")) return "Depth";
  if (key.includes("focus")) return "Focus";
  if (key.includes("aperture") || key === "fnumber") return "Aperture";
  if (key.includes("auxiliary")) return "Auxiliary depth";
  return "Depth";
}

function compactDepthMetadataValues(metadata: Record<string, unknown>): string {
  const seen = new Set<string>();
  const values: string[] = [];
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    values.push(clean);
  };
  DEPTH_METADATA_PATHS.forEach((path) => {
    const raw = metadataPathValue(metadata, path);
    const label = metadataPathLabel(path);
    if (raw === true) {
      add(label);
      return;
    }
    if (raw === false || raw === null || raw === undefined) return;
    const textValues = metadataTextValues(raw);
    if (!textValues.length && typeof raw === "object") {
      add(label);
      return;
    }
    if (typeof raw === "object" && textValues.length && textValues.every((value) => /^(available|enabled|present|true|yes)$/i.test(value))) {
      add(label);
      return;
    }
    textValues.forEach((value) => {
      const clean = value.replace(/\s+/g, " ").trim();
      if (!clean) return;
      if (label === "Aperture" && /^([0-9]+(?:\.[0-9]+)?)$/.test(clean)) add(`f/${clean}`);
      else if (label === "Focus" && /^([0-9]+(?:\.[0-9]+)?)$/.test(clean)) add(`Focus ${clean}`);
      else add(clean);
    });
  });
  return values.join(", ");
}

function firstMetadataText(metadata: Record<string, unknown>, paths: readonly MetadataPath[]): string {
  for (const path of paths) {
    const value = metadataTextValues(metadataPathValue(metadata, path))[0];
    if (value) return value;
  }
  return "";
}

function cleanCameraSettingNumber(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s*mm(?:\s+equiv(?:alent)?)?$/i, "").replace(/^f\//i, "").replace(/^iso\s*/i, "").trim();
}

function compactCameraSettings(metadata: Record<string, unknown>): string {
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    values.push(clean);
  };

  const focalLength = cleanCameraSettingNumber(firstMetadataText(metadata, FOCAL_LENGTH_PATHS));
  if (focalLength) add(`${focalLength} mm`);
  const focalLength35mm = cleanCameraSettingNumber(firstMetadataText(metadata, FOCAL_LENGTH_35MM_PATHS));
  if (focalLength35mm && focalLength35mm !== focalLength) add(`${focalLength35mm} mm equiv`);
  const fNumber = cleanCameraSettingNumber(firstMetadataText(metadata, F_NUMBER_PATHS));
  if (fNumber) add(`f/${fNumber}`);
  const exposureTime = firstMetadataText(metadata, EXPOSURE_TIME_PATHS);
  if (exposureTime) add(/\bs$/i.test(exposureTime) ? exposureTime : `${exposureTime} s`);
  const iso = cleanCameraSettingNumber(firstMetadataText(metadata, ISO_PATHS));
  if (iso) add(`ISO ${iso}`);
  const orientation = firstMetadataText(metadata, ORIENTATION_PATHS);
  if (orientation) add(orientation);
  return values.join(", ");
}

function cleanPercent(value: unknown): string {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value || "").trim());
  if (!Number.isFinite(parsed) || parsed < 0) return "";
  const percent = parsed <= 1 ? parsed * 100 : parsed;
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

function compactOcrMetadata(metadata: Record<string, unknown>): string {
  const localOcr = metadataRecord(metadata.localOcr);
  const values: string[] = [];
  const seen = new Set<string>();
  const add = (label: string, value: unknown) => {
    const clean = metadataCleanText(value);
    if (!clean) return;
    const text = `${label} ${clean}`;
    const key = text.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    values.push(text);
  };
  add("Engine", localOcr.engine || localOcr.source || metadata.ocrEngine);
  add("Language", localOcr.language || metadata.ocrLanguage || metadata.language);
  add("Detected language", localOcr.detectedLanguage || metadata.detectedLanguage || metadata.ocrDetectedLanguage);
  let script = localOcr.detectedScript || metadata.detectedScript || metadata.ocrScript;
  if (!script && Array.isArray(localOcr.detectedScripts)) {
    script = metadataRecord(localOcr.detectedScripts[0]).script;
  }
  add("Script", script);
  const confidence = cleanPercent(metadata.ocrConfidence || localOcr.confidence);
  if (confidence) add("Confidence", confidence);
  const regionCount = Number(localOcr.regionCount || 0) || (Array.isArray(metadata.textRegions) ? metadata.textRegions.length : 0);
  if (regionCount > 0) add("Regions", String(regionCount));
  return values.join(", ");
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function metadataCleanText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  return "";
}

function metadataPathValue(metadata: Record<string, unknown>, path: MetadataPath): unknown {
  if (typeof path === "string") return metadata[path];
  return path.reduce<unknown>((value, key) => metadataRecord(value)[key], metadata);
}

function metadataTextValues(value: unknown, depth = 0): string[] {
  if (depth > 4) return [];
  if (typeof value === "string" || typeof value === "number") {
    const clean = String(value).replace(/\s+/g, " ").trim();
    return clean ? [clean] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => metadataTextValues(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const record = metadataRecord(value);
    const labelValues = ["label", "name", "text"]
      .flatMap((key) => metadataTextValues(record[key], depth + 1));
    if (labelValues.length) return labelValues;
    const preferred = ["value", "title", "description", "codec", "format", "profile"]
      .flatMap((key) => metadataTextValues(record[key], depth + 1));
    if (preferred.length) return preferred;
    return Object.values(record).flatMap((item) => metadataTextValues(item, depth + 1));
  }
  return [];
}

function compactMetadataValues(metadata: Record<string, unknown>, paths: readonly MetadataPath[], separator: string): string {
  const seen = new Set<string>();
  const values: string[] = [];
  paths.forEach((path) => {
    metadataTextValues(metadataPathValue(metadata, path)).forEach((value) => {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      values.push(value);
    });
  });
  return values.join(separator);
}

function normalizePhotoXmpConflicts(value: unknown): PhotoXmpMetadataConflict[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = metadataRecord(item);
    const field = metadataCleanText(record.field);
    const label = metadataCleanText(record.label) || field;
    const local = metadataCleanText(record.local);
    const sidecar = metadataCleanText(record.sidecar);
    if (!field || !sidecar) return null;
    return {
      field,
      label,
      local,
      sidecar,
      sidecarValue: "sidecarValue" in record ? record.sidecarValue : sidecar,
    };
  }).filter(Boolean) as PhotoXmpMetadataConflict[];
}

export function buildPhotoTechnicalMetadata(item: PhotoItem | null | undefined): PhotoTechnicalMetadata {
  const metadata = metadataRecord(item?.assetMetadata);
  const xmp = metadataRecord(metadata.xmp);
  return {
    camera: compactMetadataValues(metadata, CAMERA_PATHS, " "),
    lens: compactMetadataValues(metadata, LENS_PATHS, " "),
    cameraSettings: compactCameraSettings(metadata),
    software: compactMetadataValues(metadata, SOFTWARE_PATHS, ", "),
    codec: compactMetadataValues(metadata, CODEC_PATHS, ", "),
    colorProfile: compactMetadataValues(metadata, COLOR_PROFILE_PATHS, ", "),
    photographicStyle: compactMetadataValues(metadata, PHOTOGRAPHIC_STYLE_PATHS, ", "),
    depthMetadata: compactDepthMetadataValues(metadata),
    ocrMetadata: compactOcrMetadata(metadata),
    iptcCreator: compactMetadataValues(metadata, IPTC_CREATOR_PATHS, ", "),
    iptcRights: compactMetadataValues(metadata, IPTC_RIGHTS_PATHS, ", "),
    iptcEvent: compactMetadataValues(metadata, IPTC_EVENT_PATHS, ", "),
    iptcLocation: compactMetadataValues(metadata, IPTC_LOCATION_PATHS, ", "),
    gpsMetadata: compactGpsMetadata(metadata),
    modelTags: compactMetadataValues(metadata, MODEL_TAGS_PATHS, ", "),
    detectedItems: compactMetadataValues(metadata, DETECTED_ITEMS_PATHS, ", "),
    rawPreviewProxy: metadataCleanText(item?.rawPreviewProxyPath),
    xmpSidecar: metadataTextValues(xmp.sidecarPath)[0] || "",
    xmpRating: metadataTextValues(xmp.rating)[0] || "",
    xmpConflicts: normalizePhotoXmpConflicts(xmp.conflicts),
  };
}

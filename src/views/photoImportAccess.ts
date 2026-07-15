import type { PhotoImportSourceKind } from "../types";

export interface PhotoImportAccessEntry {
  path: string;
  isDir?: boolean;
  sourceKind?: string;
  sourceLabel?: string;
  sourceDetail?: string;
}

export interface PhotoImportAccessGuidance {
  code: "apple-photos-library-package" | "os-protected-folder";
  message: string;
  path: string;
}

export type PhotoImportInferredSourceKind = "folder" | "camera" | "library" | "mail" | "safari" | "messages" | "airdrop" | "downloads" | "app";
export type PhotoImportSystemSourceKind = "folder" | "camera" | "library" | "mail" | "safari" | "messages" | "airdrop" | "downloads" | "app";

export interface PhotoImportSystemSourceLike {
  id?: string;
  label?: string;
  detail?: string;
  path?: string;
  kind?: string;
  available?: boolean;
  platform?: string;
}

export interface PhotoImportSystemSourceRow {
  key: string;
  source: PhotoImportSystemSourceLike;
  sourceKind: PhotoImportSystemSourceKind;
  kindLabel: string;
  label: string;
  detail: string;
  path: string;
  available: boolean;
  badges: string[];
  deviceLike: boolean;
  deleteFromSourceSupported: boolean;
  safetyDetail: string;
}

export interface PhotoImportReviewSummary {
  inferredSourceKind: PhotoImportInferredSourceKind;
  sourceLabel: string;
  deviceLike: boolean;
  deleteFromSourceSupported: boolean;
  deleteFromSourceLabel: string;
  deleteFromSourceDetail: string;
  reviewTitle: string;
  reviewDetail: string;
  hints: string[];
}

export interface PhotoImportAttributionSummary {
  sourceKind: PhotoImportInferredSourceKind;
  sourceLabel: string;
  sourceDetail: string;
  sourceDetails: string[];
}

const photoImportSourceLabels: Record<PhotoImportInferredSourceKind, string> = {
  folder: "Imported files",
  camera: "Camera/device import",
  library: "Photo library",
  mail: "Mail",
  safari: "Safari",
  messages: "Messages",
  airdrop: "AirDrop",
  downloads: "Downloads",
  app: "Other app",
};

export const PHOTO_IMPORT_SOURCE_OPTIONS: Array<{ kind: PhotoImportSourceKind; label: string }> = [
  { kind: "folder", label: "Files/folders" },
  { kind: "camera", label: "Camera/device" },
  { kind: "library", label: "Photo library" },
  { kind: "mail", label: "Mail" },
  { kind: "safari", label: "Safari" },
  { kind: "messages", label: "Messages" },
  { kind: "airdrop", label: "AirDrop" },
  { kind: "downloads", label: "Downloads" },
  { kind: "app", label: "Other app" },
];

const photoImportSystemSourceKindLabels: Record<PhotoImportSystemSourceKind, string> = {
  folder: "Folder",
  camera: "Camera/device",
  library: "Photo library",
  mail: "Mail",
  safari: "Safari",
  messages: "Messages",
  airdrop: "AirDrop",
  downloads: "Downloads",
  app: "Other app",
};

const protectedFolderNames = new Set(["desktop", "documents", "downloads", "pictures", "movies"]);
const cameraVendorParts = new Set([
  "100apple",
  "101apple",
  "camera",
  "camera roll",
  "canon",
  "dcim",
  "eos_digital",
  "fujifilm",
  "gopro",
  "lumix",
  "nikon",
  "olympus",
  "panasonic",
  "private",
  "sony",
]);

function normalizeImportPath(path: string) {
  return String(path || "").trim().replace(/\\/g, "/");
}

function pathParts(path: string) {
  return normalizeImportPath(path)
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isUserProtectedPath(path: string, lowerParts: string[]) {
  const lower = normalizeImportPath(path).toLowerCase();
  const userPath = lower.startsWith("/users/") || lower.startsWith("~/") || /^[a-z]:\/users\//.test(lower);
  const protectedFolder = lowerParts.some((part) => protectedFolderNames.has(part));
  return (userPath && protectedFolder) || lower.includes("/library/mobile documents/") || lower.includes("/icloud drive/");
}

function isDownloadsPath(lowerParts: string[]) {
  return lowerParts.includes("downloads");
}

function pathHaystack(path: string, lowerParts: string[]) {
  return `${normalizeImportPath(path).toLowerCase()} ${lowerParts.join(" ")}`;
}

function inferredAppSourceKindForPath(path: string, lowerParts: string[]): Exclude<PhotoImportInferredSourceKind, "folder" | "camera" | "downloads"> | "" {
  const haystack = pathHaystack(path, lowerParts);
  if (lowerParts.some((part) => part.endsWith(".photoslibrary")) || haystack.includes("photos library")) return "library";
  if (haystack.includes("com.apple.mail") || haystack.includes("mail downloads") || lowerParts.includes("mail")) return "mail";
  if (haystack.includes("com.apple.safari") || lowerParts.includes("safari") || lowerParts.includes("browser")) return "safari";
  if (haystack.includes("com.apple.messages") || haystack.includes("library/messages") || lowerParts.includes("messages") || lowerParts.includes("imessage")) return "messages";
  if (haystack.includes("airdrop") || haystack.includes("air drop")) return "airdrop";
  if (haystack.includes("icloud") || haystack.includes("mobile documents") || haystack.includes("onedrive") || haystack.includes("dropbox")) return "app";
  return "";
}

function isMountedVolumePath(path: string) {
  const lower = normalizeImportPath(path).toLowerCase();
  return lower.startsWith("/volumes/") || /^\/media\//.test(lower) || /^\/run\/media\//.test(lower) || /^[a-z]:\//.test(lower);
}

function isCameraLikePath(path: string, lowerParts: string[]) {
  if (lowerParts.some((part) => cameraVendorParts.has(part))) return true;
  if (lowerParts.some((part) => /^10\dapple$/.test(part))) return true;
  if (isMountedVolumePath(path) && lowerParts.some((part) => part === "photos" || part === "videos" || part === "mp_root")) return true;
  return false;
}

function cleanImportAttributionText(value: unknown, maxLength = 180) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...` : cleaned;
}

function normalizeEntrySourceKind(value: unknown): PhotoImportInferredSourceKind | "" {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(photoImportSourceLabels, normalized) ? normalized as PhotoImportInferredSourceKind : "";
}

function sourceLabelForKind(kind: PhotoImportInferredSourceKind, fallbackLabel = "Imported files") {
  if (kind === "folder") return cleanImportAttributionText(fallbackLabel, 80) || photoImportSourceLabels.folder;
  return photoImportSourceLabels[kind] || cleanImportAttributionText(fallbackLabel, 80) || photoImportSourceLabels.folder;
}

export function photoImportSourceLabel(kind: PhotoImportSourceKind, fallback: string, preserveFallback = false): string {
  const cleanFallback = String(fallback || "").trim();
  if (preserveFallback && cleanFallback) return cleanFallback;
  if (kind === "folder") return cleanFallback;
  return PHOTO_IMPORT_SOURCE_OPTIONS.find((option) => option.kind === kind)?.label || cleanFallback;
}

export function photoImportReviewSourceLabel(kind: PhotoImportSourceKind, fallback: string, preserveFallback = false): string {
  const label = photoImportSourceLabel(kind, fallback, preserveFallback);
  if (!preserveFallback || kind === "folder") return label;
  const kindLabel = PHOTO_IMPORT_SOURCE_OPTIONS.find((option) => option.kind === kind)?.label || "";
  if (!label || !kindLabel || label.toLowerCase() === kindLabel.toLowerCase()) return label || kindLabel;
  return `${label} · ${kindLabel}`;
}

export function photoImportSourceKindFromInference(kind: PhotoImportInferredSourceKind): PhotoImportSourceKind {
  return PHOTO_IMPORT_SOURCE_OPTIONS.some((option) => option.kind === kind) ? kind : "folder";
}

export function normalizeExternalPhotoImportSourceKind(kind?: PhotoImportSourceKind | string): PhotoImportSourceKind {
  return PHOTO_IMPORT_SOURCE_OPTIONS.some((option) => option.kind === kind) ? kind as PhotoImportSourceKind : "folder";
}

export function photoImportSystemSourceKindLabel(kind: unknown): string {
  const normalized = normalizeEntrySourceKind(kind);
  return normalized ? photoImportSystemSourceKindLabels[normalized] : photoImportSystemSourceKindLabels.folder;
}

export function buildPhotoImportSystemSourceRows(sources: PhotoImportSystemSourceLike[]): PhotoImportSystemSourceRow[] {
  return (sources || []).map((source, index) => {
    const sourceKind = photoImportSourceKindForSystemSource(source);
    const label = cleanImportAttributionText(source?.label, 90) || "Photo source";
    const detail = cleanImportAttributionText(source?.detail, 180) || sourceLabelForKind(sourceKind, label);
    const sourcePath = cleanImportAttributionText(source?.path, 320);
    const kindLabel = photoImportSystemSourceKindLabel(sourceKind);
    const available = source?.available !== false;
    const deviceLike = sourceKind === "camera";
    const badges = [
      kindLabel,
      available ? "Available" : "Unavailable",
      ...(deviceLike ? ["Device/card"] : []),
      ...(sourceKind === "library" ? ["Library"] : []),
    ];
    return {
      key: cleanImportAttributionText(source?.id, 120) || sourcePath || `${sourceKind}:${index}`,
      source,
      sourceKind,
      kindLabel,
      label,
      detail,
      path: sourcePath,
      available,
      badges,
      deviceLike,
      deleteFromSourceSupported: false,
      safetyDetail: deviceLike
        ? "Delete after import is unavailable for local camera, phone, and card paths."
        : "",
    };
  });
}

function inferredSourceKindForPath(path: string): PhotoImportInferredSourceKind {
  const lowerParts = pathParts(path).map((part) => part.toLowerCase());
  if (isCameraLikePath(path, lowerParts)) return "camera";
  const appKind = inferredAppSourceKindForPath(path, lowerParts);
  if (appKind) return appKind;
  if (lowerParts.some((part) => isDownloadsPath([part]))) return "downloads";
  return "folder";
}

function sourceContainerParts(entry: PhotoImportAccessEntry) {
  const parts = pathParts(entry?.path || "");
  return entry?.isDir ? parts : parts.slice(0, -1);
}

function titleCaseImportPathPart(value: string) {
  const clean = value.replace(/[-_]+/g, " ").trim();
  if (!clean) return "";
  if (/^[A-Z0-9\s.]+$/.test(clean)) return clean;
  return clean.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function sourceTailFromMarker(parts: string[], marker: (part: string) => boolean, label: string, afterCount = 1) {
  const lowerParts = parts.map((part) => part.toLowerCase());
  const index = lowerParts.findIndex(marker);
  if (index < 0) return label;
  const tail = parts.slice(index, index + afterCount + 1).map(titleCaseImportPathPart).filter(Boolean);
  return tail.length ? tail.join(" / ") : label;
}

function pathAttributionDetailForEntry(entry: PhotoImportAccessEntry, kind: PhotoImportInferredSourceKind) {
  const parts = sourceContainerParts(entry);
  if (!parts.length) return "";
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (kind === "mail") return sourceTailFromMarker(parts, (part) => part === "mail downloads", "Mail Downloads", 1);
  if (kind === "safari") return lowerParts.includes("downloads") ? "Safari Downloads" : "Safari";
  if (kind === "messages") return sourceTailFromMarker(parts, (part) => part === "messages" || part === "attachments", "Messages attachments", 2);
  if (kind === "airdrop") return "AirDrop";
  if (kind === "downloads") return "Downloads";
  if (kind === "library") {
    const libraryPart = parts.find((part) => part.toLowerCase().endsWith(".photoslibrary"));
    return libraryPart ? `${titleCaseImportPathPart(libraryPart)} package` : "Photo library";
  }
  if (kind === "camera") {
    if (lowerParts.includes("dcim")) return sourceTailFromMarker(parts, (part) => part === "dcim", "DCIM", 1);
    if (lowerParts.includes("private")) return sourceTailFromMarker(parts, (part) => part === "private", "PRIVATE", 1);
    return "Camera/device path";
  }
  if (kind === "app") {
    if (lowerParts.includes("mobile documents")) return "iCloud Drive";
    const cloudPart = parts.find((part) => /dropbox|onedrive|cloud|drive/i.test(part));
    return cloudPart ? titleCaseImportPathPart(cloudPart) : "Other app";
  }
  return "";
}

function summarizeImportAttributionDetails(values: string[]) {
  const unique = [...new Set(values.map((value) => cleanImportAttributionText(value, 160)).filter(Boolean))];
  if (!unique.length) return "";
  if (unique.length <= 2) return cleanImportAttributionText(unique.join(" · "), 240);
  return cleanImportAttributionText(`${unique.slice(0, 2).join(" · ")} + ${unique.length - 2} more sources`, 240);
}

export function buildPhotoImportAttributionSummary(entries: PhotoImportAccessEntry[], fallbackLabel = "Imported files"): PhotoImportAttributionSummary {
  const safeEntries = entries || [];
  const explicitKinds = safeEntries.map((entry) => normalizeEntrySourceKind(entry?.sourceKind)).filter(Boolean) as PhotoImportInferredSourceKind[];
  const inferredKinds = safeEntries
    .map((entry) => normalizeEntrySourceKind(entry?.sourceKind) || inferredSourceKindForPath(entry?.path || ""))
    .filter(Boolean) as PhotoImportInferredSourceKind[];
  const nonFolderKinds = inferredKinds.filter((kind) => kind !== "folder");
  const uniqueNonFolderKinds = [...new Set(nonFolderKinds)];
  const sourceKind = explicitKinds[0]
    || (uniqueNonFolderKinds.includes("camera") ? "camera" : uniqueNonFolderKinds.length === 1 ? uniqueNonFolderKinds[0] : uniqueNonFolderKinds.length > 1 ? "app" : "folder");
  const explicitLabels = [...new Set(safeEntries.map((entry) => cleanImportAttributionText(entry?.sourceLabel, 80)).filter(Boolean))];
  const sourceLabel = explicitLabels.length === 1 ? explicitLabels[0] : sourceLabelForKind(sourceKind, fallbackLabel);
  const explicitDetails = safeEntries.map((entry) => cleanImportAttributionText(entry?.sourceDetail, 180)).filter(Boolean);
  const generatedDetails = safeEntries
    .map((entry) => pathAttributionDetailForEntry(entry, normalizeEntrySourceKind(entry?.sourceKind) || inferredSourceKindForPath(entry?.path || "")))
    .filter(Boolean);
  const sourceDetails = [...new Set((explicitDetails.length ? explicitDetails : generatedDetails).map((detail) => cleanImportAttributionText(detail, 180)).filter(Boolean))];
  return {
    sourceKind,
    sourceLabel,
    sourceDetail: summarizeImportAttributionDetails(sourceDetails),
    sourceDetails,
  };
}

export function photoImportSourceKindForSystemSource(source: PhotoImportSystemSourceLike): PhotoImportSystemSourceKind {
  const haystack = [
    source?.id,
    source?.kind,
    source?.label,
    source?.detail,
    source?.path,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  const normalizedPath = normalizeImportPath(source?.path || "").toLowerCase();
  const lowerParts = pathParts(normalizedPath).map((part) => part.toLowerCase());
  if (haystack.includes("apple-photos") || haystack.includes("photos library") || normalizedPath.includes(".photoslibrary")) {
    return "library";
  }
  if (haystack.includes("mail")) return "mail";
  if (haystack.includes("safari")) return "safari";
  if (haystack.includes("messages")) return "messages";
  if (haystack.includes("airdrop")) return "airdrop";
  if (haystack.includes("downloads") || isDownloadsPath(lowerParts)) return "downloads";
  if (haystack.includes("camera") || haystack.includes("phone") || isCameraLikePath(normalizedPath, lowerParts)) return "camera";
  if (haystack.includes("icloud") || haystack.includes("onedrive") || haystack.includes("app")) return "app";
  return "folder";
}

export function buildPhotoImportReviewSummary(entries: PhotoImportAccessEntry[], fallbackLabel = "Imported files"): PhotoImportReviewSummary {
  const safeEntries = entries || [];
  const normalized = safeEntries.map((entry) => normalizeImportPath(entry?.path || "")).filter(Boolean);
  const lowerParts = normalized.flatMap((path) => pathParts(path).map((part) => part.toLowerCase()));
  const explicitSourceKind = safeEntries.map((entry) => normalizeEntrySourceKind(entry?.sourceKind)).find(Boolean) || "";
  const explicitSourceLabel = safeEntries.map((entry) => cleanImportAttributionText(entry?.sourceLabel, 80)).find(Boolean) || "";
  const deviceLike = explicitSourceKind === "camera" || normalized.some((path) => isCameraLikePath(path, pathParts(path).map((part) => part.toLowerCase())));
  const fromDownloads = !deviceLike && (explicitSourceKind === "downloads" || lowerParts.some((part) => isDownloadsPath([part])));
  const inferredAppSourceKind = (explicitSourceKind && !["folder", "camera", "downloads"].includes(explicitSourceKind) ? explicitSourceKind : "") || normalized
    .map((path) => inferredAppSourceKindForPath(path, pathParts(path).map((part) => part.toLowerCase())))
    .find(Boolean) || "";
  if (deviceLike) {
    const hints = [
      lowerParts.includes("dcim") ? "DCIM" : "",
      lowerParts.includes("private") ? "PRIVATE" : "",
      normalized.some((path) => isMountedVolumePath(path)) ? "Mounted volume" : "",
    ].filter(Boolean);
    return {
      inferredSourceKind: "camera",
      sourceLabel: explicitSourceLabel || "Camera/device import",
      deviceLike: true,
      deleteFromSourceSupported: false,
      deleteFromSourceLabel: "Delete from device after import",
      deleteFromSourceDetail: "Unavailable for this local file/folder import path. Originals stay on the camera, phone, card, or drive.",
      reviewTitle: "Device import review",
      reviewDetail: "This looks like camera, phone, card, or device media. Review the staged files before importing.",
      hints: hints.length ? hints : ["Camera/device path"],
    };
  }
  if (inferredAppSourceKind) {
    const sourceLabel = explicitSourceLabel || photoImportSourceLabels[inferredAppSourceKind];
    return {
      inferredSourceKind: inferredAppSourceKind,
      sourceLabel,
      deviceLike: false,
      deleteFromSourceSupported: false,
      deleteFromSourceLabel: "Delete source after import",
      deleteFromSourceDetail: `Unavailable for ${sourceLabel} imports. Originals stay where they are.`,
      reviewTitle: "Import review",
      reviewDetail: `These files appear to come from ${sourceLabel}.`,
      hints: [sourceLabel],
    };
  }
  if (fromDownloads) {
    return {
      inferredSourceKind: "downloads",
      sourceLabel: explicitSourceLabel || "Downloads",
      deviceLike: false,
      deleteFromSourceSupported: false,
      deleteFromSourceLabel: "Delete source after import",
      deleteFromSourceDetail: "Unavailable for Downloads imports. Originals stay where they are.",
      reviewTitle: "Import review",
      reviewDetail: "These files appear to come from Downloads.",
      hints: ["Downloads"],
    };
  }
  return {
    inferredSourceKind: "folder",
    sourceLabel: String(fallbackLabel || "Imported files").trim() || "Imported files",
    deviceLike: false,
    deleteFromSourceSupported: false,
    deleteFromSourceLabel: "Delete source after import",
    deleteFromSourceDetail: "Unavailable for local file/folder imports. Originals stay where they are.",
    reviewTitle: "Import review",
    reviewDetail: "",
    hints: [],
  };
}

export function buildPhotoImportAccessGuidance(entries: PhotoImportAccessEntry[]): PhotoImportAccessGuidance[] {
  const guidance: PhotoImportAccessGuidance[] = [];
  const seen = new Set<string>();

  const add = (code: PhotoImportAccessGuidance["code"], message: string, path: string) => {
    if (seen.has(code)) return;
    seen.add(code);
    guidance.push({ code, message, path });
  };

  for (const entry of entries || []) {
    const sourcePath = normalizeImportPath(entry?.path || "");
    if (!sourcePath) continue;
    const lowerParts = pathParts(sourcePath).map((part) => part.toLowerCase());
    if (lowerParts.some((part) => part.endsWith(".photoslibrary"))) {
      add(
        "apple-photos-library-package",
        "Apple Photos libraries are package databases. Export unmodified originals from Photos when possible; direct import only reads local files the OS allows Vintrace to see.",
        sourcePath,
      );
    }
    if (isUserProtectedPath(sourcePath, lowerParts)) {
      add(
        "os-protected-folder",
        "This source may need Files and Folders or Full Disk Access permission before import can read it.",
        sourcePath,
      );
    }
  }

  return guidance;
}

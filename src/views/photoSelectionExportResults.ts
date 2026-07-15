import type { PhotoSelectionExportValue } from "../types";

type PhotoSelectionExportRow = PhotoSelectionExportValue["items"][number];

export interface PhotoSelectionShareDraft {
  sourcePathsForEvent: string[];
  pathsForShare: string[];
  strippedLocation: boolean;
  skippedCount: number;
  shareAction: string;
  fallbackAction: string;
}

export interface PhotoSelectionShareEventMetadata extends Record<string, unknown> {
  surface: string;
  action: string;
  strippedLocation: boolean;
  targetCount: number;
  skippedCount: number;
}

export interface PhotoSelectionExportRowDetailItem {
  label: string;
  value: string;
  title?: string;
}

export interface PhotoSelectionExportRowDetailFormatters {
  uiText?: (value: string) => string;
  fileName?: (value: string) => string;
  shortText?: (value: string) => string;
  formatCount?: (value: number) => string;
  formatDuration?: (value: number) => string;
}

export interface PhotoSelectionExportMetricCounts {
  written: number;
  rendered: number;
  sidecars: number;
  skipped: number;
  needsAttention: number;
  credentialsSigned: number;
  credentialsPreserved: number;
  credentialsFailed: number;
}

export interface PhotoSelectionExportRowSummary {
  sourceLabel: string;
  sourceTitle: string;
  resultLabel: string;
  targetLabel: string;
  targetTitle?: string;
  hasTarget: boolean;
}

export interface PhotoSelectionExportPanelState {
  issueRows: PhotoSelectionExportValue["items"];
  successRows: PhotoSelectionExportValue["items"];
  visibleIssueRows: PhotoSelectionExportValue["items"];
  visibleSuccessRows: PhotoSelectionExportValue["items"];
  issueOverflowCount: number;
  successOverflowCount: number;
  metrics: PhotoSelectionExportMetricCounts;
  statusClass: "warning" | "ok";
  role: "alert" | "status";
}

const PHOTO_SELECTION_EXPORT_SUCCESS_RESULTS = new Set([
  "copied",
  "moved",
  "rendered",
  "rendered_edit",
  "rendered_raw_proxy",
  "rendered_raw_proxy_edit",
  "rendered_video",
  "rendered_video_edit",
]);

const PHOTO_SELECTION_EXPORT_RENDERED_IMAGE_RESULTS = new Set([
  "rendered",
  "rendered_edit",
  "rendered_raw_proxy",
  "rendered_raw_proxy_edit",
]);

const PHOTO_SELECTION_EXPORT_RENDERED_IMAGE_FORMATS = new Set(["jpeg", "png", "tiff", "heic"]);
const PHOTO_SELECTION_EXPORT_RENDERED_VIDEO_RESULTS = new Set(["rendered_video", "rendered_video_edit"]);
const PHOTO_SELECTION_EXPORT_RENDERED_VIDEO_FORMATS = new Set(["mp4", "mov", "m4v", "webm", "hevc", "prores"]);

function cleanPath(value: unknown): string {
  return String(value || "").trim();
}

function uniqueCleanPaths(values: readonly unknown[]): string[] {
  return [...new Set(values.map(cleanPath).filter(Boolean))];
}

function cleanText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function defaultFileName(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function defaultShortText(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}...${value.slice(-6)}` : value;
}

function labelText(formatters: PhotoSelectionExportRowDetailFormatters, value: string): string {
  return formatters.uiText?.(value) || value;
}

function contentCredentialStatusLabel(
  formatters: PhotoSelectionExportRowDetailFormatters,
  value: string,
): string {
  const labels: Record<string, string> = {
    signed: "Signed",
    "preserved-original": "Preserved from original",
    "preserved-original-fallback": "Original credential preserved after render fallback",
    "preserved-invalid": "Preserved; validation failed",
    "preserved-invalid-fallback": "Preserved after fallback; validation failed",
    "original-fallback-no-credential": "Original fallback; no credential",
    "no-credential": "No credential",
    failed: "Signing failed",
  };
  return labelText(formatters, labels[value] || value);
}

function pathValue(formatters: PhotoSelectionExportRowDetailFormatters, value: string): string {
  const fileName = formatters.fileName?.(value) || defaultFileName(value);
  return fileName || formatters.shortText?.(value) || defaultShortText(value);
}

function countValue(formatters: PhotoSelectionExportRowDetailFormatters, value: number): string {
  return formatters.formatCount?.(value) || String(value);
}

function durationValue(formatters: PhotoSelectionExportRowDetailFormatters, value: number): string {
  return formatters.formatDuration?.(value) || "";
}

export function photoSelectionExportRowSucceeded(result: unknown): boolean {
  const text = String(result || "").trim();
  if (!text) return false;
  return PHOTO_SELECTION_EXPORT_SUCCESS_RESULTS.has(text) || text.startsWith("copied_original_render_fallback");
}

export function photoSelectionExportRowIsStripLocationShareable(row: PhotoSelectionExportRow): boolean {
  const result = String(row.result || "").trim();
  const targetPath = String(row.targetPath || "").trim();
  const renderFormat = String(row.renderFormat || "").trim().toLowerCase();
  const videoRenderFormat = String(row.videoRenderFormat || "").trim().toLowerCase();
  if (!targetPath) return false;
  if (PHOTO_SELECTION_EXPORT_RENDERED_IMAGE_RESULTS.has(result)) {
    return PHOTO_SELECTION_EXPORT_RENDERED_IMAGE_FORMATS.has(renderFormat) && !videoRenderFormat;
  }
  return PHOTO_SELECTION_EXPORT_RENDERED_VIDEO_RESULTS.has(result)
    && PHOTO_SELECTION_EXPORT_RENDERED_VIDEO_FORMATS.has(videoRenderFormat || renderFormat);
}

export function photoSelectionExportIssueRows(value: PhotoSelectionExportValue | null | undefined): PhotoSelectionExportValue["items"] {
  const rows = Array.isArray(value?.items) ? value.items : [];
  return rows.filter((row) => !photoSelectionExportRowSucceeded(row.result) || Boolean(cleanText(row.contentCredentialFailure)));
}

export function photoSelectionExportSuccessRows(value: PhotoSelectionExportValue | null | undefined): PhotoSelectionExportValue["items"] {
  const rows = Array.isArray(value?.items) ? value.items : [];
  return rows.filter((row) => photoSelectionExportRowSucceeded(row.result) && !cleanText(row.contentCredentialFailure));
}

export function photoSelectionExportTargetPaths(value: PhotoSelectionExportValue | null | undefined): string[] {
  const rows = Array.isArray(value?.items) ? value.items : [];
  return uniqueCleanPaths(rows.map((row) => row.targetPath));
}

export function photoSelectionExportMetricCounts(
  value: PhotoSelectionExportValue | null | undefined,
  issueCount = 0,
): PhotoSelectionExportMetricCounts {
  const counts: Partial<PhotoSelectionExportValue["counts"]> = value?.counts || {};
  return {
    written: (Number(counts.copied) || 0) + (Number(counts.moved) || 0),
    rendered: Number(counts.rendered) || 0,
    sidecars: (Number(counts.metadata) || 0) + (Number(counts.xmp) || 0) + (Number(counts.existingSidecars) || 0),
    skipped: Number(counts.skipped) || 0,
    needsAttention: Math.max(0, Math.round(Number(issueCount) || 0)),
    credentialsSigned: Number(counts.contentCredentialsSigned) || 0,
    credentialsPreserved: Number(counts.contentCredentialsPreserved) || 0,
    credentialsFailed: Number(counts.contentCredentialsFailed) || 0,
  };
}

export function photoSelectionExportRowSummary(
  row: PhotoSelectionExportRow,
  formatters: Pick<PhotoSelectionExportRowDetailFormatters, "uiText" | "fileName" | "shortText"> = {},
): PhotoSelectionExportRowSummary {
  const sourcePath = cleanPath(row.sourcePath);
  const targetPath = cleanPath(row.targetPath);
  return {
    sourceLabel: sourcePath ? pathValue(formatters, sourcePath) : "",
    sourceTitle: sourcePath,
    resultLabel: cleanText(row.result) || labelText(formatters, "Unknown result"),
    targetLabel: targetPath ? (formatters.shortText?.(targetPath) || defaultShortText(targetPath)) : labelText(formatters, "No output file"),
    targetTitle: targetPath || undefined,
    hasTarget: Boolean(targetPath),
  };
}

export function photoSelectionExportPanelState(
  value: PhotoSelectionExportValue | null | undefined,
  visibleLimit = 6,
): PhotoSelectionExportPanelState {
  const limit = Math.max(0, Math.round(Number(visibleLimit) || 0));
  const issueRows = photoSelectionExportIssueRows(value);
  const successRows = photoSelectionExportSuccessRows(value);
  return {
    issueRows,
    successRows,
    visibleIssueRows: issueRows.slice(0, limit),
    visibleSuccessRows: successRows.slice(0, limit),
    issueOverflowCount: Math.max(0, issueRows.length - limit),
    successOverflowCount: Math.max(0, successRows.length - limit),
    metrics: photoSelectionExportMetricCounts(value, issueRows.length),
    statusClass: issueRows.length ? "warning" : "ok",
    role: issueRows.length ? "alert" : "status",
  };
}

export function photoSelectionShareDraft(
  selectedSourcePaths: readonly unknown[],
  stripLocationExportValue: PhotoSelectionExportValue | null | undefined = null,
): PhotoSelectionShareDraft {
  const selectedPaths = uniqueCleanPaths(selectedSourcePaths);
  if (!stripLocationExportValue) {
    return {
      sourcePathsForEvent: selectedPaths,
      pathsForShare: selectedPaths,
      strippedLocation: false,
      skippedCount: 0,
      shareAction: "native_share",
      fallbackAction: "share_fallback_reveal",
    };
  }
  const rows = Array.isArray(stripLocationExportValue.items) ? stripLocationExportValue.items : [];
  const shareableRows = rows.filter(photoSelectionExportRowIsStripLocationShareable);
  const sourcePathsForEvent = uniqueCleanPaths(shareableRows.map((row) => row.sourcePath));
  return {
    sourcePathsForEvent,
    pathsForShare: uniqueCleanPaths(shareableRows.map((row) => row.targetPath)),
    strippedLocation: true,
    skippedCount: Math.max(0, selectedPaths.length - sourcePathsForEvent.length),
    shareAction: "native_share_strip_location",
    fallbackAction: "share_fallback_reveal_strip_location",
  };
}

export function photoSelectionShareEventMetadata(
  draft: PhotoSelectionShareDraft,
  result: { shared?: unknown } | null | undefined,
  surface: unknown = "photos-bulk-bar",
): PhotoSelectionShareEventMetadata {
  return {
    surface: cleanText(surface) || "photos-bulk-bar",
    action: result?.shared ? draft.shareAction : draft.fallbackAction,
    strippedLocation: draft.strippedLocation,
    targetCount: draft.pathsForShare.length,
    skippedCount: draft.skippedCount,
  };
}

export function photoSelectionExportRowDetailItems(
  row: PhotoSelectionExportRow,
  formatters: PhotoSelectionExportRowDetailFormatters = {},
): PhotoSelectionExportRowDetailItem[] {
  const sourcePath = cleanPath(row.sourcePath);
  const targetPath = cleanPath(row.targetPath);
  const metadataPath = cleanPath(row.metadataPath);
  const xmpPath = cleanPath(row.xmpPath);
  const rawRenderProxyPath = cleanPath(row.rawRenderProxyPath);
  const targetColorProfilePath = cleanPath(row.targetColorProfilePath);
  const videoTrimStartMs = numberFromUnknown(row.videoTrimStartMs) || 0;
  const videoTrimEndMs = numberFromUnknown(row.videoTrimEndMs) || 0;
  const videoRotateDegrees = numberFromUnknown(row.videoRotateDegrees) || 0;
  const videoCropAspect = cleanText(row.videoCropAspect);
  const videoEditSummary = cleanText(row.videoEditSummary);
  const videoEditTimeline = cleanText(row.videoEditTimeline);
  const videoEditTransform = cleanText(row.videoEditTransform);
  const videoEditRender = cleanText(row.videoEditRender);
  const credentialStatus = cleanText(row.contentCredentialStatus);
  const credentialFailure = cleanText(row.contentCredentialFailure);
  const credentials = row.contentCredentials && typeof row.contentCredentials === "object"
    ? row.contentCredentials
    : null;
  const credentialTrust = credentials?.globallyTrusted
    ? labelText(formatters, "Global C2PA trust")
    : credentials?.locallyTrusted
      ? labelText(formatters, "Workspace-local trust")
      : credentials?.cryptographicallyValid
        ? labelText(formatters, "Valid signature, signer untrusted")
        : "";
  const videoTrimLabel =
    videoTrimStartMs > 0 || videoTrimEndMs > 0
      ? `${durationValue(formatters, videoTrimStartMs) || "0s"}-${durationValue(formatters, videoTrimEndMs) || labelText(formatters, "End")}`
      : "";
  const existingSidecarPaths = Array.isArray(row.existingSidecarPaths)
    ? row.existingSidecarPaths.map(cleanPath).filter(Boolean)
    : [];
  return [
    { label: labelText(formatters, "Result"), value: String(row.result || labelText(formatters, "Unknown result")) },
    sourcePath ? { label: labelText(formatters, "Source"), value: pathValue(formatters, sourcePath), title: sourcePath } : null,
    targetPath
      ? { label: labelText(formatters, "Target"), value: pathValue(formatters, targetPath), title: targetPath }
      : { label: labelText(formatters, "Target"), value: labelText(formatters, "No target was written.") },
    metadataPath ? { label: labelText(formatters, "Metadata"), value: pathValue(formatters, metadataPath), title: metadataPath } : null,
    xmpPath ? { label: labelText(formatters, "XMP"), value: pathValue(formatters, xmpPath), title: xmpPath } : null,
    existingSidecarPaths.length ? { label: labelText(formatters, "Existing sidecars"), value: countValue(formatters, existingSidecarPaths.length), title: existingSidecarPaths.join("\n") } : null,
    row.exportVariant ? { label: labelText(formatters, "Variant"), value: String(row.exportVariant) } : null,
    row.renderFormat ? { label: labelText(formatters, "Render format"), value: String(row.renderFormat) } : null,
    row.videoRenderQuality ? { label: labelText(formatters, "Video quality"), value: String(row.videoRenderQuality) } : null,
    videoEditSummary ? { label: labelText(formatters, "Video edit"), value: videoEditSummary } : null,
    videoEditTimeline ? { label: labelText(formatters, "Video timeline"), value: videoEditTimeline } : null,
    videoTrimLabel ? { label: labelText(formatters, "Video trim"), value: videoTrimLabel } : null,
    videoEditTransform ? { label: labelText(formatters, "Video edit transform"), value: videoEditTransform } : null,
    videoRotateDegrees ? { label: labelText(formatters, "Video rotation"), value: `${videoRotateDegrees}` } : null,
    videoCropAspect && videoCropAspect !== "none" ? { label: labelText(formatters, "Video crop"), value: videoCropAspect } : null,
    videoEditRender ? { label: labelText(formatters, "Video edit render"), value: videoEditRender } : null,
    row.videoTransformApplied ? { label: labelText(formatters, "Video transform"), value: labelText(formatters, "Applied") } : null,
    row.targetColorProfile ? { label: labelText(formatters, "Color profile"), value: String(row.targetColorProfile) } : null,
    targetColorProfilePath ? { label: labelText(formatters, "Profile file"), value: pathValue(formatters, targetColorProfilePath), title: targetColorProfilePath } : null,
    row.editStackId ? { label: labelText(formatters, "Edit stack"), value: String(row.editStackId) } : null,
    rawRenderProxyPath ? { label: labelText(formatters, "RAW proxy"), value: pathValue(formatters, rawRenderProxyPath), title: rawRenderProxyPath } : null,
    credentialStatus ? { label: labelText(formatters, "Content Credentials"), value: contentCredentialStatusLabel(formatters, credentialStatus) } : null,
    credentialTrust ? { label: labelText(formatters, "Credential trust"), value: credentialTrust } : null,
    credentials?.containsAiHistory ? { label: labelText(formatters, "AI history"), value: labelText(formatters, credentials.topLevelAiEdit ? "AI edit in this manifest" : "AI edit in ingredient history") } : null,
    credentialFailure ? { label: labelText(formatters, "Credential failure"), value: credentialFailure, title: credentialFailure } : null,
  ].filter((item): item is PhotoSelectionExportRowDetailItem => Boolean(item));
}

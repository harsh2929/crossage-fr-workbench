import type { PhotoMediaPair } from "../types";

export type PhotoMediaPairHistoryItem = {
  action: string;
  label: string;
  detail: string;
  at: string;
};

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanPath(value: unknown): string {
  return String(value ?? "").trim();
}

function cleanRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

export function photoMediaPairKindLabel(kind: unknown): string {
  const key = cleanText(kind).toLowerCase();
  if (key === "live_photo") return "Live Photo motion";
  if (key === "raw_sidecar") return "RAW sidecar";
  if (key === "video_still") return "Video still";
  if (key === "metadata_sidecar") return "Metadata sidecar";
  if (key === "edit_sidecar") return "Edit sidecar";
  if (key === "burst") return "Burst stack";
  if (!key) return "Related media";
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function photoMediaPairFilename(pair: PhotoMediaPair | null | undefined): string {
  const source = cleanPath(pair?.relatedSourcePath) || cleanPath(pair?.sourcePath);
  if (!source) return "";
  const parts = source.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || source;
}

export function photoMediaPairStatusLabel(pair: PhotoMediaPair | null | undefined): string {
  if (!pair) return "Unknown";
  if (pair.relatedExists === true) return "Available";
  if (pair.relatedExists === false) return "Missing";
  return "Unknown";
}

export function photoMediaPairStatusKind(pair: PhotoMediaPair | null | undefined): "available" | "missing" | "unknown" {
  if (pair?.relatedExists === true) return "available";
  if (pair?.relatedExists === false) return "missing";
  return "unknown";
}

export function photoMediaPairProducer(pair: PhotoMediaPair | null | undefined): string {
  return cleanText(cleanRecord(pair?.metadata).producer);
}

export function photoMediaPairCanRemove(pair: PhotoMediaPair | null | undefined): boolean {
  const producer = photoMediaPairProducer(pair);
  return producer === "user_authored_pair" || producer === "user_relinked_pair";
}

export function photoMediaPairCanIgnoreGenerated(pair: PhotoMediaPair | null | undefined): boolean {
  return photoMediaPairProducer(pair) === "adjacent_non_live_pair";
}

export function photoMediaPairHistory(pair: PhotoMediaPair | null | undefined): PhotoMediaPairHistoryItem[] {
  const metadata = cleanRecord(pair?.metadata);
  const items: PhotoMediaPairHistoryItem[] = [];
  const authored = Array.isArray(metadata.authoringHistory) ? metadata.authoringHistory : [];
  authored.forEach((entry) => {
    const record = cleanRecord(entry);
    const action = cleanText(record.action) || "updated";
    const related = cleanPath(record.relatedSourcePath);
    const kind = cleanText(record.pairKind);
    items.push({
      action,
      label: action === "created" ? "Added" : "Updated",
      detail: [kind ? photoMediaPairKindLabel(kind) : "", related ? related.split(/[\\/]+/).filter(Boolean).pop() || related : ""].filter(Boolean).join(" · "),
      at: cleanText(record.at),
    });
  });
  const relinked = Array.isArray(metadata.relinkHistory) ? metadata.relinkHistory : [];
  relinked.forEach((entry) => {
    const record = cleanRecord(entry);
    const from = cleanPath(record.from);
    const to = cleanPath(record.to);
    const fromName = from.split(/[\\/]+/).filter(Boolean).pop() || from;
    const toName = to.split(/[\\/]+/).filter(Boolean).pop() || to;
    items.push({
      action: "relinked",
      label: "Relinked",
      detail: [fromName, toName].filter(Boolean).join(" -> "),
      at: cleanText(record.at),
    });
  });
  return items
    .filter((item) => item.label || item.detail || item.at)
    .sort((a, b) => cleanText(b.at).localeCompare(cleanText(a.at)));
}

export function normalizePhotoMediaPairList(value: unknown): PhotoMediaPair[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = cleanRecord(item);
    const pairKind = cleanText(record.pairKind || record.pair_kind);
    const relatedSourcePath = cleanPath(record.relatedSourcePath || record.related_source_path);
    const sourcePath = cleanPath(record.sourcePath || record.source_path);
    if (!pairKind && !relatedSourcePath && !sourcePath) return null;
    return {
      pairId: cleanText(record.pairId || record.pair_id),
      assetId: cleanText(record.assetId || record.asset_id),
      relatedAssetId: cleanText(record.relatedAssetId || record.related_asset_id),
      pairKind,
      sourcePath,
      relatedSourcePath,
      metadata: cleanRecord(record.metadata),
      sourceExists: cleanBool(record.sourceExists ?? record.source_exists),
      relatedExists: cleanBool(record.relatedExists ?? record.related_exists),
      createdAt: cleanText(record.createdAt || record.created_at),
      updatedAt: cleanText(record.updatedAt || record.updated_at),
    };
  }).filter(Boolean) as PhotoMediaPair[];
}

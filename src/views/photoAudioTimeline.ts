export type PhotoAudioTimelineSegment = {
  segmentId: string;
  segmentKind: "speech" | "sound";
  startMs: number;
  endMs: number;
  timestampMs: number;
  text: string;
  label: string;
  confidence?: number;
  language?: string;
};

function finiteTimelineMs(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function normalizePhotoAudioTimelineSegments(value: unknown): PhotoAudioTimelineSegment[] {
  if (!Array.isArray(value)) return [];
  const rows: PhotoAudioTimelineSegment[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const segmentKind = record.segmentKind === "speech" ? "speech" : record.segmentKind === "sound" ? "sound" : "";
    const text = String(record.text || "").replace(/\s+/g, " ").trim();
    const label = String(record.label || "").replace(/\s+/g, " ").trim();
    if (!segmentKind || (segmentKind === "speech" ? !text : !label && !text)) continue;
    const startMs = finiteTimelineMs(record.startMs ?? record.timestampMs);
    const endMs = Math.max(startMs + 1, finiteTimelineMs(record.endMs));
    const confidence = Number(record.confidence);
    rows.push({
      segmentId: String(record.segmentId || `${segmentKind}-${startMs}-${index}`),
      segmentKind,
      startMs,
      endMs,
      timestampMs: finiteTimelineMs(record.timestampMs ?? startMs),
      text,
      label,
      ...(Number.isFinite(confidence) ? { confidence: Math.max(0, Math.min(1, confidence)) } : {}),
      ...(record.language ? { language: String(record.language).slice(0, 16) } : {}),
    });
  }
  return rows.sort((left, right) => left.startMs - right.startMs || left.segmentKind.localeCompare(right.segmentKind) || left.segmentId.localeCompare(right.segmentId));
}

export function photoVideoCaptionText(segments: PhotoAudioTimelineSegment[], currentMs: number): string {
  const active = segments.filter((segment) => currentMs >= segment.startMs && currentMs < segment.endMs);
  const values = active.map((segment) => (
    segment.segmentKind === "speech" ? segment.text : `[${segment.label || segment.text}]`
  )).filter(Boolean);
  return [...new Set(values)].join(" ");
}

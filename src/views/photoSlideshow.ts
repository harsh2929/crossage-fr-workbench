import { cleanPhotoSlideshowTimelineItems, type PhotoSlideshowProjectTimelineItem } from "./photoSlideshowProjects";

export interface PhotoSlideshowItemLike {
  sourcePath: string;
  title?: string;
  previewUrl?: string;
  sourceUrl?: string;
  previewPath?: string | null;
  mediaKind?: string;
  missingAt?: string;
}

export interface PhotoSlideshowQueue<T extends PhotoSlideshowItemLike> {
  items: T[];
  source: "selection" | "view";
  startIndex: number;
}

export type PhotoSlideshowAudioHandle = {
  context: AudioContext;
  oscillator: OscillatorNode;
  gain: GainNode;
};

export type PhotoSlideshowChapter = {
  id: string;
  label: string;
  sourcePath: string;
  startIndex: number;
  endIndex: number;
  startMs: number;
  durationMs: number;
};

export function isPhotoSlideshowEligible(item: PhotoSlideshowItemLike | null | undefined): boolean {
  if (!item || !String(item.sourcePath || "").trim()) return false;
  if (String(item.missingAt || "").trim()) return false;
  return Boolean(String(item.previewUrl || item.sourceUrl || item.previewPath || item.sourcePath || "").trim());
}

export function buildPhotoSlideshowQueue<T extends PhotoSlideshowItemLike>(
  items: T[],
  selectedSources: Iterable<string> = [],
  preferredSourcePath = "",
): PhotoSlideshowQueue<T> {
  const selected = new Set([...selectedSources].map((source) => String(source || "")).filter(Boolean));
  const source = selected.size ? "selection" : "view";
  const candidates = source === "selection" ? items.filter((item) => selected.has(item.sourcePath)) : items;
  const queueItems = candidates.filter(isPhotoSlideshowEligible);
  const preferred = String(preferredSourcePath || "").trim();
  const startIndex = Math.max(0, queueItems.findIndex((item) => item.sourcePath === preferred));
  return {
    items: queueItems,
    source,
    startIndex: startIndex < queueItems.length ? startIndex : 0,
  };
}

export function buildPhotoSlideshowChapters<T extends PhotoSlideshowItemLike>(
  queueItems: T[],
  timelineItems: PhotoSlideshowProjectTimelineItem[],
  intervalMs: number,
  labelForItem: (item: T, index: number) => string = (item, index) => String(item.title || item.sourcePath || `Photo ${index + 1}`),
): PhotoSlideshowChapter[] {
  const sourcePaths = queueItems.map((item) => item.sourcePath);
  const timelineBySource = new Map(
    cleanPhotoSlideshowTimelineItems(timelineItems, sourcePaths, intervalMs)
      .map((item) => [item.sourcePath, item.durationMs] as const),
  );
  let cursorMs = 0;
  return queueItems.map((item, index) => {
    const durationMs = Math.max(500, Math.min(60000, timelineBySource.get(item.sourcePath) || intervalMs || 4500));
    const chapter = {
      id: item.sourcePath || `chapter-${index + 1}`,
      label: labelForItem(item, index),
      sourcePath: item.sourcePath,
      startIndex: index,
      endIndex: index,
      startMs: cursorMs,
      durationMs,
    };
    cursorMs += durationMs;
    return chapter;
  });
}

export function nextPhotoSlideshowIndex(currentIndex: number, length: number, direction: "next" | "previous"): number {
  const count = Math.max(0, Math.floor(length || 0));
  if (count <= 1) return 0;
  const index = Math.max(0, Math.min(count - 1, Math.floor(currentIndex || 0)));
  return direction === "next" ? (index + 1) % count : (index - 1 + count) % count;
}

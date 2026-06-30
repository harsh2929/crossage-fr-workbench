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

export function nextPhotoSlideshowIndex(currentIndex: number, length: number, direction: "next" | "previous"): number {
  const count = Math.max(0, Math.floor(length || 0));
  if (count <= 1) return 0;
  const index = Math.max(0, Math.min(count - 1, Math.floor(currentIndex || 0)));
  return direction === "next" ? (index + 1) % count : (index - 1 + count) % count;
}

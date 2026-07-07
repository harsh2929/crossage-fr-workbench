export type PhotoAlbumMoveDirection = "first" | "earlier" | "later" | "last";
export type PhotoAlbumDropPlacement = "before" | "after";

export type PhotoAlbumReorderResult = {
  updated?: number;
  requested?: number;
  missing?: number;
  duplicates?: number;
  appended?: number;
};

export function canSavePhotoSortAsAlbumOrder(
  sort: string,
  isManualAlbum: boolean,
  isWholeAlbumScope: boolean,
  total: number,
): boolean {
  return Boolean(isManualAlbum && sort !== "manual" && isWholeAlbumScope && Number(total) > 1);
}

export function reorderSelectedPhotoSources(
  sourcePaths: string[],
  selectedSources: Iterable<string>,
  direction: PhotoAlbumMoveDirection,
): string[] {
  const selected = new Set(selectedSources);
  const ordered = sourcePaths.filter((sourcePath) => sourcePath && selected.has(sourcePath));
  if (!ordered.length) return [...sourcePaths];
  const selectedInAlbum = new Set(ordered);

  if (direction === "first") {
    return [
      ...sourcePaths.filter((sourcePath) => selectedInAlbum.has(sourcePath)),
      ...sourcePaths.filter((sourcePath) => !selectedInAlbum.has(sourcePath)),
    ];
  }
  if (direction === "last") {
    return [
      ...sourcePaths.filter((sourcePath) => !selectedInAlbum.has(sourcePath)),
      ...sourcePaths.filter((sourcePath) => selectedInAlbum.has(sourcePath)),
    ];
  }

  const next = [...sourcePaths];
  if (direction === "earlier") {
    for (let index = 1; index < next.length; index += 1) {
      if (selectedInAlbum.has(next[index]) && !selectedInAlbum.has(next[index - 1])) {
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
      }
    }
  } else {
    for (let index = next.length - 2; index >= 0; index -= 1) {
      if (selectedInAlbum.has(next[index]) && !selectedInAlbum.has(next[index + 1])) {
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
      }
    }
  }
  return next;
}

export function reorderSelectedPhotoSourcesToPosition(
  sourcePaths: string[],
  selectedSources: Iterable<string>,
  position: number,
): string[] {
  const current = sourcePaths.filter(Boolean);
  const selected = new Set([...selectedSources].map((sourcePath) => String(sourcePath || "")).filter(Boolean));
  const movingSources = current.filter((sourcePath) => selected.has(sourcePath));
  if (!movingSources.length) return [...sourcePaths];
  const movingSourceSet = new Set(movingSources);
  const remainingSources = current.filter((sourcePath) => !movingSourceSet.has(sourcePath));
  const targetIndex = Math.max(0, Math.min(remainingSources.length, Math.round(Number(position || 0)) - 1));
  return [
    ...remainingSources.slice(0, targetIndex),
    ...movingSources,
    ...remainingSources.slice(targetIndex),
  ];
}

export function reorderPhotoSourcesByDrag(
  sourcePaths: string[],
  draggedSource: string,
  targetSource: string,
  placement: PhotoAlbumDropPlacement,
  selectedSources: Iterable<string> = [],
): string[] {
  const dragged = String(draggedSource || "");
  const target = String(targetSource || "");
  if (!dragged || !target || dragged === target) return [...sourcePaths];
  const current = sourcePaths.filter(Boolean);
  const draggedIndex = current.indexOf(dragged);
  const targetIndex = current.indexOf(target);
  if (draggedIndex < 0 || targetIndex < 0) return [...sourcePaths];
  const selected = new Set([...selectedSources].map((sourcePath) => String(sourcePath || "")).filter(Boolean));
  const movingSources = selected.has(dragged)
    ? current.filter((sourcePath) => selected.has(sourcePath))
    : [dragged];
  const movingSourceSet = new Set(movingSources);
  if (!movingSources.length || movingSourceSet.has(target)) return [...sourcePaths];
  const next = current.filter((sourcePath) => !movingSourceSet.has(sourcePath));
  const nextTargetIndex = next.indexOf(target);
  if (nextTargetIndex < 0) return [...sourcePaths];
  const insertIndex = placement === "before" ? nextTargetIndex : nextTargetIndex + 1;
  next.splice(insertIndex, 0, ...movingSources);
  return next;
}

function reorderCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function photoAlbumReorderNotice(result: PhotoAlbumReorderResult | null | undefined): string {
  if (!result || typeof result !== "object") return "";
  const updated = reorderCount(result.updated);
  const requested = reorderCount(result.requested);
  const missing = reorderCount(result.missing);
  const duplicates = reorderCount(result.duplicates);
  const appended = reorderCount(result.appended);
  const parts: string[] = [];
  if (updated === 0 && requested > 0) {
    parts.push("No album order changed.");
  }
  if (missing > 0) {
    parts.push(`${pluralize(missing, "requested item was", "requested items were")} no longer in this album.`);
  }
  if (duplicates > 0) {
    parts.push(`${pluralize(duplicates, "duplicate request was", "duplicate requests were")} ignored.`);
  }
  if (appended > 0) {
    parts.push(`${pluralize(appended, "existing album item was", "existing album items were")} appended to keep the album complete.`);
  }
  return parts.join(" ");
}

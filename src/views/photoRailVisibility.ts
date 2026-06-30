export interface PhotoRailFolderLike {
  id: string;
  name?: string;
  kind?: string;
  albumId?: string;
  albumKind?: string;
  folderId?: string;
  parentFolderId?: string;
  position?: number;
  folderPosition?: number;
}

export interface PhotoRailVisibilityOptions {
  showUtilities: boolean;
  showSensitive: boolean;
  showScreenshots?: boolean;
  showShared?: boolean;
  showLowValueUtilities?: boolean;
  activeId?: string;
}

const SENSITIVE_PHOTO_FOLDER_IDS = new Set(["hidden", "recentlyDeleted", "utility:sensitive"]);
const SENSITIVE_PHOTO_VISIBILITY_FILTERS = new Set(["hidden", "deleted"]);
const SCREENSHOT_PHOTO_FOLDER_IDS = new Set(["media:screenshot", "media:screen_recording"]);
const SHARED_PHOTO_FOLDER_IDS = new Set(["recentlyShared"]);
const LOW_VALUE_UTILITY_PHOTO_FOLDER_IDS = new Set(["imports", "lastImport", "recentlyImported", "recovered"]);

export function isSensitivePhotoFolder(folder: PhotoRailFolderLike): boolean {
  return SENSITIVE_PHOTO_FOLDER_IDS.has(folder.id);
}

export function isSensitivePhotoScope(folderId: string, visibilityFilter = ""): boolean {
  return SENSITIVE_PHOTO_FOLDER_IDS.has(folderId) || SENSITIVE_PHOTO_VISIBILITY_FILTERS.has(visibilityFilter);
}

export function isUtilityPhotoFolder(folder: PhotoRailFolderLike): boolean {
  return folder.kind === "utility" && folder.id !== "memories";
}

export function shouldShowPhotoRailFolder(folder: PhotoRailFolderLike, options: PhotoRailVisibilityOptions): boolean {
  if (folder.id === options.activeId) return true;
  if (isSensitivePhotoFolder(folder)) return options.showSensitive;
  if (SCREENSHOT_PHOTO_FOLDER_IDS.has(folder.id)) return options.showScreenshots !== false;
  if (isUtilityPhotoFolder(folder) && !options.showUtilities) return false;
  if (SHARED_PHOTO_FOLDER_IDS.has(folder.id)) return options.showShared !== false;
  if (LOW_VALUE_UTILITY_PHOTO_FOLDER_IDS.has(folder.id)) return options.showLowValueUtilities !== false;
  if (isUtilityPhotoFolder(folder)) return options.showUtilities;
  return true;
}

export function filterPhotoRailFolders<T extends PhotoRailFolderLike>(folders: T[], options: PhotoRailVisibilityOptions): T[] {
  return folders.filter((folder) => shouldShowPhotoRailFolder(folder, options));
}

export type PhotoRailSectionId =
  | "pinned"
  | "library"
  | "sources"
  | "people"
  | "albums"
  | "smartAlbums"
  | "places"
  | "memories"
  | "mediaTypes"
  | "utilities";

export interface PhotoRailSection<T extends PhotoRailFolderLike> {
  id: PhotoRailSectionId;
  folders: T[];
}

export type PhotoRailItemOrder = Partial<Record<PhotoRailSectionId, string[]>>;

const PHOTO_RAIL_SECTION_ORDER: PhotoRailSectionId[] = [
  "library",
  "sources",
  "people",
  "albums",
  "smartAlbums",
  "places",
  "memories",
  "mediaTypes",
  "utilities",
];

const REORDERABLE_PHOTO_RAIL_SECTIONS = new Set<PhotoRailSectionId>(PHOTO_RAIL_SECTION_ORDER);
const REORDERABLE_PHOTO_RAIL_ITEM_SECTIONS = new Set<PhotoRailSectionId>(["mediaTypes", "utilities"]);

export function photoRailSectionIdForFolder(folder: PhotoRailFolderLike): PhotoRailSectionId {
  if (folder.id === "all") return "library";
  if (folder.kind === "source" || folder.id.startsWith("sourceFolder:")) return "sources";
  if (folder.id === "petReview") return "people";
  if (folder.kind === "person" || folder.kind === "unknown" || folder.kind === "group" || folder.kind === "pet") return "people";
  if (folder.kind === "albumFolder") return "albums";
  if (folder.kind === "album" && folder.folderId) return "albums";
  if (folder.kind === "album") return folder.albumKind === "smart" ? "smartAlbums" : "albums";
  if (folder.kind === "place" || folder.kind === "trip" || folder.id === "places" || folder.id === "trips") return "places";
  if (folder.kind === "memory" || folder.id === "memories" || folder.id.startsWith("memory:")) return "memories";
  if (folder.id.startsWith("media:")) return "mediaTypes";
  if (folder.kind === "utility") return "utilities";
  return "library";
}

function photoRailFolderSortKey(folder: PhotoRailFolderLike, originalIndex: Map<string, number>): [number, string, number] {
  const value = folder.kind === "album" ? folder.folderPosition : folder.position;
  const rawPosition = typeof value === "number" && Number.isFinite(value) ? value : 2_147_483_647;
  return [rawPosition, String(folder.name || "").toLocaleLowerCase(), originalIndex.get(folder.id) ?? 2_147_483_647];
}

function sortPhotoRailAlbumTree<T extends PhotoRailFolderLike>(folders: T[]): T[] {
  const originalIndex = new Map(folders.map((folder, index) => [folder.id, index]));
  const folderNodes = folders.filter((folder) => folder.kind === "albumFolder");
  const albums = folders.filter((folder) => folder.kind === "album");
  if (!folderNodes.length) return folders;

  const folderIds = new Set(folderNodes.map((folder) => String(folder.folderId || folder.id.replace(/^albumFolder:/, ""))).filter(Boolean));
  const childFolders = new Map<string, T[]>();
  const albumsByFolder = new Map<string, T[]>();
  const rootFolders: T[] = [];
  const rootAlbums: T[] = [];

  folderNodes.forEach((folder) => {
    const parentId = String(folder.parentFolderId || "");
    if (parentId && folderIds.has(parentId)) {
      childFolders.set(parentId, [...(childFolders.get(parentId) || []), folder]);
    } else {
      rootFolders.push(folder);
    }
  });
  albums.forEach((album) => {
    const folderId = String(album.folderId || "");
    if (folderId && folderIds.has(folderId)) {
      albumsByFolder.set(folderId, [...(albumsByFolder.get(folderId) || []), album]);
    } else {
      rootAlbums.push(album);
    }
  });

  const sortRows = (rows: T[]) => rows.sort((a, b) => {
    const left = photoRailFolderSortKey(a, originalIndex);
    const right = photoRailFolderSortKey(b, originalIndex);
    return left[0] - right[0] || left[1].localeCompare(right[1]) || left[2] - right[2];
  });

  const result: T[] = [];
  const visitFolder = (folder: T) => {
    result.push(folder);
    const folderId = String(folder.folderId || folder.id.replace(/^albumFolder:/, ""));
    sortRows(childFolders.get(folderId) || []).forEach(visitFolder);
    sortRows(albumsByFolder.get(folderId) || []).forEach((album) => result.push(album));
  };

  sortRows(rootFolders).forEach(visitFolder);
  sortRows(rootAlbums).forEach((album) => result.push(album));
  folders.forEach((folder) => {
    if (folder.kind !== "album" && folder.kind !== "albumFolder" && !result.includes(folder)) {
      result.push(folder);
    }
  });
  return result;
}

export function photoRailSectionSupportsItemOrder(sectionId: PhotoRailSectionId): boolean {
  return REORDERABLE_PHOTO_RAIL_ITEM_SECTIONS.has(sectionId);
}

export function normalizePhotoRailItemOrder<T extends PhotoRailFolderLike>(
  folders: T[],
  order: Iterable<string> = [],
): string[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const value of order) {
    const id = String(value || "");
    if (!id || seen.has(id) || !folderIds.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  folders.forEach((folder) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    next.push(folder.id);
  });
  return next;
}

export function orderPhotoRailItems<T extends PhotoRailFolderLike>(
  sectionId: PhotoRailSectionId,
  folders: T[],
  itemOrder: PhotoRailItemOrder = {},
): T[] {
  if (!photoRailSectionSupportsItemOrder(sectionId) || folders.length < 2) return folders;
  const order = normalizePhotoRailItemOrder(folders, itemOrder[sectionId] || []);
  const orderIndex = new Map(order.map((id, index) => [id, index]));
  return [...folders].sort((a, b) => (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function movePhotoRailItem<T extends PhotoRailFolderLike>(
  sectionId: PhotoRailSectionId,
  folders: T[],
  order: Iterable<string>,
  folderId: string,
  direction: "up" | "down",
): string[] {
  const next = normalizePhotoRailItemOrder(folders, order);
  if (!photoRailSectionSupportsItemOrder(sectionId)) return next;
  const index = next.indexOf(folderId);
  if (index < 0) return next;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function movePhotoRailItemToPosition<T extends PhotoRailFolderLike>(
  sectionId: PhotoRailSectionId,
  folders: T[],
  order: Iterable<string>,
  draggedId: string,
  targetId: string,
  placement: "before" | "after",
): string[] {
  const next = normalizePhotoRailItemOrder(folders, order);
  if (!photoRailSectionSupportsItemOrder(sectionId) || draggedId === targetId) return next;
  const draggedIndex = next.indexOf(draggedId);
  const targetIndex = next.indexOf(targetId);
  if (draggedIndex < 0 || targetIndex < 0) return next;
  const [moved] = next.splice(draggedIndex, 1);
  const adjustedTargetIndex = next.indexOf(targetId);
  if (adjustedTargetIndex < 0) return next;
  const insertIndex = placement === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  next.splice(Math.max(0, Math.min(next.length, insertIndex)), 0, moved);
  return next;
}

export function buildPhotoRailSections<T extends PhotoRailFolderLike>(
  folders: T[],
  pinnedIds: Iterable<string>,
  sectionOrder: Iterable<string> = PHOTO_RAIL_SECTION_ORDER,
  itemOrder: PhotoRailItemOrder = {},
): PhotoRailSection<T>[] {
  const pinned = new Set(pinnedIds);
  const pinnedFolders = folders.filter((folder) => pinned.has(folder.id));
  const sectionMap = new Map<PhotoRailSectionId, T[]>();
  folders.forEach((folder) => {
    if (pinned.has(folder.id)) return;
    const sectionId = photoRailSectionIdForFolder(folder);
    const current = sectionMap.get(sectionId) || [];
    current.push(folder);
    sectionMap.set(sectionId, current);
  });
  const sections = normalizePhotoRailSectionOrder(sectionOrder)
    .map((id) => {
      const sectionFolders = sectionMap.get(id) || [];
      const sortedFolders = id === "albums" ? sortPhotoRailAlbumTree(sectionFolders) : sectionFolders;
      return { id, folders: orderPhotoRailItems(id, sortedFolders, itemOrder) };
    })
    .filter((section) => section.folders.length > 0);
  return pinnedFolders.length ? [{ id: "pinned", folders: pinnedFolders }, ...sections] : sections;
}

export function photoRailAlbumTreeDepth(folder: PhotoRailFolderLike, folders: PhotoRailFolderLike[]): number {
  if (folder.kind === "album" && !folder.folderId) return 0;
  const byFolderId = new Map(
    folders
      .filter((item) => item.kind === "albumFolder")
      .map((item) => [String(item.folderId || item.id.replace(/^albumFolder:/, "")), item])
  );
  let depth = folder.kind === "album" && folder.folderId ? 1 : 0;
  let parentId = folder.kind === "album" ? String(folder.folderId || "") : String(folder.parentFolderId || "");
  const seen = new Set<string>();
  while (parentId && byFolderId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byFolderId.get(parentId);
    if (!parent) break;
    if (folder.kind !== "album" || parentId !== folder.folderId) depth += 1;
    parentId = String(parent.parentFolderId || "");
  }
  return Math.max(0, Math.min(depth, 5));
}

export function photoRailAlbumFolderKey(folder: PhotoRailFolderLike): string {
  return String(folder.folderId || folder.id.replace(/^albumFolder:/, ""));
}

export type PhotoRailAlbumTreeItemKind = "album" | "albumFolder";
export type PhotoRailAlbumTreeDropPlacement = "before" | "after" | "inside";

export interface PhotoRailAlbumTreeDropPlan {
  valid: boolean;
  reason?: string;
  parentFolderId: string;
  dragged: { kind: PhotoRailAlbumTreeItemKind; id: string };
  items: Array<{ kind: PhotoRailAlbumTreeItemKind; id: string }>;
  insertIndex: number;
}

export function photoRailAlbumTreeItemKind(folder: PhotoRailFolderLike): PhotoRailAlbumTreeItemKind | "" {
  return folder.kind === "album" || folder.kind === "albumFolder" ? folder.kind : "";
}

export function photoRailAlbumTreeItemId(folder: PhotoRailFolderLike): string {
  if (folder.kind === "album") return String("albumId" in folder ? (folder as PhotoRailFolderLike & { albumId?: string }).albumId || "" : "").trim() || folder.id.replace(/^album:/, "");
  if (folder.kind === "albumFolder") return String(folder.folderId || "").trim() || folder.id.replace(/^albumFolder:/, "");
  return "";
}

export function photoRailAlbumTreeParentId(folder: PhotoRailFolderLike): string {
  if (folder.kind === "album") return String(folder.folderId || "");
  if (folder.kind === "albumFolder") return String(folder.parentFolderId || "");
  return "";
}

export function photoRailAlbumTreeChildren<T extends PhotoRailFolderLike>(parentFolderId: string, folders: T[]): T[] {
  const parentId = String(parentFolderId || "");
  return folders
    .filter((folder) => {
      const kind = photoRailAlbumTreeItemKind(folder);
      return Boolean(kind) && photoRailAlbumTreeParentId(folder) === parentId && Boolean(photoRailAlbumTreeItemId(folder));
    })
    .sort((a, b) => {
      const left = photoRailFolderSortKey(a, new Map());
      const right = photoRailFolderSortKey(b, new Map());
      return left[0] - right[0]
        || left[1].localeCompare(right[1])
        || photoRailAlbumTreeItemId(a).localeCompare(photoRailAlbumTreeItemId(b));
    });
}

function photoRailAlbumTreeDescendantFolderIds(folderId: string, folders: PhotoRailFolderLike[]): Set<string> {
  const children = new Map<string, string[]>();
  folders.forEach((folder) => {
    if (folder.kind !== "albumFolder") return;
    const id = photoRailAlbumTreeItemId(folder);
    const parentId = photoRailAlbumTreeParentId(folder);
    if (id) children.set(parentId, [...(children.get(parentId) || []), id]);
  });
  const descendants = new Set<string>();
  const stack = [...(children.get(folderId) || [])];
  while (stack.length) {
    const current = stack.pop() || "";
    if (!current || descendants.has(current)) continue;
    descendants.add(current);
    stack.push(...(children.get(current) || []));
  }
  return descendants;
}

export function planPhotoRailAlbumTreeDrop(
  folders: PhotoRailFolderLike[],
  draggedFolderId: string,
  targetFolderId: string,
  placement: PhotoRailAlbumTreeDropPlacement,
): PhotoRailAlbumTreeDropPlan {
  const draggedFolder = folders.find((folder) => folder.id === draggedFolderId);
  const targetFolder = folders.find((folder) => folder.id === targetFolderId);
  const draggedKind = draggedFolder ? photoRailAlbumTreeItemKind(draggedFolder) : "";
  const targetKind = targetFolder ? photoRailAlbumTreeItemKind(targetFolder) : "";
  const draggedId = draggedFolder ? photoRailAlbumTreeItemId(draggedFolder) : "";
  const targetId = targetFolder ? photoRailAlbumTreeItemId(targetFolder) : "";
  const emptyPlan = {
    valid: false,
    parentFolderId: "",
    dragged: { kind: (draggedKind || "album") as PhotoRailAlbumTreeItemKind, id: draggedId },
    items: [],
    insertIndex: -1,
  };
  if (!draggedFolder || !targetFolder || !draggedKind || !targetKind || !draggedId || !targetId) {
    return { ...emptyPlan, reason: "unknown-item" };
  }
  if (draggedFolder.id === targetFolder.id) {
    return { ...emptyPlan, reason: "same-item" };
  }
  if (placement === "inside" && targetKind !== "albumFolder") {
    return { ...emptyPlan, reason: "inside-target-not-folder" };
  }

  const parentFolderId = placement === "inside" ? targetId : photoRailAlbumTreeParentId(targetFolder);
  if (draggedKind === "albumFolder") {
    if (parentFolderId === draggedId) return { ...emptyPlan, parentFolderId, reason: "cycle" };
    if (photoRailAlbumTreeDescendantFolderIds(draggedId, folders).has(parentFolderId)) {
      return { ...emptyPlan, parentFolderId, reason: "cycle" };
    }
  }

  const siblings = photoRailAlbumTreeChildren(parentFolderId, folders)
    .filter((folder) => folder.id !== draggedFolder.id);
  let insertIndex = siblings.length;
  if (placement !== "inside") {
    const targetIndex = siblings.findIndex((folder) => folder.id === targetFolder.id);
    if (targetIndex < 0) return { ...emptyPlan, parentFolderId, reason: "target-not-sibling" };
    insertIndex = placement === "before" ? targetIndex : targetIndex + 1;
  }
  const next = [...siblings];
  next.splice(insertIndex, 0, draggedFolder);
  return {
    valid: true,
    parentFolderId,
    dragged: { kind: draggedKind, id: draggedId },
    items: next.map((folder) => ({
      kind: photoRailAlbumTreeItemKind(folder) as PhotoRailAlbumTreeItemKind,
      id: photoRailAlbumTreeItemId(folder),
    })),
    insertIndex,
  };
}

export function normalizePhotoRailSectionOrder(order: Iterable<string>): PhotoRailSectionId[] {
  const seen = new Set<PhotoRailSectionId>();
  const next: PhotoRailSectionId[] = [];
  for (const value of order) {
    const id = value as PhotoRailSectionId;
    if (!REORDERABLE_PHOTO_RAIL_SECTIONS.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  PHOTO_RAIL_SECTION_ORDER.forEach((id) => {
    if (!seen.has(id)) next.push(id);
  });
  return next;
}

function normalizeVisiblePhotoRailSectionOrder(order: Iterable<string>, fullOrder: PhotoRailSectionId[]): PhotoRailSectionId[] {
  const allowed = new Set(fullOrder);
  const seen = new Set<PhotoRailSectionId>();
  const next: PhotoRailSectionId[] = [];
  for (const value of order) {
    const id = value as PhotoRailSectionId;
    if (!REORDERABLE_PHOTO_RAIL_SECTIONS.has(id) || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function movePhotoRailSection(
  order: Iterable<string>,
  sectionId: PhotoRailSectionId,
  direction: "up" | "down",
): PhotoRailSectionId[] {
  const next = normalizePhotoRailSectionOrder(order);
  const index = next.indexOf(sectionId);
  if (index < 0) return next;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveVisiblePhotoRailSection(
  order: Iterable<string>,
  visibleOrder: Iterable<string>,
  sectionId: PhotoRailSectionId,
  direction: "up" | "down",
): PhotoRailSectionId[] {
  const fullOrder = normalizePhotoRailSectionOrder(order);
  const visible = normalizeVisiblePhotoRailSectionOrder(visibleOrder, fullOrder);
  const visibleIndex = visible.indexOf(sectionId);
  if (visibleIndex < 0) return fullOrder;
  const targetIndex = direction === "up" ? visibleIndex - 1 : visibleIndex + 1;
  if (targetIndex < 0 || targetIndex >= visible.length) return fullOrder;
  const targetSectionId = visible[targetIndex];
  const next = [...fullOrder];
  const fromIndex = next.indexOf(sectionId);
  const toIndex = next.indexOf(targetSectionId);
  if (fromIndex < 0 || toIndex < 0) return fullOrder;
  next.splice(fromIndex, 1);
  const adjustedToIndex = next.indexOf(targetSectionId);
  next.splice(direction === "up" ? adjustedToIndex : adjustedToIndex + 1, 0, sectionId);
  return next;
}

export function moveVisiblePhotoRailSectionToPosition(
  order: Iterable<string>,
  visibleOrder: Iterable<string>,
  draggedId: PhotoRailSectionId,
  targetId: PhotoRailSectionId,
  placement: "before" | "after",
): PhotoRailSectionId[] {
  const fullOrder = normalizePhotoRailSectionOrder(order);
  const visible = normalizeVisiblePhotoRailSectionOrder(visibleOrder, fullOrder);
  if (draggedId === targetId || !visible.includes(draggedId) || !visible.includes(targetId)) return fullOrder;
  const next = [...fullOrder];
  const fromIndex = next.indexOf(draggedId);
  const toIndex = next.indexOf(targetId);
  if (fromIndex < 0 || toIndex < 0) return fullOrder;
  next.splice(fromIndex, 1);
  const adjustedToIndex = next.indexOf(targetId);
  if (adjustedToIndex < 0) return fullOrder;
  next.splice(placement === "before" ? adjustedToIndex : adjustedToIndex + 1, 0, draggedId);
  return next;
}

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

export type PhotoRailDisplayPreferenceKey =
  | "showUtilityCollections"
  | "showSensitiveCollections"
  | "showScreenshotCollections"
  | "showSharedCollections"
  | "showLowValueCollections";

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

export function isUtilityCoverAllowed<T extends PhotoRailFolderLike>(folder: T | null | undefined): folder is T {
  if (!folder || folder.kind !== "utility") return false;
  if (folder.id.startsWith("media:") || folder.id.startsWith("utility:")) return true;
  return [
    "favorites",
    "recentlyAdded",
    "recentlySaved",
    "recentlyEdited",
    "recentlyViewed",
    "recentlyShared",
    "duplicates",
    "places",
    "trips",
    "memories",
    "pets",
    "petReview",
  ].includes(folder.id);
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

export interface PhotoAlbumGalleryFolderCard<T extends PhotoRailFolderLike> {
  folder: T;
  folderKey: string;
  childCount: number;
}

export interface PhotoAlbumGalleryState<T extends PhotoRailFolderLike> {
  browsedFolder: T | null;
  breadcrumbFolders: T[];
  folderCards: Array<PhotoAlbumGalleryFolderCard<T>>;
  albumCards: T[];
}

export type PhotoAlbumTreeDragState = {
  draggedId: string;
  targetId?: string;
  placement?: PhotoRailAlbumTreeDropPlacement;
  valid?: boolean;
};

export type PhotoRailDropPlacement = "before" | "after";

export type PhotoPeopleRailDragState = {
  draggedId: string;
  targetId?: string;
  placement?: PhotoRailDropPlacement;
  kind: "person" | "group";
  valid?: boolean;
};

export type PhotoLocalRailItemDragState = {
  draggedId: string;
  sectionId: PhotoRailSectionId;
  targetId?: string;
  placement?: PhotoRailDropPlacement;
  valid?: boolean;
};

export type PhotoRailSectionDragState = {
  draggedId: PhotoRailSectionId;
  targetId?: PhotoRailSectionId;
  placement?: PhotoRailDropPlacement;
  valid?: boolean;
};

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

export function photoRailDropPlacementFromRatio(ratio: number): PhotoRailDropPlacement {
  return Number.isFinite(ratio) && ratio < 0.5 ? "before" : "after";
}

export function photoRailDropPlacementFromBounds(clientY: number, top: number, height: number): PhotoRailDropPlacement {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  return photoRailDropPlacementFromRatio(ratio);
}

export function photoRailSectionDragTargetState(
  current: PhotoRailSectionDragState | null | undefined,
  sectionId: PhotoRailSectionId,
  draggedId: PhotoRailSectionId | "",
  visibleOrder: Iterable<string>,
  placement: PhotoRailDropPlacement,
): PhotoRailSectionDragState | null {
  if (!draggedId || sectionId === "pinned") return null;
  const visible = new Set(visibleOrder);
  const valid = draggedId !== sectionId && visible.has(draggedId) && visible.has(sectionId);
  const base = current || { draggedId };
  if (current && current.targetId === sectionId && current.placement === placement && current.valid === valid) return current;
  return { ...base, targetId: sectionId, placement, valid };
}

export function photoLocalRailItemDragTargetState(
  current: PhotoLocalRailItemDragState | null | undefined,
  sectionId: PhotoRailSectionId,
  targetId: string,
  draggedId: string,
  draggedSectionId: PhotoRailSectionId,
  placement: PhotoRailDropPlacement,
): PhotoLocalRailItemDragState | null {
  if (!draggedId || !photoRailSectionSupportsItemOrder(sectionId)) return null;
  const valid = draggedSectionId === sectionId && targetId !== draggedId;
  const base = current || { draggedId, sectionId: draggedSectionId };
  if (current && current.targetId === targetId && current.placement === placement && current.valid === valid) return current;
  return { ...base, targetId, placement, valid };
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

function photoRailAlbumFolderMap(folders: PhotoRailFolderLike[]): Map<string, PhotoRailFolderLike> {
  return new Map(
    folders
      .filter((item) => item.kind === "albumFolder")
      .map((item) => [String(item.folderId || item.id.replace(/^albumFolder:/, "")), item])
  );
}

function photoRailAlbumTreeDepthFromMap(folder: PhotoRailFolderLike, byFolderId: Map<string, PhotoRailFolderLike>): number {
  if (folder.kind === "album" && !folder.folderId) return 0;
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

function photoRailAlbumTreeAncestorIdsFromMap(folder: PhotoRailFolderLike, byFolderId: Map<string, PhotoRailFolderLike>): string[] {
  const kind = photoRailAlbumTreeItemKind(folder);
  if (!kind) return [];
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let parentId = photoRailAlbumTreeParentId(folder);
  while (parentId && byFolderId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    ancestors.push(parentId);
    const parent = byFolderId.get(parentId);
    if (!parent) break;
    parentId = photoRailAlbumTreeParentId(parent);
  }
  return ancestors;
}

export function buildPhotoRailAlbumTreeDepthMap(folders: PhotoRailFolderLike[]): Map<string, number> {
  const byFolderId = photoRailAlbumFolderMap(folders);
  return new Map(folders.map((folder) => [folder.id, photoRailAlbumTreeDepthFromMap(folder, byFolderId)]));
}

export function buildPhotoRailAlbumTreeAncestorIdMap(folders: PhotoRailFolderLike[]): Map<string, string[]> {
  const byFolderId = photoRailAlbumFolderMap(folders);
  return new Map(folders.map((folder) => [folder.id, photoRailAlbumTreeAncestorIdsFromMap(folder, byFolderId)]));
}

export function buildPhotoAlbumGalleryState<T extends PhotoRailFolderLike>(
  albumFolders: T[],
  albums: T[],
  browsedAlbumFolderId: string,
): PhotoAlbumGalleryState<T> {
  const browsedFolderId = String(browsedAlbumFolderId || "");
  const folderByKey = new Map<string, T>();
  albumFolders.forEach((folder) => {
    const folderKey = photoRailAlbumTreeItemId(folder);
    if (folderKey) folderByKey.set(folderKey, folder);
  });
  const childCountByFolderKey = new Map<string, number>();
  [...albumFolders, ...albums].forEach((folder) => {
    const parentId = photoRailAlbumTreeParentId(folder);
    if (!parentId) return;
    childCountByFolderKey.set(parentId, (childCountByFolderKey.get(parentId) || 0) + 1);
  });
  const browsedFolder = browsedFolderId ? folderByKey.get(browsedFolderId) || null : null;
  const breadcrumbFolders = browsedFolder
    ? photoRailAlbumTreeAncestorIdsFromMap(browsedFolder, folderByKey)
      .slice()
      .reverse()
      .map((folderId) => folderByKey.get(folderId))
      .filter((folder): folder is T => Boolean(folder))
    : [];
  return {
    browsedFolder,
    breadcrumbFolders,
    folderCards: albumFolders
      .filter((folder) => photoRailAlbumTreeParentId(folder) === browsedFolderId)
      .map((folder) => {
        const folderKey = photoRailAlbumTreeItemId(folder);
        return {
          folder,
          folderKey,
          childCount: childCountByFolderKey.get(folderKey) || 0,
        };
      }),
    albumCards: albums.filter((folder) => photoRailAlbumTreeParentId(folder) === browsedFolderId),
  };
}

export function photoRailAlbumTreeDepth(folder: PhotoRailFolderLike, folders: PhotoRailFolderLike[]): number {
  return photoRailAlbumTreeDepthFromMap(folder, photoRailAlbumFolderMap(folders));
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

export interface PhotoRailAlbumTreeReorderDraft extends Record<string, unknown> {
  parentFolderId: string;
  items: Array<{ kind: PhotoRailAlbumTreeItemKind; id: string }>;
}

export type PhotoRailAlbumTreeMoveDraft =
  | {
    kind: "albumFolder";
    payload: {
      folderId: string;
      name: string;
      parentFolderId: string;
      position: number;
    };
  }
  | {
    kind: "album";
    payload: {
      albumId: string;
      folderId: string;
      position: number;
    };
  };

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

export function photoRailAlbumTreePosition(folder: PhotoRailFolderLike): number {
  const value = folder.kind === "album" ? folder.folderPosition : folder.position;
  return typeof value === "number" && Number.isFinite(value) ? value : 2_147_483_647;
}

export function photoRailAlbumTreeDropPlacementFromRatio(
  folder: PhotoRailFolderLike,
  ratio: number,
): PhotoRailAlbumTreeDropPlacement {
  const value = Number.isFinite(ratio) ? ratio : 0.5;
  if (folder.kind === "albumFolder") {
    if (value < 0.1) return "before";
    if (value > 0.9) return "after";
    return "inside";
  }
  return photoRailDropPlacementFromRatio(value);
}

export function photoRailAlbumTreeDropPlacementFromBounds(
  folder: PhotoRailFolderLike,
  clientY: number,
  top: number,
  height: number,
): PhotoRailAlbumTreeDropPlacement {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  return photoRailAlbumTreeDropPlacementFromRatio(folder, ratio);
}

export function photoRailAlbumTreeDragTargetState(
  current: PhotoAlbumTreeDragState | null | undefined,
  folders: PhotoRailFolderLike[],
  targetFolder: PhotoRailFolderLike,
  draggedId: string,
  placement: PhotoRailAlbumTreeDropPlacement,
): PhotoAlbumTreeDragState | null {
  if (!draggedId || !photoRailAlbumTreeItemKind(targetFolder)) return null;
  const plan = planPhotoRailAlbumTreeDrop(folders, draggedId, targetFolder.id, placement);
  const base = current || { draggedId };
  if (current && current.targetId === targetFolder.id && current.placement === placement && current.valid === plan.valid) return current;
  return { ...base, targetId: targetFolder.id, placement, valid: plan.valid };
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

export function photoRailAlbumTreeSiblings<T extends PhotoRailFolderLike>(folder: T | null | undefined, folders: T[]): T[] {
  const kind = folder ? photoRailAlbumTreeItemKind(folder) : "";
  if (!folder || !kind) return [];
  return photoRailAlbumTreeChildren(photoRailAlbumTreeParentId(folder), folders);
}

export function photoRailAlbumTreeAncestorIds(folder: PhotoRailFolderLike | undefined, folders: PhotoRailFolderLike[]): string[] {
  if (!folder) return [];
  return photoRailAlbumTreeAncestorIdsFromMap(folder, photoRailAlbumFolderMap(folders));
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

export function photoRailAlbumTreeReorderDraft(
  activeFolder: PhotoRailFolderLike | null | undefined,
  siblings: PhotoRailFolderLike[],
  activeIndex: number,
  direction: "up" | "down",
): PhotoRailAlbumTreeReorderDraft | null {
  if (!activeFolder || activeIndex < 0) return null;
  const resolvedActiveIndex = siblings[activeIndex]?.id === activeFolder.id
    ? activeIndex
    : siblings.findIndex((folder) => folder.id === activeFolder.id);
  if (resolvedActiveIndex < 0) return null;
  const targetIndex = direction === "up" ? resolvedActiveIndex - 1 : resolvedActiveIndex + 1;
  if (targetIndex < 0 || targetIndex >= siblings.length) return null;
  const nextSiblings = [...siblings];
  [nextSiblings[resolvedActiveIndex], nextSiblings[targetIndex]] = [nextSiblings[targetIndex], nextSiblings[resolvedActiveIndex]];
  const items = nextSiblings.map((folder) => ({
    kind: photoRailAlbumTreeItemKind(folder),
    id: photoRailAlbumTreeItemId(folder),
  }));
  if (items.some((item) => !item.kind || !item.id)) return null;
  return {
    parentFolderId: photoRailAlbumTreeParentId(activeFolder),
    items: items as PhotoRailAlbumTreeReorderDraft["items"],
  };
}

export function photoRailAlbumTreeMoveDraft(
  draggedFolder: PhotoRailFolderLike | null | undefined,
  plan: PhotoRailAlbumTreeDropPlan | null | undefined,
): PhotoRailAlbumTreeMoveDraft | null {
  if (!draggedFolder || !plan?.valid) return null;
  const draggedKind = photoRailAlbumTreeItemKind(draggedFolder);
  const draggedId = plan.dragged.id || photoRailAlbumTreeItemId(draggedFolder);
  if (!draggedKind || !draggedId || plan.dragged.kind !== draggedKind) return null;
  if (photoRailAlbumTreeParentId(draggedFolder) === plan.parentFolderId) return null;
  const position = Number.isFinite(plan.insertIndex) && plan.insertIndex >= 0 ? Math.floor(plan.insertIndex) : 0;
  if (draggedKind === "albumFolder") {
    return {
      kind: "albumFolder",
      payload: {
        folderId: draggedId,
        name: String(draggedFolder.name || ""),
        parentFolderId: plan.parentFolderId,
        position,
      },
    };
  }
  return {
    kind: "album",
    payload: {
      albumId: draggedId,
      folderId: plan.parentFolderId,
      position,
    },
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

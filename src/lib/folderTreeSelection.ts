// Pure selection/count logic for the subfolder include/exclude picker shared by
// the Scan and Enroll folder pickers. No React, no I/O — kept separate from
// App.tsx so it can be unit-tested in plain node (see
// tests/folder_tree_selection.test.mjs).

/** One folder in the tree returned by the backend `folder_tree` command. */
export interface FolderTreeNode {
  name: string;
  path: string;
  imageCount: number; // media directly in this folder
  videoCount: number;
  totalImages: number; // aggregated over the whole subtree (incl. self)
  totalVideos: number;
  childDirCount: number;
  children: FolderTreeNode[];
  truncated: boolean;
}

/** Full response from the `folder_tree` command. */
export interface FolderTree {
  root: FolderTreeNode;
  truncated: boolean;
  entriesChecked: number;
  entryBudget: number;
  exists: boolean;
  isDirectory: boolean;
}

export type ScanMode = "scan" | "enroll";

export interface MediaCounts {
  images: number;
  videos: number;
}

function collectDescendantPaths(node: FolderTreeNode, into: Set<string>): void {
  for (const child of node.children) {
    into.add(child.path);
    collectDescendantPaths(child, into);
  }
}

/**
 * Exclude a node's whole subtree. Returns a NEW set with the node's path added
 * and any now-subsumed descendant exclusions removed (the excluded set only ever
 * holds top-most excluded branches).
 */
export function excludeNode(excluded: Set<string>, node: FolderTreeNode): Set<string> {
  const descendants = new Set<string>();
  collectDescendantPaths(node, descendants);
  const next = new Set<string>();
  for (const p of excluded) {
    if (!descendants.has(p)) next.add(p);
  }
  next.add(node.path);
  return next;
}

/** Re-include a node by removing its own exclusion. Returns a NEW set. */
export function includeNode(excluded: Set<string>, node: { path: string }): Set<string> {
  const next = new Set(excluded);
  next.delete(node.path);
  return next;
}

/** Number of top-most excluded branches (for the "N folders excluded" label). */
export function countExcludedBranches(excluded: Set<string>): number {
  return excluded.size;
}

/**
 * Live count of what a scan/enroll will actually process, computed entirely from
 * the tree the backend already returned — no extra round trip on every toggle.
 *
 * - Non-recursive: only the top-level folder's direct media.
 * - Recursive: the whole subtree minus every excluded branch's totals.
 * - Enroll mode counts images only (the enroll walk is images-only).
 */
export function computeScannedCounts(
  root: FolderTreeNode,
  excluded: Set<string>,
  recursive: boolean,
  mode: ScanMode,
): MediaCounts {
  if (!recursive) {
    return { images: root.imageCount, videos: mode === "scan" ? root.videoCount : 0 };
  }
  if (excluded.has(root.path)) {
    return { images: 0, videos: 0 };
  }
  let excludedImages = 0;
  let excludedVideos = 0;
  const visit = (node: FolderTreeNode, ancestorExcluded: boolean): void => {
    const selfExcluded = ancestorExcluded || excluded.has(node.path);
    if (selfExcluded && !ancestorExcluded) {
      // Top-most excluded branch — subtract its whole subtree and stop descending.
      excludedImages += node.totalImages;
      excludedVideos += node.totalVideos;
      return;
    }
    for (const child of node.children) visit(child, selfExcluded);
  };
  for (const child of root.children) visit(child, false);
  const images = Math.max(0, root.totalImages - excludedImages);
  const videos = mode === "scan" ? Math.max(0, root.totalVideos - excludedVideos) : 0;
  return { images, videos };
}

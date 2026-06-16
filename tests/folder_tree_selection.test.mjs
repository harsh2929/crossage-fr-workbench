// Unit tests for the pure subfolder selection/count logic used by the scan &
// enroll folder pickers. The logic lives in TypeScript (src/lib/folderTreeSelection.ts)
// and is consumed by App.tsx; there's no TS unit runner in this repo, so we
// transpile the single module on the fly with esbuild (already a Vite dependency)
// and exercise the pure functions in plain node.
//
// Run: node tests/folder_tree_selection.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "ft-sel-"));
const outFile = path.join(outDir, "folderTreeSelection.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/folderTreeSelection.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const sel = await import(pathToFileURL(outFile).href);

function node(p, name, imageCount, videoCount, children = []) {
  const totalImages = imageCount + children.reduce((a, c) => a + c.totalImages, 0);
  const totalVideos = videoCount + children.reduce((a, c) => a + c.totalVideos, 0);
  return {
    name,
    path: p,
    imageCount,
    videoCount,
    totalImages,
    totalVideos,
    childDirCount: children.length,
    children,
    truncated: false,
  };
}

// root(2 img, 1 vid direct) -> sub1(1 img -> deep(1 img)), sub2(2 img)
function buildTree() {
  const deep = node("/r/sub1/deep", "deep", 1, 0);
  const sub1 = node("/r/sub1", "sub1", 1, 0, [deep]);
  const sub2 = node("/r/sub2", "sub2", 2, 0);
  return node("/r", "r", 2, 1, [sub1, sub2]);
}

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("recursive no exclusions counts whole subtree (scan)", () => {
  const root = buildTree();
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, new Set(), true, "scan"),
    { images: 6, videos: 1 },
  );
});

run("recursive enroll counts images only (no videos)", () => {
  const root = buildTree();
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, new Set(), true, "enroll"),
    { images: 6, videos: 0 },
  );
});

run("excluding a subtree subtracts its totals", () => {
  const root = buildTree();
  const excluded = new Set(["/r/sub2"]);
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, excluded, true, "scan"),
    { images: 4, videos: 1 },
  );
});

run("excluding nested subtree subtracts nested totals", () => {
  const root = buildTree();
  const excluded = new Set(["/r/sub1"]);
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, excluded, true, "scan"),
    { images: 4, videos: 1 },
  );
});

run("non-recursive counts only top-level direct media (scan)", () => {
  const root = buildTree();
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, new Set(), false, "scan"),
    { images: 2, videos: 1 },
  );
});

run("non-recursive enroll counts top-level images only", () => {
  const root = buildTree();
  assert.deepStrictEqual(
    sel.computeScannedCounts(root, new Set(), false, "enroll"),
    { images: 2, videos: 0 },
  );
});

run("excludeNode adds path and prunes subsumed descendants", () => {
  const root = buildTree();
  const sub1 = root.children.find((c) => c.name === "sub1");
  // start with the nested 'deep' already excluded; excluding its parent subsumes it
  const next = sel.excludeNode(new Set(["/r/sub1/deep"]), sub1);
  assert.ok(next.has("/r/sub1"), "parent path present");
  assert.ok(!next.has("/r/sub1/deep"), "subsumed descendant removed");
  assert.strictEqual(next.size, 1);
});

run("includeNode removes the node's own exclusion", () => {
  const next = sel.includeNode(new Set(["/r/sub1", "/r/sub2"]), { path: "/r/sub1", children: [] });
  assert.ok(!next.has("/r/sub1"));
  assert.ok(next.has("/r/sub2"));
});

run("excludeNode/includeNode return new sets (no mutation)", () => {
  const root = buildTree();
  const original = new Set(["/r/sub2"]);
  const after = sel.excludeNode(original, root.children[0]);
  assert.ok(original.has("/r/sub2") && original.size === 1, "input set not mutated");
  assert.notStrictEqual(after, original);
});

run("countExcludedBranches reports top-most excluded count", () => {
  assert.strictEqual(sel.countExcludedBranches(new Set(["/r/sub1", "/r/sub2"])), 2);
});

console.log("\nall folder_tree selection tests passed");

// Unit tests for the save-settle timing logic (Wave 0 primitive).
// A keyed map of in-flight settles so multiple rows/controls can confirm at once
// (favorite several photos, accept a batch). Pure — the CSS gesture + useSaveSettle
// hook are covered by tsc + e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "settle-")), "saveSettle.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/saveSettle.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const mod = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("SAVE_SETTLE_MS is a positive duration", () => {
  assert.ok(typeof mod.SAVE_SETTLE_MS === "number" && mod.SAVE_SETTLE_MS > 0);
});

run("beginSettle records the key's start time immutably", () => {
  const s0 = {};
  const s1 = mod.beginSettle(s0, "photo-7", 1000);
  assert.deepStrictEqual(s1, { "photo-7": 1000 });
  assert.deepStrictEqual(s0, {}, "original state is not mutated");
});

run("re-settling a key refreshes its start time", () => {
  let s = mod.beginSettle({}, "k", 100);
  s = mod.beginSettle(s, "k", 400);
  assert.strictEqual(s.k, 400);
});

run("isSettling is true within the window, false after", () => {
  const s = mod.beginSettle({}, "k", 1000);
  assert.strictEqual(mod.isSettling(s, "k", 1000), true);
  assert.strictEqual(mod.isSettling(s, "k", 1000 + mod.SAVE_SETTLE_MS - 1), true);
  assert.strictEqual(mod.isSettling(s, "k", 1000 + mod.SAVE_SETTLE_MS), false);
  assert.strictEqual(mod.isSettling(s, "unknown", 1000), false);
});

run("pruneSettles drops expired keys, keeps active", () => {
  let s = mod.beginSettle({}, "old", 0);
  s = mod.beginSettle(s, "new", 1000);
  const pruned = mod.pruneSettles(s, 1000 + mod.SAVE_SETTLE_MS - 1);
  assert.deepStrictEqual(Object.keys(pruned).sort(), ["new"]);
});

run("activeSettleKeys lists only in-window keys", () => {
  let s = mod.beginSettle({}, "a", 0);
  s = mod.beginSettle(s, "b", 1000);
  assert.deepStrictEqual(mod.activeSettleKeys(s, 1000).sort(), ["b"]);
});

console.log("\nall save-settle tests passed");

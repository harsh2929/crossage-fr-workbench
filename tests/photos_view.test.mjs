// Unit tests for the Photos tab's pure paging logic (no React/DOM). The TS
// source is transpiled on the fly with esbuild (a Vite dependency) and run in
// plain node, mirroring tests/people_grouping.test.mjs.
//
// Run: node tests/photos_view.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-")), "photosPaging.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photosPaging.ts")],
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

run("hasMorePages: loaded < total means more", () => {
  assert.strictEqual(mod.hasMorePages({ loaded: 100, total: 250 }), true);
  assert.strictEqual(mod.hasMorePages({ loaded: 250, total: 250 }), false);
  assert.strictEqual(mod.hasMorePages({ loaded: 0, total: 0 }), false);
});

run("nextOffset advances by loaded count", () => {
  assert.strictEqual(mod.nextOffset({ loaded: 100 }), 100);
  assert.strictEqual(mod.nextOffset({ loaded: 0 }), 0);
});

console.log("all photos_view tests passed");

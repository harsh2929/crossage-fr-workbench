// Unit tests for count-roll logic (Wave P0). Decides when a changing count
// should play its bump and in which direction. Pure — the useCountRoll hook +
// CSS bump are covered by tsc + e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "count-")), "countRoll.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/countRoll.ts")],
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

run("no bump on initial mount (prev undefined)", () => {
  assert.strictEqual(mod.shouldAnimateCount(undefined, 0), false);
  assert.strictEqual(mod.shouldAnimateCount(undefined, 5), false);
});

run("no bump when unchanged (covers 0->0)", () => {
  assert.strictEqual(mod.shouldAnimateCount(0, 0), false);
  assert.strictEqual(mod.shouldAnimateCount(3, 3), false);
});

run("bump on any real change", () => {
  assert.strictEqual(mod.shouldAnimateCount(0, 1), true);
  assert.strictEqual(mod.shouldAnimateCount(3, 2), true);
});

run("direction is none on initial or no-change", () => {
  assert.strictEqual(mod.countChangeDirection(undefined, 5), "none");
  assert.strictEqual(mod.countChangeDirection(2, 2), "none");
});

run("direction reflects increase/decrease", () => {
  assert.strictEqual(mod.countChangeDirection(1, 4), "up");
  assert.strictEqual(mod.countChangeDirection(4, 1), "down");
});

console.log("\nall count-roll tests passed");

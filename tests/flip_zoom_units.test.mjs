// Unit tests for the FLIP shared-element zoom math (Wave P2 detail-open).
// Pure geometry — the useFlipZoom hook (measurement + Web Animations) is covered
// by tsc + e2e. FLIP with transform-origin at the element's top-left (0 0):
// translate the last element's top-left onto the first's, then scale down to it.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "flip-")), "flipZoom.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/flipZoom.ts")],
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

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

run("computeFlipTransform maps the last rect back onto the first (tile)", () => {
  const first = { x: 100, y: 200, width: 50, height: 40 };
  const last = { x: 300, y: 100, width: 800, height: 600 };
  const t = mod.computeFlipTransform(first, last);
  near(t.x, -200); // 100 - 300
  near(t.y, 100); //  200 - 100
  near(t.scaleX, 50 / 800);
  near(t.scaleY, 40 / 600);
});

run("identity when first === last", () => {
  const r = { x: 10, y: 20, width: 100, height: 100 };
  const t = mod.computeFlipTransform(r, { ...r });
  near(t.x, 0);
  near(t.y, 0);
  near(t.scaleX, 1);
  near(t.scaleY, 1);
});

run("guards against a zero-size last rect (no divide-by-zero)", () => {
  const t = mod.computeFlipTransform({ x: 0, y: 0, width: 50, height: 50 }, { x: 0, y: 0, width: 0, height: 0 });
  near(t.scaleX, 1);
  near(t.scaleY, 1);
});

run("isDegenerateRect flags missing/zero/negative geometry", () => {
  assert.strictEqual(mod.isDegenerateRect(null), true);
  assert.strictEqual(mod.isDegenerateRect({ x: 0, y: 0, width: 0, height: 10 }), true);
  assert.strictEqual(mod.isDegenerateRect({ x: 0, y: 0, width: 10, height: -1 }), true);
  assert.strictEqual(mod.isDegenerateRect({ x: 0, y: 0, width: 10, height: 10 }), false);
});

run("flipTransformString formats translate+scale", () => {
  const s = mod.flipTransformString({ x: -200, y: 100, scaleX: 0.0625, scaleY: 0.0625 });
  assert.strictEqual(s, "translate(-200px, 100px) scale(0.0625, 0.0625)");
});

console.log("\nall flip-zoom tests passed");

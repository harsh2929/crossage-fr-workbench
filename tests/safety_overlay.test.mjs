// Unit tests for the Safe Mode explainer overlay geometry (pure logic only).
// Projects a NudeNet/Freepik detection box (normalized [0,1], relative to the
// natural image) onto the on-screen rect of an object-fit:contain / cover <img>
// in the Photos lightbox. Mirrors the backend letterbox math in reverse so the
// overlay lines up with the image pixel-for-pixel. The React wiring is e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "safety-overlay-")), "safetyOverlay.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/safetyOverlay.ts")],
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
function rectNear(got, exp) {
  near(got.left, exp.left);
  near(got.top, exp.top);
  near(got.width, exp.width);
  near(got.height, exp.height);
}
function boxNear(got, exp) {
  // clampUnitBox does float subtraction (1 - x), so compare approximately.
  near(got.x, exp.x);
  near(got.y, exp.y);
  near(got.w, exp.w);
  near(got.h, exp.h);
}

// ---- containRenderRect: where the image content actually renders ----

run("equal aspect fills the container with no padding", () => {
  const r = mod.containRenderRect({ width: 100, height: 100 }, { width: 200, height: 200 });
  rectNear(r, { left: 0, top: 0, width: 200, height: 200 });
  near(r.scale, 2);
});

run("landscape image in a square container is letterboxed (top/bottom pads)", () => {
  const r = mod.containRenderRect({ width: 200, height: 100 }, { width: 200, height: 200 });
  rectNear(r, { left: 0, top: 50, width: 200, height: 100 });
  near(r.scale, 1);
});

run("portrait image in a square container is pillarboxed (left/right pads)", () => {
  const r = mod.containRenderRect({ width: 100, height: 200 }, { width: 200, height: 200 });
  rectNear(r, { left: 50, top: 0, width: 100, height: 200 });
  near(r.scale, 1);
});

run("fill/cover mode overflows and centers (negative offset)", () => {
  const r = mod.containRenderRect({ width: 200, height: 100 }, { width: 200, height: 200 }, "fill");
  rectNear(r, { left: -100, top: 0, width: 400, height: 200 });
  near(r.scale, 2);
});

run("degenerate natural size yields a zero rect (no NaN/Infinity)", () => {
  const r = mod.containRenderRect({ width: 0, height: 0 }, { width: 200, height: 200 });
  rectNear(r, { left: 0, top: 0, width: 0, height: 0 });
  assert.ok(Number.isFinite(r.scale));
});

// ---- projectNormalizedBox: a detection box → px within the container ----

run("full-image box (0,0,1,1) covers the whole rendered image", () => {
  const b = mod.projectNormalizedBox({ x: 0, y: 0, w: 1, h: 1 }, { width: 100, height: 100 }, { width: 200, height: 200 });
  rectNear(b, { left: 0, top: 0, width: 200, height: 200 });
});

run("centered half box maps to the middle quarter", () => {
  const b = mod.projectNormalizedBox({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, { width: 100, height: 100 }, { width: 200, height: 200 });
  rectNear(b, { left: 100, top: 100, width: 100, height: 100 });
});

run("box respects letterbox padding (landscape image, square container)", () => {
  const nat = { width: 200, height: 100 };
  const disp = { width: 200, height: 200 };
  // full box sits on the rendered band (top pad 50, height 100)
  rectNear(mod.projectNormalizedBox({ x: 0, y: 0, w: 1, h: 1 }, nat, disp), { left: 0, top: 50, width: 200, height: 100 });
  // right half, full height of the image band
  rectNear(mod.projectNormalizedBox({ x: 0.5, y: 0, w: 0.5, h: 1 }, nat, disp), { left: 100, top: 50, width: 100, height: 100 });
});

// ---- clampUnitBox: keep a box inside [0,1] before projecting ----

run("clampUnitBox clamps origin and shrinks overflow to stay in [0,1]", () => {
  boxNear(mod.clampUnitBox({ x: -0.2, y: 0.1, w: 0.5, h: 2 }), { x: 0, y: 0.1, w: 0.5, h: 0.9 });
});

run("clampUnitBox trims width when x+w exceeds 1", () => {
  boxNear(mod.clampUnitBox({ x: 0.8, y: 0, w: 0.5, h: 0.3 }), { x: 0.8, y: 0, w: 0.2, h: 0.3 });
});

run("clampUnitBox leaves an in-bounds box untouched", () => {
  boxNear(mod.clampUnitBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
});

// ---- toUnitBox: normalize the backend's [x,y,w,h] array into a UnitBox ----

run("toUnitBox reads a 4-tuple array", () => {
  assert.deepStrictEqual(mod.toUnitBox([0.1, 0.2, 0.3, 0.4]), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
});

run("toUnitBox passes a UnitBox object through", () => {
  assert.deepStrictEqual(mod.toUnitBox({ x: 0.5, y: 0.6, w: 0.1, h: 0.2 }), { x: 0.5, y: 0.6, w: 0.1, h: 0.2 });
});

run("toUnitBox returns a zero box for malformed input", () => {
  assert.deepStrictEqual(mod.toUnitBox([0.1, 0.2]), { x: 0, y: 0, w: 0, h: 0 });
  assert.deepStrictEqual(mod.toUnitBox(null), { x: 0, y: 0, w: 0, h: 0 });
});

// ---- formatDetectionLabel: NudeNet class → human-readable ----

run("formatDetectionLabel humanizes an UPPER_SNAKE class", () => {
  assert.strictEqual(mod.formatDetectionLabel("FEMALE_BREAST_EXPOSED"), "Female breast exposed");
  assert.strictEqual(mod.formatDetectionLabel("BELLY_COVERED"), "Belly covered");
});

run("formatDetectionLabel falls back for empty input", () => {
  assert.strictEqual(mod.formatDetectionLabel(""), "Sensitive region");
});

console.log("\nall safety-overlay tests passed");

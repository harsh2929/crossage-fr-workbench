// Unit tests for the reduced-motion / animation-settings source (Wave 0).
// Pure logic only — the useReducedMotion React hook is covered by tsc + e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rm-")), "reducedMotion.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/reducedMotion.ts")],
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

run("default settings animate (all prefs off)", () => {
  assert.deepStrictEqual(mod.DEFAULT_ANIMATION_SETTINGS, {
    reducedMotion: false,
    reducedTransparency: false,
    highContrast: false,
  });
  assert.strictEqual(mod.shouldAnimate(mod.DEFAULT_ANIMATION_SETTINGS), true);
});

run("normalize coerces null/undefined to safe defaults", () => {
  assert.deepStrictEqual(mod.normalizeAnimationSettings(null), mod.DEFAULT_ANIMATION_SETTINGS);
  assert.deepStrictEqual(mod.normalizeAnimationSettings(undefined), mod.DEFAULT_ANIMATION_SETTINGS);
});

run("normalize accepts booleans, ignores invalid/extra keys", () => {
  const s = mod.normalizeAnimationSettings({ reducedMotion: true, highContrast: true, junk: 1, reducedTransparency: "yes" });
  assert.deepStrictEqual(s, { reducedMotion: true, reducedTransparency: false, highContrast: true });
});

run("shouldAnimate is false only when reducedMotion", () => {
  assert.strictEqual(mod.shouldAnimate({ reducedMotion: true, reducedTransparency: false, highContrast: false }), false);
  assert.strictEqual(mod.shouldAnimate({ reducedMotion: false, reducedTransparency: true, highContrast: true }), true);
});

run("readAnimationSettings reads the three media queries", () => {
  const mm = (q) => ({ matches: q.includes("reduced-motion") });
  assert.deepStrictEqual(mod.readAnimationSettings(mm), {
    reducedMotion: true,
    reducedTransparency: false,
    highContrast: false,
  });
});

run("readAnimationSettings maps every pref", () => {
  const mm = (q) => ({
    matches:
      q.includes("reduced-motion") || q.includes("reduced-transparency") || q.includes("contrast"),
  });
  assert.deepStrictEqual(mod.readAnimationSettings(mm), {
    reducedMotion: true,
    reducedTransparency: true,
    highContrast: true,
  });
});

run("readAnimationSettings tolerates a missing/throwing matchMedia", () => {
  assert.deepStrictEqual(mod.readAnimationSettings(undefined), mod.DEFAULT_ANIMATION_SETTINGS);
  assert.deepStrictEqual(
    mod.readAnimationSettings(() => {
      throw new Error("no matchMedia");
    }),
    mod.DEFAULT_ANIMATION_SETTINGS
  );
});

console.log("\nall reduced-motion tests passed");

// Unit tests for reveal-stagger delay logic (Wave P0). Per-item entrance delay,
// capped so a long list doesn't cascade forever. Pure — the CSS + hook that
// apply --reveal-delay are covered by tsc + e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "reveal-")), "revealStagger.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/revealStagger.ts")],
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

run("step and cap are positive constants", () => {
  assert.ok(mod.REVEAL_STEP_MS > 0);
  assert.ok(mod.REVEAL_CAP > 0);
});

run("delay grows linearly by step", () => {
  assert.strictEqual(mod.staggerDelayMs(0), 0);
  assert.strictEqual(mod.staggerDelayMs(1), mod.REVEAL_STEP_MS);
  assert.strictEqual(mod.staggerDelayMs(5), 5 * mod.REVEAL_STEP_MS);
});

run("delay caps so long lists don't cascade forever", () => {
  assert.strictEqual(mod.staggerDelayMs(mod.REVEAL_CAP), mod.REVEAL_CAP * mod.REVEAL_STEP_MS);
  assert.strictEqual(mod.staggerDelayMs(mod.REVEAL_CAP + 50), mod.REVEAL_CAP * mod.REVEAL_STEP_MS);
});

run("negative index clamps to 0", () => {
  assert.strictEqual(mod.staggerDelayMs(-3), 0);
});

run("custom step and cap are honoured", () => {
  assert.strictEqual(mod.staggerDelayMs(3, 30, 2), 2 * 30);
  assert.strictEqual(mod.staggerDelayMs(1, 30, 2), 30);
});

run("revealDelayStyle returns a CSS custom property", () => {
  assert.deepStrictEqual(mod.revealDelayStyle(2), { "--reveal-delay": `${2 * mod.REVEAL_STEP_MS}ms` });
});

console.log("\nall reveal-stagger tests passed");

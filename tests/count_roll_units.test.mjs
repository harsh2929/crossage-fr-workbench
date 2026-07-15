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
const hookSource = fs.readFileSync(path.join(ROOT, "src/shell/useCountRoll.ts"), "utf8");

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

run("nextCountRollState initializes without bumping", () => {
  assert.deepStrictEqual(
    mod.nextCountRollState({ bumpKey: 0, direction: "none", prev: undefined }, 4),
    { bumpKey: 0, direction: "none", prev: 4 },
  );
});

run("nextCountRollState bumps synchronously on value changes", () => {
  const first = mod.nextCountRollState({ bumpKey: 0, direction: "none", prev: undefined }, 4);
  const second = mod.nextCountRollState(first, 6);
  const third = mod.nextCountRollState(second, 3);
  assert.deepStrictEqual(second, { bumpKey: 1, direction: "up", prev: 6 });
  assert.deepStrictEqual(third, { bumpKey: 2, direction: "down", prev: 3 });
});

run("nextCountRollState returns same state for no-op renders", () => {
  const state = { bumpKey: 2, direction: "up", prev: 6 };
  assert.strictEqual(mod.nextCountRollState(state, 6), state);
});

run("throttled bump: only when changed AND interval elapsed AND not initial", () => {
  // changed but too soon since last bump → no bump
  assert.strictEqual(mod.shouldThrottledBump(5, 6, 0, 100, 300), false);
  // changed and interval elapsed → bump
  assert.strictEqual(mod.shouldThrottledBump(5, 6, 0, 300, 300), true);
  assert.strictEqual(mod.shouldThrottledBump(5, 6, 0, 999, 300), true);
  // no change → never bump, even after a long time
  assert.strictEqual(mod.shouldThrottledBump(5, 5, 0, 999, 300), false);
  // initial (prev undefined) → no bump
  assert.strictEqual(mod.shouldThrottledBump(undefined, 6, 0, 999, 300), false);
});

run("hooks compute bump keys without post-commit state effects", () => {
  assert.doesNotMatch(hookSource, /useEffect/);
  assert.doesNotMatch(hookSource, /useState/);
});

console.log("\nall count-roll tests passed");

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
const appSource = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

function between(start, end) {
  const startIndex = css.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker ${start}`);
  const endIndex = css.indexOf(end, startIndex + start.length);
  assert.ok(endIndex >= 0, `missing end marker ${end}`);
  return css.slice(startIndex, endIndex);
}

run("vivid accent tokens are defined before dark-mode overrides", () => {
  assert.strictEqual((css.match(/^:root \{/gm) || []).length, 1);
  const rootBlock = between(":root {", "\n}\n\n* {");
  assert.ok(rootBlock.includes("--accent-vivid-solid: #7c5cff;"));
  assert.ok(rootBlock.includes("--accent-vivid-icon: #8b5cf6;"));
  const darkMatch = css.match(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n  \}\n/);
  assert.ok(darkMatch, "missing dark scheme :root block");
  const darkBlock = darkMatch[1];
  assert.ok(darkBlock.includes("--accent-vivid: linear-gradient(120deg, #9a7bff"));
  assert.ok(darkBlock.includes("--accent-vivid-solid: #9a7bff;"));
  assert.ok(darkBlock.includes("--accent-vivid-solid-strong: #d7c9ff;"));
  const phaseOne = css.slice(css.indexOf("Phase 1 — Photos-first shell"));
  assert.ok(!/^:root \{/m.test(phaseOne), "Phase layer must not override dark vivid tokens later in the cascade");
});

run("post-token vivid usages reference variables instead of hardcoded brand hexes", () => {
  const usageCss = css.slice(css.indexOf("/* Segmented sub-navigation"));
  assert.ok(!/#(?:7c5cff|6b3df0|8b5cf6)\b/i.test(usageCss), "vivid usage should use tokens");
  assert.ok(!/rgba\(124,\s*92,\s*255,/i.test(usageCss), "vivid shadows should derive from tokens");
  assert.ok(usageCss.includes("var(--accent-vivid-solid)"));
  assert.ok(usageCss.includes("var(--accent-vivid-solid-strong)"));
  assert.ok(usageCss.includes("var(--accent-vivid-icon)"));
});

run("live scan overlay animations avoid layout properties", () => {
  const scanBeam = between("@keyframes scanBeam", "\n}\n\n@keyframes sakuraConverge");
  const sakuraConverge = between("@keyframes sakuraConverge", "\n}\n\n@keyframes sakuraBreeze");
  assert.ok(css.includes("animation: scanBeam 2.9s ease-in-out infinite;"));
  assert.ok(!css.includes("scannerBeam"));
  assert.ok(!/\b(?:left|top)\s*:/.test(scanBeam));
  assert.ok(!/\b(?:left|top)\s*:/.test(sakuraConverge));
  assert.ok(sakuraConverge.includes("var(--petal-from-dx)"));
  assert.ok(sakuraConverge.includes("7cqw"));
  assert.ok(css.includes("container-type: size;"));
  assert.ok(appSource.includes("\"--petal-from-dx\""));
  assert.ok(appSource.includes("\"--petal-from-dy\""));
});

console.log("\nall styles unit tests passed");

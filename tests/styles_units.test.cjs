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

run("shared primitives consume the semantic design-system contract", () => {
  const rootBlock = between(":root {", "\n}\n\n* {");
  const contractTokens = [
    "--space-1", "--space-2", "--space-3", "--space-4", "--space-5",
    "--surface-bg", "--surface-border", "--surface-radius", "--surface-padding",
    "--radius-compact", "--radius-control", "--radius-pill",
    "--control-min-height", "--control-padding-inline",
    "--elevation-surface", "--elevation-control", "--elevation-primary",
    "--selection-bg", "--selection-border", "--selection-shadow",
    "--danger-text", "--danger-bg", "--danger-border",
    "--focus-ring-color", "--focus-ring-width", "--focus-ring-offset", "--focus-halo",
  ];
  for (const token of contractTokens) {
    assert.ok(rootBlock.includes(`${token}:`), `missing shared token ${token}`);
  }

  const focusBlock = between("button:focus-visible,", "\n}\n\n.boot {");
  assert.ok(focusBlock.includes("var(--focus-ring-width) solid var(--focus-ring-color)"));
  assert.ok(focusBlock.includes("outline-offset: var(--focus-ring-offset)"));
  assert.doesNotMatch(focusBlock, /outline:\s*\d+px/);

  const controlBlock = between(".nav-list button,\n.ghost,", "\n}\n\n.nav-list button {");
  assert.ok(controlBlock.includes("border-radius: var(--radius-control)"));
  assert.ok(controlBlock.includes("min-height: var(--control-min-height)"));
  assert.ok(controlBlock.includes("padding: 0 var(--control-padding-inline)"));
  assert.ok(controlBlock.includes("var(--dur-quick) var(--ease-standard)"));
  assert.doesNotMatch(controlBlock, /border-radius:\s*\d+px|transition:[^;]*\d+ms/);

  const surfaceBlock = between(".sidebar-card,\n.panel,", "\n}\n\n.sidebar-card {");
  assert.ok(surfaceBlock.includes("background: var(--surface-bg)"));
  assert.ok(surfaceBlock.includes("border: 1px solid var(--surface-border)"));
  assert.ok(surfaceBlock.includes("border-radius: var(--surface-radius)"));
  assert.doesNotMatch(surfaceBlock, /border-radius:\s*\d+px|rgba\(/);

  const panelBlock = between(".panel {\n  border-color: var(--surface-border)", "\n}\n\n.panel-title {");
  assert.ok(panelBlock.includes("padding: var(--surface-padding)"));
  assert.ok(css.includes("box-shadow: var(--elevation-surface)"));
  assert.ok(css.includes("box-shadow: var(--elevation-primary)"));
  assert.ok(css.includes("background: var(--danger-bg)"));
  assert.ok(css.includes("border-color: var(--danger-border)"));

  for (const selector of [".segmented.selected", ".secondary.active-scan", ".person-chip.selected", ".lane-button.selected", ".preset-button.selected", ".performance-mode.selected"]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
    assert.ok(matches.length > 0, `missing selected primitive ${selector}`);
    for (const match of matches) {
      assert.ok(match[1].includes("var(--selection-bg)"), `${selector} must use shared selection background`);
      assert.ok(match[1].includes("var(--selection-border)"), `${selector} must use shared selection border`);
      assert.ok(match[1].includes("var(--selection-shadow)"), `${selector} must use shared selection elevation`);
    }
  }
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

run("compact layouts preserve navigation and information density", () => {
  assert.match(css, /\.nav-list::\-webkit-scrollbar,\s*\.section-tabs::\-webkit-scrollbar \{\s*display: none;/);
  assert.match(css, /\.dashboard-metrics,\s*\.settings-summary,\s*\.settings-presets,[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.photos-page:not\(\.photos-destination-mode\) > \.photos-gallery,\s*\.photos-page:not\(\.photos-destination-mode\) > \.photos-library-surface > \.photos-gallery \{\s*order: -1;/);
  assert.match(css, /\.dashboard-metrics \.metric strong,[\s\S]*?white-space: normal;/);
});

console.log("\nall styles unit tests passed");

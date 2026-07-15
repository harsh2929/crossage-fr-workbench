import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = fs.readFileSync(path.join(root, "src/views/photoBurstStackPanel.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const burstTypes = fs.readFileSync(path.join(root, "src/views/photoBurstStacks.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop/preload.cjs"), "utf8");
const phrases = fs.readFileSync(path.join(root, "src/i18n/photoCullingPhrases.ts"), "utf8");

for (const command of [
  "photo_culling_status",
  "analyze_photo_burst_culling",
  "apply_photo_culling_recommendation",
]) {
  assert.ok(main.includes(`"${command}"`), `${command} must be main-process allowlisted`);
  assert.ok(preload.includes(`"${command}"`), `${command} must be preload allowlisted`);
  assert.ok(app.includes(`"${command}"`), `${command} must be wired in App`);
}

assert.ok(photos.includes("<PhotoBurstStackPanel"));
assert.ok(photos.includes("confirm: true"), "using a recommendation must be explicitly confirmed");
assert.ok(photos.includes("idempotencyKey,"), "recommendation application must carry a stable idempotency key");
assert.ok(photos.includes("resultSha256: culling.resultSha256"), "application must bind to the reviewed result");
assert.ok(photos.includes("photoCullingApplyKeysRef.current.get(culling.analysisId)"));
assert.ok(photos.includes("setPhotoBurstSelectionFnRef.current"), "manual keeper selection must remain available");

const analyzeFunction = photos.indexOf("async function analyzeBurstCulling");
const analyzeCall = photos.indexOf("await analyzePhotoBurstCullingFnRef.current", analyzeFunction);
const panelRender = photos.indexOf("onAnalyzeCulling={analyzeBurstCulling}");
assert.ok(analyzeFunction > 0 && analyzeCall > analyzeFunction && panelRender > analyzeCall, "analysis must be user-triggered");
assert.equal(photos.slice(0, analyzeFunction).includes("analyzePhotoBurstCullingFnRef.current({"), false);

for (const reasonCode of [
  "top-overall",
  "sharpest-in-burst",
  "soft-focus",
  "motion-clear",
  "motion-blur-risk",
  "faces-high-quality",
  "faces-low-quality",
  "eyes-likely-open",
  "eyes-uncertain",
  "face-signals-consent-required",
]) {
  assert.ok(panel.includes(`"${reasonCode}"`), `missing explanation label for ${reasonCode}`);
}
assert.ok(panel.includes("cullingFrame.reasons.map"), "all frame reasons must remain visible");
assert.equal(panel.includes("cullingFrame.reasons.slice"), false, "frame explanations must not be truncated");
assert.ok(panel.includes('props.uiText("Review only")'));
assert.ok(panel.includes('props.uiText("Sharpness and motion only")'));
assert.ok(panel.includes('props.uiText("Face signals enabled")'));
assert.equal(/delete/i.test(panel), false, "the assisted-culling panel must not expose deletion");

assert.ok(burstTypes.includes("recommendationOnly: true"));
assert.ok(burstTypes.includes("automaticDeletion: false"));
assert.ok(burstTypes.includes("normalizePhotoCullingStatus"));

for (const selector of [
  ".photo-culling-status",
  ".photo-culling-recommendation",
  ".photo-burst-frame.recommended",
  ".photo-culling-reasons",
  ".photo-culling-reason.positive",
  ".photo-culling-reason.negative",
  "@media (max-width: 680px)",
]) {
  assert.ok(styles.includes(selector), `missing assisted-culling selector ${selector}`);
}
assert.match(styles, /\.photo-burst-frame-list\.has-culling\s*\{[\s\S]*?grid-template-columns:/);

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} culling phrase map`);
}
for (const source of [
  "Review only",
  "Analyze burst",
  "Use recommendation",
  "Motion blur risk",
  "Eyes likely open",
  "Face signals require consent",
]) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((phrases.match(new RegExp(`"${escaped}"`, "g")) || []).length, 6, `${source} must cover six languages`);
}

console.log("photo assisted-culling UI contract ok");

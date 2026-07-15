import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const types = fs.readFileSync(path.join(root, "src/types.ts"), "utf8");
const panel = fs.readFileSync(path.join(root, "src/views/photoSemanticSearchPanel.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const search = fs.readFileSync(path.join(root, "src/shell/SearchView.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const phrases = fs.readFileSync(path.join(root, "src/i18n/photoVideoSemanticPhrases.ts"), "utf8");
const queuePanel = fs.readFileSync(path.join(root, "src/views/photoIndexingQueuePanel.tsx"), "utf8");

for (const field of [
  "resultKind",
  "segmentId",
  "timestampMs",
  "startMs",
  "endMs",
  "durationMs",
  "scoredVideoSegments",
  "missingVideoAssets",
  "videoIndex",
]) {
  assert.ok(types.includes(`${field}?`), `semantic result contract must type ${field}`);
}

assert.ok(panel.includes('result.resultKind === "videoSegment"'));
assert.ok(panel.includes("result.segmentId || result.sourcePath"), "multiple moments from one source need stable segment keys");
assert.ok(panel.includes("props.onOpenResult(result.sourcePath, isVideoSegment ? result.timestampMs : undefined)"));
assert.ok(panel.includes("formatVideoTimestamp"));
assert.ok(panel.includes("<Video"));

assert.ok(search.includes("video-segment:${semanticItem.segmentId}"));
assert.ok(search.includes("timestampMs: semanticItem?.timestampMs"));
assert.ok(search.includes("semanticItem.segmentId || semanticItem.sourcePath"));
assert.ok(search.includes("Finds photos and video moments by meaning, on your device."));

assert.ok(photos.includes("pendingLightboxVideoSeekRef"));
assert.ok(photos.includes("pendingSeek.sourcePath === currentLightboxSource"));
assert.ok(photos.includes("video.currentTime = targetMs / 1000"));
assert.ok(photos.includes("A later duration or metadata event retries this one-shot seek."));
assert.ok(photos.includes("Number.isFinite(item.timestampMs)"));
assert.ok(photos.includes("openSemanticResult(sourcePath: string, timestampMs?: number)"));
assert.ok(queuePanel.includes('jobKind === "semantic"'));
assert.ok(queuePanel.includes('uiText("Semantic media")'));

for (const selector of [".photo-semantic-result-copy", ".search-result-moment"]) {
  assert.ok(styles.includes(selector), `missing video semantic result selector ${selector}`);
}

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} video semantic phrase map`);
}
for (const source of [
  "video moment",
  "Semantic media",
  "Finds photos and video moments by meaning, on your device.",
  "Find photos and video moments by meaning",
  "Describe a photo or video moment (AI)",
]) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((phrases.match(new RegExp(`"${escaped}"`, "g")) || []).length, 6, `${source} must cover six languages`);
}

console.log("timestamped video semantic UI contract ok");

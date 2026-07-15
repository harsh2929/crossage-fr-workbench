import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = fs.readFileSync(path.join(root, "src/views/PhotoStoryEditorPanel.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const projects = fs.readFileSync(path.join(root, "src/views/photoSlideshowProjects.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop/preload.cjs"), "utf8");
const phrases = fs.readFileSync(path.join(root, "src/i18n/photoStoryPhrases.ts"), "utf8");

for (const command of [
  "photo_story_status",
  "photo_stories",
  "generate_photo_story",
  "save_photo_story",
  "delete_photo_story",
  "restore_photo_story_version",
  "export_photo_story",
  "create_photo_story_slideshow",
]) {
  assert.ok(main.includes(`"${command}"`), `${command} must be main-process allowlisted`);
  assert.ok(preload.includes(`"${command}"`), `${command} must be preload allowlisted`);
  assert.ok(app.includes(`"${command}"`), `${command} must be wired in App`);
}

assert.ok(photos.includes("<PhotoStoryEditorPanel"));
assert.ok(panel.includes("confirm: true"));
assert.ok(panel.includes("idempotencyKey: generationKey.current"));
assert.ok(panel.includes("expectedRevision: draft.revision"));
assert.ok(panel.includes("persistDraftIfNeeded()"));
assert.ok(panel.includes("await onSlideshowCreated(result.value.project)"));
assert.ok(panel.includes("maxLength={120}"));
assert.ok(panel.includes("maxLength={180}"));
assert.ok(panel.includes("maxLength={700}"));
assert.ok(panel.includes("maxLength={220}"));
assert.ok(panel.includes('window.confirm(uiText("Restore this story version?"))'));
assert.ok(panel.includes('window.confirm(uiText("Delete this story?"))'));
assert.equal(panel.includes("sourcePath"), false, "the renderer story editor must remain path-free");

const generateFunction = panel.indexOf("async function generate()");
const generateButton = panel.indexOf("onClick={() => void generate()}");
assert.ok(generateFunction > 0 && generateButton > generateFunction, "story generation must be user-triggered");
assert.equal(panel.slice(0, generateFunction).includes("generatePhotoStory({"), false);

for (const selector of [
  ".photo-story-editor",
  ".photo-story-generate-row",
  ".photo-story-fields",
  ".photo-story-chapter",
  ".photo-story-captions",
  ".photo-story-actions",
  "@media (max-width: 680px)",
]) {
  assert.ok(styles.includes(selector), `missing story editor selector ${selector}`);
}
assert.match(styles, /\.photo-story-fields\s*\{[\s\S]*?grid-template-columns:/);
assert.match(styles, /\.photo-story-captions\s*\{[\s\S]*?grid-template-columns:/);
assert.ok(projects.includes("storyId: draft.storyId ?? existing?.storyId"));
assert.ok(projects.includes("storyContentSha256: draft.storyContentSha256 ?? existing?.storyContentSha256"));
assert.ok(projects.includes("storyGenerationSha256: draft.storyGenerationSha256 ?? existing?.storyGenerationSha256"));

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} story phrase map`);
}
for (const source of [
  "Photo story",
  "Generate draft",
  "Story title",
  "Chapter narrative",
  "Save story",
  "Create movie",
]) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((phrases.match(new RegExp(`"${escaped}"`, "g")) || []).length, 6, `${source} must cover six languages`);
}

console.log("photo story editor UI contract ok");

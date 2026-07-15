import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = fs.readFileSync(path.join(root, "src/views/PhotoGenerativeEditPanel.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const display = fs.readFileSync(path.join(root, "src/views/photoImageEditDisplay.ts"), "utf8");
const infoMetadata = fs.readFileSync(path.join(root, "src/views/photoInfoMetadata.ts"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop/preload.cjs"), "utf8");
const phrases = fs.readFileSync(path.join(root, "src/i18n/photoGenerativePhrases.ts"), "utf8");

for (const command of [
  "photo_generative_status",
  "inspect_photo_content_credentials",
  "install_photo_generative_pack",
  "render_photo_generative_preview",
  "apply_photo_generative_edit",
  "discard_photo_generative_preview",
]) {
  assert.ok(main.includes(`"${command}"`), `${command} must be main-process allowlisted`);
  assert.ok(preload.includes(`"${command}"`), `${command} must be preload allowlisted`);
  assert.ok(app.includes(`"${command}"`), `${command} must be wired in App`);
}

for (const command of [
  "synthetic_age_image_review_status",
  "generate_synthetic_age_image_reviews",
  "approve_synthetic_age_image_review",
  "reject_synthetic_age_image_review",
]) {
  assert.ok(main.includes(`"${command}"`), `${command} must be main-process allowlisted`);
  assert.ok(preload.includes(`"${command}"`), `${command} must be preload allowlisted`);
}
for (const command of [
  "generate_synthetic_age_image_reviews",
  "approve_synthetic_age_image_review",
  "reject_synthetic_age_image_review",
]) {
  assert.ok(app.includes(`"${command}"`), `${command} must be wired in App`);
}
assert.ok(main.includes('decoratePath(next, "generatedPath", "generatedUrl")'));
assert.ok(app.includes("function SyntheticAgeImageReviewsPanel"));
assert.ok(app.includes("Nothing enters matching until you approve it."));
assert.ok(app.includes("not an authentic photo or prediction"));
assert.ok(app.includes("acknowledgeVisualReview: true"));
assert.ok(app.includes("item.generatedAvailable || item.reasons.length > 0"));
assert.ok(app.includes("item.generatedUrl"));
for (const selector of [
  ".synthetic-age-reviews",
  ".synthetic-age-thumb",
  ".person-age-augmentation",
  ".age-chip.ai-generated-chip",
]) {
  assert.ok(styles.includes(selector), `missing synthetic age-reference selector ${selector}`);
}

assert.ok(photos.includes("<PhotoGenerativeEditPanel"));
assert.ok(photos.includes("activePhotoGenerativePreview?.generativePreviewUrl"));
assert.ok(photos.includes("photoEditOperationsWithGeneratedBase(photoEditStack, operation)"));
assert.ok(photos.includes("photoEditOperationsWithGeneratedBase(plan.stack, operation)"));
assert.ok(display.includes('String(operation?.kind || "").trim().toLowerCase() === "local_generative_edit"'));
assert.ok(panel.includes("confirm: true"));
assert.ok(panel.includes("idempotencyKey: applyKeyRef.current"));
assert.ok(panel.includes("acknowledgeLargeDownload"));
assert.ok(panel.includes("heavyAcknowledged"));
assert.ok(panel.includes("maskRects"));
assert.ok(panel.includes("onPreviewChange(result.value)"));
assert.ok(panel.includes("await discardPhotoGenerativePreview"));
assert.ok(panel.includes("maxLength={400}"));
assert.ok(panel.includes("contentCredentialsAvailable"));
assert.ok(panel.includes("Apply with workspace-local Content Credentials"));
assert.ok(photos.includes("inspectLightboxContentCredentials"));
assert.ok(infoMetadata.includes("Workspace-local trust (not global)"));

const previewBranch = panel.indexOf("{preview ? (");
assert.ok(previewBranch > 0);
assert.ok(panel.indexOf("onClick={() => void applyPreview()}", previewBranch) > previewBranch);
assert.ok(panel.indexOf("onClick={() => void generatePreview()}", previewBranch) > previewBranch);

for (const selector of [
  ".photo-generative-editor",
  ".photo-generative-modes",
  ".photo-generative-heavy-options",
  ".photo-generative-compare",
  ".photo-generative-command-row",
  "@media (max-width: 680px)",
]) {
  assert.ok(styles.includes(selector), `missing generative editor selector ${selector}`);
}
assert.match(styles, /\.photo-generative-modes\s*\{[\s\S]*?grid-template-columns:/);
assert.match(styles, /\.photo-generative-editor\s*\{[\s\S]*?flex: 1 0 100%/);

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} generative phrase map`);
}
for (const source of [
  "Local AI edits",
  "Clean Up",
  "Heavy AI pack",
  "I understand this downloads about 23 GB",
  "Compare AI edit",
  "Apply AI edit",
  "Content Credentials",
  "Workspace-local trust (not global)",
]) {
  assert.equal((phrases.match(new RegExp(`"${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g")) || []).length, 6);
}

console.log("photo generative editor UI contract ok");

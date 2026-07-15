import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const types = read("src/types.ts");
const panel = read("src/views/photoRelationshipSuggestionsPanel.tsx");
const gallery = read("src/views/photoPeopleGallery.tsx");
const photos = read("src/views/PhotosView.tsx");
const relationshipState = read("src/views/usePhotoRelationshipSuggestions.ts");
const app = read("src/App.tsx");
const styles = read("src/views/photoRelationshipSuggestionsPanel.css");
const phrases = read("src/i18n/photoRelationshipPhrases.ts");
const main = read("desktop/main.cjs");
const preload = read("desktop/preload.cjs");

for (const contract of [
  "PhotoRelationshipNameSuggestion",
  "sharedRelationships",
  "directCooccurrenceCount: 0",
  "reviewRequired: true",
  "autoApply: false",
  "undoAvailable: true",
]) {
  assert.ok(types.includes(contract), `missing relationship UI contract ${contract}`);
}

assert.ok(panel.includes('aria-label={props.uiText("Who is this?")}'));
assert.ok(panel.includes('props.uiText("Relationship context is not proof of identity. Review before merging.")'));
assert.ok(panel.includes("suggestion.sharedRelationships.slice(0, 4)"));
assert.ok(panel.includes("props.onApply(suggestion)"));
assert.ok(panel.includes("props.onDismiss(suggestion)"));
assert.ok(gallery.includes("{props.relationshipPanel}"));

assert.ok(photos.includes("usePhotoRelationshipSuggestions"));
assert.ok(relationshipState.includes('decision: "applied"'));
assert.ok(relationshipState.includes("confirm: true"));
assert.ok(relationshipState.includes("idempotencyKey: `photo-relationship:"));
assert.ok(relationshipState.includes("reviewingIdRef.current"));
assert.ok(photos.includes("confirmPhotoAction({"));
assert.ok(app.includes('"suggest_photo_relationship_names"'));
assert.ok(app.includes('"review_photo_relationship_name_suggestion"'));
for (const command of ["suggest_photo_relationship_names", "review_photo_relationship_name_suggestion"]) {
  assert.ok(main.includes(`"${command}"`), `${command} missing from main allowlist`);
  assert.ok(preload.includes(`"${command}"`), `${command} missing from preload allowlist`);
}

for (const selector of [
  ".photo-relationship-suggestions",
  ".photo-relationship-suggestion-row",
  ".photo-relationship-identities",
  ".photo-relationship-actions",
]) {
  assert.ok(styles.includes(selector), `missing relationship selector ${selector}`);
}
assert.ok(styles.includes("border-radius: 8px"));
assert.ok(styles.includes("@media (max-width: 520px)"));

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} relationship phrase map`);
}
for (const source of [
  "Who is this?",
  "Relationship clues",
  "Review and merge",
  "Not this person",
  "Relationship context is not proof of identity. Review before merging.",
]) {
  const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.equal((phrases.match(new RegExp(`"${escaped}"`, "g")) || []).length, 6, `${source} must cover six languages`);
}

console.log("relationship naming review UI contract ok");

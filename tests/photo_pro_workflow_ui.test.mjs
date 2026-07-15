import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-pro-ui-"));

function bundle(entry, output) {
  const outfile = path.join(outDir, output);
  esbuild.buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
  });
  return import(pathToFileURL(outfile).href);
}

const pro = await bundle("src/views/photoProCulling.ts", "photoProCulling.mjs");
const keyboard = await bundle("src/views/photoKeyboardShortcuts.ts", "photoKeyboardShortcuts.mjs");
const phrases = await bundle("src/i18n/photoProCurationPhrases.ts", "photoProCurationPhrases.mjs");

const items = [
  { assetId: "a", sourcePath: "/photos/a.jpg", rating: 4, colorLabel: "green", pickStatus: "pick" },
  { assetId: "b", sourcePath: "/photos/b.jpg", rating: 4, colorLabel: "green", pickStatus: "reject" },
];
assert.deepEqual(pro.photoProCurationAggregate(items), {
  rating: 4,
  colorLabel: "green",
  pickStatus: null,
});
assert.deepEqual(pro.photoProCurationUpdates(items, { rating: 5, pickStatus: "pick" }), [
  { assetId: "a", sourcePath: "/photos/a.jpg", rating: 5, pickStatus: "pick" },
  { assetId: "b", sourcePath: "/photos/b.jpg", rating: 5, pickStatus: "pick" },
]);
assert.equal(pro.photoProCurationLabel({ colorLabel: "" }, 2), "Cleared color label for 2 photos");
assert.equal(
  pro.localizedPhotoProCurationLabel(
    { colorLabel: "" },
    2,
    (source) => phrases.photoProCurationPhrases.es[source] || source,
  ),
  "Se borró la etiqueta de color de 2 fotos",
);

assert.deepEqual(keyboard.photoCurationShortcutForKeyboardEvent({ key: "5" }), { rating: 5 });
assert.deepEqual(keyboard.photoCurationShortcutForKeyboardEvent({ key: "0" }), { rating: 0 });
assert.equal(keyboard.photoCurationShortcutForKeyboardEvent({ key: "0" }, { allowZeroRating: false }), null);
assert.deepEqual(keyboard.photoCurationShortcutForKeyboardEvent({ key: "P" }), { pickStatus: "pick" });
assert.deepEqual(keyboard.photoCurationShortcutForKeyboardEvent({ key: "x" }), { pickStatus: "reject" });
assert.deepEqual(keyboard.photoCurationShortcutForKeyboardEvent({ key: "u" }), { pickStatus: "" });
assert.equal(keyboard.photoCurationShortcutForKeyboardEvent({ key: "5", metaKey: true }), null);
assert.equal(keyboard.photoCurationShortcutForKeyboardEvent({ key: "5", target: { tagName: "INPUT", type: "text" } }), null);

const controls = fs.readFileSync(path.join(root, "src/views/PhotoProCullingControls.tsx"), "utf8");
const compare = fs.readFileSync(path.join(root, "src/views/PhotoCompareSurvey.tsx"), "utf8");
const gridTile = fs.readFileSync(path.join(root, "src/views/photoGridTile.tsx"), "utf8");
const virtualGrid = fs.readFileSync(path.join(root, "src/views/photoVirtualGridPanel.tsx"), "utf8");
const bulk = fs.readFileSync(path.join(root, "src/views/photoSelectionBulkMetadataControls.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const smart = fs.readFileSync(path.join(root, "src/views/photoSmartQueryBuilder.ts"), "utf8");
const styles = [
  "src/styles.css",
  "src/views/photoCompareSurvey.css",
].map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n");
const types = fs.readFileSync(path.join(root, "src/types.ts"), "utf8");
const localizationCheck = fs.readFileSync(path.join(root, "desktop/scripts/check-localization.cjs"), "utf8");
const localeSources = Object.fromEntries(
  ["zh", "es", "fr", "ar", "hi", "ja"].map((language) => [
    language,
    fs.readFileSync(path.join(root, `src/i18n/locales/${language}.ts`), "utf8"),
  ]),
);

const requiredLocalizedPhrases = [
  "Rating",
  "Clear rating",
  "1 star",
  "5 stars",
  "Color label",
  "Clear color label",
  "Red label",
  "Purple label",
  "Pick status",
  "Unflag",
  "Mark as pick",
  "Mark as reject",
  "Compare",
  "Survey",
  "Culling view",
  "Rated {count} {photos} {rating} {stars}",
  "Labeled {count} {photos} {label}",
  "Cleared flags for {count} {photos}",
];
for (const language of Object.keys(localeSources)) {
  for (const source of requiredLocalizedPhrases) {
    assert.ok(phrases.photoProCurationPhrases[language][source], `${language} is missing ${source}`);
  }
  assert.ok(localeSources[language].includes("photoProCurationPhrases"), `${language} does not wire pro curation phrases`);
}
assert.ok(localizationCheck.includes('"../photoProCurationPhrases": "photoProCurationPhrases.ts"'));

for (const contract of ["Clear rating", "Color label", "Mark as pick", "Mark as reject", "aria-pressed"]) {
  assert.ok(controls.includes(contract), `missing curation control contract: ${contract}`);
}
for (const color of ["red", "yellow", "green", "blue", "purple"]) {
  assert.ok(styles.includes(`.photo-pro-color-button.${color}`), `missing ${color} swatch`);
}
assert.ok(compare.includes('role="dialog"'));
assert.ok(compare.includes('role="tablist"'));
assert.ok(compare.includes('import "./photoCompareSurvey.css"'), "compare/survey must load its lazy stylesheet");
assert.ok(compare.includes("trapDialogFocus"), "compare/survey must trap keyboard focus");
assert.ok(compare.includes('mode === "compare" ? 2 : 12'), "compare/survey rendering must stay bounded");
assert.ok(gridTile.includes("photo-pro-grid-badges"), "grid must surface pro curation state");
assert.ok(virtualGrid.includes("photoGridCurationSummary"), "grid controls need an accessible curation summary");
assert.ok(!bulk.includes("PhotoProCullingControls"), "advanced metadata must not duplicate primary curation controls");
assert.ok(photos.includes('className="photo-pro-bulk-control"'));
assert.ok(photos.includes("onClick={openPhotoCompare}"));
assert.ok(photos.includes("await updatePhotoAssetsMetadata"));
assert.ok(photos.includes("photoProCurationUpdates(targetItems, patch)"));
assert.ok(photos.includes("photoProCurationPendingRef.current += 1"), "rapid culling keys must be queued, not dropped");
assert.ok(photos.includes("photoProCurationPendingRef.current === 0"), "saving state must cover all curation mutations");
assert.ok(photos.includes("schedulePhotoProCurationRefresh"), "secondary catalog refreshes must be coalesced after curation writes");
assert.ok(photos.includes("photoProCurationRefreshTimerRef"), "curation refresh debounce must be cancellable");
assert.ok(photos.includes("photoCurationShortcutForKeyboardEvent(event, { allowZeroRating: false })"));
assert.ok(photos.includes("imageEditDisclosureOpen"), "X must retain edit-mode precedence");
assert.ok(photos.includes("<PhotoCompareSurvey"));
assert.ok(smart.includes('field: "rating"'));
assert.ok(smart.includes('field: "colorLabel"'));
assert.ok(smart.includes('field: "pickStatus"'));
assert.ok(types.includes('rating?: number;'));
assert.ok(types.includes('pickStatus?: ExtensibleStringUnion<"pick" | "reject">;'));
for (const selector of [
  ".photo-pro-curation-controls",
  ".photo-pro-grid-badges",
  ".photo-compare-backdrop",
  ".photo-compare-grid.compare",
  ".photo-compare-grid.survey",
  "@media (max-width: 720px)",
]) {
  assert.ok(styles.includes(selector), `missing responsive curation selector ${selector}`);
}

console.log("photo pro workflow UI contracts passed");

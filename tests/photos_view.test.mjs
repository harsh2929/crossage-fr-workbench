// Unit tests for the Photos tab's pure helper logic (no React/DOM). The TS
// sources are transpiled on the fly with esbuild (a Vite dependency) and run in
// plain node.
//
// Run: node tests/photos_view.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-")), "photosPaging.mjs");
const orderOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-order-")), "photoAlbumOrdering.mjs");
const coverCropOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-cover-crops-")), "photoCoverCrops.mjs");
const membershipOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-membership-")), "photoAlbumMemberships.mjs");
const exportPresetsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-export-presets-")), "photoExportPresets.mjs");
const importAccessOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-access-")), "photoImportAccess.mjs");
const importAlbumTargetOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-album-target-")), "photoImportAlbumTarget.mjs");
const importSessionDetailsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-session-details-")), "photoImportSessionDetails.mjs");
const editorOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-editor-")), "photoAlbumEditorState.mjs");
const imageEditsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-image-edits-")), "photoImageEdits.mjs");
const descriptionRegionsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-description-regions-")), "photoDescriptionRegions.mjs");
const keyboardOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-keyboard-")), "photoKeyboardShortcuts.mjs");
const thumbnailOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-thumbnail-")), "photoThumbnailControls.mjs");
const searchOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-search-")), "photoSearchSuggestions.mjs");
const railOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-rail-")), "photoRailVisibility.mjs");
const chipOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-chips-")), "photoFilterChips.mjs");
const keywordFiltersOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-keyword-filters-")), "photoKeywordFilters.mjs");
const savedSearchOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-saved-search-")), "photoSavedSearch.mjs");
const smartQueryOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-smart-query-")), "photoSmartQueryBuilder.mjs");
const dateAdjustmentsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-date-adjustments-")), "photoDateAdjustments.mjs");
const dateViewsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-date-views-")), "photoDateViews.mjs");
const duplicateReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-duplicate-review-")), "photoDuplicateReview.mjs");
const groupReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-group-review-")), "photoGroupReview.mjs");
const peopleMatchSelectionOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-people-match-selection-")), "photoPeopleMatchSelection.mjs");
const reviewFocusHistoryOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-review-focus-history-")), "reviewFocusHistory.mjs");
const repairCenterOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-repair-center-")), "photoRepairCenter.mjs");
const consolidationResultOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-consolidation-result-")), "photoConsolidationResult.mjs");
const virtualGridOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-virtual-grid-")), "photoVirtualGrid.mjs");
const locationPickerOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-location-picker-")), "photoLocationPicker.mjs");
const placesMapOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-places-map-")), "photoPlacesMap.mjs");
const qrActionsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-qr-actions-")), "photoQrActions.mjs");
const infoMetadataOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-info-metadata-")), "photoInfoMetadata.mjs");
const mediaPairsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-media-pairs-")), "photoMediaPairs.mjs");
const settingsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-settings-")), "photoSettings.mjs");
const liveTextActionsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-live-text-actions-")), "photoLiveTextActions.mjs");
const searchHighlightsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-search-highlights-")), "photoSearchHighlights.mjs");
const curationOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-curation-")), "photoCurationPreferences.mjs");
const slideshowOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-slideshow-")), "photoSlideshow.mjs");
const slideshowProjectsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-slideshow-projects-")), "photoSlideshowProjects.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photosPaging.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoAlbumOrdering.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: orderOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoCoverCrops.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: coverCropOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoAlbumMemberships.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: membershipOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoExportPresets.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: exportPresetsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoImportAccess.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: importAccessOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoImportAlbumTarget.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: importAlbumTargetOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoImportSessionDetails.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: importSessionDetailsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoAlbumEditorState.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: editorOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoImageEdits.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: imageEditsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDescriptionRegions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: descriptionRegionsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoKeyboardShortcuts.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: keyboardOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoThumbnailControls.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: thumbnailOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSearchSuggestions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: searchOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoRailVisibility.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: railOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoFilterChips.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: chipOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoKeywordFilters.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: keywordFiltersOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSavedSearch.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: savedSearchOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSmartQueryBuilder.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: smartQueryOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDateAdjustments.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: dateAdjustmentsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDateViews.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: dateViewsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDuplicateReview.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: duplicateReviewOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoGroupReview.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: groupReviewOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoPeopleMatchSelection.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: peopleMatchSelectionOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/reviewFocusHistory.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: reviewFocusHistoryOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoRepairCenter.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: repairCenterOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoConsolidationResult.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: consolidationResultOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoVirtualGrid.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: virtualGridOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoLocationPicker.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: locationPickerOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoPlacesMap.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: placesMapOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoQrActions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: qrActionsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoInfoMetadata.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: infoMetadataOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoMediaPairs.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: mediaPairsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSettings.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: settingsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoLiveTextActions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: liveTextActionsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSearchHighlights.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: searchHighlightsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoCurationPreferences.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: curationOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSlideshow.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: slideshowOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSlideshowProjects.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: slideshowProjectsOutFile,
});
const mod = await import(pathToFileURL(outFile).href);
const orderMod = await import(pathToFileURL(orderOutFile).href);
const coverCropMod = await import(pathToFileURL(coverCropOutFile).href);
const membershipMod = await import(pathToFileURL(membershipOutFile).href);
const exportPresetsMod = await import(pathToFileURL(exportPresetsOutFile).href);
const importAccessMod = await import(pathToFileURL(importAccessOutFile).href);
const importAlbumTargetMod = await import(pathToFileURL(importAlbumTargetOutFile).href);
const importSessionDetailsMod = await import(pathToFileURL(importSessionDetailsOutFile).href);
const editorMod = await import(pathToFileURL(editorOutFile).href);
const imageEditsMod = await import(pathToFileURL(imageEditsOutFile).href);
const descriptionRegionsMod = await import(pathToFileURL(descriptionRegionsOutFile).href);
const keyboardMod = await import(pathToFileURL(keyboardOutFile).href);
const thumbnailMod = await import(pathToFileURL(thumbnailOutFile).href);
const searchMod = await import(pathToFileURL(searchOutFile).href);
const railMod = await import(pathToFileURL(railOutFile).href);
const chipMod = await import(pathToFileURL(chipOutFile).href);
const keywordFiltersMod = await import(pathToFileURL(keywordFiltersOutFile).href);
const savedSearchMod = await import(pathToFileURL(savedSearchOutFile).href);
const smartQueryMod = await import(pathToFileURL(smartQueryOutFile).href);
const dateAdjustmentsMod = await import(pathToFileURL(dateAdjustmentsOutFile).href);
const dateViewsMod = await import(pathToFileURL(dateViewsOutFile).href);
const duplicateReviewMod = await import(pathToFileURL(duplicateReviewOutFile).href);
const groupReviewMod = await import(pathToFileURL(groupReviewOutFile).href);
const peopleMatchSelectionMod = await import(pathToFileURL(peopleMatchSelectionOutFile).href);
const reviewFocusHistoryMod = await import(pathToFileURL(reviewFocusHistoryOutFile).href);
const repairCenterMod = await import(pathToFileURL(repairCenterOutFile).href);
const consolidationResultMod = await import(pathToFileURL(consolidationResultOutFile).href);
const virtualGridMod = await import(pathToFileURL(virtualGridOutFile).href);
const locationPickerMod = await import(pathToFileURL(locationPickerOutFile).href);
const placesMapMod = await import(pathToFileURL(placesMapOutFile).href);
const qrActionsMod = await import(pathToFileURL(qrActionsOutFile).href);
const infoMetadataMod = await import(pathToFileURL(infoMetadataOutFile).href);
const mediaPairsMod = await import(pathToFileURL(mediaPairsOutFile).href);
const settingsMod = await import(pathToFileURL(settingsOutFile).href);
const liveTextActionsMod = await import(pathToFileURL(liveTextActionsOutFile).href);
const searchHighlightsMod = await import(pathToFileURL(searchHighlightsOutFile).href);
const curationMod = await import(pathToFileURL(curationOutFile).href);
const slideshowMod = await import(pathToFileURL(slideshowOutFile).href);
const slideshowProjectsMod = await import(pathToFileURL(slideshowProjectsOutFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

function testBudgetMs(name, fallbackMs) {
  const parsed = Number(process.env[`VINTRACE_TEST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

run("hasMorePages: loaded < total means more", () => {
  assert.strictEqual(mod.hasMorePages({ loaded: 100, total: 250 }), true);
  assert.strictEqual(mod.hasMorePages({ loaded: 250, total: 250 }), false);
  assert.strictEqual(mod.hasMorePages({ loaded: 0, total: 0 }), false);
});

run("nextOffset advances by loaded count", () => {
  assert.strictEqual(mod.nextOffset({ loaded: 100 }), 100);
  assert.strictEqual(mod.nextOffset({ loaded: 0 }), 0);
});

run("reorderSelectedPhotoSources moves separated selections earlier while preserving relative order", () => {
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSources(["a", "b", "c", "d"], ["b", "d"], "earlier"),
    ["b", "a", "d", "c"],
  );
});

run("reorderSelectedPhotoSources moves adjacent selections as a block", () => {
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSources(["a", "b", "c", "d"], ["b", "c"], "later"),
    ["a", "d", "b", "c"],
  );
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSources(["a", "b", "c", "d"], ["b", "c"], "first"),
    ["b", "c", "a", "d"],
  );
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSources(["a", "b", "c", "d"], ["b", "c"], "last"),
    ["a", "d", "b", "c"],
  );
});

run("reorderSelectedPhotoSourcesToPosition moves selected blocks to a 1-based target", () => {
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSourcesToPosition(["a", "b", "c", "d", "e"], ["b", "d"], 2),
    ["a", "b", "d", "c", "e"],
  );
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSourcesToPosition(["a", "b", "c", "d"], ["b", "c"], 99),
    ["a", "d", "b", "c"],
  );
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSourcesToPosition(["a", "b", "c", "d"], ["b", "c"], 0),
    ["b", "c", "a", "d"],
  );
  assert.deepStrictEqual(
    orderMod.reorderSelectedPhotoSourcesToPosition(["a", "b"], [], 1),
    ["a", "b"],
  );
});

run("reorderPhotoSourcesByDrag inserts before and after a target", () => {
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d"], "d", "b", "before"),
    ["a", "d", "b", "c"],
  );
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d"], "a", "c", "after"),
    ["b", "c", "a", "d"],
  );
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b"], "a", "a", "after"),
    ["a", "b"],
  );
});

run("reorderPhotoSourcesByDrag moves a selected drag block in album order", () => {
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d", "e"], "d", "e", "before", ["b", "d"]),
    ["a", "c", "b", "d", "e"],
  );
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d", "e"], "b", "a", "after", ["b", "d"]),
    ["a", "b", "d", "c", "e"],
  );
});

run("reorderPhotoSourcesByDrag ignores selection unless the dragged source is selected", () => {
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d"], "c", "a", "before", ["a", "b"]),
    ["c", "a", "b", "d"],
  );
  assert.deepStrictEqual(
    orderMod.reorderPhotoSourcesByDrag(["a", "b", "c", "d"], "b", "d", "after", ["b", "d"]),
    ["a", "b", "c", "d"],
  );
});

run("canSavePhotoSortAsAlbumOrder only allows whole manual albums in non-custom sort", () => {
  assert.strictEqual(orderMod.canSavePhotoSortAsAlbumOrder("filename", true, true, 3), true);
  assert.strictEqual(orderMod.canSavePhotoSortAsAlbumOrder("manual", true, true, 3), false);
  assert.strictEqual(orderMod.canSavePhotoSortAsAlbumOrder("filename", false, true, 3), false);
  assert.strictEqual(orderMod.canSavePhotoSortAsAlbumOrder("filename", true, false, 3), false);
  assert.strictEqual(orderMod.canSavePhotoSortAsAlbumOrder("filename", true, true, 1), false);
});

run("photoAlbumReorderNotice summarizes stale manual album reorder diagnostics", () => {
  assert.strictEqual(
    orderMod.photoAlbumReorderNotice({ updated: 0, requested: 4, missing: 1, duplicates: 2, appended: 3 }),
    "No album order changed. 1 requested item was no longer in this album. 2 duplicate requests were ignored. 3 existing album items were appended to keep the album complete.",
  );
});

run("photoAlbumReorderNotice stays quiet for normal manual album reorders", () => {
  assert.strictEqual(orderMod.photoAlbumReorderNotice({ updated: 4, requested: 4, missing: 0, duplicates: 0, appended: 0 }), "");
  assert.strictEqual(orderMod.photoAlbumReorderNotice(null), "");
});

run("photoDetectedFaceCoverCrop derives crop from normalized face metadata", () => {
  const crop = coverCropMod.photoDetectedFaceCoverCrop({
    width: 2000,
    height: 1000,
    assetMetadata: {
      faces: [
        { left: 0.35, top: 0.2, width: 0.2, height: 0.3, confidence: 0.91 },
      ],
    },
  });
  assert(crop, crop);
  assert(Math.abs(crop.left - 18.555) < 0.05, crop);
  assert(Math.abs(crop.top - 2.825) < 0.05, crop);
  assert(Math.abs(crop.width - 52.89) < 0.05, crop);
  assert(Math.abs(crop.height - 67.5) < 0.05, crop);
  assert.strictEqual(coverCropMod.photoCoverCropPresetId(crop), "custom");
  assert.strictEqual(coverCropMod.photoCoverCropsEqual(crop, { left: 18.56, top: 2.83, width: 52.9, height: 67.5 }), true);
});

run("photoDetectedFaceCoverCrop accepts normalized min max face bounds", () => {
  const crop = coverCropMod.photoDetectedFaceCoverCrop({
    width: 2000,
    height: 1000,
    assetMetadata: {
      faceRegions: [
        { bounds: { xMin: 0.35, yMin: 0.2, xMax: 0.55, yMax: 0.5 }, confidence: 0.9 },
      ],
    },
  });
  assert(crop, crop);
  assert(Math.abs(crop.left - 18.555) < 0.05, crop);
  assert(Math.abs(crop.top - 2.825) < 0.05, crop);
  assert(Math.abs(crop.width - 52.89) < 0.05, crop);
  assert(Math.abs(crop.height - 67.5) < 0.05, crop);
});

run("photoDetectedFaceCoverCrop derives crop from pixel face bounds and chooses largest confident face", () => {
  const crop = coverCropMod.photoDetectedFaceCoverCrop({
    width: 4000,
    height: 3000,
    assetMetadata: {
      detectedFaces: [
        { box: { x: 100, y: 90, width: 300, height: 300 }, confidence: 0.99 },
        { bounds: { xMin: 1000, yMin: 600, xMax: 2200, yMax: 1800 }, score: 0.85 },
      ],
    },
  });
  assert(crop, crop);
  assert(crop.left > 4 && crop.left < 6, crop);
  assert.strictEqual(crop.top, 0);
  assert(crop.width > 70 && crop.width < 71, crop);
  assert(crop.height > 89 && crop.height < 91, crop);
});

run("photo album memberships count manual and derived smart matches", () => {
  const memberships = [
    { albumId: "manual-a", name: "Trips", albumKind: "manual", position: 1, addedAt: "2026-06-01T10:00:00Z" },
    { albumId: "smart-a", name: "Favorites", albumKind: "smart", position: 0, addedAt: "2026-06-02T10:00:00Z", derived: true },
    { albumId: "manual-b", name: "Family", albumKind: "manual", position: 0, addedAt: "2026-06-03T10:00:00Z" },
  ];
  assert.deepStrictEqual(membershipMod.photoAlbumMembershipFilterCounts(memberships), {
    all: 3,
    manual: 2,
    smart: 1,
  });
  assert.deepStrictEqual(
    membershipMod.visiblePhotoAlbumMemberships(memberships, "manual", "kind").map((item) => item.albumId),
    ["manual-b", "manual-a"],
  );
  assert.deepStrictEqual(
    membershipMod.visiblePhotoAlbumMemberships(memberships, "all", "name").map((item) => item.albumId),
    ["manual-b", "smart-a", "manual-a"],
  );
  assert.deepStrictEqual(
    membershipMod.visiblePhotoAlbumMemberships(memberships, "all", "recent").map((item) => item.albumId),
    ["manual-b", "smart-a", "manual-a"],
  );
});

run("photo export preset settings normalize invalid saved values", () => {
  assert.deepStrictEqual(exportPresetsMod.normalizePhotoExportPresetSettings({
    includeMetadata: true,
    includeXmp: 1,
    preserveColorProfile: 0,
    targetColorProfile: "bad-profile",
    shareAfterExport: 1,
    layout: "bad",
    filenameMode: "template",
    filenameTemplate: " {date}/{title} ",
    exportVariant: "rendered",
    renderFormat: "webp",
    renderQuality: "250",
    renderSizePreset: "poster",
    renderMaxDimension: "-10",
    videoRenderFormat: "avi",
    videoRenderQuality: "huge",
    contactSheetFormat: "gif",
    contactSheetTitle: "  Proof  Sheet  ",
    contactSheetCaptionPreset: "everything",
    contactSheetPageSize: "tabloid",
    contactSheetLayout: "poster-wall",
    contactSheetColumns: "40",
    contactSheetThumbnailSize: "40",
    contactSheetIncludeCaptions: false,
  }), {
    includeMetadata: true,
    includeXmp: true,
    includeExistingSidecars: false,
    stripLocation: false,
    preserveColorProfile: false,
    targetColorProfile: "none",
    targetColorProfilePath: "",
    shareAfterExport: true,
    layout: "bundle",
    filenameMode: "template",
    filenameTemplate: "{date}/{title}",
    subfolderTemplate: "",
    exportVariant: "rendered",
    renderFormat: "jpeg",
    renderQuality: "100",
    renderSizePreset: "full",
    renderMaxDimension: "0",
    videoRenderFormat: "mp4",
    videoRenderQuality: "medium",
    contactSheetFormat: "pdf",
    contactSheetTitle: "Proof Sheet",
    contactSheetCaptionPreset: "title_date_people",
    contactSheetPageSize: "letter",
    contactSheetLayout: "custom",
    contactSheetColumns: "8",
    contactSheetThumbnailSize: "96",
    contactSheetIncludeCaptions: false,
  });
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ exportVariant: "rendered", renderFormat: "heic" }).renderFormat,
    "heic",
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ shareAfterExport: true }).shareAfterExport,
    true,
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ videoRenderFormat: "webm" }).videoRenderFormat,
    "webm",
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ videoRenderFormat: "hevc" }).videoRenderFormat,
    "hevc",
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ videoRenderFormat: "prores" }).videoRenderFormat,
    "prores",
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ contactSheetLayout: "two_up" }).contactSheetLayout,
    "two_up",
  );
  assert.strictEqual(
    exportPresetsMod.normalizePhotoExportPresetSettings({ renderMaxDimension: "2048" }).renderSizePreset,
    "medium",
  );
  assert.deepStrictEqual(
    {
      preset: exportPresetsMod.normalizePhotoExportPresetSettings({ renderSizePreset: "small", renderMaxDimension: "9999" }).renderSizePreset,
      max: exportPresetsMod.normalizePhotoExportPresetSettings({ renderSizePreset: "small", renderMaxDimension: "9999" }).renderMaxDimension,
    },
    { preset: "small", max: "1024" },
  );
  assert.deepStrictEqual(
    {
      preset: exportPresetsMod.normalizePhotoExportPresetSettings({ renderSizePreset: "custom", renderMaxDimension: "3456" }).renderSizePreset,
      max: exportPresetsMod.normalizePhotoExportPresetSettings({ renderSizePreset: "custom", renderMaxDimension: "3456" }).renderMaxDimension,
    },
    { preset: "custom", max: "3456" },
  );
  assert.strictEqual(exportPresetsMod.photoExportSizePresetMaxDimension("custom", "22000"), "20000");
});

run("photo export preset settings preserve wide gamut profile targets", () => {
  const displayP3 = exportPresetsMod.normalizePhotoExportPresetSettings({
    preserveColorProfile: true,
    targetColorProfile: "display-p3",
  });
  assert.strictEqual(displayP3.preserveColorProfile, true);
  assert.strictEqual(displayP3.targetColorProfile, "display-p3");

  const adobeRgb = exportPresetsMod.normalizePhotoExportPresetSettings({
    preserveColorProfile: true,
    targetColorProfile: "adobe-rgb",
  });
  assert.strictEqual(adobeRgb.preserveColorProfile, true);
  assert.strictEqual(adobeRgb.targetColorProfile, "adobe-rgb");

  const customIcc = exportPresetsMod.normalizePhotoExportPresetSettings({
    preserveColorProfile: true,
    targetColorProfile: "custom-icc",
    targetColorProfilePath: " /Users/me/Profiles/Fine Art.icc ",
  });
  assert.strictEqual(customIcc.preserveColorProfile, true);
  assert.strictEqual(customIcc.targetColorProfile, "custom-icc");
  assert.strictEqual(customIcc.targetColorProfilePath, "/Users/me/Profiles/Fine Art.icc");

  const inactivePath = exportPresetsMod.normalizePhotoExportPresetSettings({
    preserveColorProfile: true,
    targetColorProfile: "display-p3",
    targetColorProfilePath: "/Users/me/Profiles/Fine Art.icc",
  });
  assert.strictEqual(inactivePath.targetColorProfilePath, "");
});

run("photo project bundle preset preserves originals, metadata, and source folders", () => {
  assert.deepStrictEqual(exportPresetsMod.photoProjectBundlePresetSettings(), {
    includeMetadata: true,
    includeXmp: true,
    includeExistingSidecars: true,
    stripLocation: false,
    preserveColorProfile: true,
    targetColorProfile: "source",
    targetColorProfilePath: "",
    shareAfterExport: false,
    layout: "bundle",
    filenameMode: "original",
    filenameTemplate: "{original}",
    subfolderTemplate: "{sourceFolder}",
    exportVariant: "original",
    renderFormat: "jpeg",
    renderQuality: "92",
    renderSizePreset: "full",
    renderMaxDimension: "0",
    videoRenderFormat: "mp4",
    videoRenderQuality: "medium",
    contactSheetFormat: "pdf",
    contactSheetTitle: "",
    contactSheetCaptionPreset: "title_date_people",
    contactSheetPageSize: "letter",
    contactSheetLayout: "custom",
    contactSheetColumns: "4",
    contactSheetThumbnailSize: "220",
    contactSheetIncludeCaptions: true,
  });
});

run("photo creation export presets configure wallpaper collage and poster outputs", () => {
  assert.deepStrictEqual(
    exportPresetsMod.PHOTO_CREATION_EXPORT_PRESETS.map((preset) => preset.kind),
    ["wallpaper", "collage", "poster"],
  );
  const wallpaper = exportPresetsMod.photoCreationExportPresetSettings("wallpaper");
  assert.strictEqual(wallpaper.exportVariant, "rendered");
  assert.strictEqual(wallpaper.renderFormat, "jpeg");
  assert.strictEqual(wallpaper.renderSizePreset, "custom");
  assert.strictEqual(wallpaper.renderMaxDimension, "3840");
  assert.strictEqual(wallpaper.filenameTemplate, "{title}-wallpaper");
  assert.strictEqual(wallpaper.subfolderTemplate, "Wallpapers");
  assert.strictEqual(wallpaper.stripLocation, true);
  assert.strictEqual(wallpaper.preserveColorProfile, true);
  assert.strictEqual(wallpaper.targetColorProfile, "source");

  const collage = exportPresetsMod.photoCreationExportPresetSettings("collage");
  assert.strictEqual(collage.renderSizePreset, "large");
  assert.strictEqual(collage.renderMaxDimension, "4096");
  assert.strictEqual(collage.contactSheetFormat, "jpeg");
  assert.strictEqual(collage.contactSheetTitle, "Collage");
  assert.strictEqual(collage.contactSheetCaptionPreset, "filename");
  assert.strictEqual(collage.contactSheetLayout, "custom");
  assert.strictEqual(collage.contactSheetColumns, "3");
  assert.strictEqual(collage.contactSheetThumbnailSize, "320");
  assert.strictEqual(collage.filenameTemplate, "{date}-collage");
  assert.strictEqual(collage.contactSheetIncludeCaptions, false);

  const poster = exportPresetsMod.photoCreationExportPresetSettings("poster");
  assert.strictEqual(poster.renderQuality, "100");
  assert.strictEqual(poster.renderSizePreset, "custom");
  assert.strictEqual(poster.renderMaxDimension, "6000");
  assert.strictEqual(poster.videoRenderFormat, "mp4");
  assert.strictEqual(poster.contactSheetPageSize, "a4");
  assert.strictEqual(poster.contactSheetCaptionPreset, "metadata");
  assert.strictEqual(poster.contactSheetLayout, "custom");
  assert.strictEqual(poster.filenameTemplate, "{title}-poster");
  assert.strictEqual(poster.subfolderTemplate, "Posters");
  assert.strictEqual(poster.videoRenderQuality, "high");
});

run("photo creation export suggestions rank local crop safe candidates", () => {
  const suggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
    {
      sourcePath: "/photos/beach.jpg",
      previewUrl: "asset://beach-preview",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.9,
      favorite: true,
      people: [{ personName: "Alice" }],
    },
    {
      sourcePath: "/photos/portrait.jpg",
      mediaKind: "image",
      width: 2400,
      height: 3600,
      quality: 0.92,
      people: [{ personName: "Bob" }],
    },
    {
      sourcePath: "/photos/family.jpg",
      mediaKind: "image",
      width: 2500,
      height: 1800,
      quality: 0.88,
      people: [{ personName: "Alice" }],
    },
    {
      sourcePath: "/photos/group.jpg",
      mediaKind: "image",
      assetMetadata: { dimensions: { width: 2000, height: 1500 } },
      quality: 0.86,
    },
    {
      sourcePath: "/photos/hidden.jpg",
      mediaKind: "image",
      width: 4000,
      height: 2400,
      quality: 1,
      hidden: true,
    },
    {
      sourcePath: "/photos/clip.mov",
      mediaKind: "video",
      width: 3840,
      height: 2160,
      quality: 1,
    },
  ], { favoritePeople: ["Alice", "Bob"], maxCollageItems: 4 });

  const wallpaper = suggestions.find((suggestion) => suggestion.kind === "wallpaper");
  const collage = suggestions.find((suggestion) => suggestion.kind === "collage");
  const poster = suggestions.find((suggestion) => suggestion.kind === "poster");
  assert.deepStrictEqual(wallpaper?.sourcePaths, ["/photos/beach.jpg"]);
  assert.strictEqual(wallpaper?.coverPreviewUrl, "asset://beach-preview");
  assert.strictEqual(wallpaper?.cropPreview?.safe, true);
  assert.strictEqual(wallpaper?.cropPreview?.label, "16:9 safe");
  assert.strictEqual(wallpaper?.cropPreview?.detail, "16:9 source · 0% trim");
  assert.ok(wallpaper?.reasons.includes("Landscape crop"));
  assert.deepStrictEqual(poster?.sourcePaths, ["/photos/portrait.jpg"]);
  assert.strictEqual(poster?.cropPreview?.label, "2:3 safe");
  assert.ok(poster?.reasons.includes("Portrait crop"));
  assert.strictEqual(collage?.sourcePaths.length, 4);
  assert.strictEqual(collage?.cropPreview, undefined);
  assert.ok(collage?.reasons.includes("4 photos"));
  assert.ok(!collage?.sourcePaths.includes("/photos/hidden.jpg"));
  assert.ok(!collage?.sourcePaths.includes("/photos/clip.mov"));
  assert.strictEqual(collage?.settings.contactSheetColumns, "3");
});

run("photo creation export suggestions score pet metadata and favorite pet names", () => {
  const suggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
    {
      sourcePath: "/photos/milo.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.86,
      keywords: ["Milo"],
      assetMetadata: { labels: [{ name: "dog" }] },
    },
    {
      sourcePath: "/photos/non-pet.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.9,
    },
    {
      sourcePath: "/photos/cat.jpg",
      mediaKind: "image",
      width: 2400,
      height: 1800,
      quality: 0.86,
      assetMetadata: { detectedItems: ["cat"] },
    },
  ], { favoritePets: ["Milo"], maxCollageItems: 3 });

  const wallpaper = suggestions.find((suggestion) => suggestion.kind === "wallpaper");
  const collage = suggestions.find((suggestion) => suggestion.kind === "collage");
  assert.deepStrictEqual(wallpaper?.sourcePaths, ["/photos/milo.jpg"]);
  assert.ok(wallpaper?.reasons.includes("Favorite pets"));
  assert.ok(collage?.reasons.includes("Favorite pets"));

  const genericPetSuggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
    {
      sourcePath: "/photos/cat.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.86,
      assetMetadata: { detectedItems: ["cat"] },
    },
    {
      sourcePath: "/photos/plain.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.86,
    },
  ]);
  const genericWallpaper = genericPetSuggestions.find((suggestion) => suggestion.kind === "wallpaper");
  assert.ok(genericWallpaper?.reasons.includes("Pets"));
});

run("photo creation export suggestions score memory context sources", () => {
  const suggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
    {
      sourcePath: "/photos/plain.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.9,
    },
    {
      sourcePath: "/photos/memory.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.82,
    },
    {
      sourcePath: "/photos/memory-two.jpg",
      mediaKind: "image",
      width: 2400,
      height: 1800,
      quality: 0.82,
    },
  ], { memoryContextSourcePaths: ["/photos/memory.jpg", "/photos/memory-two.jpg"], maxCollageItems: 3 });

  const wallpaper = suggestions.find((suggestion) => suggestion.kind === "wallpaper");
  const collage = suggestions.find((suggestion) => suggestion.kind === "collage");
  assert.deepStrictEqual(wallpaper?.sourcePaths, ["/photos/memory.jpg"]);
  assert.ok(wallpaper?.reasons.includes("Memory context"));
  assert.ok(collage?.reasons.includes("Memory context"));
});

run("photo creation suggestion cache normalizes persisted library snapshots", () => {
  const signature = exportPresetsMod.buildPhotoCreationSuggestionCacheSignature({
    sourceCount: 2,
    favoritePeople: ["Alice", "alice"],
  });
  const suggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
    {
      sourcePath: "/photos/library-wallpaper.jpg",
      mediaKind: "image",
      width: 3840,
      height: 2160,
      quality: 0.9,
      favorite: true,
      people: [{ personName: "Alice" }],
    },
    {
      sourcePath: "/photos/library-poster.jpg",
      mediaKind: "image",
      width: 2400,
      height: 3600,
      quality: 0.88,
    },
  ], { favoritePeople: ["Alice"], maxCollageItems: 2 });
  const cache = exportPresetsMod.buildPhotoCreationSuggestionCacheRecord({
    signature,
    sourceCount: 2,
    suggestions,
    generatedAt: "2026-06-25T00:00:00.000Z",
  });

  assert.strictEqual(signature, "v1|sources:2|people:alice|pets:");
  assert.strictEqual(cache?.sourceCount, 2);
  assert.strictEqual(cache?.suggestions.length, 3);
  assert.deepStrictEqual(cache?.suggestions[0].sourcePaths, ["/photos/library-wallpaper.jpg"]);
  assert.strictEqual(
    exportPresetsMod.normalizePhotoCreationSuggestionCache(cache, signature)?.generatedAt,
    "2026-06-25T00:00:00.000Z",
  );
  assert.strictEqual(exportPresetsMod.normalizePhotoCreationSuggestionCache(cache, "v1|sources:9|people:alice|pets:"), null);

  const repaired = exportPresetsMod.normalizePhotoCreationSuggestionCache({
    signature,
    sourceCount: "2",
    suggestions: [
      { kind: "wallpaper", label: "", sourcePaths: ["/photos/a.jpg", ""], score: "80", reasons: [], settings: { renderQuality: "500" } },
      { kind: "collage", sourcePaths: [], score: 90 },
    ],
  }, signature);
  assert.strictEqual(repaired?.suggestions.length, 1);
  assert.strictEqual(repaired?.suggestions[0].label, "Suggested wallpaper");
  assert.strictEqual(repaired?.suggestions[0].settings.renderQuality, "100");
  assert.strictEqual(
    exportPresetsMod.photoCreationSuggestionCacheIsFresh(cache, "2026-06-25T12:00:00.000Z"),
    true,
  );
  assert.strictEqual(
    exportPresetsMod.photoCreationSuggestionCacheIsFresh(cache, "2026-06-27T00:00:00.000Z"),
    false,
  );
  assert.strictEqual(
    exportPresetsMod.photoCreationSuggestionCacheIsFresh(cache, "2026-06-24T23:59:00.000Z"),
    false,
  );
  const firstFailure = exportPresetsMod.buildPhotoCreationSuggestionRefreshFailureState({
    signature,
    now: "2026-06-25T00:00:00.000Z",
    error: "network\n timeout ".repeat(20),
  });
  assert.strictEqual(firstFailure?.status, "failed");
  assert.strictEqual(firstFailure?.attempts, 1);
  assert.strictEqual(firstFailure?.nextRetryAt, "2026-06-25T00:05:00.000Z");
  assert.ok((firstFailure?.lastError || "").length <= 180);
  assert.strictEqual(
    exportPresetsMod.photoCreationSuggestionRefreshCanRun(firstFailure, "2026-06-25T00:04:59.000Z"),
    false,
  );
  assert.strictEqual(
    exportPresetsMod.photoCreationSuggestionRefreshCanRun(firstFailure, "2026-06-25T00:05:00.000Z"),
    true,
  );
  const secondFailure = exportPresetsMod.buildPhotoCreationSuggestionRefreshFailureState({
    signature,
    previous: firstFailure,
    now: "2026-06-25T00:05:00.000Z",
    error: "still failing",
  });
  assert.strictEqual(secondFailure?.attempts, 2);
  assert.strictEqual(secondFailure?.nextRetryAt, "2026-06-25T00:15:00.000Z");
  const success = exportPresetsMod.buildPhotoCreationSuggestionRefreshSuccessState({
    signature,
    previous: secondFailure,
    now: "2026-06-25T00:15:00.000Z",
  });
  assert.strictEqual(success?.status, "success");
  assert.strictEqual(success?.attempts, 0);
  assert.strictEqual(success?.nextRetryAt, undefined);
  assert.strictEqual(exportPresetsMod.normalizePhotoCreationSuggestionRefreshState(firstFailure, "wrong"), null);
});

run("photo export presets upsert by name and delete by id", () => {
  const firstSettings = exportPresetsMod.normalizePhotoExportPresetSettings({
    includeMetadata: true,
    filenameMode: "original",
  });
  const secondSettings = exportPresetsMod.normalizePhotoExportPresetSettings({
    includeXmp: true,
    layout: "flat",
  });
  const first = exportPresetsMod.upsertPhotoExportPreset([], {
    name: "Archive",
    settings: firstSettings,
    now: "2026-06-21T00:00:00.000Z",
  });
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].name, "Archive");
  assert.strictEqual(first[0].settings.includeMetadata, true);
  const updated = exportPresetsMod.upsertPhotoExportPreset(first, {
    name: "archive",
    settings: secondSettings,
    now: "2026-06-21T01:00:00.000Z",
  });
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].id, first[0].id);
  assert.strictEqual(updated[0].settings.includeXmp, true);
  assert.strictEqual(updated[0].settings.layout, "flat");
  const withSecond = exportPresetsMod.upsertPhotoExportPreset(updated, {
    name: "Web",
    settings: firstSettings,
    now: "2026-06-21T02:00:00.000Z",
  });
  assert.strictEqual(withSecond.length, 2);
  const collision = exportPresetsMod.upsertPhotoExportPreset(withSecond, {
    id: updated[0].id,
    name: "Web",
    settings: firstSettings,
    now: "2026-06-21T03:00:00.000Z",
  });
  assert.strictEqual(collision.length, 2);
  assert.strictEqual(collision.find((preset) => preset.id === updated[0].id)?.name, "archive");
  assert.strictEqual(collision.find((preset) => preset.name === "Web")?.settings.includeMetadata, true);
  assert.deepStrictEqual(exportPresetsMod.deletePhotoExportPreset(updated, updated[0].id), []);
});

run("photo import access guidance detects Photos libraries and protected paths", () => {
  const guidance = importAccessMod.buildPhotoImportAccessGuidance([
    { path: "/Users/alice/Pictures/Photos Library.photoslibrary", isDir: true },
    { path: "/Users/alice/Documents/Vacation", isDir: true },
  ]);
  assert.deepStrictEqual(guidance.map((item) => item.code), [
    "apple-photos-library-package",
    "os-protected-folder",
  ]);
  assert.strictEqual(guidance[0].path, "/Users/alice/Pictures/Photos Library.photoslibrary");
  assert.deepStrictEqual(importAccessMod.buildPhotoImportAccessGuidance([{ path: "/Volumes/Camera/DCIM/IMG_0001.JPG" }]), []);
  const cameraReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Volumes/CAMERA/DCIM/100APPLE/IMG_0001.JPG" },
  ], "Dropped files");
  assert.strictEqual(cameraReview.inferredSourceKind, "camera");
  assert.strictEqual(cameraReview.deviceLike, true);
  assert.strictEqual(cameraReview.reviewTitle, "Device import review");
  assert.strictEqual(cameraReview.deleteFromSourceSupported, false);
  assert.ok(cameraReview.hints.includes("DCIM"));
  const downloadsReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Downloads/photo.jpg" },
  ], "Dropped files");
  assert.strictEqual(downloadsReview.inferredSourceKind, "downloads");
  assert.strictEqual(downloadsReview.sourceLabel, "Downloads");
  const mailReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/letter/photo.jpg" },
  ], "Dropped files");
  assert.strictEqual(mailReview.inferredSourceKind, "mail");
  assert.strictEqual(mailReview.sourceLabel, "Mail");
  assert.strictEqual(mailReview.reviewDetail, "These files appear to come from Mail.");
  const safariReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Library/Containers/com.apple.Safari/Data/Downloads/web-photo.jpg" },
  ], "Dropped files");
  assert.strictEqual(safariReview.inferredSourceKind, "safari");
  assert.strictEqual(safariReview.sourceLabel, "Safari");
  const messagesReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Library/Messages/Attachments/thread/photo.heic" },
  ], "Dropped files");
  assert.strictEqual(messagesReview.inferredSourceKind, "messages");
  assert.strictEqual(messagesReview.sourceLabel, "Messages");
  const airDropReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Downloads/AirDrop/photo.png" },
  ], "Dropped files");
  assert.strictEqual(airDropReview.inferredSourceKind, "airdrop");
  assert.strictEqual(airDropReview.sourceLabel, "AirDrop");
  const appReview = importAccessMod.buildPhotoImportReviewSummary([
    { path: "/Users/alice/Library/Mobile Documents/com~apple~CloudDocs/Shared/photo.png" },
  ], "Dropped files");
  assert.strictEqual(appReview.inferredSourceKind, "app");
  assert.strictEqual(appReview.sourceLabel, "Other app");
  const explicitAttribution = importAccessMod.buildPhotoImportAttributionSummary([
    {
      path: "/Users/alice/Library/Containers/com.readdle.smartemail-Mac/Data/photo.jpg",
      sourceKind: "mail",
      sourceLabel: "Spark Mail",
      sourceDetail: "Sender: taylor@example.test | Source URL: mail-message-42",
    },
  ], "Dropped files");
  assert.strictEqual(explicitAttribution.sourceKind, "mail");
  assert.strictEqual(explicitAttribution.sourceLabel, "Spark Mail");
  assert.strictEqual(explicitAttribution.sourceDetail, "Sender: taylor@example.test | Source URL: mail-message-42");
  const generatedAttribution = importAccessMod.buildPhotoImportAttributionSummary([
    { path: "/Users/alice/Library/Messages/Attachments/thread/photo.heic" },
  ], "Dropped files");
  assert.strictEqual(generatedAttribution.sourceKind, "messages");
  assert.strictEqual(generatedAttribution.sourceLabel, "Messages");
  assert.ok(generatedAttribution.sourceDetail.includes("Messages"));
  const mixedAttribution = importAccessMod.buildPhotoImportAttributionSummary([
    { path: "/Users/alice/Library/Containers/com.apple.mail/Data/Library/Mail Downloads/message-1/photo.jpg" },
    { path: "/Users/alice/Library/Containers/com.apple.Safari/Data/Downloads/web-photo.jpg" },
  ], "Dropped files");
  assert.strictEqual(mixedAttribution.sourceKind, "app");
  assert.strictEqual(mixedAttribution.sourceLabel, "Other app");
  assert.ok(mixedAttribution.sourceDetail.includes("Mail Downloads"));
  assert.ok(mixedAttribution.sourceDetail.includes("Safari Downloads"));
  const mixedDeviceAttribution = importAccessMod.buildPhotoImportAttributionSummary([
    { path: "/Volumes/CAMERA/DCIM/100APPLE/IMG_0001.JPG" },
    { path: "/Users/alice/Downloads/card-copy.jpg" },
  ], "Dropped files");
  assert.strictEqual(mixedDeviceAttribution.sourceKind, "camera");
  assert.strictEqual(mixedDeviceAttribution.sourceLabel, "Camera/device import");
  assert.ok(mixedDeviceAttribution.sourceDetail.includes("DCIM"));
  assert.strictEqual(importAccessMod.photoImportSourceKindForSystemSource({
    id: "apple-photos-originals",
    kind: "apple-photos",
    label: "Apple Photos originals",
    path: "/Users/alice/Pictures/Photos Library.photoslibrary/originals",
  }), "library");
  assert.strictEqual(importAccessMod.photoImportSourceKindForSystemSource({
    id: "windows-camera-roll",
    label: "Camera Roll",
    path: "C:/Users/Alice/Pictures/Camera Roll",
  }), "camera");
  assert.strictEqual(importAccessMod.photoImportSourceKindForSystemSource({
    id: "mounted-camera-pixel-8-internal-shared-storage-dcim",
    label: "Pixel 8 Internal shared storage/DCIM",
    detail: "Mounted camera, phone, or SD-card media folder inside Internal shared storage.",
    path: "/Volumes/Pixel 8/Internal shared storage/DCIM",
  }), "camera");
  assert.strictEqual(importAccessMod.photoImportSourceKindForSystemSource({
    id: "downloads",
    label: "Downloads",
    path: "/Users/alice/Downloads",
  }), "downloads");
  assert.strictEqual(importAccessMod.photoImportSourceKindForSystemSource({
    id: "icloud-drive",
    label: "iCloud Drive",
    path: "/Users/alice/Library/Mobile Documents/com~apple~CloudDocs",
  }), "app");
  const suggestedRows = importAccessMod.buildPhotoImportSystemSourceRows([
    {
      id: "mounted-camera-pixel-8-internal-shared-storage-dcim",
      label: "Pixel 8 Internal shared storage/DCIM",
      detail: "Mounted camera, phone, or SD-card media folder inside Internal shared storage.",
      path: "/Volumes/Pixel 8/Internal shared storage/DCIM",
      available: true,
    },
    {
      id: "apple-photos-library",
      label: "Apple Photos library",
      detail: "Search the Photos library package.",
      path: "/Users/alice/Pictures/Photos Library.photoslibrary",
      kind: "apple-photos",
      available: false,
    },
  ]);
  assert.strictEqual(suggestedRows[0].sourceKind, "camera");
  assert.strictEqual(suggestedRows[0].kindLabel, "Camera/device");
  assert.strictEqual(suggestedRows[0].available, true);
  assert.strictEqual(suggestedRows[0].deviceLike, true);
  assert.strictEqual(suggestedRows[0].deleteFromSourceSupported, false);
  assert.ok(suggestedRows[0].badges.includes("Device/card"));
  assert.ok(suggestedRows[0].safetyDetail.includes("Delete after import is unavailable"));
  assert.strictEqual(suggestedRows[1].sourceKind, "library");
  assert.strictEqual(suggestedRows[1].available, false);
  assert.ok(suggestedRows[1].badges.includes("Unavailable"));
  assert.ok(suggestedRows[1].badges.includes("Library"));
});

run("photo import album target resolves final imported paths and labels", () => {
  assert.strictEqual(importAlbumTargetMod.photoImportAlbumTargetNeedsName(importAlbumTargetMod.PHOTO_IMPORT_NEW_ALBUM_TARGET), true);
  assert.strictEqual(importAlbumTargetMod.photoImportAlbumTargetLabel("", "", []), "No album");
  assert.strictEqual(
    importAlbumTargetMod.photoImportAlbumTargetLabel(importAlbumTargetMod.PHOTO_IMPORT_NEW_ALBUM_TARGET, " Camera Roll Picks ", []),
    "Camera Roll Picks"
  );
  assert.strictEqual(
    importAlbumTargetMod.photoImportAlbumTargetLabel("album-2", "", [{ id: "album:album-1", name: "One" }, { albumId: "album-2", name: "Two" }]),
    "Two"
  );
  assert.deepStrictEqual(
    importAlbumTargetMod.photoImportResultFinalSourcePaths({
      importedPaths: ["/managed/a.jpg", "/managed/a.jpg", " "],
      assets: [{ sourcePath: "/asset/a.jpg" }],
      sourcePaths: ["/source/a.jpg"],
    }),
    ["/managed/a.jpg"]
  );
  assert.deepStrictEqual(
    importAlbumTargetMod.photoImportResultFinalSourcePaths({
      importedPaths: [],
      assets: [{ sourcePath: "/asset/a.jpg" }, { sourcePath: "/asset/b.jpg" }],
      sourcePaths: ["/source/a.jpg"],
    }),
    ["/asset/a.jpg", "/asset/b.jpg"]
  );
  assert.deepStrictEqual(
    importAlbumTargetMod.photoImportResultFinalSourcePaths({
      sourcePaths: ["/source/a.jpg", "/source/a.jpg"],
    }),
    []
  );
});

run("photo import session details summarize source storage and metadata", () => {
  assert.strictEqual(importSessionDetailsMod.photoImportSessionSourceKindLabel("camera"), "Camera/device");
  assert.strictEqual(importSessionDetailsMod.photoImportSessionSourceKindLabel("browser"), "Safari");
  assert.strictEqual(importSessionDetailsMod.photoImportSessionStorageLabel("managed"), "Copy into library");
  assert.strictEqual(importSessionDetailsMod.photoImportSessionStatusLabel("completed_with_errors"), "Completed with errors");
  const summary = importSessionDetailsMod.buildPhotoImportSessionSummary({
    importId: "import-1",
    sourceKind: "downloads",
    storageMode: "referenced",
    sourceLabel: " Downloads ",
    rootPath: "/Users/alice/Downloads",
    status: "completed_with_errors",
    startedAt: "2026-06-26T10:00:00Z",
    completedAt: "2026-06-26T10:01:00Z",
    updatedAt: "2026-06-26T10:01:00Z",
    importedCount: 2,
    failedCount: 1,
    metadata: {
      sourceDetail: "Newsletter from Mina",
      requestedPathCount: 3,
      expandedFileCount: 4,
      duplicateInputs: 1,
      keepFolderOrganization: true,
    },
  });
  assert.strictEqual(summary.sourceLabel, "Downloads");
  assert.strictEqual(summary.sourceDetail, "Newsletter from Mina");
  assert.strictEqual(summary.sourceKindLabel, "Downloads");
  assert.strictEqual(summary.storageLabel, "Reference originals");
  assert.strictEqual(summary.statusLabel, "Completed with errors");
  assert.strictEqual(summary.importedCount, 2);
  assert.strictEqual(summary.failedCount, 1);
  assert.deepStrictEqual(
    summary.details.map((detail) => [detail.key, detail.value]),
    [
      ["source", "Downloads"],
      ["sourceDetail", "Newsletter from Mina"],
      ["kind", "Downloads"],
      ["storage", "Reference originals"],
      ["status", "Completed with errors"],
      ["root", "/Users/alice/Downloads"],
      ["requested", "3"],
      ["expanded", "4"],
      ["duplicates", "1"],
      ["folderOrganization", "Kept"],
    ]
  );
  assert.strictEqual(importSessionDetailsMod.buildPhotoImportSessionSummary(null), null);
});

run("photo import session history dedupes sorts and limits sessions", () => {
  const sessions = importSessionDetailsMod.buildPhotoImportSessionSummaries([
    {
      importId: "older",
      sourceKind: "folder",
      storageMode: "managed",
      sourceLabel: "Folder import",
      rootPath: "/photos/old",
      status: "completed",
      startedAt: "2026-06-24T10:00:00Z",
      completedAt: "2026-06-24T10:01:00Z",
      updatedAt: "2026-06-24T10:01:00Z",
      importedCount: 4,
      failedCount: 0,
    },
    null,
    {
      importId: "newer",
      sourceKind: "camera",
      storageMode: "referenced",
      sourceLabel: "Camera roll",
      rootPath: "/Volumes/CAMERA/DCIM",
      status: "completed_with_errors",
      startedAt: "2026-06-26T10:00:00Z",
      completedAt: "2026-06-26T10:03:00Z",
      updatedAt: "2026-06-26T10:03:00Z",
      importedCount: 2,
      failedCount: 1,
    },
    {
      importId: "newer",
      sourceKind: "downloads",
      storageMode: "managed",
      sourceLabel: "Duplicate should be ignored",
      rootPath: "/Downloads",
      status: "completed",
      startedAt: "2026-06-27T10:00:00Z",
      completedAt: "2026-06-27T10:01:00Z",
      updatedAt: "2026-06-27T10:01:00Z",
      importedCount: 99,
      failedCount: 0,
    },
  ], 1);
  assert.deepStrictEqual(sessions.map((session) => session.importId), ["newer"]);
  assert.strictEqual(sessions[0].sourceLabel, "Camera roll");
  assert.strictEqual(sessions[0].sourceKindLabel, "Camera/device");
  assert.strictEqual(sessions[0].failedCount, 1);
});

run("photo import session history filters by query status storage and source", () => {
  const sessions = importSessionDetailsMod.buildPhotoImportSessionSummaries([
    {
      importId: "mail-errors",
      sourceKind: "mail",
      storageMode: "referenced",
      sourceLabel: "Mail import",
      sourceDetail: "Newsletter from Mina",
      rootPath: "/Users/alice/Downloads/newsletter",
      status: "completed_with_errors",
      startedAt: "2026-06-26T10:00:00Z",
      completedAt: "2026-06-26T10:02:00Z",
      updatedAt: "2026-06-26T10:02:00Z",
      importedCount: 2,
      failedCount: 1,
    },
    {
      importId: "camera-running",
      sourceKind: "phone",
      storageMode: "referenced",
      sourceLabel: "Camera roll",
      sourceDetail: "Trip card",
      rootPath: "/Volumes/CAMERA/DCIM",
      status: "running",
      startedAt: "2026-06-26T11:00:00Z",
      updatedAt: "2026-06-26T11:01:00Z",
      importedCount: 8,
      failedCount: 0,
    },
    {
      importId: "managed-done",
      sourceKind: "folder",
      storageMode: "managed",
      sourceLabel: "Trip folder",
      sourceDetail: "June archive",
      rootPath: "/Users/alice/Pictures/Trip",
      status: "completed",
      startedAt: "2026-06-25T09:00:00Z",
      completedAt: "2026-06-25T09:10:00Z",
      updatedAt: "2026-06-25T09:10:00Z",
      importedCount: 12,
      failedCount: 0,
    },
    {
      importId: "hard-failed",
      sourceKind: "downloads",
      storageMode: "managed",
      sourceLabel: "Downloads",
      rootPath: "/Users/alice/Downloads",
      status: "failed",
      startedAt: "2026-06-24T09:00:00Z",
      updatedAt: "2026-06-24T09:01:00Z",
      importedCount: 0,
      failedCount: 3,
    },
  ], 10);
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { query: "mina mail" }).map((session) => session.importId),
    ["mail-errors"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { sourceKind: "camera" }).map((session) => session.importId),
    ["camera-running"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { storage: "managed" }).map((session) => session.importId),
    ["managed-done", "hard-failed"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { status: "issues" }).map((session) => session.importId),
    ["mail-errors", "hard-failed"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { status: "completed" }).map((session) => session.importId),
    ["managed-done"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { query: "trip archive", storage: "managed", status: "completed" }).map((session) => session.importId),
    ["managed-done"]
  );
});

run("photo import session history hides archived rows until requested", () => {
  const sessions = importSessionDetailsMod.buildPhotoImportSessionSummaries([
    {
      importId: "active-import",
      sourceKind: "folder",
      storageMode: "referenced",
      sourceLabel: "Active import",
      rootPath: "/photos/active",
      status: "completed",
      startedAt: "2026-06-27T10:00:00Z",
      completedAt: "2026-06-27T10:02:00Z",
      updatedAt: "2026-06-27T10:02:00Z",
      importedCount: 2,
      failedCount: 0,
    },
    {
      importId: "archived-import",
      sourceKind: "mail",
      storageMode: "managed",
      sourceLabel: "Archived import",
      rootPath: "/photos/archive",
      status: "completed",
      startedAt: "2026-06-26T10:00:00Z",
      completedAt: "2026-06-26T10:02:00Z",
      updatedAt: "2026-06-26T10:02:00Z",
      importedCount: 5,
      failedCount: 0,
      archived: true,
      archivedAt: "2026-06-28T12:00:00Z",
      archivedReason: "Clean history",
    },
  ], 10);
  assert.strictEqual(sessions.find((session) => session.importId === "archived-import").archived, true);
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions).map((session) => session.importId),
    ["active-import"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { showArchived: true }).map((session) => session.importId),
    ["active-import", "archived-import"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { showArchived: true, query: "clean history" }).map((session) => session.importId),
    ["archived-import"]
  );
  assert.deepStrictEqual(
    sessions.find((session) => session.importId === "archived-import").details
      .filter((detail) => detail.key === "archived" || detail.key === "archiveReason")
      .map((detail) => [detail.key, detail.value]),
    [["archived", "2026-06-28T12:00:00Z"], ["archiveReason", "Clean history"]]
  );
});

run("photo import session history filters by active library root", () => {
  const sessions = importSessionDetailsMod.buildPhotoImportSessionSummaries([
    {
      importId: "alpha-managed",
      sourceKind: "folder",
      storageMode: "managed",
      sourceLabel: "Alpha managed import",
      rootPath: "/Users/alice/Desktop/imports",
      metadata: { managedRoot: "/Users/alice/Pictures/Vintrace Alpha/Imports/2026" },
      status: "completed",
      startedAt: "2026-06-27T10:00:00Z",
      completedAt: "2026-06-27T10:04:00Z",
      updatedAt: "2026-06-27T10:04:00Z",
      importedCount: 6,
      failedCount: 0,
    },
    {
      importId: "beta-managed",
      sourceKind: "folder",
      storageMode: "managed",
      sourceLabel: "Beta managed import",
      rootPath: "/Users/alice/Desktop/imports",
      metadata: { managedRoot: "/Users/alice/Pictures/Vintrace Beta/Imports/2026" },
      status: "completed",
      startedAt: "2026-06-26T10:00:00Z",
      completedAt: "2026-06-26T10:04:00Z",
      updatedAt: "2026-06-26T10:04:00Z",
      importedCount: 4,
      failedCount: 0,
    },
    {
      importId: "alpha-referenced",
      sourceKind: "camera",
      storageMode: "referenced",
      sourceLabel: "Alpha referenced import",
      rootPath: "/Users/alice/Pictures/Vintrace Alpha/Referenced",
      status: "completed",
      startedAt: "2026-06-25T10:00:00Z",
      completedAt: "2026-06-25T10:04:00Z",
      updatedAt: "2026-06-25T10:04:00Z",
      importedCount: 3,
      failedCount: 0,
    },
    {
      importId: "alpha-sibling",
      sourceKind: "downloads",
      storageMode: "referenced",
      sourceLabel: "Alphabet sibling import",
      rootPath: "/Users/alice/Pictures/Vintrace Alphabet/Referenced",
      status: "completed",
      startedAt: "2026-06-24T10:00:00Z",
      completedAt: "2026-06-24T10:04:00Z",
      updatedAt: "2026-06-24T10:04:00Z",
      importedCount: 2,
      failedCount: 0,
    },
  ], 10);
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, {
      libraryRoot: "/Users/alice/Pictures/Vintrace Alpha/",
    }).map((session) => session.importId),
    ["alpha-managed", "alpha-referenced"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, {
      libraryRoot: "/users/alice/pictures/vintrace alpha",
      storage: "managed",
    }).map((session) => session.importId),
    ["alpha-managed"]
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, {
      libraryRoot: "/Users/alice/Pictures/Vintrace Beta",
    }).map((session) => session.importId),
    ["beta-managed"]
  );
  assert.strictEqual(
    importSessionDetailsMod.filterPhotoImportSessionSummaries(sessions, { libraryRoot: "" }).length,
    4
  );
});

run("import history provenance and archive controls are wired to backend commands", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(appSource, /archive_photo_import_sessions/);
  assert.match(source, /updatePhotoImportSessionProvenance/);
  assert.match(source, /archivePhotoImportSessions/);
  assert.match(source, /uiText\("Edit import source"\)/);
  assert.match(source, /uiText\("Show archived"\)/);
  assert.match(source, /uiText\("Archive matches"\)/);
  assert.match(source, /uiText\("Restore import"\)/);
  assert.match(source, /uiText\("Edit import source kind"\)/);
  assert.match(source, /uiText\("Edit import source label"\)/);
  assert.match(source, /uiText\("Edit import source detail"\)/);
  assert.match(source, /buildPhotoImportSystemSourceRows\(photoSources\)/);
  assert.match(source, /photo-import-system-source-badges/);
  assert.match(source, /row\.safetyDetail/);
  assert.match(source, /startImportHistoryProvenanceEdit\(session\)/);
  assert.match(source, /saveImportHistoryProvenanceEdit\(session\.importId\)/);
  assert.match(source, /updateImportHistoryArchive\(\[session\.importId\], !session\.archived\)/);
});

run("reverse geocode place lookup is wired through Photos controls", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const viewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(appSource, /reverse_geocode_photo_location/);
  assert.match(appSource, /reverseGeocodePhotoLocation=\{reverseGeocodePhotoLocation\}/);
  assert.match(viewSource, /reverseGeocodePhotoLocation/);
  assert.match(viewSource, /lookupLightboxPlaceName/);
  assert.match(viewSource, /lookupActivePlaceName/);
  assert.match(viewSource, /photoItemGpsCoordinate/);
  assert.match(viewSource, /activePlaceCanLookupName/);
  assert.match(viewSource, /photoSettings\.noNetworkIntelligence/);
  assert.match(viewSource, /uiText\("Look up place name"\)/);
  assert.match(viewSource, /uiText\("Apply place name"\)/);
});

run("photo local settings normalize corrupt saved values", () => {
  assert.deepStrictEqual(settingsMod.normalizePhotoLocalSettings({
    referencedFileWarnings: false,
    stripLocationOnExport: true,
    lockSensitiveCollections: false,
    relockSensitiveCollectionsOnLeave: false,
    sensitiveSessionLockMinutes: 999,
    recentActivityRetentionDays: 99999,
    videoAutoplay: "sound",
    pauseVideoWhenBackgrounded: false,
    hdrViewing: "cinema",
    mediaSettingsByLibraryRoot: {
      "/Users/alice/Pictures/Work": {
        videoAutoplay: "muted",
        pauseVideoWhenBackgrounded: true,
        hdrViewing: "hdr",
      },
      "/Users/alice/Pictures/Bad": {
        videoAutoplay: "turbo",
        pauseVideoWhenBackgrounded: "yes",
        hdrViewing: "cinema",
      },
      "": {
        videoAutoplay: "sound",
      },
    },
    localIntelligenceEnabled: true,
    noNetworkIntelligence: "yes",
    modelSourceDisclosure: false,
    petModelRecognitionEnabled: true,
    backgroundIndexingPaused: true,
    backgroundIndexingAutoRun: "sometimes",
    indexingPowerMode: "turbo",
    railPreferences: {
      showUtilityCollections: false,
      showSensitiveCollections: "yes",
      showScreenshotCollections: false,
      showSharedCollections: true,
      showLowValueCollections: "no",
      pinnedIds: ["all", "all", "", 123],
      collapsedSections: ["utilities", "utilities", ""],
      sectionOrder: ["utilities", "people", "utilities"],
      itemOrder: {
        mediaTypes: ["media:screenshot", "media:screenshot", ""],
        utilities: ["imports"],
        bad: "ignored",
      },
    },
  }), {
    referencedFileWarnings: false,
    stripLocationOnExport: true,
    lockSensitiveCollections: false,
    relockSensitiveCollectionsOnLeave: false,
    sensitiveSessionLockMinutes: 240,
    sensitiveOsAuthEnabled: false,
    sensitivePasscodeEnabled: false,
    sensitivePasscodeSalt: "",
    sensitivePasscodeHash: "",
    recentActivityRetentionDays: 3650,
    videoAutoplay: "sound",
    pauseVideoWhenBackgrounded: false,
    hdrViewing: "auto",
    mediaSettingsByLibraryRoot: {
      "/Users/alice/Pictures/Work": {
        videoAutoplay: "muted",
        pauseVideoWhenBackgrounded: true,
        hdrViewing: "hdr",
      },
    },
    localIntelligenceEnabled: true,
    noNetworkIntelligence: true,
    modelSourceDisclosure: false,
    petModelRecognitionEnabled: true,
    backgroundIndexingPaused: true,
    backgroundIndexingAutoRun: true,
    indexingPowerMode: "balanced",
    railPreferences: {
      showUtilityCollections: false,
      showSensitiveCollections: true,
      showScreenshotCollections: false,
      showSharedCollections: true,
      showLowValueCollections: true,
      pinnedIds: ["all", "123"],
      collapsedSections: ["utilities"],
      sectionOrder: ["utilities", "people"],
      itemOrder: {
        mediaTypes: ["media:screenshot"],
        utilities: ["imports"],
      },
    },
  });
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({}).relockSensitiveCollectionsOnLeave, true);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ relockSensitiveCollectionsOnLeave: "no" }).relockSensitiveCollectionsOnLeave, true);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ sensitiveSessionLockMinutes: 0 }).sensitiveSessionLockMinutes, 0);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ sensitiveSessionLockMinutes: "bad" }).sensitiveSessionLockMinutes, 15);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({}).recentActivityRetentionDays, 30);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ recentActivityRetentionDays: 0 }).recentActivityRetentionDays, 0);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ recentActivityRetentionDays: "bad" }).recentActivityRetentionDays, 30);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ sensitiveOsAuthEnabled: true }).sensitiveOsAuthEnabled, true);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ sensitiveOsAuthEnabled: "yes" }).sensitiveOsAuthEnabled, false);
});

run("photo sensitive session auto-lock is wired through settings", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /sensitiveSessionTimerRef/);
  assert.match(source, /uiText\("Sensitive session lock"\)/);
  assert.match(source, /photoSettings\.sensitiveSessionLockMinutes/);
  assert.match(source, /uiText\("Recent activity"\)/);
  assert.match(source, /photoSettings\.recentActivityRetentionDays/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]{0,120}lockSensitiveCollections\(\);/);
  assert.match(source, /window\.addEventListener\("pointerdown", refreshSensitiveSessionTimer\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
  assert.match(source, /updatePhotoLocalSettings\(\{ sensitiveSessionLockMinutes: Number\(event\.currentTarget\.value\) \}\)/);
  assert.match(source, /updatePhotoLocalSettings\(\{ recentActivityRetentionDays: Number\(event\.currentTarget\.value\) \}\)/);
});

run("photo local settings derive per-library media defaults", () => {
  const settings = settingsMod.normalizePhotoLocalSettings({
    videoAutoplay: "off",
    pauseVideoWhenBackgrounded: true,
    hdrViewing: "auto",
    mediaSettingsByLibraryRoot: {
      "/Users/alice/Pictures/Library A": {
        videoAutoplay: "sound",
        pauseVideoWhenBackgrounded: false,
      },
    },
  });
  const libraryA = settingsMod.photoEffectiveMediaSettings(settings, "/Users/alice/Pictures/Library A");
  assert.strictEqual(libraryA.videoAutoplay, "sound");
  assert.strictEqual(libraryA.pauseVideoWhenBackgrounded, false);
  assert.strictEqual(libraryA.hdrViewing, "auto");
  assert.strictEqual(settingsMod.photoLibraryHasMediaSettingsOverride(settings, "/Users/alice/Pictures/Library A"), true);

  const patched = settingsMod.normalizePhotoLocalSettings({
    ...settings,
    ...settingsMod.photoMediaSettingsOverridePatch(settings, "/Users/alice/Pictures/Library B", {
      videoAutoplay: "muted",
      hdrViewing: "standard",
    }),
  });
  const libraryB = settingsMod.photoEffectiveMediaSettings(patched, "/Users/alice/Pictures/Library B");
  assert.strictEqual(libraryB.videoAutoplay, "muted");
  assert.strictEqual(libraryB.pauseVideoWhenBackgrounded, true);
  assert.strictEqual(libraryB.hdrViewing, "standard");

  const reset = settingsMod.normalizePhotoLocalSettings({
    ...patched,
    ...settingsMod.photoMediaSettingsOverridePatch(patched, "/Users/alice/Pictures/Library B", null),
  });
  assert.strictEqual(settingsMod.photoLibraryHasMediaSettingsOverride(reset, "/Users/alice/Pictures/Library B"), false);
  assert.strictEqual(settingsMod.photoEffectiveMediaSettings(reset, "/Users/alice/Pictures/Library B").videoAutoplay, "off");
});

run("photo hdr display state gates HDR metadata by preference and runtime", () => {
  const hdrMetadata = {
    colorProfile: "Dolby Vision HDR",
    video: {
      transferCharacteristics: "SMPTE ST 2084 PQ",
    },
  };
  const forcedUnavailable = settingsMod.photoHdrDisplayState(
    settingsMod.normalizePhotoLocalSettings({ hdrViewing: "hdr" }),
    hdrMetadata,
    false
  );
  assert.strictEqual(forcedUnavailable.effectiveMode, "standard");
  assert.strictEqual(forcedUnavailable.badgeLabel, "HDR unavailable");
  assert.strictEqual(forcedUnavailable.badgeTone, "warn");
  assert.strictEqual(forcedUnavailable.runtimeHdrAvailable, false);

  const forcedAvailable = settingsMod.photoHdrDisplayState(
    settingsMod.normalizePhotoLocalSettings({ hdrViewing: "hdr" }),
    hdrMetadata,
    true
  );
  assert.strictEqual(forcedAvailable.effectiveMode, "hdr");
  assert.strictEqual(forcedAvailable.badgeLabel, "HDR");
  assert.strictEqual(forcedAvailable.badgeTone, "ok");

  const standard = settingsMod.photoHdrDisplayState(
    settingsMod.normalizePhotoLocalSettings({ hdrViewing: "standard" }),
    hdrMetadata,
    true
  );
  assert.strictEqual(standard.effectiveMode, "standard");
  assert.strictEqual(standard.badgeLabel, "SDR");
  assert.strictEqual(standard.badgeTone, "muted");

  const autoUnavailable = settingsMod.photoHdrDisplayState(
    settingsMod.normalizePhotoLocalSettings({ hdrViewing: "auto" }),
    { image: { colorSpace: "BT.2020 HLG" } },
    false
  );
  assert.strictEqual(autoUnavailable.effectiveMode, "standard");
  assert.strictEqual(autoUnavailable.badgeLabel, "HDR source");
  assert.strictEqual(settingsMod.photoMetadataSuggestsHdr({ image: { colorSpace: "BT.2020 HLG" } }), true);
  assert.strictEqual(settingsMod.photoHdrDisplayState(
    settingsMod.normalizePhotoLocalSettings({ hdrViewing: "hdr" }),
    { colorProfile: "sRGB IEC61966-2.1" },
    true
  ), null);
});

run("photo hdr lightbox state is wired to image and video media", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /PHOTO_HDR_RUNTIME_QUERIES/);
  assert.match(source, /browserAdvertisesPhotoHdr/);
  assert.match(source, /photoHdrDisplayState\(effectivePhotoMediaSettings,\s*lightItem\?\.assetMetadata,\s*photoRuntimeHdrAvailable\)/);
  assert.match(source, /className=\{`photos-lightbox-hdr-badge \$\{lightboxHdrDisplayState\.badgeTone\}`\}/);
  assert.match(source, /<video[\s\S]{0,900}data-hdr-viewing=\{lightboxHdrDisplayState\?\.effectiveMode \|\| "standard"\}/);
  assert.match(source, /<img[\s\S]{0,700}data-hdr-viewing=\{lightboxHdrDisplayState\?\.effectiveMode \|\| "standard"\}/);
});

run("photo indexing queue labels catalog jobs without local intelligence", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /jobKind === "search"[\s\S]{0,120}uiText\("Search index"\)/);
  assert.match(source, /jobKind === "generated_collections"[\s\S]{0,120}uiText\("Generated collections"\)/);
  assert.match(source, /jobKind === "smart_albums"[\s\S]{0,120}uiText\("Smart albums"\)/);
  assert.match(source, /jobKind === "objects"[\s\S]{0,120}uiText\("Detected items"\)/);
  assert.match(source, /photoIndexingHasRunnableCatalogJob/);
  assert.match(source, /photoIndexingHasRetryableCatalogJob/);
  assert.match(source, /photoIndexingCanRunQueuedJobs = photoSettings\.localIntelligenceEnabled \|\| photoIndexingHasRunnableCatalogJob/);
  assert.match(source, /photoIndexingCanRetryFailedJobs = photoSettings\.localIntelligenceEnabled \|\| photoIndexingHasRetryableCatalogJob/);
  assert.match(source, /jobKind === "search" \|\| jobKind === "generated_collections" \|\| jobKind === "smart_albums"/);
  assert.match(source, /enqueuePhotoCatalogIndexingJob\("generated_collections"\)/);
  assert.match(source, /enqueuePhotoCatalogIndexingJob\("smart_albums"\)/);
  assert.match(source, /enqueueLoadedPhotoIndexingJob\("objects"\)/);
  assert.match(source, /enqueuePendingPhotoIndexingJob\("objects"\)/);
  assert.match(source, /runPhotoIndexingQueue\(\{ limit: 8, maxJobs: 1 \}\)/);
  assert.match(source, /\(jobRequiresLocalIntelligence && !photoSettings\.localIntelligenceEnabled\)/);
  assert.doesNotMatch(source, /\|\| !photoSettings\.localIntelligenceEnabled[\s\S]{0,120}aria-label=\{uiText\("Run local indexing queue"\)\}/);
});

run("photo detected item review controls persist object tag review metadata", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /type PhotoObjectTagReviewAction = "confirmed" \| "rejected"/);
  assert.match(source, /function photoObjectTagReviewRows\(item: PhotoItem\)/);
  assert.match(source, /function photoObjectTagReviewPatch\([\s\S]{0,180}action: PhotoObjectTagReviewAction \| "clear"/);
  assert.match(source, /objectTagReview\?: Record<string, unknown>/);
  assert.match(source, /objectTagReview: photoObjectTagReviewPatch\(item, action, row\)/);
  assert.match(source, /aria-label=\{uiText\("Detected item review"\)\}/);
  assert.match(source, /selectedObjectTagRegionId/);
  assert.match(source, /lightItemObjectTagRegionBoxes/);
  assert.match(source, /photos-object-tag-region/);
  assert.match(source, /uiText\("Select detected item region"\)/);
  assert.match(source, /bounds\?: Record<string, unknown>/);
  assert.match(source, /photoObjectTagReviewBoundsPatch/);
  assert.match(source, /const isPercentUnit = unit\.includes\("percent"\) \|\| unit === "%"/);
  assert.match(source, /if \(!isPercentUnit && \(isNormalizedUnit \|\| \(!unit && maxValue <= 1\.5\)\)\)/);
  assert.match(source, /const key = `\$\{photoObjectTagReviewKey\(source, label, boundsKey\)\}:\$\{action\}`/);
  assert.match(source, /const id = `\$\{source\}:\$\{entry\.label\.toLocaleLowerCase\(\)\}:\$\{boundsKey\}:\$\{entry\.action\}:review`/);
  assert.match(source, /visualLookupObjectTagId/);
  assert.match(source, /function openVisualLookupForObjectTag\(row: PhotoObjectTagReviewRow\)/);
  assert.match(source, /function searchVisualLookupObjectTag\(row: PhotoObjectTagReviewRow\)/);
  assert.match(source, /uiText\("Look up detected item"\)/);
  assert.match(source, /uiText\("Visual Look Up"\)/);
  assert.match(source, /uiText\("Search library"\)/);
  assert.match(source, /setSearchQuery\(query\)/);
  assert.match(source, /uiText\("Confirm detected item"\)/);
  assert.match(source, /uiText\("Hide detected item"\)/);
  assert.match(source, /uiText\("Undo detected item review"\)/);
  assert.match(source, /uiText\("Add detected item"\)/);
});

run("photo global search capped groups expose full-photo routing", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(source, /function showAllLibrarySearchGroup\(group: PhotoLibrarySearchGroup\)/);
  assert.match(source, /group\.id === "photos"/);
  assert.match(source, /clearAllPhotoFilters\(\)/);
  assert.match(source, /setActiveId\("all"\)/);
  assert.match(source, /uiText\("Show all Photos"\)/);
  assert.match(source, /photo-global-search-group-actions/);
  assert.match(source, /item\.matchReasons/);
  assert.match(source, /photo-global-search-reasons/);
  assert.match(source, /photo-global-search-overflow/);
  assert.match(source, /handlePhotoSearchKeyDown/);
  assert.match(source, /aria-activedescendant=\{librarySearchActiveDomId\}/);
  assert.match(source, /photo-global-search-item active/);
  assert.match(source, /group\.estimatedTotal/);
  assert.match(typesSource, /matchReasons\?: string\[\]/);
  assert.match(typesSource, /estimatedTotal\?: boolean/);
  assert.match(styles, /\.photo-global-search-reasons/);
  assert.match(styles, /\.photo-global-search-item\.active/);
});

run("photo export color profile status preflights rendered targets", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(typesSource, /interface PhotoColorProfileStatusValue/);
  assert.match(appSource, /"photo_color_profile_status"/);
  assert.match(source, /getPhotoColorProfileStatus/);
  assert.match(source, /Profile availability check failed/);
  assert.match(source, /Profile available/);
  assert.match(source, /Profile unavailable/);
  assert.match(source, /photo-export-profile-preflight/);
  assert.match(source, /ensurePhotoExportColorProfileAvailable\(exportVariant === "rendered"\)/);
  assert.match(source, /ensurePhotoExportColorProfileAvailable\(true\)/);
});

run("managed root profile rename controls persist through settings", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(source, /managedRootRenameDrafts/);
  assert.match(source, /function renameManagedPhotoRootProfile\(profile: PhotoManagedRootProfile, draftName: string\)/);
  assert.match(source, /uiText\("Profile name"\)/);
  assert.match(source, /uiText\("Rename managed root profile"\)/);
  assert.match(source, /managedRootPolicy:[\s\S]{0,240}name: nextName/);
  assert.match(source, /policy: photoManagedRootPolicyDefaults\(profile\)/);
  assert.match(source, /PHOTO_ACTIVE_LIBRARY_ROOT_PROFILE_ID_KEY = "vintrace\.photos\.activeLibraryRootProfileId"/);
  assert.match(source, /activeLibraryRootProfileId/);
  assert.match(source, /function setPhotoLibraryScope\(rootPath: string, profileId = ""\)/);
  assert.match(source, /savePhotoLibrarySettings\(\{ activeLibraryRoot: nextRoot, activeLibraryRootProfileId: nextProfileId \}\)/);
  assert.match(source, /nextProfile\?\.activeLibraryRoot/);
  assert.match(source, /nextProfile\?\.activeLibraryRootProfileId/);
  assert.match(source, /libraryRootProfileRows/);
  assert.match(source, /libraryRootProfileId: requestedLibraryRootProfileId/);
  assert.match(source, /function chooseLibraryViewRoot\(\)/);
  assert.match(source, /function renameLibraryViewRootProfile\(profile: PhotoLibraryRootProfile, draftName: string\)/);
  assert.match(source, /function forgetLibraryViewRootProfile\(profile: PhotoLibraryRootProfile\)/);
  assert.match(source, /uiText\("Library view roots"\)/);
  assert.match(source, /aria-label=\{uiText\("Library view scope"\)\}/);
  assert.match(source, /profile\.assetCount/);
  assert.match(source, /profile\.policyWarnings/);
  assert.match(source, /profile\.rootConflictMessage/);
  assert.match(source, /uiText\("Overlapping root"\)/);
  assert.match(source, /label: `\$\{formatCount\(assetCount\)\} \$\{uiText\(assetCount === 1 \? "photo" : "photos"\)\}`/);
  assert.match(source, /uiText\("Available library folder\."\)/);
  assert.match(source, /libraryRootProfile:/);
  assert.match(source, /forgetLibraryRoot: forgetKey/);
  assert.match(typesSource, /activeLibraryRoot\?: string/);
  assert.match(typesSource, /activeLibraryRootProfileId\?: string/);
  assert.match(typesSource, /assetCount\?: number/);
  assert.match(typesSource, /issue\?: string/);
  assert.match(typesSource, /interface PhotoRootConflictDiagnostics/);
  assert.match(typesSource, /policyWarnings\?: PhotoRootPolicyWarning\[\]/);
  assert.match(typesSource, /rootPolicyStatus\?: PhotoRootPolicyStatus/);
  assert.match(typesSource, /libraryRoots\?: PhotoLibraryRootProfile\[\]/);
});

run("managed import destination selector is wired into import params", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /PHOTO_IMPORT_MANAGED_ROOT_KEY = "vintrace\.photos\.importManagedRoot"/);
  assert.match(source, /importManagedRoot/);
  assert.match(source, /effectiveImportManagedRoot/);
  assert.match(source, /uiText\("Copy destination"\)/);
  assert.match(source, /setImportManagedRootPreference\(event\.currentTarget\.value\)/);
  assert.match(source, /managedRoot: effectiveImportManagedRoot/);
  assert.match(source, /uiText\("Destination"\)[\s\S]{0,80}importManagedRootLabel/);
});

run("Review group finder caps rendered thumbnail results", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(source, /const GROUP_RESULT_RENDER_CAP = 80;/);
  assert.match(source, /const visibleGroupResults = useMemo\(\(\) => groupResults\.slice\(0, GROUP_RESULT_RENDER_CAP\), \[groupResults\]\);/);
  assert.match(source, /const hiddenGroupResultCount = groupResults\.length - visibleGroupResults\.length;/);
  assert.match(source, /\{groupResults\.length \? visibleGroupResults\.map\(\(row\) => \(/);
  assert.match(source, /Copy results for the full list/);
  assert.match(source, /const lines = groupResults\.map\(\(row, index\) => \(/);
  assert.doesNotMatch(source, /\{groupResults\.length \? groupResults\.map\(\(row\) => \(/);
});

run("CandidateTable load-more expansion survives candidate refreshes", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const tableBlock = source.match(/function CandidateTable\([\s\S]*?\nfunction CandidateIdentity/);
  assert.ok(tableBlock, "CandidateTable source block should exist");
  assert.match(tableBlock[0], /useEffect\(\(\) => \{\s*setVisibleLimit\(props\.batchSize\);\s*\}, \[props\.batchSize\]\);/);
  assert.doesNotMatch(tableBlock[0], /\[props\.batchSize, props\.candidates\]/);
  assert.match(tableBlock[0], /props\.candidates\.slice\(0, visibleLimit\)/);
});

await (async () => {
  const record = await settingsMod.createPhotoSensitivePasscodeRecord("4931", "fixedSalt_01");
  const settings = settingsMod.normalizePhotoLocalSettings({
    lockSensitiveCollections: true,
    relockSensitiveCollectionsOnLeave: true,
    ...record,
  });
  assert.strictEqual(settingsMod.photoSensitivePasscodeConfigured(settings), true);
  assert.strictEqual(settings.sensitivePasscodeHash.includes("4931"), false);
  assert.strictEqual(await settingsMod.verifyPhotoSensitivePasscode(settings, "4931"), true);
  assert.strictEqual(await settingsMod.verifyPhotoSensitivePasscode(settings, "0000"), false);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({
    sensitivePasscodeEnabled: true,
    sensitivePasscodeSalt: "short",
    sensitivePasscodeHash: record.sensitivePasscodeHash,
  }).sensitivePasscodeEnabled, false);
  console.log("ok photo local settings hash and verify sensitive passcodes");
})();

run("photo local settings derive autoplay behavior", () => {
  const off = settingsMod.normalizePhotoLocalSettings({ videoAutoplay: "off" });
  const muted = settingsMod.normalizePhotoLocalSettings({ videoAutoplay: "muted" });
  const sound = settingsMod.normalizePhotoLocalSettings({ videoAutoplay: "sound" });
  assert.strictEqual(off.pauseVideoWhenBackgrounded, true);
  assert.strictEqual(settingsMod.normalizePhotoLocalSettings({ pauseVideoWhenBackgrounded: false }).pauseVideoWhenBackgrounded, false);
  assert.strictEqual(settingsMod.shouldAutoplayPhotoVideo(off), false);
  assert.strictEqual(settingsMod.shouldAutoplayPhotoVideo(muted), true);
  assert.strictEqual(settingsMod.shouldMuteAutoplayPhotoVideo(muted), true);
  assert.strictEqual(settingsMod.shouldAutoplayPhotoVideo(sound), true);
  assert.strictEqual(settingsMod.shouldMuteAutoplayPhotoVideo(sound), false);
});

run("buildPhotoManagedRootProfileRows summarizes root coverage", () => {
  const rows = settingsMod.buildPhotoManagedRootProfileRows({
    defaultStorageMode: "managed",
    defaultManagedRoot: "/workspace/photos",
    managedRoots: [
      {
        profileId: "external-root",
        name: "External Archive",
        path: "/Volumes/Archive/Photos",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-20T00:00:00Z",
        isDefault: false,
        policy: {
          keepFolderOrganizationDefault: true,
          externalBackupCovered: true,
          externalBackupLabel: "External disk A",
          externalBackupCheckedAt: "2026-06-28T00:00:00Z",
        },
      },
      {
        profileId: "default-root",
        name: "",
        path: "/workspace/photos",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "2026-06-21T00:00:00Z",
        isDefault: true,
        builtIn: true,
      },
      {
        profileId: "missing-root",
        name: "Missing Root",
        path: "/missing/photos",
        createdAt: "2026-06-01T00:00:00Z",
        updatedAt: "",
        isDefault: false,
      },
    ],
    backupPolicyStatus: {
      rootCoverage: [
        {
          profileId: "default-root",
          name: "Workspace Photos",
          path: "/workspace/photos",
          isDefault: true,
          builtIn: true,
          insideWorkspace: true,
          assetCount: 12,
          requiresExternalBackup: false,
          exists: true,
          isDirectory: true,
          writable: true,
          creatable: false,
        },
        {
          profileId: "external-root",
          name: "External Archive",
          path: "/Volumes/Archive/Photos",
          isDefault: false,
          builtIn: false,
          insideWorkspace: false,
          assetCount: 1204,
          requiresExternalBackup: false,
          externalBackupCovered: true,
          externalBackupLabel: "External disk A",
          externalBackupCheckedAt: "2026-06-28T00:00:00Z",
          exists: true,
          isDirectory: true,
          writable: false,
          creatable: false,
          issue: "Folder is not writable.",
          rootConflict: true,
          rootConflictKind: "nested",
          rootConflictMessage: "This root is inside Workspace Photos; scoped counts and repairs can overlap.",
          policyWarnings: [
            {
              kind: "overlap",
              message: "This root is inside Workspace Photos; scoped counts and repairs can overlap.",
              action: "Keep one non-overlapping root profile.",
            },
          ],
        },
        {
          profileId: "missing-root",
          name: "Missing Root",
          path: "/missing/photos",
          isDefault: false,
          builtIn: false,
          insideWorkspace: false,
          assetCount: 0,
          requiresExternalBackup: true,
          exists: false,
          isDirectory: false,
          writable: false,
          creatable: true,
        },
      ],
    },
  });
  assert.deepStrictEqual(rows.map((row) => row.key), ["default-root", "external-root", "missing-root"]);
  assert.strictEqual(rows[0].name, "photos");
  assert.deepStrictEqual(rows[0].badges.map((badge) => badge.label), ["Default", "Workspace", "12 photos"]);
  assert.ok(rows[0].details.includes("Inside the active workspace backup."));
  assert.deepStrictEqual(rows[1].badges.map((badge) => [badge.label, badge.tone || ""]), [
    ["1,204 photos", ""],
    ["Keeps folders", ""],
    ["Overlapping root", "warn"],
    ["Needs repair", "warn"],
    ["External backup covered", "ok"],
  ]);
  assert.ok(rows[1].details.includes("This root is inside Workspace Photos; scoped counts and repairs can overlap."));
  assert.ok(rows[1].details.includes("This root is inside Workspace Photos; scoped counts and repairs can overlap. Keep one non-overlapping root profile."));
  assert.ok(rows[1].details.includes("External backup covered by External disk A."));
  assert.ok(rows[1].details.includes("Folder is not writable."));
  assert.ok(rows[2].details.includes("Folder can be created when first used."));
});

run("buildPhotoDuplicateComparisonRows marks current and recommended duplicate items", () => {
  const group = {
    groupId: "dup-a",
    algorithm: "exact_hash",
    signature: "abc",
    itemCount: 2,
    primaryAssetId: "asset-a",
    recommendedAssetId: "asset-b",
    recommendedSourcePath: "/photos/beta.jpg",
    recommendationReasons: ["Favorite", "Most metadata"],
    createdAt: "",
    updatedAt: "",
    items: [
      { assetId: "asset-a", sourcePath: "/photos/alpha.jpg", position: 0, reason: "exact hash" },
      { assetId: "asset-b", sourcePath: "/photos/beta.jpg", position: 1, reason: "exact hash" },
    ],
  };
  const rows = duplicateReviewMod.buildPhotoDuplicateComparisonRows(group, "asset-a", (source) => path.basename(source));
  assert.deepStrictEqual(rows.map((row) => [row.title, row.isCurrent, row.isRecommended, row.badges]), [
    ["alpha.jpg", true, false, ["Current", "exact hash"]],
    ["beta.jpg", false, true, ["Recommended keep", "exact hash"]],
  ]);
  assert.deepStrictEqual(duplicateReviewMod.photoDuplicateRecommendationReasons(group), ["Favorite", "Most metadata"]);
});

run("buildPhotoDuplicateBrowserReviewGroups builds loaded duplicate review cards", () => {
  const duplicateGroup = {
    groupId: "dup-a",
    algorithm: "perceptual_dhash",
    signature: "near",
    itemCount: 3,
    primaryAssetId: "asset-a",
    recommendedAssetId: "asset-b",
    recommendedSourcePath: "/photos/beta.jpg",
    recommendationReasons: ["Favorite", "Largest file", "Most metadata", "Newest", "extra"],
    createdAt: "",
    updatedAt: "",
    items: [
      { assetId: "asset-a", sourcePath: "/photos/alpha.jpg", position: 0, reason: "near match" },
      { assetId: "asset-b", sourcePath: "/photos/beta.jpg", position: 1, reason: "near match" },
      { assetId: "asset-c", sourcePath: "/photos/gamma.jpg", position: 2, reason: "near match" },
    ],
  };
  const groups = duplicateReviewMod.buildPhotoDuplicateBrowserReviewGroups([
    {
      id: "photo-a",
      assetId: "asset-a",
      sourcePath: "/photos/alpha.jpg",
      previewUrl: "preview-a",
      sourceUrl: "source-a",
      mediaKind: "image",
      duplicateGroup,
    },
    {
      id: "photo-b",
      assetId: "asset-b",
      sourcePath: "/photos/beta.jpg",
      title: "Best beta",
      previewUrl: "preview-b",
      sourceUrl: "source-b",
      mediaKind: "image",
      duplicateGroup,
    },
  ], new Set(["/photos/beta.jpg"]), (source) => path.basename(source));

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].recommendedAssetId, "asset-b");
  assert.strictEqual(groups[0].recommendedTitle, "Best beta");
  assert.deepStrictEqual(groups[0].recommendationReasons, ["Favorite", "Largest file", "Most metadata", "Newest"]);
  assert.strictEqual(groups[0].loadedCount, 2);
  assert.strictEqual(groups[0].selectedCount, 1);
  assert.deepStrictEqual(groups[0].rows.map((row) => [row.title, row.previewUrl, row.loadedIndex, row.isRecommended, row.isSelected, row.displayBadges]), [
    ["alpha.jpg", "preview-a", 0, false, false, ["Loaded", "near match"]],
    ["Best beta", "preview-b", 1, true, true, ["Recommended keep", "Selected", "Loaded", "near match"]],
    ["gamma.jpg", "", -1, false, false, ["near match"]],
  ]);
});

run("buildPhotoGroupReviewCandidates scopes pending people matches for groups", () => {
  const candidate = (candidateId, personName, status, score, quality = 0.7, extra = {}) => ({
    candidateId,
    sourcePath: `/photos/${candidateId}.jpg`,
    personName,
    status,
    score,
    quality,
    bestRefId: null,
    bestRefPath: null,
    band: "",
    modelName: "",
    note: "",
    createdAt: "",
    ...extra,
  });
  const rows = groupReviewMod.buildPhotoGroupReviewCandidates({
    memberPeople: ["Alice", "Bob"],
    excludePeople: ["Bob"],
    candidates: [
      candidate("alice-low", "alice", "pending", 0.72, 0.95),
      candidate("alice-high", "Alice", "uncertain", 0.91, 0.5, {
        band: "likely",
        bestRefId: "ref-ada",
        reviewMoreProvenance: {
          kind: "nearest_neighbor_review_more",
          score: 0.91,
          quality: 0.5,
          band: "likely",
          status: "uncertain",
          bestRefId: "ref-ada",
        },
      }),
      candidate("bob", "Bob", "pending", 0.99, 0.9),
      candidate("carol", "Carol", "pending", 0.98, 0.9),
      candidate("accepted", "Alice", "accepted", 1, 1),
      candidate("alice-high", "Alice", "pending", 0.1, 0.1),
    ],
  });
  assert.deepStrictEqual(rows.map((row) => row.candidateId), ["alice-high", "alice-low"]);
  assert.deepStrictEqual(groupReviewMod.buildPhotoGroupReviewCandidates({
    memberPeople: ["Alice"],
    minScore: 0.8,
    candidates: rows,
  }).map((row) => row.candidateId), ["alice-high"]);
  assert.deepStrictEqual(groupReviewMod.photoReviewMoreCandidateReasons(rows[0]), [
    "Nearest match",
    "score 91%",
    "quality 50%",
    "likely",
    "uncertain",
    "best reference",
  ]);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateMatchesThreshold(rows[0], 0.9), true);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateMatchesThreshold(rows[1], 0.9), false);
  assert.deepStrictEqual(groupReviewMod.buildPhotoGroupReviewCandidates({ memberPeople: [], candidates: [candidate("x", "Alice", "pending", 1)] }), []);
});

run("photoPeopleMatchCorrectionCandidateIds scopes selected people corrections", () => {
  const selectedItems = [
    {
      candidateIds: ["ada-1", "bob-1", "legacy-extra"],
      people: [
        { candidateId: "ada-1", personName: "Ada", status: "accepted", score: 0.9, quality: 0.8, band: "strong" },
        { candidateId: "bob-1", personName: "Bob", status: "accepted", score: 0.8, quality: 0.7, band: "strong" },
      ],
    },
    {
      candidateIds: ["grace-1"],
      people: [
        { candidateId: "grace-1", personName: " Grace ", status: "accepted", score: 0.7, quality: 0.6, band: "likely" },
        { candidateId: "asset-only", personName: "Ada", status: "accepted", score: 1, quality: 1, band: "asset", assetOnly: true },
      ],
    },
  ];
  assert.deepStrictEqual(
    peopleMatchSelectionMod.photoPeopleMatchCorrectionCandidateIds(selectedItems, { kind: "person", personName: " ada " }),
    ["ada-1"]
  );
  assert.deepStrictEqual(
    peopleMatchSelectionMod.photoPeopleMatchCorrectionCandidateIds(selectedItems, { kind: "group", memberPeople: ["Ada", "Grace"], excludePeople: ["Ada"] }),
    ["grace-1"]
  );
  assert.deepStrictEqual(
    peopleMatchSelectionMod.photoPeopleMatchCorrectionCandidateIds(selectedItems),
    ["ada-1", "bob-1", "grace-1"]
  );
  assert.deepStrictEqual(
    peopleMatchSelectionMod.photoPeopleMatchCorrectionCandidateIds([{ candidateIds: ["legacy-1", "legacy-1", "legacy-2"] }]),
    ["legacy-1", "legacy-2"]
  );
});

run("review focus history normalizes dedupes and removes local queues", () => {
  const first = reviewFocusHistoryMod.upsertReviewFocusHistory([], {
    label: "  Ada & Grace Review More  ",
    candidateIds: [" grace-uncertain ", "ada-pending", "ada-pending", ""],
  }, 1000);
  assert.deepStrictEqual(first.map((record) => [record.label, record.candidateIds, record.lastUsedAt]), [
    ["Ada & Grace Review More", ["grace-uncertain", "ada-pending"], 1000],
  ]);
  assert.strictEqual(reviewFocusHistoryMod.reviewFocusHistoryStorageKey("/tmp/workspace"), "vintrace:review-focus-history:/tmp/workspace");

  const second = reviewFocusHistoryMod.upsertReviewFocusHistory(first, {
    label: "Bob Review More",
    candidateIds: ["bob-pending"],
  }, 2000);
  assert.deepStrictEqual(second.map((record) => record.label), ["Bob Review More", "Ada & Grace Review More"]);

  const refreshed = reviewFocusHistoryMod.upsertReviewFocusHistory(second, {
    label: "Ada & Grace Review More",
    candidateIds: ["grace-uncertain", "ada-pending"],
  }, 3000);
  assert.deepStrictEqual(refreshed.map((record) => record.label), ["Ada & Grace Review More", "Bob Review More"]);
  assert.strictEqual(refreshed[0].lastUsedAt, 3000);

  const oversized = reviewFocusHistoryMod.normalizeReviewFocusHistory(Array.from({ length: 20 }, (_, index) => ({
    id: `item-${index}`,
    label: `Queue ${index}`,
    candidateIds: Array.from({ length: 260 }, (__, candidateIndex) => `candidate-${candidateIndex}`),
    createdAt: 1000 + index,
    lastUsedAt: 1000 + index,
  })));
  assert.strictEqual(oversized.length, reviewFocusHistoryMod.MAX_REVIEW_FOCUS_HISTORY);
  assert.strictEqual(oversized[0].candidateIds.length, reviewFocusHistoryMod.MAX_REVIEW_FOCUS_CANDIDATE_IDS);
  assert.deepStrictEqual(
    reviewFocusHistoryMod.removeReviewFocusHistoryItem(refreshed, refreshed[0].id).map((record) => record.label),
    ["Bob Review More"]
  );
});

run("buildPhotoRepairIssues turns backup and recovered state into actions", () => {
  const issues = repairCenterMod.buildPhotoRepairIssues({
    backupCheck: {
      counts: {
        missingOriginals: 2,
        missingManagedOriginals: 1,
        missingReferencedOriginals: 1,
        missingCachedPreviews: 3,
        orphanAlbumItems: 1,
        catalogIntegrityIssues: 2,
        missingPairedMotionFiles: 1,
        missingMediaPairFiles: 1,
        missingEditStackSidecars: 1,
        invalidEditStackSidecars: 1,
        managedRootProfileIssues: 1,
        managedAssetsOutsideProfiles: 2,
      },
      samples: {
        missingOriginals: [{ sourcePath: "/missing/family.jpg" }],
        missingCachedPreviews: [{ sourcePath: "/photos/needs-preview.jpg" }],
      },
    },
    restoreRehearsal: {
      counts: {
        blockedItems: 0,
        missingOriginalItems: 2,
        missingManagedTrashItems: 1,
      },
    },
    backupRestoreRehearsal: {
      ok: false,
      status: "attention",
      counts: {
        blockers: 1,
        mismatchedCounts: 0,
      },
    },
    recoveredCount: 4,
    visiblePhotoCount: 10,
  });
  assert.deepStrictEqual(issues.map((issue) => [issue.id, issue.count, issue.severity, issue.action]), [
    ["missing-originals", 2, "error", "relinkMissingOriginal"],
    ["missing-previews", 3, "warning", "runPreviewSweep"],
    ["recovered-imports", 4, "warning", "openRecovered"],
    ["orphan-album-items", 1, "error", "cleanCatalogDrift"],
    ["catalog-integrity", 2, "warning", "cleanCatalogDrift"],
    ["media-pair-files", 2, "warning", "runBackupCheck"],
    ["missing-edit-sidecars", 1, "warning", "runBackupCheck"],
    ["invalid-edit-sidecars", 1, "warning", "runBackupCheck"],
    ["managed-root-profiles", 3, "warning", "openRootProfiles"],
    ["restore-rehearsal", 2, "warning", "runRestoreRehearsal"],
    ["backup-restore-rehearsal", 1, "error", "runBackupRestoreRehearsal"],
  ]);
  assert.deepStrictEqual(issues.map((issue) => [issue.id, issue.scopeLabel]), [
    ["missing-originals", "Active library"],
    ["missing-previews", "Active library"],
    ["recovered-imports", "Active library"],
    ["orphan-album-items", "Catalog cleanup is workspace-wide"],
    ["catalog-integrity", "Catalog cleanup is workspace-wide"],
    ["media-pair-files", "Active library"],
    ["missing-edit-sidecars", "Active library"],
    ["invalid-edit-sidecars", "Active library"],
    ["managed-root-profiles", "Managed-root policy"],
    ["restore-rehearsal", "Workspace restore log"],
    ["backup-restore-rehearsal", "Workspace backup"],
  ]);
  assert.strictEqual(issues[0].sampleSourcePath, "/missing/family.jpg");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[0].action), "Relink folder");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[1].action), "Sweep previews");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[2].action), "Open Recovered");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[3].action), "Clean catalog");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[8].action), "Review roots");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[9].action), "Restore rehearsal");
  assert.strictEqual(repairCenterMod.photoRepairIssueActionLabel(issues[10].action), "Backup rehearsal");
});

run("buildPhotoRepairIssues falls back to visible preview repair and stays clean", () => {
  assert.deepStrictEqual(repairCenterMod.buildPhotoRepairIssues({
    backupCheck: { counts: { missingCachedPreviews: 2 }, samples: {} },
    visiblePhotoCount: 6,
  }).map((issue) => [issue.id, issue.action]), [
    ["missing-previews", "runPreviewSweep"],
  ]);
  assert.deepStrictEqual(repairCenterMod.buildPhotoRepairIssues({
    backupCheck: { counts: { missingOriginals: 0, missingCachedPreviews: 0, orphanAlbumItems: 0 } },
    recoveredCount: 0,
  }), []);
});

run("photo repair actions pass the active library root to scoped checks", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.match(source, /photoLibraryBackupCheck\(\{ sampleLimit: 8, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /photoLibraryPreviewSweep\(\{[\s\S]*?sampleLimit: 8,[\s\S]*?libraryRoot,/);
  assert.match(source, /rebuildPhotoPreviews\(\{[\s\S]*?force: true,[\s\S]*?libraryRoot,/);
  assert.match(source, /scanPhotoRecoveredOrphans\(\{ limit: 500, dryRun, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /photoRecoveredCleanup\(\{[\s\S]*?sampleLimit: 8,[\s\S]*?libraryRoot,/);
  assert.match(source, /props\.listPhotoImportFailures\(\{ limit: 100, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /function runManagedRootBackupCheck\(rootPath: string, rootName: string\)/);
  assert.match(source, /function runManagedRootPreviewSweep\(rootPath: string, rootName: string\)/);
  assert.match(source, /function runManagedRootOrphanScan\(rootPath: string, rootName: string, dryRun = true\)/);
  assert.match(source, /uiText\("Managed root health"\)/);
  assert.match(source, /uiText\("Check root"\)/);
  assert.match(source, /photoRepairScopeLabel/);
  assert.match(source, /className="photo-repair-scope"/);
  assert.match(source, /photo-repair-issue-scope/);
  assert.match(styles, /\.photo-managed-root-health-panel/);
  assert.match(styles, /\.photo-catalog-cleanup-preview/);
  assert.match(styles, /\.photo-repair-scope/);
  assert.match(styles, /\.photo-repair-issue-scope/);
});

run("photoRepairHistoryEventDetails expands consolidation history", () => {
  assert.deepStrictEqual(repairCenterMod.photoRepairHistoryEventDetails({
    action: "consolidate_photo_library_assets",
    counts: {
      consolidatedAssets: 3,
      skippedAssets: 1,
      pairedMotionCopied: 2,
      relatedMediaCopied: 4,
    },
    details: {
      managedRootLabel: "Vintrace Library",
      managedRootPath: "/Users/alice/Pictures/Vintrace Library",
      copiedSamples: ["IMG_0001.JPG", "IMG_0002.JPG"],
      companionSamples: ["IMG_0001.MOV", "IMG_0002.DNG", "IMG_0002.xmp", "IMG_0002.aae"],
      skippedSamples: ["already-managed.jpg", "missing.jpg"],
      operationId: "op-1",
    },
  }), [
    { key: "managed-root", label: "Managed folder", value: "Vintrace Library" },
    { key: "managed-path", label: "Managed path", value: "/Users/alice/Pictures/Vintrace Library" },
    { key: "consolidated", label: "Originals copied", value: "3" },
    { key: "skipped", label: "Still referenced", value: "1" },
    { key: "companions", label: "Companions copied", value: "6" },
    { key: "copied-samples", label: "Copied samples", value: "IMG_0001.JPG, IMG_0002.JPG" },
    { key: "companion-samples", label: "Companion samples", value: "IMG_0001.MOV, IMG_0002.DNG, IMG_0002.xmp +1 more" },
    { key: "skipped-samples", label: "Skipped samples", value: "already-managed.jpg, missing.jpg" },
    { key: "undo", label: "Undo available", value: "Yes" },
  ]);
  assert.deepStrictEqual(repairCenterMod.photoRepairHistoryEventDetails({
    action: "photo_library_backup_check",
    counts: {
      assets: 12,
      missingOriginals: 1,
      missingCachedPreviews: 2,
      managedRootProfileIssues: 1,
    },
    details: {
      libraryRootLabel: "Root Alpha",
      libraryRootPath: "/photos/root-alpha",
    },
  }), [
    { key: "root", label: "Library root", value: "Root Alpha" },
    { key: "root-path", label: "Root path", value: "/photos/root-alpha" },
    { key: "assets", label: "Assets checked", value: "12" },
    { key: "missing-originals", label: "Missing originals", value: "1" },
    { key: "missing-previews", label: "Missing previews", value: "2" },
    { key: "root-profile-issues", label: "Root profile issues", value: "1" },
  ]);
  assert.deepStrictEqual(repairCenterMod.photoRepairHistoryEventDetails({
    action: "photo_library_catalog_cleanup",
    dryRun: true,
    counts: {
      cleanupCandidates: 4,
      cleanedRows: 0,
      remainingCandidates: 4,
      orphanAlbumItems: 1,
    },
    details: {
      applied: false,
    },
  }).slice(0, 4), [
    { key: "scope", label: "Scope", value: "Workspace catalog" },
    { key: "mode", label: "Mode", value: "Preview" },
    { key: "candidates", label: "Cleanup candidates", value: "4" },
    { key: "cleaned", label: "Rows cleaned", value: "0" },
  ]);
});

run("buildPhotoConsolidationHistoryRows summarizes durable consolidation events", () => {
  const rows = repairCenterMod.buildPhotoConsolidationHistoryRows([
    {
      seq: 6,
      at: "2026-06-28T12:00:00Z",
      action: "photo_library_backup_check",
      label: "Backup check",
      summary: "0 missing originals.",
      counts: {},
      details: {},
    },
    {
      seq: 5,
      at: "2026-06-28T11:00:00Z",
      action: "consolidate_photo_library_assets",
      label: "Consolidate originals",
      summary: "2 originals consolidated into Managed, 1 skipped, 3 companion file(s) copied.",
      status: "repaired",
      counts: {
        consolidatedAssets: 2,
        skippedAssets: 1,
        pairedMotionCopied: 1,
        relatedMediaCopied: 2,
      },
      details: {
        managedRootLabel: "Managed",
        managedRootPath: "/photos/Managed",
        copiedSamples: ["alice.jpg", "bob.jpg"],
        companionSamples: ["alice.mov", "bob.xmp", "bob.aae"],
        skippedSamples: ["already-managed.jpg"],
        operationId: "op-5",
      },
    },
    {
      seq: 4,
      at: "2026-06-28T10:00:00Z",
      action: "consolidate_photo_library_assets",
      label: "",
      summary: "",
      status: "warning",
      counts: {
        consolidatedAssets: 0,
        skippedAssets: 2,
        failures: 1,
      },
      details: {
        skippedSamples: ["missing-a.jpg", "missing-b.jpg"],
      },
    },
  ], 1);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    key: "5:2026-06-28T11:00:00Z:0",
    title: "Consolidate originals",
    summary: "2 originals consolidated into Managed, 1 skipped, 3 companion file(s) copied.",
    at: "2026-06-28T11:00:00Z",
    status: "repaired",
    managedRootLabel: "Managed",
    managedRootPath: "/photos/Managed",
    originalsCopied: 2,
    stillReferenced: 1,
    companionsCopied: 3,
    copiedSamples: "alice.jpg, bob.jpg",
    companionSamples: "alice.mov, bob.xmp, bob.aae",
    skippedSamples: "already-managed.jpg",
    undoAvailable: true,
  });
});

run("buildPhotoConsolidationSummary exposes copied and skipped filenames", () => {
  const summary = consolidationResultMod.buildPhotoConsolidationSummary({
    generatedAt: "2026-06-27T00:00:00Z",
    dryRun: false,
    managedRoot: "/Users/alice/Pictures/Vintrace Library",
    runRoot: "/Users/alice/Pictures/Vintrace Library",
    requested: 4,
    selectedAssets: 4,
    consolidatedAssets: 2,
    skippedAssets: 2,
    missingInputs: ["/External/Unknown/ghost.jpg"],
    missingSources: [{ assetId: "asset-missing", sourcePath: "/External/Trip/missing.jpg" }],
    alreadyManaged: [{ assetId: "asset-managed", sourcePath: "/Users/alice/Pictures/Vintrace Library/managed.jpg" }],
    deletedAssets: [],
    failures: [{ assetId: "asset-failed", sourcePath: "/External/Trip/failed.jpg", reason: "permission denied" }],
    samples: [
      { assetId: "asset-a", from: "/External/Trip/IMG_0001.JPG", to: "/Users/alice/Pictures/Vintrace Library/IMG_0001.JPG" },
      { assetId: "asset-b", from: "/External/Trip/IMG_0002.JPG", to: "/Users/alice/Pictures/Vintrace Library/IMG_0002.JPG" },
    ],
    pairedMotionCopiedCount: 1,
    pairedMotionSamples: [
      { assetId: "asset-a", from: "/External/Trip/IMG_0001.MOV", to: "/Users/alice/Pictures/Vintrace Library/IMG_0001.MOV" },
    ],
    relatedMediaCopiedCount: 1,
    relatedMediaSamples: [
      { assetId: "asset-b", pairKind: "raw_sidecar", from: "/External/Trip/IMG_0002.DNG", to: "/Users/alice/Pictures/Vintrace Library/IMG_0002.DNG" },
    ],
    operation: { operationId: "op-1" },
  }, { sampleLimit: 5 });
  assert.strictEqual(summary.status, "warning");
  assert.strictEqual(summary.title, "Consolidated 2 Photos originals");
  assert.strictEqual(summary.managedRootLabel, "Vintrace Library");
  assert.deepStrictEqual(summary.metrics.map((metric) => [metric.key, metric.value]), [
    ["consolidated", "2"],
    ["skipped", "2"],
    ["live-motion", "1"],
    ["related-media", "1"],
    ["undo", "Yes"],
  ]);
  assert.deepStrictEqual(summary.rows.map((row) => [row.label, row.sourceName]), [
    ["Copied", "IMG_0001.JPG"],
    ["Copied", "IMG_0002.JPG"],
    ["Live motion", "IMG_0001.MOV"],
    ["Raw Sidecar", "IMG_0002.DNG"],
    ["Already managed", "managed.jpg"],
  ]);
  assert.strictEqual(summary.rows.some((row) => row.sourceName.includes("/External/Trip")), false);
  assert.strictEqual(summary.hiddenRowCount, 3);
});

run("buildPhotoConsolidationSummary handles empty previews", () => {
  const summary = consolidationResultMod.buildPhotoConsolidationSummary({
    generatedAt: "2026-06-27T00:00:00Z",
    dryRun: true,
    managedRoot: "",
    runRoot: "/workspace/photos",
    requested: 1,
    selectedAssets: 0,
    consolidatedAssets: 0,
    skippedAssets: 1,
    missingInputs: [],
    missingSources: [],
    alreadyManaged: [{ assetId: "asset-managed", sourcePath: "/workspace/photos/managed.jpg" }],
    deletedAssets: [],
    failures: [],
    samples: [],
  }, { sampleLimit: 2 });
  assert.strictEqual(summary.status, "empty");
  assert.strictEqual(summary.title, "No originals consolidated");
  assert.strictEqual(summary.managedRootLabel, "photos");
  assert.deepStrictEqual(summary.rows.map((row) => [row.label, row.sourceName]), [["Already managed", "managed.jpg"]]);
});

run("buildPhotoTechnicalMetadata surfaces EXIF camera fields and media metadata", () => {
  assert.deepStrictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      exif: {
        cameraMake: "Apple",
        cameraModel: "iPhone 15 Pro",
        lensModel: "Main Camera",
        focalLengthMm: "24",
        focalLength35mm: "48",
        fNumber: "1.8",
        exposureTime: "1/125",
        isoSpeed: "200",
        orientation: "Rotate 90 CW",
        software: "17.5",
      },
      videoCodec: "h264",
      audioCodec: "aac",
      colorProfile: "Display P3",
      xmp: {
        photographicStyle: "Rich Contrast",
        sidecarPath: "/photos/alpha.xmp",
        rating: "5",
        conflicts: [
          { field: "title", label: "Title", local: "Manual", sidecar: "XMP", sidecarValue: "XMP" },
        ],
      },
    },
  }), {
    camera: "Apple iPhone 15 Pro",
    lens: "Main Camera",
    cameraSettings: "24 mm, 48 mm equiv, f/1.8, 1/125 s, ISO 200, Rotate 90 CW",
    software: "17.5",
    codec: "h264, aac",
    colorProfile: "Display P3",
    photographicStyle: "Rich Contrast",
    depthMetadata: "",
    ocrMetadata: "",
    iptcCreator: "",
    iptcRights: "",
    iptcEvent: "",
    iptcLocation: "",
    gpsMetadata: "",
    modelTags: "",
    detectedItems: "",
    rawPreviewProxy: "",
    xmpSidecar: "/photos/alpha.xmp",
    xmpRating: "5",
    xmpConflicts: [
      { field: "title", label: "Title", local: "Manual", sidecar: "XMP", sidecarValue: "XMP" },
    ],
  });
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      video: {
        codecName: "hevc",
        format: "quicktime",
      },
      probe: {
        codecName: "hevc",
        format: "mov,mp4,m4a,3gp,3g2,mj2",
      },
    },
  }).codec, "hevc, quicktime, mov,mp4,m4a,3gp,3g2,mj2");
});

run("buildPhotoTechnicalMetadata dedupes fallback metadata values", () => {
  assert.deepStrictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      cameraMake: "Canon",
      cameraModel: "Canon",
      lens: { name: "RF 50mm", value: "ignored when name exists" },
      codec: [{ codec: "HEVC" }, "hevc"],
      colorSpace: "sRGB",
    },
  }), {
    camera: "Canon",
    lens: "RF 50mm",
    cameraSettings: "",
    software: "",
    codec: "HEVC",
    colorProfile: "sRGB",
    photographicStyle: "",
    depthMetadata: "",
    ocrMetadata: "",
    iptcCreator: "",
    iptcRights: "",
    iptcEvent: "",
    iptcLocation: "",
    gpsMetadata: "",
    modelTags: "",
    detectedItems: "",
    rawPreviewProxy: "",
    xmpSidecar: "",
    xmpRating: "",
    xmpConflicts: [],
  });
});

run("buildPhotoTechnicalMetadata preserves read-only Photographic Style metadata", () => {
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      photographicStyle: { name: "Vibrant" },
      xmp: {
        cameraStyle: "Vibrant",
        profileName: "Standard",
      },
    },
  }).photographicStyle, "Vibrant, Standard");
});

run("buildPhotoTechnicalMetadata surfaces read-only IPTC metadata", () => {
  assert.deepStrictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      xmp: {
        iptc: {
          creator: ["Harbor Studio", "A. Editor"],
          credit: "Unit News",
          source: "Harbor Archive",
          copyright: "Copyright 2026 Harbor Studio",
          usageTerms: "Editorial use only",
          event: "Bay Lights Opening",
          headline: "Ferry headline",
          jobId: "JOB-42",
          instructions: "Ask before syndication",
          locationCreated: {
            sublocation: "Ferry Building",
            city: "San Francisco",
            state: "California",
            country: "United States",
            countryCode: "US",
          },
        },
      },
    },
  }), {
    camera: "",
    lens: "",
    cameraSettings: "",
    software: "",
    codec: "",
    colorProfile: "",
    photographicStyle: "",
    depthMetadata: "",
    ocrMetadata: "",
    iptcCreator: "Harbor Studio, A. Editor, Unit News, Harbor Archive",
    iptcRights: "Copyright 2026 Harbor Studio, Editorial use only",
    iptcEvent: "Bay Lights Opening, Ferry headline, JOB-42, Ask before syndication",
    iptcLocation: "Ferry Building, San Francisco, California, United States, US",
    gpsMetadata: "",
    modelTags: "",
    detectedItems: "",
    rawPreviewProxy: "",
    xmpSidecar: "",
    xmpRating: "",
    xmpConflicts: [],
  });
});

run("buildPhotoTechnicalMetadata surfaces OCR engine language and script metadata", () => {
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      ocrConfidence: 0.925,
      textRegions: [{ text: "नमस्ते", script: "Devanagari" }, { text: "ticket", script: "Latin" }],
      localOcr: {
        engine: "tesseract",
        language: "eng",
        detectedLanguage: "hi",
        detectedScript: "Devanagari",
        detectedLanguageSource: "script-language-map",
        regionCount: 2,
      },
    },
  }).ocrMetadata, "Engine tesseract, Language eng, Detected language hi, Script Devanagari, Confidence 93%, Regions 2");
});

run("buildPhotoTechnicalMetadata surfaces read-only depth metadata", () => {
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      cinematicMode: true,
      portraitEffectsMatte: { available: true },
      depthMap: { label: "Depth map available" },
      aperture: 1.8,
      focusDistance: 0.7,
    },
  }).depthMetadata, "Depth map available, Portrait, Cinematic, Focus 0.7, f/1.8");
});

run("photo local depth controls normalize and surface in technical metadata", () => {
  assert.deepStrictEqual(infoMetadataMod.normalizePhotoLocalDepthControls({
    modeLabel: "Cinematic",
    fNumber: "0.2",
    subjectDistance: "1001.7",
    portraitEffect: "Stage Light",
  }), {
    mode: "cinematic",
    aperture: "0.7",
    focusDistance: "1000",
    effect: "Stage Light",
  });
  assert.deepStrictEqual(infoMetadataMod.photoLocalDepthControlsPayload({
    mode: "portrait",
    aperture: "2.8",
    focusDistance: "0.9",
    effect: "Studio Light",
  }), {
    mode: "portrait",
    modeLabel: "Portrait",
    aperture: "2.8",
    focusDistance: "0.9",
    effect: "Studio Light",
  });
  assert.strictEqual(infoMetadataMod.photoLocalDepthControlsEqual(
    { mode: "portrait", aperture: 2.8, focusDistance: 0.9, effect: "Studio Light" },
    { modeLabel: "Portrait", fNumber: "2.8", subjectDistance: "0.9", portraitEffect: "Studio Light" },
  ), true);
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      localDepthControls: {
        mode: "portrait",
        modeLabel: "Portrait",
        aperture: "2.8",
        focusDistance: "0.9",
        effect: "Studio Light",
      },
      depthMap: { label: "Depth map available" },
      cinematicMode: true,
    },
  }).depthMetadata, "Portrait, Studio Light, Focus 0.9, f/2.8, Depth map available, Cinematic");
});

run("buildPhotoTechnicalMetadata surfaces RAW preview proxy path", () => {
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    rawPreviewProxyPath: "/photos/raw-preview-proxy.jpg",
    assetMetadata: {},
  }).rawPreviewProxy, "/photos/raw-preview-proxy.jpg");
});

run("photo media-pair helpers normalize related files and statuses", () => {
  const pairs = mediaPairsMod.normalizePhotoMediaPairList([
    {
      pair_id: "pair-1",
      asset_id: "asset-1",
      pair_kind: "raw_sidecar",
      source_path: "/photos/image.jpg",
      related_source_path: "/photos/image.DNG",
      related_exists: true,
      metadata: {
        producer: "user_authored_pair",
        authoringHistory: [
          {
            action: "created",
            pairKind: "raw_sidecar",
            relatedSourcePath: "/photos/image.DNG",
            at: "2026-06-27T01:00:00Z",
          },
        ],
      },
    },
    {
      pairId: "pair-2",
      assetId: "asset-2",
      pairKind: "video_still",
      sourcePath: "C:\\Camera\\clip.mp4",
      relatedSourcePath: "C:\\Camera\\clip.jpg",
      relatedExists: false,
      metadata: {
        producer: "user_relinked_pair",
        relinkHistory: [
          {
            from: "C:\\Camera\\old.jpg",
            to: "C:\\Camera\\clip.jpg",
            at: "2026-06-27T02:00:00Z",
          },
        ],
      },
    },
    {},
  ]);
  assert.strictEqual(pairs.length, 2);
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel(pairs[0].pairKind), "RAW sidecar");
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel(pairs[1].pairKind), "Video still");
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel("metadata_sidecar"), "Metadata sidecar");
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel("edit_sidecar"), "Edit sidecar");
  assert.strictEqual(mediaPairsMod.photoMediaPairFilename(pairs[0]), "image.DNG");
  assert.strictEqual(mediaPairsMod.photoMediaPairFilename(pairs[1]), "clip.jpg");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusLabel(pairs[0]), "Available");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusLabel(pairs[1]), "Missing");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusKind(pairs[1]), "missing");
  assert.strictEqual(mediaPairsMod.photoMediaPairCanRemove(pairs[0]), true);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanRemove({ metadata: { producer: "adjacent_non_live_pair" } }), false);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanIgnoreGenerated({ metadata: { producer: "adjacent_non_live_pair" } }), true);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanIgnoreGenerated(pairs[0]), false);
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairHistory(pairs[0]).map((item) => item.label), ["Added"]);
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairHistory(pairs[1]).map((item) => item.label), ["Relinked"]);
});

run("emptyPhotoAlbumDraft defaults to smart and can start manual", () => {
  assert.deepStrictEqual(editorMod.emptyPhotoAlbumDraft(), {
    albumKind: "smart",
    name: "",
    description: "",
    includePeople: [],
    excludePeople: [],
    rules: {},
  });
  assert.strictEqual(editorMod.emptyPhotoAlbumDraft("manual").albumKind, "manual");
});

run("photo image crop aspect presets cover common ratios", () => {
  assert.deepStrictEqual(imageEditsMod.PHOTO_IMAGE_CROP_ASPECT_OPTIONS.map((option) => option.value), [
    "none",
    "square",
    "landscape",
    "9:16",
    "3:2",
    "2:3",
    "4:3",
    "3:4",
    "5:4",
    "portrait",
    "7:5",
    "5:7",
  ]);
  assert.strictEqual(imageEditsMod.photoImageCropAspectLabel("landscape"), "16:9");
  assert.strictEqual(imageEditsMod.photoImageCropAspectLabel("4x5"), "4:5");
  assert.strictEqual(imageEditsMod.normalizePhotoImageCropAspect("bad-value"), "none");
  assert.strictEqual(imageEditsMod.nextPhotoImageCropAspect("3:2"), "2:3");
});

run("photo manual crop boxes clamp and label percentages", () => {
  assert.deepStrictEqual(imageEditsMod.normalizePhotoManualCropBox({ left: 90, top: 95, width: 50, height: 20 }), {
    left: 90,
    top: 95,
    width: 10,
    height: 5,
  });
  assert.strictEqual(imageEditsMod.photoManualCropBoxActive({ left: 0, top: 0, width: 100, height: 100 }), false);
  assert.strictEqual(imageEditsMod.photoManualCropBoxActive({ left: 10, top: 10, width: 80, height: 80 }), true);
  assert.strictEqual(imageEditsMod.photoManualCropBoxLabel({ left: 10, top: 5, width: 80, height: 90 }), "Box 10/5/80/90");
  assert.strictEqual(imageEditsMod.photoManualCropHitTest({ left: 10, top: 10, width: 80, height: 80 }, { x: 50, y: 50 }), "move");
  assert.strictEqual(imageEditsMod.photoManualCropHitTest({ left: 10, top: 10, width: 80, height: 80 }, { x: 10, y: 10 }), "nw");
  assert.strictEqual(imageEditsMod.photoManualCropHitTest({ left: 10, top: 10, width: 80, height: 80 }, { x: 96, y: 50 }), "create");
  assert.deepStrictEqual(
    imageEditsMod.photoManualCropBoxFromDrag("create", { x: 70, y: 80 }, { x: 20, y: 30 }, { left: 10, top: 10, width: 80, height: 80 }),
    { left: 20, top: 30, width: 50, height: 50 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoManualCropBoxFromDrag("move", { x: 30, y: 30 }, { x: 40, y: 45 }, { left: 10, top: 10, width: 50, height: 40 }),
    { left: 20, top: 25, width: 50, height: 40 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoManualCropBoxFromDrag("se", { x: 60, y: 60 }, { x: 75, y: 80 }, { left: 10, top: 10, width: 50, height: 50 }),
    { left: 10, top: 10, width: 65, height: 70 }
  );
});

run("photo image adjustments clamp and summarize active sliders", () => {
  assert.deepStrictEqual(imageEditsMod.normalizePhotoImageAdjustments({
    exposure: 2.6,
    contrast: -140,
    highlights: 140,
    shadows: -140,
    brilliance: 26.4,
    blackPoint: -20,
    midtones: 44.4,
    whitePoint: 150,
    curveShadows: -88.2,
    curveMidtones: 22.8,
    curveHighlights: 140,
    curveRedShadows: -140,
    curveRedMidtones: 31.2,
    curveRedHighlights: 140,
    curveGreenShadows: 12.4,
    curveGreenMidtones: -140,
    curveGreenHighlights: 16.2,
    curveBlueShadows: 140,
    curveBlueMidtones: -22.4,
    curveBlueHighlights: 18.2,
    manualCurveBlack: -140,
    manualCurveQuarter: 24.2,
    manualCurveMid: -26.4,
    manualCurveThreeQuarter: 42.8,
    manualCurveWhite: 140,
    saturation: 35.2,
    warmth: 12.8,
    tint: -18.2,
    sharpness: -4.4,
    vignette: 125,
    noiseReduction: -30,
  }), {
    exposure: 2,
    contrast: -100,
    highlights: 100,
    shadows: -100,
    brilliance: 26,
    blackPoint: 0,
    midtones: 44,
    whitePoint: 100,
    curveShadows: -88,
    curveMidtones: 23,
    curveHighlights: 100,
    curveRedShadows: -100,
    curveRedMidtones: 31,
    curveRedHighlights: 100,
    curveGreenShadows: 12,
    curveGreenMidtones: -100,
    curveGreenHighlights: 16,
    curveBlueShadows: 100,
    curveBlueMidtones: -22,
    curveBlueHighlights: 18,
    manualCurveBlack: -100,
    manualCurveQuarter: 24,
    manualCurveMid: -26,
    manualCurveThreeQuarter: 43,
    manualCurveWhite: 100,
    saturation: 35,
    warmth: 13,
    tint: -18,
    sharpness: -4,
    vignette: 100,
    noiseReduction: 0,
  });
  assert.strictEqual(imageEditsMod.photoImageAdjustmentsActive({
    exposure: 0,
    contrast: 0,
    highlights: 0,
    shadows: 0,
    brilliance: 0,
    blackPoint: 0,
    midtones: 0,
    whitePoint: 0,
    curveShadows: 0,
    curveMidtones: 0,
    curveHighlights: 0,
    curveRedShadows: 0,
    curveRedMidtones: 0,
    curveRedHighlights: 0,
    curveGreenShadows: 0,
    curveGreenMidtones: 0,
    curveGreenHighlights: 0,
    curveBlueShadows: 0,
    curveBlueMidtones: 0,
    curveBlueHighlights: 0,
    manualCurveBlack: 0,
    manualCurveQuarter: 0,
    manualCurveMid: 0,
    manualCurveThreeQuarter: 0,
    manualCurveWhite: 0,
    saturation: 0,
    warmth: 0,
    tint: 0,
    sharpness: 0,
    vignette: 0,
    noiseReduction: 0,
  }), false);
  assert.strictEqual(imageEditsMod.photoImageAdjustmentsActive({ exposure: 0.5 }), true);
  assert.strictEqual(
    imageEditsMod.photoImageAdjustmentsLabel({
      exposure: 0.5,
      contrast: 20,
      highlights: -30,
      shadows: 25,
      brilliance: 18,
      blackPoint: 12,
      midtones: 10,
      whitePoint: 8,
      curveShadows: -20,
      curveMidtones: 15,
      curveHighlights: 25,
      curveRedShadows: -12,
      curveRedMidtones: 18,
      curveRedHighlights: 24,
      curveGreenShadows: 9,
      curveGreenMidtones: -11,
      curveGreenHighlights: 14,
      curveBlueShadows: 21,
      curveBlueMidtones: -16,
      curveBlueHighlights: 19,
      manualCurveBlack: -6,
      manualCurveQuarter: 12,
      manualCurveMid: -9,
      manualCurveThreeQuarter: 15,
      manualCurveWhite: 4,
      saturation: 15,
      warmth: 10,
      tint: -12,
      sharpness: 25,
      vignette: 40,
      noiseReduction: 35,
    }),
    "Adj E+0.5/C+20/Hi-30/Sd+25/Br+18/Bk12/Mt+10/Wt8/CvS-20/CvM+15/CvH+25/RCvS-12/RCvM+18/RCvH+24/GCvS+9/GCvM-11/GCvH+14/BCvS+21/BCvM-16/BCvH+19/MC0-6/MC25+12/MC50-9/MC75+15/MC100+4/S+15/W+10/Ti-12/Sh+25/Vg40/Nr35"
  );
});

run("photo image auto enhance seeds local adjustments and preserves manual tuning", () => {
  const stats = imageEditsMod.photoImageAutoEnhanceStatsFromPixels([
    32, 36, 40, 255,
    72, 70, 68, 255,
    156, 150, 140, 255,
    244, 238, 226, 255,
  ]);
  assert.ok(stats);
  assert.strictEqual(stats.pixelCount, 4);
  assert.ok(stats.lumaStdDev > 70, stats);
  assert.ok(stats.lumaP05 <= stats.shadowLuma, stats);
  assert.ok(stats.lumaP50 > 140 && stats.lumaP50 < 165, stats);
  assert.ok(stats.lumaP95 >= stats.highlightLuma, stats);
  assert.ok(stats.averageLuma > 115 && stats.averageLuma < 130, stats);
  assert.ok(stats.shadowLuma < 45, stats);
  assert.ok(stats.highlightLuma > 230, stats);
  assert.strictEqual(stats.shadowShare, 0.25);
  assert.strictEqual(stats.highlightShare, 0.25);
  assert.strictEqual(stats.clippedShadowShare, 0);
  assert.strictEqual(stats.clippedHighlightShare, 0);
  const imageAware = imageEditsMod.photoImageAutoEnhanceAdjustments({}, stats);
  assert.ok(imageAware.contrast >= 5, imageAware);
  assert.ok(imageAware.highlights <= -20, imageAware);
  assert.ok(imageAware.shadows >= 20, imageAware);
  assert.ok(imageAware.brilliance >= 20, imageAware);
  assert.ok(imageAware.noiseReduction >= 5, imageAware);

  const darkStats = imageEditsMod.photoImageAutoEnhanceStatsFromPixels([
    8, 10, 12, 255,
    18, 20, 22, 255,
    32, 34, 36, 255,
    54, 56, 58, 255,
  ]);
  assert.ok(darkStats);
  const darkEnhanced = imageEditsMod.photoImageAutoEnhanceAdjustments({}, darkStats);
  assert.ok(darkEnhanced.exposure > imageAware.exposure, { darkEnhanced, imageAware });
  assert.ok(darkEnhanced.shadows >= 40, darkEnhanced);
  assert.ok(darkEnhanced.noiseReduction >= 10, darkEnhanced);

  const flatStats = imageEditsMod.photoImageAutoEnhanceStatsFromPixels([
    116, 116, 116, 255,
    120, 120, 120, 255,
    124, 124, 124, 255,
    128, 128, 128, 255,
  ]);
  assert.ok(flatStats);
  const flatEnhanced = imageEditsMod.photoImageAutoEnhanceAdjustments({}, flatStats);
  assert.ok(flatEnhanced.contrast >= 30, flatEnhanced);
  assert.ok(flatEnhanced.brilliance >= 30, flatEnhanced);

  const clippedBrightStats = imageEditsMod.photoImageAutoEnhanceStatsFromPixels([
    220, 220, 220, 255,
    252, 252, 252, 255,
    255, 255, 255, 255,
    255, 255, 255, 255,
  ]);
  assert.ok(clippedBrightStats);
  assert.ok(clippedBrightStats.clippedHighlightShare >= 0.5, clippedBrightStats);
  const clippedBrightEnhanced = imageEditsMod.photoImageAutoEnhanceAdjustments({}, clippedBrightStats);
  assert.ok(clippedBrightEnhanced.exposure <= 0, clippedBrightEnhanced);
  assert.ok(clippedBrightEnhanced.highlights <= -35, clippedBrightEnhanced);
  assert.ok(clippedBrightEnhanced.whitePoint <= 5, clippedBrightEnhanced);

  const enhanced = imageEditsMod.photoImageAutoEnhanceAdjustments({
    exposure: -1.5,
    contrast: -40,
    warmth: 35,
    tint: -20,
    curveMidtones: 45,
    manualCurveMid: -15,
    vignette: 30,
  });
  assert.strictEqual(enhanced.exposure, 0.2);
  assert.strictEqual(enhanced.contrast, 15);
  assert.strictEqual(enhanced.highlights, -20);
  assert.strictEqual(enhanced.shadows, 20);
  assert.strictEqual(enhanced.brilliance, 25);
  assert.strictEqual(enhanced.blackPoint, 5);
  assert.strictEqual(enhanced.midtones, 10);
  assert.strictEqual(enhanced.whitePoint, 5);
  assert.strictEqual(enhanced.saturation, 10);
  assert.strictEqual(enhanced.sharpness, 15);
  assert.strictEqual(enhanced.noiseReduction, 5);
  assert.strictEqual(enhanced.warmth, 35);
  assert.strictEqual(enhanced.tint, -20);
  assert.strictEqual(enhanced.curveMidtones, 45);
  assert.strictEqual(enhanced.manualCurveMid, -15);
  assert.strictEqual(enhanced.vignette, 30);
  assert.strictEqual(imageEditsMod.photoImageAdjustmentsActive(enhanced), true);
  assert.strictEqual(
    imageEditsMod.photoImageAdjustmentsLabel(enhanced),
    "Adj E+0.2/C+15/Hi-20/Sd+20/Br+25/Bk5/Mt+10/Wt5/CvM+45/MC50-15/S+10/W+35/Ti-20/Sh+15/Vg30/Nr5"
  );
});

run("photo image filters normalize aliases and summarize active presets", () => {
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterPreset("Vivid Warm"), "vivid_warm");
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterPreset("black and white"), "mono");
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterPreset("silver tone"), "silvertone");
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterPreset("not-a-filter"), "none");
  assert.strictEqual(imageEditsMod.photoImageFilterPresetActive("none"), false);
  assert.strictEqual(imageEditsMod.photoImageFilterPresetActive("noir"), true);
  assert.strictEqual(imageEditsMod.photoImageFilterPresetLabel("dramatic_cool"), "Filter Dramatic Cool");
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterIntensity(125), 100);
  assert.strictEqual(imageEditsMod.normalizePhotoImageFilterIntensity(-4), 0);
  assert.strictEqual(imageEditsMod.photoImageFilterPresetLabel("noir", 50), "Filter Noir 50%");
  assert.strictEqual(imageEditsMod.photoImageFilterPreviewClassName("Vivid Warm"), "photos-filter-preview-vivid-warm");
  assert.strictEqual(imageEditsMod.photoImageFilterPreviewClassName("not-a-filter"), "photos-filter-preview-none");
});

run("photo manual curve graph maps points and drawn offsets", () => {
  assert.strictEqual(imageEditsMod.photoImageManualCurveKeyForGraphX(0, 200), "manualCurveBlack");
  assert.strictEqual(imageEditsMod.photoImageManualCurveKeyForGraphX(51, 200), "manualCurveQuarter");
  assert.strictEqual(imageEditsMod.photoImageManualCurveKeyForGraphX(102, 200), "manualCurveMid");
  assert.strictEqual(imageEditsMod.photoImageManualCurveKeyForGraphX(149, 200), "manualCurveThreeQuarter");
  assert.strictEqual(imageEditsMod.photoImageManualCurveKeyForGraphX(200, 200), "manualCurveWhite");
  assert.strictEqual(imageEditsMod.photoImageManualCurveGraphYToValue(0, 100, 5), 100);
  assert.strictEqual(imageEditsMod.photoImageManualCurveGraphYToValue(50, 100, 5), 0);
  assert.strictEqual(imageEditsMod.photoImageManualCurveGraphYToValue(100, 100, 5), -100);
  assert.deepStrictEqual(imageEditsMod.photoImageManualCurveGraphPoints({
    manualCurveBlack: -100,
    manualCurveMid: 50,
    manualCurveWhite: 100,
  }, 200, 100), [
    { key: "manualCurveBlack", x: 0, y: 100, value: -100 },
    { key: "manualCurveQuarter", x: 50, y: 50, value: 0 },
    { key: "manualCurveMid", x: 100, y: 25, value: 50 },
    { key: "manualCurveThreeQuarter", x: 150, y: 50, value: 0 },
    { key: "manualCurveWhite", x: 200, y: 0, value: 100 },
  ]);
  assert.match(
    imageEditsMod.photoImageManualCurveSvgPath({ manualCurveMid: 50 }, 200, 100),
    /^M 0 50 C 25 50, 25 50, 50 50 C 75 50, 75 25, 100 25/
  );
});

run("photo image edit operations normalize copied sidecars and labels", () => {
  const operation = imageEditsMod.normalizePhotoImageEditOperation({
    kind: "image_adjust",
    rotateDegrees: 450,
    straighten: 2.44,
    cropBox: { left: 10, top: 20, width: 50, height: 60 },
    cropAspect: "4x5",
    adjustments: { exposure: 0.55, contrast: 20 },
    filter: "Vivid Warm",
    flipHorizontal: "yes",
    renderQuality: 140,
    renderMaxDimension: -5,
  });
  assert.deepStrictEqual(operation, {
    kind: "image_crop_rotate",
    rotateDegrees: 90,
    straightenDegrees: 2.4,
    cropAspect: "portrait",
    flipHorizontal: true,
    flipVertical: false,
    renderQuality: 100,
    renderMaxDimension: 0,
    source: "photos-edit-clipboard",
    cropRect: { left: 10, top: 20, width: 50, height: 60 },
    adjustments: {
      exposure: 0.6,
      contrast: 20,
      highlights: 0,
      shadows: 0,
      brilliance: 0,
      blackPoint: 0,
      midtones: 0,
      whitePoint: 0,
      curveShadows: 0,
      curveMidtones: 0,
      curveHighlights: 0,
      curveRedShadows: 0,
      curveRedMidtones: 0,
      curveRedHighlights: 0,
      curveGreenShadows: 0,
      curveGreenMidtones: 0,
      curveGreenHighlights: 0,
      curveBlueShadows: 0,
      curveBlueMidtones: 0,
      curveBlueHighlights: 0,
      manualCurveBlack: 0,
      manualCurveQuarter: 0,
      manualCurveMid: 0,
      manualCurveThreeQuarter: 0,
      manualCurveWhite: 0,
      saturation: 0,
      warmth: 0,
      tint: 0,
      sharpness: 0,
      vignette: 0,
      noiseReduction: 0,
    },
    filterPreset: "vivid_warm",
    filterIntensity: 100,
  });
  assert.strictEqual(imageEditsMod.photoImageEditOperationActive(operation), true);
  assert.strictEqual(
    imageEditsMod.photoImageEditOperationLabel(operation),
    "R90 / S+2.4 / Box 10/20/50/60 / 4:5 / Adj E+0.6/C+20 / Filter Vivid Warm / H"
  );
  assert.strictEqual(imageEditsMod.normalizePhotoImageEditOperation({ cropAspect: "none" }), null);
});

run("photo edit stack info summary describes active image edits and versions", () => {
  const summary = imageEditsMod.photoEditStackInfoSummary({
    operations: [{ kind: "image_crop_rotate", rotateDegrees: 90, flipHorizontal: true }],
    updatedAt: "2026-06-28T08:00:00Z",
  }, [
    { label: "Version 1", operations: [{ kind: "image_crop_rotate", rotateDegrees: 90 }], createdAt: "2026-06-28T07:00:00Z" },
    { label: "Version 2", operations: [{ kind: "video_trim" }], updatedAt: "2026-06-28T08:30:00Z" },
  ], { formatDate: (value) => `date:${value}` });
  assert(summary, summary);
  assert.strictEqual(summary.hasActiveStack, true);
  assert.strictEqual(summary.operationCount, 1);
  assert.strictEqual(summary.versionCount, 2);
  assert.match(summary.text, /Active edit: 1 operation/);
  assert.match(summary.text, /R90/);
  assert.match(summary.text, /Updated date:2026-06-28T08:00:00Z/);
  assert.match(summary.text, /2 saved versions/);
});

run("photo edit stack info summary falls back for generic operations", () => {
  assert.strictEqual(
    imageEditsMod.photoEditStackOperationLabel([{ operationType: "video_trim_export" }]),
    "Video trim export",
  );
  const summary = imageEditsMod.photoEditStackInfoSummary({
    operations: [{ operationType: "video_trim_export" }],
  });
  assert(summary, summary);
  assert.match(summary.text, /Video trim export/);
});

run("photo edit stack helpers describe saved video edit timelines", () => {
  const operation = {
    kind: "video_trim_transform",
    startMs: 1000,
    endMs: 3000,
    sourceDurationMs: 4000,
    rotateDegrees: 90,
    cropAspect: "square",
    videoRenderFormat: "mp4",
    videoRenderQuality: "high",
    renderMaxDimension: 720,
    source: "unit-video-stack",
  };
  assert.strictEqual(
    imageEditsMod.photoEditStackOperationLabel([operation]),
    "Trim 1s-3s (2s of 4s) / R90 / 1:1 / MP4 high max 720px",
  );
  const summary = imageEditsMod.photoEditStackInfoSummary({
    operations: [operation],
    updatedAt: "2026-06-28T08:00:00Z",
  });
  assert(summary, summary);
  assert.match(summary.text, /Trim 1s-3s \(2s of 4s\)/);
  const operationRows = imageEditsMod.photoEditStackOperationHistoryRows({ operations: [operation] });
  assert.strictEqual(operationRows[0].operationLabel, "Trim 1s-3s (2s of 4s) / R90 / 1:1 / MP4 high max 720px");
  assert.strictEqual(operationRows[0].timelineLabel, "Trim 1s-3s (2s of 4s)");
  assert.strictEqual(operationRows[0].transformLabel, "R90 / 1:1");
  assert.strictEqual(operationRows[0].renderLabel, "MP4 high max 720px");
  assert.deepStrictEqual(operationRows[0].detailLabels, [
    "Timeline 1s-3s (2s of 4s)",
    "Transform R90 / 1:1",
    "Render MP4 high max 720px",
  ]);
  assert.strictEqual(operationRows[0].source, "unit-video-stack");
  const versionRows = imageEditsMod.photoEditStackVersionHistoryRows([
    { versionId: "video-v1", operations: [operation], updatedAt: "2026-06-28T08:30:00Z" },
  ]);
  assert.deepStrictEqual(versionRows[0].detailLabels, operationRows[0].detailLabels);
});

run("photo edit stack info summary distinguishes saved versions from active edits", () => {
  const summary = imageEditsMod.photoEditStackInfoSummary(null, [
    { label: "Snapshot A", operations: [{ kind: "image_crop_rotate", rotateDegrees: 180 }], createdAt: "2026-06-27T01:00:00Z" },
    { label: "Snapshot B", operations: [{ kind: "image_crop_rotate", rotateDegrees: 90 }], updatedAt: "2026-06-28T01:00:00Z" },
  ], { formatDate: (value) => `date:${value}` });
  assert(summary, summary);
  assert.strictEqual(summary.hasActiveStack, false);
  assert.strictEqual(summary.operationCount, 0);
  assert.strictEqual(summary.versionCount, 2);
  assert.match(summary.text, /No active edits/);
  assert.match(summary.text, /2 saved versions/);
  assert.match(summary.text, /Latest Snapshot B/);
  assert.match(summary.text, /Saved date:2026-06-28T01:00:00Z/);
  assert.strictEqual(imageEditsMod.photoEditStackInfoSummary(null, []), null);
});

run("photo edit stack version history rows describe every saved version", () => {
  const rows = imageEditsMod.photoEditStackVersionHistoryRows([
    {
      versionId: "v1",
      label: "Snapshot A",
      operations: [{ kind: "image_crop_rotate", rotateDegrees: 180 }],
      createdAt: "2026-06-27T01:00:00Z",
      sourceEditId: "edit-one",
    },
    {
      versionId: "v2",
      operations: [{ operationType: "video_trim_export" }],
      updatedAt: "2026-06-28T01:00:00Z",
    },
  ], { formatDate: (value) => `date:${value}`, selectedVersionId: "v2" });
  assert.deepStrictEqual(rows.map((row) => row.id), ["v1", "v2"]);
  assert.strictEqual(rows[0].label, "Snapshot A");
  assert.strictEqual(rows[0].operationCount, 1);
  assert.match(rows[0].operationLabel, /R180/);
  assert.strictEqual(rows[0].savedAt, "date:2026-06-27T01:00:00Z");
  assert.strictEqual(rows[0].sourceEditId, "edit-one");
  assert.strictEqual(rows[0].selected, false);
  assert.strictEqual(rows[1].label, "Version 2");
  assert.strictEqual(rows[1].operationLabel, "Video trim export");
  assert.strictEqual(rows[1].selected, true);
});

run("photo edit stack operation history rows describe the active stack", () => {
  const rows = imageEditsMod.photoEditStackOperationHistoryRows({
    operations: [
      {
        operationId: "op-one",
        kind: "image_crop_rotate",
        rotateDegrees: 90,
        source: "unit-save",
      },
      {
        operationType: "video_trim_export",
      },
    ],
  });
  assert.deepStrictEqual(rows.map((row) => row.id), ["op-one", "operation-2"]);
  assert.strictEqual(rows[0].stepLabel, "Step 1");
  assert.strictEqual(rows[0].kindLabel, "Image crop rotate");
  assert.match(rows[0].operationLabel, /R90/);
  assert.strictEqual(rows[0].source, "unit-save");
  assert.strictEqual(rows[1].stepLabel, "Step 2");
  assert.strictEqual(rows[1].kindLabel, "Video trim export");
  assert.strictEqual(rows[1].operationLabel, "Video trim export");
});

run("photo image adjustment paste preserves target transforms", () => {
  const target = imageEditsMod.normalizePhotoImageEditOperation({
    rotateDegrees: 90,
    cropAspect: "3:2",
    filterPreset: "noir",
    filterIntensity: 50,
    flipVertical: true,
    adjustments: { exposure: -0.5 },
  });
  const copied = imageEditsMod.normalizePhotoImageEditOperation({
    adjustments: { exposure: 0.7, contrast: 20, warmth: 10 },
    filterPreset: "vivid",
  });
  const merged = imageEditsMod.mergePhotoImageAdjustmentPasteOperation(target, copied, "unit-adjustment-paste");
  assert.deepStrictEqual(merged, {
    kind: "image_crop_rotate",
    rotateDegrees: 90,
    straightenDegrees: 0,
    cropAspect: "3:2",
    flipHorizontal: false,
    flipVertical: true,
    renderQuality: 88,
    renderMaxDimension: 1600,
    source: "unit-adjustment-paste",
    adjustments: {
      exposure: 0.7,
      contrast: 20,
      highlights: 0,
      shadows: 0,
      brilliance: 0,
      blackPoint: 0,
      midtones: 0,
      whitePoint: 0,
      curveShadows: 0,
      curveMidtones: 0,
      curveHighlights: 0,
      curveRedShadows: 0,
      curveRedMidtones: 0,
      curveRedHighlights: 0,
      curveGreenShadows: 0,
      curveGreenMidtones: 0,
      curveGreenHighlights: 0,
      curveBlueShadows: 0,
      curveBlueMidtones: 0,
      curveBlueHighlights: 0,
      manualCurveBlack: 0,
      manualCurveQuarter: 0,
      manualCurveMid: 0,
      manualCurveThreeQuarter: 0,
      manualCurveWhite: 0,
      saturation: 0,
      warmth: 10,
      tint: 0,
      sharpness: 0,
      vignette: 0,
      noiseReduction: 0,
    },
    filterPreset: "noir",
    filterIntensity: 50,
  });
  assert.strictEqual(imageEditsMod.photoImageEditOperationHasAdjustments(copied), true);
  assert.strictEqual(imageEditsMod.mergePhotoImageAdjustmentPasteOperation(target, { filterPreset: "noir" }), null);
});

run("photo image markup annotations normalize and survive adjustment paste", () => {
  const draft = imageEditsMod.normalizePhotoImageMarkupDraftAnnotation({
    kind: "text",
    text: "",
    left: 44.44,
    top: 22.22,
  });
  assert.deepStrictEqual(draft, {
    kind: "text",
    left: 44.4,
    top: 22.2,
    width: 42,
    height: 14,
    color: "#ffffff",
    backgroundColor: "#111827",
    opacity: 78,
    fontSize: 5,
  });
  assert.strictEqual(imageEditsMod.normalizePhotoImageMarkupAnnotation(draft), null);
  const operation = imageEditsMod.normalizePhotoImageEditOperation({
    markupAnnotations: [
      {
        kind: "text",
        text: "  Review this face  ",
        left: -5,
        top: 12.34,
        width: 180,
        height: 8,
        color: "facc15",
        backgroundColor: "#0f172a",
        opacity: 105,
        fontSize: 7,
      },
      {
        kind: "rectangle",
        left: 20,
        top: 30,
        width: 15,
        height: 10,
        color: "bad",
      },
      { kind: "text", text: "" },
    ],
  });
  assert.deepStrictEqual(operation, {
    kind: "image_crop_rotate",
    rotateDegrees: 0,
    straightenDegrees: 0,
    cropAspect: "none",
    flipHorizontal: false,
    flipVertical: false,
    renderQuality: 88,
    renderMaxDimension: 1600,
    source: "photos-edit-clipboard",
    markup: [
      {
        kind: "text",
        text: "Review this face",
        left: 0,
        top: 12.3,
        width: 100,
        height: 8,
        color: "#facc15",
        backgroundColor: "#0f172a",
        opacity: 100,
        fontSize: 7,
      },
      {
        kind: "rectangle",
        left: 20,
        top: 30,
        width: 15,
        height: 10,
        color: "#ffffff",
        backgroundColor: "#111827",
        opacity: 78,
        fontSize: 5,
      },
    ],
  });
  assert.strictEqual(imageEditsMod.photoImageMarkupActive(operation.markup), true);
  assert.strictEqual(imageEditsMod.photoImageMarkupLabel(operation.markup), "Markup 2");
  assert.strictEqual(imageEditsMod.photoImageEditOperationLabel(operation), "R0 / Original / Markup 2 / No flip");
  const shapeOperation = imageEditsMod.normalizePhotoImageEditOperation({
    markup: [
      { kind: "ellipse", left: 5, top: 5, width: 20, height: 20, backgroundColor: "#3b82f6" },
      { kind: "line", left: 8, top: 80, width: 30, height: 1, color: "#ef4444" },
      { kind: "arrow", left: 50, top: 80, width: 35, height: 1, color: "#22c55e" },
    ],
  });
  assert.deepStrictEqual(shapeOperation.markup.map((annotation) => annotation.kind), ["ellipse", "line", "arrow"]);
  assert.strictEqual(imageEditsMod.photoImageMarkupLabel(shapeOperation.markup), "Markup 3");
  assert.deepStrictEqual(
    imageEditsMod.normalizePhotoImageMarkupAnnotation({
      kind: "draw",
      points: [[10, 20], { x: 30.04, y: 35.06 }, { left: 50, top: 25 }],
      color: "#22c55e",
    }),
    {
      kind: "freehand",
      points: [{ x: 10, y: 20 }, { x: 30, y: 35.1 }, { x: 50, y: 25 }],
      left: 10,
      top: 20,
      width: 40,
      height: 15.1,
      color: "#22c55e",
      backgroundColor: "#111827",
      opacity: 78,
      fontSize: 5,
    }
  );
  assert.strictEqual(imageEditsMod.normalizePhotoImageMarkupAnnotation({ kind: "signature", points: [{ x: 10, y: 20 }] }), null);
  assert.strictEqual(
    imageEditsMod.photoImageMarkupHitTest({ kind: "rectangle", left: 10, top: 10, width: 20, height: 20 }, { x: 10, y: 10 }),
    "nw"
  );
  assert.strictEqual(
    imageEditsMod.photoImageMarkupHitTest({ kind: "rectangle", left: 10, top: 10, width: 20, height: 20 }, { x: 15, y: 16 }),
    "move"
  );
  assert.strictEqual(
    imageEditsMod.photoImageMarkupHitTest({ kind: "rectangle", left: 10, top: 10, width: 20, height: 20 }, { x: 80, y: 80 }),
    null
  );
  const draggedMarkup = imageEditsMod.photoImageMarkupAnnotationFromDrag(
    "move",
    { x: 10, y: 10 },
    { x: 22, y: 18 },
    { kind: "arrow", left: 20, top: 30, width: 24, height: 8, color: "#22c55e" }
  );
  assert.strictEqual(draggedMarkup.left, 32);
  assert.strictEqual(draggedMarkup.top, 38);
  assert.strictEqual(draggedMarkup.kind, "arrow");
  const resizedMarkup = imageEditsMod.photoImageMarkupAnnotationFromDrag(
    "se",
    { x: 0, y: 0 },
    { x: 70, y: 80 },
    { kind: "ellipse", left: 20, top: 30, width: 24, height: 8, backgroundColor: "#3b82f6" }
  );
  assert.strictEqual(resizedMarkup.width, 50);
  assert.strictEqual(resizedMarkup.height, 50);
  const movedStroke = imageEditsMod.photoImageMarkupAnnotationFromDrag(
    "move",
    { x: 20, y: 20 },
    { x: 25, y: 30 },
    { kind: "freehand", points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 10 }], color: "#22c55e" }
  );
  assert.deepStrictEqual(movedStroke.points, [{ x: 15, y: 20 }, { x: 25, y: 30 }, { x: 35, y: 20 }]);
  assert.strictEqual(movedStroke.left, 15);
  assert.strictEqual(movedStroke.top, 20);
  const savedSignature = imageEditsMod.photoImageSignaturePresetFromAnnotation(movedStroke, {
    id: "sig-1",
    name: "Primary signature",
    createdAt: "2026-06-25T00:00:00Z",
  });
  assert.deepStrictEqual(savedSignature, {
    id: "sig-1",
    name: "Primary signature",
    points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
    color: "#22c55e",
    opacity: 78,
    aspectRatio: 2,
    createdAt: "2026-06-25T00:00:00Z",
  });
  assert.deepStrictEqual(
    imageEditsMod.photoImageMarkupSignatureAnnotationFromPreset(savedSignature, { left: 10, top: 70, width: 40, height: 10 }),
    {
      kind: "signature",
      points: [{ x: 10, y: 70 }, { x: 30, y: 80 }, { x: 50, y: 70 }],
      left: 10,
      top: 70,
      width: 40,
      height: 10,
      color: "#22c55e",
      backgroundColor: "#111827",
      opacity: 78,
      fontSize: 5,
    }
  );
  assert.deepStrictEqual(
    imageEditsMod.normalizePhotoImageSignaturePresets([savedSignature, savedSignature, { id: "bad", points: [{ x: 1, y: 2 }] }]).map((preset) => preset.id),
    ["sig-1"]
  );
  const merged = imageEditsMod.mergePhotoImageAdjustmentPasteOperation(
    operation,
    { adjustments: { exposure: 0.4 } },
    "unit-markup-adjustment-paste"
  );
  assert.deepStrictEqual(merged.markup, operation.markup);
  assert.strictEqual(merged.adjustments.exposure, 0.4);
});

run("photo image retouch spots normalize and survive adjustment paste", () => {
  const operation = imageEditsMod.normalizePhotoImageEditOperation({
    kind: "image_retouch",
    retouchSpots: [
      {
        kind: "red-eye",
        left: 44.44,
        top: 22.22,
        width: 8.88,
        height: 9.99,
        strength: 120,
      },
      {
        type: "clone",
        x: 70,
        y: 20,
        size: 12,
        sourceLeft: 50,
        sourceTop: 20,
        amount: 55,
      },
      { kind: "heal", left: -5, top: 95, width: 40, height: 40, strength: 0 },
    ],
  });
  assert.deepStrictEqual(operation, {
    kind: "image_crop_rotate",
    rotateDegrees: 0,
    straightenDegrees: 0,
    cropAspect: "none",
    flipHorizontal: false,
    flipVertical: false,
    renderQuality: 88,
    renderMaxDimension: 1600,
    source: "photos-edit-clipboard",
    retouch: [
      {
        kind: "red_eye",
        left: 44.4,
        top: 22.2,
        width: 8.9,
        height: 10,
        strength: 100,
      },
      {
        kind: "clone",
        left: 70,
        top: 20,
        width: 12,
        height: 12,
        strength: 55,
        sourceLeft: 50,
        sourceTop: 20,
      },
    ],
  });
  assert.strictEqual(imageEditsMod.photoImageRetouchActive(operation.retouch), true);
  assert.strictEqual(imageEditsMod.photoImageRetouchLabel(operation.retouch), "Red-eye 1 / Clone 1");
  assert.strictEqual(imageEditsMod.photoImageEditOperationLabel(operation), "R0 / Original / Red-eye 1 / Clone 1 / No flip");
  assert.deepStrictEqual(
    imageEditsMod.normalizePhotoImageRetouchSpot({ kind: "cleanup", left: 96, top: 98, width: 10, height: 20 }),
    {
      kind: "blemish",
      left: 96,
      top: 98,
      width: 4,
      height: 2,
      strength: 80,
    }
  );
  const cappedSpots = imageEditsMod.normalizePhotoImageRetouchSpots(Array.from({ length: 30 }, (_, index) => ({
    kind: "blemish",
    left: index,
    top: index,
    width: 4,
    height: 4,
    strength: 80,
  })));
  assert.strictEqual(cappedSpots.length, imageEditsMod.PHOTO_IMAGE_RETOUCH_SPOT_LIMIT);
  const brushSpots = imageEditsMod.photoImageRetouchBrushSpotsFromPoints(
    [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 20, y: 20 },
      { x: 95, y: 96 },
    ],
    {
      kind: "blemish",
      width: 10,
      height: 8,
      strength: 60,
      existingCount: 22,
    }
  );
  assert.deepStrictEqual(brushSpots, [
    {
      kind: "blemish",
      left: 0,
      top: 0,
      width: 10,
      height: 8,
      strength: 60,
    },
    {
      kind: "blemish",
      left: 15,
      top: 16,
      width: 10,
      height: 8,
      strength: 60,
    },
  ]);
  const cloneBrushSpots = imageEditsMod.photoImageRetouchBrushSpotsFromPoints(
    [
      { x: 50, y: 50 },
      { x: 70, y: 50 },
    ],
    {
      kind: "clone",
      left: 40,
      top: 40,
      width: 10,
      height: 10,
      sourceLeft: 24,
      sourceTop: 42,
    }
  );
  assert.deepStrictEqual(cloneBrushSpots, [
    {
      kind: "clone",
      left: 45,
      top: 45,
      width: 10,
      height: 10,
      strength: 80,
      sourceLeft: 29,
      sourceTop: 47,
    },
    {
      kind: "clone",
      left: 65,
      top: 45,
      width: 10,
      height: 10,
      strength: 80,
      sourceLeft: 49,
      sourceTop: 47,
    },
  ]);
  const merged = imageEditsMod.mergePhotoImageAdjustmentPasteOperation(
    operation,
    { adjustments: { exposure: 0.4 } },
    "unit-retouch-adjustment-paste"
  );
  assert.deepStrictEqual(merged.retouch, operation.retouch);
  assert.strictEqual(merged.adjustments.exposure, 0.4);
});

run("Photos retouch brush controls are wired to the lightbox stage", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.match(source, /uiText\("Brush retouch spots"\)/);
  assert.match(source, /uiText\("Pick clone source"\)/);
  assert.match(source, /pickImageRetouchCloneSource/);
  assert.match(source, /photoImageRetouchBrushSpotsFromPoints/);
  assert.match(source, /beginImageRetouchBrushDraw/);
  assert.match(source, /updateImageRetouchBrushDraw/);
  assert.match(source, /endImageRetouchBrushDraw/);
  assert.match(source, /imageRetouchOverlayBoxes/);
  assert.match(source, /imageRetouchCloneSourceOverlayBox/);
  assert.match(source, /retouch-brush-active/);
  assert.match(source, /retouch-source-picking/);
  assert.match(styles, /\.photos-lightbox-stage\.retouch-brush-active/);
  assert.match(styles, /\.photos-lightbox-stage\.retouch-source-picking/);
  assert.match(styles, /\.photos-edit-retouch-source-overlay/);
  assert.match(styles, /\.photos-edit-retouch-overlay:not\(\.selected\)/);
});

run("photo image edit clipboard history persists normalized copied edits", () => {
  const first = imageEditsMod.normalizePhotoImageEditOperation({
    rotateDegrees: 90,
    adjustments: { exposure: 0.5 },
  });
  const second = imageEditsMod.normalizePhotoImageEditOperation({
    cropAspect: "square",
    filterPreset: "noir",
  });
  const history = imageEditsMod.upsertPhotoImageEditClipboardHistory([], first, {
    copiedAt: "2026-06-25T01:00:00Z",
    id: "first",
  });
  assert.strictEqual(history.length, 1);
  assert.strictEqual(history[0].label, "R90 / Original / Adj E+0.5 / No flip");
  const updated = imageEditsMod.upsertPhotoImageEditClipboardHistory(history, second, {
    copiedAt: "2026-06-25T02:00:00Z",
    id: "second",
  });
  assert.deepStrictEqual(updated.map((entry) => entry.id), ["second", "first"]);
  const deduped = imageEditsMod.upsertPhotoImageEditClipboardHistory(updated, { ...first, source: "repeat-copy" }, {
    copiedAt: "2026-06-25T03:00:00Z",
    id: "first-again",
  });
  assert.deepStrictEqual(deduped.map((entry) => entry.id), ["first-again", "second"]);
  assert.strictEqual(
    imageEditsMod.normalizePhotoImageEditClipboardHistory([...deduped, { operation: null }], 1).length,
    1
  );
  assert.deepStrictEqual(
    imageEditsMod.deletePhotoImageEditClipboardHistoryEntry(deduped, "first-again").map((entry) => entry.id),
    ["second"]
  );
  assert.strictEqual(
    imageEditsMod.photoImageEditOperationsEquivalent(
      { ...first, source: "copy-a" },
      { ...first, source: "copy-b" }
    ),
    true
  );
  assert.strictEqual(imageEditsMod.photoImageEditOperationsEquivalent(first, second), false);
});

run("photoShortcutForKeyboardEvent maps Photos commands", () => {
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "f", metaKey: true }), "focusSearch");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "a", ctrlKey: true }), "selectPage");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "i", metaKey: true }), "openInfo");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "f" }), "toggleFavorite");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "h" }), "toggleHidden");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "Delete" }), "delete");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "Backspace" }), "delete");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "Enter", ctrlKey: true }), "mergeDuplicateGroups");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "?", shiftKey: true }), "toggleShortcutDiscovery");
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "/", shiftKey: true }), "toggleShortcutDiscovery");
  assert.ok(keyboardMod.PHOTO_SHORTCUT_DISCOVERY_GROUPS.some((group) => (
    group.id === "library"
    && group.items.some((item) => item.command === "toggleShortcutDiscovery" && item.keys.includes("?"))
  )));
});

run("photoImageEditShortcutForKeyboardEvent maps editable lightbox commands", () => {
  const ready = { canEdit: true, hasActiveEdit: true, saving: false };
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "s", metaKey: true }, ready), "save");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "S", ctrlKey: true }, ready), "save");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r" }, ready), "rotate");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "c" }, ready), "cycleCrop");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "x" }, ready), "flipHorizontal");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "y" }, ready), "flipVertical");
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "s", metaKey: true }, { ...ready, hasActiveEdit: false }), null);
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r" }, { ...ready, canEdit: false }), null);
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r" }, { ...ready, saving: true }), null);
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r", repeat: true }, ready), null);
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r", shiftKey: true }, ready), null);
  assert.strictEqual(keyboardMod.photoImageEditShortcutForKeyboardEvent({ key: "r", target: { tagName: "INPUT" } }, ready), null);
});

run("photoVideoShortcutForKeyboardEvent maps video lightbox commands", () => {
  const ready = { canEdit: true, hasTransform: true };
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "[" }, ready), "markTrimStart");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "", code: "BracketLeft" }, ready), "markTrimStart");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "]" }, ready), "markTrimEnd");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "", code: "BracketRight" }, ready), "markTrimEnd");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "ArrowLeft", shiftKey: true }, ready), "scrubBackward");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "ArrowRight", shiftKey: true }, ready), "scrubForward");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "r" }, ready), "rotateVideo");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "R", shiftKey: true }, ready), "resetVideoTransform");
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "R", shiftKey: true }, { ...ready, hasTransform: false }), null);
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "[" }, { ...ready, canEdit: false }), null);
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "r", repeat: true }, ready), null);
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "r", metaKey: true }, ready), null);
  assert.strictEqual(keyboardMod.photoVideoShortcutForKeyboardEvent({ key: "r", target: { tagName: "INPUT" } }, ready), null);
  assert.ok(keyboardMod.PHOTO_SHORTCUT_DISCOVERY_GROUPS.some((group) => (
    group.id === "lightbox"
    && group.items.some((item) => item.command === "markTrimStart" && item.keys.includes("["))
    && group.items.some((item) => item.command === "scrubForward" && item.keys.includes("Shift-Right Arrow"))
    && group.items.some((item) => item.command === "resetVideoTransform" && item.keys.includes("Shift-R"))
  )));
});

run("photo shortcuts ignore typing targets except search command", () => {
  const input = { tagName: "INPUT" };
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "a", metaKey: true, target: input }), null);
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "f", target: input }), null);
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "?", shiftKey: true, target: input }), null);
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "f", metaKey: true, target: input }), "focusSearch");
  assert.strictEqual(keyboardMod.isPhotoShortcutTypingTarget({ tagName: "TEXTAREA" }), true);
  assert.strictEqual(keyboardMod.isPhotoShortcutTypingTarget({ tagName: "DIV", isContentEditable: true }), true);
  assert.strictEqual(keyboardMod.isPhotoShortcutTypingTarget({ tagName: "INPUT", type: "checkbox" }), false);
  assert.strictEqual(keyboardMod.photoShortcutForKeyboardEvent({ key: "Delete", target: { tagName: "INPUT", type: "checkbox" } }), "delete");
});

run("keyword shortcuts normalize labels and keyboard events", () => {
  assert.strictEqual(keyboardMod.normalizePhotoKeywordShortcut("Shift + B"), "shift+b");
  assert.strictEqual(keyboardMod.normalizePhotoKeywordShortcut("⌘K"), "mod+k");
  assert.strictEqual(keyboardMod.normalizePhotoKeywordShortcut("ctrl-alt-1"), "mod+alt+1");
  assert.strictEqual(keyboardMod.photoKeywordShortcutForKeyboardEvent({ key: "B", shiftKey: true }), "shift+b");
  assert.strictEqual(keyboardMod.photoKeywordShortcutForKeyboardEvent({ key: "k", metaKey: true }), "mod+k");
  assert.strictEqual(keyboardMod.photoKeywordShortcutForKeyboardEvent({ key: " ", altKey: true }), "alt+space");
});

run("keyword shortcut resolver ignores typing targets and matches first keyword", () => {
  const keywords = [
    { name: "Beach", shortcut: "b" },
    { name: "Birthday", shortcut: "Shift+B" },
  ];
  assert.deepStrictEqual(keyboardMod.resolvePhotoKeywordShortcut(keywords, { key: "b" }), keywords[0]);
  assert.deepStrictEqual(keyboardMod.resolvePhotoKeywordShortcut(keywords, { key: "B", shiftKey: true }), keywords[1]);
  assert.strictEqual(keyboardMod.resolvePhotoKeywordShortcut(keywords, { key: "b", target: { tagName: "INPUT" } }), null);
  assert.strictEqual(keyboardMod.resolvePhotoKeywordShortcut([{ name: "Empty", shortcut: "" }], { key: "e" }), null);
});

run("thumbnail size clamps into supported density range", () => {
  assert.strictEqual(thumbnailMod.clampPhotoThumbnailSize(32), thumbnailMod.PHOTO_THUMBNAIL_MIN_SIZE);
  assert.strictEqual(thumbnailMod.clampPhotoThumbnailSize(400), thumbnailMod.PHOTO_THUMBNAIL_MAX_SIZE);
  assert.strictEqual(thumbnailMod.clampPhotoThumbnailSize("160"), 160);
  assert.strictEqual(thumbnailMod.clampPhotoThumbnailSize("nope"), thumbnailMod.DEFAULT_PHOTO_THUMBNAIL_SIZE);
});

run("photoThumbnailAspectRatio uses dimensions with safe bounds", () => {
  assert.strictEqual(thumbnailMod.photoThumbnailAspectRatio({ width: 400, height: 200 }), "2 / 1");
  assert.strictEqual(thumbnailMod.photoThumbnailAspectRatio({ width: 100, height: 300 }), "0.667 / 1");
  assert.strictEqual(thumbnailMod.photoThumbnailAspectRatio({ width: 0, height: 300 }), "1 / 1");
});

run("buildPhotoSearchSuggestions collects local suggestion sources", () => {
  const suggestions = searchMod.buildPhotoSearchSuggestions({
    suggestions: ["Harbor Point", "Harbor"],
    people: ["Ada", "Ada"],
    folders: [{ name: "Summer", mediaKind: "video", place: { label: "Lisbon" } }],
    keywords: [{ name: "beach" }],
    items: [{
      sourcePath: "/photos/IMG_1234.jpg",
      title: "Harbor",
      caption: "Blue hour",
      keywords: ["sunset"],
      mediaKind: "raw",
      captureDate: "2026-06-19T12:00:00Z",
      locationOverride: { label: "Alfama" },
      assetMetadata: {
        modelTags: ["boats"],
        ocrText: "ticket",
        detectedText: "boarding pass",
        objectTags: [{ label: "sailboat", confidence: 0.92 }],
        sceneTags: ["marina"],
        detectedEvents: { regatta: 0.8 },
        accessibilityDescription: "screen reader harbor description",
        descriptionRegions: [{ text: "lifeboat station sign", x: 10, y: 12, width: 20, height: 8 }],
        localDepthControls: { modeLabel: "Portrait", effect: "Studio Light", aperture: "2.8", focusDistance: "0.9" },
        photographicStyle: "Rich Contrast",
        colorProfile: "Display P3",
        codec: "HEVC",
        deviceModel: "iPhone 15 Pro",
        cinematicMode: "Cinematic",
        depthMap: { label: "Depth map available" },
        video: { codecName: "H.265", format: "QuickTime" },
        probe: { audioCodec: "AAC" },
        xmp: { cameraStyle: "Standard", portraitEffect: "Portrait matte", colorSpace: "Dolby Vision HDR" },
      },
    }],
  });
  assert.deepStrictEqual(suggestions.slice(0, 8), ["Harbor Point", "Harbor", "Ada", "Summer", "Lisbon", "Videos", "beach", "Blue hour"]);
  assert.ok(suggestions.includes("2026"));
  assert.ok(suggestions.includes("2026-06"));
  assert.ok(suggestions.includes("2026-06-19"));
  assert.ok(suggestions.includes("IMG_1234"));
  assert.ok(suggestions.includes("boats"));
  assert.ok(suggestions.includes("ticket"));
  assert.ok(suggestions.includes("boarding pass"));
  assert.ok(suggestions.includes("sailboat"));
  assert.ok(suggestions.includes("marina"));
  assert.ok(suggestions.includes("regatta"));
  assert.ok(suggestions.includes("screen reader harbor description"));
  assert.ok(suggestions.includes("lifeboat station sign"));
  assert.ok(suggestions.includes("Portrait"));
  assert.ok(suggestions.includes("Studio Light"));
  assert.ok(suggestions.includes("Rich Contrast"));
  assert.ok(suggestions.includes("Standard"));
  assert.ok(suggestions.includes("Display P3"));
  assert.ok(suggestions.includes("HEVC"));
  assert.ok(suggestions.includes("iPhone 15 Pro"));
  assert.ok(suggestions.includes("H.265"));
  assert.ok(suggestions.includes("QuickTime"));
  assert.ok(suggestions.includes("AAC"));
  assert.ok(suggestions.includes("Dolby Vision HDR"));
  assert.ok(suggestions.includes("Cinematic"));
  assert.ok(suggestions.includes("Depth map available"));
  assert.ok(suggestions.includes("Portrait matte"));
});

run("buildPhotoSearchSuggestions respects limits", () => {
  assert.deepStrictEqual(
    searchMod.buildPhotoSearchSuggestions({ people: ["Ada", "Grace", "Linus"], limit: 2 }),
    ["Ada", "Grace"],
  );
});

run("buildPhotoSearchSuggestions demotes feature-less local topics", () => {
  const suggestions = searchMod.buildPhotoSearchSuggestions({
    suggestions: ["Harbor Guest"],
    items: [
      {
        title: "Harbor picnic",
        caption: "Blue hour",
        personName: "Harbor Guest",
        people: [{ personName: "Harbor Guest" }],
        mediaKind: "image",
      },
      {
        title: "Harbor neutral",
        caption: "Open water",
        mediaKind: "image",
      },
    ],
    curationPreferences: {
      featureLessPeople: ["Harbor Guest"],
      featureLessPlaces: [],
      featureLessDates: [],
      featureLessContent: [],
      favoriteMemories: [],
      hiddenMemories: [],
      memoryRemovedItems: {},
      updatedAt: "",
    },
    limit: 5,
  });
  assert.ok(suggestions.indexOf("Harbor Guest") > suggestions.indexOf("Harbor neutral"));
  assert.ok(suggestions.indexOf("Harbor picnic") > suggestions.indexOf("Harbor neutral"));
});

run("buildPhotoSearchHighlightParts marks repeated query matches", () => {
  assert.deepStrictEqual(
    searchHighlightsMod.buildPhotoSearchHighlightParts("Detected text: Ticket code ticket-42", "ticket"),
    [
      { text: "Detected text: ", match: false },
      { text: "Ticket", match: true },
      { text: " code ", match: false },
      { text: "ticket", match: true },
      { text: "-42", match: false },
    ],
  );
  assert.deepStrictEqual(searchHighlightsMod.buildPhotoSearchHighlightParts("Plain", "x"), [{ text: "Plain", match: false }]);
});

run("buildPhotoQrActions derives local QR actions from decoded metadata", () => {
  const actions = qrActionsMod.buildPhotoQrActions({
    assetMetadata: {
      qrText: "www.example.com/ticket",
      barcodeConfidence: 0.92,
      barcodes: [
        { text: "hello@example.com" },
        { value: "tel:+1 415 555 0100" },
        { payload: "BEGIN:VCARD\\nFN:Ada\\nEND:VCARD" },
      ],
    },
  });
  assert.deepStrictEqual(actions.map((action) => [action.kind, action.copyLabel, action.value, action.href, action.confidence]), [
    ["url", "Copy URL", "https://www.example.com/ticket", "https://www.example.com/ticket", "92%"],
    ["email", "Copy email", "hello@example.com", "mailto:hello@example.com", "92%"],
    ["phone", "Copy phone", "+1 415 555 0100", "tel:+14155550100", "92%"],
    ["contact", "Copy contact", "BEGIN:VCARD\\nFN:Ada\\nEND:VCARD", undefined, "92%"],
  ]);
});

run("buildPhotoQrActions dedupes text payloads and ignores missing metadata", () => {
  assert.deepStrictEqual(qrActionsMod.buildPhotoQrActions(null), []);
  assert.deepStrictEqual(qrActionsMod.buildPhotoQrActions({ assetMetadata: { qrText: "plain locker code", decodedText: "plain locker code" } }), [
    {
      kind: "text",
      label: "QR text",
      copyLabel: "Copy text",
      value: "plain locker code",
      confidence: "",
    },
  ]);
});

run("buildPhotoQrRegions normalizes QR bounds from local metadata", () => {
  const regions = qrActionsMod.buildPhotoQrRegions({
    width: 400,
    height: 200,
    assetMetadata: {
      barcodeConfidence: 0.88,
      qrRegions: [
        {
          text: "https://example.com/pass",
          x: 10,
          y: 20,
          width: 30,
          height: 25,
          source: "opencv",
        },
      ],
      barcodes: [
        {
          text: "PIXEL-CODE",
          type: "Code 128",
          confidence: 0.66,
          bounds: { x: 200, y: 50, width: 100, height: 60 },
        },
        {
          text: "https://example.com/pass",
          bounds: { x: 10, y: 20, width: 30, height: 25 },
        },
      ],
    },
  });
  assert.deepStrictEqual(regions.map((region) => [
    region.id,
    region.text,
    region.type,
    region.x,
    region.y,
    region.width,
    region.height,
    region.confidence,
    region.source,
  ]), [
    ["qr-region-0", "https://example.com/pass", "QR Code", 10, 20, 30, 25, "88%", "opencv"],
    ["qr-region-1", "PIXEL-CODE", "Code 128", 50, 25, 25, 30, "66%", ""],
  ]);
});

run("buildPhotoLiveTextActions derives copy and detected contact actions", () => {
  const actions = liveTextActionsMod.buildPhotoLiveTextActions({
    assetMetadata: {
      ocrText: "Ada Lovelace\nVisit www.example.com or email HELLO@EXAMPLE.COM.",
      textBlocks: [
        { text: "Call +1 (415) 555-0199 today." },
        { text: "Visit www.example.com" },
      ],
    },
  });
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "url", "email", "phone", "contact"]);
  assert.strictEqual(actions[0].copyLabel, "Copy detected text");
  assert.strictEqual(actions[1].value, "https://www.example.com");
  assert.strictEqual(actions[2].value, "hello@example.com");
  assert.strictEqual(actions[3].href, "tel:+14155550199");
  assert.strictEqual(actions[4].label, "Save contact card");
  assert.strictEqual(actions[4].copyLabel, "Copy contact");
  assert.match(actions[4].href, /^data:text\/vcard;charset=utf-8,/);
  assert.strictEqual(actions[4].downloadName, "ada-lovelace.vcf");
  assert.match(actions[4].value, /BEGIN:VCARD\nVERSION:3\.0\nFN:Ada Lovelace\nEMAIL:hello@example\.com\nTEL:\+1 \(415\) 555-0199\nEND:VCARD/);
  assert.strictEqual(decodeURIComponent(actions[4].href.split(",", 2)[1]), actions[4].value);
});

run("buildPhotoLiveTextActionsForText targets selected region text", () => {
  const actions = liveTextActionsMod.buildPhotoLiveTextActionsForText("Selected code www.example.com hello@example.com", {
    label: "Selected text",
    copyLabel: "Copy selected text",
  });
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "url", "email", "contact"]);
  assert.strictEqual(actions[0].label, "Selected text");
  assert.strictEqual(actions[0].copyLabel, "Copy selected text");
  assert.strictEqual(actions[1].value, "https://www.example.com");
  assert.strictEqual(actions[3].label, "Save contact card");
  assert.strictEqual(actions[3].copyLabel, "Copy contact");
  assert.match(actions[3].href, /^data:text\/vcard;charset=utf-8,/);
  assert.strictEqual(actions[3].downloadName, "selected-code.vcf");
  assert.match(actions[3].value, /EMAIL:hello@example\.com/);
});

run("buildPhotoLiveTextActions ignores photos without detected text", () => {
  assert.deepStrictEqual(liveTextActionsMod.buildPhotoLiveTextActions({ assetMetadata: { labels: ["receipt"] } }), []);
});

run("buildPhotoLiveTextRegions normalizes metadata bounds", () => {
  const regions = liveTextActionsMod.buildPhotoLiveTextRegions({
    width: 400,
    height: 200,
    assetMetadata: {
      textRegions: [
        { text: "Gate A", bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, confidence: 0.92 },
        { text: "Seat 12", bbox: [200, 50, 100, 40], confidence: 88 },
        { text: "Bad", bounds: { x: 0, y: 0, width: 0, height: 0 } },
        { text: "Gate A", bounds: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, confidence: 0.92 },
      ],
    },
  });
  assert.deepStrictEqual(regions.map((region) => [region.text, region.x, region.y, region.width, region.height, region.confidence]), [
    ["Gate A", 10, 20, 30, 10, "92%"],
    ["Seat 12", 50, 25, 25, 20, "88%"],
  ]);
});

run("Photos Live Text region summary is wired for inspector selection", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /uiText\("Live Text regions"\)/);
  assert.match(source, /uiText\("Select Live Text snippet"\)/);
  assert.match(source, /photos-live-text-region-summary/);
  assert.match(source, /aria-pressed=\{selectedLiveTextRegionId === region\.id\}/);
});

run("photoLiveTextRegionStageBox accounts for fit and fill placement", () => {
  const region = { x: 10, y: 20, width: 30, height: 10 };
  assert.deepStrictEqual(
    liveTextActionsMod.photoLiveTextRegionStageBox(region, 400, 200, 800, 800, "fit"),
    { left: 10, top: 35, width: 30, height: 5 },
  );
  assert.deepStrictEqual(
    liveTextActionsMod.photoLiveTextRegionStageBox(region, 400, 200, 800, 800, "fill"),
    { left: -30, top: 20, width: 60, height: 10 },
  );
});

run("photo description regions normalize metadata and serialize drafts", () => {
  const regions = descriptionRegionsMod.buildPhotoDescriptionRegions({
    width: 400,
    height: 200,
    assetMetadata: {
      descriptionRegions: [
        { text: "Face in mirror", bounds: { x: 0.1, y: 0.2, width: 0.25, height: 0.3 }, confidence: 0.87 },
        { description: "Street sign", bbox: [200, 50, 100, 40], confidence: "manual" },
        { text: "Face in mirror", bounds: { x: 0.1, y: 0.2, width: 0.25, height: 0.3 }, confidence: 0.87 },
        { text: "", x: 2, y: 2, width: 10, height: 10 },
      ],
      accessibilityRegions: [
        { label: "Upper sky", x: 5, y: 5, width: 90, height: 20 },
      ],
    },
  });
  assert.deepStrictEqual(regions.map((region) => [region.text, region.x, region.y, region.width, region.height, region.confidence]), [
    ["Face in mirror", 10, 20, 25, 30, "87%"],
    ["Street sign", 50, 25, 25, 20, "manual"],
    ["Upper sky", 5, 5, 90, 20, ""],
  ]);
  assert.deepStrictEqual(
    descriptionRegionsMod.serializePhotoDescriptionRegions(regions).map((region) => [region.text, region.x, region.y, region.width, region.height]),
    [
      ["Face in mirror", 10, 20, 25, 30],
      ["Street sign", 50, 25, 25, 20],
      ["Upper sky", 5, 5, 90, 20],
    ],
  );
  assert.strictEqual(descriptionRegionsMod.photoDescriptionRegionsEquivalent(regions, descriptionRegionsMod.serializePhotoDescriptionRegions(regions)), true);
});

run("filterPhotoRailFolders hides utility and sensitive collections independently", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "favorites", kind: "utility" },
    { id: "hidden", kind: "utility" },
    { id: "utility:sensitive", kind: "utility" },
    { id: "media:screenshot", kind: "utility" },
    { id: "media:screen_recording", kind: "utility" },
    { id: "recentlyShared", kind: "utility" },
    { id: "imports", kind: "utility" },
    { id: "album:1", kind: "album" },
  ];
  assert.deepStrictEqual(
    railMod.filterPhotoRailFolders(folders, { showUtilities: false, showSensitive: false }).map((folder) => folder.id),
    ["all", "media:screenshot", "media:screen_recording", "album:1"],
  );
  assert.deepStrictEqual(
    railMod.filterPhotoRailFolders(folders, { showUtilities: false, showSensitive: true }).map((folder) => folder.id),
    ["all", "hidden", "utility:sensitive", "media:screenshot", "media:screen_recording", "album:1"],
  );
  assert.deepStrictEqual(
    railMod.filterPhotoRailFolders(folders, {
      showUtilities: true,
      showSensitive: true,
      showScreenshots: false,
      showShared: false,
      showLowValueUtilities: false,
    }).map((folder) => folder.id),
    ["all", "favorites", "hidden", "utility:sensitive", "album:1"],
  );
});

run("filterPhotoRailFolders keeps the active hidden folder reachable", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "recentlyDeleted", kind: "utility" },
  ];
  assert.deepStrictEqual(
    railMod.filterPhotoRailFolders(folders, { showUtilities: false, showSensitive: false, activeId: "recentlyDeleted" }).map((folder) => folder.id),
    ["all", "recentlyDeleted"],
  );
});

run("isSensitivePhotoScope catches sensitive folders and visibility filters", () => {
  assert.strictEqual(railMod.isSensitivePhotoScope("hidden", ""), true);
  assert.strictEqual(railMod.isSensitivePhotoScope("recentlyDeleted", ""), true);
  assert.strictEqual(railMod.isSensitivePhotoScope("utility:sensitive", ""), true);
  assert.strictEqual(railMod.isSensitivePhotoScope("all", "hidden"), true);
  assert.strictEqual(railMod.isSensitivePhotoScope("all", "deleted"), true);
  assert.strictEqual(railMod.isSensitivePhotoScope("all", "all"), false);
  assert.strictEqual(railMod.isSensitivePhotoScope("favorites", ""), false);
});

run("Photos utility classifier evidence renders as badge and lightbox action", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(typesSource, /export interface PhotoUtilityMatch/);
  assert.match(typesSource, /utilityMatch\?: PhotoUtilityMatch/);
  assert.match(photosViewSource, /photo-utility-match-badge/);
  assert.match(photosViewSource, /copyPhotoUtilityMatch/);
  assert.match(photosViewSource, /utilityClassifierReview/);
  assert.match(photosViewSource, /photoUtilityClassifierReviewPatch/);
  assert.match(photosViewSource, /uiText\("Utility match"\)/);
  assert.match(photosViewSource, /uiText\("Copy match"\)/);
  assert.match(photosViewSource, /uiText\("Confirm match"\)/);
  assert.match(photosViewSource, /photoUtilityRejectLabel/);
  assert.match(photosViewSource, /Not sensitive/);
  assert.match(photosViewSource, /uiText\("Undo utility review"\)/);
  assert.match(photosViewSource, /utility:sensitive/);
});

run("photoRailSectionIdForFolder groups Apple-like rail sections", () => {
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "all", kind: "all" }), "library");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "sourceFolder:/photos/Family", kind: "source" }), "sources");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "importSource:mail:Mail", kind: "source" }), "sources");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "person:Ada", kind: "person" }), "people");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "group:Ada%7CGrace", kind: "group" }), "people");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "pet:Milo", kind: "pet" }), "people");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "petReview", kind: "utility" }), "people");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "albumFolder:f1", kind: "albumFolder" }), "albums");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "album:1", kind: "album", albumKind: "manual" }), "albums");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "album:2", kind: "album", albumKind: "smart" }), "smartAlbums");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "album:3", kind: "album", albumKind: "smart", folderId: "f1" }), "albums");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "media:video", kind: "utility" }), "mediaTypes");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "utility:qr", kind: "utility" }), "utilities");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "utility:landmarks", kind: "utility" }), "utilities");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "places", kind: "utility" }), "places");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "trips", kind: "utility" }), "places");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "trip:2026-06", kind: "trip" }), "places");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "memories", kind: "utility" }), "memories");
  assert.strictEqual(railMod.photoRailSectionIdForFolder({ id: "memory:favorites:abc", kind: "memory" }), "memories");
});

run("Memories rail folders stay visible outside the Utilities toggle", () => {
  assert.strictEqual(
    railMod.shouldShowPhotoRailFolder(
      { id: "memories", kind: "utility" },
      { showUtilities: false, showSensitive: false },
    ),
    true,
  );
  assert.strictEqual(
    railMod.shouldShowPhotoRailFolder(
      { id: "duplicates", kind: "utility" },
      { showUtilities: false, showSensitive: false },
    ),
    false,
  );
});

run("buildPhotoRailSections nests album folders and contained smart albums", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "album:loose-smart", kind: "album", albumKind: "smart", name: "Loose smart" },
    { id: "album:manual-root", kind: "album", albumKind: "manual", name: "Root manual" },
    { id: "album:folder-smart", kind: "album", albumKind: "smart", name: "Folder smart", folderId: "f1", folderPosition: 2 },
    { id: "albumFolder:f1", kind: "albumFolder", name: "Trips", folderId: "f1", position: 1 },
    { id: "albumFolder:f2", kind: "albumFolder", name: "Nested", folderId: "f2", parentFolderId: "f1", position: 0 },
    { id: "album:child-manual", kind: "album", albumKind: "manual", name: "Child manual", folderId: "f2", folderPosition: 0 },
  ];
  const sections = railMod.buildPhotoRailSections(folders, []);
  const albumsSection = sections.find((section) => section.id === "albums");
  const smartSection = sections.find((section) => section.id === "smartAlbums");
  assert.deepStrictEqual(albumsSection.folders.map((folder) => folder.id), [
    "albumFolder:f1",
    "albumFolder:f2",
    "album:child-manual",
    "album:folder-smart",
    "album:manual-root",
  ]);
  assert.deepStrictEqual(smartSection.folders.map((folder) => folder.id), ["album:loose-smart"]);
  assert.strictEqual(railMod.photoRailAlbumTreeDepth(folders[3], albumsSection.folders), 1);
  assert.strictEqual(railMod.photoRailAlbumTreeDepth(folders[6], albumsSection.folders), 2);
  const depthMap = railMod.buildPhotoRailAlbumTreeDepthMap(albumsSection.folders);
  assert.deepStrictEqual(
    albumsSection.folders.map((folder) => [folder.id, depthMap.get(folder.id)]),
    [
      ["albumFolder:f1", 0],
      ["albumFolder:f2", 1],
      ["album:child-manual", 2],
      ["album:folder-smart", 1],
      ["album:manual-root", 0],
    ],
  );
});

run("planPhotoRailAlbumTreeDrop supports inside and sibling moves without cycles", () => {
  const folders = [
    { id: "album:loose", kind: "album", albumKind: "manual", name: "Loose", albumId: "loose", folderPosition: 0 },
    { id: "albumFolder:f1", kind: "albumFolder", name: "Trips", folderId: "f1", position: 0 },
    { id: "albumFolder:f2", kind: "albumFolder", name: "Nested", folderId: "f2", parentFolderId: "f1", position: 0 },
    { id: "album:smart", kind: "album", albumKind: "smart", name: "Smart", albumId: "smart", folderId: "f1", folderPosition: 2 },
  ];
  const inside = railMod.planPhotoRailAlbumTreeDrop(folders, "album:loose", "albumFolder:f1", "inside");
  assert.strictEqual(inside.valid, true);
  assert.strictEqual(inside.parentFolderId, "f1");
  assert.deepStrictEqual(inside.items.map((item) => `${item.kind}:${item.id}`), ["albumFolder:f2", "album:smart", "album:loose"]);

  const before = railMod.planPhotoRailAlbumTreeDrop(folders, "album:smart", "albumFolder:f2", "before");
  assert.strictEqual(before.valid, true);
  assert.strictEqual(before.parentFolderId, "f1");
  assert.deepStrictEqual(before.items.map((item) => `${item.kind}:${item.id}`), ["album:smart", "albumFolder:f2"]);

  const cycle = railMod.planPhotoRailAlbumTreeDrop(folders, "albumFolder:f1", "albumFolder:f2", "inside");
  assert.strictEqual(cycle.valid, false);
  assert.strictEqual(cycle.reason, "cycle");
});

run("buildPhotoRailSections moves pinned folders to a top section", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "sourceFolder:/photos/Family", kind: "source", name: "Family" },
    { id: "importSource:mail:Mail", kind: "source", name: "Mail" },
    { id: "person:Ada", kind: "person" },
    { id: "album:1", kind: "album", albumKind: "manual" },
    { id: "album:2", kind: "album", albumKind: "smart" },
    { id: "favorites", kind: "utility" },
  ];
  const sections = railMod.buildPhotoRailSections(folders, ["album:2", "favorites"]);
  assert.deepStrictEqual(sections.map((section) => section.id), ["pinned", "library", "sources", "people", "albums"]);
  assert.deepStrictEqual(sections[0].folders.map((folder) => folder.id), ["album:2", "favorites"]);
  assert.deepStrictEqual(sections.find((section) => section.id === "sources").folders.map((folder) => folder.id), ["sourceFolder:/photos/Family", "importSource:mail:Mail"]);
  assert.deepStrictEqual(sections.at(-1).folders.map((folder) => folder.id), ["album:1"]);
});

run("normalizePhotoRailSectionOrder preserves valid custom order and fills gaps", () => {
  assert.deepStrictEqual(
    railMod.normalizePhotoRailSectionOrder(["utilities", "albums", "nope", "utilities"]),
    ["utilities", "albums", "library", "sources", "people", "smartAlbums", "places", "memories", "mediaTypes"],
  );
});

run("movePhotoRailSection reorders persisted rail sections", () => {
  assert.deepStrictEqual(
    railMod.movePhotoRailSection(["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"], "albums", "up").slice(0, 4),
    ["library", "albums", "people", "smartAlbums"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailSection(["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"], "library", "up").slice(0, 3),
    ["library", "people", "albums"],
  );
});

run("moveVisiblePhotoRailSection skips empty persisted sections", () => {
  assert.deepStrictEqual(
    railMod.moveVisiblePhotoRailSection(
      ["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"],
      ["library", "people", "albums", "smartAlbums", "places", "mediaTypes", "utilities"],
      "mediaTypes",
      "up",
    ),
    ["library", "people", "albums", "smartAlbums", "mediaTypes", "places", "memories", "utilities", "sources"],
  );
});

run("moveVisiblePhotoRailSectionToPosition drag reorders visible sections", () => {
  assert.deepStrictEqual(
    railMod.moveVisiblePhotoRailSectionToPosition(
      ["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"],
      ["library", "people", "albums", "smartAlbums", "places", "mediaTypes", "utilities"],
      "utilities",
      "people",
      "before",
    ).slice(0, 5),
    ["library", "utilities", "people", "albums", "smartAlbums"],
  );
  assert.deepStrictEqual(
    railMod.moveVisiblePhotoRailSectionToPosition(
      ["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"],
      ["library", "people", "albums", "smartAlbums", "places", "mediaTypes", "utilities"],
      "people",
      "mediaTypes",
      "after",
    ),
    ["library", "albums", "smartAlbums", "places", "memories", "mediaTypes", "people", "utilities", "sources"],
  );
  assert.deepStrictEqual(
    railMod.moveVisiblePhotoRailSectionToPosition(
      ["library", "people", "albums", "smartAlbums", "places", "memories", "mediaTypes", "utilities"],
      ["library", "people", "albums"],
      "mediaTypes",
      "people",
      "before",
    ).slice(0, 4),
    ["library", "people", "albums", "smartAlbums"],
  );
});

run("buildPhotoRailSections follows custom section order", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "person:Ada", kind: "person" },
    { id: "album:1", kind: "album", albumKind: "manual" },
    { id: "media:video", kind: "utility" },
  ];
  assert.deepStrictEqual(
    railMod.buildPhotoRailSections(folders, [], ["mediaTypes", "albums", "people", "library"]).map((section) => section.id),
    ["mediaTypes", "albums", "people", "library"],
  );
});

run("buildPhotoRailSections applies Utilities and Media Types item order", () => {
  const folders = [
    { id: "all", kind: "all" },
    { id: "media:image", kind: "utility", name: "Images" },
    { id: "media:video", kind: "utility", name: "Videos" },
    { id: "duplicates", kind: "utility", name: "Duplicates" },
    { id: "recentlyDeleted", kind: "utility", name: "Recently Deleted" },
    { id: "favorites", kind: "utility", name: "Favorites" },
  ];
  const sections = railMod.buildPhotoRailSections(folders, [], undefined, {
    mediaTypes: ["media:video", "missing", "media:image"],
    utilities: ["recentlyDeleted", "favorites"],
  });
  assert.deepStrictEqual(
    sections.find((section) => section.id === "mediaTypes").folders.map((folder) => folder.id),
    ["media:video", "media:image"],
  );
  assert.deepStrictEqual(
    sections.find((section) => section.id === "utilities").folders.map((folder) => folder.id),
    ["recentlyDeleted", "favorites", "duplicates"],
  );
});

run("movePhotoRailItem reorders persisted utility and media lists", () => {
  const folders = [
    { id: "favorites", kind: "utility", name: "Favorites" },
    { id: "duplicates", kind: "utility", name: "Duplicates" },
    { id: "recentlyDeleted", kind: "utility", name: "Recently Deleted" },
  ];
  assert.deepStrictEqual(
    railMod.movePhotoRailItem("utilities", folders, ["recentlyDeleted", "duplicates"], "duplicates", "up"),
    ["duplicates", "recentlyDeleted", "favorites"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailItem("utilities", folders, ["duplicates", "recentlyDeleted", "favorites"], "favorites", "down"),
    ["duplicates", "recentlyDeleted", "favorites"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailItem("albums", folders, ["recentlyDeleted"], "recentlyDeleted", "up"),
    ["recentlyDeleted", "favorites", "duplicates"],
  );
});

run("movePhotoRailItemToPosition reorders utility and media drag drops", () => {
  const folders = [
    { id: "favorites", kind: "utility", name: "Favorites" },
    { id: "duplicates", kind: "utility", name: "Duplicates" },
    { id: "recentlyDeleted", kind: "utility", name: "Recently Deleted" },
    { id: "utility:qr", kind: "utility", name: "QR Codes" },
  ];
  assert.deepStrictEqual(
    railMod.movePhotoRailItemToPosition("utilities", folders, ["recentlyDeleted", "duplicates"], "recentlyDeleted", "utility:qr", "after"),
    ["duplicates", "favorites", "utility:qr", "recentlyDeleted"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailItemToPosition("utilities", folders, ["duplicates", "favorites", "utility:qr", "recentlyDeleted"], "utility:qr", "duplicates", "before"),
    ["utility:qr", "duplicates", "favorites", "recentlyDeleted"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailItemToPosition("albums", folders, ["duplicates"], "duplicates", "favorites", "before"),
    ["duplicates", "favorites", "recentlyDeleted", "utility:qr"],
  );
  assert.deepStrictEqual(
    railMod.movePhotoRailItemToPosition("utilities", folders, ["duplicates"], "duplicates", "duplicates", "after"),
    ["duplicates", "favorites", "recentlyDeleted", "utility:qr"],
  );
});

run("buildPhotoFilterChips exposes active query and filter chips", () => {
  assert.deepStrictEqual(chipMod.buildPhotoFilterChips({
    searchQuery: "Ada",
    keyword: "beach",
    mediaKind: "live_photo",
    favoriteOnly: true,
    editedOnly: true,
    notInAlbumOnly: true,
    person: "Alice",
    status: "accepted",
    minQuality: 0.8,
    dateFrom: "2026-01-01",
    dateTo: "2026-06-19",
    source: "Camera Roll",
    fileType: "jpg",
    duplicateOnly: true,
    location: "Santa Cruz",
    nearbyLabel: "Boardwalk (25 km)",
    camera: "Nikon",
    album: "album-1",
    albumLabel: "Manual picks",
    visibility: "hidden",
  }), [
    { kind: "search", label: "Search: Ada" },
    { kind: "keyword", label: "Keyword: beach" },
    { kind: "mediaKind", label: "Media: Live Photos" },
    { kind: "favorite", label: "Favorites" },
    { kind: "edited", label: "Edited" },
    { kind: "notInAlbum", label: "Not in Album" },
    { kind: "person", label: "Person: Alice" },
    { kind: "status", label: "Status: Accepted" },
    { kind: "minQuality", label: "Quality >= 80%" },
    { kind: "dateFrom", label: "From: 2026-01-01" },
    { kind: "dateTo", label: "Through: 2026-06-19" },
    { kind: "source", label: "Source: Camera Roll" },
    { kind: "fileType", label: "File: JPG" },
    { kind: "duplicate", label: "Duplicates" },
    { kind: "location", label: "Location: Santa Cruz" },
    { kind: "nearby", label: "Nearby: Boardwalk (25 km)" },
    { kind: "camera", label: "Camera: Nikon" },
    { kind: "album", label: "Album: Manual picks" },
    { kind: "visibility", label: "Hidden" },
  ]);
});

run("buildPhotoFilterChips omits inactive filters", () => {
  assert.deepStrictEqual(chipMod.buildPhotoFilterChips({ searchQuery: "  ", mediaKind: "" }), []);
});

run("buildPhotoKeywordFilterOptions ranks popular keywords and preserves active selection", () => {
  assert.deepStrictEqual(keywordFiltersMod.buildPhotoKeywordFilterOptions([
    { name: "Family", count: 2, shortcut: "f" },
    { name: "Travel", count: 9, shortcut: "t" },
    { name: "family", count: 3 },
    { name: "Work", count: 1 },
  ], "Archived", 3), [
    { name: "Archived", count: 0, shortcut: "", active: true },
    { name: "Travel", count: 9, shortcut: "t", active: false },
    { name: "Family", count: 5, shortcut: "f", active: false },
  ]);
  assert.deepStrictEqual(keywordFiltersMod.buildPhotoKeywordFilterOptions([
    { name: "Travel", count: 9 },
    { name: "Family", count: 5 },
  ], "family", 2), [
    { name: "Family", count: 5, shortcut: "", active: true },
    { name: "Travel", count: 9, shortcut: "", active: false },
  ]);
});

run("photo media filter labels cover richer Apple-like media types", () => {
  assert.strictEqual(chipMod.buildPhotoFilterChips({ mediaKind: "panorama" })[0].label, "Media: Panoramas");
  assert.strictEqual(chipMod.buildPhotoFilterChips({ mediaKind: "portrait" })[0].label, "Media: Portraits");
  assert.strictEqual(chipMod.buildPhotoFilterChips({ mediaKind: "burst" })[0].label, "Media: Bursts");
  assert.strictEqual(chipMod.buildPhotoFilterChips({ mediaKind: "time_lapse" })[0].label, "Media: Time-lapse");
  const draft = savedSearchMod.buildPhotoSavedSearchDraft({ mediaKind: "time_lapse" });
  assert.strictEqual(draft.name, "Saved search: Time-lapse");
  assert.strictEqual(draft.rules.mediaKind, "time_lapse");
});

run("buildPhotoSavedSearchDraft converts active filters to smart album rules", () => {
  assert.deepStrictEqual(savedSearchMod.buildPhotoSavedSearchDraft({
    searchQuery: "Harbor",
    keyword: "beach",
    mediaKind: "raw",
    favoriteOnly: true,
    editedOnly: true,
    notInAlbumOnly: true,
    person: "Alice",
    status: "accepted",
    minQuality: 0.8,
    dateFrom: "2026-01-01",
    dateTo: "2026-06-19",
    source: "Camera Roll",
    fileType: "jpg",
    duplicateOnly: true,
    location: "Santa Cruz",
    camera: "Nikon",
    album: "album-1",
    albumLabel: "Manual picks",
    visibility: "hidden",
  }), {
    name: "Saved search: Harbor + beach + RAW",
    description: "Created from the active Photos search and filter chips.",
    rules: {
      query: "Harbor",
      keyword: "beach",
      mediaKind: "raw",
      favoriteOnly: true,
      editedOnly: true,
      dateFrom: "2026-01-01",
      dateTo: "2026-06-19",
      folder: "Camera Roll",
      statuses: ["accepted"],
      minQuality: 0.8,
      op: "all",
      conditions: [
        { field: "status", operator: "is", value: "accepted" },
        { field: "query", operator: "contains", value: "Harbor" },
        { field: "keyword", operator: "is", value: "beach" },
        { field: "mediaKind", operator: "is", value: "raw" },
        { field: "date", operator: "onOrAfter", value: "2026-01-01" },
        { field: "date", operator: "onOrBefore", value: "2026-06-19" },
        { field: "folder", operator: "contains", value: "Camera Roll" },
        { field: "quality", operator: "atLeast", value: 0.8 },
        { field: "favorite", operator: "is", value: true },
        { field: "edited", operator: "is", value: true },
        { field: "notInAlbum", operator: "is", value: true },
        { field: "fileType", operator: "is", value: "jpg" },
        { field: "duplicate", operator: "is", value: true },
        { field: "location", operator: "contains", value: "Santa Cruz" },
        { field: "camera", operator: "contains", value: "Nikon" },
        { field: "album", operator: "is", value: "album-1" },
        { field: "hidden", operator: "is", value: true },
        { field: "person", operator: "is", value: "Alice" },
      ],
    },
  });
});

run("buildPhotoSavedFilter captures exact UI filter state for rail reuse", () => {
  assert.deepStrictEqual(savedSearchMod.buildPhotoSavedFilter({
    searchQuery: "Harbor",
    keyword: "beach",
    mediaKind: "video",
    favoriteOnly: true,
    notInAlbumOnly: true,
    status: "pending",
    minQuality: "0.9",
    album: "album-1",
    albumLabel: "Manual picks",
    visibility: "all",
  }, { id: "filter-1", createdAt: "2026-06-20T00:00:00Z" }), {
    id: "filter-1",
    name: "Saved filter: Harbor + beach + Videos",
    description: "Created from the active Photos search and filter chips.",
    createdAt: "2026-06-20T00:00:00Z",
    filters: {
      searchQuery: "Harbor",
      keyword: "beach",
      mediaKind: "video",
      favoriteOnly: true,
      editedOnly: false,
      notInAlbumOnly: true,
      person: "",
      status: "pending",
      minQuality: "0.9",
      dateFrom: "",
      dateTo: "",
      source: "",
      fileType: "",
      duplicateOnly: false,
      location: "",
      nearbyLatitude: "",
      nearbyLongitude: "",
      nearbyRadiusKm: "",
      nearbyLabel: "",
      camera: "",
      album: "album-1",
      albumLabel: "Manual picks",
      visibility: "all",
    },
    rules: {
      query: "Harbor",
      keyword: "beach",
      mediaKind: "video",
      favoriteOnly: true,
      statuses: ["pending"],
      minQuality: 0.9,
      op: "all",
      conditions: [
        { field: "status", operator: "is", value: "pending" },
        { field: "query", operator: "contains", value: "Harbor" },
        { field: "keyword", operator: "is", value: "beach" },
        { field: "mediaKind", operator: "is", value: "video" },
        { field: "quality", operator: "atLeast", value: 0.9 },
        { field: "favorite", operator: "is", value: true },
        { field: "notInAlbum", operator: "is", value: true },
        { field: "album", operator: "is", value: "album-1" },
        {
          op: "any",
          conditions: [
            { field: "hidden", operator: "is", value: true },
            { field: "hidden", operator: "is", value: false },
          ],
        },
      ],
    },
  });
});

run("buildPhotoSavedFilter captures nearby-only filters for rail reuse", () => {
  assert.deepStrictEqual(savedSearchMod.buildPhotoSavedFilter({
    nearbyLatitude: "37.7749",
    nearbyLongitude: "-122.4194",
    nearbyRadiusKm: "100",
    nearbyLabel: "Boardwalk",
  }, { id: "filter-nearby", createdAt: "2026-06-20T00:00:00Z" }), {
    id: "filter-nearby",
    name: "Saved filter: Nearby Boardwalk (100 km)",
    description: "Created from the active Photos search and filter chips.",
    createdAt: "2026-06-20T00:00:00Z",
    filters: {
      searchQuery: "",
      keyword: "",
      mediaKind: "",
      favoriteOnly: false,
      editedOnly: false,
      notInAlbumOnly: false,
      person: "",
      status: "",
      minQuality: "",
      dateFrom: "",
      dateTo: "",
      source: "",
      fileType: "",
      duplicateOnly: false,
      location: "",
      nearbyLatitude: "37.7749",
      nearbyLongitude: "-122.4194",
      nearbyRadiusKm: "100",
      nearbyLabel: "Boardwalk",
      camera: "",
      album: "",
      albumLabel: "",
      visibility: "",
    },
    rules: {
      op: "all",
      conditions: [
        { field: "nearby", operator: "is", value: "37.7749,-122.4194,100" },
      ],
    },
  });
});

run("normalizePhotoSavedFilterRecord accepts backend rows and normalizes UI state", () => {
  assert.deepStrictEqual(savedSearchMod.normalizePhotoSavedFilterRecord({
    filterId: "filter:workspace",
    name: "Saved filter: Harbor",
    description: "Backend row",
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:01:00Z",
    pinned: true,
    position: 3,
    count: 12,
    ruleSummary: ["search: Harbor", "favorites"],
    previewSamples: ["Harbor sunset", "Pier"],
    filters: {
      searchQuery: " Harbor ",
      mediaKind: "image",
      favoriteOnly: true,
      notInAlbumOnly: true,
    },
    rules: { query: "Harbor", favoriteOnly: true },
  }), {
    id: "filter:workspace",
    name: "Saved filter: Harbor",
    description: "Backend row",
    createdAt: "2026-06-20T00:00:00Z",
    updatedAt: "2026-06-20T00:01:00Z",
    pinned: true,
    position: 3,
    count: 12,
    ruleSummary: ["search: Harbor", "favorites"],
    previewSamples: ["Harbor sunset", "Pier"],
    filters: {
      searchQuery: "Harbor",
      keyword: "",
      mediaKind: "image",
      favoriteOnly: true,
      editedOnly: false,
      notInAlbumOnly: true,
      person: "",
      status: "",
      minQuality: "",
      dateFrom: "",
      dateTo: "",
      source: "",
      fileType: "",
      duplicateOnly: false,
      location: "",
      nearbyLatitude: "",
      nearbyLongitude: "",
      nearbyRadiusKm: "",
      nearbyLabel: "",
      camera: "",
      album: "",
      albumLabel: "",
      visibility: "",
    },
    rules: { query: "Harbor", favoriteOnly: true },
  });
});

run("normalizePhotoSavedFilterList orders pinned filters and rewrites positions", () => {
  const normalized = savedSearchMod.normalizePhotoSavedFilterList([
    {
      id: "filter-a",
      name: "A",
      description: "",
      createdAt: "",
      pinned: false,
      position: 0,
      filters: savedSearchMod.normalizePhotoSavedFilterState({ searchQuery: "a" }),
      rules: { query: "a" },
    },
    {
      id: "filter-b",
      name: "B",
      description: "",
      createdAt: "",
      pinned: true,
      position: 9,
      filters: savedSearchMod.normalizePhotoSavedFilterState({ searchQuery: "b" }),
      rules: { query: "b" },
    },
  ]);
  assert.deepStrictEqual(normalized.map((filter) => [filter.id, filter.pinned, filter.position]), [
    ["filter-b", true, 0],
    ["filter-a", false, 1],
  ]);
});

run("photoAlbumRulesToSmartQuery converts legacy smart rules to grouped DSL", () => {
  assert.deepStrictEqual(savedSearchMod.photoAlbumRulesToSmartQuery({
    statuses: ["pending", "uncertain"],
    dateFrom: "2026-01-01",
    dateTo: "2026-06-19",
    folder: "family",
    minScore: 0.8,
    minQuality: 0.7,
    hasVideoFrames: true,
    unknownOnly: true,
    recentDays: 30,
  }), {
    op: "all",
    conditions: [
      {
        op: "any",
        conditions: [
          { field: "status", operator: "is", value: "pending" },
          { field: "status", operator: "is", value: "uncertain" },
        ],
      },
      { field: "date", operator: "onOrAfter", value: "2026-01-01" },
      { field: "date", operator: "onOrBefore", value: "2026-06-19" },
      { field: "folder", operator: "contains", value: "family" },
      { field: "score", operator: "atLeast", value: 0.8 },
      { field: "quality", operator: "atLeast", value: 0.7 },
      { field: "hasVideoFrames", operator: "is", value: true },
      { field: "unknown", operator: "is", value: true },
      { field: "recentDays", operator: "withinLast", value: 30 },
    ],
  });
});

run("photoAlbumRulesToSmartQuery converts include exclude people to grouped DSL", () => {
  assert.deepStrictEqual(savedSearchMod.photoAlbumRulesToSmartQuery({
    query: "beach",
  }, {
    includePeople: ["Alice", "Bob", "Alice"],
    excludePeople: ["Carol", "Bob"],
  }), {
    op: "all",
    conditions: [
      { field: "query", operator: "contains", value: "beach" },
      { field: "person", operator: "is", value: "Alice" },
      { field: "person", operator: "isNot", value: "Carol" },
      { field: "person", operator: "isNot", value: "Bob" },
    ],
  });
});

run("smart query builder converts legacy rules into editable DSL", () => {
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    query: "Harbor",
    favoriteOnly: true,
    minQuality: 0.72,
  }, {
    includePeople: ["Alice", "Bob"],
    excludePeople: ["Carol"],
  });
  assert.deepStrictEqual(group, {
    op: "all",
    conditions: [
      { field: "query", operator: "contains", value: "Harbor" },
      { field: "quality", operator: "atLeast", value: 0.72 },
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "person", operator: "is", value: "Alice" },
          { field: "person", operator: "is", value: "Bob" },
        ],
      },
      { field: "person", operator: "isNot", value: "Carol" },
    ],
  });
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules(group), {
    op: "all",
    conditions: [
      { field: "query", operator: "contains", value: "Harbor" },
      { field: "quality", operator: "atLeast", value: 0.72 },
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "person", operator: "is", value: "Alice" },
          { field: "person", operator: "is", value: "Bob" },
        ],
      },
      { field: "person", operator: "isNot", value: "Carol" },
    ],
  });
});

run("smart query builder wraps existing any query when adding legacy people", () => {
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    op: "any",
    conditions: [
      { field: "keyword", operator: "is", value: "family" },
      { field: "favorite", operator: "is", value: true },
    ],
  }, {
    includePeople: ["Alice"],
  });
  assert.deepStrictEqual(group, {
    op: "all",
    conditions: [
      {
        op: "any",
        conditions: [
          { field: "keyword", operator: "is", value: "family" },
          { field: "favorite", operator: "is", value: true },
        ],
      },
      { field: "person", operator: "is", value: "Alice" },
    ],
  });
});

run("smart query builder preserves nested any all groups", () => {
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    op: "all",
    conditions: [
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "title", operator: "contains", value: "Harbor" },
          { field: "caption", operator: "contains", value: "Pier" },
        ],
      },
    ],
  });
  assert.deepStrictEqual(group, {
    op: "all",
    conditions: [
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "title", operator: "contains", value: "Harbor" },
          { field: "caption", operator: "contains", value: "Pier" },
        ],
      },
    ],
  });
});

run("smart query builder exposes local intelligence metadata fields", () => {
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("ocrText").label, "Detected text");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("detectedItem").label, "Detected item");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("modelTag").label, "Model tag");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("sceneTag").label, "Scene tag");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("detectedEvent").label, "Detected event");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("imageDescription").label, "Image description");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("iptcCreator").label, "IPTC creator / credit");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("iptcRights").label, "IPTC rights / usage");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("iptcEvent").label, "IPTC event / job");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("iptcLocation").label, "IPTC location");
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    op: "all",
    conditions: [
      { field: "ocrText", operator: "contains", value: "ticket number" },
      { field: "detectedItem", operator: "contains", value: "surfboard" },
      { field: "modelTag", operator: "notContains", value: "low quality" },
      { field: "sceneTag", operator: "contains", value: "shoreline" },
      { field: "detectedEvent", operator: "isNot", value: "sunset" },
      { field: "imageDescription", operator: "contains", value: "screen reader" },
      { field: "iptcCreator", operator: "contains", value: "Harbor Studio" },
      { field: "iptcRights", operator: "contains", value: "Editorial use" },
      { field: "iptcEvent", operator: "is", value: "Bay Lights Opening" },
      { field: "iptcLocation", operator: "notContains", value: "Embargoed" },
    ],
  });
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules(group), {
    op: "all",
    conditions: [
      { field: "ocrText", operator: "contains", value: "ticket number" },
      { field: "detectedItem", operator: "contains", value: "surfboard" },
      { field: "modelTag", operator: "notContains", value: "low quality" },
      { field: "sceneTag", operator: "contains", value: "shoreline" },
      { field: "detectedEvent", operator: "isNot", value: "sunset" },
      { field: "imageDescription", operator: "contains", value: "screen reader" },
      { field: "iptcCreator", operator: "contains", value: "Harbor Studio" },
      { field: "iptcRights", operator: "contains", value: "Editorial use" },
      { field: "iptcEvent", operator: "is", value: "Bay Lights Opening" },
      { field: "iptcLocation", operator: "notContains", value: "Embargoed" },
    ],
  });
});

run("smart query builder exposes lens dimension and duration fields", () => {
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("group").label, "People group");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("personCount").label, "Person count");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("faceCount").label, "Face count");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("matchCount").label, "Match count");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("lens").label, "Lens");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("dimensions").label, "Dimensions");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("width").valueKind, "number");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("height").valueKind, "number");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("megapixels").label, "Megapixels");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("duration").label, "Duration (sec)");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("durationMs").label, "Duration (ms)");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("nearby").label, "Nearby radius");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("ocrConfidence").label, "Text confidence");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("detectedItemConfidence").label, "Detected item confidence");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("detectedEventConfidence").label, "Detected event confidence");
  assert.strictEqual(smartQueryMod.smartQueryFieldDefinition("modelConfidence").label, "Model confidence");
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    op: "all",
    conditions: [
      { field: "group", operator: "contains", value: "Alice & Bob" },
      { field: "personCount", operator: "atLeast", value: 2 },
      { field: "faceCount", operator: "atLeast", value: 2 },
      { field: "matchCount", operator: "atLeast", value: 2 },
      { field: "lens", operator: "contains", value: "50mm" },
      { field: "dimensions", operator: "contains", value: "4000x3000" },
      { field: "width", operator: "atLeast", value: 3000 },
      { field: "height", operator: "atLeast", value: 2000 },
      { field: "megapixels", operator: "atLeast", value: 12 },
      { field: "duration", operator: "greaterThan", value: 5 },
      { field: "durationMs", operator: "atMost", value: 10000 },
      { field: "nearby", operator: "is", value: "37.7749,-122.4194,25" },
      { field: "ocrConfidence", operator: "atLeast", value: 0.8 },
      { field: "detectedItemConfidence", operator: "atLeast", value: 0.85 },
      { field: "detectedEventConfidence", operator: "atLeast", value: 0.75 },
      { field: "modelConfidence", operator: "atLeast", value: 0.7 },
    ],
  });
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules(group), {
    op: "all",
    conditions: [
      { field: "group", operator: "contains", value: "Alice & Bob" },
      { field: "personCount", operator: "atLeast", value: 2 },
      { field: "faceCount", operator: "atLeast", value: 2 },
      { field: "matchCount", operator: "atLeast", value: 2 },
      { field: "lens", operator: "contains", value: "50mm" },
      { field: "dimensions", operator: "contains", value: "4000x3000" },
      { field: "width", operator: "atLeast", value: 3000 },
      { field: "height", operator: "atLeast", value: 2000 },
      { field: "megapixels", operator: "atLeast", value: 12 },
      { field: "duration", operator: "greaterThan", value: 5 },
      { field: "durationMs", operator: "atMost", value: 10000 },
      { field: "nearby", operator: "is", value: "37.7749,-122.4194,25" },
      { field: "ocrConfidence", operator: "atLeast", value: 0.8 },
      { field: "detectedItemConfidence", operator: "atLeast", value: 0.85 },
      { field: "detectedEventConfidence", operator: "atLeast", value: 0.75 },
      { field: "modelConfidence", operator: "atLeast", value: 0.7 },
    ],
  });
});

run("smart query builder exposes exact negative date and numeric operators", () => {
  assert(smartQueryMod.smartQueryFieldDefinition("date").operators.some((item) => item.operator === "isNot"));
  assert(smartQueryMod.smartQueryFieldDefinition("addedDate").operators.some((item) => item.operator === "isNot"));
  assert(smartQueryMod.smartQueryFieldDefinition("width").operators.some((item) => item.operator === "isNot"));
  assert(smartQueryMod.smartQueryFieldDefinition("durationMs").operators.some((item) => item.operator === "isNot"));
  const group = smartQueryMod.smartQueryGroupFromAlbumRules({
    op: "all",
    conditions: [
      { field: "date", operator: "isNot", value: "2026-02-01" },
      { field: "addedDate", operator: "isNot", value: "2026-03-01" },
      { field: "width", operator: "isNot", value: 1024 },
      { field: "durationMs", operator: "isNot", value: 1000 },
    ],
  });
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules(group), {
    op: "all",
    conditions: [
      { field: "date", operator: "isNot", value: "2026-02-01" },
      { field: "addedDate", operator: "isNot", value: "2026-03-01" },
      { field: "width", operator: "isNot", value: 1024 },
      { field: "durationMs", operator: "isNot", value: 1000 },
    ],
  });
});

run("smart query builder edits nested clauses by path", () => {
  const base = {
    op: "all",
    conditions: [
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "title", operator: "contains", value: "Harbor" },
        ],
      },
    ],
  };
  const withRule = smartQueryMod.addSmartQueryRuleAtPath(base, [1]);
  const withDate = smartQueryMod.updateSmartQueryClauseAtPath(withRule, [1, 1], (clause) => (
    smartQueryMod.setSmartQueryRuleValue(smartQueryMod.setSmartQueryRuleField(clause, "addedDate"), "2026-06-20")
  ));
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules(withDate), {
    op: "all",
    conditions: [
      { field: "favorite", operator: "is", value: true },
      {
        op: "any",
        conditions: [
          { field: "title", operator: "contains", value: "Harbor" },
          { field: "addedDate", operator: "onOrAfter", value: "2026-06-20" },
        ],
      },
    ],
  });
});

run("smart query builder drops incomplete clauses and clamps numeric values", () => {
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules({
    op: "all",
    conditions: [
      { field: "query", operator: "contains", value: " " },
      { field: "quality", operator: "atLeast", value: 2 },
      { field: "recentDays", operator: "withinLast", value: 9000 },
      { field: "date", operator: "onOrAfter", value: "not-a-date" },
      { field: "fileType", operator: "is", value: " png " },
    ],
  }), {
    op: "all",
    conditions: [
      { field: "quality", operator: "atLeast", value: 1 },
      { field: "recentDays", operator: "withinLast", value: 3650 },
      { field: "fileType", operator: "is", value: "png" },
    ],
  });
});

run("smart query builder falls back invalid operators and preserves boolean false", () => {
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules({
    op: "all",
    conditions: [
      { field: "favorite", operator: "contains", value: false },
      { field: "edited", operator: "notContains", value: false },
    ],
  }), {
    op: "all",
    conditions: [
      { field: "favorite", operator: "is", value: false },
      { field: "edited", operator: "is", value: false },
    ],
  });
  assert.deepStrictEqual(
    smartQueryMod.setSmartQueryRuleOperator({ field: "favorite", operator: "is", value: true }, "contains"),
    { field: "favorite", operator: "is", value: true },
  );
});

run("smart query builder drops empty nested groups during serialization", () => {
  assert.deepStrictEqual(smartQueryMod.smartQueryAlbumRules({
    op: "all",
    conditions: [
      { field: "title", operator: "contains", value: "Harbor" },
      {
        op: "any",
        conditions: [
          { field: "query", operator: "contains", value: " " },
        ],
      },
    ],
  }), {
    op: "all",
    conditions: [
      { field: "title", operator: "contains", value: "Harbor" },
    ],
  });
});

run("buildPhotoSavedSearchDraft returns null for empty state", () => {
  assert.strictEqual(savedSearchMod.buildPhotoSavedSearchDraft({ searchQuery: " ", favoriteOnly: false }), null);
});

run("photo date adjustments shift date-only values by whole days", () => {
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2026-06-20", 3), "2026-06-23");
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2026-01-01", -1), "2025-12-31");
});

run("photo date adjustments preserve ISO-like wall time and timezone", () => {
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2026-06-20T09:30:00Z", -2), "2026-06-18T09:30:00Z");
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2026-06-20 09:30:00", 1), "2026-06-21T09:30:00");
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2024-05-01T01:00:00+05:30", 1), "2024-05-02T01:00:00+05:30");
});

run("photo date adjustment inputs clamp and reject invalid dates", () => {
  assert.strictEqual(dateAdjustmentsMod.parsePhotoDateOffsetDays("1.7"), 2);
  assert.strictEqual(dateAdjustmentsMod.parsePhotoDateOffsetDays("nope"), 0);
  assert.strictEqual(dateAdjustmentsMod.parsePhotoDateOffsetDays(99999), 36500);
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("not-a-date", 2), "");
  assert.strictEqual(dateAdjustmentsMod.shiftPhotoDateByDays("2026-06-20", 0), "");
});

run("photo date time overrides split existing date time and timezone", () => {
  assert.deepStrictEqual(dateAdjustmentsMod.splitPhotoDateTimeOverride("2026-06-20T09:30:00+05:30"), {
    date: "2026-06-20",
    time: "09:30",
    timezone: "+05:30",
  });
  assert.deepStrictEqual(dateAdjustmentsMod.splitPhotoDateTimeOverride("2026-06-20"), {
    date: "2026-06-20",
    time: "",
    timezone: "",
  });
});

run("photo date time overrides compose normalized ISO-like values", () => {
  assert.strictEqual(dateAdjustmentsMod.composePhotoDateTimeOverride("2026-06-20", "9:05", "UTC"), "2026-06-20T09:05:00Z");
  assert.strictEqual(dateAdjustmentsMod.composePhotoDateTimeOverride("2026-06-20", "09:30", "-0800"), "2026-06-20T09:30:00-08:00");
  assert.strictEqual(dateAdjustmentsMod.composePhotoDateTimeOverride("2026-06-20", "", "+05:30"), "2026-06-20");
  assert.strictEqual(dateAdjustmentsMod.composePhotoDateTimeOverride("", "09:30", "Z"), "");
  assert.strictEqual(dateAdjustmentsMod.normalizePhotoDateTimeOverride("2026-06-20T09:05:00.000Z"), "2026-06-20T09:05:00Z");
});

run("photo timezone correction preserves wall-clock date time", () => {
  assert.strictEqual(dateAdjustmentsMod.applyPhotoTimezoneCorrection("2026-06-20T09:30:00Z", "+05:30"), "2026-06-20T09:30:00+05:30");
  assert.strictEqual(dateAdjustmentsMod.applyPhotoTimezoneCorrection("2026-06-20 09:30:00-0800", "UTC"), "2026-06-20T09:30:00Z");
  assert.strictEqual(dateAdjustmentsMod.applyPhotoTimezoneCorrection("2026-06-20", "+05:30"), "");
  assert.strictEqual(dateAdjustmentsMod.applyPhotoTimezoneCorrection("2026-06-20T09:30:00Z", "Mars"), "");
});

run("photoDateText prefers adjusted date before original dates", () => {
  assert.strictEqual(dateViewsMod.photoDateText({
    dateOverride: "2026-06-19",
    captureDate: "2020-01-01T10:00:00Z",
  }), "2026-06-19");
});

run("formatPhotoDateBucketLabel returns friendly labels while preserving keys", () => {
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026", "years"), "2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06", "months"), "June 2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06-19", "days"), "Jun 19, 2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06-01", "recentDays"), "Jun 1, 2026");
});

run("buildPhotoDateBuckets groups by year month and day", () => {
  const items = [
    { sourcePath: "a.jpg", captureDate: "2026-06-19T10:00:00Z" },
    { sourcePath: "b.jpg", captureDate: "2026-06-18T10:00:00Z" },
    { sourcePath: "c.jpg", captureDate: "2025-02-01T10:00:00Z" },
  ];
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "years").map((bucket) => [bucket.key, bucket.count]), [["2026", 2], ["2025", 1]]);
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "months").map((bucket) => bucket.key), ["2026-06", "2025-02"]);
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "months").map((bucket) => bucket.label), ["June 2026", "February 2025"]);
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "days").map((bucket) => bucket.key), ["2026-06-19", "2026-06-18", "2025-02-01"]);
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "days").map((bucket) => bucket.label), ["Jun 19, 2026", "Jun 18, 2026", "Feb 1, 2025"]);
});

run("buildPhotoDateBuckets limits recent days relative to latest loaded date", () => {
  const items = [
    { sourcePath: "new.jpg", captureDate: "2026-06-19T10:00:00Z" },
    { sourcePath: "near.jpg", captureDate: "2026-06-01T10:00:00Z" },
    { sourcePath: "old.jpg", captureDate: "2026-04-01T10:00:00Z" },
  ];
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "recentDays").map((bucket) => bucket.key), ["2026-06-19", "2026-06-01"]);
});

run("photo date buckets pick representative covers and summary badges", () => {
  const items = [
    { sourcePath: "new.jpg", captureDate: "2026-06-19T10:00:00Z", title: "Newest", duplicateGroup: { groupId: "dupe-1", count: 2 } },
    { sourcePath: "favorite.jpg", captureDate: "2026-06-18T10:00:00Z", title: "Favorite", favorite: true, personCount: 2, locationOverride: { label: "Beach" } },
    { sourcePath: "clip.mov", captureDate: "2026-06-17T10:00:00Z", mediaKind: "video", edited: true, editStackVersionCount: 2 },
  ];
  const buckets = dateViewsMod.buildPhotoDateBuckets(items, "months");
  assert.strictEqual(buckets[0].coverItem.sourcePath, "favorite.jpg");
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBucketSummaryBadges(items), [
    "1 favorite",
    "1 with people",
    "1 place",
    "1 video",
    "1 edited",
    "1 duplicate",
    "1 version",
  ]);
  assert.strictEqual(dateViewsMod.photoDateBucketCoverReason(buckets[0].coverItem), "Favorite");
});

run("photo curation preferences normalize and build feature-less suggestions", () => {
  const normalized = curationMod.normalizePhotoCurationPreferences({
    featureLessPeople: [" Alice ", "alice", ""],
    featureLessPlaces: ["Beach"],
    featureLessDates: ["2026-06-18"],
    featureLessContent: ["time_lapse"],
  });
  assert.deepStrictEqual(normalized.featureLessPeople, ["Alice"]);
  assert.strictEqual(curationMod.photoCurationPreferenceTotal(normalized), 4);
  const added = curationMod.addPhotoCurationPreference(normalized, "content", "concert");
  assert.deepStrictEqual(added.featureLessContent, ["time_lapse", "concert"]);
  const removed = curationMod.removePhotoCurationPreference(added, "content", "TIME_LAPSE");
  assert.deepStrictEqual(removed.featureLessContent, ["concert"]);
  const memoryPrefs = curationMod.normalizePhotoCurationPreferences({
    ...normalized,
    favoriteMemories: ["memory:one", "memory:one"],
    hiddenMemories: ["memory:two"],
    memoryRemovedItems: { "memory:one": ["/a.jpg", "/a.jpg", ""] },
  });
  assert.strictEqual(curationMod.photoCurationPreferenceTotal(memoryPrefs), 7);
  assert.strictEqual(curationMod.photoFeatureLessPreferenceTotal(memoryPrefs), 4);
  assert.strictEqual(curationMod.photoMemoryPreferenceTotal(memoryPrefs), 3);
  assert.strictEqual(curationMod.photoMemoryPreferenceActive(memoryPrefs, "favoriteMemories", "memory:one"), true);
  const resetFeatureLess = curationMod.clearPhotoFeatureLessPreferences(memoryPrefs);
  assert.strictEqual(curationMod.photoFeatureLessPreferenceTotal(resetFeatureLess), 0);
  assert.deepStrictEqual(resetFeatureLess.favoriteMemories, ["memory:one"]);
  assert.deepStrictEqual(resetFeatureLess.hiddenMemories, ["memory:two"]);
  assert.deepStrictEqual(resetFeatureLess.memoryRemovedItems["memory:one"], ["/a.jpg"]);
  const resetMemoryFeedback = curationMod.clearPhotoMemoryPreferences(memoryPrefs);
  assert.strictEqual(curationMod.photoMemoryPreferenceTotal(resetMemoryFeedback), 0);
  assert.deepStrictEqual(resetMemoryFeedback.featureLessPeople, ["Alice"]);
  assert.deepStrictEqual(resetMemoryFeedback.featureLessPlaces, ["Beach"]);
  assert.deepStrictEqual(resetMemoryFeedback.featureLessDates, ["2026-06-18"]);
  assert.deepStrictEqual(resetMemoryFeedback.featureLessContent, ["time_lapse"]);
  const unfavoritedMemory = curationMod.setPhotoMemoryPreference(memoryPrefs, "favoriteMemories", "memory:one", false);
  assert.strictEqual(curationMod.photoMemoryPreferenceActive(unfavoritedMemory, "favoriteMemories", "memory:one"), false);
  const removedFromMemory = curationMod.addPhotoMemoryRemovedItems(unfavoritedMemory, "memory:one", ["/b.jpg", "/a.jpg"]);
  assert.deepStrictEqual(removedFromMemory.memoryRemovedItems["memory:one"], ["/a.jpg", "/b.jpg"]);
  const resetMemory = curationMod.clearPhotoMemoryRemovedItems(removedFromMemory, "memory:one");
  assert.deepStrictEqual(resetMemory.memoryRemovedItems, {});
  const suggestions = curationMod.buildPhotoFeatureLessSuggestions({
    sourcePath: "clip.mov",
    mediaKind: "time_lapse",
    captureDate: "2026-06-18T10:00:00Z",
    people: [{ personName: "Alice" }, { personName: "Bob" }],
    locationOverride: { label: "Beach" },
    keywords: ["concert"],
    assetMetadata: { labels: [{ name: "stage" }] },
  }, normalized);
  assert.deepStrictEqual(suggestions.map((item) => [item.kind, item.value, item.active]), [
    ["person", "Alice", true],
    ["person", "Bob", false],
    ["place", "Beach", true],
    ["date", "2026-06-18", true],
    ["content", "time_lapse", true],
  ]);
  assert.deepStrictEqual(curationMod.buildPhotoMemoryFeatureLessSuggestions({
    memoryId: "event:one",
    category: "event",
    name: "Birthday 2026",
    count: 2,
    startDate: "2026-04-08",
  }, added).map((item) => [item.kind, item.value, item.active]), [
    ["content", "Birthday", false],
    ["date", "2026-04-08", false],
  ]);
  assert.deepStrictEqual(curationMod.buildPhotoMemoryFeatureLessSuggestions({
    memoryId: "person:alice",
    category: "person",
    name: "Alice Highlights",
    count: 3,
  }, normalized).map((item) => [item.kind, item.value, item.active]), [
    ["person", "Alice", true],
  ]);
});

run("photo slideshow queue prefers selected playable items in current order", () => {
  const items = [
    { sourcePath: "/a.jpg", previewUrl: "preview-a" },
    { sourcePath: "/b.jpg", previewUrl: "preview-b" },
    { sourcePath: "/missing.jpg", previewUrl: "preview-missing", missingAt: "2026-01-01T00:00:00Z" },
    { sourcePath: "/c.jpg", previewUrl: "preview-c" },
  ];
  const queue = slideshowMod.buildPhotoSlideshowQueue(items, ["/c.jpg", "/missing.jpg", "/a.jpg"], "/c.jpg");
  assert.strictEqual(queue.source, "selection");
  assert.deepStrictEqual(queue.items.map((item) => item.sourcePath), ["/a.jpg", "/c.jpg"]);
  assert.strictEqual(queue.startIndex, 1);
});

run("photo slideshow queue falls back to current view and wraps navigation", () => {
  const queue = slideshowMod.buildPhotoSlideshowQueue([
    { sourcePath: "/a.jpg", sourceUrl: "source-a" },
    { sourcePath: "/b.mov", sourceUrl: "source-b", mediaKind: "video" },
  ]);
  assert.strictEqual(queue.source, "view");
  assert.deepStrictEqual(queue.items.map((item) => item.sourcePath), ["/a.jpg", "/b.mov"]);
  assert.strictEqual(slideshowMod.nextPhotoSlideshowIndex(1, 2, "next"), 0);
  assert.strictEqual(slideshowMod.nextPhotoSlideshowIndex(0, 2, "previous"), 1);
});

run("photo slideshow projects normalize settings and selected source order", () => {
  const normalized = slideshowProjectsMod.normalizePhotoSlideshowProject({
    id: "project one",
    name: "  Summer  ",
    title: "",
    sourceLabel: " Selection ",
    sourcePaths: ["/a.jpg", "/a.jpg", "", "/b.mov"],
    theme: "ken-burns",
    themeTimelinePreset: "fade-hold",
    themeTemplateName: "  Gallery Warm  ",
    themeTemplatePalette: "paper",
    themeTemplateTypography: "editorial",
    themeTemplateBackdrop: "spotlight",
    themeTemplateLayout: "poster",
    themeTemplateBackdropIntensity: 72,
    themeTemplateStageWidth: 82,
    themeTemplateFrameStyle: "matte",
    themeTemplateChromeDensity: "compact",
    themeTemplateCaptionPreset: "title-sub",
    templateRegionMap: {
      caption: { x: 0.11, y: 0.22, width: 0.44, height: 0.16, unit: "fraction" },
      count: { left: 75, top: 81, right: 92, bottom: 89 },
    },
    music: "custom",
    musicPath: "/music/summer.mp3",
    audioVolume: 55,
    audioFadeMs: 750,
    audioStartMs: 500,
    audioEndMs: 1500,
    audioPlacementStartSourcePath: "/a.jpg",
    audioPlacementEndSourcePath: "/b.mov",
    includeTitleCard: true,
    titleCardTitle: "Summer Opener",
    titleCardSubtitle: "Beach week",
    titleCardDurationMs: 1200,
    titleCardPalette: "sunset",
    titleCardLayout: "lower-third",
    titleCardFontScale: "large",
    titleCardShowFooter: false,
    transitionEffect: "dissolve",
    transitionDurationMs: 9001,
    timelineItems: [
      {
        sourcePath: "/b.mov",
        durationMs: 12000,
        motion: "pan-left",
        motionKeyframes: { fromX: -8, fromY: 37.4, q1X: 30, q1Y: 42, middleX: 51, middleY: 48, q3X: 68, q3Y: 58, toX: 144, toY: 62.6, zoomStart: 0.5, zoomQuarter: 1.06, zoomMid: 1.12, zoomThreeQuarter: 1.2, zoomEnd: 2, keyframeCurve: "bezier" },
        cropFocusX: 125,
        cropFocusY: 34.4,
        cropScale: 4.5,
        caption: "  Harbor sunset  ",
        captionPosition: "top-right",
        captionBox: { x: 0.1, y: 0.2, width: 0.3, height: 0.12, unit: "fraction" },
        captionStyle: "serif",
        captionWrapping: "two",
        captionBlocks: [
          {
            text: "  Travel note  ",
            placement: "bottom-left",
            region: { left: 0.06, top: 0.74, width: 0.32, height: 0.1, unit: "fraction" },
            typography: "heavy",
            wrap: "multi",
          },
        ],
        transitionStyle: "fade",
        transitionMs: 1250,
      },
      { sourcePath: "/missing.jpg", durationMs: 1000 },
      { sourcePath: "/a.jpg", durationMs: 250, motionPreset: "space-warp" },
    ],
    intervalMs: 300,
    fitMode: "fill",
    createdAt: "2026-06-24T00:00:00Z",
  });
  assert.strictEqual(normalized.id, "project-one");
  assert.strictEqual(normalized.name, "Summer");
  assert.strictEqual(normalized.title, "Summer");
  assert.deepStrictEqual(normalized.sourcePaths, ["/a.jpg", "/b.mov"]);
  assert.strictEqual(normalized.theme, "ken-burns");
  assert.strictEqual(normalized.themeTimelinePreset, "fade-hold");
  assert.strictEqual(normalized.themeTemplateName, "Gallery Warm");
  assert.strictEqual(normalized.themeTemplatePalette, "paper");
  assert.strictEqual(normalized.themeTemplateTypography, "editorial");
  assert.strictEqual(normalized.themeTemplateBackdrop, "spotlight");
  assert.strictEqual(normalized.themeTemplateLayout, "poster");
  assert.strictEqual(normalized.themeTemplateBackdropIntensity, 72);
  assert.strictEqual(normalized.themeTemplateStageWidth, 82);
  assert.strictEqual(normalized.themeTemplateFrameStyle, "matte");
  assert.strictEqual(normalized.themeTemplateChromeDensity, "compact");
  assert.strictEqual(normalized.themeTemplateCaptionPreset, "title-subtitle");
  assert.deepStrictEqual(normalized.themeTemplateRegionMap, {
    primary: { x: 11, y: 22, width: 44, height: 16 },
    counter: { x: 75, y: 81, width: 17, height: 8 },
  });
  assert.strictEqual(normalized.music, "custom");
  assert.strictEqual(normalized.musicPath, "/music/summer.mp3");
  assert.strictEqual(normalized.audioVolume, 0.55);
  assert.strictEqual(normalized.audioFadeMs, 750);
  assert.strictEqual(normalized.audioStartMs, 500);
  assert.strictEqual(normalized.audioEndMs, 1500);
  assert.strictEqual(normalized.audioPlacementStartSourcePath, "/a.jpg");
  assert.strictEqual(normalized.audioPlacementEndSourcePath, "/b.mov");
  assert.strictEqual(normalized.includeTitleCard, true);
  assert.strictEqual(normalized.titleCardTitle, "Summer Opener");
  assert.strictEqual(normalized.titleCardSubtitle, "Beach week");
  assert.strictEqual(normalized.titleCardDurationMs, 1500);
  assert.strictEqual(normalized.titleCardPalette, "sunset");
  assert.strictEqual(normalized.titleCardLayout, "lower-third");
  assert.strictEqual(normalized.titleCardFontScale, "large");
  assert.strictEqual(normalized.titleCardShowFooter, false);
  assert.strictEqual(normalized.transitionEffect, "dissolve");
  assert.strictEqual(normalized.transitionDurationMs, 3000);
  assert.deepStrictEqual(normalized.timelineItems, [
    { sourcePath: "/a.jpg", durationMs: 500, motion: "auto" },
    {
      sourcePath: "/b.mov",
      durationMs: 12000,
      motion: "pan-left",
      keyframes: { startX: 0, startY: 37, quarterX: 30, quarterY: 42, midX: 51, midY: 48, threeQuarterX: 68, threeQuarterY: 58, endX: 100, endY: 63, startZoom: 1, quarterZoom: 1.06, midZoom: 1.12, threeQuarterZoom: 1.2, endZoom: 1.5, curve: "smooth" },
      focalX: 100,
      focalY: 34,
      cropZoom: 3,
      captionText: "Harbor sunset",
      captionPlacement: "upper-right",
      captionRegion: { x: 10, y: 20, width: 30, height: 12 },
      captionTypography: "editorial",
      captionWrap: "two-line",
      captions: [
        {
          id: "caption-2",
          captionText: "Travel note",
          captionPlacement: "lower-left",
          captionRegion: { x: 6, y: 74, width: 32, height: 10 },
          captionTypography: "bold",
          captionWrap: "multi-line",
        },
      ],
      transitionEffect: "fade",
      transitionDurationMs: 1250,
    },
  ]);
  assert.strictEqual(normalized.intervalMs, 1500);
  assert.strictEqual(normalized.fitMode, "fill");
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowProjectSourcePaths([
    { sourcePath: "/a.jpg" },
    { sourcePath: "/missing.jpg", missingAt: "2026-01-01T00:00:00Z" },
    { sourcePath: "/b.mov" },
  ], ["/b.mov", "/a.jpg"]), ["/a.jpg", "/b.mov"]);
  assert.deepStrictEqual(slideshowProjectsMod.cleanPhotoSlideshowMotionKeyframes({
    x1: 25,
    y1: 45,
    q1X: 32,
    q1Y: 42,
    centerX: 40,
    centerY: 35,
    q3X: 58,
    q3Y: 48,
    x2: 75,
    y2: 55,
    scaleStart: 1.02,
    scaleQuarter: 1.05,
    scaleMid: 1.09,
    scaleThreeQuarter: 1.12,
    scaleEnd: 1.16,
    easing: "cinema",
  }), { startX: 25, startY: 45, quarterX: 32, quarterY: 42, midX: 40, midY: 35, threeQuarterX: 58, threeQuarterY: 48, endX: 75, endY: 55, startZoom: 1.02, quarterZoom: 1.05, midZoom: 1.09, threeQuarterZoom: 1.12, endZoom: 1.16, curve: "cinematic" });
  assert.deepStrictEqual(slideshowProjectsMod.cleanPhotoSlideshowMotionKeyframes({
    startX: 20,
    startY: 40,
    endX: 80,
    endY: 60,
    startZoom: 1.02,
    quarterZoom: 1.05,
    midZoom: 1.09,
    threeQuarterZoom: 1.12,
    endZoom: 1.16,
    pathType: "curve",
    control1: { x: 40, y: 47 },
    control2: { left: 60, top: 53 },
    keyframeCurve: "cinema",
  }), {
    startX: 20,
    startY: 40,
    endX: 80,
    endY: 60,
    startZoom: 1.02,
    endZoom: 1.16,
    pathMode: "bezier",
    quarterZoom: 1.05,
    midZoom: 1.09,
    threeQuarterZoom: 1.12,
    curve: "cinematic",
    bezierControl1X: 40,
    bezierControl1Y: 47,
    bezierControl2X: 60,
    bezierControl2Y: 53,
    quarterX: 35,
    quarterY: 45,
    midX: 50,
    midY: 50,
    threeQuarterX: 65,
    threeQuarterY: 55,
  });
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowMotionKeyframesWithBezierControls({
    startX: 20,
    startY: 40,
    quarterX: 35,
    quarterY: 45,
    midX: 50,
    midY: 50,
    threeQuarterX: 65,
    threeQuarterY: 55,
    endX: 80,
    endY: 60,
    startZoom: 1.02,
    quarterZoom: 1.05,
    midZoom: 1.09,
    threeQuarterZoom: 1.12,
    endZoom: 1.16,
    curve: "cinematic",
  }, {
    control1: { x: 40, y: 47 },
    control2: { x: 60, y: 53 },
  }), {
    startX: 20,
    startY: 40,
    endX: 80,
    endY: 60,
    startZoom: 1.02,
    endZoom: 1.16,
    pathMode: "bezier",
    quarterX: 35,
    quarterY: 45,
    quarterZoom: 1.05,
    midX: 50,
    midY: 50,
    midZoom: 1.09,
    threeQuarterX: 65,
    threeQuarterY: 55,
    threeQuarterZoom: 1.12,
    curve: "cinematic",
    bezierControl1X: 40,
    bezierControl1Y: 47,
    bezierControl2X: 60,
    bezierControl2Y: 53,
  });
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowMotionPathPointsFromKeyframes({
    startX: 20,
    startY: 40,
    endX: 80,
    endY: 60,
    startZoom: 1.01,
    endZoom: 1.14,
  }), [
    { key: "start", x: 20, y: 40 },
    { key: "quarter", x: 35, y: 45 },
    { key: "mid", x: 50, y: 50 },
    { key: "threeQuarter", x: 65, y: 55 },
    { key: "end", x: 80, y: 60 },
  ]);
  assert.deepStrictEqual(slideshowProjectsMod.samplePhotoSlideshowFreehandPathPoints([
    { x: 10, y: 10 },
    { x: 90, y: 10 },
    { x: 90, y: 90 },
  ]), [
    { key: "start", x: 10, y: 10 },
    { key: "quarter", x: 50, y: 10 },
    { key: "mid", x: 90, y: 10 },
    { key: "threeQuarter", x: 90, y: 50 },
    { key: "end", x: 90, y: 90 },
  ]);
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowMotionKeyframesWithPathPoints({
    startX: 20,
    startY: 40,
    quarterX: 35,
    quarterY: 45,
    midX: 50,
    midY: 50,
    threeQuarterX: 65,
    threeQuarterY: 55,
    endX: 80,
    endY: 60,
    startZoom: 1.01,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.11,
    endZoom: 1.14,
    curve: "smooth",
  }, [
    { key: "start", x: -20, y: 40 },
    { key: "mid", x: 44, y: 56 },
    { key: "end", x: 120, y: 60 },
  ]), {
    startX: 0,
    startY: 40,
    quarterX: 35,
    quarterY: 45,
    midX: 44,
    midY: 56,
    threeQuarterX: 65,
    threeQuarterY: 55,
    endX: 100,
    endY: 60,
    startZoom: 1.01,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.11,
    endZoom: 1.14,
    curve: "smooth",
  });
  const anchorKeyframes = slideshowProjectsMod.photoSlideshowMotionKeyframesWithPathPoints({
    startX: 20,
    startY: 40,
    endX: 80,
    endY: 60,
    startZoom: 1.01,
    endZoom: 1.14,
    pathMode: "bezier",
    bezierControl1X: 40,
    bezierControl1Y: 47,
    bezierControl2X: 60,
    bezierControl2Y: 53,
  }, [
    { key: "start", x: 20, y: 40 },
    { key: "end", x: 80, y: 60 },
  ]);
  assert.strictEqual(anchorKeyframes.pathMode, "keyframes");
  assert.strictEqual("bezierControl1X" in anchorKeyframes, false);
  assert.strictEqual("bezierControl2Y" in anchorKeyframes, false);
});

run("photo slideshow projects build theme-resolved motion timelines", () => {
  const timeline = slideshowProjectsMod.buildPhotoSlideshowThemeTimeline([
    { sourcePath: "/a.jpg", durationMs: 2000, motion: "auto" },
    {
      sourcePath: "/b.jpg",
      durationMs: 3000,
      motion: "pan-right",
      keyframes: { startX: 25, startY: 45, quarterX: 32, quarterY: 42, midX: 40, midY: 35, threeQuarterX: 58, threeQuarterY: 48, endX: 75, endY: 55, startZoom: 1.02, quarterZoom: 1.05, midZoom: 1.09, threeQuarterZoom: 1.12, endZoom: 1.16, curve: "ease" },
      transitionEffect: "dissolve",
      transitionDurationMs: 400,
    },
    { sourcePath: "/c.jpg", durationMs: 4000, motion: "auto" },
  ], ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"], 5000, "ken-burns", "auto", 700);
  assert.deepStrictEqual(timeline.map((item) => ({
    sourcePath: item.sourcePath,
    durationMs: item.durationMs,
    motion: item.motion,
    keyframes: item.keyframes,
    resolvedMotion: item.resolvedMotion,
    transitionOut: item.transitionOut,
    transitionDurationMs: item.transitionDurationMs,
    themeCue: item.themeCue,
  })), [
    { sourcePath: "/a.jpg", durationMs: 2000, motion: "auto", keyframes: undefined, resolvedMotion: "slow-zoom", transitionOut: "zoom", transitionDurationMs: 700, themeCue: "Ken Burns slow zoom 1" },
    {
      sourcePath: "/b.jpg",
      durationMs: 3000,
      motion: "pan-right",
      keyframes: { startX: 25, startY: 45, quarterX: 32, quarterY: 42, midX: 40, midY: 35, threeQuarterX: 58, threeQuarterY: 48, endX: 75, endY: 55, startZoom: 1.02, quarterZoom: 1.05, midZoom: 1.09, threeQuarterZoom: 1.12, endZoom: 1.16, curve: "ease" },
      resolvedMotion: "custom",
      transitionOut: "dissolve",
      transitionDurationMs: 400,
      themeCue: "Custom keyframes 2",
    },
    { sourcePath: "/c.jpg", durationMs: 4000, motion: "auto", keyframes: undefined, resolvedMotion: "pan-right", transitionOut: "zoom", transitionDurationMs: 700, themeCue: "Ken Burns pan right 3" },
    { sourcePath: "/d.jpg", durationMs: 5000, motion: "auto", keyframes: undefined, resolvedMotion: "slow-zoom", transitionOut: "cut", transitionDurationMs: 0, themeCue: "Ken Burns slow zoom 4" },
  ]);
  assert.strictEqual(slideshowProjectsMod.photoSlideshowThemeTimelinePreset("fade"), "fade-hold");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowThemeTimelinePreset("classic", "ken-burns-drift"), "ken-burns-drift");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedMotionPreset("auto", "classic", 2), "still");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedMotionPreset("auto", "classic", 2, "ken-burns-drift"), "pan-right");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedTransitionEffect("auto", "ken-burns"), "zoom");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedTransitionEffect("auto", "classic", "ken-burns-drift"), "zoom");
  const authoredTimeline = slideshowProjectsMod.buildPhotoSlideshowThemeTimeline(
    [{ sourcePath: "/a.jpg", durationMs: 2000, motion: "auto" }, { sourcePath: "/b.jpg", durationMs: 2000, motion: "auto" }],
    ["/a.jpg", "/b.jpg"],
    2000,
    "classic",
    "auto",
    650,
    "ken-burns-drift",
  );
  assert.deepStrictEqual(authoredTimeline.map((item) => ({
    resolvedMotion: item.resolvedMotion,
    transitionOut: item.transitionOut,
    transitionDurationMs: item.transitionDurationMs,
    themeCue: item.themeCue,
  })), [
    { resolvedMotion: "slow-zoom", transitionOut: "zoom", transitionDurationMs: 650, themeCue: "Ken Burns slow zoom 1" },
    { resolvedMotion: "pan-left", transitionOut: "cut", transitionDurationMs: 0, themeCue: "Ken Burns pan left 2" },
  ]);
});

run("photo slideshow projects upsert by name and delete by id", () => {
  const first = slideshowProjectsMod.upsertPhotoSlideshowProject([], {
    name: "Favorites show",
    sourcePaths: ["/a.jpg", "/b.jpg"],
    theme: "fade",
    music: "calm",
    now: "2026-06-24T00:00:00.000Z",
  });
  assert.strictEqual(first.length, 1);
  assert.strictEqual(first[0].theme, "fade");
  const updated = slideshowProjectsMod.upsertPhotoSlideshowProject(first, {
    name: "favorites show",
    title: "Favorites",
    sourcePaths: ["/c.jpg"],
    theme: "classic",
    themeTemplateName: "Favorites Matte",
    themeTemplatePalette: "sunset",
    themeTemplateTypography: "cinematic",
    themeTemplateBackdrop: "blur",
    themeTemplateLayout: "split",
    themeTemplateBackdropIntensity: 64,
    themeTemplateStageWidth: 87,
    themeTemplateFrameStyle: "accent",
    themeTemplateChromeDensity: "spacious",
    themeTemplateCaptionPreset: "gallery-tags",
    themeTemplateRegionMap: {
      primary: { x: 12, y: 64, width: 36, height: 15 },
      context: { x: 58, y: 16, width: 30, height: 8 },
    },
    music: "custom",
    musicPath: "/music/favorites.wav",
    audioVolume: 0.35,
    audioFadeMs: 1200,
    audioStartMs: 800,
    audioEndMs: 400,
    audioPlacementStartSourcePath: "/c.jpg",
    audioPlacementEndSourcePath: "/a.jpg",
    includeTitleCard: true,
    titleCardTitle: "Favorites Title",
    titleCardSubtitle: "Favorites subtitle",
    titleCardDurationMs: 2200,
    titleCardPalette: "forest",
    titleCardLayout: "left",
    titleCardFontScale: "compact",
    titleCardShowFooter: false,
    transitionEffect: "cut",
    transitionDurationMs: 950,
    timelineItems: [
      { sourcePath: "/c.jpg", durationMs: 8750, keyframeMotion: "slow-zoom" },
      { sourcePath: "/a.jpg", durationMs: 9999 },
    ],
    now: "2026-06-24T01:00:00.000Z",
  });
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].id, first[0].id);
  assert.strictEqual(updated[0].title, "Favorites");
  assert.deepStrictEqual(updated[0].sourcePaths, ["/c.jpg"]);
  assert.strictEqual(updated[0].themeTemplateName, "Favorites Matte");
  assert.strictEqual(updated[0].themeTemplatePalette, "sunset");
  assert.strictEqual(updated[0].themeTemplateTypography, "cinematic");
  assert.strictEqual(updated[0].themeTemplateBackdrop, "blur");
  assert.strictEqual(updated[0].themeTemplateLayout, "split");
  assert.strictEqual(updated[0].themeTemplateBackdropIntensity, 64);
  assert.strictEqual(updated[0].themeTemplateStageWidth, 87);
  assert.strictEqual(updated[0].themeTemplateFrameStyle, "accent");
  assert.strictEqual(updated[0].themeTemplateChromeDensity, "spacious");
  assert.strictEqual(updated[0].themeTemplateCaptionPreset, "gallery-labels");
  assert.deepStrictEqual(updated[0].themeTemplateRegionMap, {
    primary: { x: 12, y: 64, width: 36, height: 15 },
    context: { x: 58, y: 16, width: 30, height: 8 },
  });
  assert.strictEqual(updated[0].music, "custom");
  assert.strictEqual(updated[0].musicPath, "/music/favorites.wav");
  assert.strictEqual(updated[0].audioVolume, 0.35);
  assert.strictEqual(updated[0].audioFadeMs, 1200);
  assert.strictEqual(updated[0].audioStartMs, 800);
  assert.strictEqual(updated[0].audioEndMs, 0);
  assert.strictEqual(updated[0].audioPlacementStartSourcePath, "/c.jpg");
  assert.strictEqual(updated[0].audioPlacementEndSourcePath, "");
  assert.strictEqual(updated[0].includeTitleCard, true);
  assert.strictEqual(updated[0].titleCardTitle, "Favorites Title");
  assert.strictEqual(updated[0].titleCardSubtitle, "Favorites subtitle");
  assert.strictEqual(updated[0].titleCardDurationMs, 2200);
  assert.strictEqual(updated[0].titleCardPalette, "forest");
  assert.strictEqual(updated[0].titleCardLayout, "left");
  assert.strictEqual(updated[0].titleCardFontScale, "compact");
  assert.strictEqual(updated[0].titleCardShowFooter, false);
  assert.strictEqual(updated[0].transitionEffect, "cut");
  assert.strictEqual(updated[0].transitionDurationMs, 0);
  assert.deepStrictEqual(updated[0].timelineItems, [{ sourcePath: "/c.jpg", durationMs: 8750, motion: "slow-zoom" }]);
  const withSecond = slideshowProjectsMod.upsertPhotoSlideshowProject(updated, {
    name: "Trip show",
    sourcePaths: ["/d.jpg"],
    now: "2026-06-24T02:00:00.000Z",
  });
  assert.strictEqual(withSecond.length, 2);
  const collision = slideshowProjectsMod.upsertPhotoSlideshowProject(withSecond, {
    id: updated[0].id,
    name: "Trip show",
    sourcePaths: ["/e.jpg"],
    now: "2026-06-24T03:00:00.000Z",
  });
  assert.strictEqual(collision.length, 2);
  assert.strictEqual(collision.find((project) => project.id === updated[0].id)?.name, "favorites show");
  assert.deepStrictEqual(collision.find((project) => project.name === "Trip show")?.sourcePaths, ["/d.jpg"]);
  assert.strictEqual(slideshowProjectsMod.deletePhotoSlideshowProject(updated, updated[0].id).length, 0);
});

run("photo slideshow project cap preserves existing projects and blocks overflow saves", () => {
  const rawProjects = Array.from({ length: slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT + 1 }, (_, index) => ({
    id: `slideshow:existing-${index}`,
    name: `Existing ${index}`,
    sourcePaths: [`/${index}.jpg`],
    updatedAt: `2026-06-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
  }));
  const preserved = slideshowProjectsMod.normalizePhotoSlideshowProjectList(rawProjects);
  assert.strictEqual(preserved.length, slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT + 1);
  const capped = slideshowProjectsMod.normalizePhotoSlideshowProjectList(rawProjects, slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT);
  assert.strictEqual(capped.length, slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT);
  const overflow = slideshowProjectsMod.upsertPhotoSlideshowProject(capped, {
    name: "Overflow show",
    sourcePaths: ["/overflow.jpg"],
    now: "2026-06-30T00:00:00.000Z",
  });
  assert.strictEqual(overflow.length, slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT);
  assert.strictEqual(overflow.some((project) => project.name === "Overflow show"), false);
});

run("photo slideshow theme templates normalize upsert and delete", () => {
  const normalized = slideshowProjectsMod.normalizePhotoSlideshowThemeTemplate({
    id: "template-one",
    name: "  Gallery Matte  ",
    theme: "ken-burns",
    themeTimelinePreset: "fade-hold",
    themeTemplatePalette: "paper",
    themeTemplateTypography: "editorial",
    themeTemplateBackdrop: "film",
    themeTemplateLayout: "immersive",
    themeTemplateBackdropIntensity: 25,
    themeTemplateStageWidth: 71,
    themeTemplateFrameStyle: "hairline",
    themeTemplateChromeDensity: "regular",
    themeTemplateCaptionPreset: "letterbox",
    themeTemplateCaptionRegions: [
      { slot: "subtitle", region: { x: 0.2, y: 0.72, width: 0.5, height: 0.1, unit: "fraction" } },
      { slot: "chapter-label", region: { x: 4, y: 88, width: 62, height: 8 } },
    ],
    transitionEffect: "cut",
    transitionDurationMs: 1200,
    includeTitleCard: true,
    titleCardPalette: "forest",
    titleCardLayout: "lower-third",
    titleCardFontScale: "large",
    titleCardShowFooter: false,
  });
  assert.strictEqual(normalized.id, "template-one");
  assert.strictEqual(normalized.name, "Gallery Matte");
  assert.strictEqual(normalized.theme, "ken-burns");
  assert.strictEqual(normalized.themeTimelinePreset, "fade-hold");
  assert.strictEqual(normalized.themeTemplatePalette, "paper");
  assert.strictEqual(normalized.themeTemplateTypography, "editorial");
  assert.strictEqual(normalized.themeTemplateBackdrop, "film");
  assert.strictEqual(normalized.themeTemplateLayout, "immersive");
  assert.strictEqual(normalized.themeTemplateBackdropIntensity, 25);
  assert.strictEqual(normalized.themeTemplateStageWidth, 71);
  assert.strictEqual(normalized.themeTemplateFrameStyle, "hairline");
  assert.strictEqual(normalized.themeTemplateChromeDensity, "regular");
  assert.strictEqual(normalized.themeTemplateCaptionPreset, "cinema-bars");
  assert.deepStrictEqual(normalized.themeTemplateRegionMap, {
    context: { x: 20, y: 72, width: 50, height: 10 },
    chapter: { x: 4, y: 88, width: 62, height: 8 },
  });
  assert.strictEqual(normalized.transitionEffect, "cut");
  assert.strictEqual(normalized.transitionDurationMs, 0);
  assert.strictEqual(normalized.includeTitleCard, true);
  assert.strictEqual(normalized.titleCardPalette, "forest");
  assert.strictEqual(normalized.titleCardLayout, "lower-third");
  assert.strictEqual(normalized.titleCardFontScale, "large");
  assert.strictEqual(normalized.titleCardShowFooter, false);

  const saved = slideshowProjectsMod.upsertPhotoSlideshowThemeTemplate([], {
    name: "Gallery Matte",
    theme: "fade",
    themeTimelinePreset: "ken-burns-drift",
    themeTemplatePalette: "sunset",
    themeTemplateTypography: "cinematic",
    themeTemplateBackdrop: "spotlight",
    themeTemplateLayout: "poster",
    themeTemplateBackdropIntensity: 68,
    themeTemplateStageWidth: 89,
    themeTemplateFrameStyle: "matte",
    themeTemplateChromeDensity: "compact",
    themeTemplateCaptionPreset: "split-story",
    themeTemplateRegionMap: {
      primary: { x: 10, y: 60, width: 35, height: 18 },
      counter: { x: 80, y: 83, width: 12, height: 6 },
    },
    transitionEffect: "dissolve",
    transitionDurationMs: 900,
    includeTitleCard: true,
    titleCardPalette: "auto",
    titleCardLayout: "left",
    titleCardFontScale: "compact",
    titleCardShowFooter: false,
    now: "2026-06-26T00:00:00.000Z",
  });
  assert.strictEqual(saved.length, 1);
  assert.strictEqual(saved[0].name, "Gallery Matte");
  assert.strictEqual(saved[0].themeTemplatePalette, "sunset");
  assert.strictEqual(saved[0].themeTemplateTypography, "cinematic");
  assert.strictEqual(saved[0].themeTemplateBackdrop, "spotlight");
  assert.strictEqual(saved[0].themeTemplateLayout, "poster");
  assert.strictEqual(saved[0].themeTemplateBackdropIntensity, 68);
  assert.strictEqual(saved[0].themeTemplateStageWidth, 89);
  assert.strictEqual(saved[0].themeTemplateFrameStyle, "matte");
  assert.strictEqual(saved[0].themeTemplateChromeDensity, "compact");
  assert.strictEqual(saved[0].themeTemplateCaptionPreset, "split-story");
  assert.deepStrictEqual(saved[0].themeTemplateRegionMap, {
    primary: { x: 10, y: 60, width: 35, height: 18 },
    counter: { x: 80, y: 83, width: 12, height: 6 },
  });
  assert.strictEqual(saved[0].transitionDurationMs, 900);
  const updated = slideshowProjectsMod.upsertPhotoSlideshowThemeTemplate(saved, {
    name: "gallery matte",
    theme: "classic",
    themeTemplatePalette: "midnight",
    themeTemplateTypography: "clean",
    themeTemplateBackdrop: "solid",
    themeTemplateLayout: "minimal",
    themeTemplateBackdropIntensity: 40,
    themeTemplateStageWidth: 77,
    themeTemplateFrameStyle: "none",
    themeTemplateChromeDensity: "spacious",
    themeTemplateCaptionPreset: "lowerthird",
    themeTemplateRegionMap: {
      title: { x: 3, y: 4, width: 48, height: 8 },
    },
    transitionEffect: "cut",
    now: "2026-06-26T01:00:00.000Z",
  });
  assert.strictEqual(updated.length, 1);
  assert.strictEqual(updated[0].id, saved[0].id);
  assert.strictEqual(updated[0].theme, "classic");
  assert.strictEqual(updated[0].themeTemplatePalette, "midnight");
  assert.strictEqual(updated[0].themeTemplateTypography, "clean");
  assert.strictEqual(updated[0].themeTemplateBackdrop, "solid");
  assert.strictEqual(updated[0].themeTemplateLayout, "minimal");
  assert.strictEqual(updated[0].themeTemplateBackdropIntensity, 40);
  assert.strictEqual(updated[0].themeTemplateStageWidth, 77);
  assert.strictEqual(updated[0].themeTemplateFrameStyle, "none");
  assert.strictEqual(updated[0].themeTemplateChromeDensity, "spacious");
  assert.strictEqual(updated[0].themeTemplateCaptionPreset, "lower-third");
  assert.deepStrictEqual(updated[0].themeTemplateRegionMap, {
    title: { x: 3, y: 4, width: 48, height: 8 },
  });
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedCaptionPreset("auto", "poster"), "title-subtitle");
  assert.strictEqual(slideshowProjectsMod.photoSlideshowResolvedCaptionPreset("auto", "split"), "split-story");
  assert.deepStrictEqual(slideshowProjectsMod.cleanPhotoSlideshowThemeTemplateRegionMap({
    body: [0.1, 0.6, 0.3, 0.2],
    "slide-counter": { left: 80, top: 82, width: 12, height: 6 },
    bad: { x: 1, y: 2 },
  }), {
    primary: { x: 10, y: 60, width: 30, height: 20 },
    counter: { x: 80, y: 82, width: 12, height: 6 },
  });
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowResolvedRegionMap("auto", "split", {
    primary: { x: 9, y: 61, width: 34, height: 18 },
  }).primary, { x: 9, y: 61, width: 34, height: 18 });
  assert.deepStrictEqual(slideshowProjectsMod.photoSlideshowResolvedRegionMap("auto", "split", {
    primary: { x: 9, y: 61, width: 34, height: 18 },
  }).context, { x: 58, y: 13, width: 34, height: 10 });
  assert.strictEqual(updated[0].transitionEffect, "cut");
  assert.strictEqual(updated[0].transitionDurationMs, 0);
  assert.strictEqual(slideshowProjectsMod.deletePhotoSlideshowThemeTemplate(updated, updated[0].id).length, 0);
});

run("photo virtual grid chunks headers and item rows", () => {
  const layout = virtualGridMod.buildPhotoVirtualGridLayout([
    { kind: "header", key: "h:1", label: "June" },
    { kind: "item", key: "i:1", index: 0, item: { width: 100, height: 100 } },
    { kind: "item", key: "i:2", index: 1, item: { width: 200, height: 100 } },
    { kind: "item", key: "i:3", index: 2, item: { width: 100, height: 200 } },
  ], { containerWidth: 320, minTileSize: 100, aspectMode: "square", gap: 10, headerHeight: 30 });
  assert.strictEqual(layout.columns, 3);
  assert.strictEqual(layout.bands.length, 2);
  assert.strictEqual(layout.bands[0].kind, "header");
  assert.strictEqual(layout.bands[1].kind, "items");
  assert.strictEqual(layout.bands[1].rows.length, 3);
  assert.strictEqual(layout.totalHeight, 140);
});

run("Photos timeline rows avoid quadratic index lookups", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const timelineRowsBlock = source.match(/const timelineRows = useMemo[\s\S]*?\}, \[items, visibleDateItems\]\);/);
  assert.ok(timelineRowsBlock, "timelineRows useMemo block should exist");
  assert.match(timelineRowsBlock[0], /const indexByItem = new Map<PhotoItem, number>\(\)/);
  assert.match(timelineRowsBlock[0], /indexBySourcePath\.get\(String\(item\.sourcePath \|\| ""\)\)/);
  assert.doesNotMatch(timelineRowsBlock[0], /items\.indexOf\(item\)/);
});

run("Photos grid search reload is debounced before backend fetches", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const PHOTO_GRID_SEARCH_DEBOUNCE_MS = 220;/);
  assert.match(source, /const \[debouncedSearchQuery, setDebouncedSearchQuery\] = useState\(""\);/);
  assert.match(source, /window\.setTimeout\(\(\) => setDebouncedSearchQuery\(searchQuery\), PHOTO_GRID_SEARCH_DEBOUNCE_MS\)/);
  assert.match(source, /loadPage\(activeId, 0, sort, debouncedSearchQuery,/);
  assert.match(source, /query: debouncedSearchQuery,/);
  assert.match(source, /loadPage\(activeId, nextOffset\(\{ loaded: items\.length \}\), sort, debouncedSearchQuery,/);
  const autoGridEffect = source.match(/useEffect\(\(\) => \{\s*setItems\(\[\]\);[\s\S]*?gridReloadToken\]\);/);
  assert.ok(autoGridEffect, "automatic grid reload effect should exist");
  assert.doesNotMatch(autoGridEffect[0], /loadPage\(activeId, 0, sort, searchQuery,/);
});

run("Photos grid page limit stays within the preview generation budget", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const PAGE_LIMIT = 64;/);
  assert.match(source, /const PREVIEW_BUDGET = PAGE_LIMIT;/);
  assert.match(source, /limit: PAGE_LIMIT,\s*previewBudget: PREVIEW_BUDGET,/);
  assert.doesNotMatch(source, /const PAGE_LIMIT = 100;/);
  assert.doesNotMatch(source, /const PREVIEW_BUDGET = 64;/);
});

run("Photos video time updates stay out of parent render state", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const PhotoLightboxVideoControls = memo\(function PhotoLightboxVideoControls/);
  assert.match(source, /const lightboxVideoCurrentMsRef = useRef\(0\);/);
  assert.match(source, /video\.addEventListener\("timeupdate", onTimeUpdate\)/);
  assert.match(source, /onTimeUpdate=\{\(event\) => captureLightboxVideoPosition\(event\.currentTarget\)\}/);
  assert.doesNotMatch(source, /const \[lightboxVideoCurrentMs, setLightboxVideoCurrentMs\]/);
  assert.doesNotMatch(source, /setLightboxVideoCurrentMs/);
  assert.doesNotMatch(source, /onTimeUpdate=\{\(event\) => syncLightboxVideoState\(event\.currentTarget\)\}/);
  const keydownEffect = source.match(/window\.addEventListener\("keydown", onKey\);[\s\S]*?`items` is intentionally omitted[\s\S]*?\}, \[[^\]]+\]\);/);
  assert.ok(keydownEffect, "lightbox keydown effect should exist");
  assert.doesNotMatch(keydownEffect[0], /lightboxVideoCurrentMs/);
});

run("Photos bulk favorite shortcut uses batch metadata update", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const block = source.match(/async function toggleSelectedFavorites\(\) \{[\s\S]*?\n  \}\n\n  async function hideSelectedShortcut/);
  assert.ok(block, "toggleSelectedFavorites should exist");
  assert.match(block[0], /await updatePhotoAssetsMetadata\(\{/);
  assert.match(block[0], /items: selectedItems\.map\(\(item\) => \(\{/);
  assert.match(block[0], /result\.value\?\.items/);
  assert.match(block[0], /await loadPhotoOperations\(\)/);
  assert.doesNotMatch(block[0], /for \(const item of selectedItems\)/);
  assert.doesNotMatch(block[0], /updatePhotoAssetMetadata\(\{/);
});

run("Photos selected edit paste batches stack lookups and saves", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(appSource, /"get_photo_edit_stacks"/);
  assert.match(appSource, /"save_photo_edit_stacks"/);
  assert.match(source, /getPhotoEditStacks: \(params: Record<string, unknown>\) => Promise/);
  assert.match(source, /savePhotoEditStacks: \(params: Record<string, unknown>\) => Promise/);

  const editBlock = source.match(/async function pasteImageEditClipboardToSelected\(\) \{[\s\S]*?\n  \}\n\n  async function pasteImageAdjustmentClipboardToSelected/);
  assert.ok(editBlock, "pasteImageEditClipboardToSelected should exist");
  assert.match(editBlock[0], /await getPhotoEditStacks\(\{\s*items: selectedImageEditPasteItems\.map/);
  assert.match(editBlock[0], /await savePhotoEditStacks\(\{\s*items: plans\.map/);
  assert.doesNotMatch(editBlock[0], /await getPhotoEditStack\(\{/);
  assert.doesNotMatch(editBlock[0], /await savePhotoEditStack\(\{/);
  assert.doesNotMatch(editBlock[0], /for \(const \[index, plan\] of plans\.entries\(\)\)/);

  const adjustmentBlock = source.match(/async function pasteImageAdjustmentClipboardToSelected\(\) \{[\s\S]*?\n  \}\n\n  async function revertCurrentPhotoEditStack/);
  assert.ok(adjustmentBlock, "pasteImageAdjustmentClipboardToSelected should exist");
  assert.match(adjustmentBlock[0], /await getPhotoEditStacks\(\{\s*items: selectedImageEditPasteItems\.map/);
  assert.match(adjustmentBlock[0], /await savePhotoEditStacks\(\{\s*items: plans\.map/);
  assert.doesNotMatch(adjustmentBlock[0], /await getPhotoEditStack\(\{/);
  assert.doesNotMatch(adjustmentBlock[0], /await savePhotoEditStack\(\{/);
  assert.doesNotMatch(adjustmentBlock[0], /for \(const \[index, plan\] of plans\.entries\(\)\)/);
});

run("Photos burst-frame fetch effect ignores unrelated item map churn", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const lightboxBurstLoadedSourceKey = useMemo\(\(\) => \{/);
  const fetchEffect = source.match(/useEffect\(\(\) => \{\s*const sourcePaths = lightboxBurstStack\?\.sourcePaths \|\| \[\];[\s\S]*?itemsFnRef\.current\(\{[\s\S]*?collapseBursts: false,[\s\S]*?\}, \[[^\]]+\]\);/);
  assert.ok(fetchEffect, "burst-frame fetch effect should exist");
  assert.match(fetchEffect[0], /lightboxBurstLoadedSourceKey/);
  const dependencies = fetchEffect[0].match(/\}, \[([^\]]+)\]\);$/);
  assert.ok(dependencies, "burst-frame fetch effect dependencies should be parseable");
  assert.doesNotMatch(dependencies[1], /photoItemsBySourcePath/);
});

run("Photos date bucket changes do not double-fetch stale grid pages", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const activeDateBucketScopeSignature = useMemo\(\(\) => \[/);
  assert.match(source, /const activeDateBucketScopeSignatureRef = useRef\(""\);/);
  assert.match(source, /function selectActiveDateBucket\(bucketKey: string\) \{/);
  assert.match(source, /activeDateBucketScopeSignatureRef\.current = cleanBucketKey \? activeDateBucketScopeSignature : "";/);
  assert.match(source, /onClick=\{\(\) => selectActiveDateBucket\(bucket\.key\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setActiveDateBucketKey\(bucket\.key\)\}/);
  const gridReloadEffect = source.match(/useEffect\(\(\) => \{\s*setItems\(\[\]\);[\s\S]*?loadPage\(activeId, 0, sort, debouncedSearchQuery,[\s\S]*?\}, \[[^\]]+\]\);/);
  assert.ok(gridReloadEffect, "automatic grid reload effect should exist");
  assert.match(gridReloadEffect[0], /const showingDateBucketOverview = photoDateViewMode !== "all" && !activeDateBucketKey;/);
  assert.match(gridReloadEffect[0], /const staleDateBucketSelection = photoDateViewMode !== "all"[\s\S]*activeDateBucketScopeSignatureRef\.current !== activeDateBucketScopeSignature;/);
  assert.match(gridReloadEffect[0], /if \(showingDateBucketOverview \|\| staleDateBucketSelection\) \{\s*setLoading\(false\);\s*return;\s*\}/);
  const dependencies = gridReloadEffect[0].match(/\}, \[([^\]]+)\]\);$/);
  assert.ok(dependencies, "grid reload dependencies should be parseable");
  assert.match(dependencies[1], /photoDateViewMode/);
  assert.match(dependencies[1], /activeDateBucketScopeSignature/);
});

run("Photos album cover and suggestion saves surface failures", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const clearCoverBlock = source.match(/async function clearAlbumCover\(folder: PhotoFolder\) \{[\s\S]*?\n  \}\n\n  async function setAlbumCover/);
  assert.ok(clearCoverBlock, "clearAlbumCover should exist");
  assert.match(clearCoverBlock[0], /if \(props\.busy \|\| savingAlbum\) return;/);
  assert.match(clearCoverBlock[0], /setAlbumError\(""\);/);
  assert.match(clearCoverBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(clearCoverBlock[0], /finally \{\s*setSavingAlbum\(false\);/);

  const setCoverBlock = source.match(/async function setAlbumCover\(item: PhotoItem\) \{[\s\S]*?\n  \}\n\n  async function savePersonProfilePatch/);
  assert.ok(setCoverBlock, "setAlbumCover should exist");
  assert.match(setCoverBlock[0], /if \(!activeAlbum \|\| props\.busy \|\| savingAlbum\) return;/);
  assert.match(setCoverBlock[0], /setAlbumError\(""\);/);
  assert.match(setCoverBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(setCoverBlock[0], /finally \{\s*setSavingAlbum\(false\);/);

  const suggestionBlock = source.match(/async function saveSuggestion\(suggestion: PhotoAlbumSuggestion\) \{[\s\S]*?\n  \}\n\n  async function saveActiveSearchAsSmartAlbum/);
  assert.ok(suggestionBlock, "saveSuggestion should exist");
  assert.match(suggestionBlock[0], /setSavingSuggestionId\(suggestionKey\);/);
  assert.match(suggestionBlock[0], /setAlbumError\(""\);/);
  assert.match(suggestionBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(suggestionBlock[0], /setSavingSuggestionId\(\(current\) => \(current === suggestionKey \? "" : current\)\);/);
  assert.doesNotMatch(source, /setSavingSuggestionId\(key\);[\s\S]*?await saveSuggestion\(suggestion\);[\s\S]*?setSavingSuggestionId\(""\);/);
  assert.match(source, /onClick=\{\(\) => void saveSuggestion\(suggestion\)\}/);
  assert.match(source, /disabled=\{props\.busy \|\| savingAlbum\}/);
});

run("Photos metadata drafts reset only when the lightbox source changes", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const resetEffect = source.match(/useEffect\(\(\) => \{\s*const dateTime = splitPhotoDateTimeOverride\(lightItem\?\.dateOverride \|\| ""\);[\s\S]*?setDetectedItemDraft\(""\);\s*\}, \[[^\]]+\]\);/);
  assert.ok(resetEffect, "metadata draft reset effect should exist");
  assert.match(resetEffect[0], /\}, \[currentLightboxSource\]\);$/);
  const dependencies = resetEffect[0].match(/\}, \[([^\]]+)\]\);$/);
  assert.ok(dependencies, "metadata draft reset dependencies should be parseable");
  assert.doesNotMatch(dependencies[1], /lightItem/);
});

run("Photos slideshow primary caption clear preserves secondary captions", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const block = source.match(/function clearPhotoSlideshowSelectedSlideCaption\(\) \{[\s\S]*?resetPhotoSlideshowCaptionDraft\(null\);\s*\}/);
  assert.ok(block, "clearPhotoSlideshowSelectedSlideCaption should exist");
  assert.match(block[0], /const existingCaptions = cleanPhotoSlideshowCaptions\(item\.captions\);/);
  assert.match(block[0], /const nextCaptions = blockIndex >= 0[\s\S]*\? existingCaptions\.filter\(\(_, index\) => index !== blockIndex\)[\s\S]*: existingCaptions;/);
  assert.match(block[0], /\.\.\.\(nextCaptions\.length \? \{ captions: nextCaptions \} : \{\}\),/);
  assert.match(block[0], /\.\.\.\(blockIndex >= 0 \? photoSlideshowPrimaryCaptionPatch\(item\) : \{\}\),/);
  assert.doesNotMatch(block[0], /blockIndex >= 0\s*\?\s*\{\}\s*:\s*\{\}/);
});

run("Photos lightbox viewed events patch recent rail without reloading folders", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const patchRecentActivityFolder = useCallback/);
  const viewedEventBlock = source.match(/recordPhotoAssetEvent\(\{\s*eventType: "viewed"[\s\S]*?\}\)\.then\(\(result\) => \{[\s\S]*?\}\)\.catch/);
  assert.ok(viewedEventBlock, "lightbox viewed event block should exist");
  assert.match(viewedEventBlock[0], /libraryRoot: requestedLibraryRoot/);
  assert.match(viewedEventBlock[0], /libraryRootProfileId: requestedLibraryRootProfileId/);
  assert.match(viewedEventBlock[0], /patchRecentActivityFolder\("recentlyViewed", result\.value, currentLightboxSource, viewedCoverPreviewUrl\)/);
  assert.doesNotMatch(viewedEventBlock[0], /loadFolders\(/);
});

run("Photos rail rows reuse per-section indexes while rendering", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const sectionBlock = source.match(/\{railSections\.map\(\(section\) => \{[\s\S]*?<ul className="photos-rail-list">[\s\S]*?\{section\.folders\.map\(\(folder\) => \{[\s\S]*?const rowMainClass = \[/);
  assert.ok(sectionBlock, "rail section render block should exist");
  assert.match(sectionBlock[0], /const albumTreeParentFolderIds = section\.id === "albums"[\s\S]*new Set\(section\.folders\.map\(\(folder\) => albumTreeParentId\(folder\)\)\.filter\(Boolean\)\)/);
  assert.match(sectionBlock[0], /const albumTreeAncestorIdsByFolderId = section\.id === "albums"[\s\S]*new Map\(section\.folders\.map\(\(folder\) => \[folder\.id, albumTreeAncestorIds\(folder, section\.folders\)\]\)\)/);
  assert.match(sectionBlock[0], /const folderIndexById = new Map\(section\.folders\.map\(\(folder, index\) => \[folder\.id, index\]\)\);/);
  assert.match(sectionBlock[0], /const namedPeopleIndexById = new Map\(namedPeopleFolders\.map\(\(item, index\) => \[item\.id, index\]\)\);/);
  assert.match(sectionBlock[0], /const albumAncestors = albumTreeAncestorIdsByFolderId\?\.get\(folder\.id\) \|\| \[\];/);
  assert.match(sectionBlock[0], /const albumFolderHasChildren = Boolean\(albumFolderId && albumTreeParentFolderIds\?\.has\(albumFolderId\)\);/);
  assert.match(sectionBlock[0], /const railItemOrderIndex = folderIndexById\.get\(folder\.id\) \?\? -1;/);
  assert.match(sectionBlock[0], /const personRailItemOrderIndex = namedPeopleIndexById\.get\(folder\.id\) \?\? -1;/);
  const rowLoop = sectionBlock[0].slice(sectionBlock[0].indexOf("{section.folders.map((folder) => {"));
  assert.doesNotMatch(rowLoop, /section\.folders\.some\(\(item\) => albumTreeParentId/);
  assert.doesNotMatch(rowLoop, /section\.folders\.findIndex\(\(item\) => item\.id === folder\.id\)/);
  assert.doesNotMatch(rowLoop, /section\.folders\.filter\(\(item\) => item\.kind === "person"\)/);
});

run("Photos heavy derived rows use stable label helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /function photoFileName\(sourcePath: string\): string/);
  assert.match(source, /const identityPhotoUiText = \(source: string\) => source;/);
  assert.match(source, /const uiText = props\.uiText \?\? identityPhotoUiText;/);
  assert.match(source, /const fileName = photoFileName;/);
  assert.match(source, /const itemLabel = useCallback\(/);
  assert.doesNotMatch(source, /const fileName = \(sourcePath: string\)/);
  const duplicateGroupsBlock = source.match(/const duplicateReviewGroups = useMemo[\s\S]*?\[fileName, items, selectedSourcePaths\]\s*\);/);
  assert.ok(duplicateGroupsBlock, "duplicate review groups memo should remain explicit about stable fileName");
  const dateBucketCardsBlock = source.match(/const dateBucketCards = useMemo<PhotoDateBucketCard\[\]>\([\s\S]*?\[dateBucketLoaded, dateBucketLoadError, dateBucketLoading, dateBucketRows, itemLabel, items, localDateBuckets, photoDateViewMode\]\s*\);/);
  assert.ok(dateBucketCardsBlock, "date bucket cards memo should depend on stable itemLabel");
});

run("Photos manual collections do not coerce Newest back to Custom order", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const sortEffect = source.match(/useEffect\(\(\) => \{\s*if \(!activeAlbumIsManual && !activeMemoryUserCreated && sort === "manual"\) \{[\s\S]*?\}, \[activeAlbumIsManual, activeMemoryUserCreated, sort\]\);/);
  assert.ok(sortEffect, "manual-sort guard effect should exist");
  assert.match(sortEffect[0], /setSort\("newest"\)/);
  assert.doesNotMatch(sortEffect[0], /sort === "newest"[\s\S]*setSort\("manual"\)/);
  assert.match(source, /\(activeAlbumIsManual \|\| activeMemoryUserCreated\) && <option value="manual">/);
  assert.match(source, /<option value="newest">\{uiText\("Newest"\)\}<\/option>/);
});

run("Photos album delete undo preserves rail people filters", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const deleteAlbumBlock = source.match(/async function deleteAlbum\(folder: PhotoFolder\) \{[\s\S]*?const restoreConfig: Record<string, unknown> = \{[\s\S]*?\};/);
  assert.ok(deleteAlbumBlock, "deleteAlbum should capture a restore config");
  assert.match(deleteAlbumBlock[0], /includePeople: isActive \? \(activeAlbum\?\.includePeople \|\| folder\.includePeople \|\| \[\]\) : \(folder\.includePeople \|\| \[\]\)/);
  assert.match(deleteAlbumBlock[0], /excludePeople: isActive \? \(activeAlbum\?\.excludePeople \|\| folder\.excludePeople \|\| \[\]\) : \(folder\.excludePeople \|\| \[\]\)/);
  assert.doesNotMatch(deleteAlbumBlock[0], /includePeople: isActive \? \(activeAlbum\?\.includePeople \|\| \[\]\) : \[\]/);
  assert.doesNotMatch(deleteAlbumBlock[0], /excludePeople: isActive \? \(activeAlbum\?\.excludePeople \|\| \[\]\) : \[\]/);
});

run("App UI messages preserve raw interpolation values", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const statusRowSource = fs.readFileSync(path.join(ROOT, "src/shell/StatusRow.tsx"), "utf8");
  const messageBlock = appSource.match(/function localizeUiMessageValue[\s\S]*?function setNoticeMessage/);
  assert.ok(messageBlock, "uiMessage value formatter block should exist");
  assert.match(appSource, /type UiMessageValue = string \| number \| \{ text: string \| number; localize: true \};/);
  assert.match(messageBlock[0], /typeof text === "string" \? uiText\(text\) : text/);
  assert.match(messageBlock[0], /return \[name, value\];/);
  assert.doesNotMatch(messageBlock[0], /typeof value === "string" \? uiText\(value\) : value/);
  assert.match(appSource, /setNoticeMessage\("ok", "notice\.backupCreated", \{ name: basename\(value\.zipPath\), bytes: formatBytes\(value\.bytes\) \}/);
  assert.match(appSource, /confirmDialogMessage\("dialog\.deletePerson", \{ person: personName \}/);
  assert.match(appSource, /skipped: localizeUiMessageValue\(skipped\)/);
  assert.match(statusRowSource, /type UiMessageValue = string \| number \| \{ text: string \| number; localize: true \};/);
  assert.match(statusRowSource, /uiMessage: \(key: UiMessageKey, values\?: Record<string, UiMessageValue>\) => string;/);
});

run("App DOM localization skips English and batches mutation roots", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const effectBlock = appSource.match(/useEffect\(\(\) => \{\s*if \(language === "en"\) return;[\s\S]*?observer\.observe\(root, \{[\s\S]*?\}\);\s*return \(\) => \{[\s\S]*?\};\s*\}, \[language\]\);/);
  assert.ok(effectBlock, "DOM localization effect should exist");
  assert.match(effectBlock[0], /if \(language === "en"\) return;/);
  assert.match(effectBlock[0], /for \(let ancestor: Node \| null = targetNode; ancestor; ancestor = ancestor\.parentNode\)/);
  assert.match(effectBlock[0], /pendingRoots\.has\(ancestor as ParentNode\)/);
  assert.match(effectBlock[0], /enqueueLocalizationRoot\(mutation\.target\);/);
  assert.doesNotMatch(effectBlock[0], /mutation\.addedNodes\.forEach\(enqueueLocalizationRoot\)/);
});

run("App Safe Mode profile thresholds use backend config as authority", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(appSource, /const DEFAULT_SAFE_MODE_PROFILE_THRESHOLDS: Record<string, number>/);
  assert.match(appSource, /const safeModeProfileThresholds = \{/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.privacy/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.balanced/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.permissive/);
  assert.match(appSource, /safeModeThreshold: safeModeProfileThresholds\[profile as keyof typeof safeModeProfileThresholds\]/);
  assert.doesNotMatch(appSource, /SAFE_MODE_PROFILE_THRESHOLDS\[profile\]/);
});

run("App ignore issue paths only changes visible draft after save succeeds", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const block = appSource.match(/async function ignoreIssuePaths\(paths: string\[\]\) \{[\s\S]*?\n  \}\n\n  function copySettingsProfile/);
  assert.ok(block, "ignoreIssuePaths should exist");
  assert.match(block[0], /const nextSettings: SettingsDraft = \{/);
  assert.match(block[0], /settingsDirtyRef\.current = false;[\s\S]*await invoke<AppState>\("Saving ignored files", "save_settings", settingsPayload\(nextSettings\)\);/);
  assert.match(block[0], /catch \{\s*settingsDirtyRef\.current = wasDirty;\s*\}/);
  assert.doesNotMatch(block[0], /setSettings\(nextSettings\)/);
});

run("Photos safety explainer unavailable status shows backend reason", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /!explainResult\.available\s*\?\s*\(explainResult\.reason \? uiText\(explainResult\.reason\) : uiText\("No explainer model installed\. Add one in Settings/);
  assert.doesNotMatch(source, /!explainResult\.available\s*\?\s*uiText\("No explainer model installed\. Add one in Settings/);
});

run("Safe Mode review dashboard honors sensitive collection unlock before listing flagged photos", () => {
  const reviewSource = fs.readFileSync(path.join(ROOT, "src/views/SafeModeReview.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const i18nSource = fs.readFileSync(path.join(ROOT, "src/i18n.ts"), "utf8");
  const settingsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSettings.ts"), "utf8");
  const photosSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(settingsSource, /export const PHOTO_LOCAL_SETTINGS_KEY = "vintrace\.photos\.localSettings"/);
  assert.match(photosSource, /PHOTO_LOCAL_SETTINGS_KEY/);
  assert.match(reviewSource, /invoke<\{ value\?: PhotoLibrarySettingsValue \}>\("photo_library_settings", \{\}\)/);
  assert.match(reviewSource, /if \(settings\.lockSensitiveCollections && !unlocked\) return;/);
  assert.match(reviewSource, /const SAFE_REVIEW_PAGE_SIZE = 60;/);
  assert.match(reviewSource, /previewBudget: 24/);
  assert.doesNotMatch(reviewSource, /limit: 500/);
  assert.match(reviewSource, /loading="lazy" decoding="async"/);
  assert.match(reviewSource, /sensitiveUnlockRequirements\(settings/);
  assert.match(reviewSource, /verifyPhotoSensitivePasscode\(settings, unlockPasscode\)/);
  assert.match(reviewSource, /authenticateSensitiveAccess\(uiText\("Unlock Safe Mode review in Vintrace\."\)\)/);
  assert.match(reviewSource, /uiText\?: \(source: string\) => string/);
  assert.match(reviewSource, /uiText\("Review flagged photos"\)/);
  assert.match(reviewSource, /uiText\("Not sensitive"\)/);
  assert.match(reviewSource, /uiText\("Keep hidden"\)/);
  assert.match(appSource, /getSensitiveAuthStatus=\{getPhotosSensitiveAuthStatus\}/);
  assert.match(appSource, /authenticateSensitiveAccess=\{authenticatePhotosSensitiveAccess\}/);
  assert.match(appSource, /<SettingsView[\s\S]*uiText=\{uiText\}[\s\S]*consentOnFile=/);
  assert.match(appSource, /<SafeModeReview[\s\S]*uiText=\{props\.uiText\}/);
  assert.match(appSource, /props\.uiText\("Safe Mode profile"\)/);
  assert.match(appSource, /props\.uiText\("Calibrate to your library"\)/);
  assert.match(appSource, /props\.uiText\("Review flagged photos"\)/);
  assert.match(i18nSource, /const safeModeReviewLiteralTranslations/);
  assert.ok((i18nSource.match(/"Review flagged photos":/g) || []).length >= 6);
  assert.ok((i18nSource.match(/"Not sensitive":/g) || []).length >= 6);
  assert.ok((i18nSource.match(/"Keep hidden":/g) || []).length >= 6);
  assert.ok((i18nSource.match(/"Safe Mode profile":/g) || []).length >= 6);
  assert.ok((i18nSource.match(/"Calibrate to your library":/g) || []).length >= 6);
});

run("Photos route is lazy-loaded out of the initial renderer chunk", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(appSource, /const PhotosView = lazy\(\(\) => import\("\.\/views\/PhotosView"\)/);
  assert.doesNotMatch(appSource, /import \{ PhotosView \} from "\.\/views\/PhotosView"/);
  assert.match(appSource, /<Suspense fallback=\{<PhotosRouteFallback uiText=\{uiText\} \/>\}>/);
});

run("photo virtual grid windows visible bands with overscan", () => {
  const layout = virtualGridMod.buildPhotoVirtualGridLayout(
    Array.from({ length: 12 }, (_, index) => ({ kind: "item", key: `i:${index}`, index, item: { width: 100, height: 100 } })),
    { containerWidth: 210, minTileSize: 100, aspectMode: "square", gap: 10 }
  );
  assert.strictEqual(layout.columns, 2);
  const firstWindow = virtualGridMod.windowPhotoVirtualGridLayout(layout, { scrollTop: 0, viewportHeight: 120, overscan: 0 });
  assert.strictEqual(firstWindow.visibleBands.length, 2);
  const laterWindow = virtualGridMod.windowPhotoVirtualGridLayout(layout, { scrollTop: 330, viewportHeight: 120, overscan: 0 });
  assert.deepStrictEqual(laterWindow.visibleBands.map((band) => band.rows[0].index), [6, 8]);
});

run("photo virtual grid windowing stays bounded for 100k local photos", () => {
  const photoCount = 100000;
  const rows = Array.from({ length: photoCount }, (_, index) => ({
    kind: "item",
    key: `scale:${index}`,
    index,
    item: {
      width: 800 + (index % 5) * 120,
      height: 600 + (index % 7) * 80,
    },
  }));
  const layout = virtualGridMod.buildPhotoVirtualGridLayout(rows, {
    containerWidth: 1280,
    minTileSize: 160,
    aspectMode: "aspect",
    gap: 8,
  });
  const scrollSamples = Array.from({ length: 240 }, (_, index) => (
    (layout.totalHeight * index) / 239
  ));
  const started = performance.now();
  const windows = scrollSamples.map((scrollTop) => (
    virtualGridMod.windowPhotoVirtualGridLayout(layout, {
      scrollTop,
      viewportHeight: 900,
      overscan: 720,
    })
  ));
  const elapsed = performance.now() - started;
  const budgetMs = testBudgetMs("photo_virtual_grid_window_budget", 120);
  const maxVisibleBands = Math.max(...windows.map((window) => window.visibleBands.length));

  assert(layout.bands.length > 10000, layout.bands.length);
  assert(windows[0].visibleBands[0].rows[0].index === 0, windows[0].visibleBands[0]);
  assert(windows.at(-1).visibleBands.some((band) => (
    band.kind === "items" && band.rows.some((row) => row.index >= photoCount - layout.columns)
  )), windows.at(-1).visibleBands);
  assert(maxVisibleBands <= 24, { maxVisibleBands, columns: layout.columns });
  assert(elapsed <= budgetMs, { elapsed, budgetMs, photoCount, bands: layout.bands.length, maxVisibleBands });
});

run("photo location picker projects coordinates to stable world percentages", () => {
  assert.deepStrictEqual(locationPickerMod.photoLocationPickerPoint(0, 0), {
    latitude: 0,
    longitude: 0,
    x: 50,
    y: 50,
  });
  assert.deepStrictEqual(locationPickerMod.photoLocationPickerPoint("90", "-180"), {
    latitude: 90,
    longitude: -180,
    x: 0,
    y: 0,
  });
  assert.strictEqual(locationPickerMod.photoLocationPickerPoint("x", 0), null);
});

run("photo location picker converts pointer positions to coordinates", () => {
  const point = locationPickerMod.photoLocationFromClientPoint(250, 150, { left: 50, top: 50, width: 400, height: 200 });
  assert.deepStrictEqual(point, {
    latitude: 0,
    longitude: 0,
    x: 50,
    y: 50,
  });
  assert.deepStrictEqual(locationPickerMod.photoLocationFromPickerPercent(100, 100), {
    latitude: -90,
    longitude: 180,
    x: 100,
    y: 100,
  });
  assert.strictEqual(locationPickerMod.formatPhotoLocationCoordinate(12.1234567), "12.123457");
});

run("photo places map projects valid place folders", () => {
  const points = placesMapMod.buildPhotoPlaceMapPoints([
    { id: "place:sf", kind: "place", name: "San Francisco", count: 4, coverPreviewPath: "/previews/sf.jpg", coverPreviewUrl: "preview://sf", place: { label: "San Francisco", latitude: "37.7749", longitude: "-122.4194", source: "user" } },
    { id: "place:ny", kind: "place", name: "New York", count: 2, place: { label: "New York", latitude: 40.7128, longitude: -74.0060, source: "exif" } },
    { id: "place:bad", kind: "place", name: "Bad", count: 9, place: { label: "Bad", latitude: "x", longitude: "1" } },
    { id: "album:skip", kind: "album", name: "Skip", count: 1, place: { label: "Skip", latitude: 1, longitude: 2 } },
  ]);
  assert.deepStrictEqual(points.map((point) => point.folderId), ["place:sf", "place:ny"]);
  assert.strictEqual(points[0].coverPreviewPath, "/previews/sf.jpg");
  assert.strictEqual(points[0].coverPreviewUrl, "preview://sf");
  assert.strictEqual(points[1].coverPreviewUrl, "");
  assert(points.every((point) => point.x >= 8 && point.x <= 92), points);
  assert(points.every((point) => point.y >= 8 && point.y <= 92), points);
});

run("nearbyPhotoPlaces sorts by distance from active place", () => {
  const points = placesMapMod.buildPhotoPlaceMapPoints([
    { id: "place:sf", kind: "place", name: "San Francisco", count: 4, place: { label: "San Francisco", latitude: "37.7749", longitude: "-122.4194" } },
    { id: "place:oak", kind: "place", name: "Oakland", count: 2, place: { label: "Oakland", latitude: "37.8044", longitude: "-122.2712" } },
    { id: "place:la", kind: "place", name: "Los Angeles", count: 8, place: { label: "Los Angeles", latitude: "34.0522", longitude: "-118.2437" } },
  ]);
  const nearby = placesMapMod.nearbyPhotoPlaces(points, "place:sf", 2);
  assert.deepStrictEqual(nearby.map((point) => point.folderId), ["place:oak", "place:la"]);
  assert(nearby[0].distanceKm < nearby[1].distanceKm, nearby);
});

run("photo places map radius overlay projects nearby filter and counts places", () => {
  const points = placesMapMod.buildPhotoPlaceMapPoints([
    { id: "place:sf", kind: "place", name: "San Francisco", count: 4, place: { label: "San Francisco", latitude: "37.7749", longitude: "-122.4194" } },
    { id: "place:oak", kind: "place", name: "Oakland", count: 2, place: { label: "Oakland", latitude: "37.8044", longitude: "-122.2712" } },
    { id: "place:la", kind: "place", name: "Los Angeles", count: 8, place: { label: "Los Angeles", latitude: "34.0522", longitude: "-118.2437" } },
  ]);
  const overlay = placesMapMod.buildPhotoPlaceMapRadiusOverlay(points, {
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 20,
  });
  assert(overlay, overlay);
  assert(overlay.x >= 12 && overlay.x <= 88, overlay);
  assert(overlay.y >= 12 && overlay.y <= 88, overlay);
  assert(overlay.radiusX >= 7 && overlay.radiusY >= 7, overlay);
  assert.strictEqual(overlay.matchedPlaceCount, 2);
  assert.strictEqual(overlay.matchedPhotoCount, 6);
  assert.strictEqual(placesMapMod.buildPhotoPlaceMapRadiusOverlay(points, { latitude: 0, longitude: 0, radiusKm: 0 }), null);
});

run("photo places map radius results sort by distance and obey radius", () => {
  const points = placesMapMod.buildPhotoPlaceMapPoints([
    { id: "place:sf", kind: "place", name: "San Francisco", count: 4, place: { label: "San Francisco", latitude: "37.7749", longitude: "-122.4194" } },
    { id: "place:oak", kind: "place", name: "Oakland", count: 2, place: { label: "Oakland", latitude: "37.8044", longitude: "-122.2712" } },
    { id: "place:berkeley", kind: "place", name: "Berkeley", count: 7, place: { label: "Berkeley", latitude: "37.8715", longitude: "-122.2730" } },
    { id: "place:la", kind: "place", name: "Los Angeles", count: 8, place: { label: "Los Angeles", latitude: "34.0522", longitude: "-118.2437" } },
  ]);
  const matches = placesMapMod.nearbyPhotoPlacesWithinRadius(points, {
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 25,
  });
  assert.deepStrictEqual(matches.map((point) => point.folderId), ["place:sf", "place:oak", "place:berkeley"]);
  assert(matches.every((point) => point.distanceKm <= 25), matches);
  assert.strictEqual(matches.reduce((total, point) => total + point.count, 0), 13);
  const limited = placesMapMod.nearbyPhotoPlacesWithinRadius(points, {
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 25,
  }, 2);
  assert.deepStrictEqual(limited.map((point) => point.folderId), ["place:sf", "place:oak"]);
  assert.deepStrictEqual(placesMapMod.nearbyPhotoPlacesWithinRadius(points, { latitude: 0, longitude: 0, radiusKm: 0 }), []);
});

run("photo places map clusters nearby projected pins", () => {
  const point = (folderId, name, count, x, y, coverPreviewUrl = "") => ({
    folderId,
    name,
    count,
    latitude: y,
    longitude: x,
    x,
    y,
    source: "user",
    coverPreviewPath: coverPreviewUrl ? `/previews/${folderId}.jpg` : null,
    coverPreviewUrl,
  });
  const points = [
    point("place:a", "A", 4, 10, 10),
    point("place:b", "B", 2, 12, 12, "preview://b"),
    point("place:c", "C", 8, 80, 80),
  ];
  const clusters = placesMapMod.buildPhotoPlaceMapClusters(points, "", 5);
  assert.strictEqual(clusters.length, 2);
  const clustered = clusters.find((cluster) => cluster.placeCount === 2);
  assert(clustered, clusters);
  assert.deepStrictEqual(clustered.points.map((clusterPoint) => clusterPoint.folderId), ["place:a", "place:b"]);
  assert.strictEqual(clustered.photoCount, 6);
  assert.strictEqual(clustered.coverPreviewUrl, "preview://b");

  const activeClusters = placesMapMod.buildPhotoPlaceMapClusters(points, "place:b", 5);
  assert(activeClusters.some((cluster) => cluster.placeCount === 1 && cluster.representative.folderId === "place:b"), activeClusters);
  assert.strictEqual(activeClusters.length, 3);
});

run("photo places map density cells aggregate weighted areas", () => {
  const point = (folderId, name, count, x, y, coverPreviewUrl = "") => ({
    folderId,
    name,
    count,
    latitude: y,
    longitude: x,
    x,
    y,
    source: "user",
    coverPreviewPath: coverPreviewUrl ? `/previews/${folderId}.jpg` : null,
    coverPreviewUrl,
  });
  const cells = placesMapMod.buildPhotoPlaceMapDensityCells([
    point("place:a", "A", 4, 10, 10),
    point("place:b", "B", 7, 12, 11, "preview://b"),
    point("place:c", "C", 2, 76, 76),
  ], 4);
  assert.strictEqual(cells.length, 2);
  const dense = cells.find((cell) => cell.placeCount === 2);
  assert(dense, cells);
  assert.strictEqual(dense.photoCount, 11);
  assert.strictEqual(dense.representative.folderId, "place:b");
  assert.strictEqual(dense.coverPreviewUrl, "preview://b");
  assert.strictEqual(dense.intensity, 1);
  const sparse = cells.find((cell) => cell.placeCount === 1);
  assert(sparse, cells);
  assert(dense.radius > sparse.radius, cells);
  assert(dense.x > 10 && dense.x < 12.1, dense);
});

run("photo places map helpers stay bounded for large local place sets", () => {
  const placeCount = 5000;
  const folders = Array.from({ length: placeCount }, (_, index) => {
    const row = Math.floor(index / 100);
    const column = index % 100;
    return {
      id: `place:scale-${index}`,
      kind: "place",
      name: `Scale Place ${index}`,
      count: (index % 9) + 1,
      place: {
        label: `Scale Place ${index}`,
        latitude: 24 + row * 0.08,
        longitude: -125 + column * 0.08,
        source: "user",
      },
    };
  });
  const started = performance.now();
  const points = placesMapMod.buildPhotoPlaceMapPoints(folders);
  const pins = placesMapMod.buildPhotoPlaceMapClusters(points, "", 0);
  const density = placesMapMod.buildPhotoPlaceMapDensityCells(points, 10);
  const overlay = placesMapMod.buildPhotoPlaceMapRadiusOverlay(points, { latitude: 26, longitude: -121, radiusKm: 80 });
  const nearby = placesMapMod.nearbyPhotoPlaces(points, points[0].folderId, 8);
  const elapsed = performance.now() - started;
  const budgetMs = testBudgetMs("places_map_helper_budget", 750);

  assert.strictEqual(points.length, placeCount);
  assert.strictEqual(pins.length, placeCount);
  assert(density.length <= 100, density.length);
  assert(overlay && overlay.matchedPlaceCount > 0, overlay);
  assert.strictEqual(nearby.length, 8);
  assert(elapsed <= budgetMs, { elapsed, budgetMs, placeCount, densityCells: density.length });
});

console.log("all photos_view tests passed");

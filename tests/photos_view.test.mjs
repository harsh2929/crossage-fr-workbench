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
const burstStacksOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-burst-stacks-")), "photoBurstStacks.mjs");
const coverCropOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-cover-crops-")), "photoCoverCrops.mjs");
const membershipOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-membership-")), "photoAlbumMemberships.mjs");
const exportPresetsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-export-presets-")), "photoExportPresets.mjs");
const importAccessOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-access-")), "photoImportAccess.mjs");
const importAlbumTargetOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-album-target-")), "photoImportAlbumTarget.mjs");
const importSessionDetailsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-import-session-details-")), "photoImportSessionDetails.mjs");
const editorOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-editor-")), "photoAlbumEditorState.mjs");
const imageEditsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-image-edits-")), "photoImageEdits.mjs");
const imageEditDisplayOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-image-edit-display-")), "photoImageEditDisplay.mjs");
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
const selectionExportResultsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-selection-export-results-")), "photoSelectionExportResults.mjs");
const durationOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-duration-")), "photoDuration.mjs");
const duplicateReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-duplicate-review-")), "photoDuplicateReview.mjs");
const groupReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-group-review-")), "photoGroupReview.mjs");
const inlineReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-inline-review-")), "photoInlineReviewDecisions.mjs");
const peopleMatchSelectionOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-people-match-selection-")), "photoPeopleMatchSelection.mjs");
const selectionStateOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-selection-state-")), "photoSelectionState.mjs");
const reviewFocusHistoryOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-review-focus-history-")), "reviewFocusHistory.mjs");
const repairCenterOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-repair-center-")), "photoRepairCenter.mjs");
const consolidationResultOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-consolidation-result-")), "photoConsolidationResult.mjs");
const contextMenuOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-context-menu-")), "photoContextMenu.mjs");
const gridConfigOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-grid-config-")), "photoGridConfig.mjs");
const virtualGridOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-virtual-grid-")), "photoVirtualGrid.mjs");
const locationPickerOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-location-picker-")), "photoLocationPicker.mjs");
const nearbyFiltersOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-nearby-filters-")), "photoNearbyFilters.mjs");
const placesMapOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-places-map-")), "photoPlacesMap.mjs");
const qrActionsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-qr-actions-")), "photoQrActions.mjs");
const infoMetadataOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-info-metadata-")), "photoInfoMetadata.mjs");
const infoDraftOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-info-draft-")), "photoInfoDraft.mjs");
const scrollContainerOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-scroll-container-")), "photoScrollContainer.mjs");
const displayTextOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-display-text-")), "photoDisplayText.mjs");
const errorMessageOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-error-message-")), "photoErrorMessage.mjs");
const mediaPairsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-media-pairs-")), "photoMediaPairs.mjs");
const mediaKindOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-media-kind-")), "photoMediaKind.mjs");
const operationDetailsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-operation-details-")), "photoOperationDetails.mjs");
const indexingStatusOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-indexing-status-")), "photoIndexingStatus.mjs");
const settingsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-settings-")), "photoSettings.mjs");
const liveTextActionsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-live-text-actions-")), "photoLiveTextActions.mjs");
const objectTagsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-object-tags-")), "photoObjectTags.mjs");
const utilityReviewOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-utility-review-")), "photoUtilityClassifierReview.mjs");
const searchHighlightsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-search-highlights-")), "photoSearchHighlights.mjs");
const curationOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-curation-")), "photoCurationPreferences.mjs");
const slideshowOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-slideshow-")), "photoSlideshow.mjs");
const slideshowProjectsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-slideshow-projects-")), "photoSlideshowProjects.mjs");
const slideshowDisplayOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-slideshow-display-")), "photoSlideshowDisplay.mjs");
const lightboxVideoControlsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-lightbox-video-controls-")), "photoLightboxVideoControls.mjs");
const lightboxSessionOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-lightbox-session-")), "photoLightboxSession.mjs");
const viewStorageOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photos-view-storage-")), "photoViewStorage.mjs");
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
  entryPoints: [path.join(ROOT, "src/views/photoBurstStacks.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: burstStacksOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoImageEditDisplay.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: imageEditDisplayOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoSelectionExportResults.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: selectionExportResultsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDuration.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: durationOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoInlineReviewDecisions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: inlineReviewOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoPeopleMatchSelection.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: peopleMatchSelectionOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSelectionState.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: selectionStateOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoContextMenu.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: contextMenuOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoGridConfig.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: gridConfigOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoNearbyFilters.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: nearbyFiltersOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoInfoDraft.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: infoDraftOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoScrollContainer.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: scrollContainerOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoDisplayText.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: displayTextOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoErrorMessage.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: errorMessageOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoMediaPairs.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: mediaPairsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoMediaKind.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: mediaKindOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoOperationDetails.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: operationDetailsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoIndexingStatus.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: indexingStatusOutFile,
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
  entryPoints: [path.join(ROOT, "src/views/photoObjectTags.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: objectTagsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoUtilityClassifierReview.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: utilityReviewOutFile,
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
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSlideshowDisplay.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: slideshowDisplayOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoLightboxVideoControls.tsx")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: lightboxVideoControlsOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoLightboxSession.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: lightboxSessionOutFile,
});
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoViewStorage.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: viewStorageOutFile,
});
const mod = await import(pathToFileURL(outFile).href);
const orderMod = await import(pathToFileURL(orderOutFile).href);
const burstStacksMod = await import(pathToFileURL(burstStacksOutFile).href);
const coverCropMod = await import(pathToFileURL(coverCropOutFile).href);
const membershipMod = await import(pathToFileURL(membershipOutFile).href);
const exportPresetsMod = await import(pathToFileURL(exportPresetsOutFile).href);
const importAccessMod = await import(pathToFileURL(importAccessOutFile).href);
const importAlbumTargetMod = await import(pathToFileURL(importAlbumTargetOutFile).href);
const importSessionDetailsMod = await import(pathToFileURL(importSessionDetailsOutFile).href);
const editorMod = await import(pathToFileURL(editorOutFile).href);
const imageEditsMod = await import(pathToFileURL(imageEditsOutFile).href);
const imageEditDisplayMod = await import(pathToFileURL(imageEditDisplayOutFile).href);
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
const selectionExportResultsMod = await import(pathToFileURL(selectionExportResultsOutFile).href);
const durationMod = await import(pathToFileURL(durationOutFile).href);
const duplicateReviewMod = await import(pathToFileURL(duplicateReviewOutFile).href);
const groupReviewMod = await import(pathToFileURL(groupReviewOutFile).href);
const inlineReviewMod = await import(pathToFileURL(inlineReviewOutFile).href);
const peopleMatchSelectionMod = await import(pathToFileURL(peopleMatchSelectionOutFile).href);
const selectionStateMod = await import(pathToFileURL(selectionStateOutFile).href);
const reviewFocusHistoryMod = await import(pathToFileURL(reviewFocusHistoryOutFile).href);
const repairCenterMod = await import(pathToFileURL(repairCenterOutFile).href);
const consolidationResultMod = await import(pathToFileURL(consolidationResultOutFile).href);
const contextMenuMod = await import(pathToFileURL(contextMenuOutFile).href);
const gridConfigMod = await import(pathToFileURL(gridConfigOutFile).href);
const virtualGridMod = await import(pathToFileURL(virtualGridOutFile).href);
const locationPickerMod = await import(pathToFileURL(locationPickerOutFile).href);
const nearbyFiltersMod = await import(pathToFileURL(nearbyFiltersOutFile).href);
const placesMapMod = await import(pathToFileURL(placesMapOutFile).href);
const qrActionsMod = await import(pathToFileURL(qrActionsOutFile).href);
const infoMetadataMod = await import(pathToFileURL(infoMetadataOutFile).href);
const infoDraftMod = await import(pathToFileURL(infoDraftOutFile).href);
const scrollContainerMod = await import(pathToFileURL(scrollContainerOutFile).href);
const displayTextMod = await import(pathToFileURL(displayTextOutFile).href);
const errorMessageMod = await import(pathToFileURL(errorMessageOutFile).href);
const mediaPairsMod = await import(pathToFileURL(mediaPairsOutFile).href);
const mediaKindMod = await import(pathToFileURL(mediaKindOutFile).href);
const operationDetailsMod = await import(pathToFileURL(operationDetailsOutFile).href);
const indexingStatusMod = await import(pathToFileURL(indexingStatusOutFile).href);
const settingsMod = await import(pathToFileURL(settingsOutFile).href);
const liveTextActionsMod = await import(pathToFileURL(liveTextActionsOutFile).href);
const objectTagsMod = await import(pathToFileURL(objectTagsOutFile).href);
const utilityReviewMod = await import(pathToFileURL(utilityReviewOutFile).href);
const searchHighlightsMod = await import(pathToFileURL(searchHighlightsOutFile).href);
const curationMod = await import(pathToFileURL(curationOutFile).href);
const slideshowMod = await import(pathToFileURL(slideshowOutFile).href);
const slideshowProjectsMod = await import(pathToFileURL(slideshowProjectsOutFile).href);
const slideshowDisplayMod = await import(pathToFileURL(slideshowDisplayOutFile).href);
const lightboxVideoControlsMod = await import(pathToFileURL(lightboxVideoControlsOutFile).href);
const lightboxSessionMod = await import(pathToFileURL(lightboxSessionOutFile).href);
const viewStorageMod = await import(pathToFileURL(viewStorageOutFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

function assertDeferredPhotoSurface(source, componentName, groupName, moduleName) {
  const deferredSource = fs.readFileSync(path.join(ROOT, "src/views/photoDeferredSurfaces.tsx"), "utf8");
  const groupSource = fs.readFileSync(path.join(ROOT, `src/views/photoDeferred${groupName}Surfaces.ts`), "utf8");
  assert.match(source, /from "\.\/photoDeferredSurfaces"/);
  assert.match(source, new RegExp(`\\b${componentName}\\b`));
  assert.doesNotMatch(source, new RegExp(`from "\\./${moduleName}"`));
  assert.match(deferredSource, new RegExp(`export const ${componentName} = deferredPhotoComponent`));
  assert.match(deferredSource, new RegExp(`load${groupName}Surfaces\\(\\)`));
  assert.match(groupSource, new RegExp(`export \\{ ${componentName} \\} from "\\./${moduleName}"`));
}

async function runAsync(name, fn) {
  await fn();
  console.log("ok " + name);
}

function assertClose(actual, expected, tolerance, label) {
  assert.strictEqual(typeof actual, "number", `${label} should be a number`);
  assert.ok(Number.isFinite(actual), `${label} should be finite`);
  assert.ok(Math.abs(actual - expected) <= tolerance, { label, actual, expected, tolerance });
}

run("photo lightbox session helpers clamp and persist transient state", () => {
  assert.strictEqual(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, "vintrace.photos.session.lightboxZoom");
  assert.strictEqual(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "vintrace.photos.session.lightboxFitMode");
  assert.strictEqual(lightboxSessionMod.clampLightboxZoom(0.4), 1);
  assert.strictEqual(lightboxSessionMod.clampLightboxZoom(2.349), 2.35);
  assert.strictEqual(lightboxSessionMod.clampLightboxZoom(6), 4);
  const gesturePointMap = new Map([
    [1, { x: 0, y: 0 }],
    [2, { x: 3, y: 4 }],
  ]);
  const gesturePoints = lightboxSessionMod.lightboxGesturePoints(gesturePointMap.values());
  assert.deepStrictEqual(gesturePoints, [{ x: 0, y: 0 }, { x: 3, y: 4 }]);
  assert.strictEqual(lightboxSessionMod.lightboxGestureDistance(gesturePoints), 5);
  assert.deepStrictEqual(lightboxSessionMod.lightboxGestureCenter(gesturePoints), { x: 1.5, y: 2 });
  assert.strictEqual(lightboxSessionMod.lightboxGestureDistance([{ x: 1, y: 1 }]), 0);
  assert.deepStrictEqual(lightboxSessionMod.lightboxGestureCenter([{ x: 1, y: 1 }]), { x: 0, y: 0 });

  const pinch = lightboxSessionMod.lightboxPinchState(gesturePoints, 1.5, { x: 10, y: 20 });
  assert.deepStrictEqual(pinch, {
    startDistance: 5,
    startZoom: 1.5,
    startCenterX: 1.5,
    startCenterY: 2,
    originX: 10,
    originY: 20,
  });
  assert.strictEqual(lightboxSessionMod.lightboxPinchState([{ x: 0, y: 0 }], 2, { x: 0, y: 0 }), null);
  assert.deepStrictEqual(lightboxSessionMod.lightboxPinchTransform(pinch, [{ x: 2, y: 2 }, { x: 8, y: 10 }]), {
    zoom: 3,
    pan: { x: 13.5, y: 24 },
  });
  assert.deepStrictEqual(lightboxSessionMod.lightboxPinchTransform(pinch, [{ x: 2, y: 2 }, { x: 3, y: 2 }]), {
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  assert.strictEqual(lightboxSessionMod.lightboxPinchTransform(pinch, [{ x: 1, y: 1 }]), null);
  assert.deepStrictEqual(
    lightboxSessionMod.lightboxDragPan({ pointerId: 7, startX: 10, startY: 12, originX: 4, originY: -3 }, { x: 15, y: 2 }),
    { x: 9, y: -13 },
  );
  assert.deepStrictEqual(lightboxSessionMod.lightboxImageSamplePointFromClient({
    clientX: 200,
    clientY: 150,
    stageRect: { left: 0, top: 0, width: 400, height: 300 },
    mediaSize: { width: 200, height: 100 },
    pan: { x: 0, y: 0 },
    zoom: 1,
    fitMode: "fit",
  }), { x: 100, y: 50 });
  assert.strictEqual(lightboxSessionMod.lightboxImageSamplePointFromClient({
    clientX: 200,
    clientY: 20,
    stageRect: { left: 0, top: 0, width: 400, height: 300 },
    mediaSize: { width: 200, height: 100 },
    pan: { x: 0, y: 0 },
    zoom: 1,
    fitMode: "fit",
  }), null);
  assert.deepStrictEqual(lightboxSessionMod.lightboxImageSamplePointFromClient({
    clientX: 0,
    clientY: 150,
    stageRect: { left: 0, top: 0, width: 400, height: 300 },
    mediaSize: { width: 200, height: 100 },
    pan: { x: 0, y: 0 },
    zoom: 1,
    fitMode: "fill",
  }), { x: 33, y: 50 });
  assert.deepStrictEqual(lightboxSessionMod.lightboxImageSamplePointFromClient({
    clientX: 200,
    clientY: 150,
    stageRect: { left: 0, top: 0, width: 400, height: 300 },
    mediaSize: { width: 200, height: 100 },
    pan: { x: 20, y: -10 },
    zoom: 2,
    fitMode: "fit",
  }), { x: 95, y: 52 });
  assert.strictEqual(lightboxSessionMod.lightboxImageSamplePointFromClient({
    clientX: 200,
    clientY: 150,
    stageRect: { left: 0, top: 0, width: 0, height: 300 },
    mediaSize: { width: 200, height: 100 },
    pan: { x: 0, y: 0 },
    zoom: 1,
    fitMode: "fit",
  }), null);

  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    sessionStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    assert.strictEqual(lightboxSessionMod.readSessionNumber(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, 1.25), 1.25);
    lightboxSessionMod.storeSessionNumber(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, 4.8);
    assert.strictEqual(values.get(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY), "4");
    assert.strictEqual(lightboxSessionMod.readSessionNumber(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, 1), 4);

    lightboxSessionMod.storeSessionString(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "fill");
    assert.strictEqual(lightboxSessionMod.readSessionLightboxFitMode(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "fit"), "fill");
    values.set(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "stretch");
    assert.strictEqual(lightboxSessionMod.readSessionLightboxFitMode(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "fit"), "fit");

    global.window.sessionStorage.getItem = () => {
      throw new Error("blocked");
    };
    global.window.sessionStorage.setItem = () => {
      throw new Error("blocked");
    };
    assert.strictEqual(lightboxSessionMod.readSessionNumber(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, 1.5), 1.5);
    assert.doesNotThrow(() => lightboxSessionMod.storeSessionNumber(lightboxSessionMod.PHOTO_LIGHTBOX_ZOOM_KEY, 2));
    assert.doesNotThrow(() => lightboxSessionMod.storeSessionString(lightboxSessionMod.PHOTO_LIGHTBOX_FIT_KEY, "fit"));
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

run("photo view storage helpers normalize local rail and preference values", () => {
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    assert.deepStrictEqual([...viewStorageMod.readStoredStringSet("missing")], []);
    values.set("set", JSON.stringify(["a", "", 4, "a"]));
    assert.deepStrictEqual([...viewStorageMod.readStoredStringSet("set")], ["a", "4"]);
    values.set("list", JSON.stringify(["a", "", 4]));
    assert.deepStrictEqual(viewStorageMod.readStoredStringList("list"), ["a", "4"]);
    values.set("string", "hello");
    assert.strictEqual(viewStorageMod.readStoredString("string"), "hello");

    values.set("bool", "false");
    assert.strictEqual(viewStorageMod.readStoredBoolean("bool", true), false);
    assert.strictEqual(viewStorageMod.readStoredBoolean("missing-bool", true), true);
    values.set("people-sort", "name");
    assert.strictEqual(viewStorageMod.readStoredPeopleSortMode("people-sort"), "name");
    values.set("people-sort", "other");
    assert.strictEqual(viewStorageMod.readStoredPeopleSortMode("people-sort"), "manual");

    const order = viewStorageMod.normalizePhotoRailItemOrderPreference({
      mediaTypes: ["video", "", 7],
      utilities: ["qr"],
      albums: ["ignored"],
      unknown: ["ignored"],
    });
    assert.deepStrictEqual(order, { mediaTypes: ["video", "7"], utilities: ["qr"] });
    viewStorageMod.storePhotoRailItemOrder("order", order);
    assert.deepStrictEqual(JSON.parse(values.get("order")), order);
    assert.deepStrictEqual(viewStorageMod.readStoredPhotoRailItemOrder("order"), order);

    viewStorageMod.storeStringSet("set-write", new Set(["x", "y"]));
    assert.deepStrictEqual(JSON.parse(values.get("set-write")), ["x", "y"]);
    viewStorageMod.storeStringList("list-write", ["x", "y"]);
    assert.deepStrictEqual(JSON.parse(values.get("list-write")), ["x", "y"]);
    viewStorageMod.storeString("string-write", "value");
    assert.strictEqual(values.get("string-write"), "value");
    viewStorageMod.storeBoolean("bool-write", true);
    assert.strictEqual(values.get("bool-write"), "true");

    values.set(viewStorageMod.PHOTO_RAIL_SHOW_UTILITIES_KEY, "false");
    values.set(viewStorageMod.PHOTO_RAIL_SHOW_SENSITIVE_KEY, "true");
    values.set(viewStorageMod.PINNED_PHOTO_RAIL_IDS_KEY, JSON.stringify(["favorites", "people"]));
    values.set(viewStorageMod.PHOTO_RAIL_SECTION_ORDER_KEY, JSON.stringify(["people", "albums"]));
    values.set(viewStorageMod.PHOTO_RAIL_ITEM_ORDER_KEY, JSON.stringify({ utilities: ["utility:qr"], albums: ["ignored"] }));
    const legacyRail = viewStorageMod.readLegacyPhotoRailPreferences();
    assert.strictEqual(legacyRail.showUtilityCollections, false);
    assert.strictEqual(legacyRail.showSensitiveCollections, true);
    assert.deepStrictEqual(legacyRail.pinnedIds, ["favorites", "people"]);
    assert.deepStrictEqual(legacyRail.sectionOrder, ["people", "albums"]);
    assert.deepStrictEqual(legacyRail.itemOrder, { utilities: ["utility:qr"] });

    const migratedSettings = viewStorageMod.normalizePhotoLocalSettingsWithLegacyRail({ lockSensitiveCollections: false });
    assert.strictEqual(migratedSettings.lockSensitiveCollections, false);
    assert.deepStrictEqual(migratedSettings.railPreferences.pinnedIds, ["favorites", "people"]);
    viewStorageMod.storeLegacyPhotoRailPreferences({
      ...migratedSettings.railPreferences,
      showUtilityCollections: true,
      pinnedIds: ["all"],
      collapsedSections: ["places"],
      sectionOrder: ["albums"],
      itemOrder: { mediaTypes: ["media:video"] },
    });
    assert.strictEqual(values.get(viewStorageMod.PHOTO_RAIL_SHOW_UTILITIES_KEY), "true");
    assert.deepStrictEqual(JSON.parse(values.get(viewStorageMod.PINNED_PHOTO_RAIL_IDS_KEY)), ["all"]);
    assert.deepStrictEqual(JSON.parse(values.get(viewStorageMod.COLLAPSED_PHOTO_RAIL_SECTIONS_KEY)), ["places"]);
    assert.deepStrictEqual(JSON.parse(values.get(viewStorageMod.PHOTO_RAIL_ITEM_ORDER_KEY)), { mediaTypes: ["media:video"] });

    viewStorageMod.storePhotoLocalSettings("local-settings", migratedSettings);
    assert.deepStrictEqual(
      viewStorageMod.readStoredPhotoLocalSettings("local-settings").railPreferences.pinnedIds,
      ["favorites", "people"]
    );

    const exportDestinations = viewStorageMod.normalizePhotoExportDestinations([
      " /exports/A ",
      "",
      "/exports/B",
      "/exports/A",
      ...Array.from({ length: 20 }, (_, index) => `/exports/${index}`),
    ]);
    assert.strictEqual(exportDestinations.length, 12);
    assert.deepStrictEqual(exportDestinations.slice(0, 3), ["/exports/A", "/exports/B", "/exports/0"]);
    viewStorageMod.storePhotoExportDestinations(viewStorageMod.PHOTO_EXPORT_DESTINATIONS_KEY, exportDestinations);
    assert.deepStrictEqual(
      viewStorageMod.readStoredPhotoExportDestinations(viewStorageMod.PHOTO_EXPORT_DESTINATIONS_KEY),
      exportDestinations
    );

    values.set("bad-json", "{");
    assert.deepStrictEqual(viewStorageMod.readStoredStringList("bad-json"), []);
    assert.deepStrictEqual(viewStorageMod.readStoredPhotoRailItemOrder("bad-json"), {});
    assert.deepStrictEqual(viewStorageMod.readStoredPhotoExportDestinations("bad-json"), []);
    global.window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    global.window.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    assert.strictEqual(viewStorageMod.readStoredString("blocked"), "");
    assert.doesNotThrow(() => viewStorageMod.storeString("blocked", "x"));
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

function testBudgetMs(name, fallbackMs) {
  const parsed = Number(process.env[`VINTRACE_TEST_${name.toUpperCase()}_MS`]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs;
}

run("photo burst stacks normalize explicit and fallback frame lists", () => {
  assert.deepStrictEqual(burstStacksMod.normalizePhotoBurstStackItem({
    assetId: 42,
    sourcePath: " /photos/a.jpg ",
    mediaKind: "burst",
    title: "Frame A",
    captureDate: "2026-07-08T00:00:00Z",
    sequence: "4",
    keeper: true,
    selectionRole: "keeper",
    selectedAt: "2026-07-08T00:01:00Z",
    coverHint: true,
  }), {
    assetId: "42",
    sourcePath: "/photos/a.jpg",
    mediaKind: "burst",
    title: "Frame A",
    captureDate: "2026-07-08T00:00:00Z",
    sequence: 4,
    keeper: true,
    selectionRole: "keeper",
    selectedAt: "2026-07-08T00:01:00Z",
    coverHint: true,
  });
  assert.strictEqual(burstStacksMod.normalizePhotoBurstStackItem({ sourcePath: "" }), null);

  const fallbackStack = burstStacksMod.normalizePhotoBurstStack({
    stackId: "burst-1",
    name: "",
    sourcePaths: [" /photos/a.jpg ", "", "/photos/b.jpg"],
    coverSourcePath: "/photos/b.jpg",
    count: "bad",
  });
  assert.deepStrictEqual(fallbackStack, {
    stackId: "burst-1",
    name: "Burst",
    count: 2,
    keeperCount: 0,
    coverSourcePath: "/photos/b.jpg",
    sourcePaths: ["/photos/a.jpg", "/photos/b.jpg"],
    items: [
      { assetId: "", sourcePath: "/photos/a.jpg", mediaKind: "burst", title: "", captureDate: "", sequence: 1, keeper: false, selectionRole: "", selectedAt: "", coverHint: false },
      { assetId: "", sourcePath: "/photos/b.jpg", mediaKind: "burst", title: "", captureDate: "", sequence: 2, keeper: false, selectionRole: "", selectedAt: "", coverHint: true },
    ],
  });

  const explicitStack = burstStacksMod.normalizePhotoBurstStack({
    stackId: "burst-2",
    name: "Selects",
    keeperCount: "",
    items: [
      { sourcePath: "/photos/keeper.jpg", keeper: true },
      { sourcePath: "/photos/alternate.jpg", sequence: -2 },
      { sourcePath: "" },
    ],
  });
  assert.strictEqual(explicitStack.keeperCount, 1);
  assert.deepStrictEqual(explicitStack.sourcePaths, ["/photos/keeper.jpg", "/photos/alternate.jpg"]);
  assert.deepStrictEqual(explicitStack.items.map((item) => [item.sourcePath, item.sequence, item.keeper]), [
    ["/photos/keeper.jpg", 0, true],
    ["/photos/alternate.jpg", 0, false],
  ]);
  assert.deepStrictEqual(
    burstStacksMod.normalizePhotoBurstStackList({ stacks: [fallbackStack, explicitStack, { stackId: "", sourcePaths: ["/bad.jpg"] }, null] }).map((stack) => stack.stackId),
    ["burst-1", "burst-2"],
  );
});

run("Photos burst stack panel stays outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/views/photoBurstStackPanel.tsx"), "utf8");
  const stripSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxBurstStrip.tsx"), "utf8");
  assert.match(source, /PhotoBurstStackPanel/);
  assert.match(source, /stacks=\{burstStacks\}/);
  assert.match(source, /imageUrlForItem=\{burstStackImageUrl\}/);
  assert.match(source, /onSetKeeper=\{saveBurstStackKeeper\}/);
  assert.doesNotMatch(source, /photo-burst-stack-panel/);
  assert.doesNotMatch(source, /burstStacks\.map\(\(stack\)/);
  assert.match(panelSource, /export function PhotoBurstStackPanel/);
  assert.match(panelSource, /photo-burst-stack-panel/);
  assert.match(panelSource, /props\.stacks\.map\(\(stack\)/);
  assert.match(panelSource, /props\.uiText\("Loading burst stacks\.\.\."\)/);
  assert.doesNotMatch(panelSource, /stack\.items\.indexOf\(item\)/);
  assert.match(source, /PhotoLightboxBurstStrip/);
  assert.match(source, /rows=\{lightboxBurstFrameRows\}/);
  assert.match(source, /activeRow=\{lightboxBurstActiveRow\}/);
  assert.match(source, /onSelectFrame=\{selectLightboxBurstFrame\}/);
  assert.doesNotMatch(source, /photos-lightbox-burst-strip/);
  assert.match(stripSource, /export function PhotoLightboxBurstStrip/);
  assert.match(stripSource, /photos-lightbox-burst-strip/);
  assert.match(stripSource, /uiText\("Set keeper"\)/);
  assert.match(stripSource, /uiText\("Clear keeper"\)/);
  assert.match(stripSource, /uiText\("Open burst frame"\)/);
});

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
  assertClose(crop.left, 18.555, 0.05, "crop.left");
  assertClose(crop.top, 2.825, 0.05, "crop.top");
  assertClose(crop.width, 52.89, 0.05, "crop.width");
  assertClose(crop.height, 67.5, 0.05, "crop.height");
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
  assertClose(crop.left, 18.555, 0.05, "crop.left");
  assertClose(crop.top, 2.825, 0.05, "crop.top");
  assertClose(crop.width, 52.89, 0.05, "crop.width");
  assertClose(crop.height, 67.5, 0.05, "crop.height");
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
  assert.strictEqual(exportPresetsMod.photoExportRenderQualityNumber("250"), 100);
  assert.strictEqual(exportPresetsMod.photoExportRenderQualityNumber("-8"), 1);
  assert.strictEqual(exportPresetsMod.photoExportRenderQualityNumber("bad"), 92);
  assert.strictEqual(exportPresetsMod.photoExportRenderMaxDimensionNumber("25000"), 20000);
  assert.strictEqual(exportPresetsMod.photoExportRenderMaxDimensionNumber("-8"), 0);
  assert.strictEqual(exportPresetsMod.photoExportRenderMaxDimensionNumber("bad"), 0);
  assert.strictEqual(exportPresetsMod.photoContactSheetColumnsNumber("40"), 8);
  assert.strictEqual(exportPresetsMod.photoContactSheetColumnsNumber("bad"), 4);
  assert.strictEqual(exportPresetsMod.photoContactSheetThumbnailSizeNumber("40"), 96);
  assert.strictEqual(exportPresetsMod.photoContactSheetThumbnailSizeNumber("900"), 512);
  assert.strictEqual(exportPresetsMod.photoContactSheetThumbnailSizeNumber("bad"), 220);
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfilePayload("custom-icc", " /Users/me/Profiles/Fine Art.icc ", true),
    {
      preserveColorProfile: true,
      targetColorProfile: "custom-icc",
      targetColorProfilePath: "/Users/me/Profiles/Fine Art.icc",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfilePayload("display-p3", "/Users/me/Profiles/Fine Art.icc", true),
    {
      preserveColorProfile: true,
      targetColorProfile: "display-p3",
      targetColorProfilePath: "",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfilePayload("bad-profile", "/Users/me/Profiles/Fine Art.icc", false),
    {
      preserveColorProfile: false,
      targetColorProfile: "none",
      targetColorProfilePath: "",
    },
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

run("photo current export preset settings normalize renderer state", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoCurrentExportPresetSettings({
      includeMetadata: true,
      includeXmp: 1,
      includeExistingSidecars: true,
      stripLocation: true,
      preserveColorProfile: true,
      targetColorProfile: "custom-icc",
      targetColorProfilePath: " /Users/me/Profiles/Fine Art.icc ",
      shareAfterExport: true,
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: " {title} ",
      subfolderTemplate: " {year} ",
      exportVariant: "rendered",
      renderFormat: "heic",
      renderQuality: "250",
      renderSizePreset: "custom",
      renderMaxDimension: "25000",
      videoRenderFormat: "hevc",
      videoRenderQuality: "high",
      contactSheetFormat: "jpeg",
      contactSheetTitle: "  Proof  Sheet  ",
      contactSheetCaptionPreset: "metadata",
      contactSheetPageSize: "a4",
      contactSheetLayout: "two_up",
      contactSheetColumns: "40",
      contactSheetThumbnailSize: "40",
      contactSheetIncludeCaptions: false,
    }),
    {
      includeMetadata: true,
      includeXmp: true,
      includeExistingSidecars: true,
      stripLocation: true,
      preserveColorProfile: true,
      targetColorProfile: "custom-icc",
      targetColorProfilePath: "/Users/me/Profiles/Fine Art.icc",
      shareAfterExport: true,
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: "{title}",
      subfolderTemplate: "{year}",
      exportVariant: "rendered",
      renderFormat: "heic",
      renderQuality: "100",
      renderSizePreset: "custom",
      renderMaxDimension: "20000",
      videoRenderFormat: "hevc",
      videoRenderQuality: "high",
      contactSheetFormat: "jpeg",
      contactSheetTitle: "Proof Sheet",
      contactSheetCaptionPreset: "metadata",
      contactSheetPageSize: "a4",
      contactSheetLayout: "two_up",
      contactSheetColumns: "8",
      contactSheetThumbnailSize: "96",
      contactSheetIncludeCaptions: false,
    },
  );
  const defaults = exportPresetsMod.photoCurrentExportPresetSettings();
  assert.strictEqual(defaults.preserveColorProfile, true);
  assert.strictEqual(defaults.targetColorProfile, "source");
});

run("photo selection export options payload normalizes renderer state", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoSelectionExportOptionsPayload({
      includeMetadata: true,
      includeXmp: 1,
      includeExistingSidecars: true,
      stripLocation: true,
      preserveColorProfile: true,
      targetColorProfile: "custom-icc",
      targetColorProfilePath: " /Users/me/Profiles/Fine Art.icc ",
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: " {title} ",
      subfolderTemplate: " {year} ",
      exportVariant: "rendered",
      renderFormat: "heic",
      renderQuality: "250",
      renderMaxDimension: "25000",
      videoRenderFormat: "webm",
      videoRenderQuality: "high",
    }),
    {
      includeMetadata: true,
      includeXmp: true,
      includeExistingSidecars: true,
      stripLocation: true,
      preserveColorProfile: true,
      targetColorProfile: "custom-icc",
      targetColorProfilePath: "/Users/me/Profiles/Fine Art.icc",
      layout: "flat",
      filenameMode: "template",
      filenameTemplate: "{title}",
      subfolderTemplate: "{year}",
      exportVariant: "rendered",
      renderFormat: "heic",
      renderQuality: 100,
      renderMaxDimension: 20000,
      videoRenderFormat: "webm",
      videoRenderQuality: "high",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoSelectionExportOptionsPayload({
      targetColorProfile: "bad-profile",
      targetColorProfilePath: "/Users/me/Profiles/Fine Art.icc",
      layout: "bad",
      filenameMode: "bad",
      filenameTemplate: "",
      exportVariant: "bad",
      renderFormat: "bad",
      renderQuality: "bad",
      renderMaxDimension: "bad",
      videoRenderFormat: "bad",
      videoRenderQuality: "bad",
    }),
    {
      includeMetadata: false,
      includeXmp: false,
      includeExistingSidecars: false,
      stripLocation: false,
      preserveColorProfile: false,
      targetColorProfile: "none",
      targetColorProfilePath: "",
      layout: "bundle",
      filenameMode: "numbered",
      filenameTemplate: "{sequence}-{title}",
      subfolderTemplate: "",
      exportVariant: "original",
      renderFormat: "jpeg",
      renderQuality: 92,
      renderMaxDimension: 0,
      videoRenderFormat: "mp4",
      videoRenderQuality: "medium",
    },
  );
});

run("photo rendered export options payload normalizes render settings", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoRenderedExportOptionsPayload({
      renderFormat: "heic",
      renderQuality: "250",
      renderMaxDimension: "25000",
    }),
    {
      renderFormat: "heic",
      renderQuality: 100,
      renderMaxDimension: 20000,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoRenderedExportOptionsPayload({
      renderFormat: "webp",
      renderQuality: "bad",
      renderMaxDimension: "bad",
    }),
    {
      renderFormat: "jpeg",
      renderQuality: 92,
      renderMaxDimension: 0,
    },
  );
});

run("photo video frame export options payload normalizes frame settings", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoFrameExportOptionsPayload({
      sourcePath: " /photos/clip.mov ",
      timestampMs: 1234.6,
      renderFormat: "tiff",
      renderQuality: "250",
      renderMaxDimension: "25000",
    }),
    {
      sourcePath: "/photos/clip.mov",
      timestampMs: 1235,
      renderFormat: "tiff",
      renderQuality: 100,
      renderMaxDimension: 20000,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoFrameExportOptionsPayload({
      sourcePath: " /photos/clip.mov ",
      timestampMs: "bad",
      usePosterFrame: true,
      renderFormat: "webp",
      renderQuality: "bad",
      renderMaxDimension: "bad",
    }),
    {
      sourcePath: "/photos/clip.mov",
      usePosterFrame: true,
      renderFormat: "jpeg",
      renderQuality: 92,
      renderMaxDimension: 0,
    },
  );
});

run("photo Live Photo motion export options payload normalizes variants", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoLiveMotionExportOptionsPayload({
      sourcePath: " /photos/live.heic ",
      exportVariant: "bounce_gif",
    }),
    {
      sourcePath: "/photos/live.heic",
      exportVariant: "bounce_gif",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoLiveMotionExportOptionsPayload({
      sourcePath: " /photos/live.heic ",
      exportVariant: "video",
    }),
    {
      sourcePath: "/photos/live.heic",
      exportVariant: "motion",
    },
  );
});

run("photo video render options payload normalizes video settings", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoRenderOptionsPayload({
      videoRenderFormat: "hevc",
      videoRenderQuality: "high",
      renderMaxDimension: "25000",
    }),
    {
      videoRenderFormat: "hevc",
      videoRenderQuality: "high",
      renderMaxDimension: 20000,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoRenderOptionsPayload({
      videoRenderFormat: "avi",
      videoRenderQuality: "huge",
      renderMaxDimension: "bad",
    }),
    {
      videoRenderFormat: "mp4",
      videoRenderQuality: "medium",
      renderMaxDimension: 0,
    },
  );
});

run("photo video trim export options payload normalizes trim settings", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoTrimExportOptionsPayload({
      sourcePath: " /photos/clip.mov ",
      startMs: 1000.4,
      endMs: 4250.6,
      videoRenderFormat: "prores",
      videoRenderQuality: "high",
      renderMaxDimension: "25000",
      videoRotateDegrees: 90,
      videoCropAspect: "landscape",
    }),
    {
      sourcePath: "/photos/clip.mov",
      startMs: 1000,
      endMs: 4251,
      videoRenderFormat: "prores",
      videoRenderQuality: "high",
      renderMaxDimension: 20000,
      videoRotateDegrees: 90,
      videoCropAspect: "landscape",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoVideoTrimExportOptionsPayload({
      sourcePath: " /photos/clip.mov ",
      startMs: "bad",
      endMs: -50,
      videoRenderFormat: "avi",
      videoRenderQuality: "huge",
      renderMaxDimension: "bad",
      videoRotateDegrees: 45,
      videoCropAspect: "wide",
    }),
    {
      sourcePath: "/photos/clip.mov",
      startMs: 0,
      endMs: 0,
      videoRenderFormat: "mp4",
      videoRenderQuality: "medium",
      renderMaxDimension: 0,
      videoRotateDegrees: 0,
      videoCropAspect: "none",
    },
  );
});

run("photo lightbox derivative export options normalize source and render size", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoSubjectCutoutExportOptionsPayload({
      sourcePath: " /photos/Subject.heic ",
      exportVariant: "sticker",
      renderMaxDimension: "25000",
      copyToClipboard: 1,
    }),
    {
      sourcePath: "/photos/Subject.heic",
      exportVariant: "sticker",
      renderMaxDimension: 20000,
      copyToClipboard: true,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoSubjectCutoutExportOptionsPayload({
      sourcePath: " /photos/Subject.heic ",
      exportVariant: "bad",
      renderMaxDimension: "bad",
    }),
    {
      sourcePath: "/photos/Subject.heic",
      exportVariant: "cutout",
      renderMaxDimension: 0,
      copyToClipboard: false,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoPortraitBlurExportOptionsPayload({
      sourcePath: " /photos/Portrait.heic ",
      renderMaxDimension: "25000",
    }),
    {
      sourcePath: "/photos/Portrait.heic",
      renderMaxDimension: 20000,
    },
  );
});

run("photo strip-location share export options preserve privacy defaults", () => {
  assert.deepStrictEqual(exportPresetsMod.photoStripLocationShareExportOptionsPayload(), {
    stripLocation: true,
    exportVariant: "rendered",
    renderFormat: "jpeg",
    renderQuality: 92,
    renderMaxDimension: 0,
    preserveColorProfile: true,
    targetColorProfile: "source",
    layout: "flat",
    filenameMode: "original",
    allowRenderFallback: false,
    revealAfterExport: false,
  });
});

run("photo contact sheet export options payload normalizes renderer state", () => {
  assert.deepStrictEqual(
    exportPresetsMod.photoContactSheetExportOptionsPayload({
      format: "jpeg",
      layoutPreset: "two_up",
      columns: "40",
      thumbnailSize: "40",
      includeCaptions: 0,
      captionMode: "metadata",
      title: "  Proof  Sheet  ",
      pageSize: "a4",
      quality: "250",
    }),
    {
      format: "jpeg",
      layoutPreset: "two_up",
      columns: 8,
      thumbnailSize: 96,
      includeCaptions: false,
      captionMode: "metadata",
      title: "Proof  Sheet",
      pageSize: "a4",
      quality: 100,
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoContactSheetExportOptionsPayload({
      format: "gif",
      layoutPreset: "poster-wall",
      columns: "bad",
      thumbnailSize: "bad",
      captionMode: "everything",
      pageSize: "tabloid",
      quality: "bad",
    }),
    {
      format: "pdf",
      layoutPreset: "custom",
      columns: 4,
      thumbnailSize: 220,
      includeCaptions: true,
      captionMode: "title_date_people",
      title: "",
      pageSize: "letter",
      quality: 92,
    },
  );
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

run("photo creation export suggestions prepare per-photo features once", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/photoExportPresets.ts"), "utf8");
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /type PhotoCreationPreparedItem = \{/);
  assert.match(source, /function prepareCreationItem\(\s*item: PhotoCreationSuggestionItemInput,/);
  assert.match(source, /const normalizedContentValues = creationContentValues\(item\)\.map\(normalizeCreationTermText\);/);
  assert.match(source, /const preparedItems = items\s*\.map\(\(item\) => prepareCreationItem\(item, favoritePeople, favoritePets, memoryContextSourcePaths\)\)/);
  assert.match(source, /buildSingleCreationSuggestion\("wallpaper", preparedItems\)/);
  assert.match(source, /buildCollageCreationSuggestion\(preparedItems, maxCollageItems\)/);
  assert.match(source, /buildSingleCreationSuggestion\("poster", preparedItems\)/);
  assert.match(photosViewSource, /if \(!exportOptionsOpen\) return \[\];[\s\S]*buildPhotoCreationExportSuggestions\(creationSuggestionSourceItems/);
  assert.doesNotMatch(source, /scoreCreationItem\(item, kind, favoritePeople, favoritePets, memoryContextSourcePaths\)/);
  assert.doesNotMatch(source, /scoreCreationItem\(item, "collage", favoritePeople, favoritePets, memoryContextSourcePaths\)/);
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
  assert.strictEqual(exportPresetsMod.photoCreationSuggestionRefreshStatesEqual(firstFailure, { ...firstFailure }), true);
  assert.strictEqual(exportPresetsMod.photoCreationSuggestionRefreshStatesEqual(firstFailure, secondFailure), false);
  assert.strictEqual(exportPresetsMod.photoCreationSuggestionRefreshStatesEqual(null, undefined), true);
  assert.strictEqual(exportPresetsMod.normalizePhotoCreationSuggestionRefreshState(firstFailure, "wrong"), null);
});

run("photo creation suggestion storage normalizes cache and refresh state", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const exportPresetsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportPresets.ts"), "utf8");
  assert.strictEqual(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, "vintrace.photos.creationSuggestions.cache");
  assert.strictEqual(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_REFRESH_KEY, "vintrace.photos.creationSuggestions.refresh");
  assert.doesNotMatch(photosViewSource, /function photoCreationSuggestionRefreshStatesEqual/);
  assert.match(exportPresetsSource, /export function photoCreationSuggestionRefreshStatesEqual/);
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };

  try {
    const signature = exportPresetsMod.buildPhotoCreationSuggestionCacheSignature({ sourceCount: 1 });
    const suggestions = exportPresetsMod.buildPhotoCreationExportSuggestions([
      {
        sourcePath: "/photos/wallpaper.jpg",
        mediaKind: "image",
        width: 3840,
        height: 2160,
        quality: 0.94,
      },
    ]);
    const cache = exportPresetsMod.buildPhotoCreationSuggestionCacheRecord({
      signature,
      sourceCount: 1,
      suggestions,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });
    const refresh = exportPresetsMod.buildPhotoCreationSuggestionRefreshFailureState({
      signature,
      now: "2026-07-08T00:00:00.000Z",
      error: "temporary failure",
    });

    values.set(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, "{bad json");
    values.set(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_REFRESH_KEY, "{bad json");
    assert.strictEqual(
      exportPresetsMod.readStoredPhotoCreationSuggestionCache(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, signature),
      null,
    );
    assert.strictEqual(
      exportPresetsMod.readStoredPhotoCreationSuggestionRefreshState(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_REFRESH_KEY, signature),
      null,
    );

    exportPresetsMod.storePhotoCreationSuggestionCache(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, cache);
    exportPresetsMod.storePhotoCreationSuggestionRefreshState(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_REFRESH_KEY, refresh);
    assert.deepStrictEqual(
      exportPresetsMod.readStoredPhotoCreationSuggestionCache(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, signature),
      cache,
    );
    assert.deepStrictEqual(
      exportPresetsMod.readStoredPhotoCreationSuggestionRefreshState(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_REFRESH_KEY, signature),
      refresh,
    );
    assert.strictEqual(
      exportPresetsMod.readStoredPhotoCreationSuggestionCache(exportPresetsMod.PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, "wrong"),
      null,
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
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
  const freshIdCollision = exportPresetsMod.upsertPhotoExportPreset(withSecond, {
    id: "export-preset:fresh-web-collision",
    name: "Web",
    settings: secondSettings,
    now: "2026-06-21T04:00:00.000Z",
  });
  assert.deepStrictEqual(
    freshIdCollision.map((preset) => [preset.id, preset.name, preset.settings.includeMetadata, preset.settings.includeXmp]),
    withSecond.map((preset) => [preset.id, preset.name, preset.settings.includeMetadata, preset.settings.includeXmp]),
  );
  assert.strictEqual(freshIdCollision.some((preset) => preset.id === "export-preset:fresh-web-collision"), false);
  assert.deepStrictEqual(exportPresetsMod.deletePhotoExportPreset(updated, updated[0].id), []);
});

run("photo export preset storage normalizes persisted presets", () => {
  assert.strictEqual(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY, "vintrace.photos.exportPresets");
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };

  try {
    const settings = exportPresetsMod.normalizePhotoExportPresetSettings({ filenameTemplate: "{title}" });
    values.set(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY, "{bad json");
    assert.deepStrictEqual(
      exportPresetsMod.readStoredPhotoExportPresets(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY),
      [],
    );

    const presets = Array.from({ length: 25 }, (_, index) => ({
      id: `preset-${index}`,
      name: `Preset ${index}`,
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      updatedAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T01:00:00.000Z`,
      settings,
    }));
    exportPresetsMod.storePhotoExportPresets(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY, [
      ...presets,
      { id: "invalid", name: "", settings },
      { ...presets[0], id: "preset-1", name: "Duplicate id should drop" },
    ]);

    const stored = JSON.parse(values.get(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY));
    assert.strictEqual(stored.length, 20);
    assert.strictEqual(stored[0].id, "preset-24");
    assert.strictEqual(stored.at(-1).id, "preset-5");
    assert.deepStrictEqual(
      exportPresetsMod.readStoredPhotoExportPresets(exportPresetsMod.PHOTO_EXPORT_PRESETS_KEY).map((preset) => preset.id),
      stored.map((preset) => preset.id),
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
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
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const pendingReviewSource = fs.readFileSync(path.join(ROOT, "src/views/photoPendingImportReviewPanel.tsx"), "utf8");
  const importAccessSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportAccess.ts"), "utf8");
  assert.deepStrictEqual(
    importAccessMod.PHOTO_IMPORT_SOURCE_OPTIONS.map((option) => option.kind),
    ["folder", "camera", "library", "mail", "safari", "messages", "airdrop", "downloads", "app"],
  );
  assert.strictEqual(importAccessMod.photoImportSourceLabel("folder", "Custom folder"), "Custom folder");
  assert.strictEqual(importAccessMod.photoImportSourceLabel("camera", "Nikon Z", false), "Camera/device");
  assert.strictEqual(importAccessMod.photoImportSourceLabel("camera", "Nikon Z", true), "Nikon Z");
  assert.strictEqual(importAccessMod.photoImportReviewSourceLabel("camera", "Nikon Z", true), "Nikon Z · Camera/device");
  assert.strictEqual(importAccessMod.photoImportReviewSourceLabel("camera", "Camera/device", true), "Camera/device");
  assert.strictEqual(importAccessMod.photoImportSourceKindFromInference("downloads"), "downloads");
  assert.strictEqual(importAccessMod.normalizeExternalPhotoImportSourceKind("airdrop"), "airdrop");
  assert.strictEqual(importAccessMod.normalizeExternalPhotoImportSourceKind("unknown"), "folder");
  assert.match(importAccessSource, /export function photoImportSourceLabel/);
  assert.match(photosViewSource, /from "\.\/photoImportAccess"/);
  assert.match(photosViewSource, /PhotoPendingImportReviewPanel/);
  assert.match(photosViewSource, /onConfirm=\{\(\) => void confirmPendingImport\(\)\}/);
  assert.match(photosViewSource, /onRemoveEntry=\{removePendingImportEntry\}/);
  assert.doesNotMatch(photosViewSource, /function photoImportSourceLabel/);
  assert.doesNotMatch(photosViewSource, /function normalizeExternalPhotoImportSourceKind/);
  assert.doesNotMatch(photosViewSource, /photo-import-review-panel/);
  assert.doesNotMatch(photosViewSource, /photo-import-album-target/);
  assert.doesNotMatch(photosViewSource, /photoImportReviewSourceLabel/);
  assert.match(pendingReviewSource, /export function PhotoPendingImportReviewPanel/);
  assert.match(pendingReviewSource, /photo-import-review-panel/);
  assert.match(pendingReviewSource, /photo-import-album-target/);
  assert.match(pendingReviewSource, /photoImportReviewSourceLabel/);
  assert.match(pendingReviewSource, /PHOTO_IMPORT_NEW_ALBUM_TARGET/);
  assert.match(pendingReviewSource, /props\.uiText\("Confirm import"\)/);
  assert.match(pendingReviewSource, /props\.uiText\("Cancel import"\)/);
  assert.match(pendingReviewSource, /props\.uiText\("Access note"\)/);
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
  assert.deepStrictEqual(
    importAlbumTargetMod.photoImportAlbumAttachDraft({
      targetId: importAlbumTargetMod.PHOTO_IMPORT_NEW_ALBUM_TARGET,
      newAlbumName: " Camera Roll Picks ",
      result: {
        importedPaths: [" /managed/a.jpg ", "/managed/b.jpg", "/managed/a.jpg"],
      },
    }),
    {
      targetId: importAlbumTargetMod.PHOTO_IMPORT_NEW_ALBUM_TARGET,
      albumId: "",
      sourcePaths: ["/managed/a.jpg", "/managed/b.jpg"],
      createAlbum: {
        name: "Camera Roll Picks",
        albumKind: "manual",
        description: "",
        includePeople: [],
        excludePeople: [],
        rules: {},
        coverSourcePath: "/managed/a.jpg",
      },
    }
  );
  assert.deepStrictEqual(
    importAlbumTargetMod.photoImportAlbumAttachDraft({
      targetId: "album-2",
      result: {
        importedPaths: [],
        assets: [{ sourcePath: "/asset/a.jpg" }, { sourcePath: "/asset/b.jpg" }],
      },
    }),
    {
      targetId: "album-2",
      albumId: "album-2",
      sourcePaths: ["/asset/a.jpg", "/asset/b.jpg"],
      createAlbum: null,
    }
  );
  assert.strictEqual(
    importAlbumTargetMod.photoImportAlbumAttachDraft({
      targetId: importAlbumTargetMod.PHOTO_IMPORT_NEW_ALBUM_TARGET,
      newAlbumName: " ",
      result: { importedPaths: ["/managed/a.jpg"] },
    }),
    null
  );
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const addPendingImportBlock = photosViewSource.match(/async function addPendingImportToAlbum\(result: PhotoImportResult \| null\): Promise<string> \{[\s\S]*?\n  \}\n\n  function removeRecoveredFailureFromState/);
  assert.ok(addPendingImportBlock, "addPendingImportToAlbum should exist");
  assert.match(addPendingImportBlock[0], /const albumDraft = photoImportAlbumAttachDraft\(\{/);
  assert.match(addPendingImportBlock[0], /await savePhotoAlbum\(albumDraft\.createAlbum\)/);
  assert.match(addPendingImportBlock[0], /sourcePaths: albumDraft\.sourcePaths/);
  assert.doesNotMatch(addPendingImportBlock[0], /photoImportResultFinalSourcePaths/);
  assert.doesNotMatch(addPendingImportBlock[0], /coverSourcePath: sourcePaths\[0\]/);
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
  assert.strictEqual(importSessionDetailsMod.PHOTO_IMPORT_HISTORY_RENDER_LIMIT, 40);
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

run("photo import history state composes scoped filters totals and source options", () => {
  const aggregateSessions = [
    {
      importId: "alpha-running",
      sourceKind: "phone",
      storageMode: "referenced",
      sourceLabel: "Alpha camera",
      rootPath: "/Library/Alpha/DCIM",
      status: "running",
      startedAt: "2026-06-29T10:00:00Z",
      updatedAt: "2026-06-29T10:01:00Z",
      importedCount: 3,
      failedCount: 0,
    },
    {
      importId: "alpha-managed",
      sourceKind: "folder",
      storageMode: "managed",
      sourceLabel: "Alpha folder",
      rootPath: "/Desktop/Drop",
      metadata: { managedRoot: "/Library/Alpha/Imports/2026" },
      status: "completed",
      startedAt: "2026-06-27T10:00:00Z",
      completedAt: "2026-06-27T10:04:00Z",
      updatedAt: "2026-06-27T10:04:00Z",
      importedCount: 6,
      failedCount: 0,
    },
    {
      importId: "beta-managed",
      sourceKind: "downloads",
      storageMode: "managed",
      sourceLabel: "Beta downloads",
      rootPath: "/Desktop/Drop",
      metadata: { managedRoot: "/Library/Beta/Imports/2026" },
      status: "completed",
      startedAt: "2026-06-26T10:00:00Z",
      completedAt: "2026-06-26T10:04:00Z",
      updatedAt: "2026-06-26T10:04:00Z",
      importedCount: 4,
      failedCount: 0,
    },
  ];
  const archivedImportSessions = [
    {
      importId: "alpha-archived",
      sourceKind: "mail",
      storageMode: "managed",
      sourceLabel: "Alpha mail",
      rootPath: "/Library/Alpha/Mail",
      status: "completed",
      startedAt: "2026-06-25T10:00:00Z",
      completedAt: "2026-06-25T10:02:00Z",
      updatedAt: "2026-06-25T10:02:00Z",
      importedCount: 2,
      failedCount: 0,
      archived: true,
      archivedAt: "2026-06-30T10:00:00Z",
    },
  ];
  const fallbackSession = {
    importId: "fallback-should-not-appear",
    sourceKind: "folder",
    storageMode: "referenced",
    sourceLabel: "Fallback",
    rootPath: "/Fallback",
    status: "completed",
    startedAt: "2026-06-30T10:00:00Z",
    completedAt: "2026-06-30T10:01:00Z",
    updatedAt: "2026-06-30T10:01:00Z",
    importedCount: 1,
    failedCount: 0,
  };

  const state = importSessionDetailsMod.buildPhotoImportHistoryState({
    activeId: "imports",
    activeFolder: {
      id: "imports",
      importSessions: aggregateSessions,
      archivedImportSessions,
      importSessionCount: 9,
      archivedImportSessionCount: 1,
    },
    folders: [{ id: "import:fallback", importSession: fallbackSession }],
    libraryRoot: "/library/alpha",
    query: "alpha",
    showArchived: false,
    limit: 1,
  });
  assert.deepStrictEqual(state.allSummaries.map((session) => session.importId), [
    "alpha-running",
    "alpha-managed",
    "beta-managed",
    "alpha-archived",
  ]);
  assert.deepStrictEqual(state.scopedSummaries.map((session) => session.importId), ["alpha-running", "alpha-managed"]);
  assert.deepStrictEqual(state.filteredSummaries.map((session) => session.importId), ["alpha-running", "alpha-managed"]);
  assert.deepStrictEqual(state.visibleSummaries.map((session) => session.importId), ["alpha-running"]);
  assert.deepStrictEqual(state.archivableSummaries.map((session) => session.importId), ["alpha-managed"]);
  assert.deepStrictEqual(state.sourceOptions, [
    { value: "camera", label: "Camera/device" },
    { value: "folder", label: "Files/folders" },
  ]);
  assert.strictEqual(state.queryFiltersActive, true);
  assert.strictEqual(state.filtersActive, true);
  assert.strictEqual(state.total, 9);
  assert.strictEqual(state.visibleTotal, 2);
  assert.strictEqual(state.matchedTotal, 2);

  const restoredState = importSessionDetailsMod.buildPhotoImportHistoryState({
    activeId: "imports",
    activeFolder: {
      id: "imports",
      importSessions: aggregateSessions,
      archivedImportSessions,
      importSessionCount: 9,
      archivedImportSessionCount: 1,
    },
    folders: [{ id: "import:fallback", importSession: fallbackSession }],
    showArchived: true,
  });
  assert.deepStrictEqual(restoredState.scopedSummaries.map((session) => session.importId), [
    "alpha-running",
    "alpha-managed",
    "beta-managed",
    "alpha-archived",
  ]);
  assert.strictEqual(restoredState.total, 10);
  assert.strictEqual(restoredState.visibleTotal, 10);
  assert.strictEqual(restoredState.matchedTotal, 4);

  const fallbackState = importSessionDetailsMod.buildPhotoImportHistoryState({
    activeId: "recentlyImported",
    activeFolder: { id: "recentlyImported" },
    folders: [{ id: "import:fallback", importSession: fallbackSession }],
  });
  assert.deepStrictEqual(fallbackState.allSummaries.map((session) => session.importId), ["fallback-should-not-appear"]);
  assert.deepStrictEqual(
    importSessionDetailsMod.buildPhotoImportHistoryState({ activeId: "all", folders: [{ id: "import:fallback", importSession: fallbackSession }] }).allSummaries,
    []
  );
});

run("photo import session selectors and labels stay outside PhotosView", () => {
  const directSession = { importId: "direct", sourceKind: "folder", storageMode: "referenced", sourceLabel: "Direct", status: "completed" };
  const folderSession = { importId: "folder", sourceKind: "camera", storageMode: "managed", sourceLabel: "Folder", status: "running" };
  const newestSession = { importId: "newest", sourceKind: "mail", storageMode: "referenced", sourceLabel: "Newest", status: "completed" };
  assert.strictEqual(
    importSessionDetailsMod.photoActiveImportSessionRecord({
      activeId: "import:folder",
      activeFolder: { id: "active", importSession: directSession },
      folders: [{ id: "import:folder", importSession: folderSession }],
    }).importId,
    "direct"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoActiveImportSessionRecord({
      activeId: "import:folder",
      activeFolder: null,
      folders: [{ id: "import:folder", importSession: folderSession }],
    }).importId,
    "folder"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoActiveImportSessionRecord({
      activeId: "lastImport",
      folders: [
        { id: "all", importSession: directSession },
        { id: "import:newest", importSession: newestSession },
      ],
    }).importId,
    "newest"
  );
  assert.strictEqual(importSessionDetailsMod.photoActiveImportSessionRecord({ activeId: "all", folders: [] }), null);

  const formatters = {
    formatCount: (value) => `#${value}`,
    text: (value) => value.toUpperCase(),
  };
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryCountLabel({
      queryFiltersActive: true,
      matchedTotal: 12,
      visibleTotal: 30,
      visibleSummaries: [{}, {}, {}],
    }, formatters),
    "#3 OF #12 MATCHES · #30 SESSIONS"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryCountLabel({
      queryFiltersActive: true,
      matchedTotal: 1,
      visibleTotal: 8,
      visibleSummaries: [{}],
    }, formatters),
    "#1 MATCH · #8 SESSIONS"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryCountLabel({
      queryFiltersActive: false,
      matchedTotal: 1,
      visibleTotal: 6,
      visibleSummaries: [{}, {}],
    }, formatters),
    "#2 OF #6 SESSIONS"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryCountLabel({
      queryFiltersActive: false,
      matchedTotal: 1,
      visibleTotal: 1,
      visibleSummaries: [{}],
    }, formatters),
    "#1 SESSION"
  );
});

run("photo import history provenance payloads and status labels stay outside PhotosView", () => {
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryProvenanceEditDraft({
      importId: " import-1 ",
      sourceKind: "camera",
      sourceLabel: "",
      sourceDetail: " Camera card ",
    }),
    {
      importId: "import-1",
      sourceKind: "camera",
      sourceLabel: "Camera/device",
      sourceDetail: "Camera card",
    }
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryProvenancePayload({
      importId: " import-1 ",
      sourceKind: "airdrop",
      sourceLabel: "  Friend drop  ",
      sourceDetail: "  Shared sheet  ",
    }),
    {
      payload: {
        importId: "import-1",
        sourceKind: "airdrop",
        sourceLabel: "Friend drop",
        sourceDetail: "Shared sheet",
      },
      error: "",
    }
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryProvenancePayload({
      importId: " import-1 ",
      sourceKind: "unknown",
      sourceLabel: "   ",
    }),
    { payload: null, error: "Source label is required." }
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryProvenancePayload({ importId: " ", sourceLabel: "Camera" }),
    { payload: null, error: "" }
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryBulkProvenancePayload({
      importIds: [" a ", "a", "", "b"],
      sourceKind: "messages",
      sourceLabel: "  Messages thread ",
      sourceDetail: " ",
    }),
    {
      importIds: ["a", "b"],
      sourceKind: "messages",
      sourceLabel: "Messages thread",
    }
  );
  assert.strictEqual(importSessionDetailsMod.photoImportHistoryBulkProvenancePayload({ importIds: [], sourceKind: "mail" }), null);
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryArchivePayload([" a ", "", "a", "b"], true),
    {
      importIds: ["a", "b"],
      archive: true,
      reason: "Archived from import history",
    }
  );
  assert.deepStrictEqual(
    importSessionDetailsMod.photoImportHistoryArchivePayload(["a"], false),
    {
      importIds: ["a"],
      archive: false,
      reason: "",
    }
  );
  assert.strictEqual(importSessionDetailsMod.photoImportHistoryArchivePayload([], true), null);
  assert.strictEqual(importSessionDetailsMod.photoImportHistoryArchiveNextActiveId("import:b", ["a", "b"], true), "imports");
  assert.strictEqual(importSessionDetailsMod.photoImportHistoryArchiveNextActiveId("import:b", ["a"], true), "import:b");
  assert.strictEqual(importSessionDetailsMod.photoImportHistoryArchiveNextActiveId("import:b", ["b"], false), "import:b");

  const formatters = {
    formatCount: (value) => `#${value}`,
    text: (value) => value.toUpperCase(),
  };
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryProvenanceStatusLabel(1, formatters),
    "UPDATED IMPORT SOURCE · #1 ITEM"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryProvenanceStatusLabel(3, formatters),
    "UPDATED IMPORT SOURCE · #3 ITEMS"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryBulkProvenanceStatusLabel(2, 5, formatters),
    "UPDATED IMPORT SOURCE · #2 · #5 ITEMS"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryArchiveStatusLabel(true, 2, formatters),
    "ARCHIVED IMPORTS · #2"
  );
  assert.strictEqual(
    importSessionDetailsMod.photoImportHistoryArchiveStatusLabel(false, 1, formatters),
    "RESTORED IMPORTS · #1"
  );
});

run("import history provenance and archive controls are wired to backend commands", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportSessionPanel.tsx"), "utf8");
  const historyPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportHistoryPanel.tsx"), "utf8");
  const listSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportHistoryList.tsx"), "utf8");
  const recoveredPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoRecoveredImportIssuesPanel.tsx"), "utf8");
  const railImportControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailImportControls.tsx"), "utf8");
  const toolbarSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportHistoryToolbar.tsx"), "utf8");
  const provenanceEditorSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportProvenanceEditor.tsx"), "utf8");
  assert.match(appSource, /archive_photo_import_sessions/);
  assert.match(source, /updatePhotoImportSessionProvenance/);
  assert.match(source, /archivePhotoImportSessions/);
  assert.match(source, /photoActiveImportSessionRecord/);
  assert.match(source, /photoImportHistoryCountLabel/);
  assert.match(source, /photoImportHistoryProvenanceEditDraft/);
  assert.match(source, /photoImportHistoryProvenancePayload/);
  assert.match(source, /photoImportHistoryBulkProvenancePayload/);
  assert.match(source, /photoImportHistoryArchivePayload/);
  assert.match(source, /PhotoImportSessionPanel/);
  assert.match(source, /PhotoImportHistoryPanel/);
  assert.match(source, /PhotoRecoveredImportIssuesPanel/);
  assert.match(source, /buildPhotoImportSystemSourceRows\(photoSources\)/);
  assert.match(source, /PhotoRailImportControls/);
  assert.match(source, /systemSourceRows=\{visiblePhotoSystemSourceRows\}/);
  assert.match(source, /onImportSuggestedSource=\{\(source\) => void importSuggestedPhotoSource\(source\)\}/);
  assert.match(source, /onStartEdit=\{startImportHistoryProvenanceEdit\}/);
  assert.match(source, /onSaveEdit=\{\(importId\) => void saveImportHistoryProvenanceEdit\(importId\)\}/);
  assert.match(source, /onArchive=\{\(importId, archive\) => void updateImportHistoryArchive\(\[importId\], archive\)\}/);
  assert.doesNotMatch(source, /const cleanLabel = importHistoryEditLabel\.replace/);
  assert.doesNotMatch(source, /const params: Record<string, unknown> = \{ importIds: cleanIds/);
  assert.doesNotMatch(source, /function renderImportHistoryProvenanceEditor/);
  assert.doesNotMatch(source, /photo-import-session-panel/);
  assert.doesNotMatch(source, /photo-import-history-panel/);
  assert.doesNotMatch(source, /photo-recovered-panel/);
  assert.doesNotMatch(source, /PhotoImportHistoryList/);
  assert.doesNotMatch(source, /PhotoImportHistoryToolbar/);
  assert.doesNotMatch(source, /PhotoImportHistoryBulkProvenanceEditor/);
  assert.doesNotMatch(source, /uiText\("Import history"\)/);
  assert.doesNotMatch(source, /Recovered import issues/);
  assert.doesNotMatch(source, /uiText\("Restore import"\)/);
  assert.doesNotMatch(source, /PhotoImportHistoryProvenanceEditor/);
  assert.doesNotMatch(source, /photo-import-provenance-editor" role="group"/);
  assert.doesNotMatch(source, /photo-import-history-list/);
  assert.doesNotMatch(source, /No matching imports/);
  assert.doesNotMatch(source, /photo-import-history-controls" aria-label/);
  assert.doesNotMatch(source, /uiText\("Show archived"\)/);
  assert.match(panelSource, /export function PhotoImportSessionPanel/);
  assert.match(panelSource, /photo-import-session-panel/);
  assert.match(panelSource, /props\.uiText\("Import details"\)/);
  assert.match(panelSource, /PhotoImportHistoryProvenanceEditor/);
  assert.match(panelSource, /props\.onArchive\(props\.session\.importId, !props\.session\.archived\)/);
  assert.match(panelSource, /props\.uiText\("Restore import"\)/);
  assert.match(historyPanelSource, /export function PhotoImportHistoryPanel/);
  assert.match(historyPanelSource, /photo-import-history-panel/);
  assert.match(historyPanelSource, /props\.uiText\("Import history"\)/);
  assert.match(historyPanelSource, /PhotoImportHistoryToolbar/);
  assert.match(historyPanelSource, /PhotoImportHistoryBulkProvenanceEditor/);
  assert.match(historyPanelSource, /PhotoImportHistoryList/);
  assert.match(historyPanelSource, /props\.onArchive\(activeArchivableIds, true\)/);
  assert.match(historyPanelSource, /props\.onApplyBulkProvenance\(activeArchivableIds\)/);
  assert.match(listSource, /export function PhotoImportHistoryList/);
  assert.match(listSource, /photo-import-history-list/);
  assert.match(listSource, /PhotoImportHistoryProvenanceEditor/);
  assert.match(listSource, /No matching imports/);
  assert.match(listSource, /props\.onArchive\(session\.importId, !session\.archived\)/);
  assert.match(recoveredPanelSource, /export function PhotoRecoveredImportIssuesPanel/);
  assert.match(recoveredPanelSource, /photo-recovered-panel/);
  assert.match(recoveredPanelSource, /buildPhotoImportSessionSummary\(session\)/);
  assert.match(recoveredPanelSource, /props\.onRetry\(failure\)/);
  assert.match(recoveredPanelSource, /props\.uiText\("Retry import"\)/);
  assert.match(recoveredPanelSource, /props\.uiText\("Save to library"\)/);
  assert.match(recoveredPanelSource, /props\.uiText\("Recovered import issues"\)/);
  assert.match(source, /onPreviewOrphans=\{\(\) => void scanRecoveredOrphans\(\{ dryRun: true \}\)\}/);
  assert.match(source, /onPurgeOldFiles=\{\(\) => void cleanupRecoveredOrphans\(true, true\)\}/);
  assert.match(railImportControlsSource, /export function PhotoRailImportControls/);
  assert.match(railImportControlsSource, /photo-import-system-source-badges/);
  assert.match(railImportControlsSource, /row\.safetyDetail/);
  assert.match(railImportControlsSource, /PHOTO_IMPORT_SOURCE_OPTIONS\.map/);
  assert.match(toolbarSource, /export function PhotoImportHistoryToolbar/);
  assert.match(toolbarSource, /photo-import-history-controls/);
  assert.match(toolbarSource, /props\.uiText\("Show archived"\)/);
  assert.match(toolbarSource, /props\.uiText\("Archive matches"\)/);
  assert.match(toolbarSource, /props\.uiText\("Set source for matches"\)/);
  assert.match(toolbarSource, /props\.sourceOptions\.map/);
  assert.match(provenanceEditorSource, /export function PhotoImportHistoryProvenanceEditor/);
  assert.match(provenanceEditorSource, /export function PhotoImportHistoryBulkProvenanceEditor/);
  assert.match(provenanceEditorSource, /PHOTO_IMPORT_SOURCE_OPTIONS\.map/);
  assert.match(provenanceEditorSource, /sourceKindLabel="Edit import source kind"/);
  assert.match(provenanceEditorSource, /sourceKindLabel="Bulk import source kind"/);
});

run("reverse geocode place lookup is wired through Photos controls", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const viewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(appSource, /reverse_geocode_photo_location/);
  assert.match(appSource, /reverseGeocodePhotoLocation=\{reverseGeocodePhotoLocation\}/);
  assert.match(viewSource, /reverseGeocodePhotoLocation/);
  assert.match(viewSource, /lookupLightboxPlaceName/);
  assert.match(viewSource, /lookupActivePlaceName/);
  assert.match(viewSource, /photoReverseGeocodeAppliedLocationDraft/);
  assert.match(viewSource, /photoReverseGeocodeItemCoordinates/);
  assert.match(viewSource, /photoReverseGeocodeLocationPayload/);
  assert.match(viewSource, /photoReverseGeocodeMetadataPatches/);
  assert.match(viewSource, /photoReverseGeocodePlaceLookupState/);
  assert.match(viewSource, /photoReverseGeocodeSettledResult/);
  assert.match(viewSource, /photoReverseGeocodeStatusText/);
  assert.doesNotMatch(viewSource, /function photoItemGpsCoordinate/);
  assert.doesNotMatch(viewSource, /for \(let attempt = 0; attempt < 18; attempt \+= 1\)/);
  assert.doesNotMatch(viewSource, /setLocationLabelDraft\(String\(value\.label \|\| ""\)\)/);
  assert.doesNotMatch(viewSource, /setLocationLatitudeDraft\(String\(value\.latitude \|\| coordinates\.latitude\)\)/);
  assert.doesNotMatch(viewSource, /activePlace\.place\.assetIds \|\| \[\]\)\.map/);
  assert.doesNotMatch(viewSource, /row\.locationOverride && typeof row\.locationOverride === "object"/);
  assert.doesNotMatch(viewSource, /reverseGeocodeResult\.applied \? `\\$\\{uiText\("Applied"\)\\}/);
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
    visionModelTier: "unknown",
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
    visionModelTier: "auto",
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
  const privacyPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoPrivacySettingsPanel.tsx"), "utf8");
  const sensitiveLockPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoSensitiveLockPanel.tsx"), "utf8");
  assert.match(source, /sensitiveSessionTimerRef/);
  assert.match(source, /PhotoPrivacySettingsPanel/);
  assert.match(source, /PhotoSensitiveLockPanel/);
  assert.match(source, /settings=\{photoSettings\}/);
  assert.match(source, /onSettingsChange=\{updatePhotoLocalSettings\}/);
  assert.match(source, /sensitivePasscodeConfigured=\{photoSensitivePasscodeConfigured\(photoSettings\)\}/);
  assert.match(source, /onRefreshSensitiveAuthStatus=\{\(\) => void refreshSensitiveAuthStatus\(\)\}/);
  assert.match(source, /onSaveSensitivePasscode=\{\(\) => void saveSensitivePasscode\(\)\}/);
  assert.doesNotMatch(source, /uiText\("Sensitive session lock"\)/);
  assert.doesNotMatch(source, /photo-settings-passcode/);
  assert.match(privacyPanelSource, /export function PhotoPrivacySettingsPanel/);
  assert.match(privacyPanelSource, /props\.uiText\("Sensitive session lock"\)/);
  assert.match(privacyPanelSource, /props\.uiText\("Recent activity"\)/);
  assert.match(privacyPanelSource, /props\.onSettingsChange\(\{ sensitiveSessionLockMinutes:/);
  assert.match(privacyPanelSource, /props\.onSettingsChange\(\{ recentActivityRetentionDays:/);
  assert.match(privacyPanelSource, /props\.onSettingsChange\(\{ sensitiveOsAuthEnabled:/);
  assert.match(privacyPanelSource, /props\.onSaveSensitivePasscode/);
  assert.doesNotMatch(source, /photo-sensitive-lock/);
  assert.match(sensitiveLockPanelSource, /export function PhotoSensitiveLockPanel/);
  assert.match(sensitiveLockPanelSource, /photo-sensitive-lock/);
  assert.match(sensitiveLockPanelSource, /props\.uiText\("Unlock with"\)/);
  assert.match(sensitiveLockPanelSource, /props\.onUnlock\(props\.passcode\)/);
  assert.match(sensitiveLockPanelSource, /props\.onHideSensitive/);
  assert.match(source, /photoSettings\.sensitiveSessionLockMinutes/);
  assert.match(privacyPanelSource, /props\.settings\.recentActivityRetentionDays/);
  assert.match(source, /window\.setTimeout\(\(\) => \{[\s\S]{0,120}lockSensitiveCollections\(\);/);
  assert.match(source, /window\.addEventListener\("pointerdown", refreshSensitiveSessionTimer\)/);
  assert.match(source, /document\.addEventListener\("visibilitychange", onVisibilityChange\)/);
});

run("photo local settings derive per-library media defaults", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const mediaDefaultsPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoLibraryMediaDefaultsPanel.tsx"), "utf8");
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
  assert.match(source, /PhotoLibraryMediaDefaultsPanel/);
  assert.match(source, /onChange=\{updatePhotoLibraryMediaSettings\}/);
  assert.match(source, /onReset=\{resetPhotoLibraryMediaSettings\}/);
  assert.doesNotMatch(source, /photo-settings-library-media/);
  assert.match(mediaDefaultsPanelSource, /export function PhotoLibraryMediaDefaultsPanel/);
  assert.match(mediaDefaultsPanelSource, /props\.onChange\(\{ videoAutoplay:/);
  assert.match(mediaDefaultsPanelSource, /props\.onChange\(\{ pauseVideoWhenBackgrounded:/);
  assert.match(mediaDefaultsPanelSource, /props\.onChange\(\{ hdrViewing:/);
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

  const originalWindow = global.window;
  try {
    global.window = {};
    assert.strictEqual(settingsMod.browserAdvertisesPhotoHdr(), false);
    global.window = {
      matchMedia: (query) => ({ matches: query === settingsMod.PHOTO_HDR_RUNTIME_QUERIES[1] }),
    };
    assert.strictEqual(settingsMod.browserAdvertisesPhotoHdr(), true);
    global.window = {
      matchMedia: () => {
        throw new Error("unsupported");
      },
    };
    assert.strictEqual(settingsMod.browserAdvertisesPhotoHdr(), false);
  } finally {
    global.window = originalWindow;
  }
});

run("photo hdr lightbox state is wired to image and video media", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const stageSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxStage.tsx"), "utf8");
  const settingsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSettings.ts"), "utf8");
  assert.match(source, /PHOTO_HDR_RUNTIME_QUERIES/);
  assert.match(source, /browserAdvertisesPhotoHdr/);
  assert.match(settingsSource, /export const PHOTO_HDR_RUNTIME_QUERIES/);
  assert.match(settingsSource, /export function browserAdvertisesPhotoHdr/);
  assert.doesNotMatch(source, /function browserAdvertisesPhotoHdr/);
  assert.match(source, /photoHdrDisplayState\(effectivePhotoMediaSettings,\s*lightItem\?\.assetMetadata,\s*photoRuntimeHdrAvailable\)/);
  assert.match(source, /<PhotoLightboxStage[\s\S]*hdrRequestedMode=\{effectivePhotoMediaSettings\.hdrViewing\}[\s\S]*hdrDisplayState=\{lightboxHdrDisplayState\}/);
  assert.doesNotMatch(source, /photos-lightbox-hdr-badge/);
  assert.match(stageSource, /className=\{`photos-lightbox-hdr-badge \$\{hdrDisplayState\.badgeTone\}`\}/);
  assert.match(stageSource, /<video[\s\S]{0,900}data-hdr-requested=\{hdrRequestedMode\}[\s\S]{0,900}data-hdr-viewing=\{hdrDisplayState\?\.effectiveMode \|\| "standard"\}/);
  assert.match(stageSource, /<img[\s\S]{0,700}data-hdr-requested=\{hdrRequestedMode\}[\s\S]{0,700}data-hdr-viewing=\{hdrDisplayState\?\.effectiveMode \|\| "standard"\}/);
});

run("photo indexing queue labels catalog jobs without local intelligence", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const queuePanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoIndexingQueuePanel.tsx"), "utf8");
  const noticePanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoIndexingNoticePanel.tsx"), "utf8");
  const indexingSource = fs.readFileSync(path.join(ROOT, "src/views/photoIndexingStatus.ts"), "utf8");
  assert.match(source, /PhotoIndexingQueuePanel/);
  assert.match(source, /PhotoIndexingNoticePanel/);
  assert.match(queuePanelSource, /export function PhotoIndexingQueuePanel/);
  assert.match(noticePanelSource, /photo-search-index-notice/);
  assert.match(noticePanelSource, /photo-catalog-index-notice/);
  assert.match(noticePanelSource, /Search index is catching up/);
  assert.match(noticePanelSource, /Catalog refresh progress/);
  assert.match(noticePanelSource, /Run next/);
  assert.doesNotMatch(source, /photo-indexing-job-list/);
  assert.match(queuePanelSource, /photo-indexing-job-list/);
  assert.match(queuePanelSource, /jobKind === "search"[\s\S]{0,120}uiText\("Search index"\)/);
  assert.match(queuePanelSource, /jobKind === "generated_collections"[\s\S]{0,120}uiText\("Generated collections"\)/);
  assert.match(queuePanelSource, /jobKind === "smart_albums"[\s\S]{0,120}uiText\("Smart albums"\)/);
  assert.match(queuePanelSource, /jobKind === "objects"[\s\S]{0,120}uiText\("Detected items"\)/);
  assert.match(source, /photoIndexingHasRunnableCatalogJob/);
  assert.match(source, /photoIndexingHasRetryableCatalogJob/);
  assert.match(source, /photoIndexingQueueSummary\(photoIndexingQueueValue, \{/);
  assert.match(source, /photoIndexingCanRunQueuedJobs = photoIndexingQueueSummaryValue\.canRunQueuedJobs/);
  assert.match(source, /photoIndexingCanRetryFailedJobs = photoIndexingQueueSummaryValue\.canRetryFailedJobs/);
  assert.match(source, /photoActiveCatalogIndexNotice\(\{/);
  assert.match(source, /buildPhotoSearchIndexNotice\(photoSearchIndexStatus, librarySearchResult\?\.searchIndex/);
  assert.match(indexingSource, /export function photoIndexingQueueSummary/);
  assert.match(indexingSource, /export function photoActiveCatalogIndexNotice/);
  assert.match(indexingSource, /export function photoSearchIndexNotice/);
  assert.doesNotMatch(source, /const photoIndexingHasRunnableCatalogJob = photoIndexingQueueJobs\.some/);
  assert.doesNotMatch(source, /const pendingPhotoSearchIndexStatus = \(status: PhotoSearchIndexStatus/);
  assert.match(indexingSource, /PHOTO_CATALOG_JOB_KINDS = new Set\(\["search", "generated_collections", "smart_albums"\]\)/);
  assert.match(queuePanelSource, /jobKind !== "search" && jobKind !== "generated_collections" && jobKind !== "smart_albums"/);
  assert.match(source, /enqueuePhotoCatalogIndexingJob\("generated_collections"\)/);
  assert.match(source, /enqueuePhotoCatalogIndexingJob\("smart_albums"\)/);
  assert.match(source, /enqueueLoadedPhotoIndexingJob\("objects"\)/);
  assert.match(source, /enqueuePendingPhotoIndexingJob\("objects"\)/);
  assert.match(source, /runPhotoIndexingQueue\(\{ limit: 8, maxJobs: 1 \}\)/);
  assert.match(queuePanelSource, /\(requiresLocalIntelligence && !props\.localIntelligenceEnabled\)/);
  assert.doesNotMatch(queuePanelSource, /\|\| !props\.localIntelligenceEnabled[\s\S]{0,160}aria-label=\{props\.uiText\("Run local indexing queue"\)\}/);
});

run("photo indexing status helpers summarize queue catalog and search notices", () => {
  const uiText = (label) => `ui:${label}`;
  const formatCount = (value) => `#${value}`;
  const summary = indexingStatusMod.photoIndexingQueueSummary({
    queued: 3,
    counts: {
      queued: 2,
      running: 1,
      paused: 4,
      completed: 5,
      failed: 6,
      cancelled: 7,
    },
    jobs: [
      { jobId: "smart-1", jobKind: "smart_albums", status: "paused" },
      { jobId: "objects-1", jobKind: "objects", status: "queued" },
      { jobId: "generated-1", jobKind: "generated_collections", status: "failed" },
      { jobId: "search-1", jobKind: "search", status: "completed" },
      { jobId: "ocr-1", jobKind: "ocr", status: "failed" },
      { jobId: "extra", jobKind: "search", status: "queued" },
    ],
  }, {
    localIntelligenceEnabled: false,
    backgroundIndexingAutoRun: false,
    uiText,
    formatCount,
  });
  assert.strictEqual(summary.queuedCount, 3);
  assert.strictEqual(summary.runningCount, 1);
  assert.strictEqual(summary.jobs.length, 5);
  assert.strictEqual(summary.hasRunnableCatalogJob, true);
  assert.strictEqual(summary.hasRetryableCatalogJob, true);
  assert.strictEqual(summary.canRunQueuedJobs, true);
  assert.strictEqual(summary.canRetryFailedJobs, true);
  assert.strictEqual(summary.text, "ui:Queue #3 · ui:running #1 · ui:paused #4 · ui:completed #5 · ui:failed #6 · ui:cancelled #7 · ui:manual");
  const blockedSummary = indexingStatusMod.photoIndexingQueueSummary({
    queued: 1,
    jobs: [{ jobId: "objects-2", jobKind: "objects", status: "queued" }],
  }, { localIntelligenceEnabled: false, backgroundIndexingAutoRun: true, uiText, formatCount });
  assert.strictEqual(blockedSummary.hasRunnableCatalogJob, false);
  assert.strictEqual(blockedSummary.canRunQueuedJobs, false);

  const smartNotice = indexingStatusMod.photoActiveCatalogIndexNotice({
    jobs: [
      {
        jobId: "smart-1",
        jobKind: "smart_albums",
        status: "queued",
        scope: { albumId: "album:summer" },
        result: { progress: { total: 10, processed: 2, updated: 4, skipped: 1, failed: 1, deferred: 3 } },
      },
    ],
    activeJobId: "smart-1",
    activeAlbum: { id: "album:summer", kind: "album", name: "Summer", count: 8, albumKind: "smart", albumId: "summer" },
    uiText,
    formatCount,
  });
  assert.strictEqual(smartNotice.status, "running");
  assert.strictEqual(smartNotice.progressPercent, 60);
  assert.strictEqual(smartNotice.title, "ui:Smart album cache is catching up");
  assert.strictEqual(smartNotice.noticeClass, "smart-albums");
  assert.strictEqual(smartNotice.detail, "ui:Smart album: Summer · ui:running · ui:total #10 · ui:processed #2 · ui:updated #4 · ui:skipped #1 · ui:failed #1 · ui:deferred #3");

  const generatedNotice = indexingStatusMod.photoActiveCatalogIndexNotice({
    jobs: [{ jobId: "generated-1", jobKind: "generated_collections", status: "failed", error: "Generation failed" }],
    activeMemory: { id: "memory:family", kind: "memory", name: "Family Trip", count: 14 },
    uiText,
    formatCount,
  });
  assert.strictEqual(generatedNotice.status, "failed");
  assert.strictEqual(generatedNotice.title, "ui:Generated collections need queue attention");
  assert.strictEqual(generatedNotice.queueHint, "ui:Open Queue status to inspect or retry the local catalog refresh.");
  assert.strictEqual(generatedNotice.detail, "ui:Memory: Family Trip · ui:failed · Generation failed");

  const searchNotice = indexingStatusMod.photoSearchIndexNotice(
    { completed: true },
    { cold: true, pending: true, assetCount: 12, queued: true, job: { status: "queued" } },
    { uiText, formatCount },
  );
  assert.strictEqual(searchNotice.pending, true);
  assert.strictEqual(searchNotice.detail, "#12 ui:photo search rows ui:need indexing before search is complete.");
  assert.strictEqual(searchNotice.queueDetail, "ui:Search index job ui:queued.");
  const warmSearchNotice = indexingStatusMod.photoSearchIndexNotice(
    { pending: true, remainingMissingCount: 4, progress: { processed: 7 }, indexCount: 9 },
    null,
    { uiText, formatCount },
  );
  assert.strictEqual(warmSearchNotice.detail, "#4 ui:remaining · #7 ui:processed · #9 ui:indexed");
});

run("photo detected item review controls persist object tag review metadata", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const stageSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxStage.tsx"), "utf8");
  const infoDraftSource = fs.readFileSync(path.join(ROOT, "src/views/photoInfoDraft.ts"), "utf8");
  const objectTagsSource = fs.readFileSync(path.join(ROOT, "src/views/photoObjectTags.ts"), "utf8");
  assert.match(source, /from "\.\/photoObjectTags"/);
  assert.match(objectTagsSource, /export type PhotoObjectTagReviewAction = "confirmed" \| "rejected"/);
  assert.match(objectTagsSource, /export function photoObjectTagReviewRows\(item: PhotoItem\)/);
  assert.match(objectTagsSource, /export function photoDetectedLabels\(item: PhotoItem\)/);
  assert.doesNotMatch(source, /function photoDetectedLabels/);
  assert.match(objectTagsSource, /export function photoObjectTagReviewPatch\([\s\S]{0,220}action: PhotoObjectTagReviewAction \| "clear"/);
  assert.match(source, /type PhotoMetadataPatch/);
  assert.match(infoDraftSource, /objectTagReview\?: Record<string, unknown>/);
  assert.match(source, /objectTagReview: photoObjectTagReviewPatch\(item, action, row\)/);
  assert.match(source, /aria-label=\{uiText\("Detected item review"\)\}/);
  assert.match(source, /selectedObjectTagRegionId/);
  assert.match(source, /lightItemObjectTagRegionBoxes/);
  assert.doesNotMatch(source, /photos-object-tag-region/);
  assert.match(stageSource, /photos-object-tag-region/);
  assert.match(stageSource, /uiText\("Select detected item region"\)/);
  assert.match(objectTagsSource, /bounds\?: Record<string, unknown>/);
  assert.match(objectTagsSource, /function photoObjectTagReviewBoundsPatch/);
  assert.match(objectTagsSource, /function photoObjectTagUnspecifiedUnitLooksNormalized/);
  assert.doesNotMatch(objectTagsSource, /!unit && maxValue <= 1\.5/);
  assert.match(objectTagsSource, /const key = `\$\{photoObjectTagReviewKey\(source, label, boundsKey\)\}:\$\{action\}`/);
  assert.match(objectTagsSource, /const id = `\$\{source\}:\$\{entry\.label\.toLocaleLowerCase\(\)\}:\$\{boundsKey\}:\$\{entry\.action\}:review`/);
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
  assert.match(source, /uiText\("Generated caption"\)/);
  assert.match(objectTagsSource, /localVision\.tags/);
  assert.strictEqual(
    objectTagsMod.photoDetectedLabels({
      assetMetadata: {
        objectTags: ["Cat", "cat", "Dog"],
        objectTagReview: {
          entries: [{ label: "Dog", source: "object", action: "rejected" }],
        },
      },
    }),
    "Cat",
  );
  assert.strictEqual(
    objectTagsMod.photoDetectedLabels({
      assetMetadata: {
        localVision: {
          source: "vlm-qwen3-vl",
          tags: ["sailboat", "harbor", "sailboat"],
        },
      },
    }),
    "sailboat, harbor",
  );
});

run("photo object tag bounds preserve percent-space values near origin", () => {
  assert.deepStrictEqual(
    objectTagsMod.photoObjectTagBoundsPercent({ x: 1.2, y: 1.1, width: 0.4, height: 0.3 }, 100, 100),
    { x: 1.2, y: 1.1, width: 0.4, height: 0.3 },
  );
  assert.deepStrictEqual(
    objectTagsMod.photoObjectTagBoundsPercent({ x: 1.2, y: 1.1, width: 0.4, height: 0.3, unit: "percent" }, 100, 100),
    { x: 1.2, y: 1.1, width: 0.4, height: 0.3 },
  );
  assert.deepStrictEqual(
    objectTagsMod.photoObjectTagBoundsPercent({ xMin: 0.2, yMin: 0.1, xMax: 0.5, yMax: 0.4 }, 4000, 3000),
    { x: 20, y: 10, width: 30, height: 30 },
  );
  assert.deepStrictEqual(
    objectTagsMod.photoObjectTagBoundsPercent({ x: 200, y: 150, width: 400, height: 300 }, 4000, 3000),
    { x: 5, y: 5, width: 10, height: 10 },
  );
});

run("photo object tag review rows keep persisted percent review regions", () => {
  const rows = objectTagsMod.photoObjectTagReviewRows({
    width: 100,
    height: 100,
    assetMetadata: {
      objectTagReview: {
        entries: [
          {
            label: "tiny mark",
            source: "user",
            action: "confirmed",
            bounds: { x: 1.2, y: 1.1, width: 0.4, height: 0.3 },
          },
        ],
      },
    },
  });
  assert.strictEqual(rows.length, 1, rows);
  assert.deepStrictEqual(rows[0].bounds, { x: 1.2, y: 1.1, width: 0.4, height: 0.3 });
  assert.strictEqual(rows[0].userAdded, true);
});

run("photo object tag review rows keep same-label per-region reviews", () => {
  const rows = objectTagsMod.photoObjectTagReviewRows({
    width: 100,
    height: 100,
    assetMetadata: {
      objectTagReview: {
        entries: [
          {
            label: "bottle",
            source: "object",
            action: "rejected",
            bounds: { x: 10, y: 10, width: 12, height: 14, unit: "percent" },
          },
          {
            label: "bottle",
            source: "object",
            action: "rejected",
            bounds: { x: 50, y: 40, width: 11, height: 13, unit: "percent" },
          },
        ],
      },
    },
  });
  assert.strictEqual(rows.length, 2, rows);
  assert.deepStrictEqual(rows.map((row) => row.bounds), [
    { x: 10, y: 10, width: 12, height: 14 },
    { x: 50, y: 40, width: 11, height: 13 },
  ]);
  assert.deepStrictEqual(rows.map((row) => row.action), ["rejected", "rejected"]);
});

run("photo global search capped groups expose full-photo routing", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const librarySearchPanel = fs.readFileSync(path.join(ROOT, "src/views/photoLibrarySearchPanel.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(source, /function showAllLibrarySearchGroup\(group: PhotoLibrarySearchGroup\)/);
  assert.match(source, /PhotoLibrarySearchPanel/);
  assert.match(source, /onShowAllGroup=\{showAllLibrarySearchGroup\}/);
  assert.match(source, /clearAllPhotoFilters\(\)/);
  assert.match(source, /setActiveId\("all"\)/);
  assert.match(source, /handlePhotoSearchKeyDown/);
  assert.match(source, /aria-activedescendant=\{librarySearchActiveDomId\}/);
  assert.match(librarySearchPanel, /group\.id === "photos"/);
  assert.match(librarySearchPanel, /uiText\("Show all Photos"\)/);
  assert.match(librarySearchPanel, /photo-global-search-group-actions/);
  assert.match(librarySearchPanel, /item\.matchReasons/);
  assert.match(librarySearchPanel, /photo-global-search-reasons/);
  assert.match(librarySearchPanel, /photo-global-search-overflow/);
  assert.match(librarySearchPanel, /photo-global-search-item active/);
  assert.match(librarySearchPanel, /group\.estimatedTotal/);
  assert.match(typesSource, /matchReasons\?: string\[\]/);
  assert.match(typesSource, /estimatedTotal\?: boolean/);
  assert.match(styles, /\.photo-global-search-reasons/);
  assert.match(styles, /\.photo-global-search-item\.active/);
});

run("photo export color profile status preflights rendered targets", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  const exportPresetsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportPresets.ts"), "utf8");
  const exportRenderControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportRenderControls.tsx"), "utf8");
  assert.match(typesSource, /interface PhotoColorProfileStatusValue/);
  assert.match(appSource, /"photo_color_profile_status"/);
  assert.match(source, /getPhotoColorProfileStatus/);
  assert.match(source, /photoExportColorProfileStatusState\(exportColorProfileStatus, \{/);
  assert.match(source, /photoExportColorProfileValidationStatus\(/);
  assert.match(exportPresetsSource, /export function photoExportColorProfileStatusState/);
  assert.match(exportPresetsSource, /export function photoExportSelectedColorProfileStatus/);
  assert.match(exportPresetsSource, /export function photoExportColorProfileValidationStatus/);
  assert.match(exportPresetsSource, /Profile availability check failed/);
  assert.match(exportPresetsSource, /Profile available/);
  assert.match(exportPresetsSource, /Profile unavailable/);
  assert.match(exportPresetsSource, /Profile check failed/);
  assert.match(exportPresetsSource, /Profile ready/);
  assert.match(exportRenderControlsSource, /photo-export-profile-preflight/);
  assert.match(source, /ensurePhotoExportColorProfileAvailable\(exportVariant === "rendered"\)/);
  assert.match(source, /ensurePhotoExportColorProfileAvailable\(true\)/);
  assert.match(source, /photoExportSelectedColorProfileStatus\(status, exportTargetColorProfile\)/);
  assert.match(exportRenderControlsSource, /targetColorProfileValidationStatus\.text/);
  assert.doesNotMatch(source, /selected\?\.target === exportTargetColorProfile/);
  assert.doesNotMatch(source, /selectedExportColorProfileStatus\.fileName/);
  assert.doesNotMatch(source, /exportTargetColorProfileValidation\.description \|\| exportTargetColorProfileValidation\.name/);
  assert.doesNotMatch(source, /Profile will be checked before export\./);
  assert.doesNotMatch(source, /status\?\.selected \|\| status\?\.profiles/);
});

run("photo export color profile status helper formats availability state", () => {
  const uiText = (text) => `ui:${text}`;
  const availableStatus = {
    targetColorProfile: "source",
    profiles: [
      { target: "source", label: "Source", available: true, fileName: "Embedded Display P3.icc" },
      { target: "srgb", label: "sRGB", available: true, descriptionText: "Standard RGB" },
    ],
    selected: { target: "source", label: "Source", available: true, fileName: "Embedded Display P3.icc" },
  };
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(availableStatus, {
      exportVariant: "original",
      loading: false,
      error: "",
      target: "source",
      uiText,
    }),
    {
      selected: availableStatus.selected,
      text: "",
      tone: "ok",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(availableStatus, {
      exportVariant: "rendered",
      loading: true,
      error: "",
      target: "source",
      uiText,
    }),
    {
      selected: availableStatus.selected,
      text: "ui:Checking profile availability...",
      tone: "ok",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(availableStatus, {
      exportVariant: "rendered",
      loading: false,
      error: "",
      target: "source",
      uiText,
    }),
    {
      selected: availableStatus.selected,
      text: "ui:Profile available: Embedded Display P3.icc",
      tone: "ok",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(availableStatus, {
      exportVariant: "rendered",
      loading: false,
      error: "backend down",
      target: "source",
      uiText,
    }),
    {
      selected: availableStatus.selected,
      text: "ui:Profile availability check failed: backend down",
      tone: "error",
    },
  );

  const fallbackStatus = {
    targetColorProfile: "srgb",
    profiles: [
      { target: "source", label: "Source", available: true },
      { target: "srgb", label: "sRGB", available: false, error: "sRGB profile missing" },
    ],
    selected: { target: "source", label: "Source", available: true },
  };
  assert.strictEqual(exportPresetsMod.photoExportSelectedColorProfileStatus(fallbackStatus, "srgb"), fallbackStatus.profiles[1]);
  assert.strictEqual(exportPresetsMod.photoExportSelectedColorProfileStatus(fallbackStatus, "display-p3"), null);
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(fallbackStatus, {
      exportVariant: "rendered",
      loading: false,
      error: "",
      target: "srgb",
      uiText,
    }),
    {
      selected: fallbackStatus.profiles[1],
      text: "ui:Profile unavailable: sRGB profile missing",
      tone: "error",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileStatusState(null, {
      exportVariant: "rendered",
      loading: false,
      error: "",
      target: "display-p3",
      uiText,
    }),
    {
      selected: null,
      text: "ui:Profile availability will be checked before export.",
      tone: "",
    },
  );

  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileValidationStatus({
      ok: true,
      path: "/profiles/p3.icc",
      fileName: "p3.icc",
      bytes: 2048,
      description: "Display P3 profile",
    }, {
      uiText,
      formatBytes: (bytes) => `${bytes / 1024} KB`,
    }),
    {
      text: "ui:Profile ready: Display P3 profile · 2 KB",
      tone: "ok",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileValidationStatus({
      ok: true,
      path: "/profiles/named.icc",
      fileName: "named.icc",
      bytes: 1024,
      name: "Named profile",
    }, {
      uiText,
      formatBytes: (bytes) => `${bytes} bytes`,
    }),
    {
      text: "ui:Profile ready: Named profile · 1024 bytes",
      tone: "ok",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileValidationStatus(null, {
      profilePath: " /profiles/custom.icc ",
      uiText,
    }),
    {
      text: "ui:Profile will be checked before export.",
      tone: "",
    },
  );
  assert.deepStrictEqual(
    exportPresetsMod.photoExportColorProfileValidationStatus({
      ok: true,
      path: "/profiles/p3.icc",
      fileName: "p3.icc",
      bytes: 2048,
    }, {
      error: "Unsupported ICC version",
      uiText,
    }),
    {
      text: "ui:Profile check failed: Unsupported ICC version",
      tone: "error",
    },
  );
  assert.strictEqual(exportPresetsMod.photoExportColorProfileValidationStatus(null, { uiText }), null);
});

run("photo selection export result helpers classify success and shareability", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const helperSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionExportResults.ts"), "utf8");
  const resultPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportResultPanel.tsx"), "utf8");
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowSucceeded("copied"), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowSucceeded("rendered_video_edit"), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowSucceeded("copied_original_render_fallback_jpeg"), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowSucceeded("missing"), false);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowSucceeded(""), false);

  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered",
    targetPath: "/exports/photo.jpg",
    renderFormat: "JPEG",
  }), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered_raw_proxy_edit",
    targetPath: "/exports/photo.tiff",
    renderFormat: "tiff",
  }), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered",
    targetPath: "/exports/photo.gif",
    renderFormat: "gif",
  }), false);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered",
    targetPath: "/exports/photo.jpg",
    renderFormat: "jpeg",
    videoRenderFormat: "mp4",
  }), false);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered_video_edit",
    targetPath: "/exports/movie.mov",
    renderFormat: "jpeg",
    videoRenderFormat: "MOV",
  }), true);
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportRowIsStripLocationShareable({
    result: "rendered_video",
    targetPath: "",
    videoRenderFormat: "mp4",
  }), false);

  const issues = selectionExportResultsMod.photoSelectionExportIssueRows({
    items: [
      { sourcePath: "/a.jpg", targetPath: "/out/a.jpg", result: "copied" },
      { sourcePath: "/b.jpg", targetPath: "", result: "missing" },
      { sourcePath: "/c.jpg", targetPath: "/out/c.jpg", result: "copied_original_render_fallback_png" },
      { sourcePath: "/d.jpg", targetPath: "", result: "" },
      { sourcePath: "/e.jpg", targetPath: "/out/e.jpg", result: "copied_original_render_fallback_png", contentCredentialFailure: "Signing failed" },
    ],
  });
  assert.deepStrictEqual(issues.map((row) => row.sourcePath), ["/b.jpg", "/d.jpg", "/e.jpg"]);
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportIssueRows(null), []);
  const successRows = selectionExportResultsMod.photoSelectionExportSuccessRows({
    items: [
      { sourcePath: "/a.jpg", targetPath: "/out/a.jpg", result: "copied" },
      { sourcePath: "/b.jpg", targetPath: "", result: "missing" },
      { sourcePath: "/c.jpg", targetPath: "/out/c.jpg", result: "rendered_video_edit" },
      { sourcePath: "/d.jpg", targetPath: "", result: "" },
    ],
  });
  assert.deepStrictEqual(successRows.map((row) => row.sourcePath), ["/a.jpg", "/c.jpg"]);
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportSuccessRows(null), []);
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportTargetPaths({
    items: [
      { sourcePath: "/a.jpg", targetPath: " /out/a.jpg ", result: "copied" },
      { sourcePath: "/b.jpg", targetPath: "", result: "missing" },
      { sourcePath: "/c.jpg", targetPath: "/out/a.jpg", result: "rendered" },
      { sourcePath: "/d.jpg", targetPath: "/out/d.jpg", result: "missing" },
    ],
  }), ["/out/a.jpg", "/out/d.jpg"]);
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportTargetPaths(null), []);
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportMetricCounts({
    counts: {
      copied: 2,
      moved: 3,
      rendered: 4,
      metadata: 5,
      xmp: 6,
      existingSidecars: 7,
      skipped: 8,
      contentCredentialsSigned: 3,
      contentCredentialsPreserved: 2,
      contentCredentialsFailed: 1,
    },
  }, 9), {
    written: 5,
    rendered: 4,
    sidecars: 18,
    skipped: 8,
    needsAttention: 9,
    credentialsSigned: 3,
    credentialsPreserved: 2,
    credentialsFailed: 1,
  });
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportMetricCounts(null, -4), {
    written: 0,
    rendered: 0,
    sidecars: 0,
    skipped: 0,
    needsAttention: 0,
    credentialsSigned: 0,
    credentialsPreserved: 0,
    credentialsFailed: 0,
  });
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportRowSummary({
    sourcePath: " /photos/family-vacation-long-name.jpg ",
    targetPath: " /exports/family-vacation-long-name.jpg ",
    result: " rendered ",
  }, {
    uiText: (value) => value,
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
    shortText: (value) => `short:${value}`,
  }), {
    sourceLabel: "family-vacation-long-name.jpg",
    sourceTitle: "/photos/family-vacation-long-name.jpg",
    resultLabel: "rendered",
    targetLabel: "short:/exports/family-vacation-long-name.jpg",
    targetTitle: "/exports/family-vacation-long-name.jpg",
    hasTarget: true,
  });
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportRowSummary({
    sourcePath: "",
    targetPath: "",
    result: "",
  }, {
    uiText: (value) => value,
  }), {
    sourceLabel: "",
    sourceTitle: "",
    resultLabel: "Unknown result",
    targetLabel: "No output file",
    targetTitle: undefined,
    hasTarget: false,
  });
  const panelState = selectionExportResultsMod.photoSelectionExportPanelState({
    counts: {
      copied: 4,
      moved: 1,
      rendered: 2,
      metadata: 1,
      xmp: 1,
      skipped: 3,
    },
    items: [
      { sourcePath: "/ok-1.jpg", targetPath: "/out/ok-1.jpg", result: "copied" },
      { sourcePath: "/bad-1.jpg", targetPath: "", result: "missing" },
      { sourcePath: "/ok-2.jpg", targetPath: "/out/ok-2.jpg", result: "rendered" },
      { sourcePath: "/bad-2.jpg", targetPath: "", result: "" },
      { sourcePath: "/ok-3.jpg", targetPath: "/out/ok-3.jpg", result: "copied_original_render_fallback_jpeg" },
    ],
  }, 1);
  assert.deepStrictEqual(panelState.visibleIssueRows.map((row) => row.sourcePath), ["/bad-1.jpg"]);
  assert.deepStrictEqual(panelState.visibleSuccessRows.map((row) => row.sourcePath), ["/ok-1.jpg"]);
  assert.strictEqual(panelState.issueOverflowCount, 1);
  assert.strictEqual(panelState.successOverflowCount, 2);
  assert.strictEqual(panelState.statusClass, "warning");
  assert.strictEqual(panelState.role, "alert");
  assert.deepStrictEqual(panelState.metrics, {
    written: 5,
    rendered: 2,
    sidecars: 2,
    skipped: 3,
    needsAttention: 2,
    credentialsSigned: 0,
    credentialsPreserved: 0,
    credentialsFailed: 0,
  });
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportPanelState(null).statusClass, "ok");
  assert.strictEqual(selectionExportResultsMod.photoSelectionExportPanelState(null).role, "status");

  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionShareDraft([" /a.jpg ", "/a.jpg", "", "/b.jpg"]), {
    sourcePathsForEvent: ["/a.jpg", "/b.jpg"],
    pathsForShare: ["/a.jpg", "/b.jpg"],
    strippedLocation: false,
    skippedCount: 0,
    shareAction: "native_share",
    fallbackAction: "share_fallback_reveal",
  });
  const stripShareDraft = selectionExportResultsMod.photoSelectionShareDraft(["/a.jpg", "/b.jpg", "/c.mov"], {
    items: [
      { sourcePath: "/a.jpg", targetPath: " /safe/a.jpg ", result: "rendered", renderFormat: "jpeg" },
      { sourcePath: "/b.jpg", targetPath: "/safe/b.gif", result: "rendered", renderFormat: "gif" },
      { sourcePath: "/c.mov", targetPath: "/safe/c.mov", result: "rendered_video_edit", videoRenderFormat: "mov" },
      { sourcePath: "/c.mov", targetPath: "/safe/c.mov", result: "rendered_video_edit", videoRenderFormat: "mov" },
    ],
  });
  assert.deepStrictEqual(stripShareDraft, {
    sourcePathsForEvent: ["/a.jpg", "/c.mov"],
    pathsForShare: ["/safe/a.jpg", "/safe/c.mov"],
    strippedLocation: true,
    skippedCount: 1,
    shareAction: "native_share_strip_location",
    fallbackAction: "share_fallback_reveal_strip_location",
  });
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionShareEventMetadata(stripShareDraft, { shared: true }), {
    surface: "photos-bulk-bar",
    action: "native_share_strip_location",
    strippedLocation: true,
    targetCount: 2,
    skippedCount: 1,
  });
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionShareEventMetadata(stripShareDraft, { shared: false }, " custom-surface "), {
    surface: "custom-surface",
    action: "share_fallback_reveal_strip_location",
    strippedLocation: true,
    targetCount: 2,
    skippedCount: 1,
  });
  const detailItems = selectionExportResultsMod.photoSelectionExportRowDetailItems({
    result: "rendered_video_edit",
    sourcePath: " /src/family.mov ",
    targetPath: " /exports/family.mov ",
    metadataPath: "/exports/family.json",
    xmpPath: "/exports/family.xmp",
    existingSidecarPaths: [" /side/a.xmp ", "", "/side/b.aae"],
    exportVariant: "rendered",
    renderFormat: "jpeg",
    videoRenderQuality: "high",
    videoTrimStartMs: 1000,
    videoTrimEndMs: 3000,
    videoRotateDegrees: 90,
    videoCropAspect: "16:9",
    videoEditSummary: "Trimmed",
    videoEditTimeline: "Clip 1",
    videoEditTransform: "Rotated",
    videoEditRender: "H.264",
    videoTransformApplied: true,
    targetColorProfile: "display-p3",
    targetColorProfilePath: "/profiles/p3.icc",
    editStackId: "stack-1",
    rawRenderProxyPath: "/exports/family-proxy.jpg",
    contentCredentialStatus: "signed",
    contentCredentials: {
      present: true,
      embedded: true,
      cryptographicallyValid: true,
      locallyTrusted: true,
      globallyTrusted: false,
      trustScope: "workspace-local",
      timestamped: false,
      validationState: "Trusted",
      manifestId: "urn:c2pa:test",
      containsAiHistory: true,
      topLevelAiEdit: false,
      ingredientCount: 1,
      assetSha256: "a".repeat(64),
    },
  }, {
    uiText: (value) => value,
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
    shortText: (value) => `short:${value}`,
    formatCount: (value) => `${value} items`,
    formatDuration: (value) => `${value / 1000}s`,
  });
  const detailByLabel = new Map(detailItems.map((item) => [item.label, item]));
  assert.deepStrictEqual(detailByLabel.get("Source"), { label: "Source", value: "family.mov", title: "/src/family.mov" });
  assert.deepStrictEqual(detailByLabel.get("Target"), { label: "Target", value: "family.mov", title: "/exports/family.mov" });
  assert.deepStrictEqual(detailByLabel.get("Existing sidecars"), { label: "Existing sidecars", value: "2 items", title: "/side/a.xmp\n/side/b.aae" });
  assert.strictEqual(detailByLabel.get("Video trim")?.value, "1s-3s");
  assert.strictEqual(detailByLabel.get("Video rotation")?.value, "90");
  assert.strictEqual(detailByLabel.get("Video crop")?.value, "16:9");
  assert.strictEqual(detailByLabel.get("Video transform")?.value, "Applied");
  assert.deepStrictEqual(detailByLabel.get("Profile file"), { label: "Profile file", value: "p3.icc", title: "/profiles/p3.icc" });
  assert.strictEqual(detailByLabel.get("Content Credentials")?.value, "Signed");
  assert.strictEqual(detailByLabel.get("Credential trust")?.value, "Workspace-local trust");
  assert.strictEqual(detailByLabel.get("AI history")?.value, "AI edit in ingredient history");
  assert.deepStrictEqual(selectionExportResultsMod.photoSelectionExportRowDetailItems({ result: "" }, { uiText: (value) => value }).slice(0, 2), [
    { label: "Result", value: "Unknown result" },
    { label: "Target", value: "No target was written." },
  ]);

  assert.match(photosViewSource, /from "\.\/photoSelectionExportResults"/);
  assert.match(photosViewSource, /from "\.\/photoExportResultPanel"/);
  assert.match(photosViewSource, /<PhotoExportResultPanel/);
  assert.doesNotMatch(photosViewSource, /function photoSelectionExportRowSucceeded/);
  assert.doesNotMatch(photosViewSource, /photoSelectionExportRowSucceeded/);
  assert.doesNotMatch(photosViewSource, /photoSelectionExportRowIsStripLocationShareable/);
  assert.doesNotMatch(photosViewSource, /rows\.filter\(\(row\) => photoSelectionExportRowSucceeded\(row\.result\)\)/);
  assert.doesNotMatch(photosViewSource, /new Set\(\(result\.items \|\| \[\]\)\.map\(\(item\) => String\(item\.targetPath/);
  assert.doesNotMatch(photosViewSource, /\(lastPhotoSelectionExport\.counts\.copied \|\| 0\) \+ \(lastPhotoSelectionExport\.counts\.moved \|\| 0\)/);
  assert.doesNotMatch(photosViewSource, /\(lastPhotoSelectionExport\.counts\.metadata \|\| 0\) \+ \(lastPhotoSelectionExport\.counts\.xmp \|\| 0\)/);
  assert.doesNotMatch(photosViewSource, /fileName\(row\.sourcePath\) \|\| shortText\(row\.sourcePath\)/);
  assert.doesNotMatch(photosViewSource, /row\.result \|\| uiText\("Unknown result"\)/);
  assert.doesNotMatch(photosViewSource, /row\.targetPath \? <small title=\{row\.targetPath\}>\{shortText\(row\.targetPath\)\}<\/small>/);
  assert.doesNotMatch(photosViewSource, /lastPhotoSelectionExportIssueRows/);
  assert.doesNotMatch(photosViewSource, /lastPhotoSelectionExportSuccessRows/);
  assert.doesNotMatch(photosViewSource, /lastPhotoSelectionExportMetrics/);
  assert.doesNotMatch(photosViewSource, /lastPhotoSelectionExportIssueRows\.length \? "warning" : "ok"/);
  assert.doesNotMatch(photosViewSource, /native_share_strip_location/);
  assert.doesNotMatch(photosViewSource, /const shareableRows =/);
  assert.doesNotMatch(photosViewSource, /lastPhotoSelectionExportPanel/);
  assert.doesNotMatch(photosViewSource, /photoSelectionExportPanelState\(lastPhotoSelectionExport\)/);
  assert.doesNotMatch(photosViewSource, /buildPhotoSelectionExportRowDetailItems/);
  assert.doesNotMatch(photosViewSource, /buildPhotoSelectionExportRowSummary/);
  assert.doesNotMatch(photosViewSource, /const summary = photoSelectionExportRowSummary\(row\)/);
  assert.doesNotMatch(photosViewSource, /photo-export-result-row-details/);
  assert.doesNotMatch(photosViewSource, /photo-export-result-success-details/);
  assert.doesNotMatch(photosViewSource, /uiText\("Last export"\)/);
  assert.doesNotMatch(photosViewSource, /uiText\("Reveal export"\)/);
  assert.doesNotMatch(photosViewSource, /uiText\("Written files"\)/);
  assert.doesNotMatch(photosViewSource, /function photoSelectionExportRowDetailItems/);
  assert.match(photosViewSource, /photoSelectionExportTargetPaths\(result\)/);
  assert.match(photosViewSource, /photoSelectionShareDraft\(selectedSourcePaths/);
  assert.match(photosViewSource, /metadata: photoSelectionShareEventMetadata\(shareDraft, result\)/);
  assert.match(resultPanelSource, /export function PhotoExportResultPanel/);
  assert.match(resultPanelSource, /photoSelectionExportPanelState\(result\)/);
  assert.match(resultPanelSource, /photoSelectionExportRowDetailItems\(row, \{/);
  assert.match(resultPanelSource, /photoSelectionExportRowSummary\(row, \{ uiText, fileName, shortText \}\)/);
  assert.match(resultPanelSource, /panel\.visibleIssueRows\.map/);
  assert.match(resultPanelSource, /panel\.visibleSuccessRows\.map/);
  assert.match(resultPanelSource, /panel\.issueOverflowCount/);
  assert.match(resultPanelSource, /photo-export-result-row-details/);
  assert.match(resultPanelSource, /photo-export-result-success-details/);
  assert.match(resultPanelSource, /uiText\("Last export"\)/);
  assert.match(resultPanelSource, /uiText\("Reveal export"\)/);
  assert.match(resultPanelSource, /uiText\("Reveal manifest"\)/);
  assert.match(resultPanelSource, /uiText\("Dismiss export result"\)/);
  assert.match(resultPanelSource, /uiText\("Export details"\)/);
  assert.match(resultPanelSource, /uiText\("Written files"\)/);
  assert.match(resultPanelSource, /uiText\("All selected files were written\."\)/);
  assert.match(helperSource, /export function photoSelectionExportRowSucceeded/);
  assert.match(helperSource, /export function photoSelectionExportMetricCounts/);
  assert.match(helperSource, /export function photoSelectionExportPanelState/);
  assert.match(helperSource, /export function photoSelectionExportRowSummary/);
  assert.match(helperSource, /export function photoSelectionExportSuccessRows/);
  assert.match(helperSource, /export function photoSelectionExportTargetPaths/);
  assert.match(helperSource, /export function photoSelectionExportRowDetailItems/);
  assert.match(helperSource, /export function photoSelectionShareDraft/);
  assert.match(helperSource, /export function photoSelectionShareEventMetadata/);
});

run("photo operation detail helpers summarize undo payloads and affected rows", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const operationDetailsSource = fs.readFileSync(path.join(ROOT, "src/views/photoOperationDetails.ts"), "utf8");
  const operationUndoPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoOperationUndoPanel.tsx"), "utf8");
  const makeOperation = (overrides = {}) => ({
    operationId: "op",
    operationType: "other",
    label: "",
    affectedCount: 1,
    createdAt: "",
    undoneAt: "",
    canUndo: false,
    payload: {},
    undoPayload: {},
    ...overrides,
  });
  const details = operationDetailsMod.photoOperationDetailItems({
    operationId: "op-1",
    operationType: "person_label_correction",
    label: "Corrected person labels",
    affectedCount: 0,
    createdAt: "2026-07-09T12:00:00Z",
    undoneAt: "",
    canUndo: true,
    payload: {
      sourcePath: "/fallback/source.jpg",
      personName: "Ada",
      oldPersonName: "A. Lovelace",
      newPersonName: "Ada Lovelace",
      references: 2,
      candidates: 3,
      photoPeopleRows: 4,
      mergedIntoExisting: false,
      affectedRows: [
        { kind: "reference", sourcePath: " /refs/ada.jpg ", status: "updated", score: 0.876 },
        { kind: "review", candidateId: "cand-1", status: "blocked" },
        { kind: "photo_index", assetId: "asset-2", score: 0.2 },
        { kind: "other", refId: "ref-3" },
      ],
      affectedRowsTotal: 6,
      statusBefore: "pending",
      statusAfter: "accepted",
      bandBefore: "review",
      bandAfter: "strong",
      blockedRows: 5,
    },
    undoPayload: {
      items: [
        { sourcePath: " /photos/source-a.jpg ", targetPath: " /trash/source-a.jpg ", assetId: "asset-very-long-id-123456" },
        { sourcePath: "/photos/source-b.jpg" },
      ],
    },
  }, {
    uiText: (value) => value,
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
    shortText: (value) => `short:${value}`,
    formatCount: (value) => `${value} rows`,
    formatDateText: (value) => `date:${value}`,
  });
  const byLabel = new Map(details.map((item) => [item.label, item]));
  assert.deepStrictEqual(byLabel.get("Type"), { label: "Type", value: "person_label_correction" });
  assert.deepStrictEqual(byLabel.get("Affected"), { label: "Affected", value: "2 rows" });
  assert.deepStrictEqual(byLabel.get("Created"), { label: "Created", value: "date:2026-07-09T12:00:00Z", title: "2026-07-09T12:00:00Z" });
  assert.deepStrictEqual(byLabel.get("Source"), { label: "Source", value: "source-a.jpg", title: "/photos/source-a.jpg" });
  assert.deepStrictEqual(byLabel.get("Target"), { label: "Target", value: "source-a.jpg", title: "/trash/source-a.jpg" });
  assert.deepStrictEqual(byLabel.get("Asset"), { label: "Asset", value: "short:asset-very-long-id-123456", title: "asset-very-long-id-123456" });
  assert.strictEqual(byLabel.get("Merged into existing")?.value, "No");
  assert.deepStrictEqual(byLabel.get("Affected reference 1"), { label: "Affected reference 1", value: "ada.jpg · updated · 88%", title: "/refs/ada.jpg" });
  assert.deepStrictEqual(byLabel.get("Affected review 2"), { label: "Affected review 2", value: "cand-1 · blocked", title: undefined });
  assert.strictEqual(byLabel.get("Affected photo index 3")?.value, "asset-2 · 20%");
  assert.strictEqual(byLabel.get("More affected rows")?.value, "2 rows");
  assert.strictEqual(byLabel.get("Status")?.value, "pending -> accepted");
  assert.strictEqual(byLabel.get("Band")?.value, "review -> strong");
  assert.strictEqual(byLabel.get("Blocked rows")?.value, "5 rows");
  assert.strictEqual(byLabel.get("More items")?.value, "1 rows");

  const latestUndoable = operationDetailsMod.photoLatestUndoableOperation([
    makeOperation({ operationId: "not-undoable", canUndo: false }),
    makeOperation({ operationId: "first-undoable", canUndo: true }),
    makeOperation({ operationId: "second-undoable", canUndo: true }),
  ]);
  assert.strictEqual(latestUndoable?.operationId, "first-undoable");
  assert.strictEqual(operationDetailsMod.photoLatestUndoableOperation([
    makeOperation({ operationId: "not-undoable", canUndo: false }),
  ]), null);

  const reviewOperations = Array.from({ length: 8 }, (_, index) => makeOperation({
    operationId: `review-${index}`,
    operationType: "review_candidate_decision",
  }));
  const mixedOperations = [
    makeOperation({ operationId: "other-before", operationType: "trash" }),
    ...reviewOperations,
    makeOperation({ operationId: "other-after", operationType: "person_label_merge" }),
  ];
  assert.deepStrictEqual(
    operationDetailsMod.photoRecentReviewDecisionOperations(mixedOperations).map((operation) => operation.operationId),
    ["review-0", "review-1", "review-2", "review-3", "review-4", "review-5"]
  );
  assert.deepStrictEqual(
    operationDetailsMod.photoRecentReviewDecisionOperations(mixedOperations, 3).map((operation) => operation.operationId),
    ["review-0", "review-1", "review-2"]
  );
  assert.deepStrictEqual(operationDetailsMod.photoRecentReviewDecisionOperations(mixedOperations, 0), []);
  assert.deepStrictEqual(operationDetailsMod.photoReviewDecisionOperationRow(makeOperation({
    operationId: "review-row",
    operationType: "review_candidate_decision",
    createdAt: "2026-07-09T12:34:00Z",
    canUndo: true,
    payload: {
      sourcePath: "/photos/ada/source.jpg",
      personName: "Ada",
      statusBefore: "pending",
      statusAfter: "accepted",
      scoreAfter: 0.616,
      qualityBefore: 0.481,
    },
  }), {
    uiText: (value) => value,
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
  }), {
    operationId: "review-row",
    personName: "Ada",
    detailText: "source.jpg · Needs review -> Accepted · score 62% · quality 48% · Undoable",
    createdAt: "2026-07-09T12:34:00Z",
  });
  assert.deepStrictEqual(operationDetailsMod.photoReviewDecisionOperationRow(makeOperation({
    operationId: "review-fallback",
    operationType: "review_candidate_decision",
    createdAt: "",
    canUndo: false,
    payload: {
      sourceFilename: "named-source.heic",
      statusAfter: "uncertain",
      scoreBefore: 0.334,
    },
  }), {
    uiText: (value) => value,
    fileName: () => "should-not-win.jpg",
  }), {
    operationId: "review-fallback",
    personName: "Unknown person",
    detailText: "named-source.heic · unknown -> Not sure · score 33% · Undone",
    createdAt: "",
  });

  assert.doesNotMatch(photosViewSource, /function photoOperationDetailItems/);
  assert.doesNotMatch(photosViewSource, /buildPhotoOperationDetailItems/);
  assert.doesNotMatch(photosViewSource, /photo-operation-details/);
  assert.doesNotMatch(photosViewSource, /uiText\("Action details"\)/);
  assert.match(photosViewSource, /from "\.\/photoOperationUndoPanel"/);
  assert.match(photosViewSource, /<PhotoOperationUndoPanel/);
  assert.match(photosViewSource, /photoLatestUndoableOperation\(photoOperations\)/);
  assert.match(photosViewSource, /photoRecentReviewDecisionOperations\(photoOperations\)/);
  assert.doesNotMatch(photosViewSource, /photoOperations\.find\(\(operation\) => operation\.canUndo\)/);
  assert.doesNotMatch(photosViewSource, /photoOperations\.filter\(\(operation\) => operation\.operationType === "review_candidate_decision"\)\.slice\(0, 6\)/);
  assert.match(photosViewSource, /photoReviewDecisionOperationRow\(operation, \{ uiText, fileName \}\)/);
  assert.doesNotMatch(photosViewSource, /const sourceName = String\(payload\.sourceFilename \|\| ""\) \|\| fileName\(sourcePath\)/);
  assert.doesNotMatch(photosViewSource, /payload\.scoreAfter \?\? payload\.scoreBefore/);
  assert.doesNotMatch(photosViewSource, /operation\.canUndo \? uiText\("Undoable"\) : uiText\("Undone"\)/);
  assert.match(photosViewSource, /from "\.\/photoOperationDetails"/);
  assert.match(operationUndoPanelSource, /export function PhotoOperationUndoPanel/);
  assert.match(operationUndoPanelSource, /photoOperationDetailItems\(operation, \{/);
  assert.match(operationUndoPanelSource, /photo-operation-details/);
  assert.match(operationUndoPanelSource, /uiText\("Action details"\)/);
  assert.match(operationUndoPanelSource, /uiText\("Photo action recorded"\)/);
  assert.match(operationUndoPanelSource, /uiText\("Could not load photo undo history"\)/);
  assert.doesNotMatch(operationUndoPanelSource, /const payload = operation\.payload/);
  assert.doesNotMatch(operationUndoPanelSource, /affectedRows\.slice\(0, 6\)/);
  assert.match(operationDetailsSource, /export function photoOperationDetailItems/);
  assert.match(operationDetailsSource, /export function photoLatestUndoableOperation/);
  assert.match(operationDetailsSource, /export function photoRecentReviewDecisionOperations/);
  assert.match(operationDetailsSource, /export function photoReviewDecisionOperationRow/);
});

run("managed root profile rename controls persist through settings", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const managedRootsPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoManagedRootsPanel.tsx"), "utf8");
  const railImportControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailImportControls.tsx"), "utf8");
  const settingsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSettings.ts"), "utf8");
  const storageSource = fs.readFileSync(path.join(ROOT, "src/views/photoViewStorage.ts"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(source, /managedRootRenameDrafts/);
  assert.match(source, /function renameManagedPhotoRootProfile\(profile: PhotoManagedRootProfile, draftName: string\)/);
  assert.match(source, /PhotoManagedRootsPanel/);
  assert.doesNotMatch(source, /uiText\("Profile name"\)/);
  assert.doesNotMatch(source, /uiText\("Rename managed root profile"\)/);
  assert.match(managedRootsPanelSource, /export function PhotoManagedRootsPanel/);
  assert.match(managedRootsPanelSource, /props\.uiText\("Profile name"\)/);
  assert.match(managedRootsPanelSource, /props\.uiText\("Rename managed root profile"\)/);
  assert.match(managedRootsPanelSource, /photoManagedRootPolicyDefaults\(row\.profile\)/);
  assert.match(managedRootsPanelSource, /props\.onManagedPolicyChange\(row\.profile, \{ keepFolderOrganizationDefault:/);
  assert.match(managedRootsPanelSource, /props\.onManagedPolicyChange\(row\.profile, \{ externalBackupCovered:/);
  assert.match(managedRootsPanelSource, /props\.onSetLibraryScope/);
  assert.match(source, /managedRootPolicy:[\s\S]{0,240}name: nextName/);
  assert.match(source, /policy: photoManagedRootPolicyDefaults\(profile\)/);
  assert.match(source, /findPhotoManagedRootProfile\(result\.value \|\| null, profilePath\)/);
  assert.match(settingsSource, /export function photoManagedRootPolicyDefaults/);
  assert.match(settingsSource, /export function findPhotoManagedRootProfile/);
  assert.doesNotMatch(source, /function photoManagedRootPolicyDefaults/);
  assert.doesNotMatch(source, /function findPhotoManagedRootProfile/);
  assert.match(storageSource, /PHOTO_ACTIVE_LIBRARY_ROOT_PROFILE_ID_KEY = "vintrace\.photos\.activeLibraryRootProfileId"/);
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
  assert.doesNotMatch(source, /uiText\("Library view roots"\)/);
  assert.match(managedRootsPanelSource, /props\.uiText\("Library view roots"\)/);
  assert.match(source, /onLibraryScopeChange=\{setPhotoLibraryScope\}/);
  assert.match(railImportControlsSource, /aria-label=\{props\.uiText\("Library view scope"\)\}/);
  assert.match(railImportControlsSource, /props\.onLibraryScopeChange\(selected\?\.path \|\| "", selected\?\.profileId \|\| ""\)/);
  assert.match(source, /buildPhotoLibraryRootProfileRows\(photoLibraryProfile, \{/);
  assert.match(source, /buildPhotoLibraryViewOptions\(managedRootProfileRows, libraryRootProfileRows, \{ activeLibraryRoot, text: uiText \}\)/);
  assert.match(source, /photoActiveLibraryScopeValue\(libraryViewOptions, activeLibraryRoot, activeLibraryRootProfileId\)/);
  assert.match(source, /photoActiveLibraryRootLabel\(activeLibraryRoot, managedRootProfileRows, libraryRootProfileRows, \{ text: uiText \}\)/);
  assert.match(source, /photoManagedRootCoverageByPath\(photoBackupPolicyStatus\)/);
  assert.match(settingsSource, /export function buildPhotoLibraryRootProfileRows/);
  assert.match(settingsSource, /profile\.assetCount/);
  assert.match(settingsSource, /profile\.policyWarnings/);
  assert.match(settingsSource, /profile\.rootConflictMessage/);
  assert.match(settingsSource, /rootConflictBadgeLabel\(rootConflictKind\)/);
  assert.match(settingsSource, /photoSettingsText\(options, "Available library folder\."\)/);
  assert.doesNotMatch(source, /const policyWarnings = \[\.\.\.\(profile\.policyWarnings \|\| \[\]\)\]/);
  assert.doesNotMatch(source, /rootConflictKind === "nested" \|\| rootConflictKind === "overlap"/);
  assert.doesNotMatch(source, /label: `\$\{formatCount\(assetCount\)\} \$\{uiText\(assetCount === 1 \? "photo" : "photos"\)\}`/);
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
  const pendingReviewSource = fs.readFileSync(path.join(ROOT, "src/views/photoPendingImportReviewPanel.tsx"), "utf8");
  const railImportControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailImportControls.tsx"), "utf8");
  const storageSource = fs.readFileSync(path.join(ROOT, "src/views/photoViewStorage.ts"), "utf8");
  assert.match(storageSource, /PHOTO_IMPORT_MANAGED_ROOT_KEY = "vintrace\.photos\.importManagedRoot"/);
  assert.match(source, /importManagedRoot/);
  assert.match(source, /effectiveImportManagedRoot/);
  assert.match(source, /onImportManagedRootChange=\{setImportManagedRootPreference\}/);
  assert.match(source, /managedRoot: effectiveImportManagedRoot/);
  assert.match(source, /managedRootLabel=\{importManagedRootLabel\}/);
  assert.match(railImportControlsSource, /props\.uiText\("Copy destination"\)/);
  assert.match(railImportControlsSource, /props\.onImportManagedRootChange\(event\.currentTarget\.value\)/);
  assert.match(pendingReviewSource, /props\.uiText\("Destination"\)[\s\S]{0,80}props\.managedRootLabel/);
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
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const playbackPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoMediaPlaybackSettingsPanel.tsx"), "utf8");
  const intelligencePanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoIntelligenceSettingsPanel.tsx"), "utf8");
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
  assert.match(source, /PhotoMediaPlaybackSettingsPanel/);
  assert.match(source, /settings=\{photoSettings\}/);
  assert.match(source, /onChange=\{updatePhotoLocalSettings\}/);
  assert.doesNotMatch(source, /Pause video when backgrounded/);
  assert.match(playbackPanelSource, /export function PhotoMediaPlaybackSettingsPanel/);
  assert.match(playbackPanelSource, /props\.onChange\(\{ videoAutoplay:/);
  assert.match(playbackPanelSource, /props\.onChange\(\{ pauseVideoWhenBackgrounded:/);
  assert.match(playbackPanelSource, /props\.onChange\(\{ hdrViewing:/);
  assert.match(source, /PhotoIntelligenceSettingsPanel/);
  assert.match(source, /petRecognitionStatusText=\{photoPetRecognitionStatusText\}/);
  assert.match(source, /petRecognitionWarn=\{Boolean\(photoPetRecognitionStatus\?\.modelRequested && !photoPetRecognitionStatus\.modelEnabled\)\}/);
  assert.doesNotMatch(source, /Pet model recognition/);
  assert.match(intelligencePanelSource, /export function PhotoIntelligenceSettingsPanel/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ localIntelligenceEnabled:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ noNetworkIntelligence:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ modelSourceDisclosure:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ petModelRecognitionEnabled:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ backgroundIndexingPaused:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ backgroundIndexingAutoRun:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ indexingPowerMode:/);
  assert.match(intelligencePanelSource, /props\.onChange\(\{ visionModelTier:/);
  assert.match(intelligencePanelSource, /props\.onInstallVisionModel\("low-memory"\)/);
  assert.match(intelligencePanelSource, /props\.onInstallVisionModel\("quality"\)/);
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
  assert.deepStrictEqual(settingsMod.photoManagedRootPolicyDefaults(rows[1].profile), {
    keepFolderOrganizationDefault: true,
    externalBackupCovered: true,
    externalBackupLabel: "External disk A",
    externalBackupCheckedAt: "2026-06-28T00:00:00Z",
  });
  assert.deepStrictEqual(settingsMod.photoManagedRootPolicyDefaults({ policy: { externalBackupLabel: "  Drive B  " } }), {
    keepFolderOrganizationDefault: false,
    externalBackupCovered: false,
    externalBackupLabel: "Drive B",
    externalBackupCheckedAt: "",
  });
  assert.strictEqual(settingsMod.findPhotoManagedRootProfile({ defaultManagedRoot: "/workspace/photos", managedRoots: rows.map((row) => row.profile) })?.profileId, "default-root");
  assert.strictEqual(settingsMod.findPhotoManagedRootProfile({ managedRoots: rows.map((row) => row.profile) }, "/Volumes/Archive/Photos")?.profileId, "external-root");
  assert.strictEqual(settingsMod.findPhotoManagedRootProfile({ managedRoots: rows.map((row) => row.profile) }, "/not/found"), null);
});

run("photo library root helpers derive rows options and active labels", () => {
  const uiText = (label) => `ui:${label}`;
  const settings = {
    libraryRoots: [
      {
        profileId: "root-alpha",
        name: "Root Alpha",
        path: "/Volumes/Alpha/Photos",
        assetCount: 1250,
        exists: true,
        isDirectory: true,
        policyWarnings: [
          { kind: "duplicate", message: "Duplicate with managed root.", action: "Remove one root." },
          { kind: "duplicate", message: "Duplicate with managed root.", action: "Remove one root." },
        ],
      },
      {
        profileId: "root-beta",
        name: "",
        path: "/Volumes/Beta/Library",
        assetCount: 1,
        exists: true,
        isDirectory: true,
        rootConflictKind: "symlink",
        rootConflictMessage: "This root resolves through a symlink.",
      },
      {
        profileId: "root-alpha-copy",
        name: "Duplicate Alpha",
        path: "/Volumes/Alpha/Photos",
        assetCount: 3,
      },
      {
        profileId: "blank",
        name: "Blank",
        path: " ",
      },
    ],
    backupPolicyStatus: {
      rootCoverage: [
        { path: "/Volumes/Alpha/Photos", assetCount: 1250 },
        { path: " " },
      ],
    },
  };
  const libraryRows = settingsMod.buildPhotoLibraryRootProfileRows(settings, {
    activeLibraryRoot: "/Volumes/Alpha/Photos",
    activeLibraryRootProfileId: "root-alpha",
    formatCount: (value) => `#${value}`,
    text: uiText,
  });
  assert.deepStrictEqual(libraryRows.map((row) => row.key), ["root-alpha", "root-beta"]);
  assert.strictEqual(libraryRows[0].name, "Root Alpha");
  assert.deepStrictEqual(libraryRows[0].badges.map((badge) => [badge.key, badge.label, badge.tone || ""]), [
    ["view-only", "ui:View only", ""],
    ["assets", "#1250 ui:photos", ""],
    ["viewing", "ui:Viewing", "ok"],
    ["root-conflict", "ui:Duplicate root", "warn"],
  ]);
  assert.deepStrictEqual(libraryRows[0].details, [
    "Duplicate with managed root.",
    "Duplicate with managed root. Remove one root.",
    "ui:Available library folder.",
  ]);
  assert.strictEqual(libraryRows[1].name, "Library");
  assert.deepStrictEqual(libraryRows[1].badges.map((badge) => [badge.key, badge.label, badge.tone || ""]), [
    ["view-only", "ui:View only", ""],
    ["assets", "#1 ui:photo", ""],
    ["root-conflict", "ui:Symlink root", "warn"],
  ]);

  const managedRows = settingsMod.buildPhotoManagedRootProfileRows({
    managedRoots: [
      {
        profileId: "managed-main",
        name: "Managed Main",
        path: "/Volumes/Managed/Main",
        createdAt: "",
        updatedAt: "",
        isDefault: true,
      },
    ],
  });
  const options = settingsMod.buildPhotoLibraryViewOptions(managedRows, libraryRows, {
    activeLibraryRoot: "/Volumes/Detached/Archive",
    text: uiText,
  });
  assert.deepStrictEqual(options.map((option) => [option.key, option.value, option.label, option.detail]), [
    ["all", "", "ui:All libraries", "ui:All libraries"],
    ["managed:managed-main", "managed:managed-main", "Managed Main", "ui:Managed root"],
    ["view:root-alpha", "view:root-alpha", "Root Alpha", "ui:Library root"],
    ["view:root-beta", "view:root-beta", "Library", "ui:Library root"],
    ["active:/Volumes/Detached/Archive", "root:/Volumes/Detached/Archive", "Archive", "ui:Custom"],
  ]);
  assert.strictEqual(settingsMod.photoActiveLibraryScopeValue(options, "/Volumes/Alpha/Photos", "root-alpha"), "view:root-alpha");
  assert.strictEqual(settingsMod.photoActiveLibraryScopeValue(options, "/Volumes/Detached/Archive", ""), "root:/Volumes/Detached/Archive");
  assert.strictEqual(settingsMod.photoActiveLibraryRootLabel("", managedRows, libraryRows, { text: uiText }), "ui:All libraries");
  assert.strictEqual(settingsMod.photoActiveLibraryRootLabel("/Volumes/Managed/Main", managedRows, libraryRows, { text: uiText }), "Managed Main");
  assert.strictEqual(settingsMod.photoActiveLibraryRootLabel("/Volumes/Unknown/Library", managedRows, libraryRows, { text: uiText }), "Library");
  assert.deepStrictEqual([...settingsMod.photoManagedRootCoverageByPath(settings.backupPolicyStatus).keys()], ["/Volumes/Alpha/Photos"]);
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
  const uiText = (source) => `ui:${source}`;
  assert.strictEqual(duplicateReviewMod.photoDuplicateGroupLabel(null, uiText), "ui:None");
  assert.strictEqual(duplicateReviewMod.photoDuplicateGroupLabel(group, uiText), "ui:Exact duplicate");
  assert.strictEqual(
    duplicateReviewMod.photoDuplicateGroupLabel({ ...group, algorithm: "perceptual_dhash" }, uiText),
    "ui:Near duplicate",
  );
  assert.strictEqual(
    duplicateReviewMod.photoDuplicateGroupLabel({ ...group, algorithm: "other" }, uiText),
    "ui:Duplicate group",
  );
  assert.strictEqual(
    duplicateReviewMod.photoDuplicateRecommendationText(group, "asset-b", (source) => path.basename(source), uiText),
    "ui:This photo · ui:Favorite, ui:Most metadata",
  );
  assert.strictEqual(
    duplicateReviewMod.photoDuplicateRecommendationText(group, "asset-a", (source) => path.basename(source), uiText),
    "beta.jpg · ui:Favorite, ui:Most metadata",
  );
  assert.strictEqual(
    duplicateReviewMod.photoDuplicateRecommendationText({ ...group, recommendedAssetId: "" }, "asset-a", (source) => path.basename(source), uiText),
    "ui:None",
  );
  const personSuggestionRows = duplicateReviewMod.photoDuplicatePersonSuggestionRows([
    { personA: "Grace", personB: "Ada", score: 0.92, countA: 5, countB: 7, reason: "near", referenceA: {}, referenceB: {} },
    { personA: "Ada", personB: "Katherine", score: 0.81, countA: 4, countB: 3, reason: "near", referenceA: {}, referenceB: {} },
    { personA: "Other", personB: "Person", score: 0.99, countA: 2, countB: 2, reason: "near", referenceA: {}, referenceB: {} },
  ], " Ada ", {
    formatCount: (value) => `${value} photos`,
    uiText,
  });
  assert.deepStrictEqual(personSuggestionRows.map((row) => ({
    key: row.key,
    activeName: row.activeName,
    otherName: row.otherName,
    summaryText: row.summaryText,
    scorePercent: row.scorePercent,
    countA: row.countA,
    countB: row.countB,
    suggestionPair: `${row.suggestion.personA}:${row.suggestion.personB}`,
  })), [
    {
      key: "Grace-Ada-0.92",
      activeName: " Ada ",
      otherName: "Grace",
      summaryText: "92% ui:similar across saved face photos · 5 photos / 7 photos",
      scorePercent: 92,
      countA: 5,
      countB: 7,
      suggestionPair: "Grace:Ada",
    },
    {
      key: "Ada-Katherine-0.81",
      activeName: " Ada ",
      otherName: "Katherine",
      summaryText: "81% ui:similar across saved face photos · 4 photos / 3 photos",
      scorePercent: 81,
      countA: 4,
      countB: 3,
      suggestionPair: "Ada:Katherine",
    },
  ]);
  assert.deepStrictEqual(Array.from(duplicateReviewMod.photoDuplicateSuggestionCountsByPerson([
    { personA: "Ada", personB: "Grace", score: 0.9, countA: 1, countB: 2, reason: "near", referenceA: {}, referenceB: {} },
    { personA: " ada ", personB: "Katherine", score: 0.8, countA: 1, countB: 2, reason: "near", referenceA: {}, referenceB: {} },
    { personA: "", personB: "Grace", score: 0.7, countA: 1, countB: 2, reason: "near", referenceA: {}, referenceB: {} },
  ]).entries()).sort(), [["ada", 2], ["grace", 2], ["katherine", 1]]);
  assert.deepStrictEqual(duplicateReviewMod.photoDuplicatePersonSuggestionRows(personSuggestionRows, "", { uiText }), []);
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const duplicateReviewPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoDuplicateReviewPanel.tsx"), "utf8");
  assert.match(photosViewSource, /photoDuplicateGroupLabel/);
  assert.match(photosViewSource, /photoDuplicateRecommendationText/);
  assert.match(photosViewSource, /<PhotoDuplicateReviewPanel/);
  assert.match(photosViewSource, /groups=\{visibleDuplicateReviewGroups\}/);
  assert.doesNotMatch(photosViewSource, /photos-duplicate-review-panel/);
  assert.doesNotMatch(photosViewSource, /visibleDuplicateReviewGroups\.map/);
  assert.match(photosViewSource, /photoDuplicatePersonSuggestionRows\(duplicatePeople\?\.suggestions, activePerson\?\.name \|\| "", \{ formatCount, uiText \}\)/);
  assert.match(photosViewSource, /photoDuplicateSuggestionCountsByPerson\(duplicatePeople\?\.suggestions\)/);
  assert.doesNotMatch(photosViewSource, /function photoDuplicateGroupLabel/);
  assert.doesNotMatch(photosViewSource, /function photoDuplicateRecommendationText/);
  assert.doesNotMatch(photosViewSource, /suggestion\.personA\.trim\(\)\.toLowerCase\(\) === activeName\.trim\(\)\.toLowerCase\(\)/);
  assert.doesNotMatch(photosViewSource, /Math\.round\(suggestion\.score \* 100\)/);
  assert.doesNotMatch(photosViewSource, /duplicatePeople\?\.suggestions \?\? \[\]\)\.forEach\(\(suggestion\) => \{/);
  assert.match(duplicateReviewPanelSource, /export function PhotoDuplicateReviewPanel/);
  assert.match(duplicateReviewPanelSource, /photos-duplicate-review-panel/);
  assert.match(duplicateReviewPanelSource, /photos-duplicate-review-row/);
  assert.match(duplicateReviewPanelSource, /photoDuplicateGroupLabel\(group\.group, uiText\)/);
  assert.match(duplicateReviewPanelSource, /uiText\("Duplicate review"\)/);
  assert.match(duplicateReviewPanelSource, /uiText\("Keep recommended"\)/);
  assert.match(duplicateReviewPanelSource, /uiText\("Keep this"\)/);
  assert.match(duplicateReviewPanelSource, /onOpenRow\(row\.loadedIndex, event\.currentTarget\)/);
  const duplicateReviewSource = fs.readFileSync(path.join(ROOT, "src/views/photoDuplicateReview.ts"), "utf8");
  assert.match(duplicateReviewSource, /export function photoDuplicatePersonSuggestionRows/);
  assert.match(duplicateReviewSource, /export function photoDuplicateSuggestionCountsByPerson/);
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
  assert.deepStrictEqual(groupReviewMod.parsePhotoPeopleDraft(" Alice, Bob; alice\n  Ada  Lovelace "), ["Alice", "Bob", "Ada Lovelace"]);
  assert.deepStrictEqual(groupReviewMod.parsePhotoPeopleDraft(" , ; \n "), []);
  assert.strictEqual(groupReviewMod.photoPeopleDraftValue(["Alice", "", "Bob"]), "Alice, Bob");
  assert.strictEqual(groupReviewMod.savedPeopleGroupId({ id: "group:saved:family", kind: "group" }), "family");
  assert.strictEqual(groupReviewMod.savedPeopleGroupId({ id: "group:generated", kind: "group", groupId: "curated" }), "curated");
  assert.strictEqual(groupReviewMod.savedPeopleGroupId({ id: "person:Alice", kind: "person" }), "");
  const railOrderFolders = [
    { id: "person:Ada", kind: "person", name: "Ada", count: 4 },
    { id: "group:saved:family", kind: "group", name: "Family", count: 8, groupProfile: { memberPeople: ["Ada"], excludePeople: ["Grace"], memberPets: ["Milo"], excludePets: ["Otis"] } },
    { id: "person:Grace", kind: "person", name: "Grace", count: 2 },
    { id: "group:saved:friends", kind: "group", name: "Friends", count: 5, groupPeople: ["Grace"], groupPets: ["Milo"] },
  ];
  assert.strictEqual(groupReviewMod.photoPeopleRailItemKind(railOrderFolders[0]), "person");
  assert.strictEqual(groupReviewMod.photoPeopleRailItemKind(railOrderFolders[1]), "group");
  assert.strictEqual(groupReviewMod.photoPeopleRailDropPlacementFromRatio(0.49), "before");
  assert.strictEqual(groupReviewMod.photoPeopleRailDropPlacementFromRatio(0.5), "after");
  assert.strictEqual(groupReviewMod.photoPeopleRailDropPlacementFromRatio(Number.NaN), "after");
  assert.strictEqual(groupReviewMod.photoPeopleRailDropPlacementFromBounds(24, 20, 20), "before");
  assert.strictEqual(groupReviewMod.photoPeopleRailDropPlacementFromBounds(34, 20, 20), "after");
  const movedPeopleRailOrder = groupReviewMod.photoPeopleRailMoveOrder(railOrderFolders, railOrderFolders[2], "up");
  assert.ok(movedPeopleRailOrder, "person rail move should produce an order");
  assert.deepStrictEqual(movedPeopleRailOrder.map((folder) => folder.id), ["person:Grace", "person:Ada"]);
  assert.strictEqual(groupReviewMod.photoPeopleRailMoveOrder(railOrderFolders, railOrderFolders[0], "up"), null);
  const droppedPeopleRailOrder = groupReviewMod.photoPeopleRailDropOrder(railOrderFolders, "person:Ada", "person:Grace", "after", "person");
  assert.ok(droppedPeopleRailOrder, "person rail drop should produce an order");
  assert.deepStrictEqual(droppedPeopleRailOrder.map((folder) => folder.id), ["person:Grace", "person:Ada"]);
  assert.deepStrictEqual(groupReviewMod.photoPersonRailOrderPayloads([railOrderFolders[2], railOrderFolders[0]]), [
    { personName: "Grace", manualOrder: 0 },
    { personName: "Ada", manualOrder: 1 },
  ]);
  const movedGroupRailOrder = groupReviewMod.photoPeopleRailMoveOrder(railOrderFolders, railOrderFolders[3], "up");
  assert.ok(movedGroupRailOrder, "saved group rail move should produce an order");
  assert.deepStrictEqual(groupReviewMod.photoSavedGroupRailOrderPayloads(movedGroupRailOrder), [
    {
      groupId: "friends",
      name: "Friends",
      memberPeople: ["Grace"],
      excludePeople: [],
      memberPets: ["Milo"],
      excludePets: [],
      manualOrder: 0,
    },
    {
      groupId: "family",
      name: "Family",
      memberPeople: ["Ada"],
      excludePeople: ["Grace"],
      memberPets: ["Milo"],
      excludePets: ["Otis"],
      manualOrder: 1,
    },
  ]);
  assert.deepStrictEqual(
    groupReviewMod.photoPeopleRailDragTargetState(null, railOrderFolders[2], "person:Ada", "person", "after"),
    { draggedId: "person:Ada", kind: "person", targetId: "person:Grace", placement: "after", valid: true },
  );
  assert.deepStrictEqual(
    groupReviewMod.photoPeopleRailDragTargetState(null, railOrderFolders[1], "person:Ada", "person", "before"),
    { draggedId: "person:Ada", kind: "person", targetId: "group:saved:family", placement: "before", valid: false },
  );
  const existingPeopleRailDrag = { draggedId: "person:Ada", kind: "person", targetId: "person:Grace", placement: "after", valid: true };
  assert.strictEqual(
    groupReviewMod.photoPeopleRailDragTargetState(existingPeopleRailDrag, railOrderFolders[2], "person:Ada", "person", "after"),
    existingPeopleRailDrag,
  );
  assert.strictEqual(groupReviewMod.photoPeopleRailDragTargetState(null, railOrderFolders[2], "", "person", "after"), null);
  assert.deepStrictEqual(groupReviewMod.PHOTO_STATUS_FILTERS, ["pending", "accepted", "uncertain", "rejected"]);
  assert.strictEqual(groupReviewMod.photoStatusFilterLabel("pending"), "Needs review");
  assert.strictEqual(groupReviewMod.photoStatusFilterLabel("accepted"), "Accepted");
  assert.strictEqual(groupReviewMod.photoStatusFilterLabel("uncertain"), "Not sure");
  assert.strictEqual(groupReviewMod.photoStatusFilterLabel("rejected"), "Rejected");
  assert.strictEqual(groupReviewMod.PHOTO_REVIEW_MORE_CANDIDATE_RENDER_LIMIT, 6);
  assert.deepStrictEqual(groupReviewMod.photoPersonFilterOptions([" Ada ", "", "Grace", "Ada", null, "Bob"]), ["Ada", "Bob", "Grace"]);
  const petFoldersForOptions = [
    { id: "pet:otis", kind: "pet", name: " Otis ", count: 3 },
    { id: "pet:milo", kind: "pet", name: "Milo folder", petName: "Milo", count: 1 },
    { id: "person:ada", kind: "person", name: "Ada", count: 2 },
    { id: "pet:blank", kind: "pet", name: " ", count: 1 },
  ];
  assert.deepStrictEqual(groupReviewMod.photoPetGroupOptions(petFoldersForOptions), ["Milo", "Otis"]);
  assert.deepStrictEqual(groupReviewMod.photoPetAssignOptions([" Otis ", "Zelda"], [
    { id: "pet:milo", kind: "pet", name: "Milo", count: 1 },
    { id: "pet:otis", kind: "pet", name: "Otis", count: 3 },
    { id: "group:saved:family", kind: "group", name: "Family", count: 5 },
  ]), ["Milo", "Otis", "Zelda"]);
  const managementLists = groupReviewMod.buildPhotoPeopleManagementLists([
    { id: "person:grace", kind: "person", name: "Grace", count: 1, personProfile: { favorite: true, manualOrder: 99 } },
    { id: "person:hidden", kind: "person", name: "Hidden", count: 10, personProfile: { hidden: true, manualOrder: 0 } },
    { id: "person:bob", kind: "person", name: "Bob", count: 7, personProfile: { manualOrder: 1 } },
    { id: "person:ada", kind: "person", name: "Ada", count: 4, personProfile: { manualOrder: 2 } },
    { id: "group:generated", kind: "group", name: "Generated", count: 20, groupSource: "generated", groupProfile: { manualOrder: 0 } },
    { id: "group:saved:family", kind: "group", name: "Family", count: 2, groupSource: "saved", groupProfile: { manualOrder: 5 } },
    { id: "group:saved:faves", kind: "group", name: "Favorites", count: 1, groupSource: "saved", groupProfile: { favorite: true, manualOrder: 99 } },
    { id: "group:saved:hidden", kind: "group", name: "Hidden group", count: 50, groupSource: "saved", groupProfile: { hidden: true, manualOrder: 0 } },
    { id: "pet:otis", kind: "pet", name: "Otis", count: 3, petProfile: { manualOrder: 2 } },
    { id: "pet:milo", kind: "pet", name: "Milo", count: 1, petProfile: { favorite: true, manualOrder: 99 } },
    { id: "pet:hidden", kind: "pet", name: "Hidden pet", count: 10, petProfile: { hidden: true, manualOrder: 0 } },
  ]);
  assert.deepStrictEqual(managementLists.people.map((folder) => folder.id), ["person:grace", "person:bob", "person:ada", "person:hidden"]);
  assert.deepStrictEqual(managementLists.groups.map((folder) => folder.id), ["group:saved:faves", "group:saved:family", "group:generated", "group:saved:hidden"]);
  assert.deepStrictEqual(managementLists.pets.map((folder) => folder.id), ["pet:milo", "pet:otis", "pet:hidden"]);
  const petRenameOptions = groupReviewMod.photoPetRenameOptions([
    { id: "pet:milo-local", kind: "pet", name: "Milo", petName: "Milo", count: 2 },
  ], [
    { id: "pet:milo-folder", kind: "pet", name: "Milo", petName: "Milo", count: 5 },
    { id: "pet:otis", kind: "pet", name: "Otis", petName: "Otis", count: 1 },
    { id: "person:ada", kind: "person", name: "Ada", count: 1 },
  ]);
  assert.deepStrictEqual(petRenameOptions.map((folder) => folder.id), ["pet:milo-folder", "pet:otis"]);
  assert.strictEqual(
    groupReviewMod.photoPetRenameTargetExists({ id: "pet:milo", kind: "pet", name: "Milo", count: 2 }, " Otis ", petRenameOptions),
    true,
  );
  assert.strictEqual(
    groupReviewMod.photoPetRenameTargetExists({ id: "pet:milo", kind: "pet", name: "Milo", count: 2 }, "Milo", petRenameOptions),
    false,
  );
  assert.strictEqual(groupReviewMod.photoPetRenameTargetExists(null, "Otis", petRenameOptions), false);
  assert.strictEqual(
    groupReviewMod.photoPetRenameTargetExists({ id: "pet:milo", kind: "pet", name: "Milo", count: 2 }, " ", petRenameOptions),
    false,
  );
  assert.deepStrictEqual(
    groupReviewMod.photoPetReviewItemPayload({
      assetId: 42,
      sourcePath: " /photos/pet.jpg ",
    }),
    {
      assetId: "42",
      sourcePath: "/photos/pet.jpg",
    },
  );
  assert.deepStrictEqual(
    groupReviewMod.photoPetAssignPayload({ assetId: 42, sourcePath: " /photos/pet.jpg " }, " Milo  Pup "),
    {
      assetId: "42",
      sourcePath: "/photos/pet.jpg",
      petName: "Milo Pup",
    },
  );
  assert.deepStrictEqual(
    groupReviewMod.photoPetBulkAssignPayload([{ assetId: 42, sourcePath: " /photos/pet.jpg " }], " Milo "),
    {
      petName: "Milo",
      items: [{ assetId: "42", sourcePath: "/photos/pet.jpg" }],
    },
  );
  assert.deepStrictEqual(
    groupReviewMod.photoPetBulkDismissPayload([{ assetId: 42, sourcePath: " /photos/pet.jpg " }], "dog"),
    {
      petKind: "dog",
      items: [{ assetId: "42", sourcePath: "/photos/pet.jpg" }],
    },
  );
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(photosViewSource, /parsePhotoPeopleDraft/);
  assert.match(photosViewSource, /photoPetAssignPayload/);
  assert.match(photosViewSource, /photoPetBulkAssignPayload/);
  assert.match(photosViewSource, /photoPetBulkDismissPayload/);
  assert.match(photosViewSource, /assignPhotoPet\(photoPetAssignPayload\(item, petName\)\)/);
  assert.match(photosViewSource, /photoPersonFilterOptions\(people\)/);
  assert.match(photosViewSource, /photoPetGroupOptions\(folders\)/);
  assert.match(photosViewSource, /photoPetAssignOptions\(petGroupOptions, peopleManagementFolders\)/);
  assert.match(photosViewSource, /buildPhotoPeopleManagementLists\(peopleManagementFolders\)/);
  assert.match(photosViewSource, /const peopleManagementPeople = peopleManagementLists\.people/);
  assert.match(photosViewSource, /const peopleManagementGroups = peopleManagementLists\.groups/);
  assert.match(photosViewSource, /const peopleManagementPets = peopleManagementLists\.pets/);
  assert.match(photosViewSource, /photoPetRenameOptions\(peopleManagementPets, folders\)/);
  assert.match(photosViewSource, /photoPetRenameTargetExists\(activePet, petRenameDraft, petRenameOptions\)/);
  assert.match(photosViewSource, /photoPeopleDraftValue/);
  assert.match(photosViewSource, /savedPeopleGroupId/);
  assert.match(photosViewSource, /photoStatusFilterLabel/);
  assert.doesNotMatch(photosViewSource, /function parsePhotoPeopleDraft/);
  assert.doesNotMatch(photosViewSource, /assignPhotoPet\(\{\s*assetId: item\.assetId/);
  assert.doesNotMatch(photosViewSource, /new Set\(people\.map\(\(person\) => String\(person \|\| ""\)\.trim\(\)\.filter/);
  assert.doesNotMatch(photosViewSource, /folders\s*\.filter\(\(folder\) => folder\.kind === "pet"\)\s*\.map\(\(folder\) => String\(folder\.petName \|\| folder\.name/);
  assert.doesNotMatch(photosViewSource, /peopleManagementFolders\s*\.filter\(\(folder\) => folder\.kind === "pet"\)\s*\.map\(\(folder\) => String\(folder\.petName \|\| folder\.name/);
  assert.doesNotMatch(photosViewSource, /const peopleManagementPeople = useMemo\(\s*\(\) => peopleManagementFolders[\s\S]{0,220}\.filter\(\(folder\) => folder\.kind === "person"\)/);
  assert.doesNotMatch(photosViewSource, /const peopleManagementGroups = useMemo\(\s*\(\) => peopleManagementFolders[\s\S]{0,220}\.filter\(\(folder\) => folder\.kind === "group"\)/);
  assert.doesNotMatch(photosViewSource, /const peopleManagementPets = useMemo\(\s*\(\) => peopleManagementFolders[\s\S]{0,220}\.filter\(\(folder\) => folder\.kind === "pet"\)/);
  assert.doesNotMatch(photosViewSource, /const byKey = new Map<string, PhotoFolder>\(\);[\s\S]{0,220}peopleManagementPets/);
  assert.doesNotMatch(photosViewSource, /function photoPeopleDraftValue/);
  assert.doesNotMatch(photosViewSource, /function savedPeopleGroupId/);
  assert.doesNotMatch(photosViewSource, /function photoStatusFilterLabel/);
  const peopleGallery = groupReviewMod.buildPhotoPeopleGalleryState({
    people: [
      { id: "person:Ada", kind: "person", name: "Ada", count: 4, personProfile: { favorite: true } },
      { id: "person:Hidden", kind: "person", name: "Hidden", count: 2, personProfile: { hidden: true } },
    ],
    pets: [
      { id: "pet:Milo", kind: "pet", name: "Milo", count: 3, petProfile: { favorite: true } },
      { id: "pet:Hidden", kind: "pet", name: "Hidden pet", count: 1, petProfile: { hidden: true } },
    ],
    groups: [
      { id: "group:saved:family", kind: "group", name: "Family", count: 8 },
      { id: "group:saved:hidden", kind: "group", name: "Hidden group", count: 5, groupProfile: { hidden: true } },
    ],
    railFolders: [
      { id: "unknown:1", kind: "unknown", name: "Unknown", count: 6 },
      { id: "person:Rail", kind: "person", name: "Rail", count: 1 },
    ],
    folders: [
      { id: "petReview", kind: "utility", name: "Review pets", count: 7 },
    ],
    reviewPending: 2.8,
  });
  assert.deepStrictEqual(peopleGallery.namedPeople.map((folder) => folder.id), ["person:Ada"]);
  assert.deepStrictEqual(peopleGallery.pets.map((folder) => folder.id), ["pet:Milo"]);
  assert.deepStrictEqual(peopleGallery.groups.map((folder) => folder.id), ["group:saved:family"]);
  assert.deepStrictEqual(peopleGallery.unknownClusters.map((folder) => folder.id), ["unknown:1"]);
  assert.strictEqual(peopleGallery.petReviewFolder.id, "petReview");
  assert.deepStrictEqual(peopleGallery.favoritePeople.map((folder) => folder.id), ["person:Ada"]);
  assert.deepStrictEqual(peopleGallery.favoritePets.map((folder) => folder.id), ["pet:Milo"]);
  assert.strictEqual(peopleGallery.reviewPending, 2);
  assert.strictEqual(peopleGallery.hasAny, true);
  assert.strictEqual(groupReviewMod.buildPhotoPeopleGalleryState({ reviewPending: -1 }).hasAny, false);

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
  assert.deepStrictEqual(groupReviewMod.photoReviewMoreCandidateRows(rows, {
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
  }, 1).map((row) => ({
    candidateId: row.candidateId,
    personName: row.personName,
    sourceName: row.sourceName,
    detailText: row.detailText,
    reasons: row.reasons,
    status: row.status,
    candidateIdFromReference: row.candidate.candidateId,
  })), [{
    candidateId: "alice-high",
    personName: "Alice",
    sourceName: "alice-high.jpg",
    detailText: "alice-high.jpg · Not sure · 91%",
    reasons: ["Nearest match", "score 91%", "quality 50%", "likely", "uncertain", "best reference"],
    status: "uncertain",
    candidateIdFromReference: "alice-high",
  }]);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateOverflowCount(rows, 1), 1);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateOverflowCount(rows, 99), 0);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateMatchesThreshold(rows[0], 0.9), true);
  assert.strictEqual(groupReviewMod.photoReviewMoreCandidateMatchesThreshold(rows[1], 0.9), false);
  assert.deepStrictEqual(groupReviewMod.buildPhotoPersonReviewCandidates({
    personName: " Alice ",
    minScore: 0.8,
    candidates: [
      candidate("alice-low", "alice", "pending", 0.72, 0.95),
      candidate("alice-high", "Alice", "uncertain", 0.91, 0.5),
      candidate("alice-accepted", "Alice", "accepted", 1, 1),
      candidate("bob-high", "Bob", "pending", 0.99, 0.9),
    ],
  }).map((row) => row.candidateId), ["alice-high"]);
  assert.deepStrictEqual(groupReviewMod.buildPhotoPersonReviewCandidates({
    personName: "Alice",
    candidates: [
      candidate("alice-low", "alice", "pending", 0.72, 0.95),
      candidate("alice-high", "Alice", "uncertain", 0.91, 0.5),
    ],
  }).map((row) => row.candidateId), ["alice-high", "alice-low"]);
  assert.deepStrictEqual(groupReviewMod.buildPhotoPersonReviewCandidates({ personName: "", candidates: rows }), []);
  const reviewCounts = groupReviewMod.photoReviewCandidateCountsByPerson([
    candidate("ada-pending", " Ada ", "pending", 0.5),
    candidate("ada-uncertain", "ada", "uncertain", 0.6),
    candidate("ada-accepted", "Ada", "accepted", 1),
    candidate("grace-pending", "Grace", "pending", 0.9),
    candidate("blank", " ", "pending", 0.1),
  ]);
  assert.deepStrictEqual(Array.from(reviewCounts.entries()).sort(), [["ada", 2], ["grace", 1]]);
  const personLookup = groupReviewMod.photoPersonFolderLookup([
    { id: "person:Ada", kind: "person", name: "Ada", count: 4 },
    { id: "person:Ada-duplicate", kind: "person", name: " ada ", count: 9 },
    { id: "pet:Milo", kind: "pet", name: "Milo", count: 2 },
    { id: "person:Grace", kind: "person", name: "Grace", count: 7 },
  ]);
  assert.deepStrictEqual(Array.from(personLookup.keys()), ["ada", "grace"]);
  assert.deepStrictEqual(groupReviewMod.photoPersonMergePreview("Ada", "Grace", personLookup, reviewCounts), {
    sourceCount: 4,
    targetCount: 7,
    sourceReviewCount: 2,
    targetReviewCount: 1,
  });
  assert.strictEqual(groupReviewMod.photoPersonMergePreview("Ada", "ada", personLookup, reviewCounts), null);
  assert.strictEqual(groupReviewMod.photoPersonMergePreview("Ada", "Missing", personLookup, reviewCounts), null);
  assert.deepStrictEqual(groupReviewMod.buildPhotoGroupReviewCandidates({ memberPeople: [], candidates: [candidate("x", "Alice", "pending", 1)] }), []);
  assert.match(photosViewSource, /buildPhotoPersonReviewCandidates\(\{[\s\S]{0,160}personName: activePerson\?\.name,[\s\S]{0,80}minScore: activeReviewMoreMinScore/);
  assert.match(photosViewSource, /buildPhotoPersonReviewCandidates\(\{[\s\S]{0,120}personName: folder\.name/);
  assert.match(photosViewSource, /photoReviewCandidateCountsByPerson\(reviewCandidates\)/);
  assert.match(photosViewSource, /photoPersonFolderLookup\(\[\.\.\.folders, \.\.\.peopleManagementPeople\]\)/);
  assert.match(photosViewSource, /buildPhotoPersonMergePreview\(sourceName, targetName, personFolderLookup, peopleManagementReviewCounts\)/);
  assert.match(photosViewSource, /photoReviewMoreCandidateRows\(activeInlineReviewCandidates, \{ fileName \}\)/);
  assert.match(photosViewSource, /photoReviewMoreCandidateOverflowCount\(activeInlineReviewCandidates\)/);
  assert.doesNotMatch(photosViewSource, /photoReviewMoreCandidateMatchesThreshold/);
  assert.doesNotMatch(photosViewSource, /candidate\.personName\.trim\(\)\.toLowerCase\(\) === personName/);
  assert.doesNotMatch(photosViewSource, /b\.score - a\.score \|\| b\.quality - a\.quality \|\| a\.candidateId\.localeCompare\(b\.candidateId\)/);
  assert.doesNotMatch(photosViewSource, /reviewCandidates\.forEach\(\(candidate\) => \{\s*if \(candidate\.status !== "pending"/);
  assert.doesNotMatch(photosViewSource, /for \(const folder of \[\.\.\.folders, \.\.\.peopleManagementPeople\]\)/);
  assert.doesNotMatch(photosViewSource, /activeInlineReviewCandidates\.slice\(0, 6\)/);
  assert.doesNotMatch(photosViewSource, /photoReviewMoreCandidateReasons\(candidate\)/);
  assert.doesNotMatch(photosViewSource, /Math\.round\(candidate\.score \* 100\)/);
});

run("photo inline review decisions normalize and persist local history", () => {
  assert.strictEqual(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISIONS_KEY, "vintrace.photos.inlineReviewDecisions");
  assert.strictEqual(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISION_STORAGE_LIMIT, 30);
  assert.strictEqual(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT, 6);
  const rowDecisions = [
    {
      id: "decision-a",
      candidateId: "candidate-a",
      personName: "Ada",
      sourcePath: "/photos/source-a.jpg",
      previousStatus: "pending",
      status: "accepted",
      score: 0.876,
      decidedAt: "2026-07-08T00:00:00.000Z",
    },
    {
      id: "decision-b",
      candidateId: "candidate-b",
      personName: "Grace",
      sourcePath: "/photos/source-b.jpg",
      previousStatus: "uncertain",
      status: "rejected",
      score: 0.334,
      decidedAt: "2026-07-08T00:01:00.000Z",
    },
  ];
  const reviewRows = inlineReviewMod.photoInlineReviewDecisionRows(rowDecisions, {
    fileName: (value) => value.split(/[\\/]/).filter(Boolean).pop() || value,
  }, 1);
  assert.deepStrictEqual(reviewRows, [{
    id: "decision-a",
    personName: "Ada",
    detailText: "source-a.jpg · Needs review -> Accepted · 88%",
    decidedAt: "2026-07-08T00:00:00.000Z",
  }]);
  assert.deepStrictEqual(inlineReviewMod.photoInlineReviewDecisionRows(rowDecisions, {}, 0), []);
  assert.deepStrictEqual(
    inlineReviewMod.normalizePhotoInlineReviewDecision({
      candidateId: "candidate-1",
      personName: "Ada",
      previousStatus: "pending",
      status: "accepted",
      score: 2,
      decidedAt: "2026-07-08T00:00:00.000Z",
    }),
    {
      id: "candidate-1:2026-07-08T00:00:00.000Z",
      candidateId: "candidate-1",
      personName: "Ada",
      sourcePath: "",
      previousStatus: "pending",
      status: "accepted",
      score: 1,
      decidedAt: "2026-07-08T00:00:00.000Z",
    },
  );
  assert.strictEqual(
    inlineReviewMod.normalizePhotoInlineReviewDecision({
      candidateId: "candidate-2",
      personName: "Ada",
      previousStatus: "maybe",
      status: "accepted",
      decidedAt: "2026-07-08T00:00:00.000Z",
    }),
    null,
  );

  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };

  try {
    values.set(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISIONS_KEY, "{bad json");
    assert.deepStrictEqual(
      inlineReviewMod.readStoredPhotoInlineReviewDecisions(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISIONS_KEY),
      [],
    );

    const decisions = Array.from({ length: 35 }, (_, index) => ({
      id: `decision-${index}`,
      candidateId: `candidate-${index}`,
      personName: `Person ${index}`,
      sourcePath: `/photos/${index}.jpg`,
      previousStatus: index % 2 ? "uncertain" : "pending",
      status: index % 2 ? "rejected" : "accepted",
      score: index / 10,
      decidedAt: `2026-07-08T00:${String(index).padStart(2, "0")}:00.000Z`,
    }));
    inlineReviewMod.storePhotoInlineReviewDecisions(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISIONS_KEY, [
      ...decisions,
      { ...decisions[0], id: "duplicate", candidateId: "candidate-1" },
      { id: "bad", candidateId: "", personName: "Missing", previousStatus: "pending", status: "accepted", decidedAt: "bad" },
    ]);
    const stored = inlineReviewMod.readStoredPhotoInlineReviewDecisions(inlineReviewMod.PHOTO_INLINE_REVIEW_DECISIONS_KEY);
    assert.strictEqual(stored.length, inlineReviewMod.PHOTO_INLINE_REVIEW_DECISION_STORAGE_LIMIT);
    assert.deepStrictEqual(stored.map((decision) => decision.id).slice(0, 3), ["decision-0", "decision-1", "decision-2"]);
    assert.strictEqual(stored.at(-1).id, "decision-29");
    assert.strictEqual(stored.at(-1).score, 1);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
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

run("buildPhotoSelectionState derives selected item action groups", () => {
  const items = [
    {
      id: "img-a",
      sourcePath: "/photos/a.jpg",
      mediaKind: "image",
      candidateIds: ["ada-1", "ada-1", "legacy-a"],
      hasEditStack: true,
      hasEditStackVersions: true,
      sourceKind: "referenced",
      people: [
        { candidateId: "ada-1", personName: "Ada", status: "accepted", score: 0.9, quality: 0.8, band: "strong" },
      ],
      duplicateGroup: { groupId: "dup-1" },
    },
    {
      id: "video-b",
      sourcePath: "/photos/b.mov",
      mediaKind: "video",
      candidateIds: ["grace-1"],
      editStackVersionCount: 2,
      sourceKind: "managed",
      people: [
        { candidateId: "grace-1", personName: "Grace", status: "accepted", score: 0.7, quality: 0.6, band: "likely" },
      ],
      duplicateGroup: { groupId: "dup-1" },
    },
    {
      id: "missing-c",
      sourcePath: "/photos/c.jpg",
      mediaKind: "image",
      candidateIds: [],
      missingAt: "2026-07-01T00:00:00Z",
      sourceKind: "referenced",
    },
    {
      id: "path-only-d",
      sourcePath: "/photos/d.jpg",
      mediaKind: "image",
      candidateIds: [],
      sourceKind: "referenced",
      deletedAt: "2026-07-02T00:00:00Z",
      duplicateGroup: { groupId: "dup-2" },
    },
  ];
  const selected = new Set(["/photos/d.jpg", "/photos/a.jpg", "/photos/c.jpg", "/photos/b.mov", "/photos/a.jpg"]);
  const state = selectionStateMod.buildPhotoSelectionState({
    items,
    selectedSources: selected,
    activeGroupActive: true,
    activeGroupPeople: ["Ada", "Grace"],
    activeGroupExcludedPeople: ["Grace"],
  });
  assert.deepStrictEqual(state.selectedSourcePaths, ["/photos/d.jpg", "/photos/a.jpg", "/photos/c.jpg", "/photos/b.mov"]);
  assert.deepStrictEqual(state.selectedItems.map((item) => item.id), ["img-a", "video-b", "missing-c", "path-only-d"]);
  assert.deepStrictEqual(state.selectedImageEditPasteItems.map((item) => item.id), ["img-a", "path-only-d"]);
  assert.deepStrictEqual(state.selectedEditStackItems.map((item) => item.id), ["img-a"]);
  assert.deepStrictEqual(state.selectedEditStackVersionItems.map((item) => item.id), ["img-a", "video-b"]);
  assert.strictEqual(state.selectedFirstItem.id, "img-a");
  assert.strictEqual(state.selectedFirstMissing, false);
  assert.deepStrictEqual(state.selectedConsolidatableSources, ["/photos/a.jpg"]);
  assert.deepStrictEqual(state.selectedCandidateIds, ["ada-1", "legacy-a", "grace-1"]);
  assert.deepStrictEqual(state.selectedMatchCandidateIds, ["ada-1"]);
  assert.deepStrictEqual(state.selectedDuplicateGroupIds, ["dup-1", "dup-2"]);
  assert.deepStrictEqual(state.selectedPathOnlySources, ["/photos/c.jpg", "/photos/d.jpg"]);

  const personScoped = selectionStateMod.buildPhotoSelectionState({
    items,
    selectedSources: selected,
    activePersonName: " Grace ",
  });
  assert.deepStrictEqual(personScoped.selectedMatchCandidateIds, ["grace-1"]);
  assert.strictEqual(selectionStateMod.buildPhotoSelectionState({ items, selectedSources: ["/photos/c.jpg"] }).selectedFirstMissing, true);

  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const selectionSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionState.ts"), "utf8");
  assert.match(source, /buildPhotoSelectionState\(\{/);
  assert.match(source, /const selectedImageEditPasteItems = photoSelectionState\.selectedImageEditPasteItems/);
  assert.match(source, /const selectedPathOnlySources = photoSelectionState\.selectedPathOnlySources/);
  assert.match(selectionSource, /export function buildPhotoSelectionState/);
  assert.doesNotMatch(source, /selectedItems\.filter\(\(item\) => !item\.missingAt && !isVideoMediaKind\(item\.mediaKind\)\)/);
  assert.doesNotMatch(source, /selectedItems\.flatMap\(\(item\) => item\.candidateIds \|\| \[\]\)/);
  assert.doesNotMatch(source, /photoPeopleMatchCorrectionCandidateIds\(selectedItems/);
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
  const restoreRows = repairCenterMod.photoRestoreRehearsalDetailRows({
    operations: [
      {
        operation: { label: "Move selected", operationType: "move_selected" },
        undoKind: "restore_file",
        items: [
          { assetId: "ready", sourcePath: "/photos/ready.jpg", status: "ready", issue: "", detail: "", canRestoreOriginal: true, canRestoreCatalog: true },
          { assetId: "warning", sourcePath: "/photos/warning.jpg", status: "warning", issue: "missing_trash", detail: "", canRestoreOriginal: false, canRestoreCatalog: true },
        ],
      },
      {
        operation: { operationType: "delete_photo" },
        undoKind: "restore_catalog",
        items: [
          { assetId: "blocked", sourcePath: "/photos/blocked.jpg", status: "blocked", issue: "target_conflict", detail: "", canRestoreOriginal: false, canRestoreCatalog: false },
          { assetId: "catalog", sourcePath: "/photos/catalog.jpg", status: "ready", issue: "catalog_missing", detail: "", canRestoreOriginal: true, canRestoreCatalog: false },
        ],
      },
      {
        operation: {},
        undoKind: "fallback",
        items: [
          { assetId: "fallback", sourcePath: "/photos/fallback.jpg", status: "ready", issue: "", detail: "", canRestoreOriginal: true, canRestoreCatalog: true },
        ],
      },
    ],
  }, "Photo action");
  assert.deepStrictEqual(restoreRows.map((row) => [row.item.assetId, row.operationLabel, row.operationType, row.undoKind]), [
    ["blocked", "delete_photo", "delete_photo", "restore_catalog"],
    ["warning", "Move selected", "move_selected", "restore_file"],
    ["catalog", "delete_photo", "delete_photo", "restore_catalog"],
    ["ready", "Move selected", "move_selected", "restore_file"],
    ["fallback", "Photo action", "", "fallback"],
  ]);
  const backupRows = repairCenterMod.photoBackupRestoreCheckRows({
    checks: [
      { id: "ok-info", label: "Ok info", ok: true, status: "ready", severity: "info", count: 0, detail: "" },
      { id: "fail-info", label: "Fail info", ok: false, status: "attention", severity: "info", count: 1, detail: "" },
      { id: "fail-warning", label: "Fail warning", ok: false, status: "attention", severity: "warning", count: 1, detail: "" },
      { id: "fail-error", label: "Fail error", ok: false, status: "attention", severity: "error", count: 1, detail: "" },
      { id: "ok-error", label: "Ok error", ok: true, status: "ready", severity: "error", count: 0, detail: "" },
    ],
  });
  assert.deepStrictEqual(backupRows.map((row) => row.id), ["fail-error", "fail-warning", "fail-info", "ok-info", "ok-error"]);
  assert.deepStrictEqual(repairCenterMod.photoRestoreRehearsalDetailRows(null), []);
  assert.deepStrictEqual(repairCenterMod.photoBackupRestoreCheckRows(null), []);
  assert.strictEqual(repairCenterMod.photoRepairHasScan({}), false);
  assert.strictEqual(repairCenterMod.photoRepairHasScan({ status: " Ready " }), true);
  assert.strictEqual(repairCenterMod.photoRepairHasScan({ recoveredCount: 2 }), true);
  assert.strictEqual(repairCenterMod.photoRepairHasScan({ backupRestoreRehearsal: { ok: true } }), true);
  assert.deepStrictEqual(repairCenterMod.photoRepairScopeSummary(null, "", {
    allLibraries: "All libraries",
    library: "Library",
  }), {
    path: "",
    name: "All libraries",
    label: "All libraries",
  });
  assert.deepStrictEqual(repairCenterMod.photoRepairScopeSummary(null, "/Users/alice/Pictures/Library A", {
    allLibraries: "All libraries",
    library: "Library",
  }), {
    path: "/Users/alice/Pictures/Library A",
    name: "Library A",
    label: "Library: Library A",
  });
  assert.deepStrictEqual(repairCenterMod.photoRepairScopeSummary({
    libraryRoot: "/Users/alice/Pictures/Legacy",
    scope: {
      libraryRoot: "/Users/alice/Pictures/Scoped",
      label: "Scoped Library",
    },
  }, "/Users/alice/Pictures/Active", {
    allLibraries: "All libraries",
    library: "Library",
  }), {
    path: "/Users/alice/Pictures/Scoped",
    name: "Scoped Library",
    label: "Library: Scoped Library",
  });
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
  const repairCenterSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairCenter.ts"), "utf8");
  const repairCenterPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairCenterPanel.tsx"), "utf8");
  const repairCenterSectionSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairCenterSection.tsx"), "utf8");
  const managedRootsPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoManagedRootsPanel.tsx"), "utf8");
  const backupPolicyPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoBackupPolicyPanel.tsx"), "utf8");
  const backupCheckPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoBackupCheckPanel.tsx"), "utf8");
  const catalogCleanupPreviewPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoCatalogCleanupPreviewPanel.tsx"), "utf8");
  const repairHistoryListSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairHistoryList.tsx"), "utf8");
  const repairIssueListSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairIssueList.tsx"), "utf8");
  const restoreRehearsalPanelsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRestoreRehearsalPanels.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.match(repairCenterSource, /export function photoRestoreRehearsalDetailRows/);
  assert.match(repairCenterSource, /export function photoBackupRestoreCheckRows/);
  assert.match(repairCenterSource, /export function photoRepairHasScan/);
  assert.match(repairCenterSource, /export function photoRepairScopeSummary/);
  assert.match(source, /buildPhotoRestoreRehearsalDetailRows\(photoRestoreRehearsalValue, uiText\("Photo action"\)\)/);
  assert.match(source, /buildPhotoBackupRestoreCheckRows\(photoBackupRestoreRehearsalValue\)/);
  assert.match(source, /buildPhotoRepairHasScan\(\{/);
  assert.match(source, /photoRepairScopeSummary\(photoBackupCheck, activeLibraryRoot, \{/);
  assert.match(source, /photoLibraryBackupCheck\(\{ sampleLimit: 8, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /photoLibraryPreviewSweep\(\{[\s\S]*?sampleLimit: 8,[\s\S]*?libraryRoot,/);
  assert.match(source, /rebuildPhotoPreviews\(\{[\s\S]*?force: true,[\s\S]*?libraryRoot,/);
  assert.match(source, /scanPhotoRecoveredOrphans\(\{ limit: 500, dryRun, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /photoRecoveredCleanup\(\{[\s\S]*?sampleLimit: 8,[\s\S]*?libraryRoot,/);
  assert.match(source, /props\.listPhotoImportFailures\(\{ limit: 100, libraryRoot, libraryRootProfileId \}\)/);
  assert.match(source, /PhotoBackupCheckPanel/);
  assert.match(source, /PhotoBackupPolicyPanel/);
  assert.match(source, /policy=\{photoBackupPolicy\}/);
  assert.match(source, /status=\{photoBackupPolicyStatus\}/);
  assert.match(source, /onChange=\{updatePhotoBackupPolicy\}/);
  assert.doesNotMatch(source, /Scheduled backup checks/);
  assert.match(source, /PhotoRepairCenterSection/);
  assert.match(source, /onRun=\{\(\) => void runPhotoLibraryBackupCheck\(\)\}/);
  assert.match(source, /onRepairScan=\{\(\) => void runPhotoRepairScan\(\)\}/);
  assert.match(source, /onPreviewOrphans=\{\(\) => void scanRecoveredOrphans\(\{ dryRun: true \}\)\}/);
  assert.match(source, /onScanOrphans=\{\(\) => void scanRecoveredOrphans\(\)\}/);
  assert.match(source, /onPreviewCleanup=\{\(\) => void previewPhotoCatalogCleanup\(\)\}/);
  assert.match(source, /onApplyCatalogCleanup=\{\(\) => void runPhotoCatalogCleanup\(\)\}/);
  assert.match(source, /onIssueAction=\{\(issue\) => void handlePhotoRepairIssueAction\(issue\)\}/);
  assert.match(source, /isIssueActionDisabled=\{photoRepairIssueActionDisabled\}/);
  assert.match(source, /restoreRehearsalDetailRows=\{photoRestoreRehearsalDetailRows\}/);
  assert.match(source, /backupRestoreCheckRows=\{photoBackupRestoreCheckRows\}/);
  assert.match(source, /function runManagedRootBackupCheck\(rootPath: string, rootName: string\)/);
  assert.match(source, /function runManagedRootPreviewSweep\(rootPath: string, rootName: string\)/);
  assert.match(source, /function runManagedRootOrphanScan\(rootPath: string, rootName: string, dryRun = true\)/);
  assert.match(source, /PhotoManagedRootsPanel/);
  assert.doesNotMatch(source, /uiText\("Managed root health"\)/);
  assert.doesNotMatch(source, /uiText\("Check root"\)/);
  assert.match(managedRootsPanelSource, /props\.uiText\("Managed root health"\)/);
  assert.match(managedRootsPanelSource, /props\.uiText\("Check root"\)/);
  assert.match(managedRootsPanelSource, /photo-managed-root-health-panel/);
  assert.match(managedRootsPanelSource, /props\.onRunManagedRootBackupCheck\(row\.path, row\.name\)/);
  assert.match(managedRootsPanelSource, /props\.onRunManagedRootPreviewSweep\(row\.path, row\.name\)/);
  assert.match(managedRootsPanelSource, /props\.onRunManagedRootOrphanScan\(row\.path, row\.name, true\)/);
  assert.match(managedRootsPanelSource, /props\.onRunManagedRootOrphanScan\(row\.path, row\.name, false\)/);
  assert.match(source, /photoRepairScopeLabel/);
  assert.doesNotMatch(source, /className="photo-repair-scope"/);
  assert.doesNotMatch(source, /photo-repair-center/);
  assert.doesNotMatch(source, /PhotoRepairCenterActions/);
  assert.doesNotMatch(source, /PhotoRepairCenterSummary/);
  assert.doesNotMatch(source, /PhotoCatalogCleanupPreviewPanel/);
  assert.doesNotMatch(source, /PhotoRepairHistoryList/);
  assert.doesNotMatch(source, /PhotoRepairIssueList/);
  assert.doesNotMatch(source, /PhotoRestoreRehearsalSummary/);
  assert.doesNotMatch(source, /PhotoBackupRestoreRehearsalSummary/);
  assert.doesNotMatch(source, /photo-repair-center-actions/);
  assert.doesNotMatch(source, /photo-repair-center-summary/);
  assert.doesNotMatch(source, /No repair issues from latest scan/);
  assert.doesNotMatch(source, /photo-backup-check-panel/);
  assert.doesNotMatch(source, /photo-catalog-cleanup-preview/);
  assert.doesNotMatch(source, /photoCatalogCleanupPreview\.operations/);
  assert.doesNotMatch(source, /photo-repair-history-list/);
  assert.doesNotMatch(source, /photoRepairHistoryEventDetails\(event\)/);
  assert.doesNotMatch(source, /photo-repair-issue-list/);
  assert.doesNotMatch(source, /photoRepairIssueActionLabel/);
  assert.doesNotMatch(source, /photo-restore-rehearsal-details/);
  assert.doesNotMatch(source, /photo-backup-restore-details/);
  assert.match(repairCenterSectionSource, /export function PhotoRepairCenterSection/);
  assert.match(repairCenterSectionSource, /className="photo-repair-center"/);
  assert.match(repairCenterSectionSource, /PhotoRepairCenterActions/);
  assert.match(repairCenterSectionSource, /PhotoRepairCenterSummary/);
  assert.match(repairCenterSectionSource, /PhotoRepairIssueList/);
  assert.match(repairCenterSectionSource, /PhotoCatalogCleanupPreviewPanel/);
  assert.match(repairCenterSectionSource, /PhotoRepairHistoryList/);
  assert.match(repairCenterSectionSource, /PhotoRestoreRehearsalSummary/);
  assert.match(repairCenterSectionSource, /PhotoBackupRestoreRehearsalSummary/);
  assert.match(repairCenterSectionSource, /props\.recoveredOrphanScanStatus && !props\.activeRecoveredCollection/);
  assert.match(repairCenterSectionSource, /props\.repairError && <small className="warn">/);
  assert.match(repairCenterPanelSource, /export function PhotoRepairCenterActions/);
  assert.match(repairCenterPanelSource, /export function PhotoRepairCenterSummary/);
  assert.match(repairCenterPanelSource, /photo-repair-center-actions/);
  assert.match(repairCenterPanelSource, /photo-repair-center-summary/);
  assert.match(repairCenterPanelSource, /props\.uiText\("Repair center"\)/);
  assert.match(repairCenterPanelSource, /props\.uiText\("Repair scan"\)/);
  assert.match(repairCenterPanelSource, /props\.uiText\("Preview orphans"\)/);
  assert.match(repairCenterPanelSource, /props\.uiText\("Scan orphans"\)/);
  assert.match(repairCenterPanelSource, /props\.uiText\("Preview cleanup"\)/);
  assert.match(repairCenterPanelSource, /props\.uiText\("No repair issues from latest scan\."\)/);
  assert.match(repairCenterPanelSource, /className="photo-repair-scope"/);
  assert.match(backupCheckPanelSource, /export function PhotoBackupCheckPanel/);
  assert.match(backupCheckPanelSource, /photo-backup-check-panel/);
  assert.match(backupCheckPanelSource, /props\.backupPolicyStatusText/);
  assert.match(backupCheckPanelSource, /props\.formatCount\(props\.backupCheck\.counts\.missingOriginals\)/);
  assert.match(backupPolicyPanelSource, /export function PhotoBackupPolicyPanel/);
  assert.match(backupPolicyPanelSource, /props\.uiText\("Scheduled backup checks"\)/);
  assert.match(backupPolicyPanelSource, /props\.onChange\(\{ enabled:/);
  assert.match(backupPolicyPanelSource, /props\.onChange\(\{ autoCheckOnOpen:/);
  assert.match(backupPolicyPanelSource, /props\.onChange\(\{ intervalHours:/);
  assert.match(backupPolicyPanelSource, /props\.onChange\(\{ includeGenerated:/);
  assert.match(backupPolicyPanelSource, /props\.formatCount\(props\.status\.counts\.assetsRequiringExternalBackup\)/);
  assert.match(source, /window\.addEventListener\("blur", scheduleWhenBackgrounded\)/);
  assert.match(source, /window\.addEventListener\("focus", cancelBackgroundSchedule\)/);
  assert.doesNotMatch(source, /window\.addEventListener\("blur", runWhenBackgrounded\)/);
  assert.match(catalogCleanupPreviewPanelSource, /export function PhotoCatalogCleanupPreviewPanel/);
  assert.match(catalogCleanupPreviewPanelSource, /photo-catalog-cleanup-preview/);
  assert.match(catalogCleanupPreviewPanelSource, /props\.value\.operations\.filter/);
  assert.match(catalogCleanupPreviewPanelSource, /operationRows\.slice\(0, 6\)\.map/);
  assert.match(catalogCleanupPreviewPanelSource, /props\.onApply/);
  assert.match(catalogCleanupPreviewPanelSource, /props\.cleaning \? props\.uiText\("Cleaning"\) : props\.uiText\("Apply cleanup"\)/);
  assert.match(repairHistoryListSource, /export function PhotoRepairHistoryList/);
  assert.match(repairHistoryListSource, /photo-repair-history-list/);
  assert.match(repairHistoryListSource, /props\.uiText\("Recent repair history"\)/);
  assert.match(repairHistoryListSource, /events\.slice\(0, 5\)\.map/);
  assert.match(repairHistoryListSource, /photoRepairHistoryEventDetails\(event\)/);
  assert.match(repairHistoryListSource, /formatDateText\(event\.at\)/);
  assert.match(repairIssueListSource, /export function PhotoRepairIssueList/);
  assert.match(repairIssueListSource, /photo-repair-issue-list/);
  assert.match(repairIssueListSource, /photo-repair-issue-scope/);
  assert.match(repairIssueListSource, /photoRepairIssueActionLabel\(issue\.action\)/);
  assert.match(repairIssueListSource, /props\.onAction\(issue\)/);
  assert.match(repairIssueListSource, /props\.isActionDisabled\(issue\)/);
  assert.match(repairIssueListSource, /action === "openRecovered" \|\| action === "relinkMissingOriginal"/);
  assert.match(restoreRehearsalPanelsSource, /export function PhotoRestoreRehearsalSummary/);
  assert.match(restoreRehearsalPanelsSource, /export function PhotoBackupRestoreRehearsalSummary/);
  assert.match(restoreRehearsalPanelsSource, /photo-restore-rehearsal-details/);
  assert.match(restoreRehearsalPanelsSource, /photo-backup-restore-details/);
  assert.match(restoreRehearsalPanelsSource, /props\.detailRows\.slice\(0, 6\)\.map/);
  assert.match(restoreRehearsalPanelsSource, /props\.checkRows\.slice\(0, 7\)\.map/);
  assert.match(restoreRehearsalPanelsSource, /photoFileName\(sourcePath\) \|\| row\.operationLabel/);
  assert.match(styles, /\.photo-managed-root-health-panel/);
  assert.match(styles, /\.photo-catalog-cleanup-preview/);
  assert.match(styles, /\.photo-repair-scope/);
  assert.match(styles, /\.photo-repair-issue-scope/);
  assert.doesNotMatch(source, /Array\.isArray\(photoRestoreRehearsalValue\?\.operations\)/);
  assert.doesNotMatch(source, /Array\.isArray\(photoBackupRestoreRehearsalValue\?\.checks\)/);
  assert.doesNotMatch(source, /const rank = \(row: typeof rows\[number\]\)/);
  assert.doesNotMatch(source, /photoRepairScopeFallbackName/);
  assert.doesNotMatch(source, /photoBackupCheck\s*\?\s*\(photoBackupCheck\.scope\?\.libraryRoot/);
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

run("Photos consolidation result and history panels stay outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/views/photoConsolidationPanels.tsx"), "utf8");
  assert.match(source, /PhotoConsolidationResultPanel/);
  assert.match(source, /summary=\{photoConsolidationSummary\}/);
  assert.match(source, /error=\{photoConsolidationError\}/);
  assert.match(source, /status=\{photoConsolidationStatus\}/);
  assert.match(source, /PhotoConsolidationHistoryPanel/);
  assert.match(source, /rows=\{photoConsolidationHistoryRows\}/);
  assert.doesNotMatch(source, /function renderPhotoConsolidationResult/);
  assert.doesNotMatch(source, /function renderPhotoConsolidationHistory/);
  assert.doesNotMatch(source, /photo-consolidation-result/);
  assert.doesNotMatch(source, /photo-consolidation-history/);
  assert.match(panelSource, /export function PhotoConsolidationResultPanel/);
  assert.match(panelSource, /export function PhotoConsolidationHistoryPanel/);
  assert.match(panelSource, /props\.uiText\("Consolidation result"\)/);
  assert.match(panelSource, /props\.uiText\("Recent consolidations"\)/);
  assert.match(panelSource, /props\.summary\.metrics\.map/);
  assert.match(panelSource, /props\.rows\.map/);
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
    contentCredentials: [],
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
    contentCredentials: [],
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
    contentCredentials: [],
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
  }).depthMetadata, "Depth map available, Portrait, Cinematic");
  assert.strictEqual(infoMetadataMod.buildPhotoTechnicalMetadata({
    assetMetadata: {
      aperture: 1.8,
      fNumber: 1.8,
      focusDistance: 0.7,
      focusPoint: "center",
    },
  }).depthMetadata, "");
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

run("photo info draft helpers normalize metadata and detect dirty state", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const infoDraftSource = fs.readFileSync(path.join(ROOT, "src/views/photoInfoDraft.ts"), "utf8");
  const item = {
    title: "Harbor",
    caption: "Night ferry",
    keywords: ["Family", "Travel"],
    originalCaptureDate: "2026-07-01",
    dateOverride: "2026-07-02",
    locationOverride: { label: "Pier", latitude: "37.8", longitude: "-122.4" },
    locationHidden: false,
    assetMetadata: {
      accessibilityDescription: ["Harbor lights", "harbor lights", ""],
      altText: "Backup",
      ocrText: "Gate\nA",
      liveText: [{ text: "Ticket" }, { label: "Gate A", confidence: 0.91 }],
      detectedText: "Receipt",
      localDepthControls: {
        mode: "portrait",
        modeLabel: "Portrait",
        aperture: "2.8",
        focusDistance: "0.9",
        effect: "Studio Light",
      },
      descriptionRegions: [
        { text: "Sign", x: 10, y: 10, width: 20, height: 20 },
      ],
    },
  };
  const descriptionRegions = descriptionRegionsMod.buildPhotoDescriptionRegions(item);

  assert.strictEqual(infoDraftMod.photoAccessibleDescription(item), "Harbor lights Backup");
  assert.strictEqual(infoDraftMod.photoEditableAccessibleDescription(item), "Harbor lights");
  assert.deepStrictEqual(infoDraftMod.photoMetadataTextValues({ checked: true, confidence: 0.8, custom: 1 }), ["checked", "custom"]);
  assert.strictEqual(infoDraftMod.photoDetectedText(item), "Gate A, Ticket, Receipt");
  assert.strictEqual(infoDraftMod.hasPhotoLocationOverride(item), true);
  assert.strictEqual(infoDraftMod.hasPhotoLocationOverride({ locationOverride: { label: " ", latitude: "", longitude: "" } }), false);
  assert.deepStrictEqual(infoDraftMod.photoInfoLocationDraftFromItem(item), {
    label: "Pier",
    latitude: "37.8",
    longitude: "-122.4",
    hidden: false,
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoLocationDraftFromItem({
    locationOverride: { label: 123, latitude: 37.8, longitude: -122.4 },
    locationHidden: true,
  }), {
    label: "123",
    latitude: "37.8",
    longitude: "-122.4",
    hidden: true,
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoLocationDraftFromItem({ locationOverride: "bad" }), {
    label: "",
    latitude: "",
    longitude: "",
    hidden: false,
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoLocationOverrideFromDraft({
    label: " Pier ",
    latitude: " 37.8 ",
    longitude: " -122.4 ",
    hidden: true,
  }), {
    label: "Pier",
    latitude: "37.8",
    longitude: "-122.4",
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoLocationOverrideFromDraft({
    label: " ",
    latitude: "",
    longitude: "\t",
    hidden: false,
  }), {});
  assert.strictEqual(infoDraftMod.photoInfoLocationDraftChanged(item, {
    label: "Pier",
    latitude: "37.8",
    longitude: "-122.4",
    hidden: false,
  }), false);
  assert.strictEqual(infoDraftMod.photoInfoLocationDraftChanged(item, {
    label: "Pier",
    latitude: "37.8",
    longitude: "-122.4",
    hidden: true,
  }), true);
  assert.strictEqual(infoDraftMod.photoInfoLocationDraftChanged(item, {
    label: " Pier ",
    latitude: "37.8",
    longitude: "-122.4",
    hidden: false,
  }), true);
  assert.strictEqual(infoDraftMod.photoInfoLocationDraftChanged({
    locationOverride: { latitude: 0, longitude: 0 },
    locationHidden: false,
  }, {
    label: "",
    latitude: "0",
    longitude: "0",
    hidden: false,
  }), false);
  assert.deepStrictEqual(infoDraftMod.emptyPhotoInfoLocationDraft(), {
    label: "",
    latitude: "",
    longitude: "",
    hidden: false,
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoDateDraftsFromItem({
    originalCaptureDate: "2026-07-01T09:30:00+05:30",
    dateOverride: "2026-07-02",
  }), {
    original: { date: "2026-07-01", time: "09:30", timezone: "+05:30" },
    dateOverride: { date: "2026-07-02", time: "", timezone: "" },
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoOriginalDateDraftFromItem({
    originalCaptureDate: "bad",
  }), {
    date: "",
    time: "",
    timezone: "",
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoDateOverrideDraftFromItem({
    dateOverride: "2026-07-03T7:00:00Z",
  }), {
    date: "2026-07-03",
    time: "",
    timezone: "Z",
  });
  assert.deepStrictEqual(infoDraftMod.emptyPhotoInfoDateTimeDraft(), {
    date: "",
    time: "",
    timezone: "",
  });
  assert.strictEqual(infoDraftMod.photoXmpConflictCleanText("  Pier\n39\t "), "Pier 39");
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "title",
    sidecar: " Harbor title ",
    sidecarValue: null,
  }), { title: "Harbor title" });
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "caption",
    sidecar: "Night ferry",
    sidecarValue: " Sidecar caption ",
  }), { caption: "Sidecar caption" });
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "dateOverride",
    sidecar: "2026-07-04",
    sidecarValue: undefined,
  }), { dateOverride: "2026-07-04" });
  assert.strictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "dateOverride",
    sidecar: "",
    sidecarValue: " ",
  }), null);
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "keywords",
    sidecar: " Family, Travel , ",
    sidecarValue: null,
  }), { keywords: ["Family", "Travel"] });
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "keywords",
    sidecar: "",
    sidecarValue: [" Family ", "", "Travel\nPlans"],
  }), { keywords: ["Family", "Travel Plans"] });
  assert.deepStrictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "locationOverride",
    sidecar: "",
    sidecarValue: { label: " Pier 39 ", latitude: " 37.8 ", longitude: "-122.4" },
  }), { locationOverride: { label: "Pier 39", latitude: "37.8", longitude: "-122.4" }, locationHidden: false });
  assert.strictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "locationOverride",
    sidecar: "",
    sidecarValue: { label: " " },
  }), null);
  assert.strictEqual(infoDraftMod.photoXmpConflictPatch({
    field: "unsupported",
    sidecar: "value",
    sidecarValue: "value",
  }), null);

  assert.strictEqual(infoDraftMod.restoredPhotoCaptureDate(item, "2026-08-01"), "2026-08-01");
  assert.strictEqual(infoDraftMod.restoredPhotoCaptureDate(item, ""), "2026-07-01");
  assert.strictEqual(infoDraftMod.restoredPhotoCaptureDate({ captureDate: "2026-07-02T10:00:00Z", dateOverride: "2026-07-02" }, ""), "");
  assert.strictEqual(infoDraftMod.restoredPhotoCaptureDate({ captureDate: "2026-07-03T10:00:00Z", dateOverride: "2026-07-02" }, ""), "2026-07-03T10:00:00Z");
  assert.deepStrictEqual(
    infoDraftMod.photoMetadataUpdatePayload({
      sourcePath: " /photos/metadata.jpg ",
      assetId: 42,
    }, {
      keywords: ["Family"],
      favorite: true,
    }),
    {
      sourcePath: "/photos/metadata.jpg",
      assetId: "42",
      keywords: ["Family"],
      favorite: true,
    },
  );
  assert.deepStrictEqual(
    infoDraftMod.photoMetadataUpdatePayload(null, { hidden: true }),
    {
      sourcePath: "",
      assetId: "",
      hidden: true,
    },
  );
  assert.deepStrictEqual(infoDraftMod.photoInfoVisibilityOperationPayload("hide", [" /photos/a.jpg ", "", null, "/photos/b.jpg"], "ignored"), {
    action: "hide",
    sourcePaths: ["/photos/a.jpg", "/photos/b.jpg"],
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoVisibilityOperationPayload("delete", [" /photos/a.jpg "], " 2026-07-09T12:00:00Z "), {
    action: "delete",
    sourcePaths: ["/photos/a.jpg"],
    deletedAt: "2026-07-09T12:00:00Z",
  });
  assert.strictEqual(infoDraftMod.photoInfoVisibilityOperationPayload("restore", [" ", ""]), null);
  assert.deepStrictEqual(infoDraftMod.photoInfoPermanentDeletePayload([" /photos/a.jpg ", "", "/photos/b.jpg"]), {
    sourcePaths: ["/photos/a.jpg", "/photos/b.jpg"],
  });
  assert.strictEqual(infoDraftMod.photoInfoPermanentDeletePayload([" ", null]), null);
  assert.deepStrictEqual(infoDraftMod.photoInfoRetentionDeleteDraft("7.6"), {
    days: 8,
    payload: { olderThanDays: 8 },
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoRetentionDeleteDraft("nope"), {
    days: 30,
    payload: { olderThanDays: 30 },
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoRetentionDeleteDraft(99999), {
    days: 3650,
    payload: { olderThanDays: 3650 },
  });
  assert.deepStrictEqual(
    infoDraftMod.photoInfoMetadataPatchFromDraft({
      title: "Harbor patched",
      caption: "Night ferry patched",
      accessibilityDescription: "Harbor lights patched",
      descriptionRegions,
      keywords: "travel, family, travel",
      dateOverride: "2026-07-05",
      location: {
        label: " Pier ",
        latitude: " 37.9 ",
        longitude: "",
        hidden: true,
      },
      localDepthControls: {
        mode: "portrait",
        aperture: "2.8",
        focusDistance: "0.9",
        effect: "Studio Light",
      },
      captureDate: "",
    }),
    {
      title: "Harbor patched",
      caption: "Night ferry patched",
      accessibilityDescription: "Harbor lights patched",
      descriptionRegions: descriptionRegionsMod.serializePhotoDescriptionRegions(descriptionRegions),
      keywords: ["travel", "family"],
      dateOverride: "2026-07-05",
      locationOverride: { label: "Pier", latitude: "37.9" },
      locationHidden: true,
      localDepthControls: {
        mode: "portrait",
        modeLabel: "Portrait",
        aperture: "2.8",
        focusDistance: "0.9",
        effect: "Studio Light",
      },
      captureDate: "",
    },
  );
  const savedMetadataItem = {
    sourcePath: "/photos/saved.jpg",
    assetId: "saved",
    title: "Old title",
    caption: "Old caption",
    keywords: ["Old"],
    favorite: false,
    hidden: true,
    deletedAt: "",
    captureDate: "2026-07-02T10:00:00Z",
    originalCaptureDate: "2026-07-01T09:00:00Z",
    dateOverride: "2026-07-02",
    locationOverride: { label: "Old pier" },
    locationHidden: true,
    assetMetadata: {
      accessibilityDescription: "Old description",
      descriptionRegions: [{ text: "Old region", x: 1, y: 1, width: 10, height: 10 }],
      objectTagReview: { entries: [{ label: "old object" }] },
      utilityClassifierReview: { entries: [{ kind: "old utility" }] },
      localDepthControls: { mode: "portrait" },
      keepMetadata: "yes",
    },
  };
  assert.deepStrictEqual(
    infoDraftMod.photoInfoSavedMetadataPatch(savedMetadataItem, {
      title: "Patch title",
      caption: "Patch caption",
      keywords: ["Patch"],
      favorite: true,
      hidden: false,
      deletedAt: "2026-07-20",
      dateOverride: "2026-07-03",
      locationOverride: { label: "Patch place" },
      locationHidden: true,
      accessibilityDescription: "Patch description",
      descriptionRegions: [{ text: "Patch region", x: 2, y: 3, width: 20, height: 10 }],
      objectTagReview: { entries: [{ label: "patch object" }] },
      utilityClassifierReview: { entries: [{ kind: "patch utility" }] },
      localDepthControls: { mode: "portrait" },
      captureDate: "2026-07-01T08:00:00Z",
    }, {
      assetId: "backend",
      title: "Backend title",
      keywords: ["Backend", 99, ""],
      assetMetadata: {
        objectTagReview: { entries: [{ label: "backend object" }] },
        utilityClassifierReview: {},
        localDepthControls: {},
        backendMetadata: "yes",
      },
      accessibilityDescription: " Backend description\n ",
      descriptionRegions: [{ text: "Backend region", x: 5, y: 6, width: 30, height: 12 }],
      locationOverride: {},
      locationHidden: false,
      captureDate: "2026-07-01T08:15:00Z",
    }),
    {
      assetId: "backend",
      title: "Backend title",
      caption: "Patch caption",
      keywords: ["Backend", "99"],
      favorite: true,
      hidden: false,
      deletedAt: "2026-07-20",
      dateOverride: "2026-07-03",
      locationOverride: {},
      locationHidden: false,
      assetMetadata: {
        accessibilityDescription: "Backend description",
        descriptionRegions: [{ id: "description-region-0", text: "Backend region", x: 5, y: 6, width: 30, height: 12 }],
        objectTagReview: { entries: [{ label: "backend object" }] },
        keepMetadata: "yes",
        backendMetadata: "yes",
      },
      originalCaptureDate: "2026-07-01T08:15:00Z",
      captureDate: "2026-07-03",
    },
  );
  assert.deepStrictEqual(
    infoDraftMod.photoInfoSavedMetadataPatch(savedMetadataItem, {
      accessibilityDescription: "",
      descriptionRegions: [],
      objectTagReview: { entries: [] },
      utilityClassifierReview: { entries: [] },
      localDepthControls: null,
      dateOverride: "",
    }, {}),
    {
      assetId: "saved",
      title: "Old title",
      caption: "Old caption",
      keywords: ["Old"],
      favorite: false,
      hidden: true,
      deletedAt: "",
      dateOverride: "",
      locationOverride: { label: "Old pier" },
      locationHidden: true,
      assetMetadata: {
        keepMetadata: "yes",
      },
      captureDate: "2026-07-01T09:00:00Z",
    },
  );
  assert.deepStrictEqual(infoDraftMod.photoInfoFavoriteBatchUpdates([
    { sourcePath: "/photos/a.jpg", assetId: "a", favorite: true },
    { sourcePath: "/photos/b.jpg", assetId: "b", favorite: false },
  ]), {
    favorite: true,
    updates: [
      { sourcePath: "/photos/a.jpg", assetId: "a", favorite: true },
      { sourcePath: "/photos/b.jpg", assetId: "b", favorite: true },
    ],
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoFavoriteBatchUpdates([
    { sourcePath: "/photos/a.jpg", assetId: "a", favorite: true },
    { sourcePath: "/photos/b.jpg", assetId: "b", favorite: true },
  ]), {
    favorite: false,
    updates: [
      { sourcePath: "/photos/a.jpg", assetId: "a", favorite: false },
      { sourcePath: "/photos/b.jpg", assetId: "b", favorite: false },
    ],
  });
  assert.deepStrictEqual(infoDraftMod.photoInfoApplyFavoriteBatchResult([
    { sourcePath: "/photos/a.jpg", assetId: "a", favorite: false, title: "A" },
    { sourcePath: "/photos/b.jpg", assetId: "b", favorite: false, title: "B" },
    { sourcePath: "/photos/c.jpg", assetId: "c", favorite: false, title: "C" },
  ], [
    { sourcePath: "/photos/a.jpg" },
    { sourcePath: "/photos/b.jpg" },
  ], {
    items: [
      { sourcePath: " /photos/a.jpg ", favorite: false },
    ],
  }, true), [
    { sourcePath: "/photos/a.jpg", assetId: "a", favorite: false, title: "A" },
    { sourcePath: "/photos/b.jpg", assetId: "b", favorite: true, title: "B" },
    { sourcePath: "/photos/c.jpg", assetId: "c", favorite: false, title: "C" },
  ]);
  const bulkItems = [
    {
      sourcePath: "/photos/a.jpg",
      assetId: "a",
      keywords: ["Travel"],
      dateOverride: "2026-07-10",
      captureDate: "2026-07-10T09:00:00Z",
    },
    {
      sourcePath: "/photos/b.jpg",
      assetId: "b",
      keywords: ["Family"],
      captureDate: "2026-07-11T10:30:00Z",
    },
  ];
  assert.deepStrictEqual(infoDraftMod.photoInfoKeywordBulkUpdates(bulkItems, "Travel, Food", "add"), [
    { sourcePath: "/photos/a.jpg", assetId: "a", keywords: ["Travel", "Food"] },
    { sourcePath: "/photos/b.jpg", assetId: "b", keywords: ["Family", "Travel", "Food"] },
  ]);
  assert.deepStrictEqual(infoDraftMod.photoInfoKeywordBulkUpdates(bulkItems, "travel", "remove"), [
    { sourcePath: "/photos/a.jpg", assetId: "a", keywords: [] },
    { sourcePath: "/photos/b.jpg", assetId: "b", keywords: ["Family"] },
  ]);
  const shortcutAdd = infoDraftMod.photoInfoKeywordShortcutUpdates(bulkItems, "Food");
  assert.strictEqual(shortcutAdd.removeKeyword, false);
  assert.deepStrictEqual(shortcutAdd.updates, [
    { sourcePath: "/photos/a.jpg", assetId: "a", keywords: ["Travel", "Food"] },
    { sourcePath: "/photos/b.jpg", assetId: "b", keywords: ["Family", "Food"] },
  ]);
  assert.deepStrictEqual(Array.from(shortcutAdd.nextBySource.entries()), [
    ["/photos/a.jpg", ["Travel", "Food"]],
    ["/photos/b.jpg", ["Family", "Food"]],
  ]);
  const shortcutRemove = infoDraftMod.photoInfoKeywordShortcutUpdates([
    { sourcePath: "/photos/c.jpg", assetId: "c", keywords: ["Food", "Travel"] },
    { sourcePath: "/photos/d.jpg", assetId: "d", keywords: ["food"] },
  ], "Food");
  assert.strictEqual(shortcutRemove.removeKeyword, true);
  assert.deepStrictEqual(shortcutRemove.updates, [
    { sourcePath: "/photos/c.jpg", assetId: "c", keywords: ["Travel"] },
    { sourcePath: "/photos/d.jpg", assetId: "d", keywords: [] },
  ]);
  const offsetBulk = infoDraftMod.photoInfoDateOffsetBulkUpdates(bulkItems, 2);
  assert.deepStrictEqual(offsetBulk.updates, [
    { sourcePath: "/photos/a.jpg", assetId: "a", dateOverride: "2026-07-12" },
    { sourcePath: "/photos/b.jpg", assetId: "b", dateOverride: "2026-07-13T10:30:00Z" },
  ]);
  assert.deepStrictEqual(Array.from(offsetBulk.nextBySource.entries()), [
    ["/photos/a.jpg", { dateOverride: "2026-07-12", captureDate: "2026-07-12" }],
    ["/photos/b.jpg", { dateOverride: "2026-07-13T10:30:00Z", captureDate: "2026-07-13T10:30:00Z" }],
  ]);
  const timezoneBulk = infoDraftMod.photoInfoTimezoneBulkUpdates([
    {
      sourcePath: "/photos/a.jpg",
      assetId: "a",
      keywords: ["Travel"],
      captureDate: "2026-07-10T09:00:00Z",
    },
    bulkItems[1],
  ], "+05:30");
  assert.deepStrictEqual(timezoneBulk.updates, [
    { sourcePath: "/photos/a.jpg", assetId: "a", dateOverride: "2026-07-10T09:00:00+05:30" },
    { sourcePath: "/photos/b.jpg", assetId: "b", dateOverride: "2026-07-11T10:30:00+05:30" },
  ]);
  assert.deepStrictEqual(Array.from(timezoneBulk.nextBySource.entries()), [
    ["/photos/a.jpg", { dateOverride: "2026-07-10T09:00:00+05:30", captureDate: "2026-07-10T09:00:00+05:30" }],
    ["/photos/b.jpg", { dateOverride: "2026-07-11T10:30:00+05:30", captureDate: "2026-07-11T10:30:00+05:30" }],
  ]);

  assert.strictEqual(infoDraftMod.infoDraftChanged(
    item,
    "Harbor",
    "Night ferry",
    "Harbor\nlights",
    descriptionRegions,
    "travel, family",
    "2026-07-01",
    "",
    "",
    "2026-07-02",
    "",
    "",
    "Pier",
    "37.8",
    "-122.4",
    false,
    "portrait",
    "2.8",
    "0.9",
    "Studio Light",
  ), false);
  assert.strictEqual(infoDraftMod.infoDraftChanged(
    item,
    "Harbor edited",
    "Night ferry",
    "Harbor lights",
    descriptionRegions,
    "travel, family",
    "2026-07-01",
    "",
    "",
    "2026-07-02",
    "",
    "",
    "Pier",
    "37.8",
    "-122.4",
    false,
    "portrait",
    "2.8",
    "0.9",
    "Studio Light",
  ), true);
  assert.strictEqual(infoDraftMod.infoDraftChanged(
    item,
    "Harbor",
    "Night ferry",
    "Harbor lights",
    descriptionRegions,
    "travel, family",
    "2026-07-01",
    "",
    "",
    "2026-07-02",
    "",
    "",
    "Pier",
    "37.8",
    "-122.4",
    false,
    "portrait",
    "4",
    "0.9",
    "Studio Light",
  ), true);

  assert.match(photosViewSource, /from "\.\/photoInfoDraft"/);
  assert.match(photosViewSource, /photoInfoLocationDraftFromItem/);
  assert.match(photosViewSource, /emptyPhotoInfoLocationDraft/);
  assert.match(photosViewSource, /photoInfoDateDraftsFromItem/);
  assert.match(photosViewSource, /photoInfoDateOverrideDraftFromItem/);
  assert.match(photosViewSource, /photoInfoOriginalDateDraftFromItem/);
  assert.match(photosViewSource, /emptyPhotoInfoDateTimeDraft/);
  assert.match(photosViewSource, /photoInfoKeywordBulkUpdates/);
  assert.match(photosViewSource, /photoInfoKeywordShortcutUpdates/);
  assert.match(photosViewSource, /photoInfoDateOffsetBulkUpdates/);
  assert.match(photosViewSource, /photoInfoTimezoneBulkUpdates/);
  assert.match(photosViewSource, /photoInfoFavoriteBatchUpdates/);
  assert.match(photosViewSource, /photoInfoApplyFavoriteBatchResult/);
  assert.match(photosViewSource, /photoInfoVisibilityOperationPayload/);
  assert.match(photosViewSource, /photoInfoPermanentDeletePayload/);
  assert.match(photosViewSource, /photoInfoRetentionDeleteDraft/);
  const visibilityBlock = photosViewSource.match(/async function applyVisibilityAction\(action: PhotoInfoVisibilityAction, sourcePaths: string\[\]\) \{[\s\S]*?\n  \}\n\n  async function hidePhoto/);
  assert.ok(visibilityBlock, "applyVisibilityAction should exist");
  assert.match(visibilityBlock[0], /photoInfoVisibilityOperationPayload\(action, sourcePaths, new Date\(\)\.toISOString\(\)\)/);
  assert.match(visibilityBlock[0], /await applyPhotoVisibilityOperation\(payload\)/);
  const permanentlyDeleteBlock = photosViewSource.match(/async function permanentlyDeletePhoto\(item: PhotoItem\) \{[\s\S]*?\n  \}\n\n  async function mergeDuplicateGroup/);
  assert.ok(permanentlyDeleteBlock, "permanentlyDeletePhoto should exist");
  assert.match(permanentlyDeleteBlock[0], /const payload = photoInfoPermanentDeletePayload\(\[item\.sourcePath\]\)/);
  assert.match(permanentlyDeleteBlock[0], /await permanentlyDeletePhotos\(payload\)/);
  const permanentlyDeleteSelectedBlock = photosViewSource.match(/async function permanentlyDeleteSelected\(\) \{[\s\S]*?\n  \}\n\n  async function cleanupRecentlyDeletedByRetention/);
  assert.ok(permanentlyDeleteSelectedBlock, "permanentlyDeleteSelected should exist");
  assert.match(permanentlyDeleteSelectedBlock[0], /const payload = photoInfoPermanentDeletePayload\(selectedSourcePaths\)/);
  assert.match(permanentlyDeleteSelectedBlock[0], /await permanentlyDeletePhotos\(payload\)/);
  const retentionDeleteBlock = photosViewSource.match(/async function cleanupRecentlyDeletedByRetention\(\) \{[\s\S]*?\n  \}\n\n  async function undoLatestPhotoOperation/);
  assert.ok(retentionDeleteBlock, "cleanupRecentlyDeletedByRetention should exist");
  assert.match(retentionDeleteBlock[0], /const retentionDelete = photoInfoRetentionDeleteDraft\(recentlyDeletedRetentionDays\)/);
  assert.match(retentionDeleteBlock[0], /await permanentlyDeletePhotos\(retentionDelete\.payload\)/);
  assert.match(photosViewSource, /photoInfoLocationDraftChanged/);
  assert.match(photosViewSource, /photoInfoMetadataPatchFromDraft/);
  assert.match(photosViewSource, /photoInfoSavedMetadataPatch/);
  assert.match(photosViewSource, /photoXmpConflictPatch/);
  assert.match(photosViewSource, /function applyLightboxLocationDraft\(draft: PhotoInfoLocationDraft\)/);
  assert.match(photosViewSource, /function applyLightboxDateDrafts\(drafts: PhotoInfoDateDrafts\)/);
  assert.match(photosViewSource, /photoMetadataUpdatePayload,/);
  assert.doesNotMatch(photosViewSource, /function infoDraftChanged/);
  assert.doesNotMatch(photosViewSource, /function photoMetadataTextValues/);
  assert.doesNotMatch(photosViewSource, /function photoXmpConflictCleanText/);
  assert.doesNotMatch(photosViewSource, /function photoXmpConflictPatch/);
  assert.doesNotMatch(photosViewSource, /const locationValue =/);
  assert.doesNotMatch(photosViewSource, /setLocationLabelDraft\(String\(saved\.locationOverride\?\.label \|\| ""\)\)/);
  assert.doesNotMatch(photosViewSource, /setLocationLabelDraft\(""\);\s*setLocationLatitudeDraft\(""\);\s*setLocationLongitudeDraft\(""\);\s*setLocationHiddenDraft\(false\);/);
  assert.doesNotMatch(photosViewSource, /const dateTime = splitPhotoDateTimeOverride\(lightItem\?\.dateOverride/);
  assert.doesNotMatch(photosViewSource, /setDateDraft\(""\);\s*setTimeDraft\(""\);\s*setTimezoneDraft\(""\);/);
  assert.doesNotMatch(photosViewSource, /const locationOverride: Record<string, unknown> = \{\};/);
  assert.doesNotMatch(photosViewSource, /locationLabelDraft !== String\(item\.locationOverride\?\.label \|\| ""\)/);
  assert.doesNotMatch(photosViewSource, /photoInfoLocationOverrideFromDraft/);
  assert.doesNotMatch(photosViewSource, /photoLocalDepthControlsPayload/);
  assert.doesNotMatch(photosViewSource, /updates\.push\(photoMetadataUpdatePayload\(item, \{\s*keywords: nextKeywords/);
  assert.doesNotMatch(photosViewSource, /updates\.push\(photoMetadataUpdatePayload\(item, \{\s*dateOverride: nextDate/);
  assert.doesNotMatch(photosViewSource, /const sourceDate = item\.dateOverride \|\| item\.captureDate \|\| item\.originalCaptureDate/);
  assert.doesNotMatch(photosViewSource, /const valueAssetMetadata =/);
  assert.doesNotMatch(photosViewSource, /const nextAssetMetadata =/);
  assert.doesNotMatch(photosViewSource, /const favoriteBySource = new Map<string, boolean>/);
  assert.doesNotMatch(visibilityBlock[0], /sourcePaths\.map\(\(path\) => String\(path \|\| ""\)\.trim\(\)\)\.filter\(Boolean\)/);
  assert.doesNotMatch(visibilityBlock[0], /\.\.\.\(action === "delete" \? \{ deletedAt: new Date\(\)\.toISOString\(\) \} : \{\}\)/);
  assert.doesNotMatch(permanentlyDeleteBlock[0], /permanentlyDeletePhotos\(\{\s*sourcePaths: \[item\.sourcePath\]\s*\}\)/);
  assert.doesNotMatch(permanentlyDeleteSelectedBlock[0], /permanentlyDeletePhotos\(\{\s*sourcePaths: selectedSourcePaths\s*\}\)/);
  assert.doesNotMatch(retentionDeleteBlock[0], /Math\.max\(1, Math\.min\(3650, Math\.round\(Number\(recentlyDeletedRetentionDays\) \|\| 30\)\)\)/);
  assert.doesNotMatch(retentionDeleteBlock[0], /permanentlyDeletePhotos\(\{\s*olderThanDays: days\s*\}\)/);
  assert.doesNotMatch(photosViewSource, /updatePhotoAssetMetadata\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(photosViewSource, /updates\.push\(\{\s*sourcePath: item\.sourcePath,\s*assetId: item\.assetId \|\| ""/);
  assert.match(infoDraftSource, /export function infoDraftChanged/);
  assert.match(infoDraftSource, /export function photoInfoSavedMetadataPatch/);
  assert.match(infoDraftSource, /export function photoInfoVisibilityOperationPayload/);
  assert.match(infoDraftSource, /export function photoInfoPermanentDeletePayload/);
  assert.match(infoDraftSource, /export function photoInfoRetentionDeleteDraft/);
  assert.match(infoDraftSource, /export function photoInfoFavoriteBatchUpdates/);
  assert.match(infoDraftSource, /export function photoInfoApplyFavoriteBatchResult/);
  assert.match(infoDraftSource, /export function photoInfoKeywordBulkUpdates/);
  assert.match(infoDraftSource, /export function photoInfoKeywordShortcutUpdates/);
  assert.match(infoDraftSource, /export function photoInfoDateOffsetBulkUpdates/);
  assert.match(infoDraftSource, /export function photoInfoTimezoneBulkUpdates/);
  assert.match(infoDraftSource, /export function photoInfoLocationDraftFromItem/);
  assert.match(infoDraftSource, /export function photoInfoLocationDraftChanged/);
  assert.match(infoDraftSource, /export function photoInfoLocationOverrideFromDraft/);
  assert.match(infoDraftSource, /export function photoInfoMetadataPatchFromDraft/);
  assert.match(infoDraftSource, /export function photoInfoDateDraftsFromItem/);
  assert.match(infoDraftSource, /export function photoXmpConflictPatch/);
  assert.match(infoDraftSource, /export function photoMetadataUpdatePayload/);
});

run("photo display text helpers format numbers, locations, and activity rows", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const displayTextSource = fs.readFileSync(path.join(ROOT, "src/views/photoDisplayText.ts"), "utf8");
  const timestamp = "2026-07-01T12:30:00Z";
  const expectedDateText = new Date(timestamp).toLocaleString();

  assert.strictEqual(displayTextMod.numberFromUnknown(42), 42);
  assert.strictEqual(displayTextMod.numberFromUnknown("42.5"), 42.5);
  assert.strictEqual(displayTextMod.numberFromUnknown("nope"), null);
  assert.strictEqual(displayTextMod.identityPhotoUiText("Photos"), "Photos");
  assert.strictEqual(displayTextMod.photoFileName("/Users/ada/Pictures/IMG_0001.JPG"), "IMG_0001.JPG");
  assert.strictEqual(displayTextMod.photoFileName("C:\\Users\\Ada\\Videos\\clip.mov"), "clip.mov");
  assert.strictEqual(displayTextMod.photoFileName("loose-file.png"), "loose-file.png");
  assert.strictEqual(displayTextMod.shortText("abcdefghijklmnopqrstuvwxyz"), "abcdefghij...uvwxyz");
  assert.strictEqual(displayTextMod.shortText("short"), "short");
  assert.strictEqual(displayTextMod.formatBytes(0), "");
  assert.strictEqual(displayTextMod.formatBytes(1536), "1.5 KB");
  assert.strictEqual(displayTextMod.formatBytes(1048576), "1.0 MB");
  assert.strictEqual(displayTextMod.formatDimensions({ width: "4000", height: 3000 }), "4000 x 3000");
  assert.strictEqual(displayTextMod.formatDimensions({ width: "0", height: 3000 }), "");
  assert.strictEqual(displayTextMod.formatDateText(timestamp), expectedDateText);
  assert.strictEqual(displayTextMod.formatDateText("not a date"), "not a date");

  assert.strictEqual(displayTextMod.photoEventMetadataString({ count: 3, ok: true, no: false, label: "  Done  " }, "count"), "3");
  assert.strictEqual(displayTextMod.photoEventMetadataString({ count: 3, ok: true, no: false, label: "  Done  " }, "ok"), "Yes");
  assert.strictEqual(displayTextMod.photoEventMetadataString({ count: 3, ok: true, no: false, label: "  Done  " }, "no"), "No");
  assert.strictEqual(displayTextMod.photoEventMetadataString({ count: 3, ok: true, no: false, label: "  Done  " }, "label"), "Done");
  assert.strictEqual(displayTextMod.photoEventPathName("C:\\Photos\\Export\\image.jpg"), "image.jpg");

  const sharedItem = {
    eventType: "shared",
    eventAt: timestamp,
    eventActor: "desktop",
    eventMetadata: {
      action: "native_share_strip_location",
      targetPath: "/tmp/export/family.jpg",
      surface: "photos-lightbox",
    },
  };
  assert.strictEqual(displayTextMod.photoEventActionLabel({ eventType: "viewed" }), "Viewed");
  assert.strictEqual(displayTextMod.photoEventActionLabel({ eventType: "edited" }), "Activity");
  assert.strictEqual(displayTextMod.photoEventActionLabel(sharedItem), "Shared without location");
  assert.strictEqual(displayTextMod.photoEventContextLabel(sharedItem), "family.jpg");
  assert.strictEqual(displayTextMod.photoEventContextLabel({ eventMetadata: { surface: "photos-export_panel" }, eventActor: "fallback" }), "export panel");
  assert.strictEqual(displayTextMod.photoEventActivityText(sharedItem), `Shared without location · ${expectedDateText} · family.jpg`);
  assert.match(displayTextMod.photoEventActivityTitle(sharedItem), /Shared without location/);
  assert.match(displayTextMod.photoEventActivityTitle(sharedItem), /Action: native_share_strip_location/);

  assert.strictEqual(displayTextMod.formatLocation({ locationHidden: true }), "Hidden");
  assert.strictEqual(displayTextMod.formatLocation({ locationOverride: { label: "Pier", latitude: "37.8", longitude: "-122.4" } }), "Pier (37.8, -122.4)");
  assert.strictEqual(displayTextMod.formatLocation({ locationOverride: { latitude: "37.8", longitude: "-122.4" } }), "37.8, -122.4");
  assert.strictEqual(displayTextMod.formatLocation({ assetMetadata: { exif: { gps: { latitude: "12", longitude: "77" } } } }), "12, 77");
  assert.deepStrictEqual(displayTextMod.dateGroup({ captureDate: "2026-07-03T10:00:00Z" }), { key: "2026-07", label: "2026-07" });
  assert.deepStrictEqual(displayTextMod.dateGroup({ createdAt: "not-date" }), { key: "unknown", label: "Unknown date" });

  assert.match(photosViewSource, /from "\.\/photoDisplayText"/);
  assert.match(photosViewSource, /identityPhotoUiText/);
  assert.match(photosViewSource, /photoFileName/);
  assert.doesNotMatch(photosViewSource, /function photoEventActionLabel/);
  assert.doesNotMatch(photosViewSource, /function formatLocation/);
  assert.doesNotMatch(photosViewSource, /const identityPhotoUiText =/);
  assert.doesNotMatch(photosViewSource, /function photoFileName/);
  assert.match(displayTextSource, /export function photoEventActionLabel/);
});

run("photo error message helper normalizes thrown values", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const errorMessageSource = fs.readFileSync(path.join(ROOT, "src/views/photoErrorMessage.ts"), "utf8");
  assert.strictEqual(errorMessageMod.photoErrorMessage(new Error("Boom")), "Boom");
  assert.strictEqual(errorMessageMod.photoErrorMessage("  backend failed  "), "backend failed");
  assert.strictEqual(errorMessageMod.photoErrorMessage(new Error("")), "Unknown error");
  assert.strictEqual(errorMessageMod.photoErrorMessage({ message: "ignored" }), "Unknown error");
  assert.match(photosViewSource, /photoErrorMessage as errorMessage/);
  assert.doesNotMatch(photosViewSource, /function errorMessage/);
  assert.match(errorMessageSource, /export function photoErrorMessage/);
});

run("photo media-pair helpers normalize related files and statuses", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const mediaPairsSource = fs.readFileSync(path.join(ROOT, "src/views/photoMediaPairs.ts"), "utf8");
  const pairs = mediaPairsMod.normalizePhotoMediaPairList([
    {
      pair_id: "pair-1",
      asset_id: "asset-1",
      pair_kind: "raw_sidecar",
      source_path: "/photos/image.jpg",
      related_source_path: "/photos/image.DNG",
      related_source_url: "vintrace-media://raw-sidecar",
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
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel("depth_sidecar"), "Depth / disparity");
  assert.strictEqual(mediaPairsMod.photoMediaPairKindLabel("stereo_pair"), "Stereo right eye");
  assert.strictEqual(pairs[0].relatedSourceUrl, "vintrace-media://raw-sidecar");
  assert.strictEqual(mediaPairsMod.photoMediaPairFilename(pairs[0]), "image.DNG");
  assert.strictEqual(mediaPairsMod.photoMediaPairFilename(pairs[1]), "clip.jpg");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusLabel(pairs[0]), "Available");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusLabel(pairs[1]), "Missing");
  assert.strictEqual(mediaPairsMod.photoMediaPairStatusKind(pairs[1]), "missing");
  assert.strictEqual(mediaPairsMod.photoMediaPairRelatedPath({ relatedSourcePath: " /photos/related.mov ", relatedExists: true }), "/photos/related.mov");
  assert.strictEqual(mediaPairsMod.photoMediaPairRelatedPath({ relatedSourcePath: "   ", relatedExists: true }), "");
  assert.strictEqual(mediaPairsMod.photoMediaPairRelatedFileAvailable({ relatedSourcePath: " /photos/related.mov ", relatedExists: true }), true);
  assert.strictEqual(mediaPairsMod.photoMediaPairRelatedFileAvailable({ relatedSourcePath: " /photos/related.mov ", relatedExists: false }), false);
  assert.strictEqual(mediaPairsMod.photoMediaPairRelatedFileAvailable({ relatedSourcePath: "   ", relatedExists: true }), false);
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairShareEventMetadata(pairs[0], {
    shared: true,
    relatedSourcePath: " /photos/shared.DNG ",
  }), {
    surface: "photos-related-media",
    action: "native_share_related_media",
    pairKind: "raw_sidecar",
    relatedSourcePath: "/photos/shared.DNG",
  });
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairShareEventMetadata(pairs[1], {
    shared: false,
    surface: " custom-surface ",
  }), {
    surface: "custom-surface",
    action: "share_fallback_reveal_related_media",
    pairKind: "video_still",
    relatedSourcePath: "C:\\Camera\\clip.jpg",
  });
  assert.strictEqual(mediaPairsMod.photoMediaPairCanRemove(pairs[0]), true);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanRemove({ metadata: { producer: "adjacent_non_live_pair" } }), false);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanIgnoreGenerated({ metadata: { producer: "adjacent_non_live_pair" } }), true);
  assert.strictEqual(mediaPairsMod.photoMediaPairCanIgnoreGenerated(pairs[0]), false);
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairHistory(pairs[0]).map((item) => item.label), ["Added"]);
  assert.deepStrictEqual(mediaPairsMod.photoMediaPairHistory(pairs[1]).map((item) => item.label), ["Relinked"]);
  assert.match(photosViewSource, /photoMediaPairRelatedPath\(pair\)/);
  assert.match(photosViewSource, /photoMediaPairRelatedFileAvailable\(pair\)/);
  assert.match(photosViewSource, /metadata: photoMediaPairShareEventMetadata\(pair, \{/);
  assert.doesNotMatch(photosViewSource, /function relatedMediaFilePath/);
  assert.doesNotMatch(photosViewSource, /function relatedMediaFileAvailable/);
  assert.doesNotMatch(photosViewSource, /native_share_related_media/);
  assert.match(mediaPairsSource, /export function photoMediaPairRelatedPath/);
  assert.match(mediaPairsSource, /export function photoMediaPairRelatedFileAvailable/);
  assert.match(mediaPairsSource, /export function photoMediaPairShareEventMetadata/);
});

run("photo media kind helpers identify videos and Live Photo motion metadata", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const mediaKindSource = fs.readFileSync(path.join(ROOT, "src/views/photoMediaKind.ts"), "utf8");
  assert.strictEqual(mediaKindMod.isVideoMediaKind("video"), true);
  assert.strictEqual(mediaKindMod.isVideoMediaKind("screen_recording"), true);
  assert.strictEqual(mediaKindMod.isVideoMediaKind("time_lapse"), true);
  assert.strictEqual(mediaKindMod.isVideoMediaKind("live_photo"), false);
  assert.strictEqual(mediaKindMod.isLivePhotoMediaKind("LIVE_PHOTO"), true);
  assert.strictEqual(mediaKindMod.isLivePhotoMediaKind("video"), false);

  const livePhotoMetadata = {
    pairedVideoPath: "/photos/motion.mov",
    pairedVideoUrl: "vintrace-media://motion",
    keyPhotoPreviewPath: "/photos/key.jpg",
  };
  const liveItem = { assetMetadata: { livePhoto: livePhotoMetadata } };
  assert.strictEqual(mediaKindMod.photoLivePhotoMetadata(liveItem), livePhotoMetadata);
  assert.strictEqual(mediaKindMod.photoLiveMotionPath(liveItem), "/photos/motion.mov");
  assert.strictEqual(mediaKindMod.photoLiveMotionUrl(liveItem), "vintrace-media://motion");
  assert.strictEqual(mediaKindMod.photoLiveKeyPhotoActive(liveItem), true);
  assert.deepStrictEqual(mediaKindMod.photoLivePhotoMetadata({ assetMetadata: { livePhoto: [] } }), {});
  assert.strictEqual(mediaKindMod.photoLiveMotionPath(null), "");
  assert.strictEqual(mediaKindMod.photoLiveMotionUrl({ assetMetadata: { livePhoto: { pairedVideoUrl: 42 } } }), "42");
  assert.strictEqual(mediaKindMod.photoLiveKeyPhotoActive({ assetMetadata: { livePhoto: { keyPhotoPreviewPath: "" } } }), false);
  assert.deepStrictEqual(mediaKindMod.photoVideoPosterPayload({
    sourcePath: " /photos/video.mov ",
    timestampMs: 1234.6,
  }), {
    sourcePath: "/photos/video.mov",
    timestampMs: 1235,
  });
  assert.deepStrictEqual(mediaKindMod.photoVideoPosterPayload({
    sourcePath: " /photos/video.mov ",
    timestampMs: 1234,
    policy: "auto",
  }), {
    sourcePath: "/photos/video.mov",
    policy: "auto",
  });
  assert.deepStrictEqual(mediaKindMod.photoVideoPosterPayload({
    sourcePath: " /photos/video.mov ",
    timestampMs: "bad",
    policy: "manual",
  }), {
    sourcePath: "/photos/video.mov",
    timestampMs: 0,
  });
  assert.deepStrictEqual(mediaKindMod.photoVideoPosterResetPayload({ sourcePath: " /photos/video.mov " }), {
    sourcePath: "/photos/video.mov",
  });
  assert.deepStrictEqual(mediaKindMod.photoLiveKeyPhotoPayload({
    sourcePath: " /photos/live.heic ",
    timestampMs: -25.4,
  }), {
    sourcePath: "/photos/live.heic",
    timestampMs: 0,
  });
  assert.deepStrictEqual(mediaKindMod.photoLiveKeyPhotoResetPayload({ sourcePath: " /photos/live.heic " }), {
    sourcePath: "/photos/live.heic",
  });

  assert.match(photosViewSource, /from "\.\/photoMediaKind"/);
  assert.match(photosViewSource, /isLivePhotoMediaKind\(lightItem\.mediaKind\)/);
  assert.doesNotMatch(photosViewSource, /function photoLiveMotionPath/);
  assert.match(mediaKindSource, /export function photoLiveMotionPath/);
  assert.match(mediaKindSource, /export function photoVideoPosterPayload/);
  assert.match(mediaKindSource, /export function photoLiveKeyPhotoPayload/);
  assert.match(photosViewSource, /setPhotoVideoPoster\(photoVideoPosterPayload\(\{/);
  assert.match(photosViewSource, /setPhotoLiveKeyPhoto\(photoLiveKeyPhotoPayload\(\{/);
  assert.match(photosViewSource, /resetPhotoLiveKeyPhoto\(photoLiveKeyPhotoResetPayload\(\{/);
  assert.match(photosViewSource, /resetPhotoVideoPoster\(photoVideoPosterResetPayload\(\{/);
  assert.doesNotMatch(photosViewSource, /setPhotoVideoPoster\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(photosViewSource, /setPhotoLiveKeyPhoto\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(photosViewSource, /resetPhotoLiveKeyPhoto\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(photosViewSource, /resetPhotoVideoPoster\(\{\s*sourcePath: item\.sourcePath/);
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
  assert.deepStrictEqual(editorMod.photoAlbumEditorPayloadDraft({
    albumId: " album-1 ",
    name: " Trip Album ",
    albumKind: "manual",
    description: "Summer picks",
    includePeople: [" Ada ", "", "Grace"],
    excludePeople: [" Bob "],
    rules: {
      query: ` ${"beach".repeat(60)} `,
      favoriteOnly: true,
      minScore: 2,
    },
    fallbackCoverSourcePath: " /cover.jpg ",
    folderId: " folder-1 ",
  }), {
    albumId: "album-1",
    name: "Trip Album",
    albumKind: "manual",
    description: "Summer picks",
    includePeople: ["Ada", "Grace"],
    excludePeople: ["Bob"],
    rules: {
      query: "beach".repeat(40),
      favoriteOnly: true,
      minScore: 1,
    },
    coverSourcePath: "/cover.jpg",
    folderId: "folder-1",
  });
  assert.deepStrictEqual(editorMod.photoAlbumEditorPayloadDraft({
    name: "  Draft Name  ",
    albumKind: "smart",
    requireName: false,
    trimName: false,
  }), {
    albumId: undefined,
    name: "  Draft Name  ",
    albumKind: "smart",
    description: "",
    includePeople: [],
    excludePeople: [],
    rules: {},
    coverSourcePath: "",
    folderId: "",
  });
  assert.strictEqual(editorMod.photoAlbumEditorPayloadDraft({
    name: " ",
  }), null);
  assert.deepStrictEqual(editorMod.photoManualAlbumAddDraft({
    sourcePaths: [" /a.jpg ", "/b.jpg", "/a.jpg", ""],
    newAlbumName: " Trip Picks ",
  }), {
    albumId: "",
    sourcePaths: ["/a.jpg", "/b.jpg"],
    createAlbum: {
      name: "Trip Picks",
      albumKind: "manual",
      description: "",
      includePeople: [],
      excludePeople: [],
      rules: {},
      coverSourcePath: "/a.jpg",
    },
  });
  assert.deepStrictEqual(editorMod.photoManualAlbumAddDraft({
    sourcePaths: ["/a.jpg"],
    targetAlbumId: " album-2 ",
    newAlbumName: "Ignored",
  }), {
    albumId: "album-2",
    sourcePaths: ["/a.jpg"],
    createAlbum: null,
  });
  assert.strictEqual(editorMod.photoManualAlbumAddDraft({
    sourcePaths: ["/a.jpg"],
    newAlbumName: " ",
  }), null);
  assert.strictEqual(editorMod.photoManualAlbumAddDraft({
    sourcePaths: [],
    targetAlbumId: "album-2",
  }), null);
  assert.deepStrictEqual(editorMod.photoAlbumCoverSaveDraft({
    id: "album:album-1",
    kind: "album",
    albumId: "album-1",
    albumKind: "manual",
    name: "Trip",
    count: 3,
    description: "Summer",
    includePeople: ["Ada"],
    excludePeople: ["Grace"],
    rules: { favoriteOnly: true },
    folderId: "folder-1",
  }, " /cover.jpg "), {
    albumId: "album-1",
    name: "Trip",
    albumKind: "manual",
    description: "Summer",
    includePeople: ["Ada"],
    excludePeople: ["Grace"],
    rules: { favoriteOnly: true },
    coverSourcePath: "/cover.jpg",
    folderId: "folder-1",
  });
  assert.strictEqual(editorMod.photoAlbumCoverSaveDraft({
    id: "album:",
    kind: "album",
    name: "Missing id",
    count: 0,
  }, "/cover.jpg"), null);
  assert.deepStrictEqual(editorMod.photoAlbumDeleteRestoreDraft({
    id: "album:album-1",
    kind: "album",
    albumId: "album-1",
    albumKind: "manual",
    name: "Trip",
    count: 4,
    description: "Rail description",
    includePeople: ["Rail Alice"],
    excludePeople: ["Rail Bob"],
    rules: { favoriteOnly: true },
    coverSourcePath: "/cover.jpg",
    folderId: "folder-1",
  }, {
    id: "album:album-1",
    kind: "album",
    albumId: "album-1",
    albumKind: "manual",
    name: "Trip active",
    count: 4,
    includePeople: ["Active Ada"],
    excludePeople: ["Active Grace"],
  }), {
    albumId: "album-1",
    restoreConfig: {
      name: "Trip",
      albumKind: "manual",
      description: "Rail description",
      includePeople: ["Active Ada"],
      excludePeople: ["Active Grace"],
      rules: { favoriteOnly: true },
      coverSourcePath: "/cover.jpg",
      folderId: "folder-1",
    },
    restoreName: "Trip",
    shouldLoadManualOrder: true,
  });
  assert.deepStrictEqual(editorMod.photoAlbumDeleteRestoreDraft({
    id: "album:album-2",
    kind: "album",
    albumId: "album-2",
    name: "Rail only",
    count: 2,
    includePeople: ["Rail Alice"],
    excludePeople: ["Rail Bob"],
  }, {
    id: "album:album-1",
    kind: "album",
    albumId: "album-1",
    name: "Other active",
    count: 4,
    includePeople: ["Active Ada"],
    excludePeople: ["Active Grace"],
  }), {
    albumId: "album-2",
    restoreConfig: {
      name: "Rail only",
      albumKind: "smart",
      description: "",
      includePeople: ["Rail Alice"],
      excludePeople: ["Rail Bob"],
      rules: {},
      coverSourcePath: "",
      folderId: "",
    },
    restoreName: "Rail only",
    shouldLoadManualOrder: false,
  });
  assert.strictEqual(editorMod.photoAlbumDeleteRestoreDraft({
    id: "album:",
    kind: "album",
    name: "Missing id",
    count: 0,
  }, null), null);
  assert.deepStrictEqual(editorMod.photoAlbumFolderSaveDraft({
    folderId: " folder-1 ",
    name: " Trips ",
    parentFolderId: " parent-1 ",
  }), {
    folderId: "folder-1",
    name: "Trips",
    parentFolderId: "parent-1",
  });
  assert.deepStrictEqual(editorMod.photoAlbumFolderSaveDraft({
    name: " New Folder ",
  }), {
    folderId: undefined,
    name: "New Folder",
    parentFolderId: "",
  });
  assert.strictEqual(editorMod.photoAlbumFolderSaveDraft({
    name: " ",
  }), null);
  assert.deepStrictEqual(editorMod.photoAlbumFolderDeleteDraft({
    id: "albumFolder:fallback-id",
    kind: "albumFolder",
    name: "Trips",
    count: 0,
  }), {
    folderId: "fallback-id",
  });
  assert.deepStrictEqual(editorMod.photoAlbumFolderDeleteDraft({
    id: "albumFolder:fallback-id",
    kind: "albumFolder",
    folderId: "folder-1",
    name: "Trips",
    count: 0,
  }), {
    folderId: "folder-1",
  });
  assert.strictEqual(editorMod.photoAlbumFolderDeleteDraft({
    id: "albumFolder:",
    kind: "albumFolder",
    name: "Missing id",
    count: 0,
  }), null);
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
    imageEditsMod.photoManualCropPointFromImageSample({ x: 100, y: 50 }, 201, 101),
    { x: 50, y: 50 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoManualCropPointFromImageSample({ x: 199, y: 99 }, 200, 100),
    { x: 100, y: 100 }
  );
  assert.strictEqual(imageEditsMod.photoManualCropPointFromImageSample(null, 200, 100), null);
  assert.strictEqual(imageEditsMod.photoManualCropPointFromImageSample({ x: 10, y: 20 }, 0, 100), null);
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
  assert.strictEqual(imageEditsMod.PHOTO_IMAGE_ADJUSTMENT_CONTROLS.length, 31);
  assert.deepStrictEqual(imageEditsMod.PHOTO_IMAGE_ADJUSTMENT_CONTROLS[0], {
    key: "exposure",
    label: "Exposure",
    ariaLabel: "Image exposure",
    min: -2,
    max: 2,
    step: 0.1,
    precision: 1,
  });
  assert.deepStrictEqual(imageEditsMod.PHOTO_IMAGE_ADJUSTMENT_CONTROLS.at(-1), {
    key: "noiseReduction",
    label: "Noise",
    ariaLabel: "Image noise reduction",
    min: 0,
    max: 100,
    step: 5,
  });
  assert.strictEqual(imageEditsMod.photoImageAdjustmentDisplayValue(0.5, 1), "+0.5");
  assert.strictEqual(imageEditsMod.photoImageAdjustmentDisplayValue(-12.4), "-12");
  assert.strictEqual(imageEditsMod.photoImageAdjustmentDisplayValue(12.4), "+12");
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(photosViewSource, /PHOTO_IMAGE_ADJUSTMENT_CONTROLS/);
  assert.match(photosViewSource, /photoImageAdjustmentDisplayValue/);
  assert.doesNotMatch(photosViewSource, /type PhotoImageAdjustmentControl/);
  assert.doesNotMatch(photosViewSource, /function photoImageAdjustmentDisplayValue/);
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
  const whiteBalanced = imageEditsMod.photoImageWhiteBalanceAdjustments(
    { exposure: 0.4, warmth: 10, tint: -5 },
    { red: 120, green: 180, blue: 120 }
  );
  assert.strictEqual(whiteBalanced.exposure, 0.4);
  assert.strictEqual(whiteBalanced.warmth, 10);
  assert.strictEqual(whiteBalanced.tint, 28);
  assert.deepStrictEqual(
    imageEditsMod.photoImageWhiteBalanceAdjustments({ warmth: 95, tint: -95 }, { red: 0, green: 0, blue: 255 }),
    { ...imageEditsMod.DEFAULT_PHOTO_IMAGE_ADJUSTMENTS, warmth: 100, tint: -100 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageWhiteBalanceAdjustments({ warmth: 12, tint: -8 }, null),
    { ...imageEditsMod.DEFAULT_PHOTO_IMAGE_ADJUSTMENTS, warmth: 12, tint: -8 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRgbSampleFromPixels(new Uint8ClampedArray([
      10, 20, 30, 255,
      30, 40, 50, 255,
      50, 60, 70, 255,
    ])),
    { red: 30, green: 40, blue: 50 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRgbSampleFromPixels([
      10, 20, 30, 255,
      0, undefined, 90, 255,
    ]),
    { red: 5, green: 10, blue: 60 }
  );
  assert.strictEqual(imageEditsMod.photoImageRgbSampleFromPixels([]), null);
  assert.deepStrictEqual(
    imageEditsMod.photoImageSampleRectAroundPoint({ x: 50, y: 40 }, 100, 80),
    { left: 48, top: 38, width: 5, height: 5 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageSampleRectAroundPoint({ x: 1, y: 1 }, 100, 80),
    { left: 0, top: 0, width: 5, height: 5 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageSampleRectAroundPoint({ x: 99, y: 79 }, 100, 80),
    { left: 97, top: 77, width: 3, height: 3 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageSampleRectAroundPoint({ x: 10, y: 10 }, 100, 80, 3),
    { left: 9, top: 9, width: 3, height: 3 }
  );
  assert.strictEqual(imageEditsMod.photoImageSampleRectAroundPoint({ x: 10, y: 10 }, 0, 80), null);
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
  assert.deepStrictEqual(imageEditsMod.photoImageAutoEnhanceSampleSize(400, 200), { width: 128, height: 64 });
  assert.deepStrictEqual(imageEditsMod.photoImageAutoEnhanceSampleSize(80, 40), { width: 80, height: 40 });
  assert.deepStrictEqual(imageEditsMod.photoImageAutoEnhanceSampleSize(400, 200, 64), { width: 64, height: 32 });
  assert.strictEqual(imageEditsMod.photoImageAutoEnhanceSampleSize(0, 200), null);
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

run("photo image edit operation draft respects active gates", () => {
  const operation = imageEditsMod.photoImageEditOperationDraft({
    rotateDegrees: 450,
    straightenDegrees: 2.44,
    manualCropActive: true,
    manualCropBox: { left: 10, top: 20, width: 50, height: 60 },
    cropAspect: "4x5",
    adjustmentsActive: true,
    adjustments: { exposure: 0.55, contrast: 20 },
    filterActive: true,
    filterPreset: "Noir",
    filterIntensity: 35,
    markupActive: true,
    markup: [
      {
        kind: "text",
        text: "  Hello draft  ",
        left: 5,
        top: 6,
        width: 20,
        height: 10,
        color: "#ff0000",
        backgroundColor: "#000000",
        opacity: 80,
        fontSize: 5,
      },
    ],
    retouchActive: true,
    retouch: [
      {
        kind: "clone",
        left: 60,
        top: 62,
        width: 10,
        height: 8,
        strength: 70,
        sourceLeft: 20,
        sourceTop: 22,
      },
    ],
    flipHorizontal: "yes",
    source: " unit-draft ",
  });

  assert.strictEqual(operation.rotateDegrees, 90);
  assert.strictEqual(operation.straightenDegrees, 2.4);
  assert.deepStrictEqual(operation.cropRect, { left: 10, top: 20, width: 50, height: 60 });
  assert.strictEqual(operation.cropAspect, "portrait");
  assert.strictEqual(operation.adjustments.exposure, 0.6);
  assert.strictEqual(operation.adjustments.contrast, 20);
  assert.strictEqual(operation.filterPreset, "noir");
  assert.strictEqual(operation.filterIntensity, 35);
  assert.strictEqual(operation.markup[0].text, "Hello draft");
  assert.deepStrictEqual(operation.retouch[0], {
    kind: "clone",
    left: 60,
    top: 62,
    width: 10,
    height: 8,
    strength: 70,
    sourceLeft: 20,
    sourceTop: 22,
  });
  assert.strictEqual(operation.flipHorizontal, true);
  assert.strictEqual(operation.flipVertical, false);
  assert.strictEqual(operation.renderQuality, 88);
  assert.strictEqual(operation.renderMaxDimension, 1600);
  assert.strictEqual(operation.source, "unit-draft");

  assert.strictEqual(imageEditsMod.photoImageEditOperationDraft({
    manualCropActive: false,
    manualCropBox: { left: 10, top: 10, width: 80, height: 80 },
    adjustmentsActive: false,
    adjustments: { exposure: 1 },
    filterActive: false,
    filterPreset: "noir",
    markupActive: false,
    markup: [{ kind: "text", text: "inactive", left: 5, top: 5, width: 10, height: 10 }],
    retouchActive: false,
    retouch: [{ kind: "blemish", left: 5, top: 5, width: 10, height: 10 }],
    cropAspect: "none",
    flipHorizontal: false,
    flipVertical: false,
  }), null);
});

run("photo image edit draft state derives UI defaults from operations", () => {
  const defaults = imageEditsMod.photoImageEditDefaultDraftState();
  assert.strictEqual(defaults.rotateDegrees, 0);
  assert.strictEqual(defaults.straightenDegrees, 0);
  assert.strictEqual(defaults.cropAspect, "none");
  assert.strictEqual(defaults.manualCropEnabled, false);
  assert.deepStrictEqual(defaults.manualCropBox, imageEditsMod.DEFAULT_PHOTO_MANUAL_CROP_BOX);
  assert.strictEqual(defaults.adjustmentsOpen, false);
  assert.deepStrictEqual(defaults.adjustments, imageEditsMod.DEFAULT_PHOTO_IMAGE_ADJUSTMENTS);
  assert.strictEqual(defaults.filterPreset, "none");
  assert.strictEqual(defaults.filterIntensity, 100);
  assert.strictEqual(defaults.markupOpen, false);
  assert.deepStrictEqual(defaults.markupAnnotations, [imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION]);
  assert.strictEqual(defaults.markupSelectedIndex, 0);
  assert.strictEqual(defaults.retouchOpen, false);
  assert.deepStrictEqual(defaults.retouchSpots, [imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT]);
  assert.strictEqual(defaults.retouchSelectedIndex, 0);
  assert.strictEqual(defaults.flipHorizontal, false);
  assert.strictEqual(defaults.flipVertical, false);

  const draft = imageEditsMod.photoImageEditDraftStateFromOperation({
    rotateDegrees: 90,
    cropRect: { left: 10, top: 20, width: 50, height: 60 },
    adjustments: { exposure: 0.5 },
    filterPreset: "noir",
    filterIntensity: 25,
    markup: [
      {
        kind: "text",
        text: "Applied",
        left: 8,
        top: 9,
        width: 20,
        height: 10,
        color: "#ffffff",
        backgroundColor: "#111827",
        opacity: 80,
        fontSize: 5,
      },
    ],
    retouch: [
      {
        kind: "blemish",
        left: 40,
        top: 42,
        width: 8,
        height: 8,
        strength: 65,
      },
    ],
    flipVertical: true,
    source: "apply-state",
  });

  assert.strictEqual(draft.operation.source, "apply-state");
  assert.strictEqual(draft.rotateDegrees, 90);
  assert.strictEqual(draft.manualCropEnabled, true);
  assert.deepStrictEqual(draft.manualCropBox, { left: 10, top: 20, width: 50, height: 60 });
  assert.strictEqual(draft.adjustmentsOpen, true);
  assert.strictEqual(draft.adjustments.exposure, 0.5);
  assert.strictEqual(draft.filterPreset, "noir");
  assert.strictEqual(draft.filterIntensity, 25);
  assert.strictEqual(draft.markupOpen, true);
  assert.strictEqual(draft.markupAnnotations[0].text, "Applied");
  assert.strictEqual(draft.markupSelectedIndex, 0);
  assert.strictEqual(draft.retouchOpen, true);
  assert.strictEqual(draft.retouchSpots[0].kind, "blemish");
  assert.strictEqual(draft.retouchSelectedIndex, 0);
  assert.strictEqual(draft.flipHorizontal, false);
  assert.strictEqual(draft.flipVertical, true);

  const transformOnly = imageEditsMod.photoImageEditDraftStateFromOperation({ rotateDegrees: 180 });
  assert.strictEqual(transformOnly.manualCropEnabled, false);
  assert.deepStrictEqual(transformOnly.manualCropBox, imageEditsMod.DEFAULT_PHOTO_MANUAL_CROP_BOX);
  assert.strictEqual(transformOnly.adjustmentsOpen, false);
  assert.deepStrictEqual(transformOnly.adjustments, imageEditsMod.DEFAULT_PHOTO_IMAGE_ADJUSTMENTS);
  assert.strictEqual(transformOnly.filterPreset, "none");
  assert.strictEqual(transformOnly.filterIntensity, 100);
  assert.strictEqual(transformOnly.markupOpen, false);
  assert.deepStrictEqual(transformOnly.markupAnnotations, [imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION]);
  assert.strictEqual(transformOnly.retouchOpen, false);
  assert.deepStrictEqual(transformOnly.retouchSpots, [imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT]);
  assert.strictEqual(imageEditsMod.photoImageEditDraftStateFromOperation({ cropAspect: "none" }), null);
});

run("photo image edit display helpers extract stack operations and safe labels", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const helperSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEditDisplay.ts"), "utf8");

  assert.strictEqual(imageEditDisplayMod.photoCssBackgroundImage('vintrace-media://photo"bad\npath\\x'), 'url("vintrace-media://photobadpathx")');
  assert.strictEqual(imageEditDisplayMod.photoCssBackgroundImage(""), "");
  assert.strictEqual(imageEditDisplayMod.photoRecordValue({ a: 1 }), true);
  assert.strictEqual(imageEditDisplayMod.photoRecordValue([]), false);
  assert.strictEqual(imageEditDisplayMod.photoRecordValue(null), false);
  assert.strictEqual(imageEditDisplayMod.compactPhotoEditStackId("short-id"), "short-id");
  assert.strictEqual(imageEditDisplayMod.compactPhotoEditStackId("edit-stack-version-1234567890"), "...1234567890");

  const directOperation = imageEditDisplayMod.photoEditStackImageOperationFromValue({
    operations: [
      { kind: "noop" },
      { rotateDegrees: 90, filter: "noir", filterIntensity: 50, source: "direct" },
    ],
  });
  assert.strictEqual(directOperation.rotateDegrees, 90);
  assert.strictEqual(directOperation.filterPreset, "noir");
  assert.strictEqual(directOperation.filterIntensity, 50);
  assert.strictEqual(directOperation.source, "direct");

  const nestedOperation = imageEditDisplayMod.photoEditStackImageOperationFromValue({
    hasStack: true,
    stack: {
      operations: [
        { adjustments: { exposure: 0.4 }, source: "nested" },
      ],
    },
  });
  assert.strictEqual(nestedOperation.adjustments.exposure, 0.4);
  assert.strictEqual(nestedOperation.source, "nested");
  assert.strictEqual(imageEditDisplayMod.photoEditStackImageOperationFromValue({ operations: [{ cropAspect: "none" }] }), null);
  assert.strictEqual(
    imageEditDisplayMod.photoEditStackVersionOperationLabel([{ kind: "image_crop_rotate", rotateDegrees: 90 }]),
    "R90 / Original / No flip",
  );

  assert.match(photosViewSource, /from "\.\/photoImageEditDisplay"/);
  assert.doesNotMatch(photosViewSource, /function photoEditStackImageOperationFromValue/);
  assert.match(helperSource, /export function photoEditStackImageOperationFromValue/);
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
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackTargetPayload({
      sourcePath: " /photos/edit.jpg ",
      assetId: 42,
    }),
    {
      sourcePath: "/photos/edit.jpg",
      assetId: "42",
    },
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackSavePayload({
      sourcePath: " /photos/edit.jpg ",
      assetId: 42,
      operations: [{ kind: "image_crop_rotate" }],
    }),
    {
      sourcePath: "/photos/edit.jpg",
      assetId: "42",
      operations: [{ kind: "image_crop_rotate" }],
    },
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackSavePayload({
      sourcePath: " /photos/edit.jpg ",
      assetId: 42,
      operations: "bad",
    }),
    {
      sourcePath: "/photos/edit.jpg",
      assetId: "42",
      operations: [],
    },
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionListPayload({
      sourcePath: " /photos/edit.jpg ",
      assetId: 42,
      limit: "5000",
    }),
    {
      sourcePath: "/photos/edit.jpg",
      assetId: "42",
      limit: 1000,
    },
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionPayload({
      sourcePath: " /photos/edit.jpg ",
      assetId: 42,
      versionId: " v1 ",
    }),
    {
      sourcePath: "/photos/edit.jpg",
      assetId: "42",
      versionId: "v1",
    },
  );
  const messageOptions = {
    uiText: (value) => value,
    formatCount: (value) => `#${value}`,
  };
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackRevertConfirmDialogDraft(2, messageOptions),
    {
      title: "Revert selected edits?",
      message: "Remove saved edit stacks from #2 selected photos. Original files stay unchanged.",
      confirmLabel: "Revert edits",
      cancelLabel: "Cancel",
      danger: true,
    }
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackRevertProgressMessage(0, 4, messageOptions),
    "Reverting edits 0 / #4"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackRevertProgressMessage(7, 4, messageOptions),
    "Reverting edits #4 / #4"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackRevertResultMessage(1, 0, messageOptions),
    "Reverted edits #1 photo."
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackRevertResultMessage(2, 3, messageOptions),
    "Reverted edits #2 photos. Failed #3."
  );
  assert.strictEqual(
    imageEditsMod.photoAssetVersionDuplicateResultMessage("photo", "IMG_0001.jpg", messageOptions),
    "Duplicated photo version: IMG_0001.jpg"
  );
  assert.strictEqual(
    imageEditsMod.photoAssetVersionDuplicateResultMessage("rendered", "IMG_0001-edited.jpg", messageOptions),
    "Created rendered copy: IMG_0001-edited.jpg"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionProgressMessage("snapshot", 0, 3, messageOptions),
    "Snapshotting edit versions 0 / #3"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionProgressMessage("restore", 2, 3, messageOptions),
    "Restoring edit versions #2 / #3"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionProgressMessage("delete", 9, 3, messageOptions),
    "Deleting edit versions #3 / #3"
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionConfirmDialogDraft("restore", 1, messageOptions),
    {
      title: "Restore latest saved versions?",
      message: "Replace current edit stacks on #1 selected photo with their latest saved versions.",
      confirmLabel: "Restore versions",
      cancelLabel: "Cancel",
      danger: true,
    }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionConfirmDialogDraft("delete", 2, messageOptions),
    {
      title: "Delete saved edit versions?",
      message: "Delete saved edit-version snapshots from #2 selected photos. Current edit stacks are not changed.",
      confirmLabel: "Delete versions",
      cancelLabel: "Cancel",
      danger: true,
    }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionSingleConfirmDialogDraft("restore", "Snapshot A", messageOptions),
    {
      title: "Restore edit version?",
      message: "This replaces the current edit stack with Snapshot A.",
      confirmLabel: "Restore version",
      cancelLabel: "Cancel",
      danger: true,
    }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoEditStackVersionSingleConfirmDialogDraft("delete", "", messageOptions),
    {
      title: "Delete edit version?",
      message: "Delete this edit version? The current edit stack is not changed.",
      confirmLabel: "Delete version",
      cancelLabel: "Cancel",
      danger: true,
    }
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionSingleResultMessage("duplicate", "Snapshot A", messageOptions),
    "Duplicated edit version: Snapshot A"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionSingleResultMessage("restore", "", messageOptions),
    "Restored edit version: Version"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionSingleResultMessage("delete", "Snapshot B", messageOptions),
    "Deleted edit version: Snapshot B"
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionSnapshotResultMessage(1, 2, messageOptions),
    "Snapshotted edit versions #1 photo. Failed #2."
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionRestoreResultMessage(2, 1, 3, messageOptions),
    "Restored edit versions #2 photos. Skipped #1. Failed #3."
  );
  assert.strictEqual(
    imageEditsMod.photoEditStackVersionDeleteResultMessage(4, 2, 1, messageOptions),
    "Deleted edit versions #4. Skipped #2 photos. Failed #1 photos."
  );
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
  const saveSignatureDraft = imageEditsMod.photoImageSignaturePresetSaveDraft(movedStroke, [
    { ...savedSignature, id: "old-sig", name: "Older signature" },
    { ...savedSignature, name: "Duplicate signature" },
  ], {
    id: "sig-1",
    name: "Primary signature",
    createdAt: "2026-06-25T00:00:00Z",
  });
  assert.deepStrictEqual(saveSignatureDraft.preset, savedSignature);
  assert.deepStrictEqual(saveSignatureDraft.presets.map((preset) => preset.id), ["sig-1", "old-sig"]);
  assert.strictEqual(
    imageEditsMod.photoImageSignaturePresetSaveDraft({ kind: "signature", points: [{ x: 10, y: 20 }] }, [], { id: "bad" }),
    null
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageSignaturePresetDeleteDraft(saveSignatureDraft.presets, "sig-1").map((preset) => preset.id),
    ["old-sig"]
  );
  const signatureAnnotation = imageEditsMod.photoImageMarkupSignatureAnnotationFromPreset(savedSignature, { left: 10, top: 70, width: 40, height: 10 });
  assert.deepStrictEqual(signatureAnnotation, {
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
  });
  assert.deepStrictEqual(
    imageEditsMod.normalizePhotoImageSignaturePresets([savedSignature, savedSignature, { id: "bad", points: [{ x: 1, y: 2 }] }]).map((preset) => preset.id),
    ["sig-1"]
  );
  const insertSoloDraft = imageEditsMod.photoImageMarkupInsertAnnotationDraft([imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION], signatureAnnotation);
  assert.deepStrictEqual(insertSoloDraft, {
    annotations: [signatureAnnotation],
    selectedIndex: 0,
  });
  const insertAppendDraft = imageEditsMod.photoImageMarkupInsertAnnotationDraft([
    { kind: "text", text: "Keep", left: 12, top: 14 },
  ], signatureAnnotation);
  assert.strictEqual(insertAppendDraft.selectedIndex, 1);
  assert.deepStrictEqual(insertAppendDraft.annotations.map((annotation) => annotation.kind), ["text", "signature"]);
  assert.deepStrictEqual(insertAppendDraft.annotations[1], signatureAnnotation);
  assert.strictEqual(imageEditsMod.photoImageMarkupInsertAnnotationDraft([], null), null);
  const addDraft = imageEditsMod.photoImageMarkupAddAnnotationDraft([]);
  assert.strictEqual(addDraft.selectedIndex, 1);
  assert.deepStrictEqual(addDraft.annotations, [
    imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION,
    {
      kind: "text",
      left: 14,
      top: 14,
      width: 42,
      height: 14,
      color: "#ffffff",
      backgroundColor: "#111827",
      opacity: 78,
      fontSize: 5,
    },
  ]);
  const deleteSoloDraft = imageEditsMod.photoImageMarkupDeleteAnnotationDraft([imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION], 0);
  assert.deepStrictEqual(deleteSoloDraft, {
    annotations: [imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION],
    selectedIndex: 0,
    closePanel: true,
  });
  const deleteMiddleDraft = imageEditsMod.photoImageMarkupDeleteAnnotationDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION,
    { kind: "rectangle", left: 10, top: 10, width: 12, height: 8 },
    { kind: "ellipse", left: 30, top: 20, width: 12, height: 8 },
  ], 1);
  assert.strictEqual(deleteMiddleDraft.closePanel, false);
  assert.strictEqual(deleteMiddleDraft.selectedIndex, 1);
  assert.deepStrictEqual(deleteMiddleDraft.annotations.map((annotation) => annotation.kind), ["text", "ellipse"]);
  assert.deepStrictEqual(deleteMiddleDraft.annotations.map((annotation) => annotation.left), [8, 30]);
  const updateDraft = imageEditsMod.photoImageMarkupUpdateAnnotationDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION,
    { kind: "rectangle", left: 10, top: 10, width: 12, height: 8, color: "#22c55e" },
  ], 1, { kind: "text", left: 96, text: "  Note  " });
  assert.deepStrictEqual(updateDraft, [
    {
      kind: "text",
      left: 8,
      top: 8,
      width: 42,
      height: 14,
      color: "#ffffff",
      backgroundColor: "#111827",
      opacity: 78,
      fontSize: 5,
    },
    {
      kind: "text",
      text: "Note",
      left: 96,
      top: 10,
      width: 4,
      height: 8,
      color: "#22c55e",
      backgroundColor: "#111827",
      opacity: 78,
      fontSize: 5,
    },
  ]);
  const updateClampedDraft = imageEditsMod.photoImageMarkupUpdateAnnotationDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION,
    { kind: "rectangle", left: 10, top: 10, width: 12, height: 8 },
  ], 99, { top: 70 });
  assert.deepStrictEqual(updateClampedDraft.map((annotation) => annotation.top), [8, 70]);
  const merged = imageEditsMod.mergePhotoImageAdjustmentPasteOperation(
    operation,
    { adjustments: { exposure: 0.4 } },
    "unit-markup-adjustment-paste"
  );
  assert.deepStrictEqual(merged.markup, operation.markup);
  assert.strictEqual(merged.adjustments.exposure, 0.4);
});

run("Photos markup annotation controls use shared draft helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const imageEditsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEdits.ts"), "utf8");
  assert.match(imageEditsSource, /export function photoImageMarkupAddAnnotationDraft\(/);
  assert.match(imageEditsSource, /export function photoImageMarkupDeleteAnnotationDraft\(/);
  assert.match(imageEditsSource, /export function photoImageMarkupUpdateAnnotationDraft\(/);
  assert.match(imageEditsSource, /export function photoImageMarkupInsertAnnotationDraft\(/);
  assert.match(imageEditsSource, /export function photoImageSignaturePresetSaveDraft\(/);
  assert.match(imageEditsSource, /export function photoImageSignaturePresetDeleteDraft\(/);
  assert.match(source, /photoImageMarkupAddAnnotationDraft/);
  assert.match(source, /photoImageMarkupDeleteAnnotationDraft/);
  assert.match(source, /photoImageMarkupUpdateAnnotationDraft/);
  assert.match(source, /photoImageMarkupInsertAnnotationDraft/);
  assert.match(source, /photoImageSignaturePresetSaveDraft/);
  assert.match(source, /photoImageSignaturePresetDeleteDraft/);

  const addMarkupBlock = source.match(/function addImageMarkupAnnotation\(\) \{[\s\S]*?\n  \}\n\n  function deleteSelectedImageMarkupAnnotation/);
  assert.ok(addMarkupBlock, "addImageMarkupAnnotation should exist");
  assert.match(addMarkupBlock[0], /const draft = photoImageMarkupAddAnnotationDraft\(annotations\);/);
  assert.match(addMarkupBlock[0], /setImageMarkupSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(addMarkupBlock[0], /return draft\.annotations;/);
  assert.doesNotMatch(addMarkupBlock[0], /const offset = Math\.min\(36, rows\.length \* 6\);/);
  assert.doesNotMatch(addMarkupBlock[0], /DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION\.left \+ offset/);

  const deleteMarkupBlock = source.match(/function deleteSelectedImageMarkupAnnotation\(\) \{[\s\S]*?\n  \}\n\n  function toggleImageMarkupDrawing/);
  assert.ok(deleteMarkupBlock, "deleteSelectedImageMarkupAnnotation should exist");
  assert.match(deleteMarkupBlock[0], /const draft = photoImageMarkupDeleteAnnotationDraft\(annotations, imageMarkupSelectedIndex\);/);
  assert.match(deleteMarkupBlock[0], /if \(draft\.closePanel\) setImageMarkupOpen\(false\);/);
  assert.match(deleteMarkupBlock[0], /setImageMarkupSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(deleteMarkupBlock[0], /return draft\.annotations;/);
  assert.doesNotMatch(deleteMarkupBlock[0], /rows\.filter\(\(_, rowIndex\) => rowIndex !== index\)/);
  assert.doesNotMatch(deleteMarkupBlock[0], /Math\.min\(Math\.max\(imageMarkupSelectedIndex, 0\), rows\.length - 1\)/);

  const updateMarkupBlock = source.match(/function updateImageMarkupAnnotation\(patch: Partial<PhotoImageMarkupAnnotation>\) \{[\s\S]*?\n  \}\n\n  function imageRetouchSpotDraftLabel/);
  assert.ok(updateMarkupBlock, "updateImageMarkupAnnotation should exist");
  assert.match(updateMarkupBlock[0], /return photoImageMarkupUpdateAnnotationDraft\(annotations, imageMarkupSelectedIndex, patch\);/);
  assert.doesNotMatch(updateMarkupBlock[0], /normalizePhotoImageMarkupDraftAnnotation\(\{ \.\.\.annotation, \.\.\.patch \}\)/);
  assert.doesNotMatch(updateMarkupBlock[0], /rowIndex === index/);

  const insertSignatureBlock = source.match(/function insertImageSignaturePreset\(presetId: string\) \{[\s\S]*?\n  \}\n\n  function deleteImageSignaturePreset/);
  assert.ok(insertSignatureBlock, "insertImageSignaturePreset should exist");
  assert.match(insertSignatureBlock[0], /const draft = photoImageMarkupInsertAnnotationDraft\(annotations, annotation\);/);
  assert.match(insertSignatureBlock[0], /setImageMarkupSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(insertSignatureBlock[0], /return draft\.annotations;/);
  assert.doesNotMatch(insertSignatureBlock[0], /photoImageMarkupActive\(rows\) \? \[\.\.\.rows, annotation\] : \[annotation\]/);
  assert.doesNotMatch(insertSignatureBlock[0], /const rows = annotations\.length/);

  const saveSignatureBlock = source.match(/function saveSelectedImageSignaturePreset\(\) \{[\s\S]*?\n  \}\n\n  function insertImageSignaturePreset/);
  assert.ok(saveSignatureBlock, "saveSelectedImageSignaturePreset should exist");
  assert.match(saveSignatureBlock[0], /const draft = photoImageSignaturePresetSaveDraft\(imageMarkupSelectedAnnotation, imageSignaturePresets, \{/);
  assert.match(saveSignatureBlock[0], /commitImageSignaturePresets\(draft\.presets\);/);
  assert.doesNotMatch(saveSignatureBlock[0], /imageSignaturePresets\.filter\(\(item\) => item\.id !== preset\.id\)/);

  const deleteSignatureBlock = source.match(/function deleteImageSignaturePreset\(presetId: string\) \{[\s\S]*?\n  \}\n\n  function updateImageMarkupAnnotation/);
  assert.ok(deleteSignatureBlock, "deleteImageSignaturePreset should exist");
  assert.match(deleteSignatureBlock[0], /commitImageSignaturePresets\(photoImageSignaturePresetDeleteDraft\(imageSignaturePresets, presetId\)\);/);
  assert.doesNotMatch(deleteSignatureBlock[0], /imageSignaturePresets\.filter\(\(item\) => item\.id !== presetId\)/);

  const beginStrokeBlock = source.match(/function beginImageMarkupStrokeDraw\(event: ReactPointerEvent<HTMLDivElement>\): boolean \{[\s\S]*?\n  \}\n\n  function updateImageMarkupStrokeDraw/);
  assert.ok(beginStrokeBlock, "beginImageMarkupStrokeDraw should exist");
  assert.match(beginStrokeBlock[0], /return photoImageMarkupUpdateAnnotationDraft\(annotations, imageMarkupSelectedDraftIndex, \{ kind, points \}\);/);
  assert.doesNotMatch(beginStrokeBlock[0], /normalizePhotoImageMarkupDraftAnnotation\(\{ \.\.\.annotation, kind, points \}\)/);

  const updateStrokeBlock = source.match(/function updateImageMarkupStrokeDraw\(event: ReactPointerEvent<HTMLDivElement>\): boolean \{[\s\S]*?\n  \}\n\n  function endImageMarkupStrokeDraw/);
  assert.ok(updateStrokeBlock, "updateImageMarkupStrokeDraw should exist");
  assert.match(updateStrokeBlock[0], /return photoImageMarkupUpdateAnnotationDraft\(annotations, stroke\.index, \{ points: stroke\.points \}\);/);
  assert.doesNotMatch(updateStrokeBlock[0], /normalizePhotoImageMarkupDraftAnnotation\(\{ \.\.\.annotation, points: stroke\.points \}\)/);

  const updateOverlayBlock = source.match(/function updateImageMarkupOverlayDrag\(event: ReactPointerEvent<HTMLDivElement>\): boolean \{[\s\S]*?\n  \}\n\n  function endImageMarkupOverlayDrag/);
  assert.ok(updateOverlayBlock, "updateImageMarkupOverlayDrag should exist");
  assert.match(updateOverlayBlock[0], /return photoImageMarkupUpdateAnnotationDraft\(annotations, drag\.index, next\);/);
  assert.doesNotMatch(updateOverlayBlock[0], /rows\.map\(\(annotation, index\) => index === drag\.index \? next : annotation\)/);
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
  assert.strictEqual(imageEditsMod.photoImageRetouchSpotMatchesDefault(imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT), true);
  assert.strictEqual(imageEditsMod.photoImageRetouchSpotMatchesDefault({ ...imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT, width: 20, height: 20 }), true);
  assert.strictEqual(imageEditsMod.photoImageRetouchSpotMatchesDefault({ ...imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT, left: 11 }), false);
  assert.strictEqual(imageEditsMod.photoImageRetouchSpotMatchesDefault(null), false);
  const addBlemishDraft = imageEditsMod.photoImageRetouchAddSpotDraft([], "blemish");
  assert.strictEqual(addBlemishDraft.selectedIndex, 1);
  assert.deepStrictEqual(addBlemishDraft.spots, [
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    {
      kind: "blemish",
      left: 47,
      top: 47,
      width: 8,
      height: 8,
      strength: 80,
    },
  ]);
  const addCloneDraft = imageEditsMod.photoImageRetouchAddSpotDraft([imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT], "clone");
  assert.strictEqual(addCloneDraft.selectedIndex, 1);
  assert.deepStrictEqual(addCloneDraft.spots[1], {
    kind: "clone",
    left: 47,
    top: 47,
    width: 8,
    height: 8,
    strength: 80,
    sourceLeft: 33,
    sourceTop: 47,
  });
  const deleteSoloDraft = imageEditsMod.photoImageRetouchDeleteSpotDraft([imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT], 0);
  assert.deepStrictEqual(deleteSoloDraft, {
    spots: [imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
    selectedIndex: 0,
    closePanel: true,
  });
  const deleteMiddleDraft = imageEditsMod.photoImageRetouchDeleteSpotDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    { kind: "blemish", left: 10, top: 10, width: 8, height: 8, strength: 80 },
    { kind: "clone", left: 20, top: 20, width: 8, height: 8, sourceLeft: 6, sourceTop: 20, strength: 80 },
  ], 1);
  assert.strictEqual(deleteMiddleDraft.closePanel, false);
  assert.strictEqual(deleteMiddleDraft.selectedIndex, 1);
  assert.deepStrictEqual(deleteMiddleDraft.spots.map((spot) => spot.left), [42, 20]);
  const deleteClampedDraft = imageEditsMod.photoImageRetouchDeleteSpotDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    { kind: "blemish", left: 10, top: 10, width: 8, height: 8, strength: 80 },
  ], 99);
  assert.strictEqual(deleteClampedDraft.selectedIndex, 0);
  assert.deepStrictEqual(deleteClampedDraft.spots.map((spot) => spot.left), [42]);
  const updateDraft = imageEditsMod.photoImageRetouchUpdateSpotDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    { kind: "blemish", left: 10, top: 10, width: 8, height: 8, strength: 80 },
  ], 1, { kind: "clone", left: 95, sourceLeft: 80, sourceTop: 12 });
  assert.deepStrictEqual(updateDraft, [
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    { kind: "clone", left: 95, top: 10, width: 5, height: 8, strength: 80, sourceLeft: 80, sourceTop: 12 },
  ]);
  const updateClampedDraft = imageEditsMod.photoImageRetouchUpdateSpotDraft([
    imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT,
    { kind: "blemish", left: 10, top: 10, width: 8, height: 8, strength: 80 },
  ], 99, { top: 70 });
  assert.deepStrictEqual(updateClampedDraft.map((spot) => spot.top), [42, 70]);
  assert.strictEqual(imageEditsMod.photoImageRetouchBoxStartFromCenter(50, 10), 45);
  assert.strictEqual(imageEditsMod.photoImageRetouchBoxStartFromCenter(99, 10), 90);
  assert.strictEqual(imageEditsMod.photoImageRetouchBoxStartFromCenter(1, 10), 0);
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchCloneSourcePatch({ x: 99, y: 1 }, { width: 10, height: 8 }),
    { kind: "clone", sourceLeft: 90, sourceTop: 0 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchCloneSourcePatch({ x: 50, y: 60 }, { kind: "blemish", width: 7.5, height: 12.5 }),
    { kind: "clone", sourceLeft: 46.3, sourceTop: 53.8 }
  );
  assert.strictEqual(imageEditsMod.photoImageRetouchCloneSourcePatch({ x: Number.NaN, y: 20 }, { width: 10, height: 10 }), null);
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchKindPatch("clone", { kind: "blemish", left: 40, top: 30, width: 10, height: 8, strength: 70 }),
    { kind: "clone", sourceLeft: 26, sourceTop: 30 }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchKindPatch("clone", { kind: "clone", left: 40, top: 30, width: 10, height: 8, strength: 70, sourceLeft: 12, sourceTop: 14 }),
    { kind: "clone" }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchKindPatch("red-eye", { kind: "clone", left: 40, top: 30, width: 10, height: 8, strength: 70, sourceLeft: 12, sourceTop: 14 }),
    { kind: "red_eye" }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImageRetouchBrushStateFromPoint(7, { x: 120, y: -5 }, { kind: "clone", left: 40, top: 30, width: 10, height: 8, strength: 70 }),
    {
      pointerId: 7,
      lastPoint: { x: 100, y: 0 },
      spacing: 6,
      template: {
        kind: "clone",
        left: 40,
        top: 30,
        width: 10,
        height: 8,
        strength: 70,
        sourceLeft: 26,
        sourceTop: 30,
      },
    }
  );
  assert.strictEqual(
    imageEditsMod.photoImageRetouchBrushStateFromPoint("bad", { x: 10, y: 10 }, { kind: "blemish" }),
    null
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
  const appendReplaceDefaultDraft = imageEditsMod.photoImageRetouchAppendBrushPointDraft(
    [imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
    { x: 50, y: 60 },
    { template: { kind: "blemish", width: 10, height: 8, strength: 60 }, spacing: 6 },
    true
  );
  assert.deepStrictEqual(appendReplaceDefaultDraft, {
    spots: [
      {
        kind: "blemish",
        left: 45,
        top: 56,
        width: 10,
        height: 8,
        strength: 60,
      },
    ],
    selectedIndex: 0,
    limitReached: false,
  });
  const appendExistingDraft = imageEditsMod.photoImageRetouchAppendBrushPointDraft(
    [imageEditsMod.DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT],
    { x: 20, y: 20 },
    { template: { kind: "blemish", width: 10, height: 8, strength: 60 }, spacing: 6 }
  );
  assert.deepStrictEqual(appendExistingDraft.spots.map((spot) => spot.left), [42, 15]);
  assert.strictEqual(appendExistingDraft.selectedIndex, 1);
  assert.strictEqual(appendExistingDraft.limitReached, false);
  const appendLimitDraft = imageEditsMod.photoImageRetouchAppendBrushPointDraft(
    Array.from({ length: imageEditsMod.PHOTO_IMAGE_RETOUCH_SPOT_LIMIT }, (_, index) => ({
      kind: "blemish",
      left: index,
      top: index,
      width: 4,
      height: 4,
      strength: 80,
    })),
    { x: 80, y: 80 },
    { template: { kind: "blemish", width: 4, height: 4, strength: 80 }, spacing: 4 }
  );
  assert.strictEqual(appendLimitDraft.spots.length, imageEditsMod.PHOTO_IMAGE_RETOUCH_SPOT_LIMIT);
  assert.strictEqual(appendLimitDraft.selectedIndex, null);
  assert.strictEqual(appendLimitDraft.limitReached, true);
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
  const imageEditsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEdits.ts"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.match(imageEditsSource, /export function photoImageRetouchSpotMatchesDefault\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchAddSpotDraft\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchDeleteSpotDraft\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchUpdateSpotDraft\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchBoxStartFromCenter\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchCloneSourcePatch\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchKindPatch\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchBrushStateFromPoint\(/);
  assert.match(imageEditsSource, /export function photoImageRetouchAppendBrushPointDraft\(/);
  assert.match(source, /uiText\("Brush retouch spots"\)/);
  assert.match(source, /uiText\("Pick clone source"\)/);
  assert.match(source, /pickImageRetouchCloneSource/);
  assert.match(source, /photoImageRetouchAddSpotDraft/);
  assert.match(source, /photoImageRetouchDeleteSpotDraft/);
  assert.match(source, /photoImageRetouchUpdateSpotDraft/);
  assert.match(source, /photoImageRetouchKindPatch/);
  assert.match(source, /photoImageRetouchBrushStateFromPoint/);
  assert.match(source, /photoImageRetouchAppendBrushPointDraft/);
  assert.match(source, /photoImageRetouchCloneSourcePatch/);
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

  const addSpotBlock = source.match(/function addImageRetouchSpot\(kind: PhotoImageRetouchSpot\["kind"\] = imageRetouchSelectedSpot\.kind \|\| "blemish"\) \{[\s\S]*?\n  \}\n\n  function deleteSelectedImageRetouchSpot/);
  assert.ok(addSpotBlock, "addImageRetouchSpot should exist");
  assert.match(addSpotBlock[0], /const draft = photoImageRetouchAddSpotDraft\(spots, kind\);/);
  assert.match(addSpotBlock[0], /setImageRetouchSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(addSpotBlock[0], /return draft\.spots;/);
  assert.doesNotMatch(addSpotBlock[0], /const offset = Math\.min\(30, rows\.length \* 5\);/);
  assert.doesNotMatch(addSpotBlock[0], /DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT\.left \+ offset/);

  const deleteSpotBlock = source.match(/function deleteSelectedImageRetouchSpot\(\) \{[\s\S]*?\n  \}\n\n  function updateImageRetouchSpot/);
  assert.ok(deleteSpotBlock, "deleteSelectedImageRetouchSpot should exist");
  assert.match(deleteSpotBlock[0], /const draft = photoImageRetouchDeleteSpotDraft\(spots, imageRetouchSelectedIndex\);/);
  assert.match(deleteSpotBlock[0], /if \(draft\.closePanel\) setImageRetouchOpen\(false\);/);
  assert.match(deleteSpotBlock[0], /setImageRetouchSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(deleteSpotBlock[0], /return draft\.spots;/);
  assert.doesNotMatch(deleteSpotBlock[0], /rows\.filter\(\(_, rowIndex\) => rowIndex !== index\)/);
  assert.doesNotMatch(deleteSpotBlock[0], /Math\.min\(Math\.max\(imageRetouchSelectedIndex, 0\), rows\.length - 1\)/);

  const updateSpotBlock = source.match(/function updateImageRetouchSpot\(patch: Partial<PhotoImageRetouchSpot>\) \{[\s\S]*?\n  \}\n\n  function pickImageRetouchCloneSource/);
  assert.ok(updateSpotBlock, "updateImageRetouchSpot should exist");
  assert.match(updateSpotBlock[0], /return photoImageRetouchUpdateSpotDraft\(spots, imageRetouchSelectedIndex, patch\);/);
  assert.doesNotMatch(updateSpotBlock[0], /normalizePhotoImageRetouchSpot\(\{ \.\.\.spot, \.\.\.patch \}\)/);
  assert.doesNotMatch(updateSpotBlock[0], /rowIndex === index/);

  const kindControlBlock = source.match(/<select[\s\S]*?aria-label=\{uiText\("Retouch kind"\)\}[\s\S]*?<\/select>/);
  assert.ok(kindControlBlock, "retouch kind selector should exist");
  assert.match(kindControlBlock[0], /updateImageRetouchSpot\(photoImageRetouchKindPatch\(event\.currentTarget\.value, imageRetouchSelectedSpot\)\);/);
  assert.doesNotMatch(kindControlBlock[0], /sourceLeft: Math\.max\(0, imageRetouchSelectedSpot\.left - 14\)/);

  const pickCloneBlock = source.match(/function pickImageRetouchCloneSource\(event: ReactPointerEvent<HTMLDivElement>\): boolean \{[\s\S]*?\n  \}\n\n  function appendImageRetouchBrushPoint/);
  assert.ok(pickCloneBlock, "pickImageRetouchCloneSource should exist");
  assert.match(pickCloneBlock[0], /const patch = photoImageRetouchCloneSourcePatch\(point, imageRetouchSelectedSpot\);/);
  assert.match(pickCloneBlock[0], /updateImageRetouchSpot\(patch\);/);
  assert.doesNotMatch(source, /function imageRetouchSpotMatchesDefault/);
  assert.doesNotMatch(source, /function imageRetouchBoxStartFromCenter/);
  assert.doesNotMatch(pickCloneBlock[0], /sourceLeft: imageRetouchBoxStartFromCenter/);

  const appendBrushBlock = source.match(/function appendImageRetouchBrushPoint\(point: PhotoManualCropPoint, brush: ImageRetouchBrushState, replaceDefaultOnly = false\) \{[\s\S]*?\n  \}\n\n  function beginImageRetouchBrushDraw/);
  assert.ok(appendBrushBlock, "appendImageRetouchBrushPoint should exist");
  assert.match(appendBrushBlock[0], /const draft = photoImageRetouchAppendBrushPointDraft\(spots, point, brush, replaceDefaultOnly\);/);
  assert.match(appendBrushBlock[0], /if \(draft\.limitReached\)/);
  assert.match(appendBrushBlock[0], /setImageRetouchSelectedIndex\(draft\.selectedIndex\);/);
  assert.match(appendBrushBlock[0], /return draft\.spots;/);
  assert.doesNotMatch(appendBrushBlock[0], /photoImageRetouchBrushSpotsFromPoints/);
  assert.doesNotMatch(appendBrushBlock[0], /photoImageRetouchSpotMatchesDefault\(rows\[0\]\)/);
  assert.doesNotMatch(appendBrushBlock[0], /imageRetouchSpotMatchesDefault\(rows\[0\]\)/);

  const beginBrushBlock = source.match(/function beginImageRetouchBrushDraw\(event: ReactPointerEvent<HTMLDivElement>\): boolean \{[\s\S]*?\n  \}\n\n  function updateImageRetouchBrushDraw/);
  assert.ok(beginBrushBlock, "beginImageRetouchBrushDraw should exist");
  assert.match(beginBrushBlock[0], /const brush = photoImageRetouchBrushStateFromPoint\(event\.pointerId, point, imageRetouchSelectedSpot\);/);
  assert.doesNotMatch(beginBrushBlock[0], /normalizePhotoImageRetouchSpot\(/);
  assert.doesNotMatch(beginBrushBlock[0], /Math\.max\(0\.75, Math\.max\(template\.width, template\.height\) \* 0\.6\)/);
  assert.doesNotMatch(beginBrushBlock[0], /sourceLeft: Math\.max\(0, imageRetouchSelectedSpot\.left - 14\)/);
});

run("Photos image edit operation drafts use the shared helper", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const imageEditsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEdits.ts"), "utf8");
  assert.match(imageEditsSource, /export function photoImageEditOperationDraft\(/);
  assert.match(imageEditsSource, /export function photoImageEditDraftStateFromOperation\(/);
  assert.match(imageEditsSource, /export function photoImageEditDefaultDraftState\(/);
  assert.match(imageEditsSource, /export function photoImageEditClipboardCopyDraft\(/);
  assert.match(imageEditsSource, /export function photoImageEditClipboardDeleteDraft\(/);
  assert.match(imageEditsSource, /export function photoImageEditClipboardPasteOperation\(/);
  assert.match(imageEditsSource, /export function photoImageEditClipboardSelectionDraft\(/);
  assert.match(imageEditsSource, /export function photoImageEditPasteHasConflict\(/);
  assert.match(imageEditsSource, /export function photoImageAdjustmentPasteHasConflict\(/);
  assert.match(imageEditsSource, /export function photoImagePasteProgressMessage\(/);
  assert.match(imageEditsSource, /export function photoImagePasteResultMessage\(/);
  assert.match(imageEditsSource, /export function photoImagePasteConflictPreviewText\(/);
  assert.match(imageEditsSource, /export function photoImagePasteConflictDialogDraft\(/);
  assert.match(imageEditsSource, /export function photoAssetVersionDuplicateResultMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackRevertConfirmDialogDraft\(/);
  assert.match(imageEditsSource, /export function photoEditStackRevertProgressMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackRevertResultMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackTargetPayload\(/);
  assert.match(imageEditsSource, /export function photoEditStackSavePayload\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionListPayload\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionPayload\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionProgressMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionConfirmDialogDraft\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionSingleConfirmDialogDraft\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionSingleResultMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionSnapshotResultMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionRestoreResultMessage\(/);
  assert.match(imageEditsSource, /export function photoEditStackVersionDeleteResultMessage\(/);
  assert.match(source, /photoImageEditClipboardCopyDraft,/);
  assert.match(source, /photoImageEditClipboardDeleteDraft,/);
  assert.match(source, /photoImageEditClipboardPasteOperation,/);
  assert.match(source, /photoImageEditClipboardSelectionDraft,/);
  assert.match(source, /photoImageEditPasteHasConflict,/);
  assert.match(source, /photoImageAdjustmentPasteHasConflict,/);
  assert.match(source, /photoImagePasteProgressMessage,/);
  assert.match(source, /photoImagePasteResultMessage,/);
  assert.match(source, /photoImagePasteConflictDialogDraft,/);
  assert.match(source, /photoAssetVersionDuplicateResultMessage,/);
  assert.match(source, /photoEditStackRevertConfirmDialogDraft,/);
  assert.match(source, /photoEditStackRevertProgressMessage,/);
  assert.match(source, /photoEditStackRevertResultMessage,/);
  assert.match(source, /photoEditStackTargetPayload,/);
  assert.match(source, /photoEditStackSavePayload,/);
  assert.match(source, /photoEditStackVersionListPayload,/);
  assert.match(source, /photoEditStackVersionPayload,/);
  assert.match(source, /photoEditStackVersionProgressMessage,/);
  assert.match(source, /photoEditStackVersionConfirmDialogDraft,/);
  assert.match(source, /photoEditStackVersionSingleConfirmDialogDraft,/);
  assert.match(source, /photoEditStackVersionSingleResultMessage,/);
  assert.match(source, /photoEditStackVersionSnapshotResultMessage,/);
  assert.match(source, /photoEditStackVersionRestoreResultMessage,/);
  assert.match(source, /photoEditStackVersionDeleteResultMessage,/);
  assert.match(source, /photoImageEditDefaultDraftState,/);
  assert.match(source, /photoImageEditDraftStateFromOperation,/);
  assert.match(source, /photoImageEditOperationDraft,/);

  const currentBlock = source.match(/function currentImageEditOperation\(source = "photos-lightbox"\): PhotoImageEditOperation \| null \{[\s\S]*?\n  \}\n\n  function setImageEditDraftState/);
  assert.ok(currentBlock, "currentImageEditOperation should exist");
  assert.match(currentBlock[0], /return photoImageEditOperationDraft\(\{/);
  assert.match(currentBlock[0], /manualCropActive: imageManualCropActive/);
  assert.match(currentBlock[0], /adjustmentsActive: imageAdjustmentsActive/);
  assert.match(currentBlock[0], /filterActive: imageFilterActive/);
  assert.match(currentBlock[0], /markupActive: imageMarkupActive/);
  assert.match(currentBlock[0], /retouchActive: imageRetouchActive/);
  assert.doesNotMatch(currentBlock[0], /return normalizePhotoImageEditOperation\(\{/);
  assert.doesNotMatch(currentBlock[0], /const manualCropBox = normalizePhotoManualCropBox/);
  assert.doesNotMatch(currentBlock[0], /const adjustments = normalizePhotoImageAdjustments/);
  assert.doesNotMatch(currentBlock[0], /const filterPreset = normalizePhotoImageFilterPreset/);
  assert.doesNotMatch(currentBlock[0], /const filterIntensity = normalizePhotoImageFilterIntensity/);

  const setDraftBlock = source.match(/function setImageEditDraftState\(draft: PhotoImageEditDefaultDraftState\) \{[\s\S]*?\n  \}\n\n  function applyImageEditOperationToDraft/);
  assert.ok(setDraftBlock, "setImageEditDraftState should exist");
  assert.match(setDraftBlock[0], /setImageRotateDegrees\(draft\.rotateDegrees\);/);
  assert.match(setDraftBlock[0], /setImageMarkupAnnotationsDraft\(draft\.markupAnnotations\);/);
  assert.match(setDraftBlock[0], /setImageRetouchSpotsDraft\(draft\.retouchSpots\);/);
  assert.match(setDraftBlock[0], /setImageFlipHorizontal\(draft\.flipHorizontal\);/);
  assert.doesNotMatch(setDraftBlock[0], /photoImageEditDefaultDraftState\(\)/);
  assert.doesNotMatch(setDraftBlock[0], /photoImageEditDraftStateFromOperation/);

  const applyBlock = source.match(/function applyImageEditOperationToDraft\(operation: Record<string, unknown> \| PhotoImageEditOperation \| null \| undefined\): PhotoImageEditOperation \| null \{[\s\S]*?\n  \}\n\n  function resetImageEditDraft/);
  assert.ok(applyBlock, "applyImageEditOperationToDraft should exist");
  assert.match(applyBlock[0], /const draft = photoImageEditDraftStateFromOperation\(operation\);/);
  assert.match(applyBlock[0], /setImageEditDraftState\(draft\);/);
  assert.match(applyBlock[0], /return draft\.operation;/);
  assert.doesNotMatch(applyBlock[0], /const normalized = normalizePhotoImageEditOperation/);
  assert.doesNotMatch(applyBlock[0], /setImageMarkupAnnotationsDraft\(draft\.markupAnnotations\);/);
  assert.doesNotMatch(applyBlock[0], /setImageRetouchSpotsDraft\(draft\.retouchSpots\);/);
  assert.doesNotMatch(applyBlock[0], /normalized\.markup\?\.length \? normalized\.markup/);
  assert.doesNotMatch(applyBlock[0], /normalized\.retouch\?\.length \? normalized\.retouch/);

  const resetBlock = source.match(/function resetImageEditDraft\(\) \{[\s\S]*?\n  \}\n\n  function saveImageEditClipboardHistory/);
  assert.ok(resetBlock, "resetImageEditDraft should exist");
  assert.match(resetBlock[0], /const draft = photoImageEditDefaultDraftState\(\);/);
  assert.match(resetBlock[0], /setImageEditDraftState\(draft\);/);
  assert.doesNotMatch(resetBlock[0], /setImageRotateDegrees\(0\)/);
  assert.doesNotMatch(resetBlock[0], /setImageMarkupAnnotationsDraft\(draft\.markupAnnotations\);/);
  assert.doesNotMatch(resetBlock[0], /setImageRetouchSpotsDraft\(draft\.retouchSpots\);/);
  assert.doesNotMatch(resetBlock[0], /setImageFlipHorizontal\(draft\.flipHorizontal\);/);
  assert.doesNotMatch(resetBlock[0], /setImageAdjustments\(DEFAULT_PHOTO_IMAGE_ADJUSTMENTS\)/);
  assert.doesNotMatch(resetBlock[0], /setImageMarkupAnnotationsDraft\(\[DEFAULT_PHOTO_IMAGE_MARKUP_ANNOTATION\]\)/);
  assert.doesNotMatch(resetBlock[0], /setImageRetouchSpotsDraft\(\[DEFAULT_PHOTO_IMAGE_RETOUCH_SPOT\]\)/);

  const selectClipboardBlock = source.match(/function selectImageEditClipboardHistoryEntry\(entryId: string\) \{[\s\S]*?\n  \}\n\n  function deleteSelectedImageEditClipboardHistoryEntry/);
  assert.ok(selectClipboardBlock, "selectImageEditClipboardHistoryEntry should exist");
  assert.match(selectClipboardBlock[0], /const draft = photoImageEditClipboardSelectionDraft\(imageEditClipboardHistory, entryId\);/);
  assert.match(selectClipboardBlock[0], /setImageEditClipboardId\(draft\.selectedId\);/);
  assert.match(selectClipboardBlock[0], /setImageEditClipboard\(draft\.operation\);/);
  assert.doesNotMatch(selectClipboardBlock[0], /imageEditClipboardHistory\.find/);

  const deleteClipboardBlock = source.match(/function deleteSelectedImageEditClipboardHistoryEntry\(\) \{[\s\S]*?\n  \}\n\n  function copyCurrentImageEdit/);
  assert.ok(deleteClipboardBlock, "deleteSelectedImageEditClipboardHistoryEntry should exist");
  assert.match(deleteClipboardBlock[0], /const draft = photoImageEditClipboardDeleteDraft\(imageEditClipboardHistory, imageEditClipboardId\);/);
  assert.match(deleteClipboardBlock[0], /saveImageEditClipboardHistory\(draft\.history\);/);
  assert.match(deleteClipboardBlock[0], /setImageEditClipboardId\(draft\.selectedId\);/);
  assert.doesNotMatch(deleteClipboardBlock[0], /deletePhotoImageEditClipboardHistoryEntry/);
  assert.doesNotMatch(deleteClipboardBlock[0], /const fallback = next\[0\] \|\| null/);

  const copyClipboardBlock = source.match(/function copyCurrentImageEdit\(\) \{[\s\S]*?\n  \}\n\n  async function reloadActivePhotoPage/);
  assert.ok(copyClipboardBlock, "copyCurrentImageEdit should exist");
  assert.match(copyClipboardBlock[0], /const draft = photoImageEditClipboardCopyDraft\(operation as Record<string, unknown> \| null, imageEditClipboardHistory\);/);
  assert.match(copyClipboardBlock[0], /setImageEditClipboard\(draft\.operation\);/);
  assert.match(copyClipboardBlock[0], /saveImageEditClipboardHistory\(draft\.history\);/);
  assert.match(copyClipboardBlock[0], /setImageEditClipboardId\(draft\.selectedId\);/);
  assert.doesNotMatch(copyClipboardBlock[0], /upsertPhotoImageEditClipboardHistory/);
  assert.doesNotMatch(copyClipboardBlock[0], /photoImageEditOperationActive/);

  assert.doesNotMatch(source, /function imageEditPasteHasConflict/);
  assert.doesNotMatch(source, /function imageAdjustmentPasteHasConflict/);
  assert.match(source, /photoImageEditPasteHasConflict\(photoEditStackImageOperation, operation\)/);
  assert.match(source, /photoImageAdjustmentPasteHasConflict\(targetOperation, operation\)/);
  assert.match(source, /getPhotoEditStack\(photoEditStackTargetPayload\(lightItem\)\)/);
  assert.match(source, /listPhotoEditStackVersions\(photoEditStackVersionListPayload\(lightItem\)\)/);
  assert.match(source, /savePhotoEditStack\(photoEditStackSavePayload\(\{/);
  assert.match(source, /selectedImageEditPasteItems\.map\(photoEditStackTargetPayload\)/);
  assert.match(source, /createPhotoEditStackVersion\(photoEditStackTargetPayload\(item\)\)/);
  assert.match(source, /restorePhotoEditStackVersion\(photoEditStackVersionPayload\(\{/);
  assert.match(source, /deletePhotoEditStackVersion\(photoEditStackVersionPayload\(\{/);
  assert.match(source, /duplicatePhotoAssetVersion\(photoEditStackTargetPayload\(item\)\)/);
  assert.doesNotMatch(source, /getPhotoEditStack\(\{\s*sourcePath: lightItem\.sourcePath/);
  assert.doesNotMatch(source, /listPhotoEditStackVersions\(\{\s*sourcePath: (?:lightItem|item)\.sourcePath/);
  assert.doesNotMatch(source, /savePhotoEditStack\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /revertPhotoEditStack\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /createPhotoEditStackVersion\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /restorePhotoEditStackVersion\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /deletePhotoEditStackVersion\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /duplicatePhotoAssetVersion\(\{\s*sourcePath: item\.sourcePath/);
  assert.match(source, /const operation = photoImageEditClipboardPasteOperation\(imageEditClipboard, "photos-lightbox-paste"\);/);
  assert.match(source, /const operation = photoImageEditClipboardPasteOperation\(imageEditClipboard, "photos-bulk-paste"\);/);
  assert.match(source, /const imagePasteTextOptions = \{ uiText, formatCount \};/);
  assert.match(source, /const draft = photoImagePasteConflictDialogDraft\(conflictCount, mode, operation, imagePasteTextOptions\);/);
  assert.match(source, /title: draft\.title/);
  assert.match(source, /message: draft\.message/);
  assert.match(source, /confirmLabel: draft\.confirmLabel/);
  assert.match(source, /cancelLabel: draft\.cancelLabel/);
  assert.match(source, /photoImagePasteProgressMessage\("edits", "checking", 0, total, imagePasteTextOptions\)/);
  assert.match(source, /photoImagePasteResultMessage\("adjustments", pasted, replaced, failed, \{ \.\.\.imagePasteTextOptions, skipped \}\)/);
  assert.match(source, /photoAssetVersionDuplicateResultMessage\("photo", fileName\(duplicatePath \|\| item\.sourcePath\), imagePasteTextOptions\)/);
  assert.match(source, /photoAssetVersionDuplicateResultMessage\("rendered", fileName\(duplicatePath \|\| item\.sourcePath\), imagePasteTextOptions\)/);
  assert.match(source, /const confirmDraft = photoEditStackRevertConfirmDialogDraft\(total, imagePasteTextOptions\);/);
  assert.match(source, /photoEditStackRevertProgressMessage\(0, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackRevertProgressMessage\(index \+ 1, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackRevertResultMessage\(reverted, failed, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("snapshot", 0, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("snapshot", index \+ 1, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("restore", 0, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("restore", index \+ 1, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("delete", 0, total, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionProgressMessage\("delete", index \+ 1, total, imagePasteTextOptions\)/);
  assert.match(source, /const confirmDraft = photoEditStackVersionConfirmDialogDraft\("restore", total, imagePasteTextOptions\);/);
  assert.match(source, /const confirmDraft = photoEditStackVersionConfirmDialogDraft\("delete", total, imagePasteTextOptions\);/);
  assert.match(source, /confirmPhotoAction\(confirmDraft\)/);
  assert.match(source, /photoEditStackVersionSingleResultMessage\("duplicate", version\.label, imagePasteTextOptions\)/);
  assert.match(source, /const confirmDraft = photoEditStackVersionSingleConfirmDialogDraft\("restore", selectedPhotoEditStackVersion\.label, imagePasteTextOptions\);/);
  assert.match(source, /photoEditStackVersionSingleResultMessage\("restore", selectedPhotoEditStackVersion\.label, imagePasteTextOptions\)/);
  assert.match(source, /const confirmDraft = photoEditStackVersionSingleConfirmDialogDraft\("delete", selectedPhotoEditStackVersion\.label, imagePasteTextOptions\);/);
  assert.match(source, /photoEditStackVersionSingleResultMessage\("delete", selectedPhotoEditStackVersion\.label, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionSnapshotResultMessage\(snapshotted, failed, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionRestoreResultMessage\(restored, skipped, failed, imagePasteTextOptions\)/);
  assert.match(source, /photoEditStackVersionDeleteResultMessage\(deleted, skipped, failed, imagePasteTextOptions\)/);
  assert.doesNotMatch(source, /function photoPasteProgressMessage/);
  assert.doesNotMatch(source, /function photoPasteResultMessage/);
  assert.doesNotMatch(source, /function photoPasteConflictPreviewText/);
  assert.doesNotMatch(source, /const multiple = conflictCount !== 1/);
  assert.doesNotMatch(source, /Pasting copied edits will replace the existing edit stack/);
  assert.doesNotMatch(source, /Restored edit versions.*skippedLabel/);
  assert.doesNotMatch(source, /Deleted edit versions.*skippedLabel/);
  assert.doesNotMatch(source, /Snapshotted edit versions.*failedLabel/);
  assert.doesNotMatch(source, /uiText\("Snapshotting edit versions"\)/);
  assert.doesNotMatch(source, /uiText\("Restoring edit versions"\)/);
  assert.doesNotMatch(source, /uiText\("Deleting edit versions"\)/);
  assert.doesNotMatch(source, /uiText\("Restore latest saved versions\?"\)/);
  assert.doesNotMatch(source, /uiText\("Delete saved edit versions\?"\)/);
  assert.doesNotMatch(source, /uiText\("Restore edit version\?"\)/);
  assert.doesNotMatch(source, /uiText\("Delete edit version\?"\)/);
  assert.doesNotMatch(source, /uiText\("Duplicated edit version"\)/);
  assert.doesNotMatch(source, /uiText\("Restored edit version"\)/);
  assert.doesNotMatch(source, /uiText\("Deleted edit version"\)/);
  assert.doesNotMatch(source, /uiText\("This replaces the current edit stack with"\)/);
  assert.doesNotMatch(source, /uiText\("The current edit stack is not changed\."\)/);
  assert.doesNotMatch(source, /uiText\("Duplicated photo version"\)/);
  assert.doesNotMatch(source, /uiText\("Created rendered copy"\)/);
  assert.doesNotMatch(source, /uiText\("Revert selected edits\?"\)/);
  assert.doesNotMatch(source, /uiText\("Remove saved edit stacks from"\)/);
  assert.doesNotMatch(source, /uiText\("Original files stay unchanged\."\)/);
  assert.doesNotMatch(source, /uiText\("Reverting edits"\)/);
  assert.doesNotMatch(source, /uiText\("Reverted edits"\)/);
  assert.doesNotMatch(source, /normalizePhotoImageEditOperation\(imageEditClipboard \? \{ \.\.\.imageEditClipboard, source: "photos-lightbox-paste" \} : null\)/);
  assert.doesNotMatch(source, /normalizePhotoImageEditOperation\(imageEditClipboard \? \{ \.\.\.imageEditClipboard, source: "photos-bulk-paste" \} : null\)/);
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
  assert.strictEqual(
    imageEditsMod.photoImageEditPasteHasConflict(
      { ...first, source: "existing" },
      { ...first, source: "incoming" }
    ),
    false
  );
  assert.strictEqual(imageEditsMod.photoImageEditPasteHasConflict(first, second), true);
  assert.strictEqual(imageEditsMod.photoImageEditPasteHasConflict(null, second), false);
  assert.strictEqual(
    imageEditsMod.photoImageAdjustmentPasteHasConflict(
      { rotateDegrees: 90, adjustments: { exposure: 0.4 } },
      { rotateDegrees: 90, adjustments: { exposure: 0.6 } },
    ),
    true
  );
  assert.strictEqual(
    imageEditsMod.photoImageAdjustmentPasteHasConflict(
      { adjustments: { exposure: 0.4 } },
      { adjustments: { exposure: 0.4 }, source: "incoming" },
    ),
    false
  );
  assert.strictEqual(
    imageEditsMod.photoImageAdjustmentPasteHasConflict(
      { cropAspect: "square" },
      { adjustments: { exposure: 0.4 } },
    ),
    false
  );

  const copyDraft = imageEditsMod.photoImageEditClipboardCopyDraft(first, [], {
    source: "unit-copy",
    copiedAt: "2026-07-09T01:00:00Z",
    id: "copy-one",
  });
  assert.strictEqual(copyDraft.selectedId, "copy-one");
  assert.strictEqual(copyDraft.operation.source, "unit-copy");
  assert.strictEqual(copyDraft.label, "R90 / Original / Adj E+0.5 / No flip");
  assert.deepStrictEqual(copyDraft.history.map((entry) => entry.id), ["copy-one"]);
  assert.strictEqual(imageEditsMod.photoImageEditClipboardCopyDraft({ cropAspect: "none" }, copyDraft.history), null);
  const pasteOperation = imageEditsMod.photoImageEditClipboardPasteOperation(copyDraft.operation, " unit-paste ");
  assert.strictEqual(pasteOperation.source, "unit-paste");
  assert.strictEqual(pasteOperation.rotateDegrees, 90);
  assert.strictEqual(pasteOperation.adjustments.exposure, 0.5);
  assert.strictEqual(imageEditsMod.photoImageEditClipboardPasteOperation(null, "unit-paste"), null);
  assert.strictEqual(imageEditsMod.photoImageEditClipboardPasteOperation({ cropAspect: "none" }, "unit-paste"), null);
  const pasteTextOptions = {
    uiText: (value) => value,
    formatCount: (value) => `#${value}`,
  };
  assert.strictEqual(
    imageEditsMod.photoImagePasteProgressMessage("edits", "checking", 2, 5, pasteTextOptions),
    "Checking paste conflicts for edits: #2/#5 photos."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteProgressMessage("adjustments", "pasting", 3, 1, pasteTextOptions),
    "Pasting adjustments: #1/#1 photo."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteResultMessage("edits", 3, 2, 1, pasteTextOptions),
    "Pasted edits to #3 photos. Replaced existing edits on #2 photos. Failed #1 photo."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteResultMessage("adjustments", 1, 0, 0, pasteTextOptions),
    "Pasted adjustments to #1 photo."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteResultMessage("adjustments", 2, 1, 0, { ...pasteTextOptions, skipped: 3 }),
    "Pasted adjustments to #2 photos. Replaced existing adjustments on #1 photo. Skipped #3."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteConflictPreviewText("edit", first, pasteTextOptions),
    "Copied edit: R90 / Original / Adj E+0.5 / No flip."
  );
  assert.strictEqual(
    imageEditsMod.photoImagePasteConflictPreviewText("adjustments", first, pasteTextOptions),
    "Copied adjustments: Adj E+0.5."
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImagePasteConflictDialogDraft(2, "edit", first, pasteTextOptions),
    {
      title: "Replace existing edits?",
      message: "#2 photos already have saved edits. Pasting copied edits will replace the existing edit stack. Copied edit: R90 / Original / Adj E+0.5 / No flip.",
      confirmLabel: "Replace edits",
      cancelLabel: "Cancel",
      preview: "Copied edit: R90 / Original / Adj E+0.5 / No flip.",
    }
  );
  assert.deepStrictEqual(
    imageEditsMod.photoImagePasteConflictDialogDraft(1, "adjustments", first, pasteTextOptions),
    {
      title: "Replace existing adjustments?",
      message: "#1 photo already has saved adjustments. Pasting adjustments will replace those sliders while preserving crop, rotation, filters, and flips. Copied adjustments: Adj E+0.5.",
      confirmLabel: "Replace adjustments",
      cancelLabel: "Cancel",
      preview: "Copied adjustments: Adj E+0.5.",
    }
  );
  assert.strictEqual(imageEditsMod.photoImagePasteConflictDialogDraft(0, "edit", first, pasteTextOptions), null);

  const selectDraft = imageEditsMod.photoImageEditClipboardSelectionDraft(copyDraft.history, "copy-one");
  assert.strictEqual(selectDraft.selectedId, "copy-one");
  assert.strictEqual(selectDraft.operation.rotateDegrees, 90);
  assert.strictEqual(selectDraft.label, "R90 / Original / Adj E+0.5 / No flip");
  assert.deepStrictEqual(
    imageEditsMod.photoImageEditClipboardSelectionDraft(copyDraft.history, "missing"),
    { entry: null, selectedId: "", operation: null, label: "" }
  );

  const deleteDraft = imageEditsMod.photoImageEditClipboardDeleteDraft(deduped, "first-again");
  assert.deepStrictEqual(deleteDraft.history.map((entry) => entry.id), ["second"]);
  assert.strictEqual(deleteDraft.selectedId, "second");
  assert.strictEqual(deleteDraft.operation.cropAspect, "square");
});

run("photo image edit storage normalizes clipboard and signatures", () => {
  assert.strictEqual(imageEditsMod.PHOTO_IMAGE_EDIT_CLIPBOARD_KEY, "vintrace.photos.imageEditClipboardHistory");
  assert.strictEqual(imageEditsMod.PHOTO_IMAGE_SIGNATURE_PRESETS_KEY, "vintrace.photos.imageSignaturePresets");
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };

  try {
    values.set(imageEditsMod.PHOTO_IMAGE_EDIT_CLIPBOARD_KEY, "{bad json");
    values.set(imageEditsMod.PHOTO_IMAGE_SIGNATURE_PRESETS_KEY, "{bad json");
    assert.deepStrictEqual(
      imageEditsMod.readStoredPhotoImageEditClipboardHistory(imageEditsMod.PHOTO_IMAGE_EDIT_CLIPBOARD_KEY),
      [],
    );
    assert.deepStrictEqual(
      imageEditsMod.readStoredPhotoImageSignaturePresets(imageEditsMod.PHOTO_IMAGE_SIGNATURE_PRESETS_KEY),
      [],
    );

    const operation = imageEditsMod.normalizePhotoImageEditOperation({
      rotateDegrees: 90,
      adjustments: { exposure: 0.5 },
    });
    const history = imageEditsMod.upsertPhotoImageEditClipboardHistory([], operation, {
      copiedAt: "2026-07-08T01:00:00Z",
      id: "clipboard-one",
    });
    const signature = imageEditsMod.photoImageSignaturePresetFromAnnotation({
      kind: "signature",
      points: [{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 10 }],
      left: 10,
      top: 10,
      width: 20,
      height: 10,
      color: "#22c55e",
      backgroundColor: "#111827",
      opacity: 80,
      fontSize: 5,
    }, {
      id: "sig-storage",
      name: "Storage signature",
      createdAt: "2026-07-08T01:00:00Z",
    });

    imageEditsMod.storePhotoImageEditClipboardHistory(imageEditsMod.PHOTO_IMAGE_EDIT_CLIPBOARD_KEY, [
      ...history,
      { id: "bad", operation: null },
    ]);
    imageEditsMod.storePhotoImageSignaturePresets(imageEditsMod.PHOTO_IMAGE_SIGNATURE_PRESETS_KEY, [
      signature,
      signature,
      { id: "bad", points: [{ x: 1, y: 2 }] },
    ]);

    assert.deepStrictEqual(
      imageEditsMod.readStoredPhotoImageEditClipboardHistory(imageEditsMod.PHOTO_IMAGE_EDIT_CLIPBOARD_KEY).map((entry) => entry.id),
      ["clipboard-one"],
    );
    assert.deepStrictEqual(
      imageEditsMod.readStoredPhotoImageSignaturePresets(imageEditsMod.PHOTO_IMAGE_SIGNATURE_PRESETS_KEY).map((preset) => preset.id),
      ["sig-storage"],
    );
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
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

run("Photos shortcut discovery panel stays outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/views/photoShortcutsPanel.tsx"), "utf8");
  assert.match(source, /PhotoShortcutsPanel/);
  assert.match(source, /keywordShortcuts=\{photoKeywordShortcutRows\}/);
  assert.match(source, /onClose=\{\(\) => setPhotoShortcutPanelOpen\(false\)\}/);
  assert.doesNotMatch(source, /photos-shortcut-panel/);
  assert.doesNotMatch(source, /PHOTO_SHORTCUT_DISCOVERY_GROUPS\.map/);
  assert.match(panelSource, /export function PhotoShortcutsPanel/);
  assert.match(panelSource, /PHOTO_SHORTCUT_DISCOVERY_GROUPS\.map/);
  assert.match(panelSource, /props\.uiText\("Press \? to show or hide this panel"\)/);
  assert.match(panelSource, /props\.keywordShortcuts\.map/);
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

run("Photos keyword manager panel stays outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/views/photoKeywordManagerPanel.tsx"), "utf8");
  assert.match(source, /PhotoKeywordManagerPanel/);
  assert.match(source, /keywords=\{keywordOptions\}/);
  assert.match(source, /drafts=\{keywordDrafts\}/);
  assert.match(source, /onCreateKeyword=\{saveKeywordManagerRow\}/);
  assert.match(source, /onImportKeywords=\{importKeywordVocabulary\}/);
  assert.match(source, /onRevealExport=\{revealPath\}/);
  assert.doesNotMatch(source, /photos-keyword-panel/);
  assert.doesNotMatch(source, /keywordOptions\.map\(\(keyword\) => \{\s*const draft = keywordDrafts/);
  assert.match(panelSource, /export function PhotoKeywordManagerPanel/);
  assert.match(panelSource, /photos-keyword-panel/);
  assert.match(panelSource, /props\.keywords\.map\(\(keyword\) =>/);
  assert.match(panelSource, /props\.uiText\("Keyword import JSON"\)/);
  assert.match(panelSource, /props\.onDraftChange\(keyword\.keywordId/);
});

run("Photos Pet Review kind chips stay outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const chipsSource = fs.readFileSync(path.join(ROOT, "src/views/photoPetReviewKindChips.tsx"), "utf8");
  assert.match(source, /PhotoPetReviewKindChips/);
  assert.match(source, /kinds=\{activePetReviewKinds\}/);
  assert.match(source, /selectedKind=\{petReviewKindFilter\}/);
  assert.match(source, /onSelectKind=\{setPetReviewKindFilter\}/);
  assert.doesNotMatch(source, /photo-pet-review-kind-chips/);
  assert.doesNotMatch(source, /activePetReviewKinds\.map\(\(kind\) => \{/);
  assert.match(chipsSource, /export function PhotoPetReviewKindChips/);
  assert.match(chipsSource, /photo-pet-review-kind-chips/);
  assert.match(chipsSource, /props\.kinds\.map\(\(kind\) =>/);
  assert.match(chipsSource, /props\.uiText\("Pet Review kind filters"\)/);
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

run("buildPhotoSearchHighlightParts maps folded offsets back to original text", () => {
  assert.deepStrictEqual(
    searchHighlightsMod.buildPhotoSearchHighlightParts("İstanbul ticket", "İs"),
    [
      { text: "İs", match: true },
      { text: "tanbul ticket", match: false },
    ],
  );
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

run("photo utility classifier review helpers normalize entries and patches", () => {
  const match = {
    classifierId: "utility:documents",
    classifierKind: "document",
    classifierName: "Documents",
    term: "receipt",
    field: "filename",
    fieldLabel: "Filename",
    value: "Receipt    2026\nAcme",
    evidenceLabel: "Filename",
  };
  const item = {
    utilityMatch: match,
    assetMetadata: {
      utilityClassifierReview: {
        entries: [
          { classifier: "utility:documents", field: " filename ", label: " receipt ", status: "reject", value: "  Old\nvalue  ", reviewedAt: "2026-07-01T00:00:00Z" },
          { classifierId: "UTILITY:DOCUMENTS", field: "filename", term: "receipt", action: "rejected" },
          { classifierId: "utility:documents", field: "filename", term: "receipt", action: "accepted", value: "new" },
          { classifierId: "utility:documents", field: "other", term: "receipt", action: "rejected" },
          { classifierId: "", field: "filename", term: "receipt", action: "rejected" },
          { classifierId: "utility:documents", field: "filename", term: "", action: "rejected" },
          { classifierId: "utility:documents", field: "filename", term: "receipt", action: "maybe" },
        ],
      },
    },
  };

  assert.strictEqual(
    utilityReviewMod.photoUtilityMatchReviewKey({ classifierId: "UTILITY:Documents", field: " Filename ", term: " Receipt " }),
    "utility:documents:filename:receipt",
  );

  const entries = utilityReviewMod.photoUtilityMatchReviewEntries(item);
  assert.deepStrictEqual(entries.map((entry) => [entry.classifierId, entry.field, entry.term, entry.action, entry.value || ""]), [
    ["utility:documents", "filename", "receipt", "rejected", "Old value"],
    ["utility:documents", "filename", "receipt", "confirmed", "new"],
    ["utility:documents", "other", "receipt", "rejected", ""],
  ]);
  assert.strictEqual(utilityReviewMod.photoUtilityMatchReviewAction(item, match), "confirmed");
  assert.strictEqual(
    utilityReviewMod.photoUtilityReviewEntryMatches({ classifierId: "utility:documents", field: "all", term: "all", action: "rejected" }, match),
    true,
  );

  const rejectPatch = utilityReviewMod.photoUtilityClassifierReviewPatch(item, match, "rejected");
  assert.deepStrictEqual(rejectPatch.entries.map((entry) => [entry.field, entry.term, entry.action]), [
    ["other", "receipt", "rejected"],
    ["filename", "receipt", "rejected"],
  ]);
  assert.strictEqual(rejectPatch.entries[1].value, "Receipt 2026 Acme");
  assert.match(rejectPatch.entries[1].reviewedAt, /^\d{4}-\d{2}-\d{2}T/);

  const clearPatch = utilityReviewMod.photoUtilityClassifierReviewPatch({ assetMetadata: { utilityClassifierReview: rejectPatch } }, match, "clear");
  assert.deepStrictEqual(clearPatch.entries.map((entry) => [entry.field, entry.term, entry.action]), [
    ["other", "receipt", "rejected"],
  ]);

  const sensitiveMatch = {
    classifierId: "utility:sensitive",
    classifierKind: "sensitive_content",
    classifierName: "Sensitive",
    term: "skin",
    field: "label",
    fieldLabel: "Label",
    value: "skin",
    evidenceLabel: "Label",
  };
  const sensitivePatch = utilityReviewMod.photoUtilityClassifierReviewPatch({ assetMetadata: { utilityClassifierReview: { entries: [] } } }, sensitiveMatch, "rejected");
  assert.deepStrictEqual(sensitivePatch.entries.map((entry) => [entry.classifierId, entry.field, entry.term, entry.action]), [
    ["utility:sensitive", "*", "*", "rejected"],
  ]);
  assert.strictEqual(
    utilityReviewMod.photoUtilityReviewEntryMatches(sensitivePatch.entries[0], { ...sensitiveMatch, field: "caption", term: "blood" }),
    true,
  );
  assert.strictEqual(utilityReviewMod.photoUtilityRejectLabel(sensitiveMatch), "Not sensitive");
  assert.strictEqual(utilityReviewMod.photoUtilityRejectLabel(match), "Not this");
});

run("Photos utility classifier evidence renders as badge and lightbox action", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const gridTileSource = fs.readFileSync(path.join(ROOT, "src/views/photoGridTile.tsx"), "utf8");
  const gridPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoVirtualGridPanel.tsx"), "utf8");
  const utilityReviewSource = fs.readFileSync(path.join(ROOT, "src/views/photoUtilityClassifierReview.ts"), "utf8");
  const typesSource = fs.readFileSync(path.join(ROOT, "src/types.ts"), "utf8");
  assert.match(typesSource, /export interface PhotoUtilityMatch/);
  assert.match(typesSource, /utilityMatch\?: PhotoUtilityMatch/);
  assert.match(photosViewSource, /from "\.\/photoUtilityClassifierReview"/);
  assert.match(photosViewSource, /from "\.\/photoVirtualGridPanel"/);
  assert.match(gridPanelSource, /from "\.\/photoGridTile"/);
  assert.match(gridTileSource, /photo-utility-match-badge/);
  assert.match(photosViewSource, /copyPhotoUtilityMatch/);
  assert.match(photosViewSource, /utilityClassifierReview/);
  assert.match(photosViewSource, /photoUtilityClassifierReviewPatch/);
  assert.match(photosViewSource, /uiText\("Utility match"\)/);
  assert.match(photosViewSource, /uiText\("Copy match"\)/);
  assert.match(photosViewSource, /uiText\("Confirm match"\)/);
  assert.match(photosViewSource, /photoUtilityRejectLabel/);
  assert.match(photosViewSource, /uiText\("Undo utility review"\)/);
  assert.doesNotMatch(photosViewSource, /function photoUtilityClassifierReviewPatch/);
  assert.match(utilityReviewSource, /export function photoUtilityClassifierReviewPatch/);
  assert.match(utilityReviewSource, /Not sensitive/);
  assert.match(utilityReviewSource, /utility:sensitive/);
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
  assert.strictEqual(railMod.isUtilityCoverAllowed(null), false);
  assert.strictEqual(railMod.isUtilityCoverAllowed({ id: "media:video", kind: "utility" }), true);
  assert.strictEqual(railMod.isUtilityCoverAllowed({ id: "utility:qr", kind: "utility" }), true);
  assert.strictEqual(railMod.isUtilityCoverAllowed({ id: "recentlyViewed", kind: "utility" }), true);
  assert.strictEqual(railMod.isUtilityCoverAllowed({ id: "imports", kind: "utility" }), false);
  assert.strictEqual(railMod.isUtilityCoverAllowed({ id: "person:Ada", kind: "person" }), false);
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
  const ancestorMap = railMod.buildPhotoRailAlbumTreeAncestorIdMap(albumsSection.folders);
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
  assert.deepStrictEqual(
    albumsSection.folders.map((folder) => [folder.id, ancestorMap.get(folder.id)]),
    [
      ["albumFolder:f1", []],
      ["albumFolder:f2", ["f1"]],
      ["album:child-manual", ["f2", "f1"]],
      ["album:folder-smart", ["f1"]],
      ["album:manual-root", []],
    ],
  );
  assert.strictEqual(railMod.photoRailAlbumTreeItemId(folders[3]), "album:folder-smart".replace(/^album:/, ""));
  assert.strictEqual(railMod.photoRailAlbumTreeItemId(folders[4]), "f1");
  assert.strictEqual(railMod.photoRailAlbumTreeParentId(folders[6]), "f2");
  assert.strictEqual(railMod.photoRailAlbumTreeParentId(folders[5]), "f1");
  assert.strictEqual(railMod.photoRailAlbumTreePosition({ id: "album:unset", kind: "album" }), 2147483647);
  assert.deepStrictEqual(
    railMod.photoRailAlbumTreeSiblings(folders[6], albumsSection.folders).map((folder) => folder.id),
    ["album:child-manual"],
  );
  assert.deepStrictEqual(
    railMod.photoRailAlbumTreeSiblings(folders[3], albumsSection.folders).map((folder) => folder.id),
    ["albumFolder:f2", "album:folder-smart"],
  );
  assert.deepStrictEqual(
    railMod.photoRailAlbumTreeAncestorIds(folders[6], albumsSection.folders),
    ["f2", "f1"],
  );
  const albumFolders = folders.filter((folder) => folder.kind === "albumFolder");
  const albums = folders.filter((folder) => folder.kind === "album");
  const rootGallery = railMod.buildPhotoAlbumGalleryState(albumFolders, albums, "");
  assert.strictEqual(rootGallery.browsedFolder, null);
  assert.deepStrictEqual(rootGallery.breadcrumbFolders, []);
  assert.deepStrictEqual(rootGallery.folderCards.map((card) => [card.folder.id, card.folderKey, card.childCount]), [["albumFolder:f1", "f1", 2]]);
  assert.deepStrictEqual(rootGallery.albumCards.map((folder) => folder.id), ["album:loose-smart", "album:manual-root"]);

  const nestedGallery = railMod.buildPhotoAlbumGalleryState(albumFolders, albums, "f2");
  assert.strictEqual(nestedGallery.browsedFolder?.id, "albumFolder:f2");
  assert.deepStrictEqual(nestedGallery.breadcrumbFolders.map((folder) => folder.id), ["albumFolder:f1"]);
  assert.deepStrictEqual(nestedGallery.folderCards, []);
  assert.deepStrictEqual(nestedGallery.albumCards.map((folder) => folder.id), ["album:child-manual"]);
});

run("planPhotoRailAlbumTreeDrop supports inside and sibling moves without cycles", () => {
  const folders = [
    { id: "album:loose", kind: "album", albumKind: "manual", name: "Loose", albumId: "loose", folderPosition: 0 },
    { id: "albumFolder:f1", kind: "albumFolder", name: "Trips", folderId: "f1", position: 0 },
    { id: "albumFolder:f2", kind: "albumFolder", name: "Nested", folderId: "f2", parentFolderId: "f1", position: 0 },
    { id: "album:smart", kind: "album", albumKind: "smart", name: "Smart", albumId: "smart", folderId: "f1", folderPosition: 2 },
  ];
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[1], 0.05), "before");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[1], 0.5), "inside");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[1], 0.95), "after");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[0], 0.49), "before");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[0], 0.5), "after");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromRatio(folders[1], Number.NaN), "inside");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromBounds(folders[1], 21, 20, 20), "before");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromBounds(folders[1], 30, 20, 20), "inside");
  assert.strictEqual(railMod.photoRailAlbumTreeDropPlacementFromBounds(folders[1], 39, 20, 20), "after");
  assert.deepStrictEqual(
    railMod.photoRailAlbumTreeDragTargetState(null, folders, folders[1], "album:loose", "inside"),
    { draggedId: "album:loose", targetId: "albumFolder:f1", placement: "inside", valid: true },
  );
  assert.deepStrictEqual(
    railMod.photoRailAlbumTreeDragTargetState(null, folders, folders[0], "albumFolder:f1", "inside"),
    { draggedId: "albumFolder:f1", targetId: "album:loose", placement: "inside", valid: false },
  );
  const existingAlbumTreeDrag = { draggedId: "album:loose", targetId: "albumFolder:f1", placement: "inside", valid: true };
  assert.strictEqual(
    railMod.photoRailAlbumTreeDragTargetState(existingAlbumTreeDrag, folders, folders[1], "album:loose", "inside"),
    existingAlbumTreeDrag,
  );
  assert.strictEqual(railMod.photoRailAlbumTreeDragTargetState(null, folders, folders[1], "", "inside"), null);
  assert.strictEqual(railMod.photoRailAlbumTreeDragTargetState(null, folders, { id: "all", kind: "all" }, "album:loose", "inside"), null);
  assert.deepStrictEqual(railMod.photoRailAlbumTreeReorderDraft(folders[1], [folders[0], folders[1]], 1, "up"), {
    parentFolderId: "",
    items: [
      { kind: "albumFolder", id: "f1" },
      { kind: "album", id: "loose" },
    ],
  });
  assert.deepStrictEqual(railMod.photoRailAlbumTreeReorderDraft(folders[0], [folders[1], folders[0]], 0, "up"), {
    parentFolderId: "",
    items: [
      { kind: "album", id: "loose" },
      { kind: "albumFolder", id: "f1" },
    ],
  });
  assert.strictEqual(railMod.photoRailAlbumTreeReorderDraft(folders[0], [folders[0], folders[1]], 0, "up"), null);
  assert.strictEqual(railMod.photoRailAlbumTreeReorderDraft(null, [folders[0], folders[1]], 0, "down"), null);

  const inside = railMod.planPhotoRailAlbumTreeDrop(folders, "album:loose", "albumFolder:f1", "inside");
  assert.strictEqual(inside.valid, true);
  assert.strictEqual(inside.parentFolderId, "f1");
  assert.deepStrictEqual(inside.items.map((item) => `${item.kind}:${item.id}`), ["albumFolder:f2", "album:smart", "album:loose"]);
  assert.deepStrictEqual(railMod.photoRailAlbumTreeMoveDraft(folders[0], inside), {
    kind: "album",
    payload: {
      albumId: "loose",
      folderId: "f1",
      position: 2,
    },
  });

  const before = railMod.planPhotoRailAlbumTreeDrop(folders, "album:smart", "albumFolder:f2", "before");
  assert.strictEqual(before.valid, true);
  assert.strictEqual(before.parentFolderId, "f1");
  assert.deepStrictEqual(before.items.map((item) => `${item.kind}:${item.id}`), ["album:smart", "albumFolder:f2"]);
  assert.strictEqual(railMod.photoRailAlbumTreeMoveDraft(folders[3], before), null);

  const folderToRoot = railMod.planPhotoRailAlbumTreeDrop(folders, "albumFolder:f2", "album:loose", "before");
  assert.strictEqual(folderToRoot.valid, true);
  assert.deepStrictEqual(railMod.photoRailAlbumTreeMoveDraft(folders[2], folderToRoot), {
    kind: "albumFolder",
    payload: {
      folderId: "f2",
      name: "Nested",
      parentFolderId: "",
      position: 0,
    },
  });

  const cycle = railMod.planPhotoRailAlbumTreeDrop(folders, "albumFolder:f1", "albumFolder:f2", "inside");
  assert.strictEqual(cycle.valid, false);
  assert.strictEqual(cycle.reason, "cycle");
  assert.strictEqual(railMod.photoRailAlbumTreeMoveDraft(folders[1], cycle), null);
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
  assert.strictEqual(railMod.photoRailDropPlacementFromRatio(0.49), "before");
  assert.strictEqual(railMod.photoRailDropPlacementFromRatio(0.5), "after");
  assert.strictEqual(railMod.photoRailDropPlacementFromRatio(Number.NaN), "after");
  assert.strictEqual(railMod.photoRailDropPlacementFromBounds(24, 20, 20), "before");
  assert.strictEqual(railMod.photoRailDropPlacementFromBounds(34, 20, 20), "after");
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
  assert.deepStrictEqual(
    railMod.photoRailSectionDragTargetState(null, "albums", "utilities", ["library", "albums", "utilities"], "before"),
    { draggedId: "utilities", targetId: "albums", placement: "before", valid: true },
  );
  assert.deepStrictEqual(
    railMod.photoRailSectionDragTargetState(null, "albums", "utilities", ["library", "albums"], "before"),
    { draggedId: "utilities", targetId: "albums", placement: "before", valid: false },
  );
  const existingSectionDrag = { draggedId: "utilities", targetId: "albums", placement: "before", valid: true };
  assert.strictEqual(
    railMod.photoRailSectionDragTargetState(existingSectionDrag, "albums", "utilities", ["library", "albums", "utilities"], "before"),
    existingSectionDrag,
  );
  assert.strictEqual(railMod.photoRailSectionDragTargetState(null, "pinned", "utilities", ["library", "utilities"], "before"), null);
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
  assert.deepStrictEqual(
    railMod.photoLocalRailItemDragTargetState(null, "utilities", "favorites", "duplicates", "utilities", "after"),
    { draggedId: "duplicates", sectionId: "utilities", targetId: "favorites", placement: "after", valid: true },
  );
  assert.deepStrictEqual(
    railMod.photoLocalRailItemDragTargetState(null, "utilities", "favorites", "duplicates", "mediaTypes", "after"),
    { draggedId: "duplicates", sectionId: "mediaTypes", targetId: "favorites", placement: "after", valid: false },
  );
  const existingItemDrag = { draggedId: "duplicates", sectionId: "utilities", targetId: "favorites", placement: "after", valid: true };
  assert.strictEqual(
    railMod.photoLocalRailItemDragTargetState(existingItemDrag, "utilities", "favorites", "duplicates", "utilities", "after"),
    existingItemDrag,
  );
  assert.strictEqual(railMod.photoLocalRailItemDragTargetState(null, "albums", "favorites", "duplicates", "albums", "after"), null);
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

run("Photos active filter chips stay outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const chipsSource = fs.readFileSync(path.join(ROOT, "src/views/photoActiveFilterChips.tsx"), "utf8");
  assert.match(source, /PhotoActiveFilterChips/);
  assert.match(source, /chips=\{activeFilterChips\}/);
  assert.match(source, /onClearChip=\{clearPhotoFilterChip\}/);
  assert.match(source, /onSetNearbyRadius=\{setNearbyRadius\}/);
  assert.match(source, /onSaveFilter=\{saveActiveFilterToRail\}/);
  assert.match(source, /onSaveSearch=\{saveActiveSearchAsSmartAlbum\}/);
  assert.doesNotMatch(source, /photo-active-filter-chips/);
  assert.doesNotMatch(source, /activeFilterChips\.map\(\(chip\) => \(\s*<button/);
  assert.match(chipsSource, /export function PhotoActiveFilterChips/);
  assert.match(chipsSource, /photo-active-filter-chips/);
  assert.match(chipsSource, /PHOTO_NEARBY_RADIUS_OPTIONS\.map/);
  assert.match(chipsSource, /props\.chips\.map\(\(chip\) =>/);
  assert.match(chipsSource, /props\.uiText\("Save search"\)/);
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

run("photo keyword draft helpers normalize toggle and compare keywords", () => {
  assert.deepStrictEqual(
    keywordFiltersMod.parseKeywordsDraft(" Family, travel ; Family\n  very   long   keyword  "),
    ["Family", "travel", "very long keyword"],
  );
  assert.deepStrictEqual(
    keywordFiltersMod.parseKeywordsDraft(["  Ada  ", "ada", "Grace", "", 42]),
    ["Ada", "Grace", "42"],
  );
  assert.strictEqual(keywordFiltersMod.parseKeywordsDraft(Array.from({ length: 80 }, (_, index) => `k${index}`)).length, 64);
  assert.strictEqual(keywordFiltersMod.formatKeywords([" Ada ", "Grace", "ada"]), "Ada, Grace");
  assert.strictEqual(keywordFiltersMod.toggleKeywordDraft("Ada, Grace", "ada"), "Grace");
  assert.strictEqual(keywordFiltersMod.toggleKeywordDraft("Ada", "Milo"), "Ada, Milo");
  assert.strictEqual(keywordFiltersMod.toggleKeywordDraft("Ada", "   "), "Ada");
  assert.strictEqual(keywordFiltersMod.keywordsEqual(["Ada", "Grace"], [" grace ", "ada"]), true);
  assert.strictEqual(keywordFiltersMod.keywordsEqual(["Ada"], ["Ada", "Milo"]), false);
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

run("photo saved filter helpers compare and coerce filter values", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const savedSearchSource = fs.readFileSync(path.join(ROOT, "src/views/photoSavedSearch.ts"), "utf8");
  const left = savedSearchMod.normalizePhotoSavedFilterState({
    searchQuery: "Family",
    mediaKind: "live_photo",
    status: "accepted",
    visibility: "hidden",
  });
  const right = savedSearchMod.normalizePhotoSavedFilterState({
    searchQuery: "Family",
    mediaKind: "live_photo",
    status: "accepted",
    visibility: "hidden",
  });
  const different = savedSearchMod.normalizePhotoSavedFilterState({
    searchQuery: "Family",
    mediaKind: "video",
    status: "accepted",
    visibility: "hidden",
  });
  assert.strictEqual(savedSearchMod.photoSavedFilterStatesEqual(left, right), true);
  assert.strictEqual(savedSearchMod.photoSavedFilterStatesEqual(left, different), false);
  assert.strictEqual(savedSearchMod.photoMediaFilterValue("live_photo"), "live_photo");
  assert.strictEqual(savedSearchMod.photoMediaFilterValue("screen_recording"), "screen_recording");
  assert.strictEqual(savedSearchMod.photoMediaFilterValue("bad"), "");
  assert.strictEqual(savedSearchMod.photoStatusFilterValue("uncertain"), "uncertain");
  assert.strictEqual(savedSearchMod.photoStatusFilterValue("archived"), "");
  assert.strictEqual(savedSearchMod.photoVisibilityFilterValue("deleted"), "deleted");
  assert.strictEqual(savedSearchMod.photoVisibilityFilterValue("visible"), "");
  assert.match(photosViewSource, /from "\.\/photoSavedSearch"/);
  assert.doesNotMatch(photosViewSource, /function photoMediaFilterValue/);
  assert.doesNotMatch(photosViewSource, /function photoSavedFilterStatesEqual/);
  assert.match(savedSearchSource, /export function photoMediaFilterValue/);
  assert.match(savedSearchSource, /export function photoSavedFilterWorkspacePayload/);
  assert.match(photosViewSource, /photoSavedFilterWorkspacePayload\(filter, index\)/);
  assert.match(photosViewSource, /photoSavedFilterWorkspacePayload\(savedFilter, 0\)/);
  assert.doesNotMatch(photosViewSource, /function savedFilterWorkspacePayload/);
  const persistBlock = photosViewSource.match(/async function persistSavedFiltersToWorkspace\(filters: PhotoSavedFilter\[\]\) \{[\s\S]*?\n  \}\n\n  function commitSavedFilters/);
  assert.ok(persistBlock, "persistSavedFiltersToWorkspace should exist");
  assert.doesNotMatch(persistBlock[0], /filterId: filter\.id/);
  const saveActiveFilterBlock = photosViewSource.match(/async function saveActiveFilterToRail\(\) \{[\s\S]*?\n  \}\n\n  function applySavedFilter/);
  assert.ok(saveActiveFilterBlock, "saveActiveFilterToRail should exist");
  assert.doesNotMatch(saveActiveFilterBlock[0], /filterId: savedFilter\.id/);
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
    previewPending: false,
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
    previewPending: false,
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

run("photo saved filter storage normalizes local records and caps writes", () => {
  assert.strictEqual(savedSearchMod.SAVED_PHOTO_FILTERS_KEY, "vintrace.photos.savedFilters");
  assert.deepStrictEqual(savedSearchMod.PHOTO_QUALITY_FILTERS, ["0.6", "0.7", "0.8", "0.9"]);
  assert.deepStrictEqual(savedSearchMod.PHOTO_FILE_TYPE_FILTERS, ["jpg", "png", "heic", "dng", "mov", "mp4", "tiff", "gif", "webp"]);
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  try {
    const filters = Array.from({ length: 35 }, (_, index) => savedSearchMod.buildPhotoSavedFilter({
      searchQuery: `Filter ${index}`,
      favoriteOnly: index % 2 === 0,
    }, {
      id: `filter-${index}`,
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    savedSearchMod.storePhotoSavedFilters(savedSearchMod.SAVED_PHOTO_FILTERS_KEY, filters);
    assert.strictEqual(JSON.parse(values.get(savedSearchMod.SAVED_PHOTO_FILTERS_KEY)).length, 30);
    const readBack = savedSearchMod.readStoredPhotoSavedFilters(savedSearchMod.SAVED_PHOTO_FILTERS_KEY);
    assert.strictEqual(readBack.length, 30);
    assert.ok(readBack.every((filter, index) => filter.position === index));

    values.set("mixed", JSON.stringify([
      null,
      { id: "", name: "", createdAt: "", filters: {}, rules: {} },
      filters[0],
    ]));
    assert.deepStrictEqual(savedSearchMod.readStoredPhotoSavedFilters("mixed").map((filter) => filter.id), ["filter-0"]);
    values.set("bad-json", "{");
    assert.deepStrictEqual(savedSearchMod.readStoredPhotoSavedFilters("bad-json"), []);

    global.window.localStorage.getItem = () => {
      throw new Error("blocked");
    };
    global.window.localStorage.setItem = () => {
      throw new Error("blocked");
    };
    assert.deepStrictEqual(savedSearchMod.readStoredPhotoSavedFilters("blocked"), []);
    assert.doesNotThrow(() => savedSearchMod.storePhotoSavedFilters("blocked", filters));
    assert.deepStrictEqual(savedSearchMod.photoSavedFilterWorkspacePayload({
      id: "filter-1",
      name: "Pinned harbor",
      description: "Harbor videos",
      createdAt: "2026-06-20T00:00:00Z",
      pinned: true,
      filters: savedSearchMod.normalizePhotoSavedFilterState({ searchQuery: "Harbor", mediaKind: "video" }),
      rules: { query: "Harbor", mediaKind: "video" },
    }, 4), {
      filterId: "filter-1",
      name: "Pinned harbor",
      description: "Harbor videos",
      filters: savedSearchMod.normalizePhotoSavedFilterState({ searchQuery: "Harbor", mediaKind: "video" }),
      rules: { query: "Harbor", mediaKind: "video" },
      pinned: true,
      position: 4,
    });
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
});

run("photoAlbumRulesToSmartQuery converts legacy smart rules to grouped DSL", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const savedSearchSource = fs.readFileSync(path.join(ROOT, "src/views/photoSavedSearch.ts"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  const smartQueryGroup = {
    op: "all",
    conditions: [{ field: "favorite", operator: "is", value: true }],
  };
  assert.deepStrictEqual(savedSearchMod.cleanPhotoAlbumRules({
    statuses: ["pending", "pending", "rejected", "archived"],
    query: ` ${"x".repeat(240)} `,
    keyword: ` ${"k".repeat(100)} `,
    folder: " Family ",
    minScore: 2,
    minQuality: -1,
    recentDays: 5000.4,
    favoriteOnly: true,
    editedOnly: true,
    hasVideoFrames: true,
    unknownOnly: true,
    queryDsl: smartQueryGroup,
    op: "any",
    conditions: [{ field: "camera", operator: "contains", value: "Nikon" }],
  }), {
    statuses: ["pending", "rejected"],
    query: "x".repeat(200),
    keyword: "k".repeat(80),
    folder: "Family",
    minScore: 1,
    favoriteOnly: true,
    editedOnly: true,
    hasVideoFrames: true,
    unknownOnly: true,
    recentDays: 3650,
    queryDsl: smartQueryGroup,
    op: "any",
    conditions: [{ field: "camera", operator: "contains", value: "Nikon" }],
  });
  assert.match(savedSearchSource, /export function cleanPhotoAlbumRules\(rules: PhotoAlbumRules\)/);
  assert.match(editorSource, /cleanPhotoAlbumRules\(input\.rules as PhotoAlbumRules\)/);
  assert.doesNotMatch(photosViewSource, /function cleanRules/);
  assert.doesNotMatch(photosViewSource, /cleanPhotoAlbumRules\(albumRules\)/);
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

run("photo duration labels include hours for long videos", () => {
  assert.strictEqual(durationMod.formatPhotoDuration(0), "");
  assert.strictEqual(durationMod.formatPhotoDuration(7000), "7s");
  assert.strictEqual(durationMod.formatPhotoDuration(125000), "2:05");
  assert.strictEqual(durationMod.formatPhotoDuration(7507000), "2:05:07");
  assert.strictEqual(durationMod.formatPhotoDuration("3661000"), "1:01:01");
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

run("formatPhotoDateBucketLabel returns friendly labels and rejects malformed date keys", () => {
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("years"), true);
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("months"), true);
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("days"), true);
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("recentDays"), true);
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("all"), false);
  assert.strictEqual(dateViewsMod.isPhotoDateBucketViewMode("custom"), false);
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026", "years"), "2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06", "months"), "June 2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06-19", "days"), "Jun 19, 2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-06-01", "recentDays"), "Jun 1, 2026");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-13", "months"), "Invalid date");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-00-01", "days"), "Invalid date");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("2026-02-31", "recentDays"), "Invalid date");
  assert.strictEqual(dateViewsMod.formatPhotoDateBucketLabel("custom-date-key", "months"), "custom-date-key");
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

run("buildPhotoDateBuckets drops malformed date-like values", () => {
  const items = [
    { sourcePath: "good.jpg", captureDate: "2026-06-19T10:00:00Z" },
    { sourcePath: "bad-month.jpg", captureDate: "2026-13-01T10:00:00Z" },
    { sourcePath: "bad-day.jpg", captureDate: "2026-02-31T10:00:00Z" },
  ];
  assert.deepStrictEqual(dateViewsMod.buildPhotoDateBuckets(items, "months").map((bucket) => bucket.key), ["2026-06"]);
  assert.strictEqual(dateViewsMod.photoDateText(items[1]), "");
  assert.strictEqual(dateViewsMod.photoDateText(items[2]), "");
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
  const memoryDetails = curationMod.photoUserMemoryDetails({
    memoryId: " user:trip ",
    name: "Folder Trip",
    memory: {
      memoryId: "user:trip",
      name: "Saved Trip",
      subtitle: "June album",
      coverSourcePath: " /cover.jpg ",
      userCreated: true,
      movieSettings: { theme: "fade" },
    },
  });
  assert.deepStrictEqual(memoryDetails, {
    memoryId: "user:trip",
    userCreated: true,
    title: "Saved Trip",
    saveTitle: "Folder Trip",
    subtitle: "June album",
    coverSourcePath: " /cover.jpg ",
    movieSettings: { theme: "fade" },
    hasMovieSettings: true,
  });
  assert.strictEqual(curationMod.photoUserMemoryDetails({
    memoryId: "user:auto",
    name: "Auto user memory",
  }).userCreated, true);
  assert.strictEqual(curationMod.photoUserMemoryDetailsDirty(memoryDetails, " Saved Trip ", "June album"), false);
  assert.strictEqual(curationMod.photoUserMemoryDetailsDirty(memoryDetails, "Renamed Trip", "June album"), true);
  assert.deepStrictEqual(curationMod.photoUserMemoryDetailsSaveDraft({
    details: memoryDetails,
    titleDraft: "  ",
    subtitleDraft: " New subtitle ",
    fallbackName: "Memory",
  }), {
    memoryId: "user:trip",
    name: "Saved Trip",
    subtitle: "New subtitle",
    coverSourcePath: "/cover.jpg",
  });
  assert.deepStrictEqual(curationMod.photoUserMemoryDetailsSaveDraft({
    details: memoryDetails,
    fallbackName: "Memory",
  }), {
    memoryId: "user:trip",
    name: "Saved Trip",
    subtitle: "June album",
    coverSourcePath: "/cover.jpg",
  });
  assert.deepStrictEqual(curationMod.photoUserMemoryDetailsSaveDraft({
    details: memoryDetails,
    defaultTitle: memoryDetails.saveTitle,
    fallbackName: "Memory",
  }), {
    memoryId: "user:trip",
    name: "Folder Trip",
    subtitle: "June album",
    coverSourcePath: "/cover.jpg",
  });
  assert.deepStrictEqual(curationMod.photoUserMemoryDetailsSaveDraft({
    details: memoryDetails,
    defaultTitle: memoryDetails.saveTitle,
    coverSourcePath: " /new-cover.jpg ",
    fallbackName: "Memory",
  }), {
    memoryId: "user:trip",
    name: "Folder Trip",
    subtitle: "June album",
    coverSourcePath: "/new-cover.jpg",
  });
  assert.strictEqual(curationMod.photoUserMemoryDetailsSaveDraft({
    details: { ...memoryDetails, userCreated: false },
    titleDraft: "Renamed",
  }), null);
  assert.deepStrictEqual(curationMod.photoUserMemoryCreateDraft({
    sourcePaths: [" /a.jpg ", "/b.jpg", "/a.jpg"],
    nameDraft: "  ",
    defaultName: "Selection Memory",
    activeName: "Active album",
    sourceLabel: "",
    selected: true,
    labels: { memory: "Memory", selection: "Selection", currentView: "Current view" },
  }), {
    name: "Selection Memory",
    subtitle: "Selection",
    sourcePaths: ["/a.jpg", "/b.jpg"],
    coverSourcePath: "/a.jpg",
  });
  assert.deepStrictEqual(curationMod.photoUserMemoryCreateDraft({
    sourcePaths: ["/one.jpg", "/two.jpg"],
    nameDraft: " My Memory ",
    defaultName: "Ignored",
    activeName: "Active view",
    sourceLabel: " Search: beach ",
    selected: false,
    labels: { memory: "Memory", selection: "Selection", currentView: "Current view" },
  }), {
    name: "My Memory",
    subtitle: "Search: beach",
    sourcePaths: ["/one.jpg", "/two.jpg"],
    coverSourcePath: "/one.jpg",
  });
  assert.strictEqual(curationMod.photoUserMemoryCreateDraft({
    sourcePaths: ["/one.jpg"],
    nameDraft: "Too small",
  }), null);
  const memoriesFeed = curationMod.buildPhotoMemoriesFeedState([
    { id: "memory:plain", kind: "memory", name: "Plain", count: 3, memory: { memoryId: "plain", startDate: "2026-04-01", endDate: "2026-04-02" } },
    { id: "memory:today", kind: "memory", name: "Today", count: 4, memory: { memoryId: "today", startDate: "2022-07-09", endDate: "2022-07-10", sortHint: "z" } },
    { id: "memory:fav", kind: "memory", name: "Favorite", count: 5, memory: { memoryId: "fav", favorite: true, startDate: "2020-01-01", endDate: "2020-01-02" } },
    { id: "album:not-memory", kind: "album", name: "Ignored", count: 9 },
  ], new Date("2026-07-09T12:00:00.000Z"));
  assert.deepStrictEqual(memoriesFeed.memoryFolders.map((folder) => folder.id), ["memory:plain", "memory:today", "memory:fav"]);
  assert.strictEqual(memoriesFeed.featuredMemory?.id, "memory:fav");
  assert.deepStrictEqual(memoriesFeed.onThisDayMemories.map((folder) => folder.id), ["memory:today"]);
  assert.deepStrictEqual(memoriesFeed.gridMemories.map((folder) => folder.id), ["memory:plain"]);
  assert.deepStrictEqual(curationMod.buildPhotoMemoriesFeedState([], new Date("bad-date")), {
    memoryFolders: [],
    featuredMemory: null,
    onThisDayMemories: [],
    gridMemories: [],
  });
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
  const removalDraft = curationMod.photoMemoryRemovedSourcesDraft({
    preferences: unfavoritedMemory,
    memoryId: " memory:one ",
    sourcePaths: [" /b.jpg ", "/b.jpg", ""],
    memorySourcePaths: ["/a.jpg", "/b.jpg", "/c.jpg"],
    fallbackCount: 20,
  });
  assert.deepStrictEqual({
    sourcePaths: removalDraft.sourcePaths,
    removedPaths: removalDraft.preferences.memoryRemovedItems["memory:one"],
    remaining: removalDraft.remaining,
    shouldExitMemory: removalDraft.shouldExitMemory,
  }, {
    sourcePaths: ["/b.jpg"],
    removedPaths: ["/a.jpg", "/b.jpg"],
    remaining: 1,
    shouldExitMemory: true,
  });
  const fallbackRemovalDraft = curationMod.photoMemoryRemovedSourcesDraft({
    preferences: unfavoritedMemory,
    memoryId: "memory:fallback",
    sourcePaths: ["/x.jpg", "/y.jpg", "/x.jpg"],
    fallbackCount: 5,
  });
  assert.deepStrictEqual({
    sourcePaths: fallbackRemovalDraft.sourcePaths,
    removedPaths: fallbackRemovalDraft.preferences.memoryRemovedItems["memory:fallback"],
    remaining: fallbackRemovalDraft.remaining,
    shouldExitMemory: fallbackRemovalDraft.shouldExitMemory,
  }, {
    sourcePaths: ["/x.jpg", "/y.jpg"],
    removedPaths: ["/x.jpg", "/y.jpg"],
    remaining: 3,
    shouldExitMemory: false,
  });
  assert.strictEqual(curationMod.photoMemoryRemovedSourcesDraft({
    preferences: unfavoritedMemory,
    memoryId: "",
    sourcePaths: ["/x.jpg"],
  }), null);
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

  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const curationSource = fs.readFileSync(path.join(ROOT, "src/views/photoCurationPreferences.ts"), "utf8");
  assert.match(curationSource, /export function photoMemoryRemovedSourcesDraft\(/);
  assert.match(curationSource, /export function photoUserMemoryDetails\(/);
  assert.match(curationSource, /export function photoUserMemoryDetailsDirty\(/);
  assert.match(curationSource, /export function photoUserMemoryDetailsSaveDraft\(/);
  assert.match(curationSource, /export function photoUserMemoryCreateDraft\(/);
  const removeMemoryBlock = photosViewSource.match(/async function removeSourcesFromActiveMemory\(sourcePaths: string\[\]\) \{[\s\S]*?\n  \}\n\n  async function exportActiveMemoryMovie/);
  assert.ok(removeMemoryBlock, "removeSourcesFromActiveMemory should exist");
  assert.match(removeMemoryBlock[0], /const removalDraft = photoMemoryRemovedSourcesDraft\(\{/);
  assert.doesNotMatch(removeMemoryBlock[0], /new Set\(sourcePaths\.map/);
  assert.doesNotMatch(removeMemoryBlock[0], /memorySources\.filter/);
  assert.match(photosViewSource, /const activeUserMemoryDetails = photoUserMemoryDetails\(activeMemory\);/);
  assert.match(photosViewSource, /const activeUserMemoryDetailsDirty = photoUserMemoryDetailsDirty\(/);
  const setCoverBlock = photosViewSource.match(/async function setUserMemoryCover\(item: PhotoItem\) \{[\s\S]*?\n  \}\n\n  async function saveActiveUserMemoryDetails/);
  assert.ok(setCoverBlock, "setUserMemoryCover should exist");
  assert.match(setCoverBlock[0], /const detailsDraft = photoUserMemoryDetailsSaveDraft\(\{/);
  assert.match(setCoverBlock[0], /coverSourcePath: item\.sourcePath/);
  assert.doesNotMatch(setCoverBlock[0], /name: activeMemory\?\.name/);
  const saveDetailsBlock = photosViewSource.match(/async function saveActiveUserMemoryDetails\(\) \{[\s\S]*?\n  \}\n\n  async function saveActiveUserMemoryMovieSettings/);
  assert.ok(saveDetailsBlock, "saveActiveUserMemoryDetails should exist");
  assert.match(saveDetailsBlock[0], /const detailsDraft = photoUserMemoryDetailsSaveDraft\(\{/);
  assert.doesNotMatch(saveDetailsBlock[0], /const name = userMemoryTitleDraft\.trim/);
  assert.doesNotMatch(saveDetailsBlock[0], /const subtitle = userMemorySubtitleDraft\.trim/);
  const saveMovieSettingsBlock = photosViewSource.match(/async function saveActiveUserMemoryMovieSettings\(\) \{[\s\S]*?\n  \}\n\n  async function clearActiveUserMemoryMovieSettings/);
  assert.ok(saveMovieSettingsBlock, "saveActiveUserMemoryMovieSettings should exist");
  assert.match(saveMovieSettingsBlock[0], /const detailsDraft = photoUserMemoryDetailsSaveDraft\(\{/);
  assert.doesNotMatch(saveMovieSettingsBlock[0], /activeMemory\?\.memory\?\.coverSourcePath/);
  const clearMovieSettingsBlock = photosViewSource.match(/async function clearActiveUserMemoryMovieSettings\(\) \{[\s\S]*?\n  \}\n\n  async function deleteActiveUserMemory/);
  assert.ok(clearMovieSettingsBlock, "clearActiveUserMemoryMovieSettings should exist");
  assert.match(clearMovieSettingsBlock[0], /const detailsDraft = photoUserMemoryDetailsSaveDraft\(\{/);
  assert.doesNotMatch(clearMovieSettingsBlock[0], /activeMemory\?\.memory\?\.coverSourcePath/);
  const createMemoryBlock = photosViewSource.match(/async function createUserMemoryFromCurrentView\(\) \{[\s\S]*?\n  \}\n\n  async function setUserMemoryCover/);
  assert.ok(createMemoryBlock, "createUserMemoryFromCurrentView should exist");
  assert.match(createMemoryBlock[0], /const memoryDraft = photoUserMemoryCreateDraft\(\{/);
  assert.match(createMemoryBlock[0], /await savePhotoUserMemory\(\{[\s\S]*\.\.\.memoryDraft/);
  assert.match(createMemoryBlock[0], /libraryRoot: activeLibraryRootRef\.current/);
  assert.doesNotMatch(createMemoryBlock[0], /const name = userMemoryNameDraft\.trim/);
  assert.doesNotMatch(createMemoryBlock[0], /coverSourcePath: sourcePaths\[0\]/);
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

run("photo slideshow chapters preserve timeline durations and labels", () => {
  const chapters = slideshowMod.buildPhotoSlideshowChapters([
    { sourcePath: "/a.jpg", title: "Alpha" },
    { sourcePath: "/b.jpg" },
    { sourcePath: "/c.jpg", title: "Gamma" },
  ], [
    { sourcePath: "/a.jpg", durationMs: 250, motion: "auto" },
    { sourcePath: "/b.jpg", durationMs: 70000, motion: "auto" },
    { sourcePath: "/ghost.jpg", durationMs: 3000, motion: "auto" },
  ], 4500, (item, index) => item.title || `Slide ${index + 1}`);

  assert.deepStrictEqual(chapters.map((chapter) => ({
    id: chapter.id,
    label: chapter.label,
    sourcePath: chapter.sourcePath,
    startIndex: chapter.startIndex,
    endIndex: chapter.endIndex,
    startMs: chapter.startMs,
    durationMs: chapter.durationMs,
  })), [
    { id: "/a.jpg", label: "Alpha", sourcePath: "/a.jpg", startIndex: 0, endIndex: 0, startMs: 0, durationMs: 500 },
    { id: "/b.jpg", label: "Slide 2", sourcePath: "/b.jpg", startIndex: 1, endIndex: 1, startMs: 500, durationMs: 60000 },
    { id: "/c.jpg", label: "Gamma", sourcePath: "/c.jpg", startIndex: 2, endIndex: 2, startMs: 60500, durationMs: 4500 },
  ]);

  assert.deepStrictEqual(
    slideshowMod.buildPhotoSlideshowChapters([{ sourcePath: "", title: "" }], [], 0).map((chapter) => [chapter.id, chapter.label, chapter.durationMs]),
    [["chapter-1", "Photo 1", 4500]],
  );
});

run("photo slideshow projects normalize settings and selected source order", () => {
  assert.deepStrictEqual(slideshowProjectsMod.PHOTO_SLIDESHOW_MUSIC_FREQUENCIES, {
    none: 0,
    calm: 220,
    bright: 440,
    cinematic: 110,
    custom: 0,
  });
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
  const freshIdCollision = slideshowProjectsMod.upsertPhotoSlideshowProject(withSecond, {
    id: "slideshow:fresh-trip-collision",
    name: "Trip show",
    sourcePaths: ["/fresh-collision.jpg"],
    now: "2026-06-24T04:00:00.000Z",
  });
  assert.deepStrictEqual(
    freshIdCollision.map((project) => [project.id, project.name, project.sourcePaths]),
    withSecond.map((project) => [project.id, project.name, project.sourcePaths]),
  );
  assert.strictEqual(freshIdCollision.some((project) => project.id === "slideshow:fresh-trip-collision"), false);
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

run("photo slideshow storage normalizes projects and theme templates", () => {
  assert.strictEqual(slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECTS_KEY, "vintrace.photos.slideshowProjects");
  assert.strictEqual(slideshowProjectsMod.PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY, "vintrace.photos.slideshowThemeTemplates");
  const originalWindow = global.window;
  const values = new Map();
  global.window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };

  try {
    values.set(slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECTS_KEY, "{bad json");
    values.set(slideshowProjectsMod.PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY, "{bad json");
    assert.deepStrictEqual(
      slideshowProjectsMod.readStoredPhotoSlideshowProjects(slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECTS_KEY),
      [],
    );
    assert.deepStrictEqual(
      slideshowProjectsMod.readStoredPhotoSlideshowThemeTemplates(slideshowProjectsMod.PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY),
      [],
    );

    const rawProjects = Array.from({ length: slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT + 1 }, (_, index) => ({
      id: `slideshow:storage-${index}`,
      name: `Storage ${index}`,
      sourcePaths: [`/storage-${index}.jpg`],
      updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    slideshowProjectsMod.storePhotoSlideshowProjects(slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECTS_KEY, [
      ...rawProjects,
      { id: "bad", name: "No sources", sourcePaths: [] },
      { ...rawProjects[0], id: "slideshow:storage-1", name: "Duplicate id should drop" },
    ]);
    assert.strictEqual(
      slideshowProjectsMod.readStoredPhotoSlideshowProjects(slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECTS_KEY).length,
      slideshowProjectsMod.PHOTO_SLIDESHOW_PROJECT_LIMIT + 1,
    );

    const rawTemplates = Array.from({ length: 35 }, (_, index) => ({
      id: `template-storage-${index}`,
      name: `Template ${index}`,
      theme: index % 2 ? "fade" : "classic",
      updatedAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    slideshowProjectsMod.storePhotoSlideshowThemeTemplates(slideshowProjectsMod.PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY, [
      ...rawTemplates,
      { id: "invalid", name: "" },
      { ...rawTemplates[0], id: "template-storage-1", name: "Duplicate id should drop" },
    ]);
    const storedTemplates = slideshowProjectsMod.readStoredPhotoSlideshowThemeTemplates(slideshowProjectsMod.PHOTO_SLIDESHOW_THEME_TEMPLATES_KEY);
    assert.strictEqual(storedTemplates.length, 30);
    assert.strictEqual(storedTemplates[0].id, "template-storage-34");
    assert.strictEqual(storedTemplates.at(-1).id, "template-storage-5");
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
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

run("photo slideshow display helpers normalize labels styles captions and keyframes", () => {
  assert.strictEqual(slideshowDisplayMod.photoSlideshowMotionLabel("slow-zoom"), "Slow zoom");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowMotionLabel("custom"), "Custom path");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTransitionLabel("dissolve"), "Dissolve");
  assert.strictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaptionText("  A   caption  "), "A caption");
  assert.strictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaptionPlacement("bottom-center"), "lower-center");
  assert.strictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaptionTypography("movie"), "cinematic");
  assert.strictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaptionWrap("balanced"), "multi-line");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionId(0), "caption-2");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionIndex("primary"), -1);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionIndex("block-1"), 1);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionIndex("block-99"), -1);
  assert.deepStrictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaption({
    caption: "  Story   card ",
    captionRegion: { left: 9, top: 61, width: 34, height: 18 },
    captionTypography: "serif",
    captionWrap: "2-line",
  }, 0), {
    id: "caption-2",
    captionText: "Story card",
    captionRegion: { x: 9, y: 61, width: 34, height: 18 },
    captionTypography: "editorial",
    captionWrap: "two-line",
  });
  assert.deepStrictEqual(slideshowDisplayMod.cleanPhotoSlideshowCaptions([
    "first",
    { text: "second", placement: "middle" },
    { text: "   " },
  ]), [
    { id: "caption-2", captionText: "first" },
    { id: "caption-3", captionText: "second", captionPlacement: "center" },
  ]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineTransitionPatch({
    sourcePath: "/a.jpg",
    durationMs: 4000,
    motion: "auto",
    transitionEffect: "cut",
    transitionDurationMs: 1250,
  }), {
    transitionEffect: "cut",
    transitionDurationMs: 0,
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineTransitionPatch({
    sourcePath: "/b.jpg",
    durationMs: 4000,
    motion: "auto",
    transitionEffect: "fade",
    transitionDurationMs: 9999,
  }), {
    transitionEffect: "fade",
    transitionDurationMs: 3000,
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTransitionDurationDraft("cut", 2500), 0);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTransitionDurationDraft("fade", 3100.6), 3000);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTransitionDurationDraft("zoom", -10), 0);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineCropPatch({ focalX: -4, focalY: 140, cropZoom: 0.5 }), {
    focalX: 0,
    focalY: 100,
    cropZoom: 1,
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowPrimaryCaptionActive({ captionText: " ", captionPlacement: "auto" }), false);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowPrimaryCaptionActive({ captionText: "", captionPlacement: "hidden" }), true);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowPrimaryCaptionPatch({
    captionText: "  Hero   line ",
    captionPlacement: "bottom-center",
    captionTypography: "serif",
    captionWrap: "nowrap",
    captionRegion: { x: 98, y: 99, width: 50, height: 50 },
  }), {
    captionText: "Hero line",
    captionPlacement: "lower-center",
    captionTypography: "editorial",
    captionWrap: "single-line",
    captionRegion: { x: 98, y: 99, width: 2, height: 1 },
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineCaptionPatch({
    sourcePath: "/c.jpg",
    durationMs: 4500,
    motion: "auto",
    captionText: "Primary",
    captions: ["Block A", { text: "Block B", placement: "top-right" }, " "],
  }), {
    captionText: "Primary",
    captions: [
      { id: "caption-2", captionText: "Block A" },
      { id: "caption-3", captionText: "Block B", captionPlacement: "upper-right" },
    ],
  });
  const reusableKeyframes = {
    startX: 10,
    startY: 20,
    endX: 90,
    endY: 80,
    startZoom: 1,
    endZoom: 1.2,
    curve: "ease",
  };
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineItemWithSections({
    sourcePath: "/old.jpg",
    durationMs: 70000,
    motion: "pan-left",
    keyframes: reusableKeyframes,
    focalX: -4,
    focalY: 140,
    cropZoom: 4,
    transitionEffect: "fade",
    transitionDurationMs: 9999,
    captionText: " Primary ",
    captionPlacement: "middle",
    captionRegion: { x: 98, y: 99, width: 50, height: 50 },
    captions: ["Side note"],
  }, " /new.jpg ", 4500), {
    sourcePath: "/new.jpg",
    durationMs: 60000,
    motion: "pan-left",
    keyframes: reusableKeyframes,
    focalX: 0,
    focalY: 100,
    cropZoom: 3,
    transitionEffect: "fade",
    transitionDurationMs: 3000,
    captionText: "Primary",
    captionPlacement: "center",
    captionRegion: { x: 98, y: 99, width: 2, height: 1 },
    captions: [{ id: "caption-2", captionText: "Side note" }],
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineItemWithSections({
    sourcePath: "/kept.jpg",
    durationMs: 499,
    motion: "still",
    keyframes: reusableKeyframes,
    focalX: 25,
    focalY: 75,
    cropZoom: 2,
    transitionEffect: "zoom",
    transitionDurationMs: 1200,
    captionText: "Drop me",
    captions: ["Drop block"],
  }, "", 4400, {
    keyframes: false,
    crop: false,
    captions: false,
    transition: false,
  }), {
    sourcePath: "/kept.jpg",
    durationMs: 500,
    motion: "still",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTimelineItemWithSections(null, " /fresh.jpg ", 4200), {
    sourcePath: "/fresh.jpg",
    durationMs: 4200,
    motion: "auto",
  });
  assert.strictEqual(slideshowDisplayMod.cleanPhotoSlideshowTimelineDuration(Number.NaN, "bad"), 500);
  const captionLayerItem = {
    sourcePath: "/d.jpg",
    durationMs: 4500,
    motion: "auto",
    captionText: "Primary",
    captions: ["One", { text: "Two", placement: "middle" }],
  };
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionDraftForLayer(captionLayerItem, "primary"), captionLayerItem);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCaptionDraftForLayer(captionLayerItem, "block-1"), {
    id: "caption-3",
    captionText: "Two",
    captionPlacement: "center",
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowCaptionDraftForLayer(captionLayerItem, "block-7"), null);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowDraftCropPatch(12.4, 88.9, 2.4444), {
    focalX: 12,
    focalY: 89,
    cropZoom: 2.444,
  });
  const draftCaptionSource = slideshowDisplayMod.photoSlideshowDraftCaptionSource({
    captionText: "  Draft   title ",
    captionPlacement: "top",
    captionTypography: "movie",
    captionWrap: "two",
    captionRegionX: 97,
    captionRegionY: 96,
    captionRegionWidth: 40,
    captionRegionHeight: 40,
  });
  assert.deepStrictEqual(draftCaptionSource, {
    captionText: "Draft title",
    captionPlacement: "upper-left",
    captionTypography: "cinematic",
    captionWrap: "two-line",
    captionRegion: { x: 97, y: 96, width: 3, height: 4 },
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowDraftCaptionPatch("primary", draftCaptionSource, {
    sourcePath: "/e.jpg",
    durationMs: 4500,
    motion: "auto",
    captions: ["Side note"],
  }), {
    captionText: "Draft title",
    captionPlacement: "upper-left",
    captionTypography: "cinematic",
    captionWrap: "two-line",
    captionRegion: { x: 97, y: 96, width: 3, height: 4 },
    captions: [{ id: "caption-2", captionText: "Side note" }],
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowDraftCaptionPatch("block-1", draftCaptionSource, {
    sourcePath: "/f.jpg",
    durationMs: 4500,
    motion: "auto",
    captionText: "Keep primary",
    captions: [{ id: "custom-a", captionText: "A" }, { id: "custom-b", captionText: "B" }],
  }), {
    captionText: "Keep primary",
    captions: [
      { id: "custom-a", captionText: "A" },
      {
        id: "custom-b",
        captionText: "Draft title",
        captionPlacement: "upper-left",
        captionRegion: { x: 97, y: 96, width: 3, height: 4 },
        captionTypography: "cinematic",
        captionWrap: "two-line",
      },
    ],
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCaptionPresetComposition({
    index: 1,
    sourceCount: 4,
    captionPreset: "auto",
    layout: "split",
    fallbackLabel: "Beach frame",
    projectLabel: "Summer Story",
    sourceLabel: "Trip album",
    regionMap: {
      primary: { x: 9, y: 61, width: 34, height: 18 },
    },
    formatCount: (value) => `#${value}`,
  }), {
    primary: {
      captionText: "Beach frame",
      captionPlacement: "lower-left",
      captionRegion: { x: 9, y: 61, width: 34, height: 18 },
      captionTypography: "editorial",
      captionWrap: "multi-line",
    },
    captions: [
      {
        id: "context",
        captionText: "Trip album",
        captionPlacement: "upper-right",
        captionRegion: { x: 58, y: 13, width: 34, height: 10 },
        captionTypography: "clean",
        captionWrap: "single-line",
      },
      {
        id: "counter",
        captionText: "#2 / #4",
        captionPlacement: "lower-right",
        captionRegion: { x: 72, y: 82, width: 20, height: 7 },
        captionTypography: "bold",
        captionWrap: "single-line",
      },
    ],
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCaptionPresetComposition({
    index: 0,
    sourceCount: 1,
    captionPreset: "cinema-bars",
    layout: "cinema",
    captionText: "Same label",
    projectLabel: "Same label",
    sourceLabel: "Same label",
  }).captions.map((caption) => caption.captionText), ["1 / 1"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowMotionPathPointFromClient(150, 90, {
    left: 100,
    top: 50,
    width: 200,
    height: 100,
  }), { x: 25, y: 40 });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowMotionPathPointFromClient(-50, 200, {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  }), { x: 0, y: 100 });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowMotionPathPointFromClient(12, 34, null), { x: 50, y: 50 });
  const pathPoints = [
    { key: "start", x: 10, y: 20 },
    { key: "mid", x: 50, y: 50 },
    { key: "end", x: 90, y: 80 },
  ];
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowPathPointsWithAnchor(pathPoints, "mid", { x: 120, y: -10 }), [
    { key: "start", x: 10, y: 20 },
    { key: "mid", x: 100, y: 0 },
    { key: "end", x: 90, y: 80 },
  ]);
  const controls = { control1: { x: 20, y: 30 }, control2: { x: 70, y: 80 } };
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowBezierControlsWithHandle(controls, "bezierControl2", { x: 101, y: -2 }), {
    control1: { x: 20, y: 30 },
    control2: { x: 100, y: 0 },
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowBezierControlsWithAxis(controls, "bezierControl1", "y", 66.6), {
    control1: { x: 20, y: 67 },
    control2: { x: 70, y: 80 },
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowMotionPathPointNudge({ x: 98, y: 2 }, 5, -5), {
    x: 100,
    y: 0,
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTimelineDropPlacementFromRect(124, { left: 100, width: 50 }), "before");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTimelineDropPlacementFromRect(126, { left: 100, width: 50 }), "after");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTimelineDragIncludesSourcePath("b", "a", new Set(["a", "b"])), true);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowTimelineDragIncludesSourcePath("b", "c", new Set(["a", "b"])), false);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowPlacementTargets(
    new Set(["c", "a"]),
    ["b", "c", "a"],
    [{ sourcePath: "a" }, { sourcePath: "c" }],
  ), ["c", "a"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowPlacementTargets(
    new Set(["x", "y"]),
    [],
    [{ sourcePath: "y" }, { sourcePath: "x" }],
  ), ["y", "x"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowPlacementTargets(
    new Set(["  stray  ", "", "other"]),
    [],
    [],
  ), ["stray", "other"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowDraftKeyframes({
    startX: 10,
    startY: 20,
    quarterX: 30,
    quarterY: 40,
    midX: 50,
    midY: 60,
    threeQuarterX: 70,
    threeQuarterY: 80,
    endX: 90,
    endY: 95,
    startZoom: 1,
    quarterZoom: 1.1,
    midZoom: 1.2,
    threeQuarterZoom: 1.3,
    endZoom: 1.4,
    curve: "smooth",
    pathEditorMode: "anchors",
  }), {
    startX: 10,
    startY: 20,
    endX: 90,
    endY: 95,
    startZoom: 1,
    endZoom: 1.4,
    quarterX: 30,
    quarterY: 40,
    quarterZoom: 1.1,
    midX: 50,
    midY: 60,
    midZoom: 1.2,
    threeQuarterX: 70,
    threeQuarterY: 80,
    threeQuarterZoom: 1.3,
    curve: "smooth",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowKeyframeDraftState({
    startX: 20,
    startY: 30,
    endX: 80,
    endY: 90,
    startZoom: 1,
    endZoom: 1.4,
    curve: "ease",
  }, "smooth"), {
    startX: 20,
    startY: 30,
    quarterX: 35,
    quarterY: 45,
    midX: 50,
    midY: 60,
    threeQuarterX: 65,
    threeQuarterY: 75,
    endX: 80,
    endY: 90,
    startZoom: 1,
    quarterZoom: 1.1,
    midZoom: 1.2,
    threeQuarterZoom: 1.3,
    endZoom: 1.4,
    curve: "ease",
    bezierControl1X: 40,
    bezierControl1Y: 50,
    bezierControl2X: 60,
    bezierControl2Y: 70,
    pathEditorMode: "",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowKeyframeDraftState(null, "cinematic"), {
    startX: 50,
    startY: 50,
    quarterX: 50,
    quarterY: 50,
    midX: 50,
    midY: 50,
    threeQuarterX: 50,
    threeQuarterY: 50,
    endX: 50,
    endY: 50,
    startZoom: 1,
    quarterZoom: 1.04,
    midZoom: 1.08,
    threeQuarterZoom: 1.08,
    endZoom: 1.08,
    curve: "cinematic",
    bezierControl1X: 50,
    bezierControl1Y: 50,
    bezierControl2X: 50,
    bezierControl2Y: 50,
    pathEditorMode: "",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowKeyframeDraftState({
    pathMode: "bezier",
    startX: 10,
    startY: 20,
    quarterX: 30,
    quarterY: 40,
    midX: 50,
    midY: 60,
    threeQuarterX: 70,
    threeQuarterY: 80,
    endX: 90,
    endY: 95,
    startZoom: 1,
    quarterZoom: 1.1,
    midZoom: 1.2,
    threeQuarterZoom: 1.3,
    endZoom: 1.4,
    curve: "smooth",
    bezierControl1X: 22,
    bezierControl1Y: 33,
    bezierControl2X: 66,
    bezierControl2Y: 77,
  }, "ease"), {
    startX: 10,
    startY: 20,
    quarterX: 24,
    quarterY: 35,
    midX: 46,
    midY: 56,
    threeQuarterX: 69,
    threeQuarterY: 78,
    endX: 90,
    endY: 95,
    startZoom: 1,
    quarterZoom: 1.1,
    midZoom: 1.2,
    threeQuarterZoom: 1.3,
    endZoom: 1.4,
    curve: "smooth",
    bezierControl1X: 22,
    bezierControl1Y: 33,
    bezierControl2X: 66,
    bezierControl2Y: 77,
    pathEditorMode: "bezier",
  });
  const projectDraft = slideshowDisplayMod.photoSlideshowProjectEditorDraft({
    id: "project-1",
    name: "Trip reel",
    title: "Trip",
    sourceLabel: "Summer album",
    sourcePaths: ["/a.jpg", "/b.jpg"],
    theme: "ken-burns",
    themeTimelinePreset: "auto",
    themeTemplateName: "  Travel ",
    themeTemplatePalette: "paper",
    themeTemplateTypography: "editorial",
    themeTemplateBackdrop: "glass",
    themeTemplateLayout: "split",
    themeTemplateBackdropIntensity: 130,
    themeTemplateStageWidth: 20,
    themeTemplateFrameStyle: "matte",
    themeTemplateChromeDensity: "spacious",
    themeTemplateCaptionPreset: "title-subtitle",
    themeTemplateRegionMap: {},
    music: "custom",
    musicPath: "/music/theme.mp3",
    audioVolume: 1.25,
    audioFadeMs: 20000,
    audioStartMs: -20,
    audioEndMs: 4_000_000,
    audioPlacementStartSourcePath: "/a.jpg",
    audioPlacementEndSourcePath: "/b.jpg",
    includeTitleCard: true,
    titleCardTitle: "",
    titleCardSubtitle: "",
    titleCardDurationMs: 20000,
    titleCardPalette: "forest",
    titleCardLayout: "left",
    titleCardFontScale: "large",
    titleCardShowFooter: false,
    timelineItems: [
      { sourcePath: "/a.jpg", durationMs: 0, motion: "pan-left" },
      { sourcePath: "/b.jpg", durationMs: 4500, motion: "auto", focalX: -4, focalY: 140, cropZoom: 4 },
      { sourcePath: "/c.jpg", durationMs: 5000, motion: "auto", captions: ["Block caption"] },
      { sourcePath: "/d.jpg", durationMs: 5000, motion: "auto", transitionEffect: "cut", transitionDurationMs: 2000 },
      {
        sourcePath: "/e.jpg",
        durationMs: 5000,
        motion: "auto",
        keyframes: {
          pathMode: "bezier",
          startX: 10,
          startY: 20,
          endX: 90,
          endY: 95,
          startZoom: 1,
          endZoom: 1.4,
          curve: "smooth",
          bezierControl1X: 22,
          bezierControl1Y: 33,
          bezierControl2X: 66,
          bezierControl2Y: 77,
        },
      },
    ],
    transitionEffect: "fade",
    transitionDurationMs: 5000,
    intervalMs: 6200,
    fitMode: "fill",
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-02T00:00:00Z",
  });
  assert.deepStrictEqual({
    id: projectDraft.id,
    name: projectDraft.name,
    title: projectDraft.title,
    music: projectDraft.music,
    musicPath: projectDraft.musicPath,
    audioVolumePercent: projectDraft.audioVolumePercent,
    audioFadeMs: projectDraft.audioFadeMs,
    audioStartMs: projectDraft.audioStartMs,
    audioEndMs: projectDraft.audioEndMs,
    includeTitleCard: projectDraft.includeTitleCard,
    titleCardTitle: projectDraft.titleCardTitle,
    titleCardSubtitle: projectDraft.titleCardSubtitle,
    titleCardDurationMs: projectDraft.titleCardDurationMs,
    titleCardShowFooter: projectDraft.titleCardShowFooter,
    slideDurationMs: projectDraft.slideDurationMs,
    slideMotion: projectDraft.slideMotion,
    focalX: projectDraft.focalX,
    focalY: projectDraft.focalY,
    cropZoom: projectDraft.cropZoom,
    captionLayer: projectDraft.captionLayer,
    captionDraft: projectDraft.captionDraft,
    slideTransitionEffect: projectDraft.slideTransitionEffect,
    slideTransitionDurationMs: projectDraft.slideTransitionDurationMs,
    transitionEffect: projectDraft.transitionEffect,
    transitionDurationMs: projectDraft.transitionDurationMs,
    intervalMs: projectDraft.intervalMs,
    fitMode: projectDraft.fitMode,
    keyframePathEditorMode: projectDraft.keyframeDraft.pathEditorMode,
    keyframeBezierControl1X: projectDraft.keyframeDraft.bezierControl1X,
  }, {
    id: "project-1",
    name: "Trip reel",
    title: "Trip",
    music: "custom",
    musicPath: "/music/theme.mp3",
    audioVolumePercent: 100,
    audioFadeMs: 10000,
    audioStartMs: 0,
    audioEndMs: 3600000,
    includeTitleCard: true,
    titleCardTitle: "Trip",
    titleCardSubtitle: "Summer album",
    titleCardDurationMs: 15000,
    titleCardShowFooter: false,
    slideDurationMs: 6200,
    slideMotion: "pan-left",
    focalX: 0,
    focalY: 100,
    cropZoom: 3,
    captionLayer: "block-0",
    captionDraft: { id: "caption-2", captionText: "Block caption" },
    slideTransitionEffect: "cut",
    slideTransitionDurationMs: 0,
    transitionEffect: "fade",
    transitionDurationMs: 3000,
    intervalMs: 6200,
    fitMode: "fill",
    keyframePathEditorMode: "bezier",
    keyframeBezierControl1X: 22,
  });
  assert.strictEqual(projectDraft.themeSettings.themeTemplateName, "Travel");
  assert.strictEqual(projectDraft.themeSettings.themeTemplateBackdropIntensity, 100);
  assert.strictEqual(projectDraft.themeSettings.themeTemplateStageWidth, 50);
  const emptyProjectDraft = slideshowDisplayMod.emptyPhotoSlideshowProjectEditorDraft();
  assert.deepStrictEqual({
    id: emptyProjectDraft.id,
    name: emptyProjectDraft.name,
    title: emptyProjectDraft.title,
    music: emptyProjectDraft.music,
    musicPath: emptyProjectDraft.musicPath,
    audioVolumePercent: emptyProjectDraft.audioVolumePercent,
    includeTitleCard: emptyProjectDraft.includeTitleCard,
    titleCardDurationMs: emptyProjectDraft.titleCardDurationMs,
    titleCardShowFooter: emptyProjectDraft.titleCardShowFooter,
    sourcePaths: emptyProjectDraft.sourcePaths,
    timelineItems: emptyProjectDraft.timelineItems,
    slideDurationMs: emptyProjectDraft.slideDurationMs,
    slideMotion: emptyProjectDraft.slideMotion,
    captionLayer: emptyProjectDraft.captionLayer,
    slideTransitionEffect: emptyProjectDraft.slideTransitionEffect,
    slideTransitionDurationMs: emptyProjectDraft.slideTransitionDurationMs,
    transitionEffect: emptyProjectDraft.transitionEffect,
    transitionDurationMs: emptyProjectDraft.transitionDurationMs,
    intervalMs: emptyProjectDraft.intervalMs,
    fitMode: emptyProjectDraft.fitMode,
    keyframeCurve: emptyProjectDraft.keyframeDraft.curve,
  }, {
    id: "",
    name: "",
    title: "",
    music: "none",
    musicPath: "",
    audioVolumePercent: 100,
    includeTitleCard: false,
    titleCardDurationMs: 3000,
    titleCardShowFooter: true,
    sourcePaths: [],
    timelineItems: [],
    slideDurationMs: 4500,
    slideMotion: "auto",
    captionLayer: "primary",
    slideTransitionEffect: "auto",
    slideTransitionDurationMs: 650,
    transitionEffect: "auto",
    transitionDurationMs: 650,
    intervalMs: 4500,
    fitMode: "fit",
    keyframeCurve: "smooth",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowProjectSaveSourcePaths({
    selectedSources: new Set(["/c.jpg", "/a.jpg"]),
    editorSourcePaths: [" /c.jpg ", "/a.jpg"],
    queueSourceItems: [{ sourcePath: "/a.jpg" }, { sourcePath: "/c.jpg" }],
  }), ["/c.jpg", "/a.jpg"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowProjectSaveSourcePaths({
    selectedSources: new Set(["/c.jpg", "/a.jpg"]),
    editorSourcePaths: ["/c.jpg"],
    queueSourceItems: [{ sourcePath: "/a.jpg" }, { sourcePath: "/c.jpg", missingAt: "missing" }, { sourcePath: "/z.jpg" }],
  }), ["/a.jpg"]);
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowProjectSaveSourcePaths({
    selectedProject: { sourcePaths: [" /old.jpg ", "/old.jpg", ""] },
    editorSourcePaths: [],
    queueSourceItems: [{ sourcePath: "/queue.jpg" }],
  }), ["/old.jpg"]);
  const saveDraft = slideshowDisplayMod.photoSlideshowProjectSaveDraft({
    selectedProject: { id: "project-1", sourcePaths: ["/old.jpg"], sourceLabel: "Old label" },
    selectedSources: new Set(["/b.jpg", "/a.jpg"]),
    editorSourcePaths: ["/a.jpg"],
    queueSourceItems: [{ sourcePath: "/a.jpg" }, { sourcePath: "/b.jpg", missingAt: "missing" }],
    projectName: "   ",
    projectTitle: "  Story  ",
    activeName: "Active album",
    labels: { slideshow: "Slideshow", selection: "Selection", currentView: "Current view" },
    themeSettings: { theme: "ken-burns", themeTemplateStageWidth: 130 },
    music: "calm",
    musicPath: "/ignored.mp3",
    audioVolumePercent: 160,
    audioFadeMs: 20000,
    audioStartMs: -20,
    audioEndMs: 4_000_000,
    audioPlacementStartSourcePath: "/a.jpg",
    audioPlacementEndSourcePath: "/b.jpg",
    includeTitleCard: true,
    titleCardTitle: "",
    titleCardSubtitle: "",
    titleCardDurationMs: 20000,
    titleCardPalette: "forest",
    titleCardLayout: "left",
    titleCardFontScale: "large",
    titleCardShowFooter: false,
    timelineItems: [{ sourcePath: "/a.jpg", durationMs: 1234, motion: "still" }],
    transitionEffect: "cut",
    transitionDurationMs: 2500,
    intervalMs: 6200,
    fitMode: "fill",
  });
  assert.ok(saveDraft, "save draft should be produced when playable sources exist");
  assert.deepStrictEqual({
    id: saveDraft.id,
    name: saveDraft.name,
    title: saveDraft.title,
    sourceLabel: saveDraft.sourceLabel,
    sourcePaths: saveDraft.sourcePaths,
    theme: saveDraft.theme,
    themeTemplateStageWidth: saveDraft.themeTemplateStageWidth,
    music: saveDraft.music,
    musicPath: saveDraft.musicPath,
    audioVolume: saveDraft.audioVolume,
    audioFadeMs: saveDraft.audioFadeMs,
    audioStartMs: saveDraft.audioStartMs,
    audioEndMs: saveDraft.audioEndMs,
    audioPlacementStartSourcePath: saveDraft.audioPlacementStartSourcePath,
    audioPlacementEndSourcePath: saveDraft.audioPlacementEndSourcePath,
    titleCardTitle: saveDraft.titleCardTitle,
    titleCardSubtitle: saveDraft.titleCardSubtitle,
    titleCardDurationMs: saveDraft.titleCardDurationMs,
    transitionEffect: saveDraft.transitionEffect,
    transitionDurationMs: saveDraft.transitionDurationMs,
    intervalMs: saveDraft.intervalMs,
    fitMode: saveDraft.fitMode,
    timelineItems: saveDraft.timelineItems,
  }, {
    id: "project-1",
    name: "Story",
    title: "Story",
    sourceLabel: "Selection",
    sourcePaths: ["/a.jpg"],
    theme: "ken-burns",
    themeTemplateStageWidth: 100,
    music: "calm",
    musicPath: "",
    audioVolume: 1,
    audioFadeMs: 10000,
    audioStartMs: 0,
    audioEndMs: 3600000,
    audioPlacementStartSourcePath: "/a.jpg",
    audioPlacementEndSourcePath: "",
    titleCardTitle: "Story",
    titleCardSubtitle: "Selection",
    titleCardDurationMs: 15000,
    transitionEffect: "cut",
    transitionDurationMs: 0,
    intervalMs: 6200,
    fitMode: "fill",
    timelineItems: [{ sourcePath: "/a.jpg", durationMs: 1234, motion: "still" }],
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowProjectSaveDraft({
    selectedSources: new Set(["/missing.jpg"]),
    editorSourcePaths: [],
    queueSourceItems: [{ sourcePath: "/other.jpg" }],
    projectName: "",
    projectTitle: "",
    themeSettings: {},
    music: "none",
    includeTitleCard: false,
    titleCardPalette: "auto",
    titleCardLayout: "center",
    titleCardFontScale: "regular",
    titleCardShowFooter: true,
    transitionEffect: "auto",
    intervalMs: 4500,
    fitMode: "fit",
  }), null);
  const memoryPayload = slideshowDisplayMod.photoSlideshowMemoryMovieSettingsPayload({
    themeSettings: {
      theme: "ken-burns",
      themeTemplateStageWidth: 130,
      themeTemplateRegionMap: { body: [0.1, 0.6, 0.3, 0.2] },
    },
    music: "custom",
    musicPath: " /music/reel.m4a ",
    audioVolumePercent: -5,
    audioFadeMs: 20000,
    audioStartMs: -20,
    audioEndMs: 4_000_000,
    audioPlacementStartSourcePath: " /a.jpg ",
    audioPlacementEndSourcePath: " /b.jpg ",
    includeTitleCard: true,
    titleCardTitle: "  Memory   title ",
    titleCardSubtitle: "  Trip ",
    titleCardDurationMs: 500,
    titleCardPalette: "forest",
    titleCardLayout: "left",
    titleCardFontScale: "large",
    titleCardShowFooter: false,
    transitionEffect: "cut",
    transitionDurationMs: 1200,
    intervalMs: 1000,
    fitMode: "fill",
  });
  assert.deepStrictEqual({
    theme: memoryPayload.theme,
    themeTemplateStageWidth: memoryPayload.themeTemplateStageWidth,
    themeTemplateRegionMap: memoryPayload.themeTemplateRegionMap,
    music: memoryPayload.music,
    musicPath: memoryPayload.musicPath,
    audioVolume: memoryPayload.audioVolume,
    audioFadeMs: memoryPayload.audioFadeMs,
    audioStartMs: memoryPayload.audioStartMs,
    audioEndMs: memoryPayload.audioEndMs,
    audioPlacementStartSourcePath: memoryPayload.audioPlacementStartSourcePath,
    audioPlacementEndSourcePath: memoryPayload.audioPlacementEndSourcePath,
    titleCardTitle: memoryPayload.titleCardTitle,
    titleCardSubtitle: memoryPayload.titleCardSubtitle,
    titleCardDurationMs: memoryPayload.titleCardDurationMs,
    titleCardShowFooter: memoryPayload.titleCardShowFooter,
    transitionEffect: memoryPayload.transitionEffect,
    transitionDurationMs: memoryPayload.transitionDurationMs,
    intervalMs: memoryPayload.intervalMs,
    fitMode: memoryPayload.fitMode,
  }, {
    theme: "ken-burns",
    themeTemplateStageWidth: 100,
    themeTemplateRegionMap: { primary: { x: 10, y: 60, width: 30, height: 20 } },
    music: "custom",
    musicPath: "/music/reel.m4a",
    audioVolume: 0,
    audioFadeMs: 10000,
    audioStartMs: 0,
    audioEndMs: 3600000,
    audioPlacementStartSourcePath: "/a.jpg",
    audioPlacementEndSourcePath: "/b.jpg",
    titleCardTitle: "Memory   title",
    titleCardSubtitle: "Trip",
    titleCardDurationMs: 1500,
    titleCardShowFooter: false,
    transitionEffect: "cut",
    transitionDurationMs: 0,
    intervalMs: 1500,
    fitMode: "fill",
  });
  const memoryDraft = slideshowDisplayMod.photoSlideshowMemoryMovieEditorDraft({
    themeTemplateStageWidth: 20,
    music: "custom",
    audioPath: " /legacy/audio.mp3 ",
    audioVolume: 0,
    audioFadeMs: 20000,
    audioStartMs: -30,
    audioEndMs: 4_000_000,
    audioPlacementStartSourcePath: " /first.jpg ",
    audioPlacementEndSourcePath: " /last.jpg ",
    titleCardTitle: "  Saved   title ",
    titleCardSubtitle: " Saved subtitle ",
    titleCardDurationMs: 20000,
    titleCardPalette: "unknown",
    titleCardLayout: "side",
    titleCardFontScale: "huge",
    titleCardShowFooter: false,
    transitionEffect: "cut",
    transitionDurationMs: 1200,
    intervalMs: 20000,
    fitMode: "cover",
  }, 6200);
  assert.deepStrictEqual({
    theme: memoryDraft.themeSettings.theme,
    themeTemplateStageWidth: memoryDraft.themeSettings.themeTemplateStageWidth,
    music: memoryDraft.music,
    musicPath: memoryDraft.musicPath,
    audioVolumePercent: memoryDraft.audioVolumePercent,
    audioFadeMs: memoryDraft.audioFadeMs,
    audioStartMs: memoryDraft.audioStartMs,
    audioEndMs: memoryDraft.audioEndMs,
    audioPlacementStartSourcePath: memoryDraft.audioPlacementStartSourcePath,
    audioPlacementEndSourcePath: memoryDraft.audioPlacementEndSourcePath,
    includeTitleCard: memoryDraft.includeTitleCard,
    titleCardTitle: memoryDraft.titleCardTitle,
    titleCardSubtitle: memoryDraft.titleCardSubtitle,
    titleCardDurationMs: memoryDraft.titleCardDurationMs,
    titleCardPalette: memoryDraft.titleCardPalette,
    titleCardLayout: memoryDraft.titleCardLayout,
    titleCardFontScale: memoryDraft.titleCardFontScale,
    titleCardShowFooter: memoryDraft.titleCardShowFooter,
    transitionEffect: memoryDraft.transitionEffect,
    transitionDurationMs: memoryDraft.transitionDurationMs,
    intervalMs: memoryDraft.intervalMs,
    fitMode: memoryDraft.fitMode,
  }, {
    theme: "ken-burns",
    themeTemplateStageWidth: 50,
    music: "custom",
    musicPath: "/legacy/audio.mp3",
    audioVolumePercent: 0,
    audioFadeMs: 10000,
    audioStartMs: 0,
    audioEndMs: 3600000,
    audioPlacementStartSourcePath: "/first.jpg",
    audioPlacementEndSourcePath: "/last.jpg",
    includeTitleCard: true,
    titleCardTitle: "Saved   title",
    titleCardSubtitle: "Saved subtitle",
    titleCardDurationMs: 15000,
    titleCardPalette: "auto",
    titleCardLayout: "center",
    titleCardFontScale: "regular",
    titleCardShowFooter: false,
    transitionEffect: "cut",
    transitionDurationMs: 0,
    intervalMs: 15000,
    fitMode: "fill",
  });
  assert.strictEqual(slideshowDisplayMod.photoSlideshowMemoryMovieEditorDraft(null), null);
  const memoryExportSettings = slideshowDisplayMod.photoSlideshowMemoryMovieExportSettings({
    settings: {
      theme: "fade",
      themeTemplateStageWidth: 20,
      themeTemplateRegionMap: { body: [0.2, 0.3, 0.4, 0.5] },
      music: "custom",
      audioPath: " /saved/audio.mp3 ",
      audioVolume: 2,
      audioFadeMs: 20000,
      audioStartMs: -100,
      audioEndMs: 4_000_000,
      audioPlacementStartSourcePath: " /saved-start.jpg ",
      includeTitleCard: false,
      titleCardTitle: "",
      titleCardSubtitle: "",
      titleCardDurationMs: 500,
      titleCardPalette: "paper",
      titleCardLayout: "lower-third",
      titleCardFontScale: "compact",
      titleCardShowFooter: false,
      transitionEffect: "fade",
      transitionDurationMs: 9999,
      intervalMs: 1000,
      fitMode: "cover",
    },
    memoryTitle: " Memory title ",
    memorySourceLabel: " Source label ",
    themeSettings: { theme: "ken-burns", themeTemplatePalette: "forest", themeTemplateStageWidth: 88 },
    music: "calm",
    musicPath: " /current/audio.mp3 ",
    audioVolumePercent: 72,
    audioFadeMs: 120,
    audioStartMs: 100,
    audioEndMs: 500,
    audioPlacementStartSourcePath: "/current-start.jpg",
    audioPlacementEndSourcePath: "/current-end.jpg",
    includeTitleCard: true,
    titleCardTitle: " Current title ",
    titleCardSubtitle: "",
    titleCardDurationMs: 4200,
    titleCardPalette: "forest",
    titleCardLayout: "left",
    titleCardFontScale: "large",
    titleCardShowFooter: true,
    timelineItems: [
      { sourcePath: "/a.jpg", durationMs: 123, motion: "still" },
      { sourcePath: "/b.jpg", durationMs: 99999, motion: "pan-right" },
      { sourcePath: "/drop.jpg", durationMs: 4000, motion: "auto" },
    ],
    sourcePaths: ["/a.jpg", "/b.jpg"],
    transitionEffect: "zoom",
    transitionDurationMs: 900,
    intervalMs: 6200,
    fitMode: "fill",
  });
  assert.deepStrictEqual({
    theme: memoryExportSettings.theme,
    themeTemplateStageWidth: memoryExportSettings.themeTemplateStageWidth,
    themeTemplateRegionMap: memoryExportSettings.themeTemplateRegionMap,
    music: memoryExportSettings.music,
    audioPath: memoryExportSettings.audioPath,
    audioVolume: memoryExportSettings.audioVolume,
    audioFadeMs: memoryExportSettings.audioFadeMs,
    audioStartMs: memoryExportSettings.audioStartMs,
    audioEndMs: memoryExportSettings.audioEndMs,
    audioPlacementStartSourcePath: memoryExportSettings.audioPlacementStartSourcePath,
    audioPlacementEndSourcePath: memoryExportSettings.audioPlacementEndSourcePath,
    includeTitleCard: memoryExportSettings.includeTitleCard,
    titleCardTitle: memoryExportSettings.titleCardTitle,
    titleCardSubtitle: memoryExportSettings.titleCardSubtitle,
    titleCardDurationMs: memoryExportSettings.titleCardDurationMs,
    titleCardPalette: memoryExportSettings.titleCardPalette,
    titleCardLayout: memoryExportSettings.titleCardLayout,
    titleCardFontScale: memoryExportSettings.titleCardFontScale,
    titleCardShowFooter: memoryExportSettings.titleCardShowFooter,
    transitionEffect: memoryExportSettings.transitionEffect,
    transitionDurationMs: memoryExportSettings.transitionDurationMs,
    intervalMs: memoryExportSettings.intervalMs,
    fitMode: memoryExportSettings.fitMode,
    timelineSources: memoryExportSettings.timelineItems.map((item) => item.sourcePath),
    timelineDurations: memoryExportSettings.timelineItems.map((item) => item.durationMs),
  }, {
    theme: "fade",
    themeTemplateStageWidth: 50,
    themeTemplateRegionMap: { primary: { x: 20, y: 30, width: 40, height: 50 } },
    music: "custom",
    audioPath: "/saved/audio.mp3",
    audioVolume: 1,
    audioFadeMs: 10000,
    audioStartMs: 0,
    audioEndMs: 3600000,
    audioPlacementStartSourcePath: "/saved-start.jpg",
    audioPlacementEndSourcePath: "/current-end.jpg",
    includeTitleCard: false,
    titleCardTitle: "Current title",
    titleCardSubtitle: "Source label",
    titleCardDurationMs: 1500,
    titleCardPalette: "paper",
    titleCardLayout: "lower-third",
    titleCardFontScale: "compact",
    titleCardShowFooter: false,
    transitionEffect: "fade",
    transitionDurationMs: 3000,
    intervalMs: 1500,
    fitMode: "fill",
    timelineSources: ["/a.jpg", "/b.jpg"],
    timelineDurations: [500, 60000],
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCaptionRegionDraft(92, 94, 50, 50), {
    x: 92,
    y: 94,
    width: 8,
    height: 6,
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTemplateRegionForSlot("auto", "split", {
    body: [0.09, 0.61, 0.34, 0.18],
  }, "primary"), {
    x: 9,
    y: 61,
    width: 34,
    height: 18,
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTemplateRegionForSlot("lower-third", "standard", {}, "primary"), {
    x: 6,
    y: 72,
    width: 54,
    height: 14,
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowTemplateRegionMapWithSlotPatch({
    primary: { x: 90, y: 90, width: 20, height: 20 },
  }, "primary", {
    x: 98,
    width: 50,
  }), {
    primary: { x: 98, y: 90, width: 2, height: 10 },
  });
  assert.deepStrictEqual(slideshowDisplayMod.resizePhotoSlideshowCaptionRegionDraft({
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  }, "resize-northwest", -20, -30), {
    x: 0,
    y: 0,
    width: 40,
    height: 60,
  });
  assert.deepStrictEqual(slideshowDisplayMod.resizePhotoSlideshowCaptionRegionDraft({
    x: 70,
    y: 80,
    width: 20,
    height: 15,
  }, "resize-southeast", 80, 80), {
    x: 70,
    y: 80,
    width: 30,
    height: 20,
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCropStyle({ focalX: 120, focalY: -4, cropZoom: 2.3456 }), {
    objectPosition: "100% 0%",
    transformOrigin: "100% 0%",
    transform: "scale(2.346)",
  });
  assert.deepStrictEqual(slideshowDisplayMod.photoSlideshowCaptionRegionStyle({
    captionRegion: { x: 92, y: 94, width: 50, height: 50 },
  }), {
    left: "92%",
    top: "94%",
    width: "8%",
    maxWidth: "none",
    minHeight: "6%",
    right: "auto",
    bottom: "auto",
    transform: "none",
  });
  const themeStyle = slideshowDisplayMod.photoSlideshowThemeTemplateStyle("forest", "cinematic", "spotlight", "accent", "spacious", 42, 75);
  assert.strictEqual(themeStyle["--photo-slideshow-template-bg"], "#101f1a");
  assert.strictEqual(themeStyle["--photo-slideshow-template-caption-style"], "normal");
  assert.strictEqual(themeStyle["--photo-slideshow-template-overlay-opacity"], "0.42");
  assert.strictEqual(themeStyle["--photo-slideshow-template-stage-standard-width"], "69vw");
  assert.strictEqual(slideshowDisplayMod.photoSlideshowThemeSettingsEqual({
    theme: "ken-burns",
    themeTemplateName: "Trip",
    themeTemplateRegionMap: { primary: [0.09, 0.61, 0.34, 0.18] },
  }, {
    theme: "ken-burns",
    themeTemplateName: "Trip",
    themeTemplateRegionMap: { body: { x: 9, y: 61, width: 34, height: 18 } },
  }), true);
  assert.strictEqual(slideshowDisplayMod.photoSlideshowPathPolyline([{ x: 1, y: 2 }, { x: 3, y: 4 }]), "1,2 3,4");
  const keyframes = {
    pathMode: "bezier",
    startX: 20,
    startY: 30,
    midX: 50,
    midY: 55,
    endX: 80,
    endY: 70,
    startZoom: 1,
    midZoom: 1.1,
    endZoom: 1.2,
    bezierControl1X: 25,
    bezierControl1Y: 35,
    bezierControl2X: 75,
    bezierControl2Y: 65,
    curve: "smooth",
  };
  assert.match(slideshowDisplayMod.photoSlideshowKeyframeLabel(keyframes), /Bezier handles 25,35 \/ 75,65/);
  assert.strictEqual(
    slideshowDisplayMod.photoSlideshowKeyframeTransformVars(keyframes)["--photo-slideshow-keyframe-timing"],
    "cubic-bezier(0.45, 0, 0.25, 1)",
  );
});

run("Photos slideshow theme settings use shared template helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const displaySource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowDisplay.ts"), "utf8");
  assert.match(source, /from "\.\/photoSlideshowDisplay"/);
  assert.match(displaySource, /export type PhotoSlideshowThemeSettings = Pick</);
  assert.match(displaySource, /export function cleanPhotoSlideshowThemeSettings\(/);
  assert.match(displaySource, /export function photoSlideshowThemeSettingsEqual\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineTransitionPatch\(/);
  assert.match(displaySource, /export function photoSlideshowTransitionDurationDraft\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineCropPatch\(/);
  assert.match(displaySource, /export function photoSlideshowPrimaryCaptionPatch\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineCaptionPatch\(/);
  assert.match(displaySource, /export function cleanPhotoSlideshowTimelineDuration\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineItemWithSections\(/);
  assert.match(displaySource, /export function photoSlideshowCaptionDraftForLayer\(/);
  assert.match(displaySource, /export function photoSlideshowDraftCropPatch\(/);
  assert.match(displaySource, /export function photoSlideshowDraftCaptionSource\(/);
  assert.match(displaySource, /export function photoSlideshowDraftCaptionPatch\(/);
  assert.match(displaySource, /export function photoSlideshowTemplateRegionForSlot\(/);
  assert.match(displaySource, /export function photoSlideshowTemplateRegionMapWithSlotPatch\(/);
  assert.match(displaySource, /export function resizePhotoSlideshowCaptionRegionDraft\(/);
  assert.match(displaySource, /export function photoSlideshowCaptionPresetComposition\(/);
  assert.match(displaySource, /export function photoSlideshowMotionPathPointFromClient\(/);
  assert.match(displaySource, /export function photoSlideshowPathPointsWithAnchor\(/);
  assert.match(displaySource, /export function photoSlideshowBezierControlsWithHandle\(/);
  assert.match(displaySource, /export function photoSlideshowBezierControlsWithAxis\(/);
  assert.match(displaySource, /export function photoSlideshowMotionPathPointNudge\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineDropPlacementFromRect\(/);
  assert.match(displaySource, /export function photoSlideshowTimelineDragIncludesSourcePath\(/);
  assert.match(displaySource, /export function photoSlideshowPlacementTargets\(/);
  assert.match(displaySource, /export function photoSlideshowDraftKeyframes\(/);
  assert.match(displaySource, /export function photoSlideshowKeyframeDraftState\(/);
  assert.match(displaySource, /export function photoSlideshowProjectEditorDraft\(/);
  assert.match(displaySource, /export function emptyPhotoSlideshowProjectEditorDraft\(/);
  assert.match(displaySource, /export function photoSlideshowProjectSaveSourcePaths\(/);
  assert.match(displaySource, /export function photoSlideshowProjectSaveDraft\(/);
  assert.match(displaySource, /export function photoSlideshowMemoryMovieSettingsPayload\(/);
  assert.match(displaySource, /export function photoSlideshowMemoryMovieEditorDraft\(/);
  assert.match(displaySource, /export function photoSlideshowMemoryMovieExportSettings\(/);
  assert.doesNotMatch(source, /function cleanPhotoSlideshowThemeSettings\(/);
  assert.doesNotMatch(source, /function photoSlideshowThemeSettingsEqual\(/);
  assert.doesNotMatch(source, /function photoSlideshowTimelineTransitionPatch\(/);
  assert.doesNotMatch(source, /photoSlideshowTimelineTransitionPatch/);
  assert.doesNotMatch(source, /function currentPhotoSlideshowDraftTransitionDuration\(/);
  assert.doesNotMatch(source, /function photoSlideshowTimelineCropPatch\(/);
  assert.doesNotMatch(source, /photoSlideshowTimelineCropPatch/);
  assert.doesNotMatch(source, /function photoSlideshowPrimaryCaptionPatch\(/);
  assert.doesNotMatch(source, /function photoSlideshowTimelineCaptionPatch\(/);
  assert.doesNotMatch(source, /photoSlideshowTimelineCaptionPatch/);
  assert.doesNotMatch(source, /function photoSlideshowCaptionDraftForLayer\(/);
  assert.doesNotMatch(source, /function currentPhotoSlideshowDraftCropPatch\(/);
  assert.doesNotMatch(source, /function currentPhotoSlideshowDraftCaptionSource\(/);
  assert.doesNotMatch(source, /function currentPhotoSlideshowDraftCaptionPatch\(/);
  assert.doesNotMatch(source, /function photoSlideshowTemplateRegionForSlot\(/);
  assert.doesNotMatch(source, /function resizePhotoSlideshowCaptionRegionDraft\(/);
  assert.doesNotMatch(source, /function photoSlideshowCaptionPresetComposition\(/);
  assert.doesNotMatch(source, /function photoSlideshowTimelineDropPlacement\(/);
  assert.doesNotMatch(source, /function photoSlideshowTimelineDragIncludesSource\(/);
  assert.doesNotMatch(source, /function selectedPhotoSlideshowPlacementTargets\(/);
  assert.doesNotMatch(source, /Math\.round\(\(\(clientX - rect\.left\) \/ width\) \* 100\)/);
  assert.doesNotMatch(source, /pathPoint\.key === key \? \{ \.\.\.pathPoint, x: point\.x, y: point\.y \}/);
  assert.doesNotMatch(source, /return cleanPhotoSlideshowMotionKeyframes\(\{/);
  assert.doesNotMatch(source, /const points = photoSlideshowMotionPathPointsFromKeyframes\(keyframes\);/);
  assert.match(source, /applyPhotoSlideshowProjectEditorDraftState\(photoSlideshowProjectEditorDraft\(project\)\);/);
  assert.match(source, /const keyframeDraft = projectDraft\.keyframeDraft;/);
  assert.match(source, /setPhotoSlideshowProjectBezierControl1X\(keyframeDraft\.bezierControl1X\);/);
  assert.match(source, /if \(keyframeDraft\.pathEditorMode === "bezier"\) setPhotoSlideshowProjectPathEditorMode\("bezier"\);/);
  assert.doesNotMatch(source, /const fallbackMidX = Math\.round/);
  assert.doesNotMatch(source, /firstKeyframes\.quarterX/);
  assert.doesNotMatch(source, /const firstCropItem = \(project\.timelineItems \|\| \[\]\)\.find/);
  assert.doesNotMatch(source, /const firstCaptionItem = \(project\.timelineItems \|\| \[\]\)\.find/);
  assert.doesNotMatch(source, /const firstTransitionItem = \(project\.timelineItems \|\| \[\]\)\.find/);
  assert.match(source, /function applyPhotoSlideshowProjectEditorDraftState\(/);
  assert.match(source, /applyPhotoSlideshowProjectEditorDraftState\(photoSlideshowProjectEditorDraft\(project\)\);/);
  assert.doesNotMatch(source, /durationMs: Math\.max\(500, Math\.min\(60000, Math\.round\(existing\?\.durationMs \|\| slideshowIntervalMs\)\)\)/);
  assert.doesNotMatch(source, /durationMs: Math\.max\(500, Math\.min\(60000, Math\.round\(item\.durationMs \|\| slideshowIntervalMs\)\)\)/);
  assert.match(source, /function currentPhotoSlideshowThemeSettings\(\): PhotoSlideshowThemeSettings/);
  assert.match(source, /function applyPhotoSlideshowThemeSettings\(/);
  assert.match(source, /function photoSlideshowThemeTemplateIdForSettings/);

  const memoryPayloadBlock = source.match(/function currentPhotoMemoryMovieSettingsPayload\(\): NonNullable<PhotoMemory\["movieSettings"\]> \{[\s\S]*?\n  \}\n\n  function applyPhotoMemoryMovieSettings/);
  assert.ok(memoryPayloadBlock, "currentPhotoMemoryMovieSettingsPayload should exist");
  assert.match(memoryPayloadBlock[0], /return photoSlideshowMemoryMovieSettingsPayload\(\{/);
  assert.doesNotMatch(memoryPayloadBlock[0], /audioVolume: Math\.max/);
  assert.doesNotMatch(memoryPayloadBlock[0], /titleCardTitle: photoSlideshowProjectTitleCardTitle\.trim\(\)/);

  const memoryApplyBlock = source.match(/function applyPhotoMemoryMovieSettings\(settings: PhotoMemory\["movieSettings"\] \| null = activeMemoryMovieSettings\) \{[\s\S]*?\n  \}\n\n  function updatePhotoSlideshowTemplateRegionSlot/);
  assert.ok(memoryApplyBlock, "applyPhotoMemoryMovieSettings should exist");
  assert.match(memoryApplyBlock[0], /const movieDraft = photoSlideshowMemoryMovieEditorDraft\(settings, slideshowIntervalMs\);/);
  assert.doesNotMatch(memoryApplyBlock[0], /Number\(settings\.audioVolume/);
  assert.doesNotMatch(memoryApplyBlock[0], /settings\.titleCardPalette \|\| "auto"/);

  const memoryExportBlock = source.match(/async function exportActiveMemoryMovie\(folder: PhotoFolder \| null = activeMemory\) \{[\s\S]*?\n  \}\n\n  async function createUserMemoryFromCurrentView/);
  assert.ok(memoryExportBlock, "exportActiveMemoryMovie should exist");
  assert.match(memoryExportBlock[0], /const exportSettings = photoSlideshowMemoryMovieExportSettings\(\{/);
  assert.match(memoryExportBlock[0], /\.\.\.exportSettings,/);
  assert.doesNotMatch(memoryExportBlock[0], /const memorySetting = <T,/);
  assert.doesNotMatch(memoryExportBlock[0], /memorySetting\("theme"/);

  const applyTemplateBlock = source.match(/function applyPhotoSlideshowThemeTemplate\(template: PhotoSlideshowThemeTemplate \| null = selectedPhotoSlideshowThemeTemplate\) \{[\s\S]*?\n  \}\n\n  async function saveCurrentPhotoSlideshowThemeTemplate/);
  assert.ok(applyTemplateBlock, "applyPhotoSlideshowThemeTemplate should exist");
  assert.match(applyTemplateBlock[0], /applyPhotoSlideshowThemeSettings\(photoSlideshowThemeTemplateSettings\(template\)\);/);
  assert.doesNotMatch(applyTemplateBlock[0], /setPhotoSlideshowProjectThemeTemplatePalette/);
  assert.doesNotMatch(applyTemplateBlock[0], /setPhotoSlideshowProjectThemeTemplateRegionMap/);

  const saveProjectBlock = source.match(/async function saveCurrentPhotoSlideshowProject\(\) \{[\s\S]*?\n  \}\n\n  async function deleteSelectedPhotoSlideshowProject/);
  assert.ok(saveProjectBlock, "saveCurrentPhotoSlideshowProject should exist");
  assert.match(saveProjectBlock[0], /const draft = photoSlideshowProjectSaveDraft\(\{/);
  assert.match(saveProjectBlock[0], /themeSettings: currentPhotoSlideshowThemeSettings\(\),/);
  assert.doesNotMatch(saveProjectBlock[0], /const editorMatchesSelection = Boolean/);
  assert.doesNotMatch(saveProjectBlock[0], /const sourcePaths = selectedSources\.size/);
  assert.doesNotMatch(saveProjectBlock[0], /timelineItems: cleanPhotoSlideshowTimelineItems\(photoSlideshowProjectTimelineItems, sourcePaths, slideshowIntervalMs\)/);
  assert.doesNotMatch(saveProjectBlock[0], /themeTemplatePalette: photoSlideshowProjectThemeTemplatePalette/);

  const deleteProjectBlock = source.match(/async function deleteSelectedPhotoSlideshowProject\(\) \{[\s\S]*?\n  \}\n\n  async function exportSelectedPhotoSlideshowProject/);
  assert.ok(deleteProjectBlock, "deleteSelectedPhotoSlideshowProject should exist");
  assert.match(deleteProjectBlock[0], /applyPhotoSlideshowProjectEditorDraftState\(emptyPhotoSlideshowProjectEditorDraft\(\), \{/);
  assert.match(deleteProjectBlock[0], /applyMusicChoice: false/);
  assert.match(deleteProjectBlock[0], /applyPlaybackSettings: false/);
  assert.doesNotMatch(deleteProjectBlock[0], /applyPhotoSlideshowThemeSettings\(\);/);
  assert.doesNotMatch(deleteProjectBlock[0], /setPhotoSlideshowProjectKeyframeStartX\(50\)/);
  assert.doesNotMatch(deleteProjectBlock[0], /setPhotoSlideshowProjectThemeTemplatePalette\("auto"\)/);

  const exportProjectBlock = source.match(/async function exportSelectedPhotoSlideshowProject\(outputMode: "html" \| "video" = "html"\) \{[\s\S]*?\n  \}\n\n  async function exportSelectedContactSheet/);
  assert.ok(exportProjectBlock, "exportSelectedPhotoSlideshowProject should exist");
  assert.match(exportProjectBlock[0], /\.\.\.cleanPhotoSlideshowThemeSettings\(selectedPhotoSlideshowProject\),/);
  assert.doesNotMatch(exportProjectBlock[0], /themeTemplatePalette: selectedPhotoSlideshowProject\.themeTemplatePalette/);

  assert.doesNotMatch(source, /template\.themeTemplatePalette ===/);
  assert.doesNotMatch(source, /JSON\.stringify\(cleanPhotoSlideshowThemeTemplateRegionMap\(template/);
});

run("photo grid config owns preview budgets and viewport constants", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const gridConfigSource = fs.readFileSync(path.join(ROOT, "src/views/photoGridConfig.ts"), "utf8");
  assert.strictEqual(gridConfigMod.PAGE_LIMIT, 64);
  assert.strictEqual(gridConfigMod.PREVIEW_BUDGET, gridConfigMod.PAGE_LIMIT);
  assert.strictEqual(gridConfigMod.COVER_PREVIEW_BUDGET, 32);
  assert.strictEqual(gridConfigMod.PHOTO_GRID_GAP, 8);
  assert.strictEqual(gridConfigMod.PHOTO_GRID_HEADER_HEIGHT, 28);
  assert.strictEqual(gridConfigMod.PHOTO_GRID_OVERSCAN, 720);
  assert.strictEqual(gridConfigMod.PHOTO_GRID_SEARCH_DEBOUNCE_MS, 220);
  assert.strictEqual(gridConfigMod.SORTED_SOURCE_ORDER_PAGE_LIMIT, 500);
  assert.strictEqual(gridConfigMod.PHOTO_CREATION_LIBRARY_CANDIDATE_LIMIT, 500);
  assert.match(photosViewSource, /from "\.\/photoGridConfig"/);
  assert.doesNotMatch(photosViewSource, /const PAGE_LIMIT = 64;/);
  assert.doesNotMatch(photosViewSource, /const PHOTO_GRID_SEARCH_DEBOUNCE_MS = 220;/);
  assert.match(gridConfigSource, /export const PAGE_LIMIT = 64;/);
  assert.match(gridConfigSource, /export const PREVIEW_BUDGET = PAGE_LIMIT;/);
});

run("Photos renderer imports option and derived-state helpers from feature modules", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const dateViewsSource = fs.readFileSync(path.join(ROOT, "src/views/photoDateViews.ts"), "utf8");
  const savedSearchSource = fs.readFileSync(path.join(ROOT, "src/views/photoSavedSearch.ts"), "utf8");
  const importSessionSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportSessionDetails.ts"), "utf8");
  const indexEverythingDialogSource = fs.readFileSync(path.join(ROOT, "src/views/photoIndexEverythingDialog.tsx"), "utf8");
  const importSessionPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportSessionPanel.tsx"), "utf8");
  const importStatusAlertsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportStatusAlerts.tsx"), "utf8");
  const importHistoryPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportHistoryPanel.tsx"), "utf8");
  const importHistoryListSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportHistoryList.tsx"), "utf8");
  const recoveredImportIssuesSource = fs.readFileSync(path.join(ROOT, "src/views/photoRecoveredImportIssuesPanel.tsx"), "utf8");
  const loadStatusAlertsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLoadStatusAlertsPanel.tsx"), "utf8");
  const selectionPrimaryActionsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionPrimaryActions.tsx"), "utf8");
  const selectionOriginalActionsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionOriginalActions.tsx"), "utf8");
  const selectionReviewActionsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionReviewActions.tsx"), "utf8");
  const selectionSummaryControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionSummaryControls.tsx"), "utf8");
  const selectionEditControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionEditControls.tsx"), "utf8");
  const selectionBulkMetadataControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionBulkMetadataControls.tsx"), "utf8");
  const selectionOrderControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionOrderControls.tsx"), "utf8");
  const selectionVisibilityControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSelectionVisibilityControls.tsx"), "utf8");
  const exportContactSheetControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportContactSheetControls.tsx"), "utf8");
  const exportDestinationControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportDestinationControls.tsx"), "utf8");
  const exportPackagingControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportPackagingControls.tsx"), "utf8");
  const exportPresetControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportPresetControls.tsx"), "utf8");
  const exportRenderControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportRenderControls.tsx"), "utf8");
  const exportVideoControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportVideoControls.tsx"), "utf8");
  const albumFolderEditorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumFolderEditor.tsx"), "utf8");
  const albumEditorPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorPanel.tsx"), "utf8");
  const curationPreferencesPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoCurationPreferencesPanel.tsx"), "utf8");
  const railDisplayControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailDisplayControls.tsx"), "utf8");
  const railImportControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailImportControls.tsx"), "utf8");
  const railLoadErrorsSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailLoadErrors.tsx"), "utf8");
  const savedFiltersRailSource = fs.readFileSync(path.join(ROOT, "src/views/photoSavedFiltersRailSection.tsx"), "utf8");
  const inlineReviewSource = fs.readFileSync(path.join(ROOT, "src/views/photoInlineReviewDecisions.ts"), "utf8");
  const slideshowProjectsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjects.ts"), "utf8");
  const slideshowProjectBasicsControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectBasicsControls.tsx"), "utf8");
  const slideshowProjectFramingControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectFramingControls.tsx"), "utf8");
  const slideshowProjectCaptionControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectCaptionControls.tsx"), "utf8");
  const slideshowProjectCaptionActionControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectCaptionActionControls.tsx"), "utf8");
  const slideshowProjectKeyframeControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectKeyframeControls.tsx"), "utf8");
  const slideshowProjectPlaybackControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectPlaybackControls.tsx"), "utf8");
  const slideshowProjectTemplateControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectTemplateControls.tsx"), "utf8");
  const slideshowProjectTimelineControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjectTimelineControls.tsx"), "utf8");

  assert.match(source, /isPhotoDateBucketViewMode/);
  assert.match(source, /PHOTO_QUALITY_FILTERS/);
  assert.match(source, /PHOTO_FILE_TYPE_FILTERS/);
  assert.match(source, /buildPhotoImportHistoryState/);
  assert.match(source, /PhotoIndexEverythingDialog/);
  assert.match(source, /onRun=\{\(\) => void runIndexEverything\(indexEverythingSource\)\}/);
  assert.match(source, /onAddDrive=\{\(path\) => setIndexEverythingExtraPaths/);
  assert.match(source, /onHideNoiseChange=\{setIndexEverythingHideNoise\}/);
  assert.match(source, /photoActiveImportSessionRecord/);
  assert.match(source, /photoImportHistoryCountLabel/);
  assert.match(source, /photoImportHistoryProvenancePayload/);
  assert.match(source, /photoImportHistoryArchivePayload/);
  assert.match(source, /PhotoImportSessionPanel/);
  assert.match(source, /PhotoImportStatusAlerts/);
  assert.match(source, /PhotoImportHistoryPanel/);
  assert.match(source, /PhotoRecoveredImportIssuesPanel/);
  assert.match(source, /PhotoLoadStatusAlertsPanel/);
  assert.match(source, /PhotoSelectionSummaryControls/);
  assert.match(source, /PhotoSelectionPrimaryActions/);
  assert.match(source, /PhotoSelectionOriginalActions/);
  assert.match(source, /PhotoSelectionReviewActions/);
  assert.match(source, /PhotoSelectionEditControls/);
  assert.match(source, /PhotoSelectionBulkMetadataControls/);
  assert.match(source, /PhotoSelectionOrderControls/);
  assert.match(source, /PhotoSelectionVisibilityControls/);
  assert.match(source, /PhotoExportContactSheetControls/);
  assert.match(source, /PhotoExportDestinationControls/);
  assert.match(source, /PhotoExportPackagingControls/);
  assert.match(source, /PhotoExportPresetControls/);
  assert.match(source, /PhotoExportRenderControls/);
  assert.match(source, /PhotoExportVideoControls/);
  assert.match(source, /PhotoAlbumFolderEditor/);
  assert.match(source, /PhotoAlbumEditorPanel/);
  assert.match(source, /PhotoCurationPreferencesPanel/);
  assert.match(source, /PhotoRailDisplayControls/);
  assert.match(source, /PhotoRailImportControls/);
  assert.match(source, /PhotoRailLoadErrors/);
  assert.match(source, /PhotoSavedFiltersRailSection/);
  assert.match(source, /PhotoSlideshowProjectBasicsControls/);
  assert.match(source, /PhotoSlideshowProjectFramingControls/);
  assert.match(source, /PhotoSlideshowProjectCaptionControls/);
  assert.match(source, /PhotoSlideshowProjectCaptionActionControls/);
  assert.match(source, /PhotoSlideshowProjectKeyframeControls/);
  assert.match(source, /PhotoSlideshowProjectPlaybackControls/);
  assert.match(source, /PhotoSlideshowProjectTemplateControls/);
  assert.match(source, /PhotoSlideshowProjectTimelineControls/);
  assert.match(source, /onPreferenceChange=\{setPhotoRailDisplayPreference\}/);
  assert.match(source, /onUnlockSensitiveCollections=\{\(\) => void unlockSensitiveCollections\(\)\}/);
  assert.match(source, /onStorageModeChange=\{\(mode\) => void setPhotoDefaultStorageMode\(mode\)\}/);
  assert.match(source, /onRefreshAlbums=\{\(\) => \{ void loadFolders\(\); void loadSuggestions\(\); void loadKeywords\(\); \}\}/);
  assert.match(source, /onRetry=\{\(\) => \{ void loadFolders\(\); void loadSuggestions\(\); void loadKeywords\(\); \}\}/);
  assert.match(source, /onToggleSection=\{\(\) => toggleRailSection\("savedFilters"\)\}/);
  assert.match(source, /onDeleteFilter=\{\(filterId\) => void deleteSavedFilter\(filterId\)\}/);
  assert.match(source, /photoInlineReviewDecisionRows\(inlineReviewDecisions, \{ fileName \}\)\.map/);
  assert.match(source, /PHOTO_SLIDESHOW_MUSIC_FREQUENCIES/);
  assert.match(loadStatusAlertsSource, /Could not load photos/);
  assert.match(loadStatusAlertsSource, /Could not generate every preview/);
  assert.match(loadStatusAlertsSource, /Preview repair failed/);
  assert.match(loadStatusAlertsSource, /Rebuild previews/);
  assert.match(loadStatusAlertsSource, /Missing originals/);
  assert.match(loadStatusAlertsSource, /Relink folder/);
  assert.match(selectionSummaryControlsSource, /Clear page/);
  assert.match(selectionSummaryControlsSource, /Select page/);
  assert.match(selectionSummaryControlsSource, /count-roll/);
  assert.match(selectionPrimaryActionsSource, /Contact sheet/);
  assert.match(selectionPrimaryActionsSource, /Print sheet/);
  assert.match(selectionPrimaryActionsSource, /Slideshow selected/);
  assert.match(selectionPrimaryActionsSource, /Remove from memory/);
  assert.match(selectionPrimaryActionsSource, /Export options/);
  assert.match(selectionOriginalActionsSource, /Consolidate/);
  assert.match(selectionOriginalActionsSource, /Reveal original/);
  assert.match(selectionOriginalActionsSource, /Open original/);
  assert.match(selectionOriginalActionsSource, /Print original/);
  assert.match(selectionOriginalActionsSource, /Open with\.\.\./);
  assert.match(selectionOriginalActionsSource, /Open with last/);
  assert.match(selectionOriginalActionsSource, /Bundle/);
  assert.match(selectionReviewActionsSource, /Review/);
  assert.match(selectionReviewActionsSource, /Merge groups/);
  assert.match(selectionReviewActionsSource, /Dismiss groups/);
  assert.match(slideshowProjectBasicsControlsSource, /Slideshow project/);
  assert.match(slideshowProjectBasicsControlsSource, /Slideshow title/);
  assert.match(slideshowProjectBasicsControlsSource, /Title-card title/);
  assert.match(slideshowProjectBasicsControlsSource, /Title-card palette/);
  assert.match(slideshowProjectBasicsControlsSource, /Title-card layout/);
  assert.match(slideshowProjectBasicsControlsSource, /Title-card footer/);
  assert.match(slideshowProjectBasicsControlsSource, /Selected slide duration/);
  assert.match(slideshowProjectBasicsControlsSource, /Selected slide motion/);
  assert.match(slideshowProjectFramingControlsSource, /Apply motion/);
  assert.match(slideshowProjectFramingControlsSource, /Focal X/);
  assert.match(slideshowProjectFramingControlsSource, /Focal Y/);
  assert.match(slideshowProjectFramingControlsSource, /Crop zoom/);
  assert.match(slideshowProjectFramingControlsSource, /Apply crop/);
  assert.match(slideshowProjectFramingControlsSource, /Use face focal/);
  assert.match(slideshowProjectFramingControlsSource, /Clear crop/);
  assert.match(slideshowProjectCaptionControlsSource, /Selected slide caption/);
  assert.match(slideshowProjectCaptionControlsSource, /Selected caption layer/);
  assert.match(slideshowProjectCaptionControlsSource, /Selected caption placement/);
  assert.match(slideshowProjectCaptionControlsSource, /Selected caption typography/);
  assert.match(slideshowProjectCaptionControlsSource, /Selected caption wrap/);
  assert.match(slideshowProjectCaptionControlsSource, /Caption region X/);
  assert.match(slideshowProjectCaptionControlsSource, /Caption region height/);
  assert.match(slideshowProjectCaptionControlsSource, /PHOTO_SLIDESHOW_CAPTION_LIMIT/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Apply caption/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Apply caption preset/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Clear caption/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Selected transition/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Selected transition duration/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Apply transition/);
  assert.match(slideshowProjectCaptionActionControlsSource, /Clear transition/);
  assert.match(slideshowProjectKeyframeControlsSource, /Bezier control 1 X/);
  assert.match(slideshowProjectKeyframeControlsSource, /Path start X/);
  assert.match(slideshowProjectKeyframeControlsSource, /Path mid X/);
  assert.match(slideshowProjectKeyframeControlsSource, /Mid zoom/);
  assert.match(slideshowProjectKeyframeControlsSource, /Apply keyframes/);
  assert.match(slideshowProjectKeyframeControlsSource, /Clear keyframes/);
  assert.match(slideshowProjectKeyframeControlsSource, /Move slide earlier/);
  assert.match(slideshowProjectPlaybackControlsSource, /Transition/);
  assert.match(slideshowProjectPlaybackControlsSource, /Transition duration/);
  assert.match(slideshowProjectPlaybackControlsSource, /Music/);
  assert.match(slideshowProjectPlaybackControlsSource, /Audio file/);
  assert.match(slideshowProjectPlaybackControlsSource, /Audio volume/);
  assert.match(slideshowProjectPlaybackControlsSource, /Audio fade/);
  assert.match(slideshowProjectPlaybackControlsSource, /Clear audio range/);
  assert.match(slideshowProjectTemplateControlsSource, /Template palette/);
  assert.match(slideshowProjectTemplateControlsSource, /Template typography/);
  assert.match(slideshowProjectTemplateControlsSource, /Template backdrop/);
  assert.match(slideshowProjectTemplateControlsSource, /Template layout/);
  assert.match(slideshowProjectTemplateControlsSource, /Template region slot/);
  assert.match(slideshowProjectTemplateControlsSource, /Save template/);
  assert.match(slideshowProjectTemplateControlsSource, /Delete template/);
  assert.match(slideshowProjectTimelineControlsSource, /Slideshow timeline/);
  assert.match(slideshowProjectTimelineControlsSource, /Audio starts/);
  assert.match(slideshowProjectTimelineControlsSource, /Audio ends/);
  assert.match(slideshowProjectTimelineControlsSource, /Save slideshow/);
  assert.match(slideshowProjectTimelineControlsSource, /Play project/);
  assert.match(slideshowProjectTimelineControlsSource, /Export slideshow/);
  assert.match(slideshowProjectTimelineControlsSource, /Export movie/);
  assert.match(slideshowProjectTimelineControlsSource, /Delete project/);
  assert.match(selectionEditControlsSource, /Paste copied edits to selected photos/);
  assert.match(selectionEditControlsSource, /Paste copied adjustments to selected photos/);
  assert.match(selectionEditControlsSource, /Revert edits for selected photos/);
  assert.match(selectionEditControlsSource, /Snapshot edit versions for selected photos/);
  assert.match(selectionEditControlsSource, /Restore latest edit versions for selected photos/);
  assert.match(selectionEditControlsSource, /Delete saved edit versions for selected photos/);
  assert.match(selectionBulkMetadataControlsSource, /Move selected matches to person/);
  assert.match(selectionBulkMetadataControlsSource, /Bulk pet name/);
  assert.match(selectionBulkMetadataControlsSource, /Add to album/);
  assert.match(selectionBulkMetadataControlsSource, /Bulk keywords/);
  assert.match(selectionBulkMetadataControlsSource, /Date offset days/);
  assert.match(selectionBulkMetadataControlsSource, /Bulk timezone offset/);
  assert.doesNotMatch(selectionOrderControlsSource, /Save sort as custom/);
  assert.match(source, /photo-save-custom-sort[\s\S]*Save sort as custom/);
  assert.match(selectionOrderControlsSource, /Move first/);
  assert.match(selectionOrderControlsSource, /Move earlier/);
  assert.match(selectionOrderControlsSource, /Move later/);
  assert.match(selectionOrderControlsSource, /Move last/);
  assert.match(selectionOrderControlsSource, /Custom order position/);
  assert.match(selectionOrderControlsSource, /Remove from album/);
  assert.match(selectionVisibilityControlsSource, /photo-retention-control/);
  assert.match(selectionVisibilityControlsSource, /Retention days/);
  assert.match(selectionVisibilityControlsSource, /Delete older/);
  assert.match(selectionVisibilityControlsSource, /Delete permanently/);
  assert.match(selectionVisibilityControlsSource, /Hide/);
  assert.match(exportPresetControlsSource, /Export preset/);
  assert.match(exportPresetControlsSource, /Custom export/);
  assert.match(exportPresetControlsSource, /Preset name/);
  assert.match(exportPresetControlsSource, /Save preset/);
  assert.match(exportPresetControlsSource, /Apply preset/);
  assert.match(exportPresetControlsSource, /Project bundle/);
  assert.match(exportPresetControlsSource, /Creation presets/);
  assert.match(exportPresetControlsSource, /Creation suggestions/);
  assert.match(exportPresetControlsSource, /Full view suggestions/);
  assert.match(exportPresetControlsSource, /Library suggestions/);
  assert.match(exportPresetControlsSource, /Delete preset/);
  assert.match(exportDestinationControlsSource, /Export destinations/);
  assert.match(exportDestinationControlsSource, /Export destination/);
  assert.match(exportDestinationControlsSource, /Choose on export/);
  assert.match(exportDestinationControlsSource, /Export to destination/);
  assert.match(exportDestinationControlsSource, /Copy to destination/);
  assert.match(exportDestinationControlsSource, /Forget destination/);
  assert.match(exportRenderControlsSource, /Export kind/);
  assert.match(exportRenderControlsSource, /Original file/);
  assert.match(exportRenderControlsSource, /Rendered file/);
  assert.match(exportRenderControlsSource, /Render format/);
  assert.match(exportRenderControlsSource, /Render quality/);
  assert.match(exportRenderControlsSource, /Render size/);
  assert.match(exportRenderControlsSource, /Render max edge/);
  assert.match(exportRenderControlsSource, /Preserve color profile/);
  assert.match(exportRenderControlsSource, /Target profile/);
  assert.match(exportRenderControlsSource, /display-p3/);
  assert.match(exportRenderControlsSource, /adobe-rgb/);
  assert.match(exportRenderControlsSource, /custom-icc/);
  assert.match(exportRenderControlsSource, /Choose ICC/);
  assert.match(exportRenderControlsSource, /No ICC selected/);
  assert.match(exportRenderControlsSource, /photo-export-profile-preflight/);
  assert.match(exportVideoControlsSource, /Video quality/);
  assert.match(exportVideoControlsSource, /Video format/);
  assert.match(exportVideoControlsSource, /HEVC MP4/);
  assert.match(exportVideoControlsSource, /ProRes MOV/);
  assert.match(exportContactSheetControlsSource, /Contact format/);
  assert.match(exportContactSheetControlsSource, /Contact title/);
  assert.match(exportContactSheetControlsSource, /Contact sheet title/);
  assert.match(exportContactSheetControlsSource, /Page size/);
  assert.match(exportContactSheetControlsSource, /Print layout/);
  assert.match(exportContactSheetControlsSource, /Contact captions/);
  assert.match(exportContactSheetControlsSource, /Caption details/);
  assert.match(exportContactSheetControlsSource, /Title, date, people/);
  assert.match(exportContactSheetControlsSource, /Contact sheet columns/);
  assert.match(exportContactSheetControlsSource, /Contact sheet thumbnail size/);
  assert.match(exportPackagingControlsSource, /Bundle with media folder/);
  assert.match(exportPackagingControlsSource, /Flat original export/);
  assert.match(exportPackagingControlsSource, /Numbered filenames/);
  assert.match(exportPackagingControlsSource, /Original filenames/);
  assert.match(exportPackagingControlsSource, /Template filenames/);
  assert.match(exportPackagingControlsSource, /Filename template/);
  assert.match(exportPackagingControlsSource, /Subfolder template/);
  assert.match(exportPackagingControlsSource, /Metadata JSON/);
  assert.match(exportPackagingControlsSource, /XMP sidecars/);
  assert.match(exportPackagingControlsSource, /Existing sidecars/);
  assert.match(exportPackagingControlsSource, /Strip location/);
  assert.match(exportPackagingControlsSource, /Share after export/);

  assert.doesNotMatch(source, /function isPhotoDateBucketViewMode/);
  assert.doesNotMatch(source, /const PHOTO_QUALITY_FILTERS =/);
  assert.doesNotMatch(source, /const PHOTO_FILE_TYPE_FILTERS =/);
  assert.doesNotMatch(source, /index-everything-sheet/);
  assert.doesNotMatch(source, /index-everything-scope-chip/);
  assert.doesNotMatch(source, /Everything stays on your device/);
  assert.doesNotMatch(source, /PHOTO_IMPORT_HISTORY_RENDER_LIMIT/);
  assert.doesNotMatch(source, /buildPhotoImportSessionSummaries/);
  assert.doesNotMatch(source, /filterPhotoImportSessionSummaries/);
  assert.doesNotMatch(source, /activeId\.startsWith\("import:"\)/);
  assert.doesNotMatch(source, /uiText\("of"\).*uiText\("matches"\).*uiText\("sessions"\)/s);
  assert.doesNotMatch(source, /Source label is required\./);
  assert.doesNotMatch(source, /Archived from import history/);
  assert.doesNotMatch(source, /PhotoImportHistoryProvenanceEditor/);
  assert.doesNotMatch(source, /PhotoImportHistoryList/);
  assert.doesNotMatch(source, /PhotoImportHistoryToolbar/);
  assert.doesNotMatch(source, /PhotoImportHistoryBulkProvenanceEditor/);
  assert.doesNotMatch(source, /photo-import-session-panel/);
  assert.doesNotMatch(source, /photo-import-failure-row/);
  assert.doesNotMatch(source, /photo-import-history-panel/);
  assert.doesNotMatch(source, /photo-import-history-list/);
  assert.doesNotMatch(source, /photo-recovered-panel/);
  assert.doesNotMatch(source, /photo-rail-display-controls/);
  assert.doesNotMatch(source, /uiText\("Collection display"\)/);
  assert.doesNotMatch(source, /photo-album-toolbar/);
  assert.doesNotMatch(source, /photo-import-storage-control/);
  assert.doesNotMatch(source, /photo-import-system-sources/);
  assert.doesNotMatch(source, /PHOTO_IMPORT_SOURCE_OPTIONS\.map/);
  assert.doesNotMatch(source, /railLoadErrors\.map/);
  assert.doesNotMatch(source, /savedFilters\.map\(\(filter, filterIndex\) =>/);
  assert.doesNotMatch(source, /photo-saved-filter-actions/);
  assert.doesNotMatch(source, /photo-saved-filter-snippet/);
  assert.doesNotMatch(source, /uiText\("Album folder name"\)/);
  assert.doesNotMatch(source, /uiText\("Save folder"\)/);
  assert.doesNotMatch(source, /uiText\("Album type"\)/);
  assert.doesNotMatch(source, /uiText\("Visual query"\)/);
  assert.doesNotMatch(source, /uiText\("Migrate album"\)/);
  assert.doesNotMatch(source, /uiText\("Clear query"\)/);
  assert.doesNotMatch(source, /uiText\("Search text"\)/);
  assert.doesNotMatch(source, /uiText\("Keyword rule"\)/);
  assert.doesNotMatch(source, /uiText\("Favorites only"\)/);
  assert.doesNotMatch(source, /uiText\("Edited only"\)/);
  assert.doesNotMatch(source, /photo-smart-query-builder/);
  assert.doesNotMatch(source, /photo-curation-preferences/);
  assert.doesNotMatch(source, /uiText\("Reset Memory feedback"\)/);
  assert.doesNotMatch(source, /uiText\("External editors"\)/);
  assert.doesNotMatch(source, /const PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT =/);
  assert.doesNotMatch(source, /inlineReviewDecisions\.slice\(0, PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT\)/);
  assert.doesNotMatch(source, /Math\.round\(decision\.score \* 100\)/);
  assert.doesNotMatch(source, /const PHOTO_SLIDESHOW_MUSIC_FREQUENCIES:/);
  assert.doesNotMatch(source, /className="photo-export-presets"/);
  assert.doesNotMatch(source, /uiText\("Export preset"\)/);
  assert.doesNotMatch(source, /uiText\("Delete preset"\)/);
  assert.doesNotMatch(source, /className="photo-export-destinations"/);
  assert.doesNotMatch(source, /uiText\("Export destination"\)/);
  assert.doesNotMatch(source, /uiText\("Forget destination"\)/);
  assert.doesNotMatch(source, /uiText\("Export kind"\)/);
  assert.doesNotMatch(source, /uiText\("Render format"\)/);
  assert.doesNotMatch(source, /uiText\("Target profile"\)/);
  assert.doesNotMatch(source, /photo-export-profile-preflight/);
  assert.doesNotMatch(source, /uiText\("Video quality"\)/);
  assert.doesNotMatch(source, /uiText\("Video format"\)/);
  assert.doesNotMatch(source, /uiText\("Contact format"\)/);
  assert.doesNotMatch(source, /uiText\("Contact title"\)/);
  assert.doesNotMatch(source, /uiText\("Print layout"\)/);
  assert.doesNotMatch(source, /uiText\("Contact captions"\)/);
  assert.doesNotMatch(source, /uiText\("Caption details"\)/);
  assert.doesNotMatch(source, /uiText\("Metadata JSON"\)/);
  assert.doesNotMatch(source, /uiText\("XMP sidecars"\)/);
  assert.doesNotMatch(source, /uiText\("Existing sidecars"\)/);
  assert.doesNotMatch(source, /uiText\("Share after export"\)/);
  assert.doesNotMatch(source, /uiText\("Template filenames"\)/);
  assert.doesNotMatch(source, /uiText\("Filename template"\)/);
  assert.doesNotMatch(source, /uiText\("Subfolder template"\)/);

  assert.match(dateViewsSource, /export function isPhotoDateBucketViewMode/);
  assert.match(savedSearchSource, /export const PHOTO_QUALITY_FILTERS/);
  assert.match(savedSearchSource, /export const PHOTO_FILE_TYPE_FILTERS/);
  assert.match(indexEverythingDialogSource, /export function PhotoIndexEverythingDialog/);
  assert.match(indexEverythingDialogSource, /index-everything-sheet/);
  assert.match(indexEverythingDialogSource, /index-everything-scope-chip/);
  assert.match(indexEverythingDialogSource, /props\.onAddDrive\(drive\.path\)/);
  assert.match(indexEverythingDialogSource, /props\.onHideNoiseChange\(event\.currentTarget\.checked\)/);
  assert.match(importSessionSource, /export const PHOTO_IMPORT_HISTORY_RENDER_LIMIT = 40;/);
  assert.match(importSessionSource, /export function buildPhotoImportHistoryState/);
  assert.match(importSessionSource, /export function photoActiveImportSessionRecord/);
  assert.match(importSessionSource, /export function photoImportHistoryCountLabel/);
  assert.match(importSessionSource, /export function photoImportHistoryProvenancePayload/);
  assert.match(importSessionSource, /export function photoImportHistoryArchivePayload/);
  assert.match(importSessionPanelSource, /export function PhotoImportSessionPanel/);
  assert.match(importSessionPanelSource, /PhotoImportHistoryProvenanceEditor/);
  assert.match(importStatusAlertsSource, /export function PhotoImportStatusAlerts/);
  assert.match(importStatusAlertsSource, /photo-import-warning photo-import-failures/);
  assert.match(importStatusAlertsSource, /photo-import-failure-row/);
  assert.match(importStatusAlertsSource, /props\.warnings\.map/);
  assert.match(importStatusAlertsSource, /props\.failures\.slice\(0, 6\)\.map/);
  assert.match(importHistoryPanelSource, /export function PhotoImportHistoryPanel/);
  assert.match(importHistoryPanelSource, /PhotoImportHistoryToolbar/);
  assert.match(importHistoryPanelSource, /PhotoImportHistoryBulkProvenanceEditor/);
  assert.match(importHistoryPanelSource, /PhotoImportHistoryList/);
  assert.match(importHistoryListSource, /export function PhotoImportHistoryList/);
  assert.match(importHistoryListSource, /PhotoImportHistoryProvenanceEditor/);
  assert.match(recoveredImportIssuesSource, /export function PhotoRecoveredImportIssuesPanel/);
  assert.match(recoveredImportIssuesSource, /photo-recovered-panel/);
  assert.match(albumFolderEditorSource, /export function PhotoAlbumFolderEditor/);
  assert.match(albumFolderEditorSource, /props\.uiText\("Album folder name"\)/);
  assert.match(albumFolderEditorSource, /props\.uiText\("Parent folder"\)/);
  assert.match(albumFolderEditorSource, /props\.uiText\("Save folder"\)/);
  assert.match(albumFolderEditorSource, /props\.parentFolders\.map/);
  assert.match(albumEditorPanelSource, /export function PhotoAlbumEditorPanel/);
  assert.match(albumEditorPanelSource, /photo-album-editor/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Album type"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Visual query"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Migrate album"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Clear query"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Search text"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Keyword rule"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Favorites only"\)/);
  assert.match(albumEditorPanelSource, /props\.uiText\("Edited only"\)/);
  assert.match(albumEditorPanelSource, /props\.renderSmartQueryGroup\(props\.smartQueryDraft\)/);
  assert.match(albumEditorPanelSource, /props\.onRulesChange\(\{ statuses:/);
  assert.match(albumEditorPanelSource, /props\.onTogglePerson\("include", person\)/);
  assert.match(curationPreferencesPanelSource, /export function PhotoCurationPreferencesPanel/);
  assert.match(curationPreferencesPanelSource, /photo-curation-preferences/);
  assert.match(curationPreferencesPanelSource, /props\.uiText\("External editors"\)/);
  assert.match(curationPreferencesPanelSource, /props\.uiText\("Reset Memory feedback"\)/);
  assert.match(curationPreferencesPanelSource, /props\.preferences\.favoriteMemories\.map/);
  assert.match(curationPreferencesPanelSource, /props\.preferences\.hiddenMemories\.map/);
  assert.match(curationPreferencesPanelSource, /props\.onClearMemoryRemoved\(memoryId\)/);
  assert.match(railDisplayControlsSource, /export function PhotoRailDisplayControls/);
  assert.match(railDisplayControlsSource, /photo-rail-display-controls/);
  assert.match(railDisplayControlsSource, /props\.uiText\("Collection display"\)/);
  assert.match(railDisplayControlsSource, /props\.onPreferenceChange\("showScreenshotCollections"/);
  assert.match(railDisplayControlsSource, /props\.sensitiveCollectionsUnlocked \? props\.onLockSensitiveCollections\(\) : props\.onUnlockSensitiveCollections\(\)/);
  assert.match(railImportControlsSource, /export function PhotoRailImportControls/);
  assert.match(railImportControlsSource, /photo-library-quick-actions/);
  assert.match(railImportControlsSource, /photo-library-management/);
  assert.match(railImportControlsSource, /photo-import-storage-control/);
  assert.match(railImportControlsSource, /photo-import-system-sources/);
  assert.match(railImportControlsSource, /PHOTO_IMPORT_SOURCE_OPTIONS\.map/);
  assert.match(railImportControlsSource, /props\.onStorageModeChange\("managed"\)/);
  assert.match(railLoadErrorsSource, /export function PhotoRailLoadErrors/);
  assert.match(railLoadErrorsSource, /props\.errors\.map/);
  assert.match(railLoadErrorsSource, /props\.uiText\("Retry"\)/);
  assert.match(savedFiltersRailSource, /export function PhotoSavedFiltersRailSection/);
  assert.match(savedFiltersRailSource, /props\.filters\.map\(\(filter, filterIndex\) =>/);
  assert.match(savedFiltersRailSource, /photo-saved-filter-actions/);
  assert.match(savedFiltersRailSource, /photo-saved-filter-snippet/);
  assert.match(savedFiltersRailSource, /props\.onMoveFilter\(filter\.id, "down"\)/);
  assert.match(savedFiltersRailSource, /props\.onDeleteFilter\(filter\.id\)/);
  assert.match(inlineReviewSource, /export const PHOTO_INLINE_REVIEW_DECISION_RENDER_LIMIT = 6;/);
  assert.match(inlineReviewSource, /export function photoInlineReviewDecisionRows/);
  assert.match(slideshowProjectsSource, /export const PHOTO_SLIDESHOW_MUSIC_FREQUENCIES/);
});

run("Photos renderer imports request and state types from feature modules", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const pageRequestSource = fs.readFileSync(path.join(ROOT, "src/views/photoPageRequests.ts"), "utf8");
  const railSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailVisibility.ts"), "utf8");
  const albumOrderingSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumOrdering.ts"), "utf8");
  const importSessionSource = fs.readFileSync(path.join(ROOT, "src/views/photoImportSessionDetails.ts"), "utf8");
  const exportPresetsSource = fs.readFileSync(path.join(ROOT, "src/views/photoExportPresets.ts"), "utf8");
  const placesMapSource = fs.readFileSync(path.join(ROOT, "src/views/photoPlacesMap.ts"), "utf8");
  const repairCenterSource = fs.readFileSync(path.join(ROOT, "src/views/photoRepairCenter.ts"), "utf8");
  const lightboxSessionSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxSession.ts"), "utf8");
  const imageEditsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEdits.ts"), "utf8");
  const videoControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxVideoControls.tsx"), "utf8");
  const slideshowSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshow.ts"), "utf8");
  const slideshowProjectsSource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowProjects.ts"), "utf8");
  const confirmationSource = fs.readFileSync(path.join(ROOT, "src/views/photoConfirmation.ts"), "utf8");
  const savedSearchSource = fs.readFileSync(path.join(ROOT, "src/views/photoSavedSearch.ts"), "utf8");

  assert.match(source, /from "\.\/photoPageRequests"/);
  assert.match(source, /EMPTY_PHOTO_ALBUM_RULES/);
  assert.doesNotMatch(source, /^type PhotoSort/m);
  assert.doesNotMatch(source, /^type PhotoPageLoadRequest/m);
  assert.doesNotMatch(source, /^type PhotoPlaceMapMode/m);
  assert.doesNotMatch(source, /^type PhotoRailDisplayPreferenceKey/m);
  assert.doesNotMatch(source, /^type PhotoAlbumTreeDragState/m);
  assert.doesNotMatch(source, /^type PhotoAlbumItemDragState/m);
  assert.doesNotMatch(source, /^type PendingPhotoImportEntry/m);
  assert.doesNotMatch(source, /^type PhotoCreationSuggestionScope/m);
  assert.doesNotMatch(source, /^interface PhotoRootRepairState/m);
  assert.doesNotMatch(source, /^type LightboxGesturePoint/m);
  assert.doesNotMatch(source, /^type ImageManualCropDragState/m);
  assert.doesNotMatch(source, /^type PhotoVideoCropAspect/m);
  assert.doesNotMatch(source, /^type PhotoSlideshowChapter/m);
  assert.doesNotMatch(source, /function buildPhotoSlideshowChapters/);
  assert.doesNotMatch(source, /^type PhotoSlideshowThemeTemplateLibraryExportValue/m);
  assert.doesNotMatch(source, /^type PhotoConfirmationState/m);
  assert.doesNotMatch(source, /const emptyRules/);

  assert.match(pageRequestSource, /export type PhotoPageLoadRequest/);
  assert.match(placesMapSource, /export type PhotoPlaceMapMode/);
  assert.match(railSource, /export type PhotoAlbumTreeDragState/);
  assert.match(railSource, /export type PhotoRailDisplayPreferenceKey/);
  assert.match(albumOrderingSource, /export type PhotoAlbumItemDragState/);
  assert.match(importSessionSource, /export type PendingPhotoImportEntry/);
  assert.match(exportPresetsSource, /export type PhotoCreationSuggestionScope/);
  assert.match(exportPresetsSource, /export function photoExportColorProfilePayload\(/);
  assert.match(exportPresetsSource, /export function photoExportRenderMaxDimensionNumber\(/);
  assert.match(exportPresetsSource, /export function photoExportRenderQualityNumber\(/);
  assert.match(exportPresetsSource, /export function photoCurrentExportPresetSettings\(/);
  assert.match(exportPresetsSource, /export function photoContactSheetColumnsNumber\(/);
  assert.match(exportPresetsSource, /export function photoContactSheetThumbnailSizeNumber\(/);
  assert.match(exportPresetsSource, /export function photoContactSheetExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /columns: photoContactSheetColumnsNumber\(input\.columns\)/);
  assert.match(exportPresetsSource, /thumbnailSize: photoContactSheetThumbnailSizeNumber\(input\.thumbnailSize\)/);
  assert.match(exportPresetsSource, /export function photoRenderedExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /renderQuality: photoExportRenderQualityNumber\(input\.renderQuality\)/);
  assert.match(exportPresetsSource, /export function photoVideoFrameExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /\.\.\.photoRenderedExportOptionsPayload\(input\)/);
  assert.match(exportPresetsSource, /export function photoLiveMotionExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /export function photoVideoRenderOptionsPayload\(/);
  assert.match(exportPresetsSource, /videoRenderFormat: cleanChoice\(input\.videoRenderFormat/);
  assert.match(exportPresetsSource, /videoRenderQuality: cleanChoice\(input\.videoRenderQuality/);
  assert.match(exportPresetsSource, /export function photoVideoTrimExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /\.\.\.photoVideoRenderOptionsPayload\(input\)/);
  assert.match(exportPresetsSource, /export function photoSubjectCutoutExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /export function photoPortraitBlurExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /export function photoSelectionExportOptionsPayload\(/);
  assert.match(exportPresetsSource, /export function photoStripLocationShareExportOptionsPayload\(/);
  assert.match(repairCenterSource, /export interface PhotoRootRepairState/);
  assert.match(lightboxSessionSource, /export type LightboxGesturePoint/);
  assert.match(imageEditsSource, /export type ImageManualCropDragState/);
  assert.match(videoControlsSource, /export type PhotoVideoCropAspect/);
  assert.match(slideshowSource, /export type PhotoSlideshowChapter/);
  assert.match(slideshowSource, /export function buildPhotoSlideshowChapters/);
  assert.match(slideshowProjectsSource, /export type PhotoSlideshowThemeTemplateLibraryExportValue/);
  assert.match(confirmationSource, /export type PhotoConfirmationState/);
  assert.match(savedSearchSource, /export const EMPTY_PHOTO_ALBUM_RULES/);
  assert.match(source, /photoExportRenderMaxDimensionNumber,/);
  assert.match(source, /photoContactSheetExportOptionsPayload,/);
  assert.match(source, /photoCurrentExportPresetSettings,/);
  assert.match(source, /photoPortraitBlurExportOptionsPayload,/);
  assert.match(source, /photoRenderedExportOptionsPayload,/);
  assert.match(source, /photoLiveMotionExportOptionsPayload,/);
  assert.match(source, /photoVideoFrameExportOptionsPayload,/);
  assert.match(source, /photoVideoRenderOptionsPayload,/);
  assert.match(source, /photoVideoTrimExportOptionsPayload,/);
  assert.match(source, /photoSubjectCutoutExportOptionsPayload,/);
  assert.match(source, /photoExportColorProfilePayload,/);
  assert.match(source, /photoSelectionExportOptionsPayload,/);
  assert.match(source, /photoStripLocationShareExportOptionsPayload,/);
  assert.match(source, /photoExportRenderMaxDimensionNumber\(effectiveExportRenderMaxDimension\)/);
  assert.match(source, /useMemo<PhotoExportPresetSettings>\(\(\) => photoCurrentExportPresetSettings\(\{/);
  assert.match(source, /photoRenderedExportOptionsPayload\(\{/);
  assert.match(source, /exportPhotoVideoFrame\(photoVideoFrameExportOptionsPayload\(\{/);
  assert.match(source, /exportPhotoLiveMotion\(photoLiveMotionExportOptionsPayload\(\{/);
  assert.match(source, /photoVideoRenderOptionsPayload\(\{/);
  assert.match(source, /exportPhotoVideoTrim\(photoVideoTrimExportOptionsPayload\(\{/);
  assert.match(source, /exportPhotoSubjectCutout\(photoSubjectCutoutExportOptionsPayload\(\{/);
  assert.match(source, /exportPhotoPortraitBlur\(photoPortraitBlurExportOptionsPayload\(\{/);
  assert.match(source, /exportPhotoContactSheet\(selectedSourcePaths, photoContactSheetExportOptionsPayload\(\{/);
  assert.match(source, /\.\.\.photoExportColorProfilePayload\(exportTargetColorProfile, exportTargetColorProfilePath, exportPreserveColorProfile\)/);
  assert.match(source, /return photoSelectionExportOptionsPayload\(\{/);
  assert.match(source, /photoStripLocationShareExportOptionsPayload\(\)/);
  assert.doesNotMatch(source, /function currentPhotoSelectionExportOptions\(\) \{\s*return \{\s*includeMetadata:/);
  assert.doesNotMatch(source, /useMemo<PhotoExportPresetSettings>\(\(\) => normalizePhotoExportPresetSettings\(\{\s*includeMetadata:/);
  assert.doesNotMatch(source, /exportPhotoContactSheet\(selectedSourcePaths, \{\s*format: contactSheetFormat/);
  assert.doesNotMatch(source, /exportPhotoSelection\(selectedSourcePaths, "export", undefined, \{\s*stripLocation: true/);
  assert.doesNotMatch(source, /Number\.parseInt\(exportRenderQuality, 10\)/);
  assert.doesNotMatch(source, /photoExportRenderQualityNumber\(exportRenderQuality\)/);
  assert.doesNotMatch(source, /exportPhotoVideoFrame\(\{\s*sourcePath/);
  assert.doesNotMatch(source, /timestampMs,\s*\.\.\.photoRenderedExportOptionsPayload/);
  assert.doesNotMatch(source, /usePosterFrame: true,\s*\.\.\.photoRenderedExportOptionsPayload/);
  assert.doesNotMatch(source, /exportPhotoLiveMotion\(\{\s*sourcePath: item\.sourcePath,\s*exportVariant/);
  assert.doesNotMatch(source, /cropAspect: videoCropAspect,\s*videoRenderFormat: exportVideoRenderFormat/);
  assert.doesNotMatch(source, /exportPhotoVideoTrim\(\{\s*sourcePath: item\.sourcePath[\s\S]*?endMs,\s*videoRenderFormat: exportVideoRenderFormat/);
  assert.doesNotMatch(source, /exportPhotoVideoTrim\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /\.\.\.exportSettings,\s*videoRenderFormat: exportVideoRenderFormat/);
  assert.doesNotMatch(source, /fitMode: selectedPhotoSlideshowProject\.fitMode,\s*videoRenderFormat: exportVideoRenderFormat/);
  assert.doesNotMatch(source, /exportPhotoSubjectCutout\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /exportPhotoPortraitBlur\(\{\s*sourcePath: item\.sourcePath/);
  assert.doesNotMatch(source, /Number\.parseInt\(effectiveExportRenderMaxDimension, 10\)/);
  assert.doesNotMatch(source, /photoContactSheetColumnsNumber\(contactSheetColumns\)/);
  assert.doesNotMatch(source, /photoContactSheetThumbnailSizeNumber\(contactSheetThumbnailSize\)/);
  assert.doesNotMatch(source, /Number\.parseInt\(contactSheetColumns, 10\)/);
  assert.doesNotMatch(source, /Number\.parseInt\(contactSheetThumbnailSize, 10\)/);
  assert.doesNotMatch(source, /targetColorProfilePath: exportTargetColorProfile === "custom-icc"/);
  assert.doesNotMatch(source, /return \{\s*includeMetadata: exportIncludeMetadata,[\s\S]*?preserveColorProfile: exportPreserveColorProfile/);
});

run("Photos lightbox gestures use shared session helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const lightboxSessionSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxSession.ts"), "utf8");
  const imageEditsSource = fs.readFileSync(path.join(ROOT, "src/views/photoImageEdits.ts"), "utf8");
  assert.match(lightboxSessionSource, /export function lightboxGesturePoints\(/);
  assert.match(lightboxSessionSource, /export function lightboxGestureDistance\(/);
  assert.match(lightboxSessionSource, /export function lightboxGestureCenter\(/);
  assert.match(lightboxSessionSource, /export function lightboxPinchState\(/);
  assert.match(lightboxSessionSource, /export function lightboxPinchTransform\(/);
  assert.match(lightboxSessionSource, /export function lightboxDragPan\(/);
  assert.match(lightboxSessionSource, /export function lightboxImageSamplePointFromClient\(/);
  assert.match(imageEditsSource, /export function photoManualCropPointFromImageSample\(/);
  assert.match(imageEditsSource, /export function photoImageWhiteBalanceAdjustments\(/);
  assert.match(imageEditsSource, /export function photoImageRgbSampleFromPixels\(/);
  assert.match(imageEditsSource, /export function photoImageSampleRectAroundPoint\(/);
  assert.match(imageEditsSource, /export function photoImageAutoEnhanceSampleSize\(/);
  assert.match(source, /lightboxGesturePoints/);
  assert.match(source, /lightboxPinchState/);
  assert.match(source, /lightboxPinchTransform/);
  assert.match(source, /lightboxDragPan/);
  assert.match(source, /lightboxImageSamplePointFromClient/);
  assert.match(source, /photoManualCropPointFromImageSample/);
  assert.match(source, /photoImageWhiteBalanceAdjustments/);
  assert.match(source, /photoImageRgbSampleFromPixels/);
  assert.match(source, /photoImageSampleRectAroundPoint/);
  assert.match(source, /photoImageAutoEnhanceSampleSize/);
  assert.doesNotMatch(source, /function lightboxGestureDistance/);
  assert.doesNotMatch(source, /function lightboxGestureCenter/);

  const beginBlock = source.match(/function beginLightboxPinch\(\) \{[\s\S]*?\n  \}\n\n  function resetLightboxView/);
  assert.ok(beginBlock, "beginLightboxPinch should exist");
  assert.match(beginBlock[0], /const pinch = lightboxPinchState\(lightboxGesturePoints\(lightboxPointersRef\.current\.values\(\)\), lightboxZoom, lightboxPan\);/);
  assert.doesNotMatch(beginBlock[0], /startDistance:/);
  assert.doesNotMatch(beginBlock[0], /startCenterX:/);

  const moveBlock = source.match(/function onLightboxPointerMove\(event: ReactPointerEvent<HTMLDivElement>\) \{[\s\S]*?\n  \}\n\n  function endLightboxPointer/);
  assert.ok(moveBlock, "onLightboxPointerMove should exist");
  assert.match(moveBlock[0], /const transform = lightboxPinchTransform\(pinch, lightboxGesturePoints\(lightboxPointersRef\.current\.values\(\)\)\);/);
  assert.match(moveBlock[0], /setLightboxZoom\(transform\.zoom\);/);
  assert.match(moveBlock[0], /setLightboxPan\(transform\.pan\);/);
  assert.match(moveBlock[0], /setLightboxPan\(lightboxDragPan\(drag, \{ x: event\.clientX, y: event\.clientY \}\)\);/);
  assert.doesNotMatch(moveBlock[0], /pinch\.startZoom \* \(distance \/ pinch\.startDistance\)/);
  assert.doesNotMatch(moveBlock[0], /drag\.originX \+ event\.clientX - drag\.startX/);

  const imagePointBlock = source.match(/function lightboxImagePointFromClient\(clientX: number, clientY: number\): LightboxImageSamplePoint \| null \{[\s\S]*?\n  \}\n\n  \/\/ Safe Mode Stage-2/);
  assert.ok(imagePointBlock, "lightboxImagePointFromClient should exist");
  assert.match(imagePointBlock[0], /return lightboxImageSamplePointFromClient\(\{/);
  assert.match(imagePointBlock[0], /stageRect: rect/);
  assert.match(imagePointBlock[0], /mediaSize: \{ width: mediaWidth, height: mediaHeight \}/);
  assert.doesNotMatch(imagePointBlock[0], /const normalizedX =/);
  assert.doesNotMatch(imagePointBlock[0], /const renderedWidth =/);

  const cropPointBlock = source.match(/function lightboxImageCropPointFromClient\(clientX: number, clientY: number\): PhotoManualCropPoint \| null \{[\s\S]*?\n  \}\n\n  function beginImageManualCropOverlayDrag/);
  assert.ok(cropPointBlock, "lightboxImageCropPointFromClient should exist");
  assert.match(cropPointBlock[0], /return photoManualCropPointFromImageSample\(point, image\.naturalWidth, image\.naturalHeight\);/);
  assert.doesNotMatch(cropPointBlock[0], /Math\.round\(\(point\.x \/ Math\.max\(1, image\.naturalWidth - 1\)\) \* 1000\) \/ 10/);

  const whiteBalanceBlock = source.match(/function applyWhiteBalanceSample\(sample: PhotoImageRgbSample\) \{[\s\S]*?\n  \}\n\n  function sampleLightboxWhiteBalance/);
  assert.ok(whiteBalanceBlock, "applyWhiteBalanceSample should exist");
  assert.match(whiteBalanceBlock[0], /const next = photoImageWhiteBalanceAdjustments\(imageAdjustments, sample\);/);
  assert.doesNotMatch(whiteBalanceBlock[0], /warmthDelta/);
  assert.doesNotMatch(whiteBalanceBlock[0], /tintDelta/);

  const samplePointBlock = source.match(/function sampleLightboxImagePoint\(point: LightboxImageSamplePoint\): PhotoImageRgbSample \| null \{[\s\S]*?\n  \}\n\n  function photoImageAutoEnhanceStatsFromImageElement/);
  assert.ok(samplePointBlock, "sampleLightboxImagePoint should exist");
  assert.match(samplePointBlock[0], /const rect = photoImageSampleRectAroundPoint\(point, canvas\.width, canvas\.height\);/);
  assert.match(samplePointBlock[0], /context\.getImageData\(rect\.left, rect\.top, rect\.width, rect\.height\)/);
  assert.match(samplePointBlock[0], /return photoImageRgbSampleFromPixels\(pixels\);/);
  assert.doesNotMatch(samplePointBlock[0], /const left = Math\.max\(0, point\.x - 2\);/);
  assert.doesNotMatch(samplePointBlock[0], /const count = Math\.max\(1, pixels\.length \/ 4\);/);
  assert.doesNotMatch(samplePointBlock[0], /for \(let index = 0; index < pixels\.length; index \+= 4\)/);

  const autoEnhanceElementBlock = source.match(/function photoImageAutoEnhanceStatsFromImageElement\(image: HTMLImageElement \| null\) \{[\s\S]*?\n  \}\n\n  function loadPhotoImageForAutoEnhance/);
  assert.ok(autoEnhanceElementBlock, "photoImageAutoEnhanceStatsFromImageElement should exist");
  assert.match(autoEnhanceElementBlock[0], /const sampleSize = photoImageAutoEnhanceSampleSize\(image\.naturalWidth, image\.naturalHeight\);/);
  assert.match(autoEnhanceElementBlock[0], /const \{ width, height \} = sampleSize;/);
  assert.doesNotMatch(autoEnhanceElementBlock[0], /const maxDimension = 128;/);
  assert.doesNotMatch(autoEnhanceElementBlock[0], /image\.naturalWidth \* scale/);
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
  assert.match(source, /PHOTO_GRID_SEARCH_DEBOUNCE_MS/);
  assert.doesNotMatch(source, /const PHOTO_GRID_SEARCH_DEBOUNCE_MS = 220;/);
  assert.match(source, /const \[debouncedSearchQuery, setDebouncedSearchQuery\] = useState\(""\);/);
  assert.match(source, /window\.setTimeout\(\(\) => setDebouncedSearchQuery\(searchQuery\), PHOTO_GRID_SEARCH_DEBOUNCE_MS\)/);
  assert.match(source, /loadPage\(currentPageRequest\(\{ offset: 0, search: debouncedSearchQuery \}\)\);/);
  assert.match(source, /query: debouncedSearchQuery,/);
  assert.match(source, /loadPage\(currentPageRequest\(\{ offset: nextOffset\(\{ loaded: items\.length \}\), search: debouncedSearchQuery \}\)\);/);
  const autoGridEffect = source.match(/const previousDedicatedDestinationRef = useRef\(false\);\s*useEffect\(\(\) => \{[\s\S]*?\}, \[gridReloadSignature, clearLockedSensitiveItems, loadPage\]\);/);
  assert.ok(autoGridEffect, "automatic grid reload effect should exist");
  assert.ok(autoGridEffect[0].indexOf("if (showingDedicatedDestination)") < autoGridEffect[0].indexOf("setItems([])"));
  assert.doesNotMatch(autoGridEffect[0], /loadPage\(activeId, 0, sort, searchQuery,/);
});

run("Photos indexing success statuses stay out of metadata error channel", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const queuePanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoIndexingQueuePanel.tsx"), "utf8");
  const localIndexingStatusPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoLocalIndexingStatusPanel.tsx"), "utf8");
  assert.match(source, /const \[photoIndexingQueueNotice, setPhotoIndexingQueueNotice\] = useState\(""\);/);
  assert.match(source, /error=\{photoIndexingQueueError\}/);
  assert.match(source, /notice=\{photoIndexingQueueNotice\}/);
  assert.match(source, /text=\{photoIndexingQueueText\}/);
  assert.match(queuePanelSource, /const noteText = props\.error \|\| props\.notice \|\| props\.text;/);
  assert.match(queuePanelSource, /export function PhotoIndexingQueuePanel/);
  assert.match(source, /PhotoLocalIndexingStatusPanel/);
  assert.match(source, /photoLocalIndexingStatusSections/);
  assert.match(source, /PhotoIndexingQueuePanel/);
  assert.doesNotMatch(source, /photo-indexing-job-list/);
  assert.match(queuePanelSource, /photo-indexing-job-list/);
  assert.doesNotMatch(source, /photo-ocr-failure-list/);
  assert.match(localIndexingStatusPanelSource, /export function PhotoLocalIndexingStatusPanel/);
  assert.match(localIndexingStatusPanelSource, /photo-ocr-failure-list/);
  assert.match(localIndexingStatusPanelSource, /section\.failureRows\.map/);
  assert.match(localIndexingStatusPanelSource, /props\.fileName\(sourcePath\) \|\| props\.uiText\("Unknown photo"\)/);
  const indexingActionsBlock = source.slice(
    source.indexOf("async function enqueuePhotoLocalIndexingJob"),
    source.indexOf("  function updatePhotoBackupPolicy")
  );
  assert.ok(indexingActionsBlock.includes("async function runPhotoBarcodeIndex"), "indexing action block should include all local indexing actions");
  assert.match(indexingActionsBlock, /setPhotoIndexingQueueNotice\(\s*jobKind === "ocr"/);
  assert.match(indexingActionsBlock, /setPhotoIndexingQueueNotice\(`\$\{uiText\("Barcodes indexed"\)\}/);
  assert.doesNotMatch(indexingActionsBlock, /setMetadataError\(/);
});

run("Photos indexing auto-run is owned by the focus-aware main scheduler", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const mainSource = fs.readFileSync(path.join(ROOT, "desktop/main.cjs"), "utf8");
  assert.doesNotMatch(source, /photoIndexingAutoRunKeyRef/);
  assert.doesNotMatch(source, /runPhotoIndexingQueueBatch\(true\)/);
  assert.match(mainSource, /runPhotoIndexingHeadlessSchedulerTick/);
  assert.match(mainSource, /mainWindowIsForegroundActive\(\)/);
  assert.match(mainSource, /reason: "settings-deferred-while-foreground"/);
  assert.match(mainSource, /photoIndexingHeadlessRuntimePolicy\(localSettings\)/);
});

run("Photos defers optional startup reads until their surfaces need them", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const curationLoader = source.indexOf("const loadPhotoCurationPreferences = useCallback");
  const initialEffectStart = source.indexOf("  useEffect(() => {", curationLoader);
  const initialEffectEnd = source.indexOf("  useEffect(() => {", initialEffectStart + 1);
  assert.ok(curationLoader >= 0 && initialEffectStart > curationLoader && initialEffectEnd > initialEffectStart);
  const initialEffect = source.slice(initialEffectStart, initialEffectEnd);
  assert.match(initialEffect, /void loadFolders\(\)/);
  assert.match(initialEffect, /void loadSavedFilters\(\)/);
  assert.match(initialEffect, /void loadPhotoLibraryProfile\(\)/);
  assert.doesNotMatch(initialEffect, /loadPhotoOperations|loadPhotoCurationPreferences|loadPhotoSlideshow/);
  assert.match(source, /const railMode = options\.railMode \|\| "interactive";/);
  assert.match(source, /railMode,/);
  assert.match(source, /const ensureFolderEnrichment = useCallback\(async \(\) => \{/);
  assert.match(source, /railMode: "background",/);
  assert.match(source, /for \(let attempt = 0; attempt < 80 && !enriched\.enriched; attempt \+= 1\)/);
  assert.match(source, /railMode: "interactive",/);
  assert.match(source, /startTransition\(\(\) => \{/);
  assert.match(source, /requestIdleCallback\(prepareCollections, \{ timeout: 1_500 \}\)/);
  assert.match(source, /showingDedicatedDestination && \(activeId === "memories" \|\| activeId === "people"\)/);
  assert.doesNotMatch(source, /window\.addEventListener\("blur", scheduleEnrichment\)/);
  assert.match(source, /if \(res\.partial && sameScope\)/);
  assert.match(source, /\.\.\.current\.filter\(\(folder\) => !nextIds\.has\(folder\.id\)\)/);

  assert.match(source, /setTimeout\(\(\) => \{[\s\S]*?requestIdleCallback\(load, \{ timeout: 2_500 \}\)[\s\S]*?\}, 900\)/);
  assert.match(source, /const curationVisible = props\.initialActiveId === "memories"[\s\S]*?photoSettingsOpen;/);
  assert.match(source, /if \(!photoSlideshowStudioOpen && props\.initialActiveId !== "memories"\) return;/);
  assert.match(source, /onToggle=\{\(event\) => setPhotoSlideshowStudioOpen\(event\.currentTarget\.open\)\}/);

  const repairHistoryEffect = source.slice(source.indexOf("photoRepairHistory({ limit: 8 })") - 100, source.indexOf("photoRepairHistory({ limit: 8 })") + 700);
  assert.match(repairHistoryEffect, /if \(!photoSettingsOpen\) return;/);
});

run("Photos page reloads use object requests instead of positional filter args", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /function currentPageRequest\(overrides: Partial<PhotoPageLoadRequest> = \{\}\): PhotoPageLoadRequest/);
  assert.match(source, /const loadPage = useCallback\(async \(options: PhotoPageLoadRequest\) => \{/);
  assert.doesNotMatch(source, /legacyArgs/);
  assert.doesNotMatch(source, /PhotoPageLoadRequest \| string/);
  assert.doesNotMatch(source, /loadPage\(\s*(activeId|nextActiveId|nextId|"all"|`album:\$\{targetAlbumId\}`)\s*,/);
});

run("Photos grid page limit stays within the preview generation budget", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /PAGE_LIMIT/);
  assert.match(source, /PREVIEW_BUDGET/);
  assert.match(source, /limit: PAGE_LIMIT,\s*previewBudget: PREVIEW_BUDGET,/);
  assert.doesNotMatch(source, /const PAGE_LIMIT = 100;/);
  assert.doesNotMatch(source, /const PAGE_LIMIT = 64;/);
  assert.doesNotMatch(source, /const PREVIEW_BUDGET = /);
});

run("Photos grid thumbnails do not fall back to full-size originals", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const tileSource = fs.readFileSync(path.join(ROOT, "src/views/photoGridTile.tsx"), "utf8");
  const gridPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoVirtualGridPanel.tsx"), "utf8");
  assert.match(source, /import \{ PhotoVirtualGridPanel \} from "\.\/photoVirtualGridPanel"/);
  assert.doesNotMatch(source, /import \{ PhotoGridTile \} from "\.\/photoGridTile"/);
  assert.match(gridPanelSource, /import \{ PhotoGridTile \} from "\.\/photoGridTile"/);
  const tileBlock = tileSource.match(/export const PhotoGridTile = memo\(function PhotoGridTile[\s\S]*?\n\}\);/);
  assert.ok(tileBlock, "memoized photo grid tile should exist");
  assert.match(tileBlock[0], /const url = itemMissing \? "" : props\.item\.previewUrl \|\| "";/);
  assert.doesNotMatch(tileBlock[0], /props\.item\.previewUrl \|\| props\.item\.sourceUrl/);
  assert.doesNotMatch(tileBlock[0], /item\.previewUrl \|\| item\.sourceUrl/);
});

run("Photos grid tiles are memoized away from parent drag handler churn", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const tileSource = fs.readFileSync(path.join(ROOT, "src/views/photoGridTile.tsx"), "utf8");
  const gridPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoVirtualGridPanel.tsx"), "utf8");
  assert.match(source, /import \{ PhotoVirtualGridPanel \} from "\.\/photoVirtualGridPanel"/);
  assert.doesNotMatch(source, /import \{ PhotoGridTile \} from "\.\/photoGridTile"/);
  assert.match(gridPanelSource, /import \{ PhotoGridTile \} from "\.\/photoGridTile"/);
  assert.match(tileSource, /export const PhotoGridTile = memo\(function PhotoGridTile/);
  assert.doesNotMatch(source, /const PhotoGridTile = memo\(function PhotoGridTile/);
  assert.match(source, /const handlePhotoGridTileDragOver = useCallback/);
  assert.match(source, /const handlePhotoGridTileDrop = useCallback/);
  assert.match(source, /const selectedSourcesRef = useRef\(selectedSources\);/);
  assert.match(source, /const albumItemDragRef = useRef\(albumItemDrag\);/);
  assert.match(source, /<PhotoVirtualGridPanel[\s\S]*onDragEndTile=\{handlePhotoGridTileDragEnd\}/);
  const gridBlock = gridPanelSource.match(/virtualWindow\.visibleBands\.map\(\(band\) => \{[\s\S]*?<PhotoGridTile[\s\S]*?onDragEndTile=\{onDragEndTile\}[\s\S]*?\/>/);
  assert.ok(gridBlock, "virtualized photo grid should render memoized tiles");
  assert.doesNotMatch(gridBlock[0], /onDragStart=\{\(event\) =>/);
  assert.doesNotMatch(gridBlock[0], /onDragOver=\{\(event\) =>/);
  assert.doesNotMatch(gridBlock[0], /onDrop=\{\(event\) =>/);
  assert.doesNotMatch(gridBlock[0], /onContextMenu=\{\(event\) =>/);
  assert.doesNotMatch(gridBlock[0], /onClick=\{\(event\) =>/);
});

run("Photos slideshow playback overlay lives outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const overlaySource = fs.readFileSync(path.join(ROOT, "src/views/photoSlideshowOverlay.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoSlideshowOverlay", "Slideshow", "photoSlideshowOverlay");
  assert.match(source, /<PhotoSlideshowOverlay[\s\S]*item=\{slideshowItem\}[\s\S]*onStep=\{stepPhotoSlideshow\}[\s\S]*onJumpChapter=\{jumpPhotoSlideshowChapter\}/);
  assert.match(source, /videoMuted=\{shouldMuteAutoplayPhotoVideo\(effectivePhotoMediaSettings\)\}/);
  assert.doesNotMatch(source, /className=\{`photos-slideshow/);
  assert.doesNotMatch(source, /photos-slideshow-caption/);
  assert.match(overlaySource, /className=\{`photos-slideshow theme-\$\{playbackTheme\}/);
  assert.match(overlaySource, /photos-slideshow-caption/);
  assert.match(overlaySource, /uiText\("Close slideshow"\)/);
  assert.match(overlaySource, /uiText\("Previous slide"\)/);
  assert.match(overlaySource, /uiText\("Next slide"\)/);
  assert.match(overlaySource, /uiText\("Memory chapters"\)/);
  assert.match(overlaySource, /onStep\("previous"\)/);
  assert.match(overlaySource, /onStep\("next"\)/);
  assert.match(overlaySource, /onTogglePlaying/);
  assert.match(overlaySource, /onToggleAudioMuted/);
  assert.match(overlaySource, /onIntervalChange\(Number\(event\.currentTarget\.value\)\)/);
  assert.match(overlaySource, /onToggleFitMode/);
});

run("photo scroll container helper finds nearest scrollable parent", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const scrollSource = fs.readFileSync(path.join(ROOT, "src/views/photoScrollContainer.ts"), "utf8");
  const originalWindow = global.window;
  assert.strictEqual(scrollContainerMod.nearestPhotoScrollContainer(null), null);
  const fakeWindow = {
    getComputedStyle: (node) => ({ overflowY: node.overflowY || "visible" }),
  };
  const outer = { parentElement: null, scrollHeight: 1000, clientHeight: 400, overflowY: "visible" };
  const inner = { parentElement: outer, scrollHeight: 80, clientHeight: 100, overflowY: "visible" };
  const leaf = { parentElement: inner };
  global.window = fakeWindow;
  try {
    assert.strictEqual(scrollContainerMod.nearestPhotoScrollContainer(leaf), fakeWindow);
    outer.overflowY = "scroll";
    assert.strictEqual(scrollContainerMod.nearestPhotoScrollContainer(leaf), outer);
    inner.overflowY = "auto";
    assert.strictEqual(scrollContainerMod.nearestPhotoScrollContainer(leaf), inner);
    inner.overflowY = "overlay";
    assert.strictEqual(scrollContainerMod.nearestPhotoScrollContainer(leaf), inner);
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
  assert.match(photosViewSource, /import \{ nearestPhotoScrollContainer \} from "\.\/photoScrollContainer"/);
  assert.doesNotMatch(photosViewSource, /function nearestPhotoScrollContainer/);
  assert.match(scrollSource, /export function nearestPhotoScrollContainer/);
});

run("photo context menu helper clamps menus inside the viewport", () => {
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const contextMenuSource = fs.readFileSync(path.join(ROOT, "src/views/photoContextMenu.ts"), "utf8");
  const originalWindow = global.window;
  if (originalWindow === undefined) delete global.window;
  try {
    assert.deepStrictEqual(contextMenuMod.photoContextMenuPosition(20, 30), { x: 20, y: 30 });
    global.window = { innerWidth: 500, innerHeight: 500 };
    assert.deepStrictEqual(contextMenuMod.photoContextMenuPosition(999, 999), { x: 244, y: 128 });
    assert.deepStrictEqual(contextMenuMod.photoContextMenuPosition(0, 0), { x: 12, y: 12 });
    assert.deepStrictEqual(contextMenuMod.photoContextMenuPosition(200, 100), { x: 200, y: 100 });
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
  assert.match(photosViewSource, /from "\.\/photoContextMenu"/);
  assert.match(photosViewSource, /type PhotoContextMenuItem/);
  assert.match(photosViewSource, /type PhotoContextMenuState/);
  assert.doesNotMatch(photosViewSource, /function photoContextMenuPosition/);
  assert.doesNotMatch(photosViewSource, /type PhotoContextMenuState =/);
  assert.match(contextMenuSource, /export function photoContextMenuPosition/);
  assert.match(contextMenuSource, /export type PhotoContextMenuState/);
});

run("Photos video time updates stay out of parent render state", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const stageSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxStage.tsx"), "utf8");
  const actionBarSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxVideoActionBar.tsx"), "utf8");
  const controlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxVideoControls.tsx"), "utf8");
  assert.match(source, /from "\.\/photoLightboxVideoControls"/);
  assertDeferredPhotoSurface(source, "PhotoLightboxVideoActionBar", "Lightbox", "photoLightboxVideoActionBar");
  assertDeferredPhotoSurface(source, "PhotoLightboxStage", "Lightbox", "photoLightboxStage");
  assert.match(source, /PhotoLightboxVideoActionBar/);
  assert.match(source, /PhotoLightboxStage/);
  assert.match(source, /photoVideoCurrentMs/);
  assert.match(source, /photoVideoDurationMs/);
  assert.match(actionBarSource, /export function PhotoLightboxVideoActionBar/);
  assert.match(actionBarSource, /PhotoLightboxVideoControls/);
  assert.match(actionBarSource, /photos-lightbox-video-controls/);
  assert.doesNotMatch(source, /photos-lightbox-video-controls/);
  assert.match(actionBarSource, /uiText\("Export motion"\)/);
  assert.match(actionBarSource, /uiText\("Video trim timeline"\)/);
  assert.match(actionBarSource, /uiText\("Video poster policy"\)/);
  assert.doesNotMatch(source, /uiText\("Export motion"\)/);
  assert.doesNotMatch(source, /uiText\("Video trim timeline"\)/);
  assert.doesNotMatch(source, /uiText\("Video poster policy"\)/);
  assert.match(controlsSource, /export const PhotoLightboxVideoControls = memo\(function PhotoLightboxVideoControls/);
  assert.doesNotMatch(source, /const PhotoLightboxVideoControls = memo\(function PhotoLightboxVideoControls/);
  assert.strictEqual(lightboxVideoControlsMod.photoVideoCurrentMs({ currentTime: 1.234 }), 1234);
  assert.strictEqual(lightboxVideoControlsMod.photoVideoCurrentMs({ currentTime: Number.NaN }), 0);
  assert.strictEqual(lightboxVideoControlsMod.photoVideoDurationMs({ duration: 62.5 }), 62500);
  assert.strictEqual(lightboxVideoControlsMod.photoVideoDurationMs({ duration: -1 }), 0);
  assert.match(source, /const lightboxVideoCurrentMsRef = useRef\(0\);/);
  assert.match(controlsSource, /video\.addEventListener\("timeupdate", onTimeUpdate\)/);
  assert.match(controlsSource, /PHOTO_VIDEO_TIME_UI_THROTTLE_MS/);
  assert.match(source, /onCaptureVideoPosition=\{captureLightboxVideoPosition\}/);
  assert.match(stageSource, /onTimeUpdate=\{\(event\) => onCaptureVideoPosition\(event\.currentTarget\)\}/);
  assert.doesNotMatch(source, /const \[lightboxVideoCurrentMs, setLightboxVideoCurrentMs\]/);
  assert.doesNotMatch(source, /setLightboxVideoCurrentMs/);
  assert.doesNotMatch(stageSource, /onTimeUpdate=\{\(event\) => onSyncVideoState\(event\.currentTarget\)\}/);
  assert.match(source, /const lightboxKeyHandlerRef = useRef<\(\(event: KeyboardEvent\) => void\) \| null>\(null\);/);
  const keydownHandler = source.match(/lightboxKeyHandlerRef\.current = \(event: KeyboardEvent\) => \{[\s\S]*?\n  \};\n\n  useEffect\(\(\) => \{\n    const onKey = \(event: KeyboardEvent\) => \{/);
  assert.ok(keydownHandler, "lightbox keydown handler ref should exist");
  assert.doesNotMatch(keydownHandler[0], /lightboxVideoCurrentMs/);
  const keydownEffect = source.match(/useEffect\(\(\) => \{\n    const onKey = \(event: KeyboardEvent\) => \{\n      lightboxKeyHandlerRef\.current\?\.\(event\);\n    \};\n    window\.addEventListener\("keydown", onKey\);\n    return \(\) => window\.removeEventListener\("keydown", onKey\);\n  \}, \[\]\);/);
  assert.ok(keydownEffect, "lightbox keydown listener should be stable");
  assert.doesNotMatch(keydownEffect[0], /lightItem|items|imageMarkupAnnotationsDraft|imageRetouchSpotsDraft/);
});

run("Photos lightbox zoom controls live outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const zoomControlsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxZoomControls.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoLightboxZoomControls", "Lightbox", "photoLightboxZoomControls");
  assert.match(source, /<PhotoLightboxZoomControls[\s\S]*zoom=\{lightboxZoom\}[\s\S]*onToggleFullscreen=\{toggleLightboxFullscreen\}[\s\S]*onReset=\{resetLightboxView\}/);
  assert.doesNotMatch(source, /photos-lightbox-zoom-controls/);
  assert.doesNotMatch(source, /uiText\("Zoom photos"\)/);
  assert.match(zoomControlsSource, /export function PhotoLightboxZoomControls/);
  assert.match(zoomControlsSource, /photos-lightbox-zoom-controls/);
  assert.match(zoomControlsSource, /uiText\("Zoom photos"\)/);
  assert.match(zoomControlsSource, /uiText\("Reset zoom"\)/);
  assert.match(zoomControlsSource, /uiText\("Fullscreen"\)/);
});

run("Photos lightbox primary actions live outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const primaryActionsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxPrimaryActions.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoLightboxPrimaryActions", "Lightbox", "photoLightboxPrimaryActions");
  assert.match(source, /<PhotoLightboxPrimaryActions[\s\S]*item=\{lightItem\}[\s\S]*onExportSubjectCutout=\{exportLightboxSubjectCutout\}[\s\S]*onExportPortraitBlur=\{exportLightboxPortraitBlur\}/);
  assert.doesNotMatch(source, /photos-subject-cutout-actions/);
  assert.doesNotMatch(source, /uiText\("Export subject cutout PNG"\)/);
  assert.doesNotMatch(source, /uiText\("Copy subject cutout PNG"\)/);
  assert.match(primaryActionsSource, /export function PhotoLightboxPrimaryActions/);
  assert.match(primaryActionsSource, /photos-subject-cutout-actions/);
  assert.match(primaryActionsSource, /uiText\("Export subject cutout PNG"\)/);
  assert.match(primaryActionsSource, /uiText\("Copy subject cutout PNG"\)/);
  assert.match(primaryActionsSource, /uiText\("Portrait blur"\)/);
});

run("Photos lightbox edit stack history lives outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const historySource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxEditStackHistory.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoLightboxEditStackHistory", "Lightbox", "photoLightboxEditStackHistory");
  assert.match(source, /<PhotoLightboxEditStackHistory[\s\S]*editStack=\{photoEditStack\}[\s\S]*versions=\{photoEditStackVersions\}[\s\S]*onRestoreVersion=\{restoreSelectedPhotoEditStackVersion\}[\s\S]*onDeleteVersion=\{deleteSelectedPhotoEditStackVersion\}/);
  assert.doesNotMatch(source, /photos-edit-operation-history/);
  assert.doesNotMatch(source, /photos-edit-version-history/);
  assert.doesNotMatch(source, /uiText\("Edit stack versions"\)/);
  assert.doesNotMatch(source, /uiText\("Restore edit version"\)/);
  assert.doesNotMatch(source, /uiText\("Delete edit version"\)/);
  assert.match(historySource, /export function PhotoLightboxEditStackHistory/);
  assert.match(historySource, /photoEditStackOperationHistoryRows/);
  assert.match(historySource, /photoEditStackVersionHistoryRows/);
  assert.match(historySource, /compactPhotoEditStackId/);
  assert.match(historySource, /photos-edit-operation-history/);
  assert.match(historySource, /photos-edit-version-history/);
  assert.match(historySource, /uiText\("Edit stack versions"\)/);
  assert.match(historySource, /uiText\("Restore edit version"\)/);
  assert.match(historySource, /uiText\("Delete edit version"\)/);
});

run("Photos lightbox file actions live outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const fileActionsSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxFileActions.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoLightboxFileActions", "Lightbox", "photoLightboxFileActions");
  assert.match(source, /<PhotoLightboxFileActions[\s\S]*item=\{lightItem\}[\s\S]*onOpenWithEditor=\{openOriginalWithEditor\}[\s\S]*onConsolidate=\{consolidatePhotoOriginals\}/);
  assert.doesNotMatch(source, /photos-lightbox-file-actions/);
  assert.match(fileActionsSource, /export function PhotoLightboxFileActions/);
  assert.match(fileActionsSource, /photos-lightbox-file-actions/);
  assert.match(fileActionsSource, /uiText\("Reveal original"\)/);
  assert.match(fileActionsSource, /uiText\("Open original"\)/);
  assert.match(fileActionsSource, /uiText\("Print original"\)/);
  assert.match(fileActionsSource, /uiText\("Open with\.\.\."\)/);
  assert.match(fileActionsSource, /uiText\("Open with last"\)/);
  assert.match(fileActionsSource, /uiText\("Consolidate"\)/);
});

run("Photos lightbox curation and safety actions live outside PhotosView", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const curationSource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxCurationActions.tsx"), "utf8");
  const safetySource = fs.readFileSync(path.join(ROOT, "src/views/photoLightboxSafetyActions.tsx"), "utf8");
  assertDeferredPhotoSurface(source, "PhotoLightboxCurationActions", "Lightbox", "photoLightboxCurationActions");
  assertDeferredPhotoSurface(source, "PhotoLightboxSafetyActions", "Lightbox", "photoLightboxSafetyActions");
  assert.match(source, /<PhotoLightboxCurationActions[\s\S]*suggestions=\{lightItemFeatureLessSuggestions\}[\s\S]*onRemoveFromMemory=\{removeSourcesFromActiveMemory\}[\s\S]*onToggleFeatureLessSuggestion=\{togglePhotoFeatureLessSuggestion\}/);
  assert.match(source, /<PhotoLightboxSafetyActions[\s\S]*item=\{lightItem\}[\s\S]*onPermanentlyDelete=\{permanentlyDeletePhoto\}[\s\S]*onDelete=\{deletePhoto\}/);
  assert.doesNotMatch(source, /photos-lightbox-curation-actions/);
  assert.doesNotMatch(source, /photos-lightbox-safety-actions/);
  assert.match(curationSource, /export function PhotoLightboxCurationActions/);
  assert.match(curationSource, /photos-lightbox-curation-actions/);
  assert.match(curationSource, /uiText\("Remove from memory"\)/);
  assert.match(curationSource, /uiText\("Feature less"\)/);
  assert.match(safetySource, /export function PhotoLightboxSafetyActions/);
  assert.match(safetySource, /photos-lightbox-safety-actions/);
  assert.match(safetySource, /uiText\("Delete permanently"\)/);
  assert.match(safetySource, /uiText\("Hide"\)/);
});

run("Photos bulk favorite shortcut uses batch metadata update", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const block = source.match(/async function toggleSelectedFavorites\(\) \{[\s\S]*?\n  \}\n\n  async function hideSelectedShortcut/);
  assert.ok(block, "toggleSelectedFavorites should exist");
  assert.match(block[0], /photoInfoFavoriteBatchUpdates\(selectedItems\)/);
  assert.match(block[0], /await updatePhotoAssetsMetadata\(\{/);
  assert.match(block[0], /items: favoriteBatch\.updates/);
  assert.match(block[0], /photoInfoApplyFavoriteBatchResult\(current, selectedItems, result\.value \|\| \{\}, favoriteBatch\.favorite\)/);
  assert.match(block[0], /await loadPhotoOperations\(\)/);
  assert.doesNotMatch(block[0], /for \(const item of selectedItems\)/);
  assert.doesNotMatch(block[0], /items: selectedItems\.map\(\(item\) => photoMetadataUpdatePayload\(item, \{/);
  assert.doesNotMatch(block[0], /result\.value\?\.items/);
  assert.doesNotMatch(block[0], /const favoriteBySource = new Map<string, boolean>/);
  assert.doesNotMatch(block[0], /updatePhotoAssetMetadata\(\{/);
  assert.doesNotMatch(block[0], /sourcePath: item\.sourcePath,\s*assetId: item\.assetId/);
});

run("Photos keyword shortcuts use one batch metadata IPC", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const block = source.match(/async function applyKeywordShortcut\(keyword: PhotoKeyword\) \{[\s\S]*?\n  \}\n\n  async function mergeSelectedDuplicateGroups/);
  assert.ok(block, "applyKeywordShortcut should exist");
  assert.match(block[0], /photoInfoKeywordShortcutUpdates\(targetItems, keywordName\)/);
  assert.match(block[0], /await updatePhotoAssetsMetadata\(\{/);
  assert.match(block[0], /items: updates/);
  assert.match(block[0], /await loadPhotoOperations\(\)/);
  assert.doesNotMatch(block[0], /for \(const item of targetItems\)/);
  assert.doesNotMatch(block[0], /updates\.push\(photoMetadataUpdatePayload\(item, \{/);
  assert.doesNotMatch(block[0], /await updatePhotoAssetMetadata\(\{/);
  assert.doesNotMatch(block[0], /sourcePath: item\.sourcePath,\s*assetId: item\.assetId/);
});

run("Photos pet review selected actions use bulk backend commands", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const apiSource = fs.readFileSync(path.join(ROOT, "crossage_fr/api_server.py"), "utf8");
  const preloadSource = fs.readFileSync(path.join(ROOT, "desktop/preload.cjs"), "utf8");
  const mainSource = fs.readFileSync(path.join(ROOT, "desktop/main.cjs"), "utf8");

  assert.match(source, /bulkAssignPhotoPet: \(params: Record<string, unknown>\) => Promise/);
  assert.match(source, /bulkDismissPhotoPetReview: \(params: Record<string, unknown>\) => Promise/);
  assert.match(appSource, /"bulk_assign_photo_pet"/);
  assert.match(appSource, /"bulk_dismiss_photo_pet_review"/);
  assert.match(apiSource, /"bulk_assign_photo_pet": "_cmd_bulk_assign_photo_pet"/);
  assert.match(apiSource, /"bulk_dismiss_photo_pet_review": "_cmd_bulk_dismiss_photo_pet_review"/);
  assert.match(preloadSource, /"bulk_assign_photo_pet"/);
  assert.match(preloadSource, /"bulk_dismiss_photo_pet_review"/);
  assert.match(mainSource, /"bulk_assign_photo_pet"/);
  assert.match(mainSource, /"bulk_dismiss_photo_pet_review"/);

  const assignBlock = source.match(/async function assignSelectedPetReviewItems\(\) \{[\s\S]*?\n  \}\n\n  async function dismissSelectedPetReviewItems/);
  assert.ok(assignBlock, "assignSelectedPetReviewItems should exist");
  assert.match(assignBlock[0], /await bulkAssignPhotoPet\(photoPetBulkAssignPayload\(selectedItems, petName\)\)/);
  assert.doesNotMatch(assignBlock[0], /for \(const item of selectedItems\)/);
  assert.doesNotMatch(assignBlock[0], /items: selectedItems\.map\(\(item\) => \(\{/);
  assert.doesNotMatch(assignBlock[0], /await assignPhotoPet\(\{/);

  const dismissBlock = source.match(/async function dismissSelectedPetReviewItems\(\) \{[\s\S]*?\n  \}\n\n  async function savePeopleGroupPatch/);
  assert.ok(dismissBlock, "dismissSelectedPetReviewItems should exist");
  assert.match(dismissBlock[0], /await bulkDismissPhotoPetReview\(photoPetBulkDismissPayload\(selectedItems, petReviewKindFilter \|\| ""\)\)/);
  assert.doesNotMatch(dismissBlock[0], /for \(const item of selectedItems\)/);
  assert.doesNotMatch(dismissBlock[0], /items: selectedItems\.map\(\(item\) => \(\{/);
  assert.doesNotMatch(dismissBlock[0], /await dismissPhotoPetReview\(\{/);
});

run("Photos selected match corrections use bulk backend commands", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const apiSource = fs.readFileSync(path.join(ROOT, "crossage_fr/api_server.py"), "utf8");
  const managerSource = fs.readFileSync(path.join(ROOT, "crossage_fr/enroll/manager.py"), "utf8");

  assert.match(source, /bulkBlockFalseMatches: \(candidateIds: string\[\], options\?: \{ confirm\?: boolean \}\) => void \| Promise<void>;/);
  assert.match(source, /bulkReassignCandidatePerson: \(candidateIds: string\[\], personName: string\) => void \| Promise<void>;/);
  assert.match(appSource, /"bulk_block_false_matches"/);
  assert.match(appSource, /"bulk_reassign_candidate_person"/);
  assert.match(apiSource, /"bulk_block_false_matches": "_cmd_bulk_block_false_matches"/);
  assert.match(apiSource, /"bulk_reassign_candidate_person": "_cmd_bulk_reassign_candidate_person"/);
  assert.match(managerSource, /def bulk_block_false_matches\(self, candidate_ids: list\[str\], note: str = ""\) -> dict\[str, Any\]:/);
  assert.match(managerSource, /def bulk_reassign_candidate_person\(/);

  const reassignBlock = source.match(/async function reassignSelectedMatches\(\) \{[\s\S]*?\n  \}\n\n  async function removeSelectedMatches/);
  assert.ok(reassignBlock, "reassignSelectedMatches should exist");
  assert.match(reassignBlock[0], /await bulkReassignCandidatePerson\(ids, target\);/);
  assert.doesNotMatch(reassignBlock[0], /for \(const candidateId of ids\)/);
  assert.doesNotMatch(reassignBlock[0], /await reassignCandidatePerson\(candidateId, target\)/);

  const removeBlock = source.match(/async function removeSelectedMatches\(\) \{[\s\S]*?\n  \}\n\n  async function addSelectedToManualAlbum/);
  assert.ok(removeBlock, "removeSelectedMatches should exist");
  assert.match(removeBlock[0], /await bulkBlockFalseMatches\(ids, \{ confirm: false \}\);/);
  assert.doesNotMatch(removeBlock[0], /for \(const candidateId of ids\)/);
  assert.doesNotMatch(removeBlock[0], /await blockFalseMatch\(candidateId, \{ confirm: false \}\)/);
});

run("Photos manual album adds use shared payload draft helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  assert.match(editorSource, /export function photoManualAlbumAddDraft\(/);
  assert.match(source, /photoManualAlbumAddDraft/);

  const addSelectedBlock = source.match(/async function addSelectedToManualAlbum\(\) \{[\s\S]*?\n  \}\n\n  async function removeSelectedFromManualAlbum/);
  assert.ok(addSelectedBlock, "addSelectedToManualAlbum should exist");
  assert.match(addSelectedBlock[0], /const albumDraft = photoManualAlbumAddDraft\(\{/);
  assert.match(addSelectedBlock[0], /await savePhotoAlbum\(albumDraft\.createAlbum\)/);
  assert.match(addSelectedBlock[0], /sourcePaths: albumDraft\.sourcePaths/);
  assert.doesNotMatch(addSelectedBlock[0], /const name = manualAlbumName\.trim/);
  assert.doesNotMatch(addSelectedBlock[0], /coverSourcePath: selectedSourcePaths\[0\]/);

  const addLightboxBlock = source.match(/async function addLightboxItemToManualAlbum\(item: PhotoItem\) \{[\s\S]*?\n  \}\n\n  async function removeLightboxItemFromManualAlbum/);
  assert.ok(addLightboxBlock, "addLightboxItemToManualAlbum should exist");
  assert.match(addLightboxBlock[0], /const albumDraft = photoManualAlbumAddDraft\(\{/);
  assert.match(addLightboxBlock[0], /await savePhotoAlbum\(albumDraft\.createAlbum\)/);
  assert.match(addLightboxBlock[0], /sourcePaths: albumDraft\.sourcePaths/);
  assert.doesNotMatch(addLightboxBlock[0], /const name = lightboxAlbumName\.trim/);
  assert.doesNotMatch(addLightboxBlock[0], /coverSourcePath: item\.sourcePath/);
});

run("Photos album editor save and preview use shared payload draft helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  assert.match(editorSource, /export function photoAlbumEditorPayloadDraft\(/);
  assert.match(source, /photoAlbumEditorPayloadDraft/);

  const previewBlock = source.match(/useEffect\(\(\) => \{\s*const hasPreviewCriteria[\s\S]*?\}, \[[^\]]*props\.previewPhotoAlbumRules\]\);/);
  assert.ok(previewBlock, "album rule preview effect should exist");
  assert.match(previewBlock[0], /const previewDraft = photoAlbumEditorPayloadDraft\(\{/);
  assert.match(previewBlock[0], /requireName: false,/);
  assert.match(previewBlock[0], /trimName: false,/);
  assert.match(previewBlock[0], /props\.previewPhotoAlbumRules\(previewDraft\)/);
  assert.doesNotMatch(previewBlock[0], /rules: cleanPhotoAlbumRules\(albumRules\)/);
  assert.doesNotMatch(previewBlock[0], /coverSourcePath: activeAlbum\?\.coverSourcePath/);

  const saveAlbumBlock = source.match(/async function saveAlbum\(coverSourcePath\?: string\) \{[\s\S]*?\n  \}\n\n  async function undoDeleteAlbum/);
  assert.ok(saveAlbumBlock, "saveAlbum should exist");
  assert.match(saveAlbumBlock[0], /const albumDraft = photoAlbumEditorPayloadDraft\(\{/);
  assert.match(saveAlbumBlock[0], /await savePhotoAlbum\(albumDraft\)/);
  assert.match(saveAlbumBlock[0], /\$\{albumDraft\.name\}/);
  assert.doesNotMatch(saveAlbumBlock[0], /const name = albumName\.trim/);
  assert.doesNotMatch(saveAlbumBlock[0], /rules: cleanPhotoAlbumRules\(albumRules\)/);
  assert.doesNotMatch(saveAlbumBlock[0], /coverSourcePath: coverSourcePath \?\? activeAlbum\?\.coverSourcePath/);
});

run("Photos library creation suggestions use bounded cached candidates", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /PHOTO_CREATION_LIBRARY_CANDIDATE_LIMIT/);
  assert.doesNotMatch(source, /const PHOTO_CREATION_LIBRARY_CANDIDATE_LIMIT = 500;/);

  const loaderBlock = source.match(/async function loadLibraryCreationSuggestionCandidates\(\): Promise<\{ items: PhotoItem\[\]; total: number \}> \{[\s\S]*?\n  \}\n\n  async function refreshPhotoCreationSuggestions/);
  assert.ok(loaderBlock, "bounded library creation-suggestion loader should exist");
  assert.doesNotMatch(loaderBlock[0], /while\s*\(/);
  assert.match(loaderBlock[0], /limit: PHOTO_CREATION_LIBRARY_CANDIDATE_LIMIT/);
  assert.match(loaderBlock[0], /sort: "quality"/);
  assert.match(loaderBlock[0], /mediaKind: "image"/);

  const refreshBlock = source.match(/async function refreshPhotoLibraryCreationSuggestions\(\) \{[\s\S]*?\n  \}\n\n  async function loadPhotoSlideshowProjectItems/);
  assert.ok(refreshBlock, "library creation-suggestion refresh should exist");
  assert.match(refreshBlock[0], /const \{ items: candidateItems, total: candidateTotal \} = await loadLibraryCreationSuggestionCandidates\(\);/);
  assert.strictEqual((refreshBlock[0].match(/buildPhotoCreationExportSuggestions/g) || []).length, 1);
  assert.match(refreshBlock[0], /candidateCount: candidateItems\.length/);
  assert.match(refreshBlock[0], /setCreationSuggestionItems\(\[\]\);/);
  assert.match(refreshBlock[0], /setCreationSuggestionScope\(cache\?\.suggestions\.length \? "library-cache" : "loaded"\);/);
  assert.doesNotMatch(refreshBlock[0], /setCreationSuggestionItems\(candidateItems\)/);
  assert.doesNotMatch(refreshBlock[0], /memoryContextSourcePaths/);

  const backgroundBlock = source.match(/loadLibraryCreationSuggestionCandidates\(\)\s*\.then\(\(\{ items: candidateItems, total: candidateTotal \}\) => \{[\s\S]*?storePhotoCreationSuggestionCache\(PHOTO_CREATION_SUGGESTIONS_CACHE_KEY, cache\);/);
  assert.ok(backgroundBlock, "background creation-suggestion cache should use bounded candidates");
  assert.strictEqual((backgroundBlock[0].match(/buildPhotoCreationExportSuggestions/g) || []).length, 1);
  assert.match(backgroundBlock[0], /candidateCount: candidateItems\.length/);
  assert.doesNotMatch(backgroundBlock[0], /loadLibraryCreationSuggestionItems/);
});

run("Photos slideshow shortcuts stay bounded to loaded view items", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const loaderBlock = source.match(/async function loadCurrentSlideshowItems\(\): Promise<PhotoItem\[\]> \{[\s\S]*?\n  \}\n\n  async function loadLibraryCreationSuggestionCandidates/);
  assert.ok(loaderBlock, "current-view slideshow loader should exist");
  assert.match(loaderBlock[0], /return items;/);
  assert.doesNotMatch(loaderBlock[0], /while\s*\(/);
  assert.doesNotMatch(loaderBlock[0], /itemsFnRef\.current/);
  assert.doesNotMatch(loaderBlock[0], /MANUAL_ALBUM_ORDER_PAGE_LIMIT/);
  assert.doesNotMatch(loaderBlock[0], /detectMissingOriginals/);

  const startBlock = source.match(/async function startPhotoSlideshow\(preferredSourcePath = "", project\?: PhotoSlideshowProject\) \{[\s\S]*?\n  \}\n\n  function closePhotoSlideshow/);
  assert.ok(startBlock, "startPhotoSlideshow should exist");
  assert.match(startBlock[0], /project \? await loadPhotoSlideshowProjectItems\(project\) : selectedSources\.size \? items : await loadCurrentSlideshowItems\(\)/);
});

run("Photos manual album and memory reorders load source order directly", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const preloadSource = fs.readFileSync(path.join(ROOT, "desktop/preload.cjs"), "utf8");
  const mainSource = fs.readFileSync(path.join(ROOT, "desktop/main.cjs"), "utf8");
  const apiSource = fs.readFileSync(path.join(ROOT, "crossage_fr/api_server.py"), "utf8");

  assert.doesNotMatch(source, /MANUAL_ALBUM_ORDER_PAGE_LIMIT/);
  assert.match(appSource, /"photo_album_source_order"/);
  assert.match(appSource, /"photo_user_memory_source_order"/);
  assert.match(preloadSource, /"photo_album_source_order"/);
  assert.match(preloadSource, /"photo_user_memory_source_order"/);
  assert.match(mainSource, /"photo_album_source_order"/);
  assert.match(mainSource, /"photo_user_memory_source_order"/);
  assert.match(apiSource, /"photo_album_source_order": "_cmd_photo_album_source_order"/);
  assert.match(apiSource, /"photo_user_memory_source_order": "_cmd_photo_user_memory_source_order"/);

  const albumLoaderBlock = source.match(/async function loadAlbumSourceOrderById\(albumId: string, orderSort: PhotoSort = "manual"\) \{[\s\S]*?\n  \}\n\n  async function loadManualAlbumSourceOrder/);
  assert.ok(albumLoaderBlock, "album source-order loader should exist");
  assert.match(albumLoaderBlock[0], /if \(orderSort === "manual"\) \{/);
  assert.match(albumLoaderBlock[0], /await photoAlbumSourceOrder\(\{ albumId: cleanAlbumId \}\)/);
  assert.match(albumLoaderBlock[0], /return loadSortedFolderSourceOrder\(/);
  assert.doesNotMatch(albumLoaderBlock[0], /itemsFnRef\.current/);

  const manualAlbumBlock = source.match(/async function loadManualAlbumSourceOrder\(orderSort: PhotoSort = "manual"\) \{[\s\S]*?\n  \}\n\n  async function loadUserMemorySourceOrder/);
  assert.ok(manualAlbumBlock, "manual album order helper should exist");
  assert.match(manualAlbumBlock[0], /orderSort !== "manual"/);
  assert.doesNotMatch(manualAlbumBlock[0], /itemsFnRef\.current/);

  const memoryLoaderBlock = source.match(/async function loadUserMemorySourceOrder\(orderSort: PhotoSort = "manual"\) \{[\s\S]*?\n  \}\n\n  async function saveUserMemorySourceOrder/);
  assert.ok(memoryLoaderBlock, "user memory source-order loader should exist");
  assert.match(memoryLoaderBlock[0], /if \(orderSort === "manual"\) \{/);
  assert.match(memoryLoaderBlock[0], /await photoUserMemorySourceOrder\(\{ memoryId: activeMemoryId \}\)/);
  assert.match(memoryLoaderBlock[0], /return loadSortedFolderSourceOrder\(activeId, orderSort/);
  assert.doesNotMatch(memoryLoaderBlock[0], /itemsFnRef\.current/);

  const sortedFallbackBlock = source.match(/async function loadSortedFolderSourceOrder\(folderId: string, orderSort: PhotoSort, missingMessage: string\) \{[\s\S]*?\n  \}\n\n  async function loadAlbumSourceOrderById/);
  assert.ok(sortedFallbackBlock, "sorted fallback loader should exist for Save current sort");
  assert.match(sortedFallbackBlock[0], /limit: SORTED_SOURCE_ORDER_PAGE_LIMIT/);
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
  assert.match(adjustmentBlock[0], /photoImagePasteResultMessage\("adjustments", pasted, replaced, failed, \{ \.\.\.imagePasteTextOptions, skipped \}\)/);
  assert.doesNotMatch(adjustmentBlock[0], /await getPhotoEditStack\(\{/);
  assert.doesNotMatch(adjustmentBlock[0], /await savePhotoEditStack\(\{/);
  assert.doesNotMatch(adjustmentBlock[0], /for \(const \[index, plan\] of plans\.entries\(\)\)/);
  assert.doesNotMatch(adjustmentBlock[0], /const skippedLabel = skipped \? ` \$\{uiText\("Skipped"\)\} \$\{formatCount\(skipped\)\}\.`/);
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
  const dateBucketPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoDateBucketPanel.tsx"), "utf8");
  assert.match(source, /const activeDateBucketScopeSignature = \[/);
  assert.match(source, /const gridReloadSignature = \[/);
  assert.match(source, /const dateBucketRequestSignature = \[/);
  assert.match(source, /const gridPaginationSignature = \[/);
  assert.match(source, /const activeDateBucketScopeSignatureRef = useRef\(""\);/);
  assert.match(source, /function selectActiveDateBucket\(bucketKey: string\) \{/);
  assert.match(source, /activeDateBucketScopeSignatureRef\.current = cleanBucketKey \? activeDateBucketScopeSignature : "";/);
  assert.match(source, /onSelectBucket=\{selectActiveDateBucket\}/);
  assert.match(dateBucketPanelSource, /onClick=\{\(\) => onSelectBucket\(bucket\.key\)\}/);
  assert.doesNotMatch(source, /onClick=\{\(\) => setActiveDateBucketKey\(bucket\.key\)\}/);
  const gridReloadEffect = source.match(/const previousDedicatedDestinationRef = useRef\(false\);\s*useEffect\(\(\) => \{[\s\S]*?loadPage\(currentPageRequest\(\{ offset: 0, search: debouncedSearchQuery \}\)\);[\s\S]*?\}, \[gridReloadSignature, clearLockedSensitiveItems, loadPage\]\);/);
  assert.ok(gridReloadEffect, "automatic grid reload effect should exist");
  assert.match(gridReloadEffect[0], /const showingDateBucketOverview = photoDateViewMode !== "all" && !activeDateBucketKey;/);
  assert.match(gridReloadEffect[0], /const staleDateBucketSelection = photoDateViewMode !== "all"[\s\S]*activeDateBucketScopeSignatureRef\.current !== activeDateBucketScopeSignature;/);
  assert.match(gridReloadEffect[0], /if \(showingDateBucketOverview \|\| staleDateBucketSelection\) \{\s*setLoading\(false\);\s*return;\s*\}/);
  assert.doesNotMatch(gridReloadEffect[0], /\}, \[activeId, sort, debouncedSearchQuery,/);
  const resetBucketEffect = source.match(/useEffect\(\(\) => \{\s*setActiveDateBucketKey\(""\);\s*\}, \[activeDateBucketScopeSignature\]\);/);
  assert.ok(resetBucketEffect, "date bucket reset should depend on the scope signature");
  const dateBucketEffect = source.match(/dateBucketsFnRef\.current\(\{[\s\S]*?\}, \[dateBucketRequestSignature, recordPhotoSearchIndexStatus\]\);/);
  assert.ok(dateBucketEffect, "date bucket fetch effect should depend on compact request signature");
  const paginationEffect = source.match(/new IntersectionObserver\(\(entries\) => \{[\s\S]*?\}, \[gridPaginationSignature, loadPage\]\);/);
  assert.ok(paginationEffect, "grid pagination effect should depend on compact pagination signature");
});

run("Photos album cover and suggestion saves surface failures", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  assert.match(editorSource, /export function photoAlbumCoverSaveDraft\(/);
  const clearCoverBlock = source.match(/async function clearAlbumCover\(folder: PhotoFolder\) \{[\s\S]*?\n  \}\n\n  async function setAlbumCover/);
  assert.ok(clearCoverBlock, "clearAlbumCover should exist");
  assert.match(clearCoverBlock[0], /if \(props\.busy \|\| savingAlbum\) return;/);
  assert.match(clearCoverBlock[0], /setAlbumError\(""\);/);
  assert.match(clearCoverBlock[0], /const coverDraft = photoAlbumCoverSaveDraft\(folder, ""\);/);
  assert.match(clearCoverBlock[0], /await savePhotoAlbum\(coverDraft\);/);
  assert.match(clearCoverBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(clearCoverBlock[0], /finally \{\s*setSavingAlbum\(false\);/);
  assert.doesNotMatch(clearCoverBlock[0], /includePeople: folder\.includePeople/);
  assert.doesNotMatch(clearCoverBlock[0], /coverSourcePath: ""/);

  const setCoverBlock = source.match(/async function setAlbumCover\(item: PhotoItem\) \{[\s\S]*?\n  \}\n\n  async function savePersonProfilePatch/);
  assert.ok(setCoverBlock, "setAlbumCover should exist");
  assert.match(setCoverBlock[0], /if \(!activeAlbum \|\| props\.busy \|\| savingAlbum\) return;/);
  assert.match(setCoverBlock[0], /setAlbumError\(""\);/);
  assert.match(setCoverBlock[0], /const coverDraft = photoAlbumCoverSaveDraft\(activeAlbum, item\.sourcePath\);/);
  assert.match(setCoverBlock[0], /await savePhotoAlbum\(coverDraft\);/);
  assert.match(setCoverBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(setCoverBlock[0], /finally \{\s*setSavingAlbum\(false\);/);
  assert.doesNotMatch(setCoverBlock[0], /includePeople: activeAlbum\.includePeople/);
  assert.doesNotMatch(setCoverBlock[0], /coverSourcePath: item\.sourcePath/);

  const suggestionBlock = source.match(/async function saveSuggestion\(suggestion: PhotoAlbumSuggestion\) \{[\s\S]*?\n  \}\n\n  async function saveActiveSearchAsSmartAlbum/);
  assert.ok(suggestionBlock, "saveSuggestion should exist");
  assert.match(suggestionBlock[0], /const albumDraft = photoAlbumEditorPayloadDraft\(\{/);
  assert.match(suggestionBlock[0], /await savePhotoAlbum\(albumDraft\)/);
  assert.match(suggestionBlock[0], /\$\{albumDraft\.name\}/);
  assert.match(suggestionBlock[0], /setSavingSuggestionId\(suggestionKey\);/);
  assert.match(suggestionBlock[0], /setAlbumError\(""\);/);
  assert.match(suggestionBlock[0], /catch \(error\) \{\s*setAlbumError/);
  assert.match(suggestionBlock[0], /setSavingSuggestionId\(\(current\) => \(current === suggestionKey \? "" : current\)\);/);
  assert.doesNotMatch(suggestionBlock[0], /const result = await savePhotoAlbum\(\{/);
  assert.doesNotMatch(source, /setSavingSuggestionId\(key\);[\s\S]*?await saveSuggestion\(suggestion\);[\s\S]*?setSavingSuggestionId\(""\);/);
  assert.match(source, /onClick=\{\(\) => void saveSuggestion\(suggestion\)\}/);
  assert.match(source, /disabled=\{props\.busy \|\| savingAlbum\}/);

  const saveSearchBlock = source.match(/async function saveActiveSearchAsSmartAlbum\(\) \{[\s\S]*?\n  \}\n\n  async function persistSavedFiltersToWorkspace/);
  assert.ok(saveSearchBlock, "saveActiveSearchAsSmartAlbum should exist");
  assert.match(saveSearchBlock[0], /const albumDraft = photoAlbumEditorPayloadDraft\(\{/);
  assert.match(saveSearchBlock[0], /await savePhotoAlbum\(albumDraft\)/);
  assert.doesNotMatch(saveSearchBlock[0], /const result = await savePhotoAlbum\(\{/);
});

run("Photos metadata drafts reset only when the lightbox source changes", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const resetEffect = source.match(/useEffect\(\(\) => \{\s*setMetadataError\(""\);[\s\S]*?applyLightboxDateDrafts\(photoInfoDateDraftsFromItem\(lightItem\)\);[\s\S]*?setDetectedItemDraft\(""\);\s*\}, \[[^\]]+\]\);/);
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

run("Photos slideshow drag editors batch pointermove commits by animation frame", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /const photoSlideshowCaptionRegionPendingDraftRef = useRef<PhotoSlideshowCaptionRegionDraft \| null>\(null\);/);
  assert.match(source, /const photoSlideshowProjectPathFrameUpdateRef = useRef<PhotoSlideshowProjectPathFrameUpdate \| null>\(null\);/);
  assert.match(source, /function schedulePhotoSlideshowCaptionRegionDraft\(region: PhotoSlideshowCaptionRegionDraft\) \{[\s\S]*?window\.requestAnimationFrame\(flushPhotoSlideshowCaptionRegionDraftFrame\)/);
  assert.match(source, /function schedulePhotoSlideshowProjectPathFrame\(update: PhotoSlideshowProjectPathFrameUpdate\) \{[\s\S]*?window\.requestAnimationFrame\(flushPhotoSlideshowProjectPathFrame\)/);
  assert.match(source, /window\.cancelAnimationFrame\(photoSlideshowCaptionRegionFrameRef\.current\);/);
  assert.match(source, /window\.cancelAnimationFrame\(photoSlideshowProjectPathFrameRef\.current\);/);

  const captionMoveBlock = source.match(/function movePhotoSlideshowCaptionRegionPointer\(event: ReactPointerEvent<SVGSVGElement>\) \{[\s\S]*?\n  \}\n\n  function endPhotoSlideshowCaptionRegionPointer/);
  assert.ok(captionMoveBlock, "caption region pointermove handler should exist");
  assert.match(captionMoveBlock[0], /schedulePhotoSlideshowCaptionRegionDraft/);
  assert.doesNotMatch(captionMoveBlock[0], /commitPhotoSlideshowCaptionRegionDraft/);

  const pathMoveBlock = source.match(/function movePhotoSlideshowProjectPathPointer\(event: ReactPointerEvent<SVGSVGElement>\) \{[\s\S]*?\n  \}\n\n  function movePhotoSlideshowProjectPathMouse/);
  assert.ok(pathMoveBlock, "path pointermove handler should exist");
  assert.match(pathMoveBlock[0], /schedulePhotoSlideshowProjectPathFrame\(\{ kind: "bezier"/);
  assert.match(pathMoveBlock[0], /schedulePhotoSlideshowProjectPathFrame\(\{ kind: "anchor"/);
  assert.match(pathMoveBlock[0], /schedulePhotoSlideshowProjectPathFrame\(\{ kind: "draw"/);
  assert.match(pathMoveBlock[0], /pendingPhotoSlideshowProjectDrawPoints\(\)/);
  assert.doesNotMatch(pathMoveBlock[0], /updatePhotoSlideshowProjectPathAnchor/);
  assert.doesNotMatch(pathMoveBlock[0], /updatePhotoSlideshowProjectBezierHandle/);
  assert.doesNotMatch(pathMoveBlock[0], /commitPhotoSlideshowProjectPathPoints/);

  const pathEndBlock = source.match(/function endPhotoSlideshowProjectPathPointer\(event: ReactPointerEvent<SVGSVGElement>\) \{[\s\S]*?\n  \}\n\n  function endPhotoSlideshowProjectPathMouse/);
  assert.ok(pathEndBlock, "path pointer end handler should exist");
  assert.match(pathEndBlock[0], /flushPhotoSlideshowProjectPathFrame\(\);/);
});

run("Photos semantic search results outside the loaded page open in lightbox", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const semanticPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoSemanticSearchPanel.tsx"), "utf8");
  const block = source.match(/async function openSemanticResult\(sourcePath: string, timestampMs\?: number\) \{[\s\S]*?window\.crossAge\.revealPath\(sourcePath\)\.catch\(\(\) => undefined\);\s*\}/);
  assert.ok(block, "openSemanticResult should exist");
  assert.match(block[0], /const index = items\.findIndex\(\(entry\) => entry\.sourcePath === sourcePath\);/);
  assert.match(block[0], /if \(index >= 0\) \{\s*setLightbox\(index\);\s*return;\s*\}/);
  assert.match(block[0], /const page = await itemsFnRef\.current\(\{/);
  assert.match(block[0], /sourcePaths: \[sourcePath\]/);
  assert.match(block[0], /previewBudget: 1/);
  assert.match(block[0], /pendingLightboxVideoSeekRef\.current/);
  assert.match(block[0], /setItems\(\(current\) => \[match, \.\.\.current\.filter\(\(entry\) => entry\.sourcePath !== sourcePath\)\]\);/);
  assert.match(block[0], /setLightbox\(0\);/);
  assert.match(source, /PhotoSemanticSearchPanel/);
  assert.match(source, /onOpenResult=\{openSemanticResult\}/);
  assert.match(source, /loadedItems=\{items\}/);
  assert.doesNotMatch(source, /photos-semantic-results/);
  assert.match(semanticPanelSource, /export function PhotoSemanticSearchPanel/);
  assert.match(semanticPanelSource, /photos-semantic-search/);
  assert.match(semanticPanelSource, /props\.results\.results\.map\(\(result\) =>/);
  assert.match(semanticPanelSource, /onClick=\{\(\) => void props\.onOpenResult\(result\.sourcePath, isVideoSegment \? result\.timestampMs : undefined\)\}/);
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
  assert.match(source, /photoRailAlbumTreeItemId as albumTreeItemId/);
  assert.match(source, /photoRailAlbumTreeParentId as albumTreeParentId/);
  assert.match(source, /photoRailAlbumTreeSiblings as albumTreeSiblings/);
  assert.match(source, /buildPhotoRailAlbumTreeAncestorIdMap/);
  assert.doesNotMatch(source, /function albumTreeItemId/);
  assert.doesNotMatch(source, /function albumTreeParentId/);
  assert.doesNotMatch(source, /function albumTreeSiblings/);
  assert.doesNotMatch(source, /function albumTreeAncestorIds/);
  assert.match(sectionBlock[0], /const albumTreeParentFolderIds = section\.id === "albums"[\s\S]*new Set\(section\.folders\.map\(\(folder\) => albumTreeParentId\(folder\)\)\.filter\(Boolean\)\)/);
  assert.match(sectionBlock[0], /const albumTreeAncestorIdsByFolderId = section\.id === "albums" \? buildPhotoRailAlbumTreeAncestorIdMap\(section\.folders\) : null;/);
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
  assert.doesNotMatch(rowLoop, /albumTreeAncestorIds\(folder, section\.folders\)/);
});

run("Photos rail drag targets use shared placement and state helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const railSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailVisibility.ts"), "utf8");
  assert.match(railSource, /export function photoRailDropPlacementFromBounds\(/);
  assert.match(railSource, /export function photoRailSectionDragTargetState\(/);
  assert.match(railSource, /export function photoLocalRailItemDragTargetState\(/);
  assert.match(source, /photoRailDropPlacementFromBounds/);
  assert.match(source, /photoRailSectionDragTargetState/);
  assert.match(source, /photoLocalRailItemDragTargetState/);

  const sectionPlacementBlock = source.match(/function railSectionDropPlacementForEvent\(event: ReactDragEvent<HTMLElement>\): "before" \| "after" \{[\s\S]*?\n  \}\n\n  function updateRailSectionDragTarget/);
  assert.ok(sectionPlacementBlock, "rail section placement helper should exist");
  assert.match(sectionPlacementBlock[0], /return photoRailDropPlacementFromBounds\(event\.clientY, rect\.top, rect\.height\);/);
  assert.doesNotMatch(sectionPlacementBlock[0], /ratio < 0\.5 \? "before" : "after"/);

  const sectionTargetBlock = source.match(/function updateRailSectionDragTarget\(sectionId: PhotoRailSectionId, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  function applyRailSectionDrop/);
  assert.ok(sectionTargetBlock, "rail section target handler should exist");
  assert.match(sectionTargetBlock[0], /const targetState = photoRailSectionDragTargetState\(railSectionDrag, sectionId, draggedId, visibleRailSectionOrder, placement\);/);
  assert.match(sectionTargetBlock[0], /return photoRailSectionDragTargetState\(current, sectionId, draggedId, visibleRailSectionOrder, placement\);/);
  assert.doesNotMatch(sectionTargetBlock[0], /visibleRailSectionOrder\.includes\(draggedId\)/);
  assert.doesNotMatch(sectionTargetBlock[0], /const valid = draggedId !== sectionId/);

  const itemPlacementBlock = source.match(/function localRailItemDropPlacementForEvent\(event: ReactDragEvent<HTMLElement>\): "before" \| "after" \{[\s\S]*?\n  \}\n\n  function updateLocalRailItemDragTarget/);
  assert.ok(itemPlacementBlock, "local rail item placement helper should exist");
  assert.match(itemPlacementBlock[0], /return photoRailDropPlacementFromBounds\(event\.clientY, rect\.top, rect\.height\);/);
  assert.doesNotMatch(itemPlacementBlock[0], /ratio < 0\.5 \? "before" : "after"/);

  const itemTargetBlock = source.match(/function updateLocalRailItemDragTarget\(sectionId: PhotoRailSectionId, folder: PhotoFolder, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  function applyLocalRailItemDrop/);
  assert.ok(itemTargetBlock, "local rail item target handler should exist");
  assert.match(itemTargetBlock[0], /const targetState = photoLocalRailItemDragTargetState\(localRailItemDrag, sectionId, folder\.id, draggedId, draggedSectionId, placement\);/);
  assert.match(itemTargetBlock[0], /return photoLocalRailItemDragTargetState\(current, sectionId, folder\.id, draggedId, draggedSectionId, placement\);/);
  assert.doesNotMatch(itemTargetBlock[0], /const valid = draggedSectionId === sectionId/);
  assert.doesNotMatch(itemTargetBlock[0], /const base = current \|\| \{ draggedId, sectionId: draggedSectionId \}/);
});

run("Photos people rail reorders use shared order and payload helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const groupSource = fs.readFileSync(path.join(ROOT, "src/views/photoGroupReview.ts"), "utf8");
  assert.match(groupSource, /export function photoPeopleRailMoveOrder\(/);
  assert.match(groupSource, /export function photoPeopleRailDropOrder\(/);
  assert.match(groupSource, /export function photoPeopleRailDropPlacementFromBounds\(/);
  assert.match(groupSource, /export function photoPeopleRailDragTargetState\(/);
  assert.match(groupSource, /export function photoPersonRailOrderPayloads\(/);
  assert.match(groupSource, /export function photoSavedGroupRailOrderPayloads\(/);
  assert.match(source, /photoPeopleRailItemKind as peopleRailItemKind/);
  assert.match(source, /photoPeopleRailDropPlacementFromBounds/);
  assert.match(source, /photoPeopleRailDragTargetState/);

  const personMoveBlock = source.match(/async function movePersonRailItem\(sectionFolders: PhotoFolder\[\], folder: PhotoFolder, direction: "up" \| "down"\) \{[\s\S]*?\n  \}\n\n  async function moveSavedGroupRailItem/);
  assert.ok(personMoveBlock, "movePersonRailItem should exist");
  assert.match(personMoveBlock[0], /const orderPayloads = photoPersonRailOrderPayloads\(photoPeopleRailMoveOrder\(sectionFolders, folder, direction\) \|\| \[\]\);/);
  assert.match(personMoveBlock[0], /await Promise\.all\(orderPayloads\.map\(\(payload\) => savePhotoPersonProfile\(payload\)\)\);/);
  assert.doesNotMatch(personMoveBlock[0], /sectionFolders\.filter\(\(item\) => item\.kind === "person"\)/);
  assert.doesNotMatch(personMoveBlock[0], /personName: personFolder\.name/);

  const groupMoveBlock = source.match(/async function moveSavedGroupRailItem\(sectionFolders: PhotoFolder\[\], folder: PhotoFolder, direction: "up" \| "down"\) \{[\s\S]*?\n  \}\n\n  function moveRailCollectionItem/);
  assert.ok(groupMoveBlock, "moveSavedGroupRailItem should exist");
  assert.match(groupMoveBlock[0], /const orderPayloads = photoSavedGroupRailOrderPayloads\(photoPeopleRailMoveOrder\(sectionFolders, folder, direction\) \|\| \[\]\);/);
  assert.match(groupMoveBlock[0], /await Promise\.all\(orderPayloads\.map\(\(payload\) => savePhotoPeopleGroup\(payload\)\)\);/);
  assert.doesNotMatch(groupMoveBlock[0], /sectionFolders\.filter\(\(item\) => savedPeopleGroupId\(item\)\)/);
  assert.doesNotMatch(groupMoveBlock[0], /groupId: savedPeopleGroupId\(groupFolder\)/);

  const persistBlock = source.match(/async function persistPeopleRailDragOrder\(kind: PhotoPeopleRailDragState\["kind"\], nextFolders: PhotoFolder\[\]\) \{[\s\S]*?\n  \}\n\n  async function applyPeopleRailDrop/);
  assert.ok(persistBlock, "persistPeopleRailDragOrder should exist");
  assert.match(persistBlock[0], /const orderPayloads = photoPersonRailOrderPayloads\(nextFolders\);/);
  assert.match(persistBlock[0], /const orderPayloads = photoSavedGroupRailOrderPayloads\(nextFolders\);/);
  assert.doesNotMatch(persistBlock[0], /personName: personFolder\.name/);
  assert.doesNotMatch(persistBlock[0], /groupId: savedPeopleGroupId\(groupFolder\)/);

  const targetBlock = source.match(/function updatePeopleRailDragTarget\(folder: PhotoFolder, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  async function persistPeopleRailDragOrder/);
  assert.ok(targetBlock, "updatePeopleRailDragTarget should exist");
  assert.match(targetBlock[0], /const targetState = photoPeopleRailDragTargetState\(peopleRailDrag, folder, draggedId, draggedKind, placement\);/);
  assert.match(targetBlock[0], /return photoPeopleRailDragTargetState\(current, folder, draggedId, draggedKind, placement\);/);
  assert.doesNotMatch(targetBlock[0], /const targetKind = peopleRailItemKind\(folder\);/);
  assert.doesNotMatch(targetBlock[0], /const valid = Boolean/);

  const placementBlock = source.match(/function peopleRailDropPlacementForEvent\(event: ReactDragEvent<HTMLElement>\): "before" \| "after" \{[\s\S]*?\n  \}\n\n  function updatePeopleRailDragTarget/);
  assert.ok(placementBlock, "peopleRailDropPlacementForEvent should exist");
  assert.match(placementBlock[0], /return photoPeopleRailDropPlacementFromBounds\(event\.clientY, rect\.top, rect\.height\);/);
  assert.doesNotMatch(placementBlock[0], /ratio < 0\.5 \? "before" : "after"/);

  const dropBlock = source.match(/async function applyPeopleRailDrop\(sectionFolders: PhotoFolder\[\], target: PhotoFolder, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  function clearPhotoFilterChip/);
  assert.ok(dropBlock, "applyPeopleRailDrop should exist");
  assert.match(dropBlock[0], /const next = photoPeopleRailDropOrder\(sectionFolders, draggedId, target\.id, placement, draggedKind\);/);
  assert.doesNotMatch(dropBlock[0], /const candidates = sectionFolders\.filter/);
  assert.doesNotMatch(dropBlock[0], /const \[moved\] = next\.splice/);
});

run("Photos album tree moves use shared reorder and move draft helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const railSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailVisibility.ts"), "utf8");
  assert.match(railSource, /export function photoRailAlbumTreeReorderDraft\(/);
  assert.match(railSource, /export function photoRailAlbumTreeMoveDraft\(/);
  assert.match(railSource, /export function photoRailAlbumTreeDropPlacementFromBounds\(/);
  assert.match(railSource, /export function photoRailAlbumTreeDragTargetState\(/);
  assert.match(source, /photoRailAlbumTreeReorderDraft as albumTreeReorderDraft/);
  assert.match(source, /photoRailAlbumTreeMoveDraft as albumTreeMoveDraft/);
  assert.match(source, /photoRailAlbumTreeDropPlacementFromBounds/);
  assert.match(source, /photoRailAlbumTreeDragTargetState/);

  const reorderBlock = source.match(/async function moveAlbumTreeItem\(direction: "up" \| "down"\) \{[\s\S]*?\n  \}\n\n  function albumTreeDropPlacementForEvent/);
  assert.ok(reorderBlock, "moveAlbumTreeItem should exist");
  assert.match(reorderBlock[0], /const reorderDraft = albumTreeReorderDraft\(activeAlbumTreeItem, activeAlbumTreeSiblings, activeAlbumTreeIndex, direction\);/);
  assert.match(reorderBlock[0], /await reorderPhotoAlbumFolderChildren\(reorderDraft\);/);
  assert.doesNotMatch(reorderBlock[0], /const targetIndex = direction === "up"/);
  assert.doesNotMatch(reorderBlock[0], /const nextSiblings = \[\.\.\.activeAlbumTreeSiblings\]/);
  assert.doesNotMatch(reorderBlock[0], /parentFolderId: albumTreeParentId\(activeAlbumTreeItem\)/);
  assert.doesNotMatch(reorderBlock[0], /nextSiblings\.map/);

  const placementBlock = source.match(/function albumTreeDropPlacementForEvent\(folder: PhotoFolder, event: ReactDragEvent<HTMLElement>\): PhotoRailAlbumTreeDropPlacement \{[\s\S]*?\n  \}\n\n  function updateAlbumTreeDragTarget/);
  assert.ok(placementBlock, "albumTreeDropPlacementForEvent should exist");
  assert.match(placementBlock[0], /return photoRailAlbumTreeDropPlacementFromBounds\(folder, event\.clientY, rect\.top, rect\.height\);/);
  assert.doesNotMatch(placementBlock[0], /ratio < 0\.1/);
  assert.doesNotMatch(placementBlock[0], /return "inside"/);

  const targetBlock = source.match(/function updateAlbumTreeDragTarget\(folder: PhotoFolder, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  async function applyAlbumTreeDrop/);
  assert.ok(targetBlock, "updateAlbumTreeDragTarget should exist");
  assert.match(targetBlock[0], /const targetState = photoRailAlbumTreeDragTargetState\(albumTreeDrag, folders, folder, draggedId, placement\);/);
  assert.match(targetBlock[0], /return photoRailAlbumTreeDragTargetState\(current, folders, folder, draggedId, placement\);/);
  assert.doesNotMatch(targetBlock[0], /const plan = planPhotoRailAlbumTreeDrop\(folders, draggedId, folder\.id, placement\);/);
  assert.doesNotMatch(targetBlock[0], /valid: plan\.valid/);

  const dropBlock = source.match(/async function applyAlbumTreeDrop\(target: PhotoFolder, event: ReactDragEvent<HTMLElement>\) \{[\s\S]*?\n  \}\n\n  function peopleRailDropPlacementForEvent/);
  assert.ok(dropBlock, "applyAlbumTreeDrop should exist");
  assert.match(dropBlock[0], /const moveDraft = albumTreeMoveDraft\(dragged, plan\);/);
  assert.match(dropBlock[0], /await savePhotoAlbumFolder\(moveDraft\.payload\);/);
  assert.match(dropBlock[0], /await movePhotoAlbumToFolder\(moveDraft\.payload\);/);
  assert.doesNotMatch(dropBlock[0], /const currentParentId = albumTreeParentId\(dragged\);/);
  assert.doesNotMatch(dropBlock[0], /savePhotoAlbumFolder\(\{/);
  assert.doesNotMatch(dropBlock[0], /movePhotoAlbumToFolder\(\{/);
  assert.doesNotMatch(dropBlock[0], /folderId: plan\.dragged\.id/);
  assert.doesNotMatch(dropBlock[0], /albumId: plan\.dragged\.id/);
});

run("Photos albums gallery uses shared bounded album tree state", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const railSource = fs.readFileSync(path.join(ROOT, "src/views/photoRailVisibility.ts"), "utf8");
  const gallerySource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumsGallery.tsx"), "utf8");
  assert.match(railSource, /export function buildPhotoAlbumGalleryState/);
  assert.match(source, /buildPhotoAlbumGalleryState\(albumFolders, albumGalleryAlbums, browsedAlbumFolderId\)/);
  assert.match(source, /PhotoAlbumsGallery/);
  assert.match(source, /state=\{albumGalleryState\}/);
  assert.match(source, /hasAny=\{albumFolders\.length > 0 \|\| albumGalleryAlbums\.length > 0\}/);
  assert.match(source, /canCreateSmartAlbum=\{visibleLibrarySourceCountForCreation > 0\}/);
  assert.match(source, /catalogEmpty=\{visibleLibrarySourceCountForCreation <= 0\}/);
  assert.match(source, /onNewFolder=\{\(\) => startNewAlbumFolder\(browsedAlbumFolderId\)\}/);
  assert.match(source, /onBrowseFolder=\{setBrowsedAlbumFolderId\}/);
  assert.match(source, /onOpenAlbum=\{setActiveId\}/);
  assert.match(source, /onSaveSuggestion=\{\(suggestion\) => void saveSuggestion\(suggestion\)\}/);
  assert.doesNotMatch(source, /const renderAlbumsGallery = \(\) =>/);
  assert.doesNotMatch(source, /albums-gallery/);
  assert.match(gallerySource, /export function PhotoAlbumsGallery/);
  assert.match(gallerySource, /const albumBreadcrumbFolders = props\.state\.breadcrumbFolders;/);
  assert.match(gallerySource, /const visibleAlbumFolderCards = props\.state\.folderCards;/);
  assert.match(gallerySource, /albumBreadcrumbFolders\.map\(\(ancestor\) =>/);
  assert.match(gallerySource, /visibleAlbumFolderCards\.map\(\(\{ folder, folderKey, childCount \}\) =>/);
  assert.match(gallerySource, /photoRailAlbumTreeItemId\(ancestor\)/);
  assert.match(gallerySource, /props\.suggestions\.slice\(0, 12\)/);
  assert.match(gallerySource, /props\.uiText\("Create your first album"\)/);
  assert.match(gallerySource, /\(props\.hasAny \|\| browsedAlbumFolder\)/);
  assert.match(gallerySource, /!props\.canCreateSmartAlbum/);
  assert.doesNotMatch(gallerySource, /albumTreeAncestorIds\(browsedAlbumFolder, folders\)/);
  assert.doesNotMatch(gallerySource, /albumFolders\.find\(\(item\) => albumTreeItemId\(item\) === id\)/);
  assert.doesNotMatch(gallerySource, /albumFolders\.filter\(\(item\) => albumTreeParentId\(item\) === folderKey\)/);
  assert.doesNotMatch(gallerySource, /albumGalleryAlbums\.filter\(\(item\) => albumTreeParentId\(item\) === folderKey\)/);
});

run("Photos people gallery uses shared gallery state", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const groupSource = fs.readFileSync(path.join(ROOT, "src/views/photoGroupReview.ts"), "utf8");
  const gallerySource = fs.readFileSync(path.join(ROOT, "src/views/photoPeopleGallery.tsx"), "utf8");
  assert.match(groupSource, /export function buildPhotoPeopleGalleryState/);
  assert.match(source, /buildPhotoPeopleGalleryState\(\{/);
  assert.match(source, /PhotoPeopleGallery/);
  assert.match(source, /state=\{peopleGalleryState\}/);
  assert.match(source, /renameDrafts=\{peopleManagementRenameDrafts\}/);
  assert.match(source, /onFindDuplicates=\{\(\) => void loadDuplicatePeople\(\)\}/);
  assert.match(source, /onToggleFavoriteGroup=\{\(folder\) => void savePeopleGroupPatch\(folder, \{ favorite: !Boolean\(folder\.groupProfile\?\.favorite\) \}\)\}/);
  assert.match(source, /onHideGroup=\{\(folder\) => void savePeopleGroupPatch\(folder, \{ hidden: true \}\)\}/);
  assert.doesNotMatch(source, /const renderPeopleGallery = \(\) =>/);
  assert.doesNotMatch(source, /photos-people-gallery/);
  assert.match(gallerySource, /export function PhotoPeopleGallery/);
  assert.match(gallerySource, /const \{ namedPeople, pets, groups, unknownClusters, petReviewFolder, favoritePeople, favoritePets, reviewPending, hasAny \} = props\.state;/);
  assert.match(gallerySource, /props\.uiText\("People & Pets"\)/);
  assert.match(gallerySource, /props\.uiText\("More people to name"\)/);
  assert.match(gallerySource, /props\.onFindDuplicates/);
  assert.match(gallerySource, /props\.onToggleFavoriteGroup/);
  assert.match(gallerySource, /props\.onOpenFolder\(folder\.id\)/);
  assert.match(gallerySource, /photoCoverCropStyle\(folder\.coverCrop\)/);
  assert.doesNotMatch(gallerySource, /peopleManagementPeople\.filter\(\(folder\) => !folder\.personProfile\?\.hidden\)/);
  assert.doesNotMatch(gallerySource, /peopleManagementPets\.filter\(\(folder\) => !folder\.petProfile\?\.hidden\)/);
  assert.doesNotMatch(gallerySource, /peopleManagementGroups\.filter\(\(folder\) => !folder\.groupProfile\?\.hidden\)/);
  assert.doesNotMatch(gallerySource, /railFolders\.filter\(\(folder\) => folder\.kind === "unknown"\)/);
  assert.doesNotMatch(gallerySource, /folders\.find\(\(folder\) => folder\.id === "petReview"\)/);
  assert.doesNotMatch(gallerySource, /namedPeople\.filter\(\(folder\) => folder\.personProfile\?\.favorite\)/);
  assert.doesNotMatch(gallerySource, /pets\.filter\(\(folder\) => folder\.petProfile\?\.favorite\)/);
});

run("Photos memories feed uses shared feed state", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const curationSource = fs.readFileSync(path.join(ROOT, "src/views/photoCurationPreferences.ts"), "utf8");
  const feedSource = fs.readFileSync(path.join(ROOT, "src/views/photoMemoriesFeed.tsx"), "utf8");
  assert.match(curationSource, /export function buildPhotoMemoriesFeedState/);
  assert.match(source, /const memoriesFeedState = useMemo\(\(\) => buildPhotoMemoriesFeedState\(folders\), \[folders\]\);/);
  assert.match(source, /PhotoMemoriesFeed/);
  assert.match(source, /state=\{memoriesFeedState\}/);
  assert.match(source, /canCreateMemory=\{visibleLibrarySourceCountForCreation >= 2\}/);
  assert.match(source, /onAddPhotos=\{\(\) => void importPickedFiles\(\)\}/);
  assert.match(source, /onPlayMemory=\{playMemory\}/);
  assert.match(source, /onCreateMemory=\{\(\) => void createUserMemoryFromCurrentView\(\)\}/);
  assert.match(source, /onExportMemoryMovie=\{\(folder\) => void exportActiveMemoryMovie\(folder\)\}/);
  assert.match(source, /onToggleMemoryFavorite=\{\(folder\) => void toggleMemoryFavorite\(folder\)\}/);
  assert.doesNotMatch(source, /const renderMemoriesFeed = \(\) =>/);
  assert.doesNotMatch(source, /memories-feed/);
  assert.match(feedSource, /export function PhotoMemoriesFeed/);
  assert.match(feedSource, /const \{ memoryFolders, featuredMemory, onThisDayMemories, gridMemories \} = props\.state;/);
  assert.match(feedSource, /const hero = featuredMemory;/);
  assert.match(feedSource, /gridMemories\.map\(\(folder\) =>/);
  assert.match(feedSource, /props\.uiText\("Memories appear here"\)/);
  assert.match(feedSource, /props\.canCreateMemory \?/);
  assert.match(feedSource, /props\.onAddPhotos\(\)/);
  assert.doesNotMatch(feedSource, /const surfacedIds = new Set/);
  assert.doesNotMatch(feedSource, /memoryFolders\.filter\(\(folder\) => !surfacedIds\.has\(folder\.id\)\)/);
  assert.doesNotMatch(source, /const featuredMemory = useMemo\(\(\) =>/);
  assert.doesNotMatch(source, /const onThisDayMemories = useMemo\(\(\) =>/);
});

run("Photos heavy derived rows use stable label helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const dateBucketPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoDateBucketPanel.tsx"), "utf8");
  const emptyLibraryStateSource = fs.readFileSync(path.join(ROOT, "src/views/photoEmptyLibraryState.tsx"), "utf8");
  assert.match(source, /from "\.\/photoDisplayText"/);
  assert.match(source, /const uiText = props\.uiText \?\? identityPhotoUiText;/);
  assert.match(source, /const fileName = photoFileName;/);
  assert.match(source, /const itemLabel = useCallback\(/);
  assert.match(source, /const itemIndexByIdentity = useMemo\(\(\) => \{\s*const indexByItem = new Map<PhotoItem, number>\(\);/);
  assert.doesNotMatch(source, /const fileName = \(sourcePath: string\)/);
  const duplicateGroupsBlock = source.match(/const duplicateReviewGroups = useMemo[\s\S]*?\[fileName, items, selectedSourcePaths\]\s*\);/);
  assert.ok(duplicateGroupsBlock, "duplicate review groups memo should remain explicit about stable fileName");
  const dateBucketCardsBlock = source.match(/const dateBucketCards = useMemo<PhotoDateBucketCard\[\]>\([\s\S]*?\[dateBucketLoaded, dateBucketLoadError, dateBucketLoading, dateBucketRows, itemIndexByIdentity, itemLabel, localDateBuckets, photoDateViewMode\]\s*\);/);
  assert.ok(dateBucketCardsBlock, "date bucket cards memo should depend on stable itemLabel");
  assert.match(dateBucketCardsBlock[0], /itemIndexByIdentity\.get\(bucket\.coverItem\) \?\? 0/);
  assert.doesNotMatch(dateBucketCardsBlock[0], /items\.indexOf\(bucket\.coverItem\)/);
  assert.match(source, /<PhotoDateBucketPanel/);
  assert.match(source, /<PhotoEmptyLibraryState/);
  assert.doesNotMatch(source, /photo-date-bucket-cover-reason/);
  assert.doesNotMatch(source, /photo-date-bucket-badges/);
  assert.doesNotMatch(source, /uiText\("Could not load date buckets"\)/);
  assert.doesNotMatch(source, /uiText\("No photos here yet"\)/);
  assert.match(dateBucketPanelSource, /export function PhotoDateBucketPanel/);
  assert.match(dateBucketPanelSource, /photo-date-bucket-cover-reason/);
  assert.match(dateBucketPanelSource, /photo-date-bucket-badges/);
  assert.match(dateBucketPanelSource, /uiText\("Could not load date buckets"\)/);
  assert.match(dateBucketPanelSource, /uiText\("Loading date buckets\.\.\."\)/);
  assert.match(dateBucketPanelSource, /uiText\("No dated photos in this view"\)/);
  assert.match(emptyLibraryStateSource, /export function PhotoEmptyLibraryState/);
  assert.match(emptyLibraryStateSource, /uiText\("No photos here yet"\)/);
  assert.match(emptyLibraryStateSource, /uiText\("Import photos"\)/);
  assert.match(emptyLibraryStateSource, /uiText\("Import folder"\)/);
  assert.match(emptyLibraryStateSource, /uiText\("Find photos on this computer"\)/);
  assert.doesNotMatch(source, /function photoFileName\(sourcePath: string\): string/);
  assert.doesNotMatch(source, /const identityPhotoUiText = \(source: string\) => source;/);
});

run("Photos manual collections default to Custom order on entry without overriding a user sort", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const sortEffect = source.match(/const manualSortScope = [\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[manualSortScope, sort\]\);/);
  assert.ok(sortEffect, "manual-sort scope effect should exist");
  assert.match(sortEffect[0], /manualSortScope && manualSortScope !== previousScope/);
  assert.match(sortEffect[0], /setSort\("manual"\)/);
  assert.match(sortEffect[0], /!manualSortScope && sort === "manual"[\s\S]*setSort\("newest"\)/);
  assert.doesNotMatch(sortEffect[0], /manualSortScope && sort !== "manual"[\s\S]*setSort\("manual"\)/);
  assert.match(source, /\(activeAlbumIsManual \|\| activeMemoryUserCreated\) && <option value="manual">/);
  assert.match(source, /<option value="newest">\{uiText\("Newest"\)\}<\/option>/);
});

run("Photos album delete undo preserves rail people filters", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  assert.match(editorSource, /export function photoAlbumDeleteRestoreDraft\(/);
  assert.match(editorSource, /includePeople: isActive \? \(activeAlbum\?\.includePeople \|\| folder\.includePeople \|\| \[\]\) : \(folder\.includePeople \|\| \[\]\)/);
  assert.match(editorSource, /excludePeople: isActive \? \(activeAlbum\?\.excludePeople \|\| folder\.excludePeople \|\| \[\]\) : \(folder\.excludePeople \|\| \[\]\)/);
  const deleteAlbumBlock = source.match(/async function deleteAlbum\(folder: PhotoFolder\) \{[\s\S]*?\n  \}\n\n  async function mergeActiveAlbumIntoTarget/);
  assert.ok(deleteAlbumBlock, "deleteAlbum should exist");
  assert.match(deleteAlbumBlock[0], /const restoreDraft = photoAlbumDeleteRestoreDraft\(folder, activeAlbum\);/);
  assert.match(deleteAlbumBlock[0], /loadAlbumSourceOrderById\(restoreDraft\.albumId, "manual"\)/);
  assert.match(deleteAlbumBlock[0], /deletePhotoAlbum\(\{ albumId: restoreDraft\.albumId \}\)/);
  assert.match(deleteAlbumBlock[0], /undoDeleteAlbum\(restoreDraft\.restoreConfig, restoreOrder\)/);
  assert.doesNotMatch(deleteAlbumBlock[0], /const restoreConfig: Record<string, unknown> = \{/);
  assert.doesNotMatch(deleteAlbumBlock[0], /includePeople: isActive/);
  assert.doesNotMatch(deleteAlbumBlock[0], /excludePeople: isActive/);
});

run("Photos album folder save and delete use shared payload helpers", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const editorSource = fs.readFileSync(path.join(ROOT, "src/views/photoAlbumEditorState.ts"), "utf8");
  assert.match(editorSource, /export function photoAlbumFolderSaveDraft\(/);
  assert.match(editorSource, /export function photoAlbumFolderDeleteDraft\(/);

  const saveFolderBlock = source.match(/async function saveAlbumFolder\(\) \{[\s\S]*?\n  \}\n\n  async function deleteAlbumFolder/);
  assert.ok(saveFolderBlock, "saveAlbumFolder should exist");
  assert.match(saveFolderBlock[0], /const folderDraft = photoAlbumFolderSaveDraft\(\{/);
  assert.match(saveFolderBlock[0], /await savePhotoAlbumFolder\(folderDraft\)/);
  assert.doesNotMatch(saveFolderBlock[0], /const name = albumFolderName\.trim/);
  assert.doesNotMatch(saveFolderBlock[0], /const result = await savePhotoAlbumFolder\(\{/);

  const deleteFolderBlock = source.match(/async function deleteAlbumFolder\(folder: PhotoFolder\) \{[\s\S]*?\n  \}\n\n  function togglePerson/);
  assert.ok(deleteFolderBlock, "deleteAlbumFolder should exist");
  assert.match(deleteFolderBlock[0], /const folderDraft = photoAlbumFolderDeleteDraft\(folder\);/);
  assert.match(deleteFolderBlock[0], /await deletePhotoAlbumFolder\(folderDraft\)/);
  assert.doesNotMatch(deleteFolderBlock[0], /folder\.id\.replace\(\/^albumFolder:/);
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

run("App DOM localization restores English and batches non-English mutation roots", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const effectBlock = appSource.match(/useEffect\(\(\) => \{\s*const root = document\.getElementById\("root"\) \|\| document\.body;[\s\S]*?observer\.observe\(root, \{[\s\S]*?\}\);\s*return \(\) => \{[\s\S]*?\};\s*\}, \[language\]\);/);
  assert.ok(effectBlock, "DOM localization effect should exist");
  assert.match(effectBlock[0], /if \(language === "en"\) \{\s*localizeDom\(root, language\);\s*return;\s*\}/);
  assert.match(effectBlock[0], /const maxPendingRoots = 80;/);
  assert.match(effectBlock[0], /pendingRoots\.size >= maxPendingRoots/);
  assert.match(effectBlock[0], /for \(let ancestor: Node \| null = targetNode; ancestor; ancestor = ancestor\.parentNode\)/);
  assert.match(effectBlock[0], /pendingRoots\.has\(ancestor as ParentNode\)/);
  assert.match(effectBlock[0], /enqueueLocalizationRoot\(mutation\.target\);/);
  assert.doesNotMatch(effectBlock[0], /mutation\.addedNodes\.forEach\(enqueueLocalizationRoot\)/);
  const photosViewSource = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const gridPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoVirtualGridPanel.tsx"), "utf8");
  assert.match(photosViewSource, /<PhotoVirtualGridPanel/);
  assert.doesNotMatch(photosViewSource, /className="photos-grid virtualized content-crossfade"[\s\S]*?data-no-localize="true"/);
  assert.match(gridPanelSource, /className="photos-grid virtualized content-crossfade"[\s\S]*?data-no-localize="true"/);
});

run("App Safe Mode profile thresholds use backend config as authority", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const safeModePanelSource = fs.readFileSync(path.join(ROOT, "src/shell/SafeModeSettingsPanel.tsx"), "utf8");
  assert.match(appSource, /const DEFAULT_SAFE_MODE_PROFILE_THRESHOLDS: Record<string, number>/);
  assert.match(appSource, /const safeModeProfileThresholds = \{/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.privacy/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.balanced/);
  assert.match(appSource, /props\.state\.config\.safeModeProfiles\?\.permissive/);
  assert.match(appSource, /profileThresholds=\{safeModeProfileThresholds\}/);
  assert.match(safeModePanelSource, /safeModeThreshold: profileThresholds\[profile as keyof SafeModeProfileThresholds\]/);
  assert.doesNotMatch(appSource, /SAFE_MODE_PROFILE_THRESHOLDS\[profile\]/);
});

run("App ignore issue paths only changes visible draft after save succeeds", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const block = appSource.match(/async function ignoreIssuePaths\(paths: string\[\]\) \{[\s\S]*?\n  \}\n\n  function copySettingsProfile/);
  assert.ok(block, "ignoreIssuePaths should exist");
  assert.match(block[0], /const nextSettings: SettingsDraft = \{/);
  assert.match(block[0], /settingsDirtyRef\.current = false;[\s\S]*await invoke<AppState>\("Saving ignored files", "save_settings", settingsPayload\(nextSettings\)\);/);
  assert.match(block[0], /catch \{\s*settingsDirtyRef\.current = wasDirty;\s*setSettingsSaveStatus\("error"\);\s*\}/);
  assert.doesNotMatch(block[0], /setSettings\(nextSettings\)/);
});

run("Settings exposes persistent saved dirty saving and error states", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
  assert.match(appSource, /useState<"saved" \| "dirty" \| "saving" \| "error">\("saved"\)/);
  assert.match(appSource, /function updateSettingsDraft[\s\S]*?setSettingsSaveStatus\("dirty"\)/);
  assert.match(appSource, /async function saveSettingsDraftIfDirty[\s\S]*?setSettingsSaveStatus\("saving"\)[\s\S]*?setSettingsSaveStatus\("saved"\)[\s\S]*?setSettingsSaveStatus\("error"\)/);
  assert.match(appSource, /className=\{`settings-save-status is-\$\{props\.saveStatus\}`\}/);
  assert.match(appSource, /Discard unsaved settings and switch app folders/);
  assert.match(appSource, /Discard unsaved settings and open another app folder/);
  assert.match(styles, /\.settings-save-status\.is-dirty/);
  assert.match(styles, /\.settings-save-status\.is-saving/);
  assert.match(styles, /\.settings-save-status\.is-error/);
});

run("Photos safety explainer unavailable status shows backend reason", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /!explainResult\.available\s*\?\s*\(explainResult\.reason \? uiText\(explainResult\.reason\) : uiText\("No explainer model installed\. Add one in Settings/);
  assert.doesNotMatch(source, /!explainResult\.available\s*\?\s*uiText\("No explainer model installed\. Add one in Settings/);
});

run("Safe Mode review dashboard honors sensitive collection unlock before listing flagged photos", () => {
  const reviewSource = fs.readFileSync(path.join(ROOT, "src/views/SafeModeReview.tsx"), "utf8");
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const safeModePanelSource = fs.readFileSync(path.join(ROOT, "src/shell/SafeModeSettingsPanel.tsx"), "utf8");
  const i18nSource = fs.readFileSync(path.join(ROOT, "src/i18n.ts"), "utf8");
  const localeSources = ["zh", "es", "fr", "ar", "hi", "ja"]
    .map((language) => fs.readFileSync(path.join(ROOT, `src/i18n/locales/${language}.ts`), "utf8"))
    .join("\n");
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
  assert.match(safeModePanelSource, /<SafeModeReview[\s\S]*uiText=\{uiText\}/);
  assert.match(safeModePanelSource, /getSensitiveAuthStatus=\{getSensitiveAuthStatus\}/);
  assert.match(safeModePanelSource, /authenticateSensitiveAccess=\{authenticateSensitiveAccess\}/);
  assert.match(safeModePanelSource, /uiText\("Safe Mode profile"\)/);
  assert.match(safeModePanelSource, /uiText\("Calibrate to your library"\)/);
  assert.match(safeModePanelSource, /uiText\("Review flagged photos"\)/);
  assert.match(i18nSource, /safeModeReviewLiterals\?: Record<string, string>/);
  assert.ok((localeSources.match(/"Review flagged photos":/g) || []).length >= 6);
  assert.ok((localeSources.match(/"Not sensitive":/g) || []).length >= 6);
  assert.ok((localeSources.match(/"Keep hidden":/g) || []).length >= 6);
  assert.ok((localeSources.match(/"Safe Mode profile":/g) || []).length >= 6);
  assert.ok((localeSources.match(/"Calibrate to your library":/g) || []).length >= 6);
});

run("Safe Mode category guardrail is configurable, installable, and reviewable", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const settingsSource = fs.readFileSync(path.join(ROOT, "src/appSettings.ts"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/shell/SafeModeSettingsPanel.tsx"), "utf8");
  const reviewSource = fs.readFileSync(path.join(ROOT, "src/views/SafeModeReview.tsx"), "utf8");
  const phraseSource = fs.readFileSync(path.join(ROOT, "src/i18n/safeModeGuardrailPhrases.ts"), "utf8");
  assert.match(settingsSource, /safeModeMultimodal\?: boolean/);
  assert.match(settingsSource, /left\.safeModeMultimodal \?\? false/);
  assert.match(appSource, /safeModeMultimodal: booleanSetting\(rawConfig\.safeModeMultimodal/);
  assert.match(appSource, /safeModeMultimodal: draft\.safeModeMultimodal \?\? false/);
  assert.match(appSource, /props\.state\.config\.safeModeMultimodal \?\? false/);
  assert.match(appSource, /safeModeModel=\{safeModel\}/);
  assert.match(panelSource, /checked=\{settings\.safeModeMultimodal \?\? false\}/);
  assert.match(panelSource, /setCustomSettings\(\{ safeModeMultimodal: event\.currentTarget\.checked \}\)/);
  assert.match(panelSource, /"photo_vlm_status", \{ tier: "quality" \}/);
  assert.match(panelSource, /"install_photo_vlm", \{ tier: "quality" \}/);
  assert.match(panelSource, /Category-aware local guardrail/);
  assert.match(panelSource, /Compatibility detector active/);
  assert.match(reviewSource, /categoryScores\?: Record<string, number>/);
  assert.match(reviewSource, /Policy category scores/);
  assert.match(reviewSource, /SAFE_MODE_CATEGORY_LABELS/);
  assert.strictEqual((phraseSource.match(/"Category-aware local guardrail":/g) || []).length, 7);
  assert.strictEqual((phraseSource.match(/"Policy category scores":/g) || []).length, 7);
});

run("Photos route is lazy-loaded out of the initial renderer chunk", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(appSource, /const loadPhotosViewModule = \(\) => import\("\.\/views\/PhotosView"\)/);
  assert.match(appSource, /const PhotosView = lazy\(loadPhotosViewModule\)/);
  assert.doesNotMatch(appSource, /import \{ PhotosView \} from "\.\/views\/PhotosView"/);
  assert.match(appSource, /<Suspense fallback=\{<RouteFallback uiText=\{uiText\} label="Loading Photos" \/>\}>/);
});

run("Secondary routes and sensitive settings panels are lazy-loaded", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const safeModePanelSource = fs.readFileSync(path.join(ROOT, "src/shell/SafeModeSettingsPanel.tsx"), "utf8");
  assert.match(appSource, /const loadSearchViewModule = \(\) => import\("\.\/shell\/SearchView"\)/);
  assert.match(appSource, /const loadMcpAgentsPanelModule = \(\) => import\("\.\/shell\/McpAgentsPanel"\)/);
  assert.match(appSource, /const loadSafeModeSettingsPanelModule = \(\) => import\("\.\/shell\/SafeModeSettingsPanel"\)/);
  assert.match(appSource, /const SearchView = lazy\(loadSearchViewModule\)/);
  assert.match(appSource, /const McpAgentsPanel = lazy\(loadMcpAgentsPanelModule\)/);
  assert.match(appSource, /const SafeModeSettingsPanel = lazy\(loadSafeModeSettingsPanelModule\)/);
  assert.match(safeModePanelSource, /const SafeModeReview = lazy\(\(\) => import\("\.\.\/views\/SafeModeReview"\)\)/);
  assert.doesNotMatch(appSource, /import \{ SearchView \} from "\.\/shell\/SearchView"/);
  assert.doesNotMatch(appSource, /import \{ McpAgentsPanel \} from "\.\/shell\/McpAgentsPanel"/);
  assert.doesNotMatch(appSource, /import SafeModeReview from "\.\/views\/SafeModeReview"/);
  assert.doesNotMatch(appSource, /const SafeModeReview = lazy/);
  assert.match(appSource, /<Suspense fallback=\{<RouteFallback uiText=\{uiText\} label="Loading Search" \/>\}>/);
  assert.match(appSource, /<Suspense fallback=\{<RouteFallback uiText=\{props\.uiText\} label="Loading AI Agents" \/>\}>/);
  assert.match(safeModePanelSource, /safeReviewOpen && \(\s*<Suspense fallback=\{<RouteFallback uiText=\{uiText\} label="Loading Safe Mode review" \/>\}>/);
});

run("SearchView invalidates stale in-flight requests", () => {
  const searchSource = fs.readFileSync(path.join(ROOT, "src/shell/SearchView.tsx"), "utf8");
  assert.match(searchSource, /if \(!active\) return;[\s\S]*searchInputRef\.current\?\.focus\(\)/);
  assert.match(searchSource, /const searchRequestSeqRef = useRef\(0\);/);
  assert.match(searchSource, /function invalidateSearchResults\(\) \{\s*searchRequestSeqRef\.current \+= 1;/);
  assert.match(searchSource, /const requestSeq = searchRequestSeqRef\.current \+ 1;/);
  assert.match(searchSource, /const isCurrentSearch = \(\) => searchRequestSeqRef\.current === requestSeq;/);
  assert.match(searchSource, /if \(!isCurrentSearch\(\)\) return;[\s\S]*setSemanticResult\(result\)/);
  assert.match(searchSource, /if \(!isCurrentSearch\(\)\) return;[\s\S]*setTextResult\(result\)/);
  assert.match(searchSource, /finally \{\s*if \(isCurrentSearch\(\)\) setBusy\(false\);/);
  assert.match(searchSource, /onClick=\{\(\) => \{\s*invalidateSearchResults\(\);[\s\S]*setBusy\(false\);/);
});

run("i18n locale bundles are loaded on demand", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const mainSource = fs.readFileSync(path.join(ROOT, "src/main.tsx"), "utf8");
  const i18nSource = fs.readFileSync(path.join(ROOT, "src/i18n.ts"), "utf8");
  const viteSource = fs.readFileSync(path.join(ROOT, "vite.config.ts"), "utf8");
  assert.match(i18nSource, /export async function preloadLanguage/);
  assert.match(i18nSource, /const localeLoaders: Record<LazyLanguageCode/);
  assert.match(i18nSource, /zh: \(\) => import\("\.\/i18n\/locales\/zh"\)/);
  assert.doesNotMatch(i18nSource, /const translations: Record<LanguageCode, TranslationTable>/);
  assert.doesNotMatch(i18nSource, /const uiPhraseTranslations: Record<LanguageCode/);
  assert.match(mainSource, /await preloadLanguage\(language\);/);
  assert.match(appSource, /preloadLanguage\(nextLanguage\)\.finally/);
  assert.match(appSource, /languageLoadSeqRef/);
  assert.match(viteSource, /i18n-\$\{localeMatch\[1\]\}/);
});

run("settings subpanels are extracted from App", () => {
  const appSource = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  const panelSource = fs.readFileSync(path.join(ROOT, "src/shell/McpAgentsPanel.tsx"), "utf8");
  const safeModePanelSource = fs.readFileSync(path.join(ROOT, "src/shell/SafeModeSettingsPanel.tsx"), "utf8");
  assert.match(appSource, /const McpAgentsPanel = lazy\(loadMcpAgentsPanelModule\)/);
  assert.match(appSource, /<McpAgentsPanel active copyText=\{props\.copyText\} uiText=\{props\.uiText\} variant="settings" \/>/);
  assert.doesNotMatch(appSource, /function McpAgentsPanel/);
  assert.match(panelSource, /export function McpAgentsPanel/);
  assert.match(panelSource, /export function McpAgentsPanel\(\{ active,/);
  assert.match(panelSource, /variant === "destination"/);
  assert.match(panelSource, /useEffect\(\(\) => \{\s*if \(!active\) return;/);
  assert.match(panelSource, /agent-platform\.json/);
  assert.match(panelSource, /agent-capability-grid/);
  assert.match(panelSource, /agent-recipe-grid/);
  assert.match(panelSource, /agent-connection-grid/);
  assert.match(appSource, /activeTab === "agents"/);
  assert.match(appSource, /<AgentDiscoveryBanner/);
  assert.match(panelSource, /getMcpConnectionInfo\(\)/);
  assert.match(panelSource, /onMcpHttpStatus/);
  assert.match(panelSource, /revealOrBuildMcpBundle/);
  assert.match(appSource, /const SafeModeSettingsPanel = lazy\(loadSafeModeSettingsPanelModule\)/);
  assert.match(appSource, /<SafeModeSettingsPanel[\s\S]{0,500}profileThresholds=\{safeModeProfileThresholds\}/);
  assert.doesNotMatch(appSource, /async function calibrateSafeModeFromFolders/);
  assert.doesNotMatch(appSource, /async function installExplainerFromFile/);
  assert.match(safeModePanelSource, /export function SafeModeSettingsPanel/);
  assert.match(safeModePanelSource, /calibrate_safe_mode/);
  assert.match(safeModePanelSource, /install_safety_explainer/);
  assert.match(safeModePanelSource, /SafeModeReview/);
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

run("photo nearby filters normalize item and saved-filter coordinates", () => {
  assert.deepStrictEqual(nearbyFiltersMod.PHOTO_NEARBY_RADIUS_OPTIONS, ["5", "25", "100"]);
  assert.strictEqual(nearbyFiltersMod.parsePhotoNearbyCoordinate("", -90, 90), null);
  assert.strictEqual(nearbyFiltersMod.hasPhotoNearbyCoordinateText(""), false);
  assert.strictEqual(nearbyFiltersMod.hasPhotoNearbyCoordinateText(" 0 "), true);
  assert.deepStrictEqual(
    nearbyFiltersMod.photoItemCoordinates({
      locationOverride: { latitude: "37.7749", longitude: "-122.4194" },
      assetMetadata: { exif: { gps: { latitude: "1", longitude: "2" } } },
    }),
    { latitude: 37.7749, longitude: -122.4194 },
  );
  assert.deepStrictEqual(
    nearbyFiltersMod.photoItemCoordinates({
      assetMetadata: { exif: { gps: { lat: "48.8566", lng: "2.3522" } } },
    }),
    { latitude: 48.8566, longitude: 2.3522 },
  );
  assert.strictEqual(
    nearbyFiltersMod.photoItemCoordinates({
      locationHidden: true,
      locationOverride: { latitude: "37.7749", longitude: "-122.4194" },
    }),
    null,
  );

  const itemFilter = nearbyFiltersMod.photoNearbyFilterFromItem({
    locationOverride: { latitude: "37.77491234", longitude: "-122.41945678" },
  }, "Lightbox photo");
  assert.deepStrictEqual(itemFilter, {
    latitude: "37.774912",
    longitude: "-122.419457",
    radiusKm: "25",
    label: "Lightbox photo",
  });
  assert.strictEqual(nearbyFiltersMod.photoNearbyFilterKey(itemFilter), "37.774912|-122.419457|25");
  assert.strictEqual(nearbyFiltersMod.photoNearbyFilterLabel(itemFilter), "Lightbox photo (25 km)");
  assert.deepStrictEqual(nearbyFiltersMod.photoNearbyFilterParams(itemFilter), {
    nearbyLatitude: "37.774912",
    nearbyLongitude: "-122.419457",
    nearbyRadiusKm: "25",
  });

  assert.strictEqual(nearbyFiltersMod.photoNearbyFilterFromSavedFilterState({
    nearbyLatitude: "",
    nearbyLongitude: "",
    nearbyRadiusKm: "",
  }), null);
  assert.deepStrictEqual(nearbyFiltersMod.photoNearbyFilterFromSavedFilterState({
    nearbyLatitude: "0",
    nearbyLongitude: "0",
    nearbyRadiusKm: "500",
    nearbyLabel: "",
  }), {
    latitude: "0",
    longitude: "0",
    radiusKm: "25",
    label: "Saved nearby",
  });

  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeLocationPayload({
    sourcePath: " /Photos/IMG_0001.JPG ",
    assetId: " asset-1 ",
    latitude: "37.77491234",
    longitude: "-122.41945678",
    apply: true,
  }), {
    latitude: 37.77491234,
    longitude: -122.41945678,
    apply: true,
    sourcePath: "/Photos/IMG_0001.JPG",
    assetId: "asset-1",
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeLocationPayload({
    latitude: 48.8566,
    longitude: 2.3522,
    assetIds: [" asset-a ", "", null, "asset-b", "asset-a"],
    sourcePaths: ["/Photos/a.jpg", " ", "/Photos/b.jpg"],
    apply: false,
  }), {
    latitude: 48.8566,
    longitude: 2.3522,
    apply: false,
    sourcePaths: ["/Photos/a.jpg", "/Photos/b.jpg"],
    assetIds: ["asset-a", "asset-b"],
  });
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeLocationPayload({
    latitude: "",
    longitude: 2.3522,
  }), null);
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeItemCoordinates({
    assetMetadata: { exif: { gps: { latitude: "1", longitude: "2" } } },
  }, {
    latitudeDraft: "37.7749",
    longitudeDraft: "-122.4194",
  }), {
    latitude: 37.7749,
    longitude: -122.4194,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeItemCoordinates({
    assetMetadata: { exif: { gps: { latitude: "48.8566", longitude: "2.3522" } } },
  }), {
    latitude: 48.8566,
    longitude: 2.3522,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeItemCoordinates({
    assetMetadata: { gps: { latitude: "34.0522", longitude: "-118.2437" } },
  }), {
    latitude: 34.0522,
    longitude: -118.2437,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeItemCoordinates({
    assetMetadata: { exif: { gps: { latitude: "48.8566", longitude: "2.3522" } } },
  }, {
    latitudeDraft: "bad",
    longitudeDraft: "",
  }), {
    latitude: 48.8566,
    longitude: 2.3522,
  });
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeItemCoordinates({
    assetMetadata: { exif: { gps: { latitude: "48.8566" } } },
  }), null);
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "lightbox",
    activeScope: "place",
    result: { ok: true, label: "Paris" },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "");
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "place",
    activeScope: "place",
    error: "Network lookups disabled",
    result: { ok: true, label: "Paris" },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "Network lookups disabled");
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "place",
    activeScope: "place",
    result: { ok: false, message: "Place lookup failed." },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "Place lookup failed.");
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "place",
    activeScope: "place",
    result: { ok: true, label: " Paris " },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "Found Paris");
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "lightbox",
    activeScope: "lightbox",
    result: { ok: true, label: "Paris", applied: true },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "Applied Paris");
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeStatusText({
    scope: "lightbox",
    activeScope: "lightbox",
    result: { ok: true, label: " " },
    foundLabel: "Found",
    appliedLabel: "Applied",
  }), "");
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeMetadataPatches([
    {
      sourcePath: "/Photos/IMG_0001.JPG",
      locationOverride: { label: "Paris", latitude: "48.8566", longitude: "2.3522" },
      locationHidden: false,
    },
    {
      sourcePath: "",
      locationOverride: { label: "Skipped" },
      locationHidden: true,
    },
    {
      sourcePath: "/Photos/IMG_0002.JPG",
      locationOverride: "bad",
      locationHidden: "yes",
    },
  ]), [
    {
      sourcePath: "/Photos/IMG_0001.JPG",
      patch: {
        locationOverride: { label: "Paris", latitude: "48.8566", longitude: "2.3522" },
        locationHidden: false,
      },
    },
    {
      sourcePath: "/Photos/IMG_0002.JPG",
      patch: {
        locationOverride: {},
        locationHidden: true,
      },
    },
  ]);
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeMetadataPatches(null), []);
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodePlaceLookupState({
    source: "exif",
    latitude: "48.8566",
    longitude: "2.3522",
    assetIds: [" asset-a ", "", null, "asset-b", "asset-a"],
  }), {
    latitude: 48.8566,
    longitude: 2.3522,
    assetIds: ["asset-a", "asset-b"],
    canLookupName: true,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodePlaceLookupState({
    source: "user",
    latitude: "48.8566",
    longitude: "2.3522",
    assetIds: ["asset-a"],
  }), {
    latitude: 48.8566,
    longitude: 2.3522,
    assetIds: ["asset-a"],
    canLookupName: false,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodePlaceLookupState({
    source: "exif",
    latitude: "bad",
    longitude: "2.3522",
    assetIds: [" "],
  }), {
    latitude: null,
    longitude: 2.3522,
    assetIds: [],
    canLookupName: false,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodePlaceLookupState(null), {
    latitude: null,
    longitude: null,
    assetIds: [],
    canLookupName: false,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeAppliedLocationDraft({
    ok: true,
    label: " Paris ",
    latitude: "48.8566",
    longitude: "2.3522",
  }, {
    latitude: 37.7749,
    longitude: -122.4194,
  }), {
    label: " Paris ",
    latitude: "48.8566",
    longitude: "2.3522",
    locationHidden: false,
  });
  assert.deepStrictEqual(nearbyFiltersMod.photoReverseGeocodeAppliedLocationDraft({
    ok: true,
    label: "",
    latitude: "",
    longitude: "",
  }, {
    latitude: 37.7749,
    longitude: -122.4194,
  }), {
    label: "",
    latitude: "37.7749",
    longitude: "-122.4194",
    locationHidden: false,
  });
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeRetryDelayMs(0), 200);
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeRetryDelayMs(1), 350);
  assert.strictEqual(nearbyFiltersMod.photoReverseGeocodeRetryDelayMs(99), 1000);
});

await runAsync("photo reverse geocode polling waits for pending lookup results", async () => {
  const params = { latitude: 48.8566, longitude: 2.3522 };
  const calls = [];
  const delays = [];
  const result = await nearbyFiltersMod.photoReverseGeocodeSettledResult({
    params,
    pendingMessage: "Place lookup is still running.",
    reverseGeocodePhotoLocation: async (nextParams) => {
      calls.push(nextParams);
      return calls.length < 3
        ? { value: { ok: false, pending: true } }
        : { value: { ok: true, label: "Paris" } };
    },
    wait: async (delayMs) => {
      delays.push(delayMs);
    },
  });
  assert.deepStrictEqual(result, { ok: true, label: "Paris" });
  assert.deepStrictEqual(calls, [params, params, params]);
  assert.deepStrictEqual(delays, [200, 350]);

  const exhaustedDelays = [];
  const exhausted = await nearbyFiltersMod.photoReverseGeocodeSettledResult({
    params,
    pendingMessage: "Still pending",
    attempts: 2,
    reverseGeocodePhotoLocation: async () => ({ value: { ok: false, pending: true, message: "Waiting" } }),
    wait: async (delayMs) => {
      exhaustedDelays.push(delayMs);
    },
  });
  assert.deepStrictEqual(exhausted, { ok: false, pending: true, message: "Waiting" });
  assert.deepStrictEqual(exhaustedDelays, [200, 350]);
});

run("photo places map projects valid place folders", () => {
  assert.deepStrictEqual(placesMapMod.PHOTO_PLACE_MAP_CLUSTER_RADII, [10, 7, 4, 0]);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(0), 10);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(1), 10);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(2), 7);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(3), 4);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(4), 0);
  assert.strictEqual(placesMapMod.placeMapClusterRadius(99), 0);
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
  assert.deepStrictEqual(placesMapMod.photoPlaceMapActiveNearby(points, "place:sf", 1).map((point) => point.folderId), ["place:oak"]);
  assert.deepStrictEqual(placesMapMod.photoPlaceMapActiveNearby(points, "", 2), []);
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
  assert.deepStrictEqual(placesMapMod.photoPlaceMapRadiusCenter({
    latitude: "37.7749",
    longitude: "-122.4194",
    radiusKm: "",
    label: "Nearby",
  }), {
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 25,
  });
  assert.deepStrictEqual(placesMapMod.photoPlaceMapRadiusCenter({
    latitude: "37.7749",
    longitude: "-122.4194",
    radiusKm: "0",
    label: "Nearby",
  }), {
    latitude: 37.7749,
    longitude: -122.4194,
    radiusKm: 0,
  });
  assert.strictEqual(placesMapMod.photoPlaceMapRadiusCenter({
    latitude: "bad",
    longitude: "-122.4194",
    radiusKm: "25",
    label: "Nearby",
  }), null);
  assert.strictEqual(placesMapMod.photoPlaceMapRadiusCenter(null), null);
  assert.strictEqual(placesMapMod.photoPlaceMapPanelVisible("places", null, null, points.length), true);
  assert.strictEqual(placesMapMod.photoPlaceMapPanelVisible("all", { id: "place:sf" }, null, points.length), true);
  assert.strictEqual(placesMapMod.photoPlaceMapPanelVisible("all", null, overlay, points.length), true);
  assert.strictEqual(placesMapMod.photoPlaceMapPanelVisible("all", null, null, points.length), false);
  assert.strictEqual(placesMapMod.photoPlaceMapPanelVisible("places", null, null, 0), false);
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

run("photo places map separates colliding pin hit targets deterministically", () => {
  const cluster = (clusterId, name, photoCount, x, y) => ({
    clusterId,
    points: [],
    representative: { name },
    placeCount: 1,
    photoCount,
    x,
    y,
    coverPreviewPath: null,
    coverPreviewUrl: "",
  });
  const clusters = [
    cluster("place:a", "Alpha", 2, 12, 88),
    cluster("place:b", "Beta", 1, 12.4, 87.8),
    cluster("place:c", "Far", 1, 80, 20),
  ];
  const offsets = placesMapMod.buildPhotoPlaceMapPinOffsets(clusters);
  const repeated = placesMapMod.buildPhotoPlaceMapPinOffsets([...clusters].reverse());
  assert.deepStrictEqual(offsets, repeated);
  assert(Math.hypot(
    offsets["place:a"].offsetX - offsets["place:b"].offsetX,
    offsets["place:a"].offsetY - offsets["place:b"].offsetY,
  ) >= 40, offsets);
  assert.deepStrictEqual(offsets["place:c"], { offsetX: 0, offsetY: 0 });
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
  assert.deepStrictEqual(placesMapMod.photoPlaceMapDensityAreas(cells, 3).map((cell) => cell.cellId), cells
    .slice()
    .sort((left, right) => right.photoCount - left.photoCount || right.placeCount - left.placeCount || left.representative.name.localeCompare(right.representative.name))
    .map((cell) => cell.cellId));
  assert.deepStrictEqual(placesMapMod.photoPlaceMapDensityAreas(cells, cells.length).map((cell) => cell.placeCount), [2]);
  assert.deepStrictEqual(placesMapMod.photoPlaceMapDensityAreas(cells, 3, 1).map((cell) => cell.placeCount), [2]);
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

run("Photos place map state uses shared helper derivations", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  const placesMapSource = fs.readFileSync(path.join(ROOT, "src/views/photoPlacesMap.ts"), "utf8");
  const placeMapPanelSource = fs.readFileSync(path.join(ROOT, "src/views/photoPlaceMapPanel.tsx"), "utf8");
  assert.match(placesMapSource, /export function photoPlaceMapDensityAreas/);
  assert.match(placesMapSource, /export function photoPlaceMapRadiusCenter/);
  assert.match(placesMapSource, /export function photoPlaceMapActiveNearby/);
  assert.match(placesMapSource, /export function photoPlaceMapPanelVisible/);
  assert.match(placeMapPanelSource, /export function PhotoPlaceMapPanel/);
  assert.match(placeMapPanelSource, /PHOTO_PLACE_MAP_CLUSTER_RADII\.length/);
  assert.match(placeMapPanelSource, /props\.visibleClusters\.map/);
  assert.match(placeMapPanelSource, /props\.densityCells\.map/);
  assert.match(placeMapPanelSource, /photo-place-map-panel/);
  assert.match(placeMapPanelSource, /props\.uiText\("Places map"\)/);
  assert.match(source, /PhotoPlaceMapPanel/);
  assert.match(source, /points=\{placeMapPoints\}/);
  assert.match(source, /visibleClusters=\{placeMapVisibleClusters\}/);
  assert.match(source, /onOpenPlace=\{setActiveId\}/);
  assert.match(source, /photoPlaceMapDensityAreas\(placeMapDensityCells, placeMapPoints\.length\)/);
  assert.match(source, /photoPlaceMapRadiusCenter\(nearbyFilter\)/);
  assert.match(source, /photoPlaceMapActiveNearby\(placeMapPoints, activePlace\?\.id, 4\)/);
  assert.match(source, /photoPlaceMapPanelVisible\(active\?\.id, activePlace, placeMapRadiusOverlay, placeMapPoints\.length\)/);
  assert.doesNotMatch(source, /photo-place-map-panel/);
  assert.doesNotMatch(source, /photo-place-map-mode-control/);
  assert.doesNotMatch(source, /placeMapVisibleClusters\.map/);
  assert.doesNotMatch(source, /placeMapDensityCells\.map/);
  assert.doesNotMatch(source, /parsePhotoNearbyCoordinate\(nearbyFilter\.latitude/);
  assert.doesNotMatch(source, /placeMapDensityCells\s*\.filter\(\(cell\) => cell\.placeCount > 1/);
  assert.doesNotMatch(source, /activePlace \? nearbyPhotoPlaces\(placeMapPoints, activePlace\.id, 4\) : \[\]/);
  assert.doesNotMatch(source, /\(active\?\.id === "places" \|\| Boolean\(activePlace\) \|\| Boolean\(placeMapRadiusOverlay\)\) && placeMapPoints\.length > 0/);
});

run("Photos destination transitions preserve the expensive Library surface", () => {
  const source = fs.readFileSync(path.join(ROOT, "src/views/PhotosView.tsx"), "utf8");
  assert.match(source, /function CachedPhotoSurface\(/);
  assert.match(source, /render: \(\) => ReactNode/);
  assert.match(source, /if \(active && \(cached\.current === null \|\| !deferRefresh\.current\)\)/);
  assert.match(source, /<CachedPhotoSurface active=\{!showDedicatedDestination\} render=\{\(\) => \(/);
  assert.match(source, /returningFromDedicatedDestination && lastLoadedFolderIdRef\.current === activeId/);
  assert.match(source, /Dedicated Memories\/Albums\/People surfaces are alternate presentations/);
});

console.log("all photos_view tests passed");

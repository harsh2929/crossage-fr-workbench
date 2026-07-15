import { deferredPhotoComponent } from "./deferredPhotoComponent";

// Primary navigation destinations must be ready for the first interaction.
// React.lazy adds a Suspense retry delay even when a shared module is already
// cached, which made first visits to Albums and People visibly stall.
export { PhotoAlbumsGallery } from "./photoAlbumsGallery";
export { PhotoMemoriesFeed } from "./photoMemoriesFeed";
export { PhotoPeopleGallery } from "./photoPeopleGallery";

const loadDestinationSurfaces = () => import("./photoDeferredDestinationSurfaces");
export const PhotoRelationshipSuggestionsPanel = deferredPhotoComponent(
  () => loadDestinationSurfaces().then((module) => ({ default: module.PhotoRelationshipSuggestionsPanel })),
  "PhotoRelationshipSuggestionsPanel",
);

const loadSettingsSurfaces = () => import("./photoDeferredSettingsSurfaces");
export const PhotoBackupCheckPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoBackupCheckPanel })), "PhotoBackupCheckPanel",
);
export const PhotoBackupPolicyPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoBackupPolicyPanel })), "PhotoBackupPolicyPanel",
);
export const PhotoCurationPreferencesPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoCurationPreferencesPanel })),
  "PhotoCurationPreferencesPanel",
);
export const PhotoIndexingQueuePanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoIndexingQueuePanel })), "PhotoIndexingQueuePanel",
);
export const PhotoIntelligenceSettingsPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoIntelligenceSettingsPanel })),
  "PhotoIntelligenceSettingsPanel",
);
export const PhotoLibraryMediaDefaultsPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoLibraryMediaDefaultsPanel })),
  "PhotoLibraryMediaDefaultsPanel",
);
export const PhotoLocalIndexingStatusPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoLocalIndexingStatusPanel })),
  "PhotoLocalIndexingStatusPanel",
);
export const PhotoManagedRootsPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoManagedRootsPanel })), "PhotoManagedRootsPanel",
);
export const PhotoMediaPlaybackSettingsPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoMediaPlaybackSettingsPanel })),
  "PhotoMediaPlaybackSettingsPanel",
);
export const PhotoPrivacySettingsPanel = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoPrivacySettingsPanel })),
  "PhotoPrivacySettingsPanel",
);
export const PhotoRepairCenterSection = deferredPhotoComponent(
  () => loadSettingsSurfaces().then((module) => ({ default: module.PhotoRepairCenterSection })), "PhotoRepairCenterSection",
);

const loadLightboxSurfaces = () => import("./photoDeferredLightboxSurfaces");
export const PhotoGenerativeEditPanel = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoGenerativeEditPanel })),
  "PhotoGenerativeEditPanel",
);
export const PhotoLightboxBurstStrip = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxBurstStrip })), "PhotoLightboxBurstStrip",
);
export const PhotoLightboxCurationActions = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxCurationActions })),
  "PhotoLightboxCurationActions",
);
export const PhotoLightboxEditStackHistory = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxEditStackHistory })),
  "PhotoLightboxEditStackHistory",
);
export const PhotoLightboxFileActions = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxFileActions })), "PhotoLightboxFileActions",
);
export const PhotoLightboxPrimaryActions = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxPrimaryActions })),
  "PhotoLightboxPrimaryActions",
);
export const PhotoLightboxSafetyActions = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxSafetyActions })),
  "PhotoLightboxSafetyActions",
);
export const PhotoLightboxStage = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxStage })), "PhotoLightboxStage",
);
export const PhotoLightboxVideoActionBar = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxVideoActionBar })),
  "PhotoLightboxVideoActionBar",
);
export const PhotoVideoTranscriptPanel = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoVideoTranscriptPanel })),
  "PhotoVideoTranscriptPanel",
);
export const PhotoLightboxZoomControls = deferredPhotoComponent(
  () => loadLightboxSurfaces().then((module) => ({ default: module.PhotoLightboxZoomControls })),
  "PhotoLightboxZoomControls",
);

const loadSearchSurfaces = () => import("./photoDeferredSearchSurfaces");
export const PhotoBurstStackPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoBurstStackPanel })), "PhotoBurstStackPanel",
);
export const PhotoDuplicateReviewPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoDuplicateReviewPanel })),
  "PhotoDuplicateReviewPanel",
);
export const PhotoKeywordManagerPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoKeywordManagerPanel })), "PhotoKeywordManagerPanel",
);
export const PhotoLibraryAgentPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoLibraryAgentPanel })), "PhotoLibraryAgentPanel",
);
export const PhotoLibrarySearchPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoLibrarySearchPanel })), "PhotoLibrarySearchPanel",
);
export const PhotoPlaceMapPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoPlaceMapPanel })), "PhotoPlaceMapPanel",
);
export const PhotoSemanticSearchPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoSemanticSearchPanel })),
  "PhotoSemanticSearchPanel",
);
export const PhotoStoryEditorPanel = deferredPhotoComponent(
  () => loadSearchSurfaces().then((module) => ({ default: module.PhotoStoryEditorPanel })), "PhotoStoryEditorPanel",
);

const loadSlideshowSurfaces = () => import("./photoDeferredSlideshowSurfaces");
export const PhotoSlideshowOverlay = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowOverlay })), "PhotoSlideshowOverlay",
);
export const PhotoSlideshowProjectBasicsControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectBasicsControls })),
  "PhotoSlideshowProjectBasicsControls",
);
export const PhotoSlideshowProjectCaptionActionControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectCaptionActionControls })),
  "PhotoSlideshowProjectCaptionActionControls",
);
export const PhotoSlideshowProjectCaptionControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectCaptionControls })),
  "PhotoSlideshowProjectCaptionControls",
);
export const PhotoSlideshowProjectFramingControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectFramingControls })),
  "PhotoSlideshowProjectFramingControls",
);
export const PhotoSlideshowProjectKeyframeControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectKeyframeControls })),
  "PhotoSlideshowProjectKeyframeControls",
);
export const PhotoSlideshowProjectPlaybackControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectPlaybackControls })),
  "PhotoSlideshowProjectPlaybackControls",
);
export const PhotoSlideshowProjectTemplateControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectTemplateControls })),
  "PhotoSlideshowProjectTemplateControls",
);
export const PhotoSlideshowProjectTimelineControls = deferredPhotoComponent(
  () => loadSlideshowSurfaces().then((module) => ({ default: module.PhotoSlideshowProjectTimelineControls })),
  "PhotoSlideshowProjectTimelineControls",
);

const loadImportSurfaces = () => import("./photoDeferredImportSurfaces");
export const PhotoImportHistoryPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoImportHistoryPanel })), "PhotoImportHistoryPanel",
);
export const PhotoImportSessionPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoImportSessionPanel })), "PhotoImportSessionPanel",
);
export const PhotoIndexEverythingDialog = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoIndexEverythingDialog })),
  "PhotoIndexEverythingDialog",
);
export const PhotoRecoveredImportIssuesPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoRecoveredImportIssuesPanel })),
  "PhotoRecoveredImportIssuesPanel",
);
export const PhotoSourceImportPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoSourceImportPanel })), "PhotoSourceImportPanel",
);
export const PhotoCatalogPortabilityPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoCatalogPortabilityPanel })),
  "PhotoCatalogPortabilityPanel",
);
export const PhotoTetherPanel = deferredPhotoComponent(
  () => loadImportSurfaces().then((module) => ({ default: module.PhotoTetherPanel })), "PhotoTetherPanel",
);

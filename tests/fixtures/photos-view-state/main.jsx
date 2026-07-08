import React from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { ToastProvider, ToastHost } from "../../../src/shell/ToastHost";
import { PhotosView } from "../../../src/views/PhotosView";

const PHOTOS = [
  {
    id: "asset-sunrise",
    assetId: "asset-sunrise",
    sourcePath: "/library/2026/mountain-sunrise.jpg",
    previewUrl: "",
    sourceUrl: "",
    mediaKind: "image",
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    title: "Mountain Sunrise",
    caption: "Dawn over the ridge",
    favorite: true,
    edited: false,
    captureDate: "2026-07-01T06:10:00Z",
    addedAt: "2026-07-01T07:00:00Z",
    updatedAt: "2026-07-01T07:00:00Z",
    score: 0.98,
    quality: 0.93,
    candidateIds: [],
    people: [],
    personCount: 0,
  },
  {
    id: "asset-receipt",
    assetId: "asset-receipt",
    sourcePath: "/library/2026/cafe-receipt.jpg",
    previewUrl: "",
    sourceUrl: "",
    mediaKind: "image",
    mimeType: "image/jpeg",
    width: 1200,
    height: 900,
    title: "Cafe Receipt",
    caption: "Expense capture",
    favorite: false,
    edited: true,
    captureDate: "2026-07-02T12:15:00Z",
    addedAt: "2026-07-02T13:00:00Z",
    updatedAt: "2026-07-02T13:00:00Z",
    score: 0.72,
    quality: 0.81,
    candidateIds: [],
    people: [],
    personCount: 0,
  },
];

const calls = [];

function recordCall(name, params = {}) {
  calls.push({
    name,
    params: JSON.parse(JSON.stringify(params || {})),
    at: Date.now(),
  });
}

function emptyValue(value = {}) {
  return Promise.resolve({ value });
}

function filterPhotos(params = {}) {
  const query = String(params.query || "").trim().toLowerCase();
  return PHOTOS.filter((item) => {
    if (params.favoriteOnly && !item.favorite) return false;
    if (params.editedOnly && !item.edited) return false;
    if (query) {
      const haystack = [item.title, item.caption, item.sourcePath].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function photoItemsPage(params = {}) {
  recordCall("listPhotoFolderItems", params);
  const offset = Math.max(0, Number(params.offset || 0));
  const limit = Math.max(1, Number(params.limit || 50));
  const rows = filterPhotos(params);
  const items = rows.slice(offset, offset + limit);
  return Promise.resolve({
    total: rows.length,
    offset,
    limit,
    returned: items.length,
    items,
    searchIndex: {
      completed: true,
      assetCount: PHOTOS.length,
      indexCount: PHOTOS.length,
    },
  });
}

function searchPhotoLibrary(params = {}) {
  recordCall("searchPhotoLibrary", params);
  const rows = filterPhotos(params);
  return Promise.resolve({
    query: String(params.query || ""),
    total: rows.length,
    items: rows.map((item) => ({
      kind: "photo",
      id: item.id,
      sourcePath: item.sourcePath,
      title: item.title,
      searchText: item.title,
      previewUrl: item.previewUrl,
    })),
    suggestions: rows.map((item) => item.title),
    searchIndex: {
      completed: true,
      assetCount: PHOTOS.length,
      indexCount: PHOTOS.length,
    },
  });
}

const noop = () => undefined;
const asyncNoop = () => Promise.resolve(undefined);
const nullAsync = () => Promise.resolve(null);

const props = {
  initialActiveId: "all",
  visibleRailSections: ["library"],
  listPhotoFolders: async (params = {}) => {
    recordCall("listPhotoFolders", params);
    return {
      folders: [
        {
          id: "all",
          kind: "utility",
          name: "All Photos",
          count: PHOTOS.length,
          coverSourcePath: PHOTOS[0].sourcePath,
          coverPreviewUrl: "",
        },
        {
          id: "favorites",
          kind: "utility",
          name: "Favorites",
          count: 1,
          coverSourcePath: PHOTOS[0].sourcePath,
          coverPreviewUrl: "",
        },
      ],
    };
  },
  listPhotoFolderItems: photoItemsPage,
  listPhotoDateBuckets: async (params = {}) => {
    recordCall("listPhotoDateBuckets", params);
    return {
      buckets: [],
      searchIndex: { completed: true, assetCount: PHOTOS.length, indexCount: PHOTOS.length },
    };
  },
  searchPhotoLibrary,
  getPhotoColorProfileStatus: () => emptyValue({ source: null, selected: null }),
  validatePhotoColorProfile: () => emptyValue({ available: true }),
  listPhotoBurstStacks: () => emptyValue({ stacks: [] }),
  setPhotoBurstSelection: () => emptyValue({}),
  listPhotoKeywords: () => emptyValue({ keywords: [] }),
  savePhotoKeyword: () => emptyValue({ keywordId: "keyword", name: "keyword", count: 0 }),
  deletePhotoKeyword: () => emptyValue({ keywordId: "keyword", name: "keyword", removedAssignments: 0, deleted: true }),
  exportPhotoKeywords: () => emptyValue({ path: "", exported: 0, format: "json", generatedAt: "", keywords: [] }),
  importPhotoKeywords: () => emptyValue({ imported: 0, created: 0, updated: 0, skipped: 0, keywords: [] }),
  listPhotoSavedFilters: () => emptyValue({ filters: [] }),
  savePhotoSavedFilter: () => emptyValue({}),
  deletePhotoSavedFilter: () => emptyValue({}),
  mergePhotoDuplicates: () => emptyValue({ groupId: "", keptAssetId: "", deletedAssetIds: [], merged: 0, deletedAt: "" }),
  dismissPhotoDuplicateGroup: () => emptyValue({ groupId: "", dismissed: true }),
  savePhotoPersonProfile: () => emptyValue({}),
  savePhotoPetProfile: () => emptyValue({}),
  savePhotoPlaceProfile: () => emptyValue({}),
  savePhotoUtilityProfile: () => emptyValue({}),
  renamePhotoPet: () => emptyValue({}),
  assignPhotoPet: () => emptyValue({}),
  dismissPhotoPetReview: () => emptyValue({}),
  savePhotoPeopleGroup: () => emptyValue({}),
  deletePhotoPeopleGroup: () => emptyValue({}),
  savePhotoAlbum: () => emptyValue({}),
  previewPhotoAlbumRules: () => emptyValue({ count: 0, previewSamples: [], validation: [] }),
  deletePhotoAlbum: () => emptyValue({}),
  mergePhotoAlbums: () => emptyValue({}),
  migratePhotoSmartAlbums: () => emptyValue({ migrated: 0, albums: [] }),
  savePhotoAlbumFolder: () => emptyValue({}),
  deletePhotoAlbumFolder: () => emptyValue({}),
  movePhotoAlbumToFolder: () => emptyValue({}),
  reorderPhotoAlbumFolderChildren: () => emptyValue({}),
  addPhotoAlbumItems: () => emptyValue({}),
  removePhotoAlbumItems: () => emptyValue({}),
  reorderPhotoAlbumItems: () => emptyValue({}),
  updatePhotoAssetMetadata: () => emptyValue({}),
  updatePhotoAssetsMetadata: () => emptyValue({ items: [], updated: 0, changed: 0 }),
  reverseGeocodePhotoLocation: () => emptyValue({}),
  getPhotoEditStack: () => emptyValue({ assetId: "", sourcePath: "", operations: [] }),
  getPhotoEditStacks: () => emptyValue({ items: [], requested: 0, returned: 0, failed: 0, failures: [], truncated: false }),
  savePhotoEditStack: () => emptyValue({ assetId: "", sourcePath: "", operations: [] }),
  savePhotoEditStacks: () => emptyValue({ items: [], requested: 0, saved: 0, failed: 0, failures: [], truncated: false }),
  revertPhotoEditStack: () => emptyValue({ assetId: "", sourcePath: "", operations: [] }),
  listPhotoEditStackVersions: () => emptyValue({ assetId: "", sourcePath: "", versions: [] }),
  createPhotoEditStackVersion: () => emptyValue({ versionId: "", operations: [] }),
  restorePhotoEditStackVersion: () => emptyValue({ version: { versionId: "", operations: [] }, stack: { assetId: "", sourcePath: "", operations: [] }, hasStack: false }),
  deletePhotoEditStackVersion: () => emptyValue({ versionId: "", assetId: "", sourcePath: "", deleted: 0 }),
  duplicatePhotoAssetVersion: () => emptyValue({}),
  duplicatePhotoAssetRenderedVersion: () => emptyValue({}),
  recordPhotoAssetEvent: () => emptyValue({ recorded: 1, summary: {} }),
  applyPhotoVisibilityOperation: () => emptyValue({ action: "", affected: 0, operation: null }),
  listPhotoOperations: () => emptyValue({ operations: [] }),
  photoRestoreRehearsal: () => emptyValue({ generatedAt: "", operationId: "", ok: true, status: "ready", counts: {}, operations: [], recommendations: [] }),
  photoBackupRestoreRehearsal: () => emptyValue({ generatedAt: "", ok: true, status: "ready", counts: {}, operations: [], recommendations: [] }),
  undoPhotoOperation: () => emptyValue({ undone: false, operation: null, restored: 0, missing: 0 }),
  permanentlyDeletePhotos: () => emptyValue({ selected: 0, deletedAssets: 0, deletedScanFiles: 0, deletedCandidates: 0, deletedFiles: 0, sourcePaths: [], assetIds: [], candidateIds: [], originalMediaDeleted: false }),
  suggestPhotoAlbums: () => emptyValue({ suggestions: [] }),
  listPhotoImportFailures: () => emptyValue({ failures: [], total: 0, activeTotal: 0 }),
  updatePhotoImportSessionProvenance: () => emptyValue({}),
  bulkUpdatePhotoImportSessionProvenance: () => emptyValue({ changed: 0, updated: [], missing: [], updatedAssets: 0 }),
  archivePhotoImportSessions: () => emptyValue({}),
  dismissPhotoImportFailure: () => emptyValue({}),
  retryPhotoImportFailure: () => emptyValue({}),
  saveRecoveredPhotoImportFailure: () => emptyValue({}),
  deleteRecoveredPhotoImportFailure: () => emptyValue({}),
  scanPhotoRecoveredOrphans: () => emptyValue({}),
  photoRecoveredCleanup: () => emptyValue({}),
  rebuildPhotoPreviews: () => emptyValue({}),
  photoLibraryPreviewSweep: () => emptyValue({}),
  relinkPhotoLibraryPaths: () => emptyValue({}),
  createPhotoMediaPair: () => emptyValue({}),
  relinkPhotoMediaPair: () => emptyValue({}),
  deletePhotoMediaPair: () => emptyValue({}),
  consolidatePhotoLibraryAssets: () => emptyValue({}),
  photoLibraryBackupCheck: () => emptyValue({}),
  photoLibraryCatalogCleanup: () => emptyValue({}),
  photoRepairHistory: () => emptyValue({}),
  photoLibrarySettings: () => emptyValue({
    localSettingsPersisted: true,
    localSettings: {},
    managedRoots: [],
    libraryRoots: [],
    activeLibraryRoot: "",
    activeLibraryRootProfileId: "",
  }),
  savePhotoLibrarySettings: () => emptyValue({
    localSettingsPersisted: true,
    localSettings: {},
    managedRoots: [],
    libraryRoots: [],
  }),
  indexPhotoOcr: () => emptyValue({}),
  photoOcrIndexStatus: () => emptyValue({}),
  indexPhotoBarcodes: () => emptyValue({}),
  photoBarcodeIndexStatus: () => emptyValue({}),
  indexPhotoObjects: () => emptyValue({}),
  photoObjectIndexStatus: () => emptyValue({}),
  enqueuePhotoIndexingJob: () => emptyValue({}),
  photoIndexingJobs: () => emptyValue({ jobs: [] }),
  runPhotoIndexingJob: () => emptyValue({}),
  runPhotoIndexingQueue: () => emptyValue({}),
  cancelPhotoIndexingJob: () => emptyValue({}),
  dismissPhotoIndexingJob: () => emptyValue({}),
  photoCurationPreferences: () => emptyValue({}),
  savePhotoCurationPreferences: () => emptyValue({}),
  photoUserMemories: () => emptyValue({ memories: [] }),
  savePhotoUserMemory: () => emptyValue({}),
  deletePhotoUserMemory: () => emptyValue({ memoryId: "", deleted: 0 }),
  listPhotoSlideshowProjects: () => emptyValue({ projects: [] }),
  listPhotoSlideshowThemeTemplates: () => emptyValue({ templates: [] }),
  savePhotoSlideshowThemeTemplate: () => emptyValue({}),
  deletePhotoSlideshowThemeTemplate: () => emptyValue({ id: "", deleted: 0 }),
  exportPhotoSlideshowThemeTemplates: () => emptyValue({ path: "", exported: 0, format: "json", generatedAt: "", templates: [] }),
  importPhotoSlideshowThemeTemplates: () => emptyValue({ imported: 0, created: 0, updated: 0, skipped: 0, templates: [] }),
  savePhotoSlideshowProject: () => emptyValue({}),
  deletePhotoSlideshowProject: () => emptyValue({ id: "", deleted: 0 }),
  exportPhotoSlideshow: nullAsync,
  exportPhotoMemoryMovie: nullAsync,
  importPhotos: nullAsync,
  photoSources: [],
  refreshPhotoSources: asyncNoop,
  chooseImportFiles: () => Promise.resolve([]),
  chooseImportFolder: nullAsync,
  chooseSlideshowAudioFile: nullAsync,
  chooseSlideshowTemplateLibraryFile: nullAsync,
  chooseColorProfileFile: nullAsync,
  getPathForFile: (file) => file.name,
  prepareImportPaths: (paths) => Promise.resolve(paths.map((path) => ({ path }))),
  revealPath: asyncNoop,
  openPath: asyncNoop,
  openPathWith: nullAsync,
  lastExternalEditorPath: "",
  externalEditors: [],
  forgetExternalEditor: asyncNoop,
  sharePaths: () => Promise.resolve({ shared: 0, paths: [] }),
  printPath: nullAsync,
  startFileDrag: nullAsync,
  getSensitiveAuthStatus: nullAsync,
  authenticateSensitiveAccess: nullAsync,
  exportPhotoSelection: nullAsync,
  exportPhotoContactSheet: nullAsync,
  exportPhotoVideoFrame: nullAsync,
  exportPhotoVideoTrim: nullAsync,
  exportPhotoLiveMotion: nullAsync,
  exportPhotoSubjectCutout: nullAsync,
  exportPhotoPortraitBlur: nullAsync,
  semanticSearchPhotos: nullAsync,
  setPhotoLiveKeyPhoto: nullAsync,
  resetPhotoLiveKeyPhoto: nullAsync,
  setPhotoVideoPoster: nullAsync,
  resetPhotoVideoPoster: nullAsync,
  exportPhotoMediaBundle: asyncNoop,
  manageCandidateMedia: asyncNoop,
  chooseDestinationFolder: nullAsync,
  openReviewForCandidates: noop,
  suggestPhotoReviewMoreCandidates: () => emptyValue({ suggestions: [] }),
  reviewCandidate: asyncNoop,
  blockFalseMatch: asyncNoop,
  reassignCandidatePerson: asyncNoop,
  renamePerson: asyncNoop,
  reviewCandidates: [],
  duplicatePeople: null,
  loadDuplicatePeople: asyncNoop,
  mergeDuplicatePeople: asyncNoop,
  people: [],
  uiText: (source) => source,
  formatNumber: (value) => new Intl.NumberFormat("en-US").format(value),
  copyText: noop,
  busy: false,
};

window.crossAge = {
  invoke: () => Promise.resolve({}),
};

window.__photosViewStateHarness = {
  calls,
  clearCalls: () => {
    calls.splice(0, calls.length);
  },
};

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ToastProvider>
      <PhotosView {...props} />
      <ToastHost />
    </ToastProvider>
  </React.StrictMode>
);

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

const BURST_PREVIEW = "data:image/gif;base64,R0lGODlhAQABAIAAAE2M5f///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const BURST_PHOTOS = [
  {
    id: "asset-burst-1",
    assetId: "asset-burst-1",
    sourcePath: "/library/2026/burst-frame-01.jpg",
    previewUrl: BURST_PREVIEW,
    sourceUrl: BURST_PREVIEW,
    mediaKind: "burst",
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    title: "Burst Frame 1",
    caption: "Sharp frame with directional movement",
    favorite: false,
    edited: false,
    captureDate: "2026-07-03T09:10:00.000Z",
    addedAt: "2026-07-03T10:00:00Z",
    updatedAt: "2026-07-03T10:00:00Z",
    score: 0.82,
    quality: 0.86,
    candidateIds: [],
    people: [],
    personCount: 0,
  },
  {
    id: "asset-burst-2",
    assetId: "asset-burst-2",
    sourcePath: "/library/2026/burst-frame-02.jpg",
    previewUrl: BURST_PREVIEW,
    sourceUrl: BURST_PREVIEW,
    mediaKind: "burst",
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    title: "Burst Frame 2",
    caption: "Balanced sharpness and motion clarity",
    favorite: false,
    edited: false,
    captureDate: "2026-07-03T09:10:00.080Z",
    addedAt: "2026-07-03T10:00:00Z",
    updatedAt: "2026-07-03T10:00:00Z",
    score: 0.95,
    quality: 0.91,
    candidateIds: [],
    people: [],
    personCount: 0,
  },
  {
    id: "asset-burst-3",
    assetId: "asset-burst-3",
    sourcePath: "/library/2026/burst-frame-03.jpg",
    previewUrl: BURST_PREVIEW,
    sourceUrl: BURST_PREVIEW,
    mediaKind: "burst",
    mimeType: "image/jpeg",
    width: 1600,
    height: 1200,
    title: "Burst Frame 3",
    caption: "Softer final frame",
    favorite: false,
    edited: false,
    captureDate: "2026-07-03T09:10:00.160Z",
    addedAt: "2026-07-03T10:00:00Z",
    updatedAt: "2026-07-03T10:00:00Z",
    score: 0.61,
    quality: 0.7,
    candidateIds: [],
    people: [],
    personCount: 0,
  },
];

const SEMANTIC_VIDEO_SCENARIO = new URLSearchParams(window.location.search).get("semanticVideo") === "1";
const RELATIONSHIP_SCENARIO = new URLSearchParams(window.location.search).get("relationships") === "1";
const SPATIAL_SCENARIO = new URLSearchParams(window.location.search).get("spatial") === "1";
const SEMANTIC_VIDEO = {
  id: "asset-video-sunset",
  assetId: "asset-video-sunset",
  sourcePath: "/library/2026/sunset-walk.mp4",
  previewUrl: BURST_PREVIEW,
  sourceUrl: "data:video/mp4;base64,AAAAHGZ0eXBpc29tAAACAGlzb20=",
  mediaKind: "video",
  mimeType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 4_000,
  title: "Sunset Walk",
  caption: "Warm sunset beside the lake",
  favorite: false,
  edited: false,
  captureDate: "2026-07-04T18:30:00Z",
  addedAt: "2026-07-04T19:00:00Z",
  updatedAt: "2026-07-04T19:00:00Z",
  score: 0.91,
  quality: 0.88,
  candidateIds: [],
  people: [],
  personCount: 0,
};
const SEMANTIC_VIDEO_AUDIO_SEGMENTS = [
  {
    segmentId: "speech-sunset-1",
    assetId: SEMANTIC_VIDEO.assetId,
    segmentKind: "speech",
    startMs: 0,
    endMs: 1800,
    timestampMs: 0,
    text: "We reached the lake at sunset.",
    label: "speech",
    confidence: 0.96,
    language: "en",
  },
  {
    segmentId: "sound-sunset-1",
    assetId: SEMANTIC_VIDEO.assetId,
    segmentKind: "sound",
    startMs: 200,
    endMs: 1200,
    timestampMs: 200,
    text: "",
    label: "music",
    confidence: 0.91,
    language: "",
  },
  {
    segmentId: "speech-sunset-2",
    assetId: SEMANTIC_VIDEO.assetId,
    segmentKind: "speech",
    startMs: 2000,
    endMs: 3600,
    timestampMs: 2000,
    text: "The sky turned gold.",
    label: "speech",
    confidence: 0.94,
    language: "en",
  },
  {
    segmentId: "sound-sunset-2",
    assetId: SEMANTIC_VIDEO.assetId,
    segmentKind: "sound",
    startMs: 2200,
    endMs: 3400,
    timestampMs: 2200,
    text: "",
    label: "waves",
    confidence: 0.88,
    language: "",
  },
];
if (SEMANTIC_VIDEO_SCENARIO) PHOTOS.push(SEMANTIC_VIDEO);
if (SPATIAL_SCENARIO) {
  PHOTOS.push(
    {
      id: "asset-spatial-paired",
      assetId: "asset-spatial-paired",
      sourcePath: "/library/2026/spatial-portrait.jpg",
      previewUrl: `${BURST_PREVIEW}#photo`,
      sourceUrl: `${BURST_PREVIEW}#photo`,
      mediaKind: "image",
      mimeType: "image/jpeg",
      width: 1600,
      height: 1200,
      title: "Spatial Portrait",
      caption: "Portrait with explicit depth and alternate-eye companions",
      favorite: false,
      edited: false,
      captureDate: "2026-07-05T10:00:00Z",
      addedAt: "2026-07-05T10:01:00Z",
      updatedAt: "2026-07-05T10:01:00Z",
      assetMetadata: { spatialPhoto: true, depthMap: "sidecar" },
      mediaPairs: [
        {
          pairId: "pair-depth",
          assetId: "asset-spatial-paired",
          pairKind: "depth_sidecar",
          relatedSourcePath: "/library/2026/spatial-portrait.depth.png",
          relatedSourceUrl: `${BURST_PREVIEW}#depth`,
          relatedExists: true,
        },
        {
          pairId: "pair-right-eye",
          assetId: "asset-spatial-paired",
          pairKind: "stereo_pair",
          relatedSourcePath: "/library/2026/spatial-portrait.right.jpg",
          relatedSourceUrl: `${BURST_PREVIEW}#right-eye`,
          relatedExists: true,
        },
      ],
      candidateIds: [],
      people: [],
      personCount: 0,
    },
    {
      id: "asset-spatial-metadata",
      assetId: "asset-spatial-metadata",
      sourcePath: "/library/2026/embedded-depth.heic",
      previewUrl: `${BURST_PREVIEW}#metadata`,
      sourceUrl: `${BURST_PREVIEW}#metadata`,
      mediaKind: "image",
      mimeType: "image/heic",
      width: 1200,
      height: 1600,
      title: "Embedded Depth",
      caption: "Metadata-only depth fixture",
      favorite: false,
      edited: false,
      captureDate: "2026-07-05T11:00:00Z",
      addedAt: "2026-07-05T11:01:00Z",
      updatedAt: "2026-07-05T11:01:00Z",
      assetMetadata: { xmp: { depthMap: "embedded" } },
      mediaPairs: [],
      candidateIds: [],
      people: [],
      personCount: 0,
    },
  );
}

const calls = [];
const itemDelaysByQuery = new Map();
const STORY_MEMORY = {
  memoryId: "memory-story-fixture",
  name: "Fixture Memory",
  subtitle: "Two days in the hills",
  sourcePaths: PHOTOS.map((photo) => photo.sourcePath),
  count: PHOTOS.length,
  coverSourcePath: PHOTOS[0].sourcePath,
};
let storyRecords = [];
let slideshowProjects = [];
let burstKeeperAssetId = "";
let burstCullingResult = null;

function generatedBurstCullingFixture() {
  return {
    analysisId: "culling-fixture-1",
    version: "vintrace-assisted-culling-v1",
    stackId: "burst-stack-fixture",
    analyzedAt: "2026-07-12T09:00:00Z",
    resultSha256: "a".repeat(64),
    recommendedAssetId: "asset-burst-2",
    recommendationScore: 0.95,
    recommendationConfidence: "high",
    recommendationMargin: 0.13,
    recommendationOnly: true,
    requiresReview: true,
    automaticDeletion: false,
    faceSignalsAllowed: false,
    frames: [
      {
        assetId: "asset-burst-1",
        sequence: 1,
        score: 0.82,
        rank: 2,
        recommended: false,
        sharpness: 0.98,
        motionClarity: 0.42,
        faceQuality: null,
        eyesOpen: null,
        facesDetected: 0,
        eyesConfidence: "consent-required",
        faceQualitySource: "unavailable",
        reasons: [
          { code: "sharpest-in-burst", impact: "positive", signal: "sharpness" },
          { code: "motion-blur-risk", impact: "negative", signal: "motionClarity" },
          { code: "face-signals-consent-required", impact: "neutral", signal: "consent" },
        ],
      },
      {
        assetId: "asset-burst-2",
        sequence: 2,
        score: 0.95,
        rank: 1,
        recommended: true,
        sharpness: 0.91,
        motionClarity: 0.96,
        faceQuality: null,
        eyesOpen: null,
        facesDetected: 0,
        eyesConfidence: "consent-required",
        faceQualitySource: "unavailable",
        reasons: [
          { code: "top-overall", impact: "positive", signal: "score" },
          { code: "usable-sharpness", impact: "positive", signal: "sharpness" },
          { code: "motion-clear", impact: "positive", signal: "motionClarity" },
          { code: "face-signals-consent-required", impact: "neutral", signal: "consent" },
        ],
      },
      {
        assetId: "asset-burst-3",
        sequence: 3,
        score: 0.61,
        rank: 3,
        recommended: false,
        sharpness: 0.44,
        motionClarity: 0.62,
        faceQuality: null,
        eyesOpen: null,
        facesDetected: 0,
        eyesConfidence: "consent-required",
        faceQualitySource: "unavailable",
        reasons: [
          { code: "soft-focus", impact: "negative", signal: "sharpness" },
          { code: "moderate-motion-clarity", impact: "neutral", signal: "motionClarity" },
          { code: "face-signals-consent-required", impact: "neutral", signal: "consent" },
        ],
      },
    ],
  };
}

function burstStackFixture() {
  return {
    stackId: "burst-stack-fixture",
    name: "Morning Burst",
    count: BURST_PHOTOS.length,
    keeperCount: burstKeeperAssetId ? 1 : 0,
    coverSourcePath: BURST_PHOTOS[1].sourcePath,
    sourcePaths: BURST_PHOTOS.map((photo) => photo.sourcePath),
    items: BURST_PHOTOS.map((photo, index) => ({
      assetId: photo.assetId,
      sourcePath: photo.sourcePath,
      mediaKind: "burst",
      title: photo.title,
      captureDate: photo.captureDate,
      sequence: index + 1,
      keeper: photo.assetId === burstKeeperAssetId,
      selectionRole: photo.assetId === burstKeeperAssetId ? "keeper" : "",
      selectedAt: photo.assetId === burstKeeperAssetId ? "2026-07-12T09:01:00Z" : "",
      coverHint: index === 1,
    })),
    ...(burstCullingResult ? { culling: burstCullingResult } : {}),
  };
}

function generatedStoryFixture() {
  return {
    id: "story-fixture-1",
    sourceMemoryId: STORY_MEMORY.memoryId,
    title: "Two Days in the Hills",
    subtitle: "A local photo journal",
    style: "journal",
    sourceAssetIds: PHOTOS.map((photo) => photo.assetId),
    coverAssetId: PHOTOS[0].assetId,
    chapters: [
      {
        id: "chapter-fixture-1",
        title: "Morning light",
        narrative: "Dawn arrived over the ridge.",
        sourceAssetIds: [PHOTOS[0].assetId],
        captions: [{ assetId: PHOTOS[0].assetId, text: "Dawn over the mountain ridge.", source: "local-story-model" }],
      },
      {
        id: "chapter-fixture-2",
        title: "A cafe stop",
        narrative: "The day continued with a cafe receipt.",
        sourceAssetIds: [PHOTOS[1].assetId],
        captions: [{ assetId: PHOTOS[1].assetId, text: "A receipt from the cafe stop.", source: "local-story-model" }],
      },
    ],
    generation: {
      schemaVersion: 1,
      generatorVersion: "vintrace-local-story-v1",
      generatedAt: "2026-07-12T08:00:00Z",
      inputSha256: "1".repeat(64),
      generatedContentSha256: "2".repeat(64),
      seed: 17,
      offline: true,
      humanReviewRequired: true,
      model: { modelId: "fixture-local-vlm" },
      route: { tier: "quality" },
      usage: { prompt_tokens: 100, completion_tokens: 50 },
      elapsedMs: 25,
      sourceManifest: PHOTOS.map((photo, index) => ({
        assetId: photo.assetId,
        contentHash: String(index + 3).repeat(64),
        captionSha256: String(index + 5).repeat(64),
        captionSource: "local-vision",
      })),
      sourceSelection: { available: PHOTOS.length, selected: PHOTOS.length, omitted: 0 },
      idempotencyKeySha256: "9".repeat(64),
    },
    currentContentSha256: "2".repeat(64),
    humanEdited: false,
    revision: 1,
    history: [],
    createdAt: "2026-07-12T08:00:00Z",
    updatedAt: "2026-07-12T08:00:00Z",
  };
}

function recordCall(name, params = {}) {
  calls.push({
    name,
    params: JSON.parse(JSON.stringify(params || {})),
    at: Date.now(),
  });
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function emptyValue(value = {}) {
  return Promise.resolve({ value });
}

function filterPhotos(params = {}) {
  const query = String(params.query || "").trim().toLowerCase();
  const source = params.folderId === "media:burst" || params.mediaKind === "burst" ? BURST_PHOTOS : PHOTOS;
  return source.filter((item) => {
    if (params.favoriteOnly && !item.favorite) return false;
    if (params.editedOnly && !item.edited) return false;
    if (query) {
      const haystack = [item.title, item.caption, item.sourcePath].join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

async function photoItemsPage(params = {}) {
  recordCall("listPhotoFolderItems", params);
  const queryKey = String(params.query || "").trim().toLowerCase();
  const delayMs = Math.max(0, Number(itemDelaysByQuery.get(queryKey) || 0) || 0);
  if (delayMs) await sleep(delayMs);
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
  initialActiveId: RELATIONSHIP_SCENARIO ? "people" : "all",
  visibleRailSections: RELATIONSHIP_SCENARIO ? ["people"] : ["library"],
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
        {
          id: `memory:${STORY_MEMORY.memoryId}`,
          kind: "memory",
          name: STORY_MEMORY.name,
          count: STORY_MEMORY.count,
          coverSourcePath: STORY_MEMORY.coverSourcePath,
          coverPreviewUrl: "",
          memoryId: STORY_MEMORY.memoryId,
          memory: STORY_MEMORY,
        },
        {
          id: "media:burst",
          kind: "utility",
          name: "Bursts",
          count: BURST_PHOTOS.length,
          coverSourcePath: BURST_PHOTOS[1].sourcePath,
          coverPreviewUrl: BURST_PREVIEW,
          mediaKind: "burst",
        },
        ...(RELATIONSHIP_SCENARIO ? [
          {
            id: "person:Sam",
            kind: "person",
            name: "Sam",
            count: 3,
            coverSourcePath: "/library/people/sam.jpg",
            coverPreviewUrl: BURST_PREVIEW,
            personProfile: { personName: "Sam", favorite: false, hidden: false },
          },
          {
            id: "person:Alice",
            kind: "person",
            name: "Alice",
            count: 8,
            coverSourcePath: "/library/people/alice.jpg",
            coverPreviewUrl: BURST_PREVIEW,
            personProfile: { personName: "Alice", favorite: false, hidden: false },
          },
          {
            id: "person:Bob",
            kind: "person",
            name: "Bob",
            count: 7,
            coverSourcePath: "/library/people/bob.jpg",
            coverPreviewUrl: BURST_PREVIEW,
            personProfile: { personName: "Bob", favorite: false, hidden: false },
          },
          {
            id: "unknown:Unmatched cluster graph-a",
            kind: "unknown",
            name: "Unmatched cluster graph-a",
            count: 3,
            coverSourcePath: "/library/people/unknown.jpg",
            coverPreviewUrl: BURST_PREVIEW,
          },
        ] : []),
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
  listPhotoBurstStacks: async (params = {}) => {
    recordCall("listPhotoBurstStacks", params);
    return { value: { stacks: [burstStackFixture()] } };
  },
  setPhotoBurstSelection: async (params = {}) => {
    recordCall("setPhotoBurstSelection", params);
    const keepPath = Array.isArray(params.keepSourcePaths) ? String(params.keepSourcePaths[0] || "") : "";
    burstKeeperAssetId = params.clear
      ? ""
      : BURST_PHOTOS.find((photo) => photo.sourcePath === keepPath)?.assetId || "";
    return { value: { stack: burstStackFixture(), selectedCount: burstKeeperAssetId ? 1 : 0 } };
  },
  photoCullingStatus: async (params = {}) => {
    recordCall("photoCullingStatus", params);
    return {
      value: {
        available: true,
        offline: true,
        version: "vintrace-assisted-culling-v1",
        maxFrames: 60,
        recommendationOnly: true,
        automaticDeletion: false,
        faceSignalsAllowed: false,
        faceSignalsReason: "Face quality and eye-state signals require face-processing consent.",
        privacyDefault: "local-review-only",
        eyes: { available: true, method: "opencv-haar-eye-likelihood-v1", heuristic: true },
        fiqa: { available: true, modelId: "ediffiqa-t", modelName: "eDifFIQA-T", license: "Apache-2.0" },
      },
    };
  },
  analyzePhotoBurstCulling: async (params = {}) => {
    recordCall("analyzePhotoBurstCulling", params);
    burstCullingResult = generatedBurstCullingFixture();
    return { value: { result: burstCullingResult, cached: false, offline: true, recommendationOnly: true, automaticDeletion: false } };
  },
  applyPhotoCullingRecommendation: async (params = {}) => {
    recordCall("applyPhotoCullingRecommendation", params);
    burstKeeperAssetId = "asset-burst-2";
    burstCullingResult = {
      ...(burstCullingResult || generatedBurstCullingFixture()),
      application: { assetId: burstKeeperAssetId, appliedAt: "2026-07-12T09:01:00Z" },
    };
    return { value: { result: burstCullingResult, selection: { selectedCount: 1 }, idempotentReplay: false, recommendationOnly: true, automaticDeletion: false } };
  },
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
  suggestPhotoRelationshipNames: async (params = {}) => {
    recordCall("suggestPhotoRelationshipNames", params);
    return {
      value: {
        available: true,
        reason: "",
        generatedAt: "2026-07-13T00:00:00Z",
        graphVersion: "relationship-name-v1",
        graphHash: "b".repeat(64),
        graphStats: { nodes: 4, namedPeople: 3, unknownClusters: 1, edges: 5, candidatesEvaluated: 3, blockedByDirectCooccurrence: 2 },
        minimums: { score: 0.38, sourceAssets: 2, relationshipSupport: 2 },
        reviewRequired: true,
        autoApplied: 0,
        offline: true,
        suggestions: [{
          suggestionId: "relationship_name_fixture",
          evidenceHash: "c".repeat(64),
          graphVersion: "relationship-name-v1",
          sourceCluster: "Unmatched cluster graph-a",
          targetPerson: "Sam",
          score: 0.91,
          confidence: "strong",
          sourceAssetCount: 3,
          targetAssetCount: 3,
          sharedRelationshipCount: 2,
          relationshipSupport: 4,
          directCooccurrenceCount: 0,
          sharedRelationships: [
            { personName: "Alice", sourceCooccurrences: 2, targetCooccurrences: 2, support: 2 },
            { personName: "Bob", sourceCooccurrences: 2, targetCooccurrences: 2, support: 2 },
          ],
          scoreComponents: { weightedNeighborhoodOverlap: 1, sourceNeighborhoodCoverage: 1, supportStrength: 0.667 },
          reason: "Relationship patterns overlap around Alice and Bob.",
          reviewRequired: true,
          autoApply: false,
          undoAvailable: true,
        }],
      },
    };
  },
  reviewPhotoRelationshipNameSuggestion: async (params = {}) => {
    recordCall("reviewPhotoRelationshipNameSuggestion", params);
    return {
      value: {
        applied: params.decision === "applied",
        dismissed: params.decision === "dismissed",
        idempotentReplay: false,
        operationId: params.decision === "applied" ? "photo_op_relationship_fixture" : "",
      },
    };
  },
  savePhotoPetProfile: () => emptyValue({}),
  savePhotoPlaceProfile: () => emptyValue({}),
  savePhotoUtilityProfile: () => emptyValue({}),
  renamePhotoPet: () => emptyValue({}),
  assignPhotoPet: () => emptyValue({}),
  bulkAssignPhotoPet: () => emptyValue({ assigned: 0, failed: 0, items: [], failures: [] }),
  dismissPhotoPetReview: () => emptyValue({}),
  bulkDismissPhotoPetReview: () => emptyValue({ dismissed: 0, failed: 0, items: [], failures: [] }),
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
  photoGenerativeStatus: async () => {
    recordCall("photoGenerativeStatus", {});
    return {
      value: {
        catalogVersion: "2026-07-12.1",
        catalogSha256: "fixture",
        offlineInference: true,
        modelRoot: "/fixture/generative",
        platform: "darwin-arm64",
        totalMemoryBytes: 64 * 1024 ** 3,
        light: { available: true, ready: true, cleanup: { available: true }, upscale: { available: true } },
        heavy: { available: true, ready: true, hardwareSupported: true, platformSupported: true },
        modes: { cleanup: true, upscale: true, expand: true, reframe: true, relight: true },
        contentCredentials: {
          available: true,
          policyVersion: "vintrace-c2pa-v1",
          specVersion: "2.4",
          packageVersion: "0.36.0",
          nativeSdkVersion: "0.89.0",
          offline: true,
          remoteManifestFetch: false,
          ocspFetch: false,
          timestamped: false,
          trustScope: "workspace-local",
          globallyTrusted: false,
          identityReady: true,
          identityPersisted: true,
          identityEncrypted: true,
          identityStorage: "workspace-aes-256-gcm",
          signerId: "fixture-signer",
        },
        applyRequiresContentCredentials: true,
        applyAvailable: true,
      },
    };
  },
  inspectPhotoContentCredentials: async (params = {}) => {
    recordCall("inspectPhotoContentCredentials", params);
    const scope = params.scope === "original" ? "original" : "active";
    return {
      value: {
        assetId: String(params.assetId || "asset-sunrise"),
        scope,
        metadataKey: scope === "original" ? "contentCredentials" : "editContentCredentials",
        contentCredentials: scope === "original"
          ? {
              present: false,
              embedded: false,
              validationState: "absent",
              cryptographicallyValid: false,
              locallyTrusted: false,
              globallyTrusted: false,
              trustScope: "none",
              timestamped: false,
              manifestId: "",
              containsAiHistory: false,
              topLevelAiEdit: false,
              ingredientCount: 0,
              assetSha256: "fixture-original-sha",
              error: "",
            }
          : {
              present: true,
              embedded: true,
              validationState: "trusted",
              cryptographicallyValid: true,
              locallyTrusted: true,
              globallyTrusted: false,
              trustScope: "workspace-local",
              timestamped: false,
              manifestId: "urn:c2pa:fixture-active",
              containsAiHistory: true,
              topLevelAiEdit: true,
              ingredientCount: 1,
              assetSha256: "fixture-active-sha",
              error: "",
            },
      },
    };
  },
  installPhotoGenerativePack: async (params = {}) => {
    recordCall("installPhotoGenerativePack", params);
    return { value: { installed: true, status: {} } };
  },
  renderPhotoGenerativePreview: async (params = {}) => {
    recordCall("renderPhotoGenerativePreview", params);
    return {
      value: {
        previewId: "generative-preview-1",
        assetId: String(params.assetId || "asset-sunrise"),
        mode: String(params.mode || "upscale"),
        tier: "light",
        generativePreviewPath: "/workspace/photo-generative-previews/preview.png",
        generativePreviewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAO7m2P///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        generativePreviewSha256: "fixture-sha",
        width: 3200,
        height: 2400,
        durationSeconds: 1.25,
        offlineInference: true,
        aiGenerated: true,
        provenance: { aiGenerated: true, offlineInference: true },
        createdAt: "2026-07-12T08:00:00Z",
        expiresAt: "2026-07-12T10:00:00Z",
        requiresConfirmation: true,
        sourceChanged: false,
      },
    };
  },
  applyPhotoGenerativeEdit: async (params = {}) => {
    recordCall("applyPhotoGenerativeEdit", params);
    return {
      value: {
        previewId: String(params.previewId || ""),
        assetId: String(params.assetId || "asset-sunrise"),
        mode: "upscale",
        tier: "light",
        applied: true,
        sourceChanged: false,
        aiGenerated: true,
        offlineInference: true,
        artifactSha256: "fixture-sha",
        modelOutputSha256: "fixture-model-output-sha",
        contentCredentials: {
          present: true,
          embedded: true,
          validationState: "trusted",
          cryptographicallyValid: true,
          locallyTrusted: true,
          globallyTrusted: false,
          trustScope: "workspace-local",
          timestamped: false,
          manifestId: "urn:c2pa:fixture-applied",
          containsAiHistory: true,
          topLevelAiEdit: true,
          ingredientCount: 1,
          assetSha256: "fixture-sha",
        },
        stack: {
          assetId: String(params.assetId || "asset-sunrise"),
          sourcePath: "/library/2026/mountain-sunrise.jpg",
          operations: [{ kind: "local_generative_edit", aiGenerated: true }],
          renderedPreviewPath: "/workspace/photo-edit-previews/asset-sunrise.jpg",
          renderedPreviewUrl: "data:image/gif;base64,R0lGODlhAQABAIAAAO7m2P///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        },
        versionCreated: false,
        idempotentReplay: false,
      },
    };
  },
  discardPhotoGenerativePreview: async (params = {}) => {
    recordCall("discardPhotoGenerativePreview", params);
    return { value: { previewId: String(params.previewId || ""), discarded: true, removed: true } };
  },
  duplicatePhotoAssetVersion: () => emptyValue({}),
  duplicatePhotoAssetRenderedVersion: () => emptyValue({}),
  recordPhotoAssetEvent: () => emptyValue({ recorded: 1, summary: {} }),
  applyPhotoVisibilityOperation: () => emptyValue({ action: "", affected: 0, operation: null }),
  listPhotoOperations: () => emptyValue({ operations: [] }),
  photoRestoreRehearsal: () => emptyValue({ generatedAt: "", operationId: "", ok: true, status: "ready", counts: {}, operations: [], recommendations: [] }),
  photoBackupRestoreRehearsal: () => emptyValue({ generatedAt: "", ok: true, status: "ready", counts: {}, operations: [], recommendations: [] }),
  undoPhotoOperation: () => emptyValue({ undone: false, operation: null, restored: 0, missing: 0 }),
  permanentlyDeletePhotos: (params = {}) => {
    recordCall("permanentlyDeletePhotos", params);
    return emptyValue({ selected: 0, deletedAssets: 0, deletedScanFiles: 0, deletedCandidates: 0, deletedFiles: 0, sourcePaths: [], assetIds: [], candidateIds: [], originalMediaDeleted: false });
  },
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
  photoUserMemories: () => emptyValue({ memories: [STORY_MEMORY] }),
  savePhotoUserMemory: () => emptyValue({}),
  deletePhotoUserMemory: () => emptyValue({ memoryId: "", deleted: 0 }),
  photoStoryStatus: async (params = {}) => {
    recordCall("photoStoryStatus", params);
    return {
      value: {
        available: true,
        offline: true,
        privacyDefault: "path-free-local",
        generatorVersion: "vintrace-local-story-v1",
        maxAssets: 18,
        styles: ["journal", "concise", "cinematic"],
        preference: "quality",
        powerMode: "balanced",
        route: { available: true, tier: "quality", reason: "fixture" },
        reason: "Ready to write a local story.",
      },
    };
  },
  photoStories: async (params = {}) => {
    recordCall("photoStories", params);
    const stories = storyRecords.filter((story) => !params.memoryId || story.sourceMemoryId === params.memoryId);
    return { value: { stories, total: stories.length, memoryId: String(params.memoryId || ""), offline: true } };
  },
  generatePhotoStory: async (params = {}) => {
    recordCall("generatePhotoStory", params);
    if (!storyRecords.length) storyRecords = [generatedStoryFixture()];
    return { value: { story: storyRecords[0], idempotentReplay: false, offline: true } };
  },
  savePhotoStory: async (params = {}) => {
    recordCall("savePhotoStory", params);
    const current = storyRecords.find((story) => story.id === params.storyId) || generatedStoryFixture();
    const next = {
      ...current,
      title: String(params.title || current.title),
      subtitle: String(params.subtitle || current.subtitle),
      style: String(params.style || current.style),
      chapters: Array.isArray(params.chapters) ? params.chapters : current.chapters,
      currentContentSha256: "3".repeat(64),
      humanEdited: true,
      revision: current.revision + 1,
      history: [{
        versionId: `story-version-${current.revision}`,
        savedAt: "2026-07-12T08:05:00Z",
        label: `Before edit ${current.revision + 1}`,
        contentSha256: current.currentContentSha256,
      }, ...current.history],
      updatedAt: "2026-07-12T08:05:00Z",
    };
    storyRecords = [next, ...storyRecords.filter((story) => story.id !== next.id)];
    return { value: { story: next, saved: true, unchanged: false } };
  },
  deletePhotoStory: async (params = {}) => {
    recordCall("deletePhotoStory", params);
    storyRecords = storyRecords.filter((story) => story.id !== params.storyId);
    return { value: { storyId: String(params.storyId || ""), deleted: 1 } };
  },
  restorePhotoStoryVersion: async (params = {}) => {
    recordCall("restorePhotoStoryVersion", params);
    return { value: { story: storyRecords[0], restored: true, versionId: String(params.versionId || "") } };
  },
  exportPhotoStory: async (params = {}) => {
    recordCall("exportPhotoStory", params);
    return {
      value: {
        storyId: String(params.storyId || ""),
        markdownPath: "/exports/story.md",
        jsonPath: "/exports/story.json",
        generatedAt: "2026-07-12T08:06:00Z",
        contentSha256: "3".repeat(64),
        markdownSha256: "4".repeat(64),
        jsonSha256: "5".repeat(64),
        pathFree: true,
        offline: true,
      },
    };
  },
  createPhotoStorySlideshow: async (params = {}) => {
    recordCall("createPhotoStorySlideshow", params);
    const story = storyRecords[0] || generatedStoryFixture();
    const project = {
      id: "slideshow-story-fixture",
      name: story.title,
      title: story.title,
      sourceLabel: story.subtitle,
      storyId: story.id,
      storyContentSha256: story.currentContentSha256,
      storyGenerationSha256: story.generation.generatedContentSha256,
      sourcePaths: PHOTOS.map((photo) => photo.sourcePath),
      timelineItems: PHOTOS.map((photo, index) => ({
        sourcePath: photo.sourcePath,
        durationMs: 4500,
        chapterId: story.chapters[index].id,
        chapterTitle: story.chapters[index].title,
        chapterNarrative: story.chapters[index].narrative,
      })),
      theme: "ken-burns",
      music: "calm",
      fitMode: "fill",
      createdAt: "2026-07-12T08:07:00Z",
      updatedAt: "2026-07-12T08:07:00Z",
    };
    slideshowProjects = [project];
    return { value: { story, project, offline: true } };
  },
  listPhotoSlideshowProjects: () => emptyValue({ projects: slideshowProjects }),
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
  getPhotoTetherStatus: () => Promise.resolve({ active: false, session: null, recoverable: [], recent: [] }),
  startPhotoTether: () => Promise.resolve({ active: false, session: null, recoverable: [], recent: [] }),
  stopPhotoTether: () => Promise.resolve({ active: false, session: null, recoverable: [], recent: [] }),
  resumePhotoTether: () => Promise.resolve({ active: false, session: null, recoverable: [], recent: [] }),
  capturePhotoTether: () => Promise.resolve({ capture: null }),
  subscribePhotoTether: () => noop,
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
  semanticSearchPhotos: async (params = {}) => {
    recordCall("semanticSearchPhotos", params);
    if (!SEMANTIC_VIDEO_SCENARIO) return null;
    return {
      available: true,
      engine: "FixtureSigLIP",
      query: String(params.query || ""),
      candidateCount: PHOTOS.length,
      imageCandidateCount: PHOTOS.length - 1,
      videoCandidateCount: 1,
      scored: PHOTOS.length,
      scoredImages: PHOTOS.length - 1,
      scoredVideoSegments: 1,
      missingEmbeddings: 0,
      missingVideoAssets: 0,
      results: [{
        sourcePath: SEMANTIC_VIDEO.sourcePath,
        score: 0.94,
        resultKind: "videoSegment",
        mediaKind: "video",
        segmentId: "vseg_fixture_sunset",
        assetId: SEMANTIC_VIDEO.assetId,
        startMs: 2_000,
        endMs: 3_500,
        timestampMs: 2_500,
        durationMs: 4_000,
        frameIndex: 75,
      }],
      items: [{
        sourcePath: SEMANTIC_VIDEO.sourcePath,
        score: 0.94,
        previewUrl: BURST_PREVIEW,
        mediaKind: "video",
        resultKind: "videoSegment",
        segmentId: "vseg_fixture_sunset",
        assetId: SEMANTIC_VIDEO.assetId,
        startMs: 2_000,
        endMs: 3_500,
        timestampMs: 2_500,
        durationMs: 4_000,
        frameIndex: 75,
      }],
    };
  },
  photoLibraryAgentStatus: async () => {
    recordCall("photoLibraryAgentStatus", {});
    return {
      value: {
        version: "photo-library-agent-v1",
        available: true,
        offline: true,
        model: { route: { tier: "quality" } },
      },
    };
  },
  queryPhotoLibraryAgent: async (params = {}) => {
    recordCall("queryPhotoLibraryAgent", params);
    return {
      value: {
        version: "photo-library-agent-v1",
        requestId: "request-agent-1",
        answer: "I found the cafe receipt from July 2. Its indexed caption describes an expense capture.",
        citations: [{
          citationId: 1,
          assetId: "asset-receipt",
          title: "Cafe Receipt",
          captureDate: "2026-07-02T12:15:00Z",
          mediaKind: "image",
          matchReasons: ["caption"],
        }],
        followUps: ["Show only favorites from that week"],
        uncertainty: "The answer is grounded in locally indexed metadata and captions.",
        intent: "find-receipt-and-propose-memory",
        resultAssetIds: ["asset-receipt"],
        pendingPlans: [{
          planId: "plan-agent-1",
          action: "save_photo_user_memory",
          executionLane: "write",
          confirmationRequired: true,
          destructive: false,
          estimatedAffectedItems: 1,
          payloadKeys: ["assetIds", "name"],
          createdAt: "2026-07-12T08:00:00Z",
          expiresAt: "2026-07-12T08:30:00Z",
          status: "pending",
        }],
        toolTrace: [
          { index: 0, tool: "search_images", ok: true, arguments: { mode: "hybrid" } },
          { index: 1, tool: "analyze_image_assets", ok: true, arguments: { count: 1 } },
        ],
        grounding: {
          citationCandidates: 1,
          validCitations: 1,
          injectionFlags: {},
          untrustedContentIsolated: true,
          answerNeutralized: false,
          answerNeutralizationFlags: [],
        },
        model: { route: { tier: "quality" } },
        offline: true,
        elapsedMs: 1260,
      },
    };
  },
  executePhotoLibraryAgentPlan: async (params = {}) => {
    recordCall("executePhotoLibraryAgentPlan", params);
    return {
      value: {
        ok: true,
        replayedPlan: false,
        result: { memoryId: "memory-agent-1" },
        plan: {
          planId: "plan-agent-1",
          action: "save_photo_user_memory",
          executionLane: "write",
          confirmationRequired: true,
          destructive: false,
          estimatedAffectedItems: 1,
          payloadKeys: ["assetIds", "name"],
          createdAt: "2026-07-12T08:00:00Z",
          expiresAt: "2026-07-12T08:30:00Z",
          status: "complete",
        },
      },
    };
  },
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
  bulkBlockFalseMatches: asyncNoop,
  reassignCandidatePerson: asyncNoop,
  bulkReassignCandidatePerson: asyncNoop,
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
  invoke: (command, params = {}) => {
    recordCall(command, params);
    if (command === "photo_audio_segments" && SEMANTIC_VIDEO_SCENARIO) {
      return Promise.resolve({
        value: {
          assetId: SEMANTIC_VIDEO.assetId,
          sourcePath: SEMANTIC_VIDEO.sourcePath,
          segments: SEMANTIC_VIDEO_AUDIO_SEGMENTS,
          transcriptSegments: SEMANTIC_VIDEO_AUDIO_SEGMENTS.filter((segment) => segment.segmentKind === "speech"),
          soundEventSegments: SEMANTIC_VIDEO_AUDIO_SEGMENTS.filter((segment) => segment.segmentKind === "sound"),
          total: SEMANTIC_VIDEO_AUDIO_SEGMENTS.length,
        },
      });
    }
    return Promise.resolve({});
  },
};

window.__photosViewStateHarness = {
  calls,
  setItemDelay: (query, delayMs) => {
    itemDelaysByQuery.set(String(query || "").trim().toLowerCase(), Math.max(0, Number(delayMs || 0) || 0));
  },
  clearItemDelays: () => {
    itemDelaysByQuery.clear();
  },
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

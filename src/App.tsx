import {
  Activity,
  AlertCircle,
  Aperture,
  ArrowLeft,
  ArrowRight,
  Archive,
  BookOpen,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy as CopyIcon,
  Crosshair,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Focus,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Lock,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  Save,
  Search,
  ScanLine,
  ScanFace,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Scissors,
  Timer,
  Trash2,
  Undo2,
  Unlock,
  UserPlus,
  Users,
  Video,
  X
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
// H9: the 1024px/1.46MB icon.png is the OS app-icon master (still read at
// runtime by the Electron main process). The renderer only paints a ~40px logo,
// so it imports a 192px (~8KB) variant to keep the master off the boot path.
import appIconUrl from "../desktop/assets/icon-192.webp";
import type {
  AgeBucket,
  AgeReferenceGroup,
  AppState,
  AuditEventsResult,
  CameraSaveResult,
  CandidateMediaAction,
  CandidateMediaActionValue,
  CandidateMediaPreviewValue,
  CandidateStatus,
  CommandResult,
  AccuracyEvaluation,
  AccuracyLabelsExportValue,
  AccuracyLabelsImportValue,
  AccuracyValidationPackValue,
  AuditLogExportValue,
  ConsentReceiptExportValue,
  DatabaseRepairResult,
  DeleteFaceDataResult,
  ExportReportValue,
  AppCommand,
  ExternalOpenPayload,
  FolderAnalysis,
  FolderWatchStatus,
  DuplicatePeopleResult,
  InstallerDiagnosticsResult,
  MediaBundleExportValue,
  MediaActionHistoryValue,
  MediaActionProgress,
  MediaActionRestoreValue,
  MediaActionUndoValue,
  MediaTrashCleanupValue,
  MediaTrashReportValue,
  ModelDriftReport,
  ModelCompatibilityReport,
  ModelSwitchDryRun,
  ModelIntegrityResult,
  ModelDownloadProgress,
  PlatformReport,
  PrivacyReport,
  PublicDatasetBenchmarkResult,
  PublicDatasetCatalog,
  PublicDatasetCatalogEntry,
  PublicDatasetInspection,
  PublicDatasetModelComparisonResult,
  ReferenceFace,
  ReferenceGapReport,
  RetentionPolicyReport,
  ReleaseReadinessResult,
  ReviewCandidate,
  ReviewLedgerExportValue,
  ReviewRulesApplyResult,
  RuntimeBenchmarkResult,
  RuntimeSelfTestResult,
  SafeModeAuditExportValue,
  ScanManifestPruneValue,
  ScanProgress,
  StorageBudgetEnforceResult,
  SystemIntegration,
  SystemPhotoSource,
  Thresholds,
  VideoDecoderConfig,
  UpdateChannel,
  ScanHistoryExportValue,
  SupportBundleValue,
  WorkspaceInventoryExportValue,
  WorkspaceBackupValue,
  WorkspaceBackupPruneValue,
  WorkspaceBackupRestoreValue,
  WorkspaceBackupVerification,
  WorkspaceLockStatus,
  WorkspaceHealth,
  WorkspaceListItem,
  WorkspaceOptimizeResult,
  WorkspaceRepairResult,
  WorkspaceRelinkResult,
  CandidateQueryResult,
  DiagnosticsReport,
  UpdateStatus
} from "./types";
import { formatErrorMessage, formatUiMessage, languageOptions, localizeDom, normalizeLanguage, translate, translateUiText } from "./i18n";
import type { LanguageCode, TranslationKey, UiMessageKey } from "./i18n";

type TabKey = "dashboard" | "enroll" | "scan" | "review" | "settings";
type UiMessageValues = Record<string, string | number>;
type NoticeState = { tone: "ok" | "warn" | "error"; text: string; messageKey?: UiMessageKey; values?: UiMessageValues; errorCode?: string; action?: string };

const languageStorageKey = "vintrace:language";

let imperativeLanguage: LanguageCode = "en";

function setImperativeLanguage(language: LanguageCode) {
  imperativeLanguage = language;
}

function localizeImperativeText(source: string) {
  return translateUiText(imperativeLanguage, source);
}

function parseErrorCodeFromText(value: string) {
  return value.match(/\b([EW]-[A-Z0-9-]{2,})\b/)?.[1] || "";
}

function stripIpcErrorPrefix(value: string) {
  return value
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .replace(/^\[[EW]-[A-Z0-9-]{2,}\]\s*/, "")
    .trim();
}

function errorDetails(error: unknown, fallback = "The action failed.") {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  const text = stripIpcErrorPrefix(raw) || fallback;
  const objectError: { code?: unknown; action?: unknown } = error && typeof error === "object" ? error as { code?: unknown; action?: unknown } : {};
  return {
    text,
    code: String(objectError.code || parseErrorCodeFromText(raw) || ""),
    action: String(objectError.action || "")
  };
}

function currentIntlLocale() {
  const locales: Record<LanguageCode, string> = {
    en: "en",
    zh: "zh-CN",
    es: "es",
    fr: "fr",
    ar: "ar",
    hi: "hi-IN",
    ja: "ja-JP"
  };
  return locales[imperativeLanguage] || "en";
}

// H5: promise-based in-app confirmation. Synchronous window.confirm froze the
// renderer (animations/scroll stop) and ignored the app theme/localized layout.
// A single ConfirmHost (mounted in App) registers this controller and renders a
// themed, focus-trapped ModalFrame dialog instead.
type ConfirmRequest = {
  message: string;
  resolve: (confirmed: boolean) => void;
};

let confirmController: ((request: ConfirmRequest) => void) | null = null;

function requestConfirm(finalMessage: string): Promise<boolean> {
  // Fall back to the native dialog if the host isn't mounted yet (very early
  // boot) so a confirmation is never silently skipped.
  if (!confirmController) {
    return Promise.resolve(window.confirm(finalMessage));
  }
  return new Promise<boolean>((resolve) => {
    confirmController?.({ message: finalMessage, resolve });
  });
}

function confirmDialog(message: string): Promise<boolean> {
  return requestConfirm(localizeImperativeText(message));
}

function promptUi(message: string, defaultValue = "") {
  if (window.crossAge) {
    return defaultValue;
  }
  try {
    return window.prompt(localizeImperativeText(message), defaultValue);
  } catch {
    return defaultValue;
  }
}

function skippedSummary(count: number) {
  return count > 0 ? ` ${count} skipped.` : "";
}

function protectedSummary(count: number) {
  return count > 0 ? ` Safe Mode protected ${count} file(s).` : "";
}

const tabs: Array<{ key: TabKey; labelKey: TranslationKey; icon: typeof Gauge }> = [
  { key: "dashboard", labelKey: "nav.dashboard", icon: Gauge },
  { key: "enroll", labelKey: "nav.enroll", icon: UserPlus },
  { key: "scan", labelKey: "nav.scan", icon: Search },
  { key: "review", labelKey: "nav.review", icon: ShieldCheck },
  { key: "settings", labelKey: "nav.settings", icon: Settings }
];

const ageBuckets: AgeBucket[] = ["child", "adolescent", "adult", "unknown"];
const referenceAgeBuckets: AgeBucket[] = ["child", "adolescent", "adult"];
const reviewStatuses: CandidateStatus[] = ["accepted", "rejected", "uncertain"];

function reviewStatusLabel(status: CandidateStatus | "all") {
  if (status === "accepted") return "Accepted";
  if (status === "rejected") return "Rejected";
  if (status === "uncertain") return "Not sure";
  if (status === "pending") return "Needs review";
  return "All";
}

function folderAnalysisIssueCount(analysis: FolderAnalysis | null) {
  if (!analysis) return 0;
  const storageIssue = analysis.storage && (!analysis.storage.readable || !analysis.storage.traversable) ? 1 : 0;
  return (
    analysis.unreadableSamples.length +
    analysis.unreadableVideoSamples.length +
    (analysis.transientErrorCount ?? 0) +
    (analysis.statErrorCount ?? 0) +
    (analysis.walkErrorCount ?? 0) +
    storageIssue
  );
}

function isFolderAnalysisReady(analysis: FolderAnalysis | null) {
  if (!analysis) return false;
  const mediaCount = analysis.imageCount + analysis.videoCount;
  return Boolean(analysis.exists && analysis.isDirectory && mediaCount > 0 && folderAnalysisIssueCount(analysis) === 0);
}

function decisionButtonLabel(status: CandidateStatus) {
  if (status === "accepted") return "Looks right";
  if (status === "rejected") return "Not a match";
  if (status === "uncertain") return "Not sure";
  return reviewStatusLabel(status);
}

function ageBucketLabel(bucket: AgeBucket) {
  if (bucket === "child") return "Child";
  if (bucket === "adolescent") return "Teen";
  if (bucket === "adult") return "Adult";
  return "Not sure";
}

function matchBandLabel(band: string) {
  const value = band.toLowerCase();
  if (value.includes("confident")) return "Strong possible match";
  if (value.includes("likely")) return "Likely possible match";
  if (value.includes("cluster")) return "Similar photo group";
  if (value.includes("low")) return "Needs closer look";
  return "Possible match";
}

type PerformanceMode = "quality" | "balanced" | "fast";
type PerformanceChoice = PerformanceMode | "auto";

type PerformanceProfile = {
  label: string;
  detail: string;
  previewWarmupLimit: number;
  manualPreviewLimit: number;
  reviewBatchSize: number;
  candidateBatchSize: number;
  showListThumbnails: boolean;
  slowCommandMs: number;
};

const performanceProfiles: Record<PerformanceMode, PerformanceProfile> = {
  quality: {
    label: "Quality",
    detail: "More thumbnails and larger review batches.",
    previewWarmupLimit: 128,
    manualPreviewLimit: 192,
    reviewBatchSize: 420,
    candidateBatchSize: 360,
    showListThumbnails: true,
    slowCommandMs: 3000
  },
  balanced: {
    label: "Balanced",
    detail: "Responsive defaults for large libraries.",
    previewWarmupLimit: 64,
    manualPreviewLimit: 128,
    reviewBatchSize: 250,
    candidateBatchSize: 220,
    showListThumbnails: true,
    slowCommandMs: 2000
  },
  fast: {
    label: "Fast",
    detail: "Minimal thumbnail work and smaller render batches.",
    previewWarmupLimit: 0,
    manualPreviewLimit: 64,
    reviewBatchSize: 120,
    candidateBatchSize: 120,
    showListThumbnails: false,
    slowCommandMs: 1200
  }
};

const performanceChoiceOrder: PerformanceChoice[] = ["auto", "fast", "balanced", "quality"];

function normalizePerformanceMode(value: unknown): PerformanceMode {
  const mode = String(value || "").toLowerCase();
  return mode === "fast" || mode === "quality" || mode === "balanced" ? mode : "balanced";
}

function normalizePerformanceChoice(value: unknown): PerformanceChoice {
  const mode = String(value || "").toLowerCase();
  return mode === "auto" ? "auto" : normalizePerformanceMode(mode);
}

function resolvePerformanceMode(choice: PerformanceChoice, platform?: PlatformReport | null): PerformanceMode {
  if (choice !== "auto") return choice;
  return normalizePerformanceMode(platform?.recommended_performance_mode);
}

function performanceTierLabel(value?: string) {
  if (value === "low") return "Low-spec";
  if (value === "high") return "High-performance";
  return "Standard";
}

type SettingsDraft = {
  modelPack: string;
  thresholds: Thresholds;
  clusterMinSize: number;
  faceDetectorSize: number;
  twoPassScan: boolean;
  verificationDetectorSize: number;
  safeMode: boolean;
  safeModeZeroAdmittance?: boolean;
  safeModeThreshold: number;
  storageBudgetBytes: number;
  maxMediaFileBytes: number;
  videoDecoder: VideoDecoderConfig;
  reviewRules: {
    autoRejectBelow: number;
    autoUncertainLowQuality: boolean;
    autoRejectLowQualityVideo: boolean;
  };
  scanExclusions: {
    dirNames: string[];
    pathKeywords: string[];
    extensions: string[];
    filePaths: string[];
  };
  mode: SettingsMode;
};

type SettingsValues = Omit<SettingsDraft, "mode" | "modelPack">;
type SettingsMode = "recommended" | "privacy" | "precision" | "discovery" | "custom";
type PresetMode = Exclude<SettingsMode, "custom">;

type SettingsPreset = {
  key: PresetMode;
  label: string;
  detail: string;
  bestFor: string;
  values: SettingsValues;
};

const defaultScanExclusions = {
  dirNames: [".git", ".hg", ".svn", ".cache", ".venv", "__pycache__", "node_modules", "venv"],
  pathKeywords: [],
  extensions: [],
  filePaths: []
};

const defaultVideoDecoder: VideoDecoderConfig = {
  ffmpegPath: "",
  ffprobePath: ""
};

const settingsPresets: SettingsPreset[] = [
  {
    key: "recommended",
    label: "Recommended",
    detail: "Balanced matching, quality, and Safe Mode.",
    bestFor: "Most libraries",
    values: {
      thresholds: { confident: 0.4, likely: 0.28, relaxedChild: 0.2, qualityMin: 0.15 },
      clusterMinSize: 2,
      faceDetectorSize: 512,
      twoPassScan: true,
      verificationDetectorSize: 640,
      safeMode: true,
      safeModeThreshold: 0.58,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "privacy",
    label: "Privacy first",
    detail: "More protective filtering before media enters review.",
    bestFor: "Mixed personal albums",
    values: {
      thresholds: { confident: 0.44, likely: 0.32, relaxedChild: 0.24, qualityMin: 0.2 },
      clusterMinSize: 3,
      faceDetectorSize: 512,
      twoPassScan: true,
      verificationDetectorSize: 640,
      safeMode: true,
      safeModeThreshold: 0.45,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "precision",
    label: "High confidence",
    detail: "Fewer results, stronger evidence per match.",
    bestFor: "Detailed review",
    values: {
      thresholds: { confident: 0.56, likely: 0.42, relaxedChild: 0.3, qualityMin: 0.24 },
      clusterMinSize: 3,
      faceDetectorSize: 640,
      twoPassScan: false,
      verificationDetectorSize: 640,
      safeMode: true,
      safeModeThreshold: 0.58,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  },
  {
    key: "discovery",
    label: "Find more",
    detail: "Broader possible-match discovery with more review items.",
    bestFor: "Early exploration",
    values: {
      thresholds: { confident: 0.34, likely: 0.24, relaxedChild: 0.16, qualityMin: 0.1 },
      clusterMinSize: 2,
      faceDetectorSize: 384,
      twoPassScan: true,
      verificationDetectorSize: 640,
      safeMode: true,
      safeModeThreshold: 0.62,
      storageBudgetBytes: 0,
      maxMediaFileBytes: 0,
      videoDecoder: defaultVideoDecoder,
      reviewRules: { autoRejectBelow: 0, autoUncertainLowQuality: false, autoRejectLowQualityVideo: false },
      scanExclusions: defaultScanExclusions
    }
  }
];

type AgeFolderMap = Record<AgeBucket, string>;

function emptyAgeFolders(): AgeFolderMap {
  return { child: "", adolescent: "", adult: "", unknown: "" };
}

const initialWatchStatus: FolderWatchStatus = { active: false, folder: null, queued: 0, scanning: false, message: "Not watching." };
const onboardingStorageKey = "vintrace:onboarding:v1";

type CameraMode = "idle" | "starting" | "live" | "capturing" | "error";

type FaceBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  source: "detected" | "inferred";
};

type FaceDetection = {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

type FaceDetectorLike = {
  detect(source: CanvasImageSource): Promise<FaceDetection[]>;
};

type FaceDetectorConstructor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

type CameraDiagnostics = {
  score: number;
  brightness: number;
  contrast: number;
  sharpness: number;
  framing: number;
  stability: number;
  ready: boolean;
  issues: string[];
  status: string;
  rawMean: number;
  rawEdge: number;
};

type SakuraPetal = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  size: number;
  delay: number;
  duration: number;
  rotate: number;
  tone: number;
};

const sakuraFacePoints: Array<{ x: number; y: number }> = [
  { x: 50, y: 22 }, { x: 43, y: 24 }, { x: 57, y: 24 },
  { x: 36, y: 30 }, { x: 64, y: 30 }, { x: 31, y: 38 },
  { x: 69, y: 38 }, { x: 29, y: 48 }, { x: 71, y: 48 },
  { x: 32, y: 59 }, { x: 68, y: 59 }, { x: 39, y: 69 },
  { x: 61, y: 69 }, { x: 50, y: 75 }, { x: 43, y: 42 },
  { x: 57, y: 42 }, { x: 50, y: 53 }, { x: 45, y: 62 },
  { x: 55, y: 62 }
];

const sakuraPetals: SakuraPetal[] = Array.from({ length: 34 }, (_, index) => {
  const target = sakuraFacePoints[index % sakuraFacePoints.length];
  const ring = Math.floor(index / sakuraFacePoints.length);
  const angle = (index * 137.5 * Math.PI) / 180;
  const radiusX = 52 + ring * 10 + (index % 5) * 3;
  const radiusY = 36 + ring * 7 + (index % 4) * 2;
  return {
    id: index,
    fromX: 50 + Math.cos(angle) * radiusX,
    fromY: 50 + Math.sin(angle) * radiusY,
    toX: target.x + (ring - 0.5) * 1.2,
    toY: target.y + ((index % 3) - 1) * 1.1,
    size: 7 + (index % 5) * 1.5,
    delay: index * 0.045,
    duration: 3.6 + (index % 6) * 0.22,
    rotate: (index * 41) % 180,
    tone: index % 4
  };
});

type CameraScanResult = CameraSaveResult & {
  added?: number;
  errors?: string[];
  matched?: boolean;
};

type SavedScanSource = {
  id: string;
  label: string;
  path: string;
  createdAt: number;
  lastUsedAt: number;
};

type ScanQueueItem = SavedScanSource & {
  status: "queued" | "running" | "done" | "error";
  message?: string;
};

type ReviewLane = "all" | "high" | "lowQuality" | "groups" | "video" | "notes" | "closeRunner" | "singleReference";
const reviewLanes: ReviewLane[] = ["all", "high", "lowQuality", "groups", "video", "notes", "closeRunner", "singleReference"];

type SavedReviewView = {
  id: string;
  label: string;
  statusFilter: CandidateStatus | "all";
  reviewLane: ReviewLane;
  search: string;
  sort: "score" | "newest" | "quality";
  createdAt: number;
  lastUsedAt: number;
};

type LatencySample = {
  label: string;
  command: string;
  durationMs: number;
  at: number;
  budgetMs: number;
};

type LatencySummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  slowCount: number;
  slowest: LatencySample | null;
};

type ConsentPrompt = {
  requestedValue: boolean;
  scope: string;
};

type ReviewUndo = {
  candidateId: string;
  previousStatus: CandidateStatus;
  nextStatus: CandidateStatus;
  label: string;
};

type PendingExternalIntent = Extract<ExternalOpenPayload, { type: "scan-files" }>;

function readInitialLanguage(): LanguageCode {
  try {
    const saved = window.localStorage.getItem(languageStorageKey);
    if (saved) return normalizeLanguage(saved);
  } catch {
    // Local storage can be unavailable in restricted renderer contexts.
  }
  return normalizeLanguage(typeof navigator !== "undefined" ? navigator.language : "en");
}

function writeLanguage(language: LanguageCode) {
  try {
    window.localStorage.setItem(languageStorageKey, language);
  } catch {
    // Local storage can be unavailable in restricted renderer contexts.
  }
}

function readOnboardingDismissed() {
  try {
    return window.localStorage.getItem(onboardingStorageKey) === "dismissed";
  } catch {
    return false;
  }
}

function writeOnboardingDismissed() {
  try {
    window.localStorage.setItem(onboardingStorageKey, "dismissed");
  } catch {
    // Local storage can be unavailable in restricted renderer contexts.
  }
}

const initialCameraDiagnostics: CameraDiagnostics = {
  score: 0,
  brightness: 0,
  contrast: 0,
  sharpness: 0,
  framing: 0,
  stability: 0,
  ready: false,
  issues: ["Start the camera to check lighting and framing."],
  status: "Camera standby",
  rawMean: 0,
  rawEdge: 0
};

function scoreLabel(value: number) {
  return value.toFixed(3);
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function percent(value: number) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function normalizeFaceBox(detection: FaceDetection | null | undefined, width: number, height: number): FaceBox | null {
  if (!detection || width <= 0 || height <= 0) return null;
  const box = detection.boundingBox;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  return {
    x: clamp(box.x / width, 0, 1),
    y: clamp(box.y / height, 0, 1),
    width: clamp(box.width / width, 0, 1),
    height: clamp(box.height / height, 0, 1),
    source: "detected"
  };
}

function inferFaceBox(video: HTMLVideoElement): FaceBox {
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1.35;
  const width = ratio > 1.2 ? 0.26 : 0.34;
  const height = ratio > 1.2 ? 0.46 : 0.42;
  return {
    x: 0.5 - width / 2,
    y: 0.2,
    width,
    height,
    source: "inferred"
  };
}

function measureCameraFrame(video: HTMLVideoElement, faceBox: FaceBox | null): CameraDiagnostics {
  if (!video.videoWidth || !video.videoHeight) {
    return initialCameraDiagnostics;
  }

  const canvas = document.createElement("canvas");
  const width = 160;
  const height = Math.max(90, Math.round(width * (video.videoHeight / video.videoWidth)));
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return initialCameraDiagnostics;
  }
  context.drawImage(video, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  const luminance = new Float32Array(width * height);
  let total = 0;
  for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
    const value = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
    luminance[pixel] = value;
    total += value;
  }
  const mean = total / luminance.length;
  let variance = 0;
  let edgeTotal = 0;
  for (let y = 1; y < height; y += 1) {
    for (let x = 1; x < width; x += 1) {
      const index = y * width + x;
      const value = luminance[index];
      variance += (value - mean) ** 2;
      edgeTotal += Math.abs(value - luminance[index - 1]) + Math.abs(value - luminance[index - width]);
    }
  }
  const brightness = clamp(mean / 255);
  const contrast = clamp(Math.sqrt(variance / luminance.length) / 72);
  const sharpness = clamp((edgeTotal / Math.max(1, (width - 1) * (height - 1))) / 34);

  const box = faceBox ?? inferFaceBox(video);
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const centerPenalty = Math.min(1, Math.hypot(centerX - 0.5, centerY - 0.48) / 0.42);
  const size = Math.sqrt(box.width * box.height);
  const sizePenalty = Math.min(1, Math.abs(size - 0.36) / 0.3);
  const framing = clamp(1 - centerPenalty * 0.62 - sizePenalty * 0.38);
  const stability = clamp(sharpness * 0.55 + contrast * 0.25 + framing * 0.2);
  const brightnessScore = clamp(1 - Math.abs(brightness - 0.52) / 0.52);
  const score = clamp(
    brightnessScore * 0.24 +
    contrast * 0.22 +
    sharpness * 0.2 +
    framing * 0.24 +
    stability * 0.1
  );

  const issues: string[] = [];
  if (brightness < 0.26) issues.push("Add more light.");
  if (brightness > 0.84) issues.push("Reduce harsh light.");
  if (contrast < 0.18) issues.push("Use a clearer background.");
  if (sharpness < 0.2) issues.push("Hold still for a sharper photo.");
  if (framing < 0.64) issues.push("Center your face inside the guide.");
  const ready = score >= 0.58 && issues.length <= 1;
  return {
    score,
    brightness,
    contrast,
    sharpness,
    framing,
    stability,
    ready,
    issues: issues.length ? issues : ["Looks good for capture."],
    status: ready ? "Ready" : "Improving frame",
    rawMean: mean,
    rawEdge: edgeTotal
  };
}

function createSyntheticCameraStream() {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 640;
  const context = canvas.getContext("2d");
  let frame = 0;
  let raf = 0;
  let stopped = false;
  const paint = () => {
    if (stopped || !context) return;
    frame += 1;
    const t = frame / 52;
    const drift = Math.sin(t) * 8;
    const blink = Math.sin(t * 3) > 0.9 ? 2 : 10;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#13233a");
    gradient.addColorStop(0.48, "#264d73");
    gradient.addColorStop(1, "#4a2448");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255,255,255,0.09)";
    for (let x = 0; x < canvas.width; x += 64) context.fillRect(x, 0, 1, canvas.height);
    for (let y = 0; y < canvas.height; y += 64) context.fillRect(0, y, canvas.width, 1);
    context.save();
    context.translate(canvas.width / 2 + drift, canvas.height / 2 - 8);
    context.fillStyle = "#e6bfa0";
    context.beginPath();
    context.ellipse(0, -10, 120, 152, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#2d2530";
    context.beginPath();
    context.ellipse(0, -124, 132, 72, 0, Math.PI, Math.PI * 2);
    context.fill();
    context.fillStyle = "#24242c";
    context.beginPath();
    context.ellipse(-43, -24, 12, blink, 0, 0, Math.PI * 2);
    context.ellipse(43, -24, 12, blink, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#7b3b45";
    context.lineWidth = 8;
    context.beginPath();
    context.arc(0, 28, 42, 0.12, Math.PI - 0.12);
    context.stroke();
    context.fillStyle = "#334b73";
    context.fillRect(-76, 132, 152, 190);
    context.restore();
    raf = window.requestAnimationFrame(paint);
  };
  paint();
  const stream = canvas.captureStream(30);
  const stopAnimation = () => {
    stopped = true;
    if (raf) {
      window.cancelAnimationFrame(raf);
    }
  };
  stream.getTracks().forEach((track) => {
    const originalStop = track.stop.bind(track);
    track.stop = () => {
      stopAnimation();
      originalStop();
    };
    track.addEventListener("ended", stopAnimation, { once: true });
  });
  return stream;
}

function snapshotVideoFrame(video: HTMLVideoElement) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not prepare camera photo.");
  }
  context.drawImage(video, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.94);
}

function sameSettingValue(left: number, right: number) {
  return Math.abs(left - right) < 0.005;
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function parseListText(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function isUnmatchedClusterName(value: unknown) {
  return safeText(value).startsWith("Unmatched cluster");
}

function modelPackFromModelName(value: unknown) {
  const text = safeText(value).trim().toLowerCase();
  const match = text.match(/insightface-([^/\s(]+)/);
  return match?.[1] ?? "";
}

function finiteNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(finiteNumber(value, fallback, min, max));
}

function booleanSetting(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function stringListSetting(value: unknown, fallback: string[]) {
  const raw = Array.isArray(value)
    ? value.map((item) => typeof item === "string" ? item : "").join("\n")
    : typeof value === "string"
      ? value
      : fallback.join("\n");
  return parseListText(raw).slice(0, 1000);
}

function listText(value: string[]) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function coerceSettingsProfile(incoming: unknown, current: SettingsDraft): SettingsDraft {
  const profile = asRecord(incoming);
  if (!profile) {
    throw new Error("Profile must contain a settings object.");
  }
  const thresholds = asRecord(profile.thresholds) ?? {};
  const reviewRules = asRecord(profile.reviewRules) ?? {};
  const scanExclusions = asRecord(profile.scanExclusions) ?? {};
  const videoDecoder = asRecord(profile.videoDecoder) ?? {};
  return {
    ...current,
    modelPack: safeText(profile.modelPack, current.modelPack),
    thresholds: {
      confident: finiteNumber(thresholds.confident, current.thresholds.confident, 0, 1),
      likely: finiteNumber(thresholds.likely, current.thresholds.likely, 0, 1),
      relaxedChild: finiteNumber(thresholds.relaxedChild, current.thresholds.relaxedChild, 0, 1),
      qualityMin: finiteNumber(thresholds.qualityMin, current.thresholds.qualityMin, 0, 1)
    },
    clusterMinSize: finiteInteger(profile.clusterMinSize, current.clusterMinSize, 1, 100),
    faceDetectorSize: finiteInteger(profile.faceDetectorSize, current.faceDetectorSize, 128, 2048),
    twoPassScan: booleanSetting(profile.twoPassScan, current.twoPassScan),
    verificationDetectorSize: finiteInteger(profile.verificationDetectorSize, current.verificationDetectorSize, 128, 2048),
    safeMode: booleanSetting(profile.safeMode, current.safeMode),
    safeModeThreshold: finiteNumber(profile.safeModeThreshold, current.safeModeThreshold, 0, 1),
    storageBudgetBytes: finiteInteger(profile.storageBudgetBytes, current.storageBudgetBytes, 0, 10 * 1024 * 1024 * 1024 * 1024),
    maxMediaFileBytes: finiteInteger(profile.maxMediaFileBytes, current.maxMediaFileBytes, 0, 1024 * 1024 * 1024 * 1024),
    videoDecoder: {
      ffmpegPath: safeText(videoDecoder.ffmpegPath, current.videoDecoder.ffmpegPath),
      ffprobePath: safeText(videoDecoder.ffprobePath, current.videoDecoder.ffprobePath)
    },
    reviewRules: {
      autoRejectBelow: finiteNumber(reviewRules.autoRejectBelow, current.reviewRules.autoRejectBelow, 0, 1),
      autoUncertainLowQuality: booleanSetting(reviewRules.autoUncertainLowQuality, current.reviewRules.autoUncertainLowQuality),
      autoRejectLowQualityVideo: booleanSetting(reviewRules.autoRejectLowQualityVideo, current.reviewRules.autoRejectLowQualityVideo)
    },
    scanExclusions: {
      dirNames: stringListSetting(scanExclusions.dirNames, current.scanExclusions.dirNames),
      pathKeywords: stringListSetting(scanExclusions.pathKeywords, current.scanExclusions.pathKeywords),
      extensions: stringListSetting(scanExclusions.extensions, current.scanExclusions.extensions),
      filePaths: stringListSetting(scanExclusions.filePaths, current.scanExclusions.filePaths)
    },
    mode: "custom"
  };
}

function savedScanSourcesKey(workspace: string | null | undefined) {
  return `vintrace:scan-sources:${workspace || "default"}`;
}

function finiteTimestamp(value: unknown, fallback = Date.now()) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
}

function formatTimestampDateTime(value: unknown) {
  const timestamp = finiteTimestamp(value);
  return formatDateTime(new Date(timestamp).toISOString());
}

function readSavedScanSources(workspace: string | null | undefined): SavedScanSource[] {
  try {
    const rows = JSON.parse(window.localStorage.getItem(savedScanSourcesKey(workspace)) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row === "object" && typeof row.path === "string")
      .map((row) => {
        const createdAt = finiteTimestamp(row.createdAt);
        return {
          id: String(row.id || row.path),
          label: String(row.label || basename(row.path)),
          path: String(row.path),
          createdAt,
          lastUsedAt: finiteTimestamp(row.lastUsedAt, createdAt)
        };
      })
      .slice(0, 40);
  } catch {
    return [];
  }
}

function writeSavedScanSources(workspace: string | null | undefined, sources: SavedScanSource[]) {
  try {
    window.localStorage.setItem(savedScanSourcesKey(workspace), JSON.stringify(sources.slice(0, 40)));
  } catch {
    // Saved scan sources are a convenience; storage failures should not block scans.
  }
}

function scanQueueKey(workspace: string | null | undefined) {
  return `vintrace:scan-queue:${workspace || "default"}`;
}

function readScanQueue(workspace: string | null | undefined): ScanQueueItem[] {
  try {
    const rows = JSON.parse(window.localStorage.getItem(scanQueueKey(workspace)) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row === "object" && typeof row.path === "string")
      .map((row) => {
        const createdAt = finiteTimestamp(row.createdAt);
        return {
          id: String(row.id || row.path),
          label: String(row.label || basename(row.path)),
          path: String(row.path),
          createdAt,
          lastUsedAt: finiteTimestamp(row.lastUsedAt, createdAt),
          status: ["queued", "running", "done", "error"].includes(String(row.status)) ? row.status : "queued",
          message: typeof row.message === "string" ? row.message : undefined
        };
      })
      .slice(0, 80);
  } catch {
    return [];
  }
}

function writeScanQueue(workspace: string | null | undefined, queue: ScanQueueItem[]) {
  try {
    window.localStorage.setItem(scanQueueKey(workspace), JSON.stringify(queue.slice(0, 80)));
  } catch {
    // The queue is resumable convenience state. Scanning should still work without it.
  }
}

function savedReviewViewsKey(workspace: string | null | undefined) {
  return `vintrace:review-views:${workspace || "default"}`;
}

function readSavedReviewViews(workspace: string | null | undefined): SavedReviewView[] {
  try {
    const rows = JSON.parse(window.localStorage.getItem(savedReviewViewsKey(workspace)) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row === "object" && typeof row.label === "string")
      .map((row) => {
        const createdAt = finiteTimestamp(row.createdAt);
        return {
          id: String(row.id || `${row.label}:${createdAt}`),
          label: String(row.label).slice(0, 60),
          statusFilter: ["all", "pending", "accepted", "rejected", "uncertain"].includes(String(row.statusFilter)) ? row.statusFilter : "pending",
          reviewLane: reviewLanes.includes(String(row.reviewLane) as ReviewLane) ? String(row.reviewLane) as ReviewLane : "all",
          search: String(row.search || "").slice(0, 120),
          sort: ["score", "newest", "quality"].includes(String(row.sort)) ? row.sort : "score",
          createdAt,
          lastUsedAt: finiteTimestamp(row.lastUsedAt, createdAt)
        };
      })
      .slice(0, 16);
  } catch {
    return [];
  }
}

function writeSavedReviewViews(workspace: string | null | undefined, views: SavedReviewView[]) {
  try {
    window.localStorage.setItem(savedReviewViewsKey(workspace), JSON.stringify(views.slice(0, 16)));
  } catch {
    // Saved review views are optional UI state.
  }
}

function settingsValuesEqual(left: SettingsValues, right: SettingsValues) {
  return (
    sameSettingValue(left.thresholds.confident, right.thresholds.confident) &&
    sameSettingValue(left.thresholds.likely, right.thresholds.likely) &&
    sameSettingValue(left.thresholds.relaxedChild, right.thresholds.relaxedChild) &&
    sameSettingValue(left.thresholds.qualityMin, right.thresholds.qualityMin) &&
    left.clusterMinSize === right.clusterMinSize &&
    left.faceDetectorSize === right.faceDetectorSize &&
    left.twoPassScan === right.twoPassScan &&
    left.verificationDetectorSize === right.verificationDetectorSize &&
    left.safeMode === right.safeMode &&
    (left.safeModeZeroAdmittance ?? false) === (right.safeModeZeroAdmittance ?? false) &&
    sameSettingValue(left.safeModeThreshold, right.safeModeThreshold) &&
    left.storageBudgetBytes === right.storageBudgetBytes &&
    left.maxMediaFileBytes === right.maxMediaFileBytes &&
    left.videoDecoder.ffmpegPath === right.videoDecoder.ffmpegPath &&
    left.videoDecoder.ffprobePath === right.videoDecoder.ffprobePath &&
    sameSettingValue(left.reviewRules.autoRejectBelow, right.reviewRules.autoRejectBelow) &&
    left.reviewRules.autoUncertainLowQuality === right.reviewRules.autoUncertainLowQuality &&
    left.reviewRules.autoRejectLowQualityVideo === right.reviewRules.autoRejectLowQualityVideo &&
    sameStringList(left.scanExclusions.dirNames, right.scanExclusions.dirNames) &&
    sameStringList(left.scanExclusions.pathKeywords, right.scanExclusions.pathKeywords) &&
    sameStringList(left.scanExclusions.extensions, right.scanExclusions.extensions) &&
    sameStringList(left.scanExclusions.filePaths, right.scanExclusions.filePaths)
  );
}

function inferSettingsMode(values: SettingsValues): SettingsMode {
  return settingsPresets.find((preset) => settingsValuesEqual(values, preset.values))?.key ?? "custom";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(currentIntlLocale(), { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatDuration(ms: number) {
  const units: Record<LanguageCode, { ms: string; sec: string; min: string }> = {
    en: { ms: "ms", sec: "s", min: "m" },
    zh: { ms: "毫秒", sec: "秒", min: "分钟" },
    es: { ms: "ms", sec: "s", min: "min" },
    fr: { ms: "ms", sec: "s", min: "min" },
    ar: { ms: "مللي ثانية", sec: "ث", min: "د" },
    hi: { ms: "मि.से.", sec: "से.", min: "मि." },
    ja: { ms: "ミリ秒", sec: "秒", min: "分" }
  };
  const unit = units[imperativeLanguage] || units.en;
  if (!ms) return `0${unit.sec}`;
  if (ms < 1000) return `${formatNumber(ms)}${unit.ms}`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${formatNumber(seconds)}${unit.sec}`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${formatNumber(minutes)}${unit.min} ${formatNumber(remainder)}${unit.sec}` : `${formatNumber(minutes)}${unit.min}`;
}

function percentileValue(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((sorted.length - 1) * percentile));
  return sorted[index];
}

function summarizeLatency(samples: LatencySample[]): LatencySummary {
  const values = samples.map((sample) => sample.durationMs);
  return {
    count: samples.length,
    p50: percentileValue(values, 0.5),
    p95: percentileValue(values, 0.95),
    p99: percentileValue(values, 0.99),
    slowCount: samples.filter((sample) => sample.durationMs > sample.budgetMs).length,
    slowest: samples.reduce<LatencySample | null>((slowest, sample) => (
      !slowest || sample.durationMs > slowest.durationMs ? sample : slowest
    ), null)
  };
}

function formatBytes(bytes: number) {
  if (!bytes) return `0 ${imperativeLanguage === "zh" ? "字节" : "B"}`;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(currentIntlLocale(), { maximumFractionDigits: value >= 10 || unit === 0 ? 0 : 1 }).format(value);
  return `${formatted} ${units[unit]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "No scans yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(currentIntlLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function toneFor(value: number) {
  if (value >= 0.74) return "green";
  if (value >= 0.48) return "amber";
  return "rose";
}

function basename(value: string | null | undefined) {
  if (!value) return "";
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
}

function formatMediaTimestamp(value: number | null | undefined) {
  const total = Math.max(0, Math.round((value ?? 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isVideoCandidate(candidate: ReviewCandidate) {
  return candidate.mediaKind === "video" && Boolean(candidate.mediaSourcePath);
}

function candidateMediaPath(candidate: ReviewCandidate | null | undefined) {
  if (!candidate) return "";
  return candidate.mediaSourcePath || candidate.sourcePath;
}

function candidateSourceLabel(candidate: ReviewCandidate) {
  if (!isVideoCandidate(candidate)) return basename(candidate.sourcePath);
  return `${basename(candidate.mediaSourcePath)} @ ${formatMediaTimestamp(candidate.videoTimestampMs)}`;
}

function candidateSourceTitle(candidate: ReviewCandidate) {
  if (!isVideoCandidate(candidate)) return candidate.sourcePath;
  return [
    `Video: ${candidate.mediaSourcePath}`,
    `Moment: ${formatMediaTimestamp(candidate.videoTimestampMs)}`,
    `Extracted frame: ${candidate.sourcePath}`
  ].join("\n");
}

function candidateRiskFlags(candidate: ReviewCandidate) {
  const flags = new Set((candidate.riskFlags ?? []).map((flag) => String(flag).toLowerCase().trim()).filter(Boolean));
  const note = safeText(candidate.note).toLowerCase();
  if (note.includes("close identity scores")) flags.add("ambiguous-person-margin");
  if (note.includes("another saved person was close") || note.includes("close identity scores")) flags.add("close-runner-up");
  if (note.includes("only one saved photo separates")) flags.add("single-reference-close-runner-up");
  if (note.includes("only one saved photo supported")) flags.add("single-reference-match");
  if (note.includes("only one hard-angle signal")) flags.add("single-reference-hard-pose");
  if (note.includes("hard-angle match used pose-aware scoring")) flags.add("pose-reranked");
  return [...flags].sort();
}

function hasCloseRunnerRisk(candidate: ReviewCandidate) {
  const flags = new Set(candidateRiskFlags(candidate));
  return flags.has("close-runner-up") || flags.has("ambiguous-person-margin");
}

function hasSingleReferenceRisk(candidate: ReviewCandidate) {
  const flags = new Set(candidateRiskFlags(candidate));
  return flags.has("single-reference-match") || flags.has("single-reference-close-runner-up") || flags.has("single-reference-hard-pose");
}

function candidateRiskLabels(candidate: ReviewCandidate) {
  const flags = new Set(candidateRiskFlags(candidate));
  const labels: string[] = [];
  if (flags.has("close-runner-up") || flags.has("ambiguous-person-margin")) labels.push("Close call");
  if (flags.has("single-reference-close-runner-up") || flags.has("single-reference-match")) labels.push("One saved photo");
  if (flags.has("single-reference-hard-pose")) labels.push("Hard angle");
  if (flags.has("pose-reranked")) labels.push("Pose check");
  if (flags.has("cross-age-gap")) labels.push("Cross-age gap");
  return [...new Set(labels)];
}

const AGE_GAP_CONFIDENCE_LABEL: Record<string, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  "very-low": "Very low confidence",
};

const AGE_GAP_CAPTION =
  "NIST IFPC 2025: wide age-gap recognition is unreliable. Treat this as an investigative lead, not an identification — confirm by human review.";

function ageGapSummary(
  candidate: ReviewCandidate,
): { years: number; confidence: string; label: string; caption: string } | null {
  const years = candidate.ageGapYears;
  const confidence = candidate.ageGapConfidence;
  if (years == null || !confidence) return null;
  const yearsText = years < 1 ? "under 1 yr" : `${Math.round(years)} yr`;
  return {
    years,
    confidence,
    label: `Cross-age gap ~${yearsText} · ${AGE_GAP_CONFIDENCE_LABEL[confidence] ?? confidence}`,
    caption: AGE_GAP_CAPTION,
  };
}

function modelFamilyName(value: string | null | undefined) {
  const lower = safeText(value).toLowerCase();
  if (lower.includes("buffalo_l")) return "buffalo_l";
  if (lower.includes("buffalo_s")) return "buffalo_s";
  if (lower.includes("antelopev2")) return "antelopev2";
  if (lower.includes("fallback")) return "fallback";
  return lower || "unknown";
}

function referenceStrengthForCandidate(candidate: ReviewCandidate, references: ReferenceFace[]) {
  const personKey = safeText(candidate.personName).trim().toLowerCase();
  const refs = references.filter((ref) => safeText(ref.personName).trim().toLowerCase() === personKey);
  const candidateFamily = modelFamilyName(candidate.modelName);
  const compatible = refs.filter((ref) => modelFamilyName(ref.modelName) === candidateFamily || modelFamilyName(ref.modelName) === "unknown");
  const ageBuckets = new Set(refs.map((ref) => ref.ageBucket).filter((bucket) => bucket && bucket !== "unknown"));
  const poseBuckets = new Set(refs.map((ref) => safeText(ref.poseBucket).replace("_", "-").toLowerCase()).filter(Boolean));
  const hasSide = poseBuckets.has("profile") || poseBuckets.has("edge-face") || poseBuckets.has("side");
  const hasAngled = poseBuckets.has("three-quarter") || poseBuckets.has("threequarter") || poseBuckets.has("3q");
  const avgQuality = refs.length ? refs.reduce((sum, ref) => sum + clamp(ref.quality), 0) / refs.length : 0;
  let score = 0;
  if (refs.length >= 1) score += 18;
  if (refs.length >= 2) score += 24;
  if (refs.length >= 4) score += 8;
  if (compatible.length >= Math.min(2, refs.length)) score += 14;
  if (hasSide) score += 13;
  if (hasAngled) score += 8;
  if (ageBuckets.size >= 2) score += 10;
  if (avgQuality >= 0.65) score += 5;
  const issues: string[] = [];
  const actions: string[] = [];
  if (!refs.length) {
    issues.push("No saved photos");
    actions.push("Add saved photos for this person.");
  } else {
    if (refs.length < 2) {
      issues.push("Only one saved photo");
      actions.push("Add another clear photo.");
    }
    if (!hasSide) {
      issues.push("No side photo");
      actions.push("Add a side or profile photo.");
    }
    if (!hasAngled) {
      issues.push("No angled photo");
      actions.push("Add a slightly angled photo.");
    }
    if (ageBuckets.size < 2) {
      issues.push("One age range");
      actions.push("Add photos from another age range.");
    }
    if (compatible.length < refs.length) {
      issues.push("Mixed model photos");
      actions.push("Refresh saved photos for the active model.");
    }
  }
  const status = score >= 82 ? "strong" : score >= 58 ? "usable" : score > 0 ? "weak" : "blocked";
  return {
    score: Math.min(100, score),
    status,
    referenceCount: refs.length,
    compatibleCount: compatible.length,
    ageBucketCount: ageBuckets.size,
    hasSide,
    hasAngled,
    averageQuality: avgQuality,
    issues,
    actions: [...new Set(actions)].slice(0, 3),
    sampleNames: refs.slice(0, 3).map((ref) => basename(ref.sourcePath))
  };
}

function topRecentCandidates(candidates: ReviewCandidate[], limit: number) {
  const rows: Array<{ candidate: ReviewCandidate; time: number }> = [];
  for (const candidate of candidates) {
    const time = new Date(candidate.createdAt).getTime();
    const safeTime = Number.isFinite(time) ? time : 0;
    rows.push({ candidate, time: safeTime });
    rows.sort((a, b) => b.time - a.time);
    if (rows.length > limit) {
      rows.pop();
    }
  }
  return rows.map((row) => row.candidate);
}

function formatProvider(value: unknown) {
  if (Array.isArray(value)) {
    return String(value[0]);
  }
  return String(value);
}

function providerSummary(state: AppState) {
  return (state.platform.selected_providers ?? []).map(formatProvider).join(", ") || state.platform.primary_provider || "Unknown";
}

function platformLabel(state: AppState) {
  const platform = safeText(state.platform.platform_key, "unknown").replace(/_/g, " ");
  return `${platform} (${state.platform.system} ${state.platform.machine})`;
}

function engineLabel(value: unknown) {
  const engine = safeText(value, "Unknown");
  if (engine.startsWith("local-image-fingerprint")) return "Local image fingerprint";
  return engine.replace(/^insightface-/, "InsightFace ");
}

function firstPendingCandidate(state: AppState | null) {
  return state?.candidates.find((candidate) => candidate.status === "pending") ?? state?.candidates[0] ?? null;
}

function normalizeAppState(incoming: AppState, previous: AppState | null): AppState {
  const raw = asRecord(incoming) ?? {};
  const previousConfig = previous?.config;
  const rawConfig = asRecord(raw.config) ?? {};
  const preset = settingsPresets[0].values;
  const config: AppState["config"] = {
    modelPack: safeText(rawConfig.modelPack, previousConfig?.modelPack ?? "antelopev2"),
    modelRoot: safeText(rawConfig.modelRoot, previousConfig?.modelRoot ?? ""),
    thresholds: {
      confident: finiteNumber(asRecord(rawConfig.thresholds)?.confident, previousConfig?.thresholds.confident ?? preset.thresholds.confident, 0, 1),
      likely: finiteNumber(asRecord(rawConfig.thresholds)?.likely, previousConfig?.thresholds.likely ?? preset.thresholds.likely, 0, 1),
      relaxedChild: finiteNumber(asRecord(rawConfig.thresholds)?.relaxedChild, previousConfig?.thresholds.relaxedChild ?? preset.thresholds.relaxedChild, 0, 1),
      qualityMin: finiteNumber(asRecord(rawConfig.thresholds)?.qualityMin, previousConfig?.thresholds.qualityMin ?? preset.thresholds.qualityMin, 0, 1)
    },
    clusterMinSize: finiteInteger(rawConfig.clusterMinSize, previousConfig?.clusterMinSize ?? preset.clusterMinSize, 2, 20),
    faceDetectorSize: finiteInteger(rawConfig.faceDetectorSize, previousConfig?.faceDetectorSize ?? preset.faceDetectorSize, 320, 1024),
    twoPassScan: booleanSetting(rawConfig.twoPassScan, previousConfig?.twoPassScan ?? preset.twoPassScan),
    verificationDetectorSize: finiteInteger(rawConfig.verificationDetectorSize, previousConfig?.verificationDetectorSize ?? preset.verificationDetectorSize, 320, 1024),
    performanceMode: safeText(rawConfig.performanceMode, previousConfig?.performanceMode ?? "auto"),
    effectivePerformanceMode: safeText(rawConfig.effectivePerformanceMode, previousConfig?.effectivePerformanceMode ?? "balanced"),
    effectiveFaceDetectorSize: finiteInteger(rawConfig.effectiveFaceDetectorSize, previousConfig?.effectiveFaceDetectorSize ?? preset.faceDetectorSize, 320, 1024),
    effectiveTwoPassScan: booleanSetting(rawConfig.effectiveTwoPassScan, previousConfig?.effectiveTwoPassScan ?? preset.twoPassScan),
    effectiveVerificationDetectorSize: finiteInteger(rawConfig.effectiveVerificationDetectorSize, previousConfig?.effectiveVerificationDetectorSize ?? preset.verificationDetectorSize, 320, 1024),
    safeMode: booleanSetting(rawConfig.safeMode, previousConfig?.safeMode ?? preset.safeMode),
    safeModeThreshold: finiteNumber(rawConfig.safeModeThreshold, previousConfig?.safeModeThreshold ?? preset.safeModeThreshold, 0, 1),
    storageBudgetBytes: finiteNumber(rawConfig.storageBudgetBytes, previousConfig?.storageBudgetBytes ?? 0, 0),
    maxMediaFileBytes: finiteNumber(rawConfig.maxMediaFileBytes, previousConfig?.maxMediaFileBytes ?? 0, 0),
    videoDecoder: {
      ffmpegPath: safeText(asRecord(rawConfig.videoDecoder)?.ffmpegPath, previousConfig?.videoDecoder?.ffmpegPath ?? ""),
      ffprobePath: safeText(asRecord(rawConfig.videoDecoder)?.ffprobePath, previousConfig?.videoDecoder?.ffprobePath ?? "")
    },
    reviewRules: {
      autoRejectBelow: finiteNumber(asRecord(rawConfig.reviewRules)?.autoRejectBelow, previousConfig?.reviewRules.autoRejectBelow ?? 0, 0, 1),
      autoUncertainLowQuality: booleanSetting(asRecord(rawConfig.reviewRules)?.autoUncertainLowQuality, previousConfig?.reviewRules.autoUncertainLowQuality ?? false),
      autoRejectLowQualityVideo: booleanSetting(asRecord(rawConfig.reviewRules)?.autoRejectLowQualityVideo, previousConfig?.reviewRules.autoRejectLowQualityVideo ?? false)
    },
    scanExclusions: {
      dirNames: stringListSetting(asRecord(rawConfig.scanExclusions)?.dirNames, previousConfig?.scanExclusions.dirNames ?? defaultScanExclusions.dirNames),
      pathKeywords: stringListSetting(asRecord(rawConfig.scanExclusions)?.pathKeywords, previousConfig?.scanExclusions.pathKeywords ?? defaultScanExclusions.pathKeywords),
      extensions: stringListSetting(asRecord(rawConfig.scanExclusions)?.extensions, previousConfig?.scanExclusions.extensions ?? defaultScanExclusions.extensions),
      filePaths: stringListSetting(asRecord(rawConfig.scanExclusions)?.filePaths, previousConfig?.scanExclusions.filePaths ?? defaultScanExclusions.filePaths)
    },
    reviewOnly: booleanSetting(rawConfig.reviewOnly, previousConfig?.reviewOnly ?? false),
    requireConsent: booleanSetting(rawConfig.requireConsent, previousConfig?.requireConsent ?? true)
  };
  const rawPlatform = asRecord(raw.platform) ?? {};
  const previousPlatform = previous?.platform;
  const platform: AppState["platform"] = {
    platform_key: safeText(rawPlatform.platform_key, previousPlatform?.platform_key ?? "unknown"),
    system: safeText(rawPlatform.system, previousPlatform?.system ?? "Unknown"),
    machine: safeText(rawPlatform.machine, previousPlatform?.machine ?? "Unknown"),
    python_arch: safeText(rawPlatform.python_arch, previousPlatform?.python_arch ?? ""),
    rosetta_translated: booleanSetting(rawPlatform.rosetta_translated, previousPlatform?.rosetta_translated ?? false),
    onnxruntime_available: booleanSetting(rawPlatform.onnxruntime_available, previousPlatform?.onnxruntime_available ?? false),
    available_providers: stringListSetting(rawPlatform.available_providers, previousPlatform?.available_providers ?? []),
    selected_providers: Array.isArray(rawPlatform.selected_providers) ? rawPlatform.selected_providers : previousPlatform?.selected_providers ?? [],
    primary_provider: safeText(rawPlatform.primary_provider, previousPlatform?.primary_provider ?? "CPU"),
    accelerator_status: safeText(rawPlatform.accelerator_status, previousPlatform?.accelerator_status ?? "Unknown"),
    precision: safeText(rawPlatform.precision, previousPlatform?.precision ?? "fp32"),
    vector_backend: safeText(rawPlatform.vector_backend, previousPlatform?.vector_backend ?? ""),
    platform_notes: stringListSetting(rawPlatform.platform_notes, previousPlatform?.platform_notes ?? []),
    cpu_logical_count: finiteInteger(rawPlatform.cpu_logical_count, previousPlatform?.cpu_logical_count ?? 0, 0, 4096),
    memory_total_bytes: finiteNumber(rawPlatform.memory_total_bytes, previousPlatform?.memory_total_bytes ?? 0, 0),
    performance_tier: safeText(rawPlatform.performance_tier, previousPlatform?.performance_tier ?? "balanced"),
    recommended_performance_mode: safeText(rawPlatform.recommended_performance_mode, previousPlatform?.recommended_performance_mode ?? "balanced"),
    performance_notes: stringListSetting(rawPlatform.performance_notes, previousPlatform?.performance_notes ?? []),
    insightface_available: booleanSetting(rawPlatform.insightface_available, previousPlatform?.insightface_available ?? false),
    faiss_available: booleanSetting(rawPlatform.faiss_available, previousPlatform?.faiss_available ?? false),
    hdbscan_available: booleanSetting(rawPlatform.hdbscan_available, previousPlatform?.hdbscan_available ?? false)
  };
  const rawCounts = asRecord(raw.counts) ?? {};
  const counts = {
    references: finiteInteger(rawCounts.references, previous?.counts.references ?? 0, 0, Number.MAX_SAFE_INTEGER),
    pending: finiteInteger(rawCounts.pending, previous?.counts.pending ?? 0, 0, Number.MAX_SAFE_INTEGER),
    reviewed: finiteInteger(rawCounts.reviewed, previous?.counts.reviewed ?? 0, 0, Number.MAX_SAFE_INTEGER),
    candidates: finiteInteger(rawCounts.candidates, previous?.counts.candidates ?? 0, 0, Number.MAX_SAFE_INTEGER)
  };
  const rawTotals = asRecord(raw.scanTotals) ?? {};
  const previousTotals = previous?.scanTotals;
  const scanTotals: AppState["scanTotals"] = {
    runs: finiteInteger(rawTotals.runs, previousTotals?.runs ?? 0, 0, Number.MAX_SAFE_INTEGER),
    total: finiteInteger(rawTotals.total, previousTotals?.total ?? 0, 0, Number.MAX_SAFE_INTEGER),
    processed: finiteInteger(rawTotals.processed, previousTotals?.processed ?? 0, 0, Number.MAX_SAFE_INTEGER),
    added: finiteInteger(rawTotals.added, previousTotals?.added ?? 0, 0, Number.MAX_SAFE_INTEGER),
    matched: finiteInteger(rawTotals.matched, previousTotals?.matched ?? 0, 0, Number.MAX_SAFE_INTEGER),
    clustered: finiteInteger(rawTotals.clustered, previousTotals?.clustered ?? 0, 0, Number.MAX_SAFE_INTEGER),
    skipped: finiteInteger(rawTotals.skipped, previousTotals?.skipped ?? 0, 0, Number.MAX_SAFE_INTEGER),
    errors: finiteInteger(rawTotals.errors, previousTotals?.errors ?? 0, 0, Number.MAX_SAFE_INTEGER),
    unmatched: finiteInteger(rawTotals.unmatched, previousTotals?.unmatched ?? 0, 0, Number.MAX_SAFE_INTEGER),
    safeFiltered: finiteInteger(rawTotals.safeFiltered, previousTotals?.safeFiltered ?? 0, 0, Number.MAX_SAFE_INTEGER),
    videoFiles: finiteInteger(rawTotals.videoFiles, previousTotals?.videoFiles ?? 0, 0, Number.MAX_SAFE_INTEGER),
    videoFrames: finiteInteger(rawTotals.videoFrames, previousTotals?.videoFrames ?? 0, 0, Number.MAX_SAFE_INTEGER),
    videoProtected: finiteInteger(rawTotals.videoProtected, previousTotals?.videoProtected ?? 0, 0, Number.MAX_SAFE_INTEGER),
    excluded: finiteInteger(rawTotals.excluded, previousTotals?.excluded ?? 0, 0, Number.MAX_SAFE_INTEGER),
    noFaceDetected: finiteInteger(rawTotals.noFaceDetected, previousTotals?.noFaceDetected ?? 0, 0, Number.MAX_SAFE_INTEGER),
    lowQualityFaces: finiteInteger(rawTotals.lowQualityFaces, previousTotals?.lowQualityFaces ?? 0, 0, Number.MAX_SAFE_INTEGER),
    blockedPairs: finiteInteger(rawTotals.blockedPairs, previousTotals?.blockedPairs ?? 0, 0, Number.MAX_SAFE_INTEGER),
    duplicateCandidates: finiteInteger(rawTotals.duplicateCandidates, previousTotals?.duplicateCandidates ?? 0, 0, Number.MAX_SAFE_INTEGER),
    videoCandidateCap: finiteInteger(rawTotals.videoCandidateCap, previousTotals?.videoCandidateCap ?? 0, 0, Number.MAX_SAFE_INTEGER),
    profileRescueAttempted: finiteInteger(rawTotals.profileRescueAttempted, previousTotals?.profileRescueAttempted ?? 0, 0, Number.MAX_SAFE_INTEGER),
    profileRescueFound: finiteInteger(rawTotals.profileRescueFound, previousTotals?.profileRescueFound ?? 0, 0, Number.MAX_SAFE_INTEGER),
    profileRescueMatched: finiteInteger(rawTotals.profileRescueMatched, previousTotals?.profileRescueMatched ?? 0, 0, Number.MAX_SAFE_INTEGER),
    profileRescueUnmatched: finiteInteger(rawTotals.profileRescueUnmatched, previousTotals?.profileRescueUnmatched ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseFrontal: finiteInteger(rawTotals.poseFrontal, previousTotals?.poseFrontal ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseThreeQuarter: finiteInteger(rawTotals.poseThreeQuarter, previousTotals?.poseThreeQuarter ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseProfile: finiteInteger(rawTotals.poseProfile, previousTotals?.poseProfile ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseUnknown: finiteInteger(rawTotals.poseUnknown, previousTotals?.poseUnknown ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseRelaxedReviews: finiteInteger(rawTotals.poseRelaxedReviews, previousTotals?.poseRelaxedReviews ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseRelaxedProfile: finiteInteger(rawTotals.poseRelaxedProfile, previousTotals?.poseRelaxedProfile ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseRelaxedThreeQuarter: finiteInteger(rawTotals.poseRelaxedThreeQuarter, previousTotals?.poseRelaxedThreeQuarter ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseReranked: finiteInteger(rawTotals.poseReranked, previousTotals?.poseReranked ?? 0, 0, Number.MAX_SAFE_INTEGER),
    poseAmbiguous: finiteInteger(rawTotals.poseAmbiguous, previousTotals?.poseAmbiguous ?? 0, 0, Number.MAX_SAFE_INTEGER),
    closeRunnerUp: finiteInteger(rawTotals.closeRunnerUp, previousTotals?.closeRunnerUp ?? 0, 0, Number.MAX_SAFE_INTEGER),
    singleReferenceMatches: finiteInteger(rawTotals.singleReferenceMatches, previousTotals?.singleReferenceMatches ?? 0, 0, Number.MAX_SAFE_INTEGER),
    hardPoseUnsupported: finiteInteger(rawTotals.hardPoseUnsupported, previousTotals?.hardPoseUnsupported ?? 0, 0, Number.MAX_SAFE_INTEGER),
    safeModeFaceCropAllowed: finiteInteger(rawTotals.safeModeFaceCropAllowed, previousTotals?.safeModeFaceCropAllowed ?? 0, 0, Number.MAX_SAFE_INTEGER),
    durationMs: finiteNumber(rawTotals.durationMs, previousTotals?.durationMs ?? 0, 0),
    lastCompletedAt: typeof rawTotals.lastCompletedAt === "string" || rawTotals.lastCompletedAt === null ? rawTotals.lastCompletedAt : previousTotals?.lastCompletedAt ?? null
  };
  return {
    ...(previous ?? {}),
    ...(incoming as AppState),
    version: safeText(raw.version, previous?.version ?? "0.0.0"),
    workspace: safeText(raw.workspace, previous?.workspace ?? ""),
    consentOnFile: booleanSetting(raw.consentOnFile, previous?.consentOnFile ?? false),
    engine: safeText(raw.engine, previous?.engine ?? "local-image-fingerprint"),
    vectorStore: safeText(raw.vectorStore, previous?.vectorStore ?? platform.vector_backend),
    platform,
    counts,
    scanHistory: Array.isArray(raw.scanHistory) ? raw.scanHistory as AppState["scanHistory"] : previous?.scanHistory ?? [],
    scanTotals,
    benchmarkHistory: Array.isArray(raw.benchmarkHistory) ? raw.benchmarkHistory as AppState["benchmarkHistory"] : previous?.benchmarkHistory ?? [],
    videoMoments: Array.isArray(raw.videoMoments) ? raw.videoMoments as AppState["videoMoments"] : previous?.videoMoments ?? [],
    references: Array.isArray(raw.references) ? raw.references as AppState["references"] : previous?.references ?? [],
    candidates: Array.isArray(raw.candidates) ? raw.candidates as AppState["candidates"] : previous?.candidates ?? [],
    config
  };
}

export default function App() {
  const [language, setLanguage] = useState<LanguageCode>(() => readInitialLanguage());
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [busy, setBusy] = useState<string | null>("Starting local engine");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootStartedAt, setBootStartedAt] = useState(() => Date.now());
  const [bootClock, setBootClock] = useState(() => Date.now());
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [personName, setPersonName] = useState("");
  const [ageBucket, setAgeBucket] = useState<AgeBucket>("unknown");
  const [enrollFolder, setEnrollFolder] = useState("");
  const [ageGroupFolders, setAgeGroupFolders] = useState<AgeFolderMap>(() => emptyAgeFolders());
  const [scanFolder, setScanFolder] = useState("");
  const [settings, setSettings] = useState<SettingsDraft | null>(null);
  const [systemIntegration, setSystemIntegration] = useState<SystemIntegration | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState<DiagnosticsReport | null>(null);
  const [installerDiagnostics, setInstallerDiagnostics] = useState<InstallerDiagnosticsResult | null>(null);
  const [photoSources, setPhotoSources] = useState<SystemPhotoSource[]>([]);
  const [workspaceLock, setWorkspaceLock] = useState<WorkspaceLockStatus | null>(null);
  const [duplicatePeople, setDuplicatePeople] = useState<DuplicatePeopleResult | null>(null);
  const [reviewRuleResult, setReviewRuleResult] = useState<ReviewRulesApplyResult | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [localScanMarkers, setLocalScanMarkers] = useState<{ cancelRequested: boolean; paused: boolean } | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [mediaActionProgress, setMediaActionProgress] = useState<MediaActionProgress | null>(null);
  const [folderAnalysis, setFolderAnalysis] = useState<FolderAnalysis | null>(null);
  const [savedScanSources, setSavedScanSources] = useState<SavedScanSource[]>([]);
  const [scanQueue, setScanQueue] = useState<ScanQueueItem[]>([]);
  const [scanQueueRunning, setScanQueueRunning] = useState(false);
  const [backupVerification, setBackupVerification] = useState<WorkspaceBackupVerification | null>(null);
  const [backupPruneResult, setBackupPruneResult] = useState<WorkspaceBackupPruneValue | null>(null);
  const [backupRestoreResult, setBackupRestoreResult] = useState<WorkspaceBackupRestoreValue | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceHealth | null>(null);
  const [workspaceOptimizeResult, setWorkspaceOptimizeResult] = useState<WorkspaceOptimizeResult | null>(null);
  const [workspaceRepairResult, setWorkspaceRepairResult] = useState<WorkspaceRepairResult | null>(null);
  const [databaseRepairResult, setDatabaseRepairResult] = useState<DatabaseRepairResult | null>(null);
  const [workspaceRelinkResult, setWorkspaceRelinkResult] = useState<WorkspaceRelinkResult | null>(null);
  const [scanManifestPruneResult, setScanManifestPruneResult] = useState<ScanManifestPruneValue | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventsResult | null>(null);
  const [runtimeSelfTest, setRuntimeSelfTest] = useState<RuntimeSelfTestResult | null>(null);
  const [modelIntegrity, setModelIntegrity] = useState<ModelIntegrityResult | null>(null);
  const [runtimeBenchmark, setRuntimeBenchmark] = useState<RuntimeBenchmarkResult | null>(null);
  const [releaseReadiness, setReleaseReadiness] = useState<ReleaseReadinessResult | null>(null);
  const [accuracyEvaluation, setAccuracyEvaluation] = useState<AccuracyEvaluation | null>(null);
  const [accuracyValidationPack, setAccuracyValidationPack] = useState<AccuracyValidationPackValue | null>(null);
  const [publicDatasetCatalog, setPublicDatasetCatalog] = useState<PublicDatasetCatalog | null>(null);
  const [publicDatasetInspection, setPublicDatasetInspection] = useState<PublicDatasetInspection | null>(null);
  const [publicDatasetBenchmark, setPublicDatasetBenchmark] = useState<PublicDatasetBenchmarkResult | null>(null);
  const [publicDatasetModelComparison, setPublicDatasetModelComparison] = useState<PublicDatasetModelComparisonResult | null>(null);
  const [privacyReport, setPrivacyReport] = useState<PrivacyReport | null>(null);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceListItem[]>([]);
  const [mediaTrashReport, setMediaTrashReport] = useState<MediaTrashReportValue | null>(null);
  const [mediaTrashCleanup, setMediaTrashCleanup] = useState<MediaTrashCleanupValue | null>(null);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicyReport | null>(null);
  const [modelDriftReport, setModelDriftReport] = useState<ModelDriftReport | null>(null);
  const [referenceGapReport, setReferenceGapReport] = useState<ReferenceGapReport | null>(null);
  const [modelSwitchPlan, setModelSwitchPlan] = useState<ModelSwitchDryRun | null>(null);
  const [watchStatus, setWatchStatus] = useState<FolderWatchStatus>(initialWatchStatus);
  const [latencySamples, setLatencySamples] = useState<LatencySample[]>([]);
  const [performanceChoice, setPerformanceChoiceState] = useState<PerformanceChoice>("auto");
  const [consentPrompt, setConsentPrompt] = useState<ConsentPrompt | null>(null);
  const [reviewUndo, setReviewUndo] = useState<ReviewUndo | null>(null);
  const [pendingExternalIntent, setPendingExternalIntent] = useState<PendingExternalIntent | null>(null);
  const [lastPreflight, setLastPreflight] = useState<{ folder: string; at: number; ready: boolean } | null>(null);
  const [dismissedRecoveryRunId, setDismissedRecoveryRunId] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const watchStatusRef = useRef<FolderWatchStatus>(initialWatchStatus);
  const startupRequestId = useRef(0);
  const folderAnalysisRequestId = useRef(0);
  const stateReadyRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const rendererReadySentRef = useRef(false);
  const memoryPressureNoticeRef = useRef("");
  const appCommandHandlerRef = useRef<(command: AppCommand) => void | Promise<void>>(() => undefined);
  const externalOpenHandlerRef = useRef<(payload: ExternalOpenPayload) => void | Promise<void>>(() => undefined);
  const performanceMode = useMemo(() => resolvePerformanceMode(performanceChoice, state?.platform), [performanceChoice, state?.platform]);
  const performanceProfile = performanceProfiles[performanceMode];
  const memoryPressureActive = scanProgress?.memoryPressure === "high" || scanProgress?.memoryPressure === "critical";
  const runtimePerformanceProfile = memoryPressureActive ? performanceProfiles.fast : performanceProfile;
  const latencySummary = useMemo(() => summarizeLatency(latencySamples), [latencySamples]);
  const t = useMemo(() => (key: TranslationKey, values?: Record<string, string | number>) => translate(language, key, values), [language]);
  const uiText = useMemo(() => (source: string) => translateUiText(language, source), [language]);

  function uiMessage(key: UiMessageKey, values: UiMessageValues = {}) {
    const localizedValues = Object.fromEntries(
      Object.entries(values).map(([name, value]) => [name, typeof value === "string" ? uiText(value) : value])
    );
    return formatUiMessage(language, key, localizedValues);
  }

  function setNoticeMessage(tone: NoticeState["tone"], messageKey: UiMessageKey, values: UiMessageValues, fallback: string) {
    setNotice({ tone, messageKey, values, text: fallback });
  }

  function setErrorNotice(error: unknown, fallback = "The action failed.") {
    const details = errorDetails(error, fallback);
    setNotice({ tone: "error", text: details.text, errorCode: details.code, action: details.action });
  }

  function confirmDialogMessage(messageKey: UiMessageKey, values: UiMessageValues, fallback: string): Promise<boolean> {
    // H5: route the localized confirmation through the in-app dialog host.
    return requestConfirm(language === "en" ? localizeImperativeText(fallback) : uiMessage(messageKey, values));
  }

  function changeLanguage(nextLanguage: LanguageCode) {
    setLanguage(nextLanguage);
    writeLanguage(nextLanguage);
  }

  function recordRendererDiagnostic(event: Record<string, unknown>) {
    window.crossAge.recordDiagnosticEvent({
      url: window.location.href,
      ...event
    }).catch(() => undefined);
  }

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    setImperativeLanguage(language);
    window.crossAge.setAppLanguage?.(language).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    const payloadFromReason = (reason: unknown) => ({
      message: reason instanceof Error ? reason.message : String(reason || "Unknown renderer failure."),
      stack: reason instanceof Error ? reason.stack || "" : "",
      code: typeof reason === "object" && reason && "code" in reason ? String((reason as { code?: unknown }).code || "") : ""
    });
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason || "An action failed.");
      if (reason && typeof reason === "object" && "__crossageDiagnosticRecorded" in reason) {
        setErrorNotice(reason, message);
        event.preventDefault();
        return;
      }
      recordRendererDiagnostic({
        type: "renderer_unhandled_rejection",
        level: "error",
        category: "renderer",
        ...payloadFromReason(reason)
      });
      setErrorNotice(reason, message);
      event.preventDefault();
    };
    const handleWindowError = (event: ErrorEvent) => {
      recordRendererDiagnostic({
        type: "renderer_runtime_error",
        level: "error",
        category: "renderer",
        message: event.message || "Renderer runtime error.",
        stack: event.error instanceof Error ? event.error.stack || "" : "",
        reason: `${event.filename || ""}:${event.lineno || 0}:${event.colno || 0}`
      });
    };
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleWindowError);
    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleWindowError);
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let localizing = false;
    const root = document.getElementById("root") || document.body;
    const pendingRoots = new Set<ParentNode>();
    const enqueueLocalizationRoot = (node: Node | null) => {
      if (!node) return;
      const target = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      if (!target || !root.contains(target)) return;
      pendingRoots.add(target as ParentNode);
    };
    const scheduleLocalization = (target?: ParentNode) => {
      if (target) pendingRoots.add(target);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        localizing = true;
        try {
          const validTargets = [...pendingRoots].filter((node) => node === root || root.contains(node as Node));
          const targets = validTargets.filter((node) => !validTargets.some((other) => other !== node && (other as Node).contains(node as Node)));
          pendingRoots.clear();
          for (const targetRoot of targets) {
            localizeDom(targetRoot, language);
          }
        } finally {
          localizing = false;
        }
      });
    };
    const observer = new MutationObserver((mutations) => {
      if (localizing) return;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          enqueueLocalizationRoot(mutation.target);
          mutation.addedNodes.forEach(enqueueLocalizationRoot);
        } else if (mutation.type === "attributes") {
          enqueueLocalizationRoot(mutation.target);
        } else if (mutation.type === "characterData") {
          enqueueLocalizationRoot(mutation.target.parentNode);
        }
      }
      scheduleLocalization();
    });
    scheduleLocalization(root);
    observer.observe(root, {
      attributeFilter: ["alt", "aria-label", "placeholder", "title"],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [language]);

  useEffect(() => {
    if (workspaceRef.current) {
      workspaceRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    setSavedScanSources(readSavedScanSources(state?.workspace));
    setScanQueue(readScanQueue(state?.workspace));
  }, [state?.workspace]);

  useEffect(() => {
    if (state?.workspace) {
      void refreshScanMarkerStatus();
    }
  }, [state?.workspace]);

  useEffect(() => {
    if (!state?.workspace || publicDatasetCatalog) return;
    window.crossAge.invoke<PublicDatasetCatalog>("public_dataset_catalog", {})
      .then((catalog) => setPublicDatasetCatalog(catalog))
      .catch((error) => {
        recordRendererDiagnostic({
          type: "renderer_dataset_catalog_failed",
          level: "warn",
          category: "renderer",
          message: error instanceof Error ? error.message : String(error)
        });
      });
  }, [state?.workspace, publicDatasetCatalog]);

  useEffect(() => {
    const unsubscribeBackend = window.crossAge.onBackendError((message) => {
      setBootError(message);
      setErrorNotice(new Error(message), message);
      setBusy(null);
    });
    const unsubscribeStartup = window.crossAge.onBackendStartup((event) => {
      if (!stateReadyRef.current) {
        setBusy(event.message || `Starting ${event.phase}`);
      }
    });
    // H1: the scan-progress stream fires faster than the display can paint. Hold
    // the latest payload and flush it at most once per animation frame so a burst
    // of ticks collapses to a single re-render instead of a per-event storm.
    let scanProgressRaf = 0;
    let pendingScanProgress: ScanProgress | null = null;
    const flushScanProgress = () => {
      scanProgressRaf = 0;
      if (pendingScanProgress) {
        setScanProgress(pendingScanProgress);
        pendingScanProgress = null;
      }
    };
    const unsubscribeProgress = window.crossAge.onScanProgress((event) => {
      if (event.name === "model_download") {
        setModelDownloadProgress(event.payload);
        return;
      }
      if (event.name === "media_action") {
        setMediaActionProgress(event.payload);
        if (event.payload.state) {
          applyState(event.payload.state);
        }
        return;
      }
      pendingScanProgress = event.payload;
      if (!scanProgressRaf) {
        scanProgressRaf = window.requestAnimationFrame(flushScanProgress);
      }
      const pressure = String(event.payload.memoryPressure || "");
      if ((pressure === "high" || pressure === "critical") && memoryPressureNoticeRef.current !== pressure) {
        memoryPressureNoticeRef.current = pressure;
        setNotice({
          tone: pressure === "critical" ? "error" : "warn",
          text: event.payload.memoryMessage || "Memory is tight, so preview work is reduced during this scan."
        });
      } else if (pressure === "normal" && memoryPressureNoticeRef.current) {
        memoryPressureNoticeRef.current = "";
      }
      if (["complete", "cancelled", "error"].includes(String(event.payload.phase))) {
        setLocalScanMarkers(null);
      }
      if (event.payload.source === "watch" && event.payload.phase === "complete") {
        applyWatchStatus((current) => ({
          active: current.active,
          folder: current.folder,
          queued: current.queued,
          scanning: false,
          message: `Processed ${event.payload.processed ?? 0} new file(s).`
        }));
      }
      if (event.payload.state) {
        applyState(event.payload.state);
      }
    });
    const unsubscribeWatch = window.crossAge.onFolderWatch((status) => {
      applyWatchStatus(status);
      if (status.result?.state) {
        applyState(status.result.state);
      }
      if (status.error) {
        setNotice({ tone: "error", text: status.error });
      }
    });
    const unsubscribeUpdate = window.crossAge.onUpdateStatus((status) => {
      setUpdateStatus(status);
    });
    let diagnosticsRefreshTimer = 0;
    const unsubscribeDiagnostics = window.crossAge.onDiagnosticsEvent(() => {
      setDiagnosticsReport((current) => {
        if (!current) return current;
        const includePaths = current.privacy.includesFilePaths;
        if (diagnosticsRefreshTimer) window.clearTimeout(diagnosticsRefreshTimer);
        diagnosticsRefreshTimer = window.setTimeout(() => {
          window.crossAge.getDiagnosticsReport(includePaths)
            .then(setDiagnosticsReport)
            .catch(() => undefined);
        }, 150);
        return current;
      });
    });
    const unsubscribeCommand = window.crossAge.onAppCommand((command) => {
      Promise.resolve(appCommandHandlerRef.current(command)).catch((error) => {
        setErrorNotice(error);
      });
    });
    const unsubscribeExternalOpen = window.crossAge.onExternalOpen((payload) => {
      Promise.resolve(externalOpenHandlerRef.current(payload)).catch((error) => {
        setErrorNotice(error);
      });
    });
    loadInitialState();
    return () => {
      unsubscribeBackend();
      unsubscribeStartup();
      unsubscribeProgress();
      unsubscribeWatch();
      unsubscribeUpdate();
      unsubscribeDiagnostics();
      if (diagnosticsRefreshTimer) window.clearTimeout(diagnosticsRefreshTimer);
      if (scanProgressRaf) window.cancelAnimationFrame(scanProgressRaf);
      unsubscribeCommand();
      unsubscribeExternalOpen();
    };
  }, []);

  useEffect(() => {
    if (state) {
      return undefined;
    }
    const timer = window.setInterval(() => setBootClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  async function loadInitialState() {
    const requestId = startupRequestId.current + 1;
    const startedAt = performance.now();
    startupRequestId.current = requestId;
    stateReadyRef.current = false;
    setBootError(null);
    setBootStartedAt(Date.now());
    setBootClock(Date.now());
    setBusy("Starting local engine");
    setNotice(null);
    window.crossAge
      .getSystemIntegration()
      .then(setSystemIntegration)
      .catch(() => undefined);
    window.crossAge
      .getUpdateStatus()
      .then(setUpdateStatus)
      .catch(() => undefined);
    window.crossAge
      .getPhotoSources()
      .then(setPhotoSources)
      .catch(() => undefined);
    window.crossAge
      .getWorkspaceLockStatus()
      .then(setWorkspaceLock)
      .catch(() => undefined);
    try {
      const next = await window.crossAge.getInitialState();
      if (requestId !== startupRequestId.current) return;
      const safeNext = normalizeAppState(next, state);
      recordLatency("Startup", "initial_state", startedAt);
      applyState(safeNext);
      void loadWorkspaces();
      setNotice({ tone: "ok", text: "Backend ready." });
      const startupMode = resolvePerformanceMode(normalizePerformanceChoice(safeNext.config.performanceMode), safeNext.platform);
      const startupPreviewLimit = performanceProfiles[startupMode].previewWarmupLimit;
      if (startupPreviewLimit > 0) {
        window.setTimeout(() => warmPreviewCache(startupPreviewLimit), 240);
      }
    } catch (error) {
      if (requestId !== startupRequestId.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setBootError(message);
      setErrorNotice(error, message);
    } finally {
      if (requestId === startupRequestId.current) {
        setBusy(null);
      }
    }
  }

  function recordLatency(label: string, command: string, startedAt: number) {
    const sample: LatencySample = {
      label,
      command,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      at: Date.now(),
      budgetMs: runtimePerformanceProfile.slowCommandMs
    };
    setLatencySamples((current) => [sample, ...current].slice(0, 40));
  }

  async function warmPreviewCache(limit = runtimePerformanceProfile.previewWarmupLimit, userVisible = false) {
    if (limit <= 0) {
      if (userVisible) {
        setNotice({ tone: "warn", text: "Preview warmup is off in Fast mode." });
      }
      return;
    }
    try {
      const startedAt = performance.now();
      const result = await window.crossAge.invoke<CommandResult>("prepare_previews", { limit });
      recordLatency("Preview warmup", "prepare_previews", startedAt);
      if (result.state) {
        applyState(result.state);
      }
      if (userVisible) {
        setNotice({ tone: "ok", text: `Prepared ${result.prepared ?? 0} preview(s).` });
      }
    } catch (error) {
      if (userVisible) {
        setErrorNotice(error, "Preview warmup failed.");
      }
    }
  }

  function copyPerformanceReport() {
    const samples = latencySamples.slice(0, 12);
    const hardwareTier = state?.platform ? performanceTierLabel(state.platform.performance_tier) : "Unknown";
    const effectiveDetail = [
      state?.config.effectiveFaceDetectorSize ? `detector ${state.config.effectiveFaceDetectorSize}` : "",
      (state?.config.effectiveTwoPassScan ?? state?.config.twoPassScan) ? "two-pass" : "one-pass"
    ].filter(Boolean).join(", ");
    copyText([
      "Vintrace performance report",
      `Mode: ${performanceChoice === "auto" ? `Auto (${performanceProfile.label})` : performanceProfile.label}`,
      `Hardware tier: ${hardwareTier}`,
      `CPU cores: ${state?.platform.cpu_logical_count ?? "Unknown"}`,
      `Memory: ${state?.platform.memory_total_bytes ? formatBytes(state.platform.memory_total_bytes) : "Unknown"}`,
      `Effective scan: ${effectiveDetail || "Default"}`,
      `App folder: ${state?.workspace ?? "Unknown"}`,
      `Samples: ${latencySummary.count}`,
      `p50: ${formatDuration(latencySummary.p50)}`,
      `p95: ${formatDuration(latencySummary.p95)}`,
      `p99: ${formatDuration(latencySummary.p99)}`,
      `Slow commands: ${latencySummary.slowCount}`,
      latencySummary.slowest ? `Slowest: ${latencySummary.slowest.label} (${formatDuration(latencySummary.slowest.durationMs)})` : "Slowest: none",
      "",
      ...samples.map((sample) => `${formatDateTime(new Date(sample.at).toISOString())} | ${sample.label} | ${sample.command} | ${formatDuration(sample.durationMs)} | budget ${formatDuration(sample.budgetMs)}`)
    ].join("\n"), "Performance report");
  }

  function clearLatencySamples() {
    setLatencySamples([]);
    setNotice({ tone: "ok", text: "Latency samples cleared." });
  }

  async function setPerformanceChoice(nextChoice: PerformanceChoice) {
    const previousChoice = performanceChoice;
    const normalized = normalizePerformanceChoice(nextChoice);
    setPerformanceChoiceState(normalized);
    try {
      const nextState = await invoke<AppState>("Updating performance mode", "set_performance_mode", { mode: normalized });
      const resolved = resolvePerformanceMode(normalized, nextState.platform);
      setNotice({
        tone: "ok",
        text: normalized === "auto"
          ? `Auto performance is using ${performanceProfiles[resolved].label}.`
          : `${performanceProfiles[resolved].label} performance mode is on.`
      });
    } catch (error) {
      setPerformanceChoiceState(previousChoice);
      setErrorNotice(error, "Performance mode could not be updated.");
    }
  }

  function applyWatchStatus(next: FolderWatchStatus | ((current: FolderWatchStatus) => FolderWatchStatus)) {
    setWatchStatus((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      watchStatusRef.current = resolved;
      return resolved;
    });
  }

  async function refreshScanMarkerStatus() {
    try {
      const marker = await window.crossAge.getScanMarkerStatus();
      setLocalScanMarkers({ cancelRequested: marker.cancelRequested, paused: marker.paused });
    } catch {
      // Marker status is advisory. Scan progress events remain the source of truth.
    }
  }

  function applyState(rawNext: AppState) {
    const next = normalizeAppState(rawNext, state);
    stateReadyRef.current = true;
    setState(next);
    setPerformanceChoiceState(normalizePerformanceChoice(next.config.performanceMode));
    const nextSettings: SettingsValues = {
      thresholds: next.config.thresholds,
      clusterMinSize: next.config.clusterMinSize,
      faceDetectorSize: next.config.faceDetectorSize,
      twoPassScan: next.config.twoPassScan,
      verificationDetectorSize: next.config.verificationDetectorSize,
      safeMode: next.config.safeMode,
      safeModeZeroAdmittance: next.config.safeModeZeroAdmittance ?? false,
      safeModeThreshold: next.config.safeModeThreshold,
      storageBudgetBytes: next.config.storageBudgetBytes ?? 0,
      maxMediaFileBytes: next.config.maxMediaFileBytes ?? 0,
      videoDecoder: next.config.videoDecoder ?? defaultVideoDecoder,
      reviewRules: next.config.reviewRules ?? {
        autoRejectBelow: 0,
        autoUncertainLowQuality: false,
        autoRejectLowQualityVideo: false
      },
      scanExclusions: { ...defaultScanExclusions, ...(next.config.scanExclusions ?? {}) }
    };
    if (!settingsDirtyRef.current) {
      setSettings({ ...nextSettings, modelPack: next.config.modelPack ?? "antelopev2", mode: inferSettingsMode(nextSettings) });
    }
    setSelectedCandidateId((current) => {
      if (current && next.candidates.some((candidate) => candidate.candidateId === current)) return current;
      return firstPendingCandidate(next)?.candidateId ?? null;
    });
    setSelectedRefId((current) => {
      if (current && next.references.some((ref) => ref.refId === current)) return current;
      return next.references[0]?.refId ?? null;
    });
  }

  function updateSettingsDraft(value: SettingsDraft) {
    settingsDirtyRef.current = true;
    setSettings(value);
  }

  async function invoke<T = unknown>(label: string, command: string, params: Record<string, unknown> = {}, options: { quiet?: boolean } = {}) {
    const startedAt = performance.now();
    // H4: a "quiet" invoke skips the global busy spinner and keyboard-block so
    // the rapid review-triage loop stays responsive while the write is in flight.
    if (!options.quiet) setBusy(label);
    setNotice(null);
    try {
      const result = await window.crossAge.invoke<T>(command, params);
      const maybeCommand = result as CommandResult;
      const maybeState = result as AppState;
      if (maybeCommand.state) {
        applyState(maybeCommand.state as AppState);
      } else if (maybeState.counts) {
        applyState(maybeState);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = errorDetails(error, message);
      recordRendererDiagnostic({
        type: "renderer_action_failed",
        level: "error",
        category: "renderer",
        actionLabel: label,
        command,
        message: details.text,
        stack: error instanceof Error ? error.stack || "" : "",
        code: details.code
      });
      if (error && typeof error === "object") {
        (error as { __crossageDiagnosticRecorded?: boolean }).__crossageDiagnosticRecorded = true;
      }
      setNotice({ tone: "error", text: details.text, errorCode: details.code, action: details.action });
      throw error;
    } finally {
      recordLatency(label, command, startedAt);
      if (!options.quiet) setBusy(null);
    }
  }

  async function queryCandidates(params: Record<string, unknown>) {
    const startedAt = performance.now();
    try {
      return await window.crossAge.invoke<CandidateQueryResult>("query_candidates", params);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = errorDetails(error, message);
      recordRendererDiagnostic({
        type: "renderer_action_failed",
        level: "error",
        category: "renderer",
        actionLabel: "Load matches",
        command: "query_candidates",
        message: details.text,
        stack: error instanceof Error ? error.stack || "" : "",
        code: details.code
      });
      if (error && typeof error === "object") {
        (error as { __crossageDiagnosticRecorded?: boolean }).__crossageDiagnosticRecorded = true;
      }
      setNotice({ tone: "error", text: details.text, errorCode: details.code, action: details.action });
      throw error;
    } finally {
      recordLatency("Load matches", "query_candidates", startedAt);
    }
  }

  async function checkForUpdates() {
    setNotice(null);
    try {
      const status = await window.crossAge.checkForUpdates();
      setUpdateStatus(status);
      setNotice({ tone: status.error ? "warn" : "ok", text: status.message || "Update check finished." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function setUpdateChannel(channel: UpdateChannel) {
    try {
      const status = await window.crossAge.setUpdateChannel(channel);
      setUpdateStatus(status);
      setNotice({ tone: "ok", text: status.message || "Update channel saved." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function downloadUpdate() {
    try {
      const status = await window.crossAge.downloadUpdate();
      setUpdateStatus(status);
      setNotice({ tone: status.error ? "warn" : "ok", text: status.message || "Update download started." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function installUpdate() {
    try {
      const status = await window.crossAge.installUpdate();
      setUpdateStatus(status);
      setNotice({ tone: status.error ? "warn" : "ok", text: status.message || "Installing update." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function previewDiagnostics(includePaths = false) {
    try {
      const report = await window.crossAge.getDiagnosticsReport(includePaths);
      setDiagnosticsReport(report);
      setNotice({ tone: "ok", text: "Diagnostics report preview loaded." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function exportDiagnostics(includePaths = false) {
    try {
      const result = await window.crossAge.exportDiagnosticsReport(includePaths);
      setDiagnosticsReport(result.report);
      if (result.cancelled || !result.path) {
        setNotice({ tone: "warn", text: "Diagnostics export cancelled." });
        return;
      }
      setNotice({ tone: "ok", text: "Diagnostics report exported." });
      await window.crossAge.revealPath(result.path);
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function exportSupportBundle(includePaths = false) {
    if (includePaths) {
      const proceed = await confirmDialog("Include local file paths in the support bundle? Leave this off unless a trusted tester needs exact path details.");
      if (!proceed) return;
    }
    const result = await invoke<CommandResult<SupportBundleValue>>("Exporting support bundle", "export_support_bundle", { includePaths });
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Support bundle did not return a zip path." });
      return;
    }
    setNoticeMessage("ok", "notice.supportBundleExported", { bytes: formatBytes(value.bytes) }, `Support bundle exported (${formatBytes(value.bytes)}).`);
    await window.crossAge.revealPath(value.zipPath);
  }

  async function loadWorkspaces() {
    try {
      const result = await invoke<{ workspaces: WorkspaceListItem[] }>("Listing workspaces", "list_workspaces");
      setRecentWorkspaces(result?.workspaces ?? []);
    } catch {
      // Non-fatal: the switcher is a convenience.
    }
  }

  async function switchWorkspace(path: string) {
    if (!path) return;
    await window.crossAge.stopFolderWatch();
    settingsDirtyRef.current = false;
    await invoke<AppState>("Switching app folder", "set_workspace", { path });
    await refreshWorkspaceLockStatus();
    await loadWorkspaces();
    setNotice({ tone: "ok", text: "Workspace switched. Please confirm permission again." });
  }

  async function chooseWorkspace() {
    const folder = await window.crossAge.chooseFolder();
    if (!folder) return;
    await window.crossAge.stopFolderWatch();
    settingsDirtyRef.current = false;
    await invoke<AppState>("Opening app folder", "set_workspace", { path: folder });
    await refreshWorkspaceLockStatus();
    await loadWorkspaces();
    setNotice({ tone: "ok", text: "App folder opened. Please confirm permission again." });
  }

  async function chooseFolder(setter: (value: string) => void) {
    const folder = await window.crossAge.chooseFolder();
    if (folder) setter(folder);
  }

  async function chooseModelRoot() {
    const folder = await window.crossAge.chooseFolder();
    if (!folder) return;
    await invoke<AppState>("Saving model folder", "set_model_root", { root: folder, source: "desktop" });
    setNotice({ tone: "ok", text: "Model download folder saved." });
  }

  async function downloadModel(pack: string, root?: string, force = false) {
    setModelDownloadProgress({
      pack,
      label: pack,
      phase: "starting",
      downloadedBytes: 0,
      totalBytes: 0,
      percent: 0,
      message: "Preparing model download",
      root: root || state?.modelSetup?.modelRoot || ""
    });
    try {
      const result = await invoke<CommandResult>("Downloading face model", "download_model", {
        pack,
        root: root || "",
        force,
        source: "desktop"
      });
      setModelDownloadProgress(null);
      const label = result.value && typeof result.value === "object" && "label" in result.value ? `: ${String(result.value.label)}` : "";
      setNoticeMessage("ok", "notice.faceModelReady", { label }, `Face model ready${label}.`);
    } catch {
      setModelDownloadProgress((current) => current ? { ...current, phase: "error", message: "Download failed. Check the connection and try again." } : null);
    }
  }

  async function backfillModelReferences() {
    try {
      const result = await invoke<CommandResult<Record<string, unknown>>>("Backfilling saved photos", "backfill_model_references", {});
      const value = result.value ?? {};
      const added = Number(value.added ?? 0);
      const skipped = Number(value.skipped ?? 0);
      setNotice({ tone: "ok", text: `Backfilled ${formatNumber(added)} saved photo embedding${added === 1 ? "" : "s"}${skipped ? `; skipped ${formatNumber(skipped)}` : ""}.` });
    } catch (error) {
      setErrorNotice(error, "Saved photos could not be backfilled for this model.");
    }
  }

  async function runModelSwitchDryRun(targetPack = settings?.modelPack || state?.config.modelPack || "antelopev2", userVisible = true) {
    try {
      const plan = await invoke<ModelSwitchDryRun>("Checking model switch", "model_switch_dry_run", { targetPack });
      setModelSwitchPlan(plan);
      if (userVisible) {
        setNotice({
          tone: plan.blockers.length ? "warn" : "ok",
          text: plan.summary || "Model switch dry run complete."
        });
      }
      return plan;
    } catch (error) {
      setModelSwitchPlan(null);
      setErrorNotice(error, "Model switch dry run failed.");
      return null;
    }
  }

  async function scanCompatibilityParams(): Promise<Record<string, unknown> | null> {
    const compatibility = state?.modelCompatibility;
    if (!compatibility?.needsBackfill) {
      return {};
    }
    const proceed = await confirmDialog(
      "Saved person photos need a model backfill before this scan. Continue anyway? This can miss matches until saved photos are backfilled."
    );
    if (!proceed) {
      setActiveTab("settings");
      setNotice({ tone: "warn", text: "Scan paused. Backfill saved photos in Settings before scanning with this model." });
      return null;
    }
    return { allowIncompatibleModel: true };
  }

  function setAgeGroupFolder(ageBucket: AgeBucket, folder: string) {
    setAgeGroupFolders((current) => ({ ...current, [ageBucket]: folder }));
  }

  async function chooseAgeGroupFolder(ageBucket: AgeBucket) {
    const folder = await window.crossAge.chooseFolder();
    if (folder) setAgeGroupFolder(ageBucket, folder);
  }

  async function setConsent(value: boolean) {
    if (value) {
      setConsentPrompt({ requestedValue: true, scope: state?.workspace ?? "Current app folder" });
      return;
    }
    if (state?.consentOnFile && !await confirmDialog("Remove permission for this app folder? Adding people, matching scans, and folder watching will pause.")) {
      return;
    }
    await invoke<AppState>("Updating permission", "set_consent", { value, source: "desktop", operator: "desktop user" });
  }

  async function confirmConsent(note: string) {
    if (!consentPrompt) return;
    const scope = consentPrompt.scope;
    setConsentPrompt(null);
    await invoke<AppState>("Updating permission", "set_consent", {
      value: consentPrompt.requestedValue,
      source: "desktop",
      operator: "desktop user",
      note: note || `Confirmed for ${scope}`,
      scope
    });
  }

  async function enroll() {
    if (!personName.trim()) {
      setNotice({ tone: "warn", text: "Person name is required." });
      return;
    }
    if (!enrollFolder.trim()) {
      setNotice({ tone: "warn", text: "Choose a folder with this person's photos." });
      return;
    }
    const result = await invoke<CommandResult>("Adding person photos", "enroll", {
      personName,
      ageBucket,
      folder: enrollFolder
    });
    const added = result.added ?? 0;
    const skipped = skippedSummary(result.errors?.length ?? 0);
    setNoticeMessage("ok", "notice.savedFacePhotosAdded", { count: added, skipped }, `Added ${added} saved face photo${added === 1 ? "" : "s"}.${skipped}`);
  }

  async function enrollAgeGroups() {
    if (!personName.trim()) {
      setNotice({ tone: "warn", text: "Person name is required." });
      return;
    }
    const groups: AgeReferenceGroup[] = referenceAgeBuckets
      .map((bucket) => ({ ageBucket: bucket, folder: ageGroupFolders[bucket].trim() }))
      .filter((group) => group.folder);
    if (!groups.length) {
      setNotice({ tone: "warn", text: "Choose at least one age folder." });
      return;
    }
    const result = await invoke<CommandResult<{ groups: number }>>("Adding age photos", "enroll_age_groups", {
      personName,
      groups
    });
    const added = result.added ?? 0;
    const skipped = skippedSummary(result.errors?.length ?? 0);
    const groupCount = result.value?.groups ?? groups.length;
    setNoticeMessage("ok", "notice.savedFacePhotosAddedAcrossAges", { count: added, groups: groupCount, skipped }, `Added ${added} saved face photo${added === 1 ? "" : "s"} across ${groupCount} age folder${groupCount === 1 ? "" : "s"}.${skipped}`);
  }

  async function scan() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Scan folder is required." });
      return;
    }
    const preflightMatches = lastPreflight?.folder === scanFolder.trim();
    const preflightIsFresh = preflightMatches && Date.now() - lastPreflight.at < 10 * 60 * 1000;
    if (!preflightIsFresh) {
      const proceed = await confirmDialog("This folder has not been checked recently. Continue scanning now?");
      if (!proceed) {
        setNotice({ tone: "warn", text: "Check the folder before scanning." });
        return;
      }
    } else if (!lastPreflight.ready) {
      const proceed = await confirmDialog("The folder check found issues. Continue and skip files that cannot be read?");
      if (!proceed) {
        setNotice({ tone: "warn", text: "Review the folder issues before scanning." });
        return;
      }
    }
    const knownTotal = folderAnalysis && folderAnalysis.folder === scanFolder.trim()
      ? folderAnalysis.imageCount + folderAnalysis.videoCount
      : 0;
    const readiness = folderAnalysis && folderAnalysis.folder === scanFolder.trim() ? folderAnalysis.readiness : null;
    if (readiness?.largeScan && readiness.status !== "pass") {
      if (!readiness.ready) {
        setNotice({ tone: "warn", text: `Large scan is blocked: ${readiness.blockers[0] || readiness.recommendedAction}` });
        return;
      }
      const proceed = await confirmDialog("Large scan readiness has warnings. Continue scanning anyway?");
      if (!proceed) {
        setNotice({ tone: "warn", text: "Resolve readiness warnings before starting the large scan." });
        return;
      }
    }
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return;
    const result = await invoke<CommandResult>("Scanning folder", "scan", {
      folder: scanFolder,
      source: "manual",
      resume: true,
      total: knownTotal,
      ...compatibilityParams
    });
    if (savedScanSources.some((source) => source.path === scanFolder.trim())) {
      persistSavedScanSources(savedScanSources.map((source) => source.path === scanFolder.trim() ? { ...source, lastUsedAt: Date.now() } : source));
    }
    const found = result.added ?? 0;
    const skipped = skippedSummary(result.errors?.length ?? 0);
    const protectedText = protectedSummary(Number(result.metrics?.safeFiltered || 0));
    if (result.metrics?.cancelled) {
      const processed = result.metrics.processed ?? 0;
      setNoticeMessage("warn", "notice.scanCancelled", { processed }, `Scan cancelled after ${processed} file(s). Resume will skip completed files.`);
      return;
    }
    setNoticeMessage("ok", "notice.possibleMatchesFound", { count: found, skipped, protected: protectedText }, `Found ${found} possible match${found === 1 ? "" : "es"}.${skipped}${protectedText}`);
  }

  async function resumeLastScan() {
    const latest = state?.scanJob?.latestScan;
    const folder = typeof latest?.root_path === "string" && latest.root_path
      ? latest.root_path
      : typeof latest?.label === "string"
        ? latest.label
        : scanFolder;
    if (!folder.trim()) {
      setNotice({ tone: "warn", text: "No resumable scan folder was found." });
      return;
    }
    if (!state?.consentOnFile || !state.references.length) {
      setNotice({ tone: "warn", text: "Confirm permission and add a person before resuming." });
      return;
    }
    setScanFolder(folder);
    const total = Number(latest?.total || 0) || undefined;
    const source = typeof latest?.source === "string" && latest.source ? latest.source : "manual";
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return;
    const result = await invoke<CommandResult>("Resuming scan", "scan", {
      folder,
      source,
      resume: true,
      total,
      ...compatibilityParams
    });
    const found = result.added ?? 0;
    const skipped = result.metrics?.manifestSkipped ? ` Skipped ${result.metrics.manifestSkipped} completed file(s).` : "";
    setNoticeMessage("ok", "notice.resumeComplete", { count: found, skipped }, `Resume complete. Found ${found} possible match${found === 1 ? "" : "es"}.${skipped}`);
  }

  async function restartLastScan() {
    const latest = state?.scanJob?.latestScan;
    const folder = typeof latest?.root_path === "string" && latest.root_path
      ? latest.root_path
      : typeof latest?.label === "string"
        ? latest.label
        : scanFolder;
    if (!folder.trim()) {
      setNotice({ tone: "warn", text: "No interrupted scan folder was found." });
      return;
    }
    if (!state?.consentOnFile || !state.references.length) {
      setNotice({ tone: "warn", text: "Confirm permission and add a person before restarting." });
      return;
    }
    const proceed = await confirmDialog(`Restart this scan from the beginning?\n\n${folder}\n\nCompleted-file skipping from the interrupted run will not be used.`);
    if (!proceed) return;
    setScanFolder(folder);
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return;
    const total = Number(latest?.total || 0) || undefined;
    const source = typeof latest?.source === "string" && latest.source ? latest.source : "manual";
    const result = await invoke<CommandResult>("Restarting scan", "scan", {
      folder,
      source,
      resume: false,
      total,
      ...compatibilityParams
    });
    const found = result.added ?? 0;
    const protectedText = protectedSummary(Number(result.metrics?.safeFiltered || 0));
    setDismissedRecoveryRunId(String(latest?.run_id || latest?.runId || ""));
    setNoticeMessage("ok", "notice.possibleMatchesFound", { count: found, skipped: "", protected: protectedText }, `Restart complete. Found ${found} possible match${found === 1 ? "" : "es"}.${protectedText}`);
  }

  async function scanCameraFrame(dataUrl: string): Promise<CameraScanResult> {
    const startedAt = performance.now();
    setBusy("Saving camera photo");
    setNotice(null);
    let saved: CameraSaveResult;
    try {
      saved = await window.crossAge.saveCameraFrame(dataUrl);
    } catch (error) {
      setErrorNotice(error, "Could not save the camera photo.");
      throw error;
    } finally {
      recordLatency("Saving camera photo", "camera:save-frame", startedAt);
    }

    setScanFolder(saved.folder);
    const hasPermission = Boolean(state?.consentOnFile);
    const hasReferences = Boolean(state?.references.length);
    if (!hasPermission || !hasReferences) {
      setBusy(null);
      const nextStep = !hasPermission && !hasReferences
        ? "Add a person and confirm permission when you want to match it."
        : !hasReferences
          ? "Add a person when you want to match it."
          : "Confirm permission when you want to match it.";
      setNoticeMessage("ok", "notice.cameraSavedNext", { nextStep }, `Camera photo saved. ${nextStep}`);
      return { ...saved, added: 0, errors: [], matched: false };
    }

    setBusy(null);
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return { ...saved, added: 0, errors: [], matched: false };
    const result = await invoke<CommandResult>("Scanning camera photo", "scan", { folder: saved.folder, source: "camera", ...compatibilityParams });
    const found = result.added ?? 0;
    const skipped = skippedSummary(result.errors?.length ?? 0);
    const protectedText = protectedSummary(Number(result.metrics?.safeFiltered || 0));
    setNoticeMessage("ok", "notice.cameraSavedMatches", { count: found, skipped, protected: protectedText }, `Camera photo saved. Found ${found} possible match${found === 1 ? "" : "es"}.${skipped}${protectedText}`);
    return { ...saved, added: result.added ?? 0, errors: result.errors ?? [], matched: true };
  }

  async function analyzeScanFolder() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Scan folder is required." });
      return;
    }
    const folder = scanFolder.trim();
    const requestId = folderAnalysisRequestId.current + 1;
    folderAnalysisRequestId.current = requestId;
    const analysis = await invoke<FolderAnalysis>("Checking folder", "analyze_folder", { folder });
    if (requestId !== folderAnalysisRequestId.current || scanFolder.trim() !== folder) {
      return;
    }
    setFolderAnalysis(analysis);
    const mediaCount = analysis.imageCount + analysis.videoCount;
    const issueCount = folderAnalysisIssueCount(analysis);
    setLastPreflight({
      folder,
      at: Date.now(),
      ready: isFolderAnalysisReady(analysis)
    });
    const issues = issueCount ? ` ${issueCount} issue${issueCount === 1 ? "" : "s"} need attention.` : "";
    setNoticeMessage(
      mediaCount && issueCount === 0 ? "ok" : "warn",
      "notice.folderCheckSummary",
      { media: mediaCount, images: analysis.imageCount, videos: analysis.videoCount, issues },
      `Folder check found ${mediaCount} photo or video file${mediaCount === 1 ? "" : "s"}: ${analysis.imageCount} image${analysis.imageCount === 1 ? "" : "s"}, ${analysis.videoCount} video${analysis.videoCount === 1 ? "" : "s"}.${issues}`
    );
  }

  async function startWatchFolder() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Choose a scan folder before watching." });
      return;
    }
    if (!state?.consentOnFile) {
      setNotice({ tone: "warn", text: "Confirm permission before watching a folder." });
      return;
    }
    if (!state?.references.length) {
      setNotice({ tone: "warn", text: "Add at least one person before watching a folder." });
      return;
    }
    if (workspaceLocked) {
      setNotice({ tone: "warn", text: "Unlock the workspace before watching a folder." });
      return;
    }
    try {
      const status = await window.crossAge.startFolderWatch(scanFolder);
      applyWatchStatus(status);
      setNotice({ tone: "ok", text: "Vintrace will watch this folder for new files." });
    } catch (error) {
      setErrorNotice(error, "Folder watching could not start.");
    }
  }

  async function startWatchForFolder(folder: string) {
    if (!state?.consentOnFile || !state.references.length) {
      setScanFolder(folder);
      setActiveTab("scan");
      setNotice({ tone: "warn", text: "Add a person and confirm permission before watching this folder." });
      return;
    }
    if (workspaceLocked) {
      setScanFolder(folder);
      setActiveTab("scan");
      setNotice({ tone: "warn", text: "Unlock the workspace before watching this folder." });
      return;
    }
    setScanFolder(folder);
    setActiveTab("scan");
    try {
      const status = await window.crossAge.startFolderWatch(folder);
      applyWatchStatus(status);
      setNotice({ tone: "ok", text: "Vintrace will watch this folder for new files." });
    } catch (error) {
      setErrorNotice(error, "Folder watching could not start.");
    }
  }

  async function stopWatchFolder() {
    try {
      const status = await window.crossAge.stopFolderWatch();
      applyWatchStatus(status);
      setNotice({ tone: "ok", text: "Folder watching stopped." });
    } catch (error) {
      setErrorNotice(error, "Folder watching could not stop.");
    }
  }

  async function cancelActiveScan() {
    try {
      const result = await window.crossAge.cancelScan();
      setLocalScanMarkers((current) => ({ cancelRequested: Boolean(result.cancelled), paused: Boolean(current?.paused) }));
      setNotice(result.cancelled ? { tone: "warn", text: "Scan cancellation requested. The current file will finish, then the scan will stop." } : { tone: "error", text: "Could not request scan cancellation." });
    } catch (error) {
      setErrorNotice(error, "Could not request scan cancellation.");
    }
  }

  async function pauseActiveScan() {
    try {
      const result = await window.crossAge.pauseScan();
      setLocalScanMarkers((current) => ({ cancelRequested: Boolean(current?.cancelRequested), paused: Boolean(result.paused) }));
      setNotice(result.paused ? { tone: "warn", text: "Scan paused. Resume when you are ready." } : { tone: "error", text: "Could not pause the scan." });
    } catch (error) {
      setErrorNotice(error, "Could not pause the scan.");
    }
  }

  async function resumeActiveScan() {
    try {
      const result = await window.crossAge.resumeScan();
      setLocalScanMarkers((current) => ({ cancelRequested: Boolean(current?.cancelRequested), paused: Boolean(result.paused) }));
      setNotice(!result.paused ? { tone: "ok", text: "Scan resumed." } : { tone: "error", text: "Could not resume the scan." });
    } catch (error) {
      setErrorNotice(error, "Could not resume the scan.");
    }
  }

  async function revealWorkspace() {
    if (!state) return;
    const revealed = await window.crossAge.revealPath(state.workspace);
    setNotice(revealed ? { tone: "ok", text: "App folder shown in Finder." } : { tone: "warn", text: "App folder path is not available." });
  }

  async function openWorkspaceFolder() {
    if (!state) return;
    const result = await window.crossAge.openPath(state.workspace);
    setNotice(result.ok ? { tone: "ok", text: "App folder opened." } : { tone: "error", text: result.error || "App folder could not be opened." });
  }

  async function revealCandidatePath(candidatePath?: string | null) {
    if (!candidatePath) {
      setNotice({ tone: "warn", text: "This match file path is not available." });
      return;
    }
    const revealed = await window.crossAge.revealPath(candidatePath);
    setNotice(revealed ? { tone: "ok", text: "Match file shown." } : { tone: "warn", text: "Match file is not available." });
  }

  async function openCandidatePath(candidatePath?: string | null) {
    if (!candidatePath) {
      setNotice({ tone: "warn", text: "This match file path is not available." });
      return;
    }
    const result = await window.crossAge.openPath(candidatePath);
    setNotice(result.ok ? { tone: "ok", text: "Match file opened." } : { tone: "error", text: result.error || "Match file could not be opened." });
  }

  async function setLaunchAtLogin(value: boolean) {
    try {
      const next = await window.crossAge.setLaunchAtLogin(value);
      setSystemIntegration(next);
      setNotice({ tone: "ok", text: value ? "Start at login enabled." : "Start at login disabled." });
    } catch (error) {
      setErrorNotice(error, "Could not update the startup setting.");
    }
  }

  async function handleAppCommand(command: AppCommand) {
    if (command.type === "navigate") {
      setActiveTab(command.tab);
      return;
    }
    if (command.type === "open-workspace") {
      await chooseWorkspace();
      return;
    }
    if (command.type === "refresh") {
      await invoke<AppState>("Refreshing", "get_state");
      return;
    }
    if (command.type === "scan") {
      setActiveTab("scan");
      if (scanDisabled) {
        setNotice({ tone: "warn", text: "Choose a folder, add a person, and confirm permission before scanning." });
        return;
      }
      await scan();
      return;
    }
    if (command.type === "start-watch") {
      setActiveTab("scan");
      await startWatchFolder();
      return;
    }
    if (command.type === "stop-watch") {
      await stopWatchFolder();
      return;
    }
    if (command.type === "reveal-workspace") {
      await revealWorkspace();
      return;
    }
    if (command.type === "open-workspace-folder") {
      await openWorkspaceFolder();
    }
  }

  async function handleExternalOpen(payload: ExternalOpenPayload) {
    if (payload.type === "workspace") {
      if (payload.source === "protocol" && !await confirmDialog(`Open this app folder from an external link?\n\n${payload.path}`)) {
        return;
      }
      await window.crossAge.stopFolderWatch();
      settingsDirtyRef.current = false;
      await invoke<AppState>("Opening app folder", "set_workspace", { path: payload.path });
      await refreshWorkspaceLockStatus();
      setNotice({ tone: "ok", text: "App folder opened from the system." });
      return;
    }
    if (payload.type === "scan-folder") {
      setScanFolder(payload.path);
      setActiveTab("scan");
      setNotice({ tone: "ok", text: "Folder received from the system." });
      return;
    }
    if (payload.type === "watch-folder") {
      if (payload.source === "protocol" && !await confirmDialog(`Watch this folder from an external link?\n\n${payload.path}`)) {
        return;
      }
      await startWatchForFolder(payload.path);
      return;
    }
    if (payload.type === "scan-files") {
      setActiveTab("scan");
      if (!state?.consentOnFile || !state.references.length) {
        setPendingExternalIntent(payload);
        setNotice({ tone: "warn", text: "Files received. Add a person and confirm permission before scanning." });
        return;
      }
      const compatibilityParams = await scanCompatibilityParams();
      if (!compatibilityParams) {
        setPendingExternalIntent(payload);
        return;
      }
      const result = await invoke<CommandResult>("Scanning opened files", "scan_paths", { paths: payload.paths, source: "system", ...compatibilityParams });
      const protectedText = protectedSummary(Number(result.metrics?.safeFiltered || 0));
      const found = result.added ?? 0;
      setNoticeMessage("ok", "notice.possibleMatchesFound", { count: found, skipped: "", protected: protectedText }, `Found ${found} possible match${found === 1 ? "" : "es"}.${protectedText}`);
    }
  }

  async function resumePendingExternalIntent() {
    if (!pendingExternalIntent) return;
    if (!state?.consentOnFile || !state.references.length) {
      setActiveTab(state?.references.length ? "scan" : "enroll");
      setNotice({ tone: "warn", text: "Confirm permission and add a person before scanning received files." });
      return;
    }
    const payload = pendingExternalIntent;
    setPendingExternalIntent(null);
    setActiveTab("scan");
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) {
      setPendingExternalIntent(payload);
      return;
    }
    const result = await invoke<CommandResult>("Scanning received files", "scan_paths", { paths: payload.paths, source: "system", ...compatibilityParams });
    const protectedText = protectedSummary(Number(result.metrics?.safeFiltered || 0));
    const found = result.added ?? 0;
    setNoticeMessage("ok", "notice.possibleMatchesFound", { count: found, skipped: " from received files.", protected: protectedText }, `Found ${found} possible match${found === 1 ? "" : "es"} from received files.${protectedText}`);
  }

  function startReferenceFix(targetPersonName: string) {
    const target = safeText(targetPersonName).trim();
    if (target) {
      setPersonName(target);
    }
    setAgeBucket("unknown");
    setEnrollFolder("");
    setAgeGroupFolders(emptyAgeFolders());
    setActiveTab("enroll");
    setNotice({
      tone: "ok",
      text: target ? `Add clearer, angled, side, or age-range photos for ${target}.` : "Add clearer saved-person photos."
    });
  }

  async function review(status: CandidateStatus, currentOverride?: ReviewCandidate | null, quiet = false) {
    const current = currentOverride ?? selectedCandidate;
    // H4: target the explicit candidate (not the live selection) so the caller
    // can advance the selection optimistically before this write resolves.
    const candidateId = current?.candidateId ?? selectedCandidateId;
    if (!candidateId) return;
    await invoke<AppState>("Saving review", "set_status", { candidateId, status }, { quiet });
    if (current && current.status !== status) {
      setReviewUndo({
        candidateId: current.candidateId,
        previousStatus: current.status,
        nextStatus: status,
        label: `${current.personName} • ${basename(current.sourcePath)}`
      });
    }
  }

  async function undoLastReview() {
    if (!reviewUndo) return;
    const undo = reviewUndo;
    setReviewUndo(null);
    setSelectedCandidateId(undo.candidateId);
    await invoke<AppState>("Undoing review", "set_status", {
      candidateId: undo.candidateId,
      status: undo.previousStatus
    });
    setNotice({ tone: "ok", text: `Restored ${undo.label} to ${reviewStatusLabel(undo.previousStatus)}.` });
  }

  async function bulkReview(candidateIds: string[], status: CandidateStatus) {
    if (!candidateIds.length) {
      setNotice({ tone: "warn", text: "Select at least one possible match." });
      return;
    }
    const result = await invoke<CommandResult>("Saving bulk review", "bulk_set_status", { candidateIds, status });
    const updated = result.updated ?? candidateIds.length;
    setNoticeMessage("ok", "notice.updatedPossibleMatches", { count: updated }, `Updated ${updated} possible match${updated === 1 ? "" : "es"}.`);
  }

  async function exportSelectedCandidates(candidateIds: string[]) {
    if (!candidateIds.length) {
      setNotice({ tone: "warn", text: "Select possible matches before exporting." });
      return;
    }
    const result = await invoke<CommandResult<ExportReportValue>>("Exporting selected matches", "export_candidates", { candidateIds });
    const exported = result.value?.counts.candidates ?? candidateIds.length;
    setNoticeMessage("ok", "notice.exportedSelectedMatches", { count: exported }, `Exported ${exported} selected possible match${exported === 1 ? "" : "es"}.`);
    if (result.value?.jsonPath) {
      await window.crossAge.revealPath(result.value.jsonPath);
    }
  }

  async function previewCandidateMediaAction(candidateIds: string[], action: CandidateMediaAction, folder?: string, itemOffset = 0, itemLimit = 40) {
    const ids = [...new Set(candidateIds.filter(Boolean))];
    if (!ids.length) {
      setNotice({ tone: "warn", text: "Select possible matches first." });
      return null;
    }
    return invoke<CandidateMediaPreviewValue>("Checking source files", "preview_candidate_media_action", { candidateIds: ids, action, folder: folder || "", itemOffset, itemLimit });
  }

  async function manageCandidateMedia(candidateIds: string[], action: CandidateMediaAction, folder?: string) {
    const ids = [...new Set(candidateIds.filter(Boolean))];
    if (!ids.length) {
      setNotice({ tone: "warn", text: "Select possible matches first." });
      return null;
    }
    setMediaActionProgress(null);
    const labels: Record<CandidateMediaAction, string> = {
      copy: "Copying source media",
      move: "Moving source media",
      trash: "Moving source media to app trash"
    };
    const result = await invoke<CommandResult<CandidateMediaActionValue>>(labels[action], "manage_candidate_media", { candidateIds: ids, action, folder: folder || "" });
    const counts = result.value?.counts;
    const changed = (counts?.copied ?? 0) + (counts?.moved ?? 0) + (counts?.trashed ?? 0);
    const skipped = counts?.skipped ?? 0;
    const verb = action === "copy" ? "Copied" : action === "move" ? "Moved" : "Moved to app trash";
    setNotice({
      tone: skipped ? "warn" : "ok",
      text: `${verb} ${changed} source file${changed === 1 ? "" : "s"}${skipped ? `; skipped ${skipped}` : ""}.`
    });
    if (result.value?.destinationPath) {
      await window.crossAge.revealPath(result.value.destinationPath);
    }
    return result.value ?? null;
  }

  async function loadMediaActionHistory() {
    return invoke<MediaActionHistoryValue>("Loading file action history", "media_action_history", { limit: 20 });
  }

  async function restoreMediaAction(manifestPath: string) {
    const result = await invoke<CommandResult<MediaActionRestoreValue>>("Restoring files", "restore_media_action", { manifestPath });
    const counts = result.value?.counts;
    setNotice({
      tone: counts?.restored ? "ok" : "warn",
      text: counts ? `Restored ${counts.restored} file${counts.restored === 1 ? "" : "s"}${counts.existing ? `; ${counts.existing} already existed` : ""}${counts.missing ? `; ${counts.missing} missing` : ""}.` : "Restore finished."
    });
    return result.value ?? null;
  }

  async function retryMediaAction(manifestPath: string, folder?: string) {
    const result = await invoke<CommandResult<CandidateMediaActionValue>>("Retrying skipped files", "retry_media_action", { manifestPath, folder: folder || "" });
    const counts = result.value?.counts;
    const changed = (counts?.copied ?? 0) + (counts?.moved ?? 0) + (counts?.trashed ?? 0);
    setNotice({
      tone: counts?.skipped ? "warn" : "ok",
      text: counts ? `Retried file action: ${changed} changed, ${counts.skipped} skipped.` : "Retry finished."
    });
    return result.value ?? null;
  }

  async function undoMediaAction(manifestPath?: string) {
    const result = await invoke<CommandResult<MediaActionUndoValue>>("Undoing file action", "undo_media_action", { manifestPath: manifestPath || "" });
    const counts = result.value?.counts;
    setNotice({
      tone: counts && (counts.restored || counts.removedCopies) ? "ok" : "warn",
      text: counts ? `Undo complete: ${counts.restored} restored, ${counts.removedCopies} copied file${counts.removedCopies === 1 ? "" : "s"} moved aside, ${counts.skipped + counts.missing + counts.existing} skipped.` : "Undo finished."
    });
    return result.value ?? null;
  }

  async function loadMediaTrashReport() {
    const report = await invoke<MediaTrashReportValue>("Checking app trash", "media_trash_report");
    setMediaTrashReport(report);
    return report;
  }

  async function cleanupMediaTrash(days: number, dryRun = false) {
    if (!dryRun && !await confirmDialog(`Permanently remove files in Vintrace app trash older than ${days} days? Restoring those trash entries will no longer be possible.`)) {
      return null;
    }
    const result = await invoke<CommandResult<MediaTrashCleanupValue>>(dryRun ? "Previewing app trash cleanup" : "Cleaning app trash", "cleanup_media_trash", { days, dryRun });
    if (result.value) {
      setMediaTrashCleanup(result.value);
      await loadMediaTrashReport();
      const files = result.value.dryRun ? result.value.previewFiles : result.value.deletedFiles;
      const bytes = result.value.dryRun ? result.value.previewBytes : result.value.deletedBytes;
      setNotice({ tone: "ok", text: `${result.value.dryRun ? "Cleanup preview" : "App trash cleaned"}: ${files} file${files === 1 ? "" : "s"}, ${formatBytes(bytes)}.` });
    }
    return result.value ?? null;
  }

  async function cancelMediaAction() {
    const result = await window.crossAge.cancelMediaAction();
    setNotice(result.cancelled ? { tone: "warn", text: "File action cancellation requested. The current file will finish first." } : { tone: "error", text: "Could not cancel the file action." });
    return result;
  }

  async function chooseDestinationFolder() {
    return window.crossAge.chooseFolder();
  }

  async function saveCandidateNote(candidateId: string, note: string) {
    await invoke<AppState>("Saving note", "set_candidate_note", { candidateId, note });
    setNotice({ tone: "ok", text: "Review note saved." });
  }

  async function blockFalseMatch(candidateId: string) {
    if (!await confirmDialog("Stop suggesting this image for this person again, even if another saved photo triggers it? The current row will be rejected.")) return;
    const result = await invoke<CommandResult>("Saving feedback", "block_false_match", { candidateId });
    const value = result.value as { blocked?: number } | undefined;
    setNotice({ tone: "ok", text: value?.blocked ? "This image/person false match will be suppressed in future scans." : "Feedback saved." });
  }

  async function reassignCandidatePerson(candidateId: string, personName: string) {
    const target = personName.trim();
    if (!target) {
      setNotice({ tone: "warn", text: "Enter the person this match belongs to." });
      return;
    }
    const result = await invoke<CommandResult>("Moving match", "reassign_candidate_person", {
      candidateId,
      personName: target,
      clearReference: true
    });
    if (result.state) applyState(result.state);
    setNotice({ tone: "ok", text: `Moved match to ${target}.` });
  }

  async function deleteReference() {
    if (!selectedRefId) return;
    const selected = state?.references.find((ref) => ref.refId === selectedRefId);
    if (!await confirmDialogMessage("dialog.deleteSavedPhoto", { person: selected?.personName ?? "" }, `Delete this saved photo for ${selected?.personName ?? ""}?`)) return;
    await invoke<AppState>("Deleting saved photo", "delete_reference", { refId: selectedRefId });
  }

  async function clearQueue() {
    if (!state?.candidates.length) return;
    if (!await confirmDialogMessage("dialog.clearMatches", {}, "Clear all possible matches from the review list?")) return;
    await invoke<AppState>("Clearing matches", "clear_queue");
  }

  async function clearReferences() {
    if (!state?.references.length) return;
    if (!await confirmDialogMessage("dialog.clearSavedPhotos", {}, "Clear all saved face photos? Activity history is preserved.")) return;
    const result = await invoke<CommandResult>("Clearing saved photos", "clear_references");
    const cleared = result.cleared ?? 0;
    setNoticeMessage("ok", "notice.clearedSavedPhotos", { count: cleared }, `Cleared ${cleared} saved face photo${cleared === 1 ? "" : "s"}.`);
  }

  async function deletePerson(personName: string) {
    if (!personName.trim()) {
      setNotice({ tone: "warn", text: "Choose a person to delete." });
      return;
    }
    if (!await confirmDialogMessage("dialog.deletePerson", { person: personName }, `Delete saved photos and possible matches for ${personName}? Activity history is preserved.`)) return;
    const result = await invoke<CommandResult>("Deleting person", "delete_person", { personName });
    const deleted = result.deleted ?? { references: 0, candidates: 0 };
    setNoticeMessage("ok", "notice.deletedPersonData", { references: deleted.references, candidates: deleted.candidates }, `Deleted ${deleted.references} saved photo${deleted.references === 1 ? "" : "s"} and ${deleted.candidates} possible match${deleted.candidates === 1 ? "" : "es"}.`);
  }

  async function purgeReviewedCandidates() {
    if (!await confirmDialogMessage("dialog.purgeReviewed", {}, "Remove reviewed possible matches from the active list? Activity history is preserved.")) return;
    const result = await invoke<CommandResult>("Removing reviewed matches", "purge_candidates", { statuses: ["accepted", "rejected", "uncertain"] });
    const purged = result.purged ?? 0;
    setNoticeMessage("ok", "notice.removedReviewedMatches", { count: purged }, `Removed ${purged} reviewed possible match${purged === 1 ? "" : "es"}.`);
  }

  async function runWorkspaceHealth() {
    const health = await invoke<WorkspaceHealth>("Checking app folder", "workspace_health");
    setWorkspaceHealth(health);
    setNotice({ tone: "ok", text: "App folder check complete." });
  }

  async function repairWorkspace() {
    const preview = await invoke<CommandResult<WorkspaceRepairResult>>("Checking repair", "repair_workspace", { dryRun: true });
    if (preview.value) {
      setWorkspaceRepairResult(preview.value);
      const total = preview.value.removedReferences + preview.value.removedCandidates;
      if (!total) {
        setWorkspaceHealth(preview.value.before);
        setNotice({ tone: "ok", text: "No broken saved photos or match links were found." });
        return;
      }
      const rootWarning = preview.value.unavailableRoots?.length
        ? `\n\nSeveral missing links share this unavailable location:\n${preview.value.unavailableRoots.slice(0, 3).join("\n")}\n\nReconnect or relink the drive first unless you intentionally want to remove these saved links.`
        : "";
      const repairPrompt = `Remove ${preview.value.removedReferences} missing saved photo link(s) and ${preview.value.removedCandidates} missing match row(s)? Original photos are not touched.${rootWarning}`;
      const proceed = await confirmDialogMessage(
        "dialog.repairMissingLinks",
        { references: preview.value.removedReferences, candidates: preview.value.removedCandidates, rootWarning },
        repairPrompt
      );
      if (!proceed) {
        setNotice({ tone: "warn", text: "Repair cancelled. No app data changed." });
        return;
      }
    }
    const result = await invoke<CommandResult<WorkspaceRepairResult>>("Repairing app folder", "repair_workspace", { dryRun: false });
    if (result.value?.destructiveBlocked) {
      const roots = result.value.unavailableRoots?.slice(0, 3).join("\n") || "Unavailable photo location";
      const forcePrompt = `Repair was blocked because several saved links look like a disconnected or moved drive:\n\n${roots}\n\nChoose Cancel, reconnect the drive, then use Relink. Choose OK only if you want to remove these saved links from the app.`;
      const force = await confirmDialogMessage("dialog.forceRepairMissingDrive", { roots }, forcePrompt);
      if (!force) {
        setWorkspaceRepairResult(result.value);
        setWorkspaceHealth(result.value.before);
        setNotice({ tone: "warn", text: "Repair blocked. Reconnect or relink the missing drive before removing saved links." });
        return;
      }
      const forced = await invoke<CommandResult<WorkspaceRepairResult>>("Repairing app folder", "repair_workspace", { dryRun: false, force: true });
      if (forced.value) {
        result.value = forced.value;
        result.state = forced.state;
      }
    }
    if (result.value) {
      setWorkspaceRepairResult(result.value);
      setWorkspaceHealth(result.value.after);
      setNoticeMessage(
        "ok",
        "notice.workspaceRepaired",
        { references: result.value.removedReferences, candidates: result.value.removedCandidates },
        `Repaired app folder: removed ${result.value.removedReferences} saved photo link${result.value.removedReferences === 1 ? "" : "s"} and ${result.value.removedCandidates} match row${result.value.removedCandidates === 1 ? "" : "s"}.`
      );
    }
    if (result.state) applyState(result.state);
  }

  async function repairDatabaseIntegrity() {
    const preview = await invoke<CommandResult<DatabaseRepairResult>>("Checking database", "repair_database_integrity", { confirm: false });
    if (!preview.value) {
      setNotice({ tone: "error", text: "Database repair preview did not return details." });
      return;
    }
    setDatabaseRepairResult(preview.value);
    if (preview.value.before.ok) {
      if (!await confirmDialog("Database integrity is already healthy. Optimize the SQLite index now? A snapshot will be saved first.")) {
        setNotice({ tone: "ok", text: "Database integrity passed. No repair needed." });
        return;
      }
    } else if (!await confirmDialog("Database integrity needs repair. Vintrace will snapshot the current SQLite files, rebuild the local index from saved app state, and keep original photos untouched. Continue?")) {
      setNotice({ tone: "warn", text: "Database repair cancelled. No app data changed." });
      return;
    }
    const result = await invoke<CommandResult<DatabaseRepairResult>>("Repairing database", "repair_database_integrity", { confirm: true });
    if (result.value) {
      setDatabaseRepairResult(result.value);
      if (workspaceHealth) {
        setWorkspaceHealth({ ...workspaceHealth, databaseIntegrity: result.value.after });
      }
      setNotice({
        tone: result.value.after.ok ? "ok" : "warn",
        text: result.value.after.ok
          ? result.value.rebuilt
            ? "Database index rebuilt from saved app state."
            : "Database index optimized."
          : "Database repair finished but integrity still needs attention. Export diagnostics."
      });
    }
    if (result.state) applyState(result.state);
    await runWorkspaceHealth();
  }

  async function relinkWorkspacePaths() {
    const oldRoot = promptUi("Old folder path to replace", "");
    if (!oldRoot?.trim()) {
      setNotice({ tone: "warn", text: "Enter the old folder path first." });
      return;
    }
    const newRoot = await window.crossAge.chooseFolder();
    if (!newRoot) {
      setNotice({ tone: "warn", text: "Relink cancelled. No new folder selected." });
      return;
    }
    const preview = await invoke<CommandResult<WorkspaceRelinkResult>>("Checking moved folder", "relink_workspace_paths", {
      oldRoot,
      newRoot,
      dryRun: true
    });
    if (!preview.value) {
      setNotice({ tone: "error", text: "Relink preview did not return details." });
      return;
    }
    setWorkspaceRelinkResult(preview.value);
    if (!preview.value.relinkedFields) {
      setNotice({ tone: "warn", text: "No saved paths matched that old folder." });
      return;
    }
    const partialWarning = preview.value.missingTargets.length
      ? `\n\n${preview.value.missingTargets.length} saved path${preview.value.missingTargets.length === 1 ? "" : "s"} could not be found in the selected folder. Cancel and choose a better folder for an all-at-once relink, or OK to update only the paths that were found.`
      : "";
    const relinkPrompt = `Update ${preview.value.relinkedFields} saved path${preview.value.relinkedFields === 1 ? "" : "s"} to the selected folder? Original photos are not moved or copied.${partialWarning}`;
    const proceed = await confirmDialogMessage(
      "dialog.relinkSavedPaths",
      { count: preview.value.relinkedFields, partialWarning },
      relinkPrompt
    );
    if (!proceed) return;
    const result = await invoke<CommandResult<WorkspaceRelinkResult>>("Relinking moved folder", "relink_workspace_paths", {
      oldRoot,
      newRoot,
      dryRun: false,
      forcePartial: preview.value.missingTargets.length > 0
    });
    if (result.value) {
      setWorkspaceRelinkResult(result.value);
      if (result.value.partialBlocked) {
        setNotice({ tone: "warn", text: "Relink blocked because some target files are missing. Choose the moved folder that contains all files, or confirm a partial relink." });
        return;
      }
      setNoticeMessage("ok", "notice.pathsRelinked", { count: result.value.relinkedFields }, `Relinked ${result.value.relinkedFields} saved path${result.value.relinkedFields === 1 ? "" : "s"}.`);
    }
    if (result.state) applyState(result.state);
    await runWorkspaceHealth();
  }

  async function purgeDuplicateCandidates() {
    const duplicateCount = workspaceHealth?.duplicateCandidateCount ?? 0;
    if (!duplicateCount) {
      setNotice({ tone: "warn", text: "No duplicate match rows found." });
      return;
    }
    if (!await confirmDialogMessage("dialog.removeDuplicateRows", { count: duplicateCount }, `Remove ${duplicateCount} duplicate match row(s)? The strongest row in each group will be kept.`)) return;
    const result = await invoke<CommandResult<WorkspaceHealth>>("Removing duplicate matches", "purge_duplicate_candidates");
    if (result.value) setWorkspaceHealth(result.value);
    setNoticeMessage("ok", "notice.duplicateRowsRemoved", { count: result.purged ?? 0 }, `Removed ${result.purged ?? 0} duplicate match row${(result.purged ?? 0) === 1 ? "" : "s"}.`);
  }

  async function optimizeWorkspace() {
    if (!await confirmDialogMessage("dialog.optimizeWorkspace", {}, "Optimize generated app-folder data? Original photos and videos will not be touched.")) return;
    const result = await invoke<CommandResult<WorkspaceOptimizeResult>>("Optimizing app folder", "optimize_workspace");
    if (result.value) {
      setWorkspaceOptimizeResult(result.value);
      setNoticeMessage("ok", "notice.workspaceOptimized", { bytes: formatBytes(result.value.totalBytesReclaimed) }, `Optimized app folder and reclaimed ${formatBytes(result.value.totalBytesReclaimed)}.`);
    }
  }

  async function enforceStorageBudget() {
    try {
      await saveSettingsDraftIfDirty("Saving storage limit");
    } catch {
      return;
    }
    const result = await invoke<CommandResult<StorageBudgetEnforceResult>>("Cleaning generated cache", "enforce_storage_budget");
    if (result.value) {
      setWorkspaceHealth(result.value.after);
      if (result.value.optimized) {
        setWorkspaceOptimizeResult(result.value.optimized);
      }
      const over = result.value.after.storageOverBudgetBytes ?? 0;
      setNotice({
        tone: result.value.withinBudget ? "ok" : "warn",
        text: result.value.withinBudget
          ? "Storage limit is now satisfied."
          : `Generated cache was cleaned, but the app folder is still ${formatBytes(over)} over the limit.`
      });
    }
  }

  async function purgeOldCandidates(days: number) {
    const safeDays = Math.max(1, Math.min(3650, Math.round(days || 90)));
    if (!await confirmDialog(`Remove reviewed matches older than ${safeDays} day(s)? Activity history is preserved.`)) return;
    const result = await invoke<CommandResult>("Removing old reviewed matches", "purge_old_candidates", {
      days: safeDays,
      statuses: ["accepted", "rejected", "uncertain"]
    });
    setNoticeMessage("ok", "notice.oldReviewedRemoved", { count: result.purged ?? 0 }, `Removed ${result.purged ?? 0} old reviewed possible match${(result.purged ?? 0) === 1 ? "" : "es"}.`);
  }

  async function exportReport() {
    const result = await invoke<CommandResult<ExportReportValue>>("Exporting report", "export_report");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Export did not return a report path." });
      return;
    }
    setNoticeMessage("ok", "notice.reportExported", { count: value.counts.candidates }, `Exported report for ${value.counts.candidates} possible match${value.counts.candidates === 1 ? "" : "es"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function exportWorkspaceBackup() {
    const result = await invoke<CommandResult<WorkspaceBackupValue>>("Creating backup", "export_workspace_backup", { includeGenerated: true });
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Backup did not return a zip path." });
      return;
    }
    setBackupVerification(null);
    setBackupRestoreResult(null);
    setNoticeMessage("ok", "notice.backupCreated", { name: basename(value.zipPath), bytes: formatBytes(value.bytes) }, `Backup created: ${basename(value.zipPath)} (${formatBytes(value.bytes)}).`);
    void window.crossAge.revealPath(value.zipPath);
  }

  async function verifyLatestWorkspaceBackup() {
    const result = await invoke<CommandResult<WorkspaceBackupVerification>>("Verifying backup", "verify_workspace_backup");
    if (result.value) {
      setBackupVerification(result.value);
      setNotice({
        tone: result.value.ok ? "ok" : "warn",
        text: result.value.ok
          ? `Backup verified: ${basename(result.value.zipPath)}.`
          : result.value.error || "Backup verification found issues."
      });
    }
  }

  async function restoreLatestWorkspaceBackup() {
    const folder = await window.crossAge.chooseFolder();
    if (!folder) return;
    if (!await confirmDialog("Restore the latest verified app-folder backup into this empty folder? Existing files are not allowed.")) return;
    const result = await invoke<CommandResult<WorkspaceBackupRestoreValue>>("Restoring backup", "restore_workspace_backup", { target: folder });
    if (result.value) {
      setBackupRestoreResult(result.value);
      setNotice({
        tone: "ok",
        text: `Backup restored to ${basename(result.value.targetRoot) || result.value.targetRoot}.`
      });
      void window.crossAge.revealPath(result.value.targetRoot);
    }
  }

  async function pruneWorkspaceBackups() {
    if (!await confirmDialog("Keep the 5 newest app-folder backups and remove older backup ZIPs?")) return;
    const result = await invoke<CommandResult<WorkspaceBackupPruneValue>>("Cleaning backups", "prune_workspace_backups", { keep: 5 });
    if (result.value) {
      setBackupPruneResult(result.value);
      setNoticeMessage("ok", "notice.oldBackupsRemoved", { count: result.value.deleted, bytes: formatBytes(result.value.deletedBytes) }, `Removed ${result.value.deleted} old backup${result.value.deleted === 1 ? "" : "s"} and reclaimed ${formatBytes(result.value.deletedBytes)}.`);
    }
  }

  async function exportScanHistory() {
    const result = await invoke<CommandResult<ScanHistoryExportValue>>("Exporting scan history", "export_scan_history");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Scan history export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.scanRunsExported", { count: value.counts.runs }, `Exported ${value.counts.runs} scan run${value.counts.runs === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function pruneScanManifests() {
    if (!await confirmDialog("Keep the 20 newest resumable scan manifests and remove older scan-manifest rows? Review results and original photos are not touched.")) return;
    const result = await invoke<CommandResult<ScanManifestPruneValue>>("Cleaning scan manifests", "prune_scan_manifests", { keepRuns: 20 });
    if (result.value) {
      setScanManifestPruneResult(result.value);
      setNoticeMessage("ok", "notice.oldScanRunsRemoved", { runs: result.value.runsDeleted, rows: formatNumber(result.value.filesDeleted) }, `Removed ${result.value.runsDeleted} old scan run${result.value.runsDeleted === 1 ? "" : "s"} and ${formatNumber(result.value.filesDeleted)} manifest row${result.value.filesDeleted === 1 ? "" : "s"}.`);
    }
    if (result.state) applyState(result.state);
  }

  async function exportWorkspaceInventory() {
    const result = await invoke<CommandResult<WorkspaceInventoryExportValue>>("Exporting inventory", "export_workspace_inventory");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Inventory export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.inventoryExported", { count: value.counts.sourceFolders }, `Exported inventory for ${value.counts.sourceFolders} source folder${value.counts.sourceFolders === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function exportAuditLog() {
    const result = await invoke<CommandResult<AuditLogExportValue>>("Exporting activity log", "export_audit_log");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Activity log export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.activityEventsExported", { count: value.counts.events }, `Exported ${value.counts.events} activity event${value.counts.events === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function exportConsentReceipt() {
    const result = await invoke<CommandResult<ConsentReceiptExportValue>>("Exporting consent receipt", "export_consent_receipt");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Consent receipt export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.consentReceiptExported", { count: value.counts.people }, `Consent receipt exported for ${value.counts.people} person label${value.counts.people === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function loadRetentionPolicyReport() {
    const result = await invoke<RetentionPolicyReport>("Checking retention", "retention_policy_report");
    setRetentionPolicy(result);
    setNoticeMessage(
      result.counts.reviewedCandidates ? "ok" : "warn",
      result.counts.reviewedCandidates ? "notice.retentionReportLoaded" : "notice.retentionReportEmpty",
      { count: result.counts.reviewedCandidates },
      result.counts.reviewedCandidates
        ? `Retention report loaded for ${result.counts.reviewedCandidates} reviewed match${result.counts.reviewedCandidates === 1 ? "" : "es"}.`
        : "Retention report loaded; no reviewed matches are ready for cleanup."
    );
  }

  async function setJurisdictionPreset(preset: string) {
    const result = await invoke<CommandResult<{ preset: string; label: string; retentionReviewedDays: number }>>(
      "Applying jurisdiction preset",
      "set_jurisdiction_preset",
      { preset }
    );
    const value = result.value;
    if (value) {
      setNotice({
        tone: "ok",
        text: `Applied ${value.label}: reviewed-match retention ${value.retentionReviewedDays} days. Operator default, not legal advice — confirm with counsel.`
      });
    }
  }

  async function exportExaminationReport() {
    const result = await invoke<CommandResult<{ markdownPath: string; candidateCount: number }>>(
      "Exporting examination report",
      "export_examination_report",
      { personName: "" }
    );
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Examination report did not return a path." });
      return;
    }
    setNotice({
      tone: "ok",
      text: `Examination report exported (${value.candidateCount} decisions). DRAFT — an investigative lead record, not an identification.`
    });
    await window.crossAge.revealPath(value.markdownPath);
  }

  async function exportCompliancePack() {
    const result = await invoke<CommandResult<{ zipPath: string; members: string[] }>>(
      "Exporting compliance pack",
      "export_compliance_pack"
    );
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Compliance pack did not return a path." });
      return;
    }
    setNotice({
      tone: "ok",
      text: `Compliance pack exported (${value.members.length} files). DPIA/FRIA/Annex-IV are DRAFTS — have counsel review before use.`
    });
    await window.crossAge.revealPath(value.zipPath);
  }

  async function exportSafeModeAudit() {
    const result = await invoke<CommandResult<SafeModeAuditExportValue>>("Exporting Safe Mode audit", "export_safe_mode_audit");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Safe Mode audit export did not return a path." });
      return;
    }
    const protectedCount = value.counts.safeFiltered + value.counts.videoProtected;
    setNoticeMessage("ok", "notice.safeModeAuditExported", { count: formatNumber(protectedCount) }, `Safe Mode audit exported with ${formatNumber(protectedCount)} protected item${protectedCount === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function exportReviewLedger() {
    const result = await invoke<CommandResult<ReviewLedgerExportValue>>("Exporting review ledger", "export_review_ledger");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Review ledger export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.reviewLedgerExported", { count: value.counts.decisionEvents }, `Review ledger exported with ${value.counts.decisionEvents} decision event${value.counts.decisionEvents === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function loadAuditEvents() {
    const result = await invoke<AuditEventsResult>("Loading activity history", "audit_events", { limit: 80, offset: 0 });
    setAuditEvents(result);
    setNoticeMessage("ok", "notice.activityEventsLoaded", { count: result.events.length }, `Loaded ${result.events.length} activity event${result.events.length === 1 ? "" : "s"}.`);
  }

  async function runRuntimeSelfTest() {
    const result = await invoke<RuntimeSelfTestResult>("Running system check", "runtime_self_test");
    setRuntimeSelfTest(result);
    setNotice({ tone: result.ok ? "ok" : "warn", text: result.ok ? "System check passed." : "System check found items to review." });
  }

  async function runModelIntegrity() {
    const result = await invoke<ModelIntegrityResult>("Checking models", "model_integrity");
    setModelIntegrity(result);
    setNotice({ tone: result.ok ? "ok" : "warn", text: result.ok ? "Model integrity check passed." : "Model integrity check found items to review." });
  }

  async function runModelDriftReport() {
    const result = await invoke<ModelDriftReport>("Checking saved model state", "model_drift_report");
    setModelDriftReport(result);
    const stale = result.counts.staleReferences + result.counts.staleCandidates;
    setNoticeMessage(
      stale ? "warn" : "ok",
      stale ? "notice.modelDriftStale" : "notice.modelDriftReady",
      { count: formatNumber(stale) },
      stale
        ? `${formatNumber(stale)} saved item${stale === 1 ? "" : "s"} were created with a different face model.`
        : "Saved faces and matches use the active face model."
    );
  }

  async function runReferenceGapReport() {
    const result = await invoke<ReferenceGapReport>("Checking saved people", "reference_gap_report");
    setReferenceGapReport(result);
    setNotice({
      tone: result.needsAttention ? "warn" : "ok",
      text: result.needsAttention
        ? `${formatNumber(result.needsAttention)} saved person${result.needsAttention === 1 ? "" : "s"} need stronger reference photos.`
        : "Saved people have strong reference coverage."
    });
  }

  async function runRuntimeBenchmark() {
    const result = await invoke<RuntimeBenchmarkResult>("Running benchmark", "runtime_benchmark");
    setRuntimeBenchmark(result);
    setNotice({ tone: "ok", text: "Benchmark complete." });
  }

  async function runReleaseReadiness() {
    const result = await invoke<ReleaseReadinessResult>("Checking release", "release_readiness");
    setReleaseReadiness(result);
    setNotice({ tone: result.ok ? "ok" : "warn", text: result.ok ? "Release checklist passed." : "Release checklist has items to finish." });
  }

  async function runInstallerDiagnostics() {
    const result = await invoke<InstallerDiagnosticsResult>("Checking installer", "installer_self_diagnostics");
    setInstallerDiagnostics(result);
    setNotice({ tone: result.ok ? "ok" : "warn", text: result.ok ? "Installer diagnostics passed." : "Installer diagnostics found items to review." });
  }

  async function refreshPhotoSources() {
    try {
      const sources = await window.crossAge.getPhotoSources();
      setPhotoSources(sources);
      setNotice({ tone: "ok", text: "Photo locations refreshed." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  function usePhotoSource(source: SystemPhotoSource) {
    if (!source.available) {
      setNotice({ tone: "warn", text: `${source.label} is not available on this computer.` });
      return;
    }
    setScanFolder(source.path);
    setActiveTab("scan");
    setNotice({ tone: "ok", text: `${source.label} selected for scanning.` });
  }

  function rerunScanSource(run: AppState["scanHistory"][number]) {
    const folder = String(run.label || "").trim();
    if (!folder) {
      setNotice({ tone: "warn", text: "This scan run does not have a reusable folder path." });
      return;
    }
    setScanFolder(folder);
    setActiveTab("scan");
    setNotice({ tone: "ok", text: "Past scan source selected. Check the folder, then scan again." });
  }

  function persistSavedScanSources(next: SavedScanSource[]) {
    const sorted = next.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 40);
    setSavedScanSources(sorted);
    writeSavedScanSources(state?.workspace, sorted);
  }

  function persistScanQueue(next: ScanQueueItem[]) {
    const trimmed = next.slice(0, 80);
    setScanQueue(trimmed);
    writeScanQueue(state?.workspace, trimmed);
  }

  function saveCurrentScanSource() {
    const folder = scanFolder.trim();
    if (!folder) {
      setNotice({ tone: "warn", text: "Choose a folder before saving it." });
      return;
    }
    const label = promptUi("Name this scan source", basename(folder) || "Saved source")?.trim();
    if (!label) return;
    const now = Date.now();
    const existing = savedScanSources.filter((source) => source.path !== folder);
    persistSavedScanSources([
      {
        id: `${folder}:${now}`,
        label,
        path: folder,
        createdAt: now,
        lastUsedAt: now
      },
      ...existing
    ]);
    setNotice({ tone: "ok", text: "Scan source saved." });
  }

  function useSavedScanSource(source: SavedScanSource) {
    setScanFolder(source.path);
    persistSavedScanSources(savedScanSources.map((item) => item.id === source.id ? { ...item, lastUsedAt: Date.now() } : item));
    setNotice({ tone: "ok", text: `${source.label} selected.` });
  }

  function removeSavedScanSource(sourceId: string) {
    persistSavedScanSources(savedScanSources.filter((source) => source.id !== sourceId));
    setNotice({ tone: "ok", text: "Saved source removed." });
  }

  function addCurrentToScanQueue() {
    const folder = scanFolder.trim();
    if (!folder) {
      setNotice({ tone: "warn", text: "Choose a folder before adding it to the queue." });
      return;
    }
    const now = Date.now();
    const existing = scanQueue.filter((item) => item.path !== folder);
    persistScanQueue([
      ...existing,
      {
        id: `${folder}:${now}`,
        label: basename(folder) || "Queued folder",
        path: folder,
        createdAt: now,
        lastUsedAt: now,
        status: "queued"
      }
    ]);
    setNotice({ tone: "ok", text: "Folder added to the scan queue." });
  }

  function removeScanQueueItem(itemId: string) {
    persistScanQueue(scanQueue.filter((item) => item.id !== itemId));
    setNotice({ tone: "ok", text: "Queue item removed." });
  }

  function clearScanQueue() {
    persistScanQueue([]);
    setNotice({ tone: "ok", text: "Scan queue cleared." });
  }

  function clearCompletedScanQueueItems() {
    const next = scanQueue.filter((item) => item.status !== "done");
    persistScanQueue(next);
    setNotice({ tone: "ok", text: "Finished queue items cleared." });
  }

  function retryFailedScanQueueItems() {
    const failed = scanQueue.filter((item) => item.status === "error").length;
    if (!failed) {
      setNotice({ tone: "warn", text: "No failed queue items to retry." });
      return;
    }
    persistScanQueue(scanQueue.map((item) => item.status === "error" ? { ...item, status: "queued", message: "Ready to retry" } : item));
    setNoticeMessage("ok", "notice.failedFoldersReady", { count: failed }, `${failed} failed folder${failed === 1 ? "" : "s"} ready to retry.`);
  }

  async function runScanQueue() {
    if (!state?.consentOnFile || !state.references.length) {
      setNotice({ tone: "warn", text: "Confirm permission and add a person before running the queue." });
      return;
    }
    let working = scanQueue.map((item) => item.status === "running" ? { ...item, status: "queued" as const } : item);
    const pending = working.filter((item) => item.status !== "done");
    if (!pending.length) {
      setNotice({ tone: "warn", text: "No pending folders are in the queue." });
      return;
    }
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return;
    setScanQueueRunning(true);
    const updateItem = (id: string, patch: Partial<ScanQueueItem>) => {
      working = working.map((item) => item.id === id ? { ...item, ...patch } : item);
      persistScanQueue(working);
    };
    let completed = 0;
    try {
      persistScanQueue(working);
      for (const item of pending) {
        setScanFolder(item.path);
        updateItem(item.id, { status: "running", message: "Scanning" });
        try {
          const result = await invoke<CommandResult>("Scanning queued folder", "scan", {
            folder: item.path,
            source: "queue",
            resume: true,
            ...compatibilityParams
          });
          if (result.metrics?.cancelled) {
            updateItem(item.id, { status: "error", message: `Cancelled after ${result.metrics.processed ?? 0} file(s)` });
            setNotice({ tone: "warn", text: "Queue stopped because the scan was cancelled." });
            break;
          }
          completed += 1;
          updateItem(item.id, {
            status: "done",
            lastUsedAt: Date.now(),
            message: `Found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"}`
          });
          if (savedScanSources.some((source) => source.path === item.path)) {
            persistSavedScanSources(savedScanSources.map((source) => source.path === item.path ? { ...source, lastUsedAt: Date.now() } : source));
          }
        } catch (error) {
          updateItem(item.id, { status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      }
      if (completed) {
        setNoticeMessage("ok", "notice.scanQueueFinished", { count: completed }, `Scan queue finished ${completed} folder${completed === 1 ? "" : "s"}.`);
      }
    } finally {
      setScanQueueRunning(false);
    }
  }

  async function retryIssuePaths(paths: string[]) {
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) {
      setNotice({ tone: "warn", text: "No issue files are available to retry." });
      return;
    }
    if (!state?.consentOnFile || !state.references.length) {
      setNotice({ tone: "warn", text: "Confirm permission and add a person before retrying files." });
      return;
    }
    const compatibilityParams = await scanCompatibilityParams();
    if (!compatibilityParams) return;
    const result = await invoke<CommandResult>("Retrying issue files", "scan_paths", {
      paths: uniquePaths,
      source: "retry",
      resume: false,
      ...compatibilityParams
    });
    const skipped = result.errors?.length ? ` ${result.errors.length} still need attention.` : "";
    setNoticeMessage(
      "ok",
      "notice.retryFilesComplete",
      { files: uniquePaths.length, matches: result.added ?? 0, skipped },
      `Retried ${uniquePaths.length} file${uniquePaths.length === 1 ? "" : "s"} and found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"}.${skipped}`
    );
  }

  async function loadDuplicatePeople() {
    const result = await invoke<DuplicatePeopleResult>("Finding duplicate people", "duplicate_people", { threshold: 0.82, limit: 20 });
    setDuplicatePeople(result);
    setNotice({
      tone: result.suggestions.length ? "warn" : "ok",
      text: result.suggestions.length
        ? `Found ${result.suggestions.length} possible duplicate person label${result.suggestions.length === 1 ? "" : "s"}.`
        : "No duplicate person labels found."
    });
  }

  async function mergeDuplicatePeople(sourceName: string, targetName: string) {
    await renamePerson(sourceName, targetName);
    await loadDuplicatePeople();
  }

  async function applyReviewRules() {
    if (!settings) return;
    const hasRules = settings.reviewRules.autoRejectBelow > 0 ||
      settings.reviewRules.autoRejectLowQualityVideo ||
      settings.reviewRules.autoUncertainLowQuality;
    if (!hasRules) {
      setNotice({ tone: "warn", text: "Turn on at least one review rule first." });
      return;
    }
    if (!await confirmDialog("Apply saved review rules to pending matches? You can still review and change any result afterward.")) return;
    try {
      await saveSettingsDraftIfDirty("Saving review rules");
    } catch {
      return;
    }
    const result = await invoke<CommandResult<ReviewRulesApplyResult>>("Applying review rules", "apply_review_rules", { confirm: true });
    if (result.value) {
      setReviewRuleResult(result.value);
      setNotice({ tone: result.value.updated ? "ok" : "warn", text: `Review rules updated ${result.value.updated} possible match${result.value.updated === 1 ? "" : "es"}.` });
    }
  }

  async function refreshWorkspaceLockStatus() {
    try {
      const status = await window.crossAge.getWorkspaceLockStatus();
      setWorkspaceLock(status);
      return status;
    } catch (error) {
      setErrorNotice(error);
      return null;
    }
  }

  async function enableWorkspaceLock() {
    try {
      const status = await window.crossAge.enableWorkspaceLock();
      setWorkspaceLock(status);
      setNotice({ tone: "ok", text: "Workspace Lock is on for this app folder." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function lockWorkspace() {
    try {
      const status = await window.crossAge.lockWorkspace();
      setWorkspaceLock(status);
      const next = await window.crossAge.getInitialState();
      applyState(next);
      setNotice({ tone: "warn", text: "Workspace locked." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function unlockWorkspace() {
    try {
      const status = await window.crossAge.unlockWorkspace();
      setWorkspaceLock(status);
      const next = await window.crossAge.getInitialState();
      applyState(next);
      setNotice({ tone: "ok", text: "Workspace unlocked for this session." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function disableWorkspaceLock() {
    if (!await confirmDialog("Turn Workspace Lock off for this app folder?")) return;
    try {
      const status = await window.crossAge.disableWorkspaceLock();
      setWorkspaceLock(status);
      setNotice({ tone: "ok", text: "Workspace Lock is off." });
    } catch (error) {
      setErrorNotice(error);
    }
  }

  async function runAccuracyEvaluation() {
    const result = await invoke<AccuracyEvaluation>("Checking accuracy", "accuracy_evaluation");
    setAccuracyEvaluation(result);
    const likely = result.metrics.likely;
    setNotice({
      tone: likely?.labeled ? "ok" : "warn",
      text: likely?.labeled
        ? `Accuracy check used ${likely.labeled} reviewed item${likely.labeled === 1 ? "" : "s"}.`
        : "Accept or reject matches to build an accuracy baseline."
    });
  }

  async function generateAccuracyValidationPack() {
    const result = await invoke<CommandResult<AccuracyValidationPackValue>>(
      "Running validation pack",
      "run_accuracy_validation_pack"
    );
    if (result.state) {
      applyState(result.state);
    }
    if (!result.value) {
      setNotice({ tone: "warn", text: "Validation pack command completed without a result." });
      return;
    }
    setAccuracyValidationPack(result.value);
    setNotice({
      tone: result.value.status === "fail" ? "error" : result.value.status === "warn" ? "warn" : "ok",
      text: `Validation pack ${result.value.status ?? "complete"}: ${result.value.counts.cases} scenario cases.`
    });
  }

  async function choosePublicDatasetFolder() {
    return window.crossAge.chooseFolder();
  }

  async function inspectPublicDataset(options: { datasetId: string; folder: string; includeVideos?: boolean }) {
    const result = await invoke<PublicDatasetInspection>("Inspecting dataset", "inspect_public_dataset", {
      datasetId: options.datasetId,
      folder: options.folder,
      includeVideos: Boolean(options.includeVideos)
    });
    setPublicDatasetInspection(result);
    setNotice({
      tone: result.usableIdentityCount >= 2 ? "ok" : "warn",
      text: `Dataset inspection found ${formatNumber(result.usableIdentityCount)} usable identities.`
    });
  }

  async function runPublicDatasetBenchmark(options: {
    datasetId: string;
    folder: string;
    maxIdentities: number;
    candidateImages: number;
    downloadIfMissing?: boolean;
    includeVideos?: boolean;
  }) {
    const autoDownloadDatasets = new Set(["lfw", "cfp"]);
    if (!options.folder && !autoDownloadDatasets.has(options.datasetId)) {
      setNotice({ tone: "warn", text: "Choose a local dataset folder first." });
      return;
    }
    if (!options.folder && options.datasetId === "lfw" && !await confirmDialog("Download or reuse the LFW benchmark cache and run an isolated local benchmark?")) return;
    if (!options.folder && options.datasetId === "cfp" && !await confirmDialog("Download or reuse the official CFP benchmark archive and run an isolated local benchmark?")) return;
    const result = await invoke<CommandResult<PublicDatasetBenchmarkResult>>("Running dataset benchmark", "run_public_dataset_benchmark", {
      datasetId: options.datasetId,
      folder: options.folder,
      maxIdentities: options.maxIdentities,
      candidateImages: options.candidateImages,
      downloadIfMissing: Boolean(options.downloadIfMissing),
      includeVideos: Boolean(options.includeVideos),
      includeDistractors: true
    });
    if (result.value) {
      setPublicDatasetBenchmark(result.value);
      setPublicDatasetInspection(result.value.inspection);
      setNotice({
        tone: result.value.metrics.falsePositives || result.value.metrics.falseNegatives ? "warn" : "ok",
        text: `Dataset benchmark finished: ${percent(result.value.metrics.precision)} precision, ${percent(result.value.metrics.recall)} recall.`
      });
      void window.crossAge.revealPath(result.value.reportPath);
    }
  }

  async function runPublicDatasetModelComparison(options: {
    datasetId: string;
    folder: string;
    maxIdentities: number;
    candidateImages: number;
    downloadIfMissing?: boolean;
    includeVideos?: boolean;
  }) {
    const autoDownloadDatasets = new Set(["lfw", "cfp"]);
    if (!options.folder && !autoDownloadDatasets.has(options.datasetId)) {
      setNotice({ tone: "warn", text: "Choose a local dataset folder first." });
      return;
    }
    if (!options.folder && !await confirmDialog("Run an isolated model-pack comparison using the selected public dataset cache/download?")) return;
    const result = await invoke<CommandResult<PublicDatasetModelComparisonResult>>("Comparing model packs", "compare_public_dataset_models", {
      datasetId: options.datasetId,
      folder: options.folder,
      maxIdentities: options.maxIdentities,
      candidateImages: options.candidateImages,
      downloadIfMissing: Boolean(options.downloadIfMissing),
      includeVideos: Boolean(options.includeVideos),
      includeDistractors: true
    });
    if (result.value) {
      setPublicDatasetModelComparison(result.value);
      const completed = result.value.packs.filter((pack) => pack.status === "complete").length;
      setNotice({
        tone: completed ? "ok" : "warn",
        text: completed
          ? `Compared ${completed} installed model pack${completed === 1 ? "" : "s"}.`
          : "No installed model packs were available for comparison."
      });
      void window.crossAge.revealPath(result.value.reportPath);
    }
  }

  async function applyModelRecommendation(pack: string) {
    const target = pack.trim();
    if (!target) {
      setNotice({ tone: "warn", text: "Run model comparison first, then choose a recommended model." });
      return;
    }
    if (!await confirmDialog(`Apply ${target} as the active face model and backfill saved person photos now?`)) return;
    try {
      const result = await invoke<CommandResult<Record<string, unknown>>>("Applying model recommendation", "apply_model_recommendation", {
        pack: target,
        backfill: true
      });
      const value = result.value ?? {};
      const backfill = asRecord(value.backfill) ?? {};
      const added = Number(backfill.added ?? 0);
      const changed = Boolean(value.changed);
      setNotice({
        tone: "ok",
        text: `${changed ? "Switched" : "Kept"} active model ${target}${added ? ` and backfilled ${formatNumber(added)} saved photo embedding${added === 1 ? "" : "s"}` : ""}.`
      });
    } catch (error) {
      setErrorNotice(error, "Recommended model could not be applied.");
    }
  }

  async function applyCalibration() {
    if (!await confirmDialog("Apply the current review feedback to the matching levels? You can still change settings afterward.")) return;
    const result = await invoke<CommandResult>("Applying calibration", "apply_calibration");
    if (result.state) {
      applyState(result.state);
    }
    setNotice({ tone: "ok", text: "Matching levels updated from review feedback." });
  }

  async function exportAccuracyLabels() {
    const result = await invoke<CommandResult<AccuracyLabelsExportValue>>("Exporting accuracy labels", "export_accuracy_labels");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Accuracy label export did not return a path." });
      return;
    }
    setNoticeMessage("ok", "notice.accuracyLabelsExported", { count: value.counts.labels }, `Exported ${value.counts.labels} accuracy label${value.counts.labels === 1 ? "" : "s"}.`);
    await window.crossAge.revealPath(value.jsonPath);
  }

  function parseAccuracyLabelRows(text: string) {
    const parsed = JSON.parse(text);
    const record = asRecord(parsed);
    if (Array.isArray(parsed)) return parsed.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    if (record && Array.isArray(record.labels)) return record.labels.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    if (record && Array.isArray(record.rows)) return record.rows.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    const value = record ? asRecord(record.value) : null;
    if (value && Array.isArray(value.labels)) return value.labels.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
    throw new Error("Paste a Vintrace accuracy-label JSON export with a labels array.");
  }

  async function importAccuracyLabels(text: string) {
    const rows = parseAccuracyLabelRows(text);
    if (!rows.length) {
      setNotice({ tone: "warn", text: "No accuracy labels were found in the pasted JSON." });
      return;
    }
    const result = await invoke<CommandResult<AccuracyLabelsImportValue>>("Importing accuracy labels", "import_accuracy_labels", { rows });
    if (result.state) {
      applyState(result.state);
    }
    const imported = result.value?.imported ?? 0;
    const skipped = result.value?.skipped ?? 0;
    setNotice({
      tone: imported ? "ok" : "warn",
      text: `Imported ${imported} accuracy label${imported === 1 ? "" : "s"}${skipped ? ` and skipped ${skipped}` : ""}.`
    });
    void runAccuracyEvaluation();
  }

  async function addCandidateCalibrationLabel(candidate: ReviewCandidate, isMatch: boolean) {
    const result = await invoke<{ labelId: string; summary: AppState["calibration"] }>("Saving accuracy label", "add_calibration_label", {
      row: {
        candidateId: candidate.candidateId,
        sourcePath: candidate.sourcePath,
        sourceHash: candidate.sourceHash,
        expectedPerson: candidate.personName,
        actualPerson: isMatch ? candidate.personName : "",
        matchScore: candidate.score,
        quality: candidate.quality,
        isMatch,
        status: candidate.status,
        mediaKind: candidate.mediaKind,
        createdAt: candidate.createdAt
      }
    });
    if (state && result.summary) {
      applyState({ ...state, calibration: result.summary });
    }
    setNotice({ tone: "ok", text: `Accuracy label saved as ${isMatch ? "same person" : "not same person"}.` });
  }

  async function exportAcceptedMediaBundle() {
    const result = await invoke<CommandResult<MediaBundleExportValue>>("Exporting media bundle", "export_media_bundle", {
      statuses: ["accepted"],
      includeOriginalMedia: true
    });
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Media bundle did not return a folder path." });
      return;
    }
    setNoticeMessage("ok", "notice.mediaFilesExported", { count: value.counts.copied }, `Exported ${value.counts.copied} media file${value.counts.copied === 1 ? "" : "s"} to a shareable folder.`);
    await window.crossAge.revealPath(value.bundlePath);
  }

  async function loadPrivacyReport() {
    const result = await invoke<PrivacyReport>("Checking privacy data", "privacy_report");
    setPrivacyReport(result);
    setNotice({ tone: "ok", text: "Privacy data report loaded." });
  }

  async function deleteFaceData(includeAudit = false) {
    const text = includeAudit
      ? "Delete all face data, generated caches, scan history, and activity history? This cannot be undone without a backup."
      : "Delete all saved faces, possible matches, generated previews, scan history, and model caches? Activity history is preserved.";
    if (!await confirmDialog(text)) return;
    const result = await invoke<CommandResult<DeleteFaceDataResult>>("Deleting face data", "delete_face_data", {
      confirm: true,
      includeAudit
    });
    if (result.value?.after) {
      setPrivacyReport(result.value.after);
    }
    setNotice({ tone: "ok", text: "Face data deleted from this app folder." });
  }

  async function renamePerson(oldName: string, newName: string) {
    const target = newName.trim();
    if (!oldName || !target) {
      setNotice({ tone: "warn", text: "Choose a person and enter the new name." });
      return;
    }
    const mergeText = settingsPeople.some((person) => person.toLowerCase() === target.toLowerCase() && person !== oldName)
      ? " This will merge into an existing person label."
      : "";
    if (!await confirmDialogMessage("dialog.renamePerson", { oldName, newName: target, mergeText }, `Rename ${oldName} to ${target}?${mergeText}`)) return;
    const result = await invoke<CommandResult>("Renaming person", "rename_person", { oldName, newName: target });
    const renamed = result.renamed ?? { references: 0, candidates: 0 };
    setNoticeMessage(
      "ok",
      "notice.personRenamed",
      { references: renamed.references, candidates: renamed.candidates },
      `Updated ${renamed.references} saved photo${renamed.references === 1 ? "" : "s"} and ${renamed.candidates} possible match${renamed.candidates === 1 ? "" : "es"}.`
    );
  }

  async function copyText(text: string, label = "Summary") {
    await window.crossAge.writeClipboardText(text);
    setNotice({ tone: "ok", text: `${label} copied.` });
  }

  function settingsPayload(draft: SettingsDraft): Record<string, unknown> {
    return {
      thresholds: draft.thresholds,
      modelPack: draft.modelPack,
      clusterMinSize: draft.clusterMinSize,
      faceDetectorSize: draft.faceDetectorSize,
      twoPassScan: draft.twoPassScan,
      verificationDetectorSize: draft.verificationDetectorSize,
      performanceMode: performanceChoice,
      safeMode: draft.safeMode,
      safeModeZeroAdmittance: draft.safeModeZeroAdmittance ?? false,
      safeModeThreshold: draft.safeModeThreshold,
      storageBudgetBytes: draft.storageBudgetBytes,
      maxMediaFileBytes: draft.maxMediaFileBytes,
      videoDecoder: draft.videoDecoder,
      reviewRules: draft.reviewRules,
      scanExclusions: draft.scanExclusions
    };
  }

  async function saveSettingsDraftIfDirty(label = "Saving settings") {
    if (!settings || !settingsDirtyRef.current) return false;
    const wasDirty = settingsDirtyRef.current;
    settingsDirtyRef.current = false;
    try {
      await invoke<AppState>(label, "save_settings", settingsPayload(settings));
      return true;
    } catch (error) {
      settingsDirtyRef.current = wasDirty;
      throw error;
    }
  }

  async function saveSettings() {
    if (!settings) return;
    try {
      await saveSettingsDraftIfDirty("Saving settings");
      setNotice({ tone: "ok", text: "Settings saved." });
    } catch {
      return;
    }
  }

  async function ignoreIssuePaths(paths: string[]) {
    if (!settings) {
      setNotice({ tone: "warn", text: "Settings are not loaded yet." });
      return;
    }
    const uniquePaths = [...new Set(paths.filter(Boolean))];
    if (!uniquePaths.length) {
      setNotice({ tone: "warn", text: "No issue files are available to ignore." });
      return;
    }
    const existing = settings.scanExclusions.filePaths ?? [];
    const existingKeys = new Set(existing.map((item) => item.toLowerCase()));
    const merged = [
      ...existing,
      ...uniquePaths.filter((item) => !existingKeys.has(item.toLowerCase()))
    ];
    const nextSettings: SettingsDraft = {
      ...settings,
      mode: "custom",
      scanExclusions: { ...settings.scanExclusions, filePaths: merged }
    };
    const wasDirty = settingsDirtyRef.current;
    settingsDirtyRef.current = false;
    setSettings(nextSettings);
    try {
      await invoke<AppState>("Saving ignored files", "save_settings", settingsPayload(nextSettings));
      setNoticeMessage("ok", "notice.issueFilesIgnored", { count: uniquePaths.length }, `Ignored ${uniquePaths.length} file${uniquePaths.length === 1 ? "" : "s"} for future scans.`);
    } catch {
      settingsDirtyRef.current = wasDirty;
    }
  }

  function copySettingsProfile() {
    if (!settings) {
      setNotice({ tone: "warn", text: "Settings are not loaded yet." });
      return;
    }
    void copyText(JSON.stringify({
      schemaVersion: 1,
      app: "Vintrace",
      exportedAt: new Date().toISOString(),
      settings: settingsPayload(settings)
    }, null, 2), "Settings profile");
  }

  function applySettingsProfile(text: string) {
    if (!settings) {
      setNotice({ tone: "warn", text: "Settings are not loaded yet." });
      return;
    }
    try {
      const parsed = JSON.parse(text);
      const wrapper = asRecord(parsed);
      const nextSettings = coerceSettingsProfile(wrapper && "settings" in wrapper ? wrapper.settings : parsed, settings);
      settingsDirtyRef.current = true;
      setSettings(nextSettings);
      setNotice({ tone: "ok", text: "Settings profile applied. Review it, then save settings." });
    } catch (error) {
      setErrorNotice(error, "Settings profile could not be read.");
    }
  }

  const candidateById = useMemo(
    () => new Map((state?.candidates ?? []).map((candidate) => [candidate.candidateId, candidate] as const)),
    [state?.candidates]
  );
  const selectedCandidate = selectedCandidateId ? candidateById.get(selectedCandidateId) ?? null : null;
  const settingsPeople = useMemo(
    () => {
      const people = new Set<string>();
      for (const ref of state?.references ?? []) {
        const personName = safeText(ref.personName).trim();
        if (personName) people.add(personName);
      }
      for (const candidate of state?.candidates ?? []) {
        const personName = safeText(candidate.personName).trim();
        if (personName && !isUnmatchedClusterName(personName)) {
          people.add(personName);
        }
      }
      return [...people].sort((a, b) => a.localeCompare(b));
    },
    [state?.candidates, state?.references]
  );

  const isDemoMode = safeText(state?.engine).startsWith("local-image-fingerprint");
  const workspaceLocked = Boolean(workspaceLock?.locked);
  const canProcess = Boolean(state?.consentOnFile) && !busy && !workspaceLocked;
  const enrollDisabled = !canProcess || !personName.trim() || !enrollFolder.trim();
  const ageGroupDisabled = !canProcess || !personName.trim() || !referenceAgeBuckets.some((bucket) => ageGroupFolders[bucket].trim());
  const scanDisabled = !canProcess || !scanFolder.trim() || !state?.references.length;

  useEffect(() => {
    folderAnalysisRequestId.current += 1;
    setFolderAnalysis(null);
    setLastPreflight((current) => current?.folder === scanFolder.trim() ? current : null);
  }, [scanFolder]);

  useEffect(() => {
    appCommandHandlerRef.current = handleAppCommand;
    externalOpenHandlerRef.current = handleExternalOpen;
  });

  useEffect(() => {
    if (!state || rendererReadySentRef.current) {
      return;
    }
    rendererReadySentRef.current = true;
    window.crossAge.rendererReady().catch(() => {
      rendererReadySentRef.current = false;
    });
  }, [state]);

  useEffect(() => {
    if (!state || checkedOnboarding) {
      return;
    }
    setCheckedOnboarding(true);
    if (!readOnboardingDismissed()) {
      setShowOnboarding(true);
    }
  }, [state, checkedOnboarding]);

  function dismissOnboarding(remember = true) {
    if (remember) {
      writeOnboardingDismissed();
    }
    setShowOnboarding(false);
  }

  function openOnboarding() {
    setShowOnboarding(true);
  }

  function onboardingNavigate(tab: TabKey) {
    dismissOnboarding();
    setActiveTab(tab);
  }

  function onboardingConsent() {
    dismissOnboarding();
    setConsent(true).catch(setErrorNotice);
  }

  function onboardingWorkspace() {
    dismissOnboarding();
    chooseWorkspace().catch(setErrorNotice);
  }

  if (!state) {
    const bootElapsedSeconds = Math.floor(Math.max(0, bootClock - bootStartedAt) / 1000);
    const bootProgress = bootError ? 100 : Math.min(94, 18 + bootElapsedSeconds * 7);
    const bootStatus = bootError ? "Startup needs attention" : bootElapsedSeconds > 9 ? "Finalizing app folder" : busy ?? "Opening app";
    const bootDetail = bootError
      ? bootError
      : bootElapsedSeconds > 9
        ? "First launch can take a moment while local model resources settle."
        : "Loading private on-device review data.";
    const bootSteps = [
      { label: "Shell", done: true },
      { label: "Engine", done: !bootError && bootElapsedSeconds > 1 },
      { label: "App folder", done: !bootError && bootElapsedSeconds > 3 }
    ];
    return (
      <main
        className={bootError ? "boot boot-failed" : "boot"}
        aria-busy={!bootError}
        style={{ "--boot-progress": `${bootProgress}%` } as CSSProperties}
      >
        <div className="boot-liquid-field" aria-hidden="true">
          <div className="boot-glass-pane" />
          <div className="fluid-current current-rose" />
          <div className="fluid-current current-aqua" />
          <div className="fluid-current current-violet" />
          <div className="water-ripple ripple-one" />
          <div className="water-ripple ripple-two" />
          <div className="water-ripple ripple-three" />
          <div className="boot-caustics" />
          <div className="boot-grain" />
        </div>
        <section className="boot-stage" aria-label="Vintrace startup">
          <div className="boot-kicker">
            <span />
            <span />
            <span />
          </div>
          <div className="boot-card" role="status" aria-live="polite">
            <div className="boot-mark">
              <div className="boot-mark-aura" />
              <img src={appIconUrl} alt="" />
            </div>
            <div className="boot-copy">
              <strong>Vintrace</strong>
              <span>{bootStatus}</span>
              <small>{bootDetail}</small>
              <div className="boot-progress" aria-hidden="true"><span /></div>
              {bootError ? (
                <div className="boot-actions">
                  <button type="button" onClick={loadInitialState}>
                    <RefreshCcw size={15} />
                    <span>Retry</span>
                  </button>
                </div>
              ) : (
                <div className="boot-step-list" aria-hidden="true">
                  {bootSteps.map((step) => (
                    <span key={step.label} className={step.done ? "done" : ""}>{step.label}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="boot-spinner-shell">
              {bootError ? <AlertCircle size={22} /> : <Loader2 className="spin" size={23} />}
            </div>
          </div>
        </section>
      </main>
    );
  }

  const navMeta: Partial<Record<TabKey, { label: string; tone: "green" | "amber" | "blue" }>> = {
    dashboard: { label: state.counts.pending ? `${state.counts.pending}` : "Live", tone: state.counts.pending ? "amber" : "blue" },
    enroll: { label: `${state.counts.references}`, tone: state.counts.references ? "green" : "amber" },
    scan: { label: watchStatus.active ? "Watch" : `${state.scanTotals.processed}`, tone: watchStatus.active ? "green" : "blue" },
    review: { label: `${state.counts.pending}`, tone: state.counts.pending ? "amber" : "green" },
    settings: { label: state.config.safeMode ? "Safe" : "Open", tone: state.config.safeMode ? "green" : "amber" }
  };
  const shellReadyItems = [
    { label: t("shell.local"), value: isDemoMode ? t("shell.demo") : t("shell.model"), tone: isDemoMode ? "amber" : "green" },
    { label: t("shell.safeMode"), value: state.config.safeMode ? t("shell.on") : t("shell.off"), tone: state.config.safeMode ? "green" : "amber" },
    { label: t("shell.toReview"), value: `${state.counts.pending}`, tone: state.counts.pending ? "amber" : "blue" }
  ] as const;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><img src={appIconUrl} alt="" /></div>
          <div>
            <strong>Vintrace</strong>
            <span>{t("app.subtitle")}</span>
          </div>
        </div>
        <nav className="nav-list">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                className={activeTab === tab.key ? "active" : ""}
                onClick={() => setActiveTab(tab.key)}
                aria-current={activeTab === tab.key ? "page" : undefined}
              >
                <Icon size={18} />
                <span className="nav-label">{t(tab.labelKey)}</span>
                {navMeta[tab.key] && <span className={`nav-badge ${navMeta[tab.key]?.tone}`}>{navMeta[tab.key]?.label}</span>}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-card">
          <span className="subtle">Mode</span>
          <strong>{isDemoMode ? "Simple engine" : "Full model"}</strong>
          <span className={isDemoMode ? "pill amber" : "pill green"} title={state.engine}>{engineLabel(state.engine)}</span>
        </div>
      </aside>

      <section className="workspace" ref={workspaceRef}>
        <header className="topbar">
          <div className="workspace-path">
            <HardDrive size={18} />
            <div>
              <small>{t("topbar.appFolder")}</small>
              <span title={state.workspace}>{state.workspace}</span>
              <div className="workspace-meta-strip" aria-label={t("topbar.folderReadiness")}>
                {shellReadyItems.map((item) => (
                  <span key={item.label} className={item.tone}>
                    {item.label}: <strong>{item.value}</strong>
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            <button className="ghost" onClick={openOnboarding} title="Open first-use guide">
              <BookOpen size={17} />
              <span>{t("topbar.guide")}</span>
            </button>
            <button className="ghost" onClick={chooseWorkspace} disabled={Boolean(busy)} title="Choose app folder">
              <FolderOpen size={17} />
              <span>{t("topbar.choose")}</span>
            </button>
            <button className="ghost" onClick={revealWorkspace} disabled={Boolean(busy)} title="Show app folder">
              <HardDrive size={17} />
              <span>{t("topbar.show")}</span>
            </button>
            <button className="ghost" onClick={() => invoke<AppState>("Refreshing", "get_state")} disabled={Boolean(busy)} title="Refresh">
              <RefreshCcw size={17} />
              <span>{t("topbar.refresh")}</span>
            </button>
            {workspaceLock?.enabled && (
              <button className={workspaceLock.locked ? "ghost danger-text" : "ghost"} onClick={workspaceLock.locked ? unlockWorkspace : lockWorkspace} title={localizeImperativeText(workspaceLock.message)}>
                {workspaceLock.locked ? <Lock size={17} /> : <Unlock size={17} />}
                <span>{workspaceLock.locked ? t("topbar.unlock") : t("topbar.lock")}</span>
              </button>
            )}
            <label className="language-picker" title={t("language.title")}>
              <span>{t("language.label")}</span>
              <select value={language} onChange={(event) => changeLanguage(normalizeLanguage(event.currentTarget.value))} aria-label={t("language.title")}>
                {languageOptions.map((option) => (
                  <option key={option.code} value={option.code}>{option.nativeLabel}</option>
                ))}
              </select>
            </label>
            <label className={`${state.consentOnFile ? "consent on" : "consent"}${busy ? " disabled" : ""}`}>
              <input type="checkbox" checked={state.consentOnFile} disabled={Boolean(busy)} onChange={(event) => setConsent(event.currentTarget.checked)} />
              <ShieldCheck size={17} />
              <span>{t("topbar.permission")}</span>
            </label>
          </div>
        </header>

        <div className="status-row">
          {busy ? (
            <div className="notice busy" role="status" aria-live="polite" aria-atomic="true"><Loader2 className="spin" size={16} /> {uiText(busy)}</div>
          ) : notice ? (
            <div className={`notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
              {notice.tone === "error" ? <AlertCircle size={16} /> : <Check size={16} />}
              {notice.errorCode
                ? formatErrorMessage(language, notice.errorCode, notice.text, notice.action)
                : notice.messageKey && language !== "en"
                ? uiMessage(notice.messageKey, notice.values)
                : uiText(notice.text)}
            </div>
          ) : (
            <div className="notice neutral" role="status" aria-live="polite" aria-atomic="true">{t("status.ready")}</div>
          )}
          {isDemoMode && <div className="notice warn">{t("status.simpleMatching")}</div>}
        </div>

        {workspaceLocked && workspaceLock && (
          <WorkspaceLockGate
            status={workspaceLock}
            unlock={unlockWorkspace}
            chooseWorkspace={chooseWorkspace}
          />
        )}

        {!workspaceLocked && activeTab === "dashboard" && (
          <Dashboard
            state={state}
            scanProgress={scanProgress}
            watchStatus={watchStatus}
            latencySamples={latencySamples}
            latencySummary={latencySummary}
            workspaceHealth={workspaceHealth}
            performanceChoice={performanceChoice}
            performanceProfile={performanceProfile}
            navigate={setActiveTab}
            chooseWorkspace={chooseWorkspace}
            runWorkspaceHealth={runWorkspaceHealth}
            requestConsent={() => setConsent(true).catch(setErrorNotice)}
            chooseModelRoot={chooseModelRoot}
            downloadModel={downloadModel}
            backfillModelReferences={backfillModelReferences}
            modelDownloadProgress={modelDownloadProgress}
            updateStatus={updateStatus}
            mediaActionProgress={mediaActionProgress}
            scanQueue={scanQueue}
            scanQueueRunning={scanQueueRunning}
            rerunScanSource={rerunScanSource}
            cancelScan={cancelActiveScan}
            pauseScan={pauseActiveScan}
            resumeScan={resumeActiveScan}
            localScanMarkers={localScanMarkers}
            busy={Boolean(busy)}
          />
        )}
        {!workspaceLocked && activeTab === "enroll" && (
          <EnrollView
            state={state}
            personName={personName}
            setPersonName={setPersonName}
            ageBucket={ageBucket}
            setAgeBucket={setAgeBucket}
            enrollFolder={enrollFolder}
            setEnrollFolder={setEnrollFolder}
            ageGroupFolders={ageGroupFolders}
            setAgeGroupFolder={setAgeGroupFolder}
            chooseAgeGroupFolder={chooseAgeGroupFolder}
            chooseFolder={() => chooseFolder(setEnrollFolder)}
            enroll={enroll}
            enrollAgeGroups={enrollAgeGroups}
            disabled={enrollDisabled}
            ageGroupDisabled={ageGroupDisabled}
            selectedRefId={selectedRefId}
            setSelectedRefId={setSelectedRefId}
            deleteReference={deleteReference}
            clearReferences={clearReferences}
            busy={Boolean(busy)}
          />
        )}
        {!workspaceLocked && activeTab === "scan" && (
          <ScanView
            state={state}
            scanFolder={scanFolder}
            setScanFolder={setScanFolder}
            chooseFolder={() => chooseFolder(setScanFolder)}
            scan={scan}
            resumeLastScan={resumeLastScan}
            restartLastScan={restartLastScan}
            dismissedRecoveryRunId={dismissedRecoveryRunId}
            dismissRecovery={(runId) => setDismissedRecoveryRunId(runId)}
            scanCameraFrame={scanCameraFrame}
            analyzeFolder={analyzeScanFolder}
            folderAnalysis={folderAnalysis}
            startWatchFolder={startWatchFolder}
            stopWatchFolder={stopWatchFolder}
            cancelScan={cancelActiveScan}
            pauseScan={pauseActiveScan}
            resumeScan={resumeActiveScan}
            localScanMarkers={localScanMarkers}
            scanProgress={scanProgress}
            watchStatus={watchStatus}
            clearQueue={clearQueue}
            disabled={scanDisabled}
            busy={Boolean(busy)}
            candidateBatchSize={runtimePerformanceProfile.candidateBatchSize}
            showListThumbnails={runtimePerformanceProfile.showListThumbnails}
            pendingExternalIntent={pendingExternalIntent}
            resumePendingExternalIntent={resumePendingExternalIntent}
            clearPendingExternalIntent={() => setPendingExternalIntent(null)}
            copyText={copyText}
            revealPath={revealCandidatePath}
            openPath={openCandidatePath}
            photoSources={photoSources}
            refreshPhotoSources={refreshPhotoSources}
            usePhotoSource={usePhotoSource}
            savedScanSources={savedScanSources}
            saveCurrentScanSource={saveCurrentScanSource}
            useSavedScanSource={useSavedScanSource}
            removeSavedScanSource={removeSavedScanSource}
            scanQueue={scanQueue}
            scanQueueRunning={scanQueueRunning}
            addCurrentToScanQueue={addCurrentToScanQueue}
            runScanQueue={runScanQueue}
            removeScanQueueItem={removeScanQueueItem}
            clearScanQueue={clearScanQueue}
            clearCompletedScanQueueItems={clearCompletedScanQueueItems}
            retryFailedScanQueueItems={retryFailedScanQueueItems}
            retryIssuePaths={retryIssuePaths}
            ignoreIssuePaths={ignoreIssuePaths}
            selectCandidate={(id) => {
              setSelectedCandidateId(id);
              setActiveTab("review");
            }}
          />
        )}
        {!workspaceLocked && activeTab === "review" && (
          <ReviewView
            state={state}
            selectedCandidate={selectedCandidate}
            selectedCandidateId={selectedCandidateId}
            setSelectedCandidateId={setSelectedCandidateId}
            queryCandidates={queryCandidates}
            review={review}
            bulkReview={bulkReview}
            blockFalseMatch={blockFalseMatch}
            reassignCandidatePerson={reassignCandidatePerson}
            addCandidateCalibrationLabel={addCandidateCalibrationLabel}
            exportSelectedCandidates={exportSelectedCandidates}
            previewCandidateMediaAction={previewCandidateMediaAction}
            manageCandidateMedia={manageCandidateMedia}
            loadMediaActionHistory={loadMediaActionHistory}
            restoreMediaAction={restoreMediaAction}
            retryMediaAction={retryMediaAction}
            undoMediaAction={undoMediaAction}
            cancelMediaAction={cancelMediaAction}
            chooseDestinationFolder={chooseDestinationFolder}
            mediaActionProgress={mediaActionProgress}
            saveCandidateNote={saveCandidateNote}
            copyText={copyText}
            revealPath={revealCandidatePath}
            openPath={openCandidatePath}
            reviewUndo={reviewUndo}
            undoReview={undoLastReview}
            renderBatchSize={runtimePerformanceProfile.reviewBatchSize}
            showListThumbnails={runtimePerformanceProfile.showListThumbnails}
            busy={Boolean(busy)}
          />
        )}
        {!workspaceLocked && activeTab === "settings" && settings && (
          <SettingsView
            state={state}
            settings={settings}
            setSettings={updateSettingsDraft}
            saveSettings={saveSettings}
            busy={Boolean(busy)}
            platformSummary={state.platform.accelerator_status}
            systemIntegration={systemIntegration}
            setLaunchAtLogin={setLaunchAtLogin}
            updateStatus={updateStatus}
            checkForUpdates={checkForUpdates}
            setUpdateChannel={setUpdateChannel}
            downloadUpdate={downloadUpdate}
            installUpdate={installUpdate}
            diagnosticsReport={diagnosticsReport}
            previewDiagnostics={previewDiagnostics}
            exportDiagnostics={exportDiagnostics}
            exportSupportBundle={exportSupportBundle}
            revealWorkspace={revealWorkspace}
            openWorkspaceFolder={openWorkspaceFolder}
            recentWorkspaces={recentWorkspaces}
            switchWorkspace={switchWorkspace}
            people={settingsPeople}
            exportReport={exportReport}
            exportScanHistory={exportScanHistory}
            exportWorkspaceInventory={exportWorkspaceInventory}
            exportAuditLog={exportAuditLog}
            exportConsentReceipt={exportConsentReceipt}
            loadRetentionPolicyReport={loadRetentionPolicyReport}
            exportSafeModeAudit={exportSafeModeAudit}
            setJurisdictionPreset={setJurisdictionPreset}
            exportCompliancePack={exportCompliancePack}
            exportExaminationReport={exportExaminationReport}
            exportReviewLedger={exportReviewLedger}
            exportWorkspaceBackup={exportWorkspaceBackup}
            verifyLatestWorkspaceBackup={verifyLatestWorkspaceBackup}
            restoreLatestWorkspaceBackup={restoreLatestWorkspaceBackup}
            backupVerification={backupVerification}
            backupRestoreResult={backupRestoreResult}
            backupPruneResult={backupPruneResult}
            pruneWorkspaceBackups={pruneWorkspaceBackups}
            copyText={copyText}
            copySettingsProfile={copySettingsProfile}
            applySettingsProfile={applySettingsProfile}
            purgeReviewedCandidates={purgeReviewedCandidates}
            purgeOldCandidates={purgeOldCandidates}
            runWorkspaceHealth={runWorkspaceHealth}
            repairWorkspace={repairWorkspace}
            workspaceRepairResult={workspaceRepairResult}
            repairDatabaseIntegrity={repairDatabaseIntegrity}
            databaseRepairResult={databaseRepairResult}
            relinkWorkspacePaths={relinkWorkspacePaths}
            workspaceRelinkResult={workspaceRelinkResult}
            purgeDuplicateCandidates={purgeDuplicateCandidates}
            workspaceHealth={workspaceHealth}
            workspaceOptimizeResult={workspaceOptimizeResult}
            optimizeWorkspace={optimizeWorkspace}
            pruneScanManifests={pruneScanManifests}
            scanManifestPruneResult={scanManifestPruneResult}
            enforceStorageBudget={enforceStorageBudget}
            deletePerson={deletePerson}
            renamePerson={renamePerson}
            auditEvents={auditEvents}
            loadAuditEvents={loadAuditEvents}
            runtimeSelfTest={runtimeSelfTest}
            runRuntimeSelfTest={runRuntimeSelfTest}
            runtimeBenchmark={runtimeBenchmark}
            runRuntimeBenchmark={runRuntimeBenchmark}
            releaseReadiness={releaseReadiness}
            runReleaseReadiness={runReleaseReadiness}
            accuracyEvaluation={accuracyEvaluation}
            accuracyValidationPack={accuracyValidationPack}
            publicDatasetCatalog={publicDatasetCatalog}
            publicDatasetInspection={publicDatasetInspection}
            publicDatasetBenchmark={publicDatasetBenchmark}
            publicDatasetModelComparison={publicDatasetModelComparison}
            runAccuracyEvaluation={runAccuracyEvaluation}
            generateAccuracyValidationPack={generateAccuracyValidationPack}
            choosePublicDatasetFolder={choosePublicDatasetFolder}
            inspectPublicDataset={inspectPublicDataset}
            runPublicDatasetBenchmark={runPublicDatasetBenchmark}
            runPublicDatasetModelComparison={runPublicDatasetModelComparison}
            applyModelRecommendation={applyModelRecommendation}
            applyCalibration={applyCalibration}
            exportAccuracyLabels={exportAccuracyLabels}
            importAccuracyLabels={importAccuracyLabels}
            privacyReport={privacyReport}
            mediaTrashReport={mediaTrashReport}
            mediaTrashCleanup={mediaTrashCleanup}
            retentionPolicy={retentionPolicy}
            loadPrivacyReport={loadPrivacyReport}
            loadMediaTrashReport={loadMediaTrashReport}
            cleanupMediaTrash={cleanupMediaTrash}
            deleteFaceData={deleteFaceData}
            exportAcceptedMediaBundle={exportAcceptedMediaBundle}
            performanceMode={performanceChoice}
            effectivePerformanceMode={performanceMode}
            setPerformanceMode={(value) => void setPerformanceChoice(value)}
            performanceProfile={performanceProfile}
            latencySamples={latencySamples}
            latencySummary={latencySummary}
            scanProgress={scanProgress}
            clearLatencySamples={clearLatencySamples}
            copyPerformanceReport={copyPerformanceReport}
            warmPreviewsNow={() => warmPreviewCache(runtimePerformanceProfile.manualPreviewLimit, true)}
            chooseModelRoot={chooseModelRoot}
            downloadModel={downloadModel}
            backfillModelReferences={backfillModelReferences}
            modelSwitchPlan={modelSwitchPlan}
            runModelSwitchDryRun={(targetPack) => runModelSwitchDryRun(targetPack)}
            modelDownloadProgress={modelDownloadProgress}
            installerDiagnostics={installerDiagnostics}
            runInstallerDiagnostics={runInstallerDiagnostics}
            modelIntegrity={modelIntegrity}
            runModelIntegrity={runModelIntegrity}
            modelDriftReport={modelDriftReport}
            runModelDriftReport={runModelDriftReport}
            referenceGapReport={referenceGapReport}
            runReferenceGapReport={runReferenceGapReport}
            startReferenceFix={startReferenceFix}
            duplicatePeople={duplicatePeople}
            loadDuplicatePeople={loadDuplicatePeople}
            mergeDuplicatePeople={mergeDuplicatePeople}
            reviewRuleResult={reviewRuleResult}
            applyReviewRules={applyReviewRules}
            workspaceLock={workspaceLock}
            enableWorkspaceLock={enableWorkspaceLock}
            lockWorkspace={lockWorkspace}
            unlockWorkspace={unlockWorkspace}
            disableWorkspaceLock={disableWorkspaceLock}
          />
        )}
        {showOnboarding && (
          <OnboardingGuide
            state={state}
            t={t}
            onClose={() => dismissOnboarding()}
            onLater={() => dismissOnboarding(false)}
            navigate={onboardingNavigate}
            chooseWorkspace={onboardingWorkspace}
            requestConsent={onboardingConsent}
          />
        )}
        {consentPrompt && (
          <ConsentSheet
            scope={consentPrompt.scope}
            t={t}
            onCancel={() => setConsentPrompt(null)}
            onConfirm={confirmConsent}
          />
        )}
        <ConfirmHost />
      </section>
    </main>
  );
}

function WorkspaceLockGate({
  status,
  unlock,
  chooseWorkspace
}: {
  status: WorkspaceLockStatus;
  unlock(): void;
  chooseWorkspace(): void;
}) {
  return (
    <div className="lock-gate">
      <div className="lock-gate-card">
        <div className="lock-orb">
          <Lock size={34} />
        </div>
        <span className="eyebrow">Workspace Lock</span>
        <h2>This app folder is locked</h2>
        <p>{localizeImperativeText(status.message)} {localizeImperativeText("Vintrace will not show saved people, possible matches, or private review data until it is unlocked.")}</p>
        <dl className="mini-list">
          <dt>App folder</dt><dd title={status.workspace}>{status.workspace}</dd>
          <dt>Protection</dt><dd>{status.usingOsKeychain ? "OS encrypted" : "Unavailable"}</dd>
        </dl>
        <div className="button-row center">
          <button className="primary" onClick={unlock} disabled={!status.supported}>
            <Unlock size={17} />
            <span>Unlock on this computer</span>
          </button>
          <button className="secondary" onClick={chooseWorkspace}>
            <FolderOpen size={17} />
            <span>Choose another folder</span>
          </button>
        </div>
        <small>Workspace Lock controls access inside the app. It does not alter original photo files outside the app folder.</small>
      </div>
    </div>
  );
}

const modalFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function ModalFrame({
  titleId,
  className,
  onEscape,
  children
}: {
  titleId: string;
  className: string;
  onEscape?: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // L1: lock background scroll while a dialog is open so the page behind it
    // can't scroll out from under the user.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    const focusables = sheet
      ? Array.from(sheet.querySelectorAll<HTMLElement>(modalFocusableSelector)).filter((item) => item.offsetParent !== null || item.dataset.autofocus === "true")
      : [];
    const target = focusables.find((item) => item.dataset.autofocus === "true") ?? focusables[0] ?? sheet;
    window.setTimeout(() => target?.focus(), 0);
    return () => {
      if (previousFocus && document.contains(previousFocus)) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function focusablesFor(sheet: HTMLElement) {
      return Array.from(sheet.querySelectorAll<HTMLElement>(modalFocusableSelector)).filter(
        (item) => item.offsetParent !== null || item.dataset.autofocus === "true" || item === document.activeElement
      );
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (event.key === "Escape" && onEscape) {
        event.preventDefault();
        event.stopPropagation();
        onEscape();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = focusablesFor(sheet);
      if (!focusables.length) {
        event.preventDefault();
        event.stopPropagation();
        sheet.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!active || !sheet.contains(active)) {
        event.preventDefault();
        event.stopPropagation();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        event.stopPropagation();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleDocumentKeyDown, true);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown, true);
  }, [onEscape]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // L1: dismiss when the backdrop itself (not the dialog) is clicked.
        if (event.target === event.currentTarget && onEscape) {
          onEscape();
        }
      }}
    >
      <section
        ref={sheetRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

// H5: single mounted host for the promise-based confirm dialog. Registers the
// module-level controller and renders a themed, focus-trapped ModalFrame.
function ConfirmHost() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    confirmController = (next) => setRequest(next);
    return () => {
      confirmController = null;
    };
  }, []);

  if (!request) return null;

  const settle = (confirmed: boolean) => {
    request.resolve(confirmed);
    setRequest(null);
  };

  return (
    <ModalFrame titleId="confirm-dialog-title" className="confirm-sheet" onEscape={() => settle(false)}>
      <h2 id="confirm-dialog-title">{localizeImperativeText("Please confirm")}</h2>
      <p className="confirm-message">{request.message}</p>
      <div className="confirm-actions">
        <button className="secondary" type="button" onClick={() => settle(false)}>
          {localizeImperativeText("Cancel")}
        </button>
        <button className="primary" type="button" data-autofocus="true" onClick={() => settle(true)}>
          {localizeImperativeText("Continue")}
        </button>
      </div>
    </ModalFrame>
  );
}

function OnboardingGuide({
  state,
  t,
  onClose,
  onLater,
  navigate,
  chooseWorkspace,
  requestConsent
}: {
  state: AppState;
  t(key: TranslationKey, values?: Record<string, string | number>): string;
  onClose(): void;
  onLater(): void;
  navigate(tab: TabKey): void;
  chooseWorkspace(): void;
  requestConsent(): void;
}) {
  const hasWorkspace = Boolean(state.workspaceMetadata?.workspaceId || state.workspace);
  const hasReferences = state.references.length > 0;
  const hasScan = state.scanTotals.runs > 0 || state.candidates.length > 0;
  const hasReviewed = state.counts.reviewed > 0;
  const safeModeReady = state.config.safeMode;
  const completed = [hasWorkspace, state.consentOnFile, hasReferences, hasScan, hasReviewed, safeModeReady].filter(Boolean).length;
  const progress = Math.round((completed / 6) * 100);

  const steps: Array<{
    title: string;
    detail: string;
    status: boolean;
    icon: typeof Gauge;
    actionLabel: string;
    action(): void;
  }> = [
    {
      title: t("onboarding.workspace.title"),
      detail: t("onboarding.workspace.detail"),
      status: hasWorkspace,
      icon: HardDrive,
      actionLabel: t("onboarding.workspace.action"),
      action: chooseWorkspace
    },
    {
      title: t("onboarding.permission.title"),
      detail: t("onboarding.permission.detail"),
      status: state.consentOnFile,
      icon: ShieldCheck,
      actionLabel: state.consentOnFile ? t("onboarding.permission.done") : t("onboarding.permission.action"),
      action: state.consentOnFile ? () => navigate("enroll") : requestConsent
    },
    {
      title: t("onboarding.person.title"),
      detail: t("onboarding.person.detail"),
      status: hasReferences,
      icon: UserPlus,
      actionLabel: t("onboarding.person.action"),
      action: () => navigate("enroll")
    },
    {
      title: t("onboarding.scan.title"),
      detail: t("onboarding.scan.detail"),
      status: hasScan,
      icon: Search,
      actionLabel: t("onboarding.scan.action"),
      action: () => navigate("scan")
    },
    {
      title: t("onboarding.review.title"),
      detail: t("onboarding.review.detail"),
      status: hasReviewed,
      icon: Eye,
      actionLabel: t("onboarding.review.action"),
      action: () => navigate("review")
    },
    {
      title: t("onboarding.safe.title"),
      detail: t("onboarding.safe.detail"),
      status: safeModeReady,
      icon: Settings,
      actionLabel: t("onboarding.safe.action"),
      action: () => navigate("settings")
    }
  ];

  const firstIncomplete = steps.find((step) => !step.status) ?? steps[2];

  return (
    <ModalFrame titleId="onboarding-title" className="onboarding-sheet" onEscape={onLater}>
        <div className="onboarding-hero">
          <div className="onboarding-mark">
            <BookOpen size={24} />
          </div>
          <div>
            <small>{t("onboarding.eyebrow")}</small>
            <h2 id="onboarding-title">{t("onboarding.title")}</h2>
            <p>{t("onboarding.body")}</p>
          </div>
        </div>

        <div className="onboarding-progress" aria-label={t("onboarding.progress", { progress })}>
          <div>
            <strong>{t("onboarding.ready", { completed })}</strong>
            <span>{t("onboarding.complete", { progress })}</span>
          </div>
          <meter min={0} max={100} value={progress} />
        </div>

        <div className="onboarding-steps">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <button key={step.title} className={step.status ? "onboarding-step done" : "onboarding-step"} onClick={step.action} type="button">
                <span className="step-icon">{step.status ? <Check size={17} /> : <Icon size={17} />}</span>
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.detail}</small>
                </span>
                <span className="step-action">{step.actionLabel}</span>
              </button>
            );
          })}
        </div>

        <div className="onboarding-guardrails">
          <span><ShieldCheck size={15} /> {t("onboarding.guard.permission")}</span>
          <span><EyeOff size={15} /> {t("onboarding.guard.safe")}</span>
          <span><Database size={15} /> {t("onboarding.guard.local")}</span>
        </div>

        <div className="button-row onboarding-actions">
          <button className="secondary" onClick={onLater} type="button">{t("onboarding.later")}</button>
          <button className="secondary" onClick={onClose} type="button">{t("onboarding.done")}</button>
          <button className="primary" onClick={firstIncomplete.action} type="button" data-autofocus="true">
            <ChevronRight size={16} />
            <span>{t("onboarding.continue")}</span>
          </button>
        </div>
    </ModalFrame>
  );
}

function ConsentSheet({
  scope,
  t,
  onCancel,
  onConfirm
}: {
  scope: string;
  t(key: TranslationKey, values?: Record<string, string | number>): string;
  onCancel(): void;
  onConfirm(note: string): void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <ModalFrame titleId="consent-title" className="consent-sheet" onEscape={onCancel}>
        <div className="panel-title">
          <ShieldCheck size={18} />
          <span id="consent-title">{t("consent.title")}</span>
        </div>
        <div className="consent-scope">
          <small>{t("consent.scope")}</small>
          <strong title={scope}>{scope}</strong>
        </div>
        <p className="compact">{t("consent.body")}</p>
        <label>{t("consent.note")}
          <textarea
            aria-label={t("consent.note")}
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder={t("consent.notePlaceholder")}
            maxLength={800}
          />
        </label>
        <div className="button-row consent-sheet-actions">
          <button className="secondary" type="button" onClick={onCancel}>
            <X size={17} />
            <span>{t("consent.cancel")}</span>
          </button>
          <button className="primary" type="button" onClick={() => void onConfirm(note.trim())}>
            <ShieldCheck size={17} />
            <span>{t("consent.confirm")}</span>
          </button>
        </div>
    </ModalFrame>
  );
}

function Dashboard({
  state,
  scanProgress,
  watchStatus,
  latencySamples,
  latencySummary,
  workspaceHealth,
  performanceChoice,
  performanceProfile,
  navigate,
  chooseWorkspace,
  runWorkspaceHealth,
  requestConsent,
  chooseModelRoot,
  downloadModel,
  modelDownloadProgress,
  updateStatus,
  mediaActionProgress,
  scanQueue,
  scanQueueRunning,
  rerunScanSource,
  cancelScan,
  pauseScan,
  resumeScan,
  localScanMarkers,
  busy
}: {
  state: AppState;
  scanProgress: ScanProgress | null;
  watchStatus: FolderWatchStatus;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  workspaceHealth: WorkspaceHealth | null;
  performanceChoice: PerformanceChoice;
  performanceProfile: PerformanceProfile;
  navigate(tab: TabKey): void;
  chooseWorkspace(): void;
  runWorkspaceHealth(): void;
  requestConsent(): void;
  chooseModelRoot(): void | Promise<void>;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  backfillModelReferences(): void | Promise<void>;
  modelDownloadProgress: ModelDownloadProgress | null;
  updateStatus: UpdateStatus | null;
  mediaActionProgress: MediaActionProgress | null;
  scanQueue: ScanQueueItem[];
  scanQueueRunning: boolean;
  rerunScanSource(run: AppState["scanHistory"][number]): void;
  cancelScan(): void;
  pauseScan(): void;
  resumeScan(): void;
  localScanMarkers: { cancelRequested: boolean; paused: boolean } | null;
  busy: boolean;
}) {
  const totals = state.scanTotals;
  const reviewCompletion = state.counts.candidates ? state.counts.reviewed / state.counts.candidates : 0;
  const matchRate = totals.processed ? (totals.matched + totals.clustered) / totals.processed : 0;
  const protectedRate = totals.processed ? totals.safeFiltered / totals.processed : 0;
  let candidateScoreTotal = 0;
  let candidateQualityTotal = 0;
  const statusCounts: Record<CandidateStatus, number> = { pending: 0, accepted: 0, rejected: 0, uncertain: 0 };
  for (const candidate of state.candidates) {
    candidateScoreTotal += candidate.score;
    candidateQualityTotal += candidate.quality;
    statusCounts[candidate.status] += 1;
  }
  let referenceQualityTotal = 0;
  for (const ref of state.references) {
    referenceQualityTotal += ref.quality;
  }
  const averageScore = state.candidates.length > 0 ? candidateScoreTotal / state.candidates.length : 0;
  const qualityItemCount = state.candidates.length + state.references.length;
  const averageQuality = qualityItemCount ? (candidateQualityTotal + referenceQualityTotal) / qualityItemCount : 0;
  const lastLatency = latencySamples[0];
  const build = state.buildInfo;
  const latestBenchmark = (state.benchmarkHistory && state.benchmarkHistory.length ? state.benchmarkHistory[0] : null) ?? null;
  const dbIntegrity = workspaceHealth?.databaseIntegrity ?? null;
  const buildLabel = build?.commit && build.commit !== "local" ? build.commit.slice(0, 12) : build?.packaged ? "packaged" : "local";
  const healthSummary = [
    {
      label: "Face model",
      value: state.modelSetup?.ready ? state.modelSetup.currentPack : "Needs setup",
      detail: state.modelSetup?.fallbackActive ? "Simple matching active" : state.engine,
      ok: Boolean(state.modelSetup?.ready) && !state.modelSetup?.fallbackActive
    },
    {
      label: "Database",
      value: dbIntegrity ? (dbIntegrity.ok ? "Healthy" : "Repair needed") : "Not checked",
      detail: dbIntegrity ? formatBytes(dbIntegrity.dbBytes + dbIntegrity.walBytes + dbIntegrity.shmBytes) : "Run health check",
      ok: dbIntegrity ? Boolean(dbIntegrity.ok) : null
    },
    {
      label: "Storage",
      value: latestBenchmark?.storageIo?.ok ? `${Math.round(latestBenchmark.storageIo.writeMBps)} MB/s write` : "Not measured",
      detail: latestBenchmark?.storageIo?.ok ? `${Math.round(latestBenchmark.storageIo.readMBps)} MB/s read` : "Run benchmark",
      ok: latestBenchmark?.storageIo ? Boolean(latestBenchmark.storageIo.ok) : null
    },
    {
      label: "Review load",
      value: `${formatNumber(state.counts.pending)} pending`,
      detail: state.counts.candidates ? `${formatNumber(state.counts.candidates)} total matches` : "No queue yet",
      ok: state.counts.pending === 0
    },
    {
      label: "Build",
      value: `${build?.version ?? state.version} ${buildLabel}`,
      detail: build?.channel ? `${build.channel} channel` : "local channel",
      ok: true
    }
  ];
  const allReferencesByPerson = Object.entries(
    state.references.reduce<Record<string, { count: number; buckets: Set<string>; quality: number }>>((people, ref) => {
      const current = people[ref.personName] ?? { count: 0, buckets: new Set<string>(), quality: 0 };
      current.count += 1;
      current.buckets.add(ref.ageBucket);
      current.quality += ref.quality;
      people[ref.personName] = current;
      return people;
    }, {})
  )
    .map(([person, value]) => ({ person, count: value.count, buckets: Array.from(value.buckets), quality: value.quality / value.count }))
    .sort((a, b) => b.count - a.count || a.person.localeCompare(b.person));
  const referencesByPerson = allReferencesByPerson.slice(0, 6);
  const recentCandidates = topRecentCandidates(state.candidates, 5);
  const readiness = [
    { label: "Permission", ok: state.consentOnFile, value: state.consentOnFile ? "Set" : "Needed" },
    { label: "People", ok: state.references.length > 0, value: `${state.references.length}` },
    { label: "Safe Mode", ok: state.config.safeMode, value: state.config.safeMode ? "On" : "Off" },
    { label: "Folder watch", ok: watchStatus.active, value: watchStatus.active ? "Watching" : "Idle" }
  ];
  const metrics = [
    { label: "Needs review", value: formatNumber(state.counts.pending), detail: `${formatRate(reviewCompletion)} reviewed`, tone: "amber" },
    { label: "Files scanned", value: formatNumber(totals.processed), detail: `${formatNumber(totals.runs)} scans`, tone: "blue" },
    { label: "Video frames", value: formatNumber(totals.videoFrames ?? 0), detail: `${formatNumber(totals.videoFiles ?? 0)} video files`, tone: "blue" },
    { label: "Hard-angle checks", value: formatNumber(totals.poseReranked ?? 0), detail: `${formatNumber(totals.poseAmbiguous ?? 0)} close identity scores`, tone: (totals.poseAmbiguous ?? 0) ? "amber" : "blue" },
    { label: "Possible matches", value: formatNumber(totals.added), detail: `${formatRate(matchRate)} search yield`, tone: "green" },
    { label: "Private photos protected", value: formatNumber(totals.safeFiltered), detail: `${formatRate(protectedRate)} kept out`, tone: "rose" },
    { label: "Match strength", value: scoreLabel(averageScore), detail: `${percent(averageQuality)} photo quality`, tone: toneFor(averageScore) },
    { label: "Command p95", value: latencySummary.count ? formatDuration(latencySummary.p95) : "Live", detail: lastLatency ? `${lastLatency.label}: ${formatDuration(lastLatency.durationMs)}` : `Budget ${formatDuration(performanceProfile.slowCommandMs)}`, tone: latencySummary.p95 > performanceProfile.slowCommandMs ? "amber" : "blue" },
    { label: "Perf mode", value: performanceChoice === "auto" ? `Auto: ${performanceProfile.label}` : performanceProfile.label, detail: `${performanceProfile.reviewBatchSize} review rows per batch`, tone: performanceProfile.showListThumbnails ? "green" : "blue" },
    { label: "Last scan", value: totals.lastCompletedAt ? formatDateTime(totals.lastCompletedAt) : "None", detail: `${formatDuration(totals.durationMs)} total runtime`, tone: "neutral" }
  ];
  const heroVisualStyle = {
    "--review-progress": `${Math.round(reviewCompletion * 100)}%`,
    "--match-progress": `${Math.round(matchRate * 100)}%`,
    "--protect-progress": `${Math.round(protectedRate * 100)}%`
  } as CSSProperties;
  const singleBucketPeople = allReferencesByPerson.filter((person) => person.buckets.length < 2).length;
  const rankedUseCases: Array<{ rank: number; label: string; status: string; tab: TabKey; tone: "green" | "amber" | "rose" | "blue" }> = [
    {
      rank: 1,
      label: "Finish first-scan setup",
      status: state.consentOnFile && state.references.length ? "Ready to scan" : "Permission and people first",
      tab: state.references.length ? "scan" : "enroll",
      tone: state.consentOnFile && state.references.length ? "green" : "amber"
    },
    {
      rank: 2,
      label: "Check the folder",
      status: totals.errors ? `${totals.errors} file issue${totals.errors === 1 ? "" : "s"} found` : totals.runs ? "Recent scans clean" : "Check before a big scan",
      tab: "scan",
      tone: totals.errors ? "rose" : totals.runs ? "green" : "amber"
    },
    {
      rank: 3,
      label: "Keep new photos flowing",
      status: watchStatus.active ? "Watching a folder" : totals.runs ? "Manual scan mode" : "Start with scan or watch",
      tab: "scan",
      tone: watchStatus.active ? "green" : "blue"
    },
    {
      rank: 4,
      label: "Review possible matches",
      status: state.counts.pending ? `${state.counts.pending} decision${state.counts.pending === 1 ? "" : "s"} needed` : "All reviewed",
      tab: "review",
      tone: state.counts.pending ? "amber" : "green"
    },
    {
      rank: 5,
      label: "Find people together",
      status: state.counts.candidates ? "People-together search ready" : "Scan first",
      tab: "review",
      tone: state.counts.candidates ? "blue" : "amber"
    },
    {
      rank: 6,
      label: "Add photos from more ages",
      status: singleBucketPeople ? `${singleBucketPeople} person${singleBucketPeople === 1 ? "" : "s"} could use more ages` : "Age coverage looks good",
      tab: "enroll",
      tone: singleBucketPeople ? "amber" : "green"
    },
    {
      rank: 7,
      label: "Save or clean up results",
      status: statusCounts.accepted + statusCounts.rejected + statusCounts.uncertain ? `${statusCounts.accepted + statusCounts.rejected + statusCounts.uncertain} reviewed item${statusCounts.accepted + statusCounts.rejected + statusCounts.uncertain === 1 ? "" : "s"}` : "Nothing reviewed yet",
      tab: "settings",
      tone: state.counts.candidates ? "blue" : "amber"
    }
  ];
  return (
    <section className="dashboard-page">
      <div className="panel dashboard-hero">
        <div>
          <span className="section-kicker">Home</span>
          <h1>{state.references.length ? state.scanTotals.runs ? "Review possible matches" : "Ready for your first scan" : "Start with a person"}</h1>
          <p>
            {state.counts.pending
              ? `${state.counts.pending} possible match${state.counts.pending === 1 ? "" : "es"} need your decision.`
              : state.counts.candidates
                ? "All possible matches have decisions."
                : "Add photos of a person, scan a folder, and review what Vintrace finds."}
          </p>
        </div>
        <div className="dashboard-visual" style={heroVisualStyle} aria-hidden="true">
          <span className="visual-orbit review" />
          <span className="visual-orbit match" />
          <span className="visual-orbit protect" />
          <i />
        </div>
        <div className="dashboard-actions">
          <button className="secondary" onClick={() => navigate("scan")}>
            <ScanLine size={17} />
            <span>Scan</span>
          </button>
          <button className="secondary" onClick={() => navigate("review")} disabled={!state.counts.candidates}>
            <ShieldCheck size={17} />
            <span>Review matches</span>
          </button>
          <button className="secondary" onClick={() => navigate("enroll")}>
            <UserPlus size={17} />
            <span>Add person</span>
          </button>
        </div>
        <div className="readiness-strip">
          {readiness.map((item) => (
            <span className={item.ok ? "readiness-pill ok" : "readiness-pill warn"} key={item.label}>
              <Check size={14} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </span>
          ))}
        </div>
      </div>

      <FirstScanGuide state={state} watchStatus={watchStatus} navigate={navigate} chooseWorkspace={chooseWorkspace} requestConsent={requestConsent} />

      <TesterModePanel
        state={state}
        navigate={navigate}
        requestConsent={requestConsent}
        downloadModel={downloadModel}
        modelDownloadProgress={modelDownloadProgress}
        busy={busy}
      />

      <ModelSetupCard
        state={state}
        progress={modelDownloadProgress}
        busy={busy}
        chooseModelRoot={chooseModelRoot}
        downloadModel={downloadModel}
      />

      <BackgroundJobCenter
        state={state}
        scanProgress={scanProgress}
        watchStatus={watchStatus}
        modelDownloadProgress={modelDownloadProgress}
        updateStatus={updateStatus}
        mediaActionProgress={mediaActionProgress}
        scanQueue={scanQueue}
        scanQueueRunning={scanQueueRunning}
        navigate={navigate}
        cancelScan={cancelScan}
        pauseScan={pauseScan}
        resumeScan={resumeScan}
        scanPaused={Boolean(state.scanJob?.paused || localScanMarkers?.paused)}
        busy={busy}
      />

      <div className="metrics dashboard-metrics">
        {metrics.map((metric) => (
          <div className="metric" key={metric.label}>
            <span>{metric.label}</span>
            <strong className={metric.tone}>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>

      <div className="panel dashboard-span">
        <div className="panel-title"><Activity size={18} /> Health summary</div>
        <div className="workspace-health-grid">
          {healthSummary.map((item) => (
            <span key={item.label} className={item.ok === false ? "warn" : item.ok === true ? "ok" : ""}>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
              <em>{item.detail}</em>
            </span>
          ))}
        </div>
        <div className="button-row">
          <button className="secondary" onClick={runWorkspaceHealth} disabled={busy}>
            <Database size={17} />
            <span>Check health</span>
          </button>
          <button className="secondary" onClick={() => navigate("settings")}>
            <Gauge size={17} />
            <span>Open diagnostics</span>
          </button>
        </div>
      </div>

      <div className="panel dashboard-rankings">
        <div className="panel-title"><Gauge size={18} /> Top 7 current priorities</div>
        <div className="ranked-list">
          {rankedUseCases.map((item) => (
            <button key={item.rank} className="ranked-row" onClick={() => navigate(item.tab)}>
              <span className={`rank-badge ${item.tone}`}>{item.rank}</span>
              <strong>{item.label}</strong>
              <small>{item.status}</small>
              <ChevronRight size={16} />
            </button>
          ))}
        </div>
      </div>

      <div className="panel dashboard-span">
        <div className="panel-title"><Activity size={18} /> Live scan stream</div>
        <ScanActivity progress={scanProgress} watchStatus={watchStatus} cancelScan={cancelScan} pauseScan={pauseScan} resumeScan={resumeScan} scanPaused={Boolean(state.scanJob?.paused || localScanMarkers?.paused)} />
      </div>

      <div className="panel">
        <div className="panel-title"><Archive size={18} /> Recent scan runs</div>
        <div className="dashboard-list">
          {state.scanHistory.length ? (
            state.scanHistory.slice(0, 6).map((run) => (
              <div className="scan-run-row" key={run.runId}>
                <div>
                  <strong>{basename(run.label) || run.source}</strong>
                  <span>{run.source} • {formatDateTime(run.completedAt)} • {formatDuration(run.durationMs)}</span>
                </div>
                <div className="run-metrics">
                  <span>{run.metrics.processed} scanned</span>
                  <span>{run.metrics.added} matches</span>
                  <span>{run.metrics.safeFiltered} protected</span>
                </div>
                <button className="ghost compact-action" onClick={() => rerunScanSource(run)} disabled={busy}>
                  <RefreshCcw size={15} />
                  <span>Rerun</span>
                </button>
              </div>
            ))
          ) : (
            <div className="empty compact-empty">No scan history yet.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><Crosshair size={18} /> Review mix</div>
        <div className="review-bars">
          {reviewStatuses.concat("pending").map((status) => {
            const count = statusCounts[status];
            const width = state.counts.candidates ? (count / state.counts.candidates) * 100 : 0;
            return (
              <div className="review-bar-row" key={status}>
                <span>{reviewStatusLabel(status)}</span>
                <div><i style={{ width: `${width}%` }} /></div>
                <strong>{count}</strong>
              </div>
            );
          })}
        </div>
        <div className="candidate-feed">
          {recentCandidates.map((candidate) => (
            <div className="candidate-feed-row" key={candidate.candidateId}>
              <span className={`status ${candidate.status}`}>{reviewStatusLabel(candidate.status)}</span>
              <strong>{candidate.personName}</strong>
              <small>{scoreLabel(candidate.score)} • {candidateSourceLabel(candidate)}</small>
            </div>
          ))}
          {!recentCandidates.length && <div className="empty compact-empty">No possible matches yet.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><UserPlus size={18} /> People added</div>
        <div className="coverage-list">
          {referencesByPerson.length ? (
            referencesByPerson.map((person) => (
              <div className="coverage-row" key={person.person}>
                <div>
                  <strong>{person.person}</strong>
                  <span>{person.buckets.join(", ")}</span>
                </div>
                <span>{person.count} photos</span>
                <span>{percent(person.quality)} quality</span>
              </div>
            ))
          ) : (
            <div className="empty compact-empty">No people added yet.</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-title"><Database size={18} /> System and safety</div>
        <dl className="detail-list dashboard-detail-list">
          <dt>Stack</dt><dd>{providerSummary(state)}</dd>
          <dt>Platform</dt><dd>{platformLabel(state)}</dd>
          <dt>Provider</dt><dd>{state.platform.primary_provider}</dd>
          <dt>Engine</dt><dd title={state.engine}>{engineLabel(state.engine)}</dd>
          <dt>Precision</dt><dd>{state.platform.precision}</dd>
          <dt>Acceleration</dt><dd>{state.platform.accelerator_status}</dd>
          <dt>Search index</dt><dd>{state.platform.vector_backend || state.vectorStore}</dd>
          <dt>Face scan detail</dt><dd>{state.config.faceDetectorSize}</dd>
          <dt>High-detail recheck</dt><dd>{state.config.twoPassScan ? `${state.config.verificationDetectorSize}` : "Off"}</dd>
          <dt>Permission</dt><dd>{state.config.requireConsent ? "Required" : "Optional"}</dd>
          <dt>Safe Mode sensitivity</dt><dd>{state.config.safeModeThreshold.toFixed(2)}</dd>
        </dl>
        {state.platform.platform_notes.length > 0 && (
          <div className="platform-notes">
            {state.platform.platform_notes.map((note) => <span key={note}>{note}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}

function TesterModePanel({
  state,
  navigate,
  requestConsent,
  downloadModel,
  modelDownloadProgress,
  busy
}: {
  state: AppState;
  navigate(tab: TabKey): void;
  requestConsent(): void;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  modelDownloadProgress: ModelDownloadProgress | null;
  busy: boolean;
}) {
  const modelReady = Boolean(state.modelSetup?.ready) && !state.modelSetup?.fallbackActive;
  const modelPack = state.modelSetup?.currentPack || state.modelSetup?.packages?.[0]?.pack || "antelopev2";
  const modelRoot = state.modelSetup?.modelRoot || state.config.modelRoot || undefined;
  const modelBusy = Boolean(modelDownloadProgress && !["complete", "error"].includes(modelDownloadProgress.phase));
  const steps = [
    {
      label: "Face model",
      value: modelReady ? "Ready" : modelBusy ? "Downloading" : "Install once",
      done: modelReady,
      action: () => void downloadModel(modelPack, modelRoot),
      actionLabel: modelReady ? "Ready" : "Install model",
      disabled: busy || modelBusy || modelReady
    },
    {
      label: "Permission",
      value: state.consentOnFile ? "Confirmed" : "Needed",
      done: state.consentOnFile,
      action: requestConsent,
      actionLabel: state.consentOnFile ? "Confirmed" : "Confirm",
      disabled: busy || state.consentOnFile
    },
    {
      label: "Person photos",
      value: state.references.length ? `${state.references.length} saved` : "Add one",
      done: state.references.length > 0,
      action: () => navigate("enroll"),
      actionLabel: "Add person",
      disabled: false
    },
    {
      label: "Camera check",
      value: "Optional",
      done: false,
      action: () => navigate("scan"),
      actionLabel: "Open camera",
      disabled: false
    },
    {
      label: "Scan folder",
      value: state.scanTotals.runs ? "Done" : "Choose folder",
      done: state.scanTotals.runs > 0 || state.candidates.length > 0,
      action: () => navigate("scan"),
      actionLabel: "Scan",
      disabled: false
    }
  ];
  const next = steps.find((step) => !step.done && !step.disabled) ?? steps[2];
  return (
    <div className="panel tester-mode-panel">
      <div className="tester-mode-copy">
        <span className="section-kicker">Friend test mode</span>
        <h2>Simple setup for a first test</h2>
        <p>Use this path when sharing Vintrace with someone who only needs to install, add a person, scan a folder, and review results.</p>
      </div>
      <div className="tester-mode-steps">
        {steps.map((step) => (
          <button key={step.label} className={step.done ? "tester-step done" : "tester-step"} onClick={step.action} disabled={step.disabled} type="button">
            <span>{step.done ? <Check size={15} /> : <ChevronRight size={15} />}</span>
            <strong>{step.label}</strong>
            <small>{step.value}</small>
            <em>{step.actionLabel}</em>
          </button>
        ))}
      </div>
      <div className="tester-mode-note">
        <ShieldCheck size={16} />
        <span>Vintrace will not change original photos during scan. It stores review data locally and waits for manual decisions.</span>
      </div>
      <button className="primary tester-mode-next" onClick={next.action} disabled={next.disabled} type="button">
        <ChevronRight size={16} />
        <span>{next.actionLabel}</span>
      </button>
    </div>
  );
}

function FirstScanGuide({
  state,
  watchStatus,
  navigate,
  chooseWorkspace,
  requestConsent
}: {
  state: AppState;
  watchStatus: FolderWatchStatus;
  navigate(tab: TabKey): void;
  chooseWorkspace(): void;
  requestConsent(): void;
}) {
  const steps: Array<{
    number: string;
    title: string;
    detail: string;
    done: boolean;
    actionLabel: string;
    action(): void;
  }> = [
    {
      number: "1",
      title: "Choose where Vintrace saves its work",
      detail: "This folder stores saved people, possible matches, notes, exports, and backups.",
      done: Boolean(state.workspaceMetadata?.workspaceId || state.workspace),
      actionLabel: "Choose folder",
      action: chooseWorkspace
    },
    {
      number: "2",
      title: "Confirm you have permission",
      detail: "Scanning is paused until you confirm the people and photos are OK to process.",
      done: state.consentOnFile,
      actionLabel: "Confirm",
      action: requestConsent
    },
    {
      number: "3",
      title: "Add the person you want to find",
      detail: "Use clear photos. Adding different ages helps when the person looks different over time.",
      done: state.references.length > 0,
      actionLabel: "Add person",
      action: () => navigate("enroll")
    },
    {
      number: "4",
      title: "Scan photos or videos",
      detail: watchStatus.active ? "Vintrace is watching a folder for new files." : "Choose a folder, check it, then start the scan.",
      done: state.scanTotals.runs > 0 || state.candidates.length > 0,
      actionLabel: "Scan folder",
      action: () => navigate("scan")
    },
    {
      number: "5",
      title: "Review possible matches",
      detail: "Accept matches that look right, reject wrong ones, or mark Not sure.",
      done: state.counts.reviewed > 0,
      actionLabel: "Review matches",
      action: () => navigate("review")
    }
  ];
  const readyCount = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done) ?? steps[3];
  return (
    <div className="panel first-scan-guide">
      <div className="first-scan-copy">
        <span className="section-kicker">Start here</span>
        <h2>First scan checklist</h2>
        <p>Follow these steps once. After that, you can scan, watch folders, add more people, and review matches in any order.</p>
      </div>
      <div className="first-scan-progress" aria-label={`${readyCount} of ${steps.length} first scan steps complete`}>
        <strong>{readyCount}/{steps.length}</strong>
        <span>ready</span>
      </div>
      <div className="first-scan-steps">
        {steps.map((step) => (
          <button key={step.number} className={step.done ? "first-scan-step done" : "first-scan-step"} onClick={step.action} type="button">
            <span>{step.done ? <Check size={15} /> : step.number}</span>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </button>
        ))}
      </div>
      <button className="primary first-scan-next" onClick={nextStep.action} type="button">
        <ChevronRight size={16} />
        <span>{nextStep.actionLabel}</span>
      </button>
    </div>
  );
}

function ModelSwitchWizard({
  state,
  settings,
  modelPackages,
  modelCompatibility,
  modelDownloadProgress,
  modelDriftReport,
  referenceGapReport,
  busy,
  validationBlocked,
  setModelPack,
  saveSettings,
  downloadModel,
  backfillModelReferences,
  dryRunPlan,
  runDryRun,
  runModelDriftReport,
  runReferenceGapReport
}: {
  state: AppState;
  settings: SettingsDraft;
  modelPackages: NonNullable<AppState["modelSetup"]>["packages"];
  modelCompatibility: ModelCompatibilityReport | null | undefined;
  modelDownloadProgress: ModelDownloadProgress | null;
  modelDriftReport: ModelDriftReport | null;
  referenceGapReport: ReferenceGapReport | null;
  busy: boolean;
  validationBlocked: boolean;
  setModelPack(value: string): void;
  saveSettings(): void;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  backfillModelReferences(): void | Promise<void>;
  dryRunPlan: ModelSwitchDryRun | null;
  runDryRun(targetPack?: string): void | Promise<ModelSwitchDryRun | null>;
  runModelDriftReport(): void | Promise<void>;
  runReferenceGapReport(): void | Promise<void>;
}) {
  const currentPack = state.config.modelPack || state.modelSetup?.currentPack || "antelopev2";
  const targetPack = settings.modelPack || currentPack;
  const currentPackage = modelPackages.find((item) => item.pack === currentPack);
  const targetPackage = modelPackages.find((item) => item.pack === targetPack);
  const stagedSwitch = targetPack !== currentPack;
  const hasReferences = state.counts.references > 0;
  const targetInstalled = Boolean(targetPackage?.available || (state.modelSetup?.ready && state.modelSetup.currentPack === targetPack));
  const targetDownloading = Boolean(
    modelDownloadProgress?.pack === targetPack
    && !["complete", "error"].includes(String(modelDownloadProgress.phase))
  );
  const needsBackfill = !stagedSwitch && Boolean(modelCompatibility?.needsBackfill);
  const totalReferences = stagedSwitch ? state.counts.references : modelCompatibility?.totalReferences ?? state.counts.references;
  const compatibleReferences = stagedSwitch ? 0 : modelCompatibility?.compatibleReferences ?? 0;
  const backfillCount = stagedSwitch && hasReferences
    ? state.counts.references
    : needsBackfill
      ? modelCompatibility?.otherModelReferences ?? 0
      : 0;
  const staleReferences = modelDriftReport?.counts.staleReferences ?? null;
  const staleCandidates = modelDriftReport?.counts.staleCandidates ?? null;
  const referenceGaps = referenceGapReport?.needsAttention ?? null;
  const previousPack = Object.keys(modelCompatibility?.modelCounts ?? {})
    .map(modelPackFromModelName)
    .find((pack) => pack && pack !== currentPack && modelPackages.some((item) => item.pack === pack));
  const rollbackPack = stagedSwitch ? currentPack : previousPack;
  const rollbackLabel = modelPackages.find((item) => item.pack === rollbackPack)?.label ?? rollbackPack;
  const targetLabel = targetPackage?.label ?? targetPack;
  const currentLabel = currentPackage?.label ?? currentPack;
  const validationReady = !stagedSwitch && staleReferences !== null;
  const modelRoot = state.config.modelRoot || state.modelSetup?.modelRoot || state.modelSetup?.defaultRoot || "";
  const activeDryRun = dryRunPlan?.targetPack === targetPack ? dryRunPlan : null;
  const dryRunOk = Boolean(activeDryRun && !activeDryRun.blockers.length);
  const stepItems = [
    {
      label: "Choose model",
      detail: stagedSwitch ? `${currentLabel} -> ${targetLabel}` : `${targetLabel} is active`,
      state: targetPack ? "done" : "active"
    },
    {
      label: "Install files",
      detail: targetInstalled ? "Model files are available" : targetDownloading ? `${Math.round(modelDownloadProgress?.percent ?? 0)}% downloaded` : "Download before saving",
      state: targetInstalled ? "done" : targetDownloading ? "active" : "warn"
    },
    {
      label: "Save switch",
      detail: stagedSwitch ? "Save to make this the active recognizer" : "Active recognizer is saved",
      state: stagedSwitch ? "active" : "done"
    },
    {
      label: "Backfill saved photos",
      detail: !hasReferences ? "No saved people yet" : backfillCount ? `${formatNumber(backfillCount)} saved photo${backfillCount === 1 ? "" : "s"} need embeddings` : `${formatNumber(compatibleReferences)} / ${formatNumber(totalReferences)} compatible`,
      state: backfillCount ? "warn" : "done"
    },
    {
      label: "Validate",
      detail: validationReady
        ? `${formatNumber(staleReferences ?? 0)} stale saved photo${staleReferences === 1 ? "" : "s"}${referenceGaps !== null ? `, ${formatNumber(referenceGaps)} reference gap${referenceGaps === 1 ? "" : "s"}` : ""}`
        : "Run validation after save/backfill",
      state: validationReady && (staleReferences || staleCandidates) ? "warn" : validationReady ? "done" : "active"
    }
  ];

  function validateModelState() {
    void Promise.resolve(runModelDriftReport()).then(() => Promise.resolve(runReferenceGapReport()));
  }

  return (
    <div className={stagedSwitch || needsBackfill ? "model-switch-wizard warn" : "model-switch-wizard"}>
      <div className="panel-title compact-title">
        <HardDrive size={18} />
        <span>Model switch guide</span>
        <div className="spacer" />
        <small>{stagedSwitch ? "Pending save" : needsBackfill ? "Backfill needed" : "Ready"}</small>
      </div>
      <div className="model-switch-summary">
        <span>
          <small>Current</small>
          <strong>{currentLabel}</strong>
        </span>
        <ChevronRight size={17} />
        <span>
          <small>Selected</small>
          <strong>{targetLabel}</strong>
        </span>
        <span>
          <small>Saved people</small>
          <strong>{formatNumber(totalReferences)}</strong>
        </span>
        <span>
          <small>Compatible now</small>
          <strong>{stagedSwitch ? "After save" : `${formatNumber(compatibleReferences)} / ${formatNumber(totalReferences)}`}</strong>
        </span>
      </div>
      <div className="model-switch-steps" aria-label="Model switch steps">
        {stepItems.map((step, index) => (
          <span className={`model-switch-step ${step.state}`} key={step.label}>
            <i>{index + 1}</i>
            <strong>{step.label}</strong>
            <small>{step.detail}</small>
          </span>
        ))}
      </div>
      <div className={activeDryRun?.blockers.length ? "model-dry-run-card warn" : "model-dry-run-card"}>
        <div className="panel-title compact-title">
          <Timer size={17} />
          <span>Dry run</span>
          <div className="spacer" />
          <small>{activeDryRun ? activeDryRun.summary : "Not checked"}</small>
        </div>
        {activeDryRun ? (
          <>
            <div className="model-dry-run-grid">
              <span>
                <small>Download</small>
                <strong>{activeDryRun.downloadBytes ? formatBytes(activeDryRun.downloadBytes) : "None"}</strong>
              </span>
              <span>
                <small>Disk impact</small>
                <strong>{formatBytes(activeDryRun.estimatedDiskImpactBytes)}</strong>
              </span>
              <span>
                <small>Backfill</small>
                <strong>{formatNumber(activeDryRun.referencesNeedingBackfill)}</strong>
              </span>
              <span>
                <small>ETA</small>
                <strong>{activeDryRun.estimatedBackfillSeconds ? formatDuration(activeDryRun.estimatedBackfillSeconds * 1000) : "None"}</strong>
              </span>
              <span>
                <small>Review rows</small>
                <strong>{formatNumber(activeDryRun.affectedCandidates)}</strong>
              </span>
              <span>
                <small>Save status</small>
                <strong>{activeDryRun.safeToSave ? "Safe" : "Blocked"}</strong>
              </span>
            </div>
            {activeDryRun.blockers.length ? (
              <div className="health-list error-list">
                {activeDryRun.blockers.map((item) => <span key={item}>{item}</span>)}
              </div>
            ) : null}
            {activeDryRun.warnings.length ? (
              <div className="health-list">
                {activeDryRun.warnings.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
              </div>
            ) : null}
            <div className="health-list action-list">
              {activeDryRun.actions.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
            </div>
          </>
        ) : (
          <p className="compact">Run this before saving to see download size, backfill work, review impact, and rollback target.</p>
        )}
        <button className="secondary compact-action" onClick={() => void runDryRun(targetPack)} disabled={busy || !targetPack} type="button">
          <Activity size={16} />
          <span>{activeDryRun ? "Refresh dry run" : "Run dry run"}</span>
        </button>
      </div>
      {targetPackage?.pose_aware && (
        <div className="settings-warning soft-warning">
          <Focus size={16} />
          <span>This pack is better suited for profile and three-quarter review. Keep human review on for final decisions.</span>
        </div>
      )}
      <div className="button-row">
        <button
          className="secondary"
          onClick={() => void downloadModel(targetPack, modelRoot)}
          disabled={busy || !targetPackage || targetInstalled || targetDownloading}
          type="button"
        >
          {targetDownloading ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
          <span>{targetDownloading ? "Downloading" : "Download selected model"}</span>
        </button>
        <button
          className="primary"
          onClick={saveSettings}
          disabled={busy || validationBlocked || !stagedSwitch || !targetInstalled || (activeDryRun ? !dryRunOk : false)}
          type="button"
        >
          <Save size={17} />
          <span>Save model choice</span>
        </button>
        <button
          className="secondary"
          onClick={() => void backfillModelReferences()}
          disabled={busy || stagedSwitch || !needsBackfill || !state.modelSetup?.ready}
          type="button"
        >
          <RefreshCcw size={17} />
          <span>Backfill saved photos</span>
        </button>
        <button className="secondary" onClick={validateModelState} disabled={busy || stagedSwitch} type="button">
          <Activity size={17} />
          <span>Validate switch</span>
        </button>
        {rollbackPack && (
          <button className="ghost compact-action" onClick={() => setModelPack(rollbackPack)} disabled={busy} type="button">
            <Undo2 size={16} />
            <span>{stagedSwitch ? "Undo selection" : `Prepare rollback to ${rollbackLabel}`}</span>
          </button>
        )}
      </div>
      {!targetInstalled && (
        <small className="compact">Saving is disabled until the selected model files are installed. This avoids a switch that cannot run offline.</small>
      )}
    </div>
  );
}

function ModelSetupCard({
  state,
  progress,
  busy,
  chooseModelRoot,
  downloadModel
}: {
  state: AppState;
  progress: ModelDownloadProgress | null;
  busy: boolean;
  chooseModelRoot(): void | Promise<void>;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
}) {
  const setup = state.modelSetup;
  const packages = setup?.packages ?? [];
  const initialPack = setup?.currentPack || packages[0]?.pack || "antelopev2";
  const [selectedPack, setSelectedPack] = useState(initialPack);

  useEffect(() => {
    setSelectedPack(setup?.currentPack || packages[0]?.pack || "antelopev2");
  }, [packages, setup?.currentPack]);

  const selected = packages.find((item) => item.pack === selectedPack) ?? packages[0];
  const governance = selected?.governance ?? setup?.governance;
  const ready = Boolean(setup?.ready) && !setup?.fallbackActive;
  const downloading = Boolean(progress && progress.phase !== "complete" && progress.phase !== "error");
  const percentValue = progress ? Math.max(0, Math.min(100, progress.percent || (progress.totalBytes ? (progress.downloadedBytes / progress.totalBytes) * 100 : 0))) : 0;
  const root = setup?.modelRoot || state.config.modelRoot || "";
  const statusLabel = ready
    ? "Full face model ready"
    : progress?.phase === "error"
      ? "Download needs attention"
      : downloading
        ? "Installing face model"
        : "Face model needed";
  const statusTone = ready ? "green" : progress?.phase === "error" ? "rose" : downloading ? "blue" : "amber";

  return (
    <div className={ready ? "panel model-setup-card ready" : "panel model-setup-card"}>
      <div className="model-setup-head">
        <div>
          <span className="section-kicker">Face model</span>
          <h2>{statusLabel}</h2>
          <p>
            {ready
              ? "Vintrace is using a local face model. Downloads are verified before install and stay on this device."
              : "Install a local face model once so shared DMG and EXE builds can run the full matching pipeline after first launch."}
          </p>
        </div>
        <span className={`model-state ${statusTone}`}>{ready ? "Ready" : downloading ? `${Math.round(percentValue)}%` : "Setup"}</span>
      </div>

      <div className="model-setup-grid">
        <label>Model package
          <select value={selectedPack} onChange={(event) => setSelectedPack(event.currentTarget.value)} disabled={downloading || busy}>
            {packages.length ? packages.map((item) => (
              <option key={item.pack} value={item.pack}>{item.label} ({formatBytes(item.size_bytes)})</option>
            )) : <option value="antelopev2">Recommended accuracy</option>}
          </select>
        </label>
        <label>Download folder
          <input value={root} readOnly title={root} aria-label="Model download folder" />
        </label>
      </div>

      {selected && (
        <div className="model-package-detail">
          <span><strong>{selected.detail}</strong></span>
          <span>Download: {formatBytes(selected.size_bytes)}</span>
          <span>Checksum: SHA-256</span>
          <span>{selected.available ? "Installed" : selected.missing.slice(0, 1).join(", ") || "Ready to download"}</span>
          {selected.pose_aware && <span>Pose-aware: profile and three-quarter checks</span>}
          {selected.thresholds && <span>Suggested likely threshold: {percent(selected.thresholds.likely ?? selected.thresholds.review ?? 0)}</span>}
          {governance && <span>Use: {governance.humanReviewRequired ? "Review-assisted" : "Automated"} • {governance.accuracyTier}</span>}
          {governance && <span>Release: {governance.redistributionRisk === "needs-license-review" ? "License review needed" : governance.redistributionRisk}</span>}
        </div>
      )}

      {governance && (
        <div className="health-list model-governance-list">
          <span>{governance.intendedUse}</span>
          {governance.limitations.slice(0, 2).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          {governance.validation.slice(0, 1).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
        </div>
      )}

      {progress && (
        <div className={progress.phase === "error" ? "model-progress error" : "model-progress"}>
          <div>
            <strong>{progress.message || progress.phase}</strong>
            <span>{formatBytes(progress.downloadedBytes)} / {progress.totalBytes ? formatBytes(progress.totalBytes) : "calculating"}</span>
          </div>
          <progress max={100} value={percentValue} />
        </div>
      )}

      {!ready && !downloading && (
        <div className="model-offline-note">
          <AlertCircle size={16} />
          <span>{localizeImperativeText(setup?.offlineMessage || "Internet is needed once for the face model. If you are offline, the app can open in simple matching mode and retry later.")}</span>
        </div>
      )}

      <div className="button-row model-setup-actions">
        <button className="secondary" onClick={() => void chooseModelRoot()} disabled={busy || downloading} type="button">
          <FolderOpen size={17} />
          <span>Choose folder</span>
        </button>
        <button className="primary" onClick={() => void downloadModel(selectedPack, root)} disabled={busy || downloading || !selectedPack} type="button">
          {downloading ? <Loader2 className="spin" size={17} /> : <DownloadIcon />}
          <span>{progress?.phase === "error" ? "Retry download" : ready ? "Download again" : "Download model"}</span>
        </button>
        {progress?.phase === "error" && (
          <button className="secondary" onClick={() => void downloadModel(selectedPack, root, true)} disabled={busy || downloading} type="button">
            <RefreshCcw size={17} />
            <span>Force retry</span>
          </button>
        )}
      </div>
    </div>
  );
}

function DownloadIcon() {
  return <Archive size={17} />;
}

function EnrollView(props: {
  state: AppState;
  personName: string;
  setPersonName(value: string): void;
  ageBucket: AgeBucket;
  setAgeBucket(value: AgeBucket): void;
  enrollFolder: string;
  setEnrollFolder(value: string): void;
  ageGroupFolders: AgeFolderMap;
  setAgeGroupFolder(ageBucket: AgeBucket, folder: string): void;
  chooseAgeGroupFolder(ageBucket: AgeBucket): void;
  chooseFolder(): void;
  enroll(): void;
  enrollAgeGroups(): void;
  disabled: boolean;
  ageGroupDisabled: boolean;
  selectedRefId: string | null;
  setSelectedRefId(value: string): void;
  deleteReference(): void;
  clearReferences(): void;
  busy: boolean;
}) {
  return (
    <section className="split-page">
      <div className="panel form-panel">
        <div className="panel-title"><UserPlus size={18} /> Add a person to find</div>
        <p className="compact">Add a few clear photos of one person. Vintrace saves these as the example photos it compares against during scans.</p>
        <label>Person name<input aria-label="Person name" placeholder="Name shown in results" value={props.personName} onChange={(event) => props.setPersonName(event.currentTarget.value)} /></label>
        <label>Age range in these photos
          <select value={props.ageBucket} onChange={(event) => props.setAgeBucket(event.currentTarget.value as AgeBucket)}>
            {ageBuckets.map((bucket) => <option key={bucket} value={bucket}>{ageBucketLabel(bucket)}</option>)}
          </select>
        </label>
        <div className="field">
          <label htmlFor="enroll-folder">Folder with this person's photos</label>
          <div className="path-input">
            <input id="enroll-folder" aria-label="Person photo folder" title={props.enrollFolder} value={props.enrollFolder} onChange={(event) => props.setEnrollFolder(event.currentTarget.value)} />
            <button className="icon-button" onClick={props.chooseFolder} disabled={props.busy} title="Choose folder" aria-label="Choose person photo folder"><FolderOpen size={17} /></button>
          </div>
        </div>
        <button className="primary" onClick={props.enroll} disabled={props.disabled}>
          {props.busy ? <Loader2 className="spin" size={17} /> : <UserPlus size={17} />}
          <span>Add photos</span>
        </button>
        <div className="age-set">
          <div className="section-kicker">Optional: add different ages</div>
          <p className="compact">Use this when you have separate folders from childhood, teen years, and adulthood.</p>
          {referenceAgeBuckets.map((bucket) => (
            <div className="age-folder-row" key={bucket}>
              <label htmlFor={`age-folder-${bucket}`}>{ageBucketLabel(bucket)}</label>
              <div className="path-input">
                <input
                  id={`age-folder-${bucket}`}
                  aria-label={`${ageBucketLabel(bucket)} photo folder`}
                  title={props.ageGroupFolders[bucket]}
                  value={props.ageGroupFolders[bucket]}
                  onChange={(event) => props.setAgeGroupFolder(bucket, event.currentTarget.value)}
                />
                <button
                  className="icon-button"
                  onClick={() => props.chooseAgeGroupFolder(bucket)}
                  disabled={props.busy}
                  title={`Choose ${ageBucketLabel(bucket).toLowerCase()} photo folder`}
                  aria-label={`Choose ${ageBucketLabel(bucket)} photo folder`}
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </div>
          ))}
          <button className="secondary" onClick={props.enrollAgeGroups} disabled={props.ageGroupDisabled}>
            {props.busy ? <Loader2 className="spin" size={17} /> : <Archive size={17} />}
            <span>Add age folders</span>
          </button>
        </div>
        <ReferenceCoverageCoach references={props.state.references} />
      </div>
      <div className="panel table-panel">
        <div className="panel-title">
          <Archive size={18} /> Saved face photos
          <span className="title-count">{props.state.references.length}</span>
          <div className="spacer" />
          <button className="ghost danger compact-action" onClick={props.deleteReference} disabled={!props.selectedRefId || props.busy} title="Delete selected saved photo" aria-label="Delete selected saved photo"><Trash2 size={16} /><span>Delete</span></button>
          <button className="ghost danger compact-action" onClick={props.clearReferences} disabled={!props.state.references.length || props.busy} title="Clear saved face photos" aria-label="Clear saved face photos"><X size={16} /><span>Clear</span></button>
        </div>
        <div className="table">
          {props.state.references.length === 0 ? <EmptyState icon={Archive} label="No people added yet" detail="Add a folder of face photos before scanning." /> : (
            <>
              <TableHeader columns={["Person", "Photo quality", "File"]} kind="reference" />
              {props.state.references.map((ref) => (
            <button key={ref.refId} className={props.selectedRefId === ref.refId ? "row reference-row selected" : "row reference-row"} onClick={() => props.setSelectedRefId(ref.refId)}>
              <span><strong>{ref.personName}</strong><small>{ageBucketLabel(ref.ageBucket)}</small></span>
              <span aria-label={`quality ${scoreLabel(ref.quality)}`}>{scoreLabel(ref.quality)}</span>
              <span title={ref.sourcePath}>{basename(ref.sourcePath)}</span>
              <ChevronRight size={16} />
            </button>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function ReferenceCoverageCoach({ references }: { references: AppState["references"] }) {
  const rows = Object.entries(
    references.reduce<Record<string, Record<AgeBucket, { count: number; quality: number }>>>((people, ref) => {
      people[ref.personName] ??= {
        child: { count: 0, quality: 0 },
        adolescent: { count: 0, quality: 0 },
        adult: { count: 0, quality: 0 },
        unknown: { count: 0, quality: 0 }
      };
      people[ref.personName][ref.ageBucket].count += 1;
      people[ref.personName][ref.ageBucket].quality += ref.quality;
      return people;
    }, {})
  )
    .map(([person, buckets]) => {
      const missing = referenceAgeBuckets.filter((bucket) => buckets[bucket].count === 0);
      const total = Object.values(buckets).reduce((sum, bucket) => sum + bucket.count, 0);
      const quality = total
        ? Object.values(buckets).reduce((sum, bucket) => sum + bucket.quality, 0) / total
        : 0;
      return { person, buckets, missing, total, quality };
    })
    .sort((a, b) => b.missing.length - a.missing.length || a.person.localeCompare(b.person))
    .slice(0, 5);
  return (
    <div className="coverage-coach">
      <div className="section-kicker">Age coverage</div>
      <p className="compact">More ages can help Vintrace find the same person across old and new photos.</p>
      {rows.length ? rows.map((row) => (
        <div className="coverage-coach-row" key={row.person}>
          <div>
            <strong>{row.person}</strong>
            <span>{row.total} saved photo{row.total === 1 ? "" : "s"} • {percent(row.quality)} avg quality</span>
          </div>
          <div className="coverage-matrix" aria-label={`${row.person} age coverage`}>
            {referenceAgeBuckets.map((bucket) => {
              const value = row.buckets[bucket];
              return (
                <span key={bucket} className={value.count ? "covered" : "missing"} title={`${ageBucketLabel(bucket)}: ${value.count} saved photo(s)`}>
                  {ageBucketLabel(bucket).slice(0, 3)}
                </span>
              );
            })}
          </div>
        </div>
      )) : (
        <span className="compact">Add a person to see coverage suggestions.</span>
      )}
    </div>
  );
}

function ScanView(props: {
  state: AppState;
  scanFolder: string;
  setScanFolder(value: string): void;
  chooseFolder(): void;
  scan(): void;
  resumeLastScan(): void;
  restartLastScan(): void;
  dismissedRecoveryRunId: string;
  dismissRecovery(runId: string): void;
  scanCameraFrame(dataUrl: string): Promise<CameraScanResult>;
  analyzeFolder(): void;
  folderAnalysis: FolderAnalysis | null;
  startWatchFolder(): void;
  stopWatchFolder(): void;
  cancelScan(): void;
  pauseScan(): void;
  resumeScan(): void;
  localScanMarkers: { cancelRequested: boolean; paused: boolean } | null;
  scanProgress: ScanProgress | null;
  watchStatus: FolderWatchStatus;
  clearQueue(): void;
  disabled: boolean;
  busy: boolean;
  candidateBatchSize: number;
  showListThumbnails: boolean;
  pendingExternalIntent: PendingExternalIntent | null;
  resumePendingExternalIntent(): void;
  clearPendingExternalIntent(): void;
  copyText(text: string, label?: string): void;
  revealPath(candidatePath?: string | null): void | Promise<void>;
  openPath(candidatePath?: string | null): void | Promise<void>;
  photoSources: SystemPhotoSource[];
  refreshPhotoSources(): void;
  usePhotoSource(source: SystemPhotoSource): void;
  savedScanSources: SavedScanSource[];
  saveCurrentScanSource(): void;
  useSavedScanSource(source: SavedScanSource): void;
  removeSavedScanSource(sourceId: string): void;
  scanQueue: ScanQueueItem[];
  scanQueueRunning: boolean;
  addCurrentToScanQueue(): void;
  runScanQueue(): void;
  removeScanQueueItem(itemId: string): void;
  clearScanQueue(): void;
  clearCompletedScanQueueItems(): void;
  retryFailedScanQueueItems(): void;
  retryIssuePaths(paths: string[]): void;
  ignoreIssuePaths(paths: string[]): void;
  selectCandidate(id: string): void;
}) {
  const scanActive = Boolean(props.scanProgress && !["complete", "cancelled", "error"].includes(props.scanProgress.phase));
  const readiness = [
    { label: "Permission", ok: props.state.consentOnFile },
    { label: "Person added", ok: props.state.references.length > 0 },
    { label: "Folder", ok: props.scanFolder.trim().length > 0 }
  ];
  return (
    <section className="scan-page">
      <div className="panel form-panel">
        <div className="panel-title"><Search size={18} /> Scan photos and videos</div>
        <p className="compact">Pick a folder to search. Vintrace adds possible matches to the review list as it works, so you do not have to wait for the whole scan to finish.</p>
        <div className="field">
          <label htmlFor="scan-folder">Folder to search</label>
          <div className="path-input">
            <input id="scan-folder" aria-label="Scan folder" title={props.scanFolder} value={props.scanFolder} onChange={(event) => props.setScanFolder(event.currentTarget.value)} />
            <button className="icon-button" onClick={props.chooseFolder} disabled={props.busy} title="Choose folder" aria-label="Choose scan folder"><FolderOpen size={17} /></button>
          </div>
        </div>
        <button className="primary" onClick={props.scan} disabled={props.disabled}>
          {props.busy ? <Loader2 className="spin" size={17} /> : <Search size={17} />}
          <span>Scan folder</span>
        </button>
        <button className="secondary" onClick={props.analyzeFolder} disabled={!props.scanFolder.trim() || props.busy}>
          <Activity size={17} />
          <span>Check folder</span>
        </button>
        <button className="secondary danger" onClick={props.cancelScan} disabled={!scanActive}>
          <X size={17} />
          <span>Cancel scan</span>
        </button>
        <button className="secondary" onClick={props.pauseScan} disabled={!scanActive || props.state.scanJob?.paused}>
          <Pause size={17} />
          <span>Pause</span>
        </button>
        <button className="secondary" onClick={props.resumeScan} disabled={!props.state.scanJob?.paused}>
          <Play size={17} />
          <span>Resume</span>
        </button>
        <button className="secondary danger" onClick={props.clearQueue} disabled={!props.state.candidates.length || props.busy}>
          <Trash2 size={17} />
          <span>Clear results</span>
        </button>
        {props.watchStatus.active ? (
          <button className="secondary active-scan" onClick={props.stopWatchFolder} disabled={props.busy}>
            <Activity size={17} />
            <span>{props.watchStatus.scanning ? "Watching..." : "Stop watching"}</span>
          </button>
        ) : (
          <button className="secondary" onClick={props.startWatchFolder} disabled={props.disabled || props.busy}>
            <Activity size={17} />
            <span>Watch for new files</span>
          </button>
        )}
        <div className="readiness-list" aria-label="Scan readiness">
          {readiness.map((item) => (
            <span key={item.label} className={item.ok ? "pill green" : "pill neutral"}>{item.label}</span>
          ))}
        </div>
        <ScanRecoveryPanel
          state={props.state}
          busy={props.busy}
          resumeLastScan={props.resumeLastScan}
          restartLastScan={props.restartLastScan}
          dismissedRunId={props.dismissedRecoveryRunId}
          dismissRecovery={props.dismissRecovery}
        />
        <PendingExternalBanner
          intent={props.pendingExternalIntent}
          ready={Boolean(props.state.consentOnFile && props.state.references.length)}
          onResume={props.resumePendingExternalIntent}
          onDismiss={props.clearPendingExternalIntent}
        />
        <FolderPreflight analysis={props.folderAnalysis} />
        <SavedScanSourcesPanel
          sources={props.savedScanSources}
          busy={props.busy}
          currentFolder={props.scanFolder}
          saveCurrent={props.saveCurrentScanSource}
          useSource={props.useSavedScanSource}
          removeSource={props.removeSavedScanSource}
        />
        <ScanQueuePanel
          queue={props.scanQueue}
          busy={props.busy}
          running={props.scanQueueRunning}
          currentFolder={props.scanFolder}
          addCurrent={props.addCurrentToScanQueue}
          runQueue={props.runScanQueue}
          removeItem={props.removeScanQueueItem}
          clearQueue={props.clearScanQueue}
          clearCompleted={props.clearCompletedScanQueueItems}
          retryFailed={props.retryFailedScanQueueItems}
        />
        <SystemPhotosPanel
          sources={props.photoSources}
          busy={props.busy}
          refresh={props.refreshPhotoSources}
          useSource={props.usePhotoSource}
        />
        <ScanActivity progress={props.scanProgress} watchStatus={props.watchStatus} cancelScan={props.cancelScan} pauseScan={props.pauseScan} resumeScan={props.resumeScan} scanPaused={Boolean(props.state.scanJob?.paused || props.localScanMarkers?.paused)} />
        <ScanIssueCenter
          analysis={props.folderAnalysis}
          scanHistory={props.state.scanHistory}
          onPreflight={props.analyzeFolder}
          busy={props.busy}
          copyText={props.copyText}
          revealPath={props.revealPath}
          openPath={props.openPath}
          retryPaths={props.retryIssuePaths}
          ignorePaths={props.ignoreIssuePaths}
        />
      </div>
      <CameraScanner
        state={props.state}
        busy={props.busy}
        onCapture={props.scanCameraFrame}
      />
      <CandidateTable
        candidates={props.state.candidates}
        batchSize={props.candidateBatchSize}
        showThumbnails={props.showListThumbnails}
        onSelect={props.selectCandidate}
      />
    </section>
  );
}

function ScanRecoveryPanel({
  state,
  busy,
  resumeLastScan,
  restartLastScan,
  dismissedRunId,
  dismissRecovery
}: {
  state: AppState;
  busy: boolean;
  resumeLastScan(): void;
  restartLastScan(): void;
  dismissedRunId: string;
  dismissRecovery(runId: string): void;
}) {
  const latest = state.scanJob?.latestScan;
  const status = String(latest?.status || "");
  const canResume = Boolean(state.scanJob?.canResume && latest);
  const processed = Number(latest?.processed || 0);
  const total = Number(latest?.total || 0);
  const folder = String(latest?.root_path || latest?.label || "");
  const runId = String(latest?.run_id || latest?.runId || "");
  const recoveryKey = runId || `${folder}:${status}:${processed}:${total}`;
  if (!canResume || dismissedRunId === recoveryKey) {
    return null;
  }
  const percentDone = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const skippedText = processed ? `Resume skips ${formatNumber(processed)} completed file${processed === 1 ? "" : "s"}.` : "Resume uses the last scan manifest.";
  return (
    <div className="recovery-card">
      <div>
        <strong>Resume last scan</strong>
        <span title={folder}>{folder ? basename(folder) : "Previous scan"}</span>
      </div>
      <div className="recovery-progress">
        <progress max={100} value={percentDone} />
        <small>{state.scanJob?.progressLabel || `${formatNumber(processed)} processed`} • {status || "paused"}</small>
      </div>
      <p>{skippedText} {state.scanJob?.recommendedAction}</p>
      <div className="button-row recovery-actions">
        <button className="secondary" onClick={resumeLastScan} disabled={busy || !state.consentOnFile || !state.references.length}>
          <Play size={17} />
          <span>Resume</span>
        </button>
        <button className="secondary" onClick={restartLastScan} disabled={busy || !state.consentOnFile || !state.references.length}>
          <RefreshCcw size={17} />
          <span>Restart clean</span>
        </button>
        <button className="ghost compact-action" onClick={() => dismissRecovery(recoveryKey)} disabled={busy} type="button">
          <X size={16} />
          <span>Ignore</span>
        </button>
      </div>
    </div>
  );
}

function SavedScanSourcesPanel({
  sources,
  busy,
  currentFolder,
  saveCurrent,
  useSource,
  removeSource
}: {
  sources: SavedScanSource[];
  busy: boolean;
  currentFolder: string;
  saveCurrent(): void;
  useSource(source: SavedScanSource): void;
  removeSource(sourceId: string): void;
}) {
  return (
    <div className="system-photo-panel saved-source-panel">
      <div className="panel-subtitle">
        <span>Saved scan sources</span>
        <button className="mini-button" onClick={saveCurrent} disabled={busy || !currentFolder.trim()} type="button">
          <Save size={14} />
          <span>Save current</span>
        </button>
      </div>
      <div className="photo-source-list">
        {sources.length ? sources.map((source) => (
          <div className="saved-source-row" key={source.id}>
            <button
              className="photo-source-card"
              onClick={() => useSource(source)}
              disabled={busy}
              type="button"
              title={source.path}
            >
              <span>
                <strong>{source.label}</strong>
                <small>Last used {formatTimestampDateTime(source.lastUsedAt)}</small>
                <em>{source.path}</em>
              </span>
              <ChevronRight size={17} />
            </button>
            <button className="icon-button danger" onClick={() => removeSource(source.id)} disabled={busy} title="Remove saved source" aria-label={`Remove ${source.label}`}>
              <Trash2 size={15} />
            </button>
          </div>
        )) : (
          <div className="empty compact-empty">
            <FolderOpen size={20} />
            <strong>No saved sources</strong>
            <span>Save folders you scan often.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ScanQueuePanel({
  queue,
  busy,
  running,
  currentFolder,
  addCurrent,
  runQueue,
  removeItem,
  clearQueue,
  clearCompleted,
  retryFailed
}: {
  queue: ScanQueueItem[];
  busy: boolean;
  running: boolean;
  currentFolder: string;
  addCurrent(): void;
  runQueue(): void;
  removeItem(itemId: string): void;
  clearQueue(): void;
  clearCompleted(): void;
  retryFailed(): void;
}) {
  const pendingCount = queue.filter((item) => item.status !== "done").length;
  const failedCount = queue.filter((item) => item.status === "error").length;
  const doneCount = queue.filter((item) => item.status === "done").length;
  return (
    <div className="system-photo-panel scan-queue-panel">
      <div className="panel-subtitle">
        <span>Scan queue</span>
        <div className="inline-actions">
          <button className="mini-button" onClick={addCurrent} disabled={busy || running || !currentFolder.trim()} type="button">
            <Archive size={14} />
            <span>Add</span>
          </button>
          <button className="mini-button" onClick={runQueue} disabled={busy || running || !pendingCount} type="button">
            {running ? <Loader2 className="spin" size={14} /> : <Play size={14} />}
            <span>{running ? "Running" : "Run"}</span>
          </button>
          <button className="mini-button" onClick={retryFailed} disabled={busy || running || !failedCount} type="button">
            <RefreshCcw size={14} />
            <span>Retry failed</span>
          </button>
          <button className="mini-button" onClick={clearCompleted} disabled={busy || running || !doneCount} type="button">
            <Check size={14} />
            <span>Clear done</span>
          </button>
          <button className="mini-button danger" onClick={clearQueue} disabled={busy || running || !queue.length} type="button">
            <Trash2 size={14} />
            <span>Clear</span>
          </button>
        </div>
      </div>
      <div className="scan-queue-list">
        {queue.length ? queue.map((item) => (
          <div className={`scan-queue-row ${item.status}`} key={item.id}>
            <span>
              <strong>{item.label}</strong>
              <small title={item.path}>{item.path}</small>
              {item.message ? <em>{localizeImperativeText(item.message)}</em> : null}
            </span>
            <i>{item.status}</i>
            <button className="icon-button danger" onClick={() => removeItem(item.id)} disabled={busy || running} title="Remove queued folder" aria-label={`Remove ${item.label}`}>
              <X size={15} />
            </button>
          </div>
        )) : (
          <div className="empty compact-empty">
            <Archive size={20} />
            <strong>No queued folders</strong>
            <span>Add folders to scan them one after another.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SystemPhotosPanel({
  sources,
  busy,
  refresh,
  useSource
}: {
  sources: SystemPhotoSource[];
  busy: boolean;
  refresh(): void;
  useSource(source: SystemPhotoSource): void;
}) {
  return (
    <div className="system-photo-panel">
      <div className="panel-subtitle">
        <span>Photo locations</span>
        <button className="mini-button" onClick={refresh} disabled={busy} type="button">
          <RefreshCcw size={14} />
          <span>Refresh</span>
        </button>
      </div>
      <div className="photo-source-list">
        {sources.length ? sources.map((source) => (
          <button
            key={source.id}
            className={source.available ? "photo-source-card" : "photo-source-card unavailable"}
            onClick={() => useSource(source)}
            disabled={busy || !source.available}
            type="button"
            title={source.path}
          >
            <span>
              <strong>{source.label}</strong>
              <small>{source.detail}</small>
              <em>{source.available ? source.path : "Not found on this computer"}</em>
            </span>
            {source.available ? <ChevronRight size={17} /> : <AlertCircle size={17} />}
          </button>
        )) : (
          <div className="empty compact-empty">
            <FolderOpen size={20} />
            <strong>No photo locations detected</strong>
            <span>Use Choose folder to pick a folder manually.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CameraScanner(props: {
  state: AppState;
  busy: boolean;
  onCapture(dataUrl: string): Promise<CameraScanResult>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);
  const stableReadyFrames = useRef(0);
  const lastAutoCaptureAt = useRef(0);
  const mountedRef = useRef(true);
  const captureInFlightRef = useRef(false);
  const [mode, setMode] = useState<CameraMode>("idle");
  const [error, setError] = useState("");
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics>(initialCameraDiagnostics);
  const [faceBox, setFaceBox] = useState<FaceBox | null>(null);
  const [autoCapture, setAutoCapture] = useState(false);
  const [lastCapture, setLastCapture] = useState<CameraScanResult | null>(null);

  const live = mode === "live" || mode === "capturing";
  const matchReady = Boolean(props.state.consentOnFile && props.state.references.length);
  const status = mode === "starting"
    ? "Starting"
    : mode === "capturing"
      ? "Capturing"
      : mode === "error"
        ? "Needs access"
        : live
          ? diagnostics.status
          : "Camera standby";

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureInFlightRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!live) {
      stableReadyFrames.current = 0;
      return undefined;
    }
    let stopped = false;
    let timer = 0;
    const inspect = async () => {
      if (stopped) return;
      const video = videoRef.current;
      if (!video || !video.videoWidth || !video.videoHeight) {
        timer = window.setTimeout(inspect, 280);
        return;
      }
      let detectedBox: FaceBox | null = null;
      try {
        const FaceDetector = (window as Window & { FaceDetector?: FaceDetectorConstructor }).FaceDetector;
        if (FaceDetector && !detectorRef.current) {
          detectorRef.current = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        }
        const detections = detectorRef.current ? await detectorRef.current.detect(video) : [];
        detectedBox = normalizeFaceBox(detections[0], video.videoWidth, video.videoHeight);
      } catch {
        detectorRef.current = null;
      }
      const nextBox = detectedBox ?? inferFaceBox(video);
      const nextDiagnostics = measureCameraFrame(video, nextBox);
      if (!stopped) {
        setFaceBox(nextBox);
        setDiagnostics(nextDiagnostics);
        timer = window.setTimeout(inspect, 420);
      }
    };
    inspect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [live]);

  useEffect(() => {
    if (!autoCapture || !live || props.busy || mode === "capturing") {
      stableReadyFrames.current = 0;
      return;
    }
    if (!diagnostics.ready || diagnostics.score < 0.68) {
      stableReadyFrames.current = 0;
      return;
    }
    stableReadyFrames.current += 1;
    const now = Date.now();
    if (stableReadyFrames.current >= 3 && now - lastAutoCaptureAt.current > 3000) {
      lastAutoCaptureAt.current = now;
      stableReadyFrames.current = 0;
      setAutoCapture(false);
      void captureFrame(true);
    }
  }, [autoCapture, diagnostics.ready, diagnostics.score, live, mode, props.busy]);

  async function startCamera() {
    if (props.busy || mode === "starting") return;
    setMode("starting");
    setError("");
    setLastCapture(null);
    let stream: MediaStream | null = null;
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stream = window.crossAge.testCamera
        ? createSyntheticCameraStream()
        : await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 }
            },
            audio: false
          });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
      }
      if (mountedRef.current) {
        setMode("live");
      }
    } catch (captureError) {
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) {
        streamRef.current = null;
      }
      const message = captureError instanceof Error ? captureError.message : String(captureError);
      if (mountedRef.current) {
        setError(message || "Camera access was not available.");
        setMode("error");
      }
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    detectorRef.current = null;
    setAutoCapture(false);
    setFaceBox(null);
    setDiagnostics(initialCameraDiagnostics);
    setMode("idle");
    setError("");
  }

  async function captureFrame(_automatic = false) {
    const video = videoRef.current;
    if (!video || !live || props.busy || mode === "capturing" || captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    setMode("capturing");
    setError("");
    try {
      const dataUrl = snapshotVideoFrame(video);
      const result = await props.onCapture(dataUrl);
      if (mountedRef.current) {
        setLastCapture(result);
        setMode(streamRef.current ? "live" : "idle");
      }
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : String(captureError);
      if (mountedRef.current) {
        setError(message || "Camera photo could not be saved.");
        setMode(streamRef.current ? "live" : "error");
      }
    } finally {
      captureInFlightRef.current = false;
    }
  }

  const signals = [
    { label: "Light", value: diagnostics.brightness },
    { label: "Clarity", value: diagnostics.sharpness },
    { label: "Framing", value: diagnostics.framing },
    { label: "Stability", value: diagnostics.stability }
  ];

  return (
    <section className="panel camera-panel" aria-label="Add from camera">
      <div className="panel-title">
        <ScanFace size={18} />
        <span>Add from camera</span>
        <strong className={live && diagnostics.ready ? "scanner-state ready" : "scanner-state"}>{status}</strong>
      </div>
      <div className="scanner-stage">
        <video ref={videoRef} className={live ? "live" : ""} playsInline muted />
        <div className="scanner-grid" />
        <div className="scanner-vignette" />
        <div className="scanner-ring" />
        {live && <div className="scan-beam" />}
        {faceBox && live && (
          <div
            className={faceBox.source === "detected" ? "face-box detected" : "face-box"}
            style={{
              left: `${faceBox.x * 100}%`,
              top: `${faceBox.y * 100}%`,
              width: `${faceBox.width * 100}%`,
              height: `${faceBox.height * 100}%`
            }}
          />
        )}
        {/* H10: only mount the 34-petal field while the camera is live. It was
            previously always mounted, animating left/top on an infinite loop
            even when idle (hidden behind the .scanner-idle overlay) — a permanent
            background layout/paint loop with no visual payoff. */}
        {live && (
        <div className="sakura-face-field" aria-hidden="true">
          <div className="sakura-canopy" />
          <div className="sakura-breeze" />
          {sakuraPetals.map((petal) => (
            <i
              key={petal.id}
              className={`sakura-petal tone-${petal.tone}`}
              style={{
                "--petal-from-x": `${petal.fromX}%`,
                "--petal-from-y": `${petal.fromY}%`,
                "--petal-to-x": `${petal.toX}%`,
                "--petal-to-y": `${petal.toY}%`,
                "--petal-size": `${petal.size}px`,
                "--petal-delay": `${petal.delay}s`,
                "--petal-duration": `${petal.duration}s`,
                "--petal-rotate": `${petal.rotate}deg`
              } as CSSProperties}
            />
          ))}
        </div>
        )}
        {!live && (
          <div className="scanner-idle">
            <Camera size={34} />
            <strong>{error || "Camera standby"}</strong>
            <span>{error ? "Check camera permission, then try again." : matchReady ? "Ready to capture and match locally." : "Ready to capture now. Add people later to match it."}</span>
          </div>
        )}
      </div>
      <div className="scanner-console">
        <div className="scan-score">
          <span>Capture quality</span>
          <strong>{percent(diagnostics.score)}</strong>
          <progress max={1} value={diagnostics.score} />
        </div>
        <div className="signal-grid">
          {signals.map((signal) => (
            <label className="signal" key={signal.label}>
              <span>{signal.label}</span>
              <meter min={0} max={1} value={signal.value} />
            </label>
          ))}
        </div>
        <div className="scanner-suggestions">
          {(live ? diagnostics.issues : [matchReady ? "Use the camera to add a fresh review photo." : "Camera capture is available now; matching starts after you add people and confirm permission."]).map((issue) => (
            <span key={issue}>{issue}</span>
          ))}
          {lastCapture && <span title={lastCapture.filePath}>Saved {basename(lastCapture.filePath)}{lastCapture.matched ? `, ${lastCapture.added ?? 0} possible match${(lastCapture.added ?? 0) === 1 ? "" : "es"}` : ""}</span>}
        </div>
      </div>
      <div className="camera-actions">
        {live ? (
          <button className="secondary" onClick={stopCamera} disabled={mode === "capturing"}>
            <X size={17} />
            <span>Stop camera</span>
          </button>
        ) : (
          <button className="secondary" onClick={startCamera} disabled={props.busy || mode === "starting"}>
            {mode === "starting" ? <Loader2 className="spin" size={17} /> : <Camera size={17} />}
            <span>Start camera</span>
          </button>
        )}
        <button className="secondary" onClick={() => void captureFrame(false)} disabled={!live || props.busy || mode === "capturing"}>
          <Aperture size={17} />
          <span>Capture now</span>
        </button>
        <button className="primary" onClick={() => void captureFrame(false)} disabled={!live || props.busy || mode === "capturing" || diagnostics.score < 0.45}>
          {mode === "capturing" ? <Loader2 className="spin" size={17} /> : <Focus size={17} />}
          <span>Capture best frame</span>
        </button>
        <button className={autoCapture ? "secondary active-scan" : "secondary"} onClick={() => setAutoCapture((value) => !value)} disabled={!live || props.busy || mode === "capturing"}>
          <ScanLine size={17} />
          <span>{autoCapture ? "Auto ready" : "Arm auto capture"}</span>
        </button>
      </div>
    </section>
  );
}

function PendingExternalBanner({
  intent,
  ready,
  onResume,
  onDismiss
}: {
  intent: PendingExternalIntent | null;
  ready: boolean;
  onResume(): void;
  onDismiss(): void;
}) {
  if (!intent) return null;
  const count = intent.paths.length;
  return (
    <div className="pending-intent">
      <div>
        <strong>{count} received photo or video file{count === 1 ? "" : "s"}</strong>
        <span>{ready ? "Ready to scan now." : "Confirm permission and add a person first."}</span>
      </div>
      <button className="secondary" onClick={onResume} type="button">
        <Search size={16} />
        <span>{ready ? "Continue scan" : "Show setup"}</span>
      </button>
      <button className="icon-button" onClick={onDismiss} type="button" aria-label="Dismiss received files">
        <X size={16} />
      </button>
    </div>
  );
}

function ScanIssueCenter({
  analysis,
  scanHistory,
  onPreflight,
  busy,
  copyText,
  revealPath,
  openPath,
  retryPaths,
  ignorePaths
}: {
  analysis: FolderAnalysis | null;
  scanHistory: AppState["scanHistory"];
  onPreflight(): void;
  busy: boolean;
  copyText(text: string, label?: string): void;
  revealPath(candidatePath?: string | null): void | Promise<void>;
  openPath(candidatePath?: string | null): void | Promise<void>;
  retryPaths(paths: string[]): void;
  ignorePaths(paths: string[]): void;
}) {
  const preflightIssues = [
    ...(analysis?.unreadableSamples ?? []).map((item) => ({ ...item, kind: "image" })),
    ...(analysis?.unreadableVideoSamples ?? []).map((item) => ({ ...item, kind: "video" }))
  ];
  const scanIssues = scanHistory.flatMap((run) =>
    run.errorSamples.map((error) => ({
      runId: run.runId,
      label: basename(run.label) || run.source,
      error
    }))
  ).slice(0, 5);
  const totalIssues = preflightIssues.length + scanIssues.length;
  const issueReport = [
    "Vintrace scan issue report",
    analysis ? `Folder: ${analysis.folder}` : "Folder: Not checked",
    "",
    ...preflightIssues.map((item) => `Folder check | ${item.path} | ${item.error}`),
    ...scanIssues.map((item) => `Scan run ${item.label} | ${item.error}`)
  ].join("\n");
  return (
    <div className={totalIssues ? "issue-center active" : "issue-center"}>
      <div className="issue-center-head">
        <strong>Files that need attention</strong>
        <span>{totalIssues ? `${totalIssues} item${totalIssues === 1 ? "" : "s"} need attention` : "No recent file issues"}</span>
      </div>
      {totalIssues ? (
        <div className="issue-list">
          {preflightIssues.slice(0, 4).map((item) => (
            <div className="issue-row" key={item.path}>
              <span title={`${item.path}\n${item.error}`}>{basename(item.path)} could not be checked</span>
              <button className="icon-button" onClick={() => void revealPath(item.path)} type="button" aria-label={`Reveal ${basename(item.path)}`}>
                <FolderOpen size={15} />
              </button>
              <button className="icon-button" onClick={() => void openPath(item.path)} type="button" aria-label={`Open ${basename(item.path)}`}>
                <ExternalLink size={15} />
              </button>
            </div>
          ))}
          {scanIssues.map((item) => (
            <span key={`${item.runId}-${item.error}`} title={item.error}>{item.label}: {item.error}</span>
          ))}
        </div>
      ) : (
        <p className="compact">Folder checks and recent scans found no read errors.</p>
      )}
      <button className="ghost compact-action" onClick={onPreflight} disabled={busy || !analysis}>
        <RefreshCcw size={16} />
        <span>Check again</span>
      </button>
      <button className="ghost compact-action" onClick={() => copyText(issueReport, "Issue report")} disabled={!totalIssues}>
        <Archive size={16} />
        <span>Copy report</span>
      </button>
      <button className="ghost compact-action" onClick={() => retryPaths(preflightIssues.map((item) => item.path))} disabled={!preflightIssues.length || busy}>
        <Search size={16} />
        <span>Retry files</span>
      </button>
      <button className="ghost compact-action danger" onClick={() => ignorePaths(preflightIssues.map((item) => item.path))} disabled={!preflightIssues.length || busy}>
        <EyeOff size={16} />
        <span>Ignore files</span>
      </button>
    </div>
  );
}

function FolderPreflight({ analysis }: { analysis: FolderAnalysis | null }) {
  if (!analysis) {
    return (
      <div className="preflight-card muted">
        <strong>Folder not checked yet</strong>
        <span>Check the folder before a large scan to catch unreadable files early.</span>
      </div>
    );
  }
  const mediaCount = analysis.imageCount + analysis.videoCount;
  const issueCount = folderAnalysisIssueCount(analysis);
  const ready = isFolderAnalysisReady(analysis);
  const readiness = analysis.readiness;
  const metrics = [
    { label: "Media files", value: formatNumber(mediaCount) },
    { label: "Images", value: formatNumber(analysis.imageCount) },
    { label: "Videos", value: formatNumber(analysis.videoCount) },
    { label: "Other files", value: formatNumber(analysis.nonImageCount) },
    { label: "Excluded", value: formatNumber((analysis.excludedCount ?? 0) + (analysis.excludedDirectoryCount ?? 0)) },
    { label: "I/O issues", value: formatNumber((analysis.transientErrorCount ?? 0) + (analysis.statErrorCount ?? 0) + (analysis.walkErrorCount ?? 0)) },
    { label: "Checked", value: analysis.truncated ? `${formatNumber(analysis.entriesChecked ?? 0)}+` : formatNumber(analysis.entriesChecked ?? 0) },
    { label: "Sampled", value: formatNumber(analysis.checkedImages + analysis.checkedVideos) },
    { label: "Size", value: formatBytes(analysis.totalBytes) }
  ];
  return (
    <div className={ready ? "preflight-card ready" : "preflight-card warn"}>
      <div className="preflight-head">
        <strong>{ready ? "Ready to scan" : "Needs attention"}</strong>
        <span title={analysis.folder}>{basename(analysis.folder)}</span>
      </div>
      <div className="preflight-grid">
        {metrics.map((metric) => (
          <span key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong></span>
        ))}
      </div>
      {readiness && (
        <div className={readiness.status === "pass" ? "scan-readiness-card pass" : readiness.status === "warn" ? "scan-readiness-card warn" : "scan-readiness-card fail"}>
          <div className="scan-readiness-head">
            <strong>{readiness.status === "pass" ? "Pre-scan readiness passed" : readiness.status === "warn" ? "Pre-scan readiness warnings" : "Pre-scan readiness blocked"}</strong>
            <span>{readiness.largeScan ? "Large scan gate" : "Standard scan"}</span>
          </div>
          <div className="scan-readiness-grid">
            {readiness.checks.slice(0, 8).map((check) => (
              <span key={check.name} className={check.ok ? "ok" : check.severity === "blocker" ? "fail" : "warn"}>
                {check.ok ? <Check size={14} /> : <AlertCircle size={14} />}
                <strong>{check.name}</strong>
                <small>{localizeImperativeText(check.detail)}</small>
              </span>
            ))}
          </div>
          <div className="eta-detail preflight-eta">
            <span><strong>{formatDuration(readiness.estimatedTotalSeconds * 1000)}</strong> ETA</span>
            <span><strong>{formatBytes(readiness.estimatedWorkspaceBytes)}</strong> app data</span>
            <span><strong>{formatNumber(readiness.mediaCount)}</strong> media files</span>
            <span><strong>{localizeImperativeText(readiness.recommendedAction)}</strong></span>
          </div>
        </div>
      )}
      {analysis.estimate && (
        <div className="eta-detail preflight-eta">
          <span><strong>{analysis.estimate.label}</strong> expected</span>
          <span><strong>{formatDuration(analysis.estimate.imageSeconds * 1000)}</strong> photos</span>
          <span><strong>{formatDuration(analysis.estimate.videoSeconds * 1000)}</strong> videos</span>
          <span><strong>{analysis.estimate.detectorSize}</strong> detail</span>
        </div>
      )}
      {analysis.plan && (
        <div className="eta-detail preflight-eta">
          <span><strong>{analysis.plan.mode}</strong> plan</span>
          <span><strong>{formatBytes(analysis.plan.estimatedWorkspaceBytes)}</strong> app data</span>
          <span><strong>{formatNumber(analysis.plan.cache.embeddingEntries)}</strong> cached faces</span>
          <span><strong>{analysis.plan.resumable ? "Yes" : "No"}</strong> resumable</span>
        </div>
      )}
      {analysis.storage && (
        <div className="eta-detail preflight-eta">
          <span><strong>{analysis.storage.volumeKind}</strong> drive</span>
          <span><strong>{formatBytes(analysis.storage.freeBytes)}</strong> free</span>
          <span><strong>{analysis.storage.externalLikely ? "External" : analysis.storage.networkLikely ? "Network" : "Local"}</strong> source</span>
          <span><strong>{analysis.storage.sameVolumeAsWorkspace ? "Same drive" : "Separate app drive"}</strong></span>
        </div>
      )}
      <div className="preflight-notes">
        {[...(analysis.plan?.warnings ?? []), ...analysis.recommendations].slice(0, 5).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
      </div>
      {analysis.decoder && (
        <div className="decoder-strip">
          <span className={analysis.decoder.heifAvailable ? "pill green" : "pill neutral"}>HEIC {analysis.decoder.heifAvailable ? "ready" : "not ready"}</span>
          <span className={analysis.decoder.rawAvailable ? "pill green" : "pill neutral"}>RAW {analysis.decoder.rawAvailable ? "ready" : "not ready"}</span>
          {analysis.videoDecoder && <span className={analysis.videoDecoder.opencvAvailable ? "pill green" : "pill neutral"}>Video {analysis.videoDecoder.backend}</span>}
          <span className="pill neutral">{analysis.decoder.extensions.length} file types</span>
        </div>
      )}
      {analysis.excludedSamples?.length > 0 && (
        <div className="preflight-errors">
          {analysis.excludedSamples.slice(0, 3).map((item) => (
            <span key={item.path} title={item.reason}>{basename(item.path)} skipped</span>
          ))}
        </div>
      )}
      {issueCount > 0 && (
        <div className="preflight-errors">
          {[...analysis.unreadableSamples, ...analysis.unreadableVideoSamples].slice(0, 3).map((item) => (
            <span key={item.path} title={item.error}>{basename(item.path)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function ScanActivity({
  progress,
  watchStatus,
  cancelScan,
  pauseScan,
  resumeScan,
  scanPaused
}: {
  progress: ScanProgress | null;
  watchStatus: FolderWatchStatus;
  cancelScan(): void;
  pauseScan(): void;
  resumeScan(): void;
  scanPaused: boolean;
}) {
  const [etaOpen, setEtaOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const total = progress?.total ?? 0;
  const processed = progress?.processed ?? 0;
  const completion = total ? Math.min(1, processed / total) : 0;
  const current = progress?.currentPath ? basename(progress.currentPath) : watchStatus.active ? basename(watchStatus.folder) : "Idle";
  const phase = watchStatus.scanning
    ? "Watching"
    : watchStatus.sweeping
      ? "Catch-up"
    : scanPaused || progress?.phase === "paused"
      ? "Paused"
    : progress?.phase === "cancelled"
      ? "Cancelled"
      : progress?.phase === "complete"
        ? "Complete"
        : progress?.phase === "error"
          ? "Error"
        : progress?.phase === "verifying" || progress?.phase === "verified"
          ? "Rechecking"
        : progress?.phase === "model_backfill"
          ? "Backfilling"
        : progress?.phase ? "Scanning" : "Ready";
  const scanActive = Boolean(progress && !["complete", "cancelled", "error"].includes(progress.phase) && (!total || processed < total));
  const completedWatchMessage = watchStatus.active && progress?.source === "watch" && progress.phase === "complete" && Number(progress.added ?? 0) > 0
    ? `Processed ${progress.processed ?? progress.total ?? progress.added ?? 0} new file(s).`
    : "";
  const activityMessage = completedWatchMessage || (watchStatus.active ? watchStatus.message : progress?.message) || watchStatus.message || current;
  const elapsedMs = startedAt ? Math.max(0, clock - startedAt) : 0;
  const etaMs = scanActive && startedAt && processed > 0 ? Math.max(0, (elapsedMs / processed) * (total - processed)) : null;
  const rate = elapsedMs > 0 ? (processed / (elapsedMs / 1000)) : 0;
  const memoryPressure = String(progress?.memoryPressure || "normal");
  const showMemoryPressure = ["elevated", "high", "critical"].includes(memoryPressure);
  const memoryLabel = memoryPressure === "critical" ? "Critical memory pressure" : memoryPressure === "high" ? "High memory pressure" : "Memory being watched";
  const memoryDetail = progress?.memoryMessage || "Preview work is adjusted while scan load is high.";
  const memoryUsageDetail = progress?.memoryAvailableBytes || progress?.processMemoryBytes
    ? [
      progress.memoryAvailableBytes ? `${formatBytes(progress.memoryAvailableBytes)} free` : "",
      progress.processMemoryBytes ? `${formatBytes(progress.processMemoryBytes)} app` : ""
    ].filter(Boolean).join(" • ")
    : "";

  useEffect(() => {
    if (progress?.phase === "started" || (progress && total > 0 && processed === 0 && startedAt === null)) {
      setStartedAt(Date.now());
      setClock(Date.now());
    }
    if (!progress) {
      setStartedAt(null);
      setEtaOpen(false);
    }
  }, [processed, progress, startedAt, total]);

  useEffect(() => {
    if (!scanActive) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [scanActive]);

  return (
    <div className="scan-activity">
      <div className="activity-head">
        <span>{phase}</span>
        <div className="activity-head-actions">
          <button className="eta-button" onClick={() => setEtaOpen((value) => !value)} disabled={!total && !watchStatus.scanning} aria-label="Toggle scan ETA">
            <Timer size={14} />
            <span>{etaMs !== null ? formatDuration(Math.round(etaMs)) : "ETA"}</span>
          </button>
          {scanActive && (
            <>
              {scanPaused ? (
                <button className="eta-button" onClick={resumeScan} aria-label="Resume scan">
                  <Play size={14} />
                  <span>Resume</span>
                </button>
              ) : (
                <button className="eta-button" onClick={pauseScan} aria-label="Pause scan">
                  <Pause size={14} />
                  <span>Pause</span>
                </button>
              )}
            <button className="eta-button danger" onClick={cancelScan} aria-label="Cancel scan">
              <X size={14} />
              <span>Cancel</span>
            </button>
            </>
          )}
          <strong>{total ? `${processed}/${total}` : scanActive ? `${processed} processed` : watchStatus.active ? `${watchStatus.queued} waiting` : "No active scan"}</strong>
        </div>
      </div>
      <progress max={1} value={completion} />
      {etaOpen && (
        <div className="eta-detail">
          <span><strong>{etaMs !== null ? formatDuration(Math.round(etaMs)) : "Calculating"}</strong> remaining</span>
          <span><strong>{formatDuration(Math.round(elapsedMs))}</strong> elapsed</span>
          <span><strong>{rate ? rate.toFixed(2) : "0.00"}</strong> files/s</span>
        </div>
      )}
      {showMemoryPressure && (
        <div className={`memory-pressure-banner ${memoryPressure}`}>
          <strong>{memoryLabel}</strong>
          <span>{memoryDetail}{memoryUsageDetail ? ` ${memoryUsageDetail}` : ""}</span>
        </div>
      )}
      <div className="activity-stats">
        <span><strong>{progress?.added ?? 0}</strong> possible matches</span>
        <span><strong>{progress?.matched ?? 0}</strong> matched to a person</span>
        <span><strong>{progress?.clustered ?? 0}</strong> similar groups</span>
        <span><strong>{progress?.safeFiltered ?? 0}</strong> protected</span>
        <span><strong>{progress?.videoFrames ?? 0}</strong> video frames</span>
        <span><strong>{progress?.manifestSkipped ?? 0}</strong> resumed skips</span>
        <span><strong>{progress?.excluded ?? 0}</strong> excluded</span>
        <span><strong>{progress?.embeddingCacheHits ?? 0}</strong> cached faces</span>
        <span><strong>{progress?.twoPassVerified ?? 0}</strong> rechecked</span>
        <span><strong>{progress?.twoPassDeferred ?? 0}</strong> recheck queued</span>
        <span><strong>{progress?.profileRescueFound ?? 0}</strong> side faces recovered</span>
        <span><strong>{progress?.noFaceDetected ?? 0}</strong> no face found</span>
        <span><strong>{progress?.lowQualityFaces ?? 0}</strong> low quality</span>
        <span><strong>{progress?.safeModeFaceCropAllowed ?? 0}</strong> face crops allowed</span>
        <span><strong>{progress?.pausedSeconds ?? 0}</strong>s paused</span>
        <span><strong>{progress?.pathErrors ?? 0}</strong> drive/path issues</span>
        {watchStatus.active && <span><strong>{watchStatus.mode === "recursive" ? "Recursive" : "Top-level"}</strong> watch</span>}
        {watchStatus.sweeping && <span><strong>Active</strong> catch-up</span>}
        <span><strong>{progress?.errors ?? 0}</strong> errors</span>
      </div>
      <small title={progress?.currentPath ?? watchStatus.folder ?? ""}>{localizeImperativeText(activityMessage)}</small>
    </div>
  );
}

function BackgroundJobCenter({
  state,
  scanProgress,
  watchStatus,
  modelDownloadProgress,
  updateStatus,
  mediaActionProgress,
  scanQueue,
  scanQueueRunning,
  navigate,
  cancelScan,
  pauseScan,
  resumeScan,
  scanPaused,
  busy
}: {
  state: AppState;
  scanProgress: ScanProgress | null;
  watchStatus: FolderWatchStatus;
  modelDownloadProgress: ModelDownloadProgress | null;
  updateStatus: UpdateStatus | null;
  mediaActionProgress: MediaActionProgress | null;
  scanQueue: ScanQueueItem[];
  scanQueueRunning: boolean;
  navigate(tab: TabKey): void;
  cancelScan(): void;
  pauseScan(): void;
  resumeScan(): void;
  scanPaused: boolean;
  busy: boolean;
}) {
  const scanActive = Boolean(scanProgress && !["complete", "cancelled", "error"].includes(scanProgress.phase));
  const scanTotal = Math.max(0, scanProgress?.total ?? 0);
  const scanProcessed = Math.max(0, scanProgress?.processed ?? 0);
  const scanPercent = scanTotal ? Math.min(100, Math.round((scanProcessed / scanTotal) * 100)) : scanActive ? 12 : 0;
  const modelActive = Boolean(modelDownloadProgress && !["complete", "error"].includes(modelDownloadProgress.phase));
  const mediaActive = Boolean(mediaActionProgress && !["complete", "error", "cancelled"].includes(mediaActionProgress.phase));
  const updateActive = Boolean(updateStatus?.checking || updateStatus?.downloading || updateStatus?.available || updateStatus?.downloaded || updateStatus?.error);
  const queueQueued = scanQueue.filter((item) => item.status === "queued").length;
  const queueRunning = scanQueue.filter((item) => item.status === "running").length;
  const queueErrors = scanQueue.filter((item) => item.status === "error").length;
  const queueDone = scanQueue.filter((item) => item.status === "done").length;
  const queueActive = scanQueueRunning || queueQueued > 0 || queueRunning > 0 || queueErrors > 0;
  const resumable = Boolean(state.scanJob?.canResume && state.scanJob.latestScan);
  const jobs: Array<{
    key: string;
    icon: typeof Activity;
    label: string;
    detail: string;
    percent?: number;
    tone: "green" | "amber" | "rose" | "blue" | "neutral";
    actionLabel?: string;
    action?: () => void;
    disabled?: boolean;
    secondaryLabel?: string;
    secondaryAction?: () => void;
    secondaryDisabled?: boolean;
  }> = [];

  if (scanActive || watchStatus.active) {
    jobs.push({
      key: "scan",
      icon: Search,
      label: scanPaused || scanProgress?.phase === "paused" ? "Scan paused" : watchStatus.scanning ? "Folder watch scanning" : "Scan running",
      detail: scanTotal ? `${formatNumber(scanProcessed)} of ${formatNumber(scanTotal)} files` : (scanProgress?.message || watchStatus.message || "Working through the selected folder"),
      percent: scanPercent,
      tone: scanPaused || scanProgress?.phase === "paused" ? "amber" : "blue",
      actionLabel: scanPaused || scanProgress?.phase === "paused" ? "Resume" : "Pause",
      action: scanPaused || scanProgress?.phase === "paused" ? resumeScan : pauseScan,
      disabled: busy,
      secondaryLabel: "Cancel",
      secondaryAction: cancelScan,
      secondaryDisabled: busy
    });
  }
  if (modelActive && modelDownloadProgress) {
    jobs.push({
      key: "model",
      icon: Download,
      label: "Model download",
      detail: `${modelDownloadProgress.label || modelDownloadProgress.pack} • ${modelDownloadProgress.message || modelDownloadProgress.phase}`,
      percent: Math.max(0, Math.min(100, Math.round(modelDownloadProgress.percent || 0))),
      tone: "blue",
      actionLabel: "Open setup",
      action: () => navigate("settings")
    });
  }
  if (mediaActive && mediaActionProgress) {
    const total = Math.max(1, mediaActionProgress.total || 1);
    const processed = Math.max(0, mediaActionProgress.processed || 0);
    jobs.push({
      key: "media-action",
      icon: Scissors,
      label: `File ${mediaActionProgress.action || "action"}`,
      detail: `${formatNumber(processed)} of ${formatNumber(total)} files${mediaActionProgress.etaMs ? ` • ${formatDuration(Math.round(mediaActionProgress.etaMs))} left` : ""}`,
      percent: Math.min(100, Math.round((processed / total) * 100)),
      tone: "blue",
      actionLabel: "Open review",
      action: () => navigate("review")
    });
  }
  if (queueActive) {
    jobs.push({
      key: "scan-queue",
      icon: Activity,
      label: scanQueueRunning ? "Scan queue running" : queueErrors ? "Scan queue needs attention" : "Scan queue ready",
      detail: `${queueRunning} running • ${queueQueued} queued • ${queueDone} done • ${queueErrors} failed`,
      percent: scanQueue.length ? Math.round(((queueDone + queueErrors) / scanQueue.length) * 100) : 0,
      tone: queueErrors ? "rose" : scanQueueRunning ? "blue" : "amber",
      actionLabel: "Open scan",
      action: () => navigate("scan")
    });
  }
  if (updateActive && updateStatus) {
    jobs.push({
      key: "update",
      icon: RefreshCcw,
      label: updateStatus.error ? "Update issue" : updateStatus.downloading ? "Update downloading" : updateStatus.downloaded ? "Update ready" : updateStatus.available ? "Update available" : "Checking update",
      detail: updateStatus.message || updateStatus.error || (updateStatus.latestVersion ? `Version ${updateStatus.latestVersion}` : "Updater is checking"),
      percent: updateStatus.progress ? Math.round(updateStatus.progress.percent || 0) : updateStatus.downloaded ? 100 : undefined,
      tone: updateStatus.error ? "rose" : updateStatus.downloaded || updateStatus.available ? "green" : "blue",
      actionLabel: "Open updates",
      action: () => navigate("settings")
    });
  }
  if (resumable && !scanActive) {
    jobs.push({
      key: "resumable",
      icon: Play,
      label: "Interrupted scan can resume",
      detail: state.scanJob?.progressLabel || state.scanJob?.recommendedAction || "Resume from the scan tab without redoing completed files.",
      tone: "amber",
      actionLabel: "Open scan",
      action: () => navigate("scan")
    });
  }
  if (!jobs.length) {
    jobs.push({
      key: "idle",
      icon: Check,
      label: "No background work",
      detail: "Scans, downloads, updates, and file actions are idle.",
      tone: "green",
      actionLabel: "Start scan",
      action: () => navigate("scan")
    });
  }

  return (
    <div className="panel dashboard-span job-center">
      <div className="panel-title"><Activity size={18} /> Background work</div>
      <div className="job-list">
        {jobs.map((job) => {
          const Icon = job.icon;
          return (
            <div className={`job-row ${job.tone}`} key={job.key}>
              <div className="job-icon"><Icon size={17} /></div>
              <div className="job-main">
                <strong>{job.label}</strong>
                <small>{job.detail}</small>
                {typeof job.percent === "number" && (
                  <div className="job-progress" aria-label={`${job.label} ${job.percent}%`}>
                    <span style={{ width: `${Math.max(2, Math.min(100, job.percent))}%` }} />
                  </div>
                )}
              </div>
              {job.actionLabel && (
                <button className="ghost compact-action" onClick={job.action} disabled={job.disabled} type="button">
                  {job.actionLabel}
                </button>
              )}
              {job.secondaryLabel && (
                <button className="ghost compact-action danger" onClick={job.secondaryAction} disabled={job.secondaryDisabled} type="button">
                  {job.secondaryLabel}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// M13: cap on how many person chips render at once in the group finder.
const PEOPLE_CHIP_CAP = 60;

// M4: small session-scoped store for the review filter context (kept separate
// from workspace recognition state; cleared on app restart like other UI prefs).
function readReviewPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(`vintrace:review:${key}`);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeReviewPref(values: Record<string, unknown>) {
  try {
    for (const [key, value] of Object.entries(values)) {
      window.sessionStorage.setItem(`vintrace:review:${key}`, JSON.stringify(value));
    }
  } catch {
    // Persisting review prefs is best effort.
  }
}

function ReviewView(props: {
  state: AppState;
  selectedCandidate: ReviewCandidate | null;
  selectedCandidateId: string | null;
  setSelectedCandidateId(value: string | null): void;
  queryCandidates(params: Record<string, unknown>): Promise<CandidateQueryResult>;
  review(status: CandidateStatus, current?: ReviewCandidate | null, quiet?: boolean): void | Promise<void>;
  bulkReview(candidateIds: string[], status: CandidateStatus): void | Promise<void>;
  blockFalseMatch(candidateId: string): void | Promise<void>;
  reassignCandidatePerson(candidateId: string, personName: string): void | Promise<void>;
  addCandidateCalibrationLabel(candidate: ReviewCandidate, isMatch: boolean): void | Promise<void>;
  exportSelectedCandidates(candidateIds: string[]): void | Promise<void>;
  previewCandidateMediaAction(candidateIds: string[], action: CandidateMediaAction, folder?: string, itemOffset?: number, itemLimit?: number): Promise<CandidateMediaPreviewValue | null>;
  manageCandidateMedia(candidateIds: string[], action: CandidateMediaAction, folder?: string): Promise<CandidateMediaActionValue | null>;
  loadMediaActionHistory(): Promise<MediaActionHistoryValue>;
  restoreMediaAction(manifestPath: string): Promise<MediaActionRestoreValue | null>;
  retryMediaAction(manifestPath: string, folder?: string): Promise<CandidateMediaActionValue | null>;
  undoMediaAction(manifestPath?: string): Promise<MediaActionUndoValue | null>;
  cancelMediaAction(): Promise<{ cancelled: boolean; path: string }>;
  chooseDestinationFolder(): Promise<string | null>;
  mediaActionProgress: MediaActionProgress | null;
  saveCandidateNote(candidateId: string, note: string): void | Promise<void>;
  copyText(text: string, label?: string): void;
  revealPath(candidatePath?: string | null): void | Promise<void>;
  openPath(candidatePath?: string | null): void | Promise<void>;
  reviewUndo: ReviewUndo | null;
  undoReview(): void | Promise<void>;
  renderBatchSize: number;
  showListThumbnails: boolean;
  busy: boolean;
}) {
  // M4: seed the review filter context from sessionStorage so navigating away
  // from Review and back doesn't force the user to re-filter (the view unmounts
  // on tab switch). Persisted by the effect below.
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | "all">(() => readReviewPref<CandidateStatus | "all">("statusFilter", "pending"));
  const [search, setSearch] = useState(() => readReviewPref("search", ""));
  const [sort, setSort] = useState<"score" | "newest" | "quality">(() => readReviewPref<"score" | "newest" | "quality">("sort", "score"));
  const [reviewLane, setReviewLane] = useState<ReviewLane>(() => {
    const saved = readReviewPref<string>("lane", "all");
    return reviewLanes.includes(saved as ReviewLane) ? saved as ReviewLane : "all";
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(() => new Set(readReviewPref<string[]>("people", [])));
  const [groupMinPeople, setGroupMinPeople] = useState(2);
  const [peopleFilter, setPeopleFilter] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [identityTarget, setIdentityTarget] = useState("");
  // M4: persist the filter context whenever it changes so it survives unmount.
  useEffect(() => {
    writeReviewPref({ statusFilter, search, sort, lane: reviewLane, people: [...selectedPeople] });
  }, [statusFilter, search, sort, reviewLane, selectedPeople]);
  const [privacyVeil, setPrivacyVeil] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedReviewView[]>([]);
  const [mediaActionDestination, setMediaActionDestination] = useState("");
  const [mediaActionDestinations, setMediaActionDestinations] = useState<string[]>([]);
  const [mediaActionPreview, setMediaActionPreview] = useState<{
    ids: string[];
    action: CandidateMediaAction;
    folder: string;
    offset: number;
    preview: CandidateMediaPreviewValue;
  } | null>(null);
  const [mediaActionHistory, setMediaActionHistory] = useState<MediaActionHistoryValue | null>(null);
  const [mediaActionHistoryOpen, setMediaActionHistoryOpen] = useState(false);
  const [pagedCandidates, setPagedCandidates] = useState<ReviewCandidate[]>([]);
  const [pagedTotal, setPagedTotal] = useState(0);
  const [pageOffset, setPageOffset] = useState(0);
  const [jumpRow, setJumpRow] = useState("");
  const [pagedLoading, setPagedLoading] = useState(false);
  const [pagedError, setPagedError] = useState<string | null>(null);
  const [selectReviewedAfterLoad, setSelectReviewedAfterLoad] = useState(false);
  const pageRequestRef = useRef(0);
  const deferredSearch = useDeferredValue(search);
  const pageSize = Math.max(25, props.renderBatchSize);
  const recentDecisionCandidate = useMemo(
    () => props.reviewUndo
      ? props.state.candidates.find((candidate) => candidate.candidateId === props.reviewUndo?.candidateId) ?? null
      : null,
    [props.reviewUndo, props.state.candidates]
  );
  const activeCandidate = useMemo(
    () => pagedCandidates.find((candidate) => candidate.candidateId === props.selectedCandidateId)
      ?? (props.selectedCandidate?.candidateId === props.selectedCandidateId ? props.selectedCandidate : null)
      ?? (recentDecisionCandidate?.candidateId === props.selectedCandidateId ? recentDecisionCandidate : null),
    [pagedCandidates, props.selectedCandidate, recentDecisionCandidate, props.selectedCandidateId]
  );

  useEffect(() => {
    setSavedViews(readSavedReviewViews(props.state.workspace));
    const key = `vintrace:media-destinations:${props.state.workspace || "default"}`;
    try {
      const rows = JSON.parse(window.localStorage.getItem(key) || "[]");
      setMediaActionDestinations(Array.isArray(rows) ? rows.filter((item) => typeof item === "string").slice(0, 6) : []);
    } catch {
      setMediaActionDestinations([]);
    }
    setMediaActionDestination("");
    setMediaActionPreview(null);
  }, [props.state.workspace]);

  useEffect(() => {
    setNoteDraft(activeCandidate?.note ?? "");
    setIdentityTarget("");
  }, [activeCandidate?.candidateId, activeCandidate?.note]);

  useEffect(() => {
    void refreshMediaActionHistory();
  }, [props.state.workspace]);

  const knownPeople = useMemo(() => {
    const people = new Set<string>();
    for (const ref of props.state.references) {
      const personName = safeText(ref.personName).trim();
      if (personName) people.add(personName);
    }
    for (const candidate of props.state.candidates) {
      const personName = safeText(candidate.personName).trim();
      if (personName && !isUnmatchedClusterName(personName)) {
        people.add(personName);
      }
    }
    return [...people].sort((a, b) => a.localeCompare(b));
  }, [props.state.candidates, props.state.references]);

  useEffect(() => {
    setSelectedPeople((current) => {
      const allowed = new Set(knownPeople);
      return new Set([...current].filter((person) => allowed.has(person)));
    });
  }, [knownPeople]);

  // M13: the group-finder rendered one button per distinct person with no bound.
  // Filter + cap the rendered chips (selected people are always kept) so a large
  // roster can't mount hundreds of buttons at once.
  const visiblePeople = useMemo(() => {
    const query = peopleFilter.trim().toLowerCase();
    const matched = query ? knownPeople.filter((person) => person.toLowerCase().includes(query)) : knownPeople;
    const ordered = query
      ? [...new Set([...knownPeople.filter((person) => selectedPeople.has(person)), ...matched])]
      : matched;
    return ordered.slice(0, PEOPLE_CHIP_CAP);
  }, [knownPeople, peopleFilter, selectedPeople]);
  const hiddenPeopleCount = knownPeople.length - visiblePeople.length;

  const candidatesByPath = useMemo(() => {
    const byPath = new Map<string, ReviewCandidate[]>();
    for (const candidate of props.state.candidates) {
      const key = candidateMediaPath(candidate);
      const rows = byPath.get(key) ?? [];
      rows.push(candidate);
      byPath.set(key, rows);
    }
    return byPath;
  }, [props.state.candidates]);

  const groupResults = useMemo(() => {
    const selected = [...selectedPeople];
    const requiredCount = Math.max(2, groupMinPeople, selected.length);
    return [...candidatesByPath.entries()]
      .map(([sourcePath, candidates]) => {
        const people = [...new Set(candidates
          .map((candidate) => safeText(candidate.personName).trim())
          .filter((personName) => personName && !isUnmatchedClusterName(personName)))]
          .sort((a, b) => a.localeCompare(b));
        const best = [...candidates].sort((a, b) => b.score - a.score)[0];
        return {
          sourcePath,
          label: best ? candidateSourceLabel(best) : basename(sourcePath),
          title: best ? candidateSourceTitle(best) : sourcePath,
          sourceUrl: best?.sourceUrl,
          mediaKind: best?.mediaKind ?? "image",
          people,
          candidates,
          bestScore: best?.score ?? 0,
          bestCandidateId: best?.candidateId ?? candidates[0]?.candidateId ?? "",
          statusMix: [...new Set(candidates.map((candidate) => candidate.status))]
        };
      })
      .filter((row) => row.people.length >= requiredCount)
      .filter((row) => selected.every((person) => row.people.includes(person)))
      .sort((a, b) => b.people.length - a.people.length || b.bestScore - a.bestScore || a.label.localeCompare(b.label));
  }, [candidatesByPath, groupMinPeople, selectedPeople]);

  const reviewSummary = useMemo(() => {
    const groupedCandidateIds = new Set(
      [...candidatesByPath.values()]
        .filter((rows) => new Set(rows.map((candidate) => candidate.personName)).size >= 2)
        .flatMap((rows) => rows.map((candidate) => candidate.candidateId))
    );
    const lowQualityThreshold = Math.max(0.2, props.state.config.thresholds.qualityMin);
    let high = 0;
    let lowQuality = 0;
    let notes = 0;
    let video = 0;
    let closeRunner = 0;
    let singleReference = 0;
    let pending = 0;
    let confidencePending = 0;
    let reviewed = 0;
    for (const candidate of props.state.candidates) {
      if (candidate.score >= props.state.config.thresholds.confident) {
        high += 1;
      }
      if (candidate.quality < lowQualityThreshold) {
        lowQuality += 1;
      }
      if (candidate.note.trim()) {
        notes += 1;
      }
      if (isVideoCandidate(candidate)) {
        video += 1;
      }
      if (hasCloseRunnerRisk(candidate)) {
        closeRunner += 1;
      }
      if (hasSingleReferenceRisk(candidate)) {
        singleReference += 1;
      }
      if (candidate.status === "pending") {
        pending += 1;
        if (candidate.score >= props.state.config.thresholds.confident) {
          confidencePending += 1;
        }
      } else {
        reviewed += 1;
      }
    }
    const laneCounts = props.state.reviewInsights?.laneCounts ?? {};
    const laneCount = (key: ReviewLane, fallback: number) => {
      const value = laneCounts[key];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    return {
      groupedCandidateIds,
      reviewLanes: [
        { key: "all" as const, label: "All", count: laneCount("all", props.state.counts.candidates || props.state.candidates.length) },
        { key: "high" as const, label: "Strong matches", count: laneCount("high", high) },
        { key: "closeRunner" as const, label: "Close calls", count: laneCount("closeRunner", closeRunner) },
        { key: "singleReference" as const, label: "One saved photo", count: laneCount("singleReference", singleReference) },
        { key: "lowQuality" as const, label: "Needs a closer look", count: laneCount("lowQuality", lowQuality) },
        { key: "groups" as const, label: "Groups", count: laneCount("groups", groupedCandidateIds.size) },
        { key: "video" as const, label: "Video moments", count: laneCount("video", video) },
        { key: "notes" as const, label: "Notes", count: laneCount("notes", notes) }
      ],
      smartBatches: [
        { key: "decision", label: "Needs decision", count: pending },
        { key: "confidence", label: "Looks strongest", count: confidencePending },
        { key: "closeRunner", label: "Close calls", count: props.state.reviewInsights?.closeRunnerUpPending ?? closeRunner },
        { key: "singleReference", label: "One saved photo", count: props.state.reviewInsights?.singleReferencePending ?? singleReference },
        { key: "quality", label: "Check quality", count: lowQuality },
        { key: "together", label: "People together", count: groupedCandidateIds.size },
        { key: "video", label: "Video moments", count: video },
        { key: "reviewed", label: "Already reviewed", count: reviewed }
      ] as const
    };
  }, [candidatesByPath, props.state.candidates, props.state.config.thresholds.confident, props.state.config.thresholds.qualityMin, props.state.counts.candidates, props.state.reviewInsights]);

  const querySignature = useMemo(() => JSON.stringify({
    workspace: props.state.workspaceMetadata?.workspaceId ?? props.state.workspace,
    statusFilter,
    reviewLane,
    search: deferredSearch.trim(),
    sort,
    pageSize,
    candidateCount: props.state.counts.candidates,
    pendingCount: props.state.counts.pending
  }), [deferredSearch, pageSize, props.state.counts.candidates, props.state.counts.pending, props.state.workspace, props.state.workspaceMetadata?.workspaceId, reviewLane, sort, statusFilter]);

  async function loadCandidatePage(append = false, requestedOffset?: number) {
    const requestId = pageRequestRef.current + 1;
    pageRequestRef.current = requestId;
    const offset = append ? pageOffset + pagedCandidates.length : Math.max(0, requestedOffset ?? pageOffset);
    setPagedLoading(true);
    setPagedError(null);
    try {
      const result = await props.queryCandidates({
        status: statusFilter,
        lane: reviewLane,
        query: deferredSearch.trim(),
        sort,
        offset,
        limit: pageSize,
        previewBudget: props.showListThumbnails ? Math.min(64, pageSize) : 0
      });
      if (requestId !== pageRequestRef.current) return;
      setPagedTotal(result.total);
      if (!append) {
        setPageOffset(offset);
      }
      setPagedCandidates((current) => append ? [...current, ...result.items] : result.items);
    } catch (error) {
      if (requestId !== pageRequestRef.current) return;
      setPagedError(error instanceof Error ? error.message : String(error));
      if (!append) {
        setPagedCandidates([]);
        setPagedTotal(0);
      }
    } finally {
      if (requestId === pageRequestRef.current) {
        setPagedLoading(false);
      }
    }
  }

  useEffect(() => {
    setPagedCandidates([]);
    setPagedTotal(0);
    setPageOffset(0);
    setJumpRow("");
    setPagedError(null);
    setSelectedIds(new Set());
    void loadCandidatePage(false, 0);
  }, [querySignature]);

  const filteredCandidates = useMemo(() => {
    if (pagedCandidates.length) {
      return pagedCandidates;
    }
    if (statusFilter === "pending" && recentDecisionCandidate && recentDecisionCandidate.status !== "pending") {
      return [recentDecisionCandidate];
    }
    return pagedCandidates;
  }, [pagedCandidates, recentDecisionCandidate, statusFilter]);
  const filteredTotal = Math.max(pagedTotal, filteredCandidates.length);
  const selectedIndex = filteredCandidates.findIndex((candidate) => candidate.candidateId === props.selectedCandidateId);
  const queuePosition = selectedIndex >= 0 ? selectedIndex + 1 : 0;
  const filteredStats = useMemo(() => {
    let pending = 0;
    let highConfidence = 0;
    for (const candidate of filteredCandidates) {
      if (candidate.status === "pending") pending += 1;
      if (candidate.score >= props.state.config.thresholds.confident) highConfidence += 1;
    }
    return {
      pending,
      reviewed: filteredCandidates.length - pending,
      highConfidence
    };
  }, [filteredCandidates, props.state.config.thresholds.confident]);
  const visibleCandidates = filteredCandidates;
  const visibleStart = filteredTotal && visibleCandidates.length ? pageOffset + 1 : 0;
  const visibleEnd = visibleCandidates.length ? Math.min(filteredTotal, pageOffset + visibleCandidates.length) : 0;
  const canPageBack = pageOffset > 0 && !pagedLoading;
  const canPageForward = pageOffset + pageSize < filteredTotal && !pagedLoading;

  function goToReviewOffset(offset: number) {
    const bounded = Math.max(0, Math.min(Math.max(0, filteredTotal - 1), offset));
    setSelectedIds(new Set());
    props.setSelectedCandidateId(null);
    void loadCandidatePage(false, Math.floor(bounded / pageSize) * pageSize);
  }

  function jumpToReviewRow() {
    const row = Math.max(1, Math.floor(Number(jumpRow) || 1));
    goToReviewOffset(row - 1);
  }

  useEffect(() => {
    if (!filteredCandidates.length) {
      if (props.selectedCandidateId) {
        props.setSelectedCandidateId(null);
      }
      return;
    }
    if (!props.selectedCandidateId || (!filteredCandidates.some((candidate) => candidate.candidateId === props.selectedCandidateId) && !activeCandidate)) {
      props.setSelectedCandidateId(filteredCandidates[0].candidateId);
    }
  }, [activeCandidate, filteredCandidates, props.selectedCandidateId]);

  useEffect(() => {
    if (selectReviewedAfterLoad) {
      if (pagedLoading) return;
      const reviewedIds = filteredCandidates
        .filter((candidate) => candidate.status !== "pending")
        .map((candidate) => candidate.candidateId);
      setSelectedIds(new Set(reviewedIds));
      if (reviewedIds[0]) {
        props.setSelectedCandidateId(reviewedIds[0]);
      }
      setSelectReviewedAfterLoad(false);
      return;
    }
    setSelectedIds((current) => {
      const allowed = new Set(filteredCandidates.map((candidate) => candidate.candidateId));
      return new Set([...current].filter((candidateId) => allowed.has(candidateId)));
    });
  }, [filteredCandidates, pagedLoading, props.setSelectedCandidateId, selectReviewedAfterLoad]);

  function editableTarget(target: EventTarget | null) {
    return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function selectRelativeCandidate(delta: number) {
    if (!filteredCandidates.length) return;
    const baseIndex = selectedIndex >= 0 ? selectedIndex : delta > 0 ? -1 : 0;
    const nextIndex = (baseIndex + delta + filteredCandidates.length) % filteredCandidates.length;
    props.setSelectedCandidateId(filteredCandidates[nextIndex].candidateId);
  }

  async function decide(status: CandidateStatus) {
    if (!activeCandidate) return;
    const target = activeCandidate;
    const previousStatus = target.status;
    const nextCandidate = filteredCandidates.length > 1 && selectedIndex >= 0
      ? filteredCandidates[(selectedIndex + 1) % filteredCandidates.length]
      : null;
    const advanced = Boolean(nextCandidate && nextCandidate.candidateId !== target.candidateId);
    // H4: turn the row over and advance the selection IMMEDIATELY, then persist
    // the decision with a quiet write (no global spinner, shortcuts stay live).
    // The decision is rolled back if the backend rejects it; the undo strip
    // remains as a second safety net.
    setPagedCandidates((current) => current.map((candidate) => (
      candidate.candidateId === target.candidateId ? { ...candidate, status } : candidate
    )));
    if (advanced) {
      props.setSelectedCandidateId(nextCandidate!.candidateId);
    } else if (statusFilter === "pending" && status !== "pending") {
      props.setSelectedCandidateId(target.candidateId);
      setStatusFilter("all");
    }
    try {
      await props.review(status, target, true);
    } catch {
      setPagedCandidates((current) => current.map((candidate) => (
        candidate.candidateId === target.candidateId ? { ...candidate, status: previousStatus } : candidate
      )));
      return;
    }
    // Reconcile with the backend list except when the filter change above already
    // triggers its own reload (preserves the original navigation semantics).
    if (advanced || !(statusFilter === "pending" && status !== "pending")) {
      void loadCandidatePage(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof Element ? event.target : null;
      // L4: also ignore focused links and any element opted out via
      // data-no-shortcuts so a stray letter can't fire an action there. NOTE:
      // candidate rows are role=button but are intentionally NOT ignored — the
      // a/r/u shortcuts act on the *selected* candidate and must keep working
      // while a row is focused (the common rapid-review case).
      const interactiveTarget = target?.closest("button, a[href], [data-no-shortcuts], [role='dialog'], input, textarea, select, [contenteditable='true']");
      if (props.busy || editableTarget(event.target) || interactiveTarget || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        void decide("accepted");
      } else if (key === "r") {
        event.preventDefault();
        void decide("rejected");
      } else if (key === "u") {
        event.preventDefault();
        void decide("uncertain");
      } else if (key === "b") {
        event.preventDefault();
        void blockActiveFalseMatch();
      } else if (key === "v") {
        event.preventDefault();
        setPrivacyVeil((value) => !value);
      } else if (key === "x") {
        event.preventDefault();
        if (activeCandidate) toggleCandidate(activeCandidate.candidateId);
      } else if (key === "?" || key === "/") {
        event.preventDefault();
        setShortcutsOpen((value) => !value);
      } else if (key === "arrowdown" || key === "n" || key === "j") {
        event.preventDefault();
        selectRelativeCandidate(1);
      } else if (key === "arrowup" || key === "p" || key === "k") {
        event.preventDefault();
        selectRelativeCandidate(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.busy, activeCandidate?.candidateId, filteredCandidates, selectedIndex]);

  function toggleCandidate(candidateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) {
        next.delete(candidateId);
      } else {
        next.add(candidateId);
      }
      return next;
    });
  }

  function togglePerson(personName: string) {
    const next = new Set(selectedPeople);
    if (next.has(personName)) {
      next.delete(personName);
    } else {
      next.add(personName);
    }
    setSelectedPeople(next);
    setGroupMinPeople((value) => Math.max(value, next.size, 2));
  }

  function selectVisible() {
    setSelectedIds(new Set(visibleCandidates.map((candidate) => candidate.candidateId)));
  }

  function selectAllFiltered() {
    if (!filteredCandidates.length) return;
    setSelectedIds(new Set(filteredCandidates.map((candidate) => candidate.candidateId)));
  }

  function activateSmartBatch(batch: typeof reviewSummary.smartBatches[number]["key"]) {
    setSelectReviewedAfterLoad(false);
    if (batch === "decision") {
      setStatusFilter("pending");
      setReviewLane("all");
      setSort("score");
    } else if (batch === "confidence") {
      setStatusFilter("pending");
      setReviewLane("high");
      setSort("score");
    } else if (batch === "closeRunner") {
      setStatusFilter("pending");
      setReviewLane("closeRunner");
      setSort("score");
    } else if (batch === "singleReference") {
      setStatusFilter("pending");
      setReviewLane("singleReference");
      setSort("score");
    } else if (batch === "quality") {
      setStatusFilter("all");
      setReviewLane("lowQuality");
      setSort("quality");
    } else if (batch === "together") {
      setStatusFilter("all");
      setReviewLane("groups");
      setSort("score");
    } else if (batch === "video") {
      setStatusFilter("all");
      setReviewLane("video");
      setSort("score");
    } else {
      setStatusFilter("all");
      setReviewLane("all");
      setSort("newest");
      setSelectedIds(new Set());
      setSelectReviewedAfterLoad(true);
    }
  }

  function persistReviewViews(next: SavedReviewView[]) {
    const sorted = next.sort((a, b) => b.lastUsedAt - a.lastUsedAt).slice(0, 16);
    setSavedViews(sorted);
    writeSavedReviewViews(props.state.workspace, sorted);
  }

  function saveCurrentReviewView() {
    const defaultLabel = `${reviewLane === "all" ? "All matches" : reviewSummary.reviewLanes.find((lane) => lane.key === reviewLane)?.label ?? "Review view"}${statusFilter === "all" ? "" : `, ${reviewStatusLabel(statusFilter)}`}`;
    const label = promptUi("Name this review view", defaultLabel)?.trim();
    if (!label) return;
    const now = Date.now();
    const existing = savedViews.filter((view) => view.label.toLowerCase() !== label.toLowerCase());
    persistReviewViews([
      {
        id: `${label}:${now}`,
        label,
        statusFilter,
        reviewLane,
        search,
        sort,
        createdAt: now,
        lastUsedAt: now
      },
      ...existing
    ]);
  }

  function applyReviewView(view: SavedReviewView) {
    setStatusFilter(view.statusFilter);
    setReviewLane(view.reviewLane);
    setSearch(view.search);
    setSort(view.sort);
    persistReviewViews(savedViews.map((item) => item.id === view.id ? { ...item, lastUsedAt: Date.now() } : item));
  }

  function removeReviewView(viewId: string) {
    persistReviewViews(savedViews.filter((view) => view.id !== viewId));
  }

  async function bulkStatus(status: CandidateStatus) {
    const ids = [...selectedIds];
    if (ids.length > 1 && !await confirmDialog(`Mark ${ids.length} selected possible matches as ${reviewStatusLabel(status)}?`)) {
      return;
    }
    await props.bulkReview(ids, status);
    setSelectedIds(new Set());
    void loadCandidatePage(false);
  }

  function mediaActionLabel(action: CandidateMediaAction) {
    return action === "copy" ? "Copy files" : action === "move" ? "Move files" : "Move to app trash";
  }

  function rememberMediaActionDestination(folder: string) {
    const clean = folder.trim();
    if (!clean) return;
    const next = [clean, ...mediaActionDestinations.filter((item) => item !== clean)].slice(0, 6);
    setMediaActionDestinations(next);
    try {
      window.localStorage.setItem(`vintrace:media-destinations:${props.state.workspace || "default"}`, JSON.stringify(next));
    } catch {
      // Recent destinations are a convenience only.
    }
  }

  async function chooseMediaActionDestination() {
    const folder = await props.chooseDestinationFolder();
    if (!folder) return;
    setMediaActionDestination(folder);
    rememberMediaActionDestination(folder);
    if (mediaActionPreview) {
      await prepareCandidateMediaAction(mediaActionPreview.ids, mediaActionPreview.action, folder, mediaActionPreview.offset);
    }
  }

  async function refreshMediaActionHistory() {
    try {
      const history = await props.loadMediaActionHistory();
      setMediaActionHistory(history);
    } catch {
      setMediaActionHistory(null);
    }
  }

  async function prepareCandidateMediaAction(ids: string[], action: CandidateMediaAction, folderOverride?: string, itemOffset = 0) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) return;
    const folder = folderOverride ?? mediaActionDestination.trim();
    const preview = await props.previewCandidateMediaAction(uniqueIds, action, folder || undefined, itemOffset, 40);
    if (!preview) return;
    setMediaActionPreview({ ids: uniqueIds, action, folder, offset: itemOffset, preview });
  }

  async function executePreparedMediaAction() {
    if (!mediaActionPreview) return;
    const { ids, action, folder } = mediaActionPreview;
    const result = await props.manageCandidateMedia(ids, action, folder || undefined);
    if (folder) {
      rememberMediaActionDestination(folder);
    }
    setMediaActionPreview(null);
    if (action !== "copy") {
      setSelectedIds(new Set());
      const removed = new Set(ids);
      setPagedCandidates((current) => current.filter((candidate) => !removed.has(candidate.candidateId)));
      if (activeCandidate && removed.has(activeCandidate.candidateId)) {
        const nextCandidate = filteredCandidates.find((candidate) => !removed.has(candidate.candidateId));
        props.setSelectedCandidateId(nextCandidate?.candidateId ?? null);
      }
    }
    if (result?.counts.skipped) {
      setMediaActionHistoryOpen(true);
    }
    await refreshMediaActionHistory();
    void loadCandidatePage(false);
  }

  async function restoreHistoryItem(manifestPath: string) {
    await props.restoreMediaAction(manifestPath);
    await refreshMediaActionHistory();
  }

  async function retryHistoryItem(manifestPath: string) {
    await props.retryMediaAction(manifestPath);
    await refreshMediaActionHistory();
    void loadCandidatePage(false);
  }

  async function retryHistoryItemToNewDestination(manifestPath: string) {
    const folder = await props.chooseDestinationFolder();
    if (!folder) return;
    await props.retryMediaAction(manifestPath, folder);
    rememberMediaActionDestination(folder);
    await refreshMediaActionHistory();
    void loadCandidatePage(false);
  }

  async function undoHistoryItem(manifestPath?: string) {
    await props.undoMediaAction(manifestPath);
    await refreshMediaActionHistory();
    void loadCandidatePage(false);
  }

  async function saveActiveNote() {
    if (!activeCandidate) return;
    await props.saveCandidateNote(activeCandidate.candidateId, noteDraft);
    void loadCandidatePage(false);
  }

  async function moveActiveCandidate() {
    if (!activeCandidate) return;
    await props.reassignCandidatePerson(activeCandidate.candidateId, identityTarget);
    setIdentityTarget("");
    void loadCandidatePage(false);
  }

  async function blockActiveFalseMatch() {
    if (!activeCandidate) return;
    await props.blockFalseMatch(activeCandidate.candidateId);
    void loadCandidatePage(false);
  }

  function copyGroupResults() {
    const selected = [...selectedPeople];
    const header = selected.length ? `People together: ${selected.join(", ")}` : `People together: ${groupMinPeople}+ people`;
    const lines = groupResults.map((row, index) => (
      `${index + 1}. ${row.label}\n   People: ${row.people.join(", ")}\n   Matches: ${row.candidates.length}\n   Path: ${row.sourcePath}`
    ));
    props.copyText([header, "", ...lines].join("\n"), "Group results");
  }

  return (
    <section className="review-page">
      <div className="panel group-finder-panel">
        <div className="panel-title">
          <Users size={18} /> Find people together
          <span className="title-count">{groupResults.length}</span>
          <div className="spacer" />
          <button className="ghost compact-action" onClick={copyGroupResults} disabled={!groupResults.length}>
            <Archive size={16} />
            <span>Copy</span>
          </button>
        </div>
        <div className="group-finder-controls">
          <label>At least this many people
            <input
              aria-label="Minimum people together"
              type="number"
              min={2}
              max={50}
              value={groupMinPeople}
              onChange={(event) => setGroupMinPeople(Math.max(2, selectedPeople.size, Number(event.currentTarget.value) || 2))}
            />
          </label>
          {knownPeople.length > PEOPLE_CHIP_CAP && (
            <input
              className="person-chip-filter"
              type="search"
              value={peopleFilter}
              onChange={(event) => setPeopleFilter(event.currentTarget.value)}
              placeholder="Filter people"
              aria-label="Filter people to find together"
            />
          )}
          <div className="person-chip-list" role="group" aria-label="People to find together">
            {knownPeople.length ? visiblePeople.map((person) => (
              <button
                key={person}
                className={selectedPeople.has(person) ? "person-chip selected" : "person-chip"}
                onClick={() => togglePerson(person)}
                type="button"
              >
                <span>{person}</span>
                {selectedPeople.has(person) && <Check size={14} />}
              </button>
            )) : <span className="compact">Add people and scan photos to find group photos.</span>}
            {hiddenPeopleCount > 0 && (
              <span className="compact person-chip-overflow">+{hiddenPeopleCount} more — filter to narrow.</span>
            )}
          </div>
          <button className="ghost compact-action" onClick={() => setSelectedPeople(new Set())} disabled={!selectedPeople.size}>
            Clear
          </button>
        </div>
        <div className="group-results">
          {groupResults.length ? groupResults.map((row) => (
            <button
              key={row.sourcePath}
              className="group-result-row"
              onClick={() => props.setSelectedCandidateId(row.bestCandidateId)}
              type="button"
            >
              <span className="thumb group-thumb">
                {row.sourceUrl ? <img src={row.sourceUrl} alt="" /> : row.mediaKind === "video" ? <Video size={18} /> : <ImageIcon size={18} />}
              </span>
              <span className="group-result-main">
                <strong>{row.label}</strong>
                <span title={row.title}>{row.sourcePath}</span>
              </span>
              <span className="group-people">
                {row.people.slice(0, 6).map((person) => <span key={person}>{person}</span>)}
                {row.people.length > 6 && <span>+{row.people.length - 6}</span>}
              </span>
              <span className="group-meta">
                <strong>{row.people.length}</strong>
                <small>{row.statusMix.join(", ")}</small>
              </span>
              <ChevronRight size={16} />
            </button>
          )) : (
            <EmptyState
              icon={Users}
              label="No group photos found"
              detail={selectedPeople.size ? "Scan photos where the selected people appear together." : "Choose people or raise the minimum to find photos with 2, 3, or more matched people."}
            />
          )}
        </div>
      </div>
      {props.state.videoMoments && props.state.videoMoments.length > 0 && (
        <div className="panel group-finder-panel video-moments-panel">
          <div className="panel-title">
            <Video size={18} /> Video moments
            <span className="title-count">{props.state.videoMoments.length}</span>
          </div>
          <div className="group-results">
            {props.state.videoMoments.slice(0, 8).map((moment) => (
              <button
                key={moment.mediaSourcePath}
                className="group-result-row"
                onClick={() => moment.candidateIds[0] && props.setSelectedCandidateId(moment.candidateIds[0])}
                type="button"
              >
                <span className="thumb group-thumb">
                  {moment.previewUrl ? <img src={moment.previewUrl} alt="" /> : <Video size={18} />}
                </span>
                <span className="group-result-main">
                  <strong>{basename(moment.mediaSourcePath)}</strong>
                  <span>{formatMediaTimestamp(moment.firstTimestampMs)} - {formatMediaTimestamp(moment.lastTimestampMs)}</span>
                </span>
                <span className="group-people">
                  {moment.people.length ? moment.people.slice(0, 5).map((person) => <span key={person}>{person}</span>) : <span>Similar frames</span>}
                </span>
                <span className="group-meta">
                  <strong>{moment.count}</strong>
                  <small>{scoreLabel(moment.bestScore)}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="panel table-panel compact-table review-queue-panel">
        <div className="panel-title">
          <ShieldCheck size={18} /> Possible matches
          <span className="title-count">{filteredTotal}</span>
          {pagedLoading && <span className="subtle-inline"><Loader2 size={14} className="spin" /> Loading</span>}
          <div className="spacer" />
          <button className="ghost compact-action" onClick={() => setShortcutsOpen((value) => !value)} type="button">
            <BookOpen size={16} />
            <span>Shortcuts</span>
          </button>
        </div>
        {shortcutsOpen && (
          <div className="shortcut-strip">
            <span><kbd>A</kbd> looks right</span>
            <span><kbd>R</kbd> not a match</span>
            <span><kbd>U</kbd> not sure</span>
            <span><kbd>J</kbd>/<kbd>K</kbd> next/previous</span>
            <span><kbd>X</kbd> select row</span>
            <span><kbd>B</kbd> block false match</span>
            <span><kbd>V</kbd> hide previews</span>
          </div>
        )}
        {props.reviewUndo && (
          <div className="undo-strip">
            <span>
              <strong>{reviewStatusLabel(props.reviewUndo.nextStatus)}</strong>
              {props.reviewUndo.label}
            </span>
            <button className="secondary" onClick={() => void props.undoReview()} disabled={props.busy} type="button">
              <Undo2 size={16} />
              <span>Undo decision</span>
            </button>
          </div>
        )}
        <div className="saved-view-strip" role="group" aria-label="Saved review views">
          <button className="smart-batch save-view" onClick={saveCurrentReviewView} type="button">
            <span>Save current view</span>
            <strong>{filteredTotal}</strong>
          </button>
          {savedViews.map((view) => (
            <span className="saved-view-chip" key={view.id}>
              <button onClick={() => applyReviewView(view)} type="button" title={`${view.search || "No search"} • ${reviewStatusLabel(view.statusFilter)}`}>
                {view.label}
              </button>
              <button onClick={() => removeReviewView(view.id)} type="button" aria-label={`Remove ${view.label}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        {props.state.reviewInsights && (
          <div className="smart-batch-strip" role="group" aria-label="Review sources">
            <button className="smart-batch" onClick={() => activateSmartBatch(props.state.reviewInsights!.recommendedOrder === "strongest-first" ? "confidence" : "decision")} type="button">
              <span>{props.state.reviewInsights.recommendedOrder === "strongest-first" ? "Best next" : "Needs decision"}</span>
              <strong>{props.state.reviewInsights.pending}</strong>
            </button>
            <button className="smart-batch" onClick={() => activateSmartBatch("video")} type="button" disabled={!props.state.reviewInsights.videoPending}>
              <span>Videos</span>
              <strong>{props.state.reviewInsights.videoPending}</strong>
            </button>
            {props.state.reviewInsights.topFolders.slice(0, 3).map((folder) => (
              <button key={folder.folder} className="smart-batch" onClick={() => setSearch(folder.folder)} type="button">
                <span>{basename(folder.folder)}</span>
                <strong>{folder.count}</strong>
              </button>
            ))}
          </div>
        )}
        <div className="smart-batch-strip" role="group" aria-label="Smart review batches">
          {reviewSummary.smartBatches.map((batch) => (
            <button key={batch.key} className="smart-batch" onClick={() => activateSmartBatch(batch.key)} type="button" disabled={!batch.count}>
              <span>{batch.label}</span>
              <strong>{batch.count}</strong>
            </button>
          ))}
        </div>
        <div className="review-lanes" role="group" aria-label="Review priority lanes">
          {reviewSummary.reviewLanes.map((lane) => (
            <button
              key={lane.key}
              aria-pressed={reviewLane === lane.key}
              className={reviewLane === lane.key ? "lane-button selected" : "lane-button"}
              onClick={() => setReviewLane(lane.key)}
              type="button"
            >
              <span>{lane.label}</span>
              <strong>{lane.count}</strong>
            </button>
          ))}
        </div>
        <div className="review-filter-grid">
          <input aria-label="Search possible matches" placeholder="Search matches" value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
          <select aria-label="Status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value as CandidateStatus | "all")}>
            <option value="pending">{reviewStatusLabel("pending")}</option>
            <option value="all">{reviewStatusLabel("all")}</option>
            {reviewStatuses.map((status) => <option key={status} value={status}>{reviewStatusLabel(status)}</option>)}
          </select>
          <select aria-label="Sort possible matches" value={sort} onChange={(event) => setSort(event.currentTarget.value as "score" | "newest" | "quality")}>
            <option value="score">strongest first</option>
            <option value="newest">newest first</option>
            <option value="quality">best photo first</option>
          </select>
        </div>
        <div className="bulk-bar">
          <button className="ghost compact-action" onClick={selectVisible} disabled={!visibleCandidates.length || props.busy}>Select shown</button>
          <button className="ghost compact-action" onClick={selectAllFiltered} disabled={!filteredCandidates.length || props.busy}>Select loaded</button>
          <span>{selectedIds.size} selected</span>
          <button className="secondary" onClick={() => bulkStatus("accepted")} disabled={!selectedIds.size || props.busy}><Check size={16} /><span>Looks right</span></button>
          <button className="secondary" onClick={() => bulkStatus("rejected")} disabled={!selectedIds.size || props.busy}><X size={16} /><span>Not a match</span></button>
          <button className="secondary" onClick={() => bulkStatus("uncertain")} disabled={!selectedIds.size || props.busy}><AlertCircle size={16} /><span>Not sure</span></button>
          <button className="secondary" onClick={() => props.exportSelectedCandidates([...selectedIds])} disabled={!selectedIds.size || props.busy}><Archive size={16} /><span>Export</span></button>
          <button className="secondary" onClick={() => void prepareCandidateMediaAction([...selectedIds], "copy")} disabled={!selectedIds.size || props.busy}><CopyIcon size={16} /><span>Copy files</span></button>
          <button className="secondary" onClick={() => void prepareCandidateMediaAction([...selectedIds], "move")} disabled={!selectedIds.size || props.busy}><Scissors size={16} /><span>Move files</span></button>
          <button className="secondary danger" onClick={() => void prepareCandidateMediaAction([...selectedIds], "trash")} disabled={!selectedIds.size || props.busy}><Trash2 size={16} /><span>Trash files</span></button>
        </div>
        <div className="review-page-controls" aria-label="Review page navigation">
          <span>
            Showing <strong>{formatNumber(visibleStart)}</strong>-<strong>{formatNumber(visibleEnd)}</strong> of <strong>{formatNumber(filteredTotal)}</strong>
          </span>
          <button className="ghost compact-action" onClick={() => goToReviewOffset(pageOffset - pageSize)} disabled={!canPageBack} type="button">
            <ChevronLeft size={16} />
            <span>Previous</span>
          </button>
          <button className="ghost compact-action" onClick={() => goToReviewOffset(pageOffset + pageSize)} disabled={!canPageForward} type="button">
            <span>Next</span>
            <ChevronRight size={16} />
          </button>
          <button className="ghost compact-action" onClick={() => void loadCandidatePage(false)} disabled={pagedLoading} type="button">
            <RefreshCcw size={16} />
            <span>Refresh</span>
          </button>
          <label>
            <span>Jump to row</span>
            <input
              aria-label="Jump to review row"
              inputMode="numeric"
              min={1}
              max={Math.max(1, filteredTotal)}
              type="number"
              value={jumpRow}
              onChange={(event) => setJumpRow(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  jumpToReviewRow();
                }
              }}
            />
          </label>
          <button className="secondary compact-action" onClick={jumpToReviewRow} disabled={pagedLoading || !filteredTotal} type="button">Go</button>
        </div>
        {mediaActionPreview && (
          <div className="media-action-preview" role="region" aria-label="File action preview">
            <div className="panel-title">
              {mediaActionPreview.action === "copy" ? <CopyIcon size={18} /> : mediaActionPreview.action === "move" ? <Scissors size={18} /> : <Trash2 size={18} />}
              <span>{mediaActionLabel(mediaActionPreview.action)}</span>
              <div className="spacer" />
              <button className="ghost compact-action" onClick={() => setMediaActionPreview(null)} type="button">
                <X size={16} />
                <span>Cancel</span>
              </button>
            </div>
            <div className="media-action-stats">
              <span><small>Ready</small><strong>{mediaActionPreview.preview.counts.actionable}</strong></span>
              <span><small>Unique files</small><strong>{mediaActionPreview.preview.counts.uniqueSources}</strong></span>
              <span><small>Size</small><strong>{formatBytes(mediaActionPreview.preview.counts.totalBytes)}</strong></span>
              <span><small>Duplicates</small><strong>{mediaActionPreview.preview.counts.duplicateSources}</strong></span>
              <span><small>Skipped</small><strong>{mediaActionPreview.preview.counts.skipped}</strong></span>
              <span><small>Review rows</small><strong>{mediaActionPreview.preview.counts.removedCandidatesEstimate}</strong></span>
            </div>
            <div className="media-action-destination">
              <span title={mediaActionPreview.preview.destinationRoot}>
                <strong>Destination</strong>
                {mediaActionPreview.folder || "Vintrace managed folder"}
              </span>
              <span>
                <strong>Free space</strong>
                {mediaActionPreview.preview.storage.freeBytes ? formatBytes(mediaActionPreview.preview.storage.freeBytes) : "Unknown"}
              </span>
              <button className="secondary" onClick={() => void chooseMediaActionDestination()} type="button">
                <FolderOpen size={16} />
                <span>Choose folder</span>
              </button>
              <button className="ghost compact-action" onClick={() => void prepareCandidateMediaAction(mediaActionPreview.ids, mediaActionPreview.action, "", mediaActionPreview.offset)} type="button">
                Use default
              </button>
            </div>
            {mediaActionDestinations.length > 0 && (
              <div className="media-action-recents" aria-label="Recent file action destinations">
                {mediaActionDestinations.slice(0, 4).map((folder) => (
                  <button key={folder} className="saved-view-chip" onClick={() => void prepareCandidateMediaAction(mediaActionPreview.ids, mediaActionPreview.action, folder, mediaActionPreview.offset)} title={folder} type="button">
                    {basename(folder)}
                  </button>
                ))}
              </div>
            )}
            <div className="media-action-preview-list">
              {mediaActionPreview.preview.items.map((item) => (
                <span key={item.candidateId} className={item.result === "skipped" ? "preview-item skipped" : "preview-item"} title={item.sourcePath}>
                  <strong>{basename(item.sourcePath)}</strong>
                  <small>{item.result === "ready" || item.result === "duplicate_source" ? `${formatBytes(item.sizeBytes)} ${item.duplicate ? "duplicate" : ""}` : item.reason || item.result}</small>
                </span>
              ))}
            </div>
            <div className="media-action-pager">
              <span>
                Showing {mediaActionPreview.preview.itemsOffset + 1}-{Math.min(mediaActionPreview.preview.itemsOffset + mediaActionPreview.preview.items.length, mediaActionPreview.preview.itemsTotal)} of {mediaActionPreview.preview.itemsTotal}
              </span>
              <button className="ghost compact-action" onClick={() => void prepareCandidateMediaAction(mediaActionPreview.ids, mediaActionPreview.action, mediaActionPreview.folder, Math.max(0, mediaActionPreview.preview.itemsOffset - mediaActionPreview.preview.itemsLimit))} disabled={mediaActionPreview.preview.itemsOffset <= 0} type="button">
                Previous
              </button>
              <button className="ghost compact-action" onClick={() => void prepareCandidateMediaAction(mediaActionPreview.ids, mediaActionPreview.action, mediaActionPreview.folder, mediaActionPreview.preview.itemsOffset + mediaActionPreview.preview.itemsLimit)} disabled={!mediaActionPreview.preview.truncated} type="button">
                Next
              </button>
            </div>
            {mediaActionPreview.preview.warnings.length > 0 && (
              <div className="settings-warning">
                <AlertCircle size={16} />
                <span>{mediaActionPreview.preview.warnings.join(" ")}</span>
              </div>
            )}
            {mediaActionPreview.preview.counts.skipped > 0 && (
              <div className="media-action-errors">
                {mediaActionPreview.preview.items.filter((item) => item.result === "skipped").slice(0, 4).map((item) => (
                  <span key={item.candidateId} title={item.sourcePath}>
                    <strong>{basename(item.sourcePath)}</strong>
                    {item.reason || "Skipped"}
                  </span>
                ))}
              </div>
            )}
            {props.mediaActionProgress && props.mediaActionProgress.phase !== "complete" && (
              <div className="media-action-progress">
                <progress max={Math.max(1, props.mediaActionProgress.total || 1)} value={props.mediaActionProgress.processed || 0} />
                <span>{props.mediaActionProgress.processed}/{props.mediaActionProgress.total} files</span>
                <span>{props.mediaActionProgress.etaMs ? `${formatDuration(Math.round(props.mediaActionProgress.etaMs))} remaining` : "Preparing"}</span>
                <button className="ghost compact-action danger" onClick={() => void props.cancelMediaAction()} type="button">Cancel</button>
              </div>
            )}
            <div className="button-row">
              <button className={mediaActionPreview.action === "trash" ? "secondary danger" : "primary"} onClick={() => void executePreparedMediaAction()} disabled={props.busy || mediaActionPreview.preview.counts.actionable === 0} type="button">
                {mediaActionPreview.action === "copy" ? <CopyIcon size={17} /> : mediaActionPreview.action === "move" ? <Scissors size={17} /> : <Trash2 size={17} />}
                <span>{mediaActionLabel(mediaActionPreview.action)}</span>
              </button>
              <button className="secondary" onClick={() => setMediaActionPreview(null)} type="button">Cancel</button>
            </div>
          </div>
        )}
        {pagedError && (
          <div className="settings-warning" role="alert">
            <AlertCircle size={16} />
            <span>{pagedError}</span>
            <button className="ghost compact-action" onClick={() => void loadCandidatePage(false)} type="button">Retry</button>
          </div>
        )}
        <div className="table">
          {filteredCandidates.length === 0 && pagedLoading ? (
            /* M5: row-shaped skeletons (instead of a single centered spinner)
               so the loading state previews the layout that's about to appear. */
            <div className="skeleton-list" role="status" aria-busy="true" aria-label="Loading matches">
              {Array.from({ length: 6 }, (_, index) => (
                <div className="row review-candidate-row skeleton-row" key={`skeleton-${index}`} aria-hidden="true">
                  <span className="skeleton-cell skeleton-check" />
                  <span className="skeleton-cell skeleton-strong" />
                  <span className="skeleton-cell" />
                  <span className="skeleton-cell" />
                  <span className="skeleton-cell" />
                  <span />
                </div>
              ))}
            </div>
          ) : filteredCandidates.length === 0 ? <EmptyState icon={ShieldCheck} label="No possible matches found" detail="Adjust the filter or scan more photos and videos." /> : (
            <>
              <div className="table-header review-candidate-header" aria-hidden="true">
                <span />
                <span>Possible match</span>
                <span>Status</span>
                <span>Strength</span>
                <span>Source</span>
                <span />
              </div>
              {visibleCandidates.map((candidate) => (
                <div
                  key={candidate.candidateId}
                  className={[
                    "row review-candidate-row",
                    props.selectedCandidateId === candidate.candidateId ? "selected" : "",
                    hasCloseRunnerRisk(candidate) ? "risk-close-runner" : "",
                    hasSingleReferenceRisk(candidate) ? "risk-single-reference" : ""
                  ].filter(Boolean).join(" ")}
                  role="button"
                  tabIndex={0}
                  onClick={() => props.setSelectedCandidateId(candidate.candidateId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.setSelectedCandidateId(candidate.candidateId);
                    }
                  }}
                >
                  <input
                    aria-label={`Select ${candidateSourceLabel(candidate)}`}
                    type="checkbox"
                    checked={selectedIds.has(candidate.candidateId)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => toggleCandidate(candidate.candidateId)}
                  />
                  <CandidateIdentity candidate={candidate} showThumbnail={props.showListThumbnails} />
                  <span className={`status ${candidate.status}`}>{reviewStatusLabel(candidate.status)}</span>
                  <span
                    className="score-cell"
                    style={{ "--score-width": `${Math.max(2, Math.round(candidate.score * 100))}%` } as CSSProperties}
                    aria-label={`score ${scoreLabel(candidate.score)}`}
                  >
                    <strong>{scoreLabel(candidate.score)}</strong>
                    <i />
                  </span>
                  <span title={candidateSourceTitle(candidate)}>{candidateSourceLabel(candidate)}</span>
                  <ChevronRight size={16} />
                </div>
              ))}
              {pageOffset + visibleCandidates.length < filteredTotal && (
                <button
                  className="row load-more-row"
                  onClick={() => void loadCandidatePage(true)}
                  disabled={pagedLoading}
                  type="button"
                >
                  <span />
                  <span>Showing {visibleCandidates.length} of {filteredTotal}</span>
                  <span />
                  <span />
                  <span>{pagedLoading ? "Loading" : "Load more"}</span>
                  {pagedLoading ? <Loader2 size={16} className="spin" /> : <ChevronRight size={16} />}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div className="panel preview-panel">
        {activeCandidate ? (
          <>
            <div className="panel-title">
              <ShieldCheck size={18} />
              <span className="panel-heading-text">Review match</span>
              <div className="spacer" />
              <button
                aria-pressed={privacyVeil}
                className="ghost compact-action"
                onClick={() => setPrivacyVeil((value) => !value)}
                title={privacyVeil ? "Show previews" : "Hide previews"}
                type="button"
              >
                {privacyVeil ? <Eye size={16} /> : <EyeOff size={16} />}
                <span>{privacyVeil ? "Show previews" : "Hide previews"}</span>
              </button>
              <button className="ghost compact-action" onClick={() => props.revealPath(candidateMediaPath(activeCandidate))} type="button">
                <FolderOpen size={16} />
                <span>Reveal</span>
              </button>
              <button className="ghost compact-action" onClick={() => props.openPath(candidateMediaPath(activeCandidate))} type="button">
                <ExternalLink size={16} />
                <span>Open</span>
              </button>
              <button className="ghost compact-action" onClick={() => void prepareCandidateMediaAction([activeCandidate.candidateId], "copy")} disabled={props.busy} type="button">
                <CopyIcon size={16} />
                <span>Copy</span>
              </button>
              <button className="ghost compact-action" onClick={() => void prepareCandidateMediaAction([activeCandidate.candidateId], "move")} disabled={props.busy} type="button">
                <Scissors size={16} />
                <span>Move</span>
              </button>
              <button className="ghost compact-action danger" onClick={() => void prepareCandidateMediaAction([activeCandidate.candidateId], "trash")} disabled={props.busy} type="button">
                <Trash2 size={16} />
                <span>Trash</span>
              </button>
              <span className={`status ${activeCandidate.status}`}>{reviewStatusLabel(activeCandidate.status)}</span>
            </div>
            <div className="review-session-bar" aria-label="Review session progress">
              <span>
                <small>Match position</small>
                <strong>{queuePosition || "0"} / {filteredTotal}</strong>
              </span>
              <span>
                <small>Loaded to review</small>
                <strong>{filteredStats.pending}</strong>
              </span>
              <span>
                <small>Loaded reviewed</small>
                <strong>{filteredStats.reviewed}</strong>
              </span>
              <span>
                <small>Loaded strong</small>
                <strong>{filteredStats.highConfidence}</strong>
              </span>
              <div className="session-nav">
                <button className="icon-button" aria-label="Previous match" onClick={() => selectRelativeCandidate(-1)} disabled={filteredCandidates.length < 2} type="button">
                  <ArrowLeft size={17} />
                </button>
                <button className="icon-button" aria-label="Next match" onClick={() => selectRelativeCandidate(1)} disabled={filteredCandidates.length < 2} type="button">
                  <ArrowRight size={17} />
                </button>
              </div>
            </div>
            <div className="preview-grid">
              <ImagePreview label={isVideoCandidate(activeCandidate) ? "Video frame to check" : "Photo to check"} url={activeCandidate.sourceUrl} fallback={activeCandidate.sourcePath} concealed={privacyVeil} />
              <ImagePreview label="Saved person photo" url={activeCandidate.bestRefUrl} fallback={activeCandidate.bestRefPath} concealed={privacyVeil} />
            </div>
            <div className="candidate-detail">
              <h2>{activeCandidate.personName}</h2>
              <div className="bands">
                <span className="band confident">{matchBandLabel(activeCandidate.band)}</span>
                <span className="band likely">strength {scoreLabel(activeCandidate.score)}</span>
                <span className="band maybe">photo quality {scoreLabel(activeCandidate.quality)}</span>
              </div>
              <p className="source-path" title={candidateSourceTitle(activeCandidate)}>
                {isVideoCandidate(activeCandidate)
                  ? `Video ${activeCandidate.mediaSourcePath} at ${formatMediaTimestamp(activeCandidate.videoTimestampMs)}`
                  : activeCandidate.sourcePath}
                {isVideoCandidate(activeCandidate) && <span>Extracted frame: {activeCandidate.sourcePath}</span>}
              </p>
              {activeCandidate.note && <p className="compact">{activeCandidate.note}</p>}
            </div>
            <CandidateExplanation candidate={activeCandidate} state={props.state} />
            <CandidateReferenceStrength candidate={activeCandidate} state={props.state} />
            <div className="identity-tools accuracy-teach-tools">
              <div>
                <strong>Teach accuracy</strong>
                <span>Add a local training label for this row without changing its review status.</span>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => void props.addCandidateCalibrationLabel(activeCandidate, true)} disabled={props.busy} type="button">
                  <Check size={17} />
                  <span>Same person</span>
                </button>
                <button className="secondary" onClick={() => void props.addCandidateCalibrationLabel(activeCandidate, false)} disabled={props.busy} type="button">
                  <X size={17} />
                  <span>Not same person</span>
                </button>
              </div>
            </div>
            <div className="identity-tools">
              <div>
                <strong>Fix identity</strong>
                <span>Move this row to another person or stop this false match from returning.</span>
              </div>
              <div className="identity-move-row">
                <input
                  aria-label="Move match to person"
                  list="known-people"
                  placeholder="Person name"
                  value={identityTarget}
                  onChange={(event) => setIdentityTarget(event.currentTarget.value)}
                />
                <datalist id="known-people">
                  {knownPeople.map((person) => <option key={person} value={person} />)}
                </datalist>
                <button className="secondary" onClick={() => void moveActiveCandidate()} disabled={props.busy || !identityTarget.trim()} type="button">
                  <Users size={17} />
                  <span>Move match</span>
                </button>
                <button className="secondary danger" onClick={() => void blockActiveFalseMatch()} disabled={props.busy || !activeCandidate.bestRefId} type="button">
                  <X size={17} />
                  <span>Don't suggest again</span>
                </button>
              </div>
            </div>
            <label className="note-editor">Review note
              <textarea
                aria-label="Review note"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.currentTarget.value)}
                maxLength={1200}
              />
            </label>
            <div className="review-actions">
              {reviewStatuses.map((status) => (
                <button
                  key={status}
                  aria-keyshortcuts={status === "accepted" ? "A" : status === "rejected" ? "R" : "U"}
                  className={status === "accepted" ? "primary" : "secondary"}
                  onClick={() => decide(status)}
                  disabled={props.busy}
                title={status === "accepted" ? "Accept match" : status === "rejected" ? "Reject match" : "Mark not sure"}
                type="button"
              >
                {status === "accepted" ? <Check size={17} /> : status === "rejected" ? <X size={17} /> : <AlertCircle size={17} />}
                  <span>{decisionButtonLabel(status)}</span>
                </button>
              ))}
              <button className="secondary" onClick={() => void saveActiveNote()} disabled={props.busy || noteDraft === activeCandidate.note} type="button">
                <Save size={17} />
                <span>Save note</span>
              </button>
            </div>
          </>
        ) : (
          <EmptyState icon={ShieldCheck} label="No match selected" detail="Select a possible match to compare it with the saved person photo." />
        )}
      </div>
      <div className="panel media-history-panel">
        <div className="panel-title">
          <Archive size={18} />
          <span>File actions</span>
          <span className="title-count">{mediaActionHistory?.items.length ?? 0}</span>
          <div className="spacer" />
          <button className="ghost compact-action" onClick={() => setMediaActionHistoryOpen((value) => !value)} type="button">
            <BookOpen size={16} />
            <span>{mediaActionHistoryOpen ? "Hide" : "History"}</span>
          </button>
          <button className="ghost compact-action" onClick={() => void refreshMediaActionHistory()} type="button">
            <RefreshCcw size={16} />
            <span>Refresh</span>
          </button>
          <button className="ghost compact-action" onClick={() => void undoHistoryItem()} disabled={!mediaActionHistory?.items.some((item) => item.canUndo) || props.busy} type="button">
            <Undo2 size={16} />
            <span>Undo last</span>
          </button>
        </div>
        {props.mediaActionProgress && props.mediaActionProgress.phase !== "complete" && (
          <div className="media-action-progress">
            <progress max={Math.max(1, props.mediaActionProgress.total || 1)} value={props.mediaActionProgress.processed || 0} />
            <span>{props.mediaActionProgress.action} {props.mediaActionProgress.processed}/{props.mediaActionProgress.total}</span>
            <span>{props.mediaActionProgress.etaMs ? `${formatDuration(Math.round(props.mediaActionProgress.etaMs))} remaining` : props.mediaActionProgress.message || "Working"}</span>
            <button className="ghost compact-action danger" onClick={() => void props.cancelMediaAction()} type="button">Cancel</button>
          </div>
        )}
        {mediaActionHistoryOpen && (
          <div className="media-history-list">
            {mediaActionHistory?.items.length ? mediaActionHistory.items.map((item) => (
              <div className="media-history-row" key={item.manifestPath}>
                <div>
                  <strong>{String(item.action || "action")}</strong>
                  <span>{formatDateTime(item.generatedAt)} • {item.counts.copied + item.counts.moved + item.counts.trashed} changed • {item.counts.skipped} skipped • {item.counts.verified ?? 0} verified</span>
                  <small title={item.destinationPath}>{item.destinationPath || "Destination unavailable"}</small>
                  {item.skippedItems.length > 0 && (
                    <div className="media-action-errors compact-errors">
                      {item.skippedItems.slice(0, 3).map((skipped) => (
                        <span key={`${item.manifestPath}:${skipped.candidateId}`} title={skipped.sourcePath}>
                          <strong>{basename(skipped.sourcePath)}</strong>
                          {skipped.reason || "Skipped"}
                          <button className="ghost compact-action" onClick={() => props.revealPath(skipped.sourcePath)} type="button">Source</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="button-row">
                  <button className="ghost compact-action" onClick={() => props.revealPath(item.destinationPath || item.manifestPath)} disabled={!item.exists} type="button">
                    <FolderOpen size={16} />
                    <span>Reveal</span>
                  </button>
                  <button className="ghost compact-action" onClick={() => props.revealPath(item.manifestPath)} disabled={!item.exists} type="button">
                    <FileText size={16} />
                    <span>Manifest</span>
                  </button>
                  {item.canRestore && (
                    <button className="secondary" onClick={() => void restoreHistoryItem(item.manifestPath)} disabled={!item.exists || props.busy} type="button">
                      <Undo2 size={16} />
                      <span>Restore</span>
                    </button>
                  )}
                  {item.canUndo && (
                    <button className="secondary" onClick={() => void undoHistoryItem(item.manifestPath)} disabled={!item.exists || props.busy} type="button">
                      <Undo2 size={16} />
                      <span>Undo</span>
                    </button>
                  )}
                  {item.canRetry && (
                    <button className="secondary" onClick={() => void retryHistoryItem(item.manifestPath)} disabled={!item.exists || props.busy} type="button">
                      <RefreshCcw size={16} />
                      <span>Retry skipped</span>
                    </button>
                  )}
                  {item.canRetry && (
                    <button className="secondary" onClick={() => void retryHistoryItemToNewDestination(item.manifestPath)} disabled={!item.exists || props.busy} type="button">
                      <FolderOpen size={16} />
                      <span>Switch destination</span>
                    </button>
                  )}
                </div>
              </div>
            )) : <EmptyState icon={Archive} label="No file actions yet" detail="Copy, move, or trash files from selected review rows to build a local action history." />}
          </div>
        )}
      </div>
    </section>
  );
}

function CandidateExplanation({ candidate, state }: { candidate: ReviewCandidate; state: AppState }) {
  const bestReference = candidate.bestRefId
    ? state.references.find((ref) => ref.refId === candidate.bestRefId)
    : null;
  const riskLabels = candidateRiskLabels(candidate);
  const referenceStrength = referenceStrengthForCandidate(candidate, state.references);
  const thresholds = state.config.thresholds;
  const scoreTarget = candidate.score >= thresholds.confident
    ? "Strong"
    : candidate.score >= thresholds.likely
      ? "Likely"
      : candidate.score >= thresholds.relaxedChild
        ? "Needs review"
        : candidate.band === "clustered review"
          ? "Similar group"
          : "Needs review";
  const qualityTarget = candidate.quality >= thresholds.qualityMin ? "Good" : "Low quality";
  const scorePosition = `${Math.round(clamp(candidate.score) * 100)}%`;
  const thresholdStyle = {
    "--score-position": scorePosition,
    "--confident-position": `${Math.round(clamp(thresholds.confident) * 100)}%`,
    "--likely-position": `${Math.round(clamp(thresholds.likely) * 100)}%`,
    "--child-position": `${Math.round(clamp(thresholds.relaxedChild) * 100)}%`
  } as CSSProperties;
  const ageGap = ageGapSummary(candidate);
  const rows = [
    { label: "Why shown", value: candidate.band === "clustered review" ? "Similar photos were grouped together" : `${scoreTarget} match strength` },
    { label: "Photo quality", value: `${scoreLabel(candidate.quality)} ${qualityTarget}` },
    { label: "Media", value: isVideoCandidate(candidate) ? `Video @ ${formatMediaTimestamp(candidate.videoTimestampMs)}` : "Image" },
    { label: "Saved person", value: bestReference ? `${bestReference.personName} • ${ageBucketLabel(bestReference.ageBucket)}` : "No saved person photo" },
    { label: "Saved photo", value: bestReference ? basename(bestReference.sourcePath) : candidate.band === "clustered review" ? "Similar group only" : "Unavailable" },
    { label: "Saved photo strength", value: `${referenceStrength.score}/100 ${referenceStrength.status}` },
    { label: "Review flags", value: riskLabels.length ? riskLabels.join(", ") : "None" },
    ...(ageGap ? [{ label: "Cross-age gap", value: ageGap.label }] : []),
    { label: "Search engine", value: engineLabel(candidate.modelName) },
    { label: "Decision", value: state.config.reviewOnly ? "You decide" : "Review recommended" }
  ];
  return (
    <div className="explanation-panel">
      <div className="section-kicker">Why this appeared</div>
      <div className="score-ruler" style={thresholdStyle}>
        <div className="score-ruler-track">
          <i className="score-marker" />
          <i className="threshold-marker confident" />
          <i className="threshold-marker likely" />
          <i className="threshold-marker child" />
        </div>
        <div className="score-ruler-labels">
          <span>Review {scoreLabel(thresholds.relaxedChild)}</span>
          <span>Likely {scoreLabel(thresholds.likely)}</span>
          <span>Strong {scoreLabel(thresholds.confident)}</span>
          <strong>Strength {scoreLabel(candidate.score)}</strong>
        </div>
      </div>
      <div className="explanation-grid">
        {rows.map((row) => (
          <span key={row.label}>
            <small>{row.label}</small>
            <strong>{row.value}</strong>
          </span>
        ))}
      </div>
      <p className={candidate.quality < thresholds.qualityMin || candidate.score < thresholds.confident ? "evidence-warning active" : "evidence-warning"}>
        Vintrace suggests possible matches only. Treat this as a lead, not an automatic identification.
      </p>
      {ageGap && (ageGap.confidence === "low" || ageGap.confidence === "very-low") && (
        <p className="evidence-warning active" role="note">
          {ageGap.caption}
        </p>
      )}
    </div>
  );
}

function CandidateReferenceStrength({ candidate, state }: { candidate: ReviewCandidate; state: AppState }) {
  const strength = referenceStrengthForCandidate(candidate, state.references);
  const riskLabels = candidateRiskLabels(candidate);
  const statusLabel = strength.status === "strong"
    ? "Strong saved photos"
    : strength.status === "usable"
      ? "Usable saved photos"
      : strength.status === "weak"
        ? "Needs more saved photos"
        : "No saved photos";
  return (
    <div className={`reference-strength-card ${strength.status}`}>
      <div className="reference-strength-head">
        <div>
          <span className="section-kicker">Saved photo strength</span>
          <strong>{statusLabel}</strong>
        </div>
        <span className="reference-strength-score">{strength.score}/100</span>
      </div>
      <div className="reference-strength-grid">
        <span><small>Photos</small><strong>{strength.referenceCount}</strong></span>
        <span><small>Same model</small><strong>{strength.compatibleCount}</strong></span>
        <span><small>Age ranges</small><strong>{strength.ageBucketCount}</strong></span>
        <span><small>Side photo</small><strong>{strength.hasSide ? "Yes" : "No"}</strong></span>
        <span><small>Angled photo</small><strong>{strength.hasAngled ? "Yes" : "No"}</strong></span>
        <span><small>Avg quality</small><strong>{scoreLabel(strength.averageQuality)}</strong></span>
      </div>
      {(riskLabels.length > 0 || strength.issues.length > 0) && (
        <div className="risk-chip-row">
          {riskLabels.map((label) => <span key={label} className="risk-chip">{label}</span>)}
          {strength.issues.slice(0, 4).map((issue) => <span key={issue} className="risk-chip subtle">{issue}</span>)}
        </div>
      )}
      {strength.actions.length > 0 && (
        <p className="compact">{strength.actions.join(" ")}</p>
      )}
      {strength.sampleNames.length > 0 && (
        <small className="reference-strength-samples">{strength.sampleNames.join(" • ")}</small>
      )}
    </div>
  );
}

function SettingsView(props: {
  state: AppState;
  settings: SettingsDraft;
  setSettings(value: SettingsDraft): void;
  saveSettings(): void;
  busy: boolean;
  platformSummary: string;
  systemIntegration: SystemIntegration | null;
  setLaunchAtLogin(value: boolean): void;
  updateStatus: UpdateStatus | null;
  checkForUpdates(): void;
  setUpdateChannel(channel: UpdateChannel): void;
  downloadUpdate(): void;
  installUpdate(): void;
  diagnosticsReport: DiagnosticsReport | null;
  previewDiagnostics(includePaths?: boolean): void;
  exportDiagnostics(includePaths?: boolean): void;
  exportSupportBundle(includePaths?: boolean): void;
  revealWorkspace(): void;
  openWorkspaceFolder(): void;
  recentWorkspaces: WorkspaceListItem[];
  switchWorkspace(path: string): void;
  people: string[];
  exportReport(): void;
  exportScanHistory(): void;
  exportWorkspaceInventory(): void;
  exportAuditLog(): void;
  exportConsentReceipt(): void;
  loadRetentionPolicyReport(): void;
  exportSafeModeAudit(): void;
  setJurisdictionPreset(preset: string): void;
  exportCompliancePack(): void;
  exportExaminationReport(): void;
  exportReviewLedger(): void;
  exportWorkspaceBackup(): void;
  verifyLatestWorkspaceBackup(): void;
  restoreLatestWorkspaceBackup(): void;
  backupVerification: WorkspaceBackupVerification | null;
  backupRestoreResult: WorkspaceBackupRestoreValue | null;
  backupPruneResult: WorkspaceBackupPruneValue | null;
  pruneWorkspaceBackups(): void;
  copyText(text: string, label?: string): void;
  copySettingsProfile(): void;
  applySettingsProfile(text: string): void;
  purgeReviewedCandidates(): void;
  purgeOldCandidates(days: number): void;
  runWorkspaceHealth(): void;
  repairWorkspace(): void;
  workspaceRepairResult: WorkspaceRepairResult | null;
  repairDatabaseIntegrity(): void;
  databaseRepairResult: DatabaseRepairResult | null;
  relinkWorkspacePaths(): void;
  workspaceRelinkResult: WorkspaceRelinkResult | null;
  purgeDuplicateCandidates(): void;
  workspaceHealth: WorkspaceHealth | null;
  workspaceOptimizeResult: WorkspaceOptimizeResult | null;
  optimizeWorkspace(): void;
  pruneScanManifests(): void;
  scanManifestPruneResult: ScanManifestPruneValue | null;
  enforceStorageBudget(): void;
  deletePerson(personName: string): void;
  renamePerson(oldName: string, newName: string): void;
  auditEvents: AuditEventsResult | null;
  loadAuditEvents(): void;
  runtimeSelfTest: RuntimeSelfTestResult | null;
  runRuntimeSelfTest(): void;
  runtimeBenchmark: RuntimeBenchmarkResult | null;
  runRuntimeBenchmark(): void;
  releaseReadiness: ReleaseReadinessResult | null;
  runReleaseReadiness(): void;
  accuracyEvaluation: AccuracyEvaluation | null;
  accuracyValidationPack: AccuracyValidationPackValue | null;
  publicDatasetCatalog: PublicDatasetCatalog | null;
  publicDatasetInspection: PublicDatasetInspection | null;
  publicDatasetBenchmark: PublicDatasetBenchmarkResult | null;
  publicDatasetModelComparison: PublicDatasetModelComparisonResult | null;
  runAccuracyEvaluation(): void;
  generateAccuracyValidationPack(): void;
  choosePublicDatasetFolder(): Promise<string | null>;
  inspectPublicDataset(options: { datasetId: string; folder: string; includeVideos?: boolean }): void | Promise<void>;
  runPublicDatasetBenchmark(options: { datasetId: string; folder: string; maxIdentities: number; candidateImages: number; downloadIfMissing?: boolean; includeVideos?: boolean }): void | Promise<void>;
  runPublicDatasetModelComparison(options: { datasetId: string; folder: string; maxIdentities: number; candidateImages: number; downloadIfMissing?: boolean; includeVideos?: boolean }): void | Promise<void>;
  applyModelRecommendation(pack: string): void | Promise<void>;
  applyCalibration(): void;
  exportAccuracyLabels(): void;
  importAccuracyLabels(text: string): void | Promise<void>;
  privacyReport: PrivacyReport | null;
  mediaTrashReport: MediaTrashReportValue | null;
  mediaTrashCleanup: MediaTrashCleanupValue | null;
  retentionPolicy: RetentionPolicyReport | null;
  loadPrivacyReport(): void;
  loadMediaTrashReport(): void;
  cleanupMediaTrash(days: number, dryRun?: boolean): void;
  deleteFaceData(includeAudit?: boolean): void;
  exportAcceptedMediaBundle(): void;
  performanceMode: PerformanceChoice;
  effectivePerformanceMode: PerformanceMode;
  setPerformanceMode(value: PerformanceChoice): void;
  performanceProfile: PerformanceProfile;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  scanProgress: ScanProgress | null;
  clearLatencySamples(): void;
  copyPerformanceReport(): void;
  warmPreviewsNow(): void;
  chooseModelRoot(): void | Promise<void>;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  backfillModelReferences(): void | Promise<void>;
  modelSwitchPlan: ModelSwitchDryRun | null;
  runModelSwitchDryRun(targetPack?: string): Promise<ModelSwitchDryRun | null>;
  modelDownloadProgress: ModelDownloadProgress | null;
  installerDiagnostics: InstallerDiagnosticsResult | null;
  runInstallerDiagnostics(): void;
  modelIntegrity: ModelIntegrityResult | null;
  runModelIntegrity(): void;
  modelDriftReport: ModelDriftReport | null;
  runModelDriftReport(): void;
  referenceGapReport: ReferenceGapReport | null;
  runReferenceGapReport(): void;
  startReferenceFix(personName: string): void;
  duplicatePeople: DuplicatePeopleResult | null;
  loadDuplicatePeople(): void;
  mergeDuplicatePeople(sourceName: string, targetName: string): void;
  reviewRuleResult: ReviewRulesApplyResult | null;
  applyReviewRules(): void;
  workspaceLock: WorkspaceLockStatus | null;
  enableWorkspaceLock(): void;
  lockWorkspace(): void;
  unlockWorkspace(): void;
  disableWorkspaceLock(): void;
}) {
  const [personToDelete, setPersonToDelete] = useState("");
  const [personToRename, setPersonToRename] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [retentionDays, setRetentionDays] = useState(90);
  const safeModel = props.state.safeModeModel;
  const modelCompatibility = props.state.modelCompatibility;

  useEffect(() => {
    setPersonToDelete((current) => current && props.people.includes(current) ? current : props.people[0] ?? "");
    setPersonToRename((current) => current && props.people.includes(current) ? current : props.people[0] ?? "");
  }, [props.people]);

  function setThreshold(key: keyof Thresholds, value: number) {
    props.setSettings({
      ...props.settings,
      mode: "custom",
      thresholds: { ...props.settings.thresholds, [key]: value }
    });
  }

  function setCustomSettings(values: Partial<SettingsValues>) {
    props.setSettings({ ...props.settings, ...values, mode: "custom" });
  }

  function selectPreset(mode: SettingsMode) {
    if (mode === "custom") {
      props.setSettings({ ...props.settings, mode: "custom" });
      return;
    }
    const preset = settingsPresets.find((item) => item.key === mode);
    if (preset) props.setSettings({ ...preset.values, modelPack: props.settings.modelPack, mode: preset.key });
  }

  const activePreset = settingsPresets.find((preset) => preset.key === props.settings.mode);
  const reviewVolume = props.settings.thresholds.likely >= 0.4 ? "Lower" : props.settings.thresholds.likely <= 0.24 ? "Higher" : "Moderate";
  const guardrail = !props.settings.safeMode
    ? "Off"
    : props.settings.safeModeThreshold <= 0.5
      ? "Strict"
      : props.settings.safeModeThreshold >= 0.62
        ? "Light"
        : "Balanced";
  const modelPackages = props.state.modelSetup?.packages ?? [];
  const activeModelPackage = modelPackages.find((item) => item.pack === props.settings.modelPack) ?? modelPackages.find((item) => item.pack === props.state.config.modelPack);
  const validationMessages: string[] = [];
  if (modelPackages.length && !modelPackages.some((item) => item.pack === props.settings.modelPack)) {
    validationMessages.push("Choose a known face model package.");
  }
  if (!(props.settings.thresholds.confident >= props.settings.thresholds.likely && props.settings.thresholds.likely >= props.settings.thresholds.relaxedChild)) {
    validationMessages.push("Advanced match levels must stay in order: Strong >= Likely >= Review more.");
  }
  if (props.settings.clusterMinSize < 2) {
    validationMessages.push("Similar-photo groups need at least 2 photos.");
  }
  if (props.settings.faceDetectorSize < 320 || props.settings.faceDetectorSize > 1024) {
    validationMessages.push("Face scan detail must stay between 320 and 1024.");
  }
  if (props.settings.verificationDetectorSize < props.settings.faceDetectorSize) {
    validationMessages.push("High-detail recheck must be at least as detailed as the first pass.");
  }
  const safeModeRelaxed = props.state.config.safeMode && (
    !props.settings.safeMode ||
    props.settings.safeModeThreshold > props.state.config.safeModeThreshold + 0.001 ||
    ((props.state.config.safeModeZeroAdmittance ?? false) && !(props.settings.safeModeZeroAdmittance ?? false))
  );
  const build = props.state.buildInfo;
  const buildCommit = build?.commit && build.commit !== "local" ? build.commit.slice(0, 12) : build?.packaged ? "packaged" : "local";
  async function requestSaveSettings() {
    if (validationMessages.length) return;
    if (safeModeRelaxed) {
      const proceed = await confirmDialog("This change makes Safe Mode less protective. Continue only if you want likely intimate media to be filtered less aggressively.");
      if (!proceed) return;
    }
    props.saveSettings();
  }
  function setModelPack(value: string) {
    const selectedPack = modelPackages.find((item) => item.pack === value);
    const suggested = selectedPack?.thresholds ?? {};
    props.runModelSwitchDryRun(value).catch(() => undefined);
    props.setSettings({
      ...props.settings,
      modelPack: value,
      mode: "custom",
      thresholds: {
        ...props.settings.thresholds,
        confident: finiteNumber(suggested.strong, props.settings.thresholds.confident, 0, 1),
        likely: finiteNumber(suggested.likely, props.settings.thresholds.likely, 0, 1),
        relaxedChild: finiteNumber(suggested.review, props.settings.thresholds.relaxedChild, 0, 1)
      }
    });
  }
  function copyWorkspaceSummary() {
    const totals = props.state.scanTotals;
    props.copyText([
      "Vintrace app summary",
      `App folder: ${props.state.workspace}`,
      `Saved person photos: ${props.state.counts.references}`,
      `Possible matches: ${props.state.counts.candidates}`,
      `Pending review: ${props.state.counts.pending}`,
      `Reviewed: ${props.state.counts.reviewed}`,
      `Scan runs: ${totals.runs}`,
      `Files scanned: ${totals.processed}`,
      `Video files: ${totals.videoFiles ?? 0}`,
      `Video frames: ${totals.videoFrames ?? 0}`,
      `Found by scans: ${totals.added}`,
      `Protected by Safe Mode: ${totals.safeFiltered}`,
      `Engine: ${engineLabel(props.state.engine)}`,
      `Provider: ${props.state.platform.primary_provider}`,
      `Face scan detail: ${props.state.config.faceDetectorSize}`,
      `High-detail recheck: ${props.state.config.twoPassScan ? props.state.config.verificationDetectorSize : "Off"}`,
      `Safe Mode: ${props.state.config.safeMode ? "On" : "Off"}`,
      `People: ${props.people.join(", ") || "None"}`
    ].join("\n"), "App summary");
  }
  const acceptedMediaAvailable = props.state.candidates.some((candidate) => candidate.status === "accepted") ||
    Boolean(props.state.candidateWindow?.truncated && props.state.counts.reviewed > 0);
  return (
    <section className="page-grid">
      <div className="panel settings-panel primary-settings">
        <div className="panel-title"><SlidersHorizontal size={18} /> Matching choices</div>
        <p className="compact">Most people should use a preset. Custom controls are still here for advanced tuning.</p>
        <div className="settings-summary">
          <div>
            <span>Mode</span>
            <strong>{props.settings.mode === "custom" ? "Custom" : activePreset?.label ?? "Recommended"}</strong>
          </div>
          <div>
            <span>Review volume</span>
            <strong>{reviewVolume}</strong>
          </div>
          <div>
            <span>Safe Mode</span>
            <strong>{guardrail}</strong>
          </div>
        </div>
        <div className="settings-presets" role="group" aria-label="Configuration presets">
          {settingsPresets.map((preset) => (
            <button
              key={preset.key}
              className={props.settings.mode === preset.key ? "preset-button selected" : "preset-button"}
              onClick={() => selectPreset(preset.key)}
              type="button"
            >
              <span>
                <strong>{preset.label}</strong>
                <small>{preset.detail}</small>
              </span>
              <em>{preset.bestFor}</em>
              {props.settings.mode === preset.key ? <Check size={17} /> : <ChevronRight size={17} />}
            </button>
          ))}
          <button
            className={props.settings.mode === "custom" ? "preset-button selected custom-preset" : "preset-button custom-preset"}
            onClick={() => selectPreset("custom")}
            type="button"
          >
            <span>
              <strong>Custom</strong>
              <small>Advanced matching numbers and filters.</small>
            </span>
            <em>Technical users</em>
            {props.settings.mode === "custom" ? <Check size={17} /> : <ChevronRight size={17} />}
          </button>
        </div>
        {props.settings.mode === "custom" ? (
          <div className="advanced-settings">
            <div className="advanced-title">
              <strong>Advanced controls</strong>
              <span>Manual edits stay in Custom.</span>
            </div>
            <Slider label="Strong match" value={props.settings.thresholds.confident} onChange={(value) => setThreshold("confident", value)} />
            <Slider label="Likely match" value={props.settings.thresholds.likely} onChange={(value) => setThreshold("likely", value)} />
            <Slider label="Review more" value={props.settings.thresholds.relaxedChild} onChange={(value) => setThreshold("relaxedChild", value)} />
            <Slider label="Photo quality minimum" value={props.settings.thresholds.qualityMin} onChange={(value) => setThreshold("qualityMin", value)} />
            <label className="switch-row">
              <span>
                <strong>Safe Mode</strong>
                <small>Protect likely intimate media from matching, thumbnails, and similar-photo groups.</small>
              </span>
              <input
                type="checkbox"
                checked={props.settings.safeMode}
                onChange={(event) => setCustomSettings({ safeMode: event.currentTarget.checked })}
                aria-label="Safe Mode"
              />
            </label>
            <Slider
              label="Safe Mode sensitivity"
              value={props.settings.safeModeThreshold}
              onChange={(value) => setCustomSettings({ safeModeThreshold: value })}
            />
            <label className="switch-row">
              <span>
                <strong>Zero-admittance (strict)</strong>
                <small>Never let borderline-sensitive images enter matching, even a centered single-face portrait. Recommended for child-safety / CSAM victim-ID work.</small>
              </span>
              <input
                type="checkbox"
                checked={props.settings.safeModeZeroAdmittance ?? false}
                disabled={!props.settings.safeMode}
                onChange={(event) => setCustomSettings({ safeModeZeroAdmittance: event.currentTarget.checked })}
                aria-label="Safe Mode zero-admittance"
              />
            </label>
            <label>Group similar photos when at least
              <input
                type="number"
                min={2}
                max={20}
                value={props.settings.clusterMinSize}
                onChange={(event) => setCustomSettings({ clusterMinSize: Number(event.currentTarget.value) })}
              />
            </label>
            <label>Face scan detail
              <input
                type="number"
                min={320}
                max={1024}
                step={32}
                value={props.settings.faceDetectorSize}
                onChange={(event) => setCustomSettings({ faceDetectorSize: Number(event.currentTarget.value) })}
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>High-detail recheck</strong>
                <small>First scan quickly, then re-check possible matches with more detail.</small>
              </span>
              <input
                type="checkbox"
                checked={props.settings.twoPassScan}
                onChange={(event) => setCustomSettings({ twoPassScan: event.currentTarget.checked })}
                aria-label="High-detail recheck"
              />
            </label>
            <label>Recheck detail
              <input
                type="number"
                min={320}
                max={1024}
                step={32}
                value={props.settings.verificationDetectorSize}
                onChange={(event) => setCustomSettings({ verificationDetectorSize: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
        ) : (
          <div className="preset-values">
            <span>Strong {percent(props.settings.thresholds.confident)}</span>
            <span>Likely {percent(props.settings.thresholds.likely)}</span>
            <span>Quality {percent(props.settings.thresholds.qualityMin)}</span>
            <span>Group {props.settings.clusterMinSize}+</span>
            <span>Detail {props.settings.faceDetectorSize}</span>
            <span>{props.settings.twoPassScan ? `Recheck ${props.settings.verificationDetectorSize}` : "Single pass"}</span>
          </div>
        )}
        {validationMessages.length > 0 && (
          <div className="settings-errors" role="alert">
            {validationMessages.map((message) => <span key={message}>{message}</span>)}
          </div>
        )}
        {safeModeRelaxed && !validationMessages.length && (
          <div className="settings-warning">
            <AlertCircle size={16} />
            <span>Safe Mode protection is being relaxed and will require confirmation.</span>
          </div>
        )}
        <button className="primary" onClick={requestSaveSettings} disabled={props.busy || validationMessages.length > 0}>
          <Save size={17} />
          <span>Save settings</span>
        </button>
      </div>
      <div className="panel">
        <div className="panel-title"><HardDrive size={18} /> Local engine</div>
        <p className="compact">{props.platformSummary}</p>
        <label className="stacked-control">Face model package
          <select
            value={props.settings.modelPack}
            onChange={(event) => setModelPack(event.currentTarget.value)}
            disabled={props.busy || modelPackages.length === 0}
          >
            {modelPackages.length ? modelPackages.map((item) => (
              <option key={item.pack} value={item.pack}>{item.label}</option>
            )) : <option value={props.settings.modelPack}>{props.settings.modelPack || "Default model"}</option>}
          </select>
        </label>
        {activeModelPackage && (
          <div className="model-package-detail compact-model-detail">
            <span>{activeModelPackage.pose_aware ? "Pose-aware path" : "Default recognition path"}</span>
            <span>{activeModelPackage.available ? "Installed" : "Download before full use"}</span>
            <span>{activeModelPackage.embedding_space || `insightface-${activeModelPackage.pack}`}</span>
          </div>
        )}
        <dl className="mini-list">
          <dt>App version</dt><dd>{build?.version ?? props.state.version}</dd>
          <dt>Build</dt><dd title={build?.commit || ""}>{buildCommit}</dd>
          <dt>Channel</dt><dd>{build?.channel ?? "stable"}</dd>
          <dt>Runtime</dt><dd>{build?.packaged ? "Packaged app" : "Developer build"}</dd>
          <dt>Face model</dt><dd>{props.state.modelSetup?.ready ? props.state.modelSetup.currentPack : "Needs download"}</dd>
          <dt>Compatible references</dt><dd>{modelCompatibility ? `${formatNumber(modelCompatibility.compatibleReferences)} / ${formatNumber(modelCompatibility.totalReferences)}` : "Unknown"}</dd>
          <dt>Backfill needed</dt><dd>{modelCompatibility?.needsBackfill ? `${formatNumber(modelCompatibility.otherModelReferences)} saved photos` : "No"}</dd>
          <dt>Safe Mode engine</dt><dd>{safeModel?.available ? safeModel.engine.toUpperCase() : "Heuristic fallback"}</dd>
          <dt>Safety model</dt><dd>{safeModel?.modelName ?? "Exposed-skin heuristic"}</dd>
          <dt>Model license</dt><dd>{safeModel?.license || "Local heuristic"}</dd>
        </dl>
        <div className="button-row">
          <button className="secondary" onClick={props.runRuntimeSelfTest} disabled={props.busy}>
            <Activity size={17} />
            <span>Run check</span>
          </button>
        </div>
      </div>
      <div className="panel settings-panel model-switch-panel">
        <ModelSwitchWizard
          state={props.state}
          settings={props.settings}
          modelPackages={modelPackages}
          modelCompatibility={modelCompatibility}
          modelDownloadProgress={props.modelDownloadProgress}
          modelDriftReport={props.modelDriftReport}
          referenceGapReport={props.referenceGapReport}
          busy={props.busy}
          validationBlocked={validationMessages.length > 0}
          setModelPack={setModelPack}
          saveSettings={requestSaveSettings}
          downloadModel={props.downloadModel}
          backfillModelReferences={props.backfillModelReferences}
          dryRunPlan={props.modelSwitchPlan}
          runDryRun={props.runModelSwitchDryRun}
          runModelDriftReport={props.runModelDriftReport}
          runReferenceGapReport={props.runReferenceGapReport}
        />
      </div>
      <ModelSetupCard
        state={props.state}
        progress={props.modelDownloadProgress}
        busy={props.busy}
        chooseModelRoot={props.chooseModelRoot}
        downloadModel={props.downloadModel}
      />
      <VideoDecoderPanel
        report={props.state.videoDecoder}
        settings={props.settings}
        setSettings={props.setSettings}
        saveSettings={props.saveSettings}
        copyText={props.copyText}
        busy={props.busy}
      />
      <InstallerDiagnosticsPanel
        result={props.installerDiagnostics}
        modelIntegrity={props.modelIntegrity}
        modelDriftReport={props.modelDriftReport}
        busy={props.busy}
        runDiagnostics={props.runInstallerDiagnostics}
        runModelIntegrity={props.runModelIntegrity}
        runModelDriftReport={props.runModelDriftReport}
      />
      <ReferenceGapPanel
        report={props.referenceGapReport}
        busy={props.busy}
        runReport={props.runReferenceGapReport}
        copyText={props.copyText}
        startReferenceFix={props.startReferenceFix}
      />
      <RuntimeSelfTestPanel result={props.runtimeSelfTest} />
      <PerformanceCenter
        state={props.state}
        mode={props.performanceMode}
        effectiveMode={props.effectivePerformanceMode}
        setMode={props.setPerformanceMode}
        profile={props.performanceProfile}
        latencySamples={props.latencySamples}
        latencySummary={props.latencySummary}
        scanProgress={props.scanProgress}
        busy={props.busy}
        warmPreviewsNow={props.warmPreviewsNow}
        copyPerformanceReport={props.copyPerformanceReport}
        clearLatencySamples={props.clearLatencySamples}
      />
      <ScaleReadinessPanel state={props.state} pruneScanManifests={props.pruneScanManifests} pruneResult={props.scanManifestPruneResult} busy={props.busy} />
      <BenchmarkPanel result={props.runtimeBenchmark} history={props.state.benchmarkHistory ?? []} busy={props.busy} runBenchmark={props.runRuntimeBenchmark} />
      <AccuracyLabPanel
        result={props.accuracyEvaluation}
        validationPack={props.accuracyValidationPack}
        datasetCatalog={props.publicDatasetCatalog}
        datasetInspection={props.publicDatasetInspection}
        datasetBenchmark={props.publicDatasetBenchmark}
        modelComparison={props.publicDatasetModelComparison}
        calibration={props.state.calibration}
        busy={props.busy}
        runAccuracyEvaluation={props.runAccuracyEvaluation}
        generateAccuracyValidationPack={props.generateAccuracyValidationPack}
        chooseDatasetFolder={props.choosePublicDatasetFolder}
        inspectDataset={props.inspectPublicDataset}
        runDatasetBenchmark={props.runPublicDatasetBenchmark}
        runModelComparison={props.runPublicDatasetModelComparison}
        applyModelRecommendation={props.applyModelRecommendation}
        applyCalibration={props.applyCalibration}
        exportAccuracyLabels={props.exportAccuracyLabels}
        importAccuracyLabels={props.importAccuracyLabels}
        copyText={props.copyText}
      />
      <ReviewRulesPanel
        settings={props.settings}
        setSettings={props.setSettings}
        saveSettings={props.saveSettings}
        result={props.reviewRuleResult}
        busy={props.busy}
        applyReviewRules={props.applyReviewRules}
      />
      <ReleaseReadinessPanel result={props.releaseReadiness} busy={props.busy} runReleaseReadiness={props.runReleaseReadiness} />
      <UpdateCenterPanel
        status={props.updateStatus}
        busy={props.busy}
        checkForUpdates={props.checkForUpdates}
        setUpdateChannel={props.setUpdateChannel}
        downloadUpdate={props.downloadUpdate}
        installUpdate={props.installUpdate}
      />
      <DiagnosticsPanel
        report={props.diagnosticsReport}
        busy={props.busy}
        previewDiagnostics={props.previewDiagnostics}
        exportDiagnostics={props.exportDiagnostics}
        exportSupportBundle={props.exportSupportBundle}
      />
      <div className="panel settings-panel">
        <div className="panel-title"><Activity size={18} /> System</div>
        <label className="switch-row">
          <span>
            <strong>Start at login</strong>
            <small>{props.systemIntegration?.platform === "darwin" ? "macOS login item" : "Windows startup task"}</small>
          </span>
          <input
            type="checkbox"
            checked={Boolean(props.systemIntegration?.launchAtLogin)}
            onChange={(event) => props.setLaunchAtLogin(event.currentTarget.checked)}
            aria-label="Start at login"
          />
        </label>
        <dl className="mini-list">
          <dt>Link</dt><dd>{props.systemIntegration?.protocolRegistered ? `${props.systemIntegration.protocolScheme}:// ready` : "Not registered"}</dd>
          <dt>Alerts</dt><dd>{props.systemIntegration?.notificationsSupported ? "Available" : "Unavailable"}</dd>
        </dl>
        <div className="button-row">
          <button className="secondary" onClick={props.revealWorkspace} disabled={props.busy}>
            <HardDrive size={17} />
            <span>Reveal</span>
          </button>
          <button className="secondary" onClick={props.openWorkspaceFolder} disabled={props.busy}>
            <FolderOpen size={17} />
            <span>Open folder</span>
          </button>
        </div>
        {props.recentWorkspaces.length > 1 && (
          <label className="switch-row">
            <span>
              <strong>Switch workspace</strong>
              <small>Each case stays isolated in its own folder. Only known workspaces are listed.</small>
            </span>
            <select
              value={props.recentWorkspaces.find((item) => item.active)?.path ?? ""}
              disabled={props.busy}
              onChange={(event) => props.switchWorkspace(event.currentTarget.value)}
              aria-label="Switch workspace"
            >
              {props.recentWorkspaces.map((item) => (
                <option key={item.path} value={item.path} disabled={!item.available}>
                  {item.alias}{item.active ? " (current)" : ""}{item.available ? "" : " — missing"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <WorkspaceHealthPanel
        health={props.workspaceHealth}
        optimizeResult={props.workspaceOptimizeResult}
        busy={props.busy}
        runWorkspaceHealth={props.runWorkspaceHealth}
        repairWorkspace={props.repairWorkspace}
        repairResult={props.workspaceRepairResult}
        repairDatabaseIntegrity={props.repairDatabaseIntegrity}
        databaseRepairResult={props.databaseRepairResult}
        relinkWorkspacePaths={props.relinkWorkspacePaths}
        relinkResult={props.workspaceRelinkResult}
        purgeDuplicateCandidates={props.purgeDuplicateCandidates}
        optimizeWorkspace={props.optimizeWorkspace}
      />
      <StorageBudgetPanel
        state={props.state}
        settings={props.settings}
        setSettings={props.setSettings}
        saveSettings={props.saveSettings}
        health={props.workspaceHealth}
        busy={props.busy}
        enforceStorageBudget={props.enforceStorageBudget}
      />
      <MediaTrashCleanupPanel
        report={props.mediaTrashReport}
        cleanup={props.mediaTrashCleanup}
        busy={props.busy}
        loadReport={props.loadMediaTrashReport}
        cleanupTrash={props.cleanupMediaTrash}
      />
      <ScanExclusionsPanel
        settings={props.settings}
        setSettings={props.setSettings}
        saveSettings={props.saveSettings}
        busy={props.busy}
      />
      <SettingsProfilePanel
        busy={props.busy}
        copySettingsProfile={props.copySettingsProfile}
        applySettingsProfile={props.applySettingsProfile}
      />
      <DuplicatePeoplePanel
        result={props.duplicatePeople}
        busy={props.busy}
        loadDuplicatePeople={props.loadDuplicatePeople}
        mergeDuplicatePeople={props.mergeDuplicatePeople}
      />
      <WorkspaceLockPanel
        status={props.workspaceLock}
        busy={props.busy}
        enable={props.enableWorkspaceLock}
        lockNow={props.lockWorkspace}
        unlock={props.unlockWorkspace}
        disable={props.disableWorkspaceLock}
      />
      <div className="panel settings-panel data-ops-panel">
        <div className="panel-title"><Database size={18} /> Save and clean up</div>
        <button className="primary" onClick={props.exportReport} disabled={props.busy}>
          <Archive size={17} />
          <span>Export review report</span>
        </button>
        <button className="secondary" onClick={props.exportAcceptedMediaBundle} disabled={props.busy || !acceptedMediaAvailable}>
          <Archive size={17} />
          <span>Export accepted media</span>
        </button>
        <button className="secondary" onClick={copyWorkspaceSummary} disabled={props.busy}>
          <Archive size={17} />
          <span>Copy app summary</span>
        </button>
        <button className="secondary" onClick={props.exportScanHistory} disabled={props.busy}>
          <FileText size={17} />
          <span>Export scan history</span>
        </button>
        <button className="secondary" onClick={props.exportWorkspaceInventory} disabled={props.busy}>
          <FileText size={17} />
          <span>Export inventory</span>
        </button>
        <button className="secondary" onClick={props.exportAuditLog} disabled={props.busy}>
          <Archive size={17} />
          <span>Export activity log</span>
        </button>
        <button className="secondary" onClick={props.exportReviewLedger} disabled={props.busy}>
          <FileText size={17} />
          <span>Export review ledger</span>
        </button>
        <button className="secondary" onClick={props.exportWorkspaceBackup} disabled={props.busy}>
          <HardDrive size={17} />
          <span>Backup app folder</span>
        </button>
        <button className="secondary" onClick={props.verifyLatestWorkspaceBackup} disabled={props.busy}>
          <ShieldCheck size={17} />
          <span>Verify latest backup</span>
        </button>
        <button className="secondary" onClick={props.restoreLatestWorkspaceBackup} disabled={props.busy}>
          <FolderOpen size={17} />
          <span>Restore latest backup</span>
        </button>
        {props.backupVerification && (
          <div className={props.backupVerification.ok ? "backup-verification ok" : "backup-verification warn"}>
            <strong>{props.backupVerification.ok ? "Backup verified" : "Backup needs attention"}</strong>
            <span title={props.backupVerification.zipPath}>{basename(props.backupVerification.zipPath) || "No backup found"}</span>
            <small>
              {props.backupVerification.exists
                ? `${props.backupVerification.fileCount} files, ${formatBytes(props.backupVerification.bytes)}`
                : props.backupVerification.error || "Backup file was not found."}
            </small>
            {props.backupVerification.missingCoreFiles.length > 0 && <small>Missing: {props.backupVerification.missingCoreFiles.join(", ")}</small>}
            {props.backupVerification.corruptEntry && <small>Corrupt entry: {props.backupVerification.corruptEntry}</small>}
            {props.backupVerification.dangerousEntries.length > 0 && <small>Unsafe entries: {props.backupVerification.dangerousEntries.length}</small>}
            {props.backupVerification.error && <small>{props.backupVerification.error}</small>}
          </div>
        )}
        {props.backupRestoreResult && (
          <div className="backup-verification ok">
            <strong>Backup restored</strong>
            <span title={props.backupRestoreResult.targetRoot}>{basename(props.backupRestoreResult.targetRoot) || props.backupRestoreResult.targetRoot}</span>
            <small>
              {props.backupRestoreResult.fileCount} files, {formatBytes(props.backupRestoreResult.bytes)}, {props.backupRestoreResult.stateSummary.references} people, {props.backupRestoreResult.stateSummary.candidates} matches
            </small>
          </div>
        )}
        <button className="secondary" onClick={props.pruneWorkspaceBackups} disabled={props.busy}>
          <Trash2 size={17} />
          <span>Clean old backups</span>
        </button>
        {props.backupPruneResult && (
          <div className="backup-verification ok">
            <strong>Backup cleanup</strong>
            <span>Kept {props.backupPruneResult.kept}, removed {props.backupPruneResult.deleted}</span>
            <small>Reclaimed {formatBytes(props.backupPruneResult.deletedBytes)}</small>
          </div>
        )}
        <button className="secondary" onClick={props.purgeReviewedCandidates} disabled={props.busy}>
          <Trash2 size={17} />
          <span>Remove reviewed matches</span>
        </button>
        <div className="retention-row">
          <label>Keep reviewed matches for
            <input
              aria-label="Retention days"
              type="number"
              min={1}
              max={3650}
              value={retentionDays}
              onChange={(event) => setRetentionDays(Number(event.currentTarget.value))}
            />
          </label>
          <button className="secondary danger" onClick={() => props.purgeOldCandidates(retentionDays)} disabled={props.busy}>
            <Trash2 size={17} />
            <span>Remove old reviewed</span>
          </button>
        </div>
        <div className="field">
          <label htmlFor="rename-person">Rename or merge person</label>
          <div className="path-input person-rename-row">
            <select id="rename-person" aria-label="Person to rename" value={personToRename} onChange={(event) => setPersonToRename(event.currentTarget.value)} disabled={!props.people.length}>
              {props.people.length ? props.people.map((person) => <option key={person} value={person}>{person}</option>) : <option value="">No people</option>}
            </select>
            <input aria-label="New person name" value={renameTarget} onChange={(event) => setRenameTarget(event.currentTarget.value)} placeholder="New name or existing person" />
            <button className="secondary" onClick={() => props.renamePerson(personToRename, renameTarget)} disabled={!personToRename || !renameTarget.trim() || props.busy}>
              <Users size={17} />
              <span>Rename</span>
            </button>
          </div>
        </div>
        <div className="field">
          <label htmlFor="delete-person">Delete person</label>
          <div className="path-input person-delete-row">
            <select id="delete-person" aria-label="Person to delete" value={personToDelete} onChange={(event) => setPersonToDelete(event.currentTarget.value)} disabled={!props.people.length}>
              {props.people.length ? props.people.map((person) => <option key={person} value={person}>{person}</option>) : <option value="">No people</option>}
            </select>
            <button className="icon-button danger" onClick={() => props.deletePerson(personToDelete)} disabled={!personToDelete || props.busy} title="Delete person" aria-label="Delete person">
              <Trash2 size={17} />
            </button>
          </div>
        </div>
        <p className="compact">Exports include JSON and CSV review records. Cleanup keeps the activity history for accountability.</p>
      </div>
      <PrivacyControlPanel
        report={props.privacyReport}
        retentionPolicy={props.retentionPolicy}
        busy={props.busy}
        jurisdictionPreset={props.state.config.jurisdictionPreset ?? "standard"}
        retentionReviewedDays={props.state.config.retentionReviewedDays ?? 90}
        setJurisdictionPreset={props.setJurisdictionPreset}
        exportCompliancePack={props.exportCompliancePack}
        exportExaminationReport={props.exportExaminationReport}
        loadPrivacyReport={props.loadPrivacyReport}
        loadRetentionPolicyReport={props.loadRetentionPolicyReport}
        exportConsentReceipt={props.exportConsentReceipt}
        exportSafeModeAudit={props.exportSafeModeAudit}
        deleteFaceData={props.deleteFaceData}
      />
      <AuditTrailPanel events={props.auditEvents} busy={props.busy} loadAuditEvents={props.loadAuditEvents} copyText={props.copyText} />
    </section>
  );
}

function WorkspaceHealthPanel({
  health,
  optimizeResult,
  busy,
  runWorkspaceHealth,
  repairWorkspace,
  repairResult,
  repairDatabaseIntegrity,
  databaseRepairResult,
  relinkWorkspacePaths,
  relinkResult,
  purgeDuplicateCandidates,
  optimizeWorkspace
}: {
  health: WorkspaceHealth | null;
  optimizeResult: WorkspaceOptimizeResult | null;
  busy: boolean;
  runWorkspaceHealth(): void;
  repairWorkspace(): void;
  repairResult: WorkspaceRepairResult | null;
  repairDatabaseIntegrity(): void;
  databaseRepairResult: DatabaseRepairResult | null;
  relinkWorkspacePaths(): void;
  relinkResult: WorkspaceRelinkResult | null;
  purgeDuplicateCandidates(): void;
  optimizeWorkspace(): void;
}) {
  const duplicateCount = health?.duplicateCandidateCount ?? 0;
  const brokenLinkCount = (health?.missingReferences ?? 0) + (health?.missingCandidates ?? 0) + (health?.missingMediaSources ?? 0);
  const dbHealthy = health?.databaseIntegrity?.ok ?? true;
  const metrics = health ? [
    { label: "Storage", value: formatBytes(health.storageBytes) },
    { label: "Files", value: formatNumber(health.workspaceFileCount) },
    { label: "Activity events", value: formatNumber(health.auditEvents) },
    { label: "Missing saved photos", value: formatNumber(health.missingReferences) },
    { label: "Missing matches", value: formatNumber(health.missingCandidates) },
    { label: "Missing media", value: formatNumber(health.missingMediaSources ?? 0) },
    { label: "Duplicates", value: formatNumber(duplicateCount) },
    { label: "Database", value: dbHealthy ? "Healthy" : "Repair" }
  ] : [];
  return (
    <div className="panel settings-panel workspace-health-panel">
      <div className="panel-title"><Gauge size={18} /> App folder check</div>
      {health ? (
        <>
          <div className="workspace-health-grid">
            {metrics.map((metric) => (
              <span key={metric.label}>
                <small>{metric.label}</small>
                <strong>{metric.value}</strong>
              </span>
            ))}
          </div>
          <div className="health-list">
            {health.recommendations.slice(0, 4).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          {health.duplicateGroups.length > 0 && (
            <div className="duplicate-list">
              {health.duplicateGroups.slice(0, 3).map((group) => (
                <span key={`${group.sourcePath}-${group.personName}`} title={group.sourcePath}>
                  {group.count} rows • {group.personName} • {basename(group.sourcePath)}
                </span>
              ))}
            </div>
          )}
          {brokenLinkCount > 0 && (
            <div className="duplicate-list">
              {(health.missingReferenceSamples ?? []).slice(0, 2).map((item) => (
                <span key={item.refId} title={item.sourcePath}>Missing saved photo • {item.personName} • {basename(item.sourcePath)}</span>
              ))}
              {(health.missingCandidateSamples ?? []).slice(0, 2).map((item) => (
                <span key={item.candidateId} title={item.sourcePath}>Missing match • {item.personName} • {basename(item.sourcePath)}</span>
              ))}
              {(health.missingMediaSourceSamples ?? []).slice(0, 2).map((item) => (
                <span key={item.candidateId} title={item.mediaSourcePath}>Missing video source • {item.personName} • {basename(item.mediaSourcePath)}</span>
              ))}
            </div>
          )}
          {(health.sourceFolders ?? []).length > 0 && (
            <div className="duplicate-list">
              {(health.sourceFolders ?? []).slice(0, 4).map((folder) => (
                <span key={folder.folder} title={folder.folder}>
                  {formatNumber(folder.references + folder.candidates)} item(s) • {basename(folder.folder) || folder.folder} • {formatBytes(folder.bytes)}
                </span>
              ))}
            </div>
          )}
          <small className="compact">Checked {formatDateTime(health.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Run a check to find missing files, duplicate match rows, activity history size, and cleanup opportunities.</p>
      )}
      {repairResult && !repairResult.dryRun && (
        <div className="health-list">
          <span>Last repair removed {formatNumber(repairResult.removedReferences)} saved photo link(s) and {formatNumber(repairResult.removedCandidates)} match row(s).</span>
        </div>
      )}
      {databaseRepairResult && (
        <div className={databaseRepairResult.after.ok ? "health-list" : "health-list warn"}>
          <span>{databaseRepairResult.rebuilt ? "Database index rebuilt" : databaseRepairResult.confirmed ? "Database index optimized" : "Database repair preview"}.</span>
          {databaseRepairResult.snapshot?.backupDir && <span>Snapshot saved before repair.</span>}
          {databaseRepairResult.recommendations.slice(0, 2).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
        </div>
      )}
      {relinkResult && (
        <div className="health-list">
          <span>{relinkResult.dryRun ? "Relink preview" : "Last relink"} matched {formatNumber(relinkResult.relinkedFields)} saved path(s).</span>
          {relinkResult.missingTargets.length > 0 && <span>{formatNumber(relinkResult.missingTargets.length)} target path(s) were not found in the new folder.</span>}
        </div>
      )}
      {optimizeResult && (
        <div className="health-list">
          <span>Last optimized: reclaimed {formatBytes(optimizeResult.totalBytesReclaimed)}.</span>
          <span>Removed {formatNumber(optimizeResult.previewFilesRemoved)} preview file(s) and {formatNumber(optimizeResult.orphanVideoFramesRemoved)} orphan video frame(s).</span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={runWorkspaceHealth} disabled={busy}>
          <Activity size={17} />
          <span>Run check</span>
        </button>
        <button className="secondary" onClick={optimizeWorkspace} disabled={busy}>
          <Database size={17} />
          <span>Optimize app folder</span>
        </button>
        <button className={dbHealthy ? "secondary" : "secondary danger"} onClick={repairDatabaseIntegrity} disabled={busy || !health}>
          <Database size={17} />
          <span>{dbHealthy ? "Optimize database" : "Repair database"}</span>
        </button>
        <button className="secondary danger" onClick={repairWorkspace} disabled={busy || !brokenLinkCount}>
          <Trash2 size={17} />
          <span>Repair missing links</span>
        </button>
        <button className="secondary" onClick={relinkWorkspacePaths} disabled={busy}>
          <FolderOpen size={17} />
          <span>Relink moved folder</span>
        </button>
        <button className="secondary danger" onClick={purgeDuplicateCandidates} disabled={busy || duplicateCount === 0}>
          <Trash2 size={17} />
          <span>Remove duplicates</span>
        </button>
      </div>
    </div>
  );
}

function StorageBudgetPanel({
  state,
  settings,
  setSettings,
  saveSettings,
  health,
  busy,
  enforceStorageBudget
}: {
  state: AppState;
  settings: SettingsDraft;
  setSettings(value: SettingsDraft): void;
  saveSettings(): void;
  health: WorkspaceHealth | null;
  busy: boolean;
  enforceStorageBudget(): void;
}) {
  const gib = 1024 ** 3;
  const budgetBytes = settings.storageBudgetBytes ?? 0;
  const budgetGb = budgetBytes > 0 ? Math.round((budgetBytes / gib) * 10) / 10 : 0;
  const storageBytes = health?.storageBytes ?? state.scale?.dbBytes ?? 0;
  const overBudget = health?.storageOverBudgetBytes ?? Math.max(0, storageBytes - budgetBytes);
  const budgetPercent = budgetBytes > 0 ? Math.min(1, storageBytes / budgetBytes) : 0;
  function updateBudgetGb(value: number) {
    const nextGb = Math.max(0, Math.min(10_240, Number.isFinite(value) ? value : 0));
    setSettings({
      ...settings,
      mode: "custom",
      storageBudgetBytes: Math.round(nextGb * gib)
    });
  }
  return (
    <div className={overBudget > 0 ? "panel settings-panel runtime-test-panel warn" : "panel settings-panel runtime-test-panel"}>
      <div className="panel-title"><HardDrive size={18} /> Storage limit</div>
      <p className="compact">Set a simple limit for generated app data. Cleanup removes previews, orphan video frames, and compactable database space, never original photos or videos.</p>
      <div className="storage-budget-row">
        <label>Use up to
          <input
            aria-label="Storage limit in GB"
            type="number"
            min={0}
            max={10240}
            step={0.5}
            value={budgetGb}
            onChange={(event) => updateBudgetGb(Number(event.currentTarget.value))}
          />
        </label>
        <span>GB</span>
      </div>
      <div className="model-progress">
        <div>
          <strong>{budgetBytes ? `${formatBytes(storageBytes)} used` : "No limit set"}</strong>
          <span>{budgetBytes ? `${formatBytes(budgetBytes)} limit` : "Set a number above zero to enable warnings."}</span>
        </div>
        <progress value={budgetPercent * 100} max={100} aria-label="Storage budget usage" />
      </div>
      {overBudget > 0 && (
        <div className="settings-warning">
          <AlertCircle size={16} />
          <span>{formatBytes(overBudget)} over the selected limit.</span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={saveSettings} disabled={busy}>
          <Save size={17} />
          <span>Save limit</span>
        </button>
        <button className="secondary" onClick={enforceStorageBudget} disabled={busy || budgetBytes <= 0}>
          <Database size={17} />
          <span>Clean generated cache</span>
        </button>
      </div>
    </div>
  );
}

function MediaTrashCleanupPanel({
  report,
  cleanup,
  busy,
  loadReport,
  cleanupTrash
}: {
  report: MediaTrashReportValue | null;
  cleanup: MediaTrashCleanupValue | null;
  busy: boolean;
  loadReport(): void;
  cleanupTrash(days: number, dryRun?: boolean): void;
}) {
  const [days, setDays] = useState(30);
  const safeDays = Math.max(0, Math.min(3650, Number.isFinite(days) ? days : 30));
  const files = report?.counts.files ?? 0;
  const recoverable = report?.counts.recoverableFiles ?? 0;
  const bytes = report?.counts.bytes ?? 0;
  const old30 = report?.counts.olderThanDays?.["30"] ?? 0;
  const latestActions = report?.actions.slice(0, 3) ?? [];
  return (
    <div className="panel settings-panel media-trash-cleanup-panel">
      <div className="panel-title">
        <Trash2 size={18} />
        <span>App trash</span>
      </div>
      <p className="compact">Manage only files Vintrace moved into its own trash during review actions. Original folders are never cleaned from here.</p>
      <div className="media-trash-summary">
        <span>
          <small>Files</small>
          <strong>{formatNumber(files)}</strong>
        </span>
        <span>
          <small>Can restore</small>
          <strong>{formatNumber(recoverable)}</strong>
        </span>
        <span>
          <small>Size</small>
          <strong>{formatBytes(bytes)}</strong>
        </span>
        <span>
          <small>30+ days</small>
          <strong>{formatNumber(old30)}</strong>
        </span>
      </div>
      <label>Clean actions older than
        <input
          aria-label="App trash cleanup age in days"
          type="number"
          min={0}
          max={3650}
          step={1}
          value={days}
          onChange={(event) => setDays(Number(event.currentTarget.value))}
        />
      </label>
      {latestActions.length > 0 && (
        <div className="media-trash-actions" aria-label="Recent app trash actions">
          {latestActions.map((action) => (
            <span key={action.manifestPath} title={action.destinationPath}>
              <strong>{formatNumber(action.recoverableFiles)} recoverable</strong>
              {formatBytes(action.bytes)} • {Math.round(action.ageDays)} day{Math.round(action.ageDays) === 1 ? "" : "s"} old
            </span>
          ))}
        </div>
      )}
      {cleanup && (
        <div className={cleanup.dryRun ? "settings-warning" : "settings-warning ok"}>
          <Database size={16} />
          <span>
            {cleanup.dryRun ? "Preview" : "Cleaned"} {formatNumber(cleanup.dryRun ? cleanup.previewFiles : cleanup.deletedFiles)} file{(cleanup.dryRun ? cleanup.previewFiles : cleanup.deletedFiles) === 1 ? "" : "s"} ({formatBytes(cleanup.dryRun ? cleanup.previewBytes : cleanup.deletedBytes)}).
          </span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={loadReport} disabled={busy} type="button">
          <RefreshCcw size={17} />
          <span>Check app trash</span>
        </button>
        <button className="secondary" onClick={() => cleanupTrash(safeDays, true)} disabled={busy} type="button">
          <FileText size={17} />
          <span>Preview cleanup</span>
        </button>
        <button className="secondary danger" onClick={() => cleanupTrash(safeDays, false)} disabled={busy} type="button">
          <Trash2 size={17} />
          <span>Clean old app trash</span>
        </button>
      </div>
    </div>
  );
}

function ScanExclusionsPanel({
  settings,
  setSettings,
  saveSettings,
  busy
}: {
  settings: SettingsDraft;
  setSettings(value: SettingsDraft): void;
  saveSettings(): void;
  busy: boolean;
}) {
  function updateExclusions(values: Partial<SettingsDraft["scanExclusions"]>) {
    setSettings({
      ...settings,
      mode: "custom",
      scanExclusions: { ...settings.scanExclusions, ...values }
    });
  }
  function updateMaxMediaSize(megabytes: number) {
    const safeMegabytes = Math.max(0, Math.min(10_000_000, Number.isFinite(megabytes) ? megabytes : 0));
    setSettings({
      ...settings,
      mode: "custom",
      maxMediaFileBytes: Math.round(safeMegabytes * 1024 * 1024)
    });
  }
  const maxMediaMegabytes = Math.round((settings.maxMediaFileBytes || 0) / (1024 * 1024));
  return (
    <div className="panel settings-panel scan-exclusions-panel">
      <div className="panel-title"><EyeOff size={18} /> Scan exclusions</div>
      <p className="compact">Skip folders and file types that should never be searched. This is especially useful for Downloads, drives with developer folders, and million-file libraries.</p>
      <label>Skip folder names
        <textarea
          aria-label="Excluded folder names"
          value={listText(settings.scanExclusions.dirNames)}
          onChange={(event) => updateExclusions({ dirNames: parseListText(event.currentTarget.value) })}
          rows={3}
        />
      </label>
      <label>Skip paths containing
        <textarea
          aria-label="Excluded path keywords"
          value={listText(settings.scanExclusions.pathKeywords)}
          onChange={(event) => updateExclusions({ pathKeywords: parseListText(event.currentTarget.value) })}
          placeholder="Example: /Private/, screenshots-to-ignore"
          rows={2}
        />
      </label>
      <label>Skip file types
        <input
          aria-label="Excluded file extensions"
          value={listText(settings.scanExclusions.extensions)}
          onChange={(event) => updateExclusions({ extensions: parseListText(event.currentTarget.value) })}
          placeholder="Example: gif, webp"
        />
      </label>
      <label>Skip media larger than
        <div className="inline-number-field">
          <input
            aria-label="Maximum media file size in megabytes"
            type="number"
            min={0}
            max={10_000_000}
            value={maxMediaMegabytes}
            onChange={(event) => updateMaxMediaSize(Number(event.currentTarget.value))}
          />
          <span>MB</span>
        </div>
        <small>{settings.maxMediaFileBytes ? `Files above ${formatBytes(settings.maxMediaFileBytes)} are skipped before decoding.` : "Set 0 to scan every supported file size."}</small>
      </label>
      <label>Skip exact files
        <textarea
          aria-label="Excluded exact file paths"
          value={listText(settings.scanExclusions.filePaths)}
          onChange={(event) => updateExclusions({ filePaths: parseListText(event.currentTarget.value) })}
          placeholder="/Users/name/Downloads/problem-file.jpg"
          rows={3}
        />
      </label>
      <div className="button-row">
        <button
          className="secondary"
          onClick={() => setSettings({ ...settings, mode: "custom", maxMediaFileBytes: 0, scanExclusions: defaultScanExclusions })}
          disabled={busy}
        >
          <Undo2 size={17} />
          <span>Reset defaults</span>
        </button>
        <button className="primary" onClick={saveSettings} disabled={busy}>
          <Save size={17} />
          <span>Save exclusions</span>
        </button>
      </div>
    </div>
  );
}

function InstallerDiagnosticsPanel({
  result,
  modelIntegrity,
  modelDriftReport,
  busy,
  runDiagnostics,
  runModelIntegrity,
  runModelDriftReport
}: {
  result: InstallerDiagnosticsResult | null;
  modelIntegrity: ModelIntegrityResult | null;
  modelDriftReport: ModelDriftReport | null;
  busy: boolean;
  runDiagnostics(): void;
  runModelIntegrity(): void;
  runModelDriftReport(): void;
}) {
  const staleCount = (modelDriftReport?.counts.staleReferences ?? 0) + (modelDriftReport?.counts.staleCandidates ?? 0);
  return (
    <div className={result?.ok ? "panel settings-panel runtime-test-panel ok" : "panel settings-panel runtime-test-panel warn"}>
      <div className="panel-title"><KeyRound size={18} /> First-run readiness</div>
      {result ? (
        <>
          <div className="self-test-list">
            {result.checks.map((check) => (
              <span key={check.name} className={check.ok ? "pass" : "fail"}>
                {check.ok ? <Check size={16} /> : <AlertCircle size={16} />}
                <strong>{check.name}</strong>
                <small>{check.detail}</small>
              </span>
            ))}
          </div>
          <div className="health-list">
            {result.recommendations.slice(0, 4).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          <small className="compact">Checked {formatDateTime(result.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Check the pieces that matter before sharing an installer: writable app folder, model downloader, photo/video support, Safe Mode, and packaged backend readiness.</p>
      )}
      {modelIntegrity && (
        <div className={modelIntegrity.ok ? "health-list" : "health-list warn"}>
          {modelIntegrity.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
        </div>
      )}
      {modelDriftReport && (
        <>
          <div className="workspace-health-grid">
            <span><small>Active model</small><strong>{engineLabel(modelDriftReport.currentModel)}</strong></span>
            <span><small>Saved photos to refresh</small><strong>{formatNumber(modelDriftReport.counts.staleReferences)}</strong></span>
            <span><small>Matches to recheck</small><strong>{formatNumber(modelDriftReport.counts.staleCandidates)}</strong></span>
            <span><small>Status</small><strong>{staleCount ? "Review" : "Ready"}</strong></span>
          </div>
          <div className={staleCount ? "health-list warn" : "health-list"}>
            {modelDriftReport.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
        </>
      )}
      <div className="button-row">
        <button className="secondary" onClick={runDiagnostics} disabled={busy}>
          <Activity size={17} />
          <span>Run first-run check</span>
        </button>
        <button className="secondary" onClick={runModelIntegrity} disabled={busy}>
          <ShieldCheck size={17} />
          <span>Verify models</span>
        </button>
        <button className="secondary" onClick={runModelDriftReport} disabled={busy}>
          <RefreshCcw size={17} />
          <span>Check saved model</span>
        </button>
      </div>
    </div>
  );
}

function referenceGapLabel(gap: string) {
  const labels: Record<string, string> = {
    "needs-active-model-backfill": "Refresh saved photos",
    "needs-more-references": "Add more photos",
    "needs-side-reference": "Add side photo",
    "needs-angled-reference": "Add angled photo",
    "needs-age-coverage": "Add another age",
    "needs-clearer-reference": "Use clearer photo",
    "needs-review-feedback": "Review a few",
    "mixed-model-references": "Mixed model"
  };
  return labels[gap] ?? gap.replaceAll("-", " ");
}

function ReferenceGapPanel({
  report,
  busy,
  runReport,
  copyText,
  startReferenceFix
}: {
  report: ReferenceGapReport | null;
  busy: boolean;
  runReport(): void;
  copyText(text: string, label?: string): void;
  startReferenceFix(personName: string): void;
}) {
  const visibleItems = (report?.items ?? []).filter((item) => item.status !== "strong").slice(0, 5);
  const fallbackItems = report?.items.slice(0, 5) ?? [];
  const rows = visibleItems.length ? visibleItems : fallbackItems;
  const summary = report
    ? {
        generatedAt: report.generatedAt,
        currentModel: report.currentModel,
        people: report.people,
        needsAttention: report.needsAttention,
        averageScore: report.averageScore,
        topGaps: report.topGaps,
        recommendations: report.recommendations,
        peopleToFix: rows.map((item) => ({
          personName: item.personName,
          score: item.score,
          status: item.status,
          references: item.referenceCount,
          actions: item.actions,
          gaps: item.gaps
        }))
      }
    : null;
  return (
    <div className={report?.needsAttention ? "panel settings-panel reference-gap-panel warn" : "panel settings-panel reference-gap-panel"}>
      <div className="panel-title"><UserPlus size={18} /> Saved people check</div>
      {report ? (
        <>
          <div className="workspace-health-grid reference-gap-summary">
            <span className={report.needsAttention ? "warn" : "ok"}><small>People</small><strong>{formatNumber(report.people)}</strong></span>
            <span className={report.needsAttention ? "warn" : "ok"}><small>Needs help</small><strong>{formatNumber(report.needsAttention)}</strong></span>
            <span><small>Average strength</small><strong>{Math.round(report.averageScore)}%</strong></span>
            <span><small>Active model</small><strong>{engineLabel(report.currentModel)}</strong></span>
          </div>
          <div className={report.needsAttention ? "health-list warn" : "health-list"}>
            {report.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          {report.topGaps.length > 0 && (
            <div className="reference-gap-chips" aria-label="Top reference gaps">
              {report.topGaps.map((gap) => (
                <span key={gap.gap}>{referenceGapLabel(gap.gap)} <strong>{formatNumber(gap.count)}</strong></span>
              ))}
            </div>
          )}
          <div className="reference-gap-list">
            {rows.length ? rows.map((item) => {
              const poseCount = item.poseCounts.frontal + item.poseCounts.threeQuarter + item.poseCounts.profile + item.poseCounts.edgeFace + item.poseCounts.unknown;
              const ageCount = Object.values(item.ageBuckets).filter((value) => value > 0).length;
              return (
                <div className={`reference-gap-row ${item.status}`} key={item.personName}>
                  <div className="reference-gap-score" aria-label={`${item.personName} reference strength ${item.score} percent`}>
                    <strong>{item.score}</strong>
                    <small>/100</small>
                  </div>
                  <div className="reference-gap-body">
                    <strong>{item.personName}</strong>
                    <small>
                      {formatNumber(item.referenceCount)} saved photo{item.referenceCount === 1 ? "" : "s"} • {formatNumber(poseCount)} pose sample{poseCount === 1 ? "" : "s"} • {formatNumber(ageCount)} age range{ageCount === 1 ? "" : "s"}
                    </small>
                    <div className="reference-gap-actions">
                      {(item.actions.length ? item.actions : ["Reference coverage is ready."]).slice(0, 3).map((action) => <span key={action}>{action}</span>)}
                    </div>
                  </div>
                  <span className={`status-pill ${item.status}`}>{item.status === "blocked" ? "Refresh" : item.status}</span>
                  <button className="secondary compact-action" onClick={() => startReferenceFix(item.personName)} disabled={busy} type="button">
                    <UserPlus size={15} />
                    <span>Add photos</span>
                  </button>
                </div>
              );
            }) : (
              <div className="empty compact-empty">
                <UserPlus size={24} />
                <strong>No saved people yet</strong>
                <span>Add person photos first, then run this check before scanning a large library.</span>
              </div>
            )}
          </div>
          <small className="compact">Checked {formatDateTime(report.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Before a large scan, check whether each saved person has enough clear front, angled, side, and age-range photos.</p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={runReport} disabled={busy}>
          <RefreshCcw size={17} />
          <span>Check saved people</span>
        </button>
        <button className="ghost compact-action" onClick={() => summary && copyText(JSON.stringify(summary, null, 2), "Saved people check")} disabled={!summary}>
          <CopyIcon size={16} />
          <span>Copy summary</span>
        </button>
      </div>
    </div>
  );
}

function ReviewRulesPanel({
  settings,
  setSettings,
  saveSettings,
  result,
  busy,
  applyReviewRules
}: {
  settings: SettingsDraft;
  setSettings(value: SettingsDraft): void;
  saveSettings(): void;
  result: ReviewRulesApplyResult | null;
  busy: boolean;
  applyReviewRules(): void;
}) {
  function updateRules(values: Partial<SettingsDraft["reviewRules"]>) {
    setSettings({
      ...settings,
      mode: "custom",
      reviewRules: { ...settings.reviewRules, ...values }
    });
  }
  const enabled = settings.reviewRules.autoRejectBelow > 0 ||
    settings.reviewRules.autoUncertainLowQuality ||
    settings.reviewRules.autoRejectLowQualityVideo;
  return (
    <div className="panel settings-panel review-rules-panel">
      <div className="panel-title"><ShieldCheck size={18} /> Review rules</div>
      <p className="compact">Use gentle rules to clean obvious review noise. These only affect pending possible matches and every change is saved in activity history.</p>
      <Slider
        label="Reject below strength"
        value={settings.reviewRules.autoRejectBelow}
        onChange={(value) => updateRules({ autoRejectBelow: value })}
      />
      <label className="switch-row">
        <span>
          <strong>Mark low-quality photos as not sure</strong>
          <small>Useful when blurry items should stay visible but not block your main review.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.reviewRules.autoUncertainLowQuality}
          onChange={(event) => updateRules({ autoUncertainLowQuality: event.currentTarget.checked })}
          aria-label="Mark low-quality photos as not sure"
        />
      </label>
      <label className="switch-row">
        <span>
          <strong>Reject low-quality video moments</strong>
          <small>Removes very weak extracted frames from long videos.</small>
        </span>
        <input
          type="checkbox"
          checked={settings.reviewRules.autoRejectLowQualityVideo}
          onChange={(event) => updateRules({ autoRejectLowQualityVideo: event.currentTarget.checked })}
          aria-label="Reject low-quality video moments"
        />
      </label>
      {result && (
        <div className="workspace-health-grid">
          <span><small>Checked</small><strong>{formatNumber(result.checked)}</strong></span>
          <span><small>Updated</small><strong>{formatNumber(result.updated)}</strong></span>
          <span><small>Low score</small><strong>{formatNumber(result.rejectedLowScore)}</strong></span>
          <span><small>Low quality</small><strong>{formatNumber(result.uncertainLowQuality + result.rejectedLowQualityVideo)}</strong></span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={saveSettings} disabled={busy}>
          <Save size={17} />
          <span>Save rules</span>
        </button>
        <button className="primary" onClick={applyReviewRules} disabled={busy || !enabled}>
          <ShieldCheck size={17} />
          <span>Apply to pending</span>
        </button>
      </div>
    </div>
  );
}

function DuplicatePeoplePanel({
  result,
  busy,
  loadDuplicatePeople,
  mergeDuplicatePeople
}: {
  result: DuplicatePeopleResult | null;
  busy: boolean;
  loadDuplicatePeople(): void;
  mergeDuplicatePeople(sourceName: string, targetName: string): void;
}) {
  const suggestions = result?.suggestions ?? [];
  return (
    <div className="panel settings-panel duplicate-people-panel">
      <div className="panel-title">
        <Users size={18} /> Duplicate people
        <div className="spacer" />
        {result && <span className="title-count">{suggestions.length}</span>}
      </div>
      {suggestions.length ? (
        <div className="duplicate-person-list">
          {suggestions.map((item) => (
            <div key={`${item.personA}-${item.personB}-${item.score}`} className="duplicate-person-row">
              <div>
                <strong>{item.personA} and {item.personB}</strong>
                <small>{percent(item.score)} similar across saved face photos. {item.countA} vs {item.countB} saved photo(s).</small>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={() => mergeDuplicatePeople(item.personB, item.personA)} disabled={busy}>
                  <Users size={16} />
                  <span>Merge into {item.personA}</span>
                </button>
                <button className="secondary" onClick={() => mergeDuplicatePeople(item.personA, item.personB)} disabled={busy}>
                  <Users size={16} />
                  <span>Merge into {item.personB}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="compact">{result ? "No duplicate person labels found at the current similarity level." : "Find person labels that may represent the same person before a big scan creates more review work."}</p>
      )}
      <button className="secondary" onClick={loadDuplicatePeople} disabled={busy}>
        <Activity size={17} />
        <span>Find duplicate people</span>
      </button>
    </div>
  );
}

function SettingsProfilePanel({
  busy,
  copySettingsProfile,
  applySettingsProfile
}: {
  busy: boolean;
  copySettingsProfile(): void;
  applySettingsProfile(text: string): void;
}) {
  const [profileText, setProfileText] = useState("");
  return (
    <div className="panel settings-panel settings-profile-panel">
      <div className="panel-title"><SlidersHorizontal size={18} /> Settings profile</div>
      <p className="compact">Copy your current scan setup or paste a profile from another computer. It applies as Custom until you save it.</p>
      <textarea
        aria-label="Settings profile JSON"
        value={profileText}
        onChange={(event) => setProfileText(event.currentTarget.value)}
        placeholder="Paste a Vintrace settings profile here"
        rows={5}
      />
      <div className="button-row">
        <button className="secondary" onClick={copySettingsProfile} disabled={busy}>
          <Archive size={17} />
          <span>Copy profile</span>
        </button>
        <button className="primary" onClick={() => applySettingsProfile(profileText)} disabled={busy || !profileText.trim()}>
          <Check size={17} />
          <span>Apply pasted profile</span>
        </button>
      </div>
    </div>
  );
}

function WorkspaceLockPanel({
  status,
  busy,
  enable,
  lockNow,
  unlock,
  disable
}: {
  status: WorkspaceLockStatus | null;
  busy: boolean;
  enable(): void;
  lockNow(): void;
  unlock(): void;
  disable(): void;
}) {
  const enabled = Boolean(status?.enabled);
  const locked = Boolean(status?.locked);
  return (
    <div className={locked ? "panel settings-panel runtime-test-panel warn" : "panel settings-panel"}>
      <div className="panel-title">
        <Lock size={18} /> Workspace Lock
        <div className="spacer" />
        <span className={locked ? "status rejected" : enabled ? "status accepted" : "status pending"}>{locked ? "locked" : enabled ? "on" : "off"}</span>
      </div>
      <p className="compact">{localizeImperativeText(status?.message ?? "Add an OS-encrypted app lock to this app folder. Original photos are not modified.")}</p>
      <dl className="mini-list">
        <dt>Encryption</dt><dd>{status?.supported ? "Available" : "Not available"}</dd>
        <dt>Scope</dt><dd title={status?.workspace ?? ""}>{status?.workspace ? basename(status.workspace) : "Current app folder"}</dd>
      </dl>
      <div className="button-row">
        {!enabled ? (
          <button className="primary" onClick={enable} disabled={busy || status?.supported === false}>
            <KeyRound size={17} />
            <span>Turn on lock</span>
          </button>
        ) : locked ? (
          <button className="primary" onClick={unlock} disabled={busy || status?.supported === false}>
            <Unlock size={17} />
            <span>Unlock</span>
          </button>
        ) : (
          <button className="secondary" onClick={lockNow} disabled={busy}>
            <Lock size={17} />
            <span>Lock now</span>
          </button>
        )}
        <button className="secondary danger" onClick={disable} disabled={busy || !enabled || locked}>
          <Trash2 size={17} />
          <span>Turn off</span>
        </button>
      </div>
    </div>
  );
}

function ScaleReadinessPanel({
  state,
  pruneScanManifests,
  pruneResult,
  busy
}: {
  state: AppState;
  pruneScanManifests(): void;
  pruneResult: ScanManifestPruneValue | null;
  busy: boolean;
}) {
  const scale = state.scale;
  const calibration = state.calibration;
  const candidateWindow = state.candidateWindow;
  const rows = [
    { label: "Manifest files", value: formatNumber(scale?.manifestFiles ?? 0) },
    { label: "Hash resume", value: formatNumber(scale?.hashResumeEntries ?? 0) },
    { label: "Safe cache", value: formatNumber(scale?.safetyCacheEntries ?? 0) },
    { label: "Face cache", value: formatNumber(scale?.embeddingCacheEntries ?? 0) },
    { label: "Review index", value: formatNumber(scale?.reviewCandidateRows ?? 0) },
    { label: "Calibration labels", value: formatNumber(calibration?.totalLabels ?? 0) },
    { label: "Scale DB", value: formatBytes(scale?.dbBytes ?? 0) }
  ];
  return (
    <div className="panel settings-panel scale-readiness-panel">
      <div className="panel-title"><Database size={18} /> Large folder readiness</div>
      <div className="workspace-health-grid">
        {rows.map((row) => (
          <span key={row.label}>
            <small>{row.label}</small>
            <strong>{row.value}</strong>
          </span>
        ))}
      </div>
      <div className="health-list">
        <span>Folder scans stream from disk and write a resumable manifest.</span>
        <span>Completed files can resume by content hash when timestamps or copied folders change.</span>
        <span>Safe Mode scores are cached by file hash and model version.</span>
        <span>Face detections are cached per model and scan detail for faster repeated passes.</span>
        <span>Review decisions build the local calibration set over time.</span>
        {candidateWindow?.truncated && <span>Showing {formatNumber(candidateWindow.returned)} of {formatNumber(candidateWindow.total)} possible matches to keep the app responsive.</span>}
      </div>
      {calibration?.recommendedLikelyThreshold !== null && calibration?.recommendedLikelyThreshold !== undefined && (
        <small className="compact">Suggested likely level from labels: {scoreLabel(calibration.recommendedLikelyThreshold)}</small>
      )}
      {pruneResult && (
        <div className="health-list">
          <span>Last manifest cleanup removed {formatNumber(pruneResult.filesDeleted)} file row(s) from {formatNumber(pruneResult.runsDeleted)} old scan run(s).</span>
        </div>
      )}
      <button className="secondary" onClick={pruneScanManifests} disabled={busy || (scale?.scanRuns ?? 0) <= 20}>
        <Trash2 size={17} />
        <span>Clean old manifests</span>
      </button>
    </div>
  );
}

function BenchmarkPanel({ result, history, busy, runBenchmark }: { result: RuntimeBenchmarkResult | null; history: RuntimeBenchmarkResult[]; busy: boolean; runBenchmark(): void }) {
  const visibleHistory = history.slice(0, 5);
  return (
    <div className="panel settings-panel benchmark-panel">
      <div className="panel-title"><Gauge size={18} /> Machine benchmark</div>
      {result ? (
        <>
          <div className="workspace-health-grid">
            <span><small>Vector add</small><strong>{formatNumber(Math.round(result.vectorAddPerSecond))}/s</strong></span>
            <span><small>Search p50</small><strong>{result.vectorSearchP50MsEstimate.toFixed(3)} ms</strong></span>
            <span><small>State</small><strong>{result.stateSerializeMs.toFixed(1)} ms</strong></span>
            <span><small>Backend</small><strong>{result.vectorBackend}</strong></span>
            <span><small>Mode</small><strong>{result.performanceMode === "auto" ? `Auto: ${result.effectivePerformanceMode ?? "balanced"}` : result.effectivePerformanceMode ?? result.performanceMode ?? "balanced"}</strong></span>
            <span><small>Memory</small><strong>{result.resourceStatus?.memoryPressure ?? "normal"}</strong></span>
            <span><small>Storage write</small><strong>{result.storageIo?.ok ? `${Math.round(result.storageIo.writeMBps)} MB/s` : "Check"}</strong></span>
            <span><small>Storage read</small><strong>{result.storageIo?.ok ? `${Math.round(result.storageIo.readMBps)} MB/s` : "Check"}</strong></span>
          </div>
          <div className="health-list">
            {result.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          <small className="compact">Benchmarked {formatDateTime(result.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Run a local benchmark to check vector search speed, state serialization, and scale database health on this machine.</p>
      )}
      {visibleHistory.length > 0 && (
        <div className="benchmark-history" aria-label="Recent benchmark history">
          {visibleHistory.map((item) => (
            <div key={item.runId}>
              <span>{formatDateTime(item.generatedAt)}</span>
              <strong>{formatNumber(Math.round(item.vectorAddPerSecond))}/s</strong>
              <small>{item.storageIo?.ok ? `${Math.round(item.storageIo.writeMBps)} MB/s write` : "storage not measured"}</small>
            </div>
          ))}
        </div>
      )}
      <button className="secondary" onClick={runBenchmark} disabled={busy}>
        <Activity size={17} />
        <span>Run benchmark</span>
      </button>
    </div>
  );
}

function VideoDecoderPanel({
  report,
  settings,
  setSettings,
  saveSettings,
  copyText,
  busy
}: {
  report: AppState["videoDecoder"];
  settings: SettingsDraft;
  setSettings(value: SettingsDraft): void;
  saveSettings(): void;
  copyText(text: string, label?: string): void;
  busy: boolean;
}) {
  const ready = Boolean(report?.opencvAvailable || report?.ffmpegAvailable);
  const backend = report?.backend && report.backend !== "unavailable" ? report.backend.toUpperCase() : "Not ready";
  const ffmpegDisplay = report?.ffmpegPath ? `${basename(report.ffmpegPath)} (${report.ffmpegSource ?? "auto"})` : "Missing";
  const ffprobeDisplay = report?.ffprobePath ? `${basename(report.ffprobePath)} (${report.ffprobeSource ?? "auto"})` : report?.probeLimited ? "Limited" : "Missing";
  function updateVideoDecoder(values: Partial<VideoDecoderConfig>) {
    setSettings({
      ...settings,
      mode: "custom",
      videoDecoder: {
        ...(settings.videoDecoder ?? defaultVideoDecoder),
        ...values
      }
    });
  }
  function resetAutoDetect() {
    updateVideoDecoder({ ffmpegPath: "", ffprobePath: "" });
  }
  function copyInstallHelp() {
    copyText(
      [
        "Vintrace video decoder options",
        "",
        "Managed dependency used by packaged builds:",
        "python -m pip install imageio-ffmpeg",
        "",
        "Optional full metadata support:",
        "macOS: brew install ffmpeg",
        "Windows: install a trusted FFmpeg build, then set ffmpeg.exe and ffprobe.exe paths in Settings."
      ].join("\n"),
      "Video decoder setup"
    );
  }
  return (
    <div className={ready ? "panel settings-panel runtime-test-panel ok" : "panel settings-panel runtime-test-panel warn"}>
      <div className="panel-title"><Video size={18} /> Video decoder</div>
      <div className="workspace-health-grid">
        <span><small>Active path</small><strong>{backend}</strong></span>
        <span><small>Managed FFmpeg</small><strong>{report?.managedPackageAvailable ? "Ready" : "Missing"}</strong></span>
        <span><small>FFmpeg</small><strong title={report?.ffmpegPath || ""}>{ffmpegDisplay}</strong></span>
        <span><small>Metadata</small><strong title={report?.ffprobePath || ""}>{ffprobeDisplay}</strong></span>
      </div>
      <div className="health-list">
        {(report?.recommendations?.length ? report.recommendations : [ready ? "Video decoding is available for scans." : "Install managed FFmpeg or choose a local FFmpeg binary."]).slice(0, 3).map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
      <details className="accuracy-import">
        <summary>Manual decoder paths</summary>
        <div className="advanced-settings">
          <label>FFmpeg binary
            <input
              type="text"
              value={settings.videoDecoder.ffmpegPath}
              onChange={(event) => updateVideoDecoder({ ffmpegPath: event.currentTarget.value })}
              placeholder="/path/to/ffmpeg"
              spellCheck={false}
            />
          </label>
          <label>FFprobe binary
            <input
              type="text"
              value={settings.videoDecoder.ffprobePath}
              onChange={(event) => updateVideoDecoder({ ffprobePath: event.currentTarget.value })}
              placeholder="/path/to/ffprobe"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={saveSettings} disabled={busy} type="button">
            <Save size={17} />
            <span>Save decoder</span>
          </button>
          <button className="ghost compact-action" onClick={resetAutoDetect} type="button">
            <RefreshCcw size={16} />
            <span>Auto-detect</span>
          </button>
          <button className="ghost compact-action" onClick={copyInstallHelp} type="button">
            <Download size={16} />
            <span>Setup help</span>
          </button>
        </div>
      </details>
      {report?.licenseNote && <small className="compact">{report.licenseNote}</small>}
    </div>
  );
}

function AccuracyLabPanel({
  result,
  validationPack,
  datasetCatalog,
  datasetInspection,
  datasetBenchmark,
  modelComparison,
  calibration,
  busy,
  runAccuracyEvaluation,
  generateAccuracyValidationPack,
  chooseDatasetFolder,
  inspectDataset,
  runDatasetBenchmark,
  runModelComparison,
  applyModelRecommendation,
  applyCalibration,
  exportAccuracyLabels,
  importAccuracyLabels,
  copyText
}: {
  result: AccuracyEvaluation | null;
  validationPack: AccuracyValidationPackValue | null;
  datasetCatalog: PublicDatasetCatalog | null;
  datasetInspection: PublicDatasetInspection | null;
  datasetBenchmark: PublicDatasetBenchmarkResult | null;
  modelComparison: PublicDatasetModelComparisonResult | null;
  calibration: AppState["calibration"];
  busy: boolean;
  runAccuracyEvaluation(): void;
  generateAccuracyValidationPack(): void;
  chooseDatasetFolder(): Promise<string | null>;
  inspectDataset(options: { datasetId: string; folder: string; includeVideos?: boolean }): void | Promise<void>;
  runDatasetBenchmark(options: { datasetId: string; folder: string; maxIdentities: number; candidateImages: number; downloadIfMissing?: boolean; includeVideos?: boolean }): void | Promise<void>;
  runModelComparison(options: { datasetId: string; folder: string; maxIdentities: number; candidateImages: number; downloadIfMissing?: boolean; includeVideos?: boolean }): void | Promise<void>;
  applyModelRecommendation(pack: string): void | Promise<void>;
  applyCalibration(): void;
  exportAccuracyLabels(): void;
  importAccuracyLabels(text: string): void | Promise<void>;
  copyText(text: string, label?: string): void;
}) {
  const [importText, setImportText] = useState("");
  const [datasetId, setDatasetId] = useState("lfw");
  const [datasetFolder, setDatasetFolder] = useState("");
  const [datasetMaxIdentities, setDatasetMaxIdentities] = useState(12);
  const [datasetCandidateImages, setDatasetCandidateImages] = useState(3);
  const [datasetDownloadPublic, setDatasetDownloadPublic] = useState(true);
  const [datasetIncludeVideos, setDatasetIncludeVideos] = useState(false);
  const datasets = datasetCatalog?.datasets ?? [];
  const selectedDataset = datasets.find((item) => item.datasetId === datasetId) ?? datasets[0] ?? null;
  const canAutoPrepareDataset = Boolean(selectedDataset?.download?.available);
  const likely = result?.metrics.likely;
  const labelCount = likely?.labeled ?? calibration?.matchLabels ?? 0;
  const importDisabled = busy || !importText.trim();
  const canRunDataset = !busy && Boolean(datasetFolder.trim() || canAutoPrepareDataset);
  const preferredMatrixKeys = [
    "all",
    "age:cross-age",
    "pose:profile",
    "pose:frontal",
    "pose:three-quarter",
    "media:video",
    "hard-negative:family-lookalike",
    "scale:distractor",
    "dataset:ijbc-template",
    "expected:non-match"
  ];
  const validationMatrix = datasetBenchmark?.validationMatrix ?? {};
  const benchmarkMatrixItems = [
    ...preferredMatrixKeys
      .map((key) => validationMatrix[key])
      .filter((item): item is NonNullable<PublicDatasetBenchmarkResult["validationMatrix"]>[string] => Boolean(item)),
    ...Object.values(validationMatrix).filter((item) => !preferredMatrixKeys.includes(item.key))
  ];
  async function submitImport() {
    if (!importText.trim()) return;
    await importAccuracyLabels(importText);
    setImportText("");
  }
  async function chooseFolderForDataset() {
    const folder = await chooseDatasetFolder();
    if (folder) setDatasetFolder(folder);
  }
  async function inspectSelectedDataset() {
    if (!datasetFolder.trim()) return;
    await inspectDataset({ datasetId, folder: datasetFolder, includeVideos: datasetIncludeVideos });
  }
  async function runSelectedDatasetBenchmark() {
    await runDatasetBenchmark({
      datasetId,
      folder: datasetFolder,
      maxIdentities: datasetMaxIdentities,
      candidateImages: datasetCandidateImages,
      downloadIfMissing: datasetDownloadPublic,
      includeVideos: datasetIncludeVideos
    });
  }
  async function runSelectedModelComparison() {
    await runModelComparison({
      datasetId,
      folder: datasetFolder,
      maxIdentities: datasetMaxIdentities,
      candidateImages: datasetCandidateImages,
      downloadIfMissing: datasetDownloadPublic,
      includeVideos: datasetIncludeVideos
    });
  }
  return (
    <div className="panel settings-panel benchmark-panel">
      <div className="panel-title"><Crosshair size={18} /> Accuracy lab</div>
      {result && likely ? (
        <>
          <div className="workspace-health-grid">
            <span><small>Reviewed labels</small><strong>{formatNumber(likely.labeled)}</strong></span>
            <span><small>Precision</small><strong>{percent(likely.precision)}</strong></span>
            <span><small>Recall</small><strong>{percent(likely.recall)}</strong></span>
            <span><small>False positives</small><strong>{formatNumber(likely.falsePositives)}</strong></span>
          </div>
          <div className="health-list">
            {result.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          <small className="compact">Checked {formatDateTime(result.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Use accepted and rejected matches as a local ground-truth set. The app reports precision, recall, and threshold advice without uploading photos.</p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={runAccuracyEvaluation} disabled={busy}>
          <Activity size={17} />
          <span>Run accuracy check</span>
        </button>
        <button className="secondary" onClick={applyCalibration} disabled={busy || labelCount < 8}>
          <SlidersHorizontal size={17} />
          <span>Apply feedback</span>
        </button>
        <button className="secondary" onClick={exportAccuracyLabels} disabled={busy || labelCount < 1}>
          <Archive size={17} />
          <span>Export labels</span>
        </button>
        <button className="secondary" onClick={generateAccuracyValidationPack} disabled={busy}>
          <Crosshair size={17} />
          <span>Create validation pack</span>
        </button>
      </div>
      {validationPack && (
        <div className="validation-pack-card">
          <div className="workspace-health-grid">
            <span><small>Status</small><strong>{validationPack.status ?? "complete"}</strong></span>
            <span><small>Cases</small><strong>{formatNumber(validationPack.counts.cases)}</strong></span>
            <span><small>Matches</small><strong>{formatNumber(validationPack.counts.matches)}</strong></span>
            <span><small>Non-matches</small><strong>{formatNumber(validationPack.counts.nonMatches)}</strong></span>
            <span><small>Likely precision</small><strong>{percent(validationPack.metrics.likely?.precision ?? 0)}</strong></span>
          </div>
          {validationPack.scenarioResults?.length ? (
            <div className="validation-scenario-grid">
              {validationPack.scenarioResults.map((item) => (
                <span key={item.scenario} className={item.status === "pass" ? "ok" : item.status === "warn" ? "warn" : "fail"}>
                  {item.status === "pass" ? <Check size={14} /> : <AlertCircle size={14} />}
                  <strong>{item.scenario}</strong>
                  <small>{item.status} · {item.score.toFixed(2)}</small>
                </span>
              ))}
            </div>
          ) : null}
          <div className="health-list">
            {validationPack.recommendations.slice(0, 2).map((item) => <span key={item}>{item}</span>)}
          </div>
          <div className="button-row">
            <button className="ghost compact-action" onClick={() => copyText(validationPack.manifestPath, "Validation manifest path")} type="button">
              <Archive size={16} />
              <span>Copy manifest path</span>
            </button>
            <button className="ghost compact-action" onClick={() => copyText(validationPack.scenarios.join(", "), "Validation scenarios")} type="button">
              <BookOpen size={16} />
              <span>Copy scenarios</span>
            </button>
          </div>
        </div>
      )}
      <details className="accuracy-import public-dataset-lab" open={Boolean(datasetBenchmark)}>
        <summary>Public dataset benchmark</summary>
        <div className="settings-form-grid">
          <label>
            <span>Dataset</span>
            <select value={datasetId} onChange={(event) => setDatasetId(event.currentTarget.value)}>
              {(datasets.length ? datasets : [{ datasetId: "lfw", shortName: "LFW", name: "Labeled Faces in the Wild" } as PublicDatasetCatalogEntry]).map((dataset) => (
                <option key={dataset.datasetId} value={dataset.datasetId}>{dataset.shortName}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Max identities</span>
            <input type="number" min={2} max={250} value={datasetMaxIdentities} onChange={(event) => setDatasetMaxIdentities(Number(event.currentTarget.value) || 12)} />
          </label>
          <label>
            <span>Held-out images each</span>
            <input type="number" min={1} max={20} value={datasetCandidateImages} onChange={(event) => setDatasetCandidateImages(Number(event.currentTarget.value) || 3)} />
          </label>
        </div>
        {selectedDataset ? (
          <div className="validation-pack-card">
            <strong>{selectedDataset.name}</strong>
            <span>{selectedDataset.recommendedUse}</span>
            {selectedDataset.bestFor?.length ? <small>Best for: {selectedDataset.bestFor.join(", ")}</small> : null}
            <small>{formatNumber(selectedDataset.scale.images)} images, {formatNumber(selectedDataset.scale.identities)} identities, {formatNumber(selectedDataset.scale.videos)} videos</small>
            <small>{selectedDataset.terms}</small>
          </div>
        ) : null}
        <div className="button-row">
          <button className="secondary" onClick={() => void chooseFolderForDataset()} disabled={busy} type="button">
            <FolderOpen size={17} />
            <span>Choose dataset folder</span>
          </button>
          <button className="secondary" onClick={() => void inspectSelectedDataset()} disabled={busy || !datasetFolder.trim()} type="button">
            <Search size={17} />
            <span>Inspect dataset</span>
          </button>
          <button className="secondary" onClick={() => void runSelectedDatasetBenchmark()} disabled={!canRunDataset} type="button">
            <Gauge size={17} />
            <span>Run dataset benchmark</span>
          </button>
          <button className="secondary" onClick={() => void runSelectedModelComparison()} disabled={!canRunDataset} type="button">
            <SlidersHorizontal size={17} />
            <span>Compare model packs</span>
          </button>
        </div>
        <div className="settings-toggle-row">
          <label>
            <input type="checkbox" checked={datasetDownloadPublic} onChange={(event) => setDatasetDownloadPublic(event.currentTarget.checked)} disabled={!canAutoPrepareDataset} />
            <span>Use {selectedDataset?.shortName ?? "dataset"} cache/download when no folder is chosen</span>
          </label>
          <label>
            <input type="checkbox" checked={datasetIncludeVideos} onChange={(event) => setDatasetIncludeVideos(event.currentTarget.checked)} />
            <span>Include video files when identities also have image references</span>
          </label>
        </div>
        {datasetFolder ? <small className="path-chip" title={datasetFolder}>{datasetFolder}</small> : null}
        {datasetInspection ? (
          <div className="workspace-health-grid">
            <span><small>Usable identities</small><strong>{formatNumber(datasetInspection.usableIdentityCount)}</strong></span>
            <span><small>Images</small><strong>{formatNumber(datasetInspection.imageCount)}</strong></span>
            <span><small>Videos</small><strong>{formatNumber(datasetInspection.videoCount)}</strong></span>
            <span><small>Checked</small><strong>{formatNumber(datasetInspection.entriesChecked)}</strong></span>
          </div>
        ) : null}
        {datasetBenchmark ? (
          <div className="validation-pack-card">
            <div className="workspace-health-grid">
              <span><small>Evaluated</small><strong>{formatNumber(datasetBenchmark.metrics.evaluated)}</strong></span>
              <span><small>Review precision</small><strong>{percent(datasetBenchmark.metrics.precision)}</strong></span>
              <span><small>Review recall</small><strong>{percent(datasetBenchmark.metrics.recall)}</strong></span>
              {datasetBenchmark.metricsByThreshold?.likely ? (
                <>
                  <span><small>Likely precision</small><strong>{percent(datasetBenchmark.metricsByThreshold.likely.precision)}</strong></span>
                  <span><small>Likely recall</small><strong>{percent(datasetBenchmark.metricsByThreshold.likely.recall)}</strong></span>
                </>
              ) : null}
              <span><small>Wrong identity</small><strong>{formatNumber(datasetBenchmark.metrics.wrongIdentity)}</strong></span>
              <span><small>Scan added</small><strong>{formatNumber(datasetBenchmark.pipeline.scanAdded)}</strong></span>
              <span><small>Video files</small><strong>{formatNumber(datasetBenchmark.selected.videoFiles ?? 0)}</strong></span>
              <span><small>Video frames</small><strong>{formatNumber(datasetBenchmark.selected.videoFrames ?? 0)}</strong></span>
              <span><small>Video decode failed</small><strong>{formatNumber(datasetBenchmark.pipeline.videoDecodeFailures?.length ?? 0)}</strong></span>
              <span><small>Side faces recovered</small><strong>{formatNumber(datasetBenchmark.pipeline.scanMetrics.profileRescueFound ?? 0)}</strong></span>
              <span><small>Hard-pose reviews</small><strong>{formatNumber(datasetBenchmark.pipeline.scanMetrics.poseRelaxedReviews ?? 0)}</strong></span>
              <span><small>No face found</small><strong>{formatNumber(datasetBenchmark.pipeline.scanMetrics.noFaceDetected ?? 0)}</strong></span>
              <span><small>Safe face crops</small><strong>{formatNumber(datasetBenchmark.pipeline.scanMetrics.safeModeFaceCropAllowed ?? 0)}</strong></span>
            </div>
            {benchmarkMatrixItems.length ? (
              <div className="validation-matrix-grid">
                {benchmarkMatrixItems.map((item) => (
                  <span key={item.key} className={item.falsePositives || item.wrongIdentity ? "warn" : item.falseNegatives ? "fail" : "ok"}>
                    <strong>{item.label}</strong>
                    <small>{formatNumber(item.count)} cases</small>
                    <em>Precision {percent(item.precision)}</em>
                    <em>Recall {percent(item.recall)}</em>
                    <em>Missed {formatNumber(item.falseNegatives)}</em>
                  </span>
                ))}
              </div>
            ) : null}
            {datasetBenchmark.thresholdCalibration ? (
              <div className="calibration-card">
                <div className="panel-title compact-title">
                  <SlidersHorizontal size={16} />
                  <span>Threshold calibration</span>
                  <div className="spacer" />
                  <small>{datasetBenchmark.thresholdCalibration.pack ? `${datasetBenchmark.thresholdCalibration.pack} · ` : ""}{formatNumber(datasetBenchmark.thresholdCalibration.labelCount)} labels</small>
                </div>
                <div className="workspace-health-grid compact-grid">
                  <span><small>Review more</small><strong>{percent(datasetBenchmark.thresholdCalibration.recommendedThresholds.reviewMore ?? 0)}</strong></span>
                  <span><small>Likely</small><strong>{percent(datasetBenchmark.thresholdCalibration.recommendedThresholds.likely ?? 0)}</strong></span>
                  <span><small>Strong</small><strong>{percent(datasetBenchmark.thresholdCalibration.recommendedThresholds.strong ?? 0)}</strong></span>
                  <span><small>Likely precision</small><strong>{percent(datasetBenchmark.thresholdCalibration.overall.recommendedLikely?.precision ?? 0)}</strong></span>
                  <span><small>Likely recall</small><strong>{percent(datasetBenchmark.thresholdCalibration.overall.recommendedLikely?.recall ?? 0)}</strong></span>
                  <span><small>Wrong identity</small><strong>{formatNumber(datasetBenchmark.thresholdCalibration.overall.recommendedLikely?.wrongIdentity ?? 0)}</strong></span>
                </div>
                <div className="health-list">
                  {datasetBenchmark.thresholdCalibration.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
                </div>
              </div>
            ) : null}
            <div className="health-list">
              {datasetBenchmark.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
            </div>
            <div className="button-row">
              <button className="ghost compact-action" onClick={() => copyText(datasetBenchmark.reportPath, "Dataset benchmark report")} type="button">
                <FileText size={16} />
                <span>Copy report path</span>
              </button>
              <button className="ghost compact-action" onClick={() => copyText(datasetBenchmark.labelsJsonPath, "Dataset labels")} type="button">
                <Archive size={16} />
                <span>Copy label path</span>
              </button>
            </div>
          </div>
        ) : null}
        {modelComparison ? (
          <div className="validation-pack-card model-comparison-card">
            <div className="panel-title compact-title">
              <SlidersHorizontal size={17} />
              <span>Model comparison</span>
              <div className="spacer" />
              <small>{modelComparison.recommendedPack ? `Recommended: ${modelComparison.recommendedPack}` : modelComparison.bestRecallPack ? `Recall: ${modelComparison.bestRecallPack}` : "No winner yet"}</small>
            </div>
            {modelComparison.recommendation ? (
              <div className={`model-recommendation-card ${modelComparison.recommendation.confidence}`}>
                <div>
                  <strong>{modelComparison.recommendation.recommendedLabel || modelComparison.recommendation.recommendedPack || "No model recommendation"}</strong>
                  <small>{modelComparison.recommendation.summary}</small>
                </div>
                <div className="workspace-health-grid compact-grid">
                  <span><small>Confidence</small><strong>{modelComparison.recommendation.confidence}</strong></span>
                  <span><small>Precision</small><strong>{percent(modelComparison.recommendation.precision ?? 0)}</strong></span>
                  <span><small>Recall</small><strong>{percent(modelComparison.recommendation.recall ?? 0)}</strong></span>
                  <span><small>Profile recall</small><strong>{percent(modelComparison.recommendation.profileRecall ?? 0)}</strong></span>
                  <span><small>Cross-age recall</small><strong>{percent(modelComparison.recommendation.crossAgeRecall ?? 0)}</strong></span>
                  <span><small>Lookalike FP</small><strong>{formatNumber(modelComparison.recommendation.hardNegativeFalsePositives ?? 0)}</strong></span>
                </div>
                {modelComparison.recommendation.actions.length ? (
                  <div className="health-list">
                    {modelComparison.recommendation.actions.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
                  </div>
                ) : null}
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => modelComparison.recommendation?.recommendedPack && void applyModelRecommendation(modelComparison.recommendation.recommendedPack)}
                    disabled={busy || !modelComparison.recommendation.recommendedPack || modelComparison.recommendation.status === "unavailable"}
                    type="button"
                  >
                    <Check size={16} />
                    <span>{modelComparison.recommendation.status === "switch" ? "Apply recommendation" : "Backfill current model"}</span>
                  </button>
                  <button className="ghost compact-action" onClick={() => copyText(modelComparison.reportPath, "Model comparison report")} type="button">
                    <Archive size={16} />
                    <span>Copy comparison report</span>
                  </button>
                </div>
              </div>
            ) : null}
            <div className="model-comparison-grid">
              {modelComparison.packs.map((pack) => {
                const likely = pack.metricsByThreshold?.likely;
                const metrics = pack.metrics;
                const profileRecovered = Number(pack.pipeline?.scanMetrics?.profileRescueFound ?? 0);
                const profileMatrix = pack.validationMatrix?.["pose:profile"];
                return (
                  <div key={pack.pack} className={pack.status === "complete" ? "model-comparison-row ok" : pack.status === "missing" ? "model-comparison-row warn" : "model-comparison-row fail"}>
                    <div>
                      <strong>{pack.label || pack.pack}</strong>
                      <small>{pack.status === "complete" ? pack.engine : pack.error || pack.status}</small>
                    </div>
                    <span><small>Precision</small><strong>{metrics ? percent(metrics.precision) : "n/a"}</strong></span>
                    <span><small>Recall</small><strong>{metrics ? percent(metrics.recall) : "n/a"}</strong></span>
                    <span><small>Likely recall</small><strong>{likely ? percent(likely.recall) : "n/a"}</strong></span>
                    <span><small>Profile recall</small><strong>{profileMatrix ? percent(profileMatrix.recall) : "n/a"}</strong></span>
                    <span><small>Side faces</small><strong>{formatNumber(profileRecovered)}</strong></span>
                    {pack.reportPath ? (
                      <button className="ghost compact-action" onClick={() => copyText(pack.reportPath, `${pack.pack} report`)} type="button">
                        <FileText size={15} />
                        <span>Report</span>
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <div className="health-list">
              {modelComparison.recommendations.slice(0, 3).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
            </div>
            {!modelComparison.recommendation ? (
              <button className="ghost compact-action" onClick={() => copyText(modelComparison.reportPath, "Model comparison report")} type="button">
                <Archive size={16} />
                <span>Copy comparison report</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </details>
      <details className="accuracy-import">
        <summary>Import label JSON</summary>
        <label className="diagnostics-json-label">
          <span>Paste a Vintrace accuracy-label export or a raw labels array.</span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.currentTarget.value)}
            spellCheck={false}
            placeholder='{"labels":[{"sourcePath":"...","expectedPerson":"...","isMatch":true}]}'
          />
        </label>
        <div className="button-row">
          <button className="secondary" onClick={() => void submitImport()} disabled={importDisabled} type="button">
            <Archive size={17} />
            <span>Import labels</span>
          </button>
          <button className="ghost compact-action" onClick={() => setImportText("")} disabled={!importText.trim()} type="button">
            <X size={16} />
            <span>Clear</span>
          </button>
        </div>
      </details>
    </div>
  );
}

function ReleaseReadinessPanel({
  result,
  busy,
  runReleaseReadiness
}: {
  result: ReleaseReadinessResult | null;
  busy: boolean;
  runReleaseReadiness(): void;
}) {
  return (
    <div className={result?.ok ? "panel settings-panel runtime-test-panel ok" : "panel settings-panel runtime-test-panel warn"}>
      <div className="panel-title"><Archive size={18} /> Release readiness</div>
      {result ? (
        <>
          <div className="self-test-list">
            {result.checks.map((check) => (
              <span key={check.name} className={check.ok ? "pass" : "fail"}>
                {check.ok ? <Check size={16} /> : <AlertCircle size={16} />}
                <strong>{check.name}</strong>
                <small>{check.detail}</small>
              </span>
            ))}
          </div>
          <small className="compact">Checked {formatDateTime(result.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Check model readiness, Safe Mode, signing, updates, and release operations before sharing installers broadly.</p>
      )}
      <button className="secondary" onClick={runReleaseReadiness} disabled={busy}>
        <Activity size={17} />
        <span>Run release check</span>
      </button>
    </div>
  );
}

function UpdateCenterPanel({
  status,
  busy,
  checkForUpdates,
  setUpdateChannel,
  downloadUpdate,
  installUpdate
}: {
  status: UpdateStatus | null;
  busy: boolean;
  checkForUpdates(): void;
  setUpdateChannel(channel: UpdateChannel): void;
  downloadUpdate(): void;
  installUpdate(): void;
}) {
  const progress = status?.progress;
  const percentValue = Math.round(progress?.percent ?? 0);
  const stateLabel = !status
    ? "Not checked"
    : status.downloaded
      ? "Ready"
      : status.downloading
        ? "Downloading"
        : status.checking
          ? "Checking"
          : status.available
            ? "Available"
            : status.error
              ? "Needs setup"
              : "Current";
  return (
    <div className={status?.error ? "panel settings-panel runtime-test-panel warn" : "panel settings-panel runtime-test-panel"}>
      <div className="panel-title">
        <Download size={18} /> Updates
        <div className="spacer" />
        <span className={status?.available || status?.downloaded ? "status uncertain" : "status accepted"}>{stateLabel}</span>
      </div>
      <p className="compact">{localizeImperativeText(status?.message ?? "Check for signed app updates without leaving the app.")}</p>
      <dl className="mini-list">
        <dt>Installed</dt><dd>{status?.appVersion ?? "Unknown"}</dd>
        <dt>Latest</dt><dd>{status?.latestVersion ?? "Not checked"}</dd>
        <dt>Feed</dt><dd>{status?.provider ?? "Unknown"}</dd>
      </dl>
      <div className="channel-picker" role="group" aria-label="Update channel">
        {(["stable", "beta", "internal"] as UpdateChannel[]).map((channel) => (
          <button
            key={channel}
            className={status?.channel === channel ? "segmented selected" : "segmented"}
            onClick={() => setUpdateChannel(channel)}
            disabled={busy || status?.checking || status?.downloading}
            type="button"
          >
            <span>{channel === "stable" ? "Stable" : channel === "beta" ? "Beta" : "Internal"}</span>
          </button>
        ))}
      </div>
      {progress && (
        <div className="model-progress">
          <div>
            <strong>{percentValue}% downloaded</strong>
            <span>{formatBytes(progress.transferred)} / {formatBytes(progress.total)}</span>
          </div>
          <progress value={percentValue} max={100} aria-label="Update download progress" />
        </div>
      )}
      {status?.error && (
        <div className="settings-warning">
          <AlertCircle size={16} />
          <span>{status.error}</span>
        </div>
      )}
      <div className="button-row">
        <button className="secondary" onClick={checkForUpdates} disabled={busy || status?.checking || status?.downloading || status?.canCheck === false}>
          {status?.checking ? <Loader2 size={17} className="spin" /> : <RefreshCcw size={17} />}
          <span>Check updates</span>
        </button>
        <button className="secondary" onClick={downloadUpdate} disabled={busy || !status?.available || status.downloading || status.downloaded}>
          {status?.downloading ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
          <span>Download</span>
        </button>
        <button className="primary" onClick={installUpdate} disabled={busy || !status?.downloaded}>
          <Archive size={17} />
          <span>Restart to install</span>
        </button>
      </div>
    </div>
  );
}

function DiagnosticsPanel({
  report,
  busy,
  previewDiagnostics,
  exportDiagnostics,
  exportSupportBundle
}: {
  report: DiagnosticsReport | null;
  busy: boolean;
  previewDiagnostics(includePaths?: boolean): void;
  exportDiagnostics(includePaths?: boolean): void;
  exportSupportBundle(includePaths?: boolean): void;
}) {
  const [includePaths, setIncludePaths] = useState(false);
  const latestEvents = report?.diagnostics.events.slice(0, 5) ?? [];
  const summary = report?.diagnostics.summary;
  const topCodes = summary
    ? Object.entries(summary.byCode || {}).sort((left, right) => right[1] - left[1]).slice(0, 4)
    : [];
  const reportPreview = report ? JSON.stringify(report, null, 2) : "";
  const trimmedPreview = reportPreview.length > 12000 ? `${reportPreview.slice(0, 12000)}\n... preview trimmed; exported JSON contains the full report ...` : reportPreview;
  return (
    <div className="panel settings-panel diagnostics-panel">
      <div className="panel-title"><FileText size={18} /> Error reports</div>
      <p className="compact">Create a local report for crashes, hangs, backend errors, and update problems. It never includes photos or face vectors.</p>
      <label className="switch-row">
        <span>
          <strong>Include file paths</strong>
          <small>Off hides home-folder paths in the preview and export.</small>
        </span>
        <input
          type="checkbox"
          checked={includePaths}
          onChange={(event) => setIncludePaths(event.currentTarget.checked)}
          aria-label="Include file paths in diagnostics"
        />
      </label>
      {report ? (
        <>
          <div className="workspace-health-grid">
            <span><small>Events</small><strong>{formatNumber(report.diagnostics.eventCount)}</strong></span>
            <span><small>Backend</small><strong>{report.backend.ready ? "Ready" : "Starting"}</strong></span>
            <span><small>Paths</small><strong>{report.privacy.includesFilePaths ? "Included" : "Hidden"}</strong></span>
            <span><small>Latest code</small><strong>{summary?.latestFailureCode || "None"}</strong></span>
          </div>
          {topCodes.length > 0 && (
            <div className="diagnostics-code-strip" aria-label="Top diagnostic codes">
              {topCodes.map(([code, count]) => (
                <span key={code}><strong>{code}</strong><small>{formatNumber(count)} event{count === 1 ? "" : "s"}</small></span>
              ))}
            </div>
          )}
          <div className="diagnostics-preview" aria-label="Diagnostics preview">
            {latestEvents.length ? latestEvents.map((event, index) => (
              <span key={`${String(event.at)}-${index}`}>
                <strong>{String(event.code || event.type || "event").replace(/_/g, " ")}</strong>
                <small>{String(event.message || event.reason || event.at || "No detail")}</small>
              </span>
            )) : <span><strong>No error events</strong><small>The report still includes app, update, and backend status.</small></span>}
          </div>
          <label className="diagnostics-json-label">Report JSON preview
            <textarea
              aria-label="Diagnostics JSON preview"
              readOnly
              value={trimmedPreview}
            />
          </label>
          <small className="compact">Preview generated {formatDateTime(report.generatedAt)}. Export only after reviewing it.</small>
        </>
      ) : (
        <p className="compact">Preview first, then export a JSON report you can share manually with a developer or tester.</p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={() => previewDiagnostics(includePaths)} disabled={busy}>
          <Eye size={17} />
          <span>Preview report</span>
        </button>
        <button className="primary" onClick={() => exportDiagnostics(includePaths)} disabled={busy || !report}>
          <Archive size={17} />
          <span>Export report</span>
        </button>
        <button className="secondary" onClick={() => exportSupportBundle(includePaths)} disabled={busy}>
          <HardDrive size={17} />
          <span>Support bundle</span>
        </button>
      </div>
    </div>
  );
}

const JURISDICTION_OPTIONS: { id: string; label: string }[] = [
  { id: "standard", label: "Standard (local-first default)" },
  { id: "gdpr", label: "EU — GDPR / EU AI Act" },
  { id: "bipa-il", label: "US — Illinois BIPA" },
  { id: "ccpa-cpra", label: "US — California CCPA/CPRA" },
  { id: "colorado", label: "US — Colorado CPA" }
];

function PrivacyControlPanel({
  report,
  retentionPolicy,
  busy,
  jurisdictionPreset,
  retentionReviewedDays,
  setJurisdictionPreset,
  exportCompliancePack,
  exportExaminationReport,
  loadPrivacyReport,
  loadRetentionPolicyReport,
  exportConsentReceipt,
  exportSafeModeAudit,
  deleteFaceData
}: {
  report: PrivacyReport | null;
  retentionPolicy: RetentionPolicyReport | null;
  busy: boolean;
  jurisdictionPreset: string;
  retentionReviewedDays: number;
  setJurisdictionPreset(preset: string): void;
  exportCompliancePack(): void;
  exportExaminationReport(): void;
  loadPrivacyReport(): void;
  loadRetentionPolicyReport(): void;
  exportConsentReceipt(): void;
  exportSafeModeAudit(): void;
  deleteFaceData(includeAudit?: boolean): void;
}) {
  return (
    <div className="panel settings-panel data-ops-panel">
      <div className="panel-title"><EyeOff size={18} /> Privacy controls</div>
      <label className="switch-row">
        <span>
          <strong>Jurisdiction preset</strong>
          <small>Sets consent strictness and reviewed-match retention ({retentionReviewedDays} days). Operator default, not legal advice.</small>
        </span>
        <select
          value={jurisdictionPreset}
          disabled={busy}
          onChange={(event) => setJurisdictionPreset(event.currentTarget.value)}
          aria-label="Jurisdiction preset"
        >
          {JURISDICTION_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {report ? (
        <>
          <div className="workspace-health-grid">
            <span><small>Saved faces</small><strong>{formatNumber(report.references)}</strong></span>
            <span><small>Matches</small><strong>{formatNumber(report.candidates)}</strong></span>
            <span><small>Generated files</small><strong>{formatNumber(report.generatedFiles)}</strong></span>
            <span><small>Generated size</small><strong>{formatBytes(report.generatedBytes)}</strong></span>
          </div>
          <div className="health-list">
            {report.recommendations.slice(0, 2).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          <small className="compact">Privacy report {formatDateTime(report.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">See exactly how much local face data, generated preview data, cached matching data, and audit history is in this app folder.</p>
      )}
      {retentionPolicy && (
        <>
          <div className="workspace-health-grid">
            <span><small>Reviewed</small><strong>{formatNumber(retentionPolicy.counts.reviewedCandidates)}</strong></span>
            <span><small>90+ days</small><strong>{formatNumber(retentionPolicy.reviewedOlderThanDays["90"] ?? 0)}</strong></span>
            <span><small>Oldest</small><strong>{formatNumber(retentionPolicy.oldestReviewedAgeDays)}d</strong></span>
            <span><small>Generated size</small><strong>{formatBytes(retentionPolicy.counts.generatedBytes)}</strong></span>
          </div>
          <div className="health-list">
            {retentionPolicy.recommendations.slice(0, 2).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
          </div>
          <small className="compact">Retention report {formatDateTime(retentionPolicy.generatedAt)}</small>
        </>
      )}
      <div className="button-row">
        <button className="secondary" onClick={loadPrivacyReport} disabled={busy}>
          <Activity size={17} />
          <span>Check privacy data</span>
        </button>
        <button className="secondary" onClick={loadRetentionPolicyReport} disabled={busy}>
          <Timer size={17} />
          <span>Check retention</span>
        </button>
        <button className="secondary" onClick={exportConsentReceipt} disabled={busy}>
          <FileText size={17} />
          <span>Consent receipt</span>
        </button>
        <button className="secondary" onClick={exportSafeModeAudit} disabled={busy}>
          <ShieldCheck size={17} />
          <span>Safe Mode audit</span>
        </button>
        <button className="secondary" onClick={exportCompliancePack} disabled={busy}>
          <FileText size={17} />
          <span>Compliance pack</span>
        </button>
        <button className="secondary" onClick={exportExaminationReport} disabled={busy}>
          <FileText size={17} />
          <span>Examination report</span>
        </button>
        <button className="secondary danger" onClick={() => deleteFaceData(false)} disabled={busy}>
          <Trash2 size={17} />
          <span>Delete face data</span>
        </button>
        <button className="secondary danger" onClick={() => deleteFaceData(true)} disabled={busy}>
          <Trash2 size={17} />
          <span>Delete face data and history</span>
        </button>
      </div>
    </div>
  );
}

function RuntimeSelfTestPanel({ result }: { result: RuntimeSelfTestResult | null }) {
  if (!result) {
    return (
      <div className="panel settings-panel runtime-test-panel">
        <div className="panel-title"><Activity size={18} /> System check</div>
        <p className="compact">Run a check to verify saving files, reading photos and videos, acceleration, Safe Mode, and app-folder health.</p>
      </div>
    );
  }
  return (
    <div className={result.ok ? "panel settings-panel runtime-test-panel ok" : "panel settings-panel runtime-test-panel warn"}>
      <div className="panel-title">
        <Activity size={18} /> System check
        <div className="spacer" />
        <span className={result.ok ? "status accepted" : "status uncertain"}>{result.ok ? "passed" : "review"}</span>
      </div>
      <div className="self-test-list">
        {result.checks.map((check) => (
          <span key={check.name} className={check.ok ? "pass" : "fail"}>
            {check.ok ? <Check size={16} /> : <AlertCircle size={16} />}
            <strong>{check.name}</strong>
            <small>{check.detail}</small>
          </span>
        ))}
      </div>
      <div className="health-list">
        {result.recommendations.slice(0, 4).map((item) => <span key={item}>{localizeImperativeText(item)}</span>)}
      </div>
      <small className="compact">Checked {formatDateTime(result.generatedAt)}</small>
    </div>
  );
}

function AuditTrailPanel({
  events,
  busy,
  loadAuditEvents,
  copyText
}: {
  events: AuditEventsResult | null;
  busy: boolean;
  loadAuditEvents(): void;
  copyText(text: string, label?: string): void;
}) {
  const rows = events?.events ?? [];
  function eventLabel(row: Record<string, unknown>) {
    return String(row.action || row.status || "event").replace(/_/g, " ");
  }
  function eventDetail(row: Record<string, unknown>) {
    const person = row.person_name || row.new_person_name || row.old_person_name;
    const count = row.count ?? row.references ?? row.candidates ?? "";
    const source = row.source || row.status || "";
    return [person, count ? `${count}` : "", source].filter(Boolean).join(" • ") || "Activity event";
  }
  return (
    <div className="panel settings-panel audit-panel">
      <div className="panel-title">
        <Archive size={18} /> Activity history
        <div className="spacer" />
        {events && <span className="title-count">{events.total}</span>}
      </div>
      {rows.length ? (
        <div className="audit-list">
          {rows.slice(0, 12).map((row, index) => (
            <span key={`${String(row.at)}-${index}`}>
              <small>{formatDateTime(String(row.at || ""))}</small>
              <strong>{eventLabel(row)}</strong>
              <em>{eventDetail(row)}</em>
            </span>
          ))}
        </div>
      ) : (
        <p className="compact">Load recent activity to inspect permission changes, scans, reviews, exports, cleanup, and agent actions.</p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={loadAuditEvents} disabled={busy}>
          <RefreshCcw size={17} />
          <span>Load history</span>
        </button>
        <button
          className="secondary"
          onClick={() => copyText(JSON.stringify(rows, null, 2), "Activity history")}
          disabled={!rows.length}
        >
          <Archive size={17} />
          <span>Copy events</span>
        </button>
      </div>
    </div>
  );
}

function PerformanceCenter({
  state,
  mode,
  effectiveMode,
  setMode,
  profile,
  latencySamples,
  latencySummary,
  scanProgress,
  busy,
  warmPreviewsNow,
  copyPerformanceReport,
  clearLatencySamples
}: {
  state: AppState;
  mode: PerformanceChoice;
  effectiveMode: PerformanceMode;
  setMode(value: PerformanceChoice): void;
  profile: PerformanceProfile;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  scanProgress: ScanProgress | null;
  busy: boolean;
  warmPreviewsNow(): void;
  copyPerformanceReport(): void;
  clearLatencySamples(): void;
}) {
  const recent = latencySamples.slice(0, 5);
  const budgetLabel = formatDuration(profile.slowCommandMs);
  const platform = state.platform;
  const autoMode = resolvePerformanceMode("auto", platform);
  const totals = state.scanTotals;
  const throughput = totals.durationMs > 0 ? (totals.processed / Math.max(1, totals.durationMs / 1000)) : 0;
  const activeThroughput = scanProgress?.elapsedMs && scanProgress.processed
    ? Number(scanProgress.processed) / Math.max(1, Number(scanProgress.elapsedMs) / 1000)
    : 0;
  const traceSamples = latencySamples.slice(0, 12);
  const bottlenecks = [
    latencySummary.p95 > profile.slowCommandMs ? `Command p95 is over budget by ${formatDuration(latencySummary.p95 - profile.slowCommandMs)}.` : "",
    platform.primary_provider === "CPUExecutionProvider" ? "CPU-only recognition path is active; expect slower scans on large folders." : "",
    state.videoDecoder && !state.videoDecoder.ffmpegAvailable && (totals.videoFiles ?? 0) > 0 ? "Video files were scanned without FFmpeg; install or bundle the managed decoder for broader codec coverage." : "",
    throughput > 0 && throughput < 0.4 ? "Historical scan throughput is below 0.4 files/sec; disk, decoder, or model acceleration may be limiting." : "",
    scanProgress?.memoryPressure && !["normal", ""].includes(String(scanProgress.memoryPressure)) ? scanProgress.memoryMessage || `Memory pressure is ${scanProgress.memoryPressure}.` : ""
  ].filter(Boolean);
  const effectiveScanDetail = [
    `${state.config.effectiveFaceDetectorSize ?? state.config.faceDetectorSize}px detector`,
    (state.config.effectiveTwoPassScan ?? state.config.twoPassScan) ? "two-pass recheck" : "one-pass scan"
  ].join(" • ");
  const choices = performanceChoiceOrder.map((key) => {
    if (key === "auto") {
      return {
        key,
        label: "Auto",
        detail: `Uses ${performanceProfiles[autoMode].label} for this PC.`,
        small: `${performanceTierLabel(platform.performance_tier)} hardware • switches with app folder state`
      };
    }
    const item = performanceProfiles[key];
    return {
      key,
      label: item.label,
      detail: item.detail,
      small: `${item.showListThumbnails ? "Thumbnails on" : "Thumbnails off"} • ${item.reviewBatchSize} rows`
    };
  });
  return (
    <div className="panel settings-panel performance-center">
      <div className="panel-title"><Gauge size={18} /> Performance center</div>
      <div className="performance-mode-grid" role="group" aria-label="Performance modes">
        {choices.map((item) => {
          return (
            <button
              key={item.key}
              className={mode === item.key ? "performance-mode selected" : "performance-mode"}
              onClick={() => setMode(item.key)}
              type="button"
            >
              <strong>{item.label}{item.key === "auto" && mode === "auto" ? `: ${performanceProfiles[effectiveMode].label}` : ""}</strong>
              <span>{item.detail}</span>
              <small>{item.small}</small>
              {mode === item.key ? <Check size={16} /> : <ChevronRight size={16} />}
            </button>
          );
        })}
      </div>
      <div className="performance-hardware" aria-label="Detected performance profile">
        <span>
          <small>Hardware profile</small>
          <strong>{performanceTierLabel(platform.performance_tier)}</strong>
        </span>
        <span>
          <small>CPU</small>
          <strong>{platform.cpu_logical_count ? `${platform.cpu_logical_count} cores` : "Unknown"}</strong>
        </span>
        <span>
          <small>Memory</small>
          <strong>{platform.memory_total_bytes ? formatBytes(platform.memory_total_bytes) : "Unknown"}</strong>
        </span>
        <span>
          <small>Effective scan</small>
          <strong>{effectiveScanDetail}</strong>
        </span>
      </div>
      {platform.performance_notes?.length ? (
        <div className="performance-notes">
          {platform.performance_notes.slice(0, 3).map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}
      <div className="performance-stats">
        <span>
          <small>p50</small>
          <strong>{latencySummary.count ? formatDuration(latencySummary.p50) : "0s"}</strong>
        </span>
        <span>
          <small>p95</small>
          <strong>{latencySummary.count ? formatDuration(latencySummary.p95) : "0s"}</strong>
        </span>
        <span>
          <small>p99</small>
          <strong>{latencySummary.count ? formatDuration(latencySummary.p99) : "0s"}</strong>
        </span>
        <span>
          <small>Budget</small>
          <strong>{budgetLabel}</strong>
        </span>
      </div>
      <div className="latency-list">
        {recent.length ? recent.map((sample) => (
          <span key={`${sample.at}-${sample.command}-${sample.durationMs}`} className={sample.durationMs > sample.budgetMs ? "slow" : ""}>
            <strong>{sample.label}</strong>
            <small>{formatDuration(sample.durationMs)} • {sample.command}</small>
          </span>
        )) : <span><strong>No samples yet</strong><small>Use the app to collect command timings.</small></span>}
      </div>
      <div className="button-row">
        <button className="secondary" onClick={warmPreviewsNow} disabled={busy}>
          <ImageIcon size={17} />
          <span>Warm previews</span>
        </button>
        <button className="secondary" onClick={copyPerformanceReport} disabled={!latencySamples.length}>
          <Archive size={17} />
          <span>Copy report</span>
        </button>
        <button className="secondary" onClick={clearLatencySamples} disabled={!latencySamples.length}>
          <Trash2 size={17} />
          <span>Clear samples</span>
        </button>
      </div>
      <details className="performance-trace-viewer">
        <summary>Performance trace</summary>
        <div className="trace-metrics-grid">
          <span>
            <small>Provider</small>
            <strong>{platform.primary_provider || "Unknown"}</strong>
          </span>
          <span>
            <small>Vector search</small>
            <strong>{state.vectorStore || platform.vector_backend || "Unknown"}</strong>
          </span>
          <span>
            <small>Decoder</small>
            <strong>{state.videoDecoder?.backend || "Images only"}</strong>
          </span>
          <span>
            <small>Scan throughput</small>
            <strong>{throughput ? `${throughput.toFixed(2)} files/s` : "No run yet"}</strong>
          </span>
          <span>
            <small>Active throughput</small>
            <strong>{activeThroughput ? `${activeThroughput.toFixed(2)} files/s` : "Idle"}</strong>
          </span>
          <span>
            <small>Active ETA</small>
            <strong>{scanProgress?.etaMs ? formatDuration(Math.round(scanProgress.etaMs)) : "None"}</strong>
          </span>
          <span>
            <small>Workspace DB</small>
            <strong>{state.scale?.dbBytes ? formatBytes(state.scale.dbBytes) : "Unknown"}</strong>
          </span>
          <span>
            <small>Manifest files</small>
            <strong>{formatNumber(state.scale?.manifestFiles ?? 0)}</strong>
          </span>
        </div>
        <div className={bottlenecks.length ? "trace-bottlenecks" : "trace-bottlenecks ok"}>
          {bottlenecks.length ? bottlenecks.map((item) => <span key={item}>{item}</span>) : <span>No current bottleneck detected from collected samples.</span>}
        </div>
        <div className="trace-table" role="table" aria-label="Recent command timings">
          <span className="trace-head">Action</span>
          <span className="trace-head">Command</span>
          <span className="trace-head">Time</span>
          <span className="trace-head">Budget</span>
          {traceSamples.length ? traceSamples.map((sample) => (
            <span className={sample.durationMs > sample.budgetMs ? "trace-row slow" : "trace-row"} key={`${sample.at}-${sample.command}-${sample.durationMs}`}>
              <strong>{sample.label}</strong>
              <small>{sample.command}</small>
              <em>{formatDuration(sample.durationMs)}</em>
              <em>{formatDuration(sample.budgetMs)}</em>
            </span>
          )) : <span className="trace-empty">Use the app to collect trace samples.</span>}
        </div>
      </details>
      <p className="compact">
        {latencySummary.slowCount
          ? `${latencySummary.slowCount} command sample${latencySummary.slowCount === 1 ? "" : "s"} crossed the ${budgetLabel} budget.`
          : `No sampled commands are over the ${budgetLabel} budget.`}
      </p>
    </div>
  );
}

function CandidateTable(props: {
  candidates: ReviewCandidate[];
  selectedId?: string | null;
  compact?: boolean;
  batchSize: number;
  showThumbnails: boolean;
  onSelect(id: string): void;
}) {
  const [visibleLimit, setVisibleLimit] = useState(props.batchSize);
  const visibleCandidates = useMemo(
    () => props.candidates.slice(0, visibleLimit),
    [props.candidates, visibleLimit]
  );
  useEffect(() => {
    setVisibleLimit(props.batchSize);
  }, [props.batchSize, props.candidates]);

  return (
    <div className={props.compact ? "panel table-panel compact-table" : "panel table-panel"}>
      <div className="panel-title"><ShieldCheck size={18} /> Possible matches <span className="title-count">{props.candidates.length}</span></div>
      <div className="table">
        {props.candidates.length === 0 ? <EmptyState icon={ShieldCheck} label="No possible matches yet" detail="Scan a folder, video, or camera photo to fill this list." /> : (
          <>
            <TableHeader columns={["Possible match", "Status", "Strength", "Source"]} kind="candidate" />
            {visibleCandidates.map((candidate) => (
              <button
                key={candidate.candidateId}
                className={props.selectedId === candidate.candidateId ? "row candidate-row selected" : "row candidate-row"}
                onClick={() => props.onSelect(candidate.candidateId)}
              >
                <CandidateIdentity candidate={candidate} showThumbnail={props.showThumbnails} />
                <span className={`status ${candidate.status}`}>{reviewStatusLabel(candidate.status)}</span>
                <span aria-label={`score ${scoreLabel(candidate.score)}`}>{scoreLabel(candidate.score)}</span>
                <span title={candidateSourceTitle(candidate)}>{candidateSourceLabel(candidate)}</span>
                <ChevronRight size={16} />
              </button>
            ))}
            {visibleCandidates.length < props.candidates.length && (
              <button
                className="row load-more-row"
                onClick={() => setVisibleLimit((value) => value + props.batchSize)}
                type="button"
              >
                <span>Showing {visibleCandidates.length} of {props.candidates.length}</span>
                <span />
                <span />
                <span>Load more</span>
                <ChevronRight size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CandidateIdentity({ candidate, showThumbnail = true }: { candidate: ReviewCandidate; showThumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [candidate.sourceUrl]);
  const video = isVideoCandidate(candidate);
  const riskLabels = candidateRiskLabels(candidate);
  const detail = [
    video ? `video ${formatMediaTimestamp(candidate.videoTimestampMs)}` : "",
    ...riskLabels
  ].filter(Boolean).join(" • ");
  return (
    <span className="candidate-identity">
      <span className="thumb">
        {showThumbnail && candidate.sourceUrl && !failed ? <img loading="lazy" decoding="async" width={44} height={44} src={candidate.sourceUrl} alt="" onError={() => setFailed(true)} /> : video ? <Video size={18} /> : <ImageIcon size={18} />}
      </span>
      <span>
        <strong>{candidate.personName}</strong>
        <small>{detail ? `${matchBandLabel(candidate.band)} • ${detail}` : matchBandLabel(candidate.band)}</small>
      </span>
    </span>
  );
}

function TableHeader({ columns, kind }: { columns: string[]; kind: "candidate" | "reference" }) {
  return (
    <div className={`table-header ${kind}-header`} aria-hidden="true">
      {columns.map((column) => <span key={column}>{column}</span>)}
      <span />
    </div>
  );
}

function ImagePreview({ label, url, fallback, concealed = false }: { label: string; url?: string; fallback?: string | null; concealed?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return (
    <div className="image-preview">
      <div className={concealed ? "image-frame concealed-frame" : "image-frame"}>
        {concealed ? (
          <div className="privacy-preview">
            <ShieldCheck size={34} />
            <strong>Preview hidden</strong>
            <span>Use Show previews when the screen is private.</span>
          </div>
        ) : url && !failed ? (
          <img loading="lazy" decoding="async" src={url} alt={label} onError={() => setFailed(true)} />
        ) : (
          <ImageIcon size={44} />
        )}
      </div>
      <strong>{label}</strong>
      <span title={fallback ?? ""}>{fallback ? basename(fallback) : "None"}</span>
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange(value: number): void }) {
  return (
    <label className="slider-row">{label}
      <div>
        <input aria-label={`${label} slider`} type="range" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
        <input aria-label={`${label} value`} type="number" min={0} max={1} step={0.01} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      </div>
    </label>
  );
}

function EmptyState({ icon: Icon = ImageIcon, label, detail }: { icon?: typeof Gauge; label: string; detail?: string }) {
  return (
    <div className="empty">
      <Icon size={24} />
      <strong>{label}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

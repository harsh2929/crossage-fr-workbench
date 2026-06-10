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
  ChevronRight,
  Crosshair,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Focus,
  Gauge,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  Save,
  Search,
  ScanLine,
  ScanFace,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  Trash2,
  Undo2,
  UserPlus,
  Users,
  Video,
  X
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  AgeBucket,
  AgeReferenceGroup,
  AppState,
  AuditEventsResult,
  CameraSaveResult,
  CandidateStatus,
  CommandResult,
  ExportReportValue,
  AppCommand,
  ExternalOpenPayload,
  FolderAnalysis,
  FolderWatchStatus,
  ModelDownloadProgress,
  ReviewCandidate,
  RuntimeSelfTestResult,
  ScanProgress,
  SystemIntegration,
  Thresholds,
  WorkspaceBackupValue,
  WorkspaceHealth
} from "./types";

type TabKey = "dashboard" | "enroll" | "scan" | "review" | "settings";

const tabs: Array<{ key: TabKey; label: string; icon: typeof Gauge }> = [
  { key: "dashboard", label: "Home", icon: Gauge },
  { key: "enroll", label: "People", icon: UserPlus },
  { key: "scan", label: "Scan", icon: Search },
  { key: "review", label: "Matches", icon: ShieldCheck },
  { key: "settings", label: "Settings", icon: Settings }
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

type SettingsDraft = {
  thresholds: Thresholds;
  clusterMinSize: number;
  safeMode: boolean;
  safeModeThreshold: number;
  mode: SettingsMode;
};

type SettingsValues = Omit<SettingsDraft, "mode">;
type SettingsMode = "recommended" | "privacy" | "precision" | "discovery" | "custom";
type PresetMode = Exclude<SettingsMode, "custom">;

type SettingsPreset = {
  key: PresetMode;
  label: string;
  detail: string;
  bestFor: string;
  values: SettingsValues;
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
      safeMode: true,
      safeModeThreshold: 0.58
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
      safeMode: true,
      safeModeThreshold: 0.45
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
      safeMode: true,
      safeModeThreshold: 0.58
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
      safeMode: true,
      safeModeThreshold: 0.62
    }
  }
];

type AgeFolderMap = Record<AgeBucket, string>;

function emptyAgeFolders(): AgeFolderMap {
  return { child: "", adolescent: "", adult: "", unknown: "" };
}

const initialWatchStatus: FolderWatchStatus = { active: false, folder: null, queued: 0, scanning: false, message: "Not watching." };
const onboardingStorageKey = "crossage-fr-workbench:onboarding:v1";

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
  const paint = () => {
    if (!context) return;
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
  stream.getTracks().forEach((track) => {
    track.addEventListener("ended", () => window.cancelAnimationFrame(raf), { once: true });
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

function settingsValuesEqual(left: SettingsValues, right: SettingsValues) {
  return (
    sameSettingValue(left.thresholds.confident, right.thresholds.confident) &&
    sameSettingValue(left.thresholds.likely, right.thresholds.likely) &&
    sameSettingValue(left.thresholds.relaxedChild, right.thresholds.relaxedChild) &&
    sameSettingValue(left.thresholds.qualityMin, right.thresholds.qualityMin) &&
    left.clusterMinSize === right.clusterMinSize &&
    left.safeMode === right.safeMode &&
    sameSettingValue(left.safeModeThreshold, right.safeModeThreshold)
  );
}

function inferSettingsMode(values: SettingsValues): SettingsMode {
  return settingsPresets.find((preset) => settingsValuesEqual(values, preset.values))?.key ?? "custom";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function formatRate(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatDuration(ms: number) {
  if (!ms) return "0s";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
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
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "No scans yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
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
  return state.platform.selected_providers.map(formatProvider).join(", ");
}

function platformLabel(state: AppState) {
  const platform = state.platform.platform_key.replace(/_/g, " ");
  return `${platform} (${state.platform.system} ${state.platform.machine})`;
}

function engineLabel(value: string) {
  if (value.startsWith("local-image-fingerprint")) return "Local image fingerprint";
  return value.replace(/^insightface-/, "InsightFace ");
}

function firstPendingCandidate(state: AppState | null) {
  return state?.candidates.find((candidate) => candidate.status === "pending") ?? state?.candidates[0] ?? null;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("dashboard");
  const [busy, setBusy] = useState<string | null>("Starting local engine");
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootStartedAt, setBootStartedAt] = useState(() => Date.now());
  const [bootClock, setBootClock] = useState(() => Date.now());
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedRefId, setSelectedRefId] = useState<string | null>(null);
  const [personName, setPersonName] = useState("");
  const [ageBucket, setAgeBucket] = useState<AgeBucket>("unknown");
  const [enrollFolder, setEnrollFolder] = useState("");
  const [ageGroupFolders, setAgeGroupFolders] = useState<AgeFolderMap>(() => emptyAgeFolders());
  const [scanFolder, setScanFolder] = useState("");
  const [settings, setSettings] = useState<SettingsDraft | null>(null);
  const [systemIntegration, setSystemIntegration] = useState<SystemIntegration | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [folderAnalysis, setFolderAnalysis] = useState<FolderAnalysis | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceHealth | null>(null);
  const [auditEvents, setAuditEvents] = useState<AuditEventsResult | null>(null);
  const [runtimeSelfTest, setRuntimeSelfTest] = useState<RuntimeSelfTestResult | null>(null);
  const [watchStatus, setWatchStatus] = useState<FolderWatchStatus>(initialWatchStatus);
  const [latencySamples, setLatencySamples] = useState<LatencySample[]>([]);
  const [performanceMode, setPerformanceMode] = useState<PerformanceMode>("balanced");
  const [consentPrompt, setConsentPrompt] = useState<ConsentPrompt | null>(null);
  const [reviewUndo, setReviewUndo] = useState<ReviewUndo | null>(null);
  const [pendingExternalIntent, setPendingExternalIntent] = useState<PendingExternalIntent | null>(null);
  const [lastPreflight, setLastPreflight] = useState<{ folder: string; at: number; ready: boolean } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [checkedOnboarding, setCheckedOnboarding] = useState(false);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const watchStatusRef = useRef<FolderWatchStatus>(initialWatchStatus);
  const startupRequestId = useRef(0);
  const stateReadyRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const performanceProfile = performanceProfiles[performanceMode];
  const latencySummary = useMemo(() => summarizeLatency(latencySamples), [latencySamples]);

  useEffect(() => {
    if (workspaceRef.current) {
      workspaceRef.current.scrollTop = 0;
    }
  }, [activeTab]);

  useEffect(() => {
    const unsubscribeBackend = window.crossAge.onBackendError((message) => {
      setBootError(message);
      setNotice({ tone: "error", text: message });
      setBusy(null);
    });
    const unsubscribeStartup = window.crossAge.onBackendStartup((event) => {
      if (!stateReadyRef.current) {
        setBusy(event.message || `Starting ${event.phase}`);
      }
    });
    const unsubscribeProgress = window.crossAge.onScanProgress((event) => {
      if (event.name === "model_download") {
        setModelDownloadProgress(event.payload);
        return;
      }
      setScanProgress(event.payload);
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
    loadInitialState();
    return () => {
      unsubscribeBackend();
      unsubscribeStartup();
      unsubscribeProgress();
      unsubscribeWatch();
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
    try {
      const next = await window.crossAge.getInitialState();
      if (requestId !== startupRequestId.current) return;
      recordLatency("Startup", "initial_state", startedAt);
      applyState(next);
      setNotice({ tone: "ok", text: "Backend ready." });
      if (performanceProfile.previewWarmupLimit > 0) {
        window.setTimeout(() => warmPreviewCache(), 240);
      }
    } catch (error) {
      if (requestId !== startupRequestId.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setBootError(message);
      setNotice({ tone: "error", text: message });
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
      budgetMs: performanceProfile.slowCommandMs
    };
    setLatencySamples((current) => [sample, ...current].slice(0, 40));
  }

  async function warmPreviewCache(limit = performanceProfile.previewWarmupLimit, userVisible = false) {
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
    } catch {
      if (userVisible) {
        setNotice({ tone: "error", text: "Preview warmup failed." });
      }
    }
  }

  function copyPerformanceReport() {
    const samples = latencySamples.slice(0, 12);
    copyText([
      "CrossAge FR performance report",
      `Mode: ${performanceProfile.label}`,
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

  function applyWatchStatus(next: FolderWatchStatus | ((current: FolderWatchStatus) => FolderWatchStatus)) {
    setWatchStatus((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      watchStatusRef.current = resolved;
      return resolved;
    });
  }

  function applyState(next: AppState) {
    stateReadyRef.current = true;
    setState(next);
    const nextSettings: SettingsValues = {
      thresholds: next.config.thresholds,
      clusterMinSize: next.config.clusterMinSize,
      safeMode: next.config.safeMode,
      safeModeThreshold: next.config.safeModeThreshold
    };
    if (!settingsDirtyRef.current) {
      setSettings({ ...nextSettings, mode: inferSettingsMode(nextSettings) });
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

  async function invoke<T = unknown>(label: string, command: string, params: Record<string, unknown> = {}) {
    const startedAt = performance.now();
    setBusy(label);
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
      setNotice({ tone: "error", text: message });
      throw error;
    } finally {
      recordLatency(label, command, startedAt);
      setBusy(null);
    }
  }

  async function chooseWorkspace() {
    const folder = await window.crossAge.chooseFolder();
    if (!folder) return;
    await window.crossAge.stopFolderWatch();
    settingsDirtyRef.current = false;
    await invoke<AppState>("Opening app folder", "set_workspace", { path: folder });
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
      setNotice({ tone: "ok", text: `Face model ready${result.value && typeof result.value === "object" && "label" in result.value ? `: ${String(result.value.label)}` : "."}` });
    } catch {
      setModelDownloadProgress((current) => current ? { ...current, phase: "error", message: "Download failed. Check the connection and try again." } : null);
    }
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
    if (state?.consentOnFile && !window.confirm("Remove permission for this app folder? Adding people, matching scans, and folder watching will pause.")) {
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
    const skipped = result.errors?.length ? ` ${result.errors.length} skipped.` : "";
    setNotice({ tone: "ok", text: `Added ${result.added ?? 0} saved face photo${(result.added ?? 0) === 1 ? "" : "s"}.${skipped}` });
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
    const skipped = result.errors?.length ? ` ${result.errors.length} skipped.` : "";
    const groupCount = result.value?.groups ?? groups.length;
    setNotice({ tone: "ok", text: `Added ${result.added ?? 0} saved face photo${(result.added ?? 0) === 1 ? "" : "s"} across ${groupCount} age folder${groupCount === 1 ? "" : "s"}.${skipped}` });
  }

  async function scan() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Scan folder is required." });
      return;
    }
    const preflightMatches = lastPreflight?.folder === scanFolder.trim();
    const preflightIsFresh = preflightMatches && Date.now() - lastPreflight.at < 10 * 60 * 1000;
    if (!preflightIsFresh) {
      const proceed = window.confirm("This folder has not been checked recently. Continue scanning now?");
      if (!proceed) {
        setNotice({ tone: "warn", text: "Check the folder before scanning." });
        return;
      }
    } else if (!lastPreflight.ready) {
      const proceed = window.confirm("The folder check found issues. Continue and skip files that cannot be read?");
      if (!proceed) {
        setNotice({ tone: "warn", text: "Review the folder issues before scanning." });
        return;
      }
    }
    const result = await invoke<CommandResult>("Scanning folder", "scan", { folder: scanFolder, source: "manual" });
    const skipped = result.errors?.length ? ` ${result.errors.length} skipped.` : "";
    const protectedText = result.metrics?.safeFiltered ? ` Safe Mode protected ${result.metrics.safeFiltered} file(s).` : "";
    setNotice({ tone: "ok", text: `Found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"}.${skipped}${protectedText}` });
  }

  async function scanCameraFrame(dataUrl: string): Promise<CameraScanResult> {
    const startedAt = performance.now();
    setBusy("Saving camera photo");
    setNotice(null);
    let saved: CameraSaveResult;
    try {
      saved = await window.crossAge.saveCameraFrame(dataUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNotice({ tone: "error", text: message });
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
      setNotice({ tone: "ok", text: `Camera photo saved. ${nextStep}` });
      return { ...saved, added: 0, errors: [], matched: false };
    }

    setBusy(null);
    const result = await invoke<CommandResult>("Scanning camera photo", "scan", { folder: saved.folder, source: "camera" });
    const skipped = result.errors?.length ? ` ${result.errors.length} skipped.` : "";
    const protectedText = result.metrics?.safeFiltered ? ` Safe Mode protected ${result.metrics.safeFiltered} file(s).` : "";
    setNotice({ tone: "ok", text: `Camera photo saved. Found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"}.${skipped}${protectedText}` });
    return { ...saved, added: result.added ?? 0, errors: result.errors ?? [], matched: true };
  }

  async function analyzeScanFolder() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Scan folder is required." });
      return;
    }
    const analysis = await invoke<FolderAnalysis>("Checking folder", "analyze_folder", { folder: scanFolder });
    setFolderAnalysis(analysis);
    const mediaCount = analysis.imageCount + analysis.videoCount;
    const sampledIssues = analysis.unreadableSamples.length + analysis.unreadableVideoSamples.length;
    setLastPreflight({
      folder: scanFolder.trim(),
      at: Date.now(),
      ready: analysis.exists && analysis.isDirectory && mediaCount > 0 && sampledIssues === 0
    });
    const unreadable = sampledIssues ? ` ${sampledIssues} sampled issue(s).` : "";
    setNotice({ tone: mediaCount ? "ok" : "warn", text: `Folder check found ${mediaCount} photo or video file${mediaCount === 1 ? "" : "s"}: ${analysis.imageCount} image${analysis.imageCount === 1 ? "" : "s"}, ${analysis.videoCount} video${analysis.videoCount === 1 ? "" : "s"}.${unreadable}` });
  }

  async function startWatchFolder() {
    if (!scanFolder.trim()) {
      setNotice({ tone: "warn", text: "Choose a scan folder before watching." });
      return;
    }
    if (!state?.references.length) {
      setNotice({ tone: "warn", text: "Add at least one person before watching a folder." });
      return;
    }
    const status = await window.crossAge.startFolderWatch(scanFolder);
    applyWatchStatus(status);
    setNotice({ tone: "ok", text: "CrossAge will watch this folder for new files." });
  }

  async function startWatchForFolder(folder: string) {
    if (!state?.consentOnFile || !state.references.length) {
      setScanFolder(folder);
      setActiveTab("scan");
      setNotice({ tone: "warn", text: "Add a person and confirm permission before watching this folder." });
      return;
    }
    setScanFolder(folder);
    setActiveTab("scan");
    const status = await window.crossAge.startFolderWatch(folder);
    applyWatchStatus(status);
    setNotice({ tone: "ok", text: "CrossAge will watch this folder for new files." });
  }

  async function stopWatchFolder() {
    const status = await window.crossAge.stopFolderWatch();
    applyWatchStatus(status);
    setNotice({ tone: "ok", text: "Folder watching stopped." });
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
    const next = await window.crossAge.setLaunchAtLogin(value);
    setSystemIntegration(next);
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
      await window.crossAge.stopFolderWatch();
      settingsDirtyRef.current = false;
      await invoke<AppState>("Opening app folder", "set_workspace", { path: payload.path });
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
      const result = await invoke<CommandResult>("Scanning opened files", "scan_paths", { paths: payload.paths, source: "system" });
      const protectedText = result.metrics?.safeFiltered ? ` Safe Mode protected ${result.metrics.safeFiltered} file(s).` : "";
      setNotice({ tone: "ok", text: `Found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"}.${protectedText}` });
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
    const result = await invoke<CommandResult>("Scanning received files", "scan_paths", { paths: payload.paths, source: "system" });
    const protectedText = result.metrics?.safeFiltered ? ` Safe Mode protected ${result.metrics.safeFiltered} file(s).` : "";
    setNotice({ tone: "ok", text: `Found ${result.added ?? 0} possible match${(result.added ?? 0) === 1 ? "" : "es"} from received files.${protectedText}` });
  }

  async function review(status: CandidateStatus) {
    if (!selectedCandidateId) return;
    const current = selectedCandidate;
    await invoke<AppState>("Saving review", "set_status", { candidateId: selectedCandidateId, status });
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
    setNotice({ tone: "ok", text: `Updated ${result.updated ?? candidateIds.length} possible match${(result.updated ?? candidateIds.length) === 1 ? "" : "es"}.` });
  }

  async function exportSelectedCandidates(candidateIds: string[]) {
    if (!candidateIds.length) {
      setNotice({ tone: "warn", text: "Select possible matches before exporting." });
      return;
    }
    const result = await invoke<CommandResult<ExportReportValue>>("Exporting selected matches", "export_candidates", { candidateIds });
    const exported = result.value?.counts.candidates ?? candidateIds.length;
    setNotice({ tone: "ok", text: `Exported ${exported} selected possible match${exported === 1 ? "" : "es"}.` });
    if (result.value?.jsonPath) {
      await window.crossAge.revealPath(result.value.jsonPath);
    }
  }

  async function saveCandidateNote(candidateId: string, note: string) {
    await invoke<AppState>("Saving note", "set_candidate_note", { candidateId, note });
    setNotice({ tone: "ok", text: "Review note saved." });
  }

  async function deleteReference() {
    if (!selectedRefId) return;
    const selected = state?.references.find((ref) => ref.refId === selectedRefId);
    if (!window.confirm(`Delete this saved photo for ${selected?.personName ?? ""}?`)) return;
    await invoke<AppState>("Deleting saved photo", "delete_reference", { refId: selectedRefId });
  }

  async function clearQueue() {
    if (!state?.candidates.length) return;
    if (!window.confirm("Clear all possible matches from the review list?")) return;
    await invoke<AppState>("Clearing matches", "clear_queue");
  }

  async function clearReferences() {
    if (!state?.references.length) return;
    if (!window.confirm("Clear all saved face photos? Activity history is preserved.")) return;
    const result = await invoke<CommandResult>("Clearing saved photos", "clear_references");
    setNotice({ tone: "ok", text: `Cleared ${result.cleared ?? 0} saved face photo${(result.cleared ?? 0) === 1 ? "" : "s"}.` });
  }

  async function deletePerson(personName: string) {
    if (!personName.trim()) {
      setNotice({ tone: "warn", text: "Choose a person to delete." });
      return;
    }
    if (!window.confirm(`Delete saved photos and possible matches for ${personName}? Activity history is preserved.`)) return;
    const result = await invoke<CommandResult>("Deleting person", "delete_person", { personName });
    const deleted = result.deleted ?? { references: 0, candidates: 0 };
    setNotice({ tone: "ok", text: `Deleted ${deleted.references} saved photo${deleted.references === 1 ? "" : "s"} and ${deleted.candidates} possible match${deleted.candidates === 1 ? "" : "es"}.` });
  }

  async function purgeReviewedCandidates() {
    if (!window.confirm("Remove reviewed possible matches from the active list? Activity history is preserved.")) return;
    const result = await invoke<CommandResult>("Removing reviewed matches", "purge_candidates", { statuses: ["accepted", "rejected", "uncertain"] });
    setNotice({ tone: "ok", text: `Removed ${result.purged ?? 0} reviewed possible match${(result.purged ?? 0) === 1 ? "" : "es"}.` });
  }

  async function runWorkspaceHealth() {
    const health = await invoke<WorkspaceHealth>("Checking app folder", "workspace_health");
    setWorkspaceHealth(health);
    setNotice({ tone: "ok", text: "App folder check complete." });
  }

  async function purgeDuplicateCandidates() {
    const duplicateCount = workspaceHealth?.duplicateCandidateCount ?? 0;
    if (!duplicateCount) {
      setNotice({ tone: "warn", text: "No duplicate match rows found." });
      return;
    }
    if (!window.confirm(`Remove ${duplicateCount} duplicate match row(s)? The strongest row in each group will be kept.`)) return;
    const result = await invoke<CommandResult<WorkspaceHealth>>("Removing duplicate matches", "purge_duplicate_candidates");
    if (result.value) setWorkspaceHealth(result.value);
    setNotice({ tone: "ok", text: `Removed ${result.purged ?? 0} duplicate match row${(result.purged ?? 0) === 1 ? "" : "s"}.` });
  }

  async function purgeOldCandidates(days: number) {
    const safeDays = Math.max(1, Math.min(3650, Math.round(days || 90)));
    if (!window.confirm(`Remove reviewed matches older than ${safeDays} day(s)? Activity history is preserved.`)) return;
    const result = await invoke<CommandResult>("Removing old reviewed matches", "purge_old_candidates", {
      days: safeDays,
      statuses: ["accepted", "rejected", "uncertain"]
    });
    setNotice({ tone: "ok", text: `Removed ${result.purged ?? 0} old reviewed possible match${(result.purged ?? 0) === 1 ? "" : "es"}.` });
  }

  async function exportReport() {
    const result = await invoke<CommandResult<ExportReportValue>>("Exporting report", "export_report");
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Export did not return a report path." });
      return;
    }
    setNotice({ tone: "ok", text: `Exported report for ${value.counts.candidates} possible match${value.counts.candidates === 1 ? "" : "es"}.` });
    await window.crossAge.revealPath(value.jsonPath);
  }

  async function exportWorkspaceBackup() {
    const result = await invoke<CommandResult<WorkspaceBackupValue>>("Creating backup", "export_workspace_backup", { includeGenerated: true });
    const value = result.value;
    if (!value) {
      setNotice({ tone: "error", text: "Backup did not return a zip path." });
      return;
    }
    setNotice({ tone: "ok", text: `Backup created: ${basename(value.zipPath)} (${formatBytes(value.bytes)}).` });
    await window.crossAge.revealPath(value.zipPath);
  }

  async function loadAuditEvents() {
    const result = await invoke<AuditEventsResult>("Loading activity history", "audit_events", { limit: 80, offset: 0 });
    setAuditEvents(result);
    setNotice({ tone: "ok", text: `Loaded ${result.events.length} activity event${result.events.length === 1 ? "" : "s"}.` });
  }

  async function runRuntimeSelfTest() {
    const result = await invoke<RuntimeSelfTestResult>("Running system check", "runtime_self_test");
    setRuntimeSelfTest(result);
    setNotice({ tone: result.ok ? "ok" : "warn", text: result.ok ? "System check passed." : "System check found items to review." });
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
    if (!window.confirm(`Rename ${oldName} to ${target}?${mergeText}`)) return;
    const result = await invoke<CommandResult>("Renaming person", "rename_person", { oldName, newName: target });
    const renamed = result.renamed ?? { references: 0, candidates: 0 };
    setNotice({ tone: "ok", text: `Updated ${renamed.references} saved photo${renamed.references === 1 ? "" : "s"} and ${renamed.candidates} possible match${renamed.candidates === 1 ? "" : "es"}.` });
  }

  async function copyText(text: string, label = "Summary") {
    await window.crossAge.writeClipboardText(text);
    setNotice({ tone: "ok", text: `${label} copied.` });
  }

  async function saveSettings() {
    if (!settings) return;
    const wasDirty = settingsDirtyRef.current;
    settingsDirtyRef.current = false;
    try {
      await invoke<AppState>("Saving settings", "save_settings", {
        thresholds: settings.thresholds,
        clusterMinSize: settings.clusterMinSize,
        safeMode: settings.safeMode,
        safeModeThreshold: settings.safeModeThreshold
      });
      setNotice({ tone: "ok", text: "Settings saved." });
    } catch {
      settingsDirtyRef.current = wasDirty;
      return;
    }
  }

  const candidateById = useMemo(
    () => new Map((state?.candidates ?? []).map((candidate) => [candidate.candidateId, candidate] as const)),
    [state?.candidates]
  );
  const selectedCandidate = selectedCandidateId ? candidateById.get(selectedCandidateId) ?? null : null;
  const settingsPeople = useMemo(
    () => [...new Set((state?.references ?? []).map((ref) => ref.personName))].sort((a, b) => a.localeCompare(b)),
    [state?.references]
  );

  const isDemoMode = state?.engine.startsWith("local-image-fingerprint");
  const canProcess = Boolean(state?.consentOnFile) && !busy;
  const enrollDisabled = !canProcess || !personName.trim() || !enrollFolder.trim();
  const ageGroupDisabled = !canProcess || !personName.trim() || !referenceAgeBuckets.some((bucket) => ageGroupFolders[bucket].trim());
  const scanDisabled = !canProcess || !scanFolder.trim() || !state?.references.length;

  useEffect(() => {
    setFolderAnalysis(null);
    setLastPreflight((current) => current?.folder === scanFolder.trim() ? current : null);
  }, [scanFolder]);

  useEffect(() => {
    if (!state) {
      return;
    }
    const unsubscribeCommand = window.crossAge.onAppCommand((command) => {
      handleAppCommand(command).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) }));
    });
    const unsubscribeExternalOpen = window.crossAge.onExternalOpen((payload) => {
      handleExternalOpen(payload).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) }));
    });
    window.crossAge.rendererReady().catch(() => undefined);
    return () => {
      unsubscribeCommand();
      unsubscribeExternalOpen();
    };
  }, [state, scanFolder, scanDisabled, watchStatus.active]);

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
    setConsent(true).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) }));
  }

  function onboardingWorkspace() {
    dismissOnboarding();
    chooseWorkspace().catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) }));
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
        <section className="boot-stage" aria-label="CrossAge FR startup">
          <div className="boot-kicker">
            <span />
            <span />
            <span />
          </div>
          <div className="boot-card" role="status" aria-live="polite">
            <div className="boot-mark">
              <div className="boot-mark-aura" />
              <ImageIcon size={27} />
            </div>
            <div className="boot-copy">
              <strong>CrossAge FR</strong>
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
    { label: "Local", value: isDemoMode ? "Demo" : "Model", tone: isDemoMode ? "amber" : "green" },
    { label: "Safe Mode", value: state.config.safeMode ? "On" : "Off", tone: state.config.safeMode ? "green" : "amber" },
    { label: "To review", value: `${state.counts.pending}`, tone: state.counts.pending ? "amber" : "blue" }
  ] as const;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><ImageIcon size={20} /></div>
          <div>
            <strong>CrossAge FR</strong>
            <span>Photo Review</span>
          </div>
        </div>
        <nav className="nav-list">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.key} className={activeTab === tab.key ? "active" : ""} onClick={() => setActiveTab(tab.key)}>
                <Icon size={18} />
                <span className="nav-label">{tab.label}</span>
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
              <small>App folder</small>
              <span title={state.workspace}>{state.workspace}</span>
              <div className="workspace-meta-strip" aria-label="App folder readiness">
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
              <span>Guide</span>
            </button>
            <button className="ghost" onClick={chooseWorkspace} disabled={Boolean(busy)} title="Choose app folder">
              <FolderOpen size={17} />
              <span>Choose</span>
            </button>
            <button className="ghost" onClick={revealWorkspace} disabled={Boolean(busy)} title="Show app folder">
              <HardDrive size={17} />
              <span>Show</span>
            </button>
            <button className="ghost" onClick={() => invoke<AppState>("Refreshing", "get_state")} disabled={Boolean(busy)} title="Refresh">
              <RefreshCcw size={17} />
              <span>Refresh</span>
            </button>
            <label className={`${state.consentOnFile ? "consent on" : "consent"}${busy ? " disabled" : ""}`}>
              <input type="checkbox" checked={state.consentOnFile} disabled={Boolean(busy)} onChange={(event) => setConsent(event.currentTarget.checked)} />
              <ShieldCheck size={17} />
              <span>Permission</span>
            </label>
          </div>
        </header>

        <div className="status-row">
          {busy ? (
            <div className="notice busy"><Loader2 className="spin" size={16} /> {busy}</div>
          ) : notice ? (
            <div className={`notice ${notice.tone}`}>
              {notice.tone === "error" ? <AlertCircle size={16} /> : <Check size={16} />}
              {notice.text}
            </div>
          ) : (
            <div className="notice neutral">Ready</div>
          )}
          {isDemoMode && <div className="notice warn">Simple image matching active</div>}
        </div>

        {activeTab === "dashboard" && (
          <Dashboard
            state={state}
            scanProgress={scanProgress}
            watchStatus={watchStatus}
            latencySamples={latencySamples}
            latencySummary={latencySummary}
            performanceProfile={performanceProfile}
            navigate={setActiveTab}
            chooseWorkspace={chooseWorkspace}
            requestConsent={() => setConsent(true).catch((error) => setNotice({ tone: "error", text: error instanceof Error ? error.message : String(error) }))}
            chooseModelRoot={chooseModelRoot}
            downloadModel={downloadModel}
            modelDownloadProgress={modelDownloadProgress}
            busy={Boolean(busy)}
          />
        )}
        {activeTab === "enroll" && (
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
        {activeTab === "scan" && (
          <ScanView
            state={state}
            scanFolder={scanFolder}
            setScanFolder={setScanFolder}
            chooseFolder={() => chooseFolder(setScanFolder)}
            scan={scan}
            scanCameraFrame={scanCameraFrame}
            analyzeFolder={analyzeScanFolder}
            folderAnalysis={folderAnalysis}
            startWatchFolder={startWatchFolder}
            stopWatchFolder={stopWatchFolder}
            scanProgress={scanProgress}
            watchStatus={watchStatus}
            clearQueue={clearQueue}
            disabled={scanDisabled}
            busy={Boolean(busy)}
            candidateBatchSize={performanceProfile.candidateBatchSize}
            showListThumbnails={performanceProfile.showListThumbnails}
            pendingExternalIntent={pendingExternalIntent}
            resumePendingExternalIntent={resumePendingExternalIntent}
            clearPendingExternalIntent={() => setPendingExternalIntent(null)}
            copyText={copyText}
            revealPath={revealCandidatePath}
            openPath={openCandidatePath}
            selectCandidate={(id) => {
              setSelectedCandidateId(id);
              setActiveTab("review");
            }}
          />
        )}
        {activeTab === "review" && (
          <ReviewView
            state={state}
            selectedCandidate={selectedCandidate}
            selectedCandidateId={selectedCandidateId}
            setSelectedCandidateId={setSelectedCandidateId}
            review={review}
            bulkReview={bulkReview}
            exportSelectedCandidates={exportSelectedCandidates}
            saveCandidateNote={saveCandidateNote}
            copyText={copyText}
            revealPath={revealCandidatePath}
            openPath={openCandidatePath}
            reviewUndo={reviewUndo}
            undoReview={undoLastReview}
            renderBatchSize={performanceProfile.reviewBatchSize}
            showListThumbnails={performanceProfile.showListThumbnails}
            busy={Boolean(busy)}
          />
        )}
        {activeTab === "settings" && settings && (
          <SettingsView
            state={state}
            settings={settings}
            setSettings={updateSettingsDraft}
            saveSettings={saveSettings}
            busy={Boolean(busy)}
            platformSummary={state.platform.accelerator_status}
            systemIntegration={systemIntegration}
            setLaunchAtLogin={setLaunchAtLogin}
            revealWorkspace={revealWorkspace}
            openWorkspaceFolder={openWorkspaceFolder}
            people={settingsPeople}
            exportReport={exportReport}
            exportWorkspaceBackup={exportWorkspaceBackup}
            copyText={copyText}
            purgeReviewedCandidates={purgeReviewedCandidates}
            purgeOldCandidates={purgeOldCandidates}
            runWorkspaceHealth={runWorkspaceHealth}
            purgeDuplicateCandidates={purgeDuplicateCandidates}
            workspaceHealth={workspaceHealth}
            deletePerson={deletePerson}
            renamePerson={renamePerson}
            auditEvents={auditEvents}
            loadAuditEvents={loadAuditEvents}
            runtimeSelfTest={runtimeSelfTest}
            runRuntimeSelfTest={runRuntimeSelfTest}
            performanceMode={performanceMode}
            setPerformanceMode={setPerformanceMode}
            performanceProfile={performanceProfile}
            latencySamples={latencySamples}
            latencySummary={latencySummary}
            clearLatencySamples={clearLatencySamples}
            copyPerformanceReport={copyPerformanceReport}
            warmPreviewsNow={() => warmPreviewCache(performanceProfile.manualPreviewLimit, true)}
            chooseModelRoot={chooseModelRoot}
            downloadModel={downloadModel}
            modelDownloadProgress={modelDownloadProgress}
          />
        )}
        {showOnboarding && (
          <OnboardingGuide
            state={state}
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
            onCancel={() => setConsentPrompt(null)}
            onConfirm={confirmConsent}
          />
        )}
      </section>
    </main>
  );
}

function OnboardingGuide({
  state,
  onClose,
  onLater,
  navigate,
  chooseWorkspace,
  requestConsent
}: {
  state: AppState;
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
      title: "Choose an app folder",
      detail: "This is where CrossAge keeps saved people, possible matches, notes, and exports.",
      status: hasWorkspace,
      icon: HardDrive,
      actionLabel: "Choose folder",
      action: chooseWorkspace
    },
    {
      title: "Confirm permission",
      detail: "Only scan people and photos you have permission to process.",
      status: state.consentOnFile,
      icon: ShieldCheck,
      actionLabel: state.consentOnFile ? "Permission set" : "Confirm",
      action: state.consentOnFile ? () => navigate("enroll") : requestConsent
    },
    {
      title: "Add the person to find",
      detail: "Pick clear photos of the person. Add child, teen, and adult photos when you have them.",
      status: hasReferences,
      icon: UserPlus,
      actionLabel: "Add person",
      action: () => navigate("enroll")
    },
    {
      title: "Scan a photo folder",
      detail: "Check the folder first, then search photos and videos for possible matches.",
      status: hasScan,
      icon: Search,
      actionLabel: "Start scan",
      action: () => navigate("scan")
    },
    {
      title: "Review possible matches",
      detail: "CrossAge suggests matches. You make the final decision.",
      status: hasReviewed,
      icon: Eye,
      actionLabel: "Review",
      action: () => navigate("review")
    },
    {
      title: "Keep private photos protected",
      detail: "Safe Mode keeps likely intimate photos out of matching, previews, groups, and exports.",
      status: safeModeReady,
      icon: Settings,
      actionLabel: "See settings",
      action: () => navigate("settings")
    }
  ];

  const firstIncomplete = steps.find((step) => !step.status) ?? steps[2];

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="onboarding-sheet" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <div className="onboarding-hero">
          <div className="onboarding-mark">
            <BookOpen size={24} />
          </div>
          <div>
            <small>First use</small>
            <h2 id="onboarding-title">Set up your first scan</h2>
            <p>
              Add a person, choose a folder of photos or videos, and review possible matches. Everything stays local, and Safe Mode stays on.
            </p>
          </div>
        </div>

        <div className="onboarding-progress" aria-label={`Onboarding ${progress}% complete`}>
          <div>
            <strong>{completed}/6 ready</strong>
            <span>{progress}% complete</span>
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
          <span><ShieldCheck size={15} /> Permission required</span>
          <span><EyeOff size={15} /> Safe Mode on</span>
          <span><Database size={15} /> Saved locally</span>
        </div>

        <div className="button-row onboarding-actions">
          <button className="secondary" onClick={onLater} type="button">Remind me later</button>
          <button className="secondary" onClick={onClose} type="button">Done</button>
          <button className="primary" onClick={firstIncomplete.action} type="button">
            <ChevronRight size={16} />
            <span>Continue</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function ConsentSheet({
  scope,
  onCancel,
  onConfirm
}: {
  scope: string;
  onCancel(): void;
  onConfirm(note: string): void | Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="consent-sheet" role="dialog" aria-modal="true" aria-labelledby="consent-title">
        <div className="panel-title">
          <ShieldCheck size={18} />
          <span id="consent-title">Confirm permission</span>
        </div>
        <div className="consent-scope">
          <small>Applies to this app folder</small>
          <strong title={scope}>{scope}</strong>
        </div>
        <p className="compact">
          Confirm that you have permission to scan these people and photos in this local app folder. CrossAge only suggests possible matches; you make the final decision.
        </p>
        <label>Optional note
          <textarea
            aria-label="Permission note"
            value={note}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Add a case, folder, or operator note"
            maxLength={800}
          />
        </label>
        <div className="button-row consent-sheet-actions">
          <button className="secondary" type="button" onClick={onCancel}>
            <X size={17} />
            <span>Cancel</span>
          </button>
          <button className="primary" type="button" onClick={() => void onConfirm(note.trim())}>
            <ShieldCheck size={17} />
            <span>Confirm permission</span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Dashboard({
  state,
  scanProgress,
  watchStatus,
  latencySamples,
  latencySummary,
  performanceProfile,
  navigate,
  chooseWorkspace,
  requestConsent,
  chooseModelRoot,
  downloadModel,
  modelDownloadProgress,
  busy
}: {
  state: AppState;
  scanProgress: ScanProgress | null;
  watchStatus: FolderWatchStatus;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  performanceProfile: PerformanceProfile;
  navigate(tab: TabKey): void;
  chooseWorkspace(): void;
  requestConsent(): void;
  chooseModelRoot(): void | Promise<void>;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  modelDownloadProgress: ModelDownloadProgress | null;
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
    { label: "Possible matches", value: formatNumber(totals.added), detail: `${formatRate(matchRate)} search yield`, tone: "green" },
    { label: "Private photos protected", value: formatNumber(totals.safeFiltered), detail: `${formatRate(protectedRate)} kept out`, tone: "rose" },
    { label: "Match strength", value: scoreLabel(averageScore), detail: `${percent(averageQuality)} photo quality`, tone: toneFor(averageScore) },
    { label: "Command p95", value: latencySummary.count ? formatDuration(latencySummary.p95) : "Live", detail: lastLatency ? `${lastLatency.label}: ${formatDuration(lastLatency.durationMs)}` : `Budget ${formatDuration(performanceProfile.slowCommandMs)}`, tone: latencySummary.p95 > performanceProfile.slowCommandMs ? "amber" : "blue" },
    { label: "Perf mode", value: performanceProfile.label, detail: `${performanceProfile.reviewBatchSize} review rows per batch`, tone: performanceProfile.showListThumbnails ? "green" : "blue" },
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
                : "Add photos of a person, scan a folder, and review what CrossAge finds."}
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

      <ModelSetupCard
        state={state}
        progress={modelDownloadProgress}
        busy={busy}
        chooseModelRoot={chooseModelRoot}
        downloadModel={downloadModel}
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
        <ScanActivity progress={scanProgress} watchStatus={watchStatus} />
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
          <dt>Platform</dt><dd>{platformLabel(state)}</dd>
          <dt>Provider</dt><dd>{state.platform.primary_provider}</dd>
          <dt>Engine</dt><dd title={state.engine}>{engineLabel(state.engine)}</dd>
          <dt>Precision</dt><dd>{state.platform.precision}</dd>
          <dt>Acceleration</dt><dd>{state.platform.accelerator_status}</dd>
          <dt>Search index</dt><dd>{state.platform.vector_backend || state.vectorStore}</dd>
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
      title: "Choose where CrossAge saves its work",
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
      detail: watchStatus.active ? "CrossAge is watching a folder for new files." : "Choose a folder, check it, then start the scan.",
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
              ? "CrossAge is using a local face model. Downloads are verified before install and stay on this device."
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
          <span>{setup?.offlineMessage || "Internet is needed once for the face model. If you are offline, the app can open in simple matching mode and retry later."}</span>
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
        <p className="compact">Add a few clear photos of one person. CrossAge saves these as the example photos it compares against during scans.</p>
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
      <p className="compact">More ages can help CrossAge find the same person across old and new photos.</p>
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
  scanCameraFrame(dataUrl: string): Promise<CameraScanResult>;
  analyzeFolder(): void;
  folderAnalysis: FolderAnalysis | null;
  startWatchFolder(): void;
  stopWatchFolder(): void;
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
  selectCandidate(id: string): void;
}) {
  const readiness = [
    { label: "Permission", ok: props.state.consentOnFile },
    { label: "Person added", ok: props.state.references.length > 0 },
    { label: "Folder", ok: props.scanFolder.trim().length > 0 }
  ];
  return (
    <section className="scan-page">
      <div className="panel form-panel">
        <div className="panel-title"><Search size={18} /> Scan photos and videos</div>
        <p className="compact">Pick a folder to search. CrossAge adds possible matches to the review list as it works, so you do not have to wait for the whole scan to finish.</p>
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
        <PendingExternalBanner
          intent={props.pendingExternalIntent}
          ready={Boolean(props.state.consentOnFile && props.state.references.length)}
          onResume={props.resumePendingExternalIntent}
          onDismiss={props.clearPendingExternalIntent}
        />
        <FolderPreflight analysis={props.folderAnalysis} />
        <ScanActivity progress={props.scanProgress} watchStatus={props.watchStatus} />
        <ScanIssueCenter
          analysis={props.folderAnalysis}
          scanHistory={props.state.scanHistory}
          onPreflight={props.analyzeFolder}
          busy={props.busy}
          copyText={props.copyText}
          revealPath={props.revealPath}
          openPath={props.openPath}
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

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
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
    try {
      const stream = window.crossAge.testCamera
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
      setMode("live");
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : String(captureError);
      setError(message || "Camera access was not available.");
      setMode("error");
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
    if (!video || !live || props.busy || mode === "capturing") return;
    setMode("capturing");
    setError("");
    try {
      const dataUrl = snapshotVideoFrame(video);
      const result = await props.onCapture(dataUrl);
      setLastCapture(result);
      setMode(streamRef.current ? "live" : "idle");
    } catch (captureError) {
      const message = captureError instanceof Error ? captureError.message : String(captureError);
      setError(message || "Camera photo could not be saved.");
      setMode(streamRef.current ? "live" : "error");
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
  openPath
}: {
  analysis: FolderAnalysis | null;
  scanHistory: AppState["scanHistory"];
  onPreflight(): void;
  busy: boolean;
  copyText(text: string, label?: string): void;
  revealPath(candidatePath?: string | null): void | Promise<void>;
  openPath(candidatePath?: string | null): void | Promise<void>;
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
    "CrossAge FR scan issue report",
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
  const issueCount = analysis.unreadableSamples.length + analysis.unreadableVideoSamples.length;
  const ready = analysis.exists && analysis.isDirectory && mediaCount > 0 && issueCount === 0;
  const metrics = [
    { label: "Images", value: formatNumber(analysis.imageCount) },
    { label: "Videos", value: formatNumber(analysis.videoCount) },
    { label: "Other files", value: formatNumber(analysis.nonImageCount) },
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
      <div className="preflight-notes">
        {analysis.recommendations.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
      </div>
      {analysis.decoder && (
        <div className="decoder-strip">
          <span className={analysis.decoder.heifAvailable ? "pill green" : "pill neutral"}>HEIC {analysis.decoder.heifAvailable ? "ready" : "not ready"}</span>
          <span className={analysis.decoder.rawAvailable ? "pill green" : "pill neutral"}>RAW {analysis.decoder.rawAvailable ? "ready" : "not ready"}</span>
          {analysis.videoDecoder && <span className={analysis.videoDecoder.opencvAvailable ? "pill green" : "pill neutral"}>Video {analysis.videoDecoder.backend}</span>}
          <span className="pill neutral">{analysis.decoder.extensions.length} file types</span>
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

function ScanActivity({ progress, watchStatus }: { progress: ScanProgress | null; watchStatus: FolderWatchStatus }) {
  const [etaOpen, setEtaOpen] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const total = progress?.total ?? 0;
  const processed = progress?.processed ?? 0;
  const completion = total ? Math.min(1, processed / total) : 0;
  const current = progress?.currentPath ? basename(progress.currentPath) : watchStatus.active ? basename(watchStatus.folder) : "Idle";
  const phase = watchStatus.scanning ? "Watching" : progress?.phase === "complete" ? "Complete" : progress?.phase ? "Scanning" : "Ready";
  const scanActive = Boolean(progress && progress.phase !== "complete" && total > 0 && processed < total);
  const completedWatchMessage = watchStatus.active && progress?.source === "watch" && progress.phase === "complete" && Number(progress.added ?? 0) > 0
    ? `Processed ${progress.processed ?? progress.total ?? progress.added ?? 0} new file(s).`
    : "";
  const activityMessage = completedWatchMessage || watchStatus.message || current;
  const elapsedMs = startedAt ? Math.max(0, clock - startedAt) : 0;
  const etaMs = scanActive && startedAt && processed > 0 ? Math.max(0, (elapsedMs / processed) * (total - processed)) : null;
  const rate = elapsedMs > 0 ? (processed / (elapsedMs / 1000)) : 0;

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
          <strong>{total ? `${processed}/${total}` : watchStatus.active ? `${watchStatus.queued} waiting` : "No active scan"}</strong>
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
      <div className="activity-stats">
        <span><strong>{progress?.added ?? 0}</strong> possible matches</span>
        <span><strong>{progress?.matched ?? 0}</strong> matched to a person</span>
        <span><strong>{progress?.clustered ?? 0}</strong> similar groups</span>
        <span><strong>{progress?.safeFiltered ?? 0}</strong> protected</span>
        <span><strong>{progress?.videoFrames ?? 0}</strong> video frames</span>
        <span><strong>{progress?.errors ?? 0}</strong> errors</span>
      </div>
      <small title={progress?.currentPath ?? watchStatus.folder ?? ""}>{activityMessage}</small>
    </div>
  );
}

function ReviewView(props: {
  state: AppState;
  selectedCandidate: ReviewCandidate | null;
  selectedCandidateId: string | null;
  setSelectedCandidateId(value: string): void;
  review(status: CandidateStatus): void | Promise<void>;
  bulkReview(candidateIds: string[], status: CandidateStatus): void | Promise<void>;
  exportSelectedCandidates(candidateIds: string[]): void | Promise<void>;
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
  const [statusFilter, setStatusFilter] = useState<CandidateStatus | "all">("pending");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"score" | "newest" | "quality">("score");
  const [reviewLane, setReviewLane] = useState<"all" | "high" | "lowQuality" | "groups" | "notes">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(() => new Set());
  const [groupMinPeople, setGroupMinPeople] = useState(2);
  const [noteDraft, setNoteDraft] = useState("");
  const [privacyVeil, setPrivacyVeil] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(props.renderBatchSize);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    setNoteDraft(props.selectedCandidate?.note ?? "");
  }, [props.selectedCandidate?.candidateId, props.selectedCandidate?.note]);

  const knownPeople = useMemo(() => {
    const people = new Set<string>();
    for (const ref of props.state.references) {
      if (ref.personName.trim()) people.add(ref.personName);
    }
    for (const candidate of props.state.candidates) {
      if (candidate.personName.trim() && !candidate.personName.startsWith("Unmatched cluster")) {
        people.add(candidate.personName);
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
          .filter((candidate) => !candidate.personName.startsWith("Unmatched cluster"))
          .map((candidate) => candidate.personName))]
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
      if (candidate.status === "pending") {
        pending += 1;
        if (candidate.score >= props.state.config.thresholds.confident) {
          confidencePending += 1;
        }
      } else {
        reviewed += 1;
      }
    }
    return {
      groupedCandidateIds,
      reviewLanes: [
        { key: "all" as const, label: "All", count: props.state.candidates.length },
        { key: "high" as const, label: "Strong matches", count: high },
        { key: "lowQuality" as const, label: "Needs a closer look", count: lowQuality },
        { key: "groups" as const, label: "Groups", count: groupedCandidateIds.size },
        { key: "notes" as const, label: "Notes", count: notes }
      ],
      smartBatches: [
        { key: "decision", label: "Needs decision", count: pending },
        { key: "confidence", label: "Looks strongest", count: confidencePending },
        { key: "quality", label: "Check quality", count: lowQuality },
        { key: "together", label: "People together", count: groupedCandidateIds.size },
        { key: "reviewed", label: "Already reviewed", count: reviewed }
      ] as const
    };
  }, [candidatesByPath, props.state.candidates, props.state.config.thresholds.confident, props.state.config.thresholds.qualityMin]);

  const filteredCandidates = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const lowQualityThreshold = Math.max(0.2, props.state.config.thresholds.qualityMin);
    const rows: ReviewCandidate[] = [];
    for (const candidate of props.state.candidates) {
      let inLane = true;
      if (reviewLane === "high") {
        inLane = candidate.score >= props.state.config.thresholds.confident;
      } else if (reviewLane === "lowQuality") {
        inLane = candidate.quality < lowQualityThreshold;
      } else if (reviewLane === "groups") {
        inLane = reviewSummary.groupedCandidateIds.has(candidate.candidateId);
      } else if (reviewLane === "notes") {
        inLane = Boolean(candidate.note.trim());
      }
      if (!inLane || (statusFilter !== "all" && candidate.status !== statusFilter)) {
        continue;
      }
      if (query && ![candidate.personName, candidate.band, candidate.sourcePath, candidate.mediaSourcePath ?? "", candidate.note]
        .some((value) => value.toLowerCase().includes(query))) {
        continue;
      }
      rows.push(candidate);
    }
    return rows.sort((a, b) => {
      if (sort === "newest") return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      if (sort === "quality") return b.quality - a.quality;
      return b.score - a.score;
    });
  }, [deferredSearch, props.state.candidates, props.state.config.thresholds.confident, props.state.config.thresholds.qualityMin, reviewLane, reviewSummary.groupedCandidateIds, sort, statusFilter]);

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
  const visibleCandidates = useMemo(
    () => filteredCandidates.slice(0, visibleLimit),
    [filteredCandidates, visibleLimit]
  );

  useEffect(() => {
    setVisibleLimit(props.renderBatchSize);
  }, [deferredSearch, props.renderBatchSize, reviewLane, sort, statusFilter]);

  useEffect(() => {
    setSelectedIds((current) => {
      const allowed = new Set(filteredCandidates.map((candidate) => candidate.candidateId));
      return new Set([...current].filter((candidateId) => allowed.has(candidateId)));
    });
  }, [filteredCandidates]);

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
    if (!props.selectedCandidate) return;
    const nextCandidate = filteredCandidates.length > 1 && selectedIndex >= 0
      ? filteredCandidates[(selectedIndex + 1) % filteredCandidates.length]
      : null;
    await props.review(status);
    if (nextCandidate && nextCandidate.candidateId !== props.selectedCandidate.candidateId) {
      props.setSelectedCandidateId(nextCandidate.candidateId);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (props.busy || editableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
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
      } else if (key === "arrowdown" || key === "n") {
        event.preventDefault();
        selectRelativeCandidate(1);
      } else if (key === "arrowup" || key === "p") {
        event.preventDefault();
        selectRelativeCandidate(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.busy, props.selectedCandidate?.candidateId, filteredCandidates, selectedIndex]);

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
    if (filteredCandidates.length > visibleCandidates.length) {
      const proceed = window.confirm(`Select all ${filteredCandidates.length} possible matches that fit this filter, including rows that are not currently shown?`);
      if (!proceed) return;
    }
    setSelectedIds(new Set(filteredCandidates.map((candidate) => candidate.candidateId)));
  }

  function activateSmartBatch(batch: typeof reviewSummary.smartBatches[number]["key"]) {
    if (batch === "decision") {
      setStatusFilter("pending");
      setReviewLane("all");
      setSort("score");
    } else if (batch === "confidence") {
      setStatusFilter("pending");
      setReviewLane("high");
      setSort("score");
    } else if (batch === "quality") {
      setStatusFilter("all");
      setReviewLane("lowQuality");
      setSort("quality");
    } else if (batch === "together") {
      setStatusFilter("all");
      setReviewLane("groups");
      setSort("score");
    } else {
      setStatusFilter("all");
      setReviewLane("all");
      setSort("newest");
      setSelectedIds(new Set(props.state.candidates.filter((candidate) => candidate.status !== "pending").map((candidate) => candidate.candidateId)));
    }
  }

  async function bulkStatus(status: CandidateStatus) {
    const ids = [...selectedIds];
    if (ids.length > 1 && !window.confirm(`Mark ${ids.length} selected possible matches as ${reviewStatusLabel(status)}?`)) {
      return;
    }
    await props.bulkReview(ids, status);
    setSelectedIds(new Set());
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
          <div className="person-chip-list" role="group" aria-label="People to find together">
            {knownPeople.length ? knownPeople.map((person) => (
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
      <div className="panel table-panel compact-table review-queue-panel">
        <div className="panel-title">
          <ShieldCheck size={18} /> Possible matches
          <span className="title-count">{filteredCandidates.length}</span>
        </div>
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
          <button className="ghost compact-action" onClick={selectAllFiltered} disabled={!filteredCandidates.length || props.busy}>Select all matches</button>
          <span>{selectedIds.size} selected</span>
          <button className="secondary" onClick={() => bulkStatus("accepted")} disabled={!selectedIds.size || props.busy}><Check size={16} /><span>Looks right</span></button>
          <button className="secondary" onClick={() => bulkStatus("rejected")} disabled={!selectedIds.size || props.busy}><X size={16} /><span>Not a match</span></button>
          <button className="secondary" onClick={() => bulkStatus("uncertain")} disabled={!selectedIds.size || props.busy}><AlertCircle size={16} /><span>Not sure</span></button>
          <button className="secondary" onClick={() => props.exportSelectedCandidates([...selectedIds])} disabled={!selectedIds.size || props.busy}><Archive size={16} /><span>Export</span></button>
        </div>
        <div className="table">
          {filteredCandidates.length === 0 ? <EmptyState icon={ShieldCheck} label="No possible matches found" detail="Adjust the filter or scan more photos and videos." /> : (
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
                <button
                  key={candidate.candidateId}
                  className={props.selectedCandidateId === candidate.candidateId ? "row review-candidate-row selected" : "row review-candidate-row"}
                  onClick={() => props.setSelectedCandidateId(candidate.candidateId)}
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
                </button>
              ))}
              {visibleCandidates.length < filteredCandidates.length && (
                <button
                  className="row load-more-row"
                  onClick={() => setVisibleLimit((value) => value + props.renderBatchSize)}
                  type="button"
                >
                  <span />
                  <span>Showing {visibleCandidates.length} of {filteredCandidates.length}</span>
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
      <div className="panel preview-panel">
        {props.selectedCandidate ? (
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
              <button className="ghost compact-action" onClick={() => props.revealPath(candidateMediaPath(props.selectedCandidate))} type="button">
                <FolderOpen size={16} />
                <span>Reveal</span>
              </button>
              <button className="ghost compact-action" onClick={() => props.openPath(candidateMediaPath(props.selectedCandidate))} type="button">
                <ExternalLink size={16} />
                <span>Open</span>
              </button>
              <span className={`status ${props.selectedCandidate.status}`}>{reviewStatusLabel(props.selectedCandidate.status)}</span>
            </div>
            <div className="review-session-bar" aria-label="Review session progress">
              <span>
                <small>Match position</small>
                <strong>{queuePosition || "0"} / {filteredCandidates.length}</strong>
              </span>
              <span>
                <small>Still to review</small>
                <strong>{filteredStats.pending}</strong>
              </span>
              <span>
                <small>Reviewed in view</small>
                <strong>{filteredStats.reviewed}</strong>
              </span>
              <span>
                <small>Strong matches</small>
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
              <ImagePreview label={isVideoCandidate(props.selectedCandidate) ? "Video frame to check" : "Photo to check"} url={props.selectedCandidate.sourceUrl} fallback={props.selectedCandidate.sourcePath} concealed={privacyVeil} />
              <ImagePreview label="Saved person photo" url={props.selectedCandidate.bestRefUrl} fallback={props.selectedCandidate.bestRefPath} concealed={privacyVeil} />
            </div>
            <div className="candidate-detail">
              <h2>{props.selectedCandidate.personName}</h2>
              <div className="bands">
                <span className="band confident">{matchBandLabel(props.selectedCandidate.band)}</span>
                <span className="band likely">strength {scoreLabel(props.selectedCandidate.score)}</span>
                <span className="band maybe">photo quality {scoreLabel(props.selectedCandidate.quality)}</span>
              </div>
              <p className="source-path" title={candidateSourceTitle(props.selectedCandidate)}>
                {isVideoCandidate(props.selectedCandidate)
                  ? `Video ${props.selectedCandidate.mediaSourcePath} at ${formatMediaTimestamp(props.selectedCandidate.videoTimestampMs)}`
                  : props.selectedCandidate.sourcePath}
                {isVideoCandidate(props.selectedCandidate) && <span>Extracted frame: {props.selectedCandidate.sourcePath}</span>}
              </p>
              {props.selectedCandidate.note && <p className="compact">{props.selectedCandidate.note}</p>}
            </div>
            <CandidateExplanation candidate={props.selectedCandidate} state={props.state} />
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
              <button className="secondary" onClick={() => props.saveCandidateNote(props.selectedCandidate!.candidateId, noteDraft)} disabled={props.busy || noteDraft === props.selectedCandidate.note} type="button">
                <Save size={17} />
                <span>Save note</span>
              </button>
            </div>
          </>
        ) : (
          <EmptyState icon={ShieldCheck} label="No match selected" detail="Select a possible match to compare it with the saved person photo." />
        )}
      </div>
    </section>
  );
}

function CandidateExplanation({ candidate, state }: { candidate: ReviewCandidate; state: AppState }) {
  const bestReference = candidate.bestRefId
    ? state.references.find((ref) => ref.refId === candidate.bestRefId)
    : null;
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
  const rows = [
    { label: "Why shown", value: candidate.band === "clustered review" ? "Similar photos were grouped together" : `${scoreTarget} match strength` },
    { label: "Photo quality", value: `${scoreLabel(candidate.quality)} ${qualityTarget}` },
    { label: "Media", value: isVideoCandidate(candidate) ? `Video @ ${formatMediaTimestamp(candidate.videoTimestampMs)}` : "Image" },
    { label: "Saved person", value: bestReference ? `${bestReference.personName} • ${ageBucketLabel(bestReference.ageBucket)}` : "No saved person photo" },
    { label: "Saved photo", value: bestReference ? basename(bestReference.sourcePath) : candidate.band === "clustered review" ? "Similar group only" : "Unavailable" },
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
        CrossAge suggests possible matches only. Treat this as a lead, not an automatic identification.
      </p>
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
  revealWorkspace(): void;
  openWorkspaceFolder(): void;
  people: string[];
  exportReport(): void;
  exportWorkspaceBackup(): void;
  copyText(text: string, label?: string): void;
  purgeReviewedCandidates(): void;
  purgeOldCandidates(days: number): void;
  runWorkspaceHealth(): void;
  purgeDuplicateCandidates(): void;
  workspaceHealth: WorkspaceHealth | null;
  deletePerson(personName: string): void;
  renamePerson(oldName: string, newName: string): void;
  auditEvents: AuditEventsResult | null;
  loadAuditEvents(): void;
  runtimeSelfTest: RuntimeSelfTestResult | null;
  runRuntimeSelfTest(): void;
  performanceMode: PerformanceMode;
  setPerformanceMode(value: PerformanceMode): void;
  performanceProfile: PerformanceProfile;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  clearLatencySamples(): void;
  copyPerformanceReport(): void;
  warmPreviewsNow(): void;
  chooseModelRoot(): void | Promise<void>;
  downloadModel(pack: string, root?: string, force?: boolean): void | Promise<void>;
  modelDownloadProgress: ModelDownloadProgress | null;
}) {
  const [personToDelete, setPersonToDelete] = useState("");
  const [personToRename, setPersonToRename] = useState("");
  const [renameTarget, setRenameTarget] = useState("");
  const [retentionDays, setRetentionDays] = useState(90);
  const safeModel = props.state.safeModeModel;

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
    if (preset) props.setSettings({ ...preset.values, mode: preset.key });
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
  const validationMessages: string[] = [];
  if (!(props.settings.thresholds.confident >= props.settings.thresholds.likely && props.settings.thresholds.likely >= props.settings.thresholds.relaxedChild)) {
    validationMessages.push("Advanced match levels must stay in order: Strong >= Likely >= Review more.");
  }
  if (props.settings.clusterMinSize < 2) {
    validationMessages.push("Similar-photo groups need at least 2 photos.");
  }
  const safeModeRelaxed = props.state.config.safeMode && (
    !props.settings.safeMode ||
    props.settings.safeModeThreshold > props.state.config.safeModeThreshold + 0.001
  );
  function requestSaveSettings() {
    if (validationMessages.length) return;
    if (safeModeRelaxed) {
      const proceed = window.confirm("This change makes Safe Mode less protective. Continue only if you want likely intimate media to be filtered less aggressively.");
      if (!proceed) return;
    }
    props.saveSettings();
  }
  function copyWorkspaceSummary() {
    const totals = props.state.scanTotals;
    props.copyText([
      "CrossAge FR app summary",
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
      `Safe Mode: ${props.state.config.safeMode ? "On" : "Off"}`,
      `People: ${props.people.join(", ") || "None"}`
    ].join("\n"), "App summary");
  }
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
            <label>Group similar photos when at least
              <input
                type="number"
                min={2}
                max={20}
                value={props.settings.clusterMinSize}
                onChange={(event) => setCustomSettings({ clusterMinSize: Number(event.currentTarget.value) })}
              />
            </label>
          </div>
        ) : (
          <div className="preset-values">
            <span>Strong {percent(props.settings.thresholds.confident)}</span>
            <span>Likely {percent(props.settings.thresholds.likely)}</span>
            <span>Quality {percent(props.settings.thresholds.qualityMin)}</span>
            <span>Group {props.settings.clusterMinSize}+</span>
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
        <dl className="mini-list">
          <dt>Face model</dt><dd>{props.state.modelSetup?.ready ? props.state.modelSetup.currentPack : "Needs download"}</dd>
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
      <ModelSetupCard
        state={props.state}
        progress={props.modelDownloadProgress}
        busy={props.busy}
        chooseModelRoot={props.chooseModelRoot}
        downloadModel={props.downloadModel}
      />
      <RuntimeSelfTestPanel result={props.runtimeSelfTest} />
      <PerformanceCenter
        mode={props.performanceMode}
        setMode={props.setPerformanceMode}
        profile={props.performanceProfile}
        latencySamples={props.latencySamples}
        latencySummary={props.latencySummary}
        busy={props.busy}
        warmPreviewsNow={props.warmPreviewsNow}
        copyPerformanceReport={props.copyPerformanceReport}
        clearLatencySamples={props.clearLatencySamples}
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
      </div>
      <WorkspaceHealthPanel
        health={props.workspaceHealth}
        busy={props.busy}
        runWorkspaceHealth={props.runWorkspaceHealth}
        purgeDuplicateCandidates={props.purgeDuplicateCandidates}
      />
      <div className="panel settings-panel data-ops-panel">
        <div className="panel-title"><Database size={18} /> Save and clean up</div>
        <button className="primary" onClick={props.exportReport} disabled={props.busy}>
          <Archive size={17} />
          <span>Export review report</span>
        </button>
        <button className="secondary" onClick={copyWorkspaceSummary} disabled={props.busy}>
          <Archive size={17} />
          <span>Copy app summary</span>
        </button>
        <button className="secondary" onClick={props.exportWorkspaceBackup} disabled={props.busy}>
          <HardDrive size={17} />
          <span>Backup app folder</span>
        </button>
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
      <AuditTrailPanel events={props.auditEvents} busy={props.busy} loadAuditEvents={props.loadAuditEvents} copyText={props.copyText} />
    </section>
  );
}

function WorkspaceHealthPanel({
  health,
  busy,
  runWorkspaceHealth,
  purgeDuplicateCandidates
}: {
  health: WorkspaceHealth | null;
  busy: boolean;
  runWorkspaceHealth(): void;
  purgeDuplicateCandidates(): void;
}) {
  const duplicateCount = health?.duplicateCandidateCount ?? 0;
  const metrics = health ? [
    { label: "Storage", value: formatBytes(health.storageBytes) },
    { label: "Files", value: formatNumber(health.workspaceFileCount) },
    { label: "Activity events", value: formatNumber(health.auditEvents) },
    { label: "Missing saved photos", value: formatNumber(health.missingReferences) },
    { label: "Missing matches", value: formatNumber(health.missingCandidates) },
    { label: "Missing media", value: formatNumber(health.missingMediaSources ?? 0) },
    { label: "Duplicates", value: formatNumber(duplicateCount) }
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
            {health.recommendations.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
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
          <small className="compact">Checked {formatDateTime(health.generatedAt)}</small>
        </>
      ) : (
        <p className="compact">Run a check to find missing files, duplicate match rows, activity history size, and cleanup opportunities.</p>
      )}
      <div className="button-row">
        <button className="secondary" onClick={runWorkspaceHealth} disabled={busy}>
          <Activity size={17} />
          <span>Run check</span>
        </button>
        <button className="secondary danger" onClick={purgeDuplicateCandidates} disabled={busy || duplicateCount === 0}>
          <Trash2 size={17} />
          <span>Remove duplicates</span>
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
        {result.recommendations.slice(0, 4).map((item) => <span key={item}>{item}</span>)}
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
  mode,
  setMode,
  profile,
  latencySamples,
  latencySummary,
  busy,
  warmPreviewsNow,
  copyPerformanceReport,
  clearLatencySamples
}: {
  mode: PerformanceMode;
  setMode(value: PerformanceMode): void;
  profile: PerformanceProfile;
  latencySamples: LatencySample[];
  latencySummary: LatencySummary;
  busy: boolean;
  warmPreviewsNow(): void;
  copyPerformanceReport(): void;
  clearLatencySamples(): void;
}) {
  const recent = latencySamples.slice(0, 5);
  const budgetLabel = formatDuration(profile.slowCommandMs);
  return (
    <div className="panel settings-panel performance-center">
      <div className="panel-title"><Gauge size={18} /> Performance center</div>
      <div className="performance-mode-grid" role="group" aria-label="Performance modes">
        {(Object.keys(performanceProfiles) as PerformanceMode[]).map((key) => {
          const item = performanceProfiles[key];
          return (
            <button
              key={key}
              className={mode === key ? "performance-mode selected" : "performance-mode"}
              onClick={() => setMode(key)}
              type="button"
            >
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              <small>{item.showListThumbnails ? "Thumbnails on" : "Thumbnails off"} • {item.reviewBatchSize} rows</small>
              {mode === key ? <Check size={16} /> : <ChevronRight size={16} />}
            </button>
          );
        })}
      </div>
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
  return (
    <span className="candidate-identity">
      <span className="thumb">
        {showThumbnail && candidate.sourceUrl && !failed ? <img loading="lazy" decoding="async" src={candidate.sourceUrl} alt="" onError={() => setFailed(true)} /> : video ? <Video size={18} /> : <ImageIcon size={18} />}
      </span>
      <span>
        <strong>{candidate.personName}</strong>
        <small>{video ? `${matchBandLabel(candidate.band)} • video ${formatMediaTimestamp(candidate.videoTimestampMs)}` : matchBandLabel(candidate.band)}</small>
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

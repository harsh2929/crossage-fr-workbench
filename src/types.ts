export type AgeBucket = "child" | "adolescent" | "adult" | "unknown";
export type CandidateStatus = "pending" | "accepted" | "rejected" | "uncertain";

export interface PlatformReport {
  platform_key: string;
  system: string;
  machine: string;
  python_arch: string;
  rosetta_translated: boolean;
  onnxruntime_available: boolean;
  available_providers: string[];
  selected_providers: unknown[];
  primary_provider: string;
  accelerator_status: string;
  precision: string;
  vector_backend: string;
  platform_notes: string[];
  insightface_available: boolean;
  faiss_available: boolean;
  hdbscan_available: boolean;
}

export interface Thresholds {
  confident: number;
  likely: number;
  relaxedChild: number;
  qualityMin: number;
}

export interface AppConfig {
  modelPack?: string;
  modelRoot?: string;
  thresholds: Thresholds;
  clusterMinSize: number;
  safeMode: boolean;
  safeModeThreshold: number;
  reviewOnly: boolean;
  requireConsent: boolean;
}

export interface ConsentSummary {
  active: boolean;
  operator: string;
  source: string;
  scope: string;
  confirmedAt?: string | null;
  updatedAt?: string | null;
}

export interface WorkspaceMetadata {
  schemaVersion: number;
  workspaceId: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedBy: string;
}

export interface SafeModeModelReport {
  engine: string;
  available: boolean;
  modelName: string;
  path?: string | null;
  source?: string;
  license?: string;
  inputSize?: number;
  labels?: string[];
  nsfwIndex?: number;
  thresholdHint?: string;
  reason?: string;
}

export interface ModelPackageStatus {
  pack: string;
  label: string;
  detail: string;
  filename: string;
  url: string;
  sha256: string;
  size_bytes: number;
  license: string;
  source: string;
  path: string;
  archivePath: string;
  available: boolean;
  missing: string[];
  downloadedArchive: boolean;
  installedBytes: number;
}

export interface ModelSetupReport {
  ready: boolean;
  fallbackActive: boolean;
  currentPack: string;
  modelRoot: string;
  defaultRoot: string;
  engine: string;
  packages: ModelPackageStatus[];
  offlineMessage: string;
  recommendation: string;
}

export interface ModelDownloadProgress {
  pack: string;
  label: string;
  phase: "starting" | "downloading" | "verifying" | "extracting" | "complete" | "error" | string;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message: string;
  root: string;
}

export interface ReferenceFace {
  refId: string;
  personName: string;
  ageBucket: AgeBucket;
  sourcePath: string;
  sourceUrl?: string;
  previewPath?: string | null;
  previewUrl?: string;
  captureDate: string | null;
  quality: number;
  modelName: string;
  createdAt: string;
}

export interface AgeReferenceGroup {
  ageBucket: AgeBucket;
  folder: string;
}

export interface CameraSaveResult {
  folder: string;
  filePath: string;
}

export interface ReviewCandidate {
  candidateId: string;
  sourcePath: string;
  sourceUrl?: string;
  previewPath?: string | null;
  previewUrl?: string;
  mediaKind?: "image" | "video" | string;
  mediaSourcePath?: string;
  mediaSourceUrl?: string;
  videoTimestampMs?: number | null;
  videoFrameIndex?: number | null;
  videoDurationMs?: number | null;
  personName: string;
  bestRefId: string | null;
  bestRefPath: string | null;
  bestRefUrl?: string;
  bestRefPreviewPath?: string | null;
  bestRefPreviewUrl?: string;
  score: number;
  band: string;
  quality: number;
  modelName: string;
  status: CandidateStatus;
  note: string;
  createdAt: string;
}

export interface ScanMetrics {
  total: number;
  processed: number;
  added: number;
  matched: number;
  clustered: number;
  skipped: number;
  errors: number;
  unmatched: number;
  safeFiltered: number;
  videoFiles: number;
  videoFrames: number;
  videoProtected: number;
}

export interface ScanRun {
  runId: string;
  source: string;
  label: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  metrics: ScanMetrics;
  errorSamples: string[];
}

export interface ScanTotals extends ScanMetrics {
  runs: number;
  durationMs: number;
  lastCompletedAt: string | null;
}

export interface FolderAnalysis {
  folder: string;
  exists: boolean;
  isDirectory: boolean;
  imageCount: number;
  videoCount: number;
  nonImageCount: number;
  totalBytes: number;
  checkedImages: number;
  checkedVideos: number;
  unreadableSamples: Array<{ path: string; error: string }>;
  unreadableVideoSamples: Array<{ path: string; error: string }>;
  imageSamples: string[];
  videoSamples: string[];
  extensionCounts?: Record<string, number>;
  recommendations: string[];
  decoder?: {
    extensions: string[];
    pillow: string[];
    heif: string[];
    raw: string[];
    heifAvailable: boolean;
    rawAvailable: boolean;
  };
  videoDecoder?: {
    extensions: string[];
    opencvAvailable: boolean;
    backend: string;
  };
}

export interface ExportReportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    references: number;
    candidates: number;
    pending: number;
    accepted: number;
    rejected: number;
    uncertain: number;
  };
}

export interface DuplicateCandidateGroup {
  sourcePath: string;
  personName: string;
  bestRefId: string | null;
  candidateIds: string[];
  keepCandidateId: string;
  count: number;
  bestScore: number;
}

export interface WorkspaceHealth {
  generatedAt: string;
  storageBytes: number;
  workspaceFileCount: number;
  auditEvents: number;
  missingReferences: number;
  missingCandidates: number;
  missingMediaSources?: number;
  reviewedReadyToPurge: number;
  duplicateGroups: DuplicateCandidateGroup[];
  duplicateCandidateCount: number;
  recommendations: string[];
}

export interface AuditEventsResult {
  events: Array<Record<string, unknown>>;
  limit: number;
  offset: number;
  total: number;
}

export interface WorkspaceBackupValue {
  zipPath: string;
  fileCount: number;
  bytes: number;
  includeGenerated: boolean;
}

export interface RuntimeSelfTestCheck {
  name: string;
  ok: boolean;
  detail: string;
  value?: unknown;
}

export interface RuntimeSelfTestResult {
  generatedAt: string;
  ok: boolean;
  checks: RuntimeSelfTestCheck[];
  recommendations: string[];
}

export interface AppState {
  version: string;
  workspace: string;
  consentOnFile: boolean;
  consent?: ConsentSummary;
  workspaceMetadata?: WorkspaceMetadata;
  engine: string;
  vectorStore: string;
  platform: PlatformReport;
  counts: {
    references: number;
    pending: number;
    reviewed: number;
    candidates: number;
  };
  scanHistory: ScanRun[];
  scanTotals: ScanTotals;
  config: AppConfig;
  safeModeModel?: SafeModeModelReport;
  modelSetup?: ModelSetupReport;
  references: ReferenceFace[];
  candidates: ReviewCandidate[];
}

export interface CommandResult<T = unknown> {
  state?: AppState;
  added?: number;
  errors?: string[];
  metrics?: ScanMetrics;
  cleared?: number;
  updated?: number;
  purged?: number;
  prepared?: number;
  renamed?: {
    references: number;
    candidates: number;
  };
  deleted?: {
    references: number;
    candidates: number;
  };
  value?: T;
}

export interface ScanProgress extends Partial<ScanMetrics> {
  phase: "started" | "processing" | "protected" | "candidate" | "processed" | "clustering" | "error" | "complete";
  source?: "manual" | "watch" | "camera" | string;
  currentPath?: string;
  candidateId?: string;
  message?: string;
  safety_score?: number;
  state?: AppState;
}

export interface ScanProgressEvent {
  id: number;
  name: "scan";
  payload: ScanProgress;
}

export interface ModelDownloadProgressEvent {
  id: number;
  name: "model_download";
  payload: ModelDownloadProgress;
}

export interface BackendStartupEvent {
  phase: string;
  message: string;
}

export interface FolderWatchStatus {
  active: boolean;
  folder: string | null;
  queued: number;
  scanning: boolean;
  message: string;
  error?: string;
  result?: CommandResult;
}

export interface SystemIntegration {
  platform: string;
  launchAtLogin: boolean;
  protocolScheme: string;
  protocolRegistered: boolean;
  notificationsSupported: boolean;
  appUserModelId: string;
}

export type AppCommand =
  | { type: "navigate"; tab: "dashboard" | "enroll" | "scan" | "review" | "settings" }
  | { type: "open-workspace" }
  | { type: "open-workspace-folder" }
  | { type: "reveal-workspace" }
  | { type: "refresh" }
  | { type: "scan" }
  | { type: "start-watch" }
  | { type: "stop-watch" };

export type ExternalOpenPayload =
  | { type: "workspace"; path: string; source?: string }
  | { type: "scan-folder"; path: string; source?: string }
  | { type: "watch-folder"; path: string; source?: string }
  | { type: "scan-files"; paths: string[]; source?: string };

export interface CrossAgeApi {
  invoke<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T>;
  chooseFolder(): Promise<string | null>;
  saveCameraFrame(dataUrl: string): Promise<CameraSaveResult>;
  startFolderWatch(folder: string): Promise<FolderWatchStatus>;
  stopFolderWatch(): Promise<FolderWatchStatus>;
  getSystemIntegration(): Promise<SystemIntegration>;
  setLaunchAtLogin(openAtLogin: boolean): Promise<SystemIntegration>;
  revealPath(path: string): Promise<boolean>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  writeClipboardText(text: string): Promise<boolean>;
  getInitialState(): Promise<AppState>;
  rendererReady(): Promise<boolean>;
  onAppCommand(callback: (command: AppCommand) => void): () => void;
  onExternalOpen(callback: (payload: ExternalOpenPayload) => void): () => void;
  onScanProgress(callback: (event: ScanProgressEvent | ModelDownloadProgressEvent) => void): () => void;
  onBackendStartup(callback: (event: BackendStartupEvent) => void): () => void;
  onFolderWatch(callback: (status: FolderWatchStatus) => void): () => void;
  onBackendError(callback: (message: string) => void): () => void;
  platform: string;
  testCamera?: boolean;
}

declare global {
  interface Window {
    crossAge: CrossAgeApi;
  }
}

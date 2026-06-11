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
  cpu_logical_count: number;
  memory_total_bytes: number;
  performance_tier: string;
  recommended_performance_mode: string;
  performance_notes: string[];
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

export interface ReviewRules {
  autoRejectBelow: number;
  autoUncertainLowQuality: boolean;
  autoRejectLowQualityVideo: boolean;
}

export interface ScanExclusions {
  dirNames: string[];
  pathKeywords: string[];
  extensions: string[];
  filePaths: string[];
}

export interface AppConfig {
  modelPack?: string;
  modelRoot?: string;
  thresholds: Thresholds;
  clusterMinSize: number;
  faceDetectorSize: number;
  twoPassScan: boolean;
  verificationDetectorSize: number;
  performanceMode?: string;
  effectivePerformanceMode?: string;
  effectiveFaceDetectorSize?: number;
  effectiveTwoPassScan?: boolean;
  effectiveVerificationDetectorSize?: number;
  safeMode: boolean;
  safeModeThreshold: number;
  storageBudgetBytes: number;
  maxMediaFileBytes: number;
  reviewRules: ReviewRules;
  scanExclusions: ScanExclusions;
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

export interface BuildInfo {
  name: string;
  version: string;
  commit: string;
  branch: string;
  buildDate: string;
  channel: string;
  packaged: boolean;
  python?: string;
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
  sourceHash?: string;
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
  excluded?: number;
  pathErrors?: number;
  cancelled?: number;
  pausedSeconds?: number;
  resumed?: number;
  manifestSkipped?: number;
  embeddingCacheHits?: number;
  embeddingCacheMisses?: number;
  twoPassVerified?: number;
  twoPassChanged?: number;
  twoPassDeferred?: number;
  memoryPressure?: "normal" | "elevated" | "high" | "critical" | string;
  memoryMessage?: string;
  memoryAvailableBytes?: number;
  memoryTotalBytes?: number;
  processMemoryBytes?: number;
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
  entriesChecked?: number;
  entryBudget?: number;
  timeBudgetMs?: number;
  truncated?: boolean;
  imageCount: number;
  videoCount: number;
  nonImageCount: number;
  excludedCount: number;
  excludedDirectoryCount: number;
  statErrorCount?: number;
  walkErrorCount?: number;
  transientErrorCount?: number;
  excludedSamples: Array<{ path: string; reason: string }>;
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
  storage?: {
    path: string;
    exists: boolean;
    isDirectory: boolean;
    isFile: boolean;
    mountRoot: string;
    fsType?: string;
    volumeKind: string;
    externalLikely: boolean;
    networkLikely: boolean;
    readable: boolean;
    traversable: boolean;
    sameVolumeAsWorkspace: boolean;
    totalBytes: number;
    freeBytes: number;
    warnings: string[];
  };
  estimate?: {
    detectorSize: number;
    imagesPerSecond: number;
    imageSeconds: number;
    videoSeconds: number;
    twoPassSeconds: number;
    totalSeconds: number;
    label: string;
    assumptions: string[];
  };
  plan?: ScanPlan;
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

export interface MediaBundleExportValue {
  bundlePath: string;
  manifestPath: string;
  csvPath: string;
  counts: {
    selected: number;
    copied: number;
    missing: number;
  };
}

export interface DuplicateCandidateGroup {
  sourcePath: string;
  sourceKey?: string;
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
  storageBudgetBytes?: number;
  storageOverBudgetBytes?: number;
  storageBudgetPercent?: number;
  workspaceFileCount: number;
  auditEvents: number;
  missingReferences: number;
  missingCandidates: number;
  missingMediaSources?: number;
  missingReferenceSamples?: Array<{ refId: string; personName: string; sourcePath: string; ageBucket?: string }>;
  missingCandidateSamples?: Array<{ candidateId: string; personName: string; sourcePath: string; status: CandidateStatus; score: number }>;
  missingMediaSourceSamples?: Array<{ candidateId: string; personName: string; mediaSourcePath: string; sourcePath: string }>;
  sourceFolders?: WorkspaceSourceFolder[];
  reviewedReadyToPurge: number;
  duplicateGroups: DuplicateCandidateGroup[];
  duplicateCandidateCount: number;
  databaseIntegrity?: DatabaseIntegrityResult;
  recommendations: string[];
}

export interface WorkspaceSourceFolder {
  folder: string;
  references: number;
  candidates: number;
  videos: number;
  missing: number;
  bytes: number;
}

export interface WorkspaceRepairResult {
  generatedAt: string;
  dryRun: boolean;
  force?: boolean;
  destructiveBlocked?: boolean;
  unavailableRoots?: string[];
  removedReferences: number;
  removedCandidates: number;
  referenceIds: string[];
  candidateIds: string[];
  before: WorkspaceHealth;
  after: WorkspaceHealth;
}

export interface WorkspaceRelinkResult {
  generatedAt: string;
  dryRun: boolean;
  forcePartial?: boolean;
  partialBlocked?: boolean;
  oldRoot: string;
  newRoot: string;
  relinkedReferences: number;
  relinkedCandidates: number;
  relinkedFields: number;
  relinkedScanRuns?: number;
  relinkedScanFiles?: number;
  missingTargets: Array<{ from: string; to: string }>;
  samples: Array<{ kind: string; from: string; to: string; personName: string }>;
}

export interface WorkspaceOptimizeResult {
  generatedAt: string;
  previewFilesRemoved: number;
  previewBytesRemoved: number;
  orphanVideoFramesRemoved: number;
  orphanVideoFrameBytesRemoved: number;
  dbBytesBefore: number;
  dbBytesAfter: number;
  dbBytesReclaimed: number;
  totalBytesReclaimed: number;
}

export interface DatabaseIntegrityResult {
  generatedAt: string;
  path: string;
  exists: boolean;
  ok: boolean;
  integrity: string[];
  foreignKeyErrors: Array<Record<string, unknown>>;
  tableCounts: Record<string, number>;
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
  error: string;
}

export interface DatabaseRepairResult {
  generatedAt: string;
  dryRun: boolean;
  confirmed: boolean;
  rebuilt: boolean;
  optimized: WorkspaceOptimizeResult | Record<string, number> | null;
  snapshot: {
    generatedAt: string;
    backupDir: string;
    files: Array<{ from: string; to: string; bytes: number }>;
    bytes: number;
  } | null;
  before: DatabaseIntegrityResult;
  after: DatabaseIntegrityResult;
  recommendations: string[];
}

export interface StorageBudgetEnforceResult {
  before: WorkspaceHealth;
  optimized: WorkspaceOptimizeResult | null;
  after: WorkspaceHealth;
  withinBudget: boolean;
  message: string;
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

export interface ScanHistoryExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    runs: number;
    processed: number;
    added: number;
    errors: number;
  };
}

export interface WorkspaceInventoryExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    references: number;
    candidates: number;
    sourceFolders: number;
  };
}

export interface AuditLogExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    events: number;
  };
}

export interface ConsentReceiptExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    references: number;
    candidates: number;
    people: number;
    pending: number;
    reviewed: number;
    scanRuns: number;
    consentEvents: number;
  };
}

export interface RetentionPolicyReport {
  generatedAt: string;
  counts: {
    candidates: number;
    reviewedCandidates: number;
    pendingCandidates: number;
    invalidDates: number;
    scanHistory: number;
    auditEvents: number;
    generatedFiles: number;
    generatedBytes: number;
  };
  byStatus: Record<CandidateStatus, number>;
  reviewedOlderThanDays: Record<string, number>;
  oldestReviewedAgeDays: number;
  policy: {
    recommendedReviewedRetentionDays: number;
    reviewedStatuses: CandidateStatus[];
    pendingRowsAreKept: boolean;
    originalMediaIsNeverDeleted: boolean;
  };
  recommendations: string[];
}

export interface SafeModeAuditExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    scanRuns: number;
    safetyCacheEntries: number;
    safeLabels: Record<string, number>;
    processed: number;
    safeFiltered: number;
    videoProtected: number;
    videoFrames: number;
    errors: number;
    added: number;
  };
}

export interface ModelDriftReport {
  generatedAt: string;
  currentModel: string;
  modelPack?: string;
  counts: {
    references: number;
    candidates: number;
    staleReferences: number;
    staleCandidates: number;
  };
  referenceModels: Record<string, number>;
  candidateModels: Record<string, number>;
  staleByStatus: Record<CandidateStatus, number>;
  samples: {
    references: Array<Record<string, unknown>>;
    candidates: Array<Record<string, unknown>>;
  };
  recommendations: string[];
}

export interface ReviewLedgerExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    candidates: number;
    decisionEvents: number;
    pending: number;
    accepted: number;
    rejected: number;
    uncertain: number;
  };
}

export interface ScanManifestPruneValue {
  generatedAt: string;
  keepRuns: number;
  runsBefore: number;
  filesBefore: number;
  runsDeleted: number;
  filesDeleted: number;
  runsAfter: number;
  filesAfter: number;
  scanHistoryBefore: number;
  scanHistoryAfter: number;
  scanHistoryDeleted: number;
  before: ScaleSummary;
  after: ScaleSummary;
}

export interface SupportBundleValue {
  zipPath: string;
  bytes: number;
  fileCount: number;
  includePaths: boolean;
}

export interface WorkspaceBackupPruneValue {
  generatedAt: string;
  keep: number;
  kept: number;
  deleted: number;
  deletedBytes: number;
  removedPaths: string[];
}

export interface WorkspaceBackupVerification {
  ok: boolean;
  zipPath: string;
  exists: boolean;
  bytes: number;
  fileCount: number;
  manifest: Record<string, unknown>;
  missingCoreFiles: string[];
  dangerousEntries: string[];
  corruptEntry: string;
  error: string;
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

export interface InstallerDiagnosticsResult extends RuntimeSelfTestResult {
  packagedBackend?: boolean;
}

export interface ModelIntegrityResult extends RuntimeSelfTestResult {}

export interface DuplicatePersonSuggestion {
  personA: string;
  personB: string;
  score: number;
  countA: number;
  countB: number;
  referenceA: {
    refId: string;
    personName: string;
    ageBucket: AgeBucket;
    sourcePath: string;
    previewUrl?: string;
    quality: number;
    modelName: string;
  };
  referenceB: {
    refId: string;
    personName: string;
    ageBucket: AgeBucket;
    sourcePath: string;
    previewUrl?: string;
    quality: number;
    modelName: string;
  };
  reason: string;
}

export interface DuplicatePeopleResult {
  generatedAt: string;
  threshold: number;
  peopleChecked: number;
  suggestions: DuplicatePersonSuggestion[];
}

export interface ReviewRulesApplyResult {
  checked: number;
  updated: number;
  rejectedLowScore: number;
  uncertainLowQuality: number;
  rejectedLowQualityVideo: number;
  unchanged: number;
  rules: ReviewRules & { qualityMinimum: number };
}

export interface ScaleSummary {
  dbPath: string;
  dbBytes: number;
  scanRuns: number;
  manifestFiles: number;
  safetyCacheEntries: number;
  embeddingCacheEntries?: number;
  reviewCandidateRows?: number;
  calibrationLabels: number;
  latestScan?: Record<string, unknown> | null;
}

export interface CalibrationSummary {
  totalLabels: number;
  matchLabels: number;
  positivePairs: number;
  negativePairs: number;
  minPositiveScore?: number | null;
  maxNegativeScore?: number | null;
  recommendedLikelyThreshold?: number | null;
  safeLabels: Record<string, number>;
  falseMatchBlocks?: number;
}

export interface AccuracyBucket {
  threshold: number;
  labeled: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  specificity: number;
}

export interface AccuracyEvaluation {
  generatedAt: string;
  thresholds: Record<string, number>;
  metrics: Record<string, AccuracyBucket>;
  segments: Record<string, AccuracyBucket>;
  recommendations: string[];
}

export interface AccuracyLabelsExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    labels: number;
    matches: number;
    nonMatches: number;
  };
}

export interface AccuracyLabelsImportValue {
  imported: number;
  skipped: number;
  summary: CalibrationSummary;
}

export interface CandidateQueryResult {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  items: ReviewCandidate[];
  index?: "sqlite" | "memory";
}

export interface ScanJobStatus {
  cancelRequested: boolean;
  paused: boolean;
  cancelPath: string;
  pausePath: string;
  latestScan?: Record<string, unknown> | null;
  active?: boolean;
  canResume?: boolean;
  progressLabel?: string;
  recommendedAction?: string;
}

export interface ScanPlan {
  mode: string;
  mediaCount: number;
  estimatedTotalSeconds: number;
  estimatedWorkspaceBytes: number;
  sourceBytes: number;
  storage?: {
    volumeKind: string;
    mountRoot: string;
    externalLikely: boolean;
    networkLikely: boolean;
    sameVolumeAsWorkspace: boolean;
    freeBytes: number;
  };
  resumable: boolean;
  safeMode: boolean;
  twoPass: boolean;
  cache: {
    safetyEntries: number;
    embeddingEntries: number;
    manifestFiles: number;
  };
  stages: string[];
  warnings: string[];
  recommendedAction: string;
}

export interface PrivacyReport {
  generatedAt: string;
  references: number;
  candidates: number;
  scanHistory: number;
  generatedFiles: number;
  generatedBytes: number;
  safetyCacheEntries: number;
  embeddingCacheEntries: number;
  calibrationLabels: number;
  auditEvents: number;
  recommendations: string[];
}

export interface DeleteFaceDataResult {
  before: PrivacyReport;
  after: PrivacyReport;
  dbDeleted: Record<string, number>;
}

export interface VideoMoment {
  mediaSourcePath: string;
  candidateIds: string[];
  people: string[];
  statuses: CandidateStatus[];
  count: number;
  bestScore: number;
  firstTimestampMs?: number | null;
  lastTimestampMs?: number | null;
  previewPath?: string | null;
  previewUrl?: string;
}

export interface ReviewInsights {
  pending: number;
  confidentPending: number;
  videoPending: number;
  imagePending: number;
  topFolders: Array<{ folder: string; count: number }>;
  recommendedOrder: string;
}

export interface RuntimeBenchmarkResult {
  runId: string;
  generatedAt: string;
  durationMs: number;
  vectorBackend: string;
  performanceTier?: string;
  performanceMode?: string;
  effectivePerformanceMode?: string;
  resourceStatus?: {
    memoryPressure?: string;
    memoryMessage?: string;
    memoryAvailableBytes?: number;
    memoryTotalBytes?: number;
    processMemoryBytes?: number;
  };
  vectorAddPerSecond: number;
  vectorSearchP50MsEstimate: number;
  stateSerializeMs: number;
  stateCandidateWindow?: Record<string, unknown>;
  scale: ScaleSummary;
  storageIo?: StorageIoBenchmarkResult;
  recommendations: string[];
}

export interface StorageIoBenchmarkResult {
  generatedAt: string;
  path: string;
  sizeBytes: number;
  ok: boolean;
  writeMs: number;
  readMs: number;
  writeMBps: number;
  readMBps: number;
  fsyncMs: number;
  storage: FolderAnalysis["storage"];
  error: string;
  recommendations: string[];
}

export interface ReleaseReadinessResult {
  generatedAt: string;
  ok: boolean;
  checks: RuntimeSelfTestCheck[];
  recommendations: string[];
}

export interface ModelDistributionItem {
  kind: string;
  id: string;
  name: string;
  source: string;
  url: string;
  filename: string;
  sha256: string;
  sizeBytes: number;
  license: string;
  licenseState: "declared" | "missing" | "needs-review" | string;
  installed: boolean;
  archivePath: string;
  installedPath: string;
  redistributionReady: boolean;
}

export interface ModelDistributionAudit {
  generatedAt: string;
  ok: boolean;
  items: ModelDistributionItem[];
  blockers: ModelDistributionItem[];
  recommendations: string[];
}

export interface AppState {
  version: string;
  buildInfo?: BuildInfo;
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
  benchmarkHistory?: RuntimeBenchmarkResult[];
  scale?: ScaleSummary;
  calibration?: CalibrationSummary;
  scanJob?: ScanJobStatus;
  videoMoments?: VideoMoment[];
  reviewInsights?: ReviewInsights;
  config: AppConfig;
  safeModeModel?: SafeModeModelReport;
  modelSetup?: ModelSetupReport;
  references: ReferenceFace[];
  candidates: ReviewCandidate[];
  candidateWindow?: {
    limit: number;
    returned: number;
    total: number;
    truncated: boolean;
    index?: "sqlite" | "memory";
  };
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
  phase: "started" | "processing" | "protected" | "candidate" | "processed" | "clustering" | "verifying" | "verified" | "paused" | "error" | "complete" | "cancelled";
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
  mode?: string;
  sweeping?: boolean;
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

export interface SystemPhotoSource {
  id: string;
  label: string;
  detail: string;
  path: string;
  kind: string;
  platform: string;
  available: boolean;
}

export interface WorkspaceLockStatus {
  supported: boolean;
  enabled: boolean;
  locked: boolean;
  workspace: string;
  lockPath: string;
  usingOsKeychain: boolean;
  message: string;
}

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export type UpdateChannel = "stable" | "beta" | "internal";

export interface UpdateStatus {
  supported: boolean;
  canCheck: boolean;
  checking: boolean;
  downloading: boolean;
  available: boolean;
  downloaded: boolean;
  appVersion: string;
  latestVersion: string | null;
  progress: UpdateProgress | null;
  error: string | null;
  provider: string;
  channel: UpdateChannel;
  message: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  privacy: {
    includesPhotos: boolean;
    includesFaceEmbeddings: boolean;
    includesFilePaths: boolean;
    sharing: string;
  };
  app: {
    name: string;
    version: string;
    packaged: boolean;
    dev: boolean;
    platform: string;
    arch: string;
    electron?: string;
    chrome?: string;
    node?: string;
  };
  updater: UpdateStatus;
  backend: {
    running: boolean;
    ready: boolean;
    pendingCommands: number;
  };
  workspace: Record<string, unknown> | null;
  diagnostics: {
    eventCount: number;
    logPath: string;
    summary?: {
      byCode: Record<string, number>;
      byCategory: Record<string, number>;
      bySeverity: Record<string, number>;
      latestFailureCode: string;
      latestFailureAt: string;
      topFingerprints: Array<{
        fingerprint: string;
        code: string;
        type: string;
        message: string;
        count: number;
        latestAt: string;
      }>;
    };
    events: Array<Record<string, unknown>>;
  };
}

export interface DiagnosticsExportResult {
  cancelled: boolean;
  path: string | null;
  report: DiagnosticsReport;
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
  cancelScan(): Promise<{ cancelled: boolean; path: string }>;
  pauseScan(): Promise<{ paused: boolean; path: string }>;
  resumeScan(): Promise<{ paused: boolean; path: string }>;
  getScanMarkerStatus(): Promise<{ workspace: string; cancelRequested: boolean; paused: boolean; cancelPath: string; pausePath: string }>;
  startFolderWatch(folder: string): Promise<FolderWatchStatus>;
  stopFolderWatch(): Promise<FolderWatchStatus>;
  getSystemIntegration(): Promise<SystemIntegration>;
  setLaunchAtLogin(openAtLogin: boolean): Promise<SystemIntegration>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  setUpdateChannel(channel: UpdateChannel): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<UpdateStatus>;
  getDiagnosticsReport(includePaths?: boolean): Promise<DiagnosticsReport>;
  exportDiagnosticsReport(includePaths?: boolean): Promise<DiagnosticsExportResult>;
  recordDiagnosticEvent(event: Record<string, unknown>): Promise<boolean>;
  getPhotoSources(): Promise<SystemPhotoSource[]>;
  getWorkspaceLockStatus(): Promise<WorkspaceLockStatus>;
  enableWorkspaceLock(): Promise<WorkspaceLockStatus>;
  lockWorkspace(): Promise<WorkspaceLockStatus>;
  unlockWorkspace(): Promise<WorkspaceLockStatus>;
  disableWorkspaceLock(): Promise<WorkspaceLockStatus>;
  revealPath(path: string): Promise<boolean>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  writeClipboardText(text: string): Promise<boolean>;
  getInitialState(): Promise<AppState>;
  rendererReady(): Promise<boolean>;
  setAppLanguage(language: string): Promise<boolean>;
  onAppCommand(callback: (command: AppCommand) => void): () => void;
  onExternalOpen(callback: (payload: ExternalOpenPayload) => void): () => void;
  onScanProgress(callback: (event: ScanProgressEvent | ModelDownloadProgressEvent) => void): () => void;
  onBackendStartup(callback: (event: BackendStartupEvent) => void): () => void;
  onFolderWatch(callback: (status: FolderWatchStatus) => void): () => void;
  onBackendError(callback: (message: string) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  onDiagnosticsEvent(callback: (event: Record<string, unknown>) => void): () => void;
  platform: string;
  testCamera?: boolean;
}

declare global {
  interface Window {
    crossAge: CrossAgeApi;
  }
}

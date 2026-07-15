export type AgeBucket = "child" | "adolescent" | "adult" | "older-adult" | "senior" | "unknown";
export type CandidateStatus = "pending" | "accepted" | "rejected" | "uncertain";
export type LearningMode = "off" | "manual" | "auto_stage";
export type ExtensibleStringUnion<T extends string> = T | (string & Record<never, never>);

export interface PlatformReport {
  platform_key: string;
  system: string;
  machine: string;
  python_arch: string;
  rosetta_translated: boolean;
  onnxruntime_available: boolean;
  available_providers: string[];
  selected_providers: string[];
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

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  severity: ExtensibleStringUnion<"blocker" | "warning" | "info">;
  detail: string;
  value?: unknown;
}

export interface ScanReadiness {
  generatedAt: string;
  ready: boolean;
  status: ExtensibleStringUnion<"pass" | "warn" | "fail">;
  largeScan: boolean;
  checks: ReadinessCheck[];
  blockers: string[];
  warnings: string[];
  estimatedTotalSeconds: number;
  estimatedWorkspaceBytes: number;
  mediaCount: number;
  recommendedAction: string;
}

export interface VideoDecoderConfig {
  ffmpegPath: string;
  ffprobePath: string;
}

export interface VideoDecoderReport {
  extensions: string[];
  opencvAvailable: boolean;
  ffmpegAvailable: boolean;
  ffprobeAvailable?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  ffmpegSource?: string;
  ffprobeSource?: string;
  managedPackage?: string;
  managedPackageAvailable?: boolean;
  configuredFfmpegPath?: string;
  configuredFfprobePath?: string;
  backend: string;
  probeLimited?: boolean;
  fallbackOrder?: string[];
  licenseNote?: string;
  recommendations?: string[];
}

// Safe Mode Stage-2 explainer ("why was this flagged?"). The optional NudeNet/
// Freepik model returns body-part detections; `safeModeExplain` reports whether it
// is installed. See crossage_fr/ingest/safety_explain.py.
export interface ExplainDetection {
  label: string;
  score: number;
  box: [number, number, number, number]; // normalized x, y, w, h in [0, 1]
}
export interface ExplainSafetyResult {
  available: boolean;
  detections: ExplainDetection[];
  reason: string;
}
export interface SafeModeExplainReport {
  available: boolean;
  modelName?: string | null;
  path?: string | null;
  license?: string;
  source?: string;
  reason?: string;
  classes?: string[];
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
  learningMode?: ExtensibleStringUnion<LearningMode>;
  effectivePerformanceMode?: string;
  effectiveFaceDetectorSize?: number;
  effectiveTwoPassScan?: boolean;
  effectiveVerificationDetectorSize?: number;
  perSubjectConsent?: boolean;
  jurisdictionPreset?: string;
  retentionReviewedDays?: number;
  retentionPendingDays?: number;
  retentionAuditDays?: number;
  retentionEnforcementEnabled?: boolean;
  safeMode: boolean;
  safeModeMultimodal?: boolean;
  safeModeZeroAdmittance?: boolean;
  safeModeThreshold: number;
  safeModeProfile?: string;
  safeModeProfiles?: Record<string, number>;
  safeModeTemperature?: number;
  storageBudgetBytes: number;
  maxMediaFileBytes: number;
  videoDecoder?: VideoDecoderConfig;
  reviewRules: ReviewRules;
  scanExclusions: ScanExclusions;
  reviewOnly: boolean;
  requireConsent: boolean;
}

export interface ConsentSummary {
  active: boolean;
  recorded?: boolean;
  operator: string;
  source: string;
  scope: string;
  confirmedAt?: string | null;
  updatedAt?: string | null;
  perSubjectConsent?: boolean;
  subjectCount?: number;
  activeSubjectCount?: number;
  validSubjectCount?: number;
  jurisdictionPreset?: string;
  aiDisclosure?: AiDisclosureStatus;
}

export interface AiDisclosureNotice {
  version: string;
  title: string;
  summary: string;
  decisionBoundary: string;
  dataFlow: string;
  generatedContent: string;
  notUsedFor: string[];
  legalBasis: string;
  source: string;
}

export interface AiDisclosureStatus {
  version: string;
  acknowledged: boolean;
  acknowledgedAt?: string | null;
  operator: string;
  notice: AiDisclosureNotice;
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
  categoryAware?: boolean;
  multimodalEnabled?: boolean;
  categories?: string[];
  policyVersion?: string;
  modelTier?: string;
  modelRevision?: string;
  offlineInference?: boolean;
  humanReviewRequired?: boolean;
  csamHashMatching?: boolean;
  cacheVersion?: string;
  fallback?: SafeModeModelReport;
  multimodal?: SafeModeModelReport;
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
  role?: string;
  pose_aware?: boolean;
  embedding_space?: string;
  license_tier?: string;
  thresholds?: Record<string, number>;
  recommended_for?: string[];
  governance?: ModelGovernance;
}

export interface ModelGovernance {
  accuracyTier: string;
  intendedUse: string;
  humanReviewRequired: boolean;
  redistributionRisk: string;
  limitations: string[];
  validation: string[];
}

export interface ModelSetupReport {
  ready: boolean;
  fallbackActive: boolean;
  currentPack: string;
  modelRoot: string;
  defaultRoot: string;
  engine: string;
  engineDetail: string;
  fallbackReason: string;
  governance?: ModelGovernance;
  packages: ModelPackageStatus[];
  offlineMessage: string;
  recommendation: string;
}

export interface ModelCompatibilityReport {
  activeModelName: string;
  compatibleReferences: number;
  otherModelReferences: number;
  totalReferences: number;
  modelCounts: Record<string, number>;
  needsBackfill: boolean;
  message: string;
}

export interface ModelSwitchDryRun {
  targetPack: string;
  targetLabel: string;
  targetModelName: string;
  currentPack: string;
  currentModelName: string;
  modelRoot: string;
  installed: boolean;
  safeToSave: boolean;
  willResetEngine: boolean;
  poseAware: boolean;
  downloadBytes: number;
  installedBytes: number;
  estimatedDiskImpactBytes: number;
  estimatedBackfillSeconds: number;
  totalReferences: number;
  compatibleReferences: number;
  referencesNeedingBackfill: number;
  currentCompatibleReferences: number;
  affectedCandidates: number;
  rollbackPack: string;
  thresholds: Record<string, number>;
  blockers: string[];
  warnings: string[];
  actions: string[];
  summary: string;
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
  phase: ExtensibleStringUnion<"starting" | "downloading" | "verifying" | "extracting" | "complete" | "error">;
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
  poseBucket?: string;
  createdAt: string;
  referenceKind?: "real" | "synthetic-age-trajectory";
  syntheticMethodVersion?: string;
  syntheticTargetAgeBucket?: AgeBucket | "";
  parentRefIds?: string[];
  syntheticScreenScore?: number | null;
  syntheticScreenOriginalScore?: number | null;
  syntheticScreenRecompressedScore?: number | null;
  syntheticScreenThreshold?: number | null;
  syntheticScreenModelId?: string;
  syntheticScreenModelVersion?: string;
  syntheticScreenReviewed?: boolean;
  syntheticScreenHumanOverride?: boolean;
}

export interface AgeTrajectoryResult {
  personName: string;
  methodVersion: string;
  realReferences: number;
  syntheticReferences: number;
  realAgeBuckets: string[];
  targetAgeBuckets: string[];
  eligible: boolean;
  consentActive: boolean;
  imageMethodVersion?: string;
  embeddingReferences?: number;
  generatedImageReferences?: number;
  generatedImages: boolean;
  externalAgingWeights: boolean;
  added?: number;
  retained?: number;
  removed?: number;
}

export interface AgeReferenceGroup {
  ageBucket: AgeBucket;
  folder: string;
}

export interface CameraSaveResult {
  folder: string;
  filePath: string;
}

export interface WorkspaceListItem {
  workspaceId: string;
  path: string;
  alias: string;
  lastOpenedAt: string;
  active: boolean;
  available: boolean;
}

export interface ReviewCandidate {
  candidateId: string;
  sourcePath: string;
  sourceUrl?: string;
  previewPath?: string | null;
  previewUrl?: string;
  mediaKind?: ExtensibleStringUnion<"image" | "video">;
  mediaSourcePath?: string;
  mediaSourceUrl?: string;
  videoTimestampMs?: number | null;
  videoFrameIndex?: number | null;
  videoDurationMs?: number | null;
  videoTrackId?: string;
  videoTrackVersion?: string;
  videoTrackStartMs?: number | null;
  videoTrackEndMs?: number | null;
  videoTrackFrameCount?: number;
  videoTrackKeyframeTimestampsMs?: number[];
  videoTrackKeyframeIndices?: number[];
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
  poseBucket?: string;
  status: CandidateStatus;
  note: string;
  riskFlags?: string[];
  reviewPriority?: number;
  reviewLane?: ExtensibleStringUnion<"surface" | "review" | "low-information">;
  reviewMoreProvenance?: {
    kind?: string;
    score?: number;
    quality?: number;
    band?: string;
    status?: string;
    personName?: string;
    bestRefId?: string | null;
    bestRefPath?: string | null;
    reason?: string;
    [key: string]: unknown;
  } | null;
  createdAt: string;
  captureDate?: string | null;
  referenceCaptureDate?: string | null;
  ageGapYears?: number | null;
  ageGapConfidence?: string | null;
  captureDateProvenance?: string | null;
  referenceCaptureDateProvenance?: string | null;
}

// Photos tab: browse photos as folders. A PhotoFolder is "All Photos", a custom
// album, one enrolled person, or an auto-clustered "Unknown Person N" group.
// PhotoItem is a single tile; *Url fields are added by main.cjs decorateState
// (the backend returns only paths).
export type PhotoSmartQueryGroupOp = "all" | "any";

export interface PhotoSmartQueryClause {
  field: string;
  operator: string;
  value?: string | number | boolean | string[] | number[] | boolean[];
}

export interface PhotoSmartQueryGroup {
  op: PhotoSmartQueryGroupOp;
  conditions: PhotoSmartQueryNode[];
}

export type PhotoSmartQueryNode = PhotoSmartQueryClause | PhotoSmartQueryGroup;

export interface PhotoAlbumRules {
  statuses?: CandidateStatus[];
  mediaKind?: ExtensibleStringUnion<"image" | "video">;
  query?: string;
  keyword?: string;
  dateFrom?: string;
  dateTo?: string;
  folder?: string;
  minScore?: number;
  minQuality?: number;
  favoriteOnly?: boolean;
  editedOnly?: boolean;
  hasVideoFrames?: boolean;
  unknownOnly?: boolean;
  recentDays?: number;
  queryDsl?: PhotoSmartQueryGroup;
  op?: PhotoSmartQueryGroupOp;
  conditions?: PhotoSmartQueryNode[];
}

export interface PhotoAlbumValidation {
  code: string;
  message: string;
}

export interface PhotoAlbumPreviewValue {
  count: number;
  ruleSummary: string[];
  validation: PhotoAlbumValidation[];
  previewSamples: string[];
}

export interface PhotoSmartAlbumMigrationAlbum {
  albumId: string;
  name: string;
  albumKind: string;
  needsMigration: boolean;
  migrated: boolean;
  beforeCount: number;
  afterCount: number;
  countDelta: number;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  ruleSummary: string[];
  validation: PhotoAlbumValidation[];
}

export interface PhotoSmartAlbumMigrationValue {
  dryRun: boolean;
  requested: number;
  eligible: number;
  migrated: number;
  albums: PhotoSmartAlbumMigrationAlbum[];
}

export interface PhotoPersonProfile {
  personName: string;
  keyAssetId: string;
  keyAssetCrop?: PhotoCoverCrop;
  favorite: boolean;
  hidden: boolean;
  manualOrder?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoCoverCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PhotoPlace {
  placeId: string;
  name: string;
  label?: string;
  latitude?: number | null;
  longitude?: number | null;
  count: number;
  coverAssetId?: string;
  coverSourcePath?: string;
  source?: ExtensibleStringUnion<"user" | "exif">;
  assetIds?: string[];
  placeProfile?: PhotoPlaceProfile;
}

export interface PhotoReverseGeocodeResult {
  ok: boolean;
  pending?: boolean;
  blocked?: boolean;
  reason?: string;
  message?: string;
  label?: string;
  latitude?: string;
  longitude?: string;
  provider?: string;
  attribution?: string;
  cached?: boolean;
  applied?: boolean;
  updated?: number;
  skipped?: number;
  skippedReasons?: Record<string, number>;
  items?: Array<Partial<PhotoItem> & Record<string, unknown>>;
  operation?: PhotoOperation | Record<string, unknown>;
}

export interface PhotoPlaceProfile {
  placeId: string;
  keyAssetId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoUtilityProfile {
  utilityId: string;
  keyAssetId: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoTrip {
  tripId: string;
  name: string;
  count: number;
  startDate: string;
  endDate: string;
  dateRangeLabel: string;
  locationLabel?: string;
  locationLabels?: string[];
  latitude?: number;
  longitude?: number;
  movementKm?: number;
  coverSourcePath?: string;
  coverPreviewPath?: string | null;
  sourcePaths?: string[];
}

export interface PhotoMemoryMovieSettings {
  theme?: string;
  themeTimelinePreset?: string;
  themeTemplateName?: string;
  themeTemplatePalette?: string;
  themeTemplateTypography?: string;
  themeTemplateBackdrop?: string;
  themeTemplateLayout?: string;
  themeTemplateBackdropIntensity?: number;
  themeTemplateStageWidth?: number;
  themeTemplateFrameStyle?: string;
  themeTemplateChromeDensity?: string;
  themeTemplateCaptionPreset?: string;
  themeTemplateRegionMap?: PhotoSlideshowTemplateRegionMapValue;
  music?: string;
  musicPath?: string;
  audioPath?: string;
  audioVolume?: number;
  audioFadeMs?: number;
  audioStartMs?: number;
  audioEndMs?: number;
  audioPlacementStartSourcePath?: string;
  audioPlacementEndSourcePath?: string;
  includeTitleCard?: boolean;
  titleCardTitle?: string;
  titleCardSubtitle?: string;
  titleCardDurationMs?: number;
  titleCardPalette?: string;
  titleCardLayout?: string;
  titleCardFontScale?: string;
  titleCardShowFooter?: boolean;
  transitionEffect?: string;
  transitionDurationMs?: number;
  intervalMs?: number;
  fitMode?: string;
}

export interface PhotoMemory {
  memoryId: string;
  category: string;
  name: string;
  subtitle?: string;
  count: number;
  rawCount?: number;
  startDate?: string;
  endDate?: string;
  dateRangeLabel?: string;
  coverSourcePath?: string;
  coverPreviewPath?: string | null;
  sourcePaths?: string[];
  favorite?: boolean;
  hidden?: boolean;
  removedSourceCount?: number;
  userCreated?: boolean;
  createdAt?: string;
  updatedAt?: string;
  sortHint?: string;
  movieSettings?: PhotoMemoryMovieSettings;
}

export type PhotoStoryStyle = "journal" | "concise" | "cinematic";

export interface PhotoStoryCaption {
  assetId: string;
  text: string;
  source: string;
}

export interface PhotoStoryChapter {
  id: string;
  title: string;
  narrative: string;
  sourceAssetIds: string[];
  captions: PhotoStoryCaption[];
}

export interface PhotoStoryHistoryItem {
  versionId: string;
  savedAt: string;
  label: string;
  contentSha256: string;
}

export interface PhotoStoryGeneration {
  schemaVersion: number;
  generatorVersion: string;
  generatedAt: string;
  inputSha256: string;
  generatedContentSha256: string;
  seed: number;
  offline: boolean;
  humanReviewRequired: boolean;
  elapsedMs?: number;
  model?: Record<string, unknown>;
  route?: { requested?: string; tier?: string; reason?: string; totalMemoryBytes?: number };
  usage?: Record<string, unknown>;
  sourceManifest?: Array<{ assetId: string; contentHash: string; captionSha256: string; captionSource: string }>;
  sourceSelection?: { available: number; selected: number; omitted: number };
}

export interface PhotoStory {
  id: string;
  sourceMemoryId: string;
  title: string;
  subtitle: string;
  style: PhotoStoryStyle;
  sourceAssetIds: string[];
  coverAssetId?: string;
  chapters: PhotoStoryChapter[];
  generation: PhotoStoryGeneration;
  revision: number;
  history: PhotoStoryHistoryItem[];
  currentContentSha256: string;
  humanEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoStoryStatus {
  available: boolean;
  offline: boolean;
  privacyDefault: string;
  generatorVersion: string;
  maxAssets: number;
  styles: PhotoStoryStyle[];
  preference: string;
  powerMode: string;
  route?: { available?: boolean; tier?: string; reason?: string };
  reason: string;
}

export interface PhotoStoryExportValue {
  storyId: string;
  markdownPath: string;
  jsonPath: string;
  generatedAt: string;
  contentSha256: string;
  markdownSha256: string;
  jsonSha256: string;
  pathFree: boolean;
  offline: boolean;
}

export interface PhotoImportSession {
  importId: string;
  sourceKind: ExtensibleStringUnion<"folder" | "camera" | "phone" | "library" | "app" | "mail" | "safari" | "messages" | "airdrop" | "downloads" | "other">;
  storageMode: ExtensibleStringUnion<"referenced" | "managed">;
  sourceLabel: string;
  sourceDetail?: string;
  rootPath: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
  importedCount: number;
  failedCount: number;
  archived?: boolean;
  archivedAt?: string;
  archivedReason?: string;
  metadata?: Record<string, unknown>;
}

export interface PhotoImportSessionProvenanceUpdateValue {
  importId: string;
  session: PhotoImportSession;
  updatedAssets: number;
  previous?: {
    sourceKind?: string;
    sourceLabel?: string;
    sourceDetail?: string;
  };
}

export interface PhotoImportSessionArchiveUpdateValue {
  importIds: string[];
  sessions: PhotoImportSession[];
  changed: number;
  missing: string[];
  archived: boolean;
  reason?: string;
}

export interface PhotoImportFailure {
  failureId?: string;
  importId?: string;
  sourcePath: string;
  sourceName?: string;
  targetPath?: string;
  reason: string;
  recoveredPath?: string;
  recoveredName?: string;
  createdAt?: string;
  dismissedAt?: string;
  importSession?: PhotoImportSession | null;
}

export interface PhotoImportWarning {
  code: string;
  message: string;
}

export interface SharePathsResult {
  ok: boolean;
  supported: boolean;
  shared: boolean;
  count: number;
  filePaths?: string[];
  fallback?: "reveal";
  fallbackPath?: string;
  fallbackDirectory?: string;
  error?: string;
}

export interface ExternalEditorFavorite {
  editorPath: string;
  label: string;
  lastUsedAt?: string;
  useCount?: number;
}

export interface ExternalEditorFavoritesResult {
  ok: boolean;
  editors: ExternalEditorFavorite[];
  error?: string;
}

export interface OpenPathWithResult {
  ok: boolean;
  supported: boolean;
  opened: boolean;
  path?: string;
  editorPath?: string;
  editors?: ExternalEditorFavorite[];
  canceled?: boolean;
  error?: string;
}

export interface PrintPathResult {
  ok: boolean;
  supported: boolean;
  printed: boolean;
  path?: string;
  error?: string;
}

export interface ClipboardImagePathResult {
  ok: boolean;
  path: string;
  error?: string;
}

export interface FileDragResult {
  ok: boolean;
  path: string;
  error?: string;
}

export interface PhotoSensitiveAuthStatus {
  supported: boolean;
  available: boolean;
  platform: string;
  method: string;
  reason?: string;
}

export interface PhotoSensitiveAuthResult extends PhotoSensitiveAuthStatus {
  ok: boolean;
  canceled?: boolean;
  error?: string;
}

export interface PhotoManagedRootPolicy {
  keepFolderOrganizationDefault: boolean;
  externalBackupCovered: boolean;
  externalBackupLabel: string;
  externalBackupCheckedAt: string;
}

export interface PhotoRootPolicyWarning {
  kind: ExtensibleStringUnion<"duplicate" | "overlap" | "symlink" | "nested" | "multiple">;
  severity?: ExtensibleStringUnion<"info" | "warning" | "error">;
  message: string;
  action?: string;
  relatedPath?: string;
  relatedName?: string;
}

export interface PhotoRootConflictDiagnostics {
  rootConflict?: boolean;
  rootConflictKind?: ExtensibleStringUnion<"duplicate" | "symlink_alias" | "nested" | "multiple">;
  rootConflictMessage?: string;
  rootConflictMessages?: string[];
  rootConflictWith?: Array<{
    profileId?: string;
    name?: string;
    path: string;
    kind: ExtensibleStringUnion<"managed" | "library">;
    conflictKind?: string;
  }>;
  policyWarnings?: PhotoRootPolicyWarning[];
  policyStatus?: ExtensibleStringUnion<"ready" | "warning" | "attention">;
}

export interface PhotoManagedRootProfile extends PhotoRootConflictDiagnostics {
  profileId: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
  builtIn?: boolean;
  policy?: PhotoManagedRootPolicy;
}

export interface PhotoLibraryRootProfile extends PhotoRootConflictDiagnostics {
  profileId: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
  builtIn?: boolean;
  assetCount?: number;
  exists?: boolean;
  isDirectory?: boolean;
  issue?: string;
}

export interface PhotoRootPolicyStatus {
  status: ExtensibleStringUnion<"ready" | "warning" | "attention">;
  counts: {
    rootsWithConflicts: number;
    duplicates: number;
    symlinkAliases: number;
    overlaps: number;
    multiple: number;
    [key: string]: number;
  };
  issues: Array<{
    rootKey: string;
    kind: string;
    message: string;
    relatedRoots?: PhotoRootConflictDiagnostics["rootConflictWith"];
    policyWarnings?: PhotoRootPolicyWarning[];
  }>;
  recommendations: string[];
}

export interface PhotoBackupPolicy {
  enabled: boolean;
  autoCheckOnOpen: boolean;
  intervalHours: number;
  includeGenerated: boolean;
  warnOnReferencedOriginals: boolean;
  warnOnExternalManagedRoots: boolean;
  lastCheckedAt: string;
  lastOkAt: string;
  lastStatus: ExtensibleStringUnion<"never" | "ready" | "warning" | "attention" | "disabled">;
  lastBackupPath: string;
  lastSummary: string;
}

export interface PhotoBackupPolicyStatus {
  generatedAt: string;
  enabled: boolean;
  autoCheckOnOpen: boolean;
  due: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention" | "disabled">;
  intervalHours: number;
  lastCheckedAt: string;
  lastOkAt: string;
  nextCheckAt: string;
  latestBackup: {
    exists: boolean;
    zipPath: string;
    fileName: string;
    bytes: number;
    modifiedAt: string;
  };
  rootCoverage: Array<PhotoRootConflictDiagnostics & {
    profileId: string;
    name: string;
    path: string;
    isDefault: boolean;
    builtIn: boolean;
    insideWorkspace: boolean;
    assetCount: number;
    requiresExternalBackup: boolean;
    externalBackupCovered?: boolean;
    externalBackupLabel?: string;
    externalBackupCheckedAt?: string;
    policy?: PhotoManagedRootPolicy;
    exists?: boolean;
    isDirectory?: boolean;
    writable?: boolean;
    creatable?: boolean;
    issue?: string;
  }>;
  counts: {
    managedAssets: number;
    externalManagedAssets: number;
    referencedAssets: number;
    assetsRequiringExternalBackup: number;
    managedRootProfileIssues: number;
    managedAssetsOutsideProfiles: number;
    [key: string]: number;
  };
  policy: PhotoBackupPolicy;
  recommendations: string[];
}

export interface PhotoLibrarySettingsValue {
  defaultStorageMode: ExtensibleStringUnion<"referenced" | "managed">;
  defaultManagedRoot: string;
  defaultManagedRootPersisted?: boolean;
  workspaceDefaultManagedRoot?: string;
  activeLibraryRoot?: string;
  activeLibraryRootProfileId?: string;
  managedRoots: PhotoManagedRootProfile[];
  libraryRoots?: PhotoLibraryRootProfile[];
  localSettings?: Record<string, unknown>;
  localSettingsPersisted?: boolean;
  petRecognitionStatus?: PhotoPetRecognitionStatus;
  rootPolicyStatus?: PhotoRootPolicyStatus;
  backupPolicy?: PhotoBackupPolicy;
  backupPolicyStatus?: PhotoBackupPolicyStatus;
  updatedAt?: string;
}

export interface PhotoPetRecognitionStatus {
  generatedAt: string;
  status: ExtensibleStringUnion<"metadata_only" | "model_requested_unavailable" | "local_intelligence_disabled">;
  metadataBacked: boolean;
  localIntelligenceEnabled: boolean;
  noNetwork: boolean;
  modelRequested: boolean;
  modelAvailable: boolean;
  modelEnabled: boolean;
  summary: string;
  sources: string[];
  blockers: string[];
  nextActions: string[];
}

export interface PhotoCurationPreferencesValue {
  featureLessPeople: string[];
  featureLessPlaces: string[];
  featureLessDates: string[];
  featureLessContent: string[];
  favoriteMemories: string[];
  hiddenMemories: string[];
  memoryRemovedItems: Record<string, string[]>;
  updatedAt?: string;
}

export interface PhotoImportResult {
  importId: string;
  storageMode: ExtensibleStringUnion<"referenced" | "managed">;
  sourceKind: ExtensibleStringUnion<"folder" | "camera" | "phone" | "library" | "app" | "mail" | "safari" | "messages" | "airdrop" | "downloads" | "other">;
  sourceLabel: string;
  sourceDetail?: string;
  rootPath: string;
  managedRoot?: string;
  keepFolderOrganization?: boolean;
  keepFolderOrganizationSource?: ExtensibleStringUnion<"explicit" | "root-default" | "off">;
  deleteFromSourceAfterImport?: boolean;
  deleteFromSourceSupported?: boolean;
  pairedMotionCopiedCount?: number;
  pairedMotionPaths?: string[];
  relatedMediaCopiedCount?: number;
  relatedMediaPaths?: string[];
  importedCount: number;
  failedCount: number;
  duplicateInputs?: number;
  session?: PhotoImportSession | null;
  assets?: PhotoAsset[];
  sourcePaths?: string[];
  importedPaths?: string[];
  failures?: PhotoImportFailure[];
  warnings?: PhotoImportWarning[];
}

export type RemotePhotoSourceProvider = "slack" | "web" | "google_drive" | "onedrive" | "dropbox" | "webdav";
export type DamPhotoSourceProvider = "lightroom_catalog" | "capture_one_catalog";
export type PhotoSourceProvider = "apple_photos" | "windows_folders" | DamPhotoSourceProvider | RemotePhotoSourceProvider;

export interface OpenPhotoCatalogStatus {
  format: string;
  formatVersion: number;
  extension: string;
  container: string;
  catalogEncoding: string;
  mediaEncoding: string;
  checksums: string;
  encrypted: boolean;
  pathFree: boolean;
  networkAccess: string;
  portableEntities: string[];
  portablePreferences: string[];
  excluded: string[];
  counts: Record<string, number>;
}

export interface OpenPhotoCatalogInspection {
  format: string;
  formatVersion: number;
  catalogId: string;
  generatedAt: string;
  mediaPolicy: ExtensibleStringUnion<"full" | "catalog-only">;
  includeSidecars: boolean;
  pathFree: boolean;
  encrypted: boolean;
  counts: Record<string, number>;
  members: number;
  verifiedFiles: number;
  verifiedBytes: number;
  mediaVerificationDeferred: number;
  fullyVerified: boolean;
  catalogPath: string;
  warnings: PhotoImportWarning[];
}

export interface OpenPhotoCatalogExportResult {
  format: string;
  formatVersion: number;
  catalogId: string;
  catalogPath: string;
  manifestPath: string;
  mediaPolicy: ExtensibleStringUnion<"full" | "catalog-only">;
  counts: Record<string, number>;
  pathFree: boolean;
  verified: boolean;
}

export interface OpenPhotoCatalogImportResult {
  format: string;
  formatVersion: number;
  catalogId: string;
  catalogPath: string;
  managedRoot: string;
  counts: Record<string, number>;
  entityCounts: Record<string, number>;
  unknownEntities: string[];
  mergeByHash: boolean;
  verified: boolean;
  pathFreeSource: boolean;
}

export interface OpenPhotoCatalogProgress {
  phase: string;
  processed?: number;
  total?: number;
  message?: string;
}

export interface OpenPhotoCatalogProgressEvent {
  id: number;
  name: "photo_catalog";
  payload: OpenPhotoCatalogProgress;
}

export interface InboundConnectorCredentialSummary {
  provider: RemotePhotoSourceProvider;
  connectionId: string;
  displayName: string;
  configuredAt: string;
  updatedAt: string;
  credentialConfigured: boolean;
  config: Record<string, unknown>;
}

export interface InboundConnectorCatalogValue {
  providers: PhotoSourceProviderStatus[];
  sources: PhotoExternalSource[];
  jobs: PhotoSourceJob[];
  policy: {
    discovery: string;
    download: string;
    credentials: string;
    network: string;
    stableIds: boolean;
    sourceMutation: boolean;
  };
}

export interface InboundConnectorsValue {
  encryptionAvailable: boolean;
  credentials: InboundConnectorCredentialSummary[];
  catalog: InboundConnectorCatalogValue;
}

export interface PhotoSourceScopes {
  originals: boolean;
  edited: boolean;
  raw: boolean;
  livePhotoMotion: boolean;
  albumsFolders: boolean;
  keywords: boolean;
  labelsOcr: boolean;
  extractDetectedText: boolean;
  favorites: boolean;
  peopleFaces: boolean;
  preciseLocation: boolean;
  hidden: boolean;
  deleted: boolean;
  shared: boolean;
  commentsLikes: boolean;
}

export interface PhotoSourceLibrary {
  provider: PhotoSourceProvider;
  libraryId: string;
  path: string;
  name: string;
  available: boolean;
  systemLibrary: boolean;
  lastUsed: boolean;
  modifiedAt: string;
  photosVersion: string;
  databaseVersion: string;
  status: ExtensibleStringUnion<"ready" | "missing" | "permission_denied" | "error">;
  warnings: PhotoImportWarning[];
  metadata: Record<string, unknown>;
}

export interface PhotoExternalSource {
  sourceId: string;
  provider: PhotoSourceProvider;
  libraryId: string;
  rootPath: string;
  displayName: string;
  platform: string;
  status: string;
  capabilities: Record<string, boolean>;
  consent: {
    selectedScopes?: Partial<PhotoSourceScopes>;
    sensitiveScopes?: string[];
    recordedAt?: string;
  };
  cursor: Record<string, unknown>;
  metadata: Record<string, unknown>;
  lastPreviewAt: string;
  lastSyncAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoSourcePreviewSample {
  externalId: string;
  filename: string;
  title?: string;
  captureDate?: string;
  mediaKind?: string;
  favorite?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  missing?: boolean;
  cloudAsset?: boolean;
  albumCount?: number;
  peopleCount?: number;
  keywordCount?: number;
}

export interface PhotoSourcePreviewValue {
  provider: PhotoSourceProvider;
  sourceId: string;
  source: PhotoExternalSource;
  library: PhotoSourceLibrary;
  scopes: PhotoSourceScopes;
  counts: Record<string, number>;
  samples: PhotoSourcePreviewSample[];
  scannedCount: number;
  complete: boolean;
  elapsedMs: number;
  warnings: PhotoImportWarning[];
  unsupportedFields: string[];
  capabilities: Record<string, boolean>;
}

export interface PhotoSourceProviderStatus {
  provider: PhotoSourceProvider;
  supported: boolean;
  available: boolean;
  dependency?: string;
  dependencyVersion?: string;
  dependencyLoadState?: ExtensibleStringUnion<"deferred" | "loaded">;
  readOnly: boolean;
  networkAccess: string;
  capabilities: Record<string, boolean>;
  error: string;
  warnings: PhotoImportWarning[];
  sources?: PhotoExternalSource[];
  jobs?: PhotoSourceJob[];
}

export interface PhotoSourceDiscoveryValue {
  provider: PhotoSourceProvider;
  status: PhotoSourceProviderStatus;
  libraries: PhotoSourceLibrary[];
  configuredSources: PhotoExternalSource[];
}

export interface PhotoSourceJobProgress {
  phase: ExtensibleStringUnion<"starting" | "preparing" | "previewing" | "importing" | "syncing" | "exporting" | "revoking_consent" | "completed" | "failed" | "cancelled">;
  message?: string;
  importId?: string;
  total?: number;
  seen?: number;
  processed?: number;
  imported?: number;
  updated?: number;
  unchanged?: number;
  failed?: number;
  removed?: number;
  trashed?: number;
  exported?: number;
  exportedManaged?: number;
  currentExternalId?: string;
  [key: string]: unknown;
}

export interface PhotoSourceJobResult {
  sourceId?: string;
  provider?: PhotoSourceProvider;
  libraryId?: string;
  importId?: string;
  storageMode?: ExtensibleStringUnion<"referenced" | "managed">;
  managedRoot?: string;
  counts?: Record<string, number>;
  unsupportedFields?: string[];
  session?: PhotoImportSession;
  source?: PhotoExternalSource;
  warnings?: PhotoImportWarning[];
  destination?: string;
  requested?: number;
  exported?: number;
  failed?: number;
  paths?: string[];
  failures?: Array<{ externalId: string; filename?: string; reason: string }>;
  failureCount?: number;
  failureSummaryTruncated?: boolean;
  revokedScopes?: string[];
  localCatalogOnly?: boolean;
  sourceLibraryOpened?: boolean;
  networkAccess?: string;
  [key: string]: unknown;
}

export interface PhotoSourceJob {
  jobId: string;
  sourceId: string;
  provider: PhotoSourceProvider;
  jobKind: ExtensibleStringUnion<"preview" | "import" | "sync" | "export" | "revoke_consent">;
  status: ExtensibleStringUnion<"queued" | "running" | "completed" | "failed" | "cancelled">;
  params: Record<string, unknown>;
  progress: PhotoSourceJobProgress;
  result: PhotoSourceJobResult;
  error: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  completedAt: string;
}

export interface PhotoSourceJobStartValue {
  job: PhotoSourceJob;
  jobId: string;
  jobStarted: boolean;
  jobs: PhotoSourceJob[];
}

export interface PhotoSourceJobStatusValue {
  jobFound: boolean;
  job: PhotoSourceJob;
  jobs: PhotoSourceJob[];
}

export interface PhotoSourceJobsValue {
  jobs: PhotoSourceJob[];
  counts: Record<string, number>;
}

export interface PhotoSourcePeopleHint {
  hintId: string;
  assetId: string;
  sourceId: string;
  provider: PhotoSourceProvider;
  libraryId: string;
  externalAssetId: string;
  externalPersonId: string;
  externalFaceId: string;
  personName: string;
  status: ExtensibleStringUnion<"pending" | "accepted" | "rejected">;
  region: Record<string, unknown>;
  metadata: Record<string, unknown>;
  sourcePath: string;
  filename: string;
  mediaKind: string;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoSourcePeopleHintsValue {
  hints: PhotoSourcePeopleHint[];
  total: number;
  limit: number;
  offset: number;
  counts: Record<string, number>;
}

export interface PhotoImportFailureListValue {
  failures: PhotoImportFailure[];
  total: number;
  activeTotal: number;
  libraryRoot?: string;
}

export interface PhotoImportFailureDismissValue {
  dismissed: boolean;
  failureId: string;
  failure?: PhotoImportFailure | null;
}

export interface PhotoDuplicateGroupDismissValue {
  dismissed: boolean;
  groupId: string;
  algorithm?: string;
  signature?: string;
  itemCount?: number;
  dismissedAt?: string;
}

export interface PhotoImportFailureRecoverValue {
  saved: boolean;
  deleted: boolean;
  failureId?: string;
  sourcePath?: string;
  recoveredPath?: string;
  importResult?: PhotoImportResult;
  dismissedFailure?: PhotoImportFailureDismissValue;
}

export interface PhotoImportFailureRetryValue {
  retried: boolean;
  saved: boolean;
  failureId?: string;
  sourcePath?: string;
  storageMode?: ExtensibleStringUnion<"referenced" | "managed">;
  importResult?: PhotoImportResult;
  dismissedFailure?: PhotoImportFailureDismissValue;
}

export interface PhotoRecoveredOrphanScanValue {
  generatedAt: string;
  dryRun: boolean;
  libraryRoot?: string;
  scope?: {
    libraryRoot: string;
    label: string;
  };
  roots: string[];
  missingRoots: string[];
  scannedFiles: number;
  orphanCandidates: number;
  recorded: number;
  skippedExistingAssets: number;
  skippedExistingFailures: number;
  limit: number;
  failures?: PhotoImportFailure[];
}

export interface PhotoRecoveredCleanupValue {
  generatedAt: string;
  applied: boolean;
  deleteRecoveredFiles: boolean;
  retentionDays: number;
  libraryRoot?: string;
  scope?: {
    libraryRoot: string;
    label: string;
  };
  ok: boolean;
  status: string;
  counts: {
    cleanupCandidates: number;
    missingRecoveredOrphans: number;
    indexedRecoveredOrphans: number;
    expiredDismissedOrphans: number;
    fileDeleteCandidates: number;
    rowsDismissed: number;
    rowsDeleted: number;
    filesDeleted: number;
    fileDeleteFailures: number;
  };
  samples: Record<string, Record<string, unknown>[]>;
  recommendations: string[];
}

export interface PhotoPreviewRebuildValue {
  generatedAt: string;
  dryRun: boolean;
  force: boolean;
  requested: number;
  considered: number;
  limit: number;
  removedPreviewFiles: number;
  removedPreviewBytes: number;
  generatedPreviews: number;
  skipped: Array<{ sourcePath: string; reason: string }>;
  failed: Array<{ sourcePath: string; reason: string }>;
  rebuilt: Array<{ sourcePath: string; previewPath: string; existingPreview?: boolean; removedPreview?: boolean; generated?: boolean }>;
  truncated?: boolean;
}

export interface PhotoLibraryPreviewSweepValue {
  generatedAt: string;
  dryRun: boolean;
  force: boolean;
  missingOnly: boolean;
  includeVideos: boolean;
  libraryRoot?: string;
  scope?: {
    libraryRoot: string;
    label: string;
  };
  ok: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention" | "repaired">;
  limit: number;
  truncated: boolean;
  counts: {
    assets: number;
    eligibleAssets: number;
    cachedPreviews: number;
    missingCachedPreviews: number;
    missingOriginals: number;
    selectedAssets: number;
    consideredAssets: number;
    generatedPreviews: number;
    removedPreviewFiles: number;
    removedPreviewBytes: number;
    failedPreviews: number;
    skippedPreviews: number;
    remainingMissingCachedPreviews: number;
    [key: string]: number;
  };
  samples: Record<string, Array<Record<string, unknown>>>;
  rebuild: PhotoPreviewRebuildValue;
  history: Array<Record<string, unknown>>;
  recommendations: string[];
}

export interface PhotoLibraryRelinkValue {
  generatedAt: string;
  dryRun: boolean;
  forcePartial: boolean;
  partialBlocked: boolean;
  oldRoot: string;
  newRoot: string;
  matchedAssets: number;
  relinkedAssets: number;
  skippedAssets: number;
  missingTargets: Array<{ assetId?: string; from: string; to: string }>;
  conflicts: Array<{ assetId?: string; existingAssetId?: string; from: string; to: string }>;
  samples: Array<{ assetId?: string; from: string; to: string }>;
}

export interface PhotoMediaPairRelinkValue {
  pair: PhotoMediaPair;
  assetId: string;
  pairId: string;
  relatedAssetId?: string;
  relatedSourcePath: string;
  relatedExists?: boolean | null;
}

export interface PhotoMediaPairCreateValue extends PhotoMediaPairRelinkValue {
  created: boolean;
  pairKind: string;
}

export interface PhotoMediaPairDeleteValue {
  pairId: string;
  assetId: string;
  sourcePath?: string;
  relatedSourcePath?: string;
  relatedSourceUrl?: string;
  pairKind?: string;
  deleted: number;
  suppressedGenerated?: boolean;
  suppression?: Record<string, unknown>;
  previous?: PhotoMediaPair;
}

export interface PhotoLibraryConsolidateValue {
  generatedAt: string;
  dryRun: boolean;
  managedRoot: string;
  runRoot: string;
  requested: number;
  selectedAssets: number;
  consolidatedAssets: number;
  skippedAssets: number;
  missingInputs: string[];
  missingSources: Array<{ assetId?: string; sourcePath: string }>;
  alreadyManaged: Array<{ assetId?: string; sourcePath: string }>;
  deletedAssets: Array<{ assetId?: string; sourcePath: string }>;
  failures: Array<{ assetId?: string; sourcePath: string; reason: string }>;
  samples: Array<{ assetId?: string; from: string; to: string }>;
  pairedMotionCopiedCount?: number;
  pairedMotionSamples?: Array<{ assetId?: string; from: string; to: string }>;
  relatedMediaCopiedCount?: number;
  relatedMediaSamples?: Array<{ assetId?: string; pairKind?: string; from: string; to: string }>;
  operation?: PhotoOperation | null;
}

export interface PhotoLibraryBackupCheckValue {
  generatedAt: string;
  libraryRoot?: string;
  scope?: {
    libraryRoot: string;
    label: string;
  };
  ok: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention">;
  counts: {
    assets: number;
    managedAssets: number;
    referencedAssets: number;
    missingOriginals: number;
    missingManagedOriginals: number;
    missingReferencedOriginals: number;
    previewEligibleAssets: number;
    cachedPreviews: number;
    missingCachedPreviews: number;
    existingSidecars: number;
    metadataRows: number;
    keywordAssignments: number;
    peopleLinks: number;
    albums: number;
    manualAlbums: number;
    smartAlbums: number;
    albumItems: number;
    orphanAlbumItems: number;
    albumFolders: number;
    savedFilters: number;
    editStacks: number;
    managedRootProfiles: number;
    managedRootProfileIssues: number;
    managedAssetsOutsideProfiles: number;
    [key: string]: number;
  };
  samples: Record<string, Array<Record<string, unknown>>>;
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    status: string;
    severity: ExtensibleStringUnion<"error" | "warning" | "info">;
    count: number;
    detail: string;
  }>;
  recommendations: string[];
}

export interface PhotoLibraryCatalogCleanupValue {
  generatedAt: string;
  applied: boolean;
  ok: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention" | "repaired">;
  counts: {
    cleanupCandidates: number;
    cleanedRows: number;
    remainingCandidates: number;
    orphanAlbumItems: number;
    catalogIntegrityIssues: number;
    [key: string]: number;
  };
  samples: Record<string, Array<Record<string, unknown>>>;
  operations: Array<{
    id: string;
    label: string;
    category: string;
    count: number;
    cleaned: number;
    remaining: number;
    applied: boolean;
    reason: string;
  }>;
  recommendations: string[];
}

export interface PhotoRepairHistoryEvent {
  at: string;
  seq: number;
  action: string;
  label: string;
  status: string;
  ok?: boolean | null;
  dryRun: boolean;
  counts: Record<string, number>;
  summary: string;
  details?: Record<string, string | number | boolean | null | string[]>;
}

export interface PhotoRepairHistoryValue {
  generatedAt: string;
  limit: number;
  total: number;
  hasMore?: boolean;
  scannedAuditEvents?: number;
  auditScanLimit?: number;
  events: PhotoRepairHistoryEvent[];
}

export interface PhotoBackupRestoreRehearsalValue {
  generatedAt: string;
  ok: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention">;
  createdBackup: boolean;
  includeGenerated: boolean;
  counts: {
    assets: number;
    missingOriginals: number;
    referencedAssets: number;
    backupFiles: number;
    backupBytes: number;
    restoredFiles: number;
    restoredBytes: number;
    restoredAssets: number;
    mismatchedCounts: number;
    blockers: number;
    warnings: number;
    [key: string]: number;
  };
  backup: {
    zipPath: string;
    fileName: string;
    created?: Record<string, unknown>;
    verification?: Record<string, unknown>;
  };
  photos: PhotoLibraryBackupCheckValue;
  restore: {
    attempted: boolean;
    ok: boolean;
    error: string;
    fileCount: number;
    bytes: number;
    stateSummary?: Record<string, unknown>;
    warnings: string[];
    restoredPhotoCounts: Record<string, number>;
    countComparisons: Array<{
      id: string;
      label: string;
      current: number;
      restored: number;
      ok: boolean;
    }>;
  };
  cleanup: {
    temporary: boolean;
    cleanedUp: boolean;
    targetRoot: string;
  };
  policyStatus?: PhotoBackupPolicyStatus;
  checks: Array<{
    id: string;
    label: string;
    ok: boolean;
    status: string;
    severity: ExtensibleStringUnion<"error" | "warning" | "info">;
    count: number;
    detail: string;
  }>;
  recommendations: string[];
}

export interface PhotoAssetEventValue {
  eventType: ExtensibleStringUnion<"viewed" | "shared">;
  eventAt?: string;
  requested: number;
  recorded: number;
  assetIds?: string[];
  sourcePaths?: string[];
  summary?: {
    count?: number;
    coverSourcePath?: string;
  };
}

export interface PhotoEditStackValue {
  editId?: string;
  assetId: string;
  sourcePath: string;
  operations: Array<Record<string, unknown>>;
  renderedPreviewPath?: string;
  renderedPreviewUrl?: string;
  sidecarPath?: string;
  sidecarPayload?: Record<string, unknown>;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  deleted?: number;
  previous?: Record<string, unknown>;
  removedPaths?: string[];
  hasStack?: boolean;
  stack?: Partial<PhotoEditStackValue> | Record<string, unknown>;
}

export type PhotoGenerativeMode = "cleanup" | "upscale" | "expand" | "reframe" | "relight";

export interface PhotoContentCredentialSummary {
  schemaVersion?: number;
  policyVersion?: string;
  specVersion?: string;
  present: boolean;
  embedded: boolean;
  validationState: string;
  cryptographicallyValid: boolean;
  locallyTrusted: boolean;
  globallyTrusted: boolean;
  trustScope: ExtensibleStringUnion<"workspace-local" | "c2pa-global" | "untrusted" | "none">;
  timestamped: boolean;
  manifestId: string;
  signer?: {
    algorithm?: string;
    issuer?: string;
    commonName?: string;
    signerId?: string;
  };
  actions?: Array<{
    action?: string;
    digitalSourceType?: string;
    description?: string;
  }>;
  historyActions?: Array<{ action?: string }>;
  sourceTypes?: string[];
  containsAiHistory: boolean;
  topLevelAiEdit: boolean;
  ingredientCount: number;
  assetSha256: string;
  format?: string;
  validation?: {
    successCodes?: string[];
    failureCodes?: string[];
  };
  error?: string;
}

export interface PhotoContentCredentialStatus {
  available: boolean;
  policyVersion: string;
  specVersion: string;
  packageVersion: string;
  nativeSdkVersion: string;
  offline: boolean;
  remoteManifestFetch: false;
  ocspFetch: false;
  timestamped: false;
  trustScope: "workspace-local";
  globallyTrusted: false;
  identityReady: boolean;
  identityPersisted: boolean;
  identityEncrypted: boolean;
  identityStorage: string;
  signerId: string;
  error?: string;
}

export interface PhotoGenerativeCapabilityStatus {
  available?: boolean;
  ready?: boolean;
  verified?: boolean;
  installed?: boolean;
  platformSupported?: boolean;
  hardwareSupported?: boolean;
  error?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface PhotoGenerativeStatus {
  catalogVersion: string;
  catalogSha256: string;
  offlineInference: boolean;
  modelRoot: string;
  platform: string;
  totalMemoryBytes: number;
  light: PhotoGenerativeCapabilityStatus & {
    downloadBytes?: number;
    cleanup?: PhotoGenerativeCapabilityStatus;
    upscale?: PhotoGenerativeCapabilityStatus;
  };
  heavy: PhotoGenerativeCapabilityStatus & {
    downloadBytes?: number;
    minimumMemoryBytes?: number;
    recommendedMemoryBytes?: number;
    acknowledgement?: string;
    models?: PhotoGenerativeCapabilityStatus;
    runtime?: PhotoGenerativeCapabilityStatus;
  };
  modes: Record<PhotoGenerativeMode, boolean>;
  contentCredentials?: PhotoContentCredentialStatus;
  applyRequiresContentCredentials?: boolean;
  applyAvailable?: boolean;
}

export interface PhotoGenerativePreviewValue {
  previewId: string;
  assetId: string;
  mode: PhotoGenerativeMode;
  tier: "light" | "heavy";
  generativePreviewPath: string;
  generativePreviewUrl?: string;
  generativePreviewSha256: string;
  width: number;
  height: number;
  durationSeconds: number;
  offlineInference: true;
  aiGenerated: true;
  provenance: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  requiresConfirmation: true;
  sourceChanged: false;
}

export interface PhotoGenerativeApplyValue {
  previewId: string;
  assetId: string;
  mode: PhotoGenerativeMode;
  tier: "light" | "heavy";
  applied: boolean;
  sourceChanged: false;
  aiGenerated: true;
  offlineInference: true;
  artifactSha256: string;
  modelOutputSha256: string;
  contentCredentials: PhotoContentCredentialSummary;
  stack: PhotoEditStackValue;
  version?: PhotoEditStackVersionValue | Record<string, unknown>;
  versionCreated: boolean;
  idempotentReplay: boolean;
}

export interface PhotoEditStackVersionValue {
  versionId: string;
  assetId: string;
  sourcePath: string;
  label: string;
  operations: Array<Record<string, unknown>>;
  sourceEditId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoAssetVersionDuplicateValue {
  generatedAt?: string;
  sourceAssetId: string;
  sourceOriginalPath: string;
  assetId: string;
  sourcePath: string;
  managedRoot: string;
  runRoot: string;
  asset?: PhotoAsset | Record<string, unknown>;
  stack?: PhotoEditStackValue | Record<string, unknown>;
  hasStack?: boolean;
  rendered?: boolean;
  renderFormat?: string;
  targetColorProfile?: string;
  targetColorProfilePath?: string;
  renderWidth?: number;
  renderHeight?: number;
  renderedFromEditStackId?: string;
  clonedAlbums?: number;
  clonedPeople?: number;
  clonedVersions?: number;
  pairedMotionCopiedCount?: number;
  pairedMotionSamples?: Array<{ from: string; to: string }>;
  operation?: PhotoOperation;
}

export interface PhotoColorProfileValidationValue {
  ok: boolean;
  path: string;
  fileName: string;
  bytes: number;
  description?: string;
  name?: string;
  info?: string;
}

export interface PhotoColorProfileAvailability {
  target: string;
  label: string;
  description?: string;
  available: boolean;
  selected?: boolean;
  source?: ExtensibleStringUnion<"embedded" | "generated" | "system" | "custom" | "none">;
  path?: string;
  fileName?: string;
  bytes?: number;
  descriptionText?: string;
  name?: string;
  message?: string;
  error?: string;
  candidateCount?: number;
}

export interface PhotoColorProfileStatusValue {
  targetColorProfile: string;
  targetColorProfilePath?: string;
  profiles: PhotoColorProfileAvailability[];
  selected?: PhotoColorProfileAvailability;
  generatedAt?: string;
}

export interface PhotoPeopleGroup {
  groupId: string;
  name: string;
  memberPeople: string[];
  excludePeople: string[];
  memberPets?: string[];
  excludePets?: string[];
  keyAssetId: string;
  favorite: boolean;
  hidden: boolean;
  manualOrder?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoPetProfile {
  petName: string;
  petKind: string;
  keyAssetId: string;
  favorite: boolean;
  hidden: boolean;
  manualOrder?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoFolder {
  id: string; // "all" | utility/root ids such as "places" / "trips" / "memories" / "petReview" | "sourceFolder:<path>" | "album:<id>" | "albumFolder:<id>" | "person:<name>" | "unknown:<cluster>" | "pet:<name>" | "place:<id>" | "trip:<id>" | "memory:<id>"
  kind: "all" | "source" | "album" | "albumFolder" | "person" | "unknown" | "group" | "pet" | "utility" | "place" | "trip" | "memory";
  name: string;
  count: number;
  albumId?: string;
  albumKind?: ExtensibleStringUnion<"smart" | "manual">;
  albumCount?: number;
  folderId?: string;
  parentFolderId?: string;
  position?: number;
  folderPosition?: number;
  description?: string;
  includePeople?: string[];
  excludePeople?: string[];
  rules?: PhotoAlbumRules;
  ruleSummary?: string[];
  validation?: PhotoAlbumValidation[];
  coverSourcePath?: string;
  coverPreviewPath?: string | null;
  coverPreviewUrl?: string;
  coverCrop?: PhotoCoverCrop;
  sourcePath?: string;
  sourceFolder?: {
    path: string;
    name?: string;
    count?: number;
  };
  importSourceKind?: string;
  importSourceLabel?: string;
  importSource?: {
    kind: string;
    label: string;
    count?: number;
    sessionCount?: number;
    latestImportAt?: string;
  };
  groupCount?: number;
  placeCount?: number;
  tripCount?: number;
  memoryCount?: number;
  petCount?: number;
  petReview?: boolean;
  petReviewKinds?: Array<{ label: string; count: number }>;
  mediaKind?: ExtensibleStringUnion<"image" | "video" | "live_photo" | "raw" | "other">;
  petName?: string;
  petKind?: string;
  petKindLabel?: string;
  petProfile?: PhotoPetProfile;
  placeId?: string;
  place?: PhotoPlace;
  placeProfile?: PhotoPlaceProfile;
  utilityProfile?: PhotoUtilityProfile;
  tripId?: string;
  trip?: PhotoTrip;
  memoryId?: string;
  memory?: PhotoMemory;
  utilityClassifier?: ExtensibleStringUnion<"documents" | "receipts" | "handwriting" | "illustrations" | "qr">;
  importId?: string;
  importSession?: PhotoImportSession | null;
  importSessions?: PhotoImportSession[];
  importSessionCount?: number;
  archivedImportSessions?: PhotoImportSession[];
  archivedImportSessionCount?: number;
  failureCount?: number;
  personProfile?: PhotoPersonProfile;
  groupId?: string;
  groupSource?: ExtensibleStringUnion<"saved" | "generated">;
  groupPeople?: string[];
  groupPets?: string[];
  excludePets?: string[];
  groupProfile?: PhotoPeopleGroup;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoFolderList {
  folders: PhotoFolder[];
  coverPreviewBudget?: number;
  coverPreviewAttempts?: number;
  coverPreviewGenerated?: number;
  coverPreviewExisting?: number;
  partial?: boolean;
  railMode?: ExtensibleStringUnion<"interactive" | "full">;
  catalogRevision?: string;
  enriched?: boolean;
  enrichmentQueued?: boolean;
  enrichmentRunning?: boolean;
}

export interface PhotoPersonPresence {
  candidateId: string;
  personName: string;
  status: ExtensibleStringUnion<CandidateStatus>;
  score: number;
  quality: number;
  band: string;
  assetOnly?: boolean;
  mediaKind?: ExtensibleStringUnion<"image" | "video">;
  captureDate?: string | null;
  createdAt?: string;
}

export interface PhotoAlbumMembership {
  albumId: string;
  name: string;
  albumKind: ExtensibleStringUnion<"smart" | "manual">;
  position: number;
  addedAt: string;
  derived?: boolean;
}

export interface PhotoKeyword {
  keywordId: string;
  name: string;
  shortcut?: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface PhotoDuplicateGroupItem {
  assetId: string;
  sourcePath: string;
  position: number;
  reason: string;
}

export interface PhotoDuplicateGroup {
  groupId: string;
  algorithm: ExtensibleStringUnion<"exact_hash" | "perceptual_dhash">;
  signature: string;
  itemCount: number;
  primaryAssetId: string;
  recommendedAssetId?: string;
  recommendedSourcePath?: string;
  recommendationScore?: number;
  recommendationReasons?: string[];
  createdAt: string;
  updatedAt: string;
  items: PhotoDuplicateGroupItem[];
}

export interface PhotoMediaPair {
  pairId: string;
  assetId: string;
  relatedAssetId?: string;
  pairKind: string;
  sourcePath?: string;
  relatedSourcePath?: string;
  relatedSourceUrl?: string;
  metadata?: Record<string, unknown>;
  sourceExists?: boolean | null;
  relatedExists?: boolean | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PhotoBurstStackSummary {
  stackId: string;
  name: string;
  count: number;
  keeperCount: number;
  coverSourcePath: string;
  representativeSourcePath: string;
  sourcePaths: string[];
  collapsed?: boolean;
}

export interface PhotoUtilityMatch {
  classifierId: string;
  classifierKind: string;
  classifierName: string;
  term: string;
  field: string;
  fieldLabel: string;
  value: string;
  evidenceLabel: string;
  reviewAction?: ExtensibleStringUnion<"confirmed" | "rejected">;
}

export interface PhotoItem {
  id: string;
  assetId?: string;
  sourcePath: string;
  sourceUrl?: string;
  originalSourceUrl?: string;
  previewPath?: string | null;
  previewUrl?: string;
  rawPreviewProxyPath?: string;
  previewError?: string;
  personName?: string | null;
  mediaKind?: ExtensibleStringUnion<"image" | "video">;
  sourceKind?: ExtensibleStringUnion<"managed" | "referenced">;
  fileSignature?: Record<string, unknown>;
  contentHash?: string;
  perceptualHash?: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  captureDate?: string | null;
  originalCaptureDate?: string | null;
  title?: string;
  caption?: string;
  keywords?: string[];
  favorite?: boolean;
  rating?: number;
  colorLabel?: ExtensibleStringUnion<"red" | "yellow" | "green" | "blue" | "purple">;
  pickStatus?: ExtensibleStringUnion<"pick" | "reject">;
  hidden?: boolean;
  deletedAt?: string;
  dateOverride?: string;
  locationOverride?: Record<string, unknown>;
  locationHidden?: boolean;
  edited?: boolean;
  hasEditStack?: boolean;
  editStackVersionCount?: number;
  hasEditStackVersions?: boolean;
  scanDate?: string;
  addedAt?: string;
  updatedAt?: string;
  missingAt?: string;
  sourceScanRun?: string;
  assetMetadata?: Record<string, unknown>;
  importSourceKind?: string;
  importSourceLabel?: string;
  importSourceDetail?: string;
  importedAt?: string;
  eventAt?: string;
  eventType?: ExtensibleStringUnion<"viewed" | "shared">;
  eventActor?: string;
  eventMetadata?: Record<string, unknown>;
  createdAt?: string;
  status?: ExtensibleStringUnion<CandidateStatus> | null;
  score?: number | null;
  quality?: number | null;
  candidateIds?: string[];
  personCount?: number;
  bestScore?: number;
  bestQuality?: number;
  people?: PhotoPersonPresence[];
  albumMemberships?: PhotoAlbumMembership[];
  duplicateGroup?: PhotoDuplicateGroup | null;
  mediaPairs?: PhotoMediaPair[];
  burstStack?: PhotoBurstStackSummary;
  utilityMatch?: PhotoUtilityMatch;
}

export interface PhotoOperation {
  operationId: string;
  operationType: string;
  label: string;
  payload?: Record<string, unknown>;
  undoPayload?: Record<string, unknown>;
  affectedCount: number;
  createdAt: string;
  undoneAt: string;
  canUndo: boolean;
}

export interface PhotoOperationListValue {
  operations: PhotoOperation[];
}

export interface PhotoVisibilityOperationValue {
  action: string;
  affected: number;
  operation: PhotoOperation;
}

export interface PhotoOperationUndoValue {
  undone: boolean;
  operation: PhotoOperation | null;
  restored: number;
  missing: number;
  missingOriginals?: number;
}

export interface PhotoRestoreRehearsalItem {
  assetId?: string;
  sourcePath?: string;
  sourceKind?: string;
  trashPath?: string;
  status: ExtensibleStringUnion<"ready" | "warning" | "blocked">;
  issue: string;
  detail: string;
  canRestoreCatalog: boolean;
  canRestoreOriginal: boolean;
  sourceExists?: boolean;
  sourceIsFile?: boolean;
  trashExists?: boolean;
  targetPath?: string;
  targetExists?: boolean;
}

export interface PhotoRestoreRehearsalOperation {
  operation: PhotoOperation;
  undoKind: string;
  ok: boolean;
  counts: {
    items: number;
    readyItems: number;
    warningItems: number;
    blockedItems: number;
    missingOriginalItems: number;
    missingManagedTrashItems: number;
    sourceConflictItems: number;
    [key: string]: number;
  };
  items: PhotoRestoreRehearsalItem[];
  recommendations: string[];
}

export interface PhotoRestoreRehearsalValue {
  generatedAt: string;
  operationId: string;
  ok: boolean;
  status: ExtensibleStringUnion<"ready" | "warning" | "attention">;
  counts: {
    operations: number;
    items: number;
    readyItems: number;
    warningItems: number;
    blockedItems: number;
    missingOriginalItems: number;
    missingManagedTrashItems: number;
    sourceConflictItems: number;
    [key: string]: number;
  };
  operations: PhotoRestoreRehearsalOperation[];
  recommendations: string[];
}

export interface PhotoItemsPage {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  items: PhotoItem[];
  searchIndex?: PhotoSearchIndexStatus;
  validation?: PhotoAlbumValidation[];
  groupMode?: ExtensibleStringUnion<"all" | "best">;
  nearby?: { latitude: number; longitude: number; radiusKm: number };
  previewFailures?: number;
  previewErrorSamples?: Array<{ sourcePath: string; message: string }>;
  missingOriginals?: number;
  missingOriginalSamples?: Array<{ sourcePath: string; missingAt: string }>;
}

export interface PhotoSearchIndexStatus {
  rebuilt?: boolean;
  repaired?: boolean;
  completed?: boolean;
  pending?: boolean;
  cold?: boolean;
  queued?: boolean;
  assetCount?: number;
  indexCount?: number;
  missingCount?: number;
  orphanCount?: number;
  blankCount?: number;
  duplicateCount?: number;
  indexedCount?: number;
  remainingMissingCount?: number;
  remainingOrphanCount?: number;
  remainingBlankCount?: number;
  remainingDuplicateCount?: number;
  message?: string;
  progress?: {
    total?: number;
    processed?: number;
    updated?: number;
    failed?: number;
    skipped?: number;
    deferred?: number;
  };
  job?: {
    jobId?: string;
    jobKind?: string;
    status?: string;
    scope?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
  };
}

export interface PhotoIndexingRuntimeStatus {
  allowed: boolean;
  reason: string;
  schedulerEnabled: boolean;
  running: boolean;
  checkedAt: string;
  powerMode: ExtensibleStringUnion<"low" | "balanced" | "performance">;
  maxCostClass: ExtensibleStringUnion<"none" | "light" | "medium" | "heavy">;
  constraints: string[];
  onBattery: boolean;
  idleState: ExtensibleStringUnion<"active" | "idle" | "locked" | "unknown">;
  foregroundActive: boolean;
  thermalState: ExtensibleStringUnion<"nominal" | "fair" | "serious" | "critical" | "unknown">;
  speedLimit: number;
  memoryPressure: ExtensibleStringUnion<"normal" | "pressured" | "critical" | "unknown">;
  freeMemoryBytes: number;
  totalMemoryBytes: number;
  memoryAvailableFraction: number;
}

export interface PhotoDateBucket {
  key: string;
  label: string;
  count: number;
  coverTitle?: string;
  coverReason?: string;
  coverSourcePath?: string;
  coverPreviewPath?: string | null;
  coverPreviewUrl?: string;
  favoriteCount?: number;
  peoplePhotoCount?: number;
  locationCount?: number;
  videoCount?: number;
  editedCount?: number;
  duplicateCount?: number;
  versionCount?: number;
  summaryBadges?: string[];
}

export interface PhotoDateBucketList {
  folderId: string;
  mode: ExtensibleStringUnion<"years" | "months" | "days" | "recentDays">;
  total: number;
  buckets: PhotoDateBucket[];
  searchIndex?: PhotoSearchIndexStatus;
}

export interface PhotoLibrarySearchItem {
  id: string;
  kind: ExtensibleStringUnion<"photo" | "folder" | "keyword" | "date">;
  title: string;
  subtitle?: string;
  snippet?: string;
  matchReasons?: string[];
  sourcePath?: string;
  previewPath?: string | null;
  previewUrl?: string;
  coverPreviewPath?: string | null;
  coverPreviewUrl?: string;
  assetId?: string;
  mediaKind?: string;
  captureDate?: string | null;
  folderId?: string;
  folderKind?: string;
  albumKind?: string;
  importSourceKind?: string;
  importSourceLabel?: string;
  keyword?: string;
  dateBucketMode?: ExtensibleStringUnion<"years" | "months" | "days" | "recentDays">;
  dateBucketKey?: string;
  searchText?: string;
  count?: number;
  resultKind?: ExtensibleStringUnion<"videoSegment" | "audioSegment">;
  segmentId?: string;
  timestampMs?: number;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  audioSegmentKind?: ExtensibleStringUnion<"speech" | "sound">;
  audioLanguage?: string;
  audioConfidence?: number | null;
}

export interface PhotoLibrarySearchGroup {
  id: string;
  label: string;
  total: number;
  returned: number;
  hasMore?: boolean;
  capped?: boolean;
  estimatedTotal?: boolean;
  items: PhotoLibrarySearchItem[];
}

export interface PhotoLibrarySearchResult {
  query: string;
  semanticQueries?: string[];
  searchIndex?: PhotoSearchIndexStatus;
  total: number;
  returned?: number;
  groups: PhotoLibrarySearchGroup[];
  suggestions?: string[];
}

export interface PhotoAssetPerson {
  assetId: string;
  candidateId: string;
  personName: string;
  status: ExtensibleStringUnion<CandidateStatus>;
  score: number;
  quality: number;
  band: string;
  updatedAt: string;
}

export interface PhotoAsset {
  assetId: string;
  sourcePath: string;
  sourceKind: ExtensibleStringUnion<"managed" | "referenced">;
  fileSignature: Record<string, unknown>;
  contentHash: string;
  perceptualHash: string;
  mediaKind: ExtensibleStringUnion<"image" | "video" | "live_photo" | "raw" | "other">;
  mimeType: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  captureDate: string;
  addedAt: string;
  updatedAt: string;
  missingAt: string;
  sourceScanRun: string;
  metadata: Record<string, unknown> & {
    title?: string;
    caption?: string;
    keywords?: string[];
    favorite?: boolean;
    hidden?: boolean;
    deletedAt?: string;
    dateOverride?: string;
    edited?: boolean;
  };
  people: PhotoAssetPerson[];
}

export interface PhotoAlbumSuggestion {
  id: string;
  name: string;
  description: string;
  includePeople: string[];
  excludePeople: string[];
  rules: PhotoAlbumRules;
  ruleSummary: string[];
  matchCount: number;
  reason: string;
}

export interface PhotoAlbumSuggestionResult {
  suggestions: PhotoAlbumSuggestion[];
  total: number;
}

export interface PhotoSelectionExportValue {
  bundlePath: string;
  mediaPath: string;
  metadataPath?: string;
  manifestPath: string;
  csvPath: string;
  stripLocation?: boolean;
  allowRenderFallback?: boolean;
  preserveColorProfile?: boolean;
  targetColorProfile?: ExtensibleStringUnion<"source" | "srgb" | "display-p3" | "adobe-rgb" | "custom-icc" | "none">;
  targetColorProfilePath?: string;
  includeExistingSidecars?: boolean;
  exportVariant?: ExtensibleStringUnion<"original" | "rendered">;
  renderFormat?: ExtensibleStringUnion<"jpeg" | "png" | "tiff" | "heic" | "mp4">;
  renderQuality?: number;
  renderMaxDimension?: number;
  videoRenderFormat?: ExtensibleStringUnion<"mp4" | "mov" | "m4v" | "webm" | "hevc" | "prores">;
  videoRenderQuality?: ExtensibleStringUnion<"small" | "medium" | "high">;
  filenameTemplate?: string;
  subfolderTemplate?: string;
  counts: {
    selected: number;
    copied: number;
    moved: number;
    missing: number;
    duplicate: number;
    metadata?: number;
    xmp?: number;
    existingSidecars?: number;
    rendered?: number;
    videoRendered?: number;
    editStackRendered?: number;
    rawProxyRendered?: number;
    renderFallback?: number;
    skipped?: number;
    contentCredentialsSigned?: number;
    contentCredentialsPreserved?: number;
    contentCredentialsFailed?: number;
    contentCredentialsAbsent?: number;
  };
  items: Array<{
    sourcePath: string;
    targetPath: string;
    result: string;
    metadataPath?: string;
    xmpPath?: string;
    existingSidecarPaths?: string[];
    exportVariant?: string;
    renderFormat?: string;
    videoRenderFormat?: string;
    videoRenderQuality?: string;
    targetColorProfile?: string;
    targetColorProfilePath?: string;
    editStackId?: string;
    rawRenderProxyPath?: string;
    videoTrimStartMs?: number | string;
    videoTrimEndMs?: number | string;
    videoTrimDurationMs?: number | string;
    videoSourceDurationMs?: number | string;
    videoRotateDegrees?: number | string;
    videoCropAspect?: string;
    videoTransformApplied?: boolean | string;
    videoEditTimeline?: string;
    videoEditTransform?: string;
    videoEditRender?: string;
    videoEditSummary?: string;
    contentCredentialStatus?: string;
    contentCredentialFailure?: string;
    contentCredentials?: PhotoContentCredentialSummary | Record<string, never>;
  }>;
  sharedEvent?: PhotoAssetEventValue;
  operation?: PhotoOperation;
}

export interface PhotoContactSheetExportValue {
  bundlePath: string;
  targetPath: string;
  targetPaths: string[];
  manifestPath: string;
  format: ExtensibleStringUnion<"pdf" | "png" | "jpeg">;
  layoutPreset?: ExtensibleStringUnion<"custom" | "full_page" | "two_up" | "four_up" | "wallet">;
  columns: number;
  thumbnailSize: number;
  effectiveColumns?: number;
  effectiveThumbnailSize?: number;
  includeCaptions: boolean;
  captionMode?: ExtensibleStringUnion<"title_date_people" | "metadata" | "filename">;
  title?: string;
  pageSize?: string;
  counts: {
    selected: number;
    included: number;
    missing: number;
    unsupported: number;
    duplicate: number;
    pages: number;
  };
  items: Array<{ index: number; sourcePath: string; result: string; label: string; mediaKind?: string; error?: string }>;
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoSlideshowMotionKeyframesValue {
  startX?: number;
  startY?: number;
  quarterX?: number;
  quarterY?: number;
  midX?: number;
  midY?: number;
  threeQuarterX?: number;
  threeQuarterY?: number;
  endX?: number;
  endY?: number;
  startZoom?: number;
  quarterZoom?: number;
  midZoom?: number;
  threeQuarterZoom?: number;
  endZoom?: number;
}

export interface PhotoSlideshowTimelineItemValue {
  sourcePath: string;
  durationMs: number;
  motion?: string;
  keyframes?: PhotoSlideshowMotionKeyframesValue | null;
  focalX?: number;
  focalY?: number;
  cropZoom?: number;
  captionText?: string;
  captionPlacement?: string;
  captionRegion?: { x?: number; y?: number; width?: number; height?: number };
  captionTypography?: string;
  captionWrap?: string;
  captions?: PhotoSlideshowCaptionValue[];
  transitionEffect?: string;
  resolvedMotion?: string;
  transitionOut?: string;
  transitionDurationMs?: number;
  themeCue?: string;
}

export interface PhotoSlideshowCaptionValue {
  id?: string;
  captionText?: string;
  captionPlacement?: string;
  captionRegion?: { x?: number; y?: number; width?: number; height?: number };
  captionTypography?: string;
  captionWrap?: string;
}

export type PhotoSlideshowTemplateRegionMapValue = Record<string, { x?: number; y?: number; width?: number; height?: number }>;

export interface PhotoSlideshowExportValue {
  bundlePath: string;
  htmlPath: string;
  targetPath?: string;
  manifestPath: string;
  outputMode?: ExtensibleStringUnion<"html" | "video">;
  exportKind?: ExtensibleStringUnion<"slideshow" | "memoryMovie">;
  projectId?: string;
  memoryId?: string;
  memoryName?: string;
  title: string;
  sourceLabel?: string;
  theme: string;
  music: string;
  audioVolume?: number;
  audioFadeMs?: number;
  audioStartMs?: number;
  audioEndMs?: number;
  audioPlacementStartSourcePath?: string;
  audioPlacementEndSourcePath?: string;
  audioPlacementStartMs?: number;
  audioPlacementEndMs?: number;
  transitionEffect?: string;
  transitionResolvedEffect?: string;
  transitionDurationMs?: number;
  themeTimelinePreset?: string;
  themeTemplateName?: string;
  themeTemplatePalette?: string;
  themeTemplateTypography?: string;
  themeTemplateBackdrop?: string;
  themeTemplateLayout?: string;
  themeTemplateFrameStyle?: string;
  themeTemplateChromeDensity?: string;
  themeTemplateCaptionPreset?: string;
  themeTemplateRegionMap?: PhotoSlideshowTemplateRegionMapValue;
  templateCaptionResolvedRegionMap?: PhotoSlideshowTemplateRegionMapValue;
  fitMode: string;
  intervalMs: number;
  timelineDurationMs?: number;
  timelineItems?: PhotoSlideshowTimelineItemValue[];
  resolvedTimelineItems?: PhotoSlideshowTimelineItemValue[];
  motionPresets?: string[];
  resolvedMotionPresets?: string[];
  chapters?: Array<{ id?: string; index?: number; slideIndex?: number; sourceIndex?: number; sourcePath?: string; relativePath?: string; label?: string; kind?: string; motion?: string; keyframes?: PhotoSlideshowMotionKeyframesValue | null; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; captions?: PhotoSlideshowCaptionValue[]; resolvedMotion?: string; startMs?: number; durationMs?: number; endMs?: number }>;
  videoRenderFormat?: ExtensibleStringUnion<"mp4" | "mov" | "m4v" | "webm" | "hevc" | "prores">;
  videoRenderQuality?: ExtensibleStringUnion<"small" | "medium" | "high">;
  renderMaxDimension?: number;
  videoRender?: { targetPath?: string; slideCount?: number; durationMs?: number; width?: number; height?: number; audioTrack?: string; audioGenerated?: boolean; audioImported?: boolean; audioPath?: string; audioVolume?: number; audioFadeMs?: number; audioStartMs?: number; audioEndMs?: number; audioPlacementStartMs?: number; audioPlacementEndMs?: number; transitionEffect?: string; transitionDurationMs?: number; transitionFfmpegEffect?: string; transitionTimeline?: Array<{ index?: number; transitionOut?: string; transitionDurationMs?: number; transitionFfmpegEffect?: string }>; transitionApplied?: boolean; motionPresets?: string[]; resolvedMotionPresets?: string[]; motionApplied?: boolean; titleCardIncluded?: boolean; themeTemplateStageWidth?: number; templateStageFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateLayout?: string; templateLayoutChromeRendered?: boolean; templateLayoutChromeStyle?: string; templateLayoutMediaFrame?: { x?: number; y?: number; width?: number; height?: number }; templateLayoutBackgroundColor?: string; themeTemplateFrameStyle?: string; templateFrameRendered?: boolean; templateFrameBorderPx?: number; templateFrameColor?: string; themeTemplateChromeDensity?: string; templateChromeDensity?: string; themeTemplateCaptionPreset?: string; templateCaptionPreset?: string; templateCaptionResolvedPreset?: string; themeTemplateRegionMap?: PhotoSlideshowTemplateRegionMapValue; templateCaptionResolvedRegionMap?: PhotoSlideshowTemplateRegionMapValue; templateChromeRendered?: boolean; templateChromeBarPx?: number; templateChromeColor?: string; templateChromeOverlayRendered?: boolean; templateChromeTextRendered?: boolean; templateChromeOverlayCount?: number; templateChromeOverlayKinds?: string[]; templateChromeOverlayRows?: Array<{ index?: number; title?: string; sourceLabel?: string; chapterLabel?: string; counter?: string; themeTemplateStageWidth?: number; templateStageFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateLayout?: string; templateLayoutChromeRendered?: boolean; templateLayoutChromeStyle?: string; templateLayoutMediaFrame?: { x?: number; y?: number; width?: number; height?: number }; themeTemplateCaptionPreset?: string; templateCaptionResolvedPreset?: string; themeTemplateRegionMap?: PhotoSlideshowTemplateRegionMapValue; templateCaptionResolvedRegionMap?: PhotoSlideshowTemplateRegionMapValue; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; captions?: PhotoSlideshowCaptionValue[] }>; templateCaptionRendered?: boolean; templateCaptionOverlayCount?: number; templateCaptionItemCount?: number; cropFocusRendered?: boolean };
  titleCard?: { included?: boolean; title?: string; subtitle?: string; durationMs?: number; targetPath?: string; relativePath?: string; palette?: string; resolvedPalette?: string; layout?: string; fontScale?: string; showFooter?: boolean };
  customAudio?: { included?: boolean; sourcePath?: string; targetPath?: string; relativePath?: string; result?: string; error?: string; trimStartMs?: number; trimEndMs?: number; placementStartMs?: number; placementEndMs?: number };
  counts: {
    selected: number;
    included: number;
    missing: number;
    unsupported: number;
    duplicate: number;
  };
  items: Array<{ index: number; sourcePath: string; targetPath: string; relativePath: string; result: string; label: string; mediaKind?: string; durationMs?: number; motion?: string; keyframes?: PhotoSlideshowMotionKeyframesValue | null; focalX?: number; focalY?: number; cropZoom?: number; captionText?: string; captionPlacement?: string; captionRegion?: { x?: number; y?: number; width?: number; height?: number }; captionTypography?: string; captionWrap?: string; captions?: PhotoSlideshowCaptionValue[]; transitionEffect?: string; resolvedMotion?: string; transitionOut?: string; transitionDurationMs?: number; themeCue?: string; timelineStartMs?: number; timelineEndMs?: number; generated?: boolean; error?: string }>;
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoVideoFrameExportValue {
  bundlePath: string;
  mediaPath: string;
  targetPath: string;
  manifestPath: string;
  sourcePath: string;
  timestampMs: number;
  posterFrameReused?: boolean;
  posterTimestampMs?: number | null;
  posterPreviewPath?: string;
  renderFormat: ExtensibleStringUnion<"jpeg" | "png" | "tiff">;
  renderQuality: number;
  renderMaxDimension: number;
  width?: number;
  height?: number;
  durationMs?: number;
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoVideoTrimExportValue {
  bundlePath: string;
  mediaPath: string;
  targetPath: string;
  manifestPath: string;
  sourcePath: string;
  startMs: number;
  endMs: number;
  trimDurationMs: number;
  sourceDurationMs?: number;
  videoRenderFormat: ExtensibleStringUnion<"mp4" | "mov" | "m4v" | "webm" | "hevc" | "prores">;
  videoRenderQuality: ExtensibleStringUnion<"small" | "medium" | "high">;
  renderMaxDimension: number;
  videoRotateDegrees?: number;
  videoCropAspect?: ExtensibleStringUnion<"none" | "square" | "landscape" | "portrait">;
  videoTransformApplied?: boolean;
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoLiveMotionExportValue {
  bundlePath: string;
  mediaPath: string;
  targetPath: string;
  manifestPath: string;
  sourcePath: string;
  motionSourcePath: string;
  exportVariant?: ExtensibleStringUnion<"motion" | "loop_gif" | "bounce_gif">;
  format?: ExtensibleStringUnion<"video" | "gif">;
  durationMs?: number;
  frameCount?: number;
  baseFrameCount?: number;
  frameDurationMs?: number;
  width?: number;
  height?: number;
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoSubjectCutoutExportValue {
  bundlePath: string;
  mediaPath: string;
  targetPath: string;
  manifestPath: string;
  sourcePath: string;
  exportVariant?: ExtensibleStringUnion<"cutout" | "sticker">;
  format?: ExtensibleStringUnion<"png">;
  renderMaxDimension?: number;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  mask?: {
    algorithm?: string;
    backgroundColor?: number[];
    featherPx?: number;
    outlinePx?: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
  sharedEvent?: PhotoAssetEventValue;
}

export interface PhotoPortraitBlurExportValue {
  bundlePath: string;
  mediaPath: string;
  targetPath: string;
  manifestPath: string;
  sourcePath: string;
  format?: ExtensibleStringUnion<"png">;
  renderMaxDimension?: number;
  width?: number;
  height?: number;
  depthModel?: string;
  blur?: {
    algorithm?: string;
    depthModel?: string;
    blurStrength?: number;
    sourceWidth?: number;
    sourceHeight?: number;
  };
  sharedEvent?: PhotoAssetEventValue;
}

export interface SemanticSearchPhotoResult {
  sourcePath: string;
  score: number;
  resultKind?: ExtensibleStringUnion<"videoSegment" | "audioSegment">;
  mediaKind?: string;
  segmentId?: string;
  assetId?: string;
  timestampMs?: number;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  frameIndex?: number;
}

export interface SemanticSearchPhotoItem {
  sourcePath: string;
  score: number;
  previewPath?: string;
  previewUrl?: string;
  sourceUrl?: string;
  mediaKind?: string;
  name?: string;
  resultKind?: ExtensibleStringUnion<"videoSegment" | "audioSegment">;
  segmentId?: string;
  assetId?: string;
  timestampMs?: number;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  frameIndex?: number;
}

export interface SemanticSearchPhotosValue {
  available: boolean;
  engine?: string;
  query: string;
  candidateCount?: number;
  imageCandidateCount?: number;
  videoCandidateCount?: number;
  scored: number;
  scoredImages?: number;
  scoredVideoSegments?: number;
  encoded?: number;
  cached?: number;
  skipped?: number;
  missingEmbeddings?: number;
  missingImageEmbeddings?: number;
  missingVideoAssets?: number;
  queued?: boolean;
  queuedJob?: {
    jobId?: string;
    jobKind?: string;
    status?: string;
  } | Record<string, unknown>;
  dropped?: number;
  reason?: string;
  results: SemanticSearchPhotoResult[];
  items?: SemanticSearchPhotoItem[];
  index?: Record<string, unknown>;
  videoIndex?: Record<string, unknown>;
}

export interface PhotoLibraryAgentStatus {
  version: string;
  available: boolean;
  offline: boolean;
  reason?: string;
  model?: Record<string, unknown>;
  limits?: Record<string, number>;
  capabilities?: Record<string, unknown>;
}

export interface PhotoLibraryAgentCitation {
  citationId: number;
  assetId: string;
  title: string;
  captureDate?: string;
  mediaKind?: string;
  matchReasons?: string[];
}

export interface PhotoLibraryAgentPlan {
  planId: string;
  action: string;
  executionLane: ExtensibleStringUnion<"write" | "destructive">;
  confirmationRequired: boolean;
  destructive: boolean;
  estimatedAffectedItems: number;
  payloadKeys: string[];
  createdAt: string;
  expiresAt: string;
  status: ExtensibleStringUnion<"pending" | "executing" | "complete" | "expired">;
}

export interface PhotoLibraryAgentToolTrace {
  index: number;
  tool: string;
  ok: boolean;
  arguments?: Record<string, unknown>;
  fallbackApplied?: boolean;
  error?: string;
}

export interface PhotoLibraryAgentResponse {
  version: string;
  requestId: string;
  answer: string;
  citations: PhotoLibraryAgentCitation[];
  followUps: string[];
  uncertainty?: string;
  intent: string;
  resultAssetIds: string[];
  pendingPlans: PhotoLibraryAgentPlan[];
  toolTrace: PhotoLibraryAgentToolTrace[];
  grounding: {
    citationCandidates: number;
    validCitations: number;
    injectionFlags: Record<string, number>;
    untrustedContentIsolated: boolean;
    answerNeutralized?: boolean;
    answerNeutralizationFlags?: string[];
  };
  model?: Record<string, unknown>;
  offline: boolean;
  elapsedMs: number;
}

export interface PhotoLibraryAgentPlanExecution {
  ok: boolean;
  result?: Record<string, unknown>;
  replayedPlan?: boolean;
  plan: PhotoLibraryAgentPlan;
}

export interface PhotoLiveKeyPhotoValue {
  assetId: string;
  sourcePath: string;
  motionSourcePath?: string;
  timestampMs: number;
  previewPath: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  selectedAt?: string;
  cleared?: boolean;
  metadata?: Record<string, unknown>;
}

export interface PhotoVideoPosterValue {
  assetId: string;
  sourcePath: string;
  timestampMs: number;
  previewPath: string;
  policy?: ExtensibleStringUnion<"manual" | "auto" | "default">;
  previewUrl?: string;
  width?: number;
  height?: number;
  selectedAt?: string;
  cleared?: boolean;
  metadata?: Record<string, unknown>;
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
  clusterPasses?: number;
  clusterModelGroups?: number;
  clusterComponents?: number;
  clusterUniqueInputs?: number;
  clusterDuplicateInputs?: number;
  clusterNoise?: number;
  clusterSpoolPeak?: number;
  safeFiltered: number;
  videoFiles: number;
  videoFrames: number;
  videoTrackObservations?: number;
  videoTracks?: number;
  videoTrackTemplates?: number;
  videoTrackSingletons?: number;
  videoTrackKeyframes?: number;
  videoTrackMatches?: number;
  videoTrackUnmatched?: number;
  videoProtected: number;
  excluded?: number;
  pathErrors?: number;
  cancelled?: number;
  pausedSeconds?: number;
  resumed?: number;
  manifestSkipped?: number;
  hashResumeSkipped?: number;
  embeddingCacheHits?: number;
  embeddingCacheMisses?: number;
  twoPassVerified?: number;
  twoPassChanged?: number;
  twoPassDeferred?: number;
  noFaceDetected?: number;
  lowQualityFaces?: number;
  blockedPairs?: number;
  duplicateCandidates?: number;
  videoCandidateCap?: number;
  profileRescueAttempted?: number;
  profileRescueFound?: number;
  profileRescueMatched?: number;
  profileRescueUnmatched?: number;
  poseFrontal?: number;
  poseThreeQuarter?: number;
  poseProfile?: number;
  poseUnknown?: number;
  poseRelaxedReviews?: number;
  ageGapRelaxedReviews?: number;
  poseRelaxedProfile?: number;
  poseRelaxedThreeQuarter?: number;
  poseReranked?: number;
  poseAmbiguous?: number;
  closeRunnerUp?: number;
  singleReferenceMatches?: number;
  hardPoseUnsupported?: number;
  safeModeFaceCropAllowed?: number;
  memoryPressure?: ExtensibleStringUnion<"normal" | "elevated" | "high" | "critical">;
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
  readiness?: ScanReadiness;
  decoder?: {
    extensions: string[];
    pillow: string[];
    heif: string[];
    raw: string[];
    heifAvailable: boolean;
    rawAvailable: boolean;
  };
  videoDecoder?: VideoDecoderReport;
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

export type CandidateMediaAction = "copy" | "move" | "trash";

export interface CandidateMediaActionValue {
  action: CandidateMediaAction;
  destinationPath: string;
  mediaPath: string;
  manifestPath: string;
  counts: {
    selected: number;
    copied: number;
    moved: number;
    trashed: number;
    skipped: number;
    removedCandidates: number;
    cancelled?: boolean;
    verified?: number;
    verificationFailed?: number;
  };
  items: Array<{
    candidateId: string;
    personName: string;
    sourcePath: string;
    targetPath: string;
    action: CandidateMediaAction;
    result: string;
    reason?: string;
    sourceSizeBytes?: number;
    targetSizeBytes?: number;
    verified?: boolean;
    verifyStatus?: string;
  }>;
}

export interface CandidateMediaPreviewValue {
  action: CandidateMediaAction;
  destinationRoot: string;
  counts: {
    selected: number;
    actionable: number;
    uniqueSources: number;
    duplicateSources: number;
    missing: number;
    symlinks: number;
    protectedReferences: number;
    generatedFiles: number;
    skipped: number;
    removedCandidatesEstimate: number;
    totalBytes: number;
  };
  storage: {
    path: string;
    freeBytes: number;
    totalBytes: number;
  };
  warnings: string[];
  items: Array<{
    candidateId: string;
    personName: string;
    sourcePath: string;
    mediaKind: string;
    sizeBytes: number;
    duplicate: boolean;
    result: string;
    reason?: string;
  }>;
  itemsOffset: number;
  itemsLimit: number;
  itemsTotal: number;
  truncated: boolean;
}

export interface MediaActionHistoryValue {
  items: Array<{
    manifestPath: string;
    generatedAt: string;
    action: ExtensibleStringUnion<CandidateMediaAction>;
    destinationPath: string;
    mediaPath: string;
    counts: CandidateMediaActionValue["counts"];
    exists: boolean;
    canRestore: boolean;
    canUndo: boolean;
    canRetry: boolean;
    skippedItems: CandidateMediaActionValue["items"];
  }>;
  total: number;
}

export interface MediaActionRestoreValue {
  manifestPath: string;
  counts: {
    restored: number;
    missing: number;
    existing: number;
    skipped: number;
  };
  items: Array<Record<string, unknown>>;
}

export interface MediaActionUndoValue {
  manifestPath: string;
  undoManifestPath: string;
  undoPath: string;
  counts: {
    restored: number;
    removedCopies: number;
    missing: number;
    existing: number;
    skipped: number;
  };
  items: Array<Record<string, unknown>>;
}

export interface MediaTrashReportValue {
  generatedAt: string;
  trashPath: string;
  counts: {
    actions: number;
    files: number;
    recoverableFiles: number;
    bytes: number;
    olderThanDays: Record<string, number>;
  };
  actions: Array<{
    manifestPath: string;
    destinationPath: string;
    generatedAt: string;
    ageDays: number;
    files: number;
    recoverableFiles: number;
    bytes: number;
  }>;
}

export interface MediaTrashCleanupValue {
  generatedAt: string;
  dryRun: boolean;
  days: number;
  deletedDirs: number;
  deletedFiles: number;
  deletedBytes: number;
  previewDirs: number;
  previewFiles: number;
  previewBytes: number;
  targets: Array<{ path: string; files: number; bytes: number }>;
}

export interface MediaActionProgress {
  phase: ExtensibleStringUnion<"started" | "processing" | "complete" | "cancelled" | "error">;
  action: ExtensibleStringUnion<CandidateMediaAction>;
  processed: number;
  total: number;
  currentPath?: string;
  message?: string;
  destinationPath?: string;
  elapsedMs?: number;
  etaMs?: number | null;
  copied?: number;
  moved?: number;
  trashed?: number;
  skipped?: number;
  removedCandidates?: number;
  state?: AppState;
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

export interface WorkspaceBackupRestoreValue {
  generatedAt: string;
  ok: boolean;
  zipPath: string;
  targetRoot: string;
  fileCount: number;
  bytes: number;
  manifest: Record<string, unknown>;
  stateSummary: {
    workspaceId: string;
    references: number;
    candidates: number;
    scanRuns: number;
  };
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
    subjectReleases?: number;
    destructionReceipts?: number;
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
    policyVersion?: string;
    policyHash?: string;
    jurisdictionPreset?: string;
    publicPolicyRequired?: boolean;
    enforcementEnabled?: boolean;
    recommendedReviewedRetentionDays: number;
    reviewedStatuses: CandidateStatus[];
    pendingRowsAreKept: boolean;
    originalMediaIsNeverDeleted: boolean;
    publication?: PolicyPublicationStatus;
  };
  due?: {
    reviewedCandidates: number;
    pendingCandidates: number;
    expiredSubjects: number;
    auditEvents: number;
  };
  recommendations: string[];
}

export interface PolicyPublicationStatus {
  required: boolean;
  recorded: boolean;
  current: boolean;
  publicUrl: string;
  approvedBy: string;
  publishedAt?: string | null;
  recordedAt?: string | null;
}

export interface BiometricRetentionPolicy {
  schemaVersion: number;
  policyVersion: string;
  policyHash: string;
  jurisdictionPreset: string;
  title: string;
  status: string;
  publicPolicyRequired: boolean;
  enforcementEnabled: boolean;
  publication: PolicyPublicationStatus;
  schedule: {
    subjectTemplates: { destroyOn: string[]; maximumDaysAfterLastInteraction?: number | null };
    reviewedMatches: { retainDays: number };
    pendingMatches: { retainDays: number };
    auditEvidence: { retainDays: number; subjectNamesPseudonymized: boolean };
    originalMedia: { managedByPolicy: boolean; reason: string };
  };
  destructionMethod: string;
  operatorAction: string;
  sources: Array<{ label: string; url: string }>;
  disclaimer: string;
}

export interface ComplianceSubjectRecord {
  personName: string;
  releaseId: string;
  recordHash: string;
  active: boolean;
  complete: boolean;
  expired: boolean;
  signerName: string;
  signerRole: string;
  specificPurpose: string;
  collectionTermDays: number;
  lawfulBasis: string;
  confirmedAt?: string | null;
  expiresAt?: string | null;
}

export interface ComplianceStatus {
  jurisdiction: Jurisdiction;
  aiDisclosure: AiDisclosureStatus;
  retentionPolicy: BiometricRetentionPolicy;
  subjects: {
    total: number;
    active: number;
    complete: number;
    expired: number;
    records: ComplianceSubjectRecord[];
    biometric: number;
    covered: number;
    missing: number;
    missingNames: string[];
  };
  processingAllowed: boolean;
  evidenceReady: boolean;
  startupEnforcement?: RetentionEnforcementValue | null;
}

export interface SubjectReleaseInput {
  personName: string;
  signerName: string;
  signerRole: string;
  specificPurpose: string;
  collectionTermDays: number;
  lawfulBasis: string;
  writtenNoticeAcknowledged: boolean;
  electronicSignatureAccepted: boolean;
  aiDisclosureAcknowledged: boolean;
}

export interface SubjectDataDeletionValue {
  references: number;
  candidates: number;
  generatedFiles: number;
  generatedBytes: number;
  receiptPath: string;
  receipt: {
    receiptId: string;
    receiptHash: string;
    destroyedAt: string;
    originalMediaDeleted: boolean;
  };
  dbDeleted: Record<string, number>;
}

export interface BiometricPolicyExportValue {
  jsonPath: string;
  markdownPath: string;
  htmlPath: string;
  policyHash: string;
  documentHash: string;
  policyVersion: string;
}

export interface RetentionEnforcementValue {
  enabled: boolean;
  source: string;
  jurisdictionPreset: string;
  expiredSubjectsDeleted: number;
  reviewedCandidatesDeleted: number;
  pendingCandidatesDeleted: number;
  auditEventsDeleted: number;
  auditCheckpointHash?: string;
  destructionReceipts: Array<Record<string, unknown>>;
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

export interface ModelLifecycleMetric {
  path: string;
  direction: "higher" | "lower";
  actual: number | null;
  baseline?: number | null;
  ok: boolean;
  failures?: string[];
}

export interface ModelLifecycleComponent {
  id: string;
  label: string;
  family: string;
  status: "pass" | "not-installed" | "unavailable" | "blocked" | "candidate-rejected";
  runtime: {
    installed: boolean;
    available: boolean;
    verified: boolean;
    version: string;
    fingerprint: string;
    reason: string;
  };
  baseline: {
    passed: boolean;
    integrity: boolean;
    reportSha256: string;
    reportName: string;
    metrics: ModelLifecycleMetric[];
    failures: string[];
  };
  candidate?: {
    passed: boolean;
    reportSha256: string;
    reportName: string;
    metrics: ModelLifecycleMetric[];
    failures: string[];
  } | null;
  datasets: Array<{
    id: string;
    version: string;
    kind: string;
    verified: boolean;
    verification: string;
    claimBoundary?: string;
  }>;
  rollback: {
    mode: "configuration" | "application-release";
    fields: string[];
  };
  failures: string[];
}

export interface ModelLifecycleStatus {
  schemaVersion: number;
  generatedAt: string;
  policyId: string;
  policyVersion: string;
  policySha256: string;
  offlineOnly: boolean;
  ready: boolean;
  counts: {
    components: number;
    passed: number;
    notInstalled: number;
    unavailable: number;
    blocked: number;
    candidateRejected: number;
    datasetManifests: number;
    datasetManifestsVerified: number;
  };
  components: ModelLifecycleComponent[];
  blockers: string[];
  warnings: string[];
  state: {
    accepted: number;
    staged: number;
    history: number;
    configurationHistory: number;
    updatedAt: string;
  };
}

export interface ReferenceGapItem {
  personName: string;
  referenceCount: number;
  compatibleReferences: number;
  otherModelReferences: number;
  poseCounts: {
    frontal: number;
    threeQuarter: number;
    profile: number;
    edgeFace: number;
    unknown: number;
  };
  ageBuckets: Record<ExtensibleStringUnion<AgeBucket>, number>;
  averageQuality: number;
  bestQuality: number;
  pendingCandidates: number;
  acceptedCandidates: number;
  rejectedCandidates: number;
  uncertainCandidates: number;
  strongPending: number;
  lowConfidencePending: number;
  sampleReferenceNames: string[];
  gaps: string[];
  actions: string[];
  score: number;
  status: ExtensibleStringUnion<"strong" | "usable" | "weak" | "blocked">;
}

export interface ReferenceGapReport {
  generatedAt: string;
  currentModel: string;
  people: number;
  needsAttention: number;
  strongPeople: number;
  averageScore: number;
  topGaps: Array<{ gap: string; count: number }>;
  items: ReferenceGapItem[];
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

export interface PhotoRelationshipSharedRelationship {
  personName: string;
  sourceCooccurrences: number;
  targetCooccurrences: number;
  support: number;
}

export interface PhotoRelationshipNameSuggestion {
  suggestionId: string;
  evidenceHash: string;
  graphVersion: string;
  sourceCluster: string;
  targetPerson: string;
  score: number;
  confidence: ExtensibleStringUnion<"strong" | "moderate">;
  sourceAssetCount: number;
  targetAssetCount: number;
  sharedRelationshipCount: number;
  relationshipSupport: number;
  directCooccurrenceCount: 0;
  sharedRelationships: PhotoRelationshipSharedRelationship[];
  scoreComponents: {
    weightedNeighborhoodOverlap: number;
    sourceNeighborhoodCoverage: number;
    supportStrength: number;
  };
  reason: string;
  reviewRequired: true;
  autoApply: false;
  undoAvailable: true;
}

export interface PhotoRelationshipNameSuggestionResult {
  available: boolean;
  reason: string;
  generatedAt: string;
  graphVersion: string;
  graphHash: string;
  graphStats: {
    nodes: number;
    namedPeople: number;
    unknownClusters: number;
    edges: number;
    candidatesEvaluated: number;
    blockedByDirectCooccurrence: number;
  };
  minimums?: {
    score: number;
    sourceAssets: number;
    relationshipSupport: number;
  };
  suggestions: PhotoRelationshipNameSuggestion[];
  reviewRequired: true;
  autoApplied?: 0;
  offline: true;
}

export interface PhotoRelationshipNameReviewResult {
  applied: boolean;
  dismissed: boolean;
  idempotentReplay: boolean;
  operationId?: string;
  operation?: PhotoOperation;
  renamed?: {
    references: number;
    candidates: number;
    peopleRows: number;
    groupRows: number;
    profileMerged: boolean;
    identityMerged: boolean;
  };
  suggestion?: PhotoRelationshipNameSuggestion;
  review?: {
    suggestionId: string;
    sourceCluster: string;
    targetPerson: string;
    evidenceHash: string;
    decision: ExtensibleStringUnion<"dismissed" | "applied">;
    operationId: string;
    reviewedAt: string;
  };
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
  hashResumeEntries?: number;
  safetyCacheEntries: number;
  embeddingCacheEntries?: number;
  reviewCandidateRows?: number;
  calibrationLabels: number;
  learnedArtifacts?: number;
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
  learnedArtifacts?: number;
}

export interface CalibrationLearningArtifact {
  artifactId?: string;
  artifactType?: string;
  status: ExtensibleStringUnion<"candidate" | "staged" | "promoted" | "rejected" | "rolled_back">;
  modelName?: string;
  versionKey?: string;
  trainingDataHash?: string;
  inputCount?: number;
  positiveCount?: number;
  negativeCount?: number;
  metrics?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  artifactHash?: string;
  parentArtifactId?: string;
  createdAt?: string;
  promotedAt?: string | null;
}

export interface CalibrationLearningReadiness {
  ready: boolean;
  reason: string;
  labels: number;
  positiveLabels: number;
  negativeLabels: number;
  labelsDroppedOtherModel: number;
  dominantModel: string;
  minimumLabels: number;
  minimumPerClass: number;
  autoStageMinNewLabels: number;
  newLabelsSinceLastArtifact: number;
  currentTrainingDataHash: string;
  latestArtifactId: string;
  latestArtifactStatus: string;
  latestTrainingDataHash: string;
  latestInputCount: number;
  consentRequired: boolean;
  consentActive: boolean;
  workspaceLocked?: boolean;
  learningMode?: string;
}

export interface CalibrationLearningStatus {
  summary: CalibrationSummary;
  current: {
    thresholds?: Record<string, number>;
    calibrationPlatt?: number[];
    calibrationModel?: string;
  };
  artifacts: CalibrationLearningArtifact[];
  readiness?: CalibrationLearningReadiness;
}

export interface EmbeddingAdapterReadiness {
  ready: boolean;
  reason: string;
  labels: number;
  positiveLabels: number;
  negativeLabels: number;
  labelsDroppedOtherModel: number;
  dominantModel: string;
  minimumLabels: number;
  minimumPerClass: number;
  currentTrainingDataHash: string;
  latestArtifactId: string;
  latestArtifactStatus: string;
  latestTrainingDataHash: string;
  latestInputCount: number;
  consentRequired: boolean;
  consentActive: boolean;
  workspaceLocked?: boolean;
  learningMode?: string;
  featureVersion?: string;
  adapterVersion?: string;
}

export interface EmbeddingAdapterCoverageTarget {
  id: string;
  label: string;
  desiredLabel: string;
  count: number;
  minCount: number;
  ready: boolean;
  remaining: number;
  action: string;
  contextKeys?: string[];
}

export interface EmbeddingAdapterCoverage {
  featureVersion: string;
  contextVersion: string;
  labels: number;
  targetCount: number;
  coveredTargets: number;
  missingTargets: number;
  ready: boolean;
  targets: EmbeddingAdapterCoverageTarget[];
  nextActions: string[];
  contextCounts?: Array<Record<string, unknown>>;
}

export interface EmbeddingAdapterStatus {
  summary: {
    totalExamples: number;
    positiveExamples: number;
    negativeExamples: number;
    people: number;
    models: number;
    byModel?: Record<string, number>;
  };
  artifacts: CalibrationLearningArtifact[];
  activeArtifact?: CalibrationLearningArtifact | null;
  readiness?: EmbeddingAdapterReadiness;
  coverage?: EmbeddingAdapterCoverage;
}

export interface SelfLearningRdStatus {
  ok: boolean;
  status: string;
  notProductionAuthorization: boolean;
  auditPath: string;
  satisfied: string[];
  blocked: string[];
  blockers: string[];
  sourceReports?: Record<string, unknown>;
  reportHash?: string;
  message?: string;
}

export interface CalibrationLearningResult {
  artifact?: CalibrationLearningArtifact;
  status?: string;
  promotable?: boolean;
  payload?: Record<string, unknown>;
  metrics?: Record<string, unknown>;
  summary?: CalibrationSummary;
  promoted?: boolean;
  rolledBack?: boolean;
  artifactId?: string;
  artifactHash?: string;
  promotedAt?: string;
  validation?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface LearningJobsResult {
  staged: boolean;
  artifactCreated: boolean;
  artifactStatus?: string;
  reason: string;
  calibration?: CalibrationLearningResult;
  readiness: CalibrationLearningReadiness;
  status?: CalibrationLearningStatus;
  summary?: CalibrationSummary;
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

export interface TrainingExamplesExportValue {
  jsonPath: string;
  csvPath: string;
  counts: {
    examples: number;
    matches: number;
    nonMatches: number;
    people: number;
    models: number;
    pathsIncluded: boolean;
  };
  trainingDataHash: string;
}

export interface TrainingExamplesImportValue {
  imported: number;
  skipped: number;
  summary: {
    totalExamples: number;
    positiveExamples: number;
    negativeExamples: number;
    people: number;
    models: number;
    byModel: Record<string, number>;
  };
}

export interface AccuracyValidationPackValue {
  packPath: string;
  manifestPath: string;
  labelsJsonPath: string;
  labelsCsvPath: string;
  counts: {
    cases: number;
    matches: number;
    nonMatches: number;
  };
  scenarios: string[];
  metrics: Record<string, AccuracyBucket>;
  segments: Record<string, AccuracyBucket>;
  recommendations: string[];
  runId?: string;
  status?: ExtensibleStringUnion<"pass" | "warn" | "fail">;
  passed?: number;
  warned?: number;
  failed?: number;
  scenarioResults?: AccuracyValidationScenarioResult[];
  validation?: AccuracyValidationRun;
  history?: AccuracyValidationRun[];
  importResult?: AccuracyLabelsImportValue | null;
}

export interface AccuracyValidationScenarioResult {
  scenario: string;
  status: ExtensibleStringUnion<"pass" | "warn" | "fail">;
  expectedMatch: boolean;
  score: number;
  likelyThreshold: number;
  reviewMoreThreshold: number;
  difficulty: string;
  mediaKind: string;
  detail: string;
}

export interface AccuracyValidationRun {
  runId: string;
  generatedAt: string;
  status: ExtensibleStringUnion<"pass" | "warn" | "fail">;
  passed: number;
  warned: number;
  failed: number;
  scenarioResults: AccuracyValidationScenarioResult[];
  thresholds: Record<string, number>;
  metrics: Record<string, AccuracyBucket>;
  segments: Record<string, AccuracyBucket>;
  counts: {
    cases: number;
    matches: number;
    nonMatches: number;
  };
  packPath: string;
  manifestPath: string;
  labelsJsonPath: string;
  labelsCsvPath: string;
  recommendations: string[];
}

export interface PublicDatasetCatalogEntry {
  datasetId: string;
  name: string;
  shortName: string;
  bestFor: string[];
  scale: {
    images: number;
    identities: number;
    videos: number;
  };
  inputMode: string;
  layout: string;
  download: {
    available: boolean;
    method: string;
    requiresConfirmation?: boolean;
  };
  sourceUrl: string;
  terms: string;
  recommendedUse: string;
  requiresTermsAcknowledgement?: boolean;
}

export interface PublicDatasetCatalog {
  generatedAt: string;
  datasets: PublicDatasetCatalogEntry[];
  policy: Record<string, string>;
}

export interface PublicDatasetInspection {
  generatedAt: string;
  datasetId: string;
  folder: string;
  exists: boolean;
  identityCount: number;
  usableIdentityCount: number;
  imageCount: number;
  videoCount: number;
  entriesChecked: number;
  truncated: boolean;
  durationMs: number;
  samples: Array<{
    identity: string;
    images: number;
    videos: number;
    folder: string;
  }>;
  recommendations: string[];
}

export interface PublicDatasetBenchmarkResult {
  generatedAt: string;
  datasetId: string;
  datasetFolder: string;
  runRoot: string;
  workspace: string;
  engine: string;
  durationMs: number;
  preparation: Record<string, unknown>;
  inspection: PublicDatasetInspection;
  truncated: boolean;
  entriesChecked: number;
  selected: {
    identities: number;
    distractorIdentities: number;
    references: number;
    candidates: number;
    videoFiles?: number;
    videoFrames?: number;
  };
  pipeline: {
    enrolled: number;
    scanAdded: number;
    scanMetrics: Record<string, number>;
    enrollErrors: string[];
    scanErrors: string[];
    videoDecodeFailures?: Array<{
      sourcePath: string;
      error: string;
      datasetId?: string;
    }>;
    ageTrajectory?: {
      enabled: boolean;
      protocolVersion: string;
      methodVersion: string;
      generatedImages: false;
      externalAgingWeights: false;
      added: number;
      retained: number;
      people: number;
    };
  };
  metrics: {
    evaluated: number;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    wrongIdentity: number;
    precision: number;
    recall: number;
    specificity: number;
    accuracy: number;
  };
  metricsByThreshold?: Record<string, {
    threshold: number;
    evaluated: number;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    wrongIdentity: number;
    precision: number;
    recall: number;
    specificity: number;
    accuracy: number;
  }>;
  thresholdCalibration?: {
    generatedAt: string;
    pack?: string;
    labelCount: number;
    positiveCount: number;
    negativeCount: number;
    targetPrecision: number;
    strongPrecision: number;
    currentThresholds: Record<string, number>;
    recommendedThresholds: Record<string, number>;
    overall: Record<string, {
      threshold: number | null;
      evaluated: number;
      positives: number;
      negatives: number;
      truePositives: number;
      falsePositives: number;
      trueNegatives: number;
      falseNegatives: number;
      wrongIdentity: number;
      precision: number;
      recall: number;
      specificity: number;
      accuracy: number;
    }>;
    groups: Record<string, {
      key: string;
      label: string;
      count: number;
      positives: number;
      negatives: number;
      recommendedLikelyThreshold: number;
      metrics: {
        threshold: number | null;
        evaluated: number;
        positives: number;
        negatives: number;
        truePositives: number;
        falsePositives: number;
        trueNegatives: number;
        falseNegatives: number;
        wrongIdentity: number;
        precision: number;
        recall: number;
        specificity: number;
        accuracy: number;
      };
    }>;
    recommendations: string[];
  };
  validationMatrix?: Record<string, {
    key: string;
    label: string;
    group: string;
    count: number;
    evaluated: number;
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    wrongIdentity: number;
    precision: number;
    recall: number;
    specificity: number;
    accuracy: number;
    recommendations: string[];
  }>;
  labelsJsonPath: string;
  labelsCsvPath: string;
  reportPath: string;
  recommendations: string[];
  importResult?: AccuracyLabelsImportValue | null;
}

export interface CrossAgeTrajectoryBenchmarkResult {
  schemaVersion: number;
  protocolVersion: string;
  methodVersion: string;
  generatedAt: string;
  datasetId: "agedb" | "calfw" | "fgnet";
  status: "pass" | "fail";
  durationMs: number;
  datasetEvidence: {
    folderName: string;
    manifestPath: string;
    manifestSha256: string;
    termsAcknowledged: true;
    benchmarkOnly: true;
  };
  baseline: PublicDatasetBenchmarkResult;
  augmented: PublicDatasetBenchmarkResult;
  comparison: {
    evaluated: number;
    generatedReferences: number;
    syntheticBestMatches: number;
    syntheticEvidenceMatches: number;
    syntheticTruePositiveEvidence: number;
    identityChanges: number;
    improvements: number;
    regressions: number;
    precisionDelta: number;
    recallDelta: number;
    genuineScoreImproved: number;
    genuineScoreRegressed: number;
    meanGenuineScoreDelta: number;
    nonmatchScoreIncreased: number;
    meanNonmatchScoreDelta: number;
    improvementSamples: Array<Record<string, unknown>>;
    regressionSamples: Array<Record<string, unknown>>;
  };
  gates: Record<string, boolean>;
  limitations: string[];
  reportPath: string;
}

export interface PublicDatasetModelComparisonPack {
  pack: string;
  label: string;
  available: boolean;
  status: ExtensibleStringUnion<"complete" | "missing" | "error">;
  engine: string;
  error: string;
  metrics: PublicDatasetBenchmarkResult["metrics"] | null;
  metricsByThreshold?: PublicDatasetBenchmarkResult["metricsByThreshold"] | null;
  thresholdCalibration?: PublicDatasetBenchmarkResult["thresholdCalibration"] | null;
  validationMatrix?: PublicDatasetBenchmarkResult["validationMatrix"] | null;
  recommendationScore?: number;
  recommendationReasons?: string[];
  pipeline: PublicDatasetBenchmarkResult["pipeline"] | null;
  reportPath: string;
  runRoot: string;
  recommendations: string[];
}

export interface ModelPackRecommendation {
  status: ExtensibleStringUnion<"switch" | "keep" | "unavailable">;
  recommendedPack: string | null;
  recommendedLabel?: string;
  currentPack: string;
  confidence: ExtensibleStringUnion<"high" | "medium" | "low" | "none">;
  score?: number;
  currentScore?: number | null;
  margin?: number;
  precision?: number;
  recall?: number;
  profileRecall?: number;
  crossAgeRecall?: number;
  wrongIdentity?: number;
  hardNegativeFalsePositives?: number;
  summary: string;
  reasons: string[];
  actions: string[];
}

export interface PublicDatasetModelComparisonResult {
  generatedAt: string;
  datasetId: string;
  datasetFolder: string;
  durationMs: number;
  packs: PublicDatasetModelComparisonPack[];
  bestPrecisionPack: string | null;
  bestRecallPack: string | null;
  recommendedPack?: string | null;
  recommendation?: ModelPackRecommendation;
  reportPath: string;
  recommendations: string[];
}

export interface CandidateQueryResult {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  items: ReviewCandidate[];
  index?: "sqlite" | "memory";
}

export interface PhotoReviewMoreSuggestionValue {
  candidateIds: string[];
  items?: Array<Record<string, unknown>>;
  count: number;
  includedPeople?: string[];
  excludedPeople?: string[];
  includedPets?: string[];
  excludedPets?: string[];
  requestedPeople?: string[];
  requestedExcludePeople?: string[];
  requestedPets?: string[];
  requestedExcludePets?: string[];
  statuses?: string[];
  provenance?: string;
  limit?: number;
  minScore?: number;
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
  closeRunnerUpPending?: number;
  singleReferencePending?: number;
  laneCounts?: Record<string, number>;
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
  licenseState: ExtensibleStringUnion<"declared" | "missing" | "needs-review">;
  installed: boolean;
  archivePath: string;
  installedPath: string;
  accuracyTier?: string;
  humanReviewRequired?: boolean;
  redistributionRisk?: string;
  limitations?: string[];
  validation?: string[];
  redistributionReady: boolean;
}

export interface ModelDistributionAudit {
  generatedAt: string;
  ok: boolean;
  items: ModelDistributionItem[];
  blockers: ModelDistributionItem[];
  recommendations: string[];
}

export interface Jurisdiction {
  id: string;
  label: string;
  retentionReviewedDays: number;
  retentionPendingDays?: number;
  requireExplicitConsent: boolean;
  perSubjectConsent: boolean;
  dataMinimization: boolean;
  auditRetentionDays: number;
  biometricMaxRetentionDays?: number;
  defaultCollectionTermDays?: number;
  writtenReleaseRequired?: boolean;
  publicPolicyRequired?: boolean;
  enforceByDefault?: boolean;
  sources?: Array<{ label: string; url: string }>;
  notes: string;
}

export interface AuditChainStatus {
  verified: boolean;
  length: number;
  chained: number;
  legacy: number;
  head: string;
  tail: string;
  firstBreak: null | { index: number; reason: string; seq?: number };
}

export interface PhotoAssetIndexPage {
  total: number;
  offset: number;
  limit: number;
  returned: number;
  items: PhotoAsset[];
  searchIndex: Record<string, unknown>;
}

export interface ReferenceSuggestion {
  artifactId: string;
  artifactHash: string;
  status: ExtensibleStringUnion<"candidate" | "staged" | "promoted" | "rejected" | "rolled_back">;
  candidateId: string;
  personName: string;
  sourceHash: string;
  modelName: string;
  score: number;
  quality: number;
  poseBucket: string;
  mediaKind: string;
  previewPath?: string | null;
  previewUrl?: string | null;
  candidateAvailable: boolean;
  createdAt?: string;
  promotedAt?: string | null;
  metrics?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

export interface SyntheticEnrollmentScreenReport {
  available: boolean;
  verified: boolean;
  engine: string;
  modelId: string;
  version: string;
  reviewThreshold?: number;
  stableScore?: string;
  action: ExtensibleStringUnion<"stage-for-human-review">;
  license?: string;
  purpose?: string;
  limitations?: string[];
  reason?: string;
  runtimeValidated?: boolean;
}

export interface SyntheticEnrollmentReview {
  artifactId: string;
  artifactHash: string;
  status: ExtensibleStringUnion<"candidate" | "staged" | "promoted" | "rejected" | "rolled_back">;
  personName: string;
  ageBucket: AgeBucket;
  sourceHash: string;
  recognizerModel: string;
  screenModelId: string;
  screenModelVersion: string;
  screenAvailable: boolean;
  reviewReason: ExtensibleStringUnion<"score-threshold" | "screen-unavailable">;
  stableScore?: number | null;
  originalScore?: number | null;
  recompressedScore?: number | null;
  reviewThreshold?: number | null;
  quality: number;
  poseBucket: string;
  previewPath?: string | null;
  previewUrl?: string | null;
  sourceAvailable: boolean;
  createdAt?: string;
  promotedAt?: string | null;
}

export interface SyntheticAgeImageReviewStatus {
  methodVersion: string;
  artifactType: string;
  reviewOnly: true;
  autoEnrollment: false;
  counts: Record<string, number>;
}

export interface SyntheticAgeImageReview {
  artifactId: string;
  artifactHash: string;
  status: ExtensibleStringUnion<"candidate" | "staged" | "promoted" | "rejected" | "rolled_back">;
  personName: string;
  targetAgeBucket: AgeBucket;
  parentRefId: string;
  generatedHash: string;
  generatedPath: string;
  generatedUrl?: string;
  recognizerModel: string;
  generationModel: string;
  generationModelRevision: string;
  generationLicense: string;
  quality: number;
  targetIdentityCosine: number;
  parentCosine: number;
  nearestOtherCosine?: number | null;
  identityMargin?: number | null;
  reasons: string[];
  reviewOnly: true;
  authenticCapture: false;
  futureAppearancePrediction: false;
  generatedAvailable: boolean;
  createdAt?: string;
  promotedAt?: string | null;
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
  safeModeExplain?: SafeModeExplainReport;
  modelSetup?: ModelSetupReport;
  modelCompatibility?: ModelCompatibilityReport;
  videoDecoder?: VideoDecoderReport;
  references: ReferenceFace[];
  candidates: ReviewCandidate[];
  referenceSuggestions?: ReferenceSuggestion[];
  syntheticEnrollmentScreen?: SyntheticEnrollmentScreenReport;
  syntheticEnrollmentReviews?: SyntheticEnrollmentReview[];
  syntheticAgeImageReviewStatus?: SyntheticAgeImageReviewStatus;
  syntheticAgeImageReviews?: SyntheticAgeImageReview[];
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
  reviews?: number;
  screened?: number;
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
  phase: "started" | "processing" | "protected" | "candidate" | "processed" | "clustering" | "verifying" | "verified" | "model_backfill" | "paused" | "error" | "complete" | "cancelled";
  source?: ExtensibleStringUnion<"manual" | "watch" | "camera">;
  currentPath?: string;
  candidateId?: string;
  message?: string;
  safety_score?: number;
  elapsedMs?: number | null;
  etaMs?: number | null;
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

export interface MediaActionProgressEvent {
  id: number;
  name: "media_action";
  payload: MediaActionProgress;
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

export interface PhotoTetherCamera {
  id: string;
  model: string;
  port: string;
}

export interface PhotoTetherCameraStatus {
  available: boolean;
  executableAvailable?: boolean;
  version: string;
  cameras: PhotoTetherCamera[];
  captureSupported: boolean;
  message: string;
  error?: string;
}

export interface PhotoTetherCapture {
  captureId: string;
  sessionId: string;
  sequence: number;
  sourcePath: string;
  sourceSignature: string;
  status: "pending" | "interrupted" | "imported" | "failed";
  targetPath: string;
  assetId: string;
  importId: string;
  sizeBytes: number;
  capturedAt: string;
  importedAt: string;
  updatedAt: string;
  error: string;
  metadata: Record<string, unknown>;
  previewUrl?: string;
}

export interface PhotoTetherSession {
  sessionId: string;
  mode: "watch" | "ptp";
  status: "active" | "recoverable" | "stopped" | "error";
  sourcePath: string;
  destinationPath: string;
  storageMode: "referenced" | "managed";
  managedRoot: string;
  namingTemplate: string;
  nextSequence: number;
  sourceLabel: string;
  camera: PhotoTetherCamera;
  capabilities: PhotoTetherCameraStatus;
  settings: {
    includeExisting?: boolean;
    autoResume?: boolean;
    liveReview?: boolean;
  };
  startedAt: string;
  stoppedAt: string;
  updatedAt: string;
  importedCount: number;
  failedCount: number;
  lastCaptureId: string;
  lastError: string;
  captures?: PhotoTetherCapture[];
}

export interface PhotoTetherStatus {
  active: boolean;
  sessionId: string;
  mode: "" | "watch" | "ptp";
  sourcePath: string;
  queued: number;
  importing: boolean;
  captureBusy: boolean;
  watchMode: string;
  message: string;
  session: PhotoTetherSession | null;
  recoverable: PhotoTetherSession[];
  recent: PhotoTetherSession[];
  camera: PhotoTetherCameraStatus;
}

export interface PhotoTetherStartOptions {
  mode: "watch" | "ptp";
  sourcePath: string;
  destinationPath?: string;
  storageMode: "referenced" | "managed";
  managedRoot?: string;
  namingTemplate: string;
  nextSequence?: number;
  sourceLabel?: string;
  cameraId?: string;
  includeExisting?: boolean;
  autoResume?: boolean;
  liveReview?: boolean;
  refreshCamera?: boolean;
}

export interface PhotoTetherEvent extends Partial<PhotoTetherStatus> {
  type: string;
  capture?: PhotoTetherCapture;
  asset?: Partial<PhotoItem> & Record<string, unknown>;
  previewUrl?: string;
  error?: string;
  code?: string;
  dropped?: number;
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

export interface WorkspaceEncryptionStatus {
  required: boolean;
  enabled: boolean;
  keyId: string;
  databaseCipher: string;
  sensitiveFilesCipher: string;
  migrationComplete: boolean;
  recoveryConfigured: boolean;
  recoveryPendingCovered: boolean;
  plaintextVectorSidecars: string[];
  database: {
    required: boolean;
    enabled: boolean;
    encryptedHeader: boolean;
    plaintextHeader: boolean;
    keyId: string;
    cipherVersion: string;
    cipherIntegrity: string[];
    walEncryptedByDatabaseCodec: boolean;
    temporaryStorage: string;
  };
  sensitiveFiles: Array<{ name: string; exists: boolean; encrypted: boolean }>;
  rotation?: { oldKeyId: string; newKeyId: string; pending: boolean };
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
  | { type: "navigate"; tab: "dashboard" | "enroll" | "scan" | "review" | "photos" | "settings" }
  | { type: "photos-shortcut"; shortcut: "selectPage" | "delete" }
  | { type: "open-workspace" }
  | { type: "open-workspace-folder" }
  | { type: "reveal-workspace" }
  | { type: "refresh" }
  | { type: "scan" }
  | { type: "start-watch" }
  | { type: "stop-watch" };

export type PhotoImportSourceKind = "folder" | "camera" | "library" | "mail" | "safari" | "messages" | "airdrop" | "downloads" | "app";

export type PhotoExternalImportRequest = {
  id: number;
  paths: string[];
  sourceKind?: PhotoImportSourceKind;
  sourceLabel?: string;
  sourceDetail?: string;
};

export type ExternalOpenPayload =
  | { type: "workspace"; path: string; source?: string }
  | { type: "scan-folder"; path: string; source?: string }
  | { type: "watch-folder"; path: string; source?: string }
  | { type: "scan-files"; paths: string[]; source?: string }
  | { type: "photos-import"; paths: string[]; source?: string; sourceKind?: PhotoImportSourceKind; sourceLabel?: string; sourceDetail?: string };

/** A path the main process has granted, with a vintrace-media:// thumbnail URL. */
export interface MediaRef {
  path: string;
  url: string;
  isDir: boolean;
  sourceKind?: PhotoImportSourceKind;
  sourceLabel?: string;
  sourceDetail?: string;
}

export interface McpHttpStatus {
  running: boolean;
  url: string;
  host: string;
  port: number;
  token: string;
  error: string;
}

export interface MobileCompanionDevice {
  accountId: string;
  label: string;
  status: "pending" | "paired" | "pairing-expired" | "expired" | "revoked";
  allowPreviews: boolean;
  createdAt: string;
  pairedAt: string;
  expiresAt: number | null;
  pairingExpiresAt: number | null;
  revokedAt: string;
}

export interface MobileCompanionStatus {
  publicUrl: string;
  appUrl: string;
  secure: boolean;
  loopback: boolean;
  source: "environment" | "saved" | "default";
  canEditEndpoint: boolean;
  readyForPairing: boolean;
  serverRunning: boolean;
  devices: MobileCompanionDevice[];
}

export interface MobileCompanionPairingResult {
  ok: boolean;
  device: MobileCompanionDevice;
  pairingUrl: string;
  status: MobileCompanionStatus;
}

export interface MobileCompanionRevokeResult {
  ok: boolean;
  device: MobileCompanionDevice;
  status: MobileCompanionStatus;
}

export interface LocalSyncPeer {
  deviceId: string;
  label: string;
  host: string;
  port: number;
  status: "active" | "revoked";
  pairedAt: string;
  revokedAt: string;
  lastSyncAt: string;
  lastError: string;
}

export interface LocalSyncStatus {
  protocol: "vintrace-local-sync-v1";
  available: boolean;
  initialized: boolean;
  deviceId: string;
  deviceLabel: string;
  encryptionRequired: true;
  encryptionReady: boolean;
  server: {
    running: boolean;
    port: number;
    addresses: string[];
    discoveryEnabled: boolean;
    discoveryError: string;
  };
  discoveryRuntime: {
    available: boolean;
    zeroconfVersion: string;
    ifaddrVersion: string;
    serviceType: string;
    internetService: false;
    error?: string;
  };
  peers: LocalSyncPeer[];
  discoveredPeers: Array<{
    deviceId: string;
    host: string;
    port: number;
    paired: boolean;
    lastSeenAt: string;
  }>;
  pendingInvitationCount: number;
  counts: {
    operations: number;
    registers: number;
    dirty: number;
    conflicts: number;
    assetsWithoutContentHash: number;
    pendingAssets: number;
  };
  privacy: {
    transport: string;
    operationAuthentication: string;
    stateAtRest: string;
    internetService: false;
    mediaTransfer: false;
    biometricTransfer: false;
    generatedModelDataTransfer: false;
    discoveryAdvertisesLibraryMetadata: false;
  };
  scope: {
    assetIdentity: string;
    fields: string[];
    missingMedia: string;
    remoteDeletion: string;
  };
  recovery: {
    bundleScope: string;
    catalogRecovery: string;
  };
  reason: string;
}

export interface LocalSyncInvitation {
  invitation: string;
  expiresAt: string;
  deviceId: string;
  host: string;
  port: number;
}

export interface LocalSyncConflictResult {
  total: number;
  conflicts: Array<{
    conflictId: string;
    entityType: string;
    contentHashPrefix: string;
    field: string;
    winnerOperationId: string;
    loserOperationId: string;
    resolution: string;
    resolvedAt: string;
  }>;
}

export interface McpConnectionInfo {
  mode: "packaged" | "source";
  workspace: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  httpUrl: string;
  agentApiUrl: string;
  httpHost: string;
  httpPort: number;
  configs: {
    claudeCode: string;
    claudeDesktop: string;
    codex: string;
  };
  packaged: boolean;
  http: McpHttpStatus;
  bundlePath: string;
  canBuildBundle: boolean;
  codexConfigPath: string;
}

export interface McpCodexResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  backupPath?: string;
}

export interface McpBundleResult {
  ok: boolean;
  action?: "revealed" | "built" | "build-failed" | "unavailable";
  path?: string;
  message?: string;
}

export interface McpActionResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface CrossAgeApi {
  invoke<T = unknown>(command: string, params?: Record<string, unknown>): Promise<T>;
  chooseFolder(): Promise<string | null>;
  chooseDamCatalog(provider: DamPhotoSourceProvider): Promise<Pick<MediaRef, "path" | "isDir"> | null>;
  chooseOpenPhotoCatalog(): Promise<Pick<MediaRef, "path" | "isDir"> | null>;
  /** Multi-select image picker; returns granted paths + thumbnail URLs. */
  chooseImages(): Promise<MediaRef[]>;
  /** Single audio picker; returns a granted path + media URL. */
  chooseAudioFile(): Promise<MediaRef | null>;
  /** Single JSON picker; returns a granted local file path. */
  chooseJsonFile(): Promise<Pick<MediaRef, "path" | "isDir"> | null>;
  chooseModelFile(): Promise<Pick<MediaRef, "path" | "isDir"> | null>;
  /** Single ICC/ICM picker; returns a granted local color-profile path. */
  chooseColorProfileFile(): Promise<Pick<MediaRef, "path" | "isDir"> | null>;
  /** Resolve a dropped File to its absolute path (Electron webUtils). */
  getPathForFile(file: File): string;
  /** Grant file/folder paths and get back thumbnail URLs + directory flags. */
  prepareMedia(paths: string[]): Promise<MediaRef[]>;
  saveCameraFrame(dataUrl: string): Promise<CameraSaveResult>;
  cancelScan(): Promise<{ cancelled: boolean; path: string }>;
  cancelMediaAction(): Promise<{ cancelled: boolean; path: string }>;
  pauseScan(): Promise<{ paused: boolean; path: string }>;
  resumeScan(): Promise<{ paused: boolean; path: string }>;
  getScanMarkerStatus(): Promise<{ workspace: string; cancelRequested: boolean; paused: boolean; cancelPath: string; pausePath: string }>;
  startFolderWatch(folder: string): Promise<FolderWatchStatus>;
  stopFolderWatch(): Promise<FolderWatchStatus>;
  getPhotoTetherStatus(refreshCamera?: boolean): Promise<PhotoTetherStatus>;
  startPhotoTether(options: PhotoTetherStartOptions): Promise<PhotoTetherStatus>;
  stopPhotoTether(): Promise<PhotoTetherStatus>;
  resumePhotoTether(sessionId: string): Promise<PhotoTetherStatus>;
  capturePhotoTether(): Promise<{ capture?: PhotoTetherCapture | null; sequence?: number }>;
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
  getPhotoIndexingRuntimeStatus(): Promise<PhotoIndexingRuntimeStatus>;
  getPhotoSources(): Promise<SystemPhotoSource[]>;
  getPhotoCatalogStatus(): Promise<{ value: OpenPhotoCatalogStatus }>;
  inspectOpenPhotoCatalog(payload: { catalogPath: string; verifyMedia?: boolean }): Promise<{ value: OpenPhotoCatalogInspection }>;
  exportOpenPhotoCatalog(payload: { destination: string; metadataOnly?: boolean; includeSidecars?: boolean; name?: string }): Promise<{ value: OpenPhotoCatalogExportResult }>;
  importOpenPhotoCatalog(payload: { catalogPath: string; managedRoot?: string; mergeByHash?: boolean; verifyMedia?: boolean }): Promise<{ value: OpenPhotoCatalogImportResult }>;
  cancelOpenPhotoCatalog(): Promise<{ cancelRequested: boolean }>;
  getDamCatalogStatus(provider: DamPhotoSourceProvider): Promise<{ value: PhotoSourceProviderStatus }>;
  listDamCatalogs(provider: DamPhotoSourceProvider): Promise<{ value: PhotoSourceDiscoveryValue }>;
  previewDamCatalog(payload: Record<string, unknown> & { provider: DamPhotoSourceProvider; libraryPath: string }): Promise<{ value: PhotoSourcePreviewValue | PhotoSourceJobStartValue }>;
  importDamCatalog(payload: Record<string, unknown> & { provider: DamPhotoSourceProvider; libraryPath: string }): Promise<{ value: PhotoSourceJobStartValue }>;
  syncDamCatalog(payload: Record<string, unknown> & { provider: DamPhotoSourceProvider; libraryPath: string }): Promise<{ value: PhotoSourceJobStartValue }>;
  listInboundConnectors(): Promise<InboundConnectorsValue>;
  saveInboundConnector(payload: {
    provider: RemotePhotoSourceProvider;
    connectionId: string;
    displayName: string;
    config: Record<string, unknown>;
  }): Promise<InboundConnectorCredentialSummary & { configured?: Record<string, unknown> }>;
  removeInboundConnector(provider: RemotePhotoSourceProvider, connectionId: string): Promise<{ provider: string; connectionId: string; removed: boolean }>;
  invokeInboundConnector<T = unknown>(provider: RemotePhotoSourceProvider, connectionId: string, action: "preview" | "import" | "sync", params?: Record<string, unknown>): Promise<T>;
  getPhotosSensitiveAuthStatus(): Promise<PhotoSensitiveAuthStatus>;
  authenticatePhotosSensitiveAccess(reason?: string): Promise<PhotoSensitiveAuthResult>;
  getWorkspaceLockStatus(): Promise<WorkspaceLockStatus>;
  enableWorkspaceLock(): Promise<WorkspaceLockStatus>;
  lockWorkspace(): Promise<WorkspaceLockStatus>;
  unlockWorkspace(): Promise<WorkspaceLockStatus>;
  disableWorkspaceLock(): Promise<WorkspaceLockStatus>;
  getWorkspaceEncryptionStatus(): Promise<WorkspaceEncryptionStatus>;
  createWorkspaceRecoveryCode(): Promise<{ recoveryCode: string; status: WorkspaceEncryptionStatus }>;
  rotateWorkspaceEncryptionKey(): Promise<WorkspaceEncryptionStatus>;
  revealPath(path: string): Promise<boolean>;
  openPath(path: string): Promise<{ ok: boolean; error?: string }>;
  openPhotoPrivacySettings(): Promise<{ ok: boolean; platform: string; suppressed?: boolean; error?: string }>;
  openPathWith(path: string, editorPath?: string): Promise<OpenPathWithResult>;
  listExternalEditors(): Promise<ExternalEditorFavoritesResult>;
  forgetExternalEditor(editorPath: string): Promise<ExternalEditorFavoritesResult>;
  sharePaths(paths: string[]): Promise<SharePathsResult>;
  printPath(path: string): Promise<PrintPathResult>;
  writeClipboardText(text: string): Promise<boolean>;
  writeClipboardImagePath(path: string): Promise<ClipboardImagePathResult>;
  startFileDrag(path: string): Promise<FileDragResult>;
  getInitialState(): Promise<AppState>;
  rendererReady(): Promise<boolean>;
  setAppLanguage(language: string): Promise<boolean>;
  getMcpConnectionInfo(): Promise<McpConnectionInfo>;
  addMcpToCodex(): Promise<McpCodexResult>;
  revealMcpConfigs(): Promise<McpActionResult>;
  revealOrBuildMcpBundle(): Promise<McpBundleResult>;
  startMcpHttpServer(): Promise<McpHttpStatus>;
  stopMcpHttpServer(): Promise<McpHttpStatus>;
  getMcpHttpStatus(): Promise<McpHttpStatus>;
  onMcpHttpStatus(callback: (status: McpHttpStatus) => void): () => void;
  getMobileCompanionStatus(): Promise<MobileCompanionStatus>;
  configureMobileCompanion(publicUrl: string): Promise<MobileCompanionStatus>;
  createMobileCompanion(options: { label: string; expiresInDays: number; allowPreviews: boolean }): Promise<MobileCompanionPairingResult>;
  revokeMobileCompanion(accountId: string): Promise<MobileCompanionRevokeResult>;
  onAppCommand(callback: (command: AppCommand) => void): () => void;
  onExternalOpen(callback: (payload: ExternalOpenPayload) => void): () => void;
  onScanProgress(callback: (event: ScanProgressEvent | ModelDownloadProgressEvent | MediaActionProgressEvent | OpenPhotoCatalogProgressEvent) => void): () => void;
  onBackendStartup(callback: (event: BackendStartupEvent) => void): () => void;
  onFolderWatch(callback: (status: FolderWatchStatus) => void): () => void;
  onPhotoTether(callback: (event: PhotoTetherEvent) => void): () => void;
  onBackendError(callback: (message: string) => void): () => void;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  onDiagnosticsEvent(callback: (event: Record<string, unknown>) => void): () => void;
  platform: string;
  rendererGpuMode?: "hardware" | "software";
  testCamera?: boolean;
  testCameraError?: boolean;
  testFileDropPathFallback?: boolean;
}

// Subfolder include/exclude picker tree (backend `folder_tree` command). The
// canonical definitions live alongside the pure selection logic so that module
// stays self-contained and unit-testable; re-exported here for a consistent
// `./types` import surface across the app.
export type { FolderTreeNode, FolderTree, ScanMode, MediaCounts } from "./lib/folderTreeSelection";

declare global {
  interface Window {
    crossAge: CrossAgeApi;
  }
}

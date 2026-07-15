import { useState } from "react";
import type {
  AccuracyEvaluation,
  AccuracyValidationPackValue,
  AccuracyValidationRun,
  AuditChainStatus,
  AuditEventsResult,
  CalibrationLearningStatus,
  ComplianceStatus,
  DatabaseRepairResult,
  EmbeddingAdapterStatus,
  FolderWatchStatus,
  Jurisdiction,
  MediaTrashCleanupValue,
  MediaTrashReportValue,
  ModelDistributionAudit,
  ModelDriftReport,
  ModelIntegrityResult,
  ModelLifecycleStatus,
  ModelSwitchDryRun,
  PrivacyReport,
  PublicDatasetBenchmarkResult,
  PublicDatasetCatalog,
  PublicDatasetInspection,
  PublicDatasetModelComparisonResult,
  ReferenceGapReport,
  ReleaseReadinessResult,
  RetentionPolicyReport,
  RuntimeBenchmarkResult,
  RuntimeSelfTestResult,
  ScanManifestPruneValue,
  SelfLearningRdStatus,
  StorageIoBenchmarkResult,
  WorkspaceBackupPruneValue,
  WorkspaceBackupRestoreValue,
  WorkspaceBackupVerification,
  WorkspaceHealth,
  WorkspaceListItem,
  WorkspaceOptimizeResult,
  WorkspaceRelinkResult,
  WorkspaceRepairResult,
} from "./types";

export const initialWatchStatus: FolderWatchStatus = { active: false, folder: null, queued: 0, scanning: false, message: "Not watching." };

export type LatencySample = {
  label: string;
  command: string;
  durationMs: number;
  at: number;
  budgetMs: number;
};

export type LatencySummary = {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  slowCount: number;
  slowest: LatencySample | null;
};

export function useAppToolPanelState() {
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
  const [auditChain, setAuditChain] = useState<AuditChainStatus | null>(null);
  const [jurisdictions, setJurisdictions] = useState<Jurisdiction[]>([]);
  const [jurisdictionDisclaimer, setJurisdictionDisclaimer] = useState("");
  const [complianceStatus, setComplianceStatus] = useState<ComplianceStatus | null>(null);
  const [accuracyValidationHistory, setAccuracyValidationHistory] = useState<AccuracyValidationRun[]>([]);
  const [storageIo, setStorageIo] = useState<StorageIoBenchmarkResult | null>(null);
  const [storageIoPath, setStorageIoPath] = useState("");
  const [modelDistribution, setModelDistribution] = useState<ModelDistributionAudit | null>(null);
  const [runtimeSelfTest, setRuntimeSelfTest] = useState<RuntimeSelfTestResult | null>(null);
  const [modelIntegrity, setModelIntegrity] = useState<ModelIntegrityResult | null>(null);
  const [modelLifecycleStatus, setModelLifecycleStatus] = useState<ModelLifecycleStatus | null>(null);
  const [runtimeBenchmark, setRuntimeBenchmark] = useState<RuntimeBenchmarkResult | null>(null);
  const [releaseReadiness, setReleaseReadiness] = useState<ReleaseReadinessResult | null>(null);
  const [accuracyEvaluation, setAccuracyEvaluation] = useState<AccuracyEvaluation | null>(null);
  const [calibrationLearning, setCalibrationLearning] = useState<CalibrationLearningStatus | null>(null);
  const [embeddingAdapterLearning, setEmbeddingAdapterLearning] = useState<EmbeddingAdapterStatus | null>(null);
  const [selfLearningRdStatus, setSelfLearningRdStatus] = useState<SelfLearningRdStatus | null>(null);
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

  return {
    backupVerification,
    setBackupVerification,
    backupPruneResult,
    setBackupPruneResult,
    backupRestoreResult,
    setBackupRestoreResult,
    workspaceHealth,
    setWorkspaceHealth,
    workspaceOptimizeResult,
    setWorkspaceOptimizeResult,
    workspaceRepairResult,
    setWorkspaceRepairResult,
    databaseRepairResult,
    setDatabaseRepairResult,
    workspaceRelinkResult,
    setWorkspaceRelinkResult,
    scanManifestPruneResult,
    setScanManifestPruneResult,
    auditEvents,
    setAuditEvents,
    auditChain,
    setAuditChain,
    jurisdictions,
    setJurisdictions,
    jurisdictionDisclaimer,
    setJurisdictionDisclaimer,
    complianceStatus,
    setComplianceStatus,
    accuracyValidationHistory,
    setAccuracyValidationHistory,
    storageIo,
    setStorageIo,
    storageIoPath,
    setStorageIoPath,
    modelDistribution,
    setModelDistribution,
    runtimeSelfTest,
    setRuntimeSelfTest,
    modelIntegrity,
    setModelIntegrity,
    modelLifecycleStatus,
    setModelLifecycleStatus,
    runtimeBenchmark,
    setRuntimeBenchmark,
    releaseReadiness,
    setReleaseReadiness,
    accuracyEvaluation,
    setAccuracyEvaluation,
    calibrationLearning,
    setCalibrationLearning,
    embeddingAdapterLearning,
    setEmbeddingAdapterLearning,
    selfLearningRdStatus,
    setSelfLearningRdStatus,
    accuracyValidationPack,
    setAccuracyValidationPack,
    publicDatasetCatalog,
    setPublicDatasetCatalog,
    publicDatasetInspection,
    setPublicDatasetInspection,
    publicDatasetBenchmark,
    setPublicDatasetBenchmark,
    publicDatasetModelComparison,
    setPublicDatasetModelComparison,
    privacyReport,
    setPrivacyReport,
    recentWorkspaces,
    setRecentWorkspaces,
    mediaTrashReport,
    setMediaTrashReport,
    mediaTrashCleanup,
    setMediaTrashCleanup,
    retentionPolicy,
    setRetentionPolicy,
    modelDriftReport,
    setModelDriftReport,
    referenceGapReport,
    setReferenceGapReport,
    modelSwitchPlan,
    setModelSwitchPlan,
    watchStatus,
    setWatchStatus,
    latencySamples,
    setLatencySamples,
  };
}

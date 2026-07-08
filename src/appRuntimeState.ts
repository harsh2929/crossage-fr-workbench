import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type {
  DiagnosticsReport,
  DuplicatePeopleResult,
  ExternalEditorFavorite,
  FolderAnalysis,
  InstallerDiagnosticsResult,
  MediaActionProgress,
  ModelDownloadProgress,
  PhotoExternalImportRequest,
  ReviewRulesApplyResult,
  ScanProgress,
  SystemIntegration,
  SystemPhotoSource,
  UpdateStatus,
  WorkspaceLockStatus,
} from "./types";

type StateSetter<T> = Dispatch<SetStateAction<T>>;
type PhotoAppShortcutCommand = { id: number; shortcut: "selectPage" | "delete" } | null;
type LocalScanMarkers = { cancelRequested: boolean; paused: boolean } | null;

export interface AppPhotoBridgeState {
  lastPhotoExternalEditorPath: string;
  setLastPhotoExternalEditorPath: StateSetter<string>;
  photoExternalEditors: ExternalEditorFavorite[];
  setPhotoExternalEditors: StateSetter<ExternalEditorFavorite[]>;
  photoSources: SystemPhotoSource[];
  setPhotoSources: StateSetter<SystemPhotoSource[]>;
  photoAppShortcutCommand: PhotoAppShortcutCommand;
  setPhotoAppShortcutCommand: StateSetter<PhotoAppShortcutCommand>;
  photoExternalImportRequest: PhotoExternalImportRequest | null;
  setPhotoExternalImportRequest: StateSetter<PhotoExternalImportRequest | null>;
}

export interface AppRuntimeStatusState {
  systemIntegration: SystemIntegration | null;
  setSystemIntegration: StateSetter<SystemIntegration | null>;
  updateStatus: UpdateStatus | null;
  setUpdateStatus: StateSetter<UpdateStatus | null>;
  diagnosticsReport: DiagnosticsReport | null;
  setDiagnosticsReport: StateSetter<DiagnosticsReport | null>;
  installerDiagnostics: InstallerDiagnosticsResult | null;
  setInstallerDiagnostics: StateSetter<InstallerDiagnosticsResult | null>;
  workspaceLock: WorkspaceLockStatus | null;
  setWorkspaceLock: StateSetter<WorkspaceLockStatus | null>;
  duplicatePeople: DuplicatePeopleResult | null;
  setDuplicatePeople: StateSetter<DuplicatePeopleResult | null>;
  reviewRuleResult: ReviewRulesApplyResult | null;
  setReviewRuleResult: StateSetter<ReviewRulesApplyResult | null>;
  scanProgress: ScanProgress | null;
  setScanProgress: StateSetter<ScanProgress | null>;
  localScanMarkers: LocalScanMarkers;
  setLocalScanMarkers: StateSetter<LocalScanMarkers>;
  modelDownloadProgress: ModelDownloadProgress | null;
  setModelDownloadProgress: StateSetter<ModelDownloadProgress | null>;
  mediaActionProgress: MediaActionProgress | null;
  setMediaActionProgress: StateSetter<MediaActionProgress | null>;
  folderAnalysis: FolderAnalysis | null;
  setFolderAnalysis: StateSetter<FolderAnalysis | null>;
}

export function useAppPhotoBridgeState(): AppPhotoBridgeState {
  const [lastPhotoExternalEditorPath, setLastPhotoExternalEditorPath] = useState("");
  const [photoExternalEditors, setPhotoExternalEditors] = useState<ExternalEditorFavorite[]>([]);
  const [photoSources, setPhotoSources] = useState<SystemPhotoSource[]>([]);
  const [photoAppShortcutCommand, setPhotoAppShortcutCommand] = useState<PhotoAppShortcutCommand>(null);
  const [photoExternalImportRequest, setPhotoExternalImportRequest] = useState<PhotoExternalImportRequest | null>(null);

  return {
    lastPhotoExternalEditorPath,
    setLastPhotoExternalEditorPath,
    photoExternalEditors,
    setPhotoExternalEditors,
    photoSources,
    setPhotoSources,
    photoAppShortcutCommand,
    setPhotoAppShortcutCommand,
    photoExternalImportRequest,
    setPhotoExternalImportRequest,
  };
}

export function useAppRuntimeStatusState(): AppRuntimeStatusState {
  const [systemIntegration, setSystemIntegration] = useState<SystemIntegration | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState<DiagnosticsReport | null>(null);
  const [installerDiagnostics, setInstallerDiagnostics] = useState<InstallerDiagnosticsResult | null>(null);
  const [workspaceLock, setWorkspaceLock] = useState<WorkspaceLockStatus | null>(null);
  const [duplicatePeople, setDuplicatePeople] = useState<DuplicatePeopleResult | null>(null);
  const [reviewRuleResult, setReviewRuleResult] = useState<ReviewRulesApplyResult | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [localScanMarkers, setLocalScanMarkers] = useState<LocalScanMarkers>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<ModelDownloadProgress | null>(null);
  const [mediaActionProgress, setMediaActionProgress] = useState<MediaActionProgress | null>(null);
  const [folderAnalysis, setFolderAnalysis] = useState<FolderAnalysis | null>(null);

  return {
    systemIntegration,
    setSystemIntegration,
    updateStatus,
    setUpdateStatus,
    diagnosticsReport,
    setDiagnosticsReport,
    installerDiagnostics,
    setInstallerDiagnostics,
    workspaceLock,
    setWorkspaceLock,
    duplicatePeople,
    setDuplicatePeople,
    reviewRuleResult,
    setReviewRuleResult,
    scanProgress,
    setScanProgress,
    localScanMarkers,
    setLocalScanMarkers,
    modelDownloadProgress,
    setModelDownloadProgress,
    mediaActionProgress,
    setMediaActionProgress,
    folderAnalysis,
    setFolderAnalysis,
  };
}

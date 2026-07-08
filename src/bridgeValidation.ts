export const REQUIRED_CROSSAGE_METHODS = [
  "invoke",
  "chooseFolder",
  "chooseImages",
  "chooseAudioFile",
  "chooseJsonFile",
  "chooseModelFile",
  "chooseColorProfileFile",
  "getPathForFile",
  "prepareMedia",
  "saveCameraFrame",
  "cancelScan",
  "cancelMediaAction",
  "pauseScan",
  "resumeScan",
  "getScanMarkerStatus",
  "startFolderWatch",
  "stopFolderWatch",
  "getSystemIntegration",
  "setLaunchAtLogin",
  "getUpdateStatus",
  "checkForUpdates",
  "setUpdateChannel",
  "downloadUpdate",
  "installUpdate",
  "getDiagnosticsReport",
  "exportDiagnosticsReport",
  "recordDiagnosticEvent",
  "getPhotoSources",
  "getPhotosSensitiveAuthStatus",
  "authenticatePhotosSensitiveAccess",
  "getWorkspaceLockStatus",
  "enableWorkspaceLock",
  "lockWorkspace",
  "unlockWorkspace",
  "disableWorkspaceLock",
  "revealPath",
  "openPath",
  "openPathWith",
  "listExternalEditors",
  "forgetExternalEditor",
  "sharePaths",
  "printPath",
  "writeClipboardText",
  "writeClipboardImagePath",
  "startFileDrag",
  "getInitialState",
  "rendererReady",
  "setAppLanguage",
  "getMcpConnectionInfo",
  "addMcpToCodex",
  "revealMcpConfigs",
  "revealOrBuildMcpBundle",
  "startMcpHttpServer",
  "stopMcpHttpServer",
  "getMcpHttpStatus",
  "onMcpHttpStatus",
  "onAppCommand",
  "onExternalOpen",
  "onScanProgress",
  "onBackendStartup",
  "onFolderWatch",
  "onBackendError",
  "onUpdateStatus",
  "onDiagnosticsEvent"
] as const;

export function missingCrossAgeBridgeMembers(candidate: unknown) {
  if (!candidate || typeof candidate !== "object") {
    return ["crossAge", "platform", ...REQUIRED_CROSSAGE_METHODS];
  }
  const bridge = candidate as Record<string, unknown>;
  const missing: string[] = REQUIRED_CROSSAGE_METHODS.filter((name) => typeof bridge[name] !== "function");
  if (typeof bridge.platform !== "string") {
    missing.unshift("platform");
  }
  return missing;
}

export function isCrossAgeBridgeReady(candidate: unknown) {
  return missingCrossAgeBridgeMembers(candidate).length === 0;
}

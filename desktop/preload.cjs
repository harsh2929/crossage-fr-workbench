const { contextBridge, ipcRenderer } = require("electron");

const TRUSTED_BACKEND_COMMANDS = new Set([
  "get_state",
  "model_status",
  "set_model_root",
  "download_model",
  "set_workspace",
  "set_consent",
  "enroll",
  "enroll_age_groups",
  "scan",
  "scan_paths",
  "cancel_scan",
  "pause_scan",
  "resume_scan",
  "scan_job_status",
  "analyze_folder",
  "folder_tree",
  "set_status",
  "bulk_set_status",
  "set_candidate_note",
  "block_false_match",
  "reassign_candidate_person",
  "duplicate_people",
  "apply_review_rules",
  "query_candidates",
  "clear_queue",
  "purge_candidates",
  "purge_duplicate_candidates",
  "prepare_previews",
  "delete_reference",
  "delete_person",
  "rename_person",
  "clear_references",
  "purge_old_candidates",
  "repair_workspace",
  "database_integrity",
  "repair_database_integrity",
  "relink_workspace_paths",
  "export_report",
  "export_workspace_inventory",
  "export_audit_log",
  "export_consent_receipt",
  "retention_policy_report",
  "export_safe_mode_audit",
  "model_drift_report",
  "reference_gap_report",
  "export_review_ledger",
  "export_scan_history",
  "export_workspace_backup",
  "verify_workspace_backup",
  "restore_workspace_backup",
  "prune_workspace_backups",
  "prune_scan_manifests",
  "export_candidates",
  "preview_candidate_media_action",
  "manage_candidate_media",
  "media_action_history",
  "restore_media_action",
  "retry_media_action",
  "undo_media_action",
  "media_trash_report",
  "cleanup_media_trash",
  "export_media_bundle",
  "workspace_health",
  "runtime_self_test",
  "runtime_benchmark",
  "benchmark_history",
  "storage_io_benchmark",
  "release_readiness",
  "model_integrity",
  "model_distribution_audit",
  "model_switch_dry_run",
  "backfill_model_references",
  "export_support_bundle",
  "installer_self_diagnostics",
  "public_dataset_catalog",
  "inspect_public_dataset",
  "run_public_dataset_benchmark",
  "compare_public_dataset_models",
  "apply_model_recommendation",
  "calibration_summary",
  "accuracy_evaluation",
  "generate_accuracy_validation_pack",
  "run_accuracy_validation_pack",
  "accuracy_validation_history",
  "apply_calibration",
  "export_accuracy_labels",
  "import_accuracy_labels",
  "privacy_report",
  "delete_face_data",
  "optimize_workspace",
  "enforce_storage_budget",
  "add_calibration_label",
  "set_performance_mode",
  "save_settings",
  "audit_events",
  "audit_chain_status",
  "list_jurisdictions",
  "set_jurisdiction_preset",
  "export_compliance_pack",
  "export_examination_report",
  "list_workspaces",
  "add_workspace"
]);

function assertPlainObject(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("E-IPC-PAYLOAD", `${label} must be an object.`);
  }
}

function codedError(code, message) {
  const error = new Error(`[${code}] ${message}`);
  error.code = code;
  return error;
}

function normalizeIpcError(error) {
  const raw = error instanceof Error ? error.message : String(error || "The action failed.");
  const cleaned = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "")
    .trim();
  const code = cleaned.match(/\b([EW]-[A-Z0-9-]{2,})\b/)?.[1] || "";
  const message = cleaned.replace(/^\[[EW]-[A-Z0-9-]{2,}\]\s*/, "").trim() || "The action failed.";
  const normalized = new Error(code ? `[${code}] ${message}` : message);
  if (code) {
    normalized.code = code;
  }
  if (error instanceof Error && error.stack) {
    normalized.stack = error.stack;
  }
  return normalized;
}

function safeInvoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload).catch((error) => {
    throw normalizeIpcError(error);
  });
}

function invokeBackend(command, params = {}) {
  const safeCommand = String(command || "");
  if (!TRUSTED_BACKEND_COMMANDS.has(safeCommand)) {
    throw codedError("E-IPC-BLOCKED-COMMAND", `Blocked backend command: ${safeCommand || "empty"}.`);
  }
  assertPlainObject(params, "Command params");
  return safeInvoke("backend:invoke", { command: safeCommand, params });
}

function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    throw codedError("E-IPC-PAYLOAD", "Listener must be a function.");
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const safePlatform = typeof process !== "undefined" ? process.platform : "unknown";
const safeEnv = typeof process !== "undefined" && process.env ? process.env : {};

contextBridge.exposeInMainWorld("crossAge", Object.freeze({
  invoke: invokeBackend,
  chooseFolder: () => safeInvoke("dialog:choose-folder"),
  saveCameraFrame: (dataUrl) => safeInvoke("camera:save-frame", { dataUrl }),
  cancelScan: () => safeInvoke("scan:cancel"),
  cancelMediaAction: () => safeInvoke("media-action:cancel"),
  pauseScan: () => safeInvoke("scan:pause"),
  resumeScan: () => safeInvoke("scan:resume"),
  getScanMarkerStatus: () => safeInvoke("scan:marker-status"),
  startFolderWatch: (folder) => {
    if (typeof folder !== "string" || !folder.trim()) {
      return Promise.reject(codedError("E-FOLDER-WATCH-PATH", "Choose a folder to watch."));
    }
    return safeInvoke("folder-watch:start", { folder });
  },
  stopFolderWatch: () => safeInvoke("folder-watch:stop"),
  getSystemIntegration: () => safeInvoke("system:get-integration"),
  setLaunchAtLogin: (openAtLogin) => safeInvoke("system:set-launch-at-login", { openAtLogin }),
  getUpdateStatus: () => safeInvoke("updater:get-status"),
  checkForUpdates: () => safeInvoke("updater:check"),
  setUpdateChannel: (channel) => safeInvoke("updater:set-channel", { channel }),
  downloadUpdate: () => safeInvoke("updater:download"),
  installUpdate: () => safeInvoke("updater:install"),
  getDiagnosticsReport: (includePaths = false) => safeInvoke("diagnostics:get-report", { includePaths }),
  exportDiagnosticsReport: (includePaths = false) => safeInvoke("diagnostics:export-report", { includePaths }),
  recordDiagnosticEvent: (event) => safeInvoke("diagnostics:record-event", event && typeof event === "object" ? event : { message: String(event || "") }),
  getPhotoSources: () => safeInvoke("photos:get-sources"),
  getWorkspaceLockStatus: () => safeInvoke("workspace-lock:get-status"),
  enableWorkspaceLock: () => safeInvoke("workspace-lock:enable"),
  lockWorkspace: () => safeInvoke("workspace-lock:lock"),
  unlockWorkspace: () => safeInvoke("workspace-lock:unlock"),
  disableWorkspaceLock: () => safeInvoke("workspace-lock:disable"),
  revealPath: (targetPath) => safeInvoke("shell:reveal-path", { path: targetPath }),
  openPath: (targetPath) => safeInvoke("shell:open-path", { path: targetPath }),
  writeClipboardText: (text) => safeInvoke("clipboard:write-text", { text }),
  getInitialState: () => safeInvoke("backend:initial-state"),
  rendererReady: () => safeInvoke("app:renderer-ready"),
  setAppLanguage: (language) => safeInvoke("app:set-language", { language }),
  onAppCommand: (callback) => subscribe("app:command", callback),
  onExternalOpen: (callback) => subscribe("app:external-open", callback),
  onScanProgress: (callback) => subscribe("backend:progress", callback),
  onBackendStartup: (callback) => subscribe("backend:startup", callback),
  onFolderWatch: (callback) => subscribe("folder-watch:event", callback),
  onBackendError: (callback) => subscribe("backend:error", callback),
  onUpdateStatus: (callback) => subscribe("updater:event", callback),
  onDiagnosticsEvent: (callback) => subscribe("diagnostics:event", callback),
  platform: safePlatform,
  testCamera: safeEnv.CROSSAGE_TEST_CAMERA === "1"
}));

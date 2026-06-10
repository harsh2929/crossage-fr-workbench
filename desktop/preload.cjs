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
  "analyze_folder",
  "set_status",
  "bulk_set_status",
  "set_candidate_note",
  "clear_queue",
  "purge_candidates",
  "purge_duplicate_candidates",
  "prepare_previews",
  "delete_reference",
  "delete_person",
  "rename_person",
  "clear_references",
  "purge_old_candidates",
  "export_report",
  "export_workspace_backup",
  "export_candidates",
  "workspace_health",
  "runtime_self_test",
  "save_settings",
  "audit_events"
]);

function assertPlainObject(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function invokeBackend(command, params = {}) {
  const safeCommand = String(command || "");
  if (!TRUSTED_BACKEND_COMMANDS.has(safeCommand)) {
    throw new Error(`Blocked backend command: ${safeCommand || "empty"}.`);
  }
  assertPlainObject(params, "Command params");
  return ipcRenderer.invoke("backend:invoke", { command: safeCommand, params });
}

function subscribe(channel, callback) {
  if (typeof callback !== "function") {
    throw new Error("Listener must be a function.");
  }
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const safePlatform = typeof process !== "undefined" ? process.platform : "unknown";
const safeEnv = typeof process !== "undefined" && process.env ? process.env : {};

contextBridge.exposeInMainWorld("crossAge", Object.freeze({
  invoke: invokeBackend,
  chooseFolder: () => ipcRenderer.invoke("dialog:choose-folder"),
  saveCameraFrame: (dataUrl) => ipcRenderer.invoke("camera:save-frame", { dataUrl }),
  startFolderWatch: (folder) => ipcRenderer.invoke("folder-watch:start", { folder }),
  stopFolderWatch: () => ipcRenderer.invoke("folder-watch:stop"),
  getSystemIntegration: () => ipcRenderer.invoke("system:get-integration"),
  setLaunchAtLogin: (openAtLogin) => ipcRenderer.invoke("system:set-launch-at-login", { openAtLogin }),
  revealPath: (targetPath) => ipcRenderer.invoke("shell:reveal-path", { path: targetPath }),
  openPath: (targetPath) => ipcRenderer.invoke("shell:open-path", { path: targetPath }),
  writeClipboardText: (text) => ipcRenderer.invoke("clipboard:write-text", { text }),
  getInitialState: () => ipcRenderer.invoke("backend:initial-state"),
  rendererReady: () => ipcRenderer.invoke("app:renderer-ready"),
  onAppCommand: (callback) => subscribe("app:command", callback),
  onExternalOpen: (callback) => subscribe("app:external-open", callback),
  onScanProgress: (callback) => subscribe("backend:progress", callback),
  onBackendStartup: (callback) => subscribe("backend:startup", callback),
  onFolderWatch: (callback) => subscribe("folder-watch:event", callback),
  onBackendError: (callback) => subscribe("backend:error", callback),
  platform: safePlatform,
  testCamera: safeEnv.CROSSAGE_TEST_CAMERA === "1"
}));

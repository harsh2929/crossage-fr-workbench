const { contextBridge, ipcRenderer, webUtils } = require("electron");

const TRUSTED_BACKEND_COMMANDS = new Set([
  "get_state",
  "model_status",
  "set_model_root",
  "download_model",
  "set_workspace",
  "set_consent",
  "enroll",
  "enroll_paths",
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
  "suggest_photo_review_more_candidates",
  "list_photo_folders",
  "list_photo_folder_items",
  "list_photo_date_buckets",
  "search_photo_library",
  "semantic_search_photos",
  "list_photo_assets",
  "list_photo_burst_stacks",
  "set_photo_burst_selection",
  "list_photo_keywords",
  "save_photo_keyword",
  "delete_photo_keyword",
  "export_photo_keywords",
  "import_photo_keywords",
  "save_photo_person_profile",
  "save_photo_pet_profile",
  "save_photo_place_profile",
  "save_photo_utility_profile",
  "rename_photo_pet",
  "assign_photo_pet",
  "dismiss_photo_pet_review",
  "save_photo_people_group",
  "delete_photo_people_group",
  "update_photo_asset_metadata",
  "update_photo_assets_metadata",
  "reverse_geocode_photo_location",
  "get_photo_edit_stack",
  "get_photo_edit_stacks",
  "save_photo_edit_stack",
  "save_photo_edit_stacks",
  "revert_photo_edit_stack",
  "list_photo_edit_stack_versions",
  "create_photo_edit_stack_version",
  "restore_photo_edit_stack_version",
  "delete_photo_edit_stack_version",
  "duplicate_photo_asset_version",
  "duplicate_photo_asset_rendered_version",
  "record_photo_asset_event",
  "apply_photo_visibility_operation",
  "list_photo_operations",
  "photo_restore_rehearsal",
  "photo_backup_restore_rehearsal",
  "undo_photo_operation",
  "permanently_delete_photos",
  "merge_photo_duplicates",
  "dismiss_photo_duplicate_group",
  "import_photos",
  "update_photo_import_session_provenance",
  "bulk_update_photo_import_session_provenance",
  "archive_photo_import_sessions",
  "list_photo_import_failures",
  "dismiss_photo_import_failure",
  "retry_photo_import_failure",
  "save_recovered_photo_import_failure",
  "delete_recovered_photo_import_failure",
  "scan_photo_recovered_orphans",
  "photo_recovered_cleanup",
  "rebuild_photo_previews",
  "photo_library_preview_sweep",
  "relink_photo_library_paths",
  "create_photo_media_pair",
  "relink_photo_media_pair",
  "delete_photo_media_pair",
  "consolidate_photo_library_assets",
  "photo_library_backup_check",
  "photo_library_catalog_cleanup",
  "photo_repair_history",
  "photo_library_settings",
  "save_photo_library_settings",
  "index_photo_ocr",
  "photo_ocr_index_status",
  "index_photo_barcodes",
  "photo_barcode_index_status",
  "index_photo_objects",
  "photo_object_index_status",
  "enqueue_photo_indexing_job",
  "photo_indexing_jobs",
  "run_photo_indexing_job",
  "run_photo_indexing_queue",
  "cancel_photo_indexing_job",
  "dismiss_photo_indexing_job",
  "photo_curation_preferences",
  "save_photo_curation_preferences",
  "photo_user_memories",
  "save_photo_user_memory",
  "delete_photo_user_memory",
  "photo_slideshow_theme_templates",
  "save_photo_slideshow_theme_template",
  "delete_photo_slideshow_theme_template",
  "export_photo_slideshow_theme_templates",
  "import_photo_slideshow_theme_templates",
  "photo_slideshow_projects",
  "save_photo_slideshow_project",
  "delete_photo_slideshow_project",
  "export_photo_slideshow",
  "export_photo_memory_movie",
  "list_photo_saved_filters",
  "save_photo_saved_filter",
  "delete_photo_saved_filter",
  "preview_photo_album_rules",
  "save_photo_album",
  "delete_photo_album",
  "merge_photo_albums",
  "migrate_photo_smart_albums",
  "list_photo_album_folders",
  "save_photo_album_folder",
  "delete_photo_album_folder",
  "move_photo_album_to_folder",
  "reorder_photo_album_folder_children",
  "add_photo_album_items",
  "remove_photo_album_items",
  "reorder_photo_album_items",
  "suggest_photo_albums",
  "photo_color_profile_status",
  "validate_photo_color_profile",
  "export_photo_selection",
  "export_photo_contact_sheet",
  "export_photo_video_frame",
  "export_photo_video_trim",
  "export_photo_live_motion",
  "export_photo_subject_cutout",
  "export_photo_portrait_blur",
  "set_photo_live_key_photo",
  "reset_photo_live_key_photo",
  "set_photo_video_poster",
  "reset_photo_video_poster",
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
  "self_learning_rd_status",
  "calibration_learning_status",
  "run_learning_jobs",
  "reference_suggestion_status",
  "stage_reference_suggestions",
  "approve_reference_suggestion",
  "reject_reference_suggestion",
  "stage_calibration",
  "promote_calibration",
  "rollback_calibration",
  "embedding_adapter_status",
  "stage_embedding_adapter",
  "promote_embedding_adapter",
  "rollback_embedding_adapter",
  "apply_calibration",
  "apply_personalized_calibration",
  "export_accuracy_labels",
  "import_accuracy_labels",
  "export_training_examples",
  "import_training_examples",
  "privacy_report",
  "delete_face_data",
  "optimize_workspace",
  "enforce_storage_budget",
  "add_calibration_label",
  "set_performance_mode",
  "save_settings",
  "calibrate_safe_mode",
  "explain_safety",
  "install_safety_explainer",
  "list_safe_mode_flagged",
  "set_photo_safe_mode_override",
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
  // Multi-select image/video file picker for the "Add a person" flow. Returns
  // [{ path, url }] where url is a vintrace-media:// thumbnail URL (main grants
  // each path so the protocol can serve it).
  chooseImages: () => safeInvoke("dialog:choose-images"),
  chooseAudioFile: () => safeInvoke("dialog:choose-audio"),
  chooseJsonFile: () => safeInvoke("dialog:choose-json"),
  chooseModelFile: () => safeInvoke("dialog:choose-model"),
  chooseColorProfileFile: () => safeInvoke("dialog:choose-color-profile"),
  // Resolve a dropped File to its absolute path. webUtils is available even in a
  // sandboxed preload; this is the supported Electron way to read a drop path.
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch (_error) {
      return "";
    }
  },
  // Grant a batch of file/folder paths and get their thumbnail URLs back, so
  // dropped or folder-sampled images can be previewed before enrolling.
  prepareMedia: (paths) => safeInvoke("media:prepare-paths", { paths: Array.isArray(paths) ? paths : [] }),
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
  getPhotosSensitiveAuthStatus: () => safeInvoke("photos:sensitive-auth-status"),
  authenticatePhotosSensitiveAccess: (reason = "") => safeInvoke("photos:authenticate-sensitive", { reason: String(reason || "").slice(0, 180) }),
  getWorkspaceLockStatus: () => safeInvoke("workspace-lock:get-status"),
  enableWorkspaceLock: () => safeInvoke("workspace-lock:enable"),
  lockWorkspace: () => safeInvoke("workspace-lock:lock"),
  unlockWorkspace: () => safeInvoke("workspace-lock:unlock"),
  disableWorkspaceLock: () => safeInvoke("workspace-lock:disable"),
  revealPath: (targetPath) => safeInvoke("shell:reveal-path", { path: targetPath }),
  openPath: (targetPath) => safeInvoke("shell:open-path", { path: targetPath }),
  openPathWith: (targetPath, editorPath = "") => safeInvoke("shell:open-path-with", { path: targetPath, editorPath }),
  listExternalEditors: () => safeInvoke("shell:list-external-editors"),
  forgetExternalEditor: (editorPath) => safeInvoke("shell:forget-external-editor", { editorPath }),
  sharePaths: (targetPaths) => safeInvoke("shell:share-paths", { paths: Array.isArray(targetPaths) ? targetPaths : [targetPaths] }),
  printPath: (targetPath) => safeInvoke("shell:print-path", { path: targetPath }),
  writeClipboardText: (text) => safeInvoke("clipboard:write-text", { text }),
  writeClipboardImagePath: (targetPath) => safeInvoke("clipboard:write-image-path", { path: targetPath }),
  startFileDrag: (targetPath) => safeInvoke("shell:start-drag-file", { path: targetPath }),
  getInitialState: () => safeInvoke("backend:initial-state"),
  rendererReady: () => safeInvoke("app:renderer-ready"),
  setAppLanguage: (language) => safeInvoke("app:set-language", { language }),
  getMcpConnectionInfo: () => safeInvoke("mcp:connection-info"),
  addMcpToCodex: () => safeInvoke("mcp:add-to-codex"),
  revealMcpConfigs: () => safeInvoke("mcp:reveal-configs"),
  revealOrBuildMcpBundle: () => safeInvoke("mcp:reveal-or-build-bundle"),
  startMcpHttpServer: () => safeInvoke("mcp:http-start"),
  stopMcpHttpServer: () => safeInvoke("mcp:http-stop"),
  getMcpHttpStatus: () => safeInvoke("mcp:http-status"),
  onMcpHttpStatus: (callback) => subscribe("mcp:http-status", callback),
  onAppCommand: (callback) => subscribe("app:command", callback),
  onExternalOpen: (callback) => subscribe("app:external-open", callback),
  onScanProgress: (callback) => subscribe("backend:progress", callback),
  onBackendStartup: (callback) => subscribe("backend:startup", callback),
  onFolderWatch: (callback) => subscribe("folder-watch:event", callback),
  onBackendError: (callback) => subscribe("backend:error", callback),
  onUpdateStatus: (callback) => subscribe("updater:event", callback),
  onDiagnosticsEvent: (callback) => subscribe("diagnostics:event", callback),
  platform: safePlatform,
  testCamera: safeEnv.CROSSAGE_TEST_CAMERA === "1",
  testFileDropPathFallback: safeEnv.CROSSAGE_E2E_FILE_DROP_PATH_FALLBACK === "1"
}));

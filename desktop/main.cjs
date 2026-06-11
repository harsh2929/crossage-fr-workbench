const { app, BrowserWindow, dialog, ipcMain, session, Menu, Tray, nativeImage, shell, Notification, clipboard, protocol, net, safeStorage } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL, fileURLToPath } = require("url");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
let backend = null;
let folderWatch = null;
let tray = null;
let isQuitting = false;
let rendererReady = false;
let creatingWindow = null;
const pendingExternalOpens = [];
const userGrantedPaths = new Set();
const queryTrustedMediaPaths = new Set();
const recentDiagnosticEvents = [];
let workspaceLockUnlocked = true;
let workspaceLockInitialized = false;
const MAX_DIAGNOSTIC_EVENTS = 240;
const MAX_DIAGNOSTIC_LOG_BYTES = 2 * 1024 * 1024;
const MAX_BACKEND_STDERR_TAIL_BYTES = 64 * 1024;
const QUERY_TRUSTED_MEDIA_PATH_LIMIT = 20000;
const BACKEND_TIMEOUT_KILL_GRACE_MS = Math.max(1000, Number.parseInt(process.env.CROSSAGE_BACKEND_TIMEOUT_KILL_GRACE_MS || "5000", 10) || 5000);
const WATCH_MAX_QUEUE = Math.max(500, Number.parseInt(process.env.CROSSAGE_WATCH_MAX_QUEUE || "5000", 10) || 5000);
const WATCH_SCAN_BATCH_SIZE = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SCAN_BATCH_SIZE || "250", 10) || 250);
const WATCH_SWEEP_INTERVAL_MS = Math.max(10_000, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_INTERVAL_MS || "45000", 10) || 45_000);
const WATCH_SWEEP_DIR_BUDGET = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_DIR_BUDGET || "800", 10) || 800);
const WATCH_SWEEP_FILE_BUDGET = Math.max(200, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_FILE_BUDGET || "20000", 10) || 20_000);
const WATCH_SWEEP_QUEUE_LIMIT = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_QUEUE_LIMIT || "500", 10) || 500);
const UPDATE_CHANNELS = new Set(["stable", "beta", "internal"]);
let updaterConfigured = false;
let updateState = {
  supported: Boolean(autoUpdater),
  canCheck: false,
  checking: false,
  downloading: false,
  available: false,
  downloaded: false,
  appVersion: safeAppVersion(),
  latestVersion: null,
  progress: null,
  error: null,
  provider: "none",
  channel: "stable",
  message: autoUpdater ? "Update checker is waiting for the app to finish starting." : "Update service is not bundled in this build."
};

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".jpe", ".jfif",
  ".png", ".apng",
  ".gif", ".webp", ".avif",
  ".heic", ".heif", ".hif", ".heics", ".heifs",
  ".bmp", ".dib",
  ".tif", ".tiff",
  ".ico", ".icns",
  ".jp2", ".j2k", ".jpc", ".jpf", ".jpx",
  ".ppm", ".pgm", ".pbm", ".pnm",
  ".tga", ".dds", ".psd",
  ".dng", ".raw", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".orf", ".raf", ".rw2", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".kdc", ".mos", ".mrw"
]);
const VIDEO_EXTENSIONS = new Set([
  ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm", ".hevc",
  ".3gp", ".3g2", ".mts", ".m2ts", ".qt", ".mpeg", ".mpg",
  ".wmv", ".flv", ".asf", ".ogv", ".ts", ".dv"
]);
const APP_USER_MODEL_ID = "com.vintrace.workbench";
const PROTOCOL_SCHEME = "vintrace";
const MEDIA_PROTOCOL_SCHEME = "vintrace-media";
const SUPPORTED_APP_LANGUAGES = new Set(["en", "zh", "es", "fr", "ar", "hi", "ja"]);
let appLanguage = "en";
const MENU_TRANSLATIONS = {
  zh: {
    "File": "文件",
    "Open Workspace...": "打开工作区...",
    "Reveal Workspace": "显示工作区",
    "Refresh": "刷新",
    "Workflow": "工作流",
    "Dashboard": "仪表盘",
    "Enroll": "添加人物",
    "Scan": "扫描",
    "Review": "复核",
    "Settings": "设置",
    "Run Scan": "运行扫描",
    "Start Folder Watch": "开始文件夹监控",
    "Stop Folder Watch": "停止文件夹监控",
    "View": "视图",
    "Window": "窗口",
    "Help": "帮助",
    "Show Workbench": "显示工作台",
    "Open Workspace Folder": "打开工作区文件夹",
    "Export Diagnostics...": "导出诊断...",
    "Diagnostics export failed": "诊断导出失败",
    "Show Vintrace": "显示 Vintrace",
    "Vintrace": "Vintrace 工作台",
    "Watching: scanning": "监控中：正在扫描",
    "Watching": "监控中",
    "Not watching": "未监控",
    "Quit": "退出",
    "Export diagnostics report": "导出诊断报告",
    "The app window could not load.": "应用窗口无法加载。",
    "Vintrace could not open the main window.": "Vintrace 无法打开主窗口。",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "应用仍在运行。请重启应用；如果问题重复，请从应用菜单导出诊断。",
    "Scan cancelled": "扫描已取消",
    "Scan complete": "扫描完成",
    "Enrollment complete": "添加完成",
    "file(s) processed. Resume will skip completed files.": "个文件已处理。恢复时会跳过已完成文件。",
    "candidate(s) queued.": "个候选项已加入队列。",
    "protected.": "已保护。",
    "reference face(s) enrolled.": "张参考人脸已添加。"
  },
  es: {
    "File": "Archivo",
    "Open Workspace...": "Abrir espacio de trabajo...",
    "Reveal Workspace": "Mostrar espacio de trabajo",
    "Refresh": "Actualizar",
    "Workflow": "Flujo",
    "Dashboard": "Panel",
    "Enroll": "Añadir persona",
    "Scan": "Escanear",
    "Review": "Revisar",
    "Settings": "Ajustes",
    "Run Scan": "Ejecutar escaneo",
    "Start Folder Watch": "Iniciar vigilancia de carpeta",
    "Stop Folder Watch": "Detener vigilancia de carpeta",
    "View": "Ver",
    "Window": "Ventana",
    "Help": "Ayuda",
    "Show Workbench": "Mostrar Vintrace",
    "Open Workspace Folder": "Abrir carpeta del espacio",
    "Export Diagnostics...": "Exportar diagnósticos...",
    "Diagnostics export failed": "No se pudo exportar el diagnóstico",
    "Show Vintrace": "Mostrar Vintrace",
    "Vintrace": "Panel Vintrace",
    "Watching: scanning": "Vigilando: escaneando",
    "Watching": "Vigilando",
    "Not watching": "Sin vigilancia",
    "Quit": "Salir",
    "Export diagnostics report": "Exportar informe de diagnóstico",
    "The app window could not load.": "La ventana de la app no pudo cargarse.",
    "Vintrace could not open the main window.": "Vintrace no pudo abrir la ventana principal.",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "La app sigue ejecutándose. Reiníciala o exporta diagnósticos desde el menú si se repite.",
    "Scan cancelled": "Escaneo cancelado",
    "Scan complete": "Escaneo completo",
    "Enrollment complete": "Registro completo",
    "file(s) processed. Resume will skip completed files.": "archivo(s) procesado(s). Al reanudar se omitirán los completados.",
    "candidate(s) queued.": "candidato(s) en cola.",
    "protected.": "protegido(s).",
    "reference face(s) enrolled.": "rostro(s) de referencia registrado(s)."
  },
  fr: {
    "File": "Fichier",
    "Open Workspace...": "Ouvrir l'espace de travail...",
    "Reveal Workspace": "Afficher l'espace de travail",
    "Refresh": "Actualiser",
    "Workflow": "Flux de travail",
    "Dashboard": "Tableau",
    "Enroll": "Ajouter une personne",
    "Scan": "Scanner",
    "Review": "Revoir",
    "Settings": "Réglages",
    "Run Scan": "Lancer le scan",
    "Start Folder Watch": "Démarrer la surveillance",
    "Stop Folder Watch": "Arrêter la surveillance",
    "View": "Affichage",
    "Window": "Fenêtre",
    "Help": "Aide",
    "Show Workbench": "Afficher Vintrace",
    "Open Workspace Folder": "Ouvrir le dossier de travail",
    "Export Diagnostics...": "Exporter les diagnostics...",
    "Diagnostics export failed": "Échec de l'export des diagnostics",
    "Show Vintrace": "Afficher Vintrace",
    "Vintrace": "Atelier Vintrace",
    "Watching: scanning": "Surveillance : scan en cours",
    "Watching": "Surveillance active",
    "Not watching": "Aucune surveillance",
    "Quit": "Quitter",
    "Export diagnostics report": "Exporter le rapport de diagnostics",
    "The app window could not load.": "La fenêtre de l'app n'a pas pu se charger.",
    "Vintrace could not open the main window.": "Vintrace n'a pas pu ouvrir la fenêtre principale.",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "L'app fonctionne encore. Redémarrez-la ou exportez les diagnostics depuis le menu si cela se répète.",
    "Scan cancelled": "Scan annulé",
    "Scan complete": "Scan terminé",
    "Enrollment complete": "Ajout terminé",
    "file(s) processed. Resume will skip completed files.": "fichier(s) traité(s). La reprise ignorera les fichiers terminés.",
    "candidate(s) queued.": "candidat(s) en file.",
    "protected.": "protégé(s).",
    "reference face(s) enrolled.": "visage(s) de référence ajouté(s)."
  },
  ar: {
    "File": "ملف",
    "Open Workspace...": "فتح مساحة العمل...",
    "Reveal Workspace": "إظهار مساحة العمل",
    "Refresh": "تحديث",
    "Workflow": "سير العمل",
    "Dashboard": "لوحة التحكم",
    "Enroll": "إضافة شخص",
    "Scan": "فحص",
    "Review": "مراجعة",
    "Settings": "الإعدادات",
    "Run Scan": "تشغيل الفحص",
    "Start Folder Watch": "بدء مراقبة المجلد",
    "Stop Folder Watch": "إيقاف مراقبة المجلد",
    "View": "عرض",
    "Window": "نافذة",
    "Help": "مساعدة",
    "Show Workbench": "إظهار Vintrace",
    "Open Workspace Folder": "فتح مجلد مساحة العمل",
    "Export Diagnostics...": "تصدير التشخيصات...",
    "Diagnostics export failed": "فشل تصدير التشخيصات",
    "Show Vintrace": "إظهار Vintrace",
    "Vintrace": "مساحة عمل Vintrace",
    "Watching: scanning": "تتم المراقبة: جار الفحص",
    "Watching": "تتم المراقبة",
    "Not watching": "لا توجد مراقبة",
    "Quit": "إنهاء",
    "Export diagnostics report": "تصدير تقرير التشخيصات",
    "The app window could not load.": "تعذر تحميل نافذة التطبيق.",
    "Vintrace could not open the main window.": "تعذر على Vintrace فتح النافذة الرئيسية.",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "لا يزال التطبيق يعمل. أعد تشغيله، أو صدّر التشخيصات من قائمة التطبيق إذا تكرر ذلك.",
    "Scan cancelled": "تم إلغاء الفحص",
    "Scan complete": "اكتمل الفحص",
    "Enrollment complete": "اكتملت الإضافة",
    "file(s) processed. Resume will skip completed files.": "ملف/ملفات تمت معالجتها. سيتجاوز الاستئناف الملفات المكتملة.",
    "candidate(s) queued.": "مرشح/مرشحون في قائمة الانتظار.",
    "protected.": "محمي.",
    "reference face(s) enrolled.": "وجه/وجوه مرجعية تمت إضافتها."
  },
  hi: {
    "File": "फ़ाइल",
    "Open Workspace...": "वर्कस्पेस खोलें...",
    "Reveal Workspace": "वर्कस्पेस दिखाएँ",
    "Refresh": "रीफ़्रेश",
    "Workflow": "वर्कफ़्लो",
    "Dashboard": "डैशबोर्ड",
    "Enroll": "व्यक्ति जोड़ें",
    "Scan": "स्कैन",
    "Review": "समीक्षा",
    "Settings": "सेटिंग्स",
    "Run Scan": "स्कैन चलाएँ",
    "Start Folder Watch": "फ़ोल्डर निगरानी शुरू करें",
    "Stop Folder Watch": "फ़ोल्डर निगरानी रोकें",
    "View": "दृश्य",
    "Window": "विंडो",
    "Help": "सहायता",
    "Show Workbench": "Vintrace दिखाएँ",
    "Open Workspace Folder": "वर्कस्पेस फ़ोल्डर खोलें",
    "Export Diagnostics...": "डायग्नॉस्टिक्स निर्यात करें...",
    "Diagnostics export failed": "डायग्नॉस्टिक्स निर्यात विफल",
    "Show Vintrace": "Vintrace दिखाएँ",
    "Vintrace": "Vintrace वर्कबेंच",
    "Watching: scanning": "निगरानी: स्कैन जारी",
    "Watching": "निगरानी जारी",
    "Not watching": "निगरानी बंद",
    "Quit": "बंद करें",
    "Export diagnostics report": "डायग्नॉस्टिक्स रिपोर्ट निर्यात करें",
    "The app window could not load.": "ऐप विंडो लोड नहीं हो सकी।",
    "Vintrace could not open the main window.": "Vintrace मुख्य विंडो नहीं खोल सका।",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "ऐप अभी चल रहा है। इसे रीस्टार्ट करें, या दोबारा होने पर ऐप मेन्यू से डायग्नॉस्टिक्स निर्यात करें।",
    "Scan cancelled": "स्कैन रद्द",
    "Scan complete": "स्कैन पूरा",
    "Enrollment complete": "जोड़ना पूरा",
    "file(s) processed. Resume will skip completed files.": "फ़ाइल प्रोसेस हुई। फिर शुरू करने पर पूरी हुई फ़ाइलें छोड़ी जाएँगी।",
    "candidate(s) queued.": "उम्मीदवार कतार में।",
    "protected.": "सुरक्षित।",
    "reference face(s) enrolled.": "रेफरेंस चेहरा जोड़ा गया।"
  },
  ja: {
    "File": "ファイル",
    "Open Workspace...": "ワークスペースを開く...",
    "Reveal Workspace": "ワークスペースを表示",
    "Refresh": "更新",
    "Workflow": "ワークフロー",
    "Dashboard": "ダッシュボード",
    "Enroll": "人物を追加",
    "Scan": "スキャン",
    "Review": "確認",
    "Settings": "設定",
    "Run Scan": "スキャンを実行",
    "Start Folder Watch": "フォルダ監視を開始",
    "Stop Folder Watch": "フォルダ監視を停止",
    "View": "表示",
    "Window": "ウィンドウ",
    "Help": "ヘルプ",
    "Show Workbench": "Vintrace を表示",
    "Open Workspace Folder": "ワークスペースフォルダを開く",
    "Export Diagnostics...": "診断をエクスポート...",
    "Diagnostics export failed": "診断のエクスポートに失敗",
    "Show Vintrace": "Vintrace を表示",
    "Vintrace": "Vintrace ワークベンチ",
    "Watching: scanning": "監視中: スキャン中",
    "Watching": "監視中",
    "Not watching": "監視していません",
    "Quit": "終了",
    "Export diagnostics report": "診断レポートをエクスポート",
    "The app window could not load.": "アプリウィンドウを読み込めませんでした。",
    "Vintrace could not open the main window.": "Vintrace はメインウィンドウを開けませんでした。",
    "The app is still running. Restart it, or export diagnostics from the app menu if this repeats.": "アプリはまだ実行中です。再起動してください。繰り返す場合はアプリメニューから診断をエクスポートしてください。",
    "Scan cancelled": "スキャンをキャンセルしました",
    "Scan complete": "スキャン完了",
    "Enrollment complete": "登録完了",
    "file(s) processed. Resume will skip completed files.": "ファイルを処理しました。再開時は完了済みファイルをスキップします。",
    "candidate(s) queued.": "候補をキューに追加しました。",
    "protected.": "保護済み。",
    "reference face(s) enrolled.": "参照顔を登録しました。"
  }
};
const BACKEND_COMMAND_TIMEOUT_MS = Math.max(
  60_000,
  Number.parseInt(process.env.CROSSAGE_BACKEND_COMMAND_TIMEOUT_MS || "3600000", 10) || 3_600_000
);

function normalizeAppLanguage(value) {
  const code = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_APP_LANGUAGES.has(code) ? code : "en";
}

function nativeText(source) {
  if (appLanguage === "en") return source;
  return MENU_TRANSLATIONS[appLanguage]?.[source] || source;
}

function nativeUiText(source) {
  if (appLanguage === "en") return source;
  const exact = nativeText(source);
  if (exact !== source) return exact;
  let translated = source;
  const entries = Object.entries(MENU_TRANSLATIONS[appLanguage] || {})
    .filter(([phrase, replacement]) => phrase.length >= 8 && replacement && phrase !== replacement)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [phrase, replacement] of entries) {
    if (translated.includes(phrase)) {
      translated = translated.split(phrase).join(replacement);
    }
  }
  return translated;
}

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
  "export_review_ledger",
  "export_scan_history",
  "export_workspace_backup",
  "verify_workspace_backup",
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
  "export_support_bundle",
  "installer_self_diagnostics",
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
  "audit_events"
]);

app.setAppUserModelId(APP_USER_MODEL_ID);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function configureRendererStability() {
  if (process.platform !== "darwin" || process.env.CROSSAGE_ENABLE_GPU === "1") {
    return;
  }
  // Avoid macOS Metal/Electron GPU-process traps; recognition compute stays in the backend.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

configureRendererStability();

process.on("uncaughtExceptionMonitor", (error) => {
  appendDiagnosticEvent({
    type: "main_uncaught_exception",
    level: "fatal",
    message: error instanceof Error ? error.message : String(error),
    stack: diagnosticStack(error)
  });
});

process.on("unhandledRejection", (reason) => {
  appendDiagnosticEvent({
    type: "main_unhandled_rejection",
    level: "error",
    message: reason instanceof Error ? reason.message : String(reason),
    stack: diagnosticStack(reason)
  });
});

app.on("render-process-gone", (_event, contents, details = {}) => {
  appendDiagnosticEvent({
    type: "renderer_process_gone",
    level: "error",
    reason: details.reason || "unknown",
    exitCode: details.exitCode ?? null,
    url: contents?.getURL?.() || ""
  });
});

app.on("child-process-gone", (_event, details = {}) => {
  appendDiagnosticEvent({
    type: "child_process_gone",
    level: "error",
    name: details.name || details.type || "child",
    reason: details.reason || "unknown",
    exitCode: details.exitCode ?? null
  });
});

function appRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..");
}

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "desktop", "assets", "icon.png");
  }
  return path.join(appRoot(), "desktop", "assets", "icon.png");
}

function watchConfigPath() {
  return path.join(app.getPath("userData"), "folder-watch.json");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

function readJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function updateChannelPath() {
  return path.join(app.getPath("userData"), "update-channel.json");
}

function normalizeUpdateChannel(value) {
  const channel = String(value || "").trim().toLowerCase();
  return UPDATE_CHANNELS.has(channel) ? channel : "stable";
}

function readUpdateChannel() {
  return normalizeUpdateChannel(readJsonObject(updateChannelPath()).channel || process.env.VINTRACE_UPDATE_CHANNEL || process.env.CROSSAGE_UPDATE_CHANNEL || "stable");
}

function writeUpdateChannel(channel) {
  const safeChannel = normalizeUpdateChannel(channel);
  writeJsonAtomic(updateChannelPath(), {
    channel: safeChannel,
    updatedAt: new Date().toISOString()
  });
  return safeChannel;
}

function updaterChannelName(channel) {
  return normalizeUpdateChannel(channel) === "stable" ? "latest" : normalizeUpdateChannel(channel);
}

function safeAppVersion() {
  try {
    return app.getVersion();
  } catch {
    return "0.0.0";
  }
}

function gitValue(args) {
  try {
    const result = spawnSync("git", args, {
      cwd: appRoot(),
      encoding: "utf8",
      timeout: 1500,
      windowsHide: true
    });
    if (result.status === 0) {
      return String(result.stdout || "").trim();
    }
  } catch {
    return "";
  }
  return "";
}

function buildInfo() {
  return {
    name: app.getName(),
    version: safeAppVersion(),
    commit: process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || gitValue(["rev-parse", "--short=12", "HEAD"]) || "local",
    branch: process.env.VINTRACE_BUILD_REF || process.env.GITHUB_REF_NAME || gitValue(["rev-parse", "--abbrev-ref", "HEAD"]) || "",
    buildDate: process.env.VINTRACE_BUILD_DATE || "",
    channel: readUpdateChannel(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch
  };
}

function safeUserPath(name) {
  try {
    return app.getPath(name);
  } catch {
    return "";
  }
}

function pathAvailable(targetPath) {
  try {
    return Boolean(targetPath && fs.existsSync(targetPath));
  } catch {
    return false;
  }
}

function photoSource(id, label, detail, sourcePath, kind = "folder") {
  return {
    id,
    label,
    detail,
    path: sourcePath,
    kind,
    platform: process.platform,
    available: pathAvailable(sourcePath)
  };
}

function uniquePhotoSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = path.resolve(source.path || "");
    if (!source.path || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function systemPhotoSources() {
  const home = safeUserPath("home") || os.homedir();
  const pictures = safeUserPath("pictures") || path.join(home, "Pictures");
  const sources = [
    photoSource("pictures", "Pictures folder", "Default photo folder on this computer.", pictures)
  ];
  if (process.platform === "darwin") {
    const photosLibrary = path.join(pictures, "Photos Library.photoslibrary");
    sources.push(
      photoSource("apple-photos-originals", "Apple Photos originals", "Original media inside the local Apple Photos library package.", path.join(photosLibrary, "originals"), "apple-photos"),
      photoSource("apple-photos-library", "Apple Photos library", "Search the Photos library package if originals are stored in another package layout.", photosLibrary, "apple-photos"),
      photoSource("icloud-drive", "iCloud Drive", "Useful when photos are exported or synced into iCloud Drive folders.", path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"))
    );
  } else if (process.platform === "win32") {
    const oneDriveRoot = process.env.OneDrive || path.join(home, "OneDrive");
    sources.push(
      photoSource("windows-camera-roll", "Camera Roll", "Windows Photos camera import folder.", path.join(pictures, "Camera Roll"), "windows-photos"),
      photoSource("windows-saved-pictures", "Saved Pictures", "Windows Photos saved media folder.", path.join(pictures, "Saved Pictures"), "windows-photos"),
      photoSource("onedrive-pictures", "OneDrive Pictures", "Common Windows Photos and phone-sync location.", path.join(oneDriveRoot, "Pictures"), "windows-photos")
    );
  }
  return uniquePhotoSources(sources);
}

function activeWorkspacePath() {
  const readyWorkspace = backend?.readyState?.workspace;
  return path.resolve(readyWorkspace || process.env.VINTRACE_WORKSPACE || process.env.CROSSAGE_WORKSPACE || path.join(app.getPath("userData"), "workspace"));
}

function workspaceLockFilePath(workspace = activeWorkspacePath()) {
  return path.join(path.resolve(workspace), ".vintrace-workspace-lock.json");
}

function workspaceLockSupported() {
  try {
    return Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    return false;
  }
}

function readWorkspaceLock(workspace = activeWorkspacePath()) {
  return readJsonObject(workspaceLockFilePath(workspace));
}

function writeWorkspaceLock(row, workspace = activeWorkspacePath()) {
  const lockPath = workspaceLockFilePath(workspace);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  writeJsonAtomic(lockPath, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    platform: process.platform,
    ...row
  });
}

function getWorkspaceLockStatus() {
  const workspace = activeWorkspacePath();
  const lockPath = workspaceLockFilePath(workspace);
  const enabled = pathAvailable(lockPath);
  const supported = workspaceLockSupported();
  const locked = Boolean(enabled && !workspaceLockUnlocked);
  return {
    supported,
    enabled,
    locked,
    workspace,
    lockPath,
    usingOsKeychain: supported,
    message: !supported
      ? "This system does not expose OS encryption to Electron."
      : !enabled
        ? "Workspace lock is off."
        : locked
          ? "Workspace is locked on this computer."
          : "Workspace is unlocked for this session."
  };
}

function enableWorkspaceLock() {
  if (!workspaceLockSupported()) {
    throw createAppError("E-WORKSPACE-LOCK-UNAVAILABLE", "OS-backed encryption is not available on this computer.");
  }
  const secret = crypto.randomBytes(32).toString("hex");
  const encrypted = safeStorage.encryptString(secret).toString("base64");
  writeWorkspaceLock({
    encryptedSecret: encrypted,
    encryption: "electron.safeStorage",
    note: "Controls app access on this OS user account. Original photo files are not modified."
  });
  workspaceLockUnlocked = true;
  appendDiagnosticEvent({ type: "workspace_lock_enabled", level: "info", workspace: activeWorkspacePath() });
  return getWorkspaceLockStatus();
}

function lockWorkspaceNow() {
  if (!pathAvailable(workspaceLockFilePath())) {
    throw createAppError("E-WORKSPACE-LOCK-OFF", "Enable Workspace Lock before locking this app folder.");
  }
  workspaceLockUnlocked = false;
  appendDiagnosticEvent({ type: "workspace_locked", level: "info", workspace: activeWorkspacePath() });
  return getWorkspaceLockStatus();
}

function unlockWorkspace() {
  const row = readWorkspaceLock();
  if (!row.encryptedSecret) {
    workspaceLockUnlocked = true;
    return getWorkspaceLockStatus();
  }
  if (!workspaceLockSupported()) {
    throw createAppError("E-WORKSPACE-LOCK-UNAVAILABLE", "OS-backed encryption is not available on this computer.");
  }
  try {
    const decrypted = safeStorage.decryptString(Buffer.from(String(row.encryptedSecret), "base64"));
    if (!decrypted) {
      throw createAppError("E-WORKSPACE-LOCK-SECRET", "Empty lock secret.");
    }
    workspaceLockUnlocked = true;
    appendDiagnosticEvent({ type: "workspace_unlocked", level: "info", workspace: activeWorkspacePath() });
    return getWorkspaceLockStatus();
  } catch (error) {
    appendDiagnosticEvent({
      type: "workspace_unlock_failed",
      level: "warn",
      message: error instanceof Error ? error.message : String(error),
      workspace: activeWorkspacePath()
    });
    throw createAppError("E-WORKSPACE-LOCK-UNLOCK", "This app folder could not be unlocked on this computer.");
  }
}

function disableWorkspaceLock() {
  const status = getWorkspaceLockStatus();
  if (status.enabled && status.locked) {
    throw createAppError("E-WORKSPACE-LOCK-DISABLE", "Unlock this app folder before turning Workspace Lock off.");
  }
  try {
    fs.unlinkSync(workspaceLockFilePath());
  } catch {
    // Already off.
  }
  workspaceLockUnlocked = true;
  appendDiagnosticEvent({ type: "workspace_lock_disabled", level: "info", workspace: activeWorkspacePath() });
  return getWorkspaceLockStatus();
}

function isWorkspaceLocked() {
  return Boolean(getWorkspaceLockStatus().locked);
}

function initializeWorkspaceLockForActiveWorkspace() {
  if (workspaceLockInitialized) {
    return;
  }
  workspaceLockUnlocked = !pathAvailable(workspaceLockFilePath());
  workspaceLockInitialized = true;
}

function diagnosticsDir() {
  const root = safeUserPath("userData") || appRoot();
  return path.join(root, "diagnostics");
}

function diagnosticsLogPath() {
  return path.join(diagnosticsDir(), "events.jsonl");
}

const ERROR_CATALOG = {
  main_uncaught_exception: { code: "E-MAIN-UNCAUGHT", category: "main", severity: "fatal", action: "Restart the app and export diagnostics if it repeats." },
  main_unhandled_rejection: { code: "E-MAIN-PROMISE", category: "main", severity: "error", action: "Retry the last action; export diagnostics if it repeats." },
  renderer_process_gone: { code: "E-RENDERER-CRASH", category: "renderer", severity: "fatal", action: "Restart the app window." },
  window_render_process_gone: { code: "E-RENDERER-CRASH", category: "renderer", severity: "fatal", action: "Restart the app window." },
  renderer_unresponsive: { code: "E-RENDERER-HANG", category: "renderer", severity: "warn", action: "Wait briefly, then export diagnostics if the app remains stuck." },
  renderer_load_fallback: { code: "E-RENDERER-LOAD", category: "renderer", severity: "error", action: "Restart the app; reinstall if the main window cannot load." },
  renderer_runtime_error: { code: "E-RENDERER-RUNTIME", category: "renderer", severity: "error", action: "Retry the last action; export diagnostics if it repeats." },
  renderer_unhandled_rejection: { code: "E-RENDERER-PROMISE", category: "renderer", severity: "error", action: "Retry the last action; export diagnostics if it repeats." },
  renderer_action_failed: { code: "E-RENDERER-ACTION", category: "renderer", severity: "error", action: "Retry the action after checking the app status." },
  backend_start_failed: { code: "E-BACKEND-START", category: "backend", severity: "error", action: "Restart the app; verify Python/backend bundle installation." },
  backend_process_error: { code: "E-BACKEND-PROCESS", category: "backend", severity: "error", action: "Restart the app; export diagnostics if backend errors continue." },
  backend_exited: { code: "E-BACKEND-EXIT", category: "backend", severity: "error", action: "Restart the app; export diagnostics if the backend exits again." },
  backend_command_failed: { code: "E-BACKEND-COMMAND", category: "backend", severity: "error", action: "Check the command detail and retry." },
  backend_command_timeout: { code: "E-BACKEND-TIMEOUT", category: "backend", severity: "error", action: "Cancel or restart the scan; the backend will be recovered automatically." },
  update_error: { code: "E-UPDATE-FAILED", category: "update", severity: "error", action: "Retry update check/download later." },
  update_check_failed: { code: "E-UPDATE-CHECK", category: "update", severity: "error", action: "Check network access and retry." },
  update_download_failed: { code: "E-UPDATE-DOWNLOAD", category: "update", severity: "error", action: "Check network access and retry the download." },
  diagnostics_read_failed: { code: "E-DIAG-READ", category: "diagnostics", severity: "warn", action: "Export diagnostics again after restarting the app." },
  renderer_fallback_failed: { code: "E-DIAG-FALLBACK", category: "diagnostics", severity: "fatal", action: "Restart or reinstall the app." }
};

const BACKEND_ERROR_CODE_MAP = {
  PermissionError: "E-BACKEND-PERMISSION",
  ValueError: "E-BACKEND-VALIDATION",
  KeyError: "E-BACKEND-NOT-FOUND",
  FileNotFoundError: "E-FS-NOT-FOUND",
  IsADirectoryError: "E-FS-DIRECTORY",
  NotADirectoryError: "E-FS-NOT-DIRECTORY",
  PermissionDenied: "E-FS-PERMISSION",
  PermissionError: "E-BACKEND-PERMISSION",
  TimeoutError: "E-BACKEND-TIMEOUT",
  ImageLoadError: "E-MEDIA-IMAGE-DECODE",
  VideoLoadError: "E-MEDIA-VIDEO-DECODE",
  FileChangedDuringScanError: "E-SCAN-FILE-CHANGED",
  InterruptedError: "E-SCAN-CANCELLED"
};

const ERROR_CODE_META = {
  "E-SECURITY-IPC": { category: "security", severity: "error", action: "Restart the app window; report this if it repeats." },
  "E-IPC-PAYLOAD": { category: "security", severity: "warn", action: "Retry the action; export diagnostics if it repeats." },
  "E-IPC-BLOCKED-COMMAND": { category: "security", severity: "error", action: "Update or reinstall the app if this repeats." },
  "E-IPC-PARAMS-LARGE": { category: "security", severity: "warn", action: "Use a smaller selection and retry." },
  "E-DIAG-EVENT-LARGE": { category: "diagnostics", severity: "warn", action: "Export diagnostics without the oversized event." },
  "E-WORKSPACE-LOCKED": { category: "privacy", severity: "warn", action: "Unlock the app folder before continuing." },
  "E-WORKSPACE-LOCK-UNAVAILABLE": { category: "privacy", severity: "warn", action: "Use another app folder or disable Workspace Lock on this computer." },
  "E-WORKSPACE-LOCK-OFF": { category: "privacy", severity: "warn", action: "Enable Workspace Lock before locking this app folder." },
  "E-WORKSPACE-LOCK-SECRET": { category: "privacy", severity: "error", action: "Disable and re-enable Workspace Lock after verifying backups." },
  "E-WORKSPACE-LOCK-UNLOCK": { category: "privacy", severity: "error", action: "Reconnect the OS user account/keychain or choose another app folder." },
  "E-WORKSPACE-LOCK-DISABLE": { category: "privacy", severity: "warn", action: "Unlock the app folder before disabling Workspace Lock." },
  "E-CAMERA-FRAME-TYPE": { category: "camera", severity: "warn", action: "Capture a PNG, JPEG, or WebP frame." },
  "E-CAMERA-FRAME-EMPTY": { category: "camera", severity: "warn", action: "Capture a new frame and retry." },
  "E-CAMERA-FRAME-LARGE": { category: "camera", severity: "warn", action: "Capture a smaller frame and retry." },
  "E-FOLDER-WATCH-PATH": { category: "filesystem", severity: "warn", action: "Choose a folder before starting watch mode." },
  "E-BACKEND-NOT-READY": { category: "backend", severity: "error", action: "Restart the app if the engine does not recover." },
  "E-BACKEND-PIPE": { category: "backend", severity: "error", action: "Restart the app; export diagnostics if this repeats." },
  "E-BACKEND-PERMISSION": { category: "privacy", severity: "warn", action: "Confirm permission or unlock the app folder, then retry." },
  "E-BACKEND-VALIDATION": { category: "input", severity: "warn", action: "Review the requested values and retry." },
  "E-BACKEND-NOT-FOUND": { category: "data", severity: "warn", action: "Refresh the app; the selected item may have been removed." },
  "E-FS-NOT-FOUND": { category: "filesystem", severity: "warn", action: "Reconnect the drive or choose a different folder." },
  "E-FS-DIRECTORY": { category: "filesystem", severity: "warn", action: "Choose a file where a file is expected." },
  "E-FS-NOT-DIRECTORY": { category: "filesystem", severity: "warn", action: "Choose a folder where a folder is expected." },
  "E-FS-PERMISSION": { category: "filesystem", severity: "error", action: "Grant folder access or choose a writable folder." },
  "E-MEDIA-IMAGE-DECODE": { category: "media", severity: "warn", action: "Skip or convert the image, then scan again." },
  "E-MEDIA-VIDEO-DECODE": { category: "media", severity: "warn", action: "Skip or convert the video, then scan again." },
  "E-SCAN-FILE-CHANGED": { category: "scan", severity: "warn", action: "Run the scan again after file copying finishes." },
  "E-SCAN-CANCELLED": { category: "scan", severity: "info", action: "Resume the scan when ready." }
};

function errorCatalogEntry(type) {
  return ERROR_CATALOG[String(type || "")] || null;
}

function codeMeta(code) {
  return ERROR_CODE_META[String(code || "")] || null;
}

function createAppError(code, message, details = {}) {
  const safeCode = String(code || "E-APP-ERROR");
  const safeMessage = String(message || "The action failed.");
  const error = new Error(`[${safeCode}] ${safeMessage}`);
  const meta = codeMeta(safeCode) || {};
  error.code = safeCode;
  error.category = details.category || meta.category || "app";
  error.severity = details.severity || meta.severity || "error";
  error.action = details.action || meta.action || "";
  error.publicMessage = safeMessage;
  Object.assign(error, details);
  return error;
}

function codeFromBackendError(error) {
  if (!error || typeof error !== "object") {
    return "";
  }
  return String(error.code || BACKEND_ERROR_CODE_MAP[String(error.type || "")] || "");
}

function fallbackCodeForEvent(event) {
  const catalog = errorCatalogEntry(event.type);
  if (catalog?.code) {
    return catalog.code;
  }
  const level = String(event.level || "").toLowerCase();
  if (level === "fatal") return "E-APP-FATAL";
  if (level === "error") return "E-APP-ERROR";
  if (level === "warn") return "W-APP-WARNING";
  return "I-APP-EVENT";
}

function diagnosticStack(error) {
  if (!error) {
    return "";
  }
  if (error instanceof Error) {
    return error.stack || error.message || "";
  }
  if (typeof error === "object" && "stack" in error) {
    return String(error.stack || error.message || "");
  }
  return String(error);
}

function redactPathString(value) {
  let text = String(value || "");
  const home = safeUserPath("home");
  if (home) {
    text = text.split(home).join("~");
  }
  const replacePath = (prefix, pathValue) => {
    const basename = String(pathValue || "").split(/[\\/]/).filter(Boolean).pop() || "path";
    return `${prefix}[hidden]/${basename}`;
  };
  text = text.replace(/(^|[\s"'([{=])((?:\/(?:Users|Volumes|home|mnt|media|tmp|var|private|opt|Applications|Library|System|Network)\/)[^\s"'<>)]*)/g, replacePath);
  text = text.replace(/(^|[\s"'([{=])([A-Z]:\\[^\s"'<>)]*)/gi, replacePath);
  text = text.replace(/(^|[\s"'([{=])(\\\\[^\\\s"'<>]+\\[^\s"'<>)]*)/g, replacePath);
  return text;
}

function redactDiagnosticPath(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  const trimmed = text.replace(/[\\/]+$/, "");
  const basename = trimmed.split(/[\\/]/).filter(Boolean).pop() || "path";
  if (path.isAbsolute(text) || /^[A-Z]:\\/i.test(text) || text.includes("/") || text.includes("\\")) {
    return `[hidden]/${basename}`;
  }
  return redactPathString(text);
}

function redactDiagnosticValue(value, includePaths = false) {
  if (includePaths || value == null) {
    return value;
  }
  if (typeof value === "string") {
    return redactPathString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item, includePaths));
  }
  if (typeof value === "object") {
    const next = {};
    for (const [key, child] of Object.entries(value)) {
      const lower = key.toLowerCase();
      if ((lower.includes("path") || lower.includes("folder")) && typeof child === "string") {
        next[key] = redactDiagnosticPath(child);
      } else {
        next[key] = redactDiagnosticValue(child, includePaths);
      }
    }
    return next;
  }
  return value;
}

function readFileTail(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const bytes = Math.min(maxBytes, stat.size);
  const start = Math.max(0, stat.size - bytes);
  const buffer = Buffer.alloc(bytes);
  const fd = fs.openSync(filePath, "r");
  try {
    fs.readSync(fd, buffer, 0, bytes, start);
  } finally {
    fs.closeSync(fd);
  }
  const text = buffer.toString("utf8");
  return start > 0 ? text.replace(/^[^\n]*(?:\n|$)/, "") : text;
}

function trimDiagnosticsLog() {
  const filePath = diagnosticsLogPath();
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const stat = fs.statSync(filePath);
    if (stat.size <= MAX_DIAGNOSTIC_LOG_BYTES * 2) {
      return;
    }
    fs.writeFileSync(filePath, readFileTail(filePath, MAX_DIAGNOSTIC_LOG_BYTES), "utf8");
  } catch {
    // Diagnostics must never crash the app.
  }
}

function diagnosticFingerprint(row) {
  const basis = [
    row.code || "",
    row.type || "",
    row.command || "",
    row.category || "",
    String(row.message || row.reason || "").slice(0, 240)
  ].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

function diagnosticEventId(row) {
  return crypto.createHash("sha256")
    .update(`${row.at || ""}|${row.code || ""}|${row.type || ""}|${row.fingerprint || ""}|${row.message || ""}`)
    .digest("hex")
    .slice(0, 20);
}

function normalizeDiagnosticEvent(event) {
  const catalog = errorCatalogEntry(event.type);
  const backendCode = codeFromBackendError(event.backendError || event.error);
  const code = String(event.code || backendCode || catalog?.code || fallbackCodeForEvent(event));
  const meta = codeMeta(code);
  const severity = String(event.severity || event.level || meta?.severity || catalog?.severity || "info").toLowerCase();
  const row = {
    ...event,
    at: new Date().toISOString(),
    appVersion: safeAppVersion(),
    platform: process.platform,
    arch: process.arch,
    category: event.category || meta?.category || catalog?.category || "app",
    severity,
    level: event.level || severity,
    code,
    action: event.action || meta?.action || catalog?.action || "Export diagnostics if this repeats.",
    recoverable: event.recoverable ?? !["fatal"].includes(severity)
  };
  row.fingerprint = row.fingerprint || diagnosticFingerprint(row);
  row.eventId = row.eventId || diagnosticEventId(row);
  return row;
}

function appendDiagnosticEvent(event) {
  const row = normalizeDiagnosticEvent(event);
  recentDiagnosticEvents.unshift(row);
  if (recentDiagnosticEvents.length > MAX_DIAGNOSTIC_EVENTS) {
    recentDiagnosticEvents.length = MAX_DIAGNOSTIC_EVENTS;
  }
  try {
    fs.mkdirSync(diagnosticsDir(), { recursive: true });
    fs.appendFileSync(diagnosticsLogPath(), `${JSON.stringify(row)}\n`, "utf8");
    trimDiagnosticsLog();
  } catch {
    // Diagnostics must never crash the app.
  }
  sendToRenderer("diagnostics:event", redactDiagnosticValue(row));
}

function readDiagnosticEvents(limit = MAX_DIAGNOSTIC_EVENTS) {
  const rows = [...recentDiagnosticEvents];
  try {
    if (fs.existsSync(diagnosticsLogPath())) {
      const fileRows = readFileTail(diagnosticsLogPath(), MAX_DIAGNOSTIC_LOG_BYTES)
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit)
        .reverse()
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      for (const row of fileRows) {
        if (!rows.some((item) => item.at === row.at && item.type === row.type)) {
          rows.push(row);
        }
      }
    }
  } catch {
    rows.unshift({
      at: new Date().toISOString(),
      type: "diagnostics_read_failed",
      level: "warn",
      message: "Could not read the local diagnostics log."
    });
  }
  return rows
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, limit);
}

function summarizeDiagnosticEvents(events) {
  const byCode = {};
  const byCategory = {};
  const bySeverity = {};
  const fingerprints = new Map();
  for (const event of events) {
    const code = String(event.code || "I-APP-EVENT");
    const category = String(event.category || "app");
    const severity = String(event.severity || event.level || "info");
    byCode[code] = (byCode[code] || 0) + 1;
    byCategory[category] = (byCategory[category] || 0) + 1;
    bySeverity[severity] = (bySeverity[severity] || 0) + 1;
    const fingerprint = String(event.fingerprint || "");
    if (fingerprint) {
      const current = fingerprints.get(fingerprint) || {
        fingerprint,
        code,
        type: String(event.type || ""),
        message: String(event.message || event.reason || "").slice(0, 240),
        count: 0,
        latestAt: String(event.at || "")
      };
      current.count += 1;
      if (String(event.at || "") > current.latestAt) {
        current.latestAt = String(event.at || "");
      }
      fingerprints.set(fingerprint, current);
    }
  }
  const failureEvents = events.filter((event) => ["fatal", "error", "warn"].includes(String(event.severity || event.level || "")));
  return {
    byCode,
    byCategory,
    bySeverity,
    latestFailureCode: String(failureEvents[0]?.code || ""),
    latestFailureAt: String(failureEvents[0]?.at || ""),
    topFingerprints: [...fingerprints.values()]
      .sort((left, right) => right.count - left.count || String(right.latestAt).localeCompare(String(left.latestAt)))
      .slice(0, 10)
  };
}

function createDiagnosticsReport(options = {}) {
  const includePaths = Boolean(options.includePaths);
  const readyState = backend?.readyState || null;
  const events = readDiagnosticEvents(Number(options.limit || MAX_DIAGNOSTIC_EVENTS))
    .map((row) => redactDiagnosticValue(row, includePaths));
  const summary = summarizeDiagnosticEvents(events);
  const workspace = readyState ? {
    path: includePaths ? readyState.workspace : redactDiagnosticPath(readyState.workspace),
    counts: readyState.counts,
    engine: readyState.engine,
    vectorStore: readyState.vectorStore,
    platform: readyState.platform ? {
      platform_key: readyState.platform.platform_key,
      system: readyState.platform.system,
      machine: readyState.platform.machine,
      primary_provider: readyState.platform.primary_provider,
      accelerator_status: readyState.platform.accelerator_status,
      vector_backend: readyState.platform.vector_backend
    } : null,
    modelSetup: readyState.modelSetup ? {
      ready: readyState.modelSetup.ready,
      currentPack: readyState.modelSetup.currentPack,
      engine: readyState.modelSetup.engine,
      modelRoot: includePaths ? readyState.modelSetup.modelRoot : redactDiagnosticPath(readyState.modelSetup.modelRoot)
    } : null,
    scale: redactDiagnosticValue(readyState.scale || null, includePaths),
    scanJob: redactDiagnosticValue(readyState.scanJob || null, includePaths)
  } : null;
  return {
    generatedAt: new Date().toISOString(),
    privacy: {
      includesPhotos: false,
      includesFaceEmbeddings: false,
      includesFilePaths: includePaths,
      sharing: "Exported locally only. Send it manually after reviewing the contents."
    },
    app: {
      build: buildInfo(),
      name: app.getName(),
      version: safeAppVersion(),
      packaged: app.isPackaged,
      dev: isDev,
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node
    },
    updater: redactDiagnosticValue(updateState, includePaths),
    backend: {
      running: Boolean(backend?.child && !backend.child.killed),
      ready: Boolean(readyState),
      pendingCommands: backend?.pending?.size ?? 0
    },
    workspace,
    diagnostics: {
      eventCount: events.length,
      logPath: includePaths ? diagnosticsLogPath() : redactDiagnosticPath(diagnosticsLogPath()),
      summary,
      events
    }
  };
}

async function exportDiagnosticsReport(options = {}) {
  const includePaths = Boolean(options.includePaths);
  const report = createDiagnosticsReport({ includePaths });
  const defaultPath = path.join(
    safeUserPath("downloads") || safeUserPath("desktop") || appRoot(),
    `vintrace-diagnostics-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  const testPath = process.env.CROSSAGE_TEST_DIAGNOSTICS_PATH;
  let filePath = testPath || "";
  if (!filePath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: nativeUiText("Export diagnostics report"),
      defaultPath,
      filters: [{ name: "JSON report", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return { cancelled: true, path: null, report };
    }
    filePath = result.filePath;
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  grantUserPath(filePath);
  appendDiagnosticEvent({ type: "diagnostics_exported", level: "info", path: filePath, includePaths });
  return { cancelled: false, path: filePath, report };
}

function persistFolderWatch(folder) {
  if (folder) {
    writeJsonAtomic(watchConfigPath(), {
      active: true,
      folder,
      updatedAt: new Date().toISOString()
    });
    return;
  }
  try {
    fs.rmSync(watchConfigPath(), { force: true });
  } catch {
    // Best-effort preference cleanup.
  }
}

function auditDesktopAction(row) {
  if (!backend) {
    return;
  }
  backend.invoke("record_audit", {
    row: {
      source: "desktop",
      ...row
    }
  }).catch(() => undefined);
}

function makeTrayImage() {
  const image = nativeImage.createFromPath(appIconPath());
  if (process.platform === "darwin") {
    const resized = image.resize({ width: 18, height: 18 });
    resized.setTemplateImage(true);
    return resized;
  }
  return image.resize({ width: 16, height: 16 });
}

function encodeMediaPath(filePath) {
  return Buffer.from(path.resolve(String(filePath || "")), "utf8")
    .toString("base64url");
}

function decodeMediaPath(value) {
  try {
    return path.resolve(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return "";
  }
}

function mediaUrlFor(filePath) {
  return `${MEDIA_PROTOCOL_SCHEME}://local/${encodeMediaPath(filePath)}`;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function decodeImageDataUrl(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw createAppError("E-CAMERA-FRAME-TYPE", "Camera frame must be a PNG, JPEG, or WebP data URL.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw createAppError("E-CAMERA-FRAME-EMPTY", "Camera frame is empty.");
  }
  if (buffer.length > 18 * 1024 * 1024) {
    throw createAppError("E-CAMERA-FRAME-LARGE", "Camera frame is too large.");
  }
  const extension = match[1] === "png" ? ".png" : match[1] === "webp" ? ".webp" : ".jpg";
  return { buffer, extension };
}

function isSubpath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeRealpath(filePath) {
  try {
    return fs.realpathSync.native(path.resolve(String(filePath || "")));
  } catch {
    return "";
  }
}

function grantUserPath(filePath) {
  if (typeof filePath === "string" && filePath.trim()) {
    userGrantedPaths.add(path.resolve(filePath));
  }
}

function grantQueryMediaPath(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return;
  }
  queryTrustedMediaPaths.add(path.resolve(filePath));
  while (queryTrustedMediaPaths.size > QUERY_TRUSTED_MEDIA_PATH_LIMIT) {
    const oldest = queryTrustedMediaPaths.values().next().value;
    queryTrustedMediaPaths.delete(oldest);
  }
}

function isUserGrantedPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  for (const granted of userGrantedPaths) {
    if (isSubpath(granted, target) || target === granted) {
      return true;
    }
  }
  return false;
}

function currentTrustedPaths() {
  const state = backend?.readyState;
  const paths = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      paths.add(path.resolve(value));
    }
  };
  add(state?.workspace);
  for (const item of state?.references || []) {
    add(item.sourcePath);
    add(item.previewPath);
  }
  for (const item of state?.candidates || []) {
    add(item.sourcePath);
    add(item.mediaSourcePath);
    add(item.previewPath);
    add(item.bestRefPath);
    add(item.bestRefPreviewPath);
  }
  for (const item of queryTrustedMediaPaths) {
    add(item);
  }
  return { state, paths };
}

function isTrustedMediaPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  const targetReal = safeRealpath(target);
  if (!targetReal) {
    return false;
  }
  const { state, paths } = currentTrustedPaths();
  if (!state || !paths.size) {
    return false;
  }
  if (paths.has(target)) {
    return true;
  }
  const previewsReal = state.workspace ? safeRealpath(path.join(state.workspace, "previews")) : "";
  if (previewsReal && isSubpath(previewsReal, targetReal)) {
    return true;
  }
  return false;
}

function isTrustedShellPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  const { state, paths } = currentTrustedPaths();
  if (!state) {
    return false;
  }
  if (state.workspace && isSubpath(state.workspace, target)) {
    return true;
  }
  return paths.has(target) || isUserGrantedPath(target);
}

function showMainWindow() {
  if (!app.isReady()) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().catch((error) => console.error("[window] failed to create", error));
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return true;
  }
  return false;
}

function publishUpdateState(patch = {}) {
  updateState = {
    ...updateState,
    appVersion: safeAppVersion(),
    ...patch
  };
  sendToRenderer("updater:event", updateState);
  return updateState;
}

function updateProviderLabel() {
  if (process.env.VINTRACE_UPDATE_URL || process.env.CROSSAGE_UPDATE_URL) {
    return "generic";
  }
  if (app.isPackaged) {
    return "github";
  }
  return "developer";
}

function applyUpdateChannelToUpdater(channel) {
  const safeChannel = normalizeUpdateChannel(channel);
  if (autoUpdater) {
    autoUpdater.channel = updaterChannelName(safeChannel);
    autoUpdater.allowPrerelease = safeChannel !== "stable";
  }
  return safeChannel;
}

function configureAutoUpdater() {
  if (updaterConfigured) {
    return updateState;
  }
  updaterConfigured = true;
  const selectedChannel = applyUpdateChannelToUpdater(readUpdateChannel());
  if (!autoUpdater) {
    return publishUpdateState({
      supported: false,
      canCheck: false,
      provider: "none",
      channel: selectedChannel,
      message: "Update service is not bundled in this build."
    });
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;

  const feedUrl = String(process.env.VINTRACE_UPDATE_URL || process.env.CROSSAGE_UPDATE_URL || "").trim();
  const allowDevChecks = process.env.CROSSAGE_ENABLE_UPDATER === "1";
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrl });
  }

  autoUpdater.on("checking-for-update", () => {
    publishUpdateState({
      supported: true,
      canCheck: true,
      checking: true,
      downloading: false,
      error: null,
      message: "Checking for updates."
    });
  });
  autoUpdater.on("update-available", (info = {}) => {
    appendDiagnosticEvent({ type: "update_available", level: "info", version: info.version || null });
    publishUpdateState({
      checking: false,
      available: true,
      downloaded: false,
      latestVersion: info.version || null,
      progress: null,
      error: null,
      message: "An update is available."
    });
  });
  autoUpdater.on("update-not-available", (info = {}) => {
    publishUpdateState({
      checking: false,
      downloading: false,
      available: false,
      downloaded: false,
      latestVersion: info.version || null,
      progress: null,
      error: null,
      message: "You are on the newest version."
    });
  });
  autoUpdater.on("download-progress", (progress = {}) => {
    publishUpdateState({
      checking: false,
      downloading: true,
      progress: {
        percent: Math.max(0, Math.min(100, Number(progress.percent || 0))),
        transferred: Number(progress.transferred || 0),
        total: Number(progress.total || 0),
        bytesPerSecond: Number(progress.bytesPerSecond || 0)
      },
      message: "Downloading update."
    });
  });
  autoUpdater.on("update-downloaded", (info = {}) => {
    appendDiagnosticEvent({ type: "update_downloaded", level: "info", version: info.version || null });
    publishUpdateState({
      checking: false,
      downloading: false,
      available: true,
      downloaded: true,
      latestVersion: info.version || updateState.latestVersion,
      progress: updateState.progress ? { ...updateState.progress, percent: 100 } : null,
      error: null,
      message: "Update is ready to install."
    });
  });
  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnosticEvent({ type: "update_error", level: "error", message, stack: diagnosticStack(error) });
    publishUpdateState({
      checking: false,
      downloading: false,
      error: message,
      message: message.includes("Cannot find latest")
        ? "No update feed is configured for this build."
        : "Could not check for updates."
    });
  });

  if (!app.isPackaged && !allowDevChecks && !feedUrl) {
    return publishUpdateState({
      supported: true,
      canCheck: false,
      provider: "developer",
      channel: selectedChannel,
      message: "Updates run in installed builds. Set VINTRACE_UPDATE_URL to test a feed here."
    });
  }
  return publishUpdateState({
    supported: true,
    canCheck: true,
    provider: updateProviderLabel(),
    channel: selectedChannel,
    message: feedUrl
      ? "Update feed is configured."
      : "Update checker will use the packaged app feed."
  });
}

function setUpdateChannelFromUser(channel) {
  const selectedChannel = writeUpdateChannel(channel);
  applyUpdateChannelToUpdater(selectedChannel);
  appendDiagnosticEvent({ type: "update_channel_changed", level: "info", channel: selectedChannel });
  return publishUpdateState({
    channel: selectedChannel,
    checking: false,
    downloading: false,
    available: false,
    downloaded: false,
    latestVersion: null,
    progress: null,
    error: null,
    message: selectedChannel === "stable"
      ? "Stable updates selected."
      : `${selectedChannel[0].toUpperCase()}${selectedChannel.slice(1)} updates selected. Check again when ready.`
  });
}

async function checkForUpdatesFromUser() {
  configureAutoUpdater();
  if (!autoUpdater || !updateState.canCheck) {
    return publishUpdateState({
      error: null,
      message: updateState.message || "Updates are not available in this build."
    });
  }
  try {
    appendDiagnosticEvent({ type: "update_check_started", level: "info", provider: updateState.provider });
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnosticEvent({ type: "update_check_failed", level: "error", message, stack: diagnosticStack(error) });
    publishUpdateState({
      checking: false,
      downloading: false,
      error: message,
      message: message.includes("Cannot find latest")
        ? "No update feed is configured for this build."
        : "Could not check for updates."
    });
  }
  return updateState;
}

async function downloadUpdateFromUser() {
  configureAutoUpdater();
  if (!autoUpdater || !updateState.canCheck || !updateState.available) {
    return publishUpdateState({
      message: updateState.available ? updateState.message : "Check for an update first."
    });
  }
  try {
    appendDiagnosticEvent({ type: "update_download_started", level: "info", version: updateState.latestVersion || null });
    publishUpdateState({ downloading: true, error: null, message: "Downloading update." });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnosticEvent({ type: "update_download_failed", level: "error", message, stack: diagnosticStack(error) });
    publishUpdateState({ downloading: false, error: message, message: "Update download failed." });
  }
  return updateState;
}

function installDownloadedUpdate() {
  configureAutoUpdater();
  if (!autoUpdater || !updateState.downloaded) {
    return publishUpdateState({ message: "No downloaded update is ready to install." });
  }
  appendDiagnosticEvent({ type: "update_install_requested", level: "info", version: updateState.latestVersion || null });
  autoUpdater.quitAndInstall(false, true);
  return publishUpdateState({ message: "Restarting to install the update." });
}

function sendAppCommand(payload) {
  showMainWindow();
  sendToRenderer("app:command", payload);
}

function notify(title, body) {
  if (process.env.CROSSAGE_DISABLE_NOTIFICATIONS === "1" || process.env.CROSSAGE_TEST_CAMERA === "1") {
    return;
  }
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({ title: nativeUiText(title), body: nativeUiText(body), icon: appIconPath() }).show();
}

function notifyForCommand(command, result) {
  if (!result || typeof result !== "object") {
    return;
  }
  if (command === "scan" || command === "scan_paths") {
    const added = Number(result.added || 0);
    if (Number(result.metrics?.cancelled || 0)) {
      notify("Scan cancelled", `${Number(result.metrics?.processed || 0)} file(s) processed. Resume will skip completed files.`);
      return;
    }
    const protectedCount = Number(result.metrics?.safeFiltered || 0);
    const extra = protectedCount ? ` ${protectedCount} protected.` : "";
    notify("Scan complete", `${added} candidate(s) queued.${extra}`);
  }
  if (command === "enroll" || command === "enroll_age_groups") {
    notify("Enrollment complete", `${Number(result.added || 0)} reference face(s) enrolled.`);
  }
}

function findPythonExecutable() {
  if (process.env.CROSSAGE_PYTHON) {
    return process.env.CROSSAGE_PYTHON;
  }
  const root = appRoot();
  const backendName = process.platform === "win32" ? "crossage-backend.exe" : "crossage-backend";
  const packagedCandidates = [
    path.join(process.resourcesPath, "backend", "crossage-backend", backendName),
    path.join(process.resourcesPath, "backend", backendName)
  ];
  if (app.isPackaged) {
    const packagedBackend = packagedCandidates.find((candidate) => fs.existsSync(candidate));
    if (packagedBackend) {
      return packagedBackend;
    }
  }
  const venvPython = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function decorateState(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const decoratePath = (item, key, outKey) => {
    if (item[key]) {
      item[outKey] = mediaUrlFor(item[key]);
      return true;
    }
    return false;
  };
  const decorateCandidate = (item) => {
    const next = { ...item };
    grantQueryMediaPath(next.sourcePath);
    grantQueryMediaPath(next.mediaSourcePath);
    grantQueryMediaPath(next.previewPath);
    grantQueryMediaPath(next.bestRefPath);
    grantQueryMediaPath(next.bestRefPreviewPath);
    decoratePath(next, "sourcePath", "sourceUrl");
    decoratePath(next, "previewPath", "previewUrl");
    if (next.previewUrl) {
      next.sourceUrl = next.previewUrl;
    }
    decoratePath(next, "bestRefPath", "bestRefUrl");
    decoratePath(next, "bestRefPreviewPath", "bestRefPreviewUrl");
    if (next.bestRefPreviewUrl) {
      next.bestRefUrl = next.bestRefPreviewUrl;
    }
    return next;
  };
  const apply = (state) => {
    if (Array.isArray(state.references)) {
      state.references = state.references.map((item) => {
        const next = { ...item };
        decoratePath(next, "sourcePath", "sourceUrl");
        decoratePath(next, "mediaSourcePath", "mediaSourceUrl");
        decoratePath(next, "previewPath", "previewUrl");
        if (next.previewUrl) {
          next.sourceUrl = next.previewUrl;
        }
        return next;
      });
    }
    if (Array.isArray(state.candidates)) {
      state.candidates = state.candidates.map(decorateCandidate);
    }
    if (Array.isArray(state.videoMoments)) {
      state.videoMoments = state.videoMoments.map((item) => {
        const next = { ...item };
        decoratePath(next, "mediaSourcePath", "mediaSourceUrl");
        decoratePath(next, "previewPath", "previewUrl");
        return next;
      });
    }
  };
  if (value.state) {
    apply(value.state);
  } else if (value.counts && value.references && value.candidates) {
    apply(value);
  } else if (Array.isArray(value.items)) {
    value.items = value.items.map(decorateCandidate);
  }
  return value;
}

function redactLockedState(state) {
  if (!state || typeof state !== "object") {
    return state;
  }
  const zeroNumericObject = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, typeof child === "number" ? 0 : child])
    );
  };
  return {
    ...state,
    consentOnFile: false,
    consent: state.consent && typeof state.consent === "object" ? { ...state.consent, active: false, note: "" } : state.consent,
    references: [],
    candidates: [],
    videoMoments: [],
    duplicatePeople: [],
    scanHistory: [],
    reviewInsights: zeroNumericObject(state.reviewInsights),
    counts: zeroNumericObject(state.counts),
    scanTotals: zeroNumericObject(state.scanTotals)
  };
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isScannableMediaPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function registerProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

function rendererEntryUrl() {
  if (isDev) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).toString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function rendererFallbackPath() {
  return path.join(app.getPath("userData"), "renderer-fallback.html");
}

function rendererFallbackUrl(reason) {
  const filePath = rendererFallbackPath();
  const safeReason = escapeHtml(reason || nativeUiText("The app window could not load."));
  const fallbackTitle = escapeHtml(nativeUiText("Vintrace could not open the main window."));
  const fallbackBody = escapeHtml(nativeUiText("The app is still running. Restart it, or export diagnostics from the app menu if this repeats."));
  const fallbackDir = appLanguage === "ar" ? "rtl" : "ltr";
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `<!doctype html>
<html lang="${escapeHtml(appLanguage)}" dir="${fallbackDir}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vintrace</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111216; color: #f5f5f7; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
    main { width: min(560px, calc(100vw - 48px)); border: 1px solid rgba(255,255,255,.16); border-radius: 18px; padding: 28px; background: rgba(255,255,255,.06); box-shadow: 0 20px 80px rgba(0,0,0,.35); }
    h1 { margin: 0 0 10px; font-size: 24px; }
    p { margin: 0; color: rgba(245,245,247,.72); line-height: 1.45; }
    code { display: block; margin-top: 18px; padding: 12px; border-radius: 10px; background: rgba(0,0,0,.28); color: #ffd166; white-space: pre-wrap; }
  </style>
</head>
<body>
  <main>
    <h1>${fallbackTitle}</h1>
    <p>${fallbackBody}</p>
    <code>${safeReason}</code>
  </main>
</body>
</html>`,
    "utf8"
  );
  return pathToFileURL(filePath).toString();
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    if (isDev) {
      const dev = new URL(process.env.VITE_DEV_SERVER_URL);
      return url.origin === dev.origin;
    }
    if (url.protocol !== "file:") {
      return false;
    }
    const target = path.resolve(fileURLToPath(url));
    return (
      target === path.resolve(path.join(__dirname, "..", "dist", "index.html"))
      || target === path.resolve(rendererFallbackPath())
    );
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  if (!isTrustedRendererUrl(senderUrl)) {
    throw createAppError("E-SECURITY-IPC", "Untrusted renderer IPC sender.");
  }
}

function assertPlainObject(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createAppError("E-IPC-PAYLOAD", `${label} must be an object.`);
  }
}

function validateBackendPayload(payload = {}) {
  assertPlainObject(payload, "Backend payload");
  const command = String(payload.command || "");
  if (!TRUSTED_BACKEND_COMMANDS.has(command)) {
    throw createAppError("E-IPC-BLOCKED-COMMAND", `Blocked backend command: ${command || "empty"}.`);
  }
  const params = payload.params ?? {};
  assertPlainObject(params, "Command params");
  const serialized = JSON.stringify(params);
  if (serialized.length > 1_000_000) {
    throw createAppError("E-IPC-PARAMS-LARGE", "Command params are too large.");
  }
  return { command, params };
}

function grantPathsFromBackendRequest(command, params) {
  if (["set_workspace", "enroll", "scan", "analyze_folder", "export_report", "export_candidates", "preview_candidate_media_action", "manage_candidate_media"].includes(command)) {
    grantUserPath(params.path || params.folder);
  }
  if (command === "enroll_age_groups" && Array.isArray(params.groups)) {
    for (const group of params.groups) {
      if (group && typeof group === "object") {
        grantUserPath(group.folder);
      }
    }
  }
  if (command === "scan_paths" && Array.isArray(params.paths)) {
    for (const item of params.paths) {
      grantUserPath(item);
    }
  }
}

function configureSessionSecurity() {
  const contentSecurityPolicy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${MEDIA_PROTOCOL_SCHEME}: data: blob:`,
    `media-src 'self' ${MEDIA_PROTOCOL_SCHEME}: blob:`,
    "font-src 'self'",
    "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'"
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders["Content-Security-Policy"] = [contentSecurityPolicy];
    responseHeaders["X-Content-Type-Options"] = ["nosniff"];
    callback({ responseHeaders });
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id;
    callback(Boolean(trusted && (permission === "media" || permission === "camera")));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const trusted = mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id;
    return Boolean(trusted && (permission === "media" || permission === "camera"));
  });
  if (typeof session.defaultSession.setDevicePermissionHandler === "function") {
    session.defaultSession.setDevicePermissionHandler((details) => {
      const trusted = mainWindow && !mainWindow.isDestroyed();
      return Boolean(trusted && (details.deviceType === "media" || details.deviceType === "camera"));
    });
  }
}

function registerMediaProtocol() {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    const url = new URL(request.url);
    const target = decodeMediaPath(url.pathname.replace(/^\/+/, "") || url.hostname);
    if (!target || !fs.existsSync(target) || !isTrustedMediaPath(target)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function hardenWebContents(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function parseProtocolUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== `${PROTOCOL_SCHEME}:`) {
      return null;
    }
    const action = (url.hostname || url.pathname.replace(/^\/+/, "") || "open").toLowerCase();
    const target = url.searchParams.get("workspace") || url.searchParams.get("folder") || url.searchParams.get("path");
    if (!target) {
      return { type: "show" };
    }
    const resolved = path.resolve(target);
    if (action === "open" || action === "workspace") {
      return { type: "workspace", path: resolved, source: "protocol" };
    }
    if (action === "scan") {
      return { type: "scan-folder", path: resolved, source: "protocol" };
    }
    if (action === "watch") {
      return { type: "watch-folder", path: resolved, source: "protocol" };
    }
  } catch {
    return null;
  }
  return null;
}

function parseExternalPath(value) {
  if (!value || value.startsWith("-")) {
    return null;
  }
  const raw = value.startsWith("file://") ? fileURLToPath(value) : value;
  const resolved = path.resolve(raw);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return { type: "scan-folder", path: resolved, source: "open-path" };
    }
    if (stat.isFile() && isScannableMediaPath(resolved)) {
      return { type: "scan-files", paths: [resolved], source: "open-path" };
    }
  } catch {
    return null;
  }
  return null;
}

function parseExternalInput(value) {
  if (String(value).startsWith(`${PROTOCOL_SCHEME}://`)) {
    return parseProtocolUrl(String(value));
  }
  return parseExternalPath(String(value));
}

function handleExternalInputs(values) {
  const mediaFiles = [];
  for (const value of values) {
    const payload = parseExternalInput(value);
    if (!payload) {
      continue;
    }
    if (payload.type === "scan-files") {
      mediaFiles.push(...payload.paths);
      continue;
    }
    deliverExternalOpen(payload);
  }
  if (mediaFiles.length) {
    deliverExternalOpen({ type: "scan-files", paths: mediaFiles, source: "open-path" });
  }
}

function deliverExternalOpen(payload) {
  if (payload?.type === "show") {
    showMainWindow();
    return;
  }
  auditDesktopAction({
    action: "external_open",
    payloadType: payload?.type || "unknown",
    path: payload?.path || "",
    count: Array.isArray(payload?.paths) ? payload.paths.length : 0,
    sourceHint: payload?.source || ""
  });
  if (!app.isReady()) {
    pendingExternalOpens.push(payload);
    return;
  }
  if (!rendererReady) {
    pendingExternalOpens.push(payload);
    showMainWindow();
    return;
  }
  if (!sendToRenderer("app:external-open", payload)) {
    pendingExternalOpens.push(payload);
  }
  showMainWindow();
}

function flushExternalOpens() {
  while (pendingExternalOpens.length) {
    sendToRenderer("app:external-open", pendingExternalOpens.shift());
  }
}

function sendWatchEvent(payload) {
  sendToRenderer("folder-watch:event", payload);
  buildTrayMenu();
}

function currentFolderWatchStatus(message = "") {
  if (!folderWatch) {
    return { active: false, folder: null, queued: 0, scanning: false, message: message || "Not watching." };
  }
  return {
    active: true,
    folder: folderWatch.folder,
    queued: folderWatch.queue.size,
    scanning: folderWatch.scanning,
    mode: folderWatch.mode || "unknown",
    sweeping: Boolean(folderWatch.sweeping),
    message: message || (folderWatch.scanning ? "Watching and scanning." : "Watching for new media files.")
  };
}

function stopFolderWatch(reason = "Stopped", options = {}) {
  if (options.persist !== false) {
    persistFolderWatch(null);
  }
  if (!folderWatch) {
    return { active: false, folder: null, queued: 0, scanning: false, message: reason };
  }
  if (folderWatch.timer) {
    clearTimeout(folderWatch.timer);
  }
  if (folderWatch.sweepTimer) {
    clearTimeout(folderWatch.sweepTimer);
  }
  if (folderWatch.scanning) {
    try {
      const workspace = activeWorkspacePath();
      fs.mkdirSync(workspace, { recursive: true });
      fs.writeFileSync(path.join(workspace, ".scan-cancel"), new Date().toISOString(), "utf8");
      appendDiagnosticEvent({ type: "watch_scan_cancel_requested", level: "info", folder: folderWatch.folder });
    } catch (error) {
      appendDiagnosticEvent({ type: "watch_scan_cancel_failed", level: "warn", message: error instanceof Error ? error.message : String(error) });
    }
  }
  try {
    folderWatch.watcher.close();
  } catch {
    // Best effort: the watcher may already be closed by the OS.
  }
  const folder = folderWatch.folder;
  folderWatch = null;
  const status = { active: false, folder, queued: 0, scanning: false, message: reason };
  sendWatchEvent(status);
  return status;
}

async function waitForStableFile(filePath) {
  let lastSize = -1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile() && stat.size > 0 && stat.size === lastSize) {
        return true;
      }
      lastSize = stat.size;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 260));
  }
  return lastSize > 0;
}

function queueWatchFile(watch, filePath) {
  const resolved = path.resolve(filePath);
  const relative = path.relative(watch.folder, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !isScannableMediaPath(resolved)) {
    return false;
  }
  if (!watch.queue.has(resolved) && watch.queue.size >= WATCH_MAX_QUEUE) {
    watch.dropped += 1;
    if (watch.dropped === 1 || watch.dropped % 1000 === 0) {
      sendWatchEvent({
        active: true,
        folder: watch.folder,
        queued: watch.queue.size,
        scanning: watch.scanning,
        mode: watch.mode,
        sweeping: Boolean(watch.sweeping),
        message: `Folder watch queue is full; ${watch.dropped} new file event(s) deferred.`
      });
    }
    scheduleWatchSweep(watch, 2_000);
    return false;
  }
  watch.queue.add(resolved);
  return true;
}

function rememberSweepSignature(watch, filePath, signature) {
  watch.sweepSeen.set(filePath, signature);
  const maxSeen = Math.max(WATCH_SWEEP_QUEUE_LIMIT * 20, 10_000);
  while (watch.sweepSeen.size > maxSeen) {
    const oldest = watch.sweepSeen.keys().next().value;
    if (!oldest) {
      break;
    }
    watch.sweepSeen.delete(oldest);
  }
}

function scheduleWatchSweep(watch = folderWatch, delay = WATCH_SWEEP_INTERVAL_MS) {
  if (!watch || folderWatch !== watch) {
    return;
  }
  if (watch.sweepTimer) {
    clearTimeout(watch.sweepTimer);
  }
  watch.sweepTimer = setTimeout(() => runWatchSweep(watch), Math.max(500, delay));
}

async function runWatchSweep(watch) {
  if (!watch || folderWatch !== watch) {
    return;
  }
  if (watch.sweeping || watch.scanning) {
    scheduleWatchSweep(watch);
    return;
  }
  watch.sweepTimer = null;
  watch.sweeping = true;
  let queued = 0;
  let dirsChecked = 0;
  let filesChecked = 0;
  let errors = 0;
  try {
    if (!watch.sweepStack.length) {
      watch.sweepStack.push(watch.folder);
    }
    while (
      folderWatch === watch &&
      watch.sweepStack.length &&
      dirsChecked < WATCH_SWEEP_DIR_BUDGET &&
      filesChecked < WATCH_SWEEP_FILE_BUDGET &&
      queued < WATCH_SWEEP_QUEUE_LIMIT
    ) {
      const current = watch.sweepStack.pop();
      let entries;
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        errors += 1;
        continue;
      }
      dirsChecked += 1;
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          watch.sweepStack.push(entryPath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }
        filesChecked += 1;
        if (!isScannableMediaPath(entryPath)) {
          if (filesChecked >= WATCH_SWEEP_FILE_BUDGET) {
            break;
          }
          continue;
        }
        let stat;
        try {
          stat = await fs.promises.stat(entryPath);
        } catch {
          errors += 1;
          continue;
        }
        if (!stat.isFile() || stat.size <= 0 || stat.mtimeMs < watch.sweepSinceMs) {
          continue;
        }
        const signature = `${Math.round(stat.mtimeMs)}:${stat.size}`;
        if (watch.sweepSeen.get(entryPath) === signature) {
          continue;
        }
        rememberSweepSignature(watch, entryPath, signature);
        if (queueWatchFile(watch, entryPath)) {
          queued += 1;
        }
      }
    }
    if (!watch.sweepStack.length) {
      watch.sweepStack.push(watch.folder);
    }
    if (queued > 0) {
      sendWatchEvent({
        active: true,
        folder: watch.folder,
        queued: watch.queue.size,
        scanning: watch.scanning,
        mode: watch.mode,
        sweeping: true,
        message: `Catch-up found ${queued} recent media file(s).`
      });
      scheduleWatchFlush();
    } else if (errors > 0) {
      sendWatchEvent({
        active: true,
        folder: watch.folder,
        queued: watch.queue.size,
        scanning: watch.scanning,
        mode: watch.mode,
        sweeping: true,
        message: `Catch-up skipped ${errors} unavailable folder(s).`
      });
    }
  } finally {
    if (folderWatch === watch) {
      watch.sweeping = false;
      scheduleWatchSweep(watch);
    }
  }
}

function scheduleWatchFlush() {
  if (!folderWatch || folderWatch.scanning) {
    return;
  }
  if (folderWatch.timer) {
    clearTimeout(folderWatch.timer);
  }
  folderWatch.timer = setTimeout(() => flushWatchQueue(), 650);
  sendWatchEvent({
    active: true,
    folder: folderWatch.folder,
    queued: folderWatch.queue.size,
    scanning: false,
    message: "Queued new media files."
  });
}

async function flushWatchQueue() {
  if (!folderWatch || folderWatch.scanning) {
    return;
  }
  folderWatch.timer = null;
  const watch = folderWatch;
  const paths = Array.from(watch.queue);
  watch.queue.clear();
  if (!paths.length) {
    return;
  }
  watch.scanning = true;
  sendWatchEvent({ active: true, folder: watch.folder, queued: 0, scanning: true, message: `Scanning ${paths.length} new file(s).` });
  try {
    const stable = [];
    for (const filePath of paths) {
      if (await waitForStableFile(filePath)) {
        stable.push(filePath);
      }
    }
    if (!stable.length) {
      sendWatchEvent({ active: true, folder: watch.folder, queued: watch.queue.size, scanning: false, message: "No complete media files found." });
      return;
    }
    let result = null;
    let processed = 0;
    let protectedCount = 0;
    for (let index = 0; index < stable.length; index += WATCH_SCAN_BATCH_SIZE) {
      if (folderWatch !== watch) {
        break;
      }
      const chunk = stable.slice(index, index + WATCH_SCAN_BATCH_SIZE);
      result = await backend.invoke("scan_paths", { paths: chunk, source: "watch" });
      processed += chunk.length;
      protectedCount += Number(result.metrics?.safeFiltered || 0);
      if (processed < stable.length) {
        sendWatchEvent({
          active: true,
          folder: watch.folder,
          queued: watch.queue.size,
          scanning: true,
          message: `Processed ${processed} of ${stable.length} watched file(s).`
        });
      }
    }
    notify("Watched folder processed", `${processed} new file(s).${protectedCount ? ` ${protectedCount} protected.` : ""}`);
    sendWatchEvent({
      active: true,
      folder: watch.folder,
      queued: watch.queue.size,
      scanning: false,
      message: `Processed ${processed} new file(s).${watch.dropped ? ` ${watch.dropped} file event(s) were deferred while the queue was full.` : ""}`,
      result: result ? decorateState(result) : null
    });
    watch.dropped = 0;
  } catch (error) {
    sendWatchEvent({
      active: true,
      folder: watch.folder,
      queued: watch.queue.size,
      scanning: false,
      error: error.message || String(error),
      message: error.message || "Folder watch scan failed."
    });
  } finally {
    if (folderWatch === watch) {
      watch.scanning = false;
      if (watch.queue.size) {
        scheduleWatchFlush();
      }
    }
  }
}

function startFolderWatch(folder, options = {}) {
  if (!String(folder || "").trim()) {
    throw createAppError("E-FOLDER-WATCH-PATH", "Choose a folder to watch.");
  }
  const resolved = path.resolve(folder);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw createAppError("E-FS-NOT-FOUND", "Watched folder does not exist.");
  }
  if (!stat.isDirectory()) {
    throw createAppError("E-FS-NOT-DIRECTORY", "Choose a folder to watch.");
  }
  stopFolderWatch("Replacing watched folder");
  const watch = {
    folder: resolved,
    queue: new Set(),
    dropped: 0,
    timer: null,
    sweepTimer: null,
    sweeping: false,
    sweepStack: [resolved],
    sweepSeen: new Map(),
    sweepSinceMs: Date.now() - 5 * 60_000,
    mode: "unknown",
    scanning: false,
    watcher: null
  };
  const onChange = (_eventType, filename) => {
    if (!filename) {
      sendWatchEvent({
        active: true,
        folder: watch.folder,
        queued: watch.queue.size,
        scanning: watch.scanning,
        mode: watch.mode,
        sweeping: Boolean(watch.sweeping),
        message: "Drive reported a folder change; running catch-up."
      });
      scheduleWatchSweep(watch, 500);
      return;
    }
    const changedPath = path.resolve(resolved, filename.toString());
    if (queueWatchFile(watch, changedPath)) {
      scheduleWatchFlush();
    } else {
      scheduleWatchSweep(watch, 1_500);
    }
  };
  let watchMode = process.platform === "darwin" || process.platform === "win32" ? "recursive" : "top-level";
  try {
    watch.watcher = fs.watch(resolved, { recursive: watchMode === "recursive" }, onChange);
  } catch (error) {
    const detail = error && typeof error.message === "string" ? error.message : String(error);
    watchMode = "top-level";
    watch.watcher = fs.watch(resolved, onChange);
    sendWatchEvent({
      active: true,
      folder: resolved,
      queued: watch.queue.size,
      scanning: false,
      message: `Folder watch is using top-level mode because recursive watching is unavailable: ${detail}`
    });
  }
  watch.mode = watchMode;
  watch.watcher.on("error", (error) => {
    const detail = error && typeof error.message === "string" ? error.message : String(error);
    if (watch.sweepTimer) {
      clearTimeout(watch.sweepTimer);
    }
    sendWatchEvent({ active: false, folder: resolved, queued: watch.queue.size, scanning: false, mode: watch.mode, sweeping: false, error: detail, message: "Folder watch stopped." });
    if (folderWatch === watch) {
      folderWatch = null;
    }
  });
  folderWatch = watch;
  if (options.persist !== false) {
    persistFolderWatch(resolved);
  }
  scheduleWatchSweep(watch, WATCH_SWEEP_INTERVAL_MS);
  const status = { active: true, folder: resolved, queued: 0, scanning: false, mode: watchMode, sweeping: false, message: watchMode === "recursive" ? "Watching for new media files." : "Watching this folder. Catch-up is enabled for drives that miss nested changes." };
  sendWatchEvent(status);
  return status;
}

async function resumePersistedFolderWatch() {
  if (process.env.CROSSAGE_DISABLE_WATCH_RESUME === "1" || process.env.CROSSAGE_TEST_CAMERA === "1") {
    return;
  }
  const config = readJsonObject(watchConfigPath());
  const folder = typeof config.folder === "string" ? config.folder : "";
  if (!config.active || !folder) {
    return;
  }
  try {
    await backend.start();
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      startFolderWatch(folder, { persist: true });
      sendWatchEvent({ active: true, folder: path.resolve(folder), queued: 0, scanning: false, message: "Resumed watched folder." });
    }
  } catch (error) {
    const detail = error && typeof error.message === "string" ? error.message : String(error);
    sendWatchEvent({ active: false, folder, queued: 0, scanning: false, error: detail, message: "Saved folder watch could not resume." });
  }
}

function buildApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        }]
      : []),
    {
      label: nativeText("File"),
      submenu: [
        { label: nativeText("Open Workspace..."), accelerator: "CmdOrCtrl+O", click: () => sendAppCommand({ type: "open-workspace" }) },
        { label: nativeText("Reveal Workspace"), accelerator: "CmdOrCtrl+Shift+O", click: () => sendAppCommand({ type: "reveal-workspace" }) },
        ...(isMac ? [{ type: "separator" }, { role: "recentDocuments" }, { role: "clearRecentDocuments" }] : []),
        { type: "separator" },
        { label: nativeText("Refresh"), accelerator: "CmdOrCtrl+R", click: () => sendAppCommand({ type: "refresh" }) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: nativeText("Workflow"),
      submenu: [
        { label: nativeText("Dashboard"), accelerator: "CmdOrCtrl+1", click: () => sendAppCommand({ type: "navigate", tab: "dashboard" }) },
        { label: nativeText("Enroll"), accelerator: "CmdOrCtrl+2", click: () => sendAppCommand({ type: "navigate", tab: "enroll" }) },
        { label: nativeText("Scan"), accelerator: "CmdOrCtrl+3", click: () => sendAppCommand({ type: "navigate", tab: "scan" }) },
        { label: nativeText("Review"), accelerator: "CmdOrCtrl+4", click: () => sendAppCommand({ type: "navigate", tab: "review" }) },
        { label: nativeText("Settings"), accelerator: "CmdOrCtrl+5", click: () => sendAppCommand({ type: "navigate", tab: "settings" }) },
        { type: "separator" },
        { label: nativeText("Run Scan"), accelerator: "CmdOrCtrl+Enter", click: () => sendAppCommand({ type: "scan" }) },
        { label: nativeText("Start Folder Watch"), click: () => sendAppCommand({ type: "start-watch" }) },
        { label: nativeText("Stop Folder Watch"), click: () => sendAppCommand({ type: "stop-watch" }) }
      ]
    },
    {
      label: nativeText("View"),
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: nativeText("Window"),
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }])
      ]
    },
    {
      role: "help",
      label: nativeText("Help"),
      submenu: [
        { label: nativeText("Show Workbench"), click: showMainWindow },
        { label: nativeText("Open Workspace Folder"), click: () => sendAppCommand({ type: "open-workspace-folder" }) },
        {
          label: nativeText("Export Diagnostics..."),
          click: async () => {
            try {
              const result = await exportDiagnosticsReport({ includePaths: false });
              if (result.path) {
                shell.showItemInFolder(result.path);
              }
            } catch (error) {
              appendDiagnosticEvent({
                type: "diagnostics_export_failed",
                level: "error",
                message: error instanceof Error ? error.message : String(error),
                stack: diagnosticStack(error)
              });
              dialog.showErrorBox(nativeUiText("Diagnostics export failed"), error instanceof Error ? error.message : String(error));
            }
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTrayMenu() {
  if (!tray) {
    return;
  }
  tray.setToolTip(nativeText("Vintrace"));
  const watching = Boolean(folderWatch);
  const label = watching
    ? folderWatch.scanning
      ? nativeText("Watching: scanning")
      : nativeText("Watching")
    : nativeText("Not watching");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: nativeText("Show Vintrace"), click: showMainWindow },
    { type: "separator" },
    { label: nativeText("Dashboard"), click: () => sendAppCommand({ type: "navigate", tab: "dashboard" }) },
    { label: nativeText("Scan"), click: () => sendAppCommand({ type: "navigate", tab: "scan" }) },
    { type: "separator" },
    { label, enabled: false },
    watching
      ? { label: nativeText("Stop Folder Watch"), click: () => sendAppCommand({ type: "stop-watch" }) }
      : { label: nativeText("Start Folder Watch"), click: () => sendAppCommand({ type: "start-watch" }) },
    { label: nativeText("Reveal Workspace"), click: () => sendAppCommand({ type: "reveal-workspace" }) },
    { type: "separator" },
    { label: nativeText("Quit"), click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  if (tray || process.env.CROSSAGE_DISABLE_TRAY === "1") {
    return;
  }
  tray = new Tray(makeTrayImage());
  tray.setToolTip(nativeText("Vintrace"));
  tray.on("click", showMainWindow);
  buildTrayMenu();
}

class PythonBackend {
  constructor() {
    this.readyState = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
    this.stderrTail = "";
  }

  start() {
    if (this.readyPromise && this.child && !this.child.killed) {
      return this.readyPromise;
    }
    this.readyPromise = null;
    const root = appRoot();
    const executable = findPythonExecutable();
    const isFrozenBackend = path.basename(executable).startsWith("crossage-backend");
    this.stderrTail = "";
    const args = isFrozenBackend ? [] : ["-m", "crossage_fr.api_server"];
    const env = {
      ...process.env,
      PYTHONPATH: root,
      VINTRACE_WORKSPACE: process.env.VINTRACE_WORKSPACE || process.env.CROSSAGE_WORKSPACE || path.join(app.getPath("userData"), "workspace"),
      CROSSAGE_WORKSPACE: process.env.CROSSAGE_WORKSPACE || process.env.VINTRACE_WORKSPACE || path.join(app.getPath("userData"), "workspace")
    };
    this.child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const child = this.child;
    const lines = readline.createInterface({ input: child.stdout });
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyPromise = null;
        this.readyState = null;
        if (this.child === child && !child.killed) {
          child.kill();
        }
        const error = createAppError("E-BACKEND-START", "Python backend did not become ready in time.");
        reject(error);
      }, 180000);
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          return;
        }
        if (message.ready) {
          clearTimeout(timer);
          this.readyState = decorateState(message.state);
          resolve(this.readyState);
          return;
        }
        if (message.event === "startup") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:startup", message.payload || {});
          }
          return;
        }
        if (message.event === "progress") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:progress", {
              id: message.id,
              name: message.name,
              payload: decorateState(message.payload || {})
            });
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) {
          const result = decorateState(message.result);
          if (result?.state) {
            this.readyState = result.state;
          } else if (result?.counts && result?.references && result?.candidates) {
            this.readyState = result;
          }
          notifyForCommand(pending.command, result);
          pending.resolve(result);
        } else {
          const err = createAppError(codeFromBackendError(message.error) || "E-BACKEND-COMMAND", message.error?.message || "Backend command failed.");
          err.backend = message.error;
          err.category = codeMeta(err.code)?.category || "backend";
          err.severity = codeMeta(err.code)?.severity || "error";
          pending.reject(err);
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        this.readyPromise = null;
        if (this.child === child) {
          this.child = null;
        }
        appendDiagnosticEvent({
          type: "backend_process_error",
          level: "error",
          message: error.message,
          stack: diagnosticStack(error),
          stderrTail: this.stderrTail
        });
        reject(createAppError("E-BACKEND-START", error.message || "Python backend could not start.", { cause: error }));
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        const error = createAppError("E-BACKEND-EXIT", `Python backend exited with code ${code}.`, { exitCode: code });
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(error);
        }
        this.pending.clear();
        lines.close();
        this.readyPromise = null;
        this.readyState = null;
        if (this.child === child) {
          this.child = null;
        }
        appendDiagnosticEvent({
          type: "backend_exited",
          level: code === 0 ? "info" : "error",
          exitCode: code,
          stderrTail: this.stderrTail
        });
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        this.stderrTail = `${this.stderrTail}${text}`.slice(-MAX_BACKEND_STDERR_TAIL_BYTES);
        console.error(`[backend] ${text}`);
      });
    });
    return this.readyPromise;
  }

  async invoke(command, params = {}) {
    await this.start();
    if (!this.child || !this.child.stdin.writable) {
      throw createAppError("E-BACKEND-NOT-READY", "Python backend is not accepting commands.");
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, command, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) {
          return;
        }
        this.pending.delete(id);
        this.handleCommandTimeout(command);
        const error = createAppError("E-BACKEND-TIMEOUT", `Backend command timed out: ${command}.`);
        reject(error);
      }, BACKEND_COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, command, timer });
      this.child.stdin.write(payload, "utf8", (error) => {
        if (error) {
          const pending = this.pending.get(id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pending.delete(id);
          }
          reject(createAppError("E-BACKEND-PIPE", error?.message || "Python backend is not accepting commands.", { cause: error }));
        }
      });
    });
  }

  handleCommandTimeout(command) {
    appendDiagnosticEvent({
      type: "backend_command_timeout",
      level: "error",
      command,
      pending: this.pending.size,
      stderrTail: this.stderrTail
    });
    if (["scan", "scan_paths"].includes(String(command))) {
      try {
        const workspace = activeWorkspacePath();
        fs.mkdirSync(workspace, { recursive: true });
        fs.writeFileSync(path.join(workspace, ".scan-cancel"), new Date().toISOString(), "utf8");
      } catch {
        // Timeout recovery is best effort.
      }
    }
    const child = this.child;
    if (!child || child.killed) {
      return;
    }
    setTimeout(() => {
      if (this.child !== child || child.killed) {
        return;
      }
      appendDiagnosticEvent({ type: "backend_timeout_kill", level: "error", command });
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already be gone.
      }
      setTimeout(() => {
        if (this.child === child && !child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {
            // SIGKILL is not available on every platform.
          }
        }
      }, 1500);
    }, BACKEND_TIMEOUT_KILL_GRACE_MS);
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }
  if (creatingWindow) {
    return creatingWindow;
  }
  creatingWindow = (async () => {
    if (!backend) {
      backend = new PythonBackend();
    }
    const backendReady = backend.start();
    rendererReady = false;

    const window = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 1040,
      minHeight: 700,
      title: "Vintrace",
      show: false,
      backgroundColor: "#f5f6f8",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: { x: 18, y: 18 },
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        devTools: isDev || process.env.CROSSAGE_ENABLE_DEVTOOLS === "1"
      }
    });
    mainWindow = window;
    hardenWebContents(window);
    let fallbackLoaded = false;
    const revealTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isVisible()) {
        window.show();
      }
    }, 4000);
    async function loadRendererFallback(reason) {
      if (fallbackLoaded || window.isDestroyed()) {
        return;
      }
      fallbackLoaded = true;
      appendDiagnosticEvent({ type: "renderer_load_fallback", level: "error", message: reason });
      try {
        await window.loadURL(rendererFallbackUrl(reason));
      } catch (error) {
        appendDiagnosticEvent({
          type: "renderer_fallback_failed",
          level: "fatal",
          message: error instanceof Error ? error.message : String(error),
          stack: diagnosticStack(error)
        });
      }
      if (!window.isDestroyed() && !window.isVisible()) {
        window.show();
      }
    }
    window.webContents.on("did-start-loading", () => {
      rendererReady = false;
    });
    window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      rendererReady = false;
      if (isMainFrame === false || errorCode === -3 || fallbackLoaded) {
        return;
      }
      loadRendererFallback(`${errorDescription || "Renderer load failed"} (${errorCode}) ${validatedURL || ""}`).catch((error) => {
        appendDiagnosticEvent({ type: "renderer_fallback_rejected", level: "fatal", message: error instanceof Error ? error.message : String(error) });
      });
    });
    window.webContents.on("unresponsive", () => {
      appendDiagnosticEvent({ type: "renderer_unresponsive", level: "warn", url: window.webContents.getURL() });
    });
    window.webContents.on("responsive", () => {
      appendDiagnosticEvent({ type: "renderer_responsive", level: "info", url: window.webContents.getURL() });
    });
    window.webContents.on("render-process-gone", (_event, details = {}) => {
      rendererReady = false;
      appendDiagnosticEvent({
        type: "window_render_process_gone",
        level: "error",
        reason: details.reason || "unknown",
        exitCode: details.exitCode ?? null,
        url: window.webContents.getURL()
      });
    });
    window.once("ready-to-show", () => {
      clearTimeout(revealTimer);
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });
    window.on("closed", () => {
      clearTimeout(revealTimer);
      if (mainWindow === window) {
        mainWindow = null;
        rendererReady = false;
      }
    });

    try {
      await window.loadURL(rendererEntryUrl());
    } catch (error) {
      await loadRendererFallback(error instanceof Error ? error.message : String(error));
    }
    backendReady.catch((error) => {
      appendDiagnosticEvent({
        type: "backend_start_failed",
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        stack: diagnosticStack(error)
      });
      if (!window.isDestroyed()) {
        window.webContents.send("backend:error", error.message);
      }
    });
    return window;
  })();
  try {
    return await creatingWindow;
  } finally {
    creatingWindow = null;
  }
}

ipcMain.handle("backend:initial-state", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  initializeWorkspaceLockForActiveWorkspace();
  return isWorkspaceLocked() ? redactLockedState(backend.readyState) : backend.readyState;
});

ipcMain.handle("app:renderer-ready", async (event) => {
  assertTrustedSender(event);
  rendererReady = true;
  flushExternalOpens();
  sendWatchEvent(currentFolderWatchStatus());
  return true;
});

ipcMain.handle("app:set-language", async (event, payload = {}) => {
  assertTrustedSender(event);
  const nextLanguage = normalizeAppLanguage(payload.language);
  if (nextLanguage !== appLanguage) {
    appLanguage = nextLanguage;
    buildApplicationMenu();
    buildTrayMenu();
  }
  return true;
});

ipcMain.handle("backend:invoke", async (event, payload) => {
  assertTrustedSender(event);
  const request = validateBackendPayload(payload);
  if (isWorkspaceLocked()) {
    if (request.command === "get_state") {
      return redactLockedState(backend.readyState);
    }
    if (!["set_workspace", "model_status", "runtime_self_test"].includes(request.command)) {
      throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before making changes or reading private review data.");
    }
  }
  grantPathsFromBackendRequest(request.command, request.params);
  try {
    const result = await backend.invoke(request.command, request.params);
    if (request.command === "set_workspace") {
      stopFolderWatch("Workspace changed.");
      workspaceLockUnlocked = !pathAvailable(workspaceLockFilePath(result?.workspace));
      workspaceLockInitialized = true;
      if (result?.workspace) {
        app.addRecentDocument(result.workspace);
      }
      if (isWorkspaceLocked()) {
        return redactLockedState(result);
      }
    }
    return result;
  } catch (error) {
    const backendError = error && typeof error === "object" ? error.backend : null;
    const errorCode = (error && typeof error === "object" && error.code) || codeFromBackendError(backendError) || "E-BACKEND-COMMAND";
    appendDiagnosticEvent({
      type: "backend_command_failed",
      level: "error",
      code: errorCode,
      category: codeMeta(errorCode)?.category || "backend",
      severity: codeMeta(errorCode)?.severity || "error",
      command: request.command,
      message: error instanceof Error ? error.message : String(error),
      backendError,
      stack: diagnosticStack(error)
    });
    if (error && typeof error === "object" && error.code && /^\[[EW]-/.test(String(error.message || ""))) {
      throw error;
    }
    throw createAppError(errorCode, error instanceof Error ? error.message : String(error), { backend: backendError });
  }
});

ipcMain.handle("updater:get-status", async (event) => {
  assertTrustedSender(event);
  configureAutoUpdater();
  return updateState;
});

ipcMain.handle("updater:check", async (event) => {
  assertTrustedSender(event);
  return checkForUpdatesFromUser();
});

ipcMain.handle("updater:set-channel", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Update channel payload");
  configureAutoUpdater();
  return setUpdateChannelFromUser(payload.channel);
});

ipcMain.handle("updater:download", async (event) => {
  assertTrustedSender(event);
  return downloadUpdateFromUser();
});

ipcMain.handle("updater:install", async (event) => {
  assertTrustedSender(event);
  return installDownloadedUpdate();
});

ipcMain.handle("diagnostics:get-report", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Diagnostics payload");
  return createDiagnosticsReport({
    includePaths: Boolean(payload.includePaths),
    limit: Math.min(MAX_DIAGNOSTIC_EVENTS, Math.max(20, Number(payload.limit || MAX_DIAGNOSTIC_EVENTS)))
  });
});

ipcMain.handle("diagnostics:export-report", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Diagnostics export payload");
  return exportDiagnosticsReport({
    includePaths: Boolean(payload.includePaths)
  });
});

ipcMain.handle("diagnostics:record-event", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Diagnostics event");
  const serialized = JSON.stringify(payload);
  if (serialized.length > 50_000) {
    throw createAppError("E-DIAG-EVENT-LARGE", "Diagnostics event is too large.");
  }
  appendDiagnosticEvent({
    source: "renderer",
    type: String(payload.type || "renderer_runtime_error"),
    level: String(payload.level || payload.severity || "error"),
    code: String(payload.code || ""),
    category: String(payload.category || "renderer"),
    message: String(payload.message || ""),
    reason: String(payload.reason || ""),
    stack: String(payload.stack || "").slice(0, 12000),
    componentStack: String(payload.componentStack || "").slice(0, 12000),
    actionLabel: String(payload.actionLabel || ""),
    command: String(payload.command || ""),
    url: String(payload.url || ""),
    recoverable: payload.recoverable
  });
  return true;
});

ipcMain.handle("photos:get-sources", async (event) => {
  assertTrustedSender(event);
  return systemPhotoSources();
});

ipcMain.handle("workspace-lock:get-status", async (event) => {
  assertTrustedSender(event);
  initializeWorkspaceLockForActiveWorkspace();
  return getWorkspaceLockStatus();
});

ipcMain.handle("workspace-lock:enable", async (event) => {
  assertTrustedSender(event);
  return enableWorkspaceLock();
});

ipcMain.handle("workspace-lock:lock", async (event) => {
  assertTrustedSender(event);
  return lockWorkspaceNow();
});

ipcMain.handle("workspace-lock:unlock", async (event) => {
  assertTrustedSender(event);
  return unlockWorkspace();
});

ipcMain.handle("workspace-lock:disable", async (event) => {
  assertTrustedSender(event);
  return disableWorkspaceLock();
});

ipcMain.handle("system:get-integration", async (event) => {
  assertTrustedSender(event);
  return {
    platform: process.platform,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    protocolScheme: PROTOCOL_SCHEME,
    protocolRegistered: app.isDefaultProtocolClient(PROTOCOL_SCHEME),
    notificationsSupported: Notification.isSupported(),
    appUserModelId: APP_USER_MODEL_ID
  };
});

ipcMain.handle("system:set-launch-at-login", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Launch setting");
  const openAtLogin = Boolean(payload.openAtLogin);
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath
  });
  return {
    platform: process.platform,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    protocolScheme: PROTOCOL_SCHEME,
    protocolRegistered: app.isDefaultProtocolClient(PROTOCOL_SCHEME),
    notificationsSupported: Notification.isSupported(),
    appUserModelId: APP_USER_MODEL_ID
  };
});

ipcMain.handle("shell:reveal-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Reveal payload");
  const target = path.resolve(String(payload.path || ""));
  if (isTrustedShellPath(target) && fs.existsSync(target)) {
    shell.showItemInFolder(target);
    auditDesktopAction({ action: "shell_reveal", path: target });
    return true;
  }
  return false;
});

ipcMain.handle("shell:open-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target)) {
    return { ok: false, error: "Path does not exist." };
  }
  const error = await shell.openPath(target);
  if (!error) {
    auditDesktopAction({ action: "shell_open", path: target });
  }
  return { ok: !error, error };
});

ipcMain.handle("clipboard:write-text", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Clipboard payload");
  const text = String(payload.text || "");
  clipboard.writeText(text.slice(0, 200_000));
  return true;
});

ipcMain.handle("dialog:choose-folder", async (event) => {
  assertTrustedSender(event);
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || null;
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    if (selected) {
      grantUserPath(selected);
    }
    return selected;
  }
  if (process.env.CROSSAGE_TEST_DIALOG_PATH) {
    grantUserPath(process.env.CROSSAGE_TEST_DIALOG_PATH);
    return process.env.CROSSAGE_TEST_DIALOG_PATH;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  grantUserPath(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle("camera:save-frame", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Camera frame payload");
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const folder = path.join(workspace, "camera-captures", timestampSlug());
  const { buffer, extension } = decodeImageDataUrl(payload.dataUrl);
  const filePath = path.join(folder, `face-capture${extension}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  grantUserPath(folder);
  auditDesktopAction({ action: "camera_save_frame", path: filePath });
  return { folder, filePath };
});

ipcMain.handle("scan:cancel", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-cancel");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "scan_cancel_requested", path: marker });
  return { cancelled: true, path: marker };
});

ipcMain.handle("media-action:cancel", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".media-action-cancel");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "media_action_cancel_requested", path: marker });
  return { cancelled: true, path: marker };
});

ipcMain.handle("scan:pause", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-pause");
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "scan_pause_requested", path: marker });
  return { paused: true, path: marker };
});

ipcMain.handle("scan:resume", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-pause");
  try {
    fs.unlinkSync(marker);
  } catch {
    // Already resumed.
  }
  auditDesktopAction({ action: "scan_resume_requested", path: marker });
  return { paused: false, path: marker };
});

ipcMain.handle("scan:marker-status", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const cancelPath = path.join(workspace, ".scan-cancel");
  const pausePath = path.join(workspace, ".scan-pause");
  return {
    workspace,
    cancelRequested: fs.existsSync(cancelPath),
    paused: fs.existsSync(pausePath),
    cancelPath,
    pausePath
  };
});

ipcMain.handle("folder-watch:start", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Folder watch payload");
  await backend.start();
  return startFolderWatch(String(payload.folder || ""));
});

ipcMain.handle("folder-watch:stop", async (event) => {
  assertTrustedSender(event);
  return stopFolderWatch();
});

const allowMultiInstance = process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1";
const singleInstanceLock = allowMultiInstance || app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isTrustedRendererUrl(url)) {
        event.preventDefault();
      }
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
  });

  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    handleExternalInputs(argv);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const payload = parseProtocolUrl(url);
    if (payload) {
      deliverExternalOpen(payload);
    }
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    const payload = parseExternalPath(filePath);
    if (payload) {
      deliverExternalOpen(payload);
    }
  });

  app.whenReady().then(async () => {
    appLanguage = normalizeAppLanguage(app.getLocale());
    registerProtocolHandler();
    registerMediaProtocol();
    configureSessionSecurity();
    configureAutoUpdater();
    buildApplicationMenu();
    createTray();
    await createWindow();
    await resumePersistedFolderWatch();
    handleExternalInputs(process.argv.slice(1));
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.CROSSAGE_QUIT_ON_WINDOW_CLOSE === "1") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => console.error("[window] failed to activate", error));
  } else {
    showMainWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopFolderWatch("App quitting.", { persist: false });
  if (backend) {
    backend.stop();
  }
});

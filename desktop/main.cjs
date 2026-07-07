const { app, BrowserWindow, dialog, ipcMain, session, Menu, Tray, nativeImage, shell, Notification, clipboard, protocol, net, safeStorage, nativeTheme, ShareMenu, systemPreferences, powerMonitor } = require("electron");
const { spawn, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL, fileURLToPath } = require("url");
// EIPC-01: self-contained helpers extracted to a unit-testable module.
const {
  writeJsonAtomic,
  readJsonObject,
  encodeMediaPath,
  decodeMediaPath,
  timestampSlug,
  escapeHtml,
  isSubpath,
  safeRealpath,
  backendRestartDelayMs,
  canonicalPathKey,
  pathTrustKeyFromResolved,
  uniquePathBatch,
  buildTrustedMediaPathSet,
  filterStableWatchFiles,
} = require("./main/util.cjs");
const { buildSystemPhotoSources } = require("./main/photo-sources.cjs");
const { parseProtocolUrl } = require("./main/external-open.cjs");
const {
  buildMcpConnectionInfo,
  mcpStdioInvocation,
  upsertCodexConfig,
  DEFAULT_HTTP_HOST: MCP_HTTP_HOST,
  DEFAULT_HTTP_PORT: MCP_HTTP_PORT,
} = require("./main/mcp-connection.cjs");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Test isolation: when launched under the e2e harness (multi-instance flag set by
// every Playwright spec) with a per-test registry home, relocate Electron's
// userData — and therefore localStorage — into that unique temp dir. Without this
// the default "Electron"/"Vintrace" userData is shared across every test run, so
// localStorage (saved filters, onboarding flags, display toggles) leaks between
// tests and accumulates. Gated strictly to test mode; production never sets the
// multi-instance flag, so its userData location is unchanged. Must run before the
// app is ready / any app.getPath("userData") call.
if (process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1") {
  const testRegistryHome = (
    process.env.CROSSAGE_USER_DATA_DIR
    || process.env.VINTRACE_REGISTRY_HOME
    || process.env.CROSSAGE_REGISTRY_HOME
    || ""
  ).trim();
  if (testRegistryHome) {
    try {
      const isolatedUserData = process.env.CROSSAGE_USER_DATA_DIR
        ? testRegistryHome
        : path.join(testRegistryHome, "electron-user-data");
      fs.mkdirSync(isolatedUserData, { recursive: true });
      app.setPath("userData", isolatedUserData);
    } catch (error) {
      console.error("Failed to isolate test userData:", error && error.message ? error.message : error);
    }
  }
}

// Under the e2e harness, suppress native shell reveal/open so tests don't spawn
// real Finder/Explorer windows that pile up across runs. The IPC contract (return
// shape + audit) is preserved so assertions still pass. Production never sets the
// multi-instance flag, so real reveals/opens behave normally; an explicit
// CROSSAGE_ALLOW_SHELL_OPEN=1 re-enables them if a test ever needs the real thing.
const suppressNativeShellOpen = process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1"
  && process.env.CROSSAGE_ALLOW_SHELL_OPEN !== "1";

// Under the e2e harness, keep the app window hidden and never focus it so a test
// run doesn't steal focus or cover the developer's screen. Playwright drives the
// renderer over the DevTools protocol, so a hidden window stays fully
// interactive; background throttling is disabled so a hidden window still runs at
// full speed. Set CROSSAGE_SHOW_WINDOW=1 to show the window (visual QA / debug).
const hiddenTestWindow = process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1"
  && process.env.CROSSAGE_SHOW_WINDOW !== "1";
function revealItemInFolder(target) {
  if (suppressNativeShellOpen) return;
  shell.showItemInFolder(target);
}
async function openShellPath(target) {
  if (suppressNativeShellOpen) return "";
  return shell.openPath(target);
}

let mainWindow = null;
let backend = null;
let folderWatch = null;
let tray = null;
let isQuitting = false;
let rendererReady = false;
let creatingWindow = null;
const pendingExternalOpens = [];
const userGrantedPaths = new Set();
const userGrantedExternalEditorPaths = new Set();
const queryTrustedMediaPaths = new Set();
let queryTrustedMediaPathsVersion = 0;
let trustedMediaPathCache = null;
let pathTrustGeneration = 0;
const recentDiagnosticEvents = [];
let workspaceLockUnlocked = true;
let workspaceLockInitialized = false;
let photoIndexingHeadlessInitialTimer = null;
let photoIndexingHeadlessTimer = null;
let photoIndexingHeadlessRunning = false;
let photoIndexingHeadlessLastRuntimeSkipKey = "";
const MAX_DIAGNOSTIC_EVENTS = 240;
const MAX_DIAGNOSTIC_LOG_BYTES = 2 * 1024 * 1024;
const MAX_BACKEND_STDERR_TAIL_BYTES = 64 * 1024;
const QUERY_TRUSTED_MEDIA_PATH_LIMIT = 20000;
const USER_GRANTED_PATH_LIMIT = Math.max(1000, Math.min(50000, Number.parseInt(process.env.CROSSAGE_USER_GRANTED_PATH_LIMIT || "20000", 10) || 20000));
const MEDIA_PREPARE_PATH_LIMIT = Math.max(1, Math.min(5000, Number.parseInt(process.env.CROSSAGE_MEDIA_PREPARE_PATH_LIMIT || "1000", 10) || 1000));
const MEDIA_PREPARE_SIDECAR_LIMIT = Math.max(0, Math.min(MEDIA_PREPARE_PATH_LIMIT, Number.parseInt(process.env.CROSSAGE_MEDIA_PREPARE_SIDECAR_LIMIT || "64", 10) || 64));
const BACKEND_TIMEOUT_KILL_GRACE_MS = Math.max(1000, Number.parseInt(process.env.CROSSAGE_BACKEND_TIMEOUT_KILL_GRACE_MS || "5000", 10) || 5000);
const WATCH_MAX_QUEUE = Math.max(500, Number.parseInt(process.env.CROSSAGE_WATCH_MAX_QUEUE || "5000", 10) || 5000);
const WATCH_SCAN_BATCH_SIZE = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SCAN_BATCH_SIZE || "250", 10) || 250);
const WATCH_STABLE_CONCURRENCY = Math.max(1, Math.min(64, Number.parseInt(process.env.CROSSAGE_WATCH_STABLE_CONCURRENCY || "8", 10) || 8));
const WATCH_SWEEP_INTERVAL_MS = Math.max(10_000, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_INTERVAL_MS || "45000", 10) || 45_000);
const WATCH_SWEEP_DIR_BUDGET = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_DIR_BUDGET || "800", 10) || 800);
const WATCH_SWEEP_FILE_BUDGET = Math.max(200, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_FILE_BUDGET || "20000", 10) || 20_000);
const WATCH_SWEEP_QUEUE_LIMIT = Math.max(25, Number.parseInt(process.env.CROSSAGE_WATCH_SWEEP_QUEUE_LIMIT || "500", 10) || 500);
const PHOTO_INDEXING_HEADLESS_INITIAL_MS = Math.max(1_000, Number.parseInt(process.env.CROSSAGE_PHOTO_INDEXING_HEADLESS_INITIAL_MS || "60000", 10) || 60_000);
const PHOTO_INDEXING_HEADLESS_INTERVAL_MS = Math.max(1_000, Number.parseInt(process.env.CROSSAGE_PHOTO_INDEXING_HEADLESS_INTERVAL_MS || "60000", 10) || 60_000);
const PHOTO_INDEXING_HEADLESS_BATCH_SIZE = Math.max(1, Math.min(10, Number.parseInt(process.env.CROSSAGE_PHOTO_INDEXING_HEADLESS_BATCH_SIZE || "2", 10) || 2));
const PHOTO_INDEXING_IDLE_THRESHOLD_SECONDS = Math.max(30, Number.parseInt(process.env.CROSSAGE_PHOTO_INDEXING_IDLE_THRESHOLD_SECONDS || "180", 10) || 180);
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
// CP-03: the single global 1h timeout mis-scaled both fast reads (which queue
// behind a serial scan) and large scans. Instead of a per-wall-clock cap, use a
// progress-aware watchdog that only fails when the backend has produced NO
// output for this long (genuinely hung), bounded by the absolute cap above. A
// scan that keeps emitting progress events keeps every queued command alive.
const BACKEND_STALL_TIMEOUT_MS = Math.max(
  30_000,
  Number.parseInt(process.env.VINTRACE_BACKEND_STALL_TIMEOUT_MS || "120000", 10) || 120_000
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

async function systemPhotoSources() {
  const home = safeUserPath("home") || os.homedir();
  const pictures = safeUserPath("pictures") || path.join(home, "Pictures");
  return await buildSystemPhotoSources({
    platform: process.platform,
    home,
    pictures,
    env: process.env,
  });
}

function photosSensitiveAuthStatus() {
  if (process.platform !== "darwin") {
    return {
      supported: false,
      available: false,
      platform: process.platform,
      method: "none",
      reason: "Device authentication for Photos sensitive collections is currently available on macOS only."
    };
  }
  if (!systemPreferences || typeof systemPreferences.canPromptTouchID !== "function" || typeof systemPreferences.promptTouchID !== "function") {
    return {
      supported: false,
      available: false,
      platform: process.platform,
      method: "touch-id",
      reason: "This Electron runtime does not expose Touch ID prompts."
    };
  }
  let available = false;
  try {
    available = Boolean(systemPreferences.canPromptTouchID());
  } catch {
    available = false;
  }
  return {
    supported: true,
    available,
    platform: process.platform,
    method: "touch-id",
    reason: available ? "" : "Touch ID is not available, enrolled, or allowed for this app on this Mac."
  };
}

async function authenticatePhotosSensitiveCollection(reason) {
  const status = photosSensitiveAuthStatus();
  if (!status.available) {
    return {
      ok: false,
      ...status,
      canceled: false,
      error: status.reason || "Device authentication is not available."
    };
  }
  const promptReason = String(reason || "Unlock Hidden and Recently Deleted in Vintrace.").slice(0, 180);
  try {
    await systemPreferences.promptTouchID(promptReason);
    return {
      ok: true,
      ...status,
      canceled: false
    };
  } catch (error) {
    return {
      ok: false,
      ...status,
      canceled: true,
      error: error instanceof Error ? error.message : String(error || "Device authentication was cancelled.")
    };
  }
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
  // EIPC-02: drop media/shell path trust so a locked workspace can't keep
  // serving private images or revealing files the renderer already referenced.
  clearPathTrust();
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

const MAX_EXTERNAL_EDITOR_FAVORITES = 12;

function externalEditorFavoritesPath() {
  return path.join(app.getPath("userData"), "external-editors.json");
}

function externalEditorLabel(editorPath) {
  const name = path.basename(String(editorPath || ""));
  return process.platform === "darwin" && name.toLowerCase().endsWith(".app") ? name.slice(0, -4) : name;
}

function listExternalEditorFavorites() {
  const config = readJsonObject(externalEditorFavoritesPath());
  const rows = Array.isArray(config.editors) ? config.editors : [];
  const seen = new Set();
  const editors = [];
  for (const row of rows) {
    const editorPath = normalizeExternalEditorPath(row?.editorPath);
    if (!editorPath || !isTrustedExternalEditorPath(editorPath)) {
      continue;
    }
    const key = canonicalPathKey(editorPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    editors.push({
      editorPath,
      label: String(row?.label || externalEditorLabel(editorPath)).slice(0, 80),
      lastUsedAt: String(row?.lastUsedAt || ""),
      useCount: Math.max(1, Math.min(1_000_000, Number.parseInt(String(row?.useCount || "1"), 10) || 1))
    });
  }
  return editors
    .sort((left, right) => String(right.lastUsedAt || "").localeCompare(String(left.lastUsedAt || "")))
    .slice(0, MAX_EXTERNAL_EDITOR_FAVORITES);
}

function persistExternalEditorFavorite(editorPath) {
  const target = normalizeExternalEditorPath(editorPath);
  if (!target || !isTrustedExternalEditorPath(target)) {
    return listExternalEditorFavorites();
  }
  const key = canonicalPathKey(target);
  const now = new Date().toISOString();
  const rows = listExternalEditorFavorites().filter((item) => canonicalPathKey(item.editorPath) !== key);
  rows.unshift({
    editorPath: target,
    label: externalEditorLabel(target),
    lastUsedAt: now,
    useCount: Math.min(1_000_000, (listExternalEditorFavorites().find((item) => canonicalPathKey(item.editorPath) === key)?.useCount || 0) + 1)
  });
  const editors = rows.slice(0, MAX_EXTERNAL_EDITOR_FAVORITES);
  writeJsonAtomic(externalEditorFavoritesPath(), { version: 1, editors });
  grantExternalEditorPath(target);
  return editors;
}

function forgetExternalEditorFavorite(editorPath) {
  const target = normalizeExternalEditorPath(editorPath);
  const key = target ? canonicalPathKey(target) : "";
  const editors = listExternalEditorFavorites().filter((item) => canonicalPathKey(item.editorPath) !== key);
  writeJsonAtomic(externalEditorFavoritesPath(), { version: 1, editors });
  if (key) {
    userGrantedExternalEditorPaths.delete(key);
  }
  return editors;
}

function isSavedExternalEditorPath(editorPath) {
  const target = normalizeExternalEditorPath(editorPath);
  if (!target) {
    return false;
  }
  const key = canonicalPathKey(target);
  return listExternalEditorFavorites().some((item) => canonicalPathKey(item.editorPath) === key);
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

function mediaUrlFor(filePath) {
  return `${MEDIA_PROTOCOL_SCHEME}://local/${encodeMediaPath(filePath)}`;
}

function rememberUserPathKey(key) {
  if (!key) {
    return;
  }
  if (userGrantedPaths.has(key)) {
    userGrantedPaths.delete(key);
  }
  userGrantedPaths.add(key);
  while (userGrantedPaths.size > USER_GRANTED_PATH_LIMIT) {
    const oldest = userGrantedPaths.values().next().value;
    userGrantedPaths.delete(oldest);
  }
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

function grantUserPath(filePath) {
  if (typeof filePath === "string" && filePath.trim()) {
    // MS-5: store a case-folded canonical key on case-insensitive filesystems
    // so a differently-cased reference to the SAME granted file still matches.
    rememberUserPathKey(canonicalPathKey(filePath));
  }
}

async function grantUserPathAsync(filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    return;
  }
  const target = path.resolve(filePath);
  try {
    rememberUserPathKey(pathTrustKeyFromResolved(await fs.promises.realpath(target)));
  } catch {
    rememberUserPathKey(pathTrustKeyFromResolved(target));
  }
}

function grantExternalEditorPath(filePath) {
  if (typeof filePath === "string" && filePath.trim()) {
    userGrantedExternalEditorPaths.add(canonicalPathKey(path.resolve(filePath)));
  }
}

function invalidateTrustedMediaPathCache() {
  trustedMediaPathCache = null;
}

function grantQueryMediaPath(filePath, trustGeneration = pathTrustGeneration) {
  if (trustGeneration !== pathTrustGeneration) {
    return;
  }
  if (typeof filePath !== "string" || !filePath.trim()) {
    return;
  }
  const resolved = path.resolve(filePath);
  let changed = false;
  if (!queryTrustedMediaPaths.has(resolved)) {
    queryTrustedMediaPaths.add(resolved);
    changed = true;
  }
  while (queryTrustedMediaPaths.size > QUERY_TRUSTED_MEDIA_PATH_LIMIT) {
    const oldest = queryTrustedMediaPaths.values().next().value;
    queryTrustedMediaPaths.delete(oldest);
    changed = true;
  }
  if (changed) {
    queryTrustedMediaPathsVersion += 1;
    invalidateTrustedMediaPathCache();
  }
}

// EIPC-02: forget every previously-granted media/shell path. Called when the
// workspace is locked (so a locked workspace stops serving private files) and
// when switching workspaces (so prior-case access doesn't leak into the next).
// The new workspace's paths are re-granted as its state loads.
function clearPathTrust() {
  pathTrustGeneration += 1;
  userGrantedPaths.clear();
  userGrantedExternalEditorPaths.clear();
  if (queryTrustedMediaPaths.size) {
    queryTrustedMediaPaths.clear();
    queryTrustedMediaPathsVersion += 1;
  }
  invalidateTrustedMediaPathCache();
}

function isUserGrantedPath(filePath) {
  // MS-5: compare with the same case-folded canonical key used at grant time, so
  // path trust is correct on case-insensitive filesystems (macOS/Windows).
  const target = canonicalPathKey(filePath);
  for (const granted of userGrantedPaths) {
    if (isSubpath(granted, target) || target === granted) {
      return true;
    }
  }
  return false;
}

function currentTrustedPaths() {
  const state = backend?.readyState || null;
  if (
    trustedMediaPathCache &&
    trustedMediaPathCache.state === state &&
    trustedMediaPathCache.queryVersion === queryTrustedMediaPathsVersion
  ) {
    return trustedMediaPathCache;
  }
  const paths = buildTrustedMediaPathSet(state, queryTrustedMediaPaths);
  const previewsReal = state?.workspace ? safeRealpath(path.join(state.workspace, "previews")) : "";
  trustedMediaPathCache = { state, paths, previewsReal, queryVersion: queryTrustedMediaPathsVersion };
  return trustedMediaPathCache;
}

async function realpathOrEmpty(filePath) {
  try {
    return await fs.promises.realpath(path.resolve(String(filePath || "")));
  } catch {
    return "";
  }
}

async function pathExistsAsync(filePath) {
  try {
    await fs.promises.access(filePath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

// Resolve a media request to the canonical real path it is trusted to serve,
// or "" if it is not trusted. Resolving symlinks here (once) and having the
// caller fetch the RETURNED real path closes the symlink-TOCTOU: previously the
// trust check resolved symlinks but the fetch used the unresolved path, so a
// symlink swapped between check and fetch could serve a file outside the trust
// boundary. Callers must fetch the returned path, never the original.
async function resolveTrustedMediaPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  const targetReal = await realpathOrEmpty(target);
  if (!targetReal) {
    return "";
  }
  const { state, paths, previewsReal } = currentTrustedPaths();
  if (!state || !paths.size) {
    return "";
  }
  if (paths.has(target)) {
    return targetReal;
  }
  if (previewsReal && isSubpath(previewsReal, targetReal)) {
    return targetReal;
  }
  return "";
}

async function isTrustedMediaPath(filePath) {
  return Boolean(await resolveTrustedMediaPath(filePath));
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

function normalizeExternalEditorPath(filePath) {
  const rawPath = String(filePath || "").trim();
  return rawPath ? path.resolve(rawPath) : "";
}

function isTrustedExternalEditorPath(filePath) {
  const target = normalizeExternalEditorPath(filePath);
  if (!target) {
    return false;
  }
  try {
    const stat = fs.statSync(target);
    if (process.platform === "darwin" && stat.isDirectory() && target.toLowerCase().endsWith(".app")) {
      return true;
    }
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === "win32") {
      return /\.(?:exe|cmd|bat|com)$/i.test(target);
    }
    return Boolean(stat.mode & 0o111);
  } catch {
    return false;
  }
}

function isGrantedExternalEditorPath(filePath) {
  const target = normalizeExternalEditorPath(filePath);
  return Boolean(target && userGrantedExternalEditorPaths.has(canonicalPathKey(target)));
}

function launchExternalEditor(target, editorPath) {
  if (process.platform === "darwin" && editorPath.toLowerCase().endsWith(".app")) {
    return spawn("/usr/bin/open", ["-a", editorPath, target], { detached: true, stdio: "ignore" });
  }
  return spawn(editorPath, [target], { detached: true, stdio: "ignore" });
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
  if (hiddenTestWindow) {
    return;
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

// USC-02: a custom update feed can otherwise be redirected by any local actor
// who sets VINTRACE_UPDATE_URL, and (because releases are unsigned) electron-
// updater's only integrity check is the feed's own latest.yml hash. Require
// https:// and, in packaged builds, an operator-allowlisted host
// (VINTRACE_UPDATE_HOSTS) before honoring the override; reject anything else and
// fall back to the default GitHub provider.
function resolveUpdateFeedUrl() {
  const raw = String(process.env.VINTRACE_UPDATE_URL || process.env.CROSSAGE_UPDATE_URL || "").trim();
  if (!raw) {
    return "";
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    appendDiagnosticEvent({ type: "update_feed_rejected", level: "warn", reason: "invalid-url" });
    return "";
  }
  if (parsed.protocol !== "https:") {
    appendDiagnosticEvent({ type: "update_feed_rejected", level: "warn", reason: "non-https" });
    return "";
  }
  if (app.isPackaged) {
    const allowedHosts = String(process.env.VINTRACE_UPDATE_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (!allowedHosts.includes(parsed.host.toLowerCase())) {
      appendDiagnosticEvent({ type: "update_feed_rejected", level: "warn", reason: "host-not-allowlisted", host: parsed.host });
      return "";
    }
  }
  return raw;
}

function updateProviderLabel() {
  if (resolveUpdateFeedUrl()) {
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

  const feedUrl = resolveUpdateFeedUrl();
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

function photoShortcutFromNativeInput(input = {}) {
  if (!input || input.type !== "keyDown" || input.isAutoRepeat) return "";
  const key = String(input.key || "");
  const normalized = key.toLowerCase();
  const command = Boolean(input.meta || input.control);
  if (command && !input.alt && normalized === "a") return "selectPage";
  if (!command && !input.alt && !input.shift && (key === "Delete" || key === "Backspace")) return "delete";
  return "";
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
  if (command === "enroll" || command === "enroll_age_groups" || command === "enroll_paths") {
    notify("Enrollment complete", `${Number(result.added || 0)} reference face(s) enrolled.`);
  }
}

function findPythonExecutable() {
  const root = appRoot();
  const backendName = process.platform === "win32" ? "crossage-backend.exe" : "crossage-backend";
  const packagedCandidates = [
    path.join(process.resourcesPath, "backend", "crossage-backend", backendName),
    path.join(process.resourcesPath, "backend", backendName)
  ];
  if (app.isPackaged) {
    // USC-01/USC-05: in packaged builds, run ONLY the bundled frozen backend that
    // ships under resourcesPath. CROSSAGE_PYTHON and any system interpreter are
    // deliberately ignored, so a local attacker who sets that env var cannot make
    // the app launch an arbitrary executable, and the app never silently falls
    // back to an unpinned system Python. If the bundle is missing, return the
    // expected path so spawn fails with a clear, handled error.
    const packagedBackend = packagedCandidates.find((candidate) => fs.existsSync(candidate));
    return packagedBackend || packagedCandidates[0];
  }
  // Development only (unpackaged): honor an explicit interpreter override.
  if (process.env.VINTRACE_PYTHON || process.env.CROSSAGE_PYTHON) {
    return process.env.VINTRACE_PYTHON || process.env.CROSSAGE_PYTHON;
  }
  const venvPython = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function decorateState(value, options = {}) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const trustGeneration = Number.isInteger(options.trustGeneration) ? options.trustGeneration : pathTrustGeneration;
  const grantDecoratedMediaPath = (filePath) => {
    grantQueryMediaPath(filePath, trustGeneration);
  };
  const decoratePath = (item, key, outKey) => {
    if (item[key]) {
      item[outKey] = mediaUrlFor(item[key]);
      return true;
    }
    return false;
  };
  const decorateCandidate = (item) => {
    const next = { ...item };
    grantDecoratedMediaPath(next.sourcePath);
    grantDecoratedMediaPath(next.mediaSourcePath);
    grantDecoratedMediaPath(next.previewPath);
    grantDecoratedMediaPath(next.bestRefPath);
    grantDecoratedMediaPath(next.bestRefPreviewPath);
    if (next.assetMetadata && typeof next.assetMetadata === "object" && !Array.isArray(next.assetMetadata)) {
      const assetMetadata = { ...next.assetMetadata };
      if (assetMetadata.livePhoto && typeof assetMetadata.livePhoto === "object" && !Array.isArray(assetMetadata.livePhoto)) {
        const livePhoto = { ...assetMetadata.livePhoto };
        grantDecoratedMediaPath(livePhoto.pairedVideoPath);
        grantDecoratedMediaPath(livePhoto.keyPhotoPreviewPath);
        if (livePhoto.pairedVideoPath) {
          livePhoto.pairedVideoUrl = mediaUrlFor(livePhoto.pairedVideoPath);
        }
        if (livePhoto.keyPhotoPreviewPath) {
          livePhoto.keyPhotoPreviewUrl = mediaUrlFor(livePhoto.keyPhotoPreviewPath);
        }
        assetMetadata.livePhoto = livePhoto;
      }
      next.assetMetadata = assetMetadata;
    }
    if (Array.isArray(next.mediaPairs)) {
      next.mediaPairs = next.mediaPairs.map((pair) => {
        const mediaPair = pair && typeof pair === "object" && !Array.isArray(pair) ? { ...pair } : pair;
        if (mediaPair && typeof mediaPair === "object") {
          grantDecoratedMediaPath(mediaPair.relatedSourcePath);
        }
        return mediaPair;
      });
    }
    decoratePath(next, "sourcePath", "sourceUrl");
    decoratePath(next, "previewPath", "previewUrl");
    if (next.sourceUrl) {
      next.originalSourceUrl = next.sourceUrl;
    }
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
        if (next.sourceUrl) {
          next.originalSourceUrl = next.sourceUrl;
        }
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
  } else if (Array.isArray(value.folders)) {
    // Photos tab rail: grant + decorate each folder's cover thumbnail so it
    // resolves over vintrace-media:// like any other preview.
    value.folders = value.folders.map((folder) => {
      const next = { ...folder };
      grantDecoratedMediaPath(next.coverPreviewPath);
      decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
      return next;
    });
  } else if (Array.isArray(value.buckets)) {
    value.buckets = value.buckets.map((bucket) => {
      const next = { ...bucket };
      grantDecoratedMediaPath(next.coverPreviewPath);
      decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
      return next;
    });
  } else if (Array.isArray(value.groups)) {
    value.groups = value.groups.map((group) => ({
      ...group,
      items: Array.isArray(group.items)
        ? group.items.map((item) => {
          const next = { ...item };
          grantDecoratedMediaPath(next.previewPath);
          grantDecoratedMediaPath(next.coverPreviewPath);
          decoratePath(next, "previewPath", "previewUrl");
          decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
          return next;
        })
        : []
    }));
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
  if (["set_workspace", "enroll", "scan", "analyze_folder", "folder_tree", "export_report", "export_candidates", "preview_candidate_media_action", "manage_candidate_media"].includes(command)) {
    grantUserPath(params.path || params.folder);
  }
  if (command === "enroll_paths" && Array.isArray(params.paths)) {
    for (const candidate of params.paths) {
      grantUserPath(candidate);
    }
  }
  if (command === "restore_workspace_backup") {
    grantUserPath(params.path);
    grantUserPath(params.target || params.targetFolder);
  }
  if (["inspect_public_dataset", "run_public_dataset_benchmark", "compare_public_dataset_models"].includes(command)) {
    grantUserPath(params.folder);
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
    // EIPC-02: a locked workspace must not serve private media even for a URL
    // the renderer already holds.
    // Resolve + validate to a single canonical real path, then fetch THAT path
    // (not the original) so a symlink swapped between check and fetch can't
    // redirect us outside the trust boundary.
    const realTarget = target && !isWorkspaceLocked() ? await resolveTrustedMediaPath(target) : "";
    if (!realTarget || !(await pathExistsAsync(realTarget))) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(realTarget).toString());
  });
}

function hardenWebContents(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("before-input-event", (_event, input) => {
    const shortcut = photoShortcutFromNativeInput(input);
    if (shortcut) {
      sendAppCommand({ type: "photos-shortcut", shortcut });
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
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
    const stable = await filterStableWatchFiles(paths, waitForStableFile, WATCH_STABLE_CONCURRENCY);
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
      result: result || null
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
                revealItemInFolder(result.path);
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
    // CP-03: timestamp of the last byte received from the backend (stdout or
    // stderr). The command watchdog treats "recently produced output" as proof
    // the backend is alive, even while a long scan blocks the request loop.
    this.lastActivityAt = Date.now();
    // EIPC-05: consecutive failed/abnormal exits, for crash-loop backoff. Reset
    // to 0 once the backend reports ready.
    this.consecutiveFailures = 0;
    // Set while intentionally tearing the backend down (app quit), so a
    // deliberate kill is not counted as a crash toward the backoff.
    this.stopping = false;
  }

  start() {
    if (this.readyPromise) {
      return this.readyPromise;
    }
    // EIPC-05: defer the respawn by a capped-exponential backoff after repeated
    // crashes. backendRestartDelayMs(0) === 0, so the first start / healthy
    // restarts are unchanged; only a crash-loop is throttled.
    const backoffMs = backendRestartDelayMs(this.consecutiveFailures);
    if (backoffMs > 0) {
      this.readyPromise = new Promise((resolve) => setTimeout(resolve, backoffMs)).then(() => this._spawn());
      return this.readyPromise;
    }
    return this._spawn();
  }

  _spawn() {
    this.readyPromise = null;
    const root = appRoot();
    const executable = findPythonExecutable();
    const isFrozenBackend = path.basename(executable).startsWith("crossage-backend");
    const userModelRoot = path.join(app.getPath("userData"), "models");
    const safetyExplainDir = path.join(userModelRoot, "safety-explain");
    this.stderrTail = "";
    const args = isFrozenBackend ? [] : ["-m", "crossage_fr.api_server"];
    const env = {
      ...process.env,
      PYTHONPATH: root,
      VINTRACE_WORKSPACE: process.env.VINTRACE_WORKSPACE || process.env.CROSSAGE_WORKSPACE || path.join(app.getPath("userData"), "workspace"),
      CROSSAGE_WORKSPACE: process.env.CROSSAGE_WORKSPACE || process.env.VINTRACE_WORKSPACE || path.join(app.getPath("userData"), "workspace"),
      CROSSAGE_USER_MODEL_DIR: isFrozenBackend ? userModelRoot : (process.env.CROSSAGE_USER_MODEL_DIR || userModelRoot),
      CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR: isFrozenBackend ? safetyExplainDir : (process.env.CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR || safetyExplainDir),
      CROSSAGE_SAFETY_EXPLAIN_DIR: isFrozenBackend ? safetyExplainDir : (process.env.CROSSAGE_SAFETY_EXPLAIN_DIR || safetyExplainDir)
    };
    // MISS-01: scrub dynamic-loader injection variables before spawning the
    // backend so a local attacker who sets DYLD_*/LD_* can't load a malicious
    // library into the (hardened-runtime, camera-capable) backend process.
    for (const key of Object.keys(env)) {
      if (key.startsWith("DYLD_") || key.startsWith("LD_")) {
        delete env[key];
      }
    }
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
        this.lastActivityAt = Date.now();
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          return;
        }
        if (this.child !== child) {
          return;
        }
        if (message.ready) {
          clearTimeout(timer);
          this.readyState = decorateState(message.state);
          this.consecutiveFailures = 0; // EIPC-05: healthy start clears the backoff.
          resolve(this.readyState);
          return;
        }
        if (message.ready === false) {
          // ER-01: the backend reported a structured startup failure (e.g. the
          // workspace lives on a detached/read-only drive). Reject with the
          // actionable code/message instead of letting start() time out and
          // surface only a generic E-BACKEND-EXIT.
          clearTimeout(timer);
          this.readyPromise = null;
          this.readyState = null;
          const backendError = message.error || {};
          const startupError = createAppError(
            backendError.code || "E-BACKEND-START",
            backendError.message || "The local engine could not start."
          );
          startupError.backend = backendError;
          if (this.child === child && !child.killed) {
            child.kill();
          }
          reject(startupError);
          return;
        }
        if (message.event === "startup") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:startup", message.payload || {});
          }
          return;
        }
        if (message.event === "progress") {
          const progressPending = this.pending.get(message.id);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:progress", {
              id: message.id,
              name: message.name,
              payload: decorateState(message.payload || {}, {
                trustGeneration: progressPending ? progressPending.trustGeneration : -1
              })
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
          const result = decorateState(message.result, { trustGeneration: pending.trustGeneration });
          if (pending.trustGeneration === pathTrustGeneration) {
            if (result?.state) {
              this.readyState = result.state;
            } else if (result?.counts && result?.references && result?.candidates) {
              this.readyState = result;
            }
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
        const activeChild = this.child === child;
        if (activeChild) {
          clearTimeout(timer);
          this.readyPromise = null;
          this.child = null;
        }
        appendDiagnosticEvent({
          type: "backend_process_error",
          level: "error",
          message: error.message,
          stack: diagnosticStack(error),
          stderrTail: this.stderrTail,
          stale: !activeChild
        });
        if (activeChild) {
          reject(createAppError("E-BACKEND-START", error.message || "Python backend could not start.", { cause: error }));
        }
      });
      child.stdin.on("error", (error) => {
        const activeChild = this.child === child;
        const pipeError = createAppError("E-BACKEND-PIPE", error?.message || "Python backend is not accepting commands.", { cause: error });
        appendDiagnosticEvent({
          type: "backend_stdin_error",
          level: "error",
          message: pipeError.message,
          stack: diagnosticStack(error),
          stderrTail: this.stderrTail,
          stale: !activeChild
        });
        if (!activeChild) {
          return;
        }
        clearTimeout(timer);
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer);
          pending.reject(pipeError);
        }
        this.pending.clear();
        this.readyPromise = null;
        this.readyState = null;
        this.child = null;
        if (!child.killed) {
          child.kill();
        }
        reject(pipeError);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        const activeChild = this.child === child;
        // EIPC-05: count abnormal exits toward the crash-loop backoff, but only
        // for the CURRENT generation and only when this was not an intentional
        // shutdown — otherwise a stale child's late exit (or an app-quit kill)
        // pollutes the counter for a freshly spawned backend.
        if (code !== 0 && activeChild && !this.stopping) {
          this.consecutiveFailures += 1;
        }
        const error = createAppError("E-BACKEND-EXIT", `Python backend exited with code ${code}.`, { exitCode: code });
        if (activeChild) {
          for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
          }
          this.pending.clear();
          this.readyPromise = null;
          this.readyState = null;
          this.child = null;
          reject(error);
        }
        lines.close();
        appendDiagnosticEvent({
          type: "backend_exited",
          level: code === 0 ? "info" : "error",
          exitCode: code,
          stderrTail: this.stderrTail,
          stale: !activeChild
        });
      });
      child.stderr.on("data", (chunk) => {
        this.lastActivityAt = Date.now();
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
      const startedAt = Date.now();
      // CP-03: progress-aware watchdog. Only time out when the backend has been
      // silent for BACKEND_STALL_TIMEOUT_MS (truly hung) — not merely because a
      // fast read is queued behind a long, actively-progressing scan — while
      // still enforcing the absolute BACKEND_COMMAND_TIMEOUT_MS ceiling.
      const fireWatchdog = () => {
        if (!this.pending.has(id)) {
          return;
        }
        const now = Date.now();
        const silentFor = now - this.lastActivityAt;
        if (silentFor < BACKEND_STALL_TIMEOUT_MS && now - startedAt < BACKEND_COMMAND_TIMEOUT_MS) {
          const entry = this.pending.get(id);
          if (entry) {
            entry.timer = setTimeout(fireWatchdog, Math.max(1_000, BACKEND_STALL_TIMEOUT_MS - silentFor));
          }
          return;
        }
        this.pending.delete(id);
        this.handleCommandTimeout(command);
        const error = createAppError("E-BACKEND-TIMEOUT", `Backend command timed out: ${command}.`);
        reject(error);
      };
      const timer = setTimeout(fireWatchdog, BACKEND_STALL_TIMEOUT_MS);
      const trustGeneration = pathTrustGeneration;
      this.pending.set(id, { resolve, reject, command, timer, trustGeneration });
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
    this.stopping = true;
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function unwrapBackendValue(result) {
  return result && typeof result === "object" && result.value && typeof result.value === "object"
    ? result.value
    : result;
}

function normalizePhotoIndexingPowerMode(value) {
  const mode = String(value || "balanced").trim().toLowerCase();
  return mode === "low" || mode === "performance" || mode === "balanced" ? mode : "balanced";
}

function photoIndexingHeadlessPowerState() {
  const forcedBattery = String(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_BATTERY || "").trim();
  const forcedIdleState = String(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_IDLE_STATE || "").trim().toLowerCase();
  let onBattery = false;
  let idleState = "unknown";
  if (forcedBattery) {
    onBattery = envFlag("CROSSAGE_PHOTO_INDEXING_FORCE_BATTERY");
  } else if (powerMonitor && typeof powerMonitor.isOnBatteryPower === "function") {
    try {
      onBattery = Boolean(powerMonitor.isOnBatteryPower());
    } catch {
      onBattery = false;
    }
  }
  if (forcedIdleState === "active" || forcedIdleState === "idle" || forcedIdleState === "locked" || forcedIdleState === "unknown") {
    idleState = forcedIdleState;
  } else if (powerMonitor && typeof powerMonitor.getSystemIdleState === "function") {
    try {
      idleState = String(powerMonitor.getSystemIdleState(PHOTO_INDEXING_IDLE_THRESHOLD_SECONDS) || "unknown");
    } catch {
      idleState = "unknown";
    }
  }
  return { onBattery, idleState };
}

function photoIndexingHeadlessRuntimePolicy(localSettings) {
  const settings = localSettings && typeof localSettings === "object" ? localSettings : {};
  const powerMode = normalizePhotoIndexingPowerMode(settings.indexingPowerMode);
  const power = photoIndexingHeadlessPowerState();
  if (!settings.localIntelligenceEnabled) {
    return { allowed: false, reason: "local-intelligence-disabled", powerMode, ...power };
  }
  if (settings.backgroundIndexingAutoRun === false) {
    return { allowed: false, reason: "auto-run-off", powerMode, ...power };
  }
  if (settings.backgroundIndexingPaused) {
    return { allowed: false, reason: "paused", powerMode, ...power };
  }
  if (envFlag("CROSSAGE_PHOTO_INDEXING_IGNORE_RUNTIME_POLICY")) {
    return { allowed: true, reason: "runtime-policy-ignored", powerMode, ...power };
  }
  if (power.onBattery && powerMode !== "performance" && !envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_BATTERY")) {
    return { allowed: false, reason: "battery", powerMode, ...power };
  }
  if (powerMode === "low" && power.idleState !== "idle" && power.idleState !== "locked" && !envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_ACTIVE_LOW_POWER")) {
    return { allowed: false, reason: "active-low-power", powerMode, ...power };
  }
  return { allowed: true, reason: "allowed", powerMode, ...power };
}

function appendPhotoIndexingHeadlessRuntimeSkip(reason, policy) {
  const key = `${reason}:${policy.reason}:${policy.powerMode}:${policy.onBattery}:${policy.idleState}`;
  if (photoIndexingHeadlessLastRuntimeSkipKey === key) {
    return;
  }
  photoIndexingHeadlessLastRuntimeSkipKey = key;
  appendDiagnosticEvent({
    type: "photo_indexing_headless_runtime_skip",
    level: "info",
    reason,
    runtimeReason: policy.reason,
    powerMode: policy.powerMode,
    onBattery: Boolean(policy.onBattery),
    idleState: String(policy.idleState || "unknown")
  });
}

async function runPhotoIndexingHeadlessSchedulerTick(reason = "interval") {
  if (!backend || isQuitting || photoIndexingHeadlessRunning) {
    return;
  }
  initializeWorkspaceLockForActiveWorkspace();
  if (isWorkspaceLocked()) {
    return;
  }
  photoIndexingHeadlessRunning = true;
  try {
    const settingsResult = await backend.invoke("photo_library_settings", {});
    const settings = unwrapBackendValue(settingsResult);
    const localSettings = settings && typeof settings === "object" && settings.localSettings && typeof settings.localSettings === "object"
      ? settings.localSettings
      : {};
    const policy = photoIndexingHeadlessRuntimePolicy(localSettings);
    if (!policy.allowed) {
      appendPhotoIndexingHeadlessRuntimeSkip(reason, policy);
      return;
    }
    const result = await backend.invoke("run_photo_indexing_queue", {
      limit: 8,
      maxJobs: PHOTO_INDEXING_HEADLESS_BATCH_SIZE,
      automatic: true,
      headless: true
    });
    const value = unwrapBackendValue(result);
    const progress = value && typeof value === "object" && value.progress && typeof value.progress === "object"
      ? value.progress
      : {};
    const ran = Number(value?.ran || 0) || 0;
    const failed = Number(progress.failed || 0) || 0;
    if (ran > 0 || failed > 0) {
      appendDiagnosticEvent({
        type: "photo_indexing_headless_scheduler",
        level: failed > 0 ? "warn" : "info",
        reason,
        ran,
        stoppedReason: String(value?.stoppedReason || value?.message || ""),
        processed: Number(progress.processed || 0) || 0,
        updated: Number(progress.updated || 0) || 0,
        failed,
        deferred: Number(progress.deferred || 0) || 0,
        powerMode: policy.powerMode,
        onBattery: Boolean(policy.onBattery),
        idleState: String(policy.idleState || "unknown")
      });
    }
    photoIndexingHeadlessLastRuntimeSkipKey = "";
  } catch (error) {
    appendDiagnosticEvent({
      type: "photo_indexing_headless_scheduler_failed",
      level: "warn",
      reason,
      message: error instanceof Error ? error.message : String(error),
      stack: diagnosticStack(error)
    });
  } finally {
    photoIndexingHeadlessRunning = false;
  }
}

function startPhotoIndexingHeadlessScheduler() {
  if (process.env.CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS === "1") {
    return;
  }
  if (photoIndexingHeadlessInitialTimer || photoIndexingHeadlessTimer) {
    return;
  }
  if (!backend) {
    backend = new PythonBackend();
  }
  photoIndexingHeadlessInitialTimer = setTimeout(() => {
    photoIndexingHeadlessInitialTimer = null;
    void runPhotoIndexingHeadlessSchedulerTick("initial");
    if (!photoIndexingHeadlessTimer && !isQuitting) {
      photoIndexingHeadlessTimer = setInterval(() => {
        void runPhotoIndexingHeadlessSchedulerTick("interval");
      }, PHOTO_INDEXING_HEADLESS_INTERVAL_MS);
    }
  }, PHOTO_INDEXING_HEADLESS_INITIAL_MS);
}

function stopPhotoIndexingHeadlessScheduler() {
  if (photoIndexingHeadlessInitialTimer) {
    clearTimeout(photoIndexingHeadlessInitialTimer);
    photoIndexingHeadlessInitialTimer = null;
  }
  if (photoIndexingHeadlessTimer) {
    clearInterval(photoIndexingHeadlessTimer);
    photoIndexingHeadlessTimer = null;
  }
  photoIndexingHeadlessRunning = false;
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
      // M14: match the OS theme so dark-mode users don't see a light flash
      // before the renderer paints (#111216 is the dark :root background).
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#111216" : "#f5f6f8",
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
        // Keep a hidden test window running at full speed (no background throttle)
        // so headless e2e stays deterministic.
        backgroundThrottling: !hiddenTestWindow,
        devTools: isDev || process.env.CROSSAGE_ENABLE_DEVTOOLS === "1"
      }
    });
    if (hiddenTestWindow && process.platform === "darwin" && app.dock) {
      try { app.dock.hide(); } catch { /* dock hide is best-effort */ }
    }
    mainWindow = window;
    hardenWebContents(window);
    let fallbackLoaded = false;
    const revealTimer = setTimeout(() => {
      if (!hiddenTestWindow && !window.isDestroyed() && !window.isVisible()) {
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
      if (!hiddenTestWindow && !window.isDestroyed() && !window.isVisible()) {
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
      if (!window.isDestroyed() && !hiddenTestWindow) {
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
  if (request.command === "set_workspace") {
    // EIPC-02: forget the previous workspace's media/shell trust before the new
    // workspace's state is granted (decorateState re-grants inside invoke), so
    // prior-case access can't leak across a switch.
    clearPathTrust();
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
  return await systemPhotoSources();
});

ipcMain.handle("photos:sensitive-auth-status", async (event) => {
  assertTrustedSender(event);
  return photosSensitiveAuthStatus();
});

ipcMain.handle("photos:authenticate-sensitive", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Photos sensitive auth payload");
  return authenticatePhotosSensitiveCollection(payload.reason);
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

// ---------------------------------------------------------------------------
// AI Agents (MCP) — powers Settings > AI Agents. Generates auto-filled connect
// configs (from the app's own resolved paths), can add the server to Codex, can
// reveal/build the Claude Desktop bundle, and can run a managed localhost-only
// MCP HTTP server for agent-SDK/HTTP clients.
// ---------------------------------------------------------------------------
let mcpHttpChild = null;
let mcpHttpStatus = { running: false, url: "", host: MCP_HTTP_HOST, port: MCP_HTTP_PORT, token: "", error: "" };

function broadcastMcpHttpStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mcp:http-status", { ...mcpHttpStatus });
  }
}

function findShippedMcpBundle() {
  const candidates = [path.join(appRoot(), "dist"), process.resourcesPath ? path.join(process.resourcesPath, "mcp") : ""];
  for (const dir of candidates) {
    if (!dir) continue;
    try {
      if (!fs.existsSync(dir)) continue;
      const hit = fs.readdirSync(dir).find((name) => name.toLowerCase().endsWith(".mcpb"));
      if (hit) return path.join(dir, hit);
    } catch {
      // best effort
    }
  }
  return "";
}

function runNodeScript(scriptPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd: appRoot(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => { out = `${out}${chunk}`.slice(-8000); });
    child.stderr.on("data", (chunk) => { err = `${err}${chunk}`.slice(-8000); });
    child.on("error", (error) => resolve({ status: 1, stdout: out, stderr: error.message || String(error) }));
    child.on("exit", (code) => resolve({ status: code ?? 1, stdout: out, stderr: err }));
  });
}

function startMcpHttpServer() {
  if (mcpHttpChild && !mcpHttpChild.killed) {
    return { ...mcpHttpStatus };
  }
  const host = MCP_HTTP_HOST;
  const port = MCP_HTTP_PORT;
  const invocation = mcpStdioInvocation({
    executable: findPythonExecutable(),
    appRoot: appRoot(),
    workspace: activeWorkspacePath(),
    httpTransport: true,
    host,
    port,
  });
  // MCP-01: the streamable-HTTP transport fails closed unless an auth token is
  // present; clients must present it as a Bearer token. Generate a fresh
  // per-session token and surface it to the operator.
  const token = crypto.randomBytes(24).toString("hex");
  const env = { ...process.env, ...invocation.env, VINTRACE_MCP_TOKEN: token };
  // MISS-01 parity: never let a local attacker's dynamic-loader vars into the
  // (camera-capable) backend process.
  for (const key of Object.keys(env)) {
    if (key.startsWith("DYLD_") || key.startsWith("LD_")) {
      delete env[key];
    }
  }
  try {
    const child = spawn(invocation.command, invocation.args, { cwd: invocation.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    mcpHttpChild = child;
    mcpHttpStatus = { running: true, url: `http://${host}:${port}/mcp`, host, port, token, error: "" };
    let stderrTail = "";
    child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-4000); });
    child.on("error", (error) => {
      if (mcpHttpChild === child) mcpHttpChild = null;
      mcpHttpStatus = { running: false, url: "", host, port, token: "", error: error.message || "MCP HTTP server failed to start." };
      broadcastMcpHttpStatus();
    });
    child.on("exit", (code) => {
      if (mcpHttpChild === child) mcpHttpChild = null;
      const failed = Boolean(code && code !== 0);
      mcpHttpStatus = {
        running: false,
        url: "",
        host,
        port,
        token: "",
        error: failed ? (stderrTail.trim().slice(-400) || `MCP HTTP server exited with code ${code}.`) : "",
      };
      broadcastMcpHttpStatus();
    });
    broadcastMcpHttpStatus();
  } catch (error) {
    mcpHttpChild = null;
    mcpHttpStatus = { running: false, url: "", host, port, token: "", error: error.message || String(error) };
    broadcastMcpHttpStatus();
  }
  return { ...mcpHttpStatus };
}

function stopMcpHttpServer() {
  if (mcpHttpChild && !mcpHttpChild.killed) {
    try { mcpHttpChild.kill(); } catch { /* already gone */ }
  }
  mcpHttpChild = null;
  mcpHttpStatus = { running: false, url: "", host: MCP_HTTP_HOST, port: MCP_HTTP_PORT, token: "", error: "" };
  broadcastMcpHttpStatus();
  return { ...mcpHttpStatus };
}

function codexConfigPath() {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return { codexHome, configPath: path.join(codexHome, "config.toml") };
}

async function addMcpServerToCodex() {
  const { codexHome, configPath } = codexConfigPath();
  const existed = fs.existsSync(configPath);
  const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  const messageOptions = {
    type: "question",
    buttons: ["Add to Codex", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: "Add Vintrace to your Codex MCP configuration?",
    detail: existed
      ? `This updates ${configPath}. A timestamped backup of your current file is created first.`
      : `This creates ${configPath} with the Vintrace MCP server entry.`,
  };
  const confirm = parentWindow
    ? await dialog.showMessageBox(parentWindow, messageOptions)
    : await dialog.showMessageBox(messageOptions);
  if (confirm.response !== 0) {
    return { ok: false, cancelled: true };
  }
  const invocation = mcpStdioInvocation({ executable: findPythonExecutable(), appRoot: appRoot(), workspace: activeWorkspacePath() });
  fs.mkdirSync(codexHome, { recursive: true });
  let existing = "";
  let backupPath = "";
  if (existed) {
    existing = fs.readFileSync(configPath, "utf8");
    backupPath = path.join(codexHome, `config.toml.vintrace-backup-${timestampSlug()}`);
    fs.copyFileSync(configPath, backupPath);
  }
  fs.writeFileSync(configPath, upsertCodexConfig(existing, invocation), "utf8");
  return { ok: true, path: configPath, backupPath };
}

ipcMain.handle("mcp:connection-info", async (event) => {
  assertTrustedSender(event);
  const info = buildMcpConnectionInfo({
    executable: findPythonExecutable(),
    appRoot: appRoot(),
    workspace: activeWorkspacePath(),
    host: MCP_HTTP_HOST,
    port: MCP_HTTP_PORT,
  });
  return {
    ...info,
    packaged: app.isPackaged,
    http: { ...mcpHttpStatus },
    bundlePath: findShippedMcpBundle(),
    canBuildBundle: !app.isPackaged,
    codexConfigPath: codexConfigPath().configPath,
  };
});

ipcMain.handle("mcp:add-to-codex", async (event) => {
  assertTrustedSender(event);
  return addMcpServerToCodex();
});

ipcMain.handle("mcp:reveal-configs", async (event) => {
  assertTrustedSender(event);
  const dir = path.join(appRoot(), "mcp");
  const example = path.join(dir, "codex-config.example.toml");
  const target = fs.existsSync(example) ? example : dir;
  if (fs.existsSync(target)) {
    shell.showItemInFolder(target);
    return { ok: true, path: target };
  }
  return { ok: false, error: "The example MCP configs are only available in a source checkout." };
});

ipcMain.handle("mcp:reveal-or-build-bundle", async (event) => {
  assertTrustedSender(event);
  const existing = findShippedMcpBundle();
  if (existing) {
    shell.showItemInFolder(existing);
    return { ok: true, action: "revealed", path: existing };
  }
  if (app.isPackaged) {
    return { ok: false, action: "unavailable", message: "Build the Claude Desktop bundle from a source checkout with `npm run mcp:bundle`." };
  }
  const script = path.join(appRoot(), "desktop", "scripts", "build-mcp-bundle.cjs");
  if (!fs.existsSync(script)) {
    return { ok: false, action: "unavailable", message: "Bundle build script not found." };
  }
  const result = await runNodeScript(script);
  if (result.status !== 0) {
    return { ok: false, action: "build-failed", message: (result.stderr || result.stdout || "Bundle build failed.").trim().slice(-400) };
  }
  const built = findShippedMcpBundle();
  if (built) {
    shell.showItemInFolder(built);
  }
  return { ok: Boolean(built), action: "built", path: built };
});

ipcMain.handle("mcp:http-start", async (event) => {
  assertTrustedSender(event);
  return startMcpHttpServer();
});

ipcMain.handle("mcp:http-stop", async (event) => {
  assertTrustedSender(event);
  return stopMcpHttpServer();
});

ipcMain.handle("mcp:http-status", async (event) => {
  assertTrustedSender(event);
  return { ...mcpHttpStatus };
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
  // EIPC-02: don't reveal files while the workspace is locked.
  if (isTrustedShellPath(target) && fs.existsSync(target) && !isWorkspaceLocked()) {
    revealItemInFolder(target);
    auditDesktopAction({ action: "shell_reveal", path: target });
    return true;
  }
  return false;
});

ipcMain.handle("shell:open-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open payload");
  const target = path.resolve(String(payload.path || ""));
  // EIPC-02: don't open files while the workspace is locked.
  if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
    return { ok: false, error: "Path does not exist." };
  }
  const error = await openShellPath(target);
  if (!error) {
    auditDesktopAction({ action: "shell_open", path: target });
  }
  return { ok: !error, error };
});

ipcMain.handle("shell:open-path-with", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open with payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
    return { ok: false, supported: true, opened: false, path: target, error: "Path does not exist." };
  }
  try {
    if (!fs.statSync(target).isFile()) {
      return { ok: false, supported: true, opened: false, path: target, error: "Only files can be opened with an external editor." };
    }
  } catch {
    return { ok: false, supported: true, opened: false, path: target, error: "Path does not exist." };
  }
  let editorPath = normalizeExternalEditorPath(payload.editorPath);
  if (editorPath && (!isTrustedExternalEditorPath(editorPath) || (!isGrantedExternalEditorPath(editorPath) && !isSavedExternalEditorPath(editorPath)))) {
    return { ok: false, supported: true, opened: false, path: target, editorPath, error: "Choose an external editor from the system picker first." };
  }
  if (!editorPath) {
    const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
    const properties = process.platform === "darwin" ? ["openFile", "openDirectory"] : ["openFile"];
    const dialogOptions = {
      title: "Choose external editor",
      buttonLabel: "Open with",
      properties,
      filters: process.platform === "win32"
        ? [
            { name: "Applications", extensions: ["exe", "cmd", "bat", "com"] },
            { name: "All files", extensions: ["*"] }
          ]
        : [
            { name: "Applications", extensions: ["app"] },
            { name: "All files", extensions: ["*"] }
          ]
    };
    if (process.platform === "darwin") {
      dialogOptions.defaultPath = "/Applications";
    }
    const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, supported: true, opened: false, path: target, canceled: true, error: "No external editor selected." };
    }
    editorPath = normalizeExternalEditorPath(result.filePaths[0]);
    if (!isTrustedExternalEditorPath(editorPath)) {
      return { ok: false, supported: true, opened: false, path: target, editorPath, error: "Choose a macOS .app bundle or executable file." };
    }
    grantExternalEditorPath(editorPath);
  }
  grantExternalEditorPath(editorPath);
  try {
    const child = launchExternalEditor(target, editorPath);
    child.once("error", (error) => {
      appendDiagnosticEvent({
        type: "external_editor_open_failed",
        level: "warn",
        path: target,
        editorPath,
        message: error instanceof Error ? error.message : String(error || "External editor failed.")
      });
    });
    child.unref();
    const editors = persistExternalEditorFavorite(editorPath);
    auditDesktopAction({ action: "shell_open_with", path: target, editorPath });
    return { ok: true, supported: true, opened: true, path: target, editorPath, editors };
  } catch (error) {
    return { ok: false, supported: true, opened: false, path: target, editorPath, error: error instanceof Error ? error.message : String(error || "External editor could not be opened.") };
  }
});

ipcMain.handle("shell:list-external-editors", async (event) => {
  assertTrustedSender(event);
  return { ok: true, editors: listExternalEditorFavorites() };
});

ipcMain.handle("shell:forget-external-editor", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "External editor payload");
  return { ok: true, editors: forgetExternalEditorFavorite(payload.editorPath) };
});

ipcMain.handle("shell:share-paths", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Share payload");
  const rawPaths = Array.isArray(payload.paths) ? payload.paths : [payload.path];
  const targets = [];
  const seen = new Set();
  for (const rawPath of rawPaths.slice(0, 50)) {
    const target = path.resolve(String(rawPath || ""));
    if (!target || seen.has(target)) {
      continue;
    }
    seen.add(target);
    if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
      continue;
    }
    try {
      if (!fs.statSync(target).isFile()) {
        continue;
      }
    } catch {
      continue;
    }
    targets.push(target);
  }
  if (!targets.length) {
    return { ok: false, supported: process.platform === "darwin", shared: false, count: 0, filePaths: [], error: "No shareable files are available." };
  }
  if (process.platform !== "darwin" || typeof ShareMenu !== "function") {
    const fallbackPath = targets[0];
    try {
      revealItemInFolder(fallbackPath);
      auditDesktopAction({ action: "shell_share_fallback_reveal", path: fallbackPath, count: targets.length, platform: process.platform });
      return {
        ok: true,
        supported: false,
        shared: false,
        fallback: "reveal",
        fallbackPath,
        fallbackDirectory: path.dirname(fallbackPath),
        count: targets.length,
        filePaths: targets,
        error: "Native share is not available on this platform, so the containing folder was opened instead."
      };
    } catch (error) {
      return {
        ok: false,
        supported: false,
        shared: false,
        fallback: "reveal",
        fallbackPath,
        fallbackDirectory: path.dirname(fallbackPath),
        count: targets.length,
        filePaths: targets,
        error: error instanceof Error ? error.message : "Native share is not available on this platform and the fallback folder could not be opened."
      };
    }
  }
  const window = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
  const menu = new ShareMenu({ filePaths: targets });
  menu.popup({ window: window || undefined });
  auditDesktopAction({ action: "shell_share", path: targets[0], count: targets.length });
  return { ok: true, supported: true, shared: true, count: targets.length, filePaths: targets };
});

ipcMain.handle("shell:print-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Print payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
    return { ok: false, supported: true, printed: false, path: target, error: "Path does not exist." };
  }
  try {
    if (!fs.statSync(target).isFile()) {
      return { ok: false, supported: true, printed: false, path: target, error: "Only files can be printed." };
    }
  } catch {
    return { ok: false, supported: true, printed: false, path: target, error: "Path does not exist." };
  }
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow || BrowserWindow.getFocusedWindow();
  const printWindow = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    parent: parent || undefined,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try {
    await printWindow.loadURL(pathToFileURL(target).toString());
    const printed = await new Promise((resolve) => {
      printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        resolve({ success, failureReason });
      });
    });
    if (printed.success) {
      auditDesktopAction({ action: "shell_print", path: target });
      return { ok: true, supported: true, printed: true, path: target };
    }
    return {
      ok: false,
      supported: true,
      printed: false,
      path: target,
      error: printed.failureReason || "Print was cancelled or could not start."
    };
  } catch (error) {
    return { ok: false, supported: true, printed: false, path: target, error: error instanceof Error ? error.message : String(error || "Print failed.") };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
});

ipcMain.handle("clipboard:write-text", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Clipboard payload");
  const text = String(payload.text || "");
  clipboard.writeText(text.slice(0, 200_000));
  return true;
});

ipcMain.handle("clipboard:write-image-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Clipboard image payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
    return { ok: false, path: target, error: "Path does not exist." };
  }
  try {
    if (!fs.statSync(target).isFile()) {
      return { ok: false, path: target, error: "Only image files can be copied." };
    }
  } catch {
    return { ok: false, path: target, error: "Path does not exist." };
  }
  const image = nativeImage.createFromPath(target);
  if (!image || image.isEmpty()) {
    return { ok: false, path: target, error: "Image could not be loaded." };
  }
  clipboard.writeImage(image);
  auditDesktopAction({ action: "clipboard_image", path: target });
  return { ok: true, path: target };
});

ipcMain.handle("shell:start-drag-file", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Drag payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target) || isWorkspaceLocked()) {
    return { ok: false, path: target, error: "Path does not exist." };
  }
  try {
    if (!fs.statSync(target).isFile()) {
      return { ok: false, path: target, error: "Only files can be dragged." };
    }
  } catch {
    return { ok: false, path: target, error: "Path does not exist." };
  }
  const image = nativeImage.createFromPath(target);
  if (!image || image.isEmpty()) {
    return { ok: false, path: target, error: "Drag icon could not be loaded." };
  }
  event.sender.startDrag({ file: target, icon: image });
  auditDesktopAction({ action: "shell_start_drag", path: target });
  return { ok: true, path: target };
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

// Multi-select image picker for the "Add a person" flow. Grants each picked file
// and returns its vintrace-media:// thumbnail URL so the renderer can preview it
// before enrolling.
ipcMain.handle("dialog:choose-images", async (event) => {
  assertTrustedSender(event);
  const toMedia = (filePath) => {
    grantUserPath(filePath);
    return { path: filePath, url: mediaUrlFor(filePath), isDir: false };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    process.env.CROSSAGE_TEST_DIALOG_PATHS = "";
    return paths.map(toMedia);
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: [...IMAGE_EXTENSIONS].map((ext) => ext.replace(/^\./, "")) },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return [];
  }
  return result.filePaths.map(toMedia);
});

ipcMain.handle("dialog:choose-audio", async (event) => {
  assertTrustedSender(event);
  const toMedia = (filePath) => {
    grantUserPath(filePath);
    return { path: filePath, url: mediaUrlFor(filePath), isDir: false };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return selected ? toMedia(selected) : null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Audio", extensions: ["aac", "aif", "aiff", "caf", "flac", "m4a", "mp3", "ogg", "opus", "wav"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return toMedia(result.filePaths[0]);
});

ipcMain.handle("dialog:choose-json", async (event) => {
  assertTrustedSender(event);
  const toFile = (filePath) => {
    grantUserPath(filePath);
    return { path: filePath, isDir: false };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return selected ? toFile(selected) : null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return toFile(result.filePaths[0]);
});

ipcMain.handle("dialog:choose-model", async (event) => {
  assertTrustedSender(event);
  const toFile = (filePath) => {
    grantUserPath(filePath);
    return { path: filePath, isDir: false };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return selected ? toFile(selected) : null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "ONNX model", extensions: ["onnx"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return toFile(result.filePaths[0]);
});

ipcMain.handle("dialog:choose-color-profile", async (event) => {
  assertTrustedSender(event);
  const toFile = (filePath) => {
    grantUserPath(filePath);
    return { path: filePath, isDir: false };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return selected ? toFile(selected) : null;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "ICC profiles", extensions: ["icc", "icm"] },
      { name: "All files", extensions: ["*"] }
    ]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  return toFile(result.filePaths[0]);
});

const PHOTO_MEDIA_SOURCE_LABELS = Object.freeze({
  folder: "Imported files",
  camera: "Camera/device import",
  library: "Photo library",
  mail: "Mail",
  safari: "Safari",
  messages: "Messages",
  airdrop: "AirDrop",
  downloads: "Downloads",
  app: "Other app"
});

function mediaSourcePathParts(filePath) {
  return String(filePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function titleCaseMediaSourcePart(value) {
  const clean = String(value || "").replace(/[-_]+/g, " ").trim();
  if (!clean) return "";
  if (/^[A-Z0-9\s.]+$/.test(clean)) return clean;
  return clean.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function mediaSourceTailFromMarker(parts, marker, label, afterCount = 1) {
  const lowerParts = parts.map((part) => part.toLowerCase());
  const index = lowerParts.findIndex(marker);
  if (index < 0) return label;
  const tail = parts.slice(index, index + afterCount + 1).map(titleCaseMediaSourcePart).filter(Boolean);
  return tail.length ? tail.join(" / ") : label;
}

function cleanMediaSourceDetail(value, maxLength = 240) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLength ? `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...` : cleaned;
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function sidecarCandidatePaths(filePath, isDir = false) {
  const target = String(filePath || "");
  if (!target) return [];
  const dir = isDir ? target : path.dirname(target);
  const parsed = path.parse(target);
  const candidates = [
    `${target}.context.json`,
    `${target}.json`,
    `${target}.eml`,
    `${target}.webloc`,
    `${target}.url`,
    `${target}.txt`,
  ];
  if (!isDir) {
    candidates.push(
      path.join(dir, `${parsed.name}.context.json`),
      path.join(dir, `${parsed.name}.json`),
      path.join(dir, `${parsed.name}.eml`),
      path.join(dir, `${parsed.name}.webloc`),
      path.join(dir, `${parsed.name}.url`),
      path.join(dir, `${parsed.name}.txt`),
      path.join(dir, "message.eml"),
      path.join(dir, "message.txt"),
      path.join(dir, "source.webloc"),
      path.join(dir, "source.url"),
      path.join(dir, "source.json"),
    );
  } else {
    candidates.push(
      path.join(dir, "source.context.json"),
      path.join(dir, "source.json"),
      path.join(dir, "message.eml"),
      path.join(dir, "message.txt"),
      path.join(dir, "source.webloc"),
      path.join(dir, "source.url"),
    );
  }
  return [...new Set(candidates)];
}

function readSmallTextFile(filePath, maxBytes = 64 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function firstHeaderValue(text, names) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  for (const name of names) {
    const pattern = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*(.+)$`, "i");
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(pattern);
      if (!match) continue;
      const pieces = [match[1]];
      let cursor = index + 1;
      while (cursor < lines.length && /^[ \t]+/.test(lines[cursor])) {
        pieces.push(lines[cursor].trim());
        cursor += 1;
      }
      return cleanMediaSourceDetail(pieces.join(" "), 120);
    }
  }
  return "";
}

function detailFromParts(parts) {
  return cleanMediaSourceDetail(parts.filter(Boolean).join(" · "));
}

function attributionFromMailText(text) {
  const sender = firstHeaderValue(text, ["From", "Sender"]);
  const subject = firstHeaderValue(text, ["Subject"]);
  const messageId = firstHeaderValue(text, ["Message-ID", "Message-Id"]);
  const detail = detailFromParts([
    sender ? `Sender: ${sender}` : "",
    subject ? `Subject: ${subject}` : "",
    messageId ? `Message: ${messageId}` : "",
  ]);
  return detail ? { sourceKind: "mail", sourceLabel: PHOTO_MEDIA_SOURCE_LABELS.mail, sourceDetail: detail } : {};
}

function attributionFromWebText(text) {
  const urlMatch = String(text || "").match(/(?:^|\n)\s*(?:URL|Source URL)\s*=\s*(.+)\s*$/im)
    || String(text || "").match(/<key>\s*URL\s*<\/key>\s*<string>([^<]+)<\/string>/i)
    || String(text || "").match(/\bhttps?:\/\/[^\s<>"']+/i);
  const titleMatch = String(text || "").match(/<key>\s*(?:Name|Title)\s*<\/key>\s*<string>([^<]+)<\/string>/i)
    || String(text || "").match(/(?:^|\n)\s*(?:Title|Page Title)\s*[:=]\s*(.+)\s*$/im);
  const url = cleanMediaSourceDetail(decodeXmlEntities(urlMatch?.[1] || urlMatch?.[0] || ""), 160);
  const title = cleanMediaSourceDetail(decodeXmlEntities(titleMatch?.[1] || ""), 120);
  const detail = detailFromParts([
    title ? `Page: ${title}` : "",
    url ? `Source URL: ${url}` : "",
  ]);
  return detail ? { sourceKind: "safari", sourceLabel: PHOTO_MEDIA_SOURCE_LABELS.safari, sourceDetail: detail } : {};
}

function attributionFromContextJson(text) {
  let data = null;
  try {
    data = JSON.parse(String(text || ""));
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const pick = (...keys) => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === "string" && value.trim()) return cleanMediaSourceDetail(value, 160);
    }
    return "";
  };
  const appText = `${pick("app", "application", "sourceApp", "source")} ${pick("kind", "sourceKind")}`.toLowerCase();
  const sourceKind = appText.includes("mail")
    ? "mail"
    : appText.includes("safari") || appText.includes("browser") || pick("url", "sourceUrl", "pageUrl")
      ? "safari"
      : appText.includes("message") || appText.includes("imessage") || pick("conversation", "chat", "thread")
        ? "messages"
        : "";
  if (!sourceKind) return {};
  const detail = detailFromParts([
    pick("sender", "from", "author") ? `Sender: ${pick("sender", "from", "author")}` : "",
    pick("subject") ? `Subject: ${pick("subject")}` : "",
    pick("title", "pageTitle") ? `Page: ${pick("title", "pageTitle")}` : "",
    pick("conversation", "chat", "thread") ? `Conversation: ${pick("conversation", "chat", "thread")}` : "",
    pick("url", "sourceUrl", "pageUrl", "messageUrl") ? `Source URL: ${pick("url", "sourceUrl", "pageUrl", "messageUrl")}` : "",
  ]);
  return detail ? { sourceKind, sourceLabel: PHOTO_MEDIA_SOURCE_LABELS[sourceKind] || PHOTO_MEDIA_SOURCE_LABELS.app, sourceDetail: detail } : {};
}

function attributionFromMessageText(text) {
  const sender = firstHeaderValue(text, ["Sender", "From"]);
  const conversation = firstHeaderValue(text, ["Conversation", "Chat", "Thread"]);
  const url = firstHeaderValue(text, ["URL", "Source URL"]);
  const detail = detailFromParts([
    sender ? `Sender: ${sender}` : "",
    conversation ? `Conversation: ${conversation}` : "",
    url ? `Source URL: ${url}` : "",
  ]);
  return detail ? { sourceKind: "messages", sourceLabel: PHOTO_MEDIA_SOURCE_LABELS.messages, sourceDetail: detail } : {};
}

function inferLocalMediaSourceSidecarAttribution(filePath, isDir = false) {
  for (const candidate of sidecarCandidatePaths(filePath, isDir)) {
    const lower = candidate.toLowerCase();
    const text = readSmallTextFile(candidate);
    if (!text) continue;
    if (lower.endsWith(".eml")) {
      const attribution = attributionFromMailText(text);
      if (attribution.sourceDetail) return attribution;
    }
    if (lower.endsWith(".webloc") || lower.endsWith(".url")) {
      const attribution = attributionFromWebText(text);
      if (attribution.sourceDetail) return attribution;
    }
    if (lower.endsWith(".json")) {
      const attribution = attributionFromContextJson(text);
      if (attribution.sourceDetail) return attribution;
    }
    if (lower.endsWith(".txt")) {
      const messageAttribution = attributionFromMessageText(text);
      if (messageAttribution.sourceDetail) return messageAttribution;
      const webAttribution = attributionFromWebText(text);
      if (webAttribution.sourceDetail) return webAttribution;
    }
  }
  return {};
}

function inferLocalMediaSourceAttribution(filePath, isDir = false, options = {}) {
  const parts = mediaSourcePathParts(filePath);
  const containerParts = isDir ? parts : parts.slice(0, -1);
  const lowerParts = parts.map((part) => part.toLowerCase());
  const lowerPath = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  const sidecarAttribution = options.includeSidecars === false ? {} : inferLocalMediaSourceSidecarAttribution(filePath, isDir);
  let sourceKind = "";
  let sourceDetail = "";

  if (lowerParts.some((part) => part.endsWith(".photoslibrary")) || lowerPath.includes("photos library")) {
    const libraryPart = parts.find((part) => part.toLowerCase().endsWith(".photoslibrary"));
    sourceKind = "library";
    sourceDetail = libraryPart ? `${titleCaseMediaSourcePart(libraryPart)} package` : "Photo library";
  } else if (lowerPath.includes("com.apple.mail") || lowerPath.includes("mail downloads") || lowerParts.includes("mail")) {
    sourceKind = "mail";
    sourceDetail = mediaSourceTailFromMarker(containerParts, (part) => part === "mail downloads", "Mail Downloads", 1);
  } else if (lowerPath.includes("com.apple.safari") || lowerParts.includes("safari") || lowerParts.includes("browser")) {
    sourceKind = "safari";
    sourceDetail = lowerParts.includes("downloads") ? "Safari Downloads" : "Safari";
  } else if (lowerPath.includes("com.apple.messages") || lowerPath.includes("library/messages") || lowerParts.includes("messages") || lowerParts.includes("imessage")) {
    sourceKind = "messages";
    sourceDetail = mediaSourceTailFromMarker(containerParts, (part) => part === "messages" || part === "attachments", "Messages attachments", 2);
  } else if (lowerPath.includes("airdrop") || lowerPath.includes("air drop")) {
    sourceKind = "airdrop";
    sourceDetail = "AirDrop";
  } else if (lowerParts.includes("dcim") || lowerParts.some((part) => /^10\dapple$/.test(part)) || lowerParts.some((part) => ["camera", "canon", "eos_digital", "fujifilm", "gopro", "lumix", "nikon", "olympus", "panasonic", "private", "sony"].includes(part))) {
    sourceKind = "camera";
    sourceDetail = lowerParts.includes("dcim")
      ? mediaSourceTailFromMarker(containerParts, (part) => part === "dcim", "DCIM", 1)
      : "Camera/device path";
  } else if (lowerParts.includes("downloads")) {
    sourceKind = "downloads";
    sourceDetail = "Downloads";
  } else if (lowerPath.includes("icloud") || lowerPath.includes("mobile documents") || lowerPath.includes("onedrive") || lowerPath.includes("dropbox")) {
    sourceKind = "app";
    sourceDetail = lowerPath.includes("mobile documents") ? "iCloud Drive" : "Other app";
  }

  if (!sourceKind && sidecarAttribution.sourceKind) {
    sourceKind = sidecarAttribution.sourceKind;
  }
  if (sidecarAttribution.sourceDetail) {
    sourceDetail = sidecarAttribution.sourceDetail;
  }
  if (!sourceKind) return {};
  return {
    sourceKind,
    sourceLabel: sidecarAttribution.sourceLabel || PHOTO_MEDIA_SOURCE_LABELS[sourceKind] || PHOTO_MEDIA_SOURCE_LABELS.folder,
    sourceDetail
  };
}

// Grant a batch of file/folder paths (dropped files, or folder sample images) and
// return their thumbnail URLs, so they can be previewed before enrolling.
ipcMain.handle("media:prepare-paths", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Media prepare payload");
  const { paths, overflow } = uniquePathBatch(payload.paths, MEDIA_PREPARE_PATH_LIMIT);
  if (overflow) {
    throw createAppError(
      "E-MEDIA-PREPARE-LIMIT",
      `Prepare ${MEDIA_PREPARE_PATH_LIMIT} or fewer unique files or folders at a time.`
    );
  }
  const out = [];
  for (let index = 0; index < paths.length; index += 1) {
    const candidate = paths[index];
    await grantUserPathAsync(candidate);
    let isDir = false;
    try {
      isDir = (await fs.promises.stat(candidate)).isDirectory();
    } catch (_error) {
      isDir = false;
    }
    out.push({
      path: candidate,
      url: mediaUrlFor(candidate),
      isDir,
      ...inferLocalMediaSourceAttribution(candidate, isDir, { includeSidecars: index < MEDIA_PREPARE_SIDECAR_LIMIT })
    });
  }
  return out;
});

ipcMain.handle("camera:save-frame", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Camera frame payload");
  // MISS-03: don't write captured face media into a locked workspace.
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before capturing photos.");
  }
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
    startPhotoIndexingHeadlessScheduler();
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
  stopPhotoIndexingHeadlessScheduler();
  stopFolderWatch("App quitting.", { persist: false });
  stopMcpHttpServer();
  if (backend) {
    backend.stop();
  }
});

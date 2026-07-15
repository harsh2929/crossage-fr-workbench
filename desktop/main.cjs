const { app, BrowserWindow, dialog, ipcMain, session, Menu, Tray, nativeImage, shell, Notification, clipboard, protocol, net, safeStorage, nativeTheme, ShareMenu, systemPreferences, powerMonitor } = require("electron");
const { spawn, spawnSync } = require("child_process");
const nodeHttp = require("http");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const os = require("os");
const crypto = require("crypto");
const { pathToFileURL, fileURLToPath } = require("url");
const { Worker } = require("worker_threads");
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
  resolveRendererGpuMode,
  canonicalPathKey,
  pathTrustKeyFromResolved,
  buildContentSecurityPolicy,
  uniquePathBatch,
  buildTrustedMediaPathSet,
  filterStableWatchFiles,
} = require("./main/util.cjs");
const {
  resolveReleasePublicKey,
  verifyDownloadedUpdate,
} = require("./main/update-security.cjs");
const { buildSystemPhotoSources, photoPrivacySettingsUrl } = require("./main/photo-sources.cjs");
const {
  derivePhotoIndexingRuntimePolicy,
  normalizePhotoIndexingPowerMode,
} = require("./main/photo-indexing-runtime.cjs");
const { createInboundConnectorVault } = require("./main/inbound-connectors.cjs");
const { createPhotoTetherRuntime } = require("./main/photo-tether-runtime.cjs");
const { parseProtocolUrl } = require("./main/external-open.cjs");
const {
  RECOVERY_PASSPHRASE_ENV: WORKSPACE_RECOVERY_PASSPHRASE_ENV,
  REQUIRE_ENCRYPTION_ENV: WORKSPACE_REQUIRE_ENCRYPTION_ENV,
  commitWorkspaceKeyRotation,
  configureWorkspaceRecoveryPassphrase,
  reconcileWorkspaceKeyRotation,
  resolveDesktopWorkspaceKeys,
  safeStorageProtectionStatus,
  stageWorkspaceKeyRotation,
  workspaceRecoveryStatus,
} = require("./main/workspace-encryption.cjs");
const {
  buildMcpConnectionInfo,
  mcpStdioInvocation,
  upsertCodexConfig,
  DEFAULT_HTTP_HOST: MCP_HTTP_HOST,
  DEFAULT_HTTP_PORT: MCP_HTTP_PORT,
} = require("./main/mcp-connection.cjs");
const {
  createMobileCompanion,
  ensureMobileCredentialFile,
  listMobileCompanions,
  normalizeMobilePublicUrl,
  revokeMobileCompanion,
} = require("./main/mobile-companion.cjs");

let autoUpdater = null;
try {
  ({ autoUpdater } = require("electron-updater"));
} catch {
  autoUpdater = null;
}

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const DAM_CATALOG_PROVIDERS = new Set(["lightroom_catalog", "capture_one_catalog"]);

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

const inboundConnectorVault = createInboundConnectorVault({
  safeStorage,
  userDataPath: app.getPath("userData"),
});

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
let photoTetherRuntime = null;
let activePhotoCatalogCancelToken = "";
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
let trustedPreviewsPathCache = null;
let pathTrustGeneration = 0;
const recentDiagnosticEvents = [];
const diagnosticWriteQueue = [];
let diagnosticWriteRunning = false;
let workspaceLockUnlocked = true;
let workspaceLockInitialized = false;
let workspaceLockEnabled = false;
let workspaceLockWorkspace = "";
let backendJsonParserWorker = null;
let backendJsonParserNextId = 1;
const backendJsonParserPending = new Map();
let photoIndexingHeadlessInitialTimer = null;
let photoIndexingHeadlessTimer = null;
let photoIndexingHeadlessRunning = false;
let photoIndexingHeadlessLastRuntimeSkipKey = "";
let photoIndexingHeadlessSettingsCache = null;
let photoIndexingHeadlessSettingsCachedAt = 0;
let photoIndexingHeadlessSettingsWorkspace = "";
let photoIndexingHeadlessSpeedLimit = 100;
let photoIndexingHeadlessThermalState = "unknown";
let photoIndexingHeadlessPowerListenersRegistered = false;
const MAX_DIAGNOSTIC_EVENTS = 240;
const MAX_DIAGNOSTIC_LOG_BYTES = 2 * 1024 * 1024;
const MAX_BACKEND_STDERR_TAIL_BYTES = 64 * 1024;
const QUERY_TRUSTED_MEDIA_PATH_LIMIT = 20000;
const USER_GRANTED_PATH_LIMIT = Math.max(1000, Math.min(50000, Number.parseInt(process.env.CROSSAGE_USER_GRANTED_PATH_LIMIT || "20000", 10) || 20000));
const MEDIA_PREPARE_PATH_LIMIT = Math.max(1, Math.min(5000, Number.parseInt(process.env.CROSSAGE_MEDIA_PREPARE_PATH_LIMIT || "1000", 10) || 1000));
const MEDIA_PREPARE_SIDECAR_LIMIT = Math.max(0, Math.min(MEDIA_PREPARE_PATH_LIMIT, Number.parseInt(process.env.CROSSAGE_MEDIA_PREPARE_SIDECAR_LIMIT || "64", 10) || 64));
const BACKEND_TIMEOUT_KILL_GRACE_MS = Math.max(1000, Number.parseInt(process.env.CROSSAGE_BACKEND_TIMEOUT_KILL_GRACE_MS || "5000", 10) || 5000);
const BACKEND_MAIN_THREAD_PARSE_LIMIT = Math.max(32_768, Number.parseInt(process.env.CROSSAGE_BACKEND_MAIN_THREAD_PARSE_LIMIT || "262144", 10) || 262_144);
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
  verifying: false,
  available: false,
  downloaded: false,
  downloadVerified: false,
  appVersion: safeAppVersion(),
  latestVersion: null,
  progress: null,
  verification: null,
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
const BACKEND_GENERATIVE_COMMAND_TIMEOUT_MS = Math.max(
  BACKEND_COMMAND_TIMEOUT_MS,
  Number.parseInt(process.env.VINTRACE_GENERATIVE_COMMAND_TIMEOUT_MS || "10800000", 10) || 10_800_000
);
const BACKEND_GENERATIVE_COMMANDS = new Set([
  "install_photo_generative_pack",
  "render_photo_generative_preview",
  "generate_synthetic_age_image_reviews"
]);
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
  "model_lifecycle_status",
  "run_model_lifecycle_evaluation",
  "stage_model_lifecycle_candidate",
  "promote_model_lifecycle_candidate",
  "rollback_model_lifecycle_baseline",
  "rollback_model_configuration",
  "set_model_root",
  "download_model",
  "set_workspace",
  "set_consent",
  "enroll",
  "enroll_paths",
  "enroll_age_groups",
  "synthetic_enrollment_screen_status",
  "approve_synthetic_enrollment_review",
  "reject_synthetic_enrollment_review",
  "build_age_trajectory_references",
  "remove_age_trajectory_references",
  "synthetic_age_image_review_status",
  "generate_synthetic_age_image_reviews",
  "approve_synthetic_age_image_review",
  "reject_synthetic_age_image_review",
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
  "bulk_block_false_matches",
  "reassign_candidate_person",
  "bulk_reassign_candidate_person",
  "duplicate_people",
  "apply_review_rules",
  "query_candidates",
  "ordered_review_candidates",
  "suggest_photo_review_more_candidates",
  "suggest_photo_relationship_names",
  "review_photo_relationship_name_suggestion",
  "list_photo_folders",
  "list_photo_folder_items",
  "list_photo_date_buckets",
  "search_photo_library",
  "semantic_search_photos",
  "photo_library_agent_status",
  "query_photo_library_agent",
  "execute_photo_library_agent_plan",
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
  "bulk_assign_photo_pet",
  "dismiss_photo_pet_review",
  "bulk_dismiss_photo_pet_review",
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
  "photo_generative_status",
  "photo_content_credentials_status",
  "inspect_photo_content_credentials",
  "install_photo_generative_pack",
  "render_photo_generative_preview",
  "apply_photo_generative_edit",
  "discard_photo_generative_preview",
  "photo_story_status",
  "photo_stories",
  "generate_photo_story",
  "save_photo_story",
  "delete_photo_story",
  "restore_photo_story_version",
  "export_photo_story",
  "create_photo_story_slideshow",
  "photo_culling_status",
  "analyze_photo_burst_culling",
  "apply_photo_culling_recommendation",
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
  "photo_source_status",
  "photo_source_jobs",
  "photo_source_job_status",
  "run_photo_source_job",
  "cancel_photo_source_job",
  "retry_photo_source_job",
  "dismiss_photo_source_job",
  "list_photo_source_people_hints",
  "review_photo_source_people_hint",
  "revoke_photo_source_consent",
  "apple_photos_status",
  "list_apple_photos_libraries",
  "preview_apple_photos_library",
  "import_apple_photos_library",
  "sync_apple_photos_library",
  "export_apple_photos_assets",
  "windows_photo_source_status",
  "list_windows_photo_folders",
  "preview_windows_photo_folder",
  "import_windows_photo_folder",
  "sync_windows_photo_folder",
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
  "photo_vlm_status",
  "install_photo_vlm",
  "index_photo_objects",
  "photo_object_index_status",
  "photo_audio_status",
  "photo_audio_segments",
  "index_photo_audio",
  "local_sync_status",
  "local_sync_initialize",
  "local_sync_start",
  "local_sync_stop",
  "local_sync_create_invitation",
  "local_sync_accept_invitation",
  "local_sync_sync_peer",
  "local_sync_revoke_peer",
  "local_sync_conflicts",
  "local_sync_export_recovery",
  "local_sync_restore_recovery",
  "enqueue_photo_indexing_job",
  "photo_indexing_jobs",
  "run_photo_indexing_job",
  "run_photo_indexing_queue",
  "cancel_photo_indexing_job",
  "dismiss_photo_indexing_job",
  "photo_curation_preferences",
  "save_photo_curation_preferences",
  "photo_user_memories",
  "photo_user_memory_source_order",
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
  "photo_album_source_order",
  "add_photo_album_items",
  "remove_photo_album_items",
  "reorder_photo_album_items",
  "suggest_photo_albums",
  "photo_color_profile_status",
  "validate_photo_color_profile",
  "start_photo_export_job",
  "photo_export_job_status",
  "photo_export_jobs",
  "cancel_photo_export_job",
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
  "compliance_status",
  "biometric_retention_policy",
  "acknowledge_ai_disclosure",
  "enforce_retention_policy",
  "export_biometric_retention_policy",
  "record_biometric_policy_publication",
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
  "run_cross_age_trajectory_benchmark",
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
  "delete_subject_data",
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

const rendererGpuMode = resolveRendererGpuMode();
process.env.CROSSAGE_RENDERER_GPU_MODE = rendererGpuMode;

function configureRendererStability() {
  if (rendererGpuMode !== "software") return;
  // Explicit compatibility fallback for unstable GPU/driver combinations and
  // hidden macOS automation. Normal desktop sessions stay hardware accelerated.
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

function releasePublishConfig() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    return pkg?.build?.publish || null;
  } catch {
    return null;
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
  return safeStorageProtectionStatus(safeStorage).ok;
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
  initializeWorkspaceLockForActiveWorkspace();
  const enabled = workspaceLockEnabled;
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
  workspaceLockEnabled = true;
  workspaceLockInitialized = true;
  workspaceLockWorkspace = activeWorkspacePath();
  workspaceLockUnlocked = true;
  appendDiagnosticEvent({ type: "workspace_lock_enabled", level: "info", workspace: activeWorkspacePath() });
  return getWorkspaceLockStatus();
}

function lockWorkspaceNow() {
  initializeWorkspaceLockForActiveWorkspace();
  if (!workspaceLockEnabled) {
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
  workspaceLockEnabled = false;
  workspaceLockInitialized = true;
  workspaceLockWorkspace = activeWorkspacePath();
  workspaceLockUnlocked = true;
  appendDiagnosticEvent({ type: "workspace_lock_disabled", level: "info", workspace: activeWorkspacePath() });
  return getWorkspaceLockStatus();
}

function isWorkspaceLocked() {
  initializeWorkspaceLockForActiveWorkspace();
  return Boolean(workspaceLockEnabled && !workspaceLockUnlocked);
}

function initializeWorkspaceLockForActiveWorkspace() {
  const workspace = activeWorkspacePath();
  if (workspaceLockInitialized && workspaceLockWorkspace === workspace) {
    return;
  }
  workspaceLockEnabled = pathAvailable(workspaceLockFilePath(workspace));
  workspaceLockUnlocked = !workspaceLockEnabled;
  workspaceLockWorkspace = workspace;
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
  "E-WORKSPACE-KEY": { category: "privacy", severity: "error", action: "Reconnect the OS keychain or use the workspace recovery passphrase." },
  "E-WORKSPACE-KEY-UNAVAILABLE": { category: "privacy", severity: "error", action: "Enable the OS credential store before opening this app folder." },
  "E-WORKSPACE-KEY-UNLOCK": { category: "privacy", severity: "error", action: "Use the workspace recovery passphrase or restore the OS keychain entry." },
  "E-WORKSPACE-KEY-ROTATION": { category: "privacy", severity: "error", action: "Restart Vintrace so the pending key rotation can be reconciled." },
  "E-CAMERA-FRAME-TYPE": { category: "camera", severity: "warn", action: "Capture a PNG, JPEG, or WebP frame." },
  "E-CAMERA-FRAME-EMPTY": { category: "camera", severity: "warn", action: "Capture a new frame and retry." },
  "E-CAMERA-FRAME-LARGE": { category: "camera", severity: "warn", action: "Capture a smaller frame and retry." },
  "E-FOLDER-WATCH-PATH": { category: "filesystem", severity: "warn", action: "Choose a folder before starting watch mode." },
  "E-PHOTO-TETHER-PATH": { category: "filesystem", severity: "warn", action: "Choose an accessible capture folder." },
  "E-PHOTO-TETHER-TEMPLATE": { category: "input", severity: "warn", action: "Use a filename-only capture template with supported tokens." },
  "E-PHOTO-TETHER-PTP-UNAVAILABLE": { category: "camera", severity: "warn", action: "Install gphoto2 or use watched-folder tethering." },
  "E-PHOTO-TETHER-CAMERA-NOT-FOUND": { category: "camera", severity: "warn", action: "Reconnect a supported camera or use watched-folder tethering." },
  "E-PHOTO-TETHER-CAPTURE": { category: "camera", severity: "error", action: "Check the camera connection and retry capture." },
  "E-PHOTO-TETHER-TIMEOUT": { category: "camera", severity: "error", action: "Reconnect or wake the camera, then retry." },
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

async function readFileTail(filePath, maxBytes) {
  const stat = await fs.promises.stat(filePath);
  const bytes = Math.min(maxBytes, stat.size);
  const start = Math.max(0, stat.size - bytes);
  const buffer = Buffer.alloc(bytes);
  const handle = await fs.promises.open(filePath, "r");
  try {
    await handle.read(buffer, 0, bytes, start);
  } finally {
    await handle.close();
  }
  const text = buffer.toString("utf8");
  return start > 0 ? text.replace(/^[^\n]*(?:\n|$)/, "") : text;
}

async function trimDiagnosticsLogAsync() {
  const filePath = diagnosticsLogPath();
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size <= MAX_DIAGNOSTIC_LOG_BYTES * 2) return;
    const bytes = await fs.promises.readFile(filePath);
    const start = Math.max(0, bytes.length - MAX_DIAGNOSTIC_LOG_BYTES);
    let tail = bytes.subarray(start).toString("utf8");
    if (start > 0) tail = tail.replace(/^[^\n]*(?:\n|$)/, "");
    await fs.promises.writeFile(filePath, tail, "utf8");
  } catch {
    // Diagnostics persistence is best effort.
  }
}

function scheduleDiagnosticWrites() {
  if (diagnosticWriteRunning || diagnosticWriteQueue.length === 0) return;
  diagnosticWriteRunning = true;
  setImmediate(async () => {
    const batch = diagnosticWriteQueue.splice(0, diagnosticWriteQueue.length);
    try {
      await fs.promises.mkdir(diagnosticsDir(), { recursive: true });
      await fs.promises.appendFile(diagnosticsLogPath(), `${batch.join("\n")}\n`, "utf8");
      await trimDiagnosticsLogAsync();
    } catch {
      // Diagnostics must never crash or stall the app.
    } finally {
      diagnosticWriteRunning = false;
      scheduleDiagnosticWrites();
    }
  });
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
  diagnosticWriteQueue.push(JSON.stringify(row));
  if (diagnosticWriteQueue.length > 1_000) {
    diagnosticWriteQueue.splice(0, diagnosticWriteQueue.length - 1_000);
  }
  scheduleDiagnosticWrites();
  sendToRenderer("diagnostics:event", redactDiagnosticValue(row));
}

async function readDiagnosticEvents(limit = MAX_DIAGNOSTIC_EVENTS) {
  const rows = [...recentDiagnosticEvents];
  try {
    const fileRows = (await readFileTail(diagnosticsLogPath(), MAX_DIAGNOSTIC_LOG_BYTES))
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
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") {
      rows.unshift({
        at: new Date().toISOString(),
        type: "diagnostics_read_failed",
        level: "warn",
        message: "Could not read the local diagnostics log."
      });
    }
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

async function createDiagnosticsReport(options = {}) {
  const includePaths = Boolean(options.includePaths);
  const readyState = backend?.readyState || null;
  const events = (await readDiagnosticEvents(Number(options.limit || MAX_DIAGNOSTIC_EVENTS)))
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
  const report = await createDiagnosticsReport({ includePaths });
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
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
  trustedPreviewsPathCache = null;
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
  const previewsReal = currentPreviewsRealPath(state);
  trustedMediaPathCache = { state, paths, previewsReal, queryVersion: queryTrustedMediaPathsVersion };
  return trustedMediaPathCache;
}

function currentPreviewsRealPath(state = backend?.readyState || null) {
  if (!state?.workspace) {
    return "";
  }
  if (trustedPreviewsPathCache && trustedPreviewsPathCache.state === state) {
    return trustedPreviewsPathCache.previewsReal;
  }
  const previewsReal = safeRealpath(path.join(state.workspace, "previews"));
  trustedPreviewsPathCache = { state, previewsReal };
  return previewsReal;
}

async function realpathOrEmpty(filePath) {
  try {
    return await fs.promises.realpath(path.resolve(String(filePath || "")));
  } catch {
    return "";
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
  const state = backend?.readyState || null;
  if (!state) {
    return "";
  }
  const previewsReal = currentPreviewsRealPath(state);
  if (previewsReal && isSubpath(previewsReal, targetReal)) {
    return targetReal;
  }
  const { paths } = currentTrustedPaths();
  if (!paths.size) {
    return "";
  }
  if (paths.has(pathTrustKeyFromResolved(targetReal))) {
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
  const targetKey = canonicalPathKey(target);
  if (state.workspace && isSubpath(canonicalPathKey(state.workspace), targetKey)) {
    return true;
  }
  return paths.has(targetKey) || isUserGrantedPath(target);
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

function inAppUpdatesEnabled() {
  return envFlag("VINTRACE_ENABLE_IN_APP_UPDATES") || envFlag("CROSSAGE_ENABLE_UPDATER");
}

// USC-02: a custom update feed can otherwise be redirected by any local actor
// who sets VINTRACE_UPDATE_URL. The downloaded artifact is still verified
// against a signed SHA256SUMS.txt before install, but the feed itself must also
// be HTTPS and, in packaged builds, operator-allowlisted (VINTRACE_UPDATE_HOSTS)
// before honoring the override; reject anything else and fall back to the
// default GitHub provider.
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

async function verifyDownloadedUpdateFromUpdater(info = {}) {
  const version = info.version || updateState.latestVersion || null;
  appendDiagnosticEvent({ type: "update_downloaded", level: "info", version });
  publishUpdateState({
    checking: false,
    downloading: false,
    verifying: true,
    available: true,
    downloaded: false,
    downloadVerified: false,
    latestVersion: version,
    verification: null,
    progress: updateState.progress ? { ...updateState.progress, percent: 100 } : null,
    error: null,
    message: "Verifying update signature."
  });
  const releaseKey = resolveReleasePublicKey();
  if (!releaseKey.ok) {
    throw new Error("Release public key is missing or invalid.");
  }
  const verification = await verifyDownloadedUpdate({
    downloadedFile: info.downloadedFile,
    updateInfo: info,
    feedUrl: resolveUpdateFeedUrl(),
    publish: releasePublishConfig(),
    publicKeyPem: releaseKey.publicKeyPem,
  });
  if (!verification.ok) {
    throw new Error(`Update verification failed: ${verification.reason || "unknown"}`);
  }
  appendDiagnosticEvent({
    type: "update_verified",
    level: "info",
    version,
    artifact: verification.artifactName || null,
    sha256: verification.sha256 || null
  });
  publishUpdateState({
    checking: false,
    downloading: false,
    verifying: false,
    available: true,
    downloaded: true,
    downloadVerified: true,
    latestVersion: version,
    progress: updateState.progress ? { ...updateState.progress, percent: 100 } : null,
    verification: {
      artifact: verification.artifactName || "",
      sha256: verification.sha256 || "",
      signedChecksumManifest: true
    },
    error: null,
    message: "Update is verified and ready to install."
  });
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
  if (!inAppUpdatesEnabled()) {
    return publishUpdateState({
      supported: true,
      canCheck: false,
      provider: "disabled",
      channel: selectedChannel,
      message: "In-app updates are disabled by default. Enable them only for verified release channels with a configured release public key."
    });
  }
  const releaseKey = resolveReleasePublicKey();
  if (!releaseKey.ok) {
    appendDiagnosticEvent({ type: "update_verification_key_missing", level: "warn", reason: releaseKey.reason || "missing" });
    return publishUpdateState({
      supported: true,
      canCheck: false,
      provider: "disabled",
      channel: selectedChannel,
      message: "In-app updates require VINTRACE_RELEASE_PUBKEY or VINTRACE_RELEASE_PUBLIC_KEY so downloaded updates can be verified before install."
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
      verifying: false,
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
      downloadVerified: false,
      latestVersion: info.version || null,
      progress: null,
      verification: null,
      error: null,
      message: "An update is available."
    });
  });
  autoUpdater.on("update-not-available", (info = {}) => {
    publishUpdateState({
      checking: false,
      downloading: false,
      verifying: false,
      available: false,
      downloaded: false,
      downloadVerified: false,
      latestVersion: info.version || null,
      progress: null,
      verification: null,
      error: null,
      message: "You are on the newest version."
    });
  });
  autoUpdater.on("download-progress", (progress = {}) => {
    publishUpdateState({
      checking: false,
      downloading: true,
      verifying: false,
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
    verifyDownloadedUpdateFromUpdater(info).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendDiagnosticEvent({ type: "update_verification_failed", level: "error", message, stack: diagnosticStack(error) });
      publishUpdateState({
        checking: false,
        downloading: false,
        verifying: false,
        available: true,
        downloaded: false,
        downloadVerified: false,
        latestVersion: info.version || updateState.latestVersion,
        verification: null,
        error: message,
        message: "Downloaded update could not be verified."
      });
    });
  });
  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnosticEvent({ type: "update_error", level: "error", message, stack: diagnosticStack(error) });
    publishUpdateState({
      checking: false,
      downloading: false,
      verifying: false,
      downloadVerified: false,
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
    verifying: false,
    available: false,
    downloaded: false,
    downloadVerified: false,
    latestVersion: null,
    progress: null,
    verification: null,
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
      verifying: false,
      downloadVerified: false,
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
    publishUpdateState({
      downloading: true,
      verifying: false,
      downloaded: false,
      downloadVerified: false,
      verification: null,
      error: null,
      message: "Downloading update."
    });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendDiagnosticEvent({ type: "update_download_failed", level: "error", message, stack: diagnosticStack(error) });
    publishUpdateState({ downloading: false, verifying: false, downloadVerified: false, error: message, message: "Update download failed." });
  }
  return updateState;
}

function installDownloadedUpdate() {
  configureAutoUpdater();
  if (!autoUpdater || !updateState.downloaded || !updateState.downloadVerified) {
    return publishUpdateState({ message: updateState.verifying ? "Update verification is still running." : "No verified update is ready to install." });
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
  const notification = new Notification({ title: nativeUiText(title), body: nativeUiText(body), icon: appIconPath() });
  notification.once("failed", (_event, error) => {
    appendDiagnosticEvent({
      type: "notification_failed",
      level: "warn",
      message: String(error || "The operating system rejected the notification."),
      electronVersion: process.versions.electron || ""
    });
  });
  notification.show();
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
  const mutate = Boolean(options.mutate);
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
  const decorateEditMedia = (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return;
    }
    grantDecoratedMediaPath(item.generativePreviewPath);
    grantDecoratedMediaPath(item.renderedPreviewPath);
    decoratePath(item, "generativePreviewPath", "generativePreviewUrl");
    decoratePath(item, "renderedPreviewPath", "renderedPreviewUrl");
  };
  decorateEditMedia(value);
  decorateEditMedia(value.value);
  decorateEditMedia(value.stack);
  decorateEditMedia(value.value?.stack);
  const targetObject = (item) => (mutate ? item : { ...item });
  const decorateReference = (item) => {
    const next = targetObject(item);
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
  };
  const decorateCandidate = (item) => {
    const next = targetObject(item);
    grantDecoratedMediaPath(next.sourcePath);
    grantDecoratedMediaPath(next.mediaSourcePath);
    grantDecoratedMediaPath(next.previewPath);
    grantDecoratedMediaPath(next.bestRefPath);
    grantDecoratedMediaPath(next.bestRefPreviewPath);
    if (next.assetMetadata && typeof next.assetMetadata === "object" && !Array.isArray(next.assetMetadata)) {
      const assetMetadata = mutate ? next.assetMetadata : { ...next.assetMetadata };
      if (assetMetadata.livePhoto && typeof assetMetadata.livePhoto === "object" && !Array.isArray(assetMetadata.livePhoto)) {
        const livePhoto = mutate ? assetMetadata.livePhoto : { ...assetMetadata.livePhoto };
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
        const mediaPair = pair && typeof pair === "object" && !Array.isArray(pair) ? targetObject(pair) : pair;
        if (mediaPair && typeof mediaPair === "object") {
          grantDecoratedMediaPath(mediaPair.relatedSourcePath);
          decoratePath(mediaPair, "relatedSourcePath", "relatedSourceUrl");
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
      if (mutate) {
        state.references.forEach((item, index) => {
          state.references[index] = decorateReference(item);
        });
      } else {
        state.references = state.references.map(decorateReference);
      }
    }
    if (Array.isArray(state.candidates)) {
      if (mutate) {
        state.candidates.forEach((item, index) => {
          state.candidates[index] = decorateCandidate(item);
        });
      } else {
        state.candidates = state.candidates.map(decorateCandidate);
      }
    }
    if (Array.isArray(state.syntheticAgeImageReviews)) {
      const decorateSyntheticAgeReview = (item) => {
        const next = targetObject(item);
        grantDecoratedMediaPath(next.generatedPath);
        decoratePath(next, "generatedPath", "generatedUrl");
        return next;
      };
      if (mutate) {
        state.syntheticAgeImageReviews.forEach((item, index) => {
          state.syntheticAgeImageReviews[index] = decorateSyntheticAgeReview(item);
        });
      } else {
        state.syntheticAgeImageReviews = state.syntheticAgeImageReviews.map(decorateSyntheticAgeReview);
      }
    }
    if (Array.isArray(state.videoMoments)) {
      const decorateVideoMoment = (item) => {
        const next = targetObject(item);
        decoratePath(next, "mediaSourcePath", "mediaSourceUrl");
        decoratePath(next, "previewPath", "previewUrl");
        return next;
      };
      if (mutate) {
        state.videoMoments.forEach((item, index) => {
          state.videoMoments[index] = decorateVideoMoment(item);
        });
      } else {
        state.videoMoments = state.videoMoments.map(decorateVideoMoment);
      }
    }
  };
  if (value.state) {
    apply(value.state);
  } else if (value.counts && value.references && value.candidates) {
    apply(value);
  } else if (Array.isArray(value.items)) {
    if (mutate) {
      value.items.forEach((item, index) => {
        value.items[index] = decorateCandidate(item);
      });
    } else {
      value.items = value.items.map(decorateCandidate);
    }
  } else if (Array.isArray(value.folders)) {
    // Photos tab rail: grant + decorate each folder's cover thumbnail so it
    // resolves over vintrace-media:// like any other preview.
    const decorateFolder = (folder) => {
      const next = targetObject(folder);
      grantDecoratedMediaPath(next.coverPreviewPath);
      decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
      return next;
    };
    if (mutate) {
      value.folders.forEach((folder, index) => {
        value.folders[index] = decorateFolder(folder);
      });
    } else {
      value.folders = value.folders.map(decorateFolder);
    }
  } else if (Array.isArray(value.buckets)) {
    const decorateBucket = (bucket) => {
      const next = targetObject(bucket);
      grantDecoratedMediaPath(next.coverPreviewPath);
      decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
      return next;
    };
    if (mutate) {
      value.buckets.forEach((bucket, index) => {
        value.buckets[index] = decorateBucket(bucket);
      });
    } else {
      value.buckets = value.buckets.map(decorateBucket);
    }
  } else if (Array.isArray(value.groups)) {
    const decorateGroup = (group) => {
      const nextGroup = targetObject(group);
      nextGroup.items = Array.isArray(group.items)
        ? group.items.map((item) => {
          const next = targetObject(item);
          grantDecoratedMediaPath(next.previewPath);
          grantDecoratedMediaPath(next.coverPreviewPath);
          decoratePath(next, "previewPath", "previewUrl");
          decoratePath(next, "coverPreviewPath", "coverPreviewUrl");
          return next;
        })
        : [];
      return nextGroup;
    };
    if (mutate) {
      value.groups.forEach((group, index) => {
        value.groups[index] = decorateGroup(group);
      });
    } else {
      value.groups = value.groups.map(decorateGroup);
    }
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

function requireUnlockedPhotoPortability() {
  if (isWorkspaceLocked()) {
    throw createAppError(
      "E-WORKSPACE-LOCKED",
      "Unlock this app folder before migrating or transferring a photo catalog."
    );
  }
}

function grantedPhotoPortabilityPath(value, label, { required = false } = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    if (!required) return "";
    throw createAppError("E-PHOTO-CATALOG-PATH", `Choose ${label} in Vintrace first.`);
  }
  const resolved = path.resolve(raw);
  if (!isUserGrantedPath(resolved)) {
    throw createAppError("E-PHOTO-CATALOG-PATH", `Choose ${label} in Vintrace first.`);
  }
  return resolved;
}

function damCatalogProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!DAM_CATALOG_PROVIDERS.has(provider)) {
    throw createAppError("E-DAM-CATALOG-PROVIDER", "Choose Lightroom Classic or Capture One.");
  }
  return provider;
}

function validatedDamCatalogPayload(payload, { requireLibraryPath = false } = {}) {
  assertPlainObject(payload, "DAM catalog payload");
  const serialized = JSON.stringify(payload);
  if (serialized.length > 250_000) {
    throw createAppError("E-IPC-PARAMS-LARGE", "DAM catalog options are too large.");
  }
  const provider = damCatalogProvider(payload.provider);
  const libraryPath = grantedPhotoPortabilityPath(
    payload.libraryPath,
    provider === "lightroom_catalog" ? "a Lightroom catalog" : "a Capture One catalog",
    { required: requireLibraryPath }
  );
  const mediaRoot = grantedPhotoPortabilityPath(payload.mediaRoot, "the relocated media folder");
  const managedRoot = grantedPhotoPortabilityPath(
    payload.managedRoot || payload.managedFolder,
    "the managed library folder"
  );
  const rootMappings = Array.isArray(payload.rootMappings)
    ? payload.rootMappings.slice(0, 64).map((mapping) => {
      assertPlainObject(mapping, "DAM root mapping");
      const sourceRoot = String(mapping.sourceRoot || mapping.from || "").trim().slice(0, 4096);
      const targetRoot = grantedPhotoPortabilityPath(
        mapping.targetRoot || mapping.to,
        "each relocated media folder",
        { required: true }
      );
      if (!sourceRoot) {
        throw createAppError("E-DAM-CATALOG-MAPPING", "Each relocation needs its original catalog root.");
      }
      return { sourceRoot, targetRoot };
    })
    : [];
  return {
    ...payload,
    provider,
    ...(libraryPath ? { libraryPath } : {}),
    ...(mediaRoot ? { mediaRoot } : {}),
    ...(managedRoot ? { managedRoot } : {}),
    ...(rootMappings.length ? { rootMappings } : {}),
  };
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
  if (["inspect_public_dataset", "run_public_dataset_benchmark", "run_cross_age_trajectory_benchmark", "compare_public_dataset_models"].includes(command)) {
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
  if ([
    "preview_apple_photos_library",
    "import_apple_photos_library",
    "sync_apple_photos_library",
    "export_apple_photos_assets",
    "preview_windows_photo_folder",
    "import_windows_photo_folder",
    "sync_windows_photo_folder",
  ].includes(command)) {
    grantUserPath(params.libraryPath || params.rootPath);
    grantUserPath(params.managedRoot || params.managedFolder);
    grantUserPath(params.destination || params.folder);
  }
}

function configureSessionSecurity() {
  const contentSecurityPolicy = buildContentSecurityPolicy({
    isDev,
    mediaProtocolScheme: MEDIA_PROTOCOL_SCHEME,
  });

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
    if (!realTarget) {
      return new Response("Not found", { status: 404 });
    }
    try {
      return await net.fetch(pathToFileURL(realTarget).toString());
    } catch {
      // The file may disappear after canonicalization (for example, an
      // external drive was disconnected). Avoid a second pre-fetch stat/access
      // on every thumbnail and handle that narrow race at the fetch boundary.
      return new Response("Not found", { status: 404 });
    }
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

function publicPhotoTetherCameraStatus(camera) {
  if (!camera || typeof camera !== "object") return camera;
  const { executable: _executable, ...publicStatus } = camera;
  return {
    ...publicStatus,
    executableAvailable: Boolean(_executable || camera.available)
  };
}

function publicPhotoTetherSession(session) {
  if (!session || typeof session !== "object") return session;
  const captures = Array.isArray(session.captures) ? session.captures.map((capture) => {
    const targetPath = String(capture?.targetPath || capture?.sourcePath || "");
    if (targetPath) {
      grantUserPath(targetPath);
      grantQueryMediaPath(targetPath);
    }
    return { ...capture, previewUrl: targetPath ? mediaUrlFor(targetPath) : "" };
  }) : session.captures;
  return {
    ...session,
    ...(captures ? { captures } : {}),
    capabilities: publicPhotoTetherCameraStatus(session.capabilities)
  };
}

function publicPhotoTetherPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const result = { ...payload };
  if (result.camera) result.camera = publicPhotoTetherCameraStatus(result.camera);
  if (result.session) result.session = publicPhotoTetherSession(result.session);
  for (const key of ["recoverable", "recent"]) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map(publicPhotoTetherSession);
    }
  }
  return result;
}

function ensurePhotoTetherRuntime() {
  if (photoTetherRuntime) return photoTetherRuntime;
  if (!backend) backend = new PythonBackend();
  photoTetherRuntime = createPhotoTetherRuntime({
    invokeBackend: (command, params) => backend.invoke(command, params),
    mediaExtensions: new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]),
    environment: process.env,
    emit: (event) => {
      const publicEvent = publicPhotoTetherPayload(event);
      sendToRenderer("photo-tether:event", publicEvent);
      if (["capture-failed", "import-failed", "resume-failed", "watch-warning", "queue-full"].includes(String(event?.type || ""))) {
        appendDiagnosticEvent({
          type: `photo_tether_${String(event?.type || "error").replace(/-/g, "_")}`,
          level: String(event?.type || "").includes("warning") || event?.type === "queue-full" ? "warn" : "error",
          code: String(event?.code || ""),
          message: String(event?.error || event?.message || "Photo tether runtime error.")
        });
      }
    },
    onImported: async (event) => {
      const targetPath = String(event?.capture?.targetPath || event?.asset?.sourcePath || "");
      if (targetPath) {
        await grantUserPathAsync(targetPath);
        grantQueryMediaPath(targetPath);
      }
      return {
        ...event,
        previewUrl: targetPath ? mediaUrlFor(targetPath) : "",
        asset: event?.asset && typeof event.asset === "object"
          ? { ...event.asset, previewUrl: targetPath ? mediaUrlFor(targetPath) : "" }
          : event?.asset
      };
    }
  });
  return photoTetherRuntime;
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
    const workspace = activeWorkspacePath();
    const watchedFolder = folderWatch.folder;
    void fs.promises.mkdir(workspace, { recursive: true })
      .then(() => fs.promises.writeFile(path.join(workspace, ".scan-cancel"), new Date().toISOString(), "utf8"))
      .then(() => appendDiagnosticEvent({ type: "watch_scan_cancel_requested", level: "info", folder: watchedFolder }))
      .catch((error) => appendDiagnosticEvent({ type: "watch_scan_cancel_failed", level: "warn", message: error instanceof Error ? error.message : String(error) }));
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
  watch.sweepTimer = null;
  if (mainWindowIsForegroundActive() && !envFlag("CROSSAGE_WATCH_SWEEP_ALLOW_FOREGROUND")) {
    // fs.watch continues to queue ordinary changes. The recursive sweep is a
    // missed-event reconciliation pass and can wait until it will not compete
    // with foreground thumbnails, search, or navigation.
    scheduleWatchSweep(watch);
    return;
  }
  if (watch.sweeping || watch.scanning) {
    scheduleWatchSweep(watch);
    return;
  }
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

function settleBackendJsonParserPending(worker, value = null) {
  if (backendJsonParserWorker !== worker) return;
  backendJsonParserWorker = null;
  for (const pending of backendJsonParserPending.values()) {
    clearTimeout(pending.timer);
    pending.resolve(value);
  }
  backendJsonParserPending.clear();
}

function getBackendJsonParserWorker() {
  if (backendJsonParserWorker) return backendJsonParserWorker;
  const worker = new Worker(`
    const { parentPort } = require("worker_threads");
    parentPort.on("message", ({ id, value }) => {
      try {
        parentPort.postMessage({ id, ok: true, value: JSON.parse(value) });
      } catch {
        parentPort.postMessage({ id, ok: false });
      }
    });
  `, { eval: true });
  backendJsonParserWorker = worker;
  worker.unref();
  worker.on("message", (message) => {
    const pending = backendJsonParserPending.get(message?.id);
    if (!pending) return;
    backendJsonParserPending.delete(message.id);
    clearTimeout(pending.timer);
    pending.resolve(message.ok ? message.value : null);
  });
  worker.once("error", () => settleBackendJsonParserPending(worker));
  worker.once("exit", () => settleBackendJsonParserPending(worker));
  return worker;
}

function stopBackendJsonParserWorker() {
  const worker = backendJsonParserWorker;
  if (!worker) return;
  settleBackendJsonParserPending(worker);
  void worker.terminate();
}

function parseBackendLineInWorker(line) {
  return new Promise((resolve) => {
    const worker = getBackendJsonParserWorker();
    const id = backendJsonParserNextId++;
    const timer = setTimeout(() => {
      if (!backendJsonParserPending.has(id)) return;
      backendJsonParserPending.delete(id);
      resolve(null);
      settleBackendJsonParserPending(worker);
      void worker.terminate();
    }, 60_000);
    backendJsonParserPending.set(id, { resolve, timer });
    worker.postMessage({ id, value: String(line || "") });
  });
}

function parseBackendLine(line) {
  const text = String(line || "");
  if (text.length > BACKEND_MAIN_THREAD_PARSE_LIMIT) {
    return parseBackendLineInWorker(text);
  }
  try {
    return Promise.resolve(JSON.parse(text));
  } catch {
    return Promise.resolve(null);
  }
}

function backendPayloadLooksLarge(value) {
  const state = value?.state && typeof value.state === "object" ? value.state : value;
  return (
    Array.isArray(state?.candidates) && state.candidates.length > 1000
    || Array.isArray(state?.references) && state.references.length > 1000
    || Array.isArray(value?.items) && value.items.length > 1000
    || Array.isArray(value?.groups) && value.groups.some((group) => Array.isArray(group?.items) && group.items.length > 1000)
  );
}

async function decorateBackendPayload(value, options = {}) {
  const largePayload = backendPayloadLooksLarge(value);
  if (largePayload) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return decorateState(value, { ...options, mutate: largePayload });
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
    this.stdoutQueue = Promise.resolve();
    this.spawnGeneration = 0;
    this.workspaceOverride = "";
    this.workspaceKeyMaterial = null;
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
    this.readyPromise = this._spawn();
    return this.readyPromise;
  }

  _spawn() {
    const root = appRoot();
    const executable = findPythonExecutable();
    const isFrozenBackend = path.basename(executable).startsWith("crossage-backend");
    const userModelRoot = path.join(app.getPath("userData"), "models");
    const safetyExplainDir = path.join(userModelRoot, "safety-explain");
    const workspace = path.resolve(
      this.workspaceOverride
      || process.env.VINTRACE_WORKSPACE
      || process.env.CROSSAGE_WORKSPACE
      || path.join(app.getPath("userData"), "workspace")
    );
    let keyEnv = process.env;
    if (
      process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1"
      && !process.env.VINTRACE_WORKSPACE_DB_KEY
      && !workspaceLockSupported()
    ) {
      // Linux CI often has no Secret Service. Keep the e2e-only database stable
      // across process restarts without weakening production startup policy.
      const testKey = crypto.createHash("sha256")
        .update(`vintrace-e2e-workspace-key-v1\0${workspace}\0${app.getPath("userData")}`)
        .digest("base64url");
      keyEnv = { ...process.env, VINTRACE_WORKSPACE_DB_KEY: testKey };
    }
    let workspaceKeys;
    try {
      workspaceKeys = resolveDesktopWorkspaceKeys({ workspace, safeStorage, env: keyEnv });
    } catch (error) {
      const code = String(error?.code || "E-WORKSPACE-KEY");
      return Promise.reject(createAppError(code, error instanceof Error ? error.message : String(error)));
    }
    this.workspaceKeyMaterial = {
      keyId: workspaceKeys.keyId,
      previousKeyId: workspaceKeys.previousKeyId,
      source: workspaceKeys.source,
      pending: workspaceKeys.pending,
      workspace,
    };
    this.stderrTail = "";
    const args = isFrozenBackend ? [] : ["-m", "crossage_fr.api_server"];
    const env = {
      ...process.env,
      PYTHONPATH: root,
      VINTRACE_WORKSPACE: workspace,
      CROSSAGE_WORKSPACE: workspace,
      VINTRACE_WORKSPACE_DB_KEY: workspaceKeys.primaryEncoded,
      VINTRACE_WORKSPACE_DB_PREVIOUS_KEY: workspaceKeys.previousEncoded,
      [WORKSPACE_REQUIRE_ENCRYPTION_ENV]: "1",
      CROSSAGE_USER_MODEL_DIR: isFrozenBackend ? userModelRoot : (process.env.CROSSAGE_USER_MODEL_DIR || userModelRoot),
      CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR: isFrozenBackend ? safetyExplainDir : (process.env.CROSSAGE_SAFETY_EXPLAIN_INSTALL_DIR || safetyExplainDir),
      CROSSAGE_SAFETY_EXPLAIN_DIR: isFrozenBackend ? safetyExplainDir : (process.env.CROSSAGE_SAFETY_EXPLAIN_DIR || safetyExplainDir)
    };
    // The desktop has already unwrapped the key. Do not propagate its recovery
    // passphrase to the long-lived image-processing process.
    delete env[WORKSPACE_RECOVERY_PASSPHRASE_ENV];
    workspaceKeys.primaryKey.fill(0);
    workspaceKeys.previousKey?.fill(0);
    // MISS-01: scrub dynamic-loader injection variables before spawning the
    // backend so a local attacker who sets DYLD_*/LD_* can't load a malicious
    // library into the (hardened-runtime, camera-capable) backend process.
    for (const key of Object.keys(env)) {
      if (key.startsWith("DYLD_") || key.startsWith("LD_")) {
        delete env[key];
      }
    }
    const generation = ++this.spawnGeneration;
    this.child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const child = this.child;
    const lines = readline.createInterface({ input: child.stdout });
    let stdoutQueue = Promise.resolve();
    this.stdoutQueue = stdoutQueue;
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.child !== child) {
          return;
        }
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
        stdoutQueue = stdoutQueue.then(async () => {
          const message = await parseBackendLine(line);
          if (!message || this.child !== child) {
            return;
          }
          if (message.ready) {
            clearTimeout(timer);
            this.readyState = await decorateBackendPayload(message.state);
            this.consecutiveFailures = 0; // EIPC-05: healthy start clears the backoff.
            resolve(this.readyState);
            if (this.workspaceKeyMaterial?.pending) {
              setImmediate(() => void this.reconcilePendingWorkspaceKey());
            }
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
                payload: await decorateBackendPayload(message.payload || {}, {
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
            const result = await decorateBackendPayload(message.result, { trustGeneration: pending.trustGeneration });
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
        }).catch((error) => {
          appendDiagnosticEvent({
            type: "backend_stdout_parse_failed",
            level: "warn",
            message: error instanceof Error ? error.message : String(error)
          });
        });
        if (this.child === child) {
          this.stdoutQueue = stdoutQueue;
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
        this.rejectPendingForChild(child, generation, pipeError);
        if (!activeChild) {
          return;
        }
        clearTimeout(timer);
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
        this.rejectPendingForChild(child, generation, error);
        if (activeChild) {
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

  async reconcilePendingWorkspaceKey() {
    const material = this.workspaceKeyMaterial;
    if (!material?.pending || material.source === "environment") return { pending: false, action: "none" };
    try {
      const status = await this.invoke("workspace_encryption_status", {});
      const activeKeyId = String(status?.database?.keyId || status?.keyId || "");
      const result = reconcileWorkspaceKeyRotation({ workspace: material.workspace, activeKeyId });
      this.workspaceKeyMaterial = { ...material, keyId: activeKeyId, previousKeyId: "", pending: false };
      appendDiagnosticEvent({
        type: "workspace_key_rotation_reconciled",
        level: "info",
        action: result.action,
        keyId: activeKeyId,
      });
      return result;
    } catch (error) {
      appendDiagnosticEvent({
        type: "workspace_key_rotation_reconcile_failed",
        level: "error",
        code: String(error?.code || "E-WORKSPACE-KEY-ROTATION"),
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async rotateWorkspaceDatabaseKey() {
    await this.start();
    const workspace = path.resolve(this.readyState?.workspace || this.workspaceKeyMaterial?.workspace || "");
    const staged = stageWorkspaceKeyRotation({ workspace, safeStorage, env: process.env });
    try {
      const status = await this.invoke("rotate_workspace_database_key", {
        newKey: staged.newKeyEncoded,
        source: "desktop-os-keychain",
      });
      const activeKeyId = String(status?.database?.keyId || status?.keyId || "");
      commitWorkspaceKeyRotation({ workspace, activeKeyId });
      this.workspaceKeyMaterial = {
        keyId: activeKeyId,
        previousKeyId: "",
        source: "os-keychain",
        pending: false,
        workspace,
      };
      return { ...status, rotation: { oldKeyId: staged.oldKeyId, newKeyId: activeKeyId, pending: false } };
    } finally {
      staged.newKey.fill(0);
    }
  }

  async restartForWorkspace(workspacePath) {
    const nextWorkspace = path.resolve(String(workspacePath || ""));
    if (!nextWorkspace) throw createAppError("E-BACKEND-VALIDATION", "Choose an app folder.");
    const child = this.child;
    this.stopping = true;
    if (child && child.exitCode === null && !child.signalCode) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        child.once("exit", finish);
        try { child.kill("SIGTERM"); } catch { finish(); }
        setTimeout(() => {
          if (child.exitCode === null && !child.signalCode) {
            try { child.kill("SIGKILL"); } catch { /* already exited */ }
          }
          setTimeout(finish, 250);
        }, 1500);
      });
    }
    if (this.child === child) this.child = null;
    this.readyPromise = null;
    this.readyState = null;
    this.workspaceOverride = nextWorkspace;
    this.workspaceKeyMaterial = null;
    this.stopping = false;
    return this.start();
  }

  rejectPendingForChild(child, generation, error) {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.child !== child || pending.generation !== generation) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async invoke(command, params = {}) {
    await this.start();
    const child = this.child;
    const generation = this.spawnGeneration;
    if (!child || !child.stdin.writable) {
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
        const absoluteTimeout = BACKEND_GENERATIVE_COMMANDS.has(command)
          ? BACKEND_GENERATIVE_COMMAND_TIMEOUT_MS
          : BACKEND_COMMAND_TIMEOUT_MS;
        if (silentFor < BACKEND_STALL_TIMEOUT_MS && now - startedAt < absoluteTimeout) {
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
      this.pending.set(id, { resolve, reject, command, timer, trustGeneration, child, generation });
      child.stdin.write(payload, "utf8", (error) => {
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
      const workspace = activeWorkspacePath();
      void fs.promises.mkdir(workspace, { recursive: true })
        .then(() => fs.promises.writeFile(path.join(workspace, ".scan-cancel"), new Date().toISOString(), "utf8"))
        .catch(() => undefined);
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
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode) {
      return;
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already be gone.
    }
    setTimeout(() => {
      if (this.child !== child || child.exitCode !== null || child.signalCode) {
        return;
      }
      try {
        child.kill("SIGKILL");
      } catch {
        // SIGKILL is not available on every platform.
      }
    }, 1500);
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

function cachePhotoIndexingHeadlessSettings(result) {
  const value = unwrapBackendValue(result);
  const localSettings = value && typeof value === "object" && value.localSettings && typeof value.localSettings === "object"
    ? value.localSettings
    : null;
  if (!localSettings) return null;
  photoIndexingHeadlessSettingsCache = { ...localSettings };
  photoIndexingHeadlessSettingsCachedAt = Date.now();
  photoIndexingHeadlessSettingsWorkspace = activeWorkspacePath();
  return photoIndexingHeadlessSettingsCache;
}

function clearPhotoIndexingHeadlessSettingsCache() {
  photoIndexingHeadlessSettingsCache = null;
  photoIndexingHeadlessSettingsCachedAt = 0;
  photoIndexingHeadlessSettingsWorkspace = "";
}

function mainWindowIsForegroundActive() {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && mainWindow.isVisible()
    && mainWindow.isFocused()
  );
}

function photoIndexingHeadlessPowerState() {
  const forcedBattery = String(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_BATTERY || "").trim();
  const forcedIdleState = String(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_IDLE_STATE || "").trim().toLowerCase();
  const forcedThermalState = String(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_THERMAL_STATE || "").trim().toLowerCase();
  const forcedSpeedLimit = Number(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_SPEED_LIMIT || "");
  const forcedFreeMemoryMb = Number(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_FREE_MEMORY_MB || "");
  const forcedTotalMemoryMb = Number(process.env.CROSSAGE_PHOTO_INDEXING_FORCE_TOTAL_MEMORY_MB || "");
  let onBattery = false;
  let idleState = "unknown";
  let thermalState = "unknown";
  const foregroundActive = mainWindowIsForegroundActive();
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
  if (["unknown", "nominal", "fair", "serious", "critical"].includes(forcedThermalState)) {
    thermalState = forcedThermalState;
  } else if (powerMonitor && typeof powerMonitor.getCurrentThermalState === "function") {
    try {
      const current = String(powerMonitor.getCurrentThermalState() || "unknown").toLowerCase();
      thermalState = ["unknown", "nominal", "fair", "serious", "critical"].includes(current) ? current : "unknown";
      photoIndexingHeadlessThermalState = thermalState;
    } catch {
      thermalState = photoIndexingHeadlessThermalState;
    }
  } else {
    thermalState = photoIndexingHeadlessThermalState;
  }
  const speedLimit = Number.isFinite(forcedSpeedLimit) && forcedSpeedLimit > 0
    ? Math.max(1, Math.min(100, Math.round(forcedSpeedLimit)))
    : Math.max(1, Math.min(100, Math.round(Number(photoIndexingHeadlessSpeedLimit || 100))));
  const totalMemoryBytes = Number.isFinite(forcedTotalMemoryMb) && forcedTotalMemoryMb > 0
    ? Math.round(forcedTotalMemoryMb * 1024 * 1024)
    : Math.max(1, Number(os.totalmem()) || 1);
  const freeMemoryBytes = Number.isFinite(forcedFreeMemoryMb) && forcedFreeMemoryMb >= 0
    ? Math.round(forcedFreeMemoryMb * 1024 * 1024)
    : Math.max(0, Number(os.freemem()) || 0);
  const memoryAvailableFraction = Math.max(0, Math.min(1, freeMemoryBytes / totalMemoryBytes));
  const memoryPressure = freeMemoryBytes < 512 * 1024 * 1024 || memoryAvailableFraction < 0.03
    ? "critical"
    : freeMemoryBytes < 1024 * 1024 * 1024 || memoryAvailableFraction < 0.07
      ? "pressured"
      : "normal";
  return {
    onBattery,
    idleState,
    foregroundActive,
    thermalState,
    speedLimit,
    freeMemoryBytes,
    totalMemoryBytes,
    memoryAvailableFraction,
    memoryPressure
  };
}

function photoIndexingHeadlessRuntimePolicy(localSettings) {
  const power = photoIndexingHeadlessPowerState();
  return derivePhotoIndexingRuntimePolicy(localSettings, power, {
    ignoreRuntimePolicy: envFlag("CROSSAGE_PHOTO_INDEXING_IGNORE_RUNTIME_POLICY"),
    allowBattery: envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_BATTERY"),
    allowActiveLowPower: envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_ACTIVE_LOW_POWER"),
    allowActiveBalanced: envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_ACTIVE_BALANCED"),
    allowHeavyOnBattery: envFlag("CROSSAGE_PHOTO_INDEXING_ALLOW_HEAVY_ON_BATTERY"),
  });
}

function appendPhotoIndexingHeadlessRuntimeSkip(reason, policy) {
  const key = `${reason}:${policy.reason}:${policy.powerMode}:${policy.onBattery}:${policy.idleState}:${policy.foregroundActive}:${policy.thermalState}:${policy.speedLimit}:${policy.memoryPressure}`;
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
    idleState: String(policy.idleState || "unknown"),
    foregroundActive: Boolean(policy.foregroundActive),
    thermalState: String(policy.thermalState || "unknown"),
    speedLimit: Number(policy.speedLimit || 100),
    memoryPressure: String(policy.memoryPressure || "unknown")
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
    const workspace = activeWorkspacePath();
    const foregroundActive = mainWindowIsForegroundActive();
    const cacheMatchesWorkspace = photoIndexingHeadlessSettingsWorkspace === workspace;
    const cacheFresh = cacheMatchesWorkspace && Date.now() - photoIndexingHeadlessSettingsCachedAt < 5 * 60_000;
    let localSettings = cacheMatchesWorkspace ? photoIndexingHeadlessSettingsCache : null;
    if (!localSettings && foregroundActive && !envFlag("CROSSAGE_PHOTO_INDEXING_IGNORE_RUNTIME_POLICY")) {
      appendPhotoIndexingHeadlessRuntimeSkip(reason, {
        allowed: false,
        reason: "settings-deferred-while-foreground",
        powerMode: "balanced",
        ...photoIndexingHeadlessPowerState()
      });
      return;
    }
    if (!localSettings || (!cacheFresh && !foregroundActive)) {
      const settingsResult = await backend.invoke("photo_library_settings", {});
      localSettings = cachePhotoIndexingHeadlessSettings(settingsResult) || {};
    }
    const policy = photoIndexingHeadlessRuntimePolicy(localSettings);
    if (!policy.allowed) {
      appendPhotoIndexingHeadlessRuntimeSkip(reason, policy);
      return;
    }
    const result = await backend.invoke("run_photo_indexing_queue", {
      limit: 8,
      maxJobs: PHOTO_INDEXING_HEADLESS_BATCH_SIZE,
      automatic: true,
      headless: true,
      maxCostClass: policy.maxCostClass,
      runtimeState: policy
    });
    const value = unwrapBackendValue(result);
    const progress = value && typeof value === "object" && value.progress && typeof value.progress === "object"
      ? value.progress
      : {};
    const ran = Number(value?.ran || 0) || 0;
    const failed = Number(progress.failed || 0) || 0;
    const stoppedReason = String(value?.stoppedReason || value?.message || "");
    if (ran > 0 || failed > 0 || stoppedReason === "cost-limit") {
      appendDiagnosticEvent({
        type: "photo_indexing_headless_scheduler",
        level: failed > 0 ? "warn" : "info",
        reason,
        ran,
        stoppedReason,
        processed: Number(progress.processed || 0) || 0,
        updated: Number(progress.updated || 0) || 0,
        failed,
        deferred: Number(progress.deferred || 0) || 0,
        powerMode: policy.powerMode,
        onBattery: Boolean(policy.onBattery),
        idleState: String(policy.idleState || "unknown"),
        foregroundActive: Boolean(policy.foregroundActive),
        thermalState: String(policy.thermalState || "unknown"),
        speedLimit: Number(policy.speedLimit || 100),
        memoryPressure: String(policy.memoryPressure || "unknown"),
        freeMemoryBytes: Number(policy.freeMemoryBytes || 0),
        maxCostClass: String(policy.maxCostClass || "heavy"),
        constraints: Array.isArray(policy.constraints) ? policy.constraints : []
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
  registerPhotoIndexingHeadlessPowerListeners();
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

function registerPhotoIndexingHeadlessPowerListeners() {
  if (photoIndexingHeadlessPowerListenersRegistered || !powerMonitor || typeof powerMonitor.on !== "function") {
    return;
  }
  photoIndexingHeadlessPowerListenersRegistered = true;
  try {
    if (typeof powerMonitor.getCurrentThermalState === "function") {
      const current = String(powerMonitor.getCurrentThermalState() || "unknown").toLowerCase();
      if (["unknown", "nominal", "fair", "serious", "critical"].includes(current)) {
        photoIndexingHeadlessThermalState = current;
      }
    }
  } catch {
    photoIndexingHeadlessThermalState = "unknown";
  }
  powerMonitor.on("thermal-state-change", (_event, state) => {
    const next = String(state || "unknown").toLowerCase();
    photoIndexingHeadlessThermalState = ["unknown", "nominal", "fair", "serious", "critical"].includes(next) ? next : "unknown";
    void runPhotoIndexingHeadlessSchedulerTick("thermal-state-change");
  });
  powerMonitor.on("speed-limit-change", (_event, limit) => {
    const next = Number(limit);
    if (Number.isFinite(next) && next > 0) {
      photoIndexingHeadlessSpeedLimit = Math.max(1, Math.min(100, Math.round(next)));
    }
    void runPhotoIndexingHeadlessSchedulerTick("speed-limit-change");
  });
  for (const eventName of ["on-ac", "on-battery", "resume", "unlock-screen"]) {
    powerMonitor.on(eventName, () => {
      void runPhotoIndexingHeadlessSchedulerTick(eventName);
    });
  }
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
      // Keep the full workspace usable on compact laptop layouts and in
      // split-screen. The renderer switches to its icon-first navigation rail
      // below 820px, so the native window should not prevent that responsive
      // mode from ever being reached.
      minWidth: 760,
      minHeight: 600,
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
    window.on("blur", () => {
      if (folderWatch && !folderWatch.scanning) {
        scheduleWatchSweep(folderWatch, 5_000);
      }
    });
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
    if (photoTetherRuntime) {
      await photoTetherRuntime.stop("Workspace changed.", { preserveSession: true });
    }
    // EIPC-02: forget the previous workspace's media/shell trust before the new
    // workspace's state is granted (decorateState re-grants inside invoke), so
    // prior-case access can't leak across a switch.
    clearPathTrust();
    clearPhotoIndexingHeadlessSettingsCache();
  }
  grantPathsFromBackendRequest(request.command, request.params);
  try {
    if (request.command === "set_workspace") stopMcpHttpServer();
    const result = request.command === "set_workspace"
      ? await backend.restartForWorkspace(request.params.path)
      : await backend.invoke(request.command, request.params);
    if (["photo_library_settings", "save_photo_library_settings"].includes(request.command)) {
      cachePhotoIndexingHeadlessSettings(result);
    }
    if (request.command === "set_workspace") {
      stopFolderWatch("Workspace changed.");
      workspaceLockEnabled = pathAvailable(workspaceLockFilePath(result?.workspace));
      workspaceLockUnlocked = !workspaceLockEnabled;
      workspaceLockWorkspace = path.resolve(result?.workspace || activeWorkspacePath());
      workspaceLockInitialized = true;
      if (result?.workspace) {
        app.addRecentDocument(result.workspace);
      }
      if (isWorkspaceLocked()) {
        return redactLockedState(result);
      }
      void ensurePhotoTetherRuntime().resumePersisted();
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

ipcMain.handle("photo-indexing-runtime:get-status", async (event) => {
  assertTrustedSender(event);
  let settings = photoIndexingHeadlessSettingsCache;
  if (!settings && backend && !isWorkspaceLocked()) {
    try {
      settings = cachePhotoIndexingHeadlessSettings(await backend.invoke("photo_library_settings", {}));
    } catch {
      settings = null;
    }
  }
  return {
    ...photoIndexingHeadlessRuntimePolicy(settings || {}),
    schedulerEnabled: process.env.CROSSAGE_DISABLE_PHOTO_INDEXING_HEADLESS !== "1",
    running: photoIndexingHeadlessRunning,
    checkedAt: new Date().toISOString()
  };
});

ipcMain.handle("photos:get-sources", async (event) => {
  assertTrustedSender(event);
  return await systemPhotoSources();
});

ipcMain.handle("connectors:list", async (event) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before reading connector configuration.");
  }
  const backendCatalog = await backend.invoke("inbound_connector_catalog", {});
  return {
    encryptionAvailable: inboundConnectorVault.encryptionAvailable(),
    credentials: inboundConnectorVault.list(),
    catalog: backendCatalog?.value || backendCatalog || {},
  };
});

ipcMain.handle("connectors:save", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Inbound connector payload");
  assertPlainObject(payload.config || {}, "Inbound connector config");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before configuring a connector.");
  }
  const saved = inboundConnectorVault.save(payload);
  const config = inboundConnectorVault.load(saved.provider, saved.connectionId);
  const configured = await backend.invoke("configure_inbound_connector", config);
  auditDesktopAction({
    action: "inbound_connector_saved",
    provider: saved.provider,
    connectionIdHash: crypto.createHash("sha256").update(saved.connectionId).digest("hex").slice(0, 16),
  });
  return { ...saved, configured: configured?.value || configured || {} };
});

ipcMain.handle("connectors:remove", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Inbound connector removal payload");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before removing a connector.");
  }
  const provider = String(payload.provider || "").trim();
  const connectionId = String(payload.connectionId || "").trim();
  await backend.invoke("forget_inbound_connector", { provider, connectionId });
  const removed = inboundConnectorVault.remove(provider, connectionId);
  auditDesktopAction({
    action: "inbound_connector_removed",
    provider: removed.provider,
    connectionIdHash: crypto.createHash("sha256").update(removed.connectionId).digest("hex").slice(0, 16),
  });
  return removed;
});

ipcMain.handle("connectors:invoke", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Inbound connector invocation payload");
  assertPlainObject(payload.params || {}, "Inbound connector invocation params");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before using a connector.");
  }
  const action = String(payload.action || "").trim().toLowerCase();
  const commands = {
    preview: "preview_inbound_connector",
    import: "import_inbound_connector",
    sync: "sync_inbound_connector",
  };
  const command = commands[action];
  if (!command) {
    throw createAppError("E-CONNECTOR-ACTION", "Connector action must be preview, import, or sync.");
  }
  const config = inboundConnectorVault.load(payload.provider, payload.connectionId);
  const configuredResult = await backend.invoke("configure_inbound_connector", config);
  const configured = configuredResult?.value || configuredResult || {};
  const libraryPath = configured?.library?.path || configured?.source?.rootPath || "";
  const params = {
    ...payload.params,
    provider: config.provider,
    connectionId: config.connectionId,
    libraryPath,
  };
  return backend.invoke(command, params);
});

function photoCatalogCancelMarkerPath() {
  return path.join(activeWorkspacePath(), ".photo-catalog-cancel");
}

async function invokeCancellablePhotoCatalog(command, params) {
  if (activePhotoCatalogCancelToken) {
    throw createAppError("E-PHOTO-CATALOG-BUSY", "Another catalog transfer is still running.");
  }
  const token = crypto.randomBytes(24).toString("hex");
  const marker = photoCatalogCancelMarkerPath();
  activePhotoCatalogCancelToken = token;
  try {
    await fs.promises.unlink(marker).catch(() => {});
    return await backend.invoke(command, { ...params, cancelToken: token });
  } finally {
    if (activePhotoCatalogCancelToken === token) activePhotoCatalogCancelToken = "";
    await fs.promises.unlink(marker).catch(() => {});
  }
}

ipcMain.handle("photo-catalog:status", async (event) => {
  assertTrustedSender(event);
  requireUnlockedPhotoPortability();
  return backend.invoke("photo_catalog_status", {});
});

ipcMain.handle("photo-catalog:inspect", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open catalog inspection payload");
  requireUnlockedPhotoPortability();
  const catalogPath = grantedPhotoPortabilityPath(payload.catalogPath, "a Vintrace open catalog", { required: true });
  return invokeCancellablePhotoCatalog("inspect_open_photo_catalog", {
    catalogPath,
    verifyMedia: payload.verifyMedia !== false,
  });
});

ipcMain.handle("photo-catalog:export", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open catalog export payload");
  requireUnlockedPhotoPortability();
  const destination = grantedPhotoPortabilityPath(payload.destination, "an export folder", { required: true });
  const result = await invokeCancellablePhotoCatalog("export_open_photo_catalog", {
    destination,
    includeOriginals: !Boolean(payload.metadataOnly),
    includeSidecars: payload.includeSidecars !== false,
    name: String(payload.name || "").trim().slice(0, 120),
  });
  auditDesktopAction({ action: "open_photo_catalog_exported", metadataOnly: Boolean(payload.metadataOnly) });
  return result;
});

ipcMain.handle("photo-catalog:import", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open catalog import payload");
  requireUnlockedPhotoPortability();
  const catalogPath = grantedPhotoPortabilityPath(payload.catalogPath, "a Vintrace open catalog", { required: true });
  const managedRoot = grantedPhotoPortabilityPath(payload.managedRoot, "the managed library folder");
  const result = await invokeCancellablePhotoCatalog("import_open_photo_catalog", {
    catalogPath,
    ...(managedRoot ? { managedRoot } : {}),
    mergeByHash: payload.mergeByHash !== false,
    verifyMedia: payload.verifyMedia !== false,
  });
  auditDesktopAction({ action: "open_photo_catalog_imported", mergeByHash: payload.mergeByHash !== false });
  return result;
});

ipcMain.handle("photo-catalog:cancel", async (event) => {
  assertTrustedSender(event);
  requireUnlockedPhotoPortability();
  const token = activePhotoCatalogCancelToken;
  if (!token) return { cancelRequested: false };
  const marker = photoCatalogCancelMarkerPath();
  const temporary = `${marker}.partial-${token}`;
  await fs.promises.mkdir(path.dirname(marker), { recursive: true });
  try {
    await fs.promises.writeFile(temporary, token, { encoding: "ascii", mode: 0o600, flag: "wx" });
    await fs.promises.rename(temporary, marker);
  } finally {
    await fs.promises.unlink(temporary).catch(() => {});
  }
  auditDesktopAction({ action: "open_photo_catalog_cancel_requested" });
  return { cancelRequested: true };
});

ipcMain.handle("photo-dam:status", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "DAM catalog status payload");
  requireUnlockedPhotoPortability();
  const provider = damCatalogProvider(payload.provider);
  return backend.invoke("dam_catalog_status", { provider });
});

ipcMain.handle("photo-dam:list", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "DAM catalog discovery payload");
  requireUnlockedPhotoPortability();
  const provider = damCatalogProvider(payload.provider);
  return backend.invoke("list_dam_catalogs", { provider });
});

for (const [channel, command] of [
  ["photo-dam:preview", "preview_dam_catalog"],
  ["photo-dam:import", "import_dam_catalog"],
  ["photo-dam:sync", "sync_dam_catalog"],
]) {
  ipcMain.handle(channel, async (event, payload = {}) => {
    assertTrustedSender(event);
    requireUnlockedPhotoPortability();
    const params = validatedDamCatalogPayload(payload, { requireLibraryPath: true });
    const result = await backend.invoke(command, params);
    auditDesktopAction({
      action: `dam_catalog_${command === "preview_dam_catalog" ? "previewed" : command === "import_dam_catalog" ? "imported" : "synced"}`,
      provider: params.provider,
    });
    return result;
  });
}

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

ipcMain.handle("workspace-encryption:get-status", async (event) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before reading encryption status.");
  }
  const status = await backend.invoke("workspace_encryption_status", {});
  let recovery = { configured: false, pendingCovered: true };
  try { recovery = workspaceRecoveryStatus({ workspace: activeWorkspacePath() }); } catch { /* environment-managed key */ }
  return { ...status, recoveryConfigured: recovery.configured, recoveryPendingCovered: recovery.pendingCovered };
});

ipcMain.handle("workspace-encryption:create-recovery-code", async (event) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before creating a recovery code.");
  }
  const workspace = activeWorkspacePath();
  const status = await backend.invoke("workspace_encryption_status", {});
  const recoveryCode = crypto.randomBytes(32).toString("base64url");
  configureWorkspaceRecoveryPassphrase({ workspace, passphrase: recoveryCode, safeStorage, env: process.env });
  auditDesktopAction({ action: "workspace_recovery_code_replaced", keyId: status?.database?.keyId || status?.keyId || "" });
  return {
    recoveryCode,
    status: { ...status, recoveryConfigured: true, recoveryPendingCovered: true },
  };
});

ipcMain.handle("workspace-encryption:rotate-key", async (event) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before rotating its encryption key.");
  }
  stopMcpHttpServer();
  const result = await backend.rotateWorkspaceDatabaseKey();
  auditDesktopAction({
    action: "workspace_database_key_rotated",
    oldKeyId: result?.rotation?.oldKeyId || "",
    newKeyId: result?.rotation?.newKeyId || "",
  });
  let recovery = { configured: false, pendingCovered: true };
  try { recovery = workspaceRecoveryStatus({ workspace: activeWorkspacePath() }); } catch { /* environment-managed key */ }
  return { ...result, recoveryConfigured: recovery.configured, recoveryPendingCovered: recovery.pendingCovered };
});

// ---------------------------------------------------------------------------
// AI Agents (MCP) — powers Settings > AI Agents. Generates auto-filled connect
// configs (from the app's own resolved paths), can add the server to Codex, can
// reveal/build the Claude Desktop bundle, and can run a managed localhost-only
// MCP HTTP server for agent-SDK/HTTP clients.
// ---------------------------------------------------------------------------
let mcpHttpChild = null;
let mcpHttpStatus = { running: false, url: "", host: MCP_HTTP_HOST, port: MCP_HTTP_PORT, token: "", error: "" };

function mobileCompanionConfigPath() {
  return path.join(app.getPath("userData"), "mobile-companion.json");
}

function configuredMobilePublicUrl() {
  const environmentUrl = String(
    process.env.VINTRACE_MOBILE_PUBLIC_URL
    || process.env.CROSSAGE_MOBILE_PUBLIC_URL
    || "",
  ).trim();
  const persistedUrl = String(readJsonObject(mobileCompanionConfigPath()).publicUrl || "").trim();
  const value = environmentUrl || persistedUrl || `http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}`;
  const endpoint = normalizeMobilePublicUrl(value);
  return {
    ...endpoint,
    source: environmentUrl ? "environment" : persistedUrl ? "saved" : "default",
  };
}

function mobileCompanionStatus() {
  const endpoint = configuredMobilePublicUrl();
  const workspace = activeWorkspacePath();
  const devices = listMobileCompanions({ workspace });
  const localDevelopment = endpoint.loopback && (
    isDev
    || process.env.VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK === "1"
    || process.env.CROSSAGE_MOBILE_ALLOW_INSECURE_LOOPBACK === "1"
  );
  return {
    publicUrl: endpoint.origin,
    appUrl: `${endpoint.origin}/mobile/`,
    secure: endpoint.secure,
    loopback: endpoint.loopback,
    source: endpoint.source,
    canEditEndpoint: endpoint.source !== "environment",
    readyForPairing: endpoint.secure || localDevelopment,
    serverRunning: Boolean(mcpHttpStatus.running),
    devices,
  };
}

function saveMobileCompanionPublicUrl(value) {
  const endpoint = normalizeMobilePublicUrl(value);
  writeJsonAtomic(mobileCompanionConfigPath(), {
    version: 1,
    publicUrl: endpoint.origin,
    updatedAt: new Date().toISOString(),
  });
  return mobileCompanionStatus();
}

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

function probeMcpHttpServer({ host, port, token }) {
  return new Promise((resolve) => {
    const request = nodeHttp.request({
      host,
      port,
      path: "/v1/health",
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      timeout: 600,
    }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.end();
  });
}

function mcpHttpExitMessage(stderrTail, code, port, becameReady = false) {
  if (/address already in use|eaddrinuse/i.test(stderrTail)) {
    return `Local agent server could not start because port ${port} is already in use. Stop the other service and try again.`;
  }
  if (becameReady) {
    return `Local agent server stopped unexpectedly${code ? ` (code ${code})` : ""}. Try starting it again.`;
  }
  if (code) {
    return `Local agent server exited before it became ready (code ${code}). Try starting it again.`;
  }
  return "Local agent server could not start. Try starting it again.";
}

async function startMcpHttpServer() {
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
  let keyEnv = process.env;
  if (
    process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1"
    && !process.env.VINTRACE_WORKSPACE_DB_KEY
    && !workspaceLockSupported()
  ) {
    const testKey = crypto.createHash("sha256")
      .update(`vintrace-e2e-workspace-key-v1\0${invocation.workspace}\0${app.getPath("userData")}`)
      .digest("base64url");
    keyEnv = { ...process.env, VINTRACE_WORKSPACE_DB_KEY: testKey };
  }
  let workspaceKeys;
  try {
    workspaceKeys = resolveDesktopWorkspaceKeys({ workspace: invocation.workspace, safeStorage, env: keyEnv });
  } catch (error) {
    throw createAppError(String(error?.code || "E-WORKSPACE-KEY"), error instanceof Error ? error.message : String(error));
  }
  // MCP-01: the streamable-HTTP transport fails closed unless an auth token is
  // present; clients must present it as a Bearer token. Generate a fresh
  // per-session token and surface it to the operator.
  const token = crypto.randomBytes(24).toString("hex");
  const mobileAccountsPath = ensureMobileCredentialFile({ workspace: invocation.workspace });
  const mobileEndpoint = configuredMobilePublicUrl();
  const env = {
    ...process.env,
    ...invocation.env,
    VINTRACE_MCP_TOKEN: token,
    VINTRACE_MOBILE_ACCOUNTS_FILE: mobileAccountsPath,
    VINTRACE_WORKSPACE_DB_KEY: workspaceKeys.primaryEncoded,
    VINTRACE_WORKSPACE_DB_PREVIOUS_KEY: workspaceKeys.previousEncoded,
    [WORKSPACE_REQUIRE_ENCRYPTION_ENV]: "1",
  };
  if (mobileEndpoint.loopback && (
    isDev
    || process.env.VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK === "1"
    || process.env.CROSSAGE_MOBILE_ALLOW_INSECURE_LOOPBACK === "1"
  )) {
    env.VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK = "1";
  } else {
    delete env.VINTRACE_MOBILE_ALLOW_INSECURE_LOOPBACK;
    delete env.CROSSAGE_MOBILE_ALLOW_INSECURE_LOOPBACK;
  }
  delete env[WORKSPACE_RECOVERY_PASSPHRASE_ENV];
  workspaceKeys.primaryKey.fill(0);
  workspaceKeys.previousKey?.fill(0);
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
    mcpHttpStatus = { running: false, url: "", host, port, token: "", error: "" };
    let stderrTail = "";
    let exited = false;
    let becameReady = false;
    child.stderr.on("data", (chunk) => { stderrTail = `${stderrTail}${chunk}`.slice(-4000); });
    child.on("error", (error) => {
      exited = true;
      if (mcpHttpChild === child) mcpHttpChild = null;
      mcpHttpStatus = {
        running: false,
        url: "",
        host,
        port,
        token: "",
        error: /eaddrinuse/i.test(String(error?.message || ""))
          ? `Local agent server could not start because port ${port} is already in use. Stop the other service and try again.`
          : "Local agent server could not start. Try starting it again.",
      };
      broadcastMcpHttpStatus();
    });
    child.on("exit", (code) => {
      exited = true;
      if (mcpHttpChild !== child) return;
      mcpHttpChild = null;
      const failed = Boolean(code && code !== 0);
      mcpHttpStatus = {
        running: false,
        url: "",
        host,
        port,
        token: "",
        error: failed ? mcpHttpExitMessage(stderrTail, code, port, becameReady) : "",
      };
      broadcastMcpHttpStatus();
    });
    const deadline = Date.now() + 15_000;
    while (!exited && mcpHttpChild === child && Date.now() < deadline) {
      if (await probeMcpHttpServer({ host, port, token })) {
        if (exited || mcpHttpChild !== child) break;
        becameReady = true;
        mcpHttpStatus = { running: true, url: `http://${host}:${port}/mcp`, host, port, token, error: "" };
        broadcastMcpHttpStatus();
        return { ...mcpHttpStatus };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!exited && mcpHttpChild === child) {
      try { child.kill(); } catch { /* already gone */ }
      mcpHttpChild = null;
      mcpHttpStatus = {
        running: false,
        url: "",
        host,
        port,
        token: "",
        error: "Local agent server did not become ready within 15 seconds. Try starting it again.",
      };
      broadcastMcpHttpStatus();
    }
  } catch (error) {
    mcpHttpChild = null;
    mcpHttpStatus = { running: false, url: "", host, port, token: "", error: "Local agent server could not start. Try starting it again." };
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

ipcMain.handle("mobile-companion:status", async (event) => {
  assertTrustedSender(event);
  return mobileCompanionStatus();
});

ipcMain.handle("mobile-companion:configure", async (event, payload = {}) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before configuring mobile access.");
  }
  return saveMobileCompanionPublicUrl(String(payload?.publicUrl || ""));
});

ipcMain.handle("mobile-companion:create", async (event, payload = {}) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before pairing a mobile device.");
  }
  const current = mobileCompanionStatus();
  if (!current.readyForPairing) {
    throw createAppError(
      "E-MOBILE-HTTPS",
      "Configure a trusted HTTPS mobile endpoint before creating a real-device pairing link.",
    );
  }
  if (!mcpHttpStatus.running) {
    const started = await startMcpHttpServer();
    if (!started.running) {
      throw createAppError("E-MOBILE-SERVER", started.error || "The mobile companion server could not start.");
    }
  }
  const created = createMobileCompanion({
    workspace: activeWorkspacePath(),
    publicUrl: current.publicUrl,
    label: String(payload?.label || ""),
    expiresInDays: Number(payload?.expiresInDays || 7),
    allowPreviews: payload?.allowPreviews !== false,
  });
  auditDesktopAction({
    action: "mobile_companion_pairing_created",
    principalId: created.device.accountId,
    readOnly: true,
    pixelDisclosureAllowed: created.device.allowPreviews,
    expiresAt: created.device.expiresAt,
  });
  return {
    ok: true,
    device: created.device,
    pairingUrl: created.pairingUrl,
    status: mobileCompanionStatus(),
  };
});

ipcMain.handle("mobile-companion:revoke", async (event, payload = {}) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before revoking mobile access.");
  }
  const device = revokeMobileCompanion({
    workspace: activeWorkspacePath(),
    accountId: String(payload?.accountId || ""),
  });
  auditDesktopAction({
    action: "mobile_companion_revoked",
    principalId: device.accountId,
    readOnly: true,
  });
  return { ok: true, device, status: mobileCompanionStatus() };
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

ipcMain.handle("shell:open-photo-privacy-settings", async (event) => {
  assertTrustedSender(event);
  const target = photoPrivacySettingsUrl(process.platform);
  if (!target) {
    return { ok: false, platform: process.platform, error: "Photo privacy settings are not available on this platform." };
  }
  if (suppressNativeShellOpen) {
    return { ok: true, platform: process.platform, suppressed: true };
  }
  try {
    await shell.openExternal(target);
    auditDesktopAction({ action: "open_photo_privacy_settings", platform: process.platform });
    return { ok: true, platform: process.platform };
  } catch (error) {
    return { ok: false, platform: process.platform, error: String(error?.message || error || "Could not open privacy settings.") };
  }
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
    defaultPath: app.getPath("pictures"),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  grantUserPath(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle("dialog:choose-dam-catalog", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "DAM catalog picker payload");
  const provider = damCatalogProvider(payload.provider);
  const grantPickedCatalog = (filePath) => {
    if (!filePath) return null;
    grantUserPath(filePath);
    let isDir = false;
    try { isDir = fs.statSync(filePath).isDirectory(); } catch { /* backend reports missing catalogs */ }
    return { path: filePath, isDir };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return grantPickedCatalog(selected);
  }
  if (process.env.CROSSAGE_TEST_DIALOG_PATH) {
    return grantPickedCatalog(process.env.CROSSAGE_TEST_DIALOG_PATH);
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: provider === "lightroom_catalog" ? "Choose Lightroom Classic catalog" : "Choose Capture One catalog",
    defaultPath: app.getPath("pictures"),
    properties: ["openFile", "openDirectory"],
    filters: provider === "lightroom_catalog"
      ? [
        { name: "Lightroom catalogs", extensions: ["lrcat"] },
        { name: "All files", extensions: ["*"] },
      ]
      : [
        { name: "Capture One catalogs", extensions: ["cocatalogdb", "db"] },
        { name: "All files", extensions: ["*"] },
      ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return grantPickedCatalog(result.filePaths[0]);
});

ipcMain.handle("dialog:choose-open-photo-catalog", async (event) => {
  assertTrustedSender(event);
  const grantPickedCatalog = (catalogPath) => {
    if (!catalogPath) return null;
    grantUserPath(catalogPath);
    return { path: catalogPath, isDir: true };
  };
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || "";
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    return grantPickedCatalog(selected);
  }
  if (process.env.CROSSAGE_TEST_DIALOG_PATH) {
    return grantPickedCatalog(process.env.CROSSAGE_TEST_DIALOG_PATH);
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Choose Vintrace open catalog",
    defaultPath: app.getPath("documents"),
    properties: ["openDirectory"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return grantPickedCatalog(result.filePaths[0]);
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
    defaultPath: app.getPath("pictures"),
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
    defaultPath: app.getPath("music"),
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
    defaultPath: app.getPath("documents"),
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
    defaultPath: app.getPath("documents"),
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
    defaultPath: app.getPath("documents"),
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
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(filePath, buffer);
  grantUserPath(folder);
  auditDesktopAction({ action: "camera_save_frame", path: filePath });
  return { folder, filePath };
});

ipcMain.handle("scan:cancel", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-cancel");
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.writeFile(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "scan_cancel_requested", path: marker });
  return { cancelled: true, path: marker };
});

ipcMain.handle("media-action:cancel", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".media-action-cancel");
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.writeFile(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "media_action_cancel_requested", path: marker });
  return { cancelled: true, path: marker };
});

ipcMain.handle("scan:pause", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-pause");
  await fs.promises.mkdir(workspace, { recursive: true });
  await fs.promises.writeFile(marker, new Date().toISOString(), "utf8");
  auditDesktopAction({ action: "scan_pause_requested", path: marker });
  return { paused: true, path: marker };
});

ipcMain.handle("scan:resume", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const marker = path.join(workspace, ".scan-pause");
  try {
    await fs.promises.unlink(marker);
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
  const [cancelRequested, paused] = await Promise.all([
    fs.promises.access(cancelPath).then(() => true).catch(() => false),
    fs.promises.access(pausePath).then(() => true).catch(() => false),
  ]);
  return {
    workspace,
    cancelRequested,
    paused,
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

ipcMain.handle("photo-tether:status", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Photo tether status payload");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before reading capture-session data.");
  }
  const runtime = ensurePhotoTetherRuntime();
  await backend.start();
  const result = await runtime.status(Boolean(payload.refreshCamera));
  return publicPhotoTetherPayload(result);
});

ipcMain.handle("photo-tether:start", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Photo tether start payload");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before starting a capture session.");
  }
  const sourcePath = path.resolve(String(payload.sourcePath || payload.destinationPath || ""));
  const destinationPath = path.resolve(String(payload.destinationPath || sourcePath));
  if (!String(payload.sourcePath || payload.destinationPath || "").trim() || !isUserGrantedPath(sourcePath)) {
    throw createAppError("E-PHOTO-TETHER-PATH", "Choose the capture folder in Vintrace before starting tethering.");
  }
  if (!isUserGrantedPath(destinationPath)) {
    throw createAppError("E-PHOTO-TETHER-PATH", "Choose the download folder in Vintrace before starting tethering.");
  }
  if (String(payload.managedRoot || "").trim() && !isUserGrantedPath(path.resolve(String(payload.managedRoot)))) {
    throw createAppError("E-PHOTO-TETHER-PATH", "Choose the managed library folder in Vintrace before starting tethering.");
  }
  const runtime = ensurePhotoTetherRuntime();
  await backend.start();
  const result = await runtime.start(payload);
  appendDiagnosticEvent({
    type: "photo_tether_started",
    level: "info",
    mode: String(result?.mode || payload.mode || "watch"),
    sessionId: String(result?.session?.sessionId || "")
  });
  return publicPhotoTetherPayload(result);
});

ipcMain.handle("photo-tether:stop", async (event) => {
  assertTrustedSender(event);
  const result = await ensurePhotoTetherRuntime().stop();
  appendDiagnosticEvent({ type: "photo_tether_stopped", level: "info", sessionId: String(result?.session?.sessionId || "") });
  return publicPhotoTetherPayload(result);
});

ipcMain.handle("photo-tether:resume", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Photo tether resume payload");
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before resuming a capture session.");
  }
  const sessionId = String(payload.sessionId || "").trim();
  if (!sessionId) throw createAppError("E-BACKEND-VALIDATION", "Choose a capture session to resume.");
  const runtime = ensurePhotoTetherRuntime();
  await backend.start();
  const result = await runtime.resume(sessionId);
  return publicPhotoTetherPayload(result);
});

ipcMain.handle("photo-tether:capture", async (event) => {
  assertTrustedSender(event);
  if (isWorkspaceLocked()) {
    throw createAppError("E-WORKSPACE-LOCKED", "Unlock this app folder before capturing from a camera.");
  }
  const result = await ensurePhotoTetherRuntime().capture();
  return publicPhotoTetherPayload(result);
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
    await ensurePhotoTetherRuntime().resumePersisted();
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
  stopBackendJsonParserWorker();
  stopPhotoIndexingHeadlessScheduler();
  stopFolderWatch("App quitting.", { persist: false });
  if (photoTetherRuntime) {
    void photoTetherRuntime.stop("App quitting.", { preserveSession: true });
  }
  stopMcpHttpServer();
  if (backend) {
    backend.stop();
  }
});

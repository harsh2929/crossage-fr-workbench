"use strict";

const assert = require("assert");
const esbuild = require("esbuild");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const appLocalStateSource = fs.readFileSync(path.join(root, "src", "appLocalState.ts"), "utf8");
const appToolStateSource = fs.readFileSync(path.join(root, "src", "appToolState.ts"), "utf8");
const appFolderTreeStateSource = fs.readFileSync(path.join(root, "src", "appFolderTreeState.ts"), "utf8");
const appRuntimeStateSource = fs.readFileSync(path.join(root, "src", "appRuntimeState.ts"), "utf8");
const appStorageOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-storage-diagnostics-")), "appStorageDiagnostics.cjs");
const appSettingsOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-")), "appSettings.cjs");
const appLocalStateOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-local-state-")), "appLocalState.cjs");
const bridgeOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-bridge-validation-")), "bridgeValidation.cjs");
const i18nOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-i18n-")), "i18n.cjs");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "appStorageDiagnostics.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: appStorageOutFile,
});
const appStorageDiagnostics = require(appStorageOutFile);
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "appSettings.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: appSettingsOutFile,
});
const appSettings = require(appSettingsOutFile);
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "appLocalState.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: appLocalStateOutFile,
});
const appLocalState = require(appLocalStateOutFile);
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "bridgeValidation.ts")],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: bridgeOutFile,
});
const bridgeValidation = require(bridgeOutFile);
esbuild.buildSync({
  entryPoints: [path.join(root, "src", "i18n.ts")],
  bundle: true,
  define: { "import.meta.env": JSON.stringify({ DEV: true }) },
  format: "cjs",
  platform: "node",
  outfile: i18nOutFile,
});
const i18n = require(i18nOutFile);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

function sliceBalancedFunction(sourceText, marker) {
  const start = sourceText.indexOf(marker);
  assert.ok(start >= 0, `missing ${marker}`);
  const open = sourceText.indexOf("{", start);
  assert.ok(open > start, `missing body for ${marker}`);
  let depth = 0;
  for (let index = open; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  assert.fail(`unterminated ${marker}`);
}

function countUseStateCalls(sourceText) {
  return (sourceText.match(/useState\s*(?:<|\()/g) || []).length;
}

const appComponentSource = sliceBalancedFunction(source, "export default function App()");

run("wrapped invoke applies piggybacked state once", () => {
  const invokeStart = source.indexOf("  async function invoke<T = unknown>");
  assert.ok(invokeStart >= 0, "missing App invoke wrapper");
  const invokeEnd = source.indexOf("\n  // Stable identities", invokeStart);
  assert.ok(invokeEnd > invokeStart, "missing invoke wrapper end marker");
  const invokeBlock = source.slice(invokeStart, invokeEnd);
  assert.match(invokeBlock, /const maybeCommand = result as CommandResult;/);
  assert.match(invokeBlock, /const nextState = maybeCommand\.state \? \(maybeCommand\.state as AppState\) : maybeState\.counts \? maybeState : null;/);
  assert.match(invokeBlock, /if \(nextState && sendSeq >= ipcAppliedSeqRef\.current\) \{[\s\S]*?ipcAppliedSeqRef\.current = sendSeq;[\s\S]*?applyState\(nextState\);[\s\S]*?\}/);
});

run("wrapped invoke handlers do not reapply result.state", () => {
  const matches = [...source.matchAll(/applyState\(result\.state\)/g)];
  assert.strictEqual(matches.length, 1, "only the direct preview warmup call may apply result.state manually");
  const warmupBlock = source.slice(source.indexOf("async function warmPreviewCache"), source.indexOf("  function copyPerformanceReport"));
  assert.ok(warmupBlock.includes("await window.crossAge.invoke<CommandResult>(\"prepare_previews\""));
  assert.ok(warmupBlock.includes("applyState(result.state);"));
});

run("applyState normalizes against the latest applied state ref", () => {
  assert.match(source, /const appStateRef = useRef<AppState \| null>\(null\);/);
  const applyStart = source.indexOf("  function applyState(rawNext: AppState) {");
  assert.ok(applyStart >= 0, "missing applyState");
  const applyEnd = source.indexOf("  function updateSettingsDraft", applyStart);
  assert.ok(applyEnd > applyStart, "missing applyState end marker");
  const applyBlock = source.slice(applyStart, applyEnd);
  assert.match(applyBlock, /const previous = appStateRef\.current;/);
  assert.match(applyBlock, /const next = normalizeAppState\(rawNext, previous\);/);
  assert.match(applyBlock, /const previousWorkspace = previous\?\.workspace \|\| "";/);
  assert.match(applyBlock, /appStateRef\.current = next;[\s\S]*setState\(next\);/);
  assert.doesNotMatch(applyBlock, /normalizeAppState\(rawNext, state\)/);
  assert.doesNotMatch(applyBlock, /lastAppliedWorkspaceRef/);
  const startupBlock = source.slice(source.indexOf("async function loadInitialState"), applyStart);
  assert.match(startupBlock, /normalizeAppState\(next, appStateRef\.current\)/);
});

run("boot splash clock is scoped to BootScreen", () => {
  const bootStart = source.indexOf("function BootScreen(");
  const appStart = source.indexOf("export default function App()");
  assert.ok(bootStart >= 0, "missing BootScreen component");
  assert.ok(appStart > bootStart, "BootScreen should live outside App");
  const bootBlock = source.slice(bootStart, appStart);
  assert.match(bootBlock, /const \[bootClock, setBootClock\] = useState\(\(\) => Date\.now\(\)\);/);
  assert.match(bootBlock, /window\.setInterval\(\(\) => setBootClock\(Date\.now\(\)\), 1000\)/);
  assert.match(bootBlock, /initBootBackground\(canvas, root\)/);

  const appPrelude = source.slice(appStart, source.indexOf("async function loadInitialState", appStart));
  assert.doesNotMatch(appPrelude, /setBootClock/);
  assert.doesNotMatch(appPrelude, /bootCanvasRef/);
  assert.doesNotMatch(appPrelude, /initBootBackground/);

  const loadingStart = source.indexOf("  if (!state) {", appStart);
  assert.ok(loadingStart > appStart, "missing loading return");
  const loadingEnd = source.indexOf("  const navMeta", loadingStart);
  assert.ok(loadingEnd > loadingStart, "missing loading return end marker");
  const loadingBlock = source.slice(loadingStart, loadingEnd);
  assert.match(loadingBlock, /<BootScreen[\s\S]*bootStartedAt=\{bootStartedAt\}[\s\S]*onRetry=\{loadInitialState\}/);
  assert.doesNotMatch(loadingBlock, /bootClock/);
  assert.doesNotMatch(loadingBlock, /bootCanvasRef/);
});

run("external event handler refs update after commit", () => {
  assert.strictEqual((source.match(/appCommandHandlerRef\.current = handleAppCommand/g) || []).length, 1);
  assert.strictEqual((source.match(/externalOpenHandlerRef\.current = handleExternalOpen/g) || []).length, 1);
  const effectStart = source.indexOf("  // External IPC should only observe handlers from committed renders.");
  assert.ok(effectStart >= 0, "missing external handler ref effect");
  const effectEnd = source.indexOf("  function startReferenceFix", effectStart);
  assert.ok(effectEnd > effectStart, "missing external handler ref effect end marker");
  const effectBlock = source.slice(effectStart, effectEnd);
  assert.match(effectBlock, /useEffect\(\(\) => \{[\s\S]*appCommandHandlerRef\.current = handleAppCommand;[\s\S]*externalOpenHandlerRef\.current = handleExternalOpen;[\s\S]*\}\);/);
  assert.doesNotMatch(effectBlock, /synchronously during render/);
});

run("review page query signature excludes changing counts", () => {
  const signatureStart = source.indexOf("  const querySignature = useMemo(() => JSON.stringify({");
  assert.ok(signatureStart >= 0, "missing review query signature");
  const signatureEnd = source.indexOf("  async function loadCandidatePage", signatureStart);
  assert.ok(signatureEnd > signatureStart, "missing review query signature end marker");
  const signatureBlock = source.slice(signatureStart, signatureEnd);
  assert.ok(signatureBlock.includes("workspace: props.state.workspaceMetadata?.workspaceId ?? props.state.workspace"));
  assert.ok(signatureBlock.includes("statusFilter"));
  assert.ok(signatureBlock.includes("reviewLane"));
  assert.ok(signatureBlock.includes("search: deferredSearch.trim()"));
  assert.ok(signatureBlock.includes("sort"));
  assert.ok(signatureBlock.includes("pageSize"));
  assert.ok(!signatureBlock.includes("candidateCount"));
  assert.ok(!signatureBlock.includes("pendingCount"));
  assert.ok(!signatureBlock.includes("props.state.counts.candidates"));
  assert.ok(!signatureBlock.includes("props.state.counts.pending"));
});

run("storage diagnostics redact scoped keys and dispatch deduped warnings", () => {
  const warnings = [];
  const events = [];
  const originalWarn = console.warn;
  const originalWindow = global.window;
  const originalCustomEvent = global.CustomEvent;

  class TestCustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  console.warn = (...args) => warnings.push(args.join(" "));
  global.CustomEvent = TestCustomEvent;
  global.window = {
    dispatchEvent(event) {
      events.push(event);
      return true;
    },
  };

  try {
    appStorageDiagnostics.clearAppStorageDiagnosticsForTest();
    const first = appStorageDiagnostics.recordAppStorageIssue(
      "scanQueue",
      "read",
      "vintrace:scan-queue:/Users/jane/Pictures/family",
      new Error("Quota denied at /Users/jane/Pictures/family"),
      1_000
    );
    const duplicate = appStorageDiagnostics.recordAppStorageIssue(
      "scanQueue",
      "read",
      "vintrace:scan-queue:/Users/jane/Pictures/family",
      new Error("Quota denied at /Users/jane/Pictures/family"),
      2_000
    );
    const later = appStorageDiagnostics.recordAppStorageIssue(
      "scanQueue",
      "read",
      "vintrace:scan-queue:/Users/jane/Pictures/family",
      new Error("Quota denied at /Users/jane/Pictures/family"),
      62_000
    );

    assert.strictEqual(first.key, "vintrace:scan-queue:<scope>");
    assert.ok(!JSON.stringify(first).includes("/Users/jane"), first);
    assert.strictEqual(duplicate, null);
    assert.ok(later);
    assert.strictEqual(appStorageDiagnostics.getAppStorageDiagnostics().length, 2);
    assert.strictEqual(events.length, 2);
    assert.strictEqual(warnings.length, 2);
    assert.match(appStorageDiagnostics.appStorageIssueNoticeText(first), /loading scan queue/);
  } finally {
    console.warn = originalWarn;
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
    if (originalCustomEvent === undefined) {
      delete global.CustomEvent;
    } else {
      global.CustomEvent = originalCustomEvent;
    }
    appStorageDiagnostics.clearAppStorageDiagnosticsForTest();
  }
});

run("app localStorage helpers report failures instead of silent fallbacks", () => {
  assert.match(source, /from "\.\/appLocalState";/);
  assert.match(appLocalStateSource, /recordAppStorageIssue\("scanQueue", "read"/);
  assert.match(appLocalStateSource, /recordAppStorageIssue\("scanQueue", "write"/);
  assert.match(appLocalStateSource, /recordAppStorageIssue\("savedScanSources", "read"/);
  assert.match(appLocalStateSource, /recordAppStorageIssue\("savedReviewViews", "write"/);
  assert.match(source, /window\.addEventListener\(APP_STORAGE_ISSUE_EVENT, handleStorageIssue\)/);
});

run("app persisted scan and review state is extracted from App", () => {
  assert.doesNotMatch(source, /function readScanQueue/);
  assert.doesNotMatch(source, /function readSavedScanSources/);
  assert.doesNotMatch(source, /function readSavedReviewViews/);
  assert.match(appLocalStateSource, /export function normalizeScanQueue/);
  assert.match(appLocalStateSource, /export function normalizeSavedReviewViews/);
});

run("App tool result state lives outside the main component", () => {
  assert.match(source, /useAppToolPanelState\(\)/);
  assert.doesNotMatch(source, /const \[backupVerification, setBackupVerification\] = useState/);
  assert.doesNotMatch(source, /const \[runtimeSelfTest, setRuntimeSelfTest\] = useState/);
  assert.doesNotMatch(source, /const \[latencySamples, setLatencySamples\] = useState/);
  assert.match(appToolStateSource, /export function useAppToolPanelState\(\)/);
  assert.match(appToolStateSource, /const \[backupVerification, setBackupVerification\] = useState/);
  assert.match(appToolStateSource, /const \[latencySamples, setLatencySamples\] = useState/);
});

run("App folder tree picker state lives outside the main component", () => {
  assert.match(source, /from "\.\/appFolderTreeState";/);
  assert.strictEqual((source.match(/useFolderTreeSelectionState\(/g) || []).length, 2);
  assert.match(source, /useFolderTreeSelectionState\(scanFolder\)/);
  assert.match(source, /useFolderTreeSelectionState\(enrollFolder\)/);
  assert.doesNotMatch(source, /const \[scanFolderTree, setScanFolderTree\] = useState/);
  assert.doesNotMatch(source, /const \[enrollFolderTree, setEnrollFolderTree\] = useState/);
  assert.doesNotMatch(source, /setScanFolderTree\(null\);/);
  assert.doesNotMatch(source, /setEnrollFolderTree\(null\);/);

  assert.match(appFolderTreeStateSource, /export function useFolderTreeSelectionState\(folder: string\)/);
  assert.match(appFolderTreeStateSource, /const \[folderTree, setFolderTree\] = useState<FolderTree \| null>\(null\);/);
  assert.match(appFolderTreeStateSource, /const \[excludedDirs, setExcludedDirs\] = useState<Set<string>>\(\(\) => new Set\(\)\);/);
  assert.match(appFolderTreeStateSource, /useEffect\(\(\) => \{[\s\S]*setFolderTree\(null\);[\s\S]*setError\(null\);[\s\S]*setExcludedDirs\(new Set<string>\(\)\);[\s\S]*setRecursive\(true\);[\s\S]*\}, \[folder\]\);/);
});

run("App runtime and photo bridge state live outside the main component", () => {
  assert.match(source, /from "\.\/appRuntimeState";/);
  assert.match(appComponentSource, /useAppPhotoBridgeState\(\)/);
  assert.match(appComponentSource, /useAppRuntimeStatusState\(\)/);
  assert.doesNotMatch(appComponentSource, /const \[photoSources, setPhotoSources\] = useState/);
  assert.doesNotMatch(appComponentSource, /const \[photoExternalImportRequest, setPhotoExternalImportRequest\] = useState/);
  assert.doesNotMatch(appComponentSource, /const \[systemIntegration, setSystemIntegration\] = useState/);
  assert.doesNotMatch(appComponentSource, /const \[scanProgress, setScanProgress\] = useState/);
  assert.doesNotMatch(appComponentSource, /const \[folderAnalysis, setFolderAnalysis\] = useState/);
  assert.match(appRuntimeStateSource, /export function useAppPhotoBridgeState\(\)/);
  assert.match(appRuntimeStateSource, /const \[photoSources, setPhotoSources\] = useState<SystemPhotoSource\[\]>\(\[\]\);/);
  assert.match(appRuntimeStateSource, /export function useAppRuntimeStatusState\(\)/);
  assert.match(appRuntimeStateSource, /const \[scanProgress, setScanProgress\] = useState<ScanProgress \| null>\(null\);/);
  assert.match(appRuntimeStateSource, /const \[folderAnalysis, setFolderAnalysis\] = useState<FolderAnalysis \| null>\(null\);/);
});

run("App component direct state count stays below the medium audit threshold", () => {
  assert.ok(countUseStateCalls(appComponentSource) <= 40, `App still has ${countUseStateCalls(appComponentSource)} direct useState calls`);
});

run("app local scan state normalizers cap and repair stored rows", () => {
  const savedRows = [
    { path: "/Users/test/Pictures/family.jpg", createdAt: "bad", lastUsedAt: 2000 },
    { path: "/Users/test/Pictures/archive", label: "Archive", createdAt: 3000 },
    { path: 42, label: "invalid" },
    ...Array.from({ length: 50 }, (_, index) => ({ path: `/overflow/${index}.jpg`, createdAt: index + 1 })),
  ];
  const sources = appLocalState.normalizeSavedScanSources(savedRows, 1000);
  assert.strictEqual(sources.length, 40);
  assert.deepStrictEqual(sources[0], {
    id: "/Users/test/Pictures/family.jpg",
    label: "family.jpg",
    path: "/Users/test/Pictures/family.jpg",
    createdAt: 1000,
    lastUsedAt: 2000,
  });
  assert.strictEqual(sources[1].label, "Archive");

  const queue = appLocalState.normalizeScanQueue([
    { path: "/scan/a", status: "running", createdAt: 0 },
    { path: "/scan/b", status: "surprise", message: "retry later", createdAt: 500 },
    { path: "/scan/c", status: "error", message: 99 },
  ], 1234);
  assert.strictEqual(queue.length, 3);
  assert.strictEqual(queue[0].status, "running");
  assert.strictEqual(queue[0].createdAt, 1234);
  assert.strictEqual(queue[1].status, "queued");
  assert.strictEqual(queue[1].message, "retry later");
  assert.ok(!("message" in queue[2]));
  assert.strictEqual(appLocalState.savedScanSourcesKey("/workspace"), "vintrace:scan-sources:/workspace");
  assert.strictEqual(appLocalState.scanQueueKey(null), "vintrace:scan-queue:default");
});

run("app saved review view normalizer caps and validates user-writable rows", () => {
  const longLabel = "L".repeat(80);
  const longSearch = "S".repeat(150);
  const views = appLocalState.normalizeSavedReviewViews([
    {
      label: longLabel,
      statusFilter: "bogus",
      reviewLane: "elsewhere",
      search: longSearch,
      sort: "unknown",
      createdAt: "bad",
    },
    {
      id: "valid",
      label: "High confidence",
      statusFilter: "accepted",
      reviewLane: "high",
      search: "alice",
      sort: "newest",
      createdAt: 2000,
      lastUsedAt: 3000,
    },
    ...Array.from({ length: 30 }, (_, index) => ({ label: `Overflow ${index}`, createdAt: index + 1 })),
  ], 1000);

  assert.strictEqual(views.length, 16);
  assert.strictEqual(views[0].label.length, 60);
  assert.strictEqual(views[0].search.length, 120);
  assert.strictEqual(views[0].statusFilter, "pending");
  assert.strictEqual(views[0].reviewLane, "all");
  assert.strictEqual(views[0].sort, "score");
  assert.strictEqual(views[0].createdAt, 1000);
  assert.deepStrictEqual(views[1], {
    id: "valid",
    label: "High confidence",
    statusFilter: "accepted",
    reviewLane: "high",
    search: "alice",
    sort: "newest",
    createdAt: 2000,
    lastUsedAt: 3000,
  });
  assert.ok(appLocalState.reviewLanes.includes("singleReference"));
  assert.strictEqual(appLocalState.savedReviewViewsKey("workspace-a"), "vintrace:review-views:workspace-a");
});

run("app settings profile logic is extracted from App", () => {
  assert.match(source, /from "\.\/appSettings";/);
  assert.doesNotMatch(source, /function coerceSettingsProfile/);
  assert.doesNotMatch(source, /const settingsPresets: SettingsPreset/);
  assert.doesNotMatch(source, /function settingsValuesEqual/);
});

run("app settings profile import clamps and normalizes hostile values", () => {
  const current = {
    ...appSettings.settingsPresets[0].values,
    modelPack: "antelopev2",
    mode: "recommended",
  };
  const imported = appSettings.coerceSettingsProfile({
    modelPack: 123,
    thresholds: {
      confident: "9",
      likely: "not-a-number",
      relaxedChild: "-1",
      qualityMin: "0.333",
    },
    clusterMinSize: "-5",
    faceDetectorSize: "9999",
    twoPassScan: "no",
    verificationDetectorSize: "64",
    learningMode: "auto-stage",
    safeMode: "off",
    safeModeThreshold: "-1",
    safeModeProfile: 77,
    storageBudgetBytes: String(99 * 1024 * 1024 * 1024 * 1024),
    maxMediaFileBytes: "-10",
    videoDecoder: {
      ffmpegPath: 42,
      ffprobePath: null,
    },
    reviewRules: {
      autoRejectBelow: "2",
      autoUncertainLowQuality: "yes",
      autoRejectLowQualityVideo: "true",
    },
    scanExclusions: {
      dirNames: "node_modules\nNODE_MODULES,dist",
      pathKeywords: ["Private", "private", 99, "Screenshots"],
      extensions: "jpg, JPG, png",
      filePaths: Array.from({ length: 1005 }, (_, index) => `/tmp/${index}.jpg`),
    },
  }, current);

  assert.strictEqual(imported.mode, "custom");
  assert.strictEqual(imported.modelPack, "123");
  assert.deepStrictEqual(imported.thresholds, {
    confident: 1,
    likely: current.thresholds.likely,
    relaxedChild: 0,
    qualityMin: 0.333,
  });
  assert.strictEqual(imported.clusterMinSize, 1);
  assert.strictEqual(imported.faceDetectorSize, 2048);
  assert.strictEqual(imported.twoPassScan, false);
  assert.strictEqual(imported.verificationDetectorSize, 128);
  assert.strictEqual(imported.learningMode, "auto_stage");
  assert.strictEqual(imported.safeMode, false);
  assert.strictEqual(imported.safeModeThreshold, 0);
  assert.strictEqual(imported.safeModeProfile, "77");
  assert.strictEqual(imported.storageBudgetBytes, 10 * 1024 * 1024 * 1024 * 1024);
  assert.strictEqual(imported.maxMediaFileBytes, 0);
  assert.deepStrictEqual(imported.videoDecoder, { ffmpegPath: "42", ffprobePath: "" });
  assert.deepStrictEqual(imported.reviewRules, {
    autoRejectBelow: 1,
    autoUncertainLowQuality: true,
    autoRejectLowQualityVideo: true,
  });
  assert.deepStrictEqual(imported.scanExclusions.dirNames, ["node_modules", "dist"]);
  assert.deepStrictEqual(imported.scanExclusions.pathKeywords, ["Private", "Screenshots"]);
  assert.deepStrictEqual(imported.scanExclusions.extensions, ["jpg", "png"]);
  assert.strictEqual(imported.scanExclusions.filePaths.length, 1000);
});

run("app settings preset inference is unit-testable", () => {
  const recommended = appSettings.settingsPresets.find((preset) => preset.key === "recommended").values;
  assert.strictEqual(appSettings.inferSettingsMode(recommended), "recommended");
  assert.strictEqual(appSettings.settingsValuesEqual(recommended, { ...recommended, safeModeThreshold: recommended.safeModeThreshold + 0.001 }), true);
  assert.strictEqual(appSettings.inferSettingsMode({
    ...recommended,
    thresholds: { ...recommended.thresholds, confident: recommended.thresholds.confident + 0.02 },
  }), "custom");
  assert.deepStrictEqual(appSettings.parseListText("Alpha, alpha\nBeta"), ["Alpha", "Beta"]);
  assert.strictEqual(appSettings.listText(["Alpha", "Beta"]), "Alpha, Beta");
  assert.strictEqual(appSettings.normalizeLearningMode("OFF"), "off");
  assert.strictEqual(appSettings.normalizeLearningMode("AUTO-STAGE"), "auto_stage");
  assert.strictEqual(appSettings.normalizeLearningMode("surprise"), "manual");
});

run("i18n dev diagnostics warn before raw-key fallback", () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    assert.strictEqual(i18n.translate("en", "__missing.translation__", { count: 3 }), "__missing.translation__");
    assert.strictEqual(i18n.formatUiMessage("en", "__missing.ui__", { count: 3 }), "__missing.ui__");
    assert.ok(warnings.some((message) => message.includes("[i18n] missing translation key: __missing.translation__")), warnings);
    assert.ok(warnings.some((message) => message.includes("[i18n] missing UI message key: __missing.ui__")), warnings);
  } finally {
    console.warn = originalWarn;
  }
});

run("renderer boot gate validates the preload bridge shape", () => {
  const mainSource = fs.readFileSync(path.join(root, "src", "main.tsx"), "utf8");
  const validBridge = Object.fromEntries(
    bridgeValidation.REQUIRED_CROSSAGE_METHODS.map((name) => [name, () => undefined])
  );
  validBridge.platform = "darwin";

  assert.deepStrictEqual(bridgeValidation.missingCrossAgeBridgeMembers(validBridge), []);
  assert.strictEqual(bridgeValidation.isCrossAgeBridgeReady(validBridge), true);

  const partialBridge = { invoke: () => undefined, platform: "darwin" };
  const missing = bridgeValidation.missingCrossAgeBridgeMembers(partialBridge);
  assert.ok(missing.includes("getInitialState"), missing);
  assert.ok(missing.includes("onBackendError"), missing);
  assert.strictEqual(bridgeValidation.isCrossAgeBridgeReady(partialBridge), false);

  const malformedBridge = { ...validBridge, invoke: "not a function", platform: 42 };
  const malformedMissing = bridgeValidation.missingCrossAgeBridgeMembers(malformedBridge);
  assert.ok(malformedMissing.includes("invoke"), malformedMissing);
  assert.ok(malformedMissing.includes("platform"), malformedMissing);

  assert.match(mainSource, /import \{ missingCrossAgeBridgeMembers \} from "\.\/bridgeValidation";/);
  assert.match(mainSource, /const missingBridgeMembers = missingCrossAgeBridgeMembers\(\(window as \{ crossAge\?: unknown \}\)\.crossAge\);/);
  assert.match(mainSource, /\} else if \(missingBridgeMembers\.length\) \{/);
});

console.log("\nall app state unit tests passed");

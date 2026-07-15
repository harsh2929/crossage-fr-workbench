"use strict";

// Unit tests for the EIPC-01-extracted main-process helpers. These run in plain
// node (no Electron), which is the whole point of pulling them out of main.cjs.
// Run: node tests/main_util.test.cjs

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const util = require("../desktop/main/util.cjs");
const photoIndexingRuntime = require("../desktop/main/photo-indexing-runtime.cjs");
const updateSecurity = require("../desktop/main/update-security.cjs");

function testJsonAtomicRoundTrip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-util-"));
  const file = path.join(dir, "nested", "state.json");
  util.writeJsonAtomic(file, { a: 1, b: ["x"] });
  assert.deepStrictEqual(util.readJsonObject(file), { a: 1, b: ["x"] });
  // unreadable / non-object -> {}
  assert.deepStrictEqual(util.readJsonObject(path.join(dir, "missing.json")), {});
  fs.writeFileSync(path.join(dir, "arr.json"), "[1,2,3]");
  assert.deepStrictEqual(util.readJsonObject(path.join(dir, "arr.json")), {});
  fs.rmSync(dir, { recursive: true, force: true });
}

function testMediaPathCodec() {
  const p = "/Users/jane/Pictures/evidence/jane.jpg";
  const encoded = util.encodeMediaPath(p);
  assert.ok(!encoded.includes("/"), "base64url must not contain slashes");
  assert.strictEqual(util.decodeMediaPath(encoded), path.resolve(p));
  assert.strictEqual(util.decodeMediaPath("!!!not base64!!!"), util.decodeMediaPath("!!!not base64!!!")); // never throws
}

function testEscapeHtml() {
  assert.strictEqual(util.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.strictEqual(util.escapeHtml(null), "");
}

function testIsSubpath() {
  assert.ok(util.isSubpath("/a/b", "/a/b/c"));
  assert.ok(util.isSubpath("/a/b", "/a/b"));
  assert.ok(!util.isSubpath("/a/b", "/a/c"));
  assert.ok(!util.isSubpath("/a/b", "/a/b/../../x"));
}

function testTimestampSlug() {
  const slug = util.timestampSlug();
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(slug), `unexpected slug: ${slug}`);
}

function testSafeRealpath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-rp-"));
  assert.strictEqual(util.safeRealpath(dir), fs.realpathSync.native(dir));
  assert.strictEqual(util.safeRealpath("/no/such/path/xyz"), "");
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBackendRestartDelay() {
  // EIPC-05: happy path (no failures) must be 0 delay; then capped-exponential.
  assert.strictEqual(util.backendRestartDelayMs(0), 0);
  assert.strictEqual(util.backendRestartDelayMs(1, 500, 30000), 500);
  assert.strictEqual(util.backendRestartDelayMs(2, 500, 30000), 1000);
  assert.strictEqual(util.backendRestartDelayMs(3, 500, 30000), 2000);
  assert.strictEqual(util.backendRestartDelayMs(100, 500, 30000), 30000); // capped
  assert.strictEqual(util.backendRestartDelayMs(-5), 0); // never negative
  assert.strictEqual(util.backendRestartDelayMs("nan"), 0);
}

function testRendererGpuModeDefaultsToProductionAcceleration() {
  assert.strictEqual(util.resolveRendererGpuMode({ platform: "darwin", env: {} }), "hardware");
  assert.strictEqual(util.resolveRendererGpuMode({ platform: "win32", env: {} }), "hardware");
  assert.strictEqual(util.resolveRendererGpuMode({ platform: "linux", env: {} }), "hardware");
  assert.strictEqual(util.resolveRendererGpuMode({ platform: "darwin", env: { CROSSAGE_DISABLE_GPU: "1" } }), "software");
  assert.strictEqual(util.resolveRendererGpuMode({ platform: "darwin", env: { CROSSAGE_ENABLE_GPU: "0" } }), "software");
  assert.strictEqual(util.resolveRendererGpuMode({
    platform: "darwin",
    env: { CROSSAGE_ALLOW_MULTI_INSTANCE: "1" },
  }), "software");
  assert.strictEqual(util.resolveRendererGpuMode({
    platform: "darwin",
    env: { CROSSAGE_ALLOW_MULTI_INSTANCE: "1", CROSSAGE_SHOW_WINDOW: "1" },
  }), "hardware");
  assert.strictEqual(util.resolveRendererGpuMode({
    platform: "darwin",
    env: { CROSSAGE_ALLOW_MULTI_INSTANCE: "1", CROSSAGE_ENABLE_GPU: "1" },
  }), "hardware");
}

function parseCsp(policy) {
  return new Map(policy.split(";").map((part) => {
    const tokens = part.trim().split(/\s+/);
    return [tokens[0], tokens.slice(1)];
  }));
}

function testContentSecurityPolicyAllowsMediaProtocolOnlyForMedia() {
  const policy = util.buildContentSecurityPolicy({ mediaProtocolScheme: "vintrace-media:" });
  const directives = parseCsp(policy);
  assert.deepStrictEqual(directives.get("default-src"), ["'self'"]);
  assert.ok(directives.get("img-src").includes("vintrace-media:"));
  assert.ok(directives.get("media-src").includes("vintrace-media:"));
  assert.ok(directives.get("img-src").includes("data:"));
  assert.ok(directives.get("media-src").includes("blob:"));
  assert.strictEqual(directives.get("object-src").join(" "), "'none'");
  assert.strictEqual(directives.get("frame-src").join(" "), "'none'");
  assert.strictEqual(directives.get("frame-ancestors").join(" "), "'none'");
  assert.ok(!directives.get("script-src").includes("vintrace-media:"));
  assert.ok(!directives.get("connect-src").includes("vintrace-media:"));
  assert.ok(!directives.get("style-src").includes("vintrace-media:"));
  assert.ok(util.buildContentSecurityPolicy({ isDev: true }).includes("script-src 'self' 'unsafe-inline'"));
}

function testPythonBackendStartRaceGuards() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const startBlock = source.slice(source.indexOf("  start() {"), source.indexOf("  _spawn() {"));
  assert.match(startBlock, /if \(this\.readyPromise\) \{\s*return this\.readyPromise;/);
  assert.doesNotMatch(startBlock, /this\.readyPromise && this\.child/);
  assert.match(startBlock, /this\.readyPromise = this\._spawn\(\);[\s\S]*?return this\.readyPromise;/);

  const spawnBlock = source.slice(source.indexOf("  _spawn() {"), source.indexOf("  async invoke("));
  assert.match(spawnBlock, /const generation = \+\+this\.spawnGeneration;/);
  assert.match(spawnBlock, /let stdoutQueue = Promise\.resolve\(\);[\s\S]*?this\.stdoutQueue = stdoutQueue;/);
  assert.match(spawnBlock, /if \(this\.child !== child\) \{\s*return;\s*\}[\s\S]*?Python backend did not become ready in time/);
  assert.match(spawnBlock, /if \(!message \|\| this\.child !== child\) \{\s*return;\s*\}/);
  assert.match(spawnBlock, /const activeChild = this\.child === child;/);
  assert.match(spawnBlock, /this\.rejectPendingForChild\(child, generation, error\);[\s\S]*?this\.readyPromise = null;[\s\S]*?this\.child = null;[\s\S]*?reject\(error\);/);
  assert.match(spawnBlock, /rejectPendingForChild\(child, generation, error\) \{[\s\S]*?if \(pending\.child !== child \|\| pending\.generation !== generation\) \{[\s\S]*?continue;[\s\S]*?\}/);
  assert.match(spawnBlock, /stale: !activeChild/);
}

function testBackendStdinErrorsAreHandled() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const spawnBlock = source.slice(source.indexOf("  _spawn() {"), source.indexOf("  async invoke("));
  assert.match(spawnBlock, /child\.stdin\.on\("error", \(error\) => \{/);
  assert.match(spawnBlock, /type: "backend_stdin_error"/);
  assert.match(spawnBlock, /createAppError\("E-BACKEND-PIPE"/);
  assert.match(spawnBlock, /this\.rejectPendingForChild\(child, generation, pipeError\);[\s\S]*?this\.readyPromise = null;[\s\S]*?this\.readyState = null;[\s\S]*?this\.child = null;/);
}

function testBackendStopEscalatesToSigkill() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const stopBlock = source.slice(source.indexOf("  stop() {"), source.indexOf("\n}\n\nfunction envFlag"));
  assert.match(stopBlock, /child\.kill\("SIGTERM"\)/);
  assert.match(stopBlock, /setTimeout\(\(\) => \{[\s\S]*?child\.kill\("SIGKILL"\);[\s\S]*?\}, 1500\);/);
  assert.match(stopBlock, /this\.child !== child \|\| child\.exitCode !== null \|\| child\.signalCode/);
}

function testPathTrustGenerationGuardsStaleBackendResponses() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const decorateBlock = source.slice(source.indexOf("function decorateState"), source.indexOf("function redactLockedState"));
  const spawnBlock = source.slice(source.indexOf("  _spawn() {"), source.indexOf("  async invoke("));
  const invokeBlock = source.slice(source.indexOf("  async invoke("), source.indexOf("  handleCommandTimeout("));
  const watchBlock = source.slice(source.indexOf("async function flushWatchQueue"), source.indexOf("function startFolderWatch"));
  assert.match(source, /let pathTrustGeneration = 0;/);
  assert.match(source, /function clearPathTrust\(\) \{[\s\S]*?pathTrustGeneration \+= 1;/);
  assert.match(source, /function grantQueryMediaPath\(filePath, trustGeneration = pathTrustGeneration\) \{[\s\S]*?if \(trustGeneration !== pathTrustGeneration\) \{[\s\S]*?return;/);
  assert.match(decorateBlock, /function decorateState\(value, options = \{\}\)/);
  assert.match(decorateBlock, /const trustGeneration = Number\.isInteger\(options\.trustGeneration\) \? options\.trustGeneration : pathTrustGeneration;/);
  assert.match(decorateBlock, /grantQueryMediaPath\(filePath, trustGeneration\);/);
  assert.match(source, /const \{ Worker \} = require\("worker_threads"\);/);
  assert.match(source, /function parseBackendLineInWorker\(line\)/);
  assert.match(source, /function getBackendJsonParserWorker\(\)/);
  assert.match(source, /if \(backendJsonParserWorker\) return backendJsonParserWorker;/);
  assert.match(source, /backendJsonParserPending\.set\(id, \{ resolve, timer \}\)/);
  assert.match(source, /stopBackendJsonParserWorker\(\);/);
  assert.match(source, /if \(text\.length > BACKEND_MAIN_THREAD_PARSE_LIMIT\) \{[\s\S]*?return parseBackendLineInWorker\(text\);/);
  assert.match(source, /function decorateBackendPayload\(value, options = \{\}\)/);
  assert.match(decorateBlock, /const mutate = Boolean\(options\.mutate\);/);
  assert.match(decorateBlock, /const targetObject = \(item\) => \(mutate \? item : \{ \.\.\.item \}\);/);
  assert.match(decorateBlock, /if \(mutate\) \{[\s\S]*?state\.candidates\.forEach\(\(item, index\) => \{[\s\S]*?state\.candidates\[index\] = decorateCandidate\(item\);/);
  assert.match(source, /const largePayload = backendPayloadLooksLarge\(value\);[\s\S]*?return decorateState\(value, \{ \.\.\.options, mutate: largePayload \}\);/);
  assert.match(spawnBlock, /stdoutQueue = stdoutQueue\.then\(async \(\) => \{[\s\S]*?const message = await parseBackendLine\(line\);/);
  assert.match(spawnBlock, /if \(this\.child === child\) \{[\s\S]*?this\.stdoutQueue = stdoutQueue;[\s\S]*?\}/);
  assert.match(spawnBlock, /const progressPending = this\.pending\.get\(message\.id\);[\s\S]*?payload: await decorateBackendPayload\(message\.payload \|\| \{\}, \{[\s\S]*?trustGeneration: progressPending \? progressPending\.trustGeneration : -1/);
  assert.match(spawnBlock, /const result = await decorateBackendPayload\(message\.result, \{ trustGeneration: pending\.trustGeneration \}\);/);
  assert.match(spawnBlock, /if \(pending\.trustGeneration === pathTrustGeneration\) \{[\s\S]*?this\.readyState = result\.state;[\s\S]*?this\.readyState = result;/);
  assert.match(invokeBlock, /const child = this\.child;[\s\S]*?const generation = this\.spawnGeneration;/);
  assert.match(invokeBlock, /const trustGeneration = pathTrustGeneration;[\s\S]*?this\.pending\.set\(id, \{ resolve, reject, command, timer, trustGeneration, child, generation \}\);/);
  assert.match(watchBlock, /result: result \|\| null/);
  assert.doesNotMatch(watchBlock, /result: result \? decorateState\(result\) : null/);
}

function testMediaPrepareBatchIsCappedAndMostlyAsync() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const constantsBlock = source.slice(source.indexOf("const QUERY_TRUSTED_MEDIA_PATH_LIMIT"), source.indexOf("const BACKEND_TIMEOUT_KILL_GRACE_MS"));
  const rememberBlock = source.slice(source.indexOf("function rememberUserPathKey"), source.indexOf("function decodeImageDataUrl"));
  const handlerBlock = source.slice(source.indexOf('ipcMain.handle("media:prepare-paths"'), source.indexOf('ipcMain.handle("camera:save-frame"'));
  assert.match(constantsBlock, /const USER_GRANTED_PATH_LIMIT = Math\.max\(1000, Math\.min\(50000,/);
  assert.match(constantsBlock, /const MEDIA_PREPARE_PATH_LIMIT = Math\.max\(1, Math\.min\(5000,/);
  assert.match(constantsBlock, /const MEDIA_PREPARE_SIDECAR_LIMIT = Math\.max\(0, Math\.min\(MEDIA_PREPARE_PATH_LIMIT,/);
  assert.match(rememberBlock, /while \(userGrantedPaths\.size > USER_GRANTED_PATH_LIMIT\) \{[\s\S]*?userGrantedPaths\.delete\(oldest\);/);
  assert.match(source, /async function grantUserPathAsync\(filePath\)/);
  assert.match(source, /rememberUserPathKey\(pathTrustKeyFromResolved\(await fs\.promises\.realpath\(target\)\)\);/);
  assert.match(handlerBlock, /const \{ paths, overflow \} = uniquePathBatch\(payload\.paths, MEDIA_PREPARE_PATH_LIMIT\);/);
  assert.match(handlerBlock, /if \(overflow\) \{[\s\S]*?E-MEDIA-PREPARE-LIMIT/);
  assert.match(handlerBlock, /await grantUserPathAsync\(candidate\);/);
  assert.match(handlerBlock, /await fs\.promises\.stat\(candidate\)/);
  assert.match(handlerBlock, /includeSidecars: index < MEDIA_PREPARE_SIDECAR_LIMIT/);
  assert.doesNotMatch(handlerBlock, /fs\.statSync|fs\.realpathSync|fs\.readFileSync/);
}

function testPreviewMediaRequestsAvoidFullTrustSetBuild() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const resolveBlock = source.slice(source.indexOf("async function resolveTrustedMediaPath"), source.indexOf("async function isTrustedMediaPath"));
  assert.match(source, /let trustedPreviewsPathCache = null;/);
  assert.match(source, /function currentPreviewsRealPath\(state = backend\?\.readyState \|\| null\) \{/);
  assert.match(resolveBlock, /const state = backend\?\.readyState \|\| null;/);
  assert.match(
    resolveBlock,
    /const previewsReal = currentPreviewsRealPath\(state\);[\s\S]*?if \(previewsReal && isSubpath\(previewsReal, targetReal\)\) \{[\s\S]*?return targetReal;[\s\S]*?\}[\s\S]*?const \{ paths \} = currentTrustedPaths\(\);/,
  );
  assert.doesNotMatch(resolveBlock, /const \{ state, paths, previewsReal \} = currentTrustedPaths\(\);/);
}

function testLatencySensitiveMainPathsAvoidSynchronousIo() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const indexingRuntimeSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "main", "photo-indexing-runtime.cjs"), "utf8");
  const diagnosticsBlock = source.slice(source.indexOf("function appendDiagnosticEvent"), source.indexOf("function readDiagnosticEvents"));
  const diagnosticsReadBlock = source.slice(source.indexOf("async function readFileTail"), source.indexOf("function summarizeDiagnosticEvents"));
  const diagnosticsReportBlock = source.slice(source.indexOf("async function createDiagnosticsReport"), source.indexOf("function persistFolderWatch"));
  const cameraAndMarkersBlock = source.slice(source.indexOf('ipcMain.handle("camera:save-frame"'), source.indexOf('ipcMain.handle("folder-watch:start"'));
  const indexingPolicyBlock = source.slice(source.indexOf("function photoIndexingHeadlessPowerState"), source.indexOf("function appendPhotoIndexingHeadlessRuntimeSkip"));
  const lockCheckBlock = source.slice(source.indexOf("function isWorkspaceLocked"), source.indexOf("function diagnosticsDir"));
  const mediaProtocolBlock = source.slice(source.indexOf("function registerMediaProtocol"), source.indexOf("function hardenWebContents"));
  const watchSweepBlock = source.slice(source.indexOf("async function runWatchSweep"), source.indexOf("function scheduleWatchFlush"));
  const createWindowBlock = source.slice(source.indexOf("async function createWindow"), source.indexOf('ipcMain.handle("backend:initial-state"'));
  const indexingTickBlock = source.slice(source.indexOf("async function runPhotoIndexingHeadlessSchedulerTick"), source.indexOf("function startPhotoIndexingHeadlessScheduler"));
  const backendInvokeHandlerBlock = source.slice(source.indexOf('ipcMain.handle("backend:invoke"'), source.indexOf('ipcMain.handle("updater:get-status"'));
  assert.match(diagnosticsBlock, /diagnosticWriteQueue\.push/);
  assert.match(diagnosticsBlock, /scheduleDiagnosticWrites\(\)/);
  assert.doesNotMatch(diagnosticsBlock, /mkdirSync|appendFileSync|writeFileSync/);
  assert.match(diagnosticsReadBlock, /await fs\.promises\.stat/);
  assert.match(diagnosticsReadBlock, /await fs\.promises\.open/);
  assert.doesNotMatch(diagnosticsReadBlock, /existsSync|statSync|openSync|readSync|closeSync/);
  assert.match(diagnosticsReportBlock, /await readDiagnosticEvents/);
  assert.match(diagnosticsReportBlock, /await fs\.promises\.writeFile/);
  assert.doesNotMatch(diagnosticsReportBlock, /mkdirSync|writeFileSync/);
  assert.match(cameraAndMarkersBlock, /await fs\.promises\.writeFile/);
  assert.match(cameraAndMarkersBlock, /await Promise\.all\(\[/);
  assert.doesNotMatch(cameraAndMarkersBlock, /mkdirSync|writeFileSync|unlinkSync|existsSync/);
  assert.match(indexingPolicyBlock, /foregroundActive/);
  assert.match(indexingPolicyBlock, /derivePhotoIndexingRuntimePolicy/);
  assert.match(indexingRuntimeSource, /reason: "foreground-active"/);
  assert.match(lockCheckBlock, /workspaceLockEnabled && !workspaceLockUnlocked/);
  assert.match(lockCheckBlock, /workspaceLockWorkspace === workspace/);
  assert.doesNotMatch(lockCheckBlock.slice(0, lockCheckBlock.indexOf("function initializeWorkspaceLockForActiveWorkspace")), /pathAvailable|existsSync/);
  assert.match(mediaProtocolBlock, /!isWorkspaceLocked\(\)/);
  assert.match(mediaProtocolBlock, /return await net\.fetch/);
  assert.doesNotMatch(mediaProtocolBlock, /existsSync|statSync|pathExistsAsync|fs\.promises\.access/);
  assert.match(watchSweepBlock, /mainWindowIsForegroundActive\(\)/);
  assert.match(watchSweepBlock, /CROSSAGE_WATCH_SWEEP_ALLOW_FOREGROUND/);
  assert.match(createWindowBlock, /window\.on\("blur"[\s\S]*?scheduleWatchSweep\(folderWatch, 5_000\)/);
  assert.match(indexingTickBlock, /photoIndexingHeadlessSettingsCache/);
  assert.match(indexingTickBlock, /settings-deferred-while-foreground/);
  assert.match(indexingTickBlock, /!cacheFresh && !foregroundActive/);
  assert.match(backendInvokeHandlerBlock, /\["photo_library_settings", "save_photo_library_settings"\][\s\S]*?cachePhotoIndexingHeadlessSettings\(result\)/);
  assert.match(backendInvokeHandlerBlock, /clearPhotoIndexingHeadlessSettingsCache\(\)/);
}

function testPhotoIndexingRuntimePolicyMatrix() {
  const settings = {
    localIntelligenceEnabled: true,
    backgroundIndexingAutoRun: true,
    backgroundIndexingPaused: false,
  };
  const power = {
    onBattery: false,
    idleState: "idle",
    foregroundActive: false,
    thermalState: "nominal",
    speedLimit: 100,
    memoryPressure: "normal",
    freeMemoryBytes: 8 * 1024 ** 3,
    totalMemoryBytes: 16 * 1024 ** 3,
    memoryAvailableFraction: 0.5,
  };
  const derive = (mode, patch = {}, options = {}) => photoIndexingRuntime.derivePhotoIndexingRuntimePolicy(
    { ...settings, indexingPowerMode: mode },
    { ...power, ...patch },
    options,
  );

  assert.strictEqual(photoIndexingRuntime.normalizePhotoIndexingPowerMode("unexpected"), "balanced");
  assert.strictEqual(derive("low").allowed, true);
  assert.strictEqual(derive("low").maxCostClass, "light");
  assert.strictEqual(derive("balanced").maxCostClass, "medium");
  assert.strictEqual(derive("performance").maxCostClass, "heavy");

  const thermal = derive("performance", { thermalState: "serious" });
  assert.strictEqual(thermal.maxCostClass, "light");
  assert.ok(thermal.constraints.includes("thermal-serious"));
  assert.strictEqual(derive("performance", { thermalState: "fair" }).maxCostClass, "medium");
  assert.strictEqual(derive("performance", { speedLimit: 60 }).maxCostClass, "light");
  assert.strictEqual(derive("performance", { speedLimit: 75 }).maxCostClass, "medium");
  assert.strictEqual(derive("performance", { memoryPressure: "pressured" }).maxCostClass, "medium");
  assert.strictEqual(derive("balanced", { memoryPressure: "critical" }).maxCostClass, "light");

  const batteryBlocked = derive("balanced", { onBattery: true });
  assert.strictEqual(batteryBlocked.allowed, false);
  assert.strictEqual(batteryBlocked.reason, "battery");
  const performanceBattery = derive("performance", { onBattery: true });
  assert.strictEqual(performanceBattery.allowed, true);
  assert.strictEqual(performanceBattery.maxCostClass, "medium");
  assert.strictEqual(derive("performance", { onBattery: true }, { allowHeavyOnBattery: true }).maxCostClass, "heavy");

  const foreground = derive("balanced", { idleState: "active", foregroundActive: true });
  assert.strictEqual(foreground.allowed, false);
  assert.strictEqual(foreground.reason, "foreground-active");
  assert.strictEqual(derive("balanced", { idleState: "active", foregroundActive: true }, { allowActiveBalanced: true }).maxCostClass, "medium");
  assert.strictEqual(derive("low", { idleState: "active" }).reason, "active-low-power");

  assert.strictEqual(photoIndexingRuntime.derivePhotoIndexingRuntimePolicy({}, power).reason, "local-intelligence-disabled");
  assert.strictEqual(photoIndexingRuntime.derivePhotoIndexingRuntimePolicy({ ...settings, backgroundIndexingAutoRun: false }, power).reason, "auto-run-off");
  assert.strictEqual(photoIndexingRuntime.derivePhotoIndexingRuntimePolicy({ ...settings, backgroundIndexingPaused: true }, power).reason, "paused");
  const ignored = derive("low", { thermalState: "critical", memoryPressure: "critical" }, { ignoreRuntimePolicy: true });
  assert.strictEqual(ignored.allowed, true);
  assert.strictEqual(ignored.maxCostClass, "heavy");
  assert.strictEqual(ignored.reason, "runtime-policy-ignored");
}

function testInAppUpdaterRequiresExplicitOperatorEnable() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const configBlock = source.slice(source.indexOf("function configureAutoUpdater()"), source.indexOf("function setUpdateChannelFromUser"));
  const downloadedHandlerBlock = source.slice(source.indexOf("async function verifyDownloadedUpdateFromUpdater"), source.indexOf("function configureAutoUpdater()"));
  const installBlock = source.slice(source.indexOf("function installDownloadedUpdate()"), source.indexOf("function sendAppCommand"));
  assert.match(source, /function inAppUpdatesEnabled\(\) \{[\s\S]*?envFlag\("VINTRACE_ENABLE_IN_APP_UPDATES"\)[\s\S]*?envFlag\("CROSSAGE_ENABLE_UPDATER"\)/);
  assert.match(configBlock, /if \(!inAppUpdatesEnabled\(\)\) \{[\s\S]*?canCheck: false,[\s\S]*?provider: "disabled"/);
  assert.match(configBlock, /In-app updates are disabled by default\. Enable them only for verified release channels with a configured release public key/);
  assert.match(configBlock, /const releaseKey = resolveReleasePublicKey\(\);[\s\S]*?if \(!releaseKey\.ok\) \{[\s\S]*?canCheck: false,[\s\S]*?VINTRACE_RELEASE_PUBKEY or VINTRACE_RELEASE_PUBLIC_KEY/);
  assert.ok(
    configBlock.indexOf("if (!inAppUpdatesEnabled())") < configBlock.indexOf("const feedUrl = resolveUpdateFeedUrl()"),
    "update feed must not be resolved before the explicit updater enable gate",
  );
  assert.ok(
    configBlock.indexOf("if (!inAppUpdatesEnabled())") < configBlock.indexOf("autoUpdater.autoDownload = false;"),
    "updater listeners/options should not be configured before the explicit enable gate",
  );
  assert.match(downloadedHandlerBlock, /verifyDownloadedUpdate\(\{[\s\S]*?downloadedFile: info\.downloadedFile,[\s\S]*?publicKeyPem: releaseKey\.publicKeyPem/);
  assert.match(downloadedHandlerBlock, /downloaded: false,[\s\S]*?downloadVerified: false,[\s\S]*?message: "Verifying update signature\."/);
  assert.match(downloadedHandlerBlock, /downloaded: true,[\s\S]*?downloadVerified: true,[\s\S]*?signedChecksumManifest: true/);
  assert.match(source, /autoUpdater\.on\("update-downloaded", \(info = \{\}\) => \{[\s\S]*?verifyDownloadedUpdateFromUpdater\(info\)\.catch/);
  assert.match(installBlock, /!updateState\.downloaded \|\| !updateState\.downloadVerified/);
  assert.ok(installBlock.indexOf("!updateState.downloaded || !updateState.downloadVerified") < installBlock.indexOf("autoUpdater.quitAndInstall"));
}

function testUpdateSecurityHelpers() {
  assert.deepStrictEqual(
    Array.from(updateSecurity.parseChecksums([
      `${"a".repeat(64)}  Vintrace-0.1.0-mac.zip`,
      `${"b".repeat(64)}  nested/Vintrace Setup 0.1.0.exe`,
      "not-a-checksum",
    ].join("\n")).entries()),
    [
      ["vintrace-0.1.0-mac.zip", "a".repeat(64)],
      ["vintrace setup 0.1.0.exe", "b".repeat(64)],
    ],
  );
  assert.strictEqual(updateSecurity.genericFeedBaseUrl("https://updates.example.com/releases/latest.yml"), "https://updates.example.com/releases/");
  assert.strictEqual(updateSecurity.genericFeedBaseUrl("https://updates.example.com/releases"), "https://updates.example.com/releases/");
  assert.throws(() => updateSecurity.genericFeedBaseUrl("http://updates.example.com/releases"), /HTTPS/);
  assert.strictEqual(
    updateSecurity.githubReleaseBaseUrl({ owner: "harsh2929", repo: "crossage-fr-workbench" }, "v0.1.0"),
    "https://github.com/harsh2929/crossage-fr-workbench/releases/download/v0.1.0/",
  );
}

async function testUpdateSecurityVerifiesSignedDownloadedArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-update-security-"));
  try {
    const artifact = path.join(dir, "Vintrace-0.1.0-mac.zip");
    fs.writeFileSync(artifact, "verified update bytes");
    const digest = crypto.createHash("sha256").update(fs.readFileSync(artifact)).digest("hex");
    const checksumBytes = Buffer.from(`${digest}  Vintrace-0.1.0-mac.zip\n`, "utf8");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const signatureBytes = crypto.sign(null, checksumBytes, privateKey);
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
    const downloader = async (url) => {
      if (url.endsWith("/SHA256SUMS.txt")) return checksumBytes;
      if (url.endsWith("/SHA256SUMS.txt.sig")) return signatureBytes;
      throw new Error(`unexpected url ${url}`);
    };
    const result = await updateSecurity.verifyDownloadedUpdate({
      downloadedFile: artifact,
      updateInfo: { version: "0.1.0", tag: "v0.1.0", files: [{ url: "Vintrace-0.1.0-mac.zip" }] },
      publish: { owner: "harsh2929", repo: "crossage-fr-workbench" },
      publicKeyPem,
      downloader,
    });
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.strictEqual(result.artifactName, "vintrace-0.1.0-mac.zip");
    assert.strictEqual(result.sha256, digest);

    fs.writeFileSync(artifact, "tampered update bytes");
    const tampered = await updateSecurity.verifyDownloadedUpdate({
      downloadedFile: artifact,
      updateInfo: { version: "0.1.0", tag: "v0.1.0", files: [{ url: "Vintrace-0.1.0-mac.zip" }] },
      publish: { owner: "harsh2929", repo: "crossage-fr-workbench" },
      publicKeyPem,
      downloader,
    });
    assert.strictEqual(tampered.ok, false, JSON.stringify(tampered));
    assert.strictEqual(tampered.reason, "downloaded-file-checksum-mismatch");

    const badSignature = await updateSecurity.verifyDownloadedUpdate({
      downloadedFile: artifact,
      updateInfo: { version: "0.1.0", tag: "v0.1.0", files: [{ url: "Vintrace-0.1.0-mac.zip" }] },
      publish: { owner: "harsh2929", repo: "crossage-fr-workbench" },
      publicKeyPem,
      downloader: async (url) => (url.endsWith(".sig") ? Buffer.from("bad") : checksumBytes),
    });
    assert.strictEqual(badSignature.ok, false, JSON.stringify(badSignature));
    assert.strictEqual(badSignature.reason, "release-checksum-signature-invalid");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testCanonicalPathKey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-canon-"));
  // case-fold on -> equal keys regardless of case
  const a = util.canonicalPathKey(path.join(dir, "Photos/Img.JPG"), { caseFold: true });
  const b = util.canonicalPathKey(path.join(dir, "photos/img.jpg"), { caseFold: true });
  assert.strictEqual(a, b);
  // case-sensitive -> different keys
  const c = util.canonicalPathKey(path.join(dir, "Photos/Img.JPG"), { caseFold: false });
  const d = util.canonicalPathKey(path.join(dir, "photos/img.jpg"), { caseFold: false });
  assert.notStrictEqual(c, d);
  // normalizes .. segments
  assert.strictEqual(
    util.canonicalPathKey("/a/b/../c", { caseFold: false }),
    path.normalize(path.resolve("/a/b/../c")),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

function testUniquePathBatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-path-batch-"));
  const a = path.join(dir, "a.jpg");
  const b = path.join(dir, "folder", "..", "b.jpg");
  const bAgain = path.join(dir, "b.jpg");
  const c = path.join(dir, "c.jpg");
  assert.deepStrictEqual(
    util.uniquePathBatch([null, "", "   ", a, b, bAgain, c], 2),
    { paths: [a, b], overflow: true },
  );
  assert.deepStrictEqual(
    util.uniquePathBatch([a, bAgain, b], 5),
    { paths: [a, bAgain], overflow: false },
  );
  assert.deepStrictEqual(util.uniquePathBatch([a], 0), { paths: [], overflow: false });
  assert.strictEqual(
    util.pathTrustKeyFromResolved(path.join(dir, "Folder", "..", "File.JPG"), { caseFold: false }),
    path.normalize(path.resolve(dir, "File.JPG")),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBuildTrustedMediaPathSet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-trusted-media-"));
  const workspace = path.join(dir, "workspace");
  const source = path.join(dir, "media", "a.jpg");
  const preview = path.join(workspace, "previews", "a.webp");
  const bestRef = path.join(dir, "refs", "best.jpg");
  const extra = path.join(dir, "dynamic", "cover.webp");
  const paths = util.buildTrustedMediaPathSet({
    workspace,
    references: [{ sourcePath: source, previewPath: preview }],
    candidates: [{ sourcePath: source, mediaSourcePath: path.join(dir, "video.mov"), bestRefPath: bestRef }],
  }, [extra, "", null]);
  assert.ok(paths.has(util.canonicalPathKey(workspace)));
  assert.ok(paths.has(util.canonicalPathKey(source)));
  assert.ok(paths.has(util.canonicalPathKey(preview)));
  assert.ok(paths.has(util.canonicalPathKey(bestRef)));
  assert.ok(paths.has(util.canonicalPathKey(extra)));
  fs.rmSync(dir, { recursive: true, force: true });
}

function testBuildTrustedMediaPathSetUsesCanonicalRealpaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-trusted-media-symlink-"));
  const realDir = path.join(dir, "real");
  const linkDir = path.join(dir, "linked");
  fs.mkdirSync(realDir, { recursive: true });
  const realPhoto = path.join(realDir, "photo.jpg");
  fs.writeFileSync(realPhoto, "image-bytes");
  try {
    fs.symlinkSync(realDir, linkDir, "dir");
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const linkedPhoto = path.join(linkDir, "photo.jpg");
  const paths = util.buildTrustedMediaPathSet({
    references: [{ sourcePath: linkedPhoto }],
  });
  assert.ok(paths.has(util.pathTrustKeyFromResolved(fs.realpathSync.native(realPhoto))));
  assert.strictEqual(paths.has(path.resolve(linkedPhoto)), false);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testFilterStableWatchFilesConcurrency() {
  const paths = ["a", "b", "drop-1", "c", "drop-2", "d", "e"];
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const stable = await util.filterStableWatchFiles(paths, async (value, index) => {
    calls += 1;
    assert.strictEqual(value, paths[index]);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return !value.startsWith("drop");
  }, 3);
  assert.deepStrictEqual(stable, ["a", "b", "c", "d", "e"]);
  assert.strictEqual(calls, paths.length);
  assert.strictEqual(maxActive, 3);
  await assert.rejects(
    () => util.filterStableWatchFiles(["x"], null, 3),
    /waitForStableFile must be a function/,
  );
}

async function main() {
  testJsonAtomicRoundTrip();
  testMediaPathCodec();
  testEscapeHtml();
  testIsSubpath();
  testTimestampSlug();
  testSafeRealpath();
  testBackendRestartDelay();
  testRendererGpuModeDefaultsToProductionAcceleration();
  testContentSecurityPolicyAllowsMediaProtocolOnlyForMedia();
  testPythonBackendStartRaceGuards();
  testBackendStdinErrorsAreHandled();
  testBackendStopEscalatesToSigkill();
  testPathTrustGenerationGuardsStaleBackendResponses();
  testMediaPrepareBatchIsCappedAndMostlyAsync();
  testPreviewMediaRequestsAvoidFullTrustSetBuild();
  testLatencySensitiveMainPathsAvoidSynchronousIo();
  testPhotoIndexingRuntimePolicyMatrix();
  testInAppUpdaterRequiresExplicitOperatorEnable();
  testUpdateSecurityHelpers();
  await testUpdateSecurityVerifiesSignedDownloadedArtifact();
  testCanonicalPathKey();
  testUniquePathBatch();
  testBuildTrustedMediaPathSet();
  testBuildTrustedMediaPathSetUsesCanonicalRealpaths();
  await testFilterStableWatchFilesConcurrency();
  console.log("main util ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

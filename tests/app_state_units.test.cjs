"use strict";

const assert = require("assert");
const esbuild = require("esbuild");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const appStorageOutFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "app-storage-diagnostics-")), "appStorageDiagnostics.cjs");
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
  assert.match(source, /recordAppStorageIssue\("scanQueue", "read"/);
  assert.match(source, /recordAppStorageIssue\("scanQueue", "write"/);
  assert.match(source, /recordAppStorageIssue\("savedScanSources", "read"/);
  assert.match(source, /recordAppStorageIssue\("savedReviewViews", "write"/);
  assert.match(source, /window\.addEventListener\(APP_STORAGE_ISSUE_EVENT, handleStorageIssue\)/);
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

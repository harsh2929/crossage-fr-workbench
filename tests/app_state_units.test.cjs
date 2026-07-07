"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");

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

console.log("\nall app state unit tests passed");

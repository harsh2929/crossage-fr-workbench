"use strict";

// EIPC-01 (first slice): self-contained, side-effect-light helpers extracted
// from the 3.6k-line main.cjs god-file. These depend only on Node stdlib (no
// Electron, no main.cjs module globals), so they are unit-testable in plain
// node — see tests/main_util.test.cjs. The stateful subsystems (window,
// backend lifecycle, updater, tray, protocol, folder-watch, locks) remain in
// main.cjs pending the e2e net required to verify their extraction safely.

const fs = require("fs");
const path = require("path");

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

function encodeMediaPath(filePath) {
  return Buffer.from(path.resolve(String(filePath || "")), "utf8").toString("base64url");
}

function decodeMediaPath(value) {
  try {
    return path.resolve(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return "";
  }
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

// EIPC-05: capped-exponential backoff for backend respawns. With 0 prior
// consecutive failures the delay is 0 (the happy path is unchanged); each
// further failure doubles the wait up to `capMs`, so a crashing backend can't
// be hammered into a tight respawn loop.
function backendRestartDelayMs(consecutiveFailures, baseMs = 500, capMs = 30000) {
  const failures = Math.max(0, Math.floor(Number(consecutiveFailures) || 0));
  if (failures <= 0) {
    return 0;
  }
  // Cap the exponent before shifting so a runaway failure count can't overflow
  // 2**n past IEEE-754 safe range (which would return Infinity/NaN and defeat
  // the backoff). Any exponent that already blows past capMs is clamped anyway.
  const exponent = Math.min(failures - 1, 30);
  const delay = baseMs * 2 ** exponent;
  return Math.min(capMs, delay);
}

// Keep the image-heavy renderer GPU accelerated in normal desktop use. Hidden
// Playwright windows retain the deterministic software path unless a test opts
// into production rendering, and operators can explicitly request the fallback
// if a particular driver/OS combination is unstable.
function resolveRendererGpuMode({ platform = process.platform, env = process.env } = {}) {
  if (env.CROSSAGE_DISABLE_GPU === "1" || env.CROSSAGE_ENABLE_GPU === "0") {
    return "software";
  }
  if (env.CROSSAGE_ENABLE_GPU === "1") {
    return "hardware";
  }
  if (platform === "darwin" && env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1" && env.CROSSAGE_SHOW_WINDOW !== "1") {
    return "software";
  }
  return "hardware";
}

// MS-5: case-fold + canonicalize a path so trust comparisons are correct on
// case-insensitive filesystems (default macOS / Windows). Returns a comparable
// key; falls back to a normalized lowercase string if realpath fails.
function canonicalPathKey(filePath, { caseFold = process.platform === "darwin" || process.platform === "win32" } = {}) {
  const resolved = safeRealpath(filePath) || path.resolve(String(filePath || ""));
  const normalized = path.normalize(resolved);
  return caseFold ? normalized.toLowerCase() : normalized;
}

function pathTrustKeyFromResolved(filePath, { caseFold = process.platform === "darwin" || process.platform === "win32" } = {}) {
  const normalized = path.normalize(path.resolve(String(filePath || "")));
  return caseFold ? normalized.toLowerCase() : normalized;
}

function buildContentSecurityPolicy({ isDev = false, mediaProtocolScheme = "vintrace-media" } = {}) {
  const mediaScheme = String(mediaProtocolScheme || "vintrace-media").replace(/:$/, "");
  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${mediaScheme}: data: blob:`,
    `media-src 'self' ${mediaScheme}: blob:`,
    "font-src 'self'",
    "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
  ].join("; ");
}

function uniquePathBatch(values, limit) {
  const max = Math.max(0, Math.floor(Number(limit) || 0));
  if (!Array.isArray(values) || max <= 0) {
    return { paths: [], overflow: false };
  }
  const seen = new Set();
  const paths = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const key = path.resolve(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (paths.length >= max) {
      return { paths, overflow: true };
    }
    paths.push(value);
  }
  return { paths, overflow: false };
}

function buildTrustedMediaPathSet(state, extraPaths = []) {
  const paths = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      paths.add(canonicalPathKey(value));
    }
  };
  add(state?.workspace);
  for (const item of state?.references || []) {
    add(item?.sourcePath);
    add(item?.previewPath);
  }
  for (const item of state?.candidates || []) {
    add(item?.sourcePath);
    add(item?.mediaSourcePath);
    add(item?.previewPath);
    add(item?.bestRefPath);
    add(item?.bestRefPreviewPath);
  }
  for (const item of extraPaths || []) {
    add(item);
  }
  return paths;
}

async function filterStableWatchFiles(paths, waitForStableFile, concurrency = 8) {
  if (!Array.isArray(paths) || !paths.length) {
    return [];
  }
  if (typeof waitForStableFile !== "function") {
    throw new TypeError("waitForStableFile must be a function");
  }
  const limit = Math.max(1, Math.min(paths.length, Math.floor(Number(concurrency) || 1)));
  const accepted = new Array(paths.length).fill(false);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= paths.length) {
        return;
      }
      if (await waitForStableFile(paths[index], index)) {
        accepted[index] = true;
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return paths.filter((_, index) => accepted[index]);
}

module.exports = {
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
};

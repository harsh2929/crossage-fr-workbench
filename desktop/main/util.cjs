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

module.exports = {
  writeJsonAtomic,
  readJsonObject,
  encodeMediaPath,
  decodeMediaPath,
  timestampSlug,
  escapeHtml,
  isSubpath,
  safeRealpath,
};

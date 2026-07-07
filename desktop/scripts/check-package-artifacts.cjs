#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const build = pkg.build || {};
const dist = path.join(repoRoot, "dist");
const backendDist = path.join(repoRoot, "backend-dist");
const platform = process.env.VINTRACE_PACKAGE_PLATFORM || process.platform;
const required = process.env.VINTRACE_PACKAGE_REQUIRED === "1";
const checks = [];

function add(name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

function listRecursiveFiles(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      rows.push(...listRecursiveFiles(root, relative));
    } else if (entry.isFile()) {
      rows.push(relative);
    }
  }
  return rows.sort();
}

const distFiles = listFiles(dist);
const backendFiles = listRecursiveFiles(backendDist);
const exeFiles = distFiles.filter((file) => /\.exe$/i.test(file));
const dmgFiles = distFiles.filter((file) => /\.dmg$/i.test(file));
const zipFiles = distFiles.filter((file) => /\.zip$/i.test(file));
const blockmaps = distFiles.filter((file) => /\.blockmap$/i.test(file));
const metadata = distFiles.filter((file) => /^(latest|beta|internal).*\.ya?ml$/i.test(file));
const checksumFile = path.join(dist, "SHA256SUMS.txt");
const sbomFile = path.join(dist, "vintrace-sbom.json");
const provenanceFile = path.join(dist, "vintrace-provenance.json");
const backendExecutablePath = backendFiles.find((file) => /(^|\/)crossage-backend(\.exe)?$/i.test(file)) || "";
const backendExecutable = Boolean(backendExecutablePath);
const backendChecksumFile = path.join(backendDist, "crossage-backend.sha256");
const backendManifestFile = path.join(backendDist, "crossage-backend-manifest.json");
const hasAnyInstaller = exeFiles.length > 0 || dmgFiles.length > 0 || zipFiles.length > 0;

function parseJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function checksumEntries() {
  if (!fs.existsSync(checksumFile)) return new Map();
  return new Map(
    fs.readFileSync(checksumFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        return match ? [match[2].replace(/\\/g, "/"), match[1].toLowerCase()] : null;
      })
      .filter(Boolean)
  );
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function backendChecksumStatus() {
  if (!backendExecutablePath) {
    return { ok: false, detail: "backend executable missing" };
  }
  if (!fs.existsSync(backendChecksumFile)) {
    return { ok: false, detail: "backend-dist/crossage-backend.sha256 missing" };
  }
  if (!fs.existsSync(backendManifestFile)) {
    return { ok: false, detail: "backend-dist/crossage-backend-manifest.json missing" };
  }
  const manifest = parseJsonFile(backendManifestFile);
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, detail: "backend manifest is not valid JSON" };
  }
  const executable = String(manifest.executable || "").replace(/\\/g, "/");
  if (executable !== backendExecutablePath) {
    return { ok: false, detail: `backend manifest executable mismatch: ${executable || "missing"} != ${backendExecutablePath}` };
  }
  const actual = sha256File(path.join(backendDist, backendExecutablePath));
  const checksumText = fs.readFileSync(backendChecksumFile, "utf8");
  const checksumMatch = checksumText.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
  if (!checksumMatch) {
    return { ok: false, detail: "backend checksum line is malformed" };
  }
  const lineDigest = checksumMatch[1].toLowerCase();
  const linePath = checksumMatch[2].replace(/\\/g, "/");
  const manifestDigest = String(manifest.sha256 || "").toLowerCase();
  const manifestBytes = Number(manifest.bytes || 0);
  const stat = fs.statSync(path.join(backendDist, backendExecutablePath));
  const ok = lineDigest === actual
    && manifestDigest === actual
    && linePath === backendExecutablePath
    && manifestBytes === stat.size;
  return { ok, detail: ok ? `${backendExecutablePath}: ${actual}` : "backend checksum or manifest does not match executable" };
}

add("product name", build.productName === "Vintrace", build.productName || "missing");
add("app id", /^com\.vintrace\./.test(String(build.appId || "")), build.appId || "missing");
add("desktop entry", fs.existsSync(path.join(repoRoot, "desktop", "main.cjs")), "desktop/main.cjs");
add("preload entry", fs.existsSync(path.join(repoRoot, "desktop", "preload.cjs")), "desktop/preload.cjs");
add("icon png", fs.existsSync(path.join(repoRoot, "desktop", "assets", "icon.png")), "desktop/assets/icon.png");
add("backend resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "backend"), "extraResources backend");
add("model resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/insightface"), "extraResources models/insightface");
add("mcp resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "mcp"), "extraResources mcp");

if (required) {
  const checksums = checksumEntries();
  const sbom = parseJsonFile(sbomFile);
  const provenance = parseJsonFile(provenanceFile);
  const backendChecksum = backendChecksumStatus();
  add("installer artifact present", hasAnyInstaller, distFiles.join(", ") || "dist is empty");
  add("packaged backend present", backendExecutable, backendFiles.slice(0, 8).join(", ") || "backend-dist is empty");
  add("packaged backend checksum", backendChecksum.ok, backendChecksum.detail);
  add("release checksums present", fs.existsSync(checksumFile), "dist/SHA256SUMS.txt");
  add("release sbom present", Boolean(sbom && Array.isArray(sbom.packages)), "dist/vintrace-sbom.json");
  add("release provenance present", Boolean(provenance && Array.isArray(provenance.artifacts)), "dist/vintrace-provenance.json");
  for (const artifact of [...exeFiles, ...dmgFiles, ...zipFiles, ...blockmaps, ...metadata]) {
    add(`checksum ${artifact}`, checksums.has(artifact), artifact);
  }
  if (platform === "win32") {
    add("windows exe", exeFiles.length > 0, exeFiles.join(", ") || "missing .exe");
    add("windows update blockmap", blockmaps.length > 0, blockmaps.join(", ") || "missing .blockmap");
    add("windows update metadata", metadata.some((file) => file === "latest.yml" || file.startsWith("latest")), metadata.join(", ") || "missing latest.yml");
  } else if (platform === "darwin") {
    add("mac dmg", dmgFiles.length > 0, dmgFiles.join(", ") || "missing .dmg");
    add("mac zip updater", zipFiles.length > 0, zipFiles.join(", ") || "missing .zip");
    add("mac update metadata", metadata.length > 0, metadata.join(", ") || "missing latest*.yml");
  }
} else {
  add("package artifacts optional", true, hasAnyInstaller ? distFiles.join(", ") : "not built in this checkout");
  add("packaged backend optional", true, backendExecutable ? "backend executable found" : "not built in this checkout");
  add("release metadata optional", true, fs.existsSync(checksumFile) ? "release metadata found" : "not built in this checkout");
}

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  ok,
  platform,
  required,
  dist,
  backendDist,
  artifacts: { exeFiles, dmgFiles, zipFiles, blockmaps, metadata, releaseMetadata: distFiles.filter((file) => /^SHA256SUMS\.txt$|^vintrace-(sbom|provenance)\.json$/i.test(file)) },
  checks,
  recommendations: ok
    ? ["Package artifact configuration is structurally valid."]
    : ["Build the installer and backend sidecar, then rerun package artifact validation."]
}, null, 2));
process.exit(ok ? 0 : 1);

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const path = require("path");

const CHECKSUM_FILE = "SHA256SUMS.txt";
const CHECKSUM_SIGNATURE_FILE = `${CHECKSUM_FILE}.sig`;
const MAX_RELEASE_METADATA_BYTES = 4 * 1024 * 1024;

function basenameKey(value) {
  let name = "";
  try {
    name = path.basename(decodeURIComponent(String(value || "")));
  } catch {
    name = path.basename(String(value || ""));
  }
  return name.toLowerCase();
}

function parseChecksums(text) {
  const map = new Map();
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^([a-f0-9]{64})[ \t]+[*]?(.+?)\s*$/i);
    if (match) {
      map.set(basenameKey(match[2]), match[1].toLowerCase());
    }
  }
  return map;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function verifyChecksumSignature(checksumBytes, signatureBytes, publicKeyPem) {
  try {
    return crypto.verify(null, checksumBytes, crypto.createPublicKey(publicKeyPem), signatureBytes);
  } catch {
    return false;
  }
}

function normalizePublicKeyPem(raw) {
  const text = String(raw || "").trim();
  if (!text) {
    return "";
  }
  if (text.includes("-----BEGIN PUBLIC KEY-----")) {
    return text;
  }
  try {
    const decoded = Buffer.from(text, "base64").toString("utf8").trim();
    return decoded.includes("-----BEGIN PUBLIC KEY-----") ? decoded : "";
  } catch {
    return "";
  }
}

function resolveReleasePublicKey({ env = process.env, fileSystem = fs } = {}) {
  const inline = normalizePublicKeyPem(env.VINTRACE_RELEASE_PUBLIC_KEY || env.CROSSAGE_RELEASE_PUBLIC_KEY || "");
  if (inline) {
    return { ok: true, publicKeyPem: inline, source: "inline" };
  }
  const keyPath = String(env.VINTRACE_RELEASE_PUBKEY || env.CROSSAGE_RELEASE_PUBKEY || "").trim();
  if (!keyPath) {
    return { ok: false, publicKeyPem: "", source: "", reason: "missing-release-public-key" };
  }
  try {
    const publicKeyPem = normalizePublicKeyPem(fileSystem.readFileSync(path.resolve(keyPath), "utf8"));
    return publicKeyPem
      ? { ok: true, publicKeyPem, source: "file" }
      : { ok: false, publicKeyPem: "", source: "file", reason: "invalid-release-public-key" };
  } catch {
    return { ok: false, publicKeyPem: "", source: "file", reason: "unreadable-release-public-key" };
  }
}

function ensureHttpsUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || ""));
  if (parsed.protocol !== "https:") {
    throw new Error("Release metadata must be fetched over HTTPS.");
  }
  return parsed;
}

function genericFeedBaseUrl(feedUrl) {
  const parsed = ensureHttpsUrl(feedUrl);
  if (/\.(?:ya?ml|json)$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/[^/]+$/, "");
  } else if (!parsed.pathname.endsWith("/")) {
    parsed.pathname += "/";
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function githubReleaseBaseUrl(publish, tag) {
  const config = Array.isArray(publish) ? publish[0] : publish;
  const owner = String(config?.owner || "").trim();
  const repo = String(config?.repo || "").trim();
  const releaseTag = String(tag || "").trim();
  if (!owner || !repo || !releaseTag) {
    return "";
  }
  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/download/${encodeURIComponent(releaseTag)}/`;
}

function releaseManifestBaseUrl({ feedUrl = "", publish = null, updateInfo = {} } = {}) {
  if (feedUrl) {
    return genericFeedBaseUrl(feedUrl);
  }
  return githubReleaseBaseUrl(publish, updateInfo?.tag || updateInfo?.releaseTag || "");
}

function releaseMetadataUrl(baseUrl, fileName) {
  return new URL(fileName, ensureHttpsUrl(baseUrl)).toString();
}

function downloadBufferFromHttps(url, { maxBytes = MAX_RELEASE_METADATA_BYTES, redirectCount = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(ensureHttpsUrl(url), { headers: { "User-Agent": "vintrace-updater-verifier" } }, (response) => {
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while fetching ${url}`));
          return;
        }
        downloadBufferFromHttps(new URL(location, url).toString(), { maxBytes, redirectCount: redirectCount + 1 }).then(resolve, reject);
        return;
      }
      if ((response.statusCode || 0) >= 400) {
        response.resume();
        reject(new Error(`GET ${url} failed with ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          response.destroy(new Error(`Release metadata exceeds ${maxBytes} bytes.`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
  });
}

function candidateArtifactNames(downloadedFile, updateInfo = {}) {
  const names = new Set();
  const add = (value) => {
    const key = basenameKey(value);
    if (key) {
      names.add(key);
    }
  };
  add(downloadedFile);
  add(updateInfo.path);
  for (const file of Array.isArray(updateInfo.files) ? updateInfo.files : []) {
    add(file?.url);
  }
  return Array.from(names);
}

async function verifyDownloadedUpdate({
  downloadedFile,
  updateInfo = {},
  feedUrl = "",
  publish = null,
  publicKeyPem = "",
  downloader = downloadBufferFromHttps,
} = {}) {
  const artifactPath = path.resolve(String(downloadedFile || ""));
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    return { ok: false, reason: "downloaded-file-missing" };
  }
  if (!publicKeyPem) {
    return { ok: false, reason: "release-public-key-missing" };
  }
  let baseUrl = "";
  try {
    baseUrl = releaseManifestBaseUrl({ feedUrl, publish, updateInfo });
  } catch (error) {
    return { ok: false, reason: "release-manifest-base-invalid", detail: error instanceof Error ? error.message : String(error) };
  }
  if (!baseUrl) {
    return { ok: false, reason: "release-manifest-base-missing" };
  }
  const checksumUrl = releaseMetadataUrl(baseUrl, CHECKSUM_FILE);
  const signatureUrl = releaseMetadataUrl(baseUrl, CHECKSUM_SIGNATURE_FILE);
  let checksumBytes;
  let signatureBytes;
  try {
    checksumBytes = await downloader(checksumUrl);
    signatureBytes = await downloader(signatureUrl);
  } catch (error) {
    return { ok: false, reason: "release-metadata-unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
  if (!verifyChecksumSignature(checksumBytes, signatureBytes, publicKeyPem)) {
    return { ok: false, reason: "release-checksum-signature-invalid" };
  }
  const checksumMap = parseChecksums(checksumBytes.toString("utf8"));
  const candidates = candidateArtifactNames(artifactPath, updateInfo);
  const artifactName = candidates.find((name) => checksumMap.has(name)) || "";
  if (!artifactName) {
    return { ok: false, reason: "downloaded-file-not-listed", candidates };
  }
  const expectedSha256 = checksumMap.get(artifactName);
  const actualSha256 = await sha256File(artifactPath);
  if (actualSha256 !== expectedSha256) {
    return {
      ok: false,
      reason: "downloaded-file-checksum-mismatch",
      artifactName,
      expectedSha256,
      actualSha256,
    };
  }
  return {
    ok: true,
    artifactName,
    sha256: actualSha256,
    checksumUrl,
    signatureUrl,
  };
}

module.exports = {
  CHECKSUM_FILE,
  CHECKSUM_SIGNATURE_FILE,
  basenameKey,
  candidateArtifactNames,
  downloadBufferFromHttps,
  genericFeedBaseUrl,
  githubReleaseBaseUrl,
  parseChecksums,
  releaseManifestBaseUrl,
  resolveReleasePublicKey,
  sha256File,
  verifyChecksumSignature,
  verifyDownloadedUpdate,
};

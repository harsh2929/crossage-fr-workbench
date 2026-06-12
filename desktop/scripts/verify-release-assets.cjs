#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");

const args = process.argv.slice(2);
const options = {
  repo: process.env.GITHUB_REPOSITORY || "",
  tag: process.env.VINTRACE_RELEASE_TAG || "",
  platform: process.env.VINTRACE_PACKAGE_PLATFORM || process.platform,
  full: false
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--repo") options.repo = args[++index] || "";
  else if (arg === "--tag") options.tag = args[++index] || "";
  else if (arg === "--platform") options.platform = args[++index] || "";
  else if (arg === "--full") options.full = true;
  else if (arg === "--metadata-only") options.full = false;
}

const checks = [];

function add(name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

function githubRequest(url, redirectCount = 0) {
  const headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "vintrace-release-verifier"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (response) => {
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0) && redirectCount < 5) {
        response.resume();
        resolve(githubRequest(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((response.statusCode || 0) >= 400) {
          reject(new Error(`GET ${url} failed with ${response.statusCode}: ${body.slice(0, 400)}`));
          return;
        }
        resolve({ statusCode: response.statusCode, headers: response.headers, body });
      });
    }).on("error", reject);
  });
}

function headRequest(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "HEAD", headers: { "User-Agent": "vintrace-release-verifier" } }, (response) => {
      const location = response.headers.location;
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0) && redirectCount < 5) {
        response.resume();
        resolve(headRequest(new URL(location, url).toString(), redirectCount + 1));
        return;
      }
      response.resume();
      resolve({ statusCode: response.statusCode, headers: response.headers });
    });
    request.on("error", reject);
    request.end();
  });
}

function resolveRedirect(url, headers) {
  const location = headers.location;
  return location ? new URL(location, url).toString() : "";
}

async function downloadAndHash(url, fileName, redirectCount = 0) {
  const tempPath = path.join(os.tmpdir(), `vintrace-release-${process.pid}-${fileName.replace(/[^a-z0-9_.-]/gi, "_")}`);
  const hash = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "vintrace-release-verifier" } }, async (response) => {
      const location = resolveRedirect(url, response.headers);
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while downloading ${fileName}`));
          return;
        }
        try {
          const result = await downloadAndHash(location, fileName, redirectCount + 1);
          resolve(result);
        } catch (error) {
          reject(error);
        }
        return;
      }
      if ((response.statusCode || 0) >= 400) {
        response.resume();
        reject(new Error(`Download ${url} failed with ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk) => hash.update(chunk));
      try {
        await pipeline(response, fs.createWriteStream(tempPath));
        try {
          fs.rmSync(tempPath, { force: true });
        } catch {
          // Temporary cleanup is best effort.
        }
        resolve(hash.digest("hex"));
      } catch (error) {
        reject(error);
      }
    }).on("error", reject);
  });
}

function assetDigestSha(asset) {
  const value = String(asset.digest || "");
  const match = value.match(/^sha256:([a-f0-9]{64})$/i);
  return match ? match[1].toLowerCase() : "";
}

function assetByPattern(assets, pattern) {
  return assets.find((asset) => pattern.test(asset.name));
}

async function main() {
  add("repo argument", /^[^/]+\/[^/]+$/.test(options.repo), options.repo || "missing owner/repo");
  add("tag argument", Boolean(options.tag), options.tag || "missing release tag");
  if (!checks.every((check) => check.ok)) {
    throw new Error("Missing required release verifier arguments.");
  }

  const apiUrl = `https://api.github.com/repos/${options.repo}/releases/tags/${encodeURIComponent(options.tag)}`;
  const releaseResponse = await githubRequest(apiUrl);
  const release = JSON.parse(releaseResponse.body);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const isMac = String(options.platform).toLowerCase().startsWith("darwin") || String(options.platform).toLowerCase() === "macos";
  const installerPattern = isMac ? /\.dmg$/i : /\.exe$/i;
  const updaterPattern = isMac ? /\.zip$/i : /\.blockmap$/i;
  const metadataPattern = isMac ? /^latest-mac\.ya?ml$/i : /^latest\.ya?ml$/i;
  const metadataFallbackPattern = /^latest.*\.ya?ml$/i;
  const installer = assetByPattern(assets, installerPattern);
  const metadata = assetByPattern(assets, metadataPattern) || assetByPattern(assets, metadataFallbackPattern);
  const updater = assetByPattern(assets, updaterPattern);

  add("release is published", !release.draft, release.draft ? "draft release" : "published release", { url: release.html_url });
  add("installer asset exists", Boolean(installer), installer?.name || `missing ${isMac ? ".dmg" : ".exe"}`);
  add("update metadata exists", Boolean(metadata), metadata?.name || "missing latest*.yml");
  add("delta/update companion exists", Boolean(updater), updater?.name || `missing ${isMac ? ".zip" : ".blockmap"}`);
  if (installer) {
    const minimumSize = isMac ? 50 * 1024 * 1024 : 80 * 1024 * 1024;
    add("installer size is sane", installer.size >= minimumSize, `${installer.name}: ${installer.size} bytes`, { size: installer.size });
    add("installer digest present", Boolean(assetDigestSha(installer)), installer.digest || "missing sha256 digest");
    const head = await headRequest(installer.browser_download_url);
    add("installer download is public", [200, 302].includes(head.statusCode || 0), `${installer.browser_download_url} -> ${head.statusCode}`);
  }
  if (metadata) {
    const head = await headRequest(metadata.browser_download_url);
    add("metadata download is public", [200, 302].includes(head.statusCode || 0), `${metadata.browser_download_url} -> ${head.statusCode}`);
  }
  if (options.full) {
    for (const asset of [installer, metadata, updater].filter(Boolean)) {
      const expected = assetDigestSha(asset);
      if (!expected) {
        add(`sha256 ${asset.name}`, false, "asset digest missing");
        continue;
      }
      const actual = await downloadAndHash(asset.browser_download_url, asset.name);
      add(`sha256 ${asset.name}`, actual === expected, actual === expected ? expected : `${actual} != ${expected}`);
    }
  }

  const ok = checks.every((check) => check.ok);
  const result = {
    generatedAt: new Date().toISOString(),
    ok,
    repo: options.repo,
    tag: options.tag,
    platform: options.platform,
    full: options.full,
    releaseUrl: release.html_url,
    assets: assets.map((asset) => ({
      name: asset.name,
      size: asset.size,
      digest: asset.digest || "",
      url: asset.browser_download_url
    })),
    checks
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  add("release verifier", false, error.message || String(error));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok: false,
    repo: options.repo,
    tag: options.tag,
    platform: options.platform,
    full: options.full,
    checks
  }, null, 2));
  process.exit(1);
});

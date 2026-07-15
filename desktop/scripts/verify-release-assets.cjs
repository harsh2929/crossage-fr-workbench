#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { verifyCosignBundles } = require("./sign-release-artifacts.cjs");
const { verifyGithubAttestations } = require("./verify-github-attestations.cjs");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  LEGACY_RELEASE_METADATA_NAMES,
  SPDX_NAME,
  expectedSupplyChainBundles,
  invariant,
  parseChecksumText,
  readJson,
  safeReleaseName,
  validateBuildMetadata,
  validateSigstoreBundle,
} = require("./release-supply-chain.cjs");

const args = process.argv.slice(2);
const options = {
  repo: process.env.GITHUB_REPOSITORY || "",
  tag: process.env.VINTRACE_RELEASE_TAG || "",
  platform: process.env.VINTRACE_PACKAGE_PLATFORM || process.platform,
  full: false,
  requireReleaseMetadata: process.env.VINTRACE_REQUIRE_RELEASE_METADATA === "1",
  verifySignatures: process.env.VINTRACE_VERIFY_SUPPLY_CHAIN_SIGNATURES === "1",
  allowDraft: process.env.VINTRACE_RELEASE_ALLOW_DRAFT === "1"
};

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--repo") options.repo = args[++index] || "";
  else if (arg === "--tag") options.tag = args[++index] || "";
  else if (arg === "--platform") options.platform = args[++index] || "";
  else if (arg === "--full") options.full = true;
  else if (arg === "--metadata-only") options.full = false;
  else if (arg === "--require-release-metadata") options.requireReleaseMetadata = true;
  else if (arg === "--verify-signatures") options.verifySignatures = true;
  else if (arg === "--allow-draft") options.allowDraft = true;
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

function assetDownloadUrl(asset) {
  return options.allowDraft && asset?.url ? asset.url : asset?.browser_download_url;
}

function assetDownloadHeaders(asset) {
  const headers = {
    "Accept": options.allowDraft && asset?.url ? "application/octet-stream" : "*/*",
    "User-Agent": "vintrace-release-verifier"
  };
  if (process.env.GITHUB_TOKEN && options.allowDraft && asset?.url) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
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

async function downloadToFileAndHash(url, destination, fileName, redirectCount = 0, headers = { "User-Agent": "vintrace-release-verifier" }) {
  const hash = crypto.createHash("sha256");
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, async (response) => {
      const location = resolveRedirect(url, response.headers);
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while downloading ${fileName}`));
          return;
        }
        try {
          const result = await downloadToFileAndHash(location, destination, fileName, redirectCount + 1, { "User-Agent": "vintrace-release-verifier" });
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
        await pipeline(response, fs.createWriteStream(destination, { mode: 0o600 }));
        resolve(hash.digest("hex"));
      } catch (error) {
        reject(error);
      }
    }).on("error", reject);
  });
}

async function downloadAndHash(url, fileName, redirectCount = 0, headers = { "User-Agent": "vintrace-release-verifier" }) {
  const tempPath = path.join(os.tmpdir(), `vintrace-release-${process.pid}-${crypto.randomBytes(6).toString("hex")}-${fileName.replace(/[^a-z0-9_.-]/gi, "_")}`);
  try {
    return await downloadToFileAndHash(url, tempPath, fileName, redirectCount, headers);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function downloadBuffer(url, redirectCount = 0, headers = { "User-Agent": "vintrace-release-verifier" }) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (response) => {
      const location = resolveRedirect(url, response.headers);
      if (location && [301, 302, 303, 307, 308].includes(response.statusCode || 0)) {
        response.resume();
        if (redirectCount >= 5) {
          reject(new Error(`Too many redirects while downloading ${url}`));
          return;
        }
        resolve(downloadBuffer(location, redirectCount + 1, { "User-Agent": "vintrace-release-verifier" }));
        return;
      }
      if ((response.statusCode || 0) >= 400) {
        response.resume();
        reject(new Error(`Download ${url} failed with ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

// The release's SHA256SUMS.txt is the real integrity manifest. GitHub's API
// asset objects have NO `digest` field, so the previous asset.digest-based
// checks were a silent no-op — parse the published checksums instead.
function parseChecksums(text) {
  return new Map(parseChecksumText(text).map((entry) => [entry.name.toLowerCase(), entry.sha256]));
}

// Origin proof: an Ed25519 detached signature over the exact SHA256SUMS.txt
// bytes. Verified only when a release public key is configured; prevents a
// release-endpoint compromise from swapping binary + checksums together.
function verifyChecksumSignature(checksumBytes, signatureBytes, publicKeyPem) {
  try {
    return crypto.verify(null, checksumBytes, crypto.createPublicKey(publicKeyPem), signatureBytes);
  } catch {
    return false;
  }
}

function assetByPattern(assets, pattern) {
  return assets.find((asset) => pattern.test(asset.name));
}

function assetByName(assets, name) {
  const expected = String(name).toLowerCase();
  return assets.find((asset) => String(asset.name).toLowerCase() === expected);
}

function releasePlatformSets(assets, platform) {
  const normalized = String(platform || "").toLowerCase();
  const requested = normalized === "all"
    ? ["darwin", "win32", "linux"]
    : normalized.startsWith("darwin") || normalized === "macos"
      ? ["darwin"]
      : normalized === "windows" || normalized.startsWith("win32")
        ? ["win32"]
        : normalized === "linux"
          ? ["linux"]
          : [];
  return requested.map((id) => {
    const isMac = id === "darwin";
    const isLinux = id === "linux";
    return {
      id,
      label: isMac ? "macOS" : isLinux ? "Linux" : "Windows",
      isMac,
      isLinux,
      installer: assetByPattern(assets, isMac ? /\.dmg$/i : isLinux ? /\.AppImage$/i : /\.exe$/i),
      updater: isMac ? assetByPattern(assets, /\.zip$/i) : isLinux ? null : assetByPattern(assets, /\.exe\.blockmap$/i),
      metadata: assetByPattern(assets, isMac ? /^latest-mac\.ya?ml$/i : isLinux ? /^latest-linux\.ya?ml$/i : /^latest\.ya?ml$/i),
      deb: isLinux ? assetByPattern(assets, /\.deb$/i) : null,
      rpm: isLinux ? assetByPattern(assets, /\.rpm$/i) : null,
      mcpb: isMac
        ? assetByPattern(assets, /^Vintrace-darwin-[A-Za-z0-9_.-]+\.mcpb$/)
        : isLinux
          ? null
          : assetByPattern(assets, /^Vintrace-win32-[A-Za-z0-9_.-]+\.mcpb$/),
    };
  });
}

function validatePublishedBuildMetadata(metadata, options = {}) {
  const repository = String(options.repository || "");
  const tag = String(options.tag || "");
  const platform = String(options.platform || "").toLowerCase();
  const checksumMap = options.checksumMap;
  const sourceDigest = String(options.sourceDigest || "");
  invariant(/^[^/]+\/[^/]+$/.test(repository), "Published build metadata verification requires owner/repository");
  invariant(/^v[^/]+$/.test(tag), "Published build metadata verification requires one v-prefixed tag");
  invariant(checksumMap instanceof Map, "Published build metadata verification requires the parsed checksum map");
  validateBuildMetadata(metadata, { name: "Vintrace", version: tag.slice(1) });
  invariant(metadata.source?.repository === repository, "Published build metadata repository does not match the release repository");
  invariant(metadata.source?.ref === `refs/tags/${tag}`, "Published build metadata source ref does not match the release tag");
  invariant(metadata.source?.dirty === false, "Published build metadata reports a dirty source tree");
  if (sourceDigest) invariant(metadata.source?.commit === sourceDigest, "Published build metadata commit does not match the verified source commit");
  if (platform === "all") invariant(metadata.declaredBuildContext?.releaseAssembly != null, "Cross-platform release build metadata is missing its assembly manifest");
  for (const record of [...metadata.artifacts, ...metadata.sbom.outputs]) {
    invariant(checksumMap.get(record.path.toLowerCase()) === record.sha256.toLowerCase(), `Published build metadata record does not match ${CHECKSUM_NAME}: ${record.path}`);
  }
  return true;
}

async function main() {
  add("repo argument", /^[^/]+\/[^/]+$/.test(options.repo), options.repo || "missing owner/repo");
  add("tag argument", Boolean(options.tag), options.tag || "missing release tag");
  const platformSets = releasePlatformSets([], options.platform);
  add("platform argument", platformSets.length > 0, options.platform || "missing platform (darwin, win32, linux, or all)");
  if (!checks.every((check) => check.ok)) {
    throw new Error("Missing required release verifier arguments.");
  }

  const apiUrl = `https://api.github.com/repos/${options.repo}/releases/tags/${encodeURIComponent(options.tag)}`;
  const releaseResponse = await githubRequest(apiUrl);
  const release = JSON.parse(releaseResponse.body);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const resolvedPlatforms = releasePlatformSets(assets, options.platform);
  const checksumAsset = assetByName(assets, CHECKSUM_NAME);
  const cycloneDxAsset = assetByName(assets, CYCLONEDX_NAME);
  const spdxAsset = assetByName(assets, SPDX_NAME);
  const buildMetadataAsset = assetByName(assets, BUILD_METADATA_NAME);

  add(
    options.allowDraft ? "release exists for staged verification" : "release is published",
    options.allowDraft || !release.draft,
    release.draft
      ? (options.allowDraft ? "draft release accepted for staged verification" : "draft release")
      : "published release",
    { url: release.html_url, draft: Boolean(release.draft) }
  );
  for (const platform of resolvedPlatforms) {
    const prefix = resolvedPlatforms.length === 1 ? "" : `${platform.label} `;
    add(`${prefix}installer asset exists`, Boolean(platform.installer), platform.installer?.name || `missing ${platform.isMac ? ".dmg" : platform.isLinux ? ".AppImage" : ".exe"}`);
    if (platform.isLinux) {
      add(`${prefix}deb asset exists`, Boolean(platform.deb), platform.deb?.name || "missing .deb");
      add(`${prefix}rpm asset exists`, Boolean(platform.rpm), platform.rpm?.name || "missing .rpm");
    } else {
      add(`${prefix}MCPB asset exists`, Boolean(platform.mcpb), platform.mcpb?.name || `missing ${platform.isMac ? "darwin" : "win32"} MCPB`);
    }
    add(`${prefix}update metadata exists`, Boolean(platform.metadata), platform.metadata?.name || `missing ${platform.isMac ? "latest-mac.yml" : platform.isLinux ? "latest-linux.yml" : "latest.yml"}`);
    add(
      `${prefix}delta/update companion exists`,
      platform.isLinux ? Boolean(platform.installer) : Boolean(platform.updater),
      platform.isLinux
        ? (platform.installer ? `${platform.installer.name} embeds its AppImage blockmap` : "missing .AppImage")
        : platform.updater?.name || `missing ${platform.isMac ? ".zip" : ".exe.blockmap"}`
    );
  }
  if (options.requireReleaseMetadata) {
    add("checksum asset exists", Boolean(checksumAsset), checksumAsset?.name || `missing ${CHECKSUM_NAME}`);
    add("CycloneDX SBOM asset exists", Boolean(cycloneDxAsset), cycloneDxAsset?.name || `missing ${CYCLONEDX_NAME}`);
    add("SPDX SBOM asset exists", Boolean(spdxAsset), spdxAsset?.name || `missing ${SPDX_NAME}`);
    add("build metadata asset exists", Boolean(buildMetadataAsset), buildMetadataAsset?.name || `missing ${BUILD_METADATA_NAME}`);
    for (const legacy of LEGACY_RELEASE_METADATA_NAMES) {
      add(`legacy metadata absent ${legacy}`, !assetByName(assets, legacy), assetByName(assets, legacy)?.name || "absent");
    }
  }

  // Download and parse SHA256SUMS.txt — the actual integrity manifest.
  let checksumMap = new Map();
  let checksumRows = [];
  let checksumBytes = null;
  if (checksumAsset) {
    try {
      checksumBytes = await downloadBuffer(assetDownloadUrl(checksumAsset), 0, assetDownloadHeaders(checksumAsset));
      checksumRows = parseChecksumText(checksumBytes.toString("utf8"));
      checksumMap = parseChecksums(checksumBytes.toString("utf8"));
      add("SHA256SUMS.txt parsed", checksumMap.size > 0, `${checksumMap.size} checksum entrie(s)`);
      // Origin proof: require a valid signature over SHA256SUMS.txt when a
      // release public key is configured (VINTRACE_RELEASE_PUBKEY -> PEM path).
      const pubKeyPath = process.env.VINTRACE_RELEASE_PUBKEY || "";
      if (pubKeyPath) {
        const sigAsset = assetByPattern(assets, /^SHA256SUMS\.txt\.sig$/i);
        if (!sigAsset) {
          add("SHA256SUMS signature present", false, "missing SHA256SUMS.txt.sig (release public key configured)");
        } else {
          const sigBytes = await downloadBuffer(assetDownloadUrl(sigAsset), 0, assetDownloadHeaders(sigAsset));
          const pubKeyPem = fs.readFileSync(pubKeyPath, "utf8");
          add("SHA256SUMS signature valid", verifyChecksumSignature(checksumBytes, sigBytes, pubKeyPem), "Ed25519 over SHA256SUMS.txt");
        }
      }
    } catch (error) {
      add("SHA256SUMS.txt parsed", false, error.message || String(error));
    }
  } else if (options.requireReleaseMetadata) {
    add("SHA256SUMS.txt parsed", false, "missing SHA256SUMS.txt");
  }

  for (const platform of resolvedPlatforms) {
    const prefix = resolvedPlatforms.length === 1 ? "" : `${platform.label} `;
    if (platform.installer) {
      const minimumSize = platform.isMac ? 50 * 1024 * 1024 : platform.isLinux ? 40 * 1024 * 1024 : 80 * 1024 * 1024;
      add(`${prefix}installer size is sane`, platform.installer.size >= minimumSize, `${platform.installer.name}: ${platform.installer.size} bytes`, { size: platform.installer.size });
      add(`${prefix}installer listed in SHA256SUMS`, checksumMap.has(String(platform.installer.name).toLowerCase()), platform.installer.name);
      if (options.allowDraft) {
        add(`${prefix}installer staged download is authenticated`, Boolean(platform.installer.url), platform.installer.name);
      } else {
        const head = await headRequest(platform.installer.browser_download_url);
        add(`${prefix}installer download is public`, [200, 302].includes(head.statusCode || 0), `${platform.installer.browser_download_url} -> ${head.statusCode}`);
      }
    }
    if (platform.mcpb) {
      add(`${prefix}MCPB listed in SHA256SUMS`, checksumMap.has(String(platform.mcpb.name).toLowerCase()), platform.mcpb.name);
    }
    if (platform.metadata) {
      if (options.allowDraft) {
        add(`${prefix}metadata staged download is authenticated`, Boolean(platform.metadata.url), platform.metadata.name);
      } else {
        const head = await headRequest(platform.metadata.browser_download_url);
        add(`${prefix}metadata download is public`, [200, 302].includes(head.statusCode || 0), `${platform.metadata.browser_download_url} -> ${head.statusCode}`);
      }
    }
  }
  const expectedBundles = checksumRows.length > 0 ? expectedSupplyChainBundles(checksumRows) : [];
  if (options.requireReleaseMetadata) {
    for (const expected of expectedBundles) {
      const asset = assetByName(assets, expected.name);
      add(`signed evidence exists ${expected.name}`, Boolean(asset), asset?.name || "missing");
    }
  }

  let tempRoot = "";
  const localAssets = new Map();
  async function ensureLocalAsset(asset) {
    const name = safeReleaseName(asset.name);
    if (localAssets.has(name.toLowerCase())) return localAssets.get(name.toLowerCase());
    if (!tempRoot) tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-release-evidence-"));
    const file = path.join(tempRoot, name);
    const digest = await downloadToFileAndHash(assetDownloadUrl(asset), file, name, 0, assetDownloadHeaders(asset));
    const result = { file, digest };
    localAssets.set(name.toLowerCase(), result);
    return result;
  }

  for (const entry of checksumRows) {
    const asset = assetByName(assets, entry.name);
    add(`checksummed subject exists ${entry.name}`, Boolean(asset), asset?.name || "missing");
    if (!asset || (!options.full && !options.verifySignatures)) continue;
    try {
      const actual = options.verifySignatures
        ? (await ensureLocalAsset(asset)).digest
        : await downloadAndHash(assetDownloadUrl(asset), asset.name, 0, assetDownloadHeaders(asset));
      add(`sha256 ${entry.name}`, actual === entry.sha256, actual === entry.sha256 ? entry.sha256 : `${actual} != ${entry.sha256}`);
    } catch (error) {
      add(`sha256 ${entry.name}`, false, error.message || String(error));
    }
  }

  if (buildMetadataAsset && options.full) {
    try {
      const local = await ensureLocalAsset(buildMetadataAsset);
      validatePublishedBuildMetadata(readJson(local.file), {
        repository: options.repo,
        tag: options.tag,
        platform: options.platform,
        checksumMap,
        sourceDigest: process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || "",
      });
      add("published build metadata verified", true, `${options.repo}@refs/tags/${options.tag}`);
    } catch (error) {
      add("published build metadata verified", false, error.message || String(error));
    }
  }

  for (const expected of expectedBundles) {
    const asset = assetByName(assets, expected.name);
    if (!asset) continue;
    try {
      let payload;
      if (options.verifySignatures) {
        const local = await ensureLocalAsset(asset);
        payload = JSON.parse(fs.readFileSync(local.file, "utf8"));
      } else {
        payload = JSON.parse((await downloadBuffer(assetDownloadUrl(asset), 0, assetDownloadHeaders(asset))).toString("utf8"));
      }
      validateSigstoreBundle(payload, expected.kind);
      add(`signed evidence structure ${expected.name}`, true, expected.kind);
    } catch (error) {
      add(`signed evidence structure ${expected.name}`, false, error.message || String(error));
    }
  }

  if (options.verifySignatures) {
    add("signature verification requires full release metadata", options.requireReleaseMetadata && options.full, options.requireReleaseMetadata && options.full ? "enabled" : "use --full --require-release-metadata");
    if (!tempRoot) tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-release-evidence-"));
    if (checksumBytes) fs.writeFileSync(path.join(tempRoot, CHECKSUM_NAME), checksumBytes, { mode: 0o600 });
    const repository = options.repo;
    const workflowPath = process.env.VINTRACE_GITHUB_WORKFLOW_PATH || "";
    const sourceDigest = process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || "";
    const sourceRef = process.env.GITHUB_REF || "";
    const identity = `https://github.com/${repository}/${workflowPath}@${sourceRef}`;
    try {
      const verified = verifyCosignBundles({ dist: tempRoot, identity });
      add("keyless cosign signatures verified", verified.ok, `${verified.subjects} subject(s), ${verified.identity}`);
    } catch (error) {
      add("keyless cosign signatures verified", false, error.message || String(error));
    }
    try {
      const verified = verifyGithubAttestations({
        dist: tempRoot,
        repository,
        workflowPath,
        sourceDigest,
        sourceRef,
      });
      add("GitHub attestations verified", verified.ok, `${verified.verifications} subject/predicate verification(s), ${verified.identity}`);
    } catch (error) {
      add("GitHub attestations verified", false, error.message || String(error));
    }
  }

  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });

  const ok = checks.every((check) => check.ok);
  const result = {
    generatedAt: new Date().toISOString(),
    ok,
    repo: options.repo,
    tag: options.tag,
    platform: options.platform,
    full: options.full,
    requireReleaseMetadata: options.requireReleaseMetadata,
    verifySignatures: options.verifySignatures,
    allowDraft: options.allowDraft,
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
  process.exitCode = ok ? 0 : 1;
}

if (require.main === module) main().catch((error) => {
  add("release verifier", false, error.message || String(error));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    ok: false,
    repo: options.repo,
    tag: options.tag,
    platform: options.platform,
    full: options.full,
    requireReleaseMetadata: options.requireReleaseMetadata,
    verifySignatures: options.verifySignatures,
    allowDraft: options.allowDraft,
    checks
  }, null, 2));
  process.exitCode = 1;
});

module.exports = {
  assetByName,
  assetByPattern,
  releasePlatformSets,
  validatePublishedBuildMetadata,
};

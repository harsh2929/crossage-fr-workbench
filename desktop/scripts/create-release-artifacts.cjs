#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CHECKSUM_SIGNATURE_NAME,
  CYCLONEDX_NAME,
  LEGACY_RELEASE_METADATA_NAMES,
  RELEASE_METADATA_NAMES,
  SPDX_NAME,
  SYFT_VERSION,
  invariant,
  parseChecksumText,
  safeReleaseName,
  sha256File,
  validateSbomFiles,
  validateReleaseAssembly,
  writeFileAtomic,
  writeJsonAtomic,
} = require("./release-supply-chain.cjs");

const defaultRepoRoot = path.resolve(__dirname, "..", "..");
const installerExtensions = new Set([".appimage", ".deb", ".dmg", ".exe", ".mcpb", ".msi", ".pkg", ".rpm", ".snap", ".zip"]);
const sbomInputFiles = Object.freeze([
  "package.json",
  "package-lock.json",
  "requirements-production.lock.txt",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitValue(repoRoot, args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function isReleaseArtifactName(name, options = {}) {
  const includeMetadata = options.includeMetadata !== false;
  const value = String(name || "");
  const lower = value.toLowerCase();
  if (!lower || lower === CHECKSUM_NAME.toLowerCase() || lower === CHECKSUM_SIGNATURE_NAME.toLowerCase()) {
    return false;
  }
  if (lower.endsWith(".sigstore.json")) return false;
  if ([...RELEASE_METADATA_NAMES].some((item) => item.toLowerCase() === lower)) {
    return includeMetadata;
  }
  if (lower.endsWith(".blockmap") || lower.endsWith(".yml")) return true;
  return installerExtensions.has(path.extname(lower));
}

function releaseArtifactFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isReleaseArtifactName(entry.name, options))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function artifactRecord(file, root) {
  const stat = fs.statSync(file);
  const relative = path.relative(root, file).replace(/\\/g, "/");
  safeReleaseName(relative);
  return {
    path: relative,
    bytes: stat.size,
    sha256: sha256File(file),
  };
}

function checksumLines(records) {
  return records
    .map((record) => `${record.sha256}  ${record.path}`)
    .sort((a, b) => a.localeCompare(b));
}

function cleanPreviousEvidence(dist) {
  if (!fs.existsSync(dist)) return;
  const fixed = new Set([
    CHECKSUM_NAME,
    CHECKSUM_SIGNATURE_NAME,
    ...RELEASE_METADATA_NAMES,
    ...LEGACY_RELEASE_METADATA_NAMES,
  ].map((name) => name.toLowerCase()));
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (fixed.has(entry.name.toLowerCase()) || entry.name.toLowerCase().endsWith(".sigstore.json")) {
      fs.rmSync(path.join(dist, entry.name), { force: true });
    }
  }
}

function syftVersion(syftBin, execFileSyncImpl = execFileSync) {
  let output;
  try {
    output = execFileSyncImpl(syftBin, ["version", "-o", "json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message || String(error);
    throw new Error(`Could not run Syft at ${syftBin}: ${detail}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`Syft at ${syftBin} did not return JSON version metadata`);
  }
  invariant(parsed.application === "syft", `Expected Syft, got ${parsed.application || "unknown tool"}`);
  invariant(parsed.version === SYFT_VERSION, `Release SBOM generation requires Syft ${SYFT_VERSION}, got ${parsed.version || "unknown"}`);
  return parsed;
}

function generateSboms({ repoRoot, dist, product, syftBin, execFileSyncImpl = execFileSync }) {
  const version = syftVersion(syftBin, execFileSyncImpl);
  const suffix = `.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  const cycloneDxTemp = path.join(dist, `${CYCLONEDX_NAME}${suffix}`);
  const spdxTemp = path.join(dist, `${SPDX_NAME}${suffix}`);
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-sbom-input-"));
  const args = [
    "scan",
    "dir:.",
    "--source-name",
    product.name,
    "--source-version",
    product.version,
  ];
  args.push("-o", `cyclonedx-json=${cycloneDxTemp}`, "-o", `spdx-json=${spdxTemp}`);

  try {
    for (const name of sbomInputFiles) {
      const source = path.join(repoRoot, name);
      invariant(fs.existsSync(source) && fs.statSync(source).isFile(), `SBOM input manifest is missing: ${name}`);
      fs.copyFileSync(source, path.join(sourceDir, name));
    }
    execFileSyncImpl(syftBin, args, {
      cwd: sourceDir,
      encoding: "utf8",
      env: {
        ...process.env,
        SYFT_CHECK_FOR_APP_UPDATE: "false",
        SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES: "true",
      },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const summary = validateSbomFiles(cycloneDxTemp, spdxTemp, product);
    fs.renameSync(cycloneDxTemp, path.join(dist, CYCLONEDX_NAME));
    fs.renameSync(spdxTemp, path.join(dist, SPDX_NAME));
    return { summary, version };
  } catch (error) {
    fs.rmSync(cycloneDxTemp, { force: true });
    fs.rmSync(spdxTemp, { force: true });
    fs.rmSync(path.join(dist, CYCLONEDX_NAME), { force: true });
    fs.rmSync(path.join(dist, SPDX_NAME), { force: true });
    const detail = error.stderr ? String(error.stderr).trim() : error.message || String(error);
    throw new Error(`Standard SBOM generation failed: ${detail}`);
  } finally {
    fs.rmSync(sourceDir, { recursive: true, force: true });
  }
}

function repositoryName(pkg) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const publish = Array.isArray(pkg.build?.publish) ? pkg.build.publish[0] : null;
  return publish?.owner && publish?.repo ? `${publish.owner}/${publish.repo}` : "";
}

function createReleaseArtifacts(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const dist = options.dist || path.join(repoRoot, "dist");
  const packagePath = path.join(repoRoot, "package.json");
  const pkg = readJson(packagePath);
  const product = { name: pkg.build?.productName || pkg.name, version: pkg.version };
  const syftBin = options.syftBin || process.env.VINTRACE_SYFT_BIN || "syft";
  fs.mkdirSync(dist, { recursive: true });
  cleanPreviousEvidence(dist);

  const releaseFiles = releaseArtifactFiles(dist, { includeMetadata: false });
  invariant(releaseFiles.length > 0, "No top-level installer, updater, or MCPB release artifacts were found in dist");
  const payloadRecords = releaseFiles.map((file) => artifactRecord(file, dist));
  const generatedAt = new Date().toISOString();
  const commit = process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || gitValue(repoRoot, ["rev-parse", "HEAD"], "local");
  const refName = process.env.VINTRACE_BUILD_REF || process.env.GITHUB_REF_NAME || gitValue(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"], "");
  const sourceRef = process.env.VINTRACE_BUILD_SOURCE_REF || process.env.GITHUB_REF || refName;
  const repository = repositoryName(pkg);
  let releaseAssembly = null;
  const assemblyManifestPath = options.assemblyManifestPath || process.env.VINTRACE_RELEASE_ASSEMBLY_MANIFEST || "";
  if (assemblyManifestPath) {
    invariant(!gitValue(repoRoot, ["status", "--porcelain"], ""), "Aggregate release source became dirty before evidence generation");
    releaseAssembly = readJson(path.resolve(assemblyManifestPath));
    validateReleaseAssembly(releaseAssembly, {
      product,
      source: { commit, ref: sourceRef, repository },
      artifacts: payloadRecords,
    });
  }

  const sbomResult = generateSboms({
    repoRoot,
    dist,
    product,
    syftBin,
    execFileSyncImpl: options.execFileSyncImpl,
  });
  const sbomRecords = [CYCLONEDX_NAME, SPDX_NAME].map((name) => artifactRecord(path.join(dist, name), dist));
  const buildMetadata = {
    schemaVersion: 1,
    generatedAt,
    product: {
      name: product.name,
      packageName: pkg.name,
      appId: pkg.build?.appId || "",
      version: product.version,
      license: pkg.license || "UNLICENSED",
    },
    source: {
      repository,
      commit,
      ref: sourceRef,
      refName,
      dirty: Boolean(gitValue(repoRoot, ["status", "--porcelain"], "")),
    },
    declaredBuildContext: {
      os: `${os.type()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: Boolean(process.env.CI),
      githubRunId: process.env.GITHUB_RUN_ID || "",
      githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT || "",
      githubWorkflow: process.env.GITHUB_WORKFLOW || "",
      runnerEnvironment: process.env.RUNNER_ENVIRONMENT || "",
      releaseAssembly,
    },
    sbom: {
      generator: {
        name: "syft",
        version: SYFT_VERSION,
        commit: sbomResult.version.gitCommit || "",
        schemaVersion: sbomResult.version.schemaVersion || "",
      },
      outputs: sbomRecords,
      inventory: sbomResult.summary,
    },
    releaseEvidencePolicy: {
      slsaSpecification: "1.2",
      minimumSlsaBuildLevel: 2,
      githubAttestationRequired: true,
      keylessCosignRequired: true,
      provenanceGeneratedSeparately: true,
      note: "This diagnostic file is not provenance; CI-generated signed attestations are the provenance evidence.",
    },
    artifacts: payloadRecords,
  };
  writeJsonAtomic(path.join(dist, BUILD_METADATA_NAME), buildMetadata);

  const metadataRecords = [CYCLONEDX_NAME, SPDX_NAME, BUILD_METADATA_NAME]
    .map((name) => artifactRecord(path.join(dist, name), dist));
  const lines = checksumLines([...payloadRecords, ...metadataRecords]);
  const checksumBytes = Buffer.from(`${lines.join("\n")}\n`, "utf8");
  parseChecksumText(checksumBytes.toString("utf8"));
  writeFileAtomic(path.join(dist, CHECKSUM_NAME), checksumBytes, { mode: 0o600 });

  let legacySigned = false;
  const privateKeyPath = process.env.VINTRACE_RELEASE_PRIVKEY || "";
  if (privateKeyPath) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyPath, "utf8"));
    invariant(privateKey.asymmetricKeyType === "ed25519", "VINTRACE_RELEASE_PRIVKEY must contain an Ed25519 private key");
    writeFileAtomic(path.join(dist, CHECKSUM_SIGNATURE_NAME), crypto.sign(null, checksumBytes, privateKey), { mode: 0o600 });
    legacySigned = true;
  }

  return {
    generatedAt,
    ok: true,
    dist,
    subjects: lines.length,
    checksums: CHECKSUM_NAME,
    legacySignature: legacySigned ? CHECKSUM_SIGNATURE_NAME : null,
    sboms: [CYCLONEDX_NAME, SPDX_NAME],
    buildMetadata: BUILD_METADATA_NAME,
    signedProvenancePending: true,
  };
}

function main() {
  console.log(JSON.stringify(createReleaseArtifacts(), null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  artifactRecord,
  checksumLines,
  cleanPreviousEvidence,
  createReleaseArtifacts,
  generateSboms,
  isReleaseArtifactName,
  releaseArtifactFiles,
  sbomInputFiles,
  syftVersion,
};

#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  CHECKSUM_NAME,
  COSIGN_VERSION,
  GITHUB_OIDC_ISSUER,
  cosignBundleName,
  invariant,
  readChecksumFile,
  validateSigstoreBundleFile,
  verifyChecksummedFiles,
} = require("./release-supply-chain.cjs");

const defaultRepoRoot = path.resolve(__dirname, "..", "..");

function cosignVersion(cosignBin, execFileSyncImpl = execFileSync) {
  let output;
  try {
    output = execFileSyncImpl(cosignBin, ["version", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message || String(error);
    throw new Error(`Could not run cosign at ${cosignBin}: ${detail}`);
  }
  let detected = "";
  try {
    const parsed = JSON.parse(output);
    detected = parsed.gitVersion || parsed.version || parsed.GitVersion || "";
  } catch {
    detected = String(output);
  }
  invariant(new RegExp(`(^|[^0-9])v?${COSIGN_VERSION.replace(/\./g, "\\.")}([^0-9]|$)`).test(detected), `Release signing requires cosign ${COSIGN_VERSION}, got ${detected || "unknown"}`);
  return detected;
}

function runCosign(cosignBin, args, execFileSyncImpl) {
  try {
    return execFileSyncImpl(cosignBin, args, {
      encoding: "utf8",
      env: { ...process.env, COSIGN_YES: "true" },
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message || String(error);
    throw new Error(`cosign ${args[0]} failed for ${path.basename(args[args.length - 1])}: ${detail}`);
  }
}

function signReleaseArtifacts(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const dist = options.dist || path.join(repoRoot, "dist");
  const cosignBin = options.cosignBin || process.env.VINTRACE_COSIGN_BIN || "cosign";
  const identity = options.identity || process.env.VINTRACE_COSIGN_IDENTITY || "";
  const issuer = options.issuer || process.env.VINTRACE_COSIGN_ISSUER || GITHUB_OIDC_ISSUER;
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  invariant(identity.startsWith("https://github.com/") && identity.includes("/.github/workflows/") && identity.includes("@refs/"), "VINTRACE_COSIGN_IDENTITY must be the exact GitHub workflow certificate identity including its ref");
  invariant(issuer === GITHUB_OIDC_ISSUER, `VINTRACE_COSIGN_ISSUER must be ${GITHUB_OIDC_ISSUER}`);
  const version = cosignVersion(cosignBin, execFileSyncImpl);

  const checksumFile = path.join(dist, CHECKSUM_NAME);
  invariant(fs.existsSync(checksumFile), `${CHECKSUM_NAME} is missing`);
  const entries = readChecksumFile(checksumFile);
  verifyChecksummedFiles(dist, entries);
  const subjects = [...entries.map((entry) => entry.name), CHECKSUM_NAME];

  for (const subjectName of subjects) {
    const subject = path.join(dist, subjectName);
    const bundle = path.join(dist, cosignBundleName(subjectName));
    fs.rmSync(bundle, { force: true });
    runCosign(cosignBin, ["sign-blob", "--yes", "--bundle", bundle, subject], execFileSyncImpl);
    invariant(fs.existsSync(bundle), `cosign did not write ${path.basename(bundle)}`);
    validateSigstoreBundleFile(bundle, "blob");
    runCosign(cosignBin, [
      "verify-blob",
      "--bundle",
      bundle,
      "--certificate-identity",
      identity,
      "--certificate-oidc-issuer",
      issuer,
      subject,
    ], execFileSyncImpl);
  }

  return {
    ok: true,
    cosignVersion: version,
    identity,
    issuer,
    subjects: subjects.length,
    bundles: subjects.map(cosignBundleName),
  };
}

function verifyCosignBundles(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const dist = options.dist || path.join(repoRoot, "dist");
  const cosignBin = options.cosignBin || process.env.VINTRACE_COSIGN_BIN || "cosign";
  const identity = options.identity || process.env.VINTRACE_COSIGN_IDENTITY || "";
  const issuer = options.issuer || process.env.VINTRACE_COSIGN_ISSUER || GITHUB_OIDC_ISSUER;
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  invariant(identity.startsWith("https://github.com/") && identity.includes("/.github/workflows/") && identity.includes("@refs/"), "VINTRACE_COSIGN_IDENTITY must be the exact GitHub workflow certificate identity including its ref");
  invariant(issuer === GITHUB_OIDC_ISSUER, `VINTRACE_COSIGN_ISSUER must be ${GITHUB_OIDC_ISSUER}`);
  const version = cosignVersion(cosignBin, execFileSyncImpl);
  const entries = readChecksumFile(path.join(dist, CHECKSUM_NAME));
  verifyChecksummedFiles(dist, entries);
  const subjects = [...entries.map((entry) => entry.name), CHECKSUM_NAME];
  for (const subjectName of subjects) {
    const subject = path.join(dist, subjectName);
    const bundle = path.join(dist, cosignBundleName(subjectName));
    invariant(fs.existsSync(bundle), `${path.basename(bundle)} is missing`);
    validateSigstoreBundleFile(bundle, "blob");
    runCosign(cosignBin, [
      "verify-blob",
      "--bundle",
      bundle,
      "--certificate-identity",
      identity,
      "--certificate-oidc-issuer",
      issuer,
      subject,
    ], execFileSyncImpl);
  }
  return {
    ok: true,
    cosignVersion: version,
    identity,
    issuer,
    subjects: subjects.length,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(signReleaseArtifacts(), null, 2));
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  cosignVersion,
  signReleaseArtifacts,
  verifyCosignBundles,
};

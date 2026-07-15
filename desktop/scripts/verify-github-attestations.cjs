#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const util = require("util");
const { execFileSync } = require("child_process");
const {
  CHECKSUM_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  GITHUB_OIDC_ISSUER,
  SPDX_NAME,
  invariant,
  readChecksumFile,
  readJson,
  safeReleaseName,
  validateSigstoreBundleFile,
  verifyChecksummedFiles,
} = require("./release-supply-chain.cjs");

const defaultRepoRoot = path.resolve(__dirname, "..", "..");

function statementFromBundle(file) {
  const bundle = readJson(file);
  validateSigstoreBundleFile(file, "attestation");
  try {
    return JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
  } catch (error) {
    throw new Error(`${path.basename(file)} has an invalid DSSE statement: ${error.message || String(error)}`);
  }
}

function validateStatementSubjects(statement, entries, bundleName) {
  invariant(statement?._type === "https://in-toto.io/Statement/v1", `${bundleName} is not an in-toto Statement v1`);
  invariant(Array.isArray(statement.subject), `${bundleName} has no statement subjects`);
  const expected = new Map(entries.map((entry) => [entry.name, entry.sha256]));
  const actual = new Map();
  for (const subject of statement.subject) {
    const name = safeReleaseName(subject?.name);
    invariant(!actual.has(name), `${bundleName} repeats subject ${name}`);
    invariant(/^[a-f0-9]{64}$/i.test(String(subject?.digest?.sha256 || "")), `${bundleName} has an invalid SHA-256 for ${name}`);
    actual.set(name, subject.digest.sha256.toLowerCase());
  }
  invariant(actual.size === expected.size, `${bundleName} subject count does not match ${CHECKSUM_NAME}`);
  for (const [name, digest] of expected) {
    invariant(actual.get(name) === digest, `${bundleName} does not bind the expected digest for ${name}`);
  }
}

function validateAttestationPredicate(statement, attestation, dist) {
  invariant(statement.predicateType === attestation.predicateType, `${attestation.file} has predicate ${statement.predicateType || "missing"}, expected ${attestation.predicateType}`);
  invariant(statement.predicate && typeof statement.predicate === "object", `${attestation.file} has no predicate`);
  if (attestation.file.includes("cyclonedx")) {
    invariant(util.isDeepStrictEqual(statement.predicate, readJson(path.join(dist, CYCLONEDX_NAME))), `${attestation.file} does not contain the generated CycloneDX SBOM`);
  } else if (attestation.file.includes("spdx")) {
    invariant(util.isDeepStrictEqual(statement.predicate, readJson(path.join(dist, SPDX_NAME))), `${attestation.file} does not contain the generated SPDX SBOM`);
  } else {
    invariant(statement.predicate.buildDefinition && statement.predicate.runDetails, `${attestation.file} does not contain SLSA provenance fields`);
  }
}

function runGhVerify({ ghBin, subject, bundle, repository, signerWorkflow, identity, sourceDigest, sourceRef, predicateType, execFileSyncImpl }) {
  const args = [
    "attestation",
    "verify",
    subject,
    "--bundle",
    bundle,
    "--repo",
    repository,
    "--signer-workflow",
    signerWorkflow,
    "--cert-identity",
    identity,
    "--cert-oidc-issuer",
    GITHUB_OIDC_ISSUER,
    "--source-digest",
    sourceDigest,
    "--source-ref",
    sourceRef,
    "--predicate-type",
    predicateType,
    "--deny-self-hosted-runners",
  ];
  try {
    execFileSyncImpl(ghBin, args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message || String(error);
    throw new Error(`GitHub attestation verification failed for ${path.basename(subject)} with ${path.basename(bundle)}: ${detail}`);
  }
}

function verifyGithubAttestations(options = {}) {
  const repoRoot = options.repoRoot || defaultRepoRoot;
  const dist = options.dist || path.join(repoRoot, "dist");
  const ghBin = options.ghBin || process.env.VINTRACE_GH_BIN || "gh";
  const repository = options.repository || process.env.GITHUB_REPOSITORY || "";
  const workflowPath = options.workflowPath || process.env.VINTRACE_GITHUB_WORKFLOW_PATH || "";
  const sourceDigest = options.sourceDigest || process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || "";
  const sourceRef = options.sourceRef || process.env.GITHUB_REF || "";
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  invariant(/^[^/]+\/[^/]+$/.test(repository), "GITHUB_REPOSITORY must be owner/repository");
  invariant(/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(workflowPath), "VINTRACE_GITHUB_WORKFLOW_PATH must name a workflow under .github/workflows");
  invariant(/^[a-f0-9]{40}$/i.test(sourceDigest), "VINTRACE_BUILD_SHA/GITHUB_SHA must be a full Git commit SHA");
  invariant(/^refs\//.test(sourceRef), "GITHUB_REF must be a full refs/... value");
  const signerWorkflow = `${repository}/${workflowPath}`;
  const identity = `https://github.com/${signerWorkflow}@${sourceRef}`;

  const checksumFile = path.join(dist, CHECKSUM_NAME);
  const entries = readChecksumFile(checksumFile);
  verifyChecksummedFiles(dist, entries);
  for (const attestation of GITHUB_ATTESTATIONS) {
    const bundle = path.join(dist, attestation.file);
    invariant(fs.existsSync(bundle), `${attestation.file} is missing`);
    const statement = statementFromBundle(bundle);
    validateStatementSubjects(statement, entries, attestation.file);
    validateAttestationPredicate(statement, attestation, dist);
    for (const entry of entries) {
      runGhVerify({
        ghBin,
        subject: path.join(dist, entry.name),
        bundle,
        repository,
        signerWorkflow,
        identity,
        sourceDigest,
        sourceRef,
        predicateType: attestation.predicateType,
        execFileSyncImpl,
      });
    }
  }

  return {
    ok: true,
    repository,
    signerWorkflow,
    identity,
    sourceDigest,
    sourceRef,
    subjects: entries.length,
    attestations: GITHUB_ATTESTATIONS.map((item) => item.file),
    verifications: entries.length * GITHUB_ATTESTATIONS.length,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verifyGithubAttestations(), null, 2));
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  statementFromBundle,
  validateAttestationPredicate,
  validateStatementSubjects,
  verifyGithubAttestations,
};

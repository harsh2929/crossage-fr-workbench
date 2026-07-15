#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { verifyCosignBundles } = require("./sign-release-artifacts.cjs");
const { verifyGithubAttestations } = require("./verify-github-attestations.cjs");
const { invariant } = require("./release-supply-chain.cjs");

const PLATFORM_EVIDENCE = Object.freeze([
  { id: "macos", workflow: ".github/workflows/macos-release.yml" },
  { id: "windows", workflow: ".github/workflows/windows-release.yml" },
  { id: "linux", workflow: ".github/workflows/linux-release.yml" },
]);

function parseArgs(argv) {
  const options = { inputs: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--macos" || arg === "--windows" || arg === "--linux") options.inputs[arg.slice(2)] = argv[++index];
    else if (arg === "--repository") options.repository = argv[++index];
    else if (arg === "--commit") options.commit = argv[++index];
    else if (arg === "--ref") options.sourceRef = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function verifyPlatformReleaseEvidence(options = {}) {
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || "");
  const commit = String(options.commit || process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || "");
  const sourceRef = String(options.sourceRef || process.env.GITHUB_REF || "");
  const verifyCosign = options.verifyCosignImpl || verifyCosignBundles;
  const verifyGithub = options.verifyGithubImpl || verifyGithubAttestations;
  invariant(/^[^/\s]+\/[^/\s]+$/.test(repository), "Platform evidence verification requires owner/repository");
  invariant(/^[a-f0-9]{40}$/i.test(commit), "Platform evidence verification requires a full Git commit SHA");
  invariant(/^refs\/tags\/[^/]+$/.test(sourceRef), "Platform evidence verification requires one exact tag ref");

  const roots = new Set();
  const results = [];
  for (const platform of PLATFORM_EVIDENCE) {
    const inputValue = options.inputs?.[platform.id];
    invariant(inputValue, `Platform evidence verification requires --${platform.id}`);
    const dist = fs.realpathSync(path.resolve(inputValue));
    invariant(fs.statSync(dist).isDirectory(), `${platform.id} evidence path is not a directory`);
    invariant(!roots.has(dist), `Platform evidence directories must be distinct: ${dist}`);
    roots.add(dist);
    const identity = `https://github.com/${repository}/${platform.workflow}@${sourceRef}`;
    const cosign = verifyCosign({ dist, identity });
    const github = verifyGithub({
      dist,
      repository,
      workflowPath: platform.workflow,
      sourceDigest: commit,
      sourceRef,
    });
    invariant(cosign?.ok === true && github?.ok === true, `${platform.id} transferred evidence did not verify`);
    results.push({
      id: platform.id,
      workflow: platform.workflow,
      identity,
      cosignSubjects: cosign.subjects,
      githubVerifications: github.verifications,
    });
  }
  return { ok: true, repository, commit, sourceRef, platforms: results };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(verifyPlatformReleaseEvidence(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  PLATFORM_EVIDENCE,
  verifyPlatformReleaseEvidence,
};

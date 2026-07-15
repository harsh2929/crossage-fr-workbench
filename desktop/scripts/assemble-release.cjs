#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CHECKSUM_SIGNATURE_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  SPDX_NAME,
  expectedSupplyChainBundles,
  invariant,
  readChecksumFile,
  readJson,
  safeReleaseName,
  sha256File,
  validateBuildMetadata,
  validateSigstoreBundleFile,
  verifyChecksummedFiles,
} = require("./release-supply-chain.cjs");
const { isReleaseArtifactName } = require("./create-release-artifacts.cjs");

const PLATFORM_CONTRACTS = Object.freeze({
  macos: {
    required: [
      [/\.dmg$/i, "signed macOS DMG"],
      [/\.zip$/i, "macOS updater ZIP"],
      [/^latest-mac\.ya?ml$/i, "macOS update metadata"],
      [/^Vintrace-darwin-[A-Za-z0-9_.-]+\.mcpb$/, "macOS MCPB"],
    ],
    allowed: [/\.dmg$/i, /\.zip$/i, /\.zip\.blockmap$/i, /^latest-mac\.ya?ml$/i, /^Vintrace-darwin-[A-Za-z0-9_.-]+\.mcpb$/],
  },
  windows: {
    required: [
      [/\.exe$/i, "Azure-signed Windows installer"],
      [/\.exe\.blockmap$/i, "Windows installer blockmap"],
      [/^latest\.ya?ml$/i, "Windows update metadata"],
      [/^Vintrace-win32-[A-Za-z0-9_.-]+\.mcpb$/, "Windows MCPB"],
    ],
    allowed: [/\.exe$/i, /\.exe\.blockmap$/i, /^latest\.ya?ml$/i, /^Vintrace-win32-[A-Za-z0-9_.-]+\.mcpb$/],
  },
  linux: {
    required: [
      [/\.AppImage$/i, "Linux AppImage"],
      [/\.deb$/i, "Debian package"],
      [/\.rpm$/i, "RPM package"],
      [/^latest-linux\.ya?ml$/i, "Linux update metadata"],
    ],
    allowed: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /^latest-linux\.ya?ml$/i],
  },
});

function parseArgs(argv) {
  const options = { inputs: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--macos" || arg === "--windows" || arg === "--linux") {
      options.inputs[arg.slice(2)] = argv[++index];
    } else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--manifest") options.manifest = argv[++index];
    else if (arg === "--commit") options.commit = argv[++index];
    else if (arg === "--ref") options.sourceRef = argv[++index];
    else if (arg === "--repository") options.repository = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assertEmptyOutput(output, fsImpl = fs) {
  if (!fsImpl.existsSync(output)) return;
  invariant(fsImpl.statSync(output).isDirectory(), `Release assembly output is not a directory: ${output}`);
  invariant(fsImpl.readdirSync(output).length === 0, `Release assembly output must be empty: ${output}`);
}

function platformPayloadNames(input, platform, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const contract = PLATFORM_CONTRACTS[platform];
  invariant(contract, `Unknown release platform: ${platform}`);
  invariant(fsImpl.existsSync(input) && fsImpl.statSync(input).isDirectory(), `${platform} artifact directory is missing: ${input}`);

  const checksumFile = path.join(input, CHECKSUM_NAME);
  invariant(fsImpl.existsSync(checksumFile), `${platform} artifact is missing ${CHECKSUM_NAME}`);
  const entries = readChecksumFile(checksumFile, fsImpl);
  verifyChecksummedFiles(input, entries, fsImpl);

  const packageJson = options.packageJson || {};
  const product = { name: packageJson.build?.productName || packageJson.name, version: packageJson.version };
  const buildMetadata = readJson(path.join(input, BUILD_METADATA_NAME), fsImpl);
  validateBuildMetadata(buildMetadata, product);
  invariant(buildMetadata.source?.dirty === false, `${platform} build metadata reports a dirty source tree`);
  if (options.commit) invariant(buildMetadata.source?.commit === options.commit, `${platform} build commit does not match the release tag commit`);
  if (options.sourceRef) invariant(buildMetadata.source?.ref === options.sourceRef, `${platform} build ref does not match the release tag ref`);
  if (options.repository) invariant(buildMetadata.source?.repository === options.repository, `${platform} build repository does not match the release repository`);

  const payloads = entries
    .map((entry) => entry.name)
    .filter((name) => isReleaseArtifactName(name, { includeMetadata: false }));
  const expectedSubjects = new Set([...payloads, CYCLONEDX_NAME, SPDX_NAME, BUILD_METADATA_NAME].map((name) => name.toLowerCase()));
  invariant(entries.length === expectedSubjects.size && entries.every((entry) => expectedSubjects.has(entry.name.toLowerCase())), `${platform} checksum manifest contains an unexpected or missing subject`);

  const artifactRecords = new Map();
  for (const record of buildMetadata.artifacts) {
    const key = record.path.toLowerCase();
    invariant(!artifactRecords.has(key), `${platform} build metadata repeats or collides on ${record.path}`);
    artifactRecords.set(key, record);
  }
  invariant(artifactRecords.size === payloads.length, `${platform} build metadata payload inventory is not exact`);
  for (const name of payloads) {
    const file = path.join(input, name);
    const record = artifactRecords.get(name.toLowerCase());
    const stat = fsImpl.statSync(file);
    invariant(record?.path === name && record.bytes === stat.size && record.sha256 === sha256File(file), `${platform} build metadata payload record does not match ${name}`);
  }
  for (const record of buildMetadata.sbom.outputs) {
    const file = path.join(input, record.path);
    const stat = fsImpl.statSync(file);
    invariant(record.bytes === stat.size && record.sha256 === sha256File(file), `${platform} build metadata SBOM record does not match ${record.path}`);
  }

  const expectedEvidence = expectedSupplyChainBundles(entries);
  for (const evidence of expectedEvidence) {
    const evidenceFile = path.join(input, evidence.name);
    invariant(fsImpl.existsSync(evidenceFile), `${platform} artifact is missing ${evidence.name}`);
    validateSigstoreBundleFile(evidenceFile, evidence.kind);
  }
  for (const name of [CYCLONEDX_NAME, SPDX_NAME]) {
    invariant(entries.some((entry) => entry.name === name), `${platform} checksum manifest does not bind ${name}`);
  }
  for (const attestation of GITHUB_ATTESTATIONS) {
    invariant(fsImpl.existsSync(path.join(input, attestation.file)), `${platform} artifact is missing ${attestation.file}`);
  }

  const expectedFiles = new Set([
    CHECKSUM_NAME,
    ...entries.map((entry) => entry.name),
    ...expectedEvidence.map((item) => item.name),
  ].map((name) => name.toLowerCase()));
  if (fsImpl.existsSync(path.join(input, CHECKSUM_SIGNATURE_NAME))) expectedFiles.add(CHECKSUM_SIGNATURE_NAME.toLowerCase());
  const actualFiles = fsImpl.readdirSync(input, { withFileTypes: true });
  for (const entry of actualFiles) {
    invariant(entry.isFile() && !entry.isSymbolicLink(), `${platform} artifact contains a non-file entry: ${entry.name}`);
    safeReleaseName(entry.name);
    invariant(expectedFiles.has(entry.name.toLowerCase()), `${platform} artifact contains an unexpected file: ${entry.name}`);
  }
  invariant(actualFiles.length === expectedFiles.size, `${platform} artifact file inventory is incomplete`);

  invariant(payloads.length > 0, `${platform} artifact contains no release payloads`);
  for (const name of payloads) {
    safeReleaseName(name);
    invariant(contract.allowed.some((pattern) => pattern.test(name)), `${platform} artifact contains an unexpected payload: ${name}`);
  }
  for (const [pattern, label] of contract.required) {
    const matches = payloads.filter((name) => pattern.test(name));
    invariant(matches.length === 1, `${platform} artifact must contain exactly one ${label}`);
  }
  return {
    buildMetadata,
    checksumSha256: sha256File(checksumFile, fsImpl),
    entries,
    payloads: payloads.sort((left, right) => left.localeCompare(right)),
  };
}

function assembleRelease(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const root = options.root || path.resolve(__dirname, "..", "..");
  const output = path.resolve(options.output || path.join(root, "dist"));
  const packageJson = options.packageJson || readJson(path.join(root, "package.json"), fsImpl);
  const commit = String(options.commit || "");
  const sourceRef = String(options.sourceRef || "");
  const publish = Array.isArray(packageJson.build?.publish) ? packageJson.build.publish[0] : null;
  const repository = String(options.repository || process.env.GITHUB_REPOSITORY || (publish?.owner && publish?.repo ? `${publish.owner}/${publish.repo}` : ""));
  invariant(/^[a-f0-9]{40}$/i.test(commit), "Release assembly requires a full 40-character --commit");
  invariant(/^refs\/tags\/[^/]+$/.test(sourceRef), "Release assembly requires one exact refs/tags/... --ref");
  invariant(/^[^/\s]+\/[^/\s]+$/.test(repository), "Release assembly requires --repository owner/repository");
  assertEmptyOutput(output, fsImpl);
  fsImpl.mkdirSync(output, { recursive: true });

  const copied = new Map();
  const platforms = [];
  for (const platform of Object.keys(PLATFORM_CONTRACTS)) {
    const inputValue = options.inputs?.[platform];
    invariant(inputValue, `Release assembly requires --${platform}`);
    const input = path.resolve(inputValue);
    const inspected = platformPayloadNames(input, platform, { fsImpl, packageJson, commit, sourceRef, repository });
    for (const name of inspected.payloads) {
      const normalized = name.toLowerCase();
      invariant(!copied.has(normalized), `Release payload filename collision: ${name} from ${platform} and ${copied.get(normalized)}`);
      const source = path.join(input, name);
      const stat = fsImpl.lstatSync(source);
      invariant(stat.isFile() && !stat.isSymbolicLink(), `Release payload must be a regular file: ${source}`);
      fsImpl.copyFileSync(source, path.join(output, name));
      copied.set(normalized, platform);
    }
    platforms.push({
      id: platform,
      sourceCommit: inspected.buildMetadata.source.commit,
      sourceRef: inspected.buildMetadata.source.ref,
      sourceChecksumSha256: inspected.checksumSha256,
      payloads: inspected.payloads.map((name) => ({ name, sha256: sha256File(path.join(output, name), fsImpl) })),
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: { commit, ref: sourceRef, repository },
    product: { name: packageJson.build?.productName || packageJson.name, version: packageJson.version },
    platforms,
    payloadCount: copied.size,
  };
  if (options.manifest) {
    const destination = path.resolve(options.manifest);
    fsImpl.mkdirSync(path.dirname(destination), { recursive: true });
    fsImpl.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }
  return manifest;
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(assembleRelease(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  PLATFORM_CONTRACTS,
  assembleRelease,
  platformPayloadNames,
};

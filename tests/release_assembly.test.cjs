"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { assembleRelease } = require("../desktop/scripts/assemble-release.cjs");
const { verifyPlatformReleaseEvidence } = require("../desktop/scripts/verify-platform-release-evidence.cjs");
const { releasePlatformSets } = require("../desktop/scripts/verify-release-assets.cjs");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  SIGSTORE_BUNDLE_MEDIA_TYPE,
  SPDX_NAME,
  expectedSupplyChainBundles,
} = require("../desktop/scripts/release-supply-chain.cjs");

const COMMIT = "a".repeat(40);
const SOURCE_REF = "refs/tags/v0.1.0";
const REPOSITORY = "owner/repo";
const PACKAGE_JSON = {
  name: "vintrace",
  version: "0.1.0",
  build: { productName: "Vintrace", publish: [{ owner: "owner", repo: "repo" }] },
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function blobBundle() {
  return {
    mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
    verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
    messageSignature: { messageDigest: { algorithm: "SHA2_256", digest: "ZGlnZXN0" }, signature: "c2ln" },
  };
}

function attestationBundle() {
  return {
    mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
    verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
    dsseEnvelope: { payload: "e30=", payloadType: "application/vnd.in-toto+json", signatures: [{ sig: "c2ln" }] },
  };
}

function platformPayloads(platform, extra = []) {
  if (platform === "macos") {
    return ["Vintrace-0.1.0-arm64.dmg", "Vintrace-0.1.0-mac.zip", "latest-mac.yml", "Vintrace-darwin-arm64.mcpb", ...extra];
  }
  if (platform === "windows") {
    return ["Vintrace.Setup.0.1.0.exe", "Vintrace.Setup.0.1.0.exe.blockmap", "latest.yml", "Vintrace-win32-x64.mcpb", ...extra];
  }
  return ["Vintrace-0.1.0-linux-x86_64.AppImage", "vintrace_0.1.0_amd64.deb", "vintrace-0.1.0.x86_64.rpm", "latest-linux.yml", ...extra];
}

function writePlatformArtifact(root, platform, options = {}) {
  const folder = path.join(root, platform);
  const payloads = platformPayloads(platform, options.extraPayloads || []).filter((name) => name !== options.omit);
  for (const name of payloads) write(path.join(folder, name), `${platform}:${name}`);
  write(path.join(folder, CYCLONEDX_NAME), "cyclonedx");
  write(path.join(folder, SPDX_NAME), "spdx");
  const metadata = {
    schemaVersion: 1,
    generatedAt: "2026-07-14T00:00:00Z",
    product: { name: "Vintrace", version: "0.1.0" },
    source: { repository: REPOSITORY, commit: options.commit || COMMIT, ref: options.sourceRef || SOURCE_REF, dirty: false },
    artifacts: payloads.map((name) => ({ path: name, bytes: fs.statSync(path.join(folder, name)).size, sha256: sha256(fs.readFileSync(path.join(folder, name))) })),
    sbom: {
      generator: { name: "syft", version: "1.44.0" },
      outputs: [
        { path: CYCLONEDX_NAME, bytes: 9, sha256: sha256("cyclonedx") },
        { path: SPDX_NAME, bytes: 4, sha256: sha256("spdx") },
      ],
    },
    releaseEvidencePolicy: {
      minimumSlsaBuildLevel: 2,
      githubAttestationRequired: true,
      keylessCosignRequired: true,
      provenanceGeneratedSeparately: true,
    },
  };
  write(path.join(folder, BUILD_METADATA_NAME), JSON.stringify(metadata));
  const subjects = [...payloads, CYCLONEDX_NAME, SPDX_NAME, BUILD_METADATA_NAME];
  const entries = subjects.map((name) => ({ name, sha256: sha256(fs.readFileSync(path.join(folder, name))) }));
  write(path.join(folder, CHECKSUM_NAME), `${entries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n")}\n`);
  for (const evidence of expectedSupplyChainBundles(entries)) {
    write(path.join(folder, evidence.name), JSON.stringify(evidence.kind === "attestation" ? attestationBundle() : blobBundle()));
  }
  for (const item of GITHUB_ATTESTATIONS) assert.ok(fs.existsSync(path.join(folder, item.file)));
  return folder;
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-release-assembly-"));
  const inputs = Object.fromEntries(["macos", "windows", "linux"].map((platform) => [platform, writePlatformArtifact(root, platform)]));
  return { root, inputs, output: path.join(root, "output"), manifest: path.join(root, "assembly.json") };
}

{
  const value = fixture();
  try {
    const result = assembleRelease({
      root: value.root,
      inputs: value.inputs,
      output: value.output,
      manifest: value.manifest,
      commit: COMMIT,
      sourceRef: SOURCE_REF,
      packageJson: PACKAGE_JSON,
    });
    assert.equal(result.platforms.length, 3);
    assert.equal(result.payloadCount, 12);
    assert.deepEqual(fs.readdirSync(value.output).sort(), Object.values(value.inputs).flatMap((folder) => platformPayloads(path.basename(folder))).sort());
    assert.deepEqual(JSON.parse(fs.readFileSync(value.manifest, "utf8")), result);
    assert.equal(fs.existsSync(path.join(value.output, CHECKSUM_NAME)), false, "platform evidence must not collide in aggregate output");
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const value = fixture();
  try {
    fs.appendFileSync(path.join(value.inputs.macos, "Vintrace-0.1.0-arm64.dmg"), "tamper");
    assert.throws(() => assembleRelease({ root: value.root, inputs: value.inputs, output: value.output, commit: COMMIT, sourceRef: SOURCE_REF, packageJson: PACKAGE_JSON }), /digest mismatch/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const value = fixture();
  try {
    fs.rmSync(value.inputs.windows, { recursive: true, force: true });
    value.inputs.windows = writePlatformArtifact(value.root, "windows", { omit: "Vintrace-win32-x64.mcpb" });
    assert.throws(() => assembleRelease({ root: value.root, inputs: value.inputs, output: value.output, commit: COMMIT, sourceRef: SOURCE_REF, packageJson: PACKAGE_JSON }), /Windows MCPB/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const value = fixture();
  try {
    fs.rmSync(value.inputs.linux, { recursive: true, force: true });
    value.inputs.linux = writePlatformArtifact(value.root, "linux", { commit: "b".repeat(40) });
    assert.throws(() => assembleRelease({ root: value.root, inputs: value.inputs, output: value.output, commit: COMMIT, sourceRef: SOURCE_REF, packageJson: PACKAGE_JSON }), /build commit/);
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const assets = [
    "Vintrace-0.1.0-arm64.dmg",
    "Vintrace-0.1.0-mac.zip",
    "latest-mac.yml",
    "Vintrace-darwin-arm64.mcpb",
    "Vintrace.Setup.0.1.0.exe",
    "Vintrace.Setup.0.1.0.exe.blockmap",
    "latest.yml",
    "Vintrace-win32-x64.mcpb",
    "Vintrace-0.1.0-linux-x86_64.AppImage",
    "vintrace_0.1.0_amd64.deb",
    "vintrace-0.1.0.x86_64.rpm",
    "latest-linux.yml",
  ].map((name) => ({ name }));
  const platforms = releasePlatformSets(assets, "all");
  assert.deepEqual(platforms.map((item) => item.id), ["darwin", "win32", "linux"]);
  assert.equal(platforms[0].mcpb.name, "Vintrace-darwin-arm64.mcpb");
  assert.equal(platforms[1].updater.name, "Vintrace.Setup.0.1.0.exe.blockmap");
  assert.equal(platforms[2].rpm.name, "vintrace-0.1.0.x86_64.rpm");
  assert.deepEqual(releasePlatformSets(assets, "unsupported"), []);
}

{
  const value = fixture();
  try {
    fs.rmSync(value.inputs.macos, { recursive: true, force: true });
    value.inputs.macos = writePlatformArtifact(value.root, "macos", { extraPayloads: ["Vintrace-0.1.0-extra.dmg"] });
    assert.throws(
      () => assembleRelease({ root: value.root, inputs: value.inputs, output: value.output, commit: COMMIT, sourceRef: SOURCE_REF, packageJson: PACKAGE_JSON }),
      /exactly one signed macOS DMG/,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const value = fixture();
  try {
    write(path.join(value.inputs.linux, "unexpected.txt"), "not part of the build contract");
    assert.throws(
      () => assembleRelease({ root: value.root, inputs: value.inputs, output: value.output, commit: COMMIT, sourceRef: SOURCE_REF, packageJson: PACKAGE_JSON }),
      /unexpected file/,
    );
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

{
  const value = fixture();
  try {
    const calls = [];
    const result = verifyPlatformReleaseEvidence({
      inputs: value.inputs,
      repository: REPOSITORY,
      commit: COMMIT,
      sourceRef: SOURCE_REF,
      verifyCosignImpl: ({ dist, identity }) => {
        calls.push({ kind: "cosign", dist, identity });
        return { ok: true, subjects: 8 };
      },
      verifyGithubImpl: ({ dist, repository, workflowPath, sourceDigest, sourceRef }) => {
        calls.push({ kind: "github", dist, repository, workflowPath, sourceDigest, sourceRef });
        return { ok: true, verifications: 21 };
      },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.platforms.map((item) => item.id), ["macos", "windows", "linux"]);
    assert.equal(calls.length, 6);
    assert.ok(calls.every((call) => call.dist === fs.realpathSync(value.inputs[path.basename(call.dist)])));
    assert.deepEqual(
      calls.filter((call) => call.kind === "github").map((call) => call.workflowPath),
      [".github/workflows/macos-release.yml", ".github/workflows/windows-release.yml", ".github/workflows/linux-release.yml"],
    );
    assert.ok(calls.filter((call) => call.kind === "cosign").every((call) => call.identity.endsWith(`@${SOURCE_REF}`)));
  } finally {
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

console.log("release assembly and transferred-evidence gates ok");

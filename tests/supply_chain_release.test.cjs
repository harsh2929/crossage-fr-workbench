"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  COSIGN_VERSION,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  REQUIRED_RUNTIME_PURLS,
  SIGSTORE_BUNDLE_MEDIA_TYPE,
  SPDX_NAME,
  SYFT_VERSION,
  cosignBundleName,
  parseChecksumText,
  readChecksumFile,
  validateBuildMetadata,
  validateReleaseAssembly,
  validateSbomFiles,
  validateSigstoreBundle,
  verifyChecksummedFiles,
} = require("../desktop/scripts/release-supply-chain.cjs");
const {
  createReleaseArtifacts,
  sbomInputFiles,
} = require("../desktop/scripts/create-release-artifacts.cjs");
const {
  signReleaseArtifacts,
  verifyCosignBundles,
} = require("../desktop/scripts/sign-release-artifacts.cjs");
const {
  verifyGithubAttestations,
} = require("../desktop/scripts/verify-github-attestations.cjs");
const {
  validatePublishedBuildMetadata,
} = require("../desktop/scripts/verify-release-assets.cjs");

function run(name, fn) {
  fn();
  console.log(`ok ${name}`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(file, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(file, body, "utf8");
  return body;
}

function componentName(purl) {
  return purl.slice(purl.lastIndexOf("/") + 1, purl.lastIndexOf("@"));
}

function componentVersion(purl) {
  return purl.slice(purl.lastIndexOf("@") + 1);
}

function sbomFixture(product = { name: "Vintrace", version: "0.1.0" }) {
  const components = REQUIRED_RUNTIME_PURLS.map((purl, index) => ({
    "bom-ref": `component-${index}`,
    type: "library",
    name: componentName(purl),
    version: componentVersion(purl),
    purl,
  }));
  return {
    cycloneDx: {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
      version: 1,
      metadata: {
        timestamp: "2026-07-13T00:00:00Z",
        component: { type: "application", name: product.name, version: product.version },
        tools: { components: [{ type: "application", name: "syft", version: SYFT_VERSION }] },
      },
      components,
      dependencies: [{ ref: "root", dependsOn: components.map((component) => component["bom-ref"]) }],
    },
    spdx: {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: product.name,
      documentNamespace: "https://anchore.com/syft/dir/Vintrace-test",
      creationInfo: { created: "2026-07-13T00:00:00Z", creators: [`Tool: syft-${SYFT_VERSION}`] },
      packages: REQUIRED_RUNTIME_PURLS.map((purl, index) => ({
        name: componentName(purl),
        SPDXID: `SPDXRef-Package-${index}`,
        versionInfo: componentVersion(purl),
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl }],
      })),
      relationships: [{ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Package-0" }],
    },
  };
}

function writeSboms(dist, fixture = sbomFixture()) {
  writeJson(path.join(dist, CYCLONEDX_NAME), fixture.cycloneDx);
  writeJson(path.join(dist, SPDX_NAME), fixture.spdx);
}

function blobBundle() {
  return {
    mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
    verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
    messageSignature: { messageDigest: { algorithm: "SHA2_256", digest: "ZGlnZXN0" }, signature: "c2ln" },
  };
}

function attestationBundle(statement) {
  return {
    mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
    verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
      payloadType: "application/vnd.in-toto+json",
      signatures: [{ sig: "c2ln" }],
    },
  };
}

function statementSubjects(entries) {
  return entries.map((entry) => ({ name: entry.name, digest: { sha256: entry.sha256 } }));
}

function writeGithubBundles(dist, entries, sboms) {
  const predicates = new Map([
    ["vintrace-slsa-provenance.attestation.sigstore.json", { buildDefinition: { buildType: "https://github.com/actions/runner" }, runDetails: { builder: { id: "https://github.com/actions/runner" } } }],
    ["vintrace-cyclonedx.attestation.sigstore.json", sboms.cycloneDx],
    ["vintrace-spdx.attestation.sigstore.json", sboms.spdx],
  ]);
  for (const item of GITHUB_ATTESTATIONS) {
    writeJson(path.join(dist, item.file), attestationBundle({
      _type: "https://in-toto.io/Statement/v1",
      subject: statementSubjects(entries),
      predicateType: item.predicateType,
      predicate: predicates.get(item.file),
    }));
  }
}

run("checksum manifests reject malformed and unsafe subjects", () => {
  const valid = parseChecksumText(`${"a".repeat(64)}  Vintrace Setup.exe\n${"b".repeat(64)} *latest.yml\n`);
  assert.deepStrictEqual(valid.map((entry) => entry.name), ["Vintrace Setup.exe", "latest.yml"]);
  assert.throws(() => parseChecksumText(`${"a".repeat(64)}  ../escape.exe\n`), /Unsafe|top-level/);
  assert.throws(() => parseChecksumText(`${"a".repeat(64)}  nested\\escape.exe\n`), /Unsafe/);
  assert.throws(() => parseChecksumText(`${"a".repeat(64)}  /absolute.exe\n`), /Unsafe|top-level/);
  assert.throws(() => parseChecksumText(`${"a".repeat(64)} Vintrace.exe\n`), /Malformed checksum line/);
  assert.throws(() => parseChecksumText(`${"a".repeat(64)}  A.exe\n${"b".repeat(64)}  a.exe\n`), /Duplicate checksum subject/);
  assert.throws(() => parseChecksumText("\n"), /no subjects/);
});

run("CycloneDX and SPDX validators enforce standards and matching runtime inventory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-sbom-test-"));
  const product = { name: "Vintrace", version: "0.1.0" };
  try {
    const fixture = sbomFixture(product);
    writeSboms(root, fixture);
    const valid = validateSbomFiles(path.join(root, CYCLONEDX_NAME), path.join(root, SPDX_NAME), product);
    assert.strictEqual(valid.cycloneDx.purls, REQUIRED_RUNTIME_PURLS.length);
    assert.strictEqual(valid.spdx.purls, REQUIRED_RUNTIME_PURLS.length);

    const missingRuntime = sbomFixture(product);
    missingRuntime.cycloneDx.components.pop();
    writeSboms(root, missingRuntime);
    assert.throws(() => validateSbomFiles(path.join(root, CYCLONEDX_NAME), path.join(root, SPDX_NAME), product), /missing required runtime package/);

    const formatDrift = sbomFixture(product);
    formatDrift.cycloneDx.specVersion = "1.5";
    writeSboms(root, formatDrift);
    assert.throws(() => validateSbomFiles(path.join(root, CYCLONEDX_NAME), path.join(root, SPDX_NAME), product), /specVersion must be 1.6/);

    const inventoryDrift = sbomFixture(product);
    inventoryDrift.spdx.packages.push({
      name: "unexpected",
      SPDXID: "SPDXRef-Package-extra",
      externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/unexpected@1.0.0" }],
    });
    writeSboms(root, inventoryDrift);
    assert.throws(() => validateSbomFiles(path.join(root, CYCLONEDX_NAME), path.join(root, SPDX_NAME), product), /package URL sets differ/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run("release artifact generation pins Syft and emits standard metadata atomically", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-generate-release-"));
  const dist = path.join(root, "dist");
  const calls = [];
  try {
    fs.mkdirSync(dist, { recursive: true });
    writeJson(path.join(root, "package.json"), {
      name: "vintrace",
      version: "0.1.0",
      license: "UNLICENSED",
      build: { productName: "Vintrace", appId: "com.vintrace.test", publish: [{ owner: "owner", repo: "repo" }] },
    });
    writeJson(path.join(root, "package-lock.json"), { name: "vintrace", version: "0.1.0", lockfileVersion: 3, packages: {} });
    fs.writeFileSync(path.join(root, "requirements-production.lock.txt"), "c2pa-python==0.36.0\n", "utf8");
    fs.writeFileSync(path.join(dist, "Vintrace-0.1.0.dmg"), "installer", "utf8");
    fs.writeFileSync(path.join(dist, "Vintrace-darwin-arm64.mcpb"), "mcp package", "utf8");
    fs.writeFileSync(path.join(dist, "Vintrace.Setup.0.1.0.exe"), "windows installer", "utf8");
    fs.writeFileSync(path.join(dist, "Vintrace-0.1.0-linux-x86_64.AppImage"), "linux installer", "utf8");
    fs.writeFileSync(path.join(dist, "stale.sigstore.json"), "stale", "utf8");
    fs.writeFileSync(path.join(dist, "vintrace-provenance.json"), "stale", "utf8");
    const commit = "c".repeat(40);
    const sourceRef = "refs/tags/v0.1.0";
    const assemblyPath = path.join(root, "release-assembly.json");
    const platformPayloads = [
      ["macos", ["Vintrace-0.1.0.dmg", "Vintrace-darwin-arm64.mcpb"]],
      ["windows", ["Vintrace.Setup.0.1.0.exe"]],
      ["linux", ["Vintrace-0.1.0-linux-x86_64.AppImage"]],
    ];
    const assembly = {
      schemaVersion: 1,
      generatedAt: "2026-07-14T00:00:00Z",
      source: { repository: "owner/repo", commit, ref: sourceRef },
      product: { name: "Vintrace", version: "0.1.0" },
      platforms: platformPayloads.map(([id, names], index) => ({
        id,
        sourceCommit: commit,
        sourceRef,
        sourceChecksumSha256: String(index + 1).repeat(64),
        payloads: names.map((name) => ({ name, sha256: sha256(fs.readFileSync(path.join(dist, name))) })),
      })),
      payloadCount: 4,
    };
    writeJson(assemblyPath, assembly);
    const fakeExec = (command, args, options) => {
      calls.push({ command, args, options });
      if (args[0] === "version") {
        return JSON.stringify({ application: "syft", version: SYFT_VERSION, gitCommit: "syft-commit", schemaVersion: "16.1.3" });
      }
      assert.strictEqual(args[0], "scan");
      const fixture = sbomFixture();
      const cdxOutput = args.find((arg) => String(arg).startsWith("cyclonedx-json="));
      const spdxOutput = args.find((arg) => String(arg).startsWith("spdx-json="));
      writeJson(cdxOutput.slice("cyclonedx-json=".length), fixture.cycloneDx);
      writeJson(spdxOutput.slice("spdx-json=".length), fixture.spdx);
      assert.strictEqual(options.env.SYFT_JAVASCRIPT_INCLUDE_DEV_DEPENDENCIES, "true");
      assert.deepStrictEqual(fs.readdirSync(options.cwd).sort(), [...sbomInputFiles].sort());
      return "";
    };
    const previousBuildSha = process.env.VINTRACE_BUILD_SHA;
    const previousBuildRef = process.env.VINTRACE_BUILD_REF;
    const previousSourceRef = process.env.VINTRACE_BUILD_SOURCE_REF;
    process.env.VINTRACE_BUILD_SHA = commit;
    process.env.VINTRACE_BUILD_REF = "v0.1.0";
    process.env.VINTRACE_BUILD_SOURCE_REF = sourceRef;
    const result = createReleaseArtifacts({ repoRoot: root, dist, assemblyManifestPath: assemblyPath, syftBin: "/pinned/syft", execFileSyncImpl: fakeExec });
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.sboms, [CYCLONEDX_NAME, SPDX_NAME]);
    assert.strictEqual(fs.existsSync(path.join(dist, "stale.sigstore.json")), false);
    assert.strictEqual(fs.existsSync(path.join(dist, "vintrace-provenance.json")), false);
    assert.ok(fs.existsSync(path.join(dist, BUILD_METADATA_NAME)));
    const entries = readChecksumFile(path.join(dist, CHECKSUM_NAME));
    verifyChecksummedFiles(dist, entries);
    assert.deepStrictEqual(entries.map((entry) => entry.name).sort(), [
      "Vintrace-0.1.0.dmg",
      "Vintrace-0.1.0-linux-x86_64.AppImage",
      "Vintrace-darwin-arm64.mcpb",
      "Vintrace.Setup.0.1.0.exe",
      BUILD_METADATA_NAME,
      CYCLONEDX_NAME,
      SPDX_NAME,
    ].sort());
    const metadata = JSON.parse(fs.readFileSync(path.join(dist, BUILD_METADATA_NAME), "utf8"));
    validateBuildMetadata(metadata, { name: "Vintrace", version: "0.1.0" });
    assert.deepStrictEqual(metadata.declaredBuildContext.releaseAssembly, assembly);
    validateReleaseAssembly(assembly, { product: { name: "Vintrace", version: "0.1.0" }, source: metadata.source, artifacts: metadata.artifacts });
    const checksumMap = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry.sha256]));
    assert.strictEqual(validatePublishedBuildMetadata(metadata, {
      repository: "owner/repo",
      tag: "v0.1.0",
      platform: "all",
      checksumMap,
      sourceDigest: commit,
    }), true);
    assert.throws(() => validatePublishedBuildMetadata({
      ...metadata,
      source: { ...metadata.source, dirty: true },
    }, {
      repository: "owner/repo",
      tag: "v0.1.0",
      platform: "all",
      checksumMap,
      sourceDigest: commit,
    }), /clean source tree|dirty source tree/);
    const driftedChecksums = new Map(checksumMap);
    driftedChecksums.set("vintrace-0.1.0.dmg", "0".repeat(64));
    assert.throws(() => validatePublishedBuildMetadata(metadata, {
      repository: "owner/repo",
      tag: "v0.1.0",
      platform: "all",
      checksumMap: driftedChecksums,
      sourceDigest: commit,
    }), /does not match SHA256SUMS/);
    const scan = calls.find((call) => call.args[0] === "scan");
    assert.deepStrictEqual(scan.args.slice(0, 2), ["scan", "dir:."]);
    assert.ok(!scan.args.includes("--exclude"));
    assert.ok(calls.every((call) => call.command === "/pinned/syft"));

    const tamperedAssembly = structuredClone(assembly);
    tamperedAssembly.platforms[0].payloads[0].sha256 = "f".repeat(64);
    const tamperedAssemblyPath = path.join(root, "tampered-release-assembly.json");
    writeJson(tamperedAssemblyPath, tamperedAssembly);
    assert.throws(() => createReleaseArtifacts({
      repoRoot: root,
      dist,
      assemblyManifestPath: tamperedAssemblyPath,
      syftBin: "/pinned/syft",
      execFileSyncImpl: fakeExec,
    }), /does not match aggregate artifact/);

    fs.writeFileSync(path.join(dist, "vintrace-provenance.json"), "stale", "utf8");
    assert.throws(() => createReleaseArtifacts({
      repoRoot: root,
      dist,
      assemblyManifestPath: assemblyPath,
      syftBin: "/wrong/syft",
      execFileSyncImpl: (_command, args) => args[0] === "version"
        ? JSON.stringify({ application: "syft", version: "1.43.0" })
        : "",
    }), /requires Syft 1\.44\.0/);
    if (previousBuildSha === undefined) delete process.env.VINTRACE_BUILD_SHA;
    else process.env.VINTRACE_BUILD_SHA = previousBuildSha;
    if (previousBuildRef === undefined) delete process.env.VINTRACE_BUILD_REF;
    else process.env.VINTRACE_BUILD_REF = previousBuildRef;
    if (previousSourceRef === undefined) delete process.env.VINTRACE_BUILD_SOURCE_REF;
    else process.env.VINTRACE_BUILD_SOURCE_REF = previousSourceRef;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run("keyless cosign signing covers every subject and fails on tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-cosign-test-"));
  const identity = "https://github.com/owner/repo/.github/workflows/release.yml@refs/heads/main";
  const calls = [];
  try {
    fs.writeFileSync(path.join(root, "artifact with spaces.bin"), "payload", "utf8");
    fs.writeFileSync(path.join(root, CHECKSUM_NAME), `${sha256("payload")}  artifact with spaces.bin\n`, "utf8");
    const fakeCosign = (_command, args) => {
      calls.push(args);
      if (args[0] === "version") return JSON.stringify({ gitVersion: `v${COSIGN_VERSION}` });
      if (args[0] === "sign-blob") {
        const bundle = args[args.indexOf("--bundle") + 1];
        writeJson(bundle, blobBundle());
      }
      return "verified";
    };
    const signed = signReleaseArtifacts({ dist: root, identity, cosignBin: "/pinned/cosign", execFileSyncImpl: fakeCosign });
    assert.strictEqual(signed.subjects, 2);
    assert.ok(fs.existsSync(path.join(root, cosignBundleName("artifact with spaces.bin"))));
    assert.ok(fs.existsSync(path.join(root, cosignBundleName(CHECKSUM_NAME))));
    assert.strictEqual(calls.filter((args) => args[0] === "sign-blob").length, 2);
    assert.strictEqual(calls.filter((args) => args[0] === "verify-blob").length, 2);
    for (const args of calls.filter((item) => item[0] === "verify-blob")) {
      assert.ok(args.includes("--certificate-identity"));
      assert.ok(args.includes(identity));
      assert.ok(args.includes("https://token.actions.githubusercontent.com"));
    }
    const verified = verifyCosignBundles({ dist: root, identity, cosignBin: "/pinned/cosign", execFileSyncImpl: fakeCosign });
    assert.strictEqual(verified.subjects, 2);

    fs.appendFileSync(path.join(root, "artifact with spaces.bin"), "tampered", "utf8");
    assert.throws(() => verifyCosignBundles({ dist: root, identity, cosignBin: "/pinned/cosign", execFileSyncImpl: fakeCosign }), /digest mismatch/);
    assert.throws(() => signReleaseArtifacts({ dist: root, identity: "owner/repo", cosignBin: "/pinned/cosign", execFileSyncImpl: fakeCosign }), /exact GitHub workflow certificate identity/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run("GitHub attestation verification binds subjects, predicates, workflow, commit, and ref", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-attestation-test-"));
  const calls = [];
  const repository = "owner/repo";
  const workflowPath = ".github/workflows/release.yml";
  const sourceDigest = "a".repeat(40);
  const sourceRef = "refs/heads/main";
  try {
    const sboms = sbomFixture();
    writeSboms(root, sboms);
    fs.writeFileSync(path.join(root, "artifact.bin"), "artifact", "utf8");
    const names = ["artifact.bin", CYCLONEDX_NAME, SPDX_NAME];
    const entries = names.map((name) => ({ name, sha256: sha256(fs.readFileSync(path.join(root, name))) }));
    fs.writeFileSync(path.join(root, CHECKSUM_NAME), entries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", "utf8");
    writeGithubBundles(root, entries, sboms);
    const fakeGh = (command, args) => {
      calls.push({ command, args });
      return "verified";
    };
    const result = verifyGithubAttestations({
      dist: root,
      repository,
      workflowPath,
      sourceDigest,
      sourceRef,
      ghBin: "/usr/bin/gh",
      execFileSyncImpl: fakeGh,
    });
    assert.strictEqual(result.verifications, entries.length * GITHUB_ATTESTATIONS.length);
    assert.strictEqual(calls.length, result.verifications);
    for (const call of calls) {
      assert.strictEqual(call.command, "/usr/bin/gh");
      assert.ok(call.args.includes("--deny-self-hosted-runners"));
      assert.ok(call.args.includes("--cert-identity"));
      assert.ok(call.args.includes(`https://github.com/${repository}/${workflowPath}@${sourceRef}`));
      assert.ok(call.args.includes("--source-digest"));
      assert.ok(call.args.includes(sourceDigest));
      assert.ok(call.args.includes("--source-ref"));
      assert.ok(call.args.includes(sourceRef));
    }

    const slsaFile = path.join(root, GITHUB_ATTESTATIONS[0].file);
    const malformed = JSON.parse(fs.readFileSync(slsaFile, "utf8"));
    const statement = JSON.parse(Buffer.from(malformed.dsseEnvelope.payload, "base64").toString("utf8"));
    statement.subject[0].digest.sha256 = "b".repeat(64);
    malformed.dsseEnvelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
    writeJson(slsaFile, malformed);
    assert.throws(() => verifyGithubAttestations({
      dist: root,
      repository,
      workflowPath,
      sourceDigest,
      sourceRef,
      ghBin: "/usr/bin/gh",
      execFileSyncImpl: fakeGh,
    }), /does not bind the expected digest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

run("Sigstore bundles require v0.3 keyless certificate material", () => {
  assert.strictEqual(validateSigstoreBundle(blobBundle(), "blob"), true);
  const missingCertificate = blobBundle();
  delete missingCertificate.verificationMaterial.certificate;
  assert.throws(() => validateSigstoreBundle(missingCertificate, "blob"), /keyless signing certificate/);
  const oldMediaType = blobBundle();
  oldMediaType.mediaType = "application/vnd.dev.sigstore.bundle.v0.2+json";
  assert.throws(() => validateSigstoreBundle(oldMediaType, "blob"), /v0\.3/);
});

run("release workflows pin actions and enforce supply-chain verification before upload", () => {
  const workflowDir = path.join(__dirname, "..", ".github", "workflows");
  for (const file of fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name))) {
    const source = fs.readFileSync(path.join(workflowDir, file), "utf8");
    for (const match of source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)) {
      if (match[1].startsWith("./.github/workflows/")) {
        assert.match(match[1], /^\.\/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/, `${file}: ${match[1]}`);
      } else {
        assert.match(match[1], /@[a-f0-9]{40}$/, `${file}: ${match[1]}`);
      }
    }
  }
  for (const workflow of ["macos-release.yml", "windows-release.yml", "linux-release.yml"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", workflow), "utf8");
    const uses = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length >= 8, workflow);
    for (const action of uses) assert.match(action, /@[a-f0-9]{40}$/, `${workflow}: ${action}`);
    assert.match(source, /id-token:\s*write/);
    assert.match(source, /attestations:\s*write/);
    assert.match(source, /artifact-metadata:\s*write/);
    assert.ok(source.includes("syft-version: v1.44.0"));
    assert.ok(source.includes("cosign-release: v3.0.6"));
    assert.strictEqual((source.match(/actions\/attest@a1948c3f048ba23858d222213b7c278aabede763/g) || []).length, 3);
    if (workflow === "windows-release.yml") {
      assert.ok(source.includes("Prepare Windows-native attestation checksum input"));
      assert.ok(source.includes("subject-checksums: ${{ steps.attestation_checksums.outputs.path }}"));
      assert.ok(source.includes('$normalized = $source -replace "`r?`n", "`r`n"'));
    } else {
      assert.ok(source.includes("subject-checksums: dist/SHA256SUMS.txt"));
    }
    assert.ok(source.includes("sbom-path: dist/vintrace.cdx.json"));
    assert.ok(source.includes("sbom-path: dist/vintrace.spdx.json"));
    assert.ok(source.includes("npm run release:sign"));
    assert.ok(source.includes("npm run release:attest:verify"));
    assert.ok(source.indexOf("npm run release:attest:verify") < source.indexOf("npm run package:check"));
    assert.ok(source.indexOf("npm run package:check") < source.indexOf("actions/upload-artifact@"));
    assert.ok(!source.includes("softprops/action-gh-release"));
    assert.ok(!source.includes("Publish verified GitHub Release"));
    assert.ok(!source.includes("vintrace-sbom.json"));
    assert.ok(!source.includes("vintrace-provenance.json"));
  }
  const verifier = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "verify-release-assets.cjs"), "utf8");
  assert.ok(verifier.includes("--verify-signatures"));
  assert.ok(verifier.includes("verifyCosignBundles"));
  assert.ok(verifier.includes("verifyGithubAttestations"));
  const release = fs.readFileSync(path.join(workflowDir, "release.yml"), "utf8");
  assert.strictEqual((release.match(/softprops\/action-gh-release@/g) || []).length, 1);
  assert.strictEqual((release.match(/actions\/attest@a1948c3f048ba23858d222213b7c278aabede763/g) || []).length, 3);
  assert.ok(release.includes("npm run release:assemble"));
  assert.ok(release.includes("npm run release:verify-platform-evidence"));
  assert.ok(release.includes("npm run release:verify -- --repo"));
  assert.ok(release.includes("--platform all"));
  assert.ok(release.includes("Publish the immutable MCP Registry descriptor"));
  assert.ok(release.indexOf("Cryptographically reverify transferred platform evidence") < release.indexOf("Generate one aggregate checksum and SBOM evidence set"));
  assert.ok(release.indexOf("Verify the complete staged release") < release.indexOf("Publish the verified release once"));
  assert.ok(release.indexOf("Verify public downloads after publication") < release.indexOf("Publish the immutable MCP Registry descriptor"));
});

console.log("\nall supply-chain release tests passed");

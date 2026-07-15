#!/usr/bin/env node

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const yaml = require("js-yaml");
const {
  findSquashfsOffset,
  validateLinuxConfiguration,
  validateUpdateMetadata,
} = require("../desktop/scripts/check-linux-artifacts.cjs");

const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");

const config = validateLinuxConfiguration(pkg);
assert.deepStrictEqual(config.targets, ["AppImage", "deb", "rpm"]);
assert.strictEqual(config.arch, "x64");
assert.strictEqual(config.appImageToolset, "1.0.3");
assert.strictEqual(pkg.desktopName, "Vintrace");
assert.match(pkg.homepage, /^https:\/\//);
assert.strictEqual(pkg.build.rpm.compression, "gzip");
assert.match(pkg.scripts["dist:linux"], /require-platform\.cjs linux/);
assert.match(pkg.scripts["dist:linux"], /--linux AppImage deb rpm --x64 --publish never/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-linux-metadata-"));
try {
  const squashfsFixture = path.join(fixture, "fixture.AppImage");
  const squashfsBody = Buffer.alloc(512);
  const squashfsOffset = 137;
  squashfsBody.write("hsqs", squashfsOffset, "ascii");
  squashfsBody.writeUInt32LE(131072, squashfsOffset + 12);
  squashfsBody.writeUInt16LE(17, squashfsOffset + 22);
  squashfsBody.writeUInt16LE(4, squashfsOffset + 28);
  squashfsBody.writeUInt16LE(0, squashfsOffset + 30);
  fs.writeFileSync(squashfsFixture, squashfsBody);
  assert.strictEqual(findSquashfsOffset(squashfsFixture), squashfsOffset);

  const artifacts = {
    appImage: "Vintrace-0.1.0-linux-x86_64.AppImage",
    deb: "vintrace_0.1.0_amd64.deb",
    rpm: "vintrace-0.1.0.x86_64.rpm",
  };
  const rows = [];
  for (const [index, name] of Object.values(artifacts).entries()) {
    const body = Buffer.from(`linux artifact ${index}`);
    fs.writeFileSync(path.join(fixture, name), body);
    rows.push({
      url: name,
      sha512: crypto.createHash("sha512").update(body).digest("base64"),
      size: body.length,
    });
  }
  fs.writeFileSync(path.join(fixture, "latest-linux.yml"), yaml.dump({
    version: pkg.version,
    files: rows,
    path: artifacts.appImage,
    sha512: rows[0].sha512,
  }));
  const metadata = validateUpdateMetadata(fixture, pkg, artifacts);
  assert.strictEqual(metadata.files, 3);

  rows[1].sha512 = "tampered";
  fs.writeFileSync(path.join(fixture, "latest-linux.yml"), yaml.dump({
    version: pkg.version,
    files: rows,
    path: artifacts.appImage,
  }));
  assert.throws(() => validateUpdateMetadata(fixture, pkg, artifacts), /sha512 does not match/);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

const workflowPath = path.join(root, ".github", "workflows", "linux-release.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
assert.doesNotThrow(() => yaml.load(workflow));
for (const marker of [
  "runs-on: ubuntu-22.04",
  "squashfs-tools",
  "npm run test:dependency-currency",
  "python tests/model_lifecycle_units.py",
  "python benchmarks/run_model_lifecycle_evals.py",
  "python tests/audio_intelligence_units.py",
  "npm run test:frozen-model-lifecycle",
  "npm run test:frozen-audio-intelligence",
  "npm run test:frozen-dependency-currency",
  "npm run test:frozen-workspace-encryption",
  "npm run test:frozen-content-credentials",
  "npm run test:frozen-mobile-companion",
  "electron-builder --linux AppImage deb rpm --x64 --publish never",
  "VINTRACE_LINUX_PACKAGE_REQUIRED: \"1\"",
  "npm run linux:package:check",
  "xvfb-run -a npm run test:e2e:packaged",
  "VINTRACE_PACKAGED_EXECUTABLE",
  "actions/attest@a1948c3f048ba23858d222213b7c278aabede763",
  "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6",
  "npm run release:attest:verify",
  "VINTRACE_PACKAGE_PLATFORM: \"linux\"",
]) {
  assert.ok(workflow.includes(marker), `Linux workflow is missing ${marker}`);
}
assert.match(workflow, /dist\/\*\.AppImage/);
assert.match(workflow, /dist\/\*\.deb/);
assert.match(workflow, /dist\/\*\.rpm/);
assert.match(workflow, /dist\/latest-linux\.yml/);
assert.ok(!workflow.includes("VINTRACE_E2E_TRANSLATED_X64"), "Hosted Linux acceptance must use native Chromium services");
assert.doesNotMatch(workflow, /softprops\/action-gh-release|npm run release:verify --/, "Reusable Linux workflow must not publish or verify a GitHub Release independently");

const releaseWorkflow = fs.readFileSync(path.join(root, ".github", "workflows", "release.yml"), "utf8");
for (const marker of [
  "uses: ./.github/workflows/linux-release.yml",
  "name: Vintrace-Linux-x64-Sigstore",
  "--linux \"$RUNNER_TEMP/vintrace-platforms/linux\"",
  "--platform all --full --require-release-metadata --verify-signatures --allow-draft",
  "--platform all --full --require-release-metadata --verify-signatures",
]) {
  assert.ok(releaseWorkflow.includes(marker), `Central release finalizer is missing Linux trust-boundary marker ${marker}`);
}

const packagedSpec = fs.readFileSync(path.join(root, "tests", "e2e", "packaged.spec.ts"), "utf8");
assert.match(packagedSpec, /VINTRACE_E2E_TRANSLATED_X64/);
assert.match(packagedSpec, /NetworkServiceInProcess2/);
assert.match(packagedSpec, /isAppImageExecutable/);

const packageChecker = fs.readFileSync(path.join(root, "desktop", "scripts", "check-package-artifacts.cjs"), "utf8");
for (const marker of ["linux AppImage", "linux deb", "linux rpm", "latest-linux.yml"]) {
  assert.ok(packageChecker.includes(marker), `Package checker is missing ${marker}`);
}

const linuxArtifactChecker = fs.readFileSync(path.join(root, "desktop", "scripts", "check-linux-artifacts.cjs"), "utf8");
assert.match(linuxArtifactChecker, /rpm2cpio/);
assert.match(linuxArtifactChecker, /cpio/);
assert.match(linuxArtifactChecker, /validateExtractedPayload\(rpmRoot, "rpm"\)/);

const releaseVerifier = fs.readFileSync(path.join(root, "desktop", "scripts", "verify-release-assets.cjs"), "utf8");
assert.match(releaseVerifier, /isLinux \? \/\\\.AppImage\$\/i/);
assert.match(releaseVerifier, /\^latest-linux/);
assert.match(releaseVerifier, /embeds its AppImage blockmap/);

console.log("linux distribution contract ok");

"use strict";

// Unit tests for desktop/scripts/check-update-feed.cjs. The script is a CLI,
// but its platform-specific artifact checks are exported so we can exercise
// macOS/Windows release shapes without mutating the real dist/ directory.
// Run: node tests/check_update_feed.test.cjs

const assert = require("assert");
const checker = require("../desktop/scripts/check-update-feed.cjs");
const pkg = require("../package.json");

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("expected metadata names are platform-aware", () => {
  assert.strictEqual(checker.expectedUpdateMetadataName("stable", "win32"), "latest.yml");
  assert.strictEqual(checker.expectedUpdateMetadataName("beta", "win32"), "beta.yml");
  assert.strictEqual(checker.expectedUpdateMetadataName("stable", "darwin"), "latest-mac.yml");
  assert.strictEqual(checker.expectedUpdateMetadataName("internal", "macos"), "internal-mac.yml");
  assert.strictEqual(checker.expectedUpdateMetadataName("stable", "linux"), "latest-linux.yml");
});

run("macOS local dist accepts dmg zip and latest-mac metadata", () => {
  const result = checker.buildUpdateFeedCheckResult({
    pkg,
    channel: "stable",
    packagePlatform: "darwin",
    distFiles: [
      "Vintrace-0.1.0-arm64.dmg",
      "Vintrace-0.1.0-mac.zip",
      "Vintrace-0.1.0-mac.zip.blockmap",
      "latest-mac.yml",
    ],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.checks, null, 2));
  assert.strictEqual(result.expectedMetadata, "latest-mac.yml");
  const artifactCheck = result.checks.find((check) => check.name === "local installer artifact");
  assert.deepStrictEqual(artifactCheck.found, ["Vintrace-0.1.0-arm64.dmg", "Vintrace-0.1.0-mac.zip"]);
});

run("Windows local dist still requires exe and latest metadata", () => {
  const result = checker.buildUpdateFeedCheckResult({
    pkg,
    channel: "stable",
    packagePlatform: "win32",
    distFiles: ["Vintrace Setup 0.1.0.exe", "Vintrace Setup 0.1.0.exe.blockmap", "latest.yml"],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.checks, null, 2));
  assert.strictEqual(result.expectedMetadata, "latest.yml");
  const artifactCheck = result.checks.find((check) => check.name === "local installer artifact");
  assert.deepStrictEqual(artifactCheck.found, ["Vintrace Setup 0.1.0.exe"]);
});

run("Linux local dist requires AppImage deb rpm and latest-linux metadata", () => {
  const result = checker.buildUpdateFeedCheckResult({
    pkg,
    channel: "stable",
    packagePlatform: "linux",
    distFiles: [
      "Vintrace-0.1.0-linux-x86_64.AppImage",
      "vintrace_0.1.0_amd64.deb",
      "vintrace-0.1.0.x86_64.rpm",
      "latest-linux.yml",
    ],
  });
  assert.strictEqual(result.ok, true, JSON.stringify(result.checks, null, 2));
  assert.strictEqual(result.expectedMetadata, "latest-linux.yml");
  const artifactCheck = result.checks.find((check) => check.name === "local installer artifact");
  assert.deepStrictEqual(artifactCheck.found, [
    "Vintrace-0.1.0-linux-x86_64.AppImage",
    "vintrace_0.1.0_amd64.deb",
    "vintrace-0.1.0.x86_64.rpm",
  ]);
});

run("Linux local dist rejects an incomplete package-format set", () => {
  const result = checker.buildUpdateFeedCheckResult({
    pkg,
    channel: "stable",
    packagePlatform: "linux",
    distFiles: ["Vintrace-0.1.0-linux-x86_64.AppImage", "latest-linux.yml"],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.checks.find((check) => check.name === "local deb artifact").ok, false);
  assert.strictEqual(result.checks.find((check) => check.name === "local rpm artifact").ok, false);
});

run("macOS local dist rejects Windows-only metadata instead of false requiring exe", () => {
  const result = checker.buildUpdateFeedCheckResult({
    pkg,
    channel: "stable",
    packagePlatform: "darwin",
    distFiles: ["Vintrace-0.1.0-arm64.dmg", "latest.yml"],
  });
  const metadataCheck = result.checks.find((check) => check.name === "local dist metadata");
  const artifactCheck = result.checks.find((check) => check.name === "local installer artifact");
  assert.strictEqual(metadataCheck.ok, false);
  assert.strictEqual(metadataCheck.expectedMetadata, "latest-mac.yml");
  assert.strictEqual(artifactCheck.ok, true);
  assert.deepStrictEqual(artifactCheck.found, ["Vintrace-0.1.0-arm64.dmg"]);
});

console.log("\nall check-update-feed tests passed");

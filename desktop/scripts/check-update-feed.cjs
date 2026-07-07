#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

function normalizePackagePlatform(value) {
  const platform = String(value || process.platform || "").toLowerCase();
  if (platform === "macos" || platform === "mac") return "darwin";
  if (platform === "windows" || platform === "win") return "win32";
  return platform || process.platform;
}

function expectedUpdateMetadataName(channel, packagePlatform) {
  const cleanChannel = String(channel || "stable").toLowerCase();
  const base = cleanChannel === "stable" ? "latest" : cleanChannel;
  const platform = normalizePackagePlatform(packagePlatform);
  if (platform === "darwin") return `${base}-mac.yml`;
  if (platform === "linux") return `${base}-linux.yml`;
  return `${base}.yml`;
}

function classifyDistFiles(distFiles) {
  return {
    exeFiles: distFiles.filter((file) => /\.exe$/i.test(file)),
    dmgFiles: distFiles.filter((file) => /\.dmg$/i.test(file)),
    zipFiles: distFiles.filter((file) => /\.zip$/i.test(file)),
    linuxFiles: distFiles.filter((file) => /\.(AppImage|deb|rpm|snap)$/i.test(file)),
    blockmapFiles: distFiles.filter((file) => /\.blockmap$/i.test(file)),
    metadataFiles: distFiles.filter((file) => /^(latest|beta|internal)(-(mac|linux))?\.ya?ml$/i.test(file)),
  };
}

function localInstallerArtifactsForPlatform(classified, packagePlatform) {
  const platform = normalizePackagePlatform(packagePlatform);
  if (platform === "win32") return classified.exeFiles;
  if (platform === "darwin") return [...classified.dmgFiles, ...classified.zipFiles];
  if (platform === "linux") return classified.linuxFiles;
  return [...classified.exeFiles, ...classified.dmgFiles, ...classified.zipFiles, ...classified.linuxFiles];
}

function add(checks, name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

function buildUpdateFeedCheckResult({
  pkg,
  distFiles,
  channel,
  packagePlatform,
  releaseTag = "",
}) {
  const build = pkg.build || {};
  const publish = Array.isArray(build.publish) ? build.publish[0] : build.publish;
  const provider = publish?.provider || "";
  const platform = normalizePackagePlatform(packagePlatform);
  const expectedMetadata = expectedUpdateMetadataName(channel, platform);
  const checks = [];

  add(checks, "publish provider", provider === "github", provider || "missing", { provider });
  add(checks, "github owner", Boolean(publish?.owner), publish?.owner || "missing");
  add(checks, "github repo", Boolean(publish?.repo), publish?.repo || "missing");
  add(checks, "product name", Boolean(build.productName), build.productName || "missing");
  add(checks, "app id", Boolean(build.appId), build.appId || "missing");
  add(checks, "version", /^\d+\.\d+\.\d+/.test(String(pkg.version || "")), String(pkg.version || "missing"));
  add(checks, "update channel", ["stable", "beta", "internal"].includes(channel), channel);
  add(checks, "package platform", ["darwin", "win32", "linux"].includes(platform), platform);
  add(checks, "metadata name", Boolean(expectedMetadata), expectedMetadata);

  const classified = classifyDistFiles(distFiles);
  const installerFiles = localInstallerArtifactsForPlatform(classified, platform);
  const installerDistPresent = installerFiles.length > 0 || classified.blockmapFiles.length > 0 || classified.metadataFiles.length > 0;

  add(checks, "local dist metadata", !installerDistPresent || classified.metadataFiles.includes(expectedMetadata), classified.metadataFiles.length ? classified.metadataFiles.join(", ") : "not built yet", {
    expectedMetadata,
    found: classified.metadataFiles
  });
  add(checks, "local installer artifact", !installerDistPresent || installerFiles.length > 0, installerFiles.length ? installerFiles.join(", ") : "not built yet", {
    platform,
    found: installerFiles
  });

  const ok = checks.every((check) => check.ok);
  return {
    generatedAt: new Date().toISOString(),
    ok,
    provider,
    owner: publish?.owner || "",
    repo: publish?.repo || "",
    channel,
    packagePlatform: platform,
    expectedMetadata,
    releaseTag,
    dryRun: true,
    publishMode: releaseTag ? "release" : "artifact-only",
    checks,
    recommendations: ok
      ? ["Update feed configuration is structurally valid."]
      : ["Fix failing checks before publishing update metadata."]
  };
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const channel = String(process.env.VINTRACE_UPDATE_CHANNEL || process.env.CROSSAGE_UPDATE_CHANNEL || "stable").toLowerCase();
  const packagePlatform = process.env.VINTRACE_PACKAGE_PLATFORM || process.env.CROSSAGE_PACKAGE_PLATFORM || process.platform;
  const releaseTag = process.env.VINTRACE_RELEASE_TAG || "";
  const dist = path.join(repoRoot, "dist");
  const distFiles = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
  const result = buildUpdateFeedCheckResult({ pkg, distFiles, channel, packagePlatform, releaseTag });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildUpdateFeedCheckResult,
  classifyDistFiles,
  expectedUpdateMetadataName,
  localInstallerArtifactsForPlatform,
  normalizePackagePlatform,
};

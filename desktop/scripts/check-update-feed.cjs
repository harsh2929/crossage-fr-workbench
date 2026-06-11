#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const build = pkg.build || {};
const publish = Array.isArray(build.publish) ? build.publish[0] : build.publish;
const channel = String(process.env.VINTRACE_UPDATE_CHANNEL || process.env.CROSSAGE_UPDATE_CHANNEL || "stable").toLowerCase();
const provider = publish?.provider || "";
const releaseTag = process.env.VINTRACE_RELEASE_TAG || "";
const expectedMetadata = channel === "stable" ? "latest.yml" : `${channel}.yml`;
const checks = [];

function add(name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

add("publish provider", provider === "github", provider || "missing", { provider });
add("github owner", Boolean(publish?.owner), publish?.owner || "missing");
add("github repo", Boolean(publish?.repo), publish?.repo || "missing");
add("product name", Boolean(build.productName), build.productName || "missing");
add("app id", Boolean(build.appId), build.appId || "missing");
add("version", /^\d+\.\d+\.\d+/.test(String(pkg.version || "")), String(pkg.version || "missing"));
add("update channel", ["stable", "beta", "internal"].includes(channel), channel);
add("metadata name", Boolean(expectedMetadata), expectedMetadata);

const dist = path.join(repoRoot, "dist");
const distFiles = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
const exeFiles = distFiles.filter((file) => /\.exe$/i.test(file));
const metadataFiles = distFiles.filter((file) => /^(latest|beta|internal).*\.ya?ml$/i.test(file));
const installerDistPresent = exeFiles.length > 0 || metadataFiles.length > 0;

add("local dist metadata", !installerDistPresent || metadataFiles.includes(expectedMetadata), metadataFiles.length ? metadataFiles.join(", ") : "not built yet", {
  expectedMetadata,
  found: metadataFiles
});
add("local installer artifact", !installerDistPresent || exeFiles.length > 0, exeFiles.length ? exeFiles.join(", ") : "not built yet", {
  found: exeFiles
});

const ok = checks.every((check) => check.ok);
const result = {
  generatedAt: new Date().toISOString(),
  ok,
  provider,
  owner: publish?.owner || "",
  repo: publish?.repo || "",
  channel,
  expectedMetadata,
  releaseTag,
  dryRun: true,
  publishMode: releaseTag ? "release" : "artifact-only",
  checks,
  recommendations: ok
    ? ["Update feed configuration is structurally valid."]
    : ["Fix failing checks before publishing update metadata."]
};

console.log(JSON.stringify(result, null, 2));
process.exit(ok ? 0 : 1);

#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const dist = path.join(repoRoot, "dist");
const packagePath = path.join(repoRoot, "package.json");
const lockPath = path.join(repoRoot, "package-lock.json");
const checksumName = "SHA256SUMS.txt";
const sbomName = "vintrace-sbom.json";
const provenanceName = "vintrace-provenance.json";
const checksumSignatureName = `${checksumName}.sig`;
const releaseMetadataNames = new Set([sbomName, provenanceName]);
const installerExtensions = new Set([".appimage", ".deb", ".dmg", ".exe", ".msi", ".pkg", ".rpm", ".snap", ".zip"]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitValue(args, fallback = "") {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return fallback;
  }
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function isReleaseArtifactName(name, options = {}) {
  const includeMetadata = options.includeMetadata !== false;
  const lower = String(name || "").toLowerCase();
  if (!lower || lower === checksumName.toLowerCase() || lower === checksumSignatureName.toLowerCase()) {
    return false;
  }
  if (releaseMetadataNames.has(name) || releaseMetadataNames.has(lower)) {
    return includeMetadata;
  }
  if (lower.endsWith(".blockmap")) {
    return true;
  }
  if (lower.endsWith(".yml")) {
    return true;
  }
  return installerExtensions.has(path.extname(lower));
}

function releaseArtifactFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isReleaseArtifactName(entry.name, options))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function artifactRecord(file, root = dist) {
  const stat = fs.statSync(file);
  return {
    path: path.relative(root, file).replace(/\\/g, "/"),
    bytes: stat.size,
    sha256: sha256(file)
  };
}

function checksumLines(records) {
  return records
    .map((record) => `${record.sha256}  ${record.path}`)
    .sort();
}

function lockPackages(lock) {
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  return Object.entries(packages)
    .filter(([name]) => name.startsWith("node_modules/"))
    .map(([name, value]) => ({
      name: name.replace(/^node_modules\//, ""),
      version: String(value.version || ""),
      license: value.license || "UNKNOWN",
      resolved: value.resolved || "",
      integrity: value.integrity || "",
      dev: Boolean(value.dev)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function writeJson(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function main() {
  if (!fs.existsSync(dist)) {
    fs.mkdirSync(dist, { recursive: true });
  }

  const pkg = readJson(packagePath);
  const lock = fs.existsSync(lockPath) ? readJson(lockPath) : { packages: {} };
  const generatedAt = new Date().toISOString();
  const commit = process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || gitValue(["rev-parse", "HEAD"], "local");
  const ref = process.env.VINTRACE_BUILD_REF || process.env.GITHUB_REF_NAME || gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "");
  const dirty = gitValue(["status", "--porcelain"], "") ? true : false;
  const filesBeforeMetadata = releaseArtifactFiles(dist, { includeMetadata: false }).map((file) => artifactRecord(file, dist));

  const sbom = {
    bomFormat: "Vintrace-SBOM",
    specVersion: "1.0",
    generatedAt,
    product: {
      name: pkg.build?.productName || pkg.name,
      packageName: pkg.name,
      version: pkg.version,
      license: pkg.license || "UNLICENSED"
    },
    packageCount: lockPackages(lock).length,
    packages: lockPackages(lock)
  };

  const provenance = {
    generatedAt,
    product: {
      name: pkg.build?.productName || pkg.name,
      appId: pkg.build?.appId || "",
      version: pkg.version
    },
    source: {
      repository: pkg.build?.publish?.[0] ? `${pkg.build.publish[0].owner}/${pkg.build.publish[0].repo}` : "",
      commit,
      ref,
      dirty
    },
    builder: {
      os: `${os.type()} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      ci: Boolean(process.env.CI),
      githubRunId: process.env.GITHUB_RUN_ID || "",
      githubWorkflow: process.env.GITHUB_WORKFLOW || ""
    },
    artifacts: filesBeforeMetadata
  };

  writeJson(path.join(dist, sbomName), sbom);
  writeJson(path.join(dist, provenanceName), provenance);

  const metadataRecords = [sbomName, provenanceName]
    .map((name) => path.join(dist, name))
    .filter((file) => fs.existsSync(file))
    .map((file) => artifactRecord(file, dist));
  const hashable = checksumLines([...filesBeforeMetadata, ...metadataRecords]);
  const checksumBytes = Buffer.from(`${hashable.join("\n")}\n`, "utf8");
  fs.writeFileSync(path.join(dist, checksumName), checksumBytes);

  // Origin proof (optional): if an Ed25519 release private key is configured,
  // emit a detached SHA256SUMS.txt.sig so verify-release-assets.cjs (given the
  // matching public key) can prove the checksums came from the official
  // builder — closing the "attacker who owns the release can swap binary +
  // checksums together" gap. Without a key, the .sig is simply not produced.
  let signed = false;
  const privKeyPath = process.env.VINTRACE_RELEASE_PRIVKEY || "";
  if (privKeyPath) {
    const privateKey = crypto.createPrivateKey(fs.readFileSync(privKeyPath, "utf8"));
    const signature = crypto.sign(null, checksumBytes, privateKey);
    fs.writeFileSync(path.join(dist, checksumSignatureName), signature);
    signed = true;
  }

  console.log(JSON.stringify({
    generatedAt,
    ok: true,
    dist,
    files: hashable.length,
    checksums: checksumName,
    signature: signed ? checksumSignatureName : null,
    sbom: sbomName,
    provenance: provenanceName
  }, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  artifactRecord,
  checksumLines,
  isReleaseArtifactName,
  releaseArtifactFiles,
};

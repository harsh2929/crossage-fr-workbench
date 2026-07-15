#!/usr/bin/env node

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const repoRoot = path.resolve(__dirname, "..", "..");

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function configuredTargetArches(targets, targetName) {
  const row = Array.isArray(targets)
    ? targets.find((item) => item && typeof item === "object" && item.target === targetName)
    : null;
  return Array.isArray(row?.arch) ? [...row.arch].sort() : [];
}

function validateLinuxConfiguration(pkg) {
  const build = pkg.build || {};
  invariant(/^https:\/\//.test(String(pkg.homepage || "")), "Linux packages require an HTTPS project homepage");
  invariant(pkg.desktopName === "Vintrace", "Linux desktopName must be Vintrace");
  for (const target of ["AppImage", "deb", "rpm"]) {
    invariant(
      JSON.stringify(configuredTargetArches(build.linux?.target, target)) === JSON.stringify(["x64"]),
      `${target} must target Linux x64 exactly`,
    );
  }
  invariant(build.linux?.executableName === "vintrace", "Linux executableName must be vintrace");
  invariant(build.linux?.category === "Graphics;Photography;", "Linux desktop categories must be Graphics and Photography");
  invariant(build.linux?.syncDesktopName === true, "Linux desktop identity must stay synchronized");
  invariant(build.linux?.desktop?.entry?.StartupWMClass === "Vintrace", "Linux StartupWMClass must match the app window");
  invariant(build.toolsets?.appimage === "1.0.3", "The FUSE-independent AppImage 1.0.3 runtime must remain pinned");
  invariant(build.deb?.depends?.includes("libsecret-1-0"), "deb must depend on libsecret-1-0");
  invariant(build.rpm?.depends?.includes("libsecret"), "rpm must depend on libsecret");
  invariant(build.rpm?.compression === "gzip", "rpm must use hosted-runner-safe gzip compression");
  invariant(build.appImage?.artifactName?.endsWith("-linux-${arch}.${ext}"), "AppImage artifact name must expose OS and architecture");
  return {
    targets: ["AppImage", "deb", "rpm"],
    arch: "x64",
    appImageToolset: build.toolsets.appimage,
  };
}

function singleFile(files, pattern, label) {
  const matches = files.filter((name) => pattern.test(name));
  invariant(matches.length === 1, `Expected exactly one ${label}; found ${matches.join(", ") || "none"}`);
  return matches[0];
}

function sha512Base64(file) {
  const hash = crypto.createHash("sha512");
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
  return hash.digest("base64");
}

function isSquashfsSuperblock(buffer, offset) {
  if (offset < 0 || offset + 32 > buffer.length) return false;
  if (buffer.toString("ascii", offset, offset + 4) !== "hsqs") return false;
  const blockSize = buffer.readUInt32LE(offset + 12);
  const blockLog = buffer.readUInt16LE(offset + 22);
  return (
    blockSize >= 4096 &&
    blockSize <= 1024 * 1024 &&
    (blockSize & (blockSize - 1)) === 0 &&
    blockLog === Math.log2(blockSize) &&
    buffer.readUInt16LE(offset + 28) === 4 &&
    buffer.readUInt16LE(offset + 30) === 0
  );
}

function findSquashfsOffset(file) {
  const handle = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(1024 * 1024);
  let carry = Buffer.alloc(0);
  let position = 0;
  try {
    while (true) {
      const read = fs.readSync(handle, chunk, 0, chunk.length, position);
      if (!read) break;
      const body = carry.length ? Buffer.concat([carry, chunk.subarray(0, read)]) : chunk.subarray(0, read);
      const bodyOffset = position - carry.length;
      let candidate = body.indexOf("hsqs");
      while (candidate !== -1) {
        if (isSquashfsSuperblock(body, candidate)) return bodyOffset + candidate;
        candidate = body.indexOf("hsqs", candidate + 1);
      }
      carry = Buffer.from(body.subarray(Math.max(0, body.length - 96)));
      position += read;
    }
  } finally {
    fs.closeSync(handle);
  }
  throw new Error(`Could not locate a valid SquashFS payload in ${path.basename(file)}`);
}

function validateUpdateMetadata(dist, pkg, artifacts) {
  const metadataPath = path.join(dist, "latest-linux.yml");
  invariant(fs.existsSync(metadataPath), "latest-linux.yml is missing");
  const metadata = yaml.load(fs.readFileSync(metadataPath, "utf8"));
  invariant(metadata && typeof metadata === "object", "latest-linux.yml is not a YAML object");
  invariant(String(metadata.version || "") === String(pkg.version), "latest-linux.yml version does not match package.json");
  invariant(Array.isArray(metadata.files), "latest-linux.yml files must be an array");
  const rows = new Map(metadata.files.map((row) => [path.basename(String(row?.url || "")), row]));
  for (const name of Object.values(artifacts)) {
    const row = rows.get(name);
    invariant(row, `latest-linux.yml does not list ${name}`);
    const file = path.join(dist, name);
    invariant(String(row.sha512 || "") === sha512Base64(file), `latest-linux.yml sha512 does not match ${name}`);
    if (row.size != null) {
      invariant(Number(row.size) === fs.statSync(file).size, `latest-linux.yml size does not match ${name}`);
    }
  }
  invariant(Object.values(artifacts).includes(path.basename(String(metadata.path || ""))), "latest-linux.yml legacy path must name a shipped Linux artifact");
  return { version: metadata.version, files: rows.size, path: metadata.path };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: options.encoding === null ? null : "utf8",
    env: { ...process.env, ...(options.env || {}) },
    maxBuffer: options.maxBuffer || 16 * 1024 * 1024,
  });
  invariant(!result.error && result.status === 0, `${command} ${args.join(" ")} failed: ${result.error?.message || result.stderr || result.stdout || result.status}`);
  return String(result.stdout || "");
}

function recursiveFiles(root, prefix = "") {
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) rows.push(...recursiveFiles(root, relative));
    else if (entry.isFile()) rows.push(relative);
  }
  return rows;
}

function validateExtractedPayload(root, sourceLabel) {
  const files = recursiveFiles(root);
  const appRelative = files.find((name) => /(^|\/)vintrace$/i.test(name) && !name.includes("resources/backend/"));
  const backendRelative = files.find((name) => /(^|\/)resources\/backend\/crossage-backend\/crossage-backend$/i.test(name));
  const lockRelative = files.find((name) => /(^|\/)resources\/requirements-production\.lock\.txt$/i.test(name));
  const noticeRelative = files.find((name) => /(^|\/)resources\/THIRD_PARTY_NOTICES\.md$/i.test(name));
  const onnxRelative = files.find((name) => /onnxruntime\/capi\/libonnxruntime\.so\.1\.27\.0$/i.test(name));
  const c2paRelative = files.find((name) => /c2pa\/libs\/libc2pa_c\.so$/i.test(name));
  const mobileIndexRelative = files.find((name) => /(^|\/)mobile-dist\/index\.html$/i.test(name));
  const mobileManifestRelative = files.find((name) => /(^|\/)mobile-dist\/manifest\.webmanifest$/i.test(name));
  const mobileScriptRelative = files.find((name) => /(^|\/)mobile-dist\/assets\/mobile-[A-Za-z0-9_-]+\.js$/i.test(name));
  const mobileStylesRelative = files.find((name) => /(^|\/)mobile-dist\/assets\/mobile-[A-Za-z0-9_-]+\.css$/i.test(name));
  invariant(appRelative, `${sourceLabel} payload is missing the Vintrace executable`);
  invariant(backendRelative, `${sourceLabel} payload is missing the frozen backend`);
  invariant(lockRelative, `${sourceLabel} payload is missing the production lock`);
  invariant(noticeRelative, `${sourceLabel} payload is missing the third-party notice`);
  invariant(onnxRelative, `${sourceLabel} payload is missing libonnxruntime.so.1.27.0`);
  invariant(c2paRelative, `${sourceLabel} payload is missing libc2pa_c.so`);
  invariant(mobileIndexRelative, `${sourceLabel} payload is missing the mobile companion document`);
  invariant(mobileManifestRelative, `${sourceLabel} payload is missing the mobile companion manifest`);
  invariant(mobileScriptRelative, `${sourceLabel} payload is missing the mobile companion script`);
  invariant(mobileStylesRelative, `${sourceLabel} payload is missing the mobile companion styles`);
  invariant(
    fs.readFileSync(path.join(root, lockRelative)).equals(fs.readFileSync(path.join(repoRoot, "requirements-production.lock.txt"))),
    `${sourceLabel} production lock differs from the release input`,
  );
  for (const relative of [appRelative, backendRelative, onnxRelative, c2paRelative]) {
    const detail = run("file", [path.join(root, relative)]);
    invariant(/x86-64|x86_64/i.test(detail), `${sourceLabel} contains a non-x64 runtime: ${relative}: ${detail.trim()}`);
  }
  const ldd = run("ldd", [path.join(root, appRelative)]);
  invariant(!/not found/i.test(ldd), `${sourceLabel} app has unresolved shared libraries: ${ldd}`);
  return { files: files.length, app: appRelative, backend: backendRelative };
}

function validateDesktopEntry(root, sourceLabel) {
  const desktopFile = recursiveFiles(root).find((name) => /(^|\/)Vintrace\.desktop$/i.test(name));
  invariant(desktopFile, `${sourceLabel} payload is missing Vintrace.desktop`);
  const desktop = fs.readFileSync(path.join(root, desktopFile), "utf8");
  for (const line of ["Name=Vintrace", "Categories=Graphics;Photography;", "StartupWMClass=Vintrace", "Terminal=false"]) {
    invariant(desktop.includes(line), `${sourceLabel} Vintrace.desktop is missing ${line}`);
  }
  return desktopFile;
}

function extractRpm(rpmPath, destination, temp) {
  const archive = path.join(temp, "rpm-payload.cpio");
  let outputHandle;
  try {
    outputHandle = fs.openSync(archive, "w", 0o600);
    const converted = spawnSync("rpm2cpio", [rpmPath], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", outputHandle, "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    invariant(
      !converted.error && converted.status === 0,
      `rpm2cpio failed for ${path.basename(rpmPath)}: ${converted.error?.message || converted.stderr || converted.status}`,
    );
  } finally {
    if (outputHandle != null) fs.closeSync(outputHandle);
  }

  let inputHandle;
  try {
    inputHandle = fs.openSync(archive, "r");
    const extracted = spawnSync("cpio", ["--extract", "--make-directories", "--unconditional", "--no-absolute-filenames", "--quiet"], {
      cwd: destination,
      encoding: "utf8",
      stdio: [inputHandle, "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    invariant(
      !extracted.error && extracted.status === 0,
      `cpio extraction failed for ${path.basename(rpmPath)}: ${extracted.error?.message || extracted.stderr || extracted.status}`,
    );
  } finally {
    if (inputHandle != null) fs.closeSync(inputHandle);
    fs.rmSync(archive, { force: true });
  }
}

function validateNativePackages(dist, artifacts) {
  invariant(process.platform === "linux", "Native Linux artifact inspection must run on Linux");
  const appImagePath = path.join(dist, artifacts.appImage);
  const debPath = path.join(dist, artifacts.deb);
  const rpmPath = path.join(dist, artifacts.rpm);
  for (const file of [appImagePath, debPath, rpmPath]) {
    invariant(fs.statSync(file).size > 80 * 1024 * 1024, `${path.basename(file)} is unexpectedly small`);
  }

  const debFields = run("dpkg-deb", ["--show", "--showformat=${Package}\n${Version}\n${Architecture}\n${Depends}\n", debPath]).trim().split("\n");
  invariant(debFields[0] === "vintrace", `Unexpected deb package name: ${debFields[0]}`);
  invariant(debFields[1] === require(path.join(repoRoot, "package.json")).version, `Unexpected deb version: ${debFields[1]}`);
  invariant(debFields[2] === "amd64", `Unexpected deb architecture: ${debFields[2]}`);
  invariant(debFields.slice(3).join(" ").includes("libsecret-1-0"), "deb metadata must require libsecret-1-0");

  const rpmFields = run("rpm", ["-qp", "--qf", "%{NAME}\n%{VERSION}\n%{ARCH}\n[%{REQUIRENAME}\n]", rpmPath]).trim().split("\n");
  invariant(rpmFields[0] === "vintrace", `Unexpected rpm package name: ${rpmFields[0]}`);
  invariant(rpmFields[1] === require(path.join(repoRoot, "package.json")).version, `Unexpected rpm version: ${rpmFields[1]}`);
  invariant(rpmFields[2] === "x86_64", `Unexpected rpm architecture: ${rpmFields[2]}`);
  invariant(rpmFields.slice(3).includes("libsecret"), "rpm metadata must require libsecret");

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-linux-artifacts-"));
  try {
    const appImageRoot = path.join(temp, "appimage");
    fs.mkdirSync(appImageRoot);
    try {
      run(appImagePath, ["--appimage-extract"], { cwd: appImageRoot });
    } catch (runtimeError) {
      const probe = spawnSync("unsquashfs", ["-version"], { encoding: "utf8" });
      invariant(
        !probe.error,
        `AppImage runtime extraction failed and unsquashfs is unavailable: ${runtimeError.message}`,
      );
      run("unsquashfs", [
        "-o",
        String(findSquashfsOffset(appImagePath)),
        "-d",
        path.join(appImageRoot, "squashfs-root"),
        appImagePath,
      ]);
    }
    const appImagePayload = validateExtractedPayload(path.join(appImageRoot, "squashfs-root"), "AppImage");
    validateDesktopEntry(path.join(appImageRoot, "squashfs-root"), "AppImage");

    const debRoot = path.join(temp, "deb");
    fs.mkdirSync(debRoot);
    run("dpkg-deb", ["--extract", debPath, debRoot]);
    const debPayload = validateExtractedPayload(debRoot, "deb");
    validateDesktopEntry(debRoot, "deb");

    const rpmRoot = path.join(temp, "rpm");
    fs.mkdirSync(rpmRoot);
    extractRpm(rpmPath, rpmRoot, temp);
    const rpmPayload = validateExtractedPayload(rpmRoot, "rpm");
    validateDesktopEntry(rpmRoot, "rpm");
    return { appImage: appImagePayload, deb: debPayload, rpm: rpmPayload };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function inspectLinuxArtifacts({ dist = path.join(repoRoot, "dist"), requireNative = process.env.VINTRACE_LINUX_PACKAGE_REQUIRED === "1" } = {}) {
  const pkg = require(path.join(repoRoot, "package.json"));
  const config = validateLinuxConfiguration(pkg);
  invariant(fs.existsSync(dist), `Linux dist directory does not exist: ${dist}`);
  const files = fs.readdirSync(dist).filter((name) => fs.statSync(path.join(dist, name)).isFile());
  const artifacts = {
    appImage: singleFile(files, /\.AppImage$/i, "AppImage"),
    deb: singleFile(files, /\.deb$/i, "deb"),
    rpm: singleFile(files, /\.rpm$/i, "rpm"),
  };
  const updateMetadata = validateUpdateMetadata(dist, pkg, artifacts);
  const native = requireNative ? validateNativePackages(dist, artifacts) : null;
  return { ok: true, config, artifacts, updateMetadata, native };
}

function main() {
  try {
    console.log(JSON.stringify(inspectLinuxArtifacts(), null, 2));
  } catch (error) {
    console.error(`[linux-artifacts] ${error.message || error}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  configuredTargetArches,
  findSquashfsOffset,
  inspectLinuxArtifacts,
  validateLinuxConfiguration,
  validateUpdateMetadata,
};

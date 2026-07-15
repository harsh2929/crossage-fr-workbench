#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..", "..");
const expectedElectron = Object.freeze({
  electron: "43.1.0",
  chrome: "150.0.7871.47",
  node: "24.18.0",
  v8: "15.0.245.13-electron.0",
  modules: "148",
});
const expectedOnnxRuntime = "1.27.0";
const expectedSecurityPins = Object.freeze({
  mako: "1.3.12",
  onnx: "1.22.0",
  pillow: "12.3.0",
  "pydantic-settings": "2.14.2",
});
const expectedCp311WheelHashes = Object.freeze([
  "2eb083321af8a236a84c7c140a7f4cecbfa2a987a18c07c78db471c20cd390ef", // Linux arm64
  "75fbc1e1fb43a39a856c8209c544cca7817b5de7ac16b15b1bdf55d1cc67b9df", // Windows arm64
  "8ba14a38c570087f3cdb8cfba33f7a38a1e826c1e5b29e17c28ceda0cc910016", // macOS 14 arm64
  "e4f7b0e90d2d212e2c2deaa6c8291616183ab815d3ec558ea12d3ac8b26d36f4", // Linux x64
  "ff050e4f6bf7f12918fa14dcb047c0b02e295f35e86d42532552be4b3d54e977", // Windows x64
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function configuredTargetArches(targets, targetName) {
  const target = Array.isArray(targets)
    ? targets.find((item) => item && typeof item === "object" && item.target === targetName)
    : null;
  return Array.isArray(target?.arch) ? [...target.arch].sort() : [];
}

function pinnedRequirementVersion(source, packageName) {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`^${escaped}==([^\\s;\\\\]+)`, "gmi"))];
  invariant(matches.length === 1, `${packageName} must have one exact production pin; found ${matches.length}`);
  return matches[0][1];
}

function requirementBlock(source, packageName) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.toLowerCase().startsWith(`${packageName.toLowerCase()}==`));
  invariant(start >= 0, `${packageName} is missing from the production lock`);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9][A-Za-z0-9_.-]*==/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

function validateBuildNode() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  invariant(
    (major === 22 && minor >= 12) || major === 23 || major === 24,
    `Build Node must satisfy >=22.12.0 <25; found ${process.versions.node}`
  );
}

function validateElectron(pkg, lock) {
  invariant(pkg.engines?.node === ">=22.12.0 <25", "package.json must enforce the Electron 43 build Node range");
  invariant(pkg.devDependencies?.electron === expectedElectron.electron, "Electron must be an exact package.json pin");
  invariant(lock.packages?.[""]?.devDependencies?.electron === expectedElectron.electron, "Electron root lock pin drifted");
  invariant(lock.packages?.["node_modules/electron"]?.version === expectedElectron.electron, "Electron lock resolution drifted");
  invariant(pkg.build?.mac?.minimumSystemVersion === "14.0", "ONNX Runtime 1.27 macOS builds require macOS 14+");
  for (const target of ["dmg", "zip"]) {
    invariant(
      JSON.stringify(configuredTargetArches(pkg.build?.mac?.target, target)) === JSON.stringify(["arm64"]),
      `${target} must be constrained to arm64 because ONNX Runtime 1.27 has no macOS x64 wheel`
    );
  }
  invariant(
    JSON.stringify(configuredTargetArches(pkg.build?.win?.target, "nsis")) === JSON.stringify(["x64"]),
    "The Windows installer must retain its validated x64 target"
  );
  for (const target of ["AppImage", "deb", "rpm"]) {
    invariant(
      JSON.stringify(configuredTargetArches(pkg.build?.linux?.target, target)) === JSON.stringify(["x64"]),
      `${target} must be constrained to the validated Linux x64 ONNX Runtime wheel`
    );
  }

  const electronPackageFile = require.resolve("electron/package.json", { paths: [root] });
  const electronPackageDir = path.dirname(electronPackageFile);
  const pathFile = path.join(electronPackageDir, "path.txt");
  const versionFile = path.join(electronPackageDir, "dist", "version");
  invariant(fs.existsSync(pathFile), "Electron binary is not installed; run npm run electron:install");
  invariant(fs.existsSync(versionFile), "Electron binary version marker is missing");
  invariant(fs.readFileSync(versionFile, "utf8").trim().replace(/^v/, "") === expectedElectron.electron, "Installed Electron binary version drifted");
  const relativeExecutable = fs.readFileSync(pathFile, "utf8").trim();
  invariant(relativeExecutable && !path.isAbsolute(relativeExecutable), "Electron executable marker must be relative");
  const dist = path.join(electronPackageDir, "dist");
  const executable = path.resolve(dist, relativeExecutable);
  invariant(executable.startsWith(`${path.resolve(dist)}${path.sep}`), "Electron executable marker escaped its package directory");
  invariant(fs.existsSync(executable), `Electron executable is missing: ${executable}`);

  const probe = spawnSync(
    executable,
    ["-e", "process.stdout.write(JSON.stringify(process.versions))"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      timeout: 30_000,
    }
  );
  invariant(!probe.error && probe.status === 0, `Electron runtime probe failed: ${probe.error?.message || probe.stderr || probe.status}`);
  let versions;
  try {
    versions = JSON.parse(String(probe.stdout || "").trim());
  } catch (error) {
    throw new Error(`Electron runtime probe returned invalid JSON: ${error.message}`);
  }
  for (const [name, expected] of Object.entries(expectedElectron)) {
    invariant(String(versions[name] || "") === expected, `Electron ${name} drifted: expected ${expected}, found ${versions[name] || "missing"}`);
  }
  return { executable, versions };
}

function validateNoProductionNodeNativeModules(lock) {
  const nativePackages = [];
  for (const [relative, record] of Object.entries(lock.packages || {})) {
    if (!relative.startsWith("node_modules/") || record.dev === true) continue;
    const packageDir = path.join(root, relative);
    let packageJson = {};
    try {
      packageJson = readJson(path.join(packageDir, "package.json"));
    } catch {
      // npm can omit platform-specific optional packages; their lock metadata is still checked below.
    }
    const native = Boolean(
      record.hasInstallScript
      || packageJson.gypfile
      || packageJson.binary
      || fs.existsSync(path.join(packageDir, "binding.gyp"))
      || fs.existsSync(path.join(packageDir, "prebuilds"))
    );
    if (native) nativePackages.push(`${relative.replace(/^node_modules\//, "")}@${record.version || "unknown"}`);
  }
  invariant(
    nativePackages.length === 0,
    `Electron production dependencies gained native modules that require ABI 148 rebuild validation: ${nativePackages.join(", ")}`
  );
  return nativePackages;
}

function validateOnnxRuntimeLock() {
  const requirementsFile = path.join(root, "requirements-production.txt");
  const baseRequirementsFile = path.join(root, "requirements.txt");
  const lockFile = path.join(root, "requirements-production.lock.txt");
  const requirements = `${fs.readFileSync(requirementsFile, "utf8")}\n${fs.readFileSync(baseRequirementsFile, "utf8")}`;
  const lock = fs.readFileSync(lockFile, "utf8");
  invariant(
    pinnedRequirementVersion(requirements, "onnxruntime") === expectedOnnxRuntime,
    `requirements-production.txt must pin onnxruntime==${expectedOnnxRuntime}`
  );
  invariant(
    pinnedRequirementVersion(lock, "onnxruntime") === expectedOnnxRuntime,
    `requirements-production.lock.txt must resolve onnxruntime==${expectedOnnxRuntime}`
  );
  invariant(
    lock.includes("uv pip compile requirements-production.txt --generate-hashes --universal --python-version 3.11"),
    "Production lock must record a universal Python 3.11+ hash-locked resolution"
  );
  invariant(
    !/^onnxruntime-(?:gpu|openvino|training|training-cpu)==/mi.test(lock),
    "Conflicting ONNX Runtime distributions must not enter the production lock"
  );
  for (const [packageName, expectedVersion] of Object.entries(expectedSecurityPins)) {
    invariant(
      pinnedRequirementVersion(requirements, packageName) === expectedVersion,
      `${packageName} must retain its security-fixed input pin ${expectedVersion}`
    );
    invariant(
      pinnedRequirementVersion(lock, packageName) === expectedVersion,
      `${packageName} must retain its security-fixed lock resolution ${expectedVersion}`
    );
  }
  const block = requirementBlock(lock, "onnxruntime");
  const hashes = new Set([...block.matchAll(/--hash=sha256:([a-f0-9]{64})/g)].map((match) => match[1]));
  invariant(hashes.size === 24, `ONNX Runtime 1.27.0 universal lock must contain all 24 release wheel hashes; found ${hashes.size}`);
  for (const hash of expectedCp311WheelHashes) {
    invariant(hashes.has(hash), `Production lock is missing supported CPython 3.11 ONNX Runtime wheel ${hash}`);
  }
  return {
    hashCount: hashes.size,
    supportedCp311WheelHashes: expectedCp311WheelHashes,
    securityPins: expectedSecurityPins,
  };
}

function main() {
  validateBuildNode();
  const pkg = readJson(path.join(root, "package.json"));
  const lock = readJson(path.join(root, "package-lock.json"));
  const electron = validateElectron(pkg, lock);
  const nativePackages = validateNoProductionNodeNativeModules(lock);
  const onnxruntime = validateOnnxRuntimeLock();
  console.log(JSON.stringify({
    ok: true,
    buildNode: process.versions.node,
    electron: {
      expected: expectedElectron,
      executable: electron.executable,
      actual: electron.versions,
      productionNativeModules: nativePackages,
    },
    onnxruntime: {
      version: expectedOnnxRuntime,
      ...onnxruntime,
    },
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`[dependency-currency] ${error.message || error}`);
  process.exit(1);
}

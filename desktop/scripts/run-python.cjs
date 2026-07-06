#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const script = process.argv[2];

if (!script) {
  console.error("Usage: node desktop/scripts/run-python.cjs <script.py> [args...]");
  process.exit(2);
}

function candidates() {
  const explicit = process.env.PYTHON;
  const local = process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  return [explicit, local, "python3", "python"].filter(Boolean);
}

const inheritedRegistry = process.env.VINTRACE_RUN_PYTHON_USE_ENV_REGISTRY === "1"
  ? (process.env.VINTRACE_REGISTRY_HOME || process.env.CROSSAGE_REGISTRY_HOME || "")
  : "";
let tempRegistryRoot = "";

function registryHome() {
  if (inheritedRegistry) {
    return inheritedRegistry;
  }
  if (!tempRegistryRoot) {
    tempRegistryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-python-registry-"));
  }
  return tempRegistryRoot;
}

function pythonPath() {
  if (!process.env.PYTHONPATH) {
    return repoRoot;
  }
  // repoRoot is deliberately PREPENDED so first-party crossage_fr modules always
  // resolve ahead of anything an inherited PYTHONPATH might try to shadow. This
  // is a dev/CI helper; we keep the inherited entries (venv etc.) but never let
  // them take precedence over the repo.
  return `${repoRoot}${path.delimiter}${process.env.PYTHONPATH}`;
}

let exitCode = 127;
let ran = false;

try {
  for (const candidate of candidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
      continue;
    }
    const registry = registryHome();
    const result = spawnSync(candidate, [script, ...process.argv.slice(3)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath(),
        CROSSAGE_FORCE_FALLBACK: process.env.CROSSAGE_FORCE_FALLBACK || "1",
        VINTRACE_REGISTRY_HOME: registry,
        CROSSAGE_REGISTRY_HOME: registry
      },
      stdio: "inherit",
      windowsHide: true
    });
    if (!result.error) {
      exitCode = result.status ?? 1;
      ran = true;
      break;
    }
    if (result.error.code !== "ENOENT") {
      console.error(result.error.message);
      exitCode = 1;
      ran = true;
      break;
    }
  }
} finally {
  if (tempRegistryRoot) {
    fs.rmSync(tempRegistryRoot, { recursive: true, force: true });
  }
}

if (!ran) {
  console.error("Could not find Python. Create .venv or set PYTHON.");
}
process.exit(exitCode);

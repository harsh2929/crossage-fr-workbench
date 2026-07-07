#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runFirstPython } = require("./python-runner.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const script = process.argv[2];

if (!script) {
  console.error("Usage: node desktop/scripts/run-python.cjs <script.py> [args...]");
  process.exit(2);
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

let exitCode = 127;
let ran = false;

try {
  const registry = registryHome();
  const result = runFirstPython({
    repoRoot,
    args: [script, ...process.argv.slice(3)],
    extraEnv: {
      VINTRACE_REGISTRY_HOME: registry,
      CROSSAGE_REGISTRY_HOME: registry
    },
    stdio: "inherit",
    onWarning: (message) => console.error(message)
  });
  exitCode = result.exitCode;
  ran = result.ran;
} finally {
  if (tempRegistryRoot) {
    fs.rmSync(tempRegistryRoot, { recursive: true, force: true });
  }
}

if (!ran) {
  console.error("Could not find Python. Create .venv or set PYTHON.");
}
process.exit(exitCode);

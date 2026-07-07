#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runFirstPython } = require("./python-runner.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-backend-check-"));
const registry = path.join(root, "registry");
const workspace = path.join(root, "workspace");
let exitCode = 127;
let ran = false;

try {
  const result = runFirstPython({
    repoRoot,
    args: ["-m", "crossage_fr.api_server"],
    extraEnv: {
      VINTRACE_WORKSPACE: workspace,
      CROSSAGE_WORKSPACE: workspace,
      VINTRACE_REGISTRY_HOME: registry,
      CROSSAGE_REGISTRY_HOME: registry
    },
    stdio: ["ignore", "inherit", "inherit"],
    onWarning: (message) => console.error(message)
  });
  exitCode = result.exitCode;
  ran = result.ran;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (!ran) {
  console.error("Could not find Python. Create .venv or set PYTHON.");
}
process.exit(exitCode);

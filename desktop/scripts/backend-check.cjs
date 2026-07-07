#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");

function candidates() {
  const explicit = process.env.PYTHON;
  const local = process.platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  return [explicit, local, "python3", "python"].filter(Boolean);
}

function pythonPath() {
  if (!process.env.PYTHONPATH) {
    return repoRoot;
  }
  return `${repoRoot}${path.delimiter}${process.env.PYTHONPATH}`;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-backend-check-"));
const registry = path.join(root, "registry");
const workspace = path.join(root, "workspace");
let exitCode = 127;
let ran = false;

try {
  for (const candidate of candidates()) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
      continue;
    }
    const result = spawnSync(candidate, ["-m", "crossage_fr.api_server"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONPATH: pythonPath(),
        CROSSAGE_FORCE_FALLBACK: process.env.CROSSAGE_FORCE_FALLBACK || "1",
        VINTRACE_WORKSPACE: workspace,
        CROSSAGE_WORKSPACE: workspace,
        VINTRACE_REGISTRY_HOME: registry,
        CROSSAGE_REGISTRY_HOME: registry
      },
      stdio: ["ignore", "inherit", "inherit"],
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
  fs.rmSync(root, { recursive: true, force: true });
}

if (!ran) {
  console.error("Could not find Python. Create .venv or set PYTHON.");
}
process.exit(exitCode);

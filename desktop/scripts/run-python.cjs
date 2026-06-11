#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
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

for (const candidate of candidates()) {
  if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
    continue;
  }
  const result = spawnSync(candidate, [script, ...process.argv.slice(3)], {
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONPATH: process.env.PYTHONPATH || repoRoot,
      CROSSAGE_FORCE_FALLBACK: process.env.CROSSAGE_FORCE_FALLBACK || "1"
    },
    stdio: "inherit",
    windowsHide: true
  });
  if (!result.error) {
    process.exit(result.status ?? 1);
  }
  if (result.error.code !== "ENOENT") {
    console.error(result.error.message);
    process.exit(1);
  }
}

console.error("Could not find Python. Create .venv or set PYTHON.");
process.exit(127);

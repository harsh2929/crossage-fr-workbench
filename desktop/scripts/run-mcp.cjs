const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const venvPython =
  process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python3");
const python = fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";

const result = spawnSync(python, ["-m", "crossage_fr.mcp_server", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: root
  }
});

process.exit(result.status ?? 1);

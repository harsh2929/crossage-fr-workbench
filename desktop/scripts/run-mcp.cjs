const path = require("path");
const { runFirstPython } = require("./python-runner.cjs");

const root = path.resolve(__dirname, "..", "..");

const result = runFirstPython({
  repoRoot: root,
  args: ["-m", "crossage_fr.mcp_server", ...process.argv.slice(2)],
  extraEnv: { VINTRACE_REQUIRE_DB_ENCRYPTION: "1" },
  stdio: "inherit",
  onWarning: (message) => console.error(message)
});

if (!result.ran) {
  console.error("Could not find Python. Create .venv or set PYTHON.");
}
process.exit(result.exitCode);

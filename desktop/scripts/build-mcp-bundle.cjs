const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const packageJson = require(path.join(root, "package.json"));
const platform = process.platform;
const arch = process.arch;
const backendName = platform === "win32" ? "crossage-backend.exe" : "crossage-backend";
const backendPath = path.join(root, "backend-dist", backendName);
const templatePath = path.join(root, "mcp", "manifest.json");
const buildRoot = path.join(root, "build", "mcpb", "crossage-fr-workbench");
const serverDir = path.join(buildRoot, "server");
const modelSourceDir = path.join(root, "models", "safety");
const modelDestDir = path.join(buildRoot, "models", "safety");
const outputDir = path.join(root, "dist");
const outputPath = path.join(outputDir, `CrossAge-FR-Workbench-${platform}-${arch}.mcpb`);
const reportPath = path.join(root, "report.md");
const localMcpbBin = path.join(root, "node_modules", ".bin", platform === "win32" ? "mcpb.cmd" : "mcpb");
const mcpbCommand = fs.existsSync(localMcpbBin) ? localMcpbBin : "npx";
const mcpbPrefixArgs = fs.existsSync(localMcpbBin) ? [] : ["-y", "@anthropic-ai/mcpb"];

if (!fs.existsSync(backendPath)) {
  console.error(`Missing backend sidecar at ${backendPath}. Run npm run build:backend first.`);
  process.exit(1);
}
if (!fs.existsSync(templatePath)) {
  console.error(`Missing MCPB manifest template at ${templatePath}.`);
  process.exit(1);
}
fs.rmSync(buildRoot, { recursive: true, force: true });
fs.mkdirSync(serverDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.copyFileSync(backendPath, path.join(serverDir, backendName));
if (platform !== "win32") {
  fs.chmodSync(path.join(serverDir, backendName), 0o755);
}
if (fs.existsSync(modelSourceDir)) {
  fs.cpSync(modelSourceDir, modelDestDir, { recursive: true });
}
if (fs.existsSync(reportPath)) {
  fs.copyFileSync(reportPath, path.join(buildRoot, "report.md"));
}
const mcpIcon = path.join(root, "mcp", "icon.png");
const fallbackIcon = path.join(root, "desktop", "assets", "icon.png");
fs.copyFileSync(fs.existsSync(mcpIcon) ? mcpIcon : fallbackIcon, path.join(buildRoot, "icon.png"));

const manifest = JSON.parse(fs.readFileSync(templatePath, "utf8"));
manifest.version = packageJson.version;
manifest.icon = "icon.png";
manifest.compatibility = {
  ...(manifest.compatibility || {}),
  platforms: [platform]
};
fs.writeFileSync(path.join(buildRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

for (const args of [
  ["validate", path.join(buildRoot, "manifest.json")],
  ["pack", buildRoot, outputPath]
]) {
  const result = spawnSync(mcpbCommand, [...mcpbPrefixArgs, ...args], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Built ${outputPath}`);

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function resolveMcpbRunner(root, platform = process.platform, fsImpl = fs) {
  const localMcpbBin = path.join(root, "node_modules", ".bin", platform === "win32" ? "mcpb.cmd" : "mcpb");
  if (fsImpl.existsSync(localMcpbBin)) {
    return {
      command: localMcpbBin,
      prefixArgs: [],
      shell: platform === "win32",
      source: "local",
    };
  }
  return {
    command: platform === "win32" ? "npx.cmd" : "npx",
    prefixArgs: ["-y", "@anthropic-ai/mcpb"],
    shell: platform === "win32",
    source: "npx",
  };
}

function exitStatusForResult(result) {
  if (typeof result.status === "number") {
    return result.status;
  }
  return 1;
}

function runMcpbStep(args, options = {}) {
  const {
    cwd,
    runner,
    spawnSyncImpl = spawnSync,
    stderr = console.error,
  } = options;
  const result = spawnSyncImpl(runner.command, [...runner.prefixArgs, ...args], {
    cwd,
    stdio: "inherit",
    shell: runner.shell,
    windowsHide: true,
  });
  if (result.error) {
    stderr(`Failed to run ${runner.command}: ${result.error.message}`);
    return 1;
  }
  const status = exitStatusForResult(result);
  if (status !== 0) {
    const detail = result.signal ? `signal ${result.signal}` : `exit code ${status}`;
    stderr(`mcpb ${args[0] || "command"} failed with ${detail}.`);
  }
  return status;
}

function buildMcpBundle(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const packageJson = options.packageJson || require(path.join(root, "package.json"));
  const stderr = options.stderr || console.error;
  const stdout = options.stdout || console.log;
  const backendName = platform === "win32" ? "crossage-backend.exe" : "crossage-backend";
  const backendDir = path.join(root, "backend-dist", "crossage-backend");
  const backendFile = path.join(root, "backend-dist", backendName);
  const backendPath = fsImpl.existsSync(path.join(backendDir, backendName)) ? backendDir : backendFile;
  const templatePath = path.join(root, "mcp", "manifest.json");
  const buildRoot = path.join(root, "build", "mcpb", "vintrace");
  const serverDir = path.join(buildRoot, "server");
  const modelSourceDir = path.join(root, "models", "safety");
  const modelDestDir = path.join(buildRoot, "models", "safety");
  const mcpAppsLicense = path.join(root, "node_modules", "@modelcontextprotocol", "ext-apps", "LICENSE");
  const outputDir = path.join(root, "dist");
  const outputPath = path.join(outputDir, `Vintrace-${platform}-${arch}.mcpb`);
  const reportPath = path.join(root, "report.md");

  if (!fsImpl.existsSync(backendPath)) {
    stderr(`Missing backend sidecar at ${backendPath}. Run npm run build:backend first.`);
    return 1;
  }
  if (!fsImpl.existsSync(templatePath)) {
    stderr(`Missing MCPB manifest template at ${templatePath}.`);
    return 1;
  }
  fsImpl.rmSync(buildRoot, { recursive: true, force: true });
  fsImpl.mkdirSync(serverDir, { recursive: true });
  fsImpl.mkdirSync(outputDir, { recursive: true });
  if (fsImpl.statSync(backendPath).isDirectory()) {
    fsImpl.cpSync(backendPath, path.join(serverDir, "crossage-backend"), { recursive: true });
    if (platform !== "win32") {
      fsImpl.chmodSync(path.join(serverDir, "crossage-backend", backendName), 0o755);
    }
  } else {
    const fallbackDir = path.join(serverDir, "crossage-backend");
    fsImpl.mkdirSync(fallbackDir, { recursive: true });
    fsImpl.copyFileSync(backendPath, path.join(fallbackDir, backendName));
    if (platform !== "win32") {
      fsImpl.chmodSync(path.join(fallbackDir, backendName), 0o755);
    }
  }
  if (fsImpl.existsSync(modelSourceDir)) {
    fsImpl.cpSync(modelSourceDir, modelDestDir, { recursive: true });
  }
  if (fsImpl.existsSync(reportPath)) {
    fsImpl.copyFileSync(reportPath, path.join(buildRoot, "report.md"));
  }
  if (!fsImpl.existsSync(mcpAppsLicense)) {
    stderr(`Missing MCP Apps SDK license at ${mcpAppsLicense}. Run npm ci first.`);
    return 1;
  }
  fsImpl.mkdirSync(path.join(buildRoot, "licenses"), { recursive: true });
  fsImpl.copyFileSync(mcpAppsLicense, path.join(buildRoot, "licenses", "MCP-Apps-SDK-LICENSE.txt"));
  const mcpIcon = path.join(root, "mcp", "icon.png");
  const fallbackIcon = path.join(root, "desktop", "assets", "icon.png");
  fsImpl.copyFileSync(fsImpl.existsSync(mcpIcon) ? mcpIcon : fallbackIcon, path.join(buildRoot, "icon.png"));

  const manifest = JSON.parse(fsImpl.readFileSync(templatePath, "utf8"));
  manifest.version = packageJson.version;
  manifest.icon = "icon.png";
  manifest.compatibility = {
    ...(manifest.compatibility || {}),
    platforms: [platform]
  };
  fsImpl.writeFileSync(path.join(buildRoot, "manifest.json"), JSON.stringify(manifest, null, 2));

  const runner = resolveMcpbRunner(root, platform, fsImpl);
  for (const args of [
    ["validate", path.join(buildRoot, "manifest.json")],
    ["pack", buildRoot, outputPath]
  ]) {
    const status = runMcpbStep(args, {
      cwd: root,
      runner,
      spawnSyncImpl: options.spawnSyncImpl,
      stderr,
    });
    if (status !== 0) {
      return status;
    }
  }

  stdout(`Built ${outputPath}`);
  return 0;
}

if (require.main === module) {
  process.exit(buildMcpBundle());
}

module.exports = {
  buildMcpBundle,
  resolveMcpbRunner,
  runMcpbStep,
};

const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const venvPython =
  process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python3");
const python = fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
const outputDir = path.join(root, "backend-dist");

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}
const meanShapeLookup = spawnSync(
  python,
  [
    "-c",
    "from pathlib import Path; import insightface.data; print(Path(insightface.data.__file__).parent / 'objects' / 'meanshape_68.pkl')"
  ],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: root
    }
  }
);
const meanShapePath = meanShapeLookup.status === 0 ? meanShapeLookup.stdout.trim() : "";
const reportPath = path.join(root, "report.md");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const args = [
  "-m",
  "PyInstaller",
  "--clean",
  "--noconfirm",
  "--onedir",
  "--collect-submodules",
  "mcp",
  "--collect-data",
  "insightface",
  ...(meanShapePath && fs.existsSync(meanShapePath) ? ["--add-data", `${meanShapePath}${path.delimiter}objects`] : []),
  ...(fs.existsSync(reportPath) ? ["--add-data", `${reportPath}${path.delimiter}.`] : []),
  "--hidden-import",
  "crossage_fr.mcp_server",
  "--hidden-import",
  "crossage_fr.experiments.self_learning_audit",
  "--hidden-import",
  "crossage_fr.experiments.onnx_training",
  "--hidden-import",
  "crossage_fr.experiments.retraining_governance",
  "--hidden-import",
  "mcp.server.fastmcp",
  "--hidden-import",
  "rawpy",
  "--hidden-import",
  "onnxruntime",
  "--hidden-import",
  "certifi",
  "--hidden-import",
  "cv2",
  "--hidden-import",
  "imageio_ffmpeg",
  "--collect-data",
  "imageio_ffmpeg",
  "--collect-binaries",
  "imageio_ffmpeg",
  "--name",
  "crossage-backend",
  "--distpath",
  outputDir,
  "--workpath",
  path.join(root, "build", "pyinstaller"),
  "--specpath",
  path.join(root, "build"),
  path.join(root, "crossage_fr", "api_server.py")
];

const result = spawnSync(python, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PYTHONPATH: root
  }
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

// Verify PyInstaller actually produced a non-empty backend executable. A silent
// failure or corrupt output would otherwise exit 0 here and only surface later
// during electron-builder packaging or at first launch.
const exeName = process.platform === "win32" ? "crossage-backend.exe" : "crossage-backend";
const exePath = path.join(outputDir, "crossage-backend", exeName);
try {
  const stat = fs.statSync(exePath);
  if (!stat.isFile() || stat.size <= 0) {
    console.error(`[build-backend] PyInstaller output missing or empty: ${exePath}`);
    process.exit(1);
  }
  const relativeExePath = path.relative(outputDir, exePath).replace(/\\/g, "/");
  const digest = sha256File(exePath);
  const manifest = {
    generatedAt: new Date().toISOString(),
    executable: relativeExePath,
    bytes: stat.size,
    sha256: digest
  };
  fs.writeFileSync(path.join(outputDir, "crossage-backend.sha256"), `${digest}  ${relativeExePath}\n`, "utf8");
  fs.writeFileSync(
    path.join(outputDir, "crossage-backend-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
} catch (error) {
  console.error(`[build-backend] PyInstaller did not produce ${exePath}: ${error.message}`);
  process.exit(1);
}
process.exit(0);

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const venvPython =
  process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python3");
const python = fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3";
const outputDir = path.join(root, "backend-dist");
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

process.exit(result.status ?? 1);

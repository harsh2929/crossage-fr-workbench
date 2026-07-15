const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const venvPython =
  process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python3");
const explicitPython = String(process.env.VINTRACE_BUILD_PYTHON || process.env.PYTHON || "").trim();
const python = explicitPython || (fs.existsSync(venvPython) ? venvPython : process.platform === "win32" ? "python" : "python3");
const outputDir = path.join(root, "backend-dist");
const workDir = path.join(root, "build", "pyinstaller");
const hookDir = path.join(root, "desktop", "pyinstaller-hooks");
const applePhotosEnabled = process.platform === "darwin";
const applePhotosCollectionPackages = [
  "osxphotos",
  "applescript",
  "bitarray",
  "bitstring",
  "bpylist2",
  "cgmetadata",
  "mac_alias",
  "makelive",
  "osxmetadata",
  "photoscript",
  "strpdatetime",
  "textx",
  "tibs",
  "utitools",
  "whenever"
];

if (explicitPython && /[\\/]/.test(explicitPython) && !fs.existsSync(explicitPython)) {
  console.error(`[build-backend] Explicit build interpreter does not exist: ${explicitPython}`);
  process.exit(1);
}

const pythonVersionLookup = spawnSync(
  python,
  ["-c", "import json, platform, sys; print(json.dumps({'implementation': platform.python_implementation(), 'version': platform.python_version(), 'minor': f'{sys.version_info.major}.{sys.version_info.minor}'}))"],
  { cwd: root, encoding: "utf8" }
);
if (pythonVersionLookup.error || (pythonVersionLookup.status ?? 1) !== 0) {
  const details = String(
    pythonVersionLookup.error?.message || pythonVersionLookup.stderr || pythonVersionLookup.stdout || ""
  ).trim();
  console.error(`[build-backend] Could not run build interpreter ${python}${details ? `: ${details}` : ""}`);
  process.exit(pythonVersionLookup.status ?? 1);
}
let buildPython;
try {
  buildPython = JSON.parse(String(pythonVersionLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] Build interpreter returned invalid version metadata: ${error.message}`);
  process.exit(1);
}
const requiredPythonMinor = String(process.env.VINTRACE_REQUIRE_PYTHON_MINOR || "").trim();
if (requiredPythonMinor && buildPython.minor !== requiredPythonMinor) {
  console.error(
    `[build-backend] Release backend requires Python ${requiredPythonMinor}; ${python} is Python ${buildPython.version}.`
  );
  process.exit(1);
}
console.log(`[build-backend] Python ${buildPython.version} (${buildPython.implementation}) via ${python}`);

const onnxRuntimeLookup = spawnSync(
  python,
  [
    "-c",
    "import json; from crossage_fr.dependency_currency import onnxruntime_runtime_report; print(json.dumps(onnxruntime_runtime_report()))"
  ],
  { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } }
);
if (onnxRuntimeLookup.error || (onnxRuntimeLookup.status ?? 1) !== 0) {
  const details = String(onnxRuntimeLookup.error?.message || onnxRuntimeLookup.stderr || onnxRuntimeLookup.stdout || "").trim();
  console.error(`[build-backend] ONNX Runtime validation failed${details ? `: ${details}` : ""}`);
  process.exit(onnxRuntimeLookup.status ?? 1);
}
let onnxRuntime;
try {
  onnxRuntime = JSON.parse(String(onnxRuntimeLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] ONNX Runtime returned invalid metadata: ${error.message}`);
  process.exit(1);
}
if (
  onnxRuntime.ok !== true ||
  onnxRuntime.packageVersion !== "1.27.0" ||
  onnxRuntime.runtimeVersion !== "1.27.0" ||
  onnxRuntime.nativeModulePresent !== true ||
  !Array.isArray(onnxRuntime.providers) ||
  !onnxRuntime.providers.includes("CPUExecutionProvider") ||
  JSON.stringify(onnxRuntime.inferenceOutput) !== JSON.stringify([0.25, -1.5])
) {
  console.error(`[build-backend] Expected onnxruntime 1.27.0 with its native CPU runtime and inference probe; found ${JSON.stringify(onnxRuntime)}.`);
  process.exit(1);
}

const sqlcipherLookup = spawnSync(
  python,
  ["-c", "from importlib.metadata import version; from sqlcipher3 import dbapi2 as db; c=db.connect(':memory:'); v=c.execute('PRAGMA cipher_version').fetchone(); c.close(); print(version('sqlcipher3')); print(v[0] if v else '')"],
  { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } }
);
if (sqlcipherLookup.error || (sqlcipherLookup.status ?? 1) !== 0) {
  const details = String(sqlcipherLookup.error?.message || sqlcipherLookup.stderr || sqlcipherLookup.stdout || "").trim();
  console.error(`[build-backend] SQLCipher runtime validation failed${details ? `: ${details}` : ""}`);
  process.exit(sqlcipherLookup.status ?? 1);
}
const [sqlcipherBindingVersion, sqlcipherVersion] = String(sqlcipherLookup.stdout || "").trim().split(/\r?\n/);
if (sqlcipherBindingVersion !== "0.6.2" || !/^4\./.test(sqlcipherVersion || "")) {
  console.error(`[build-backend] Expected sqlcipher3 0.6.2 backed by SQLCipher 4.x; found ${sqlcipherBindingVersion || "unknown"} / ${sqlcipherVersion || "unknown"}.`);
  process.exit(1);
}

const localSyncLookup = spawnSync(
  python,
  [
    "-c",
    "import json; from importlib.metadata import distribution; from crossage_fr.local_sync import local_sync_runtime_report; z=distribution('zeroconf'); i=distribution('ifaddr'); pick=lambda d: str(d.locate_file(next(f for f in d.files if 'license' in str(f).lower() or str(f).lower().endswith('copying')))); r=local_sync_runtime_report(); r['licensePaths']={'zeroconf':pick(z),'ifaddr':pick(i)}; print(json.dumps(r))"
  ],
  { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } }
);
if (localSyncLookup.error || (localSyncLookup.status ?? 1) !== 0) {
  const details = String(localSyncLookup.error?.message || localSyncLookup.stderr || localSyncLookup.stdout || "").trim();
  console.error(`[build-backend] Local sync discovery runtime validation failed${details ? `: ${details}` : ""}`);
  process.exit(localSyncLookup.status ?? 1);
}
let localSyncRuntime;
try {
  localSyncRuntime = JSON.parse(String(localSyncLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] Local sync discovery runtime returned invalid metadata: ${error.message}`);
  process.exit(1);
}
const localSyncLicenseDigests = {
  zeroconf: "4d1d974999ae8655ee47afb47ac3b327cd1baeea3509aecb35341ba1a1a53c94",
  ifaddr: "8700856576ae2bc80c63bc970250510d9213fb02fed006d5f22742c9ddde24d7",
};
if (
  localSyncRuntime.available !== true ||
  localSyncRuntime.zeroconfVersion !== "0.149.17" ||
  localSyncRuntime.ifaddrVersion !== "0.2.0" ||
  localSyncRuntime.serviceType !== "_vintrace-sync._tcp.local." ||
  localSyncRuntime.internetService !== false ||
  Object.entries(localSyncLicenseDigests).some(([name, digest]) => {
    const file = String(localSyncRuntime.licensePaths?.[name] || "");
    return !file || !fs.existsSync(file) || sha256File(file) !== digest;
  })
) {
  console.error(`[build-backend] Local sync discovery runtime, service type, or license pin failed: ${JSON.stringify(localSyncRuntime)}.`);
  process.exit(1);
}

const c2paLookup = spawnSync(
  python,
  [
    "-c",
    "import json, c2pa; from importlib.metadata import version; supported=set(c2pa.Builder.get_supported_mime_types()); required={'image/jpeg','image/png','image/tiff','image/heic','video/mp4','video/quicktime'}; print(json.dumps({'package': version('c2pa-python'), 'native': c2pa.sdk_version(), 'missing': sorted(required-supported)}))"
  ],
  { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } }
);
if (c2paLookup.error || (c2paLookup.status ?? 1) !== 0) {
  const details = String(c2paLookup.error?.message || c2paLookup.stderr || c2paLookup.stdout || "").trim();
  console.error(`[build-backend] C2PA runtime validation failed${details ? `: ${details}` : ""}`);
  process.exit(c2paLookup.status ?? 1);
}
let c2paRuntime;
try {
  c2paRuntime = JSON.parse(String(c2paLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] C2PA runtime returned invalid metadata: ${error.message}`);
  process.exit(1);
}
if (
  c2paRuntime.package !== "0.36.0" ||
  c2paRuntime.native !== "0.89.0" ||
  !Array.isArray(c2paRuntime.missing) ||
  c2paRuntime.missing.length
) {
  console.error(
    `[build-backend] Expected c2pa-python 0.36.0 / native SDK 0.89.0 with required media support; found ${c2paRuntime.package || "unknown"} / ${c2paRuntime.native || "unknown"}${c2paRuntime.missing?.length ? ` (missing: ${c2paRuntime.missing.join(", ")})` : ""}.`
  );
  process.exit(1);
}
const c2paLicenseDir = path.join(root, "licenses");
const c2paLicenseFiles = [
  ["C2PA-LICENSE-APACHE.txt", "86bdd5dafab77451044b6fd6d2efab23e3410ce658eb097f04c04f4f54aed62f"],
  ["C2PA-LICENSE-MIT.txt", "89375a50de90d2dcaa04406086da832ad452ebcaf6ab402ef3d51b8401a67c71"]
];
if (c2paLicenseFiles.some(([filename, digest]) => {
  const file = path.join(c2paLicenseDir, filename);
  return !fs.existsSync(file) || sha256File(file) !== digest;
})) {
  console.error("[build-backend] C2PA Apache-2.0 or MIT license text is missing or does not match upstream v0.36.0.");
  process.exit(1);
}

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
if (meanShapeLookup.error) {
  console.error(`[build-backend] Could not locate insightface meanshape_68.pkl: ${meanShapeLookup.error.message}`);
  process.exit(1);
}
if ((meanShapeLookup.status ?? 1) !== 0) {
  const details = String(meanShapeLookup.stderr || meanShapeLookup.stdout || "").trim();
  console.error(`[build-backend] Could not locate insightface meanshape_68.pkl${details ? `: ${details}` : ""}`);
  process.exit(meanShapeLookup.status ?? 1);
}
const meanShapePath = meanShapeLookup.stdout.trim();
if (!meanShapePath || !fs.existsSync(meanShapePath)) {
  console.error(`[build-backend] insightface meanshape_68.pkl not found: ${meanShapePath || "(empty lookup)"}`);
  process.exit(1);
}
const openCvDataLookup = spawnSync(
  python,
  ["-c", "from pathlib import Path; import cv2; print(Path(cv2.data.haarcascades).resolve())"],
  {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PYTHONPATH: root
    }
  }
);
if (openCvDataLookup.error || (openCvDataLookup.status ?? 1) !== 0) {
  const details = String(
    openCvDataLookup.error?.message || openCvDataLookup.stderr || openCvDataLookup.stdout || ""
  ).trim();
  console.error(`[build-backend] Could not locate OpenCV Haar resources${details ? `: ${details}` : ""}`);
  process.exit(openCvDataLookup.status ?? 1);
}
const openCvHaarDir = String(openCvDataLookup.stdout || "").trim();
const requiredHaarFiles = [
  "haarcascade_frontalface_default.xml",
  "haarcascade_eye_tree_eyeglasses.xml"
];
if (
  !openCvHaarDir ||
  !fs.statSync(openCvHaarDir, { throwIfNoEntry: false })?.isDirectory() ||
  requiredHaarFiles.some((filename) => !fs.existsSync(path.join(openCvHaarDir, filename)))
) {
  console.error(`[build-backend] Required OpenCV Haar resources are missing under ${openCvHaarDir || "(empty path)"}.`);
  process.exit(1);
}
if (applePhotosEnabled) {
  const osxphotosLookup = spawnSync(
    python,
    ["-c", "import osxphotos; print(osxphotos.__version__)"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH: root
      }
    }
  );
  if (osxphotosLookup.error || (osxphotosLookup.status ?? 1) !== 0) {
    const details = String(
      osxphotosLookup.error?.message || osxphotosLookup.stderr || osxphotosLookup.stdout || ""
    ).trim();
    console.error(
      `[build-backend] macOS builds require osxphotos==0.76.1${details ? `: ${details}` : ""}`
    );
    process.exit(osxphotosLookup.status ?? 1);
  }
  const version = String(osxphotosLookup.stdout || "").trim();
  if (version !== "0.76.1") {
    console.error(`[build-backend] Expected osxphotos 0.76.1, found ${version || "unknown"}`);
    process.exit(1);
  }
}
const rapidOcrLookup = spawnSync(
  python,
  [
    "-c",
    "import json; from importlib.metadata import version; from pathlib import Path; import rapidocr; root=Path(rapidocr.__file__).resolve().parent; print(json.dumps({'version': version('rapidocr'), 'config': str(root / 'config.yaml'), 'models': str(root / 'default_models.yaml')}))"
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
if (rapidOcrLookup.error || (rapidOcrLookup.status ?? 1) !== 0) {
  const details = String(
    rapidOcrLookup.error?.message || rapidOcrLookup.stderr || rapidOcrLookup.stdout || ""
  ).trim();
  console.error(`[build-backend] PP-OCRv6 requires rapidocr==3.9.1${details ? `: ${details}` : ""}`);
  process.exit(rapidOcrLookup.status ?? 1);
}
let rapidOcrPackage;
try {
  rapidOcrPackage = JSON.parse(String(rapidOcrLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] RapidOCR package metadata is invalid: ${error.message}`);
  process.exit(1);
}
const rapidOcrConfigPath = String(rapidOcrPackage.config || "");
const rapidOcrModelsConfigPath = String(rapidOcrPackage.models || "");
if (
  rapidOcrPackage.version !== "3.9.1" ||
  !fs.existsSync(rapidOcrConfigPath) ||
  !fs.existsSync(rapidOcrModelsConfigPath)
) {
  console.error("[build-backend] Expected rapidocr 3.9.1 with its pinned runtime configuration files.");
  process.exit(1);
}
const reportPath = path.join(root, "report.md");
const mobileDistDir = path.join(root, "mobile-dist");
const mobileRequiredFiles = [
  path.join(mobileDistDir, "index.html"),
  path.join(mobileDistDir, "manifest.webmanifest"),
  path.join(mobileDistDir, "icon.png"),
];
let mobileAssets = [];
try {
  mobileAssets = fs.readdirSync(path.join(mobileDistDir, "assets"));
} catch {
  mobileAssets = [];
}
if (
  mobileRequiredFiles.some((file) => !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
  || !mobileAssets.some((file) => /^mobile-[A-Za-z0-9_-]+\.js$/.test(file))
  || !mobileAssets.some((file) => /^mobile-[A-Za-z0-9_-]+\.css$/.test(file))
) {
  console.error("[build-backend] The production mobile companion bundle is missing; run npm run build:mobile.");
  process.exit(1);
}
const fiqaDir = path.join(root, "models", "fiq");
const fiqaModelPath = path.join(fiqaDir, "ediffiqa_tiny_jun2024.onnx");
const fiqaManifestPath = path.join(fiqaDir, "manifest.json");
const fiqaLicensePath = path.join(fiqaDir, "LICENSE");
const fiqaExpectedSha256 = "9426c899cc0f01665240cb7d9e7f98e18e24e456c178326c771a43da289bfc6a";
const fiqaExpectedBytes = 7_272_678;
if (!fs.existsSync(fiqaModelPath) || !fs.existsSync(fiqaManifestPath) || !fs.existsSync(fiqaLicensePath)) {
  console.error("[build-backend] Verified eDifFIQA(T) model pack is incomplete under models/fiq.");
  process.exit(1);
}
let fiqaManifest;
try {
  fiqaManifest = JSON.parse(fs.readFileSync(fiqaManifestPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid FIQA manifest: ${error.message}`);
  process.exit(1);
}
const fiqaActualBytes = fs.statSync(fiqaModelPath).size;
const fiqaActualSha256 = sha256File(fiqaModelPath);
if (
  fiqaManifest.modelId !== "opencv-ediffiqa-tiny-jun2024" ||
  fiqaManifest.license !== "CC-BY-4.0" ||
  fiqaManifest.licenseSha256 !== "9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94" ||
  fiqaManifest.sha256 !== fiqaExpectedSha256 ||
  Number(fiqaManifest.sizeBytes) !== fiqaExpectedBytes ||
  fiqaActualBytes !== fiqaExpectedBytes ||
  fiqaActualSha256 !== fiqaExpectedSha256
) {
  console.error("[build-backend] eDifFIQA(T) manifest, size, or checksum did not match the release pin.");
  process.exit(1);
}

const cohortDir = path.join(root, "models", "cohort");
const cohortManifestPath = path.join(cohortDir, "manifest.json");
const cohortReadmePath = path.join(cohortDir, "README.md");
const cohortManifestSha256 = "857d421d17a2112afacfa870bb05ee5c77a1d3dd482d4eb05ef848399210fb8d";
const cohortPacks = [
  {
    modelPack: "antelopev2",
    filename: "antelopev2.npy",
    sizeBytes: 123008,
    sha256: "97ea6ec7d69d3c18768db2b9939a34510bffa851802677d37d50ffa40f906082"
  },
  {
    modelPack: "buffalo_l",
    filename: "buffalo_l.npy",
    sizeBytes: 123008,
    sha256: "80820d68d3729a11ff39f202d35d2ad212d44bf0b2494e6a7a6728a6679166cf"
  }
];
if (!fs.existsSync(cohortManifestPath) || !fs.existsSync(cohortReadmePath)) {
  console.error("[build-backend] Verified fixed AS-Norm cohort is incomplete under models/cohort.");
  process.exit(1);
}
let cohortManifest;
try {
  cohortManifest = JSON.parse(fs.readFileSync(cohortManifestPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid fixed-cohort manifest: ${error.message}`);
  process.exit(1);
}
const cohortSource = cohortManifest && typeof cohortManifest.source === "object" ? cohortManifest.source : {};
const cohortManifestPacks = Array.isArray(cohortManifest?.packs) ? cohortManifest.packs : [];
const cohortMetadataValid =
  sha256File(cohortManifestPath) === cohortManifestSha256 &&
  cohortManifest.schemaVersion === 1 &&
  cohortManifest.cohortId === "syn-vis-v0-balanced-60" &&
  cohortManifest.cohortVersion === "2026-07-12.1" &&
  cohortSource.revision === "100262732989e77f38cd831d70a376a93735006a" &&
  cohortSource.imageLicense === "CC0-1.0" &&
  cohortSource.curationLicense === "CC-BY-SA-4.0";
const cohortVectorsValid = cohortPacks.every((expected) => {
  const manifestPack = cohortManifestPacks.find((item) => item && item.modelPack === expected.modelPack);
  const vectorPath = path.join(cohortDir, expected.filename);
  return Boolean(
    manifestPack &&
    manifestPack.filename === expected.filename &&
    Number(manifestPack.sizeBytes) === expected.sizeBytes &&
    manifestPack.sha256 === expected.sha256 &&
    Number(manifestPack.count) === 60 &&
    Number(manifestPack.dimension) === 512 &&
    manifestPack.dtype === "float32" &&
    fs.existsSync(vectorPath) &&
    fs.statSync(vectorPath).size === expected.sizeBytes &&
    sha256File(vectorPath) === expected.sha256
  );
});
if (!cohortMetadataValid || !cohortVectorsValid) {
  console.error("[build-backend] Fixed AS-Norm cohort manifest, provenance, size, or checksum did not match the release pin.");
  process.exit(1);
}

const syntheticScreenDir = path.join(root, "models", "synthetic-screen");
const syntheticScreenManifestPath = path.join(syntheticScreenDir, "manifest.json");
const syntheticScreenClassifierPath = path.join(syntheticScreenDir, "classifier.npz");
const syntheticScreenProvenancePath = path.join(syntheticScreenDir, "training-provenance.json");
const syntheticScreenReadmePath = path.join(syntheticScreenDir, "README.md");
const syntheticScreenLicensesPath = path.join(syntheticScreenDir, "LICENSES.md");
const semanticDir = path.join(root, "models", "semantic");
const semanticVisionPath = path.join(semanticDir, "vision_model_uint8.onnx");
const semanticTextPath = path.join(semanticDir, "text_model_uint8.onnx");
const semanticTokenizerPath = path.join(semanticDir, "tokenizer.json");
const syntheticScreenManifestSha256 = "8b1f2115e1f633b024d6ef84f818db5b9859abba4323474a29ed01c10eb183a0";
const syntheticScreenClassifierSha256 = "32c8bb112b662e4b46f8d89aa908a9d217699e1b65091cd74009a9e49812e189";
const syntheticScreenClassifierBytes = 9_149;
const syntheticScreenProvenanceSha256 = "bc9f618cb6b586d618c05c29423c567e4373e5b6bf85f8277bf358a6fcaa9cfa";
const syntheticScreenProvenanceBytes = 409_516;
const semanticVisionSha256 = "f2eb8ccfa3dc0b3761d9ea9a39554fe0f2be71b247ad7f68a80720ec88895650";
const semanticVisionBytes = 94_737_653;
const semanticTextSha256 = "8c6d2827118d6d0e50db7392588d73133c7d2147997da522a1b2d144df535aed";
const semanticTextBytes = 283_438_275;
const semanticTokenizerSha256 = "cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322";
const semanticTokenizerBytes = 34_363_039;
if (
  !fs.existsSync(syntheticScreenManifestPath) ||
  !fs.existsSync(syntheticScreenClassifierPath) ||
  !fs.existsSync(syntheticScreenProvenancePath) ||
  !fs.existsSync(syntheticScreenReadmePath) ||
  !fs.existsSync(syntheticScreenLicensesPath) ||
  !fs.existsSync(semanticVisionPath) ||
  !fs.existsSync(semanticTextPath) ||
  !fs.existsSync(semanticTokenizerPath)
) {
  console.error("[build-backend] Verified synthetic-enrollment or semantic-search pack is incomplete.");
  process.exit(1);
}
let syntheticScreenManifest;
let syntheticScreenProvenance;
try {
  syntheticScreenManifest = JSON.parse(fs.readFileSync(syntheticScreenManifestPath, "utf8"));
  syntheticScreenProvenance = JSON.parse(fs.readFileSync(syntheticScreenProvenancePath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid synthetic-enrollment screen manifest: ${error.message}`);
  process.exit(1);
}
const syntheticArtifact = syntheticScreenManifest && typeof syntheticScreenManifest.artifact === "object"
  ? syntheticScreenManifest.artifact
  : {};
const syntheticProvenanceSpec = syntheticScreenManifest && typeof syntheticScreenManifest.provenance === "object"
  ? syntheticScreenManifest.provenance
  : {};
const syntheticVision = syntheticScreenManifest && typeof syntheticScreenManifest.visionEncoder === "object"
  ? syntheticScreenManifest.visionEncoder
  : {};
const syntheticSources = Array.isArray(syntheticScreenManifest?.sources) ? syntheticScreenManifest.sources : [];
const synVisSource = syntheticSources.find((item) => item && item.id === "retowyss/Syn-Vis-v0") || {};
const sfhqSource = syntheticSources.find((item) => item && item.id === "selfishgene/sfhq-t2i-synthetic-faces-from-text-2-image-models") || {};
const provenanceSources = syntheticScreenProvenance && typeof syntheticScreenProvenance.sources === "object"
  ? syntheticScreenProvenance.sources
  : {};
const congressProvenance = Array.isArray(provenanceSources?.wikimediaCongressPublicDomain?.items)
  ? provenanceSources.wikimediaCongressPublicDomain.items
  : [];
const synVisProvenance = Array.isArray(provenanceSources?.synVisV0?.items)
  ? provenanceSources.synVisV0.items
  : [];
const sfhqProvenance = Array.isArray(provenanceSources?.sfhqT2i?.items)
  ? provenanceSources.sfhqT2i.items
  : [];
const provenancePrivacy = syntheticScreenProvenance && typeof syntheticScreenProvenance.privacy === "object"
  ? syntheticScreenProvenance.privacy
  : {};
const syntheticScreenValid =
  sha256File(syntheticScreenManifestPath) === syntheticScreenManifestSha256 &&
  syntheticScreenManifest.schemaVersion === 1 &&
  syntheticScreenManifest.modelId === "vintrace-siglip2-linear-synthetic-screen" &&
  syntheticScreenManifest.version === "2026-07-12.1" &&
  syntheticScreenManifest?.classifierLicense?.spdx === "CC-BY-SA-4.0" &&
  syntheticArtifact.filename === "classifier.npz" &&
  syntheticArtifact.format === "numpy-npz-no-pickle" &&
  Number(syntheticArtifact.dimension) === 768 &&
  Number(syntheticArtifact.sizeBytes) === syntheticScreenClassifierBytes &&
  syntheticArtifact.sha256 === syntheticScreenClassifierSha256 &&
  fs.statSync(syntheticScreenClassifierPath).size === syntheticScreenClassifierBytes &&
  sha256File(syntheticScreenClassifierPath) === syntheticScreenClassifierSha256 &&
  syntheticProvenanceSpec.filename === "training-provenance.json" &&
  Number(syntheticProvenanceSpec.schemaVersion) === 1 &&
  Number(syntheticProvenanceSpec.sizeBytes) === syntheticScreenProvenanceBytes &&
  syntheticProvenanceSpec.sha256 === syntheticScreenProvenanceSha256 &&
  fs.statSync(syntheticScreenProvenancePath).size === syntheticScreenProvenanceBytes &&
  sha256File(syntheticScreenProvenancePath) === syntheticScreenProvenanceSha256 &&
  syntheticScreenProvenance.schemaVersion === 1 &&
  syntheticScreenProvenance.modelId === "vintrace-siglip2-linear-synthetic-screen" &&
  syntheticScreenProvenance.version === "2026-07-12.1" &&
  syntheticScreenProvenance.trainingDataHash === syntheticScreenManifest?.training?.trainingDataHash &&
  congressProvenance.length === 262 &&
  congressProvenance.every((item) => item && ["Public domain", "CC0", "CC0-1.0"].includes(item.license) && /^[a-f0-9]{64}$/.test(item.cropSha256 || "")) &&
  synVisProvenance.length === 480 &&
  synVisProvenance.every((item) => item && item.imageLicense === "CC0-1.0" && /^[a-f0-9]{64}$/.test(item.sha256 || "")) &&
  sfhqProvenance.length === 120 &&
  sfhqProvenance.every((item) => item && item.license === "MIT" && /^[a-f0-9]{64}$/.test(item.sha256 || "")) &&
  provenancePrivacy.sourceImagesBundled === false &&
  provenancePrivacy.faceEmbeddingsBundled === false &&
  provenancePrivacy.userWorkspaceMediaUsed === false &&
  syntheticVision.filename === "vision_model_uint8.onnx" &&
  syntheticVision.license === "Apache-2.0" &&
  syntheticVision.sha256 === semanticVisionSha256 &&
  Number(syntheticVision.sizeBytes) === semanticVisionBytes &&
  fs.statSync(semanticVisionPath).size === semanticVisionBytes &&
  sha256File(semanticVisionPath) === semanticVisionSha256 &&
  fs.statSync(semanticTextPath).size === semanticTextBytes &&
  sha256File(semanticTextPath) === semanticTextSha256 &&
  fs.statSync(semanticTokenizerPath).size === semanticTokenizerBytes &&
  sha256File(semanticTokenizerPath) === semanticTokenizerSha256 &&
  synVisSource.revision === "100262732989e77f38cd831d70a376a93735006a" &&
  synVisSource.imageLicense === "CC0-1.0" &&
  synVisSource.curationLicense === "CC-BY-SA-4.0" &&
  Number(sfhqSource.version) === 1 &&
  sfhqSource.license === "MIT" &&
  syntheticScreenManifest?.excludedModel?.id === "Wolowolo/fsfm-3c";
if (!syntheticScreenValid) {
  console.error("[build-backend] Synthetic-enrollment or semantic-search provenance, license, size, or checksum did not match the release pin.");
  process.exit(1);
}

const photoOcrDir = path.join(root, "models", "ocr");
const photoOcrManifestPath = path.join(photoOcrDir, "manifest.json");
const photoOcrLicensePath = path.join(photoOcrDir, "LICENSE");
const photoOcrManifestSha256 = "d6edb509c8f5b302004bd68787fdc3e5e266a2b230915fec7455bd264d282d2f";
const photoOcrLicenseSha256 = "3e0af25fdd06aa9586ae97adb00ea927ebe5a3805ac77d2d3a81ce5f55693333";
const photoOcrArtifacts = [
  {
    role: "detector",
    filename: "PP-OCRv6_det_small.onnx",
    sizeBytes: 9_929_594,
    sha256: "090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f"
  },
  {
    role: "recognizer",
    filename: "PP-OCRv6_rec_small.onnx",
    sizeBytes: 21_234_383,
    sha256: "6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884"
  },
  {
    role: "orientation-classifier",
    filename: "ch_ppocr_mobile_v2.0_cls_mobile.onnx",
    sizeBytes: 585_532,
    sha256: "e47acedf663230f8863ff1ab0e64dd2d82b838fceb5957146dab185a89d6215c"
  }
];
if (!fs.existsSync(photoOcrManifestPath) || !fs.existsSync(photoOcrLicensePath)) {
  console.error("[build-backend] Verified PP-OCRv6 model pack is incomplete under models/ocr.");
  process.exit(1);
}
let photoOcrManifest;
try {
  photoOcrManifest = JSON.parse(fs.readFileSync(photoOcrManifestPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid PP-OCRv6 manifest: ${error.message}`);
  process.exit(1);
}
const photoOcrRuntime = photoOcrManifest && typeof photoOcrManifest.runtime === "object"
  ? photoOcrManifest.runtime
  : {};
const photoOcrManifestArtifacts = Array.isArray(photoOcrManifest?.artifacts)
  ? photoOcrManifest.artifacts
  : [];
const photoOcrValid =
  sha256File(photoOcrManifestPath) === photoOcrManifestSha256 &&
  sha256File(photoOcrLicensePath) === photoOcrLicenseSha256 &&
  photoOcrManifest.schemaVersion === 1 &&
  photoOcrManifest.modelId === "vintrace-ppocrv6-small-rapidocr" &&
  photoOcrManifest.version === "2026-07-12.1" &&
  photoOcrManifest.engine === "onnxruntime-cpu" &&
  photoOcrManifest.offline === true &&
  photoOcrManifest.license === "Apache-2.0" &&
  photoOcrManifest.licenseSha256 === photoOcrLicenseSha256 &&
  photoOcrRuntime.package === "rapidocr" &&
  photoOcrRuntime.version === "3.9.1" &&
  photoOcrArtifacts.every((expected) => {
    const row = photoOcrManifestArtifacts.find((item) => item && item.role === expected.role);
    const artifactPath = path.join(photoOcrDir, expected.filename);
    return Boolean(
      row &&
      row.filename === expected.filename &&
      Number(row.sizeBytes) === expected.sizeBytes &&
      row.sha256 === expected.sha256 &&
      fs.existsSync(artifactPath) &&
      fs.statSync(artifactPath).size === expected.sizeBytes &&
      sha256File(artifactPath) === expected.sha256
    );
  });
if (!photoOcrValid || photoOcrManifestArtifacts.length !== photoOcrArtifacts.length) {
  console.error("[build-backend] PP-OCRv6 provenance, license, size, or checksum did not match the release pin.");
  process.exit(1);
}

const photoVlmDir = path.join(root, "models", "vlm");
const photoVlmCatalogPath = path.join(photoVlmDir, "catalog.json");
const photoVlmApacheLicensePath = path.join(photoVlmDir, "LICENSE-APACHE-2.0.txt");
const photoVlmRuntimeLicensePath = path.join(photoVlmDir, "LICENSE-LLAMA-CPP-MIT.txt");
const photoVlmReadmePath = path.join(photoVlmDir, "README.md");
const photoVlmCatalogSha256 = "63a31351f11b68fdeb9f739061df5e1fc85fae6dd25914bb589eabe8af19cc75";
const photoVlmApacheLicenseSha256 = "983ff26ac0d4bcb9dcb9edb874824acd728671234d19624aad9d3002cfb6eacd";
const photoVlmRuntimeLicenseSha256 = "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d";
const photoVlmReadmeSha256 = "e32cc877b65ce2c1e3dc9120f631437b078ef1d11f0e6435b6e548c81289f722";
if (![photoVlmCatalogPath, photoVlmApacheLicensePath, photoVlmRuntimeLicensePath, photoVlmReadmePath].every((value) => fs.existsSync(value))) {
  console.error("[build-backend] Portable photo VLM catalog or license files are missing under models/vlm.");
  process.exit(1);
}
let photoVlmCatalog;
try {
  photoVlmCatalog = JSON.parse(fs.readFileSync(photoVlmCatalogPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid portable photo VLM catalog: ${error.message}`);
  process.exit(1);
}
const expectedPhotoVlmModels = {
  quality: {
    modelId: "Qwen/Qwen3-VL-4B-Instruct-GGUF",
    revision: "1cd86afb9a95c410a6038ab3b40d8b578c892266",
    artifacts: {
      "language-model": ["Qwen3VL-4B-Instruct-Q4_K_M.gguf", 2_497_281_664, "66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a"],
      "vision-projector": ["mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf", 453_974_304, "30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d"]
    }
  },
  "low-memory": {
    modelId: "ggml-org/SmolVLM2-2.2B-Instruct-GGUF",
    revision: "1bc3c9f74ceafd4c8d4411cc9cf188bba3798f91",
    artifacts: {
      "language-model": ["SmolVLM2-2.2B-Instruct-Q4_K_M.gguf", 1_112_602_656, "0cf76814555b8665149075b74ab6b5c1d428ea1d3d01c1918c12012e8d7c9f58"],
      "vision-projector": ["mmproj-SmolVLM2-2.2B-Instruct-Q8_0.gguf", 592_523_200, "ae07ea1facd07dd3230c4483b63e8cda96c6944ad2481f33d531f79e892dd024"]
    }
  }
};
const photoVlmRuntime = photoVlmCatalog?.runtime || {};
const photoVlmPlatforms = photoVlmRuntime?.platforms || {};
const photoVlmCatalogModels = photoVlmCatalog?.models || {};
const photoVlmModelsValid = Object.entries(expectedPhotoVlmModels).every(([tier, expected]) => {
  const model = photoVlmCatalogModels[tier];
  const artifacts = Array.isArray(model?.artifacts) ? model.artifacts : [];
  return Boolean(
    model &&
    model.tier === tier &&
    model.modelId === expected.modelId &&
    model.revision === expected.revision &&
    model.license === "Apache-2.0" &&
    artifacts.length === 2 &&
    Object.entries(expected.artifacts).every(([role, [filename, sizeBytes, sha256]]) => {
      const artifact = artifacts.find((item) => item?.role === role);
      return artifact?.filename === filename && Number(artifact?.sizeBytes) === sizeBytes && artifact?.sha256 === sha256 && /^https:\/\//.test(String(artifact?.url || ""));
    })
  );
});
const photoVlmValid =
  sha256File(photoVlmCatalogPath) === photoVlmCatalogSha256 &&
  sha256File(photoVlmApacheLicensePath) === photoVlmApacheLicenseSha256 &&
  sha256File(photoVlmRuntimeLicensePath) === photoVlmRuntimeLicenseSha256 &&
  sha256File(photoVlmReadmePath) === photoVlmReadmeSha256 &&
  photoVlmCatalog?.schemaVersion === 1 &&
  photoVlmCatalog?.catalogId === "vintrace-photo-vlm" &&
  photoVlmCatalog?.version === "2026-07-12.1" &&
  photoVlmCatalog?.offlineInference === true &&
  photoVlmCatalog?.promptVersion === "photo-caption-tags-v1" &&
  photoVlmRuntime?.id === "llama.cpp" &&
  photoVlmRuntime?.tag === "b9969" &&
  photoVlmRuntime?.revision === "76f2798059575a96a12e4d34342165a4b6a6a312" &&
  photoVlmRuntime?.license === "MIT" &&
  Object.keys(photoVlmPlatforms).sort().join(",") === "darwin-arm64,darwin-x86_64,win32-x86_64" &&
  Object.values(photoVlmPlatforms).every((item) => Number(item?.sizeBytes) > 0 && /^[a-f0-9]{64}$/.test(String(item?.sha256 || "")) && /^https:\/\//.test(String(item?.url || ""))) &&
  Object.keys(photoVlmCatalogModels).sort().join(",") === "low-memory,quality" &&
  photoVlmModelsValid;
if (!photoVlmValid) {
  console.error("[build-backend] Portable photo VLM catalog, licensing, runtime pin, or model hashes did not match the release contract.");
  process.exit(1);
}

const photoGenerativeDir = path.join(root, "models", "generative");
const photoGenerativeCatalogPath = path.join(photoGenerativeDir, "catalog.json");
const photoGenerativeReadmePath = path.join(photoGenerativeDir, "README.md");
const photoGenerativeLicensesPath = path.join(photoGenerativeDir, "LICENSES.md");
const photoGenerativeCatalogSha256 = "ec8cbb1bb77b749be39a545836f0394b70efd4053b557e6e4e56442f982d1406";
const photoGenerativeReadmeSha256 = "c244b0e2ee1a1f801c3f93c0cfcff500b517fb4d81fd591e1f5cfeee124e584c";
const photoGenerativeLicensesSha256 = "1275253afee71608d30e2b4dcbc8435edfd0adccf0153526ae857bad56e69ff5";
if (![photoGenerativeCatalogPath, photoGenerativeReadmePath, photoGenerativeLicensesPath].every((value) => fs.existsSync(value))) {
  console.error("[build-backend] Local generative photo catalog or license files are missing under models/generative.");
  process.exit(1);
}
let photoGenerativeCatalog;
try {
  photoGenerativeCatalog = JSON.parse(fs.readFileSync(photoGenerativeCatalogPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Invalid local generative photo catalog: ${error.message}`);
  process.exit(1);
}
const generativeLight = photoGenerativeCatalog?.light || {};
const generativeHeavy = photoGenerativeCatalog?.heavy || {};
const generativeHeavyRuntime = generativeHeavy?.runtime || {};
const generativeHeavyArtifacts = Array.isArray(generativeHeavy?.artifacts) ? generativeHeavy.artifacts : [];
const photoGenerativeValid =
  sha256File(photoGenerativeCatalogPath) === photoGenerativeCatalogSha256 &&
  sha256File(photoGenerativeReadmePath) === photoGenerativeReadmeSha256 &&
  sha256File(photoGenerativeLicensesPath) === photoGenerativeLicensesSha256 &&
  photoGenerativeCatalog?.schemaVersion === 1 &&
  photoGenerativeCatalog?.catalogId === "vintrace-photo-generative" &&
  photoGenerativeCatalog?.version === "2026-07-12.1" &&
  photoGenerativeCatalog?.offlineInference === true &&
  generativeLight?.cleanup?.id === "opencv/inpainting_lama" &&
  generativeLight?.cleanup?.revision === "aee6d22f0a13e5e35af1c9a1c3afd62841fc6f3f" &&
  generativeLight?.cleanup?.artifact?.sha256 === "7df918ac3921d3daf0aae1d219776cf0dc4e4935f035af81841b40adcf74fdf2" &&
  generativeLight?.upscale?.id === "xinntao/Real-ESRGAN" &&
  generativeLight?.upscale?.tag === "v0.2.5.0" &&
  Object.keys(generativeLight?.upscale?.platforms || {}).sort().join(",") === "darwin-arm64,darwin-x86_64,win32-x86_64" &&
  generativeHeavy?.id === "Qwen/Qwen-Image-Edit-2511" &&
  generativeHeavy?.revision === "6f3ccc0b56e431dc6a0c2b2039706d7d26f22cb9" &&
  Number(generativeHeavy?.minimumMemoryBytes) === 51_539_607_552 &&
  generativeHeavyRuntime?.id === "stable-diffusion.cpp" &&
  generativeHeavyRuntime?.tag === "master-775-b5d8120" &&
  generativeHeavyRuntime?.revision === "b5d812008eb7082a238fc589444544b3278187ae" &&
  Object.keys(generativeHeavyRuntime?.platforms || {}).sort().join(",") === "darwin-arm64,win32-x86_64" &&
  generativeHeavyArtifacts.length === 3 &&
  generativeHeavyArtifacts.reduce((total, item) => total + Number(item?.sizeBytes || 0), 0) === 22_883_235_550 &&
  generativeHeavyArtifacts.every((item) => /^https:\/\//.test(String(item?.url || "")) && /^[a-f0-9]{64}$/.test(String(item?.sha256 || "")));
if (!photoGenerativeValid) {
  console.error("[build-backend] Local generative photo catalog, licenses, runtime pins, or model hashes did not match the release contract.");
  process.exit(1);
}

const modelLifecycleDir = path.join(root, "models", "lifecycle");
const audioModelDir = path.join(root, "models", "audio");
const audioModelArtifacts = [
  ["manifest.json", 3197, "7f32829e2030f17aa1a0261c82d29dcb9ed1c935d499c3b363545d814cc6b88e"],
  ["ggml-tiny-q5_1.bin", 32152673, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"],
  ["yamnet-core.onnx", 14937376, "abbf32f935788eebd30c2a8152028cd352c5af1e45839693d7f6814cbcf7fd2c"],
  ["yamnet-mel-weights.npy", 65920, "53ad4939af58db21446b2aefa3bae4c902317b6c0cdeacdd6a6fc2a569508efd"],
  ["yamnet-class-map.csv", 14096, "cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2"],
  ["YAMNET-LICENSE", 11512, "5b17814bf0de8cf65069bc6d7cc38cff19fcaa864d243423ad3ef3db01b52385"],
  ["WHISPERCPP-LICENSE", 1078, "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d"],
  ["WHISPER-MODEL-LICENSE", 1063, "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d"],
  ["PYWHISPERCPP-LICENSE", 1073, "ecb64e35ec850415748fcf5d688cdab6480e58bd0cd4bfa369fa505ab3d497e8"],
];
const audioModelValid = audioModelArtifacts.every(([filename, bytes, digest]) => {
  const file = path.join(audioModelDir, filename);
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  return stat?.isFile() && stat.size === bytes && sha256File(file) === digest;
});
if (!audioModelValid) {
  console.error("[build-backend] Audio intelligence model pack, conversion data, or licenses drifted.");
  process.exit(1);
}
const audioRuntimeLookup = spawnSync(
  python,
  ["-c", "import json; from crossage_fr.audio_intelligence import audio_model_report; print(json.dumps(audio_model_report()))"],
  { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONPATH: root } }
);
if (audioRuntimeLookup.error || (audioRuntimeLookup.status ?? 1) !== 0) {
  const details = String(audioRuntimeLookup.error?.message || audioRuntimeLookup.stderr || audioRuntimeLookup.stdout || "").trim();
  console.error(`[build-backend] Audio intelligence runtime validation failed${details ? `: ${details}` : ""}`);
  process.exit(audioRuntimeLookup.status ?? 1);
}
let audioRuntime;
try {
  audioRuntime = JSON.parse(String(audioRuntimeLookup.stdout || "").trim());
} catch (error) {
  console.error(`[build-backend] Audio intelligence runtime returned invalid metadata: ${error.message}`);
  process.exit(1);
}
if (
  audioRuntime.available !== true ||
  audioRuntime.packVersion !== "2026-07-13.1" ||
  audioRuntime.indexVersion !== "vintrace-audio-v1" ||
  audioRuntime.asr?.runtimeVersion !== "1.5.0" ||
  audioRuntime.asr?.nativeModulePresent !== true ||
  audioRuntime.soundEvents?.classCount !== 521
) {
  console.error(`[build-backend] Audio intelligence runtime pin failed: ${JSON.stringify(audioRuntime)}.`);
  process.exit(1);
}
const localSyncBenchmarkPath = path.join(root, "benchmarks", "results", "local-sync-benchmark-20260713.json");
const localSyncBenchmarkSha256 = "ccf92c90503b8908a029d8aadb18c8e9df1266f27ed17976b7b7bb3cdfa55e4b";
let localSyncBenchmark;
try {
  localSyncBenchmark = JSON.parse(fs.readFileSync(localSyncBenchmarkPath, "utf8"));
} catch (error) {
  console.error(`[build-backend] Local sync benchmark evidence is unreadable: ${error.message}`);
  process.exit(1);
}
if (
  sha256File(localSyncBenchmarkPath) !== localSyncBenchmarkSha256 ||
  localSyncBenchmark.benchmarkId !== "vintrace-encrypted-local-sync-v1" ||
  localSyncBenchmark.protocol !== "vintrace-local-sync-v1" ||
  localSyncBenchmark.dataset?.operations !== 10000 ||
  localSyncBenchmark.transfer?.insertedOperations !== 10000 ||
  localSyncBenchmark.passed !== true ||
  Object.values(localSyncBenchmark.checks || {}).some((value) => value !== true)
) {
  console.error("[build-backend] Local sync benchmark evidence failed its pinned release gate.");
  process.exit(1);
}
const modelLifecyclePolicyPath = path.join(modelLifecycleDir, "policy.json");
const modelLifecyclePolicySha256 = "1b5a466c5f39d1a7deecbbbe83e5a961e91473444385fd31f7ddf485d9ccb8e6";
const modelLifecycleEvidence = [
  [path.join(root, "accuracy_validation_history.json"), "c2a1f92d21485ce301e2ab11f4d69fd95602f29d6c676dffb3dd6a51d817b9f0", "."],
  [path.join(root, "benchmarks", "results", "photo-culling-benchmark-20260713.json"), "fa8ed5ef5ea3e9fa4d0b4b0918b330db5efcc592bb6ed23c8a778f7597f8a4dc", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "ppocrv6-benchmark-20260712.json"), "52e8eabba6a8b7a332ffa2f48a9f8d371c78b0ddf297a7b7099bfa2cc5e32bbe", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "photo-vlm-benchmark-20260712.json"), "42fbc8aa1d3d5465a3ff6933d1da072bcff36ac4cc42e470aac581cb8519dfbb", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "video-semantic-benchmark-20260713.json"), "cbba00e7ab6838e2b8d96281dbcd8ae3dbd86895eb0f7926cd9cc46cea29155f", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "photo-generative-benchmark-20260712.json"), "466a4df96a3f966266b85f7aa98334cd665c76163ebf288566032f2bcbd5ed1d", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "multimodal-safety-benchmark-20260713.json"), "9605fd52861bdc8c8bf6da6aa17f4cef47ea1f8acdd3170f383780de66cc8993", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "synthetic-enrollment-screen-benchmark-20260712.json"), "5f991892987882650e41d0015efb1063a38a459dae880c2f571ddc2426ec18d3", path.join("benchmarks", "results")],
  [path.join(root, "benchmarks", "results", "audio-intelligence-benchmark-20260713.json"), "e25444068e5b7c4d064c161e715430e9e5855cf8d7204f2bd71c84a8df686575", path.join("benchmarks", "results")],
];
const modelLifecycleFixturePaths = [
  [path.join(root, "validation-packs", "vintrace-accuracy-validation-pack-v1"), path.join("validation-packs", "vintrace-accuracy-validation-pack-v1")],
  [path.join(root, "tests", "fixtures", "ocr", "paddleocr-general-ocr-002.jpg"), path.join("tests", "fixtures", "ocr")],
  [path.join(root, "tests", "fixtures", "audio", "manifest.json"), path.join("tests", "fixtures", "audio")],
];
const modelLifecycleDatasets = [
  [path.join(root, "validation-packs", "vintrace-accuracy-validation-pack-v1", "manifest.json"), "6eb9f9160d30556c9f1edf903689517e5030f0cd46b7eb32c107d7a1fa026553", "validation-pack-manifest.json"],
  [path.join(root, "validation-packs", "vintrace-accuracy-validation-pack-v1", "labels.json"), "365eb1d6ae5a29529724b08b96916ec5c5bb31b9172dd3424972ecfd38150b5b", "validation-pack-labels.json"],
  [path.join(root, "tests", "fixtures", "ocr", "paddleocr-general-ocr-002.jpg"), "4425af33dd163cf73bdff502bd35ee527e9bdd5725501db1da78bfdae9f538f4", "paddleocr-general-ocr-002.jpg"],
  [path.join(root, "tests", "fixtures", "audio", "manifest.json"), "be99d05d73eeba7d5edca5ebb2f87361efae81a8c7e32cfede477c7e5ec71eac", "audio-acceptance-manifest.json"],
];
const modelLifecycleValid =
  fs.existsSync(modelLifecyclePolicyPath) &&
  sha256File(modelLifecyclePolicyPath) === modelLifecyclePolicySha256 &&
  modelLifecycleEvidence.every(([file, digest]) => fs.existsSync(file) && sha256File(file) === digest) &&
  modelLifecycleDatasets.every(([file, digest]) => fs.existsSync(file) && sha256File(file) === digest) &&
  modelLifecycleFixturePaths.every(([file]) => fs.existsSync(file));
if (!modelLifecycleValid) {
  console.error("[build-backend] Model lifecycle policy, accepted evaluation evidence, or versioned fixtures drifted.");
  process.exit(1);
}

fs.rmSync(outputDir, { recursive: true, force: true });
// PyInstaller's --clean clears its global cache but can still reuse TOCs and
// archives under an explicit workpath. Remove that workpath so every sidecar
// is built from the exact current source tree.
fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const args = [
  "-m",
  "PyInstaller",
  "--clean",
  "--noconfirm",
  "--onedir",
  "--additional-hooks-dir",
  hookDir,
  "--collect-submodules",
  "mcp",
  "--collect-all",
  "onnxruntime",
  "--copy-metadata",
  "onnxruntime",
  "--collect-all",
  "sqlcipher3",
  "--collect-all",
  "pywhispercpp",
  "--copy-metadata",
  "pywhispercpp",
  "--collect-all",
  "zeroconf",
  "--copy-metadata",
  "zeroconf",
  "--collect-all",
  "ifaddr",
  "--copy-metadata",
  "ifaddr",
  "--collect-data",
  "insightface",
  "--collect-data",
  "faiss",
  "--collect-submodules",
  "rapidocr.inference_engine.onnxruntime",
  "--copy-metadata",
  "rapidocr",
  "--copy-metadata",
  "c2pa-python",
  "--collect-binaries",
  "c2pa",
  ...(applePhotosEnabled
    ? applePhotosCollectionPackages.flatMap((packageName) => ["--collect-all", packageName])
    : []),
  "--add-data",
  `${meanShapePath}${path.delimiter}objects`,
  "--add-data",
  `${openCvHaarDir}${path.delimiter}${path.join("cv2", "data")}`,
  "--add-data",
  `${fiqaDir}${path.delimiter}${path.join("models", "fiq")}`,
  "--add-data",
  `${cohortDir}${path.delimiter}${path.join("models", "cohort")}`,
  "--add-data",
  `${syntheticScreenDir}${path.delimiter}${path.join("models", "synthetic-screen")}`,
  "--add-data",
  `${semanticDir}${path.delimiter}${path.join("models", "semantic")}`,
  "--add-data",
  `${photoOcrDir}${path.delimiter}${path.join("models", "ocr")}`,
  "--add-data",
  `${photoVlmDir}${path.delimiter}${path.join("models", "vlm")}`,
  "--add-data",
  `${photoGenerativeDir}${path.delimiter}${path.join("models", "generative")}`,
  "--add-data",
  `${modelLifecycleDir}${path.delimiter}${path.join("models", "lifecycle")}`,
  "--add-data",
  `${audioModelDir}${path.delimiter}${path.join("models", "audio")}`,
  ...modelLifecycleEvidence.flatMap(([file, , destination]) => ["--add-data", `${file}${path.delimiter}${destination}`]),
  "--add-data",
  `${localSyncBenchmarkPath}${path.delimiter}${path.join("benchmarks", "results")}`,
  ...modelLifecycleFixturePaths.flatMap(([file, destination]) => ["--add-data", `${file}${path.delimiter}${destination}`]),
  "--add-data",
  `${c2paLicenseDir}${path.delimiter}licenses`,
  "--add-data",
  `${rapidOcrConfigPath}${path.delimiter}rapidocr`,
  "--add-data",
  `${rapidOcrModelsConfigPath}${path.delimiter}rapidocr`,
  "--add-data",
  `${mobileDistDir}${path.delimiter}mobile-dist`,
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
  "_pywhispercpp",
  "--hidden-import",
  "pywhispercpp.model",
  "--hidden-import",
  "rapidocr",
  "--hidden-import",
  "certifi",
  "--hidden-import",
  "cv2",
  "--hidden-import",
  "imageio_ffmpeg",
  "--hidden-import",
  "c2pa",
  "--collect-data",
  "imageio_ffmpeg",
  "--collect-binaries",
  "imageio_ffmpeg",
  "--name",
  "crossage-backend",
  "--distpath",
  outputDir,
  "--workpath",
  workDir,
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
    sha256: digest,
    python: buildPython,
    dependencies: {
      onnxruntime: onnxRuntime,
      audioIntelligence: {
        packVersion: "2026-07-13.1",
        indexVersion: "vintrace-audio-v1",
        runtimeVersion: audioRuntime.asr.runtimeVersion,
        artifacts: Object.fromEntries(audioModelArtifacts.map(([filename, , artifactSha256]) => [filename, artifactSha256]))
      },
      localSync: {
        protocol: "vintrace-local-sync-v1",
        serviceType: localSyncRuntime.serviceType,
        zeroconfVersion: localSyncRuntime.zeroconfVersion,
        ifaddrVersion: localSyncRuntime.ifaddrVersion,
        internetService: false,
        licenses: localSyncLicenseDigests,
        evidence: { "local-sync-benchmark-20260713.json": localSyncBenchmarkSha256 }
      },
      modelLifecycle: {
        policyVersion: "2026-07-13.3",
        policySha256: modelLifecyclePolicySha256,
        evidence: Object.fromEntries(modelLifecycleEvidence.map(([file, evidenceSha256]) => [path.basename(file), evidenceSha256])),
        datasets: Object.fromEntries(modelLifecycleDatasets.map(([, datasetSha256, name]) => [name, datasetSha256]))
      }
    }
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

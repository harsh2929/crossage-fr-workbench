#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const { releaseArtifactFiles } = require("./create-release-artifacts.cjs");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CYCLONEDX_NAME,
  LEGACY_RELEASE_METADATA_NAMES,
  SPDX_NAME,
  expectedSupplyChainBundles,
  readChecksumFile,
  validateBuildMetadata,
  validateSbomFiles,
  validateSigstoreBundleFile,
  verifyChecksummedFiles,
} = require("./release-supply-chain.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const build = pkg.build || {};
const dist = path.join(repoRoot, "dist");
const backendDist = path.join(repoRoot, "backend-dist");
const platform = process.env.VINTRACE_PACKAGE_PLATFORM || process.platform;
const required = process.env.VINTRACE_PACKAGE_REQUIRED === "1";
const checks = [];
const MODEL_LIFECYCLE_POLICY_VERSION = "2026-07-13.3";
const MODEL_LIFECYCLE_POLICY_SHA256 = "1b5a466c5f39d1a7deecbbbe83e5a961e91473444385fd31f7ddf485d9ccb8e6";
const MODEL_LIFECYCLE_ARTIFACTS = [
  { key: "policy.json", kind: "policy", path: "models/lifecycle/policy.json", sha256: MODEL_LIFECYCLE_POLICY_SHA256 },
  { key: "accuracy_validation_history.json", kind: "evidence", path: "accuracy_validation_history.json", sha256: "c2a1f92d21485ce301e2ab11f4d69fd95602f29d6c676dffb3dd6a51d817b9f0" },
  { key: "photo-culling-benchmark-20260713.json", kind: "evidence", path: "benchmarks/results/photo-culling-benchmark-20260713.json", sha256: "fa8ed5ef5ea3e9fa4d0b4b0918b330db5efcc592bb6ed23c8a778f7597f8a4dc" },
  { key: "ppocrv6-benchmark-20260712.json", kind: "evidence", path: "benchmarks/results/ppocrv6-benchmark-20260712.json", sha256: "52e8eabba6a8b7a332ffa2f48a9f8d371c78b0ddf297a7b7099bfa2cc5e32bbe" },
  { key: "photo-vlm-benchmark-20260712.json", kind: "evidence", path: "benchmarks/results/photo-vlm-benchmark-20260712.json", sha256: "42fbc8aa1d3d5465a3ff6933d1da072bcff36ac4cc42e470aac581cb8519dfbb" },
  { key: "video-semantic-benchmark-20260713.json", kind: "evidence", path: "benchmarks/results/video-semantic-benchmark-20260713.json", sha256: "cbba00e7ab6838e2b8d96281dbcd8ae3dbd86895eb0f7926cd9cc46cea29155f" },
  { key: "photo-generative-benchmark-20260712.json", kind: "evidence", path: "benchmarks/results/photo-generative-benchmark-20260712.json", sha256: "466a4df96a3f966266b85f7aa98334cd665c76163ebf288566032f2bcbd5ed1d" },
  { key: "multimodal-safety-benchmark-20260713.json", kind: "evidence", path: "benchmarks/results/multimodal-safety-benchmark-20260713.json", sha256: "9605fd52861bdc8c8bf6da6aa17f4cef47ea1f8acdd3170f383780de66cc8993" },
  { key: "synthetic-enrollment-screen-benchmark-20260712.json", kind: "evidence", path: "benchmarks/results/synthetic-enrollment-screen-benchmark-20260712.json", sha256: "5f991892987882650e41d0015efb1063a38a459dae880c2f571ddc2426ec18d3" },
  { key: "audio-intelligence-benchmark-20260713.json", kind: "evidence", path: "benchmarks/results/audio-intelligence-benchmark-20260713.json", sha256: "e25444068e5b7c4d064c161e715430e9e5855cf8d7204f2bd71c84a8df686575" },
  { key: "validation-pack-manifest.json", kind: "dataset", path: "validation-packs/vintrace-accuracy-validation-pack-v1/manifest.json", sha256: "6eb9f9160d30556c9f1edf903689517e5030f0cd46b7eb32c107d7a1fa026553" },
  { key: "validation-pack-labels.json", kind: "dataset", path: "validation-packs/vintrace-accuracy-validation-pack-v1/labels.json", sha256: "365eb1d6ae5a29529724b08b96916ec5c5bb31b9172dd3424972ecfd38150b5b" },
  { key: "paddleocr-general-ocr-002.jpg", kind: "dataset", path: "tests/fixtures/ocr/paddleocr-general-ocr-002.jpg", sha256: "4425af33dd163cf73bdff502bd35ee527e9bdd5725501db1da78bfdae9f538f4" },
  { key: "audio-acceptance-manifest.json", kind: "dataset", path: "tests/fixtures/audio/manifest.json", sha256: "be99d05d73eeba7d5edca5ebb2f87361efae81a8c7e32cfede477c7e5ec71eac" },
];
const AUDIO_INTELLIGENCE_PACK_VERSION = "2026-07-13.1";
const AUDIO_INTELLIGENCE_INDEX_VERSION = "vintrace-audio-v1";
const LOCAL_SYNC_PROTOCOL = "vintrace-local-sync-v1";
const LOCAL_SYNC_SERVICE_TYPE = "_vintrace-sync._tcp.local.";
const LOCAL_SYNC_LICENSES = {
  zeroconf: "4d1d974999ae8655ee47afb47ac3b327cd1baeea3509aecb35341ba1a1a53c94",
  ifaddr: "8700856576ae2bc80c63bc970250510d9213fb02fed006d5f22742c9ddde24d7",
};
const LOCAL_SYNC_EVIDENCE = {
  key: "local-sync-benchmark-20260713.json",
  path: "benchmarks/results/local-sync-benchmark-20260713.json",
  sha256: "ccf92c90503b8908a029d8aadb18c8e9df1266f27ed17976b7b7bb3cdfa55e4b",
};
const AUDIO_INTELLIGENCE_ARTIFACTS = [
  { key: "manifest.json", path: "models/audio/manifest.json", sha256: "7f32829e2030f17aa1a0261c82d29dcb9ed1c935d499c3b363545d814cc6b88e" },
  { key: "ggml-tiny-q5_1.bin", path: "models/audio/ggml-tiny-q5_1.bin", sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7" },
  { key: "yamnet-core.onnx", path: "models/audio/yamnet-core.onnx", sha256: "abbf32f935788eebd30c2a8152028cd352c5af1e45839693d7f6814cbcf7fd2c" },
  { key: "yamnet-mel-weights.npy", path: "models/audio/yamnet-mel-weights.npy", sha256: "53ad4939af58db21446b2aefa3bae4c902317b6c0cdeacdd6a6fc2a569508efd" },
  { key: "yamnet-class-map.csv", path: "models/audio/yamnet-class-map.csv", sha256: "cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2" },
  { key: "YAMNET-LICENSE", path: "models/audio/YAMNET-LICENSE", sha256: "5b17814bf0de8cf65069bc6d7cc38cff19fcaa864d243423ad3ef3db01b52385" },
  { key: "WHISPERCPP-LICENSE", path: "models/audio/WHISPERCPP-LICENSE", sha256: "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d" },
  { key: "WHISPER-MODEL-LICENSE", path: "models/audio/WHISPER-MODEL-LICENSE", sha256: "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d" },
  { key: "PYWHISPERCPP-LICENSE", path: "models/audio/PYWHISPERCPP-LICENSE", sha256: "ecb64e35ec850415748fcf5d688cdab6480e58bd0cd4bfa369fa505ab3d497e8" },
];

function add(name, ok, detail, data = {}) {
  checks.push({ name, ok: Boolean(ok), detail, ...data });
}

function listFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

function listRecursiveFiles(root, prefix = "") {
  if (!fs.existsSync(root)) return [];
  const rows = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      rows.push(...listRecursiveFiles(root, relative));
    } else if (entry.isFile()) {
      rows.push(relative);
    }
  }
  return rows.sort();
}

const distFiles = listFiles(dist);
const backendFiles = listRecursiveFiles(backendDist);
const exeFiles = distFiles.filter((file) => /\.exe$/i.test(file));
const dmgFiles = distFiles.filter((file) => /\.dmg$/i.test(file));
const zipFiles = distFiles.filter((file) => /\.zip$/i.test(file));
const appImageFiles = distFiles.filter((file) => /\.AppImage$/i.test(file));
const debFiles = distFiles.filter((file) => /\.deb$/i.test(file));
const rpmFiles = distFiles.filter((file) => /\.rpm$/i.test(file));
const mcpbFiles = distFiles.filter((file) => /\.mcpb$/i.test(file));
const blockmaps = distFiles.filter((file) => /\.blockmap$/i.test(file));
const metadata = distFiles.filter((file) => /^(latest|beta|internal).*\.ya?ml$/i.test(file));
const checksumFile = path.join(dist, CHECKSUM_NAME);
const cycloneDxFile = path.join(dist, CYCLONEDX_NAME);
const spdxFile = path.join(dist, SPDX_NAME);
const buildMetadataFile = path.join(dist, BUILD_METADATA_NAME);
const backendExecutablePath = backendFiles.find((file) => /(^|\/)crossage-backend(\.exe)?$/i.test(file)) || "";
const backendExecutable = Boolean(backendExecutablePath);
const backendSqlcipherRuntime = backendFiles.find((file) => /(^|\/)sqlcipher3\/_sqlite3[^/]*\.(so|pyd)$/i.test(file)) || "";
const backendSqlcipherLicense = backendFiles.find((file) => /(^|\/)sqlcipher3-0\.6\.2\.dist-info\/licenses\/LICENSE$/i.test(file)) || "";
const backendOnnxRuntimeBinding = backendFiles.find((file) => /(^|\/)onnxruntime\/capi\/onnxruntime_pybind11_state[^/]*\.(so|pyd)$/i.test(file)) || "";
const backendOnnxRuntimeLibrary = backendFiles.find((file) => /(^|\/)onnxruntime\/capi\/(libonnxruntime(?:\.so(?:\.1\.27\.0)?|\.1\.27\.0\.dylib)|onnxruntime\.dll)$/i.test(file)) || "";
const backendOnnxRuntimeMetadata = backendFiles.find((file) => /(^|\/)onnxruntime-1\.27\.0\.dist-info\/METADATA$/i.test(file)) || "";
const backendOnnxRuntimeLicense = backendFiles.find((file) => /(^|\/)onnxruntime\/LICENSE$/i.test(file)) || "";
const backendWhisperBinding = backendFiles.find((file) => /(^|\/)_pywhispercpp[^/]*\.(so|pyd)$/i.test(file)) || "";
const backendWhisperLibrary = backendFiles.find((file) => /(^|\/)(?:lib)?whisper[^/]*\.(dylib|so|dll)$/i.test(file)) || "";
const backendWhisperMetadata = backendFiles.find((file) => /(^|\/)pywhispercpp-1\.5\.0\.dist-info\/METADATA$/i.test(file)) || "";
const backendZeroconfRuntime = backendFiles.find((file) => /(^|\/)zeroconf\/(?:_dns|_listener|_services\/info)[^/]*\.(so|pyd)$/i.test(file)) || "";
const backendZeroconfMetadata = backendFiles.find((file) => /(^|\/)zeroconf-0\.149\.17\.dist-info\/METADATA$/i.test(file)) || "";
const backendZeroconfLicense = backendFiles.find((file) => /(^|\/)zeroconf-0\.149\.17\.dist-info\/licenses\/COPYING$/i.test(file)) || "";
const backendIfaddrMetadata = backendFiles.find((file) => /(^|\/)ifaddr-0\.2\.0\.dist-info\/METADATA$/i.test(file)) || "";
const backendIfaddrLicense = backendFiles.find((file) => /(^|\/)ifaddr-0\.2\.0\.dist-info\/LICENSE\.txt$/i.test(file)) || "";
const backendC2paRuntime = backendFiles.find((file) => /(^|\/)c2pa\/libs\/(libc2pa_c\.(dylib|so)|c2pa_c\.dll)$/i.test(file)) || "";
const backendC2paApacheLicense = backendFiles.find((file) => /(^|\/)licenses\/C2PA-LICENSE-APACHE\.txt$/i.test(file)) || "";
const backendC2paMitLicense = backendFiles.find((file) => /(^|\/)licenses\/C2PA-LICENSE-MIT\.txt$/i.test(file)) || "";
const backendMobileIndex = backendFiles.find((file) => /(^|\/)mobile-dist\/index\.html$/i.test(file)) || "";
const backendMobileManifest = backendFiles.find((file) => /(^|\/)mobile-dist\/manifest\.webmanifest$/i.test(file)) || "";
const backendMobileScript = backendFiles.find((file) => /(^|\/)mobile-dist\/assets\/mobile-[A-Za-z0-9_-]+\.js$/i.test(file)) || "";
const backendMobileStyles = backendFiles.find((file) => /(^|\/)mobile-dist\/assets\/mobile-[A-Za-z0-9_-]+\.css$/i.test(file)) || "";
const backendChecksumFile = path.join(backendDist, "crossage-backend.sha256");
const backendManifestFile = path.join(backendDist, "crossage-backend-manifest.json");
const hasAnyInstaller = exeFiles.length > 0
  || dmgFiles.length > 0
  || zipFiles.length > 0
  || appImageFiles.length > 0
  || debFiles.length > 0
  || rpmFiles.length > 0;

function parseJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
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

function lifecycleArtifactStatus(artifacts) {
  const failures = [];
  for (const artifact of artifacts) {
    const suffix = artifact.path.replace(/\\/g, "/");
    const matches = backendFiles.filter((file) => file === suffix || file.endsWith(`/${suffix}`));
    if (matches.length !== 1) {
      failures.push(`${artifact.key}: expected one packaged file, found ${matches.length}`);
      continue;
    }
    const actual = sha256File(path.join(backendDist, matches[0]));
    if (actual !== artifact.sha256) {
      failures.push(`${artifact.key}: sha256 mismatch`);
    }
  }
  return {
    ok: failures.length === 0,
    detail: failures.length === 0 ? `${artifacts.length}/${artifacts.length} pinned file(s) verified` : failures.join("; "),
  };
}

function hasExactDigestMap(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => value[key] === expected[key]);
}

function backendChecksumStatus() {
  if (!backendExecutablePath) {
    return { ok: false, detail: "backend executable missing" };
  }
  if (!fs.existsSync(backendChecksumFile)) {
    return { ok: false, detail: "backend-dist/crossage-backend.sha256 missing" };
  }
  if (!fs.existsSync(backendManifestFile)) {
    return { ok: false, detail: "backend-dist/crossage-backend-manifest.json missing" };
  }
  const manifest = parseJsonFile(backendManifestFile);
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, detail: "backend manifest is not valid JSON" };
  }
  const onnxRuntime = manifest.dependencies?.onnxruntime;
  if (
    onnxRuntime?.ok !== true ||
    onnxRuntime?.packageVersion !== "1.27.0" ||
    onnxRuntime?.runtimeVersion !== "1.27.0" ||
    onnxRuntime?.nativeModulePresent !== true ||
    !Array.isArray(onnxRuntime?.providers) ||
    !onnxRuntime.providers.includes("CPUExecutionProvider") ||
    JSON.stringify(onnxRuntime?.inferenceOutput) !== JSON.stringify([0.25, -1.5])
  ) {
    return { ok: false, detail: "backend manifest is missing the verified ONNX Runtime 1.27.0 probe" };
  }
  const modelLifecycle = manifest.dependencies?.modelLifecycle;
  const expectedLifecycleEvidence = Object.fromEntries(
    MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.kind === "evidence").map((artifact) => [artifact.key, artifact.sha256]),
  );
  const expectedLifecycleDatasets = Object.fromEntries(
    MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.kind === "dataset").map((artifact) => [artifact.key, artifact.sha256]),
  );
  if (
    modelLifecycle?.policyVersion !== MODEL_LIFECYCLE_POLICY_VERSION ||
    modelLifecycle?.policySha256 !== MODEL_LIFECYCLE_POLICY_SHA256 ||
    !hasExactDigestMap(modelLifecycle?.evidence, expectedLifecycleEvidence) ||
    !hasExactDigestMap(modelLifecycle?.datasets, expectedLifecycleDatasets)
  ) {
    return { ok: false, detail: "backend manifest is missing the pinned model lifecycle policy, evidence, or datasets" };
  }
  const audioIntelligence = manifest.dependencies?.audioIntelligence;
  const expectedAudioArtifacts = Object.fromEntries(
    AUDIO_INTELLIGENCE_ARTIFACTS.map((artifact) => [artifact.key, artifact.sha256]),
  );
  if (
    audioIntelligence?.packVersion !== AUDIO_INTELLIGENCE_PACK_VERSION ||
    audioIntelligence?.indexVersion !== AUDIO_INTELLIGENCE_INDEX_VERSION ||
    audioIntelligence?.runtimeVersion !== "1.5.0" ||
    !hasExactDigestMap(audioIntelligence?.artifacts, expectedAudioArtifacts)
  ) {
    return { ok: false, detail: "backend manifest is missing the pinned audio runtime or model artifacts" };
  }
  const localSync = manifest.dependencies?.localSync;
  if (
    localSync?.protocol !== LOCAL_SYNC_PROTOCOL ||
    localSync?.serviceType !== LOCAL_SYNC_SERVICE_TYPE ||
    localSync?.zeroconfVersion !== "0.149.17" ||
    localSync?.ifaddrVersion !== "0.2.0" ||
    localSync?.internetService !== false ||
    !hasExactDigestMap(localSync?.licenses, LOCAL_SYNC_LICENSES) ||
    !hasExactDigestMap(localSync?.evidence, { [LOCAL_SYNC_EVIDENCE.key]: LOCAL_SYNC_EVIDENCE.sha256 })
  ) {
    return { ok: false, detail: "backend manifest is missing the pinned encrypted local-sync runtime" };
  }
  const executable = String(manifest.executable || "").replace(/\\/g, "/");
  if (executable !== backendExecutablePath) {
    return { ok: false, detail: `backend manifest executable mismatch: ${executable || "missing"} != ${backendExecutablePath}` };
  }
  const actual = sha256File(path.join(backendDist, backendExecutablePath));
  const checksumText = fs.readFileSync(backendChecksumFile, "utf8");
  const checksumMatch = checksumText.match(/^([a-f0-9]{64})\s+\*?(.+?)\s*$/i);
  if (!checksumMatch) {
    return { ok: false, detail: "backend checksum line is malformed" };
  }
  const lineDigest = checksumMatch[1].toLowerCase();
  const linePath = checksumMatch[2].replace(/\\/g, "/");
  const manifestDigest = String(manifest.sha256 || "").toLowerCase();
  const manifestBytes = Number(manifest.bytes || 0);
  const stat = fs.statSync(path.join(backendDist, backendExecutablePath));
  const ok = lineDigest === actual
    && manifestDigest === actual
    && linePath === backendExecutablePath
    && manifestBytes === stat.size;
  return { ok, detail: ok ? `${backendExecutablePath}: ${actual}` : "backend checksum or manifest does not match executable" };
}

add("product name", build.productName === "Vintrace", build.productName || "missing");
add("app id", /^com\.vintrace\./.test(String(build.appId || "")), build.appId || "missing");
add("desktop entry", fs.existsSync(path.join(repoRoot, "desktop", "main.cjs")), "desktop/main.cjs");
add("preload entry", fs.existsSync(path.join(repoRoot, "desktop", "preload.cjs")), "desktop/preload.cjs");
add("icon png", fs.existsSync(path.join(repoRoot, "desktop", "assets", "icon.png")), "desktop/assets/icon.png");
add("backend resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "backend"), "extraResources backend");
add("production lock resource configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "requirements-production.lock.txt"), "extraResources requirements-production.lock.txt");
add("model resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/insightface"), "extraResources models/insightface");
add("cohort resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/cohort"), "extraResources models/cohort");
add("generative catalog resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/generative"), "extraResources models/generative");
add("model lifecycle resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/lifecycle"), "extraResources models/lifecycle");
add("audio intelligence resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "models/audio"), "extraResources models/audio");
add("C2PA license resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "licenses"), "extraResources licenses");
add("mcp resources configured", Array.isArray(build.extraResources) && build.extraResources.some((item) => item && item.to === "mcp"), "extraResources mcp");
add(
  "macOS local network privacy declaration",
  Boolean(String(build.mac?.extendInfo?.NSLocalNetworkUsageDescription || "").trim()),
  "mac.extendInfo.NSLocalNetworkUsageDescription",
);
add(
  "macOS Bonjour local sync declaration",
  Array.isArray(build.mac?.extendInfo?.NSBonjourServices)
    && build.mac.extendInfo.NSBonjourServices.includes("_vintrace-sync._tcp"),
  "mac.extendInfo.NSBonjourServices _vintrace-sync._tcp",
);

if (required || backendExecutable) {
  const backendChecksum = backendChecksumStatus();
  const lifecyclePolicy = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.kind === "policy"));
  const lifecycleEvidence = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.kind === "evidence"));
  const lifecycleValidationManifest = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.key === "validation-pack-manifest.json"));
  const lifecycleValidationLabels = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.key === "validation-pack-labels.json"));
  const lifecycleOcrFixture = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.key === "paddleocr-general-ocr-002.jpg"));
  const lifecycleAudioFixture = lifecycleArtifactStatus(MODEL_LIFECYCLE_ARTIFACTS.filter((artifact) => artifact.key === "audio-acceptance-manifest.json"));
  const audioArtifacts = lifecycleArtifactStatus(AUDIO_INTELLIGENCE_ARTIFACTS);
  const localSyncEvidence = lifecycleArtifactStatus([LOCAL_SYNC_EVIDENCE]);
  add("packaged backend present", backendExecutable, backendFiles.slice(0, 8).join(", ") || "backend-dist is empty");
  add("packaged SQLCipher runtime", Boolean(backendSqlcipherRuntime), backendSqlcipherRuntime || "sqlcipher3 native runtime missing");
  add("packaged SQLCipher binding license", Boolean(backendSqlcipherLicense), backendSqlcipherLicense || "sqlcipher3 license missing");
  add("packaged ONNX Runtime binding", Boolean(backendOnnxRuntimeBinding), backendOnnxRuntimeBinding || "onnxruntime native Python binding missing");
  add("packaged ONNX Runtime library", Boolean(backendOnnxRuntimeLibrary), backendOnnxRuntimeLibrary || "onnxruntime 1.27 native library missing");
  add("packaged ONNX Runtime metadata", Boolean(backendOnnxRuntimeMetadata), backendOnnxRuntimeMetadata || "onnxruntime 1.27 metadata missing");
  add("packaged ONNX Runtime license", Boolean(backendOnnxRuntimeLicense), backendOnnxRuntimeLicense || "onnxruntime MIT license missing");
  add("packaged Whisper native binding", Boolean(backendWhisperBinding), backendWhisperBinding || "_pywhispercpp native binding missing");
  add("packaged whisper.cpp runtime", Boolean(backendWhisperLibrary), backendWhisperLibrary || "whisper.cpp native library missing");
  add("packaged PyWhisperCpp metadata", Boolean(backendWhisperMetadata), backendWhisperMetadata || "pywhispercpp 1.5.0 metadata missing");
  add("packaged Zeroconf native runtime", Boolean(backendZeroconfRuntime), backendZeroconfRuntime || "zeroconf native runtime missing");
  add("packaged Zeroconf metadata", Boolean(backendZeroconfMetadata), backendZeroconfMetadata || "zeroconf 0.149.17 metadata missing");
  add("packaged Zeroconf LGPL license", Boolean(backendZeroconfLicense), backendZeroconfLicense || "zeroconf LGPL license missing");
  add("packaged ifaddr metadata", Boolean(backendIfaddrMetadata), backendIfaddrMetadata || "ifaddr 0.2.0 metadata missing");
  add("packaged ifaddr MIT license", Boolean(backendIfaddrLicense), backendIfaddrLicense || "ifaddr MIT license missing");
  add("packaged C2PA native runtime", Boolean(backendC2paRuntime), backendC2paRuntime || "c2pa native runtime missing");
  add("packaged C2PA Apache-2.0 license", Boolean(backendC2paApacheLicense), backendC2paApacheLicense || "C2PA Apache-2.0 license missing");
  add("packaged C2PA MIT license", Boolean(backendC2paMitLicense), backendC2paMitLicense || "C2PA MIT license missing");
  add("packaged mobile companion document", Boolean(backendMobileIndex), backendMobileIndex || "mobile companion index missing");
  add("packaged mobile companion manifest", Boolean(backendMobileManifest), backendMobileManifest || "mobile companion manifest missing");
  add("packaged mobile companion script", Boolean(backendMobileScript), backendMobileScript || "mobile companion script missing");
  add("packaged mobile companion styles", Boolean(backendMobileStyles), backendMobileStyles || "mobile companion styles missing");
  add("packaged model lifecycle policy", lifecyclePolicy.ok, lifecyclePolicy.detail);
  add("packaged model lifecycle evidence", lifecycleEvidence.ok, lifecycleEvidence.detail);
  add("packaged model lifecycle validation manifest", lifecycleValidationManifest.ok, lifecycleValidationManifest.detail);
  add("packaged model lifecycle validation labels", lifecycleValidationLabels.ok, lifecycleValidationLabels.detail);
  add("packaged model lifecycle OCR fixture", lifecycleOcrFixture.ok, lifecycleOcrFixture.detail);
  add("packaged model lifecycle audio fixture", lifecycleAudioFixture.ok, lifecycleAudioFixture.detail);
  add("packaged audio intelligence artifacts", audioArtifacts.ok, audioArtifacts.detail);
  add("packaged local sync scale evidence", localSyncEvidence.ok, localSyncEvidence.detail);
  add("packaged backend checksum", backendChecksum.ok, backendChecksum.detail);
}

if (required) {
  const product = { name: build.productName || pkg.name, version: pkg.version };
  let checksumRows = [];
  let checksumDetail = "";
  let checksumsValid = false;
  try {
    checksumRows = readChecksumFile(checksumFile);
    verifyChecksummedFiles(dist, checksumRows);
    checksumsValid = true;
    checksumDetail = `${checksumRows.length} verified subject(s)`;
  } catch (error) {
    checksumDetail = error.message || String(error);
  }
  const checksums = new Map(checksumRows.map((entry) => [entry.name, entry.sha256]));
  let sbomDetail = "";
  let sbomsValid = false;
  try {
    const summary = validateSbomFiles(cycloneDxFile, spdxFile, product);
    sbomsValid = true;
    sbomDetail = `${summary.cycloneDx.components} CycloneDX component(s), ${summary.spdx.packages} SPDX package(s)`;
  } catch (error) {
    sbomDetail = error.message || String(error);
  }
  let buildMetadataDetail = "";
  try {
    const buildMetadata = parseJsonFile(buildMetadataFile);
    validateBuildMetadata(buildMetadata, product);
    const payloadFiles = releaseArtifactFiles(dist, { includeMetadata: false });
    const artifactMap = new Map(buildMetadata.artifacts.map((record) => [record.path, record]));
    if (artifactMap.size !== payloadFiles.length) throw new Error("Build metadata payload inventory is not exact");
    for (const file of payloadFiles) {
      const name = path.basename(file);
      const record = artifactMap.get(name);
      const stat = fs.statSync(file);
      if (!record || record.bytes !== stat.size || record.sha256 !== sha256File(file)) {
        throw new Error(`Build metadata payload record does not match ${name}`);
      }
    }
    for (const record of buildMetadata.sbom.outputs) {
      const file = path.join(dist, record.path);
      const stat = fs.statSync(file);
      if (record.bytes !== stat.size || record.sha256 !== sha256File(file)) {
        throw new Error(`Build metadata SBOM record does not match ${record.path}`);
      }
    }
    const expectedCommit = process.env.VINTRACE_BUILD_SHA || process.env.GITHUB_SHA || "";
    if (expectedCommit && buildMetadata.source?.commit !== expectedCommit) {
      throw new Error("Build metadata source commit does not match the CI build commit");
    }
    if (expectedCommit && buildMetadata.source?.dirty !== false) {
      throw new Error("Release source became dirty during the CI build");
    }
    const expectedRef = process.env.VINTRACE_BUILD_SOURCE_REF || process.env.GITHUB_REF || "";
    if (expectedRef && buildMetadata.source?.ref !== expectedRef) {
      throw new Error("Build metadata source ref does not match the CI build ref");
    }
    const expectedRepository = process.env.GITHUB_REPOSITORY || "";
    if (expectedRepository && buildMetadata.source?.repository !== expectedRepository) {
      throw new Error("Build metadata repository does not match GITHUB_REPOSITORY");
    }
    buildMetadataDetail = BUILD_METADATA_NAME;
  } catch (error) {
    buildMetadataDetail = error.message || String(error);
  }
  const expectedSubjects = releaseArtifactFiles(dist).map((file) => path.basename(file));
  const actualSubjects = checksumRows.map((entry) => entry.name);
  const exactSubjects = expectedSubjects.length === actualSubjects.length
    && expectedSubjects.every((name) => checksums.has(name));
  add("installer artifact present", hasAnyInstaller, distFiles.join(", ") || "dist is empty");
  add("release checksums verified", checksumsValid, checksumDetail || `${CHECKSUM_NAME} missing`);
  add("standard release SBOMs valid", sbomsValid, sbomDetail || "standard SBOMs missing");
  add("release build metadata valid", buildMetadataDetail === BUILD_METADATA_NAME, buildMetadataDetail || `${BUILD_METADATA_NAME} missing`);
  add("checksum subject set exact", exactSubjects, exactSubjects ? `${actualSubjects.length} subject(s)` : `expected ${expectedSubjects.join(", ")}; got ${actualSubjects.join(", ")}`);
  add("legacy custom release metadata absent", [...LEGACY_RELEASE_METADATA_NAMES].every((name) => !fs.existsSync(path.join(dist, name))), [...LEGACY_RELEASE_METADATA_NAMES].join(", "));
  for (const artifact of [...exeFiles, ...dmgFiles, ...zipFiles, ...appImageFiles, ...debFiles, ...rpmFiles, ...mcpbFiles, ...blockmaps, ...metadata, CYCLONEDX_NAME, SPDX_NAME, BUILD_METADATA_NAME]) {
    add(`checksum ${artifact}`, checksums.has(artifact), artifact);
  }
  for (const bundle of expectedSupplyChainBundles(checksumRows)) {
    const bundleFile = path.join(dist, bundle.name);
    let detail = bundle.name;
    let valid = false;
    try {
      validateSigstoreBundleFile(bundleFile, bundle.kind);
      valid = true;
    } catch (error) {
      detail = error.message || String(error);
    }
    add(`signed evidence ${bundle.name}`, valid, detail);
  }
  if (platform === "win32") {
    add("windows exe", exeFiles.length > 0, exeFiles.join(", ") || "missing .exe");
    add("windows update blockmap", blockmaps.length > 0, blockmaps.join(", ") || "missing .blockmap");
    add("windows update metadata", metadata.some((file) => file === "latest.yml" || file.startsWith("latest")), metadata.join(", ") || "missing latest.yml");
  } else if (platform === "darwin") {
    add("mac dmg", dmgFiles.length > 0, dmgFiles.join(", ") || "missing .dmg");
    add("mac zip updater", zipFiles.length > 0, zipFiles.join(", ") || "missing .zip");
    add("mac update metadata", metadata.length > 0, metadata.join(", ") || "missing latest*.yml");
  } else if (platform === "linux") {
    add("linux AppImage", appImageFiles.length === 1, appImageFiles.join(", ") || "missing .AppImage");
    add("linux deb", debFiles.length === 1, debFiles.join(", ") || "missing .deb");
    add("linux rpm", rpmFiles.length === 1, rpmFiles.join(", ") || "missing .rpm");
    add("linux update metadata", metadata.includes("latest-linux.yml"), metadata.join(", ") || "missing latest-linux.yml");
  }
} else {
  add("package artifacts optional", true, hasAnyInstaller ? distFiles.join(", ") : "not built in this checkout");
  if (!backendExecutable) {
    add("packaged backend optional", true, "not built in this checkout");
  }
  add("release metadata optional", true, fs.existsSync(checksumFile) ? "release metadata found" : "not built in this checkout");
}

const ok = checks.every((check) => check.ok);
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  ok,
  platform,
  required,
  dist,
  backendDist,
  artifacts: {
    exeFiles,
    dmgFiles,
    zipFiles,
    appImageFiles,
    debFiles,
    rpmFiles,
    mcpbFiles,
    blockmaps,
    metadata,
    releaseMetadata: distFiles.filter((file) => file === CHECKSUM_NAME || file === CYCLONEDX_NAME || file === SPDX_NAME || file === BUILD_METADATA_NAME || file.toLowerCase().endsWith(".sigstore.json")),
  },
  checks,
  recommendations: ok
    ? ["Package artifact configuration is structurally valid."]
    : ["Build the installer and backend sidecar, then rerun package artifact validation."]
}, null, 2));
process.exit(ok ? 0 : 1);

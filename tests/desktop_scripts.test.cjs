"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveMcpbRunner, runMcpbStep } = require("../desktop/scripts/build-mcp-bundle.cjs");
const { isReleaseArtifactName, releaseArtifactFiles, checksumLines } = require("../desktop/scripts/create-release-artifacts.cjs");
const {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  REQUIRED_RUNTIME_PURLS,
  SIGSTORE_BUNDLE_MEDIA_TYPE,
  SPDX_NAME,
  expectedSupplyChainBundles,
} = require("../desktop/scripts/release-supply-chain.cjs");
const { runFirstPython } = require("../desktop/scripts/python-runner.cjs");

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("mcpb runner uses shell for Windows cmd shims", () => {
  const runner = resolveMcpbRunner("C:\\repo", "win32", {
    existsSync: (candidate) => String(candidate).endsWith("mcpb.cmd"),
  });
  assert.strictEqual(runner.source, "local");
  assert.strictEqual(runner.shell, true);
  assert.ok(String(runner.command).endsWith("mcpb.cmd"), runner);
  assert.deepStrictEqual(runner.prefixArgs, []);
});

run("mcpb runner falls back to npx.cmd with Windows shell", () => {
  const runner = resolveMcpbRunner("C:\\repo", "win32", { existsSync: () => false });
  assert.strictEqual(runner.source, "npx");
  assert.strictEqual(runner.command, "npx.cmd");
  assert.strictEqual(runner.shell, true);
  assert.deepStrictEqual(runner.prefixArgs, ["-y", "@anthropic-ai/mcpb"]);
});

run("mcpb step prints spawn diagnostics", () => {
  const messages = [];
  const status = runMcpbStep(["validate", "manifest.json"], {
    cwd: "/repo",
    runner: { command: "npx.cmd", prefixArgs: ["-y", "@anthropic-ai/mcpb"], shell: true },
    spawnSyncImpl: (command, args, options) => {
      assert.strictEqual(command, "npx.cmd");
      assert.deepStrictEqual(args, ["-y", "@anthropic-ai/mcpb", "validate", "manifest.json"]);
      assert.strictEqual(options.shell, true);
      return { error: new Error("spawn EINVAL"), status: null };
    },
    stderr: (message) => messages.push(message),
  });
  assert.strictEqual(status, 1);
  assert.ok(messages.some((message) => message.includes("spawn EINVAL")), messages);
});

run("python runner skips Windows Store alias before running script", () => {
  const calls = [];
  const warnings = [];
  const result = runFirstPython({
    repoRoot: "C:\\repo",
    platform: "win32",
    env: {},
    args: ["tests/unit.py"],
    fsImpl: { existsSync: () => false },
    spawnSyncImpl: (command, args) => {
      calls.push({ command, args });
      if (command === "python3") {
        assert.deepStrictEqual(args, ["-c", "pass"]);
        return { status: 9009 };
      }
      if (command === "python" && args[0] === "-c") {
        return { status: 0 };
      }
      if (command === "python") {
        return { status: 0 };
      }
      return { error: Object.assign(new Error("missing"), { code: "ENOENT" }) };
    },
    stdio: "ignore",
    onWarning: (message) => warnings.push(message),
  });
  assert.strictEqual(result.ran, true);
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.command, "python");
  assert.ok(warnings.some((message) => message.includes("Windows Store Python alias")), warnings);
  assert.ok(!calls.some((call) => call.command === "python3" && call.args[0] === "tests/unit.py"), calls);
});

run("python runner warns when explicit PYTHON is missing", () => {
  const warnings = [];
  const result = runFirstPython({
    repoRoot: "C:\\repo",
    platform: "win32",
    env: { PYTHON: "C:\\missing\\python.exe" },
    args: ["tests/unit.py"],
    fsImpl: { existsSync: () => false },
    spawnSyncImpl: (command, args) => {
      if (command === "python3") {
        return { error: Object.assign(new Error("missing"), { code: "ENOENT" }) };
      }
      if (command === "python" && args[0] === "-c") {
        return { status: 0 };
      }
      if (command === "python") {
        return { status: 0 };
      }
      return { error: Object.assign(new Error("missing"), { code: "ENOENT" }) };
    },
    stdio: "ignore",
    onWarning: (message) => warnings.push(message),
  });
  assert.strictEqual(result.ran, true);
  assert.strictEqual(result.command, "python");
  assert.ok(warnings.some((message) => message.includes("PYTHON points to missing interpreter")), warnings);
});

run("run-mcp uses shared python runner and reports missing Python", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "run-mcp.cjs"), "utf8");
  assert.ok(source.includes('require("./python-runner.cjs")'));
  assert.ok(source.includes("runFirstPython({"));
  assert.ok(source.includes("Could not find Python. Create .venv or set PYTHON."));
  assert.ok(!source.includes('".venv", "bin", "python3"'));
});

run("backend builder fails loudly when meanshape lookup is unavailable", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "build-backend.cjs"), "utf8");
  assert.ok(source.includes("Could not locate insightface meanshape_68.pkl"));
  assert.ok(source.includes("insightface meanshape_68.pkl not found"));
  assert.ok(source.includes("Could not locate OpenCV Haar resources"));
  assert.ok(source.includes("haarcascade_frontalface_default.xml"));
  assert.ok(source.includes("haarcascade_eye_tree_eyeglasses.xml"));
  assert.ok(source.includes('`${openCvHaarDir}${path.delimiter}${path.join("cv2", "data")}`'));
  assert.ok(source.includes('"--add-data",'));
  assert.match(source, /"--collect-data",\s*\n\s*"faiss"/);
  assert.ok(source.includes("onnxruntime_runtime_report"));
  assert.ok(source.includes("Expected onnxruntime 1.27.0 with its native CPU runtime and inference probe"));
  assert.match(source, /"--collect-all",\s*\n\s*"onnxruntime"/);
  assert.match(source, /"--copy-metadata",\s*\n\s*"onnxruntime"/);
  assert.ok(source.includes("desktop", "pyinstaller-hooks"));
  assert.ok(source.includes("process.env.VINTRACE_BUILD_PYTHON || process.env.PYTHON"));
  assert.ok(source.includes("VINTRACE_REQUIRE_PYTHON_MINOR"));
  assert.ok(source.includes("Release backend requires Python"));
  assert.ok(source.includes("python: buildPython"));
  assert.ok(source.includes("opencv-ediffiqa-tiny-jun2024"));
  assert.ok(source.includes("9426c899cc0f01665240cb7d9e7f98e18e24e456c178326c771a43da289bfc6a"));
  assert.ok(source.includes("CC-BY-4.0"));
  assert.ok(source.includes('`${fiqaDir}${path.delimiter}${path.join("models", "fiq")}`'));
  assert.ok(source.includes("eDifFIQA(T) manifest, size, or checksum did not match the release pin"));
  assert.ok(source.includes("syn-vis-v0-balanced-60"));
  assert.ok(source.includes("857d421d17a2112afacfa870bb05ee5c77a1d3dd482d4eb05ef848399210fb8d"));
  assert.ok(source.includes('`${cohortDir}${path.delimiter}${path.join("models", "cohort")}`'));
  assert.ok(source.includes("Fixed AS-Norm cohort manifest, provenance, size, or checksum did not match the release pin"));
  assert.ok(source.includes("text_model_uint8.onnx"));
  assert.ok(source.includes("tokenizer.json"));
  assert.ok(source.includes("8c6d2827118d6d0e50db7392588d73133c7d2147997da522a1b2d144df535aed"));
  assert.ok(source.includes("cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322"));
  assert.ok(source.includes('`${semanticDir}${path.delimiter}${path.join("models", "semantic")}`'));
  assert.ok(!source.includes('`${semanticVisionPath}${path.delimiter}${path.join("models", "semantic")}`'));
  assert.ok(source.includes("vintrace-ppocrv6-small-rapidocr"));
  assert.ok(source.includes("d6edb509c8f5b302004bd68787fdc3e5e266a2b230915fec7455bd264d282d2f"));
  assert.ok(source.includes("PP-OCRv6 provenance, license, size, or checksum did not match the release pin"));
  assert.ok(source.includes('`${photoOcrDir}${path.delimiter}${path.join("models", "ocr")}`'));
  assert.ok(source.includes('"rapidocr.inference_engine.onnxruntime"'));
  assert.match(source, /"--copy-metadata",\s*\n\s*"rapidocr"/);
  assert.ok(source.includes("Expected c2pa-python 0.36.0 / native SDK 0.89.0"));
  assert.match(source, /"--copy-metadata",\s*\n\s*"c2pa-python"/);
  assert.match(source, /"--collect-binaries",\s*\n\s*"c2pa"/);
  assert.ok(source.includes("rapidOcrPackage.version !== \"3.9.1\""));
  assert.ok(source.includes("vintrace-photo-vlm"));
  assert.ok(source.includes("63a31351f11b68fdeb9f739061df5e1fc85fae6dd25914bb589eabe8af19cc75"));
  assert.ok(source.includes("Qwen/Qwen3-VL-4B-Instruct-GGUF"));
  assert.ok(source.includes("ggml-org/SmolVLM2-2.2B-Instruct-GGUF"));
  assert.ok(source.includes("Portable photo VLM catalog, licensing, runtime pin, or model hashes did not match the release contract"));
  assert.ok(source.includes('`${photoVlmDir}${path.delimiter}${path.join("models", "vlm")}`'));
  assert.ok(source.includes('`${photoGenerativeDir}${path.delimiter}${path.join("models", "generative")}`'));
  assert.ok(!source.includes("...(meanShapePath && fs.existsSync(meanShapePath)"));
  assert.match(
    source,
    /fs\.rmSync\(workDir, \{ recursive: true, force: true \}\)/,
    "backend builds must clear the explicit PyInstaller workpath to prevent stale frozen code"
  );
});

run("desktop and mobile renderer builds are parallel and typecheck is incremental", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const tsconfig = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tsconfig.json"), "utf8"));
  assert.strictEqual(pkg.scripts.build, "npm-run-all --parallel build:typecheck build:vite build:mobile");
  assert.strictEqual(pkg.scripts["build:typecheck"], "tsc --noEmit");
  assert.strictEqual(pkg.scripts["build:vite"], "vite build");
  assert.strictEqual(pkg.scripts["build:mobile"], "vite build --config mobile.vite.config.ts");
  assert.strictEqual(tsconfig.compilerOptions.noEmit, true);
  assert.strictEqual(tsconfig.compilerOptions.incremental, true);
  assert.strictEqual(tsconfig.compilerOptions.tsBuildInfoFile, "./.tsbuildinfo");
});

run("Electron 43 and ONNX Runtime 1.27 are pinned and verified in every delivery path", () => {
  const root = path.join(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const dependencySource = fs.readFileSync(path.join(root, "desktop", "scripts", "check-dependency-currency.cjs"), "utf8");
  const hookSource = fs.readFileSync(path.join(root, "desktop", "pyinstaller-hooks", "hook-onnxruntime.py"), "utf8");
  const mainSource = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
  assert.strictEqual(pkg.engines.node, ">=22.12.0 <25");
  assert.strictEqual(pkg.devDependencies.electron, "43.1.0");
  assert.strictEqual(lock.packages["node_modules/electron"].version, "43.1.0");
  assert.strictEqual(pkg.build.mac.minimumSystemVersion, "14.0");
  assert.deepStrictEqual(pkg.build.mac.target.map((item) => item.arch), [["arm64"], ["arm64"]]);
  assert.deepStrictEqual(pkg.build.win.target[0].arch, ["x64"]);
  assert.deepStrictEqual(pkg.build.linux.target.map((item) => [item.target, item.arch]), [
    ["AppImage", ["x64"]],
    ["deb", ["x64"]],
    ["rpm", ["x64"]],
  ]);
  assert.strictEqual(pkg.scripts["electron:install"], "install-electron --no");
  assert.ok(pkg.scripts["test:dependency-currency"].includes("tests/dependency_currency.py"));
  assert.ok(pkg.scripts["test:frozen-dependency-currency"].includes("tests/frozen_dependency_currency.py"));
  assert.ok(pkg.scripts["test:model-lifecycle"].includes("tests/model_lifecycle_units.py"));
  assert.ok(pkg.scripts["test:frozen-model-lifecycle"].includes("tests/frozen_model_lifecycle.py"));
  assert.ok(pkg.scripts["test:audio-intelligence"].includes("tests/audio_intelligence_units.py"));
  assert.ok(pkg.scripts["test:frozen-audio-intelligence"].includes("tests/frozen_audio_intelligence.py"));
  assert.ok(pkg.scripts["test:frozen-mobile-companion"].includes("tests/mobile_companion_http.py"));
  assert.ok(dependencySource.includes('electron: "43.1.0"'));
  assert.ok(dependencySource.includes('const expectedOnnxRuntime = "1.27.0"'));
  assert.ok(dependencySource.includes('"pydantic-settings": "2.14.2"'));
  assert.ok(dependencySource.includes("production dependencies gained native modules"));
  assert.ok(hookSource.includes('collect_dynamic_libs("onnxruntime")'));
  assert.ok(hookSource.includes('copy_metadata("onnxruntime")'));
  assert.ok(mainSource.includes('notification.once("failed"'));
  assert.ok(mainSource.includes('defaultPath: app.getPath("pictures")'));
  for (const workflow of ["qa.yml", "macos-release.yml", "windows-release.yml", "linux-release.yml"]) {
    const source = fs.readFileSync(path.join(root, ".github", "workflows", workflow), "utf8");
    assert.ok(source.includes("npm run electron:install"), workflow);
    assert.ok(source.includes("npm run test:dependency-currency"), workflow);
    assert.ok(source.includes(workflow === "qa.yml" ? "npm run test:model-lifecycle" : "python tests/model_lifecycle_units.py"), workflow);
    assert.ok(source.includes(workflow === "qa.yml" ? "npm run eval:model-lifecycle" : "run_model_lifecycle_evals.py"), workflow);
    assert.ok(source.includes(workflow === "qa.yml" ? "npm run test:audio-intelligence" : "python tests/audio_intelligence_units.py"), workflow);
    assert.ok(source.includes("pip-audit==2.10.1"), workflow);
    assert.ok(source.includes("--require-hashes -r requirements-production.lock.txt"), workflow);
  }
  for (const workflow of ["macos-release.yml", "windows-release.yml", "linux-release.yml"]) {
    const source = fs.readFileSync(path.join(root, ".github", "workflows", workflow), "utf8");
    assert.ok(source.includes("npm run test:frozen-dependency-currency"), workflow);
    assert.ok(source.includes("npm run test:frozen-model-lifecycle"), workflow);
    assert.ok(source.includes("npm run test:frozen-audio-intelligence"), workflow);
    assert.ok(source.includes("npm run test:frozen-mobile-companion"), workflow);
    assert.ok(source.includes("npm run test:e2e:packaged"), workflow);
  }
});

run("release artifact checksums include only top-level release files", () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-release-artifacts-"));
  try {
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.mkdirSync(path.join(dist, "mac-arm64", "Vintrace.app", "Contents", "MacOS"), { recursive: true });
    for (const name of [
      "Vintrace Setup 0.1.0.exe",
      "Vintrace-0.1.0-arm64.dmg",
      "Vintrace-0.1.0-mac.zip",
      "Vintrace-0.1.0-mac.zip.blockmap",
      "Vintrace-0.1.0-linux-x86_64.AppImage",
      "vintrace_0.1.0_amd64.deb",
      "vintrace-0.1.0.x86_64.rpm",
      "Vintrace-darwin-arm64.mcpb",
      "latest-mac.yml",
      "latest-linux.yml",
      CYCLONEDX_NAME,
      SPDX_NAME,
      BUILD_METADATA_NAME,
      "SHA256SUMS.txt",
      "SHA256SUMS.txt.sig",
      "builder-effective-config.yaml",
      "index.html",
    ]) {
      fs.writeFileSync(path.join(dist, name), name);
    }
    fs.writeFileSync(path.join(dist, "assets", "index.js"), "compiled app");
    fs.writeFileSync(path.join(dist, "mac-arm64", "Vintrace.app", "Contents", "MacOS", "Vintrace"), "binary");

    assert.strictEqual(isReleaseArtifactName("builder-effective-config.yaml"), false);
    assert.strictEqual(isReleaseArtifactName("index.html"), false);
    assert.strictEqual(isReleaseArtifactName("latest-mac.yml"), true);
    assert.strictEqual(isReleaseArtifactName("latest-linux.yml"), true);
    assert.strictEqual(isReleaseArtifactName("Vintrace-0.1.0-linux-x86_64.AppImage"), true);
    assert.strictEqual(isReleaseArtifactName(BUILD_METADATA_NAME), true);
    assert.strictEqual(isReleaseArtifactName("vintrace-provenance.json"), false);
    assert.strictEqual(isReleaseArtifactName("payload.zip.sigstore.json"), false);
    const artifactNames = releaseArtifactFiles(dist).map((file) => path.basename(file));
    assert.deepStrictEqual(artifactNames, [
      "latest-mac.yml",
      "latest-linux.yml",
      "Vintrace Setup 0.1.0.exe",
      "Vintrace-0.1.0-arm64.dmg",
      "Vintrace-0.1.0-linux-x86_64.AppImage",
      "Vintrace-0.1.0-mac.zip",
      "Vintrace-0.1.0-mac.zip.blockmap",
      "Vintrace-darwin-arm64.mcpb",
      "vintrace_0.1.0_amd64.deb",
      "vintrace-0.1.0.x86_64.rpm",
      CYCLONEDX_NAME,
      SPDX_NAME,
      BUILD_METADATA_NAME,
    ].sort((a, b) => a.localeCompare(b)));
    assert.deepStrictEqual(
      releaseArtifactFiles(dist, { includeMetadata: false }).map((file) => path.basename(file)),
      artifactNames.filter((name) => ![CYCLONEDX_NAME, SPDX_NAME, BUILD_METADATA_NAME].includes(name))
    );
    assert.deepStrictEqual(checksumLines([
      { sha256: "b".repeat(64), path: "b.zip" },
      { sha256: "a".repeat(64), path: "a.dmg" },
    ]), [
      `${"a".repeat(64)}  a.dmg`,
      `${"b".repeat(64)}  b.zip`,
    ]);
  } finally {
    fs.rmSync(dist, { recursive: true, force: true });
  }
});

run("cross-platform finalizer verifies one aggregate draft before publishing", () => {
  const verifierSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "verify-release-assets.cjs"), "utf8");
  assert.ok(verifierSource.includes("allowDraft"));
  assert.ok(verifierSource.includes("--allow-draft"));
  assert.ok(verifierSource.includes("draft release accepted for staged verification"));
  assert.ok(verifierSource.includes("application/octet-stream"));
  assert.ok(verifierSource.includes("installer staged download is authenticated"));
  assert.ok(verifierSource.includes("verifyCosignBundles"));
  assert.ok(verifierSource.includes("verifyGithubAttestations"));
  const release = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  for (const workflow of ["windows-release.yml", "macos-release.yml", "linux-release.yml"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", workflow), "utf8");
    assert.ok(source.includes("workflow_call:"), workflow);
    assert.ok(source.includes("dist/SHA256SUMS.txt*"), workflow);
    assert.ok(source.includes("actions/attest@a1948c3f048ba23858d222213b7c278aabede763"), workflow);
    assert.ok(!source.includes("softprops/action-gh-release"), workflow);
    assert.ok(!source.includes("Publish verified GitHub Release"), workflow);
  }
  assert.ok(release.includes("draft: true"));
  assert.ok(release.includes("--allow-draft"));
  assert.ok(release.includes("--platform all"));
  assert.ok(release.includes("overwrite_files: false"));
  assert.ok(release.includes("release:assemble"));
  assert.ok(release.includes("Verify the complete staged release"));
  assert.ok(release.includes("Publish the verified release once"));
  assert.ok(release.includes("actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b"));
});

run("backend packaging gate verifies sidecar checksum manifest", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-package-check-"));
  const sourceRoot = path.join(__dirname, "..");
  const checkerSource = path.join(__dirname, "..", "desktop", "scripts", "check-package-artifacts.cjs");
  const checkerPath = path.join(fixture, "desktop", "scripts", "check-package-artifacts.cjs");
  const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
  const writeJson = (file, value) => {
    const data = JSON.stringify(value, null, 2);
    fs.writeFileSync(file, data, "utf8");
    return data;
  };

  function runChecker() {
    const result = spawnSync(process.execPath, [checkerPath], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_REF: "",
        GITHUB_REPOSITORY: "",
        GITHUB_SHA: "",
        VINTRACE_BUILD_SHA: "",
        VINTRACE_BUILD_SOURCE_REF: "",
        VINTRACE_PACKAGE_REQUIRED: "1",
        VINTRACE_PACKAGE_PLATFORM: "darwin",
      },
    });
    return {
      status: result.status,
      output: JSON.parse(result.stdout),
      stderr: result.stderr,
    };
  }

  try {
    fs.mkdirSync(path.dirname(checkerPath), { recursive: true });
    fs.copyFileSync(checkerSource, checkerPath);
    fs.copyFileSync(path.join(__dirname, "..", "desktop", "scripts", "create-release-artifacts.cjs"), path.join(path.dirname(checkerPath), "create-release-artifacts.cjs"));
    fs.copyFileSync(path.join(__dirname, "..", "desktop", "scripts", "release-supply-chain.cjs"), path.join(path.dirname(checkerPath), "release-supply-chain.cjs"));
    fs.mkdirSync(path.join(fixture, "desktop", "assets"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "desktop", "main.cjs"), "");
    fs.writeFileSync(path.join(fixture, "desktop", "preload.cjs"), "");
    fs.writeFileSync(path.join(fixture, "desktop", "assets", "icon.png"), "");
    writeJson(path.join(fixture, "package.json"), {
      name: "vintrace",
      version: "0.1.0",
      build: {
        productName: "Vintrace",
        appId: "com.vintrace.test",
        extraResources: [
          { to: "backend" },
          { to: "requirements-production.lock.txt" },
          { to: "models/insightface" },
          { to: "models/cohort" },
          { to: "models/generative" },
          { to: "models/lifecycle" },
          { to: "models/audio" },
          { to: "licenses" },
          { to: "mcp" },
        ],
        mac: {
          extendInfo: {
            NSLocalNetworkUsageDescription: "Fixture local network usage.",
            NSBonjourServices: ["_vintrace-sync._tcp"],
          },
        },
      },
    });

    const dist = path.join(fixture, "dist");
    fs.mkdirSync(dist, { recursive: true });
    const releaseArtifacts = new Map([
      ["Vintrace-1.0.0-arm64.dmg", "fake dmg"],
      ["Vintrace-1.0.0-mac.zip", "fake zip"],
      ["latest-mac.yml", "path: Vintrace-1.0.0-mac.zip\n"],
    ]);
    for (const [name, body] of releaseArtifacts) {
      fs.writeFileSync(path.join(dist, name), body, "utf8");
    }
    const components = REQUIRED_RUNTIME_PURLS.map((purl, index) => ({
      "bom-ref": `component-${index}`,
      type: "library",
      name: purl.split("/").pop().split("@")[0],
      version: purl.split("@").pop(),
      purl,
    }));
    const cycloneDx = writeJson(path.join(dist, CYCLONEDX_NAME), {
      bomFormat: "CycloneDX",
      specVersion: "1.6",
      serialNumber: "urn:uuid:123e4567-e89b-42d3-a456-426614174000",
      version: 1,
      metadata: {
        timestamp: "2026-07-13T00:00:00Z",
        component: { type: "application", name: "Vintrace", version: "0.1.0" },
        tools: { components: [{ type: "application", name: "syft", version: "1.44.0" }] },
      },
      components,
      dependencies: [{ ref: "root", dependsOn: components.map((component) => component["bom-ref"]) }],
    });
    const spdx = writeJson(path.join(dist, SPDX_NAME), {
      spdxVersion: "SPDX-2.3",
      dataLicense: "CC0-1.0",
      SPDXID: "SPDXRef-DOCUMENT",
      name: "Vintrace",
      documentNamespace: "https://anchore.com/syft/dir/Vintrace-test",
      creationInfo: { created: "2026-07-13T00:00:00Z", creators: ["Tool: syft-1.44.0"] },
      packages: REQUIRED_RUNTIME_PURLS.map((purl, index) => ({
        name: components[index].name,
        SPDXID: `SPDXRef-Package-${index}`,
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: purl }],
      })),
      relationships: [{ spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Package-0" }],
    });
    const buildMetadata = writeJson(path.join(dist, BUILD_METADATA_NAME), {
      schemaVersion: 1,
      generatedAt: "2026-07-13T00:00:00Z",
      product: { name: "Vintrace", version: "0.1.0" },
      artifacts: Array.from(releaseArtifacts).map(([name, body]) => ({ path: name, bytes: Buffer.byteLength(body), sha256: digest(body) })),
      sbom: {
        generator: { name: "syft", version: "1.44.0" },
        outputs: [
          { path: CYCLONEDX_NAME, bytes: Buffer.byteLength(cycloneDx), sha256: digest(cycloneDx) },
          { path: SPDX_NAME, bytes: Buffer.byteLength(spdx), sha256: digest(spdx) },
        ],
      },
      releaseEvidencePolicy: {
        minimumSlsaBuildLevel: 2,
        githubAttestationRequired: true,
        keylessCosignRequired: true,
        provenanceGeneratedSeparately: true,
      },
    });
    const checksumSubjects = new Map([
      ...releaseArtifacts,
      [CYCLONEDX_NAME, cycloneDx],
      [SPDX_NAME, spdx],
      [BUILD_METADATA_NAME, buildMetadata],
    ]);
    const checksumRows = Array.from(checksumSubjects)
      .map(([name, body]) => ({ name, sha256: digest(body) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(dist, CHECKSUM_NAME), checksumRows.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n", "utf8");
    const blobBundle = {
      mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
      verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
      messageSignature: { signature: "c2ln" },
    };
    const attestationBundle = {
      mediaType: SIGSTORE_BUNDLE_MEDIA_TYPE,
      verificationMaterial: { certificate: { rawBytes: "Y2VydA==" } },
      dsseEnvelope: { payload: "e30=", signatures: [{ sig: "c2ln" }] },
    };
    for (const bundle of expectedSupplyChainBundles(checksumRows)) {
      writeJson(path.join(dist, bundle.name), bundle.kind === "blob" ? blobBundle : attestationBundle);
    }

    const backendDist = path.join(fixture, "backend-dist");
    const backendRelative = "crossage-backend/crossage-backend";
    const backendPath = path.join(backendDist, backendRelative);
    const backendBody = "fake backend executable";
    fs.mkdirSync(path.dirname(backendPath), { recursive: true });
    fs.writeFileSync(backendPath, backendBody, "utf8");
    const sqlcipherRuntime = path.join(backendDist, "crossage-backend", "_internal", "sqlcipher3", "_sqlite3.test.so");
    const sqlcipherLicense = path.join(backendDist, "crossage-backend", "_internal", "sqlcipher3-0.6.2.dist-info", "licenses", "LICENSE");
    fs.mkdirSync(path.dirname(sqlcipherRuntime), { recursive: true });
    fs.mkdirSync(path.dirname(sqlcipherLicense), { recursive: true });
    fs.writeFileSync(sqlcipherRuntime, "fake sqlcipher runtime", "utf8");
    fs.writeFileSync(sqlcipherLicense, "fake sqlcipher license", "utf8");
    const onnxRuntimeBinding = path.join(backendDist, "crossage-backend", "_internal", "onnxruntime", "capi", "onnxruntime_pybind11_state.so");
    const onnxRuntimeLibrary = path.join(backendDist, "crossage-backend", "_internal", "onnxruntime", "capi", "libonnxruntime.1.27.0.dylib");
    const onnxRuntimeMetadata = path.join(backendDist, "crossage-backend", "_internal", "onnxruntime-1.27.0.dist-info", "METADATA");
    const onnxRuntimeLicense = path.join(backendDist, "crossage-backend", "_internal", "onnxruntime", "LICENSE");
    for (const file of [onnxRuntimeBinding, onnxRuntimeLibrary, onnxRuntimeMetadata, onnxRuntimeLicense]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `fake ${path.basename(file)}`, "utf8");
    }
    const whisperBinding = path.join(backendDist, "crossage-backend", "_internal", "_pywhispercpp.test.so");
    const whisperLibrary = path.join(backendDist, "crossage-backend", "_internal", "pywhispercpp", ".dylibs", "libwhisper.1.8.4.dylib");
    const whisperMetadata = path.join(backendDist, "crossage-backend", "_internal", "pywhispercpp-1.5.0.dist-info", "METADATA");
    for (const file of [whisperBinding, whisperLibrary, whisperMetadata]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `fake ${path.basename(file)}`, "utf8");
    }
    const zeroconfRuntime = path.join(backendDist, "crossage-backend", "_internal", "zeroconf", "_dns.test.so");
    const zeroconfMetadata = path.join(backendDist, "crossage-backend", "_internal", "zeroconf-0.149.17.dist-info", "METADATA");
    const zeroconfLicense = path.join(backendDist, "crossage-backend", "_internal", "zeroconf-0.149.17.dist-info", "licenses", "COPYING");
    const ifaddrMetadata = path.join(backendDist, "crossage-backend", "_internal", "ifaddr-0.2.0.dist-info", "METADATA");
    const ifaddrLicense = path.join(backendDist, "crossage-backend", "_internal", "ifaddr-0.2.0.dist-info", "LICENSE.txt");
    for (const file of [zeroconfRuntime, zeroconfMetadata, zeroconfLicense, ifaddrMetadata, ifaddrLicense]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `fake ${path.basename(file)}`, "utf8");
    }
    const c2paRuntime = path.join(backendDist, "crossage-backend", "_internal", "c2pa", "libs", "libc2pa_c.dylib");
    const c2paApache = path.join(backendDist, "crossage-backend", "_internal", "licenses", "C2PA-LICENSE-APACHE.txt");
    const c2paMit = path.join(backendDist, "crossage-backend", "_internal", "licenses", "C2PA-LICENSE-MIT.txt");
    fs.mkdirSync(path.dirname(c2paRuntime), { recursive: true });
    fs.mkdirSync(path.dirname(c2paApache), { recursive: true });
    fs.writeFileSync(c2paRuntime, "fake c2pa runtime", "utf8");
    fs.writeFileSync(c2paApache, "fake Apache license", "utf8");
    fs.writeFileSync(c2paMit, "fake MIT license", "utf8");
    const mobileRoot = path.join(backendDist, "crossage-backend", "_internal", "mobile-dist");
    const mobileIndex = path.join(mobileRoot, "index.html");
    const mobileManifest = path.join(mobileRoot, "manifest.webmanifest");
    const mobileScript = path.join(mobileRoot, "assets", "mobile-fixture123.js");
    const mobileStyles = path.join(mobileRoot, "assets", "mobile-fixture123.css");
    fs.mkdirSync(path.dirname(mobileScript), { recursive: true });
    fs.writeFileSync(mobileIndex, "<!doctype html><title>Mobile fixture</title>", "utf8");
    fs.writeFileSync(mobileManifest, '{"name":"Mobile fixture"}', "utf8");
    fs.writeFileSync(mobileScript, "export {};", "utf8");
    fs.writeFileSync(mobileStyles, "body{}", "utf8");
    const lifecycleInternal = path.join(backendDist, "crossage-backend", "_internal");
    const lifecyclePolicy = path.join(lifecycleInternal, "models", "lifecycle", "policy.json");
    const lifecycleEvidenceNames = [
      "accuracy_validation_history.json",
      "photo-culling-benchmark-20260713.json",
      "ppocrv6-benchmark-20260712.json",
      "photo-vlm-benchmark-20260712.json",
      "video-semantic-benchmark-20260713.json",
      "photo-generative-benchmark-20260712.json",
      "multimodal-safety-benchmark-20260713.json",
      "synthetic-enrollment-screen-benchmark-20260712.json",
      "audio-intelligence-benchmark-20260713.json",
    ];
    fs.mkdirSync(path.dirname(lifecyclePolicy), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "models", "lifecycle", "policy.json"), lifecyclePolicy);
    const lifecycleEvidenceDigests = {};
    for (const name of lifecycleEvidenceNames) {
      const source = name === "accuracy_validation_history.json"
        ? path.join(sourceRoot, name)
        : path.join(sourceRoot, "benchmarks", "results", name);
      const destination = name === "accuracy_validation_history.json"
        ? path.join(lifecycleInternal, name)
        : path.join(lifecycleInternal, "benchmarks", "results", name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      lifecycleEvidenceDigests[name] = digest(fs.readFileSync(source));
    }
    const lifecycleValidationManifest = path.join(lifecycleInternal, "validation-packs", "vintrace-accuracy-validation-pack-v1", "manifest.json");
    const lifecycleValidationLabels = path.join(lifecycleInternal, "validation-packs", "vintrace-accuracy-validation-pack-v1", "labels.json");
    const lifecycleOcrFixture = path.join(lifecycleInternal, "tests", "fixtures", "ocr", "paddleocr-general-ocr-002.jpg");
    const lifecycleAudioFixture = path.join(lifecycleInternal, "tests", "fixtures", "audio", "manifest.json");
    const lifecycleDatasetSources = new Map([
      ["validation-pack-manifest.json", path.join(sourceRoot, "validation-packs", "vintrace-accuracy-validation-pack-v1", "manifest.json")],
      ["validation-pack-labels.json", path.join(sourceRoot, "validation-packs", "vintrace-accuracy-validation-pack-v1", "labels.json")],
      ["paddleocr-general-ocr-002.jpg", path.join(sourceRoot, "tests", "fixtures", "ocr", "paddleocr-general-ocr-002.jpg")],
      ["audio-acceptance-manifest.json", path.join(sourceRoot, "tests", "fixtures", "audio", "manifest.json")],
    ]);
    const lifecycleDatasetDestinations = new Map([
      ["validation-pack-manifest.json", lifecycleValidationManifest],
      ["validation-pack-labels.json", lifecycleValidationLabels],
      ["paddleocr-general-ocr-002.jpg", lifecycleOcrFixture],
      ["audio-acceptance-manifest.json", lifecycleAudioFixture],
    ]);
    const lifecycleDatasetDigests = {};
    for (const [name, source] of lifecycleDatasetSources) {
      const destination = lifecycleDatasetDestinations.get(name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
      lifecycleDatasetDigests[name] = digest(fs.readFileSync(source));
    }
    const audioArtifactNames = [
      "manifest.json",
      "ggml-tiny-q5_1.bin",
      "yamnet-core.onnx",
      "yamnet-mel-weights.npy",
      "yamnet-class-map.csv",
      "YAMNET-LICENSE",
      "WHISPERCPP-LICENSE",
      "WHISPER-MODEL-LICENSE",
      "PYWHISPERCPP-LICENSE",
    ];
    const audioArtifactDigests = {};
    const audioInternal = path.join(lifecycleInternal, "models", "audio");
    fs.mkdirSync(audioInternal, { recursive: true });
    for (const name of audioArtifactNames) {
      const source = path.join(sourceRoot, "models", "audio", name);
      const destination = path.join(audioInternal, name);
      fs.copyFileSync(source, destination);
      audioArtifactDigests[name] = digest(fs.readFileSync(source));
    }
    const localSyncEvidenceName = "local-sync-benchmark-20260713.json";
    const localSyncEvidenceSource = path.join(sourceRoot, "benchmarks", "results", localSyncEvidenceName);
    const localSyncEvidence = path.join(lifecycleInternal, "benchmarks", "results", localSyncEvidenceName);
    fs.mkdirSync(path.dirname(localSyncEvidence), { recursive: true });
    fs.copyFileSync(localSyncEvidenceSource, localSyncEvidence);
    const localSyncEvidenceDigest = digest(fs.readFileSync(localSyncEvidenceSource));
    const backendDigest = digest(backendBody);
    fs.writeFileSync(path.join(backendDist, "crossage-backend.sha256"), `${backendDigest}  ${backendRelative}\n`, "utf8");
    writeJson(path.join(backendDist, "crossage-backend-manifest.json"), {
      executable: backendRelative,
      bytes: Buffer.byteLength(backendBody),
      sha256: backendDigest,
      dependencies: {
        onnxruntime: {
          ok: true,
          packageVersion: "1.27.0",
          runtimeVersion: "1.27.0",
          nativeModulePresent: true,
          providers: ["CoreMLExecutionProvider", "CPUExecutionProvider"],
          inferenceOutput: [0.25, -1.5],
        },
        modelLifecycle: {
          policyVersion: "2026-07-13.3",
          policySha256: "1b5a466c5f39d1a7deecbbbe83e5a961e91473444385fd31f7ddf485d9ccb8e6",
          evidence: lifecycleEvidenceDigests,
          datasets: lifecycleDatasetDigests,
        },
        audioIntelligence: {
          packVersion: "2026-07-13.1",
          indexVersion: "vintrace-audio-v1",
          runtimeVersion: "1.5.0",
          artifacts: audioArtifactDigests,
        },
        localSync: {
          protocol: "vintrace-local-sync-v1",
          serviceType: "_vintrace-sync._tcp.local.",
          zeroconfVersion: "0.149.17",
          ifaddrVersion: "0.2.0",
          internetService: false,
          licenses: {
            zeroconf: "4d1d974999ae8655ee47afb47ac3b327cd1baeea3509aecb35341ba1a1a53c94",
            ifaddr: "8700856576ae2bc80c63bc970250510d9213fb02fed006d5f22742c9ddde24d7",
          },
          evidence: { [localSyncEvidenceName]: localSyncEvidenceDigest },
        },
      },
    });

    const clean = runChecker();
    assert.strictEqual(clean.status, 0, clean.stderr || JSON.stringify(clean.output, null, 2));
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged backend checksum").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged SQLCipher runtime").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged ONNX Runtime binding").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged ONNX Runtime library").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged ONNX Runtime metadata").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged Whisper native binding").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged whisper.cpp runtime").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged C2PA native runtime").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged mobile companion document").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged mobile companion script").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged model lifecycle policy").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged model lifecycle evidence").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged audio intelligence artifacts").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged Zeroconf native runtime").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged Zeroconf LGPL license").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged ifaddr MIT license").ok, true);
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged local sync scale evidence").ok, true);

    fs.rmSync(lifecyclePolicy);
    const missingLifecyclePolicy = runChecker();
    assert.strictEqual(missingLifecyclePolicy.status, 1, JSON.stringify(missingLifecyclePolicy.output, null, 2));
    assert.strictEqual(missingLifecyclePolicy.output.checks.find((check) => check.name === "packaged model lifecycle policy").ok, false);
    fs.copyFileSync(path.join(sourceRoot, "models", "lifecycle", "policy.json"), lifecyclePolicy);

    const lifecycleEvidenceFixture = path.join(lifecycleInternal, "benchmarks", "results", "ppocrv6-benchmark-20260712.json");
    fs.appendFileSync(lifecycleEvidenceFixture, "tampered");
    const tamperedLifecycleEvidence = runChecker();
    assert.strictEqual(tamperedLifecycleEvidence.status, 1, JSON.stringify(tamperedLifecycleEvidence.output, null, 2));
    assert.strictEqual(tamperedLifecycleEvidence.output.checks.find((check) => check.name === "packaged model lifecycle evidence").ok, false);
    fs.copyFileSync(path.join(sourceRoot, "benchmarks", "results", "ppocrv6-benchmark-20260712.json"), lifecycleEvidenceFixture);

    const audioClassMap = path.join(audioInternal, "yamnet-class-map.csv");
    fs.appendFileSync(audioClassMap, "tampered");
    const tamperedAudioArtifact = runChecker();
    assert.strictEqual(tamperedAudioArtifact.status, 1, JSON.stringify(tamperedAudioArtifact.output, null, 2));
    assert.strictEqual(tamperedAudioArtifact.output.checks.find((check) => check.name === "packaged audio intelligence artifacts").ok, false);
    fs.copyFileSync(path.join(sourceRoot, "models", "audio", "yamnet-class-map.csv"), audioClassMap);

    fs.appendFileSync(localSyncEvidence, "tampered");
    const tamperedLocalSyncEvidence = runChecker();
    assert.strictEqual(tamperedLocalSyncEvidence.status, 1, JSON.stringify(tamperedLocalSyncEvidence.output, null, 2));
    assert.strictEqual(tamperedLocalSyncEvidence.output.checks.find((check) => check.name === "packaged local sync scale evidence").ok, false);
    fs.copyFileSync(localSyncEvidenceSource, localSyncEvidence);

    fs.rmSync(mobileScript);
    const missingMobileScript = runChecker();
    assert.strictEqual(missingMobileScript.status, 1, JSON.stringify(missingMobileScript.output, null, 2));
    assert.strictEqual(missingMobileScript.output.checks.find((check) => check.name === "packaged mobile companion script").ok, false);
    fs.writeFileSync(mobileScript, "export {};", "utf8");

    fs.rmSync(onnxRuntimeBinding);
    const missingOnnxRuntime = runChecker();
    assert.strictEqual(missingOnnxRuntime.status, 1, JSON.stringify(missingOnnxRuntime.output, null, 2));
    assert.strictEqual(missingOnnxRuntime.output.checks.find((check) => check.name === "packaged ONNX Runtime binding").ok, false);
    fs.writeFileSync(onnxRuntimeBinding, "fake onnxruntime_pybind11_state.so", "utf8");

    const missingBundle = expectedSupplyChainBundles(checksumRows)[0];
    fs.rmSync(path.join(dist, missingBundle.name));
    const missingEvidence = runChecker();
    assert.strictEqual(missingEvidence.status, 1, JSON.stringify(missingEvidence.output, null, 2));
    assert.strictEqual(missingEvidence.output.checks.find((check) => check.name === `signed evidence ${missingBundle.name}`).ok, false);
    writeJson(path.join(dist, missingBundle.name), missingBundle.kind === "blob" ? blobBundle : attestationBundle);

    fs.appendFileSync(path.join(dist, CYCLONEDX_NAME), "tampered");
    const tamperedSbom = runChecker();
    assert.strictEqual(tamperedSbom.status, 1, JSON.stringify(tamperedSbom.output, null, 2));
    assert.strictEqual(tamperedSbom.output.checks.find((check) => check.name === "standard release SBOMs valid").ok, false);
    fs.writeFileSync(path.join(dist, CYCLONEDX_NAME), cycloneDx, "utf8");

    fs.appendFileSync(backendPath, "tampered");
    const tampered = runChecker();
    assert.strictEqual(tampered.status, 1, JSON.stringify(tampered.output, null, 2));
    const backendCheck = tampered.output.checks.find((check) => check.name === "packaged backend checksum");
    assert.strictEqual(backendCheck.ok, false);
    assert.match(backendCheck.detail, /checksum or manifest does not match executable/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

run("localization checker scans SafeModeReview and gates uncovered literals", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "check-localization.cjs"), "utf8");
  assert.ok(source.includes("SafeModeReview.tsx"));
  assert.ok(source.includes('"../photoVideoSemanticPhrases": "photoVideoSemanticPhrases.ts"'));
  assert.ok(source.includes('"../photoAudioPhrases": "photoAudioPhrases.ts"'));
  assert.ok(source.includes("LANGUAGE_DIRECTIONS"));
  assert.ok(source.includes("RTL_TEXT_PATTERN"));
  assert.ok(source.includes("reverse-direction language coverage"));
  assert.ok(source.includes("reverse-direction literals ${language}"));
  assert.ok(source.includes("reverse-direction ui message isolation ${language}"));
  assert.ok(source.includes("VISIBLE_LITERAL_UNCOVERED_BASELINE"));
  assert.ok(source.includes("uncovered.length <= VISIBLE_LITERAL_UNCOVERED_BASELINE"));
  assert.ok(source.includes("VISIBLE_LITERAL_LANGUAGE_COVERAGE_FLOOR"));
  assert.ok(source.includes("visibleLiteralCoverage >= VISIBLE_LITERAL_LANGUAGE_COVERAGE_FLOOR"));
  assert.ok(source.includes("`visible literal coverage ${language}`"));
});

run("playwright config fails e2e flakes instead of retry-masking them", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "playwright.config.ts"), "utf8");
  assert.match(source, /retries:\s*0/);
  assert.doesNotMatch(source, /retries:\s*1/);
  assert.match(source, /trace:\s*"retain-on-failure"/);
  assert.match(source, /screenshot:\s*"only-on-failure"/);
  assert.match(source, /video:\s*"retain-on-failure"/);
});

console.log("\nall desktop script tests passed");

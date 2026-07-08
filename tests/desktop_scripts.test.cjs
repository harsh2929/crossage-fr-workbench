"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { resolveMcpbRunner, runMcpbStep } = require("../desktop/scripts/build-mcp-bundle.cjs");
const { isReleaseArtifactName, releaseArtifactFiles, checksumLines } = require("../desktop/scripts/create-release-artifacts.cjs");
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
      "latest-mac.yml",
      "vintrace-sbom.json",
      "vintrace-provenance.json",
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
    assert.strictEqual(isReleaseArtifactName("vintrace-provenance.json"), true);
    const artifactNames = releaseArtifactFiles(dist).map((file) => path.basename(file));
    assert.deepStrictEqual(artifactNames, [
      "latest-mac.yml",
      "Vintrace Setup 0.1.0.exe",
      "Vintrace-0.1.0-arm64.dmg",
      "Vintrace-0.1.0-mac.zip",
      "Vintrace-0.1.0-mac.zip.blockmap",
      "vintrace-provenance.json",
      "vintrace-sbom.json",
    ].sort((a, b) => a.localeCompare(b)));
    assert.deepStrictEqual(
      releaseArtifactFiles(dist, { includeMetadata: false }).map((file) => path.basename(file)),
      artifactNames.filter((name) => !name.startsWith("vintrace-"))
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

run("release workflows verify drafts before publishing", () => {
  const verifierSource = fs.readFileSync(path.join(__dirname, "..", "desktop", "scripts", "verify-release-assets.cjs"), "utf8");
  assert.ok(verifierSource.includes("allowDraft"));
  assert.ok(verifierSource.includes("--allow-draft"));
  assert.ok(verifierSource.includes("draft release accepted for staged verification"));
  assert.ok(verifierSource.includes("application/octet-stream"));
  assert.ok(verifierSource.includes("installer staged download is authenticated"));
  for (const workflow of ["windows-release.yml", "macos-release.yml"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", workflow), "utf8");
    assert.ok(source.includes("draft: true"), workflow);
    assert.ok(source.includes("--allow-draft"), workflow);
    assert.ok(source.includes("Verify staged release assets"), workflow);
    assert.ok(source.includes("Publish verified GitHub Release"), workflow);
    assert.ok(source.includes("actions/github-script@v7"), workflow);
  }
});

run("backend packaging gate verifies sidecar checksum manifest", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-package-check-"));
  const checkerSource = path.join(__dirname, "..", "desktop", "scripts", "check-package-artifacts.cjs");
  const checkerPath = path.join(fixture, "desktop", "scripts", "check-package-artifacts.cjs");
  const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
  const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");

  function runChecker() {
    const result = spawnSync(process.execPath, [checkerPath], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
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
    fs.mkdirSync(path.join(fixture, "desktop", "assets"), { recursive: true });
    fs.writeFileSync(path.join(fixture, "desktop", "main.cjs"), "");
    fs.writeFileSync(path.join(fixture, "desktop", "preload.cjs"), "");
    fs.writeFileSync(path.join(fixture, "desktop", "assets", "icon.png"), "");
    writeJson(path.join(fixture, "package.json"), {
      build: {
        productName: "Vintrace",
        appId: "com.vintrace.test",
        extraResources: [
          { to: "backend" },
          { to: "models/insightface" },
          { to: "mcp" },
        ],
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
    fs.writeFileSync(
      path.join(dist, "SHA256SUMS.txt"),
      Array.from(releaseArtifacts)
        .map(([name, body]) => `${digest(body)}  ${name}`)
        .join("\n") + "\n",
      "utf8"
    );
    writeJson(path.join(dist, "vintrace-sbom.json"), { packages: [] });
    writeJson(path.join(dist, "vintrace-provenance.json"), { artifacts: [] });

    const backendDist = path.join(fixture, "backend-dist");
    const backendRelative = "crossage-backend/crossage-backend";
    const backendPath = path.join(backendDist, backendRelative);
    const backendBody = "fake backend executable";
    fs.mkdirSync(path.dirname(backendPath), { recursive: true });
    fs.writeFileSync(backendPath, backendBody, "utf8");
    const backendDigest = digest(backendBody);
    fs.writeFileSync(path.join(backendDist, "crossage-backend.sha256"), `${backendDigest}  ${backendRelative}\n`, "utf8");
    writeJson(path.join(backendDist, "crossage-backend-manifest.json"), {
      executable: backendRelative,
      bytes: Buffer.byteLength(backendBody),
      sha256: backendDigest,
    });

    const clean = runChecker();
    assert.strictEqual(clean.status, 0, clean.stderr || JSON.stringify(clean.output, null, 2));
    assert.strictEqual(clean.output.checks.find((check) => check.name === "packaged backend checksum").ok, true);

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
  assert.ok(source.includes("VISIBLE_LITERAL_UNCOVERED_BASELINE"));
  assert.ok(source.includes("uncovered.length <= VISIBLE_LITERAL_UNCOVERED_BASELINE"));
  assert.ok(source.includes("VISIBLE_LITERAL_LANGUAGE_COVERAGE_FLOOR"));
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

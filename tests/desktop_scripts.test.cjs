"use strict";

const assert = require("assert");
const { resolveMcpbRunner, runMcpbStep } = require("../desktop/scripts/build-mcp-bundle.cjs");
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

console.log("\nall desktop script tests passed");

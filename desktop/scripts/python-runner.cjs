"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const WINDOWS_STORE_PYTHON_ALIAS_STATUSES = new Set([49, 9009]);

function pathApiForPlatform(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function isAbsoluteForPlatform(value, platform) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  return path.isAbsolute(text) || pathApiForPlatform(platform).isAbsolute(text);
}

function pythonCandidates(repoRoot, options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const explicit = env.PYTHON;
  const local = platform === "win32"
    ? path.join(repoRoot, ".venv", "Scripts", "python.exe")
    : path.join(repoRoot, ".venv", "bin", "python");
  return [
    explicit ? { command: explicit, source: "PYTHON", explicit: true } : null,
    { command: local, source: "local venv", explicit: false },
    { command: "python3", source: "python3", explicit: false },
    { command: "python", source: "python", explicit: false },
  ].filter(Boolean);
}

function pythonPath(repoRoot, env = process.env) {
  if (!env.PYTHONPATH) {
    return repoRoot;
  }
  return `${repoRoot}${path.delimiter}${env.PYTHONPATH}`;
}

function isWindowsPythonAliasResult(result, platform = process.platform) {
  return platform === "win32" && WINDOWS_STORE_PYTHON_ALIAS_STATUSES.has(Number(result && result.status));
}

function resultStatusText(result) {
  if (typeof result.status === "number") {
    return `exit code ${result.status}`;
  }
  if (result.signal) {
    return `signal ${result.signal}`;
  }
  return "unknown exit status";
}

function buildPythonEnv({ repoRoot, env = process.env, extraEnv = {} }) {
  return {
    ...env,
    ...extraEnv,
    PYTHONPATH: pythonPath(repoRoot, env),
    CROSSAGE_FORCE_FALLBACK: env.CROSSAGE_FORCE_FALLBACK || "1",
  };
}

function runFirstPython(options) {
  const {
    repoRoot,
    args,
    cwd = repoRoot,
    env = process.env,
    extraEnv = {},
    platform = process.platform,
    fsImpl = fs,
    spawnSyncImpl = spawnSync,
    stdio = "inherit",
    onWarning = () => {},
  } = options;
  const pythonEnv = buildPythonEnv({ repoRoot, env, extraEnv });

  for (const candidate of pythonCandidates(repoRoot, { env, platform })) {
    if (isAbsoluteForPlatform(candidate.command, platform) && !fsImpl.existsSync(candidate.command)) {
      if (candidate.explicit) {
        onWarning(`PYTHON points to missing interpreter '${candidate.command}'; trying the next Python candidate.`);
      }
      continue;
    }

    const probe = spawnSyncImpl(candidate.command, ["-c", "pass"], {
      cwd,
      env: pythonEnv,
      stdio: "ignore",
      windowsHide: true,
    });
    if (probe.error) {
      if (probe.error.code === "ENOENT") {
        continue;
      }
      onWarning(`Could not start ${candidate.source} interpreter '${candidate.command}': ${probe.error.message}`);
      return { ran: true, exitCode: 1, command: candidate.command };
    }
    if (isWindowsPythonAliasResult(probe, platform)) {
      onWarning(`Skipping Windows Store Python alias '${candidate.command}' after probe returned ${resultStatusText(probe)}.`);
      continue;
    }
    if (probe.status !== 0) {
      onWarning(`Skipping Python candidate '${candidate.command}' after probe returned ${resultStatusText(probe)}.`);
      continue;
    }

    const result = spawnSyncImpl(candidate.command, args, {
      cwd,
      env: pythonEnv,
      stdio,
      windowsHide: true,
    });
    if (result.error) {
      if (result.error.code === "ENOENT") {
        continue;
      }
      onWarning(`Could not start ${candidate.source} interpreter '${candidate.command}': ${result.error.message}`);
      return { ran: true, exitCode: 1, command: candidate.command };
    }
    if (isWindowsPythonAliasResult(result, platform)) {
      onWarning(`Skipping Windows Store Python alias '${candidate.command}' after run returned ${resultStatusText(result)}.`);
      continue;
    }
    return {
      ran: true,
      exitCode: result.status ?? 1,
      command: candidate.command,
    };
  }

  return { ran: false, exitCode: 127, command: "" };
}

module.exports = {
  buildPythonEnv,
  isAbsoluteForPlatform,
  isWindowsPythonAliasResult,
  pythonCandidates,
  pythonPath,
  resultStatusText,
  runFirstPython,
};

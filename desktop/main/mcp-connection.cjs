"use strict";

// Pure helpers for the "AI Agents (MCP)" settings surface. No Electron imports,
// so this is unit-testable in plain Node. main.cjs supplies the resolved paths
// (executable, appRoot, workspace) computed from its own spawn logic.

const path = require("path");

const SERVER_KEY = "vintrace";
const DEFAULT_HTTP_HOST = "127.0.0.1";
const DEFAULT_HTTP_PORT = 8765;

// Build the stdio command/args/env an agent must launch to talk to this
// workspace's MCP server. Mode is derived from the executable: the packaged
// PyInstaller sidecar ("crossage-backend") runs `--mcp`; a source checkout runs
// `python -m crossage_fr.mcp_server` and needs PYTHONPATH.
function mcpStdioInvocation({ executable, appRoot, workspace, httpTransport = false, host = DEFAULT_HTTP_HOST, port = DEFAULT_HTTP_PORT } = {}) {
  const command = String(executable || "");
  const isFrozen = path.basename(command).startsWith("crossage-backend");
  const ws = path.resolve(String(workspace || ""));
  const root = String(appRoot || "");
  const env = { VINTRACE_WORKSPACE: ws, CROSSAGE_WORKSPACE: ws };
  let args = isFrozen
    ? ["--mcp", "--workspace", ws]
    : ["-m", "crossage_fr.mcp_server", "--workspace", ws];
  if (!isFrozen) {
    env.PYTHONPATH = root;
  }
  if (httpTransport) {
    // The two entry points expose the HTTP flags under different names:
    // the packaged sidecar (api_server.py main) uses --mcp-transport/--mcp-host/
    // --mcp-port; the source module (crossage_fr.mcp_server __main__) uses
    // --transport/--host/--port. stdio (the copy-paste configs) needs none.
    args = isFrozen
      ? [...args, "--mcp-transport", "streamable-http", "--mcp-host", String(host), "--mcp-port", String(port)]
      : [...args, "--transport", "streamable-http", "--host", String(host), "--port", String(port)];
  }
  return { command, args, env, cwd: root, isFrozen, workspace: ws };
}

// Claude Code (.mcp.json) and Claude Desktop (claude_desktop_config.json) share
// the same mcpServers shape.
function jsonMcpConfig(invocation) {
  return JSON.stringify(
    {
      mcpServers: {
        [SERVER_KEY]: {
          type: "stdio",
          command: invocation.command,
          args: invocation.args,
          env: invocation.env,
        },
      },
    },
    null,
    2
  );
}

function tomlString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function tomlStringArray(values) {
  return `[${values.map(tomlString).join(", ")}]`;
}

// The Codex `[mcp_servers.vintrace]` block (config.toml).
function codexMcpConfig(invocation) {
  const lines = [
    `[mcp_servers.${SERVER_KEY}]`,
    `command = ${tomlString(invocation.command)}`,
    `args = ${tomlStringArray(invocation.args)}`,
    `cwd = ${tomlString(invocation.cwd)}`,
    "startup_timeout_sec = 20",
    "tool_timeout_sec = 600",
    "",
    `[mcp_servers.${SERVER_KEY}.env]`,
    ...Object.entries(invocation.env).map(([key, val]) => `${key} = ${tomlString(val)}`),
  ];
  return lines.join("\n");
}

// Remove any existing vintrace tables from a Codex config.toml so we can upsert
// a fresh block without duplicating it. A TOML table runs from its `[header]`
// line until the next top-level `[` header or EOF.
function stripCodexVintraceSections(toml) {
  const lines = String(toml || "").split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      const name = header[1].trim();
      skipping = name === `mcp_servers.${SERVER_KEY}` || name === `mcp_servers.${SERVER_KEY}.env`;
    }
    if (!skipping) {
      out.push(line);
    }
  }
  return out.join("\n");
}

// Produce the full updated config.toml text: strip any prior vintrace tables,
// then append the fresh block.
function upsertCodexConfig(existingToml, invocation) {
  const stripped = stripCodexVintraceSections(existingToml).replace(/\s*$/, "");
  const block = codexMcpConfig(invocation);
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
}

// The full payload the renderer's "AI Agents" panel consumes.
function buildMcpConnectionInfo({ executable, appRoot, workspace, host = DEFAULT_HTTP_HOST, port = DEFAULT_HTTP_PORT } = {}) {
  const stdio = mcpStdioInvocation({ executable, appRoot, workspace });
  const jsonConfig = jsonMcpConfig(stdio);
  return {
    mode: stdio.isFrozen ? "packaged" : "source",
    workspace: stdio.workspace,
    command: stdio.command,
    args: stdio.args,
    env: stdio.env,
    httpUrl: `http://${host}:${port}/mcp`,
    httpHost: host,
    httpPort: port,
    configs: {
      claudeCode: jsonConfig,
      claudeDesktop: jsonConfig,
      codex: codexMcpConfig(stdio),
    },
  };
}

module.exports = {
  SERVER_KEY,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
  mcpStdioInvocation,
  jsonMcpConfig,
  codexMcpConfig,
  stripCodexVintraceSections,
  upsertCodexConfig,
  buildMcpConnectionInfo,
};

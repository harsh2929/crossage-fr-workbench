"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  mcpStdioInvocation,
  jsonMcpConfig,
  codexMcpConfig,
  stripCodexVintraceSections,
  upsertCodexConfig,
  buildMcpConnectionInfo,
} = require("../desktop/main/mcp-connection.cjs");

// --- Source (dev) mode: python -m crossage_fr.mcp_server + PYTHONPATH ---
{
  const inv = mcpStdioInvocation({
    executable: "/repo/.venv/bin/python",
    appRoot: "/repo",
    workspace: "/data/ws",
  });
  assert.strictEqual(inv.isFrozen, false);
  assert.deepStrictEqual(inv.args, ["-m", "crossage_fr.mcp_server", "--workspace", "/data/ws", "--tool-profile", "images"]);
  assert.strictEqual(inv.env.PYTHONPATH, "/repo");
  assert.strictEqual(inv.env.VINTRACE_WORKSPACE, "/data/ws");
  assert.strictEqual(inv.env.CROSSAGE_WORKSPACE, "/data/ws");
  assert.strictEqual(inv.env.VINTRACE_MCP_ALLOWED_ROOTS, "/data/ws");
  assert.strictEqual(inv.env.VINTRACE_REQUIRE_DB_ENCRYPTION, "1");
  assert.strictEqual(inv.env.VINTRACE_WORKSPACE_DB_KEY, undefined, "generated config must not expose the database key");
  assert.strictEqual(inv.env.VINTRACE_DB_RECOVERY_PASSPHRASE, undefined, "generated config must not expose the recovery code");
}

// --- Packaged mode: crossage-backend --mcp, no PYTHONPATH ---
{
  const inv = mcpStdioInvocation({
    executable: "/Applications/Vintrace.app/.../crossage-backend",
    appRoot: "/Applications/Vintrace.app/Contents/Resources",
    workspace: "/data/ws",
  });
  assert.strictEqual(inv.isFrozen, true);
  assert.deepStrictEqual(inv.args, ["--mcp", "--workspace", "/data/ws", "--mcp-tool-profile", "images"]);
  assert.strictEqual(inv.env.PYTHONPATH, undefined, "packaged sidecar must not carry PYTHONPATH");
}

// --- HTTP transport: SOURCE entry (crossage_fr.mcp_server __main__) uses the
//     bare --transport/--host/--port flags. ---
{
  const inv = mcpStdioInvocation({
    executable: "/repo/.venv/bin/python",
    appRoot: "/repo",
    workspace: "/data/ws",
    httpTransport: true,
    host: "127.0.0.1",
    port: 8765,
  });
  assert.deepStrictEqual(inv.args.slice(-6), [
    "--transport", "streamable-http", "--host", "127.0.0.1", "--port", "8765",
  ]);
}

// --- HTTP transport: PACKAGED entry (api_server.py main) uses the --mcp- flags. ---
{
  const inv = mcpStdioInvocation({
    executable: "/app/crossage-backend",
    appRoot: "/app/res",
    workspace: "/data/ws",
    httpTransport: true,
    host: "127.0.0.1",
    port: 8765,
  });
  assert.deepStrictEqual(inv.args, [
    "--mcp", "--workspace", "/data/ws", "--mcp-tool-profile", "images",
    "--mcp-transport", "streamable-http", "--mcp-host", "127.0.0.1", "--mcp-port", "8765",
  ]);
}

// --- JSON config is valid and substitutes real paths (no placeholders) ---
{
  const inv = mcpStdioInvocation({ executable: "/repo/.venv/bin/python", appRoot: "/repo", workspace: "/data/ws" });
  const json = jsonMcpConfig(inv);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.mcpServers.vintrace.type, "stdio");
  assert.strictEqual(parsed.mcpServers.vintrace.command, "/repo/.venv/bin/python");
  assert.ok(!json.includes("/absolute/path/to/"), "must not contain example placeholders");
  assert.strictEqual(parsed.mcpServers.vintrace.env.VINTRACE_WORKSPACE, "/data/ws");
  assert.strictEqual(parsed.mcpServers.vintrace.env.VINTRACE_MCP_ALLOWED_ROOTS, "/data/ws");
  assert.strictEqual(parsed.mcpServers.vintrace.env.VINTRACE_REQUIRE_DB_ENCRYPTION, "1");
  assert.ok(!json.includes("VINTRACE_WORKSPACE_DB_KEY"));
  assert.ok(!json.includes("VINTRACE_DB_RECOVERY_PASSPHRASE"));
}

// --- Codex TOML config renders the expected tables ---
{
  const inv = mcpStdioInvocation({ executable: "/repo/.venv/bin/python", appRoot: "/repo", workspace: "/data/ws" });
  const toml = codexMcpConfig(inv);
  assert.ok(toml.includes("[mcp_servers.vintrace]"));
  assert.ok(toml.includes("[mcp_servers.vintrace.env]"));
  assert.ok(toml.includes("[mcp_servers.vintrace.tools.get_image_preview]"));
  assert.ok(toml.includes("[mcp_servers.vintrace.tools.run_destructive_image_action]"));
  assert.ok(toml.includes('default_tools_approval_mode = "writes"'));
  assert.strictEqual((toml.match(/approval_mode = "prompt"/g) || []).length, 2);
  assert.ok(toml.includes('args = ["-m", "crossage_fr.mcp_server", "--workspace", "/data/ws", "--tool-profile", "images"]'));
  assert.ok(toml.includes('default_tools_approval_mode = "writes"'));
  assert.ok(toml.includes("[mcp_servers.vintrace.tools.get_image_preview]"));
  assert.ok(toml.includes("[mcp_servers.vintrace.tools.run_destructive_image_action]"));
  assert.ok(!toml.includes("/absolute/path/to/"));
}

// --- Codex TOML escaping of paths with quotes/backslashes (Windows-ish) ---
{
  const inv = mcpStdioInvocation({ executable: "C:\\face\\python.exe", appRoot: "C:\\face", workspace: "C:\\ws" });
  const toml = codexMcpConfig(inv);
  assert.ok(toml.includes('command = "C:\\\\face\\\\python.exe"'), toml);
}

// --- Upsert: append when absent, replace when present, preserve other tables ---
{
  const inv = mcpStdioInvocation({ executable: "/repo/.venv/bin/python", appRoot: "/repo", workspace: "/data/ws" });

  // Absent -> appended, other content preserved.
  const base = "[other]\nfoo = 1\n";
  const appended = upsertCodexConfig(base, inv);
  assert.ok(appended.includes("[other]"), "must preserve unrelated tables");
  assert.ok(appended.includes("[mcp_servers.vintrace]"));
  // Exactly one vintrace table header.
  assert.strictEqual((appended.match(/\[mcp_servers\.vintrace\]/g) || []).length, 1);

  // Present -> replaced (no duplication), and the workspace updates.
  const stale = "[mcp_servers.vintrace]\ncommand = \"OLD\"\nargs = []\n\n[mcp_servers.vintrace.env]\nPYTHONPATH = \"OLD\"\n\n[mcp_servers.vintrace.tools.get_image_preview]\napproval_mode = \"never\"\n\n[keepme]\nx = 2\n";
  const replaced = upsertCodexConfig(stale, inv);
  assert.strictEqual((replaced.match(/\[mcp_servers\.vintrace\]/g) || []).length, 1, "must not duplicate the table");
  assert.ok(!replaced.includes('"OLD"'), "stale values must be removed");
  assert.ok(!replaced.includes('approval_mode = "never"'), "stale nested tool settings must be removed");
  assert.ok(replaced.includes("[keepme]"), "unrelated tables after vintrace must be preserved");
  assert.ok(replaced.includes("/data/ws"));
}

// --- stripCodexVintraceSections keeps unrelated tables intact ---
{
  const input = "[a]\nx=1\n[mcp_servers.vintrace]\ny=2\n[mcp_servers.vintrace.env]\nX=1\n[mcp_servers.vintrace.tools.get_image_preview]\napproval_mode=\"never\"\n[mcp_servers.other]\nz=3\n";
  const out = stripCodexVintraceSections(input);
  assert.ok(out.includes("[a]"));
  assert.ok(out.includes("[mcp_servers.other]"), "a different mcp server must survive");
  assert.ok(!out.includes("[mcp_servers.vintrace]"));
  assert.ok(!out.includes("mcp_servers.vintrace."), "all nested vintrace tables must be stripped");
}

// --- Full connection-info payload shape ---
{
  const info = buildMcpConnectionInfo({ executable: "/repo/.venv/bin/python", appRoot: "/repo", workspace: "/data/ws" });
  assert.strictEqual(info.mode, "source");
  assert.strictEqual(info.workspace, "/data/ws");
  assert.strictEqual(info.httpUrl, "http://127.0.0.1:8765/mcp");
  assert.strictEqual(info.agentApiUrl, "http://127.0.0.1:8765/v1");
  assert.strictEqual(info.agentApiUrl, "http://127.0.0.1:8765/v1");
  assert.ok(info.configs.claudeCode && info.configs.claudeDesktop && info.configs.codex);
  assert.strictEqual(info.configs.claudeCode, info.configs.claudeDesktop, "Claude Code and Desktop share the JSON shape");

  const packaged = buildMcpConnectionInfo({ executable: "/app/crossage-backend", appRoot: "/app/res", workspace: "/data/ws" });
  assert.strictEqual(packaged.mode, "packaged");
  assert.ok(!packaged.configs.claudeCode.includes("PYTHONPATH"));
}

// --- MCPB obtains recovery through host-keychain sensitive user config. ---
{
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "mcp", "manifest.json"), "utf8"));
  assert.strictEqual(manifest.user_config.recovery_passphrase.sensitive, true);
  assert.strictEqual(manifest.user_config.recovery_passphrase.required, true);
  assert.strictEqual(
    manifest.server.mcp_config.env.VINTRACE_DB_RECOVERY_PASSPHRASE,
    "${user_config.recovery_passphrase}",
  );
  assert.strictEqual(manifest.server.mcp_config.env.VINTRACE_REQUIRE_DB_ENCRYPTION, "1");
}

console.log("mcp connection helper ok");

# AI Agents (MCP) — In-App Connection Surface

**Date:** 2026-07-04
**Status:** Approved — implementing.
**Problem:** The MCP server (agents like Claude Code / Claude Desktop / Codex connecting to Vintrace) has **zero UI presence** (0 references in `src/`). Today a user connects only via CLI (`npm run mcp`) or by hand-copying an example config and manually replacing placeholders (`/absolute/path/to/face`, `/absolute/path/to/vintrace-workspace`). The app already knows those paths, so it can auto-fill them.

## Goal
Add a **Settings → "AI Agents"** section that (a) explains the consent-gated, review-first agent integration, (b) hands the user **copy-paste-ready, auto-filled** config for each supported agent, and (c) offers **one-click actions** including a managed local HTTP server. Works in both a **packaged** app (points agents at the shipped `crossage-backend --mcp` sidecar) and a **source** checkout (`.venv python -m crossage_fr.mcp_server`).

## Key facts established
- PyInstaller entry is `crossage_fr/api_server.py`; its `main()` supports `--mcp --mcp-transport {stdio,streamable-http} --mcp-host --mcp-port --workspace`. So the **packaged sidecar can run as the MCP server** — auto-fill is viable in both modes.
- Settings already has sectioned nav: `SettingsSection = "general" | "engine" | "privacy" | "storage" | "advanced"` in `src/shell/navModel.ts`.
- `state.workspace` is available in the renderer; main knows the backend executable via its spawn logic (`findPythonExecutable()` / `appRoot()`).
- Templates live in `mcp/`: `claude-code.mcp.example.json`, `claude-desktop-config.example.json`, `codex-config.example.toml`, plus the `.mcpb` bundle (`build-mcp-bundle.cjs`) and `codex-install.sh`.
- MCP is primarily **stdio** (agent spawns the server per-session), so there is no persistent stdio "connection" to monitor — the value is *setup*, not status. The **HTTP** transport is the exception (a server the app can run and show a URL for).

## Architecture / data flow
```
Renderer (App.tsx, "AI Agents" panel)
  └─ window.crossAge.getMcpConnectionInfo()  ──▶ main.cjs
        main computes: mode (packaged/source), backend command+args, workspace,
        PYTHONPATH, HTTP host/port, bundle presence, http-running flag
        main renders each agent's config string with real values substituted
     ◀── { mode, workspace, command, args, env, configs:{claudeCode,claudeDesktop,codex}, httpUrl, httpRunning, bundlePath, canBuildBundle }
  └─ actions ──▶ main.cjs IPC:
        addMcpToCodex()          → backup ~/.codex/config.toml then upsert [mcp_servers.vintrace]
        revealMcpConfigs()       → open mcp/ folder
        buildOrRevealMcpBundle() → reveal shipped .mcpb, or build then reveal (source + toolchain)
        startMcpHttpServer()/stopMcpHttpServer() → manage a 127.0.0.1 MCP HTTP subprocess
        getMcpHttpStatus()       → { running, url }
```
Copy-to-clipboard is renderer-side (`navigator.clipboard.writeText`), consistent with a sandboxed renderer.

## Components
1. **navModel.ts** — add `"agents"` to `SettingsSection` (+ any section label/order map).
2. **main.cjs** — a small `mcp-connection` helper module of pure functions (build command/args/env + render each config from the real paths) so it is unit-testable, plus IPC handlers for the actions above. HTTP server managed as a tracked child process (start/stop/exit → status broadcast), never passing `--allow-remote-mcp-http` (localhost-only).
3. **preload.cjs** — expose `getMcpConnectionInfo`, `addMcpToCodex`, `revealMcpConfigs`, `buildOrRevealMcpBundle`, `startMcpHttpServer`, `stopMcpHttpServer`, `getMcpHttpStatus`, and an `onMcpHttpStatus` event; add channels to the preload allowlist.
4. **types.ts** — `McpConnectionInfo`, `McpAgentConfig`, `McpHttpStatus`, action-result types.
5. **App.tsx** — the "AI Agents" settings panel: explainer + workspace/mode header; three config cards (Claude Code / Claude Desktop / Codex) each with a Copy button; the actions (Add to Codex w/ confirm, Bundle reveal/build, Reveal configs); the HTTP Start/Stop toggle with URL + status; a consent/security note. State loaded via `getMcpConnectionInfo` on entering the section; refreshed on workspace change.

## Behavior details
- **Mode-aware config:** packaged → `{command:<sidecar>, args:["--mcp","--workspace",<ws>]}` (no PYTHONPATH); source → `{command:<venv python>, args:["-m","crossage_fr.mcp_server","--workspace",<ws>], env:{PYTHONPATH:<repo>}}`. Both set `VINTRACE_WORKSPACE`/`CROSSAGE_WORKSPACE`.
- **Add to Codex:** read `~/.codex/config.toml` (create dir if missing), copy it to `config.toml.vintrace-backup-<ts>` if it exists, then upsert the `[mcp_servers.vintrace]` block; confirm via dialog first; return the written path.
- **Bundle:** if a `*.mcpb` is shipped/known, "Reveal"; else if source + `mcpb`/npx available, "Build" (`build-mcp-bundle.cjs`) then reveal. If neither, hide the action with an explanatory note.
- **HTTP server:** Start spawns the MCP server in streamable-http mode (workspace = active), tracked like the JSON-RPC backend; Stop kills it; status is broadcast to the renderer. Port fixed at 8765; if busy, surface the spawn error.
  - **Runtime finding (fixed):** the two entry points expose the HTTP flags under *different* names — the packaged sidecar (`api_server.py` main) uses `--mcp-transport/--mcp-host/--mcp-port`, but the source module (`crossage_fr.mcp_server` `__main__`) uses `--transport/--host/--port`. The invocation builder is mode-aware. (stdio configs use no transport flags, so they were unaffected.)
  - **Runtime finding (fixed):** the streamable-http transport **fails closed without an auth token** (`VINTRACE_MCP_TOKEN`) — clients must present it as `Authorization: Bearer <token>`. Start now generates a fresh per-session token, passes it in the child env, and surfaces it (with a copy button) in the panel. Localhost-only (never `--allow-remote-http`).
  - Both findings were caught by actually spawning the server and probing the port during verification — not by static/unit checks.

## Security
- HTTP server is localhost-only; the app never passes `--allow-remote-mcp-http`.
- "Add to Codex" writes outside the workspace — gated by an explicit confirm and a timestamped backup of the prior file.
- All new IPC channels pass through the preload command allowlist (consistent with the audit's stringly-typed-contract note).
- Agent capabilities remain consent-gated and destructive ops require `confirm=true` — surfaced in the panel copy, not re-implemented.

## Testing
- Unit-test the pure config-generation helper (`main.cjs` mcp-connection module): packaged vs source produce the expected command/args/env and valid JSON/TOML with the real paths substituted; add to `tests/main_util.test.cjs` or a new `tests/mcp_connection.test.cjs`.
- `tsc --noEmit` + `vite build` stay green; `node --check` the edited CJS; run the existing suites that touch preload/settings.
- Manual: open Settings → AI Agents, copy each config, toggle the HTTP server, run "Add to Codex" against a temp `CODEX_HOME`.

## Out of scope (v1)
- Live stdio connection status (not observable for agent-spawned stdio servers).
- Editing the MCP tool allow-list / per-tool toggles.
- Remote (non-localhost) HTTP exposure.

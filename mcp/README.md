# MCP Agent Integration

CrossAge FR Workbench exposes a local MCP server for Codex, Claude Desktop, Claude Code, and other MCP-compatible agents.

## Capabilities

- Resources: `crossage://state`, `crossage://summary`, `crossage://references`, `crossage://candidates`, `crossage://config`, `crossage://audit`, `crossage://agent-guide`, and `crossage://report`.
- Tools: workspace switching, consent marking, reference enrollment, multi-age enrollment, image/video folder and path scanning with progress, scan preflight, video probing, Safe Mode image assessment, workspace health, review decisions, bulk review, candidate notes, audit/export actions, reviewed-candidate purge, duplicate cleanup, person/reference deletion, queue/reference clearing, and settings updates.
- Prompts: pending-candidate triage, multi-age enrollment planning, and Safe Mode policy.

## Run From Source

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements-production.txt
npm run mcp -- --workspace /path/to/crossage-workspace
```

Streamable HTTP is available for local agent SDK clients:

```bash
npm run mcp:http -- --workspace /path/to/crossage-workspace --host 127.0.0.1 --port 8765
```

HTTP stays localhost-only unless `--allow-remote-http` is explicitly passed.

## Codex

Install into the local Codex MCP configuration:

```bash
./mcp/codex-install.sh /path/to/crossage-workspace
```

Or copy `mcp/codex-config.example.toml` into `~/.codex/config.toml` or a trusted project `.codex/config.toml`.

## Claude Desktop

For source-tree development, adapt `mcp/claude-desktop-config.example.json` in Claude Desktop's developer settings.

For a one-click desktop extension, build a platform-specific MCPB bundle:

```bash
npm run mcp:bundle
```

The generated `.mcpb` lands in `dist/` and uses the same PyInstaller backend sidecar as the desktop app. Build it on macOS for a macOS bundle and on Windows for a Windows bundle.

## Claude Code

Use the same stdio server with Claude Code:

```bash
claude mcp add --transport stdio --env PYTHONPATH=/Users/harshbishnoi/face crossage-fr -- /Users/harshbishnoi/face/.venv/bin/python -m crossage_fr.mcp_server --workspace /path/to/crossage-workspace
```

Or adapt `mcp/claude-code.mcp.example.json` as a project-scoped `.mcp.json`.

## Safety Model

Enrollment and scanning are consent-gated. Safe Mode stays enabled by default and uses the same local ONNX safety model as the desktop app when `models/safety` is bundled. Protected files are excluded before thumbnails, matching, clustering, MCP responses, and exports. Review decisions and destructive actions require explicit `confirm=true` arguments so an agent cannot silently accept, reject, or delete data.

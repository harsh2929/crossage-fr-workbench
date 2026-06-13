# MCP Agent Integration

Vintrace exposes a local MCP server for Codex, Claude Desktop, Claude Code, and other MCP-compatible agents.

## Capabilities

- Resources: `vintrace://state`, `vintrace://summary`, `vintrace://references`, `vintrace://candidates`, `vintrace://config`, `vintrace://audit`, `vintrace://agent-guide`, and `vintrace://report`.
- Tools: workspace switching, consent marking, reference enrollment, multi-age enrollment, image/video folder and path scanning with progress, scan preflight, video probing, Safe Mode image assessment, workspace health, reference-gap checks, review decisions, bulk review, candidate notes, audit/export actions, consent receipts, retention reports, Safe Mode audits, model-drift checks, review ledgers, public dataset benchmark inspection/runs, reviewed-candidate purge, duplicate cleanup, person/reference deletion, queue/reference clearing, and settings updates.
- Prompts: pending-candidate triage, multi-age enrollment planning, and Safe Mode policy.

## Run From Source

```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r requirements-production.txt
npm run mcp -- --workspace /path/to/vintrace-workspace
```

Streamable HTTP is available for local agent SDK clients:

```bash
npm run mcp:http -- --workspace /path/to/vintrace-workspace --host 127.0.0.1 --port 8765
```

HTTP stays localhost-only unless `--allow-remote-http` is explicitly passed.

## Codex

Install into the local Codex MCP configuration:

```bash
./mcp/codex-install.sh /path/to/vintrace-workspace
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
claude mcp add --transport stdio --env PYTHONPATH=/absolute/path/to/face vintrace -- /absolute/path/to/face/.venv/bin/python -m crossage_fr.mcp_server --workspace /absolute/path/to/vintrace-workspace
```

Or adapt `mcp/claude-code.mcp.example.json` as a project-scoped `.mcp.json`.

## Safety Model

Enrollment and scanning are consent-gated. Safe Mode stays enabled by default and uses the same local ONNX safety model as the desktop app when `models/safety` is bundled. Protected files are excluded before thumbnails, matching, clustering, MCP responses, and exports. Review decisions and destructive actions require explicit `confirm=true` arguments so an agent cannot silently accept, reject, or delete data.

## Public Dataset Benchmarks

Agents can call `public_dataset_catalog` to list supported benchmark datasets, `inspect_public_dataset` to verify a local identity-folder layout, `run_public_dataset_benchmark` to run an isolated benchmark workspace, and `compare_public_dataset_models` to compare installed model packs on the same benchmark slice. `apply_model_recommendation` can then apply the benchmark-recommended pack and backfill saved references after explicit confirmation. The benchmark flow writes JSON/CSV labels and aggregate metrics without training on public images or importing them into the user's saved people.

LFW can be prepared through scikit-learn and CFP can be prepared from the official checksum-validated archive only when the tool call uses `confirm=true`; larger datasets such as VGGFace2, AgeDB, YouTube Faces, and FIW must be supplied as local folders obtained under their own terms.

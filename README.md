# CrossAge FR Workbench

A Mac/Windows desktop workbench based on `report.md`. The app is now an Electron + React + TypeScript frontend with a Python backend for ingestion, enrollment, matching, clustering, review decisions, and audit logging.

The product stance from the report is preserved: cross-age recognition is review-first and consent-gated. It is not an autonomous identification system.

## Run The Desktop App

```bash
npm install
npm run start
```

Backend startup check:

```bash
python3 main.py --check
```

Backend JSON-lines mode for Electron:

```bash
python3 main.py --backend
```

MCP mode for AI agents:

```bash
python3 main.py --mcp --workspace /path/to/crossage-workspace
```

## Production Dependencies

The app runs immediately with the local fallback engine. For the full runtime stack from the report:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-production.txt
```

On Apple Silicon, use mainline `onnxruntime` with CoreML EP. Do not use `onnxruntime-silicon`.

For installer or MCPB builds, install build dependencies as well:

```bash
.venv/bin/pip install -r requirements-build.txt
```

## Image Formats

The ingest pipeline accepts common desktop, web, Apple, animated, and camera formats: JPEG/JFIF, PNG/APNG, GIF, WebP, AVIF, HEIC/HEIF/HIF, BMP/DIB, TIFF, ICO/ICNS, JPEG 2000, Netpbm, TGA, DDS, PSD, DNG, and major camera RAW extensions. Multi-frame images use a representative frame for matching, EXIF orientation is applied before analysis, and transparent images are composited to RGB for a stable pipeline.

## Packaging

Signed Mac installer:

```bash
npm run dist:mac
```

Unsigned Mac package for local QA:

```bash
npm run dist:mac:unsigned
```

Windows installer, run on Windows so PyInstaller emits the Windows backend sidecar:

```bash
npm run dist:win
```

Installer builds compile the React app, build the Python backend sidecar with PyInstaller, and package with electron-builder.
Public macOS releases must be signed and notarized with the Apple Developer credentials configured in the build environment.

Windows release artifact:

- From a Windows machine: install Node 24 and Python 3.11, then run `npm ci`, `python -m pip install -r requirements-production.txt`, and `npm run dist:win`. Share the generated NSIS `.exe` from `dist/`.
- From GitHub Actions: run the `Windows Release` workflow manually. It builds the Windows backend sidecar, runs backend smoke tests, packages the NSIS installer, smoke-tests the packaged backend, and uploads `CrossAge-FR-Windows-Installer`.
- The Windows installer is unsigned unless a code-signing certificate is configured, so Windows SmartScreen may warn first-time recipients.

First-run face model setup is now handled inside the desktop app. The DMG/EXE can be shared without pre-installing Python, npm, or InsightFace models. On first launch, the app shows a Face model card that lets the user choose a writable download folder, pick the model package, download with progress, validate the pinned SHA-256 checksum, extract safely, and retry with clear offline messaging. If the user is offline, the app opens in simple matching mode and keeps the download action available.

Claude Desktop MCPB bundle, built for the current platform:

```bash
npm run mcp:bundle
```

This creates `dist/CrossAge-FR-Workbench-<platform>-<arch>.mcpb`.

## MCP / Agent Native Surface

The app includes a local MCP server for Codex, Claude Desktop, Claude Code, OpenAI Agents SDK clients, and other MCP-compatible agents.

```bash
npm run mcp -- --workspace /path/to/crossage-workspace
```

Agent capabilities include project-state resources, consent marking, multi-age enrollment, folder/path scanning with progress, Safe Mode assessment, review queue actions, settings updates, audit context, and workflow prompts. Destructive or review-decision tools require `confirm=true`, and enrollment/scanning still require consent.

The desktop app and MCP server share an active-workspace registry. When MCP is launched without an explicit `--workspace`, it uses the last active desktop workspace when available. Each workspace also carries `.crossage-workspace.json`, durable consent metadata, and an append-only audit log.

Codex setup:

```bash
./mcp/codex-install.sh /path/to/crossage-workspace
```

Claude setup:

- Use `mcp/claude-desktop-config.example.json` for a source-tree stdio server.
- Use `npm run mcp:bundle` for a one-click `.mcpb` desktop extension.

See `mcp/README.md` for the full tool/resource/prompt inventory and configuration examples.

## Safe Mode ML Model

Safe Mode now uses a local ONNX intimate-image classifier when a model is available, with the existing exposed-skin heuristic kept as a conservative fallback guard. The gate runs before thumbnails, face matching, clustering, MCP exposure, and exports.

- Installed local model: `models/safety/adamcodd_vit_base_nsfw_int8.onnx`
- Model source: `AdamCodd/vit-base-nsfw-detector`
- License: Apache-2.0
- Runtime: ONNX Runtime provider fallback through CoreML/CUDA/TensorRT/DirectML/OpenVINO/CPU where available.

The research recommendation in `res.md` prefers `Marqo/nsfw-image-detection-384` as the final default because it is smaller and permissively licensed. Marqo does not ship a ready ONNX file, so the app supports it as a drop-in export: add a `marqo*.onnx` file and matching manifest under `models/safety/`, and it will be preferred over the ready-made fallback model.

## Face Model Downloads

The full face-matching pipeline uses local InsightFace ONNX model packs. The app never downloads these silently during backend startup. Instead, users explicitly install a model from Home or Settings:

- Recommended accuracy: `antelopev2.zip`, downloaded from the official InsightFace v0.7 GitHub release and validated with SHA-256 `8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5`.
- Balanced package: `buffalo_l.zip`, downloaded from the official InsightFace v0.7 GitHub release and validated with SHA-256 `80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f`.

The selected model root is stored in the local workspace config. Default downloads go under `~/.insightface`, while advanced users can choose an external drive or shared local model folder. Downloaded archives are checksum-verified before extraction, and extraction rejects unsafe archive paths.

If you need a fully offline installer, place an extracted pack at `models/insightface/models/<pack>/` before running `npm run dist:mac` or `npm run dist:win`; the packaged backend also checks bundled resources before asking the user to download.

## Test

```bash
npm run test
```

The MCP smoke test starts a real MCP stdio session, lists tools/resources/prompts, calls `get_project_state`, and verifies the bundled report resource. The E2E test launches Electron, creates image fixtures, enrolls references, scans candidates, verifies Safe Mode folder watching, accepts/rejects/marks uncertain review items, and validates settings.

## Notes

- `local-image-fingerprint` is a workflow fallback, not biometric face recognition.
- Real biometric use requires calibrated face embeddings, properly licensed weights, explicit consent, retention/deletion policy, and validation on labeled data.
- The packaged app stores workspace data under the Electron user-data directory unless a workspace is selected.

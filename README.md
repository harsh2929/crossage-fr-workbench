# Vintrace

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
python3 main.py --mcp --workspace /path/to/vintrace-workspace
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

In-app updates are wired through `electron-updater`. Settings shows update status, release channels (Stable, Beta, Internal), checks for a release, downloads with progress, and restarts into the installer only after the user chooses it. Production builds use the packaged GitHub Releases feed for `harsh2929/crossage-fr-workbench`; for QA or private release channels, launch/build with `VINTRACE_UPDATE_URL=https://your-update-feed.example/releases/` so the app reads generic feed metadata instead. The current local `dist:*` scripts keep `--publish never`, so they create installers without uploading anything.

Release checks:

```bash
npm run test:clean
npm run test:localization
npm run test:filesystem-chaos
npm run test:backup-roundtrip
npm run test:model-downloader
npm run test:perf-budget
npm run update:dry-run
npm run release:check
npm run release:verify -- --repo harsh2929/crossage-fr-workbench --tag v0.1.0 --platform win32
```

`release:check` aggregates runtime diagnostics, database integrity, storage I/O, model distribution metadata, clean-workspace boot, benchmark history, and update-feed dry-run validation into one JSON report. Use `docs/tester-checklist.md` for manual tester verification before broad sharing.

Release artifacts:

- From a Windows machine: install Node 24 and Python 3.11, then run `npm ci`, `python -m pip install -r requirements-production.txt`, and `npm run dist:win`. Share the generated NSIS `.exe` from `dist/`.
- From GitHub Actions: run the `Windows Release` workflow manually. It builds the Windows backend sidecar, runs backend smoke tests, packages the NSIS installer, smoke-tests the packaged backend, generates release metadata, and uploads `Vintrace-Windows-Installer`. To make in-app updates work for testers, provide `release_tag` such as `v0.1.0`; the workflow will attach the `.exe`, `.blockmap`, `latest*.yml`, `SHA256SUMS.txt`, `vintrace-sbom.json`, and `vintrace-provenance.json` assets to that GitHub Release.
- For Mac testers without signing credentials, run the `macOS Unsigned Release` workflow manually. It builds an unsigned DMG/ZIP pair, validates the packaged backend, generates release metadata, uploads `Vintrace-macOS-Unsigned`, and can attach `.dmg`, `.zip`, `.blockmap`, `latest*.yml`, `SHA256SUMS.txt`, `vintrace-sbom.json`, and `vintrace-provenance.json` assets to a GitHub Release when `release_tag` is provided.
- The Windows installer is unsigned unless a code-signing certificate is configured, so Windows SmartScreen may warn first-time recipients.
- The unsigned macOS DMG is for trusted testers only. Gatekeeper may require **Privacy & Security > Open Anyway**.
- `npm run release:artifacts` writes `dist/SHA256SUMS.txt`, `dist/vintrace-sbom.json`, and `dist/vintrace-provenance.json`. `npm run release:verify -- --require-release-metadata` checks those files on newly published releases.
- `npm run release:verify` checks published assets after release upload: installer/update metadata presence, public downloadability, sane asset size, release metadata when required, and SHA-256 digest matching when `--full` is passed.
- Before sharing broad test builds, run Settings -> Release readiness, Settings -> Machine benchmark, `npm run release:check`, and the tester checklist. These checks now include model license/checksum manifest status, SQLite database integrity, writable local storage, update-feed setup, crash diagnostics, benchmark history, and signing-environment detection. The checks intentionally stay red for code signing and model redistribution until real certificates and final license approvals are configured.

Additional CI gates cover the most common consumer-test failures:

- `npm run test:e2e:buttons` launches Electron and clicks every enabled non-destructive visible control across the main tabs.
- `npm run test:e2e:i18n` screenshots Dashboard, People, Scan, Review, and Settings in English, Chinese, Spanish, French, Arabic, Hindi, and Japanese, then checks primary controls for clipped text.
- `npm run test:e2e:ipc` fuzzes the renderer-to-main IPC boundary for blocked commands, bad payloads, oversized params, and untrusted shell paths.
- `npm run test:e2e:a11y` checks keyboard tab flow, primary tab activation, accessible control names, and modal focus trapping.
- `npm run test:e2e:soak` repeats core UI flows and fails on page errors, runaway DOM growth, or large Electron memory growth.
- `npm run test:filesystem-chaos` scans synthetic folders with Unicode paths, broken files, symlinks, nested content, and permission failures.
- `npm run test:backup-roundtrip` exports, verifies, restores, and reopens a synthetic workspace backup while rejecting unsafe ZIP entries.
- `npm run test:model-downloader` verifies offline failure, retry/resume, bad checksum recovery, and changed model folders without using real model downloads.
- `npm run test:perf-budget` enforces startup, dashboard state, review pagination, serialization, scan manifest, and runtime benchmark budgets on synthetic 100k-scale data.

First-run face model setup is now handled inside the desktop app. The DMG/EXE can be shared without pre-installing Python, npm, or InsightFace models. On first launch, the app shows a Face model card that lets the user choose a writable download folder, pick the model package, download with progress, validate the pinned SHA-256 checksum, extract safely, and retry with clear offline messaging. Partial `.part` downloads are preserved and resumed with HTTP range requests when the server supports them. If the user is offline, the app opens in simple matching mode and keeps the download action available.

Claude Desktop MCPB bundle, built for the current platform:

```bash
npm run mcp:bundle
```

This creates `dist/Vintrace-<platform>-<arch>.mcpb`.

## MCP / Agent Native Surface

The app includes a local MCP server for Codex, Claude Desktop, Claude Code, OpenAI Agents SDK clients, and other MCP-compatible agents.

```bash
npm run mcp -- --workspace /path/to/vintrace-workspace
```

Agent capabilities include project-state resources, consent marking, multi-age enrollment, folder/path scanning with progress, scan job pause/resume/status, preflight planning, Safe Mode assessment, review queue actions, accuracy evaluation, calibration application, media bundle export, consent receipts, retention reports, Safe Mode audits, model-drift checks, review ledger export, privacy reporting/deletion, settings updates, audit context, and workflow prompts. Destructive or review-decision tools require `confirm=true`, and enrollment/scanning still require consent.

The desktop app and MCP server share an active-workspace registry. When MCP is launched without an explicit `--workspace`, it uses the last active desktop workspace when available. Each workspace also carries `.vintrace-workspace.json`, durable consent metadata, and an append-only audit log.

Codex setup:

```bash
./mcp/codex-install.sh /path/to/vintrace-workspace
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

## Public Dataset Benchmarks

Settings -> Accuracy Lab includes a public-dataset benchmark runner for benchmark-only use. It supports LFW from the local scikit-learn fetcher, CFP from the official checksum-validated `cfp-dataset.zip`, and local folder copies of CALFW, CPLFW, VGGFace2, AgeDB, YouTube Faces, FIW, MegaFace, IJB-C, or a custom identity-folder dataset.

The runner is dataset-aware when local folders expose useful structure: CALFW and AgeDB are bucketed as cross-age checks, CPLFW and CFP prefer frontal references against profile/side candidates, YouTube Faces and IJB-C can include held-out videos when image references exist, FIW prioritizes family-lookalike distractors when the folder layout exposes family groups, and MegaFace-style local copies are treated as large-scale distractor stress tests.

The runner keeps these datasets isolated from the user's normal workspace. It creates a temporary benchmark workspace, enrolls a limited number of reference images per identity, scans held-out positives and optional distractor identities, writes JSON/CSV labels, restores the active workspace, and reports precision, recall, specificity, and accuracy. It does not train the model and does not add public-dataset people to the user's saved faces.

For local validation without downloading a real public dataset:

```bash
npm run test:dataset-benchmark
```

For agent-driven validation, use the MCP tools `public_dataset_catalog`, `inspect_public_dataset`, `run_public_dataset_benchmark`, and `compare_public_dataset_models`. LFW and CFP download/reuse require explicit confirmation, and all third-party datasets must be obtained and used under their own terms. Avoid retired or disputed datasets such as MS-Celeb-1M for product QA.

## Large Folder Scale

The scan pipeline is designed to work toward 100k-1M file folders without building one giant in-memory path list. Folder scans stream media paths, write a SQLite/WAL scan manifest at `workspace.sqlite3`, and can be cancelled from the UI. A resumed scan skips files already completed in the previous manifest when their path, size, and mtime match.

For local scale checks without using personal photos, run `npm run bench:scale`. It seeds a temporary synthetic 100k-row scan manifest, verifies low-spec Auto performance selection, runs the backend benchmark, and prints JSON with state serialization time, vector backend speed, effective performance mode, memory-pressure status, and workspace I/O throughput. Set `VINTRACE_SCALE_BENCH_FILES=1000000` to stress a million synthetic rows. Run `npm run bench:accuracy` for a synthetic precision/recall harness that exercises calibration math without loading any image dataset.

Safe Mode decisions are cached by file hash, model version, and threshold so repeated scans do not repeatedly score the same content. Accepted/rejected review decisions automatically build a local calibration label set, and Settings includes large-folder readiness, benchmark, and release-readiness panels.

Face scan detail is configurable for large libraries. The recommended default uses a 512px detector input for better throughput, High confidence uses 640px for maximum detection detail, and Custom mode accepts validated 320-1024 values in 32px steps. Optional two-pass scanning runs the first pass at the selected detail and rechecks only queued candidates at higher detail.

Repeated face detection work is cached by file hash, model name, and detector size. Scan controls support pause, resume, cancel, a first-class recovery card for interrupted scans, and resumable manifests. Folder checks include a pre-scan time estimate plus a scan plan with storage estimate, cache coverage, resumability, and warnings for 100k-1M scale folders. Review includes backend-paged browsing for large queues, video moment grouping, source-folder batches, confidence lanes, people-together lanes, identity move/split controls, repeated-false-match suppression, and calibration summaries from accepted/rejected decisions.

Duplicate review rows are suppressed by content hash when the same image appears under multiple names or folders, while video moments remain grouped by their source video. Settings includes an app-folder optimizer, broken-link repair, moved-folder relinking, source-folder inventory export, audit-log export, scan-manifest pruning, model integrity checks, backup verification/restore/pruning, support-bundle export, and a user-friendly storage limit. Cleanup clears regenerable preview cache, removes orphan extracted video frames, checkpoints/VACUUMs the SQLite scale database, and reports reclaimed space without touching original photos or videos.

Settings now includes an Accuracy Lab that turns accepted/rejected review decisions into local precision/recall metrics and can apply threshold feedback when enough positive and negative examples exist. Accuracy labels can be exported as JSON/CSV for external benchmarks, and agents can import labeled rows back into the calibration harness. The backend also exposes paged candidate queries so agents can inspect large review queues without pulling the entire candidate list into context. Save and clean up can export accepted media into a shareable manifest-backed folder plus a review decision ledger. Privacy controls report local face data, generated previews, caches, consent receipt status, Safe Mode audit totals, retention windows, and offer a confirmed delete-face-data operation that clears saved faces, candidates, scan manifests, generated media, and private caches. Model-drift checks flag saved references or review rows created with a different active face model. Error reports are local-first: the app records crashes, renderer hangs, backend errors, and updater failures into a local diagnostics log with stable error codes, categories, severity, fingerprints, and per-code summaries; users preview and export JSON manually, with file paths hidden unless explicitly included.

## Notes

- `local-image-fingerprint` is a workflow fallback, not biometric face recognition.
- Real biometric use requires calibrated face embeddings, properly licensed weights, explicit consent, retention/deletion policy, and validation on labeled data.
- The packaged app stores workspace data under the Electron user-data directory unless a workspace is selected.

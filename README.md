# Vintrace

A macOS, Windows, and Linux desktop workbench based on `report.md`. The app is now an Electron + React + TypeScript frontend with a Python backend for ingestion, enrollment, matching, clustering, review decisions, and audit logging.

The product stance from the report is preserved: cross-age recognition is review-first and consent-gated. It is not an autonomous identification system.

## July 2026 Audit Checkpoint

The July 7 full-stack audit checkpoint closed the confirmed Critical and High issues for the local-first photo workflow. The fixes focus on keeping 50k-100k photo libraries responsive and protecting user trust boundaries:

- Photo listings, folders, search, generated collections, duplicate summaries, timeline covers, and edit-stack lookups now avoid repeated whole-library work on hot read paths.
- Smart-album, people, pet, and scan/import bookkeeping now use indexed or dirty-flagged paths instead of repeated full scans.
- Semantic search, photo settings, album suggestions, utility folders, and generated folders are bounded by the requested page or targeted SQL probes.
- Photos UI coverage is enforced by the localization test gate, with fallback phrase/term translation for the redesigned Photos surface.
- Workspace state saves merge stale desktop/MCP writers instead of overwriting unrelated changes, and Safe Mode calibration changes invalidate cached safety decisions.
- EXIF capture-date parsing now reads nested `DateTimeOriginal` / `DateTimeDigitized` metadata before falling back.
- Desktop backend startup avoids duplicate Python backend spawns during backoff races, and stale child exits no longer reject unrelated pending requests.
- Camera scanning cleans up pending `getUserMedia` streams on unmount, and canceling a move destination no longer moves originals.

The checkpoint was verified with:

```bash
npm run test:localization
npm run test:photos-view
npm run build
PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_semantic_search_units.py
npm run test:photo-folders
npm run test:safe-mode-calibration
npm run test:main-util
npm run test:edge
git diff --check
```

The reconciled Medium backlog is currently zero. Remaining audit work is concentrated in strategic follow-up: continuing renderer decomposition, keeping foreground-heavy work on queued job paths, and tightening product-specific localization/parity polish. See `docs/2026-07-07-full-stack-audit-final.md` for the current remediation roadmap.

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
python3 main.py --mcp --workspace /path/to/vintrace-workspace --mcp-tool-profile images
```

## Native Photo Sources

Open **Library** and choose **Import photo library** in the Photos rail.

- On macOS, **Apple Photos** discovers the system and recently used libraries through the bundled, read-only `osxphotos 0.76.1` adapter.
- On Windows, **Photo folders** discovers Pictures, Camera Roll, Saved Pictures, and OneDrive Pictures without installing `osxphotos`. Any local folder can also be selected manually.
- On Linux, **Photo folders** imports from local folders and mounted volumes with portable EXIF/XMP metadata. Apple Photos is unavailable and `osxphotos` is not installed.
- Preview, import, sync, and selected Apple export run as persistent jobs with progress, cancellation, retry, and restart recovery.
- Referenced imports keep originals in place. Managed imports copy media and related RAW/Live Photo variants into the selected Vintrace library.
- People/faces, precise location, hidden/deleted items, sharing data, and comments/likes require explicit consent. Apple Photos and iCloud are never written to or contacted implicitly.

## Production Dependencies

The app runs immediately with the local fallback engine. For the full runtime stack from the report:

```bash
python3 -m venv .venv
.venv/bin/pip install --require-hashes -r requirements-production.lock.txt
```

The release baseline is Electron `43.1.0` and ONNX Runtime `1.27.0`. macOS
distribution supports Apple Silicon on macOS 14 or newer; ONNX Runtime 1.27 has
no macOS x64 wheel. Windows and Linux releases target x64; Linux uses the CPU
provider and an Ubuntu 22.04/glibc 2.35 build baseline. Use mainline
`onnxruntime` with CoreML EP where applicable and do not install
`onnxruntime-silicon`, GPU, OpenVINO, or training variants into the production
environment. Run `npm run test:dependency-currency` to verify the exact
Electron runtime tuple, native-module boundary, wheel hashes, providers, and
real ONNX inference. See [Dependency Currency and Native Runtime Contract](docs/dependency-currency.md).

For installer or MCPB builds, install build dependencies as well:

```bash
.venv/bin/pip install -r requirements-build.txt
```

## Image Formats

The ingest pipeline accepts common desktop, web, Apple, animated, and camera formats: JPEG/JFIF, PNG/APNG, GIF, WebP, AVIF, HEIC/HEIF/HIF, BMP/DIB, TIFF, ICO/ICNS, JPEG 2000, Netpbm, TGA, DDS, PSD, DNG, and major camera RAW extensions. Multi-frame images use a representative frame for matching, EXIF orientation is applied before analysis, and transparent images are composited to RGB for a stable pipeline.

## Packaging

Signed and notarized Mac installer (requires the configured Apple release credentials):

```bash
npm run dist:mac
```

Unsigned Mac package for local QA:

```bash
npm run dist:mac:unsigned
```

Azure-signed Windows installer, run on Windows after GitHub/Azure OIDC authentication and Artifact Signing configuration:

```bash
npm run dist:win
```

Linux x64 AppImage, deb, and RPM packages, run on Linux:

```bash
npm run dist:linux
VINTRACE_LINUX_PACKAGE_REQUIRED=1 npm run linux:package:check
```

Installer builds compile the React app, build the Python backend sidecar with PyInstaller, and package with electron-builder. macOS and Windows production packaging fails closed without native code signing. Linux has no equivalent publisher identity; its hosted workflow requires detached keyless cosign signatures and GitHub attestations before upload. See [Release Signing](docs/release-signing.md) and [Linux Distribution](docs/linux-distribution.md). Explicit unsigned scripts and local Linux packages are development outputs and are never represented as verified release artifacts.

In-app updates are wired through `electron-updater`. Settings shows update status, release channels (Stable, Beta, Internal), checks for a release, downloads with progress, verifies the signed `SHA256SUMS.txt` manifest plus the downloaded artifact SHA-256, and restarts into the installer only after the user chooses it. In-app updates are disabled unless explicitly enabled and a release public key is configured with `VINTRACE_RELEASE_PUBKEY` or `VINTRACE_RELEASE_PUBLIC_KEY`; for QA or private release channels, launch/build with `VINTRACE_UPDATE_URL=https://your-update-feed.example/releases/` so the app reads generic feed metadata instead. Production builds use the packaged GitHub Releases feed for `harsh2929/crossage-fr-workbench`. The current local `dist:*` scripts keep `--publish never`, so they create installers without uploading anything.

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

`release:check` aggregates runtime diagnostics, workspace-encryption status, database integrity, storage I/O, model distribution metadata, clean-workspace boot, benchmark history, update-feed dry-run validation, and self-learning R&D release posture into one JSON report. Use `docs/tester-checklist.md` for manual tester verification before broad sharing.

Release artifacts:

- From GitHub Actions: run the `Windows Release` workflow manually. GitHub OIDC authenticates to Azure Artifact Signing, electron-builder signs the app/backend/NSIS executables, and the workflow requires valid publisher and timestamp evidence before uploading `Vintrace-Windows-Signed-Azure`. A valid signature does not create instant SmartScreen reputation.
- Run the `macOS Release` workflow for a Developer ID signed, notarized, stapled, and Gatekeeper-assessed DMG/ZIP. The workflow uploads only `Vintrace-macOS-Signed-Notarized` after every platform check passes.
- Run the `Linux Release` workflow for x64 AppImage, deb, and RPM artifacts. It audits native package metadata and extracted payloads, runs frozen and packaged acceptance, and uploads only after checksum, SBOM, GitHub attestation, and keyless cosign verification. Linux packages are not natively publisher-signed or sandboxed.
- For local UI or packaging diagnosis only, `npm run dist:win:unsigned` and `npm run dist:mac:unsigned` explicitly disable the production signing policy. Never attach those outputs to a release.
- Provide `release_tag` such as `v0.1.0` to stage the installer, update metadata, checksums, standard SBOMs, signed provenance, Sigstore bundles, and platform MCPB in the GitHub Release.
- `npm run release:artifacts` uses exactly Syft 1.44.0 to write `dist/SHA256SUMS.txt`, CycloneDX 1.6 `dist/vintrace.cdx.json`, SPDX 2.3 `dist/vintrace.spdx.json`, and `dist/vintrace-build-metadata.json`. It scans only the npm and hashed production Python dependency manifests, not local environments or workspaces. When `VINTRACE_RELEASE_PRIVKEY` points to an Ed25519 private key, it also writes `dist/SHA256SUMS.txt.sig` for the in-app updater.
- GitHub-hosted release workflows use `actions/attest` for SLSA Build L2 provenance and both SBOM predicates, then use cosign 3.0.6 to keylessly sign every subject plus the checksum manifest. The package and staged-release gates fail unless exact workflow identity, OIDC issuer, source commit/ref, hosted runner, hashes, predicates, and bundles all verify. See [Release Supply-Chain Evidence](docs/release-supply-chain.md).
- `npm run release:verify` checks published assets after release upload: installer/update metadata presence, public downloadability, sane asset size, release metadata when required, and SHA-256 digest matching when `--full` is passed. Production workflows also pass `--verify-signatures` to cryptographically verify downloaded draft assets before publication.
- Before sharing broad test builds, run Settings -> Release readiness, Settings -> Machine benchmark, `npm run release:check`, and the tester checklist. These checks now include SQLCipher workspace encryption, model license/checksum manifest status, database integrity, writable local storage, update-feed setup, crash diagnostics, benchmark history, self-learning R&D posture, and signing-environment detection. The checks intentionally stay red for code signing, model redistribution, and true retraining authorization until real certificates, final license approvals, and external Phase 5/6 evidence are configured.

Additional CI gates cover the most common consumer-test failures:

- `npm run test:e2e:buttons` launches Electron and clicks every enabled non-destructive visible control across the main tabs.
- `npm run test:e2e:i18n` screenshots Dashboard, People, Scan, Review, and Settings in English, Chinese, Spanish, French, Arabic, Hindi, and Japanese, then checks primary controls for clipped text.
- `npm run test:e2e:ipc` fuzzes the renderer-to-main IPC boundary for blocked commands, bad payloads, oversized params, and untrusted shell paths.
- `npm run test:e2e:a11y` rebuilds the app, then checks keyboard/focus flow, accessible names and targets, automated WCAG A/AA rules, reduced motion, forced colors, true 400% zoom/reflow, plus synchronized captions and a keyboard-seekable video transcript. Manual screen-reader, voice-control, and caption-accuracy review remain release gates.
- `npm run test:e2e:soak` repeats core UI flows and fails on page errors, runaway DOM growth, or large Electron memory growth.
- `npm run test:filesystem-chaos` scans synthetic folders with Unicode paths, broken files, symlinks, nested content, and permission failures.
- `npm run test:backup-roundtrip` exports, verifies, restores, and reopens a synthetic workspace backup while rejecting unsafe ZIP entries.
- `npm run test:workspace-encryption` proves SQLCipher migration, OS-wrapped/recovery key custody, wrong-key refusal, encrypted biometric sidecars and backups, and crash-safe rotation. See [workspace encryption and recovery](docs/workspace-encryption.md).
- `npm run test:compliance-policy` and `npm run test:e2e:compliance` prove strict written-release, disclosure, publication, retention, and subject-erasure behavior. See the [biometric consent and retention operator guide](docs/biometric-consent-retention.md).
- `npm run test:model-downloader` verifies offline failure, retry/resume, bad checksum recovery, and changed model folders without using real model downloads.
- `npm run test:perf-budget` enforces startup, dashboard state, review pagination, serialization, scan manifest, and runtime benchmark budgets on synthetic 100k-scale data.
- `npm run test:photo-bundle-budget` checks the built Photos route, deferred feature chunks, initial preloads, route-owned CSS, and production source-map policy against the audited PHOTO-10 budgets.

First-run face model setup is now handled inside the desktop app. Packaged desktop installers can be shared without pre-installing Python, npm, or InsightFace models. On first launch, the app shows a Face model card that lets the user choose a writable download folder, pick the model package, download with progress, validate the pinned SHA-256 checksum, extract safely, and retry with clear offline messaging. Partial `.part` downloads are preserved and resumed with HTTP range requests when the server supports them. If the user is offline, the app opens in simple matching mode and keeps the download action available.

Claude Desktop MCPB bundle, built for the current platform:

```bash
npm run mcp:bundle
```

This creates `dist/Vintrace-<platform>-<arch>.mcpb`.

## MCP / Agent Native Surface

The app includes an agent-native image service for Codex, Claude Desktop, Claude Code, OpenAI agent clients, generic MCP clients, and direct HTTP clients. MCP stdio, authenticated Streamable HTTP, and `/v1` JSON routes share one policy and execution layer.

```bash
npm run mcp -- --workspace /path/to/vintrace-workspace --tool-profile images
```

Agents can discover the live image action catalog, inspect a compact library overview, search by text or on-device meaning with exact filters, fetch path-free metadata by stable asset ID, read indexed OCR/object/barcode/quality intelligence, request a bounded audited preview, organize and edit non-destructively, export, maintain the library, and poll jobs. Eight built-in and workspace-scoped custom multi-step recipes make repeatable workflows plan-only and approval-aware. A unified operation timeline spans import/index/export/repair/library/agent writes, with path-free output manifests and bounded opaque resources. Activity is visible in the desktop Agents panel and through an authenticated resumable `/v1/events` stream. MCP App-capable hosts can render bounded search results in a path-free review component, request policy-gated previews, persist stable-ID selections, and continue with the reviewed set. The long-tail catalog covers every image-oriented backend command without flooding model context with more than a hundred similar tool definitions. Existing consent, face-review, compliance, backup, diagnostic, benchmark, and audit workflows remain available.

Inbound visual connectors complete the external-to-library loop: a human can authorize Slack, public web pages, Google Drive, OneDrive, Dropbox, or WebDAV from **Import images → Online & cloud**; agents can then discover bounded metadata, propose a reviewed selection, and run a separately consented, confirmed, idempotent managed import. Credentials remain in OS-backed storage and are never returned to agents. Imported media receives stable IDs and enters the same local intelligence, Safe Mode, curation, editing, and delivery pipeline. See [the inbound connector architecture and workflow guide](docs/2026-inbound-visual-connectors.md).

The desktop makes this platform visible as a first-class **AI Agents** destination rather than burying it in developer settings. New users see a dismissible discovery banner and an onboarding step; the destination explains workflow unlocks, all eight built-in recipes, MCP/OpenAPI/visual-review/operations/OAuth foundations, client setup, live HTTP status and endpoints, approval activity, and the trust model. Its shared frontend catalog is checked against the live backend and manifest so published counts and recipe names cannot silently drift.

The same destination can pair a phone with the responsive **Mobile companion**. Each device receives an expiring, revocable, permanently read-only principal; previews are a separate opt-in scope, and the browser holds its session only in a Secure/HttpOnly/SameSite cookie. A trusted same-origin HTTPS reverse proxy to the managed loopback server is required for real devices. See the [mobile companion operator and security guide](docs/mobile-companion.md).

Every mutation is planned and assigned to a read, non-destructive write, or destructive lane. Writes require `confirm=true` and a persistent idempotency key; protected pixel access, consent, identity decisions, sensitive overrides, path scope, and audit deletion retain explicit policy or human authority.

Local HTTP uses an operator bearer token. Controlled deployments can additionally validate hash-only service-account tokens with scopes/per-tool grants or OAuth JWTs against an operator-configured issuer, audience, and JWKS. Vintrace remains the resource server; identity-provider provisioning and network/TLS deployment stay under operator control.

Authenticated HTTP can be started with:

```bash
export VINTRACE_MCP_TOKEN='replace-with-a-long-random-token'
npm run mcp:http -- --workspace /path/to/vintrace-workspace --tool-profile images
```

The same localhost process serves MCP at `http://127.0.0.1:8765/mcp`, the direct API at `/v1`, and its OpenAPI 3.1 document at `/v1/openapi.json`.

The desktop app and MCP server share an active-workspace registry. When MCP is launched without an explicit `--workspace`, it uses the last active desktop workspace when available. Each workspace also carries `.vintrace-workspace.json`, durable consent metadata, and an append-only audit log.

Codex setup:

```bash
./mcp/codex-install.sh /path/to/vintrace-workspace /path/to/approved-media-root
```

The approved media root is optional; when omitted, agent filesystem access remains confined to the active workspace.

Claude setup:

- Use `mcp/claude-desktop-config.example.json` for a source-tree stdio server.
- Use `npm run mcp:bundle` for a one-click `.mcpb` desktop extension.

See `mcp/README.md` for the full tool/resource/prompt inventory and configuration examples.

## Safe Mode ML Model

Safe Mode always retains a local ONNX/heuristic compatibility gate and can optionally add a policy-constrained multimodal guardrail before thumbnails, face matching, clustering, MCP exposure, and exports. The category-aware path reports fixed scores for sexually explicit content, violence/gore, dangerous activity, and self-harm, requires the validated Qwen3-VL quality tier, and refuses the low-memory caption-model fallback. It is slower, operator-controlled, and never performs CSAM hash matching or reporting. See [the Multimodal Safe Mode design and real-model evidence](docs/multimodal-safe-mode.md).

- Installed local model: `models/safety/adamcodd_vit_base_nsfw_int8.onnx`
- Model source: `AdamCodd/vit-base-nsfw-detector`
- License: Apache-2.0
- Runtime: ONNX Runtime provider fallback through CoreML/CUDA/TensorRT/DirectML/OpenVINO/CPU where available.

The research recommendation in `res.md` prefers `Marqo/nsfw-image-detection-384` as the final default because it is smaller and permissively licensed. Marqo does not ship a ready ONNX file, so the app supports it as a drop-in export: add a `marqo*.onnx` file and matching manifest under `models/safety/`, and it will be preferred over the ready-made fallback model.

Settings can install the pinned Qwen3-VL quality pack for category-aware Safe Mode. The Recommended preset leaves this slower path off for bulk scans; Privacy first enables it. Malformed or unavailable multimodal output fails back to the compatibility detector and is not cached as a successful category verdict.

## Face Model Downloads

The full face-matching pipeline uses local InsightFace ONNX model packs. The app never downloads these silently during backend startup. Instead, users explicitly install a model from Home or Settings:

- Recommended accuracy: `antelopev2.zip`, downloaded from the official InsightFace v0.7 GitHub release and validated with SHA-256 `8e182f14fc6e80b3bfa375b33eb6cff7ee05d8ef7633e738d1c89021dcf0c5c5`.
- Balanced package: `buffalo_l.zip`, downloaded from the official InsightFace v0.7 GitHub release and validated with SHA-256 `80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f`.

The selected model root is stored in the local workspace config. Default downloads go under `~/.insightface`, while advanced users can choose an external drive or shared local model folder. Downloaded archives are checksum-verified before extraction, and extraction rejects unsafe archive paths.

If you need a fully offline installer, place an extracted pack at `models/insightface/models/<pack>/` before running `npm run dist:mac`, `npm run dist:win`, or `npm run dist:linux`; the packaged backend also checks bundled resources before asking the user to download.

Recognition quality uses the bundled, integrity-pinned eDifFIQA(T) model on the exact aligned crop sent to the recognizer. When the detector's five landmarks have a high canonical-fit residual, Vintrace keeps the original embedding as an A/B control and evaluates at most four alternate warps: swapped eye/mouth pairs, bounded single-landmark repairs, and a bbox-derived canonical crop. An alternate is retained only when alignment and comparable FIQA quality improve, its embedding remains consistent with the control identity, and its combined score wins by a safety margin. Otherwise the original five-point embedding and existing alignment-suspect review demotion remain in force.

Alignment decisions survive the embedding cache and appear in scan metrics as attempted/succeeded/rejected recovery counts. Accepted rescues receive an `alignment-recovered` review risk flag and a strategy-specific note. Sound frontal geometry performs no alternate recognizer calls. Run `npm run bench:alignment-recovery` for the real-model CALFW/CPLFW before/after gate.

Match probabilities can also use identity-held-out AC-Linear local calibration. The adaptive model uses the normalized center of the candidate/reference embeddings plus raw cosine, and it is promoted only when held-out Brier score improves without ranking or pose/media/age-gap regression. Until enough reviewed evidence exists, or whenever context/model validation fails, Vintrace falls back to per-person Platt, global Platt, and finally raw-score review ordering.

Both supported recognizers include an integrity-pinned 60-vector Syn-Vis-v0 cohort for true symmetric AS-Norm. Only derived vectors ship, not source images. Live normalization is a precision-only confident-band guard; pair context and calibration provenance survive review, rechecks, rollback, and correction undo. `npm run bench:adaptive-calibration` runs the CALFW/CPLFW no-regression gate.

## Test

```bash
npm run test
```

The MCP smoke test starts a real MCP stdio session and proves import/search/fetch/preview, recipes, unified operations, manifests, activity approvals, and tool/manifest parity. `npm run test:agent-workflows` exercises the eight golden plans, typed recipe inputs, durable replay, confirmation, operation normalization, and path-free audit history. The E2E test launches Electron, creates image fixtures, enrolls references, scans candidates, verifies Safe Mode folder watching, accepts/rejects/marks uncertain review items, and validates settings.

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

Face matching and photo semantic search share the same persistent vector-store implementation. Libraries below the automatic crossover use exact inner-product search; at 250,000 vectors the production default switches to FAISS HNSW with SQ8 candidate vectors and reranks every returned candidate against the retained normalized float vector. Semantic HNSW construction runs as a durable `vectorIndexOnly` indexing job, so an initial search stays responsive on the exact backend while the sidecar is built. Sidecars are checksum-bound to the pickle-free vector archive, permission-restricted, and rebuilt from the exact archive after corruption or configuration drift. Run `npm run bench:vector-ann` for the 250k x 512 recall/latency/persistence gate. Advanced diagnostics can override the crossover with `CROSSAGE_VECTOR_ANN_THRESHOLD`, search breadth with `CROSSAGE_VECTOR_ANN_EXACT_FALLBACK_SCORE`, or force CPU FAISS with `CROSSAGE_VECTOR_DEVICE=cpu`.

Semantic search also indexes **visual video segments** entirely on device. The existing OpenCV/managed-FFmpeg decoder samples bounded frames, adjacent SigLIP embeddings form deterministic contiguous segments, and a separate persistent vector sidecar stores representative timestamps and previews. Search results can include several distinct moments from one video; clicking one opens the video and seeks after metadata is ready. Source stats plus a sparse content fingerprint invalidate changed videos, hidden/deleted assets disappear from the index, and missing work uses the durable **Semantic media** queue. Audio transcription and sound-event search are not part of this visual index. Run `npm run test:video-semantic-search`, `npm run test:video-semantic-ui`, `npm run benchmark:video-semantic`, or `VINTRACE_VIDEO_SEMANTIC_TEST_EXECUTABLE=/path/to/crossage-backend npm run test:frozen-video-semantic`.

The **People** view includes opt-in **Who is this?** suggestions for repeated unnamed face clusters. Vintrace compares local co-occurrence neighborhoods, shows the exact shared people and support counts behind each possibility, and blocks any candidate identity that appears in the same photo as the unnamed face. Suggestions require face consent, honor per-subject consent and hidden/rejected/deleted state, and never apply automatically. **Review and merge** opens a separate confirmation before an idempotent, undoable person merge; **Not this person** persists the dismissal. Run `npm run test:photo-relationships`, `npm run test:photo-relationships-ui`, `npm run benchmark:photo-relationships`, or `VINTRACE_RELATIONSHIP_TEST_EXECUTABLE=/path/to/crossage-backend npm run test:frozen-photo-relationships`.

Portable photo captions and object/scene/activity tags use optional, explicitly installed Apache-2.0 model packs: Qwen3-VL-4B for the quality tier and SmolVLM2-2.2B for lower-memory systems. A hash-pinned official llama.cpp runtime runs only local verified GGUF files with offline mode forced. Generated captions remain separate from manual captions; tags remain reviewable; both enter durable search and survive restart. The base installer contains only the signed model/runtime catalog and licenses, while the multi-gigabyte packs install from Settings on request. Run `npm run test:photo-vlm` for integrity/persistence contracts or `npm run benchmark:photo-vlm -- --model-root /path/to/installed/vlm` for both real offline tiers.

Photos also includes **Ask Library**, a fully local conversational planner over the same verified model runtime and canonical agent-image service. It can combine hybrid semantic retrieval with OCR, generated captions/tags, EXIF, dates, places, people, collections, and approval-aware MCP workflows. Answers cite stable asset IDs and never disclose source paths or pixels. Ingested text is typed as untrusted before model use; detected instruction spans are also prevented from re-entering conversation history through generated answers. Read tools run in bounded calls, while writes and destructive actions become expiring server-side plans that require a separate explicit confirmation and idempotency key. Run `npm run test:photo-agent`, `npm run test:photo-agent-ui`, or `npm run benchmark:photo-agent -- --model-root /path/to/installed/vlm` for unit, renderer, and real-model offline gates.

The still-photo editor includes **Local AI edits** with explicit, checksum-verified model setup. The roughly 145 MB light pack provides LaMa Clean Up and Real-ESRGAN 2x/4x Upscale on supported macOS and Windows systems. Expand, Reframe, and Relight use the optional 22.9 GB Qwen-Image-Edit-2511 heavy pack through `stable-diffusion.cpp`; that tier is offered only on Apple Silicon macOS or Windows x64 Vulkan after Vintrace verifies at least 48 GiB of memory (64 GiB recommended) and the user acknowledges the download. Intel macOS and machines with insufficient or undetectable memory report the heavy tier as unavailable instead of attempting an unverified or unsafe fallback.

Every AI edit is rendered as a local preview before an explicit Apply. Applying creates a version of the prior edit stack, commits a hash-verified workspace artifact with an embedded C2PA Content Credential, records separate model/runtime/catalog/source/output provenance, and leaves the imported original byte-for-byte unchanged. Crop/rotate/exposure remain ordinary C2PA actions; supported rendered exports are signed, and original exports preserve inbound credentials byte-for-byte. Signing fails closed. The encrypted signer is workspace-local, not globally trusted or RFC 3161 timestamped. Run `npm run test:photo-generative`, `npm run test:content-credentials`, `npm run test:frozen-content-credentials`, or `npm run benchmark:photo-generative -- --model-root /path/to/installed/generative` for contract, provenance, frozen-runtime, and real offline light-tier gates.

Selected Memories also include **Photo story**. An explicit Generate/New draft action uses the installed local Qwen3-VL or SmolVLM2 tier to select bounded highlights, group them into deterministic date/place chapters, fill missing local captions, and write a schema-constrained title, narrative, and per-photo captions. Source paths never enter the model prompt or renderer story payload. Every draft records its input/content hashes, seed, exact model/runtime provenance, source manifest, and human-review requirement; edits use atomic revisions with automatic restorable history. Markdown/JSON exports are path-free, while Create movie saves any pending edits and hands the chapter order, narratives, captions, and provenance hashes to the existing slideshow/movie studio. Relinked originals follow stable asset IDs, and hidden, deleted, missing, or content-changed sources fail closed before movie creation. Run `npm run test:photo-story`, `npm run test:photo-story-ui`, `npm run benchmark:photo-story`, or the packaged gate `npm run test:frozen-photo-story` with its documented model/executable environment variables.

The **Bursts** collection includes opt-in **Assisted culling**. Analyze burst scores every frame locally for sharpness and directional motion clarity; with face-processing consent, it also reuses the production eDifFIQA face-quality path and an explicitly heuristic eyes-open likelihood. Every frame shows its score and all contributing reasons. Analysis is path-free, content/provenance-bound, restart-cached, and never selects, hides, or deletes anything. **Use recommendation** is a separate confirmed, idempotent keeper action, and any frame can still be chosen manually. Run `npm run test:photo-culling`, `npm run test:photo-culling-ui`, `npm run benchmark:photo-culling`, or `VINTRACE_CULLING_TEST_EXECUTABLE=/path/to/crossage-backend npm run test:frozen-photo-culling`.

Safe Mode decisions are cached by file hash, model version, and threshold so repeated scans do not repeatedly score the same content. Accepted/rejected review decisions automatically build a local calibration label set, and Settings includes large-folder readiness, benchmark, and release-readiness panels.

Face scan detail is configurable for large libraries. The recommended default uses a 512px detector input for better throughput, High confidence uses 640px for maximum detection detail, and Custom mode accepts validated 320-1024 values in 32px steps. Optional two-pass scanning runs the first pass at the selected detail and rechecks only queued candidates at higher detail.

Repeated face detection work is cached by file hash, model name, and detector size. Scan controls support pause, resume, cancel, a first-class recovery card for interrupted scans, and resumable manifests. Folder checks include a pre-scan time estimate plus a scan plan with storage estimate, cache coverage, resumability, and warnings for 100k-1M scale folders. Review includes backend-paged browsing for large queues, video moment grouping, source-folder batches, confidence lanes, people-together lanes, identity move/split controls, repeated-false-match suppression, and calibration summaries from accepted/rejected decisions.

Duplicate review rows are suppressed by content hash when the same image appears under multiple names or folders, while video moments remain grouped by their source video. Settings includes an app-folder optimizer, broken-link repair, moved-folder relinking, source-folder inventory export, audit-log export, scan-manifest pruning, model integrity checks, backup verification/restore/pruning, support-bundle export, and a user-friendly storage limit. Cleanup clears regenerable preview cache, removes orphan extracted video frames, checkpoints/VACUUMs the SQLite scale database, and reports reclaimed space without touching original photos or videos.

Settings now includes an Accuracy Lab that turns accepted/rejected review decisions into local precision/recall metrics and can apply threshold feedback when enough positive and negative examples exist. Accuracy labels can be exported as JSON/CSV for external benchmarks, and agents can import labeled rows back into the calibration harness. The backend also exposes paged candidate queries so agents can inspect large review queues without pulling the entire candidate list into context. Save and clean up can export accepted media into a shareable manifest-backed folder plus a review decision ledger. Privacy controls include a first-exposure AI/biometric notice, complete per-subject written releases, stored-subject coverage, exact retention-policy publication evidence, startup/manual enforcement, encrypted consent/audit files, exportable compliance evidence, and confirmed one-subject erasure that preserves original media. They also report local face data, generated previews, caches, Safe Mode audit totals, and retain the confirmed whole-workspace delete operation. Model-drift checks flag saved references or review rows created with a different active face model. Error reports are local-first: the app records crashes, renderer hangs, backend errors, and updater failures into a local diagnostics log with stable error codes, categories, severity, fingerprints, and per-code summaries; users preview and export JSON manually, with file paths hidden unless explicitly included.

## Notes

- `local-image-fingerprint` is a workflow fallback, not biometric face recognition.
- Real biometric use requires calibrated face embeddings, properly licensed weights, explicit consent, retention/deletion policy, and validation on labeled data.
- The packaged app stores workspace data under the Electron user-data directory unless a workspace is selected.

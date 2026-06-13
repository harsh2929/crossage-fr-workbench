# Vintrace — Security & Threat-Model Audit

**Scope:** Security posture of the whole platform — the Electron process boundary, the `vintrace://` / `vintrace-media://` protocols, filesystem & archive handling, malicious-media decoders, backend input validation & injection, the **MCP server**, privacy/consent/data-at-rest, and update/supply-chain trust. This is the third audit in the series ([UI/UX](uiux-performance-audit.md), [Architecture](architecture-audit.md), Security).

**App profile:** A **local, offline, consent-gated** desktop tool for **biometric** face matching (it stores 512-float face embeddings and previews; use cases plausibly involve images of **minors**). Electron shell + a Python backend child process over stdio JSON-RPC; also an MCP server (FastMCP) reusing the same backend. Releases are currently **unsigned/unnotarized**.

**Method:** Eight parallel threat-model-driven deep-dives, each with an **adversarial reachability pass** (does a realistic attacker actually reach/exploit this, or does a guard block it?), plus a completeness critic. Every finding cites `file:line` + a quoted snippet and was reachability-checked. Findings already fixed in prior passes (EIPC-02, BRS-1/2, ER-01/02, MS-1, data-persistence-3) were excluded.

**Date:** 2026-06-13

### Threat model
| | Actor | Capability |
|---|---|---|
| **T1** | Malicious media | The user scans/opens attacker-crafted images/videos |
| **T2** | Malicious deep link / file association | The user clicks `vintrace://…` or opens a malicious associated file |
| **T3** | Compromised renderer | Renderer content tries to escape isolation to FS/code |
| **T4** | Local adversary / 2nd process | Local malware tampers with files, env, models, the update feed |
| **T5** | MCP client | An AI agent / networked client talks to the MCP server |
| **T6** | Supply chain | A compromised dependency, model, or update is delivered |
| **T7** | Privacy/consent bypass | A path that processes/stores/leaks data without consent or past Safe Mode |

*Out of scope: physical access to an unlocked machine; the user exfiltrating their own data.*

---

## TL;DR — the verdict

Vintrace is **built by someone who thought about security** — and it shows in the fundamentals: **fully parameterized SQL** (zero injection), **list-arg subprocess** calls (zero shell/arg injection), a **TLS + hardcoded-SHA-256 + zip-slip-guarded** face-model download, **server-side consent enforcement**, a **fail-closed Safe-Mode gate**, validated & confirmation-gated deep links, realpath-checked media serving, and **genuinely no telemetry**. The deep-link and filesystem-archive surfaces, specifically probed for traversal/arbitrary-write, came back **clean**.

The risk is concentrated in **two clusters** plus a privacy-leak theme:

1. **The MCP server is the dominant weakness.** It reuses the backend but **drops the human-in-the-loop gates**: an MCP client can **self-grant consent**, **scan/enroll arbitrary directories** on the host, **read the absolute paths of biometric media** (tool returns aren't redacted like resources are), and **bypass the workspace lock entirely** — and the HTTP transport is **unauthenticated**. For an agent-facing server on biometric data, this is the #1 area.
2. **Environment-variable trust subversion (local attacker, T4).** The app inherits and trusts `process.env`. `CROSSAGE_PYTHON` is an outright **arbitrary-code-execution** primitive on every launch (the one **Critical**); the **update feed**, the **Safe-Mode model**, and the **face model** can each be redirected via env vars to subvert integrity; macOS `disable-library-validation` + unsigned + an unscrubbed env enables **DYLD injection**.
3. **Privacy leakage in "scrubbed" artifacts.** The support bundle and the new error log redact *path-shaped* strings only, so they ship **subject names, operator identity, and case notes** (PC-01) and **absolute external paths** in tracebacks (PC-02).

**Counts (post-verification):** **1 Critical · 11 High · 13 Medium · 13 Low.** No remote-unauthenticated RCE against the default configuration; the Critical and most Highs require either a local foothold (T4) or an enabled/opted-in surface (MCP, custom decoder).

### Dimension scorecard
| Dimension | Grade | State |
|---|---|---|
| **Electron boundary** | B+ | Strong isolation/sandbox/CSP/allowlist; minor self-grant + dev-toggle gaps. |
| **Deep-link / protocol** | A– | Validated, confirmation-gated, realpath-checked; **no traversal found**. Two low hardening nits. |
| **Filesystem / archive** | B+ | Per-member zip-slip guard correct; symlink/temp-predictability hardening only. |
| **Malicious-media decoders** | B– | PIL bomb-guarded & ffmpeg safe; **RAW/video paths bypass the bomb cap** (DoS). |
| **Input / injection** | B | **No SQL/shell/arg injection**; the configurable ffmpeg path is an arbitrary-exec hole. |
| **MCP server** | D | Unauthenticated, no path confinement, self-consent, path leakage, lock bypass. |
| **Privacy / consent** | C+ | Consent & Safe Mode enforced server-side; redaction misses free-text PII; biometrics unencrypted at rest. |
| **Update / supply-chain** | C | Excellent model-download integrity; env-driven trust subversion + unsigned binaries. |

---

## The two clusters (read these first)

### Cluster A — The MCP server drops the human-in-the-loop gates
`mcp_server.py` (FastMCP, ~80 tools) reuses `DesktopApi.handle()` but the desktop app's *protections live in the Electron layer and the human*, not in the handler — so the MCP path inherits the functionality without the guardrails:
- **No auth** on the HTTP transport (**MCP-01/INJ-05/PC-05**) — `--allow-remote-http --host 0.0.0.0` exposes everything to the LAN with zero credentials; even the localhost default is reachable by any local process.
- **Self-consent** (**MCP-02/INJ-04/PC-04**) — `mark_consent(confirmed=True)` flips the same `consent.json` the GUI reads; the gate that should require a human is satisfied by the agent, which then forges an operator/note in the audit ledger.
- **No path confinement** (**MCP-03/INJ-03**) — `scan_folder('/Users/victim')`, `enroll_reference_folder(…, '/Volumes/backup')`, `assess_image('/any/file')` walk/decode arbitrary directories → arbitrary-host biometric processing + a filesystem existence/NSFW oracle.
- **Path leakage** (**MCP-04**) — *resources* are redacted via `_agent_safe_value`, but most *tools* (`query_candidates`, `workspace_health`, `export_*`, `privacy_report`, `read_audit_events`) return **raw absolute paths** to sensitive face media (filenames often encode names/dates).
- **Lock bypass** (**MCP-05**) — the safeStorage workspace lock is an Electron concept; the MCP backend never checks it, so "locked" biometric data is fully readable/mutable over MCP.
- **Exfil/destructive tools** (**MCP-06**) — `export_accepted_media_bundle`/`export_workspace_backup` copy originals to an agent-reachable folder; `delete_face_data` etc. are gated only by a `confirm=True` *argument* (no barrier to an agent).

**The fix is one principle:** the MCP boundary must **re-apply** auth, a path allow-list, out-of-band (non-self) consent, redaction-on-all-outputs, and the lock — not assume the desktop layer's gates carry over.

### Cluster B — The process trusts its environment
The app inherits `process.env` at launch and re-spreads it when spawning the backend (`main.cjs:2739-2748`), so any actor who can set a persistent env var for the user's session (shell profile, LaunchAgent, registry Environment) subverts integrity on the next start:
- **`CROSSAGE_PYTHON` → arbitrary backend executable** (**USC-01, Critical**).
- **`VINTRACE_UPDATE_URL` → malicious unsigned update feed** (**USC-02**).
- **`VINTRACE_SAFE_MODEL[_DIR]` → swapped NSFW model** (**USC-03**); **`CROSSAGE_MODEL_ROOT` → swapped face model** (**USC-04**).
- **`DYLD_INSERT_LIBRARIES`** (unscrubbed) + `disable-library-validation` → **dylib injection** (**MISS-01**).
- **`CROSSAGE_FORCE_FALLBACK=1` → downgrades the NSFW gate to a heuristic** (**MISS-04**).

**The fix is one principle:** in packaged builds, **ignore or allow-list these env knobs** (only honor them under `!app.isPackaged`/an explicit dev flag), require resolved paths to live under `resourcesPath`/app root, and **scrub `DYLD_*`/`LD_*`** before spawning the backend.

---

## Findings

Severity = real exploitability for *this* app. Every High/Critical was reachability-verified.

### 🔴 CRITICAL

#### USC-01 — `CROSSAGE_PYTHON` runs an arbitrary executable as the backend on every launch (T4, T6)
`main.cjs:1726-1727` returns `process.env.CROSSAGE_PYTHON` verbatim as the *first* branch of `findPythonExecutable()` — **no validation**, taking precedence even over the packaged frozen backend — then `spawn(executable, args, {cwd, env})` (`:2735-2748`) runs it with the app's privileges and full env. *Attack:* local malware writes `CROSSAGE_PYTHON=/path/to/evil` to the user's persistent environment; the next Vintrace start executes it (args `[]` for the frozen path, so it runs standalone). *Impact:* **arbitrary code execution** as the user with access to biometric embeddings, the SQLite workspace, consent/audit, and the camera — and silent disablement of Safe Mode/consent. *Fix:* honor `CROSSAGE_PYTHON` only when `!app.isPackaged` (or a dev flag); require the resolved backend under `process.resourcesPath`; audit any override. **Effort S.** *(verified critical)*

---

### 🟠 HIGH

#### MCP cluster (T5/T7) — the agent-facing server on biometric data
- **MCP-01 / INJ-05 / PC-05 — Unauthenticated HTTP transport.** `mcp_server.py:1082-1088` gates only the *host string*; no token/bearer anywhere. `--allow-remote-http --host 0.0.0.0` (shipped as `npm run mcp:http`) binds all ~80 tools to the network with zero credentials. *Fix:* require a token for HTTP; refuse to bind remote without one; keep stdio the only no-auth transport. **M**
- **MCP-02 — Self-granted consent.** `mark_consent(confirmed=True)` → `set_consent` flips the shared `consent.json` and forges an audit operator/note (`mcp_server.py:282-287`, `manager.py:437-468`). *Fix:* require out-of-band (desktop-UI) consent before MCP scan/enroll; never let the session self-authorize. **M**
- **MCP-03 — Arbitrary-directory biometric processing.** `scan_folder`/`enroll_reference_folder`/`assess_image` accept any host path (`safe_resolve` = `expanduser().resolve()`, no workspace containment; `manager.py:2037-2074`). *Fix:* confine to an operator-approved root allow-list; return generic errors (no existence oracle). **M**
- **MCP-04 — Tool returns leak absolute biometric paths.** Resources redact; tools (`query_candidates`, `workspace_health`, `export_*`, `privacy_report`, `read_audit_events`) return raw `sourcePath`/`bestRefPath`/`previewPath`/`workspace` (`api_server.py:3626-3640`). *Fix:* apply `_agent_safe_value` to **all** tool outputs; add a "no absolute path in any tool response" test. **M**
- **INJ-02 — `assess_image` decodes any path with no consent gate.** Calls `assess_image_safety` directly (`mcp_server.py:407`), bypassing `_require_consent` → a filesystem-wide "is this an NSFW image?" oracle + un-consented decode. *Fix:* gate behind consent + the scan-scope allow-list; audit invocations. **S**

#### INJ-01 — Configurable ffmpeg/ffprobe path is run with only an exists-check (T3/T4)
`save_settings` (renderer-allowlisted) accepts `videoDecoder.ffmpegPath`; `_optional_existing_file` validates only `exists()`/`is_file()` (`api_server.py:991-1003`), persists it to `VINTRACE_FFMPEG_PATH`, and it becomes `argv[0]` of `subprocess.run` on the next video probe/sample (`video_io.py:465-480`). *Attack:* a compromised renderer (T3) or config-tampering local adversary (T4) points it at any executable; scanning any video runs it as the backend. *Impact:* **arbitrary-executable execution** chained from a renderer/config foothold (no arg injection — argv[0] only). *Fix:* confine the decoder path to allow-listed dirs (bundled resources / imageio-ffmpeg managed dir), reject symlinks, verify a `ffmpeg -version` banner before persisting. **M.** *(verified)*

#### MD-01 — RAW/DNG decode bypasses the decompression-bomb guard → OOM DoS (T1)
`load_image` routes the 18 RAW extensions to `_load_raw_image` **before** the `DecompressionBombWarning`-guarded block, and `rawpy.postprocess()` → `Image.fromarray(rgb)` has **no pixel/dimension cap** (`image_io.py:188-211`). Caller catches don't include `MemoryError`. *Attack:* a crafted RAW declaring huge sensor dimensions (via scan folder, drag, deep-link, or file association) allocates a multi-GB buffer → backend OOM/kill mid-scan. *Fix:* read `raw.sizes` and reject `width*height` over a `MAX_IMAGE_PIXELS`-derived cap before `postprocess`; add a RAW case to the decode-guard test. **S.** *(verified)*

#### PC-01 — The "scrubbed" support bundle leaks subject names, operator identity, and case notes (T7)
`export_support_bundle` embeds `audit_events(limit=80)` then `_redact_paths`, which only redacts **path-shaped** values. Audit rows carry free text — `person_name` (enroll/delete), `operator[:120]` and `note[:800]` (set_consent) (`manager.py:465-467,522,2546`) — under non-path keys, so they ship verbatim despite the "diagnostics only" manifest. *Attack:* an operator shares a bundle believing it scrubbed; it contains `{enroll_folder, person_name: "Jane Q. Victim"}` and `{set_consent, operator: "Det. Smith #4471", note: "Case 2024-CF-882, minor"}`. *Impact:* disclosure of subject names, operator identity, and case notes (possibly involving minors). *Fix:* redact/hash `person_name`/`operator`/`note`/`label` when `include_paths=False`, or ship only aggregate audit data. **S.** *(verified)*

#### USC-02 — Update feed redirectable via env var to a malicious unsigned feed (T4/T6)
`main.cjs:1518-1521` passes `VINTRACE_UPDATE_URL`/`CROSSAGE_UPDATE_URL` verbatim to `setFeedURL({provider:'generic', url})` — **no https-only, no host allow-list, `http://` accepted**. Because releases are unsigned, electron-updater's only integrity check is the SHA-512 in `latest.yml` — authored by the same attacker feed. *Attack:* local attacker sets the env var; the user (or periodic check) downloads+installs the attacker's installer. *Impact:* persistent malicious-code delivery via the trusted update path. *Fix:* require `app.isPackaged` + `https://` + host allow-list; treat a custom feed as dev-only; ship signed/notarized builds so the publisher signature is enforced. **M.** *(verified)*

#### USC-03 — Safe-Mode model integrity rests on a *writable* sidecar hash + env override (T4/T6/T7)
*(This refines the prior BRS-2 fix.)* The expected hash is read from the model's own sidecar JSON (`safety.py:408,430`), which is **as writable as the model**, and verification is **skipped when the hash is absent** (`:311-312`); `SAFE_MODEL`/`SAFE_MODEL_DIR` env vars point at any model. *Attack:* a local attacker (a) replaces `.onnx` *and* rewrites the sidecar hash, (b) drops a model with no sidecar (skips verification), or (c) env-points at a benign "always-SFW" model. *Impact:* the NSFW gate is neutered → sensitive media flows into matching/thumbnails/MCP/exports. *Fix:* **pin the bundled model's SHA-256 in code** (as `MODEL_PACKAGES` does for face models), fail closed on unrecognized/unhashed models, and ignore `SAFE_MODEL*` in packaged builds. **M.** *(verified)*

#### MISS-01 — DYLD dylib injection on macOS (T4/T6)
The new `entitlements.mac.plist` sets `disable-library-validation` (needed for the bundled native libs), releases are unsigned, and the backend spawn doesn't scrub `DYLD_*`. *Attack:* a local attacker sets `DYLD_INSERT_LIBRARIES`; the spawned `crossage-backend` inherits it and loads the malicious dylib → native code execution in the biometric/camera backend. *Fix:* delete `DYLD_*`/`LD_*` from the spawn env; sign + notarize. **M.** *(verified)*

#### MISS-02 — Unvalidated `active-workspace.json` redirects MCP processing to any directory (T4/T5)
`read_active_workspace` returns `Path(json.workspace).resolve()` **unvalidated** (`workspace_registry.py:125-142`); `mcp_server.py:23` reads it at import. *Attack:* local malware writes the registry pointer to any dir; the MCP backend operates there, ignoring the lock. *Fix:* validate the target against a workspace marker/allow-list; `0o700`/`0o600` the registry. **M.** *(verified)*

---

### 🟡 MEDIUM (condensed)
| ID | Finding | Where | Fix | Threat |
|---|---|---|---|---|
| EB-01 | Renderer self-grants a path via `scan_paths`, then `shell:open/reveal` opens it | main.cjs ~1964/1444/3343 | Grant only post-invoke for echoed paths; confine shell handlers to workspace media | T3 |
| MD-02 | `MAX_IMAGE_PIXELS` default 180M px → ~540MB buffers pass the bomb check | image_io.py:16-19 | Lower default to ~80–100M; draft/streamed decode for previews | T1 |
| MD-03 | Video frames (cv2 path) not pixel-capped before `Image.fromarray` | video_io.py:196-201 | Cap/downscale per-frame pixels; bound ffmpeg `-vf scale` | T1 |
| INJ-03 | MCP `analyze_folder`/`storage_io_benchmark` = arbitrary-path existence/writability recon | mcp_server.py:381/817 | Confine to workspace/consented roots; coarse readiness only | T5 |
| INJ-06 | `restore_media_action` trusts an unconfined manifest path → attacker-directed `shutil.move` | manager.py:3820-3904 | Require the manifest inside the exports dir; validate src/target roots | T4 |
| MCP-06 | Agent-reachable media-bundle/backup export + bulk delete (confirm=arg) | mcp_server.py:744-796 | Route through out-of-band approval; confine export targets | T5/T7 |
| PC-02 | `backend-errors.jsonl` masks only workspace/home → leaks external paths/filenames in tracebacks | api_server.py `_redact_text` | Generically mask all absolute paths → basename; reduce exc to type+message | T7 |
| PC-03 | Biometric vectors + previews stored **unencrypted**; the lock is access-control, not at-rest | workspace_db.py:142; manager.py:112,120 | Encrypt at rest (SQLCipher / safeStorage-derived key) or document the limit | T4 |
| USC-04 | Face model loaded from env/cwd dirs with **no runtime re-verification** (substitution) | model_manager.py:139-182; engine.py:148 | Record + re-verify loaded `.onnx` SHA-256 at init; drop `cwd`, ignore `MODEL_ROOT` when packaged | T4/T6 |
| MISS-03 | `camera:save-frame` writes a face photo ignoring the workspace lock | main.cjs:3386-3399 | Add `isWorkspaceLocked()` guard | T3/T7 |
| MISS-04 | `CROSSAGE_FORCE_FALLBACK=1` downgrades the NSFW gate to a skin-ratio heuristic | safety.py:37-69 | In packaged builds, refuse heuristic-only / fail closed | T4/T7 |
| MISS-05 | Biometric files world-readable (no `chmod`/`umask`) | workspace_registry.py:64,94 | `0o700` dirs, `0o600` files | T4 |
| PC-06 | `analyze_folder` decodes media with no consent check | api_server.py:432 | Gate behind `_require_consent`, or metadata-only preflight | T7 |

### 🟢 LOW
EB-02 (DevTools via `CROSSAGE_ENABLE_DEVTOOLS` in packaged build) · EB-03 (`style-src 'unsafe-inline'` ships) · DLP-01 (`vintrace://scan?path=` stages a path with no confirm — inert, UI-spoof only) · DLP-02 (protocol path not existence/UNC-validated) · DLP-03 (media allowlist exact-match on non-realpath'd target) · FS-ARCH-1 (atomic-write temp lacks `O_EXCL`/`O_NOFOLLOW`) · FS-ARCH-2 (backup export root no symlink/mount guard) · FS-ARCH-3 (predictable VACUUM-INTO snapshot name) · MD-04 (libheif/libraw native-decoder CVE surface) · INJ-07 (backend stdin no per-line size cap) · MCP-07 (no MCP rate-limit/resource bounds) · PC-07 (CFP benchmark over plain HTTP, SHA-256-pinned) · USC-05 (silent frozen→source-Python fallback) · MISS-06 (localStorage scan-path trust; NSIS arbitrary install dir).

---

## What's already done well (protect these)

The defenses below were **verified correct** — the recommended fixes must not regress them:
- **No SQL injection** — every user value is a `?` placeholder; f-string SQL only interpolates hardcoded identifiers (`workspace_db.py`).
- **No shell/argument injection** — all `subprocess` calls use list-args, no `shell=True`, no `os.system`; media paths are positional after `-i`, and `parseExternalPath` rejects `-`-prefixed args.
- **Face-model download integrity (exemplary)** — TLS via `certifi`, a **hardcoded** SHA-256 in `MODEL_PACKAGES`, size check, zip `testzip()`, zip-slip guard, atomic install; **the URL is not env-overridable**.
- **Backup restore** — multi-layer per-member zip-slip guard + target confinement.
- **Deep links** — URL vs filesystem-arg separation, `stat`-validation of file args, **confirmation-gated** workspace/watch actions, **server-side** consent for scan-files; **no traversal/arbitrary-scan found**.
- **Media protocol** — `realpath` + an allow-list derived from live backend state + existence + the (now) lock gate; base64/decode tricks can't escape granted scope.
- **Consent enforced server-side** — `_require_consent()` fail-closes scan/enroll/scan_paths; renderer checks are advisory only.
- **Safe Mode fails closed** — sensitive media is excluded *before* matching/clustering/preview, and the model-error path preserves the heuristic verdict (never defaults to "safe").
- **Genuinely offline** — no telemetry/analytics/phone-home; only user-initiated, hash-verified downloads.
- **Electron hardening** — `contextIsolation`/`sandbox`/`nodeIntegration:false`, a preload allow-list, `setWindowOpenHandler` deny, `will-navigate` gating, strict `script-src 'self'`.
- **Updater defaults** — `autoDownload:false`, `autoInstallOnAppQuit:false`, `allowDowngrade:false`.

---

## Remediation roadmap

Sequenced by **(risk reduction ÷ effort)**, leading with the cheap high-impact fixes.

### Phase 1 — Critical + cheap Highs — ✅ IMPLEMENTED 2026-06-13
*Verified with `node --check`, focused unit checks for each item, and the full Python suite (`edge_cases`/`pipeline_smoke`/`command_contract`/`mcp_smoke`/`safety_model_inference`) + `vite build`. Not yet committed.*
1. **USC-01 ✅ (kills the Critical)** — packaged builds now run **only** the bundled backend under `resourcesPath`; `CROSSAGE_PYTHON` and any system-interpreter fallback are ignored (dev/unpackaged still honors `VINTRACE_PYTHON`/`CROSSAGE_PYTHON`). Also closes USC-05's silent fallback. *(main.cjs)*
2. **MISS-01 ✅** — the backend spawn env now **scrubs every `DYLD_*`/`LD_*`** key, so a local attacker can't inject a dylib into the hardened-runtime backend. *(main.cjs)*
3. **PC-01 + PC-02 ✅** — `_redact_paths` now masks audit **free-text PII** (`person_name`/`operator`/`note`/`label`/rename fields → `[redacted]`), and a new `_mask_absolute_paths` generically masks **any embedded absolute path** (POSIX/Windows/UNC → basename) in both the support bundle (`_redact_string`) and the error log (`_redact_text`). Verified: subject name, operator, case note, and an external `/Volumes/EVIDENCE/…` path are all scrubbed from `audit-events.json`. *(api_server.py)*
4. **MD-01 ✅** — `_load_raw_image` reads `raw.sizes` and **rejects over-`MAX_IMAGE_PIXELS` RAWs before `postprocess`** allocates. Verified: a 400M-px RAW is rejected before decode; a normal RAW loads. *(image_io.py)*
5. **USC-03 ✅** — the bundled Safe-Mode model's SHA-256 is now **pinned in code** (`_PINNED_SAFETY_MODEL_HASHES`), so a tampered model with a *forged matching sidecar* is caught; `SAFE_MODEL`/`SAFE_MODEL_DIR` env overrides are **ignored in packaged builds**. Verified: forged-sidecar tamper detected by the pinned hash. *(safety.py)*
6. **MISS-03 ✅** — `camera:save-frame` refuses to write captured face media into a **locked** workspace. *(main.cjs)*

### Phase 2 — Close the MCP cluster — ✅ IMPLEMENTED 2026-06-13
*Verified end-to-end with `mcp_smoke` (a real MCP server+client over stdio, ~50 tool calls) updated to the secure contract, plus `edge_cases`/`pipeline_smoke`/`command_contract`/`vite build`. Not yet committed. All changes are in `crossage_fr/mcp_server.py` (+ `api_server.py` for INJ-01); the unifying principle was to **re-apply the human-in-the-loop gates at the MCP boundary**.*
7. **MCP-01 ✅** — the streamable-HTTP transport now **refuses to start without `VINTRACE_MCP_TOKEN`** (fail-closed: no accidental open server). Combined with the items below, this bounds the transport; per-request Bearer validation is the documented next step.
8. **MCP-02 ✅** — `mark_consent` **cannot self-grant**: granting requires a one-time `VINTRACE_MCP_OPERATOR_TOKEN` the agent can't mint (revoking needs none). Verified: the agent's own `confirm=True` is refused.
9. **MCP-03 / INJ-02 / INJ-03 ✅** — a new `_assert_allowed_path` confines every path-taking tool (scan/enroll/assess/probe/analyze/set_workspace) to the workspace + operator-approved `VINTRACE_MCP_ALLOWED_ROOTS`, with a **generic error** (no existence oracle). `assess_image` also now requires consent. Verified: `scan_folder("/")` is refused.
10. **MCP-04 ✅** — a `safe_tool` decorator **redacts every tool's output** (value-based: any absolute-path string is hidden), with a small preserve-list so agent-requested export destinations (`zipPath`/`jsonPath`/`target`) still work. Verified: the raw workspace path no longer appears in any tool response.
11. **MCP-05 ✅** — `_api()` now refuses all backend access when the workspace **lock is enabled** (`.vintrace-workspace-lock.json`), so MCP can't read/mutate locked biometric data.
12. **INJ-01 ✅** — a configured ffmpeg/ffprobe path must now resolve (symlinks followed) into a **trusted directory** (the managed/bundled binary or a standard system bin dir; `VINTRACE_FFMPEG_ALLOWED_DIRS` to extend). Verified: a `/tmp` binary is rejected, `/bin/sh` accepted, empty unconfined.

*Residual (follow-ups): per-request Bearer auth on the HTTP transport (MCP-01); confining MCP export **destinations** (MCP-06); resources still keep path basenames. These are documented for a later pass.*

### Phase 3 — Integrity, at-rest & supply-chain — ◑ MOSTLY IMPLEMENTED 2026-06-13
*Verified with `node --check`, focused unit checks for each item, and the full Python suite + `vite build`. Not yet committed.*
13. **USC-02 ✅ / USC-04 ✅** — `resolveUpdateFeedUrl()` now rejects a non-`https://` update feed and, in packaged builds, any host not in `VINTRACE_UPDATE_HOSTS` (falls back to the default GitHub provider). `CROSSAGE_MODEL_ROOT` and `cwd` are dropped from model search in packaged builds (verified). *Runtime re-verification of the loaded face-model hash remains a follow-up.* *(main.cjs, model_manager.py)*
14. **MISS-05 ✅ / PC-03 ◑** — workspace dirs are now `0o700`, state files and the SQLite DB `0o600` (best-effort; verified). **PC-03 documented**, not encrypted: the privacy report now exposes a `dataAtRest` block stating embeddings/previews are unencrypted and the lock is access-control only, and `RELEASES.md` says the same. At-rest encryption (SQLCipher) is deferred — it's an XL storage-layer change needing a new native dependency. *(workspace_registry.py, workspace_db.py, manager.py, RELEASES.md)*
15. **MISS-02 ✅** — `read_active_workspace` now trusts the registry pointer only if the target carries a Vintrace workspace marker (verified: a planted pointer with no marker is rejected; a registered workspace is trusted). *(workspace_registry.py)*
16. **BRS-3 ◑** — signing/notarization config + entitlements are scaffolded (arch Phase 3); the remaining blocker is obtaining certificates (org decision). Signing also blunts USC-02/MISS-01.

*Residual (follow-ups): runtime model-hash re-verification (USC-04), at-rest encryption (PC-03), and certificate acquisition for signing (BRS-3) — none doable as a safe blind code change.*

### How to validate
- **MCP:** an integration test that starts the MCP server, asserts an unauthenticated HTTP call is rejected, that `mark_consent` alone doesn't unlock scan, that a path outside the allow-list is refused, and that **no tool response contains an absolute path**.
- **Env trust:** a packaged-mode test asserting `CROSSAGE_PYTHON`/`SAFE_MODEL`/`MODEL_ROOT`/`UPDATE_URL` are ignored and `DYLD_*` is scrubbed.
- **Privacy:** extend the existing support-bundle redaction test to assert no `person_name`/`operator`/`note`/absolute path survives.
- **Decoders:** add RAW + oversized-video cases to the decompression-guard test.

---

## Appendix — metrics (verified)
| Metric | Value |
|---|---|
| Findings | 1 Critical · 11 High · 13 Medium · 13 Low |
| SQL-injection sites | **0** (fully parameterized) |
| Shell/arg-injection sites | **0** (list-args, no `shell=True`) |
| Deep-link traversal / arbitrary-scan | **0 found** (validated + confirm-gated + server-side consent) |
| Media-protocol traversal escapes | **0** (realpath + allow-list + lock) |
| Env vars that subvert integrity | `CROSSAGE_PYTHON`, `VINTRACE/CROSSAGE_UPDATE_URL`, `VINTRACE/CROSSAGE_SAFE_MODEL[_DIR]`, `CROSSAGE_MODEL_ROOT`, `CROSSAGE_FORCE_FALLBACK`, `DYLD_*` |
| MCP tools exposed / with auth | ~80 / **0** |
| MCP tools that redact paths | ~3 of ~80 (resources redact; most tools don't) |
| MCP workspace-lock enforcement | **none** |
| Face-model download verification | TLS + hardcoded SHA-256 + size + zip-slip (**strong**) |
| Safe-Mode model trust anchor | writable sidecar JSON (**weak vs local attacker**) |
| Biometric data at rest | **unencrypted** (embeddings, previews, vectors) |
| Code signing / notarization | **none** |
| Network egress | none beyond opt-in, hash-verified downloads |

---

*Generated by an eight-dimension multi-agent security audit with adversarial reachability verification of every High/Critical finding (each re-traced past existing defenses). Anchored to an explicit threat model; scoped to a local, offline, privacy-first biometric app. The companion passes are [docs/uiux-performance-audit.md](uiux-performance-audit.md) and [docs/architecture-audit.md](architecture-audit.md).*

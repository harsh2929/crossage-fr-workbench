# Vintrace — Architecture & Engineering-Principles Audit

**Scope:** Backend & platform engineering quality — the Python backend (`crossage_fr/`), the Electron main process (`desktop/main.cjs`), the data layer, concurrency model, error handling, build/release engineering, supply-chain hygiene, testing, and observability. The React **UI/UX layer is out of scope** here (covered in [docs/uiux-performance-audit.md](uiux-performance-audit.md)); it appears only where the TS↔Python contract crosses the boundary.

**Method:** Eight parallel staff-level deep-dives (module architecture, data/persistence, concurrency/pipeline, error-resilience, Electron/IPC, performance, build/release/supply-chain, testing/observability), each **adversarially re-verified against the cited code**, plus a completeness pass for missed cross-cutting surfaces. Every claim carries a `file:line` citation that was independently confirmed.

**Date:** 2026-06-13 · **App:** Vintrace 0.1.0 (Electron shell + PyInstaller-frozen Python sidecar)

---

## TL;DR — the verdict

This is a **well-engineered codebase carrying two kinds of debt**: the *structural* debt of three monoliths, and a set of *boundary* gaps that are sharper than usual because the product is privacy-first. The fundamentals are genuinely strong for a 0.1.0 — clean module layering (zero upward dependencies, no cycles), a hardened SQLite layer (WAL + foreign keys + busy_timeout + integrity checks), a **typed structured-error contract**, a NSFW gate that **fails safe**, resumable/cancellable scans with per-file fault tolerance, exemplary release-integrity artifacts (SHA256SUMS + SBOM + provenance + post-publish verification), and a broad test suite (`edge_cases.py` alone has 731 real assertions).

But three files hold most of the logic and most of the risk: **`enroll/manager.py` (6,132 lines, one `ProjectState` class, 165 methods), `api_server.py` (4,022 lines, a 641-line 96-branch dispatch), and `main.cjs` (3,476 lines, 8 subsystems).** And the highest-severity individual findings cluster around the product's own promise — **a locked workspace still serves private media, the Safe-Mode model is loaded without integrity verification, and the real model + privacy gate are never exercised in CI** (every job forces a heuristic fallback).

**No Critical findings; 16 High** (several overlapping), concentrated in five themes below. Most are *de-risked by the strong layering* — the recommended splits are mechanically safe because nothing low-level depends upward.

### Dimension scorecard

| Dimension | Grade | One-line state |
|---|---|---|
| **Module architecture** | C+ | Pristine leaf modules + clean layering, but two god-objects (manager 6.1k, api_server dispatch) hold ~13 responsibilities each. |
| **Data & persistence** | C+ | Hardened SQLite (WAL/FK/timeout) undercut by cross-process write drift, non-checkpointed backups, and no schema-version migrations. |
| **Concurrency / pipeline** | C | Deliberately serial & resumable (good fault tolerance) but a scan blocks *all* backend commands, forcing an out-of-band cancel file. |
| **Error & resilience** | B | Above-average: typed structured errors, fail-safe NSFW, per-file recovery. Gaps at startup, JSON durability, and a few silent swallows. |
| **Electron / IPC** | C+ | Strong hardening (isolation/sandbox/CSP/allowlist) but a god-file, a lock-bypassing media-trust set, and a 4-way stringly-typed contract. |
| **Performance** | B– | Sensible for the scale; flat (non-ANN) vector search, full index rebuilds, and single-image embedding are the scaling ceilings. |
| **Build / release / supply-chain** | C+ | Exemplary artifact/provenance discipline, weak *upstream*: unpinned unhashed deps, unverified safety model, unsigned binaries. |
| **Testing / observability** | C | Rigorous *breadth*, but CI never runs the real model/Safe-Mode path, accuracy gates don't gate, and the backend has no logging. |

---

## Cross-cutting themes (read these first)

Most findings collapse into **five recurring patterns**. Fixing the pattern fixes the cluster.

### Theme 1 — Three monoliths (the "fat core, thin edges" shape)
`ProjectState` (manager.py, 6,132 lines, 165 methods, ~13 responsibilities — **MA-1**), `DesktopApi.handle()` (api_server.py, a 641-line `if command ==` chain with **96 branches, zero `elif`** — **MA-2**) which *also* carries ~1,389 lines of dataset-benchmark logic that belongs in a service layer (**MA-3**), and `main.cjs` (3,476 lines, 8 subsystems, module-level mutable globals — **EIPC-01**). The leaf modules are small and single-purpose; the logic and the merge-conflict risk are concentrated in three places. *Every new feature edits one of these three files.*

### Theme 2 — Privacy-boundary gaps in a privacy-first product
The product's entire reason for being is local, consent-gated, Safe-Mode-gated review — yet: a **locked workspace still serves private images/files** for any path the renderer already holds, and prior-case paths leak across a workspace switch (**EIPC-02**); the **Safe-Mode NSFW model is loaded by globbing `*.onnx` with no checksum** while the *face* model is fully verified (**BRS-2**); and the **real Safe-Mode gate is never behaviorally tested** — every CI job forces the heuristic fallback (**TO-1**), and even the one test that loads the real model only checks its manifest, never runs `assess_image_safety` on an image (**MS-6**). Distribution is **unsigned/unnotarized** (**BRS-3**).

### Theme 3 — Data integrity under concurrency & crash
SQLite is well-hardened, but: DB writes **bypass the workspace state lock**, and a second process (MCP) opens the same DB, so JSON and SQLite state can **drift out of sync** (**data-persistence-1**); workspace backups **byte-copy a live DB + WAL + SHM with no checkpoint or lock**, capturing torn state (**data-persistence-3**); JSON state files are rename-atomic but **never `fsync`'d** (power-loss can zero a consent/reference file — **ER-02**); and there is **no schema-version migration path** (`SCHEMA_VERSION` is written but never read — **data-persistence-4**).

### Theme 4 — Serial backend & head-of-line blocking
The backend is deliberately single-threaded: the stdio loop runs each command to completion (**CP-01**), so a multi-hour scan **starves every other command** (status, cancel) — which is *why* the Electron side cancels via an out-of-band `.scan-cancel` file (**CP-02**), shared by three writers with a cross-cancel hazard. A single global **1-hour timeout** is applied to both a status poll and a giant scan (**CP-03**), and the in-memory candidates dict **grows for the whole scan with no eviction** (the likely OOM path — **CP-07**).

### Theme 5 — Stringly-typed contracts & ungoverned config drift
The command name contract is **duplicated in four hand-edited places** (Python 96 branches, preload 94-entry allowlist, TS union, a test's literal subset) with nothing enforcing parity (**EIPC-03 / MS-3**); request params have **no validation schema** (~129 inline `params.get` with ad-hoc coercion — **MA-4**); config is **40+ ungoverned env vars** with a half-finished `CROSSAGE_*`→`VINTRACE_*` rebrand where the *safety* toggles lack the new alias (**MS-1**); and the backend emits **English-only strings the renderer re-translates by exact string match**, so non-English locales silently show English for all backend messages (**MS-2**).

---

## Findings

Severity = real engineering consequence (change-cost, correctness, data-integrity, security-of-architecture, operability). Every High was verified against the cited lines.

### 🟠 HIGH

#### Structure
**MA-1 — `ProjectState` is a 6,132-line god-object with ~13 responsibilities, not an enrollment manager.**
`enroll/manager.py:105` — one class, 165 methods spanning scanning, enrollment, matching, candidate CRUD, media file ops, backup/restore/relink, 11 `export_*` reporters, accuracy packs, previews, repair, persistence, settings/consent, audit. *Impact:* maximal change-cost and merge-conflict surface; shared mutable `self` across 13 domains means a bug in one can corrupt unrelated flows; nothing is unit-testable in isolation. *Fix:* split along its seams into collaborators behind a thin aggregate root (WorkspacePersistence, Scanner/IngestOrchestrator, EnrollmentService, MatchingService, MediaActionService, BackupService, ReportExporter, AccuracyValidationService); move pure math to the tidy `match/` module. **Effort XL.** *(verified)*

**MA-2 — Command dispatch is a 641-line flat `if`-chain with no registry.**
`api_server.py:284-924` — `handle()` has **96 sequential `if command ==`** branches (0 `elif`), terminating in `raise ValueError("Unknown command")`. *Impact:* every new command edits one hot method (permanent merge magnet); the API surface is undiscoverable for docs/validation/auth/tests; the flat `if` re-checks every prior condition. *Fix:* a command registry (`dict` name→handler, or `@command("scan")` decorator), each handler taking validated params; lets consent/validation be declared per-command. **Effort L.** *(verified — exactly 641 lines, 96 branches)*

**MA-3 — The RPC server carries ~1,389 lines of dataset-benchmark business logic.**
`api_server.py:2254` (`public_dataset_benchmark`, 493 lines), `:2747` (164), `:1680`, + ~18 `_public_dataset_*` analysis helpers — ~28–35% of the file, none with any transport concern, while a sibling `dataset_benchmarks.py` already exists. *Impact:* the transport boundary owns heavyweight analytics that can't be reused or tested without instantiating `DesktopApi`. *Fix:* extract to a benchmarks service taking project/engine as args; leave thin delegating handlers. **Effort L.** *(verified; line/method totals slightly inflated but thesis holds)*

**EIPC-01 — `main.cjs` is a 3,476-line god-file of 8 subsystems with module-level mutable globals.**
`desktop/main.cjs:1-3476` — window, backend lifecycle, updater, tray/menu, protocol handler, diagnostics, folder-watch, locks, 32 IPC handlers, all over shared globals (`mainWindow`, `backend`, `folderWatch`, trust Sets…). *Impact:* high change cost, shared-global coupling, no isolation testing. *Fix:* split into `desktop/main/*` modules with injected singletons. **Effort L.** *(verified)*

#### Privacy / security boundary
**EIPC-02 — Media/shell path trust survives workspace lock and switch (lock bypass).**
`main.cjs:1347-1356, 2008-2017, 1742-1746` — the `vintrace-media://` handler and `shell:reveal/open` gate on `isTrustedMediaPath`/`isUserGrantedPath` with **no `isWorkspaceLocked()` check**; the trust Sets are never cleared on lock (`lockWorkspaceNow` only flips a boolean) nor on `set_workspace`, and `redactLockedState` sanitizes only the IPC *return value*, not the trust computation. *Impact:* a **locked** workspace still serves private images/files for any URL the renderer already holds, and a **switch leaks prior-case access**. Precondition: the renderer must already hold a valid media URL/path (hence High, not Critical). *Fix:* return `false` from the media/shell handlers when locked; clear the trust Sets in `lockWorkspaceNow` and on `set_workspace`. **Effort S.** *(verified line-by-line)*

**BRS-2 — The bundled Safe-Mode NSFW model is loaded with no integrity verification.**
`ingest/safety.py:301-316` globs `*.onnx` and feeds the first match to `ort.InferenceSession` — `grep sha256|checksum|hashlib` returns nothing, and the README invites an unverified third-party Marqo drop-in. The *face* model (`model_manager.py:417-435`) is fully SHA-256 + size + zip-integrity + zip-slip verified. *Impact:* the privacy gate runs *before* indexing/thumbnails/MCP; anyone who can write the model dir (or drops in an unverified export) can replace it with a no-op that marks everything SFW — defeating the gate with zero detection. *Fix:* verify an expected SHA-256 before constructing the session; **fail closed** on mismatch; add the hash to the SBOM. **Effort S.** *(verified)*

**BRS-3 — Releases ship entirely unsigned/unnotarized; update trust rests only on TLS + `latest.yml` hashes.**
`package.json` has no signing keys; both release workflows force `CSC_IDENTITY_AUTO_DISCOVERY=false` (the mac workflow is literally named "macOS Unsigned Release"). `allowDowngrade=false` but no publisher-signature pinning. *Impact:* SmartScreen/Gatekeeper warnings, and update integrity reduces to GitHub-hosted hashes over TLS with no cryptographic proof of origin — meaningful for a tool handling images of children. *Fix:* Developer-ID + notarization (mac) and Authenticode (win) via CI secrets before any non-private distribution; until then keep the explicit "private testing" framing and publish `SHA256SUMS` out-of-band. **Effort L.** *(verified; note: updater can be `generic` provider when `VINTRACE_UPDATE_URL` is set)*

#### Concurrency
**CP-01 — The scan pipeline is single-threaded and serial; a scan starves all other backend commands.**
`manager.py:1276-1278` (one `for raw_path in paths:` loop, detect+embed inline) + `api_server.py:3963-3984` (one `for line in sys.stdin:` running `handle()` to completion). Zero concurrency primitives. *Impact:* can't overlap I/O (hash/decode) with compute (ONNX); worse, every other command (status, cancel, export) sits in `main.cjs`'s pending Map for the scan's entire duration. *Fix:* run the scan in a dedicated worker thread so the stdio loop stays responsive to lightweight commands; optionally a bounded decode+embed pool. **Effort XL** (M to just move scan off-thread). *(verified)*

**CP-02 — A long scan blocks the stdio loop, forcing cancel/status through a shared `.scan-cancel` sentinel.**
`main.cjs:3329-3337, 2173, 2876` — three writers (user cancel, watch cancel, timeout recovery) write the same un-namespaced `.scan-cancel`; the backend polls `cancel_scan_path.exists()`. *Impact:* the IPC contract is bypassed by an undocumented filesystem side-channel, and a watch-triggered cancel can **silently cancel a user's manual scan** (and vice versa). *Fix:* per-run sentinels (`.scan-cancel-<runId>`); the durable fix pairs with CP-01 (cancel as a normal RPC). **Effort M.** *(verified)*

#### Resilience
**ER-01 — Backend startup runs outside the structured-error path; a missing/locked drive degrades to a generic `E-BACKEND-EXIT`.**
`api_server.py:3960-3962` constructs `DesktopApi` and emits `ready` *before* the `try`-wrapped stdin loop; `ProjectState.__init__` does an unguarded `self.root.mkdir(...)` (`manager.py:108`). A removed external drive / read-only path raises out of `serve()` and kills the process with a raw traceback. *Impact:* the **single most common real startup failure** bypasses the error-classification layer that already contains the exact codes (`E-FS-NOT-FOUND`, `E-BACKEND-PERMISSION`) needed to tell the user "reconnect the drive" vs "grant permission." *Fix:* wrap construction + first emit in a `try/except` that emits a structured startup-failure payload; pre-flight a writable check. **Effort M.** *(verified)*

#### Supply-chain
**BRS-1 — All Python dependencies are unpinned (`>=` floors), unhashed, no lockfile — non-reproducible builds, open supply-chain.**
`requirements*.txt` are all floor constraints (`onnxruntime>=1.23`, `insightface>=0.7`, `opencv>=4.8`…); `grep -c hash` = 0; no `constraints/poetry/uv` lock. CI installs with plain `pip install -r`. *Impact:* two builds of the same SHA can resolve different native ML trees, so the SBOM/provenance describe an unrepeatable artifact, and a compromised/breaking transitive release of native code inside the frozen backend is pulled silently. *Fix:* `pip-compile --generate-hashes` (or `uv lock`) committed; CI installs `--require-hashes`. **Effort M.** *(verified)*

#### Observability & test coverage of the real paths
**TO-1 — CI runs `CROSSAGE_FORCE_FALLBACK=1` job-wide, so real embedding and Safe-Mode inference are never tested.**
`qa.yml:19-20` (and *all* jobs in all three workflows) set it; `engine.py:340` returns the whole-image-histogram `FallbackEmbeddingEngine`, `safety.py:286` returns the heuristic. *Impact:* real ArcFace matching and the real ONNX NSFW gate (the privacy cornerstone) have **zero** automated coverage; a regression in InsightFace wiring or safety thresholding merges green. *Fix:* one CI lane with `onnxruntime`+`insightface` installed and cached models, running a real-engine smoke (enroll, match a known pair, confirm Safe-Mode flags a sensitive fixture) with fallback unset. **Effort L.** *(verified — "arguably understated": no job anywhere runs the real path)*

**TO-2 — Real-accuracy regression gates exist but never gate a merge.**
`dataset_regression_gates.py:88-99` enforces `minPrecision 0.90 / minRecall 0.45 / maxWrongIdentity 0` only under `if report_path:` from `VINTRACE_DATASET_GATE_REPORT`, which no workflow sets; the real report comes from `benchmarks/run_public_dataset_benchmarks.py`, referenced in no workflow. *Impact:* the recall-first cross-age quality claim has **no automated guardrail** — a model/threshold change that tanks recall or adds wrong-identity hits wouldn't fail CI. *Fix:* a nightly CI job over small cached slices that runs the benchmark then the gate with the env set. **Effort L.** *(verified)*

**TO-3 — No structured logging in the backend; exception tracebacks are dropped in shipped builds.**
`grep "import logging"` across ~17.4k LOC = 0; `structured_error` only fills `traceback` `if os.environ.get("CROSSAGE_DEBUG")`, which is set nowhere. *Impact:* on an offline field failure the only artifacts are a stackless client message + a bounded `stderrTail` + an audit log of *actions, not failures* — a crash in `manager.py`/`api_server.py` is effectively undebuggable without local repro. *Fix:* always write redacted tracebacks to a rotating `workspace/logs/backend-errors.jsonl` and include it in the support bundle; adopt stdlib `logging`. **Effort M.** *(verified — `CROSSAGE_DEBUG` has exactly one read site and zero set sites)*

#### Cross-cutting
**MS-1 — Configuration is 40+ ungoverned env vars with a half-done `CROSSAGE_*`→`VINTRACE_*` rebrand and no precedence policy.**
~31 `CROSSAGE_*` vs only 11 `VINTRACE_*` aliases; `registry_root()` reads both, but the **safety-critical** toggles (`CROSSAGE_FORCE_FALLBACK`, `CROSSAGE_SAFE_MODE_ENGINE`, `CROSSAGE_SAFE_MODEL`) have **no new alias**; `main.cjs` forwards only the workspace var when spawning. *Impact:* an operator setting `VINTRACE_SAFE_MODE_ENGINE` is silently ignored — and it's the safety toggles that are exposed. *Fix:* one config module enumerating `(new, legacy, type, default, validator)`, resolving precedence once, warning on legacy use; a test asserting every `CROSSAGE_*` has a `VINTRACE_*` alias. **Effort M.** *(verified)*

**MS-2 — The backend emits English-only strings the renderer re-translates by exact string match; non-English locales silently show English.**
`api_server.py:1637-1675` composes prose (`"Memory is critically low; preview work is reduced…"`, health details); the renderer renders `event.payload.memoryMessage` or maps it through `translateUiText`'s **exact-string** dict (`i18n.ts:677`). *Impact:* every dynamically-composed backend string (memory pressure, health, recommendations, Safe-Mode reasons) appears in English regardless of UI language, and any wording change in Python silently breaks the match — for an app that ships Arabic RTL. *Fix:* return stable message **keys + params** and let the renderer own wording (or pass a locale to the backend). **Effort L.** *(verified)*

**MS-6 — The real Safe-Mode model is loaded but its inference is never tested; the one un-stubbed test only checks manifest wiring.**
`pipeline_smoke.py:152-183` asserts `available is True` / `engine == "onnx-hybrid"` / label wiring but never calls `assess_image_safety` on a real SFW/NSFW image. *Impact:* the privacy gate's entire reason to exist has **zero behavioral test** against the real model; a broken preprocessing/label-index/threshold change passes CI yet fails open/closed in production. *Fix:* a small known-SFW/NSFW fixture set asserting `assess_image_safety` verdicts with the real model in a non-fallback lane. **Effort M.** *(verified — distinct from TO-1: even the un-stubbed test doesn't exercise it)*

---

### 🟡 MEDIUM (condensed)

| ID | Finding | Where | Fix | Effort |
|---|---|---|---|---|
| MA-4 | No request-validation schema — ~129 inline `params.get` with ad-hoc coercion | api_server.py:284-924 | Per-command schema (dataclass/TypedDict/pydantic) validated once at the boundary | M |
| MA-5 | 200–728-line methods with up to 12 nested closures defeat unit testing | manager.py:756 (`scan_paths`, 728 lines), :3462, api_server.py:1010 | Promote closures to methods / a `ScanSession` object | L |
| MA-6 / MS-8 | Atomic-JSON-write duplicated 3–4× with divergent behavior (one lacks `mkdir`); none `fsync` | manager.py:6051, workspace_registry.py:40, config.py:199 | One shared `write_json_atomic(…, fsync=True)` | S |
| data-persistence-1 | DB writes bypass the state lock; cross-process (backend+MCP) rely only on `busy_timeout` → JSON/DB drift | manager.py:320,1853; mcp_server.py:40 | One logical writer (route MCP via IPC) or extend the lock over DB txns | L |
| data-persistence-2 | Restore `stateSummary` queries a non-existent `candidates` table, error swallowed → silent zero-row restore | manager.py:3054-3061 | Use `review_candidates`; per-query try/except; warn on count mismatch | S |
| data-persistence-3 | Backup byte-copies live DB+WAL+SHM with no checkpoint/lock → torn/inconsistent snapshot | manager.py:2837-2846; workspace_db.py:1265 | `wal_checkpoint(TRUNCATE)` + lock, or `VACUUM INTO`; verify DB integrity on restore | M |
| data-persistence-4 | No schema-version migration: `SCHEMA_VERSION` written but never read; additive `ALTER` only, no downgrade guard | workspace_db.py:15,234-241 | `PRAGMA user_version`-gated ordered migrations; refuse newer-than-supported; round-trip test | M |
| CP-03 | Single global 1-hour command timeout mis-scaled for both fast reads and large scans | main.cjs:319,2849 | Per-command-class timeouts; progress-aware watchdog for scans | M |
| CP-04 | Double folder-walk: `analyze_folder` estimate pass + the scan's own discovery walk | api_server.py:1010; manager.py:1986 | Cache the discovered path list and feed it into `scan_paths`, or drop the pre-count | M |
| CP-05 | Memory-pressure signal is advisory only; the scan never throttles under pressure | api_server.py:1627; manager.py scan loop | On high/critical: checkpoint+flush, drop optional work, `gc.collect()`, degrade batch size | M |
| CP-07 | In-memory candidates dict grows for the whole scan (the likely OOM path); only the manifest is checkpointed | manager.py:909,1202,1274 | Stream accepted candidates to SQLite in batches and evict from RAM; add a backend RSS soak gate | L |
| ER-02 | JSON state writes are rename-atomic but never `fsync`'d — power-loss can zero a consent/reference file | manager.py:6051-6068 | `flush()+os.fsync()` the temp fd and the dir before replace | S |
| ER-04 | Engine-load failures collapse to a class-name string; the real ONNX/InsightFace error is discarded | embed/engine.py:347-362 | Log full `last_error` + include `str(exc)` in `model_status` detail | S |
| EIPC-03 / MS-3 | Command contract stringly-typed, duplicated in 4 places, only a partial one-directional sync test | preload.cjs:3; main.cjs:350; api_server.py; types.ts:1806 | Python registry → codegen the allowlist + TS union, or a set-equality CI test | M |
| EIPC-04 | Single-stdin JSON framing has no backpressure; `write()` return ignored | main.cjs:2833-2862 | Honor `write()`/drain or queue; bound `pending.size` with `E-BACKEND-BUSY` | M |
| EIPC-05 | Backend crash recovery is implicit lazy respawn with no backoff cap (crash-loop risk) | main.cjs:2702-2705,2803-2823 | Supervisor with capped backoff; emit a reconnect event | M |
| perf-01 | Flat (`IndexFlatIP`) vector search, linear per face, no ANN; all-pairs in `duplicate_people` | vector_store.py:56,178; manager.py:1129,1630 | ANN (IVF/HNSW) above a ref threshold; bound the dedupe `search_k` | L |
| perf-02 | Per-model index fully rebuilt on every invalidation though `add()` is O(1) | manager.py:245,290; vector_store.py:99 | Incremental `add()`/targeted removal instead of full rebuild | M |
| perf-03 | Embedding is single-image; no ONNX batching; rescue runs up to 6 variants/face | embed/engine.py:176,238; manager.py:1959 | Batched embedding API; gate rescue variants on low-end hardware | XL |
| perf-04 | Full sha256 read + native-res decode per file; resume can hash twice | image_io.py:236,201; manager.py:1349 | Always pass the resume hash to cached helpers; bounded-edge decode on low-end HW | M |
| BRS-4 | Desktop dual-ships frozen backend **and** the full `crossage_fr` source, but runtime uses only the frozen one — drift/bloat | package.json extraResources; main.cjs:1710 | Drop the source copy or hash-tie it to what was frozen | M |
| BRS-5 | QA never builds the installer it validates; release workflows run a thinner test subset than QA | qa.yml:100; macos-release.yml:57 | A `pack`/`build:backend` smoke on PRs; release reuses the full QA gate | M |
| BRS-6 | Auto-updater has no rollback/health-gating; `allowDowngrade=false` means a bad release can't be pulled back | main.cjs:1478-1594 | A documented rollback/recovery channel + a minimal post-update self-check | M |
| BRS-7 | `build-backend.cjs` hidden-import list is hand-maintained; meanshape pickle lookup fails silently | desktop/scripts/build-backend.cjs:12-62 | Fail the build loudly on lookup failure; `--collect-submodules`; real-insightface packaged smoke | M |
| TO-4 | Hand-rolled fail-fast test harness (no pytest/coverage/isolation); first failure masks the rest | edge_cases.py:2638; pipeline_smoke.py:294 | Adopt pytest + `conftest` fixtures + `coverage.py` | M |
| TO-5 | Audit log unbounded and re-scanned in full on every read (O(n)/query, no rotation) | manager.py:5949-5980 | Size-based rotation + running total, or move the trail into indexed SQLite | M |
| TO-6 | "Accuracy" tests validate the metric math on pre-baked scores, not the model | accuracy_benchmark.py:31; dataset_regression_gates.py:38 | Keep as metric/logic units (rename), pair with the real-model nightly (TO-2) | S |
| MS-4 | 67 `datetime.utcnow()` (deprecated) UTC stamps vs naive **local**-time photo capture-date | image_io.py:269; 67 sites | Centralize on `datetime.now(timezone.utc)`; record the chosen tz for media dates | S |
| MS-5 | Path-trust comparison is case-sensitive byte matching — wrong on Windows/macOS case-insensitive FS | main.cjs:1328-1366 | Canonicalize with `realpathSync.native` + case-fold (or stat inode/dev) at grant & check | M |
| MS-7 | Safety model + ORT sessions pinned via `lru_cache` for process lifetime; runtime model/config changes ignored | safety.py:291,427 | Key the cache on path + (size, mtime); or an explicit reset hook on settings change | S |

### 🟢 LOW / notes
ER-03 (raw CPython coercion messages leak to the renderer · api_server.py:291) · ER-07 (a few broad `except` swallow errors with no log/counter in reporting loops · manager.py:3437,3935) · CP-06 (ONNX session reused — good — but disposed only by GC on model switch · api_server.py:116) · CP-09 (watch & manual scans share one `ProjectState` + one cancel file · main.cjs:2376) · BRS-8 (~70 `fileAssociations` + `vintrace://` claimed at install — oversized OS footprint · package.json) · TO-8 (perf budgets are absolute ms with no headroom/margin tracking · performance_budget.py:163).

---

## What's already done well (protect these)

A balanced audit names the strengths — several are above-average for a 0.1.0 and the recommended refactors must preserve them:

- **Clean layering & no cycles (MA-7):** leaf modules (`ingest/embed/store/match/cluster`) have **zero upward imports** to `manager`/`api_server`. The proposed splits are mechanically safe because the foundation is stable.
- **One command seam reused by both frontends (MA-7):** `mcp_server.py` routes everything through `DesktopApi.handle()`, so fixing dispatch (MA-2) improves desktop *and* MCP at once.
- **Hardened SQLite:** `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=30000`, `foreign_keys=ON`, parameterized queries (no SQL-injection surface found), plus `integrity_check`/`foreign_key_check` in repair.
- **Typed structured-error contract (ER-05):** every RPC exception → `{code, category, severity, recoverable}` via a 13-entry mapping; tracebacks hidden unless debug. Per-file scan failures are recorded to a manifest and the scan continues; cancellation is cooperative and **hash-resumable**.
- **The NSFW gate fails SAFE (ER-06):** on model error it **preserves the heuristic verdict**, never defaults `sensitive=False` — correct fail-closed direction for a privacy gate, and tested.
- **Solid resource lifecycle (CP-08, CP-06):** OpenCV captures released in `finally`, ffmpeg via `subprocess.run` with explicit timeouts inside `TemporaryDirectory`, short-lived context-managed DB connections, a single cached/reused ONNX engine (no per-scan session leak).
- **Exemplary release integrity (BRS-9):** every release emits a sorted **SHA256SUMS + SBOM + build-provenance**; the face-model download is **SHA-256 + size + zip-integrity + zip-slip** verified with atomic install/resume; a post-publish verifier re-downloads and compares digests. Updater is conservatively configured (`autoDownload`/`autoInstallOnAppQuit`/`allowDowngrade` all off).
- **Strong test breadth & fault injection (TO-7):** `edge_cases.py` = 731 real assertions / 47 scenarios (not smoke prints); corrupt-workspace and corrupt-SQLite recovery; a real `ThreadingHTTPServer` with HTTP Range to test resumable downloads; strict support-bundle redaction tests; persisted benchmark history.
- **Electron hardening:** `contextIsolation`/`sandbox`/`nodeIntegration:false`, a strict CSP, a preload **allowlist** bridge, and all 32 IPC handlers assert the sender.

---

## Remediation roadmap

Sequenced by **(risk-reduction ÷ effort)**. The privacy-boundary cluster leads because it's both high-impact and cheap.

### Phase 1 — Boundary & integrity quick wins (days; mostly S) — ✅ IMPLEMENTED 2026-06-13
*Verified with `vite build`, `node --check`, Python imports, and `edge_cases` / `pipeline_smoke` / `workspace_backup_roundtrip`. Not yet committed.*
1. **EIPC-02 ✅** — media (`vintrace-media://`) and `shell:reveal/open` handlers now deny when `isWorkspaceLocked()`; a new `clearPathTrust()` empties the media/shell trust Sets on lock and at the start of a `set_workspace` switch (before the new state re-grants). *(main.cjs)*
2. **BRS-2 ✅** — `_verify_model_integrity()` checks the model file's SHA-256 against the manifest's `sha256` before building the ONNX session; mismatch raises in `model` mode and otherwise **fails closed to the heuristic gate**. The bundled model's manifest now carries its hash (`d25aa73f…`). *(safety.py)*
3. **ER-02 + MA-6/MS-8 ✅** — one `atomic_write`/`atomic_write_text` (temp → `fsync` file → `os.replace` → `fsync` dir) in `workspace_registry`; `manager` (compact + streamed), `config` (indented), and the registry writer all route through it, preserving their on-disk formats. *(workspace_registry/manager/config)*
4. **data-persistence-2 ✅** — restore now queries the real `review_candidates` table, runs each count independently, and returns `warnings` on count mismatch / read failure. *(manager.py)*
5. **MS-7 ✅** — the safety-model and ONNX-session caches are keyed on `(path, size, mtime)`, so replacing the model file invalidates them without a restart. *(safety.py)*
6. **ER-01 ✅** — `serve()` wraps `DesktopApi` construction + first emit in the structured-error path, emitting `{ready:false, error}`; `main.cjs` rejects the ready-promise with the actionable code (verified: a non-writable workspace now yields `E-FS-NOT-DIRECTORY`, not a generic `E-BACKEND-EXIT`). *(api_server.py + main.cjs)*

### Phase 2 — Make the real paths verifiable — ✅ MOSTLY IMPLEMENTED 2026-06-13
*Verified locally with the full Python smoke suite, `vite build`, `node --check`, valid workflow YAML, and a `--require-hashes` dry-run of the lock. Not yet committed. CI-dependent lanes (nightly, hashed install on win/mac) need a CI run to validate end-to-end.*
7. **MS-6 ✅ / TO-1 (partial)** — `tests/safety_model_inference.py` runs the **real ONNX Safe-Mode model** (no fallback) and asserts it loads (`onnx-hybrid`), scores in `[0,1]`, doesn't flag a benign image, and is deterministic — the first behavioral test of the privacy gate. Wired into `qa.yml` as a non-fallback step (model is committed, no download). *The real **embedding** test (enroll/match a known pair) still needs face fixtures — deferred.* *(safety_model_inference.py + package.json + qa.yml)*
8. **TO-2 ✅ (scaffolded)** — new `.github/workflows/nightly-accuracy.yml` runs the real engine over the auto-downloadable CALFW/CPLFW slices and enforces `dataset_regression_gates` with `VINTRACE_DATASET_GATE_REPORT` set. YAML validated; needs a scheduled CI run to confirm dataset/model provisioning. *(nightly-accuracy.yml)*
9. **TO-3 ✅** — `record_backend_error()` always writes a **redacted, rotating** `<workspace>/logs/backend-errors.jsonl` (workspace→`<workspace>`, home→`~`) on every backend exception incl. startup; `recent_backend_errors()` ships it in the support bundle. Verified: redaction, read-back, and bundle inclusion. *(api_server.py)*
10. **BRS-1 ✅** — committed `requirements-production.lock.txt` (universal, py3.11, **1,176 hashes** via `uv pip compile --generate-hashes --universal`); all three workflows now `pip install --require-hashes` from it. Verified installable via a `--require-hashes` dry-run. *(requirements-production.lock.txt + qa/macos/windows workflows)*
11. **data-persistence-3 ✅** — backups now archive a transactionally-consistent **`VACUUM INTO`** DB snapshot and **never include the live `-wal`/`-shm`**. Verified: archived DB is a valid SQLite file, no WAL/SHM, roundtrip restore passes. *(workspace_db.py + manager.py)*
12. **CP-03 ✅ / CP-02 ⏸️** — CP-03: replaced the single 1h timeout with a **progress-aware watchdog** (fails only after real backend silence, not when a fast read queues behind an actively-progressing scan), preventing the old "kill the backend mid-scan" failure. CP-02 (per-run cancel sentinels) **deferred** — the runId is backend-generated, so a correct cross-process cancel handshake needs runtime scan verification. *(main.cjs)*

### Phase 3 — Structural (the durable investment) — ◑ PARTIAL 2026-06-13
*The safe, verifiable structural wins are implemented; the genuinely XL refactors (god-file decomposition, scan-threading) are **deliberately not done blind** — they need runtime verification on a shipping app and an incremental, reviewed approach. A concrete playbook for them is below.*

- **EIPC-03/MS-3 ✅** — `tests/command_contract.py` makes the Python dispatch the single source of truth and **fails CI if the preload allowlist drifts** (verified to catch both a missing entry and a stale entry). Wired into `qa.yml`. The `ping`/`record_audit` main-process-only commands are documented as `INTERNAL_COMMANDS`. *(MA-2/MA-4 full registry + param schema → playbook.)*
- **MS-1 ✅** — new `crossage_fr/runtime_env.py` resolves config with one precedence rule (`VINTRACE_*` → legacy `CROSSAGE_*` → default); the **safety-critical toggles** (`FORCE_FALLBACK`, `SAFE_MODE_ENGINE`, `SAFE_MODEL`, `SAFE_MODEL_DIR`) now honor both names (verified — the new `VINTRACE_*` names were previously silently ignored). *(Migrating the remaining ~27 legacy reads → playbook.)*
- **BRS-3 ◑** — macOS `hardenedRuntime` + entitlements (`desktop/assets/entitlements.mac.plist`, allowing the bundled native backend libs under hardened runtime) wired into `package.json` (inert until signing is enabled); the full signing/notarization enablement (secrets, config, process) is documented in `RELEASES.md`. The remaining blocker is obtaining certificates — an org decision, not a code change.
- **MS-2 ⏸️ / MA-1 ⏸️ / MA-3 ⏸️ / EIPC-01 ⏸️ / CP-01 ⏸️ / CP-07 ⏸️** — deferred (see playbook). These touch the 6,132-line `ProjectState`, the 4,022-line `api_server.py`, the 3,476-line `main.cjs`, and the serial scan loop; doing them as blind batch edits risks regressions that static verification (tsc/imports/smoke) can't catch.

### Phase 3 decomposition playbook (for the deferred XL items)
Do these **incrementally, each behind its own PR with runtime verification**, not as one batch:

1. **MA-3 (extract benchmark logic, L)** — the safest first move. Move the ~1,389 lines of `public_dataset_*` / `model_distribution_audit` methods from `DesktopApi` into a `crossage_fr/benchmarks/` service taking `(project, engine)` as args; leave thin delegating stubs. Verify with `mcp_smoke` + the dataset benchmark tests. This shrinks `api_server.py` ~28% with low coupling.
2. **MA-1 (decompose `ProjectState`, XL)** — start with the **pure functions** (`_cosine_similarity` is dead code — delete it; `_accuracy_at_threshold` and the `_valid_*`/`_accuracy_*` math have no `self` use — move to `match/scoring.py`). Then peel off cohesive collaborators one at a time behind the existing facade: `BackupService` (export/verify/restore/relink/prune), `MediaActionService`, `ReportExporter` (the 11 `export_*`), `Scanner` (the 728-line `scan_paths` + its 12 closures → a `ScanSession` object). Each peel is a PR; `edge_cases`/`pipeline_smoke`/`backup_roundtrip` are the regression net.
3. **MA-2 + MA-4 (command registry + param schema, L)** — replace the 96-branch `if`-chain with a `dict`/decorator registry keyed by the same names `command_contract.py` already validates; attach a per-command param dataclass validated once at the boundary. The contract test guards the surface during the migration.
4. **EIPC-01 (split `main.cjs`, L)** — extract the 8 subsystems (window, backend lifecycle, updater, tray, protocol, diagnostics, folder-watch, locks) into `desktop/main/*` modules with injected singletons; the e2e suite (`packaged`, `ipc-security`) is the net.
5. **CP-01 + CP-07 (scan off-thread + candidate streaming, XL)** — run the scan in a worker thread so the stdio loop answers `status`/`cancel` live (lets CP-02's per-run sentinel become a normal RPC); stream accepted candidates to SQLite in batches and evict from the in-memory dict. **Requires** a real large-library scan harness + a backend-RSS soak gate before merge.
6. **MS-2 (backend message keys, L)** — change backend user-facing strings to `{code, params}` and let the renderer own wording; add a CI check that every key has an i18n entry.

### Phase 1–2 (✅ implemented 2026-06-13) — see the status notes above.

### How to validate
- **Boundary:** an e2e test that locks the workspace and asserts a previously-valid `vintrace-media://` URL returns 403 (EIPC-02); a Safe-Mode test with a tampered model asserting fail-closed (BRS-2).
- **Integrity:** a crash-injection test around `write_json_atomic` (ER-02) and a backup-during-scan restore-integrity test (data-persistence-3); a schema-migration round-trip (data-persistence-4).
- **Real paths:** the new non-fallback CI lane is itself the regression net for TO-1/MS-6/TO-2.
- **Concurrency:** a test that issues a `status` command mid-scan and asserts a bounded response time (CP-01/CP-02), plus a backend-RSS assertion in `scale_benchmark` (CP-07).

---

## Appendix — measured metrics (verified)

| Metric | Value | Source |
|---|---|---|
| Backend size | ~17,428 lines across `crossage_fr/` | `wc -l` |
| `manager.py` / `ProjectState` | 6,132 lines · 1 class · 165 methods | grep |
| `api_server.py` / `handle()` | 4,022 lines · dispatch = 641 lines, **96 `if command ==`**, 0 `elif` | grep |
| `main.cjs` | 3,476 lines · 8 subsystems · 32 IPC handlers · module-level globals | grep |
| Upward deps (leaf → manager/api) / circular imports | 0 / 0 | import scan |
| Inline `params.get` reads in `handle()` | ~129, no schema | grep |
| Duplicated `write_json_atomic` impls | 3–4 (divergent; none `fsync`) | grep |
| SQLite PRAGMAs | WAL, synchronous=NORMAL, busy_timeout=30000, foreign_keys=ON | workspace_db.py:57-60 |
| Schema migration framework | absent (`SCHEMA_VERSION` written, never read) | workspace_db.py:15,234 |
| Scan threading model | single-threaded, serial; 0 concurrency primitives | manager.py:1276; api_server.py:3963 |
| Global backend command timeout | 3,600,000 ms for *all* commands | main.cjs:319 |
| Cancellation | shared `.scan-cancel` file, 3 writers | main.cjs:3333,2173,2876 |
| Candidates kept in RAM | full dict, up to 50k–100k, no mid-scan eviction | manager.py:909,1274 |
| `except Exception` (manager / api_server) | 8 / 11 · bare `except:` = **0** | grep |
| Structured error-code mappings | 13 (category/severity/recoverable) | api_server.py:3919 |
| `fsync` in JSON persistence | 0 | manager.py:6051 |
| Python deps pinned / hashed | 0 / 0 (all `>=` floors, no lock) | requirements*.txt |
| Node deps | `package-lock.json` v3 + `npm ci` (reproducible) | — |
| Code signing / notarization | none | package.json; release workflows |
| Release integrity artifacts | SHA256SUMS + SBOM + provenance + post-publish verify | create-release-artifacts.cjs |
| Face-model download verification | sha256 + size + zip-integrity + zip-slip | model_manager.py:417 |
| Safety NSFW model verification | **none** (glob `*.onnx`) | safety.py:301 |
| CI tests on the real ONNX/InsightFace path | **0** (all jobs force `CROSSAGE_FORCE_FALLBACK=1`) | qa.yml:19 |
| Real-accuracy gates enforced in CI | 0 of 5 (`VINTRACE_DATASET_GATE_REPORT` set nowhere) | dataset_regression_gates.py:165 |
| Backend `logging` / `print` calls | 0 / 0 | grep |
| `datetime.utcnow()` (deprecated) call sites | 67 (UTC) vs naive-local photo date | image_io.py:269 |
| Config env vars | ~31 `CROSSAGE_*` + 11 `VINTRACE_*` (half-done rebrand) | grep |
| Command contract copies | 4 (Python 96 / preload 94 / TS union / test subset) | grep |
| `edge_cases.py` | 2,692 lines · 731 assertions · 47 scenarios | grep |

---

*Generated by an eight-dimension multi-agent staff audit with adversarial verification of every High finding. Each `file:line` citation was independently re-checked against the source. Scope was deliberately limited to backend/platform architecture, engineering principles, and optimization; the UI/UX pass is in [docs/uiux-performance-audit.md](uiux-performance-audit.md). A dedicated security review (threat-model, the `vintrace://` deep-link surface, the MCP exposure) is recommended as a follow-up.*

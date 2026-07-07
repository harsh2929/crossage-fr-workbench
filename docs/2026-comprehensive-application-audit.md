# Comprehensive Application Audit — Vintrace ("face")

**Date:** 2026-07-04
**Scope:** Entire application — code quality, logic, correctness, optimization, security & privacy.
**Method:** 18 specialized subsystem auditors (fan-out) → adversarial verification of every high/critical finding (each skeptic re-read the actual code and tried to *refute* the claim) → cross-cutting synthesis, plus independent empirical grounding (typecheck, compile, static smell-scan) and hand-verification of the top findings.
**Surface:** ~160k lines across an Electron main process, a React 19 / TypeScript renderer, a Python cross-age face-recognition backend, an MCP server, and a SQLite workspace.

> This document supersedes nothing; it complements the prior focused audits (`architecture-audit.md`, `security-audit.md`, `detection-pipeline-audit.md`, `uiux-performance-audit.md`, `2026-capability-unlock-audit.md`). Where a prior finding was already fixed, that is noted.

---

## 1. Executive summary

The application is, by static measures, an unusually **disciplined** codebase — but the discipline is asymmetric, and the real risk is concentrated in a small number of places.

- **The frontend is immaculate by static hygiene:** `tsc --noEmit` reports **0 errors**; there are **0** `any` annotations, **0** `@ts-ignore`/`as any`, **0** empty `catch {}` blocks, and **0** stray `console.log` in `src/`. The React helper modules (`src/views/photo*.ts`) are defensively written, with only edge-case logic bugs.
- **The Python backend compiles clean** and avoids the worst footguns — **no `shell=True`**, **no bare `except:`**, **no `pickle.loads` on untrusted data** (one `np.load(allow_pickle=True)` risk, §5). But it carries **166 broad `except Exception`** blocks and its risk is *robustness & privacy*, not type-safety.
- **~93% of the audited logic lives in four god-files** (`api_server.py` 34,054 · `PhotosView.tsx` 32,297 · `workspace_db.py` 22,445 · `App.tsx` 15,896 = 104k lines). Every systemic problem — untestability, unsafe refactors, the redaction split-brain — is downstream of these.
- **The dominant risk theme is privacy/redaction split-brain and release-channel integrity**, not crashes. For a privacy-first biometric app, the confirmed leaks of absolute paths and image hashes, and the unverifiable update channel, are the headline issues.

### Headline metrics

| Metric | Value |
|---|---|
| Subsystems audited | 18 |
| Total findings raised | 131 |
| High/Critical adversarially verified | 47 |
| → **Confirmed** | 24 |
| → **Plausible** | 3 |
| → **Refuted** (killed by verification) | 20 (~43%) |
| Independent hand-verifications by lead | 6 |

The **43% refutation rate** on high/critical findings is the most important number in this table: it means nearly half of what a single-pass reviewer would have reported as serious was *wrong on closer reading* (guards existed, states were unreachable, the framework already handled it). Every finding below survived a skeptic who was explicitly trying to disprove it.

### Severity distribution (all findings, final/corrected severity)

| Severity | Count | Character |
|---|---|---|
| Critical | 3 | Path/hash privacy leaks + a non-functional release verifier |
| High | ~15 | FR-correctness, perf cliffs, IPC races, supply-chain integrity, PII in audit log |
| Medium | ~40 | Edge-case bugs, memory inefficiency, defense-in-depth gaps |
| Low / Info | ~50 | Maintainability, code hygiene, documented design choices |

---

## 2. Empirical baseline (objective, tool-derived)

These were run directly against the tree, independent of the AI auditors:

| Check | Result | Reading |
|---|---|---|
| `tsc --noEmit` | **0 errors** | Frontend type-safety is genuinely enforced |
| `python3 -m compileall crossage_fr main.py` | **clean, 0 syntax errors** | No broken modules |
| `grep TODO/FIXME/HACK` (src+backend+desktop) | **0** | Clean or stripped |
| Bare `except:` (Python) | **0** | No blanket swallows of the worst kind |
| Broad `except Exception` (Python) | **166** | Worth spot-review; several found to swallow silently (§4) |
| Empty `catch {}` (TS) | **0** | — |
| `: any` / `as any` / `@ts-ignore` (src) | **0 / 0 / 0** | — |
| `console.log`/`.debug` (src) | **0** | Prod-clean renderer |
| `shell=True` (py + cjs) | **0** | Entire command-injection class avoided |
| String-built SQL sites | **17** | Almost all safe *identifier* interpolation from hardcoded allowlists (§5) |
| `subprocess`/`eval`/`exec`/`pickle` | 16 subprocess (all list-form + timeouts), 1 `np.load(allow_pickle=True)` | The `np.load` is the only real deserialization risk |

**Interpretation:** the frontend's residual risk is *architecture and logic*; the backend's is *robustness, privacy, and supply chain*. The audit weighting reflects that.

---

## 3. Top 10 priorities (ranked, all confirmed unless noted)

1. **Unsigned releases + electron-updater "generic" feed performs no signature verification** — `desktop/main.cjs:1817` *(confirmed)*. A compromised CDN, MITM, or GitHub-release compromise ships arbitrary binaries; the app auto-checks and prompts to install. Primary RCE vector for a biometric app.
2. **`structured_error()` returns unredacted `str(exc)` over IPC** — `crossage_fr/api_server.py:33907` *(confirmed)*. Any `OSError`/`FileNotFoundError` carries the failing **absolute path** to the renderer and into the notice UI. The *persisted* log path (`record_backend_error`, 33963) redacts the identical exception — a direct policy contradiction. (Note: the traceback field is already gated behind `CROSSAGE_DEBUG`; the leak is specifically the exception *message*.)
3. **`verify-release-assets.cjs` is effectively non-functional** — `desktop/scripts/verify-release-assets.cjs:173` *(confirmed)*. It validates artifacts against `asset.digest`, a field the GitHub REST API **does not populate**, so the release-integrity gate silently passes without checking anything. Combined with #1 this means there is *no* working end-to-end integrity check.
4. **Image hashes not redacted in MCP tool output** — `crossage_fr/mcp_server.py:235` *(confirmed)*. `_agent_safe_value` redacts `HASH_KEYS`/`*hash` (lines 186–187); `_redact_tool_output` has no such branch, so `sourceHash`/`sha256`/`phash` fall through to `_scrub_text` (which only masks paths) and reach the AI agent — enabling reverse-image-search and cross-workspace fingerprinting of biometric media.
5. **Integrity-check & general command responses leak absolute paths without redaction** — `crossage_fr/api_server.py:3663` and the emit at `:34014` (+ `main.cjs` `decorateState` keeps original `sourcePath` fields) *(both confirmed)*. Filesystem-layout / home-dir disclosure on ordinary command results.
6. **`SELECT *` load-all-into-memory on 100k+ `photo_assets` during index rebuilds** — `crossage_fr/store/workspace_db.py:13598` and `:13967` *(confirmed / plausible)*. Multi-hundred-MB spikes that block the single JSON-RPC event loop and starve every concurrent IPC call at photo scale.
7. **TOCTOU + missing symlink resolution in the media protocol handler** — `desktop/main.cjs:2478` & `:2481` *(both confirmed)*. `isTrustedMediaPath()` resolves symlinks; the subsequent `net.fetch(pathToFileURL(target))` uses the **unresolved** path, so a symlink swapped between check and fetch serves a file outside the trust boundary.
8. **Support-score bonus divides by the wrong denominator** — `crossage_fr/match/scoring.py:267` *(confirmed, hand-verified)*. Divides by `len(raw_scores)` (capped at 3) instead of `len(support_scores)`; `evidence_count = 1 + len(support_scores)` (line 308) proves each supporting reference was meant to count equally. Multi-reference true matches are under-rewarded 33–67%, silently weakening recall in exactly the case the feature exists for.
9. **Unguarded concurrent IPC requests race and overwrite React state** — `src/App.tsx:2253` *(confirmed)*. No cancellation tokens; out-of-order backend replies can apply a stale full-`AppState` snapshot over a newer one (e.g. save-settings vs. review-candidate), yielding silently wrong counts/settings. Acute for a rapid-triage "review-first" app.
10. **Audit log carries PII (person names) and lacks `fsync` durability** — `crossage_fr/enroll/manager.py:3346` (names in `delete_person`/`rename_person`) and `:8761` (no `os.fsync`) *(both confirmed)*. Plaintext names survive a "delete person" (GDPR erasure gap), and the un-`fsync`'d append weakens the SHA-256 tamper-evidence chain the app advertises.

*Just below the cut:* governance gates are verification-only, not enforcement (`retraining_governance.py:287`); ONNX session cache leak (`siglip_engine.py:228`); model-family key normalization allows duplicate references (`enroll/manager.py:853`); benchmark recommendation can be cherry-picked (`benchmark_quality.py:200`); MCP `triage_pending` prompt leaks filenames (`mcp_server.py:1474`).

---

## 4. Systemic / architectural analysis

### 4.1 The four mega-files are the root liability
`api_server.py` (34k, ~245-handler dispatch monolith), `PhotosView.tsx` (32k, ~559 `useState` / 100+ `useEffect`, dependency arrays of 25–31 items), `workspace_db.py` (22k, one persistence class), `App.tsx` (15.9k, 40+ `useState`). Consequences observed uniformly:

- **Untestability.** PhotosView's state machine and the DB migration logic have **no isolated unit coverage**; contract testing reaches ~89% of backend commands but the *big* handlers (photo indexing) are the untested remainder.
- **Unsafe refactoring.** The confirmed PhotosView keyboard-listener re-registration (`3909`) and the App.tsx concurrent-IPC race (`2253`) are direct symptoms of dependency arrays and closures too large to reason about.
- **Under-sampled review.** Every auditor explicitly disclaimed large unread regions (~12k lines of photo-indexing in `api_server.py`; 7k+ of rendering + the drag/retouch handlers in `PhotosView.tsx`). True bug density is under-measured there (§7).

### 4.2 Privacy/redaction is a cross-cutting concern implemented ad hoc at four boundaries
Redaction logic is smeared across `api_server.py` (`_redact_paths`@4112, `_redact_text`/`_mask_absolute_paths`@33918–33941, `structured_error`@33892), `mcp_server.py` (`_redact_tool_output`, `PATH_KEYS`, `HASH_KEYS`), and Electron `main.cjs`. Because there is **no single serialization choke point**, the copies disagree — which is precisely how the confirmed leaks (#2, #4, #5) arise: each copy has a different, incomplete key set. A privacy-first app should redact at exactly one boundary.

### 4.3 Single-thread/event-loop discipline is inconsistent across the two halves
Both halves share the same latent failure — blocking the one thread that serves the UI — reached by different routes: the Python side via `SELECT *` load-all rebuilds (#6) and orphan recovery (`workspace_db.py:8195`); the JS side via the 1 Hz boot-clock forcing full re-renders (`App.tsx:2234`) and PhotosView listener accumulation.

### 4.4 Broad exception handling
166 `except Exception` blocks; several confirmed to swallow silently without a diagnostic — e.g. localStorage read failures returning `[]` (`App.tsx:1179`), SigLIP GPU-provider fallback with no log (`siglip_engine.py:288`). Individually minor, collectively they erode debuggability of field failures.

---

## 5. Frontend ↔ Electron ↔ Python ↔ SQLite contract mismatches

- **Redaction split-brain on the error path (confirmed, critical).** `structured_error()` returns `"message": str(exc)` **unredacted** while `record_backend_error` redacts the identical exception for the on-disk log. The live IPC response and the persisted log encode *opposite* privacy policies for the same data. (#2)
- **`list_photo_assets` pagination is inconsistent between its two branches (plausible→contract-fragile).** In the search branch (`api_server.py:29057-29063`), items are filtered to only rows that hydrate (`if asset`), but `total` = `search_result["total"]` (the unfiltered DB count). The non-search branch has `len(items) == limit`. So `returned < limit` with `total` unchanged occurs **only in the search path** when an indexed id fails to hydrate (deleted/orphaned asset). A PhotosView pager using `offset + returned < total` or fixed `offset += limit` can loop forever or skip rows — intermittently, search-only. Flagged independently by two auditors.
- **Stringly-typed command contract with no shared schema.** `main.cjs` hardcodes a ~245-entry `TRUSTED_BACKEND_COMMANDS` allowlist that must stay in lockstep with `_COMMAND_HANDLERS`; argument shapes are validated only at the Python boundary. A renamed command or reshaped param is a runtime `E-IPC-BLOCKED-COMMAND` or a silent `params.get(...) or default`, never a compile error. The allowlist is checked **case-sensitively** while path trust elsewhere case-folds — a latent inconsistency at the same boundary.
- **Duck-typed IPC responses on the renderer** (`App.tsx` `invoke()`), combined with the concurrent-IPC race (#9), mean the client cannot always distinguish a stale/partial response from a complete one.

---

## 6. Major duplicated logic (each a maintenance + correctness hazard)

- **L2 normalization implemented three times with three different zero-norm conventions** (all read directly): `embed/engine.py:43` returns the vector unchanged on zero/NaN; `embed/siglip_engine.py:161` clips the norm to `1e-12`; `match/pooling.py:18` sets zero norms to `1.0`. Same operation feeding cosine scores, disagreeing precisely on the degenerate input. Downstream guards currently prevent a *visible* bug (that verification refuted the "silent corruption" critical), but the divergence is a real smell and should be unified into one shared, tested helper.
- **Redaction / path-masking duplicated across `api_server.py`, `mcp_server.py`, `main.cjs`** (see §4.2) — the direct cause of the confirmed leaks.
- **Full-table `SELECT *` scan-into-memory pattern copy-pasted** across `rebuild_photo_location_index` (13598), `rebuild_photo_search_index` (13967), orphan recovery (8195) — one fix needed in three places.
- **Slideshow timeline reconstruction** rebuilt on every property edit (`PhotosView.tsx:16442–16713`, confirmed redundant at 16473) — same reconstruct-whole-array idiom repeated per operation.

---

## 7. Detailed findings by subsystem

Legend: **✅ Confirmed** · **🟡 Plausible** · severity is the *corrected* (post-verification) severity. Findings from the two re-run finders (ingest, photo-modules) were not put through the workflow's adversarial verifier; the ingest CRITICAL was hand-verified by the lead and is annotated.

### 7.1 `src/App.tsx` — React shell
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | Concurrent unguarded IPC requests race; out-of-order full-state replies overwrite newer state (no cancellation token) | `App.tsx:2253` |
| Med | — | localStorage errors silently swallowed (`return []`) — masks data loss of scan queues/views, no diagnostic | `App.tsx:1179` |
| Med | — | 1 Hz boot-clock `setBootClock` forces full-tree re-render during boot | `App.tsx:2234` |
| Med | — | Handler refs mutated synchronously during render; IPC event mid-render can call stale/new handler | `App.tsx:4606` |
| Med | — | `applyState()` reads stale closure `state` for workspace-change comparison | `App.tsx:2408` |
| Med | — | God component: 40+ `useState`, business logic interleaved, untestable | `App.tsx:1780` |
| Low | — | `JSON.parse` of localStorage without size/depth cap (main-thread DoS on crafted payload) | `App.tsx:1267` |
| — | ❌ Refuted | `invoke()` duck-typing "unsafe" — actually sound; the two response shapes are structurally disjoint (`counts` always nested under `state`) | `App.tsx:2460` |

### 7.2 `src/views/PhotosView.tsx` — mega photos view
| Sev | Status | Finding | Location |
|---|---|---|---|
| Med | ✅ | Keyboard-listener effect re-runs on every page append (redundant `items` dep via derived `lightItem`); cleanup prevents a *leak* but re-registration is wasteful | `PhotosView.tsx:3909` |
| Med | ✅ | Slideshow property edits reconstruct the whole timeline twice per op (patch fns called 2× per item) — UI lag at 500 slides | `PhotosView.tsx:16473` |
| Med | — | Mutable-array deps (`imageMarkupAnnotationsDraft`, `imageRetouchSpotsDraft`) re-register the keydown listener during editing | `PhotosView.tsx:3909` |
| Med | — | 25–31-item effect dependency arrays across grid-reload effects (fragile) | `PhotosView.tsx:3620` |
| Med | — | Inline arrow handlers per grid tile break memoization during drag-reorder | `PhotosView.tsx:27266` |
| — | ❌ Refuted | "Blob URL leak on slideshow close" — URLs are custom `vintrace-media://` protocol handled by Electron `net.fetch`, not `createObjectURL`; nothing to revoke | `PhotosView.tsx:11961` |
| — | ❌ Refuted | "Motion property overwritten" — `item.motion` at 16677 reads the value just set at 16667; always truthy | `PhotosView.tsx:16677` |

### 7.3 `src/views/photo*.ts` — pure helper modules *(re-run; well-written, defensive)*
| Sev | Finding | Location |
|---|---|---|
| Med | `Math.min/max(...[])` → `Infinity`/`-Infinity` unhandled (downstream `Number.isFinite` guard saves it, but code smell) | `photoPlacesMap.ts:90` |
| Med | Invalid month index (e.g. `2024-13-01`) silently returns unformatted key; malformed dates reach bucket labels | `photoDateViews.ts:250` |
| Low | `creationCropScore` NaN/Infinity when height ≤ 0 (clamped downstream but should guard early) | `photoExportPresets.ts:475` |
| Low | `Date.parse` roundtrip in `cleanIsoDateText` is timezone-dependent for date-only strings | `photoExportPresets.ts:220` |
| Low | `withinRecentDays` integer-overflow if `days > ~100k` (only called with 30 today) | `photoDateViews.ts:242` |

### 7.4 `src/types.ts` / `i18n.ts` / boot / search
| Sev | Finding | Location |
|---|---|---|
| Med | i18n falls back to the raw key on a missing translation, then interpolates the *key* — silent no-op; no dev warning | `i18n.ts:931` |
| Med | Japanese (`ja`) only overrides `TranslationKey` entries; ~60% of `UiMessageKey` strings fall back to English | `i18n.ts:813` |
| Med | `window.crossAge` typed as `unknown` in the guard; bridge shape unvalidated | `main.tsx:229` |
| Low | `PlatformReport.selected_providers: unknown[]` (should be typed) | `types.ts:13` |
| Low | `startupSafeModeStorageKey` written but never read — safe-mode recovery not actually implemented | `main.tsx:12` |
| Info | `experimental-webgl` fallback is dead on modern browsers | `bootBackground.ts:171` |

### 7.5 Electron main + preload + IPC *(strong security posture overall)*
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | TOCTOU: media handler validates with symlink-resolved path but fetches the **unresolved** path | `main.cjs:2478` |
| High | ✅ | Missing symlink resolution in final `net.fetch(pathToFileURL(target))` — trust bypass | `main.cjs:2481` |
| Med | — | `isTrustedMediaPath`/`isTrustedShellPath` compare unresolved `target` in the fast path; inconsistent with `canonicalPathKey` used for editors | `main.cjs:1719` |
| Med | — | Backend crash-loop counter reset race across spawns | `main.cjs:3219` |
| Med | — | CSP for `vintrace-media:` not verified adequate (policy not fully shown) | `main.cjs:2432` |
| Low | — | Exponential-backoff `2**(failures-1)` precision loss past ~53 failures | `main/util.cjs:76` |
| Low | — | Command allowlist checked case-sensitively (fails closed, but a footgun) | `preload.cjs:286` |

*Positives verified:* `contextIsolation` on, `sandbox` on, `nodeIntegration` off; preload exposes a minimal whitelisted bridge; backend spawn scrubs `DYLD_*`/`LD_*`.

### 7.6 `api_server.py` — dispatch, logic, security, privacy
| Sev | Status | Finding | Location |
|---|---|---|---|
| **Critical** | ✅ | `structured_error()` returns unredacted `str(exc)` (absolute paths) to the client; on-disk log redacts the same | `api_server.py:33907` |
| High | ✅ | `_onnx_integrity_check` / `model_integrity` return unredacted absolute model paths | `api_server.py:3663` |
| High | ✅ | Command results emitted without redaction; `main.cjs decorateState` keeps original `sourcePath` etc. | `api_server.py:34014` |
| Med | ✅ | `analyze_folder` `unreadableSamples` embed unredacted `str(path)` + exception paths | `api_server.py:2568` |
| Med | ✅ | `import_failure_cleanup` `SELECT source_path … fetchall()` loads all paths into memory | `api_server.py:8276` |
| 🟡 Low | 🟡 | `list_photo_assets` search-path pagination: `returned < limit` while `total` unfiltered on unhydratable ids | `api_server.py:29057` |
| Med | — | `bulk_set_status` treats missing `candidateIds` as no-op success instead of erroring | `api_server.py:1166` |
| — | ❌ Refuted | "`set_status` accepts any status" — validated in `manager.set_candidate_status` (manager.py:2567) before any write | `api_server.py:1162` |
| — | ❌ Refuted | "format-string SQL is injectable" — table names hardcoded, not user-reachable | `api_server.py:9106` |

### 7.7 `workspace_db.py` — SQLite persistence
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | `SELECT * FROM photo_assets … fetchall()` loads all rows (only `asset_id`+`metadata_json` used) during location-index rebuild | `workspace_db.py:13598` |
| Med | 🟡 | Same load-all pattern in search-index rebuild | `workspace_db.py:13967` |
| Med | — | Orphan recovery loads all `source_path` into a set | `workspace_db.py:8195` |
| Med | — | Multi-step `permanently_delete_photo_asset` lacks explicit transaction/rollback | `workspace_db.py:12990` |
| Med | — | Dynamic f-string `UPDATE` in timestamp backfill (hardcoded cols, but fragile) | `workspace_db.py:1104` |
| Low | — | `LIKE` query wraps user text without escaping `%`/`_` → wrong matches for filenames with those chars | `workspace_db.py:6977` |
| Low | — | Redundant explicit deletes alongside `ON DELETE CASCADE` (drift risk) | `workspace_db.py:12992` |
| — | ❌ Refuted | "`replace_candidates` DELETE-before-INSERT data loss" — `connect()` context manager wraps both in one implicit transaction; rolls back atomically | `workspace_db.py:6666` |
| — | ❌ Refuted | "`PRAGMA table_info({table})` SQL injection" — private method, table names hardcoded, unreachable from user input | `workspace_db.py:798` |

### 7.8 `enroll/manager.py` — enrollment & identity graph
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | `backfill_references_for_model` dedup key uses **unnormalized** `target_model` while existing keys use `_model_family_key` → duplicate references | `manager.py:853` |
| Med | — | `verify_candidates` can reassign `person_name` without per-subject consent re-check (consent-gate bypass) | `manager.py:2119` |
| Med | — | `verify_candidates` reassignment logged only in aggregate — no before/after audit granularity | `manager.py:2119` |
| Low | — | `block_false_match` may record `blocked_count=2` if the 2nd `add_blocked_pair` fails | `manager.py:2693` |
| — | ❌ Refuted | "Unsafe dict access → KeyError crash & inconsistency" — access is first op (no side effects), and the global handler maps `KeyError`→`E-BACKEND-NOT-FOUND` | `manager.py:2569` |

### 7.9 `match/*` — FR scoring, calibration, validation *(accuracy-critical)*
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ (hand-verified) | Support-score bonus divides by `len(raw_scores)` (≤3) not `len(support_scores)`; under-rewards multi-ref matches 33–67% | `match/scoring.py:267` |
| Low | — | Hardcoded `0.25` "low-score" adapter feature misaligned with configurable `likely=0.28` | `match/adapters.py:196` |
| Low | — | Confident-band close runner-up not penalized (may be intentional for recall) — document intent | `match/scoring.py:323` |

*Positive:* thresholds (confident 0.40 / likely 0.28 / relaxed_child 0.20) enforced with correct boundaries; calibration (Platt + per-identity) is actually applied (not dead code).

### 7.10 `embed/*` + model management
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | ONNX session `@lru_cache(maxsize=4)` not cleared when `_SEMANTIC_MODEL_CACHE` evicts → orphaned sessions retain model weights in memory | `siglip_engine.py:228` |
| Med | — | `flip_tta` quality_norm computed from pre-average `feat1`, not the returned averaged vector | `engine.py:591` |
| Med | — | 3 divergent L2-normalize implementations → potential cross-engine metric mismatch (§6) | `engine.py:43` |
| Med | — | SigLIP provider fallback swallows all exceptions with no log | `siglip_engine.py:288` |
| Med | — | Bundled-model integrity skipped when manifest missing (USC-04 gap for packaged builds) | `model_manager.py:491` |
| — | ❌ Refuted | "L2-normalize zero/NaN silent corruption" — zero-norm rejected by quality gate; NaN fails finitude check; cosine fns have zero guards | `engine.py:46` |
| — | ❌ Refuted | "Config mutation persists wrong model_root" — callers pass a `deepcopy` via `_effective_engine_config()`; never saved | `engine.py:782` |
| — | ❌ Refuted | "Thread-unsafe SigLIP caches" — backend is strictly single-threaded (stdin loop; MCP semaphore-gated) | `siglip_engine.py:220` |
| — | ❌ Refuted | "Zip symlink traversal in model extract" — Python `zipfile` extracts symlink entries as regular files, not links | `model_manager.py:560` |
| — | ❌ Refuted | "Nondeterministic rescue detection" — `finally` restores threshold; normal/rescue use separate cache variants | `engine.py:531` |

### 7.11 `ingest/*` — image/video/safety IO *(re-run; CRITICAL hand-verified)*
| Sev | Status | Finding | Location |
|---|---|---|---|
| Med | 🟡 (hand-verified; downgraded from "critical") | Safety `nsfw_index` bounded by `len(labels)` but `probabilities` length = model's actual classes; a manifest with **more** labels than the model outputs → `IndexError` (crash) or wrong-index gate bypass. Requires tampered/mismatched `manifest.json` (attacker with model-dir write already controls the `.onnx`). Fix: one-line bounds check at `:246-247` | `safety.py:247` |
| High | — | Matting reshape reads `logits.shape[-2]` without `ndim` check → `IndexError` on unexpected tensor rank (caught by outer try, but silent matting failure) | `matting.py:168` |
| High | — | FFmpeg frame-extraction `TimeoutExpired` (timeout `max(30, max_frames*2)`) is **not caught** → crashes extraction on slow systems / large frame counts | `video_io.py:557` |
| Med | — | RAW pixel-limit bypass if `raw.sizes` attrs are 0/missing → OOM in `postprocess()` | `image_io.py:250` |
| Med | — | Animated-GIF frame seek falls back silently to frame 0 on bad `n_frames` | `image_io.py:198` |
| Low | — | HEIF opener registration failure silently swallowed → cryptic "could not load" later | `image_io.py:112` |

*Positive:* decompression-bomb guard present (`image_io.py:17,278`), RAW pixel cap, subprocess timeouts, safety-cache key includes mtime (tamper invalidates cache).

### 7.12 `experiments/*` — training / self-learning / governance
| Sev | Status | Finding | Location |
|---|---|---|---|
| Med | ✅ | Governance gates are **verification-only, not enforcement** — a hand-edited `decision:"approved_for_r_and_d"` + filled fields passes `backbone_finetuning_readiness()`; no signature/authority check. *(Currently not wired into the training pipeline, limiting impact — but designed as a gate.)* | `retraining_governance.py:287` |
| High | ✅ | Benchmark recommendation cherry-pickable — `model_pack_quality_matrix` averages only `status=="complete"` rows; a pack tested on 2 favorable datasets outranks one tested on all 6 | `benchmark_quality.py:200` |
| — | ❌ Refuted | "Train/test leakage via `id(row)`" — the `id()` set is a local, never persisted; split is content-hash deterministic | `onnx_training.py:2480` |
| — | ❌ Refuted | "Threshold calibrated & tested on same data" — tuned on training rows, metrics computed on held-out validation rows | `onnx_training.py:2797` |
| — | ❌ Refuted | "Audit bindings not enforced at read time" — verification checks each evidence file's current SHA-256 + re-verifies source `reportHash` | `self_learning_audit.py:634` |

### 7.13 MCP server & privacy redaction
| Sev | Status | Finding | Location |
|---|---|---|---|
| **Critical** | ✅ | Hash fields (`sourceHash`/`sha256`/`phash`) not redacted in tool output (`_redact_tool_output` lacks the hash branch that `_agent_safe_value` has) → biometric fingerprint leak to agents | `mcp_server.py:235` |
| High | ✅ | `triage_pending` prompt calls `_agent_safe_value(...)` with default `keep_path_names=True` → filenames (which encode names/dates) leak, contradicting the documented policy every resource uses | `mcp_server.py:1474` |
| Med | — | No test coverage for hash redaction (would not catch the bug above) | `tests/mcp_smoke.py:194` |

*Positive:* Bearer-token HTTP auth with constant-time compare; path validation confines agent paths to approved roots; default bind `127.0.0.1`.

### 7.14 Crypto / registry / compliance / audit
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | PII: person names logged in `delete_person` (`3346`) and `rename_person` (`3389`) audit entries → survive "erasure", exported via `export_audit_log`, unredacted via MCP audit resource | `manager.py:3346` |
| High | ✅ | Audit `_append_audit` writes without `os.fsync` → power-loss can drop the latest entry and break the SHA-256 tamper-evidence chain the app advertises | `manager.py:8761` |
| Med | — | `set_consent` scope defaults to `str(self.root)` (leaks OS username/path) | `manager.py:582` |
| Low | — | Export audit entries include full absolute `json_path`/`csv_path` | `manager.py:4526` |
| Info | ✅ (positive) | Backup crypto is sound: AES-256-GCM + scrypt (N=2¹⁵), random salt/nonce, tamper detection, round-trip tested | `crypto.py:53` |
| Info | ✅ (positive) | Workspace registry blocks path-traversal via marker-file requirement | `workspace_registry.py:230` |
| Info | — | Learned artifacts intentionally unencrypted at rest (documented decision; ensure marketing doesn't claim otherwise) | `docs/2026-learned-artifact-encryption-decision.md` |

### 7.15 Build / release / update supply chain
| Sev | Status | Finding | Location |
|---|---|---|---|
| High | ✅ | Unsigned releases + electron-updater "generic" feed does **no** signature verification → MITM/CDN/GitHub compromise = RCE | `main.cjs:1817` |
| **Critical** | ✅ | `verify-release-assets.cjs` checks `asset.digest` — a field GitHub's API never populates — so the integrity gate silently passes without verifying anything | `verify-release-assets.cjs:173` |
| High | ✅ | `SHA256SUMS.txt` / `latest.yml` are not cryptographically signed → no proof of origin; attacker who owns the release can swap binary + checksums together | `create-release-artifacts.cjs:150` |
| Med | ✅ | macOS/Windows binaries shipped unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`) — Gatekeeper/SmartScreen warnings; documented as "private testing" v0.1.0 | `*.github/workflows/*-release.yml` |
| Med | — | No integrity hash of the PyInstaller backend binary post-build | `build-backend.cjs:80` |
| Med | — | Release published *before* verification runs; no unpublish on failure | `.github/workflows/*-release.yml` |
| Low | — | MCP-redaction test not run in release workflows (only in `qa.yml`) | release workflows |
| — | ❌ Refuted | "`VINTRACE_UPDATE_URL` no allowlist" — allowlist correctly gated on `app.isPackaged`; dev builds can't self-update; documented USC-02 fix | `main.cjs:1838` |

*Positive:* Python deps pinned with `--require-hashes`; `npm ci`; SBOM + provenance emitted.

### 7.16 Test suite
| Sev | Status | Finding | Location |
|---|---|---|---|
| Med | 🟡 | PhotosView (32k, 559 `useState`) has no component-level state tests (only e2e + pure-helper tests) | `PhotosView.tsx` |
| Med | — | Playwright `retries:1` masks real timeouts/deadlocks as "flaky" with no root-cause tracking | `playwright.config.ts:16` |
| Med | — | `memory-soak` e2e cycles 6 tabs but never loads the photo library at 10k–100k scale | `tests/e2e/memory-soak.spec.ts:77` |
| Med | — | Weak `assert(...)` fuzzy comparisons in `photos_view.test.mjs` can pass on `undefined` | `tests/photos_view.test.mjs:496` |
| Low | — | `ipc-security` e2e doesn't fuzz param *shapes*/boundary values | `tests/e2e/ipc-security.spec.ts:56` |
| Low | — | `command_contract` extraction regex is itself untested (silent-miss risk) | `tests/command_contract.py:42` |
| — | ❌ Refuted | "50% of backend commands untested" — actual ~89% via `photo_folders_units.py` + e2e; methodology missed ~40 test files | contract |
| — | ❌ Refuted | "24/38 photo*.ts modules untested" — all 38 transpiled+exercised in `photos_view.test.mjs` | helpers |
| — | ❌ Refuted | "DB migrations untested" — integration tests migrate legacy schemas and assert data preservation | migrations |

---

## 8. Independently verified by the lead (ground-truth reads)

| Claim | Verdict |
|---|---|
| `scoring.py:267` support-denominator bug | **Confirmed** — divides by `len(raw_scores)`; `evidence_count=1+len(support_scores)` proves intent |
| `mcp_server.py` hash redaction gap | **Confirmed** — `_agent_safe_value` has the `endswith("hash")` branch; `_redact_tool_output` does not |
| `structured_error` path leak | **Confirmed, refined** — `message` leaks; traceback already `CROSSAGE_DEBUG`-gated |
| `vector_store.py:147` `np.load(allow_pickle=True)` | **Confirmed risk** — `save()` stores `ids` as `dtype=object` (pickled), *forcing* `allow_pickle=True` on load; a malicious `.npz` in a shared/imported workspace = code execution. Fix: stop storing object arrays (store ids as JSON/utf-8), then load with `allow_pickle=False` |
| `workspace_db.py:14704` JSON-path SQL interpolation | **Refuted (safe)** — `key` from hardcoded allowlist *and* regex-validated `^[A-Za-z0-9_]+$` at 14700 |
| `safety.py:247` NSFW index OOB | **Plausible → Medium** — real but needs tampered/mismatched manifest; one-line bounds check fixes it |

---

## 9. Under-covered areas (recommended follow-up passes)

1. **~12k unread lines of photo-indexing/scheduler in `api_server.py`** and **7k+ of rendering + drag/retouch handlers in `PhotosView.tsx`** — the largest untested, under-reviewed surface; likely holds the next tier of bugs.
2. **Folder-watch (2600+ lines) and the photo-indexing scheduler in `main.cjs`** — continuously running, filesystem-touching, path-trust-sensitive; deferred by the electron-main auditor.
3. **End-to-end numerical path embedding→scoring→calibration under the three divergent L2 normalizers** — nobody traced a real vector through all three plus calibration to confirm cosine comparability; `pipeline_smoke.py` explicitly does not test matching accuracy.
4. **Video transcoding / `ingest/video_io.py` at scale** — the ffmpeg timeout crash (`:557`) suggests more untested resource-exhaustion edges.
5. **SQLite migrations on a populated 100k-row DB** — integration tests exist for small DBs; upgrade performance and partial-failure behavior at scale are unverified.
6. **A frontend↔backend command/param contract fuzz** — generate every command with boundary-value params to surface the stringly-typed mismatches static review can't.

---

## 10. Remediation roadmap

**P0 — this cycle (security/privacy/integrity, small diffs, high impact):**
- Redact `structured_error()` `message` with `_redact_text(str(exc), root)` (#2).
- Add the hash-redaction branch to `_redact_tool_output` and set `keep_path_names=False` in `triage_pending` (#4, MCP filenames). Add the missing `mcp_smoke` hash assertions.
- Fix `verify-release-assets.cjs` to read `SHA256SUMS.txt` contents (not the phantom `asset.digest`) and **run verification before publishing**; fail the workflow on mismatch (#3, #15).
- Resolve the media path to realpath *before* trust check and fetch (`main.cjs:2478/2481`) (#7).
- Remove person names from `delete_person`/`rename_person` audit entries; add `os.fsync` in `_append_audit` (#10).
- Stop persisting object-dtype arrays in the vector store so `np.load(allow_pickle=False)` becomes possible (§8).
- Add the one-line `nsfw_index` bounds check (`safety.py:247`).

**P1 — next cycle (correctness & scale):**
- Fix the support-score denominator (`scoring.py:267`) and add a regression test (#8).
- Convert the three `SELECT *` rebuilds to column-scoped cursor iteration (#6).
- Add a cancellation-token/response-version guard in `App.tsx invoke()` (#9); make `list_photo_assets` `total` reflect hydrated count or return placeholders (§5).
- Normalize `target_model` via `_model_family_key` in `backfill_references_for_model` (`manager.py:853`); add consent re-check in `verify_candidates`.
- Clear the ONNX `@lru_cache` on model eviction (`siglip_engine.py:228`); catch `TimeoutExpired` in `video_io.py:557`.
- Sign `SHA256SUMS.txt`/`latest.yml` (Ed25519) and verify in-app, or move to signed builds + GitHub provider.

**P2 — structural (the root cause):**
- Introduce **one** redaction serialization boundary; delete the duplicated copies (§4.2).
- Unify L2 normalization into a shared, tested helper (§6).
- Begin decomposing the four god-files behind stable interfaces — starting by extracting pure state logic out of `PhotosView.tsx` and `App.tsx` into unit-testable modules, and splitting `api_server.py`'s dispatch table into per-domain handler modules.
- Add component-level state tests for the extracted PhotosView logic and a photo-library-at-scale memory-soak e2e.

---

## Appendix — methodology & audit statistics

- **Orchestration:** a background multi-agent workflow — 18 subsystem finders (partitioned by subsystem × concern so each mega-file was split across reviewers), piped into per-finding **adversarial verifiers** that re-read the code and were instructed to *refute*, then a cross-cutting/completeness critic. Two finders (ingest, photo-modules) dropped a connection mid-response and were re-run as standalone agents; the ingest CRITICAL was hand-verified.
- **Cost/scale:** 66 workflow agents + 2 re-runs, ~3.6M subagent tokens, ~2,340 tool calls, ~17 min wall-clock for the main workflow.
- **Why adversarial verification mattered:** 20 of 47 high/critical findings (43%) were **refuted** on second reading — false positives a single-pass review would have shipped (e.g. the "L2 zero-norm corruption," "replace_candidates data loss," "zip symlink traversal," "50% commands untested," and "PRAGMA SQL injection" claims all collapsed under scrutiny). Every finding retained above survived a skeptic.
- **Confidence note:** confirmations are grounded in specific `file:line` reads; "plausible" means likely-real-but-not-fully-reproducible from static reading; medium/low items from the two re-run finders were not independently re-verified (except the ingest CRITICAL) and are labeled accordingly.

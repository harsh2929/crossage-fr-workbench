# Full-Stack Audit Finalization - Vintrace

**Date:** 2026-07-07  
**Scope:** Quality, completeness, latency, principles, and optimization across the Electron shell, React renderer, Python JSON-RPC backend, SQLite workspace DB, ingest/ML pipelines, MCP server, release scripts, tests, and Apple Photos parity.

## Method And Provenance

This report finalizes the July 7 adversarial audit from the persisted workflow artifacts rather than from a clean workflow return. The original workflow was killed before the completeness critic could return, but its auditor, verifier, and journal artifacts were preserved.

Primary artifacts used:

- `scratchpad/audit_result.json`: `/private/tmp/claude-501/-Users-harshbishnoi-face/9fa3208a-82d4-4b1a-bc78-b2ecf53948d1/scratchpad/audit_result.json`
- workflow journal: `/Users/harshbishnoi/.claude/projects/-Users-harshbishnoi-face/9fa3208a-82d4-4b1a-bc78-b2ecf53948d1/subagents/workflows/wf_f94bde8e-9f2/journal.jsonl`
- workflow script: `/Users/harshbishnoi/.claude/projects/-Users-harshbishnoi-face/9fa3208a-82d4-4b1a-bc78-b2ecf53948d1/workflows/scripts/vintrace-full-audit-2026-07-wf_f94bde8e-9f2.js`

Final confidence buckets:

| Bucket | Count | Meaning |
|---|---:|---|
| `CONFIRMED` | 127 | Survived the workflow verifier before the killed run |
| `CONFIRMED-RECOVERED` | 7 | Later verifier verdicts recovered from `journal.jsonl` |
| `CONFIRMED-LOCAL` | 78 | Remaining medium findings checked locally against current code |
| `UNVERIFIED-LOW` | 60 | Low-severity findings passed through by workflow policy |
| `REFUTED` | 22 | Removed by the original adversarial verifier |

Confirmed severity mix:

| Severity | Count |
|---|---:|
| Critical | 1 |
| High | 26 |
| Medium | 169 |
| Low, verifier-confirmed | 16 |

Confirmed dimension mix:

| Dimension | Count |
|---|---:|
| Latency | 101 |
| Quality | 62 |
| Optimization | 23 |
| Completeness | 17 |
| Principles | 9 |

## July 8 Remediation Update

This report preserves the original July 7 audit findings, but `main` has moved since the audit was written. The following items were re-checked against the current tree on July 8, 2026.

Verification used:

- `npm run test:photo-folders` passed end to end.
- Source/test inspection covered `crossage_fr/store/workspace_db.py`, `crossage_fr/api_server.py`, `src/App.tsx`, `src/views/PhotosView.tsx`, `src/views/SafeModeReview.tsx`, `crossage_fr/enroll/manager.py`, and `crossage_fr/ingest/image_io.py`.

Current status of the original critical/high set:

| Status | Original item | Current evidence |
|---|---|---|
| Fixed and regression-covered | Critical photo-listing backfills on read paths | `photo_asset_people(candidate_id)` exists, read paths no longer invoke the legacy asset backfills, and `test_photo_read_paths_do_not_run_legacy_asset_backfills` passed in `npm run test:photo-folders`. |
| Fixed and regression-covered | Semantic search 600-photo cap | Semantic embeddings are persisted in `photo_semantic_embeddings`, candidate lookup uses `list_photo_semantic_candidate_assets` without the old cap, and `test_semantic_search_indexes_full_library_without_candidate_cap` covers a 605-image library. |
| Fixed or substantially bounded | Utility folders, photo-library settings counts, search hydration, duplicate folders, date-bucket covers, smart-album revision fingerprints, edit-stack version counts, and scan-file import-session refreshes | `npm run test:photo-folders` now includes passing scale guards for SQL paging, one-shot date cover queries, cached duplicate summaries, bounded smart-album probes, search scoped context loading, and batched scan/import updates. |
| Fixed and regression-covered | Phase 0 quality/privacy bugs | `moveSelected` returns on canceled destination selection, `CameraScanner` stops streams that resolve after unmount, Safe Mode review waits for sensitive unlock before listing flagged photos, safety-cache keys include Safe Mode temperature, and EXIF event dates prefer `DateTimeOriginal`/`DateTimeDigitized`. |
| Still open | Photos i18n coverage | The Photos surface is still broad and should remain a high-priority localization pass. |
| Still open | Long image/ML work in the JSON-RPC dispatch path | OCR/barcode/object indexing, Safe Mode calibration, subject/portrait export, and video export still need job-style execution, progress, cancellation, and non-blocking status polling. The old vignette per-pixel loop itself is fixed. |
| Still open | Backend process supervision and release-channel hardening | The process lifecycle and updater integrity concerns need dedicated tests beyond the photo-library suite. |
| Ongoing | Renderer decomposition | Several App state hooks and Photos view tests now exist, but `PhotosView.tsx` and `App.tsx` remain large enough that feature work should keep extracting cohesive state owners. |

Recommended next targets after this update:

1. Finish the Photos i18n pass and keep localization checks loading every locale bundle.
2. Convert the remaining long-running ML/image handlers to jobs with progress, cancellation, and status polling.
3. Add focused backend lifecycle tests for duplicate-start/backoff and pending-request rejection behavior.
4. Continue Photos/App decomposition around one feature surface at a time, with behavioral tests before each extraction.

## Executive Summary

Vintrace is feature-rich and has closed a large portion of the Apple Photos gap, but the current architecture is not ready for the stated 50k-100k photo target. The main failure mode is not type unsafety or missing features. It is repeated full-library work on hot paths, performed inside a single-threaded backend dispatch loop, plus a React renderer where very large components own too much state.

The highest-risk confirmed issue is a critical SQLite backfill path that runs on every photo listing and includes an O(candidates x people) correlated probe. At 50k candidates and 50k people rows, this can become billions of comparisons before a page of photos appears.

The next tier is a cluster of high-latency hazards: date timelines, folders, search, smart albums, duplicate groups, suggestions, generated collections, and settings all repeatedly materialize or recompute large portions of the library. Many are individually "only" high, but together they describe the same architectural problem: core browsing is not yet bounded by page size.

The product-quality risks are also concrete: canceling a move destination still relocates originals, CameraScanner can leak a live webcam stream, concurrent desktop plus MCP processes can clobber workspace state, safety calibration does not invalidate cached verdicts, and the Safe Mode review dashboard can reveal sensitive items outside the existing sensitive-collection unlock flow.

## Top Priorities

1. **Stop per-listing database backfills.**  
   `crossage_fr/store/workspace_db.py:20480` is critical. Add the missing `photo_asset_people(candidate_id)` index, make the backfill dirty-flagged or startup/import-scoped, and remove it from every page/list read.

2. **Make list/read commands page-bounded.**  
   `list_photo_folders`, utility folders, search, trips/memories/pets, date buckets, smart-album fingerprints, and generated collections repeatedly scan the whole library. The backend should return one page or one aggregate without rebuilding the world.

3. **Fix user-visible data movement bugs.**  
   `src/views/PhotosView.tsx:17824` moves originals when the destination picker is canceled. This is a high-priority correctness bug because it silently relocates user files.

4. **Serialize workspace writers or move all writes through one process.**  
   `crossage_fr/enroll/manager.py:178` shows in-memory state rewritten wholesale. Desktop plus MCP can overwrite each other's changes. Either the DB becomes authoritative for all mutable state, or a single writer/lock protocol must be enforced.

5. **Move slow ML/image work out of the JSON-RPC dispatch path.**  
   OCR, barcode/object indexing, vignette rendering, subject/portrait export, and Safe Mode calibration all run synchronously in handlers. Long work needs jobs, progress, cancellation, and non-blocking status polling.

6. **Repair Safe Mode trust boundaries.**  
   Calibration should invalidate or version `safety_cache`, Freepik/multi-level calibration must optimize the deployed score, and `SafeModeReview` should honor the same passcode/OS-auth unlock used for sensitive collections.

7. **Decompose `PhotosView.tsx` and `App.tsx` along real state boundaries.**  
   Current files are 32.5k and 16.3k lines. The worst render and race issues come from state owned too high, not from missing memo calls.

## Confirmed Critical And High Findings

| Sev | Dimension | Finding | Location |
|---|---|---|---|
| Critical | Latency | Every photo listing runs two full-table backfills including an O(candidates x people) correlated probe | `crossage_fr/store/workspace_db.py:20480` |
| High | Completeness | Semantic search encodes photos at query time with a 600-photo cap, so it is blind to most of a 50k-100k library | `crossage_fr/api_server.py:29147` |
| High | Completeness | Photos tab is roughly 97% untranslated after the Photos-first redesign | `src/i18n.ts:1532` |
| High | Latency | Search results compute album memberships via full-library materialization per asset | `crossage_fr/api_server.py:4770` |
| High | Latency | Utility-folder pagination materializes the entire library per page request | `crossage_fr/api_server.py:6282` |
| High | Latency | `photo_library_settings` runs two full asset scans plus a `Path.resolve()` storm on every call | `crossage_fr/api_server.py:9335` |
| High | Latency | Date-bucket batch annotation sentinel is ignored, causing about two DB connections per entry in fallback | `crossage_fr/api_server.py:17684` |
| High | Latency | Trip/memory/pet folder paging re-derives all generated collections per page | `crossage_fr/api_server.py:22416` |
| High | Latency | `suggest_photo_albums` performs a full-library scan per candidate suggestion | `crossage_fr/api_server.py:22764` |
| High | Latency | `search_photo_library` reloads whole tables and re-iterates review candidates per search call | `crossage_fr/api_server.py:28503` |
| High | Latency | Pure-Python per-pixel vignette loop runs at full source resolution on edit-stack save | `crossage_fr/api_server.py:31554` |
| High | Latency | `list_photo_folders` makes many full-library passes and is invoked after every mutation | `crossage_fr/api_server.py:32885` |
| High | Latency | Smart-album revision fingerprint full-scans and hashes `photo_asset_people` on every validity check | `crossage_fr/store/workspace_db.py:3999` |
| High | Latency | `record_scan_file` refreshes import-session counts per scanned file, making scans O(n^2) | `crossage_fr/store/workspace_db.py:8799` |
| High | Latency | FTS integrity counts run six aggregate scans on every search query | `crossage_fr/store/workspace_db.py:14591` |
| High | Latency | Library page query sorts the whole filtered set via temp B-tree and evaluates the CTE twice per page | `crossage_fr/store/workspace_db.py:16376` |
| High | Latency | Timeline covers re-execute the full-library CTE once per date bucket | `crossage_fr/store/workspace_db.py:16702` |
| High | Latency | Full duplicate-group rebuild runs on every folders refresh | `crossage_fr/store/workspace_db.py:18737` |
| High | Latency | Backfill loads entire `scan_files` and all `photo_assets` paths into Python per listing | `crossage_fr/store/workspace_db.py:20431` |
| High | Latency | O(n^2) `items.indexOf` inside `timelineRows` freezes the renderer at scale | `src/views/PhotosView.tsx:7672` |
| High | Quality | Workspace state is loaded once per process and `save()` rewrites all state, so desktop plus MCP can clobber changes | `crossage_fr/enroll/manager.py:178` |
| High | Quality | Temperature calibration never invalidates `safety_cache`, so calibration has no effect on already-scanned photos | `crossage_fr/enroll/manager.py:2492` |
| High | Quality | EXIF `DateTimeOriginal`/`DateTimeDigitized` are not read; capture dates fall back to IFD0 `DateTime` or mtime | `crossage_fr/ingest/image_io.py:347` |
| High | Quality | Unchunked `IN (...)` in edit-stack version counts crashes date-bucket views past SQLite variable limits | `crossage_fr/store/workspace_db.py:17827` |
| High | Quality | Backend start backoff race can spawn duplicate Python backends; any child exit rejects all pending requests | `desktop/main.cjs:3190` |
| High | Quality | `CameraScanner` can leak a live webcam stream if unmounted while `getUserMedia` is pending | `src/App.tsx:9886` |
| High | Quality | Canceling destination picker in `moveSelected` still moves originals to workspace exports | `src/views/PhotosView.tsx:17824` |

## Medium Backlog By Subsystem

The remaining medium backlog is real and should be triaged after the high/critical work. The density is highest in persistence and enrollment:

| Area | Medium count | Themes |
|---|---:|---|
| `crossage_fr/enroll/manager.py` | 17 | O(n^2) scan loops, per-row DB connections, backup memory hazards, stale caches, unwired calibration helpers, audit-log rereads, state lock weaknesses |
| `crossage_fr/store/workspace_db.py` | 16 total, 9 locally completed | QR/barcode decode in upsert, redundant FTS rebuilds, undo semantics, Safe Mode private-data gaps, boot backfills, connection churn, schema drift |
| `desktop/main.cjs` | 5 | stdin supervision, folder-watch serial waits, workspace-switch trust race, main-thread JSON parse/clone, uncapped dropped-path prep |
| `src/App.tsx` | 5 | i18n/path corruption, English DOM-localization observer, CandidateTable reset, hardcoded Safe Mode thresholds, component growth |
| `src/views/SafeModeReview.tsx` | 4 total, 3 locally completed | no pagination, no virtualization, eager preview loads, untranslated strings, sensitive unlock bypass |
| Smaller files | 35 | release script edge cases, command-contract MCP gap, video/OpenCV boot import, MCP redaction-on-exception, config reset behavior, lack of code splitting |

Selected medium items worth pulling forward:

- `src/views/SafeModeReview.tsx:37`: review dashboard bypasses the sensitive-collection lock and can reveal flagged sensitive photos without passcode/OS-auth.
- `crossage_fr/store/workspace_db.py:22396`: `clear_private_data` omits `safe_mode_overrides`, leaving user-confirmed intimate-image records behind.
- `crossage_fr/mcp_server.py:353`: raised exceptions bypass MCP return-value redaction and can leak raw path/error text to agents.
- `crossage_fr/config.py:317`: one invalid or unknown config field archives the whole config and resets all settings.
- `vite.config.ts:28`: no renderer code splitting; first paint waits on a 1.4 MB entry chunk including the Photos view.

## Apple Photos Parity

Vintrace is now ahead or at parity in several product areas:

- **Ahead:** albums and smart albums, export/share, privacy-local Safe Mode concept.
- **Parity:** library browsing basics, Memories, Search broadly, People, Duplicates, still-image editing, import, Live Photos/bursts.
- **Behind:** Places/maps, Videos, instant whole-library timeline scrubbing, pet recognition quality.
- **Absent:** iCloud-style sync/shared libraries, OS widgets/extensions, native USB camera/iPhone import, ML Clean Up inpainting, model-backed pet recognition, advanced video editing, true HDR display/tone mapping, system photo-library integration.

The current parity conclusion is: Vintrace is unusually broad for a local-first desktop photo app, but Apple still wins on sync, device integration, mature media performance, real maps, and native OS surfaces. Vintrace can beat Apple only if the 50k-100k library latency cliffs are removed.

## Prior July 4 P0/P1 Status

The July 4 audit is mostly remediated:

| Status | Items |
|---|---|
| Fixed | structured error path redaction; release asset verification no longer uses phantom `asset.digest`; MCP hash redaction; streamed index rebuilds; media protocol symlink fetch; support-score denominator; IPC sequence guard; audit-log PII/fsync; `np.load(allow_pickle=False)`; safety index clamping |
| Partial | release signing/in-app update integrity; general command-result path redaction |
| Still strategically risky | electron-updater generic feed remains the primary release-channel concern until the in-app updater verifies signatures or is disabled |

## Remediation Roadmap

### Phase 0 - Stop Data Loss And Privacy Regressions

- Add the missing cancel guard to `moveSelected`.
- Fix `CameraScanner` stream cleanup for pending `getUserMedia`.
- Make Safe Mode review honor sensitive unlock requirements.
- Add `safe_mode_overrides` to private-data clearing.
- Redact MCP exception text, not only successful return values.

### Phase 1 - Bound Core Library Reads

- Remove read-path backfills from photo listings.
- Add `photo_asset_people(candidate_id)`.
- Replace per-bucket timeline cover queries with one window-function query or temp materialization.
- Cache or dirty-flag duplicate summaries.
- Make `list_photo_folders`, utility folders, search, and generated collections page-bounded.

### Phase 2 - Make Long Work Asynchronous

- Move OCR/barcode/object indexing, Safe Mode calibration, vignette rendering, subject cutout, portrait blur, and video export into job-style handlers.
- Return job IDs plus progress/status commands.
- Keep the JSON-RPC dispatch loop responsive.

### Phase 3 - Split The Renderer By State Ownership

- Extract lightbox/video, Safe Mode settings, MCP agents panel, slideshow editor, and Photos grid into smaller components.
- Keep fast-changing state local to small children.
- Add behavioral tests around extracted modules instead of regex source-presence checks.

### Phase 4 - Product Parity Closures

- Add persistent semantic embeddings/ANN or SQL-indexed vector retrieval instead of query-time capped encoding.
- Replace map-lite with real offline/online tile support or a clearer product decision.
- Add native device import support if Apple parity remains the goal.
- Decide whether iCloud-style sync/shared libraries are out of scope or a roadmap pillar.

## Bottom Line

The app is no longer blocked by broad missing feature work. It is blocked by scale architecture. The highest leverage work is to make every visible photo-listing operation proportional to the page or bucket being requested, not to the full library, and to prevent slow ML/image work from occupying the single backend command loop.

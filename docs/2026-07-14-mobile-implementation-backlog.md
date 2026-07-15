# Mobile — Implementation Backlog

**Date:** 2026-07-14
**Status:** Execution plan. Dependency-ordered. Written to be picked up by an implementing agent with no prior context beyond the three companion documents.
**Prerequisites:** `2026-07-14-mobile-integration-audit.md`, `2026-07-14-apple-photos-mobile-atlas.md`, `2026-07-14-mobile-architecture-and-spec.md`.

---

## How to use this document

Epics are ordered by **dependency, not priority** — later epics genuinely cannot start until earlier ones land. Each carries:

- **Why** — the finding that motivates it, with a citation into the audit or spec
- **Files** — the concrete code to touch
- **Done when** — a testable acceptance condition
- **Effort** — S (days) / M (1–2 weeks) / L (3–6 weeks) / XL (quarter-scale)

**Phase 0 is not optional and not deferrable.** Five of its epics are live defects on the desktop *today*, independent of mobile. Starting mobile work before Phase 0 lands means building on identifiers that change when a file moves, a preview API that lies about its own resolution, and a Safe Mode that fails open.

### Spikes — **ALL RESOLVED.** See `2026-07-14-mobile-spike-results.md`

| Spike | Result |
| --- | --- |
| **SP-1** grid | ✅ **MEASURED: 60.0 fps @ 267 MB** over 100k items (Expo 57 / RN 0.86 / FlashList 2.0.2, release build, iPhone 17 Pro sim). **The naive full-res pipeline hit 3,174 MB** — 11.9× more — while scoring *higher* FPS. **Measure memory, not frame rate.** Harness preserved in `tools/mobile-spikes/` |
| **SP-2** sqlite-vec | ✅ **MEASURED: 26.8 ms** median KNN over 100k `int8[512]`; 4.5 ms `bit[512]` coarse pass. Brute force is fine — **no ANN index needed** |
| **SP-3** Handoff | ⛔ **Do not build.** Needs a shared iCloud account; duplicates the LAN channel we already own |
| **SP-4** background-upload ext | ⛔ **Cannot use.** Body is locked to raw asset bytes — our E2E framing cannot be the transport |
| **SP-5** Liquid Glass | 🟡 **Ship with it ON, hybrid.** Opting out hard-expires at the iOS 27 SDK |

**The original spike table, for reference:**

| Spike | Question | Why it matters |
| --- | --- | --- |
| **SP-1** | Can a React Native grid hold 60fps over 100k local assets? | **No publicly documented RN app has ever done this.** Immich and Ente are Flutter; Apple and Google Photos are native. Instagram and Discord render *remote feeds*. **You would be first.** If this fails, the product fails |
| **SP-2** | `sqlite-vec` KNN latency on a Pixel 6a / iPhone SE | Every published benchmark is **desktop** (M1 mini). Ente reports <500 ms brute-force over 100k on midrange mobile — measure it, don't assume it |
| **SP-3** | Does a Developer-ID-signed (non-MAS) Electron build reliably receive `continue-activity`? | Decides whether Handoff is a feature or a fantasy |
| **SP-4** | `PHBackgroundResourceUploadExtension` (iOS 26.1+) | Lets the **system** schedule background upload of `PHAssetResource`s **even when the app isn't running**. This is *exactly* the missing primitive for a phone↔Mac photo app and it is invisible to every RN library. Requires full library access (`.authorized`, not `.limited`). Could materially improve the honest promise in spec §8.4 |
| **SP-5** | Liquid Glass under the mandatory iOS 26 SDK | Rebuilding applies it to native controls **by default**, and this project's design direction is deliberately maximalist. Decide opt-out early |

---

# Phase 0 — Desktop unblocks

**Nothing mobile can start until these land. Five are live bugs today.**

## E0.1 — Stable asset identity 🟡 **Data-loss half FIXED; canonical key still open**

> ✅ **DONE (2026-07-14): content-hash rehoming.** The live data-loss bug is closed. A moved or
> renamed file now keeps its identity, and with it its faces, people, albums, keywords, rating,
> favourite and edit stacks. `WorkspaceDb._photo_asset_id_for_moved_file()` +
> `tests/asset_identity_rehome_units.py` (16 checks).
>
> **⚠️ The guard that makes it safe, and why:** rehoming requires the content hash to match
> **AND** the stored file signature (size + mtime) to match **AND** the old path to be gone
> **AND** exactly one candidate to qualify. *"The path is missing" is NOT evidence of a move* —
> it is evidence of absence, and absence has other causes. The one that bites: **an asset on an
> external drive has a missing path whenever the drive is unplugged.** A first version of this
> fix, guarded only on "hash matches + path gone", would have let an identical photo imported
> from a backup **hijack the external-drive asset** and destroy the record of where the original
> lives. The existing suite caught it. Size+mtime is the discriminator: a move preserves both;
> a separate copy does not.
>
> **STILL OPEN — the canonical key.** `asset_id` remains `sha256(path)`, and the three identity
> spaces are still disjoint. Mobile sync needs the UUID `asset_uid` + resolvable axes below,
> because a phone's PHAsset has no desktop path to hash. The rehoming fix stops the bleeding;
> it does not unify identity.

### The remaining work (the canonical key)

**Why.** Three identity spaces remain disjoint (audit §9.1). The path-derived `assetId`, content-hash CRDT key, and provider external id still need one canonical cross-device key. The live move/rename defect described by the original audit is fixed by `_photo_asset_id_for_moved_file()`; this subsection now covers only canonicalization.

And `local_sync` keys on the SHA-256 of original bytes, while **iOS re-encodes on export** — so phone/desktop convergence would be near-zero.

**Do.**
1. Add `asset_uid TEXT` (UUIDv7) to `photo_assets`; backfill; make it the canonical key.
2. Keep `content_hash`, `(provider, library_id, external_id)`, and legacy `path_hash` as **resolvable axes** that map *to* `asset_uid`.
3. Resolution order on ingest: `external_id` → `content_hash` → `perceptual_hash` (**suggest-only, requires user confirmation — never auto-merge**) → mint new.
4. Preserve the existing conservative content-hash rehoming guard during the migration.
5. Expose `assetUid`, `contentHash`, `externalIds`, and deletion/revision state in the authenticated asset contract. (`updatedAt` is now exposed; the other canonical-axis fields remain open.)

**⚠️** `photo_asset_external_ids` is **not** an unused table — it is actively upserted (`photo_sources/catalog.py:350`) and state-updated (`photo_sources/service.py:1727, :2150`) for connector assets. **The migration must preserve its contents.**

**Files.** `store/workspace_db.py` (schema, upsert, every asset-id FK), `agent_images.py`, `local_sync.py` (entity key), `photo_sources/*`.
**Done when.** Moving a file on disk preserves every association; a phone-side PHAsset resolves to the same `asset_uid` as the desktop's copy of the same photo.
**Effort.** **L** — this touches every table that FKs an asset.

---

## E0.2 — Proxy ladder 🟡 **API HONESTY FIXED; LADDER STILL OPEN**

> ✅ `maxDimension=2048` now produces a real 2048px preview when the source permits it; 1536 and smaller requests are likewise honored, and small originals are never upscaled. `preview_path_for(..., max_edge=...)` keys generated previews by requested edge. Test: `tests/preview_dimension_honesty_units.py`.

**Why it remains open.** The original 768px/API-contract defect is closed. A Photos-grade client still needs a content-addressed multi-tier cache, asset-addressable thumbnails, ThumbHash, and incremental pruning; the current edge-keyed preview cache is an honest endpoint, not the complete media tier.

**Do.** Content-hash-keyed ladder: `thumb` (256px WebP) / `screen` (1536px) / `full`. An **asset-addressable** thumbnail store (there is none — previews are content-hash-named JPEGs on disk with no DB row). Cache keyed on **content hash, not mtime+path** (today a `mtime` touch from a cloud re-download busts it, and two identical files cache twice). Add incremental pruning (today the only removal is a total wipe).

**Also generate a 25-byte ThumbHash per asset** — 2.5 MB for 100k photos means **the phone's grid is never blank offline**, even before a single thumbnail syncs.

**Files.** `ingest/image_io.py:335`, `enroll/manager.py:11655/11680/11812`, `agent_images.py:44/1460`, `agent_openapi.py:270`.
**Done when.** `maxDimension=2048` returns 2048px. Moving a file does not regenerate its previews.
**Effort.** **M**

---

## E0.3 — Safe Mode cache coherence ✅ **FIXED (2026-07-14)**

> `ProjectState.refresh_config_from_disk()` — a `(size, mtime_ns)`-guarded re-read, mirroring
> the `refresh_consent_from_disk()` precedent that sat one function away — called from
> `AgentImageService._safe_mode_status()`, the gate the mobile preview route actually consults.
> One `stat` on the hot path; re-parses only when config.json changed.
> Test: `tests/safe_mode_cross_process_units.py`.

**Why.** Audit §9.3. The MCP process caches `RuntimeConfig` at `DesktopApi` construction and **never re-reads `config.json`**.

> **An operator ENABLING or TIGHTENING Safe Mode on the desktop does not affect the mobile preview path until the sidecar restarts.** The phone keeps serving previews under the old, looser policy.

**Consent was explicitly fixed for exactly this cross-process staleness bug, one function away** (`manager.py:906`). Config was simply forgotten.

**Do.** Re-read config (or invalidate the cached singleton) on the mobile preview path, mirroring the consent fix.
**Files.** `mcp_server.py:218-223`, `enroll/manager.py:221-255, :906, :2675-2711`.
**Done when.** Tightening Safe Mode takes effect on the next mobile request, with no restart. Regression test asserts it.
**Effort.** **S** — and it is a security fix, so do it first.

---

## E0.4 — Hidden/Deleted asset gate on the agent surface ✅ **FIXED (2026-07-14)** — and the lock half was a non-bug

> **The workspace-lock half of this epic was WRONG and is retracted.** `_api()` already calls
> `_assert_unlocked()` on every backend access (`mcp_server.py:220`), and `_workspace_lock_enabled()`
> **fails closed** — a separate process cannot see the desktop's in-session unlock, so it treats a
> lock-enabled workspace as permanently locked and refuses MCP entirely. A paired phone is held to a
> *stricter* standard than the desktop, not a looser one. No fix needed; the claim would have wasted a sprint.
>
> **The Hidden / Recently-Deleted half was REAL, and worse than framed.** Verified empirically:
> `fetch_assets`, `analyze_assets`, and `preview` **all returned a hidden asset — and a recently-deleted
> one — to any agent/mobile principal that knew the asset id.** Only `search` filtered them. So the Face ID
> gate on Hidden was, from a paired phone's perspective, client-side decoration: a phone that saw the photo
> before it was hidden kept the pixels via `get_image_preview(asset_id)`.
>
> **Fixed:** `AgentImageService._metadata_restricts_agent_access()` — a shared predicate filtered in
> `_hydrate_assets` (covers fetch + analyze) and checked in `preview`. Restricted assets report as
> **not found**, never "forbidden", so the reply is not an existence oracle for hidden photos. Unhiding
> restores access. Test: `tests/agent_hidden_asset_gate_units.py` (11 checks).

**Why.** Audit §7. Both are enforced **only in the Electron main process**. There is **no lock check in the MCP request path**, and the Touch ID gate for Hidden / Recently Deleted is macOS-only Electron code.

> **A paired phone bypasses both today.** In a privacy-first product, that is the hole.

**Files.** `desktop/main.cjs:1049-1109, :4852-4860` → backend; `mcp_server.py` request path.
**Done when.** A paired device cannot read Hidden or Recently Deleted without re-auth, and cannot read anything while the workspace is locked.
**Effort.** **M**

---

## E0.5 — Telemetry off by default ✅ **FIXED (2026-07-14)**

> `MCP_OTEL_ENABLED` now defaults to **False** (opt-in), and `export_workspace_backup` now
> **excludes the plaintext trace log** — verified: the backup does `os.walk(root)` with only
> WAL/SHM/lock exclusions, so the log really was riding along in every archive (and in an
> *unencrypted* ZIP when no backup passphrase is set). `mcp/README.md` updated to document
> tracing as opt-in. Test: `tests/telemetry_default_off_units.py`.

**Why.** Audit §9.5. `enabled = env_flag("MCP_OTEL_ENABLED", default=True)` — **on by default**, writing `mcp-traces.jsonl` **synchronously on every tool call**, with no product config and no UI toggle. This contradicts the documented *"genuinely no telemetry"* posture (`docs/security-audit.md:28,153`).

**Nuance (an earlier draft over-claimed):** it does **not** export to OTLP by default — that needs an explicit env var. And `_SAFE_ATTRIBUTE_KEYS` is genuinely well-designed and **cannot carry asset ids, paths, or person names.**

**But the real problems remain:**
- **The plaintext trace log sits inside an otherwise SQLCipher-encrypted workspace — and is zipped into every workspace backup.**
- The OTLP exporter has **no scrubber of its own**.
- Client-supplied `traceparent`/`baggage` is **trusted as parent context**.

> This is not a privacy nit. The *Barnett v. Apple* on-device defense (spec §2.3) — the thing that separates us from Apple's own certified BIPA class action — **depends on biometric-adjacent data never being collected.** A plaintext trace log next to face embeddings undermines it.

**Done when.** Telemetry defaults to **off**; the trace log is encrypted or excluded from backups; `traceparent` is not trusted from clients.
**Effort.** **S**

---

## E0.6 — Break the serial command loop

**Why.** Audit §10. `for line in sys.stdin` (`api_server.py:44060`) processes **one command at a time, no worker pool**. A running scan blocks every other read. `cancel_scan` **can never be dequeued while the scan it targets is running** — which is why Electron resorts to writing sentinel *files*.

> **"Offload heavy compute to the desktop" is impossible at any usable latency until this changes.** A phone requesting an embedding would queue behind a library scan, with no cancellation and no progress.

**Do.** Generalize the one existing async pattern (`start_photo_export_job` → `photo_export_job_status` → `cancel_photo_export_job`) into a durable submit-and-poll job model over `photo_indexing_jobs`.
**Effort.** **L**

---

## E0.7 — SQLite contention

**Why.** Audit §9.4. WAL means desktop writes don't block mobile *reads* — the contention is writer-vs-writer. But **the process-local `RLock` is held across the entire 30-second busy-wait**, so **one stuck mobile write serializes every DB-touching request in the MCP process**, and the 8-slot semaphore (no path exemption, no timeout) then **wedges the entire HTTP surface — including authentication and the static mobile assets.**

**Do.** Pooled read-only WAL connections; fail-fast `busy_timeout` on the HTTP path; exempt auth/static from the semaphore.
**Effort.** **M**

---

## E0.8 — LAN bind

**Why.** Audit §3.5. `startMcpHttpServer` hardcodes `127.0.0.1` and never passes `--allow-remote-http` — **which the Python side already supports** (`mcp_server.py:4111`). A phone on the same Wi-Fi cannot reach the desktop at all.

**Do.** LAN-bind option; relax `normalizeMobilePublicUrl`'s HTTPS-origin requirement for **pinned-cert private IPs**. Add **`NSLocalNetworkUsageDescription` to the Electron app** — macOS 15+/26 gates local network access too, and this is the half everyone forgets.
**Effort.** **S** (plus a sprint of debugging the macOS prompt — there are open Apple Forum threads about it not appearing for bundled apps)

---

# Phase 1 — Protocol foundation

## E1.1 — `vintrace-sync-v2`

**Why.** Spec §5. Two channels exist today and **share no identity, no pairing, and no transport**.

**Reuse verbatim:** Ed25519/X25519 identity, the QR invitation, the AES-GCM envelope with kind/sender/receiver/requestId as AAD, the operation signing payload, the HLC, the rank tuple, the vector clock, the 7 change-capture triggers.

> **The single most important architectural fact: the phone is a pure client.** `sync_peer` is a full bidirectional exchange initiated by the caller. **No inbound listener on the phone.** This sidesteps the entire class of iOS background-server problems.

**Change:** entity key → `asset_uid` · lift the `entityType == "asset"` gate · **keywords → an add/remove CRDT set** (today whole-value LWW **silently destroys one device's entire keyword list** on concurrent tagging — Apple Photos does not lose data; shipping this is a competitive liability) · op-log compaction + snapshot (50k assets ≈ 500–650k ops ≈ **250–400 MB** uncompacted) · byte-budgeted paging that **resumes instead of raising** (today `sync_peer` **throws** after 20 rounds — the initial sync of a real library *ends in an exception*) · relax `_private_ip` · **add TLS** (there is none) · **add forward secrecy** (static-static DH gives one immutable session key forever) · persist invitations across restart.

**⚠️ The #1 porting risk is canonical JSON.** `json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=True)`. JS `JSON.stringify` **does not sort keys and does not escape non-ASCII**. Write a canonicalizer with a conformance test against `tests/local_sync_units.py`, or **every signature the phone produces is rejected.**

**Effort.** **L**

## E1.2 — Change feed (T4) ✅ **BUILT (2026-07-15)**

> `photo_catalog_changes` is an unconditional append-only SQLite journal with monotonic integer cursors. Triggers cover asset, metadata, keyword, album-membership, people-link, edit-stack, and external-id mutations; existing catalogs receive a one-time baseline. `GET /v1/changes?afterSeq=&limit=` is authenticated, mobile-readable, path-free, and emits current snapshots plus hard-delete and protected-removal tombstones. Tests: `tests/catalog_change_feed_units.py` and `tests/mobile_companion_http.py`.

**Why.** Audit §9.7. ⚠️ **The "~90% built" claim was refuted — it is ~35%.** The 9 triggers write only to `photo_sync_dirty`, a **coalescing dirty-set, not a log**. `photo_sync_operations` has one writer, **gated on SQLCipher** — so the op-log is **empty on any unencrypted workspace**. And `photo_asset_events` **hard-rejects any event type outside `{viewed, shared}`**.

**Decision.** Do **not** manufacture unsigned rows in `photo_sync_operations`: valid CRDT rows require the encrypted signing identity. Keep the signed peer-sync op-log encryption-bound and use the dedicated unconditional catalog journal for T4. `photo_asset_events` remains correctly scoped to viewed/shared activity.
**Effort.** **M**

## E1.3 — Media tier (T2)

**Why.** Spec §5.6. The ten changes to `photo_catalog_portability.py` are specified there with exact line numbers. Highlights: bump `formatVersion`; scope the export (every SELECT is currently an **unfiltered full-table scan**); relax the closed-world validator; **add tombstones** (there is **no delete anywhere in the file** — a phone deletion can never reach the desktop); replace "package wins" with LWW; add a proxy/thumbnail tier; **pin a stable `catalogId`** (it mints a fresh UUID per export, so the external-id mapping **resets on every sync**); chunk the transaction (it currently holds the **global DB connection for the entire run**); give it a stream surface; cut the **~4–5 full SHA-256 passes over every byte**.

**⚠️** A catalog import currently sets `meta['photoSyncApplying']='1'`, which **suppresses the CRDT triggers** — so imports are **invisible to the sync tier** today.
**⚠️** The **8 MiB manifest cap** is binding: it inlines ~150 bytes per media file, so **~50k files fills it.**

**Effort.** **L**

## E1.4 — Blob-ingest RPC + compute offload (T3)

**Why.** Audit §6.1. **Not one of the 369 commands accepts image bytes.** But the engines *beneath* them **already take in-memory PIL images** (`embed_loaded_image`, `encode_image(image=...)`, `assess_image_safety`).

> `embed_face_blobs(images) -> {vectors, model_name, quality}` is **a thin adapter, not a rewrite. Do this first — it unblocks everything else.**

Then extend `photo_indexing_jobs` with `origin='mobile'` + a blob staging area. **Surface the deferral reasons** (`battery` / `thermal` / `foreground-active`) so the phone can honestly say *"waiting for your Mac to be plugged in."*

**⚠️** Face scanning is **not** one of the 10 job kinds — it goes through `scan_runs`/`scan_files` and needs its own remote trigger.
**⚠️** The wire protocol **must carry `model_name`**: `FallbackEmbeddingEngine` emits a 512-d *non-face* fingerprint that is **dimensionally identical** to a real embedding. A length check accepts it silently and **poisons the index**.

**Effort.** **M** (blob RPC) + **L** (offload queue, depends on E0.6)

## E1.5 — Schema: faces, people, clusters

**Why.** Audit §4.1. There is **no faces table** (no queryable bounding boxes — a People UI **cannot draw face chips**), **no clusters table** (unnamed people are the literal string `"Unmatched cluster N"`, matched with `LIKE`), and **no stable person identity** (`person_name` **is** the primary key — so **two devices renaming concurrently cannot be reconciled**).

**Effort.** **L**

---

# Phase 2 — The mobile app

## E2.1 — Replica + storage ✅ **FIRST CUT (2026-07-14)**

> ✅ **Running on-device.** `mobile-app/app/src/replica.ts`: a SQLCipher-encrypted op-sqlite DB (WAL) holding the camera-roll assets keyed by a stable `asset_uid` (external_id → PHAsset localIdentifier), plus a `sqlite-vec` `int8[512]` table for the SigLIP embeddings the desktop will sync. **The grid renders FROM the replica** (offline-first: ingest camera roll once → read back from the encrypted DB), and a real on-device sqlite-vec KNN runs (126 ms over 20k int8[512], Debug/cold — SP-2 measured 26.8 ms/100k Release/warm). Screenshot: `mobile-app/docs-replica-grid.png`. Follows spec §6: raw-BLOB vectors (never JSON), keychain-key + 3-file split are the production hardening still to do.

Spec §6. op-sqlite + SQLCipher + FTS5 + sqlite-vec. Three DB files (`meta` / `vec` / `sensitive`), separately keyed.

**The five traps** (spec §6.3) are load-bearing: **never serialize embeddings as text** (Ente measured 1 GB / 19 s for 100k CLIP-512 — the desktop makes this exact mistake today); **never do KNN in JS**; **never combine `NSFileProtectionComplete` with WAL** (background sync dies with `SQLITE_IOERR`); **never put the DB in `Library/Caches`**; **never biometric-gate the main DB key** (the key becomes unavailable in the background and **background sync silently stops** — split the keys).

**Effort.** **M**

## E2.2 — The grid ✅ **FIRST CUT RUNS (2026-07-14)** — SP-1 unblocked it

> ✅ **Runnable on the iPhone 17 Pro simulator.** `mobile-app/app` reads the real camera roll via `expo-media-library` `exeForMetadata()` (96 photos indexed in 79 ms), renders a FlashList grid with `expo-image` resolving `ph://` at cell size, and composes `@vintrace/decision-layer` (live on-device band badge). Screenshots: `mobile-app/docs-library-grid.png` (grid), `mobile-app/docs-detail-view.png` (full-screen pager detail view — swipe + filename/dimensions/date). Remaining for production scale: `PHCachingImageManager` prefetch native module (spec §7) + a 100k-asset device test.

Spec §9.2. **The list virtualizer is not the bottleneck** and no FlashList tuning will save a bad pipeline.

- **Image memory is where you die.** 200 full-res images in a 5-column grid spiked `expo-image` to **1.53 GB and crashed above 60**. **Never hand a full-res `PHAsset` URI to a grid cell.**
- **Getting 100k descriptors out of the OS is the real wall.** Use the **new object-oriented `Query` API with `.exeForMetadata()`** — it reads metadata *"cheaply from the media store without decoding files."* Legacy `getAssetsAsync()` is deprecated.
- **`PHCachingImageManager` — no RN library exposes it.** It is the exact mechanism that makes Apple's grid feel instant. **Write it as a Nitro module** (spec §7, item 2).

**Effort.** **L**

## E2.3 — Decision layer in TypeScript ✅ **BUILT (2026-07-14)** ⭐ *the moat*

> ✅ **Done.** Ported to `mobile-app/packages/decision-layer` (Platt, AS-Norm, CohortNormalizer, adaptive linear calibrator, fuseScores, cross-age banding, pose thresholds). **Conformance-verified** against the real Python reference: `tools/gen_decision_layer_fixtures.py` dumps 128 golden cases from `crossage_fr.match`; `test/conformance.test.ts` requires the TS output to match within 1e-9. Typecheck clean, 12/12 test groups green, runnable demo composes it into live offline re-banding. Zero native deps.

**Why.** `crossage_fr/match/` is **pure NumPy with zero model weights** — AS-Norm (cohorts are **246 KB total**), Platt, the `AdaptiveLinearCalibrator` (JSON-serializable via `to_payload`/`from_payload`), age-gap widening (pure `datetime`).

> Port it verbatim to TypeScript and the phone can **re-band, re-threshold, and re-rank matches locally, instantly, offline, with zero model download.** Apple cannot do this because Apple exposes no decision layer at all.

**Effort.** **S** — genuinely an afternoon, and it is the highest value-per-hour item in the entire plan.

## E2.4 — Semantic search ⭐ *the elegant split*

> 🟡 **Runtime spike implemented, architecture gate still open.** The mobile prototype has no `onnxruntime-react-native` dependency. It uses `react-native-executorch` 0.9.2 plus the Expo resource fetcher for real CLIP image/text embeddings, and the TypeScript build and Expo Doctor pass. The runtime remains isolated to `src/semantic.ts`; do not make it the permanent SigLIP2 contract until an Expo 57 / RN 0.86 release build passes on physical iOS and Android devices. The vendor's published 0.9.x compatibility table currently stops at RN 0.85 / Expo 55.

**Why.** Spec §5.4(a). Sync the **768-d vectors** to the phone (int8 ≈ 768 B/photo ≈ **51 MB at 100k**) and run **only the SigLIP2 *text* encoder** on-device. **The vision tower never ships.**

**If you re-export exactly one model, make it SigLIP2.** The current export is uint8 dynamic-quantized (`DynamicQuantizeLinear`/`MatMulInteger`/`ConvInteger`), which lowers to **CPU-only kernels** and will never touch the ANE — *and it is why the desktop pins SigLIP to CPU on Apple Silicon today.* An fp16 static-shape re-export fixes **both**. One re-export, two wins.

**⚠️ INT8 is an active trap on iOS.** Verified against ORT's Core ML op-builder source: there is **no `ConvInteger`, no `DynamicQuantizeLinear`, no `QuantizeLinear`/`DequantizeLinear` builder.** ORT silently falls back to CPU, **fragmenting the graph and losing the ANE entirely — often slower than FP32.** **FP16 on iOS; INT8 only on Android/XNNPACK.**

**Effort.** **M**

---

# Phase 3 — Camera roll

## E3.1 — PhotoKit ingest (the biggest native module)

Spec §7. `PHFetchResult` paging without materialising JS objects · `PHAssetResourceManager` for original HEIC/DNG bytes · iCloud-optimized handling (`isNetworkAccessAllowed`, progress).

**What off-the-shelf libraries do *not* give you:** ProRAW/DNG (**no support anywhere** — RAW is not a `PHAssetMediaSubtype`), depth maps (**zero support**), spatial stereo pairs, **bursts** (`includeAllBurstAssets` is hard-coded `false`), and cheap EXIF/GPS (iOS `getExif()` reads the **full-size original off disk** and **fails for iCloud-optimized assets**; Android **never calls `setRequireOriginal()`**, so **GPS comes back null even with `ACCESS_MEDIA_LOCATION` granted**).

**⚠️ The Android change-observer in `expo-media-library` is a trap:** it re-queries every image/video row and **sums the IDs on every `onChange`** just to detect insert/delete — **a full 100k-row table scan per MediaStore notification.** The correct primitives (iOS `fetchPersistentChanges(since:)` + `PHPersistentChangeToken`; Android `MediaStore.getGeneration()`) are **exposed by nothing in the RN ecosystem.** This alone justifies the native module.

**Effort.** **L**

## E3.2 — Background backup

Spec §8. **Use a background `URLSession`** — transfers run out-of-process and survive suspension *and* system termination. **The BGTask is only the scheduler.**

> **Immich ran uploads inside the BGTask window and shipped four years of "background backup doesn't work" issues.** Their `main` now swizzles the background `URLSession`. **That lesson is pre-paid — take it.**

**Tell the truth in the UI** (spec §8.4). iOS **cannot** wake on a new photo; Android **can**. Background-initiated transfers are **forced `isDiscretionary`**. **Force-quit is absolute on iOS.**

**Effort.** **L**

## E3.3 — Consent gate for Face Data egress 🔴 **Contractual**

**Why.** **DPLA §3.3.3(K):** Face Data *"may not be shared or transferred off the user's device unless You have obtained clear and conspicuous consent for the transfer."* **Our phone→Mac sync moves Face Data off the phone.**

This is a **contract-level obligation, not a guideline**. It needs its **own explicit, conspicuous consent screen** — not a line in the EULA, and not folded into the existing desktop consent.

**Effort.** **S** — but it is a ship-blocker.

---

# Phase 4 — Parity and polish

| Epic | Notes | Effort |
| --- | --- | --- |
| **E4.1 People & Pets UI** | Ship the thing Apple won't: **a correction loop.** iOS Photos **removed the confirm flow around iOS 17** and you **cannot draw a face box on iPhone at all**. Also: Apple's pet support is **exactly `.cat` and `.dog`** — every other pet is uncontested | L |
| **E4.2 Cross-age** | ⚠️ **Framing decides everything.** *Within-library, same-person-over-time* is fine. *1:many against a reference database* is **EU AI Act Annex III(1)(a) high-risk** and an instant App Review escalation. **Never use "identify," "match against a database," or "find this person" in the copy** | M |
| **E4.3 Widgets** | **SwiftUI-only, confirmed** — a "React Native widget" is a category error. Use Expo SDK 57's first-party `expo-widgets`. ⚠️ `expo-live-activity` was **archived 2026-06-01** | M |
| **E4.4 App Intents** | ⚠️ **Now mandatory.** WWDC 2026 **deprecated SiriKit**; App Intents is the **sole path** for Siri into third-party apps, and non-migrated apps are **invisible** to the Siri shipping in iOS 27. `react-native-siri-shortcut` is a **dead end** | M |
| **E4.5 Accessibility** | Apple ships a **separate, simplified Photos app under Assistive Access**. Plus VoiceOver **Image Descriptions** (Apple's actual shipping "describe my photo"). A virtualized grid is an accessibility hazard — budget for it | M |
| **E4.6 Video** | Zero `Range`/`206` **anywhere** in the codebase — and Electron's `vintrace-media://` ignores Range too, so **seeking a 4 GB clip has no range path even on the desktop.** `analyze_assets` **raises `ValueError` on `"depth"`, `"spatial"`, `"pairs"`** | L |
| **E4.7 iOS 27 / UIScene** | ⚠️ **Apps built with the iOS 27 SDK must adopt the scene-based lifecycle or they fail to launch** (TN3187). Lands ~Sept 2026 — inside this project's build window | M |

---

# Cross-cutting

## X.1 — Model delivery ✅ *easier than feared*

**Both stores will host our ~235 MB for free.** The prior assumptions were wrong on three counts:

- **iOS: Background Assets + Managed/Apple-Hosted asset packs** (iOS 26+). Apple hosts **up to 200 GB** with the Developer Program membership, packs upload to App Store Connect **separately from the build**, and **Apple's own documentation names "machine learning models" as an intended asset type.**
- **Android: Play Asset Delivery.** Free hosting; asset packs up to **1.5 GB**.
- ⚠️ **The "200 MB Play base-module cap" is stale.** Current limits: base module **500 MB**, asset pack 1.5 GB, 4 GB cumulative install-time. **235 MB would fit in the base module** — the only cost above 200 MB is a non-blocking mobile-data dialog.
- ⚠️ **Guideline 2.5.2 is *not* a real threat to model weights.** It bans downloading *"code which introduces or changes features"*; the 2026 enforcement wave (Replit, Vibecode, "Anything") targeted **code execution, not weight data** — and *"Anything" was restored to the App Store on ~2026-04-03* after remediation. Apple itself documents *"Downloading and Compiling a Model on the User's Device."* Live precedent: **PocketPal AI**, a React Native App Store app that downloads GGUF weights at runtime.

**Precedent:** Ente ships **0 bytes** of weights in the binary and pulls **237.7 MB** at runtime with SHA-256 verification, gated on unmetered network.

**Biggest byte win is free OS models:** OCR is **0 bytes on both platforms** (Vision / ML Kit). Face *detection* is **0 bytes**. ⚠️ But `SensitiveContentAnalysis` is a trap — it **silently returns nothing unless the user has personally enabled Sensitive Content Warning**, so **we must still ship our own NSFW model.**

> **Target: 0 MB of weights in the store binary. ~55 MB required before first use. ~200 MB fully loaded.**

⚠️ **No RN binding exists for Background Assets *or* Play Asset Delivery.** Apple-Hosted BA needs a **separate app-extension target**, App Groups entitlement, and Info.plist keys — things Expo config plugins **cannot fully express**. **Budget 2–3 weeks of native work.**

## X.2 — Recovery and device loss 🔴 *the hardest UX problem, and it is unsolved*

**In a no-account, no-server, E2E system there is no password-reset escape hatch. Recovery must be designed as a product feature, or the user's library is one dead Mac away from permanent loss.**

Every comparable product uses the same three-part shape:
1. A **high-entropy user-held secret created *before* the crisis** (Signal's 64-character key; Ente's 24-word key; 1Password's printed Emergency Kit).
2. An **escrow guarded by a rate-limiter** (iCloud Keychain's HSM cluster, 10 attempts then destroy). **⚠️ This requires a server we do not have.**
3. A **second live device or a trusted human** (Apple's Recovery Contacts, up to five).

> **Our viable design space is (1) + (3).** The "server" that rate-limits must be **the desktop itself**, with **the phone as the second live device.**

**What the repo has, and why it is not enough:** `desktop/main/workspace-encryption.cjs` already implements a **scrypt + AES-256-GCM passphrase recovery envelope** — but it writes it to `.vintrace-db-key.json` **inside the workspace directory, next to the encrypted DB it protects.** That defends against "Keychain wiped" and **not at all against "the Mac's disk is gone"** — which is the actual disaster. There is **no off-device escrow, no printed recovery artifact, and no phone-side copy of the workspace key.**

**Revocation is weaker than it looks.** `local_sync`'s `active|revoked` status is an **authorization flag, not a cryptographic event** — no key rotation, no SQLCipher `PRAGMA rekey`. Syncthing states the matching threat plainly: *"anyone with access to TLS keys and configuration files can impersonate your device."* Ente shipped this exact bug (`ente-io/ente#2050`). **Data already on a lost device is gone from your control. Say so honestly rather than implying otherwise.**

**Platform levers are sharp and mutually exclusive:**
- `kSecAttrAccessible…ThisDeviceOnly` — doesn't sync, isn't backed up, isn't in escrow keybags. **Exactly right for a device identity key — and exactly why a new phone can never inherit the old phone's identity. It must re-pair.**
- `kSecAttrSynchronizable` would survive phone loss, but **only by escrowing to Apple's iCloud Keychain HSMs — a direct violation of "no cloud."**
- Secure Enclave keys are **perfect device-identity keys and structurally impossible data keys** — they cannot be backed up, by design.

**Also needs designing:** **multi-device conflict UX** (our sync is per-field HLC last-writer-wins with a conflict table **that is currently never surfaced to anyone**), and **what the phone shows when the Mac is simply off** — which features degrade, which keep working, and how to say so without making the user feel broken.

**Effort.** **L**, and it is a **ship-blocker**, not a nice-to-have.

> ✅ **DESIGNED + a real ship-blocker FIXED (2026-07-14).** The design (Workspace Master Key, two-artifact recovery, scenario walkthroughs) is in `2026-07-14-mobile-spike-results.md` §6. **Correction:** tracing proved recovery is NOT decorative — the recovery envelope is bundled in the backup ZIP and the printed code alone opens the encrypted DB. But tracing found a worse, real bug: **`restore_workspace_backup()` crashed on any cross-machine restore** (it verified the archived DB with the host key, which differs on a new machine). A user whose disk died could not restore. **FIXED:** the backup manifest now records `workspaceKeyId`, and verify distinguishes a genuine key mismatch (recoverable) from corruption (hard fail). Test: `tests/workspace_backup_cross_machine_units.py`. Still open: wiring an in-app "restore + enter recovery code" flow (fix 4 in the plan) and the full WMK refactor.

## X.3 — Compliance checklist

- [ ] File Google Play's **Photo and Video Permissions declaration** (enforced since 2025-05-28). "50k–100k photo library indexing" is a genuinely good justification for broad `READ_MEDIA_IMAGES` — **but the form must be filed.** ⚠️ The Android Photo Picker **cannot enumerate a library** and caps persistable grants at 5,000, so the approved-declaration bucket is **existential** for this product.
- [ ] Explicit, conspicuous **Face Data transfer consent** (DPLA §3.3.3(K)) — E3.3.
- [ ] **Never** identify strangers or match outside the user's library (Guideline 5.1.1(viii)).
- [ ] **Never** train or fine-tune on user photos (Guideline 5.1.2(vi)).
- [ ] **Never** ship face-unlock with our own model (Guideline 2.5.13 — use `LocalAuthentication`).
- [ ] **COPPA's amended Rule added "facial templates … or faceprints"**, compliance deadline **April 22, 2026 — already passed.** This product deliberately builds facial templates of children. **Do not market it as a kids/family product** without verifiable parental consent.
- [ ] Ship the Electron desktop **Developer ID + notarized, never the Mac App Store** (sandbox + Python + 2.5.2 = months of fight for zero benefit).
- [ ] Privacy nutrition labels: on-device-only processing is **not "collection"** under both Apple's and Google's rules — **provided E0.5 lands.**

## X.4 — Testing and CI

- **Seed a 100k-asset library** and make grid FPS, cold-start, and search latency **gated metrics**, not vibes.
- ⚠️ **Detox's stated support stops below RN 0.86** ("might work, not thoroughly tested" — it is a coverage gap, not abandonware; 401 releases, latest 2026-05-30). ⚠️ **Maestro's EAS Workflows job type is in *alpha*** — Expo's own docs say so twice. **Neither option is clean. Pick with eyes open.**
- Three-way version skew is real: the **Electron app auto-updates freely**, the **phone waits on a review queue**, and an **OTA JS bundle moves independently of both.** Version the **sync protocol** and the **DB schema** explicitly, and negotiate on connect.
- `eas update:roll-back-to-embedded` is the **true kill switch** (a rollout revert only republishes the control update).

---

## Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| ~~RN cannot hold 60fps over 100k local assets~~ | ✅ **RETIRED** | **Measured: 60.0 fps @ 267 MB.** Replaced by a sharper risk: *shipping a full-res pipeline*, which scores great FPS and silently uses **3.17 GB** |
| **Full-res images reach grid cells** | 🔴 **Existential** | 267 MB → 3,174 MB. **Gate peak memory in CI, not FPS** |
| Face-model licensing changes | 🔴 | Already mitigated — the model never leaves the desktop |
| BIPA / biometric litigation | 🔴 | Strict zero-egress (E0.5), on-device only, explicit consent (E3.3). **This is the same feature behind the four largest biometric payouts in history** |
| iOS background sync disappoints users | 🟠 | **Tell the truth in the UI** (spec §8.4). Do not promise what iOS will not deliver |
| Android OEM battery killers | 🟠 | **Unsolved industry-wide in 2026.** Ship an in-app "fix my phone" flow; link `dontkillmyapp.com` |
| Op-log growth (250–400 MB @50k) | 🟠 | Compaction is a **prerequisite**, not an optimization (E1.1) |
| Local-network permission denial | 🟠 | Race Bonjour against a cached IP (the Plex model) so discovery degrades gracefully. Evaluate Android's **system-mediated device picker**, which skips the permission prompt entirely |
| Device loss / dead Mac | 🟠 | **X.2 now designed** (spike-results §6). Remaining risk is execution, not design |

---

## The shortest path to something real

If the goal is a demo that proves the thesis rather than a shippable app:

1. **E0.3** (Safe Mode) + **E0.5** (telemetry) — hours, and they are security/legal.
2. **E1.4** blob-ingest RPC — the thin adapter. **Unblocks everything.**
3. **E2.3** decision layer in TypeScript — an afternoon, and it *is* the moat.
4. **E2.4** semantic search with synced vectors — offline CLIP search on a plane, which Apple Photos cannot do.
5. **SP-1** the grid spike — because if it fails, everything above is moot.

That sequence produces, in roughly a month, a phone that **searches your library semantically with no network, and re-ranks face matches with a calibrated decision layer Apple does not expose.** That is the product in miniature. Everything else is scale, polish, and parity.

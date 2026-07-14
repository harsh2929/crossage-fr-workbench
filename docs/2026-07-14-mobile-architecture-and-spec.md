# Mobile — Target Architecture and Technical Specification

**Date:** 2026-07-14
**Status:** Specification. Decisions here are made, not proposed. An implementing agent should treat this as the contract.
**Prerequisite reading:** `2026-07-14-mobile-integration-audit.md` (what exists today), `2026-07-14-apple-photos-mobile-atlas.md` (the bar).
**Downstream:** `2026-07-14-mobile-implementation-backlog.md` (dependency-ordered execution).

---

## 0. Decisions taken

These were explicit product decisions, not defaults. They are settled; do not re-litigate them without the owner.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Cross-platform React Native** (Expo, not bare) — iOS first, Android second | One codebase; the native-module budget (§7) is real but bounded |
| D2 | **Superset library**: own catalog **+** read the phone camera roll | Same photos as Apple Photos, better intelligence on top. This is the wedge |
| D3 | **Offline-first**, LAN sync + relay fallback | The desktop is not always on. A photo app that needs a server is not a photo app |
| D4 | **Stable UUID `asset_uid`** as canonical key; content-hash / external-id / path-hash become *resolvable axes* | Today's identity is `sha256(absolute path)` — it breaks on every file move |
| D5 | **Media tier built on Open Photo Catalog** (`photo_catalog_portability.py`) | Hash-addressed storage, manifest root-of-trust, idempotent re-import, and a 34-table allowlist are already written and tested |
| D6 | **Desktop is the licensed compute node** for face recognition | Not an optimization — a licensing constraint (§2.2) |

---

## 1. The thesis in one paragraph

The phone holds a **complete, offline, encrypted replica of the human catalog** (~2.8 KB/asset — 280 MB at 100k photos) plus **semantic embeddings** (int8, ~768 B/photo) and **ThumbHash placeholders** (25 B/photo). It renders instantly, searches semantically, and re-ranks face matches **with no network at all**. When the paired Mac is reachable, it becomes an **intelligence uplink**: the phone ships new camera-roll photos up, and the Mac — which holds the licensed face model, the heavy models, and the CPU — ships embeddings, clusters, and calibrated decisions back. Apple Photos cannot do the second half, and cannot ever do the cross-age half. That is the product.

**What we are *not* building:** a remote viewer for the desktop. That already exists, and it is why the current mobile story has no users.

---

## 2. The three constraints that shape everything

### 2.1 PhotoKit gives us nothing about people

A third-party iOS app **cannot** read Apple's person identities, face bounding boxes, pet identities, or enumerate the People & Pets album. Confirmed twice on the record by Apple engineers, and verified against the shipping symbol index: PhotoKit contains **zero** symbols matching person/face/people/identity.

**⚠️ Trap:** `PHAssetCollectionSubtype.albumSyncedFaces` looks like the answer. It is not — Apple's own docs define it as *"a Faces group synced to the device from iPhoto"*, a dead iTunes-sync artifact that is empty on every modern device. An engineer *will* find this and lose a week. Do not build on it.

**What we get free, on the Neural Engine, via Vision:**
- `DetectFaceRectanglesRequest` — bounding box + roll/pitch/yaw
- `DetectFaceLandmarksRequest` — landmark constellation
- `DetectFaceCaptureQualityRequest` — a float quality score (**a free FIQA substitute**, and exactly the signal needed for key-face selection)
- `GeneratePersonInstanceMaskRequest`, `GeneratePersonSegmentationRequest`, body/hand pose
- `RecognizeAnimalsRequest` — **exactly two cases: `.cat` and `.dog`** (which precisely matches Apple Photos' own pet support, strongly implying it is the same model — every other pet is an uncontested opening)
- Text recognition — **a free OCR substitute**

Vision exposes **no face embedding, no faceprint, no recognition, at any privilege level.** So identity is ours to own — and a graph Apple will not let anyone else touch, *including Apple's own users, who cannot export theirs*. That is a moat, not a tax.

### 2.2 We may not ship the face model — this is a licensing wall

The InsightFace weights (`glintr100` / `w600k_r50`) carry `license_tier="research-or-commercial-license-required"` (`model_manager.py:72,92`). **They may not be bundled in an App Store binary.** And because embeddings are only comparable within a model family (`enroll/manager.py:524`), running a *different* face model on the phone produces a parallel, useless index.

> **Therefore the desktop is the face-embedding oracle, permanently.** Every design below assumes this.

**⚠️ Trap:** `FallbackEmbeddingEngine` emits a 512-d **non-face** fingerprint that is dimensionally identical to a real embedding. A length check accepts it silently. **The wire protocol must carry and validate `model_name` on every vector.**

### 2.3 The legal frame makes zero-egress non-negotiable

As of **2026-06-05, Apple is a certified BIPA class-action defendant** over Photos' face-grouping (~6.5M Illinois users). Google paid $100M (Rivera) and $1.375B (Texas CUBI). Meta paid $650M and $1.4B. **This exact feature has produced the four largest biometric-privacy payouts in history.**

The defense that works is *Barnett v. Apple*: biometric data **never leaves the device and is never "possessed" by the vendor.** Apple's own nutrition-label rule and Google's Data-safety rule both say on-device-only processing is not "collection."

**Consequences, and they are hard rules:**
- **No cloud relay that can see plaintext, ever.** Operating a remote computing service also inherits **18 U.S.C. §2258A** NCMEC reporting duties on actual knowledge of CSAM. The relay (§5.4) is E2E-encrypted and sees only ciphertext, or it does not ship.
- **No telemetry may touch a face embedding, face crop, cluster label, or NSFW score.** See audit §9.5 — telemetry is currently **on by default**. That is not a privacy nit; it is the thing that would destroy the *Barnett* defense. Fix it before mobile ships.
- **DPLA §3.3.3(K):** Face Data "may not be shared or transferred off the user's device unless You have obtained clear and conspicuous consent." Our phone→Mac sync *does* move Face Data off the phone. **This requires its own explicit, conspicuous consent gate — not a line in the EULA.**
- **Guideline 5.1.1(viii):** never identify strangers, never match outside the user's own library.
- **Cross-age framing decides everything.** *Within-library, same-person-over-time* ("your daughter at 4 and at 24") is exactly what Apple and Google Photos do and is fine. *1:many identification of a child against a reference database* is EU AI Act Annex III(1)(a) high-risk and an instant App Review escalation. **Never use the words "identify," "match against a database," or "find this person" in cross-age UI copy.**
- **Do not train or fine-tune on user photos** (Guideline 5.1.2(vi) bans use-based data mining of Photo API data).
- **Do not build face-unlock with our own model** (DPLA §3.3.3(K), Guideline 2.5.13 — use `LocalAuthentication`).

---

## 3. System architecture

```
┌─────────────────────────── PHONE (React Native / Expo) ───────────────────────────┐
│                                                                                    │
│  UI            FlashList v2 grid · Reanimated 4 gestures · Skia editor             │
│  ─────────────────────────────────────────────────────────────────────────────    │
│  Decision      match/ ported to TypeScript — AS-Norm, Platt, adaptive calibrator,  │
│  layer         age-gap widening.  ZERO model weights.  Runs offline, instantly.    │
│  ─────────────────────────────────────────────────────────────────────────────    │
│  On-device ML  Vision: face detect + quality + OCR (free, ANE)                     │
│                SigLIP2 TEXT encoder only (query encoding — vision tower never ships)│
│  ─────────────────────────────────────────────────────────────────────────────    │
│  Replica       op-sqlite (SQLCipher + FTS5 + sqlite-vec)                           │
│                meta.db (catalog ~280 MB@100k) · vec.db (int8 embeddings)           │
│                sensitive.db (biometric-gated)                                       │
│                ThumbHash 25 B/asset · 256px WebP LRU cache                          │
│  ─────────────────────────────────────────────────────────────────────────────    │
│  Native        PhotoKit ingest · PHCachingImageManager · BGContinuedProcessingTask  │
│  modules       Bonjour/NWBrowser · background URLSession · WidgetKit · App Intents  │
└────────────────────────────────────┬───────────────────────────────────────────────┘
                                     │  vintrace-sync-v2  (mTLS 1.3 / HTTP-2 / TCP)
                                     │  QR-pinned cert · Ed25519 identity
                    ┌────────────────┴────────────────┐
                    │  LAN (Bonjour + cached IP)      │
                    │  Relay fallback (E2E, blind)    │
                    └────────────────┬────────────────┘
┌────────────────────────────────────┴───────────────────────────────────────────────┐
│                          MAC (Electron + Python backend)                            │
│                                                                                     │
│  T1 op-log     signed CRDT metadata (extended: asset, album, person, editStack…)    │
│  T2 media      hash-addressed blobs, chunked/resumable, byte-range   [NEW]          │
│  T3 compute    durable job queue — embed / cluster / index / safety  [NEW]          │
│  T4 changefeed cursor-paged deltas from photo_asset_events           [NEW]          │
│  ─────────────────────────────────────────────────────────────────────────────     │
│  THE ORACLE    licensed InsightFace embedding · cross-age matching · clustering     │
│                SigLIP2 vision tower · depth · NSFW · heavy generative               │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 What runs where, and why

| Work | Phone | Desktop | Why |
| --- | --- | --- | --- |
| Face **detection** + quality | ✅ Vision, free, ANE | ✅ | Free on-device; no reason to round-trip |
| Face **embedding** (ArcFace) | ❌ **Never** | ✅ | **Licensing** (§2.2) — not negotiable |
| Cross-age matching, clustering, calibration | ⚠️ *Re-rank only* | ✅ *Authoritative* | Decision layer is pure NumPy → ports to TS; but it needs desktop-produced vectors |
| Semantic search — **image** embedding | ⚠️ New photos only | ✅ Backfill | 100k backfill on a phone = **38+ hours** (Ente's measured reality) |
| Semantic search — **text** encoding | ✅ **Must be on-device** | — | Otherwise offline search breaks entirely |
| OCR | ✅ Vision (free, better) | ✅ | Platform API beats our PP-OCR here |
| NSFW / Safe Mode | ⚠️ Weak ViT only | ✅ Category-aware | Guardrail requires Qwen3-VL exactly (10 GiB RAM floor) |
| Depth, generative, upscale | ❌ | ✅ | Contrib ops / RAM floors / Vulkan — see audit §5.3 |

**The load-bearing insight:** sync *embeddings*, never pixels-for-compute. 100k × 512-d int8 ≈ **51 MB**. That is cheap, and it means the phone can re-rank and re-threshold matches locally, instantly, offline — which is exactly the "feels faster than Apple Photos" win.

---

## 4. Asset identity — fix this first

**This is the #1 blocker. No schema may be written before it lands.**

### 4.1 The problem

Three disjoint identity spaces (audit §9.1). `assetId = sha256(absolute source_path)` **changes when a file moves**. `local_sync` keys on the SHA-256 of original file bytes — and **iOS re-encodes on export**, so the same logical photo hashes differently on phone and Mac. Convergence would be near-zero.

### 4.2 The model

A single canonical key, with identity *axes* that resolve to it:

```
asset_uid   TEXT PRIMARY KEY     -- UUIDv7, minted once, never derived, never changes
```

| Axis | Key | Stability |
| --- | --- | --- |
| `content_hash` | SHA-256 of original bytes | Stable per *encoding*. Breaks on re-encode |
| `external_id` | `(provider, library_id, external_id)` — PHAsset `localIdentifier`, MediaStore id | Stable per *device library* |
| `path_hash` | legacy `sha256(abs path)` | Deprecated; retained for migration only |
| `perceptual_hash` | pHash/dHash | Fuzzy — for dedupe *suggestions* only, never identity |

**Resolution order on ingest:** `external_id` → `content_hash` → `perceptual_hash` (suggest-only, requires confirmation) → mint new `asset_uid`.

`photo_asset_external_ids` is the right hook — it is exactly the PHAsset `localIdentifier` mapping, and routing phone assets through it avoids the `photo_assets.source_path UNIQUE NOT NULL` violation a phone asset would otherwise cause.

⚠️ **It is a live table, not a dead one.** An earlier draft called it "unused" — that was wrong. It is actively upserted (`photo_sources/catalog.py:350`) and state-updated (`photo_sources/service.py:1727, :2150`) for connector-ingested assets. It is merely never exposed over HTTP. **The migration must respect its existing contents.**

### 4.3 This is a live defect, not just a mobile blocker

The upsert (`workspace_db.py:8318-8335`) resolves an existing row by `WHERE asset_id = ? OR source_path = ?` **only** — there is **no `content_hash` rehoming anywhere in the codebase.**

> **Move or rename a file today and it becomes a brand-new asset**, orphaning its faces, people, albums, keywords, embeddings, edit stacks, favorite, and rating. This is broken on the desktop right now, independent of mobile. The `asset_uid` migration fixes a real bug; it is not mobile overhead.

### 4.4 Migration surface

Every table and code path that stores or compares an asset id must be enumerated and migrated. `_public_asset()` must begin exposing `assetUid`, `contentHash`, `externalIds`, `updatedAt`, and `deletedAt` (it exposes none of them today). **The precise table/column/code-path inventory is carried in the backlog document as the first epic.**

⚠️ The op-log's entity key changes from `LOWER(content_hash)` to `asset_uid` — a **protocol version bump** to `vintrace-local-sync-v2`.

---

## 5. Transport — `vintrace-sync-v2`

### 5.1 One channel, four tiers

Today there are two non-interoperating channels (audit §2.3). v2 unifies them. The phone is a **pure client** — it initiates everything, and needs **no inbound listener** (audit §2.2). This is what makes the whole design survivable on iOS.

| Tier | Carries | Built on |
| --- | --- | --- |
| **T1 op-log** | Signed CRDT metadata operations | Existing `local_sync` — **extend**, don't replace |
| **T2 media** | Originals, thumbnail ladder, video byte-ranges | **Open Photo Catalog** disk layout + verifier, made incremental (§5.6) |
| **T3 compute** | Job submit / poll / cancel / result | Existing `photo_indexing_jobs` durable queue |
| **T4 changefeed** | Cursor-paged deltas | **Must be built** — see below |

⚠️ **T4 correction.** An earlier draft claimed the change feed was "~90% built." **It is ~35%.** The 9 SQLite triggers write only to `photo_sync_dirty` — a *coalescing dirty-set*, not a log. `photo_sync_operations` has a single writer that is **gated on SQLCipher**, so the op-log is **empty on any unencrypted workspace**. And `photo_asset_events` **hard-rejects any event type outside `{viewed, shared}`** — it carries zero create/update/delete events. **The feed is a build, not an exposure.** The right substrate is a stream of `photo_sync_operations` rows, with the op-log made to populate unconditionally.

### 5.2 Reuse verbatim from `local_sync`

Ed25519/X25519 device identity · the QR invitation URI · the AES-GCM envelope with kind/sender/receiver/requestId as AAD · the operation signing payload · the hybrid logical clock · the `(hlc, hlc, device, seq, opId)` rank · the MAX(seq) vector clock · the `photo_sync_*` table shapes · the 7 SQLite change-capture triggers.

**⚠️ The #1 porting risk is canonical JSON.** `_canonical_json` is `json.dumps(sort_keys=True, separators=(",",":"), ensure_ascii=True, allow_nan=False)` (`local_sync.py:90-97`). JavaScript's `JSON.stringify` **does not sort keys and does not escape non-ASCII**. A hand-written canonicalizer with a conformance test against `tests/local_sync_units.py` is **mandatory** — otherwise every signature the phone produces is rejected at `local_sync.py:674-679`.

### 5.3 What must change in the protocol

| Change | Why |
| --- | --- |
| Entity key → `asset_uid` | §4 |
| Lift `entityType == "asset"` gate (`local_sync.py:626`) | Add `album`, `albumItem`, `person`, `personLink`, `editStack`, `memory` |
| **Keywords → an add/remove CRDT set**, not whole-value LWW | Today concurrent tagging **silently destroys one device's entire keyword list** (`local_sync.py:212-228`). Apple Photos does not lose data. Shipping this is a competitive liability, not a bug |
| Op-log **compaction + snapshot** | 50k assets ≈ 500–650k ops ≈ **250–400 MB** of never-compacted log |
| **Byte-budgeted paging**; resume instead of raise | Today `sync_peer` **throws** after 20 rounds / 10k ops (`local_sync.py:1550-1551`) — i.e. the initial sync of a real library ends in an exception |
| Relax `_private_ip` (`local_sync.py:232-240`) | Blocks IPv6 and every off-LAN path. Enforced at pairing, invitation-parse, *and* every request |
| **Add TLS** | There is none today — plain HTTP on `0.0.0.0` |
| **Add forward secrecy** | Static-static X25519 → one immutable session key per pairing, forever |
| Persist invitations | In-process memory only; a backend restart invalidates every pending pairing |

### 5.4 Wire protocol

**mutual-TLS 1.3 over HTTP/2 on plain TCP.** Cert pinned via the QR pairing (the Syncthing model: `deviceID = SHA-256(cert)`, confirmed out-of-band).

- **Op-log** over a WebSocket on the same H2 connection. **Blobs** over plain HTTP range requests.
- **Discovery:** Bonjour `_vintrace-sync._tcp` **raced in parallel with a cached last-known-IP** (the Plex architecture — so discovery still works when Local Network permission is denied; graceful degradation for free).
- **Remote fallback:** an **E2E-encrypted, SNI-routed TCP relay** (the Nabu Casa model) that sees only ciphertext.

**Explicitly rejected, with reasons:**

| Rejected | Why |
| --- | --- |
| QUIC / HTTP-3 | Measurably *slower* than TCP on LAN-speed links |
| gRPC | No official React Native support |
| WebRTC data channels | ~1.5 MB/s observed — unusable for 100k photos |
| Cloudflare Tunnel | **Decrypts at the edge — fatal for an E2E photo product** |
| Wi-Fi Aware | iOS/macOS only — the Electron app cannot be a peer |
| `NSAllowsArbitraryLoads` | The classic trap. **Unnecessary** — see below |

**On TLS to a local device — the officially blessed answer:** Apple's *TLS For Accessory Developers* sanctions **TOFU + side-channel confirmation (a QR code)** — exactly our pairing flow. And critically: **"ATS doesn't apply to calls your app makes to lower-level networking interfaces like the Network framework."** A `URLSessionDelegate` doing custom trust evaluation also works without an ATS exception. **You never need an App-Review-justified ATS exception. Do not ship one.**

You **cannot** get a public CA certificate for `192.168.x.x` — settled since the CA/Browser Forum banned it in 2015/2016. Do not go looking.

### 5.5 The local-network permission trap — it is bilateral

- **iOS 14+:** requires `NSLocalNetworkUsageDescription` + an `NSBonjourServices` allowlist, or discovery **silently returns nothing**. There is **no API to check or request** the permission (Apple FB8711182, still open). Worse: **if the app is in the background with permission undetermined, iOS silently denies and shows no alert and records no error.** Any "sync on launch in background" design will mysteriously fail. Infer state from `NWConnection.currentPath.unsatisfiedReason == .localNetworkDenied`.
- **macOS 15+ / 26 gates it too** — so **the Electron Mac app also needs `NSLocalNetworkUsageDescription`** and will show its own prompt. There are open Apple Forum threads about the prompt not appearing for bundled apps. **Test the Mac side early; budget a sprint.**
- **Android 17** (stable since 2026-06-16) introduces **`ACCESS_LOCAL_NETWORK`**, a runtime permission in the `NEARBY_DEVICES` group. Google, verbatim: *"In Android 16, apps could opt in to local network permissions. Beginning with Android 17, enforcement is mandatory for apps that target Android 17 (API level 37) or higher."* It gates traffic to local network addresses **including plain TCP to the Mac's LAN IP**.

  ⚠️ **CORRECTED — do not overstate this.** An earlier draft said sync "silently breaks unless the permission is requested." That is **false**. Google documents **two** paths: (a) request `ACCESS_LOCAL_NETWORK`, or (b) **adopt system-mediated, privacy-preserving device pickers, which skip the permission prompt entirely.** Path (b) is likely the better UX for a pairing flow — evaluate it before defaulting to a scary runtime permission.

### 5.6 T2 — the media tier, built on Open Photo Catalog

**Verdict: build on the format's *disk layout and verifier*, not on its *control flow*.**

`photo_catalog_portability.py` (2,082 lines) implements `org.vintrace.open-photo-catalog` v1. It is confirmed to be **the only media-bytes transport in the backend**.

**Directly reusable:** the content-addressed store (`media/originals/<ab>/<sha256><ext>`), the NDJSON record encoding, the path-free `$ref` scheme, and the traversal/symlink verifier. The addressing is *already correct* — the phone can `GET /catalog/<id>/media/originals/<ab>/<sha>.jpg` with Range + resume and verify the SHA locally. **Only the transport is missing.**

**Unusable as written, and why:** it is whole-library-only (every SELECT is an unfiltered full-table scan — no `WHERE`, no `since` watermark); all-or-nothing (one atomic directory rename, no chunk/resume); **purely additive with zero delete/tombstone semantics**; imports blindly clobber local rows ("package always wins" — no LWW/HLC); has **no thumbnail/proxy tier** (`mediaPolicy` is only `full` or `catalog-only`); is filesystem-`Path`-bound with no stream surface; and **mints a fresh random `catalogId` per export**, so idempotency holds only for re-importing the *same package directory*.

**The ten changes, with exact functions:**

| # | Change | Where |
| --- | --- | --- |
| 1 | **Bump the version.** `_load_manifest` hard-rejects `formatVersion != 1`; `REQUIRED_SINGLETON_KINDS` demands exactly one of each member; `_entry_for_kind` raises unless `len(matches) == 1`. A chunked stream violates all three | `:21, :31, :1043-1049, :1139-1144, :1178-1194, :1241-1257` |
| 2 | **Scope the export (the delta).** `export_catalog` gains `asset_ids`, `since_hlc`/`since_seq`, `max_chunk_bytes`. The three unfiltered scans in `_export_assets_and_sidecars` need a WHERE/temp-table join. `_export_entities`' `SELECT *` needs an asset-id filter plus an `updated_at` watermark for the 8 asset-less tables | `:911, :626, :638/645/685, :821, :846` |
| 3 | **Relax the closed-world validator.** It currently requires *every* reference to resolve inside the package. A delta chunk legitimately references assets the receiver already has. Add a `baseCatalogId` + `assumesPresent` mode that checks against the local DB | `:1407-1463` |
| 4 | **Add tombstones.** There is **no delete anywhere in the file.** Without this, **a phone deletion can never reach the desktop** | `:32, :379, :1567, :1859` |
| 5 | **Replace "package wins" with LWW.** `_import_asset_metadata` and `_upsert_portable_record` blindly overwrite. Both must compare an HLC first | `:1710-1721, :1842-1854` |
| 6 | **Add a proxy/thumbnail tier.** Nothing derived travels today. Add `mediaPolicy: "proxy"` + a `thumbnail` member kind writing `media/thumbs/<ab>/<sha256>.jpg` | `:32, :369, :379, :719-741, :1331` |
| 7 | **Pin a stable `catalogId`.** Line `:936` mints `catalog_{uuid4().hex}` per export — so the `(provider, library_id, external_id)` mapping **resets on every sync and every asset is re-created** | `:936, :1494-1533` |
| 8 | **Chunk the transaction.** `import_catalog` holds the **single global DB connection for the entire run**, blocking every other backend DB operation, and rolls everything back on any failure | `:1974` → `workspace_db.py:301` |
| 9 | **Give it a stream surface.** `_copy_member`, `_atomic_copy_verified`, `_assert_regular_member`, `_iter_ndjson` are all `Path`-typed. Refactor to an opener/reader protocol so members can arrive over HTTP | `:326, :429, :537, :1209` |
| 10 | **Cut the I/O cost.** A round trip is **~4–5 full SHA-256 passes over every byte.** The exporter ignores the already-stored `content_hash` entirely. Trust it when the file signature (size+mtime) is unchanged | `:429, :694-698, :1626, :1959` |

**Two findings that change the design:**

> **The catalog format deliberately excludes the CRDT tables**, with a comment (`:54-56`) calling op-log rows *"unsafe to replay on another machine."* **That judgment was made for an untrusted-package threat model and does not apply to a paired, key-exchanged phone.**
>
> **Recommendation:** make the *delta* stream a stream of `photo_sync_operations` rows, and keep `.vintracecatalog` for the **initial full seed only**.

> ⚠️ **A catalog import is currently invisible to the sync tier.** `import_catalog` sets `meta['photoSyncApplying'] = '1'` (`:1977`), which **suppresses the CRDT dirty triggers.**

**Binding size constraint:** the **8 MiB manifest cap** (`:24`) inlines one ~150-byte JSON object per media file — **so ~50k media files fills it.** Chunking is not optional at library scale.

**Privacy surprise worth knowing:** a `catalog-only` export **still ships media bytes** (Live-Photo `.mov` halves, depth maps, RAW companions) whenever `includeSidecars` is true.

---

## 6. Storage — the phone replica

### 6.1 Byte budget (measured, not estimated)

| Component | Per asset | @100k |
| --- | --- | --- |
| Human catalog (the 34 portability tables) | 2,791 B | **~280 MB** |
| Semantic embeddings (int8) | ~768 B | ~51 MB |
| ThumbHash placeholders | 25 B | ~2.5 MB |
| **Durable total** | | **~150–350 MB** |
| 256px WebP thumbnail LRU (capped) | | 0.5–1.5 GB |

**`photo_catalog_portability.py:57-92` already enumerates the exact 34 tables + 6 meta keys.** That allowlist *is* the replica specification — it was written for export portability and it happens to be precisely right for a mobile replica.

⭐ **The legally decisive detail, and it is very good news:** **`photo_asset_people` is in the portable allowlist** (person name, status, score, band) — while **`embedding_cache` and every face template are not.**

> **The phone can therefore render a complete People UI — names, faces-per-person, confidence bands — while carrying ZERO biometric templates.** Face vectors never touch the device. That is not merely a storage optimization: it is what keeps the phone-side replica *outside* the definition of biometric data under BIPA/GDPR Art. 9, and it materially strengthens the *Barnett* posture in §2.3. **Preserve this boundary; do not "optimize" by syncing embeddings for a faster People tab.**

**Never replicate:** `photo_semantic_embeddings` as JSON text (1.65 GB @100k), `embedding_cache` (1.24 GB), `references.json`/`reference-vectors.npz`, `review_candidates`, calibration labels, training examples, safety cache. **That is >90% of DB bytes and 100% of the biometric/legal risk.**

(The semantic vectors in §3.1 are a deliberate exception — a SigLIP *scene* embedding is not a biometric template. Face embeddings remain desktop-only, permanently.)

### 6.2 Stack

**op-sqlite** (JSI) compiled with `sqlcipher: true`, `fts5: true`, `sqliteVec: true`. WAL mode. **Three separate DB files** so keys and backup/purge policy can differ per file:

- `meta.db` — the catalog replica
- `vec.db` — embeddings as **raw int8/float32 BLOBs**
- `sensitive.db` — biometric/safety-flagged partition, **separately keyed**

Keys: iOS Keychain (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), Android Keystore (hardware-backed, StrongBox where available). A **second, biometric-gated key** protects only `sensitive.db`.

### 6.3 Five traps that will cost weeks

1. **Serializing embeddings as JSON/text.** Ente measured 100k CLIP-512 embeddings in SQLite at **~1 GB and ~19 s to read** — the culprit was serialization, not SQLite. **Raw BLOBs only.** (Note the desktop makes this exact mistake today — audit §4.2.)
2. **Doing KNN in JavaScript.** 100k × 512 float32 = 205 MB; you cannot pull that across JSI per query. **KNN runs inside SQLite (`sqlite-vec`) or in a native module.**
3. **`NSFileProtectionComplete` + WAL.** The `-wal`/`-shm` files become unreadable when the device is locked, and the background sync task dies with `SQLITE_IOERR`. Use iOS's *default* class and get confidentiality from **SQLCipher** instead (which also gives Android parity).
4. **Putting the DB in `Library/Caches`.** iOS deletes that directory under storage pressure. DB → `Library/Application Support` + `isExcludedFromBackupKey`; thumbnails → `Library/Caches`. Apple warns the exclude-from-backup flag **is reset to false by some common file operations** — re-apply it, including to `-wal`/`-shm`.
5. **Biometric-gating the main DB key.** A `BIOMETRY_CURRENT_SET` ACL means the key is **unavailable in the background** — background sync silently stops. **Split the keys** (§6.2).

### 6.4 Search

`sqlite-vec` on stable (v0.1.9) is **brute-force only — which is fine at 100k**: <75 ms for 100k×768 float, 11 ms for bit-vectors; Ente reports <500 ms brute force over 100k on midrange mobile. Use a **two-stage binary-quantize → rescore** pipeline for sub-30 ms search.

⚠️ Every published `sqlite-vec` benchmark is **desktop** (M1 mini). Treat all of them as upper bounds until measured on a Pixel 6a / iPhone SE.

---

## 7. The native-module budget

React Native cannot do these in JavaScript. ~15–20 native surfaces; **6 are unavoidable and load-bearing.**

| # | Module | Effort | Notes |
| --- | --- | --- | --- |
| 1 | **PhotoKit ingest** (iOS) / MediaStore (Android) | **L** | The single biggest item. No library solves it at 100k scale |
| 2 | **`PHCachingImageManager` windowed prefetch** | **M** | **No RN library exposes this** — it is the exact mechanism that makes Apple's grid feel instant |
| 3 | **ML inference** (ONNX/Core ML, pixel buffer stays native) | **M–L** | Never cross the JS bridge with image data |
| 4 | **`BGContinuedProcessingTask`** (iOS 26+) | **M** | See §8 — no RN/Expo binding exists |
| 5 | **Bonjour / NWBrowser** + permission handling | **M** | `react-native-zeroconf` is unmaintained (≈1 commit/year, no New Arch, no Android 17 handling) |
| 6 | **Background `URLSession`** | **M** | See §8 — this is *the* architectural lesson |
| 7 | Widgets (WidgetKit) | M | **SwiftUI-only, confirmed.** Use Expo SDK 57's first-party `expo-widgets` |
| 8 | App Intents | M | **Mandatory now** — see below |
| 9 | Handoff to the Mac app | S | Works — see below |
| 10 | Live Photo read/write, RAW/DNG decode, depth extraction | M | PhotoKit exposes none of this to RN |

**⚠️ App Intents is no longer optional.** At **WWDC 2026 Apple deprecated SiriKit and made App Intents the sole path for Siri into third-party apps.** Apps that don't migrate are **invisible** to the new Siri shipping in iOS 27. `react-native-siri-shortcut` (NSUserActivity/SiriKit-era) is a **dead end — do not adopt it.**

**✅ Handoff to the Electron Mac app genuinely works.** Electron ships the full `NSUserActivity` surface (`app.setUserActivity`, `continue-activity`, etc.). The constraint is not "Electron can't" — it is that **the Electron app must be signed with the same Apple Developer Team ID as the iOS app** and declare matching `NSUserActivityTypes`. Prototype it before promising it; design Bonjour + Universal Links as the primary pairing path with Handoff as a nicety.

**⚠️ Do not run ML in an app extension.** Extension memory ceilings are brutal (Share extension ~120 MB). A CLIP or face model there **will be jetsam'd**. The Share extension should do exactly one thing: copy the incoming asset into the App Group container, write a row, and let the main app do the work.

---

## 8. Background execution — what we can honestly promise

**iOS and Android are not symmetric, and the asymmetry is the single most important fact for the sync design.**

- **Android CAN wake the app when a new photo lands** — `WorkManager.addContentUriTrigger()` on `MediaStore.Images.Media.EXTERNAL_CONTENT_URI` launches the app **from a stopped state**.
- **iOS CANNOT.** There is no photo-library background mode. `PHPhotoLibraryChangeObserver` fires **only while the app is running.** Apple DTS states this flatly.

### 8.1 The architectural lesson, pre-paid by Immich

> **Do not do uploads inside the BGTask window.** Use a **background `URLSession`**, which transfers **out-of-process**, survives app suspension *and* system termination, and relaunches the app via `handleEventsForBackgroundURLSession`. The BGTask is only the *scheduler* that enqueues transfers; the transfer outlives it.

Immich ran uploads inside a Flutter engine in the BGTask window and shipped **four years** of "background backup doesn't work" issues. Their `main` branch now swizzles the background `URLSession` — i.e. they migrated to exactly this. Read it as a lesson already paid for.

**Traps:**
- For any transfer *initiated while backgrounded*, **iOS forces `isDiscretionary = true`** regardless of what you set. The system decides when it runs. **Plan for "eventually," not "promptly."**
- **Force-quit is absolute on iOS.** Swipe the app away and BGTasks stop firing and silent pushes are not delivered until manual relaunch. Apple DTS: *"respect that choice and not find ways around it."* Do not fight this.
- Uploads must be **file-based** (not from `Data`).

### 8.2 The best tool we have: `BGContinuedProcessingTask` (iOS 26+)

Starts in the **foreground from an explicit user action**, then **continues after the user backgrounds the app.** Shows a system Live Activity with a cancel button. Crucially it can use the **GPU in the background** (entitlement `com.apple.developer.background-tasks.continued-processing.gpu`) plus Core ML, Vision, and Accelerate — **which is precisely the face-recognition / embedding / safety workload.**

There is **no documented wall-clock limit**; instead the system terminates tasks *"that reflect minimal or no progress."* **Accurate `progress.completedUnitCount` reporting is literally the survival mechanism.**

⚠️ **No RN or Expo binding exists.** Write the Swift module.

### 8.3 Android's regime tightened, and most guides are stale

- **Android 15+:** `dataSync` and `mediaProcessing` foreground services are capped at **6 hours per 24** — but the timer only accrues **while backgrounded and resets when the user foregrounds the app.**
- **Android 16+:** job quotas are enforced **even while a foreground service runs** — the old "run an FGS and you're exempt" trick is dead.
- **App Standby buckets:** in **Rare** and **Restricted**, **network access for jobs is disabled outright.** *This is the mechanism behind "Immich never backs up but Google Photos is instant."*
- Google's own recommendation is to migrate off `dataSync` to **User-Initiated Data Transfer (UIDT) jobs** — exempt from bucket quotas, but schedulable only while the app is visible, and **there is no WorkManager wrapper** (hand-roll a `JobService`, gated on API ≥34).
- **OEM killers remain unsolved in 2026.** An Immich issue filed 2026-07-12 documents a device that was verified on the Doze whitelist *and* in the `EXEMPTED` standby bucket — and background backup still never ran. Doing everything right at the AOSP layer is **not sufficient**. Ship an in-app "fix my phone" flow and link `dontkillmyapp.com`.

### 8.4 The honest promise (put this in the UI, not just the docs)

- **iOS:** *"New photos back up within minutes-to-hours when your phone is on Wi-Fi and charging, and immediately whenever you open the app. Videos and the initial import need the app open."* **Do not promise timeliness. Do not promise anything after a force-quit.**
- **Android:** *"New photos start uploading within minutes of being taken"* — honestly promisable on AOSP/Pixel, **with an OEM caveat.**
- **On-device ML over 100k photos is a foreground job with a background continuation on both platforms.** Neither will grind through 100k photos unattended overnight. **Design for resumable, chunked, checkpointed progress — and tell the user the truth.**

---

## 9. The client stack

### 9.0 Pinned versions and hard platform deadlines

**Verified 2026-07-14 against npm dist-tags and primary docs. Two prior agents disagreed on the SDK; this is the resolution.**

| Thing | Value |
| --- | --- |
| React Native stable | **0.86.0** (npm `latest`; published 2026-06-09, blog 2026-06-11). `0.87.0-rc.0` is `next` |
| Expo SDK | **57** (bundles RN 0.86 + React 19.2); `expo@57.0.4` pins `expo-media-library ~57.0.1` |
| `accessPrivileges` on the new `PermissionResponse` | **expo-media-library 57.0.0** (2026-06-25). Backported to **56.0.8** — *not* 56.0.9. **No 55.x backport exists at all** |
| New Architecture | Mandatory. The legacy bridge was **permanently removed** in 0.82/0.84 |

**Hard deadlines — these are not advisory:**

- **Xcode 26 / iOS 26 SDK is already mandatory** for App Store Connect uploads (since ~2026-04-28).
- **Google requires target API 36 (Android 16) by 2026-08-31** for all new submissions and updates.
- ⚠️ **NEW, and nobody had flagged it: the UIScene lifecycle becomes mandatory on the iOS 27 SDK.** Apple's iOS 27 Beta 3 release notes, verbatim: *"Apps built with the latest SDK must adopt the scene-based life cycle or they fail to launch."* (TN3187; scope covers iOS/iPadOS/Mac Catalyst/tvOS/visionOS 27.) **Apps that don't migrate will not launch.** This lands when iOS 27 ships (~Sept 2026) — i.e. inside this project's likely build window.

**Liquid Glass.** Rebuilding against the (mandatory) iOS 26 SDK applies Liquid Glass to native controls **by default**. Given this project's deliberately bold, maximalist design direction, decide early whether to opt out wholesale.

- `@callstack/liquid-glass` v0.8.0 (MIT, 1,564★, actively maintained) exports exactly `LiquidGlassView`, `LiquidGlassContainerView`, `isLiquidGlassSupported`. Effect modes are **three**: `clear` | `regular` | `none`. Requires **Xcode ≥ 26, RN ≥ 0.80**, and is **not supported in Expo Go**.
- ⚠️ **Trap:** `expo-glass-effect` does **not** export `isLiquidGlassAPI()` — that name is fabricated. It exports `isLiquidGlassAvailable`.

### 9.1 Stack

| Layer | Choice | Note |
| --- | --- | --- |
| Framework | **Expo (CNG + config plugins + dev-client + EAS)** — *not* bare RN | "Many native modules" is no longer an argument for bare: config plugins inject arbitrary native code, and inline native modules let you write Swift/Kotlin in-project. Bare RN in 2026 = hand-maintaining Xcode/Gradle for zero benefit |
| Grid | **FlashList v2** | New-Arch-only; recycles a fixed window regardless of dataset size |
| Images | **expo-image** with `recyclingKey` | It is the only one that resolves `ph://` URIs (`PhotoLibraryAssetLoader`) |
| Gestures/animation | Reanimated 4 + gesture-handler | Photos-grade pinch + shared-element zoom |
| Editing UI | Skia | |
| Camera | VisionCamera | |
| DB | op-sqlite | §6.2 |
| Native bridges | **Nitro Modules** | Zero-copy `ArrayBuffer` — how pixels reach ONNX without base64 |

### 9.2 The grid: what actually kills you

**The list virtualizer is not the bottleneck, and no amount of FlashList tuning will save a bad pipeline.** Three sourced facts:

1. **Image memory is where you die.** Software Mansion's open-source RN Photos clone found that loading 200 **full-resolution** images into a 5-column grid made `expo-image` spike to **1.53 GB and crash above 60 images**. Once they generated downscaled mipmaps, all three list libraries performed similarly with drastically lower memory. **Never hand a full-res `PHAsset` URI to a grid cell.**
2. **Getting 100k asset descriptors out of the OS is the real wall.** `expo-media-library` has a documented history of freezing the UI and OOM-ing on large libraries. The mitigation exists: the **new object-oriented `Query` API with `.exeForMetadata()`**, which reads metadata *"cheaply from the media store without decoding files."* Legacy `getAssetsAsync()` is deprecated. **Use the new API for indexing.**
3. **Nobody has done this before in RN.** No publicly documented React Native app manages a 100k-asset *local* photo library. Instagram, Bluesky, Discord, and Shopify render **remote feeds**. Apple and Google Photos are native; **Immich and Ente are Flutter.** **You would be first — budget accordingly.**

### 9.3 The offline-first grid trick

Store a **25-byte ThumbHash for every asset** in the replica (2.5 MB at 100k). The grid is then **never blank offline**, even before a single thumbnail syncs. Real 256px WebP thumbnails stream in lazily under an LRU cap, **generated on the desktop** (which already has the decoders and the CPU) and synced as bytes.

---

## 10. Desktop-side changes required

The mobile app cannot ship until these land. Each is specified in the backlog.

| # | Change | Blocks | Audit ref |
| --- | --- | --- | --- |
| **B1** | Stable `asset_uid` + resolvable axes; expose `assetUid`/`contentHash`/`externalIds` in `_public_asset` | Everything | §9.1 |
| **B2** | Content-hash-keyed **proxy ladder** (thumb/screen/full) + asset-addressable thumbnail store | Any Photos-grade viewer | §9.2 |
| **B3** | **Fix Safe Mode cache staleness** — re-read config, not the cached singleton | *Security.* Tightening Safe Mode currently does not reach the phone | §9.3 |
| **B4** | Move **workspace-lock + Touch ID** enforcement into the backend | *Privacy.* A paired phone bypasses both today | §7 |
| **B5** | **Telemetry off by default**; audit `_SAFE_ATTRIBUTE_KEYS` for biometric leakage | *Legal.* Destroys the *Barnett* defense | §9.5 |
| **B6** | **Blob-ingest RPC** — `embed_face_blobs(images) -> {vectors, model_name, quality}` | Compute offload | §6.1 |
| **B7** | **Job-queue offload API** — submit/poll/cancel over HTTP, with deferral reasons surfaced | Compute offload | §6.3 |
| **B8** | **Change feed** — expose `photo_asset_events` as a cursor-paged delta feed | Incremental sync | §9.7 |
| **B9** | **Media tier** — incremental/chunked Open Photo Catalog, byte-range video | Camera roll, video | §9.6 |
| **B10** | **Serial command loop** → durable submit-and-poll jobs | Offload at usable latency | §10 |
| **B11** | **LAN bind** — pass `--allow-remote-http`; relax the HTTPS-origin requirement for pinned-cert private IPs | Any LAN connection | §3.5 |
| **B12** | Connection pooling + fail-fast `busy_timeout` on the HTTP path | 8 hung requests wedge the surface | §9.4 |
| **B13** | Schema: real **faces table with bboxes**, **stable person ids**, **clusters as rows** | People UI, people sync | §4.1 |
| **B14** | Keywords → **add/remove CRDT set** | Silent data loss today | §5.3 |
| **B15** | `NSLocalNetworkUsageDescription` on the **Electron app** | Mac side of the permission gate | §5.5 |

**⚠️ Every new backend command must be added to BOTH allowlists** (`desktop/preload.cjs` and `desktop/main.cjs`) or `tests/command_contract.py` fails.

---

## 11. Model delivery

~235 MB of models is the realistic phone-side budget (Ente ships exactly this: face detect 29.3 MB + MobileFaceNet 5 MB + CLIP image 136.4 MB + CLIP text quantized 64 MB).

**Our shape is smaller**, because the face embedder never ships (§2.2) and the **SigLIP2 vision tower never ships** (§3.1) — only the **text encoder** does.

**Quantization rule, verified against ORT's Core ML op-builder source:**
> **INT8 is an active trap on iOS.** There is no `ConvInteger`, no `DynamicQuantizeLinear`, no `QuantizeLinear`/`DequantizeLinear` builder. ORT silently falls back to CPU on unsupported nodes, so an INT8 model **fragments the graph and loses the ANE entirely — often slower than FP32.** The ANE is FP16-native. **Use FP16 on iOS; reserve INT8 for Android/XNNPACK.**

**⚠️ `onnxruntime-react-native` has shipped nothing since 2026-03-05** while ORT core moved three minor versions on a monthly cadence. It is *not* in lockstep. Evaluate `react-native-executorch` (Software Mansion, actively maintained, ships CLIP first-class) and treat the ORT RN package as a risk requiring a compatibility test.

**Delivery mechanism** (see the backlog for the decision): app-size limits make a fat binary Wi-Fi-only to install. **Apple's Background Assets / Apple-hosted asset packs (iOS 26+)** are strictly better than self-hosting — Apple hosts them free, packs upload separately from the build, and `essential` packs can land before first launch. **No RN binding exists** — a small Nitro module.

---

## 12. What we deliberately will not do

| Not doing | Why |
| --- | --- |
| Run face recognition on the phone | Licensing (§2.2). Not a technical choice |
| Ship MobileCLIP | `apple-amlr` — research-only, no commercial use. Ente ships it anyway; **we will not** |
| Ship NudeNet | AGPL-3.0 — fatal for a closed-source app |
| A cloud relay that can read plaintext | Destroys the *Barnett* defense **and** inherits §2258A NCMEC duties |
| Train on user photos | Guideline 5.1.2(vi) |
| Face-unlock with our own model | DPLA §3.3.3(K), Guideline 2.5.13 |
| Match faces outside the user's own library | Guideline 5.1.1(viii) — and it is the line between a photo app and a surveillance tool |
| Ship the Electron app via the Mac App Store | Sandbox + Python + Guideline 2.5.2 = a multi-month fight for zero benefit. Developer ID + notarization |
| Promise reliable iOS background sync after force-quit | It does not exist. Say so |

---

## 13. The gap matrix — Apple Photos vs. us

Read against `2026-07-14-apple-photos-mobile-atlas.md`. **Legend:** 🟢 we win · 🟡 parity achievable · 🔴 we are behind · ⚪ deliberately not competing.

### 13.1 Where we win — and why Apple structurally cannot follow

| Capability | Apple Photos | Us | Why Apple can't just copy it |
| --- | --- | --- | --- |
| 🟢 **Correct a face mistake** | **Impossible on iPhone.** The confirm flow was removed ~iOS 17 and never returned; **you cannot draw a face box at all.** If Apple's detector missed a face, that face is unreachable | A real correction loop: confirm, reject, merge, **un-merge**, draw a box | It's a product choice they've held for years. It's the single most-requested capability with no Apple answer |
| 🟢 **Cross-age identity** | **The documented catastrophe.** Users report *"losing entire grandchildren."* Apple's own ML paper clusters on face + **clothing** embeddings with moment-based constraints — tuned for *within-event* robustness, not *across-years* identity. **No published cross-age mechanism** | `crossage_fr` — age-gap-aware thresholds, cross-age trajectory references, calibrated probabilities | Their architecture is aimed at a different problem |
| 🟢 **A visible decision layer** | None. No confidence, no threshold, no explanation. It guesses and you live with it | AS-Norm cohort normalization, Platt scaling, an adaptive calibrator, FIQA-gated culling — **all pure NumPy, all portable to the phone** | Apple exposes no decision surface to users *or* developers |
| 🟢 **Own your people graph** | **Walled.** Apple's users **cannot export their own people data.** PhotoKit exposes zero person identities to anyone | Ours is the user's, exportable, and importable **from** Apple's on macOS via `osxphotos` (`ZPERSON`/`ZDETECTEDFACE`) | Their lock-in becomes our onboarding funnel |
| 🟢 **Pets beyond cat and dog** | `RecognizeAnimalsRequest` has **exactly two cases: `.cat` and `.dog`** — which matches Photos' own pet support | Any pet | Uncontested |
| 🟢 **Semantic search offline, no Apple Intelligence gate** | Natural-language search requires Apple Intelligence — device-, OS-, region-, and language-gated | SigLIP2 vectors synced to the phone; text encoder on-device. **Works on a plane, on any device** | Their feature is hardware-gated by design |
| 🟢 **Desktop as a compute node** | Nothing comparable. iCloud is storage, not compute you own | The Mac does the heavy lifting; the phone stays cheap and cool | Apple would have to invent a peer-compute product |

### 13.2 Parity we must earn (and it is most of the work)

| Capability | Apple | Us today | Gap |
| --- | --- | --- | --- |
| 🟡 Instant 100k-photo grid | Effortless, native, thumbnail pyramids + `PHCachingImageManager` | Nothing on mobile | **SP-1.** No RN app has ever done this. The list isn't the bottleneck — the **thumbnail pipeline** is |
| 🟡 Library / Memories / Albums / Search IA | Mature, redesigned twice | Full desktop equivalent exists | Port, don't invent |
| 🟡 Editing | ~15 adjustment sliders, filters, crop/perspective, Markup, Live Photo + video editing, Portrait depth, Photographic Styles | Full non-destructive edit stack **on desktop** | Rebuild on Skia; edit stacks must sync |
| 🟡 Live Photos, ProRAW, depth, spatial, bursts | Native, first-class | In the DB and renderer — **absent from every remote surface** (`analyze_assets` **raises `ValueError` on `depth`/`spatial`/`pairs`**) | E4.6. **No RN library reads any of these** — custom native module |
| 🟡 Video | Full playback, trim, edit | **Zero `Range`/`206` anywhere in the codebase.** Seeking a 4 GB clip has no range path *even on the desktop* | E4.6 |
| 🟡 Background photo backup | Seamless (iCloud is privileged OS code) | None | **We can never match this on iOS.** iOS **cannot wake an app on a new photo.** Be honest (spec §8.4) |
| 🟡 Memories / Memory Movies | Auto-curated, music, moods, AI-generated from a prompt | Desktop has memories/stories | Port; a real opportunity to beat their curation |
| 🟡 Widgets / Lock Screen / Siri | Deep, native | None | **WidgetKit is SwiftUI-only.** App Intents is now **mandatory** — SiriKit was deprecated at WWDC 2026 |
| 🟡 Accessibility | Assistive Access ships a **separate simplified Photos app**; VoiceOver Image Descriptions | Desktop only | A virtualized grid is an a11y hazard. Budget for it |

### 13.3 Where we are behind, and should admit it

| Capability | Reality |
| --- | --- |
| 🔴 **Presence** | Photos is already on the phone, already has the photos, and needs no setup. **This is their biggest advantage and it is not technical.** Our onboarding must be ruthless |
| 🔴 **Background reliability on iOS** | Force-quit is absolute; background-initiated transfers are forced `isDiscretionary`. **We cannot promise timeliness.** Google Photos can't either — but iCloud can, because it is the OS |
| 🔴 **iCloud integration** | We are not in the OS. Assets stored in iCloud but not on device require a network fetch we don't control |
| 🔴 **Recovery from device loss** | Apple has iCloud. **We have no server, and therefore no escrow.** X.2 is unsolved and is a ship-blocker |

### 13.4 Not competing, deliberately

| ⚪ | Why |
| --- | --- |
| Cloud storage / backup-as-a-service | A cloud relay destroys the *Barnett* on-device defense **and** inherits §2258A NCMEC duties |
| Generative editing on-phone | Qwen-Image-Edit needs 48 GiB. Desktop-only, forever |
| Being the default photo app | iOS does not permit it. Don't build a strategy on it |
| Identifying strangers | Guideline 5.1.1(viii) — and it is the line between a photo app and a surveillance tool |

### 13.5 The one-line verdict

> **Apple wins on presence and background privilege. We win on the decision layer, cross-age identity, correction, and ownership.** The entire product bet is that a user who has ever lost a grandchild to Apple's face clustering will trade *seamlessness* for *control* — provided the grid still scrolls at 60fps. **Which is why SP-1 gates everything.**

---

## 14. Open questions — **all resolved**

Every question below has been closed. See `2026-07-14-mobile-spike-results.md` for evidence.

| # | Question | Resolution |
| --- | --- | --- |
| **SP-1** | Can RN hold a 100k-asset grid? | ✅ **MEASURED: 60.0 fps at 267 MB.** But **peak memory, not FPS, is the metric** — the naive full-res pipeline scored *higher* FPS while consuming **3,174 MB** and would be jetsam'd on device |
| **SP-2** | Is `sqlite-vec` fast enough on-device? | ✅ **MEASURED: 26.8 ms** median KNN over 100k `int8[512]` vectors; 4.5 ms for the `bit` coarse pass. Brute force is fine; no ANN index needed |
| **SP-3** | Handoff to the Electron Mac app? | ⛔ **Works, but do not build.** Requires a shared iCloud account — contradicting our no-cloud positioning — and duplicates a transport we already own |
| **SP-4** | `PHBackgroundResourceUploadExtension`? | ⛔ **Cannot use.** The request body is locked to raw asset bytes, so our E2E framing cannot be the transport |
| **SP-5** | Liquid Glass? | 🟡 **Hybrid — ship with it ON.** Opting out is a dead end that hard-expires at the iOS 27 SDK |
| **X.2** | Recovery / device loss | ✅ **Designed.** Two artifacts (Recovery Key **and** a backup destination), and a Workspace Master Key above the DB key |

# Mobile Integration Audit — Current State

**Date:** 2026-07-14
**Status:** Reference document. Describes what exists today. No changes proposed here — see the companion architecture and backlog documents.
**Method:** 12 read-only codebase-audit agents + 4 targeted deep-dives, every claim carrying `file:line` evidence, plus 3 completeness critics that re-audited the auditors.

## Companion documents

| Document | Purpose |
| --- | --- |
| `2026-07-14-mobile-integration-audit.md` | **This document.** What the desktop exposes today, and what a phone can and cannot reach. |
| `2026-07-14-apple-photos-mobile-atlas.md` | Every Apple Photos feature on iPhone, sourced and adversarially verified. The bar we must clear. |
| `2026-07-14-mobile-architecture-and-spec.md` | Gap matrix, target architecture, protocol/schema/API specification. |
| `2026-07-14-mobile-implementation-backlog.md` | Phased, dependency-ordered, agent-executable work. |

## Evidence standard

Every factual claim below is anchored to `file:line`. Where an earlier draft of this audit was wrong, the correction is stated explicitly and marked **CORRECTED** — several widely-held beliefs about this codebase turned out to be false, and an implementing agent that trusts the folklore instead of the code will waste sprints. Read the corrections.

---

## 1. Executive summary

**The integration level today is: a read-only web window onto a desktop that must be running, reachable over an HTTPS origin the user is expected to provision themselves, and unlocked.**

That single sentence is the honest answer to "how integrated is the mobile story." Everything else is detail.

Underneath that thin surface, however, sit three substantial assets that no one has connected to each other:

1. **A real cryptographic pairing and convergence engine** (`local_sync.py`, 1,924 lines) — Ed25519/X25519, QR pairing, a signed operation log with a hybrid logical clock, conflict resolution, mDNS discovery. It is production-grade and it is *dormant by default*.
2. **A hash-addressed media transport with a 34-table catalog allowlist** (`photo_catalog_portability.py`) — the only code in the repository that moves photo *bytes* portably. No prior audit connected it to the mobile problem.
3. **A decision layer that is pure NumPy with zero model weights** (`crossage_fr/match/`) — AS-Norm, Platt scaling, an adaptive calibrator, age-gap widening. This is the product's actual competitive edge and it ports to a phone trivially.

The mobile app is not blocked by missing capability. It is blocked by **four specific defects and three missing tiers**, all enumerated in §9 and §10.

### Integration scorecard

| Capability | Status | Detail |
| --- | --- | --- |
| Browse library remotely | ✅ Works | 7 read-only HTTP routes, cookie-paired |
| Search (lexical/hybrid/semantic) | ✅ Works | `POST /v1/search` |
| View previews | ⚠️ Degraded | Hard-capped at **768px** — see §9.2 |
| Pair a device securely | ✅ Excellent | Two independent, best-in-class mechanisms |
| Zero-config LAN discovery | ⚠️ Built, unused | mDNS exists; peer list computed, never rendered |
| Work offline | ❌ None | Explicitly designed out; no service worker, `no-store` on every response |
| Write anything from the phone | ❌ None | Read-only enforced at three independent layers |
| Ingest camera-roll photos | ❌ None | No command in 369 accepts image bytes |
| Offload compute to the desktop | ❌ Blocked | The backend command loop is **serial and single-threaded** |
| Sync people, albums, edit stacks | ❌ None | Sync covers **13 fields of one entity type** |
| Sync media bytes | ❌ None | Asserted `mediaTransfer: false` as a published privacy guarantee |
| Off-LAN / cellular sync | ❌ None | Private IPv4 only, enforced in three places |
| Video off-desktop | ❌ None | Zero `Range`/`206` support anywhere in the codebase |

---

## 2. The two channels, and why they do not interoperate

The single most important structural fact about this codebase: **there are two entirely separate mobile-adjacent channels, and they share no identity, no pairing, and no transport.**

### 2.1 Mobile Companion — a read-only web shell

- **Code:** `crossage_fr/mobile_companion.py` (302 lines), `mobile/src/main.tsx` (~690 lines), `desktop/main/mobile-companion.cjs` (309 lines), route firewall in `crossage_fr/mcp_server.py`.
- **Pairing:** QR code whose **URL fragment** carries 256 bits of one-use entropy, 10-minute TTL. The shell strips the fragment from history before exchanging it. Disk holds only the pairing secret's SHA-256; a successful exchange **deletes that hash** and mints a separate session token, storing only *its* SHA-256.
- **Session:** returned exclusively in a `__Host-vintrace_mobile` cookie — `Secure`, `HttpOnly`, `SameSite=Strict`, `/` scope. JavaScript cannot read it. No bearer token touches local or session storage.
- **Authorization:** every mobile principal is permanently `readOnly: true` (`desktop/main/mobile-companion.cjs:235`). Scopes are capped to `{images:read, images:preview}` (`crossage_fr/mobile_companion.py:38`).
- **Route firewall:** deny-by-default. Exactly **7 reachable routes**: `/v1/mobile/session`, `/v1/capabilities`, `/v1/library`, `/v1/search`, `/v1/assets/fetch`, `/v1/assets/analyze`, `/v1/assets/{id}[/preview]`. Everything else — writes, `/mcp`, connectors, recipes, operations, jobs, SSE — returns `403 mobile_read_only` (`crossage_fr/mcp_server.py:4270-4287`).
- **Offline:** deliberately impossible. `docs/mobile-companion.md:12` states it "registers no service worker and stores no private library response." Every private response is `Cache-Control: private, no-store`. The e2e test asserts `localStorage` and `sessionStorage` are empty (`tests/e2e/mobile-companion.spec.ts:93-98`).
- **Camera:** structurally impossible. `Permissions-Policy: camera=()` (`crossage_fr/mobile_companion.py:297`).

The security engineering here is genuinely excellent and well-tested — four suites, including a frozen-binary HTTP suite that gates all three release workflows. **The product surface is a viewer.** Half of what it is permitted to reach, it never calls; the collections it renders are not even clickable (`mobile/src/main.tsx:602-611` renders a plain `div`, no `onClick`).

**The adoption blocker is not security — it is setup.** The companion requires the user to route a trusted **public HTTPS origin** to `127.0.0.1:8765` themselves (`docs/mobile-companion.md`). `normalizeMobilePublicUrl` throws on any non-HTTPS, non-loopback origin (`desktop/main/mobile-companion.cjs:30-35`). For a consumer photo app, this is a non-starter: it asks the user to run a reverse proxy before they can see their photos on their own phone.

### 2.2 Local Sync — a metadata convergence engine

- **Code:** `crossage_fr/local_sync.py` (1,924 lines), protocol `vintrace-local-sync-v1`.
- **Identity:** Ed25519 (signing) + X25519 (exchange). `deviceId = SHA-256("vintrace-sync-device-v1\0" || signing_pubkey)`. Stored in an AES-256-GCM-encrypted `identity.json`, `0700` directory, symlinks rejected (`local_sync.py:305-384`).
- **Pairing:** a one-use 32-byte token, 10-minute default TTL, encoded as `vintrace-sync://pair/<b64>` and rendered as a QR code. Pair key = `HKDF-SHA256(X25519(priv, peer_pub), salt=invitation_token, info="vintrace-sync-pair-v1\0" + sorted(deviceIds))` (`local_sync.py:1092-1107`).
- **Transport:** a `ThreadingHTTPServer` with exactly three routes — `GET /health` (unauthenticated), `POST /pair`, `POST /sync`. Body is AEAD-encrypted; sender, receiver, request id, and message kind are all bound as AAD (`local_sync.py:1109-1111`).
- **Convergence:** a per-field Ed25519-signed operation log, ordered by a hybrid logical clock, resolved by deterministic last-writer-wins ranked on `(hlcPhysicalMs, hlcLogical, originDeviceId, originSeq, operationId)`. Losing writes are preserved in a bounded conflict table. Operation IDs are deterministic and **sequence reuse with different content is detected and rejected** (`local_sync.py:723-739`).
- **Discovery:** Bonjour/mDNS on `_vintrace-sync._tcp.local.` with signed TXT beacons (`local_sync.py:1643-1746`).
- **Change capture:** 7 SQLite triggers feed a dirty queue, with echo-loop suppression via a `meta.photoSyncApplying` guard (`crossage_fr/store/workspace_db.py:1397-1480`).

**The single most important architectural finding in this audit:**

> **The phone can be a pure client.** `sync_peer` (`local_sync.py:1469-1552`) is a *full bidirectional exchange initiated by the caller* — the phone POSTs its operations to the desktop's `/sync` and receives the desktop's operations in the same response. **No inbound listener is required on the phone.** `_private_ip` accepts loopback (`local_sync.py:238`), so the phone can declare `127.0.0.1` as a placeholder endpoint in its signed identity record at pairing time.

This sidesteps the entire class of iOS background-server problems that sink most peer-to-peer mobile designs.

### 2.3 They do not talk to each other

| | Mobile Companion | Local Sync |
| --- | --- | --- |
| Identity | Random token, SHA-256 on disk | Ed25519 keypair, self-certifying |
| Pairing | QR → cookie | QR → X25519/HKDF channel |
| Transport | HTTPS via user-provisioned proxy | Plain HTTP, private IPv4 only |
| Auth | `__Host-` cookie / bearer | AEAD envelope, no bearer |
| Carries | Read-only JSON + 768px JPEGs | Signed metadata operations |
| Discovery | None | mDNS |
| Exposed in MCP tool profile | Yes | **No** (`mcp_server.py:122-145`) |

A device paired via the mobile-companion flow **cannot drive sync**, because `local_sync` is not in the MCP images tool profile. Unifying these is the foundational design decision for the mobile app.

---

## 3. The transport map

### 3.1 `api_server.py` — **CORRECTED**: not an HTTP server

The most commonly held false belief about this codebase, and it invalidates any plan built on it:

> **`crossage_fr/api_server.py` contains zero HTTP code.** No `BaseHTTPRequestHandler`, no FastAPI/Flask/Starlette, no `do_GET`. Grepping for any of them returns nothing.

All 44,117 lines are a **line-delimited JSON-RPC server over stdin/stdout** (`serve()` at `api_server.py:44033-44083`, reading `for line in sys.stdin`, replying via `emit()` at `:43923`).

- **Dispatch:** an O(1) dict registry, `DesktopApi._COMMAND_HANDLERS` (`api_server.py:1041-1411`), mapping **369 command strings** to `_cmd_*` methods. **CORRECTED:** the previously-documented figure of ~245 commands is wrong.
- **Authentication:** **none whatsoever.** `serve()` accepts any well-formed JSON object on stdin and executes it — including `permanently_delete_photos` and `delete_subject_data`. The trust boundary is the Electron→Python process pipe, nothing more.
- **Concurrency:** **none.** The request loop is strictly serial and synchronous. One command at a time, no worker pool, no in-band cancellation. A running scan or index **blocks every other read**. Electron works around this by writing `.scan-cancel` / `.scan-pause` sentinel *files* out-of-band (`desktop/main.cjs:6621-6651`) and running a silence-based watchdog rather than a fixed timeout.
- **Validation:** only 62 of 369 commands declare required parameters (`_COMMAND_REQUIRED_PARAMS`, `api_server.py:932-995`). The rest are duck-typed.
- **Response envelope:** inconsistent — 278 handlers return `{"value": ...}`, ~24 return state, 67 return bare dicts. Electron papers over it with `unwrapBackendValue` (`desktop/main.cjs:4383-4388`).

**Consequences for mobile, both of them severe:**

1. **A React Native app cannot talk to `api_server.py` at all.** There is no network transport. Any bridge that exposed it would expose all 369 commands *unauthenticated*.
2. **"Offload heavy compute to the desktop" is blocked by the serial loop.** A phone requesting an embedding would queue behind a running library scan with no cancellation and no progress. This is not a latency problem; it is an architectural one. See §10.

### 3.2 `mcp_server.py` — the real HTTP surface

- **32 `@mcp.custom_route` handlers** (29 under `/v1/*`, plus `/mobile`, `/mobile/{path}`, `/.well-known/oauth-protected-resource`), on top of FastMCP's `streamable_http_app()` which also mounts `/mcp`. Served by uvicorn, default `127.0.0.1:8765`.
- **Auth:** `_ScopedAuthMiddleware` (`mcp_server.py:4308-4464`) — one ASGI choke point. Bearer token, falling back to the mobile cookie. Unauthenticated requests get a `401` with an RFC-6750 challenge.
- **Exactly 4 unauthenticated path prefixes:** `/.well-known/oauth-protected-resource*`, `/mobile`, `/mobile/*`, `/v1/mobile/pair`, `/v1/mobile/logout`. **`/v1/mobile/pair` is the only unauthenticated write-ish endpoint** — the onboarding door, protected by the one-use, 10-minute, SHA-256-hashed pairing code.
- **Scopes:** exactly 6, hierarchical. `images:admin` ⊃ everything; `images:destructive` ⊃ `{images:write, images:read}`; `images:write` ⊃ `{images:read}`; `images:preview` ⊃ `{images:read}`; `events:read` standalone (`agent_auth.py:29-69`).
- **Principals:** local operator token (implicit `images:admin`), file-backed service accounts (SHA-256 hashes, `0600`, ≤1000 accounts), and OAuth JWTs.
- **Rate limiting:** a token-bucket `RateLimitMiddleware` (`mcp_server.py:4477-4515`).
- **Concurrency cap:** 8 global (`mcp_server.py:4159-4162`). See §9.3 — this interacts badly with SQLite contention.

`agent_openapi.py` generates an accurate OpenAPI 3.1 document covering all 29 `/v1` paths. **This is the surface a mobile app consumes.**

### 3.3 Electron IPC — 84 channels, ~50 with no backend equivalent

- **84 request/response IPC channels** + 10 main→renderer event channels.
- One channel, `backend:invoke`, funnels **341 backend commands** through a *dual* allowlist that must match in both `desktop/preload.cjs:3-345` and `desktop/main.cjs:520-862` (verified identical: 341/341, zero drift). **28 of the 369 are main-process-only.**
- The other ~50 channels are native capability with **no backend equivalent**: file dialogs, OS keychain (`safeStorage`), Touch ID, shell reveal/open/print/share/drag, clipboard, tray/menu, auto-update, notifications, the `vintrace://` protocol, `fs.watch` folder watching, `powerMonitor`-gated background indexing, and gphoto2 PTP tethering.

**Contract trap for any implementer:** a new backend command must be added to **both** allowlists or `tests/command_contract.py` fails.

### 3.4 `vintrace-media://` — why the phone cannot see pixels

Media bytes **never travel over HTTP** in the desktop app. The renderer only ever receives `vintrace-media://` URLs, served by a custom Electron protocol handler (`desktop/main.cjs:3029-3051`) gated by an in-memory path-trust set and a **workspace-lock 404 check** (`:3038`).

Every `previewPath` / `sourcePath` field the backend returns is an **absolute desktop filesystem path**. To a phone, these are meaningless strings. The only HTTP pixel path in the entire system is `GET /v1/assets/{id}/preview` — and it is capped at 768px (§9.2).

### 3.5 LAN reachability — a small blocker with a large effect

`startMcpHttpServer` hardcodes `host=127.0.0.1` (`desktop/main.cjs:5421-5422` via `desktop/main/mcp-connection.cjs:10`) and never passes `--allow-remote-http`, **which the Python side already supports** (`mcp_server.py:4111`). So a phone on the same Wi-Fi cannot reach the desktop at all today, even though the backend is ready for it.

---

## 4. Data model and replica math

Persistence is a single SQLCipher-encrypted SQLite file per workspace: **62 base tables + 1 FTS5 virtual table, 107 indexes, 19 triggers**, at `SCHEMA_VERSION = 13` (`crossage_fr/store/workspace_db.py:37`).

### 4.1 What the schema does *not* have — and it matters

These are not oversights to note in passing; each one blocks a headline feature:

- **There is no `faces` table.** A "face" is a `review_candidates` row linked to an asset by `photo_asset_people(asset_id, candidate_id)`. **No bounding boxes are stored in any queryable table.** Face geometry exists only inside `embedding_cache.embeddings_json` — keyed by *file hash*, not asset_id. → *A Photos-quality People UI on mobile cannot draw face chips from the database.*
- **There is no `clusters` table.** Unnamed people are the literal string prefix `"Unmatched cluster N"` inside `person_name`, matched with `LIKE`/`GLOB` in at least 8 places. → *Not syncable, not mergeable, not stable across devices.*
- **There is no stable person identity.** `photo_people_profiles.person_name` **is the primary key**. Renaming a person is a cross-table string rewrite. → *Two devices renaming concurrently cannot be reconciled.*
- **There is no per-pet identity.** Pets are label matches against a 7-kind hardcoded term list. Apple Photos does per-pet recognition. → *A straight competitive deficit.*
- **There is no asset_id-addressable thumbnail store.** Previews are content-hash-named JPEGs on disk with no DB row and no size ladder. → *There is no desktop→mobile thumbnail feed to build on.*
- Memories, Stories, slideshows, culling results, and library settings are **single JSON blobs in the `meta` key-value table** — read-modify-write, no per-item concurrency, memories hard-capped at 120. → *Concurrent phone+desktop edits clobber each other.*

### 4.2 Replica math (measured on a real schema instance, not estimated)

| Data | Bytes/asset | @50k | @100k |
| --- | --- | --- | --- |
| **Human catalog** (the 34 portability tables) | 2,791 B | ~140 MB | **~279 MB** |
| Semantic vectors (768-d, JSON text) | 16,473 B | ~824 MB | ~1.65 GB |
| Face embeddings (512-d, JSON text) | 12,385 B | ~619 MB | ~1.24 GB |

**Over 90% of database bytes are vectors the phone must never carry as-is.**

Two notes an implementer needs:

- Vectors are stored as **full-precision JSON text**, not `float32` BLOBs — a **5.4× storage penalty** and a parse cost on every index rebuild. Converting to `float32` BLOB: 768×4 = 3,072 B (down from 16,473 B).
- **`photo_catalog_portability.py:57-101` already enumerates the exact 34 tables + 6 meta keys that constitute durable human catalog data**, with the exclusion rationale stated verbatim in a comment: *"Search indexes, model vectors, job queues, sync transport state, caches, and undo payloads are rebuilt locally or are unsafe to replay."* **That allowlist is the mobile replica specification, already written.**

### 4.3 The camera-roll schema hook already exists

`photo_external_sources(provider, library_id, capabilities_json, consent_json, cursor_json)` + `photo_asset_external_ids(provider, library_id, external_id)` is **exactly** the PHAsset `localIdentifier` mapping a phone needs, and `photo_external_album_links/items` already covers iOS albums.

This matters because `photo_assets.source_path` is **`UNIQUE NOT NULL`** — the schema structurally assumes a filesystem path per asset, which a phone asset does not have. Routing phone assets through the external-ID tables avoids the constraint violation **with zero schema change**.

---

## 5. The ML stack, and the legal wall

100% offline, ONNX Runtime 1.27.0-centric. 13 model artifacts bundled (~700 MB), 8 more downloaded on demand.

### 5.1 The hardest mobile blocker is legal, not technical

> The face-recognition weights (`glintr100` / `w600k_r50`, in the `antelopev2` / `buffalo_l` packs) carry `license_tier="research-or-commercial-license-required"` and `redistributionRisk="needs-license-review"` (`crossage_fr/model_manager.py:72,92,99-131`). **They may not be bundled or redistributed in an App Store or Play Store binary without a commercial InsightFace grant.** They are downloaded to `~/.insightface` at runtime precisely to sidestep this.

Combined with the model-family isolation gate (`enroll/manager.py:524` — embeddings are only comparable within a model family), **a phone cannot legally compute a comparable face embedding by any route.** Running a *different* small face model on the phone silently produces a parallel, useless index.

**Therefore: desktop-as-compute-node for face recognition is mandatory, and the reason is licensing.** This is not an optimization to revisit later. It is a fixed constraint that the entire protocol must be designed around.

A related trap: `FallbackEmbeddingEngine` emits a 512-d **non-face** fingerprint (`embed/engine.py:480,543`) that is *dimensionally identical* to a real InsightFace embedding but semantically unrelated. **A length check will happily accept it.** The sync protocol must carry and validate `model_name`, not just the vector, or the index gets silently poisoned.

### 5.2 The other licensing landmine

The Safe Mode region explainer (NudeNet v3) is **AGPL-3.0** and is deliberately *not bundled* — the user must download the `.onnx` themselves (`src/shell/SafeModeSettingsPanel.tsx:299`: *"NudeNet is AGPL-3.0 — download it yourself… Nothing is bundled or sent anywhere"*). **Mobile must not bundle it either.**

Permissive and safe to ship: SigLIP2 (Apache-2.0), Depth-Anything-V2-Small (Apache-2.0), BiRefNet_lite (MIT), AdamCodd NSFW ViT (Apache-2.0), PP-OCRv6/RapidOCR (Apache-2.0), YAMNet (Apache-2.0), Whisper (MIT). eDifFIQA(T) is CC-BY-4.0 (attribution required).

### 5.3 What can and cannot run on a phone

**Tier A — ports cleanly today:** eDifFIQA(T) (6.9 MB, opset 14, static 112², plain conv ops); Whisper-tiny GGML (30.7 MB, whisper.cpp has iOS/Android builds); YAMNet (14.2 MB — *but* you must reimplement the NumPy mel front-end at `audio_intelligence.py:321-335`, which lives outside the graph); PP-OCR trio (30.4 MB, mobile-designed — though iOS Vision and Android MLKit already do OCR natively and probably better).

**Tier C — must stay on the desktop, hard:**
- **Depth-Anything-V2** is built with ONNX Runtime **contrib ops** (`com.microsoft`: `MatMulNBits`, `MultiHeadAttention`, `SkipLayerNormalization`) and therefore **cannot be converted to Core ML or TFLite by any standard tool**. It needs a fresh export from the PyTorch checkpoint to ever run on a phone.
- **Qwen3-VL-4B** has a 10 GiB RAM floor; **Qwen-Image-Edit** needs 48 GiB. Both are checked before install and categorically exclude phones.
- **Real-ESRGAN** ships as a prebuilt **ncnn-Vulkan desktop executable** — Vulkan does not exist on iOS.
- The category-aware safety guardrail **requires the Qwen3-VL quality tier exactly** (`require_exact_tier=True`, `multimodal_safety.py:279`), so on-phone Safe Mode can only ever get the weaker single-label ViT classifier.

### 5.4 Two findings that reshape the product

**(a) The semantic-search split is elegant and already sitting there.**

`photo_semantic_embeddings` (`workspace_db.py:503`) stores a 768-d vector per `(asset_id, model_name)`. **Sync those vectors to the phone and run only the SigLIP2 *text* encoder on-device — the vision tower never needs to ship.** At fp16 that is ~1.5 KB/photo (~75 MB for 50k); at int8, ~768 B/photo (~38 MB). Semantic search then works fully offline, instantly.

*Corollary:* if you re-export exactly one model for the phone, make it **SigLIP2**. The current export is uint8 dynamic-quantized (`DynamicQuantizeLinear` + `MatMulInteger` + `ConvInteger`), which lowers to **CPU-only kernels** and will never touch the ANE or NNAPI. An fp16, static-shape re-export would run on the ANE — *and would simultaneously fix the desktop's own bottleneck*, because SigLIP is currently **pinned to CPU on Apple Silicon** (`siglip_engine.py:330-334`) as a workaround for Core ML compiler diagnostics corrupting the stdout JSON-lines protocol. **One re-export, two wins.**

**(b) The moat is pure NumPy and ports to the phone in an afternoon.**

`crossage_fr/match/` has **zero model weights**: AS-Norm cohort normalization (`calibration.py:163`, cohorts are 60×512 = 246 KB total), Platt scaling, an `AdaptiveLinearCalibrator` with JSON-serializable parameters (`calibration.py:295-330`), and age-gap widening (`age_gap.py`, pure `datetime`). Port these verbatim to TypeScript and the phone can re-band, re-threshold, and re-rank matches **locally and instantly, with zero model download**.

> Beating Apple Photos will not come from the backbone — Apple runs a good face model on-device too. It comes from the **decision layer** (which Apple does not expose at all) plus **cross-device compute**. Lead with that, and use the desktop purely as the licensed, heavyweight embedding oracle.

---

## 6. Ingestion, jobs, and the camera-roll substrate that already exists

### 6.1 The blob-ingest gap — the #1 unblock, and it is small

**Not one of the 369 commands accepts image bytes.** Every ML entrypoint resolves a filesystem path on the desktop's own disk. `import_photos` takes local paths. **A phone cannot hand a photo to the desktop for compute today.**

But the gap is well-shaped, because the engine layer *beneath* the commands **already takes in-memory PIL images**: `embed_loaded_image`, `encode_image(image=...)`, `assess_image_safety`, `estimate_depth(image=...)`.

> A command like `embed_face_blobs(images: bytes[]) -> {vectors, model_name, quality}` is **a thin adapter over existing code, not a rewrite**. Do this first — it unblocks everything else.

### 6.2 The photo tether is the right substrate for camera-roll ingest

A full lifecycle already exists: `create_photo_tether_session` → `reserve_photo_tether_sequence` → `claim_photo_tether_capture` → `complete_photo_tether_capture` / `fail_photo_tether_capture` (`api_server.py:1163-1170`), orchestrated by `desktop/main/photo-tether-runtime.cjs:349-675`, with **sequence reservation, claim/complete/fail semantics, and crash recovery**.

The tether flow is literally *"an external capture device streams new photos into the library."* That is precisely what a phone is. It is the right substrate, and it is already built and tested — though currently main-process-only.

### 6.3 The job queue is the right offload scheduler

`photo_indexing_jobs` (`workspace_db.py:4734`) is a **durable, retryable** queue accepting 10 job kinds with `scope_json` / `attempts` / `history`. `api_server.py:148-159` already classifies work as light/medium/heavy across exactly the right kinds.

Extend `PHOTO_INDEXING_JOB_COSTS` with an `origin='mobile'` scope and a blob staging area, and the phone gets a durable, cancellable, resumable offload pipeline **for free**.

⚠️ **Note:** face scanning is **not** one of the 10 job kinds — it goes through `scan_runs`/`scan_files` and needs a separate remote-trigger surface.

⚠️ **Note:** export jobs are **not durable** — `self._photo_export_jobs` is an in-memory dict (`api_server.py:693`). A disconnect or restart loses them.

---

## 7. Inherited constraints — non-negotiable

Any mobile app inherits every one of these. They are product invariants, not settings.

### Security
- The workspace SQLite is SQLCipher-encrypted with the key wrapped in the **desktop OS keychain** via Electron `safeStorage` (`desktop/main/workspace-encryption.cjs:240-353`). **A phone can never open the DB file directly.** Offline-first sync must therefore be *operation-level*, not file-level.
- `VINTRACE_REQUIRE_DB_ENCRYPTION=1` is forced (`desktop/main.cjs:3958`). Linux `basic_text` safeStorage is **rejected** — Secret Service or KWallet required.
- Local sync **hard-fails without workspace encryption** — every entry point calls `_require_encryption()` (`local_sync.py:318-322`).
- The renderer is fully sandboxed (`sandbox:true, contextIsolation:true, nodeIntegration:false`). `DYLD_*`/`LD_*` are scrubbed before spawning the backend.
- Agent writes require a **unique idempotency key + explicit confirm**, enforced by a file-backed cross-process ledger (`agent_images.py:713, 1748-1792`). Offline mutation replay must supply stable client-generated keys.

### Privacy
- All error messages and tracebacks are **absolute-path-redacted** before leaving the process (`api_server.py:43970-43986`).
- Agent/mobile responses are path-stripped; search *"returns no pixels or source paths"* by design (`mcp_server.py:1128`). **Mobile must operate on stable assetIds only.**
- `noNetworkIntelligence` defaults to `True` (`api_server.py:15236`); every model manifest asserts `networkAtInference=false`. **Offloading to the user's own paired desktop preserves this. Offloading to any hosted GPU breaks the product's core promise and its compliance posture.**
- Local sync publishes a privacy contract *in the type system*: `internetService: false`, `mediaTransfer: false`, `biometricTransfer: false`, `generatedModelDataTransfer: false` (`src/types.ts:5497-5506`). **Adding a media tier means deliberately changing a published privacy guarantee** — a product decision, not an engineering one.

### Legal / compliance
- Biometric processing is **consent-gated server-side** and fails closed (`_require_consent`, `api_server.py:43889-43895`). Seven biometric commands hard-fail without consent on file.
- The product **explicitly disclaims autonomous identification**: `review_only: bool = True` (`config.py:87`); *"Not for autonomous identification, covert use, or live public-space 1:N"* (`api_server.py:6725`). `MODEL_GOVERNANCE` sets `humanReviewRequired=True` for every face pack and states *"Do not use as sole identity proof."*
- **Any mobile UI must preserve the human-in-the-loop framing and must not present matches as authoritative.**
- Retention machinery exists and applies: `retention_reviewed_days=90`, `retention_pending_days=365`, `delete_subject_data` + destruction receipts. A mobile replica carrying embeddings inherits BIPA / GDPR-Art.9-class obligations.

### Two security gaps that must be closed *before* mobile ships
- **The workspace lock is enforced only in the Electron main process, not in the backend.** A paired mobile device is not subject to it — there is no lock check in the MCP request path.
- **The Touch ID gate for Hidden / Recently Deleted is Electron-only and macOS-only** (`desktop/main.cjs:1049-1109`). No backend enforcement was found, so mobile/MCP clients **bypass it entirely**.

> Both checks must move into the backend, or mobile becomes a privacy hole in a privacy-first product.

---

## 8. The desktop feature surface mobile must mirror

The renderer is **246 files / 104,456 lines**, dominated by two god-components: `src/views/PhotosView.tsx` (24,089 lines) and `src/App.tsx` (17,395 lines).

- **8 primary tabs** (`src/shell/navModel.ts:18-27`): Library, Memories, Albums, Search, AI Agents, People & Pets, Tools, Settings.
- Library / Memories / Albums / People→Browse all render the **same** `PhotosView` component seeded to a different rail section — a component carrying **~230 props** and hosting ~46 sub-panels.
- **~680 distinct interactive elements.** There is **no existing prioritization of which are core** — the mobile brief has no must-have subset defined anywhere in the codebase or docs.

**Nothing of the data layer is portable.** There is no store, no query cache, no repository abstraction — `App.tsx` prop-drills ~230 props into `PhotosView`. Only pure helpers (`src/lib/*`, `src/i18n/*`) survive the trip.

**Genuinely reusable:** the i18n phrase catalogs — 7 locales including **RTL Arabic** with layout mirroring. RN must ship the same locale set and honor RTL (`src/i18n.ts:1-11`).

**A correctness gap the audit surfaced incidentally:** **30 `localStorage` keys hold unsynced user data** — `slideshowProjects`, `exportPresets`, `savedFilters`, `imageEditClipboardHistory`, `railSectionOrder`, `inlineReviewDecisions`, and more. These are real user artifacts living **outside the synced catalog**, so they will silently fail to appear on the phone. This is a defect in the *existing* sync model, not merely a mobile gap.

---

## 9. Defects found — P0

These were found by the completeness critics re-auditing the audit. Each is confirmed with `file:line`. Each blocks a mobile capability.

### 9.1 Asset identity is forked three ways, and none of the three is portable

| Space | Key | Where |
| --- | --- | --- |
| HTTP `/v1` | `sha256(expanduser(absolute source_path))` | `store/workspace_db.py:2642-2643` |
| `local_sync` | `LOWER(content_hash)` | `local_sync.py:538` |
| `photo_sources` | `(provider, libraryId, externalId)` | — |

Exact form: `assetId = "asset_" + sha256(str(Path(path).expanduser()))[:32]` — note `expanduser()` with **no `.resolve()`**.

And `_public_asset()` (`agent_images.py:562-588`) exposes **neither `contentHash` nor any external id** — and also no `updatedAt`, revision, etag, or `deletedAt`.

**Three consequences:**

1. **A phone that browses over HTTP and syncs over the CRDT cannot join the two identity spaces.** They are disjoint.

2. **Asset identity is destroyed by a file move — and this is the finding that forces the migration on its own.** The upsert (`workspace_db.py:8318-8335`) resolves an existing row by `WHERE asset_id = ? OR source_path = ?` **only.** There is **no `content_hash` rehoming anywhere in the codebase.** So moving or renaming a file makes it a **brand-new asset**, orphaning its faces, people, albums, keywords, embeddings, edit stacks, favorite, and rating. This is a live defect today, independent of mobile.

3. `local_sync` keys on the SHA-256 of the **original file bytes**, and iOS routinely re-encodes on export (HEIC→JPEG, EXIF rewrites). **Convergence between a phone and a desktop for the same logical photo would be near-zero.**

**CORRECTED:** an earlier draft called `photo_asset_external_ids` an "unused table." **That is wrong.** It is **actively upserted** (`photo_sources/catalog.py:350`) and state-updated (`photo_sources/service.py:1727, :2150`). It is merely **never exposed over HTTP**, and today exists only for connector-ingested assets. It remains the correct hook for PHAsset `localIdentifier` — but it is a *live* table, not a dead one, so the migration must respect its existing contents.

> **This is the #1 blocker. It must be resolved before any schema is written.** The decision taken (see the architecture document) is a stable UUID `asset_uid` as the single canonical key, with content-hash, external-id, and legacy path-hash as *resolvable axes*.

### 9.2 The preview endpoint has a hard 768px ceiling — and every prior document quoted 2048px

Confirmed, and **the reality is worse than the first draft stated**:

1. `write_preview_image(source, target, max_edge=768, quality=84)` — `ingest/image_io.py:335`. **Both call sites invoke it with no `max_edge` override** (`enroll/manager.py:11655, 11680`) — so **768 is not a default, it is an absolute ceiling.**
2. `AgentImageService.preview()` (`agent_images.py:1460`) opens that 768px file and calls `PIL.thumbnail()`, **which never upscales**.
3. **The API lies.** `MAX_PREVIEW_DIMENSION = 2048` (`agent_images.py:44`) is **published in the OpenAPI schema** (`agent_openapi.py:270`). Even the **default of 1536 silently returns 768** for every unedited asset.

> **The ceiling is also non-uniform, through the same function.** The one escape hatch is the edit-stack rendered preview at **1600px** (`api_server.py:40578/40630`) — so an **edited** photo previews at 1600px and an **unedited** one at 768px.

The cache is keyed on `resolve()|st_size|st_mtime_ns|preview-v3` (`manager.py:11812`), so it is busted by **mtime churn** *and* by **path** (a move regenerates it; two identical files cache twice). It is **never incrementally pruned** — the only removals are total wipes (`optimize_workspace`, `delete_face_data`), notably harsher than `video_frames`, which *does* get a selective keep-set.

**You cannot build a Photos-grade viewer on this.** A content-hash-keyed proxy ladder (thumb / screen / full) is a prerequisite.

### 9.3 Safe Mode staleness on the mobile preview path — a live security bug

`_api()` caches a module-level `DesktopApi` singleton (`mcp_server.py:218-223`). `EnrollmentProject.__init__` calls `load()` **once** and caches `config`, `references`, `candidates`, `consent`, `scan_history` (`enroll/manager.py:221-255`). **Only `consent` is ever re-read from disk** (`mcp_server.py:686`).

But **Safe Mode is read from the cached config** — `self.config.safe_mode`, `safe_mode_threshold`, `safe_mode_zero_admittance` (`manager.py:2675-2711`).

> **Confirmed, and it is a genuine fail-OPEN.** An operator **enabling or tightening** Safe Mode on the desktop **does not affect the mobile preview path until the MCP sidecar restarts.** The phone keeps serving previews under the old, looser policy.

The most damning detail: **consent was explicitly fixed for exactly this cross-process staleness problem, one function away** (`manager.py:906`). Config was simply forgotten.

**Severity: HIGH.** This is a *tightening* failure — the direction that actually matters.

### 9.4 SQLite contention can wedge the entire mobile HTTP surface

**Confirmed, but the mechanism is not what the first draft said** — and the corrected version is worse.

`WorkspaceDb.connect()` (`store/workspace_db.py:299-313`) opens and closes a fresh SQLCipher connection per call, guarded by a **process-local** `RLock`, with `busy_timeout=30000`.

**CORRECTED:** WAL mode means desktop writes do **not** block mobile *reads*. The contention is **writer-vs-writer**. But the real amplifier — which the critic missed — is that **the process-local `RLock` is held across the entire 30-second busy-wait.**

> So **one stuck mobile write serializes every other DB-touching request in the MCP process.** The 8-slot semaphore (`mcp_server.py:4159-4162`) — which has **no path exemption and no timeout** — then wedges the **entire HTTP surface, including authentication and the static mobile assets themselves.**

**Severity: HIGH** for reliability.

### 9.5 Telemetry is on by default — **partially** as feared

**Nuance matters here, and the first draft of this audit over-claimed.** The deep-dive result:

**Confirmed:** OpenTelemetry **is on by default** — `enabled = env_flag("MCP_OTEL_ENABLED", default=True)` (`agent_telemetry.py:279`) — and writes `mcp-traces.jsonl` **synchronously on every tool call**, wired in via `_call_tool_with_telemetry` (`mcp_server.py:3123`). There is **no product config and no UI toggle**. This directly contradicts the documented *"genuinely no telemetry"* posture (`docs/security-audit.md:28,153`).

**REFUTED:** the claim that it "exports to OTLP by default." Network export requires an **explicitly-set** env var and is HTTPS/localhost-validated. **There is no default egress.**

**Also refuted (good news):** `_SAFE_ATTRIBUTE_KEYS` is genuinely well-designed and **cannot today carry asset ids, paths, or person names.**

**The real gaps, which are still serious:**
- **The plaintext trace log sits inside an otherwise SQLCipher-encrypted workspace — and is zipped into every workspace backup.**
- The OTLP exporter has **no scrubber of its own**.
- `_nested(structured, "status")` scrapes arbitrary tool results for a data-dependent value.
- Client-supplied `traceparent`/`baggage` is **trusted as parent context**.

> This still must be fixed before mobile ships — see the architecture document §2.3. A plaintext trace log adjacent to biometric data is precisely the artifact that would undermine the *Barnett v. Apple* on-device defense.

### 9.6 Video, Live Photos, depth, and spatial are absent from every remote surface

- **Zero server-side `Accept-Ranges` / `206` / Range handling anywhere in `crossage_fr/`.** Every `Range` hit in the codebase is *client-side*, in resumable model-weight downloads.
- **`api_server.py` returns zero media bytes** — grepping it for `b64encode`/`base64` is **empty**. All media is passed **by file path**.
- **Electron's `vintrace-media://` handler ignores Range too**: it never reads `request.headers` and calls `net.fetch(url)` with no init, returning the whole file at `200` (`desktop/main.cjs:3029-3050`). The renderer nonetheless plays video with `<video src>` + `preload="metadata"` — so **seeking a 4 GB clip has no range path even on the desktop.**
- **The only network surface a phone can reach — `local_sync`'s `ThreadingHTTPServer` — emits `Content-Type: application/json` and nothing else** (`local_sync.py:1567`). **It cannot serve a single pixel.**
- `media_pairs` (live photo / raw sidecar / depth sidecar / burst) and spatial/depth/disparity/portrait-matte data **do exist** in the DB (`workspace_db.py:941-957, :3003-3037`) and in the renderer — but are **entirely absent from `_public_asset`**, and `analyze_assets` enforces a hard-validated **8-name capability allowlist that raises `ValueError` on `"depth"`, `"spatial"`, and `"pairs"`** (`agent_images.py:1057`).

> **Video is half a camera roll.** Today it is entirely unreachable from a phone — and the range-request gap is a desktop defect too.

### 9.7 There is no change feed — and the "it's 90% built" claim is **false**

An earlier draft of this audit (and the critic that produced it) claimed the CRDT op-log and `photo_asset_events` were "both already populated by SQLite triggers" and that a delta feed was "~90% built." **A targeted deep-dive refuted this.** The truth is worse, and an implementer who trusted the optimistic version would have built on sand:

- **The 9 triggers (`workspace_db.py:1410-1493`) write exclusively to `photo_sync_dirty`** — which is a **coalescing dirty-*set*** (primary key `entity_type + entity_key`), **not a log**. It tells you *that* something changed, never *what* or *in what order*.
- **`photo_sync_operations` has exactly one writer** (`local_sync.py:710`), reachable only through `capture_local_changes()` (`local_sync.py:792`), which is **gated on SQLCipher** (`_require_encryption`, `local_sync.py:318`). → **The op-log is empty on any unencrypted workspace.**
- **`photo_asset_events` is not a change log at all.** `workspace_db.py:21878` **hard-rejects any `event_type` outside `{"viewed", "shared"}`**. It carries **zero** create/update/delete events.

And `_public_asset` has no `updatedAt`, no revision, no etag, no `deletedAt` (only `missing`), while `/v1/events` polls the audit table for `agent_tool_*` only.

> **Corrected verdict: the delta feed is ~35% built, not 90%.** Pairing and auth are the parts that are nearly done. **The feed itself must be built**, and the natural substrate is a *stream of `photo_sync_operations` rows* — which requires making the op-log populate unconditionally, not only under SQLCipher.

---

### 9.8 "Catalog only" export still ships media bytes — a live privacy and size surprise

Found while auditing the Open Photo Catalog for the media tier. It is unrelated to mobile and worth fixing on its own:

`mediaPolicy` is derived **solely** from `include_originals` (`photo_catalog_portability.py:986`) and is **orthogonal to `include_sidecars`**. The sidecar byte-copy is guarded by `if include_sidecars:` **only** — and the validator requires only `includeSidecars is True` for a sidecar archive member, **unlike** the asset check, which *does* require `mediaPolicy == "full"`.

Sidecars include Live-Photo `.mov` halves, depth maps, disparity, portrait mattes, right-eye images, and RAW/XMP/AAE companions.

> **A user who selects "Catalog only" — expecting a small, pixel-free metadata package — still exports every Live-Photo video half, every depth map, and every RAW companion.** And the UI **defaults `includeSidecars` to `true`** (`src/views/PhotoCatalogPortabilityPanel.tsx:80`).

That is both a size surprise and a genuine privacy surprise, and it exists today.

## 10. The serial-loop problem

Worth isolating, because it is the one finding that cannot be worked around with a small patch.

`for line in sys.stdin` (`api_server.py:44060`) processes **one command at a time, with no worker pool**. A running scan or index blocks every other read. `cancel_scan` / `pause_scan` can *never be dequeued* while the scan they target is running — which is why Electron resorts to writing sentinel files.

**"Offload heavy compute to the desktop" is impossible at any usable latency until this is addressed.** There are exactly two viable routes:

- **(a)** Route mobile compute through the *separate* MCP-process `DesktopApi` — accepting two SQLite writers, which walks straight into §9.4.
- **(b)** Generalize the one existing async pattern — `start_photo_export_job` → `photo_export_job_status` → `cancel_photo_export_job` (`api_server.py:3223-3266`) — into a durable job table like `photo_indexing_jobs`, and make scan/enroll/index/semantic-search **submit-and-poll**.

> **(b) is the right long-term answer** and it unlocks the whole "phone requests, desktop crunches, phone polls" model. It is also the honest prerequisite for the product's core promise.

---

## 11. Prior art in `docs/`

Relevant decisions already taken, which the mobile design must not silently re-litigate:

- `docs/mobile-companion.md` — the current companion's support contract and security model. **Its "online-only, no service worker" stance is a documented privacy decision that an offline-first app directly reverses.** That reversal needs explicit product sign-off, not a quiet change.
- `docs/2026-07-12-cutting-edge-expansion-implementation-ledger.md:882` — media replication is **explicitly declared out of scope** for local sync, with the instruction that the protocol *"must not silently widen."* Adding a media tier is therefore a deliberate, documented decision.
- `docs/vintrace-open-photo-catalog-v1.md` — the portability format that the media tier will now be built on.
- `docs/2026-apple-photos-local-gap-audit.md`, `docs/2026-photos-tab-feature-plan.md` — existing Apple-Photos-parity work on the desktop.

---

## 12. Verdict

**What is genuinely strong and should be reused, not rebuilt:**
- The pairing cryptography — both mechanisms. Better than most competitors ship.
- The CRDT op-log, HLC, conflict ledger, and the SQLite trigger-based change capture.
- The 34-table portability allowlist. It *is* the replica spec.
- The decision layer (`crossage_fr/match/`) — pure NumPy, zero weights, ports to TypeScript.
- The durable job queue as an offload scheduler.
- The photo tether as the camera-roll ingest substrate.

**What must be built, and was previously believed to exist:**
- A media tier (originals, a real thumbnail ladder, video with byte ranges).
- A blob-ingest RPC (small — the engines already accept in-memory images).
- A compute-offload channel (blocked on the serial loop).
- A change feed (90% built, unexposed).
- A stable asset identity (the #1 blocker).

**What must be fixed before any mobile code is written:**
1. Asset identity (§9.1)
2. The 768px preview ceiling (§9.2)
3. Safe Mode cache staleness (§9.3)
4. Workspace-lock and Touch ID enforcement moving into the backend (§7)
5. The serial command loop (§10)

**The honest summary:** the desktop's *intelligence* is far ahead of Apple Photos. Its *mobile integration* is a read-only window with a proxy-server prerequisite. The gap between those two facts is the entire project.

# Remaining Work — Disposition

**Date:** 2026-07-14
**Purpose:** An honest, itemized status of every open item from the mobile audit, so nothing is hand-waved. Each item is one of: ✅ **fixed** (with a test), 🔵 **product-build** (net-new feature for the not-yet-existent mobile app), 🟣 **protocol/architecture** (a redesign, not a spot-fix), or 🟠 **native/UI** (cannot be built or verified in this Python environment).

## The one-line summary

**Every live, user-facing correctness/privacy/security/data-loss defect that is spot-fixable and verifiable has been fixed and tested.** What remains is: building the mobile app itself (it does not exist yet), two architectural redesigns whose *correct* form is risky to do blind, and native/Electron/UI work that cannot be run or verified here.

---

## ✅ Fixed this work (all TDD, all green, all with regression guards)

| Item | Defect | Fix | Test |
| --- | --- | --- | --- |
| E0.3 | Safe Mode fail-open across the process boundary | `refresh_config_from_disk()` at the enforcement point | `safe_mode_cross_process_units.py` |
| E0.5 | Telemetry on by default + plaintext trace log in backups | Opt-in default; log excluded from backups | `telemetry_default_off_units.py` |
| E0.1 (data-loss half) | Moving a file destroyed its identity | Content-hash rehoming, guarded by file signature | `asset_identity_rehome_units.py` |
| E0.4 | Hidden/Deleted photos reachable by a paired phone | `_metadata_restricts_agent_access()` on fetch/analyze/preview | `agent_hidden_asset_gate_units.py` |
| — | Warm-cache workspace-lock bypass | `_assert_unlocked()` per-request in `_image_service()` | `mcp_workspace_lock_warm_cache_units.py` |
| — | Cross-machine backup restore impossible (disaster-recovery blocker) | `workspaceKeyId` in manifest; key-mismatch vs. corruption | `workspace_backup_cross_machine_units.py` |
| E0.2 / B2 | Preview API advertised 2048 but silently returned 768 | Generate the base preview at the requested edge | `preview_dimension_honesty_units.py` |
| §9.8 | "Catalog-only" export still shipped media bytes (Live Photo `.mov`, depth, RAW) | Sidecar bytes require `include_originals`; manifest made truthful | `catalog_only_no_media_bytes_units.py` |

All changes are recorded in `2026-07-14-p0-fixes.patch`. **Not committed** — the files they touch are part of the paused Codex in-flight tree (several are untracked in git); they go on top as a small reviewable diff once the Codex batch lands.

---

## 🟣 Protocol / architecture — a redesign, not a spot-fix

### B14 — keyword whole-value LWW silently loses data
**Real defect.** In `local_sync.py`, `keywords` is a single field-register merged whole-value by HLC last-writer-wins. Two devices each adding a different keyword concurrently → the higher-HLC op wins its *entire* list; the other device's keywords are discarded.

**Why not spot-fixed:** the correct fix is an **observed-remove set (OR-Set)** — each keyword add/remove becomes its own operation with a tombstone, reassembled on read. That is a **wire-format change (v1 → v2)** touching the field validator, the change-capture diff, the apply-to-DB path, and read serialization. A *partial* CRDT (e.g. union-merge) cannot represent removals and would be **wrong** — worse than the known LWW. This belongs to **E1.1 `vintrace-sync-v2`**. `local_sync.py` is also dormant (nothing auto-starts the listener), so the live blast radius is limited to users who manually pair two desktops and tag on both.

### E0.7 / B12 — SQLite contention can wedge the MCP HTTP surface
**Real defect, with a current consumer** (the MCP HTTP server is used by Claude Desktop / Codex MCP clients today, not only the future mobile app).

**Empirically verified this session:** `WorkspaceDb.connect()` holds a process-local `RLock` across the *entire connection lifetime*, so it serializes **every** connection in-process — a reader blocks completely while any other connection is open. Combined with a stuck cross-process writer (up to a 30 s `busy_timeout` while holding the RLock) and the 8-slot HTTP semaphore, the whole surface wedges for up to 30 s.

**Why not spot-fixed:** the correct fix is **connection pooling + reducing the RLock scope** (spec B12), an architectural change to a hot path that can only be validated under **concurrent load** (a real MCP HTTP server + a competing desktop writer) — not a unit test. A surgical `busy_timeout` reduction would cut the wedge to ~5 s but trades off audit-write reliability under contention. Neither is a safe blind change on the heavily-churned `workspace_db.py`. Deferred to the pooling work.

### E0.6 / B10 — the serial command loop
`api_server.py`'s `for line in sys.stdin` processes one command at a time. This blocks *compute offload at usable latency* — a **future mobile feature**, not a live defect (the desktop tolerates it today via its silence-watchdog). The fix (generalize the async job pattern into submit-and-poll) is **L**-effort architecture and belongs with the offload work (E1.4).

### E0.1 (canonical key half) — `asset_uid`
The **data-loss half is fixed** (above). The remaining piece — a stable UUID `asset_uid` with content-hash / external-id / path-hash as resolvable axes — exists to let a phone's PHAsset (which has no desktop path to hash) join the desktop's identity space. It is **only needed by mobile sync, which does not exist yet**, and it is an **L**-effort migration touching every table that foreign-keys an asset. Doing it blind on top of `workspace_db.py`'s +5,495-line churn is reckless; it belongs with E1.1.

---

## 🔵 Product-build — net-new features for the mobile app (which does not exist yet)

These are not defects to fix; they are the app to build. There is **no React Native project in this repository**. Each is forward feature work whose consumer (the phone app) has not been created.

| Item | What it is |
| --- | --- |
| B6 | Blob-ingest RPC (`embed_face_blobs`) — the compute-offload primitive. Testable, but speculative until the phone exists to call it |
| B7 | Job-queue offload API over HTTP |
| B8 | Change feed — expose an op-log as a cursor-paged delta (the op-log must first populate unconditionally) |
| B9 | Media tier — incremental/chunked Open Photo Catalog + byte-range video (the 10-step plan in the spec) |
| B13 | Schema: real faces table with bboxes, stable person ids, clusters as rows |
| E1.1–E1.5 | `vintrace-sync-v2` and the sync tiers |
| E2.1–E2.4 | The phone replica, grid, decision layer, semantic search |
| E3.1–E3.3 | PhotoKit ingest, background backup, Face-Data consent gate |

The **shortest path to prove the thesis** (B6 → decision layer in TS → synced vectors → offline semantic search) is laid out at the end of the backlog; it is roughly a month of work and requires standing up the RN project.

---

## 🟠 Native / Electron / UI — cannot be built or verified in this environment

| Item | Why it's not doable here |
| --- | --- |
| E0.8 / B11 | LAN bind (`--allow-remote-http`) — an Electron/`.cjs` change, and binding the MCP server beyond loopback is **security-sensitive**: it must not ship without the pinned-cert TLS transport (E1.1), or it opens a hole. Not a safe standalone change |
| B15 | `NSLocalNetworkUsageDescription` on the Electron app — macOS entitlements, unverifiable without building/running the app |
| Recovery fix 4 | In-app "restore + enter recovery code" flow — Electron IPC + Settings UI. The crypto works (proven); the front-of-house does not exist. Needs Electron to build/verify |
| E3.3 | Face-Data egress consent gate — a mobile-app UI surface |

---

## What "done" means here

The audit's **live-defect list (§9) is at zero** — every item is either fixed-and-tested above or precisely dispositioned as protocol/architecture/build/native work with a stated reason. Nothing remaining is a spot-fixable, verifiable correctness defect being left unaddressed. The remaining work is *building the mobile product*, which is a multi-week effort that begins with standing up the React Native project (SP-1 already proved the grid is viable).

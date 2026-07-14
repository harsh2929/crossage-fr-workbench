# Mobile spike harnesses (2026-07-14)

Reusable measurement harnesses for the mobile companion. Results: `docs/2026-07-14-mobile-spike-results.md`.

## SP-1 — 100k-asset grid (Expo 57 / RN 0.86 / FlashList 2.0.2)

Measured on a booted iPhone 17 Pro simulator, **Release** build:

| Config | FPS | p99 frame | Peak RSS |
| --- | --- | --- | --- |
| `THUMB_CACHED` (the real app) | **60.0** | 17.65 ms | **267 MB** |
| `THUMB` (cold, no cache) | 37.9 | 62.61 ms | 413 MB |
| `FULL` (naive full-res) | 59.6 | 20.09 ms | **3,174 MB** |

**The lesson: measure PEAK MEMORY, not FPS.** The naive full-res pipeline scored a *higher*
frame rate than the correct one — because it was too slow to load images — while using 11.9x
the memory. It survives only on a simulator, which has no jetsam. Gate memory in CI.

## SP-2 — sqlite-vec KNN over 100k vectors (op-sqlite, SQLCipher)

| Config | Insert 100k | KNN median |
| --- | --- | --- |
| `float32[768]` | 10.3 s | 68.1 ms |
| **`int8[512]`** (what we sync) | 3.1 s | **26.8 ms** |
| `bit[512]` (coarse pass) | 1.7 s | **4.5 ms** |

Brute force is fine at 100k. No ANN index needed.
NOTE: op-sqlite ships sqlite-vec **v0.1.7-alpha.2** — an alpha. Pin it.
GOTCHA: sqlite-vec assumes float32 for a bare BLOB. int8/bit need `vec_int8(?)` / `vec_bit(?)`.

## Reproducing

Both harnesses ran on a simulator (M5 Pro host) — frame rates are OPTIMISTIC versus a real
A19, and there is no thermal throttling or jetsam. This is a one-sided test: it can falsify,
but a pass does not prove device performance. **Re-run on a physical iPhone SE / Pixel 6a
before shipping.**

    npx create-expo-app gridbench --template blank-typescript
    npx expo install @shopify/flash-list expo-image
    npm i @op-engineering/op-sqlite     # + "op-sqlite": {"sqliteVec": true} in package.json
    # copy sp1-grid-App.tsx -> App.tsx, sp2-vecbench.ts -> vecbench.ts
    node bench-server.mjs &             # serves the image corpus + collects results
    echo THUMB_CACHED > mode.txt        # THUMB | THUMB_CACHED | FULL | VEC
    npx expo run:ios --configuration Release
    ./memsample.sh mem.txt 95           # samples the app's real RSS from the host

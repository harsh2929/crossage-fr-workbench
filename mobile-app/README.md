# Vintrace Mobile

The cross-platform React Native companion to the Vintrace desktop app. Design and rationale live in
`docs/2026-07-14-mobile-*.md`; this is the build.

**Status:** construction in progress. Shipped and verified on the simulator: the decision-layer port,
the camera-roll grid over an encrypted on-device replica, the photo-detail view, and **on-device
natural-language semantic search** (CLIP + sqlite-vec) — all offline, no Apple Intelligence.

## Architecture in one line

The phone holds an offline, encrypted replica of the catalog plus semantic embeddings, renders
instantly, and re-ranks face matches with a ported decision layer — while the paired Mac stays the
licensed, heavyweight face-embedding oracle. See `docs/2026-07-14-mobile-architecture-and-spec.md`.

## The app — ✅ runnable on the simulator

`app/` is the Expo app (SDK 57 / RN 0.86 / New Architecture). It reads the phone's **own** camera
roll via `expo-media-library`'s object-oriented Query API (`exeForMetadata()` — the cheap batch that
reads the media store without decoding files), ingests it into a **SQLCipher-encrypted replica**
(`src/replica.ts`, op-sqlite + sqlite-vec), and drives a **three-tab shell** off that single durable
source (`App.tsx` + `src/screens/*` + a custom `src/TabBar.tsx`):

- **Library** — the whole roll, newest first, rendered with `expo-image` resolving each PHAsset's
  `ph://` URI at cell size (never a full-res decode — the 3.17 GB trap SP-1 exposed). Tapping a cell
  opens a full-screen, swipeable detail view (`src/PhotoDetail.tsx`) with **pinch-to-zoom** (native
  iOS zoomable ScrollView — no gesture library, no rebuild) and an **ⓘ details panel** (date/time,
  dimensions + megapixels). Location/EXIF aren't shown — the current expo-media-library class API's
  `AssetInfo` doesn't expose them; that richer metadata will arrive with the desktop sync tier. A
  **Select** mode turns taps into multi-select (checkmarks) with a bottom bar to **batch-favorite**
  or **delete** (via the iOS system prompt; `Asset.delete`, then cleaned from the replica + vec index).
- **Search** — first-class on-device CLIP semantic search (below): opt-in enable, then
  search-as-you-type (debounced) with example-query chips.
- **Find Similar** — the detail view's "✨ Similar" action runs a KNN over the tapped photo's *own*
  CLIP image embedding (`replica.ts::similarByExternalId`) and surfaces the visually/semantically
  closest photos on the Search tab. Reuses the embeddings already computed for text search — something
  Apple Photos doesn't offer. Verified: a mint-green tile surfaces other green tiles at the top.
- **Albums** — a pinned **Favorites** album, a **Duplicates** finder (once the index is built), plus
  the library grouped into months (client-side over the replica's `created_at`), each with a cover
  thumbnail and a drill-in grid. Favorites are toggled by the heart in the detail view, which writes
  through to PhotoKit's system Favorites album (`Asset.setFavorite`) — optimistic + reverts on
  failure — and caches the flag in the replica; the favorite survives relaunch because
  `exeForMetadata` re-reports it and ingest re-syncs it.
- **Desktop** (`src/screens/DesktopScreen.tsx`, `src/desktop/client.ts`) — the deep uplink to the
  desktop app (the licensed face-recognition oracle). Pairs with the desktop's SEC-09 read-only
  companion HTTP surface (POST `/v1/mobile/pair`; auth then rides the session cookie — RN fetch needs
  `credentials:'include'`, and expo-image shares the same NSURLSession cookie jar so desktop-rendered
  previews load with no token handling) and browses the **desktop catalog**: real-resolution previews
  the desktop renders, full-library `/v1/search`, and per-photo **face recognition** via
  `/v1/assets/analyze` — the identity data the phone structurally can't compute. Ingested text arrives
  in the MCP-05 untrusted-text envelope and is unwrapped before display. The desktop catalog is its own
  asset space (kept separate from the camera roll until the desktop's canonical `asset_uid` lands). A
  local demo desktop for testing: `node desktop/scripts/run-python.cjs mobile-app/tools/demo-desktop.py`.
- **Vivid, alive UI** (`src/theme.ts`, `src/motion.tsx`, `src/Header.tsx`) — a token system + pure
  React-Native `Animated` motion layer (no native deps, no rebuild): living-gradient headers, springy
  presses, breathing-orb loaders, a floating search hero with a real progress bar, and an animated
  4-tab bar with a sliding pill. Living colour is confined to chrome so photos stay legible.
- **Duplicates** (`src/screens/DuplicatesView.tsx`, `replica.findDuplicateGroups`) — the offline
  answer to Apple Photos' "Duplicates" (which needs Apple Intelligence). Union-finds the CLIP image
  embeddings into near-identical groups under a tight L2 threshold (0.2 — calibrated on-device: real
  twins clustered at 0.184, the "similar-but-different" background at ≥0.227, so the threshold sits in
  the gap for zero false positives), and offers "keep the first, delete the rest" via the same
  PhotoKit delete path as multi-select. O(N) KNN queries, run on demand.

Every grid renders through one reusable `PhotoGrid` (`src/ui.tsx`) so cell sizing, recycling, and the
relevance-remount fix stay identical everywhere. Tab icons are drawn from plain Views (no icon-library
dependency → no native rebuild) so they stay crisply tintable for the active/inactive states.

Verified on the booted iPhone 17 Pro simulator: all three tabs render and switch by tap; Library shows
**103 photos from the encrypted replica**; Albums groups by real EXIF month (July 2026, Aug 2012, …);
and Search ranks all four real dog photos (two JPEG + two HEIC) **#1–#4** for *"a photo of a dog"*.

### On-device semantic search — ✅ verified end-to-end, offline

The crown-jewel capability and the first thing that beats Apple Photos: natural-language photo search
with **no Apple Intelligence gate, no cloud, offline**. CLIP ViT-B/32 (image + text encoders) runs
via `react-native-executorch` (ExecuTorch / XNNPACK); both encoders map into the same 512-d space, so
a text query and a photo are directly comparable. Image embeddings are L2-normalized and stored in a
`sqlite-vec` `float[512]` table in the encrypted replica; a query becomes a text embedding and a KNN
returns the matching photos, which re-rank the grid live (`src/semantic.ts`, `src/useSemanticSearch.ts`).

- **Opt-in:** behind the "✨ Enable semantic search" button (it downloads the CLIP models once, then
  caches them). Indexing is **idempotent** — embeddings persist in the replica across launches, so a
  relaunch re-embeds only new photos.
- **Verified:** with real photos (a black Labrador + a pug, each in **both JPEG and HEIC**, plus
  waterfalls and an abstract art piece) mixed into ~96 synthetic tiles, *"a photo of a dog"* ranks
  **all four dog photos #1–#4** (the two HEIC dogs sit right beside their JPEG twins, d≈1.21 vs 1.22)
  and the control *"a photo of a waterfall"* ranks the waterfalls #1–#3 with no dogs near the top —
  decisive proof the CLIP text↔image space aligns on-device and the ranking is genuinely
  query-sensitive. (Color/abstract queries over the synthetic tiles are weak by design: abstract
  color-blobs are out-of-distribution for CLIP. Concrete queries over real photos are what CLIP is for.)
- **HEIC works** (`src/semantic.ts::toDecodableJpeg`). ExecuTorch's XNNPACK reader decodes JPEG/PNG but
  not HEIC — and a real iPhone library is ~all HEIC. Every image is transcoded to JPEG via
  `expo-image-manipulator` (iOS ImageIO decodes HEIC) before embedding; we downscale to a ~512 px
  longest edge to bound decode memory (executorch resizes to 224² internally, so no aspect distortion)
  and `renderAsync()` bakes EXIF orientation upright. This makes the whole library indexable, not just
  the JPEG minority.
- **`k` is clamped to the stored-vector count** (sqlite-vec requires `k ≤ row count`), and search
  returns a top-K (60) — better UX than reordering the whole library.
- **The grid remounts per query** (`key={…lastQuery}`). FlashList recycles cells by key and does not
  reliably reposition them when `data` is reordered in place, so a relevance re-rank would otherwise
  keep showing the library order while the underlying result set was already correct. A distinct key
  per query forces the correct render (and scrolls to the top).

```bash
cd app
npm install
npx expo run:ios --device <booted-sim-udid>   # native build + launch
# Metro serves the JS; the monorepo package resolves via metro.config.js (watchFolders + alias).
```

Notes learned wiring it up:
- **Monorepo + Metro:** `metro.config.js` sets `watchFolders` to the repo root and aliases
  `@vintrace/decision-layer` to its TS source. Restart Metro after changing it (config is read at
  startup) or you get a stale-bundle `Base module not found`.
- **iOS 26 permissions:** `simctl privacy grant photos` only grants the *add-only* tier; full read
  access requires the in-app "Allow Full Access" tap.

## Packages

### `packages/decision-layer` — ✅ built and conformance-verified

The desktop's face-match decision layer (`crossage_fr/match`), ported to TypeScript so the phone can
**re-band, re-threshold, and re-rank matches offline, instantly, with zero model download**. This is
the product's moat — Apple Photos exposes no decision layer at all.

Zero native dependencies, pure arithmetic:

- **Platt** calibration, **AS-Norm** cohort normalization, the **adaptive linear calibrator**, and
  score fusion (`calibration.ts`)
- **Cross-age** confidence banding and review-floor widening (`ageGap.ts`) — our wedge; Apple has no
  published cross-age mechanism
- Match **banding** and pose-aware thresholds (`scoring.ts`)

**Correctness is not asserted, it is enforced.** `tools/gen_decision_layer_fixtures.py` drives the
*real* Python reference over 128 inputs and dumps golden `(input → output)` fixtures;
`test/conformance.test.ts` replays them and requires the TypeScript output to match within 1e-9. If
the Python reference changes, regenerate the fixtures and the test catches any drift.

```bash
cd packages/decision-layer
npm install                 # tsx + typescript (dev only)
npm run fixtures            # regenerate golden fixtures from the Python reference
npm test                    # conformance: TS must match Python
npx tsc --noEmit            # typecheck
npx tsx test/demo.ts        # runnable demo of the composed capability
```

## What's next (see `docs/2026-07-14-mobile-implementation-backlog.md`)

Shipped: the Expo app shell (SDK 57 / RN 0.86 / FlashList v2), the encrypted local replica (op-sqlite
+ SQLCipher + sqlite-vec), the camera-roll grid + photo-detail view, and on-device CLIP semantic
search **including HEIC** (transcode-to-JPEG before embedding). Still ahead:

- The **sync tiers and pairing** — the desktop as the licensed heavyweight embedding oracle backfills
  the library's embeddings (SigLIP) into the replica's `asset_vectors` table over the LAN/relay
- Bringing the full **decision layer** onto real synced face matches (it's built + conformance-tested;
  it needs live match data to re-rank)
- **Indexing polish:** delete the per-image transcode temp JPEG after embedding (currently left in the
  ImageManipulator cache for the OS to evict); a progress/backgrounding UX for large-library indexing.

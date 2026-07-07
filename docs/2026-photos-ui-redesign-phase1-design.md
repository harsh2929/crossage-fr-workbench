All facts confirmed: App.tsx is 15,216 lines, PhotosView.tsx is 31,391 lines, both contract guards exist, the `TabKey`/`tabs`/`activeTab` anchors are at lines 232/329/1764, and PhotosView's `railSections` (2586) + `PhotoRailSectionId` (263) machinery is exactly as the judge verified. Here is the final design.

---

# Vintrace Photos — FINAL RECOMMENDED PHASE-1 DESIGN

**Status:** Decision-ready for approval
**Direction (user-approved 2026-06-30):** Photos-first IA · Hybrid aesthetic · Phased rollout
**Build basis:** Proposal 3's migration mechanism + Proposal 2's PR phasing, held to Proposal 1's IA & aesthetic spec
**Verified ground truth:** `src/App.tsx` = 15,216 lines; `src/views/PhotosView.tsx` = 31,391 lines; `TabKey`@232, `tabs`@329, `activeTab`@1764, `invoke`@2417; PhotosView `PhotoRailSectionId` import@263, `railSections`@2586; contract guards `tests/command_contract.py` + `tests/e2e/ipc-security.spec.ts` both present.

---

## 1. FINAL TOP-LEVEL IA

### 1.1 The tab set (the new `tabs` array)

Five photos-first primary destinations, plus Tools (a destination tab) and Settings (top-right gear). This is the approved IA, with Tools kept as a real tab (not a drawer) for maximum discoverability of the recognition engine — the app's actual differentiator.

| Order | `key` | Label | Apple analog | Icon (lucide, in use) | Phase |
|---|---|---|---|---|---|
| 1 | `library` | Library | Library (Years/Months/Days/All) | `Images` | **1** |
| 2 | `memories` | Memories | For You / Memories | `Sparkles` | 3 |
| 3 | `albums` | Albums (+ Smart, Places, Utilities) | Albums | `LayoutGrid` | 3 |
| 4 | `search` | Search | Search | `Search` | **1** |
| 5 | `people` | People & Pets | People & Pets | `Users` | 4 |
| — | `tools` | Tools | *(no analog — recognition engine)* | `Wrench` | **1** (hosts legacy bodies) |
| — | `settings` | Settings | top-right gear | `Settings` | **1** (reused) |

```ts
// src/App.tsx:232 — widened (additive), legacy keys kept internally so nothing un-wires
type TabKey = "library" | "memories" | "albums" | "search" | "people" | "tools" | "settings";
type LegacyRecogTab = "dashboard" | "enroll" | "scan" | "review"; // still used inside Tools/People routing
```

**Phase 1 ships fully-wired:** `library`, `search`, `tools`, `settings`. `memories` / `albums` / `people` exist as nav entries from day one but render through PhotosView's existing rail sections (a thin projection — see §3) so they are **never dead and never un-wired**. They graduate to dedicated views in later phases.

### 1.2 Navigation model: left sidebar, two zones

Desktop Electron window with a deep object graph (10 rail sections, 245 commands) → **left sidebar**, not top tabs (can't hold the density) and not bottom tabs (a touch idiom). We keep the existing `<aside className="sidebar">` (App.tsx:6289) skeleton and restructure it into two zones:

```
┌─ SIDEBAR (resizable 248–320px, collapse→64px) ─┐ ┌─ WORKSPACE ──────────────────────────────┐
│  ◆ Vintrace                          [⚙ gear]  │ │ TOPBAR: scope title · folder chip · ⌘F   │
│  ┌─ unified search pill (⌘F / ⌘K) ───────────┐ │ │         · [+ Import ▾] · overflow ⋯       │
│  │ 🔍 Search photos, people, places…         │ │ ├──────────────────────────────────────────┤
│  └────────────────────────────────────────────┘ │ │ STATUS ROW (busy ▸ notice ▸ ready)        │
│  PRIMARY                                         │ ├──────────────────────────────────────────┤
│   ▸ Library            [count]                  │ │                                          │
│   ▸ Memories                                    │ │        ACTIVE VIEW BODY                   │
│   ▸ Albums                                      │ │   (Library grid / Search / Tools / …)     │
│   ▸ Search                                      │ │                                          │
│   ▸ People & Pets      [pending]                │ │                                          │
│  ── CONTEXTUAL RAIL (swaps per active tab) ──── │ │                                          │
│   (Library → All / Years / Recents / Utilities) │ │                                          │
│   (Albums  → My Albums / Smart / Places)        │ │                                          │
│  ──────────────────────────────────────────────│ │                                          │
│   ⚙ Tools                                       │ │                                          │
│   ◐ Mode: Full model                            │ └──────────────────────────────────────────┘
└──────────────────────────────────────────────────┘
```

- **Zone A — Primary nav (top, fixed):** the 5 photos-first tabs. `setActiveTab` mechanism unchanged.
- **Zone B — Contextual rail (middle, swaps per active tab):** this is where PhotosView's existing rich `railSections` (PhotosView.tsx:2586) live — no longer competing with global nav. Per-tab we filter *which* sections show (a 1-line `visibleRailSections` filter), so Library shows All/Years/Recents/Utilities, Albums shows My Albums/Smart/Places, etc.
- **Footer:** Tools entry + the engine Mode pill (preserved from App.tsx:6314). Collapse state persisted to `localStorage("vintrace:nav:collapsed")` (mirrors `vintrace:language`).
- **Settings** = top-right gear (per the decided direction).

### 1.3 Persistent chrome (all preserved, restructured)

- **Unified search pill** at top of sidebar, always visible; `⌘F` / `⌘K` / `/` focuses it from anywhere; typing or Enter switches `activeTab` to `search` and seeds the query. The single global entry to Search.
- **Import** = one primary accent button in the topbar with a dropdown (Files… / Folder… / From System Photo Library… / Scan a Folder for Faces…). Consolidates the 5 scattered import entry points (PhotosView rail toolbar 18501/18505, scan folder, system sources). The "Scan…" item deep-links to Tools → Scan.
- **Topbar** (App.tsx:6322) preserved: scope title (replaces static "App folder" as primary title; folder path becomes a secondary chip), Choose/Show/Refresh, workspace-lock toggle, language picker, consent checkbox — at narrow widths these collapse into a `⋯` overflow so the search pill is never squeezed.
- **Status row** (App.tsx:6376) preserved verbatim: busy ▸ notice ▸ ready three-state, scan cancel control.
- **Boot screen / Plasma Silk** (App.tsx:6216), **onboarding** (6890), **consent sheet** (6901), **ConfirmHost** (6909), **ModalFrame** focus-trap (6962), **WorkspaceLockGate** (6408/6915) — all preserved unchanged; `onboardingNavigate` retargeted to new tab keys.

---

## 2. COMPLETE FEATURE → TAB COVERAGE MAP

Legend: ✅ already surfaced · 🟡 relocated · 🔴 orphaned today → now homed · **[P2/P3/P4]** = deferred to that phase but reachable in Phase 1 via Tools/rail projection. **All 35 audited orphan commands are already in the allowlist — they are orphaned in the UI only, so surfacing them adds zero new commands.**

### 2.1 Shell / global chrome → stays global

| Item | New home | Status |
|---|---|---|
| `tabs` + `activeTab`/`setActiveTab` (329/1764) | Sidebar primary nav, same mechanism | 🟡 |
| Brand block, Mode footer pill (6290/6314) | Sidebar header / footer | ✅ |
| `navMeta` badges (6274) | Re-mapped per new tab | 🟡 |
| Topbar actions (6322–6372) | Topbar + `⋯` overflow | ✅ |
| Status row + cancel-scan (6376–6404) | Global status row | ✅ |
| Boot / onboarding / consent / confirm / modal / lock gate | Unchanged | ✅ |
| i18n `nav.*` (i18n.ts:174) | New keys added across all 7 locales | 🟡 |

### 2.2 Library tab

| Item | New home | Status |
|---|---|---|
| `all` / `library:<root>` roots, virtualized time-grid + date headers (26314/26319) | Library grid (PhotosView, `activeId="all"`) | ✅ |
| `photoDateViewMode` all/years/months/days/recentDays (1730) | Library zoom spine segmented control | ✅ |
| `thumbnailSize` / `thumbnailAspectMode` (1808/1809) | Library density slider + square/aspect toggle | ✅ |
| Multi-select `selectedSources` + bulk actions (2126) | Library selection mode + floating action bar | ✅ |
| Lightbox + inspector (entire D-section) | Shared lightbox (reused intact) | ✅ |
| `recentlyImported`/`lastImport`/`imports`/`import:<id>` | Library rail → Recents / Imports | 🟡 |
| `recentlyDeleted`/`hidden`/`recovered`/`duplicates` | Library rail → Utilities group (dual-surfaced w/ Tools→Repair) | ✅ |

### 2.3 Memories tab **[P3]** (reachable via rail in Phase 1)

| Item | New home | Status |
|---|---|---|
| `memories` rail section, `memory` kind, editor (2031–2124), themes/transitions/music | Memories grid + detail/edit | ✅ |
| Slideshow playback (26463), `slideshowPlaying`, theme/interval | Memories playback + lightbox | ✅ |
| `export_photo_memory_movie` | Memories detail → Export movie | 🔴→ homed |
| Album suggestions chips (22152) | Memories → Suggested row | 🟡 |

### 2.4 Albums tab **[P3]** (reachable via rail in Phase 1)

| Item | New home | Status |
|---|---|---|
| `album`/`albumFolder`/`smartAlbum`, editors + tree (20502/20834), smart query builder (18374) | Albums → My Albums / Folders / Smart | ✅ |
| Saved filters (20724) | Albums rail → Saved Filters (promotable to Smart Album) | 🟡 |
| `places` / map (22289) | Albums → Places | 🟡 |
| Media types (RAW/Bursts/Live, `mediaTypes`) | Albums → Media Types | ✅ |
| Utilities (sensitive/screenshot/shared/lowValue, OCR/barcode/object) | Albums → Utilities (OS-auth gate for sensitive) | ✅ |
| Burst stack panel (23341) | Utilities → Bursts | ✅ |
| `list_photo_album_folders` | Powers Album Folders tree | 🔴→ homed |
| `bulk_update_photo_import_session_provenance` | Tools → Import history bulk-edit | 🔴→ homed |
| `list_photo_assets` | Internal enumerator (no dedicated UI, like `INTERNAL_COMMANDS`) | 🔴→ homed (internal) |

### 2.5 Search tab (Phase 1 — marquee feature)

| Item | New home | Status |
|---|---|---|
| Text search box (21176) | Search → text/facet results | ✅ |
| All filters (keyword/media/person/status/quality/dates/source/filetype/album/visibility/location/camera + toggles) (21232–21366) | Search → Facets panel (mirrored as Library filter chips) | 🟡 |
| `semantic_search_photos` (21195) | Search → AI mode toggle (on-device) | 🔴→ homed |
| People/Pets/Places as scopes | Search → scope chips | ✅ |
| Keyword manager (21374) | Search → manage keywords | ✅ |
| Saved searches (`photoSavedSearch.ts`) | Search → Saved (promote to Smart Album) | ✅ |

### 2.6 People & Pets tab **[P4]** (recognition review reachable via Tools in Phase 1)

| Item | New home | Status |
|---|---|---|
| `person`/`pet` kinds, people/pets rail (2598) | People & Pets grid | ✅ |
| Rename/merge/favorite/hide/review-more/find-dupes (21501–21620) | Person/Pet detail header | ✅ |
| Lightbox people/pet review (29638/29692) | Person/Pet detail → confirm/reject | ✅ |
| Enroll (EnrollView 8770): add person, age buckets, staging, coverage coach | People & Pets → Add / Manage | 🟡 |
| Review queue (ReviewView 10202): lanes, status, bulk, reassign, notes, block-false-match, people-together, calibration label | People & Pets → Review | 🟡 |
| `reference_suggestion_status` | People & Pets → Suggestions status | 🔴→ homed |

### 2.7 Tools tab (Phase 1 — hosts legacy bodies verbatim, then reorganizes)

| Item | New home (Tools sub-section) | Status |
|---|---|---|
| Dashboard (7292): hero, readiness, health cards, KPIs, ranked use-cases, tester panel | Tools → Overview | 🟡 |
| Scan (8888): folder/check/queue/watch/recovery/issue-center, system sources, camera | Tools → Scan | 🟡 |
| `cancel_scan` / `pause_scan` / `resume_scan` | Scan activity controls **+** status-row (cancel slot exists @6380; pause/resume added beside) | 🔴→ homed (critical) |
| `scan_job_status` | Scan activity monitor poll | 🔴→ homed |
| Review media ops: preview/manage/history/restore/retry/undo/cancel, export candidates | Tools → Media Operations (also in Review queue) | ✅ |
| **8 export orphans** (`export_photo_selection`/`contact_sheet`/`live_motion`/`portrait_blur`/`subject_cutout`/`video_frame`/`video_trim`/`memory_movie`) | **Lightbox Share/Export menu (primary)** + Library selection action bar (batch), via `photoExportPresets.ts` | 🔴→ homed |
| **4 live/video key-frame orphans** (`set/reset_photo_live_key_photo`, `set/reset_photo_video_poster`) | **Lightbox** Live/Video controls (slots @27090/27166) | 🔴→ homed |
| Import review/history/session/recovered (19987/22795/22726/22955) | Tools → Import / Repair | 🟡 |
| Indexing queues OCR/barcode/object (1759–1771) | Tools → Indexing | ✅ |
| Backup/health/consolidation, relink, dedupe (20120/9299) | Tools → Repair (mirrors Settings → Workspace Health) | ✅ |

### 2.8 Settings tab (top-right gear — all §A–N preserved)

| Item | New home (Settings group) | Status |
|---|---|---|
| Matching choices, thresholds, Safe Mode, cluster (A) | Settings → Matching & Safety | ✅ |
| Local engine: model pack/root/download/backfill, dry-run (B) | Settings → Engine & Models | ✅ |
| `model_status`, `model_distribution_audit` | Settings → Engine (status cards) | 🔴→ homed |
| System: launch-at-login, consent, updates, diagnostics, workspace switch (C) | Settings → System | ✅ |
| Save & clean up: purge, exports, retention, trash, backup/restore, privacy report, delete-all (D) | Settings → Data & Privacy | ✅ |
| App-folder check: health, repair, relink, optimize, prune, storage budget, audit (E) | Settings → Workspace Health (mirrors Tools → Repair) | ✅ |
| `database_integrity`, `storage_io_benchmark` | Workspace Health cards | 🔴→ homed |
| Performance tuning: mode, latency, report, cache warm (F) | Settings → Performance | ✅ |
| Accuracy Lab: calibration/adapter/self-learning, eval, dataset benchmark, validation pack (G) | Settings → Accuracy Lab | ✅ |
| `calibration_summary`, `calibration_learning_status`, `embedding_adapter_status`, `self_learning_rd_status`, `generate/run_accuracy_validation_pack`, `accuracy_validation_history`, `benchmark_history` | Accuracy Lab panels + history charts | 🔴→ homed |
| Installer/model diagnostics, drift, reference-gap, runtime self-test, machine benchmark, video decoder (H/I) | Settings → Diagnostics | ✅ |
| Review rules auto-review (J) | Settings → Review Rules (also in Review queue) | ✅ |
| Workspace lock (K) | Settings → Security (+ topbar toggle + lock gate) | ✅ |
| Duplicate people merge (L) | Settings → People (+ People & Pets → Find dupes) | ✅ |
| Settings profile copy/apply (M) | Settings → System → Profile | ✅ |
| Large-folder readiness (N) | Settings → Performance (+ Tools → Scan) | ✅ |

### 2.9 Items that don't fit cleanly — explicit rulings

1. **Tools & Settings have no Apple analog.** Apple hides power features; Vintrace's value *is* the recognition engine + diagnostics. Ruling: Tools is a real sidebar tab (discoverable, "nothing hidden"); Settings is the top-right gear (per decided direction).
2. **Saved Filters vs Smart Albums** overlap. Ruling: Saved Filters live in Search/Library (ephemeral query state) with a one-click "Promote to Smart Album" (persisted, in Albums). One creation flow, two homes by lifecycle.
3. **Recovered / Duplicates / Hidden / Recently Deleted** are both library views and maintenance. Ruling: dual-surfaced — Library rail Utilities group (browse) *and* Tools → Repair (fix actions). Same `activeId`, two entry points, zero duplication.
4. **Recognition Review vs lightbox people-tagging** are two distinct surfaces. Ruling: both under People & Pets — recognition Review is a sub-tab, lightbox tagging is contextual; clearly labeled.
5. **Dashboard** has no Photos analog. Ruling: demote to Tools → Overview; Library becomes the true home.
6. **Camera scanner / sensitive-collection OS-auth.** Ruling: Camera stays in Tools → Scan; the sensitive unlock gate is global (reused), fires at point-of-use before contents render.
7. **`list_photo_assets`** is a raw enumeration primitive. Ruling: no standalone surface; backs Library/Search loaders (documented UI-less, like the contract test's `INTERNAL_COMMANDS`).

**Result: 0 inventoried features and 0 of the 35 orphan commands are unaccounted for.**

---

## 3. PHASE 1 SCOPE — Shell + Library + Search

Phase 1 ships the new tabbed shell, Library, and Search, fully wired and tested. Tools hosts the legacy Dashboard/Scan/Review/Enroll bodies verbatim; Memories/Albums/People render through PhotosView's rail projection. **Nothing un-wired on day one.**

### 3.1 Component / architecture plan (the migration mechanism)

**Core insight (verified):** PhotosView already *is* a multi-section app — it drives all sub-nav off a single `activeId` string (PhotosView.tsx:1684) + a `railSections` array (2586) built from `PhotoRailSectionId` (263). The new top-level IA is therefore a **thin projection over that existing rail**, not a rewrite. Recognition views are inline siblings in App.tsx that already switch on `activeTab` (6416–6742).

**Principle: extract by *move*, not *rewrite*. App.tsx keeps ALL state, effects, the `invoke()` helper (2417), and the ~120 PhotosView prop callbacks.** We change only the *render output* of the big switch.

**New files (create):**
```
src/shell/AppShell.tsx          // sidebar + contextual-rail slot + topbar + status-row + body slot (presentational)
src/shell/Sidebar.tsx           // primary nav (Zone A) + contextual rail (Zone B) + footer; reuses navMeta badges
src/shell/TopBar.tsx            // scope title + search pill + Import menu + overflow (props-driven)
src/shell/StatusRow.tsx         // busy/notice/ready (props-driven)
src/shell/navModel.ts           // TabKey, TABS array, navMeta mapping, ROUTES map (moved from App.tsx)
src/shell/useAppNavigation.ts   // navigateTo({tab, photoActiveId?, searchQuery?}) — centralizes ~20 scattered setActiveTab calls
src/views/LibraryView.tsx       // Phase-1 Library (thin wrapper over PhotosView, activeId="all")
src/shell/SearchView.tsx        // Phase-1 unified Search (text + facets + semantic_search_photos)
src/shell/ToolsView.tsx         // Phase-1 sub-tabs hosting existing Dashboard/Scan/Review/Enroll bodies
src/shell/tokens.css            // design tokens (§4), imported first by styles.css
```

**The ROUTES map (Proposal 3's mechanism):**
```ts
// src/shell/navModel.ts
export const ROUTES = {
  library:  { kind: "photos", photoActiveId: "all",      sections: ["library","sources","places","mediaTypes","utilities"] },
  memories: { kind: "photos", photoActiveId: "memories", sections: ["memories"] },
  albums:   { kind: "photos", photoActiveId: "albums",   sections: ["albums","smartAlbums","places"] },
  search:   { kind: "search" },
  people:   { kind: "people" },   // EnrollView + ReviewView + PhotosView people section (P4)
  tools:    { kind: "tools" },    // Dashboard + ScanView + Photos repair/import/index
  settings: { kind: "settings" },
} as const;
```

**Two additive props on PhotosView (non-breaking, ~15 lines):**
```ts
// src/views/PhotosView.tsx — additive, defaults preserve today's behavior
initialActiveId?: string;                  // seeds activeId (1684) on mount
visibleRailSections?: PhotoRailSectionId[]; // intersect with railSections (2586)
```
**One mounted PhotosView instance** is reused across Library/Memories/Albums via key-stable rendering — only `visibleRailSections` + seeded `activeId` change on tab switch, so the 31k-line component never re-mounts and grid/scroll/thumbnail cache survive tab changes.

**App.tsx render replacement (the only structural change, ~6287–6909):**
```tsx
return (
  <AppShell
    activeTab={activeTab} navigateTo={navigateTo} navMeta={navMeta}
    railSections={ROUTES[activeTab]?.sections}
    topbar={{ workspace: state.workspace, language, consent: state.consentOnFile, busy,
              onChoose: chooseWorkspace, onReveal: revealWorkspace, workspaceLock, /* …existing props */ }}
    status={{ busy, notice, isDemoMode, scanInFlight, cancelActiveScan }}
  >
    {activeTab === "library"  && <LibraryView {...libraryProps} />}
    {activeTab === "search"   && <SearchView {...searchProps} />}
    {(activeTab === "memories" || activeTab === "albums") &&
        <PhotosView {...photosProps}
          initialActiveId={ROUTES[activeTab].photoActiveId}
          visibleRailSections={ROUTES[activeTab].sections} />}
    {activeTab === "tools"    && <ToolsView {...toolsProps} />/* hosts Dashboard/Scan/Review/Enroll */}
    {activeTab === "people"   && <ToolsView mode="people" {...toolsProps} />/* P4 → dedicated view */}
    {activeTab === "settings" && settings && <SettingsView {...settingsProps} />}
  </AppShell>
);
```
The `libraryProps`/`searchProps`/`toolsProps`/`photosProps` bags are the **same objects** already passed today — we move JSX, not handlers. Every `invoke()` / `window.crossAge.invoke` call stays exactly where it is.

### 3.2 Library screen (sectioned time-based grid)

**Layout — three regions inside the workspace:**

1. **Library header bar** (sticky, under topbar):
   - Left: scope title + live count ("All Photos · 24,318 items").
   - Center: **zoom spine** segmented control — `Years | Months | Days | All Photos` (maps `photoDateViewMode`). The Apple Library spine.
   - Right: density slider (`thumbnailSize`), square/aspect toggle (`thumbnailAspectMode`), Select button, `⋯` overflow (filters, sort).

2. **Sectioned virtualized time-grid** (reuse PhotosView grid @26314 + `photoVirtualGrid.ts`):
   - **Years:** one large cover tile per year, full-bleed, year overlay.
   - **Months:** clustered moments with location/date headers ("June 2024 · Lisbon").
   - **Days:** dense day clusters, hero tile + supporting grid.
   - **All Photos:** uniform square grid, sticky month headers (`photos-date-header`), right-edge fast-scroll scrubber.
   - Tile overlays (favorite, burst count, missing-original, person chips, utility badge) reused from 26416–26442.

3. **Selection action bar** (springs up from the bottom when ≥1 selected): Share/Export, Add to Album, Favorite, Hide, Delete, More — wired to existing bulk handlers + the homed export orphans.

**Interactions:** zoom transition = shared-element scale/crossfade (spring) on the focused tile, `⌘+`/`⌘-`/trackpad-pinch; fast-scroll scrubber shows a floating month/year bubble; click→lightbox, `Space`=quick-look, arrows navigate; multi-select via Select / `⌘A` / shift-range / `⌘`-click / marquee drag.

**States:**
- **Empty (no library):** vivid alive empty state (animated accent gradient orb, low-intensity reuse of boot Plasma Silk) + "Import photos" primary + "Scan a folder" secondary. Never a gray box.
- **Loading:** skeleton grid of shimmering rounded tiles at current density; month headers render as soon as counts arrive (matches existing virtualization), zero layout shift.
- **Filtered-to-empty:** "No photos match these filters" + Clear filters + active-filter recap chips.
- **Missing originals:** non-blocking "Some originals are offline — Relink folder" banner.

### 3.3 Search screen (unified: text + facets + on-device semantic AI + scopes)

The marquee Phase-1 feature; homes the orphaned `semantic_search_photos`.

**Layout:**
1. **Hero search field** (top, large, accent focus ring), autofocus. Placeholder "Search photos, people, places, things." A `Sparkles` **AI toggle** switches the *same query string* between literal-facet matching and on-device semantic ranking (`semantic_search_photos`). An "On-device" pill reassures privacy.
2. **Scope chips** (under field): `Top results · People · Pets · Places · Things · Media types · Dates · Albums · Keywords`. Selecting a scope filters composition + reveals scope facets.
3. **Suggestions / pre-query** (empty state): grouped rails from `photoSearchSuggestions.ts` — People & Pets (thumbnails), Places (map clusters), Things (OCR/object indexes), Recent searches, Saved Filters (`photoSavedSearch.ts`, with "promote to Smart Album"). Never blank.
4. **Facets panel** (collapsible): full filter inventory (keyword/media/person/status/quality/date/source/filetype/album/visibility/location/camera + toggles); active facets render as removable chips (`photoFilterChips.ts`).
5. **Results:** same virtualized grid component as Library (shared), with term highlighting (`photoSearchHighlights.ts`); grouped-by-type for Top results, single grid per scope. Selection enters the same action bar.

**Interactions:** debounced text-facet search; AI toggle re-ranks the same query via `semantic_search_photos`; clicking a People/Place suggestion deep-links (with Back); "Save this search" → Saved Filters; "Make Smart Album" hands off to the Album editor with the query prefilled. `⌘F`/`⌘K`/`/` focuses from anywhere.

**States:** pre-query = suggestion rails; **AI warming** = inline "Preparing on-device search…" pulse (literal results still appear immediately); **no results** = "No matches for '…'" + Try-AI CTA + alternative-scope chips; **semantic unavailable (model missing)** = graceful fallback to literal + one-tap "Enable on-device AI search" → Settings → Engine. Never a dead end.

### 3.4 Files to create / modify (Phase 1)

**Create:** the 10 `src/shell/*` + `src/views/LibraryView.tsx` files in §3.1, plus `tests/e2e/library.spec.ts`, `tests/e2e/search.spec.ts`, `tests/e2e/tools-scan-controls.spec.ts`, `tests/e2e/shell-nav.spec.ts`, `tests/shell_nav_units.mjs`.

**Modify (surgical):**
- `src/App.tsx`: widen `TabKey` (232); import `tabs`/`ROUTES` from `navModel` (329); replace inline sidebar+topbar+status+view block (~6287–6909) with `<AppShell>` composition; thread `initialActiveId`/`visibleRailSections` into the existing `<PhotosView>` mount (6577); wrap the ~20 `setActiveTab` call sites in `navigateTo()`. **No state/handler deletions.**
- `src/views/PhotosView.tsx`: add the two optional props (`initialActiveId`, `visibleRailSections`); seed `activeId` (1684) on mount; intersect `visibleRailSections` with `railSections` (2586). ~15 lines, additive.
- `src/i18n.ts`: add `nav.library/memories/albums/search/people/tools` across all 7 locales (keep old keys for reused views) so `check-localization.cjs` stays green.
- `src/types.ts`: extend `TabKey` union; add `PhotoSemanticSearchResult` type (no command-surface change).
- `src/styles.css`: `@import "shell/tokens.css"` first; add `.app-shell--v2`, sidebar zones, library-header, search-hero, selection-toolbar, scrubber classes (additive — do not rename classes the e2e specs select).

**Never touch (contract-critical):** `desktop/preload.cjs`, `desktop/main.cjs` allowlists, `crossage_fr/api_server.py`, `tests/command_contract.py`, `mcp/manifest.json`.

### 3.5 Migration approach that keeps all 245 commands wired

- **By construction:** `tests/command_contract.py` checks Python `_COMMAND_HANDLERS` ≡ `preload.cjs` ≡ `main.cjs` allowlists (with `INTERNAL_COMMANDS` exceptions); `ipc-security.spec.ts` asserts blocked commands → `E-IPC-BLOCKED-COMMAND`. **Neither inspects the renderer view layer.** Phase 1 adds **zero** commands, renames **zero**, removes **zero** handlers — it only adds UI that calls already-allowlisted `invoke()`. The three contract surfaces stay byte-identical → both guards green by construction.
- The orphan commands we surface (`semantic_search_photos`, `cancel_scan`, the 8 exports, the 4 key-frame, etc.) are **already** in `_COMMAND_HANDLERS` + the allowlist — orphaned in UI, not in contract.

---

## 4. AESTHETIC SYSTEM — HYBRID (Apple clarity + vivid alive accents)

Tokens live in `src/shell/tokens.css`, imported first by `styles.css` (additive; migrate incrementally).

### 4.1 Color & accent
```css
:root{
  /* Neutrals — Apple-grade, content-forward, dark-first w/ light parity */
  --bg-base:#0b0b0f; --bg-raised:#14141a; --bg-overlay:#1c1c24;
  --bg-base-light:#fafafa; --bg-raised-light:#ffffff;
  --hairline:rgba(255,255,255,.08); --hairline-strong:rgba(255,255,255,.14);
  --text-1:#f5f5f7; --text-2:#a1a1aa; --text-3:#6b6b76;

  /* Vivid accent — living violet→magenta, used SPARINGLY for intent */
  --accent:#7c5cff; --accent-2:#c44bff; --accent-ink:#fff;
  --accent-grad:linear-gradient(120deg,#7c5cff 0%,#c44bff 55%,#ff5ca8 100%);
  --accent-weak:color-mix(in oklab,var(--accent) 16%,transparent);

  /* Semantic */ --ok:#34d399; --warn:#fbbf24; --danger:#fb7185;
}
```
**Discipline (how vivid coexists with clarity): accent is earned, not ambient.** Content surfaces/grids/inspectors stay neutral and quiet. Accent appears only on: active nav, primary buttons (Import, AI-search), selection rings, focus rings, badges, and **alive moments** (Memories covers, empty-state orbs, the AI affordance). `--accent-grad` is reserved for hero/Memories/empty-state surfaces and the AI toggle; it never sits behind dense content. Rule of thumb: **one saturated thing per viewport** — photos provide the color, the chrome stays calm.

### 4.2 Spacing (4px base)
`--s-1:4 · --s-2:8 · --s-3:12 · --s-4:16 · --s-5:24 · --s-6:32 · --s-7:48 · --s-8:64`. Sidebar 248px; contextual rail 240px; topbar 56px. Grid gutter `--s-1` (Years) → `--s-3` (Days). Section rhythm `--s-5`/`--s-6` for Apple breathing room.

### 4.3 Typography (system stack: `-apple-system, "SF Pro", Inter`)
```
Display (year covers)   34/40  700  -0.02em
Title-1 (scope title)   22/28  700  -0.01em
Title-2 (section head)  17/24  600
Body                    13/18  400
Caption (meta, counts)  11/16  500  uppercase tracking .04em for labels
```
Counts/EXIF use tabular-nums in `--text-3`; date headers Title-2 with a Caption location sub-line.

### 4.4 Elevation / depth (soft, physical — not flat, not skeuomorphic)
```
--e-1:0 1px 2px rgba(0,0,0,.4)                          (cards, tile hover)
--e-2:0 8px 24px rgba(0,0,0,.45)                         (popovers, menus)
--e-3:0 24px 64px rgba(0,0,0,.55)                        (lightbox, modals, drawers)
```
Lightbox/modals use `--e-3` + `backdrop-filter:blur(20px)` for frosted Apple glass; a 1px top inner highlight on raised surfaces for the crafted edge. Selection = `--accent` 2px ring + `--accent-weak` fill (vibrant without recoloring thumbnails).

### 4.5 Motion (buttery springs — GPU transform/opacity only, reduced-motion aware)
```
--spring-fast: 180ms cubic-bezier(.22,1,.36,1)   /* taps, hovers, chips */
--spring:      260ms cubic-bezier(.22,1,.36,1)    /* tab/view change, selection bar */
--spring-slow: 420ms cubic-bezier(.16,1,.3,1)     /* zoom-level transitions, lightbox open */
```
- **Tab/view switch:** outgoing fades + 8px down, incoming fades + rises (`--spring`); sidebar active pill slides.
- **Library zoom:** shared-element FLIP scale on the focused tile (`--spring-slow`).
- **Selection bar:** springs up from the bottom edge.
- **Lightbox open:** shared-element zoom from the tapped tile (transform-based, `--spring-slow`).
- **Memories (the alive surface):** Ken-Burns drift on covers (scale 1.0→1.06 / 8s ease-in-out, looping), gradient sheen on hover.
- **`prefers-reduced-motion`:** all collapse to opacity-only fades. Motion is transform/opacity-only (no layout thrash), keeping `memory-soak`, `accessibility-keyboard`, and `button-regression` e2e specs green.

---

## 5. PHASE ROADMAP

| Phase | Delivers | Mechanism | New test files |
|---|---|---|---|
| **0 — Shell extraction (behavior-identical checkpoint)** | `AppShell`/`Sidebar`/`TopBar`/`StatusRow`/`navModel` render the *current* 6 tabs with old labels through the new shell. No user-visible change. **Safe checkpoint.** | Extract presentational JSX; state stays in App.tsx; behind a flag | `tests/e2e/shell-nav.spec.ts`, `tests/shell_nav_units.mjs` |
| **1 — IA flip + Library + Search** | Flip to 7-tab photos-first model (Library default); Tools hosts Dashboard/Scan/Review/Enroll verbatim; Memories/Albums/People project through rail. Build LibraryView (zoom spine, scrubber, selection bar) + SearchView (`semantic_search_photos` + facets + scopes). Wire scan pause/resume + status-row, and the 12 export/key-frame orphans into the Lightbox. | `ROUTES` map + 2 additive PhotosView props + one key-stable instance | `tests/e2e/library.spec.ts`, `tests/e2e/search.spec.ts`, `tests/e2e/tools-scan-controls.spec.ts` |
| **2 — Tools reorganization** | Tools graduates from legacy-body host to named sections (Overview / Scan / Import / Indexing / Repair / Media Operations). Surface remaining diagnostics orphans. | Re-parent existing bodies under sub-tabs | `tests/e2e/tools.spec.ts` |
| **3 — Memories + Albums dedicated views** | Promote from rail projection to first-class views: Memories cards + editor + slideshow + `export_photo_memory_movie`; Albums My/Folders/Smart + Places + Utilities + Saved-Filter→Smart-Album promotion. | Reuse PhotosView bodies the same way; dedicated headers | `tests/e2e/memories.spec.ts`, `tests/e2e/albums.spec.ts` |
| **4 — People & Pets dedicated view** | People/Pets grid + detail; Add Person (EnrollView) + coverage coach; Review queue (ReviewView) with lanes/bulk/reassign/notes/block-false-match/people-together/calibration label; Suggestions status. | Re-home EnrollView/ReviewView under People & Pets | `tests/e2e/people-pets.spec.ts` |
| **5 — Editing / export / Settings polish** | Lightbox edit-stack polish; export menu refinement; Settings group reorg (Matching/Engine/System/Data/Health/Performance/Accuracy Lab/Diagnostics) + Accuracy Lab orphan surfacing. | Cosmetic grouping; no contract change | `tests/e2e/settings-groups.spec.ts` |

Every phase: `npm run test:command-contract` + the button/IPC/workbench/localization/memory-soak/a11y e2e specs must stay green before merge.

---

## 6. RISKS + MITIGATIONS

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | **Touching the 245-command IPC contract** (the hard constraint) | Low | Phase 1 is renderer-only; adds/renames/removes **zero** commands. `command_contract.py` + `ipc-security.spec.ts` inspect Python≡preload≡main, never the view layer → green by construction. Pre-merge gate: `npm run test:command-contract`. Never edit preload.cjs/main.cjs/api_server.py. |
| R2 | **Breaking wiring while moving JSX out of the 15k-line App.tsx** | Medium | Extract by *move*, not rewrite. All state/handlers/`invoke()`/prop callbacks stay in App.tsx; shell components are presentational, fed by props. Phase 0 ships behavior-identical (old tabs through new shell) behind a flag as a verified checkpoint before any IA flip. |
| R3 | **Forking / re-mounting the 31k-line PhotosView** | Medium | Reuse as-is with two additive, default-preserving props. **One key-stable instance** across Library/Memories/Albums — never re-mounts, so grid/scroll/cache survive tab switches. `tests/photos_view.test.mjs` unaffected (additive props with defaults). |
| R4 | **e2e selectors break** (button-regression, workbench, packaged) | Medium | Carry existing `data-testid`s onto the new shell buttons; add new ones alongside. Don't rename existing CSS classes the specs select. Run the full e2e suite per PR. |
| R5 | **Localization gate fails** (`check-localization.cjs`, localization-layout.spec) | Medium | Add all new `nav.*` keys in all 7 locales in the same PR that introduces them; keep old keys for reused views. |
| R6 | **Motion regresses memory-soak / a11y** | Low | Transform/opacity-only springs, `prefers-reduced-motion` fallback to fades, no layout thrash; preserve `aria-current`, `aria-label="Primary navigation"`, focus order. |
| R7 | **Tools tab bloat** (heterogeneous content under one label) | Medium | Phase 1 hosts legacy bodies behind a clear segmented control; Phase 2 reorganizes into named sections (Overview/Scan/Import/Indexing/Repair/Media Operations) before it grows further. |
| R8 | **Scattered `setActiveTab` deep-links drift** during the IA flip | Medium | Centralize all ~20 call sites through `navigateTo({tab, photoActiveId?, searchQuery?})` so recognition→photos hops (e.g. `setActiveTab("photos")`@4468 → `navigateTo({tab:"library", photoActiveId:"lastImport"})`) are mapped in one place. |
| R9 | **Co-dev tree conflicts** (Codex shares the uncommitted tree) | Medium | Phase 1 work is isolated new files (`src/shell/*`, new views, new test files) — the Claude lane per the co-dev note. App.tsx edits are surgical and confined to the render block + `TabKey` + import lines. |
| R10 | **`semantic_search_photos` slower/unavailable** | Low | AI mode is a non-blocking toggle; literal results render immediately; explicit warming + model-missing fallback states (§3.3) ensure no dead end. |

---

**Recommendation: approve and build Phase 0 → Phase 1.** The mechanism (ROUTES map + two additive PhotosView props + one key-stable instance + `navigateTo()` wrapper, with a behavior-identical shell-extraction checkpoint first) is the lowest-risk path through the 15,216-line App.tsx and 31,391-line PhotosView.tsx, keeps all 245 commands wired by construction, and delivers the approved photos-first IA in the hybrid aesthetic with Library + Search fully wired and tested.

**Key paths:** `/Users/harshbishnoi/face/src/App.tsx` (232/329/1764/2417, render block 6287–6909, PhotosView mount 6577), `/Users/harshbishnoi/face/src/views/PhotosView.tsx` (activeId 1684, railSections 2586, PhotoRailSectionId 263), `/Users/harshbishnoi/face/tests/command_contract.py`, `/Users/harshbishnoi/face/tests/e2e/ipc-security.spec.ts`, `/Users/harshbishnoi/face/desktop/preload.cjs`, `/Users/harshbishnoi/face/desktop/main.cjs`, `/Users/harshbishnoi/face/src/views/photoRailVisibility.ts`, `photoExportPresets.ts`, `photoSearchSuggestions.ts`, `photoSavedSearch.ts`, `photoVirtualGrid.ts`, `photoFilterChips.ts`, `photoSearchHighlights.ts`, `/Users/harshbishnoi/face/src/i18n.ts`, `/Users/harshbishnoi/face/src/styles.css`.
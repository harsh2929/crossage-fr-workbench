# Design Spec — "Photos" Tab: Browse Photos as Folders

- **Date:** 2026-06-16
- **Status:** Approved (brainstorming complete) — pending implementation plan
- **Branch context:** `feat/2026-unlock-build`
- **Author:** brainstorming session (Claude + user)

## 1. Goal

Add a new top-level **Photos** tab that lets users browse their entire photo
collection *as folders*, so they never need their device's OS Photos app:

- The first folder, **All Photos**, contains every photo/video discovered across
  all scanned and watched locations.
- The remaining folders are **people** ("folks") — one folder per enrolled
  person — plus auto-grouped **Unknown People** folders for detected-but-unmatched
  faces.

This is fundamentally a **presentation layer over data the app already has**. The
face-recognition pipeline already discovers every file, generates full-image
thumbnails (including HEIC/RAW/video), and clusters unknown faces. The work is a
read-only query surface + a clean, performant gallery UI.

## 2. Requirements (decided during brainstorming)

1. **All Photos scope:** *Every* image/video file discovered in scanned/watched
   locations — faces or not. Includes safety-`protected` files (forensic/complete
   view; **no safety exclusion** — explicit user decision).
2. **Person folder contents:** A person's photos = matches that are **accepted OR
   high-confidence**. Pending / low-confidence / rejected matches are excluded.
3. **Unknown faces:** Surface as **auto-grouped clusters** ("Unknown Person 1,
   2, …"), reusing the clustering already produced at scan time.
4. **Actions (v1):** **Viewing only** — folder browsing + grid + full-size
   lightbox. No export, reveal-in-OS, or re-assignment in v1 (deferred, §13).
5. **Layout:** **Sidebar + gallery** (macOS Photos style) — a persistent left rail
   of folders, a virtualized photo grid on the right.

## 3. Non-goals / deferred

- Export / copy-out of photos.
- Open-in-OS / reveal-in-Finder.
- Re-assigning or correcting a photo's person from the gallery.
- Editing, deleting, favoriting, albums beyond people/unknown.
- A new "by location/folder" axis (the data supports it later via
  `source_folder_summary`, but it is out of scope here).

These are intentionally excluded for v1 and are easy to add later behind the same
view (§13).

## 4. Architecture & data sources

Chosen approach: **backend-grouped, thin frontend** (Approach A). The Python
backend owns grouping, dedup, counting, and budgeted thumbnail generation; the
frontend is a virtualized renderer that pages results. Rationale: scales to large
libraries, reuses existing SQLite indexes and the Review tab's proven paging
pattern, and avoids growing the 12.9k-line `src/App.tsx`.

Every folder maps to data that **already exists** — no new index, no new ML:

| Folder | Source table / store | Selection rule |
|---|---|---|
| **All Photos** (pinned first) | `scan_files` manifest (`crossage_fr/store/workspace_db.py:806` `record_scan_file()`) | All rows that point to a real, viewable media file on disk, deduped by `path`. Includes safety-`protected` files. Excludes non-media rows (hard errors / excluded / non-existent paths). |
| **Person folder** (one per enrolled person) | `review_candidates` (`workspace_db.py:186-231`; in-memory `ProjectState.candidates`, `crossage_fr/enroll/manager.py:162`) | `person_name == <person>` AND match is **accepted OR high-confidence band**; deduped by `source_path`. |
| **Unknown Person N** (one per cluster) | `review_candidates` | `person_name LIKE 'Unmatched cluster%'`, grouped per distinct cluster name. Created at scan time by `flush_unmatched()` (`manager.py:1094-1157`, `:1741`). |

**Dedup semantics:** a single photo can yield multiple face candidates. It must
appear as **one tile** within any one folder (dedup by source path), while still
appearing in *each* relevant person/unknown folder. Dedup happens in the backend.

**"High-confidence band" definition:** `ReviewCandidate` carries a `status`
(accepted / pending / rejected) and a calibrated confidence `band`/`score`
(`crossage_fr/models.py:73-130`). The person-folder predicate is:

> `status == accepted` **OR** `band ∈ {top/high-confidence tier}`

The exact `status` enum values and the high-confidence band string must be pinned
against `crossage_fr/models.py` and the bands taxonomy during implementation
(see §14, verification list). The predicate is implemented once in the backend so
the UI never reasons about confidence.

## 5. Backend design (Python) — two new read-only commands

Both are JSON-RPC commands over the existing `backend:invoke` pipe (no new IPC
channel). They mirror the shape of the existing `query_candidates`
(`crossage_fr/api_server.py:3163-3309`) so the frontend's fetch/paging code is
familiar.

### 5.1 `list_photo_folders`
Returns the folder rail contents in display order.

```
list_photo_folders() ->
  {
    folders: [
      {
        id: string,            # "all" | "person:<name>" | "unknown:<cluster>"
        kind: "all" | "person" | "unknown",
        name: string,          # "All Photos" | person name | "Unknown Person N"
        count: number,         # deduped photo count
        coverPreviewPath: string | null,   # one representative preview for the tile
        coverPreviewUrl: string | null
      },
      ...
    ]
  }
```

- "All Photos" count from `scan_files` (deduped by path).
- Person/unknown counts via a grouping tally over `review_candidates` keyed on
  `person_name`, reusing the aggregation pattern from `source_folder_summary`
  (`manager.py:6371-6441`) but on the person axis.
- Cover = one already-existing preview per folder if available (cheap; do **not**
  force-generate covers here).
- Order: All Photos first, then people (alphabetical or by count — pick count,
  descending, to surface the richest folders), then Unknown clusters.

### 5.2 `list_photo_folder_items`
Returns one paginated page of photos for a folder.

```
list_photo_folder_items({
  folderId: string,
  offset: number = 0,
  limit: number = 100,
  previewBudget: number = 64       # clamped to [0, 64] server-side
}) ->
  {
    total: number,
    offset: number,
    limit: number,
    returned: number,
    items: PhotoItem[]
  }
```

- Routing by `folderId`:
  - `all` → query `scan_files`, deduped by `path`, ordered by capture/scan time
    (newest first), paginated.
  - `person:<name>` → `review_candidates` filtered by person + high-confidence
    predicate (§4), deduped by `source_path`.
  - `unknown:<cluster>` → `review_candidates` where `person_name == <cluster>`.
- **Thumbnails:** for each item in the page lacking a cached preview, generate one
  via the existing `preview_path_for(create=True)` →
  `write_preview_image()` (`crossage_fr/ingest/image_io.py:273`, full-image 768px
  JPEG, HEIC/RAW/video-aware), **bounded by `previewBudget` (≤64)**. Items beyond
  the budget return `previewPath: null` and the frontend requests them on a
  subsequent scroll page. This is the same budget mechanism as
  `query_candidates` (`api_server.py:3174`, `_candidate_state_row:3311-3314`).

### 5.3 `PhotoItem` shape (backend → frontend)
Reuses fields already present on `ReviewCandidate` (`src/types.ts:296-330`) plus a
stable id derived from the source path for All-Photos rows that have no candidate:

```
PhotoItem {
  id: string;                 # candidate_id, or hash of source path for faceless rows
  sourcePath: string;
  sourceUrl: string;          # vintrace-media:// URL to original
  previewPath: string | null;
  previewUrl: string | null;  # vintrace-media:// URL to generated 768px JPEG
  mediaKind: "image" | "video";
  captureDate: string | null;
  personName: string | null;
}
```

## 6. IPC & allowlist (mandatory two-sided step)

The two new commands must be added to **both** allowlists or they are silently
blocked at runtime / fail CI:

- `desktop/main.cjs` → `TRUSTED_BACKEND_COMMANDS` (`:372-476`).
- `desktop/preload.cjs` → matching list (`:3-107`).

A `command_contract.py` test asserts the two lists are identical (regression from
commit `cec1be5`). Add the new commands to both, and extend the contract
test/fixtures accordingly.

No new custom protocol is needed — images continue to flow over the existing
privileged `vintrace-media://` scheme (registered `desktop/main.cjs:480`, handled
`:2046-2055`). Candidate and preview paths are already in `currentTrustedPaths()`;
`scan_files` source paths and their generated previews must likewise resolve as
trusted (they live under scanned roots + the workspace `previews/` dir, both
already trusted — verify for All-Photos rows during build, §14).

## 7. Frontend design (React)

### 7.1 Tab wiring (`src/App.tsx`)
- Add `"photos"` to the `TabKey` union (`:147`).
- Add a tab entry in the tabs config (`:244-250`):
  `{ key: "photos", labelKey: "nav.photos", icon: <Images/> }` (import `Images`
  from `lucide-react`). The nav JSX auto-maps it (`:4715`).
- Add the render branch after the `review` block (insert near `:4982`, before
  `settings` at `:4983`):
  `{activeTab === "photos" && !workspaceLocked && <PhotosView .../>}`.
- Optional: a `navMeta.photos` badge (`:4691-4697`) showing the All-Photos count.
- Add a `nav.photos` i18n key for every locale (search the translations object for
  `"nav.dashboard"`), or `t()` renders the raw key.

### 7.2 New component — `src/views/PhotosView.tsx`
Extract into its **own file** (not a 6th nested function inside the ~12.9k-line
`App()`; existing views like `ReviewView` ~1555 lines and `ScanView` ~1314 lines
are nested — this view starts clean and sets a better precedent without refactoring
the others). It receives the backend-invoke function and workspace state as props.

Responsibilities:
- On mount / workspace change: call `list_photo_folders`, render the left rail.
- On folder select: page `list_photo_folder_items` into a **virtualized grid**.
- Maintain selected folder, loaded pages, and an in-flight preview budget per page.
- Open the lightbox on tile click.

### 7.3 Layout & reuse
- **Left rail:** folder list with name + count; reuse `PersonCard` styling
  (`App.tsx:6797`) for the people entries; "All Photos" pinned at top, Unknown
  clusters grouped under a "People" / "Unknown" header.
- **Grid cell:** reuse `FaceThumb` (`App.tsx:6665-6671`) — already
  `loading="lazy" decoding="async"` with an error/icon fallback; render
  `previewUrl || sourceUrl`.
- **Lightbox:** reuse `ImagePreview` (`App.tsx:12885`) and Review's side-by-side
  pane styling for full-size view with arrow-key next/prev.
- **CSS:** add a `.photos-page` split-layout block to `src/styles.css`, cloning the
  `.review-page` grid (`:~1567-1751`).

## 8. Image serving & performance (the one real engineering problem)

- **Virtualized grid** (only render visible tiles) is mandatory — a folder may hold
  thousands of photos.
- **Budgeted lazy paging:** request the next page (`limit ≈ 100`, `previewBudget
  ≤ 64`) as the user scrolls; cached previews come back free, uncached ones
  generate up to the budget, the rest fill in on the next page.
- **Non-web-native originals:** Chromium cannot render HEIC/RAW/most video. The
  **lightbox must serve the generated preview**, never the raw original, for those
  formats. For v1 the 768px preview is acceptable in the lightbox; a larger
  "display" rendition (e.g. 2048px) is a possible later enhancement (§13).
- **Trust refresh:** `vintrace-media://` trust is cleared on workspace switch/lock;
  the view must re-fetch folder/item data (and thus fresh URLs) on those events.
- **Optional later:** a background "preview-warming" pass so a large library feels
  instant on first open.

## 9. Types (`src/types.ts`)

- Add `PhotoFolder` and `PhotoItem` (§5.1, §5.3).
- Extend the invoke/`CrossAgeApi` typing for `list_photo_folders` and
  `list_photo_folder_items`.
- Reuse `ReviewCandidate` (`:296-330`) field names where possible for `PhotoItem`.

## 10. Edge cases & explicit decisions

- **Safety-protected files:** included in All Photos (user decision). If a protected
  file was physically quarantined/moved and its path no longer resolves, it is
  skipped as non-viewable (data validity, not safety).
- **Multi-face photo:** one tile per folder (dedup by source path); appears in
  multiple person folders.
- **Empty folders (default):** hide enrolled people who have zero
  accepted/high-confidence photos, to keep the rail clean. Revisit only if users
  want to see all enrolled people regardless of photo count (§14 item 5 confirms
  this default).
- **Live updates:** if a scan/watch adds photos while the tab is open, counts can go
  stale. v1: refresh on folder re-select / tab re-entry. (No live push in v1.)
- **Videos:** represented by their extracted poster frame
  (`crossage_fr/ingest/video_io.py:211-286`); lightbox shows the poster (no inline
  playback in v1).
- **Workspace locked:** the tab renders nothing when `workspaceLocked` (matches
  existing views).

## 11. Testing

- **Python unit tests** (mirror `tests/enroll_paths_units.py`):
  - All-Photos dedup by path; non-media/unresolvable rows excluded.
  - Person filter = accepted OR high-confidence; pending/rejected excluded.
  - Unknown-cluster grouping from `person_name LIKE 'Unmatched cluster%'`.
  - Paging math (`total`/`offset`/`returned`), `previewBudget` clamp ≤ 64.
  - Cover selection never force-generates previews.
- **Contract test:** extend `command_contract.py` to assert both new commands are
  present and identical in `main.cjs` and `preload.cjs`.
- **Frontend test** (mirror `tests/people_grouping.test.mjs`): folder-list ordering
  (All Photos first), virtualization paging requests, URL fallback
  (`previewUrl || sourceUrl`).

## 12. Build sequence

1. Backend: `list_photo_folders` + unit tests.
2. Backend: `list_photo_folder_items` (routing, dedup, budgeted previews) + tests.
3. IPC: add both commands to both allowlists; update `command_contract` test.
4. Types: `PhotoFolder`, `PhotoItem`, invoke typings.
5. Frontend: `src/views/PhotosView.tsx` (rail + virtualized grid + paging) and CSS.
6. Frontend: wire the `"photos"` tab into `App.tsx` (union, config, render branch,
   i18n, optional badge).
7. Frontend: lightbox integration (reuse `ImagePreview`).
8. Verify end-to-end against a real workspace; check HEIC/RAW/video render via
   generated previews; confirm large-folder scroll stays smooth.

## 13. Deferred enhancements (post-v1)

- Export / copy-out (e.g. "export all of Alice").
- Open-in-OS / reveal-in-Finder.
- Re-assign person from the gallery (write path; corrects mistakes in-place).
- Larger lightbox display rendition (2048px) and inline video playback.
- Background preview-warming job.
- "By location" folder axis using `source_folder_summary`.
- Live updates pushed from active scans/watch.

## 14. To verify during implementation (open technical confirmations)

1. Exact `ReviewCandidate.status` enum values and the high-confidence `band` string
   in `crossage_fr/models.py` (pins the person-folder predicate, §4).
2. Confirm `scan_files` source paths + their generated previews resolve as trusted
   under `currentTrustedPaths()` for All-Photos rows (may need to add scanned roots
   to the trusted set if not already covered, §6).
3. Confirm `query_candidates` is already in both allowlists (precedent) and the
   exact insertion points / format in each list.
4. Confirm the `scan_files` status/phase values that denote a *viewable* media row
   vs. a hard error / excluded / non-media row (defines the All-Photos filter).
5. Confirm whether enrolled people with zero qualifying photos should be hidden or
   shown (§10 empty-folder decision).

## 15. Key file references

- Frontend: `src/App.tsx` (`:147`, `:244`, `:4691`, `:4715`, `:4982`, `:6665`,
  `:6797`, `:12885`), `src/types.ts` (`:296-330`), `src/styles.css`
  (`:1567-1751`), `src/lib/peopleGrouping.ts`, new `src/views/PhotosView.tsx`.
- Electron: `desktop/main.cjs` (`:372-476`, `:480`, `:2046-2055`),
  `desktop/preload.cjs` (`:3-107`).
- Backend: `crossage_fr/api_server.py` (`:3163-3309`, `:3174`),
  `crossage_fr/enroll/manager.py` (`:162`, `:1094-1157`, `:6371-6441`,
  `:6434-6488`), `crossage_fr/store/workspace_db.py` (`:80-107`, `:186-231`,
  `:806-855`, `:143-150`), `crossage_fr/ingest/image_io.py` (`:251-261`, `:273`),
  `crossage_fr/ingest/video_io.py` (`:211-286`), `crossage_fr/cluster/clusterer.py`,
  `crossage_fr/models.py` (`:73-130`).
- Tests: `tests/enroll_paths_units.py`, `tests/people_grouping.test.mjs`,
  `command_contract.py`.

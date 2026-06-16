# Redesigned "Add a face" flow + people gallery (Enroll tab)

**Date:** 2026-06-16
**Status:** Implemented (TDD; backend + IPC + UI + tests green)
**Branch:** feat/2026-unlock-build

## Problem

The current Enroll tab ([App.tsx:6563-6685](../../src/App.tsx)) is unintuitive:
- Two competing add mechanisms on one screen (single folder picker + a separate triple
  "age folders" widget) with no guidance.
- Name + age + folder all required up front, no walkthrough.
- The "Saved face photos" panel is a flat table (one row per photo: filename + quality
  number) — no thumbnails, no grouping by person, no per-person edit/delete. You can't
  *see* the faces you added.
- No way to pick individual files, no drag-drop, no preview of what's being added.

## Decisions (locked with user)

| Decision | Choice |
|---|---|
| Gallery home | **Redesign the Enroll tab** — guided add panel + visual people gallery, one tab. |
| Add methods | Individual files (multi-select dialog) + folder + **drag-and-drop drop zone**. |
| Age tagging | **One flow, optional age tag** per batch; remove the triple age-folder widget. |

## What already exists (reuse, don't rebuild)

- **Thumbnails:** `decorateState` in [main.cjs:1800-1810](../../desktop/main.cjs) already converts
  every reference's `previewPath`→`previewUrl` and `sourcePath`→`sourceUrl` via the
  `vintrace-media://` protocol. Gallery thumbnails = `ref.previewUrl || ref.sourceUrl`. No
  backend work for reference thumbnails.
- **CRUD commands:** `delete_reference` (refId), `delete_person` (personName),
  `rename_person` (oldName,newName), `clear_references` — all already allowlisted.
- **Preview generation:** `prepare_previews` + cache; previews warm on dashboard load.
- **Folder analysis:** `analyze_folder` returns `imageSamples: string[]` — free sample
  thumbnails for folder staging.

## Backend changes (small, mirror existing patterns)

1. **`enroll_paths` command** — new. Enroll a list of paths under a person/age. Reuses
   `enroll_folder`'s per-image embed/store loop; **expands any directory** in the list
   (via `iter_image_paths` with the config-exclusion hook) so individual files, a dropped
   folder, and a mix all funnel through one command. `enroll_folder` stays (used by
   `enroll_age_groups`). Honors consent + model-compat like `enroll`.
   - `ProjectState.enroll_paths(person_name, age_bucket, paths, engine, recursive=True)` in
     enroll/manager.py — refactor: extract the per-image body of `enroll_folder` into a
     shared `_enroll_one(path, person, age, engine, known_hashes)` used by both.
   - `_cmd_enroll_paths` in api_server.py; register in `_COMMAND_HANDLERS`.
   - Add `enroll_paths` to `TRUSTED_BACKEND_COMMANDS` in **both** preload.cjs and main.cjs;
     add to the path-grant list next to `enroll`.
   - Returns `{ added, errors, state }` (same shape as `enroll`).
2. **`dialog:choose-images`** — `showOpenDialog` with `["openFile","multiSelections"]` +
   image/video extension filters → preload `chooseImages(): Promise<string[]>`; grants each
   picked path (`grantUserPath`) so the media protocol can serve its preview.
3. **Drag-drop path resolution** — preload exposes `getDroppedPaths(files): string[]` using
   Electron 39 `webUtils.getPathForFile`, and `mediaUrlFor(path): string` (so the renderer
   can build a `vintrace-media://` URL for a staged file). A new
   `ipcMain.handle("media:grant-paths", paths)` grants dropped/staged paths for the protocol.
   (Folder vs file is irrelevant to the renderer — `enroll_paths` classifies + expands.)

## Frontend

### Layout — redesigned Enroll tab (replaces EnrollView body)
```
┌─ Add a person ─────────────────────┐   ┌─ People you've added ──────────────────────┐
│ ① Who is this?                     │   │  [search names…]        3 people · 28 photos │
│   [ Name… ]   Age [ Auto ▾ ]       │   │ ┌────────────────────────────────────────┐  │
│ ② Add their photos                 │   │ │ Jane Doe        child·teen·adult     12 │  │
│  ┌────── drop zone ─────────────┐  │   │ │ [▢][▢][▢][▢][▢] +7   ✎  ⤢ add  🗑       │  │
│  │ ⬇ Drag photos or a folder    │  │   │ └────────────────────────────────────────┘  │
│  │ [Choose photos][Choose folder]│ │   │ ┌────────────────────────────────────────┐  │
│  └──────────────────────────────┘  │   │ │ John Roe        adult                 9 │  │
│ ③ Review & add                     │   │ │ [▢][▢][▢][▢] +5     ✎  ⤢ add  🗑        │  │
│  [▣][▣][▣]… staging (x to remove)  │   │ └────────────────────────────────────────┘  │
│  [ ✓ Add 6 photos to "Jane" ]      │   └──────────────────────────────────────────────┘
└────────────────────────────────────┘
```

### Add flow (the walkthrough)
Three quiet numbered steps. Name (optional age tag) → feed photos via drag-drop / Choose
photos / Choose folder → items land in a **staging tray** of thumbnails *before* committing.
Individual files preview via `mediaUrlFor`; a folder previews `analyze_folder.imageSamples`
+ a "+N more" count. Remove any with ×. **"Add N photos to 'Name'"** calls `enroll_paths`;
result toast uses existing `added`/`errors` (*"Added 6 · 1 skipped (no face found)"*).

### People gallery + CRUD (right)
References grouped by `person_name` into cards: face thumbnails, age-coverage chips
(child/teen/adult), photo count, actions → **rename** (`rename_person`), **add more**
(prefills the add panel name + focuses it), **delete person** (`delete_person`),
per-thumbnail **delete photo** (`delete_reference`). Name search filter. Expand a card to
see all photos.

### Components & pure logic
- In App.tsx (repo convention = components in the one file): `AddPersonPanel`,
  `StagingTray`, `PeopleGallery`, `PersonCard`, `FaceThumb`. Replaces `EnrollView` body and
  the triple age-folder widget; existing `ReferenceCoverageCoach` age logic folds into card
  chips. The Enroll-side `SubfolderPicker` is removed (folder-add enrolls recursively;
  the scan-side picker stays — exclusion trees are overkill for "add a few photos").
- `src/lib/peopleGrouping.ts` — **pure, unit-tested**: `groupReferencesByPerson(refs)` →
  `Person[]` (name, photos[], ageCoverage, count, sorted), `filterPeople(people, query)`,
  `ageCoverageOf(photos)`. TDD'd like `folderTreeSelection.ts` (esbuild node test).

### Staging model
Staging holds `{ path, kind: "file" | "folder", previewUrl, sampleCount? }[]`. Files: one
entry each (preview via mediaUrlFor). Folder: one entry with sample thumbnails + count from
`analyze_folder`. Add → `enroll_paths({ personName, ageBucket, paths: staged.map(s=>s.path) })`.
Reset staging on success. New ephemeral state; cleared on tab change.

## Testing (TDD)
- `tests/enroll_paths_units.py` — enroll a list of files; a folder in the list expands;
  mixed files+folder; dedup by hash across calls; non-image paths ignored; config-excluded
  dirs skipped; honors `recursive`.
- `tests/people_grouping.test.mjs` — grouping, age coverage, count, name filter, sort
  (esbuild-transpiled pure module).
- `tests/command_contract.py` parity covers the new `enroll_paths` allowlist entry.
- `package.json`: `test:enroll-paths`, `test:people-grouping` scripts.
- Verify: `tsc --noEmit`, `vite build`, regressions (`edge_cases`, `pipeline_smoke`).

## 2026-ready UI polish (within the app's existing design system)
Reuse design tokens (`--accent`, `--glass`, `--separator`, `--shadow`, etc.). Distinctive,
not generic: soft card surfaces with subtle depth, a clear drag-over highlight state on the
drop zone, smooth thumbnail grid, empty states that teach ("Add your first person"), tactile
hover/active on cards and thumbnails, accessible focus rings, reduced-motion friendly.

## Out of scope (v1)
- Per-file live "face found / not found" streaming during enroll (use aggregate result).
- Re-tagging an existing reference's age (delete + re-add).
- Merging two people / drag-between-cards.

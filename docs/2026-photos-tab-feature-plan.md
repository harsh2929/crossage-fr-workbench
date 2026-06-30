# 2026 Photos Tab Feature Plan

Status legend: `[ ]` not started, `[~]` in progress, `[x]` implemented and covered by focused checks.

## Goal

Turn the Photos tab from a basic gallery into a smart workspace for organizing scanned media, custom people-based albums, review handoff, and bulk file actions.

## Feature Checklist

- [x] Baseline Photos tab
  - [x] `All Photos` rail entry backed by scanned media.
  - [x] Person folders backed by accepted or high-confidence matches.
  - [x] Unknown cluster folders.
  - [x] Paged grid and keyboard lightbox.

- [x] Custom albums
  - [x] Persist album definitions in SQLite.
  - [x] Create/edit/delete albums from the Photos rail.
  - [x] Include and exclude specific people.
  - [x] Choose a cover from the lightbox.
  - [x] Description field.
  - [x] Duplicate album.
  - [x] Clear album cover.
  - [x] Include/exclude chips in the album header.
  - [x] Rule preview count.

- [x] Smart album rules
  - [x] Filter by review status.
  - [x] Filter by date range.
  - [x] Filter by folder/path.
  - [x] Filter by image/video media type.
  - [x] Filter by minimum match score.
  - [x] Filter by minimum photo quality.
  - [x] Filter by whether a video has extracted match frames.

- [x] Album validation
  - [x] Warn when no photos match.
  - [x] Warn when excluded people remove all included photos.
  - [x] Warn when a chosen cover no longer matches the album.

- [x] Timeline and sort controls
  - [x] Sort newest, oldest, scan date, match strength, person count, quality, filename.
  - [x] Group photos by date/month headers.

- [x] Person presence overlay
  - [x] Tile chips for matched people.
  - [x] Lightbox person list with confidence/status.
  - [x] Quick jump from Photos/lightbox to Review.

- [x] Bulk album actions
  - [x] Select photos in the grid.
  - [x] Export selected photos.
  - [x] Copy selected source files.
  - [x] Move selected source files.
  - [x] Create a media bundle from selected review matches.
  - [x] Send selected review matches to Review.

- [x] Smart defaults
  - [x] Suggest "Alice without Bob" style albums.
  - [x] Suggest videos with matches.
  - [x] Suggest high-confidence photos.
  - [x] Suggest needs-review photos.
  - [x] Suggest unknown clusters.
  - [x] Suggest recently scanned photos.

## Implementation Notes

- Keep album matching in the Python API so counts, rail covers, validation, and paged items share the same rules.
- Photos are deduped by source media path inside a folder/album.
- Existing candidate media actions already handle copy/move/trash for review rows and remove moved review rows from the index; Photos bulk actions should reuse that where candidate IDs are available.
- Path-only scanned media still needs export/copy support because All Photos may include media with no face candidate.

## Verification Log

- Existing focused checks already passed before this phase:
  - `python3 -m py_compile crossage_fr/enroll/manager.py crossage_fr/api_server.py crossage_fr/store/workspace_db.py`
  - `npm run test:photo-folders`
  - `npm run test:command-contract`
  - `npm run build`
  - `npm run test:edge`
- Re-run focused backend/UI/build checks after each feature group lands and update this log.
- 2026-06-19 Photos feature pass:
  - `python3 -m py_compile crossage_fr/api_server.py crossage_fr/store/workspace_db.py tests/photo_folders_units.py`
  - `npm run test:photo-folders`
  - `npm run test:photos-view`
  - `npm run build`
  - `npm run test:command-contract`
  - `npm run test:edge`
  - `npm test` (full scripted suite exited 0; e2e reported 2 passed, 6 skipped by environment flags)
  - `git diff --check -- docs/2026-photos-tab-feature-plan.md crossage_fr/api_server.py crossage_fr/store/workspace_db.py desktop/main.cjs desktop/preload.cjs src/App.tsx src/types.ts src/views/PhotosView.tsx src/styles.css tests/photo_folders_units.py tests/edge_cases.py`

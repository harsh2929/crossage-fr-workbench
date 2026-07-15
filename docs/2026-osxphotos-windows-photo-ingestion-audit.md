# 2026 osxphotos and Windows Photo Ingestion Audit

Audit date: 2026-07-10

Status: implemented and verified. Apple Photos remains read-only; Windows uses the folder-native path described below.

## Executive Verdict

`RhetTbull/osxphotos` is a strong fit for Vintrace as an optional macOS-native Apple Photos import and sync adapter. It should not replace Vintrace's local `photo_assets` catalog. The right use is to read Apple Photos library structure and metadata with much higher fidelity than direct `.photoslibrary` package scanning, then feed that data through the existing Vintrace import, album, metadata, people, media-pair, search, and repair surfaces.

The highest-value unlock is not "copy files from Apple Photos." Vintrace already has file and folder import. The unlock is Apple Photos library intelligence:

- stable Apple asset IDs and library paths
- original, edited, RAW, and Live Photo component paths
- titles, captions, dates, favorites, hidden/deleted state, keywords, albums, folders, and import provenance
- people/person labels and face regions, imported as consented metadata hints, not autonomous identity decisions
- places, reverse-geocoded place names, EXIF, camera/lens details, visual labels, detected text, and search metadata
- iCloud/missing-original state and export fallbacks
- incremental sync/diff state

For Windows, there is no equally clean modern Microsoft Photos equivalent to `osxphotos`. Microsoft says the People tab and face grouping are not available in the new Photos app. The Windows strategy should be folder-native: use existing Windows Pictures/Camera Roll/Saved Pictures/OneDrive/DCIM discovery, read portable EXIF/IPTC/XMP/MWG people metadata, and borrow architecture ideas from local-first Windows-capable photo managers such as Lap and mature cross-platform DAMs such as digiKam. Do not bet the product on reverse-engineering the Windows Photos app database.

## Implementation Completion

The full read-only architecture in this audit is now implemented:

- Shared contracts, sensitive-scope enforcement, normalization, adapters, catalog persistence, and orchestration live in `crossage_fr/photo_sources/`.
- `osxphotos==0.76.1` is pinned only for Darwin. The adapter imports it lazily, reports dependency/version failures, discovers system/last-used libraries, maps metadata and variants, and never performs implicit Photos/iCloud export.
- Windows has no `osxphotos` dependency. It discovers Pictures, Camera Roll, Saved Pictures, and OneDrive Pictures, streams folders, and reads embedded or sidecar EXIF/IPTC/XMP plus MWG/Microsoft people regions.
- Workspace schema version 5 adds external sources and IDs, album/keyword provenance, pending external people hints, and durable preview/import/sync/export jobs. Startup preflight also migrates old `review_candidates` tables before priority indexes are created.
- The API, Electron allowlists/path grants, renderer types, and Photos rail expose status, discovery, preview, referenced or managed import, sync, selected Apple export, retry, cancel, dismiss, recovery, and progress.
- Preview, import, sync, and export can run through the persistent worker. The renderer always uses the job path for preview so opening a large Apple database never blocks the dispatch loop.
- The import sheet uses a top-level portal, an opaque light/dark surface, explicit sensitive and iCloud consent, bounded samples, and responsive desktop/narrow layouts.
- Provider metadata is recursively stripped of unselected people, GPS/place, sharing, comment, and like fields so sensitive data cannot leak through nested EXIF/XMP payloads.
- `THIRD_PARTY_NOTICES.md` carries the upstream MIT notice and is included in Electron resources. PyInstaller collects the required macOS package data and dynamic modules only on Darwin.

Verification completed on 2026-07-10:

- Adapter, service, API, migration, command-contract, desktop-script, renderer, type, style, 10k/50k/100k scale, and no-network tests pass.
- A real Electron E2E test previews and imports a folder/XMP source, verifies consent gating and persistent jobs, and checks desktop plus 390 px layout bounds.
- The PyInstaller executable reports Apple Photos available with `osxphotos 0.76.1` outside the virtual environment.
- The unsigned unpacked macOS app launches with the frozen backend, includes the notice, answers `apple_photos_status`, scans a fixture, and exports diagnostics.

## Sources

External sources used:

- `osxphotos` overview: https://rhettbull.github.io/osxphotos/overview.html
- `osxphotos` Python API: https://rhettbull.github.io/osxphotos/API_README.html
- `osxphotos` package overview: https://rhettbull.github.io/osxphotos/package_overview.html
- `osxphotos` CLI reference: https://rhettbull.github.io/osxphotos/cli.html
- `osxphotos` GitHub README and license: https://github.com/RhetTbull/osxphotos
- Microsoft Photos face grouping support note: https://support.microsoft.com/en-us/windows/ai/ai-apps/group-photos-by-faces
- Lap GitHub and site: https://github.com/julyx10/lap and https://julyx10.github.io/lap/
- digiKam site and manual: https://www.digikam.org/about/ and https://docs.digikam.org/en/maintenance_tools/maintenance_faces.html

Local repo evidence used:

- `docs/2026-apple-photos-local-gap-audit.md`
- `docs/2026-photos-tab-feature-plan.md`
- `docs/2026-07-07-full-stack-audit-final.md`
- `crossage_fr/api_server.py`
- `crossage_fr/store/workspace_db.py`
- `desktop/main/photo-sources.cjs`
- `src/App.tsx`
- `src/views/PhotosView.tsx`
- `src/views/photoImportAccess.ts`
- `src/types.ts`
- `requirements.txt`
- `requirements-production.txt`

## Current Vintrace Photo Surface

Vintrace already has the local photo-library spine needed to absorb an Apple Photos adapter:

- `photo_assets` is the canonical asset table. It stores stable asset IDs, unique source paths, source kind, file signatures, hashes, media kind, dimensions, duration, capture date, scan run, missing status, and open-ended `metadata_json`.
- `photo_asset_metadata`, `photo_asset_locations`, `photo_keywords`, `photo_asset_keywords`, `photo_asset_people`, `photo_albums`, `photo_album_folders`, `photo_album_items`, `photo_media_pairs`, `photo_ocr_blocks`, `photo_object_tags`, `photo_edit_stacks`, and `photo_search_fts` already cover most Apple Photos concepts.
- `photo_import_sessions` and `photo_import_failures` already preserve provenance, storage mode, source kind, root path, failure rows, and recovery handling.
- `import_photos` already supports referenced vs managed imports, managed root selection, keep-folder organization, import warnings, source kind/label/detail, failure records, and audit logging.
- The desktop source detector already suggests Apple Photos package paths on macOS and Windows-style Camera Roll, Saved Pictures, and OneDrive Pictures on Windows.
- The renderer already stages imports through a pending review flow, shows access guidance for Apple Photos library packages and OS-protected folders, and routes external `photos-import` payloads into the same review flow.
- The July 2026 full-stack audit still flags "system photo-library integration" as absent and warns that large-library reads must stay page/bucket bounded.

The important current limitation is explicit in the existing Apple Photos audit: Vintrace treats `.photoslibrary` as a package of local files, not a native PhotoKit or Apple Photos database client. `osxphotos` is the missing read adapter for that gap.

## What osxphotos Can Contribute

The `osxphotos` project provides both a Python API and a CLI for querying and exporting Apple Photos libraries. Its docs say it can query file names, paths, keywords/tags, persons/faces, albums, and export originals and edited versions. It supports macOS and Linux, with some macOS-only features, and requires Python 3.10 or newer. The README states it has broad macOS version coverage but only limited macOS 26.x support, including a shared-album limitation.

Its Python API is the better integration layer for Vintrace because our backend is already Python. `PhotosDB()` exposes photos as `PhotoInfo` objects. The docs show direct access to filename, original filename, date, title, keywords, albums, persons, and path. The API also exposes `PersonInfo`, `FaceInfo`, `SearchInfo`, `PlaceInfo`, `ExifInfo`, `PhotoExporter`, sidecar writers, text detection utilities, library discovery helpers, and library comparison helpers.

The CLI remains useful for parity checks and emergency export workflows. It has commands such as `query`, `export`, `sync`, `import`, `albums`, `persons`, `dump`, `compare`, and `exportdb`. Export features such as `--update`, export databases, sidecar output, keyword templates, and ExifTool integration are useful reference behavior, but Vintrace should use structured Python calls for normal app flows.

License: `osxphotos` is MIT licensed. If bundled or vendored, include its copyright and MIT notice.

Source-tree spot check:

- The public package exports `PhotosDB`, `PhotoInfo`, `PhotoExporter`, `ExportOptions`, `ExportResults`, `PersonInfo`, `FaceInfo`, `AlbumInfo`, `FolderInfo`, `PlaceInfo`, `SearchInfo`, `ExifInfo`, `CommentInfo`, `LikeInfo`, `PhotoTables`, `SidecarWriter`, `ExifWriter`, `PhotosAlbum`, and iPhoto variants.
- `PhotoInfo` exposes the specific fields Vintrace needs: current/original filenames, date, path, edited path, RAW path, Live Photo path, description, persons, person info, face info, albums, keywords, title, UUID, missing/cloud flags, favorite/hidden flags, location, burst, Live Photo, HDR, portrait, search info, labels, EXIF info, and detected text.
- `FaceInfo` includes MWG region and Microsoft Photo Region rectangle helpers, which is especially relevant for cross-platform people-tag interoperability.
- Library helpers locate the system library, last-opened library, and discovered `.photoslibrary` packages using Photos preference files and Spotlight search (`mdfind`) on macOS.
- The CLI has macOS-only mutation-capable commands such as add locations, batch edit, import, push EXIF, sync, timewarp, and UUID/show helpers. These are useful references, but they reinforce that Vintrace should start read-only.
- The dependency footprint is not tiny: the package pulls Click/Rich/Mako/template tooling, ExifTool helpers, PhotoKit/Photoscript/PyObjC/macOS-only packages, and `requests`. Vintrace should lazy-load it and keep no-network tests around native import.

## Capability Mapping

| osxphotos capability | Vintrace landing point | Integration value |
|---|---|---|
| Library discovery: system/last/listed Photos libraries | New `list_apple_photos_libraries` command plus existing source suggestions | Replace blind `.photoslibrary` package rows with native library choices, availability, version, and permission status. |
| Full photo query via `PhotosDB.photos()` and `PhotoInfo` | `preview_apple_photos_library` and `photo_assets` import plan | Show counts, media-type breakdowns, missing/iCloud counts, albums, people, and hidden/deleted counts before import. |
| Stable Apple UUIDs | `metadata_json.external.applePhotos` and later `photo_asset_external_ids` | Enables incremental sync even if export path changes. Do not rely only on source path. |
| Original, edited, RAW, Live Photo paths | `photo_assets.source_path`, `photo_media_pairs`, managed import copy plan | Preserve Apple media relationships instead of flattening packages into loose files. |
| Export original/edited versions | Existing `import_photos` managed mode and export/copy code | Use only when the direct path is missing, iCloud-only, edited-only, or the user asks for managed copies. |
| Title, caption/description, favorite, hidden, deleted, dates | `photo_asset_metadata`, `metadata_json`, utility folders | Apple metadata becomes first-class Vintrace metadata without requiring manual sidecar import. |
| Keywords | `photo_keywords`, `photo_asset_keywords`, FTS | Keep Apple keyword vocabulary and make it searchable/filterable. |
| Albums and folders | `photo_album_folders`, `photo_albums`, `photo_album_items` | Recreate Apple organization as read-only or imported manual albums with external provenance. |
| Persons and face regions | Metadata-first import, optional `photo_asset_people` bridge after consent | Use Apple labels as user-provided hints. Never treat them as Vintrace-confirmed identity matches without review. |
| Face rectangles and crops | People key-photo/crop metadata, Review More candidate hints | Enables better people thumbnails and focused review queues. |
| Places, GPS, reverse geocoding | `photo_asset_locations`, place profiles, metadata | Bring Apple place labels and GPS into Places without an immediate network lookup. |
| Visual labels and search metadata | `photo_object_tags`, `photo_search_fts`, metadata | Apple on-device labels can seed Vintrace utility/search collections. |
| Detected text and OCR-like fields | `photo_ocr_blocks`, FTS, Live Text-style actions | Prefer direct structured text import before re-running OCR. |
| EXIF/camera/lens/dimensions | `file_signature_json`, `metadata_json`, Info inspector | Reduce duplicated EXIF parsing and improve camera/lens filters. |
| Favorites/hidden/deleted/recently deleted | Utility folders and metadata flags | Mirror user organization while respecting sensitive collections. |
| iCloud/missing originals | Import warnings, failure rows, export fallback plan | Avoid silent zero-file imports and explain how to fetch/export missing originals. |
| Shared albums/comments/likes, if available | Opt-in metadata only | High privacy risk. Keep off by default and never import shared people data silently. |
| Library compare/diff helpers | Future sync command | Useful for incremental sync and "what changed since last import" previews. |

## Proposed macOS Architecture

Add an optional adapter package:

- `crossage_fr/photo_sources/osxphotos_adapter.py`
- `crossage_fr/photo_sources/__init__.py`
- optional tests under `tests/apple_photos_adapter_units.py`

Do not import `osxphotos` at module import time. Load it lazily inside adapter methods so Windows/Linux builds and environments without the dependency continue to run. The adapter should return deterministic plain dictionaries, not raw `osxphotos` objects.

Suggested backend commands:

- `apple_photos_status`: reports platform, dependency availability, Python version compatibility, last known error, and whether a library path is readable.
- `list_apple_photos_libraries`: returns system, last-used, and discovered `.photoslibrary` packages.
- `preview_apple_photos_library`: read-only summary with counts, albums, people, keywords, media kinds, missing/iCloud counts, hidden/deleted counts, and sample rows.
- `import_apple_photos_library`: imports selected scopes into Vintrace using existing referenced/managed semantics.
- `sync_apple_photos_library`: later incremental command using stable Apple UUIDs and stored sync state.
- `export_apple_photos_assets`: optional helper for selected original/edited/cloud-missing assets when direct source paths are not readable.

Suggested renderer changes:

- Replace the current plain "Apple Photos library" suggested source with "Import from Apple Photos" when the adapter is available.
- Keep the existing package-import warning for fallback direct file scan.
- Add a preview sheet before import:
  - library path and last modified time
  - count by media kind
  - toggles for originals, edited versions, RAW, Live Photo motion, albums/folders, keywords, places, labels/OCR, people/faces, favorites, hidden, and recently deleted
  - managed vs referenced mode
  - explicit sensitive toggle for hidden/deleted/shared/person-face metadata
  - missing/iCloud warning with "export managed copies where needed"
- After import, route to the existing `import:<id>` folder and import-history detail.

Suggested data contracts:

- Store Apple provenance under `photo_assets.metadata_json.external.applePhotos`:
  - `libraryPath`, `libraryId` or hash, `uuid`, `originalFilename`, `localIdentifier` if available, `date`, `timezone`, `importedBy`, `moment`, `isCloudAsset`, `isMissing`, `isFavorite`, `isHidden`, `isDeleted`, `hasAdjustments`, `mediaTypes`, `raw`, `livePhoto`, `burst`, `hdr`, `portrait`, `screenshot`, `selfie`, `slowMo`, `timeLapse`, `panorama`.
- Store source path and selected storage mode normally in `photo_assets`.
- Store original/edited/RAW/Live companions in `photo_media_pairs`.
- Store albums/folders in existing album tables, with `metadata_json.externalProvider = "apple_photos"` if a schema extension is added for album metadata.
- Store Apple labels in `photo_object_tags` with `source = "apple_photos"`.
- Store detected text in `photo_ocr_blocks` with `source` represented in block metadata if schema is extended; otherwise preserve it in asset metadata and FTS.
- Store Apple people/faces first in asset metadata. Add a dedicated people import table or a carefully migrated `photo_asset_people` provenance/status before using Apple person labels as folder membership.

Avoid two-way writes in phase one. `osxphotos` has editing/import-oriented CLI capabilities, but Vintrace should remain read-only against Apple Photos until there is a separate, explicit, audited mutation design.

## Maximal Extraction Checklist

For "suck out 100% of what is capable" in a practical product sense, the adapter should attempt to extract every available field in these buckets and record unsupported/missing fields per library:

- Identity/provenance: Apple UUID, library path, database path, original filename, current filename, import source/app, moment, created/modified/imported dates, timezone if available.
- File variants: original path, edited path, RAW path, Live Photo motion path, sidecars, adjustment state, rendered export availability.
- Organization: albums, folder hierarchy, album order if available, shared vs local album flags, favorites, hidden, deleted/recently deleted.
- User metadata: title, caption/description, keywords, rating-like fields if available, comments/likes only with explicit user opt-in.
- People/faces: person UUID/name/display name, face count, key photo, face rectangle, center, size, roll/pitch/yaw, MWG region data.
- Places: latitude/longitude, place name, address components, city/state/country, venue and point-of-interest labels.
- Media classification: image/video/RAW, Live Photo, burst, HDR, portrait, panorama, selfie, screenshot, screen recording, time lapse, slow motion, depth/cinematic hints where exposed.
- Search/intelligence: Apple labels, normalized labels, search info, EXIF info, OCR/detected text, AI captions/media analysis fields where exposed by the installed osxphotos version.
- Health/sync: missing original, cloud asset, unsupported Photos version, shared-album limitation, read permission failures, export errors, per-item import errors.

The adapter should also save an `unsupportedFields` array in the import session metadata so future audits can distinguish "field absent in this user's library" from "field not yet wired by Vintrace."

## Privacy and Safety Rules

- Read-only by default. No writes to Apple Photos in phase one.
- Explicit user consent before importing people/faces, hidden items, deleted items, shared-album metadata, comments, likes, or precise location.
- Imported Apple people are labels/hints, not Vintrace identity confirmations.
- Preserve no-network behavior. Do not use iCloud/network fetches implicitly. If Photos.app or osxphotos can export a missing iCloud original, make that a user-visible action.
- Audit each library preview/import/sync with library path hash, source kind, selected scopes, item counts, warning counts, and dependency version.
- Redact full source paths from exported diagnostics unless the user chooses a support bundle mode that includes them.
- Keep imports reversible at the catalog level where possible.

## Risks and Constraints

| Risk | Impact | Mitigation |
|---|---|---|
| Apple private database schema drift | Adapter may break on new Photos versions. | Pin supported `osxphotos` versions, show dependency status, add fixture/mocked adapter tests, and fail closed with direct package import fallback. |
| macOS 26.x limited support/shared albums | Shared album reads may be incomplete. | Document as unsupported in status and exclude shared albums by default. |
| OS privacy permissions | User may see zero files or read errors. | Reuse existing Full Disk Access/Files and Folders guidance, but make native adapter errors clearer. |
| iCloud-only originals | Direct path import can miss files. | Preflight missing/cloud counts and offer explicit managed export. |
| Large libraries | Preview/import can block the single backend dispatch loop. | Make preview bounded and move import/sync into job-style handlers before broad release. |
| Dependency packaging | Adds Python dependency and macOS-only behavior. | Optional lazy import; no hard dependency on Windows; PyInstaller packaging check. |
| People/faces privacy | Imports biometric-adjacent labels and regions. | Off by default, consented, audit logged, never auto-confirmed. |
| License hygiene | osxphotos MIT is compatible but notice is required. | Include MIT notice if bundled. |

## Windows Equivalent Assessment

There is no clean modern Windows equivalent to `osxphotos` for Microsoft Photos. The Microsoft support page says the People tab and similar-face grouping are not available in the new Photos app; the article applies to the legacy Photos app. That makes a first-party Windows Photos people/album database importer a poor foundation.

Existing Vintrace Windows source discovery already points in the right direction:

- Pictures folder
- Camera Roll
- Saved Pictures
- OneDrive Pictures
- mounted camera/phone/SD-card media roots
- nested `DCIM` roots

Recommended Windows path:

1. Treat Windows as folder-native, not Photos-app-native.
2. Improve metadata ingestion from EXIF/IPTC/XMP sidecars and embedded XMP, including MWG/Microsoft people-region tags where present.
3. Keep OneDrive and Phone Link/Mobile Devices as filesystem sources, not cloud sync integrations.
4. Add an optional "Import Windows photo folders" flow that mirrors the Apple preview sheet but is backed by filesystem scanning and metadata extraction.
5. Use local ML already in Vintrace for faces, OCR, object tags, semantic search, and duplicate detection instead of relying on Microsoft Photos.

Useful Windows-side comparators:

- Lap: open-source local-first photo manager for Windows, macOS, and Linux. It works directly with existing folders, advertises no cloud upload, local AI search/similarity/smart tags/face features, 100k+ file scale, drag-and-drop import, filesystem sync, safe move/copy/delete, duplicate cleanup, editing, and broad format support. It is GPL-3.0, so treat it as a product/architecture reference, not code to embed without a license decision.
- digiKam: mature open-source cross-platform DAM for Linux, Windows, and macOS. It supports import from devices/storage, albums/tags/ratings, advanced metadata search across EXIF/IPTC/XMP, AI face detection/recognition, auto-tags, and metadata read/write through Exiv2/ExifTool. It is useful as a metadata interoperability benchmark and UX reference.

Lap source-tree spot check:

- Stack: Tauri 2 + Rust backend, Vue/Vite/Tailwind frontend, SQLite via `rusqlite`.
- License: `GPL-3.0-or-later` in `src-tauri/Cargo.toml`.
- Native dependency posture: LibRaw, libheif, JPEG/video tooling, FFmpeg sidecar, ONNX Runtime, CLIP, InsightFace, Leaflet, EXIF libraries, and Windows clipboard support.
- Command surface includes libraries, folders, folder mtime sync, file metadata, tags, AI image search, duplicate handling, face indexing/cancel/reset/stats, people, and per-file face reads.
- Product lesson for Vintrace: Windows parity is best treated as a first-class folder/library workflow with local indexing jobs, not as a Microsoft Photos database bridge.

If the user wants the closest "Windows osxphotos" answer in one line: Lap is the best modern Windows-local photo-manager comparator; digiKam is the mature DAM comparator; neither is a Microsoft Photos database extraction library.

## Phased Roadmap

### Phase 0: adapter spike

- Add no production dependency yet.
- Prototype `osxphotos_adapter.py` behind a feature flag.
- Use fake `osxphotos` objects in unit tests so CI does not need Apple Photos.
- Verify import of one local test library manually on macOS.
- Record dependency/version/status in the UI.

### Phase 1: read-only Apple catalog import

- Commands: `apple_photos_status`, `list_apple_photos_libraries`, `preview_apple_photos_library`, `import_apple_photos_library`.
- Import titles, captions, dates, favorites, hidden state only if opted in, keywords, albums, folders, GPS/place metadata, EXIF, labels, and detected text.
- Store Apple UUID/provenance in `metadata_json`.
- Build albums as imported manual albums or read-only external albums.
- Tests: mapping, privacy toggles, import warnings, album/folder reconstruction, FTS updates, no-network behavior.

### Phase 2: media variants and managed exports

- Preserve original/edited/RAW/Live pairs.
- Export managed copies only when requested or when direct paths are missing.
- Use existing `photo_media_pairs`, backup-readiness, missing-original, relink, and repair center surfaces.
- Tests: Live Photo pair, RAW plus JPEG proxy, edited/original selection, iCloud/missing fallback, failure rows.

### Phase 3: people/faces import

- Add a consent-gated people/faces scope.
- Store Apple person labels and face regions as metadata/hints first.
- Add UI copy that distinguishes Apple labels from Vintrace-confirmed matches.
- Optionally create Review More queues from Apple person hints.
- Tests: no people import by default, person metadata import with consent, no auto-accepted candidate status.

### Phase 4: incremental sync

- Add stable external-ID indexing or a dedicated `photo_asset_external_ids` table.
- Track per-library sync cursors, changed/deleted/missing state, and user choices for removed Apple assets.
- Use `osxphotos` compare/diff/exportdb concepts as reference behavior.
- Tests: rename/path move, album membership change, hidden/favorite toggle, deleted asset, missing exported variant.

### Phase 5: Windows folder-native parity

- Add richer Windows source preview over Pictures/Camera Roll/Saved Pictures/OneDrive/DCIM.
- Expand XMP/MWG people-region parsing and sidecar conflict UI.
- Use Lap's folder-first, filesystem-sync, and 100k-library behavior as a benchmark.
- Use digiKam metadata interoperability as the standard for EXIF/IPTC/XMP round-trip expectations.

### Phase 6: performance and release gates

- Convert long preview/import/export/sync runs to background jobs before exposing whole-library Apple import broadly.
- Add 10k/50k/100k synthetic adapter tests with mocked osxphotos pages.
- Add PyInstaller/macOS packaging checks.
- Add status UX for missing dependency, unsupported macOS/Photos version, permission denial, iCloud-only originals, and shared-album unsupported state.

## File-Level Plug-In Map

Likely files to add:

- `crossage_fr/photo_sources/osxphotos_adapter.py`
- `crossage_fr/photo_sources/windows_folder_adapter.py`
- `tests/apple_photos_adapter_units.py`
- `tests/windows_photo_metadata_units.py`

Likely files to change:

- `requirements.txt` or an optional extras/install path for `osxphotos`
- `requirements-production.txt` and lock files if bundled
- `crossage_fr/api_server.py` for new commands and audit events
- `crossage_fr/store/workspace_db.py` for external ID/sync state if metadata-only storage is insufficient
- `desktop/main/photo-sources.cjs` to expose native Apple status instead of only package paths
- `desktop/preload.cjs` and `desktop/main.cjs` command allowlists
- `src/types.ts` for native library preview/import contracts
- `src/App.tsx` for IPC wrappers
- `src/views/PhotosView.tsx` for Apple Photos preview/import UI
- `src/views/photoImportAccess.ts` to keep fallback package warnings
- `tests/photo_folders_units.py`, `tests/photos_view.test.mjs`, and command-contract tests

## Acceptance Criteria

This integration is ready when:

- [x] The app can show a native Apple Photos preview without importing files.
- [x] Import runs in referenced mode for readable local originals and managed mode for selected/exported variants.
- [x] Apple albums, keywords, metadata, locations, media pairs, and search labels land in existing Vintrace surfaces.
- [x] People/faces require explicit consent and remain pending hints rather than confirmed identity matches.
- [x] Missing/iCloud-only assets produce visible failures or explicit consented managed export actions, never silent skips.
- [x] Windows installs and builds omit `osxphotos` through platform markers and conditional PyInstaller collection.
- [x] Windows users get a folder-native import path with portable metadata instead of a Microsoft Photos database promise.
- [x] Socket-blocked local adapter tests prove preview/import discovery performs no network calls.
- [x] Renderer previews and all long import/sync/export operations run as durable jobs; folder scanning is streamed and synthetic scale tests cover 10k, 50k, and 100k assets.

## Bottom Line

Use `osxphotos` as the macOS bridge from Apple Photos' private library model into Vintrace's local-first catalog. It can make Apple Photos import feel native without surrendering Vintrace's governance, review, and local-storage model.

On Windows, build the equivalent around folders and portable metadata, with Lap and digiKam as design references. That gives Windows users the same practical outcome: local library ingestion with albums/tags/people/search where available, without depending on an unstable Microsoft Photos internals story.

# Photo Source Integration Validation

Date: 2026-07-11

Status: implementation and local acceptance are complete. The Apple Photos adapter remains read-only. A public macOS release still requires a Developer ID Application certificate, Apple notarization credentials, and resolution of the existing distribution-readiness blockers.

## Safety Verdict

No user photo or Photos library content was changed, copied, moved, deleted, or exported during this validation.

- The real library at `~/Pictures/Photos Library.photoslibrary` was discovered read-only.
- macOS denied database access with `EPERM`, so the harness exercised the permission-recovery path and did not bypass or reset TCC.
- Its shallow package signature was identical before and after: `054823dbbf092d9cdf6ba78e1571b3ffc44ba4c69b58d2616bf715198f628479`.
- All mutation-oriented tests used generated images, upstream `osxphotos` fixtures, and temporary Vintrace workspaces.
- The final Mac fixture matrix reports 9 passed, 0 failed, 0 missing, and 0 source mutations.
- Network sockets and Photos/iCloud export were disabled in the read-only fixture harness.

Machine-readable evidence: `build/qa/photo-source-mac-acceptance.json`.

## What Changed

### Real library and difficult-condition handling

- Apple Photos discovery now excludes incidental simulator/test libraries unless explicitly enabled, while preserving system and last-used libraries.
- `osxphotos` reads a temporary snapshot of only the Photos catalog databases. Original media remains referenced in the source package, preventing SQLite WAL/SHM side effects in the source library.
- Referenced import, managed import, preview, sync, and explicit selected export use durable jobs with cancellation, retry, restart recovery, progress, and audit records.
- Stable provider/library/asset identities preserve matches across source moves and renames.
- Sync preserves user edits when imported provider metadata conflicts with newer Vintrace edits.
- Source removals support keep or local-catalog trash policy; neither policy deletes source bytes.
- Cloud-only originals remain warnings unless the user separately enables Photos export and explicit iCloud download consent.

Validated fixture categories: empty library, edits, RAW, Live Photo, faces, places, cloud-only state, shared metadata, and mixed media types. Six fixture imports ran in referenced mode in temporary workspaces.

### Privacy and review

- People/face regions, precise location, hidden/deleted state, and shared/comment/like metadata remain explicit sensitive scopes.
- Imported people names are pending hints, not confirmed identities. Users can edit, accept, or reject each hint; decisions survive resync.
- Consent can be revoked by scope. Revocation removes imported sensitive metadata from the Vintrace catalog without opening the source adapter or touching source media.
- Import failures retain bounded per-item details and can be expanded and filtered in the source dialog.
- Permission-denied and missing-original states now offer direct recovery actions, including the platform privacy settings page.

### Source dialog quality

- The dialog has a focus trap, Escape handling, focus return, live status/error announcements, progressbar semantics, and arrow/Home/End tab navigation.
- The native Electron test covers preview, referenced import, face-hint acceptance, local consent revocation, source-byte equality, desktop layout, a 390 px viewport, and focus return.
- Source-dialog text is mapped for English, Chinese, Spanish, French, Arabic, Hindi, and Japanese. The localization gate passes.
- macOS `/var` and `/private/var` path aliases are associated by stable `libraryId`, preventing post-import source state from disappearing.

## Release Engineering

- Production backend builds are pinned to CPython 3.11 and fail when `VINTRACE_REQUIRE_PYTHON_MINOR=3.11` is not met.
- The final frozen manifest records CPython 3.11.15 and a sidecar checksum.
- Production dependencies install from `requirements-production.lock.txt` with hashes.
- `osxphotos==0.76.1` and its macOS resources are bundled only for Darwin; the Windows workflow asserts that `osxphotos` is absent.
- Production macOS and Windows workflows are now unconditionally signed and fail closed on missing or invalid credentials. Explicit unsigned commands remain local-development-only and cannot publish.
- The local unsigned ARM64 DMG and updater ZIP were built successfully with SBOM, provenance, update metadata, blockmaps, and SHA-256 checksums.
- Packaged-app smoke testing launches Electron, scans generated images, exports diagnostics, and exercises production controls.

The packaged smoke initially found a missing FAISS `MetalDistance.metallib`. PyInstaller now collects that resource, and the vector runtime configures its path before enabling Metal GPU FAISS. If the resource is unavailable, Vintrace safely falls back to CPU FAISS instead of failing during the first vector add.

Local artifacts:

- `dist/Vintrace-0.1.0-arm64.dmg` (about 361 MB)
- `dist/Vintrace-0.1.0-arm64-mac.zip` (about 362 MB)
- `dist/SHA256SUMS.txt`
- `dist/vintrace.cdx.json`
- `dist/vintrace.spdx.json`
- `dist/vintrace-build-metadata.json`

The local build is intentionally unsigned. It was not notarized because no production Developer ID Application identity or Apple notary credentials were available. Windows Authenticode cannot be executed on this Mac; its workflow and validation path are implemented but require Windows CI and certificate secrets.

## Startup Results

`apple_photos_status` no longer imports `osxphotos`. It checks package metadata and reports `dependencyLoadState: deferred`; the heavy dependency loads only when a library is actually opened.

Observed on this Mac with the CPython 3.11.15 production environment:

| Measurement | Earlier eager path | Final path |
|---|---:|---:|
| Frozen Apple Photos status | 20,530 ms on the first measured run | 4-6 ms |
| Source backend readiness | 3,880 ms on the first measured run | 405 ms final run |
| Frozen backend readiness | 13,206 ms first cold observation | 5,890 ms first run after final rebuild; 258 ms warm |

One intermediate first-post-package frozen run measured 9,197 ms and exceeded the 8,000 ms readiness budget; the final rebuild measured 5,890 ms and passed. This cold-start variability remains worth monitoring. The final generated benchmark report passes both the 8,000 ms readiness and 12,000 ms status budgets.

Machine-readable evidence: `build/qa/photo-source-startup.json`.

## Verification Matrix

| Area | Result |
|---|---|
| Adapter units | 9 passed |
| Service difficult-condition units | 6 passed |
| API units | 2 passed |
| 10k/50k/100k source scale | Passed |
| Mac `osxphotos` fixture matrix | 9 passed, 0 source mutations |
| Native source-dialog Electron E2E | Passed |
| App keyboard accessibility E2E | Passed |
| Vector/FAISS resource units | Passed |
| Packaged Electron scan/export smoke | Passed |
| Localization gate | Passed for 7 languages |
| Required package artifact check | Passed |
| Structural non-credential release check | Passed under Python 3.11.15 |

## Remaining External Work

1. Grant Vintrace the macOS Files and Folders or Full Disk Access permission needed to open the real Photos database, then rerun the same read-only harness. This requires an explicit user OS action.
2. Run signed/notarized macOS CI with a Developer ID Application certificate and Apple API notary credentials.
3. Run Windows CI with optional Authenticode credentials and validate the produced installer on Windows hardware or a VM.
4. Resolve the existing model redistribution/legal, Safe Mode model, and real public benchmark blockers before publishing broad public installers.

These limitations do not affect the read-only adapter implementation or the local temporary-fixture acceptance result; they prevent claiming a production-signed public release or a real-library import that macOS did not authorize.

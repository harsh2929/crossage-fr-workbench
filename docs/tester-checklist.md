# Vintrace Tester Checklist

Use this checklist for every DMG/EXE shared with a tester. Do not use tester photos for training; only use them to verify local app behavior.

## First Launch

- Open Vintrace from a fresh install.
- Confirm the loading screen completes and the dashboard appears.
- Confirm the app version/build is visible in Settings > Local engine.
- Confirm scrolling works in every tab on a small laptop-sized window.

## Model Setup

- Open Settings and confirm the face model card shows a clear Ready or Setup state.
- If the model is missing, choose a download folder and start download.
- Confirm progress, checksum verification, retry/error state, and offline messaging are understandable.
- Restart the app and confirm the model remains installed.

## Basic Workflow

- Choose an app folder.
- Confirm permission.
- Add one person from a small folder of reference photos.
- Scan a small image folder.
- Confirm possible matches appear while the scan is still running.
- Open Review, paginate/search/filter, and accept/reject/mark Not sure.

## Large Folder Behavior

- Analyze a large folder before scanning.
- Confirm estimated time, file counts, skipped extensions, unreadable samples, and storage warnings are visible.
- Start a scan, pause it, resume it, then cancel it.
- Restart the app and confirm resume state is clear.
- Run Settings > Machine benchmark and confirm benchmark history records the run.

## Privacy And Safety

- Enable Safe Mode and scan a folder containing mixed media.
- Confirm protected counts appear and protected media is not added to review clusters.
- Export a support bundle without paths.
- Open the ZIP and confirm it contains JSON diagnostics only, with no photos, videos, embeddings, SQLite DB, previews, or model files.
- Export diagnostics with and without paths and confirm the choice is explicit.

## Platform Integration

- Confirm file/folder reveal and open actions work.
- Test startup/login setting if available on the platform.
- Test update check on stable/beta/internal channels.
- Confirm crash/error report preview does not send anything without consent.

## Release Gate

Run these from a clean checkout before sharing a build:

```bash
npm ci
npm run build
npm run test:pipeline
npm run test:edge
npm run test:mcp
npm run test:clean
npm run bench:accuracy
npm run bench:scale
npm run update:dry-run
npm run release:check
```

For Windows installers, use the GitHub Actions `Windows Release` workflow and download the `Vintrace-Windows-Installer` artifact.

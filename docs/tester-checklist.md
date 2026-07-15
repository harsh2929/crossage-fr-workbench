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

## Mobile Companion

- Configure a trusted same-origin HTTPS proxy to the managed loopback server.
- In AI Agents, create a one-day metadata-only pairing and scan it on a phone.
- Confirm library/search work, previews fail, and no edit/import/export controls appear.
- Create a preview-enabled pairing and confirm Safe Mode still protects preview delivery.
- Sign out on the phone, pair again, then revoke the device on desktop and confirm the open phone session fails without restarting Vintrace.
- Confirm an expired or already-used pairing link cannot create another session.

## Release Gate

Run these from a clean checkout before sharing a build:

```bash
npm ci
npm run build
npm run test:pipeline
npm run test:edge
npm run test:mcp
npm run test:mobile-companion
npm run test:e2e:mobile
npm run test:clean
npm run bench:accuracy
npm run bench:scale
npm run update:dry-run
npm run release:check
```

Public installers must come from the tag-bound `Cross-Platform Release` workflow. The individual macOS, Windows, and Linux workflows produce caller-scoped build artifacts only and are not release publishers.

Confirm the `selfLearningRd` row is present in the JSON output and remains
non-authorizing for true retraining unless Phase 5/6 evidence has been approved.

For a public release candidate, complete the exact artifact and assistive-technology matrix in [Accessibility Manual Release Sign-Off](accessibility-manual-signoff.md). Automated accessibility results do not replace that signed record.

Do not represent the product as commercially licensed, priced, or entitled until [Distribution and Business Decision Record](distribution-business-decision-record.md) is approved and its implementation consequences are verified.

For Windows testing, use the `.exe` from the complete `Vintrace-Cross-Platform-Release` Actions artifact before publication or from the verified public release afterward. The reusable Windows build artifact is intermediate evidence, not an independently publishable release.

# Vintrace Downloads

Use the GitHub Releases page for shareable installers:

- Latest releases: https://github.com/harsh2929/crossage-fr-workbench/releases
- Windows installer: download `Vintrace.Setup.<version>.exe`
- macOS installer: download `Vintrace-<version>.dmg` when the unsigned macOS workflow has been run

## Windows

1. Download the `.exe` from the release.
2. Run the installer.
3. If Windows SmartScreen appears, choose **More info** and **Run anyway** only if you trust this build.
4. On first launch, Vintrace opens in local mode and shows model setup if the full face model is not installed yet.

The Windows build is currently unsigned. That means Windows may warn even when the file is intact. Use the SHA-256 shown on the release asset when you need to verify a download.
New release builds also include `SHA256SUMS.txt`, `vintrace-sbom.json`, and `vintrace-provenance.json` for checksum verification, dependency inventory, and build provenance.

## macOS

1. Download the `.dmg` from the release.
2. Open the DMG and drag Vintrace into Applications.
3. If macOS blocks first launch because the app is from an unidentified developer, open **System Settings > Privacy & Security** and choose **Open Anyway** for Vintrace.
4. Confirm again when macOS asks.

Unsigned DMGs are intended for private testing. Public macOS distribution should use an Apple Developer ID signed and notarized build.

## Data at rest (PC-03)

Vintrace stores everything locally and never uploads your data, but the app
folder is **not encrypted on disk**: face embeddings, generated previews, and the
SQLite workspace are written unencrypted (with owner-only file permissions where
the OS supports it). **Workspace Lock** gates access *inside the running app* — it
is an access control, not on-disk encryption — so another local user or process
could read the raw files. Keep the app folder on an OS-encrypted volume
(FileVault / BitLocker) and use **Delete face data** before handing the folder to
someone else. The in-app privacy report surfaces this under `dataAtRest`.

## Enabling code signing & notarization (BRS-3)

The build is pre-wired for signing — it stays unsigned only because no
certificates are configured. The macOS `hardenedRuntime` + entitlements
(`desktop/assets/entitlements.mac.plist`, which permits the bundled native
backend libraries to load under the hardened runtime) are already in
`package.json`, and are inert while signing is skipped. To produce a signed,
notarized public build:

**macOS** — provide a Developer ID Application certificate and notarization
credentials as CI secrets, then drop the `CSC_IDENTITY_AUTO_DISCOVERY=false`
override in `.github/workflows/macos-release.yml`:

- `CSC_LINK` — base64 of the `.p12` Developer ID Application certificate
- `CSC_KEY_PASSWORD` — its password
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — for notarization

Add `"notarize": true` under `build.mac` (electron-builder notarizes with the
Apple env vars above), or run notarization in an `afterSign` hook.

**Windows** — provide an Authenticode certificate and drop the
`CSC_IDENTITY_AUTO_DISCOVERY=false` override in
`.github/workflows/windows-release.yml`:

- `CSC_LINK` — base64 of the `.pfx`/`.p12` code-signing certificate
- `CSC_KEY_PASSWORD` — its password

Until certificates exist, keep the explicit "private testing only" framing above
and verify downloads via the published `SHA256SUMS.txt`. The auto-updater's
integrity still rests on `latest.yml` hashes over TLS, so do not advertise
auto-update to untrusted users before signing is enabled.

## First Run

Vintrace does not require Python or npm on the tester's machine. The packaged app includes the desktop UI and backend sidecar.

On first run:

- Choose or keep the default app folder.
- Confirm permission before processing photos.
- Add at least one clear photo of the person to find.
- Install the full face model from the in-app model card if prompted.
- Choose a scan folder, check it, then scan.
- Review possible matches manually.

If the tester is offline, the app can open in simple matching mode and retry the model download later.

## Troubleshooting

- **Windows warning:** expected for unsigned builds. Code signing will reduce this.
- **macOS warning:** expected for unsigned and unnotarized DMGs.
- **Model download fails:** use the in-app retry button or choose another writable model folder.
- **White screen or startup issue:** reopen the app. The startup recovery screen can reset UI state, repair the app folder, or export diagnostics.
- **Need logs:** Settings > Error reports > Preview report or Export report.

## Release Validation

Release assets can be checked with:

```bash
npm run release:verify -- --repo harsh2929/crossage-fr-workbench --tag v0.1.0 --platform win32 --full
```

Use `--platform darwin` for macOS releases.
Use `--require-release-metadata` for new releases that include `SHA256SUMS.txt`, `vintrace-sbom.json`, and `vintrace-provenance.json`.

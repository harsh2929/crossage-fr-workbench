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

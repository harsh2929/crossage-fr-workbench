# Vintrace Downloads

Use the GitHub Releases page for shareable installers:

- Latest releases: https://github.com/harsh2929/crossage-fr-workbench/releases
- Windows installer: download `Vintrace.Setup.<version>.exe`
- macOS installer: download the signed and notarized `Vintrace-<version>.dmg`
- Linux portable build: download `Vintrace-<version>-linux-x86_64.AppImage`
- Linux packages: download `vintrace_<version>_amd64.deb` or `vintrace-<version>.x86_64.rpm`

## Windows

1. Download the `.exe` from the release.
2. Run the installer.
3. Confirm that Windows shows the expected Vintrace publisher. SmartScreen can still warn while a new signed release builds reputation.
4. On first launch, Vintrace opens in local mode and shows model setup if the full face model is not installed yet.

Production Windows builds are signed and RFC 3161 timestamped through Azure Artifact Signing. The release workflow fails before upload when the installer, app executable, or bundled backend has an invalid signature, unexpected publisher, or missing timestamp.
New release builds also include `SHA256SUMS.txt`, CycloneDX 1.6 `vintrace.cdx.json`, SPDX 2.3 `vintrace.spdx.json`, signed GitHub SLSA provenance, and per-subject keyless cosign bundles. See [Release Supply-Chain Evidence](docs/release-supply-chain.md) for the trust model and verification commands.

## macOS

1. Download the `.dmg` from the release.
2. Open the DMG and drag Vintrace into Applications.
3. Confirm that Gatekeeper identifies the expected Developer ID publisher.

Production DMGs are Developer ID signed, notarized, stapled, and Gatekeeper-assessed before upload. Explicit unsigned npm scripts remain available only for local development and are not used by release workflows.

macOS releases target Apple Silicon and require macOS 14 or newer. This is an
explicit ONNX Runtime 1.27 support boundary; the upstream release does not
publish a macOS x64 wheel. Windows and Linux releases remain x64. All three
workflows install Electron 43.1.0 explicitly after `npm ci`, verify its
runtime/ABI, freeze and execute ONNX Runtime 1.27 under Python 3.11, and run the
packaged desktop smoke before publication. The exact production hash lock is
included inside the app. See [Dependency Currency and Native Runtime Contract](docs/dependency-currency.md).

## Linux

1. For AppImage, mark the file executable and run it without installation:
   `chmod +x Vintrace-<version>-linux-x86_64.AppImage`.
2. On Debian/Ubuntu, install with `sudo apt install ./vintrace_<version>_amd64.deb`.
3. On Fedora/RHEL/openSUSE-family systems, install with the local-package form
   of the distribution package manager, for example
   `sudo dnf install ./vintrace-<version>.x86_64.rpm`.
4. Verify the release checksums, GitHub attestations, and detached cosign bundle
   before running a downloaded artifact.

Linux releases target x86-64 with an Ubuntu 22.04/glibc 2.35 build baseline.
AppImage, deb, and RPM are not sandboxed and have no Apple/Windows-style native
publisher identity; hosted artifacts use detached keyless Sigstore signatures
and GitHub attestations instead. Apple Photos is unavailable. A Secret Service
or KWallet backend is required for Workspace Lock, and insecure Electron
`basic_text` storage is rejected. See [Linux Distribution](docs/linux-distribution.md)
for supported features, update behavior, and current model-runtime limits.

## Data at rest

Production desktop workspaces encrypt private review state at rest by default.
The SQLite database, WAL, and snapshots use SQLCipher 4 with a random 256-bit
key; reference, review, consent, and audit sidecars use authenticated AES-256-GCM
envelopes. Electron wraps the workspace key with the signed-in OS credential
facility and startup fails closed when it cannot recover a protected key.

Original photos and videos outside the workspace are not encrypted or rewritten
by Workspace Lock. Exported reports are intentionally readable. Keep source
media and exports on an OS-encrypted volume, and remember that SSD wear leveling,
copy-on-write filesystems, snapshots, and old backups can retain pre-migration
plaintext. Workspace backups contain the encrypted database and sidecars;
optional whole-archive passphrase encryption remains available for other backup
entries. See [Workspace Encryption](docs/workspace-encryption.md).

## Code signing and notarization (BRS-3)

Production workflows cannot opt out of signing. Missing Apple or Azure credentials, signing failures, missing timestamps, failed notarization, or failed platform verification stop the run before artifact upload. Credential names, OIDC setup, platform checks, and the explicitly local-only unsigned commands are documented in [Release Signing](docs/release-signing.md).

Platform workflows are build-only and never publish separately. Production publication must use `.github/workflows/release.yml` on the exact version tag. It assembles all three platform artifacts, emits one non-colliding checksum/SBOM/attestation set, verifies the complete draft, publishes once, verifies public downloads, and then publishes the MCP Registry descriptor.

The in-app updater is disabled unless explicitly enabled with a configured release public key, and it will not install a downloaded update until the signed `SHA256SUMS.txt` manifest and artifact SHA-256 both verify.

## First Run

Vintrace does not require Python or npm on the tester's machine. The packaged app includes the desktop UI and backend sidecar.

On first run:

- Choose or keep the default app folder.
- Confirm permission before processing photos.
- Add at least one clear photo of the person to find.
- Install the full face model from the in-app model card if prompted.
- Choose a scan folder, check it, then scan.
- Review possible matches manually.

Optional local photo editing models are installed separately. Open a still photo, choose **Edit**, then use **Local AI edits**. The light setup is about 145 MB and enables Clean Up plus 2x/4x Upscale. The 22.9 GB heavy setup enables Expand, Reframe, and Relight only on Apple Silicon macOS or Windows x64 Vulkan with at least 48 GiB of detected memory; 64 GiB is recommended. The base installer contains the integrity-pinned catalog and notices, not those optional weights.

AI edits always show a preview and require **Apply** before the library changes. Vintrace keeps the imported original unchanged and stores the prior edit stack as a restorable version. Model installation requires a network connection, but editing with an installed, verified pack runs locally with offline mode forced.

Memories now have a **Photo story** editor. With a verified local photo VLM installed, choose a Memory and explicitly generate a journal or cinematic draft, then edit its title, chapter order, narratives, and captions. Saving creates restorable revisions; Export writes path-free Markdown and JSON; Create movie first saves pending edits and opens the existing slideshow studio with the story chapters and provenance attached. Generated prose is marked for human review, and no source path is sent to the model or renderer story payload.

Bursts now offer **Assisted culling**. Analysis is explicitly started by the reviewer and scores every frame locally for sharpness and motion clarity; face quality and heuristic eye likelihood are added only with face-processing consent. The burst panel explains every score and recommends one frame without changing keepers or deleting media. **Use recommendation** is a separate confirmed action, and manual keeper selection remains available. Results are content-bound, path-free, restart-cached, and invalidated by changed bytes or consent mode.

Semantic search now understands **visual moments inside videos**. Local decoder samples are grouped into source-bound timeline segments and indexed with the existing offline SigLIP model; results show a representative frame and timestamp, and opening one seeks the lightbox video to that exact moment. Indexing is restart-safe through the Semantic media queue, changed/hidden/deleted sources invalidate safely, and no audio or media bytes leave the device. The packaged backend now includes and verifies the complete SigLIP vision, text, and tokenizer set.

People now offers opt-in **Who is this?** suggestions for repeated unnamed clusters. Each suggestion explains the shared relationships that produced it and is suppressed when the two identities ever appear together. Vintrace does not name anyone automatically: the reviewer must open a confirmation before an undoable merge, or can persist **Not this person**. Consent, hidden/deleted/rejected state, stale evidence, restart persistence, and unchanged originals are all enforced locally.

If the tester is offline, the app can open in simple matching mode and retry the model download later.

## Troubleshooting

- **Windows warning:** a valid Azure signature does not grant instant SmartScreen reputation; verify the displayed publisher and release checksum.
- **macOS warning:** a production DMG must pass Gatekeeper. Do not publish a local unsigned development artifact.
- **Linux warning:** verify checksums, GitHub attestations, and cosign bundles. Direct AppImage/deb/RPM files do not display a Vintrace publisher identity and are not sandboxed.
- **Linux keyring:** start a Secret Service or KWallet provider. Vintrace rejects Electron's insecure `basic_text` fallback; Debian/Ubuntu online connectors also need `libsecret-tools`.
- **Model download fails:** use the in-app retry button or choose another writable model folder.
- **Local AI edit is unavailable:** refresh the Local AI edits status, verify the light pack, and check the displayed platform/memory reason. The heavy tier intentionally has no Intel macOS or low-memory fallback.
- **White screen or startup issue:** reopen the app. The startup recovery screen can reset UI state, repair the app folder, or export diagnostics.
- **Need logs:** Settings > Error reports > Preview report or Export report.

## Release Validation

Release assets can be checked with:

```bash
npm run release:verify -- --repo harsh2929/crossage-fr-workbench --tag v0.1.0 --platform win32 --full
```

Use `--platform darwin` for macOS releases.
Use `--platform linux` for AppImage/deb/RPM releases.
Use `--platform all` for the mandatory final cross-platform publication gate.
Use `--full --require-release-metadata --verify-signatures` for new releases that include `SHA256SUMS.txt`, both standard SBOMs, GitHub attestations, and cosign bundles. Signature verification also requires the workflow path, source commit, and full source ref described in [Release Supply-Chain Evidence](docs/release-supply-chain.md).

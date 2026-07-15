# Linux Distribution

Last verified: 2026-07-13

Vintrace ships Linux x64 builds as AppImage, deb, and RPM. The Linux release
uses the same Electron 43.1.0 frontend, frozen Python 3.11 backend, ONNX Runtime
1.27.0 CPU runtime, SQLCipher workspace encryption, C2PA SDK, production hash
lock, and release-evidence policy as the macOS and Windows builds.

## Supported target

| Area | Contract |
|---|---|
| Architecture | x86-64 only. There is no Linux arm64 installer yet. |
| Build baseline | GitHub-hosted Ubuntu 22.04 x64. This implies a glibc 2.35 baseline for release builds. |
| Native audit | Debian 12 x64 with glibc 2.36; AppImage, deb, RPM, frozen backend, and packaged Electron flows passed. |
| Formats | AppImage for portable use, deb for Debian-family systems, and RPM for Fedora/RHEL/openSUSE-family systems. |
| Display | The packaged acceptance uses Xvfb/X11. Native Wayland-only operation is not separately certified. |
| Sandboxing | None of the three formats is an application sandbox. Vintrace's consent, path, IPC, and workspace controls still apply. |

Alpine/musl, 32-bit Linux, Linux arm64, Snap, Flatpak, and distribution package
repositories are not supported release targets. An AppImage is portable across
many glibc distributions, but it does not erase the glibc and desktop-library
baseline.

## Install and run

AppImage does not require root:

```bash
chmod +x Vintrace-0.1.0-linux-x86_64.AppImage
./Vintrace-0.1.0-linux-x86_64.AppImage
```

Install a deb or RPM with the distribution package manager so dependencies are
resolved:

```bash
sudo apt install ./vintrace_0.1.0_amd64.deb
sudo dnf install ./vintrace-0.1.0.x86_64.rpm
```

The pinned AppImage toolset is static runtime `1.0.3`. electron-builder marks
that toolset beta but recommended; unlike its legacy runtime, it does not depend
on FUSE2. The AppImage carries its differential-update blockmap inside the
binary, so no separate `.blockmap` file is published.

## Key custody

Workspace Lock fails closed on Linux unless Electron reports a real Secret
Service or KWallet backend (`gnome_libsecret`, `kwallet`, `kwallet5`, or
`kwallet6`). Electron's `basic_text`, `unknown`, unavailable, and pre-ready
states are rejected because `basic_text` uses a hard-coded plaintext fallback.

Run the desktop inside a logged-in session with GNOME Keyring, KDE Wallet, or a
compatible Secret Service implementation. Managed/headless deployments can
provide the documented `VINTRACE_WORKSPACE_DB_KEY` instead; see
[Workspace encryption and recovery](workspace-encryption.md). Inbound connector
credentials additionally use the `secret-tool` client. Install
`libsecret-tools` on Debian/Ubuntu when online connectors are needed; Fedora's
`libsecret` package includes that executable.

## Updates and release identity

`latest-linux.yml` binds all three artifacts by SHA-512. electron-updater
supports AppImage, deb, and RPM, but Vintrace keeps checks/downloads operator
initiated and will not install an update without the configured static Ed25519
release-checksum key. Local `dist:linux` builds use `--publish never`.

Vintrace does not publish an apt, dnf, or zypper repository, so it makes no
claim about repository metadata signing or package-manager rollout. Direct
Linux packages also have no Apple/Windows-style native publisher identity.
Hosted release artifacts instead receive detached keyless cosign signatures
and GitHub SLSA/SBOM attestations tied to the exact workflow, source commit,
ref, and hosted runner. Those detached records must verify before the reusable
Linux job uploads its Actions artifact, after transfer to the central finalizer,
and over the aggregate draft and public release. A local package is not
represented as signed merely because it has the same filename.

## Feature boundaries

- Apple Photos and `osxphotos` are macOS-only. Linux uses Photo folders,
  mounted volumes, and portable EXIF/XMP metadata.
- Face matching, clustering, OCR, semantic photo/video search, review,
  organization, editing, SQLCipher, and C2PA use packaged cross-platform
  runtimes. The shipped ONNX Runtime path is CPU-only on Linux.
- The current Qwen/Smol VLM and local generative-edit catalogs contain macOS
  and Windows native runtime artifacts only. VLM captions/agent planning,
  multimodal Safe Mode, cleanup/upscale, and heavy generative edits therefore
  remain capability-gated on Linux rather than downloading an unverified
  fallback. The ONNX compatibility Safe Mode remains available.
- AppImage, deb, and RPM are roughly 700-785 MB at version 0.1.0 because they
  include Electron plus the frozen CV/ML backend. Optional model weights are
  still installed separately.

## Build and verification

```bash
npm ci
npm run electron:install
python -m pip install --require-hashes -r requirements-production.lock.txt
npm run test:dependency-currency
npm run test:linux-distribution
npm run dist:linux
VINTRACE_LINUX_PACKAGE_REQUIRED=1 npm run linux:package:check
npm run test:e2e:packaged
```

The native artifact checker validates exact x64 targets, package metadata and
dependencies, aggregate update hashes, desktop identity, executable
architecture, unresolved libraries, the frozen backend, ONNX Runtime 1.27,
C2PA, third-party notices, and a byte-identical production lock. The hosted
workflow repeats source, frozen, package, UI, SBOM, attestation, signature,
draft-download, and publication gates.

## Primary references

- [electron-builder Linux targets](https://www.electron.build/docs/linux/)
- [electron-builder AppImage behavior and toolsets](https://www.electron.build/appimage/)
- [electron-builder auto-update targets](https://www.electron.build/docs/features/auto-update/)
- [Electron safeStorage on Linux](https://www.electronjs.org/docs/latest/api/safe-storage)
- [GitHub-hosted runner hardware](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Ubuntu 22.04 libsecret-tools](https://packages.ubuntu.com/jammy/libsecret-tools)
- [Fedora libsecret package contents](https://packages.fedoraproject.org/pkgs/libsecret/libsecret/fedora-42.html)

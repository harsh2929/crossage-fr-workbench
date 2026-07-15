# Dependency Currency and Native Runtime Contract

Last verified: 2026-07-13

Vintrace releases are pinned to Electron `43.1.0` and ONNX Runtime `1.27.0`.
The pins are enforced as executable release contracts rather than documentation
only.

## Supported release targets

| Target | Contract | Reason |
|---|---|---|
| macOS | Apple Silicon, macOS 14 or newer | ONNX Runtime 1.27 publishes a `macosx_14_0_arm64` wheel and no macOS x64 wheel. The macOS release job uses the arm64 `macos-15` runner. |
| Windows | Windows x64 | The release job installs the CPython 3.11 `win_amd64` wheel, freezes it, signs it, and runs the frozen and packaged smoke tests. |
| Linux | Linux x64, Ubuntu 22.04/glibc 2.35 release baseline | AppImage, deb, and RPM include the CPython 3.11 x64 wheel and frozen CPU runtime. Debian 12/glibc 2.36 native package and packaged-app acceptance passed. Linux arm64 is not a release target. |

The macOS x64 target is intentionally removed. Restoring it would require an
upstream ONNX Runtime wheel or a separately maintained, reproducible native
build with equivalent security and packaging evidence.

## Electron contract

`desktop/scripts/check-dependency-currency.cjs` verifies all of the following:

- exact package and lock resolution `electron==43.1.0`;
- build Node range `>=22.12.0 <25`;
- an explicitly installed Electron binary rather than an implicit npm
  postinstall side effect;
- runtime tuple Electron `43.1.0`, Chromium `150.0.7871.47`, Node `24.18.0`,
  V8 `15.0.245.13-electron.0`, and native modules ABI `148`;
- no production npm dependency with a native binding or install script that
  would need an Electron ABI rebuild;
- macOS 14+/arm64, Windows x64, and AppImage/deb/RPM Linux x64 electron-builder targets.

Electron 42 stopped downloading its binary from the npm postinstall hook.
`npm ci` therefore leaves `node_modules/electron/path.txt` absent by design.
`npm run electron:install` performs the checksummed download explicitly and is
mandatory in QA and all three desktop release workflows. Local `npm start` runs the same
step through `prestart`.

Electron 42 also requires signed macOS applications for reliable system
notifications. Production releases are already fail-closed on signing and
notarization; notification delivery failures are now recorded as local
diagnostic events. File, image, audio, model, and profile pickers set explicit
Pictures/Music/Documents defaults so the Electron 43 dialog-default change does
not silently move established workflows to Downloads.

Primary references:

- [Electron 43.1.0 release](https://releases.electronjs.org/release/v43.1.0)
- [Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)
- [Electron installation](https://www.electronjs.org/docs/latest/tutorial/installation)

## ONNX Runtime contract

`requirements-production.txt` and the universal hash lock pin
`onnxruntime==1.27.0`. The lock contains all 24 published 1.27.0 wheel hashes
and explicitly checks the supported CPython 3.11 wheel hashes for macOS arm64,
Windows x64/arm64, and Linux x64/arm64. Conflicting `onnxruntime-gpu`, OpenVINO,
or training distributions are rejected.

`crossage_fr/dependency_currency.py` verifies the package/runtime version,
native extension path, CPU provider, CoreML provider on Apple Silicon, absence
of conflicting distributions, and a real in-memory ONNX identity inference.
The report is part of runtime self-test, the frozen sidecar acceptance test,
and packaged Electron Playwright acceptance.

PyInstaller uses a repository hook with `collect_dynamic_libs` and copied
distribution metadata, plus `--collect-all onnxruntime`. Build preflight runs
the native inference before freezing. The artifact gate then requires:

- `onnxruntime/capi/onnxruntime_pybind11_state`;
- the platform ONNX Runtime 1.27 native library;
- `onnxruntime-1.27.0.dist-info/METADATA`;
- the upstream MIT license;
- a sidecar manifest recording the successful exact-version inference probe.

The exact `requirements-production.lock.txt` used to build the sidecar is also
packaged as an application resource.

Primary references:

- [ONNX Runtime 1.27.0 release](https://github.com/microsoft/onnxruntime/releases/tag/v1.27.0)
- [ONNX Runtime 1.27.0 PyPI files](https://pypi.org/project/onnxruntime/1.27.0/)

## Security audit

The first 2026-07-13 `pip-audit 2.10.1` run found eight current advisories in
four resolver-selected transitive versions. No advisory was ignored. The input
contract now pins the fixed releases:

| Package | Rejected | Fixed pin |
|---|---:|---:|
| Mako | 1.2.4 | 1.3.12 |
| onnx | 1.21.0 | 1.22.0 |
| Pillow | 12.2.0 | 12.3.0 |
| pydantic-settings | 2.14.1 | 2.14.2 |

The regenerated universal lock passes `pip-audit --require-hashes` with no
known vulnerabilities. Full and production-only npm audits both report zero
vulnerabilities. Linux QA reruns the full npm audit and an isolated, pinned
`pip-audit 2.10.1` lock audit on every change; macOS and Windows release jobs
repeat the isolated audit so platform-marked dependencies are evaluated on the
OS that ships them.

## Reproduction

```bash
npm ci
npm run electron:install
python -m pip install --require-hashes -r requirements-production.lock.txt
npm run test:dependency-currency
npm run build:backend
VINTRACE_DEPENDENCY_TEST_EXECUTABLE="$PWD/backend-dist/crossage-backend/crossage-backend" npm run test:frozen-dependency-currency
npm run package:check
npm run test:e2e:packaged
```

Release workflows repeat these gates under Python 3.11, then run platform
package evidence and signing/attestation gates. The central tag-bound finalizer
then re-verifies all transferred platform evidence, assembles one aggregate
release, verifies draft and public downloads, and publishes once. See [Linux
Distribution](linux-distribution.md) for the Linux keyring, format, update,
feature, and support boundaries.

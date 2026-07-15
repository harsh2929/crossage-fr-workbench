# Release Signing

Vintrace production release workflows are fail closed. The macOS workflow always requires a Developer ID signature and Apple notarization; the Windows workflow always uses Azure Artifact Signing with GitHub OIDC. Linux packages have no equivalent OS publisher identity, so their workflow requires detached keyless cosign signatures and GitHub attestations. Applicable signature, timestamp, notarization, attestation, and platform checks run before an artifact can be uploaded or attached to a release.

The three platform workflows upload Actions artifacts only. They cannot publish independently. The tag-bound `Cross-Platform Release` workflow calls all three, rejects missing/colliding payloads, creates one aggregate evidence set, verifies one authenticated draft, publishes once, verifies public downloads, and only then publishes MCP Registry metadata.

The explicit `*:unsigned` npm scripts are for local development only. Their outputs are never uploaded or published by a release workflow.

## macOS

Provision a Developer ID Application certificate in the Apple Developer account and store these GitHub Actions secrets:

- `MACOS_CERTIFICATE`: base64-encoded `.p12` containing the Developer ID Application certificate and private key.
- `MACOS_CERTIFICATE_PASSWORD`: password for the `.p12`.
- `APPLE_API_KEY_BASE64`: base64-encoded App Store Connect API `.p8` key.
- `APPLE_API_KEY_ID`: API key ID.
- `APPLE_API_ISSUER`: API issuer ID.

The workflow writes the API key to a mode-`0600` temporary file, runs electron-builder with `forceCodeSigning`, hardened runtime, entitlements, and notarization enabled, then requires all of these checks:

- `codesign --verify --deep --strict` on `Vintrace.app`.
- a `Developer ID Application` authority and Apple Team ID.
- `spctl --assess` on the app and DMG.
- `xcrun stapler validate` on the app and DMG.

Apple's current guidance requires Developer ID signing for direct distribution and recommends notarization plus stapling: [Developer ID](https://developer.apple.com/developer-id/) and [notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

## Windows

Create an Azure Artifact Signing account, complete identity validation, create a Public Trust certificate profile, and grant the federated application the `Artifact Signing Certificate Profile Signer` role for that profile. Configure a GitHub Actions federated credential for this repository and workflow, without a client secret.

Store these GitHub Actions secrets:

- `AZURE_CLIENT_ID`: Microsoft Entra application/client ID used by the GitHub OIDC federation.
- `AZURE_TENANT_ID`: Microsoft Entra tenant ID.
- `AZURE_SUBSCRIPTION_ID`: Azure subscription containing the signing account.
- `AZURE_ARTIFACT_SIGNING_ENDPOINT`: regional HTTPS signing endpoint, for example `https://eus.codesigning.azure.net/`.
- `AZURE_ARTIFACT_SIGNING_ACCOUNT`: Artifact Signing account name.
- `AZURE_ARTIFACT_SIGNING_PROFILE`: certificate profile name.
- `AZURE_ARTIFACT_SIGNING_PUBLISHER`: exact publisher name from the certificate profile.

The reusable Windows workflow has read-only repository contents plus the OIDC, attestation, and artifact-metadata permissions required to build evidence. The central finalizer alone receives `contents: write` for publication. Windows authenticates through GitHub OIDC and passes Azure signing options directly to electron-builder. Electron-builder signs the packaged app executable, bundled backend executable, and NSIS installer with SHA-256 plus the Artifact Signing RFC 3161 timestamp service. Publication requires `Get-AuthenticodeSignature` to report `Valid`, the configured publisher, and a timestamp certificate for every required executable.

Microsoft documents Azure Artifact Signing as the recommended non-Store signing route and notes that SmartScreen reputation still builds over time: [Windows code-signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options). The service has geographic eligibility limits, so confirm that the publishing organization or individual is eligible before depending on this release path. Setup and role details are in the [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) and the official [GitHub action documentation](https://github.com/Azure/artifact-signing-action).

## Linux

AppImage, deb, and RPM do not carry an Apple/Windows-style Vintrace publisher
identity. The Linux workflow does not claim native package signing. It uses the
same hosted OIDC supply-chain controls as the other release workflows:

- GitHub SLSA Build L2 provenance over every checksummed release subject;
- CycloneDX 1.6 and SPDX 2.3 SBOM attestations;
- one keyless cosign bundle per artifact and checksum manifest;
- exact workflow, repository, source commit/ref, issuer, and hosted-runner
  verification before platform upload, after transfer to the finalizer, and over
  the aggregate draft and public release.

These are detached supply-chain records. They do not make `rpm -K`, `dpkg`, or
an application menu display a Vintrace publisher, and they do not replace apt,
dnf, or zypper repository signing. Vintrace does not currently operate such a
repository. See [Linux Distribution](linux-distribution.md) and
[Release Supply-Chain Evidence](release-supply-chain.md).

## Release Gate

Runtime `release_readiness` uses the same exact credential contract as the hosted workflows: all five macOS names above and all seven Windows names above must be present. Legacy `CSC_LINK`/Apple-ID variables do not count. The Azure endpoint must be an absolute HTTPS URL with a hostname and without embedded credentials, query parameters, or fragments. Readiness output contains required/missing names and booleans only; it never echoes secret values.

Run the static policy check before editing any release workflow:

```bash
npm run test:release-signing-policy
```

The workflow itself remains the certificate-backed acceptance test. SEC-01 is not complete until one macOS and one Windows production run pass their platform verification steps and the resulting signed installers are downloaded and independently checked.

Create and push the exact `v<package.json version>` tag, then dispatch the central workflow on that tag (the `--ref` value is mandatory):

```bash
version="$(node -p "require('./package.json').version")"
tag="v${version}"
gh workflow run release.yml \
  --repo harsh2929/crossage-fr-workbench \
  --ref "$tag" \
  -f release_tag="$tag" \
  -f prerelease=true
```

The workflow refuses a branch dispatch, version/tag mismatch, moved tag, existing published release, or populated failed draft. If that version already has a published tag, increment the application version and its locks instead of reusing the tag. Delete a failed draft explicitly before retrying; release assets are never silently overwritten.

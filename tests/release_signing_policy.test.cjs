#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));
const mac = read(".github/workflows/macos-release.yml");
const windows = read(".github/workflows/windows-release.yml");
const linux = read(".github/workflows/linux-release.yml");
const release = read(".github/workflows/release.yml");
const guide = read("docs/release-signing.md");
const apiServer = read("crossage_fr/api_server.py");

assert.equal(pkg.build?.mac?.forceCodeSigning, true, "macOS production packaging must fail without signing");
assert.equal(pkg.build?.mac?.hardenedRuntime, true, "macOS production packaging must use hardened runtime");
assert.equal(pkg.build?.mac?.notarize, true, "macOS production packaging must notarize");
assert.equal(pkg.build?.win?.forceCodeSigning, true, "Windows production packaging must fail without signing");
assert.deepEqual(pkg.build?.win?.signExts, [".exe"], "bundled Windows executables must be included in signing");

for (const name of ["pack:unsigned", "dist:mac:unsigned", "dist:win:unsigned"]) {
  assert.match(pkg.scripts?.[name] || "", /forceCodeSigning=false/, `${name} must be an explicit development-only override`);
}
assert.match(pkg.scripts["dist:mac:unsigned"], /hardenedRuntime=false/);
assert.match(pkg.scripts["dist:mac:unsigned"], /notarize=false/);

assert.doesNotMatch(mac, /sign_and_notarize|Build unsigned|macOS-Unsigned/);
assert.match(mac, /MACOS_CERTIFICATE/);
assert.match(mac, /MACOS_CERTIFICATE_PASSWORD: \$\{\{ secrets\.MACOS_CERTIFICATE_PASSWORD \}\}/);
assert.match(mac, /APPLE_API_KEY_BASE64/);
assert.match(mac, /codesign --verify --deep --strict/);
assert.match(mac, /Authority=Developer ID Application:/);
assert.match(mac, /spctl --assess --type execute/);
assert.match(mac, /xcrun stapler validate/);
assert.match(mac, /Vintrace-macOS-Signed-Notarized/);
assert.match(mac, /VINTRACE_ENCRYPTION_TEST_EXECUTABLE=.*crossage-backend/);

assert.doesNotMatch(windows, /sign_installer|Build unsigned|WINDOWS_CERTIFICATE|CSC_LINK|Windows-Unsigned/);
assert.match(windows, /id-token: write/);
assert.match(windows, /azure\/login@[a-f0-9]{40}/);
assert.match(windows, /AZURE_ARTIFACT_SIGNING_ENDPOINT/);
assert.match(windows, /AZURE_ARTIFACT_SIGNING_ACCOUNT/);
assert.match(windows, /AZURE_ARTIFACT_SIGNING_PROFILE/);
assert.match(windows, /AZURE_ARTIFACT_SIGNING_PUBLISHER/);
assert.match(windows, /endpoint\.Host/);
assert.match(windows, /endpoint\.UserInfo/);
assert.match(windows, /endpoint\.Query/);
assert.match(windows, /endpoint\.Fragment/);
assert.match(windows, /config\.win\.forceCodeSigning=true/);
assert.match(windows, /config\.win\.azureSignOptions\.endpoint/);
assert.match(windows, /timestamp\.acs\.microsoft\.com/);
assert.match(windows, /Get-AuthenticodeSignature/);
assert.match(windows, /TimeStamperCertificate/);
assert.match(windows, /Vintrace-Windows-Signed-Azure/);
assert.match(windows, /VINTRACE_ENCRYPTION_TEST_EXECUTABLE.*crossage-backend\.exe/);

assert.match(linux, /electron-builder --linux AppImage deb rpm --x64 --publish never/);
assert.match(linux, /VINTRACE_LINUX_PACKAGE_REQUIRED/);
assert.match(linux, /npm run release:sign/);
assert.match(linux, /npm run release:attest:verify/);
assert.match(linux, /Vintrace-Linux-x64-Sigstore/);
assert.doesNotMatch(linux, /native Linux code signing|Authenticode|codesign/);

for (const [label, workflow] of [["macOS", mac], ["Windows", windows], ["Linux", linux]]) {
  const lifecycleSource = workflow.indexOf("python tests/model_lifecycle_units.py");
  const lifecycleEvaluation = workflow.indexOf("python benchmarks/run_model_lifecycle_evals.py");
  const audioSource = workflow.indexOf("python tests/audio_intelligence_units.py");
  const buildBackend = workflow.indexOf("npm run build:backend");
  const lifecycleAcceptance = workflow.indexOf("npm run test:frozen-model-lifecycle");
  const audioAcceptance = workflow.indexOf("npm run test:frozen-audio-intelligence");
  const encryptionAcceptance = workflow.indexOf("npm run test:frozen-workspace-encryption");
  const complianceAcceptance = workflow.indexOf("npm run test:frozen-compliance");
  const mobileAcceptance = workflow.indexOf("npm run test:frozen-mobile-companion");
  const packageDesktop = workflow.indexOf("npx electron-builder");
  assert.ok(
    lifecycleSource >= 0
      && lifecycleSource < lifecycleEvaluation
      && lifecycleEvaluation < audioSource
      && audioSource < buildBackend
      && buildBackend < lifecycleAcceptance
      && lifecycleAcceptance < audioAcceptance
      && audioAcceptance < encryptionAcceptance
      && buildBackend < encryptionAcceptance
      && encryptionAcceptance < complianceAcceptance
      && complianceAcceptance < mobileAcceptance
      && mobileAcceptance < packageDesktop,
    `${label} must validate lifecycle evidence and frozen backend state before packaging`,
  );
}

for (const [label, workflow, verifyMarker, uploadMarker] of [
  ["macOS", mac, "Verify signature, notarization, and stapling", "Upload macOS installer"],
  ["Windows", windows, "Verify Azure Authenticode signatures and timestamps", "Upload installer"],
  ["Linux", linux, "Validate signed Linux release set", "Upload Linux packages"],
]) {
  const verify = workflow.indexOf(verifyMarker);
  const upload = workflow.indexOf(uploadMarker);
  assert.ok(verify >= 0 && verify < upload, `${label} must verify before uploading its caller-scoped artifact`);
  assert.match(workflow, /workflow_call:/, `${label} workflow must be reusable by the finalizer`);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|Publish verified GitHub Release/, `${label} workflow must not publish independently`);
}

for (const reusable of ["macos-release.yml", "windows-release.yml", "linux-release.yml"]) {
  assert.ok(release.includes(`uses: ./.github/workflows/${reusable}`), `finalizer must call ${reusable}`);
}
const assemble = release.indexOf("Revalidate and assemble all platform payloads");
const transferredVerify = release.indexOf("Cryptographically reverify transferred platform evidence");
const aggregateVerify = release.indexOf("Verify aggregate GitHub attestations and keyless signatures");
const stage = release.indexOf("Stage the complete release exactly once");
const stagedVerify = release.indexOf("Verify the complete staged release");
const publish = release.indexOf("Publish the verified release once");
const publicVerify = release.indexOf("Verify public downloads after publication");
const registryPublish = release.indexOf("Publish the immutable MCP Registry descriptor");
assert.ok(assemble >= 0 && assemble < transferredVerify && transferredVerify < aggregateVerify && aggregateVerify < stage && stage < stagedVerify && stagedVerify < publish && publish < publicVerify && publicVerify < registryPublish);
assert.match(release, /RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/);
assert.match(release, /test "\$GITHUB_REF" = "refs\/tags\/\$RELEASE_TAG"/);
assert.match(release, /git fetch --no-tags origin "\+refs\/tags\/\$\{RELEASE_TAG\}:refs\/tags\/\$\{RELEASE_TAG\}"/);
assert.doesNotMatch(release, /tag: `\$\{\{ inputs\.release_tag \}\}`/);
assert.match(release, /runner\.temp }}\/vintrace-platforms\/macos/);
assert.doesNotMatch(release, /path: staging\//);
assert.match(release, /--platform all --full --require-release-metadata --verify-signatures --allow-draft/);
assert.match(release, /overwrite_files: false/);

for (const credential of [
  "MACOS_CERTIFICATE",
  "MACOS_CERTIFICATE_PASSWORD",
  "APPLE_API_KEY_BASE64",
  "AZURE_CLIENT_ID",
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_PROFILE",
]) {
  assert.match(guide, new RegExp(`\\b${credential}\\b`), `setup guide must document ${credential}`);
}
assert.match(guide, /Artifact Signing Certificate Profile Signer/);
assert.match(guide, /unsigned.*never uploaded or published/is);

for (const value of [
  "MACOS_CERTIFICATE",
  "APPLE_API_KEY_BASE64",
  "AZURE_CLIENT_ID",
  "AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "AZURE_ARTIFACT_SIGNING_PUBLISHER",
]) {
  assert.match(apiServer, new RegExp(`\\"${value}\\"`), `release readiness must detect ${value}`);
}
assert.doesNotMatch(apiServer, /WIN_CSC_LINK/);

const { DebugLogger } = require("builder-util");
const { validateConfiguration } = require("app-builder-lib/out/util/config/config");
validateConfiguration(pkg.build, new DebugLogger(false)).then(() => {
  console.log("release signing policy ok");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

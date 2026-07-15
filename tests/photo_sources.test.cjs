"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  DEFAULT_SOURCE_FS_TIMEOUT_MS,
  buildSystemPhotoSources,
  defaultMountRoots,
  mountedCameraPhotoSources,
  mountedDrivePhotoSources,
  photoPrivacySettingsUrl,
  uniquePhotoSources,
} = require("../desktop/main/photo-sources.cjs");

function testPhotoPrivacySettingsUrlsAreFixed() {
  assert.strictEqual(
    photoPrivacySettingsUrl("darwin"),
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
  );
  assert.strictEqual(photoPrivacySettingsUrl("win32"), "ms-settings:privacy-broadfilesystemaccess");
  assert.strictEqual(photoPrivacySettingsUrl("linux"), "");
}

async function testMountedDrivePhotoSourcesEnumeratesVolumes() {
  const root = makeTempDir();
  for (const volume of ["MyUSB", "SD Card", "Backup Drive"]) {
    fs.mkdirSync(path.join(root, volume, "Photos"), { recursive: true });
  }
  fs.writeFileSync(path.join(root, "loose-file.txt"), "x");
  const drives = await mountedDrivePhotoSources({ platform: "darwin", mountRoots: [root] });
  assert.deepStrictEqual(
    drives.map((source) => source.label).sort(),
    ["Backup Drive", "MyUSB", "SD Card"],
    drives
  );
  assert.ok(drives.every((source) => source.kind === "drive"), "drives should have kind 'drive'");
  assert.ok(drives.every((source) => source.available), "existing drives should be available");
  fs.rmSync(root, { recursive: true, force: true });
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-photo-sources-"));
}

async function testMountedCameraDcimSources() {
  const root = makeTempDir();
  const volumes = path.join(root, "Volumes");
  const camera = path.join(volumes, "EOS_CARD");
  const dcim = path.join(camera, "DCIM");
  fs.mkdirSync(path.join(dcim, "100CANON"), { recursive: true });
  fs.mkdirSync(path.join(volumes, "Docs", "Files"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "darwin", mountRoots: [volumes] });
  assert.strictEqual(sources.length, 1, sources);
  assert.strictEqual(sources[0].id, "mounted-camera-eos-card");
  assert.strictEqual(sources[0].label, "EOS_CARD DCIM");
  assert.strictEqual(sources[0].kind, "camera");
  assert.strictEqual(sources[0].path, dcim);
  assert.strictEqual(sources[0].available, true);
  assert.ok(sources[0].detail.includes("SD-card"));

  fs.rmSync(root, { recursive: true, force: true });
}

async function testMountedDcimRootSources() {
  const root = makeTempDir();
  const dcim = path.join(root, "DCIM");
  fs.mkdirSync(path.join(dcim, "100APPLE"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "linux", mountRoots: [dcim] });
  assert.strictEqual(sources.length, 1, sources);
  assert.strictEqual(sources[0].kind, "camera");
  assert.strictEqual(sources[0].path, dcim);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testMountedVolumeRootSources() {
  const root = makeTempDir();
  const volume = path.join(root, "EOS_CARD");
  const dcim = path.join(volume, "DCIM");
  fs.mkdirSync(path.join(dcim, "100CANON"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "darwin", mountRoots: [volume] });
  assert.strictEqual(sources.length, 1, sources);
  assert.strictEqual(sources[0].id, "mounted-camera-eos-card");
  assert.strictEqual(sources[0].label, "EOS_CARD DCIM");
  assert.strictEqual(sources[0].path, dcim);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testMountedPhoneNestedDcimSources() {
  const root = makeTempDir();
  const volumes = path.join(root, "Volumes");
  const dcim = path.join(volumes, "Pixel 8", "Internal shared storage", "DCIM");
  fs.mkdirSync(path.join(dcim, "Camera"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "darwin", mountRoots: [volumes] });
  assert.strictEqual(sources.length, 1, sources);
  assert.strictEqual(sources[0].id, "mounted-camera-pixel-8-internal-shared-storage-dcim");
  assert.strictEqual(sources[0].label, "Pixel 8 Internal shared storage/DCIM");
  assert.strictEqual(sources[0].kind, "camera");
  assert.strictEqual(sources[0].path, dcim);
  assert.strictEqual(sources[0].available, true);
  assert.ok(sources[0].detail.includes("Internal shared storage"));

  fs.rmSync(root, { recursive: true, force: true });
}

async function testMountedVolumeMultipleMediaRootsHaveUniqueIds() {
  const root = makeTempDir();
  const volumes = path.join(root, "Volumes");
  const volume = path.join(volumes, "HYBRID_CARD");
  const dcim = path.join(volume, "DCIM");
  const privateRoot = path.join(volume, "PRIVATE");
  const mpRoot = path.join(volume, "MP_ROOT");
  fs.mkdirSync(path.join(dcim, "100APPLE"), { recursive: true });
  fs.mkdirSync(path.join(privateRoot, "AVCHD"), { recursive: true });
  fs.mkdirSync(path.join(mpRoot, "100ANV01"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "darwin", mountRoots: [volumes] });
  assert.deepStrictEqual(sources.map((source) => source.id), [
    "mounted-camera-hybrid-card",
    "mounted-camera-hybrid-card-private",
    "mounted-camera-hybrid-card-mp-root",
  ]);
  assert.deepStrictEqual(sources.map((source) => source.path), [dcim, privateRoot, mpRoot]);

  fs.rmSync(root, { recursive: true, force: true });
}

async function testNonMediaMountedVolumeIgnored() {
  const root = makeTempDir();
  const volumes = path.join(root, "Volumes");
  fs.mkdirSync(path.join(volumes, "Docs", "Files"), { recursive: true });

  const sources = await mountedCameraPhotoSources({ platform: "darwin", mountRoots: [volumes] });
  assert.deepStrictEqual(sources, []);

  fs.rmSync(root, { recursive: true, force: true });
}

function timeoutReject(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
}

async function testSlowMountedRootDoesNotBlockCameraDiscovery() {
  const root = makeTempDir();
  const slowRoot = path.join(root, "SlowVolumes");
  const fastRoot = path.join(root, "FastVolumes");
  const dcim = path.join(fastRoot, "EOS_CARD", "DCIM");
  fs.mkdirSync(slowRoot, { recursive: true });
  fs.mkdirSync(path.join(dcim, "100CANON"), { recursive: true });

  const originalReaddir = fs.promises.readdir;
  fs.promises.readdir = function patchedReaddir(targetPath, options) {
    if (path.resolve(String(targetPath)) === path.resolve(slowRoot)) {
      return new Promise(() => {});
    }
    return originalReaddir.call(fs.promises, targetPath, options);
  };
  try {
    const sources = await Promise.race([
      mountedCameraPhotoSources({
        platform: "darwin",
        mountRoots: [slowRoot, fastRoot],
        fsTimeoutMs: 5,
      }),
      timeoutReject(250, "mounted camera source discovery"),
    ]);
    assert.deepStrictEqual(sources.map((source) => source.path), [dcim]);
  } finally {
    fs.promises.readdir = originalReaddir;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testSlowMountedDriveRealpathFallsBackPromptly() {
  const root = makeTempDir();
  const drive = path.join(root, "Backup Drive");
  fs.mkdirSync(drive, { recursive: true });

  const originalRealpath = fs.promises.realpath;
  fs.promises.realpath = function patchedRealpath(targetPath, options) {
    if (path.resolve(String(targetPath)) === path.resolve(drive)) {
      return new Promise(() => {});
    }
    return originalRealpath.call(fs.promises, targetPath, options);
  };
  try {
    const drives = await Promise.race([
      mountedDrivePhotoSources({
        platform: "darwin",
        mountRoots: [root],
        fsTimeoutMs: 5,
      }),
      timeoutReject(250, "mounted drive source discovery"),
    ]);
    assert.strictEqual(drives.length, 1, drives);
    assert.strictEqual(drives[0].path, drive);
    assert.strictEqual(drives[0].label, "Backup Drive");
  } finally {
    fs.promises.realpath = originalRealpath;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testBuildSystemPhotoSourcesIncludesMountedOverride() {
  const root = makeTempDir();
  const pictures = path.join(root, "Pictures");
  const volumes = path.join(root, "mnt");
  const dcim = path.join(volumes, "PHONE", "dcim");
  fs.mkdirSync(pictures, { recursive: true });
  fs.mkdirSync(dcim, { recursive: true });

  const sources = await buildSystemPhotoSources({
    platform: "darwin",
    home: root,
    pictures,
    env: { VINTRACE_PHOTO_MOUNT_ROOTS: volumes },
  });
  assert.ok(sources.some((source) => source.id === "pictures" && source.path === pictures), sources);
  assert.ok(sources.some((source) => source.id === "apple-photos-library"), sources);
  assert.ok(sources.some((source) => source.id === "mounted-camera-phone" && source.path === dcim), sources);

  fs.rmSync(root, { recursive: true, force: true });
}

function testDefaultMountRoots() {
  assert.ok(DEFAULT_SOURCE_FS_TIMEOUT_MS > 0);
  assert.deepStrictEqual(defaultMountRoots("darwin", "/Users/alice", {}), ["/Volumes"]);
  const linuxRoots = defaultMountRoots("linux", "/home/alice", { USER: "alice" });
  assert.ok(linuxRoots.includes("/media/alice"));
  assert.ok(linuxRoots.includes("/run/media/alice"));
  const linuxGvfsRoots = defaultMountRoots("linux", "/home/alice", { USER: "alice", XDG_RUNTIME_DIR: "/run/user/501" });
  assert.ok(linuxGvfsRoots.includes("/run/user/501/gvfs"));
  assert.ok(defaultMountRoots("win32", "C:\\Users\\Alice", {}).some((entry) => entry === "D:\\"));
  assert.deepStrictEqual(defaultMountRoots("darwin", "/Users/alice", { VINTRACE_PHOTO_MOUNT_ROOTS: "/tmp/a:/tmp/b" }), ["/tmp/a", "/tmp/b"]);
}

function testUniquePhotoSourcesDedupesResolvedPaths() {
  const root = makeTempDir();
  const photos = path.join(root, "Photos");
  fs.mkdirSync(photos);
  const sources = uniquePhotoSources([
    { id: "a", path: photos },
    { id: "b", path: path.join(root, ".", "Photos") },
    { id: "c", path: "" },
  ]);
  assert.deepStrictEqual(sources.map((source) => source.id), ["a"]);
  fs.rmSync(root, { recursive: true, force: true });
}

function testAppleDependencyPackagingIsMacOnly() {
  const root = path.resolve(__dirname, "..");
  const requirements = fs.readFileSync(path.join(root, "requirements.txt"), "utf8");
  const lock = fs.readFileSync(path.join(root, "requirements-production.lock.txt"), "utf8");
  const buildBackend = fs.readFileSync(path.join(root, "desktop", "scripts", "build-backend.cjs"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(requirements, /^osxphotos==0\.76\.1; sys_platform == "darwin"$/m);
  assert.match(lock, /^osxphotos==0\.76\.1 ; sys_platform == 'darwin' \\/m);
  assert.match(buildBackend, /const applePhotosEnabled = process\.platform === "darwin";/);
  assert.match(buildBackend, /\.\.\.\(applePhotosEnabled\s*\? applePhotosCollectionPackages\.flatMap/);
  assert.ok(
    packageJson.build.extraResources.some((resource) => resource.from === "THIRD_PARTY_NOTICES.md"),
    "Electron package must include the osxphotos MIT notice"
  );
}

async function main() {
  await testMountedCameraDcimSources();
  await testMountedDcimRootSources();
  await testMountedVolumeRootSources();
  await testMountedPhoneNestedDcimSources();
  await testMountedVolumeMultipleMediaRootsHaveUniqueIds();
  await testNonMediaMountedVolumeIgnored();
  await testSlowMountedRootDoesNotBlockCameraDiscovery();
  await testSlowMountedDriveRealpathFallsBackPromptly();
  await testBuildSystemPhotoSourcesIncludesMountedOverride();
  await testMountedDrivePhotoSourcesEnumeratesVolumes();
  testDefaultMountRoots();
  testPhotoPrivacySettingsUrlsAreFixed();
  testUniquePhotoSourcesDedupesResolvedPaths();
  testAppleDependencyPackagingIsMacOnly();
  console.log("photo sources ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

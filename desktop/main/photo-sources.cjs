"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_SOURCE_FS_TIMEOUT_MS = 1500;

function photoPrivacySettingsUrl(platform = process.platform) {
  if (platform === "darwin") {
    return "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
  }
  if (platform === "win32") {
    return "ms-settings:privacy-broadfilesystemaccess";
  }
  return "";
}

async function withFsTimeout(operation, fallback, timeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  const ms = Math.max(1, Number(timeoutMs) || DEFAULT_SOURCE_FS_TIMEOUT_MS);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pathAvailable(targetPath, timeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  if (!targetPath) return false;
  return withFsTimeout(async () => {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  }, false, timeoutMs);
}

async function pathIsDirectory(targetPath, timeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  if (!targetPath) return false;
  return withFsTimeout(async () => (await fs.promises.stat(targetPath)).isDirectory(), false, timeoutMs);
}

async function safeReadDir(targetPath, limit = 80, timeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  if (!targetPath) return [];
  const entries = await withFsTimeout(
    () => fs.promises.readdir(targetPath, { withFileTypes: true }),
    [],
    timeoutMs
  );
  return Array.isArray(entries) ? entries.slice(0, limit) : [];
}

async function safeRealpath(targetPath, timeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  if (!targetPath) return "";
  return withFsTimeout(() => fs.promises.realpath(targetPath), "", timeoutMs);
}

async function photoSource(id, label, detail, sourcePath, kind = "folder", platform = process.platform, options = {}) {
  return {
    id,
    label,
    detail,
    path: sourcePath,
    kind,
    platform,
    available: await pathAvailable(sourcePath, options.fsTimeoutMs)
  };
}

async function childDirectories(parent, wantedNames, fsTimeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  const matches = [];
  const entries = await safeReadDir(parent, 80, fsTimeoutMs);
  for (const wantedName of wantedNames) {
    const wanted = String(wantedName).toLowerCase();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.toLowerCase() === wanted) {
        matches.push(path.join(parent, entry.name));
      }
    }
  }
  return matches;
}

function uniquePhotoSources(sources) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = path.resolve(source.path || "");
    if (!source.path || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function sourceSlug(value) {
  return String(value || "camera")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "camera";
}

const CAMERA_MEDIA_ROOT_NAMES = ["DCIM", "PRIVATE", "MP_ROOT", "AVCHD"];

function defaultMountRoots(platform = process.platform, home = os.homedir(), env = process.env) {
  const override = String(env.VINTRACE_PHOTO_MOUNT_ROOTS || "").trim();
  if (override) {
    return override.split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  }
  if (platform === "darwin") {
    return ["/Volumes"];
  }
  if (platform === "win32") {
    return "DEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => `${letter}:\\`);
  }
  const user = String(env.USER || env.LOGNAME || path.basename(home || "") || "").trim();
  const runtimeDir = String(env.XDG_RUNTIME_DIR || "").trim();
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  return [
    user ? path.join("/media", user) : "",
    "/media",
    "/mnt",
    user ? path.join("/run/media", user) : "",
    runtimeDir ? path.join(runtimeDir, "gvfs") : "",
    uid ? path.join("/run/user", uid, "gvfs") : "",
  ].filter(Boolean);
}

function mountedMediaRootCandidate(volumePath, mediaPath, relativeParts) {
  const volumeName = path.basename(volumePath) || "Camera";
  const relativeLabel = relativeParts.join("/");
  const relativeSlug = relativeParts.map((part) => String(part || "")).join("-");
  const directDcimOnly = relativeParts.length === 1 && relativeParts[0].toLowerCase() === "dcim";
  const parentLabel = relativeParts.length > 1 ? relativeParts.slice(0, -1).join("/") : "";
  return {
    id: `mounted-camera-${sourceSlug(directDcimOnly ? volumeName : `${volumeName}-${relativeSlug}`)}`,
    label: `${volumeName} ${relativeLabel}`,
    detail: parentLabel
      ? `Mounted camera, phone, or SD-card media folder inside ${parentLabel}.`
      : "Mounted camera, phone, or SD-card media folder.",
    path: mediaPath,
  };
}

function looksLikePhoneStorageDirectory(name) {
  const lower = String(name || "").toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return (
    lower.includes("internal") ||
    lower.includes("shared storage") ||
    lower.includes("phone storage") ||
    lower.includes("external storage") ||
    lower === "sd card" ||
    lower === "sdcard"
  );
}

async function mountedMediaCandidatesForVolume(volumePath, fsTimeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS) {
  const candidates = [];
  for (const mediaPath of await childDirectories(volumePath, CAMERA_MEDIA_ROOT_NAMES, fsTimeoutMs)) {
    candidates.push(mountedMediaRootCandidate(volumePath, mediaPath, [path.basename(mediaPath)]));
  }
  for (const entry of await safeReadDir(volumePath, 80, fsTimeoutMs)) {
    if (!entry.isDirectory()) continue;
    if (CAMERA_MEDIA_ROOT_NAMES.some((name) => name.toLowerCase() === entry.name.toLowerCase())) continue;
    if (!looksLikePhoneStorageDirectory(entry.name)) continue;
    const storagePath = path.join(volumePath, entry.name);
    for (const mediaPath of await childDirectories(storagePath, CAMERA_MEDIA_ROOT_NAMES, fsTimeoutMs)) {
      candidates.push(mountedMediaRootCandidate(volumePath, mediaPath, [entry.name, path.basename(mediaPath)]));
    }
  }
  return candidates;
}

async function mountedCameraPhotoSources({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  mountRoots = defaultMountRoots(platform, home, env),
  maxVolumes = 40,
  fsTimeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS,
} = {}) {
  const sources = [];
  const addCandidate = async (candidate) => {
    sources.push(await photoSource(candidate.id, candidate.label, candidate.detail, candidate.path, "camera", platform, { fsTimeoutMs }));
  };
  for (const root of mountRoots) {
    if (!await pathIsDirectory(root, fsTimeoutMs)) continue;
    const resolvedRoot = path.resolve(root);
    const rootName = path.basename(resolvedRoot);
    if (CAMERA_MEDIA_ROOT_NAMES.some((name) => name.toLowerCase() === rootName.toLowerCase())) {
      await addCandidate(mountedMediaRootCandidate(path.dirname(resolvedRoot), resolvedRoot, [rootName]));
    }
    for (const candidate of await mountedMediaCandidatesForVolume(resolvedRoot, fsTimeoutMs)) {
      await addCandidate(candidate);
    }
    for (const entry of await safeReadDir(root, maxVolumes, fsTimeoutMs)) {
      if (!entry.isDirectory()) continue;
      const volumePath = path.join(root, entry.name);
      for (const candidate of await mountedMediaCandidatesForVolume(volumePath, fsTimeoutMs)) {
        await addCandidate(candidate);
      }
    }
  }
  return uniquePhotoSources(sources);
}

// Every mounted external drive / volume (not just camera cards) so the
// "index everything" consent sheet can offer them as one-tap scope chips. The
// boot/system volume is skipped (it's already covered by the Home folder scope).
async function mountedDrivePhotoSources({
  platform = process.platform,
  home = os.homedir(),
  env = process.env,
  mountRoots = defaultMountRoots(platform, home, env),
  maxVolumes = 40,
  fsTimeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS,
} = {}) {
  const sources = [];
  const seen = new Set();
  const addVolume = async (volumePath) => {
    if (!await pathIsDirectory(volumePath, fsTimeoutMs)) return;
    const resolved = path.resolve(volumePath);
    if (seen.has(resolved)) return;
    const real = await safeRealpath(resolved, fsTimeoutMs) || resolved;
    if (real === "/" || real.startsWith("/System/Volumes/")) return;
    seen.add(resolved);
    const name = path.basename(resolved) || resolved;
    sources.push(await photoSource(`drive-${sourceSlug(resolved)}`, name, "Mounted drive — index its photos in place.", resolved, "drive", platform, { fsTimeoutMs }));
  };
  for (const root of mountRoots) {
    if (!await pathIsDirectory(root, fsTimeoutMs)) continue;
    if (platform === "win32") {
      await addVolume(root);
    } else {
      for (const entry of await safeReadDir(root, maxVolumes, fsTimeoutMs)) {
        if (!entry.isDirectory()) continue;
        await addVolume(path.join(root, entry.name));
      }
    }
  }
  return uniquePhotoSources(sources);
}

async function buildSystemPhotoSources({
  platform = process.platform,
  home = os.homedir(),
  pictures = path.join(home, "Pictures"),
  env = process.env,
  mountRoots,
  fsTimeoutMs = DEFAULT_SOURCE_FS_TIMEOUT_MS,
} = {}) {
  const sources = [
    await photoSource(
      "this-computer",
      "This computer",
      "Index every photo across your Home folder in one library. Skips caches, app data, and system files; originals stay where they are.",
      home,
      "this-computer",
      platform,
      { fsTimeoutMs }
    ),
    await photoSource("pictures", "Pictures folder", "Default photo folder on this computer.", pictures, "folder", platform, { fsTimeoutMs })
  ];
  if (platform === "darwin") {
    const photosLibrary = path.join(pictures, "Photos Library.photoslibrary");
    sources.push(
      await photoSource("apple-photos-originals", "Apple Photos originals", "Original media inside the local Apple Photos library package.", path.join(photosLibrary, "originals"), "apple-photos", platform, { fsTimeoutMs }),
      await photoSource("apple-photos-library", "Apple Photos library", "Search the Photos library package if originals are stored in another package layout.", photosLibrary, "apple-photos", platform, { fsTimeoutMs }),
      await photoSource("icloud-drive", "iCloud Drive", "Useful when photos are exported or synced into iCloud Drive folders.", path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"), "folder", platform, { fsTimeoutMs })
    );
  } else if (platform === "win32") {
    const oneDriveRoot = env.OneDrive || path.join(home, "OneDrive");
    sources.push(
      await photoSource("windows-camera-roll", "Camera Roll", "Windows Photos camera import folder.", path.join(pictures, "Camera Roll"), "windows-photos", platform, { fsTimeoutMs }),
      await photoSource("windows-saved-pictures", "Saved Pictures", "Windows Photos saved media folder.", path.join(pictures, "Saved Pictures"), "windows-photos", platform, { fsTimeoutMs }),
      await photoSource("onedrive-pictures", "OneDrive Pictures", "Common Windows Photos and phone-sync location.", path.join(oneDriveRoot, "Pictures"), "windows-photos", platform, { fsTimeoutMs })
    );
  }
  return uniquePhotoSources([
    ...sources,
    ...(await mountedCameraPhotoSources({ platform, home, env, mountRoots, fsTimeoutMs })),
    ...(await mountedDrivePhotoSources({ platform, home, env, mountRoots, fsTimeoutMs })),
  ]);
}

module.exports = {
  buildSystemPhotoSources,
  mountedCameraPhotoSources,
  mountedDrivePhotoSources,
  defaultMountRoots,
  DEFAULT_SOURCE_FS_TIMEOUT_MS,
  photoSource,
  photoPrivacySettingsUrl,
  uniquePhotoSources,
};

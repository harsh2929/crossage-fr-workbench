"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

async function pathAvailable(targetPath) {
  try {
    if (!targetPath) return false;
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathIsDirectory(targetPath) {
  try {
    if (!targetPath) return false;
    return (await fs.promises.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

async function safeReadDir(targetPath, limit = 80) {
  try {
    return (await fs.promises.readdir(targetPath, { withFileTypes: true })).slice(0, limit);
  } catch {
    return [];
  }
}

async function photoSource(id, label, detail, sourcePath, kind = "folder", platform = process.platform) {
  return {
    id,
    label,
    detail,
    path: sourcePath,
    kind,
    platform,
    available: await pathAvailable(sourcePath)
  };
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

async function childDirectories(parent, wantedNames) {
  const matches = [];
  const entries = await safeReadDir(parent);
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

async function mountedMediaCandidatesForVolume(volumePath) {
  const candidates = [];
  for (const mediaPath of await childDirectories(volumePath, CAMERA_MEDIA_ROOT_NAMES)) {
    candidates.push(mountedMediaRootCandidate(volumePath, mediaPath, [path.basename(mediaPath)]));
  }
  for (const entry of await safeReadDir(volumePath)) {
    if (!entry.isDirectory()) continue;
    if (CAMERA_MEDIA_ROOT_NAMES.some((name) => name.toLowerCase() === entry.name.toLowerCase())) continue;
    if (!looksLikePhoneStorageDirectory(entry.name)) continue;
    const storagePath = path.join(volumePath, entry.name);
    for (const mediaPath of await childDirectories(storagePath, CAMERA_MEDIA_ROOT_NAMES)) {
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
} = {}) {
  const sources = [];
  const addCandidate = async (candidate) => {
    sources.push(await photoSource(candidate.id, candidate.label, candidate.detail, candidate.path, "camera", platform));
  };
  for (const root of mountRoots) {
    if (!await pathIsDirectory(root)) continue;
    const resolvedRoot = path.resolve(root);
    const rootName = path.basename(resolvedRoot);
    if (CAMERA_MEDIA_ROOT_NAMES.some((name) => name.toLowerCase() === rootName.toLowerCase())) {
      await addCandidate(mountedMediaRootCandidate(path.dirname(resolvedRoot), resolvedRoot, [rootName]));
    }
    for (const candidate of await mountedMediaCandidatesForVolume(resolvedRoot)) {
      await addCandidate(candidate);
    }
    for (const entry of await safeReadDir(root, maxVolumes)) {
      if (!entry.isDirectory()) continue;
      const volumePath = path.join(root, entry.name);
      for (const candidate of await mountedMediaCandidatesForVolume(volumePath)) {
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
} = {}) {
  const sources = [];
  const seen = new Set();
  const addVolume = async (volumePath) => {
    if (!await pathIsDirectory(volumePath)) return;
    const resolved = path.resolve(volumePath);
    if (seen.has(resolved)) return;
    let real = resolved;
    try {
      real = await fs.promises.realpath(resolved);
    } catch {
      /* keep resolved */
    }
    if (real === "/" || real.startsWith("/System/Volumes/")) return;
    seen.add(resolved);
    const name = path.basename(resolved) || resolved;
    sources.push(await photoSource(`drive-${sourceSlug(resolved)}`, name, "Mounted drive — index its photos in place.", resolved, "drive", platform));
  };
  for (const root of mountRoots) {
    if (!await pathIsDirectory(root)) continue;
    if (platform === "win32") {
      await addVolume(root);
    } else {
      for (const entry of await safeReadDir(root, maxVolumes)) {
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
} = {}) {
  const sources = [
    await photoSource(
      "this-computer",
      "This computer",
      "Index every photo across your Home folder in one library. Skips caches, app data, and system files; originals stay where they are.",
      home,
      "this-computer",
      platform
    ),
    await photoSource("pictures", "Pictures folder", "Default photo folder on this computer.", pictures, "folder", platform)
  ];
  if (platform === "darwin") {
    const photosLibrary = path.join(pictures, "Photos Library.photoslibrary");
    sources.push(
      await photoSource("apple-photos-originals", "Apple Photos originals", "Original media inside the local Apple Photos library package.", path.join(photosLibrary, "originals"), "apple-photos", platform),
      await photoSource("apple-photos-library", "Apple Photos library", "Search the Photos library package if originals are stored in another package layout.", photosLibrary, "apple-photos", platform),
      await photoSource("icloud-drive", "iCloud Drive", "Useful when photos are exported or synced into iCloud Drive folders.", path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"), "folder", platform)
    );
  } else if (platform === "win32") {
    const oneDriveRoot = env.OneDrive || path.join(home, "OneDrive");
    sources.push(
      await photoSource("windows-camera-roll", "Camera Roll", "Windows Photos camera import folder.", path.join(pictures, "Camera Roll"), "windows-photos", platform),
      await photoSource("windows-saved-pictures", "Saved Pictures", "Windows Photos saved media folder.", path.join(pictures, "Saved Pictures"), "windows-photos", platform),
      await photoSource("onedrive-pictures", "OneDrive Pictures", "Common Windows Photos and phone-sync location.", path.join(oneDriveRoot, "Pictures"), "windows-photos", platform)
    );
  }
  return uniquePhotoSources([
    ...sources,
    ...(await mountedCameraPhotoSources({ platform, home, env, mountRoots })),
    ...(await mountedDrivePhotoSources({ platform, home, env, mountRoots })),
  ]);
}

module.exports = {
  buildSystemPhotoSources,
  mountedCameraPhotoSources,
  mountedDrivePhotoSources,
  defaultMountRoots,
  photoSource,
  uniquePhotoSources,
};

const { app, BrowserWindow, dialog, ipcMain, session, Menu, Tray, nativeImage, shell, Notification, clipboard, protocol, net } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { pathToFileURL, fileURLToPath } = require("url");

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow = null;
let backend = null;
let folderWatch = null;
let tray = null;
let isQuitting = false;
let rendererReady = false;
let creatingWindow = null;
const pendingExternalOpens = [];
const userGrantedPaths = new Set();

const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".jpe", ".jfif",
  ".png", ".apng",
  ".gif", ".webp", ".avif",
  ".heic", ".heif", ".hif", ".heics", ".heifs",
  ".bmp", ".dib",
  ".tif", ".tiff",
  ".ico", ".icns",
  ".jp2", ".j2k", ".jpc", ".jpf", ".jpx",
  ".ppm", ".pgm", ".pbm", ".pnm",
  ".tga", ".dds", ".psd",
  ".dng", ".raw", ".arw", ".cr2", ".cr3", ".nef", ".nrw", ".orf", ".raf", ".rw2", ".pef", ".srw", ".x3f", ".3fr", ".erf", ".kdc", ".mos", ".mrw"
]);
const VIDEO_EXTENSIONS = new Set([
  ".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm", ".hevc",
  ".3gp", ".3g2", ".mts", ".m2ts", ".qt", ".mpeg", ".mpg",
  ".wmv", ".flv", ".asf", ".ogv", ".ts", ".dv"
]);
const APP_USER_MODEL_ID = "com.crossagefr.workbench";
const PROTOCOL_SCHEME = "crossage";
const MEDIA_PROTOCOL_SCHEME = "crossage-media";
const TRUSTED_BACKEND_COMMANDS = new Set([
  "get_state",
  "set_workspace",
  "set_consent",
  "enroll",
  "enroll_age_groups",
  "scan",
  "scan_paths",
  "analyze_folder",
  "set_status",
  "bulk_set_status",
  "set_candidate_note",
  "clear_queue",
  "purge_candidates",
  "purge_duplicate_candidates",
  "prepare_previews",
  "delete_reference",
  "delete_person",
  "rename_person",
  "clear_references",
  "purge_old_candidates",
  "export_report",
  "export_workspace_backup",
  "export_candidates",
  "workspace_health",
  "runtime_self_test",
  "save_settings",
  "audit_events"
]);

app.setAppUserModelId(APP_USER_MODEL_ID);
app.enableSandbox();
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_PROTOCOL_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

function configureRendererStability() {
  if (process.platform !== "darwin" || process.env.CROSSAGE_ENABLE_GPU === "1") {
    return;
  }
  // Avoid macOS Metal/Electron GPU-process traps; recognition compute stays in the backend.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
}

configureRendererStability();

function appRoot() {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return path.resolve(__dirname, "..");
}

function appIconPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "desktop", "assets", "icon.png");
  }
  return path.join(appRoot(), "desktop", "assets", "icon.png");
}

function watchConfigPath() {
  return path.join(app.getPath("userData"), "folder-watch.json");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temp, filePath);
}

function readJsonObject(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function persistFolderWatch(folder) {
  if (folder) {
    writeJsonAtomic(watchConfigPath(), {
      active: true,
      folder,
      updatedAt: new Date().toISOString()
    });
    return;
  }
  try {
    fs.rmSync(watchConfigPath(), { force: true });
  } catch {
    // Best-effort preference cleanup.
  }
}

function auditDesktopAction(row) {
  if (!backend) {
    return;
  }
  backend.invoke("record_audit", {
    row: {
      source: "desktop",
      ...row
    }
  }).catch(() => undefined);
}

function makeTrayImage() {
  const image = nativeImage.createFromPath(appIconPath());
  if (process.platform === "darwin") {
    const resized = image.resize({ width: 18, height: 18 });
    resized.setTemplateImage(true);
    return resized;
  }
  return image.resize({ width: 16, height: 16 });
}

function encodeMediaPath(filePath) {
  return Buffer.from(path.resolve(String(filePath || "")), "utf8")
    .toString("base64url");
}

function decodeMediaPath(value) {
  try {
    return path.resolve(Buffer.from(String(value || ""), "base64url").toString("utf8"));
  } catch {
    return "";
  }
}

function mediaUrlFor(filePath) {
  return `${MEDIA_PROTOCOL_SCHEME}://local/${encodeMediaPath(filePath)}`;
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function decodeImageDataUrl(value) {
  const match = String(value || "").match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error("Camera frame must be a PNG, JPEG, or WebP data URL.");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("Camera frame is empty.");
  }
  if (buffer.length > 18 * 1024 * 1024) {
    throw new Error("Camera frame is too large.");
  }
  const extension = match[1] === "png" ? ".png" : match[1] === "webp" ? ".webp" : ".jpg";
  return { buffer, extension };
}

function isSubpath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function grantUserPath(filePath) {
  if (typeof filePath === "string" && filePath.trim()) {
    userGrantedPaths.add(path.resolve(filePath));
  }
}

function isUserGrantedPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  for (const granted of userGrantedPaths) {
    if (isSubpath(granted, target) || target === granted) {
      return true;
    }
  }
  return false;
}

function currentTrustedPaths() {
  const state = backend?.readyState;
  const paths = new Set();
  const add = (value) => {
    if (typeof value === "string" && value.trim()) {
      paths.add(path.resolve(value));
    }
  };
  add(state?.workspace);
  for (const item of state?.references || []) {
    add(item.sourcePath);
    add(item.previewPath);
  }
  for (const item of state?.candidates || []) {
    add(item.sourcePath);
    add(item.mediaSourcePath);
    add(item.previewPath);
    add(item.bestRefPath);
    add(item.bestRefPreviewPath);
  }
  return { state, paths };
}

function isTrustedMediaPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  const { state, paths } = currentTrustedPaths();
  if (!state || !paths.size) {
    return false;
  }
  if (paths.has(target)) {
    return true;
  }
  if (state.workspace && isSubpath(path.join(state.workspace, "previews"), target)) {
    return true;
  }
  return false;
}

function isTrustedShellPath(filePath) {
  const target = path.resolve(String(filePath || ""));
  const { state, paths } = currentTrustedPaths();
  if (!state) {
    return false;
  }
  if (state.workspace && isSubpath(state.workspace, target)) {
    return true;
  }
  return paths.has(target) || isUserGrantedPath(target);
}

function showMainWindow() {
  if (!app.isReady()) {
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow().catch((error) => console.error("[window] failed to create", error));
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return true;
  }
  return false;
}

function sendAppCommand(payload) {
  showMainWindow();
  sendToRenderer("app:command", payload);
}

function notify(title, body) {
  if (process.env.CROSSAGE_DISABLE_NOTIFICATIONS === "1" || process.env.CROSSAGE_TEST_CAMERA === "1") {
    return;
  }
  if (!Notification.isSupported()) {
    return;
  }
  new Notification({ title, body, icon: appIconPath() }).show();
}

function notifyForCommand(command, result) {
  if (!result || typeof result !== "object") {
    return;
  }
  if (command === "scan" || command === "scan_paths") {
    const added = Number(result.added || 0);
    const protectedCount = Number(result.metrics?.safeFiltered || 0);
    const extra = protectedCount ? ` ${protectedCount} protected.` : "";
    notify("Scan complete", `${added} candidate(s) queued.${extra}`);
  }
  if (command === "enroll" || command === "enroll_age_groups") {
    notify("Enrollment complete", `${Number(result.added || 0)} reference face(s) enrolled.`);
  }
}

function findPythonExecutable() {
  if (process.env.CROSSAGE_PYTHON) {
    return process.env.CROSSAGE_PYTHON;
  }
  const root = appRoot();
  const packagedBackend = process.platform === "win32"
    ? path.join(process.resourcesPath, "backend", "crossage-backend.exe")
    : path.join(process.resourcesPath, "backend", "crossage-backend");
  if (app.isPackaged && fs.existsSync(packagedBackend)) {
    return packagedBackend;
  }
  const venvPython = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.platform === "win32" ? "python" : "python3";
}

function decorateState(value) {
  if (!value || typeof value !== "object") {
    return value;
  }
  const decoratePath = (item, key, outKey) => {
    if (item[key]) {
      item[outKey] = mediaUrlFor(item[key]);
      return true;
    }
    return false;
  };
  const apply = (state) => {
    if (Array.isArray(state.references)) {
      state.references = state.references.map((item) => {
        const next = { ...item };
        decoratePath(next, "sourcePath", "sourceUrl");
        decoratePath(next, "mediaSourcePath", "mediaSourceUrl");
        decoratePath(next, "previewPath", "previewUrl");
        if (next.previewUrl) {
          next.sourceUrl = next.previewUrl;
        }
        return next;
      });
    }
    if (Array.isArray(state.candidates)) {
      state.candidates = state.candidates.map((item) => {
        const next = { ...item };
        decoratePath(next, "sourcePath", "sourceUrl");
        decoratePath(next, "previewPath", "previewUrl");
        if (next.previewUrl) {
          next.sourceUrl = next.previewUrl;
        }
        decoratePath(next, "bestRefPath", "bestRefUrl");
        decoratePath(next, "bestRefPreviewPath", "bestRefPreviewUrl");
        if (next.bestRefPreviewUrl) {
          next.bestRefUrl = next.bestRefPreviewUrl;
        }
        return next;
      });
    }
  };
  if (value.state) {
    apply(value.state);
  } else if (value.counts && value.references && value.candidates) {
    apply(value);
  }
  return value;
}

function isImagePath(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isScannableMediaPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(extension) || VIDEO_EXTENSIONS.has(extension);
}

function registerProtocolHandler() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
    return;
  }
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

function rendererEntryUrl() {
  if (isDev) {
    return process.env.VITE_DEV_SERVER_URL;
  }
  return pathToFileURL(path.join(__dirname, "..", "dist", "index.html")).toString();
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === `${MEDIA_PROTOCOL_SCHEME}:`) {
      return true;
    }
    if (isDev) {
      const dev = new URL(process.env.VITE_DEV_SERVER_URL);
      return url.origin === dev.origin;
    }
    return url.protocol === "file:" && path.resolve(fileURLToPath(url)) === path.resolve(path.join(__dirname, "..", "dist", "index.html"));
  } catch {
    return false;
  }
}

function assertTrustedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  if (!isTrustedRendererUrl(senderUrl)) {
    throw new Error("Untrusted renderer IPC sender.");
  }
}

function assertPlainObject(value, label = "Payload") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function validateBackendPayload(payload = {}) {
  assertPlainObject(payload, "Backend payload");
  const command = String(payload.command || "");
  if (!TRUSTED_BACKEND_COMMANDS.has(command)) {
    throw new Error(`Blocked backend command: ${command || "empty"}.`);
  }
  const params = payload.params ?? {};
  assertPlainObject(params, "Command params");
  const serialized = JSON.stringify(params);
  if (serialized.length > 1_000_000) {
    throw new Error("Command params are too large.");
  }
  return { command, params };
}

function grantPathsFromBackendRequest(command, params) {
  if (["set_workspace", "enroll", "scan", "analyze_folder", "export_report", "export_candidates"].includes(command)) {
    grantUserPath(params.path || params.folder);
  }
  if (command === "enroll_age_groups" && Array.isArray(params.groups)) {
    for (const group of params.groups) {
      if (group && typeof group === "object") {
        grantUserPath(group.folder);
      }
    }
  }
  if (command === "scan_paths" && Array.isArray(params.paths)) {
    for (const item of params.paths) {
      grantUserPath(item);
    }
  }
}

function configureSessionSecurity() {
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${MEDIA_PROTOCOL_SCHEME}: data: blob:`,
    `media-src 'self' ${MEDIA_PROTOCOL_SCHEME}: blob:`,
    "font-src 'self'",
    "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:*",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'"
  ].join("; ");

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...details.responseHeaders };
    responseHeaders["Content-Security-Policy"] = [contentSecurityPolicy];
    responseHeaders["X-Content-Type-Options"] = ["nosniff"];
    callback({ responseHeaders });
  });

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const trusted = mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id;
    callback(Boolean(trusted && (permission === "media" || permission === "camera")));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const trusted = mainWindow && !mainWindow.isDestroyed() && webContents.id === mainWindow.webContents.id;
    return Boolean(trusted && (permission === "media" || permission === "camera"));
  });
  if (typeof session.defaultSession.setDevicePermissionHandler === "function") {
    session.defaultSession.setDevicePermissionHandler((details) => {
      const trusted = mainWindow && !mainWindow.isDestroyed();
      return Boolean(trusted && (details.deviceType === "media" || details.deviceType === "camera"));
    });
  }
}

function registerMediaProtocol() {
  protocol.handle(MEDIA_PROTOCOL_SCHEME, async (request) => {
    const url = new URL(request.url);
    const target = decodeMediaPath(url.pathname.replace(/^\/+/, "") || url.hostname);
    if (!target || !isTrustedMediaPath(target) || !fs.existsSync(target)) {
      return new Response("Not found", { status: 404 });
    }
    return net.fetch(pathToFileURL(target).toString());
  });
}

function hardenWebContents(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

function parseProtocolUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== `${PROTOCOL_SCHEME}:`) {
      return null;
    }
    const action = (url.hostname || url.pathname.replace(/^\/+/, "") || "open").toLowerCase();
    const target = url.searchParams.get("workspace") || url.searchParams.get("folder") || url.searchParams.get("path");
    if (!target) {
      return { type: "show" };
    }
    const resolved = path.resolve(decodeURIComponent(target));
    if (action === "open" || action === "workspace") {
      return { type: "workspace", path: resolved, source: "protocol" };
    }
    if (action === "scan") {
      return { type: "scan-folder", path: resolved, source: "protocol" };
    }
    if (action === "watch") {
      return { type: "watch-folder", path: resolved, source: "protocol" };
    }
  } catch {
    return null;
  }
  return null;
}

function parseExternalPath(value) {
  if (!value || value.startsWith("-")) {
    return null;
  }
  const raw = value.startsWith("file://") ? fileURLToPath(value) : value;
  const resolved = path.resolve(decodeURIComponent(raw));
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      return { type: "scan-folder", path: resolved, source: "open-path" };
    }
    if (stat.isFile() && isScannableMediaPath(resolved)) {
      return { type: "scan-files", paths: [resolved], source: "open-path" };
    }
  } catch {
    return null;
  }
  return null;
}

function parseExternalInput(value) {
  if (String(value).startsWith(`${PROTOCOL_SCHEME}://`)) {
    return parseProtocolUrl(String(value));
  }
  return parseExternalPath(String(value));
}

function handleExternalInputs(values) {
  const mediaFiles = [];
  for (const value of values) {
    const payload = parseExternalInput(value);
    if (!payload) {
      continue;
    }
    if (payload.type === "scan-files") {
      mediaFiles.push(...payload.paths);
      continue;
    }
    deliverExternalOpen(payload);
  }
  if (mediaFiles.length) {
    deliverExternalOpen({ type: "scan-files", paths: mediaFiles, source: "open-path" });
  }
}

function deliverExternalOpen(payload) {
  if (payload?.type === "show") {
    showMainWindow();
    return;
  }
  auditDesktopAction({
    action: "external_open",
    payloadType: payload?.type || "unknown",
    path: payload?.path || "",
    count: Array.isArray(payload?.paths) ? payload.paths.length : 0,
    sourceHint: payload?.source || ""
  });
  if (!app.isReady()) {
    pendingExternalOpens.push(payload);
    return;
  }
  if (!rendererReady) {
    pendingExternalOpens.push(payload);
    showMainWindow();
    return;
  }
  if (!sendToRenderer("app:external-open", payload)) {
    pendingExternalOpens.push(payload);
  }
  showMainWindow();
}

function flushExternalOpens() {
  while (pendingExternalOpens.length) {
    sendToRenderer("app:external-open", pendingExternalOpens.shift());
  }
}

function sendWatchEvent(payload) {
  sendToRenderer("folder-watch:event", payload);
  buildTrayMenu();
}

function currentFolderWatchStatus(message = "") {
  if (!folderWatch) {
    return { active: false, folder: null, queued: 0, scanning: false, message: message || "Not watching." };
  }
  return {
    active: true,
    folder: folderWatch.folder,
    queued: folderWatch.queue.size,
    scanning: folderWatch.scanning,
    message: message || (folderWatch.scanning ? "Watching and scanning." : "Watching for new media files.")
  };
}

function stopFolderWatch(reason = "Stopped", options = {}) {
  if (options.persist !== false) {
    persistFolderWatch(null);
  }
  if (!folderWatch) {
    return { active: false, folder: null, queued: 0, scanning: false, message: reason };
  }
  if (folderWatch.timer) {
    clearTimeout(folderWatch.timer);
  }
  folderWatch.watcher.close();
  const folder = folderWatch.folder;
  folderWatch = null;
  const status = { active: false, folder, queued: 0, scanning: false, message: reason };
  sendWatchEvent(status);
  return status;
}

async function waitForStableFile(filePath) {
  let lastSize = -1;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.isFile() && stat.size > 0 && stat.size === lastSize) {
        return true;
      }
      lastSize = stat.size;
    } catch {
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 260));
  }
  return lastSize > 0;
}

function scheduleWatchFlush() {
  if (!folderWatch || folderWatch.scanning) {
    return;
  }
  if (folderWatch.timer) {
    clearTimeout(folderWatch.timer);
  }
  folderWatch.timer = setTimeout(() => flushWatchQueue(), 650);
  sendWatchEvent({
    active: true,
    folder: folderWatch.folder,
    queued: folderWatch.queue.size,
    scanning: false,
    message: "Queued new media files."
  });
}

async function flushWatchQueue() {
  if (!folderWatch || folderWatch.scanning) {
    return;
  }
  folderWatch.timer = null;
  const watch = folderWatch;
  const paths = Array.from(watch.queue);
  watch.queue.clear();
  if (!paths.length) {
    return;
  }
  watch.scanning = true;
  sendWatchEvent({ active: true, folder: watch.folder, queued: 0, scanning: true, message: `Scanning ${paths.length} new file(s).` });
  try {
    const stable = [];
    for (const filePath of paths) {
      if (await waitForStableFile(filePath)) {
        stable.push(filePath);
      }
    }
    if (!stable.length) {
      sendWatchEvent({ active: true, folder: watch.folder, queued: watch.queue.size, scanning: false, message: "No complete media files found." });
      return;
    }
    const result = await backend.invoke("scan_paths", { paths: stable, source: "watch" });
    const protectedCount = Number(result.metrics?.safeFiltered || 0);
    notify("Watched folder processed", `${stable.length} new file(s).${protectedCount ? ` ${protectedCount} protected.` : ""}`);
    sendWatchEvent({
      active: true,
      folder: watch.folder,
      queued: watch.queue.size,
      scanning: false,
      message: `Processed ${stable.length} new file(s).`,
      result: decorateState(result)
    });
  } catch (error) {
    sendWatchEvent({
      active: true,
      folder: watch.folder,
      queued: watch.queue.size,
      scanning: false,
      error: error.message || String(error),
      message: error.message || "Folder watch scan failed."
    });
  } finally {
    if (folderWatch === watch) {
      watch.scanning = false;
      if (watch.queue.size) {
        scheduleWatchFlush();
      }
    }
  }
}

function startFolderWatch(folder, options = {}) {
  if (!String(folder || "").trim()) {
    throw new Error("Choose a folder to watch.");
  }
  const resolved = path.resolve(folder);
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Choose a folder to watch.");
  }
  stopFolderWatch("Replacing watched folder");
  const watch = {
    folder: resolved,
    queue: new Set(),
    timer: null,
    scanning: false,
    watcher: null
  };
  const onChange = (_eventType, filename) => {
    if (!filename) {
      return;
    }
    const filePath = path.resolve(resolved, filename.toString());
    const relative = path.relative(resolved, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !isScannableMediaPath(filePath)) {
      return;
    }
    watch.queue.add(filePath);
    scheduleWatchFlush();
  };
  try {
    watch.watcher = fs.watch(resolved, { recursive: process.platform === "darwin" || process.platform === "win32" }, onChange);
  } catch {
    watch.watcher = fs.watch(resolved, onChange);
  }
  watch.watcher.on("error", (error) => {
    sendWatchEvent({ active: false, folder: resolved, queued: watch.queue.size, scanning: false, error: error.message, message: "Folder watch stopped." });
    if (folderWatch === watch) {
      folderWatch = null;
    }
  });
  folderWatch = watch;
  if (options.persist !== false) {
    persistFolderWatch(resolved);
  }
  const status = { active: true, folder: resolved, queued: 0, scanning: false, message: "Watching for new media files." };
  sendWatchEvent(status);
  return status;
}

async function resumePersistedFolderWatch() {
  if (process.env.CROSSAGE_DISABLE_WATCH_RESUME === "1" || process.env.CROSSAGE_TEST_CAMERA === "1") {
    return;
  }
  const config = readJsonObject(watchConfigPath());
  const folder = typeof config.folder === "string" ? config.folder : "";
  if (!config.active || !folder) {
    return;
  }
  try {
    await backend.start();
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      startFolderWatch(folder, { persist: true });
      sendWatchEvent({ active: true, folder: path.resolve(folder), queued: 0, scanning: false, message: "Resumed watched folder." });
    }
  } catch (error) {
    sendWatchEvent({ active: false, folder, queued: 0, scanning: false, error: error.message, message: "Saved folder watch could not resume." });
  }
}

function buildApplicationMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" }
          ]
        }]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Open Workspace...", accelerator: "CmdOrCtrl+O", click: () => sendAppCommand({ type: "open-workspace" }) },
        { label: "Reveal Workspace", accelerator: "CmdOrCtrl+Shift+O", click: () => sendAppCommand({ type: "reveal-workspace" }) },
        ...(isMac ? [{ type: "separator" }, { role: "recentDocuments" }, { role: "clearRecentDocuments" }] : []),
        { type: "separator" },
        { label: "Refresh", accelerator: "CmdOrCtrl+R", click: () => sendAppCommand({ type: "refresh" }) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" }
      ]
    },
    {
      label: "Workflow",
      submenu: [
        { label: "Dashboard", accelerator: "CmdOrCtrl+1", click: () => sendAppCommand({ type: "navigate", tab: "dashboard" }) },
        { label: "Enroll", accelerator: "CmdOrCtrl+2", click: () => sendAppCommand({ type: "navigate", tab: "enroll" }) },
        { label: "Scan", accelerator: "CmdOrCtrl+3", click: () => sendAppCommand({ type: "navigate", tab: "scan" }) },
        { label: "Review", accelerator: "CmdOrCtrl+4", click: () => sendAppCommand({ type: "navigate", tab: "review" }) },
        { label: "Settings", accelerator: "CmdOrCtrl+5", click: () => sendAppCommand({ type: "navigate", tab: "settings" }) },
        { type: "separator" },
        { label: "Run Scan", accelerator: "CmdOrCtrl+Enter", click: () => sendAppCommand({ type: "scan" }) },
        { label: "Start Folder Watch", click: () => sendAppCommand({ type: "start-watch" }) },
        { label: "Stop Folder Watch", click: () => sendAppCommand({ type: "stop-watch" }) }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }])
      ]
    },
    {
      role: "help",
      submenu: [
        { label: "Show Workbench", click: showMainWindow },
        { label: "Open Workspace Folder", click: () => sendAppCommand({ type: "open-workspace-folder" }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function buildTrayMenu() {
  if (!tray) {
    return;
  }
  const watching = Boolean(folderWatch);
  const label = watching
    ? folderWatch.scanning
      ? "Watching: scanning"
      : "Watching"
    : "Not watching";
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show CrossAge FR", click: showMainWindow },
    { type: "separator" },
    { label: "Dashboard", click: () => sendAppCommand({ type: "navigate", tab: "dashboard" }) },
    { label: "Scan", click: () => sendAppCommand({ type: "navigate", tab: "scan" }) },
    { type: "separator" },
    { label, enabled: false },
    watching
      ? { label: "Stop Folder Watch", click: () => sendAppCommand({ type: "stop-watch" }) }
      : { label: "Start Folder Watch", click: () => sendAppCommand({ type: "start-watch" }) },
    { label: "Reveal Workspace", click: () => sendAppCommand({ type: "reveal-workspace" }) },
    { type: "separator" },
    { label: "Quit", click: () => { isQuitting = true; app.quit(); } }
  ]));
}

function createTray() {
  if (tray || process.env.CROSSAGE_DISABLE_TRAY === "1") {
    return;
  }
  tray = new Tray(makeTrayImage());
  tray.setToolTip("CrossAge FR Workbench");
  tray.on("click", showMainWindow);
  buildTrayMenu();
}

class PythonBackend {
  constructor() {
    this.readyState = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.nextId = 1;
    this.child = null;
  }

  start() {
    if (this.readyPromise && this.child && !this.child.killed) {
      return this.readyPromise;
    }
    this.readyPromise = null;
    const root = appRoot();
    const executable = findPythonExecutable();
    const isFrozenBackend = path.basename(executable).startsWith("crossage-backend");
    const args = isFrozenBackend ? [] : ["-m", "crossage_fr.api_server"];
    const env = {
      ...process.env,
      PYTHONPATH: root,
      CROSSAGE_WORKSPACE: process.env.CROSSAGE_WORKSPACE || path.join(app.getPath("userData"), "workspace")
    };
    this.child = spawn(executable, args, {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const child = this.child;
    const lines = readline.createInterface({ input: child.stdout });
    this.readyPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyPromise = null;
        this.readyState = null;
        if (this.child === child && !child.killed) {
          child.kill();
        }
        reject(new Error("Python backend did not become ready in time."));
      }, 180000);
      lines.on("line", (line) => {
        let message;
        try {
          message = JSON.parse(line);
        } catch (error) {
          return;
        }
        if (message.ready) {
          clearTimeout(timer);
          this.readyState = decorateState(message.state);
          resolve(this.readyState);
          return;
        }
        if (message.event === "startup") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:startup", message.payload || {});
          }
          return;
        }
        if (message.event === "progress") {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("backend:progress", {
              id: message.id,
              name: message.name,
              payload: decorateState(message.payload || {})
            });
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.ok) {
          const result = decorateState(message.result);
          if (result?.state) {
            this.readyState = result.state;
          } else if (result?.counts && result?.references && result?.candidates) {
            this.readyState = result;
          }
          notifyForCommand(pending.command, result);
          pending.resolve(result);
        } else {
          const err = new Error(message.error?.message || "Backend command failed.");
          err.backend = message.error;
          pending.reject(err);
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        this.readyPromise = null;
        if (this.child === child) {
          this.child = null;
        }
        reject(error);
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        const error = new Error(`Python backend exited with code ${code}.`);
        for (const pending of this.pending.values()) {
          pending.reject(error);
        }
        this.pending.clear();
        lines.close();
        this.readyPromise = null;
        this.readyState = null;
        if (this.child === child) {
          this.child = null;
        }
      });
      child.stderr.on("data", (chunk) => {
        console.error(`[backend] ${chunk.toString()}`);
      });
    });
    return this.readyPromise;
  }

  async invoke(command, params = {}) {
    await this.start();
    if (!this.child || !this.child.stdin.writable) {
      throw new Error("Python backend is not accepting commands.");
    }
    const id = this.nextId++;
    const payload = JSON.stringify({ id, command, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, command });
      this.child.stdin.write(payload, "utf8", (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  stop() {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

async function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return mainWindow;
  }
  if (creatingWindow) {
    return creatingWindow;
  }
  creatingWindow = (async () => {
    if (!backend) {
      backend = new PythonBackend();
    }
    const backendReady = backend.start();
    rendererReady = false;

    const window = new BrowserWindow({
      width: 1240,
      height: 820,
      minWidth: 1040,
      minHeight: 700,
      title: "CrossAge FR Workbench",
      show: false,
      backgroundColor: "#f5f6f8",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: { x: 18, y: 18 },
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        webviewTag: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        devTools: isDev || process.env.CROSSAGE_ENABLE_DEVTOOLS === "1"
      }
    });
    mainWindow = window;
    hardenWebContents(window);
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    });
    window.on("closed", () => {
      if (mainWindow === window) {
        mainWindow = null;
        rendererReady = false;
      }
    });

    await window.loadURL(rendererEntryUrl());
    backendReady.catch((error) => {
      if (!window.isDestroyed()) {
        window.webContents.send("backend:error", error.message);
      }
    });
    return window;
  })();
  try {
    return await creatingWindow;
  } finally {
    creatingWindow = null;
  }
}

ipcMain.handle("backend:initial-state", async (event) => {
  assertTrustedSender(event);
  await backend.start();
  return backend.readyState;
});

ipcMain.handle("app:renderer-ready", async (event) => {
  assertTrustedSender(event);
  rendererReady = true;
  flushExternalOpens();
  sendWatchEvent(currentFolderWatchStatus());
  return true;
});

ipcMain.handle("backend:invoke", async (event, payload) => {
  assertTrustedSender(event);
  const request = validateBackendPayload(payload);
  grantPathsFromBackendRequest(request.command, request.params);
  const result = await backend.invoke(request.command, request.params);
  if (request.command === "set_workspace") {
    stopFolderWatch("Workspace changed.");
    if (result?.workspace) {
      app.addRecentDocument(result.workspace);
    }
  }
  return result;
});

ipcMain.handle("system:get-integration", async (event) => {
  assertTrustedSender(event);
  return {
    platform: process.platform,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    protocolScheme: PROTOCOL_SCHEME,
    protocolRegistered: app.isDefaultProtocolClient(PROTOCOL_SCHEME),
    notificationsSupported: Notification.isSupported(),
    appUserModelId: APP_USER_MODEL_ID
  };
});

ipcMain.handle("system:set-launch-at-login", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Launch setting");
  const openAtLogin = Boolean(payload.openAtLogin);
  app.setLoginItemSettings({
    openAtLogin,
    path: process.execPath
  });
  return {
    platform: process.platform,
    launchAtLogin: app.getLoginItemSettings().openAtLogin,
    protocolScheme: PROTOCOL_SCHEME,
    protocolRegistered: app.isDefaultProtocolClient(PROTOCOL_SCHEME),
    notificationsSupported: Notification.isSupported(),
    appUserModelId: APP_USER_MODEL_ID
  };
});

ipcMain.handle("shell:reveal-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Reveal payload");
  const target = path.resolve(String(payload.path || ""));
  if (isTrustedShellPath(target) && fs.existsSync(target)) {
    shell.showItemInFolder(target);
    auditDesktopAction({ action: "shell_reveal", path: target });
    return true;
  }
  return false;
});

ipcMain.handle("shell:open-path", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Open payload");
  const target = path.resolve(String(payload.path || ""));
  if (!isTrustedShellPath(target) || !fs.existsSync(target)) {
    return { ok: false, error: "Path does not exist." };
  }
  const error = await shell.openPath(target);
  if (!error) {
    auditDesktopAction({ action: "shell_open", path: target });
  }
  return { ok: !error, error };
});

ipcMain.handle("clipboard:write-text", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Clipboard payload");
  const text = String(payload.text || "");
  clipboard.writeText(text.slice(0, 200_000));
  return true;
});

ipcMain.handle("dialog:choose-folder", async (event) => {
  assertTrustedSender(event);
  if (process.env.CROSSAGE_TEST_DIALOG_PATHS) {
    const paths = process.env.CROSSAGE_TEST_DIALOG_PATHS.split(path.delimiter).filter(Boolean);
    const selected = paths.shift() || null;
    process.env.CROSSAGE_TEST_DIALOG_PATHS = paths.join(path.delimiter);
    if (selected) {
      grantUserPath(selected);
    }
    return selected;
  }
  if (process.env.CROSSAGE_TEST_DIALOG_PATH) {
    grantUserPath(process.env.CROSSAGE_TEST_DIALOG_PATH);
    return process.env.CROSSAGE_TEST_DIALOG_PATH;
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths.length) {
    return null;
  }
  grantUserPath(result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle("camera:save-frame", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Camera frame payload");
  await backend.start();
  const workspace = backend.readyState?.workspace || path.join(app.getPath("userData"), "workspace");
  const folder = path.join(workspace, "camera-captures", timestampSlug());
  const { buffer, extension } = decodeImageDataUrl(payload.dataUrl);
  const filePath = path.join(folder, `face-capture${extension}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(filePath, buffer);
  grantUserPath(folder);
  auditDesktopAction({ action: "camera_save_frame", path: filePath });
  return { folder, filePath };
});

ipcMain.handle("folder-watch:start", async (event, payload = {}) => {
  assertTrustedSender(event);
  assertPlainObject(payload, "Folder watch payload");
  await backend.start();
  return startFolderWatch(String(payload.folder || ""));
});

ipcMain.handle("folder-watch:stop", async (event) => {
  assertTrustedSender(event);
  return stopFolderWatch();
});

const allowMultiInstance = process.env.CROSSAGE_ALLOW_MULTI_INSTANCE === "1";
const singleInstanceLock = allowMultiInstance || app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (event, url) => {
      if (!isTrustedRendererUrl(url)) {
        event.preventDefault();
      }
    });
    contents.on("will-attach-webview", (event) => {
      event.preventDefault();
    });
  });

  app.on("second-instance", (_event, argv) => {
    showMainWindow();
    handleExternalInputs(argv);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const payload = parseProtocolUrl(url);
    if (payload) {
      deliverExternalOpen(payload);
    }
  });

  app.on("open-file", (event, filePath) => {
    event.preventDefault();
    const payload = parseExternalPath(filePath);
    if (payload) {
      deliverExternalOpen(payload);
    }
  });

  app.whenReady().then(async () => {
    registerProtocolHandler();
    registerMediaProtocol();
    configureSessionSecurity();
    buildApplicationMenu();
    createTray();
    await createWindow();
    await resumePersistedFolderWatch();
    handleExternalInputs(process.argv.slice(1));
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" || process.env.CROSSAGE_QUIT_ON_WINDOW_CLOSE === "1") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((error) => console.error("[window] failed to activate", error));
  } else {
    showMainWindow();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  stopFolderWatch("App quitting.", { persist: false });
  if (backend) {
    backend.stop();
  }
});

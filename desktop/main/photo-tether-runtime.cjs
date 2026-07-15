const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".jpe", ".png", ".webp", ".avif", ".heic", ".heif",
  ".tif", ".tiff", ".dng", ".raw", ".arw", ".cr2", ".cr3", ".nef",
  ".nrw", ".orf", ".raf", ".rw2", ".pef", ".srw", ".x3f", ".3fr",
  ".erf", ".kdc", ".mos", ".mrw", ".mov", ".mp4", ".m4v"
]);

function codedError(code, message, detail = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, detail);
  return error;
}

function isPathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeFilenamePart(value, fallback = "capture") {
  const clean = String(value || "")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 80);
  return clean || fallback;
}

function validateNamingTemplate(value) {
  const template = String(value || "capture_{sequence:04}").trim();
  if (!template || template.length > 160 || /[\\/\0]/.test(template)) {
    throw codedError("E-PHOTO-TETHER-TEMPLATE", "Capture naming must be a filename template without folders.");
  }
  const unknown = template.match(/\{(?!date\}|time\}|session\}|camera\}|sequence(?::0?[1-9]\d?)?\})[^}]+\}/);
  if (unknown) {
    throw codedError("E-PHOTO-TETHER-TEMPLATE", `Unknown capture naming token: ${unknown[0]}.`);
  }
  return template;
}

function renderTetherFilename(templateValue, options = {}) {
  const template = validateNamingTemplate(templateValue);
  const date = options.date instanceof Date ? options.date : new Date(options.date || Date.now());
  const sequence = Math.max(1, Number.parseInt(String(options.sequence || 1), 10) || 1);
  const replacements = {
    date: `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`,
    session: sanitizeFilenamePart(options.sessionId, "session"),
    camera: sanitizeFilenamePart(options.camera, "camera")
  };
  const rendered = template
    .replace(/\{date\}/g, replacements.date)
    .replace(/\{time\}/g, replacements.time)
    .replace(/\{session\}/g, replacements.session)
    .replace(/\{camera\}/g, replacements.camera)
    .replace(/\{sequence(?::0?([1-9]\d?))?\}/g, (_match, widthValue) => {
      const width = Math.min(12, Math.max(1, Number.parseInt(widthValue || "1", 10) || 1));
      return String(sequence).padStart(width, "0");
    });
  return sanitizeFilenamePart(rendered, `capture_${String(sequence).padStart(4, "0")}`);
}

function executableCandidates(platform, environment = process.env) {
  const explicit = String(environment.CROSSAGE_GPHOTO2_PATH || "").trim();
  const names = platform === "win32" ? ["gphoto2.exe", "gphoto2.cmd", "gphoto2.bat"] : ["gphoto2"];
  const candidates = explicit ? [path.resolve(explicit)] : [];
  for (const directory of String(environment.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) candidates.push(path.join(directory, name));
  }
  return Array.from(new Set(candidates));
}

async function findGphotoExecutable(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const platform = options.platform || process.platform;
  for (const candidate of executableCandidates(platform, options.environment || process.env)) {
    try {
      const stat = await fsImpl.promises.stat(candidate);
      if (!stat.isFile()) continue;
      if (platform !== "win32") await fsImpl.promises.access(candidate, fs.constants.X_OK);
      return path.resolve(candidate);
    } catch {
      // Try the next PATH entry.
    }
  }
  return "";
}

function appendBounded(current, chunk, limit) {
  if (current.length >= limit) return current;
  return `${current}${String(chunk || "")}`.slice(0, limit);
}

function runBoundedCommand(executable, args, options = {}) {
  const spawnImpl = options.spawnImpl || childProcess.spawn;
  const timeoutMs = Math.max(50, Number(options.timeoutMs || 30_000));
  const maxOutputBytes = Math.max(1024, Number(options.maxOutputBytes || 64 * 1024));
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(executable, args.map(String), {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: options.environment || process.env
      });
    } catch (error) {
      reject(codedError("E-PHOTO-TETHER-CAMERA", error.message || "Camera command could not start."));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch { /* Process already ended. */ }
      reject(codedError("E-PHOTO-TETHER-TIMEOUT", "Camera command timed out.", { stdout, stderr }));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout = appendBounded(stdout, chunk, maxOutputBytes); });
    child.stderr?.on("data", (chunk) => { stderr = appendBounded(stderr, chunk, maxOutputBytes); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(codedError("E-PHOTO-TETHER-CAMERA", error.message || "Camera command failed to start.", { stdout, stderr }));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: Number(code ?? -1), signal: String(signal || ""), stdout, stderr });
    });
  });
}

function parseGphotoAutoDetect(output) {
  const cameras = [];
  for (const rawLine of String(output || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^model\s+port$/i.test(line) || /^-+$/.test(line)) continue;
    const match = line.match(/^(.*?)\s{2,}((?:usb|ptpip|serial|disk):\S+)$/i)
      || line.match(/^(.*?)\s+((?:usb|ptpip|serial|disk):\S+)$/i);
    if (!match) continue;
    const model = match[1].trim();
    const port = match[2].trim();
    if (!model || !port) continue;
    cameras.push({ id: `${model}|${port}`, model, port });
  }
  return cameras;
}

async function detectGphoto(options = {}) {
  const executable = await findGphotoExecutable(options);
  if (!executable) {
    return {
      available: false,
      executable: "",
      version: "",
      cameras: [],
      captureSupported: false,
      message: "gphoto2 is not installed. Watched-folder tethering remains available."
    };
  }
  try {
    const versionResult = await runBoundedCommand(executable, ["--version"], {
      ...options,
      timeoutMs: options.detectTimeoutMs || 5_000
    });
    if (versionResult.code !== 0) throw new Error(versionResult.stderr || "gphoto2 --version failed");
    const detectResult = await runBoundedCommand(executable, ["--auto-detect"], {
      ...options,
      timeoutMs: options.detectTimeoutMs || 8_000
    });
    const cameras = detectResult.code === 0 ? parseGphotoAutoDetect(detectResult.stdout) : [];
    return {
      available: true,
      executable,
      version: String(versionResult.stdout || versionResult.stderr).split(/\r?\n/)[0].trim().slice(0, 160),
      cameras,
      captureSupported: cameras.length > 0,
      message: cameras.length ? `${cameras.length} supported camera${cameras.length === 1 ? "" : "s"} detected.` : "gphoto2 is available, but no supported camera is connected."
    };
  } catch (error) {
    return {
      available: false,
      executable,
      version: "",
      cameras: [],
      captureSupported: false,
      error: String(error?.message || error),
      message: "gphoto2 could not be queried. Watched-folder tethering remains available."
    };
  }
}

async function waitForStableFile(filePath, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const pollMs = Math.max(20, Number(options.pollMs || 300));
  const timeoutMs = Math.max(pollMs * 2, Number(options.timeoutMs || 15_000));
  const stableSamples = Math.max(2, Number(options.stableSamples || 3));
  const startedAt = Date.now();
  let previous = "";
  let matches = 0;
  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const stat = await fsImpl.promises.stat(filePath);
      if (!stat.isFile() || stat.size <= 0) throw new Error("not-ready");
      const signature = `${Number(stat.size)}:${String(stat.mtimeNs ?? Math.round(stat.mtimeMs * 1_000_000))}`;
      matches = signature === previous ? matches + 1 : 1;
      previous = signature;
      if (matches >= stableSamples) return { stat, signature };
    } catch {
      previous = "";
      matches = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return null;
}

function unwrapBackendValue(result) {
  if (result && typeof result === "object" && result.value && typeof result.value === "object") return result.value;
  return result && typeof result === "object" ? result : {};
}

function normalizeRuntimeOptions(payload = {}) {
  const mode = String(payload.mode || "watch").trim().toLowerCase();
  if (!new Set(["watch", "ptp"]).has(mode)) throw codedError("E-PHOTO-TETHER-MODE", "Choose watched-folder or direct-camera tethering.");
  const rawSourcePath = String(payload.sourcePath || payload.destinationPath || "").trim();
  if (!rawSourcePath) throw codedError("E-PHOTO-TETHER-PATH", "Choose a capture folder.");
  const sourcePath = path.resolve(rawSourcePath);
  const storageMode = String(payload.storageMode || "referenced").trim().toLowerCase();
  if (!new Set(["referenced", "managed"]).has(storageMode)) throw codedError("E-PHOTO-TETHER-STORAGE", "Choose referenced or managed storage.");
  return {
    mode,
    sourcePath,
    destinationPath: path.resolve(String(payload.destinationPath || sourcePath)),
    storageMode,
    managedRoot: String(payload.managedRoot || "").trim() ? path.resolve(String(payload.managedRoot)) : "",
    namingTemplate: validateNamingTemplate(payload.namingTemplate || "capture_{date}_{sequence:04}"),
    nextSequence: Math.max(1, Number.parseInt(String(payload.nextSequence || 1), 10) || 1),
    sourceLabel: String(payload.sourceLabel || (mode === "ptp" ? "Tethered camera" : "Watched capture folder")).trim().slice(0, 160),
    cameraId: String(payload.cameraId || "").trim(),
    includeExisting: Boolean(payload.includeExisting),
    autoResume: payload.autoResume !== false,
    liveReview: payload.liveReview !== false
  };
}

function createPhotoTetherRuntime(options = {}) {
  if (typeof options.invokeBackend !== "function") throw new TypeError("invokeBackend is required");
  const fsImpl = options.fsImpl || fs;
  const invokeBackend = options.invokeBackend;
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const onImported = typeof options.onImported === "function" ? options.onImported : async (event) => event;
  const mediaExtensions = options.mediaExtensions || DEFAULT_MEDIA_EXTENSIONS;
  const queueLimit = Math.max(10, Number(options.queueLimit || 2_000));
  const sweepIntervalMs = Math.max(250, Number(options.sweepIntervalMs || 15_000));
  const watchDebounceMs = Math.max(20, Number(options.watchDebounceMs || 350));
  const stableOptions = {
    fsImpl,
    pollMs: options.stablePollMs || 300,
    timeoutMs: options.stableTimeoutMs || 15_000,
    stableSamples: options.stableSamples || 3
  };
  let current = null;
  let cameraCache = null;
  let cameraCacheAt = 0;

  const runtimeSnapshot = (message = "") => ({
    active: Boolean(current),
    sessionId: current?.session?.sessionId || "",
    mode: current?.config?.mode || "",
    sourcePath: current?.config?.sourcePath || "",
    queued: current?.queue.size || 0,
    importing: Boolean(current?.processing),
    captureBusy: Boolean(current?.captureBusy),
    watchMode: current?.watchMode || "",
    message: message || current?.message || (current ? "Capture session is active." : "No capture session is active.")
  });

  const send = async (type, payload = {}) => {
    const event = { type, ...runtimeSnapshot(payload.message), ...payload };
    await Promise.resolve(emit(event));
    return event;
  };

  const cameraStatus = async (refresh = false) => {
    if (!refresh && cameraCache && Date.now() - cameraCacheAt < 15_000) return cameraCache;
    cameraCache = await detectGphoto({
      fsImpl,
      spawnImpl: options.spawnImpl,
      platform: options.platform,
      environment: options.environment,
      detectTimeoutMs: options.detectTimeoutMs
    });
    cameraCacheAt = Date.now();
    return cameraCache;
  };

  const isMediaPath = (filePath) => mediaExtensions.has(path.extname(String(filePath || "")).toLowerCase());

  const scanTree = async (root, limits = {}) => {
    const maxDirs = Math.max(10, Number(limits.maxDirs || 10_000));
    const maxFiles = Math.max(100, Number(limits.maxFiles || 200_000));
    const stack = [root];
    const directories = [];
    const files = [];
    while (stack.length && directories.length < maxDirs && files.length < maxFiles) {
      const directory = stack.pop();
      if (!isPathInside(root, directory)) continue;
      let entries;
      try { entries = await fsImpl.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
      directories.push(directory);
      for (const entry of entries) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) stack.push(candidate);
        else if (entry.isFile() && isMediaPath(candidate)) files.push(candidate);
        if (files.length >= maxFiles) break;
      }
    }
    return { directories, files, truncated: stack.length > 0 };
  };

  const queueFile = (state, filePath, metadata = {}) => {
    if (!state || current !== state) return false;
    const resolved = path.resolve(String(filePath || ""));
    if (!isPathInside(state.config.sourcePath, resolved) || !isMediaPath(resolved)) return false;
    if (!state.queue.has(resolved) && state.queue.size >= queueLimit) {
      state.dropped += 1;
      void send("queue-full", { error: "Capture queue is full; the reconciliation sweep will retry missed files.", dropped: state.dropped });
      return false;
    }
    state.queue.set(resolved, { ...state.queue.get(resolved), ...metadata });
    if (state.queueTimer) clearTimeout(state.queueTimer);
    state.queueTimer = setTimeout(() => void processQueue(state), watchDebounceMs);
    return true;
  };

  const ingestFile = async (state, filePath, metadata = {}) => {
    const stable = await waitForStableFile(filePath, stableOptions);
    if (!stable || current !== state) return null;
    if (state.observed.get(filePath) === stable.signature && !metadata.force) return null;
    const claimResult = unwrapBackendValue(await invokeBackend("claim_photo_tether_capture", {
      sessionId: state.session.sessionId,
      sourcePath: filePath,
      sourceSignature: stable.signature,
      sizeBytes: Number(stable.stat.size || 0),
      ...(metadata.sequence ? { sequence: metadata.sequence } : {}),
      capturedAt: new Date(Number(stable.stat.mtimeMs || Date.now())).toISOString(),
      retry: true,
      metadata: { origin: metadata.origin || state.config.mode, liveReview: state.config.liveReview }
    }));
    const capture = claimResult.capture || {};
    state.observed.set(filePath, stable.signature);
    if (!claimResult.claimed) return capture.status === "imported" ? capture : null;
    await send("importing", { capture, message: `Importing capture ${capture.sequence || ""}.`.trim() });
    try {
      const importResult = unwrapBackendValue(await invokeBackend("import_photos", {
        sourcePaths: [filePath],
        storageMode: state.config.storageMode,
        ...(state.config.managedRoot ? { managedRoot: state.config.managedRoot } : {}),
        sourceKind: "camera",
        sourceLabel: state.config.sourceLabel,
        sourceDetail: `Tether session ${state.session.sessionId}`
      }));
      if (Number(importResult.importedCount || 0) < 1 || !Array.isArray(importResult.assets) || !importResult.assets[0]) {
        const reason = importResult.failures?.[0]?.reason || "Capture import did not produce a photo asset.";
        throw new Error(reason);
      }
      const asset = importResult.assets[0];
      const completed = unwrapBackendValue(await invokeBackend("complete_photo_tether_capture", {
        captureId: capture.captureId,
        targetPath: importResult.importedPaths?.[0] || asset.sourcePath || filePath,
        assetId: asset.assetId || "",
        importId: importResult.importId || "",
        metadata: { origin: metadata.origin || state.config.mode, liveReview: state.config.liveReview }
      }));
      state.session.lastCaptureId = capture.captureId;
      const importedEvent = await onImported({
        capture: completed.capture || capture,
        asset,
        importResult,
        liveReview: state.config.liveReview
      });
      await send("imported", { ...importedEvent, message: `Capture ${capture.sequence || ""} imported.`.trim() });
      return completed.capture || capture;
    } catch (error) {
      await invokeBackend("fail_photo_tether_capture", {
        captureId: capture.captureId,
        error: String(error?.message || error)
      }).catch(() => null);
      await send("import-failed", { capture, error: String(error?.message || error), message: "Capture import failed." });
      return null;
    }
  };

  async function processQueue(state) {
    if (!state || current !== state || state.processing) return;
    state.queueTimer = null;
    state.processing = true;
    try {
      while (current === state && state.queue.size) {
        const [filePath, metadata] = state.queue.entries().next().value;
        state.queue.delete(filePath);
        await ingestFile(state, filePath, metadata);
      }
    } finally {
      state.processing = false;
      if (current === state) await send("idle", { message: state.queue.size ? "Capture files are queued." : "Watching for the next capture." });
    }
  }

  const addDirectoryWatch = (state, directory) => {
    if (state.directoryWatchers.has(directory) || current !== state) return;
    try {
      const watcher = fsImpl.watch(directory, (eventType, filename) => {
        if (!filename || current !== state) return;
        const candidate = path.join(directory, String(filename));
        fsImpl.promises.stat(candidate).then((stat) => {
          if (stat.isDirectory()) return addDirectoryWatch(state, candidate);
          if (stat.isFile()) queueFile(state, candidate, { origin: "watch-event" });
        }).catch(() => null);
      });
      watcher.on?.("error", (error) => void send("watch-warning", { error: String(error?.message || error), message: "A folder watcher failed; reconciliation remains active." }));
      state.directoryWatchers.set(directory, watcher);
    } catch {
      // The periodic sweep still provides a complete fallback.
    }
  };

  const runSweep = async (state) => {
    if (!state || current !== state || state.sweeping) return;
    state.sweeping = true;
    try {
      const snapshot = await scanTree(state.config.sourcePath);
      if (state.watchMode === "directory") {
        for (const directory of snapshot.directories) addDirectoryWatch(state, directory);
      }
      for (const filePath of snapshot.files) {
        try {
          const stat = await fsImpl.promises.stat(filePath);
          const signature = `${Number(stat.size)}:${String(stat.mtimeNs ?? Math.round(stat.mtimeMs * 1_000_000))}`;
          if (state.observed.get(filePath) !== signature) queueFile(state, filePath, { origin: "reconciliation" });
        } catch { /* File moved during sweep. */ }
      }
    } finally {
      state.sweeping = false;
      if (current === state) state.sweepTimer = setTimeout(() => void runSweep(state), sweepIntervalMs);
    }
  };

  const beginWatching = async (state, queueBaseline) => {
    const initial = await scanTree(state.config.sourcePath);
    for (const filePath of initial.files) {
      try {
        const stat = await fsImpl.promises.stat(filePath);
        const signature = `${Number(stat.size)}:${String(stat.mtimeNs ?? Math.round(stat.mtimeMs * 1_000_000))}`;
        if (queueBaseline) queueFile(state, filePath, { origin: "resume", force: true });
        else state.observed.set(filePath, signature);
      } catch { /* File moved during baseline. */ }
    }
    try {
      const watcher = fsImpl.watch(state.config.sourcePath, { recursive: true }, (_eventType, filename) => {
        if (filename) queueFile(state, path.join(state.config.sourcePath, String(filename)), { origin: "watch-event" });
      });
      watcher.on?.("error", (error) => void send("watch-warning", { error: String(error?.message || error), message: "Recursive folder notifications failed; reconciliation remains active." }));
      state.rootWatcher = watcher;
      state.watchMode = "recursive";
    } catch {
      state.watchMode = "directory";
      for (const directory of initial.directories) addDirectoryWatch(state, directory);
    }
    state.sweepTimer = setTimeout(() => void runSweep(state), sweepIntervalMs);
  };

  const closeState = (state) => {
    if (state.queueTimer) clearTimeout(state.queueTimer);
    if (state.sweepTimer) clearTimeout(state.sweepTimer);
    try { state.rootWatcher?.close(); } catch { /* Already closed. */ }
    for (const watcher of state.directoryWatchers.values()) {
      try { watcher.close(); } catch { /* Already closed. */ }
    }
    state.directoryWatchers.clear();
    state.queue.clear();
  };

  const selectCamera = (detected, cameraId) => {
    if (!detected.available) throw codedError("E-PHOTO-TETHER-PTP-UNAVAILABLE", detected.message || "Direct camera control is unavailable.");
    const camera = detected.cameras.find((candidate) => candidate.id === cameraId) || detected.cameras[0];
    if (!camera) throw codedError("E-PHOTO-TETHER-CAMERA-NOT-FOUND", "Connect a supported camera or use watched-folder tethering.");
    return camera;
  };

  const start = async (payload = {}, resumeSession = null) => {
    if (current) throw codedError("E-PHOTO-TETHER-ACTIVE", "Stop the current capture session before starting another one.");
    const config = normalizeRuntimeOptions(resumeSession ? {
      ...resumeSession.settings,
      ...resumeSession,
      cameraId: resumeSession.camera?.id || ""
    } : payload);
    const stat = await fsImpl.promises.stat(config.sourcePath).catch(() => null);
    if (!stat?.isDirectory()) throw codedError("E-PHOTO-TETHER-PATH", "The capture folder is unavailable.");
    let detected = cameraCache || {
      available: false,
      executable: "",
      version: "",
      cameras: [],
      captureSupported: false,
      message: "Direct camera control has not been checked yet."
    };
    let camera = {};
    if (config.mode === "ptp") {
      detected = await cameraStatus(Boolean(payload.refreshCamera));
      camera = selectCamera(detected, config.cameraId);
    }
    const session = resumeSession
      ? unwrapBackendValue(await invokeBackend("update_photo_tether_session_status", { sessionId: resumeSession.sessionId, status: "active", error: "" }))
      : unwrapBackendValue(await invokeBackend("create_photo_tether_session", {
        mode: config.mode,
        sourcePath: config.sourcePath,
        destinationPath: config.destinationPath,
        storageMode: config.storageMode,
        managedRoot: config.managedRoot,
        namingTemplate: config.namingTemplate,
        nextSequence: config.nextSequence,
        sourceLabel: config.sourceLabel,
        camera,
        capabilities: {
          available: detected.available,
          executableAvailable: Boolean(detected.executable),
          version: detected.version,
          cameras: detected.cameras,
          captureSupported: detected.captureSupported,
          message: detected.message,
          ...(detected.error ? { error: detected.error } : {})
        },
        settings: {
          includeExisting: config.includeExisting,
          autoResume: config.autoResume,
          liveReview: config.liveReview
        }
      }));
    const state = {
      config,
      session,
      camera,
      cameraStatus: detected,
      queue: new Map(),
      observed: new Map(),
      directoryWatchers: new Map(),
      rootWatcher: null,
      queueTimer: null,
      sweepTimer: null,
      processing: false,
      sweeping: false,
      captureBusy: false,
      dropped: 0,
      watchMode: "",
      message: "Starting capture session."
    };
    current = state;
    try {
      await beginWatching(state, Boolean(resumeSession || config.includeExisting));
    } catch (error) {
      current = null;
      closeState(state);
      await invokeBackend("update_photo_tether_session_status", { sessionId: session.sessionId, status: "error", error: String(error?.message || error) }).catch(() => null);
      throw error;
    }
    state.message = config.mode === "ptp" ? "Camera connected; ready to capture." : "Watching for new capture files.";
    await send(resumeSession ? "resumed" : "started", { session, camera: detected, message: state.message });
    return { ...runtimeSnapshot(), session, camera: detected };
  };

  const stop = async (reason = "Capture session stopped.", stopOptions = {}) => {
    const state = current;
    if (!state) return { ...runtimeSnapshot(reason), session: null };
    current = null;
    closeState(state);
    let session = state.session;
    if (!stopOptions.preserveSession) {
      session = unwrapBackendValue(await invokeBackend("update_photo_tether_session_status", {
        sessionId: state.session.sessionId,
        status: "stopped",
        error: ""
      }).catch(() => state.session));
    }
    await send("stopped", { session, message: reason });
    return { ...runtimeSnapshot(reason), session };
  };

  const capture = async () => {
    const state = current;
    if (!state || state.config.mode !== "ptp") throw codedError("E-PHOTO-TETHER-NOT-PTP", "Start a direct-camera tether session first.");
    if (state.captureBusy) throw codedError("E-PHOTO-TETHER-CAPTURE-BUSY", "The previous camera capture is still running.");
    state.captureBusy = true;
    await send("capturing", { message: "Capturing from camera." });
    try {
      const detected = await cameraStatus(true);
      const camera = selectCamera(detected, state.camera.id);
      const reserved = unwrapBackendValue(await invokeBackend("reserve_photo_tether_sequence", { sessionId: state.session.sessionId }));
      const basename = renderTetherFilename(state.config.namingTemplate, {
        sequence: reserved.sequence,
        sessionId: state.session.sessionId,
        camera: camera.model
      });
      const outputPattern = path.join(state.config.destinationPath, `${basename}.%C`);
      if (!isPathInside(state.config.destinationPath, outputPattern)) throw codedError("E-PHOTO-TETHER-PATH", "Capture filename escaped the selected folder.");
      const args = ["--port", camera.port, "--capture-image-and-download", "--filename", outputPattern, "--keep"];
      const startedAt = Date.now();
      const command = await runBoundedCommand(detected.executable, args, {
        spawnImpl: options.spawnImpl,
        environment: options.environment,
        timeoutMs: options.captureTimeoutMs || 120_000,
        maxOutputBytes: 64 * 1024
      });
      if (command.code !== 0) throw codedError("E-PHOTO-TETHER-CAPTURE", command.stderr.trim() || "Camera capture failed.");
      const entries = await fsImpl.promises.readdir(state.config.destinationPath, { withFileTypes: true });
      const candidates = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith(`${basename}.`)) continue;
        const filePath = path.join(state.config.destinationPath, entry.name);
        if (!isMediaPath(filePath)) continue;
        const stat = await fsImpl.promises.stat(filePath).catch(() => null);
        if (stat && Number(stat.mtimeMs || 0) >= startedAt - 2_000) candidates.push({ filePath, mtimeMs: Number(stat.mtimeMs || 0) });
      }
      candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
      if (!candidates.length) throw codedError("E-PHOTO-TETHER-CAPTURE", "Camera reported success but no downloaded capture was found.");
      const imported = await ingestFile(state, candidates[0].filePath, { origin: "ptp", sequence: reserved.sequence, force: true });
      for (const candidate of candidates.slice(1)) queueFile(state, candidate.filePath, { origin: "ptp-companion", force: true });
      await invokeBackend("update_photo_tether_session_status", { sessionId: state.session.sessionId, status: "active", error: "" }).catch(() => null);
      return { capture: imported, sequence: reserved.sequence, command: { code: command.code } };
    } catch (error) {
      await invokeBackend("update_photo_tether_session_status", {
        sessionId: state.session.sessionId,
        status: "active",
        error: String(error?.message || error)
      }).catch(() => null);
      await send("capture-failed", { error: String(error?.message || error), code: String(error?.code || "E-PHOTO-TETHER-CAPTURE"), message: "Camera capture failed." });
      throw error;
    } finally {
      state.captureBusy = false;
    }
  };

  const status = async (refreshCamera = false) => {
    const persisted = unwrapBackendValue(await invokeBackend("photo_tether_status", current ? { sessionId: current.session.sessionId } : {}));
    const detected = await cameraStatus(refreshCamera);
    return {
      ...runtimeSnapshot(),
      session: current ? (persisted.session || current.session) : (persisted.active || null),
      recoverable: Array.isArray(persisted.recoverable) ? persisted.recoverable : [],
      recent: Array.isArray(persisted.recent) ? persisted.recent : [],
      camera: detected
    };
  };

  const resume = async (sessionId) => {
    if (current) throw codedError("E-PHOTO-TETHER-ACTIVE", "Stop the current capture session before resuming another one.");
    const persisted = unwrapBackendValue(await invokeBackend("photo_tether_status", { sessionId: String(sessionId || "") }));
    const session = persisted.session;
    if (!session) throw codedError("E-PHOTO-TETHER-NOT-FOUND", "The capture session was not found.");
    return start({}, session);
  };

  const resumePersisted = async () => {
    let recovered;
    try {
      recovered = unwrapBackendValue(await invokeBackend("recover_photo_tether_sessions", {}));
    } catch (error) {
      await send("resume-failed", { error: String(error?.message || error), message: "Capture-session recovery could not be checked." });
      return { resumed: false, recovered: null, error: String(error?.message || error) };
    }
    const candidate = Array.isArray(recovered.sessions)
      ? recovered.sessions.find((session) => session?.settings?.autoResume === true)
      : null;
    if (!candidate) return { resumed: false, recovered };
    try {
      const result = await start({}, candidate);
      return { resumed: true, recovered, result };
    } catch (error) {
      await send("resume-failed", { session: candidate, error: String(error?.message || error), message: "The previous capture session needs attention before it can resume." });
      return { resumed: false, recovered, error: String(error?.message || error) };
    }
  };

  return {
    start,
    stop,
    capture,
    resume,
    status,
    cameraStatus,
    resumePersisted,
    queueFile: (filePath, metadata = {}) => current ? queueFile(current, filePath, metadata) : false,
    snapshot: runtimeSnapshot
  };
}

module.exports = {
  DEFAULT_MEDIA_EXTENSIONS,
  createPhotoTetherRuntime,
  detectGphoto,
  executableCandidates,
  findGphotoExecutable,
  isPathInside,
  normalizeRuntimeOptions,
  parseGphotoAutoDetect,
  renderTetherFilename,
  runBoundedCommand,
  sanitizeFilenamePart,
  validateNamingTemplate,
  waitForStableFile
};

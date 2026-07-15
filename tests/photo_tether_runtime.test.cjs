const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createPhotoTetherRuntime,
  parseGphotoAutoDetect,
  renderTetherFilename,
  runBoundedCommand,
  validateNamingTemplate
} = require("../desktop/main/photo-tether-runtime.cjs");

function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const result = predicate();
      if (result) return resolve(result);
      if (Date.now() - startedAt >= timeoutMs) return reject(new Error("Timed out waiting for tether runtime event."));
      setTimeout(check, 25);
    };
    check();
  });
}

function fakeBackend() {
  let session = null;
  let nextCapture = 1;
  let importCalls = 0;
  const captures = new Map();
  const bySignature = new Map();
  return {
    get importCalls() { return importCalls; },
    get session() { return session; },
    async invoke(command, params = {}) {
      if (command === "create_photo_tether_session") {
        session = {
          sessionId: "tether_test",
          mode: params.mode,
          status: "active",
          sourcePath: params.sourcePath,
          destinationPath: params.destinationPath,
          storageMode: params.storageMode,
          managedRoot: params.managedRoot,
          namingTemplate: params.namingTemplate,
          nextSequence: params.nextSequence || 1,
          sourceLabel: params.sourceLabel,
          camera: params.camera || {},
          settings: params.settings || {},
          importedCount: 0,
          failedCount: 0,
          captures: []
        };
        return { value: session };
      }
      if (command === "photo_tether_status") {
        return params.sessionId
          ? { value: { session } }
          : { value: { active: session?.status === "active" ? session : null, recoverable: [], recent: session ? [session] : [] } };
      }
      if (command === "update_photo_tether_session_status") {
        session.status = params.status;
        session.lastError = params.error || "";
        return { value: session };
      }
      if (command === "reserve_photo_tether_sequence") {
        const sequence = session.nextSequence;
        session.nextSequence += 1;
        return { value: { sessionId: session.sessionId, sequence, nextSequence: session.nextSequence } };
      }
      if (command === "claim_photo_tether_capture") {
        const key = `${params.sourcePath}|${params.sourceSignature}`;
        const existingId = bySignature.get(key);
        if (existingId) return { value: { capture: captures.get(existingId), claimed: false, duplicate: true } };
        const sequence = params.sequence || session.nextSequence++;
        const capture = {
          captureId: `capture_${nextCapture++}`,
          sessionId: session.sessionId,
          sequence,
          sourcePath: params.sourcePath,
          sourceSignature: params.sourceSignature,
          status: "pending"
        };
        captures.set(capture.captureId, capture);
        bySignature.set(key, capture.captureId);
        return { value: { capture, claimed: true, duplicate: false } };
      }
      if (command === "import_photos") {
        importCalls += 1;
        const sourcePath = params.sourcePaths[0];
        return {
          value: {
            importId: `import_${importCalls}`,
            importedCount: 1,
            failedCount: 0,
            importedPaths: [sourcePath],
            assets: [{ assetId: `asset_${importCalls}`, sourcePath }]
          }
        };
      }
      if (command === "complete_photo_tether_capture") {
        const capture = captures.get(params.captureId);
        if (capture.status !== "imported") session.importedCount += 1;
        Object.assign(capture, {
          status: "imported",
          targetPath: params.targetPath,
          assetId: params.assetId,
          importId: params.importId
        });
        return { value: { capture, idempotent: false } };
      }
      if (command === "fail_photo_tether_capture") {
        const capture = captures.get(params.captureId);
        capture.status = "failed";
        capture.error = params.error;
        session.failedCount += 1;
        return { value: { capture } };
      }
      if (command === "recover_photo_tether_sessions") return { value: { sessions: [], recoveredSessions: 0, interruptedCaptures: 0 } };
      throw new Error(`Unexpected backend command: ${command}`);
    }
  };
}

async function writeFakeGphoto(root, options = {}) {
  const executable = path.join(root, options.name || "gphoto2");
  const delay = options.delaySeconds || 0;
  const source = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "gphoto2 2.5.test"
  exit 0
fi
if [ "$1" = "--auto-detect" ]; then
  echo "Model                          Port"
  echo "----------------------------------------------------------"
  echo "Fixture Camera                 usb:001,002"
  exit 0
fi
${delay ? `sleep ${delay}\n` : ""}
output=""
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--filename" ]; then
    shift
    output="$1"
  fi
  shift
done
output=$(printf "%s" "$output" | sed 's/%C/JPG/g')
printf "fixture-camera-bytes" > "$output"
echo "Saving file as $output"
`;
  await fs.promises.writeFile(executable, source, { mode: 0o755 });
  await fs.promises.chmod(executable, 0o755);
  return executable;
}

function testNamingAndCameraParsing() {
  const rendered = renderTetherFilename("studio_{date}_{camera}_{sequence:05}", {
    date: new Date("2026-07-14T08:09:10Z"),
    camera: "EOS R5 / body A",
    sequence: 42
  });
  assert.match(rendered, /^studio_\d{8}_EOS_R5_body_A_00042$/);
  assert.throws(() => validateNamingTemplate("../escape_{sequence}"), /without folders/);
  assert.throws(() => validateNamingTemplate("capture_{unknown}"), /Unknown capture naming token/);
  assert.deepStrictEqual(
    parseGphotoAutoDetect("Model Port\n------\nCanon EOS R5    usb:001,002\nSony Alpha usb:003,004\n"),
    [
      { id: "Canon EOS R5|usb:001,002", model: "Canon EOS R5", port: "usb:001,002" },
      { id: "Sony Alpha|usb:003,004", model: "Sony Alpha", port: "usb:003,004" }
    ]
  );
}

async function testWatchedFolderStabilizesAndDeduplicates() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vintrace-tether-watch-"));
  const backend = fakeBackend();
  const events = [];
  const runtime = createPhotoTetherRuntime({
    invokeBackend: backend.invoke,
    emit: (event) => events.push(event),
    stablePollMs: 35,
    stableSamples: 3,
    stableTimeoutMs: 2_000,
    watchDebounceMs: 25,
    sweepIntervalMs: 250
  });
  try {
    await runtime.start({ mode: "watch", sourcePath: root, includeExisting: false, autoResume: true });
    const capturePath = path.join(root, "partial-write.cr3");
    await fs.promises.writeFile(capturePath, "first-half");
    setTimeout(() => fs.promises.appendFile(capturePath, "-second-half"), 55);
    const imported = await waitFor(() => events.find((event) => event.type === "imported"));
    assert.strictEqual(imported.asset.assetId, "asset_1");
    assert.strictEqual(await fs.promises.readFile(capturePath, "utf8"), "first-half-second-half");
    assert.strictEqual(backend.importCalls, 1);

    runtime.queueFile(capturePath, { origin: "duplicate-event", force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.strictEqual(backend.importCalls, 1, "duplicate file signature must not import twice");
    assert.strictEqual(backend.session.importedCount, 1);
  } finally {
    await runtime.stop("Test complete.").catch(() => null);
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function testDirectCameraUsesFixedArgsAndImportsDownload() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vintrace-tether-ptp-"));
  const executable = await writeFakeGphoto(root);
  const backend = fakeBackend();
  const calls = [];
  const events = [];
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args: [...args], options: { ...options } });
    return childProcess.spawn(command, args, options);
  };
  const runtime = createPhotoTetherRuntime({
    invokeBackend: backend.invoke,
    emit: (event) => events.push(event),
    spawnImpl,
    environment: { ...process.env, CROSSAGE_GPHOTO2_PATH: executable },
    stablePollMs: 25,
    stableSamples: 2,
    watchDebounceMs: 200,
    sweepIntervalMs: 2_000,
    detectTimeoutMs: 2_000,
    captureTimeoutMs: 3_000
  });
  try {
    const started = await runtime.start({
      mode: "ptp",
      sourcePath: root,
      destinationPath: root,
      namingTemplate: "shoot_{sequence:04}",
      cameraId: "Fixture Camera|usb:001,002"
    });
    assert.strictEqual(started.camera.captureSupported, true);
    const result = await runtime.capture();
    assert.strictEqual(result.sequence, 1);
    assert.strictEqual(backend.importCalls, 1);
    assert.ok(events.some((event) => event.type === "imported"));
    const captureCall = calls.find((call) => call.args.includes("--capture-image-and-download"));
    assert.ok(captureCall, calls);
    assert.strictEqual(captureCall.options.shell, false);
    assert.deepStrictEqual(captureCall.args.slice(0, 3), ["--port", "usb:001,002", "--capture-image-and-download"]);
    assert.ok(captureCall.args.includes("--keep"));
    const filename = captureCall.args[captureCall.args.indexOf("--filename") + 1];
    assert.ok(filename.startsWith(root + path.sep) && filename.endsWith("shoot_0001.%C"), filename);
  } finally {
    await runtime.stop("Test complete.").catch(() => null);
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function testCameraCommandTimeoutIsBounded() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vintrace-tether-timeout-"));
  try {
    const executable = await writeFakeGphoto(root, { name: "slow-gphoto2", delaySeconds: 2 });
    await assert.rejects(
      runBoundedCommand(executable, ["--capture-image-and-download", "--filename", path.join(root, "late.%C")], { timeoutMs: 75 }),
      (error) => error && error.code === "E-PHOTO-TETHER-TIMEOUT"
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
}

async function main() {
  testNamingAndCameraParsing();
  console.log("ok tether naming and camera parsing guards");
  await testWatchedFolderStabilizesAndDeduplicates();
  console.log("ok watched-folder stabilization and duplicate suppression");
  await testDirectCameraUsesFixedArgsAndImportsDownload();
  console.log("ok direct-camera fixed argv capture and import");
  await testCameraCommandTimeoutIsBounded();
  console.log("ok camera command timeout bound");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

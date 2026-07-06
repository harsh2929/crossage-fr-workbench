// Characterization tests for the sensitive-collection privacy lock state machine
// (extracted from PhotosView.tsx for isolated coverage). These pin the CURRENT
// behavior — the guard that decides when Safe Mode's hidden collections lock,
// unlock, and auto-relock — so the 32k-line PhotosView can be refactored safely.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sensitive-")), "sensitiveCollections.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/sensitiveCollections.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const mod = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

// Minimal settings factory (mirrors the four PhotoLocalSettings fields the guard reads).
const S = (over = {}) => ({
  lockSensitiveCollections: true,
  relockSensitiveCollectionsOnLeave: true,
  sensitiveSessionLockMinutes: 15,
  sensitiveOsAuthEnabled: false,
  ...over,
});

// ---- initialSensitiveUnlocked: collections start unlocked only when locking is off ----

run("starts locked when locking is enabled", () => {
  assert.strictEqual(mod.initialSensitiveUnlocked(S({ lockSensitiveCollections: true })), false);
});
run("starts unlocked when locking is disabled", () => {
  assert.strictEqual(mod.initialSensitiveUnlocked(S({ lockSensitiveCollections: false })), true);
});

// ---- sensitiveSessionLockTimeoutMs: auto-relock delay, or null for no timer ----

run("no timer when locking is disabled", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ lockSensitiveCollections: false }), true), null);
});
run("no timer when the session is already locked", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S(), false), null);
});
run("no timer when the minute budget is zero", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ sensitiveSessionLockMinutes: 0 }), true), null);
});
run("no timer when the minute budget is negative", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ sensitiveSessionLockMinutes: -5 }), true), null);
});
run("15 minutes unlocked → 900000 ms", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ sensitiveSessionLockMinutes: 15 }), true), 900000);
});
run("1 minute → 60000 ms", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ sensitiveSessionLockMinutes: 1 }), true), 60000);
});
run("sub-minute positive budget clamps up to 1 minute (Math.max(1, minutes))", () => {
  assert.strictEqual(mod.sensitiveSessionLockTimeoutMs(S({ sensitiveSessionLockMinutes: 0.5 }), true), 60000);
});

// ---- shouldRelockOnLeave: re-lock on window blur only when both toggles are on ----

run("relocks on leave only when both toggles are enabled", () => {
  assert.strictEqual(mod.shouldRelockOnLeave(S({ lockSensitiveCollections: true, relockSensitiveCollectionsOnLeave: true })), true);
  assert.strictEqual(mod.shouldRelockOnLeave(S({ lockSensitiveCollections: true, relockSensitiveCollectionsOnLeave: false })), false);
  assert.strictEqual(mod.shouldRelockOnLeave(S({ lockSensitiveCollections: false, relockSensitiveCollectionsOnLeave: true })), false);
  assert.strictEqual(mod.shouldRelockOnLeave(S({ lockSensitiveCollections: false, relockSensitiveCollectionsOnLeave: false })), false);
});

// ---- sensitiveUnlockRequirements: what proof unlock still needs ----

run("locking off requires nothing", () => {
  const req = mod.sensitiveUnlockRequirements(S({ lockSensitiveCollections: false, sensitiveOsAuthEnabled: true }), {
    passcodeProvided: false, verifiedWithDevice: false, passcodeConfigured: true,
  });
  assert.deepStrictEqual(req, { deviceAuthRequired: false, passcodeRequired: false });
});
run("device auth required when OS auth is on and no passcode was typed", () => {
  const req = mod.sensitiveUnlockRequirements(S({ sensitiveOsAuthEnabled: true }), {
    passcodeProvided: false, verifiedWithDevice: false, passcodeConfigured: false,
  });
  assert.strictEqual(req.deviceAuthRequired, true);
});
run("a typed passcode bypasses the device-auth prompt", () => {
  const req = mod.sensitiveUnlockRequirements(S({ sensitiveOsAuthEnabled: true }), {
    passcodeProvided: true, verifiedWithDevice: false, passcodeConfigured: true,
  });
  assert.strictEqual(req.deviceAuthRequired, false);
});
run("passcode required when configured and device auth did not verify", () => {
  const req = mod.sensitiveUnlockRequirements(S(), {
    passcodeProvided: false, verifiedWithDevice: false, passcodeConfigured: true,
  });
  assert.strictEqual(req.passcodeRequired, true);
});
run("a successful device verify bypasses the passcode requirement", () => {
  const req = mod.sensitiveUnlockRequirements(S(), {
    passcodeProvided: false, verifiedWithDevice: true, passcodeConfigured: true,
  });
  assert.strictEqual(req.passcodeRequired, false);
});
run("no passcode configured and OS auth off → unlock proceeds freely", () => {
  const req = mod.sensitiveUnlockRequirements(S({ sensitiveOsAuthEnabled: false }), {
    passcodeProvided: false, verifiedWithDevice: false, passcodeConfigured: false,
  });
  assert.deepStrictEqual(req, { deviceAuthRequired: false, passcodeRequired: false });
});

console.log("\nall sensitive-collection tests passed");

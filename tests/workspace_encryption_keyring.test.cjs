"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const {
  KEY_ENV,
  PREVIOUS_KEY_ENV,
  RECOVERY_PASSPHRASE_ENV,
  commitWorkspaceKeyRotation,
  configureWorkspaceRecoveryPassphrase,
  encodeWorkspaceKey,
  readKeyRecord,
  reconcileWorkspaceKeyRotation,
  resolveDesktopWorkspaceKeys,
  resolveHeadlessWorkspaceKeys,
  safeStorageProtectionStatus,
  stageWorkspaceKeyRotation,
  workspaceKeyId,
  workspaceRecoveryStatus,
} = require("../desktop/main/workspace-encryption.cjs");

function fakeSafeStorage(label = "account-a") {
  const key = crypto.createHash("sha256").update(`fake-safe-storage:${label}`).digest();
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString(value) {
      const nonce = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
      return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]);
    },
    decryptString(payload) {
      const nonce = payload.subarray(0, 12);
      const tag = payload.subarray(payload.length - 16);
      const ciphertext = payload.subarray(12, payload.length - 16);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    },
  };
}

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (!Object.prototype.hasOwnProperty.call(extra, KEY_ENV)) delete env[KEY_ENV];
  if (!Object.prototype.hasOwnProperty.call(extra, PREVIOUS_KEY_ENV)) delete env[PREVIOUS_KEY_ENV];
  if (!Object.prototype.hasOwnProperty.call(extra, RECOVERY_PASSPHRASE_ENV)) {
    delete env[RECOVERY_PASSPHRASE_ENV];
  }
  return env;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-keyring-test-"));
try {
  const workspace = path.join(root, "workspace");
  const safeA = fakeSafeStorage("account-a");
  const safeB = fakeSafeStorage("account-b");
  const passphrase = "correct horse battery staple for workspace recovery";
  const recoveryEnv = cleanEnv({ [RECOVERY_PASSPHRASE_ENV]: passphrase });

  assert.deepStrictEqual(
    safeStorageProtectionStatus({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => "gnome_libsecret",
    }, "linux"),
    { ok: true, available: true, backend: "gnome_libsecret", reason: "" },
  );
  for (const backend of ["basic_text", "unknown", ""]) {
    const status = safeStorageProtectionStatus({
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend,
    }, "linux");
    assert.equal(status.ok, false, `${backend || "empty"} must not protect biometric workspace keys`);
    assert.equal(status.reason, "linux-secret-store-unprotected");
  }

  const created = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeA, env: recoveryEnv });
  assert.equal(created.source, "generated-os-key");
  assert.equal(created.primaryKey.length, 32);
  assert.equal(created.pending, false);
  const recordPath = path.join(workspace, ".vintrace-db-key.json");
  const recordText = fs.readFileSync(recordPath, "utf8");
  assert(!recordText.includes(created.primaryEncoded), "key record must not contain plaintext key bytes");
  assert(!recordText.includes(passphrase), "key record must not contain the recovery passphrase");
  assert(readKeyRecord(workspace).current.recovery, "passphrase should create a recovery envelope");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(recordPath).mode & 0o777, 0o600, "key record must be owner-only");
  }

  const reopened = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeA, env: cleanEnv() });
  assert.equal(reopened.keyId, created.keyId);
  assert(reopened.primaryKey.equals(created.primaryKey));

  assert.throws(
    () => resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeB, env: cleanEnv() }),
    /recovery passphrase/i,
  );
  const recovered = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeB, env: recoveryEnv });
  assert.equal(recovered.source, "recovery-passphrase");
  assert(recovered.primaryKey.equals(created.primaryKey));
  const rewrapped = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeB, env: cleanEnv() });
  assert(rewrapped.primaryKey.equals(created.primaryKey), "recovered key should be rewrapped for the new OS account");

  const headless = resolveHeadlessWorkspaceKeys({ workspace, env: recoveryEnv });
  assert(headless.primaryKey.equals(created.primaryKey));
  assert.throws(
    () => resolveHeadlessWorkspaceKeys({ workspace, env: cleanEnv({ [RECOVERY_PASSPHRASE_ENV]: "wrong passphrase" }) }),
    /incorrect|modified/i,
  );
  assert.throws(() => resolveHeadlessWorkspaceKeys({ workspace, env: cleanEnv() }), /requires VINTRACE_WORKSPACE_DB_KEY/i);

  const python = process.platform === "win32"
    ? path.join(__dirname, "..", ".venv", "Scripts", "python.exe")
    : path.join(__dirname, "..", ".venv", "bin", "python");
  const interop = spawnSync(
    python,
    ["-c", "from pathlib import Path; from crossage_fr.store.workspace_encryption import WorkspaceEncryption; e=WorkspaceEncryption.from_environment(Path(__import__('os').environ['WS'])); print(e.key_id)"],
    {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: { ...recoveryEnv, WS: workspace, PYTHONPATH: path.join(__dirname, ".."), VINTRACE_REQUIRE_DB_ENCRYPTION: "1" },
    },
  );
  assert.equal(interop.status, 0, interop.stderr);
  assert.equal(interop.stdout.trim(), created.keyId, "Node recovery envelopes must decrypt in Python");

  const staged = stageWorkspaceKeyRotation({ workspace, safeStorage: safeB, env: recoveryEnv });
  assert.notEqual(staged.newKeyId, staged.oldKeyId);
  const duringRotation = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeB, env: cleanEnv() });
  assert.equal(duringRotation.keyId, staged.newKeyId, "pending key should be tried first after a crash");
  assert.equal(duringRotation.previousKeyId, staged.oldKeyId);
  commitWorkspaceKeyRotation({ workspace, activeKeyId: staged.newKeyId });
  const rotated = resolveDesktopWorkspaceKeys({ workspace, safeStorage: safeB, env: cleanEnv() });
  assert.equal(rotated.keyId, staged.newKeyId);
  assert.equal(rotated.previousKeyId, "");
  staged.newKey.fill(0);

  const abandoned = stageWorkspaceKeyRotation({ workspace, safeStorage: safeB, env: recoveryEnv });
  const discarded = reconcileWorkspaceKeyRotation({ workspace, activeKeyId: abandoned.oldKeyId });
  assert.equal(discarded.action, "discarded");
  assert.equal(readKeyRecord(workspace).pending, undefined);
  abandoned.newKey.fill(0);

  const failedRotationKey = Buffer.alloc(32, 0xa5);
  const failingFs = new Proxy(fs, {
    get(target, property) {
      if (property === "renameSync") return () => { throw new Error("simulated atomic rename failure"); };
      return Reflect.get(target, property);
    },
  });
  assert.throws(
    () => stageWorkspaceKeyRotation({
      workspace,
      safeStorage: safeB,
      env: recoveryEnv,
      fsImpl: failingFs,
      randomBytes: (size) => size === 32 ? failedRotationKey : crypto.randomBytes(size),
    }),
    /simulated atomic rename failure/,
  );
  assert(failedRotationKey.every((value) => value === 0), "a failed rotation must wipe its generated key buffer");
  assert.equal(readKeyRecord(workspace).pending, undefined);

  const directWorkspace = path.join(root, "direct");
  const directKey = crypto.randomBytes(32);
  const previousKey = crypto.randomBytes(32);
  const direct = resolveDesktopWorkspaceKeys({
    workspace: directWorkspace,
    safeStorage: { isEncryptionAvailable: () => false },
    env: cleanEnv({
      [KEY_ENV]: encodeWorkspaceKey(directKey),
      [PREVIOUS_KEY_ENV]: encodeWorkspaceKey(previousKey),
    }),
  });
  assert.equal(direct.source, "environment");
  assert.equal(direct.keyId, workspaceKeyId(directKey));
  assert.equal(direct.previousKeyId, workspaceKeyId(previousKey));
  assert(!fs.existsSync(path.join(directWorkspace, ".vintrace-db-key.json")));

  const unavailableWorkspace = path.join(root, "unavailable");
  assert.throws(
    () => resolveDesktopWorkspaceKeys({ workspace: unavailableWorkspace, safeStorage: { isEncryptionAvailable: () => false }, env: cleanEnv() }),
    /OS-backed/i,
  );

  const agentWorkspace = path.join(root, "agent-recovery");
  const agentCreated = resolveDesktopWorkspaceKeys({ workspace: agentWorkspace, safeStorage: safeA, env: cleanEnv() });
  const agentRecoveryCode = crypto.randomBytes(32).toString("base64url");
  configureWorkspaceRecoveryPassphrase({
    workspace: agentWorkspace,
    passphrase: agentRecoveryCode,
    safeStorage: safeA,
    env: cleanEnv(),
  });
  assert.equal(workspaceRecoveryStatus({ workspace: agentWorkspace }).configured, true);
  const agentRecordText = fs.readFileSync(path.join(agentWorkspace, ".vintrace-db-key.json"), "utf8");
  assert(!agentRecordText.includes(agentRecoveryCode));
  const agentHeadlessEnv = cleanEnv({ [RECOVERY_PASSPHRASE_ENV]: agentRecoveryCode });
  assert.equal(resolveHeadlessWorkspaceKeys({ workspace: agentWorkspace, env: agentHeadlessEnv }).keyId, agentCreated.keyId);
  const agentRotation = stageWorkspaceKeyRotation({ workspace: agentWorkspace, safeStorage: safeA, env: cleanEnv() });
  assert(readKeyRecord(agentWorkspace).pending.recovery, "OS-wrapped recovery code must carry through rotation");
  const agentHeadlessPending = resolveHeadlessWorkspaceKeys({ workspace: agentWorkspace, env: agentHeadlessEnv });
  assert.equal(agentHeadlessPending.keyId, agentRotation.newKeyId);
  assert.equal(agentHeadlessPending.previousKeyId, agentRotation.oldKeyId);
  commitWorkspaceKeyRotation({ workspace: agentWorkspace, activeKeyId: agentRotation.newKeyId });
  assert.equal(resolveHeadlessWorkspaceKeys({ workspace: agentWorkspace, env: agentHeadlessEnv }).keyId, agentRotation.newKeyId);
  agentRotation.newKey.fill(0);

  const malformedWorkspace = path.join(root, "malformed");
  fs.mkdirSync(malformedWorkspace);
  fs.writeFileSync(path.join(malformedWorkspace, ".vintrace-db-key.json"), "not json", { mode: 0o600 });
  assert.throws(
    () => resolveDesktopWorkspaceKeys({ workspace: malformedWorkspace, safeStorage: safeA, env: cleanEnv() }),
    /unreadable/i,
  );
  assert.equal(fs.readFileSync(path.join(malformedWorkspace, ".vintrace-db-key.json"), "utf8"), "not json");

  console.log("workspace encryption keyring ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

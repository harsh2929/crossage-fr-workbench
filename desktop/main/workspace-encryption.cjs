"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_RECORD_FILENAME = ".vintrace-db-key.json";
const KEY_ENV = "VINTRACE_WORKSPACE_DB_KEY";
const PREVIOUS_KEY_ENV = "VINTRACE_WORKSPACE_DB_PREVIOUS_KEY";
const RECOVERY_PASSPHRASE_ENV = "VINTRACE_DB_RECOVERY_PASSPHRASE";
const REQUIRE_ENCRYPTION_ENV = "VINTRACE_REQUIRE_DB_ENCRYPTION";
const RECOVERY_AAD_PREFIX = Buffer.from("vintrace-workspace-key-recovery-v1\0", "utf8");
const SCRYPT_N = 65_536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 128 * 1024 * 1024;

class WorkspaceKeyError extends Error {
  constructor(message, code = "E-WORKSPACE-KEY") {
    super(message);
    this.name = "WorkspaceKeyError";
    this.code = code;
  }
}

function parseWorkspaceKey(value) {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) {
      throw new WorkspaceKeyError("The workspace database key must contain exactly 32 bytes.");
    }
    return Buffer.from(value);
  }
  const raw = String(value || "").trim().replace(/^base64:/, "");
  if (!raw) return null;
  let decoded;
  try {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      decoded = Buffer.from(raw, "hex");
    } else {
      if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(raw)) throw new Error("invalid base64 key");
      decoded = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    }
  } catch {
    decoded = Buffer.alloc(0);
  }
  if (decoded.length !== 32) {
    throw new WorkspaceKeyError("The workspace database key must decode to exactly 32 bytes.");
  }
  return decoded;
}

function encodeWorkspaceKey(key) {
  const parsed = parseWorkspaceKey(key);
  if (!parsed) throw new WorkspaceKeyError("A workspace database key is required.");
  return parsed.toString("base64url");
}

function workspaceKeyId(key) {
  const parsed = parseWorkspaceKey(key);
  if (!parsed) return "";
  return crypto.createHash("sha256")
    .update(Buffer.from("vintrace-workspace-key-v1\0", "utf8"))
    .update(parsed)
    .digest("hex")
    .slice(0, 24);
}

function keyRecordPath(workspace) {
  const value = String(workspace || "").trim();
  if (!value) throw new WorkspaceKeyError("A workspace path is required.", "E-WORKSPACE-KEY-RECORD");
  return path.join(path.resolve(value), KEY_RECORD_FILENAME);
}

function readKeyRecord(workspace, fsImpl = fs) {
  const recordPath = keyRecordPath(workspace);
  if (!fsImpl.existsSync(recordPath)) return null;
  try {
    if (fsImpl.statSync(recordPath).size > 65_536) {
      throw new WorkspaceKeyError("The workspace key record exceeds its size limit.", "E-WORKSPACE-KEY-RECORD");
    }
  } catch (error) {
    if (error instanceof WorkspaceKeyError) throw error;
    throw new WorkspaceKeyError("The workspace key record cannot be inspected.", "E-WORKSPACE-KEY-RECORD");
  }
  let record;
  try {
    record = JSON.parse(fsImpl.readFileSync(recordPath, "utf8"));
  } catch (error) {
    throw new WorkspaceKeyError(
      `The workspace key record is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      "E-WORKSPACE-KEY-RECORD"
    );
  }
  if (!record || record.schemaVersion !== 1 || !record.current || typeof record.current !== "object") {
    throw new WorkspaceKeyError("The workspace key record has an unsupported format.", "E-WORKSPACE-KEY-RECORD");
  }
  return record;
}

function writeKeyRecordAtomic(workspace, record, fsImpl = fs) {
  const recordPath = keyRecordPath(workspace);
  const parent = path.dirname(recordPath);
  fsImpl.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const tempPath = path.join(parent, `.${path.basename(recordPath)}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`);
  const data = `${JSON.stringify(record, null, 2)}\n`;
  let fd;
  try {
    fd = fsImpl.openSync(tempPath, "wx", 0o600);
    fsImpl.writeFileSync(fd, data, "utf8");
    fsImpl.fsyncSync(fd);
    fsImpl.closeSync(fd);
    fd = undefined;
    fsImpl.renameSync(tempPath, recordPath);
    try {
      fsImpl.chmodSync(recordPath, 0o600);
    } catch {
      // Windows ACLs are authoritative; chmod is best effort there.
    }
    try {
      const dirFd = fsImpl.openSync(parent, "r");
      fsImpl.fsyncSync(dirFd);
      fsImpl.closeSync(dirFd);
    } catch {
      // Directory fsync is unavailable on some Windows filesystems.
    }
  } finally {
    if (fd !== undefined) {
      try { fsImpl.closeSync(fd); } catch { /* already closed */ }
    }
    try { fsImpl.unlinkSync(tempPath); } catch { /* rename succeeded */ }
  }
  return recordPath;
}

function recoveryAad(keyId) {
  return Buffer.concat([RECOVERY_AAD_PREFIX, Buffer.from(String(keyId || ""), "ascii")]);
}

function deriveRecoveryKey(passphrase, salt, params = {}) {
  const secret = String(passphrase || "");
  if (!secret) {
    throw new WorkspaceKeyError("A recovery passphrase is required.", "E-WORKSPACE-RECOVERY");
  }
  const n = Number(params.n || SCRYPT_N);
  const r = Number(params.r || SCRYPT_R);
  const p = Number(params.p || SCRYPT_P);
  if (n < 16_384 || n > 1_048_576 || (n & (n - 1)) !== 0 || r < 1 || r > 32 || p < 1 || p > 16) {
    throw new WorkspaceKeyError("The workspace recovery envelope uses invalid scrypt parameters.", "E-WORKSPACE-RECOVERY");
  }
  return crypto.scryptSync(secret, salt, 32, { N: n, r, p, maxmem: SCRYPT_MAXMEM });
}

function createRecoveryEnvelope(key, passphrase, randomBytes = crypto.randomBytes) {
  const parsed = parseWorkspaceKey(key);
  if (!parsed) throw new WorkspaceKeyError("A workspace database key is required.");
  const keyId = workspaceKeyId(parsed);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const derived = deriveRecoveryKey(passphrase, salt);
  let ciphertext;
  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", derived, nonce);
    cipher.setAAD(recoveryAad(keyId));
    ciphertext = Buffer.concat([cipher.update(parsed), cipher.final(), cipher.getAuthTag()]);
  } finally {
    derived.fill(0);
  }
  return {
    kdf: "scrypt",
    n: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    cipher: "aes-256-gcm",
    salt: salt.toString("base64"),
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decryptRecoveryEnvelope(slot, passphrase) {
  const envelope = slot && slot.recovery;
  if (!envelope || envelope.kdf !== "scrypt" || envelope.cipher !== "aes-256-gcm") {
    throw new WorkspaceKeyError("This workspace does not have a passphrase recovery envelope.", "E-WORKSPACE-RECOVERY");
  }
  let derived;
  try {
    const salt = Buffer.from(String(envelope.salt || ""), "base64");
    const nonce = Buffer.from(String(envelope.nonce || ""), "base64");
    const payload = Buffer.from(String(envelope.ciphertext || ""), "base64");
    if (salt.length < 16 || nonce.length !== 12 || payload.length !== 48) throw new Error("invalid envelope length");
    derived = deriveRecoveryKey(passphrase, salt, envelope);
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", derived, nonce);
    decipher.setAAD(recoveryAad(slot.keyId));
    decipher.setAuthTag(tag);
    const key = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (workspaceKeyId(key) !== slot.keyId) throw new Error("key identifier mismatch");
    return parseWorkspaceKey(key);
  } catch (error) {
    if (error instanceof WorkspaceKeyError) throw error;
    throw new WorkspaceKeyError("The workspace recovery passphrase is incorrect or the key record was modified.", "E-WORKSPACE-RECOVERY");
  } finally {
    derived?.fill(0);
  }
}

function safeStorageProtectionStatus(safeStorage, platform = process.platform) {
  let available = false;
  try {
    available = Boolean(safeStorage && safeStorage.isEncryptionAvailable());
  } catch {
    available = false;
  }
  if (!available) {
    return { ok: false, available: false, backend: "unavailable", reason: "encryption-unavailable" };
  }
  if (platform !== "linux") {
    return { ok: true, available: true, backend: platform === "darwin" ? "keychain" : "dpapi", reason: "" };
  }
  let backend = "unknown";
  try {
    backend = String(safeStorage.getSelectedStorageBackend?.() || "unknown").trim().toLowerCase();
  } catch {
    backend = "unknown";
  }
  const protectedBackends = new Set(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"]);
  return {
    ok: protectedBackends.has(backend),
    available: true,
    backend,
    reason: protectedBackends.has(backend) ? "" : "linux-secret-store-unprotected",
  };
}

function encryptionAvailable(safeStorage) {
  return safeStorageProtectionStatus(safeStorage).ok;
}

function createKeySlot(key, { safeStorage, passphrase = "", randomBytes = crypto.randomBytes } = {}) {
  if (!encryptionAvailable(safeStorage)) {
    throw new WorkspaceKeyError("OS-backed workspace key encryption is unavailable; Linux requires Secret Service or KWallet and rejects basic_text storage.", "E-WORKSPACE-KEY-UNAVAILABLE");
  }
  const parsed = parseWorkspaceKey(key);
  if (!parsed) throw new WorkspaceKeyError("A workspace database key is required.");
  const slot = {
    keyId: workspaceKeyId(parsed),
    wrappedKey: safeStorage.encryptString(encodeWorkspaceKey(parsed)).toString("base64"),
  };
  if (passphrase) slot.recovery = createRecoveryEnvelope(parsed, passphrase, randomBytes);
  return slot;
}

function unwrapKeySlot(slot, { safeStorage, passphrase = "" } = {}) {
  if (!slot || !slot.keyId) {
    throw new WorkspaceKeyError("The workspace key record is missing a key slot.", "E-WORKSPACE-KEY-RECORD");
  }
  if (slot.wrappedKey && encryptionAvailable(safeStorage)) {
    try {
      const decoded = safeStorage.decryptString(Buffer.from(String(slot.wrappedKey), "base64"));
      const key = parseWorkspaceKey(decoded);
      if (workspaceKeyId(key) !== slot.keyId) throw new Error("key identifier mismatch");
      return { key, recovered: false };
    } catch {
      // A moved workspace can still be recovered with its optional passphrase envelope.
    }
  }
  if (passphrase && slot.recovery) {
    return { key: decryptRecoveryEnvelope(slot, passphrase), recovered: true };
  }
  throw new WorkspaceKeyError(
    "The workspace database key could not be unlocked for this OS account. Use the configured recovery passphrase.",
    "E-WORKSPACE-KEY-UNLOCK"
  );
}

function storedRecoveryPassphrase(record, safeStorage) {
  if (!record?.wrappedRecoveryPassphrase || !encryptionAvailable(safeStorage)) return "";
  try {
    return String(safeStorage.decryptString(Buffer.from(String(record.wrappedRecoveryPassphrase), "base64")) || "");
  } catch {
    return "";
  }
}

function resultForKeys(primaryKey, previousKey, metadata = {}) {
  return {
    primaryKey,
    previousKey: previousKey || null,
    primaryEncoded: encodeWorkspaceKey(primaryKey),
    previousEncoded: previousKey ? encodeWorkspaceKey(previousKey) : "",
    keyId: workspaceKeyId(primaryKey),
    previousKeyId: previousKey ? workspaceKeyId(previousKey) : "",
    ...metadata,
  };
}

function resolveEnvironmentKeys(env) {
  const primary = parseWorkspaceKey(env && env[KEY_ENV]);
  if (!primary) return null;
  const previous = parseWorkspaceKey(env && env[PREVIOUS_KEY_ENV]);
  return resultForKeys(primary, previous, { source: "environment", recordPath: "", pending: Boolean(previous) });
}

function resolveDesktopWorkspaceKeys({ workspace, safeStorage, env = process.env, fsImpl = fs, randomBytes = crypto.randomBytes } = {}) {
  const direct = resolveEnvironmentKeys(env);
  if (direct) return direct;
  if (!encryptionAvailable(safeStorage)) {
    throw new WorkspaceKeyError("OS-backed workspace key encryption is unavailable; Linux requires Secret Service or KWallet and rejects basic_text storage.", "E-WORKSPACE-KEY-UNAVAILABLE");
  }
  const passphrase = String((env && env[RECOVERY_PASSPHRASE_ENV]) || "");
  let record = readKeyRecord(workspace, fsImpl);
  if (!record) {
    const key = randomBytes(32);
    record = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      current: createKeySlot(key, { safeStorage, passphrase, randomBytes }),
    };
    if (passphrase) record.wrappedRecoveryPassphrase = safeStorage.encryptString(passphrase).toString("base64");
    writeKeyRecordAtomic(workspace, record, fsImpl);
    return resultForKeys(key, null, { source: "generated-os-key", recordPath: keyRecordPath(workspace), pending: false });
  }

  const current = unwrapKeySlot(record.current, { safeStorage, passphrase });
  const pending = record.pending ? unwrapKeySlot(record.pending, { safeStorage, passphrase }) : null;
  let changed = false;
  for (const [slot, resolved] of [[record.current, current], [record.pending, pending]]) {
    if (!slot || !resolved) continue;
    if (resolved.recovered) {
      slot.wrappedKey = safeStorage.encryptString(encodeWorkspaceKey(resolved.key)).toString("base64");
      changed = true;
    }
    if (passphrase && !slot.recovery) {
      slot.recovery = createRecoveryEnvelope(resolved.key, passphrase, randomBytes);
      changed = true;
    }
  }
  if (passphrase && (!record.wrappedRecoveryPassphrase || !storedRecoveryPassphrase(record, safeStorage))) {
    record.wrappedRecoveryPassphrase = safeStorage.encryptString(passphrase).toString("base64");
    changed = true;
  }
  if (changed) writeKeyRecordAtomic(workspace, record, fsImpl);
  return resultForKeys(
    pending ? pending.key : current.key,
    pending ? current.key : null,
    {
      source: current.recovered || pending?.recovered ? "recovery-passphrase" : "os-keychain",
      recordPath: keyRecordPath(workspace),
      pending: Boolean(pending),
    }
  );
}

function configureWorkspaceRecoveryPassphrase({ workspace, passphrase, safeStorage, env = process.env, fsImpl = fs, randomBytes = crypto.randomBytes } = {}) {
  const secret = String(passphrase || "");
  if (secret.length < 24) {
    throw new WorkspaceKeyError("The workspace recovery code must contain at least 24 characters.", "E-WORKSPACE-RECOVERY");
  }
  const resolved = resolveDesktopWorkspaceKeys({ workspace, safeStorage, env, fsImpl, randomBytes });
  if (resolved.source === "environment") {
    throw new WorkspaceKeyError("Environment-managed workspace keys must configure recovery through the environment owner.", "E-WORKSPACE-RECOVERY");
  }
  try {
    const record = readKeyRecord(workspace, fsImpl);
    if (!record) throw new WorkspaceKeyError("The workspace key record was not found.", "E-WORKSPACE-KEY-RECORD");
    const currentKey = resolved.pending ? resolved.previousKey : resolved.primaryKey;
    const pendingKey = resolved.pending ? resolved.primaryKey : null;
    if (!currentKey) throw new WorkspaceKeyError("The current workspace key could not be unlocked.", "E-WORKSPACE-KEY-UNLOCK");
    record.current.recovery = createRecoveryEnvelope(currentKey, secret, randomBytes);
    if (record.pending && pendingKey) record.pending.recovery = createRecoveryEnvelope(pendingKey, secret, randomBytes);
    record.wrappedRecoveryPassphrase = safeStorage.encryptString(secret).toString("base64");
    record.recoveryConfiguredAt = new Date().toISOString();
    writeKeyRecordAtomic(workspace, record, fsImpl);
    return { configured: true, keyId: record.current.keyId, pending: Boolean(record.pending) };
  } finally {
    resolved.primaryKey.fill(0);
    resolved.previousKey?.fill(0);
  }
}

function workspaceRecoveryStatus({ workspace, fsImpl = fs } = {}) {
  const record = readKeyRecord(workspace, fsImpl);
  return {
    configured: Boolean(record?.current?.recovery),
    pendingCovered: Boolean(!record?.pending || record.pending.recovery),
  };
}

function resolveHeadlessWorkspaceKeys({ workspace, env = process.env, fsImpl = fs } = {}) {
  const direct = resolveEnvironmentKeys(env);
  if (direct) return direct;
  const passphrase = String((env && env[RECOVERY_PASSPHRASE_ENV]) || "");
  if (!passphrase) {
    throw new WorkspaceKeyError(
      `Headless access requires ${KEY_ENV} or ${RECOVERY_PASSPHRASE_ENV} in the host environment.`,
      "E-WORKSPACE-KEY-UNLOCK"
    );
  }
  const record = readKeyRecord(workspace, fsImpl);
  if (!record) throw new WorkspaceKeyError("The workspace key record was not found.", "E-WORKSPACE-KEY-RECORD");
  const current = decryptRecoveryEnvelope(record.current, passphrase);
  const pending = record.pending ? decryptRecoveryEnvelope(record.pending, passphrase) : null;
  return resultForKeys(pending || current, pending ? current : null, {
    source: "recovery-passphrase",
    recordPath: keyRecordPath(workspace),
    pending: Boolean(pending),
  });
}

function stageWorkspaceKeyRotation({ workspace, safeStorage, env = process.env, fsImpl = fs, randomBytes = crypto.randomBytes } = {}) {
  const resolved = resolveDesktopWorkspaceKeys({ workspace, safeStorage, env, fsImpl, randomBytes });
  let nextKey = null;
  let staged = false;
  try {
    if (resolved.source === "environment") {
      throw new WorkspaceKeyError("Environment-managed workspace keys must be rotated by the environment owner.", "E-WORKSPACE-KEY-ROTATION");
    }
    const record = readKeyRecord(workspace, fsImpl);
    if (!record) throw new WorkspaceKeyError("The workspace key record was not found.", "E-WORKSPACE-KEY-RECORD");
    if (record.pending) {
      throw new WorkspaceKeyError("A workspace key rotation is already pending reconciliation.", "E-WORKSPACE-KEY-ROTATION");
    }
    nextKey = randomBytes(32);
    const passphrase = String((env && env[RECOVERY_PASSPHRASE_ENV]) || "") || storedRecoveryPassphrase(record, safeStorage);
    record.pending = createKeySlot(nextKey, { safeStorage, passphrase, randomBytes });
    record.rotationStartedAt = new Date().toISOString();
    writeKeyRecordAtomic(workspace, record, fsImpl);
    staged = true;
    return {
      oldKeyId: record.current.keyId,
      newKeyId: record.pending.keyId,
      newKey: nextKey,
      newKeyEncoded: encodeWorkspaceKey(nextKey),
    };
  } finally {
    resolved.primaryKey.fill(0);
    resolved.previousKey?.fill(0);
    if (nextKey && !staged) nextKey.fill(0);
  }
}

function commitWorkspaceKeyRotation({ workspace, activeKeyId, fsImpl = fs } = {}) {
  const record = readKeyRecord(workspace, fsImpl);
  if (!record || !record.pending) {
    throw new WorkspaceKeyError("No workspace key rotation is pending.", "E-WORKSPACE-KEY-ROTATION");
  }
  if (String(activeKeyId || "") !== String(record.pending.keyId || "")) {
    throw new WorkspaceKeyError("The backend did not confirm the pending workspace key.", "E-WORKSPACE-KEY-ROTATION");
  }
  record.current = record.pending;
  delete record.pending;
  delete record.rotationStartedAt;
  record.rotatedAt = new Date().toISOString();
  writeKeyRecordAtomic(workspace, record, fsImpl);
  return { keyId: record.current.keyId, pending: false };
}

function reconcileWorkspaceKeyRotation({ workspace, activeKeyId, fsImpl = fs } = {}) {
  const record = readKeyRecord(workspace, fsImpl);
  if (!record || !record.pending) return { keyId: record?.current?.keyId || "", pending: false, action: "none" };
  if (record.pending.keyId === activeKeyId) {
    const result = commitWorkspaceKeyRotation({ workspace, activeKeyId, fsImpl });
    return { ...result, action: "committed" };
  }
  if (record.current.keyId === activeKeyId) {
    delete record.pending;
    delete record.rotationStartedAt;
    writeKeyRecordAtomic(workspace, record, fsImpl);
    return { keyId: record.current.keyId, pending: false, action: "discarded" };
  }
  throw new WorkspaceKeyError("The active database key does not match the current or pending key record.", "E-WORKSPACE-KEY-ROTATION");
}

module.exports = {
  KEY_ENV,
  KEY_RECORD_FILENAME,
  PREVIOUS_KEY_ENV,
  RECOVERY_PASSPHRASE_ENV,
  REQUIRE_ENCRYPTION_ENV,
  WorkspaceKeyError,
  commitWorkspaceKeyRotation,
  configureWorkspaceRecoveryPassphrase,
  createRecoveryEnvelope,
  decryptRecoveryEnvelope,
  encodeWorkspaceKey,
  keyRecordPath,
  parseWorkspaceKey,
  readKeyRecord,
  reconcileWorkspaceKeyRotation,
  resolveDesktopWorkspaceKeys,
  resolveHeadlessWorkspaceKeys,
  safeStorageProtectionStatus,
  stageWorkspaceKeyRotation,
  workspaceKeyId,
  workspaceRecoveryStatus,
  writeKeyRecordAtomic,
};

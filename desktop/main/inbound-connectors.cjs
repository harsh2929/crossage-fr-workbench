"use strict";

const fs = require("fs");
const path = require("path");

const PROVIDERS = new Set(["slack", "web", "google_drive", "onedrive", "dropbox", "webdav"]);
const SECRET_KEYS = new Set(["accessToken", "token", "password", "authorization", "credential"]);

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase().replace(/[ -]+/g, "_");
  if (!PROVIDERS.has(provider)) {
    throw new Error("Unknown inbound connector provider.");
  }
  return provider;
}

function normalizeConnectionId(value) {
  const id = String(value || "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 96);
  if (!id) {
    throw new Error("Inbound connector connectionId is required.");
  }
  return id;
}

function publicSummary(config) {
  const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (SECRET_KEYS.has(key)) continue;
    if (typeof value === "string") output[key] = value.slice(0, 2_000);
    else if (typeof value === "boolean" || typeof value === "number") output[key] = value;
    else if (Array.isArray(value)) output[key] = value.slice(0, 100).map((item) => String(item || "").slice(0, 500));
  }
  return output;
}

function writeVault(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(temp, 0o600); } catch {}
  fs.renameSync(temp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

function readVault(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : { schemaVersion: 1, connectors: {} };
  } catch {
    return { schemaVersion: 1, connectors: {} };
  }
}

function createInboundConnectorVault({ safeStorage, userDataPath, now = () => new Date().toISOString() }) {
  const filePath = path.join(path.resolve(String(userDataPath || ".")), "inbound-connectors.v1.json");

  function encryptionAvailable() {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  function requireEncryption() {
    if (!encryptionAvailable()) {
      throw new Error("OS-backed credential encryption is unavailable on this computer.");
    }
  }

  function list() {
    const vault = readVault(filePath);
    const connectors = vault.connectors && typeof vault.connectors === "object" ? vault.connectors : {};
    return Object.values(connectors).map((row) => ({
      provider: String(row.provider || ""),
      connectionId: String(row.connectionId || ""),
      displayName: String(row.displayName || ""),
      configuredAt: String(row.configuredAt || ""),
      updatedAt: String(row.updatedAt || ""),
      credentialConfigured: Boolean(row.ciphertext),
      config: row.config && typeof row.config === "object" ? row.config : {},
    })).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  function save(payload = {}) {
    requireEncryption();
    const provider = normalizeProvider(payload.provider);
    const connectionId = normalizeConnectionId(payload.connectionId);
    const displayName = String(payload.displayName || provider).trim().slice(0, 120) || provider;
    const config = payload.config && typeof payload.config === "object" && !Array.isArray(payload.config)
      ? { ...payload.config, provider, connectionId, displayName }
      : { provider, connectionId, displayName };
    const encrypted = safeStorage.encryptString(JSON.stringify(config)).toString("base64");
    const vault = readVault(filePath);
    const connectors = vault.connectors && typeof vault.connectors === "object" ? vault.connectors : {};
    const key = `${provider}:${connectionId}`;
    const timestamp = now();
    const previous = connectors[key] || {};
    connectors[key] = {
      provider,
      connectionId,
      displayName,
      configuredAt: previous.configuredAt || timestamp,
      updatedAt: timestamp,
      config: publicSummary(config),
      ciphertext: encrypted,
    };
    writeVault(filePath, { schemaVersion: 1, connectors });
    return list().find((row) => row.provider === provider && row.connectionId === connectionId);
  }

  function load(providerValue, connectionIdValue) {
    requireEncryption();
    const provider = normalizeProvider(providerValue);
    const connectionId = normalizeConnectionId(connectionIdValue);
    const vault = readVault(filePath);
    const row = vault.connectors?.[`${provider}:${connectionId}`];
    if (!row || !row.ciphertext) {
      throw new Error("Inbound connector credentials were not found.");
    }
    try {
      const decoded = safeStorage.decryptString(Buffer.from(String(row.ciphertext), "base64"));
      const parsed = JSON.parse(decoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid payload");
      return { ...parsed, provider, connectionId, displayName: String(row.displayName || parsed.displayName || provider) };
    } catch {
      throw new Error("Inbound connector credentials could not be decrypted for this OS account.");
    }
  }

  function remove(providerValue, connectionIdValue) {
    const provider = normalizeProvider(providerValue);
    const connectionId = normalizeConnectionId(connectionIdValue);
    const vault = readVault(filePath);
    const connectors = vault.connectors && typeof vault.connectors === "object" ? vault.connectors : {};
    const key = `${provider}:${connectionId}`;
    const removed = Boolean(connectors[key]);
    delete connectors[key];
    writeVault(filePath, { schemaVersion: 1, connectors });
    return { provider, connectionId, removed };
  }

  return { encryptionAvailable, list, save, load, remove, filePath };
}

module.exports = {
  PROVIDERS,
  createInboundConnectorVault,
  normalizeProvider,
  normalizeConnectionId,
  publicSummary,
};

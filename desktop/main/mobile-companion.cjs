"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MOBILE_COMPANION_VERSION = 2;
const MOBILE_COMPANION_RELATIVE_PATH = path.join("agent", "mobile-companions.json");
const MOBILE_PAIRING_TTL_SECONDS = 10 * 60;
const MOBILE_DEFAULT_EXPIRY_DAYS = 7;
const MOBILE_MAX_EXPIRY_DAYS = 30;
const MOBILE_MAX_ACTIVE_DEVICES = 25;
const MOBILE_MAX_RETAINED_TOMBSTONES = 100;
const MOBILE_UNPAIRED_TOKEN_HASH = "0".repeat(64);
const MOBILE_ALLOWED_TOOLS = Object.freeze([
  "mobile_session",
  "list_image_capabilities",
  "get_image_library_overview",
  "search_images",
  "fetch_image_assets",
  "analyze_image_assets",
  "get_image_preview",
]);

function isLoopbackHostname(hostname) {
  const value = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function normalizeMobilePublicUrl(value, { allowLoopbackHttp = true } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new Error("Mobile companion endpoint must be a valid HTTPS origin.");
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !(allowLoopbackHttp && loopback && parsed.protocol === "http:")) {
    throw new Error("Mobile companion endpoint must use HTTPS; loopback HTTP is only accepted for local development.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Mobile companion endpoint cannot contain credentials, a query, or a fragment.");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    throw new Error("Mobile companion endpoint must be an origin without a path.");
  }
  parsed.pathname = "/";
  return {
    origin: parsed.origin,
    secure: parsed.protocol === "https:",
    loopback,
  };
}

function mobileCompanionFile(workspace) {
  const root = path.resolve(String(workspace || ""));
  if (!root || root === path.parse(root).root) {
    throw new Error("A concrete Vintrace workspace is required for mobile access.");
  }
  return path.join(root, MOBILE_COMPANION_RELATIVE_PATH);
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("Mobile companion credential storage must be a real directory.");
  }
  if (process.platform !== "win32") {
    fs.chmodSync(directory, 0o700);
  }
}

function readDocument(filePath) {
  try {
    const info = fs.lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
      throw new Error("Mobile companion credentials must be a regular JSON file no larger than 1 MB.");
    }
    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      throw new Error("Mobile companion credentials must have owner-only permissions (0600).");
    }
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.accounts)) {
      throw new Error("Mobile companion credentials have an invalid schema.");
    }
    return value;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { version: MOBILE_COMPANION_VERSION, accounts: [] };
    }
    if (error instanceof SyntaxError) {
      throw new Error("Mobile companion credentials are not valid JSON.");
    }
    throw error;
  }
}

function withCredentialLock(filePath, callback) {
  const lockPath = `${filePath}.lock`;
  let handle;
  try {
    handle = fs.openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      throw new Error("Mobile companion credentials are busy; retry the operation.");
    }
    throw error;
  }
  try {
    return callback();
  } finally {
    try { fs.closeSync(handle); } catch { /* already closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* lock cleanup is best effort */ }
  }
}

function writeDocument(filePath, value) {
  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const existing = fs.statSync(filePath, { throwIfNoEntry: false });
  if (existing) {
    const linkInfo = fs.lstatSync(filePath);
    if (!linkInfo.isFile() || linkInfo.isSymbolicLink()) {
      throw new Error("Refusing to replace non-regular mobile companion credential storage.");
    }
  }
  const temporary = path.join(directory, `.mobile-companions-${process.pid}-${crypto.randomBytes(8).toString("hex")}.tmp`);
  const handle = fs.openSync(temporary, "wx", 0o600);
  try {
    fs.writeFileSync(handle, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  try {
    fs.renameSync(temporary, filePath);
    if (process.platform !== "win32") fs.chmodSync(filePath, 0o600);
    try {
      const directoryHandle = fs.openSync(directory, "r");
      try { fs.fsyncSync(directoryHandle); } finally { fs.closeSync(directoryHandle); }
    } catch {
      // Some Windows/filesystem combinations do not permit directory fsync.
    }
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch { /* best effort */ }
    throw error;
  }
}

function cleanLabel(value) {
  const label = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  return label || "Mobile device";
}

function unixSeconds(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function publicDevice(account, nowSeconds = Math.floor(Date.now() / 1000)) {
  const expiresAt = unixSeconds(account.expiresAt);
  const pairingExpiresAt = unixSeconds(account.pairingExpiresAt);
  const revoked = Boolean(account.disabled || account.revokedAt);
  const paired = Boolean(account.pairedAt) && account.tokenSha256 !== MOBILE_UNPAIRED_TOKEN_HASH;
  const expired = expiresAt > 0 && expiresAt <= nowSeconds;
  const pairingExpired = !paired && pairingExpiresAt > 0 && pairingExpiresAt <= nowSeconds;
  const status = revoked ? "revoked" : expired ? "expired" : paired ? "paired" : pairingExpired ? "pairing-expired" : "pending";
  return {
    accountId: String(account.accountId || ""),
    label: cleanLabel(account.displayName),
    status,
    allowPreviews: Array.isArray(account.scopes) && account.scopes.includes("images:preview"),
    createdAt: String(account.createdAt || ""),
    pairedAt: String(account.pairedAt || ""),
    expiresAt: expiresAt || null,
    pairingExpiresAt: pairingExpiresAt || null,
    revokedAt: String(account.revokedAt || ""),
  };
}

function pruneAccounts(accounts, nowSeconds) {
  const active = accounts.filter((account) => !account.disabled && unixSeconds(account.expiresAt) > nowSeconds);
  const tombstones = accounts
    .filter((account) => !active.includes(account))
    .sort((left, right) => String(right.revokedAt || right.createdAt || "").localeCompare(String(left.revokedAt || left.createdAt || "")))
    .slice(0, MOBILE_MAX_RETAINED_TOMBSTONES);
  return [...active, ...tombstones];
}

function ensureMobileCredentialFile({ workspace }) {
  const filePath = mobileCompanionFile(workspace);
  ensurePrivateDirectory(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    withCredentialLock(filePath, () => writeDocument(filePath, { version: MOBILE_COMPANION_VERSION, accounts: [] }));
  }
  return filePath;
}

function listMobileCompanions({ workspace, now = Date.now() } = {}) {
  const filePath = ensureMobileCredentialFile({ workspace });
  const document = readDocument(filePath);
  const nowSeconds = Math.floor(Number(now) / 1000);
  return document.accounts
    .filter((account) => account && account.clientType === "mobile")
    .map((account) => publicDevice(account, nowSeconds))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

function createMobileCompanion({
  workspace,
  publicUrl,
  label = "",
  expiresInDays = MOBILE_DEFAULT_EXPIRY_DAYS,
  allowPreviews = true,
  now = Date.now(),
} = {}) {
  const endpoint = normalizeMobilePublicUrl(publicUrl);
  const days = Math.floor(Number(expiresInDays));
  if (!Number.isFinite(days) || days < 1 || days > MOBILE_MAX_EXPIRY_DAYS) {
    throw new Error(`Mobile access must expire in 1-${MOBILE_MAX_EXPIRY_DAYS} days.`);
  }
  const filePath = ensureMobileCredentialFile({ workspace });
  const nowMs = Number(now);
  const nowSeconds = Math.floor(nowMs / 1000);
  const pairingCode = crypto.randomBytes(32).toString("base64url");
  const account = {
    accountId: `mobile-${crypto.randomBytes(9).toString("base64url")}`,
    displayName: cleanLabel(label),
    clientType: "mobile",
    readOnly: true,
    tokenSha256: MOBILE_UNPAIRED_TOKEN_HASH,
    pairingCodeSha256: crypto.createHash("sha256").update(pairingCode, "utf8").digest("hex"),
    scopes: allowPreviews ? ["images:read", "images:preview"] : ["images:read"],
    allowedTools: allowPreviews
      ? [...MOBILE_ALLOWED_TOOLS]
      : MOBILE_ALLOWED_TOOLS.filter((tool) => tool !== "get_image_preview"),
    createdAt: new Date(nowMs).toISOString(),
    pairingExpiresAt: nowSeconds + MOBILE_PAIRING_TTL_SECONDS,
    expiresAt: nowSeconds + days * 24 * 60 * 60,
    disabled: false,
  };
  withCredentialLock(filePath, () => {
    const document = readDocument(filePath);
    const accounts = pruneAccounts(document.accounts.filter((row) => row && typeof row === "object"), nowSeconds);
    const activeCount = accounts.filter(
      (row) => row.clientType === "mobile" && !row.disabled && unixSeconds(row.expiresAt) > nowSeconds,
    ).length;
    if (activeCount >= MOBILE_MAX_ACTIVE_DEVICES) {
      throw new Error(`Revoke or let a device expire before adding more than ${MOBILE_MAX_ACTIVE_DEVICES} mobile companions.`);
    }
    writeDocument(filePath, {
      version: MOBILE_COMPANION_VERSION,
      accounts: [...accounts, account],
    });
  });
  const pairingUrl = new URL("/mobile/", endpoint.origin);
  pairingUrl.hash = `pair=${encodeURIComponent(pairingCode)}`;
  return {
    device: publicDevice(account, nowSeconds),
    pairingUrl: pairingUrl.toString(),
    endpoint,
  };
}

function revokeMobileCompanion({ workspace, accountId, now = Date.now() } = {}) {
  const cleanId = String(accountId || "").trim();
  if (!/^mobile-[A-Za-z0-9_-]{8,64}$/.test(cleanId)) {
    throw new Error("A valid mobile companion ID is required.");
  }
  const filePath = ensureMobileCredentialFile({ workspace });
  let revoked = null;
  withCredentialLock(filePath, () => {
    const document = readDocument(filePath);
    const account = document.accounts.find((row) => row && row.clientType === "mobile" && row.accountId === cleanId);
    if (!account) throw new Error("Mobile companion was not found.");
    account.disabled = true;
    account.revokedAt = new Date(Number(now)).toISOString();
    account.tokenSha256 = MOBILE_UNPAIRED_TOKEN_HASH;
    delete account.pairingCodeSha256;
    delete account.pairingExpiresAt;
    revoked = publicDevice(account, Math.floor(Number(now) / 1000));
    writeDocument(filePath, {
      version: MOBILE_COMPANION_VERSION,
      accounts: pruneAccounts(document.accounts, Math.floor(Number(now) / 1000)),
    });
  });
  return revoked;
}

module.exports = {
  MOBILE_ALLOWED_TOOLS,
  MOBILE_COMPANION_VERSION,
  MOBILE_DEFAULT_EXPIRY_DAYS,
  MOBILE_MAX_EXPIRY_DAYS,
  MOBILE_PAIRING_TTL_SECONDS,
  MOBILE_UNPAIRED_TOKEN_HASH,
  createMobileCompanion,
  ensureMobileCredentialFile,
  isLoopbackHostname,
  listMobileCompanions,
  mobileCompanionFile,
  normalizeMobilePublicUrl,
  revokeMobileCompanion,
};

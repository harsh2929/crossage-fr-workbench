"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  MOBILE_ALLOWED_TOOLS,
  MOBILE_PAIRING_TTL_SECONDS,
  createMobileCompanion,
  ensureMobileCredentialFile,
  listMobileCompanions,
  normalizeMobilePublicUrl,
  revokeMobileCompanion,
} = require("../desktop/main/mobile-companion.cjs");

function expectFailure(fn, pattern) {
  assert.throws(fn, pattern);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-mobile-credentials-"));
try {
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace, { recursive: true });
  const now = Date.UTC(2026, 6, 13, 12, 0, 0);
  const created = createMobileCompanion({
    workspace,
    publicUrl: "https://photos.example.test",
    label: "  Harsh's iPhone\u0000  ",
    expiresInDays: 7,
    allowPreviews: true,
    now,
  });

  assert.equal(created.endpoint.origin, "https://photos.example.test");
  assert.equal(created.device.label, "Harsh's iPhone");
  assert.equal(created.device.status, "pending");
  assert.equal(created.device.allowPreviews, true);
  const pairing = new URL(created.pairingUrl);
  assert.equal(pairing.origin, "https://photos.example.test");
  assert.equal(pairing.pathname, "/mobile/");
  assert.equal(pairing.search, "");
  assert.match(pairing.hash, /^#pair=[A-Za-z0-9_-]{40,}$/);
  const pairingCode = decodeURIComponent(pairing.hash.slice("#pair=".length));

  const credentialFile = ensureMobileCredentialFile({ workspace });
  const raw = fs.readFileSync(credentialFile, "utf8");
  const document = JSON.parse(raw);
  const account = document.accounts.find((row) => row.accountId === created.device.accountId);
  assert(account);
  assert.equal(account.clientType, "mobile");
  assert.equal(account.readOnly, true);
  assert.equal(account.tokenSha256, "0".repeat(64));
  assert.equal(account.pairingCodeSha256, crypto.createHash("sha256").update(pairingCode).digest("hex"));
  assert(!raw.includes(pairingCode), "plaintext pairing code must never be persisted");
  assert.deepEqual(account.scopes, ["images:read", "images:preview"]);
  assert.deepEqual(account.allowedTools, [...MOBILE_ALLOWED_TOOLS]);
  assert.equal(account.pairingExpiresAt, Math.floor(now / 1000) + MOBILE_PAIRING_TTL_SECONDS);
  assert.equal(account.expiresAt, Math.floor(now / 1000) + 7 * 24 * 60 * 60);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(credentialFile).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(credentialFile)).mode & 0o777, 0o700);
  }

  const listed = listMobileCompanions({ workspace, now });
  assert.equal(listed.length, 1);
  assert(!("tokenSha256" in listed[0]) && !("pairingCodeSha256" in listed[0]));

  const metadataOnly = createMobileCompanion({
    workspace,
    publicUrl: "https://photos.example.test/",
    label: "Metadata only",
    expiresInDays: 1,
    allowPreviews: false,
    now: now + 1,
  });
  const updated = JSON.parse(fs.readFileSync(credentialFile, "utf8"));
  const metadataAccount = updated.accounts.find((row) => row.accountId === metadataOnly.device.accountId);
  assert.deepEqual(metadataAccount.scopes, ["images:read"]);
  assert(!metadataAccount.allowedTools.includes("get_image_preview"));

  const revoked = revokeMobileCompanion({ workspace, accountId: created.device.accountId, now: now + 2 });
  assert.equal(revoked.status, "revoked");
  const afterRevoke = JSON.parse(fs.readFileSync(credentialFile, "utf8"));
  const revokedAccount = afterRevoke.accounts.find((row) => row.accountId === created.device.accountId);
  assert.equal(revokedAccount.disabled, true);
  assert.equal(revokedAccount.tokenSha256, "0".repeat(64));
  assert(!("pairingCodeSha256" in revokedAccount));

  assert.deepEqual(normalizeMobilePublicUrl("http://127.0.0.1:8765"), {
    origin: "http://127.0.0.1:8765",
    secure: false,
    loopback: true,
  });
  expectFailure(() => normalizeMobilePublicUrl("http://192.168.1.20:8765"), /must use HTTPS/);
  expectFailure(() => normalizeMobilePublicUrl("https://photos.example.test/mobile"), /without a path/);
  expectFailure(() => normalizeMobilePublicUrl("https://user:secret@photos.example.test"), /credentials/);
  expectFailure(
    () => createMobileCompanion({ workspace, publicUrl: "https://photos.example.test", expiresInDays: 31 }),
    /1-30 days/,
  );

  console.log("mobile companion credential lifecycle ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
const backendBuild = fs.readFileSync(path.join(process.cwd(), "desktop", "scripts", "build-backend.cjs"), "utf8");
const preload = fs.readFileSync(path.join(process.cwd(), "desktop", "preload.cjs"), "utf8");
const main = fs.readFileSync(path.join(process.cwd(), "desktop", "main.cjs"), "utf8");
const server = fs.readFileSync(path.join(process.cwd(), "crossage_fr", "mcp_server.py"), "utf8");
const bridge = fs.readFileSync(path.join(process.cwd(), "src", "bridgeValidation.ts"), "utf8");
const guide = fs.readFileSync(path.join(process.cwd(), "docs", "mobile-companion.md"), "utf8");
const notices = fs.readFileSync(path.join(process.cwd(), "THIRD_PARTY_NOTICES.md"), "utf8");

assert.match(packageJson.scripts.build, /build:mobile/);
assert.match(packageJson.scripts["build:backend"], /build:mobile/);
assert.match(packageJson.scripts["test:mobile-companion"], /mobile_companion_http\.py/);
assert.match(packageJson.scripts["test:frozen-mobile-companion"], /mobile_companion_http\.py/);
assert.match(backendBuild, /mobileDistDir/);
assert.match(backendBuild, /mobile-dist/);
for (const channel of ["mobile-companion:status", "mobile-companion:configure", "mobile-companion:create", "mobile-companion:revoke"]) {
  assert(main.includes(channel), `desktop main is missing ${channel}`);
  assert(preload.includes(channel), `preload is missing ${channel}`);
}
for (const method of ["getMobileCompanionStatus", "configureMobileCompanion", "createMobileCompanion", "revokeMobileCompanion"]) {
  assert(bridge.includes(`"${method}"`), `bridge validation is missing ${method}`);
}
assert.match(server, /def _mobile_http_request_allowed/);
assert.match(server, /code="mobile_read_only"/);
assert.match(server, /MOBILE_SESSION_COOKIE/);
assert.match(server, /exchange_mobile_pairing/);
for (const workflow of ["macos-release.yml", "windows-release.yml", "linux-release.yml"]) {
  const source = fs.readFileSync(path.join(process.cwd(), ".github", "workflows", workflow), "utf8");
  assert.match(source, /npm run test:frozen-mobile-companion/, `${workflow} must verify frozen mobile access`);
}
assert.match(guide, /trusted HTTPS origin/);
assert.match(guide, /Secure`, `HttpOnly`, `SameSite=Strict/);
assert.match(guide, /revok/i);
assert.match(guide, /no service worker/i);
assert.match(notices, /## node-qrcode/);
assert.match(notices, /Version: 1\.5\.4/);
console.log("mobile companion desktop, package, bridge, and firewall wiring ok");

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  createInboundConnectorVault,
  normalizeProvider,
  publicSummary,
} = require("../desktop/main/inbound-connectors.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from([...Buffer.from(String(value))].map((byte) => byte ^ 0x5a)),
    decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString("utf8"),
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-connector-vault-"));
try {
  let tick = 0;
  const vault = createInboundConnectorVault({
    safeStorage: fakeSafeStorage(),
    userDataPath: root,
    now: () => `2026-07-11T00:00:0${tick++}Z`,
  });
  const saved = vault.save({
    provider: "slack",
    connectionId: "design-team",
    displayName: "Design Slack",
    config: {
      accessToken: "xoxb-super-secret",
      channelIds: ["C123"],
      recursive: true,
    },
  });
  assert.equal(saved.credentialConfigured, true);
  assert.deepEqual(saved.config.channelIds, ["C123"]);
  assert.equal(saved.config.accessToken, undefined);
  const serialized = fs.readFileSync(vault.filePath, "utf8");
  assert(!serialized.includes("xoxb-super-secret"));
  assert.equal(fs.statSync(vault.filePath).mode & 0o777, 0o600);
  const loaded = vault.load("slack", "design-team");
  assert.equal(loaded.accessToken, "xoxb-super-secret");
  assert.deepEqual(loaded.channelIds, ["C123"]);
  assert.equal(vault.remove("slack", "design-team").removed, true);
  assert.equal(vault.list().length, 0);

  assert.equal(normalizeProvider("google drive"), "google_drive");
  assert.throws(() => normalizeProvider("unknown"), /Unknown inbound connector/);
  assert.deepEqual(publicSummary({ token: "secret", password: "secret", folderId: "root" }), { folderId: "root" });

  const unavailable = createInboundConnectorVault({
    safeStorage: { isEncryptionAvailable: () => false },
    userDataPath: root,
  });
  assert.throws(() => unavailable.save({ provider: "web", connectionId: "web", config: {} }), /OS-backed/);
  console.log("all inbound connector vault tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

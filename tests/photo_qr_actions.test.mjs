// Unit tests for structured QR / Live-Text action parsing in photoQrActions.ts.
//
// Apple Photos turns a scanned QR/barcode into *actionable* results: a contact
// card becomes discrete call/email actions, a Wi-Fi code becomes a join action,
// an sms:/geo: payload becomes message/maps actions. This file pins that local,
// no-network parsing behaviour for `buildPhotoQrActions`.
//
// The TS source is transpiled on the fly with esbuild (a Vite dependency) and
// run in plain node — same convention as tests/photos_view.test.mjs, but in a
// dedicated file so it stays isolated from the large shared Photos test bundle.
//
// Run: node tests/photo_qr_actions.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photo-qr-actions-")), "photoQrActions.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoQrActions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const { buildPhotoQrActions } = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

const RICH_VCARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Lovelace;Ada",
  "FN:Ada Lovelace",
  "ORG:Analytical Engines",
  "TEL;TYPE=CELL:+1 415 555 0142",
  "EMAIL;TYPE=INTERNET:ada@example.com",
  "END:VCARD",
].join("\n");

run("rich vCard yields discrete phone, email, and named contact actions", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: RICH_VCARD, barcodeConfidence: 0.81 } });
  assert.deepStrictEqual(actions, [
    { kind: "phone", label: "Phone", copyLabel: "Copy phone", value: "+1 415 555 0142", href: "tel:+14155550142", confidence: "81%" },
    { kind: "email", label: "Email", copyLabel: "Copy email", value: "ada@example.com", href: "mailto:ada@example.com", confidence: "81%" },
    { kind: "contact", label: "Contact: Ada Lovelace", copyLabel: "Copy contact", value: RICH_VCARD, confidence: "81%" },
  ]);
});

run("MECARD yields discrete phone, email, and named contact actions", () => {
  const mecard = "MECARD:N:Lovelace,Ada;TEL:+14155550142;EMAIL:ada@example.com;;";
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: mecard } });
  assert.deepStrictEqual(actions, [
    { kind: "phone", label: "Phone", copyLabel: "Copy phone", value: "+14155550142", href: "tel:+14155550142", confidence: "" },
    { kind: "email", label: "Email", copyLabel: "Copy email", value: "ada@example.com", href: "mailto:ada@example.com", confidence: "" },
    { kind: "contact", label: "Contact: Ada Lovelace", copyLabel: "Copy contact", value: mecard, confidence: "" },
  ]);
});

run("secured WIFI payload yields a Wi-Fi action carrying the password", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: "WIFI:S:Vintrace Guest;T:WPA;P:s3cr3t-pass;;" } });
  assert.deepStrictEqual(actions, [
    { kind: "wifi", label: "Wi-Fi: Vintrace Guest", copyLabel: "Copy Wi-Fi password", value: "s3cr3t-pass", confidence: "" },
  ]);
});

run("open WIFI payload (nopass) yields a Wi-Fi action carrying the network name", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: "WIFI:S:Open Net;T:nopass;;" } });
  assert.deepStrictEqual(actions, [
    { kind: "wifi", label: "Wi-Fi: Open Net", copyLabel: "Copy network name", value: "Open Net", confidence: "" },
  ]);
});

run("sms: payload yields a message action with a normalized number", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: "sms:+1 415 555 0142" } });
  assert.deepStrictEqual(actions, [
    { kind: "sms", label: "Message", copyLabel: "Copy number", value: "+1 415 555 0142", href: "sms:+14155550142", confidence: "" },
  ]);
});

run("SMSTO: payload with a body still yields the message action for the number", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: "SMSTO:+14155550142:Call me" } });
  assert.deepStrictEqual(actions, [
    { kind: "sms", label: "Message", copyLabel: "Copy number", value: "+14155550142", href: "sms:+14155550142", confidence: "" },
  ]);
});

run("geo: payload yields an open-in-maps action with coordinates", () => {
  const actions = buildPhotoQrActions({ assetMetadata: { qrText: "geo:37.3349,-122.009" } });
  assert.deepStrictEqual(actions, [
    { kind: "geo", label: "Open in Maps", copyLabel: "Copy coordinates", value: "37.3349, -122.009", href: "geo:37.3349,-122.009", confidence: "" },
  ]);
});

// --- Backward-compatibility locks: existing url/email/phone/text/FN-only-vCard
// behaviour MUST stay byte-identical so the shared photos_view.test.mjs suite
// (and live Photos UI) keep working unchanged. ---

run("backward compatible: url/email/phone/raw-contact ordering and shapes unchanged", () => {
  const actions = buildPhotoQrActions({
    assetMetadata: {
      qrText: "www.example.com/ticket",
      barcodeConfidence: 0.92,
      barcodes: [
        { text: "hello@example.com" },
        { value: "tel:+1 415 555 0100" },
        { payload: "BEGIN:VCARD\\nFN:Ada\\nEND:VCARD" },
      ],
    },
  });
  assert.deepStrictEqual(
    actions.map((action) => [action.kind, action.copyLabel, action.value, action.href, action.confidence]),
    [
      ["url", "Copy URL", "https://www.example.com/ticket", "https://www.example.com/ticket", "92%"],
      ["email", "Copy email", "hello@example.com", "mailto:hello@example.com", "92%"],
      ["phone", "Copy phone", "+1 415 555 0100", "tel:+14155550100", "92%"],
      ["contact", "Copy contact", "BEGIN:VCARD\\nFN:Ada\\nEND:VCARD", undefined, "92%"],
    ],
  );
});

run("backward compatible: plain text payload and missing metadata unchanged", () => {
  assert.deepStrictEqual(buildPhotoQrActions(null), []);
  assert.deepStrictEqual(buildPhotoQrActions({ assetMetadata: { qrText: "plain locker code", decodedText: "plain locker code" } }), [
    { kind: "text", label: "QR text", copyLabel: "Copy text", value: "plain locker code", confidence: "" },
  ]);
});

console.log("photo_qr_actions: all tests passed");

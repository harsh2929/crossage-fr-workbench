// Unit tests for Live Text data-detector parsing in photoLiveTextActions.ts.
//
// Apple Photos' Live Text turns detected on-image text into tappable data
// detectors: every phone/email/URL, a street address (-> Maps), and a complete
// contact card. This file pins the local, no-network enrichment for
// `buildPhotoLiveTextActionsForText` / `buildPhotoLiveTextActions`:
//   - the saved contact card carries ALL detected emails and phones (not the
//     first of each), and
//   - a conservative street-address detector emits a copyable address action and
//     folds the address into the contact card's ADR line.
//
// The TS source is transpiled on the fly with esbuild (a Vite dependency) and
// run in plain node, in a dedicated file so it stays isolated from the large
// shared Photos test bundle.
//
// Run: node tests/photo_live_text_actions.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photo-live-text-")), "photoLiveTextActions.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoLiveTextActions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const { buildPhotoLiveTextActions, buildPhotoLiveTextActionsForText } = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("contact card carries every detected email and phone, not just the first", () => {
  const actions = buildPhotoLiveTextActionsForText(
    "Ada Lovelace\nada@example.com\nada.work@example.org\nCall +1 415 555 0142\nMobile +1 415 555 0143",
  );
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "email", "email", "phone", "phone", "contact"]);
  const contact = actions.at(-1);
  assert.strictEqual(contact.label, "Save contact card");
  assert.match(
    contact.value,
    /BEGIN:VCARD\nVERSION:3\.0\nFN:Ada Lovelace\nEMAIL:ada@example\.com\nEMAIL:ada\.work@example\.org\nTEL:\+1 415 555 0142\nTEL:\+1 415 555 0143\nEND:VCARD/,
  );
});

run("detects a street address as a copyable action and folds it into the contact card", () => {
  const actions = buildPhotoLiveTextActionsForText(
    "Meet me at 1600 Amphitheatre Parkway, Mountain View, CA 94043 tomorrow. Call +1 415 555 0142 or email ada@example.com",
  );
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "email", "phone", "address", "contact"]);
  const address = actions.find((action) => action.kind === "address");
  assert.deepStrictEqual(
    [address.label, address.copyLabel, address.value],
    ["Detected address", "Copy address", "1600 Amphitheatre Parkway, Mountain View, CA 94043"],
  );
  assert.match(actions.at(-1).value, /ADR:;;1600 Amphitheatre Parkway/);
});

run("address detection is conservative: phone numbers and plain prose are ignored", () => {
  const actions = buildPhotoLiveTextActionsForText(
    "Ada Lovelace\nVisit www.example.com or email HELLO@EXAMPLE.COM.\nCall +1 (415) 555-0199 today.",
  );
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "url", "email", "phone", "contact"]);
  assert.ok(!actions.some((action) => action.kind === "address"));
});

run("backward compatible: single-email/single-phone contact card stays byte-identical", () => {
  const actions = buildPhotoLiveTextActions({
    assetMetadata: {
      ocrText: "Ada Lovelace\nVisit www.example.com or email HELLO@EXAMPLE.COM.",
      textBlocks: [
        { text: "Call +1 (415) 555-0199 today." },
        { text: "Visit www.example.com" },
      ],
    },
  });
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "url", "email", "phone", "contact"]);
  assert.strictEqual(actions[4].downloadName, "ada-lovelace.vcf");
  assert.match(
    actions[4].value,
    /BEGIN:VCARD\nVERSION:3\.0\nFN:Ada Lovelace\nEMAIL:hello@example\.com\nTEL:\+1 \(415\) 555-0199\nEND:VCARD/,
  );
});

run("backward compatible: selected-text ordering keeps contact at the end without an address", () => {
  const actions = buildPhotoLiveTextActionsForText("Selected code www.example.com hello@example.com", {
    label: "Selected text",
    copyLabel: "Copy selected text",
  });
  assert.deepStrictEqual(actions.map((action) => action.kind), ["copy", "url", "email", "contact"]);
  assert.strictEqual(actions[3].label, "Save contact card");
});

run("ignores photos without detected text", () => {
  assert.deepStrictEqual(buildPhotoLiveTextActions({ assetMetadata: { labels: ["receipt"] } }), []);
});

console.log("photo_live_text_actions: all tests passed");

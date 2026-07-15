// APL-META-01: surface stored-but-hidden metadata in the lightbox Info inspector.
//
// The backend already stores EXIF GPS coordinates, model/object/scene tags, and
// detected items in asset metadata, but buildPhotoTechnicalMetadata never exposed
// them, so the Info inspector couldn't show GPS coordinates, a model-tags row, or
// a detected-items row. This pins the new compact fields.
//
// Run: node tests/photo_info_metadata.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photo-info-meta-")), "photoInfoMetadata.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoInfoMetadata.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const { buildPhotoTechnicalMetadata } = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("surfaces EXIF GPS coordinates as a compact Lat/Lon row", () => {
  const meta = buildPhotoTechnicalMetadata({
    assetMetadata: { exif: { gps: { latitude: "36.974067", longitude: "-122.018078" } } },
  });
  assert.strictEqual(meta.gpsMetadata, "Lat 36.9741, Lon -122.0181");
});

run("surfaces model tags and detected items (label objects and strings)", () => {
  const meta = buildPhotoTechnicalMetadata({
    assetMetadata: {
      modelTags: [{ label: "surfboard", confidence: 0.9 }, { label: "ocean" }],
      detectedItems: ["Receipt", { label: "QR code" }],
    },
  });
  assert.strictEqual(meta.modelTags, "surfboard, ocean");
  assert.strictEqual(meta.detectedItems, "Receipt, QR code");
});

run("omits GPS/model-tags/detected-items rows when absent", () => {
  const meta = buildPhotoTechnicalMetadata({ assetMetadata: {} });
  assert.strictEqual(meta.gpsMetadata, "");
  assert.strictEqual(meta.modelTags, "");
  assert.strictEqual(meta.detectedItems, "");
  assert.deepStrictEqual(meta.contentCredentials, []);
});

run("labels workspace-local and global Content Credential trust without conflating them", () => {
  const meta = buildPhotoTechnicalMetadata({
    assetMetadata: {
      editContentCredentials: {
        present: true,
        embedded: true,
        cryptographicallyValid: true,
        locallyTrusted: true,
        globallyTrusted: false,
        containsAiHistory: true,
        topLevelAiEdit: true,
        manifestId: "urn:c2pa:local",
      },
      contentCredentials: {
        present: true,
        embedded: true,
        cryptographicallyValid: true,
        locallyTrusted: false,
        globallyTrusted: true,
        containsAiHistory: false,
        topLevelAiEdit: false,
        manifestId: "urn:c2pa:global",
      },
    },
  });
  assert.strictEqual(meta.contentCredentials.length, 2);
  assert.deepStrictEqual(meta.contentCredentials[0], {
    scope: "active",
    state: "valid",
    label: "Active edit",
    summary: "Embedded · Signature valid",
    trust: "Workspace-local trust (not global)",
    aiHistory: "AI edit in this manifest",
    manifestId: "urn:c2pa:local",
    error: "",
    valid: true,
  });
  assert.strictEqual(meta.contentCredentials[1].trust, "Global C2PA trust");
  assert.strictEqual(meta.contentCredentials[1].aiHistory, "No AI action declared");
});

run("distinguishes an absent Content Credential from a validation failure", () => {
  const meta = buildPhotoTechnicalMetadata({
    assetMetadata: {
      contentCredentials: {
        present: false,
        embedded: false,
        validationState: "absent",
        cryptographicallyValid: false,
        locallyTrusted: false,
        globallyTrusted: false,
        containsAiHistory: false,
        topLevelAiEdit: false,
        error: "",
      },
    },
  });
  assert.deepStrictEqual(meta.contentCredentials[0], {
    scope: "original",
    state: "absent",
    label: "Original",
    summary: "No Content Credential",
    trust: "",
    aiHistory: "",
    manifestId: "",
    error: "",
    valid: false,
  });
});

console.log("photo_info_metadata: all tests passed");

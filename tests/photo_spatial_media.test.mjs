import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "src", "views", "photoSpatialMedia.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const module = { exports: {} };
vm.runInNewContext(transpiled, {
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === "./photoMediaPairs") {
      return {
        normalizePhotoMediaPairList(value) { return Array.isArray(value) ? value : []; },
      };
    }
    throw new Error(`Unexpected import: ${specifier}`);
  },
});

const { photoSpatialCapability, photoSpatialViewLabel, photoSpatialViewUrl } = module.exports;

const flat = photoSpatialCapability({ sourcePath: "/photos/plain.jpg", assetMetadata: {} });
assert.equal(flat.kind, "flat");
assert.deepEqual(Array.from(flat.viewModes), ["flat"]);

const metadataOnly = photoSpatialCapability({
  sourcePath: "/photos/spatial.heic",
  assetMetadata: { xmp: { auxiliaryImageType: "urn:com:apple:photo:2020:aux:hdrgainmap", depthMap: "embedded" } },
});
assert.equal(metadataOnly.kind, "spatial-metadata");
assert.equal(metadataOnly.metadataDetected, true);
assert.deepEqual(Array.from(metadataOnly.viewModes), ["flat"]);

const ordinaryText = photoSpatialCapability({
  sourcePath: "/photos/manual.jpg",
  assetMetadata: {
    ocr: { text: "Depth map tutorial" },
    caption: "A deep stereo cabinet",
    localDepthControls: { mode: "portrait", aperture: 4 },
  },
});
assert.equal(ordinaryText.kind, "flat");
assert.equal(ordinaryText.metadataDetected, false);

const paired = photoSpatialCapability({
  sourcePath: "/photos/portrait.jpg",
  assetMetadata: { localDepthControls: { mode: "portrait" } },
  mediaPairs: [
    { pairId: "depth", assetId: "a", pairKind: "depth_sidecar", relatedSourcePath: "/photos/portrait.depth.png", relatedSourceUrl: "vintrace-media://depth", relatedExists: true },
    { pairId: "right", assetId: "a", pairKind: "stereo_pair", relatedSourcePath: "/photos/portrait.right.jpg", relatedSourceUrl: "vintrace-media://right", relatedExists: true },
  ],
});
assert.equal(paired.kind, "stereo");
assert.deepEqual(Array.from(paired.viewModes), ["flat", "depth", "right-eye"]);
assert.equal(photoSpatialViewUrl(paired, "depth", "flat-url"), "vintrace-media://depth");
assert.equal(photoSpatialViewUrl(paired, "right-eye", "flat-url"), "vintrace-media://right");
assert.equal(photoSpatialViewUrl(paired, "flat", "flat-url"), "flat-url");
assert.equal(photoSpatialViewLabel("right-eye"), "Right eye");

const missing = photoSpatialCapability({
  sourcePath: "/photos/portrait.jpg",
  mediaPairs: [{ pairId: "depth", assetId: "a", pairKind: "depth_sidecar", relatedSourceUrl: "vintrace-media://depth", relatedExists: false }],
});
assert.deepEqual(Array.from(missing.viewModes), ["flat"]);

const css = fs.readFileSync(path.join(root, "src", "views", "photoSpatialMedia.css"), "utf8");
assert.match(css, /grid-template-columns: repeat\(auto-fit, minmax\(88px, 1fr\)\)/);
assert.match(css, /button\[aria-pressed="true"\]/);
console.log("photo spatial capability and viewer units ok");

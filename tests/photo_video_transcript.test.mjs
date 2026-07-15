import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-video-transcript-")), "photoVideoTranscript.mjs");
esbuild.buildSync({
  entryPoints: [path.join(root, "src/views/photoVideoTranscript.tsx")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const transcript = await import(pathToFileURL(outFile).href);

const segments = transcript.normalizePhotoAudioTimelineSegments([
  { segmentId: "late", segmentKind: "speech", startMs: 2000.4, endMs: 3500, text: "  Later   words  ", confidence: 2 },
  { segmentId: "sound", segmentKind: "sound", startMs: 250, endMs: 1200, label: "music", confidence: 0.8 },
  { segmentId: "early", segmentKind: "speech", startMs: -10, endMs: 1800, text: "Opening words", confidence: 0.9 },
  { segmentId: "invalid-kind", segmentKind: "noise", startMs: 0, endMs: 1, text: "drop" },
  { segmentId: "empty-speech", segmentKind: "speech", startMs: 0, endMs: 1, text: " " },
]);

assert.deepStrictEqual(segments.map((segment) => segment.segmentId), ["early", "sound", "late"]);
assert.strictEqual(segments[0].startMs, 0);
assert.strictEqual(segments[2].startMs, 2000);
assert.strictEqual(segments[2].text, "Later words");
assert.strictEqual(segments[2].confidence, 1);
assert.strictEqual(transcript.photoVideoCaptionText(segments, 600), "Opening words [music]");
assert.strictEqual(transcript.photoVideoCaptionText(segments, 1900), "");
assert.strictEqual(transcript.photoVideoCaptionText(segments, 2200), "Later words");

console.log("photo video transcript tests passed");

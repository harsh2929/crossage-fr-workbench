// APL-PEOPLE-05: review-more candidate threshold edge-case coverage.
//
// photoReviewMoreMinScore must clamp arbitrary input to [0,1] and treat
// non-finite values (NaN/Infinity) as 0, and the threshold predicate must admit
// all candidates when the threshold is non-positive. This pins those edges for
// the local nearest-neighbor "Review more photos" candidate filter.
//
// Run: node tests/photo_review_more_units.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photo-review-more-")), "photoGroupReview.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoGroupReview.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const { photoReviewMoreMinScore, photoReviewMoreCandidateMatchesThreshold } = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("photoReviewMoreMinScore clamps to [0,1] and treats non-finite as 0", () => {
  assert.strictEqual(photoReviewMoreMinScore(undefined), 0);
  assert.strictEqual(photoReviewMoreMinScore(NaN), 0);
  assert.strictEqual(photoReviewMoreMinScore(Infinity), 0);
  assert.strictEqual(photoReviewMoreMinScore(-Infinity), 0);
  assert.strictEqual(photoReviewMoreMinScore(-0.5), 0);
  assert.strictEqual(photoReviewMoreMinScore(1.5), 1);
  assert.strictEqual(photoReviewMoreMinScore(0.73), 0.73);
});

run("photoReviewMoreCandidateMatchesThreshold admits all when threshold non-positive", () => {
  assert.strictEqual(photoReviewMoreCandidateMatchesThreshold({ score: 0.1 }, 0), true);
  assert.strictEqual(photoReviewMoreCandidateMatchesThreshold({ score: 0.1 }, NaN), true);
  assert.strictEqual(photoReviewMoreCandidateMatchesThreshold({ score: 0.9 }, 0.8), true);
  assert.strictEqual(photoReviewMoreCandidateMatchesThreshold({ score: 0.7 }, 0.8), false);
});

console.log("photo_review_more_units: all tests passed");

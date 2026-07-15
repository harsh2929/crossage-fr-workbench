const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
const types = fs.readFileSync(path.join(root, "src", "types.ts"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop", "main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop", "preload.cjs"), "utf8");

assert.match(app, /function SyntheticEnrollmentReviewsPanel\(/);
assert.match(app, /raw\.syntheticEnrollmentReviews/);
assert.match(app, /raw\.syntheticEnrollmentScreen/);
assert.match(app, /"approve_synthetic_enrollment_review"/);
assert.match(app, /allowSyntheticOverride: true/);
assert.match(app, /"reject_synthetic_enrollment_review"/);
assert.match(app, /held for authenticity review/);
assert.match(app, /disabled=\{props\.busy \|\| !item\.sourceAvailable\}/);
assert.match(types, /interface SyntheticEnrollmentReview/);
assert.match(types, /syntheticScreenHumanOverride\?: boolean/);

for (const source of [main, preload]) {
  assert.match(source, /"synthetic_enrollment_screen_status"/);
  assert.match(source, /"approve_synthetic_enrollment_review"/);
  assert.match(source, /"reject_synthetic_enrollment_review"/);
}

console.log("synthetic enrollment screen UI contracts ok");

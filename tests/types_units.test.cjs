#!/usr/bin/env node
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const typesSource = fs.readFileSync(path.join(root, "src", "types.ts"), "utf8");

function matchingLines(pattern) {
  return typesSource
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => pattern.test(line))
    .map(({ line, number }) => `${number}: ${line.trim()}`);
}

assert.match(
  typesSource,
  /export type ExtensibleStringUnion<T extends string> = T \| \(string & Record<never, never>\);/,
  "types.ts should expose a branded helper for backend-extensible string enums",
);

assert.deepStrictEqual(
  matchingLines(/"[^"\n]+"\s*\|\s*string\b/),
  [],
  "literal unions must not collapse to plain string; use ExtensibleStringUnion instead",
);

assert.deepStrictEqual(
  matchingLines(/\b(?:AgeBucket|CandidateStatus|LearningMode|CandidateMediaAction)\s*\|\s*string\b/),
  [],
  "shared literal aliases must not be widened with plain string",
);

assert.ok(
  (typesSource.match(/ExtensibleStringUnion</g) || []).length >= 90,
  "expected the formerly widened backend enum fields to use ExtensibleStringUnion",
);

const artifactInterface = typesSource.match(/export interface CalibrationLearningArtifact \{([\s\S]*?)\n\}/);
assert.ok(artifactInterface, "CalibrationLearningArtifact interface should be present");
assert.deepStrictEqual(
  (artifactInterface[1].match(/\b[a-z]+_[a-z_]+\??:/g) || []),
  [],
  "CalibrationLearningArtifact should expose normalized camelCase fields only",
);

console.log("types literal-union contracts ok");

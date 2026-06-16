// Unit tests for the pure people-grouping logic used by the redesigned Enroll
// tab's people gallery. Pure module (no React); transpiled on the fly with
// esbuild (a Vite dependency) and exercised in plain node.
//
// Run: node tests/people_grouping.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "people-")), "peopleGrouping.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/peopleGrouping.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const mod = await import(pathToFileURL(outFile).href);

let n = 0;
function ref(personName, ageBucket, quality, extra = {}) {
  n += 1;
  return { refId: `ref${n}`, personName, ageBucket, quality, createdAt: `2026-01-0${n}`, ...extra };
}

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("groups references by person, sorted by name", () => {
  const people = mod.groupReferencesByPerson([
    ref("John", "adult", 0.8),
    ref("Jane", "child", 0.7),
    ref("Jane", "adult", 0.9),
  ]);
  assert.strictEqual(people.length, 2);
  assert.deepStrictEqual(people.map((p) => p.name), ["Jane", "John"]);
  assert.strictEqual(people[0].count, 2);
  assert.strictEqual(people[1].count, 1);
});

run("photos within a person are sorted best-quality first", () => {
  const [jane] = mod.groupReferencesByPerson([
    ref("Jane", "child", 0.4),
    ref("Jane", "adult", 0.95),
    ref("Jane", "adolescent", 0.6),
  ]);
  assert.deepStrictEqual(jane.photos.map((p) => p.quality), [0.95, 0.6, 0.4]);
});

run("age coverage lists present buckets in child->adult order, excludes unknown", () => {
  const cov = mod.ageCoverageOf([
    ref("X", "adult", 0.5),
    ref("X", "child", 0.5),
    ref("X", "unknown", 0.5),
  ]);
  assert.deepStrictEqual(cov, ["child", "adult"]);
});

run("average quality is the mean across a person's photos", () => {
  const [p] = mod.groupReferencesByPerson([ref("A", "adult", 0.4), ref("A", "adult", 0.6)]);
  assert.ok(Math.abs(p.averageQuality - 0.5) < 1e-9, p.averageQuality);
});

run("filterPeople matches name case-insensitively", () => {
  const people = mod.groupReferencesByPerson([ref("Jane Doe", "adult", 0.8), ref("John", "adult", 0.8)]);
  assert.deepStrictEqual(mod.filterPeople(people, "ja").map((p) => p.name), ["Jane Doe"]);
  assert.deepStrictEqual(mod.filterPeople(people, "  ").map((p) => p.name), ["Jane Doe", "John"]);
});

run("empty input yields no people", () => {
  assert.deepStrictEqual(mod.groupReferencesByPerson([]), []);
});

console.log("\nall people-grouping tests passed");

// APL-SEARCH-02: query-aware typeahead suggestion filtering.
//
// buildPhotoSearchSuggestions previously collected the whole suggestion haystack
// and capped it without regard to what the user typed, so the datalist could be
// truncated to suggestions irrelevant to the query. It now filters to suggestions
// matching the query (case-insensitive substring) before the cap, while an empty
// query keeps the previous "return everything" behaviour.
//
// Run: node tests/photo_search_suggestions.test.mjs

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "photo-search-sugg-")), "photoSearchSuggestions.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/views/photoSearchSuggestions.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const { buildPhotoSearchSuggestions } = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("filters suggestions to those matching the query", () => {
  const suggestions = buildPhotoSearchSuggestions({
    query: "ada",
    people: ["Ada Lovelace", "Grace Hopper"],
    keywords: [{ name: "Adafruit" }, { name: "Sunset" }],
  });
  assert.deepStrictEqual(suggestions, ["Ada Lovelace", "Adafruit"]);
});

run("returns all suggestions when the query is empty (back-compat)", () => {
  const suggestions = buildPhotoSearchSuggestions({ people: ["Ada", "Grace"] });
  assert.deepStrictEqual(suggestions, ["Ada", "Grace"]);
});

run("query match is a case-insensitive substring", () => {
  const suggestions = buildPhotoSearchSuggestions({ query: "HOP", people: ["Grace Hopper", "Ada Lovelace"] });
  assert.deepStrictEqual(suggestions, ["Grace Hopper"]);
});

console.log("photo_search_suggestions: all tests passed");

"use strict";

// Unit tests for the EIPC-01-extracted main-process helpers. These run in plain
// node (no Electron), which is the whole point of pulling them out of main.cjs.
// Run: node tests/main_util.test.cjs

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const util = require("../desktop/main/util.cjs");

function testJsonAtomicRoundTrip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-util-"));
  const file = path.join(dir, "nested", "state.json");
  util.writeJsonAtomic(file, { a: 1, b: ["x"] });
  assert.deepStrictEqual(util.readJsonObject(file), { a: 1, b: ["x"] });
  // unreadable / non-object -> {}
  assert.deepStrictEqual(util.readJsonObject(path.join(dir, "missing.json")), {});
  fs.writeFileSync(path.join(dir, "arr.json"), "[1,2,3]");
  assert.deepStrictEqual(util.readJsonObject(path.join(dir, "arr.json")), {});
  fs.rmSync(dir, { recursive: true, force: true });
}

function testMediaPathCodec() {
  const p = "/Users/jane/Pictures/evidence/jane.jpg";
  const encoded = util.encodeMediaPath(p);
  assert.ok(!encoded.includes("/"), "base64url must not contain slashes");
  assert.strictEqual(util.decodeMediaPath(encoded), path.resolve(p));
  assert.strictEqual(util.decodeMediaPath("!!!not base64!!!"), util.decodeMediaPath("!!!not base64!!!")); // never throws
}

function testEscapeHtml() {
  assert.strictEqual(util.escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.strictEqual(util.escapeHtml(null), "");
}

function testIsSubpath() {
  assert.ok(util.isSubpath("/a/b", "/a/b/c"));
  assert.ok(util.isSubpath("/a/b", "/a/b"));
  assert.ok(!util.isSubpath("/a/b", "/a/c"));
  assert.ok(!util.isSubpath("/a/b", "/a/b/../../x"));
}

function testTimestampSlug() {
  const slug = util.timestampSlug();
  assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(slug), `unexpected slug: ${slug}`);
}

function testSafeRealpath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-rp-"));
  assert.strictEqual(util.safeRealpath(dir), fs.realpathSync.native(dir));
  assert.strictEqual(util.safeRealpath("/no/such/path/xyz"), "");
  fs.rmSync(dir, { recursive: true, force: true });
}

testJsonAtomicRoundTrip();
testMediaPathCodec();
testEscapeHtml();
testIsSubpath();
testTimestampSlug();
testSafeRealpath();
console.log("main util ok");

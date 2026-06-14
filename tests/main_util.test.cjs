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

function testBackendRestartDelay() {
  // EIPC-05: happy path (no failures) must be 0 delay; then capped-exponential.
  assert.strictEqual(util.backendRestartDelayMs(0), 0);
  assert.strictEqual(util.backendRestartDelayMs(1, 500, 30000), 500);
  assert.strictEqual(util.backendRestartDelayMs(2, 500, 30000), 1000);
  assert.strictEqual(util.backendRestartDelayMs(3, 500, 30000), 2000);
  assert.strictEqual(util.backendRestartDelayMs(100, 500, 30000), 30000); // capped
  assert.strictEqual(util.backendRestartDelayMs(-5), 0); // never negative
  assert.strictEqual(util.backendRestartDelayMs("nan"), 0);
}

function testCanonicalPathKey() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-canon-"));
  // case-fold on -> equal keys regardless of case
  const a = util.canonicalPathKey(path.join(dir, "Photos/Img.JPG"), { caseFold: true });
  const b = util.canonicalPathKey(path.join(dir, "photos/img.jpg"), { caseFold: true });
  assert.strictEqual(a, b);
  // case-sensitive -> different keys
  const c = util.canonicalPathKey(path.join(dir, "Photos/Img.JPG"), { caseFold: false });
  const d = util.canonicalPathKey(path.join(dir, "photos/img.jpg"), { caseFold: false });
  assert.notStrictEqual(c, d);
  // normalizes .. segments
  assert.strictEqual(
    util.canonicalPathKey("/a/b/../c", { caseFold: false }),
    path.normalize(path.resolve("/a/b/../c")),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

testJsonAtomicRoundTrip();
testMediaPathCodec();
testEscapeHtml();
testIsSubpath();
testTimestampSlug();
testSafeRealpath();
testBackendRestartDelay();
testCanonicalPathKey();
console.log("main util ok");

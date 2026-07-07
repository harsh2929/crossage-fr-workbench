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

function testPythonBackendStartRaceGuards() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const startBlock = source.slice(source.indexOf("  start() {"), source.indexOf("  _spawn() {"));
  assert.match(startBlock, /if \(this\.readyPromise\) \{\s*return this\.readyPromise;/);
  assert.doesNotMatch(startBlock, /this\.readyPromise && this\.child/);

  const spawnBlock = source.slice(source.indexOf("  _spawn() {"), source.indexOf("  async invoke("));
  assert.match(spawnBlock, /if \(this\.child !== child\) \{\s*return;\s*\}/);
  assert.match(spawnBlock, /const activeChild = this\.child === child;/);
  assert.match(spawnBlock, /if \(activeChild\) \{[\s\S]*?this\.pending\.clear\(\);[\s\S]*?this\.readyPromise = null;[\s\S]*?this\.child = null;[\s\S]*?reject\(error\);[\s\S]*?\}/);
  assert.match(spawnBlock, /stale: !activeChild/);
}

function testBackendStdinErrorsAreHandled() {
  const source = fs.readFileSync(path.join(__dirname, "..", "desktop", "main.cjs"), "utf8");
  const spawnBlock = source.slice(source.indexOf("  _spawn() {"), source.indexOf("  async invoke("));
  assert.match(spawnBlock, /child\.stdin\.on\("error", \(error\) => \{/);
  assert.match(spawnBlock, /type: "backend_stdin_error"/);
  assert.match(spawnBlock, /createAppError\("E-BACKEND-PIPE"/);
  assert.match(spawnBlock, /for \(const pending of this\.pending\.values\(\)\) \{[\s\S]*?pending\.reject\(pipeError\);[\s\S]*?\}/);
  assert.match(spawnBlock, /this\.pending\.clear\(\);[\s\S]*?this\.readyPromise = null;[\s\S]*?this\.readyState = null;[\s\S]*?this\.child = null;/);
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

function testUniquePathBatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-path-batch-"));
  const a = path.join(dir, "a.jpg");
  const b = path.join(dir, "folder", "..", "b.jpg");
  const bAgain = path.join(dir, "b.jpg");
  const c = path.join(dir, "c.jpg");
  assert.deepStrictEqual(
    util.uniquePathBatch([null, "", "   ", a, b, bAgain, c], 2),
    { paths: [a, b], overflow: true },
  );
  assert.deepStrictEqual(
    util.uniquePathBatch([a, bAgain, b], 5),
    { paths: [a, bAgain], overflow: false },
  );
  assert.deepStrictEqual(util.uniquePathBatch([a], 0), { paths: [], overflow: false });
  assert.strictEqual(
    util.pathTrustKeyFromResolved(path.join(dir, "Folder", "..", "File.JPG"), { caseFold: false }),
    path.normalize(path.resolve(dir, "File.JPG")),
  );
  fs.rmSync(dir, { recursive: true, force: true });
}

async function testFilterStableWatchFilesConcurrency() {
  const paths = ["a", "b", "drop-1", "c", "drop-2", "d", "e"];
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const stable = await util.filterStableWatchFiles(paths, async (value, index) => {
    calls += 1;
    assert.strictEqual(value, paths[index]);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return !value.startsWith("drop");
  }, 3);
  assert.deepStrictEqual(stable, ["a", "b", "c", "d", "e"]);
  assert.strictEqual(calls, paths.length);
  assert.strictEqual(maxActive, 3);
  await assert.rejects(
    () => util.filterStableWatchFiles(["x"], null, 3),
    /waitForStableFile must be a function/,
  );
}

async function main() {
  testJsonAtomicRoundTrip();
  testMediaPathCodec();
  testEscapeHtml();
  testIsSubpath();
  testTimestampSlug();
  testSafeRealpath();
  testBackendRestartDelay();
  testPythonBackendStartRaceGuards();
  testBackendStdinErrorsAreHandled();
  testCanonicalPathKey();
  testUniquePathBatch();
  await testFilterStableWatchFilesConcurrency();
  console.log("main util ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

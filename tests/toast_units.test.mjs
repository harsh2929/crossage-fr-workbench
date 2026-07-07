// Unit tests for the shared toast-host state machine (Wave 0 substrate).
// Pure logic only — the React ToastHost/useToast wrapper is covered by e2e.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "toast-")), "toast.mjs");
const toastHostSource = fs.readFileSync(path.join(ROOT, "src/shell/ToastHost.tsx"), "utf8");
const stylesSource = fs.readFileSync(path.join(ROOT, "src/styles.css"), "utf8");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/toast.ts")],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: outFile,
});
const mod = await import(pathToFileURL(outFile).href);

function run(name, fn) {
  fn();
  console.log("ok " + name);
}

run("createToast assigns id, createdAt, and tone-derived ttl", () => {
  const t = mod.createToast({ tone: "ok", message: "Saved." }, 1000, 7);
  assert.strictEqual(t.tone, "ok");
  assert.strictEqual(t.message, "Saved.");
  assert.strictEqual(t.createdAt, 1000);
  assert.strictEqual(t.ttl, mod.TONE_TTL.ok);
  assert.ok(typeof t.id === "string" && t.id.length > 0, "id is a non-empty string");
});

run("createToast honours an explicit id and ttl override", () => {
  const t = mod.createToast({ tone: "error", message: "Failed.", id: "x1", ttl: 999 }, 5, 1);
  assert.strictEqual(t.id, "x1");
  assert.strictEqual(t.ttl, 999);
});

run("busy toasts are sticky (ttl 0)", () => {
  assert.strictEqual(mod.TONE_TTL.busy, 0);
});

run("push appends", () => {
  const a = mod.createToast({ tone: "ok", message: "A" }, 0, 1);
  const state = mod.toastReducer([], { type: "push", toast: a });
  assert.deepStrictEqual(state.map((t) => t.message), ["A"]);
});

run("push beyond MAX_TOASTS drops the oldest", () => {
  let state = [];
  for (let i = 0; i < mod.MAX_TOASTS + 2; i++) {
    state = mod.toastReducer(state, { type: "push", toast: mod.createToast({ tone: "ok", message: "m" + i }, i, i) });
  }
  assert.strictEqual(state.length, mod.MAX_TOASTS);
  // oldest two ("m0","m1") evicted; newest retained
  assert.strictEqual(state[state.length - 1].message, "m" + (mod.MAX_TOASTS + 1));
  assert.ok(!state.some((t) => t.message === "m0"), "m0 evicted");
});

run("dismiss removes only the matching id", () => {
  const a = mod.createToast({ tone: "ok", message: "A", id: "a" }, 0, 1);
  const b = mod.createToast({ tone: "warn", message: "B", id: "b" }, 0, 2);
  let state = mod.toastReducer(mod.toastReducer([], { type: "push", toast: a }), { type: "push", toast: b });
  state = mod.toastReducer(state, { type: "dismiss", id: "a" });
  assert.deepStrictEqual(state.map((t) => t.id), ["b"]);
});

run("prune drops expired non-sticky toasts, keeps unexpired and busy", () => {
  const expired = mod.createToast({ tone: "ok", message: "old", id: "old" }, 0, 1); // ttl ok, createdAt 0
  const fresh = mod.createToast({ tone: "ok", message: "new", id: "new" }, 10_000, 2);
  const busy = mod.createToast({ tone: "busy", message: "working", id: "busy" }, 0, 3); // sticky
  let state = [expired, fresh, busy];
  state = mod.toastReducer(state, { type: "prune", now: mod.TONE_TTL.ok + 1 });
  assert.deepStrictEqual(state.map((t) => t.id).sort(), ["busy", "new"]);
});

run("clear empties the stack", () => {
  const a = mod.createToast({ tone: "ok", message: "A" }, 0, 1);
  const state = mod.toastReducer(mod.toastReducer([], { type: "push", toast: a }), { type: "clear" });
  assert.deepStrictEqual(state, []);
});

run("ToastHost announces through persistent offscreen live regions", () => {
  assert.match(toastHostSource, /const \[politeAnnouncement, setPoliteAnnouncement\] = useState\(""\);/);
  assert.match(toastHostSource, /const \[assertiveAnnouncement, setAssertiveAnnouncement\] = useState\(""\);/);
  assert.match(toastHostSource, /className="toast-live-region" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(toastHostSource, /className="toast-live-region" role="alert" aria-live="assertive" aria-atomic="true"/);
  assert.match(toastHostSource, /setTimeout\(\(\) => \{[\s\S]*latestToast\.tone === "error"/);
  const visualLoop = toastHostSource.match(/\{toasts\.map\(\(toast\) => \{[\s\S]*?\}\)\}/);
  assert.ok(visualLoop, "visual toast map should exist");
  assert.match(visualLoop[0], /<div key=\{toast\.id\} className=\{`toast \$\{toast\.tone\}`\}>/);
  assert.doesNotMatch(visualLoop[0], /role=\{isError \? "alert" : "status"\}/);
  assert.doesNotMatch(visualLoop[0], /aria-live=\{isError \? "assertive" : "polite"\}/);
  assert.match(stylesSource, /\.toast-live-region \{[\s\S]*clip-path: inset\(50%\);/);
});

console.log("\nall toast tests passed");

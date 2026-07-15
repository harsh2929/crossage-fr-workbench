import assert from "node:assert/strict";
import fs from "node:fs";

const component = fs.readFileSync(new URL("../src/views/PhotoTetherPanel.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../src/views/photoTetherPanel.css", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const types = fs.readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
const phrases = fs.readFileSync(new URL("../src/i18n/photoTetherPhrases.ts", import.meta.url), "utf8");
const photosViewFixture = fs.readFileSync(new URL("fixtures/photos-view-state/main.jsx", import.meta.url), "utf8");

assert.match(component, /role="dialog"/);
assert.match(component, /aria-modal="true"/);
assert.match(component, /event\.key !== "Tab"/);
assert.match(component, /event\.key === "Escape"/);
assert.match(component, /launcherRef\.current\?\.focus/);
assert.match(component, /aria-pressed=/);
assert.match(component, /type="checkbox"/);
assert.match(component, /type="number"/);
assert.match(component, /<select/);
assert.match(component, /Latest tethered capture/);
assert.match(component, /Recent captures/);
assert.match(component, /typeof props\.subscribe !== "function"/);
assert.doesNotMatch(component, /<svg/);
assert.doesNotMatch(component, /window\.crossAge/);

for (const prop of ["getPhotoTetherStatus", "startPhotoTether", "stopPhotoTether", "resumePhotoTether", "capturePhotoTether", "subscribePhotoTether"]) {
  assert.match(photosViewFixture, new RegExp(`\\b${prop}:`));
}

assert.match(styles, /@media \(max-width: 640px\)/);
assert.match(styles, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
assert.match(styles, /text-overflow: ellipsis/);
assert.match(styles, /aspect-ratio: 4 \/ 3/);
assert.doesNotMatch(styles, /letter-spacing:\s*-|font-size:\s*clamp|border-radius:\s*(?:1[0-9]|[2-9][0-9])px/);

for (const channel of ["status", "start", "stop", "resume", "capture"]) {
  assert.match(main, new RegExp(`ipcMain\\.handle\\(\\"photo-tether:${channel}\\"`));
}
assert.match(main, /isUserGrantedPath\(sourcePath\)/);
assert.match(main, /publicPhotoTetherCameraStatus/);
assert.match(main, /preserveSession: true/);
assert.match(preload, /onPhotoTether: \(callback\) => subscribe\("photo-tether:event"/);
assert.match(types, /interface PhotoTetherStatus/);

for (const locale of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.match(phrases, new RegExp(`\\n  ${locale}: \\{`));
}
for (const phrase of ["Tethered capture", "Watched folder", "Direct camera", "Resume after restart", "Live review", "Start session"]) {
  assert.ok((phrases.match(new RegExp(`\\"${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\"`, "g")) || []).length >= 6, phrase);
}

console.log("ok photo tether UI, bridge, focus, responsive, privacy, and locale contracts");

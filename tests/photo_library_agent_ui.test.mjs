import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const panel = fs.readFileSync(path.join(root, "src/views/photoLibraryAgentPanel.tsx"), "utf8");
const photos = fs.readFileSync(path.join(root, "src/views/PhotosView.tsx"), "utf8");
const app = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const styles = fs.readFileSync(path.join(root, "src/styles.css"), "utf8");
const main = fs.readFileSync(path.join(root, "desktop/main.cjs"), "utf8");
const preload = fs.readFileSync(path.join(root, "desktop/preload.cjs"), "utf8");
const phrases = fs.readFileSync(path.join(root, "src/i18n/photoAgentPhrases.ts"), "utf8");

for (const command of [
  "photo_library_agent_status",
  "query_photo_library_agent",
  "execute_photo_library_agent_plan",
]) {
  assert.ok(main.includes(`"${command}"`), `${command} must be main-process allowlisted`);
  assert.ok(preload.includes(`"${command}"`), `${command} must be preload allowlisted`);
  assert.ok(app.includes(`"${command}"`), `${command} must be wired in App`);
}

assert.ok(photos.includes("<PhotoLibraryAgentPanel"));
assert.ok(photos.includes("!sensitiveCollectionLocked"));
assert.ok(panel.includes("turn.response.pendingPlans"));
assert.ok(panel.includes("setConfirmingPlanId(plan.planId)"));
assert.ok(panel.includes("confirm: true"));
assert.ok(panel.includes("idempotencyKey: `photo-agent:${plan.planId}`"));
const confirmationBranch = panel.indexOf("confirming ? (");
assert.ok(confirmationBranch > 0);
assert.ok(panel.indexOf("onClick={() => void confirmPlan(plan)}", confirmationBranch) > confirmationBranch);
assert.ok(panel.includes("turn.response.citations.map"));
assert.ok(panel.includes("onOpenCitation(citation)"));
assert.ok(panel.includes("turn.response.toolTrace.map"));
assert.ok(panel.includes("status?.available === false"));
assert.ok(panel.includes("maxLength={2000}"));

for (const selector of [
  ".photo-library-agent-thread",
  ".photo-library-agent-citations button",
  ".photo-library-agent-plan",
  ".photo-library-agent-composer",
  "@media (max-width: 720px)",
]) {
  assert.ok(styles.includes(selector), `missing agent layout selector ${selector}`);
}
assert.match(styles, /\.photo-library-agent-thread\s*\{[\s\S]*?max-height:/);
assert.match(styles, /\.photo-library-agent-composer\s*\{[\s\S]*?grid-template-columns:/);

for (const language of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  assert.ok(phrases.includes(`  ${language}: {`), `missing ${language} agent phrase map`);
}
for (const source of [
  "Ask Library",
  "Private on-device answers",
  "Actions awaiting confirmation",
  "Confirm destructive action",
  "Local tool activity",
  "Planning with the local model",
  "Send question",
]) {
  assert.equal((phrases.match(new RegExp(`"${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g")) || []).length, 6);
}

console.log("photo library agent UI contract ok");

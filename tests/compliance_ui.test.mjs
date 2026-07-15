import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.tsx", "utf8");
const panel = readFileSync("src/shell/ConsentRetentionPanel.tsx", "utf8");
const styles = readFileSync("src/styles.css", "utf8");
const preload = readFileSync("desktop/preload.cjs", "utf8");
const main = readFileSync("desktop/main.cjs", "utf8");
const api = readFileSync("crossage_fr/api_server.py", "utf8");
const phrases = readFileSync("src/i18n/compliancePhrases.ts", "utf8");

for (const command of [
  "compliance_status",
  "acknowledge_ai_disclosure",
  "enforce_retention_policy",
  "export_biometric_retention_policy",
  "record_biometric_policy_publication",
  "delete_subject_data",
]) {
  assert.match(preload, new RegExp(`"${command}"`), `${command} missing from preload allowlist`);
  assert.match(main, new RegExp(`"${command}"`), `${command} missing from main allowlist`);
  assert.match(api, new RegExp(`"${command}"`), `${command} missing from backend command map`);
}

assert.match(app, /release:\s*\{\s*aiDisclosureAcknowledged\s*\}/s);
assert.match(app, /disabled=\{!acknowledged\}/);
assert.match(app, /set_jurisdiction_preset[\s\S]{0,180}confirm:\s*true/);
assert.match(app, /record_biometric_policy_publication[\s\S]{0,260}confirm:\s*true/);
assert.match(app, /delete_subject_data[\s\S]{0,260}confirm:\s*true/);
assert.match(app, /Original photos and videos will not be deleted/);

for (const field of [
  "signerName",
  "signerRole",
  "specificPurpose",
  "collectionTermDays",
  "lawfulBasis",
  "writtenNoticeAcknowledged",
  "electronicSignatureAccepted",
  "aiDisclosureAcknowledged",
]) {
  assert.match(panel, new RegExp(field), `release field ${field} missing`);
}
assert.match(panel, /noticeAccepted[\s\S]*signatureAccepted[\s\S]*disclosureAccepted/);
assert.match(panel, /disabled=\{busy \|\| !releaseReady\}/);
assert.match(panel, /Revoke release and delete subject data/);
assert.match(panel, /Export publication files/);
assert.match(panel, /Public policy URL/);
assert.match(panel, /Vintrace verifies the URL format|recordPublication/);
assert.match(panel, /status\.subjects\.covered\}\/\{status\.subjects\.biometric/);
assert.match(panel, /status\.subjects\.missing > 0/);
assert.match(panel, /Stored subjects without a current release/);
assert.match(panel, /Add or renew a written release before processing these subjects\./);

assert.match(styles, /\.compliance-governance/);
assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.compliance-status-grid/);
assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.release-form-grid/);
assert.match(styles, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);

for (const locale of ["zh", "es", "fr", "ar", "hi", "ja"]) {
  const source = readFileSync(`src/i18n/locales/${locale}.ts`, "utf8");
  assert.match(source, /compliancePhrases/);
  assert.match(source, new RegExp(`\.\.\.compliancePhrases\.${locale}`));
  assert.match(phrases, new RegExp(`\n  ${locale}: \{`));
}
for (const phrase of [
  "Vintrace AI and biometric processing notice",
  "Similarity results are probabilistic investigative suggestions",
  "The signer adopts this record as an electronic written release.",
  "Public policy evidence required",
  "Stored subject coverage",
  "Stored subjects without a current release",
  "Add or renew a written release before processing these subjects.",
]) {
  assert.match(phrases, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

console.log("compliance UI contract ok");

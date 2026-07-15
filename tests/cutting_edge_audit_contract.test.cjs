#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const pkg = JSON.parse(read("package.json"));
const auditPath = "docs/2026-07-11-cutting-edge-expansion-audit.md";
const ledgerPath = "docs/2026-07-12-cutting-edge-expansion-implementation-ledger.md";
const accessibilityPath = "docs/accessibility-manual-signoff.md";
const businessPath = "docs/distribution-business-decision-record.md";
const audit = read(auditPath);
const ledger = read(ledgerPath);
const accessibility = read(accessibilityPath);
const business = read(businessPath);

const EXPECTED_COUNTS = new Map([
  ["ML", 8],
  ["PHOTO", 10],
  ["MCP", 9],
  ["SEC", 9],
  ["FRONTIER", 8],
]);
const EXPECTED_OPEN = ["ML-05", "MCP-07", "SEC-01", "SEC-06", "FRONTIER-04", "FRONTIER-07"];

function markdownSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function headingAnchors(markdown) {
  const counts = new Map();
  const anchors = new Set();
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const base = markdownSlug(match[2]);
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    anchors.add(count ? `${base}-${count}` : base);
  }
  return anchors;
}

function assertLocalLinksExist(markdown, sourcePath) {
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(root, path.dirname(sourcePath), target);
    assert.ok(fs.existsSync(resolved), `${sourcePath} links to missing local target ${target}`);
  }
}

function tableRows(markdown, idPattern) {
  return markdown.split(/\r?\n/)
    .filter((line) => /^\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length && idPattern.test(cells[0]));
}

function assertCompletedRows(rowsToCheck, valueStart, label) {
  for (const cells of rowsToCheck) {
    assert.ok(cells.slice(valueStart).every(Boolean), `${label} ${cells[0]} has blank completion evidence`);
  }
}

const rows = [...ledger.matchAll(/^- \[([ x])\] (~~)?\*\*((ML|PHOTO|MCP|SEC|FRONTIER)-(\d{2})) -[^\n]+$/gm)]
  .map((match) => ({ checked: match[1] === "x", struck: Boolean(match[2]), id: match[3], family: match[4], line: match[0] }));
assert.equal(rows.length, 44, "the implementation ledger must contain all 44 uniquely identified recommendations");
assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "ledger recommendation IDs must be unique");

for (const [family, expected] of EXPECTED_COUNTS) {
  assert.equal(rows.filter((row) => row.family === family).length, expected, `${family} recommendation count drifted`);
}
for (const row of rows) {
  assert.equal(row.checked, row.struck, `${row.id} must be struck through exactly when checked`);
  if (row.checked) assert.match(row.line, /Verified 2026-07-1[2-5]|source audit confirmed/, `${row.id} lacks dated verification`);
}

const openIds = rows.filter((row) => !row.checked).map((row) => row.id);
assert.deepEqual(openIds, EXPECTED_OPEN, "only the six authorization, publication, signing, accessibility, and business gates may remain open");
assert.match(
  ledger,
  /The six underlying open gates therefore remain ML-05, MCP-07, SEC-01, SEC-06, FRONTIER-04, and FRONTIER-07\./,
);
assert.match(ledger, /^- \[ \] Production\/source\/package checks pass locally,/m, "the aggregate completion claim must remain open");

const evidenceHeadings = ledger.split(/\r?\n/).filter((line) => /^## .+\([^)]+\)/.test(line));
for (const row of rows) {
  assert.ok(evidenceHeadings.some((heading) => heading.includes(row.id)), `${row.id} has no evidence heading`);
}

const anchors = headingAnchors(ledger);
const evidenceLinks = [...audit.matchAll(/2026-07-12-cutting-edge-expansion-implementation-ledger\.md#([^)]+)/g)]
  .map((match) => match[1]);
assert.ok(evidenceLinks.length >= 80, "the canonical audit lost its detailed evidence links");
for (const anchor of evidenceLinks) {
  assert.ok(anchors.has(anchor), `canonical audit links to missing ledger anchor #${anchor}`);
}
assertLocalLinksExist(audit, auditPath);
assertLocalLinksExist(ledger, ledgerPath);

for (let index = 1; index <= 8; index += 1) {
  const id = `A11Y-H${String(index).padStart(2, "0")}`;
  assert.equal((accessibility.match(new RegExp(`\\| ${id} \\|`, "g")) || []).length, 1, `${id} must appear once`);
}
for (let index = 1; index <= 10; index += 1) {
  const id = `T${String(index).padStart(2, "0")}`;
  assert.equal((accessibility.match(new RegExp(`\\| ${id} \\|`, "g")) || []).length, 1, `${id} must appear once`);
}
for (const field of [
  "Product version",
  "Git commit and tag",
  "macOS artifact name and SHA-256",
  "Windows artifact name and SHA-256",
  "Automated accessibility run URL",
]) {
  assert.match(accessibility, new RegExp(`\\| ${field.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")} \\|`));
}
const accessibilityCandidateRows = tableRows(accessibility, /^(?:Product version|Git commit and tag|macOS artifact|Windows artifact|Test data|Automated accessibility|Test window)/);
const accessibilityHumanRows = tableRows(accessibility, /^A11Y-H\d{2}$/);
const accessibilityTaskRows = tableRows(accessibility, /^T\d{2}$/);
const accessibilityCaptionRows = tableRows(accessibility, /^(?:Predeclared sample|Languages|Critical-error|Accuracy\/usefulness|Reviewer names|Aggregate result|Per-clip evidence)/);
const accessibilityDecisionRows = tableRows(accessibility, /^(?:Accessibility tester|QA\/release owner|Product owner|User-with-disability reviewer)/);
assert.equal(accessibilityCandidateRows.length, 7, "accessibility candidate identity matrix drifted");
assert.equal(accessibilityHumanRows.length, 8, "accessibility human matrix drifted");
assert.equal(accessibilityTaskRows.length, 10, "accessibility task matrix drifted");
assert.equal(accessibilityCaptionRows.length, 7, "accessibility caption-review matrix drifted");
assert.equal(accessibilityDecisionRows.length, 4, "accessibility release-decision matrix drifted");

for (let index = 1; index <= 15; index += 1) {
  const id = `D${String(index).padStart(2, "0")}`;
  assert.equal((business.match(new RegExp(`\\| ${id} \\|`, "g")) || []).length, 1, `${id} must appear once`);
}
const businessDecisionRows = tableRows(business, /^D\d{2}$/);
const businessApprovalRows = tableRows(business, /^(?:Product owner|Legal\/counsel|Security\/privacy owner|Release\/engineering owner)$/);
assert.equal(businessDecisionRows.length, 15, "business decision matrix drifted");
assert.equal(businessApprovalRows.length, 4, "business approval matrix drifted");
assert.ok(business.includes(`version \`${pkg.version}\``), "business record package version drifted");
assert.ok(business.includes(`license \`${pkg.license}\``), "business record package license drifted");
assert.ok(business.includes(`\`private: ${pkg.private}\``), "business record private-package fact drifted");

const accessibilityOpen = openIds.includes("FRONTIER-04");
const businessOpen = openIds.includes("FRONTIER-07");
assert.match(accessibility, new RegExp(`\\*\\*Status:\\*\\* ${accessibilityOpen ? "NOT SIGNED" : "SIGNED"}`));
assert.match(business, new RegExp(`\\*\\*Status:\\*\\* ${businessOpen ? "PENDING OWNER AND LEGAL APPROVAL" : "APPROVED"}`));

if (!accessibilityOpen) {
  assertCompletedRows(accessibilityCandidateRows, 1, "candidate identity");
  assertCompletedRows(accessibilityHumanRows, 2, "human matrix");
  assertCompletedRows(accessibilityTaskRows, 2, "task matrix");
  assertCompletedRows(accessibilityCaptionRows, 1, "caption review");
  assertCompletedRows(accessibilityDecisionRows, 1, "release decision");
  for (const cells of [...accessibilityHumanRows, ...accessibilityTaskRows]) {
    const resultIndex = cells[0].startsWith("A11Y-") ? 3 : 2;
    assert.match(cells[resultIndex], /^(?:Pass|N\/A - .+)$/, `${cells[0]} is not an approved passing result`);
  }
  for (const cells of accessibilityDecisionRows) {
    assert.match(cells[2], /^(?:Approve|Approved|Pass)$/i, `${cells[0]} did not approve accessibility release`);
  }
}

if (!businessOpen) {
  assertCompletedRows(businessDecisionRows, 2, "business decision");
  assertCompletedRows(businessApprovalRows, 1, "business approval");
  for (const cells of businessApprovalRows) {
    assert.match(cells[2], /^(?:Approve|Approved)$/i, `${cells[0]} did not approve the business decision`);
  }
}

assert.throws(
  () => assertCompletedRows([["synthetic-open-row", ""]], 1, "synthetic gate"),
  /blank completion evidence/,
  "false manual-gate closure must fail closed",
);

console.log("cutting-edge audit, evidence-link, and open-gate records contract ok");

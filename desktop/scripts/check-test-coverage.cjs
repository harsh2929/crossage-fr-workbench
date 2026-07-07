#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..");
const testsDir = path.join(root, "tests");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
const workflowDir = path.join(root, ".github", "workflows");
const workflowText = fs.existsSync(workflowDir)
  ? fs
      .readdirSync(workflowDir)
      .filter((name) => /\.(ya?ml)$/i.test(name))
      .map((name) => fs.readFileSync(path.join(workflowDir, name), "utf8"))
      .join("\n")
  : "";
const haystack = `${packageJson}\n${workflowText}`;
const missing = fs
  .readdirSync(testsDir)
  .filter((name) => /\.(py|cjs|mjs|js)$/i.test(name))
  .filter((name) => name !== "__init__.py")
  .filter((name) => !haystack.includes(`tests/${name}`) && !haystack.includes(name))
  .sort();

if (missing.length > 0) {
  console.error(`Unreferenced test files (${missing.length}):`);
  for (const name of missing) {
    console.error(`- tests/${name}`);
  }
  process.exit(1);
}

console.log("all top-level tests are referenced by package scripts or workflows");

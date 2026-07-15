const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  SERVER_SCHEMA,
  prepareRegistryDescriptor,
  sha256File,
  validateDescriptor,
} = require("../desktop/scripts/prepare-mcp-registry.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vintrace-mcp-registry-"));
const mac = path.join(root, "Vintrace-darwin-arm64.mcpb");
const windows = path.join(root, "Vintrace-win32-x64.mcpb");
fs.writeFileSync(mac, "mac bundle");
fs.writeFileSync(windows, "windows bundle");

const template = {
  $schema: SERVER_SCHEMA,
  name: "io.github.harsh2929/vintrace",
  title: "Vintrace",
  description: "Private, local-first photo search, review, editing, and face workflows over MCP.",
  version: "0.1.0",
  packages: [],
};
validateDescriptor(template);

const descriptor = prepareRegistryDescriptor({
  root,
  template,
  repository: "harsh2929/crossage-fr-workbench",
  tag: "v0.1.0",
  assets: [windows, mac],
  packageJson: { version: "0.1.0", mcpName: template.name },
});
assert.equal(descriptor.packages.length, 2);
assert.match(descriptor.packages[0].identifier, /releases\/download\/v0\.1\.0\/Vintrace-darwin-arm64\.mcpb$/);
assert.equal(descriptor.packages[0].fileSha256, sha256File(mac));
assert.equal(descriptor.packages[1].fileSha256, sha256File(windows));
assert(!JSON.stringify(descriptor).includes("latest"));

assert.throws(
  () => prepareRegistryDescriptor({
    root,
    template,
    repository: "harsh2929/crossage-fr-workbench",
    tag: "v0.1.1",
    assets: [mac, windows],
    packageJson: { version: "0.1.0", mcpName: template.name },
  }),
  /must exactly match/,
);
assert.throws(
  () => prepareRegistryDescriptor({
    root,
    template,
    repository: "harsh2929/crossage-fr-workbench",
    tag: "v0.1.0",
    assets: [mac],
    packageJson: { version: "0.1.0", mcpName: template.name },
  }),
  /Windows MCPB/,
);
assert.throws(
  () => validateDescriptor({ ...template, description: "x".repeat(101) }),
  /1-100/,
);

const registryWorkflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "mcp-registry.yml"), "utf8");
const releaseWorkflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
for (const workflow of [registryWorkflow, releaseWorkflow]) {
  assert.match(workflow, /MCP_PUBLISHER_VERSION: "1\.8\.0"/);
  assert.match(workflow, /MCP_PUBLISHER_SHA256: "1370446bbe74d562608e8005a6ccce02d146a661fbd78674e11cc70b9618d6cf"/);
}
assert.doesNotMatch(registryWorkflow, /^\s{2}release:\s*$/m, "Registry recovery must not depend on a token-suppressed release event");
assert.match(registryWorkflow, /dry_run:[\s\S]*?default: true/);
assert.match(registryWorkflow, /if: \$\{\{ inputs\.dry_run == false \}\}/);
assert.match(registryWorkflow, /RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/);
assert.doesNotMatch(registryWorkflow, /run:\s*\|[\s\S]*?tag="\$\{\{ inputs\.release_tag \}\}"/);

const descriptorStep = releaseWorkflow.indexOf("Prepare immutable MCP Registry descriptor");
const stagedVerification = releaseWorkflow.indexOf("Verify the complete staged release");
const publicVerification = releaseWorkflow.indexOf("Verify public downloads after publication");
const registryPublish = releaseWorkflow.indexOf("Publish the immutable MCP Registry descriptor");
assert.ok(descriptorStep >= 0 && descriptorStep < stagedVerification);
assert.ok(stagedVerification < publicVerification && publicVerification < registryPublish);
assert.match(releaseWorkflow, /release:verify-platform-evidence/);

console.log("ok schema-current immutable MCP Registry descriptor generation and platform gates");

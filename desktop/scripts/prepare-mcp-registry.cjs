const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SERVER_SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";

function sha256File(file, fsImpl = fs) {
  return crypto.createHash("sha256").update(fsImpl.readFileSync(file)).digest("hex");
}

function validateDescriptor(descriptor, options = {}) {
  const packagesRequired = options.packagesRequired === true;
  if (descriptor.$schema !== SERVER_SCHEMA) throw new Error(`server.json must use ${SERVER_SCHEMA}.`);
  if (!/^[A-Za-z0-9.-]+\/[A-Za-z0-9._-]+$/.test(String(descriptor.name || ""))) {
    throw new Error("server.json name must use the Registry namespace/name form.");
  }
  const description = String(descriptor.description || "");
  if (!description || description.length > 100) throw new Error("server.json description must contain 1-100 characters.");
  if (!String(descriptor.version || "")) throw new Error("server.json requires a version.");
  const packages = Array.isArray(descriptor.packages) ? descriptor.packages : [];
  if (packagesRequired && !packages.length) throw new Error("A publishable descriptor requires at least one package.");
  for (const entry of packages) {
    if (entry.registryType !== "mcpb") throw new Error("Vintrace Registry packages must use registryType=mcpb.");
    const identifier = String(entry.identifier || "");
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/v[^/]+\/[^/]+\.mcpb$/.test(identifier)) {
      throw new Error(`MCPB identifier must be an immutable GitHub release URL: ${identifier}`);
    }
    if (identifier.includes("/latest/") || identifier.includes("/releases/latest/")) {
      throw new Error("MCPB identifiers cannot use a mutable latest-release URL.");
    }
    if (!/^[a-f0-9]{64}$/.test(String(entry.fileSha256 || ""))) {
      throw new Error("Every MCPB package requires a lowercase SHA-256 digest.");
    }
    if (entry.transport?.type !== "stdio") throw new Error("Vintrace MCPB packages must use stdio transport.");
  }
  return descriptor;
}

function prepareRegistryDescriptor(options = {}) {
  const root = options.root || path.resolve(__dirname, "..", "..");
  const fsImpl = options.fsImpl || fs;
  const packageJson = options.packageJson || JSON.parse(fsImpl.readFileSync(path.join(root, "package.json"), "utf8"));
  const template = options.template || JSON.parse(fsImpl.readFileSync(path.join(root, "mcp", "server.json"), "utf8"));
  const repository = String(options.repository || "").trim();
  const tag = String(options.tag || "").trim();
  const assets = [...(options.assets || [])].map((item) => path.resolve(item)).sort();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("--repo must be owner/repository.");
  if (tag !== `v${packageJson.version}`) {
    throw new Error(`Release tag ${tag || "(missing)"} must exactly match package version v${packageJson.version}.`);
  }
  if (template.name !== packageJson.mcpName) {
    throw new Error("package.json mcpName must exactly match mcp/server.json name.");
  }
  if (!assets.length) throw new Error("At least one --asset MCPB file is required.");
  if (!options.allowPartial) {
    const names = assets.map((asset) => path.basename(asset));
    if (!names.some((name) => /^Vintrace-darwin-.+\.mcpb$/.test(name))) {
      throw new Error("Registry publication requires a macOS MCPB asset.");
    }
    if (!names.some((name) => /^Vintrace-win32-.+\.mcpb$/.test(name))) {
      throw new Error("Registry publication requires a Windows MCPB asset.");
    }
  }
  const packages = assets.map((asset) => {
    if (!fsImpl.statSync(asset).isFile() || path.extname(asset) !== ".mcpb") {
      throw new Error(`Registry asset is not an MCPB file: ${asset}`);
    }
    const filename = path.basename(asset);
    return {
      registryType: "mcpb",
      registryBaseUrl: "https://github.com",
      identifier: `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`,
      version: packageJson.version,
      fileSha256: sha256File(asset, fsImpl),
      transport: { type: "stdio" },
    };
  });
  return validateDescriptor({ ...template, version: packageJson.version, packages }, { packagesRequired: true });
}

function parseArgs(argv) {
  const values = { assets: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--allow-partial") values.allowPartial = true;
    else if (arg === "--asset") values.assets.push(argv[++index]);
    else if (arg === "--tag") values.tag = argv[++index];
    else if (arg === "--repo") values.repository = argv[++index];
    else if (arg === "--output") values.output = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return values;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const descriptor = prepareRegistryDescriptor(options);
    const output = path.resolve(options.output || path.join("dist", "server.json"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(descriptor, null, 2)}\n`);
    console.log(`Prepared ${output}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  SERVER_SCHEMA,
  prepareRegistryDescriptor,
  sha256File,
  validateDescriptor,
};

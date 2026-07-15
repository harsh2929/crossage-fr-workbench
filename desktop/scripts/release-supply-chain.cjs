"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const SYFT_VERSION = "1.44.0";
const COSIGN_VERSION = "3.0.6";
const CYCLONEDX_NAME = "vintrace.cdx.json";
const SPDX_NAME = "vintrace.spdx.json";
const BUILD_METADATA_NAME = "vintrace-build-metadata.json";
const CHECKSUM_NAME = "SHA256SUMS.txt";
const CHECKSUM_SIGNATURE_NAME = `${CHECKSUM_NAME}.sig`;
const SLSA_ATTESTATION_NAME = "vintrace-slsa-provenance.attestation.sigstore.json";
const CYCLONEDX_ATTESTATION_NAME = "vintrace-cyclonedx.attestation.sigstore.json";
const SPDX_ATTESTATION_NAME = "vintrace-spdx.attestation.sigstore.json";
const SIGSTORE_BUNDLE_MEDIA_TYPE = "application/vnd.dev.sigstore.bundle.v0.3+json";
const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const MAX_ATTESTATION_PREDICATE_BYTES = 16 * 1024 * 1024;
const RELEASE_ASSEMBLY_PLATFORMS = Object.freeze(["macos", "windows", "linux"]);

const RELEASE_METADATA_NAMES = new Set([
  CYCLONEDX_NAME,
  SPDX_NAME,
  BUILD_METADATA_NAME,
]);

const LEGACY_RELEASE_METADATA_NAMES = new Set([
  "vintrace-sbom.json",
  "vintrace-provenance.json",
]);

const GITHUB_ATTESTATIONS = Object.freeze([
  {
    file: SLSA_ATTESTATION_NAME,
    kind: "attestation",
    predicateType: "https://slsa.dev/provenance/v1",
  },
  {
    file: CYCLONEDX_ATTESTATION_NAME,
    kind: "attestation",
    predicateType: "https://cyclonedx.org/bom",
  },
  {
    file: SPDX_ATTESTATION_NAME,
    kind: "attestation",
    predicateType: "https://spdx.dev/Document/v2.3",
  },
]);

const REQUIRED_RUNTIME_PURLS = Object.freeze([
  "pkg:npm/electron@43.1.0",
  "pkg:npm/react@19.2.7",
  "pkg:pypi/c2pa-python@0.36.0",
  "pkg:pypi/onnxruntime@1.27.0",
  "pkg:pypi/sqlcipher3@0.6.2",
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${error.message || String(error)}`);
  }
}

function writeJsonAtomic(file, payload) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, file);
}

function writeFileAtomic(file, bytes, options = {}) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temp, bytes, options);
  fs.renameSync(temp, file);
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function safeReleaseName(value) {
  const name = String(value || "");
  invariant(name.length > 0, "Release artifact name is empty");
  invariant(name !== "." && name !== "..", `Unsafe release artifact name: ${name}`);
  invariant(!/[\\/\0\r\n]/.test(name), `Unsafe release artifact name: ${name}`);
  invariant(path.basename(name) === name, `Release artifact must be top-level: ${name}`);
  return name;
}

function parseChecksumText(text) {
  const entries = [];
  const seen = new Set();
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const match = line.match(/^([a-f0-9]{64}) ([ *])(.+)$/i);
    invariant(match, `Malformed checksum line ${index + 1}`);
    const name = safeReleaseName(match[3]);
    const key = name.toLowerCase();
    invariant(!seen.has(key), `Duplicate checksum subject: ${name}`);
    seen.add(key);
    entries.push({ name, sha256: match[1].toLowerCase() });
  }
  invariant(entries.length > 0, "SHA256SUMS.txt has no subjects");
  return entries;
}

function readChecksumFile(file) {
  return parseChecksumText(fs.readFileSync(file, "utf8"));
}

function verifyChecksummedFiles(dist, entries) {
  for (const entry of entries) {
    const file = path.join(dist, safeReleaseName(entry.name));
    invariant(fs.existsSync(file), `Checksummed release subject is missing: ${entry.name}`);
    const stat = fs.lstatSync(file);
    invariant(stat.isFile() && !stat.isSymbolicLink(), `Release subject must be a regular file: ${entry.name}`);
    const actual = sha256File(file);
    invariant(actual === entry.sha256, `Release subject digest mismatch: ${entry.name}`);
  }
  return true;
}

function purlSetFromCycloneDx(sbom) {
  return new Set((sbom.components || [])
    .map((component) => component && component.purl)
    .filter((purl) => typeof purl === "string" && purl.length > 0));
}

function purlSetFromSpdx(sbom) {
  const purls = new Set();
  for (const pkg of sbom.packages || []) {
    for (const ref of pkg.externalRefs || []) {
      if (String(ref.referenceType || "").toLowerCase() === "purl" && typeof ref.referenceLocator === "string") {
        purls.add(ref.referenceLocator);
      }
    }
  }
  return purls;
}

function assertRequiredPurls(purls, format) {
  for (const purl of REQUIRED_RUNTIME_PURLS) {
    invariant(purls.has(purl), `${format} SBOM is missing required runtime package ${purl}`);
  }
}

function validateCycloneDx(sbom, product) {
  invariant(sbom && typeof sbom === "object" && !Array.isArray(sbom), "CycloneDX SBOM must be an object");
  invariant(sbom.bomFormat === "CycloneDX", "CycloneDX bomFormat must be CycloneDX");
  invariant(sbom.specVersion === "1.6", `CycloneDX specVersion must be 1.6, got ${sbom.specVersion || "missing"}`);
  invariant(/^urn:uuid:[0-9a-f-]{36}$/i.test(String(sbom.serialNumber || "")), "CycloneDX serialNumber must be a UUID URN");
  invariant(Number.isInteger(sbom.version) && sbom.version >= 1, "CycloneDX document version is missing");
  invariant(!Number.isNaN(Date.parse(String(sbom.metadata?.timestamp || ""))), "CycloneDX metadata timestamp is invalid");
  invariant(sbom.metadata?.component?.name === product.name, "CycloneDX product name does not match package metadata");
  invariant(sbom.metadata?.component?.version === product.version, "CycloneDX product version does not match package metadata");
  const tools = sbom.metadata?.tools?.components || [];
  invariant(tools.some((tool) => String(tool.name || "").toLowerCase() === "syft" && tool.version === SYFT_VERSION), `CycloneDX must identify Syft ${SYFT_VERSION}`);
  invariant(Array.isArray(sbom.components) && sbom.components.length > 0, "CycloneDX components are empty");
  invariant(Array.isArray(sbom.dependencies) && sbom.dependencies.length > 0, "CycloneDX dependency graph is empty");
  const purls = purlSetFromCycloneDx(sbom);
  invariant(purls.size > 0, "CycloneDX components have no package URLs");
  assertRequiredPurls(purls, "CycloneDX");
  return { components: sbom.components.length, dependencies: sbom.dependencies.length, purls };
}

function validateSpdx(sbom, product) {
  invariant(sbom && typeof sbom === "object" && !Array.isArray(sbom), "SPDX SBOM must be an object");
  invariant(sbom.spdxVersion === "SPDX-2.3", `SPDX version must be SPDX-2.3, got ${sbom.spdxVersion || "missing"}`);
  invariant(sbom.dataLicense === "CC0-1.0", "SPDX dataLicense must be CC0-1.0");
  invariant(sbom.SPDXID === "SPDXRef-DOCUMENT", "SPDX document identifier is invalid");
  invariant(sbom.name === product.name, "SPDX product name does not match package metadata");
  invariant(/^https:\/\/anchore\.com\/syft\//.test(String(sbom.documentNamespace || "")), "SPDX document namespace is not a Syft namespace");
  invariant(!Number.isNaN(Date.parse(String(sbom.creationInfo?.created || ""))), "SPDX creation timestamp is invalid");
  const creators = sbom.creationInfo?.creators || [];
  invariant(creators.includes(`Tool: syft-${SYFT_VERSION}`), `SPDX must identify Syft ${SYFT_VERSION}`);
  invariant(Array.isArray(sbom.packages) && sbom.packages.length > 0, "SPDX packages are empty");
  invariant(Array.isArray(sbom.relationships) && sbom.relationships.length > 0, "SPDX relationship graph is empty");
  const purls = purlSetFromSpdx(sbom);
  invariant(purls.size > 0, "SPDX packages have no package URLs");
  assertRequiredPurls(purls, "SPDX");
  return { packages: sbom.packages.length, relationships: sbom.relationships.length, purls };
}

function validateSbomFiles(cycloneDxFile, spdxFile, product) {
  for (const file of [cycloneDxFile, spdxFile]) {
    const stat = fs.statSync(file);
    invariant(stat.isFile() && stat.size > 0, `${path.basename(file)} is empty`);
    invariant(stat.size < MAX_ATTESTATION_PREDICATE_BYTES, `${path.basename(file)} exceeds the GitHub attestation 16 MiB predicate limit`);
  }
  const cycloneDx = validateCycloneDx(readJson(cycloneDxFile), product);
  const spdx = validateSpdx(readJson(spdxFile), product);
  const cdxOnly = [...cycloneDx.purls].filter((purl) => !spdx.purls.has(purl));
  const spdxOnly = [...spdx.purls].filter((purl) => !cycloneDx.purls.has(purl));
  invariant(cdxOnly.length === 0 && spdxOnly.length === 0, `CycloneDX/SPDX package URL sets differ (CycloneDX-only: ${cdxOnly.slice(0, 3).join(", ") || "none"}; SPDX-only: ${spdxOnly.slice(0, 3).join(", ") || "none"})`);
  return {
    cycloneDx: { components: cycloneDx.components, dependencies: cycloneDx.dependencies, purls: cycloneDx.purls.size },
    spdx: { packages: spdx.packages, relationships: spdx.relationships, purls: spdx.purls.size },
  };
}

function validateBuildMetadata(metadata, product) {
  invariant(metadata && typeof metadata === "object" && !Array.isArray(metadata), "Build metadata must be an object");
  invariant(metadata.schemaVersion === 1, "Build metadata schemaVersion must be 1");
  invariant(!Number.isNaN(Date.parse(String(metadata.generatedAt || ""))), "Build metadata generatedAt is invalid");
  invariant(metadata.product?.name === product.name && metadata.product?.version === product.version, "Build metadata product does not match package metadata");
  invariant(Array.isArray(metadata.artifacts) && metadata.artifacts.length > 0, "Build metadata artifact inventory is empty");
  for (const record of metadata.artifacts) {
    safeReleaseName(record?.path);
    invariant(Number.isInteger(record?.bytes) && record.bytes >= 0, `Build metadata has invalid byte size for ${record?.path || "unknown artifact"}`);
    invariant(/^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")), `Build metadata has invalid SHA-256 for ${record?.path || "unknown artifact"}`);
  }
  invariant(metadata.sbom?.generator?.name === "syft" && metadata.sbom?.generator?.version === SYFT_VERSION, "Build metadata has the wrong SBOM generator");
  invariant(Array.isArray(metadata.sbom?.outputs) && metadata.sbom.outputs.length === 2, "Build metadata must inventory both standard SBOM outputs");
  const sbomOutputNames = new Set(metadata.sbom.outputs.map((record) => safeReleaseName(record?.path)));
  invariant(sbomOutputNames.has(CYCLONEDX_NAME) && sbomOutputNames.has(SPDX_NAME), "Build metadata SBOM output names are incomplete");
  for (const record of metadata.sbom.outputs) {
    invariant(Number.isInteger(record?.bytes) && record.bytes > 0, `Build metadata has invalid byte size for ${record?.path || "unknown SBOM"}`);
    invariant(/^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")), `Build metadata has invalid SHA-256 for ${record?.path || "unknown SBOM"}`);
  }
  invariant(metadata.releaseEvidencePolicy?.minimumSlsaBuildLevel === 2, "Build metadata must require SLSA Build L2");
  invariant(metadata.releaseEvidencePolicy?.githubAttestationRequired === true, "Build metadata must require GitHub attestations");
  invariant(metadata.releaseEvidencePolicy?.keylessCosignRequired === true, "Build metadata must require keyless cosign signatures");
  invariant(metadata.releaseEvidencePolicy?.provenanceGeneratedSeparately === true, "Build metadata must not claim to be provenance");
  const releaseAssembly = metadata.declaredBuildContext?.releaseAssembly;
  if (releaseAssembly != null) {
    invariant(metadata.source?.dirty === false, "Aggregate release build metadata must report a clean source tree");
    validateReleaseAssembly(releaseAssembly, {
      product,
      source: metadata.source,
      artifacts: metadata.artifacts,
    });
  }
  return true;
}

function validateReleaseAssembly(assembly, options = {}) {
  invariant(assembly && typeof assembly === "object" && !Array.isArray(assembly), "Release assembly manifest must be an object");
  invariant(assembly.schemaVersion === 1, "Release assembly manifest must use schemaVersion 1");
  invariant(!Number.isNaN(Date.parse(String(assembly.generatedAt || ""))), "Release assembly manifest generatedAt is invalid");
  invariant(/^[a-f0-9]{40}$/i.test(String(assembly.source?.commit || "")), "Release assembly manifest source commit must be a full Git SHA");
  invariant(/^refs\/tags\/[^/]+$/.test(String(assembly.source?.ref || "")), "Release assembly manifest source ref must be one exact tag ref");
  invariant(/^[^/\s]+\/[^/\s]+$/.test(String(assembly.source?.repository || "")), "Release assembly manifest repository must be owner/repository");
  invariant(typeof assembly.product?.name === "string" && assembly.product.name.length > 0, "Release assembly manifest product name is missing");
  invariant(typeof assembly.product?.version === "string" && assembly.product.version.length > 0, "Release assembly manifest product version is missing");

  if (options.product) {
    invariant(
      assembly.product.name === options.product.name && assembly.product.version === options.product.version,
      "Release assembly manifest product does not match package metadata",
    );
  }
  if (options.source) {
    invariant(assembly.source.commit === options.source.commit, "Release assembly manifest commit does not match the build commit");
    invariant(assembly.source.ref === options.source.ref, "Release assembly manifest ref does not match the build ref");
    invariant(assembly.source.repository === options.source.repository, "Release assembly manifest repository does not match the build repository");
  }

  invariant(Array.isArray(assembly.platforms) && assembly.platforms.length === RELEASE_ASSEMBLY_PLATFORMS.length, "Release assembly manifest must contain macOS, Windows, and Linux");
  const platformIds = assembly.platforms.map((item) => item?.id);
  invariant(
    RELEASE_ASSEMBLY_PLATFORMS.every((id) => platformIds.includes(id)) && new Set(platformIds).size === RELEASE_ASSEMBLY_PLATFORMS.length,
    "Release assembly manifest must contain each required platform exactly once",
  );

  const payloads = new Map();
  for (const platform of assembly.platforms) {
    invariant(platform.sourceCommit === assembly.source.commit, `${platform.id} assembly source commit does not match`);
    invariant(platform.sourceRef === assembly.source.ref, `${platform.id} assembly source ref does not match`);
    invariant(/^[a-f0-9]{64}$/i.test(String(platform.sourceChecksumSha256 || "")), `${platform.id} assembly checksum digest is invalid`);
    invariant(Array.isArray(platform.payloads) && platform.payloads.length > 0, `${platform.id} assembly payload inventory is empty`);
    for (const record of platform.payloads) {
      const name = safeReleaseName(record?.name);
      const key = name.toLowerCase();
      invariant(!payloads.has(key), `Release assembly repeats or collides on payload ${name}`);
      invariant(/^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")), `Release assembly has an invalid SHA-256 for ${name}`);
      payloads.set(key, { name, sha256: record.sha256.toLowerCase() });
    }
  }
  invariant(Number.isInteger(assembly.payloadCount) && assembly.payloadCount === payloads.size, "Release assembly payload count does not match its inventory");

  if (options.artifacts) {
    invariant(Array.isArray(options.artifacts), "Expected release artifact inventory must be an array");
    const artifacts = new Map();
    for (const record of options.artifacts) {
      const name = safeReleaseName(record?.path);
      const key = name.toLowerCase();
      invariant(!artifacts.has(key), `Build metadata repeats or collides on artifact ${name}`);
      invariant(/^[a-f0-9]{64}$/i.test(String(record?.sha256 || "")), `Build metadata has an invalid SHA-256 for ${name}`);
      artifacts.set(key, { name, sha256: record.sha256.toLowerCase() });
    }
    invariant(artifacts.size === payloads.size, "Release assembly payload inventory does not match aggregate build metadata");
    for (const [key, payload] of payloads) {
      const artifact = artifacts.get(key);
      invariant(artifact && artifact.name === payload.name && artifact.sha256 === payload.sha256, `Release assembly payload does not match aggregate artifact ${payload.name}`);
    }
  }
  return true;
}

function cosignBundleName(subjectName) {
  return `${safeReleaseName(subjectName)}.sigstore.json`;
}

function validateSigstoreBundle(payload, kind) {
  invariant(payload && typeof payload === "object" && !Array.isArray(payload), "Sigstore bundle must be a JSON object");
  invariant(payload.mediaType === SIGSTORE_BUNDLE_MEDIA_TYPE, `Sigstore bundle must use ${SIGSTORE_BUNDLE_MEDIA_TYPE}`);
  invariant(typeof payload.verificationMaterial?.certificate?.rawBytes === "string" && payload.verificationMaterial.certificate.rawBytes.length > 0, "Sigstore bundle is missing its keyless signing certificate");
  if (kind === "blob") {
    invariant(payload.messageSignature && typeof payload.messageSignature === "object", "Cosign blob bundle is missing messageSignature");
    invariant(typeof payload.messageSignature.signature === "string" && payload.messageSignature.signature.length > 0, "Cosign blob signature is empty");
  } else if (kind === "attestation") {
    invariant(payload.dsseEnvelope && typeof payload.dsseEnvelope === "object", "GitHub attestation bundle is missing dsseEnvelope");
    invariant(typeof payload.dsseEnvelope.payload === "string" && payload.dsseEnvelope.payload.length > 0, "GitHub attestation payload is empty");
    invariant(Array.isArray(payload.dsseEnvelope.signatures) && payload.dsseEnvelope.signatures.length > 0, "GitHub attestation has no signatures");
  } else {
    invariant(payload.messageSignature || payload.dsseEnvelope, "Sigstore bundle has no signed content");
  }
  return true;
}

function validateSigstoreBundleFile(file, kind) {
  const stat = fs.lstatSync(file);
  invariant(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0, `${path.basename(file)} must be a non-empty regular file`);
  return validateSigstoreBundle(readJson(file), kind);
}

function expectedSupplyChainBundles(checksumEntries) {
  return [
    ...GITHUB_ATTESTATIONS.map((item) => ({ name: item.file, kind: item.kind })),
    ...checksumEntries.map((entry) => ({ name: cosignBundleName(entry.name), kind: "blob" })),
    { name: cosignBundleName(CHECKSUM_NAME), kind: "blob" },
  ];
}

module.exports = {
  BUILD_METADATA_NAME,
  CHECKSUM_NAME,
  CHECKSUM_SIGNATURE_NAME,
  COSIGN_VERSION,
  CYCLONEDX_ATTESTATION_NAME,
  CYCLONEDX_NAME,
  GITHUB_ATTESTATIONS,
  GITHUB_OIDC_ISSUER,
  LEGACY_RELEASE_METADATA_NAMES,
  MAX_ATTESTATION_PREDICATE_BYTES,
  RELEASE_METADATA_NAMES,
  RELEASE_ASSEMBLY_PLATFORMS,
  REQUIRED_RUNTIME_PURLS,
  SIGSTORE_BUNDLE_MEDIA_TYPE,
  SLSA_ATTESTATION_NAME,
  SPDX_ATTESTATION_NAME,
  SPDX_NAME,
  SYFT_VERSION,
  cosignBundleName,
  expectedSupplyChainBundles,
  invariant,
  parseChecksumText,
  readChecksumFile,
  readJson,
  safeReleaseName,
  sha256File,
  validateBuildMetadata,
  validateReleaseAssembly,
  validateCycloneDx,
  validateSbomFiles,
  validateSigstoreBundle,
  validateSigstoreBundleFile,
  validateSpdx,
  verifyChecksummedFiles,
  writeFileAtomic,
  writeJsonAtomic,
};

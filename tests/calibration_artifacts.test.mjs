import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "calibration-artifacts-")), "calibrationArtifacts.mjs");
esbuild.buildSync({
  entryPoints: [path.join(ROOT, "src/lib/calibrationArtifacts.ts")],
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

const snakeArtifact = {
  artifact_id: "learn_123",
  artifact_type: "calibration",
  status: "staged",
  model_name: "siglip",
  version_key: "calibration-v1",
  training_data_hash: "training-hash",
  input_count: "42",
  positive_count: 30,
  negative_count: 12,
  metrics: { delta: 0.04 },
  payload: { labels: 42 },
  artifact_hash: "artifact-hash",
  parent_artifact_id: "learn_parent",
  created_at: "2026-07-07T00:00:00Z",
  promoted_at: null,
};

run("normalizes snake_case artifact rows to camelCase", () => {
  const artifact = mod.normalizeCalibrationLearningArtifact(snakeArtifact);
  assert.deepStrictEqual(artifact, {
    artifactId: "learn_123",
    artifactType: "calibration",
    status: "staged",
    modelName: "siglip",
    versionKey: "calibration-v1",
    trainingDataHash: "training-hash",
    inputCount: 42,
    positiveCount: 30,
    negativeCount: 12,
    metrics: { delta: 0.04 },
    payload: { labels: 42 },
    artifactHash: "artifact-hash",
    parentArtifactId: "learn_parent",
    createdAt: "2026-07-07T00:00:00Z",
    promotedAt: null,
  });
  for (const key of Object.keys(artifact)) {
    assert.ok(!key.includes("_"), `snake key leaked into renderer artifact: ${key}`);
  }
});

run("normalizes learned calibration status artifacts", () => {
  const status = mod.normalizeCalibrationLearningStatus({
    summary: { totalLabels: 42 },
    current: { thresholds: { likely: 0.73 } },
    artifacts: [snakeArtifact],
    readiness: { ready: true, reason: "ready" },
  });
  assert.strictEqual(status.artifacts[0].artifactId, "learn_123");
  assert.strictEqual(status.artifacts[0].inputCount, 42);
});

run("normalizes embedding adapter active artifact", () => {
  const status = mod.normalizeEmbeddingAdapterStatus({
    summary: { totalExamples: 42 },
    artifacts: [snakeArtifact],
    activeArtifact: snakeArtifact,
  });
  assert.strictEqual(status.activeArtifact.artifactId, "learn_123");
  assert.strictEqual(status.artifacts[0].artifactHash, "artifact-hash");
});

run("normalizes command result artifacts", () => {
  const result = mod.normalizeCalibrationLearningResult({
    status: "staged",
    artifact: snakeArtifact,
    payload: { labels: 42 },
  });
  assert.strictEqual(result.artifact.artifactId, "learn_123");
  assert.deepStrictEqual(result.payload, { labels: 42 });
});

run("normalizes learning job nested status", () => {
  const result = mod.normalizeLearningJobsResult({
    staged: true,
    artifactCreated: true,
    reason: "done",
    status: { summary: {}, current: {}, artifacts: [snakeArtifact] },
  });
  assert.strictEqual(result.staged, true);
  assert.strictEqual(result.artifactCreated, true);
  assert.strictEqual(result.status.artifacts[0].artifactId, "learn_123");
});

console.log("\nall calibration artifact tests passed");

import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../src/styles.css";
import { ModelLifecyclePanel } from "../../../src/shell/ModelLifecyclePanel";

const blocked = new URLSearchParams(window.location.search).get("blocked") === "1";
const definitions = [
  ["face-recognition", "Face recognition", "embedding", "antelopev2", "pass"],
  ["face-quality", "Face quality and culling", "fiqa", "2026-07-12.1", "pass"],
  ["photo-ocr", "Photo OCR", "ocr", "2026-07-12.1", blocked ? "blocked" : "pass"],
  ["photo-vlm", "Photo captions and tags", "vision-language", "2026-07-12.1", "not-installed"],
  ["semantic-embedding", "Semantic image and video embedding", "embedding", "SigLIP2", "pass"],
  ["photo-generative", "Generative photo editing", "generative", "2026-07-12.1", "not-installed"],
  ["multimodal-safety", "Multimodal safety guardrail", "guardrail", "vintrace-visual-safety-v1", "not-installed"],
  ["synthetic-enrollment-screen", "Synthetic enrollment screen", "guardrail", "2026-07-12.1", "pass"],
  ["audio-intelligence", "Audio transcripts and sound events", "audio-understanding", "2026-07-13.1", "pass"],
];

function component([id, label, family, version, status]) {
  return {
    id,
    label,
    family,
    status,
    runtime: {
      installed: status !== "not-installed",
      available: status === "pass",
      verified: status === "pass",
      version,
      fingerprint: status === "pass" ? "a".repeat(64) : "",
      reason: status === "not-installed" ? "Optional verified model pack is not installed." : status === "blocked" ? "Runtime fingerprint drifted." : "Runtime verified.",
    },
    baseline: { passed: true, integrity: true, reportSha256: "b".repeat(64), reportName: `${id}.json`, metrics: [], failures: [] },
    candidate: null,
    datasets: [{ id: `${id}-fixture`, version: "1", kind: "fixture", verified: true, verification: "committed-files-verified" }],
    rollback: { mode: id === "face-recognition" ? "configuration" : "application-release", fields: [] },
    failures: status === "blocked" ? ["Runtime fingerprint drifted."] : [],
  };
}

const components = definitions.map(component);
const report = {
  schemaVersion: 1,
  generatedAt: "2026-07-13T12:00:00Z",
  policyId: "vintrace-model-lifecycle",
  policyVersion: "2026-07-13.3",
  policySha256: "c".repeat(64),
  offlineOnly: true,
  ready: !blocked,
  counts: {
    components: 9,
    passed: components.filter((item) => item.status === "pass").length,
    notInstalled: components.filter((item) => item.status === "not-installed").length,
    unavailable: 0,
    blocked: components.filter((item) => item.status === "blocked").length,
    candidateRejected: 0,
    datasetManifests: 9,
    datasetManifestsVerified: 9,
  },
  components,
  blockers: blocked ? ["Photo OCR: Runtime fingerprint drifted."] : [],
  warnings: [],
  state: { accepted: 1, staged: 0, history: 1, configurationHistory: 2, updatedAt: "2026-07-13T12:00:00Z" },
};

function Fixture() {
  const [action, setAction] = useState("none");
  return (
    <main className="workspace" style={{ maxWidth: 980, margin: "0 auto" }}>
      <ModelLifecyclePanel
        report={report}
        busy={false}
        uiText={(value) => value}
        onRun={() => setAction("run")}
        onRollbackConfiguration={() => setAction("rollback")}
      />
      <output aria-label="Last action">{action}</output>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Fixture />);

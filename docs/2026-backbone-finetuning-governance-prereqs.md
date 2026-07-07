# Backbone Fine-Tuning Governance Prerequisites

Status: DRAFT R&D prerequisite pack. This is not legal approval, not a DPIA, and
not authorization to train or ship derivative face-recognition weights.

## Legal Review

Owner: DPO/counsel/operator, not the agent.

Required review topics:

- Whether any selected recognizer weights permit derivative fine-tuned weights.
- Whether biometric templates, labels, and generated weights are biometric data
  under the deployment jurisdiction.
- Consent language and withdrawal mechanics for model training, not just local
  matching.
- Whether fine-tuned weights can leave the device, be backed up, or be shared.
- Retention and deletion duties for training rows, checkpoints, and exported
  weights.

Status: pending external review.

Machine-readable gate:

- `crossage_fr/experiments/retraining_governance.py::legal_review_gate`
  expects a JSON review file with `decision: "approved_for_r_and_d"`,
  reviewer/date metadata, all required topic flags, and a structured `scope`
  block covering jurisdiction, model families, base-model license evidence,
  biometric data categories, consent policy version, retention period,
  withdrawal procedure, and export/backup policy.
- Missing, malformed, incomplete, or non-approved legal evidence blocks true
  model retraining R&D.
- License evidence rows must name the model family, source evidence, and an
  approved R&D license status.
- Unsupported schema versions, invalid review dates, and future-dated reviews
  are blocked.
- The gate is tested in `tests/retraining_governance_units.py`.
- Run `npm run bench:retraining-governance -- <output-folder>` to create
  fail-closed legal-review/runtime-study templates and a hashed readiness report
  for external reviewers.

## Biometric Training Consent Policy

Draft minimum policy:

- Training is opt-in and separate from ordinary local matching consent.
- Consent must name the subject, model family, data categories, purpose, storage
  location, retention period, withdrawal path, and whether derivative weights are
  created.
- Auto-promote is forbidden for backbone fine-tuning.
- Consent withdrawal must block new training and queue deletion or invalidation of
  subject-derived training data and derivative checkpoints.
- Minor/child training requires stricter operator policy and should default to
  off until counsel approves a jurisdiction-specific workflow.

## Dedicated Training Dataset Requirements

- Human-reviewed identity labels only; no unreviewed model guesses.
- Split by identity and acquisition session so train/validation/test are not
  near-duplicates.
- Track age bucket, pose bucket, media kind, quality band, source provenance,
  consent scope, model version, detector version, and capture-date provenance.
- Include hard negatives such as lookalikes, family members, profile faces,
  low-light frames, and video frames.
- Maintain a frozen holdout set that is never used for training or calibration.
- Require minimum per-identity and per-cohort counts before any fine-tuning trial.

## GPU And Runtime Feasibility

Current package status:

- Production app ships inference-first ONNX/InsightFace paths.
- `onnxruntime` is available locally.
- `onnxruntime.training` is not available locally.
- PyTorch is not available locally.

Required before implementation:

- Measure CPU-only and GPU training duration on target devices.
- Measure package size and installer impact for training dependencies.
- Prove training can run offline without downloading code at runtime.
- Define cancellation, resume, thermal, memory, and disk-space behavior.

Machine-readable gate:

- `crossage_fr/experiments/retraining_governance.py::runtime_feasibility_gate`
  expects a JSON target-device study covering macOS arm64, macOS x64, Windows
  x64, and Linux x64.
- Each target must report training runtime availability, training duration,
  package size, failure modes, and pass/warn status.
- Missing targets, missing package-size data, missing failure modes, or
  unavailable training runtime block true model retraining R&D.
- The generated runtime-study template defaults every target to blocked until
  actual target-machine measurements are supplied.
- Unsupported schema versions are blocked.

## Bias And Fairness Evaluation Plan

- Report precision, recall, false-match rate, false-reject rate, and calibration
  error by cohort and scenario.
- Include age-gap, pose, video/still, low-quality, and hard-negative cohorts at
  minimum.
- Use identity-disjoint held-out splits.
- Block promotion if any protected or operational cohort regresses beyond a
  documented threshold.
- Publish confidence intervals and sample sizes with every benchmark row.

## Poisoning And Overfitting Mitigation

- Train only from accepted/rejected human-reviewed labels.
- Require identity-disjoint validation and a frozen test set.
- Cap per-person contribution so one subject cannot dominate global weights.
- Detect label flips, duplicate media, and low-quality outliers before training.
- Keep checkpoints signed, hash-linked, and rollbackable.
- Prefer adapter/calibration updates whenever they achieve the same gain.

## Model Provenance And Signing Plan

- Record base model name, license state, checksum, source, training code version,
  training dataset manifest hash, hyperparameters, generated artifact hashes, and
  evaluation report paths.
- Sign derivative model artifacts before they can be loaded by production code.
- Store provenance with the audit log and backup manifest.
- Refuse to load unsigned or provenance-incomplete fine-tuned weights.
- `write_backbone_readiness_report()` records SHA-256 evidence hashes for the
  legal review, runtime study, and prerequisite docs;
  `verify_backbone_readiness_report()` fails if the report or source evidence is
  tampered after generation.

## Offline Training And Rollback Strategy

- Training runs as an explicit offline job, never during scan hot paths.
- The previous production model remains active until validation and human
  promotion complete.
- Rollback restores the previous model pack, thresholds, adapter state, and
  reference compatibility metadata.
- Failed or cancelled training leaves no loadable partial model.

## User-Facing Distinctions

- Calibrated scoring: adjusts thresholds/probabilities from reviewed decisions;
  no recognizer weights are changed.
- Local adapter learning: learns a small reversible scoring head over frozen
  embeddings; no detector or recognizer weights are changed.
- True model retraining: creates derivative recognizer weights from biometric
  data; requires separate consent, governance review, benchmark proof, signing,
  and rollback.

# Vintrace Self-Learning Loop Plan

Generated: 2026-06-16

Status: planning document for phased implementation. Future agents should update
the checkboxes and add evidence links as work lands.

Latest implementation note:

- 2026-06-16: Phase 0/2 persistence foundation started. Added
  `training_examples` and `learned_artifacts` SQLite tables, review-status
  ingestion for accepted/rejected decisions, bulk-review ingestion,
  false-match-block ingestion, privacy/delete/retention counts, and
  `tests/learning_loop_units.py`.
- 2026-06-16: Phase 1 calibration autopilot backend started. Added staged
  calibration artifacts, promotion, rollback, API commands, MCP tools, static MCP
  manifest entries, audit events, and focused stage/promote/rollback tests.
- 2026-06-16: Phase 1 Accuracy Lab surface added. Users can refresh learning
  status, stage reviewed feedback, promote a staged calibration, roll back a
  promoted calibration, and inspect artifact hash/count/status details in the UI.
- 2026-06-16: Phase 2 training-example portability started. Added metadata-only
  training-example export/import commands, MCP tools, Accuracy Lab controls,
  redaction tests, and promotion-audit-content coverage.
- 2026-06-16: Phase 1 learning job added. `run_learning_jobs` now performs a
  consent-gated, idempotent auto-stage check for calibration artifacts and never
  promotes learned changes automatically.
- 2026-06-18: Phase 3 reference-promotion loop started. Added staged
  `suggested_reference` artifacts, suitability checks, explicit approval into
  saved references, rejection, People UI controls, API/MCP tools, stale-suggestion
  cleanup, and backup/restore coverage.
- 2026-06-18: Phase 2 migration coverage added for legacy `training_examples`
  and `learned_artifacts` tables missing newer columns.
- 2026-06-18: Phase 4 embedding-adapter loop implemented. Added JSON logistic
  adapter training, held-out validation metrics, staged/promoted/rollback
  artifacts, API/MCP/UI controls, live promoted-adapter scoring fallback, consent
  and workspace-lock guards, and support-bundle redaction tests.
- 2026-06-18: Learning mode setting added and persisted. Initial production modes
  are Off, Manual suggestions, and Auto-stage after validation; Auto-promote
  remains intentionally unavailable.
- 2026-06-18: ONNX Runtime training and backbone fine-tuning R&D explicitly
  deferred pending real adapter validation wins and legal/privacy review.
- 2026-06-18: Learning-loop E2E and benchmark evidence added. Playwright now
  proves staged calibration display, promotion, rollback, suggested-reference
  approval, and learning-mode persistence across app relaunch. Benchmarks now
  report synthetic calibration before/after, public dataset label
  current/recommended metrics, and adapter scoring overhead.
- 2026-06-18: Learned-artifact encryption decision recorded. Live workspace
  encryption is deferred to a storage-layer design; encrypted backups remain
  supported separately.
- 2026-06-18: Phase 5 ONNX-training feasibility scaffold added behind
  `VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1`. Current host has `onnxruntime` and
  `onnx`, but not `onnxruntime.training`, so true artifact generation remains
  blocked.
- 2026-06-18: Phase 6 backbone fine-tuning governance prerequisites drafted:
  biometric-training consent scope, dataset requirements, fairness plan,
  poisoning/overfitting mitigations, provenance/signing plan, offline rollback,
  and user-facing distinctions. Legal review and target GPU/runtime study remain
  external prerequisites.
- 2026-06-18: Phase 5 ONNX-training prototype path expanded. Added a valid
  forward-only ONNX scoring-head builder, optional ORT artifact generation call,
  optional `onnxruntime.training.api` training/export runner, artifact
  hash/size inventory, JSON-adapter baseline comparison, and adverse tests with
  fake ORT training APIs. Real artifact generation remains blocked locally
  because `onnxruntime.training` is not importable.
- 2026-06-18: Phase 5 artifact lifecycle added. Experimental ONNX artifact
  bundles now get a tamper-evident manifest with per-artifact hashes, manifest
  hash verification, a rollbackable active pointer, and adverse tests for
  tampering, invalid promotion, promotion, and rollback.
- 2026-06-18: Phase 6 fail-closed governance/runtime gates added for true
  backbone fine-tuning R&D. Legal review and target runtime studies now have
  machine-readable JSON gates that block missing, malformed, incomplete, or
  non-approved evidence; tests cover both blocked and synthetic-ready paths.
- 2026-06-18: Phase 6 evidence templates and stricter legal scope added. Legal
  approval must now include jurisdiction, model-family/license evidence,
  biometric data categories, consent policy, retention, withdrawal, and
  export/backup policy fields; blank templates are generated as blocked evidence
  for external reviewers.
- 2026-06-18: Backbone readiness reports are now tamper-evident. Legal/runtime
  evidence and prerequisite docs are hashed into the report, and the verifier
  detects report edits or source-evidence changes after generation.
- 2026-06-18: Phase 5/6 evidence bridge added. `bench:onnx-training` writes a
  local ONNX-training measurement report and a Phase-6-compatible target runtime
  study fragment so target machines can contribute measured evidence without
  custom scripts.
- 2026-06-18: Phase 5 go/no-go decision gate added. The gate requires verified
  training artifacts, complete target runtime/package evidence, available
  training packages on every target, and a measurable validation gain over the
  JSON adapter. Missing evidence produces a no-go report.
- 2026-06-18: Unified self-learning R&D audit added. `bench:self-learning-audit`
  writes Phase 5/6 evidence plus `self_learning_rd_audit.json`, with per-item
  satisfied/blocked/missing statuses and tamper detection for source reports.
- 2026-06-18: Phase 5 decision reports now hash source evidence files, and the
  unified audit CLI can run in `--audit-only` mode against externally supplied
  Phase 5 decision and Phase 6 readiness reports.
- 2026-06-18: Phase 5 decision reports and Phase 6 readiness reports now have
  semantic consistency checks. Recomputed hashes cannot hide contradictory
  `ok`, `status`, blocker, or sub-gate fields.
- 2026-06-18: Phase 5/6 source-summary binding hardened. Decision/readiness
  verifiers now recompute artifact, validation, legal-review, and runtime source
  summaries so a hash-valid report cannot overclaim what unchanged evidence
  files prove.
- 2026-06-18: Unified self-learning audit reports now have their own semantic
  consistency checks. Recomputed audit hashes cannot hide contradictory
  requirement rows, blocker lists, source-report status, or production-scope
  claims.
- 2026-06-18: Unified audit source binding hardened. Audit verification now
  rebuilds the expected requirement rows from the file-backed Phase 5/6 reports
  named in `evidenceFiles`, so a hash-valid audit cannot wrap blocked source
  reports as satisfied checklist evidence.
- 2026-06-18: Plan-to-audit consistency checks added. The remaining unchecked
  markdown checklist rows now map to audit requirement IDs, and CI rejects
  premature or stale checklist edits.
- 2026-06-18: Plan consistency now treats semantically invalid audit payloads as
  non-authoritative. Forged `requirements[].ok` rows cannot make unchecked Phase
  5/6 checklist items look satisfied.
- 2026-06-18: Plan consistency now reports missing, malformed, unreadable, or
  non-object audit files as `plan-audit-invalid:*` blockers instead of silently
  falling back to the default blocked audit.
- 2026-06-18: Release posture guard added. `release_readiness` and
  `npm run release:check` now include self-learning R&D checks that permit
  documented blocked R&D, but fail if the plan, audit semantics, or
  non-production authorization claim drift.
- 2026-06-18: Release posture now uses the same audit source loader as plan
  consistency, so invalid JSON, missing audit files, and OS-level read errors
  fail with matching semantic errors and plan blockers.
- 2026-06-18: Phase 5/6 source readers now fail closed on OS-level read errors.
  Runtime-study, validation, legal-review, and governance runtime paths that are
  unreadable or accidentally point at directories become named blockers instead
  of crashing evidence generation.
- 2026-06-18: Phase 6 governance CLI can now consume completed external
  evidence with `--legal-review`, `--runtime-study`, and repeated
  `--prerequisite-doc` arguments, writing a hashed readiness report instead of
  only blank templates. User reported legal review is complete; checklist
  satisfaction still requires machine-readable legal evidence.
- 2026-06-18: Additional Phase 5 wheel probes found no cp311
  `onnxruntime-training` distribution for macOS arm64 or macOS x64. A Linux x64
  cp311 wheel resolves, but full package/runtime measurement still requires a
  Linux target run.
- 2026-06-18: Mac CPU ONNX-training side env proved feasible with Python 3.11,
  `onnxruntime-training-cpu==1.19.2`, and `torch==2.12.1`. Real
  `onnxruntime.training` artifact generation and the tiny
  `onnxruntime.training.api` training/export job now pass on macOS arm64 after
  normalizing generated ONNX artifacts to IR version 10 for ORT 1.19.2.
- 2026-06-18: Phase 5 measurement reports now include a real tiny
  training/export job when artifacts generate successfully. Target runtime
  evidence only counts `trainingRuntimeAvailable` when both artifact generation
  and the training/export job complete.
- 2026-06-18: `bench:onnx-training` can now accept explicit `--training-rows`
  and `--validation-rows` JSON files. It trains an ONNX scoring head from the
  training rows, scores the held-out rows through the exported inference model,
  writes `phase5_onnx_training_validation.json`, and feeds that report into the
  go/no-go decision without relaxing the measurable-gain gate.
- 2026-06-18: Phase 5 target-matrix collection workflow added. Manual GitHub
  Actions now collects ONNX training evidence on Linux x64, Windows x64, macOS
  arm64, and macOS x64, uploads per-target evidence bundles, and writes a
  combined runtime study plus source-bound Phase 5 decision report.
- 2026-06-19: ONNX Training Matrix run `27802462328` passed on all four targets
  (`macos-arm64`, `macos-x64`, `windows-x64`, `linux-x64`). The combined runtime
  study is complete with no missing targets or source errors. The combined Phase
  5 decision remains `no-go` only because validation evidence is still missing.
- 2026-06-19: Phase 5 reviewed-row splitter added. The ONNX harness can now turn
  the app's metadata-only reviewed training-example export into deterministic
  `training-rows.json` and `validation-rows.json` files with class-balance gates,
  model scoping, path/vector scrubbing, and a hashed split manifest.

## How To Use This Document

- Treat this file as the source of truth for the self-learning loop rollout.
- Check off items only after code, tests, and audit/governance hooks are complete.
- Add a short evidence note under the relevant phase with file paths, commands run,
  and any validation results.
- Do not skip validation gates for adaptive matching changes.
- Do not train from unreviewed model guesses. Only human-reviewed labels may enter
  the learning set.

## Current Verdict

Vintrace can support a self-learning loop, but the first production version should
not retrain the face-recognition backbone. The feasible path is a local
frozen-backbone learning loop:

- Learn thresholds and probabilities from accepted/rejected review decisions.
- Learn per-person score calibration where enough labels exist.
- Promote high-quality accepted matches into suggested references.
- Train small local adapters over embeddings after held-out validation.
- Keep the underlying detector/recognizer weights fixed unless a later R&D phase
  proves full retraining is worth the operational, legal, and safety cost.

Full backbone retraining is technically possible in the broader ONNX Runtime
ecosystem, but it is not a drop-in change for this app. The current app is an
inference-first ONNX/InsightFace desktop app and does not ship a training runtime
such as `onnxruntime.training`, PyTorch, or TensorFlow.

## Existing Foundation

- [x] Review decisions become calibration labels.
  - Code: `crossage_fr/enroll/manager.py::set_candidate_status`
- [x] Global score calibration exists.
  - Code: `crossage_fr/enroll/manager.py::apply_calibration_to_config`
  - Code: `crossage_fr/match/calibration.py`
- [x] Per-person calibration exists.
  - Code: `crossage_fr/enroll/manager.py::apply_personalized_calibration`
- [x] Held-out validation gate exists.
  - Code: `crossage_fr/match/validation.py`
- [x] Public benchmark and model-pack comparison exist.
  - Code: `crossage_fr/benchmarks/public_dataset.py`
  - Latest report: `benchmarks/results/public-dataset-benchmark-latest.md`
- [x] Model switching and backfill exist.
  - Code: `crossage_fr/model_manager.py`
  - Code: `crossage_fr/api_server.py::_cmd_backfill_model_references`
- [x] Consent, retention, privacy report, and audit log infrastructure exist.
  - Code: `crossage_fr/enroll/manager.py`
  - Code: `crossage_fr/store/workspace_db.py`

## Non-Goals For Initial Production Loop

- Do not fine-tune ArcFace/InsightFace backbone weights in the first production
  loop.
- Do not use public benchmark datasets as app training data.
- Do not learn from pending candidates, high-confidence guesses, clusters, or
  auto-suggested matches unless a human confirms them.
- Do not silently apply learned changes without a validation result, audit event,
  and rollback path.
- Do not mix labels across incompatible recognizer/model-pack embedding spaces.

## Hard Gates

Every adaptive change must satisfy these gates before promotion:

- [x] Consent is active for the workspace and, if enabled, for the subject.
- [x] Training examples are derived from accepted/rejected human review only.
- [x] Training data is scoped to one recognizer/model pack or explicitly modeled
  as multi-model score fusion.
- [x] The change is evaluated against a held-out validation split.
- [x] Metrics include precision, recall, false match rate, false reject rate,
  and per-person or per-cohort regressions where applicable.
- [x] The candidate artifact beats the baseline or is staged as advisory only.
- [x] The old artifact/config can be restored.
- [x] Audit log records the training input counts, model version, artifact hash,
  validation metrics, operator action, and promotion decision.
- [x] Delete/retention flows delete or expire learned artifacts and training
  examples consistently with existing face data.

## Phase 0 - Design Lock And Data Contract

Goal: define exactly what can be learned, persisted, validated, and deleted.

- [x] Write a short architecture note for the learning loop.
- [x] Define `training_examples` schema.
- [x] Define `learned_artifacts` schema.
- [x] Decide whether candidate embeddings are stored directly or reconstructed
  through the existing embedding cache.
- [x] Define model/artifact version keys:
  - recognizer/model pack
  - detector size
  - scoring version
  - calibration version
  - adapter type
  - training data hash
- [x] Define artifact states:
  - `candidate`
  - `staged`
  - `promoted`
  - `rejected`
  - `rolled_back`
- [x] Add a migration plan for existing calibration labels that lack vectors.
- [x] Add UI copy and settings mode names:
  - Off
  - Manual suggestions
  - Auto-stage after validation
  - Auto-promote after validation, if enabled later

Definition of done:

- [x] Data contract reviewed in code comments and tests.
- [x] No storage change is implemented without delete/retention behavior.
- [x] No training path can read unconsented media.

Evidence:

- Architecture/data-contract note: `docs/2026-self-learning-loop-architecture.md`.
- Added storage schema and helpers in `crossage_fr/store/workspace_db.py`.
- Candidate embeddings are represented by cache keys for now:
  `sha256:<hash>|model:<model>|detector:<size>`.
- Learned artifacts are JSON payloads with deterministic SHA-256 hashes.
- Learning mutation paths now require consent and refuse active workspace locks:
  `ProjectState._require_learning_consent`.
- Added persisted settings mode names and UI control for Off, Manual suggestions,
  and Auto-stage after validation. Auto-promote remains intentionally unavailable
  for the initial release.
- Focused verification: `npm run test:learning-loop`.

## Phase 1 - Calibration Autopilot

Goal: make the existing calibration loop self-learning in a guarded way.

- [x] Add a learning job that detects when enough new labels exist.
- [x] Stage a new global Platt calibrator and FMR-targeted thresholds.
- [x] Reuse `held_out_gate` before promotion.
- [x] Add `learned_artifacts` row for the staged calibration.
- [x] Add rollback to the previous threshold/calibrator config.
- [x] Add audit event for:
  - labels used
  - label class balance
  - model name
  - old thresholds
  - new thresholds
  - validation result
  - promoted/rejected status
- [x] Add UI surface in Accuracy Lab:
  - "New feedback available"
  - "Stage calibration"
  - "Apply learned calibration"
  - "Rollback"
- [x] Add MCP/API commands for staged calibration inspection and promotion.
- [x] Add tests for insufficient labels, held-out regression, promotion, rollback,
  stale model-pack rejection, and audit contents.

Suggested minimums:

- Global calibration: at least 20 labels, at least 5 per class. Current code
  already uses these minimums.
- Auto-stage: at least 10 new labels since last promoted calibration.
- Auto-promote: keep manual-only until field validation proves the loop is stable.

Definition of done:

- [x] Existing `apply_calibration_to_config` behavior remains available.
- [x] New autopilot never promotes a regression.
- [x] User can inspect and roll back learned calibration.

Evidence:

- Added backend methods in `crossage_fr/enroll/manager.py`:
  `calibration_learning_status`, `stage_calibration_update`,
  `run_learning_jobs`, `promote_calibration_artifact`, and
  `rollback_calibration_artifact`.
- Added API commands in `crossage_fr/api_server.py`:
  `calibration_learning_status`, `run_learning_jobs`, `stage_calibration`,
  `promote_calibration`, and `rollback_calibration`.
- Added MCP tools and manifest entries for the same staged calibration workflow.
- `calibration_learning_status` reports readiness, consent state, current
  training-data hash, latest artifact hash/count, and new-label count.
- `run_learning_jobs` refuses to create artifacts without active workspace
  consent when consent is required, avoids duplicate artifacts for the same
  training-data hash, and requires at least 10 new labels after the latest
  calibration artifact before auto-staging again.
- Existing direct `apply_calibration_to_config` now shares the same candidate
  builder as staged artifacts.
- Added Accuracy Lab controls in `src/App.tsx` for status refresh, staging,
  learning-check auto-stage, learned-calibration promotion, rollback, artifact
  hash/count inspection, readiness display, and command contract assertions in
  `tests/edge_cases.py`.
- Tests currently cover stage, promote, rollback, staged insufficient labels,
  staged held-out-regression rejection, stale model scoping, learning-job consent
  refusal, idempotent no-op on unchanged labels, new-label minimums, stage audit
  content, promotion audit content, and renderer interaction for the
  learned-calibration controls.
- Focused verification:
  `npm run build`,
  `npm run test:learning-loop`,
  `npm run test:calibration`,
  `npm run test:command-contract`,
  `npm run test:mcp`,
  `npm run test:edge`,
  `npm run test:e2e`.

## Phase 2 - Persistent Training Examples

Goal: persist enough reviewed examples for adapters and future learning without
misusing pending candidates.

- [x] Add `training_examples` table.
- [x] On accept/reject, persist a training example with:
  - label id
  - candidate id
  - source path
  - source hash
  - expected person
  - actual person
  - is match
  - match score
  - raw cosine
  - candidate embedding or embedding cache key
  - best reference id
  - best reference embedding or key
  - model name
  - detector/scoring version
  - quality
  - pose bucket
  - alignment error
  - inter-eye distance
  - age gap fields
  - created at
- [x] Add dedupe rules by candidate id, with
  `(source_hash, expected_person, model_name, label)` fallback for rows without a
  candidate id.
- [x] Add export/import for training examples without raw media by default.
- [x] Add privacy report counts and sizes.
- [x] Extend `delete_face_data` to clear examples and learned artifacts.
- [x] Extend retention purge to remove expired reviewed examples, preserving audit.
- [x] Add tests for schema migration, persistence, dedupe, delete, retention, and
  export redaction.

Definition of done:

- [x] Accepted/rejected reviews create stable learning examples.
- [x] Rejected false matches preserve the negative pair signal.
- [x] Delete/retention behavior is covered by tests.

Evidence:

- `ProjectState.set_candidate_status`, `bulk_set_candidate_status`, and
  `block_false_match` now create/update current training examples for
  accepted/rejected decisions.
- Reverting a candidate to `pending` or `uncertain` removes that candidate's
  active training example.
- Retention purge removes training examples for purged reviewed candidates.
- `delete_face_data` clears `training_examples` and `learned_artifacts`.
- Added `export_training_examples` / `import_training_examples` API and MCP
  commands. Default export excludes local paths, media files, thumbnails, face
  vectors, model files, and raw payload JSON; `includePaths` is opt-in.
- Added Accuracy Lab controls for metadata-only export and JSON import in
  `src/App.tsx`.
- Focused tests now cover persistence, dedupe-by-current-review behavior, delete,
  retention, metadata-only export redaction, import, and old-schema migration for
  learning columns.
- Focused verification: `npm run test:learning-loop`.

## Phase 3 - Reference Promotion Loop

Goal: let high-quality accepted matches improve future matching by becoming
operator-approved reference suggestions.

- [x] Add "suggested reference" artifact type.
- [x] Score accepted candidates for reference suitability:
  - high quality
  - good alignment
  - sufficient inter-eye distance
  - not a duplicate of existing reference
  - not an embedding outlier for that person
  - compatible model pack
- [x] Add UI suggestions in the person/reference area.
- [x] Require explicit operator approval before adding a suggested reference.
- [x] Add reference provenance:
  - accepted candidate id
  - promotion time
  - operator
  - source hash
  - model name
  - quality metrics
- [x] Rebuild affected person vector index after promotion.
- [x] Add audit event for suggestion and approval.
- [x] Add tests for duplicate suppression, outlier rejection, model mismatch,
  approval flow, index rebuild, delete person, and backup/restore.

Definition of done:

- [x] Accepted matches can improve future recall without model retraining.
- [x] No automatic reference promotion occurs without explicit approval.
- [x] Suggestions are explainable and reversible.

Evidence:

- Added backend methods in `crossage_fr/enroll/manager.py`:
  `stage_reference_suggestions`, `approve_reference_suggestion`,
  `reject_reference_suggestion`, and `reference_suggestion_status`.
- Suggested-reference artifacts reuse `learned_artifacts` with deterministic
  hashes and JSON payloads. Payloads carry candidate id, person, source hash,
  model, score, quality, pose, and version; they do not store vectors or raw
  media.
- Approval re-embeds the accepted candidate through the active engine and
  rechecks duplicate source hash, duplicate cosine, outlier cosine, quality,
  alignment, inter-eye distance, consent, and model compatibility before adding a
  `ReferenceFace`.
- Added API/MCP commands:
  `reference_suggestion_status`, `stage_reference_suggestions`,
  `approve_reference_suggestion`, and `reject_reference_suggestion`.
- Added People-area UI in `src/App.tsx` for finding, approving, and rejecting
  staged reference suggestions.
- Candidate clear/purge and delete-person flows clean up stale staged
  suggested-reference artifacts.
- Focused tests cover good-path approval, duplicate suppression, outlier
  rejection, model mismatch rejection, vector-index update, delete-person cleanup,
  and backup/restore artifact persistence.
- Focused verification:
  `npm run build`,
  `npm run test:learning-loop`,
  `npm run test:command-contract`,
  `npm run test:mcp`,
  `npm run test:edge`,
  `npm run test:backup-roundtrip`,
  `npm run test:e2e`.

## Phase 4 - Embedding Adapter Loop

Goal: add the first true local learning layer over frozen embeddings.

Recommended first adapter:

- Use a small `sklearn` logistic regression or linear model over pair features.
- Do not train a neural backbone.
- Features can include:
  - raw cosine
  - fused score
  - score margin to runner-up
  - candidate quality
  - reference quality
  - alignment error
  - inter-eye distance
  - pose bucket one-hot
  - age-gap bucket
  - same-era support score
  - AS-norm/cohort-normalized score, if available

Checklist:

- [x] Add `crossage_fr/match/adapters.py`.
- [x] Implement a pure-Python adapter interface:
  - `fit(rows) -> artifact`
  - `score(row, artifact) -> float`
  - `serialize(artifact) -> dict`
  - `deserialize(dict) -> artifact`
- [x] Start with logistic regression using existing dependencies.
- [x] Store artifact as JSON plus hash, not pickle.
- [x] Add validation through `held_out_gate`.
- [x] Add staged artifact UI and API.
- [x] Apply adapter only when:
  - model name matches
  - artifact is promoted
  - feature version matches
  - validation did not regress
- [x] Fall back to current scoring when adapter is absent or stale.
- [x] Add tests for feature extraction, deterministic training, serialization,
  held-out rejection, promotion, stale model mismatch, and runtime fallback.

Suggested minimums:

- Global adapter: at least 100 reviewed examples, at least 25 per class.
- Per-person adapter: at least 30 examples for that person, at least 10 per class.
- Initial release should stage only, then require manual promotion.

Definition of done:

- [x] A learned adapter can improve scoring while the face recognizer remains
  frozen.
- [x] Adapter artifacts are transparent, JSON-serializable, versioned, validated,
  and auditable.

Evidence:

- Added `crossage_fr/match/adapters.py` with feature extraction,
  `fit`/`score`/`serialize`/`deserialize`, deterministic logistic training, JSON
  artifacts, and feature/version constants.
- Added backend lifecycle methods in `crossage_fr/enroll/manager.py`:
  `embedding_adapter_learning_status`, `stage_embedding_adapter`,
  `promote_embedding_adapter`, `rollback_embedding_adapter`, and
  `embedding_adapter_score`.
- Live scan scoring applies the promoted adapter only when the artifact is
  promoted, the model name matches, the feature version deserializes, and scoring
  succeeds; otherwise the current `group_hits` score is used unchanged.
- Added API commands, MCP tools, desktop allowlist entries, and manifest entries:
  `embedding_adapter_status`, `stage_embedding_adapter`,
  `promote_embedding_adapter`, and `rollback_embedding_adapter`.
- Added Accuracy Lab controls in `src/App.tsx` for adapter status, staging,
  promotion, rollback, artifact hash/count display, readiness, and validation
  delta.
- Focused tests cover feature extraction, deterministic training, JSON
  serialization, held-out regression rejection, promotion, rollback, stale model
  mismatch, runtime fallback, consent blocking, and workspace-lock blocking.
- Focused verification:
  `npm run build`,
  `npm run test:validation`,
  `npm run test:calibration`,
  `npm run test:learning-loop`,
  `npm run test:command-contract`,
  `npm run test:mcp`,
  `npm run test:edge`.

## Phase 5 - Optional ONNX Runtime Training Prototype

Goal: evaluate whether ONNX Runtime on-device training adds enough benefit to
justify the package/runtime complexity.

Do this only after Phase 4 has real validation wins.

- [x] Create a separate experimental branch or feature flag.
- [x] Add dependency feasibility matrix:
  - macOS arm64
  - macOS x64
  - Windows x64
  - Linux x64, if supported
- [x] Prototype offline artifact generation for a tiny scoring head, not the
  face backbone.
- [ ] Generate required ORT training artifacts:
  - training ONNX model
  - checkpoint state
  - optimizer ONNX model
  - eval ONNX model
- [x] Add local training job using `onnxruntime.training.api`.
- [x] Export inference-ready ONNX artifact after training.
- [x] Validate against the Phase 4 JSON adapter baseline.
- [ ] Measure runtime, disk usage, package size, and failure modes.
- [x] Decide whether the complexity beats the sklearn adapter.

Definition of done:

- [ ] Prototype proves a measurable gain over the simpler adapter.
- [ ] Packaging impact is understood.
- [x] Training artifacts have integrity hashes and rollback.

Evidence:

- Feature flag and probe: `crossage_fr/experiments/onnx_training.py`.
- Test: `tests/onnx_training_feasibility.py`.
- Matrix: `docs/2026-onnx-training-feasibility-matrix.md`.
- Current app-env blocker: `onnxruntime.training` is not importable in the
  Python 3.13 app env.
- Mac side-env result: `onnxruntime.training` imports and real artifact
  generation/training/export passes in `.venv-ort311` using Python 3.11,
  `onnxruntime-training-cpu`, and `torch`.
- Package probe: `node desktop/scripts/run-python.cjs -m pip index versions
  onnxruntime-training` returned `No matching distribution found for
  onnxruntime-training` on the current macOS arm64 environment.
- Package probe: `onnxruntime-training-cpu` resolves for cp311 macOS universal2
  and exposes `onnxruntime.training` after installing `torch`.
- Current decision: the ONNX training path does not beat the JSON/sklearn
  adapter for production today because the side-env package impact is large, the
  target matrix remains incomplete, and no real ORT-trained head has shown a
  validation gain.
- Fake-ORT adverse tests verify artifact-generation arguments, local
  `CheckpointState`/`Module`/`Optimizer` training/export wiring, missing
  artifact failures, label-shape failures, and JSON-adapter baseline regression
  rejection.
- Artifact lifecycle tests verify manifest hashes, per-artifact hashes including
  checkpoint directories, tamper detection, invalid-promotion rejection,
  promotion, portable bundle-relative paths, path-traversal rejection,
  active-pointer hash verification, pointer tamper rejection, pointer/manifest
  mismatch rejection, invalid JSON rejection, canonical required-kind
  enforcement, missing-required-list consistency, and rollback.
- Measurement helper: `phase5_measurement_report()` records forward-model build
  time/size/hash, package footprint, artifact-generation status, tiny
  training/export status, blockers, and current failure modes.
- Row-trained validation helper: `bench:onnx-training --training-rows <json>
  --validation-rows <json>` writes a file-backed validation report from exported
  ONNX inference scores so Phase 5 can use real held-out reviewed rows instead
  of synthetic score fixtures.
- Reviewed-row splitter: `python -m crossage_fr.experiments.onnx_training
  --split-training-examples <vintrace-training-examples.json> <output-dir>`
  writes `training-rows.json`, `validation-rows.json`, and
  `phase5_onnx_training_row_split_manifest.json` from the existing app
  metadata-only training-example export.
- Synthetic row-validation smoke evidence on 2026-06-18 produced a valid
  validation report with JSON adapter accuracy/precision/recall all `1.0` and
  ONNX head accuracy/precision/recall all `1.0`. The Phase 5 decision correctly
  remained `no-go` because the measured delta was `0.0` and therefore did not
  satisfy the measurable-gain gate.
- Reviewed-export splitter smoke evidence on 2026-06-19 used an 80-row synthetic
  app training-example export, produced 60 training rows and 20 held-out
  validation rows with balanced positive/negative classes, removed local
  path/vector fields, and fed the split files into the ONNX row-validation bench.
  The validation report completed, but the Phase 5 decision correctly remained
  `no-go` because the synthetic ONNX/JSON delta was still `0.0`.
- ONNX artifact compatibility: the tiny forward model and generated training
  artifacts are normalized to ONNX IR version 10 when needed so
  `onnxruntime-training-cpu==1.19.2` can load artifacts generated with newer
  `onnx` packages.
- Evidence writer: `write_phase5_measurement_bundle()` and
  `npm run bench:onnx-training` write `phase5_onnx_training_measurement.json`
  plus `phase5_runtime_study_fragment.json`.
- Multi-target combiner: `combine_target_runtime_studies()` and
  `write_combined_target_runtime_study()` merge target-machine fragments into
  the JSON schema consumed by the Phase 6 `runtime_feasibility_gate`.
- Matrix collector: `.github/workflows/onnx-training-matrix.yml` runs the Phase
  5 measurement on `ubuntu-latest`, `windows-latest`, `macos-26`, and
  `macos-26-intel`, then uploads target evidence and
  `phase5_combined_runtime_study.json`.
- Matrix evidence from GitHub Actions run `27802462328`:
  - `macos-arm64`: pass, 14 ms training duration, 591,665,508 byte package
    footprint, CoreML + CPU providers.
  - `macos-x64`: pass, 26 ms training duration, 739,657,692 byte package
    footprint, CoreML + CPU providers.
  - `windows-x64`: pass, 50 ms training duration, 648,195,711 byte package
    footprint, CPU provider.
  - `linux-x64`: pass, 17 ms training duration, 1,327,049,623 byte package
    footprint, CPU provider.
- CLI combiner: `python -m crossage_fr.experiments.onnx_training
  --combine-runtime-study <combined.json> <fragment...>` writes a hash-bound
  combined runtime study from downloaded target fragments.
- Combined target runtime studies now include a report hash and source-fragment
  hashes. `verify_combined_target_runtime_study()` rejects memory-only complete
  studies, changed source fragments, edited combined studies, duplicate targets,
  combined rows that diverge from their source fragments, inconsistent
  missing-target lists, and invalid scope/status claims before a Phase 5
  go/no-go report can treat runtime evidence as complete.
- Phase 5 runtime fragments also record selected ONNX providers, primary
  provider, performance tier, and an explicit per-target `gpuAvailable` boolean
  so Phase 6 feasibility can distinguish CPU-only evidence from missing GPU
  evidence.
- Phase 5 decision reports preserve per-target runtime evidence fields from the
  source study, including `trainingRuntimeAvailable`, provider details,
  `gpuAvailable`, package size, duration, and failure modes. The verifier and
  unified audit reject recomputed `go` reports that drop those fields.
- Go/no-go gate: `phase5_go_no_go_report()` and
  `write_phase5_go_no_go_report()` fail closed unless verified artifacts,
  target runtime/package evidence, and a measurable validation gain are all
  present. `npm run bench:onnx-training` writes
  `phase5_onnx_training_decision.json`, which is currently `no-go` on this host.
- Decision reports now include `reportHash`, and
  `verify_phase5_go_no_go_report()` detects report edits before the unified
  self-learning audit will accept Phase 5 evidence.
- Decision reports also hash their source evidence files when file-backed
  artifact manifests, runtime studies, or validation reports are supplied. The
  verifier rejects changed source evidence with
  `phase5-evidence-file-mismatch:<kind>`.
- Go decisions must be file-backed for artifact, runtime, and validation
  evidence unless validation is embedded in the verified artifact manifest. The
  verifier rejects in-memory go evidence and recomputed inconsistent reports.
- Phase 5 decision verification now recomputes file-backed artifact-manifest,
  runtime-study, and validation summaries and compares them to the embedded
  decision rows. Manifest-embedded validation must itself be a hashed
  `phase5-onnx-training-validation` report; a bare `status: pass`/delta claim in
  a valid manifest does not satisfy measurable-gain evidence.
- Phase 5 validation evidence now has its own
  `phase5-onnx-training-validation` report hash and semantic verifier. The
  verifier rejects invalid counts, class-balance claims, metric/delta
  mismatches, non-finite or out-of-range metrics, status drift,
  validation-file tampering, and go/no-go reports whose claimed validation gain
  does not match the validation report.
- Phase 5 measurable-gain evidence now fails closed on metric tradeoffs: at
  least one of accuracy/precision/recall must clear the configured gain floor and
  none of those core metrics may regress below the JSON adapter baseline.
- Phase 5 runtime-study and validation source paths now report
  `runtime-study-unreadable:*` / `validation-unreadable:*` blockers for OS read
  failures, including accidental directory paths.
- Combined Phase 5 runtime studies now preserve unreadable/missing/invalid
  fragment files as `sourceErrors` in an incomplete, hash-verifiable report.
  Phase 5 go/no-go decisions treat those source errors as runtime blockers
  instead of crashing or silently ignoring a bad fragment.
- Public Phase 5/6/self-learning report verifiers now treat malformed UTF-8
  bytes as `*-invalid-json` and OS read failures as `*-unreadable:*`, so corrupt
  evidence files produce structured blockers instead of uncaught decoder errors.
- Phase 5 runtime studies, validation reports, decision reports, artifact
  manifests, active pointers, Phase 6 readiness reports, and unified
  self-learning audits now reject far-future machine timestamps even when the
  report hash is recomputed, so evidence cannot be post-dated into readiness.
- Phase 5/6 runtime target rows now require positive, non-future measurement
  timestamps, unique known targets, and source-error-free complete runtime
  studies before Phase 5 go/no-go, Phase 6 readiness, or the unified audit can
  treat runtime/package evidence as satisfied.
- Phase 5/6 runtime target evidence now rejects blank provider/failure-mode
  lists and explicit target-level blockers, so a recomputed report cannot count a
  row as measured while hiding incomplete runtime observations inside optional
  fields.
- Local package footprint measured for installed dependencies:
  `onnxruntime` 69.48 MB, `onnx` 38.22 MB, `numpy` 29.62 MB,
  `scikit-learn` 43.09 MB.
- Mac CPU side-env package footprint measured:
  `onnxruntime-training-cpu` 77.47 MB, `torch` 411.85 MB, `onnx` 42.08 MB,
  `numpy` 32.81 MB.

## Phase 6 - Backbone Fine-Tuning R&D Only

Goal: decide whether true detector/recognizer retraining is ever worth shipping.

This is not recommended for the production loop until all earlier phases are
complete and measured.

Required before any implementation:

- [ ] Legal review for derivative weights and model licenses.
- [x] Written policy for biometric training and consent scope.
- [x] Dedicated training dataset requirements.
- [ ] GPU/runtime feasibility study.
- [x] Bias/fairness evaluation plan.
- [x] Poisoning and overfitting mitigation plan.
- [x] Full model provenance and signing plan.
- [x] Offline training and rollback strategy.
- [x] Clear user-facing distinction between:
  - calibrated scoring
  - local adapter learning
  - true model retraining

Why this is risky:

- Existing InsightFace model packs have separate model-weight licensing from the
  MIT-licensed code.
- A fine-tuned recognizer artifact may be a derivative model.
- Small personal libraries are label-scarce and self-correlated.
- Full fine-tuning can overfit, amplify mistakes, and degrade unseen identities.
- Training infrastructure would substantially expand package size and failure
  surface.

Definition of done:

- [x] R&D decision recorded.
- [x] Either explicitly deferred or split into a separate governed project.

Evidence:

- R&D deferral recorded in `docs/2026-model-retraining-rd-decision.md`.
- Governance prerequisite draft recorded in
  `docs/2026-backbone-finetuning-governance-prereqs.md`.
- Fail-closed governance gates:
  `crossage_fr/experiments/retraining_governance.py`.
- Evidence templates: `npm run bench:retraining-governance -- <output-folder>`
  writes blocked-by-default legal-review/runtime-study JSON templates and a
  hashed readiness report.
- Evidence handoff: after external evidence exists, run
  `npm run bench:retraining-governance -- <output-folder> --legal-review <legal.json> --runtime-study <runtime.json> --prerequisite-doc <doc.md>`
  to write a source-bound readiness report from the completed files. Repeat
  `--prerequisite-doc` for each required document.
- Readiness reports: `write_backbone_readiness_report()` records evidence
  SHA-256 hashes, and `verify_backbone_readiness_report()` detects report or
  source-evidence tampering.
- Readiness report verification also checks schema version, R&D-only scope,
  `ok`/`status` consistency, blocker consistency, legal/runtime sub-gate
  consistency, prerequisite-doc existence, and file-backed evidence for ready
  reports.
- Runtime feasibility and readiness verification require every target row to
  include an explicit boolean `gpuAvailable` value. CPU-only targets may record
  `false`, but omitted GPU evidence blocks `runtime_feasibility_gate()` and
  fails `verify_backbone_readiness_report()` even if the report hash is
  recomputed.
- Readiness verification now recomputes legal-review and runtime-study source
  gates and compares their summaries to the embedded readiness report. A
  recomputed report hash cannot turn unchanged blocked legal/runtime source
  evidence into `ready-for-r-and-d`.
- Phase 6 legal-review and runtime-study gates now report
  `legal-review-unreadable:*` / `runtime-study-unreadable:*` blockers for OS read
  failures, including accidental directory paths.
- Phase 6 legal-review scope now rejects placeholder arrays, blank model/category
  entries, license rows for undeclared model families, and declared model
  families without an approved license row. The readiness report and unified
  audit preserve those blockers, so recomputed legal evidence cannot satisfy
  derivative-weight review with empty scope values.
- Tests: `tests/retraining_governance_units.py`, including missing evidence,
  invalid JSON, incomplete legal topics, missing legal scope fields, unapproved
  model-license rows, missing target studies, malformed package/duration values,
  missing GPU evidence, missing failure modes, blocked prerequisite docs,
  blocked templates, invalid schema versions, invalid/future review dates,
  tampered readiness reports, changed source evidence, source-summary
  overclaims, and synthetic ready-for-R&D evidence.
- Unified R&D audit: `crossage_fr/experiments/self_learning_audit.py` and
  `npm run bench:self-learning-audit -- <output-folder>` write
  `self_learning_rd_audit.json` so the remaining Phase 5/6 checklist items are
  explicit `satisfied`, `blocked`, or `missing` rows. The current default output
  is blocked because real ORT training artifacts, target package/runtime
  evidence, measurable gains, and external legal approval are not present.
- Audit verification checks the audit hash, source-report file hashes, source
  report verifier status, required requirement IDs, `ok`/`status` consistency,
  per-requirement blocker consistency, R&D-only scope, and source-derived
  requirement rows. A recomputed hash over contradictory audit rows or over a
  wrapper around blocked source reports is not accepted.
- Plan consistency guard:
  `tests/self_learning_plan_consistency.py` maps each remaining unchecked row to
  the audit requirement that must satisfy it. Checking off legal/runtime/ORT
  evidence in this document before the audit proves it fails CI, and forged
  audit rows or missing/malformed/unreadable audit files are rejected before
  checklist satisfaction is calculated. Release checks use the same loader, so
  CI cannot normalize a bad audit path into a generic blocked audit.
- External evidence handoff:
  `npm run bench:self-learning-audit -- <output-folder> --audit-only
  --phase5-decision <phase5_onnx_training_decision.json>
  --phase6-readiness <backbone_readiness_report.json>` verifies already-collected
  evidence instead of generating fresh blocked templates.

## Product Modes

Recommended learning modes:

- Off: no learning jobs run.
- Manual suggestions: labels are collected, but all learned changes require user
  action.
- Auto-stage: the app prepares learned candidates after validation, but does not
  apply them.
- Auto-promote: future mode only; requires strong validation history and a clear
  rollback path.

Initial release recommendation:

- Ship Manual suggestions and Auto-stage only.
- Keep Auto-promote disabled or hidden until field data proves stability.

## Metrics To Track

Global:

- labels used
- positives/negatives
- precision
- recall
- false match rate
- false reject rate
- calibration error
- threshold movement
- held-out delta
- labels dropped because of model mismatch

Per person/cohort:

- accepted/rejected count
- per-person precision/recall
- worst-person regression
- pose bucket regression
- age-gap bucket regression
- low-quality regression
- video/still regression

Operational:

- training duration
- artifact size
- package size impact
- scan latency impact
- memory peak
- rollback success

## Security And Privacy Requirements

- [x] Learned artifacts must not include raw media.
- [x] Training examples must be treated as biometric data.
- [x] Artifacts and examples must be covered by privacy report.
- [x] Support bundles must exclude or redact learned artifacts unless explicitly
  requested.
- [x] Backup/restore must preserve artifact integrity metadata.
- [x] MCP tools must not self-authorize training or promotion.
- [x] Workspace lock must block learning jobs.
- [x] Audit chain must include learning and promotion events.
- [x] Model/artifact hashes must be tamper-evident.

## Test Matrix

Unit tests:

- [x] training example persistence
- [x] schema migration
- [x] feature extraction
- [x] calibration staging
- [x] adapter training
- [x] adapter serialization
- [x] held-out validation
- [x] stale model rejection
- [x] rollback
- [x] retention/delete behavior
- [x] R&D evidence audit for missing, tampered, and synthetic-ready evidence
- [x] Plan checklist drift guard for premature/stale Phase 5/6 checkoffs
- [x] Release posture guard for blocked/non-authorizing self-learning R&D

Integration tests:

- [x] review accept/reject creates examples
- [x] calibration autopilot stages artifact
- [x] reference suggestion appears after accepted match
- [x] adapter improves synthetic held-out data
- [x] adapter regression is rejected
- [x] learned artifact survives backup/restore
- [x] learned artifact is removed by delete face data
- [x] MCP commands require confirmation and consent

E2E tests:

- [x] Accuracy Lab shows staged learning result.
- [x] User can apply learned calibration.
- [x] User can roll back.
- [x] User can approve suggested reference.
- [x] Settings learning mode persists across restart.

Benchmarks:

- [x] synthetic calibration benchmark
- [x] public dataset benchmark before/after
- [x] local runtime benchmark before/after
- [x] package size check
- [x] memory/performance budget check

## Open Decisions

- [x] Should training examples store candidate vectors directly, or reference the
  embedding cache by content hash/model/detector size?
- [x] Should per-person adapters be separate artifacts or one global artifact with
  person-aware features?
- [x] Should reference suggestions be generated immediately on accept, or by a
  background job?
- [x] Should learned artifacts be encrypted at rest if/when workspace encryption is
  added?
- [x] What minimum label thresholds should unlock Auto-stage in real user data?
- [x] What UI language best explains "learning" without implying autonomous
  identification?

Evidence:

- E2E: `tests/e2e/learning-loop.spec.ts`.
- Synthetic calibration benchmark: `tests/accuracy_benchmark.py`.
- Public dataset before/after threshold evidence:
  `tests/public_dataset_benchmark.py`.
- Local runtime before/after adapter overhead:
  `tests/performance_budget.py`.
- Encryption decision:
  `docs/2026-learned-artifact-encryption-decision.md`.

Verification run on 2026-06-18:

- `npm run build`
- `node desktop/scripts/run-python.cjs -m py_compile crossage_fr/experiments/onnx_training.py tests/onnx_training_feasibility.py`
- `node desktop/scripts/run-python.cjs -m py_compile crossage_fr/experiments/retraining_governance.py tests/retraining_governance_units.py`
- `node desktop/scripts/run-python.cjs -m py_compile crossage_fr/experiments/self_learning_audit.py tests/self_learning_audit_units.py`
- `node desktop/scripts/run-python.cjs -m pip index versions onnxruntime-training`
- `npm run bench:onnx-training -- /tmp/vintrace-onnx-training-measurement-codex`
- `npm run bench:retraining-governance -- /tmp/vintrace-governance-templates-codex`
- `npm run bench:self-learning-audit -- /tmp/vintrace-self-learning-rd-audit-codex`
- `npm run bench:self-learning-audit -- /tmp/vintrace-self-learning-rd-audit-codex-audit-only --audit-only --phase5-decision /tmp/vintrace-onnx-training-measurement-codex/phase5_onnx_training_decision.json --phase6-readiness /tmp/vintrace-governance-templates-codex/backbone_readiness_report.json`
- `npm run test:learning-loop`
- `npm run test:onnx-training-feasibility`
- `npm run test:retraining-governance`
- `npm run test:self-learning-audit`
- `npm run test:self-learning-plan`
- `npm run release:check`
- `npm run bench:accuracy`
- `npm run test:dataset-benchmark`
- `npm run test:perf-budget`
- `npm run test:edge`
- `npm run test:command-contract`
- `npm run test:validation`
- `npm run test:dataset-gates`
- `npm run test:mcp`
- `npx playwright test tests/e2e/learning-loop.spec.ts`
- `npm run test:e2e`
- `npm test`
- `git diff --check`
- `node desktop/scripts/run-python.cjs -m py_compile crossage_fr/experiments/retraining_governance.py tests/retraining_governance_units.py`
- `node desktop/scripts/run-python.cjs tests/retraining_governance_units.py`
- `VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run bench:onnx-training -- /tmp/vintrace-onnx-training-mac-flagged-check`
- `/Users/harshbishnoi/.local/bin/python3.11 -m venv .venv-ort311`
- `.venv-ort311/bin/python -m pip install -U pip`
- `.venv-ort311/bin/python -m pip install onnxruntime-training-cpu torch`
- `.venv-ort311/bin/python -c "import onnxruntime.training; from onnxruntime.training import artifacts, api"`
- `PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run test:onnx-training-feasibility`
- `PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run bench:onnx-training -- /tmp/vintrace-onnx-mac-cpu`
- `PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run bench:onnx-training -- /tmp/vintrace-onnx-mac-cpu-phase5`
- `PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run bench:onnx-training -- <output> --training-rows <rows.json> --validation-rows <heldout.json>`
- `PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 npm run bench:onnx-training -- /tmp/vintrace-onnx-mac-cpu-row-phase5 --training-rows /tmp/vintrace-onnx-row-fixture/training-rows.json --validation-rows /tmp/vintrace-onnx-row-fixture/validation-rows.json`
- `python -m crossage_fr.experiments.onnx_training --combine-runtime-study /tmp/phase5_combined_runtime_study.json <fragment...>`
- `python -m crossage_fr.experiments.onnx_training --split-training-examples <vintrace-training-examples.json> <output-dir> --validation-fraction 0.25 --min-training-count 20 --min-validation-count 20 --min-per-class 5`
- Real tiny-head generation/training/export probe under
  `/tmp/vintrace-onnx-mac-cpu-train`

Remaining R&D blockers:

- `onnxruntime.training` is not importable in the current Python 3.13 app env.
- `pip index versions onnxruntime-training` finds no matching distribution in
  the current Python environment.
- cp311 download-only probes found no plain `onnxruntime-training` distribution
  for macOS arm64 or macOS x64. Mac requires the CPU package
  `onnxruntime-training-cpu` in a Python 3.11 side env.
- ONNX Training Matrix CI completed successfully in GitHub Actions run
  `27802462328`; the combined runtime study is downloaded locally at
  `/tmp/vintrace-onnx-matrix-27802462328/phase5_combined_runtime_study.json`.
- Real ORT artifact generation/training/export is verified on macOS arm64 only
  through the Python 3.11 CPU-training side env, not the app runtime.
- Row-trained ONNX validation tooling exists, but Phase 5 still needs real
  held-out reviewed rows that show a measurable gain over the JSON adapter.
- Full ORT runtime, disk, package-size, and failure-mode measurements require a
  completed target matrix, including Windows x64 and any supported Linux target.
- Side-env package impact is large, especially `torch` at 411.85 MB.
- Legal review for derivative weights and model licenses is user-reported as
  complete, but the Phase 6 gate still needs completed `legal-review` JSON with
  reviewer, date, topic, scope, and license evidence fields before the checklist
  can be checked off.
- Full GPU/runtime feasibility for backbone fine-tuning still requires target
  hardware and training dependencies.

## External References

- ONNX Runtime on-device training:
  https://onnxruntime.ai/docs/get-started/training-on-device.html
- ONNX Runtime training artifact preparation:
  https://onnxruntime.ai/docs/api/python/on_device_training/training_artifacts.html
- ONNX Runtime training API:
  https://onnxruntime.ai/docs/api/python/on_device_training/training_api.html
- InsightFace commercial model licensing:
  https://www.insightface.ai/solutions/face-recognition-licensing
- InsightFace PyPI license note:
  https://pypi.org/project/insightface/0.7/

## Local Reference Points

- `crossage_fr/enroll/manager.py`
- `crossage_fr/match/calibration.py`
- `crossage_fr/match/validation.py`
- `crossage_fr/match/review_order.py`
- `crossage_fr/embed/engine.py`
- `crossage_fr/model_manager.py`
- `crossage_fr/store/workspace_db.py`
- `crossage_fr/api_server.py`
- `crossage_fr/mcp_server.py`
- `src/App.tsx`
- `tests/calibration_units.py`
- `tests/validation_units.py`
- `benchmarks/results/public-dataset-benchmark-latest.md`

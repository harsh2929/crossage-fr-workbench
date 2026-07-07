# Model Retraining R&D Decision

Status: Phase 5 R&D gate open on 2026-06-19; production remains deferred.

Vintrace should not ship ONNX Runtime training or backbone fine-tuning in the
initial self-learning loop. The production path is the frozen-backbone loop now
implemented in the app: calibration artifacts, operator-approved reference
suggestions, and JSON embedding-adapter artifacts.

## Decision

- Phase 5 ONNX Runtime training remains experimental and should stay behind a
  future branch or feature flag. The public benchmark-only large-four evidence
  now verifies a measured tiny-head win over the JSON adapter, so R&D can
  continue, but this is not production authorization.
- Phase 6 detector/recognizer backbone fine-tuning is deferred into a separate
  governed R&D project.
- No production code should create derivative recognizer weights from user
  biometric data without legal review, explicit biometric-training consent scope,
  model provenance/signing, poisoning/overfitting mitigation, fairness testing,
  and rollback.

## Why

- The current adapter gives a reversible, auditable learning layer without adding
  training runtimes, model-weight licensing risk, or package-size pressure.
- Small personal libraries are label-scarce and self-correlated, which makes
  backbone fine-tuning high risk for overfitting and false confidence.
- ONNX Runtime training introduces training artifacts, optimizer state,
  package/runtime complexity, and additional integrity/rollback requirements.
  Those are now measured for Phase 5 R&D, but still need legal/privacy approval
  and user-reviewed validation history before production use.

## Revisit Gate

Move Phase 5 toward production only when all are true:

- a promoted JSON adapter shows repeatable held-out gains on real user-reviewed
  data;
- public/regression benchmarks continue to show no cohort regression;
- packaging impact and dependency availability are measured on macOS arm64,
  macOS x64, Windows x64, and supported Linux targets;
- legal/privacy review approves the proposed training artifact scope.

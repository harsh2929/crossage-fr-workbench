# Self-Learning Loop Architecture

Status: implementation reference for the 2026 local learning rollout.

## Boundaries

Vintrace keeps the detector and face-recognition backbone frozen in production.
The local learning loop is limited to reversible metadata-only artifacts:

- calibration artifacts over reviewed match scores;
- suggested-reference artifacts from accepted candidates, requiring approval;
- embedding-adapter artifacts, currently a JSON logistic scoring head over pair
  features from reviewed examples.

Public benchmark datasets are validation inputs only. Pending candidates,
clusters, model guesses, and unreviewed high-confidence matches cannot enter the
training set.

## Data Flow

1. A human marks a candidate `accepted` or `rejected`.
2. The review writes a calibration label and a current `training_examples` row.
3. Learning jobs read reviewed rows only, scoped to the dominant compatible
   recognizer/model pack.
4. Candidate artifacts are evaluated with `held_out_gate`, which splits by
   identity and reports accuracy, precision, recall, false-match rate,
   false-reject rate, and regression summaries.
5. Artifacts are stored as JSON in `learned_artifacts` with a deterministic
   SHA-256 hash over type, model, version, training-data hash, metrics, and
   payload.
6. Promotion is explicit. Rollback changes artifact status or restores saved
   previous calibration config.

## Version Keys

- Recognizer/model pack: `modelName` in reviewed examples and artifacts.
- Detector size: `detector_size` and embedding cache keys such as
  `sha256:<hash>|model:<model>|detector:<size>`.
- Calibration: `calibration-platt-fmr-v1`.
- Suggested references: `suggested-reference-v1`.
- Adapter type: `logistic-pair-adapter-v1`.
- Adapter features: `pair-adapter-features-v2`
  (`pair-adapter-features-v1` artifacts remain loadable for rollback).
- Training data: deterministic `trainingDataHash` from reviewed row metadata and
  extracted pair features.

## Consent, Locking, And Deletion

Learning mutations require active workspace consent when consent is required.
Workspace lock files make readiness false and block direct learning mutations.
Delete, retention, candidate purge, and person delete flows remove corresponding
training examples or stale learned artifacts while preserving audit records.
Support bundles include diagnostics and counts only; they exclude raw learned
artifact payloads and training-example rows.

## Legacy Labels

Older calibration labels without vectors remain usable for calibration because
the first production loop learns score calibration and JSON adapters over
available pair metadata. Adapter training uses `training_examples`; legacy rows
without adapter features are not backfilled with vectors. If a future vector
adapter needs historical embeddings, it must reconstruct them through the
existing embedding cache or active recognizer and write a new reviewed example
with a fresh model/detector version key.

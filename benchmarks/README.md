# Vintrace Public Dataset Benchmarks

These scripts are for benchmark-only validation. Do not use public benchmark images or videos as app training data.

## Download Accessible Archives

```bash
.venv/bin/python benchmarks/download_public_datasets.py calfw cplfw agedb ytf
```

CALFW and CPLFW are downloaded from the official unauthenticated Google Drive links when available. AgeDB and YTF are recorded as manual because their official sources require a password/form workflow.

## Prepare Reproducible Slices

```bash
.venv/bin/python benchmarks/prepare_public_dataset_slice.py calfw --max-identities 32 --images-per-identity 4 --extra-identities 8 --force
.venv/bin/python benchmarks/prepare_public_dataset_slice.py cplfw --max-identities 32 --images-per-identity 3 --extra-identities 8 --force
.venv/bin/python benchmarks/prepare_public_dataset_slice.py agedb fiw cfp ytf --max-identities 32 --images-per-identity 4 --extra-identities 8 --force
```

Prepared slices are written under `benchmarks/public-data/prepared/` with manifest files that list the source archive members.

AgeDB should be downloaded as `benchmarks/public-data/downloads/AgeDB.zip`.
FIW should be downloaded as `benchmarks/public-data/downloads/recognizing-faces-in-the-wild.zip`.
CFP is prepared through the app's official CFP downloader when the local CFP archive is not already available.

For wider confidence intervals, prepare and run the larger profiles:

```bash
.venv/bin/python benchmarks/prepare_public_dataset_slice.py calfw agedb fiw ytf --max-identities 128 --images-per-identity 4 --extra-identities 32 --force
.venv/bin/python benchmarks/prepare_public_dataset_slice.py cplfw --max-identities 128 --images-per-identity 3 --extra-identities 32 --force
.venv/bin/python benchmarks/run_public_dataset_benchmarks.py --profile large --require-real-data
```

The stress profile expects `320` prepared identities per folder and is intended for overnight/local-machine validation:

```bash
.venv/bin/python benchmarks/prepare_public_dataset_slice.py calfw agedb fiw ytf --max-identities 256 --images-per-identity 4 --extra-identities 64 --force
.venv/bin/python benchmarks/prepare_public_dataset_slice.py cplfw --max-identities 256 --images-per-identity 3 --extra-identities 64 --force
.venv/bin/python benchmarks/run_public_dataset_benchmarks.py --profile stress --require-real-data
```

## Run Model-Pack Comparison

```bash
.venv/bin/python benchmarks/run_public_dataset_benchmarks.py \
  --datasets calfw cplfw agedb fiw cfp ytf \
  --packs antelopev2 buffalo_l \
  --baseline-pack antelopev2 \
  --candidate-pack buffalo_l
```

Reports are written to `benchmarks/results/`, including `public-dataset-benchmark-latest.md` and `public-dataset-benchmark-latest.json`.

`npm run release:check` reads `benchmarks/results/public-dataset-benchmark-latest.json` when present and fails if the real public benchmark gates fail, required core datasets are missing from the report, or the report is stale. Use `VINTRACE_PUBLIC_BENCHMARK_REPORT=/path/to/report.json` to validate a different artifact.

## Export Public Labels For ONNX R&D Validation

Public benchmark labels can verify the Phase 5 ONNX row-training harness, but
they must remain benchmark-only evidence and must not be imported as app training
data.

```bash
.venv-ort311/bin/python benchmarks/export_public_dataset_onnx_rows.py \
  benchmarks/results/public-dataset-benchmark-latest.json \
  --output benchmarks/results/onnx-public-dataset-validation/rows \
  --datasets calfw cplfw \
  --pack antelopev2 \
  --model-name antelopev2

VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 \
PYTHON=$PWD/.venv-ort311/bin/python \
npm run bench:onnx-training -- \
  benchmarks/results/onnx-public-dataset-validation/run \
  --training-rows benchmarks/results/onnx-public-dataset-validation/rows/split/training-rows.json \
  --validation-rows benchmarks/results/onnx-public-dataset-validation/rows/split/validation-rows.json \
  --row-training-epochs 64 \
  --row-training-learning-rate 0.05
```

The exporter writes `public-dataset-onnx-examples.json`,
`public-dataset-onnx-row-export.json`, and a deterministic split under
`split/`. The exported examples and split manifest are marked
`notProductionTrainingData: true`, `publicBenchmarkOnly: true`, and
`trainingUseAllowed: false`.

The row-training defaults are `64` epochs and `0.05` learning rate. Validation
reports include the ONNX feature version, feature count, threshold calibration,
feature preprocessing, and `trainingConfig` used for the run. The current public
validation feature surface is `onnx-tiny-head-app-context-features-v4` (`36`
features), built from production `pair-adapter-features-v2` plus app-owned
context flags. Public rows also include the same app-owned `trainingContext`
contract used by training-example exports; label-like benchmark fields such as
identity/non-match difficulty are not ONNX features. Outcome fields such as
`wrong-identity` and `false-positive` remain diagnostic metadata only and must
not be converted into training risk flags.

Threshold calibration is JSON-baseline aware on the training split: it first
looks for ONNX thresholds that avoid accuracy/precision/recall regression versus
the JSON adapter, then prefers measurable gain. Validation reports also include
a held-out threshold sweep diagnostic so reviewers can tell whether a failure is
caused by threshold selection or by score ordering.

For non-linear R&D probes, add `--row-training-architecture mlp` and
`--row-training-hidden-units <n>` to `npm run bench:onnx-training`. MLP evidence
is still judged by the same Phase 5 measurable-gain gate; persisted sweep
summaries live at
`benchmarks/evidence/self-learning-rd/public-validation-all-mlp-sweep-summary.json`
and
`benchmarks/evidence/self-learning-rd/public-validation-large-four-sweep-summary.json`.

For preprocessing R&D probes, add
`--row-training-feature-preprocessing standardize` to insert frozen
training-split mean/scale normalization inside the generated ONNX graph. The
default remains `none` because the current large-four public validation study
showed standardization reduced the best metric gain below the gate floor and did
not fix recall regression. That comparison is stored at
`benchmarks/evidence/self-learning-rd/public-validation-large-four-feature-preprocessing-study.json`.

## Rebuild ONNX Training Matrix Evidence

The Phase 5 runtime matrix for GitHub Actions run `27802462328` can be
re-downloaded and source-bound locally:

```bash
rm -rf /tmp/vintrace-onnx-matrix-27802462328-full \
  /tmp/vintrace-onnx-matrix-27802462328-recombined
mkdir -p /tmp/vintrace-onnx-matrix-27802462328-full \
  /tmp/vintrace-onnx-matrix-27802462328-recombined
gh run download 27802462328 --dir /tmp/vintrace-onnx-matrix-27802462328-full
node desktop/scripts/run-python.cjs -m crossage_fr.experiments.onnx_training \
  --combine-runtime-study \
  /tmp/vintrace-onnx-matrix-27802462328-recombined/phase5_combined_runtime_study.json \
  $(find /tmp/vintrace-onnx-matrix-27802462328-full -name 'phase5_runtime_study_fragment.json' -print | sort)
```

Verify the recombined report before using it in a go/no-go decision:

```bash
node desktop/scripts/run-python.cjs - <<'PY'
from crossage_fr.experiments.onnx_training import verify_combined_target_runtime_study
print(verify_combined_target_runtime_study(
    '/tmp/vintrace-onnx-matrix-27802462328-recombined/phase5_combined_runtime_study.json'
))
PY
```

The current verified evidence snapshot is stored under
`benchmarks/evidence/self-learning-rd/` and is consumed by `release:check` when
no explicit self-learning audit override is provided.

Phase 6 legal-review evidence must be filled by the real reviewer. To create a
non-approved draft without overwriting existing evidence:

```bash
npm run bench:retraining-governance -- \
  --init-legal-review benchmarks/evidence/self-learning-rd/governance/backbone_legal_review.json
```

To validate the completed review before regenerating readiness/audit reports:

```bash
npm run bench:retraining-governance -- \
  --check-legal-review benchmarks/evidence/self-learning-rd/governance/backbone_legal_review.json
```

Video-capable runs use deterministic frame sampling and a frame cache. Decode failures are counted separately from recognition false negatives.

Each report includes:

- A before/after model-pack table by dataset.
- Scenario metrics for cross-age, profile/side-face, video, and family/lookalike hard negatives.
- Threshold calibration from emitted label JSON files, including recommended Review more, Likely, and Strong score levels.
- Regression gates that choose the best completed pack per dataset and fail when precision, recall, profile recall, cross-age recall, wrong-identity, or video-decode limits regress.
- An aggregate model-pack matrix that recommends the strongest pack across completed datasets without storing benchmark images in git.

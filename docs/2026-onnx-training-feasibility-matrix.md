# ONNX Runtime Training Feasibility Matrix

Status: Phase 5 R&D scaffold, not production learning.

Feature flag:

- `VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1`
- legacy alias: `CROSSAGE_EXPERIMENTAL_ONNX_TRAINING=1`

Current evidence:

| Target | Status | Notes |
| --- | --- | --- |
| macOS arm64 | pass in CI | GitHub Actions run `27802462328` generated artifacts, ran the tiny training/export job, and produced a pass runtime row. |
| macOS x64 | pass in CI | GitHub Actions run `27802462328` on `macos-26-intel` generated artifacts, ran the tiny training/export job, and produced a pass runtime row. |
| Windows x64 | pass in CI | GitHub Actions run `27802462328` on `windows-latest` generated artifacts, ran the tiny training/export job, and produced a pass runtime row. |
| Linux x64 | pass in CI | GitHub Actions run `27802462328` on `ubuntu-latest` generated artifacts, ran the tiny training/export job, and produced a pass runtime row. |

CI matrix run on 2026-06-19:

| Target | Training duration | Package size | Providers | Runtime blockers |
| --- | ---: | ---: | --- | --- |
| macOS arm64 | 14 ms | 591,665,508 bytes | `CoreMLExecutionProvider`, `CPUExecutionProvider` | none |
| macOS x64 | 26 ms | 739,657,692 bytes | `CoreMLExecutionProvider`, `CPUExecutionProvider` | none |
| Windows x64 | 50 ms | 648,195,711 bytes | `CPUExecutionProvider` | none |
| Linux x64 | 17 ms | 1,327,049,623 bytes | `CPUExecutionProvider` | none |

Combined artifact:

- Run: `https://github.com/harsh2929/crossage-fr-workbench/actions/runs/27802462328`
- Downloaded locally: `/tmp/vintrace-onnx-matrix-27802462328`
- Combined runtime study: `phase5_combined_runtime_study.json`
- Runtime status: `complete`
- Missing targets: none
- Source errors: none
- Combined Phase 5 decision: `no-go`
- Remaining Phase 5 decision blocker: `validation:validation-missing`

Local module availability:

| Module | Available |
| --- | --- |
| `onnxruntime` | yes |
| `onnxruntime.training` | no |
| `onnx` | yes |
| `numpy` | yes |
| `sklearn` | yes |

Mac CPU-training side env:

| Item | Value |
| --- | --- |
| Python | 3.11.15 |
| Package | `onnxruntime-training-cpu==1.19.2` |
| Required extra import | `torch==2.12.1` |
| `onnxruntime.training` | yes |
| Artifact generation | pass |
| Tiny `onnxruntime.training.api` training/export | pass |

Installed package footprint on the current host:

| Package | Version | Installed size |
| --- | --- | --- |
| `onnxruntime` | 1.26.0 | 69.48 MB |
| `onnx` | 1.21.0 | 38.22 MB |
| `numpy` | 2.4.6 | 29.62 MB |
| `scikit-learn` | 1.9.0 | 43.09 MB |

Side-env package footprint:

| Package | Version | Installed size |
| --- | --- | --- |
| `onnxruntime-training-cpu` | 1.19.2 | 77.47 MB |
| `torch` | 2.12.1 | 411.85 MB |
| `onnx` | 1.22.0 | 42.08 MB |
| `numpy` | 2.4.6 | 32.81 MB |

## R&D Boundary

The feasibility harness lives in `crossage_fr/experiments/onnx_training.py` and
is covered by `tests/onnx_training_feasibility.py`. It reports whether the
experimental training path is disabled, unavailable, or ready for a prototype.

It does not modify production match scoring or train the face recognizer. The
current code can:

- build and check a forward-only ONNX linear scoring head;
- call `onnxruntime.training.artifacts.generate_artifacts` to create training,
  eval, optimizer, and checkpoint artifacts when that package is available;
- run a tiny local `onnxruntime.training.api` job and export an inference model
  when training artifacts and the package are available;
- hash and size generated artifacts for integrity evidence;
- compare ONNX scoring-head outputs against the Phase 4 JSON adapter baseline.
- write a tamper-evident `training_artifact_manifest.json` with per-artifact
  hashes, bundle-relative paths, path-confinement checks, and checkpoint
  directory hashes;
- verify artifact manifests before promotion;
- maintain a rollbackable `active_training_artifact.json` pointer for
  experimental bundles, with pointer-hash and pointer-to-manifest verification
  before promote/rollback;
- report current runtime/size/package/failure-mode measurements through
  `phase5_measurement_report()`, including artifact generation and a tiny
  `onnxruntime.training.api` training/export job when dependencies are present.
- write repeatable host evidence through `npm run bench:onnx-training`, producing
  `phase5_onnx_training_measurement.json` and
  `phase5_runtime_study_fragment.json`;
- combine per-target runtime-study fragments into the Phase 6
  `runtime_feasibility_gate` schema.
- write a `phase5_onnx_training_decision.json` go/no-go report that requires
  verified training artifacts, complete target runtime/package evidence,
  available training packages on every target, and a measurable validation gain
  over the JSON adapter.

Real ORT artifact generation remains blocked in the app's Python 3.13 env, but
works on this Mac through a dedicated Python 3.11 CPU-training side env:

```bash
/Users/harshbishnoi/.local/bin/python3.11 -m venv .venv-ort311
.venv-ort311/bin/python -m pip install -U pip
.venv-ort311/bin/python -m pip install onnxruntime-training-cpu torch
PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 \
  npm run bench:onnx-training -- /tmp/vintrace-onnx-mac-cpu
```

To collect validation evidence from reviewed rows, pass separate training and
validation JSON files. Each file may be a JSON array of row objects or an object
with a `rows` array:

```bash
PYTHON=$PWD/.venv-ort311/bin/python VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 \
  npm run bench:onnx-training -- /tmp/vintrace-onnx-mac-cpu \
  --training-rows /path/to/training-rows.json \
  --validation-rows /path/to/heldout-validation-rows.json
```

The generated decision report remains `no-go` unless the row-trained ONNX head
beats the JSON adapter on the validation report without accuracy, precision, or
recall regressions.

To derive those files from a reviewed training-example export, first export
metadata-only training examples from the app, then split them deterministically:

```bash
python -m crossage_fr.experiments.onnx_training \
  --split-training-examples /path/to/vintrace-training-examples.json \
  /tmp/vintrace-onnx-reviewed-row-split \
  --validation-fraction 0.25 \
  --min-training-count 20 \
  --min-validation-count 20 \
  --min-per-class 5
```

The splitter writes:

- `training-rows.json`
- `validation-rows.json`
- `phase5_onnx_training_row_split_manifest.json`

It accepts the existing app export shape with an `examples` array, scopes rows to
one model pack, removes local path/vector fields, and fails closed when either
split lacks the required positive/negative class balance.

## Target Matrix Collection

Manual CI collector:

- Workflow: `.github/workflows/onnx-training-matrix.yml`
- Trigger: GitHub Actions -> ONNX Training Matrix -> Run workflow
- Targets:
  - `ubuntu-latest` -> `linux-x64`
  - `windows-latest` -> `windows-x64`
  - `macos-26` -> `macos-arm64`
  - `macos-26-intel` -> `macos-x64`

Each target job installs Python 3.11, tries `onnxruntime-training-cpu torch`,
falls back to `onnxruntime-training torch`, runs:

```bash
VINTRACE_EXPERIMENTAL_ONNX_TRAINING=1 PYTHON=python \
  npm run bench:onnx-training -- <target-output-dir>
```

and uploads:

- `phase5_onnx_training_measurement.json`
- `phase5_runtime_study_fragment.json`
- `phase5_onnx_training_decision.json`
- `training_artifact_manifest.json` and generated ONNX/checkpoint artifacts when
  ORT artifact generation succeeds
- `pip-install.log`, `pip-install.exitcode`, `bench.log`, and `bench.exitcode`

The combine job downloads target artifacts and writes:

- `phase5_combined_runtime_study.json`
- `phase5_onnx_training_decision.json`
- `phase5_decision_summary.json`
- `runtime-fragments.txt`

The combined Phase 5 decision is expected to remain `no-go` until real
file-backed validation evidence shows a measurable gain over the JSON adapter.
The matrix is considered filled only when the combined runtime study has all four
required targets, no `sourceErrors`, and each target row has `status: "pass"`.

Local/manual combiner:

```bash
python -m crossage_fr.experiments.onnx_training \
  --combine-runtime-study /tmp/phase5_combined_runtime_study.json \
  /path/to/linux/phase5_runtime_study_fragment.json \
  /path/to/windows/phase5_runtime_study_fragment.json \
  /path/to/macos-arm64/phase5_runtime_study_fragment.json \
  /path/to/macos-x64/phase5_runtime_study_fragment.json
```

## 2026-06-18 Wheel Probe

Commands were run with the project pip in download-only mode against Python 3.11
target tags:

- `--platform macosx_11_0_arm64 --implementation cp --python-version 311 --abi cp311 onnxruntime-training`
  returned `No matching distribution found`.
- `--platform macosx_11_0_x86_64 --implementation cp --python-version 311 --abi cp311 onnxruntime-training`
  returned `No matching distribution found`.
- `--platform manylinux2014_x86_64 --implementation cp --python-version 311 --abi cp311 onnxruntime-training`
  resolved `onnxruntime_training-1.16.3-cp311-cp311-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`.
  The wheel was 300.1 MB; the manual probe was cancelled at 259.0 MB after
  package availability was established.
- `onnxruntime-training-cpu` resolved for macOS arm64 and macOS x64 as
  `onnxruntime_training_cpu-1.19.2-cp311-cp311-macosx_11_0_universal2.whl`.
  The package exposes `onnxruntime.training` only after installing `torch`.

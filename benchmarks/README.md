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
.venv/bin/python benchmarks/prepare_public_dataset_slice.py agedb fiw cfp --max-identities 32 --images-per-identity 4 --extra-identities 8 --force
```

Prepared slices are written under `benchmarks/public-data/prepared/` with manifest files that list the source archive members.

AgeDB should be downloaded as `benchmarks/public-data/downloads/AgeDB.zip`.
FIW should be downloaded as `benchmarks/public-data/downloads/recognizing-faces-in-the-wild.zip`.
CFP is prepared through the app's official CFP downloader when the local CFP archive is not already available.

## Run Model-Pack Comparison

```bash
.venv/bin/python benchmarks/run_public_dataset_benchmarks.py \
  --datasets calfw cplfw agedb fiw cfp ytf \
  --packs antelopev2 buffalo_l \
  --baseline-pack antelopev2 \
  --candidate-pack buffalo_l
```

Reports are written to `benchmarks/results/`, including `public-dataset-benchmark-latest.md` and `public-dataset-benchmark-latest.json`.

Video-capable runs use deterministic frame sampling and a frame cache. Decode failures are counted separately from recognition false negatives.

Each report includes:

- A before/after model-pack table by dataset.
- Scenario metrics for cross-age, profile/side-face, video, and family/lookalike hard negatives.
- Threshold calibration from emitted label JSON files, including recommended Review more, Likely, and Strong score levels.
- Regression gates that choose the best completed pack per dataset and fail when precision, recall, profile recall, cross-age recall, wrong-identity, or video-decode limits regress.
- An aggregate model-pack matrix that recommends the strongest pack across completed datasets without storing benchmark images in git.

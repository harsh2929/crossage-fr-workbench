# Detection & Recognition Pipeline Audit — Quality + the road to "99.9th-percentile"

**Scope:** the full face pipeline in `crossage_fr/` — ingest → detection → embedding → quality →
matching/scoring → clustering → evaluation — for the product's stated job: **find a specific person
across a personal photo/video library, including across large age gaps, review-first and consent-gated.**

**Method:** multi-agent audit. Each of 8 pipeline stages got an independent code audit (line-verified
against source) **and** an independent SOTA literature sweep (NIST FRTE/FATE, IJB-C, MFR-Ongoing,
cross-age sets, 2024–2026 papers), then a per-stage gap synthesis. 30 high-impact recommendations were
then **adversarially verified** (one was refuted, most were materially corrected), and a completeness
critic swept for blind spots. Citations are inline; the appendix lists sources.

**Date:** 2026-06. **Verdict in one line:** the pipeline is **architecturally sound and uses real,
near-frontier models, but it operates well below its own ceiling** because the *decision and measurement
layers* — not the model — are where the accuracy is being left on the table, and several high-impact
levers are **present-but-inert** (silently dead code) or **missing**. Most of the gap is closeable with
**license-clean, offline, pure-Python changes over the existing embeddings.**

---

## 1. Executive summary

### 1.1 How good is it today?

| Stage | Grade | One-line assessment |
|---|:--:|---|
| Ingest & preprocessing | **B−** | Robust, secure, format-broad decoding — but recall-blind (no resolution/IED gate, naive video sampling). |
| Face detection | **C+** | Correct architecture (SCRFD-10G, near the offline frontier) but single-scale resize drops small/distant faces before anything else runs. |
| Recognition embedding | **B−** | Real ArcFace (R100/R50), correct alignment; loses free accuracy by skipping flip-TTA and never calibrating scores. |
| Face quality (FIQA) | **D** | The quality signal is a **dead no-op on the real model** (unit-scale bug); ~8 gates never fire. |
| Matching, scoring & calibration | **C+** | Honest, conservative — but raw uncalibrated cosine vs four hand-picked global thresholds; **no score normalization or probabilistic calibration**. |
| Cross-age (the headline feature) | **D+** | At the decision layer this is age-*agnostic* cosine-kNN with an honest labeling layer bolted on: `age_bucket` is stored but never scores, weights, or thresholds anything. |
| Clustering | **C−** | Defensible at a few hundred faces; **fragments by design** at the 100k–1M scale the product targets. |
| Evaluation & benchmarking | **C** | Cannot currently *measure* whether it's good: closed-set top-1 at fixed cosine thresholds, no TAR@FAR / DET / CIs. The percentile claim is presently **unfalsifiable**. |

**Overall: a solid B-/B architecture delivering C+/B− capability**, held back by self-inflicted,
fixable gaps rather than by the model.

### 1.2 The single most important reframing: what "99.9th-percentile" means here

"99.9th-percentile" is **not** "LFW 99.8%." That benchmark is saturated (every serious model scores
99.8%+) and the field treats it as a sanity check, not a discriminator. Production-grade accuracy is
reported as an **operating point**, never a lone number:

- **1:1 quality bar** — IJB-C **TAR@FAR=1e-4 ≥ ~97.5%** and TAR@FAR=1e-5 ~94–95%. NIST FRTE-grade
  engines reach ~0.2% FNMR @ FMR=1e-5 on cooperative imagery. *Your current buffalo_l/antelopev2
  sit at ~96–97.5% IJB-C@1e-4 — already near the offline-deployable ceiling.*
- **Cross-age bar** — saturate AgeDB-30 (≥98%), CALFW (≥96%), CPLFW (≥94.5%) on the recognizer, **and**
  hold a *calibrated* child↔adult false-match rate rather than one global cosine.
- **Open-set bar** — the app's real job is open-set 1:N (find-or-reject across a whole library, where
  effective FMR scales with gallery size N). Report **FNIR at a fixed FPIR**, not a 1:1 cosine.
- **Methodological bar** — a DET curve with **bootstrapped confidence intervals**, **per-age-gap** and
  **per-demographic** slices. *A system that cites one cosine threshold is below the measurement bar
  regardless of its true accuracy.*

### 1.3 The honest reality check (from the completeness critic)

> **A literal "99.9% correct identification" is NOT achievable** for cross-age personal-library
> person-finding on offline consumer hardware — and no honest roadmap should promise it. Child↔adult
> recognition is an **open research problem**: even FRVT-grade models top out ~70–76% Rank-1 on hard
> low-quality sets and degrade monotonically with age gap; the FG-NET cross-age identification ceiling is
> ~64–95% depending on protocol; and **every** model that would close even the moderate-gap gap
> (AdaFace / TransFace / LVFace / dedicated AIFR) ships **research/non-commercial weights** — there is no
> license-clean SOTA drop-in. The embedding ceiling is hard-capped by both *physics* (a toddler's face
> genuinely lacks the adult identity signal) and *licensing*.

The defensible reframing — **which this app's review-first architecture already gets right** — is that
"99.9th-percentile" for a review-first tool is **best-in-class *recall* surfaced to a human at a
calibrated, demographically-fair operating point, with the fewest review clicks to reach true matches.**
On *that* bar the app is genuinely reachable to top-tier, and is currently held back by fixable,
license-clean, offline gaps. The one sentence for users:

> *This tool reliably **surfaces** candidate matches across large age gaps for a human to confirm; it
> cannot and must not claim to **automatically identify** a child as an adult.*

### 1.4 The five biggest levers (ranked, verified)

1. **Calibrate the decision.** Fit a real probabilistic calibrator (isotonic/Platt/beta) on the
   accept/reject labels the app already collects → a calibrated **P(same identity)** and **FMR-targeted
   thresholds**. This is the single largest gain and the prerequisite that makes every other threshold
   meaningful. License-clean, offline, pure-Python. *(See §6.1 for the verified correction to the
   originally-proposed "AS-norm over your own library" framing, which was refuted.)*
2. **Fix the dead quality signal** (the `‖embedding‖`-vs-unit-scale bug, [engine.py:205](../crossage_fr/embed/engine.py#L205)).
   One fix re-arms quality gating, quality-weighted fusion, video keyframe selection, and quality routing
   — **four stages at once**. Highest leverage-per-line in the audit.
3. **Make "cross-age" operate, not just label.** Age-gap-stratified calibration + weight the age-nearest
   reference at match time, using data already stored — the cheapest way to make the headline feature real.
4. **Close the upstream recall holes.** Per-image (not zero-face-only) rescue, multi-scale/tiled detection
   for small faces, a native inter-eye-distance gate, raise the 3-face crowd cap, sharpness-ranked video
   keyframes. *A detection/ingest miss is unrecoverable* and caps every downstream metric for the exact
   cases that define the product.
5. **Build a real measurement harness** (TAR@FAR + DET/ROC + open-set FNIR@FPIR, bootstrap-by-identity
   CIs, per-age-gap and per-demographic slices). Doesn't raise accuracy directly but makes levers 1–4
   *measurable* and the percentile claim *falsifiable*.

### 1.5 Three cross-cutting truths

- **The bottleneck is the decision layer, not the model.** No model swap moves the needle as much as
  fixing calibration — and crucially there is no license-clean SOTA model to swap to anyway, so this is
  both forced and fortunate.
- **A dead quality signal poisons four stages at once** — one `M`-effort bug fix unblocks recommendations
  across detection, FIQA, matching, and video.
- **The data flywheel exists but is untapped and model-fragile.** Four ingredients SOTA systems pay for
  are already in the repo for free — the library itself, an embedding-norm quality score, per-reference
  age buckets, and accept/reject labels — and *none* feed the live decision path. Worse, the labels are
  silently invalidated by a model-pack switch.

---

## 2. What the pipeline does today (verified)

```
load_image (full-res, EXIF, HEIC/RAW/…)         ingest/image_io.py, ingest/video_io.py
        │
        ▼
SCRFD-10G detect  det_thresh=0.5  input=512²    embed/engine.py:172,189
   ├─ (if 0 faces) profile-"rescue": thr→0.22, 6 pad/contrast variants, max 3 faces, FIRST-HIT
        │
        ▼
ArcFace recognize  glintr100 / w600k_r50         embed/engine.py:198
   512-d, L2-normalized; alignment = InsightFace internal 5-pt norm_crop
   quality = ‖raw embedding‖   ◄── BUG: ~15–30 scale, compared to quality_min=0.15
        │
        ▼
VectorStore  FAISS IndexFlatIP / numpy flat      store/vector_store.py   (≤1M, exact)
        │
        ▼
group_hits  raw cosine vs confident=0.40 /       match/scoring.py
   likely=0.28 / relaxed_child=0.20
   + pose-relaxed deltas + multi-ref support bonus + runner-up margin flags
   ◄── NO score normalization, NO probabilistic calibration, age_bucket UNUSED
        │
        ▼
review queue (human accept / reject / uncertain) → accept/reject labels → "Accuracy Lab"
   (threshold nudging only; not probabilistic calibration; labels not model-versioned)

unmatched faces → cluster_vectors  HDBSCAN→DBSCAN(eps=0.35)  cluster/clusterer.py
   ◄── runs PER 1000-FACE BATCH with a label offset → one person fragments across batches
```

**What's genuinely good:** integrity-checked, fail-closed model loading
([engine.py:154-167](../crossage_fr/embed/engine.py#L154-L167)); a deterministic non-biometric
fallback engine; content-hash detection/embedding caching; a thoughtful (if mis-gated) profile-rescue
path; `max_num=0` so group photos aren't truncated in the *normal* pass; broad, secure, EXIF-correct
format handling; and a real offline public-dataset benchmark scaffold. The bones are good.

---

## 3. The critical findings (verified bugs, not opinions)

### 3.1 🔴 The face-quality gate is dead code on the real model
`quality = float(np.linalg.norm(face.embedding))`
([engine.py:205](../crossage_fr/embed/engine.py#L205)) returns the **raw, un-normalized ArcFace norm**,
which for `glintr100`/`w600k_r50` lives on a **~15–30 scale**. Every consumer compares it against
`quality_min = 0.15`, a value `config.py` **hard-forces into [0,1]**
([config.py:92-98](../crossage_fr/config.py#L92-L98)). Net effect: for the production engines, **every
gate of the form `embedding.quality < quality_min` essentially never fires** — at enroll
([manager.py:591](../crossage_fr/enroll/manager.py#L591)), folder scan (741), main scan (1194),
verification (1844/1852), and the public-dataset benchmark
([public_dataset.py:902](../crossage_fr/benchmarks/public_dataset.py#L902)). The *only* place the score
is correct is the rarely-used `FallbackEmbeddingEngine._quality_score`
([engine.py:118-125](../crossage_fr/embed/engine.py#L118-L125)), which is properly clamped to [0,1] — so
the **same `quality_min=0.15` means two different things across the two engines**, and the test fixtures
hardcode [0,1] qualities, green-lighting the broken assumption. **This one bug independently neuters
quality gating, quality-weighted fusion, video keyframe selection, and quality routing.**

### 3.2 🔴 No score normalization or probabilistic calibration
The live path ranks and bands purely on **raw fused cosine vs fixed global thresholds**
([scoring.py:35-200](../crossage_fr/match/scoring.py#L35-L200)). There is no T/Z/S-norm and no
cosine→probability map anywhere. What the repo *calls* "calibration" is just threshold selection: the
DB's `recommendedLikelyThreshold` is literally the **midpoint of the min-positive and max-negative
score** ([workspace_db.py:1136-1138](../crossage_fr/store/workspace_db.py#L1136-L1138)) — a two-outlier
statistic that can *raise* the threshold exactly when there's one overlapping hard negative. Consequence:
**no decision can state its actual false-match rate**, and a fixed `confident=0.40` is simultaneously too
strict for child↔adult pairs and too loose for same-age lookalikes, because cosine distributions shift
hard with pose/age/device. *This is the single biggest gap vs FRVT-grade systems.*

### 3.3 🔴 "Cross-age" is age-agnostic at the decision layer
Verified line-by-line: `age_bucket` is stored on every `ReferenceFace`
([models.py:40](../crossage_fr/models.py#L40)) but **never filters, weights, ranks, or conditions a
single decision.** `compute_age_gap` runs *after* the match is decided and only attaches a display flag
([manager.py:1288-1294](../crossage_fr/enroll/manager.py#L1288-L1294)). One global `relaxed_child=0.20`
floor admits *any* pair ≥0.20 into the "child-bucket maybe" band with zero age conditioning — which
**maximally admits false accepts in the worst-calibrated subgroup** (young children) while sharing that
floor with genuine cross-age matches. The "cross-age product" is, at the decision level, an age-agnostic
cosine-kNN with an honest labeling layer on top.

### 3.4 🔴 Clustering fragments by design at scale
`flush_unmatched()` calls `cluster_vectors()` **per 1000-face batch** and increments a
`cluster_label_offset` ([manager.py:812,945,1173](../crossage_fr/enroll/manager.py#L812)), so **one
person is structurally guaranteed to fragment across batches** at the 100k–1M scale the product targets.
Also: unmatched candidate embeddings are **never persisted** (`ReviewCandidate` has no vector field,
[models.py:52-77](../crossage_fr/models.py#L52-L77)), and the DBSCAN fallback is O(n²) in memory.

### 3.5 🟠 Free accuracy left on the table
- **No flip/TTA.** The current path is a single `rec_model.get` call
  ([engine.py:198](../crossage_fr/embed/engine.py#L198)); horizontal-flip embedding averaging is standard
  in every SOTA eval and buys ~0.1–0.4% on hard/cross-age sets for one extra forward pass.
- **Single-scale detection.** The pinned `insightface==1.0.1` SCRFD already supports multi-size `detect`,
  but the code always passes one square `input_size`, so a 40px face in a 6000px photo becomes ~3px and
  is undetectable before anything downstream can recover it.
- **Rescue is mis-gated and first-hit.** It only fires on **zero faces in the whole image**
  ([manager.py:1098](../crossage_fr/enroll/manager.py#L1098)) — so a detected adult + a missed small
  child in the same frame never triggers it — and it **breaks after the first variant**
  ([engine.py:238-239](../crossage_fr/embed/engine.py#L238-L239)), so the context-pad variants that
  actually surface tiny faces are effectively dead code. Rescued faces are also hard-labeled
  `pose_bucket="profile"` ([engine.py:206](../crossage_fr/embed/engine.py#L206)), which routes even a
  *frontal* rescued face through the loosest threshold band — real metric pollution.
- **Naive video sampling.** Uniform every-2s frames, up to 48, no sharpness/scene selection
  ([video_io.py:152-186](../crossage_fr/ingest/video_io.py#L152-L186)); blurry frames flow straight in,
  and every sampled frame is embedded (no per-track aggregation).
- **Closed-set, unfalsifiable benchmark.** No `roc_curve`, `det_curve`, EER, or FMR/FNMR anywhere in
  `crossage_fr/`; the harness reports TP/FP/TN/FN at the three hand-picked cosine thresholds, and a
  release "accuracy validation pack" feeds **hardcoded** scores
  ([manager.py:5093](../crossage_fr/enroll/manager.py#L5093)).

---

## 4. SOTA reference — the numbers that define the bars

**Recognition (IJB-C TAR@FAR=1e-4 ladder — the whole usable field is a ~2.8-point window):**
MobileFaceNet 95.0 < MagFace-R101 95.8 < ArcFace-R100/MS1MV2 96.0 ≈ CurricularFace 96.1 <
AdaFace-R100/MS1MV2 96.9 < **buffalo_l (your R50) 97.1** ≈ PartialFC-Glint360K 97.3 <
AdaFace-WebFace4M 97.4 < TopoFR-Glint360K-R100 97.6 ≈ **LVFace ViT-L 97.66** < TopoFR-R200 97.8 ≈
UniTSFace 97.99. **You ship near the top of the deployable band.**

**Cross-age (saturated on HQ sets, unsolved on large gaps):** AdaFace-R100/WebFace12M → AgeDB-30 **98.0**,
CALFW **96.1**, CPLFW **94.6**. But FG-NET cross-age **rank-1 caps ~64–95%** depending on protocol, and
child longitudinal TAR@FAR=0.1% falls from ~90% at a 1-yr gap to **~73% at 3 yr**, with toddlers
~65% and infants 15–31%. **No open model "solves" child→adult.**

**Detection (WIDER FACE Hard, single-scale 640px — the offline-relevant regime):** SCRFD-10G **83.05**,
SCRFD-34G **85.29**. The famous RetinaFace 91.8 / TinaFace 92.4 numbers are *multi-scale/large-image* TTA;
at equal VGA input RetinaFace **collapses to 64.17** — i.e. **a regression**. *You already run the right
detector.*

**Strategic model note — LVFace is the one license-clean top-tier option:** ByteDance LVFace (ICCV 2025)
is **MIT-licensed with explicit commercial permission**, ships **official ONNX** (ViT-S/B/L), and tops
the InsightFace MFR-Ongoing academic leaderboard (MR-All 98.49%). Every other top model — including your
current `antelopev2`/`buffalo_l`, plus AdaFace/TopoFR/TransFace weights — is **research/non-commercial**.
Architecture is open; the *weights* are the constraint, uniformly across the field.

**FIQA:** embedding-norm is a *weak, model-specific* quality proxy unless the loss was built for it
(MagFace/AdaFace) — and plain ArcFace was not. The license-clean SOTA pick is **eDifFIQA(T)**: a ~7.3 MB
**MIT ONNX** model in the OpenCV Model Zoo, ~1 ms/face, scored on the EDC/ERC protocol (FNMR@FMR=1e-3 vs
fraction discarded).

**Clustering:** the GCN leaderboard (~88–94.5 pairwise-F) is the *wrong tool* (GPU, learned model,
non-commercial MS1M). The realistic bar is **Infomap-on-kNN (93.98 pairwise-F, training-free, ~400s/1M
faces on CPU)** — but the `infomap` lib is **GPL/AGPL**; the genuinely license-clean path is a
**faiss-kNN graph + connected-components** (faiss MIT, sklearn/scipy BSD). Real consumer apps (Apple
Photos, Immich/PhotoPrism) all use incremental DBSCAN/agglomerative + human merge, **precision-first**.

---

## 4a. Implementation status (this branch)

Phase 0 and Phase 1 are implemented and unit-tested (TDD; `npm run test:quality`,
`test:detection`, `test:calibration`, `test:benchmark-units`, plus the existing
`scoring`/`edge`/`dataset` suites). Summary:

| Item | Status | Notes |
|---|---|---|
| 0.1 quality unit-scale fix | ✅ done | `quality_from_norm`, conservative `[8,26]` bounds, dead gates re-armed |
| 0.2 rescue pose mislabel | ✅ done | `_pose_bucket_for_face` runs the real heuristic on rescued faces |
| 0.3 multi-scale normal pass | ✅ done | gated by `multi_scale_detect`, cache-tagged, dynamic-model-guarded |
| 0.4 honest signals | ✅ done | `det_score`, inter-eye distance, `raw_cosine` captured + persisted |
| 0.5 benchmark honesty | ✅ done | Wilson CIs + `BENCHMARK_DISCLAIMER` on reports; synthetic pack marked `fixture` |
| 1.1 probabilistic calibrator | ✅ done | `match/calibration.py` (regularized Platt + FMR-targeted thresholds); midpoint writer replaced; min labels 8→20 |
| 1.2 calibration-label schema | ✅ done | `pose_bucket`/`age_gap_years`/`raw_cosine` columns + migration + stamping |
| 1.3 quality-weighted fusion | ✅ done | conservative precision-only demotion; **never** touches the cross-age relaxed band |
| 1.4 tiled detection | ✅ done | coordinate-correct tiling + IoU-NMS merge for small faces |
| 1.4 per-image rescue-union | ⏸ deferred | flagged by verification for cross-canvas coordinate bugs; tiling already covers the small-face case |
| 2.1 age-gap calibration | ✅ done | operative age-consistency support in `group_hits` (additive, recall-safe) + per-age-gap DET report |
| 2.2 FIQA head | ◑ seam | drop-in `embed/fiqa.py` (ONNX-if-present → calibrated-norm fallback); the eDifFIQA ONNX must be added under `models/fiq/` (can't fetch offline) |
| 2.3 eval harness | ✅ done | `benchmarks/det_eval.py`: TAR@FAR / EER / accuracy@EER + open-set FNIR@FPIR, identity bootstrap CIs, resolvable-FAR floor; `accuracy_det_report[_by_age_gap]()` |
| 2.4 clustering | ✅ done | license-clean kNN-graph + connected-components (PCA/copyleft dropped); global terminal-flush pass kills per-batch fragmentation |
| 2.4 cross-scan incremental | ⏸ deferred | needs net-new candidate-embedding persistence (verification-flagged); per-scan global pass shipped |
| 3.1 config-driven recognizer | ◑ seam | `recognizer_filename` config + `apply_recognizer_preference`; LVFace/AdaFace ONNX is the drop-in (can't fetch offline; re-enroll + recalibrate on switch) |
| 3.2 flip-TTA | ✅ done | `flip_average` + `_recognize`; **off by default**, quality norm kept from the single crop (verification's trap avoided), verified on the real model |
| 3.3 fairness instrumentation | ✅ done | `det_report_by_cohort` + first-class `fairnessGap`; `accuracy_fairness_report()`. Slices non-protected cohorts (pose/age) only, by privacy design |
| 3.4 model-pack versioning | ✅ done | labels tagged with `model_name`; calibrator fit on the dominant pack + `calibration_model` tag; `match_probability` refuses a stale (cross-model) calibrator |
| 4.A alignment-failure handling | ✅ done | `alignment_error` (Umeyama residual to canonical 5-pt) captured per face; precision-only **alignment-suspect demotion** (cross-age-safe); empirically separates frontal (~0.04) from profile (~0.41) |
| 4.B active-learning review ordering | ✅ done | `review_order` module (surface/review/**abstain** lanes + calibrated-confidence-first priority); `ordered_review_candidates()` re-ranks the queue, pushing information-limited faces to the bottom |

## 5. The roadmap — phased by impact × effort (verification corrections folded in)

Effort: `S`=hours–day, `M`=days, `L`=1–2 weeks, `XL`=multi-week/strategic.
Every item below is offline and (unless flagged) license-clean.

### Phase 0 — Stop the bleeding / re-arm dead code  *(days; very high ratio)*

| # | Change | File(s) | Effort | Why |
|---|---|---|:--:|---|
| 0.1 | **Fix the quality unit-scale bug.** Store a calibrated [0,1] quality (per-model min-max or logistic over the measured ~15–30 norm distribution); keep raw norm as `quality_norm` for analytics. | [engine.py:205](../crossage_fr/embed/engine.py#L205) | S | Re-arms ~8 dead gates with **zero new model**; immediately trims blurry/tiny faces from the review queue. **Calibrate `mu/s` conservatively** so legitimate (esp. cross-age child) faces aren't newly filtered. |
| 0.2 | **Stop hard-labeling rescue faces `profile`.** Call the existing `_pose_bucket_for_detection` on rescue boxes when kps are present. | [engine.py:206](../crossage_fr/embed/engine.py#L206) | S | Pure correctness; stops frontal rescued faces being judged at the loosest band. No recall cost. |
| 0.3 | **Multi-scale normal pass** via the library capability you already ship: `detect(bgr, input_size=[(d,d),(rescue,rescue)], max_num=0)`. Bump the embedding cache version. | [engine.py:189](../crossage_fr/embed/engine.py#L189) | S | SCRFD 1.0.1 already unions sizes + does box-level NMS; recovers medium/distant faces for ~zero effort. (Does *not* replace tiling for truly tiny faces.) |
| 0.4 | **Capture honest signals that are currently discarded:** persist `det_score` ([engine.py:197](../crossage_fr/embed/engine.py#L197)), `rawCosine` (before fusion), and **inter-eye distance (IED)** from the eye keypoints. | engine.py, models.py, scoring.py | S–M | `det_score` and IED are genuinely [0,1]/pixel signals; `rawCosine` decouples recognizer quality from heuristic bonuses and unlocks every comparable metric downstream. |
| 0.5 | **Stop misleading numbers.** Either run the real engine on the synthetic "accuracy validation pack" or relabel it `fixtures/self-test` and exclude it from any accuracy surface; add Wilson CIs + an honest "closed-set top-1, not FR verification accuracy" disclaimer to benchmark output. | manager.py:4995/5093, benchmark_quality.py, release_check.py | S–M | Green CI currently asserts on hand-written scores — zero evidence of recognition accuracy. |

### Phase 1 — Make decisions calibrated  *(the biggest accuracy lever)*

| # | Change | File(s) | Effort | Why |
|---|---|---|:--:|---|
| 1.1 | **Fit a real probabilistic calibrator** (global **isotonic/Platt/beta**) on the accept/reject labels → calibrated **P(same identity)**; set each band's threshold from a **target FMR/precision floor** (reuse `_choose_threshold`'s sweep), validated on a **held-out split**. Replace the midpoint writer. | [scoring.py](../crossage_fr/match/scoring.py), [workspace_db.py:1136](../crossage_fr/store/workspace_db.py#L1136), [benchmark_quality.py:286](../crossage_fr/benchmark_quality.py#L286), manager.py:5246 | M | The corrected #1 lever (see §6.1). Removes the midpoint footgun; makes thresholds map to a *measured* FMR. Ship with a regularizing prior to resist single-user overfit and a cold-start fallback. **Prereq:** add pose/age columns to `calibration_labels` (1.2). |
| 1.2 | **Schema prerequisite:** add `pose_bucket`, `age_gap_years/confidence` to the `calibration_labels` table + insert path, stamped at decision time. | [workspace_db.py:151-161](../crossage_fr/store/workspace_db.py#L151-L161), manager.py `add_calibration_label` | S–M | Per-bucket calibration (Phase 2) is **impossible** from today's labels — they carry no pose/age. Capturing them now starts the data flywheel. |
| 1.3 | **Quality-weighted fusion** (conservative, gated) once 0.1 lands: down-weight clearly-degraded refs in `group_hits`; **never** penalize the cross-age/relaxed band. Frame as a precision tie-breaker, not a verification lift. | [scoring.py:96-200](../crossage_fr/match/scoring.py#L96-L200) | M | Quality-weighted pooling is a documented win, but weighting by a *raw* proxy can *suppress* genuine low-quality child photos — keep it mild and behind the validation harness. |
| 1.4 | **Per-image rescue gate + tiling for small faces.** Fire rescue when faces exist but the smallest bbox is <~1.5% of image area or touches an edge; add an overlapping-**tile** detection path for images whose long side ≫ detector size, merging boxes to global coords with NMS; cache per-tile. | manager.py:1098, [engine.py:181-189](../crossage_fr/embed/engine.py#L181-L189) | M–L | Directly fixes the missed-small-child-next-to-adult case. **Verification caveat:** to actually benefit, the rescue path must also **suppress already-found faces before the early-break** ([engine.py:238](../crossage_fr/embed/engine.py#L238)) or it re-detects the adult and stops; and cross-variant NMS must **back-transform each variant's boxes to original coords** (each variant is on a different padded canvas). |

### Phase 2 — Make "cross-age" real *and* measurable

| # | Change | File(s) | Effort | Why |
|---|---|---|:--:|---|
| 2.1 | **Age-gap-stratified calibration** (overlay on 1.1 with min-N gate + global fallback) + **weight the age-nearest reference** in `group_hits` so a child query isn't out-competed by a person's larger adult cluster. | scoring.py, manager.py, age_gap.py | M–L | The cheapest way to make the headline feature operate on decisions, not just labels. **Caveat:** today's "age gap" is a **photo-date** gap (EXIF→mtime fallback), *not* a subject-age gap — bin honestly, scope impact to the dated subset, and don't double-count the existing display flag. |
| 2.2 | **Add eDifFIQA(T)** (MIT ONNX, ~7.3 MB) as the per-face quality head; use it for gating, **quality-weighted pooling**, and **best-frame selection**. | new `embed/` scorer, scoring.py, manager.py | L | Moves EDC pAUC from naive-norm ~0.77 toward SOTA ~0.68, biggest gains exactly where the app is hardest (cross-quality, pose). License-clean; the FR backbone keeps its own license. |
| 2.3 | **Build the measurement harness:** genuine/impostor **TAR@FAR + DET/ROC**, open-set **FNIR@FPIR / DIR@FPIR**, **bootstrap-by-identity** 95% CIs, real **age-gap-in-years** buckets, **per-demographic** slices, and CMC vs growing distractor galleries. Wire as a required release gate. | new `benchmarks/det_eval.py`, [public_dataset.py](../crossage_fr/benchmarks/public_dataset.py), dataset_benchmarks.py, release_check.py | L | Makes every other lever measurable. **Caveat:** lead with accuracy@EER (the leaderboard-comparable number) and report TAR@FAR only to the FAR floor your impostor pool supports (AgeDB ~1e-3; reserve 1e-4+ for IJB-C-scale pools). |
| 2.4 | **Fix clustering:** one **global** pass (kill the per-batch label offset) built on a **faiss cosine-kNN graph + connected-components** (license-clean), precision-first defaults, human merge UI. | [manager.py](../crossage_fr/enroll/manager.py) `flush_unmatched`, [clusterer.py](../crossage_fr/cluster/clusterer.py), config.py:51 | M–L | Makes grouping work at scale. **Caveats:** the cross-scan *incremental* version needs net-new candidate-embedding persistence (`ReviewCandidate` has no vector) — defer it; and **do not** ship `infomap`/Leiden(`igraph`) and call them permissive — both are copyleft. Age-aware clustering is **blocked** (unknown faces have no `age_bucket` and there's no age model). |

### Phase 3 — Ceiling / strategic  *(license-gated; do last)*

| # | Change | Effort | Why / risk |
|---|---|:--:|---|
| 3.1 | **Selectable recognizer upgrade.** Make the recognizer config-driven and add **LVFace (MIT ONNX)** as the commercial-clean top-tier option (and/or AdaFace IR-100). | XL | LVFace simultaneously lifts accuracy *and* fixes the licensing exposure. **Traps:** AdaFace weights expect **BGR** but InsightFace's loader hardcodes RGB — a naive drop-in silently corrupts embeddings; any swap needs **full re-enrollment** (new embedding space) + **threshold recalibration** (the 0.40/0.28 thresholds are bound to the current space). Prefer ViT-S/B on CPU; reserve ViT-L for CoreML/DirectML. |
| 3.2 | **Flip-TTA**, defaulted **off**, threaded to the **verification engine only**. | S–M | Free ~0.1–0.4% on the hard subset, but the naive snippet **breaks the quality norm** (must explicitly set `face.embedding`) and a global default would slow every full-library scan. |
| 3.3 | **Demographic / fairness instrumentation** as a **gating prerequisite** before any accuracy claim ships. | M–L | The single biggest blind spot (§7). Today *zero* demographic code exists; every number is a population average that can hide **10–100× worse** error on the youngest/darkest-skinned subjects — exactly the `relaxed_child` population. |
| 3.4 | **Version the accept/reject label set against the model pack**; warn-and-migrate on backbone switch. | M | Protects the Phase-1/2 gains: a pack switch today silently invalidates every threshold, calibration label, and cluster. |

---

## 6. Where the audit corrected itself (adversarial verification)

The verification pass refuted one headline recommendation and materially revised most others. The
high-value corrections, so they aren't re-introduced:

### 6.1 Refuted: "AS-norm over your own library as an impostor cohort"
Pitched as "the single biggest accuracy lever," this was **refuted (isReal=false)** on two grounds:
- **The cohort doesn't exist in the data model.** The match-time store is rebuilt from **only enrolled
  target references** ([manager.py:291-304](../crossage_fr/enroll/manager.py#L291-L304)); `ReviewCandidate`
  **stores no embedding** ([models.py:52-77](../crossage_fr/models.py#L52-L77)), so the scanned library —
  the natural impostor pool — is not persisted anywhere. With 1–3 enrolled people the cohort is empty and
  the "degrade to raw cosine" fallback fires for most users. This makes it **L–XL, not M.**
- **The SOTA justification was misapplied.** AS-norm's "biggest gains at the low-FMR tail" is a *speaker
  verification* result; the leading face paper (Linghu et al., **IJCB 2024, arXiv 2407.14087**) shows plain
  Z/T-norm **does not** help at low-FMR operating points without demographic info — backwards for this case.
- **Corrected lever:** a global **isotonic/Platt cosine→probability calibration** on the accept/reject
  labels the app already collects (Phase 1.1) delivers the same stable-operating-point goal without
  inventing a cohort the data model can't support.

### 6.2 Other material corrections
- **Flip-TTA** snippet would leave `face.embedding` unset → the quality norm crashes/garbages; must set it
  explicitly and decide the quality-norm source. Default the flag off.
- **Rescue union + IoU-NMS** is geometrically invalid as proposed — each variant renders on a different
  canvas, so boxes must be back-transformed to original coords first; and it's contingent on first removing
  the early-`break`.
- **Per-age-gap calibration** rests on a **photo-date** gap (EXIF→mtime), not subject age; and the
  `calibration_labels` table has **no age/pose columns**, so a migration is a hard prerequisite.
- **AdaFace swap** understated two costs: the **BGR/RGB** corruption trap and a mandatory **full
  re-enrollment + threshold recalibration**; several quoted numbers needed training-set tags, and the
  Octuplet XQLFW/LFW figures belong to a *FaceTransformer* backbone, not IResNet.
- **Clustering**: the proposed "permissive" Leiden/`igraph` fallback is **GPL**, not permissive; only plain
  connected-components is genuinely license-clean. Age-aware clustering is blocked (no per-face age).
- **"Dead quality signal"** nuance: quality *is* used as a gate; it's just (a) on the wrong scale (§3.1)
  and (b) never fused into per-image confidence.

---

## 7. Blind spots the 8 stages missed (completeness critic)

1. **Demographic bias / fairness — the biggest blind spot.** *Zero* fairness instrumentation exists; every
   number is a population average. NIST shows up to ~3 orders of magnitude FMR variation across age/sex/skin
   cohorts. For a cross-age **child**-finding tool this is gating, not a footnote — calibration must be
   stratified by demographic group, not just age gap.
2. **Doppelgänger / kinship / twin false-accepts.** The impostors in a *personal library* aren't random
   strangers — they're siblings, parents, and the same family across generations who share real facial
   structure and co-occur in the same albums. No metric tracks kinship false-accept rate, and any
   library-derived cohort is adversarially correlated.
3. **Model-upgrade / embedding drift.** A pack switch silently invalidates every stored threshold,
   calibration label, and cluster; the label set is not versioned.
4. **Throughput × accuracy budget.** Multi-scale + tiling + flip-TTA + verification re-rank + per-track
   video selection *compound* into a multi-× slowdown on a CPU/CoreML laptop scanning 100k–1M items. A
   recall lever the user disables because it's too slow delivers zero accuracy. There is no
   recall-vs-wall-clock curve.
5. **Occlusion / masks / sunglasses / extreme pose** — common in real family photos, sharply degrade
   ArcFace, partly invisible to a norm proxy, and not detected/routed today.
6. **Crowd scenes & the hard 3-face rescue cap** ([engine.py:237](../crossage_fr/embed/engine.py#L237)) —
   the very scenes most likely to hide the target are capped at 3 faces.
7. **Review-queue prioritization / active learning** — the accuracy a *user* experiences is bounded by
   which candidates the human sees first; there's no uncertainty-ordered queue. This is both an accuracy
   lever and the feed that makes the calibration flywheel converge.
8. **End-to-end success rate.** No stage reports the joint
   `P(detect)·P(align)·P(embed-usable)·P(rank-into-review)·P(human-accepts)` — the only number that
   actually answers the 99.9th-percentile question. **Recommended headline metric: held-out recall of a
   known target ("target appears in N photos; how many did we surface?"), reported with FMR per age-gap and
   per demographic.**

---

## 8. Bottom line

- **You already run the right models.** SCRFD-10G and R100/R50 ArcFace are at/near the offline-deployable
  frontier; no license-clean SOTA model would dramatically beat them, and a backbone swap is the *last*
  lever, not the first.
- **The accuracy is being lost in the decision and measurement layers**, and much of it to *bugs and dead
  code* — the quality-scale no-op, uncalibrated raw cosine, age-as-advisory-only, mis-gated rescue,
  fragmenting clustering, and an unfalsifiable benchmark. These are **license-clean, offline, mostly
  small-to-medium** fixes.
- **"99.9th-percentile" must be reframed** for a review-first tool as *best-in-class calibrated recall at a
  demographically-fair operating point with minimal review clicks* — and on that bar the app is reachable.
  **Autonomous child→adult identification is not achievable and should never be claimed.**
- **Sequence:** Phase 0 (re-arm dead code) → Phase 1 (calibrate decisions) → Phase 2 (real cross-age +
  real measurement) → Phase 3 (strategic model/licensing/fairness). Fairness instrumentation (3.3) is a
  **gating prerequisite** before any accuracy claim ships.

---

## Appendix A — Per-stage grades & dominant gap

| Stage | Grade | Dominant gap | First fix |
|---|:--:|---|---|
| Ingest/preprocessing | B− | recall-blind (no IED gate, naive video sampling) | IED capture (0.4); sharpness keyframes (2.2) |
| Detection | C+ | single-scale resize drops small faces | multi-scale (0.3) → per-image rescue + tiling (1.4) |
| Recognition | B− | no flip-TTA, no calibration, dead quality | quality fix (0.1); calibration (1.1) |
| FIQA | D | unit-scale no-op | quality fix (0.1) → eDifFIQA(T) (2.2) |
| Matching/calibration | C+ | raw cosine vs global thresholds | probabilistic calibrator (1.1) |
| Cross-age | D+ | `age_bucket` unused in decisions | age-stratified calibration + nearest-ref weighting (2.1) |
| Clustering | C− | per-batch fragmentation | global pass + faiss-kNN graph (2.4) |
| Evaluation | C | closed-set, no TAR@FAR/DET/CIs | DET/open-set harness (2.3) |

## Appendix B — Selected sources (2024–2026)
- **NIST FRTE/FRVT 1:1 & 1:N, FATE Quality** — operating-point reporting (FNMR@FMR, FNIR@FPIR), demographic
  differentials; ISO/IEC 29794-5:2025 + OFIQ 1.0 (MIT).
- **IJB-B/IJB-C** template verification; **InsightFace MFR-Ongoing / WebFace260M** (masked + children +
  multi-racial); **CALFW/CPLFW/AgeDB-30/FG-NET** cross-age.
- **AdaFace** (CVPR 2022, arXiv 2204.00964, MIT code); **LVFace** (ByteDance, ICCV 2025, MIT + ONNX);
  **TopoFR** (NeurIPS 2024); **MagFace** (CVPR 2021, Apache-2.0); **CAFace** set pooling (NeurIPS 2022).
- **CR-FIQA** (CVPR 2023), **eDifFIQA/DifFIQA** (TBIOM 2024, MIT ONNX in OpenCV Zoo).
- **SCRFD** (ICLR 2022); **YuNet** (OpenCV Zoo, MIT); WIDER FACE.
- **Score normalization for demographic fairness** — Linghu et al., IJCB 2024 (arXiv 2407.14087);
  **FairCal** (ICLR 2022, arXiv 2106.03761).
- **Face clustering** — GCN-V/STAR-FC/NASA-GCN; **face-cluster-by-infomap** / Adapt-Infomap (PR 2024);
  Apple Photos on-device recognition; Immich/PhotoPrism.
- **Child longitudinal FR** — 2024–2026 NIST-aligned studies (e.g. arXiv 2408.07225).

*Full per-stage audit detail, every recommendation's verbatim change/risk/feasibility verdict, and the
complete SOTA method tables are preserved in the workflow run artifacts.*

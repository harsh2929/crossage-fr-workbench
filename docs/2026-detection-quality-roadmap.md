# Vintrace — 2026 Detection & Recognition Quality Roadmap

**Companion to:** [`detection-pipeline-audit.md`](detection-pipeline-audit.md) (the audit + Phase 0–3 implementation)
and [`2026-capability-unlock-audit.md`](2026-capability-unlock-audit.md) (the product-capability map).
**Scope:** the *model-quality* roadmap for the face detection→recognition→decision pipeline — what is shipped,
what remains, how much each remaining lever is really worth (NIST/benchmark-anchored, adversarially verified),
and the hard caps that bound the whole effort. Effort is sized **S / M / L / XL**. Gains are quoted at the
**strict-FAR / fixed-review-budget operating point the app actually uses**, not paper headlines.

---

## 1. Executive Summary

The pipeline is **near the best a license-clean, offline, consent-first system can be.** Across three
research passes (a 99.9th-percentile audit, a quality-ceiling assessment, and a no-license frontier scan), the
recurring verdict is the same: **you have maxed the parts you control — detection recall, calibration,
measurement, governance — and the remaining gap is owned by alignment, physics, and review-UX, not by your
model.** The bottleneck has moved off the backbone.

Three load-bearing conclusions:

1. **Headroom is real but bounded, front-loaded, and mostly UPSTREAM.** On an easy frontal library you are
   already saturated (<0.5pp recoverable). All remaining gain lives in the hard cross-age / low-quality / video
   tail — the product's actual mission — where the honest, **non-additive** envelope is **~+5 to +12pp recall**
   at the strict-FAR / fixed-review-budget operating point, **most of it reachable without new training.**
2. **License-clean was never the binding wall — `offline` and `physics` are.** You already use non-commercial
   weights, so dropping "license-clean" unlocks **~0** additional offline accuracy over LVFace (already the top
   offline lever). The only genuinely-stronger tier (closed on-prem SDKs, NEC #1) buys ~+2 points on *adult*
   aging at the cost of money + a black-box SDK + your clean ONNX architecture, and **does nothing** for the
   child→adult headline. Cloud APIs delete the product (data egress, no NIST-verified cross-age edge).
3. **The headline child→adult case is biologically capped (~50–75% usable-FMR recall) and no pipeline beats
   it.** This validates — does not limit — the review-first / consent-gated design. The correct goal is
   *best-in-class recall surfaced to a human at a calibrated, fair operating point with the fewest review
   clicks*, not autonomous identification.

This roadmap therefore prioritizes **upstream + decision-layer + review-UX levers behind a mandatory per-user
validation gate**, with a single low-effort backbone win (LVFace) banked alongside.

---

## 2. Method & Framing

### 2.1 The metric that actually matters
For a single-user, review-first tool the experienced quality is **recall-at-a-fixed-human-review-budget**, not
TAR@FAR on a benchmark. This reframe is decisive: it makes **alignment handling and active-learning queue
ordering worth more than a backbone swap**, even though the backbone is the benchmark headline.

### 2.2 The constraint hierarchy (cheapest to most precious)
```
license  <  architecture-clean  <  cost  <  offline  <  consent  <  physics
```
Dropping the cheapest (license) buys ~0. Every materially-better option costs a more precious constraint —
and none beats the physics that bounds the headline mission. Plan around this order.

### 2.3 Hard constraints (non-negotiable)
Offline / on-device; ONNX Runtime (CoreML / DirectML / CPU); no cloud, no data egress; consent-gated +
review-first; single-user library; weights may be non-commercial-research (single-user/personal) but **a
commercial/redistributable build inherits a license wall** that caps it ~1.5–2.1 cross-age points below the
research-weight tier (best commercial-clean weight = AuraFace).

### 2.4 The verifier lesson, carried forward
*"The benchmark gain is not the deployment gain."* Every numeric lever below is from public benchmarks; on a
single small private library the threshold is fit from tens-to-hundreds of self-correlated labels, so a
benchmarked +2pp **can vanish or invert**. **Every adaptive change must ship behind a held-out per-user
validation gate (§6).** This is the difference between nominal and real headroom.

---

## 3. What is already shipped (Phases 0–3)

The decision/measurement/governance scaffolding is **at or near its constrained ceiling.** Inventory:

| Stage | Shipped |
|---|---|
| Detection | SCRFD-10G + **multi-scale** normal pass + coordinate-correct **tiling** (IoU-NMS) for small faces; profile rescue; `det_score` + native **inter-eye distance** captured |
| Recognition | ArcFace `glintr100`/`w600k_r50`, 512-d; **horizontal-flip TTA** (off by default); **config-driven recognizer seam** (`recognizer_filename` + `apply_recognizer_preference`) |
| Quality | calibrated embedding-norm→[0,1] (re-armed the dead gate); **FIQA scorer seam** (`embed/fiqa.py`, eDifFIQA drop-in) |
| Decision | raw cosine→**Platt calibration** (P(same)) + **FMR-targeted thresholds**; **model-pack-versioned** calibrator; conservative cross-age-safe quality demotion; additive same-era **age-consistency** support; runner-up margins |
| Cross-age | multi-age enrollment; relaxed_child band; **per-age-gap DET report**; **§5.4 capture-date provenance** governance (EXIF vs mtime → unverified gaps downgraded to "estimated") |
| Fairness/Eval | **per-cohort fairness** report; real harness — **TAR@FAR, DET, EER, accuracy@EER, open-set FNIR@FPIR**, identity-level **bootstrap CIs**, honest resolvable-FAR floor |
| Clustering | license-clean **cosine kNN-graph + connected-components** (PCA/copyleft dropped); **one global pass** (fixed per-batch fragmentation) |

**Implication:** further investment in calibration math or detection models yields little. The roadmap below is
deliberately weighted to **upstream (alignment, video) + review-UX (active learning) + the one backbone win.**

---

## 4. The ceiling, quantified (why this is the right roadmap)

| Axis | Where we sit | Remaining (constrained) |
|---|---|---|
| Decision / calibration / eval / governance | **at ceiling** | ~0 |
| Detection model | **at license-clean WIDER-Hard ceiling** (multi-scale+tiling) | ~0 |
| Recognition backbone | open-research SOTA tier (~97.5% IJB-C@1e-4) | **+1–4pp at strict FAR** via LVFace; **+19pt on MFR-Children**¹ |
| Alignment / crop quality | fixed 5-pt `norm_crop`, **no failure path** | **+2–5pp on the child tail** (crop quality swings child TAR up to 88pt) |
| Video ingest | uniform sampling, all-frames, no per-track aggregation | quality keyframe + pooling (throughput + modest recall) |
| Decision pooling / cohort-norm | top-3 heuristic; no cohort normalization | **+1–3pp** (pooling) / **+2–2.5pp@1e-4** (AS-norm) |
| On-device personalization | global calibrator only | **+1–3pp** on the user's hard pairs (label-starved) |
| Cross-age child→adult | near the honest ceiling | **fundamentally capped ~50–75%** |

¹ MFR-Ongoing "Children" (2–16, strict FAR): shipped `glintr100` = 75.20% vs LVFace-L = 94.31% (self-reported,
not NIST; one verifier disputed the column reading — treat as *likely-large but unproven on-device*). It is a
child-to-child benchmark, **not** child→adult-across-decades.

---

## 5. The Phase 4 plan (ranked by real gain-per-effort)

Each item: **what / why / where / effort / expected gain / risk / validation.** Ordering is the ceiling
critic's ranking, adjusted for this app.

### 5.1 — Activate LVFace in the recognizer seam  ·  Effort **S**  ·  the cheap backbone win
- **What:** drop the LVFace ONNX (ViT-B as default; **lean ViT-L for the child axis**) into `models/`, set
  `config.recognizer_filename`, re-enroll, recalibrate (the calibrator is already model-tagged, so a stale
  calibrator is auto-refused).
- **Why:** +1–4 TAR points at the strict FAR the app operates at; the child-track delta may be large (¹).
  This is the one "done-elsewhere-but-not-here" item and it is config-only.
- **Where:** `embed/engine.py` (`apply_recognizer_preference` L147-161, `_candidate_model_paths`, `_recognize`),
  `config.py` (`recognizer_filename`, `calibration_model`).
- **Risk / gotchas (verified, must gate the merge on a one-time export-validation script):**
  - InsightFace `model_zoo` routes an ONNX to the recognizer **only** when input is square, ≥112, %16==0, with
    **exactly one output** — a ViT export with a dynamic/non-square axis or >1 output silently fails to load.
  - `ArcFaceONNX` flips to mean=0/std=1 if any of the first 8 graph nodes is named `Sub*`/`Mul*` — a ViT that
    bakes in normalization gets **silently wrong preprocessing → garbage embeddings.** Verify
    112×112 / BGR→RGB / (x−127.5)/127.5 / 512-d.
  - "ViT-B is cheaper than R100 on CPU" is **false** (11.4 vs 12.1 GFLOPs; ViT attention slower per-FLOP, CoreML/DirectML
    may fall back to CPU). Budget **similar-or-worse latency**; gate ViT-L behind a performance mode / quantization.
  - Weights are **non-commercial-research-only** — fine single-user, **blocks any commercial build.**
- **Validation:** re-run the DET/TAR@FAR harness + per-age-gap + per-cohort slices on the user's labels; promote
  only if it wins on the held-out split.

### 5.2 — Alignment-failure detection + re-align/re-embed + review demotion  ·  Effort **S–M**  ·  the biggest TRUE lever
- **What:** detect bad alignments (low landmark confidence / large residual after the similarity fit); (a) try
  an alternate crop / 2-D warp and re-embed, and (b) **demote** unfixable ones in review ordering.
- **Why:** the literature shows child TAR swings **7%→95% on crop quality alone** — for this app's headline
  child↔adult cohort, **mis-alignment is the likely dominant error, not backbone separability.** It sits
  *upstream of and is unrecoverable by* every model swap. Plausibly **+2–5pp recall on the hard tail.**
- **Where:** `embed/engine.py` (the `norm_crop` path in `_recognize`; add a landmark-quality gate beside
  `_pose_bucket_for_face`); surface the flag to review ordering in `enroll/manager.py`.
- **Risk:** a bad dense-landmark fit can *worsen* alignment vs the robust 5-pt transform — must A/B-gate and
  fall back to 5-pt. License-clean (RetinaFace/3DDFA-style ONNX landmarks exist).
- **Validation:** per-age-gap DET on the child band before/after; must not regress frontal.

### 5.3 — Self-consistency-weighted template & video-track pooling  ·  Effort **S–M**  ·  free, upstream
- **What:** replace the top-3 support heuristic (decision path) and the naive mean (clustering path) with
  pooling **weighted by embedding-norm + intra-set agreement** (distance-to-medoid); group video frames into
  tracks and pool per track. Add **quality-ranked video keyframe selection** (variance-of-Laplacian + FIQA)
  to replace uniform sampling.
- **Why:** a personal library is rich in multi-shot identities and home video; self-consistency is a **free
  substitute for the un-pulled FIQA model** (no new weights) and unblocks ~half the pooling gain today.
  ~**+1–3pp at strict FAR** on multi-reference/video; keyframe selection is mostly a **throughput** win
  (1.3–2× on long clips) with modest recall benefit.
- **Where:** `match/scoring.py` (`group_hits` fusion), `cluster/clusterer.py` (pooling), `ingest/video_io.py`
  (`sample_video_frames`), `enroll/manager.py` (per-track grouping).
- **Risk:** must degrade gracefully to current behavior with one reference/frame (preserve recall); keep weights
  conservative for low-norm **young** child photos (informative, not noise); track-purity guard so two people in
  one shot aren't merged.
- **Validation:** multi-reference + video slices of the harness; per-age-gap DET to confirm no cross-age suppression.

### 5.4 — Active-learning review ordering + per-decision abstention  ·  Effort **S–M**  ·  the biggest *perceived* gain
- **What:** order the review queue by **uncertainty × diversity** (and predicted confidence); add a calibrated
  **abstention band** that pushes information-limited tiny/extreme-gap faces *out* of the ranked queue.
- **Why:** for a review-first single-user app this moves the real product metric — it reaches the same recall
  with **30–70% fewer reviewer clicks**, and it is the feed that makes the calibration flywheel converge faster.
- **Where:** `enroll/manager.py` (candidate query/ordering), reusing calibrated `match_probability` + the open-set
  FNIR@FPIR machinery already in the harness.
- **Risk:** none technical; conservative-by-default keeps the relaxed_child band visible.
- **Validation:** measure clicks-to-first-true-match on labeled runs; recall-at-fixed-budget, not TAR.

### 5.5 — Cohort score normalization (AS-norm / IDA) with a bundled cohort  ·  Effort **M**
- **What:** normalize `raw_cosine` against a **small fixed/synthetic impostor cohort** (bundled once, offline)
  *before* the Platt map. (This revives the Phase-1-refuted AS-norm: the earlier blocker — "no persisted
  cohort" — is resolved by IDA's finding that a generic/synthetic cohort suffices, *"the specific ID is not
  important"*.)
- **Why:** **+2–2.5pp TAR@FAR=1e-4**, concentrated exactly at the conservative thresholds this consent-first app
  uses (shrinks to +0.3–0.8pp at lenient FAR); stabilizes the per-query operating point as the library grows.
- **Where:** `match/calibration.py` (new `CohortNormalizer`), called in `match/scoring.py` before banding.
- **Risk:** **most threshold-transfer-fragile** of all levers — genuine TMR can move **−0.8% to +9.2%**; a
  mismatched cohort *degrades* thresholds. **Must ship behind the §6 validation gate** with a minimum-cohort gate.
- **Validation:** mandatory held-out per-user slice; refit Platt on normalized scores; per-cohort fairness check.

### 5.6 — On-device per-identity adaptation + optional 2-model fusion  ·  Effort **M–L**  ·  build last
- **What:** a frozen-backbone **per-identity linear probe / last-layer adapter** trained on the user's
  accept/reject labels (ONNX Runtime on-device training, frozen params + `requires_grad` on the head only —
  no PyTorch at runtime); optionally a **2-model cross-family score fusion** (R100 + LVFace) **on the small
  review candidate set only**.
- **Why:** the lever benchmark systems *cannot* use — a single-user app can adapt to its own labels. ~**+1–3pp**
  on the user's hard pairs; fusion adds ~+1–2.5pp at strict FMR on the candidate set.
- **Where:** new `match/personalize.py`; `embed/engine.py` for the candidate-set fusion path (mirror flip-TTA gating).
- **Risk:** label scarcity → overfitting (bound to last-layer/adapter, **never** backbone retraining); fusion
  doubles candidate-set compute (keep off the full-library sweep); needs a fused calibrator.
- **Validation:** held-out per-user; abort if it doesn't beat the global calibrator on that user's slice.

### 5.7 — Fetch the eDifFIQA(T) ONNX (unblocks 5.3)  ·  Effort **S**
- **What:** drop `ediffiqa_tiny_jun2024.onnx` (~7.3 MB, MIT, OpenCV Model Zoo) into `models/fiq/` — the seam
  already exists (`embed/fiqa.py`).
- **Why:** upgrades quality-weighting/keyframe selection from the norm/self-consistency proxy to a real
  recognition-aware FIQA (EDC pAUC ~0.77→~0.68); trims unrecoverable tiny/blurry faces from review.
- **Risk:** only blocker is fetching the file offline; calibrate the cut conservatively so genuine low-quality
  **child** faces are not over-filtered.

---

## 6. Cross-cutting enabler — the per-user validation gate (do this FIRST)

**Before any of §5.5–5.6 (and ideally §5.1–5.3) is allowed to move a live threshold**, add a mandatory
**held-out per-user validation gate**: split the user's accept/reject labels, fit/adapt on train, and **promote
the change only if it wins (CI lower bound) on the disjoint test fold.** The DET/bootstrap-CI harness already
has the machinery; this is the wiring that converts paper gains into real ones and the guardrail that makes the
fragile levers (AS-norm, personalization) safe to ship. **Effort M. Highest-leverage non-accuracy item in the plan.**

---

## 7. Deferred / out-of-scope (with reasons)

| Item | Why deferred |
|---|---|
| Rescue-union / early-break rework (Phase 1.4 other half) | cross-canvas coordinate bugs flagged by verification; **tiling already covers the small-face case** |
| Cross-scan **incremental** clustering | needs net-new candidate-embedding persistence (`ReviewCandidate` stores no vector); per-scan global pass shipped |
| Face **super-resolution / restoration into the embedding** | **out of bounds** — restoration *hallucinates* identity below the IED floor; a consent-gated reviewer must never be fed invented identity. Display-only triage is the *only* safe use |
| Closed on-prem SDK (NEC/Idemia) | breaks cost ($thousands–tens-of-thousands/yr) + clean ONNX architecture; edge is **adult aging**, not child→adult |
| Cloud APIs | break offline + consent; **no NIST-verified cross-age advantage**; deletes the product |
| Backbone retrain / fine-tune on non-clean data | label scarcity forbids it on-device; off-device pooling forbidden by privacy; ~0 marginal over LVFace |

---

## 8. Prioritization & sequencing

### 8.1 Prioritization table

| # | Lever | Effort | Expected gain (where) | Risk | Gated by §6 |
|---|---|:--:|---|:--:|:--:|
| 6 | **Per-user validation gate** | M | enables/derisks everything | low | — |
| 5.2 | **Alignment-failure handling** | S–M | +2–5pp child tail | med | yes |
| 5.1 | **LVFace activation** | S | +1–4pp strict FAR (+child) | low* | yes |
| 5.3 | **Self-consistency pooling + video keyframes** | S–M | +1–3pp multi-ref/video | low | yes |
| 5.4 | **Active-learning ordering + abstention** | S–M | 30–70% fewer clicks | low | partial |
| 5.7 | **eDifFIQA model fetch** | S | unblocks 5.3 | low | — |
| 5.5 | **Cohort AS-norm** | M | +2–2.5pp@1e-4 | **high** | **yes** |
| 5.6 | **On-device personalization + fusion** | M–L | +1–3pp user pairs | med | **yes** |

\* low engineering risk, but the export-validation gotchas in §5.1 are mandatory; licensing blocks commercial builds.

### 8.2 Recommended sequencing
1. **Foundation:** §6 validation gate + §5.7 eDifFIQA fetch (both small, both unblock the rest).
2. **Upstream recall (the real mission):** §5.2 alignment-failure handling → §5.3 self-consistency pooling +
   video keyframes. These target the child/low-quality/video tail and are unrecoverable downstream.
3. **Bank the cheap backbone win:** §5.1 LVFace activation (behind the export-validation script + the gate).
4. **Review-UX multiplier:** §5.4 active-learning ordering — converts the above into fewer clicks.
5. **Fragile / last:** §5.5 cohort AS-norm, then §5.6 personalization — only behind the validation gate.

Expected cumulative (non-additive, hard tail): **~+5 to +12pp recall at the strict-FAR / fixed-review-budget
operating point**, plus a 30–70% reduction in reviewer effort. Near-zero on easy frontal photos (already saturated).

---

## 9. Risks, guardrails & out-of-bounds

- **The physics cap is real and must be communicated, not engineered around.** Child→adult >~6–8yr is
  ~50–75% usable recall (youth penalty ~40–60× FNMR at ages 1–4 + craniofacial growth drift); below ~20px IED
  identity is physically absent. Keep the "aging is never confirmed identification" stance; never auto-accept
  cross-age. Restoration into the embedding is **prohibited** (manufactures false identity).
- **Threshold transfer is the silent failure mode.** No adaptive change ships without the §6 gate. AS-norm and
  personalization are the highest-fragility items — minimum-cohort/minimum-label gates + abort-on-no-win.
- **Licensing fork.** Single-user/personal use tolerates research weights (LVFace/glint360k). **A
  commercial/redistributable build cannot** — it must switch to AuraFace-class commercial-clean weights at a
  ~1.5–2.1 cross-age-point penalty, or license SDK/data. Surface this in the model manifest (already tagged).
- **Open-set reality.** FPIR ≈ N × FMR: false alarms scale with library size; the consent-gated human review is
  the only mitigation and must not be diluted. Beware single-reviewer fatigue (the real-world cap) — §5.4
  abstention directly protects it.
- **Fairness is a gating prerequisite, not a footnote.** Pooled numbers hide subgroup disparity; keep per-cohort
  DET on every adaptive change (age-gap band at minimum; the app does not infer protected attributes by design).

---

## 10. Appendix

### 10.1 The ceiling, in numbers (NIST/benchmark-anchored)
- Absolute embedding SOTA: IJB-C ~97.7–98.0%@1e-4 / ~97.0–97.3%@1e-5 (UniTSFace/PartialFC/TopoFR/LVFace ViT-L,
  WebFace42M). High-quality 1:1 sets saturated (LFW >99.8%, AgeDB-30 ~98%). TinyFace Rank-1 caps ~75.8% (physics).
- Shipped: `glintr100` ~97.4%@1e-4 / ~96.0%@1e-5; constrained-ceiling lift via LVFace ~+0.3–0.5@1e-4, ~+1–2@1e-5,
  ~+1.5–4@1e-6; MFR-Children 75.20→94.31 (self-reported).
- Closed on-prem (NEC nec_010, NIST FRTE 1:N): Mugshot 12+yr FNIR@FPIR=0.003 **0.0019** vs open lineage
  `deepglint_001` **0.0236** (~12× lower error, adult aging only).
- Child longitudinal (NIST IFPC 2025 / YFA, MagFace): TAR@0.1%FAR 2yr 98.5% → 4yr 95.7% → 6yr 87.2% → 8yr 71.3%;
  3–5yr enrollment collapses to ~63%. Commercial-clean ceiling (AuraFace): AgeDB 96.10 / CALFW 94.70.

### 10.2 Key sources
LVFace ICCV 2025 (arXiv 2501.13420; HF `bytedance-research/LVFace`); TopoFR NeurIPS 2024 (arXiv 2410.10587);
AdaFace CVPR 2022 (arXiv 2204.00964) / CVLface; KP-RPE CVPR 2024 (arXiv 2403.14852); CAFace NeurIPS 2022
(arXiv 2210.10864); IDA / score-norm fairness (arXiv 2407.14087); eDifFIQA TBIOM 2024 (OpenCV Model Zoo);
NIST FRTE 1:1 & 1:N (pages.nist.gov/frvt); NIST IFPC 2025 child-longitudinal; "50 Years of Automated Face
Recognition" (arXiv 2505.24247); YFA child aging (arXiv 2408.07225); HDA-SynChildFaces (arXiv 2304.11685).

### 10.3 Open questions
- Does the MFR-Children +19pt (LVFace-L vs glintr100) survive on *this* app's data, or is it benchmark-specific?
  (Resolve via §6 on a labeled child slice before committing ViT-L's latency.)
- Is on-device last-layer training (ORT) fast/robust enough on the median consumer machine to be default-on, or
  opt-in for power users?
- What is the smallest bundled/synthetic impostor cohort that makes AS-norm net-positive across diverse libraries?

---

## 11. Implementation status (this branch)

All §5 + §6 levers are implemented and unit-tested (TDD). New `npm run` gates:
`test:validation`, `test:pooling`, `test:model-validation` (plus the existing
`scoring`/`calibration`/`detection`/`det-eval`/`clustering`/`fiqa`/`edge` suites).

| Lever | Status | Where |
|---|---|---|
| §6 held-out validation gate | ✅ done | `match/validation.py` (`held_out_gate`, `split_by_identity`); wired to the global calibration via `ProjectState.validate_calibration_change` |
| §5.2 alignment-failure signal + demotion + abstention | ✅ done | `engine.alignment_error` captured → `scoring._demote_alignment_suspect` → `review_order` low-information lane |
| §5.2 re-align/re-embed fallback | ⏸ deferred | needs an alternate landmark hypothesis + A/B gate; the signal+demotion+abstention deliver the safe value |
| §5.3 self-consistency pooling | ✅ done | `match/pooling.py` (`pool_template`, `self_consistency_weights`) + `ProjectState.person_template` |
| §5.3 sharpness video keyframes | ✅ done | `ingest/video_io.py` `variance_of_laplacian` + `_sharpest_in_window` (window=1) in the decode loop |
| §5.4 active-learning review ordering + abstention | ✅ done | `match/review_order.py` (`review_lane`, `review_priority`) wired into candidate creation + queue sort |
| §5.5 cohort AS-norm | ✅ done | `calibration.as_norm_score` + `CohortNormalizer`; `scoring._demote_low_cohort_separation` auto-derives the impostor cohort from other-person hits (no new store) |
| §5.6 per-identity personalization | ✅ done | `calibration.fit_per_identity_calibrators` + `config.calibration_platt_by_person` + `ProjectState.apply_personalized_calibration` + `match_probability(person_name=)` |
| §5.6 2-model fusion | ✅ primitive | `calibration.fuse_scores` (score-level); live 2-model path pends a 2nd recognizer weight |
| §5.1 recognizer drop-in validation | ✅ done | `embed/model_validation.py` (`assess_recognizer_io`, `validate_recognizer_onnx`) + `ProjectState.validate_drop_in_recognizer` (catches the square-%16/single-output routing + Sub/Mul normalization-flip traps) |
| §5.1 LVFace activation / §5.7 eDifFIQA | ⏸ drop-in ready | seams + validation in place; the actual non-commercial/MIT ONNX weights must be fetched (can't be obtained offline here) |

**Design invariants honored:** every scoring change is precision-only and **never** touches
the cross-age relaxed band (recall-safe); every adaptive change is same-embedding-space
(model-pack-tagged) and either §6-gated (global) or label-count-guarded (per-identity);
no backbone retraining (last-layer/calibrator only); all primitives are pure NumPy,
offline, license-clean.

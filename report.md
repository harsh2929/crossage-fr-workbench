# Building a Production-Grade Cross-Age Face Recognition Pipeline (Childhood → Adulthood): 2026 Validated & Updated Technical Specification

## TL;DR
- **The accuracy ceiling is real and the original report's pessimism is validated by 2026 evidence**: wide-gap child→adult matching remains unsolved (NIST IFPC 2025: TAR@0.1%FAR falls from 98.5% at a 2-year gap to 71.3% at 8 years; Ricanek ITWCC's 24% TAR@0.1%FAR / ~25% rank-1 figures stand). Build for *recall-first, human-in-the-loop review*, not autonomous identification.
- **Swap the recognition core to a 2026 SOTA model**: use InsightFace `antelopev2` (ResNet-100 @ Glint360K) or `buffalo_l` as the production default, and treat **TopoFR (NeurIPS 2024, AgeDB-30 98.7%)** and AdaFace as upgrades. Keep the ArcFace/AdaFace architecture; the original AdaFace/ArcFace benchmark numbers are accurate.
- **Adopt a new multi-platform auto-detecting pipeline**: ONNX Runtime + CoreML EP on Apple Silicon (the standalone `onnxruntime-silicon` package is **dead** — use mainline `onnxruntime`), ONNX Runtime + TensorRT/CUDA + FAISS-GPU on NVIDIA, and ONNX Runtime/OpenVINO INT8 + faiss-cpu on CPU.

## Key Findings (claim-by-claim validation)

### 1. Accuracy ceiling for child→adult matching — VALIDATED, with 2026 updates
- **Ricanek et al. (ITWCC)**: VERIFIED. Average enrollment age 10.2 years; 24% verification TAR @ 0.1% FAR; ~25% closed-set rank-1 identification. Confirmed verbatim across multiple longitudinal-study papers (e.g., Bahmani/Schuckers and the Identity-Document-to-Selfie-Across-Adolescence survey).
- **Bahmani et al. "Face Recognition in Children: A Longitudinal Study" (arXiv:2204.01760, IWBF 2022)**: VERIFIED. The YFA dataset + quality-aware **MagFace yields 98.3% and 94.9% TAR @ 0.1% FAR over 6- and 36-month gaps** respectively — confirmed verbatim from the abstract. The paper's central finding: prior low child-FR numbers were partly an artifact of matcher intra-class structure and sample quality, and FR is "feasible for children for age-gaps of up to three years." The MORPH-II/CACD-VS/AgeDB TAR-drop figures cited in the original report are consistent with the paper.
- **Best-Rowden et al. (NITL)**: VERIFIED. **47.93% TAR @ 0.1% FAR for the 0–4 age group at a 6-month gap**; reliable recognition feasible only when enrolled at age 3+.
- **Inter-Prototype (Lee, Yun, Park, Kim & Choo, BMVC 2021, arXiv:2110.11630)**: VERIFIED. ResNet-50 on MS1MV2; the novel Inter-Prototype loss **minimizes inter-class similarity among child images** (rather than only increasing child↔adult intra-class similarity) and beats the ArcFace baseline on AgeDB-C20/C30 and LAG verification and rank-1 identification, without extra child images or learnable parameters.
- **NEW (2025–2026)**:
  - **NIST IFPC 2025 child evaluation** (Singh & Schuckers, "Longitudinal Evaluation of Child Face Recognition," MagFace on YFA) reaffirms the wall: overall **MagFace TAR = 95.48% @ 0.1% FAR**, but age-gap TAR@0.1%FAR collapses: **98.5% (2-yr) → 95.7% (4-yr) → 87.2% (6-yr) → 71.3% (8-yr)**, with 63.1% for the youngest brackets. Conclusion: "Recognition accuracy declines significantly beyond a 4-year age gap." MTCNN/RetinaFace gave the best child detection accuracy.
  - **arXiv:2601.01689 (Jan 2026, Hossain & Schuckers)** — StyleGAN2-ADA synthetic augmentation + MagFace fine-tuning cuts child longitudinal **EER from 2.49% → 0.98% at a 36-month gap** (real+synthetic vs pretrained), a ~60% relative error reduction. **Caveat: this is child→child short/medium gap (≤36 months), NOT wide child→adult.**
  - **arXiv:2601.01680 (2026)** — infant/toddler FR remains very weak: only **30.7% TAR@0.1%FAR at 0–6 months**, improving to 64.7% at 2.5–3 years; a Domain-Adversarial Neural Network adds +12% TAR.
  - **Conclusion: no published 2025–2026 model breaks the wide-gap child→adult ceiling.** Design accordingly.

### 2. Best models on age-cross benchmarks — VERIFIED and UPDATED
- **AdaFace (Kim, Jain & Liu, CVPR 2022, arXiv:2204.00964)**: VERIFIED verbatim from the paper's table. R100/MS1MV2 (m=0.4): **AgeDB 98.05, CALFW 96.08**; R100/WebFace12M AgeDB ~98.00, CALFW ~96.12. **ArcFace (m=0.50, MS1MV2): AgeDB 98.28, CALFW 95.45** — VERIFIED. (The original report's R100/WebFace4M AdaFace AgeDB 99.17 is the higher-data variant and is in-line with WebFace-trained gains.)
- **NEW SOTA (2023–2026)**:
  - **TopoFR (NeurIPS 2024, Dan et al.)** — uses persistent-homology topology alignment (PTSA) + structure-damage hard-sample mining (SDE). **R50/MS1MV2: AgeDB-30 98.25, CFP-FP 98.24, LFW 99.83; R100: AgeDB-30 98.72, CFP-FP 99.43.** On Glint360K it surpasses AdaFace and TransFace and ranks **#2 on the academic MFR-Ongoing leaderboard** (as of May 2024) with the best "Children" sub-score (93.57). **Strongest open ResNet face model as of 2026.**
  - **TransFace (ICCV 2023)** — ViT-based; near-saturation parity with AdaFace/TopoFR on AgeDB-30/LFW, strong on IJB-C; TransFace++ extends it to privacy-preserving FR.
  - **UniFace (ICCV 2023)** and **Partial FC (CVPR 2022)** remain MFR-Ongoing leaders for the children/multi-racial sub-tracks.
  - Foundation models (DINOv2, CLIP) underperform dedicated FR models on AgeDB-30/CALFW/IJB-C (per the "FRoundation" study) — do not substitute them.
- **InsightFace packs (VERIFIED from official model_zoo README)**: `buffalo_l` = SCRFD-10GF detector + **ResNet-50 @ WebFace600K** (LFW 99.83, CFP-FP 99.33, **AgeDB-30 98.23, IJB-C(E4) 97.25**, 326 MB); `antelopev2` = SCRFD-10GF + **ResNet-100 @ Glint360K** (higher accuracy, 407 MB). WebFace600K = WebFace12M (12M images, 600K identities); Glint360K = 17.1M images / 360K identities.

### 3. Apple Silicon compatibility — UPDATED for 2026
- **Confirmed lineup (mid-2026)**: M5 (Oct 2025, base 14″ MacBook Pro) → M5 Pro & M5 Max (March 2026, 14″/16″ MacBook Pro, "Fusion Architecture," up to 18-core CPU; M5 Max up to 128 GB / 614 GB/s) → M5 MacBook Air (March 2026). Desktops (Mac mini, Mac Studio) **still ship M4-series / M3 Ultra** as of mid-2026; M5 desktop versions expected later in 2026, delayed by DRAM shortages. **Mac Pro discontinued March 2026; no M5 Ultra shipping yet as of June 2026.**
- **PyTorch MPS**: stable in PyTorch 2.x; requires macOS 12.3+ and a **native arm64 Python** (Rosetta/x86 Python makes MPS report unavailable); `PYTORCH_ENABLE_MPS_FALLBACK=1` for unsupported ops; bf16/fp16 supported (bf16 requires macOS 14+); **no Tensor-Core-style AMP speedups**; the Neural Engine is not directly used by MPS (GPU only). (Note: a tracked PyTorch issue exists for MPS availability on very new macOS 26 "Tahoe" builds — pin a known-good torch build.)
- **ONNX Runtime + CoreML EP (critical correction)**: **`onnxruntime-silicon` is effectively ABANDONED** — last release v1.16.3 (Jan 19, 2024), Python ≤3.11 only. **Mainline `onnxruntime` now ships native macOS arm64 wheels with `CoreMLExecutionProvider` bundled** (confirmed: `onnxruntime.__version__ '1.23.1'` exposing `['CoreMLExecutionProvider', …]` on macOS). The current stable line supports Python 3.11–3.14. Use provider options `ModelFormat=MLProgram` (requires CoreML 5 / macOS 12+), `MLComputeUnits=ALL`. **Do not depend on `onnxruntime-silicon`.**
- dlib/`face_recognition` arm64 build pain and CompreFace x86/AVX dependence still apply — avoid both in favor of ONNX Runtime + InsightFace.

### 4. Multi-platform auto-detecting pipeline — NEW (full code in Details)
- **Apple Silicon** → ORT CoreML EP (+ MPS for any PyTorch models) + faiss-cpu, float32.
- **NVIDIA** → ORT TensorRT EP (fallback CUDA EP) + FAISS-GPU (`faiss-gpu-cu12`, or `faiss-gpu-cuvs` for CUDA 13.x) + FP16.
- **CPU** → ORT CPU EP or OpenVINO EP (Intel) + INT8 quantization + faiss-cpu.

### 5. Pipeline components — VERIFIED, with upgrades
- **Detector/alignment**: SCRFD (bundled in buffalo_l/antelopev2) and YuNet (OpenCV) remain excellent. 2024–2025 YOLO-face variants (YOLOv8-face, ADYOLOv5-Face, GCS-YOLOv8) are competitive on WIDER FACE hard subsets (and sometimes better on tiny faces), but **SCRFD-10GF + 5-point alignment remains the production-safe default** because it is bundled and matches the recognition model's expected preprocessing.
- **Vector store**: **FAISS remains best for self-hosted.** IndexFlatIP for <1M vectors (exact, cosine after L2-norm); IVF or HNSW for >1M (HNSW ≈0.17 ms vs IVF ≈0.34 ms vs Flat ≈12.4 ms on 10M vectors, ~2× memory for HNSW). FAISS v1.10 integrated NVIDIA cuVS: per Meta Engineering (May 8, 2025), "CAGRA outperforms CPU Hierarchical Navigable Small World graphs (HNSW) build times by up to 12.3x; and search latency is reduced by as much as 4.7x," and IVF builds up to 4.7× faster with search latency reduced as much as 8.1×. Qdrant/Milvus/LanceDB are alternatives only if you need a managed/persistent DB service rather than an in-process index.
- **Clustering**: **HDBSCAN is the default** (no epsilon/cluster-count needed; handles varying density) with **DBSCAN fallback when HDBSCAN returns only noise**; Chinese Whispers (dlib) remains competitive and some report it beating HDBSCAN/DBSCAN on InsightFace embeddings. Use cosine distance; reduce dimensionality only cautiously (HDBSCAN degrades in very high dimensions). Graph-based learned clustering (GCN-V+E, LTC) leads academic benchmarks if you need scale.
- **FIQA**: CR-FIQA (CVPR 2023) remains strong; newer options are **CLIB-FIQA (CVPR 2024)** and **GraFIQs (CVPRW 2024, training-free, gradient-based)**. The **ISO/IEC 29794-5:2025** standard now defines reference face-quality measures. AdaFace feature-norm is a cheap built-in proxy.
- **Score fusion**: sum rule with min-max normalization remains a validated biometric score-fusion best practice; Srinivas et al. specifically identified best score-level fusion for the child demographic.
- **EXIF/HEIC**: Pillow + pillow-heif + ExifRead remain current best practice; always apply EXIF-orientation correction before detection.

### 6. Thresholds — VERIFIED
- **InsightFace ArcFace cosine**: ~0.35–0.40 confident match; relaxing to 0.20–0.28 for child buckets is a sound recall-first heuristic (always recalibrate on your data). Input: **112×112 aligned crop, 512-d embedding, cosine similarity** — verified.
- **AdaFace normalization**: 112×112 BGR, (x/255−0.5)/0.5 — VERIFIED against the official repo.
- **DeepFace defaults**: ArcFace threshold 0.68, Facenet512 0.30, VGG-Face 0.40 — VERIFIED. Note DeepFace expresses these as **distance** (≈1−cosine) thresholds, not similarity; don't confuse them with InsightFace similarity thresholds. (Empirically, ArcFace @ FMR=0.1% lands near 0.498 cosine distance on some datasets — calibrate.)

### 7. Workflow levers — VALIDATED
Multi-reference age-bucketed enrollment, score-level fusion (sum rule), threshold relaxation for recall, quality-aware filtering, and cluster-then-review all remain best practice in 2026 and are directly supported by the child-FR literature (multi-reference + fusion materially help the child demographic).

### 8. Performance/speed claims — PLAUSIBLE/VERIFIED
- ONNX Runtime ~3.2× throughput at batch=8 vs batch=1: plausible and consistent with batching/dispatch-amortization behavior; benchmark on target hardware.
- FAISS adds 1M 128-d vectors to a flat index in ~0.2s: consistent with documented FAISS performance (flat index needs no training).
- FP16 ONNX sometimes slower under CoreML EP: VERIFIED behavior — CoreML may not benefit from pre-converted FP16 and can add overhead; prefer FP32 ONNX + `MLComputeUnits=ALL` and let CoreML manage precision.
- float64 lacks native Apple GPU support: VERIFIED — use float32 on MPS/CoreML.

### 9. Legal/privacy — UPDATED for 2026
- **GDPR Article 9**: biometric data processed "for the purpose of uniquely identifying a natural person" is special-category — explicit consent or another Art. 9(2) basis required; DPIA mandatory for large-scale biometric processing; right to erasure applies.
- **EU AI Act (Reg. (EU) 2024/1689)**: in force since 1 Aug 2024; **prohibitions** (real-time public biometric ID by law enforcement, untargeted internet face-scraping for databases) apply since **2 Feb 2025**; **high-risk obligations** for biometric-ID systems apply from **2 Aug 2026** (conformity assessment, bias testing, EU database registration). Penalties up to €35M or 7% of global turnover.
- **US**:
  - **Illinois BIPA** — $1,000 (negligent) / $5,000 (willful) statutory damages with a **private right of action**. The Aug 2, 2024 amendment (SB 2979) limits repeated collection of the same identifier from the same person to a **single violation** (ending per-scan damage stacking) and **expressly permits electronic signatures** for written consent.
  - **Texas CUBI** — on July 30, 2024, Texas AG Ken Paxton announced **Meta agreed to pay $1.4 billion over five years**, the first CUBI settlement and "the largest settlement ever obtained from an action brought by a single State." Enforcement is AG-only (no private right of action).
  - **Colorado** — HB 24-1130 (amending the Colorado Privacy Act), effective **July 1, 2025**, requires a written policy covering retention schedules, data-incident response, and deletion, plus consent before collecting/processing biometric identifiers; AG/DA enforcement.
  - **Landscape**: 20+ states with comprehensive privacy laws now classify biometric data as "sensitive," but only **three states (Illinois, Texas, Washington)** have broad standalone biometric privacy statutes; new laws (Delaware, New Jersey) took effect in early 2025.
- **Licensing**: InsightFace **code and pretrained models are MIT-licensed for code & inference**, but the underlying **training datasets (MS1MV2 / Glint360K / WebFace) are restricted to non-commercial research only** — a commercial deployment must license commercial weights from InsightFace or train on a properly licensed dataset.

## Details

### Tech stack table

| Component | Apple Silicon | NVIDIA CUDA | CPU fallback |
|---|---|---|---|
| Inference runtime | `onnxruntime` (CoreML EP) | `onnxruntime-gpu` (TensorRT/CUDA EP) | `onnxruntime` or `onnxruntime-openvino` |
| Recognition model | antelopev2 / buffalo_l (ONNX) | antelopev2 / buffalo_l / TopoFR | buffalo_l (INT8 optional) |
| Detector | SCRFD-10GF (bundled) | SCRFD-10GF | SCRFD-2.5GF |
| Vector store | faiss-cpu | faiss-gpu-cu12 / faiss-gpu-cuvs | faiss-cpu |
| Clustering | HDBSCAN (+DBSCAN fallback) | HDBSCAN | HDBSCAN |
| FIQA | CR-FIQA / AdaFace norm | CR-FIQA | CR-FIQA(S) |
| EXIF/HEIC | pillow-heif, ExifRead | same | same |
| Precision | FP32 | FP16 (TensorRT) | INT8 (NNCF/ORT) |

### Install commands

**Apple Silicon (M-series):**
```bash
# native arm64 Python required (3.12 recommended)
pip install onnxruntime            # CoreML EP bundled; do NOT use onnxruntime-silicon
pip install insightface faiss-cpu hdbscan pillow pillow-heif ExifRead numpy scikit-learn
pip install torch torchvision      # MPS backend included in the macOS arm64 wheel
```

**NVIDIA CUDA:**
```bash
pip install onnxruntime-gpu        # CUDA + TensorRT EPs
pip install insightface hdbscan pillow pillow-heif ExifRead numpy scikit-learn
# FAISS GPU (CUDA 12.x) via conda (official):
conda install -c pytorch -c nvidia -c conda-forge faiss-gpu=1.14.2
# or pip wheel (community, Compute Capability 7.0–8.9):
pip install faiss-gpu-cu12
# CUDA 13.x with cuVS/CAGRA:
conda install -c pytorch -c nvidia -c rapidsai -c conda-forge libnvjitlink faiss-gpu-cuvs=1.14.2
```

**CPU fallback:**
```bash
pip install onnxruntime faiss-cpu insightface hdbscan pillow pillow-heif ExifRead numpy scikit-learn
pip install onnxruntime-openvino   # optional, Intel CPUs (INT8 via NNCF)
```

### Platform detection + provider selection (reference code)
```python
import platform
import onnxruntime as ort

def detect_platform() -> str:
    machine = platform.machine().lower()
    system = platform.system().lower()
    avail = ort.get_available_providers()
    if system == "darwin" and machine in ("arm64", "aarch64"):
        return "apple_silicon"
    if "TensorrtExecutionProvider" in avail or "CUDAExecutionProvider" in avail:
        return "nvidia"
    return "cpu"

def get_providers(plat: str):
    if plat == "apple_silicon":
        return [
            ("CoreMLExecutionProvider", {
                "ModelFormat": "MLProgram",        # CoreML 5+ / macOS 12+
                "MLComputeUnits": "ALL",           # CPU + GPU + ANE
                "RequireStaticInputShapes": "0",
            }),
            "CPUExecutionProvider",
        ]
    if plat == "nvidia":
        return [
            ("TensorrtExecutionProvider", {"trt_fp16_enable": True}),
            ("CUDAExecutionProvider", {}),
            "CPUExecutionProvider",
        ]
    # CPU: swap in ("OpenVINOExecutionProvider", {"device_type": "CPU"}) on Intel
    return ["CPUExecutionProvider"]

PLAT = detect_platform()
session = ort.InferenceSession("w600k_r50.onnx", providers=get_providers(PLAT))
# Always verify the EP actually bound:
assert session.get_providers()[0] != "CPUExecutionProvider" or PLAT == "cpu"
```

InsightFace device selection:
```python
from insightface.app import FaceAnalysis
ctx_id = 0 if PLAT == "nvidia" else -1     # -1 routes to CPU/CoreML EP path
app = FaceAnalysis(name="antelopev2", providers=get_providers(PLAT))
app.prepare(ctx_id=ctx_id, det_size=(640, 640))
```

FAISS device selection (cosine via inner product on L2-normalized vectors):
```python
import faiss, numpy as np
d = 512
index = faiss.IndexFlatIP(d)                # exact baseline for <1M vectors
if PLAT == "nvidia":
    res = faiss.StandardGpuResources()
    index = faiss.index_cpu_to_gpu(res, 0, index)

def add(embs):  # embs: (N, 512) float32
    faiss.normalize_L2(embs); index.add(embs)
def search(q, k=10):
    faiss.normalize_L2(q); return index.search(q, k)
# >1M vectors: IndexIVFFlat(quantizer, d, nlist) or IndexHNSWFlat(d, M=32)
```

### Pipeline stages
1. **Ingest & EXIF**: read images (pillow-heif registers the HEIC opener), correct orientation via EXIF, extract capture date for age-bucketing.
2. **Detect & align**: SCRFD via InsightFace → 5-point alignment → 112×112 crop.
3. **Quality filter**: CR-FIQA (or AdaFace feature-norm); drop faces below a tuned threshold — keep a lower bar for child buckets to preserve recall.
4. **Embed**: ResNet-100 ArcFace (antelopev2), 512-d, L2-normalize; batch (8–32) for throughput.
5. **Enroll references**: multiple references per target, bucketed by age band; store per-bucket centroids and raw embeddings.
6. **Score & fuse**: cosine similarity vs each reference; fuse with sum rule + min-max normalization.
7. **Threshold & bucket**: confident ≥~0.40; "likely" 0.28–0.40; relaxed child band 0.20–0.28 → human-review queue.
8. **Cluster-then-review**: HDBSCAN (cosine) on unmatched faces (DBSCAN fallback) to surface candidate groups for triage.

### Speed/performance
- Batch embedding is the biggest single throughput win on all platforms.
- **NVIDIA**: TensorRT FP16 + FAISS-GPU; order-of-magnitude search speedups over CPU; FAISS 1.10+ cuVS/CAGRA accelerates large index builds (up to 12.3× build, up to 8.1× IVF search latency reduction).
- **Apple Silicon**: CoreML EP with `MLComputeUnits=ALL` uses ANE+GPU; keep tensors float32; prefer FP32 ONNX over pre-converted FP16.
- **CPU**: INT8 via ONNX Runtime quantization (S8S8/QDQ default) or OpenVINO NNCF (~2–3× on VNNI/AMX CPUs; verify ≤1% accuracy drop).

### Project structure
```
crossage_fr/
  platform_detect.py      # detection + provider/device selection
  ingest/                 # EXIF, HEIC, dedup
  detect_align/           # SCRFD wrapper + 5-pt alignment
  quality/                # CR-FIQA gate
  embed/                  # ArcFace ONNX session, batching
  store/                  # FAISS index mgmt (CPU/GPU)
  enroll/                 # age-bucketed multi-reference enrollment
  match/                  # scoring + sum-rule fusion + thresholds
  cluster/                # HDBSCAN review (+DBSCAN fallback)
  review_ui/              # human-in-the-loop triage
  config/                 # thresholds, platform configs, calibration
```

### Sequenced task list for the AI coding agent
1. Implement `platform_detect.py` (Apple/NVIDIA/CPU) and the provider/device factory; add a startup self-check that asserts the expected EP is bound.
2. Build the ingest layer (Pillow + pillow-heif + ExifRead), EXIF-orientation fix, capture-date extraction, perceptual-hash dedup.
3. Integrate InsightFace `antelopev2`; wire detector + aligner + embedder with batching (batch 8–32).
4. Add a CR-FIQA quality gate with per-bucket thresholds.
5. Implement the FAISS store (IndexFlatIP for <1M; IVF/HNSW for >1M) with the GPU branch on NVIDIA; L2-normalize before add/search.
6. Implement age-bucketed multi-reference enrollment + per-bucket centroids.
7. Implement scoring, sum-rule fusion with min-max normalization, threshold bands, and the review queue.
8. Add the HDBSCAN clustering path (cosine) with a DBSCAN fallback for noise-only outputs.
9. Build the human-review UI/queue (accept/reject/uncertain, audit log).
10. Add a config-driven threshold + calibration script (stratified by age gap and enrollment age) and legal/consent gating + retention/deletion policy.

## Recommendations
- **Ship recall-first, human-in-the-loop.** Treat the system as a candidate-surfacing tool. Suggested bands: ≥0.40 auto-surface "confident," 0.28–0.40 "likely," 0.20–0.28 "child-bucket maybe" — all routed to human review, never autonomous action.
- **Default to `antelopev2` (R100/Glint360K).** Evaluate **TopoFR (NeurIPS 2024)** as a drop-in upgrade if you can export weights to ONNX (it surpasses AdaFace/TransFace on Glint360K and tops the MFR "Children" sub-track); keep AdaFace as an alternative for mixed-quality sets.
- **Auto-detect hardware and branch providers.** On NVIDIA enable TensorRT FP16 + FAISS-GPU; on Apple Silicon use mainline `onnxruntime` CoreML EP (never `onnxruntime-silicon`); on CPU enable INT8/OpenVINO.
- **Calibrate thresholds on your own labeled pairs**, stratified by age gap and enrollment age; re-run against a frozen "golden" set on every model/preprocessing change. Use ≥1/target-FMR non-mate comparisons for stable FMR estimates.
- **Benchmarks that change the plan**: if your validation TAR@0.1%FAR for >5-year gaps exceeds ~85% on your data, you can tighten thresholds and cut manual review; if it falls below ~50% (typical for <age-4 enrollment), restrict to assistive triage only and widen the review band.

## Caveats
- **Wide-gap child→adult recognition is not solved.** All 2026 evidence (NIST IFPC 2025; arXiv:2601.01689/2601.01680) reaffirms sharp degradation beyond a ~4-year gap and steeper decay for younger enrollment ages; do not deploy for autonomous decisions affecting individuals.
- **2026 synthetic-data gains are for short/medium gaps (≤36 months), child→child** — not true child→adult; do not over-extrapolate the EER improvements.
- **Speed numbers are hardware-dependent.** The cited throughput multipliers (ORT batching ~3.2×, FAISS ~0.2s/1M, cuVS up to 12.3×) are directional; benchmark on your target machines.
- **Legal exposure is significant**: GDPR Art. 9 + EU AI Act high-risk obligations (from 2 Aug 2026) + US state biometric laws (BIPA private right of action; Texas CUBI; Colorado HB 24-1130). Obtain explicit consent, maintain retention/deletion policies, run a DPIA, and respect that MS1MV2/Glint360K/WebFace-trained weights are licensed for non-commercial research only — secure commercial weights before any commercial launch.
- Some secondary benchmark figures (specific MORPH/CACD TAR-drop percentages, the relaxed child-bucket cosine band) are drawn from summaries/heuristics rather than a single primary table — verify against the primary PDFs and your own calibration before production sign-off.
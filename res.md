# Local, Offline NSFW/Intimate-Image Detection for CrossAge FR — Model Selection & Implementation Plan

## TL;DR
- **Adopt a two-model architecture: Marqo/nsfw-image-detection-384 (Apache-2.0, ViT-Tiny base `vit_tiny_patch16_384`, ~5–6M params, 384px input, calibrated 2-class softmax) as the primary fast gate, plus an explainable body-part detector as an optional second "explain why flagged" stage** — both run fully offline in ONNX Runtime with CoreML/CUDA/TensorRT/DirectML/OpenVINO/CPU fallback. Do not bundle NudeNet's package for redistribution: its v3 repo is **AGPL-3.0**.
- **For a single-model, lowest-friction option, Falconsai/nsfw_image_detection (Apache-2.0, ViT-base, 224px, ~85M params) is the most battle-tested** (its FALCONS.AI GitHub repo claims "the #1 NSFW classification model … leading the community with a staggering 80 MILLION downloads"; aimodels.fyi lists 37.9M), **but it is high-precision/low-recall on hard data, so it is the wrong default for a privacy-first "Safe Mode."** Multi-level/calibrated models (Marqo, Freepik) are better fits.
- **Bundle one small, permissively-licensed ONNX model with the app** (Apache-2.0/MIT weights make redistribution legal), run it **BEFORE thumbnailing/face-matching/clustering/indexing/MCP/export**, cache scores by file content hash, store only scores/labels/hashes (never previews), and calibrate three thresholds (privacy-first/balanced/permissive) on a user-owned validation set using temperature scaling + PR-curve selection.

## Key Findings

1. **Best license + accuracy + size balance is Marqo/nsfw-image-detection-384 (Apache-2.0).** Its HF card states it is "approximately 18–20x smaller than other open-source models and achieves a superior accuracy of 98.56% on our dataset … trained on a proprietary dataset of 220,000 images" (base: `timm/vit_tiny_patch16_384.augreg_in21k_ft_in1k`). It outputs a calibrated 2-class softmax (SFW/NSFW) and is heavily adopted (1.62M monthly downloads on Marqo's HF org page).
2. **NudeNet v3 is now AGPL-3.0** (the notAI-tech/NudeNet GitHub org page shows the AGPL-3.0 tag), a serious closed-source-redistribution risk; the package is also flagged "inactive" maintenance on Snyk. Its ONNX YOLO detector (320n bundled ~7MB; 640m ~25MB) remains the best open option for explainable body-part localization with scores+boxes.
3. **Falconsai/nsfw_image_detection (Apache-2.0)** is the most-downloaded option but binary-only. On the independent UnsafeBench "Sexual" re-evaluation it had the highest precision but only ~41% recall — it misses most intimate content, which is unacceptable for a privacy filter where false negatives are the costly error.
4. **Freepik/nsfw_image_detector (MIT, Copyright 2025 Freepik Company S.L.)** is a strong newer multi-level model (neutral/low/medium/high) on an EVA-02 base (`timm/eva02_base_patch14_448`, 448px, ~87M params); it led the open classifiers on the independent UnsafeBench Sexual subset (Acc 77.0% / F1 81.1%). Caveat: its HF repo is gated as sensitive, ships safetensors (no ONNX), and its own "outperforms Falconsai/AdamCodd" claim is a vendor self-report.
5. **All recommended models run fully offline** via ONNX Runtime's documented execution providers: CoreML EP (Apple Silicon/ANE), CUDA/TensorRT (NVIDIA), DirectML (Windows DX12 GPUs), OpenVINO (Intel), and a mandatory CPU fallback.

## Details

### Candidate landscape (2025–2026)

**Tier 1 — recommended: permissive weights, usable scores**

| Model | Arch / input | Output | Code license | Weights license | Size | ONNX/CoreML | Notes |
|---|---|---|---|---|---|---|---|
| **Marqo/nsfw-image-detection-384** | ViT-Tiny (`vit_tiny_patch16_384`), 384px, 16px patches | 2-class softmax (SFW/NSFW) | Apache-2.0 | Apache-2.0 | ~5–6M params ("18–20x smaller") | safetensors/timm → torch.onnx export | Calibrated probs; 1.62M downloads/mo; designed for threshold tuning |
| **Falconsai/nsfw_image_detection** | ViT-base-patch16-224, 224px | 2-class (normal/nsfw) | Apache-2.0 | Apache-2.0 | 86M params (~340MB fp32) | ONNX export documented (opset 14) | Self-report eval_accuracy 0.980375; aimodels.fyi: "no independent benchmark on public datasets"; high precision/low recall on hard data |
| **AdamCodd/vit-base-nsfw-detector** | ViT-base-patch16-384, 384px | 2-class (sfw/nsfw) | Apache-2.0 | Apache-2.0 | 86.1M params | ONNX shipped incl. quantized (transformers.js) | Card: Accuracy 0.9654, AUC 0.9948, ~25k training images; 1,449,417 downloads last month; deliberately restrictive (flags "cleavage/too much skin") |
| **Freepik/nsfw_image_detector** | EVA-02 base (`eva02_base_patch14_448`), 448px | 4 levels (neutral/low/medium/high) | MIT | MIT | ~87M params | safetensors; **no ONNX shipped** | 100k labeled training images; best open model on independent UnsafeBench Sexual; repo gated |

**Tier 2 — capable but caveated**

- **NudeNet v3 (notAI-tech):** ONNX YOLO detector, granular classes (e.g., FEMALE_BREAST_EXPOSED, BELLY_EXPOSED, plus COVERED_* "suggestive" classes) with scores + bounding boxes. Bundled 320n (~7MB), optional 640m (~25MB). **AGPL-3.0**, maintenance "inactive." Best for explainable localization and partial/cropped bodies.
- **LAION CLIP-based-NSFW-Detector (MIT):** small autokeras head on CLIP embeddings (ViT-L/14 → 768-dim, or B/32 → 512-dim). LAION's own comparison claims it catches "96.45% of true NSFW … discards 7.96% of SFW incorrectly." Useful if you already run CLIP; CLIP backbone is heavy.
- **Bumble Private Detector (Apache-2.0):** EfficientNetV2 binary "lewd image" classifier, purpose-built for unsolicited nudes; TF SavedModel (2022) needing TF→ONNX conversion. Architecturally aligned with the "intimate image" use case.

**Tier 3 — legacy / avoid as primary**

- **GantMan/nsfw_model (Keras):** Inception-v3/MobileNet-v2, 5-class (drawings/hentai/neutral/porn/sexy). Non-SPDX license, TF-only, dated (last major release years old).
- **Yahoo open_nsfw / open_nsfw2:** ResNet-50 single "NSFW score"; dated architecture.
- **CompVis stable-diffusion-safety-checker:** CLIP cosine-similarity to hidden concepts; "License: More information needed" on its HF card, and the "Red-Teaming the Stable Diffusion Safety Filter" paper documents both false negatives and false positives (e.g., non-explicit images flagged). Avoid for production.

**Cloud-only — flag as optional enterprise add-on, NEVER primary:** Hive (50+ categories, "No self-hosted deployment option — cloud API only," $0.001–0.005/image), Sightengine (120+ classes, ~$0.001/op), AWS Rekognition (~$1/1k images), Azure AI Content Safety (severity 0–6 across hate/sexual/violence/self-harm), Google Cloud Vision SafeSearch (adult/spoof/medical/violence/racy), Clarifai. All require sending images off-device — incompatible with local-first privacy. Permit only in a clearly separated, opt-in enterprise mode.

### Independent benchmark evidence (UnsafeBench "Sexual" subset, 1,054 images: 683 unsafe / 371 safe)

Re-evaluation of open checkpoints at a single binary threshold (RTX 4090), reported in **KidsNanny (arXiv:2603.16181)**:

- **Freepik:** Accuracy 77.0%, F1 81.1%, Precision 86.8%, Recall 76.1% (15.5 ms)
- **AdamCodd ViT:** Acc 69.0%, F1 73.9%, Precision 81.2%, Recall 67.8% (fastest, ~7.2 ms)
- **NudeNet:** Acc 68.0%, F1 76.0%, Precision 74.0%, Recall 78.2% (~35 ms)
- **Falconsai:** Acc 59.0%, F1 56.3%, Precision 91.2%, Recall 40.7% (~7.3 ms; misses >59% of unsafe content)

**Source-quality flag:** KidsNanny is a **first-party technical report** that discloses its own conflict of interest ("authored, evaluated, and reported entirely by the KidsNanny development team … a direct conflict of interest … treated as a first-party technical report pending independent external validation"). However, its measurements of the *competitor* open models are third-party (independent of those vendors) and use the public UnsafeBench benchmark (arXiv:2405.03486; 10K real-world + AI-generated images across 11 unsafe categories). Marqo was not included in this paper.

**Interpretation:** Vendor self-reported accuracies (~98%) are measured on each model's own, easier dataset and do not transfer. On hard real-world data, accuracies fall to 59–77%. Falconsai's ~41% recall disqualifies it as a privacy-first default (a "Safe Mode" must minimize *missed* intimate content). Freepik leads on hard data but ships no ONNX and its repo is gated; Marqo's tiny size + calibrated output + Apache-2.0 make it the best engineering tradeoff for an always-on local gate, validated per-user.

### False-positive behavior (the core UX risk)
Classic false-positive triggers: beachwear, gym/athletic photos, breastfeeding/babies, medical-ish imagery, art/paintings, and low-light/black-and-white images. AdamCodd is explicitly trained to be restrictive (flags "cleavage or too much skin"), and has a reported issue mislabeling black-and-white images. CLIP-similarity filters (SD safety checker) show documented spurious associations. **Mitigation:** prefer multi-level (Freepik) or calibrated-probability (Marqo) models so you can separate "suggestive" from "explicit" and tune the operating point, rather than accept a single binary verdict.

### Capability coverage
- **Nudity / explicit sexual content:** all candidates.
- **Suggestive / intimate non-explicit:** best with Freepik (multi-level) or Marqo (probability bands); NudeNet provides COVERED_* classes.
- **Partial / cropped body:** NudeNet detector (boxes) strongest; whole-image classifiers degrade.
- **Screenshots / compressed social images:** all handle after RGB decode; robustness varies.
- **HEIC/JPEG/PNG/WebP:** a non-issue at model level — the app decodes to an RGB tensor before inference, so input container format is irrelevant to the model.
- **Calibrated scores vs binary:** Marqo and Freepik output softmax probability distributions (prefer these); NudeNet outputs per-detection scores; Falconsai/AdamCodd output logits → softmax (probabilities available). Treat all raw scores as *uncalibrated* until temperature-scaled.

## ONNX Runtime execution-provider setup (offline, cross-platform)
- Provider priority lists (ORT tries first, falls back to next):
  - **Apple Silicon:** `['CoreMLExecutionProvider','CPUExecutionProvider']`; CoreML EP options `ModelFormat='MLProgram'`, `MLComputeUnits='ALL'` (or `'CPUAndNeuralEngine'` to force ANE). MLProgram requires macOS 12+.
  - **NVIDIA:** `['TensorrtExecutionProvider','CUDAExecutionProvider','CPUExecutionProvider']` (TensorRT EP tested with TRT 10.x; CUDA EP with CUDA 12.x/cuDNN 9).
  - **Windows GPUs:** `['DmlExecutionProvider','CPUExecutionProvider']` (DirectML, any DX12 GPU). Note Microsoft has moved new development to WinML, which dynamically selects EPs.
  - **Intel CPU/iGPU/NPU:** `['OpenVINOExecutionProvider','CPUExecutionProvider']`.
  - Always terminate the list with `CPUExecutionProvider`.
- macOS arm64 wheels ship in official `onnxruntime` now; the older `onnxruntime-silicon` package is deprecated.
- **CoreML cache invalidation:** ORT does not auto-evict compiled CoreML caches; embed a model hash in `metadata_props` and key the cache on it so model/threshold upgrades recompile.

## Thresholding strategy
- **Privacy-first (high recall, aggressive):** low NSFW threshold (start ~0.30). Default when "Safe Mode" is ON — catch more, tolerate more false positives.
- **Balanced:** PR-curve break-even (start ~0.50).
- **Permissive (high precision):** high threshold (start ~0.85) — minimize false positives.
- **Calibration on a user-owned validation set (concrete method):**
  1. User labels a few hundred local images (or accepts/overrides flags during normal use to build labels).
  2. Apply **temperature scaling** — fit a single scalar T by minimizing NLL on a held-out split; it preserves accuracy and is the recommended method for neural nets (Guo et al. 2017). Use **Platt scaling** (logistic regression on logits) for very small sets; use **isotonic regression** only with enough data (it overfits small sets).
  3. Select operating thresholds from the **ROC/PR curve** at the user's chosen recall target.
  4. Support **per-user re-calibration** since library distributions differ; re-fit T and thresholds when the user's labeled set grows materially.

## Integration architecture
- **Where in the pipeline:** run the classifier as the **first stage after image decode**, BEFORE thumbnail generation, face detection/recognition, clustering, search indexing, MCP/agent tool exposure, and exports. Every downstream stage is gated on the resulting label.
- **Decode order:** run AFTER decoding to an RGB tensor (models need RGB), but BEFORE any persisted thumbnail/derivative is written to disk.
- **Batching:** batch 8–32 images per `session.run` for throughput; export with a dynamic batch axis (`dynamic_axes={'input':{0:'batch_size'}}`).
- **Caching:** key results by **content hash of the file bytes (BLAKE3 preferred for speed, or SHA-256)**; include `model_version` + `preprocessing_version` in the cache key so model/threshold upgrades trigger re-scoring. Invalidate when file bytes change (hash mismatch) — not by mtime/path.
- **Audit logging without sensitive previews:** persist only `{file_hash, model_version, raw_score(s), label, threshold_profile, timestamp}`. Never store pixels, thumbnails, or crops of flagged content.
- **Gating mechanisms:** set a `protected` flag in the DB on flag; the thumbnailer skips protected items or writes a blurred placeholder; the clusterer and search indexer exclude protected hashes; MCP/agent tools filter protected items from every response; the export pipeline refuses protected files unless an explicit per-file override is given.

## Bundle vs download
- **Bundle** one small Apache-2.0/MIT ONNX model (Marqo tiny ≈ tens of MB; Falconsai/AdamCodd ONNX larger). Permissive licenses grant redistribution rights, small size keeps the installer lean, and offline operation is guaranteed on first run.
- **Download on first run** only for large optional models (NudeNet 640m, CLIP). Because NudeNet is **AGPL-3.0**, do not bundle/redistribute it; if used at all, make it a user-initiated optional install with an AGPL source offer, or substitute Freepik (MIT) once an ONNX export is validated.

## Legal / privacy
- **Combination sensitivity:** biometric face data + intimate-image classification is among the most sensitive data pairings possible. Under GDPR Article 9, both biometric data (processed for unique identification) and "data concerning a natural person's sex life or sexual orientation" are special-category data.
- **Local-only processing** is the strongest mitigation: no transfer to processors, supports data-minimization, and dramatically narrows GDPR exposure. Keep it the default and the marketed posture.
- **BIPA (Illinois)** governs biometric identifiers including face geometry — relevant to the face-recognition pipeline; implement informed consent and a written retention/destruction policy.
- **EU AI Act:** classifying *image content* (not categorizing *persons* by protected attributes) is not the prohibited Art. 5(1)(g) "biometric categorization of sensitive characteristics" practice, and labelling/filtering of lawfully held datasets is expressly carved out. Transparency duties (Art. 50) may apply to AI features generally. Separately, the Digital Omnibus agreement extends prohibitions to non-consensual intimate-image/"nudifier" *generation* (effective Dec 2, 2026) — a different use case from your *detection/filtering*, but document your intended purpose and limitations to stay clearly on the right side.
- **Model license restrictions:** redistribute only Apache-2.0/MIT weights (Marqo, Falconsai, AdamCodd, Freepik qualify). **Flag NudeNet (AGPL-3.0)** and any CC-BY-NC or unclear weights (CompVis SD safety checker, GantMan non-SPDX); never ship non-commercial weights in a commercial product.

## Recommendations

**Staged plan to replace the heuristic Safe Mode (Python + ONNX Runtime):**

1. **Stage 0 (now):** Ship **Marqo/nsfw-image-detection-384 exported to ONNX** as the bundled default gate (Apache-2.0, tiny, calibrated softmax). Wire the ORT provider-fallback chain. Replace the exposed-skin heuristic with the model score gating downstream stages.
2. **Stage 1:** Add temperature-scaling calibration and the three threshold profiles; default to privacy-first. Add per-file blurred-preview review UX (explicit reveal action, per-file override).
3. **Stage 2:** Add an optional, user-initiated **"explain why flagged" detector** for body-part localization — NudeNet v3 640m ONNX *only if* AGPL source-offer compliance is acceptable, otherwise validate a **Freepik (MIT) ONNX export** as the substitute.
4. **Stage 3 (enterprise, optional, separate):** offer cloud moderation (Hive/Sightengine/AWS/Azure) as an explicitly-labeled, opt-in, non-default add-on.

**Benchmarks/thresholds that would change the recommendation:**
- If, on the user's own validation set, Marqo recall < 0.90 at acceptable precision → switch primary to **Freepik** (convert to ONNX); it led the independent benchmark.
- If false-positive complaints on beachwear/medical exceed ~2% → move to multi-level **Freepik** and gate only on medium/high levels.
- If installer-size budget is tight → keep Marqo tiny; if accuracy is paramount and size is irrelevant → Freepik/EVA-02.

### Finalist shortlist
- **Best overall:** **Marqo/nsfw-image-detection-384** — Apache-2.0 (code+weights), ViT-Tiny 384px, 2-class softmax, ~5–6M params, ONNX via torch.onnx export, calibrated/thresholdable. Risk: not in the independent benchmark — validate per-user. Source: https://huggingface.co/Marqo/nsfw-image-detection-384
- **Best fully open/local:** **Freepik/nsfw_image_detector** — MIT (code+weights), EVA-02 base 448px, 4-level output (neutral/low/medium/high), ~87M params, safetensors (export ONNX yourself), best independent UnsafeBench Sexual result. Risk: gated repo, no shipped ONNX, vendor self-report on its lead claim. Source: https://huggingface.co/Freepik/nsfw_image_detector
- **Best small/fast:** **Marqo tiny** (or **AdamCodd quantized ONNX** if you want a ready-made ONNX file; ~7 ms inference but restrictive/lower recall).
- **Best enterprise/commercial (optional add-on only):** **Hive** (50+ categories, tunable per-category thresholds) or **AWS Rekognition** (AWS-native, A2I human review). Both cloud-only — never the local default.
- **Best ONNX/CoreML-friendly:** **AdamCodd/vit-base-nsfw-detector** (ships ONNX incl. quantized, Apache-2.0) or **Marqo**.

### For each finalist — specifics

**Marqo/nsfw-image-detection-384** — Source: HF (link above). License: Apache-2.0 (code + weights). Download size: tens of MB (ViT-Tiny). Input: 384×384 RGB, 16px patches, normalize mean/std 0.5. Output labels: `[SFW, NSFW]` softmax. ONNX: export via `timm` → `torch.onnx.export` (opset 14+). Integration risk: not independently benchmarked; calibrate per-user. Recommendation: **primary bundled gate.**

**Falconsai/nsfw_image_detection** — Source: https://huggingface.co/Falconsai/nsfw_image_detection. License: Apache-2.0 (code + weights). Size: ~340MB fp32 (86M params). Input: 224×224. Output: `[normal, nsfw]`. ONNX: documented torch.onnx export, opset 14. Risk: low recall (~41% on UnsafeBench Sexual) → poor privacy-first default. Recommendation: **only as a single-model fallback or precision-mode secondary.**

**AdamCodd/vit-base-nsfw-detector** — Source: https://huggingface.co/AdamCodd/vit-base-nsfw-detector. License: Apache-2.0. Size: 86.1M params. Input: 384×384. Output: `[sfw, nsfw]`. ONNX: shipped (incl. quantized). Risk: deliberately restrictive (more false positives on skin/swimwear), B&W mislabeling. Recommendation: **best off-the-shelf ONNX; precision-tunable secondary.**

**Freepik/nsfw_image_detector** — Source: HF (link above). License: MIT. Size: ~87M params (EVA-02 base). Input: 448×448. Output: 4 ordered levels neutral/low/medium/high. ONNX: not shipped — export yourself from safetensors/timm. Risk: gated repo (verify file size/downloads before bundling), no prebuilt ONNX. Recommendation: **best-accuracy open option; promote to primary if Marqo recall is insufficient.**

### Example Python inference (ONNX Runtime, with provider fallback)

```python
import onnxruntime as ort, numpy as np
from PIL import Image

def make_session(model_path):
    providers = [
        ('CoreMLExecutionProvider', {'ModelFormat': 'MLProgram', 'MLComputeUnits': 'ALL'}),
        'CUDAExecutionProvider',          # NVIDIA (or 'TensorrtExecutionProvider' first)
        'DmlExecutionProvider',           # Windows DirectML
        'OpenVINOExecutionProvider',      # Intel
        'CPUExecutionProvider',           # mandatory fallback
    ]
    return ort.InferenceSession(model_path, providers=providers)

def preprocess(path, size=384):
    img = Image.open(path).convert('RGB').resize((size, size), Image.BILINEAR)
    x = np.asarray(img, np.float32) / 255.0
    mean = np.array([0.5, 0.5, 0.5], np.float32)   # match the model's training transform
    std  = np.array([0.5, 0.5, 0.5], np.float32)
    x = (x - mean) / std
    return np.expand_dims(np.transpose(x, (2, 0, 1)), 0)  # NCHW

def nsfw_score(sess, path, temperature=1.0):
    inp = sess.get_inputs()[0].name
    logits = sess.run(None, {inp: preprocess(path)})[0][0]
    logits = logits / temperature                  # temperature scaling (T fit on val set)
    p = np.exp(logits - logits.max()); p /= p.sum()
    return float(p[1])                             # index 1 = NSFW

sess = make_session('marqo_nsfw_384.onnx')
score = nsfw_score(sess, 'photo.jpg', temperature=1.7)
PROFILES = {'privacy': 0.30, 'balanced': 0.50, 'permissive': 0.85}
is_protected = score >= PROFILES['privacy']
```

## Caveats
- **Vendor accuracy claims (~98%) are measured on each model's own, easier dataset and do not generalize** (aimodels.fyi notes Falconsai has "no independent benchmark on public datasets"); independent UnsafeBench numbers are far lower (59–77%). Always validate on the user's own data.
- The independent cross-model numbers come from **KidsNanny (arXiv:2603.16181), a self-disclosed first-party technical report**; its competitor measurements are third-party but should be reproduced on your own held-out set before final model choice.
- **Freepik's repo is gated as sensitive content**; exact file size, current download count, and ONNX availability could not be confirmed — verify before bundling, and budget time to export ONNX yourself.
- **NudeNet v3 is AGPL-3.0 and flagged "inactive"** — do not bundle in a closed-source product without legal review or a commercial grant.
- **All threshold values are starting points**; final operating points must come from per-user/per-app calibration on labeled local data.
- Treat the EU AI Act timeline as moving: high-risk obligations and the intimate-image "nudifier" generation prohibition have shifting dates (2026–2027); your detection/filtering use case is distinct from generation, but document intended purpose and limitations.
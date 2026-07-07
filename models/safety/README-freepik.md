# Using Freepik as the Safe Mode first-stage classifier (optional, MIT)

`Freepik/nsfw_image_detector` is a **4-level classifier** (neutral / low / medium /
high) on an EVA-02 base. On independent hard data (UnsafeBench "Sexual") it leads
the open classifiers, and it is **MIT-licensed — so it may be bundled/redistributed**
(unlike NudeNet). The Safe Mode gate already supports it end-to-end (multi-level
scoring, dominant-level reporting); the only manual step is the **one-time ONNX
export**, because Freepik ships safetensors (no ONNX). The repo itself is
**public** — flagged *not-for-all-audiences* (a content warning), **not
access-gated**, so no download request is needed.

## 1. Export ONNX (one-time, offline)

The model is a HuggingFace `TimmWrapperForImageClassification`, so load it via
`transformers` (this pulls `config.json` + `model.safetensors` and puts the weights
in the right place — no raw `state_dict` key juggling):

```python
# pip install "transformers>=4.44" timm torch onnx
import torch
from transformers import AutoModelForImageClassification

model = AutoModelForImageClassification.from_pretrained("Freepik/nsfw_image_detector").eval()

dummy = torch.zeros(1, 3, 448, 448)  # EVA-02 448px input
torch.onnx.export(
    model, dummy, "freepik-nsfw.onnx",
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    opset_version=14,
)
```

The wrapper's forward returns an `ImageClassifierOutput`; `output_names=["logits"]`
names its logits tensor as ONNX output 0. If the export warns about the
`ModelOutput`, export the underlying timm module instead: `model.timm_model`.

**Simplest alternative** (no export code — one CLI command):

```bash
pip install "optimum[exporters]" timm
optimum-cli export onnx --model Freepik/nsfw_image_detector --task image-classification out/
# → out/model.onnx ; rename to freepik-nsfw.onnx
```

The repo's `config.json` fixes the level order as `{0: neutral, 1: low, 2: medium,
3: high}` — the ONNX logits follow it, and the manifest `levels` below already
matches, so no reordering is needed. (Verify once after export.)

## 2. Install

Drop `freepik-nsfw.onnx` into this `models/safety/` directory alongside a sidecar
`freepik-nsfw.json` manifest (template below). It is **auto-discovered** and, per
`_model_preference`, **preferred over the bundled AdamCodd classifier** when present.

Manifest (`freepik-nsfw.json`):

```json
{
  "modelName": "freepik-nsfw",
  "source": "https://huggingface.co/Freepik/nsfw_image_detector",
  "license": "MIT",
  "inputSize": 448,
  "interpolation": "bicubic",
  "mean": [0.48145466, 0.4578275, 0.40821073],
  "std": [0.26862954, 0.26130258, 0.27577711],
  "levels": ["neutral", "low", "medium", "high"],
  "sensitiveMinLevel": "medium",
  "sha256": "<sha256 of freepik-nsfw.onnx>"
}
```

## How the gate uses it

- The model's 4 softmax levels are read in the manifest order.
- The gate **score** = probability mass at/above `sensitiveMinLevel` (here
  medium+high). It flows through the existing threshold profiles + per-user
  temperature calibration exactly like the 2-class model.
- The **dominant level** (argmax) is surfaced in the assessment `reason`/`level`
  so the UI can separate "suggestive" (low/medium) from "explicit" (high).
- Freepik gives **no body-part boxes** — it does not replace the Stage-2 NudeNet
  explainer (`models/safety-explain/`), it is a stronger *first-stage* classifier.

Set `sensitiveMinLevel` to `low` for a more aggressive privacy-first posture, or
`high` to only flag explicit content; the Safe Mode threshold profiles still apply
on top of the derived score.

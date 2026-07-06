# Using Freepik as the Safe Mode first-stage classifier (optional, MIT)

`Freepik/nsfw_image_detector` is a **4-level classifier** (neutral / low / medium /
high) on an EVA-02 base. On independent hard data (UnsafeBench "Sexual") it leads
the open classifiers, and it is **MIT-licensed — so it may be bundled/redistributed**
(unlike NudeNet). The Safe Mode gate already supports it end-to-end (multi-level
scoring, dominant-level reporting); the only manual step is the **one-time ONNX
export**, because Freepik ships safetensors (no ONNX) and its repo is gated.

## 1. Export ONNX (one-time, offline)

```python
import timm, torch
from safetensors.torch import load_file  # Freepik ships safetensors — load without pickle

model = timm.create_model("eva02_base_patch14_448.mim_in22k_ft_in22k_in1k", pretrained=False, num_classes=4)
model.load_state_dict(load_file("model.safetensors"))  # the downloaded Freepik weights
model.eval()
dummy = torch.zeros(1, 3, 448, 448)
torch.onnx.export(
    model, dummy, "freepik-nsfw.onnx",
    input_names=["input"], output_names=["logits"],
    dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
    opset_version=14,
)
```

Verify the class/level order of the export (it must match the manifest `levels`).

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

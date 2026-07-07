# Safe Mode explainer models (res.md Stage 2 — optional, not bundled)

The first-stage classifier (`models/safety/…`) decides *whether* an image is
sensitive. This directory holds the optional **second-stage "explain why flagged"
detector** that localizes body-part regions (labels + boxes) for the review UI.

**Nothing is bundled here on purpose:**

- **NudeNet v3** (best open localizer) is **AGPL-3.0** and download-only. Shipping
  it in a closed-source product needs a written AGPL source-offer or a commercial
  grant — a licensing decision, not just a file copy. If used, install its ONNX
  YOLO detector (`320n` ≈ 7 MB, `640m` ≈ 25 MB) here as a **user-initiated** step.
- **Freepik** `nsfw_image_detector` is **MIT** but ships **no ONNX** (safetensors
  only) and its repo is gated — export it to ONNX yourself, then drop it here.

## Installing a model

1. Place `<detector>.onnx` in this directory (or point `CROSSAGE_SAFETY_EXPLAIN_DIR`
   at another folder).
2. Add a sidecar `<detector>.json` manifest:

   ```json
   {
     "modelName": "nudenet-640m",
     "license": "AGPL-3.0",
     "source": "https://github.com/notAI-tech/NudeNet",
     "inputSize": 640,
     "classes": ["exposed_breast", "exposed_genitalia", "exposed_buttocks", "..."]
   }
   ```

3. Validate the output layout against `crossage_fr/ingest/safety_explain.py::_parse_yolo`
   (it accepts `[num_preds, 4+C]` or `[4+C, num_preds]`); adjust for your model if needed.

With no model installed the framework degrades gracefully — Safe Mode still flags
and protects images; there is simply no per-region explanation. Availability is
reported in app state as `safeModeExplain` and via the `explain_safety` command.

# Matting model pack (subject cutout / background removal)

On-device subject isolation for `export_photo_subject_cutout`. Runs fully offline
on ONNX Runtime (CPU). The engine lives in `crossage_fr/ingest/matting.py` and
degrades gracefully to the deterministic edge+center heuristic when no weights are
present here, so the app works with or without this pack.

## Recommended weights (vendored at build time — not committed)

- **BiRefNet_lite** (Bilateral Reference Network, Swin-Tiny) — CAAI AIR'24, MIT.
  - File: `birefnet_lite_fp16.onnx`
  - Source: https://huggingface.co/onnx-community/BiRefNet_lite-ONNX `onnx/model_fp16.onnx`
  - Size: 114,538,221 bytes
  - SHA-256: `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402`
  - Input: `input_image` `[1,3,1024,1024]` float32, ImageNet-normalized.
  - Output: `output_image` `[1,1,1024,1024]` logits → sigmoid → alpha matte.
  - License: MIT (code + weights). Verified on the ZhengPeng7/BiRefNet repo.

The SHA-256 above is pinned in `crossage_fr/ingest/matting.py`
(`_PINNED_MATTING_MODEL_HASHES`); a file with this name that does not match the
pin is rejected (fail closed to the heuristic).

## Install

Download the file into this directory on an online build host:

```sh
curl -L -o models/matting/birefnet_lite_fp16.onnx \
  https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model_fp16.onnx
```

Quality rationale and alternatives: see `docs/2026-ml-integration-plan.md`.

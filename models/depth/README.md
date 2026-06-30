# Depth model pack (portrait background blur)

On-device monocular depth for the `export_photo_portrait_blur` command. Runs fully
offline on ONNX Runtime (CPU). The engine is `crossage_fr/depth/engine.py`; it
degrades gracefully to a radial center-weighted blur when no weights are present.

## Recommended weights (vendored at build time — not committed)

- **Depth-Anything-V2-Small** (int8 ONNX) — NeurIPS 2024, Apache-2.0.
  - Source repo: https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX
  - Files (place both in this directory — the graph references the data sidecar):
    | file | source path | bytes | sha256 |
    |---|---|---|---|
    | `model_quantized.onnx` | `onnx/model_quantized.onnx` | 162,005 | `ed7680047cd210143f9f9c4468d049c1f19f8a7a58631d52868831376fe152c9` |
    | `model_quantized.onnx_data` | `onnx/model_quantized.onnx_data` | 38,414,848 | `1595c419ac7d75a356c6835890f2e64fd370a38444ddfcb741ca6b6b96e1a42a` |
  - Input: `pixel_values` `[B,3,518,518]` float32, ImageNet-normalized (BICUBIC resize).
  - Output: `predicted_depth` `[B,518,518]` relative disparity (higher = nearer);
    the engine min/max-normalizes to `[0,1]` (1 = nearest) and resizes to source.
  - License: Apache-2.0 (ONNX build + Small checkpoint).

Both SHA-256 values are pinned in `crossage_fr/depth/engine.py`
(`_PINNED_DEPTH_HASHES`); a mismatched file is rejected (fail closed to heuristic).

## Install

```sh
base=https://huggingface.co/onnx-community/depth-anything-v2-small-ONNX/resolve/main
curl -L -o models/depth/model_quantized.onnx      "$base/onnx/model_quantized.onnx"
curl -L -o models/depth/model_quantized.onnx_data "$base/onnx/model_quantized.onnx_data"
curl -L -o models/depth/preprocessor_config.json  "$base/preprocessor_config.json"
curl -L -o models/depth/config.json               "$base/config.json"
```

Quality rationale and alternatives: see `docs/2026-ml-integration-plan.md`.

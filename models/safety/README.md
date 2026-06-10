# Safe Mode Models

This folder holds local ONNX models used before thumbnails, face matching, clustering, MCP responses, and exports.

Current installed model:

- `adamcodd_vit_base_nsfw_int8.onnx`
- Source: `AdamCodd/vit-base-nsfw-detector`
- License: Apache-2.0
- Input: 384x384 RGB, normalized with mean/std `[0.5, 0.5, 0.5]`
- Labels: `sfw`, `nsfw`

The runtime prefers a Marqo ONNX export if a file with `marqo` in its name is present, because `res.md` recommends `Marqo/nsfw-image-detection-384` as the best size/license/default tradeoff. Marqo does not currently ship a ready ONNX file, so the app can use this ready-made ONNX model immediately while still supporting a Marqo drop-in export later.

Each `.onnx` file should have a matching `.json` manifest with `inputSize`, `labels`, `nsfwLabel`, `mean`, `std`, `license`, and `source`.

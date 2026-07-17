# Semantic-search model pack (natural-language photo and video search)

On-device visual+text embeddings for the `semantic_search_photos` command. The
same vision encoder indexes still images and timestamped visual segments from
videos. It runs fully offline on ONNX Runtime; Apple builds use the CPU provider
for this dynamic-shape export. The engine is
`crossage_fr/embed/siglip_engine.py`; it degrades gracefully (`available: false`)
when this pack is absent or fails integrity verification, so the app falls back
to the lexical `search_photo_library` path.

## Recommended weights (vendored at build time — not committed)

- **SigLIP 2 base, patch16, 256px** — Tschannen et al. 2025, Apache-2.0.
  - Source repo: https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX
  - Files (place all in this directory):
    | file | source path | bytes | sha256 |
    |---|---|---|---|
    | `vision_model_uint8.onnx` | `onnx/vision_model_uint8.onnx` | 94,737,653 | `f2eb8ccfa3dc0b3761d9ea9a39554fe0f2be71b247ad7f68a80720ec88895650` |
    | `text_model_uint8.onnx` | `onnx/text_model_uint8.onnx` | 283,438,275 | `8c6d2827118d6d0e50db7392588d73133c7d2147997da522a1b2d144df535aed` |
    | `tokenizer.json` | `tokenizer.json` | 34,363,039 | `cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322` |
    | `tokenizer_config.json`, `special_tokens_map.json`, `preprocessor_config.json`, `config.json` | (same names) | — | metadata |
  - Vision input: `pixel_values` `[B,3,256,256]` float32, normalized to [-1,1].
  - Text input: `input_ids` `[B,64]` int64 (lowercased, EOS-terminated, padded — baked into `tokenizer.json`).
  - Embedding: each model's `pooler_output` `[B,768]`, L2-normalized; rank by cosine.

All three required runtime files are size/hash-checked by the desktop packager,
and their SHA-256 values are pinned in `crossage_fr/embed/siglip_engine.py`
(`_PINNED_SEMANTIC_HASHES`). A missing, renamed, or mismatched file is rejected
(fail closed).

## Runtime dependency

Text encoding needs the `tokenizers` package (Rust fast tokenizer; loads
`tokenizer.json` from disk, no network). Already pinned in `requirements*.txt`.

## Install

```sh
base=https://huggingface.co/onnx-community/siglip2-base-patch16-256-ONNX/resolve/main
for f in tokenizer.json tokenizer_config.json special_tokens_map.json preprocessor_config.json config.json; do
  curl -L -o "models/semantic/$f" "$base/$f"; done
curl -L -o models/semantic/vision_model_uint8.onnx "$base/onnx/vision_model_uint8.onnx"
curl -L -o models/semantic/text_model_uint8.onnx   "$base/onnx/text_model_uint8.onnx"
```

Quality rationale and alternatives: see `docs/2026-ml-integration-plan.md`.

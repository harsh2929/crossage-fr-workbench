# Multimodal Safe Mode

## Scope

Vintrace can run an optional category-aware visual policy before face matching,
clustering, previews, MCP exposure, and exports. It evaluates four fixed categories:

- `sexually_explicit`
- `violence_gore`
- `dangerous_activity`
- `self_harm`

This remains a local UX gate. It does not identify CSAM, compare hashes, report
content, contact a platform or authority, or make a legal determination. Human
review and per-image overrides remain authoritative.

## Model decision

The audit recommendation named ShieldGemma 2 or Llama Guard. ShieldGemma 2 is a
specialist 4B image-safety model with sexually explicit, dangerous-content, and
violence/gore policies, but Google's official distribution is gated by the Gemma
terms and uses a different heavyweight runtime. See the
[official ShieldGemma guide](https://ai.google.dev/gemma/docs/shieldgemma),
[ShieldGemma 2 model card](https://ai.google.dev/gemma/docs/shieldgemma/model_card_2),
and [official gated model repository](https://huggingface.co/google/shieldgemma-2-4b-it).

Vintrace instead reuses its already packaged, pinned, offline llama.cpp worker and
the Apache-2.0 Qwen3-VL 4B quality pack. This avoids a second Torch/Transformers
runtime and a gated default download. Qwen3-VL is a general VLM, not a specialist
safety model, so the product and evidence call this a policy-constrained visual
guardrail rather than ShieldGemma.

The low-memory SmolVLM2 pack is valid for captions but is explicitly not approved
for safety. On the fixed acceptance pair it falsely flagged a benign boarding pass
in every category and missed active firearm use. Production safety routing requires
the exact Qwen3-VL quality tier and refuses automatic downgrade.

## Decision boundary

The model does not decide `allow` or `flag` and does not return free-form reasons.
It selects one bounded visible-evidence code and confidence level for each fixed
category. Vintrace then:

1. Validates that every category is present and every value belongs to its enum.
2. Maps evidence/confidence to a deterministic score.
3. Applies the workspace Safe Mode temperature to each score.
4. Applies the existing Safe Mode threshold.
5. Takes the protective maximum of the category score and compatibility detector.
6. Builds a canonical reason from category, score, and evidence code.

Image text is untrusted and cannot change the policy. The prompt forbids identity,
age, sensitive-trait, intent, and legal inferences. Missing, malformed, oversized,
contradictory, unavailable, or timed-out model output falls back to the ONNX and
heuristic compatibility gate. A transient multimodal fallback is not cached.

## Operation

- The recommended preset keeps category mode off for bulk-scan throughput.
- The Privacy first preset enables it.
- Settings exposes an explicit toggle, verified quality-pack installer, readiness,
  compatibility-fallback state, and a substantial per-image latency warning.
- Scan estimates add five seconds per uncached image while the mode is enabled.
- Cache identity includes policy version, catalog hash, model revision,
  temperature, and enabled mode.
- Review shows durable per-category scores and the canonical evidence reason.
- MCP `assess_image`, state summaries, compliance exports, examination reports,
  DPIA drafts, and Safe Mode audit exports expose the same policy state.

## Acceptance evidence

The real-model acceptance ran the pinned Qwen3-VL quality GGUF and pinned llama.cpp
runtime at threshold `0.58`, temperature `1.0`, with all parent-process network
connections restricted to loopback:

- Benign boarding pass, SHA-256
  `4425af33dd163cf73bdff502bd35ee527e9bdd5725501db1da78bfdae9f538f4`:
  all categories `0.38`, below threshold.
- Public-domain NIOSH firing-range photograph, SHA-256
  `a831308907985565ef460f37cd199bf79dda5093279deaf5cc84c5a9cb6d218e`:
  `dangerous_activity=0.95`, evidence `weapon_use`; other categories `0.38`.
- Model revision `1cd86afb9a95c410a6038ab3b40d8b578c892266`.
- Runtime revision `76f2798059575a96a12e4d34342165a4b6a6a312`.
- Inference latency was 6.13 seconds then 4.42 seconds; outbound attempts: none.

The positive fixture is the public-domain NIOSH image
[Small firearm training at an indoor firing range](https://commons.wikimedia.org/wiki/File:Small_firearm_training_at_an_indoor_firing_range.jpg).

Evidence files:

- [Passing quality-tier acceptance](../benchmarks/results/multimodal-safety-benchmark-20260713.json)
- [Rejected low-memory qualification](../benchmarks/results/multimodal-safety-low-memory-negative-20260713.json)

Run the acceptance against operator-reviewed fixtures with:

```bash
PYTHONPATH=. .venv/bin/python benchmarks/run_multimodal_safety_benchmark.py \
  --tier quality \
  --case 'benign=/path/to/benign.jpg=none' \
  --case 'weapon-use=/path/to/weapon-use.jpg=dangerous_activity' \
  --output benchmarks/results/multimodal-safety-local.json
```

## Limitations

The two-case acceptance proves runtime, routing, structured policy behavior,
offline confinement, one benign control, and one dangerous-activity positive. It
is not a population accuracy benchmark or safety certification. Operators should
calibrate on representative, lawfully held local examples and review false
positives/negatives. The compatibility detector remains active, and protected
source media is never modified.

"""Drop-in recognizer export validation (Phase-4 §5.1).

Activating a stronger recognizer (e.g. LVFace) is config-only via the recognizer seam --
but a mis-exported ONNX fails in two SILENT ways the verification pass flagged: (1)
insightface's model_zoo routes an ONNX to the recognizer ONLY when its input is square,
>=112, a multiple of 16, with exactly one output -- otherwise it never loads as a
recognizer; (2) an early Sub/Mul graph node flips preprocessing to mean=0/std=1, yielding
garbage embeddings with no error. This module validates a candidate BEFORE it is trusted,
so a bad drop-in is rejected with an actionable reason instead of corrupting matching.

`assess_recognizer_io` is pure (unit-testable); `validate_recognizer_onnx` extracts the
metadata via ONNX Runtime (+ the `onnx` graph when available) and calls it.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Sequence

EXPECTED_EMBED_DIM = 512


def _dynamic(value: Any) -> bool:
    return isinstance(value, str) or value is None or (isinstance(value, int) and value <= 0)


def assess_recognizer_io(
    input_shape: Sequence[Any],
    *,
    output_count: int,
    output_dim: Any = None,
    first_node_ops: Sequence[str] = (),
) -> dict[str, Any]:
    """Verdict on whether a recognizer ONNX's I/O is compatible with the pipeline."""
    reasons: list[str] = []
    if len(input_shape) >= 4:
        height, width = input_shape[2], input_shape[3]
        if not _dynamic(height) and not _dynamic(width):
            if height != width:
                reasons.append("input is not square; insightface only routes square inputs to the recognizer")
            if isinstance(height, int) and (height < 112 or height % 16 != 0):
                reasons.append("input side must be >=112 and a multiple of 16 to load as a recognizer")
    else:
        reasons.append("unexpected input rank (need N,C,H,W)")
    if output_count != 1:
        reasons.append(f"recognizer must have exactly one output (found {output_count})")
    if output_dim is not None and not _dynamic(output_dim) and int(output_dim) != EXPECTED_EMBED_DIM:
        reasons.append(f"embedding dim {output_dim} != {EXPECTED_EMBED_DIM} (pipeline assumes 512-d)")
    if any(str(op).lower().startswith(("sub", "mul")) for op in list(first_node_ops)[:8]):
        reasons.append("an early Sub/Mul node will silently flip preprocessing (mean=0/std=1) -> garbage embeddings; re-export with normalization outside the graph")
    return {"ok": not reasons, "reasons": reasons}


def validate_recognizer_onnx(path: Path) -> dict[str, Any]:
    """Validate a candidate recognizer ONNX on disk. Returns {ok, reasons, ...}."""
    path = Path(path)
    if not path.is_file():
        return {"ok": False, "reasons": [f"file not found: {path}"]}
    if importlib.util.find_spec("onnxruntime") is None:
        return {"ok": False, "reasons": ["onnxruntime is not available to inspect the model"]}
    try:
        import onnxruntime

        session = onnxruntime.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        inp = session.get_inputs()[0]
        outputs = session.get_outputs()
        out_dim = outputs[0].shape[-1] if outputs and outputs[0].shape else None
    except Exception as exc:
        return {"ok": False, "reasons": [f"failed to open ONNX: {type(exc).__name__}: {exc}"]}

    first_node_ops: list[str] = []
    if importlib.util.find_spec("onnx") is not None:
        try:
            import onnx

            graph = onnx.load(str(path)).graph
            first_node_ops = [node.op_type for node in list(graph.node)[:8]]
        except Exception:
            first_node_ops = []

    verdict = assess_recognizer_io(
        list(inp.shape), output_count=len(outputs), output_dim=out_dim, first_node_ops=first_node_ops
    )
    verdict["inputName"] = inp.name
    verdict["inputShape"] = list(inp.shape)
    verdict["outputCount"] = len(outputs)
    verdict["embeddingDim"] = out_dim
    if not first_node_ops:
        verdict.setdefault("notes", []).append("normalization-trap check skipped (onnx package unavailable); verify preprocessing manually")
    return verdict

"""Unit tests for the FIQA seam (Phase 2.2).

Run: PYTHONPATH=. .venv/bin/python tests/fiqa_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from crossage_fr.embed.fiqa import effective_quality, find_fiqa_model, load_fiqa_scorer


def test_find_fiqa_model_discovers_drop_in_and_handles_absence() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        assert find_fiqa_model(root) is None  # nothing installed -> graceful None
        fiq_dir = root / "models" / "fiq"
        fiq_dir.mkdir(parents=True)
        (fiq_dir / "ediffiqa_tiny_jun2024.onnx").write_bytes(b"placeholder")
        assert find_fiqa_model(root) is not None  # discovered as a drop-in


def test_load_fiqa_scorer_is_none_without_a_model() -> None:
    # No model path -> no scorer; the pipeline must fall back to the embedding norm.
    assert load_fiqa_scorer(None) is None


def test_effective_quality_prefers_fiqa_else_norm() -> None:
    # When a FIQA score is present it wins; otherwise the calibrated norm is used.
    assert effective_quality(0.50, 0.80) == 0.80
    assert effective_quality(0.50, None) == 0.50
    # FIQA score is clamped into [0,1].
    assert effective_quality(0.50, 1.5) == 1.0
    assert effective_quality(0.50, -0.2) == 0.0


def main() -> None:
    test_find_fiqa_model_discovers_drop_in_and_handles_absence()
    test_load_fiqa_scorer_is_none_without_a_model()
    test_effective_quality_prefers_fiqa_else_norm()
    print("fiqa units ok")


if __name__ == "__main__":
    main()

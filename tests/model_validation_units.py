"""Unit tests for recognizer drop-in export validation (§5.1).

Run: PYTHONPATH=. .venv/bin/python tests/model_validation_units.py
"""

from __future__ import annotations

from crossage_fr.embed.model_validation import assess_recognizer_io


def test_valid_arcface_style_export_passes() -> None:
    verdict = assess_recognizer_io([1, 3, 112, 112], output_count=1, output_dim=512, first_node_ops=["Conv", "Relu"])
    assert verdict["ok"] is True and verdict["reasons"] == []


def test_dynamic_input_is_accepted() -> None:
    # A dynamic batch / spatial axis must not be falsely flagged.
    verdict = assess_recognizer_io(["N", 3, "H", "W"], output_count=1, output_dim=512)
    assert verdict["ok"] is True


def test_non_square_or_misrouted_input_is_flagged() -> None:
    # insightface routes ONLY square, >=112, %16 inputs to the recognizer.
    assert assess_recognizer_io([1, 3, 112, 96], output_count=1, output_dim=512)["ok"] is False
    assert assess_recognizer_io([1, 3, 100, 100], output_count=1, output_dim=512)["ok"] is False  # not %16 / <112 edge


def test_multi_output_is_flagged() -> None:
    assert assess_recognizer_io([1, 3, 112, 112], output_count=2, output_dim=512)["ok"] is False


def test_normalization_flip_trap_is_flagged() -> None:
    # An early Sub/Mul node silently flips preprocessing to mean=0/std=1 -> garbage.
    verdict = assess_recognizer_io([1, 3, 112, 112], output_count=1, output_dim=512, first_node_ops=["Sub", "Mul", "Conv"])
    assert verdict["ok"] is False
    assert any("preprocess" in r.lower() or "sub/mul" in r.lower() for r in verdict["reasons"])


def test_wrong_embedding_dim_is_flagged() -> None:
    assert assess_recognizer_io([1, 3, 112, 112], output_count=1, output_dim=256)["ok"] is False


def main() -> None:
    test_valid_arcface_style_export_passes()
    test_dynamic_input_is_accepted()
    test_non_square_or_misrouted_input_is_flagged()
    test_multi_output_is_flagged()
    test_normalization_flip_trap_is_flagged()
    test_wrong_embedding_dim_is_flagged()
    print("model validation units ok")


if __name__ == "__main__":
    main()

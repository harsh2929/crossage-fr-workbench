"""Unit tests for the held-out per-user validation gate (Phase-4 §6).

Run: PYTHONPATH=. .venv/bin/python tests/validation_units.py
"""

from __future__ import annotations

from crossage_fr.match.validation import held_out_gate, split_by_identity


def _rows() -> list[dict]:
    # rawCosine OVERLAPS within each identity (genuine {0.50,0.42} vs impostor {0.44,0.30}),
    # so the baseline tops out ~0.75 accuracy and leaves room. betterScore separates
    # cleanly (0.80 vs 0.20); worseScore is constant (no separation).
    rows: list[dict] = []
    for i in range(6):  # 6 identities so an identity-level split has both folds populated
        person = f"P{i}"
        for gen_raw in (0.50, 0.42):
            rows.append({"expectedPerson": person, "isMatch": True,
                         "rawCosine": gen_raw, "betterScore": 0.80, "worseScore": 0.50})
        for imp_raw in (0.44, 0.30):
            rows.append({"expectedPerson": person, "isMatch": False,
                         "rawCosine": imp_raw, "betterScore": 0.20, "worseScore": 0.50})
    return rows


def test_split_by_identity_is_disjoint_and_grouped() -> None:
    rows = _rows()
    train, test = split_by_identity(rows, frac=0.5, seed=1)
    train_ids = {r["expectedPerson"] for r in train}
    test_ids = {r["expectedPerson"] for r in test}
    assert train_ids and test_ids
    assert train_ids.isdisjoint(test_ids)  # no identity leaks across the split


def test_gate_promotes_a_change_that_improves_held_out_separability() -> None:
    # rawCosine overlaps (genuine 0.40 vs impostor 0.36); betterScore separates cleanly.
    gate = held_out_gate(_rows(), lambda train: (lambda r: r["betterScore"]), score_key="rawCosine", seed=3)
    assert gate["promote"] is True
    assert gate["candidateAccuracy"] >= gate["baselineAccuracy"]


def test_gate_rejects_a_harmful_or_noop_change() -> None:
    # A non-separating transform must NOT be promoted...
    harmful = held_out_gate(_rows(), lambda train: (lambda r: r["worseScore"]), score_key="rawCosine", seed=3)
    assert harmful["promote"] is False
    # ...and an identity (no-op) transform yields zero delta -> not promoted.
    noop = held_out_gate(_rows(), lambda train: (lambda r: r["rawCosine"]), score_key="rawCosine", seed=3)
    assert noop["promote"] is False


def test_gate_refuses_insufficient_labels() -> None:
    gate = held_out_gate(_rows()[:4], lambda train: (lambda r: r["betterScore"]), score_key="rawCosine")
    assert gate["promote"] is False
    assert "label" in gate["reason"].lower() or "insufficient" in gate["reason"].lower()


def main() -> None:
    test_split_by_identity_is_disjoint_and_grouped()
    test_gate_promotes_a_change_that_improves_held_out_separability()
    test_gate_rejects_a_harmful_or_noop_change()
    test_gate_refuses_insufficient_labels()
    print("validation units ok")


if __name__ == "__main__":
    main()

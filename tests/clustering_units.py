"""Unit tests for the kNN-graph clusterer (Phase 2.4).

Run: PYTHONPATH=. .venv/bin/python tests/clustering_units.py
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3

import numpy as np

from crossage_fr.cluster import clusterer as clusterer_module
from crossage_fr.cluster.clusterer import cluster_vectors, cluster_vectors_graph
from crossage_fr.cluster.global_pass import GLOBAL_CLUSTER_VERSION, GlobalUnmatchedSpool


def _dim8(*active: int) -> list[float]:
    vec = [0.0] * 8
    for i in active:
        vec[i] = 1.0
    return vec


def test_graph_separates_clusters_and_marks_noise() -> None:
    # Cluster A (dim 0), cluster B (dim 1), one isolated vector (dim 7).
    vectors = [_dim8(0)] * 3 + [_dim8(1)] * 3 + [_dim8(7)]
    labels = cluster_vectors_graph(vectors, min_cluster_size=2, threshold=0.5)
    assert labels[0] == labels[1] == labels[2]      # A coheres
    assert labels[3] == labels[4] == labels[5]      # B coheres
    assert labels[0] != labels[3]                   # A and B are distinct
    assert labels[6] == -1                          # isolated -> noise (below min size)
    assert len({label for label in labels if label >= 0}) == 2


def test_graph_precision_first_does_not_merge_dissimilar() -> None:
    # Orthogonal vectors below threshold must never be merged (precision-first).
    labels = cluster_vectors_graph([_dim8(0), _dim8(1), _dim8(2)], min_cluster_size=2, threshold=0.5)
    assert labels == [-1, -1, -1]


def test_cluster_vectors_contract_preserved() -> None:
    # Public entrypoint keeps the (labels list, -1 = noise) contract.
    labels = cluster_vectors([_dim8(0)] * 2 + [_dim8(3)], min_cluster_size=2)
    assert labels[0] == labels[1] and labels[0] >= 0
    assert labels[2] == -1
    # Below min size -> all noise.
    assert cluster_vectors([_dim8(0)], min_cluster_size=2) == [-1]


def test_graph_labels_are_permutation_invariant_and_accept_numpy() -> None:
    vectors = np.asarray([_dim8(0)] * 3 + [_dim8(1)] * 3 + [_dim8(7)], dtype="float32")
    baseline = cluster_vectors_graph(vectors, min_cluster_size=2, threshold=0.5)
    order = [6, 3, 0, 4, 1, 5, 2]
    permuted = cluster_vectors_graph(vectors[order], min_cluster_size=2, threshold=0.5)
    restored = [-1] * len(order)
    for permuted_index, original_index in enumerate(order):
        restored[original_index] = permuted[permuted_index]
    assert restored == baseline


def test_numpy_knn_fallback_uses_bounded_blocks() -> None:
    original_find_spec = clusterer_module.importlib.util.find_spec
    original_budget = clusterer_module.NUMPY_KNN_TEMP_BUDGET_BYTES
    clusterer_module.importlib.util.find_spec = (
        lambda name: None if name == "faiss" else original_find_spec(name)
    )
    clusterer_module.NUMPY_KNN_TEMP_BUDGET_BYTES = 1
    try:
        labels = cluster_vectors_graph(
            np.asarray([_dim8(0)] * 3 + [_dim8(1)] * 3 + [_dim8(7)], dtype="float32"),
            min_cluster_size=2,
            threshold=0.5,
        )
    finally:
        clusterer_module.importlib.util.find_spec = original_find_spec
        clusterer_module.NUMPY_KNN_TEMP_BUDGET_BYTES = original_budget
    assert labels[0] == labels[1] == labels[2] >= 0
    assert labels[3] == labels[4] == labels[5] >= 0
    assert labels[0] != labels[3]
    assert labels[6] == -1


def _spool_assignments(
    records: list[tuple[str, str, list[float], str]],
    order: list[int],
    *,
    commit_every: int = 0,
    min_cluster_size: int = 2,
) -> tuple[dict[str, str | None], list[tuple[int, int]], bool]:
    conn = sqlite3.connect(":memory:")
    spool = GlobalUnmatchedSpool(conn, "test-run")
    keys: dict[str, str] = {}
    for insertion_index, record_index in enumerate(order, start=1):
        filename, model_name, vector, source_hash = records[record_index]
        key = spool.add(
            Path("/library") / filename,
            0.9,
            model_name,
            vector,
            {"source_hash": source_hash, "media_kind": "image"},
            (0, 0, 10, 10),
        )
        keys[filename] = key
        if commit_every and insertion_index % commit_every == 0:
            conn.commit()
    assignments: dict[str, str | None] = {}
    group_sizes: list[tuple[int, int]] = []
    for group in spool.groups():
        clustered = spool.cluster_group(group, min_cluster_size)
        group_sizes.append((group.rows, group.unique_rows))
        for filename, stable_key in keys.items():
            if stable_key in clustered.assignments:
                assignments[filename] = clustered.assignments[stable_key]
    spool.close()
    cleaned = not conn.execute(
        "SELECT 1 FROM sqlite_temp_master WHERE type = 'table' AND name = 'unmatched_cluster_spool'"
    ).fetchone()
    conn.close()
    return assignments, group_sizes, cleaned


def test_global_spool_is_order_and_commit_batch_invariant() -> None:
    records = [
        ("a-1.jpg", "model-a", _dim8(0), "01" * 32),
        ("a-2.jpg", "model-a", _dim8(0), "02" * 32),
        ("a-3.jpg", "model-a", _dim8(0), "03" * 32),
        ("b-1.jpg", "model-a", _dim8(1), "11" * 32),
        ("b-2.jpg", "model-a", _dim8(1), "12" * 32),
        ("b-3.jpg", "model-a", _dim8(1), "13" * 32),
    ]
    forward, sizes, cleaned = _spool_assignments(records, list(range(6)), commit_every=2)
    reverse, reverse_sizes, reverse_cleaned = _spool_assignments(records, list(reversed(range(6))), commit_every=5)
    assert forward == reverse
    assert sizes == reverse_sizes == [(6, 6)]
    assert cleaned and reverse_cleaned
    names = {name for name in forward.values() if name}
    assert len(names) == 2
    assert all(name.startswith("Unmatched cluster ") and len(name.split()[-1]) == 16 for name in names)
    assert len({forward[f"a-{index}.jpg"] for index in range(1, 4)}) == 1
    assert len({forward[f"b-{index}.jpg"] for index in range(1, 4)}) == 1


def test_global_spool_isolates_models_and_deduplicates_media() -> None:
    duplicate_hash = "aa" * 32
    records = [
        ("copy-a.jpg", "model-a", _dim8(0), duplicate_hash),
        ("copy-b.jpg", "model-a", _dim8(0), duplicate_hash),
        ("other-model.jpg", "model-b", _dim8(0), "bb" * 32),
        ("other-dimension.jpg", "model-a", [1.0] + [0.0] * 15, "cc" * 32),
    ]
    assignments, sizes, cleaned = _spool_assignments(records, [0, 2, 3, 1], min_cluster_size=2)
    assert cleaned
    assert sorted(sizes) == [(1, 1), (1, 1), (2, 1)]
    assert assignments == {
        "copy-a.jpg": None,
        "copy-b.jpg": None,
        "other-model.jpg": None,
        "other-dimension.jpg": None,
    }


def test_global_cluster_names_do_not_reuse_ordinals_across_runs() -> None:
    first_records = [
        ("first-1.jpg", "model-a", _dim8(0), "21" * 32),
        ("first-2.jpg", "model-a", _dim8(0), "22" * 32),
    ]
    second_records = [
        ("second-1.jpg", "model-a", _dim8(0), "31" * 32),
        ("second-2.jpg", "model-a", _dim8(0), "32" * 32),
    ]
    first, _sizes, _cleaned = _spool_assignments(first_records, [0, 1])
    second, _sizes2, _cleaned2 = _spool_assignments(second_records, [0, 1])
    assert len(set(first.values())) == len(set(second.values())) == 1
    assert next(iter(first.values())) != next(iter(second.values()))


def test_global_spool_rejects_nonfinite_biometric_rows() -> None:
    conn = sqlite3.connect(":memory:")
    spool = GlobalUnmatchedSpool(conn, "invalid-test")
    for quality, vector in ((float("nan"), _dim8(0)), (0.9, [float("inf")] + [0.0] * 7)):
        try:
            spool.add(Path("/invalid.jpg"), quality, "model-a", vector, {"source_hash": "ff" * 32})
        except ValueError:
            pass
        else:
            raise AssertionError("Non-finite unmatched rows must be rejected.")
    assert spool.count == 0
    spool.close()
    conn.close()


def test_global_clustering_scale_evidence_contract() -> None:
    report_path = (
        Path(__file__).resolve().parents[1]
        / "benchmarks"
        / "results"
        / "global-clustering-benchmark-20260712.json"
    )
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["status"] == "pass"
    assert report["recommendation"] == "ML-08"
    assert report["implementationVersion"] == GLOBAL_CLUSTER_VERSION
    assert report["corpus"]["rows"] > report["corpus"]["formerOverflowCap"] == 20_000
    assert report["corpus"]["dimension"] == 512
    assert all(report["gates"].values())


def main() -> None:
    test_graph_separates_clusters_and_marks_noise()
    test_graph_precision_first_does_not_merge_dissimilar()
    test_cluster_vectors_contract_preserved()
    test_graph_labels_are_permutation_invariant_and_accept_numpy()
    test_numpy_knn_fallback_uses_bounded_blocks()
    test_global_spool_is_order_and_commit_batch_invariant()
    test_global_spool_isolates_models_and_deduplicates_media()
    test_global_cluster_names_do_not_reuse_ordinals_across_runs()
    test_global_spool_rejects_nonfinite_biometric_rows()
    test_global_clustering_scale_evidence_contract()
    print("clustering units ok")


if __name__ == "__main__":
    main()

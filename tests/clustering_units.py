"""Unit tests for the kNN-graph clusterer (Phase 2.4).

Run: PYTHONPATH=. .venv/bin/python tests/clustering_units.py
"""

from __future__ import annotations

from crossage_fr.cluster.clusterer import cluster_vectors, cluster_vectors_graph


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


def main() -> None:
    test_graph_separates_clusters_and_marks_noise()
    test_graph_precision_first_does_not_merge_dissimilar()
    test_cluster_vectors_contract_preserved()
    print("clustering units ok")


if __name__ == "__main__":
    main()

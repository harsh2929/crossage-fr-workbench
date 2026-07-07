"""Face-embedding clustering (Phase 2.4).

Replaces the PCA + HDBSCAN/DBSCAN density wrapper with a license-clean cosine
kNN-graph + connected-components clusterer: faiss (MIT) for the kNN when available,
NumPy brute force otherwise, and a pure union-find for components -- no copyleft
(infomap/Leiden/igraph) and no PCA discarding discriminative variance. Tuned
precision-first (a similarity threshold, not a density radius) because for a
review-first personal library a false MERGE of two relatives is far costlier to the
user than a false split they can merge by hand. A cosine DBSCAN fallback remains for
robustness if the graph pass yields nothing.
"""

from __future__ import annotations

import importlib.util

import numpy as np

# Precision-first edge threshold (cosine similarity). Higher = purer clusters / more
# splits. Should ultimately be tuned against a labeled clustering benchmark.
DEFAULT_EDGE_THRESHOLD = 0.5
DEFAULT_KNN = 20


def _normalize(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return values / norms


def _knn(values: np.ndarray, k: int) -> list[list[tuple[int, float]]]:
    """For each row, its up-to-k most cosine-similar other rows (faiss if present)."""
    n = values.shape[0]
    k = max(1, min(int(k), n - 1))
    if importlib.util.find_spec("faiss") is not None:
        try:
            import faiss

            index = faiss.IndexFlatIP(values.shape[1])
            index.add(values)
            sims, idx = index.search(values, min(k + 1, n))
            result: list[list[tuple[int, float]]] = []
            for i in range(n):
                neighbors = [(int(j), float(s)) for j, s in zip(idx[i], sims[i]) if int(j) != i]
                result.append(neighbors[:k])
            return result
        except Exception:
            pass
    sims = values @ values.T
    np.fill_diagonal(sims, -1.0)
    result = []
    for i in range(n):
        top = np.argpartition(-sims[i], k - 1)[:k] if k < n else np.argsort(-sims[i])
        result.append([(int(j), float(sims[i][int(j)])) for j in top])
    return result


def cluster_vectors_graph(
    vectors: list[list[float]],
    min_cluster_size: int = 2,
    *,
    k: int = DEFAULT_KNN,
    threshold: float = DEFAULT_EDGE_THRESHOLD,
) -> list[int]:
    """Cluster L2-normalized embeddings via a cosine kNN graph + connected components.

    Returns a label per vector (-1 = noise / below min_cluster_size).
    """
    n = len(vectors)
    if n < max(2, int(min_cluster_size)):
        return [-1] * n
    values = _normalize(np.asarray(vectors, dtype="float32"))

    parent = list(range(n))

    def find(x: int) -> int:
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for i, neighbors in enumerate(_knn(values, k)):
        for j, sim in neighbors:
            if sim >= threshold:
                union(i, j)

    components: dict[int, list[int]] = {}
    for i in range(n):
        components.setdefault(find(i), []).append(i)
    labels = [-1] * n
    next_label = 0
    for members in components.values():
        if len(members) >= int(min_cluster_size):
            for member in members:
                labels[member] = next_label
            next_label += 1
    return labels


def _dbscan_fallback(values: np.ndarray, min_cluster_size: int) -> list[int] | None:
    if importlib.util.find_spec("sklearn") is None:
        return None
    try:
        from sklearn.cluster import DBSCAN

        labels = [int(label) for label in DBSCAN(eps=0.35, min_samples=min_cluster_size, metric="cosine").fit_predict(values)]
        return labels if any(label >= 0 for label in labels) else None
    except Exception:
        return None


def cluster_vectors(vectors: list[list[float]], min_cluster_size: int = 2) -> list[int]:
    if len(vectors) < min_cluster_size:
        return [-1 for _ in vectors]
    labels = cluster_vectors_graph(vectors, min_cluster_size)
    if any(label >= 0 for label in labels):
        return labels
    fallback = _dbscan_fallback(_normalize(np.asarray(vectors, dtype="float32")), min_cluster_size)
    if fallback is not None:
        return fallback
    return [-1 for _ in vectors]

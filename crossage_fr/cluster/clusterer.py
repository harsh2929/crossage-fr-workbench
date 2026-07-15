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
from collections.abc import Callable, Sequence
import hashlib

import numpy as np

# Precision-first edge threshold (cosine similarity). Higher = purer clusters / more
# splits. Should ultimately be tuned against a labeled clustering benchmark.
DEFAULT_EDGE_THRESHOLD = 0.5
DEFAULT_KNN = 20
KNN_QUERY_BATCH_SIZE = 512
NUMPY_KNN_TEMP_BUDGET_BYTES = 96 * 1024 * 1024
DBSCAN_FALLBACK_MAX_ROWS = 5_000


VectorRows = Sequence[Sequence[float]] | np.ndarray


def _as_matrix(vectors: VectorRows) -> np.ndarray:
    values = np.asarray(vectors, dtype="float32")
    if values.ndim != 2:
        raise ValueError("Face embeddings must be a two-dimensional matrix.")
    if values.shape[1] == 0 or not np.all(np.isfinite(values)):
        raise ValueError("Face embeddings must contain finite values.")
    return np.ascontiguousarray(values, dtype="float32")


def _normalize(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return values / norms


def _union_knn_graph(
    values: np.ndarray,
    k: int,
    threshold: float,
    union: Callable[[int, int], None],
) -> None:
    """Union qualifying kNN edges without materializing Python neighbor lists."""
    n = values.shape[0]
    k = max(1, min(int(k), n - 1))
    if importlib.util.find_spec("faiss") is not None:
        try:
            import faiss

            index = faiss.IndexFlatIP(values.shape[1])
            index.add(values)
            search_k = min(k + 1, n)
            for start in range(0, n, KNN_QUERY_BATCH_SIZE):
                stop = min(n, start + KNN_QUERY_BATCH_SIZE)
                sims, indices = index.search(values[start:stop], search_k)
                for local_index, (neighbor_ids, neighbor_sims) in enumerate(zip(indices, sims)):
                    source = start + local_index
                    accepted = 0
                    for neighbor, similarity in zip(neighbor_ids, neighbor_sims):
                        target = int(neighbor)
                        if target < 0 or target == source:
                            continue
                        if float(similarity) >= threshold:
                            union(source, target)
                        accepted += 1
                        if accepted >= k:
                            break
            return
        except Exception:
            pass

    # Exact NumPy fallback with a dynamic temporary-memory budget instead of an
    # unbounded n x n similarity matrix.
    bytes_per_pair = np.dtype("float32").itemsize + np.dtype(np.intp).itemsize
    numpy_batch_size = max(
        1,
        min(KNN_QUERY_BATCH_SIZE, NUMPY_KNN_TEMP_BUDGET_BYTES // max(1, n * bytes_per_pair)),
    )
    for start in range(0, n, numpy_batch_size):
        stop = min(n, start + numpy_batch_size)
        similarities = values[start:stop] @ values.T
        row_indices = np.arange(stop - start)
        similarities[row_indices, np.arange(start, stop)] = -np.inf
        neighbors = np.argpartition(-similarities, kth=k - 1, axis=1)[:, :k]
        for local_index, neighbor_ids in enumerate(neighbors):
            source = start + local_index
            for target in neighbor_ids:
                target_index = int(target)
                if float(similarities[local_index, target_index]) >= threshold:
                    union(source, target_index)


def _canonicalize_labels(labels: list[int], values: np.ndarray) -> list[int]:
    """Canonicalize component ordinals from vector content, not input order."""
    components: dict[int, list[int]] = {}
    for index, label in enumerate(labels):
        if label >= 0:
            components.setdefault(int(label), []).append(index)
    if not components:
        return [-1] * len(labels)

    component_order: list[tuple[str, int]] = []
    for label, members in components.items():
        row_hashes = sorted(hashlib.sha256(values[index].tobytes(order="C")).digest() for index in members)
        digest = hashlib.sha256(b"".join(row_hashes)).hexdigest()
        component_order.append((digest, label))
    remap = {label: ordinal for ordinal, (_digest, label) in enumerate(sorted(component_order))}
    return [remap[int(label)] if label >= 0 else -1 for label in labels]


def cluster_vectors_graph(
    vectors: VectorRows,
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
    values = _normalize(_as_matrix(vectors))

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

    _union_knn_graph(values, k, float(threshold), union)

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
    return _canonicalize_labels(labels, values)


def _dbscan_fallback(values: np.ndarray, min_cluster_size: int) -> list[int] | None:
    if len(values) > DBSCAN_FALLBACK_MAX_ROWS:
        return None
    if importlib.util.find_spec("sklearn") is None:
        return None
    try:
        from sklearn.cluster import DBSCAN

        labels = [int(label) for label in DBSCAN(eps=0.35, min_samples=min_cluster_size, metric="cosine").fit_predict(values)]
        return _canonicalize_labels(labels, values) if any(label >= 0 for label in labels) else None
    except Exception:
        return None


def cluster_vectors(vectors: VectorRows, min_cluster_size: int = 2) -> list[int]:
    if len(vectors) < min_cluster_size:
        return [-1 for _ in vectors]
    labels = cluster_vectors_graph(vectors, min_cluster_size)
    if any(label >= 0 for label in labels):
        return labels
    fallback = _dbscan_fallback(_normalize(_as_matrix(vectors)), min_cluster_size)
    if fallback is not None:
        return fallback
    return [-1 for _ in vectors]

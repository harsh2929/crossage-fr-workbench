from __future__ import annotations

import importlib.util

import numpy as np


def _normalize(values: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return values / norms


def _reduce_for_density(values: np.ndarray) -> np.ndarray:
    if values.shape[0] < 4 or values.shape[1] <= 96 or importlib.util.find_spec("sklearn") is None:
        return values
    try:
        from sklearn.decomposition import PCA

        components = min(64, values.shape[0] - 1, values.shape[1])
        if components < 2:
            return values
        reduced = PCA(n_components=components, svd_solver="auto", random_state=42).fit_transform(values)
        return _normalize(np.asarray(reduced, dtype="float32"))
    except Exception:
        return values


def cluster_vectors(vectors: list[list[float]], min_cluster_size: int = 2) -> list[int]:
    if len(vectors) < min_cluster_size:
        return [-1 for _ in vectors]
    values = np.asarray(vectors, dtype="float32")
    values = _normalize(values)
    density_values = _reduce_for_density(values)

    if importlib.util.find_spec("hdbscan") is not None:
        try:
            import hdbscan

            labels = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, metric="euclidean").fit_predict(density_values)
            labels = [int(label) for label in labels]
            if any(label >= 0 for label in labels):
                return labels
        except Exception:
            pass

    try:
        from sklearn.cluster import DBSCAN

        labels = DBSCAN(eps=0.35, min_samples=min_cluster_size, metric="cosine").fit_predict(values)
        labels = [int(label) for label in labels]
        if any(label >= 0 for label in labels):
            return labels
    except Exception:
        pass

    return [-1 for _ in vectors]

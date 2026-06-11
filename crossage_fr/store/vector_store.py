from __future__ import annotations

from dataclasses import dataclass
import importlib.util
import os

import numpy as np


@dataclass(slots=True)
class SearchHit:
    item_id: str
    score: float


def normalize_matrix(values: np.ndarray) -> np.ndarray:
    values = values.astype("float32", copy=False)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    norms[norms == 0.0] = 1.0
    return values / norms


class VectorStore:
    def __init__(self, dimension: int = 512):
        self.dimension = dimension
        self.ids: list[str] = []
        self._vectors = np.empty((0, dimension), dtype="float32")
        self._faiss_index = None
        self._faiss = None
        self._gpu_resources = None
        self._faiss_gpu = False
        if importlib.util.find_spec("faiss") is not None:
            try:
                import faiss

                self._faiss = faiss
                self._faiss_index = self._make_faiss_index()
            except Exception:
                self._faiss = None
                self._faiss_index = None
                self._gpu_resources = None
                self._faiss_gpu = False

    @property
    def size(self) -> int:
        return len(self.ids)

    @property
    def backend_name(self) -> str:
        if self._faiss_index is None:
            return "numpy-flat-ip"
        return "faiss-gpu-flat-ip" if self._faiss_gpu else "faiss-flat-ip"

    def _make_faiss_index(self) -> object:
        index = self._faiss.IndexFlatIP(self.dimension)
        vector_device = os.environ.get("CROSSAGE_VECTOR_DEVICE", "auto").lower()
        if vector_device in {"cpu", "numpy"}:
            self._faiss_gpu = False
            return index
        if not hasattr(self._faiss, "StandardGpuResources") or not hasattr(self._faiss, "index_cpu_to_gpu"):
            self._faiss_gpu = False
            return index
        try:
            self._gpu_resources = self._faiss.StandardGpuResources()
            gpu_index = self._faiss.index_cpu_to_gpu(self._gpu_resources, 0, index)
            self._faiss_gpu = True
            return gpu_index
        except Exception:
            self._gpu_resources = None
            self._faiss_gpu = False
            return index

    def _coerce_matrix(self, vector: list[float] | np.ndarray, rows: int | None = None) -> np.ndarray:
        values = np.asarray(vector, dtype="float32")
        if rows == 1:
            values = values.reshape(1, -1)
        if values.ndim != 2 or values.shape[1] != self.dimension:
            raise ValueError(f"Expected vectors with {self.dimension} dimensions.")
        if not np.isfinite(values).all():
            raise ValueError("Vectors must contain only finite numbers.")
        return values

    def clear(self, capacity: int = 0) -> None:
        self.ids.clear()
        self._vectors = np.empty((max(0, capacity), self.dimension), dtype="float32")
        if self._faiss is not None:
            self._faiss_index = self._make_faiss_index()

    def _ensure_capacity(self, count: int) -> None:
        if self._vectors.shape[0] >= count:
            return
        next_capacity = max(count, 1024 if self._vectors.shape[0] == 0 else self._vectors.shape[0] * 2)
        next_vectors = np.empty((next_capacity, self.dimension), dtype="float32")
        if self.ids:
            next_vectors[: len(self.ids)] = self._vectors[: len(self.ids)]
        self._vectors = next_vectors

    def add(self, item_id: str, vector: list[float] | np.ndarray) -> None:
        values = self._coerce_matrix(vector, rows=1)
        values = normalize_matrix(values)
        self._ensure_capacity(len(self.ids) + 1)
        self._vectors[len(self.ids)] = values[0]
        self.ids.append(item_id)
        if self._faiss_index is not None:
            self._faiss_index.add(values)

    def rebuild(self, vectors_by_id: dict[str, list[float]]) -> None:
        if not vectors_by_id:
            self.clear()
            return
        ids = list(vectors_by_id)
        values = self._coerce_matrix([vectors_by_id[item_id] for item_id in ids])
        values = normalize_matrix(values)
        self.ids = ids
        self._vectors = values.copy()
        if self._faiss is not None:
            self._faiss_index = self._make_faiss_index()
            self._faiss_index.add(self._vectors)

    def search(self, vector: list[float] | np.ndarray, k: int = 10) -> list[SearchHit]:
        limit = min(max(int(k), 0), len(self.ids))
        if not self.ids or limit == 0:
            return []
        query = self._coerce_matrix(vector, rows=1)
        query = normalize_matrix(query)
        if self._faiss_index is not None:
            scores, indexes = self._faiss_index.search(query, limit)
            return [
                SearchHit(item_id=self.ids[int(index)], score=float(score))
                for score, index in zip(scores[0], indexes[0])
                if int(index) >= 0
            ]
        scores = self._vectors[: len(self.ids)] @ query[0]
        if limit >= len(self.ids):
            order = np.argsort(-scores)
        else:
            top = np.argpartition(scores, -limit)[-limit:]
            order = top[np.argsort(-scores[top])]
        return [SearchHit(item_id=self.ids[int(index)], score=float(scores[int(index)])) for index in order]

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import importlib.util
import os
from pathlib import Path
import sys

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


def _configure_faiss_metal_runtime(
    faiss_module: object,
    *,
    platform_name: str | None = None,
    frozen_root: str | Path | None = None,
) -> bool:
    platform_key = platform_name or sys.platform
    if platform_key != "darwin":
        return True
    if not hasattr(faiss_module, "StandardGpuResources") or not hasattr(faiss_module, "index_cpu_to_gpu"):
        return True

    configured = os.environ.get("FAISS_METALLIB_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().is_file()

    candidates: list[Path] = []
    module_file = str(getattr(faiss_module, "__file__", "") or "").strip()
    if module_file:
        candidates.append(Path(module_file).parent / "MetalDistance.metallib")
    runtime_root = frozen_root if frozen_root is not None else getattr(sys, "_MEIPASS", "")
    if runtime_root:
        candidates.append(Path(runtime_root) / "faiss" / "MetalDistance.metallib")

    for candidate in candidates:
        if candidate.is_file():
            os.environ["FAISS_METALLIB_PATH"] = str(candidate)
            return True
    return False


class VectorStore:
    def __init__(
        self,
        dimension: int = 512,
        *,
        ann_threshold: int | None = None,
        ann_m: int = 32,
        ann_ef_construction: int = 160,
        ann_ef_search: int = 128,
        ann_rerank_factor: int = 8,
        ann_exact_fallback_score: float | None = None,
        defer_ann_build: bool = False,
    ):
        self.dimension = dimension
        if ann_threshold is None:
            try:
                ann_threshold = int(os.environ.get("CROSSAGE_VECTOR_ANN_THRESHOLD", "250000"))
            except ValueError:
                ann_threshold = 250000
        self.ann_threshold = max(0, int(ann_threshold))
        self.ann_m = max(4, int(ann_m))
        self.ann_ef_construction = max(self.ann_m, int(ann_ef_construction))
        self.ann_ef_search = max(16, int(ann_ef_search))
        self.ann_rerank_factor = max(2, int(ann_rerank_factor))
        if ann_exact_fallback_score is None:
            try:
                ann_exact_fallback_score = float(
                    os.environ.get("CROSSAGE_VECTOR_ANN_EXACT_FALLBACK_SCORE", "0.05")
                )
            except ValueError:
                ann_exact_fallback_score = 0.05
        self.ann_exact_fallback_score = float(ann_exact_fallback_score)
        self.defer_ann_build = bool(defer_ann_build)
        self._ann_exact_fallbacks = 0
        self._ann_loaded_from_sidecar = False
        self.ids: list[str] = []
        self._id_to_position: dict[str, int] = {}
        self._vectors = np.empty((0, dimension), dtype="float32")
        self._faiss_index = None
        self._faiss = None
        self._gpu_resources = None
        self._faiss_gpu = False
        self._faiss_index_kind = "none"
        self._ann_disabled_reason = ""
        if importlib.util.find_spec("faiss") is not None:
            try:
                import faiss

                self._faiss = faiss
                self._rebuild_faiss_index()
            except Exception:
                self._faiss = None
                self._faiss_index = None
                self._gpu_resources = None
                self._faiss_gpu = False
                self._faiss_index_kind = "none"

    @property
    def size(self) -> int:
        return len(self.ids)

    @property
    def backend_name(self) -> str:
        if self._faiss_index is None:
            return "numpy-flat-ip"
        if self._faiss_index_kind == "hnsw-sq8":
            return "faiss-hnsw-sq8-ip+exact-rerank"
        return "faiss-gpu-flat-ip" if self._faiss_gpu else "faiss-flat-ip"

    @property
    def index_report(self) -> dict[str, object]:
        return {
            "backend": self.backend_name,
            "size": self.size,
            "dimension": self.dimension,
            "annThreshold": self.ann_threshold,
            "approximateCandidates": self._faiss_index_kind == "hnsw-sq8",
            "quantization": "sq8" if self._faiss_index_kind == "hnsw-sq8" else "none",
            "exactRerank": self._faiss_index_kind == "hnsw-sq8",
            "hnswM": self.ann_m if self._faiss_index_kind == "hnsw-sq8" else 0,
            "efConstruction": self.ann_ef_construction if self._faiss_index_kind == "hnsw-sq8" else 0,
            "efSearch": self.ann_ef_search if self._faiss_index_kind == "hnsw-sq8" else 0,
            "exactFallbackScore": self.ann_exact_fallback_score,
            "exactFallbacks": self._ann_exact_fallbacks,
            "annBuildDeferred": self.defer_ann_build and self._should_use_ann(self.size),
            "loadedFromSidecar": self._ann_loaded_from_sidecar,
            "annDisabledReason": self._ann_disabled_reason,
        }

    def _make_flat_faiss_index(self) -> object:
        index = self._faiss.IndexFlatIP(self.dimension)
        vector_device = os.environ.get("CROSSAGE_VECTOR_DEVICE", "auto").lower()
        if vector_device in {"cpu", "numpy"}:
            self._faiss_gpu = False
            return index
        if not hasattr(self._faiss, "StandardGpuResources") or not hasattr(self._faiss, "index_cpu_to_gpu"):
            self._faiss_gpu = False
            return index
        if not _configure_faiss_metal_runtime(self._faiss):
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

    def _should_use_ann(self, count: int) -> bool:
        return (
            self.ann_threshold > 0
            and count >= self.ann_threshold
            and not self._ann_disabled_reason
            and self._faiss is not None
            and hasattr(self._faiss, "IndexHNSWSQ")
            and hasattr(self._faiss, "ScalarQuantizer")
        )

    def _make_ann_faiss_index(self, values: np.ndarray) -> object:
        index = self._faiss.IndexHNSWSQ(
            self.dimension,
            self._faiss.ScalarQuantizer.QT_8bit,
            self.ann_m,
            self._faiss.METRIC_INNER_PRODUCT,
        )
        index.hnsw.efConstruction = self.ann_ef_construction
        index.hnsw.efSearch = self.ann_ef_search
        index.train(values)
        index.add(values)
        return index

    def _rebuild_faiss_index(self) -> None:
        self._faiss_index = None
        self._faiss_gpu = False
        self._gpu_resources = None
        self._faiss_index_kind = "none"
        self._ann_loaded_from_sidecar = False
        if self._faiss is None:
            return
        count = len(self.ids)
        values = self._vectors[:count]
        if self._should_use_ann(count) and not self.defer_ann_build:
            try:
                self._faiss_index = self._make_ann_faiss_index(values)
                self._faiss_index_kind = "hnsw-sq8"
                return
            except Exception as exc:
                self._ann_disabled_reason = f"HNSW/SQ8 unavailable: {exc}"
        self._faiss_index = self._make_flat_faiss_index()
        self._faiss_index_kind = "flat"
        if count:
            self._faiss_index.add(values)

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
        self._id_to_position.clear()
        self._vectors = np.empty((max(0, capacity), self.dimension), dtype="float32")
        self._ann_disabled_reason = ""
        self._ann_exact_fallbacks = 0
        self._ann_loaded_from_sidecar = False
        self._rebuild_faiss_index()

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
        self._id_to_position[item_id] = len(self.ids) - 1
        if (
            self._should_use_ann(len(self.ids))
            and not self.defer_ann_build
            and self._faiss_index_kind != "hnsw-sq8"
        ):
            self._rebuild_faiss_index()
        elif self._faiss_index is not None:
            self._faiss_index.add(values)

    def rebuild(self, vectors_by_id: dict[str, list[float]]) -> None:
        if not vectors_by_id:
            self.clear()
            return
        ids = list(vectors_by_id)
        self.rebuild_arrays(ids, [vectors_by_id[item_id] for item_id in ids])

    def rebuild_arrays(
        self,
        ids: list[str],
        vectors: list[list[float]] | np.ndarray,
    ) -> None:
        if not ids:
            self.clear()
            return
        if len(set(ids)) != len(ids):
            raise ValueError("Vector ids must be unique.")
        values = self._coerce_matrix(vectors)
        if len(ids) != values.shape[0]:
            raise ValueError("Vector id count must match vector row count.")
        values = normalize_matrix(values)
        self.ids = list(ids)
        self._id_to_position = {item_id: index for index, item_id in enumerate(ids)}
        self._vectors = values.copy()
        self._ann_disabled_reason = ""
        self._rebuild_faiss_index()

    def build_ann(self) -> bool:
        self.defer_ann_build = False
        self._ann_disabled_reason = ""
        self._rebuild_faiss_index()
        return self._faiss_index_kind == "hnsw-sq8"

    @staticmethod
    def _ann_sidecar_path(path: Path) -> Path:
        return Path(str(path) + ".faiss")

    @staticmethod
    def _sha256_file(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _vector_fingerprint(self, ids: list[str], values: np.ndarray) -> str:
        digest = hashlib.sha256()
        digest.update(b"vintrace-vector-store-v2\0")
        digest.update(np.asarray([self.dimension, len(ids)], dtype="<i8").tobytes())
        for item_id in ids:
            encoded = item_id.encode("utf-8")
            digest.update(len(encoded).to_bytes(8, "little"))
            digest.update(encoded)
        digest.update(np.ascontiguousarray(values, dtype="<f4").tobytes())
        return digest.hexdigest()

    def save(self, path: Path) -> dict[str, object]:
        path = path.expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        sidecar = self._ann_sidecar_path(path)
        sidecar_temp = Path(str(sidecar) + ".tmp")
        values = self._vectors[: len(self.ids)].astype("float32", copy=False)
        fingerprint = self._vector_fingerprint(self.ids, values)
        ann_sha256 = ""
        ann_error = ""
        try:
            if self._faiss_index_kind == "hnsw-sq8" and self._faiss_index is not None:
                try:
                    self._faiss.write_index(self._faiss_index, str(sidecar_temp))
                    ann_sha256 = self._sha256_file(sidecar_temp)
                except Exception as exc:
                    ann_error = str(exc)
                    ann_sha256 = ""
                    try:
                        sidecar_temp.unlink()
                    except OSError:
                        pass
            with temp.open("wb") as handle:
                np.savez_compressed(
                    handle,
                    # Store ids as a fixed-width unicode array (not dtype=object),
                    # so the archive contains NO pickled Python objects and can be
                    # loaded with allow_pickle=False — closing the arbitrary-code-
                    # execution risk of np.load(allow_pickle=True) on a workspace
                    # vector store that could be shared/imported.
                    ids=np.asarray(self.ids, dtype=str),
                    vectors=values,
                    dimension=np.asarray([self.dimension], dtype="int32"),
                    format_version=np.asarray([2], dtype="int32"),
                    fingerprint=np.asarray([fingerprint], dtype=str),
                    ann_kind=np.asarray(["hnsw-sq8" if ann_sha256 else ""], dtype=str),
                    ann_sha256=np.asarray([ann_sha256], dtype=str),
                    ann_m=np.asarray([self.ann_m if ann_sha256 else 0], dtype="int32"),
                )
            if ann_sha256:
                sidecar_temp.replace(sidecar)
                try:
                    sidecar.chmod(0o600)
                except OSError:
                    pass
            temp.replace(path)
            try:
                path.chmod(0o600)
            except OSError:
                pass
            if not ann_sha256:
                try:
                    sidecar.unlink()
                except OSError:
                    pass
            result: dict[str, object] = {
                "ok": True,
                "path": str(path),
                "vectors": len(self.ids),
                "bytes": path.stat().st_size,
                "backend": self.backend_name,
                "annPersisted": bool(ann_sha256),
            }
            if ann_sha256:
                result["annPath"] = str(sidecar)
                result["annBytes"] = sidecar.stat().st_size
            if ann_error:
                result["annPersistenceError"] = ann_error
            return result
        except Exception as exc:
            for candidate in (temp, sidecar_temp):
                try:
                    candidate.unlink()
                except OSError:
                    pass
            return {"ok": False, "path": str(path), "vectors": len(self.ids), "error": str(exc)}

    def load(self, path: Path, expected_ids: set[str] | None = None) -> bool:
        path = path.expanduser().resolve()
        if not path.exists():
            return False
        try:
            # allow_pickle=False: never execute pickled objects from a workspace
            # vector-store file (arbitrary-code-execution vector). Legacy files
            # written with dtype=object (pickled ids) will raise here and fall
            # through to return False, after which the caller rebuilds the store
            # from the reference records and re-saves it in the pickle-free format.
            with np.load(path, allow_pickle=False) as archive:
                dimension = int(np.asarray(archive["dimension"]).reshape(-1)[0])
                ids = [str(item) for item in archive["ids"].tolist()]
                values = np.asarray(archive["vectors"], dtype="float32")
                fingerprint = (
                    str(np.asarray(archive["fingerprint"]).reshape(-1)[0])
                    if "fingerprint" in archive.files
                    else ""
                )
                ann_kind = (
                    str(np.asarray(archive["ann_kind"]).reshape(-1)[0])
                    if "ann_kind" in archive.files
                    else ""
                )
                ann_sha256 = (
                    str(np.asarray(archive["ann_sha256"]).reshape(-1)[0])
                    if "ann_sha256" in archive.files
                    else ""
                )
                saved_ann_m = (
                    int(np.asarray(archive["ann_m"]).reshape(-1)[0])
                    if "ann_m" in archive.files
                    else 0
                )
        except Exception:
            return False
        if dimension != self.dimension or values.ndim != 2 or values.shape[1] != self.dimension or len(ids) != values.shape[0]:
            return False
        if expected_ids is not None and set(ids) != set(expected_ids):
            return False
        if not np.isfinite(values).all():
            return False
        if fingerprint and fingerprint != self._vector_fingerprint(ids, values):
            return False
        values = normalize_matrix(values)
        self.ids = ids
        self._id_to_position = {item_id: index for index, item_id in enumerate(ids)}
        self._vectors = values.copy()
        self._ann_disabled_reason = ""
        if self._faiss is not None:
            sidecar = self._ann_sidecar_path(path)
            if (
                ann_kind == "hnsw-sq8"
                and ann_sha256
                and saved_ann_m == self.ann_m
                and self._should_use_ann(len(ids))
                and sidecar.is_file()
            ):
                try:
                    if self._sha256_file(sidecar) != ann_sha256:
                        raise ValueError("ANN sidecar checksum mismatch")
                    restored_index = self._faiss.read_index(str(sidecar))
                    if (
                        int(restored_index.d) != self.dimension
                        or int(restored_index.ntotal) != len(ids)
                        or not bool(restored_index.is_trained)
                        or not hasattr(restored_index, "hnsw")
                        or int(restored_index.metric_type) != int(self._faiss.METRIC_INNER_PRODUCT)
                    ):
                        raise ValueError("ANN sidecar metadata mismatch")
                    restored_index.hnsw.efSearch = self.ann_ef_search
                    self._faiss_index = restored_index
                    self._faiss_index_kind = "hnsw-sq8"
                    self._faiss_gpu = False
                    self._gpu_resources = None
                    self._ann_loaded_from_sidecar = True
                    return True
                except Exception:
                    pass
            self._rebuild_faiss_index()
        return True

    def _exact_search(self, query: np.ndarray, limit: int) -> list[SearchHit]:
        scores = self._vectors[: len(self.ids)] @ query[0]
        if limit >= len(self.ids):
            order = np.argsort(-scores, kind="stable")
        else:
            top = np.argpartition(scores, -limit)[-limit:]
            order = top[np.argsort(-scores[top], kind="stable")]
        return [SearchHit(item_id=self.ids[int(index)], score=float(scores[int(index)])) for index in order]

    def _ann_search(self, query: np.ndarray, limit: int) -> list[SearchHit]:
        candidate_limit = min(
            len(self.ids),
            max(limit * self.ann_rerank_factor, limit + 64),
        )
        if candidate_limit >= len(self.ids):
            return self._exact_search(query, limit)
        self._faiss_index.hnsw.efSearch = max(self.ann_ef_search, candidate_limit)
        _approximate_scores, indexes = self._faiss_index.search(query, candidate_limit)
        candidate_indexes = list(dict.fromkeys(int(index) for index in indexes[0] if int(index) >= 0))
        if len(candidate_indexes) < limit:
            return self._exact_search(query, limit)
        candidate_array = np.asarray(candidate_indexes, dtype=np.int64)
        exact_scores = self._vectors[candidate_array] @ query[0]
        if limit >= len(candidate_indexes):
            local_order = np.argsort(-exact_scores, kind="stable")
        else:
            top = np.argpartition(exact_scores, -limit)[-limit:]
            local_order = top[np.argsort(-exact_scores[top], kind="stable")]
        hits = [
            SearchHit(
                item_id=self.ids[int(candidate_array[int(local_index)])],
                score=float(exact_scores[int(local_index)]),
            )
            for local_index in local_order
        ]
        if hits and hits[0].score <= self.ann_exact_fallback_score:
            self._ann_exact_fallbacks += 1
            return self._exact_search(query, limit)
        return hits

    def search(self, vector: list[float] | np.ndarray, k: int = 10) -> list[SearchHit]:
        limit = min(max(int(k), 0), len(self.ids))
        if not self.ids or limit == 0:
            return []
        query = self._coerce_matrix(vector, rows=1)
        query = normalize_matrix(query)
        if self._faiss_index_kind == "hnsw-sq8" and self._faiss_index is not None:
            return self._ann_search(query, limit)
        if self._faiss_index is not None:
            scores, indexes = self._faiss_index.search(query, limit)
            return [
                SearchHit(item_id=self.ids[int(index)], score=float(score))
                for score, index in zip(scores[0], indexes[0])
                if int(index) >= 0
            ]
        return self._exact_search(query, limit)

    def search_subset(
        self,
        vector: list[float] | np.ndarray,
        allowed_ids: set[str],
        k: int = 10,
    ) -> list[SearchHit]:
        positions = sorted(
            self._id_to_position[item_id]
            for item_id in allowed_ids
            if item_id in self._id_to_position
        )
        limit = min(max(int(k), 0), len(positions))
        if not positions or limit == 0:
            return []
        query = normalize_matrix(self._coerce_matrix(vector, rows=1))
        position_array = np.asarray(positions, dtype=np.int64)
        scores = self._vectors[position_array] @ query[0]
        if limit >= len(positions):
            local_order = np.argsort(-scores, kind="stable")
        else:
            top = np.argpartition(scores, -limit)[-limit:]
            local_order = top[np.argsort(-scores[top], kind="stable")]
        return [
            SearchHit(
                item_id=self.ids[int(position_array[int(local_index)])],
                score=float(scores[int(local_index)]),
            )
            for local_index in local_order
        ]

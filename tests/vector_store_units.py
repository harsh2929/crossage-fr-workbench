from __future__ import annotations

import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import numpy as np

from crossage_fr.store.vector_store import VectorStore, _configure_faiss_metal_runtime


class FakeMetalFaiss:
    StandardGpuResources = object()
    index_cpu_to_gpu = object()

    def __init__(self, module_file: Path):
        self.__file__ = str(module_file)


def assert_metal_library_is_configured_from_package() -> None:
    with TemporaryDirectory(prefix="vintrace-faiss-metal-") as temp:
        package = Path(temp) / "faiss"
        package.mkdir()
        module_file = package / "__init__.py"
        module_file.touch()
        metal_library = package / "MetalDistance.metallib"
        metal_library.write_bytes(b"test-metal-library")

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FAISS_METALLIB_PATH", None)
            assert _configure_faiss_metal_runtime(
                FakeMetalFaiss(module_file),
                platform_name="darwin",
            ) is True
            assert os.environ["FAISS_METALLIB_PATH"] == str(metal_library)


def assert_missing_metal_library_disables_gpu_path() -> None:
    with TemporaryDirectory(prefix="vintrace-faiss-metal-missing-") as temp:
        module_file = Path(temp) / "faiss" / "__init__.py"
        module_file.parent.mkdir()
        module_file.touch()

        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FAISS_METALLIB_PATH", None)
            assert _configure_faiss_metal_runtime(
                FakeMetalFaiss(module_file),
                platform_name="darwin",
            ) is False
            assert "FAISS_METALLIB_PATH" not in os.environ


def assert_non_macos_runtime_needs_no_metal_library() -> None:
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("FAISS_METALLIB_PATH", None)
        assert _configure_faiss_metal_runtime(
            FakeMetalFaiss(Path("/missing/faiss/__init__.py")),
            platform_name="win32",
        ) is True


def _faiss_hnsw_available() -> bool:
    if importlib.util.find_spec("faiss") is None:
        return False
    import faiss

    return hasattr(faiss, "IndexHNSWSQ") and hasattr(faiss, "ScalarQuantizer")


def _random_vectors(count: int, dimension: int) -> np.ndarray:
    values = np.random.default_rng(20260712).normal(size=(count, dimension)).astype("float32")
    values /= np.linalg.norm(values, axis=1, keepdims=True)
    return values


def assert_small_store_keeps_exact_backend() -> None:
    store = VectorStore(dimension=16, ann_threshold=32)
    vectors = _random_vectors(31, 16)
    store.rebuild({f"item-{index}": vector.tolist() for index, vector in enumerate(vectors)})
    assert "hnsw" not in store.backend_name, store.index_report
    assert store.index_report["exactRerank"] is False, store.index_report
    hit = store.search(vectors[7], k=1)[0]
    assert hit.item_id == "item-7", hit


def assert_hnsw_sq8_activates_and_exactly_reranks() -> None:
    if not _faiss_hnsw_available():
        print("SKIP HNSW/SQ8 activation: FAISS HNSW scalar quantizer unavailable")
        return
    vectors = _random_vectors(256, 32)
    store = VectorStore(
        dimension=32,
        ann_threshold=64,
        ann_m=24,
        ann_ef_construction=200,
        ann_ef_search=256,
        ann_rerank_factor=12,
    )
    store.rebuild({f"item-{index:03}": vector.tolist() for index, vector in enumerate(vectors)})
    assert store.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", store.index_report
    assert store.index_report["quantization"] == "sq8", store.index_report
    assert store.index_report["exactRerank"] is True, store.index_report

    query = vectors[93] + vectors[17] * np.float32(0.01)
    query /= np.linalg.norm(query)
    exact_scores = vectors @ query
    exact_order = np.argsort(-exact_scores, kind="stable")[:12]
    hits = store.search(query, k=12)
    assert [hit.item_id for hit in hits] == [f"item-{index:03}" for index in exact_order], hits
    for hit, index in zip(hits, exact_order):
        assert abs(hit.score - float(exact_scores[index])) < 1e-6, (hit, exact_scores[index])


def assert_incremental_add_crosses_ann_threshold() -> None:
    if not _faiss_hnsw_available():
        return
    vectors = _random_vectors(48, 16)
    store = VectorStore(dimension=16, ann_threshold=48, ann_ef_search=128)
    for index, vector in enumerate(vectors[:-1]):
        store.add(f"item-{index}", vector)
    assert "hnsw" not in store.backend_name, store.index_report
    store.add("item-47", vectors[-1])
    assert store.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", store.index_report
    assert store.search(vectors[-1], k=1)[0].item_id == "item-47"


def assert_ann_sidecar_roundtrip_and_corruption_recovery() -> None:
    if not _faiss_hnsw_available():
        return
    vectors = _random_vectors(128, 24)
    payload = {f"item-{index:03}": vector.tolist() for index, vector in enumerate(vectors)}
    with TemporaryDirectory(prefix="vintrace-vector-ann-") as temp:
        path = Path(temp) / "vectors.npz"
        store = VectorStore(dimension=24, ann_threshold=32, ann_ef_search=128)
        store.rebuild(payload)
        saved = store.save(path)
        sidecar = Path(str(path) + ".faiss")
        assert saved["ok"] is True, saved
        assert saved["annPersisted"] is True, saved
        assert sidecar.is_file() and sidecar.stat().st_size > 0, sidecar

        restored = VectorStore(dimension=24, ann_threshold=32, ann_ef_search=128)

        def fail_rebuild(_values: np.ndarray) -> object:
            raise AssertionError("valid ANN sidecar was rebuilt instead of restored")

        restored._make_ann_faiss_index = fail_rebuild  # type: ignore[method-assign]
        assert restored.load(path, expected_ids=set(payload)) is True
        assert restored.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", restored.index_report
        assert restored.search(vectors[33], k=1)[0].item_id == "item-033"

        sidecar.write_bytes(b"corrupt" + sidecar.read_bytes()[7:])
        recovered = VectorStore(dimension=24, ann_threshold=32, ann_ef_search=128)
        assert recovered.load(path, expected_ids=set(payload)) is True
        assert recovered.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", recovered.index_report
        assert recovered.search(vectors[71], k=1)[0].item_id == "item-071"


def assert_vector_archive_fingerprint_rejects_tampering() -> None:
    vectors = _random_vectors(4, 8)
    with TemporaryDirectory(prefix="vintrace-vector-fingerprint-") as temp:
        path = Path(temp) / "vectors.npz"
        store = VectorStore(dimension=8, ann_threshold=0)
        store.rebuild({f"item-{index}": vector.tolist() for index, vector in enumerate(vectors)})
        assert store.save(path)["ok"] is True
        with np.load(path, allow_pickle=False) as archive:
            payload = {name: np.asarray(archive[name]) for name in archive.files}
        payload["vectors"] = payload["vectors"].copy()
        payload["vectors"][0, 0] += np.float32(0.25)
        with path.open("wb") as handle:
            np.savez_compressed(handle, **payload)
        restored = VectorStore(dimension=8, ann_threshold=0)
        assert restored.load(path) is False


def assert_scoped_search_never_leaks_disallowed_ids() -> None:
    vectors = _random_vectors(96, 16)
    store = VectorStore(dimension=16, ann_threshold=32, ann_ef_search=128)
    store.rebuild({f"item-{index:03}": vector.tolist() for index, vector in enumerate(vectors)})
    allowed = {"item-007", "item-051", "item-083"}
    hits = store.search_subset(vectors[7], allowed, k=10)
    assert hits[0].item_id == "item-007", hits
    assert {hit.item_id for hit in hits} == allowed, hits


def assert_face_matching_reuses_persistent_ann_index() -> None:
    if not _faiss_hnsw_available():
        return
    from crossage_fr.enroll.manager import ProjectState
    from crossage_fr.models import EmbeddingResult, ReferenceFace

    vectors = _random_vectors(128, 512)
    with TemporaryDirectory(prefix="vintrace-face-ann-") as temp:
        with patch.dict(
            os.environ,
            {"CROSSAGE_VECTOR_ANN_THRESHOLD": "64", "CROSSAGE_VECTOR_DEVICE": "cpu"},
        ):
            project = ProjectState(Path(temp) / "workspace")
            for index, vector in enumerate(vectors):
                ref_id = f"ref-{index:03}"
                project.references[ref_id] = ReferenceFace(
                    ref_id=ref_id,
                    person_name=f"Person {index:03}",
                    age_bucket="adult",
                    source_path=f"/fixtures/person-{index:03}.jpg",
                    capture_date=None,
                    quality=0.9,
                    model_name="ann-integration-model",
                    vector=vector.tolist(),
                )
                project._mark_reference_dirty(ref_id)
            project.vector_store.rebuild(
                {ref_id: reference.vector for ref_id, reference in project.references.items()}
            )
            project.save(snapshot_candidates=False)
            assert project.vector_store.backend_name == "faiss-hnsw-sq8-ip+exact-rerank"
            assert Path(str(project.vector_index_path) + ".faiss").is_file()

            reopened = ProjectState(Path(temp) / "workspace")
            store, references = reopened._reference_search_context("ann-integration-model")
            assert store is reopened.vector_store
            assert store.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", store.index_report
            hits, matched_references = reopened._search_matching_references(
                EmbeddingResult(
                    vector=vectors[77].tolist(),
                    quality=0.95,
                    bbox=None,
                    model_name="ann-integration-model",
                ),
                k=5,
            )
            assert references is matched_references
            assert hits and hits[0].item_id == "ref-077", hits


def assert_low_confidence_ann_candidates_fall_back_to_exact() -> None:
    vectors = np.zeros((100, 8), dtype=np.float32)
    vectors[:, 1] = 1.0
    vectors[-1] = np.asarray([1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], dtype=np.float32)
    store = VectorStore(dimension=8, ann_threshold=0, ann_exact_fallback_score=0.05)
    store.rebuild_arrays([f"item-{index:03}" for index in range(100)], vectors)

    class FakeHnsw:
        efSearch = 16

    class FakeAnnIndex:
        hnsw = FakeHnsw()

        def search(self, _query: np.ndarray, count: int) -> tuple[np.ndarray, np.ndarray]:
            indexes = np.arange(count, dtype=np.int64).reshape(1, -1)
            scores = np.zeros((1, count), dtype=np.float32)
            return scores, indexes

    store._faiss_index = FakeAnnIndex()
    store._faiss_index_kind = "hnsw-sq8"
    hits = store.search(vectors[-1], k=1)
    assert hits and hits[0].item_id == "item-099", hits
    assert store.index_report["exactFallbacks"] == 1, store.index_report


if __name__ == "__main__":
    assert_metal_library_is_configured_from_package()
    assert_missing_metal_library_disables_gpu_path()
    assert_non_macos_runtime_needs_no_metal_library()
    assert_small_store_keeps_exact_backend()
    assert_hnsw_sq8_activates_and_exactly_reranks()
    assert_incremental_add_crosses_ann_threshold()
    assert_ann_sidecar_roundtrip_and_corruption_recovery()
    assert_vector_archive_fingerprint_rejects_tampering()
    assert_scoped_search_never_leaks_disallowed_ids()
    assert_face_matching_reuses_persistent_ann_index()
    assert_low_confidence_ann_candidates_fall_back_to_exact()
    print("vector store units passed")

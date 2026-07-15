"""Reproducible HNSW/SQ8 recall, persistence, and latency scale gate.

Run the production-size gate with:
  PYTHONPATH=. VINTRACE_VECTOR_SCALE_COUNT=100000 \
    build/venv-production-3.11/bin/python tests/vector_store_scale.py
"""

from __future__ import annotations

import gc
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic

import numpy as np

from crossage_fr.store.vector_store import VectorStore


def percentile(values: list[float], value: float) -> float:
    return float(np.percentile(np.asarray(values, dtype=np.float64), value)) if values else 0.0


def run_scale_gate() -> dict[str, object]:
    count = max(10_000, int(os.environ.get("VINTRACE_VECTOR_SCALE_COUNT", "100000")))
    dimension = max(32, int(os.environ.get("VINTRACE_VECTOR_SCALE_DIMENSION", "512")))
    query_count = max(10, int(os.environ.get("VINTRACE_VECTOR_SCALE_QUERIES", "20")))
    ann_ef_search = max(16, int(os.environ.get("VINTRACE_VECTOR_SCALE_EF_SEARCH", "128")))
    ann_rerank_factor = max(2, int(os.environ.get("VINTRACE_VECTOR_SCALE_RERANK_FACTOR", "8")))
    rng = np.random.default_rng(20260712)
    vectors = rng.standard_normal((count, dimension), dtype=np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    ids = [f"asset-{index:07}" for index in range(count)]

    store = VectorStore(
        dimension=dimension,
        ann_threshold=min(10_000, count),
        ann_m=32,
        ann_ef_construction=160,
        ann_ef_search=ann_ef_search,
        ann_rerank_factor=ann_rerank_factor,
    )
    build_started = monotonic()
    store.rebuild_arrays(ids, vectors)
    build_seconds = monotonic() - build_started
    assert store.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", store.index_report

    selected = rng.choice(count, size=min(query_count, count), replace=False)
    ann_ms: list[float] = []
    exact_ms: list[float] = []
    recall_at_10 = 0
    top_1 = 0
    retained_query = vectors[int(selected[0])].copy()
    retained_expected = ids[int(selected[0])]
    for raw_index in selected:
        index = int(raw_index)
        query = vectors[index] + rng.standard_normal(dimension, dtype=np.float32) * np.float32(0.002)
        query /= np.linalg.norm(query)
        exact_started = monotonic()
        exact_scores = vectors @ query
        expected = int(np.argmax(exact_scores))
        exact_ms.append((monotonic() - exact_started) * 1000.0)
        ann_started = monotonic()
        hits = store.search(query, k=10)
        ann_ms.append((monotonic() - ann_started) * 1000.0)
        expected_id = ids[expected]
        recall_at_10 += int(expected_id in {hit.item_id for hit in hits})
        top_1 += int(bool(hits) and hits[0].item_id == expected_id)

    recall = recall_at_10 / len(selected)
    top_1_recall = top_1 / len(selected)
    assert recall >= 0.99, recall
    assert top_1_recall >= 0.95, top_1_recall

    with TemporaryDirectory(prefix="vintrace-vector-scale-") as temp:
        path = Path(temp) / "vectors.npz"
        save_started = monotonic()
        saved = store.save(path)
        save_seconds = monotonic() - save_started
        assert saved["ok"] is True and saved["annPersisted"] is True, saved
        sidecar = Path(str(path) + ".faiss")
        raw_float_bytes = count * dimension * np.dtype(np.float32).itemsize
        sidecar_bytes = sidecar.stat().st_size
        assert sidecar_bytes < raw_float_bytes * 0.75, (sidecar_bytes, raw_float_bytes)
        assert (path.stat().st_mode & 0o077) == 0, oct(path.stat().st_mode)
        assert (sidecar.stat().st_mode & 0o077) == 0, oct(sidecar.stat().st_mode)

        del store
        del vectors
        gc.collect()
        restored = VectorStore(
            dimension=dimension,
            ann_threshold=min(10_000, count),
            ann_m=32,
            ann_ef_search=ann_ef_search,
            ann_rerank_factor=ann_rerank_factor,
        )
        load_started = monotonic()
        assert restored.load(path, expected_ids=set(ids)) is True
        load_seconds = monotonic() - load_started
        assert restored.backend_name == "faiss-hnsw-sq8-ip+exact-rerank", restored.index_report
        assert restored.search(retained_query, k=1)[0].item_id == retained_expected

    return {
        "count": count,
        "dimension": dimension,
        "queries": len(selected),
        "efSearch": ann_ef_search,
        "rerankFactor": ann_rerank_factor,
        "backend": "faiss-hnsw-sq8-ip+exact-rerank",
        "recallAt10": round(recall, 6),
        "top1Recall": round(top_1_recall, 6),
        "buildSeconds": round(build_seconds, 3),
        "saveSeconds": round(save_seconds, 3),
        "loadSeconds": round(load_seconds, 3),
        "annSearchP50Ms": round(percentile(ann_ms, 50), 3),
        "annSearchP95Ms": round(percentile(ann_ms, 95), 3),
        "exactSearchP50Ms": round(percentile(exact_ms, 50), 3),
        "sq8SidecarBytes": sidecar_bytes,
        "rawFloatBytes": raw_float_bytes,
        "sidecarToFloatRatio": round(sidecar_bytes / raw_float_bytes, 4),
    }


if __name__ == "__main__":
    print(json.dumps(run_scale_gate(), indent=2, sort_keys=True))

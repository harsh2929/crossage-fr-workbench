"""APL-SEARCH-SEMANTIC: on-device natural-language photo search (SigLIP 2 ONNX).

Integrates SigLIP 2 (vision + text ONNX, onnxruntime CPU) so a free-text query can
be matched against photo embeddings entirely on-device. Proves:
  1. graceful degradation: with no semantic pack present the engine reports
     unavailable and encode_* return None (no crash, no network);
  2. real inference (when the pack is vendored): image and text embeddings are
     aligned across modalities — a query ranks the matching image above a
     distractor — fully offline (sockets blocked).

Run: PYTHONPATH=. .venv/bin/python tests/photo_semantic_search_units.py
"""

from __future__ import annotations

import logging
import importlib.util
import os
import socket
import sys
import tempfile
import types
from pathlib import Path

import numpy as np
from PIL import Image

from crossage_fr.embed import siglip_engine as se
from crossage_fr.store.vector_store import VectorStore


def _solid(color: tuple[int, int, int]) -> Image.Image:
    return Image.new("RGB", (256, 256), color)


def _cos(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # engine returns L2-normalized vectors


def test_semantic_search_unavailable_without_model_offline() -> None:
    with tempfile.TemporaryDirectory() as empty:
        orig_dirs = se._semantic_model_dirs
        se._semantic_model_dirs = lambda: [Path(empty)]  # type: ignore[assignment]
        se._reset_caches_for_test()
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during semantic fallback")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            report = se.semantic_model_report()
            text_vec = se.encode_text("a red photo")
            image_vec = se.encode_image(image=_solid((255, 0, 0)))
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]
            se._semantic_model_dirs = orig_dirs  # type: ignore[assignment]
            se._reset_caches_for_test()

        assert report["available"] is False, report
        assert text_vec is None, text_vec
        assert image_vec is None, image_vec


def test_semantic_model_pack_rejects_tampered_tokenizer() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        model_dir = Path(tmp)
        vision = model_dir / "vision_model_uint8.onnx"
        text = model_dir / "text_model_uint8.onnx"
        tokenizer = model_dir / "tokenizer.json"
        vision.write_bytes(b"pinned vision fixture")
        text.write_bytes(b"pinned text fixture")
        tokenizer.write_bytes(b'{"version":"1"}')

        original_dirs = se._semantic_model_dirs
        original_hashes = dict(se._PINNED_SEMANTIC_HASHES)
        se._semantic_model_dirs = lambda: [model_dir]  # type: ignore[assignment]
        se._PINNED_SEMANTIC_HASHES.clear()
        se._PINNED_SEMANTIC_HASHES.update({
            vision.name: se.sha256_file(vision),
            text.name: se.sha256_file(text),
            tokenizer.name: se.sha256_file(tokenizer),
        })
        se._reset_caches_for_test()
        try:
            assert se.semantic_model_report()["available"] is True
            original_stat = tokenizer.stat()
            tokenizer.write_bytes(b'{"version":"2"}')
            os.utime(tokenizer, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns + 1_000_000))
            assert tokenizer.stat().st_size == original_stat.st_size
            assert se.semantic_model_report()["available"] is False
        finally:
            se._semantic_model_dirs = original_dirs  # type: ignore[assignment]
            se._PINNED_SEMANTIC_HASHES.clear()
            se._PINNED_SEMANTIC_HASHES.update(original_hashes)
            se._reset_caches_for_test()


def test_siglip_text_encoding_truncates_long_queries_and_preserves_final_token() -> None:
    class FakeEncoding:
        def __init__(self, ids: list[int]):
            self.ids = ids

    class FakeTokenizer:
        def encode(self, text: str) -> FakeEncoding:
            assert text == "a very long pasted query"
            return FakeEncoding([*range(1, 90), 999])

    class FakeTextSession:
        def __init__(self):
            self.feed: dict[str, np.ndarray] | None = None

        def run(self, _outputs: list[str], feed: dict[str, np.ndarray]) -> list[np.ndarray]:
            self.feed = feed
            return [np.asarray([[1.0, 1.0, 1.0, 1.0]], dtype=np.float32)]

    fake_text = FakeTextSession()
    model = object.__new__(se._SemanticModel)
    model.tokenizer = FakeTokenizer()
    model.text = fake_text
    model._text_in = "input_ids"
    model._text_out = "pooler_output"

    vector = model.encode_text("  A VERY LONG PASTED QUERY  ")
    assert vector.shape == (4,), vector
    assert abs(float(np.linalg.norm(vector)) - 1.0) < 1e-6, vector
    assert fake_text.feed is not None
    feed = fake_text.feed["input_ids"]
    assert feed.shape == (1, se._TEXT_MAX_TOKENS), feed
    assert feed[0, 0] == 1, feed
    assert feed[0, se._TEXT_MAX_TOKENS - 2] == se._TEXT_MAX_TOKENS - 1, feed
    assert feed[0, se._TEXT_MAX_TOKENS - 1] == 999, feed
    assert 64 not in set(feed[0].tolist()), feed


def test_semantic_search_aligns_text_and_image_offline() -> None:
    se._reset_caches_for_test()
    report = se.semantic_model_report()
    if not report.get("available"):
        print("SKIP real-inference: SigLIP2 pack not present at", report.get("path"))
        return

    red_img = _solid((220, 20, 20))
    blue_img = _solid((20, 40, 220))

    # Warm sessions/tokenizer (load from disk), then block sockets.
    se.encode_image(image=red_img)
    se.encode_text("warm up")
    orig_socket, orig_conn = socket.socket, socket.create_connection

    def _blocked(*_a, **_k):
        raise AssertionError("network access attempted during on-device semantic search")

    socket.socket = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]
    try:
        v_red = se.encode_image(image=red_img)
        v_blue = se.encode_image(image=blue_img)
        q_red = se.encode_text("a solid red image")
        q_blue = se.encode_text("a solid blue image")
    finally:
        socket.socket = orig_socket  # type: ignore[assignment]
        socket.create_connection = orig_conn  # type: ignore[assignment]

    for vec in (v_red, v_blue, q_red, q_blue):
        assert vec is not None and vec.ndim == 1, vec
        assert abs(float(np.linalg.norm(vec)) - 1.0) < 1e-3, float(np.linalg.norm(vec))

    # Cross-modal alignment: each query matches its colour image best.
    assert _cos(q_red, v_red) > _cos(q_red, v_blue), (_cos(q_red, v_red), _cos(q_red, v_blue))
    assert _cos(q_blue, v_blue) > _cos(q_blue, v_red), (_cos(q_blue, v_blue), _cos(q_blue, v_red))


def test_semantic_search_command_ranks_library_offline() -> None:
    import sys
    sys.path.insert(0, "tests")
    from photo_folders_units import _api

    se._reset_caches_for_test()
    if not se.semantic_model_report().get("available"):
        print("SKIP command path: SigLIP2 pack not present")
        return
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        red = Path(tmp) / "red.png"
        blue = Path(tmp) / "blue.png"
        _solid((220, 20, 20)).save(red)
        _solid((20, 40, 220)).save(blue)
        api.import_photos({"sourcePaths": [str(red), str(blue)], "storageMode": "referenced"})

        # Warm before blocking sockets.
        se.encode_text("warm")
        se.encode_image_path_cached(red)
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during semantic search command")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            indexed = api.index_photo_semantic_embeddings({
                "sourcePaths": [str(red), str(blue)],
                "ignoreSettings": True,
                "budgetLimit": 5,
            })
            assert indexed["progress"]["updated"] == 2, indexed
            out = api.semantic_search_photos({"query": "a solid red image", "limit": 5})
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]

        assert out["available"] is True, out
        assert out["scored"] == 2, out
        assert out["results"], out
        assert out["results"][0]["sourcePath"].endswith("red.png"), out
        # The red image should outrank the blue one for a "red" query.
        scores = {Path(r["sourcePath"]).name: r["score"] for r in out["results"]}
        assert scores["red.png"] > scores["blue.png"], scores


def test_semantic_search_indexes_full_library_without_candidate_cap() -> None:
    import sys
    sys.path.insert(0, "tests")
    from photo_folders_units import _api

    orig_report = se.semantic_model_report
    orig_text = se.encode_text
    orig_image = se.encode_image_path_cached
    orig_ann_threshold = os.environ.get("CROSSAGE_VECTOR_ANN_THRESHOLD")
    orig_vector_device = os.environ.get("CROSSAGE_VECTOR_DEVICE")
    encode_calls = 0

    def fake_report() -> dict:
        return {"available": True, "engine": "fake", "modelName": "FakeSigLIP-test"}

    def fake_text(_query: str) -> np.ndarray:
        return np.asarray([1.0, 0.0], dtype=np.float32)

    def fake_image(path: Path) -> np.ndarray:
        nonlocal encode_calls
        encode_calls += 1
        return np.asarray([1.0, 0.0] if Path(path).stem == "img_604" else [0.0, 1.0], dtype=np.float32)

    se.semantic_model_report = fake_report  # type: ignore[assignment]
    se.encode_text = fake_text  # type: ignore[assignment]
    se.encode_image_path_cached = fake_image  # type: ignore[assignment]
    os.environ["CROSSAGE_VECTOR_ANN_THRESHOLD"] = "64"
    os.environ["CROSSAGE_VECTOR_DEVICE"] = "cpu"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            api = _api(tmp)
            base = Path(tmp)
            now = "2026-07-07T00:00:00Z"
            rows = []
            metadata_rows = []
            for index in range(605):
                path = base / f"img_{index:03}.jpg"
                path.write_bytes(f"semantic fixture {index}".encode("utf-8"))
                asset_id = f"asset-{index:03}"
                rows.append((asset_id, str(path), "image", now, now))
                metadata_rows.append((asset_id, now))
            with api.project.db.connect() as conn:
                conn.executemany(
                    """
                    INSERT INTO photo_assets(asset_id, source_path, media_kind, added_at, updated_at)
                    VALUES(?, ?, ?, ?, ?)
                    """,
                    rows,
                )
                conn.executemany(
                    "INSERT INTO photo_asset_metadata(asset_id, updated_at) VALUES(?, ?)",
                    metadata_rows,
                )

            out = api.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert out["available"] is True, out
            assert out["candidateCount"] == 605, out
            assert out["scored"] == 0, out
            assert out["dropped"] == 0, out
            assert out["encoded"] == 0, out
            assert out["missingEmbeddings"] == 605, out
            assert out["queued"] is True, out
            assert encode_calls == 0, encode_calls

            queued = api.run_photo_indexing_queue({"maxJobs": 1, "ignoreSettings": True})
            assert queued["ran"] == 1, queued
            job = queued["jobsRun"][0]
            assert job["jobKind"] == "semantic", queued
            assert job["status"] == "completed", queued
            assert job["result"]["progress"]["updated"] == 605, queued

            indexed = api.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert indexed["available"] is True, indexed
            assert indexed["candidateCount"] == 605, indexed
            assert indexed["scored"] == 605, indexed
            assert indexed["dropped"] == 602, indexed
            assert indexed["encoded"] == 0, indexed
            assert indexed["cached"] == 605, indexed
            assert Path(indexed["results"][0]["sourcePath"]).name == "img_604.jpg", indexed
            assert indexed["index"]["persistent"] is True, indexed["index"]
            if importlib.util.find_spec("faiss") is not None:
                import faiss

                if hasattr(faiss, "IndexHNSWSQ"):
                    assert indexed["index"]["backend"] == "faiss-hnsw-sq8-ip+exact-rerank", indexed["index"]
                    assert indexed["index"]["quantization"] == "sq8", indexed["index"]
                    assert indexed["index"]["exactRerank"] is True, indexed["index"]

            def fail_reencode(_path: Path) -> np.ndarray:
                raise AssertionError("semantic search re-encoded instead of using persisted embeddings")

            se.encode_image_path_cached = fail_reencode  # type: ignore[assignment]
            cached = api.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert cached["candidateCount"] == 605, cached
            assert cached["scored"] == 605, cached
            assert cached["dropped"] == 602, cached
            assert cached["encoded"] == 0, cached
            assert cached["cached"] == 605, cached
            assert Path(cached["results"][0]["sourcePath"]).name == "img_604.jpg", cached

            reopened = _api(tmp)
            persisted = reopened.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert persisted["index"]["loadedFromDisk"] is True, persisted["index"]
            assert Path(persisted["results"][0]["sourcePath"]).name == "img_604.jpg", persisted

            scoped_paths = [str(base / "img_001.jpg"), str(base / "img_002.jpg")]
            scoped = reopened.semantic_search_photos({
                "query": "target beyond old cap",
                "limit": 10,
                "sourcePaths": scoped_paths,
            })
            assert scoped["candidateCount"] == 2, scoped
            assert scoped["scored"] == 2, scoped
            assert {Path(row["sourcePath"]).name for row in scoped["results"]} == {
                "img_001.jpg",
                "img_002.jpg",
            }, scoped

            generation_before_visibility = reopened.project.db.photo_semantic_index_generation()
            with reopened.project.db.connect() as conn:
                conn.execute(
                    "UPDATE photo_asset_metadata SET hidden = 1 WHERE asset_id = ?",
                    ("asset-604",),
                )
            hidden = reopened.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert reopened.project.db.photo_semantic_index_generation() > generation_before_visibility
            assert hidden["scored"] == 604, hidden
            assert all(Path(row["sourcePath"]).name != "img_604.jpg" for row in hidden["results"]), hidden

            with reopened.project.db.connect() as conn:
                conn.execute(
                    "UPDATE photo_asset_metadata SET hidden = 0 WHERE asset_id = ?",
                    ("asset-604",),
                )
            visible_again = reopened.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert visible_again["scored"] == 605, visible_again
            assert Path(visible_again["results"][0]["sourcePath"]).name == "img_604.jpg", visible_again

            generation_before_delete = reopened.project.db.photo_semantic_index_generation()
            with reopened.project.db.connect() as conn:
                conn.execute("DELETE FROM photo_assets WHERE asset_id = ?", ("asset-604",))
            deleted = reopened.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert reopened.project.db.photo_semantic_index_generation() > generation_before_delete
            assert deleted["candidateCount"] == 604, deleted
            assert deleted["scored"] == 604, deleted
            assert all(Path(row["sourcePath"]).name != "img_604.jpg" for row in deleted["results"]), deleted
    finally:
        se.semantic_model_report = orig_report  # type: ignore[assignment]
        se.encode_text = orig_text  # type: ignore[assignment]
        se.encode_image_path_cached = orig_image  # type: ignore[assignment]
        if orig_ann_threshold is None:
            os.environ.pop("CROSSAGE_VECTOR_ANN_THRESHOLD", None)
        else:
            os.environ["CROSSAGE_VECTOR_ANN_THRESHOLD"] = orig_ann_threshold
        if orig_vector_device is None:
            os.environ.pop("CROSSAGE_VECTOR_DEVICE", None)
        else:
            os.environ["CROSSAGE_VECTOR_DEVICE"] = orig_vector_device


def test_siglip_text_queries_are_truncated_to_model_limit() -> None:
    long_ids = list(range(se._TEXT_MAX_TOKENS + 37))
    seen: dict[str, object] = {}

    class Encoded:
        ids = long_ids

    class FakeTokenizer:
        def encode(self, text: str) -> Encoded:
            seen["text"] = text
            return Encoded()

    class FakeTextSession:
        def run(self, _outputs: list[str], feed: dict[str, np.ndarray]) -> list[np.ndarray]:
            ids = feed["input_ids"]
            seen["shape"] = ids.shape
            seen["ids"] = ids[0].tolist()
            if ids.shape[1] > se._TEXT_MAX_TOKENS:
                raise AssertionError("long SigLIP text query reached ONNX unbounded")
            return [np.asarray([[3.0, 4.0]], dtype=np.float32)]

    model = se._SemanticModel.__new__(se._SemanticModel)
    model.tokenizer = FakeTokenizer()
    model.text = FakeTextSession()
    model._text_in = "input_ids"
    model._text_out = "pooler_output"

    vec = model.encode_text("  Mixed CASE long query  ")
    assert seen["text"] == "mixed case long query"
    assert seen["shape"] == (1, se._TEXT_MAX_TOKENS), seen
    assert seen["ids"] == [*range(se._TEXT_MAX_TOKENS - 1), long_ids[-1]], seen
    assert np.allclose(vec, np.asarray([0.6, 0.8], dtype=np.float32)), vec


def test_semantic_ann_first_build_runs_only_in_durable_job() -> None:
    if importlib.util.find_spec("faiss") is None:
        return
    import faiss

    if not hasattr(faiss, "IndexHNSWSQ"):
        return
    import sys

    sys.path.insert(0, "tests")
    from photo_folders_units import _api

    orig_report = se.semantic_model_report
    orig_text = se.encode_text
    orig_image = se.encode_image_path_cached
    orig_make_ann = VectorStore._make_ann_faiss_index
    orig_ann_threshold = os.environ.get("CROSSAGE_VECTOR_ANN_THRESHOLD")
    orig_vector_device = os.environ.get("CROSSAGE_VECTOR_DEVICE")

    se.semantic_model_report = lambda: {  # type: ignore[assignment]
        "available": True,
        "engine": "fake",
        "modelName": "FakeSigLIP-job-build",
    }
    se.encode_text = lambda _query: np.asarray([1.0, 0.0, 0.0, 0.0], dtype=np.float32)  # type: ignore[assignment]

    def fail_encode(_path: Path) -> np.ndarray:
        raise AssertionError("vector-index-only job attempted to re-encode an image")

    se.encode_image_path_cached = fail_encode  # type: ignore[assignment]
    os.environ["CROSSAGE_VECTOR_ANN_THRESHOLD"] = "64"
    os.environ["CROSSAGE_VECTOR_DEVICE"] = "cpu"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            api = _api(tmp)
            base = Path(tmp)
            now = "2026-07-12T00:00:00Z"
            with api.project.db.connect() as conn:
                for index in range(96):
                    path = base / f"job_{index:03}.jpg"
                    path.write_bytes(f"semantic ANN job fixture {index}".encode("utf-8"))
                    asset_id = f"job-asset-{index:03}"
                    conn.execute(
                        """
                        INSERT INTO photo_assets(asset_id, source_path, media_kind, added_at, updated_at)
                        VALUES(?, ?, 'image', ?, ?)
                        """,
                        (asset_id, str(path), now, now),
                    )
                    conn.execute(
                        "INSERT INTO photo_asset_metadata(asset_id, updated_at) VALUES(?, ?)",
                        (asset_id, now),
                    )
                    api.project.db.upsert_photo_semantic_embedding(
                        asset_id=asset_id,
                        model_name="FakeSigLIP-job-build",
                        source_path=str(path),
                        file_size=path.stat().st_size,
                        file_mtime_ns=path.stat().st_mtime_ns,
                        vector=[1.0, 0.0, 0.0, 0.0] if index == 95 else [0.0, 1.0, 0.0, 0.0],
                        conn=conn,
                    )

            def forbid_request_path_ann(_self: VectorStore, _values: np.ndarray) -> object:
                raise AssertionError("semantic request path attempted a blocking ANN build")

            VectorStore._make_ann_faiss_index = forbid_request_path_ann  # type: ignore[method-assign]
            first = api.semantic_search_photos({"query": "target", "limit": 3})
            VectorStore._make_ann_faiss_index = orig_make_ann  # type: ignore[method-assign]

            assert first["index"]["backend"] == "faiss-flat-ip", first["index"]
            assert first["index"]["buildPending"] is True, first["index"]
            assert first["index"]["buildQueued"] is True, first["index"]
            assert first["index"]["persistent"] is False, first["index"]
            assert Path(first["results"][0]["sourcePath"]).name == "job_095.jpg", first
            queued_job = first["queuedJob"]
            assert queued_job["scope"]["vectorIndexOnly"] is True, queued_job

            ran = api.run_photo_indexing_queue({"maxJobs": 1, "ignoreSettings": True})
            assert ran["ran"] == 1, ran
            job = ran["jobsRun"][0]
            assert job["status"] == "completed", job
            assert job["result"]["vectorIndexOnly"] is True, job
            assert job["result"]["vectorIndex"]["backend"] == "faiss-hnsw-sq8-ip+exact-rerank", job

            indexed = api.semantic_search_photos({"query": "target", "limit": 3})
            assert indexed["index"]["buildPending"] is False, indexed["index"]
            assert indexed["index"]["persistent"] is True, indexed["index"]
            assert indexed["index"]["backend"] == "faiss-hnsw-sq8-ip+exact-rerank", indexed["index"]
            assert Path(indexed["results"][0]["sourcePath"]).name == "job_095.jpg", indexed

            reopened = _api(tmp)
            restored = reopened.semantic_search_photos({"query": "target", "limit": 3})
            assert restored["index"]["loadedFromDisk"] is True, restored["index"]
            assert restored["index"]["loadedFromSidecar"] is True, restored["index"]
    finally:
        VectorStore._make_ann_faiss_index = orig_make_ann  # type: ignore[method-assign]
        se.semantic_model_report = orig_report  # type: ignore[assignment]
        se.encode_text = orig_text  # type: ignore[assignment]
        se.encode_image_path_cached = orig_image  # type: ignore[assignment]
        if orig_ann_threshold is None:
            os.environ.pop("CROSSAGE_VECTOR_ANN_THRESHOLD", None)
        else:
            os.environ["CROSSAGE_VECTOR_ANN_THRESHOLD"] = orig_ann_threshold
        if orig_vector_device is None:
            os.environ.pop("CROSSAGE_VECTOR_DEVICE", None)
        else:
            os.environ["CROSSAGE_VECTOR_DEVICE"] = orig_vector_device


def test_siglip_provider_failure_logs_and_falls_back_to_cpu() -> None:
    calls: list[dict[str, object]] = []

    class FakeSessionOptions:
        log_severity_level = 0

    class FakeSession:
        pass

    fallback_session = FakeSession()

    def fake_inference_session(
        model_path: str,
        *,
        sess_options: FakeSessionOptions,
        providers: list[str],
        provider_options: object = None,
    ) -> FakeSession:
        calls.append(
            {
                "model_path": model_path,
                "providers": list(providers),
                "provider_options": provider_options,
                "log_severity_level": sess_options.log_severity_level,
            }
        )
        if providers != ["CPUExecutionProvider"]:
            raise RuntimeError("accelerated provider exploded")
        return fallback_session

    fake_ort = types.SimpleNamespace(
        SessionOptions=FakeSessionOptions,
        InferenceSession=fake_inference_session,
    )
    had_ort = "onnxruntime" in sys.modules
    orig_ort = sys.modules.get("onnxruntime")
    orig_detect_platform = se.detect_platform
    orig_get_providers = se.get_providers
    orig_split_provider_config = se.split_provider_config
    logger = logging.getLogger(se.__name__)
    records: list[str] = []

    class CaptureWarnings(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            records.append(record.getMessage())

    handler = CaptureWarnings(level=logging.WARNING)
    logger.addHandler(handler)
    old_level = logger.level
    logger.setLevel(logging.WARNING)
    se._session_for_model.cache_clear()
    sys.modules["onnxruntime"] = fake_ort
    se.detect_platform = lambda: "unit-gpu"  # type: ignore[assignment]
    se.get_providers = lambda _platform: ["BrokenProvider", "CPUExecutionProvider"]  # type: ignore[assignment]
    se.split_provider_config = lambda selected: (list(selected), None)  # type: ignore[assignment]
    try:
        session = se._session_for_model("fake-siglip.onnx", (11, 22))
    finally:
        se._session_for_model.cache_clear()
        se.detect_platform = orig_detect_platform  # type: ignore[assignment]
        se.get_providers = orig_get_providers  # type: ignore[assignment]
        se.split_provider_config = orig_split_provider_config  # type: ignore[assignment]
        logger.removeHandler(handler)
        logger.setLevel(old_level)
        if had_ort:
            sys.modules["onnxruntime"] = orig_ort  # type: ignore[assignment]
        else:
            sys.modules.pop("onnxruntime", None)

    assert session is fallback_session
    assert [call["providers"] for call in calls] == [
        ["BrokenProvider", "CPUExecutionProvider"],
        ["CPUExecutionProvider"],
    ], calls
    assert all(call["log_severity_level"] == 3 for call in calls), calls
    assert any("falling back to CPU" in message for message in records), records
    assert any("accelerated provider exploded" in message for message in records), records


def test_siglip_apple_dynamic_models_use_protocol_safe_cpu_provider() -> None:
    calls: list[list[str]] = []

    class FakeSessionOptions:
        def __init__(self) -> None:
            self.log_severity_level = 0

    class FakeSession:
        pass

    def fake_inference_session(
        _model_path: str,
        *,
        sess_options: FakeSessionOptions,
        providers: list[str],
        provider_options: object = None,
    ) -> FakeSession:
        del provider_options
        assert sess_options.log_severity_level == 3
        calls.append(list(providers))
        return FakeSession()

    fake_ort = types.SimpleNamespace(
        SessionOptions=FakeSessionOptions,
        InferenceSession=fake_inference_session,
    )
    had_ort = "onnxruntime" in sys.modules
    original_ort = sys.modules.get("onnxruntime")
    original_detect_platform = se.detect_platform
    original_get_providers = se.get_providers
    se._session_for_model.cache_clear()
    sys.modules["onnxruntime"] = fake_ort
    se.detect_platform = lambda: "apple_silicon"  # type: ignore[assignment]
    se.get_providers = lambda _platform: (_ for _ in ()).throw(AssertionError("CoreML provider selection must be bypassed"))  # type: ignore[assignment]
    try:
        session = se._session_for_model("fake-dynamic-siglip.onnx", (12, 34))
    finally:
        se._session_for_model.cache_clear()
        se.detect_platform = original_detect_platform  # type: ignore[assignment]
        se.get_providers = original_get_providers  # type: ignore[assignment]
        if had_ort:
            sys.modules["onnxruntime"] = original_ort
        else:
            sys.modules.pop("onnxruntime", None)

    assert isinstance(session, FakeSession)
    assert calls == [["CPUExecutionProvider"]], calls


if __name__ == "__main__":
    test_semantic_search_unavailable_without_model_offline()
    test_semantic_model_pack_rejects_tampered_tokenizer()
    test_semantic_search_aligns_text_and_image_offline()
    test_semantic_search_command_ranks_library_offline()
    test_semantic_search_indexes_full_library_without_candidate_cap()
    test_siglip_text_encoding_truncates_long_queries_and_preserves_final_token()
    test_siglip_text_queries_are_truncated_to_model_limit()
    test_semantic_ann_first_build_runs_only_in_durable_job()
    test_siglip_provider_failure_logs_and_falls_back_to_cpu()
    test_siglip_apple_dynamic_models_use_protocol_safe_cpu_provider()
    print("all photo_semantic_search_units tests passed")

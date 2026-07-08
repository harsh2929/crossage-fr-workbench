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
import socket
import sys
import tempfile
import types
from pathlib import Path

import numpy as np
from PIL import Image

from crossage_fr.embed import siglip_engine as se


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
            assert out["scored"] == 605, out
            assert out["dropped"] == 0, out
            assert out["encoded"] == 605, out
            assert Path(out["results"][0]["sourcePath"]).name == "img_604.jpg", out

            def fail_reencode(_path: Path) -> np.ndarray:
                raise AssertionError("semantic search re-encoded instead of using persisted embeddings")

            se.encode_image_path_cached = fail_reencode  # type: ignore[assignment]
            cached = api.semantic_search_photos({"query": "target beyond old cap", "limit": 3})
            assert cached["candidateCount"] == 605, cached
            assert cached["scored"] == 605, cached
            assert cached["encoded"] == 0, cached
            assert cached["cached"] == 605, cached
            assert Path(cached["results"][0]["sourcePath"]).name == "img_604.jpg", cached
    finally:
        se.semantic_model_report = orig_report  # type: ignore[assignment]
        se.encode_text = orig_text  # type: ignore[assignment]
        se.encode_image_path_cached = orig_image  # type: ignore[assignment]


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
    assert seen["ids"] == list(range(se._TEXT_MAX_TOKENS)), seen
    assert np.allclose(vec, np.asarray([0.6, 0.8], dtype=np.float32)), vec


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


if __name__ == "__main__":
    test_semantic_search_unavailable_without_model_offline()
    test_semantic_search_aligns_text_and_image_offline()
    test_semantic_search_command_ranks_library_offline()
    test_semantic_search_indexes_full_library_without_candidate_cap()
    test_siglip_text_queries_are_truncated_to_model_limit()
    test_siglip_provider_failure_logs_and_falls_back_to_cpu()
    print("all photo_semantic_search_units tests passed")

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

import socket
import tempfile
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


if __name__ == "__main__":
    test_semantic_search_unavailable_without_model_offline()
    test_semantic_search_aligns_text_and_image_offline()
    test_semantic_search_command_ranks_library_offline()
    print("all photo_semantic_search_units tests passed")

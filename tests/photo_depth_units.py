"""APL-EDIT-DEPTH: on-device monocular depth + portrait blur (Depth-Anything-V2 ONNX).

Integrates Depth-Anything-V2-Small (onnxruntime CPU) to estimate a relative depth
map, powering a depth-aware portrait background blur. Proves:
  1. graceful degradation: with no depth pack present the engine reports
     unavailable (no crash, no network);
  2. real inference (when the pack is vendored): a normalized depth map at the
     source resolution, fully offline (sockets blocked);
  3. the export_photo_portrait_blur command produces a same-size image and
     records the depth model, offline.

Run: PYTHONPATH=. .venv/bin/python tests/photo_depth_units.py
"""

from __future__ import annotations

import json
import socket
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from crossage_fr.depth import engine as de

sys.path.insert(0, "tests")
from photo_folders_units import _api  # noqa: E402


def _checkerboard(size: int = 192, cell: int = 12) -> Image.Image:
    yy, xx = np.mgrid[0:size, 0:size]
    pattern = (((xx // cell) + (yy // cell)) % 2).astype(np.uint8) * 255
    rgb = np.dstack([pattern, np.roll(pattern, cell, axis=1), 255 - pattern])
    return Image.fromarray(rgb.astype(np.uint8), "RGB")


def test_depth_unavailable_without_model_offline() -> None:
    with tempfile.TemporaryDirectory() as empty:
        orig_dirs = de._depth_model_dirs
        de._depth_model_dirs = lambda: [Path(empty)]  # type: ignore[assignment]
        de._reset_caches_for_test()
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during depth fallback")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            result = de.estimate_depth(image=_checkerboard())
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]
            de._depth_model_dirs = orig_dirs  # type: ignore[assignment]
            de._reset_caches_for_test()

        assert result.available is False, result
        assert result.depth is None, result
        assert result.engine == "unavailable", result


def test_depth_estimates_normalized_map_offline() -> None:
    de._reset_caches_for_test()
    if not de.depth_model_report().get("available"):
        print("SKIP real-inference: Depth-Anything pack not present")
        return
    image = _checkerboard()
    de.estimate_depth(image=image)  # warm
    orig_socket, orig_conn = socket.socket, socket.create_connection

    def _blocked(*_a, **_k):
        raise AssertionError("network access attempted during on-device depth")

    socket.socket = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]
    try:
        result = de.estimate_depth(image=image)
    finally:
        socket.socket = orig_socket  # type: ignore[assignment]
        socket.create_connection = orig_conn  # type: ignore[assignment]

    assert result.available is True, result
    assert result.engine == "onnx", result
    depth = result.depth
    assert depth is not None and depth.shape == (image.height, image.width), result
    assert np.isfinite(depth).all(), "non-finite depth"
    assert depth.min() >= 0.0 and depth.max() <= 1.0, (depth.min(), depth.max())
    assert depth.max() - depth.min() > 0.0, "depth map is flat"


def test_portrait_blur_command_offline() -> None:
    de._reset_caches_for_test()
    if not de.depth_model_report().get("available"):
        print("SKIP command path: Depth-Anything pack not present")
        return
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        photo = Path(tmp) / "scene.png"
        original = _checkerboard()
        original.save(photo)
        de.estimate_depth(image=original)  # warm
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during portrait blur")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            out = api.export_photo_portrait_blur({"sourcePath": str(photo), "blurStrength": 18})
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]

        target = Path(out["targetPath"])
        assert target.exists() and target.suffix.lower() == ".png", out
        with Image.open(target) as rendered:
            assert rendered.size == original.size, (rendered.size, original.size)
        manifest = json.loads((Path(out["bundlePath"]) / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["depthModel"], manifest
        assert "depth" in manifest["note"].lower(), manifest
        # A blur must change pixels vs the sharp checkerboard.
        before = np.asarray(original.convert("RGB"), dtype=np.int16)
        after = np.asarray(Image.open(target).convert("RGB").resize(original.size), dtype=np.int16)
        assert np.abs(before - after).mean() > 1.0, "portrait blur did not change the image"


if __name__ == "__main__":
    test_depth_unavailable_without_model_offline()
    test_depth_estimates_normalized_map_offline()
    test_portrait_blur_command_offline()
    print("all photo_depth_units tests passed")

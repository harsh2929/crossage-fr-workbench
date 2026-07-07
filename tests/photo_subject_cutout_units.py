"""APL-EDIT-CUTOUT: on-device subject isolation / background removal (BiRefNet ONNX).

Integrates BiRefNet_lite (onnxruntime CPU) as an on-device matting engine that
lifts the salient subject from a photo into an RGBA cutout. Proves:
  1. graceful degradation: with no matting weights present the engine reports
     unavailable (no crash, no network) so the feature stays optional;
  2. real inference (when the BiRefNet pack is vendored): the alpha matte
     isolates a salient foreground shape from a contrasting background, fully
     offline (sockets blocked).

Run: PYTHONPATH=. .venv/bin/python tests/photo_subject_cutout_units.py
"""

from __future__ import annotations

import socket
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import json

from crossage_fr.ingest import matting
from photo_folders_units import _api


def _disc_on_dark_bg(size: int = 320) -> Image.Image:
    """A bright centered disc on a flat dark background — a clean salient object."""
    yy, xx = np.mgrid[0:size, 0:size]
    cy = cx = size / 2
    radius = size * 0.28
    inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= radius**2
    canvas = np.full((size, size, 3), 18, dtype=np.uint8)  # near-black bg
    canvas[inside] = (240, 196, 64)  # warm bright disc
    return Image.fromarray(canvas, "RGB")


def test_cutout_unavailable_without_model_does_not_crash_or_network() -> None:
    with tempfile.TemporaryDirectory() as empty:
        # Point discovery at an empty dir so no matting weights are found.
        orig_dirs = matting._matting_model_dirs
        matting._matting_model_dirs = lambda: [Path(empty)]  # type: ignore[assignment]
        matting._reset_caches_for_test()
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during matting fallback")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            result = matting.remove_background(image=_disc_on_dark_bg())
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]
            matting._matting_model_dirs = orig_dirs  # type: ignore[assignment]
            matting._reset_caches_for_test()

        assert result.available is False, result
        assert result.alpha is None, result
        assert result.engine == "unavailable", result
        assert result.reason, result


def test_cutout_isolates_salient_foreground_with_real_model_offline() -> None:
    matting._reset_caches_for_test()
    report = matting.matting_model_report()
    if not report.get("available"):
        print("SKIP real-inference: BiRefNet pack not present at", report.get("path"))
        return

    image = _disc_on_dark_bg()
    orig_socket, orig_conn = socket.socket, socket.create_connection

    def _blocked(*_a, **_k):
        raise AssertionError("network access attempted during on-device matting")

    # Warm the session (loads ONNX from disk), then block sockets for inference.
    matting.remove_background(image=image)
    socket.socket = _blocked  # type: ignore[assignment]
    socket.create_connection = _blocked  # type: ignore[assignment]
    try:
        result = matting.remove_background(image=image)
    finally:
        socket.socket = orig_socket  # type: ignore[assignment]
        socket.create_connection = orig_conn  # type: ignore[assignment]

    assert result.available is True, result
    assert result.engine == "onnx", result
    alpha = result.alpha
    assert alpha is not None and alpha.shape == (image.height, image.width), result
    assert alpha.min() >= 0.0 and alpha.max() <= 1.0, (alpha.min(), alpha.max())

    # Salient disc center should be foreground; the four corners should be background.
    h, w = alpha.shape
    center = float(alpha[h // 2, w // 2])
    corners = float(np.mean([alpha[0, 0], alpha[0, w - 1], alpha[h - 1, 0], alpha[h - 1, w - 1]]))
    assert center > 0.6, f"center alpha too low: {center}"
    assert corners < 0.3, f"corner alpha too high: {corners}"
    assert 0.02 < result.foreground_ratio < 0.9, result.foreground_ratio

    cutout = result.cutout()
    assert cutout.mode == "RGBA", cutout.mode
    assert cutout.size == image.size, cutout.size


def test_export_command_uses_ml_matte_offline() -> None:
    matting._reset_caches_for_test()
    if not matting.matting_model_report().get("available"):
        print("SKIP command path: BiRefNet pack not present")
        return
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        photo = Path(tmp) / "subject.png"
        _disc_on_dark_bg().save(photo)
        # Warm the matting session before blocking sockets.
        matting.remove_background(image=_disc_on_dark_bg())
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during cutout export")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            result = api.export_photo_subject_cutout({"sourcePath": str(photo), "exportVariant": "cutout"})
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]

        manifest = json.loads((Path(result["bundlePath"]) / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["mask"]["algorithm"] == "birefnet-lite-onnx", manifest["mask"]
        assert manifest["mask"]["mlModel"] == "BiRefNet_lite", manifest["mask"]
        assert "model-grade" in manifest["note"], manifest["note"]
        assert Path(result["targetPath"]).exists(), result


if __name__ == "__main__":
    test_cutout_unavailable_without_model_does_not_crash_or_network()
    test_cutout_isolates_salient_foreground_with_real_model_offline()
    test_export_command_uses_ml_matte_offline()
    print("all photo_subject_cutout_units tests passed")

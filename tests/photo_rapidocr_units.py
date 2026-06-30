"""APL-INTEL-01 / APL-META-07: on-device OCR via RapidOCR (PP-OCRv5 ONNX), offline.

Integrates RapidOCR (onnxruntime CPU, bundled PP-OCR ONNX models) as the
preferred OCR engine ahead of Tesseract. Proves it extracts text + percent-
bounded regions from an image with NO network access, and is selected as the
engine source.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_rapidocr_units.py
"""

from __future__ import annotations

import socket
import tempfile
from pathlib import Path

from photo_folders_units import _api


def _write_text_image(path: Path, text: str) -> None:
    from PIL import Image, ImageDraw, ImageFont

    img = Image.new("RGB", (480, 140), "white")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 48)
    except Exception:
        font = ImageFont.load_default()
    draw.text((20, 45), text, fill="black", font=font)
    img.save(path)


def test_rapidocr_extracts_text_and_regions_offline() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        photo = Path(tmp) / "ticket.png"
        _write_text_image(photo, "BOARDING PASS")
        api.import_photos({"sourcePaths": [str(photo)], "storageMode": "referenced", "sourceLabel": "Ticket"})
        asset = api.project.db.photo_asset_by_path(str(photo.resolve()))
        assert asset, "asset not imported"

        # Warm the engine (loads bundled ONNX from disk, no network), then block sockets.
        api._photo_ocr_text_from_rapidocr(photo.resolve(), "en", (480, 140))
        orig_socket, orig_conn = socket.socket, socket.create_connection

        def _blocked(*_a, **_k):
            raise AssertionError("network access attempted during on-device OCR")

        socket.socket = _blocked  # type: ignore[assignment]
        socket.create_connection = _blocked  # type: ignore[assignment]
        try:
            result = api._photo_ocr_extract_asset(asset, language="en", allow_engine=True)
        finally:
            socket.socket = orig_socket  # type: ignore[assignment]
            socket.create_connection = orig_conn  # type: ignore[assignment]

        assert result["ok"] is True, result
        assert result["source"] == "rapidocr", result
        assert "BOARDING" in result["text"].upper(), result
        regions = result.get("regions") or []
        assert regions, result
        r0 = regions[0]
        assert r0["source"] == "rapidocr", r0
        assert 0.0 <= r0["x"] <= 100.0 and 0.0 <= r0["width"] <= 100.0, r0
        assert 0.0 <= r0["y"] <= 100.0 and 0.0 <= r0["height"] <= 100.0, r0


if __name__ == "__main__":
    test_rapidocr_extracts_text_and_regions_offline()
    print("all photo_rapidocr_units tests passed")

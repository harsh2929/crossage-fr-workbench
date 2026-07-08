from __future__ import annotations

from pathlib import Path
import sys
import tempfile

from PIL import Image, JpegImagePlugin

from crossage_fr.ingest.image_io import ImageLoadError, load_image, write_preview_image


def test_jpeg_preview_uses_pillow_draft_decode_hint() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-image-io-") as temp_name:
        root = Path(temp_name)
        source = root / "large.jpg"
        target = root / "preview" / "large.jpg"
        Image.new("RGB", (4096, 3072), (100, 120, 180)).save(source, format="JPEG", quality=90)
        calls: list[tuple[str, tuple[int, int]]] = []
        original_draft = JpegImagePlugin.JpegImageFile.draft

        def recording_draft(self: JpegImagePlugin.JpegImageFile, mode: str | None, size: tuple[int, int] | None):
            calls.append((str(mode or ""), tuple(size or (0, 0))))
            return original_draft(self, mode, size)

        try:
            JpegImagePlugin.JpegImageFile.draft = recording_draft  # type: ignore[assignment]
            write_preview_image(source, target, max_edge=256, quality=80)
        finally:
            JpegImagePlugin.JpegImageFile.draft = original_draft  # type: ignore[assignment]

        assert calls == [("RGB", (512, 512))], calls
        with Image.open(target) as preview:
            assert max(preview.size) <= 256, preview.size


def test_raw_decode_rejects_missing_dimensions_before_postprocess() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-raw-size-") as temp_name:
        root = Path(temp_name)
        source = root / "missing-size.dng"
        source.write_bytes(b"fake raw bytes")

        class EmptySizes:
            pass

        class FakeRaw:
            sizes = EmptySizes()

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def postprocess(self, *_args, **_kwargs):
                raise AssertionError("RAW postprocess should not run without verified dimensions")

        class FakeRawpy:
            @staticmethod
            def imread(_path: str) -> FakeRaw:
                return FakeRaw()

        old_rawpy = sys.modules.get("rawpy")
        old_limit = Image.MAX_IMAGE_PIXELS
        try:
            sys.modules["rawpy"] = FakeRawpy()  # type: ignore[assignment]
            Image.MAX_IMAGE_PIXELS = 4
            try:
                load_image(source)
            except ImageLoadError as exc:
                assert "reports no decodable dimensions" in str(exc)
            else:
                raise AssertionError("expected RAW with missing dimensions to be rejected")
        finally:
            Image.MAX_IMAGE_PIXELS = old_limit
            if old_rawpy is None:
                sys.modules.pop("rawpy", None)
            else:
                sys.modules["rawpy"] = old_rawpy


if __name__ == "__main__":
    test_jpeg_preview_uses_pillow_draft_decode_hint()
    test_raw_decode_rejects_missing_dimensions_before_postprocess()
    print("all image_io_units tests passed")

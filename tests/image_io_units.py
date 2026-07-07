from __future__ import annotations

from pathlib import Path
import tempfile

from PIL import Image, JpegImagePlugin

from crossage_fr.ingest.image_io import write_preview_image


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


if __name__ == "__main__":
    test_jpeg_preview_uses_pillow_draft_decode_hint()
    print("all image_io_units tests passed")

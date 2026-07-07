"""APL-EDIT-01: rendered preview for video edit stacks.

Image edit stacks render a cached JPEG preview, but saving a video edit stack
(trim/transform draft) produced no rendered preview (the image renderer returns
None for video sources). This proves a video edit stack now generates a JPEG
preview from the trim-start frame so the grid/lightbox can show the edited clip.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_edit_stack_video_preview_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api, _write_tiny_video


def test_photo_edit_stack_renders_video_preview_on_save() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        video = Path(tmp) / "clip.mp4"
        if not _write_tiny_video(video):
            print("skipped video edit-stack preview test; OpenCV video writer unavailable")
            return
        api.import_photos({"sourcePaths": [str(video)], "storageMode": "referenced", "sourceLabel": "Clip"})

        result = api.save_photo_edit_stack(
            {
                "sourcePath": str(video.resolve()),
                "operations": [{"type": "video_trim", "trimStartMs": 0, "trimEndMs": 400}],
            }
        )
        preview = str(result.get("renderedPreviewPath", "") or result.get("sidecarPayload", {}).get("renderedPreviewPath", ""))
        assert preview, result
        assert Path(preview).exists(), result
        from PIL import Image

        with Image.open(preview) as image:
            assert image.format == "JPEG", preview
            assert max(image.size) <= 1600, image.size
    print("ok photo edit stack renders video preview on save")


if __name__ == "__main__":
    test_photo_edit_stack_renders_video_preview_on_save()
    print("all photo_edit_stack_video_preview_units tests passed")

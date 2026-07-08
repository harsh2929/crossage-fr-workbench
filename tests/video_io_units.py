from __future__ import annotations

import builtins
from pathlib import Path
import subprocess
import tempfile

import numpy as np
from PIL import Image

from crossage_fr.ingest import image_io, video_io


def test_default_image_pixel_limit_is_bounded_for_media_ingest() -> None:
    assert image_io.DEFAULT_MAX_IMAGE_PIXELS == 100_000_000


def test_ffmpeg_frame_sampling_uses_workspace_temp_and_safe_move() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-video-io-") as temp_name:
        root = Path(temp_name)
        source = root / "clip.mp4"
        source.write_bytes(b"fake video")
        output_root = root / "video-cache"
        seen: dict[str, object] = {"moves": []}

        original_ffmpeg_path = video_io._ffmpeg_path  # noqa: SLF001 - targeted regression.
        original_probe = video_io._probe_video_ffmpeg  # noqa: SLF001 - targeted regression.
        original_run = video_io.subprocess.run
        original_move = video_io.shutil.move

        def fake_run(command, capture_output, text, timeout, check):  # type: ignore[no-untyped-def]
            seen["filter"] = command[command.index("-vf") + 1]
            pattern = Path(command[-1])
            seen["temp_parent"] = pattern.parent.parent
            pattern.parent.mkdir(parents=True, exist_ok=True)
            (pattern.parent / "frame-00000001.jpg").write_bytes(b"frame one")
            (pattern.parent / "frame-00000002.jpg").write_bytes(b"frame two")
            return subprocess.CompletedProcess(command, 0, "", "")

        def fake_move(source_path: str, target_path: str) -> str:
            seen["moves"].append((source_path, target_path))  # type: ignore[union-attr]
            source_frame = Path(source_path)
            target_frame = Path(target_path)
            target_frame.write_bytes(source_frame.read_bytes())
            source_frame.unlink()
            return target_path

        try:
            video_io._ffmpeg_path = lambda: "/usr/bin/ffmpeg"  # type: ignore[assignment]
            video_io._probe_video_ffmpeg = lambda _path: {  # type: ignore[assignment]
                "width": 1920,
                "height": 1080,
                "durationMs": 1000,
                "fps": 30.0,
            }
            video_io.subprocess.run = fake_run  # type: ignore[assignment]
            video_io.shutil.move = fake_move  # type: ignore[assignment]

            samples = video_io._sample_video_frames_ffmpeg(  # noqa: SLF001 - targeted regression.
                source,
                output_root,
                max_frames=2,
                interval_seconds=0.5,
                jpeg_quality=80,
            )
        finally:
            video_io._ffmpeg_path = original_ffmpeg_path  # type: ignore[assignment]
            video_io._probe_video_ffmpeg = original_probe  # type: ignore[assignment]
            video_io.subprocess.run = original_run  # type: ignore[assignment]
            video_io.shutil.move = original_move  # type: ignore[assignment]

        assert seen["temp_parent"] == output_root, seen
        assert "fps=1/0.5" in str(seen["filter"]), seen
        assert "scale=w=min(iw\\," in str(seen["filter"]), seen
        assert len(seen["moves"]) == 2, seen
        assert [sample.timestamp_ms for sample in samples] == [0, 500], samples
        assert all(sample.path.exists() for sample in samples), samples
        assert all(sample.path.parent.parent == output_root for sample in samples), samples


def test_opencv_frame_sampling_rejects_oversized_decoded_frame_before_rgb_conversion() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-video-frame-cap-") as temp_name:
        root = Path(temp_name)
        source = root / "clip.mp4"
        source.write_bytes(b"fake video")
        frame = np.zeros((3, 2, 3), dtype=np.uint8)

        class FakeCapture:
            def __init__(self, _path: str) -> None:
                self.released = False

            def isOpened(self) -> bool:
                return True

            def get(self, prop: int) -> float:
                values = {
                    fake_cv2.CAP_PROP_FRAME_COUNT: 1,
                    fake_cv2.CAP_PROP_FPS: 30.0,
                    fake_cv2.CAP_PROP_FRAME_WIDTH: 0,
                    fake_cv2.CAP_PROP_FRAME_HEIGHT: 0,
                    fake_cv2.CAP_PROP_POS_MSEC: 0,
                }
                return values.get(prop, 0)

            def set(self, _prop: int, _value: int) -> None:
                return None

            def read(self):  # type: ignore[no-untyped-def]
                return True, frame

            def release(self) -> None:
                self.released = True

        class FakeCv2:
            CAP_PROP_POS_FRAMES = 1
            CAP_PROP_FRAME_COUNT = 2
            CAP_PROP_FPS = 3
            CAP_PROP_FRAME_WIDTH = 4
            CAP_PROP_FRAME_HEIGHT = 5
            CAP_PROP_POS_MSEC = 6
            COLOR_BGR2GRAY = 7
            COLOR_BGR2RGB = 8

            def __init__(self) -> None:
                self.capture = FakeCapture("")

            def VideoCapture(self, path: str) -> FakeCapture:  # noqa: N802 - mirrors cv2.
                self.capture = FakeCapture(path)
                return self.capture

            def cvtColor(self, *_args, **_kwargs):  # type: ignore[no-untyped-def]
                raise AssertionError("oversized video frames should fail before cvtColor/Image.fromarray")

        fake_cv2 = FakeCv2()
        original_require_cv2 = video_io._require_cv2  # noqa: SLF001 - targeted regression.
        old_limit = Image.MAX_IMAGE_PIXELS
        try:
            Image.MAX_IMAGE_PIXELS = 4
            video_io._require_cv2 = lambda: fake_cv2  # type: ignore[assignment]
            try:
                video_io.sample_video_frames(source, root / "cache", max_frames=1)
            except video_io.VideoLoadError as exc:
                assert "maximum allowed pixels" in str(exc)
            else:
                raise AssertionError("expected oversized decoded frame to be rejected")
        finally:
            Image.MAX_IMAGE_PIXELS = old_limit
            video_io._require_cv2 = original_require_cv2  # type: ignore[assignment]

        assert fake_cv2.capture.released is True


def test_video_decoder_report_does_not_import_cv2_for_availability() -> None:
    seen: list[str] = []
    original_find_spec = video_io.importlib.util.find_spec
    original_import = builtins.__import__

    def fake_find_spec(name: str, *args, **kwargs):  # type: ignore[no-untyped-def]
        seen.append(name)
        if name == "cv2":
            return object()
        return original_find_spec(name, *args, **kwargs)

    def blocked_import(name: str, *args, **kwargs):  # type: ignore[no-untyped-def]
        if name == "cv2":
            raise AssertionError("video_decoder_report imported cv2 on the startup path")
        return original_import(name, *args, **kwargs)

    try:
        video_io.importlib.util.find_spec = fake_find_spec  # type: ignore[assignment]
        builtins.__import__ = blocked_import  # type: ignore[assignment]
        assert video_io._cv2_available() is True  # noqa: SLF001 - targeted regression.
        report = video_io.video_decoder_report()
    finally:
        video_io.importlib.util.find_spec = original_find_spec  # type: ignore[assignment]
        builtins.__import__ = original_import  # type: ignore[assignment]

    assert "cv2" in seen
    assert report["opencvAvailable"] is True


if __name__ == "__main__":
    test_default_image_pixel_limit_is_bounded_for_media_ingest()
    test_ffmpeg_frame_sampling_uses_workspace_temp_and_safe_move()
    test_opencv_frame_sampling_rejects_oversized_decoded_frame_before_rgb_conversion()
    test_video_decoder_report_does_not_import_cv2_for_availability()
    print("all video_io_units tests passed")

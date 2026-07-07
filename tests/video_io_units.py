from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile

from crossage_fr.ingest import video_io


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
        assert len(seen["moves"]) == 2, seen
        assert [sample.timestamp_ms for sample in samples] == [0, 500], samples
        assert all(sample.path.exists() for sample in samples), samples
        assert all(sample.path.parent.parent == output_root for sample in samples), samples


if __name__ == "__main__":
    test_ffmpeg_frame_sampling_uses_workspace_temp_and_safe_move()
    print("all video_io_units tests passed")

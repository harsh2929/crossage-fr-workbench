from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import hashlib
import os
import re
from typing import Iterable

from PIL import Image


VIDEO_EXTENSIONS = {
    ".3g2",
    ".3gp",
    ".avi",
    ".asf",
    ".dv",
    ".flv",
    ".hevc",
    ".mkv",
    ".m4v",
    ".m2ts",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".mts",
    ".ogv",
    ".qt",
    ".ts",
    ".webm",
    ".wmv",
}


class VideoLoadError(RuntimeError):
    pass


@dataclass(slots=True)
class VideoFrameSample:
    path: Path
    timestamp_ms: int
    frame_index: int
    width: int
    height: int
    duration_ms: int


def is_video_path(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def iter_video_paths(root: Path) -> Iterable[Path]:
    root = root.expanduser().resolve()
    if root.is_file() and is_video_path(root):
        yield root
        return
    if not root.exists():
        return
    for current, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for filename in sorted(filenames):
            path = Path(current) / filename
            if is_video_path(path):
                yield path


def video_decoder_report() -> dict[str, object]:
    return {
        "extensions": sorted(VIDEO_EXTENSIONS),
        "opencvAvailable": _cv2_available(),
        "backend": "opencv" if _cv2_available() else "unavailable",
    }


def probe_video(path: Path) -> dict[str, object]:
    cv2 = _require_cv2()
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise VideoLoadError(f"Could not open video {path}")
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration_ms = int((frame_count / fps) * 1000) if frame_count > 0 and fps > 0 else 0
        return {
            "path": str(path.expanduser().resolve()),
            "exists": path.exists(),
            "readable": True,
            "frameCount": frame_count,
            "fps": fps,
            "width": width,
            "height": height,
            "durationMs": duration_ms,
            "backend": "opencv",
        }
    finally:
        capture.release()


def sample_video_frames(
    path: Path,
    output_root: Path,
    max_frames: int = 48,
    interval_seconds: float = 2.0,
    jpeg_quality: int = 88,
) -> list[VideoFrameSample]:
    cv2 = _require_cv2()
    resolved = path.expanduser().resolve()
    capture = cv2.VideoCapture(str(resolved))
    if not capture.isOpened():
        raise VideoLoadError(f"Could not open video {resolved}")
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration_ms = int((frame_count / fps) * 1000) if frame_count > 0 and fps > 0 else 0
        indices = _sample_indices(frame_count, fps, max_frames=max_frames, interval_seconds=interval_seconds)
        if not indices:
            raise VideoLoadError(f"No decodable frames found in {resolved}")
        target_dir = output_root / _video_slug(resolved)
        target_dir.mkdir(parents=True, exist_ok=True)
        samples: list[VideoFrameSample] = []
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, max(0, index))
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image = Image.fromarray(rgb).convert("RGB")
            timestamp_ms = int((index / fps) * 1000) if fps > 0 else int(capture.get(cv2.CAP_PROP_POS_MSEC) or 0)
            frame_path = target_dir / f"frame-{index:08d}-{timestamp_ms:010d}ms.jpg"
            temp = frame_path.with_suffix(".jpg.tmp")
            image.save(temp, format="JPEG", quality=jpeg_quality, optimize=True)
            temp.replace(frame_path)
            samples.append(
                VideoFrameSample(
                    path=frame_path,
                    timestamp_ms=max(0, timestamp_ms),
                    frame_index=index,
                    width=width or image.width,
                    height=height or image.height,
                    duration_ms=max(0, duration_ms),
                )
            )
        if not samples:
            raise VideoLoadError(f"No frames could be decoded from {resolved}")
        return samples
    finally:
        capture.release()


def _cv2_available() -> bool:
    try:
        import cv2  # noqa: F401
    except Exception:
        return False
    return True


def _require_cv2():
    try:
        import cv2
    except Exception as exc:
        raise VideoLoadError("Video support requires OpenCV or a future FFmpeg backend.") from exc
    return cv2


def _sample_indices(frame_count: int, fps: float, max_frames: int, interval_seconds: float) -> list[int]:
    max_frames = max(1, min(1000, int(max_frames)))
    if frame_count <= 0:
        return [0]
    if fps <= 0:
        step = max(1, frame_count // max_frames)
    else:
        step = max(1, int(round(max(0.25, interval_seconds) * fps)))
    indices = list(range(0, frame_count, step))
    if frame_count > 1:
        indices.append(frame_count - 1)
    unique = sorted(set(index for index in indices if 0 <= index < frame_count))
    if len(unique) <= max_frames:
        return unique
    stride = max(1, len(unique) // max_frames)
    reduced = unique[::stride][:max_frames]
    if unique[-1] not in reduced:
        reduced[-1] = unique[-1]
    return sorted(set(reduced))


def _video_slug(path: Path) -> str:
    try:
        stat = path.stat()
        key = f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8")
    except OSError:
        key = str(path.resolve()).encode("utf-8")
    digest = hashlib.sha256(key).hexdigest()[:16]
    name = re.sub(r"[^A-Za-z0-9._-]+", "-", path.stem).strip("-")[:48] or "video"
    return f"{name}-{digest}"

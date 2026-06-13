from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
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


def configure_video_decoder_paths(ffmpeg_path: str = "", ffprobe_path: str = "") -> None:
    ffmpeg = str(ffmpeg_path or "").strip()
    ffprobe = str(ffprobe_path or "").strip()
    if ffmpeg:
        os.environ["VINTRACE_FFMPEG_PATH"] = ffmpeg
    else:
        os.environ.pop("VINTRACE_FFMPEG_PATH", None)
    if ffprobe:
        os.environ["VINTRACE_FFPROBE_PATH"] = ffprobe
    else:
        os.environ.pop("VINTRACE_FFPROBE_PATH", None)


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
    opencv_available = _cv2_available()
    ffmpeg = _discover_ffmpeg()
    ffprobe = _discover_ffprobe()
    managed_available = _managed_ffmpeg_available()
    ffmpeg_path = str(ffmpeg.get("path") or "")
    ffprobe_path = str(ffprobe.get("path") or "")
    backend = "opencv" if opencv_available else "ffmpeg" if ffmpeg_path else "unavailable"
    recommendations = []
    if not ffmpeg_path:
        recommendations.append("Install the managed video decoder package or choose an FFmpeg binary in Settings.")
    if ffmpeg_path and not ffprobe_path:
        recommendations.append("Video frame extraction works with FFmpeg, but metadata is limited until ffprobe is available.")
    return {
        "extensions": sorted(VIDEO_EXTENSIONS),
        "opencvAvailable": opencv_available,
        "ffmpegAvailable": bool(ffmpeg_path),
        "ffprobeAvailable": bool(ffprobe_path),
        "ffmpegPath": ffmpeg_path or "",
        "ffprobePath": ffprobe_path or "",
        "ffmpegSource": str(ffmpeg.get("source") or "missing"),
        "ffprobeSource": str(ffprobe.get("source") or "missing"),
        "managedPackage": "imageio-ffmpeg",
        "managedPackageAvailable": managed_available,
        "configuredFfmpegPath": os.environ.get("VINTRACE_FFMPEG_PATH") or os.environ.get("CROSSAGE_FFMPEG_PATH") or "",
        "configuredFfprobePath": os.environ.get("VINTRACE_FFPROBE_PATH") or os.environ.get("CROSSAGE_FFPROBE_PATH") or "",
        "backend": backend,
        "probeLimited": bool(ffmpeg_path and not ffprobe_path),
        "fallbackOrder": [item for item, available in (("opencv", opencv_available), ("ffmpeg", bool(ffmpeg_path))) if available],
        "licenseNote": "Managed FFmpeg uses imageio-ffmpeg. Review FFmpeg codec and LGPL/GPL redistribution requirements before commercial release.",
        "recommendations": recommendations,
    }


def probe_video(path: Path) -> dict[str, object]:
    try:
        cv2 = _require_cv2()
    except VideoLoadError:
        return _probe_video_ffmpeg(path)
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            capture.release()
            return _probe_video_ffmpeg(path)
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
    resolved = path.expanduser().resolve()
    max_frames = max(1, min(1000, int(max_frames)))
    interval_seconds = max(0.25, float(interval_seconds))
    jpeg_quality = max(1, min(100, int(jpeg_quality)))
    target_dir = output_root / _video_slug(resolved)
    cached = _load_video_sample_cache(
        target_dir,
        source=resolved,
        max_frames=max_frames,
        interval_seconds=interval_seconds,
        jpeg_quality=jpeg_quality,
    )
    if cached:
        return cached[:max_frames]
    try:
        cv2 = _require_cv2()
    except VideoLoadError:
        return _sample_video_frames_ffmpeg(resolved, output_root, max_frames=max_frames, interval_seconds=interval_seconds, jpeg_quality=jpeg_quality)
    capture = cv2.VideoCapture(str(resolved))
    if not capture.isOpened():
        return _sample_video_frames_ffmpeg(resolved, output_root, max_frames=max_frames, interval_seconds=interval_seconds, jpeg_quality=jpeg_quality)
    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        duration_ms = int((frame_count / fps) * 1000) if frame_count > 0 and fps > 0 else 0
        indices = _sample_indices(frame_count, fps, max_frames=max_frames, interval_seconds=interval_seconds)
        if not indices:
            raise VideoLoadError(f"No decodable frames found in {resolved}")
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
        _write_video_sample_cache(
            target_dir,
            source=resolved,
            backend="opencv",
            max_frames=max_frames,
            interval_seconds=interval_seconds,
            jpeg_quality=jpeg_quality,
            samples=samples,
        )
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


def _existing_file(value: object) -> str:
    try:
        text = str(value or "").strip()
        if not text:
            return ""
        path = Path(text).expanduser()
        if path.exists() and path.is_file():
            return str(path)
    except (OSError, ValueError):
        return ""
    return ""


def _resource_dirs() -> list[Path]:
    candidates: list[Path] = []
    env_dir = os.environ.get("VINTRACE_FFMPEG_DIR") or os.environ.get("CROSSAGE_FFMPEG_DIR")
    if env_dir:
        candidates.append(Path(env_dir).expanduser())
    frozen_root = getattr(sys, "_MEIPASS", "")
    if frozen_root:
        candidates.append(Path(str(frozen_root)).expanduser())
    try:
        candidates.append(Path(sys.executable).expanduser().resolve().parent)
    except (OSError, ValueError):
        pass
    try:
        candidates.append(Path(__file__).resolve().parents[2])
    except (OSError, IndexError):
        pass
    candidates.append(Path.cwd())
    expanded: list[Path] = []
    seen: set[str] = set()
    for base in candidates:
        for path in (base, base / "bin", base / "ffmpeg", base / "imageio_ffmpeg" / "binaries"):
            key = str(path)
            if key not in seen:
                seen.add(key)
                expanded.append(path)
    return expanded


def _binary_names(name: str) -> list[str]:
    suffixes = [".exe", ".cmd", ".bat"] if os.name == "nt" else [""]
    names = [f"{name}{suffix}" for suffix in suffixes]
    if name == "ffmpeg":
        names.extend([f"ffmpeg-{sys.platform}{suffix}" for suffix in suffixes])
    return names


def _bundled_binary(name: str) -> str:
    for folder in _resource_dirs():
        for filename in _binary_names(name):
            path = folder / filename
            existing = _existing_file(path)
            if existing:
                return existing
    return ""


def _managed_ffmpeg_available() -> bool:
    try:
        import imageio_ffmpeg  # noqa: F401
    except Exception:
        return False
    return True


def _managed_ffmpeg_path() -> str:
    try:
        import imageio_ffmpeg
    except Exception:
        return ""
    try:
        return _existing_file(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return ""


def _discover_ffmpeg() -> dict[str, str]:
    configured = _existing_file(os.environ.get("VINTRACE_FFMPEG_PATH") or os.environ.get("CROSSAGE_FFMPEG_PATH"))
    if configured:
        return {"path": configured, "source": "configured"}
    bundled = _bundled_binary("ffmpeg")
    if bundled:
        return {"path": bundled, "source": "bundled"}
    managed = _managed_ffmpeg_path()
    if managed:
        return {"path": managed, "source": "managed"}
    system = shutil.which("ffmpeg") or ""
    return {"path": system, "source": "system" if system else "missing"}


def _discover_ffprobe() -> dict[str, str]:
    configured = _existing_file(os.environ.get("VINTRACE_FFPROBE_PATH") or os.environ.get("CROSSAGE_FFPROBE_PATH"))
    if configured:
        return {"path": configured, "source": "configured"}
    bundled = _bundled_binary("ffprobe")
    if bundled:
        return {"path": bundled, "source": "bundled"}
    system = shutil.which("ffprobe") or ""
    return {"path": system, "source": "system" if system else "missing"}


def _ffmpeg_path() -> str:
    return str(_discover_ffmpeg().get("path") or "")


def _ffprobe_path() -> str:
    return str(_discover_ffprobe().get("path") or "")


def _probe_video_ffmpeg(path: Path) -> dict[str, object]:
    resolved = path.expanduser().resolve()
    ffprobe = _ffprobe_path()
    if not ffprobe:
        ffmpeg = _ffmpeg_path()
        if not ffmpeg:
            raise VideoLoadError("Video support requires OpenCV or FFmpeg.")
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(resolved),
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
        if completed.returncode != 0:
            raise VideoLoadError((completed.stderr or completed.stdout or f"Could not probe video {resolved}").strip()[:400])
        return {
            "path": str(resolved),
            "exists": resolved.exists(),
            "readable": True,
            "frameCount": 0,
            "fps": 0.0,
            "width": 0,
            "height": 0,
            "durationMs": 0,
            "backend": "ffmpeg",
            "probeLimited": True,
        }
    command = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,nb_frames,r_frame_rate,duration",
        "-of",
        "json",
        str(resolved),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=20, check=False)
    if completed.returncode != 0:
        raise VideoLoadError((completed.stderr or completed.stdout or f"Could not probe video {resolved}").strip()[:400])
    try:
        payload = json.loads(completed.stdout or "{}")
        stream = (payload.get("streams") or [{}])[0]
    except (json.JSONDecodeError, AttributeError, IndexError):
        stream = {}
    width = _safe_int(stream.get("width"))
    height = _safe_int(stream.get("height"))
    frame_rate = _parse_frame_rate(stream.get("r_frame_rate"))
    duration_seconds = _safe_float(stream.get("duration"))
    frame_count = _safe_int(stream.get("nb_frames"))
    if frame_count <= 0 and duration_seconds > 0 and frame_rate > 0:
        frame_count = int(round(duration_seconds * frame_rate))
    return {
        "path": str(resolved),
        "exists": resolved.exists(),
        "readable": True,
        "frameCount": frame_count,
        "fps": frame_rate,
        "width": width,
        "height": height,
        "durationMs": int(duration_seconds * 1000) if duration_seconds > 0 else 0,
        "backend": "ffmpeg",
    }


def _sample_video_frames_ffmpeg(
    path: Path,
    output_root: Path,
    max_frames: int = 48,
    interval_seconds: float = 2.0,
    jpeg_quality: int = 88,
) -> list[VideoFrameSample]:
    ffmpeg = _ffmpeg_path()
    if not ffmpeg:
        raise VideoLoadError("Video support requires OpenCV or FFmpeg on PATH.")
    resolved = path.expanduser().resolve()
    max_frames = max(1, min(1000, int(max_frames)))
    interval_seconds = max(0.25, float(interval_seconds))
    jpeg_quality = max(1, min(100, int(jpeg_quality)))
    target_dir = output_root / _video_slug(resolved)
    cached = _load_video_sample_cache(
        target_dir,
        source=resolved,
        max_frames=max_frames,
        interval_seconds=interval_seconds,
        jpeg_quality=jpeg_quality,
    )
    if cached:
        return cached[:max_frames]
    probe: dict[str, object]
    try:
        probe = _probe_video_ffmpeg(resolved)
    except VideoLoadError:
        probe = {"width": 0, "height": 0, "durationMs": 0, "fps": 0.0}
    target_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="vintrace-ffmpeg-frames-") as temp_name:
        temp_dir = Path(temp_name)
        pattern = temp_dir / "frame-%08d.jpg"
        quality_scale = max(2, min(31, int(round(31 - (max(1, min(100, jpeg_quality)) / 100) * 29))))
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(resolved),
            "-vf",
            f"fps=1/{interval_seconds}",
            "-frames:v",
            str(max_frames),
            "-q:v",
            str(quality_scale),
            str(pattern),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, timeout=max(30, max_frames * 2), check=False)
        if completed.returncode != 0:
            raise VideoLoadError((completed.stderr or completed.stdout or f"Could not decode video {resolved}").strip()[:400])
        frames = sorted(temp_dir.glob("frame-*.jpg"))
        if not frames:
            raise VideoLoadError(f"No frames could be decoded from {resolved}")
        width = int(probe.get("width") or 0)
        height = int(probe.get("height") or 0)
        duration_ms = int(probe.get("durationMs") or 0)
        samples: list[VideoFrameSample] = []
        for offset, source_frame in enumerate(frames[:max_frames]):
            timestamp_ms = int(round(offset * interval_seconds * 1000))
            frame_path = target_dir / f"frame-ffmpeg-{offset:08d}-{timestamp_ms:010d}ms.jpg"
            source_frame.replace(frame_path)
            samples.append(
                VideoFrameSample(
                    path=frame_path,
                    timestamp_ms=timestamp_ms,
                    frame_index=offset,
                    width=width,
                    height=height,
                    duration_ms=max(0, duration_ms),
                )
            )
        _write_video_sample_cache(
            target_dir,
            source=resolved,
            backend="ffmpeg",
            max_frames=max_frames,
            interval_seconds=interval_seconds,
            jpeg_quality=jpeg_quality,
            samples=samples,
        )
        return samples


def _safe_int(value: object) -> int:
    try:
        text = str(value).strip()
        if text.upper() == "N/A" or not text:
            return 0
        return int(float(text))
    except (TypeError, ValueError):
        return 0


def _safe_float(value: object) -> float:
    try:
        text = str(value).strip()
        if text.upper() == "N/A" or not text:
            return 0.0
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def _parse_frame_rate(value: object) -> float:
    text = str(value).strip()
    if "/" in text:
        left, right = text.split("/", 1)
        numerator = _safe_float(left)
        denominator = _safe_float(right)
        return numerator / denominator if denominator else 0.0
    return _safe_float(text)


def _video_source_signature(path: Path) -> dict[str, object]:
    try:
        stat = path.stat()
        return {
            "path": str(path.resolve()),
            "size": int(stat.st_size),
            "mtimeNs": int(stat.st_mtime_ns),
        }
    except OSError:
        return {"path": str(path.resolve()), "size": 0, "mtimeNs": 0}


def _cache_settings(source: Path, *, max_frames: int, interval_seconds: float, jpeg_quality: int) -> dict[str, object]:
    return {
        "source": _video_source_signature(source),
        "maxFrames": int(max_frames),
        "intervalSeconds": round(float(interval_seconds), 6),
        "jpegQuality": int(jpeg_quality),
        "format": "jpeg",
        "version": 1,
    }


def _load_video_sample_cache(
    target_dir: Path,
    *,
    source: Path,
    max_frames: int,
    interval_seconds: float,
    jpeg_quality: int,
) -> list[VideoFrameSample]:
    manifest_path = target_dir / "manifest.json"
    if not manifest_path.exists():
        return []
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    expected = _cache_settings(source, max_frames=max_frames, interval_seconds=interval_seconds, jpeg_quality=jpeg_quality)
    for key in ("source", "maxFrames", "intervalSeconds", "jpegQuality", "format", "version"):
        if payload.get(key) != expected.get(key):
            return []
    rows = payload.get("samples")
    if not isinstance(rows, list) or not rows:
        return []
    samples: list[VideoFrameSample] = []
    for row in rows:
        if not isinstance(row, dict):
            return []
        frame_path = target_dir / str(row.get("file", ""))
        try:
            if not frame_path.exists() or not frame_path.is_file():
                return []
            samples.append(
                VideoFrameSample(
                    path=frame_path,
                    timestamp_ms=max(0, int(row.get("timestampMs", 0) or 0)),
                    frame_index=max(0, int(row.get("frameIndex", 0) or 0)),
                    width=max(0, int(row.get("width", 0) or 0)),
                    height=max(0, int(row.get("height", 0) or 0)),
                    duration_ms=max(0, int(row.get("durationMs", 0) or 0)),
                )
            )
        except (OSError, ValueError, TypeError):
            return []
    return samples


def _write_video_sample_cache(
    target_dir: Path,
    *,
    source: Path,
    backend: str,
    max_frames: int,
    interval_seconds: float,
    jpeg_quality: int,
    samples: list[VideoFrameSample],
) -> None:
    payload = {
        **_cache_settings(source, max_frames=max_frames, interval_seconds=interval_seconds, jpeg_quality=jpeg_quality),
        "backend": backend,
        "samples": [
            {
                "file": sample.path.name,
                "timestampMs": int(sample.timestamp_ms),
                "frameIndex": int(sample.frame_index),
                "width": int(sample.width),
                "height": int(sample.height),
                "durationMs": int(sample.duration_ms),
            }
            for sample in samples
        ],
    }
    target_dir.mkdir(parents=True, exist_ok=True)
    temp = target_dir / "manifest.json.tmp"
    temp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    temp.replace(target_dir / "manifest.json")


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

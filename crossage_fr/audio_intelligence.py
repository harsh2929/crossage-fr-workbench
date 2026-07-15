from __future__ import annotations

from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
import csv
import hashlib
import importlib.util
import json
import math
import os
import re
import sys
import threading
from typing import Any, Callable, Iterable

import numpy as np

from crossage_fr.ingest.video_io import extract_audio_waveform


AUDIO_INDEX_VERSION = "vintrace-audio-v1"
AUDIO_PACK_VERSION = "2026-07-13.1"
AUDIO_SAMPLE_RATE = 16_000
AUDIO_CHUNK_SECONDS = 60
AUDIO_MAX_DURATION_SECONDS = 4 * 60 * 60
WHISPER_MODEL_NAME = "whisper-tiny-q5_1-multilingual"
WHISPER_RUNTIME_VERSION = "1.5.0"
YAMNET_MODEL_NAME = "YAMNet"
YAMNET_EVENT_THRESHOLD = 0.30

_ARTIFACTS: dict[str, tuple[int, str]] = {
    "manifest.json": (3_197, "7f32829e2030f17aa1a0261c82d29dcb9ed1c935d499c3b363545d814cc6b88e"),
    "ggml-tiny-q5_1.bin": (32_152_673, "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7"),
    "yamnet-core.onnx": (14_937_376, "abbf32f935788eebd30c2a8152028cd352c5af1e45839693d7f6814cbcf7fd2c"),
    "yamnet-mel-weights.npy": (65_920, "53ad4939af58db21446b2aefa3bae4c902317b6c0cdeacdd6a6fc2a569508efd"),
    "yamnet-class-map.csv": (14_096, "cdf24d193e196d9e95912a2667051ae203e92a2ba09449218ccb40ef787c6df2"),
    "YAMNET-LICENSE": (11_512, "5b17814bf0de8cf65069bc6d7cc38cff19fcaa864d243423ad3ef3db01b52385"),
    "WHISPERCPP-LICENSE": (1_078, "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d"),
    "WHISPER-MODEL-LICENSE": (1_063, "b5d65a59060e68c4ff940e1eddfa6f94b2d68fdf58ed7f4dd57721c997e35e9d"),
    "PYWHISPERCPP-LICENSE": (1_073, "ecb64e35ec850415748fcf5d688cdab6480e58bd0cd4bfa369fa505ab3d497e8"),
}

# YAMNet has 521 AudioSet labels. Keep only concrete, searchable sound events;
# notably, this excludes speaker identity, gender, and inferred emotion.
_SEARCHABLE_EVENT_LABELS = frozenset(
    {
        "Speech",
        "Conversation",
        "Laughter",
        "Crying, sobbing",
        "Baby cry, infant cry",
        "Singing",
        "Whistling",
        "Clapping",
        "Cheering",
        "Applause",
        "Dog",
        "Bark",
        "Howl",
        "Cat",
        "Purr",
        "Meow",
        "Bird",
        "Bird vocalization, bird call, bird song",
        "Music",
        "Piano",
        "Guitar",
        "Bell",
        "Wind chime",
        "Wind",
        "Thunderstorm",
        "Thunder",
        "Water",
        "Rain",
        "Raindrop",
        "Waterfall",
        "Fire",
        "Vehicle",
        "Boat, Water vehicle",
        "Car",
        "Vehicle horn, car horn, honking",
        "Car alarm",
        "Engine",
        "Aircraft",
        "Door",
        "Doorbell",
        "Knock",
        "Typing",
        "Alarm",
        "Telephone",
        "Telephone bell ringing",
        "Alarm clock",
        "Siren",
        "Fire alarm",
        "Explosion",
        "Gunshot, gunfire",
        "Fireworks",
        "Glass",
        "Breaking",
    }
)

_WHISPER_MODEL: Any | None = None
_WHISPER_MODEL_PATH = ""
_WHISPER_LOCK = threading.Lock()
_YAMNET_SESSION: Any | None = None
_YAMNET_MODEL_PATH = ""
_YAMNET_LOCK = threading.Lock()
_YAMNET_MEL: np.ndarray | None = None
_YAMNET_LABELS: tuple[str, ...] = ()
_MODEL_REPORT_CACHE_KEY: tuple[tuple[str, int, int], ...] | None = None
_MODEL_REPORT_CACHE: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class AudioSegment:
    kind: str
    start_ms: int
    end_ms: int
    timestamp_ms: int
    text: str = ""
    label: str = ""
    confidence: float | None = None
    language: str = ""
    model: str = ""
    model_version: str = ""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _audio_model_roots() -> list[Path]:
    roots: list[Path] = []
    frozen_root = str(getattr(sys, "_MEIPASS", "") or "").strip()
    if frozen_root:
        roots.append(Path(frozen_root) / "models" / "audio")
    try:
        roots.append(Path(__file__).resolve().parents[1] / "models" / "audio")
    except (OSError, IndexError):
        pass
    try:
        roots.append(Path(sys.executable).resolve().parent / "models" / "audio")
    except OSError:
        pass
    roots.append(Path.cwd() / "models" / "audio")
    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def audio_model_root() -> Path:
    for root in _audio_model_roots():
        if (root / "manifest.json").is_file():
            return root
    return _audio_model_roots()[0]


def audio_model_report(*, verify_hashes: bool = True) -> dict[str, Any]:
    global _MODEL_REPORT_CACHE_KEY, _MODEL_REPORT_CACHE
    root = audio_model_root()
    manifest_path = root / "manifest.json"
    cache_key: tuple[tuple[str, int, int], ...] = ()
    if verify_hashes:
        stat_rows: list[tuple[str, int, int]] = []
        for filename in _ARTIFACTS:
            try:
                stat = (root / filename).stat()
                stat_rows.append((filename, int(stat.st_size), int(stat.st_mtime_ns)))
            except OSError:
                stat_rows.append((filename, -1, -1))
        cache_key = tuple(stat_rows)
        if _MODEL_REPORT_CACHE_KEY == cache_key and _MODEL_REPORT_CACHE is not None:
            return _MODEL_REPORT_CACHE
    errors: list[str] = []
    manifest: dict[str, Any] = {}
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(manifest, dict):
            raise ValueError("manifest root must be an object")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append(f"Audio model manifest is unavailable: {exc}")
    artifact_rows: list[dict[str, Any]] = []
    for filename, (expected_bytes, expected_sha256) in _ARTIFACTS.items():
        path = root / filename
        exists = path.is_file() and not path.is_symlink()
        size = path.stat().st_size if exists else -1
        actual_sha256 = _sha256_file(path) if exists and verify_hashes else ""
        valid = bool(
            exists
            and size == expected_bytes
            and (not verify_hashes or actual_sha256 == expected_sha256)
        )
        if not valid:
            errors.append(f"Audio model artifact failed integrity validation: {filename}")
        artifact_rows.append(
            {
                "file": filename,
                "bytes": size,
                "sha256": actual_sha256,
                "expectedSha256": expected_sha256,
                "valid": valid,
            }
        )
    try:
        whisper_runtime = metadata.version("pywhispercpp")
    except metadata.PackageNotFoundError:
        whisper_runtime = ""
    whisper_native = importlib.util.find_spec("_pywhispercpp") is not None
    if whisper_runtime != WHISPER_RUNTIME_VERSION or not whisper_native:
        errors.append(f"pywhispercpp {WHISPER_RUNTIME_VERSION} with its native module is required.")
    try:
        onnx_runtime = metadata.version("onnxruntime")
    except metadata.PackageNotFoundError:
        onnx_runtime = ""
    if not onnx_runtime:
        errors.append("ONNX Runtime is required for YAMNet sound-event inference.")
    available = not errors
    report = {
        "available": available,
        "offline": True,
        "packVersion": AUDIO_PACK_VERSION,
        "indexVersion": AUDIO_INDEX_VERSION,
        "root": str(root),
        "manifestPath": str(manifest_path),
        "manifest": manifest,
        "asr": {
            "modelName": WHISPER_MODEL_NAME,
            "modelPath": str(root / "ggml-tiny-q5_1.bin"),
            "runtime": "pywhispercpp",
            "runtimeVersion": whisper_runtime,
            "nativeModulePresent": whisper_native,
            "multilingual": True,
        },
        "soundEvents": {
            "modelName": YAMNET_MODEL_NAME,
            "modelPath": str(root / "yamnet-core.onnx"),
            "runtime": "onnxruntime-cpu",
            "runtimeVersion": onnx_runtime,
            "classCount": 521,
        },
        "privacy": {
            "networkAtInference": False,
            "speakerIdentification": False,
            "speakerDiarization": False,
            "storesRawAudio": False,
        },
        "artifacts": artifact_rows,
        "errors": errors,
        "reason": "" if available else errors[0],
    }
    if verify_hashes:
        _MODEL_REPORT_CACHE_KEY = cache_key
        _MODEL_REPORT_CACHE = report
    return report


def _require_audio_model_root() -> Path:
    report = audio_model_report()
    if not report.get("available"):
        raise RuntimeError(str(report.get("reason") or "Audio model pack is unavailable."))
    return Path(str(report["root"]))


def _whisper_model(root: Path) -> Any:
    global _WHISPER_MODEL, _WHISPER_MODEL_PATH
    model_path = str((root / "ggml-tiny-q5_1.bin").resolve())
    with _WHISPER_LOCK:
        if _WHISPER_MODEL is not None and _WHISPER_MODEL_PATH == model_path:
            return _WHISPER_MODEL
        from pywhispercpp.model import Model

        _WHISPER_MODEL = Model(
            model_path,
            n_threads=max(1, min(4, int(os.cpu_count() or 1))),
            print_progress=False,
            print_realtime=False,
            print_timestamps=False,
            no_context=True,
            suppress_non_speech_tokens=True,
            context_params={"use_gpu": False},
            redirect_whispercpp_logs_to=None,
        )
        _WHISPER_MODEL_PATH = model_path
        return _WHISPER_MODEL


def _yamnet_resources(root: Path) -> tuple[Any, np.ndarray, tuple[str, ...]]:
    global _YAMNET_SESSION, _YAMNET_MODEL_PATH, _YAMNET_MEL, _YAMNET_LABELS
    model_path = str((root / "yamnet-core.onnx").resolve())
    with _YAMNET_LOCK:
        if _YAMNET_SESSION is None or _YAMNET_MODEL_PATH != model_path:
            import onnxruntime as ort

            _YAMNET_SESSION = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            _YAMNET_MODEL_PATH = model_path
            mel = np.load(root / "yamnet-mel-weights.npy", allow_pickle=False)
            if mel.shape != (257, 64) or mel.dtype != np.float32 or not np.isfinite(mel).all():
                raise RuntimeError("YAMNet mel-weight matrix is invalid.")
            _YAMNET_MEL = np.asarray(mel, dtype=np.float32)
            with (root / "yamnet-class-map.csv").open("r", encoding="utf-8", newline="") as handle:
                rows = list(csv.DictReader(handle))
            labels = tuple(str(row.get("display_name", "") or "").strip() for row in rows)
            if len(labels) != 521 or any(not label for label in labels):
                raise RuntimeError("YAMNet class map is invalid.")
            _YAMNET_LABELS = labels
        assert _YAMNET_MEL is not None
        return _YAMNET_SESSION, _YAMNET_MEL, _YAMNET_LABELS


def yamnet_log_mel_patches(waveform: np.ndarray, mel_weights: np.ndarray) -> np.ndarray:
    audio = np.asarray(waveform, dtype=np.float32).reshape(-1)
    if not np.isfinite(audio).all():
        raise ValueError("Audio waveform contains non-finite samples.")
    minimum_samples = 15_600
    after_first = max(audio.size, minimum_samples) - minimum_samples
    hops_after_first = int(math.ceil(after_first / 7_680))
    padding = max(0, minimum_samples - audio.size) + (hops_after_first * 7_680 - after_first)
    if padding:
        audio = np.pad(audio, (0, padding), mode="constant")
    frames = np.lib.stride_tricks.sliding_window_view(audio, 400)[::160]
    window = (0.5 - 0.5 * np.cos(2 * np.pi * np.arange(400) / 400)).astype(np.float32)
    magnitude = np.abs(np.fft.rfft(frames * window, n=512, axis=-1)).astype(np.float32)
    log_mel = np.log(magnitude @ mel_weights + np.float32(0.001)).astype(np.float32)
    return np.stack([log_mel[index:index + 96] for index in range(0, len(log_mel) - 95, 48)])


def _merge_sound_events(events: Iterable[AudioSegment]) -> list[AudioSegment]:
    by_label: dict[str, list[AudioSegment]] = {}
    for event in events:
        by_label.setdefault(event.label, []).append(event)
    merged: list[AudioSegment] = []
    for label, label_events in by_label.items():
        label_merged: list[AudioSegment] = []
        for event in sorted(label_events, key=lambda item: (item.start_ms, item.end_ms)):
            previous = label_merged[-1] if label_merged else None
            if previous and event.start_ms <= previous.end_ms + 480:
                label_merged[-1] = AudioSegment(
                    kind="sound",
                    start_ms=previous.start_ms,
                    end_ms=max(previous.end_ms, event.end_ms),
                    timestamp_ms=previous.timestamp_ms,
                    label=label,
                    confidence=max(float(previous.confidence or 0.0), float(event.confidence or 0.0)),
                    model=YAMNET_MODEL_NAME,
                    model_version=AUDIO_PACK_VERSION,
                )
                continue
            label_merged.append(event)
        merged.extend(label_merged)
    return sorted(merged, key=lambda item: (item.start_ms, item.label, item.end_ms))


def classify_sound_events(
    waveform: np.ndarray,
    *,
    offset_ms: int = 0,
    threshold: float = YAMNET_EVENT_THRESHOLD,
) -> list[AudioSegment]:
    root = _require_audio_model_root()
    session, mel_weights, labels = _yamnet_resources(root)
    patches = yamnet_log_mel_patches(waveform, mel_weights)
    outputs = session.run(None, {session.get_inputs()[0].name: patches})
    scores = next((np.asarray(value, dtype=np.float32) for value in outputs if value.ndim == 2 and value.shape[1] == 521), None)
    if scores is None or scores.shape[0] != patches.shape[0] or not np.isfinite(scores).all():
        raise RuntimeError("YAMNet returned invalid sound-event scores.")
    duration_ms = int(round(np.asarray(waveform).size * 1000 / AUDIO_SAMPLE_RATE))
    allowed_indices = [index for index, label in enumerate(labels) if label in _SEARCHABLE_EVENT_LABELS]
    raw_events: list[AudioSegment] = []
    clean_threshold = max(0.05, min(0.95, float(threshold)))
    for patch_index, row in enumerate(scores):
        ranked = sorted(allowed_indices, key=lambda index: float(row[index]), reverse=True)[:2]
        for class_index in ranked:
            confidence = float(row[class_index])
            if confidence < clean_threshold:
                continue
            start_ms = offset_ms + patch_index * 480
            end_ms = offset_ms + min(duration_ms, patch_index * 480 + 960)
            if end_ms <= start_ms:
                continue
            raw_events.append(
                AudioSegment(
                    kind="sound",
                    start_ms=start_ms,
                    end_ms=end_ms,
                    timestamp_ms=start_ms,
                    label=labels[class_index],
                    confidence=confidence,
                    model=YAMNET_MODEL_NAME,
                    model_version=AUDIO_PACK_VERSION,
                )
            )
    return _merge_sound_events(raw_events)


def _clean_transcript_text(value: Any) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if not text or re.fullmatch(r"[\[<(].{0,80}[\])>]", text):
        return ""
    return text[:4_000]


def transcribe_waveform(
    waveform: np.ndarray,
    *,
    offset_ms: int = 0,
    language: str = "",
) -> tuple[list[AudioSegment], str]:
    root = _require_audio_model_root()
    model = _whisper_model(root)
    audio = np.asarray(waveform, dtype=np.float32).reshape(-1)
    selected_language = re.sub(r"[^A-Za-z0-9_-]", "", str(language or "").strip().lower())[:16]
    with _WHISPER_LOCK:
        if not selected_language or selected_language == "auto":
            try:
                detected, _ = model.auto_detect_language(audio)
                selected_language = str(detected[0] or "").strip().lower()[:16]
            except Exception:
                selected_language = ""
        raw_segments = model.transcribe(
            audio,
            extract_probability=True,
            language=selected_language or "auto",
            detect_language=False,
            no_context=True,
            suppress_non_speech_tokens=True,
            print_progress=False,
        )
    duration_ms = int(round(audio.size * 1000 / AUDIO_SAMPLE_RATE))
    segments: list[AudioSegment] = []
    for raw in raw_segments:
        text = _clean_transcript_text(getattr(raw, "text", ""))
        if not text:
            continue
        start_ms = offset_ms + max(0, int(getattr(raw, "t0", 0) or 0) * 10)
        end_ms = offset_ms + min(duration_ms, max(0, int(getattr(raw, "t1", 0) or 0) * 10))
        if end_ms <= start_ms:
            continue
        probability = float(getattr(raw, "probability", float("nan")))
        confidence = probability if math.isfinite(probability) and 0.0 <= probability <= 1.0 else None
        segments.append(
            AudioSegment(
                kind="speech",
                start_ms=start_ms,
                end_ms=end_ms,
                timestamp_ms=start_ms,
                text=text,
                confidence=confidence,
                language=selected_language,
                model=WHISPER_MODEL_NAME,
                model_version=AUDIO_PACK_VERSION,
            )
        )
    return segments, selected_language


def analyze_media_audio(
    path: Path,
    *,
    duration_ms: int = 0,
    language: str = "",
    transcribe: bool = True,
    sound_events: bool = True,
    max_duration_seconds: int = AUDIO_MAX_DURATION_SECONDS,
    waveform_loader: Callable[..., np.ndarray] = extract_audio_waveform,
    transcript_engine: Callable[..., tuple[list[AudioSegment], str]] = transcribe_waveform,
    event_engine: Callable[..., list[AudioSegment]] = classify_sound_events,
) -> dict[str, Any]:
    if not transcribe and not sound_events:
        raise ValueError("At least one audio analysis mode must be enabled.")
    resolved = path.expanduser().resolve()
    if not resolved.is_file() or resolved.is_symlink():
        raise FileNotFoundError(f"Media source is unavailable: {resolved}")
    clean_max_seconds = max(1, min(AUDIO_MAX_DURATION_SECONDS, int(max_duration_seconds or AUDIO_MAX_DURATION_SECONDS)))
    requested_duration_ms = max(0, int(duration_ms or 0))
    capped_duration_ms = min(requested_duration_ms, clean_max_seconds * 1000) if requested_duration_ms else clean_max_seconds * 1000
    offset_ms = 0
    detected_language = re.sub(r"[^A-Za-z0-9_-]", "", str(language or "").strip().lower())[:16]
    transcript_segments: list[AudioSegment] = []
    event_segments: list[AudioSegment] = []
    decoded_samples = 0
    while offset_ms < capped_duration_ms:
        chunk_ms = min(AUDIO_CHUNK_SECONDS * 1000, capped_duration_ms - offset_ms)
        waveform = waveform_loader(
            resolved,
            start_ms=offset_ms,
            duration_ms=chunk_ms,
            sample_rate=AUDIO_SAMPLE_RATE,
        )
        waveform = np.asarray(waveform, dtype=np.float32).reshape(-1)
        if waveform.size == 0:
            break
        decoded_samples += int(waveform.size)
        actual_chunk_ms = max(1, int(round(waveform.size * 1000 / AUDIO_SAMPLE_RATE)))
        if transcribe:
            chunk_transcripts, chunk_language = transcript_engine(
                waveform,
                offset_ms=offset_ms,
                language=detected_language,
            )
            transcript_segments.extend(chunk_transcripts)
            if chunk_language:
                detected_language = chunk_language
        if sound_events:
            event_segments.extend(event_engine(waveform, offset_ms=offset_ms))
        offset_ms += actual_chunk_ms
        if actual_chunk_ms + 100 < chunk_ms:
            break
    if decoded_samples == 0:
        raise RuntimeError("No decodable audio stream was found in this media file.")
    merged_event_segments = _merge_sound_events(event_segments)
    return {
        "indexVersion": AUDIO_INDEX_VERSION,
        "packVersion": AUDIO_PACK_VERSION,
        "sampleRateHz": AUDIO_SAMPLE_RATE,
        "durationMs": int(round(decoded_samples * 1000 / AUDIO_SAMPLE_RATE)),
        "truncated": bool(requested_duration_ms and requested_duration_ms > clean_max_seconds * 1000),
        "language": detected_language,
        "transcriptSegments": transcript_segments,
        "soundEventSegments": merged_event_segments,
        "segments": sorted(
            [*transcript_segments, *merged_event_segments],
            key=lambda item: (item.start_ms, item.kind, item.end_ms),
        ),
    }

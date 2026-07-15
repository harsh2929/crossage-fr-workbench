#!/usr/bin/env python3
"""Run the pinned offline ASR, sound-event, persistence, and search gate."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import tempfile
from time import perf_counter
from typing import Any
import wave

import numpy as np

from crossage_fr.api_server import DesktopApi
from crossage_fr.audio_intelligence import (
    AUDIO_INDEX_VERSION,
    AUDIO_PACK_VERSION,
    audio_model_report,
    classify_sound_events,
    transcribe_waveform,
)
from crossage_fr.ingest.video_io import video_decoder_report


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_MANIFEST_PATH = ROOT / "tests" / "fixtures" / "audio" / "manifest.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_waveform(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() != 16_000:
            raise RuntimeError(f"Acceptance fixture has an invalid WAV format: {path.name}")
        raw = handle.readframes(handle.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / np.float32(32768.0)


def normalized_words(value: str) -> list[str]:
    clean = "".join(character.lower() if character.isalnum() else " " for character in value)
    return ["seven" if word == "7" else word for word in clean.split()]


def word_error_rate(reference: str, hypothesis: str) -> float:
    expected = normalized_words(reference)
    actual = normalized_words(hypothesis)
    costs = list(range(len(actual) + 1))
    for row_index, left in enumerate(expected, start=1):
        next_costs = [row_index]
        for column_index, right in enumerate(actual, start=1):
            next_costs.append(min(
                next_costs[-1] + 1,
                costs[column_index] + 1,
                costs[column_index - 1] + (left != right),
            ))
        costs = next_costs
    return costs[-1] / max(1, len(expected))


def fixture_rows() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    manifest = json.loads(FIXTURE_MANIFEST_PATH.read_text(encoding="utf-8"))
    rows = manifest.get("fixtures", [])
    if manifest.get("datasetId") != "vintrace-audio-acceptance-v1" or len(rows) != 2:
        raise RuntimeError("Audio acceptance fixture manifest is invalid.")
    by_id = {str(row.get("id", "")): row for row in rows}
    speech = by_id.get("blue-lantern-speech")
    chime = by_id.get("synthetic-chime")
    if not isinstance(speech, dict) or not isinstance(chime, dict):
        raise RuntimeError("Audio acceptance fixtures are incomplete.")
    for row in (speech, chime):
        path = ROOT / str(row["path"])
        if path.stat().st_size != int(row["bytes"]) or sha256_file(path) != row["sha256"]:
            raise RuntimeError(f"Audio acceptance fixture failed integrity validation: {path.name}")
    return manifest, speech, chime


def create_video_fixture(ffmpeg: str, speech_path: Path, output: Path) -> list[str]:
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "lavfi",
        "-i", "color=c=0x17324d:s=160x90:r=2:d=3",
        "-i", str(speech_path),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "mpeg4",
        "-q:v", "5",
        "-c:a", "aac",
        "-shortest",
        "-map_metadata", "-1",
        str(output),
    ]
    completed = subprocess.run(command, check=False, capture_output=True, text=True, timeout=60)
    if completed.returncode != 0 or not output.is_file() or output.stat().st_size <= 0:
        raise RuntimeError(f"FFmpeg could not create the audio benchmark MP4: {completed.stderr[-1000:]}")
    return command


def first_photo_hit(search: dict[str, Any]) -> dict[str, Any]:
    for group in search.get("groups", []):
        if group.get("id") == "photos" and group.get("items"):
            return dict(group["items"][0])
    return {}


def compact_search_hit(hit: dict[str, Any]) -> dict[str, Any]:
    return {
        key: hit.get(key)
        for key in (
            "title",
            "snippet",
            "resultKind",
            "mediaKind",
            "timestampMs",
            "startMs",
            "endMs",
            "audioSegmentKind",
            "audioLanguage",
            "audioConfidence",
        )
    }


def compact_segment(segment: dict[str, Any]) -> dict[str, Any]:
    return {
        key: segment.get(key)
        for key in (
            "segmentKind",
            "startMs",
            "endMs",
            "timestampMs",
            "text",
            "label",
            "confidence",
            "language",
            "modelName",
            "modelVersion",
            "indexVersion",
        )
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or ROOT / "benchmarks" / "results" / f"audio-intelligence-benchmark-{datetime.now().strftime('%Y%m%d')}.json"

    manifest, speech_fixture, chime_fixture = fixture_rows()
    decoder = video_decoder_report()
    ffmpeg = str(decoder.get("ffmpegPath", "") or "")
    if not ffmpeg:
        raise RuntimeError("The managed or configured FFmpeg decoder is required for the audio benchmark.")

    previous_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
    previous_crossage_registry = os.environ.get("CROSSAGE_REGISTRY_HOME")
    original_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def blocked_connect(_sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"Unexpected outbound connection during audio benchmark: {address!r}")

    def blocked_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"Unexpected outbound connection during audio benchmark: {address!r}")

    try:
        with tempfile.TemporaryDirectory(prefix="vintrace-audio-benchmark-") as tmp:
            temp = Path(tmp)
            source = temp / "blue-lantern.mp4"
            create_video_fixture(ffmpeg, ROOT / speech_fixture["path"], source)
            source_sha_before = sha256_file(source)
            os.environ["VINTRACE_REGISTRY_HOME"] = str(temp / "registry")
            os.environ["CROSSAGE_REGISTRY_HOME"] = str(temp / "registry")

            socket.socket.connect = blocked_connect
            socket.create_connection = blocked_create_connection
            model = audio_model_report()

            speech_waveform = read_waveform(ROOT / speech_fixture["path"])
            asr_started = perf_counter()
            transcript_segments, language = transcribe_waveform(speech_waveform, language="auto")
            asr_wall_ms = round((perf_counter() - asr_started) * 1000, 3)
            transcript = " ".join(segment.text for segment in transcript_segments)
            wer = round(word_error_rate(speech_fixture["expectedTranscript"], transcript), 6)

            sound_started = perf_counter()
            speech_events = classify_sound_events(speech_waveform)
            chime_events = classify_sound_events(read_waveform(ROOT / chime_fixture["path"]))
            sound_wall_ms = round((perf_counter() - sound_started) * 1000, 3)
            chime_matches = [event for event in chime_events if event.label == chime_fixture["expectedSoundEvent"]]
            chime_confidence = round(max((float(event.confidence or 0.0) for event in chime_matches), default=0.0), 6)

            api = DesktopApi(temp / "workspace")
            imported = api.import_photos({"sourcePaths": [str(source)], "storageMode": "referenced"})
            index_started = perf_counter()
            indexed = api.index_photo_audio({
                "sourcePaths": [str(source)],
                "ignoreSettings": True,
                "audioBudgetLimit": 1,
                "language": "auto",
            })
            index_wall_ms = round((perf_counter() - index_started) * 1000, 3)
            search = api.search_photo_library({"query": "blue lantern", "limit": 5, "previewBudget": 0})
            hit = first_photo_hit(search)
            asset_id = str(hit.get("assetId", "") or "")
            timeline = api.photo_audio_segments({"assetId": asset_id}) if asset_id else {"segments": []}
            reopened = DesktopApi(temp / "workspace")
            restart_hit = first_photo_hit(reopened.search_photo_library({"query": "blue lantern", "limit": 5, "previewBudget": 0}))
            status = reopened.photo_audio_status({})
            source_sha_after = sha256_file(source)
            raw_audio_sidecars = sorted(
                str(path.relative_to(temp / "workspace"))
                for path in (temp / "workspace").rglob("*")
                if path.is_file() and path.suffix.lower() in {".wav", ".pcm", ".flac", ".mp3", ".m4a"}
            )

            actual_words = normalized_words(transcript)
            checks = {
                "fixtureIntegrity": True,
                "realAsrModel": bool(model.get("available")) and model.get("asr", {}).get("runtime") == "pywhispercpp",
                "realSoundEventModel": bool(model.get("available")) and model.get("soundEvents", {}).get("runtime") == "onnxruntime-cpu",
                "asrWordErrorRateAccepted": wer <= 0.25,
                "requiredTranscriptWords": all(word in actual_words for word in speech_fixture["requiredWords"]),
                "languageDetected": language == "en",
                "asrTimestamped": bool(transcript_segments)
                and transcript_segments[0].start_ms < 1_500
                and transcript_segments[-1].end_ms <= int(speech_fixture["durationMs"]) + 100,
                "speechEventDetected": any(event.label == speech_fixture["expectedSoundEvent"] for event in speech_events),
                "nonSpeechEventDetected": bool(chime_matches) and chime_confidence >= float(chime_fixture["minimumConfidence"]),
                "videoImported": int(imported.get("importedCount", 0) or 0) == 1,
                "videoIndexed": int(indexed.get("progress", {}).get("updated", 0) or 0) == 1,
                "transcriptAndEventsPersisted": bool(timeline.get("transcriptSegments")) and bool(timeline.get("soundEventSegments")),
                "timestampedSearchResult": hit.get("resultKind") == "audioSegment"
                and int(hit.get("timestampMs", -1) or 0) >= 0
                and str(hit.get("snippet", "")).startswith("Transcript:"),
                "persistentRestart": bool(hit.get("assetId")) and restart_hit.get("assetId") == hit.get("assetId")
                and restart_hit.get("timestampMs") == hit.get("timestampMs"),
                "integrityBackedStatus": status.get("available") is True and all(row.get("valid") for row in status.get("artifacts", [])),
                "noRawAudioSidecars": not raw_audio_sidecars,
                "noSpeakerInference": status.get("privacy", {}).get("speakerIdentification") is False
                and status.get("privacy", {}).get("speakerDiarization") is False,
                "noSourceMutation": source_sha_before == source_sha_after,
                "zeroOutbound": not outbound_attempts,
            }
            report = {
                "schemaVersion": 1,
                "benchmarkId": "vintrace-audio-intelligence-v1",
                "indexVersion": AUDIO_INDEX_VERSION,
                "packVersion": AUDIO_PACK_VERSION,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "platform": platform.platform(),
                "python": platform.python_version(),
                "fixtureManifest": {
                    "path": str(FIXTURE_MANIFEST_PATH.relative_to(ROOT)),
                    "sha256": sha256_file(FIXTURE_MANIFEST_PATH),
                    "datasetId": manifest["datasetId"],
                    "version": manifest["version"],
                    "claimBoundary": manifest["claimBoundary"],
                },
                "fixtures": {
                    "speech": {**speech_fixture, "path": speech_fixture["path"]},
                    "nonSpeech": {**chime_fixture, "path": chime_fixture["path"]},
                    "containerSha256": source_sha_before,
                },
                "model": {
                    "available": model.get("available"),
                    "asr": {
                        key: model.get("asr", {}).get(key)
                        for key in ("modelName", "runtime", "runtimeVersion", "nativeModulePresent", "multilingual")
                    },
                    "soundEvents": {
                        key: model.get("soundEvents", {}).get(key)
                        for key in ("modelName", "runtime", "runtimeVersion", "classCount")
                    },
                    "artifacts": model.get("artifacts"),
                },
                "asr": {
                    "expected": speech_fixture["expectedTranscript"],
                    "actual": transcript,
                    "language": language,
                    "wordErrorRate": wer,
                    "wallMs": asr_wall_ms,
                    "segments": [
                        {
                            "startMs": segment.start_ms,
                            "endMs": segment.end_ms,
                            "text": segment.text,
                            "confidence": segment.confidence,
                        }
                        for segment in transcript_segments
                    ],
                },
                "soundEvents": {
                    "wallMs": sound_wall_ms,
                    "speech": [
                        {"label": event.label, "confidence": event.confidence, "startMs": event.start_ms, "endMs": event.end_ms}
                        for event in speech_events
                    ],
                    "nonSpeech": [
                        {"label": event.label, "confidence": event.confidence, "startMs": event.start_ms, "endMs": event.end_ms}
                        for event in chime_events
                    ],
                    "nonSpeechExpectedConfidence": chime_confidence,
                },
                "integration": {
                    "ffmpegSource": decoder.get("ffmpegSource"),
                    "ffmpegInvocation": {
                        "binary": Path(ffmpeg).name,
                        "inputs": ["lavfi:color", str(speech_fixture["path"])],
                        "videoCodec": "mpeg4",
                        "audioCodec": "aac",
                        "output": source.name,
                    },
                    "indexWallMs": index_wall_ms,
                    "indexProgress": indexed.get("progress", {}),
                    "segments": [compact_segment(segment) for segment in timeline.get("segments", [])],
                    "searchHit": compact_search_hit(hit),
                    "restartSearchHit": compact_search_hit(restart_hit),
                    "rawAudioSidecars": raw_audio_sidecars,
                },
                "network": {"socketGuard": True, "outboundAttempts": outbound_attempts},
                "checks": checks,
                "passed": all(checks.values()),
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({
                "report": str(output),
                "sha256": sha256_file(output),
                "asr": {"actual": transcript, "wordErrorRate": wer, "wallMs": asr_wall_ms},
                "soundEvents": {"nonSpeechConfidence": chime_confidence, "wallMs": sound_wall_ms},
                "integration": {"indexWallMs": index_wall_ms, "timestampMs": hit.get("timestampMs")},
                "checks": checks,
                "passed": report["passed"],
            }, indent=2, sort_keys=True))
            if not report["passed"]:
                raise SystemExit(1)
    finally:
        socket.socket.connect = original_connect
        socket.create_connection = original_create_connection
        if previous_registry is None:
            os.environ.pop("VINTRACE_REGISTRY_HOME", None)
        else:
            os.environ["VINTRACE_REGISTRY_HOME"] = previous_registry
        if previous_crossage_registry is None:
            os.environ.pop("CROSSAGE_REGISTRY_HOME", None)
        else:
            os.environ["CROSSAGE_REGISTRY_HOME"] = previous_crossage_registry


if __name__ == "__main__":
    main()

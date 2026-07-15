#!/usr/bin/env python3
"""Unit and real-model acceptance coverage for local audio intelligence."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import socket
import tempfile
from typing import Any
import wave

import numpy as np

import crossage_fr.api_server as api_server_module
from crossage_fr.api_server import DesktopApi
from crossage_fr.audio_intelligence import (
    AUDIO_INDEX_VERSION,
    AUDIO_PACK_VERSION,
    AudioSegment,
    analyze_media_audio,
    audio_model_report,
    classify_sound_events,
    transcribe_waveform,
    yamnet_log_mel_patches,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_ROOT = ROOT / "tests" / "fixtures" / "audio"
FIXTURE_MANIFEST = FIXTURE_ROOT / "manifest.json"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _waveform(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as handle:
        assert handle.getnchannels() == 1
        assert handle.getsampwidth() == 2
        assert handle.getframerate() == 16_000
        raw = handle.readframes(handle.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / np.float32(32768.0)


def _normalized_words(value: str) -> list[str]:
    clean = "".join(character.lower() if character.isalnum() else " " for character in value)
    words = clean.split()
    return ["seven" if word == "7" else word for word in words]


def _word_error_rate(reference: str, hypothesis: str) -> float:
    left = _normalized_words(reference)
    right = _normalized_words(hypothesis)
    costs = list(range(len(right) + 1))
    for row_index, expected in enumerate(left, start=1):
        next_costs = [row_index]
        for column_index, actual in enumerate(right, start=1):
            next_costs.append(
                min(
                    next_costs[-1] + 1,
                    costs[column_index] + 1,
                    costs[column_index - 1] + (expected != actual),
                )
            )
        costs = next_costs
    return costs[-1] / max(1, len(left))


def _api(root: Path) -> DesktopApi:
    registry = root / "registry"
    os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
    return DesktopApi(root / "workspace")


def _insert_video(api: DesktopApi, source: Path, *, duration_ms: int = 4_000) -> str:
    with api.project.db.connect() as conn:
        return api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(source),
            media_kind="video",
            mime_type="video/mp4",
            width=64,
            height=64,
            duration_ms=duration_ms,
            metadata={"video": {"durationMs": duration_ms}},
        )


def test_fixture_and_model_pack_integrity() -> None:
    manifest = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    assert manifest["datasetId"] == "vintrace-audio-acceptance-v1"
    for fixture in manifest["fixtures"]:
        path = ROOT / fixture["path"]
        assert path.is_file() and not path.is_symlink()
        assert path.stat().st_size == fixture["bytes"]
        assert _sha256(path) == fixture["sha256"]
        if fixture.get("generatorPath"):
            generator = ROOT / fixture["generatorPath"]
            assert _sha256(generator) == fixture["generatorSha256"]

    report = audio_model_report()
    assert report["available"] is True, report
    assert report["offline"] is True
    assert report["packVersion"] == AUDIO_PACK_VERSION
    assert len(report["artifacts"]) == 9
    assert all(row["valid"] and row["sha256"] == row["expectedSha256"] for row in report["artifacts"])
    assert report["privacy"] == {
        "networkAtInference": False,
        "speakerIdentification": False,
        "speakerDiarization": False,
        "storesRawAudio": False,
    }


def test_preprocessing_and_bounded_chunking() -> None:
    mel = np.load(ROOT / "models" / "audio" / "yamnet-mel-weights.npy", allow_pickle=False)
    patches = yamnet_log_mel_patches(np.zeros(16_000, dtype=np.float32), mel)
    assert patches.shape == (2, 96, 64)
    assert patches.dtype == np.float32 and np.isfinite(patches).all()
    broken = np.zeros(16_000, dtype=np.float32)
    broken[4] = np.nan
    try:
        yamnet_log_mel_patches(broken, mel)
    except ValueError as exc:
        assert "non-finite" in str(exc)
    else:
        raise AssertionError("non-finite waveforms must be rejected")

    with tempfile.TemporaryDirectory(prefix="vintrace-audio-chunks-") as tmp:
        source = Path(tmp) / "bounded.mp4"
        source.write_bytes(b"fixture")
        calls: list[tuple[int, int]] = []

        def loader(_path: Path, *, start_ms: int, duration_ms: int, sample_rate: int) -> np.ndarray:
            calls.append((start_ms, duration_ms))
            return np.zeros(duration_ms * sample_rate // 1000, dtype=np.float32)

        def transcript(_waveform: np.ndarray, *, offset_ms: int, language: str) -> tuple[list[AudioSegment], str]:
            return [AudioSegment("speech", offset_ms, offset_ms + 100, offset_ms, text="chunk", language="en", model="test", model_version="1")], "en"

        def events(_waveform: np.ndarray, *, offset_ms: int) -> list[AudioSegment]:
            return [AudioSegment("sound", offset_ms, offset_ms + 100, offset_ms, label="Bell", confidence=0.9, model="test", model_version="1")]

        result = analyze_media_audio(
            source,
            duration_ms=130_000,
            max_duration_seconds=125,
            waveform_loader=loader,
            transcript_engine=transcript,
            event_engine=events,
        )
        assert calls == [(0, 60_000), (60_000, 60_000), (120_000, 5_000)]
        assert result["durationMs"] == 125_000
        assert result["truncated"] is True
        assert len(result["transcriptSegments"]) == 3
        assert len(result["soundEventSegments"]) == 3


def test_real_asr_and_sound_events_are_offline() -> None:
    manifest = json.loads(FIXTURE_MANIFEST.read_text(encoding="utf-8"))
    speech_fixture, chime_fixture = manifest["fixtures"]
    outbound_attempts: list[str] = []
    original_connect = socket.socket.connect
    original_create_connection = socket.create_connection

    def blocked_connect(_sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"unexpected outbound audio inference connection: {address!r}")

    def blocked_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"unexpected outbound audio inference connection: {address!r}")

    socket.socket.connect = blocked_connect
    socket.create_connection = blocked_create_connection
    try:
        speech = _waveform(ROOT / speech_fixture["path"])
        transcript_segments, language = transcribe_waveform(speech, language="auto")
        transcript = " ".join(segment.text for segment in transcript_segments)
        assert language == "en", (language, transcript)
        assert _word_error_rate(speech_fixture["expectedTranscript"], transcript) <= 0.25, transcript
        assert all(word in _normalized_words(transcript) for word in speech_fixture["requiredWords"]), transcript
        assert transcript_segments and transcript_segments[0].start_ms < 1_500
        assert transcript_segments[-1].end_ms <= speech_fixture["durationMs"] + 100
        speech_events = classify_sound_events(speech)
        assert any(event.label == speech_fixture["expectedSoundEvent"] for event in speech_events), speech_events

        chime_events = classify_sound_events(_waveform(ROOT / chime_fixture["path"]))
        matching = [event for event in chime_events if event.label == chime_fixture["expectedSoundEvent"]]
        assert matching, chime_events
        assert max(float(event.confidence or 0.0) for event in matching) >= chime_fixture["minimumConfidence"]
        assert not outbound_attempts
    finally:
        socket.socket.connect = original_connect
        socket.create_connection = original_create_connection


def test_api_persistence_search_invalidation_and_no_audio_state() -> None:
    original_analyze = api_server_module.analyze_media_audio
    analysis_calls = 0

    def fake_analysis(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        nonlocal analysis_calls
        analysis_calls += 1
        speech = AudioSegment(
            "speech", 250, 1_750, 250, text="Blue lantern meeting tonight", confidence=0.91,
            language="en", model="fake-whisper", model_version="1",
        )
        sound = AudioSegment(
            "sound", 2_000, 3_000, 2_000, label="Doorbell", confidence=0.88,
            model="fake-yamnet", model_version="1",
        )
        return {
            "indexVersion": AUDIO_INDEX_VERSION,
            "packVersion": AUDIO_PACK_VERSION,
            "durationMs": 4_000,
            "truncated": False,
            "language": "en",
            "transcriptSegments": [speech],
            "soundEventSegments": [sound],
            "segments": [speech, sound],
        }

    api_server_module.analyze_media_audio = fake_analysis
    try:
        with tempfile.TemporaryDirectory(prefix="vintrace-audio-api-") as tmp:
            root = Path(tmp)
            source = root / "meeting.mp4"
            source.write_bytes(bytes(index % 251 for index in range(200_000)))
            api = _api(root)
            asset_id = _insert_video(api, source)

            indexed = api.index_photo_audio({"sourcePaths": [str(source)], "ignoreSettings": True, "audioBudgetLimit": 1})
            assert indexed["progress"]["updated"] == 1, indexed
            assert indexed["segmentsUpdated"] == 2, indexed
            assert analysis_calls == 1
            cached = api.index_photo_audio({"sourcePaths": [str(source)], "ignoreSettings": True, "audioBudgetLimit": 1})
            assert cached["progress"]["skipped"] == 1, cached
            assert analysis_calls == 1

            timeline = api.photo_audio_segments({"assetId": asset_id})
            assert timeline["total"] == 2
            assert timeline["transcriptSegments"][0]["timestampMs"] == 250
            search = api.search_photo_library({"query": "blue lantern", "limit": 5, "previewBudget": 0})
            photos = next(group for group in search["groups"] if group["id"] == "photos")
            hit = photos["items"][0]
            assert hit["resultKind"] == "audioSegment", hit
            assert hit["timestampMs"] == 250, hit
            assert hit["snippet"].startswith("Transcript:"), hit

            reopened = _api(root)
            persisted = reopened.photo_audio_segments({"assetId": asset_id})
            assert [row["segmentId"] for row in persisted["segments"]] == [row["segmentId"] for row in timeline["segments"]]
            original_stat = source.stat()
            source.write_bytes(bytes((index * 13) % 251 for index in range(200_000)))
            os.utime(source, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            refreshed = reopened.index_photo_audio({"sourcePaths": [str(source)], "ignoreSettings": True, "audioBudgetLimit": 1})
            assert refreshed["progress"]["updated"] == 1, refreshed
            assert analysis_calls == 2
            changed = reopened.photo_audio_segments({"assetId": asset_id})
            assert changed["segments"][0]["segmentId"] != timeline["segments"][0]["segmentId"]

            silent = root / "silent.mp4"
            silent.write_bytes(b"not-a-real-video")
            silent_asset_id = _insert_video(reopened, silent)

            def no_audio(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
                nonlocal analysis_calls
                analysis_calls += 1
                raise RuntimeError("No decodable audio stream was found in this media file.")

            api_server_module.analyze_media_audio = no_audio
            first_silent = reopened.index_photo_audio({"sourcePaths": [str(silent)], "ignoreSettings": True})
            assert first_silent["noAudioCount"] == 1, first_silent
            calls_after_silent = analysis_calls
            second_silent = reopened.index_photo_audio({"sourcePaths": [str(silent)], "ignoreSettings": True})
            assert second_silent["progress"]["skipped"] == 1, second_silent
            assert analysis_calls == calls_after_silent
            assert reopened.photo_audio_segments({"assetId": silent_asset_id})["total"] == 0
    finally:
        api_server_module.analyze_media_audio = original_analyze


def test_status_always_hashes_and_scheduler_defers_heavy_audio() -> None:
    original_report = api_server_module.audio_model_report
    verify_calls: list[bool] = []

    def fake_report(*, verify_hashes: bool = True) -> dict[str, Any]:
        verify_calls.append(verify_hashes)
        return {"available": True, "offline": True}

    api_server_module.audio_model_report = fake_report
    try:
        with tempfile.TemporaryDirectory(prefix="vintrace-audio-queue-") as tmp:
            api = _api(Path(tmp))
            status = api.photo_audio_status({"skipHashes": True})
            assert status["available"] is True
            assert verify_calls == [True]
            queued = api.enqueue_photo_indexing_job({"jobKind": "audio", "scope": {"allPhotos": True}})
            job_id = queued["job"]["jobId"]
            result = api.run_photo_indexing_queue({
                "maxCostClass": "medium",
                "runtimeState": {"thermalState": "fair", "maxCostClass": "medium"},
                "ignoreSettings": True,
            })
            assert result["ran"] == 0, result
            assert result["stoppedReason"] == "cost-limit", result
            assert result["costDeferredCount"] == 1, result
            assert result["runtimeState"]["thermalState"] == "fair"
            assert api.project.db.photo_indexing_job(job_id)["status"] == "queued"
    finally:
        api_server_module.audio_model_report = original_report


def main() -> None:
    test_fixture_and_model_pack_integrity()
    test_preprocessing_and_bounded_chunking()
    test_real_asr_and_sound_events_are_offline()
    test_api_persistence_search_invalidation_and_no_audio_state()
    test_status_always_hashes_and_scheduler_defers_heavy_audio()
    print("all audio_intelligence_units tests passed")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Unit coverage for timestamped semantic retrieval into video segments."""

from __future__ import annotations

import os
import json
from pathlib import Path
import tempfile
from typing import Any

import numpy as np
from PIL import Image

from crossage_fr.embed import siglip_engine
from crossage_fr.ingest.video_io import VideoFrameSample
from crossage_fr import api_server as api_server_module
from crossage_fr.store import workspace_db as workspace_db_module
from crossage_fr.video_semantic import build_video_visual_segments, video_source_fingerprint


def _frame(path: Path, color: tuple[int, int, int]) -> None:
    Image.new("RGB", (48, 32), color).save(path, format="JPEG", quality=95)


def _samples(root: Path) -> list[VideoFrameSample]:
    colors = [(230, 20, 20), (220, 30, 30), (20, 30, 230), (30, 40, 220)]
    rows: list[VideoFrameSample] = []
    for index, color in enumerate(colors):
        path = root / f"sample-{index}.jpg"
        _frame(path, color)
        rows.append(
            VideoFrameSample(
                path=path,
                timestamp_ms=index * 2_000,
                frame_index=index * 60,
                width=48,
                height=32,
                duration_ms=8_000,
            )
        )
    return rows


def test_visual_segments_are_deterministic_and_cover_the_timeline() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        samples = _samples(Path(tmp))
        vectors = [[1.0, 0.0], [0.98, 0.02], [0.0, 1.0], [0.02, 0.98]]
        first = build_video_visual_segments(
            asset_id="asset-video",
            model_name="FakeSigLIP",
            source_fingerprint="a" * 64,
            samples=samples,
            vectors=vectors,
        )
        second = build_video_visual_segments(
            asset_id="asset-video",
            model_name="FakeSigLIP",
            source_fingerprint="a" * 64,
            samples=samples,
            vectors=vectors,
        )
        assert first == second
        assert len(first) == 2, first
        assert [(row.start_ms, row.end_ms) for row in first] == [(0, 3_000), (3_000, 8_000)], first
        assert first[0].timestamp_ms == 0
        assert first[1].timestamp_ms == 4_000
        assert first[0].end_ms == first[1].start_ms
        assert first[-1].end_ms == 8_000
        assert all(row.segment_id.startswith("vseg_") for row in first)


def test_video_source_fingerprint_detects_preserved_stat_tampering() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp) / "source.mp4"
        source.write_bytes(bytes((index % 251 for index in range(900_000))))
        stat = source.stat()
        before = video_source_fingerprint(source)
        with source.open("r+b") as handle:
            handle.seek(128)
            handle.write(b"changed-without-size-drift")
        os.utime(source, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        after = video_source_fingerprint(source)
        assert source.stat().st_size == stat.st_size
        assert source.stat().st_mtime_ns == stat.st_mtime_ns
        assert after != before


def test_video_segments_index_search_persist_and_invalidate() -> None:
    import sys

    sys.path.insert(0, "tests")
    from photo_folders_units import _api

    original_report = siglip_engine.semantic_model_report
    original_text = siglip_engine.encode_text
    original_images = siglip_engine.encode_images
    original_sampler = api_server_module.sample_video_frames
    original_probe = workspace_db_module.probe_video
    sampler_calls = 0
    encoder_calls = 0

    def fake_report() -> dict[str, Any]:
        return {"available": True, "engine": "fake", "modelName": "FakeSigLIP-video-v1"}

    def fake_text(query: str) -> np.ndarray:
        return np.asarray([0.0, 1.0, 0.0] if "blue" in query.lower() else [1.0, 0.0, 0.0], dtype=np.float32)

    def fake_images(images: list[Image.Image]) -> np.ndarray:
        nonlocal encoder_calls
        encoder_calls += 1
        vectors = []
        for image in images:
            red, _green, blue = image.convert("RGB").resize((1, 1)).getpixel((0, 0))
            vectors.append([1.0, 0.0, 0.0] if red > blue else [0.0, 1.0, 0.0])
        return np.asarray(vectors, dtype=np.float32)

    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        video = root / "two-scenes.mp4"
        video.write_bytes(bytes((index * 17) % 251 for index in range(750_000)))
        samples = _samples(root)

        def fake_sampler(*_args: Any, **_kwargs: Any) -> list[VideoFrameSample]:
            nonlocal sampler_calls
            sampler_calls += 1
            return list(samples)

        siglip_engine.semantic_model_report = fake_report  # type: ignore[assignment]
        siglip_engine.encode_text = fake_text  # type: ignore[assignment]
        siglip_engine.encode_images = fake_images  # type: ignore[assignment]
        api_server_module.sample_video_frames = fake_sampler  # type: ignore[assignment]
        workspace_db_module.probe_video = lambda path: {  # type: ignore[assignment]
            "path": str(path),
            "exists": True,
            "readable": True,
            "width": 48,
            "height": 32,
            "durationMs": 8_000,
            "backend": "fake",
        }
        try:
            api = _api(tmp)
            with api.project.db.connect() as conn:
                asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
                    conn,
                    source_path=str(video),
                    media_kind="video",
                    mime_type="video/mp4",
                    width=48,
                    height=32,
                    duration_ms=8_000,
                    metadata={"video": {"durationMs": 8_000}},
                )

            cold = api.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "autoQueue": True}
            )
            assert cold["results"] == [], cold
            assert cold["missingVideoAssets"] == 1, cold
            assert cold["queued"] is True, cold
            queued_job_id = str(cold["queuedJob"].get("jobId", ""))
            assert queued_job_id, cold
            queued = api.run_photo_indexing_job({"jobId": queued_job_id, "ignoreSettings": True})
            assert queued["job"]["status"] == "completed", queued
            indexed = queued["job"]["result"]
            assert indexed["progress"]["updated"] == 1, indexed
            assert indexed["videoSegments"]["segmentsUpdated"] == 2, indexed
            assert indexed["videoVectorIndex"]["ready"] is True, indexed
            assert str(root) not in json.dumps(indexed["videoVectorIndex"], sort_keys=True), indexed
            assert sampler_calls == 1
            assert encoder_calls == 1

            first = api.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "queueMissing": False}
            )
            assert first["available"] is True, first
            assert first["imageCandidateCount"] == 0, first
            assert first["videoCandidateCount"] == 1, first
            assert first["scoredVideoSegments"] == 2, first
            assert first["missingVideoAssets"] == 0, first
            assert first["results"][0]["resultKind"] == "videoSegment", first
            assert first["results"][0]["sourcePath"] == str(video), first
            assert first["results"][0]["timestampMs"] == 4_000, first
            assert first["results"][0]["startMs"] == 3_000, first
            assert first["results"][0]["endMs"] == 8_000, first
            assert Path(first["items"][0]["previewPath"]).resolve() == samples[2].path.resolve(), first
            first_segment_id = first["results"][0]["segmentId"]

            reopened = _api(tmp)
            persisted = reopened.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "queueMissing": False}
            )
            assert persisted["results"][0]["segmentId"] == first_segment_id, persisted
            assert persisted["videoIndex"]["loadedFromDisk"] is True, persisted
            assert sampler_calls == 1
            assert encoder_calls == 1

            original_stat = video.stat()
            video.write_bytes(bytes((index * 29) % 251 for index in range(750_000)))
            os.utime(video, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            assert video.stat().st_size == original_stat.st_size
            assert video.stat().st_mtime_ns == original_stat.st_mtime_ns
            stale = reopened.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "queueMissing": False}
            )
            assert stale["results"] == [], stale
            assert stale["missingVideoAssets"] == 1, stale

            refreshed = reopened.index_photo_semantic_embeddings(
                {
                    "sourcePaths": [str(video)],
                    "ignoreSettings": True,
                    "videoBudgetLimit": 2,
                    "videoMaxFrames": 8,
                    "rebuildVectorIndex": True,
                }
            )
            assert refreshed["videoSegments"]["progress"]["updated"] == 1, refreshed
            current = reopened.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "queueMissing": False}
            )
            assert current["results"], current
            assert current["results"][0]["segmentId"] != first_segment_id, current

            reopened.project.db.update_photo_asset_metadata(asset_id=asset_id, hidden=True)
            hidden = reopened.semantic_search_photos(
                {"query": "blue scene", "limit": 5, "sourcePaths": [str(video)], "queueMissing": False}
            )
            assert hidden["candidateCount"] == 0, hidden
            assert hidden["results"] == [], hidden
        finally:
            siglip_engine.semantic_model_report = original_report  # type: ignore[assignment]
            siglip_engine.encode_text = original_text  # type: ignore[assignment]
            siglip_engine.encode_images = original_images  # type: ignore[assignment]
            api_server_module.sample_video_frames = original_sampler  # type: ignore[assignment]
            workspace_db_module.probe_video = original_probe  # type: ignore[assignment]


if __name__ == "__main__":
    test_visual_segments_are_deterministic_and_cover_the_timeline()
    test_video_source_fingerprint_detects_preserved_stat_tampering()
    test_video_segments_index_search_persist_and_invalidate()
    print("all video_semantic_search_units tests passed")

from __future__ import annotations

import csv
import os
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import crossage_fr.enroll.manager as manager_module
from crossage_fr.api_server import DesktopApi
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.video_io import VideoFrameSample
from crossage_fr.match.video_tracks import (
    VIDEO_TRACK_TEMPLATE_VERSION,
    VideoFaceObservation,
    build_video_track_templates,
)
from crossage_fr.models import EmbeddingResult, ReferenceFace


def unit(index: int, secondary: tuple[int, float] | None = None) -> list[float]:
    vector = np.zeros(512, dtype=np.float32)
    vector[index] = 1.0
    if secondary is not None:
        vector[secondary[0]] = secondary[1]
    vector /= np.linalg.norm(vector)
    return vector.astype(float).tolist()


def observation(
    name: str,
    timestamp_ms: int,
    vector: list[float],
    bbox: tuple[int, int, int, int],
    *,
    model: str = "test-face-model",
    quality: float = 0.8,
    sharpness: float = 100.0,
) -> VideoFaceObservation:
    return VideoFaceObservation(
        frame_path=Path(f"/{name}-{timestamp_ms}.jpg"),
        timestamp_ms=timestamp_ms,
        frame_index=timestamp_ms // 40,
        duration_ms=30_000,
        frame_width=200,
        frame_height=120,
        embedding=EmbeddingResult(
            vector=vector,
            quality=quality,
            bbox=bbox,
            model_name=model,
            pose_bucket="frontal",
            ied_px=36.0,
            fiqa_score=quality,
        ),
        sharpness=sharpness,
    )


def test_tracks_are_identity_separated_order_invariant_and_deterministic() -> None:
    rows: list[VideoFaceObservation] = []
    for timestamp in (0, 2_000, 4_000):
        rows.extend(
            (
                observation("alice", timestamp, unit(0, (2, timestamp / 100_000)), (10 + timestamp // 1000, 15, 70, 95)),
                observation("bob", timestamp, unit(1, (3, timestamp / 100_000)), (125 - timestamp // 1000, 18, 185, 98)),
            )
        )
    first = build_video_track_templates(rows, source_key="/clip.mp4")
    second = build_video_track_templates(list(reversed(rows)), source_key="/clip.mp4")
    assert len(first) == 2
    assert [track.track_id for track in first] == [track.track_id for track in second]
    assert sorted(len(track.observations) for track in first) == [3, 3]
    directions = sorted(int(np.argmax(np.asarray(track.vector)[:4])) for track in first)
    assert directions == [0, 1], directions
    assert all(abs(float(np.linalg.norm(track.vector)) - 1.0) < 1e-6 for track in first)


def test_track_gap_model_isolation_and_quality_keyframes() -> None:
    same_person = [
        observation("near-a", 0, unit(0), (20, 20, 90, 100), quality=0.4, sharpness=4.0),
        observation("near-b", 2_000, unit(0, (2, 0.02)), (22, 20, 92, 100), quality=0.95, sharpness=500.0),
        observation("late-a", 20_000, unit(0, (2, 0.01)), (20, 20, 90, 100), quality=0.7, sharpness=50.0),
        observation("late-b", 22_000, unit(0), (21, 20, 91, 100), quality=0.8, sharpness=100.0),
    ]
    other_model = observation("other-model", 2_000, unit(0), (22, 20, 92, 100), model="other-model")
    tracks = build_video_track_templates([*same_person, other_model], source_key="/gap.mp4")
    assert sorted(len(track.observations) for track in tracks) == [1, 2, 2]
    pooled_tracks = [track for track in tracks if len(track.observations) == 2]
    assert pooled_tracks[0].representative.embedding.quality >= 0.8
    assert all(1 <= len(track.keyframes) <= 5 for track in tracks)
    assert all(track.template_version == VIDEO_TRACK_TEMPLATE_VERSION for track in tracks)


def test_keyframe_limit_retains_the_strongest_diverse_observations() -> None:
    rows = [
        observation(
            f"quality-{index}",
            index * 1_000,
            unit(0, (2, index / 1_000)),
            (20 + index, 20, 90 + index, 100),
            quality=0.2 + index * 0.09,
            sharpness=2.0 + index * 80.0,
        )
        for index in range(8)
    ]
    tracks = build_video_track_templates(rows, source_key="/quality.mp4")
    assert len(tracks) == 1
    track = tracks[0]
    assert len(track.observations) == 8
    assert len(track.keyframes) == 5
    selected = {item.timestamp_ms for item in track.keyframes}
    assert 7_000 in selected
    assert 0 not in selected
    assert track.representative.timestamp_ms == 7_000


class FakeVideoEngine:
    model_name = "test-face-model"
    detector_size = 640

    def embed_loaded_image(self, _image: Image.Image, path: Path | None = None) -> list[EmbeddingResult]:
        assert path is not None
        timestamp = int(path.stem.split("-")[-1])
        quality = 0.92 if timestamp in {2_000, 22_000} else 0.62
        return [
            EmbeddingResult(
                vector=unit(0, (2, (timestamp % 20_000) / 1_000_000)),
                quality=quality,
                bbox=(24, 18, 104, 112),
                model_name=self.model_name,
                pose_bucket="frontal",
                quality_norm=0.7,
                det_score=0.98,
                ied_px=42.0,
                fiqa_score=quality,
                align_error=0.02,
            )
        ]

    def embed_image(self, path: Path) -> list[EmbeddingResult]:
        return self.embed_loaded_image(Image.open(path), path)


def _write_frame(path: Path, timestamp: int) -> None:
    image = Image.new("RGB", (128, 128), (40 + timestamp // 1_000 % 120, 70, 100))
    draw = ImageDraw.Draw(image)
    step = 4 if timestamp in {2_000, 22_000} else 16
    for x in range(0, 128, step):
        draw.line((x, 0, 127 - x, 127), fill=(255, 255, 255), width=1)
    image.save(path, format="JPEG", quality=92)


def test_project_video_scan_routes_pooled_tracks_through_production_matcher() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-video-track-") as temp_name:
        root = Path(temp_name)
        os.environ["VINTRACE_REGISTRY_HOME"] = str(root / "registry")
        os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
        project = ProjectState(root / "workspace")
        project.config.safe_mode = False
        project.config.two_pass_scan = False
        project.set_consent(True, source="unit", operator="unit", scope="video-track")
        reference = ReferenceFace(
            ref_id="ref-alice",
            person_name="Alice",
            age_bucket="adult",
            source_path=str(root / "alice-reference.jpg"),
            capture_date=None,
            quality=0.9,
            model_name="test-face-model",
            vector=unit(0),
        )
        project.references[reference.ref_id] = reference
        project.vector_store.add(reference.ref_id, reference.vector)

        video = root / "two-scenes.mp4"
        video.write_bytes(b"unit video placeholder")
        sample_dir = project.video_frames_path / "unit-samples"
        sample_dir.mkdir(parents=True, exist_ok=True)
        samples: list[VideoFrameSample] = []
        for timestamp in (0, 2_000, 20_000, 22_000):
            frame = sample_dir / f"frame-{timestamp}.jpg"
            _write_frame(frame, timestamp)
            samples.append(VideoFrameSample(frame, timestamp, timestamp // 40, 128, 128, 30_000))

        original_sampler = manager_module.sample_video_frames
        manager_module.sample_video_frames = lambda *_args, **_kwargs: list(samples)
        try:
            added, errors, metrics = project.scan_paths(
                [video],
                FakeVideoEngine(),
                source="video-track-unit",
                label="video track unit",
                resume=False,
            )
        finally:
            manager_module.sample_video_frames = original_sampler

        assert errors == []
        assert added == 2, (added, metrics)
        assert metrics["videoFrames"] == 4
        assert metrics["videoTrackObservations"] == 4
        assert metrics["videoTracks"] == 2
        assert metrics["videoTrackTemplates"] == 2
        assert metrics["videoTrackSingletons"] == 0
        assert metrics["videoTrackKeyframes"] == 4
        assert metrics["videoTrackMatches"] == 2
        candidates = sorted(project.candidates.values(), key=lambda candidate: candidate.video_track_start_ms or 0)
        assert len(candidates) == 2
        assert len({candidate.video_track_id for candidate in candidates}) == 2
        assert len({candidate.source_path for candidate in candidates}) == 2
        for candidate, expected_start in zip(candidates, (0, 20_000)):
            assert candidate.person_name == "Alice"
            assert candidate.video_track_version == VIDEO_TRACK_TEMPLATE_VERSION
            assert candidate.video_track_start_ms == expected_start
            assert candidate.video_track_end_ms == expected_start + 2_000
            assert candidate.video_track_frame_count == 2
            assert len(candidate.video_track_keyframe_indices) == 2
            assert "video-track-template" in candidate.risk_flags
            assert "pooled 2 quality keyframe" in candidate.note
            assert Path(candidate.source_path).exists()

        reloaded = ProjectState(project.root)
        restored = reloaded.ordered_review_candidates(limit=0)
        assert len(restored) == 2
        assert {candidate.video_track_id for candidate in restored} == {candidate.video_track_id for candidate in candidates}
        state_rows = DesktopApi(project.root).state()["candidates"]
        assert {row["videoTimestampMs"] for row in state_rows} == {2_000, 22_000}
        assert all(row["videoTrackId"] and row["videoTrackFrameCount"] == 2 for row in state_rows)
        report = reloaded.export_report(root / "exports")
        with Path(report["csvPath"]).open("r", encoding="utf-8", newline="") as handle:
            exported = list(csv.DictReader(handle))
        assert {row["video_track_version"] for row in exported} == {VIDEO_TRACK_TEMPLATE_VERSION}


def main() -> None:
    test_tracks_are_identity_separated_order_invariant_and_deterministic()
    test_track_gap_model_isolation_and_quality_keyframes()
    test_keyframe_limit_retains_the_strongest_diverse_observations()
    test_project_video_scan_routes_pooled_tracks_through_production_matcher()
    print("video track units ok")


if __name__ == "__main__":
    main()

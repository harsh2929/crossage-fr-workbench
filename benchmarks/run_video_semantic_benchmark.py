#!/usr/bin/env python3
"""Real-model, real-decoder benchmark for timestamped video semantic search."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import platform
import socket
import tempfile
from time import perf_counter
from typing import Any

import numpy as np

from crossage_fr.api_server import DesktopApi
from crossage_fr.embed import siglip_engine
from crossage_fr.ingest.image_io import sha256_file
from crossage_fr.ingest.video_io import probe_video
from crossage_fr.video_semantic import VIDEO_SEMANTIC_INDEX_VERSION


def create_fixture_video(path: Path) -> None:
    import cv2

    width = 256
    height = 256
    fps = 6.0
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not create the MP4 benchmark fixture.")
    scenes = [
        ("RED", (20, 20, 230)),
        ("BLUE", (230, 40, 20)),
        ("GREEN", (40, 210, 20)),
    ]
    try:
        for label, bgr in scenes:
            for frame_index in range(18):
                frame = np.full((height, width, 3), bgr, dtype=np.uint8)
                cv2.rectangle(frame, (28, 28), (228, 228), (245, 245, 245), 3)
                cv2.putText(frame, label, (52, 140), cv2.FONT_HERSHEY_SIMPLEX, 1.25, (245, 245, 245), 3, cv2.LINE_AA)
                cv2.circle(frame, (56 + frame_index * 7, 205), 10, (15, 15, 15), -1, cv2.LINE_AA)
                writer.write(frame)
    finally:
        writer.release()
    if not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError("Video benchmark fixture was not written.")


def compact_hit(result: dict[str, Any]) -> dict[str, Any]:
    hit = (result.get("results") or [{}])[0]
    return {
        "resultKind": hit.get("resultKind"),
        "segmentId": hit.get("segmentId"),
        "score": hit.get("score"),
        "startMs": hit.get("startMs"),
        "endMs": hit.get("endMs"),
        "timestampMs": hit.get("timestampMs"),
        "mediaKind": hit.get("mediaKind"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output or Path("benchmarks/results") / f"video-semantic-benchmark-{datetime.now().strftime('%Y%m%d')}.json"

    previous_force_fallback = os.environ.pop("CROSSAGE_FORCE_FALLBACK", None)
    previous_semantic_engine = os.environ.get("CROSSAGE_SEMANTIC_ENGINE")
    previous_registry = os.environ.get("VINTRACE_REGISTRY_HOME")
    original_detect_platform = siglip_engine.detect_platform
    original_socket_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def block_connect(_sock: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"Unexpected outbound connection during video semantic benchmark: {address!r}")

    def block_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError(f"Unexpected outbound connection during video semantic benchmark: {address!r}")

    os.environ["CROSSAGE_SEMANTIC_ENGINE"] = "auto"
    siglip_engine.detect_platform = lambda: "cpu"  # type: ignore[assignment]
    siglip_engine._reset_caches_for_test()  # noqa: SLF001
    socket.socket.connect = block_connect
    socket.create_connection = block_create_connection
    try:
        with tempfile.TemporaryDirectory(prefix="vintrace-video-semantic-benchmark-") as tmp:
            temp = Path(tmp)
            os.environ["VINTRACE_REGISTRY_HOME"] = str(temp / "registry")
            workspace = temp / "workspace"
            source = temp / "three-color-scenes.mp4"
            create_fixture_video(source)
            source_sha_before = sha256_file(source)
            decoder = probe_video(source)
            model = siglip_engine.semantic_model_report()
            api = DesktopApi(workspace)
            imported = api.import_photos({"sourcePaths": [str(source)], "storageMode": "referenced"})

            index_started = perf_counter()
            indexed = api.index_photo_semantic_embeddings(
                {
                    "sourcePaths": [str(source)],
                    "ignoreSettings": True,
                    "videoBudgetLimit": 1,
                    "videoMaxFrames": 16,
                    "videoSampleIntervalSeconds": 1.0,
                    "rebuildVectorIndex": True,
                }
            )
            index_wall_ms = round((perf_counter() - index_started) * 1000, 3)

            queries = {
                "red": "a solid red image",
                "blue": "a solid blue image",
                "green": "a solid green image",
            }
            search_results: dict[str, dict[str, Any]] = {}
            search_wall_ms: dict[str, float] = {}
            for label, query in queries.items():
                started = perf_counter()
                search_results[label] = api.semantic_search_photos(
                    {"query": query, "limit": 6, "sourcePaths": [str(source)], "queueMissing": False}
                )
                search_wall_ms[label] = round((perf_counter() - started) * 1000, 3)

            snapshot = api.project.db.video_semantic_index_snapshot(
                model_name=str(model.get("modelName", "") or ""),
                index_version=VIDEO_SEMANTIC_INDEX_VERSION,
            )
            timeline = [
                {
                    "segmentId": item.get("segmentId"),
                    "startMs": item.get("startMs"),
                    "endMs": item.get("endMs"),
                    "timestampMs": item.get("timestampMs"),
                    "sampleCount": item.get("sampleCount"),
                }
                for item in sorted(snapshot.get("items", []), key=lambda row: int(row.get("startMs", 0) or 0))
            ]
            reopened = DesktopApi(workspace)
            restarted = reopened.semantic_search_photos(
                {"query": queries["blue"], "limit": 6, "sourcePaths": [str(source)], "queueMissing": False}
            )
            source_sha_after = sha256_file(source)

            compact = {label: compact_hit(result) for label, result in search_results.items()}
            red_timestamp = int(compact["red"].get("timestampMs") or -1)
            blue_timestamp = int(compact["blue"].get("timestampMs") or -1)
            green_timestamp = int(compact["green"].get("timestampMs") or -1)
            checks = {
                "realModelAvailable": bool(model.get("available")) and model.get("engine") == "onnx",
                "realDecoderReadable": bool(decoder.get("readable")) and decoder.get("backend") in {"opencv", "ffmpeg"},
                "videoImported": int(imported.get("importedCount", 0) or 0) == 1,
                "videoIndexed": int(indexed.get("videoSegments", {}).get("progress", {}).get("updated", 0) or 0) == 1,
                "multipleVisualSegments": len(timeline) >= 3,
                "contiguousTimeline": bool(timeline) and int(timeline[0].get("startMs", -1)) == 0 and all(
                    int(left.get("endMs", -1)) == int(right.get("startMs", -2))
                    for left, right in zip(timeline, timeline[1:])
                ),
                "redTimestampRetrieved": 0 <= red_timestamp < 3_000,
                "blueTimestampRetrieved": 3_000 <= blue_timestamp < 6_000,
                "greenTimestampRetrieved": 6_000 <= green_timestamp <= 9_000,
                "allHitsAreTimestampedVideoSegments": all(
                    hit.get("resultKind") == "videoSegment"
                    and hit.get("mediaKind") == "video"
                    and isinstance(hit.get("segmentId"), str)
                    and isinstance(hit.get("timestampMs"), int)
                    for hit in compact.values()
                ),
                "persistentRestart": compact_hit(restarted).get("segmentId") == compact["blue"].get("segmentId"),
                "sidecarLoadedAfterRestart": restarted.get("videoIndex", {}).get("loadedFromDisk") is True,
                "noSourceMutation": source_sha_before == source_sha_after,
                "zeroOutbound": not outbound_attempts,
            }
            report = {
                "schemaVersion": 1,
                "benchmarkId": "vintrace-video-semantic-segments-v1",
                "indexVersion": VIDEO_SEMANTIC_INDEX_VERSION,
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "platform": platform.platform(),
                "python": platform.python_version(),
                "fixture": {
                    "name": source.name,
                    "sha256": source_sha_before,
                    "durationMs": decoder.get("durationMs"),
                    "decoderBackend": decoder.get("backend"),
                    "scenes": ["red 0-3s", "blue 3-6s", "green 6-9s"],
                },
                "model": {
                    "name": model.get("modelName"),
                    "engine": model.get("engine"),
                    "license": model.get("license"),
                    "source": model.get("source"),
                    "executionProvider": "CPUExecutionProvider",
                },
                "indexing": {
                    "wallMs": index_wall_ms,
                    "progress": indexed.get("videoSegments", {}).get("progress", {}),
                    "segmentsUpdated": indexed.get("videoSegments", {}).get("segmentsUpdated"),
                    "vectorIndex": indexed.get("videoVectorIndex", {}),
                    "timeline": timeline,
                },
                "search": {
                    "wallMs": search_wall_ms,
                    "topHits": compact,
                    "restartTopHit": compact_hit(restarted),
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
                "timing": {"indexWallMs": index_wall_ms, "searchWallMs": search_wall_ms},
                "topHits": compact,
                "checks": checks,
                "passed": report["passed"],
            }, indent=2, sort_keys=True))
            if not report["passed"]:
                raise SystemExit(1)
    finally:
        socket.socket.connect = original_socket_connect
        socket.create_connection = original_create_connection
        siglip_engine.detect_platform = original_detect_platform  # type: ignore[assignment]
        siglip_engine._reset_caches_for_test()  # noqa: SLF001
        if previous_force_fallback is not None:
            os.environ["CROSSAGE_FORCE_FALLBACK"] = previous_force_fallback
        if previous_semantic_engine is None:
            os.environ.pop("CROSSAGE_SEMANTIC_ENGINE", None)
        else:
            os.environ["CROSSAGE_SEMANTIC_ENGINE"] = previous_semantic_engine
        if previous_registry is None:
            os.environ.pop("VINTRACE_REGISTRY_HOME", None)
        else:
            os.environ["VINTRACE_REGISTRY_HOME"] = previous_registry


if __name__ == "__main__":
    main()

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

import numpy as np


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_fixture_video(path: Path) -> None:
    import cv2

    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 6.0, (256, 256))
    if not writer.isOpened():
        raise RuntimeError("OpenCV could not create the frozen video fixture.")
    try:
        for label, bgr in (("RED", (20, 20, 230)), ("BLUE", (230, 40, 20)), ("GREEN", (40, 210, 20))):
            for frame_index in range(18):
                frame = np.full((256, 256, 3), bgr, dtype=np.uint8)
                cv2.rectangle(frame, (28, 28), (228, 228), (245, 245, 245), 3)
                cv2.putText(frame, label, (52, 140), cv2.FONT_HERSHEY_SIMPLEX, 1.25, (245, 245, 245), 3, cv2.LINE_AA)
                cv2.circle(frame, (56 + frame_index * 7, 205), 10, (15, 15, 15), -1, cv2.LINE_AA)
                writer.write(frame)
    finally:
        writer.release()


def rpc_row(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") == request_id and "ok" in row:
            return row


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    row = rpc_row(process, request_id, command, params)
    if not row.get("ok"):
        raise AssertionError(row)
    result = row.get("result", {})
    return result if isinstance(result, dict) else {}


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update({
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
        "CROSSAGE_SEMANTIC_ENGINE": "auto",
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "NO_PROXY": "*",
        "no_proxy": "*",
        "HTTP_PROXY": "",
        "HTTPS_PROXY": "",
        "ALL_PROXY": "",
        "http_proxy": "",
        "https_proxy": "",
        "all_proxy": "",
    })
    env.pop("CROSSAGE_FORCE_FALLBACK", None)
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        env=env,
    )
    wait_ready(process)
    return process


def stop_backend(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_VIDEO_SEMANTIC_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_VIDEO_SEMANTIC_TEST_EXECUTABLE must point to the frozen backend.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-video-semantic-") as tmp_value:
        root = Path(tmp_value)
        workspace = root / "workspace"
        registry = root / "registry"
        source = root / "three-scenes.mp4"
        create_fixture_video(source)
        source_sha256 = sha256_file(source)

        process = start_backend(executable, workspace, registry)
        try:
            imported = rpc(
                process,
                "import",
                "import_photos",
                {"sourcePaths": [str(source)], "storageMode": "referenced", "sourceLabel": "Frozen video semantic acceptance"},
            ).get("value", {})
            assert imported.get("importedCount") == 1, imported

            cold = rpc(
                process,
                "cold-search",
                "semantic_search_photos",
                {"query": "a solid blue image", "limit": 6, "sourcePaths": [str(source)]},
            )
            assert cold.get("available") is True, cold
            assert cold.get("missingVideoAssets") == 1 and cold.get("queued") is True, cold
            job_id = str(cold.get("queuedJob", {}).get("jobId", ""))
            assert job_id, cold

            run = rpc(
                process,
                "run-index",
                "run_photo_indexing_job",
                {"jobId": job_id, "ignoreSettings": True},
            ).get("value", {})
            job = run.get("job", {})
            assert job.get("status") == "completed", run
            result = job.get("result", {})
            assert result.get("videoSegments", {}).get("progress", {}).get("updated") == 1, result
            assert int(result.get("videoSegments", {}).get("segmentsUpdated", 0) or 0) >= 3, result
            assert result.get("videoVectorIndex", {}).get("ready") is True, result

            indexed = rpc(
                process,
                "indexed-search",
                "semantic_search_photos",
                {"query": "a solid blue image", "limit": 6, "sourcePaths": [str(source)], "queueMissing": False},
            )
            top = indexed.get("results", [{}])[0]
            assert top.get("resultKind") == "videoSegment" and top.get("mediaKind") == "video", indexed
            assert 3_000 <= int(top.get("timestampMs", -1)) < 6_000, indexed
            assert top.get("segmentId") and int(top.get("endMs", 0)) > int(top.get("startMs", 0)), indexed
            segment_id = str(top["segmentId"])
            assert indexed.get("videoIndex", {}).get("persistent") is True, indexed
            assert sha256_file(source) == source_sha256
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            restarted = rpc(
                reopened,
                "restart-search",
                "semantic_search_photos",
                {"query": "a solid blue image", "limit": 6, "sourcePaths": [str(source)], "queueMissing": False},
            )
            restart_top = restarted.get("results", [{}])[0]
            assert restart_top.get("segmentId") == segment_id, restarted
            assert restarted.get("videoIndex", {}).get("loadedFromDisk") is True, restarted
            assert restarted.get("missingVideoAssets") == 0, restarted
            assert sha256_file(source) == source_sha256
        finally:
            stop_backend(reopened)

        print(json.dumps({
            "frozen": True,
            "semanticModelPackComplete": True,
            "realVideoDecoder": True,
            "timestampedRetrieval": True,
            "durableQueue": True,
            "restartPersistence": True,
            "noSourceMutation": True,
            "executableSha256": sha256_file(executable),
        }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

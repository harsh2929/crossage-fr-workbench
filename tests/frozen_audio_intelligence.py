"""Frozen-backend acceptance for offline audio intelligence and search."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[1]
SPEECH_FIXTURE = ROOT / "tests" / "fixtures" / "audio" / "blue-lantern.wav"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_fixture_video(path: Path) -> None:
    import imageio_ffmpeg

    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    command = [
        ffmpeg,
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "lavfi",
        "-i", "color=c=0x17324d:s=160x90:r=2:d=3",
        "-i", str(SPEECH_FIXTURE),
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-c:v", "mpeg4",
        "-q:v", "5",
        "-c:a", "aac",
        "-shortest",
        "-map_metadata", "-1",
        str(path),
    ]
    result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not path.is_file() or path.stat().st_size <= 0:
        raise RuntimeError(f"Could not create frozen audio fixture: {result.stderr[-1000:]}")


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


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update({
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
        "CROSSAGE_FORCE_FALLBACK": "1",
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
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def first_photo_hit(search: dict) -> dict:
    for group in search.get("groups", []):
        if group.get("id") == "photos" and group.get("items"):
            return group["items"][0]
    return {}


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_AUDIO_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_AUDIO_TEST_EXECUTABLE must point to the frozen backend.")
    if sha256_file(SPEECH_FIXTURE) != "0655ab6702963fa0ef86d5c2606ce1503c34515bc1bc437921116e1c43ffe8ca":
        raise SystemExit("The frozen audio speech fixture failed integrity validation.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-audio-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        source = root / "blue-lantern.mp4"
        create_fixture_video(source)
        source_sha256 = sha256_file(source)

        process = start_backend(executable, workspace, registry)
        try:
            status = rpc(process, "status", "photo_audio_status", {}).get("value", {})
            assert status.get("available") is True, status
            assert status.get("packVersion") == "2026-07-13.1", status
            assert status.get("indexVersion") == "vintrace-audio-v1", status
            assert status.get("asr", {}).get("runtimeVersion") == "1.5.0", status
            assert status.get("asr", {}).get("nativeModulePresent") is True, status
            assert status.get("soundEvents", {}).get("classCount") == 521, status
            assert len(status.get("artifacts", [])) == 9 and all(row.get("valid") for row in status["artifacts"]), status

            imported = rpc(process, "import", "import_photos", {
                "sourcePaths": [str(source)],
                "storageMode": "referenced",
                "sourceLabel": "Frozen audio intelligence acceptance",
            }).get("value", {})
            assert imported.get("importedCount") == 1, imported

            queued = rpc(process, "enqueue", "enqueue_photo_indexing_job", {
                "jobKind": "audio",
                "scope": {
                    "sourcePaths": [str(source)],
                    "ignoreSettings": True,
                    "audioBudgetLimit": 1,
                    "language": "auto",
                },
            }).get("value", {})
            job_id = str(queued.get("job", {}).get("jobId", ""))
            assert job_id and queued.get("job", {}).get("jobKind") == "audio", queued
            run = rpc(process, "run", "run_photo_indexing_queue", {
                "maxJobs": 1,
                "maxCostClass": "heavy",
                "ignoreSettings": True,
                "runtimeState": {"reason": "frozen-acceptance", "maxCostClass": "heavy"},
            }).get("value", {})
            assert run.get("ran") == 1 and run.get("maxCostClass") == "heavy", run
            job = run.get("jobsRun", [{}])[0]
            assert job.get("jobId") == job_id and job.get("status") == "completed", run
            result = job.get("result", {})
            assert result.get("progress", {}).get("updated") == 1, result
            assert int(result.get("segmentsUpdated", 0) or 0) >= 2, result

            search = rpc(process, "search", "search_photo_library", {
                "query": "blue lantern",
                "limit": 5,
                "previewBudget": 0,
            })
            hit = first_photo_hit(search)
            assert hit.get("resultKind") == "audioSegment", search
            assert hit.get("mediaKind") == "video" and int(hit.get("timestampMs", -1) or 0) >= 0, hit
            assert str(hit.get("snippet", "")).startswith("Transcript:"), hit
            asset_id = str(hit.get("assetId", ""))
            timeline = rpc(process, "timeline", "photo_audio_segments", {"assetId": asset_id}).get("value", {})
            assert timeline.get("transcriptSegments") and timeline.get("soundEventSegments"), timeline
            segment_ids = [row.get("segmentId") for row in timeline.get("segments", [])]
            assert all(segment_ids) and sha256_file(source) == source_sha256
            raw_sidecars = [
                path for path in workspace.rglob("*")
                if path.is_file() and path.suffix.lower() in {".wav", ".pcm", ".flac", ".mp3", ".m4a"}
            ]
            assert not raw_sidecars, raw_sidecars
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            jobs = rpc(reopened, "jobs", "photo_indexing_jobs", {}).get("value", {})
            completed = [row for row in jobs.get("jobs", []) if row.get("jobId") == job_id]
            assert completed and completed[0].get("status") == "completed", jobs
            persisted = rpc(reopened, "persisted", "photo_audio_segments", {"assetId": asset_id}).get("value", {})
            assert [row.get("segmentId") for row in persisted.get("segments", [])] == segment_ids, persisted
            restart_hit = first_photo_hit(rpc(reopened, "restart-search", "search_photo_library", {
                "query": "blue lantern",
                "limit": 5,
                "previewBudget": 0,
            }))
            assert restart_hit.get("assetId") == asset_id
            assert restart_hit.get("timestampMs") == hit.get("timestampMs")
            assert sha256_file(source) == source_sha256
        finally:
            stop_backend(reopened)

    print(json.dumps({
        "frozen": True,
        "modelPackIntegrity": True,
        "nativeWhisperRuntime": True,
        "realAudioDecode": True,
        "durableHeavyQueue": True,
        "timestampedSearch": True,
        "restartPersistence": True,
        "noRawAudioSidecars": True,
        "noSourceMutation": True,
        "executableSha256": sha256_file(executable),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from crossage_fr.api_server import DesktopApi
from crossage_fr.platform_detect import performance_profile
from crossage_fr.workspace_registry import now_iso


def seed_scan_manifest(api: DesktopApi, count: int) -> float:
    run_id = "scale-benchmark-run"
    api.project.db.create_scan_run(run_id, "synthetic 100k scale", "benchmark", "/synthetic", count)
    started = time.perf_counter()
    timestamp = now_iso()
    batch_size = 2000
    with api.project.db.connect() as conn:
        for start in range(0, count, batch_size):
            rows = []
            for index in range(start, min(start + batch_size, count)):
                path = f"/synthetic/library/photo-{index:07d}.jpg"
                rows.append((
                    run_id,
                    path,
                    path,
                    128_000 + (index % 1024),
                    1_700_000_000_000_000_000 + index,
                    "",
                    "completed",
                    "processed",
                    "",
                    "",
                    None,
                    timestamp,
                ))
            conn.executemany(
                """
                INSERT OR REPLACE INTO scan_files(
                    run_id, path, path_key, size, mtime_ns, content_hash, status, phase,
                    message, candidate_id, safety_score, processed_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        api.project.db.update_scan_run(
            run_id,
            {
                "total": count,
                "processed": count,
                "added": 0,
                "matched": 0,
                "clustered": 0,
                "skipped": 0,
                "errors": 0,
                "unmatched": 0,
                "safeFiltered": 0,
                "videoFiles": 0,
                "videoFrames": 0,
                "videoProtected": 0,
                "cancelled": 0,
            },
            "complete",
            "",
            conn,
        )
    return (time.perf_counter() - started) * 1000


def assert_low_and_high_profile_selection() -> None:
    with patch("crossage_fr.platform_detect.logical_cpu_count", return_value=4):
        with patch("crossage_fr.platform_detect.memory_total_bytes", return_value=4 * 1024 ** 3):
            tier, mode, _notes = performance_profile("cpu", ["CPUExecutionProvider"], ["CPUExecutionProvider"])
            assert tier == "low"
            assert mode == "fast"
    with patch("crossage_fr.platform_detect.logical_cpu_count", return_value=12):
        with patch("crossage_fr.platform_detect.memory_total_bytes", return_value=32 * 1024 ** 3):
            tier, mode, _notes = performance_profile("apple_silicon", ["CoreMLExecutionProvider", "CPUExecutionProvider"], [("CoreMLExecutionProvider", {})])
            assert tier == "high"
            assert mode == "quality"


def main() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    count = max(1, int(os.environ.get("VINTRACE_SCALE_BENCH_FILES", "100000")))
    root = Path(tempfile.mkdtemp(prefix="vintrace-scale-bench-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(root / "workspace")
    assert_low_and_high_profile_selection()
    seed_ms = seed_scan_manifest(api, count)
    state_started = time.perf_counter()
    state = api.state(preview_create_budget=0, candidate_limit=250)
    state_ms = (time.perf_counter() - state_started) * 1000
    benchmark = api.runtime_benchmark()
    assert state["scale"]["manifestFiles"] == count
    assert state["candidateWindow"]["limit"] == 250
    assert any("Large scan manifest" in item for item in benchmark["recommendations"]), benchmark["recommendations"]
    print(json.dumps({
        "files": count,
        "seedMs": round(seed_ms, 2),
        "stateMs": round(state_ms, 2),
        "benchmarkDurationMs": benchmark["durationMs"],
        "vectorBackend": benchmark["vectorBackend"],
        "performanceTier": benchmark.get("performanceTier"),
        "effectivePerformanceMode": benchmark.get("effectivePerformanceMode"),
        "resourceStatus": benchmark.get("resourceStatus", {}),
        "recommendations": benchmark["recommendations"],
    }, indent=2))


if __name__ == "__main__":
    main()

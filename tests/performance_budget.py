from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate
from crossage_fr.workspace_registry import now_iso


def env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def timed(fn: Callable[[], Any]) -> tuple[Any, float]:
    started = time.perf_counter()
    value = fn()
    return value, (time.perf_counter() - started) * 1000


def candidate(index: int) -> ReviewCandidate:
    status = "pending" if index % 5 else "accepted"
    media_kind = "video" if index % 17 == 0 else "image"
    return ReviewCandidate(
        candidate_id=f"perf_cand_{index:07d}",
        source_path=f"/synthetic/no-photo-used/library/photo-{index:07d}.jpg",
        person_name=f"Person {index % 37:02d}",
        best_ref_id=f"ref_{index % 37:02d}",
        best_ref_path=f"/synthetic/no-photo-used/refs/person-{index % 37:02d}.jpg",
        score=round(0.1 + (index % 900) / 1000, 4),
        band="synthetic",
        quality=round(0.35 + (index % 600) / 1000, 4),
        model_name="performance-budget-synthetic",
        status=status,
        note="needs review" if index % 29 == 0 else "",
        media_kind=media_kind,
        media_source_path=f"/synthetic/no-photo-used/videos/source-{index % 11:02d}.mp4" if media_kind == "video" else "",
        video_timestamp_ms=index * 40 if media_kind == "video" else None,
        video_frame_index=index if media_kind == "video" else None,
        video_duration_ms=180_000 if media_kind == "video" else None,
        source_hash=f"hash-{index:07d}",
    )


def seed_candidates(api: DesktopApi, count: int) -> float:
    started = time.perf_counter()
    batch_size = 2000
    for start in range(0, count, batch_size):
        batch = [candidate(index) for index in range(start, min(start + batch_size, count))]
        api.project.db.upsert_candidates(batch)
    return (time.perf_counter() - started) * 1000


def seed_scan_manifest(api: DesktopApi, count: int) -> float:
    run_id = "performance-budget-scan"
    api.project.db.create_scan_run(run_id, "synthetic performance budget", "benchmark", "/synthetic", count)
    timestamp = now_iso()
    started = time.perf_counter()
    batch_size = 2500
    with api.project.db.connect() as conn:
        for start in range(0, count, batch_size):
            rows = []
            for index in range(start, min(start + batch_size, count)):
                path = f"/synthetic/no-photo-used/scan/photo-{index:07d}.jpg"
                rows.append((
                    run_id,
                    path,
                    path,
                    128_000 + (index % 4096),
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


def budget(name: str, default_ms: float) -> float:
    env_name = f"VINTRACE_BUDGET_{name.upper()}_MS"
    try:
        return float(os.environ.get(env_name, str(default_ms)))
    except ValueError:
        return default_ms


def main() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    candidate_count = env_int("VINTRACE_PERF_BUDGET_CANDIDATES", 30_000)
    manifest_count = env_int("VINTRACE_PERF_BUDGET_SCAN_FILES", 100_000)
    root = Path(tempfile.mkdtemp(prefix="vintrace-performance-budget-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")

    api, startup_ms = timed(lambda: DesktopApi(root / "workspace", actor="performance-budget"))
    seed_candidate_ms = seed_candidates(api, candidate_count)
    state, dashboard_state_ms = timed(lambda: api.state(preview_create_budget=0, candidate_limit=500))
    _encoded, serialize_ms = timed(lambda: json.dumps(state, separators=(",", ":")))
    page_times = []
    for offset in [0, 250, 1_000, 5_000, max(candidate_count - 500, 0)]:
        _page, elapsed = timed(lambda offset=offset: api.handle("query_candidates", {"status": "all", "sort": "score", "offset": offset, "limit": 250, "previewBudget": 0}))
        page_times.append(elapsed)
    _preview_state, preview_window_ms = timed(lambda: api.state(preview_create_budget=8, candidate_limit=250))
    seed_manifest_ms = seed_scan_manifest(api, manifest_count)
    _scan_state, scan_manifest_state_ms = timed(lambda: api.state(preview_create_budget=0, candidate_limit=250))
    runtime, runtime_benchmark_ms = timed(api.runtime_benchmark)
    sorted_page_times = sorted(page_times)
    p95_index = min(len(sorted_page_times) - 1, int(round((len(sorted_page_times) - 1) * 0.95)))

    metrics = {
        "startupMs": round(startup_ms, 2),
        "seedCandidateMs": round(seed_candidate_ms, 2),
        "dashboardStateMs": round(dashboard_state_ms, 2),
        "largeStateSerializeMs": round(serialize_ms, 2),
        "reviewPaginationP95Ms": round(sorted_page_times[p95_index], 2),
        "reviewPaginationMaxMs": round(max(page_times), 2),
        "previewWindowStateMs": round(preview_window_ms, 2),
        "seedScanManifestMs": round(seed_manifest_ms, 2),
        "scanManifestStateMs": round(scan_manifest_state_ms, 2),
        "runtimeBenchmarkMs": round(runtime_benchmark_ms, 2),
        "vectorAddPerSecond": runtime.get("vectorAddPerSecond"),
        "stateCandidateWindow": runtime.get("stateCandidateWindow", {}),
    }
    budgets = {
        "startupMs": budget("startup", 1500),
        "dashboardStateMs": budget("dashboard_state", 2000),
        "largeStateSerializeMs": budget("large_state_serialize", 650),
        "reviewPaginationP95Ms": budget("review_pagination_p95", 500),
        "previewWindowStateMs": budget("preview_window_state", 2200),
        "scanManifestStateMs": budget("scan_manifest_state", 2500),
        "runtimeBenchmarkMs": budget("runtime_benchmark", 6000),
    }
    checks = [
        {"name": name, "ok": metrics[name] <= limit, "valueMs": metrics[name], "budgetMs": limit}
        for name, limit in budgets.items()
    ]
    checks.append({"name": "candidate window is paged", "ok": state["candidateWindow"]["truncated"] is True, "value": state["candidateWindow"]})
    checks.append({"name": "candidate index is sqlite", "ok": state["candidateWindow"]["index"] == "sqlite", "value": state["candidateWindow"]})
    checks.append({"name": "scan manifest scale", "ok": scan_manifest_state_ms <= budgets["scanManifestStateMs"] and manifest_count >= 100_000, "value": manifest_count})

    result = {
        "generatedAt": now_iso(),
        "ok": all(check["ok"] for check in checks),
        "candidateCount": candidate_count,
        "scanManifestFiles": manifest_count,
        "metrics": metrics,
        "budgets": budgets,
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

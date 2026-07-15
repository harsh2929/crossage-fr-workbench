from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from crossage_fr.agent_images import AgentImageService
from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate
from crossage_fr.workspace_registry import now_iso


def env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def budget(name: str, default_ms: float) -> float:
    env_name = f"VINTRACE_BUDGET_{name.upper()}_MS"
    try:
        return float(os.environ.get(env_name, str(default_ms)))
    except ValueError:
        return default_ms


def timed(fn: Callable[[], Any]) -> tuple[Any, float]:
    started = time.perf_counter()
    value = fn()
    return value, (time.perf_counter() - started) * 1000


def synthetic_photo_path(index: int) -> str:
    media_kind = "video" if index % 23 == 0 else ("screenshot" if index % 31 == 0 else "image")
    suffix = ".mov" if media_kind == "video" else (".png" if media_kind == "screenshot" else ".jpg")
    filename = f"photo-{index:07d}{suffix}"
    if media_kind == "screenshot":
        filename = f"Screenshot {index:07d}{suffix}"
    return f"/synthetic/no-photo-used/photos/{2024 + (index % 3)}/{(index % 12) + 1:02d}/{filename}"


def seed_photo_library(api: DesktopApi, count: int) -> float:
    timestamp = now_iso()
    started = time.perf_counter()
    batch_size = 2500
    with api.project.db.connect() as conn:
        for start in range(0, count, batch_size):
            asset_rows = []
            metadata_rows = []
            for index in range(start, min(start + batch_size, count)):
                media_kind = "video" if index % 23 == 0 else ("screenshot" if index % 31 == 0 else "image")
                color_label = ("", "red", "yellow", "green", "blue", "purple")[(index // 6) % 6]
                pick_status = ("", "pick", "reject")[(index // 36) % 3]
                path = synthetic_photo_path(index)
                capture_date = f"{2024 + (index % 3)}-{(index % 12) + 1:02d}-{(index % 28) + 1:02d}T12:00:00Z"
                title = f"Summer frame {index:07d}" if index % 50 == 0 else f"Frame {index:07d}"
                asset_rows.append((
                    f"photo_scale_{index:07d}",
                    path,
                    "referenced",
                    json.dumps(
                        {
                            "pathKey": path,
                            "size": 256_000 + (index % 8192),
                            "mtimeNs": 1_800_000_000_000_000_000 + index,
                        },
                        separators=(",", ":"),
                    ),
                    f"content-{index:07d}",
                    "",
                    media_kind,
                    "video/quicktime" if media_kind == "video" else ("image/png" if media_kind == "screenshot" else "image/jpeg"),
                    1920,
                    1080,
                    120_000 if media_kind == "video" else None,
                    capture_date,
                    timestamp,
                    timestamp,
                    None,
                    "photo-scale-smoke",
                    json.dumps(
                        {
                            "camera": {"make": "Synthetic", "model": f"ScaleCam {index % 7}"},
                            "location": {"label": f"Zone {index % 11}"},
                        },
                        separators=(",", ":"),
                    ),
                ))
                metadata_rows.append((
                    f"photo_scale_{index:07d}",
                    title,
                    "Synthetic large-library smoke row",
                    1 if index % 17 == 0 else 0,
                    index % 6,
                    color_label,
                    pick_status,
                    0,
                    None,
                    None,
                    "{}",
                    0,
                    1 if index % 41 == 0 else 0,
                    timestamp,
                ))
            conn.executemany(
                """
                INSERT OR REPLACE INTO photo_assets(
                    asset_id, source_path, source_kind, file_signature_json, content_hash,
                    perceptual_hash, media_kind, mime_type, width, height, duration_ms,
                    capture_date, added_at, updated_at, missing_at, source_scan_run,
                    metadata_json
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                asset_rows,
            )
            conn.executemany(
                """
                INSERT OR REPLACE INTO photo_asset_metadata(
                    asset_id, title, caption, favorite, rating, color_label, pick_status, hidden, deleted_at, date_override,
                    location_override_json, location_hidden, edited, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                metadata_rows,
            )
    return (time.perf_counter() - started) * 1000


def seed_live_review_candidate(api: DesktopApi, source_path: str) -> None:
    api.project.candidates["photo-scale-live-candidate"] = ReviewCandidate(
        candidate_id="photo-scale-live-candidate",
        source_path=source_path,
        person_name="Scale Candidate",
        best_ref_id="scale-ref",
        best_ref_path="/synthetic/no-photo-used/refs/scale-candidate.jpg",
        score=0.91,
        band="synthetic",
        quality=0.84,
        model_name="photo-scale-smoke",
        status="accepted",
    )


def main() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    count = env_int("VINTRACE_PHOTO_SCALE_ASSETS", 10_000)
    root = Path(tempfile.mkdtemp(prefix="vintrace-photo-scale-"))
    registry = str(root / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry

    api, startup_ms = timed(lambda: DesktopApi(root / "workspace", actor="photo-scale-smoke"))
    seed_ms = seed_photo_library(api, count)
    workspace = root / "workspace"

    def validate_agent_path(value: str) -> Path:
        resolved = Path(value).expanduser().resolve()
        resolved.relative_to(root.resolve())
        return resolved

    agent_images = AgentImageService(
        api,
        workspace=workspace,
        require_consent=lambda: None,
        validate_path=validate_agent_path,
    )
    agent_overview, agent_overview_ms = timed(lambda: agent_images.library_overview())
    agent_page, agent_search_page_ms = timed(
        lambda: agent_images.search(
            query="",
            mode="lexical",
            filters={"favoriteOnly": True, "mediaKind": "image"},
            limit=100,
        )
    )
    agent_asset_ids = [
        str(item.get("assetId", "") or "")
        for item in agent_page.get("data", {}).get("items", [])
        if str(item.get("assetId", "") or "")
    ]
    agent_fetch, agent_fetch_ms = timed(lambda: agent_images.fetch_assets(agent_asset_ids[:100]))
    all_page, all_page_ms = timed(lambda: api.list_photo_folder_items({"folderId": "all", "limit": 100, "previewBudget": 0}))
    deep_page, deep_page_ms = timed(
        lambda: api.list_photo_folder_items({
            "folderId": "all",
            "offset": max(0, count - 100),
            "limit": 100,
            "sort": "newest",
            "previewBudget": 0,
        })
    )
    favorite_page, favorite_filter_ms = timed(
        lambda: api.list_photo_folder_items({"folderId": "all", "favoriteOnly": True, "limit": 100, "previewBudget": 0})
    )
    smart_album = api.save_photo_album({
        "name": "Scale favorite images",
        "albumKind": "smart",
        "rules": {"favoriteOnly": True, "mediaKind": "image"},
    })
    smart_album_page, smart_album_page_ms = timed(
        lambda: api.list_photo_folder_items({
            "folderId": f"album:{smart_album['albumId']}",
            "limit": 100,
            "previewBudget": 0,
        })
    )
    curation_smart_album = api.save_photo_album({
        "name": "Scale five-star green picks",
        "albumKind": "smart",
        "rules": {
            "op": "all",
            "conditions": [
                {"field": "rating", "operator": "atLeast", "value": 5},
                {"field": "colorLabel", "operator": "is", "value": "green"},
                {"field": "pickStatus", "operator": "is", "value": "pick"},
            ],
        },
    })
    curation_smart_album_page, curation_smart_album_page_ms = timed(
        lambda: api.list_photo_folder_items({
            "folderId": f"album:{curation_smart_album['albumId']}",
            "limit": 100,
            "previewBudget": 0,
        })
    )
    interactive_folder_rail, interactive_folder_rail_ms = timed(
        lambda: api.list_photo_folders({"coverPreviewBudget": 0, "railMode": "interactive"})
    )
    folder_rail, folder_rail_ms = timed(lambda: api.list_photo_folders({"coverPreviewBudget": 0}))
    folder_rail_repeat, folder_rail_repeat_ms = timed(lambda: api.list_photo_folders({"coverPreviewBudget": 0}))
    restarted_api = DesktopApi(workspace, actor="photo-scale-smoke-restart")
    restarted_folder_rail, restarted_folder_rail_ms = timed(
        lambda: restarted_api.list_photo_folders({"coverPreviewBudget": 0, "railMode": "interactive"})
    )
    date_buckets, date_buckets_ms = timed(lambda: api.list_photo_date_buckets({"folderId": "all", "mode": "months"}))
    cold_search_page, cold_folder_search_queue_ms = timed(
        lambda: api.list_photo_folder_items({"folderId": "all", "query": "summer", "limit": 100, "previewBudget": 0})
    )
    search_queue_after_cold = api.photo_indexing_jobs({"limit": 5})
    search_index_run, search_index_queue_run_ms = timed(lambda: api.run_photo_indexing_queue({"maxJobs": 1, "limit": 5}))
    seed_live_review_candidate(api, synthetic_photo_path(min(50, max(0, count - 1))))
    non_sql_folder = api.save_photo_album_folder({"name": "Scale materialized smart folders"})
    non_sql_smart_album = api.save_photo_album({
        "name": "Scale materialized summer title",
        "albumKind": "smart",
        "folderId": non_sql_folder["folderId"],
        "rules": {
            "op": "all",
            "conditions": [
                {"field": "title", "operator": "contains", "value": "Summer"},
            ],
        },
    })
    non_sql_criteria_is_none = api._photo_smart_album_sql_criteria_branches(non_sql_smart_album) is None
    expected_non_sql_count = ((count - 1) // 50) + 1
    non_sql_refresh, non_sql_refresh_ms = timed(
        lambda: api.index_photo_smart_albums({
            "albumId": non_sql_smart_album["albumId"],
            "force": True,
            "budgetLimit": count,
        })
    )
    non_sql_album_page, non_sql_album_page_ms = timed(
        lambda: api.list_photo_folder_items({
            "folderId": f"album:{non_sql_smart_album['albumId']}",
            "limit": 100,
            "previewBudget": 0,
        })
    )
    non_sql_folder_page, non_sql_folder_page_ms = timed(
        lambda: api.list_photo_folder_items({
            "folderId": f"albumFolder:{non_sql_folder['folderId']}",
            "limit": 100,
            "previewBudget": 0,
        })
    )
    non_sql_cache = api.project.db.photo_smart_album_materialization_cache(non_sql_smart_album["albumId"])

    metrics = {
        "startupMs": round(startup_ms, 2),
        "seedPhotoAssetsMs": round(seed_ms, 2),
        "agentOverviewMs": round(agent_overview_ms, 2),
        "agentSearchPageMs": round(agent_search_page_ms, 2),
        "agentFetch100Ms": round(agent_fetch_ms, 2),
        "allPageMs": round(all_page_ms, 2),
        "deepPageMs": round(deep_page_ms, 2),
        "favoriteFilterMs": round(favorite_filter_ms, 2),
        "smartAlbumPageMs": round(smart_album_page_ms, 2),
        "curationSmartAlbumPageMs": round(curation_smart_album_page_ms, 2),
        "interactiveFolderRailMs": round(interactive_folder_rail_ms, 2),
        "coldFolderSearchQueueMs": round(cold_folder_search_queue_ms, 2),
        "searchIndexQueueRunMs": round(search_index_queue_run_ms, 2),
        "nonSqlSmartAlbumRefreshMs": round(non_sql_refresh_ms, 2),
        "nonSqlSmartAlbumCachedPageMs": round(non_sql_album_page_ms, 2),
        "nonSqlSmartAlbumFolderPageMs": round(non_sql_folder_page_ms, 2),
        "folderRailMs": round(folder_rail_ms, 2),
        "folderRailRepeatMs": round(folder_rail_repeat_ms, 2),
        "restartedFolderRailMs": round(restarted_folder_rail_ms, 2),
        "dateBucketsMs": round(date_buckets_ms, 2),
    }
    count_scale = max(1.0, count / 10_000)
    seed_budget_default = 2500 if count <= 10_000 else 3000 * count_scale
    budgets = {
        "startupMs": budget("photo_scale_startup", 1500),
        "seedPhotoAssetsMs": budget("photo_scale_seed", seed_budget_default),
        "agentOverviewMs": budget("photo_scale_agent_overview", max(5000, 3500 * count_scale)),
        "agentSearchPageMs": budget("photo_scale_agent_search_page", 3500),
        "agentFetch100Ms": budget("photo_scale_agent_fetch_100", 3500),
        "allPageMs": budget("photo_scale_all_page", 500),
        "deepPageMs": budget("photo_scale_deep_page", 500),
        "favoriteFilterMs": budget("photo_scale_favorite_filter", 750),
        "smartAlbumPageMs": budget("photo_scale_smart_album_page", 500),
        "curationSmartAlbumPageMs": budget("photo_scale_curation_smart_album_page", 750),
        "interactiveFolderRailMs": budget("photo_scale_interactive_folder_rail", 500),
        "coldFolderSearchQueueMs": budget("photo_scale_cold_folder_search_queue", 3000),
        "searchIndexQueueRunMs": budget("photo_scale_search_index_queue_run", max(5000, 2500 * count_scale)),
        "nonSqlSmartAlbumRefreshMs": budget("photo_scale_non_sql_smart_album_refresh", max(6000, 4500 * count_scale)),
        "nonSqlSmartAlbumCachedPageMs": budget("photo_scale_non_sql_smart_album_cached_page", max(4000, 1000 * count_scale)),
        "nonSqlSmartAlbumFolderPageMs": budget("photo_scale_non_sql_smart_album_folder_page", max(4500, 1200 * count_scale)),
        "folderRailMs": budget("photo_scale_folder_rail", max(4000, 3500 * count_scale)),
        "folderRailRepeatMs": budget("photo_scale_folder_rail_repeat", 250),
        "restartedFolderRailMs": budget("photo_scale_restarted_folder_rail", 750),
        "dateBucketsMs": budget("photo_scale_date_buckets", 500),
    }
    checks = [
        {"name": name, "ok": metrics[name] <= limit, "valueMs": metrics[name], "budgetMs": limit}
        for name, limit in budgets.items()
    ]
    checks.extend([
        {"name": "asset count", "ok": int(all_page.get("total", 0)) == count, "value": all_page.get("total")},
        {"name": "agent overview asset count", "ok": int(agent_overview.get("data", {}).get("assetCount", 0)) == count, "value": agent_overview.get("data", {}).get("assetCount")},
        {"name": "agent search is bounded", "ok": 0 < int(agent_page.get("page", {}).get("returned", 0)) <= 100, "value": agent_page.get("page")},
        {"name": "agent fetch hydrates page", "ok": len(agent_fetch.get("data", {}).get("items", [])) == len(agent_asset_ids[:100]), "value": len(agent_fetch.get("data", {}).get("items", []))},
        {"name": "agent search hides paths", "ok": "/synthetic/no-photo-used" not in json.dumps(agent_page), "value": "redacted"},
        {"name": "deep page returned", "ok": int(deep_page.get("returned", 0)) == min(100, count), "value": deep_page.get("returned")},
        {"name": "favorite filter populated", "ok": int(favorite_page.get("total", 0)) > 0, "value": favorite_page.get("total")},
        {"name": "smart album populated", "ok": int(smart_album_page.get("total", 0)) > 0, "value": smart_album_page.get("total")},
        {
            "name": "curation smart album is bounded and canonical",
            "ok": (
                0 < int(curation_smart_album_page.get("total", 0))
                and 0 < int(curation_smart_album_page.get("returned", 0)) <= 100
                and all(
                    int(item.get("rating", 0) or 0) >= 5
                    and str(item.get("colorLabel", "") or "") == "green"
                    and str(item.get("pickStatus", "") or "") == "pick"
                    for item in curation_smart_album_page.get("items", [])
                )
            ),
            "value": {
                "total": curation_smart_album_page.get("total"),
                "returned": curation_smart_album_page.get("returned"),
            },
        },
        {"name": "interactive folder rail is partial", "ok": interactive_folder_rail.get("partial") is True, "value": interactive_folder_rail.get("railMode")},
        {"name": "interactive folder rail has exact all count", "ok": next((int(folder.get("count", 0) or 0) for folder in interactive_folder_rail.get("folders", []) if folder.get("id") == "all"), -1) == count, "value": len(interactive_folder_rail.get("folders", []))},
        {"name": "cold search returns cold results", "ok": int(cold_search_page.get("total", 0) or 0) == 0, "value": cold_search_page.get("total")},
        {"name": "cold search queues index job", "ok": any(str(job.get("jobKind", "")) == "search" and str(job.get("status", "")) == "queued" for job in search_queue_after_cold.get("jobs", [])), "value": search_queue_after_cold.get("jobs", [])},
        {"name": "search index queue batch ran", "ok": int(search_index_run.get("ran", 0) or 0) == 1, "value": search_index_run.get("jobsRun", [])},
        {"name": "search index batch processed rows", "ok": int(((search_index_run.get("jobsRun", [{}])[0] if search_index_run.get("jobsRun") else {}).get("result", {}).get("progress", {}) or {}).get("updated", 0) or 0) > 0, "value": (search_index_run.get("jobsRun", [{}])[0] if search_index_run.get("jobsRun") else {}).get("result", {}).get("progress", {})},
        {"name": "non-SQL smart album path used", "ok": non_sql_criteria_is_none, "value": non_sql_criteria_is_none},
        {"name": "non-SQL smart album refreshed", "ok": int(non_sql_refresh.get("progress", {}).get("processed", 0)) == 1, "value": non_sql_refresh.get("progress")},
        {"name": "non-SQL smart album cache updated", "ok": int(non_sql_refresh.get("progress", {}).get("updated", 0)) == 1, "value": non_sql_refresh.get("progress")},
        {"name": "non-SQL smart album cache count", "ok": int(non_sql_cache.get("assetCount", 0) or 0) == expected_non_sql_count, "value": non_sql_cache.get("assetCount")},
        {"name": "non-SQL smart album populated", "ok": int(non_sql_album_page.get("total", 0)) == expected_non_sql_count, "value": non_sql_album_page.get("total")},
        {"name": "non-SQL smart album folder populated", "ok": int(non_sql_folder_page.get("total", 0)) == expected_non_sql_count, "value": non_sql_folder_page.get("total")},
        {"name": "folder rail populated", "ok": len(folder_rail.get("folders", [])) > 0, "value": len(folder_rail.get("folders", []))},
        {"name": "repeated folder rail is stable", "ok": folder_rail_repeat == folder_rail, "value": len(folder_rail_repeat.get("folders", []))},
        {"name": "restarted folder rail reuses enrichment", "ok": restarted_folder_rail.get("enriched") is True and restarted_folder_rail.get("partial") is False, "value": restarted_folder_rail.get("railMode")},
        {"name": "restarted folder rail has exact all count", "ok": next((int(folder.get("count", 0) or 0) for folder in restarted_folder_rail.get("folders", []) if folder.get("id") == "all"), -1) == count, "value": len(restarted_folder_rail.get("folders", []))},
        {"name": "date buckets populated", "ok": int(date_buckets.get("total", 0)) > 0, "value": date_buckets.get("total")},
    ])
    result = {
        "generatedAt": now_iso(),
        "ok": all(check["ok"] for check in checks),
        "photoAssets": count,
        "budgetScale": round(count_scale, 2),
        "metrics": metrics,
        "budgets": budgets,
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

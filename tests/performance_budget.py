from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

from crossage_fr.api_server import DesktopApi
from crossage_fr.match import adapters as match_adapters
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
    with api.project.db.connect() as conn:
        for start in range(0, count, batch_size):
            batch = [candidate(index) for index in range(start, min(start + batch_size, count))]
            rows = []
            for row in batch:
                payload = api.project.db._candidate_payload(row)
                payload["photoAssetBackfillDisabled"] = True
                rows.append(api.project.db._candidate_params(payload))
            conn.executemany(api.project.db._upsert_candidate_sql(), rows)
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


def adapter_training_row(index: int) -> dict[str, Any]:
    is_match = index % 2 == 0
    score_offset = (index % 50) / 1000
    return {
        "candidateId": f"adapter_perf_{index:06d}",
        "sourceHash": f"adapter-hash-{index:06d}",
        "expectedPerson": f"Person {index % 37:02d}",
        "actualPerson": f"Person {index % 37:02d}" if is_match else "",
        "isMatch": is_match,
        "matchScore": (0.64 + score_offset) if is_match else (0.18 + score_offset),
        "rawCosine": (0.61 + score_offset) if is_match else (0.15 + score_offset),
        "quality": 0.86,
        "referenceQuality": 0.9,
        "runnerUpMargin": 0.18 if is_match else 0.04,
        "modelName": "performance-budget-synthetic",
        "poseBucket": "profile" if index % 7 == 0 else "frontal",
        "mediaKind": "video" if index % 19 == 0 else "image",
        "ageGapYears": float(index % 18),
        "alignError": 0.03 if is_match else 0.09,
        "iedPx": 52.0 if is_match else 38.0,
        "features": {
            "riskFlags": [] if is_match else ["close-runner-up"],
            "reviewPriority": 0.8 if is_match else 0.45,
        },
    }


def adapter_runtime_budget(row_count: int) -> dict[str, Any]:
    rows = [adapter_training_row(index) for index in range(row_count)]
    artifact = match_adapters.fit(rows, min_count=80, min_per_class=40)
    if artifact is None:
        raise RuntimeError("adapter performance rows did not produce an artifact")
    sample = rows[: min(2000, len(rows))]
    baseline_scores, baseline_ms = timed(lambda: [float(row["matchScore"]) for row in sample])
    adapter_scores, adapter_ms = timed(lambda: [match_adapters.score(row, artifact) for row in sample])
    positives = [score for row, score in zip(sample, adapter_scores) if row["isMatch"]]
    negatives = [score for row, score in zip(sample, adapter_scores) if not row["isMatch"]]
    positive_mean = sum(positives) / max(1, len(positives))
    negative_mean = sum(negatives) / max(1, len(negatives))
    if positive_mean <= negative_mean:
        raise RuntimeError({"positiveMean": positive_mean, "negativeMean": negative_mean})
    overhead_ms = max(0.0, adapter_ms - baseline_ms)
    return {
        "rows": len(sample),
        "baselineScoreMs": round(baseline_ms, 2),
        "adapterScoreMs": round(adapter_ms, 2),
        "adapterScoreOverheadUs": round((overhead_ms / max(1, len(sample))) * 1000, 3),
        "positiveMean": round(positive_mean, 6),
        "negativeMean": round(negative_mean, 6),
        "trainer": artifact.get("trainer"),
    }


def photo_export_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-export-media"
    media_root.mkdir(parents=True, exist_ok=True)
    for index in range(asset_count):
        image = Image.new("RGB", (12, 12), ((index * 17) % 255, 96, 180))
        image.save(media_root / f"export-budget-{index:04d}.png")
    video_source = media_root / "export-budget-video.mp4"
    video_source.write_bytes(b"performance budget fake source video\n")
    fake_ffmpeg = api.project.root / "performance-budget-fake-ffmpeg"
    fake_ffmpeg.write_text(
        "\n".join([
            "#!/usr/bin/env python3",
            "from pathlib import Path",
            "import sys",
            "target = Path(sys.argv[-1])",
            "target.parent.mkdir(parents=True, exist_ok=True)",
            "target.write_bytes(b'performance budget fake encoded video')",
            "",
        ]),
        encoding="utf-8",
    )
    os.chmod(fake_ffmpeg, 0o755)
    api.project.config.ffmpeg_path = str(fake_ffmpeg)
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos export performance budget",
    })
    imported_paths = list(imported.get("importedPaths", []))
    image_paths = [path for path in imported_paths if path.lower().endswith(".png")][:asset_count]
    video_paths = [path for path in imported_paths if path.lower().endswith(".mp4")]
    if len(image_paths) < asset_count or not video_paths:
        raise RuntimeError({"expectedImages": asset_count, "importedImages": len(image_paths), "videoPaths": video_paths})
    original_export, original_ms = timed(lambda: api.export_photo_selection(
        image_paths,
        include_metadata=True,
        filename_mode="numbered",
    ))
    rendered_paths = image_paths[: min(20, len(image_paths))]
    rendered_export, rendered_ms = timed(lambda: api.export_photo_selection(
        rendered_paths,
        export_variant="rendered",
        render_format="png",
        render_max_dimension=16,
        filename_mode="numbered",
    ))
    rendered_video_export, rendered_video_ms = timed(lambda: api.export_photo_selection(
        video_paths[:1],
        export_variant="rendered",
        video_render_format="mp4",
        video_render_quality="small",
        render_max_dimension=0,
        filename_mode="numbered",
    ))
    slideshow_sources = image_paths[: min(8, len(image_paths))]
    slideshow_movie, slideshow_movie_ms = timed(lambda: api.export_photo_slideshow({
        "sourcePaths": slideshow_sources,
        "title": "Performance Budget Slideshow",
        "outputMode": "video",
        "renderVideo": True,
        "videoRenderFormat": "mp4",
        "videoRenderQuality": "small",
        "renderMaxDimension": 360,
        "intervalMs": 1500,
        "transitionEffect": "cut",
        "theme": "classic",
    }))
    contact_sheet_sources = image_paths[: min(12, len(image_paths))]
    contact_sheet, contact_sheet_ms = timed(lambda: api.export_photo_contact_sheet({
        "sourcePaths": contact_sheet_sources,
        "format": "png",
        "layoutPreset": "custom",
        "columns": 4,
        "thumbnailSize": 96,
        "includeCaptions": False,
        "title": "Performance Budget Contact Sheet",
    }))
    if original_export["counts"]["copied"] != len(image_paths):
        raise RuntimeError(original_export["counts"])
    if rendered_export["counts"]["rendered"] != len(rendered_paths):
        raise RuntimeError(rendered_export["counts"])
    if rendered_video_export["counts"]["videoRendered"] != 1:
        raise RuntimeError(rendered_video_export["counts"])
    if slideshow_movie["outputMode"] != "video" or not Path(str(slideshow_movie.get("targetPath", ""))).exists():
        raise RuntimeError(slideshow_movie)
    if contact_sheet["counts"]["included"] != len(contact_sheet_sources) or not Path(str(contact_sheet.get("targetPath", ""))).exists():
        raise RuntimeError(contact_sheet)
    return {
        "assetCount": len(image_paths),
        "renderedAssetCount": len(rendered_paths),
        "videoAssetCount": len(video_paths[:1]),
        "slideshowSlideCount": len(slideshow_sources),
        "contactSheetAssetCount": len(contact_sheet_sources),
        "originalExportMs": round(original_ms, 2),
        "renderedExportMs": round(rendered_ms, 2),
        "renderedVideoExportMs": round(rendered_video_ms, 2),
        "slideshowMovieExportMs": round(slideshow_movie_ms, 2),
        "contactSheetExportMs": round(contact_sheet_ms, 2),
        "originalBundlePath": original_export.get("bundlePath", ""),
        "renderedBundlePath": rendered_export.get("bundlePath", ""),
        "renderedVideoBundlePath": rendered_video_export.get("bundlePath", ""),
        "slideshowMovieBundlePath": slideshow_movie.get("bundlePath", ""),
        "contactSheetBundlePath": contact_sheet.get("bundlePath", ""),
    }


def photo_export_failure_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-export-failure-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(4, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (14, 14), ((index * 31) % 255, 84, 150))
        image.save(media_root / f"export-failure-budget-{index:04d}.png")
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos export missing-original performance budget",
    })
    image_paths = sorted(
        path for path in imported.get("importedPaths", [])
        if Path(str(path)).name.startswith("export-failure-budget-") and str(path).lower().endswith(".png")
    )
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})
    missing_count = max(1, min(len(image_paths) - 1, len(image_paths) // 4))
    missing_paths = set(image_paths[1::4][:missing_count])
    for source_path in missing_paths:
        Path(source_path).unlink()
    valid_paths = [path for path in image_paths if path not in missing_paths]

    selection_export, selection_ms = timed(lambda: api.export_photo_selection(
        image_paths,
        include_metadata=True,
        filename_mode="numbered",
    ))
    contact_sheet, contact_sheet_ms = timed(lambda: api.export_photo_contact_sheet({
        "sourcePaths": image_paths,
        "format": "png",
        "layoutPreset": "custom",
        "columns": 4,
        "thumbnailSize": 72,
        "includeCaptions": True,
        "captionMode": "filename",
        "title": "Performance Budget Missing Originals",
    }))

    selection_counts = selection_export.get("counts", {})
    if selection_counts.get("selected") != len(image_paths):
        raise RuntimeError(selection_export)
    if selection_counts.get("copied") != len(valid_paths) or selection_counts.get("missing") != len(missing_paths):
        raise RuntimeError(selection_counts)
    if selection_counts.get("metadata") != len(valid_paths):
        raise RuntimeError(selection_counts)
    selection_manifest_path = Path(str(selection_export.get("manifestPath", "")))
    selection_csv_path = Path(str(selection_export.get("csvPath", "")))
    if not selection_manifest_path.exists() or not selection_csv_path.exists():
        raise RuntimeError(selection_export)
    selection_manifest = json.loads(selection_manifest_path.read_text(encoding="utf-8"))
    selection_rows = selection_manifest.get("items", [])
    selection_missing_rows = [
        row for row in selection_rows
        if row.get("result") == "missing" and str(row.get("sourcePath", "")) in missing_paths
    ]
    selection_copied_rows = [
        row for row in selection_rows
        if row.get("result") == "copied" and Path(str(row.get("targetPath", ""))).exists()
    ]
    if len(selection_missing_rows) != len(missing_paths) or len(selection_copied_rows) != len(valid_paths):
        raise RuntimeError({"manifest": selection_manifest_path, "items": selection_rows})
    if "missing" not in selection_csv_path.read_text(encoding="utf-8"):
        raise RuntimeError({"csvPath": str(selection_csv_path)})

    contact_counts = contact_sheet.get("counts", {})
    if contact_counts.get("selected") != len(image_paths):
        raise RuntimeError(contact_sheet)
    if contact_counts.get("included") != len(valid_paths) or contact_counts.get("missing") != len(missing_paths):
        raise RuntimeError(contact_counts)
    contact_manifest_path = Path(str(contact_sheet.get("manifestPath", "")))
    if not contact_manifest_path.exists() or not Path(str(contact_sheet.get("targetPath", ""))).exists():
        raise RuntimeError(contact_sheet)
    contact_manifest = json.loads(contact_manifest_path.read_text(encoding="utf-8"))
    contact_rows = contact_manifest.get("items", [])
    contact_missing_rows = [
        row for row in contact_rows
        if row.get("result") == "missing" and str(row.get("sourcePath", "")) in missing_paths
    ]
    if len(contact_missing_rows) != len(missing_paths):
        raise RuntimeError({"manifest": contact_manifest_path, "items": contact_rows})

    return {
        "assetCount": len(image_paths),
        "validAssetCount": len(valid_paths),
        "missingAssetCount": len(missing_paths),
        "selectionExportMs": round(selection_ms, 2),
        "contactSheetExportMs": round(contact_sheet_ms, 2),
        "selectionCopied": int(selection_counts.get("copied", 0) or 0),
        "selectionMissing": int(selection_counts.get("missing", 0) or 0),
        "selectionMetadata": int(selection_counts.get("metadata", 0) or 0),
        "selectionManifestMissingRows": len(selection_missing_rows),
        "selectionManifestCopiedRows": len(selection_copied_rows),
        "contactIncluded": int(contact_counts.get("included", 0) or 0),
        "contactMissing": int(contact_counts.get("missing", 0) or 0),
        "contactPages": int(contact_counts.get("pages", 0) or 0),
        "contactManifestMissingRows": len(contact_missing_rows),
        "selectionBundlePath": selection_export.get("bundlePath", ""),
        "contactSheetBundlePath": contact_sheet.get("bundlePath", ""),
    }


def photo_preview_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-preview-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(2, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (48, 48), ((index * 29) % 255, 140, 72))
        image.save(media_root / f"preview-budget-{index:04d}.png")
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos preview performance budget",
    })
    image_paths = sorted(path for path in imported.get("importedPaths", []) if path.lower().endswith(".png"))
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})
    split = max(1, len(image_paths) // 2)
    rebuild_paths = image_paths[:split]
    sweep_limit = max(1, len(image_paths) - split)
    rebuild_result, rebuild_ms = timed(lambda: api.rebuild_photo_previews({
        "sourcePaths": rebuild_paths,
        "force": True,
        "limit": len(rebuild_paths),
    }))
    sweep_result, sweep_ms = timed(lambda: api.photo_library_preview_sweep({
        "limit": sweep_limit,
        "sampleLimit": min(12, sweep_limit),
        "missingOnly": True,
    }))
    if int(rebuild_result.get("generatedPreviews", 0) or 0) < len(rebuild_paths):
        raise RuntimeError({"expectedGenerated": len(rebuild_paths), "rebuild": rebuild_result})
    sweep_counts = sweep_result.get("counts", {}) if isinstance(sweep_result.get("counts", {}), dict) else {}
    if int(sweep_counts.get("generatedPreviews", 0) or 0) <= 0:
        raise RuntimeError({"expectedSweepGeneration": True, "sweep": sweep_result})
    return {
        "assetCount": len(image_paths),
        "rebuildAssetCount": len(rebuild_paths),
        "sweepLimit": sweep_limit,
        "rebuildMs": round(rebuild_ms, 2),
        "sweepMs": round(sweep_ms, 2),
        "rebuildGeneratedPreviews": int(rebuild_result.get("generatedPreviews", 0) or 0),
        "sweepGeneratedPreviews": int(sweep_counts.get("generatedPreviews", 0) or 0),
        "sweepEligibleAssets": int(sweep_counts.get("eligibleAssets", 0) or 0),
        "sweepMissingCachedPreviews": int(sweep_counts.get("missingCachedPreviews", 0) or 0),
        "sweepRemainingMissingCachedPreviews": int(sweep_counts.get("remainingMissingCachedPreviews", 0) or 0),
    }


def photo_preview_failure_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    isolated_api = DesktopApi(api.project.root.parent / "preview-failure-workspace", actor="performance-budget")
    media_root = isolated_api.project.root / "performance-photo-preview-failure-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(6, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (52, 40), ((index * 31) % 255, 96, (index * 17) % 255))
        image.save(media_root / f"preview-failure-budget-{index:04d}.png")
    imported = isolated_api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos preview failure performance budget",
    })
    image_paths = sorted(
        path for path in imported.get("importedPaths", [])
        if Path(str(path)).name.startswith("preview-failure-budget-") and str(path).lower().endswith(".png")
    )
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})

    missing_paths = [path for index, path in enumerate(image_paths) if index % 4 == 0]
    valid_paths = [path for path in image_paths if path not in set(missing_paths)]
    if not missing_paths or len(valid_paths) < 2:
        raise RuntimeError({"missingPaths": len(missing_paths), "validPaths": len(valid_paths)})
    for path in missing_paths:
        Path(path).unlink(missing_ok=True)

    direct_count = max(1, len(valid_paths) // 2)
    direct_valid_paths = valid_paths[:direct_count]
    sweep_valid_paths = valid_paths[direct_count:]
    if not sweep_valid_paths:
        sweep_valid_paths = direct_valid_paths[-1:]
        direct_valid_paths = direct_valid_paths[:-1]
    rebuild_inputs = direct_valid_paths + missing_paths

    rebuild_result, rebuild_ms = timed(lambda: isolated_api.rebuild_photo_previews({
        "sourcePaths": rebuild_inputs,
        "force": True,
        "limit": len(rebuild_inputs),
    }))
    rebuild_skipped = rebuild_result.get("skipped", []) if isinstance(rebuild_result.get("skipped", []), list) else []
    rebuild_failed = rebuild_result.get("failed", []) if isinstance(rebuild_result.get("failed", []), list) else []
    skipped_paths = {str(row.get("sourcePath", "") or "") for row in rebuild_skipped if isinstance(row, dict)}
    missing_path_set = {str(Path(path).resolve()) for path in missing_paths}
    if int(rebuild_result.get("considered", 0) or 0) != len(rebuild_inputs):
        raise RuntimeError({"expectedConsidered": len(rebuild_inputs), "rebuild": rebuild_result})
    if int(rebuild_result.get("generatedPreviews", 0) or 0) != len(direct_valid_paths):
        raise RuntimeError({"expectedGenerated": len(direct_valid_paths), "rebuild": rebuild_result})
    if len(rebuild_skipped) != len(missing_paths) or skipped_paths != missing_path_set:
        raise RuntimeError({"expectedSkipped": sorted(missing_path_set), "rebuild": rebuild_result})
    if rebuild_failed:
        raise RuntimeError({"expectedNoFailures": True, "rebuild": rebuild_result})

    direct_preview_paths = [
        isolated_api.project.preview_path_for(path, create=False) for path in direct_valid_paths
    ]
    if any(not preview or not Path(str(preview)).is_file() for preview in direct_preview_paths):
        raise RuntimeError({"expectedDirectPreviews": direct_preview_paths})
    if any(isolated_api.project.preview_path_for(path, create=False) for path in missing_paths):
        raise RuntimeError({"expectedNoMissingOriginalPreviews": missing_paths})

    sweep_result, sweep_ms = timed(lambda: isolated_api.photo_library_preview_sweep({
        "limit": len(sweep_valid_paths),
        "sampleLimit": min(12, len(image_paths)),
        "missingOnly": True,
    }))
    sweep_counts = sweep_result.get("counts", {}) if isinstance(sweep_result.get("counts", {}), dict) else {}
    sweep_samples = sweep_result.get("samples", {}) if isinstance(sweep_result.get("samples", {}), dict) else {}
    if int(sweep_counts.get("missingOriginals", 0) or 0) != len(missing_paths):
        raise RuntimeError({"expectedMissingOriginals": len(missing_paths), "sweep": sweep_result})
    if int(sweep_counts.get("eligibleAssets", 0) or 0) != len(valid_paths):
        raise RuntimeError({"expectedEligibleAssets": len(valid_paths), "sweep": sweep_result})
    if int(sweep_counts.get("cachedPreviews", 0) or 0) != len(direct_valid_paths):
        raise RuntimeError({"expectedCachedPreviews": len(direct_valid_paths), "sweep": sweep_result})
    if int(sweep_counts.get("missingCachedPreviews", 0) or 0) != len(sweep_valid_paths):
        raise RuntimeError({"expectedMissingCachedPreviews": len(sweep_valid_paths), "sweep": sweep_result})
    if int(sweep_counts.get("selectedAssets", 0) or 0) != len(sweep_valid_paths):
        raise RuntimeError({"expectedSelectedAssets": len(sweep_valid_paths), "sweep": sweep_result})
    if int(sweep_counts.get("generatedPreviews", 0) or 0) != len(sweep_valid_paths):
        raise RuntimeError({"expectedSweepGenerated": len(sweep_valid_paths), "sweep": sweep_result})
    if int(sweep_counts.get("failedPreviews", 0) or 0) != 0 or int(sweep_counts.get("remainingMissingCachedPreviews", 0) or 0) != 0:
        raise RuntimeError({"expectedSweepRepaired": True, "sweep": sweep_result})
    sample_missing = sweep_samples.get("missingOriginals", []) if isinstance(sweep_samples.get("missingOriginals", []), list) else []
    if not sample_missing:
        raise RuntimeError({"expectedMissingOriginalSamples": True, "sweep": sweep_result})
    if any(isolated_api.project.preview_path_for(path, create=False) for path in missing_paths):
        raise RuntimeError({"expectedNoMissingOriginalPreviewsAfterSweep": missing_paths})

    return {
        "assetCount": len(image_paths),
        "validAssetCount": len(valid_paths),
        "missingOriginalCount": len(missing_paths),
        "directRebuildAssetCount": len(direct_valid_paths),
        "sweepRepairAssetCount": len(sweep_valid_paths),
        "rebuildMs": round(rebuild_ms, 2),
        "sweepMs": round(sweep_ms, 2),
        "rebuildGeneratedPreviews": int(rebuild_result.get("generatedPreviews", 0) or 0),
        "rebuildSkipped": len(rebuild_skipped),
        "rebuildFailed": len(rebuild_failed),
        "sweepEligibleAssets": int(sweep_counts.get("eligibleAssets", 0) or 0),
        "sweepCachedPreviews": int(sweep_counts.get("cachedPreviews", 0) or 0),
        "sweepMissingCachedPreviews": int(sweep_counts.get("missingCachedPreviews", 0) or 0),
        "sweepMissingOriginals": int(sweep_counts.get("missingOriginals", 0) or 0),
        "sweepSelectedAssets": int(sweep_counts.get("selectedAssets", 0) or 0),
        "sweepGeneratedPreviews": int(sweep_counts.get("generatedPreviews", 0) or 0),
        "sweepFailedPreviews": int(sweep_counts.get("failedPreviews", 0) or 0),
        "sweepRemainingMissingCachedPreviews": int(sweep_counts.get("remainingMissingCachedPreviews", 0) or 0),
        "missingOriginalSamples": len(sample_missing),
        "sweepStatus": str(sweep_result.get("status", "") or ""),
        "sweepOk": bool(sweep_result.get("ok", False)),
    }


def photo_metadata_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-metadata-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(2, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (36, 24), ((index * 19) % 255, 188, 92))
        image.save(media_root / f"metadata-budget-{index:04d}.png")
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos metadata indexing performance budget",
    })
    image_paths = sorted(
        path for path in imported.get("importedPaths", [])
        if Path(str(path)).name.startswith("metadata-budget-") and str(path).lower().endswith(".png")
    )
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})

    updates = []
    for index, source_path in enumerate(image_paths):
        token = f"METAPERF{index:04d}"
        updates.append({
            "sourcePath": source_path,
            "title": f"Metadata Budget {index:04d} {token}",
            "caption": f"Indexed local caption {token} shelf {index % 13} lens {index % 7}",
            "favorite": index % 3 == 0,
            "captureDate": f"2026-02-{(index % 28) + 1:02d}T10:{index % 60:02d}:00Z",
            "dateOverride": f"2026-03-{(index % 28) + 1:02d}",
            "locationOverride": {
                "label": f"Meta Place {index % 9}",
                "latitude": 37.70 + (index % 50) / 1000,
                "longitude": -122.45 + (index % 50) / 1000,
            },
            "keywords": ["scale-meta", f"scale-meta-{index % 11}", token],
            "accessibilityDescription": f"Accessible indexed description {token}",
            "descriptionRegions": [{
                "id": f"metadata-region-{index:04d}",
                "label": f"Region {index % 5}",
                "text": f"Region text {token}",
                "left": 0.1,
                "top": 0.2,
                "width": 0.3,
                "height": 0.25,
            }],
        })

    batch_result, batch_ms = timed(lambda: api.update_photo_assets_metadata({
        "items": updates,
        "label": "Performance budget metadata batch update",
    }))
    if int(batch_result.get("updated", 0) or 0) != len(updates) or int(batch_result.get("changed", 0) or 0) != len(updates):
        raise RuntimeError({"expectedUpdated": len(updates), "batch": batch_result})
    operation_id = str((batch_result.get("operation") or {}).get("operationId", "") or "")
    if not operation_id:
        raise RuntimeError({"expectedOperation": True, "batch": batch_result})

    search_token = f"METAPERF{len(image_paths) - 1:04d}"
    list_search, list_search_ms = timed(lambda: api.list_photo_assets({"query": search_token, "limit": 10}))
    global_search, global_search_ms = timed(lambda: api.search_photo_library({"query": search_token, "limit": 8}))
    keyword_result, keyword_ms = timed(lambda: api.list_photo_keywords({"query": "scale-meta"}))
    rebuild_count, rebuild_ms = timed(api.project.db.rebuild_photo_search_index)
    post_rebuild_search, post_rebuild_search_ms = timed(lambda: api.list_photo_assets({"query": search_token, "limit": 10}))

    list_items = list_search.get("items", []) if isinstance(list_search.get("items", []), list) else []
    post_rebuild_items = post_rebuild_search.get("items", []) if isinstance(post_rebuild_search.get("items", []), list) else []
    photo_group = next((group for group in global_search.get("groups", []) if group.get("id") == "photos"), {})
    keyword_rows = keyword_result.get("keywords", []) if isinstance(keyword_result.get("keywords", []), list) else []
    if not any(item.get("sourcePath") == image_paths[-1] for item in list_items):
        raise RuntimeError({"expectedListSearchToken": search_token, "search": list_search})
    if not any(item.get("sourcePath") == image_paths[-1] for item in photo_group.get("items", []) or []):
        raise RuntimeError({"expectedGlobalSearchToken": search_token, "search": global_search})
    if not any(item.get("sourcePath") == image_paths[-1] for item in post_rebuild_items):
        raise RuntimeError({"expectedPostRebuildSearchToken": search_token, "search": post_rebuild_search})
    expected_keyword_rows = 1 + min(11, len(image_paths))
    if len(keyword_rows) < expected_keyword_rows:
        raise RuntimeError({"expectedKeywordRows": expected_keyword_rows, "keywords": keyword_rows})

    with api.project.db.connect() as conn:
        asset_ids = [
            str(row["asset_id"] or "")
            for row in conn.execute(
                """
                SELECT asset_id
                FROM photo_assets
                WHERE source_path LIKE ?
                """,
                (f"{str(media_root)}%",),
            ).fetchall()
            if str(row["asset_id"] or "")
        ]
        placeholders = ",".join("?" for _ in asset_ids)
        metadata_rows = 0
        favorite_rows = 0
        location_rows = 0
        keyword_assignments = 0
        if asset_ids:
            metadata_rows = int(conn.execute(
                f"SELECT COUNT(*) AS n FROM photo_asset_metadata WHERE asset_id IN ({placeholders})",
                tuple(asset_ids),
            ).fetchone()["n"] or 0)
            favorite_rows = int(conn.execute(
                f"SELECT COUNT(*) AS n FROM photo_asset_metadata WHERE favorite = 1 AND asset_id IN ({placeholders})",
                tuple(asset_ids),
            ).fetchone()["n"] or 0)
            location_rows = int(conn.execute(
                f"SELECT COUNT(*) AS n FROM photo_asset_locations WHERE asset_id IN ({placeholders})",
                tuple(asset_ids),
            ).fetchone()["n"] or 0)
            keyword_assignments = int(conn.execute(
                f"SELECT COUNT(*) AS n FROM photo_asset_keywords WHERE asset_id IN ({placeholders})",
                tuple(asset_ids),
            ).fetchone()["n"] or 0)
    expected_favorites = sum(1 for index in range(len(image_paths)) if index % 3 == 0)
    if metadata_rows != len(image_paths) or favorite_rows != expected_favorites or location_rows != len(image_paths):
        raise RuntimeError({
            "expectedMetadataRows": len(image_paths),
            "metadataRows": metadata_rows,
            "expectedFavorites": expected_favorites,
            "favoriteRows": favorite_rows,
            "locationRows": location_rows,
        })
    if keyword_assignments < len(image_paths) * 3:
        raise RuntimeError({"expectedKeywordAssignments": len(image_paths) * 3, "keywordAssignments": keyword_assignments})

    return {
        "assetCount": len(image_paths),
        "updated": int(batch_result.get("updated", 0) or 0),
        "changed": int(batch_result.get("changed", 0) or 0),
        "operationId": operation_id,
        "batchUpdateMs": round(batch_ms, 2),
        "listSearchMs": round(list_search_ms, 2),
        "globalSearchMs": round(global_search_ms, 2),
        "keywordListMs": round(keyword_ms, 2),
        "searchIndexRebuildMs": round(rebuild_ms, 2),
        "postRebuildSearchMs": round(post_rebuild_search_ms, 2),
        "rebuildCount": int(rebuild_count),
        "metadataRows": metadata_rows,
        "favoriteRows": favorite_rows,
        "locationRows": location_rows,
        "keywordAssignments": keyword_assignments,
        "keywordRows": len(keyword_rows),
    }


def photo_ocr_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-ocr-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(2, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (64, 32), ((index * 31) % 255, 245, 236))
        image_path = media_root / f"ocr-budget-{index:04d}.png"
        image.save(image_path)
        image_path.with_suffix(".txt").write_text(
            f"OCRPERF{index:04d} local sidecar queue performance sample\n"
            f"Batch {index % 9} Shelf {index % 13}",
            encoding="utf-8",
        )
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos OCR performance budget",
    })
    image_paths = sorted(
        path for path in imported.get("importedPaths", [])
        if Path(str(path)).name.startswith("ocr-budget-") and str(path).lower().endswith(".png")
    )
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})

    api.save_photo_library_settings({
        "localSettings": {
            "localIntelligenceEnabled": True,
            "noNetworkIntelligence": True,
            "backgroundIndexingPaused": False,
            "indexingPowerMode": "low",
        }
    })
    batch_limit = max(1, min(16, max(1, len(image_paths) // 4)))

    def index_pending_batch() -> dict[str, Any]:
        return api.index_photo_ocr({
            "sourcePaths": image_paths,
            "pendingOnly": True,
            "sidecarOnly": True,
            "budgetLimit": batch_limit,
            "language": "eng",
        })

    first_batch, first_batch_ms = timed(index_pending_batch)
    batches = 1
    queue_drain_ms = first_batch_ms
    progress = first_batch.get("progress", {}) if isinstance(first_batch.get("progress", {}), dict) else {}
    if int(progress.get("updated", 0) or 0) != min(batch_limit, len(image_paths)):
        raise RuntimeError({"expectedFirstBatchUpdated": min(batch_limit, len(image_paths)), "result": first_batch})
    if len(image_paths) > batch_limit and int(progress.get("deferred", 0) or 0) <= 0:
        raise RuntimeError({"expectedDeferred": True, "result": first_batch})
    while int(progress.get("deferred", 0) or 0) > 0:
        batch, batch_ms = timed(index_pending_batch)
        batches += 1
        queue_drain_ms += batch_ms
        progress = batch.get("progress", {}) if isinstance(batch.get("progress", {}), dict) else {}
        if batches > len(image_paths) + 1:
            raise RuntimeError({"expectedQueueDrain": True, "lastResult": batch})
    status, status_ms = timed(lambda: api.photo_ocr_index_status({"limit": max(100, len(image_paths) + 10)}))

    indexed_count = 0
    for path in image_paths:
        asset = api.project.db.photo_asset_by_path(path)
        metadata = asset.get("metadata", {}) if isinstance(asset, dict) else {}
        local_ocr = metadata.get("localOcr", {}) if isinstance(metadata.get("localOcr"), dict) else {}
        if local_ocr.get("status") == "indexed" and str(metadata.get("ocrText", "")).startswith("OCRPERF"):
            indexed_count += 1
    if indexed_count != len(image_paths):
        raise RuntimeError({"expectedIndexed": len(image_paths), "indexed": indexed_count})

    search_token = f"OCRPERF{len(image_paths) - 1:04d}"
    search = api.search_photo_library({"query": search_token})
    photo_group = next((group for group in search.get("groups", []) if group.get("id") == "photos"), {})
    if not any(item.get("sourcePath") == image_paths[-1] for item in photo_group.get("items", []) or []):
        raise RuntimeError({"expectedSearchToken": search_token, "search": search})
    return {
        "assetCount": len(image_paths),
        "batchLimit": batch_limit,
        "batches": batches,
        "firstBatchMs": round(first_batch_ms, 2),
        "queueDrainMs": round(queue_drain_ms, 2),
        "statusMs": round(status_ms, 2),
        "indexedCount": indexed_count,
        "statusIndexed": int(status.get("indexed", 0) or 0),
        "firstBatchDeferred": int(first_batch.get("progress", {}).get("deferred", 0) or 0),
    }


def photo_ocr_worker_queue_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    from PIL import Image

    media_root = api.project.root / "performance-photo-ocr-worker-media"
    media_root.mkdir(parents=True, exist_ok=True)
    total_assets = max(2, asset_count)
    for index in range(total_assets):
        image = Image.new("RGB", (64, 36), ((index * 23) % 255, 230, 210))
        image_path = media_root / f"ocr-worker-budget-{index:04d}.png"
        image.save(image_path)
        image_path.with_suffix(".txt").write_text(
            f"OCRWORKER{index:04d} durable queue sidecar payload\n"
            f"Queue batch {index % 7} shelf {index % 11}",
            encoding="utf-8",
        )
    imported = api.import_photos({
        "sourcePaths": [str(media_root)],
        "storageMode": "referenced",
        "sourceLabel": "Photos OCR worker queue performance budget",
    })
    image_paths = sorted(
        path for path in imported.get("importedPaths", [])
        if Path(str(path)).name.startswith("ocr-worker-budget-") and str(path).lower().endswith(".png")
    )
    if len(image_paths) < total_assets:
        raise RuntimeError({"expectedImages": total_assets, "importedImages": len(image_paths)})

    api.save_photo_library_settings({
        "localSettings": {
            "localIntelligenceEnabled": True,
            "noNetworkIntelligence": True,
            "backgroundIndexingPaused": False,
            "indexingPowerMode": "low",
        }
    })

    chunk_size = max(1, (len(image_paths) + 7) // 8)
    job_ids: list[str] = []

    def enqueue_jobs() -> list[str]:
        created: list[str] = []
        for start in range(0, len(image_paths), chunk_size):
            chunk = image_paths[start:start + chunk_size]
            payload = api.enqueue_photo_indexing_job({
                "jobKind": "ocr",
                "scope": {
                    "sourcePaths": chunk,
                    "pendingOnly": True,
                    "sidecarOnly": True,
                    "budgetLimit": len(chunk),
                    "language": "eng",
                },
                "limit": max(10, min(200, len(image_paths))),
            })
            job = payload.get("job", {}) if isinstance(payload.get("job"), dict) else {}
            job_id = str(job.get("jobId", "") or "")
            if not job_id:
                raise RuntimeError({"expectedJobId": True, "payload": payload})
            created.append(job_id)
        return created

    job_ids, enqueue_ms = timed(enqueue_jobs)
    queue_result, queue_run_ms = timed(lambda: api.run_photo_indexing_queue({
        "maxJobs": len(job_ids),
        "automatic": True,
        "limit": max(10, min(200, len(job_ids) + 5)),
    }))
    status_result, status_ms = timed(lambda: api.photo_indexing_jobs({
        "status": "completed",
        "limit": max(10, min(200, len(job_ids) + 5)),
    }))

    jobs_run = queue_result.get("jobsRun", []) if isinstance(queue_result.get("jobsRun", []), list) else []
    if int(queue_result.get("ran", 0) or 0) != len(job_ids):
        raise RuntimeError({"expectedJobsRun": len(job_ids), "queue": queue_result})
    if any(str(job.get("status", "") or "") != "completed" for job in jobs_run if isinstance(job, dict)):
        raise RuntimeError({"expectedCompletedJobs": True, "jobsRun": jobs_run})
    progress = queue_result.get("progress", {}) if isinstance(queue_result.get("progress", {}), dict) else {}
    if int(progress.get("updated", 0) or 0) != len(image_paths):
        raise RuntimeError({"expectedUpdated": len(image_paths), "queue": queue_result})

    indexed_count = 0
    for path in image_paths:
        asset = api.project.db.photo_asset_by_path(path)
        metadata = asset.get("metadata", {}) if isinstance(asset, dict) else {}
        local_ocr = metadata.get("localOcr", {}) if isinstance(metadata.get("localOcr"), dict) else {}
        if local_ocr.get("status") == "indexed" and str(metadata.get("ocrText", "")).startswith("OCRWORKER"):
            indexed_count += 1
    if indexed_count != len(image_paths):
        raise RuntimeError({"expectedIndexed": len(image_paths), "indexed": indexed_count})

    search_token = f"OCRWORKER{len(image_paths) - 1:04d}"
    search, search_ms = timed(lambda: api.search_photo_library({"query": search_token}))
    photo_group = next((group for group in search.get("groups", []) if group.get("id") == "photos"), {})
    if not any(item.get("sourcePath") == image_paths[-1] for item in photo_group.get("items", []) or []):
        raise RuntimeError({"expectedSearchToken": search_token, "search": search})
    job_id_set = set(job_ids)
    completed_jobs = [
        job for job in status_result.get("jobs", [])
        if isinstance(job, dict) and str(job.get("jobId", "") or "") in job_id_set
    ]
    if len(completed_jobs) != len(job_ids):
        raise RuntimeError({"expectedCompletedStatusRows": len(job_ids), "status": status_result})
    if any(int(job.get("attempts", 0) or 0) != 1 for job in completed_jobs):
        raise RuntimeError({"expectedSingleAttempt": True, "jobs": completed_jobs})

    return {
        "assetCount": len(image_paths),
        "jobCount": len(job_ids),
        "chunkSize": chunk_size,
        "enqueueMs": round(enqueue_ms, 2),
        "queueRunMs": round(queue_run_ms, 2),
        "statusMs": round(status_ms, 2),
        "searchMs": round(search_ms, 2),
        "indexedCount": indexed_count,
        "updatedCount": int(progress.get("updated", 0) or 0),
        "processedCount": int(progress.get("processed", 0) or 0),
        "failedCount": int(progress.get("failed", 0) or 0),
        "completedJobs": len(completed_jobs),
    }


def photo_catalog_queue_budget(api: DesktopApi) -> dict[str, Any]:
    api.save_photo_library_settings({
        "localSettings": {
            "localIntelligenceEnabled": False,
            "noNetworkIntelligence": True,
            "backgroundIndexingPaused": False,
            "backgroundIndexingAutoRun": False,
            "indexingPowerMode": "low",
        }
    })
    branch_a = [
        {"field": "title", "operator": "contains", "value": f"catalog-branch-a-{index}"}
        for index in range(9)
    ]
    branch_b = [
        {"field": "caption", "operator": "contains", "value": f"catalog-branch-b-{index}"}
        for index in range(9)
    ]
    album = api.save_photo_album({
        "name": "Performance catalog queue materialized smart album",
        "albumKind": "smart",
        "rules": {
            "op": "all",
            "conditions": [
                {"op": "any", "conditions": branch_a},
                {"op": "any", "conditions": branch_b},
            ],
        },
    })
    album_id = str(album.get("albumId", "") or "")
    if not album_id:
        raise RuntimeError({"expectedAlbumId": True, "album": album})

    def enqueue_catalog_jobs() -> tuple[str, str]:
        generated_payload = api.enqueue_photo_indexing_job({
            "jobKind": "generated_collections",
            "scope": {"libraryRoot": str(api.project.root)},
            "limit": 10,
        })
        smart_payload = api.enqueue_photo_indexing_job({
            "jobKind": "smart_albums",
            "scope": {"albumId": album_id, "force": True, "libraryRoot": str(api.project.root)},
            "limit": 10,
        })
        generated_job = generated_payload.get("job", {}) if isinstance(generated_payload.get("job"), dict) else {}
        smart_job = smart_payload.get("job", {}) if isinstance(smart_payload.get("job"), dict) else {}
        generated_job_id = str(generated_job.get("jobId", "") or "")
        smart_job_id = str(smart_job.get("jobId", "") or "")
        if not generated_job_id or not smart_job_id:
            raise RuntimeError({"expectedCatalogJobIds": True, "generated": generated_payload, "smart": smart_payload})
        return generated_job_id, smart_job_id

    (generated_job_id, smart_job_id), enqueue_ms = timed(enqueue_catalog_jobs)
    generated_result, generated_run_ms = timed(lambda: api.run_photo_indexing_job({
        "jobId": generated_job_id,
        "limit": 10,
    }))
    smart_result, smart_run_ms = timed(lambda: api.run_photo_indexing_job({
        "jobId": smart_job_id,
        "limit": 10,
    }))
    status_result, status_ms = timed(lambda: api.photo_indexing_jobs({
        "status": "completed",
        "limit": 10,
    }))

    jobs = status_result.get("jobs", []) if isinstance(status_result.get("jobs", []), list) else []
    completed_ids = {
        str(job.get("jobId", "") or "")
        for job in jobs
        if isinstance(job, dict) and str(job.get("status", "") or "") == "completed"
    }
    generated_job = generated_result.get("job", {}) if isinstance(generated_result.get("job"), dict) else {}
    smart_job = smart_result.get("job", {}) if isinstance(smart_result.get("job"), dict) else {}
    generated_progress = (
        generated_job.get("result", {}).get("progress", {})
        if isinstance(generated_job.get("result", {}), dict)
        else {}
    )
    smart_progress = (
        smart_job.get("result", {}).get("progress", {})
        if isinstance(smart_job.get("result", {}), dict)
        else {}
    )
    if str(generated_job.get("status", "") or "") != "completed":
        raise RuntimeError({"expectedGeneratedCompleted": True, "result": generated_result})
    if str(smart_job.get("status", "") or "") != "completed":
        raise RuntimeError({"expectedSmartCompleted": True, "result": smart_result})
    if generated_job_id not in completed_ids or smart_job_id not in completed_ids:
        raise RuntimeError({"expectedCompletedStatusRows": [generated_job_id, smart_job_id], "status": status_result})
    if int(smart_progress.get("processed", 0) or 0) < 1:
        raise RuntimeError({"expectedSmartAlbumProcessed": True, "progress": smart_progress, "result": smart_result})

    return {
        "enqueueMs": round(enqueue_ms, 2),
        "generatedQueueRunMs": round(generated_run_ms, 2),
        "smartQueueRunMs": round(smart_run_ms, 2),
        "statusMs": round(status_ms, 2),
        "generatedCompleted": generated_job_id in completed_ids,
        "smartCompleted": smart_job_id in completed_ids,
        "generatedProgress": generated_progress,
        "smartProgress": smart_progress,
        "albumId": album_id,
    }


def photo_duplicate_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    now = now_iso()
    asset_total = max(2, asset_count)
    if asset_total % 2:
        asset_total += 1
    duplicate_group_total = asset_total // 2
    rows = []
    metadata_rows = []
    for index in range(duplicate_group_total * 2):
        asset_id = f"perf_duplicate_asset_{index:06d}"
        source_path = f"/synthetic/no-photo-used/photo-duplicates/clip-{index:06d}.mp4"
        group_index = index // 2
        rows.append((
            asset_id,
            source_path,
            "referenced",
            json.dumps({
                "path": source_path,
                "pathKey": source_path,
                "size": 96_000 + index,
                "mtimeNs": 1_800_000_000_000_000_000 + index,
            }, separators=(",", ":")),
            f"photo-duplicate-perf-hash-{group_index:06d}",
            "",
            "video",
            "video/mp4",
            None,
            None,
            45_000 + (index % 1200),
            f"2026-01-{(group_index % 28) + 1:02d}T12:00:00Z",
            now,
            now,
            None,
            "performance-duplicate-budget",
            json.dumps({"source": "performance_budget", "duplicateGroup": group_index}, separators=(",", ":")),
        ))
        metadata_rows.append((
            asset_id,
            f"Duplicate budget {index:06d}",
            "",
            1 if index % 2 == 0 else 0,
            0,
            None,
            None,
            "{}",
            0,
            0,
            now,
        ))
    started = time.perf_counter()
    with api.project.db.connect() as conn:
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_assets(
                asset_id, source_path, source_kind, file_signature_json, content_hash,
                perceptual_hash, media_kind, mime_type, width, height, duration_ms,
                capture_date, added_at, updated_at, missing_at, source_scan_run, metadata_json
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_asset_metadata(
                asset_id, title, caption, favorite, hidden, deleted_at, date_override,
                location_override_json, location_hidden, edited, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            metadata_rows,
        )
    seed_ms = (time.perf_counter() - started) * 1000
    rebuild_result, rebuild_ms = timed(api.project.db.rebuild_photo_duplicate_groups)
    page, page_ms = timed(lambda: api.list_photo_folder_items({
        "folderId": "duplicates",
        "previewBudget": 0,
        "sort": "filename",
        "limit": 250,
    }))
    folders, rail_ms = timed(lambda: api.list_photo_folders({}))
    duplicate_folder = next((folder for folder in folders.get("folders", []) if folder.get("id") == "duplicates"), {})
    with api.project.db.connect() as conn:
        seeded_group_rows = conn.execute(
            """
            SELECT group_id, signature, primary_asset_id
            FROM photo_duplicate_groups
            WHERE algorithm = 'exact_hash'
                AND signature LIKE 'photo-duplicate-perf-hash-%'
            ORDER BY signature ASC
            LIMIT 2
            """
        ).fetchall()
    seeded_groups = [
        {
            "groupId": str(row["group_id"] or ""),
            "signature": str(row["signature"] or ""),
            "primaryAssetId": str(row["primary_asset_id"] or ""),
        }
        for row in seeded_group_rows
    ]
    if not seeded_groups:
        raise RuntimeError({"expectedSeededGroups": True, "rebuild": rebuild_result})

    def invalid_merge() -> str:
        try:
            api.merge_photo_duplicates({
                "groupId": seeded_groups[0]["groupId"],
                "keepAssetId": "not-in-the-duplicate-group",
            })
        except ValueError as exc:
            return str(exc)
        raise RuntimeError("invalid duplicate merge unexpectedly succeeded")

    invalid_merge_message, invalid_merge_ms = timed(invalid_merge)
    merge_result, merge_ms = timed(lambda: api.merge_photo_duplicates({
        "groupId": seeded_groups[0]["groupId"],
        "keepAssetId": seeded_groups[0]["primaryAssetId"],
    }))
    undo_result, undo_ms = timed(lambda: api.undo_photo_operation({
        "operationId": str((merge_result.get("operation") or {}).get("operationId", "") or ""),
    }))
    dismiss_group = seeded_groups[1] if len(seeded_groups) > 1 else seeded_groups[0]
    dismiss_result, dismiss_ms = timed(lambda: api.dismiss_photo_duplicate_group({
        "groupId": dismiss_group["groupId"],
        "reason": "performance budget dismissal",
    }))
    api.project.db.rebuild_photo_duplicate_groups()
    with api.project.db.connect() as conn:
        dismissed_remaining = int(conn.execute(
            "SELECT COUNT(*) AS n FROM photo_duplicate_groups WHERE group_id = ?",
            (dismiss_group["groupId"],),
        ).fetchone()["n"] or 0)
        dismissal_rows = int(conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM photo_duplicate_dismissals
            WHERE algorithm = 'exact_hash' AND signature = ?
            """,
            (dismiss_group["signature"],),
        ).fetchone()["n"] or 0)
    if int(rebuild_result.get("groups", 0) or 0) < duplicate_group_total:
        raise RuntimeError({"expectedGroups": duplicate_group_total, "rebuild": rebuild_result})
    if int(page.get("total", 0) or 0) < duplicate_group_total * 2:
        raise RuntimeError({"expectedItems": duplicate_group_total * 2, "page": page})
    if int(duplicate_folder.get("groupCount", 0) or 0) < duplicate_group_total:
        raise RuntimeError({"expectedGroups": duplicate_group_total, "folder": duplicate_folder})
    if "keepAssetId" not in invalid_merge_message:
        raise RuntimeError({"expectedInvalidMergeError": "keepAssetId", "message": invalid_merge_message})
    if int(merge_result.get("merged", 0) or 0) != 1:
        raise RuntimeError({"expectedMerged": 1, "merge": merge_result})
    if not bool(undo_result.get("undone")) or int(undo_result.get("restored", 0) or 0) != 1:
        raise RuntimeError({"expectedUndoRestore": 1, "undo": undo_result})
    if not bool(dismiss_result.get("dismissed")) or dismissed_remaining != 0 or dismissal_rows < 1:
        raise RuntimeError({
            "expectedDismissed": True,
            "dismiss": dismiss_result,
            "dismissedRemaining": dismissed_remaining,
            "dismissalRows": dismissal_rows,
        })
    return {
        "assetCount": duplicate_group_total * 2,
        "groupCount": duplicate_group_total,
        "seedMs": round(seed_ms, 2),
        "rebuildMs": round(rebuild_ms, 2),
        "pageMs": round(page_ms, 2),
        "railSummaryMs": round(rail_ms, 2),
        "invalidMergeMs": round(invalid_merge_ms, 2),
        "mergeMs": round(merge_ms, 2),
        "mergeUndoMs": round(undo_ms, 2),
        "dismissMs": round(dismiss_ms, 2),
        "pageTotal": int(page.get("total", 0) or 0),
        "pageReturned": len(page.get("items", []) or []),
        "dismissedSignature": dismiss_group["signature"],
    }


def photo_global_search_non_photo_budget(api: DesktopApi, asset_count: int) -> dict[str, Any]:
    total_assets = max(200, int(asset_count))
    album_count = max(40, min(240, total_assets // 10))
    timestamp = now_iso()
    root = "/synthetic/no-photo-used/scale-harbor-sources/global-search-non-photo"
    keyword_id = "perf_global_search_scale_harbor"
    keyword_name = "scale harbor"
    asset_ids: list[str] = []
    source_paths: list[str] = []
    seed_started = time.perf_counter()
    with api.project.db.connect() as conn:
        conn.execute(
            """
            INSERT INTO photo_keywords(keyword_id, name, shortcut, created_at, updated_at)
            VALUES(?, ?, ?, ?, ?)
            ON CONFLICT(keyword_id) DO UPDATE SET
                name=excluded.name,
                shortcut=excluded.shortcut,
                updated_at=excluded.updated_at
            """,
            (keyword_id, keyword_name, "sh", timestamp, timestamp),
        )
        for start in range(0, total_assets, 1000):
            asset_rows = []
            metadata_rows = []
            people_rows = []
            keyword_rows = []
            for index in range(start, min(start + 1000, total_assets)):
                asset_id = f"perf_global_search_{index:07d}"
                source_path = f"{root}/source-folder-{index % 32:02d}/photo-{index:07d}.jpg"
                asset_ids.append(asset_id)
                source_paths.append(source_path)
                capture_date = f"2026-{(index % 12) + 1:02d}-{(index % 28) + 1:02d}T12:00:00Z"
                asset_rows.append((
                    asset_id,
                    source_path,
                    "referenced",
                    json.dumps(
                        {
                            "pathKey": source_path,
                            "size": 320_000 + (index % 4096),
                            "mtimeNs": 1_900_000_000_000_000_000 + index,
                        },
                        separators=(",", ":"),
                    ),
                    f"global-search-content-{index:07d}",
                    "",
                    "image",
                    "image/jpeg",
                    2048,
                    1365,
                    None,
                    capture_date,
                    timestamp,
                    timestamp,
                    None,
                    "perf-global-search",
                    json.dumps(
                        {
                            "camera": {"make": "Synthetic", "model": f"ScaleCam {index % 11}"},
                            "labels": ["scale harbor", f"object-{index % 17}"],
                        },
                        separators=(",", ":"),
                    ),
                ))
                metadata_rows.append((
                    asset_id,
                    f"Scale Harbor frame {index:07d}" if index % 25 == 0 else f"Scale frame {index:07d}",
                    "Large global-search non-photo budget row",
                    1 if index % 31 == 0 else 0,
                    0,
                    None,
                    None,
                    json.dumps(
                        {
                            "label": "Scale Harbor Point",
                            "latitude": 37.7 + (index % 20) / 1000,
                            "longitude": -122.4 - (index % 20) / 1000,
                        },
                        separators=(",", ":"),
                    ),
                    0,
                    0,
                    timestamp,
                ))
                people_rows.append((
                    asset_id,
                    f"perf_global_search_person_{index:07d}",
                    f"Scale Harbor Person {index % 48:02d}",
                    "accepted",
                    0.93,
                    0.86,
                    "synthetic",
                    timestamp,
                ))
                keyword_rows.append((asset_id, keyword_id, timestamp))
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
                    asset_id, title, caption, favorite, hidden, deleted_at, date_override,
                    location_override_json, location_hidden, edited, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                metadata_rows,
            )
            conn.executemany(
                """
                INSERT OR REPLACE INTO photo_asset_people(
                    asset_id, candidate_id, person_name, status, score, quality, band, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                """,
                people_rows,
            )
            conn.executemany(
                """
                INSERT OR IGNORE INTO photo_asset_keywords(asset_id, keyword_id, assigned_at)
                VALUES(?, ?, ?)
                """,
                keyword_rows,
            )

        folder_rows = [
            (f"perf_global_folder_{index:04d}", f"Scale Harbor Folder {index:04d}", None, index, timestamp, timestamp)
            for index in range(max(1, album_count // 4))
        ]
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_album_folders(
                folder_id, name, parent_folder_id, position, created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?)
            """,
            folder_rows,
        )
        album_rows = []
        album_item_rows = []
        for index in range(album_count):
            album_id = f"perf_global_album_{index:04d}"
            folder_id = folder_rows[index % len(folder_rows)][0]
            album_rows.append((
                album_id,
                f"Scale Harbor Album {index:04d}",
                "manual",
                "Global search scale fixture",
                folder_id,
                index,
                "[]",
                "[]",
                "{}",
                source_paths[index % len(source_paths)],
                timestamp,
                timestamp,
            ))
            for position in range(3):
                asset_id = asset_ids[(index * 7 + position) % len(asset_ids)]
                album_item_rows.append((album_id, asset_id, position, timestamp))
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_albums(
                album_id, name, album_kind, description, folder_id, folder_position,
                include_people_json, exclude_people_json, rules_json, cover_source_path,
                created_at, updated_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            album_rows,
        )
        conn.executemany(
            """
            INSERT OR REPLACE INTO photo_album_items(album_id, asset_id, position, added_at)
            VALUES(?, ?, ?, ?)
            """,
            album_item_rows,
        )
    seed_ms = (time.perf_counter() - seed_started) * 1000

    api.project.db.rebuild_photo_search_index()
    api.project.db.save_photo_generated_collection_cache(
        "",
        {
            "signature": "performance-global-search-non-photo",
            "assetCount": total_assets,
            "trips": [
                {
                    "tripId": "performance-scale-harbor-trip",
                    "name": "Scale Harbor Trip",
                    "count": min(24, total_assets),
                    "coverSourcePath": source_paths[0],
                    "sourcePaths": source_paths[: min(24, total_assets)],
                    "dateRangeLabel": "2026",
                    "locationLabel": "Scale Harbor Point",
                }
            ],
            "memories": [
                {
                    "memoryId": "performance-scale-harbor-memory",
                    "name": "Scale Harbor Memory",
                    "subtitle": "Large library search cache",
                    "category": "user",
                    "count": min(24, total_assets),
                    "coverSourcePath": source_paths[0],
                    "sourcePaths": source_paths[: min(24, total_assets)],
                    "dateRangeLabel": "2026",
                }
            ],
        },
    )

    original_list_photo_folders = api.list_photo_folders
    original_generated_collections = api._photo_generated_collection_summaries
    original_trip_summaries = api._photo_trip_summaries
    original_memory_summaries = api._photo_memory_summaries
    original_album_folder_items = api._photo_album_folder_collection_items
    original_album_items = api._photo_album_items

    def fail_full_rail(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("performance global search should not call the full Photos rail builder")

    api.list_photo_folders = fail_full_rail
    api._photo_generated_collection_summaries = fail_full_rail
    api._photo_trip_summaries = fail_full_rail
    api._photo_memory_summaries = fail_full_rail
    api._photo_album_folder_collection_items = fail_full_rail
    api._photo_album_items = fail_full_rail
    try:
        result, search_ms = timed(lambda: api.search_photo_library({
            "query": "Scale Harbor",
            "limit": 12,
            "suggestionLimit": 48,
        }))
    finally:
        api.list_photo_folders = original_list_photo_folders
        api._photo_generated_collection_summaries = original_generated_collections
        api._photo_trip_summaries = original_trip_summaries
        api._photo_memory_summaries = original_memory_summaries
        api._photo_album_folder_collection_items = original_album_folder_items
        api._photo_album_items = original_album_items

    groups = {str(group.get("id", "") or ""): group for group in result.get("groups", []) if isinstance(group, dict)}
    required_groups = {"photos", "albums", "people", "places", "trips", "memories", "keywords", "sourceFolders"}
    missing_groups = sorted(required_groups.difference(groups))
    if missing_groups:
        raise RuntimeError({"missingGroups": missing_groups, "search": result})
    return {
        "assetCount": total_assets,
        "albumCount": album_count,
        "seedMs": round(seed_ms, 2),
        "searchMs": round(search_ms, 2),
        "groupIds": sorted(groups),
        "suggestionCount": len(result.get("suggestions", []) if isinstance(result.get("suggestions", []), list) else []),
        "albumReturned": int(groups["albums"].get("returned", 0) or 0),
        "peopleReturned": int(groups["people"].get("returned", 0) or 0),
        "sourceFolderReturned": int(groups["sourceFolders"].get("returned", 0) or 0),
    }


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
    adapter_rows = env_int("VINTRACE_PERF_BUDGET_ADAPTER_ROWS", 2_000)
    photo_export_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_EXPORT_ASSETS", 40)
    photo_export_failure_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_EXPORT_FAILURE_ASSETS", 16)
    photo_preview_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_PREVIEW_ASSETS", 24)
    photo_preview_failure_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_PREVIEW_FAILURE_ASSETS", 16)
    photo_metadata_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_METADATA_ASSETS", 96)
    photo_ocr_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_OCR_ASSETS", 64)
    photo_ocr_worker_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_OCR_WORKER_ASSETS", 32)
    photo_duplicate_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_DUPLICATE_ASSETS", 2_000)
    photo_global_search_assets = env_int("VINTRACE_PERF_BUDGET_PHOTO_GLOBAL_SEARCH_ASSETS", 2_000)
    root = Path(tempfile.mkdtemp(prefix="vintrace-performance-budget-"))
    registry = str(root / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry

    api, startup_ms = timed(lambda: DesktopApi(root / "workspace", actor="performance-budget"))
    seed_candidate_ms = seed_candidates(api, candidate_count)
    state, dashboard_state_ms = timed(lambda: api.state(preview_create_budget=0, candidate_limit=500))
    _encoded, serialize_ms = timed(lambda: json.dumps(state, separators=(",", ":")))
    page_times = []
    for offset in [0, 250, 1_000, 5_000, max(candidate_count - 500, 0)]:
        _page, elapsed = timed(lambda offset=offset: api.handle("query_candidates", {"status": "all", "sort": "score", "offset": offset, "limit": 250, "previewBudget": 0}))
        page_times.append(elapsed)
    _preview_state, preview_window_ms = timed(lambda: api.state(preview_create_budget=8, candidate_limit=250))
    photo_export_runtime = photo_export_budget(api, photo_export_assets)
    photo_export_failure_runtime = photo_export_failure_budget(api, photo_export_failure_assets)
    photo_preview_runtime = photo_preview_budget(api, photo_preview_assets)
    photo_preview_failure_runtime = photo_preview_failure_budget(api, photo_preview_failure_assets)
    photo_metadata_runtime = photo_metadata_budget(api, photo_metadata_assets)
    photo_ocr_runtime = photo_ocr_budget(api, photo_ocr_assets)
    photo_ocr_worker_runtime = photo_ocr_worker_queue_budget(api, photo_ocr_worker_assets)
    photo_catalog_queue_runtime = photo_catalog_queue_budget(api)
    photo_duplicate_runtime = photo_duplicate_budget(api, photo_duplicate_assets)
    photo_global_search_runtime = photo_global_search_non_photo_budget(api, photo_global_search_assets)
    seed_manifest_ms = seed_scan_manifest(api, manifest_count)
    _scan_state, scan_manifest_state_ms = timed(lambda: api.state(preview_create_budget=0, candidate_limit=250))
    runtime, runtime_benchmark_ms = timed(api.runtime_benchmark)
    adapter_runtime = adapter_runtime_budget(adapter_rows)
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
        "adapterScoreBaselineMs": adapter_runtime["baselineScoreMs"],
        "adapterScoreAfterMs": adapter_runtime["adapterScoreMs"],
        "adapterScoreOverheadUs": adapter_runtime["adapterScoreOverheadUs"],
        "photoOriginalExportMs": photo_export_runtime["originalExportMs"],
        "photoRenderedExportMs": photo_export_runtime["renderedExportMs"],
        "photoRenderedVideoExportMs": photo_export_runtime["renderedVideoExportMs"],
        "photoSlideshowMovieExportMs": photo_export_runtime["slideshowMovieExportMs"],
        "photoContactSheetExportMs": photo_export_runtime["contactSheetExportMs"],
        "photoExportFailureSelectionMs": photo_export_failure_runtime["selectionExportMs"],
        "photoExportFailureContactSheetMs": photo_export_failure_runtime["contactSheetExportMs"],
        "photoPreviewRebuildMs": photo_preview_runtime["rebuildMs"],
        "photoPreviewSweepMs": photo_preview_runtime["sweepMs"],
        "photoPreviewFailureRebuildMs": photo_preview_failure_runtime["rebuildMs"],
        "photoPreviewFailureSweepMs": photo_preview_failure_runtime["sweepMs"],
        "photoMetadataBatchUpdateMs": photo_metadata_runtime["batchUpdateMs"],
        "photoMetadataListSearchMs": photo_metadata_runtime["listSearchMs"],
        "photoMetadataGlobalSearchMs": photo_metadata_runtime["globalSearchMs"],
        "photoMetadataKeywordListMs": photo_metadata_runtime["keywordListMs"],
        "photoMetadataSearchIndexRebuildMs": photo_metadata_runtime["searchIndexRebuildMs"],
        "photoMetadataPostRebuildSearchMs": photo_metadata_runtime["postRebuildSearchMs"],
        "photoOcrFirstBatchMs": photo_ocr_runtime["firstBatchMs"],
        "photoOcrQueueDrainMs": photo_ocr_runtime["queueDrainMs"],
        "photoOcrStatusMs": photo_ocr_runtime["statusMs"],
        "photoOcrWorkerEnqueueMs": photo_ocr_worker_runtime["enqueueMs"],
        "photoOcrWorkerQueueRunMs": photo_ocr_worker_runtime["queueRunMs"],
        "photoOcrWorkerStatusMs": photo_ocr_worker_runtime["statusMs"],
        "photoOcrWorkerSearchMs": photo_ocr_worker_runtime["searchMs"],
        "photoCatalogQueueEnqueueMs": photo_catalog_queue_runtime["enqueueMs"],
        "photoGeneratedCollectionsQueueRunMs": photo_catalog_queue_runtime["generatedQueueRunMs"],
        "photoSmartAlbumsQueueRunMs": photo_catalog_queue_runtime["smartQueueRunMs"],
        "photoCatalogQueueStatusMs": photo_catalog_queue_runtime["statusMs"],
        "photoDuplicateRebuildMs": photo_duplicate_runtime["rebuildMs"],
        "photoDuplicatePageMs": photo_duplicate_runtime["pageMs"],
        "photoDuplicateRailSummaryMs": photo_duplicate_runtime["railSummaryMs"],
        "photoDuplicateInvalidMergeMs": photo_duplicate_runtime["invalidMergeMs"],
        "photoDuplicateMergeMs": photo_duplicate_runtime["mergeMs"],
        "photoDuplicateMergeUndoMs": photo_duplicate_runtime["mergeUndoMs"],
        "photoDuplicateDismissMs": photo_duplicate_runtime["dismissMs"],
        "photoGlobalNonPhotoSearchMs": photo_global_search_runtime["searchMs"],
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
        "photoOriginalExportMs": budget("photo_original_export", 8000),
        "photoRenderedExportMs": budget("photo_rendered_export", 12000),
        "photoRenderedVideoExportMs": budget("photo_rendered_video_export", 10000),
        "photoSlideshowMovieExportMs": budget("photo_slideshow_movie_export", 15000),
        "photoContactSheetExportMs": budget("photo_contact_sheet_export", 10000),
        "photoExportFailureSelectionMs": budget("photo_export_failure_selection", 8000),
        "photoExportFailureContactSheetMs": budget("photo_export_failure_contact_sheet", 10000),
        "photoPreviewRebuildMs": budget("photo_preview_rebuild", 10000),
        "photoPreviewSweepMs": budget("photo_preview_sweep", 12000),
        "photoPreviewFailureRebuildMs": budget("photo_preview_failure_rebuild", 10000),
        "photoPreviewFailureSweepMs": budget("photo_preview_failure_sweep", 12000),
        "photoMetadataBatchUpdateMs": budget("photo_metadata_batch_update", 10000),
        "photoMetadataListSearchMs": budget("photo_metadata_list_search", 6000),
        "photoMetadataGlobalSearchMs": budget("photo_metadata_global_search", 8000),
        "photoMetadataKeywordListMs": budget("photo_metadata_keyword_list", 3000),
        "photoMetadataSearchIndexRebuildMs": budget("photo_metadata_search_index_rebuild", 8000),
        "photoMetadataPostRebuildSearchMs": budget("photo_metadata_post_rebuild_search", 6000),
        "photoOcrFirstBatchMs": budget("photo_ocr_first_batch", 10000),
        "photoOcrQueueDrainMs": budget("photo_ocr_queue_drain", 15000),
        "photoOcrStatusMs": budget("photo_ocr_status", 5000),
        "photoOcrWorkerEnqueueMs": budget("photo_ocr_worker_enqueue", 5000),
        "photoOcrWorkerQueueRunMs": budget("photo_ocr_worker_queue_run", 15000),
        "photoOcrWorkerStatusMs": budget("photo_ocr_worker_status", 5000),
        "photoOcrWorkerSearchMs": budget("photo_ocr_worker_search", 8000),
        "photoCatalogQueueEnqueueMs": budget("photo_catalog_queue_enqueue", 5000),
        "photoGeneratedCollectionsQueueRunMs": budget("photo_generated_collections_queue_run", 10000),
        "photoSmartAlbumsQueueRunMs": budget("photo_smart_albums_queue_run", 10000),
        "photoCatalogQueueStatusMs": budget("photo_catalog_queue_status", 5000),
        "photoDuplicateRebuildMs": budget("photo_duplicate_rebuild", 10000),
        "photoDuplicatePageMs": budget("photo_duplicate_page", 12000),
        "photoDuplicateRailSummaryMs": budget("photo_duplicate_rail_summary", 10000),
        "photoDuplicateInvalidMergeMs": budget("photo_duplicate_invalid_merge", 10000),
        "photoDuplicateMergeMs": budget("photo_duplicate_merge", 10000),
        "photoDuplicateMergeUndoMs": budget("photo_duplicate_merge_undo", 10000),
        "photoDuplicateDismissMs": budget("photo_duplicate_dismiss", 10000),
        "photoGlobalNonPhotoSearchMs": budget("photo_global_non_photo_search", 8000),
    }
    checks = [
        {"name": name, "ok": metrics[name] <= limit, "valueMs": metrics[name], "budgetMs": limit}
        for name, limit in budgets.items()
    ]
    checks.append({"name": "candidate window is paged", "ok": state["candidateWindow"]["truncated"] is True, "value": state["candidateWindow"]})
    checks.append({"name": "candidate index is sqlite", "ok": state["candidateWindow"]["index"] == "sqlite", "value": state["candidateWindow"]})
    checks.append({"name": "scan manifest scale", "ok": scan_manifest_state_ms <= budgets["scanManifestStateMs"] and manifest_count >= 100_000, "value": manifest_count})
    checks.append(
        {
            "name": "photo export asset count",
            "ok": photo_export_runtime["assetCount"] >= min(40, photo_export_assets),
            "value": photo_export_runtime,
        }
    )
    checks.append(
        {
            "name": "photo export missing-original failure state",
            "ok": photo_export_failure_runtime["assetCount"] >= min(16, photo_export_failure_assets)
            and photo_export_failure_runtime["missingAssetCount"] >= 1
            and photo_export_failure_runtime["selectionCopied"] == photo_export_failure_runtime["validAssetCount"]
            and photo_export_failure_runtime["selectionMissing"] == photo_export_failure_runtime["missingAssetCount"]
            and photo_export_failure_runtime["selectionMetadata"] == photo_export_failure_runtime["validAssetCount"]
            and photo_export_failure_runtime["selectionManifestMissingRows"] == photo_export_failure_runtime["missingAssetCount"]
            and photo_export_failure_runtime["selectionManifestCopiedRows"] == photo_export_failure_runtime["validAssetCount"]
            and photo_export_failure_runtime["contactIncluded"] == photo_export_failure_runtime["validAssetCount"]
            and photo_export_failure_runtime["contactMissing"] == photo_export_failure_runtime["missingAssetCount"]
            and photo_export_failure_runtime["contactManifestMissingRows"] == photo_export_failure_runtime["missingAssetCount"],
            "value": photo_export_failure_runtime,
        }
    )
    checks.append(
        {
            "name": "photo preview asset count",
            "ok": photo_preview_runtime["assetCount"] >= min(24, photo_preview_assets),
            "value": photo_preview_runtime,
        }
    )
    checks.append(
        {
            "name": "photo preview missing-original failure state",
            "ok": photo_preview_failure_runtime["assetCount"] >= min(16, photo_preview_failure_assets)
            and photo_preview_failure_runtime["missingOriginalCount"] >= 1
            and photo_preview_failure_runtime["validAssetCount"] >= photo_preview_failure_runtime["directRebuildAssetCount"]
            and photo_preview_failure_runtime["rebuildGeneratedPreviews"] == photo_preview_failure_runtime["directRebuildAssetCount"]
            and photo_preview_failure_runtime["rebuildSkipped"] == photo_preview_failure_runtime["missingOriginalCount"]
            and photo_preview_failure_runtime["rebuildFailed"] == 0
            and photo_preview_failure_runtime["sweepMissingOriginals"] == photo_preview_failure_runtime["missingOriginalCount"]
            and photo_preview_failure_runtime["sweepEligibleAssets"] == photo_preview_failure_runtime["validAssetCount"]
            and photo_preview_failure_runtime["sweepCachedPreviews"] == photo_preview_failure_runtime["directRebuildAssetCount"]
            and photo_preview_failure_runtime["sweepMissingCachedPreviews"] == photo_preview_failure_runtime["sweepRepairAssetCount"]
            and photo_preview_failure_runtime["sweepSelectedAssets"] == photo_preview_failure_runtime["sweepRepairAssetCount"]
            and photo_preview_failure_runtime["sweepGeneratedPreviews"] == photo_preview_failure_runtime["sweepRepairAssetCount"]
            and photo_preview_failure_runtime["sweepFailedPreviews"] == 0
            and photo_preview_failure_runtime["sweepRemainingMissingCachedPreviews"] == 0
            and photo_preview_failure_runtime["missingOriginalSamples"] >= 1
            and photo_preview_failure_runtime["sweepOk"] is True,
            "value": photo_preview_failure_runtime,
        }
    )
    checks.append(
        {
            "name": "photo global non-photo search stays bounded",
            "ok": photo_global_search_runtime["assetCount"] >= min(2_000, photo_global_search_assets)
            and photo_global_search_runtime["albumCount"] >= 40
            and photo_global_search_runtime["albumReturned"] > 0
            and photo_global_search_runtime["peopleReturned"] > 0
            and photo_global_search_runtime["sourceFolderReturned"] > 0
            and {"albums", "people", "places", "trips", "memories", "keywords", "sourceFolders"}.issubset(set(photo_global_search_runtime["groupIds"])),
            "value": photo_global_search_runtime,
        }
    )
    checks.append(
        {
            "name": "photo metadata indexing asset count",
            "ok": photo_metadata_runtime["assetCount"] >= min(96, photo_metadata_assets)
            and photo_metadata_runtime["updated"] == photo_metadata_runtime["assetCount"]
            and photo_metadata_runtime["metadataRows"] == photo_metadata_runtime["assetCount"]
            and photo_metadata_runtime["locationRows"] == photo_metadata_runtime["assetCount"]
            and photo_metadata_runtime["keywordAssignments"] >= photo_metadata_runtime["assetCount"] * 3,
            "value": photo_metadata_runtime,
        }
    )
    checks.append(
        {
            "name": "photo ocr sidecar queue asset count",
            "ok": photo_ocr_runtime["assetCount"] >= min(64, photo_ocr_assets)
            and photo_ocr_runtime["indexedCount"] == photo_ocr_runtime["assetCount"],
            "value": photo_ocr_runtime,
        }
    )
    checks.append(
        {
            "name": "photo ocr sidecar queue defers first batch",
            "ok": photo_ocr_runtime["assetCount"] <= photo_ocr_runtime["batchLimit"]
            or photo_ocr_runtime["firstBatchDeferred"] > 0,
            "value": photo_ocr_runtime,
        }
    )
    checks.append(
        {
            "name": "photo ocr durable worker queue asset count",
            "ok": photo_ocr_worker_runtime["assetCount"] >= min(32, photo_ocr_worker_assets)
            and photo_ocr_worker_runtime["indexedCount"] == photo_ocr_worker_runtime["assetCount"]
            and photo_ocr_worker_runtime["updatedCount"] == photo_ocr_worker_runtime["assetCount"]
            and photo_ocr_worker_runtime["completedJobs"] == photo_ocr_worker_runtime["jobCount"]
            and photo_ocr_worker_runtime["failedCount"] == 0,
            "value": photo_ocr_worker_runtime,
        }
    )
    checks.append(
        {
            "name": "photo catalog queue completed",
            "ok": bool(photo_catalog_queue_runtime["generatedCompleted"])
            and bool(photo_catalog_queue_runtime["smartCompleted"])
            and int(photo_catalog_queue_runtime["smartProgress"].get("processed", 0) or 0) >= 1,
            "value": photo_catalog_queue_runtime,
        }
    )
    checks.append(
        {
            "name": "photo duplicate asset count",
            "ok": photo_duplicate_runtime["assetCount"] >= min(2000, photo_duplicate_assets),
            "value": photo_duplicate_runtime,
        }
    )
    checks.append(
        {
            "name": "adapter score overhead",
            "ok": adapter_runtime["adapterScoreOverheadUs"] <= budget("adapter_score_overhead_us", 250.0),
            "valueUs": adapter_runtime["adapterScoreOverheadUs"],
            "baselineMs": adapter_runtime["baselineScoreMs"],
            "afterMs": adapter_runtime["adapterScoreMs"],
            "rows": adapter_runtime["rows"],
        }
    )

    result = {
        "generatedAt": now_iso(),
        "ok": all(check["ok"] for check in checks),
        "candidateCount": candidate_count,
        "scanManifestFiles": manifest_count,
        "metrics": metrics,
        "adapterRuntime": adapter_runtime,
        "photoExportRuntime": photo_export_runtime,
        "photoExportFailureRuntime": photo_export_failure_runtime,
        "photoPreviewRuntime": photo_preview_runtime,
        "photoPreviewFailureRuntime": photo_preview_failure_runtime,
        "photoMetadataRuntime": photo_metadata_runtime,
        "photoOcrRuntime": photo_ocr_runtime,
        "photoOcrWorkerRuntime": photo_ocr_worker_runtime,
        "photoCatalogQueueRuntime": photo_catalog_queue_runtime,
        "photoDuplicateRuntime": photo_duplicate_runtime,
        "budgets": budgets,
        "checks": checks,
    }
    print(json.dumps(result, indent=2))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

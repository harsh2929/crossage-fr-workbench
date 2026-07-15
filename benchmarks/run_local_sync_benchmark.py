#!/usr/bin/env python3
"""Scale gate for encrypted local-first catalog synchronization."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import platform
import resource
import socket
import tempfile
from time import perf_counter
from typing import Any

from crossage_fr.local_sync import LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE, LocalSyncManager
from crossage_fr.store.workspace_db import WorkspaceDb
from crossage_fr.store.workspace_encryption import WorkspaceEncryption
from crossage_fr.workspace_registry import now_iso


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "benchmarks" / "results" / "local-sync-benchmark-20260713.json"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def peak_rss_mib() -> float:
    value = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
    if platform.system() == "Darwin":
        return value / (1024 * 1024)
    return value / 1024


def make_manager(root: Path, name: str) -> tuple[WorkspaceDb, LocalSyncManager]:
    workspace = root / name
    encryption = WorkspaceEncryption(
        workspace,
        hashlib.sha256(f"local-sync-benchmark:{name}".encode("ascii")).digest(),
        required=True,
    )
    db = WorkspaceDb(workspace / "workspace.sqlite3", encryption=encryption)
    manager = LocalSyncManager(workspace, db, encryption)
    manager.initialize(name)
    return db, manager


def content_hash(index: int) -> str:
    return hashlib.sha256(f"vintrace-local-sync-asset:{index:06d}".encode("ascii")).hexdigest()


def seed_assets(db: WorkspaceDb, *, assets: int, authored: bool) -> None:
    timestamp = now_iso()
    with db.connect() as conn:
        conn.executemany(
            """
            INSERT INTO photo_assets(
                asset_id, source_path, content_hash, media_kind, mime_type,
                width, height, capture_date, added_at, updated_at
            ) VALUES(?, ?, ?, 'image', 'image/jpeg', 32, 24, ?, ?, ?)
            """,
            [
                (
                    f"benchmark-asset-{index:06d}",
                    f"/benchmark/{'source' if authored else 'target'}/asset-{index:06d}.jpg",
                    content_hash(index),
                    f"2025-01-{(index % 28) + 1:02d}T12:00:00Z" if authored else "",
                    timestamp,
                    timestamp,
                )
                for index in range(assets)
            ],
        )
        conn.executemany(
            """
            INSERT INTO photo_asset_metadata(
                asset_id, title, caption, favorite, hidden, deleted_at,
                date_override, location_override_json, location_hidden, edited, updated_at
            ) VALUES(?, ?, ?, ?, 0, NULL, ?, ?, 0, 0, ?)
            """,
            [
                (
                    f"benchmark-asset-{index:06d}",
                    f"Benchmark title {index:06d}" if authored else "",
                    f"Signed catalog metadata row {index:06d}" if authored else "",
                    int(authored and index % 3 == 0),
                    f"2025-02-{(index % 28) + 1:02d}" if authored else None,
                    json.dumps(
                        {"label": f"Benchmark place {index % 20}", "latitude": 10 + index / 10000, "longitude": 20 + index / 10000},
                        separators=(",", ":"),
                    ) if authored else "{}",
                    timestamp,
                )
                for index in range(assets)
            ],
        )
        if authored:
            conn.execute(
                "INSERT INTO photo_keywords(keyword_id, name, shortcut, created_at, updated_at) VALUES('benchmark-keyword', 'Scale gate', '', ?, ?)",
                (timestamp, timestamp),
            )
            conn.executemany(
                "INSERT INTO photo_asset_keywords(asset_id, keyword_id, assigned_at) VALUES(?, 'benchmark-keyword', ?)",
                [(f"benchmark-asset-{index:06d}", timestamp) for index in range(assets)],
            )


def metadata_sample(db: WorkspaceDb, index: int) -> dict[str, Any]:
    asset_id = f"benchmark-asset-{index:06d}"
    value = db.photo_asset_metadata_by_id(asset_id)
    return {
        "title": value.get("title"),
        "caption": value.get("caption"),
        "favorite": value.get("favorite"),
        "dateOverride": value.get("dateOverride"),
        "captureDate": db.photo_asset_by_id(asset_id).get("captureDate"),
        "locationLabel": value.get("locationOverride", {}).get("label"),
        "keywords": db.list_photo_asset_keywords(asset_id),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark encrypted local catalog sync.")
    parser.add_argument("--assets", type=int, default=1_000)
    parser.add_argument("--capture-budget-seconds", type=float, default=30.0)
    parser.add_argument("--merge-budget-seconds", type=float, default=30.0)
    parser.add_argument("--apply-budget-seconds", type=float, default=45.0)
    parser.add_argument("--rss-growth-budget-mib", type=float, default=512.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    assets = max(100, min(10_000, int(args.assets)))
    expected_operations = assets * 10
    output = args.output.expanduser().resolve()
    original_connect = socket.socket.connect
    original_create_connection = socket.create_connection
    outbound_attempts: list[str] = []

    def blocked_connect(_socket: socket.socket, address: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Local sync scale evaluation must not access the network.")

    def blocked_create_connection(address: Any, *_args: Any, **_kwargs: Any) -> None:
        outbound_attempts.append(repr(address))
        raise AssertionError("Local sync scale evaluation must not access the network.")

    try:
        socket.socket.connect = blocked_connect
        socket.create_connection = blocked_create_connection
        with tempfile.TemporaryDirectory(prefix="vintrace-local-sync-benchmark-") as temp_value:
            temp = Path(temp_value)
            source_db, source = make_manager(temp, "source")
            target_db, target = make_manager(temp, "target")
            rss_before = peak_rss_mib()

            seed_started = perf_counter()
            seed_assets(source_db, assets=assets, authored=True)
            seed_seconds = perf_counter() - seed_started
            capture_started = perf_counter()
            captured = source.capture_local_changes(limit=assets)
            capture_seconds = perf_counter() - capture_started
            source_status = source.status()

            merge_started = perf_counter()
            pages = transferred = inserted = pending_pages = 0
            while True:
                page = source.export_operations(target.clock(), limit=LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE)
                merged = target.merge_operations(page["operations"], sender_device_id=source_status["deviceId"])
                pages += 1
                transferred += len(page["operations"])
                inserted += int(merged["inserted"])
                pending_pages += int(merged["pendingAssets"])
                if not page["hasMore"]:
                    break
            merge_seconds = perf_counter() - merge_started
            pending_before_import = target.status()["counts"]["pendingAssets"]

            apply_started = perf_counter()
            seed_assets(target_db, assets=assets, authored=False)
            applied_capture = target.capture_local_changes(limit=assets)
            apply_seconds = perf_counter() - apply_started
            target_status = target.status()
            rss_after = peak_rss_mib()
            source_operations = source.export_operations({}, limit=LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE)["operations"]
            serialized_page = json.dumps(source_operations, sort_keys=True)
            samples = {str(index): metadata_sample(target_db, index) for index in (0, assets // 2, assets - 1)}
            expected_samples = all(
                sample["title"] == f"Benchmark title {index:06d}"
                and sample["caption"] == f"Signed catalog metadata row {index:06d}"
                and sample["favorite"] is (index % 3 == 0)
                and sample["dateOverride"] == f"2025-02-{(index % 28) + 1:02d}"
                and sample["captureDate"] == f"2025-01-{(index % 28) + 1:02d}T12:00:00Z"
                and sample["locationLabel"] == f"Benchmark place {index % 20}"
                and sample["keywords"] == ["Scale gate"]
                for index, sample in ((int(key), value) for key, value in samples.items())
            )
            rss_growth = max(0.0, rss_after - rss_before)
            checks = {
                "exactOperationCount": captured["capturedOperations"] == expected_operations
                and source_status["counts"]["operations"] == expected_operations,
                "boundedPages": pages == (expected_operations + LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE - 1) // LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE,
                "completeTransfer": transferred == inserted == expected_operations,
                "vectorClockConverged": target.clock() == source.clock(),
                "pendingUntilOriginal": pending_before_import == assets and pending_pages >= assets,
                "lateOriginalApplied": target_status["counts"]["pendingAssets"] == 0 and expected_samples,
                "noSpuriousLocalOperations": applied_capture["capturedOperations"] == 0,
                "noConflicts": target_status["counts"]["conflicts"] == 0,
                "pathFreePayload": "/benchmark/" not in serialized_page and "source_path" not in serialized_page.casefold(),
                "metadataOnly": all(row.get("entityType") == "asset" and row.get("field") in source_status["scope"]["fields"] for row in source_operations),
                "encryptedDatabases": all(
                    not (temp / name / "workspace.sqlite3").read_bytes().startswith(b"SQLite format 3\x00")
                    for name in ("source", "target")
                ),
                "offline": not outbound_attempts,
                "captureBudget": capture_seconds <= float(args.capture_budget_seconds),
                "mergeBudget": merge_seconds <= float(args.merge_budget_seconds),
                "applyBudget": apply_seconds <= float(args.apply_budget_seconds),
                "rssGrowthBudget": rss_growth <= float(args.rss_growth_budget_mib),
            }
            report = {
                "schemaVersion": 1,
                "benchmarkId": "vintrace-encrypted-local-sync-v1",
                "protocol": "vintrace-local-sync-v1",
                "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "platform": platform.platform(),
                "python": platform.python_version(),
                "dataset": {
                    "synthetic": True,
                    "assets": assets,
                    "fieldsPerAsset": 10,
                    "operations": expected_operations,
                    "contentIdentity": "deterministic SHA-256",
                    "mediaBytes": 0,
                    "biometricRows": 0,
                },
                "budgets": {
                    "captureSeconds": float(args.capture_budget_seconds),
                    "mergeSeconds": float(args.merge_budget_seconds),
                    "applySeconds": float(args.apply_budget_seconds),
                    "rssGrowthMiB": float(args.rss_growth_budget_mib),
                    "operationsPerPage": LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE,
                },
                "timing": {
                    "seedSeconds": round(seed_seconds, 4),
                    "captureSeconds": round(capture_seconds, 4),
                    "mergeSeconds": round(merge_seconds, 4),
                    "lateOriginalApplySeconds": round(apply_seconds, 4),
                },
                "memory": {
                    "peakBeforeMiB": round(rss_before, 3),
                    "peakAfterMiB": round(rss_after, 3),
                    "growthMiB": round(rss_growth, 3),
                },
                "transfer": {
                    "pages": pages,
                    "transferredOperations": transferred,
                    "insertedOperations": inserted,
                    "pendingAssetsBeforeImport": pending_before_import,
                    "pendingAssetsAfterImport": target_status["counts"]["pendingAssets"],
                },
                "samples": samples,
                "outboundAttempts": outbound_attempts,
                "checks": checks,
                "passed": all(checks.values()),
            }
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
            print(json.dumps({
                "report": str(output),
                "sha256": sha256_file(output),
                "dataset": report["dataset"],
                "timing": report["timing"],
                "memory": report["memory"],
                "transfer": report["transfer"],
                "checks": checks,
                "passed": report["passed"],
            }, indent=2, sort_keys=True))
            if not report["passed"]:
                raise SystemExit(1)
    finally:
        socket.socket.connect = original_connect
        socket.create_connection = original_create_connection


if __name__ == "__main__":
    main()

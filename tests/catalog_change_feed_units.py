"""Regression coverage for the unconditional, cursor-paged catalog change feed.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/catalog_change_feed_units.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.agent_images import AgentImageService
from crossage_fr.agent_openapi import agent_images_openapi_spec
from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature


def check(label: str, condition: bool) -> None:
    if not condition:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _upsert(api: DesktopApi, path: Path, content_hash: str) -> str:
    with api.project.db.connect() as conn:
        asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(path),
            content_hash=content_hash,
            file_signature=path_signature(path),
        )
    return asset_id


def _service(api: DesktopApi, root: Path) -> AgentImageService:
    return AgentImageService(
        api,
        workspace=root,
        require_consent=lambda: None,
        validate_path=lambda value: Path(value),
    )


def _all_changes(service: AgentImageService, after_seq: int = 0) -> tuple[list[dict], int]:
    items: list[dict] = []
    cursor = after_seq
    for _ in range(100):
        result = service.changes(after_seq=cursor, limit=2)
        data = result["data"]
        page_items = list(data["items"])
        items.extend(page_items)
        next_cursor = int(data["cursor"]["nextAfterSeq"])
        check("cursor advances when a page contains changes", not page_items or next_cursor > cursor)
        cursor = next_cursor
        if not result["page"]["hasMore"]:
            return items, cursor
    raise AssertionError("change feed did not terminate")


def _check_migration_baseline(root: Path, photo: Path, asset_id: str) -> None:
    api = DesktopApi(root, actor="change-feed-baseline-test")
    with api.project.db.connect() as conn:
        conn.execute("DELETE FROM photo_catalog_changes")
        conn.execute("DELETE FROM meta WHERE key = 'photoCatalogChangeBaselineVersion'")

    reopened = DesktopApi(root, actor="change-feed-baseline-reopen")
    page = reopened.project.db.photo_catalog_change_page(after_seq=0, limit=10)
    check("schema upgrade backfills existing assets", len(page["items"]) == 1)
    check("baseline keeps the existing stable asset id", page["items"][0]["assetId"] == asset_id)
    check("baseline is explicitly identified", page["items"][0]["scope"] == "baseline")
    check("baseline does not need the source file to move", photo.is_file())


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-change-feed-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        photo = root / "photo.jpg"
        Image.new("RGB", (64, 48), (35, 90, 145)).save(photo)

        api = DesktopApi(workspace, actor="change-feed-test")
        db = api.project.db
        check("fixture is an unencrypted workspace", db.encryption.enabled is False)
        asset_id = _upsert(api, photo, "a" * 64)
        second_photo = root / "second-photo.jpg"
        Image.new("RGB", (64, 48), (145, 90, 35)).save(second_photo)
        second_asset_id = _upsert(api, second_photo, "c" * 64)

        with db.connect() as conn:
            operation_count = int(conn.execute("SELECT COUNT(*) AS n FROM photo_sync_operations").fetchone()["n"])
            journal_count = int(conn.execute("SELECT COUNT(*) AS n FROM photo_catalog_changes").fetchone()["n"])
        check("signed CRDT op-log remains empty without an encrypted identity", operation_count == 0)
        check("catalog journal still records the import unconditionally", journal_count >= 1)

        before_updates = db.photo_catalog_change_page(after_seq=0, limit=500)["latestSeq"]
        with db.connect() as conn:
            conn.execute(
                "UPDATE photo_asset_metadata SET favorite = 1, updated_at = ? WHERE asset_id = ?",
                ("2026-07-15T01:00:00Z", asset_id),
            )
            conn.execute(
                "UPDATE photo_asset_metadata SET rating = 5, updated_at = ? WHERE asset_id = ?",
                ("2026-07-15T01:00:01Z", asset_id),
            )
        metadata_changes = db.photo_catalog_change_page(after_seq=before_updates, limit=20)["items"]
        check("two updates produce two ordered log records", len(metadata_changes) == 2)
        check(
            "the change journal does not coalesce repeated asset updates",
            metadata_changes[0]["seq"] < metadata_changes[1]["seq"]
            and all(item["scope"] == "metadata" for item in metadata_changes),
        )

        now = "2026-07-15T01:01:00Z"
        with db.connect() as conn:
            conn.execute(
                "INSERT INTO photo_keywords(keyword_id, name, created_at, updated_at) VALUES('kw_1', 'Family', ?, ?)",
                (now, now),
            )
            conn.execute(
                "INSERT INTO photo_asset_keywords(asset_id, keyword_id, assigned_at) VALUES(?, 'kw_1', ?)",
                (asset_id, now),
            )
            conn.execute(
                "INSERT INTO photo_albums(album_id, name, album_kind, created_at, updated_at) "
                "VALUES('album_1', 'Summer', 'manual', ?, ?)",
                (now, now),
            )
            conn.execute(
                "INSERT INTO photo_album_items(album_id, asset_id, position, added_at) VALUES('album_1', ?, 0, ?)",
                (asset_id, now),
            )
            conn.execute(
                "INSERT INTO photo_asset_people(asset_id, candidate_id, person_name, status, updated_at) "
                "VALUES(?, 'candidate_1', 'Ada', 'confirmed', ?)",
                (asset_id, now),
            )
            conn.execute(
                "INSERT INTO photo_edit_stacks(edit_id, asset_id, created_at, updated_at) "
                "VALUES('edit_1', ?, ?, ?)",
                (asset_id, now, now),
            )
        scopes = {
            item["scope"]
            for item in db.photo_catalog_change_page(after_seq=before_updates, limit=500)["items"]
        }
        check("keyword mutations enter the feed", "keywords" in scopes)
        check("album membership mutations enter the feed", "albums" in scopes)
        check("people-link mutations enter the feed", "people" in scopes)
        check("edit-stack mutations enter the feed", "edits" in scopes)

        with db.connect() as conn:
            conn.execute(
                "INSERT INTO photo_asset_external_ids("
                "provider, library_id, external_id, asset_id, first_seen_at, last_seen_at"
                ") VALUES('fixture', 'library', 'external-1', ?, ?, ?)",
                (asset_id, now, now),
            )
        before_reassignment = db.photo_catalog_change_page(after_seq=0, limit=500)["latestSeq"]
        with db.connect() as conn:
            conn.execute(
                "UPDATE photo_asset_external_ids SET asset_id = ?, last_seen_at = ? "
                "WHERE provider = 'fixture' AND library_id = 'library' AND external_id = 'external-1'",
                (second_asset_id, "2026-07-15T01:01:01Z"),
            )
        reassignment_changes = db.photo_catalog_change_page(after_seq=before_reassignment, limit=20)["items"]
        check(
            "external-ID reassignment journals both affected assets once",
            [item["assetId"] for item in reassignment_changes] == [second_asset_id, asset_id]
            and all(item["scope"] == "externalIds" for item in reassignment_changes),
        )

        service = _service(api, workspace)
        feed_items, cursor = _all_changes(service)
        sequences = [int(item["seq"]) for item in feed_items]
        check("cursor paging returns every sequence once and in order", sequences == sorted(set(sequences)))
        check(
            "upserts carry path-free current snapshots",
            all("sourcePath" not in item.get("asset", {}) for item in feed_items if item["operation"] == "upsert"),
        )

        with db.connect() as conn:
            conn.execute(
                "UPDATE photo_asset_metadata SET hidden = 1, updated_at = ? WHERE asset_id = ?",
                ("2026-07-15T01:02:00Z", asset_id),
            )
        hidden_items, cursor = _all_changes(service, cursor)
        check("hiding an asset emits a replica-removal tombstone", hidden_items[-1]["operation"] == "remove")
        check("protected removal does not carry an asset snapshot", "asset" not in hidden_items[-1])

        with db.connect() as conn:
            conn.execute(
                "UPDATE photo_asset_metadata SET hidden = 0, updated_at = ? WHERE asset_id = ?",
                ("2026-07-15T01:03:00Z", asset_id),
            )
        visible_items, cursor = _all_changes(service, cursor)
        check("unhiding an asset emits an upsert", visible_items[-1]["operation"] == "upsert")

        with db.connect() as conn:
            conn.execute("DELETE FROM photo_assets WHERE asset_id = ?", (asset_id,))
        deleted_items, cursor = _all_changes(service, cursor)
        check("hard delete emits at least one durable tombstone", any(item["operation"] == "delete" for item in deleted_items))
        check("delete tombstone retains the stable asset id", all(item["assetId"] == asset_id for item in deleted_items))
        check("delete tombstones never carry stale snapshots", all("asset" not in item for item in deleted_items))

        spec = agent_images_openapi_spec()
        check("OpenAPI publishes the cursor-paged change endpoint", "/v1/changes" in spec["paths"])
        check("OpenAPI keeps the existing activity SSE endpoint distinct", "/v1/events" in spec["paths"])

        baseline_workspace = root / "baseline-workspace"
        baseline_api = DesktopApi(baseline_workspace, actor="baseline-create")
        baseline_asset_id = _upsert(baseline_api, photo, "b" * 64)
        _check_migration_baseline(baseline_workspace, photo, baseline_asset_id)

    print("\nAll catalog change-feed checks passed.")


if __name__ == "__main__":
    main()

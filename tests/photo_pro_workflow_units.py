"""Focused contracts for professional photo curation metadata and XMP exchange."""

from __future__ import annotations

import os
import sqlite3
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable

from crossage_fr.api_server import DesktopApi
from crossage_fr.photo_sources.portable_metadata import read_portable_photo_metadata
from crossage_fr.store.workspace_db import WorkspaceDb


def _api(root: Path) -> DesktopApi:
    registry = str(root / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
    return DesktopApi(root / "workspace")


def _signature(path: Path, *, mtime_ns: int = 1) -> dict[str, Any]:
    return {
        "pathKey": f"{path.resolve()}|{path.stat().st_size}|{mtime_ns}",
        "size": path.stat().st_size,
        "mtimeNs": mtime_ns,
    }


def _expect_value_error(fn: Callable[[], Any], text: str) -> None:
    try:
        fn()
    except ValueError as exc:
        assert text in str(exc), exc
        return
    raise AssertionError("Expected ValueError")


def _xmp(*, rating: int, label: str = "", pick: str = "", catalog_rating: int | None = None) -> str:
    label_attribute = f' xmp:Label="{label}"' if label else ""
    catalog_line = (
        f"      <vintraceCatalog:CatalogRating>{catalog_rating}</vintraceCatalog:CatalogRating>\n"
        if catalog_rating is not None
        else ""
    )
    pick_line = f"      <crs:Pick>{pick}</crs:Pick>\n" if pick else ""
    pick_status_line = ""
    if pick:
        status = "reject" if str(pick).startswith("-") else "pick" if str(pick) not in {"0", ""} else "unflagged"
        pick_status_line = f"      <vintraceCatalog:PickStatus>{status}</vintraceCatalog:PickStatus>\n"
    return f"""<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      xmlns:vintraceCatalog="https://vintrace.local/ns/catalog/1.0/"
      xmp:Rating="{rating}"{label_attribute}>
{catalog_line}{pick_line}{pick_status_line}    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"""


def test_schema_migrates_existing_catalogs_before_creating_curation_index() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "legacy.sqlite3"
        WorkspaceDb(path)
        with sqlite3.connect(path) as conn:
            conn.execute("DROP INDEX IF EXISTS idx_photo_asset_metadata_curation")
            conn.execute("ALTER TABLE photo_asset_metadata DROP COLUMN pick_status")
            conn.execute("ALTER TABLE photo_asset_metadata DROP COLUMN color_label")
            conn.execute("ALTER TABLE photo_asset_metadata DROP COLUMN rating")
            conn.execute("UPDATE meta SET value = '11' WHERE key = 'schemaVersion'")
        migrated = WorkspaceDb(path)
        with migrated.connect() as conn:
            columns = {str(row["name"]) for row in conn.execute("PRAGMA table_info(photo_asset_metadata)")}
            index = conn.execute(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_photo_asset_metadata_curation'"
            ).fetchone()
            version = conn.execute("SELECT value FROM meta WHERE key = 'schemaVersion'").fetchone()
        assert {"rating", "rating_explicit", "color_label", "pick_status"} <= columns, columns
        assert index and "pick_status" in str(index["sql"]), index
        assert version and int(version["value"]) >= 14, version
    print("ok pro curation schema migrates old catalogs before indexing")


def test_workspace_db_serializes_threaded_connection_lifecycles() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        db = WorkspaceDb(Path(tmp) / "threaded.sqlite3")
        original_open = db._open_connection  # noqa: SLF001
        gate = threading.Lock()
        barrier = threading.Barrier(3)
        errors: list[BaseException] = []
        active_opens = 0
        peak_opens = 0

        def observed_open(*args: Any, **kwargs: Any):
            nonlocal active_opens, peak_opens
            with gate:
                active_opens += 1
                peak_opens = max(peak_opens, active_opens)
            try:
                time.sleep(0.02)
                return original_open(*args, **kwargs)
            finally:
                with gate:
                    active_opens -= 1

        db._open_connection = observed_open  # type: ignore[method-assign]  # noqa: SLF001

        def read_worker() -> None:
            try:
                barrier.wait(timeout=2)
                with db.connect() as conn:
                    conn.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
            except BaseException as exc:  # pragma: no cover - asserted below.
                errors.append(exc)

        workers = [threading.Thread(target=read_worker, daemon=True) for _ in range(2)]
        for worker in workers:
            worker.start()
        barrier.wait(timeout=2)
        for worker in workers:
            worker.join(timeout=5)

        assert not errors, errors
        assert all(not worker.is_alive() for worker in workers), "threaded SQLite connection lifecycle deadlocked"
        assert peak_opens == 1, peak_opens
    print("ok workspace DB serializes threaded SQLite connection lifecycles")


def test_curation_metadata_is_validated_paged_batched_and_undoable() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(root)
        first = root / "first.jpg"
        second = root / "second.jpg"
        first.write_bytes(b"first immutable source")
        second.write_bytes(b"second immutable source")
        source_bytes = {str(path): path.read_bytes() for path in (first, second)}
        api.project.db.create_scan_run("curation-run", "Curation", "manual", str(root))
        for path in (first, second):
            api.project.db.record_scan_file(
                "curation-run",
                path,
                _signature(path),
                "completed",
                phase="processed",
            )

        updated = api.update_photo_asset_metadata({
            "sourcePath": str(first),
            "rating": 2,
            "colorLabel": "Blue",
            "pickStatus": "picked",
        })
        assert updated["rating"] == 2, updated
        assert updated["colorLabel"] == "blue", updated
        assert updated["pickStatus"] == "pick", updated
        assert updated["operation"]["canUndo"] is True, updated

        page = api.list_photo_folder_items({"folderId": "all", "previewBudget": 0, "limit": 20})
        paged = {item["sourcePath"]: item for item in page["items"]}
        assert paged[str(first)]["rating"] == 2, paged[str(first)]
        assert paged[str(first)]["colorLabel"] == "blue", paged[str(first)]
        assert paged[str(first)]["pickStatus"] == "pick", paged[str(first)]

        invalid_updates = (
            ({"rating": True}, "rating"),
            ({"rating": 2.5}, "rating"),
            ({"rating": 6}, "rating"),
            ({"colorLabel": "orange"}, "colorLabel"),
            ({"pickStatus": "maybe"}, "pickStatus"),
        )
        for patch, expected in invalid_updates:
            _expect_value_error(
                lambda patch=patch: api.update_photo_asset_metadata({"sourcePath": str(first), **patch}),
                expected,
            )

        before_atomic_first = api.project.db.photo_asset_metadata_by_path(str(first))
        before_atomic_second = api.project.db.photo_asset_metadata_by_path(str(second))
        with api.project.db.connect() as conn:
            before_operation_count = int(conn.execute("SELECT COUNT(*) AS n FROM photo_operation_journal").fetchone()["n"])
        _expect_value_error(
            lambda: api.update_photo_assets_metadata({
                "label": "Must roll back",
                "items": [
                    {"sourcePath": str(first), "rating": 4, "colorLabel": "purple"},
                    {"sourcePath": str(second), "rating": 9},
                ],
            }),
            "rating",
        )
        assert api.project.db.photo_asset_metadata_by_path(str(first)) == before_atomic_first
        assert api.project.db.photo_asset_metadata_by_path(str(second)) == before_atomic_second
        with api.project.db.connect() as conn:
            after_operation_count = int(conn.execute("SELECT COUNT(*) AS n FROM photo_operation_journal").fetchone()["n"])
        assert after_operation_count == before_operation_count

        batch = api.update_photo_assets_metadata({
            "label": "Cull selected photos",
            "items": [
                {"sourcePath": str(first), "rating": 5, "colorLabel": "green", "pickStatus": "reject"},
                {"sourcePath": str(second), "rating": 5, "colorLabel": "green", "pickStatus": "reject"},
            ],
        })
        assert batch["updated"] == 2 and batch["changed"] == 2, batch
        assert batch["operation"]["affectedCount"] == 2, batch
        assert batch["operation"]["label"] == "Cull selected photos", batch
        assert all(item["rating"] == 5 for item in batch["items"]), batch
        assert all(item["pickStatus"] == "reject" for item in batch["items"]), batch

        undone = api.undo_photo_operation({"operationId": batch["operation"]["operationId"]})
        assert undone["undone"] is True and undone["restored"] == 2, undone
        restored_first = api.project.db.photo_asset_metadata_by_path(str(first))
        restored_second = api.project.db.photo_asset_metadata_by_path(str(second))
        assert (restored_first["rating"], restored_first["colorLabel"], restored_first["pickStatus"]) == (2, "blue", "pick")
        assert (restored_second["rating"], restored_second["colorLabel"], restored_second["pickStatus"]) == (0, "", "")
        assert {str(path): path.read_bytes() for path in (first, second)} == source_bytes
    print("ok pro curation metadata is validated, paged, batched, immutable, and undoable")


def test_xmp_curation_roundtrip_preserves_rating_label_pick_and_conflicts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(root)
        photo = root / "review.jpg"
        sidecar = root / "review.xmp"
        photo.write_bytes(b"original bytes remain untouched")
        original_bytes = photo.read_bytes()
        sidecar.write_text(_xmp(rating=5, label="Red", pick="1"), encoding="utf-8")
        api.project.db.create_scan_run("xmp-run", "XMP", "manual", str(root))
        api.project.db.record_scan_file(
            "xmp-run",
            photo,
            _signature(photo),
            "completed",
            phase="processed",
        )

        imported = api.project.db.photo_asset_metadata_by_path(str(photo))
        assert (imported["rating"], imported["colorLabel"], imported["pickStatus"]) == (5, "red", "pick"), imported
        assert imported["ratingExplicit"] is False, imported
        portable = read_portable_photo_metadata(photo)
        assert (portable.rating, portable.color_label, portable.pick_status) == (5, "red", "pick"), portable

        cleared = api.update_photo_asset_metadata({"sourcePath": str(photo), "rating": 0})
        assert cleared["rating"] == 0 and cleared["ratingExplicit"] is True, cleared
        cleared_export = api.export_photo_selection([str(photo)], include_xmp=True)
        cleared_xmp = Path(cleared_export["items"][0]["xmpPath"]).read_text(encoding="utf-8")
        assert "<xmp:Rating>0</xmp:Rating>" in cleared_xmp, cleared_xmp
        api.project.db.record_scan_file(
            "xmp-run",
            photo,
            _signature(photo, mtime_ns=2),
            "completed",
            phase="processed",
        )
        rescanned = api.project.db.photo_asset_metadata_by_path(str(photo))
        assert rescanned["rating"] == 0 and rescanned["ratingExplicit"] is True, rescanned
        clear_conflicts = api.project.db.photo_asset_by_path(str(photo))["metadata"]["xmp"].get("conflicts", [])
        assert any(row.get("field") == "rating" and row.get("sidecarValue") == 5 for row in clear_conflicts), clear_conflicts
        restored_clear = api.undo_photo_operation({"operationId": cleared["operation"]["operationId"]})
        assert restored_clear["undone"] is True, restored_clear
        restored_rating = api.project.db.photo_asset_metadata_by_path(str(photo))
        assert restored_rating["rating"] == 5 and restored_rating["ratingExplicit"] is False, restored_rating

        api.update_photo_asset_metadata({
            "sourcePath": str(photo),
            "rating": 4,
            "colorLabel": "yellow",
            "pickStatus": "reject",
        })
        exported = api.export_photo_selection([str(photo)], include_xmp=True)
        exported_xmp_path = Path(exported["items"][0]["xmpPath"])
        exported_xmp = exported_xmp_path.read_text(encoding="utf-8")
        assert "<xmp:Rating>-1</xmp:Rating>" in exported_xmp, exported_xmp
        assert "<vintraceCatalog:CatalogRating>4</vintraceCatalog:CatalogRating>" in exported_xmp, exported_xmp
        assert "<xmp:Label>Yellow</xmp:Label>" in exported_xmp, exported_xmp
        assert "<crs:Pick>-1</crs:Pick>" in exported_xmp, exported_xmp
        assert "<vintraceCatalog:PickStatus>reject</vintraceCatalog:PickStatus>" in exported_xmp, exported_xmp
        assert photo.read_bytes() == original_bytes

        roundtrip = root / "roundtrip.jpg"
        roundtrip.write_bytes(b"roundtrip source")
        (root / "roundtrip.xmp").write_text(exported_xmp, encoding="utf-8")
        api.project.db.record_scan_file(
            "xmp-run",
            roundtrip,
            _signature(roundtrip),
            "completed",
            phase="processed",
        )
        roundtripped = api.project.db.photo_asset_metadata_by_path(str(roundtrip))
        assert (roundtripped["rating"], roundtripped["colorLabel"], roundtripped["pickStatus"]) == (4, "yellow", "reject"), roundtripped

        api.update_photo_asset_metadata({
            "sourcePath": str(photo),
            "rating": 3,
            "colorLabel": "blue",
            "pickStatus": "reject",
        })
        sidecar.write_text(_xmp(rating=1, label="Green", pick="1", catalog_rating=1), encoding="utf-8")
        api.project.db.record_scan_file(
            "xmp-run",
            photo,
            _signature(photo, mtime_ns=2),
            "completed",
            phase="processed",
        )
        conflicted = api.project.db.photo_asset_by_path(str(photo))
        assert conflicted is not None, conflicted
        conflicts = {
            row["field"]: row
            for row in conflicted["metadata"]["xmp"].get("conflicts", [])
            if isinstance(row, dict)
        }
        assert {"rating", "colorLabel", "pickStatus"} <= set(conflicts), conflicts
        assert conflicts["rating"]["sidecarValue"] == 1, conflicts

        resolved = api.update_photo_asset_metadata({
            "sourcePath": str(photo),
            "rating": 1,
            "colorLabel": "green",
            "pickStatus": "pick",
        })
        assert not resolved["assetMetadata"]["xmp"].get("conflicts"), resolved

        rejected = root / "external-reject.jpg"
        rejected.write_bytes(b"external reject")
        (root / "external-reject.xmp").write_text(_xmp(rating=-1), encoding="utf-8")
        api.project.db.record_scan_file(
            "xmp-run",
            rejected,
            _signature(rejected),
            "completed",
            phase="processed",
        )
        rejected_metadata = api.project.db.photo_asset_metadata_by_path(str(rejected))
        assert rejected_metadata["rating"] == 0, rejected_metadata
        assert rejected_metadata["pickStatus"] == "reject", rejected_metadata
    print("ok XMP curation metadata round-trips without losing independent reject and stars")


def test_curation_smart_queries_compile_to_bounded_sql() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _api(root)
        paths = [root / name for name in ("green-pick.jpg", "green-four.jpg", "blue-reject.jpg", "unflagged.jpg")]
        for index, path in enumerate(paths):
            path.write_bytes(f"source-{index}".encode("ascii"))
        api.project.db.create_scan_run("smart-run", "Smart curation", "manual", str(root))
        for index, path in enumerate(paths):
            api.project.db.record_scan_file(
                "smart-run",
                path,
                _signature(path, mtime_ns=index + 1),
                "completed",
                phase="processed",
            )
        updates = (
            (paths[0], 5, "green", "pick"),
            (paths[1], 4, "green", "pick"),
            (paths[2], 5, "blue", "reject"),
        )
        for path, rating, label, pick in updates:
            api.project.db.update_photo_asset_metadata(
                source_path=str(path),
                rating=rating,
                color_label=label,
                pick_status=pick,
            )

        direct = api.project.db.list_photo_asset_page(
            offset=0,
            limit=10,
            rating_filters=(("atLeast", 5),),
            curation_text_filters=(("colorLabel", "is", "green"), ("pickStatus", "is", "pick")),
        )
        assert direct["total"] == 1, direct
        assert direct["assets"][0]["sourcePath"] == str(paths[0]), direct

        unflagged = api.project.db.list_photo_asset_page(
            offset=0,
            limit=10,
            curation_text_filters=(("colorLabel", "is", "unlabeled"), ("pickStatus", "is", "unflagged")),
        )
        assert unflagged["total"] == 1 and unflagged["assets"][0]["sourcePath"] == str(paths[3]), unflagged

        rules = {
            "op": "all",
            "conditions": [
                {"field": "rating", "operator": "atLeast", "value": 5},
                {"field": "colorLabel", "operator": "is", "value": "green"},
                {"field": "pickStatus", "operator": "is", "value": "pick"},
            ],
        }
        album = api.save_photo_album({
            "name": "Five-star green picks",
            "albumKind": "smart",
            "rules": rules,
        })
        assert album["count"] == 1, album
        criteria = api._photo_smart_album_sql_criteria(album)  # noqa: SLF001
        assert criteria is not None, album
        assert criteria["ratingFilters"] == (("atLeast", 5.0),), criteria
        assert criteria["curationTextFilters"] == (
            ("colorLabel", "is", "green"),
            ("pickStatus", "is", "pick"),
        ), criteria
        page = api.list_photo_folder_items({"folderId": f"album:{album['albumId']}", "previewBudget": 0})
        assert page["total"] == 1 and page["items"][0]["sourcePath"] == str(paths[0]), page

        summaries = api.project.db.list_photo_date_bucket_summaries(
            "years",
            rating_filters=(("atLeast", 5),),
            curation_text_filters=(("pickStatus", "is", "pick"),),
        )
        assert sum(int(row.get("count", 0)) for row in summaries) == 1, summaries
    print("ok curation smart queries stay on the bounded SQL page/date path")


if __name__ == "__main__":
    test_schema_migrates_existing_catalogs_before_creating_curation_index()
    test_workspace_db_serializes_threaded_connection_lifecycles()
    test_curation_metadata_is_validated_paged_batched_and_undoable()
    test_xmp_curation_roundtrip_preserves_rating_label_pick_and_conflicts()
    test_curation_smart_queries_compile_to_bounded_sql()
    print("photo pro workflow unit tests passed")

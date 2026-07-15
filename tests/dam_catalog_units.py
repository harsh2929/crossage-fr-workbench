"""Lightroom Classic and Capture One read-only migration acceptance tests.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/dam_catalog_units.py
"""

from __future__ import annotations

from hashlib import sha256
import socket
import sqlite3
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.photo_sources.dam_catalog_adapter import (
    CAPTURE_ONE_CATALOG_PROVIDER,
    LIGHTROOM_CATALOG_PROVIDER,
)
from photo_folders_units import _api, _expect_raises


def _file_hash(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def _lightroom_fixture(base: Path) -> tuple[Path, Path, Path]:
    media_root = base / "mapped-media"
    shoot = media_root / "Shoot"
    shoot.mkdir(parents=True)
    hero = shoot / "hero.jpg"
    alternate = shoot / "alternate.jpg"
    Image.new("RGB", (50, 34), (205, 70, 45)).save(hero, quality=93)
    Image.new("RGB", (42, 38), (40, 135, 200)).save(alternate, quality=93)
    catalog = base / "Client Catalog.lrcat"
    with sqlite3.connect(catalog) as conn:
        conn.executescript(
            """
            PRAGMA user_version = 140;
            CREATE TABLE AgLibraryRootFolder(id_local INTEGER PRIMARY KEY, absolutePath TEXT NOT NULL);
            CREATE TABLE AgLibraryFolder(id_local INTEGER PRIMARY KEY, rootFolder INTEGER NOT NULL, pathFromRoot TEXT NOT NULL);
            CREATE TABLE AgLibraryFile(id_local INTEGER PRIMARY KEY, folder INTEGER NOT NULL, baseName TEXT NOT NULL, extension TEXT NOT NULL);
            CREATE TABLE Adobe_images(
                id_local INTEGER PRIMARY KEY,
                rootFile INTEGER NOT NULL,
                rating INTEGER,
                pick INTEGER,
                colorLabels TEXT,
                captureTime TEXT,
                touchTime TEXT,
                title TEXT,
                caption TEXT,
                fileFormat TEXT,
                width INTEGER,
                height INTEGER
            );
            CREATE TABLE AgLibraryKeyword(id_local INTEGER PRIMARY KEY, name TEXT NOT NULL, parent INTEGER);
            CREATE TABLE AgLibraryKeywordImage(image INTEGER NOT NULL, tag INTEGER NOT NULL);
            CREATE TABLE AgLibraryCollection(id_local INTEGER PRIMARY KEY, name TEXT NOT NULL, parent INTEGER);
            CREATE TABLE AgLibraryCollectionContent(collection INTEGER NOT NULL, image INTEGER NOT NULL, position INTEGER NOT NULL);
            """
        )
        conn.execute("INSERT INTO AgLibraryRootFolder VALUES(1, '/Volumes/Retired RAID/Photos')")
        conn.execute("INSERT INTO AgLibraryFolder VALUES(10, 1, 'Shoot')")
        conn.executemany(
            "INSERT INTO AgLibraryFile VALUES(?, 10, ?, 'jpg')",
            [(100, "hero"), (101, "alternate")],
        )
        conn.executemany(
            "INSERT INTO Adobe_images VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'JPEG', ?, ?)",
            [
                (1000, 100, 5, 1, "Red", "2026-06-01T10:00:00", "2026-06-02T10:00:00", "Campaign hero", "Client approved", 50, 34),
                (1001, 101, 2, -1, "Blue", "2026-06-01T10:01:00", "2026-06-02T10:01:00", "Alternate", "Hold", 42, 38),
            ],
        )
        conn.executemany(
            "INSERT INTO AgLibraryKeyword VALUES(?, ?, ?)",
            [(1, "Client", None), (2, "Acme", 1), (3, "Portfolio", None)],
        )
        conn.executemany(
            "INSERT INTO AgLibraryKeywordImage VALUES(?, ?)",
            [(1000, 2), (1000, 3), (1001, 2)],
        )
        conn.executemany(
            "INSERT INTO AgLibraryCollection VALUES(?, ?, ?)",
            [(20, "Clients", None), (21, "Acme", 20), (22, "Campaign Selects", 21)],
        )
        conn.executemany(
            "INSERT INTO AgLibraryCollectionContent VALUES(?, ?, ?)",
            [(22, 1001, 0), (22, 1000, 1)],
        )
    return catalog, media_root, hero


def _capture_one_fixture(base: Path) -> tuple[Path, Path]:
    media = base / "capture-media"
    media.mkdir()
    image = media / "product.nef"
    image.write_bytes(b"capture-one-raw-original-fixture")
    catalog = base / "Product.cocatalogdb"
    with sqlite3.connect(catalog) as conn:
        conn.executescript(
            """
            PRAGMA user_version = 52;
            CREATE TABLE ZIMAGE(
                Z_PK INTEGER PRIMARY KEY,
                ZPATH TEXT NOT NULL,
                ZFILENAME TEXT NOT NULL,
                ZRATING INTEGER,
                ZCOLORCLASS INTEGER,
                ZPICK INTEGER,
                ZCAPTUREDATE TEXT,
                ZMODIFICATIONDATE TEXT,
                ZTITLE TEXT,
                ZDESCRIPTION TEXT,
                ZWIDTH INTEGER,
                ZHEIGHT INTEGER
            );
            CREATE TABLE ZKEYWORD(Z_PK INTEGER PRIMARY KEY, ZNAME TEXT NOT NULL, ZPARENT INTEGER);
            CREATE TABLE ZIMAGEKEYWORD(ZIMAGE INTEGER NOT NULL, ZKEYWORD INTEGER NOT NULL);
            CREATE TABLE ZCOLLECTION(Z_PK INTEGER PRIMARY KEY, ZNAME TEXT NOT NULL, ZPARENT INTEGER);
            CREATE TABLE ZCOLLECTIONIMAGE(ZCOLLECTION INTEGER NOT NULL, ZIMAGE INTEGER NOT NULL, ZPOSITION INTEGER NOT NULL);
            """
        )
        conn.execute(
            "INSERT INTO ZIMAGE VALUES(1, ?, 'product.nef', 3, 5, -1, '2026-06-03T12:00:00', '2026-06-03T13:00:00', 'Product front', 'Needs revision', 80, 60)",
            (str(image.resolve()),),
        )
        conn.executemany("INSERT INTO ZKEYWORD VALUES(?, ?, ?)", [(1, "SKU", None), (2, "ABC-123", 1)])
        conn.execute("INSERT INTO ZIMAGEKEYWORD VALUES(1, 2)")
        conn.executemany("INSERT INTO ZCOLLECTION VALUES(?, ?, ?)", [(10, "Products", None), (11, "Web", 10)])
        conn.execute("INSERT INTO ZCOLLECTIONIMAGE VALUES(11, 1, 7)")
    return catalog, image


def _default_params(catalog: Path) -> dict:
    return {
        "libraryPath": str(catalog),
        "storageMode": "referenced",
        "scopes": {
            "originals": True,
            "edited": False,
            "raw": True,
            "livePhotoMotion": False,
            "albumsFolders": True,
            "keywords": True,
            "labelsOcr": True,
            "favorites": True,
        },
    }


def test_lightroom_catalog_preview_import_sync_preserves_local_authority_and_source_bytes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        catalog, media_root, hero = _lightroom_fixture(base)
        before = _file_hash(catalog)
        api = _api(str(base / "app"))
        params = {
            **_default_params(catalog),
            "rootMappings": [{
                "sourceRoot": "/Volumes/Retired RAID/Photos",
                "targetRoot": str(media_root),
            }],
        }
        status = api.photo_source_provider_status(LIGHTROOM_CATALOG_PROVIDER)
        assert status["available"] and status["readOnly"] and status["networkAccess"] == "none", status
        command_status = api.handle("dam_catalog_status", {"provider": LIGHTROOM_CATALOG_PROVIDER})["value"]
        assert command_status["provider"] == LIGHTROOM_CATALOG_PROVIDER and command_status["available"], command_status
        command_preview = api.handle("preview_dam_catalog", {
            **params,
            "provider": LIGHTROOM_CATALOG_PROVIDER,
            "runAsJob": True,
            "runInline": True,
        })["value"]["job"]
        assert command_preview["status"] == "completed", command_preview
        assert command_preview["result"]["counts"]["assets"] == 2, command_preview
        preview = api.preview_photo_source(LIGHTROOM_CATALOG_PROVIDER, params)
        assert preview["counts"]["assets"] == 2 and preview["counts"]["rated"] == 2, preview
        assert preview["counts"]["picked"] == 1 and preview["counts"]["rejected"] == 1, preview
        sample = next(row for row in preview["samples"] if row["filename"] == "hero.jpg")
        assert sample["rating"] == 5 and sample["colorLabel"] == "red" and sample["pickStatus"] == "pick", sample

        original_create_connection = socket.create_connection

        def blocked_network(*_args, **_kwargs):
            raise AssertionError("DAM migration attempted network access")

        socket.create_connection = blocked_network
        try:
            started = api.start_photo_source_job(
                LIGHTROOM_CATALOG_PROVIDER,
                "import",
                {**params, "runInline": True},
            )
        finally:
            socket.create_connection = original_create_connection
        job = started["job"]
        assert job["status"] == "completed" and job["result"]["counts"]["imported"] == 2, job
        assert _file_hash(catalog) == before, "read-only Lightroom import changed source catalog bytes"

        db = api.project.db
        with db.connect() as conn:
            metadata = {
                row["title"]: dict(row)
                for row in conn.execute("SELECT * FROM photo_asset_metadata ORDER BY title").fetchall()
            }
            assert metadata["Campaign hero"]["rating"] == 5
            assert metadata["Campaign hero"]["color_label"] == "red"
            assert metadata["Campaign hero"]["pick_status"] == "pick"
            assert metadata["Alternate"]["rating"] == 2 and metadata["Alternate"]["pick_status"] == "reject"
            album = conn.execute("SELECT * FROM photo_albums WHERE name = 'Campaign Selects'").fetchone()
            assert album and album["album_kind"] == "manual", dict(album or {})
            ordered = conn.execute(
                "SELECT position FROM photo_album_items WHERE album_id = ? ORDER BY position",
                (album["album_id"],),
            ).fetchall()
            assert [row["position"] for row in ordered] == [0, 1], ordered
            names = {row["name"] for row in conn.execute("SELECT name FROM photo_keywords").fetchall()}
            assert {"Client/Acme", "Portfolio"}.issubset(names), names
            hero_asset = conn.execute("SELECT asset_id FROM photo_assets WHERE source_path = ?", (str(hero.resolve()),)).fetchone()
            assert hero_asset, "mapped Lightroom original was not referenced"
        db.update_photo_asset_metadata(asset_id=hero_asset["asset_id"], rating=1, title="Local title wins")

        with sqlite3.connect(catalog) as conn:
            conn.execute("UPDATE Adobe_images SET rating = 4, title = 'Changed upstream' WHERE id_local = 1000")
        sync = api.start_photo_source_job(
            LIGHTROOM_CATALOG_PROVIDER,
            "sync",
            {**params, "runInline": True, "force": True},
        )["job"]
        assert sync["status"] == "completed", sync
        local = db.photo_asset_metadata_by_id(hero_asset["asset_id"])
        assert local["rating"] == 1 and local["title"] == "Local title wins", local


def test_capture_one_catalog_managed_import_preserves_rating_color_reject_and_order() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        catalog, source = _capture_one_fixture(base)
        before = _file_hash(catalog)
        api = _api(str(base / "app"))
        managed_root = base / "managed-library"
        params = {
            **_default_params(catalog),
            "storageMode": "managed",
            "managedRoot": str(managed_root),
        }
        preview = api.preview_photo_source(CAPTURE_ONE_CATALOG_PROVIDER, params)
        assert preview["counts"]["assets"] == 1 and preview["counts"]["raw"] == 1, preview
        assert preview["samples"][0]["colorLabel"] == "blue" and preview["samples"][0]["pickStatus"] == "reject", preview
        job = api.start_photo_source_job(
            CAPTURE_ONE_CATALOG_PROVIDER,
            "import",
            {**params, "runInline": True},
        )["job"]
        assert job["status"] == "completed" and job["result"]["counts"]["imported"] == 1, job
        assert _file_hash(catalog) == before, "read-only Capture One import changed source catalog bytes"
        with api.project.db.connect() as conn:
            asset = conn.execute("SELECT * FROM photo_assets").fetchone()
            assert asset and asset["source_kind"] == "managed", dict(asset or {})
            target = Path(asset["source_path"])
            assert target.is_file() and target.read_bytes() == source.read_bytes() and target != source
            metadata = conn.execute("SELECT * FROM photo_asset_metadata WHERE asset_id = ?", (asset["asset_id"],)).fetchone()
            assert metadata["rating"] == 3 and metadata["color_label"] == "blue" and metadata["pick_status"] == "reject", dict(metadata)
            album = conn.execute("SELECT * FROM photo_albums WHERE name = 'Web'").fetchone()
            assert album and album["folder_position"] == 7, dict(album or {})
            keyword = conn.execute("SELECT name FROM photo_keywords").fetchone()
            assert keyword and keyword["name"] == "SKU/ABC-123", dict(keyword or {})


def test_dam_catalog_unknown_schema_and_missing_media_are_honest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        invalid = base / "unknown.lrcat"
        with sqlite3.connect(invalid) as conn:
            conn.execute("CREATE TABLE something_else(id INTEGER PRIMARY KEY)")
        api = _api(str(base / "app"))
        _expect_raises(
            ValueError,
            lambda: api.preview_photo_source(LIGHTROOM_CATALOG_PROVIDER, _default_params(invalid)),
            "Unsupported Lightroom catalog schema",
        )

        catalog, media_root, _ = _lightroom_fixture(base / "missing")
        shutil_target = media_root / "Shoot" / "hero.jpg"
        shutil_target.unlink()
        preview = api.preview_photo_source(
            LIGHTROOM_CATALOG_PROVIDER,
            {**_default_params(catalog), "mediaRoot": str(media_root)},
        )
        assert preview["counts"]["missing"] == 1, preview
        assert any(warning["code"] == "dam-media-missing" for warning in preview["warnings"]), preview


if __name__ == "__main__":
    test_lightroom_catalog_preview_import_sync_preserves_local_authority_and_source_bytes()
    print("ok Lightroom read-only preview import sync and local-authority merge")
    test_capture_one_catalog_managed_import_preserves_rating_color_reject_and_order()
    print("ok Capture One managed migration rating color reject and order")
    test_dam_catalog_unknown_schema_and_missing_media_are_honest()
    print("ok DAM unknown-schema and missing-media honesty")

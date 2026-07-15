"""Whole-catalog open-format portability acceptance tests.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_open_catalog_units.py
"""

from __future__ import annotations

from hashlib import sha256
import gc
import json
import os
import shutil
import socket
import tempfile
from time import perf_counter
import tracemalloc
from pathlib import Path

from PIL import Image

from crossage_fr.photo_catalog_portability import (
    OPEN_CATALOG_FORMAT,
    OpenPhotoCatalogCancelled,
    OpenPhotoCatalogError,
    OpenPhotoCatalogService,
    _atomic_copy_verified,
)
from crossage_fr.workspace_registry import now_iso
from photo_folders_units import _api, _expect_raises


def _value(api, command: str, params: dict) -> dict:
    result = api.handle(command, params)
    value = result.get("value", {})
    assert isinstance(value, dict), result
    return value


def _seed_catalog(base: Path):
    api = _api(str(base / "source-app"))
    originals = base / "private-machine-root" / "client-shoot"
    originals.mkdir(parents=True)
    first = originals / "portrait-one.jpg"
    second = originals / "portrait-two.jpg"
    Image.new("RGB", (48, 32), (190, 45, 70)).save(first, quality=94)
    Image.new("RGB", (40, 36), (35, 120, 210)).save(second, quality=94)
    first_xmp = first.with_suffix(".xmp")
    first_xmp.write_text(
        "<x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF>portable sidecar</rdf:RDF></x:xmpmeta>",
        encoding="utf-8",
    )
    imported = api.import_photos({
        "sourcePaths": [str(first), str(second)],
        "storageMode": "referenced",
        "sourceKind": "folder",
        "sourceLabel": "Client shoot",
    })
    assert imported["importedCount"] == 2, imported
    assets = sorted(imported["assets"], key=lambda row: row["sourcePath"])
    first_asset = next(row for row in assets if row["sourcePath"] == str(first.resolve()))
    second_asset = next(row for row in assets if row["sourcePath"] == str(second.resolve()))
    db = api.project.db
    db.update_photo_asset_metadata(
        asset_id=first_asset["assetId"],
        title="Portfolio hero",
        caption="Approved campaign portrait",
        favorite=True,
        rating=5,
        color_label="red",
        pick_status="pick",
        keywords=["Client/Acme", "Portfolio"],
    )
    db.update_photo_asset_metadata(
        asset_id=second_asset["assetId"],
        title="Alternate frame",
        rating=2,
        color_label="blue",
        pick_status="reject",
        keywords=["Client/Acme", "Alternate"],
    )
    db.upsert_photo_album_folder(folder_id="folder_clients", name="Clients", position=0)
    db.upsert_photo_album_folder(
        folder_id="folder_acme",
        name="Acme",
        parent_folder_id="folder_clients",
        position=3,
    )
    db.upsert_photo_album(
        album_id="album_campaign",
        name="Campaign selects",
        album_kind="manual",
        description="Final client order",
        include_people=[],
        exclude_people=[],
        rules={"rating": {"gte": 4}, "sourcePath": str(first.resolve())},
        cover_source_path=str(first.resolve()),
        folder_id="folder_acme",
        folder_position=4,
    )
    timestamp = now_iso()
    with db.connect() as conn:
        conn.executemany(
            "INSERT INTO photo_album_items(album_id, asset_id, position, added_at) VALUES(?, ?, ?, ?)",
            [
                ("album_campaign", second_asset["assetId"], 0, timestamp),
                ("album_campaign", first_asset["assetId"], 1, timestamp),
            ],
        )
        conn.execute(
            """
            INSERT INTO photo_people_profiles(
                person_name, key_asset_id, key_asset_crop_json, favorite, hidden,
                manual_order, created_at, updated_at
            ) VALUES('Alice Example', ?, ?, 1, 0, 2, ?, ?)
            """,
            (
                first_asset["assetId"],
                json.dumps({"x": 0.2, "y": 0.1, "width": 0.4, "height": 0.5}),
                timestamp,
                timestamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO photo_asset_people(
                asset_id, candidate_id, person_name, status, score, quality,
                band, source, metadata_json, updated_at
            ) VALUES(?, 'manual-face-1', 'Alice Example', 'accepted', 0.99, 0.96,
                'manual', 'human', ?, ?)
            """,
            (
                first_asset["assetId"],
                json.dumps({"region": {"x": 0.2, "y": 0.1, "width": 0.4, "height": 0.5}}),
                timestamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO photo_media_pairs(
                pair_id, asset_id, related_asset_id, pair_kind, source_path,
                related_source_path, metadata_json, created_at, updated_at
            ) VALUES('pair-xmp-1', ?, '', 'xmp_sidecar', ?, ?, ?, ?, ?)
            """,
            (
                first_asset["assetId"],
                str(first.resolve()),
                str(first_xmp.resolve()),
                json.dumps({"authority": "external-xmp", "sidecarPath": str(first_xmp.resolve())}),
                timestamp,
                timestamp,
            ),
        )
        conn.execute(
            "INSERT INTO photo_object_tags(tag_id, asset_id, label, source, confidence, bounds_json, created_at) VALUES('tag-human-1', ?, 'portrait', 'human', 1.0, '{}', ?)",
            (first_asset["assetId"], timestamp),
        )
        conn.execute(
            "INSERT INTO photo_ocr_blocks(block_id, asset_id, text, language, confidence, bounds_json, source, metadata_json, created_at) VALUES('ocr-human-1', ?, 'ACME 2026', 'en', 0.99, '{}', 'reviewed', '{}', ?)",
            (second_asset["assetId"], timestamp),
        )
    stack = db.save_photo_edit_stack(
        asset_id=first_asset["assetId"],
        operations=[
            {"kind": "adjust", "exposure": 0.2},
            {"kind": "external-mask", "maskPath": str(first.resolve())},
        ],
        sidecar_path=str(first_xmp.resolve()),
    )
    version = db.create_photo_edit_stack_version(
        asset_id=first_asset["assetId"],
        label="Client approved",
    )
    assert stack["operations"] and version["label"] == "Client approved"
    db.save_photo_curation_preferences({
        "featureLessPeople": ["No Name"],
        "hiddenContent": ["screenshots"],
        "removedMemoryItems": {
            "memory-client": [str(second.resolve())],
        },
    })
    with db.connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO meta(key, value) VALUES('photo_user_memories', ?)",
            (json.dumps({
                "items": [{
                    "memoryId": "memory-client",
                    "name": "Client delivery",
                    "sourcePaths": [str(first.resolve()), str(second.resolve())],
                    "coverSourcePath": str(first.resolve()),
                }]
            }),),
        )
    return api, first, second, first_xmp, first_asset, second_asset


def _catalog_text(package: Path) -> bytes:
    output = bytearray()
    for path in sorted(package.rglob("*")):
        if path.is_file() and path.suffix.lower() in {".json", ".ndjson"}:
            output.extend(path.read_bytes())
    return bytes(output)


def _rehash_manifest_member(package: Path, relative: str) -> None:
    manifest_path = package / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    data = (package / relative).read_bytes()
    entry = next(item for item in manifest["files"] if item["path"] == relative)
    entry["sha256"] = sha256(data).hexdigest()
    entry["bytes"] = len(data)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _assert_round_trip(target_api, first_bytes: bytes, second_bytes: bytes, xmp_bytes: bytes) -> None:
    db = target_api.project.db
    with db.connect() as conn:
        assets = conn.execute("SELECT * FROM photo_assets ORDER BY source_path ASC").fetchall()
        assert len(assets) == 2, len(assets)
        paths = [Path(str(row["source_path"])) for row in assets]
        assert sorted(path.read_bytes() for path in paths) == sorted([first_bytes, second_bytes])
        metadata = {
            str(row["title"]): dict(row)
            for row in conn.execute("SELECT * FROM photo_asset_metadata ORDER BY title ASC").fetchall()
        }
        assert metadata["Portfolio hero"]["rating"] == 5
        assert metadata["Portfolio hero"]["color_label"] == "red"
        assert metadata["Portfolio hero"]["pick_status"] == "pick"
        assert metadata["Alternate frame"]["rating"] == 2
        assert metadata["Alternate frame"]["pick_status"] == "reject"
        folder = conn.execute("SELECT * FROM photo_album_folders WHERE folder_id = 'folder_acme'").fetchone()
        assert folder and folder["parent_folder_id"] == "folder_clients" and folder["position"] == 3, dict(folder or {})
        album = conn.execute("SELECT * FROM photo_albums WHERE album_id = 'album_campaign'").fetchone()
        assert album and album["folder_id"] == "folder_acme" and album["folder_position"] == 4, dict(album or {})
        ordered = conn.execute(
            "SELECT asset_id, position FROM photo_album_items WHERE album_id = 'album_campaign' ORDER BY position ASC"
        ).fetchall()
        assert [row["position"] for row in ordered] == [0, 1], ordered
        profile = conn.execute("SELECT * FROM photo_people_profiles WHERE person_name = 'Alice Example'").fetchone()
        assert profile and profile["favorite"] == 1 and profile["manual_order"] == 2, dict(profile or {})
        assignment = conn.execute("SELECT * FROM photo_asset_people WHERE candidate_id = 'manual-face-1'").fetchone()
        assert assignment and assignment["status"] == "accepted", dict(assignment or {})
        stack = conn.execute("SELECT * FROM photo_edit_stacks").fetchone()
        assert stack and stack["sidecar_path"] and Path(stack["sidecar_path"]).read_bytes() == xmp_bytes, dict(stack or {})
        operations = json.loads(stack["operations_json"])
        assert Path(operations[1]["maskPath"]).is_file(), operations
        versions = conn.execute("SELECT * FROM photo_edit_stack_versions").fetchall()
        assert len(versions) == 1 and versions[0]["label"] == "Client approved", versions
        pair = conn.execute("SELECT * FROM photo_media_pairs WHERE pair_id = 'pair-xmp-1'").fetchone()
        assert pair and Path(pair["related_source_path"]).read_bytes() == xmp_bytes, dict(pair or {})
        assert conn.execute("SELECT COUNT(*) FROM photo_object_tags WHERE tag_id = 'tag-human-1'").fetchone()[0] == 1
        assert conn.execute("SELECT COUNT(*) FROM photo_ocr_blocks WHERE block_id = 'ocr-human-1'").fetchone()[0] == 1
        preference = json.loads(conn.execute("SELECT value FROM meta WHERE key = 'photo_curation_preferences'").fetchone()[0])
        restored_removed = preference["memoryRemovedItems"]["memory-client"][0]
        assert Path(restored_removed).is_file(), preference
        memories = json.loads(conn.execute("SELECT value FROM meta WHERE key = 'photo_user_memories'").fetchone()[0])
        assert all(Path(path).is_file() for path in memories["items"][0]["sourcePaths"]), memories


def test_open_catalog_full_round_trip_is_path_free_verified_and_idempotent() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        source_api, first, second, first_xmp, _, _ = _seed_catalog(base)
        first_bytes = first.read_bytes()
        second_bytes = second.read_bytes()
        xmp_bytes = first_xmp.read_bytes()
        export_root = base / "exports"
        status = _value(source_api, "photo_catalog_status", {})
        assert status["pathFree"] is True and status["counts"]["assets"] == 2, status
        exported = _value(source_api, "export_open_photo_catalog", {
            "destination": str(export_root),
            "includeOriginals": True,
            "includeSidecars": True,
        })
        package = Path(exported["catalogPath"])
        assert package.suffix == ".vintracecatalog" and package.is_dir(), exported
        assert exported["counts"]["assets"] == 2 and exported["counts"]["sidecars"] >= 1, exported
        package_text = _catalog_text(package)
        assert str((base / "private-machine-root").resolve()).encode() not in package_text
        assert str(first.resolve()).encode() not in package_text
        assert b'"$ref":"asset"' in package_text and b'"$ref":"sidecar"' in package_text
        inspected = _value(source_api, "inspect_open_photo_catalog", {
            "catalogPath": str(package),
            "verifyMedia": True,
        })
        assert inspected["fullyVerified"] is True and inspected["format"] == OPEN_CATALOG_FORMAT, inspected

        target_api = _api(str(base / "target-app"))
        target_service = OpenPhotoCatalogService(target_api.project.db, target_api.project.root)
        original_create_connection = socket.create_connection

        def blocked_network(*_args, **_kwargs):
            raise AssertionError("open catalog import attempted network access")

        socket.create_connection = blocked_network
        try:
            imported = _value(target_api, "import_open_photo_catalog", {
                "catalogPath": str(package),
                "managedRoot": str(base / "target-managed"),
                "mergeByHash": True,
            })
        finally:
            socket.create_connection = original_create_connection
        assert imported["counts"]["created"] == 2 and imported["verified"], imported
        _assert_round_trip(target_api, first_bytes, second_bytes, xmp_bytes)

        repeated = target_service.import_catalog(package, managed_root=base / "target-managed")
        assert repeated["counts"]["created"] == 0 and repeated["counts"]["merged"] == 2, repeated
        with target_api.project.db.connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM photo_assets").fetchone()[0] == 2
            assert conn.execute("SELECT COUNT(*) FROM photo_album_items").fetchone()[0] == 2
            assert conn.execute(
                "SELECT COUNT(*) FROM photo_asset_external_ids WHERE provider = 'vintrace_open_catalog'"
            ).fetchone()[0] == 2


def test_open_catalog_rejects_tamper_traversal_symlink_and_cleans_cancelled_export() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        source_api, *_ = _seed_catalog(base)
        service = OpenPhotoCatalogService(source_api.project.db, source_api.project.root)
        package = Path(service.export_catalog(base / "exports")["catalogPath"])

        tampered = base / "tampered.vintracecatalog"
        shutil.copytree(package, tampered)
        entity_path = tampered / "catalog" / "entities.ndjson"
        entity_path.write_bytes(entity_path.read_bytes() + b"{}\n")
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(tampered, verify_media=True), "size")

        rehashed_path = base / "rehashed-path.vintracecatalog"
        shutil.copytree(package, rehashed_path)
        assets_path = rehashed_path / "catalog" / "assets.ndjson"
        asset_rows = [json.loads(line) for line in assets_path.read_text(encoding="utf-8").splitlines()]
        asset_rows[0].setdefault("metadata", {})["leakedRoot"] = "/Users/example/Private Photos"
        assets_path.write_text(
            "".join(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n" for row in asset_rows),
            encoding="utf-8",
        )
        _rehash_manifest_member(rehashed_path, "catalog/assets.ndjson")
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(rehashed_path), "machine-local path")

        false_rows = base / "false-rows.vintracecatalog"
        shutil.copytree(package, false_rows)
        false_rows_manifest_path = false_rows / "manifest.json"
        false_rows_manifest = json.loads(false_rows_manifest_path.read_text(encoding="utf-8"))
        next(item for item in false_rows_manifest["files"] if item["kind"] == "assets")["rows"] += 1
        false_rows_manifest_path.write_text(json.dumps(false_rows_manifest), encoding="utf-8")
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(false_rows), "row count")

        undeclared = base / "undeclared.vintracecatalog"
        shutil.copytree(package, undeclared)
        (undeclared / "catalog" / "unlisted.json").write_text("{}\n", encoding="utf-8")
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(undeclared), "undeclared member")

        traversal = base / "traversal.vintracecatalog"
        shutil.copytree(package, traversal)
        traversal_manifest = json.loads((traversal / "manifest.json").read_text(encoding="utf-8"))
        traversal_manifest["files"][0]["path"] = "../outside"
        (traversal / "manifest.json").write_text(json.dumps(traversal_manifest), encoding="utf-8")
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(traversal), "Unsafe")

        symlinked = base / "symlinked.vintracecatalog"
        shutil.copytree(package, symlinked)
        assets_path = symlinked / "catalog" / "assets.ndjson"
        outside = base / "outside.ndjson"
        outside.write_bytes(assets_path.read_bytes())
        assets_path.unlink()
        assets_path.symlink_to(outside)
        _expect_raises(OpenPhotoCatalogError, lambda: service.inspect_catalog(symlinked), "escapes")

        cancel_root = base / "cancelled"
        calls = 0

        def cancel() -> bool:
            nonlocal calls
            calls += 1
            return calls > 3

        _expect_raises(
            OpenPhotoCatalogCancelled,
            lambda: service.export_catalog(cancel_root, cancel_check=cancel),
            "cancelled",
        )
        assert not list(cancel_root.glob("*.vintracecatalog")), list(cancel_root.iterdir())
        assert not list(cancel_root.glob(".*.partial-*")), list(cancel_root.iterdir())

        api_cancel_root = base / "api-cancelled"
        cancel_token = "a" * 48
        cancel_marker = Path(source_api.project.root) / ".photo-catalog-cancel"
        cancel_marker.write_text(cancel_token, encoding="ascii")
        _expect_raises(
            OpenPhotoCatalogCancelled,
            lambda: source_api.export_open_photo_catalog({
                "destination": str(api_cancel_root),
                "cancelToken": cancel_token,
            }),
            "cancelled",
        )
        assert not cancel_marker.exists(), "API cancellation marker was not cleared"
        assert not list(api_cancel_root.glob("*.vintracecatalog")), list(api_cancel_root.iterdir())
        assert not list(api_cancel_root.glob(".*.partial-*")), list(api_cancel_root.iterdir())

        copy_source = base / "copy-source.bin"
        copy_target = base / "copy-target.bin"
        copy_source.write_bytes(b"0123456789abcdef" * (256 * 1024))
        copy_calls = 0

        def cancel_copy() -> bool:
            nonlocal copy_calls
            copy_calls += 1
            return copy_calls > 2

        _expect_raises(
            OpenPhotoCatalogCancelled,
            lambda: _atomic_copy_verified(
                copy_source,
                copy_target,
                expected_hash=sha256(copy_source.read_bytes()).hexdigest(),
                expected_size=copy_source.stat().st_size,
                cancel_check=cancel_copy,
            ),
            "cancelled",
        )
        assert not copy_target.exists()
        assert not list(base.glob(".copy-target.bin.partial-*"))


def test_open_catalog_rechecks_metadata_streams_after_inspection() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        source_api, *_ = _seed_catalog(base)
        source_service = OpenPhotoCatalogService(source_api.project.db, source_api.project.root)
        package = Path(source_service.export_catalog(base / "exports")["catalogPath"])
        race_package = base / "post-inspection-change.vintracecatalog"
        shutil.copytree(package, race_package)

        target_api = _api(str(base / "race-target"))
        service = OpenPhotoCatalogService(target_api.project.db, target_api.project.root)
        original_inspect = service._inspect_loaded_catalog

        def inspect_then_change(root, manifest, **kwargs):
            result = original_inspect(root, manifest, **kwargs)
            entities = root / "catalog" / "entities.ndjson"
            body = entities.read_bytes()
            assert b"Portfolio hero" in body
            entities.write_bytes(body.replace(b"Portfolio hero", b"Portfolio zero", 1))
            return result

        service._inspect_loaded_catalog = inspect_then_change
        managed = base / "race-managed"
        _expect_raises(
            OpenPhotoCatalogError,
            lambda: service.import_catalog(race_package, managed_root=managed),
            "checksum changed while reading",
        )
        with target_api.project.db.connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM photo_assets").fetchone()[0] == 0
        assert not [path for path in managed.rglob("*") if path.is_file()]


def test_open_catalog_metadata_only_round_trip_restores_graph_as_missing_assets() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        source_api, *_ = _seed_catalog(base)
        service = OpenPhotoCatalogService(source_api.project.db, source_api.project.root)
        package = Path(service.export_catalog(
            base / "exports",
            include_originals=False,
            include_sidecars=False,
            package_name="metadata-only",
        )["catalogPath"])
        manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["mediaPolicy"] == "catalog-only"
        assert not (package / "media").exists()

        target_api = _api(str(base / "metadata-target"))
        imported = OpenPhotoCatalogService(target_api.project.db, target_api.project.root).import_catalog(
            package,
            managed_root=base / "metadata-managed",
        )
        assert imported["counts"]["created"] == 2 and imported["counts"]["missing"] == 2, imported
        with target_api.project.db.connect() as conn:
            rows = conn.execute("SELECT source_path, missing_at FROM photo_assets ORDER BY asset_id").fetchall()
            assert len(rows) == 2 and all(row["missing_at"] for row in rows), rows
            assert all(not Path(row["source_path"]).exists() for row in rows), rows
            assert conn.execute("SELECT COUNT(*) FROM photo_album_items").fetchone()[0] == 2
            ratings = sorted(row[0] for row in conn.execute("SELECT rating FROM photo_asset_metadata").fetchall())
            assert ratings == [2, 5], ratings


def test_open_catalog_streams_large_metadata_round_trip_with_bounded_memory() -> None:
    asset_count = max(1_000, int(os.environ.get("VINTRACE_OPEN_CATALOG_SCALE_ASSETS", "10000") or 10_000))
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        source_api = _api(str(base / "scale-source"))
        timestamp = "2026-07-14T00:00:00Z"
        source_root = base / "offline-originals"
        with source_api.project.db.connect() as conn:
            conn.executemany(
                """
                INSERT INTO photo_assets(
                    asset_id, source_path, source_kind, file_signature_json, content_hash,
                    perceptual_hash, media_kind, mime_type, width, height, duration_ms,
                    capture_date, added_at, updated_at, missing_at, source_scan_run, metadata_json
                ) VALUES(?, ?, 'referenced', '{}', ?, '', 'image', 'image/jpeg', 4000, 3000, NULL,
                    '2026-07-14', ?, ?, ?, '', '{}')
                """,
                (
                    (
                        f"scale-asset-{index:06d}",
                        str(source_root / f"frame-{index:06d}.jpg"),
                        sha256(f"scale-original-{index}".encode("ascii")).hexdigest(),
                        timestamp,
                        timestamp,
                        timestamp,
                    )
                    for index in range(asset_count)
                ),
            )
            conn.executemany(
                """
                INSERT INTO photo_asset_metadata(
                    asset_id, title, rating, color_label, pick_status, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?)
                """,
                (
                    (
                        f"scale-asset-{index:06d}",
                        f"Scale frame {index:06d}",
                        index % 6,
                        ("", "red", "yellow", "green", "blue", "purple")[index % 6],
                        "pick" if index % 5 == 0 else ("reject" if index % 7 == 0 else ""),
                        timestamp,
                    )
                    for index in range(asset_count)
                ),
            )
        source_api.project.db.upsert_photo_album(
            album_id="scale-album",
            name="Scale order",
            album_kind="manual",
            description="Large open-catalog order proof",
            include_people=[],
            exclude_people=[],
        )
        with source_api.project.db.connect() as conn:
            conn.executemany(
                "INSERT INTO photo_album_items(album_id, asset_id, position, added_at) VALUES('scale-album', ?, ?, ?)",
                ((f"scale-asset-{index:06d}", index, timestamp) for index in range(asset_count)),
            )

        service = OpenPhotoCatalogService(source_api.project.db, source_api.project.root)
        gc.collect()
        tracemalloc.start()
        export_started = perf_counter()
        exported = service.export_catalog(
            base / "scale-export",
            include_originals=False,
            include_sidecars=False,
            package_name="scale-metadata",
        )
        export_seconds = perf_counter() - export_started
        _, export_peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        package = Path(exported["catalogPath"])
        manifest = json.loads((package / "manifest.json").read_text(encoding="utf-8"))
        assert exported["counts"]["assets"] == asset_count, exported
        assert exported["counts"]["entityRows"] >= asset_count * 2, exported
        assert next(item for item in manifest["files"] if item["kind"] == "assets")["rows"] == asset_count
        assert export_peak < 64 * 1024 * 1024, (asset_count, export_peak, export_seconds)
        assert export_seconds < 45, (asset_count, export_seconds)

        target_api = _api(str(base / "scale-target"))
        target_service = OpenPhotoCatalogService(target_api.project.db, target_api.project.root)
        gc.collect()
        tracemalloc.start()
        import_started = perf_counter()
        imported = target_service.import_catalog(package, managed_root=base / "scale-managed")
        import_seconds = perf_counter() - import_started
        _, import_peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        assert imported["counts"]["assets"] == asset_count, imported
        assert import_peak < 128 * 1024 * 1024, (asset_count, import_peak, import_seconds)
        assert import_seconds < 60, (asset_count, import_seconds)
        with target_api.project.db.connect() as conn:
            assert conn.execute("SELECT COUNT(*) FROM photo_assets").fetchone()[0] == asset_count
            assert conn.execute("SELECT COUNT(*) FROM photo_asset_metadata").fetchone()[0] == asset_count
            order = conn.execute(
                "SELECT MIN(position), MAX(position), COUNT(*) FROM photo_album_items WHERE album_id = 'scale-album'"
            ).fetchone()
            assert tuple(order) == (0, asset_count - 1, asset_count), tuple(order)
        print(
            "ok open catalog scale",
            json.dumps({
                "assets": asset_count,
                "entityRows": exported["counts"]["entityRows"],
                "exportSeconds": round(export_seconds, 3),
                "exportPeakMiB": round(export_peak / (1024 * 1024), 2),
                "importSeconds": round(import_seconds, 3),
                "importPeakMiB": round(import_peak / (1024 * 1024), 2),
            }, sort_keys=True),
        )


if __name__ == "__main__":
    test_open_catalog_full_round_trip_is_path_free_verified_and_idempotent()
    print("ok open catalog full path-free verified idempotent round trip")
    test_open_catalog_rejects_tamper_traversal_symlink_and_cleans_cancelled_export()
    print("ok open catalog tamper traversal symlink and cancellation guards")
    test_open_catalog_rechecks_metadata_streams_after_inspection()
    print("ok open catalog metadata streams rechecked after inspection")
    test_open_catalog_metadata_only_round_trip_restores_graph_as_missing_assets()
    print("ok open catalog metadata-only missing-media round trip")
    test_open_catalog_streams_large_metadata_round_trip_with_bounded_memory()

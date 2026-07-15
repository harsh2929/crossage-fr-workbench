"""Edge-case coverage for APL-LIB-08 media-pair backup-check integrity.

backup_check's catalog-integrity sweep already flags media pairs whose `asset_id`
or `related_asset_id` points at a missing asset, but no test pinned the
`related_asset_id` orphan case for media pairs specifically. This seeds a pair
whose related asset was deleted and proves backup_check surfaces it with the
`relatedAsset` missing-link classification so repair/restore can act on it.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_media_pair_backup_check_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api, _write_exif_photo


def test_backup_check_flags_media_pair_with_missing_related_asset() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        photo = Path(tmp) / "pair-anchor.jpg"
        _write_exif_photo(photo)
        imported = api.import_photos(
            {"sourcePaths": [str(photo)], "storageMode": "referenced", "sourceLabel": "Pair anchor"}
        )
        asset = api.project.db.photo_asset_by_path(imported["importedPaths"][0])
        assert asset, asset
        now = "2026-06-29T00:00:00Z"
        with api.project.db.connect() as conn:
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute(
                """
                INSERT INTO photo_media_pairs(
                    pair_id, asset_id, related_asset_id, pair_kind,
                    source_path, related_source_path, metadata_json, created_at, updated_at
                ) VALUES(?, ?, ?, 'raw_sidecar', ?, ?, '{}', ?, ?)
                """,
                (
                    "pair-orphan",
                    asset["assetId"],
                    "ghost-related-asset",
                    imported["importedPaths"][0],
                    "/ghost/raw.dng",
                    now,
                    now,
                ),
            )

        result = api.photo_library_backup_check({"sampleLimit": 10})
        assert result["counts"]["catalogIntegrityIssues"] >= 1, result["counts"]
        pair_samples = [
            sample
            for sample in result["samples"]["catalogIntegrityIssues"]
            if sample.get("table") == "photo_media_pairs"
        ]
        assert pair_samples, result["samples"]["catalogIntegrityIssues"]
        assert pair_samples[0]["missingLink"] == "relatedAsset", pair_samples
        assert pair_samples[0]["relatedAssetId"] == "ghost-related-asset", pair_samples


def test_backup_check_accepts_derived_album_folder_covers() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        folder = api.save_photo_album_folder({"name": "Derived cover folder"})
        api.save_photo_album(
            {
                "name": "Folder album",
                "albumKind": "manual",
                "folderId": folder["folderId"],
            }
        )

        result = api.photo_library_backup_check({"sampleLimit": 10})
        assert result["counts"]["albumFolders"] == 1, result["counts"]
        assert all(
            sample.get("table") != "photo_album_folders"
            for sample in result["samples"]["catalogIntegrityIssues"]
        ), result["samples"]["catalogIntegrityIssues"]


if __name__ == "__main__":
    test_backup_check_flags_media_pair_with_missing_related_asset()
    test_backup_check_accepts_derived_album_folder_covers()
    print("all photo_media_pair_backup_check_units tests passed")

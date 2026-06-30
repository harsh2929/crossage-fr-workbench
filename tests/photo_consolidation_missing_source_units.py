"""Edge-case coverage for APL-LIB-09 consolidation robustness.

Consolidation copies referenced originals into the managed library. If a
referenced original was deleted on disk before consolidation runs, the asset
must be skipped and reported (not silently lost or crashing the batch). This
proves one externally-deleted source is reported under `missingSources` while
the remaining valid asset still consolidates and preserves identity.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_consolidation_missing_source_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api, _write_exif_photo


def test_consolidation_skips_missing_source_and_preserves_the_rest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        base = Path(tmp)
        src_dir = base / "referenced"
        src_dir.mkdir()
        alice = src_dir / "alice.jpg"
        bob = src_dir / "bob.jpg"
        _write_exif_photo(alice)
        _write_exif_photo(bob)
        api.import_photos(
            {"sourcePaths": [str(alice), str(bob)], "storageMode": "referenced", "sourceLabel": "Ref"}
        )
        alice_path = str(alice.resolve())
        bob_path = str(bob.resolve())
        bob_asset = api.project.db.photo_asset_by_path(bob_path)
        assert bob_asset, bob_asset

        managed_root = base / "managed-root"
        api.save_photo_library_settings({"defaultManagedRoot": str(managed_root), "defaultStorageMode": "managed"})

        # Externally delete bob's referenced original before consolidation runs.
        bob.unlink()

        result = api.consolidate_photo_library_assets({"sourcePaths": [alice_path, bob_path]})
        assert result["consolidatedAssets"] == 1, result
        assert result["skippedAssets"] >= 1, result
        missing_paths = {entry["sourcePath"] for entry in result["missingSources"]}
        missing_ids = {entry["assetId"] for entry in result["missingSources"]}
        assert bob_path in missing_paths or bob_asset["assetId"] in missing_ids, result

        # Alice is consolidated away from its referenced path; bob's row survives intact.
        assert api.project.db.photo_asset_by_path(alice_path) is None, "alice should be consolidated"
        assert api.project.db.photo_asset_by_path(bob_path) is not None, "bob's original row must remain"


if __name__ == "__main__":
    test_consolidation_skips_missing_source_and_preserves_the_rest()
    print("all photo_consolidation_missing_source_units tests passed")

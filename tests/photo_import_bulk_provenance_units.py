"""Unit tests for APL-LIB-04 bulk import-session provenance correction.

`update_photo_import_session_provenance` only relabels one session at a time.
This proves the new bulk path relabels many sessions in one call (propagating
the correction to each session's imported asset metadata) and reports unknown
ids as missing rather than failing the whole batch.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_import_bulk_provenance_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api


def _import_one(api, src_dir: Path, name: str, kind: str, label: str):
    photo = src_dir / name
    photo.write_bytes(b"bulk provenance " + name.encode())
    return api.import_photos(
        {"sourcePaths": [str(photo)], "storageMode": "referenced", "sourceKind": kind, "sourceLabel": label}
    )


def test_bulk_import_session_provenance_updates_many_and_reports_missing() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        src = Path(tmp) / "src"
        src.mkdir()
        first = _import_one(api, src, "a.jpg", "folder", "Folder A")
        second = _import_one(api, src, "b.jpg", "folder", "Folder B")

        result = api.bulk_update_photo_import_session_provenance(
            {
                "importIds": [first["importId"], second["importId"], "missing-import"],
                "sourceKind": "phone",
                "sourceLabel": "iPhone 15",
                "sourceDetail": "Reclassified from folder import",
            }
        )
        assert result["changed"] == 2, result
        assert result["missing"] == ["missing-import"], result
        assert result["updatedAssets"] >= 2, result

        sessions = {s["importId"]: s for s in api.project.db.list_photo_import_sessions(limit=20)}
        for import_id in (first["importId"], second["importId"]):
            session = sessions[import_id]
            assert session["sourceKind"] == "phone", session
            assert session["sourceLabel"] == "iPhone 15", session
            assert session["sourceDetail"] == "Reclassified from folder import", session

        # A single relabeled asset reflects the corrected provenance metadata.
        asset = api.project.db.photo_asset_by_path(str((src / "a.jpg").resolve()))
        assert asset["metadata"]["importSourceKind"] == "phone", asset
        assert asset["metadata"]["importSourceLabel"] == "iPhone 15", asset


if __name__ == "__main__":
    test_bulk_import_session_provenance_updates_many_and_reports_missing()
    print("all photo_import_bulk_provenance_units tests passed")

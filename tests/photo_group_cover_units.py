"""APL-ALBUM-06: people-group key-photo/cover roundtrip.

Album/place/person/utility covers are tested, but people-group covers were not.
This pins the group cover path: setting a member asset as the group key photo
drives the group folder cover, and clearing it falls back to the generated
representative cover (a non-member/cleared key is not forced onto the folder).

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_group_cover_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api, _sig, _candidate


def test_people_group_cover_set_and_clear_roundtrip() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        base = Path(tmp)
        a1 = str(base / "ab1.jpg")
        a2 = str(base / "ab2.jpg")
        api.project.db.create_scan_run("run1", "label", "manual", str(base))
        for path in (a1, a2):
            api.project.db.record_scan_file("run1", Path(path), _sig(Path(path)), "completed", phase="processed")
        api.project.candidates = {
            "ab1-a": _candidate("ab1-a", "Alice", a1, status="accepted", score=0.95),
            "ab1-b": _candidate("ab1-b", "Bob", a1, status="accepted", score=0.94),
            "ab2-a": _candidate("ab2-a", "Alice", a2, status="accepted", score=0.93),
            "ab2-b": _candidate("ab2-b", "Bob", a2, status="accepted", score=0.92),
        }
        a2_id = api.project.db.photo_asset_by_path(a2)["assetId"]

        saved = api.save_photo_people_group({"name": "Alice & Bob Group", "memberPeople": ["Alice", "Bob"]})
        gid = saved["groupId"]
        folder_id = f"group:saved:{gid}"

        # Set a specific member asset as the group cover.
        api.save_photo_people_group({"groupId": gid, "name": "Alice & Bob Group", "memberPeople": ["Alice", "Bob"], "keyAssetId": a2_id})
        group = next(folder for folder in api.list_photo_folders({})["folders"] if folder["id"] == folder_id)
        assert group["coverSourcePath"] == a2, group
        assert group["groupProfile"]["keyAssetId"] == a2_id, group

        # Clear the cover: the persisted key is cleared and the cover falls back.
        api.save_photo_people_group({"groupId": gid, "name": "Alice & Bob Group", "memberPeople": ["Alice", "Bob"], "keyAssetId": ""})
        cleared = next(folder for folder in api.list_photo_folders({})["folders"] if folder["id"] == folder_id)
        assert cleared["groupProfile"]["keyAssetId"] == "", cleared


if __name__ == "__main__":
    test_people_group_cover_set_and_clear_roundtrip()
    print("all photo_group_cover_units tests passed")

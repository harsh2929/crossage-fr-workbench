"""Unit tests for APL-LIB-05 per-root backup policy enforcement at import.

A managed root profile stores an `externalBackupCovered` policy, but importing
managed copies never consulted it. This proves a managed import into a root with
no external backup coverage surfaces a warning, that marking the root covered
clears it, and that referenced imports never raise the managed-root warning.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_import_backup_policy_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api

WARNING_CODE = "managed-root-backup-not-covered"


def _has(result, code: str) -> bool:
    return any(warning["code"] == code for warning in result.get("warnings", []))


def test_managed_import_warns_until_root_backup_is_covered() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        base = Path(tmp)
        managed_root = base / "managed-lib"
        managed_root.mkdir()
        src = base / "src"
        src.mkdir()
        api.save_photo_library_settings(
            {
                "managedRoots": [{"path": str(managed_root.resolve())}],
                "defaultManagedRoot": str(managed_root.resolve()),
            }
        )

        # Newly registered managed root: no external backup coverage -> warn.
        photo1 = src / "a.jpg"
        photo1.write_bytes(b"backup uncovered bytes")
        uncovered = api.import_photos(
            {"sourcePaths": [str(photo1)], "storageMode": "managed", "managedRoot": str(managed_root.resolve())}
        )
        assert _has(uncovered, WARNING_CODE), uncovered

        # Mark the root externally backed up -> warning clears.
        api.save_photo_library_settings(
            {
                "managedRootPolicy": {
                    "path": str(managed_root.resolve()),
                    "policy": {"externalBackupCovered": True, "externalBackupLabel": "Time Machine"},
                }
            }
        )
        photo2 = src / "b.jpg"
        photo2.write_bytes(b"backup covered bytes")
        covered = api.import_photos(
            {"sourcePaths": [str(photo2)], "storageMode": "managed", "managedRoot": str(managed_root.resolve())}
        )
        assert not _has(covered, WARNING_CODE), covered

        # Referenced imports leave originals in place and never raise the managed warning.
        photo3 = src / "c.jpg"
        photo3.write_bytes(b"referenced bytes")
        referenced = api.import_photos({"sourcePaths": [str(photo3)], "storageMode": "referenced"})
        assert not _has(referenced, WARNING_CODE), referenced


if __name__ == "__main__":
    test_managed_import_warns_until_root_backup_is_covered()
    print("all photo_import_backup_policy_units tests passed")

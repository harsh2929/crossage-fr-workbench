"""Unit tests for APL-LIB-02 per-root keep-folder default application + UI-feedback source.

Proves that an explicit photo import (1) applies a managed root profile's
`keepFolderOrganizationDefault` policy when the caller does not pass an explicit
flag, and (2) reports *why* keep-folder ended up on/off via a new
`keepFolderOrganizationSource` field (explicit / root-default / off) so the
Photos import UI can surface the provenance of the decision.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_import_keep_folder_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from photo_folders_units import _api


def test_keep_folder_source_reports_root_default_explicit_and_off() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        base = Path(tmp)
        managed_root = base / "managed-lib"
        managed_root.mkdir()
        src = base / "src"
        src.mkdir()

        # Register the managed root, then set its keep-folder policy default ON
        # (policy is updated through the dedicated managedRootPolicy param).
        api.save_photo_library_settings(
            {
                "managedRoots": [{"path": str(managed_root.resolve())}],
                "defaultManagedRoot": str(managed_root.resolve()),
            }
        )
        api.save_photo_library_settings(
            {
                "managedRootPolicy": {
                    "path": str(managed_root.resolve()),
                    "policy": {"keepFolderOrganizationDefault": True},
                }
            }
        )

        # (1) Managed import without an explicit flag: the root policy default applies.
        photo1 = src / "a.jpg"
        photo1.write_bytes(b"keep folder photo bytes")
        root_default = api.import_photos(
            {
                "sourcePaths": [str(photo1)],
                "storageMode": "managed",
                "managedRoot": str(managed_root.resolve()),
                "sourceLabel": "Root default import",
            }
        )
        assert root_default["keepFolderOrganization"] is True, root_default
        assert root_default["keepFolderOrganizationSource"] == "root-default", root_default

        # (2) Explicit flag wins and is reported as the source.
        photo2 = src / "b.jpg"
        photo2.write_bytes(b"explicit keep folder bytes")
        explicit = api.import_photos(
            {
                "sourcePaths": [str(photo2)],
                "storageMode": "managed",
                "managedRoot": str(managed_root.resolve()),
                "keepFolderOrganization": False,
                "sourceLabel": "Explicit import",
            }
        )
        assert explicit["keepFolderOrganization"] is False, explicit
        assert explicit["keepFolderOrganizationSource"] == "explicit", explicit

        # (3) Referenced imports never keep folders; source is reported as off.
        photo3 = src / "c.jpg"
        photo3.write_bytes(b"referenced bytes")
        referenced = api.import_photos(
            {
                "sourcePaths": [str(photo3)],
                "storageMode": "referenced",
                "sourceLabel": "Referenced import",
            }
        )
        assert referenced["keepFolderOrganization"] is False, referenced
        assert referenced["keepFolderOrganizationSource"] == "off", referenced


if __name__ == "__main__":
    test_keep_folder_source_reports_root_default_explicit_and_off()
    print("all photo_import_keep_folder_units tests passed")

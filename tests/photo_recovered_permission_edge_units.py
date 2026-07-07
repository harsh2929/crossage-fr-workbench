"""Edge-case coverage for APL-LIB-07 recovered cleanup robustness.

The recovered-cleanup path already guards file deletion with `except OSError`,
but the documented remaining work was permission-error edge coverage. This
exercises a denied unlink (read-only parent directory) and proves cleanup still
deletes the catalog row, counts the failure, leaves the file in place, and never
raises — i.e. one unwritable recovered file cannot abort the whole cleanup.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_recovered_permission_edge_units.py
"""

from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

from photo_folders_units import _api, _write_exif_photo


def test_recovered_cleanup_handles_permission_error_without_crashing() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        managed_root = Path(tmp) / "managed"
        managed_root.mkdir()
        orphan = managed_root / "locked-orphan.jpg"
        _write_exif_photo(orphan)

        scanned = api.scan_photo_recovered_orphans({"roots": [str(managed_root)], "limit": 10})
        assert scanned["recorded"] == 1, scanned
        failure = api.list_photo_import_failures({"limit": 10})["failures"][0]
        api.dismiss_photo_import_failure({"failureId": failure["failureId"]})
        with api.project.db.connect() as conn:
            conn.execute(
                "UPDATE photo_import_failures SET dismissed_at = ? WHERE failure_id = ?",
                ("2000-01-01T00:00:00Z", failure["failureId"]),
            )

        # Deny deletion by making the recovered file's parent directory read-only.
        os.chmod(managed_root, stat.S_IRUSR | stat.S_IXUSR)
        try:
            cleaned = api.photo_recovered_cleanup(
                {"apply": True, "retentionDays": 1, "deleteRecoveredFiles": True, "sampleLimit": 8}
            )
        finally:
            os.chmod(managed_root, stat.S_IRWXU)

        assert cleaned["status"] == "repaired", cleaned
        assert cleaned["counts"]["rowsDeleted"] == 1, cleaned
        assert cleaned["counts"]["filesDeleted"] == 0, cleaned
        assert cleaned["counts"]["fileDeleteFailures"] == 1, cleaned
        assert orphan.exists(), "recovered file must remain when deletion is denied"


if __name__ == "__main__":
    test_recovered_cleanup_handles_permission_error_without_crashing()
    print("all photo_recovered_permission_edge_units tests passed")

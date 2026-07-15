"""A workspace backup must be restorable onto a DIFFERENT machine.

Disaster recovery is the whole point of a backup: the Mac disk dies, the user has a backup ZIP
and their printed recovery code, and restores onto a new Mac. But `restore_workspace_backup`
verifies the archived SQLCipher database by opening it with the HOST app's active workspace key
(`_verify_backup_database_entry` -> `self.db._open_connection`). On any new machine that key
differs from the backed-up key, so the open raises `WorkspaceEncryptionError` — a `RuntimeError`
that neither verify nor restore caught, aborting the whole operation before a single file is
extracted.

Every existing roundtrip test exports and restores through the SAME in-memory key, so the host
key always equals the archived key and the failure never surfaces. This test forces the keys to
differ, which is what a real disaster recovery does.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/workspace_backup_cross_machine_units.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def main() -> None:
    prev_key = os.environ.get("VINTRACE_WORKSPACE_DB_KEY")
    prev_req = os.environ.get("VINTRACE_REQUIRE_DB_ENCRYPTION")
    os.environ["VINTRACE_REQUIRE_DB_ENCRYPTION"] = "0"
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            # --- Machine A: encrypted workspace under key A, then export a backup ---
            os.environ["VINTRACE_WORKSPACE_DB_KEY"] = "A" * 64
            api_a = DesktopApi(root / "machine-A" / "ws", actor="A")
            photo = root / "a.jpg"
            Image.new("RGB", (16, 16), (10, 20, 30)).save(photo)
            with api_a.project.db.connect() as conn:
                api_a.project.db._upsert_photo_asset(  # noqa: SLF001
                    conn,
                    source_path=str(photo),
                    content_hash="hash-a",
                    file_signature=path_signature(photo),
                )
                conn.commit()
            exported = api_a.project.export_workspace_backup(root / "backups")
            zip_path = Path(exported["zipPath"])
            check("backup exported", zip_path.exists())

            # --- Machine B: a genuinely different key, fresh workspace ---
            os.environ["VINTRACE_WORKSPACE_DB_KEY"] = "B" * 64
            api_b = DesktopApi(root / "machine-B" / "ws", actor="B")

            # verify must not crash with a different host key.
            verify = api_b.project.verify_workspace_backup(zip_path)
            check("cross-machine verify does not raise", isinstance(verify, dict))
            check("cross-machine verify reports a result (ok True/False, not a crash)", "ok" in verify)

            # restore must complete rather than aborting on the key mismatch.
            restored = api_b.project.restore_workspace_backup(zip_path, root / "machine-B" / "restored")
            check("cross-machine restore completes", isinstance(restored, dict))
            restored_db = root / "machine-B" / "restored" / "workspace.sqlite3"
            check("restored workspace.sqlite3 exists on the new machine", restored_db.exists())
            check("restored DB is non-empty", restored_db.stat().st_size > 0)

            # The key-mismatch relaxation must NOT wave through genuine corruption. On the
            # SAME machine (host key id == archived key id), a DB that will not open is corrupt,
            # not a key mismatch, and must be rejected.
            import zipfile

            os.environ["VINTRACE_WORKSPACE_DB_KEY"] = "A" * 64  # back to the machine that made it
            api_a2 = DesktopApi(root / "machine-A" / "ws", actor="A")
            corrupt_zip = root / "corrupt.zip"
            with zipfile.ZipFile(zip_path) as zin, zipfile.ZipFile(corrupt_zip, "w") as zout:
                for item in zin.namelist():
                    data = zin.read(item)
                    if item == "workspace.sqlite3":
                        data = b"GARBAGE-NOT-A-DB" * 200  # not SQLCipher, not plaintext SQLite
                    zout.writestr(item, data)
            verify_corrupt = api_a2.project.verify_workspace_backup(corrupt_zip)
            check("same-machine corrupt DB is rejected (ok=False)", verify_corrupt.get("ok") is False)
            db_report = verify_corrupt.get("databaseIntegrity") or {}
            check(
                "corruption is NOT excused as a key mismatch",
                not db_report.get("keyMismatch"),
            )
    finally:
        for name, value in (
            ("VINTRACE_WORKSPACE_DB_KEY", prev_key),
            ("VINTRACE_REQUIRE_DB_ENCRYPTION", prev_req),
        ):
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value

    print("\nAll cross-machine backup restore checks passed.")


if __name__ == "__main__":
    main()

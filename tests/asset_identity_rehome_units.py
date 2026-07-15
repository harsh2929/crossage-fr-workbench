"""Moving or renaming a file must not destroy its identity.

The bug (live today, nothing to do with mobile):

    asset_id = "asset_" + sha256(expanduser(source_path))[:32]   # workspace_db.py:2642

and the upsert resolves an existing row with

    WHERE asset_id = ? OR source_path = ?                        # workspace_db.py:8330

Both branches are PATH-derived. So a moved or renamed file matches neither, a brand-new
asset is minted, and the old row is left orphaned pointing at a path that no longer exists.
Everything hanging off the old asset_id — faces, people links, album membership, keywords,
ratings, favourites, edit stacks, embeddings — is silently stranded.

The fix adds conservative content-hash rehoming: when a file arrives whose path is unknown
but whose content hash and file signature match exactly one existing asset whose own path has
vanished from disk, that is a MOVE, and the identity follows the bytes.

Conservative by design: if the old file still exists it is a COPY (two real assets), and if
several vanished assets share the hash the move is ambiguous. Neither case rehomes.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/asset_identity_rehome_units.py
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.store.workspace_db import path_signature


FIXED_NS = 1_700_000_000_000_000_000  # a stable mtime, so signatures can be made identical


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _photo(path: Path, colour: tuple[int, int, int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (16, 16), colour).save(path)


def _upsert(api: DesktopApi, path: Path, content_hash: str) -> str:
    """Mirror the real ingest path, which always supplies a file signature."""
    with api.project.db.connect() as conn:
        asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(path),
            content_hash=content_hash,
            file_signature=path_signature(path) if path.exists() else None,
        )
        conn.commit()
    return asset_id


def _asset_count(api: DesktopApi) -> int:
    with api.project.db.connect() as conn:
        return int(conn.execute("SELECT COUNT(*) AS n FROM photo_assets").fetchone()["n"])


def _source_path_of(api: DesktopApi, asset_id: str) -> str:
    with api.project.db.connect() as conn:
        row = conn.execute(
            "SELECT source_path FROM photo_assets WHERE asset_id = ?", (asset_id,)
        ).fetchone()
    return str(row["source_path"]) if row else ""


def main() -> None:
    # --- 1. A MOVE must preserve identity -------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")

        original = root / "photos" / "beach.jpg"
        _photo(original, (10, 120, 200))
        first_id = _upsert(api, original, content_hash="hash-beach")
        check("import creates an asset", bool(first_id))
        check("one asset after import", _asset_count(api) == 1)

        # The user moves/renames the file. The bytes are identical.
        moved = root / "photos" / "2024" / "beach-holiday.jpg"
        moved.parent.mkdir(parents=True, exist_ok=True)
        original.rename(moved)

        second_id = _upsert(api, moved, content_hash="hash-beach")

        check("MOVE preserves asset identity", second_id == first_id)
        check("MOVE does not create a second asset", _asset_count(api) == 1)
        check("MOVE rehomes source_path to the new location", _source_path_of(api, first_id) == str(moved))

    # --- 2. A COPY must NOT be merged -----------------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")

        a = root / "a.jpg"
        _photo(a, (200, 40, 40))
        id_a = _upsert(api, a, content_hash="hash-dup")

        # Same bytes, different path, and the ORIGINAL STILL EXISTS. This is a copy,
        # i.e. two genuinely distinct assets that happen to be duplicates.
        b = root / "b.jpg"
        _photo(b, (200, 40, 40))
        id_b = _upsert(api, b, content_hash="hash-dup")

        check("COPY is not rehomed (original still on disk)", id_b != id_a)
        check("COPY creates a second asset", _asset_count(api) == 2)

    # --- 3. An AMBIGUOUS move must NOT guess ----------------------------------------------
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")

        x = root / "x.jpg"
        y = root / "y.jpg"
        _photo(x, (30, 200, 90))
        _photo(y, (30, 200, 90))
        # Force identical signatures so the two candidates are truly indistinguishable.
        os.utime(y, ns=(FIXED_NS, FIXED_NS))
        os.utime(x, ns=(FIXED_NS, FIXED_NS))
        id_x = _upsert(api, x, content_hash="hash-same")
        id_y = _upsert(api, y, content_hash="hash-same")
        check("two identical-hash assets exist", id_x != id_y and _asset_count(api) == 2)

        # Both vanish, then one file appears elsewhere with the SAME signature.
        # Which of the two moved? Unknowable. Must not guess.
        x.unlink()
        y.unlink()
        z = root / "z.jpg"
        _photo(z, (30, 200, 90))
        os.utime(z, ns=(FIXED_NS, FIXED_NS))
        id_z = _upsert(api, z, content_hash="hash-same")

        check("AMBIGUOUS move does not guess (mints a new asset)", id_z not in {id_x, id_y})
        check("AMBIGUOUS move leaves the originals intact", _asset_count(api) == 3)

    # --- 4. No content hash => cannot rehome (must not merge on emptiness) ----------------
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")

        p = root / "p.jpg"
        _photo(p, (90, 90, 90))
        id_p = _upsert(api, p, content_hash="")
        p.unlink()

        q = root / "q.jpg"
        _photo(q, (90, 90, 90))
        id_q = _upsert(api, q, content_hash="")

        check("empty content hash never rehomes", id_q != id_p)

    _check_external_drive_is_not_rehomed()
    _check_associations_survive_a_move()

    print("\nAll asset-identity rehoming checks passed.")


def _check_external_drive_is_not_rehomed() -> None:
    """The hazard that makes "path is missing" insufficient evidence of a move.

    An asset on an EXTERNAL DRIVE has a missing source_path whenever the drive is unplugged.
    If the user then imports an identical photo from a backup, a naive rehome would adopt the
    external-drive asset onto the new path and destroy the record of where the original lives.

    A move preserves size AND mtime. A separate copy does not. That is the discriminator.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")

        on_drive = root / "volumes" / "usb" / "holiday.jpg"
        _photo(on_drive, (12, 34, 56))
        os.utime(on_drive, ns=(FIXED_NS, FIXED_NS))
        drive_id = _upsert(api, on_drive, content_hash="hash-holiday")

        # Drive unplugged: the path vanishes, but the asset is still legitimately ours.
        on_drive.unlink()

        # The user imports the SAME PHOTO from a backup. Identical bytes, but it is a
        # different file on disk: a different mtime.
        from_backup = root / "backup" / "holiday.jpg"
        _photo(from_backup, (12, 34, 56))
        os.utime(from_backup, ns=(FIXED_NS + 999_000_000, FIXED_NS + 999_000_000))
        backup_id = _upsert(api, from_backup, content_hash="hash-holiday")

        check("external-drive asset is NOT hijacked by an identical backup copy", backup_id != drive_id)
        check("the unplugged-drive asset still points at the drive", _source_path_of(api, drive_id) == str(on_drive))
        check("the backup copy becomes its own asset", _asset_count(api) == 2)


def _check_associations_survive_a_move() -> None:
    """The point of the fix: the user's WORK must survive a move, not just the row.

    Faces, people links, album membership, keywords, rating and favourite all foreign-key
    the asset_id. Preserving the id is what keeps them attached; this asserts it end to end.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = DesktopApi(root / "ws", actor="test")
        db = api.project.db

        photo = root / "album" / "kid.jpg"
        _photo(photo, (240, 180, 60))
        asset_id = _upsert(api, photo, content_hash="hash-kid")

        with db.connect() as conn:
            # The user does real work on this photo.
            now = "2026-07-14T00:00:00Z"
            conn.execute(
                "UPDATE photo_asset_metadata SET favorite = 1, rating = 5 WHERE asset_id = ?",
                (asset_id,),
            )
            conn.execute(
                "INSERT INTO photo_asset_people(asset_id, candidate_id, person_name, status, updated_at)"
                " VALUES (?, 'cand_1', 'Ada', 'confirmed', '2026-07-14T00:00:00Z')",
                (asset_id,),
            )
            conn.execute(
                "INSERT INTO photo_keywords(keyword_id, name, created_at, updated_at) "
                "VALUES('kw_move', 'Birthday', ?, ?)",
                (now, now),
            )
            conn.execute(
                "INSERT INTO photo_asset_keywords(asset_id, keyword_id, assigned_at) "
                "VALUES(?, 'kw_move', ?)",
                (asset_id, now),
            )
            conn.execute(
                "INSERT INTO photo_albums(album_id, name, album_kind, created_at, updated_at) "
                "VALUES('album_move', 'Family', 'manual', ?, ?)",
                (now, now),
            )
            conn.execute(
                "INSERT INTO photo_album_items(album_id, asset_id, position, added_at) "
                "VALUES('album_move', ?, 0, ?)",
                (asset_id, now),
            )
            conn.execute(
                "INSERT INTO photo_edit_stacks(edit_id, asset_id, created_at, updated_at) "
                "VALUES('edit_move', ?, ?, ?)",
                (asset_id, now, now),
            )
            signature = path_signature(photo)
            conn.execute(
                "INSERT INTO photo_semantic_embeddings("
                "asset_id, model_name, source_path, file_size, file_mtime_ns, vector_json, updated_at"
                ") VALUES(?, 'fixture-model', ?, ?, ?, '[0.1, 0.2]', ?)",
                (asset_id, str(photo), signature["size"], signature["mtimeNs"], now),
            )

        # ...then reorganises their library on disk.
        moved = root / "album" / "2019" / "kid-birthday.jpg"
        moved.parent.mkdir(parents=True, exist_ok=True)
        photo.rename(moved)
        rehomed_id = _upsert(api, moved, content_hash="hash-kid")

        check("association test: identity preserved across the move", rehomed_id == asset_id)

        with db.connect() as conn:
            meta = conn.execute(
                "SELECT favorite, rating FROM photo_asset_metadata WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            person = conn.execute(
                "SELECT person_name FROM photo_asset_people WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            keyword = conn.execute(
                "SELECT keyword_id FROM photo_asset_keywords WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            album = conn.execute(
                "SELECT album_id FROM photo_album_items WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            edit = conn.execute(
                "SELECT edit_id FROM photo_edit_stacks WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()
            embedding = conn.execute(
                "SELECT model_name FROM photo_semantic_embeddings WHERE asset_id = ?",
                (asset_id,),
            ).fetchone()

        check("favourite survives the move", meta is not None and int(meta["favorite"]) == 1)
        check("rating survives the move", meta is not None and int(meta["rating"]) == 5)
        check("person link survives the move", person is not None and str(person["person_name"]) == "Ada")
        check("keyword survives the move", keyword is not None and str(keyword["keyword_id"]) == "kw_move")
        check("album membership survives the move", album is not None and str(album["album_id"]) == "album_move")
        check("edit stack survives the move", edit is not None and str(edit["edit_id"]) == "edit_move")
        check(
            "semantic embedding survives the move",
            embedding is not None and str(embedding["model_name"]) == "fixture-model",
        )


if __name__ == "__main__":
    main()

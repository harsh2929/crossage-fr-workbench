"""A "catalog-only" Open Photo Catalog export must ship ZERO media bytes.

`mediaPolicy` is derived solely from `include_originals`, but the sidecar byte-copy was gated
only on `include_sidecars`. So a `catalog-only` export (include_originals=False) with the default
`include_sidecars=True` still shipped media companions — Live Photo `.mov` halves, depth maps,
RAW/XMP sidecars. A user who picks "Catalog only" expecting a small, pixel-free metadata package
got media bytes anyway, and the manifest's `includeSidecars: true` advertised it as if intended.

Fix: sidecar media bytes require `include_originals`. Catalog-only ships zero bytes under
`media/`, and the manifest reports `includeSidecars: false` truthfully. The pairing RELATIONSHIP
is still preserved (photo_media_pairs is exported as metadata rows), only the bytes are dropped.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 python3 tests/catalog_only_no_media_bytes_units.py
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PIL import Image

from crossage_fr.api_server import DesktopApi
from crossage_fr.photo_catalog_portability import OpenPhotoCatalogService
from crossage_fr.store.workspace_db import path_signature


def check(label: str, cond: bool) -> None:
    if not cond:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"ok {label}")


def _seed(root: Path) -> DesktopApi:
    api = DesktopApi(root / "ws", actor="t")
    photo = root / "live.jpg"
    Image.new("RGB", (32, 32), (10, 120, 200)).save(photo)
    # The Live Photo video half — unambiguously media bytes.
    movie = root / "live.mov"
    movie.write_bytes(b"\x00\x00\x00\x18ftypqt  " + b"FAKE-LIVE-PHOTO-VIDEO" * 64)
    with api.project.db.connect() as conn:
        asset_id = api.project.db._upsert_photo_asset(  # noqa: SLF001
            conn,
            source_path=str(photo),
            content_hash="hash-live",
            file_signature=path_signature(photo),
        )
        conn.execute(
            "INSERT INTO photo_media_pairs(pair_id, asset_id, related_asset_id, pair_kind,"
            " source_path, related_source_path, created_at, updated_at)"
            " VALUES ('pair_1', ?, '', 'live_photo', ?, ?, '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z')",
            (asset_id, str(photo), str(movie)),
        )
        conn.commit()
    return api


def _media_entries(package: Path) -> list[str]:
    return [str(p.relative_to(package)) for p in package.rglob("*") if p.is_file() and "media" in p.parts]


def _manifest(package: Path) -> dict:
    return json.loads((package / "manifest.json").read_text())


def main() -> None:
    # 1. catalog-only must ship ZERO media bytes even with include_sidecars=True (the default).
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _seed(root)
        service = OpenPhotoCatalogService(api.project.db, api.project.root)
        result = service.export_catalog(
            root / "exports", include_originals=False, include_sidecars=True
        )
        package = Path(result["catalogPath"])
        manifest = _manifest(package)

        media = _media_entries(package)
        check(f"catalog-only ships NO media bytes (found {media})", media == [])
        check("catalog-only manifest mediaPolicy == catalog-only", manifest["mediaPolicy"] == "catalog-only")
        check(
            "catalog-only manifest includeSidecars is truthfully false",
            manifest["includeSidecars"] is False,
        )
        # The pairing metadata relationship must still be preserved.
        entities = (package / "catalog" / "entities.ndjson").read_text() if (package / "catalog" / "entities.ndjson").exists() else ""
        check("the Live-Photo pairing relationship is still exported as metadata", "photo_media_pairs" in entities)

    # 2. full export must STILL ship the media bytes — no regression.
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        api = _seed(root)
        service = OpenPhotoCatalogService(api.project.db, api.project.root)
        result = service.export_catalog(
            root / "exports", include_originals=True, include_sidecars=True
        )
        package = Path(result["catalogPath"])
        manifest = _manifest(package)
        media = _media_entries(package)
        check(f"full export DOES ship media bytes (found {len(media)})", len(media) > 0)
        check("full export manifest mediaPolicy == full", manifest["mediaPolicy"] == "full")
        check("full export manifest includeSidecars stays true", manifest["includeSidecars"] is True)

    print("\nAll catalog-only media-byte checks passed.")


if __name__ == "__main__":
    main()

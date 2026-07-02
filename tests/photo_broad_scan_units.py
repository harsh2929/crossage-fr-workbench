"""Unit tests for the "index everything on this computer" broad-scan crawl.

Covers WorkspaceDb._expand_photo_import_sources with the new exclude support that
powers the whole-computer indexing option: a broad crawl must collect real photos
(Desktop / Documents / Downloads / project folders) while pruning caches, build
output, VCS dirs, app bundles, and Library/AppData internals — and it must stay
backward-compatible (no excludes → original behaviour) plus honor explicit
excluded_dirs. Engine-free; touches only a throwaway temp tree.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_broad_scan_units.py
"""

from __future__ import annotations

import pathlib
import tempfile

from crossage_fr.store.workspace_db import WorkspaceDb


def _build_home() -> tuple[pathlib.Path, set[str]]:
    home = pathlib.Path(tempfile.mkdtemp()).resolve()

    def touch(rel: str) -> None:
        target = home / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(b"x")

    real = {"vacation.jpg", "scan.png", "meme.jpeg", "hero.png"}
    for rel in (
        "Desktop/vacation.jpg",
        "Documents/receipts/scan.png",
        "Downloads/meme.jpeg",
        "Projects/app/design/hero.png",
    ):
        touch(rel)
    for rel in (
        "Projects/app/node_modules/pkg/logo.png",
        ".cache/thumb.jpg",
        "Library/Caches/app/img.png",
        "Photos.app/Contents/Resources/icon.png",
        ".git/assets/x.png",
        "AppData/Local/Cache/y.png",
        "Library/Mobile Documents/com~apple~CloudDocs/cloud.jpg",
        # System / OS directories — a drive-root crawl must not index these.
        "System/Library/CoreServices/art.png",
        "Applications/Some.app/icon.png",
        "usr/share/pixmaps/logo.png",
        "Program Files/App/splash.png",
        "$Recycle.Bin/deleted.jpg",
    ):
        touch(rel)
    return home, real


def test_broad_scan_keeps_real_photos_and_prunes_junk() -> None:
    home, real = _build_home()
    db = WorkspaceDb.__new__(WorkspaceDb)
    files, _failures, _dups = db._expand_photo_import_sources([str(home)], apply_broad_excludes=True)
    got = {pathlib.Path(path).name for path in files}
    assert got == real, f"broad crawl should keep only real photos, got {sorted(got)}"


def test_no_excludes_is_backward_compatible() -> None:
    home, real = _build_home()
    db = WorkspaceDb.__new__(WorkspaceDb)
    files, _failures, _dups = db._expand_photo_import_sources([str(home)])
    assert len(files) > len(real), "default crawl (no broad excludes) must still collect every image"


def test_explicit_excluded_dirs_prunes_subtree() -> None:
    home, _real = _build_home()
    db = WorkspaceDb.__new__(WorkspaceDb)
    files, _failures, _dups = db._expand_photo_import_sources(
        [str(home)], excluded_dirs=[str(home / "Downloads")], apply_broad_excludes=True
    )
    names = {pathlib.Path(path).name for path in files}
    assert "meme.jpeg" not in names, "explicit excluded_dirs must skip the Downloads subtree"


if __name__ == "__main__":
    test_broad_scan_keeps_real_photos_and_prunes_junk()
    test_no_excludes_is_backward_compatible()
    test_explicit_excluded_dirs_prunes_subtree()
    print("all photo_broad_scan_units tests passed")

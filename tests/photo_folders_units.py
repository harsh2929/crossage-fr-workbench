"""Unit tests for the Photos-tab backend.

Covers the two read-only commands that power the "browse photos as folders"
tab and the scan_files manifest queries behind the "All Photos" folder:

  * WorkspaceDb.count_scan_media / list_scan_media — every scanned media file,
    deduped by path, excluding hard errors and deliberately-excluded folders.
  * DesktopApi.list_photo_folder_items — paginated photos for a folder
    (All Photos / a person / an Unknown cluster), deduped by source path.
  * DesktopApi.list_photo_folders — the folder rail (counts + ordering).

Engine-free: candidates are injected directly and previews are requested with
previewBudget=0 so no image files are touched.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_folders_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.models import ReviewCandidate
from crossage_fr.store.workspace_db import WorkspaceDb


def _sig(path: Path, size: int = 10, mtime: int = 1) -> dict:
    return {"pathKey": f"{path}|{size}|{mtime}", "size": size, "mtimeNs": mtime}


def _candidate(cid, person, src, *, status="pending", score=0.9, band="confident") -> ReviewCandidate:
    return ReviewCandidate(
        candidate_id=cid,
        source_path=src,
        person_name=person,
        best_ref_id=None,
        best_ref_path=None,
        score=score,
        band=band,
        quality=0.9,
        model_name="test",
        status=status,
        note="",
    )


# --- Task 1: scan_files manifest (All Photos) -------------------------------

def test_list_scan_media_dedupes_path_and_excludes_error_and_excluded() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        db = WorkspaceDb(base / "workspace.db")
        a, b, c, d = (base / f"{n}.jpg" for n in "abcd")
        db.create_scan_run("run1", "label", "manual", str(base))
        db.create_scan_run("run2", "label", "manual", str(base))
        # The same path `a` recorded in two runs must collapse to a single row.
        db.record_scan_file("run1", a, _sig(a, mtime=1), "completed", phase="processed")
        db.record_scan_file("run2", a, _sig(a, mtime=2), "completed", phase="processed")
        db.record_scan_file("run1", b, _sig(b), "skipped", phase="duplicate")   # real file, kept
        db.record_scan_file("run1", c, _sig(c), "error", phase="error")         # dropped (error)
        db.record_scan_file("run1", d, _sig(d), "skipped", phase="excluded")    # dropped (excluded)
        assert db.count_scan_media() == 2, db.count_scan_media()
        paths = [row["path"] for row in db.list_scan_media(offset=0, limit=50)]
        assert sorted(paths) == sorted([str(a), str(b)]), paths
        # pagination
        first = db.list_scan_media(offset=0, limit=1)
        assert len(first) == 1, first
    print("ok list_scan_media dedupe + error/excluded exclusion + paging")


# --- Task 2: list_photo_folder_items ----------------------------------------

def test_folder_items_person_filter_and_dedupe() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = DesktopApi(Path(tmp) / "workspace")
        confident = float(api.project.config.thresholds.confident)
        api.project.candidates = {
            "c1": _candidate("c1", "Alice", "/p/1.jpg", status="accepted", score=0.99),
            "c2": _candidate("c2", "Alice", "/p/1.jpg", status="pending", score=confident + 0.01),
            "c3": _candidate("c3", "Alice", "/p/2.jpg", status="pending", score=0.0),
            "c4": _candidate("c4", "Bob", "/p/3.jpg", status="accepted", score=0.99),
        }
        page = api.list_photo_folder_items({"folderId": "person:Alice", "previewBudget": 0})
        # c1 (accepted) and c2 (high-confidence) are the SAME photo -> 1 tile;
        # c3 (low-confidence pending) excluded.
        assert page["total"] == 1, page
        assert [it["sourcePath"] for it in page["items"]] == ["/p/1.jpg"], page["items"]
    print("ok folder_items person filter (accepted OR high-confidence) + dedupe")


def test_folder_items_unknown_cluster() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = DesktopApi(Path(tmp) / "workspace")
        api.project.candidates = {
            "u1": _candidate("u1", "Unmatched cluster 1", "/p/9.jpg", score=0.0, band="clustered review"),
            "u2": _candidate("u2", "Unmatched cluster 2", "/p/8.jpg", score=0.0, band="clustered review"),
            "a1": _candidate("a1", "Alice", "/p/1.jpg", status="accepted"),
        }
        page = api.list_photo_folder_items({"folderId": "unknown:Unmatched cluster 1", "previewBudget": 0})
        assert page["total"] == 1, page
        assert page["items"][0]["sourcePath"] == "/p/9.jpg", page["items"]
    print("ok folder_items unknown cluster routing")


def test_folder_items_rejects_unknown_folder_id() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = DesktopApi(Path(tmp) / "workspace")
        try:
            api.list_photo_folder_items({"folderId": "bogus:x"})
        except ValueError:
            print("ok folder_items rejects unknown folder id")
            return
        raise AssertionError("expected ValueError for unknown folder id")


# --- Task 3: list_photo_folders (the rail) ----------------------------------

def test_list_photo_folders_orders_and_counts() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = DesktopApi(Path(tmp) / "workspace")
        confident = float(api.project.config.thresholds.confident)
        api.project.candidates = {
            "a1": _candidate("a1", "Alice", "/p/1.jpg", status="accepted"),
            "a2": _candidate("a2", "Alice", "/p/2.jpg", status="pending", score=confident + 0.01),
            "b1": _candidate("b1", "Bob", "/p/3.jpg", status="accepted"),
            "z1": _candidate("z1", "Zoe", "/p/4.jpg", status="pending", score=0.0),  # 0 qualifying -> hidden
            "u1": _candidate("u1", "Unmatched cluster 1", "/p/9.jpg", score=0.0, band="clustered review"),
        }
        out = api.list_photo_folders({})
        folders = out["folders"]
        assert folders[0]["id"] == "all" and folders[0]["kind"] == "all", folders[0]
        people = [f for f in folders if f["kind"] == "person"]
        assert [f["name"] for f in people] == ["Alice", "Bob"], people  # Zoe hidden; Alice(2) before Bob(1)
        assert people[0]["count"] == 2, people[0]
        assert any(f["kind"] == "unknown" and f["name"] == "Unmatched cluster 1" for f in folders), folders
    print("ok list_photo_folders ordering + counts + hide-empty")


if __name__ == "__main__":
    test_list_scan_media_dedupes_path_and_excludes_error_and_excluded()
    test_folder_items_person_filter_and_dedupe()
    test_folder_items_unknown_cluster()
    test_folder_items_rejects_unknown_folder_id()
    test_list_photo_folders_orders_and_counts()
    print("all photo_folders_units tests passed")

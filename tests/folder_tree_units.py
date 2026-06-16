"""Unit tests for subfolder include/exclude + recurse-toggle folder scanning.

Covers the new `folder_tree` command and the `recursive` / `excluded_dirs`
parameters threaded into the scan walk (`_iter_media_paths`), the enroll walk
(`iter_image_paths`), and the analyze preview (`analyze_folder`).

These exercise filesystem enumeration only (counts by extension), so no model
engine is needed. Empty files with media extensions are sufficient.

Run: PYTHONPATH=. .venv/bin/python tests/folder_tree_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from crossage_fr.api_server import DesktopApi
from crossage_fr.enroll import ProjectState
from crossage_fr.ingest.image_io import iter_image_paths
from crossage_fr.storage import safe_resolve


def _touch(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")


def build_media_tree(base: Path) -> Path:
    """A folder with nested media plus two config-excluded dirs (.git, node_modules)."""
    root = base / "media"
    _touch(root / "a.jpg")
    _touch(root / "b.png")
    _touch(root / "vid.mp4")
    _touch(root / "notes.txt")          # non-media
    _touch(root / "sub1" / "c.jpg")
    _touch(root / "sub1" / "deep" / "d.jpg")
    _touch(root / "sub2" / "e.jpg")
    _touch(root / "sub2" / "f.jpg")
    _touch(root / ".git" / "junk.jpg")            # config-excluded dir name
    _touch(root / "node_modules" / "pkg.jpg")     # config-excluded dir name
    return root


def _media_paths(project: ProjectState, folder: Path, **kwargs) -> list[Path]:
    return [p for p in project._iter_media_paths(folder, **kwargs) if isinstance(p, Path)]


def _names(paths) -> set[str]:
    return {Path(p).name for p in paths}


# --- folder_tree command -----------------------------------------------------

def test_folder_tree_counts_and_nesting() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        api = DesktopApi(base / "workspace")
        tree = api.folder_tree(root)
        node = tree["root"]

        assert node["imageCount"] == 2, node["imageCount"]      # a.jpg, b.png (direct)
        assert node["videoCount"] == 1, node["videoCount"]      # vid.mp4 (direct)
        assert node["totalImages"] == 6, node["totalImages"]    # a,b,c,d,e,f
        assert node["totalVideos"] == 1, node["totalVideos"]

        child_names = {c["name"] for c in node["children"]}
        assert child_names == {"sub1", "sub2"}, child_names      # .git / node_modules excluded

        sub1 = next(c for c in node["children"] if c["name"] == "sub1")
        assert sub1["imageCount"] == 1, sub1["imageCount"]       # c.jpg direct
        assert sub1["totalImages"] == 2, sub1["totalImages"]     # c.jpg + deep/d.jpg
        deep = next(c for c in sub1["children"] if c["name"] == "deep")
        assert deep["totalImages"] == 1, deep["totalImages"]

        assert tree["truncated"] is False
    print("ok folder_tree counts + nesting")


def test_cmd_folder_tree_dispatch() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        api = DesktopApi(base / "workspace")
        out = api.handle("folder_tree", {"folder": str(root)})
        assert "root" in out and out["root"]["name"] == "media", out
    print("ok folder_tree dispatch")


# --- scan walk: _iter_media_paths -------------------------------------------

def test_iter_media_recursive_false_top_level_only() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        project = ProjectState(base / "workspace")
        names = _names(_media_paths(project, root, recursive=False))
        assert names == {"a.jpg", "b.png", "vid.mp4"}, names
    print("ok _iter_media_paths recursive=False")


def test_iter_media_excluded_dirs_prunes_subtree() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        project = ProjectState(base / "workspace")
        excluded = {safe_resolve(root / "sub2")}
        names = _names(_media_paths(project, root, recursive=True, excluded_dirs=excluded))
        assert "e.jpg" not in names and "f.jpg" not in names, names
        assert {"a.jpg", "b.png", "vid.mp4", "c.jpg", "d.jpg"} <= names, names
    print("ok _iter_media_paths excluded_dirs")


# --- analyze preview ---------------------------------------------------------

def test_analyze_recursive_false() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        api = DesktopApi(base / "workspace")
        result = api.analyze_folder(root, recursive=False)
        assert result["imageCount"] == 2, result["imageCount"]
        assert result["videoCount"] == 1, result["videoCount"]
    print("ok analyze_folder recursive=False")


def test_analyze_excluded_dirs() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        api = DesktopApi(base / "workspace")
        excluded = {safe_resolve(root / "sub1")}
        result = api.analyze_folder(root, excluded_dirs=excluded)
        assert result["imageCount"] == 4, result["imageCount"]   # a,b,e,f (c,d excluded)
    print("ok analyze_folder excluded_dirs")


def test_analyze_rejects_excluded_dir_outside_folder() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        outside = base / "elsewhere"
        outside.mkdir(parents=True, exist_ok=True)
        api = DesktopApi(base / "workspace")
        raised = False
        try:
            api.handle("analyze_folder", {"folder": str(root), "excludedDirs": [str(outside)]})
        except ValueError:
            raised = True
        assert raised, "excludedDirs outside the chosen folder must be rejected"
    print("ok analyze_folder rejects out-of-folder excludedDirs")


# --- enroll walk: iter_image_paths ------------------------------------------

def test_iter_image_paths_default_unchanged() -> None:
    # Default behavior (no exclusion hook) must stay identical for benchmarks:
    # images only, recursive, config-excluded dirs still descended into.
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        names = _names(iter_image_paths(root))
        assert "vid.mp4" not in names, "iter_image_paths is images-only"
        assert {"junk.jpg", "pkg.jpg"} <= names, "default ignores config exclusions"
        assert names == {"a.jpg", "b.png", "c.jpg", "d.jpg", "e.jpg", "f.jpg", "junk.jpg", "pkg.jpg"}, names
    print("ok iter_image_paths default unchanged")


def test_iter_image_paths_honors_exclusion_hook() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        project = ProjectState(base / "workspace")
        names = _names(iter_image_paths(root, exclusion_reason=project.scan_exclusion_reason))
        assert "junk.jpg" not in names and "pkg.jpg" not in names, names
        assert names == {"a.jpg", "b.png", "c.jpg", "d.jpg", "e.jpg", "f.jpg"}, names
    print("ok iter_image_paths exclusion hook")


def test_iter_image_paths_recursive_false() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        names = _names(iter_image_paths(root, recursive=False))
        assert names == {"a.jpg", "b.png"}, names
    print("ok iter_image_paths recursive=False")


def test_iter_image_paths_excluded_dirs() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        root = build_media_tree(base)
        excluded = {safe_resolve(root / "sub1")}
        names = _names(iter_image_paths(root, excluded_dirs=excluded))
        assert "c.jpg" not in names and "d.jpg" not in names, names
        assert {"a.jpg", "b.png", "e.jpg", "f.jpg"} <= names, names
    print("ok iter_image_paths excluded_dirs")


def main() -> None:
    test_folder_tree_counts_and_nesting()
    test_cmd_folder_tree_dispatch()
    test_iter_media_recursive_false_top_level_only()
    test_iter_media_excluded_dirs_prunes_subtree()
    test_analyze_recursive_false()
    test_analyze_excluded_dirs()
    test_analyze_rejects_excluded_dir_outside_folder()
    test_iter_image_paths_default_unchanged()
    test_iter_image_paths_honors_exclusion_hook()
    test_iter_image_paths_recursive_false()
    test_iter_image_paths_excluded_dirs()
    print("\nall folder_tree unit tests passed")


if __name__ == "__main__":
    main()

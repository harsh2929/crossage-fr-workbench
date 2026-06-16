"""Unit tests for `enroll_paths` — enrolling reference faces from a list of
individual files and/or folders (the redesigned 'Add a person' flow).

The new logic is path expansion (classify file vs dir, expand dirs, drop
non-images, de-duplicate). That is tested engine-free via the pure helper
`ProjectState._expand_enroll_paths`. One end-to-end test exercises the
`enroll_paths` command through the fallback embedding engine.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/enroll_paths_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.enroll import ProjectState
from crossage_fr.storage import safe_resolve


def make_face(path: Path, shirt=(74, 88, 138)) -> None:
    image = Image.new("RGB", (280, 280), (182, 152, 116))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
    draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
    draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
    draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
    draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
    draw.rectangle((116, 168, 164, 246), fill=shirt)
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, quality=95)


def _img(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (8, 8), (10, 20, 30)).save(path)


def _names(paths) -> list[str]:
    return [Path(p).name for p in paths]


# --- pure expansion helper (engine-free) ------------------------------------

def test_expand_files_and_dir() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "a.jpg")
        _img(base / "folder" / "b.jpg")
        _img(base / "folder" / "deep" / "c.jpg")
        project = ProjectState(base / "workspace")
        out = project._expand_enroll_paths([str(base / "a.jpg"), str(base / "folder")])
        assert set(_names(out)) == {"a.jpg", "b.jpg", "c.jpg"}, _names(out)
    print("ok expand files + dir")


def test_expand_drops_non_image_files() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "a.jpg")
        (base / "notes.txt").write_text("x")
        project = ProjectState(base / "workspace")
        out = project._expand_enroll_paths([str(base / "a.jpg"), str(base / "notes.txt")])
        assert _names(out) == ["a.jpg"], _names(out)
    print("ok expand drops non-image files")


def test_expand_dedupes() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "a.jpg")
        project = ProjectState(base / "workspace")
        # same file listed directly AND via its folder -> appears once
        out = project._expand_enroll_paths([str(base / "a.jpg"), str(base)])
        assert _names(out) == ["a.jpg"], _names(out)
    print("ok expand dedupes")


def test_expand_recursive_false_dir_top_level_only() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "top.jpg")
        _img(base / "nested" / "deep.jpg")
        project = ProjectState(base / "workspace")
        out = project._expand_enroll_paths([str(base)], recursive=False)
        assert _names(out) == ["top.jpg"], _names(out)
    print("ok expand recursive=False")


def test_expand_dir_skips_config_excluded() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "keep.jpg")
        _img(base / ".git" / "junk.jpg")
        _img(base / "node_modules" / "pkg.jpg")
        project = ProjectState(base / "workspace")
        out = project._expand_enroll_paths([str(base)])
        assert _names(out) == ["keep.jpg"], _names(out)
    print("ok expand skips config-excluded dirs")


def test_expand_picked_file_resolves_paths() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        _img(base / "a.jpg")
        project = ProjectState(base / "workspace")
        out = project._expand_enroll_paths([str(base / "a.jpg")])
        assert len(out) == 1 and safe_resolve(out[0]) == safe_resolve(base / "a.jpg")
    print("ok expand resolves picked file")


# --- enroll_paths command end-to-end (fallback engine) ----------------------

def test_enroll_paths_command_files_and_folder() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        make_face(base / "a.jpg", shirt=(74, 88, 138))
        make_face(base / "people" / "b.jpg", shirt=(150, 70, 90))  # distinct bytes → distinct hash
        (base / "people" / "notes.txt").write_text("x")
        api = DesktopApi(base / "workspace")
        api.handle("set_consent", {"value": True})
        out = api.handle("enroll_paths", {
            "personName": "Dana",
            "ageBucket": "adult",
            "paths": [str(base / "a.jpg"), str(base / "people")],
        })
        assert out["added"] == 2, out["added"]
        refs = list(api.project.references.values())
        assert len(refs) == 2
        assert all(r.person_name == "Dana" and r.age_bucket == "adult" for r in refs)
    print("ok enroll_paths command files + folder")


def test_enroll_paths_requires_person_name() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        make_face(base / "a.jpg")
        api = DesktopApi(base / "workspace")
        api.handle("set_consent", {"value": True})
        raised = False
        try:
            api.handle("enroll_paths", {"personName": "  ", "ageBucket": "adult", "paths": [str(base / "a.jpg")]})
        except ValueError:
            raised = True
        assert raised, "empty person name must raise"
    print("ok enroll_paths requires person name")


def test_enroll_paths_dedup_across_calls() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        make_face(base / "a.jpg")
        api = DesktopApi(base / "workspace")
        api.handle("set_consent", {"value": True})
        first = api.handle("enroll_paths", {"personName": "P", "ageBucket": "adult", "paths": [str(base / "a.jpg")]})
        second = api.handle("enroll_paths", {"personName": "P", "ageBucket": "adult", "paths": [str(base / "a.jpg")]})
        assert first["added"] == 1 and second["added"] == 0, (first["added"], second["added"])
    print("ok enroll_paths dedup across calls")


def main() -> None:
    test_expand_files_and_dir()
    test_expand_drops_non_image_files()
    test_expand_dedupes()
    test_expand_recursive_false_dir_top_level_only()
    test_expand_dir_skips_config_excluded()
    test_expand_picked_file_resolves_paths()
    test_enroll_paths_command_files_and_folder()
    test_enroll_paths_requires_person_name()
    test_enroll_paths_dedup_across_calls()
    print("\nall enroll_paths unit tests passed")


if __name__ == "__main__":
    main()

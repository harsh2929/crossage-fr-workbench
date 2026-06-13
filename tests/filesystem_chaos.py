from __future__ import annotations

import os
import stat
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi


def make_face(path: Path, shirt: tuple[int, int, int] = (74, 88, 138)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (280, 280), (182, 152, 116))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 280, 52), fill=(34, 74, 132))
    draw.ellipse((82, 56, 198, 180), fill=(232, 198, 168))
    draw.ellipse((112, 98, 126, 112), fill=(35, 35, 42))
    draw.ellipse((154, 98, 168, 112), fill=(35, 35, 42))
    draw.arc((112, 114, 168, 156), 10, 170, fill=(120, 55, 55), width=4)
    draw.rectangle((116, 168, 164, 246), fill=shirt)
    image.save(path, quality=95)


def assert_filesystem_chaos_scan() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="vintrace-fs-chaos-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    denied = scan / "permission-denied"
    symlink_created = False
    denied_created = False
    api = DesktopApi(workspace)
    try:
        make_face(refs / "person.jpg")
        api.handle("set_consent", {"value": True, "note": "filesystem chaos suite"})
        enrolled = api.handle("enroll", {"folder": str(refs), "personName": "Chaos Person"})
        assert enrolled["added"] == 1

        make_face(scan / "normal.jpg")
        make_face(scan / "nested folder" / "level-1" / "portrait.jpg", (92, 116, 88))
        make_face(scan / "unicode-किरण" / "portrait 😀.jpg", (88, 98, 146))
        make_face(scan / "UPPERCASE.JPG", (120, 90, 120))
        (scan / "broken.webp").write_bytes(b"not actually webp")
        ignored = scan / "ignored.txt"
        ignored.write_text("not media", encoding="utf-8")

        if hasattr(os, "symlink"):
            try:
                os.symlink(scan, scan / "loop-to-scan", target_is_directory=True)
                symlink_created = True
            except OSError:
                symlink_created = False

        if os.name == "posix":
            denied.mkdir(parents=True, exist_ok=True)
            make_face(denied / "hidden.jpg", (120, 120, 78))
            try:
                denied.chmod(0)
                denied_created = True
            except OSError:
                denied_created = False

        analysis = api.handle("analyze_folder", {"folder": str(scan), "maxEntries": 200, "timeBudgetMs": 3000})
        assert analysis["folder"] == str(scan.resolve())
        assert analysis["imageCount"] >= 5

        result = api.handle("scan", {"folder": str(scan), "source": "filesystem-chaos", "resume": False})
        metrics = result["metrics"]
        assert metrics["processed"] >= 5
        assert metrics["errors"] >= 1
        assert metrics["pathErrors"] >= (1 if symlink_created else 0)
        assert "state" in result and result["state"]["counts"]["candidates"] >= 1
    finally:
        if denied_created:
            try:
                denied.chmod(stat.S_IRWXU)
            except OSError:
                pass


if __name__ == "__main__":
    assert_filesystem_chaos_scan()
    print("filesystem chaos suite passed")

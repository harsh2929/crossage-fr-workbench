from __future__ import annotations

import hashlib
import json
import os
import tempfile
import zipfile
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


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def assert_backup_restore_roundtrip() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="vintrace-backup-roundtrip-"))
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    workspace = root / "workspace"
    refs = root / "refs"
    scan = root / "scan"
    api = DesktopApi(workspace)

    make_face(refs / "person.jpg")
    make_face(scan / "candidate.jpg", (92, 116, 88))
    api.handle("set_consent", {"value": True, "note": "backup roundtrip"})
    assert api.handle("enroll", {"folder": str(refs), "personName": "Roundtrip Person"})["added"] == 1
    scan_result = api.handle("scan", {"folder": str(scan), "source": "backup-roundtrip", "resume": False})
    assert scan_result["state"]["counts"]["candidates"] >= 1
    candidate_id = next(iter(api.project.candidates))
    api.handle("set_candidate_note", {"candidateId": candidate_id, "note": "roundtrip note"})

    backup = api.handle("export_workspace_backup", {"includeGenerated": False})["value"]
    backup_path = Path(backup["zipPath"])
    verified = api.handle("verify_workspace_backup", {"path": str(backup_path)})["value"]
    assert verified["ok"] is True
    assert verified["manifest"]["counts"]["references"] == 1

    before_hashes = {
        name: digest(workspace / name)
        for name in ("config.json", "references.json", "review_candidates.json")
    }
    target = root / "restored"
    restored = api.handle("restore_workspace_backup", {"path": str(backup_path), "target": str(target)})["value"]
    assert restored["ok"] is True
    assert restored["fileCount"] == backup["fileCount"]
    assert restored["stateSummary"]["references"] == 1
    assert restored["stateSummary"]["candidates"] >= 1
    assert json.loads((target / "backup-manifest.json").read_text(encoding="utf-8"))["counts"]["references"] == 1

    after_hashes = {
        name: digest(target / name)
        for name in ("config.json", "references.json", "review_candidates.json")
    }
    assert before_hashes == after_hashes
    restored_api = DesktopApi(target)
    restored_state = restored_api.state()
    assert restored_state["counts"]["references"] == api.state()["counts"]["references"]
    assert restored_state["counts"]["candidates"] == api.state()["counts"]["candidates"]
    assert any(candidate.note == "roundtrip note" for candidate in restored_api.project.candidates.values())

    nonempty = root / "nonempty"
    nonempty.mkdir()
    (nonempty / "existing.txt").write_text("existing", encoding="utf-8")
    try:
        api.project.restore_workspace_backup(backup_path, nonempty)
    except ValueError as exc:
        assert "empty" in str(exc)
    else:
        raise AssertionError("Non-empty restore target should be rejected.")

    malicious = root / "malicious.zip"
    with zipfile.ZipFile(malicious, "w") as archive:
        archive.writestr("backup-manifest.json", json.dumps({"counts": {"references": 0, "candidates": 0}}))
        archive.writestr("config.json", "{}")
        archive.writestr("references.json", "[]")
        archive.writestr("review_candidates.json", "[]")
        archive.writestr("../escape.txt", "blocked")
    try:
        api.project.restore_workspace_backup(malicious, root / "malicious-target")
    except ValueError as exc:
        assert "unsafe" in str(exc).lower()
    else:
        raise AssertionError("Unsafe backup entry should be rejected.")
    assert not (root / "escape.txt").exists()


if __name__ == "__main__":
    assert_backup_restore_roundtrip()
    print("workspace backup roundtrip passed")

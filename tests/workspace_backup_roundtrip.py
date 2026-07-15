from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

from crossage_fr.api_server import DesktopApi
from crossage_fr.match.age_trajectory import (
    AGE_TRAJECTORY_REFERENCE_KIND,
    IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
)
from crossage_fr.match.scoring import valid_reference
from crossage_fr.models import ReferenceFace


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
    registry = str(root / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
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
    api.project.db.upsert_learned_artifact(
        "learn_backup_suggested_ref",
        {
            "artifactType": "suggested_reference",
            "status": "staged",
            "modelName": "local-image-fingerprint",
            "versionKey": "suggested-reference-v1",
            "trainingDataHash": "backup-roundtrip-training-hash",
            "inputCount": 1,
            "positiveCount": 1,
            "metrics": {"quality": 0.84, "bestReferenceCosine": 0.72},
            "payload": {
                "candidateId": candidate_id,
                "personName": "Roundtrip Person",
                "sourceHash": "backup-roundtrip-source-hash",
                "modelName": "local-image-fingerprint",
            },
        },
    )
    api.project.db.save_photo_relationship_name_review(
        suggestion_id="relationship_name_backup_roundtrip",
        source_cluster="Unmatched cluster backup-roundtrip",
        target_person="Roundtrip Person",
        evidence_hash="a" * 64,
        decision="dismissed",
        result={"score": 0.72},
    )

    backup = api.handle("export_workspace_backup", {"includeGenerated": False})["value"]
    backup_path = Path(backup["zipPath"])
    verified = api.handle("verify_workspace_backup", {"path": str(backup_path)})["value"]
    assert verified["ok"] is True
    assert verified["manifest"]["counts"]["references"] == 1
    assert verified["manifest"]["photos"]["counts"]["relationshipNameReviews"] == 1
    assert verified["databaseIntegrity"]["checked"] is True
    assert verified["databaseIntegrity"]["ok"] is True

    with zipfile.ZipFile(backup_path) as archive:
        names = set(archive.namelist())
        assert "workspace.sqlite3" in names
        assert "workspace.sqlite3-wal" not in names
        assert "workspace.sqlite3-shm" not in names
        with tempfile.TemporaryDirectory(prefix="vintrace-backup-snapshot-test-") as tmp:
            snapshot_path = Path(tmp) / "workspace.sqlite3"
            snapshot_path.write_bytes(archive.read("workspace.sqlite3"))
            conn = sqlite3.connect(str(snapshot_path))
            try:
                integrity_rows = conn.execute("PRAGMA integrity_check").fetchall()
                assert [str(row[0]) for row in integrity_rows] == ["ok"]
                assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
                table_rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
                tables = {str(row[0]) for row in table_rows}
                assert {"scan_runs", "photo_assets", "review_candidates"} <= tables
                assert conn.execute("SELECT COUNT(*) FROM photo_relationship_name_reviews").fetchone()[0] == 1
            finally:
                conn.close()

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
    restored_candidates = restored_api.handle("query_candidates", {"query": "Roundtrip Person", "limit": 10})
    assert any(candidate["note"] == "roundtrip note" for candidate in restored_candidates["items"])
    restored_artifact = restored_api.project.db.learned_artifact_by_id("learn_backup_suggested_ref")
    assert restored_artifact is not None
    assert restored_artifact["artifact_type"] == "suggested_reference"
    assert restored_artifact["artifact_hash"]
    assert restored_artifact["payload"]["candidateId"] == candidate_id
    restored_review = restored_api.project.db.photo_relationship_name_review("relationship_name_backup_roundtrip")
    assert restored_review is not None
    assert restored_review["decision"] == "dismissed"
    assert restored_review["targetPerson"] == "Roundtrip Person"

    nonempty = root / "nonempty"
    nonempty.mkdir()
    (nonempty / "existing.txt").write_text("existing", encoding="utf-8")
    try:
        api.project.restore_workspace_backup(backup_path, nonempty)
    except ValueError as exc:
        assert "empty" in str(exc)
    else:
        raise AssertionError("Non-empty restore target should be rejected.")

    corrupt_db = root / "corrupt-db.zip"
    with zipfile.ZipFile(corrupt_db, "w") as archive:
        manifest = json.dumps({"counts": {"references": 0, "candidates": 0}})
        archive.writestr("backup-manifest.json", manifest)
        archive.writestr("config.json", "{}")
        archive.writestr("references.json", "[]")
        archive.writestr("workspace.sqlite3", b"not a sqlite database")
    corrupt_verified = api.handle("verify_workspace_backup", {"path": str(corrupt_db)})["value"]
    assert corrupt_verified["ok"] is False
    assert "workspace.sqlite3" in corrupt_verified["invalidCoreFiles"]
    assert corrupt_verified["databaseIntegrity"]["checked"] is True
    assert corrupt_verified["databaseIntegrity"]["ok"] is False
    try:
        api.project.restore_workspace_backup(corrupt_db, root / "corrupt-db-target")
    except ValueError as exc:
        assert "workspace.sqlite3" in str(exc)
    else:
        raise AssertionError("Corrupt backup database should be rejected.")

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


def assert_encrypted_backup_roundtrip() -> None:
    # PC-03: with VINTRACE_BACKUP_PASSPHRASE set, the backup is encrypted at rest
    # and verify/restore transparently decrypt; without the passphrase, verify is
    # refused. Full project (refs + a scanned candidate) so core files are present.
    from crossage_fr.crypto import is_encrypted

    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    os.environ["VINTRACE_BACKUP_PASSPHRASE"] = "roundtrip-secret-passphrase"
    root = Path(tempfile.mkdtemp(prefix="vintrace-backup-enc-"))
    registry = str(root / "registry")
    os.environ["VINTRACE_REGISTRY_HOME"] = registry
    os.environ["CROSSAGE_REGISTRY_HOME"] = registry
    try:
        api = DesktopApi(root / "workspace")
        make_face(root / "refs" / "person.jpg")
        make_face(root / "scan" / "candidate.jpg", (92, 116, 88))
        api.handle("set_consent", {"value": True, "note": "enc backup"})
        assert api.handle("enroll", {"folder": str(root / "refs"), "personName": "Enc Person"})["added"] == 1
        api.handle("scan", {"folder": str(root / "scan"), "source": "enc-roundtrip", "resume": False})

        backup = api.handle("export_workspace_backup", {"includeGenerated": False})["value"]
        assert backup["encrypted"] is True, "backup should be encrypted when passphrase is set"
        backup_path = Path(backup["zipPath"])
        assert is_encrypted(backup_path.read_bytes()[:16]), "backup file must carry the encryption header"
        assert not zipfile.is_zipfile(backup_path), "encrypted backup path must not be a plaintext zip"
        assert not list(backup_path.parent.glob(f".{backup_path.name}.*.tmp")), "backup temp files should be removed"

        verified = api.handle("verify_workspace_backup", {"path": str(backup_path)})["value"]
        assert verified["ok"] is True, f"encrypted verify should succeed with passphrase: {verified.get('error')}"

        # Without the passphrase, verify must refuse (not silently treat as corrupt).
        del os.environ["VINTRACE_BACKUP_PASSPHRASE"]
        refused = api.handle("verify_workspace_backup", {"path": str(backup_path)})["value"]
        assert refused["ok"] is False and "encrypted" in refused["error"].lower()

        # Restore works once the passphrase is back.
        os.environ["VINTRACE_BACKUP_PASSPHRASE"] = "roundtrip-secret-passphrase"
        restored = api.handle("restore_workspace_backup", {"path": str(backup_path), "target": str(root / "restored")})["value"]
        assert restored["ok"] is True and restored["stateSummary"]["references"] == 1
    finally:
        os.environ.pop("VINTRACE_BACKUP_PASSPHRASE", None)


def assert_synthetic_age_image_backup_policy() -> None:
    os.environ["CROSSAGE_FORCE_FALLBACK"] = "1"
    root = Path(tempfile.mkdtemp(prefix="vintrace-backup-age-image-"))
    os.environ["VINTRACE_REGISTRY_HOME"] = str(root / "registry")
    os.environ["CROSSAGE_REGISTRY_HOME"] = str(root / "registry")
    api = DesktopApi(root / "workspace")
    project = api.project

    parent_path = root / "source" / "parent.jpg"
    make_face(parent_path)
    parent = ReferenceFace(
        ref_id="ref_backup_parent",
        person_name="Backup Person",
        age_bucket="adult",
        source_path=str(parent_path),
        capture_date=None,
        quality=0.9,
        model_name="backup-fixture",
        vector=[1.0, *([0.0] * 511)],
        source_hash=digest(parent_path),
    )
    generated_path = project.synthetic_age_images_path / "reviewed-senior.png"
    make_face(generated_path, (112, 112, 112))
    generated_hash = digest(generated_path)
    artifact_id = "syn_age_img_backup_roundtrip"
    stored_path = project._synthetic_age_image_storage_key(generated_path)
    artifact_result = project.db.upsert_learned_artifact(
        artifact_id,
        {
            "artifactType": "synthetic_age_image_review",
            "status": "promoted",
            "modelName": "Qwen/Qwen-Image-Edit-2511",
            "versionKey": IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
            "trainingDataHash": parent.source_hash,
            "inputCount": 1,
            "positiveCount": 1,
            "metrics": {"quality": 0.88},
            "payload": {
                "personName": parent.person_name,
                "parentRefId": parent.ref_id,
                "parentSourceHash": parent.source_hash,
                "generatedPath": stored_path,
                "generatedHash": generated_hash,
                "targetAgeBucket": "senior",
            },
        },
    )
    generated_ref = ReferenceFace(
        ref_id="ref_backup_age_image",
        person_name=parent.person_name,
        age_bucket="senior",
        source_path=str(generated_path),
        capture_date=None,
        quality=0.66,
        model_name=parent.model_name,
        vector=list(parent.vector),
        source_hash=generated_hash,
        capture_date_provenance=AGE_TRAJECTORY_REFERENCE_KIND,
        reference_kind=AGE_TRAJECTORY_REFERENCE_KIND,
        synthetic_method_version=IMAGE_AGE_AUGMENTATION_METHOD_VERSION,
        synthetic_target_age_bucket="senior",
        parent_ref_ids=[parent.ref_id],
        derivation_provenance={
            "kind": "reviewed-ai-generated-age-image",
            "reviewArtifactId": artifact_id,
            "reviewArtifactHash": artifact_result["artifactHash"],
            "generatedImage": True,
            "aiGenerated": True,
            "authenticCapture": False,
            "humanReviewed": True,
            "parentSourceHash": parent.source_hash,
            "outputHash": generated_hash,
        },
    )
    assert valid_reference(parent) and valid_reference(generated_ref)
    project.references = {parent.ref_id: parent, generated_ref.ref_id: generated_ref}
    project.vector_store.rebuild({ref_id: ref.vector for ref_id, ref in project.references.items()})
    project._mark_references_dirty(project.references)
    project.save()

    full_backup = project.export_workspace_backup(root / "full-backups", include_generated=True)
    with zipfile.ZipFile(full_backup["zipPath"]) as archive:
        assert stored_path in set(archive.namelist())
    full_target = root / "restored-full"
    project.restore_workspace_backup(Path(full_backup["zipPath"]), full_target)
    full_api = DesktopApi(full_target)
    full_artifact = full_api.project.db.learned_artifact_by_id(artifact_id)
    full_ref = full_api.project.references[generated_ref.ref_id]
    assert full_artifact and full_artifact["status"] == "promoted"
    assert Path(full_ref.source_path).parent == full_api.project.synthetic_age_images_path
    assert digest(Path(full_ref.source_path)) == generated_hash
    assert full_api.project._synthetic_age_startup_result["rehomedReferences"] == 1

    metadata_backup = project.export_workspace_backup(root / "metadata-backups", include_generated=False)
    with zipfile.ZipFile(metadata_backup["zipPath"]) as archive:
        assert not any(name.startswith("synthetic-age-images/") for name in archive.namelist())
    metadata_target = root / "restored-metadata"
    project.restore_workspace_backup(Path(metadata_backup["zipPath"]), metadata_target)
    metadata_api = DesktopApi(metadata_target)
    metadata_artifact = metadata_api.project.db.learned_artifact_by_id(artifact_id)
    assert metadata_artifact and metadata_artifact["status"] == "rolled_back"
    assert generated_ref.ref_id not in metadata_api.project.references
    assert parent.ref_id in metadata_api.project.references
    assert metadata_api.project._synthetic_age_startup_result["removedReferences"] == 1
    assert generated_path.is_file()


if __name__ == "__main__":
    assert_backup_restore_roundtrip()
    assert_encrypted_backup_roundtrip()
    assert_synthetic_age_image_backup_policy()
    print("workspace backup roundtrip passed")

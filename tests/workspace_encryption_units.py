from __future__ import annotations

from contextlib import contextmanager
import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3 as plaintext_sqlite
import tempfile
from unittest import mock
import zipfile

from crossage_fr.enroll.manager import AUDIT_ENCRYPTED_PREFIX, AUDIT_ENCRYPTION_ROLE, ProjectState
from crossage_fr.store.workspace_db import SQLCIPHER_AVAILABLE, WorkspaceDb
from crossage_fr.store.workspace_encryption import (
    FILE_MAGIC,
    WORKSPACE_DB_KEY_ENV,
    WORKSPACE_DB_PREVIOUS_KEY_ENV,
    WORKSPACE_DB_RECOVERY_PASSPHRASE_ENV,
    WORKSPACE_DB_REQUIRED_ENV,
    WorkspaceEncryption,
    WorkspaceEncryptionError,
    encode_workspace_key,
    workspace_key_id,
)


ENV_NAMES = (
    WORKSPACE_DB_KEY_ENV,
    WORKSPACE_DB_PREVIOUS_KEY_ENV,
    WORKSPACE_DB_RECOVERY_PASSPHRASE_ENV,
    WORKSPACE_DB_REQUIRED_ENV,
    "VINTRACE_REGISTRY_HOME",
    "CROSSAGE_REGISTRY_HOME",
    "VINTRACE_BACKUP_PASSPHRASE",
)


@contextmanager
def encryption_environment(root: Path, key: bytes | None, previous: bytes | None = None, *, required: bool = True):
    saved = {name: os.environ.get(name) for name in ENV_NAMES}
    try:
        registry = root / "registry"
        os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
        os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
        os.environ.pop(WORKSPACE_DB_RECOVERY_PASSPHRASE_ENV, None)
        os.environ.pop("VINTRACE_BACKUP_PASSPHRASE", None)
        if key is None:
            os.environ.pop(WORKSPACE_DB_KEY_ENV, None)
        else:
            os.environ[WORKSPACE_DB_KEY_ENV] = encode_workspace_key(key)
        if previous is None:
            os.environ.pop(WORKSPACE_DB_PREVIOUS_KEY_ENV, None)
        else:
            os.environ[WORKSPACE_DB_PREVIOUS_KEY_ENV] = encode_workspace_key(previous)
        os.environ[WORKSPACE_DB_REQUIRED_ENV] = "1" if required else "0"
        yield
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def create_plaintext_database(path: Path, marker: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = plaintext_sqlite.connect(path)
    try:
        connection.execute("CREATE TABLE biometric_probe (value TEXT NOT NULL)")
        connection.execute("INSERT INTO biometric_probe(value) VALUES (?)", (marker,))
        connection.commit()
    finally:
        connection.close()


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def assert_plain_sqlite_denied(path: Path) -> None:
    connection = plaintext_sqlite.connect(path)
    try:
        try:
            connection.execute("SELECT name FROM sqlite_master").fetchall()
        except plaintext_sqlite.DatabaseError:
            return
    finally:
        connection.close()
    raise AssertionError(f"stdlib sqlite unexpectedly read encrypted database {path}")


def assert_raises(error_type, callback, contains: str = "") -> Exception:
    try:
        callback()
    except error_type as exc:
        if contains:
            assert contains.casefold() in str(exc).casefold(), str(exc)
        return exc
    raise AssertionError(f"Expected {error_type.__name__}")


def assert_plaintext_migration_and_fail_closed(root: Path) -> tuple[Path, bytes]:
    workspace = root / "migrated-workspace"
    database = workspace / "workspace.sqlite3"
    marker = "VINTRACE_BIOMETRIC_DB_MARKER_7d4a4f66"
    reference_marker = "VINTRACE_REFERENCE_VECTOR_MARKER_4f90d274"
    candidate_marker = "VINTRACE_REVIEW_QUEUE_MARKER_58c00ef1"
    consent_marker = "VINTRACE_CONSENT_MARKER_02a7184e"
    audit_marker = "VINTRACE_AUDIT_MARKER_817ec462"
    create_plaintext_database(database, marker)
    (workspace / "references.json").write_text(json.dumps([{"secret": reference_marker}]), encoding="utf-8")
    (workspace / "review_candidates.json").write_text(json.dumps([{"secret": candidate_marker}]), encoding="utf-8")
    (workspace / "consent.json").write_text(json.dumps({"active": True, "note": consent_marker}), encoding="utf-8")
    (workspace / "audit_log.jsonl").write_text(
        json.dumps({"at": "2026-07-13T00:00:00Z", "action": "legacy-test", "detail": audit_marker}) + "\n",
        encoding="utf-8",
    )
    (workspace / "reference-vectors.npz").write_bytes(b"plaintext-vector-index " + reference_marker.encode())
    (workspace / "reference-vectors.npz.faiss").write_bytes(b"plaintext-faiss-index " + reference_marker.encode())

    key = os.urandom(32)
    with encryption_environment(root, key):
        project = ProjectState(workspace)
        status = project.workspace_encryption_status()
        assert status["enabled"] is True
        assert status["migrationComplete"] is True
        assert status["database"]["encryptedHeader"] is True
        assert status["database"]["plaintextHeader"] is False
        assert str(status["database"]["cipherVersion"]).startswith("4.")
        privacy = project.privacy_report()
        assert privacy["dataAtRest"]["encrypted"] is True
        assert privacy["dataAtRest"]["migrationComplete"] is True
        assert privacy["dataAtRest"]["keyId"] == workspace_key_id(key)
        assert str(privacy["dataAtRest"]["cipherVersion"]).startswith("4.")
        assert "SQLCipher" in privacy["dataAtRest"]["biometricStorage"]
        assert "ordinary media files" in privacy["dataAtRest"]["generatedMedia"]
        assert not any("files at rest are not encrypted by Vintrace" in item for item in privacy["recommendations"])
        assert status["database"]["temporaryStorage"] == "memory"
        assert status["plaintextVectorSidecars"] == []
        assert project.db.integrity_report()["ok"] is True
        with project.db.connect() as connection:
            assert connection.execute("SELECT value FROM biometric_probe").fetchone()[0] == marker
            connection.execute("INSERT INTO biometric_probe(value) VALUES (?)", ("WAL_SECRET_MARKER_36a754",))

        assert not database.read_bytes().startswith(b"SQLite format 3\x00")
        assert_plain_sqlite_denied(database)
        for name, secret in (
            ("consent.json", consent_marker),
            ("references.json", reference_marker),
            ("review_candidates.json", candidate_marker),
        ):
            payload = (workspace / name).read_bytes()
            assert payload.startswith(FILE_MAGIC), f"{name} was not encrypted"
            assert secret.encode() not in payload
        audit_payload = project.audit_path.read_bytes()
        assert audit_payload.startswith(AUDIT_ENCRYPTED_PREFIX)
        assert audit_marker.encode() not in audit_payload
        assert project._read_audit_rows()[0]["detail"] == audit_marker
        audit_status = next(row for row in status["sensitiveFiles"] if row["name"] == "audit_log.jsonl")
        assert audit_status["encrypted"] is True
        assert audit_status["format"] == "line-aes-256-gcm"
        assert not (workspace / "reference-vectors.npz").exists()
        assert not (workspace / "reference-vectors.npz.faiss").exists()
        assert not list(workspace.glob(".*workspace.sqlite3*retired*"))
        assert not list(workspace.glob(".*workspace.sqlite3*migrating*"))
        for path in (database, Path(str(database) + "-wal"), Path(str(database) + "-shm")):
            if path.exists():
                raw = path.read_bytes()
                assert marker.encode() not in raw
                assert b"WAL_SECRET_MARKER_36a754" not in raw

        before = file_digest(database)
        wrong_key = os.urandom(32)
        with encryption_environment(root, wrong_key):
            assert_raises(WorkspaceEncryptionError, lambda: ProjectState(workspace), "key")
        assert file_digest(database) == before, "wrong-key startup must not rebuild or modify the database"
        assert not list(workspace.glob("*corrupt*")), "wrong-key startup must not archive the database as corruption"

        with encryption_environment(root, None):
            assert_raises(WorkspaceEncryptionError, lambda: ProjectState(workspace), "required")

        reloaded = ProjectState(workspace)
        with reloaded.db.connect() as connection:
            assert connection.execute("SELECT value FROM biometric_probe ORDER BY rowid LIMIT 1").fetchone()[0] == marker
    return workspace, key


def assert_encrypted_backup_and_restore(root: Path, workspace: Path, key: bytes) -> None:
    with encryption_environment(root, key):
        project = ProjectState(workspace)
        backup = project.export_workspace_backup(root / "backups", include_generated=False)
        backup_path = Path(backup["zipPath"])
        verified = project.verify_workspace_backup(backup_path)
        assert verified["ok"] is True, verified
        assert verified["databaseIntegrity"]["checked"] is True
        assert verified["databaseIntegrity"]["ok"] is True
        with zipfile.ZipFile(backup_path) as archive:
            database_bytes = archive.read("workspace.sqlite3")
            refs_bytes = archive.read("references.json")
            candidates_bytes = archive.read("review_candidates.json")
            consent_bytes = archive.read("consent.json")
            audit_bytes = archive.read("audit_log.jsonl")
            assert not database_bytes.startswith(b"SQLite format 3\x00")
            assert refs_bytes.startswith(FILE_MAGIC)
            assert candidates_bytes.startswith(FILE_MAGIC)
            assert consent_bytes.startswith(FILE_MAGIC)
            assert audit_bytes.startswith(AUDIT_ENCRYPTED_PREFIX)
            extracted = root / "backup-database.sqlite3"
            extracted.write_bytes(database_bytes)
            assert_plain_sqlite_denied(extracted)

        restored = root / "restored-workspace"
        result = project.restore_workspace_backup(backup_path, restored)
        assert result["ok"] is True
        restored_project = ProjectState(restored)
        status = restored_project.workspace_encryption_status()
        assert status["migrationComplete"] is True
        assert status["database"]["keyId"] == workspace_key_id(key)
        with restored_project.db.connect() as connection:
            assert connection.execute("SELECT COUNT(*) FROM biometric_probe").fetchone()[0] >= 1


def assert_rotation_and_crash_recovery(root: Path) -> None:
    workspace = root / "rotation-workspace"
    old_key = os.urandom(32)
    new_key = os.urandom(32)
    marker = "ROTATION_SENSITIVE_MARKER_5d0438"
    with encryption_environment(root, old_key):
        project = ProjectState(workspace)
        project.workspace_encryption.write_json_atomic(
            project.refs_path,
            [{"secret": marker}],
            role="face-references-v1",
        )
        old_encryption = WorkspaceEncryption(workspace, old_key, required=True)
        result = project.rotate_workspace_database_key(new_key, source="unit-test")
        assert result["database"]["keyId"] == workspace_key_id(new_key)
        assert result["migrationComplete"] is True
        assert_raises(
            WorkspaceEncryptionError,
            lambda: old_encryption.read_json(project.refs_path, role="face-references-v1"),
            "authentication",
        )
        audit_bytes = project.audit_path.read_bytes()
        assert audit_bytes.startswith(AUDIT_ENCRYPTED_PREFIX)
        assert workspace_key_id(old_key).encode() not in audit_bytes
        assert workspace_key_id(new_key).encode() not in audit_bytes
        audit_rows = project._read_audit_rows()
        assert audit_rows[-1]["oldKeyId"] == workspace_key_id(old_key)
        assert audit_rows[-1]["newKeyId"] == workspace_key_id(new_key)
        first_line = audit_bytes.splitlines()[0]
        envelope = base64.b64decode(first_line[len(AUDIT_ENCRYPTED_PREFIX):], validate=True)
        assert_raises(
            WorkspaceEncryptionError,
            lambda: old_encryption.decrypt_bytes(envelope, role=AUDIT_ENCRYPTION_ROLE),
            "authentication",
        )
        original_audit = audit_bytes
        tampered_envelope = bytearray(envelope)
        tampered_envelope[-1] ^= 1
        project.audit_path.write_bytes(
            AUDIT_ENCRYPTED_PREFIX + base64.b64encode(bytes(tampered_envelope)) + b"\n"
        )
        tampered = project.verify_audit_chain()
        assert tampered["verified"] is False
        assert tampered["firstBreak"]["reason"] == "encrypted-line-authentication"
        project.audit_path.write_bytes(original_audit)
        assert project.verify_audit_chain()["verified"] is True

    with encryption_environment(root, old_key):
        assert_raises(WorkspaceEncryptionError, lambda: ProjectState(workspace), "key")
    with encryption_environment(root, new_key):
        rotated = ProjectState(workspace)
        assert rotated.workspace_encryption.read_json(rotated.refs_path, role="face-references-v1")[0]["secret"] == marker

    crash_workspace = root / "crash-rotation-workspace"
    crash_old = os.urandom(32)
    crash_new = os.urandom(32)
    with encryption_environment(root, crash_old):
        project = ProjectState(crash_workspace)
        project.workspace_encryption.write_json_atomic(
            project.refs_path,
            [{"secret": marker}],
            role="face-references-v1",
        )
        project._append_audit({"action": "before_interrupted_rotation", "detail": marker})
        project.db.rekey(crash_new)
    with encryption_environment(root, crash_new, crash_old):
        recovered = ProjectState(crash_workspace)
        assert recovered.workspace_encryption.key_id == workspace_key_id(crash_new)
        assert recovered.workspace_encryption.read_json(recovered.refs_path, role="face-references-v1")[0]["secret"] == marker
        raw = recovered.refs_path.read_bytes()
        assert marker.encode() not in raw
        audit_raw = recovered.audit_path.read_bytes()
        assert marker.encode() not in audit_raw
        assert recovered._read_audit_rows()[-1]["detail"] == marker
        old_encryption = WorkspaceEncryption(crash_workspace, crash_old, required=True)
        audit_envelope = base64.b64decode(
            audit_raw.splitlines()[0][len(AUDIT_ENCRYPTED_PREFIX):],
            validate=True,
        )
        assert_raises(
            WorkspaceEncryptionError,
            lambda: old_encryption.decrypt_bytes(audit_envelope, role=AUDIT_ENCRYPTION_ROLE),
            "authentication",
        )
    with encryption_environment(root, crash_old):
        assert_raises(WorkspaceEncryptionError, lambda: ProjectState(crash_workspace), "key")
    with encryption_environment(root, crash_new):
        ProjectState(crash_workspace)


def assert_interrupted_plaintext_migration_recovers(root: Path) -> None:
    workspace = root / "interrupted-migration"
    database = workspace / "workspace.sqlite3"
    marker = "INTERRUPTED_MIGRATION_MARKER_90281f"
    key = os.urandom(32)
    create_plaintext_database(database, marker)
    migrating = workspace / ".workspace.sqlite3.sqlcipher-migrating"
    retired = workspace / ".workspace.sqlite3.plaintext-retired"
    real_replace = os.replace

    def fail_after_plaintext_retired(source, destination):
        if Path(source).resolve() == migrating.resolve() and Path(destination).resolve() == database.resolve() and retired.exists():
            raise OSError("simulated interruption after plaintext retirement")
        return real_replace(source, destination)

    with encryption_environment(root, key):
        encryption = WorkspaceEncryption.from_environment(workspace)
        with mock.patch("crossage_fr.store.workspace_db.os.replace", side_effect=fail_after_plaintext_retired):
            assert_raises(OSError, lambda: WorkspaceDb(database, encryption=encryption), "simulated interruption")
        assert not database.exists()
        assert migrating.exists()
        assert retired.exists()
        recovered = WorkspaceDb(database, encryption=WorkspaceEncryption.from_environment(workspace))
        with recovered.connect() as connection:
            assert connection.execute("SELECT value FROM biometric_probe").fetchone()[0] == marker
        assert database.exists()
        assert not migrating.exists()
        assert not retired.exists()
        assert_plain_sqlite_denied(database)


def main() -> None:
    assert SQLCIPHER_AVAILABLE, "sqlcipher3 must be installed for workspace encryption tests"
    with tempfile.TemporaryDirectory(prefix="vintrace-workspace-encryption-") as temp:
        root = Path(temp)
        workspace, key = assert_plaintext_migration_and_fail_closed(root)
        assert_encrypted_backup_and_restore(root, workspace, key)
        assert_rotation_and_crash_recovery(root)
        assert_interrupted_plaintext_migration_recovers(root)
    print("workspace encryption units ok")


if __name__ == "__main__":
    main()

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import zipfile

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


SQLITE_HEADER = b"SQLite format 3\x00"
FILE_MAGIC = b"VINTRACE-WS-AESGCM\x01"
AUDIT_ENCRYPTED_PREFIX = b"VINTRACE-AUDIT-AESGCM1:"


def encode_key(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode("ascii").rstrip("=")


def key_id(key: bytes) -> str:
    return hashlib.sha256(b"vintrace-workspace-key-v1\0" + key).hexdigest()[:24]


def create_recovery_record(workspace: Path, key: bytes, passphrase: str) -> None:
    salt = os.urandom(16)
    nonce = os.urandom(12)
    identifier = key_id(key)
    derived = hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=65_536,
        r=8,
        p=1,
        dklen=32,
        maxmem=128 * 1024 * 1024,
    )
    ciphertext = AESGCM(derived).encrypt(
        nonce,
        key,
        b"vintrace-workspace-key-recovery-v1\0" + identifier.encode("ascii"),
    )
    record = {
        "schemaVersion": 1,
        "current": {
            "keyId": identifier,
            "recovery": {
                "kdf": "scrypt",
                "n": 65_536,
                "r": 8,
                "p": 1,
                "cipher": "aes-256-gcm",
                "salt": base64.b64encode(salt).decode("ascii"),
                "nonce": base64.b64encode(nonce).decode("ascii"),
                "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
            },
        },
    }
    path = workspace / ".vintrace-db-key.json"
    path.write_text(json.dumps(record), encoding="utf-8")
    path.chmod(0o600)


def create_plaintext_workspace(workspace: Path) -> str:
    marker = "FROZEN_BIOMETRIC_MARKER_70a867"
    workspace.mkdir(parents=True)
    connection = sqlite3.connect(workspace / "workspace.sqlite3")
    try:
        connection.execute("CREATE TABLE frozen_probe (value TEXT NOT NULL)")
        connection.execute("INSERT INTO frozen_probe(value) VALUES(?)", (marker,))
        connection.commit()
    finally:
        connection.close()
    (workspace / "references.json").write_text(json.dumps([{"secret": marker + "-reference"}]), encoding="utf-8")
    (workspace / "review_candidates.json").write_text(json.dumps([{"secret": marker + "-candidate"}]), encoding="utf-8")
    (workspace / "consent.json").write_text(json.dumps({"active": True, "note": marker + "-consent"}), encoding="utf-8")
    (workspace / "audit_log.jsonl").write_text(
        json.dumps({"at": "2026-07-13T00:00:00Z", "action": "legacy-frozen", "detail": marker + "-audit"}) + "\n",
        encoding="utf-8",
    )
    (workspace / "reference-vectors.npz").write_bytes((marker + "-vector").encode())
    (workspace / "reference-vectors.npz.faiss").write_bytes((marker + "-faiss").encode())
    return marker


def process_environment(root: Path, workspace: Path, *, key: bytes | None = None, passphrase: str = "") -> dict[str, str]:
    env = os.environ.copy()
    for name in ("VINTRACE_WORKSPACE_DB_KEY", "VINTRACE_WORKSPACE_DB_PREVIOUS_KEY", "VINTRACE_DB_RECOVERY_PASSPHRASE"):
        env.pop(name, None)
    env.update(
        {
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(root / "registry"),
            "CROSSAGE_REGISTRY_HOME": str(root / "registry"),
            "VINTRACE_REQUIRE_DB_ENCRYPTION": "1",
            "CROSSAGE_FORCE_FALLBACK": "1",
        }
    )
    if key is not None:
        env["VINTRACE_WORKSPACE_DB_KEY"] = encode_key(key)
    if passphrase:
        env["VINTRACE_DB_RECOVERY_PASSPHRASE"] = passphrase
    return env


def start(executable: Path, workspace: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )


def wait_startup(process: subprocess.Popen[str], timeout: float = 180.0) -> dict:
    assert process.stdout is not None
    deadline = time.time() + timeout
    while time.time() < deadline:
        line = process.stdout.readline()
        if line:
            row = json.loads(line)
            if "ready" in row:
                return row
        elif process.poll() is not None:
            break
    stderr = process.stderr.read() if process.stderr is not None else ""
    raise AssertionError(f"Frozen backend did not report startup state (exit={process.poll()}): {stderr[-2000:]}")


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during {command}: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def rpc_error(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during {command}: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        assert row.get("ok") is False, row
        error = row.get("error", {})
        return error if isinstance(error, dict) else {"message": str(error)}


def stop(process: subprocess.Popen[str]) -> None:
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def assert_plain_sqlite_denied(path: Path) -> None:
    connection = sqlite3.connect(path)
    try:
        try:
            connection.execute("SELECT name FROM sqlite_master").fetchall()
        except sqlite3.DatabaseError:
            return
    finally:
        connection.close()
    raise AssertionError("stdlib sqlite read a frozen-runtime encrypted database")


def assert_startup_denied(executable: Path, workspace: Path, env: dict[str, str]) -> dict:
    process = start(executable, workspace, env)
    try:
        row = wait_startup(process)
        assert row.get("ready") is False, row
        error = row.get("error", {})
        assert "key" in str(error.get("message", "")).casefold() or "encrypted" in str(error.get("message", "")).casefold(), row
        return row
    finally:
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()


def main() -> None:
    executable_value = str(os.environ.get("VINTRACE_ENCRYPTION_TEST_EXECUTABLE", "") or "").strip()
    if not executable_value:
        raise SystemExit("VINTRACE_ENCRYPTION_TEST_EXECUTABLE is required.")
    executable = Path(executable_value).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit(f"Frozen backend executable does not exist: {executable}")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-encryption-") as temp:
        root = Path(temp)
        workspace = root / "workspace"
        marker = create_plaintext_workspace(workspace)
        key = os.urandom(32)
        env = process_environment(root, workspace, key=key)

        process = start(executable, workspace, env)
        try:
            startup = wait_startup(process)
            assert startup.get("ready") is True, startup
            status = rpc(process, "status", "workspace_encryption_status", {})
            assert status.get("migrationComplete") is True, status
            assert status.get("database", {}).get("keyId") == key_id(key), status
            assert str(status.get("database", {}).get("cipherVersion", "")).startswith("4."), status
            audit_status = next(row for row in status.get("sensitiveFiles", []) if row.get("name") == "audit_log.jsonl")
            assert audit_status.get("encrypted") is True, status
            integrity = rpc(process, "integrity", "database_integrity", {})
            assert integrity.get("ok") is True, integrity

            exported = rpc(
                process,
                "backup",
                "export_workspace_backup",
                {"folder": str(root / "backups"), "includeGenerated": False},
            ).get("value", {})
            backup_path = Path(str(exported.get("zipPath", "")))
            assert backup_path.is_file(), exported
            verified = rpc(process, "verify", "verify_workspace_backup", {"path": str(backup_path)}).get("value", {})
            assert verified.get("ok") is True, verified
        finally:
            stop(process)

        database = workspace / "workspace.sqlite3"
        assert not database.read_bytes().startswith(SQLITE_HEADER)
        assert_plain_sqlite_denied(database)
        assert (workspace / "references.json").read_bytes().startswith(FILE_MAGIC)
        assert (workspace / "review_candidates.json").read_bytes().startswith(FILE_MAGIC)
        assert (workspace / "consent.json").read_bytes().startswith(FILE_MAGIC)
        assert (workspace / "audit_log.jsonl").read_bytes().startswith(AUDIT_ENCRYPTED_PREFIX)
        assert not (workspace / "reference-vectors.npz").exists()
        assert not (workspace / "reference-vectors.npz.faiss").exists()
        for path in (database, Path(str(database) + "-wal"), workspace / "references.json", workspace / "review_candidates.json", workspace / "consent.json", workspace / "audit_log.jsonl"):
            if path.exists():
                assert marker.encode() not in path.read_bytes(), path

        with zipfile.ZipFile(backup_path) as archive:
            assert not archive.read("workspace.sqlite3").startswith(SQLITE_HEADER)
            assert archive.read("references.json").startswith(FILE_MAGIC)
            assert archive.read("review_candidates.json").startswith(FILE_MAGIC)
            assert archive.read("consent.json").startswith(FILE_MAGIC)
            assert archive.read("audit_log.jsonl").startswith(AUDIT_ENCRYPTED_PREFIX)

        before_wrong_key = hashlib.sha256(database.read_bytes()).hexdigest()
        assert_startup_denied(executable, workspace, process_environment(root, workspace, key=os.urandom(32)))
        assert hashlib.sha256(database.read_bytes()).hexdigest() == before_wrong_key

        recovery_code = "frozen-agent-recovery-" + base64.urlsafe_b64encode(os.urandom(24)).decode("ascii").rstrip("=")
        create_recovery_record(workspace, key, recovery_code)
        recovery_process = start(executable, workspace, process_environment(root, workspace, passphrase=recovery_code))
        try:
            assert wait_startup(recovery_process).get("ready") is True
            recovery_status = rpc(recovery_process, "recovery", "workspace_encryption_status", {})
            assert recovery_status.get("database", {}).get("keyId") == key_id(key), recovery_status
        finally:
            stop(recovery_process)

        new_key = os.urandom(32)
        rotation_process = start(executable, workspace, process_environment(root, workspace, key=key))
        try:
            assert wait_startup(rotation_process).get("ready") is True
            rotated = rpc(
                rotation_process,
                "rotate",
                "rotate_workspace_database_key",
                {"newKey": encode_key(new_key), "source": "frozen-acceptance"},
            )
            assert rotated.get("database", {}).get("keyId") == key_id(new_key), rotated
        finally:
            stop(rotation_process)

        assert_startup_denied(executable, workspace, process_environment(root, workspace, key=key))
        final_process = start(executable, workspace, process_environment(root, workspace, key=new_key))
        try:
            assert wait_startup(final_process).get("ready") is True
            final_status = rpc(final_process, "final", "workspace_encryption_status", {})
            assert final_status.get("migrationComplete") is True, final_status
            assert final_status.get("database", {}).get("keyId") == key_id(new_key), final_status
        finally:
            stop(final_process)

        print(
            json.dumps(
                {
                    "frozen": True,
                    "sqlcipher": True,
                    "migration": True,
                    "recovery": True,
                    "rotation": True,
                    "executableSha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from crossage_fr.workspace_registry import atomic_write_bytes, restrict_file_mode


WORKSPACE_DB_KEY_ENV = "VINTRACE_WORKSPACE_DB_KEY"
WORKSPACE_DB_PREVIOUS_KEY_ENV = "VINTRACE_WORKSPACE_DB_PREVIOUS_KEY"
WORKSPACE_DB_REQUIRED_ENV = "VINTRACE_REQUIRE_DB_ENCRYPTION"
WORKSPACE_DB_RECOVERY_PASSPHRASE_ENV = "VINTRACE_DB_RECOVERY_PASSPHRASE"
WORKSPACE_KEY_RECORD_FILENAME = ".vintrace-db-key.json"
FILE_MAGIC = b"VINTRACE-WS-AESGCM\x01"
FILE_NONCE_BYTES = 12
RECOVERY_AAD_PREFIX = b"vintrace-workspace-key-recovery-v1\0"
RECOVERY_MAXMEM_BYTES = 128 * 1024 * 1024


class WorkspaceEncryptionError(RuntimeError):
    pass


def secure_remove_file(path: Path) -> None:
    try:
        size = path.stat().st_size
        if path.is_file() and not path.is_symlink() and size > 0:
            with path.open("r+b", buffering=0) as handle:
                block = b"\x00" * (1024 * 1024)
                remaining = size
                while remaining > 0:
                    chunk = block if remaining >= len(block) else block[:remaining]
                    handle.write(chunk)
                    remaining -= len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
    except OSError:
        pass
    try:
        path.unlink()
    except OSError:
        pass


def parse_workspace_key(value: str | bytes | None) -> bytes | None:
    if isinstance(value, bytes):
        key = bytes(value)
    else:
        raw = str(value or "").strip()
        if not raw:
            return None
        if raw.startswith("base64:"):
            raw = raw.removeprefix("base64:").strip()
        if len(raw) == 64:
            try:
                key = bytes.fromhex(raw)
            except ValueError:
                key = b""
        else:
            try:
                padded = raw + "=" * ((4 - len(raw) % 4) % 4)
                if not re.fullmatch(r"[A-Za-z0-9+/_-]{43}=?", raw):
                    raise ValueError("invalid base64 key")
                key = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
            except (ValueError, UnicodeEncodeError):
                key = b""
    if len(key) != 32:
        raise WorkspaceEncryptionError("The workspace database key must decode to exactly 32 bytes.")
    return key


def encode_workspace_key(key: bytes) -> str:
    parsed = parse_workspace_key(key)
    assert parsed is not None
    return base64.urlsafe_b64encode(parsed).decode("ascii").rstrip("=")


def workspace_key_id(key: bytes | None) -> str:
    return hashlib.sha256(b"vintrace-workspace-key-v1\0" + (key or b"")).hexdigest()[:24] if key else ""


def _decode_recovery_value(value: Any, *, field: str) -> bytes:
    try:
        return base64.b64decode(str(value or ""), validate=True)
    except (ValueError, TypeError) as exc:
        raise WorkspaceEncryptionError(f"The workspace recovery envelope has an invalid {field} value.") from exc


def decrypt_recovery_slot(slot: Any, passphrase: str) -> bytes:
    if not isinstance(slot, dict) or not str(slot.get("keyId", "")):
        raise WorkspaceEncryptionError("The workspace key record is missing a recovery key slot.")
    envelope = slot.get("recovery")
    if not isinstance(envelope, dict):
        raise WorkspaceEncryptionError("This workspace does not have a passphrase recovery envelope.")
    if envelope.get("kdf") != "scrypt" or envelope.get("cipher") != "aes-256-gcm":
        raise WorkspaceEncryptionError("The workspace recovery envelope uses unsupported cryptography.")
    if not passphrase:
        raise WorkspaceEncryptionError("A workspace recovery passphrase is required.")
    try:
        n = int(envelope.get("n", 0))
        r = int(envelope.get("r", 0))
        p = int(envelope.get("p", 0))
    except (TypeError, ValueError) as exc:
        raise WorkspaceEncryptionError("The workspace recovery envelope has invalid scrypt parameters.") from exc
    if n < 16_384 or n > 1_048_576 or n & (n - 1) or not 1 <= r <= 32 or not 1 <= p <= 16:
        raise WorkspaceEncryptionError("The workspace recovery envelope has invalid scrypt parameters.")
    salt = _decode_recovery_value(envelope.get("salt"), field="salt")
    nonce = _decode_recovery_value(envelope.get("nonce"), field="nonce")
    ciphertext = _decode_recovery_value(envelope.get("ciphertext"), field="ciphertext")
    if len(salt) < 16 or len(nonce) != 12 or len(ciphertext) != 48:
        raise WorkspaceEncryptionError("The workspace recovery envelope is truncated.")
    try:
        derived = hashlib.scrypt(
            passphrase.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=32,
            maxmem=RECOVERY_MAXMEM_BYTES,
        )
        key = AESGCM(derived).decrypt(
            nonce,
            ciphertext,
            RECOVERY_AAD_PREFIX + str(slot["keyId"]).encode("ascii"),
        )
    except (InvalidTag, ValueError, UnicodeEncodeError) as exc:
        raise WorkspaceEncryptionError(
            "The workspace recovery passphrase is incorrect or the key record was modified."
        ) from exc
    if len(key) != 32 or not hmac.compare_digest(workspace_key_id(key), str(slot["keyId"])):
        raise WorkspaceEncryptionError("The recovered workspace key does not match its key record.")
    return key


def load_workspace_recovery_keys(root: Path, passphrase: str) -> tuple[bytes, bytes | None]:
    record_path = root.expanduser().resolve() / WORKSPACE_KEY_RECORD_FILENAME
    try:
        if record_path.stat().st_size > 65_536:
            raise WorkspaceEncryptionError("The workspace key record exceeds its size limit.")
        record = json.loads(record_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise WorkspaceEncryptionError("The workspace key record was not found.") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkspaceEncryptionError("The workspace key record is unreadable.") from exc
    if not isinstance(record, dict) or record.get("schemaVersion") != 1:
        raise WorkspaceEncryptionError("The workspace key record has an unsupported format.")
    current = decrypt_recovery_slot(record.get("current"), passphrase)
    pending_slot = record.get("pending")
    if isinstance(pending_slot, dict):
        return decrypt_recovery_slot(pending_slot, passphrase), current
    return current, None


class WorkspaceEncryption:
    def __init__(
        self,
        root: Path,
        key: bytes | None = None,
        *,
        required: bool = False,
        key_candidates: list[bytes] | None = None,
    ):
        self.root = root.expanduser().resolve()
        self.key = parse_workspace_key(key)
        candidates = [self.key, *(parse_workspace_key(value) for value in (key_candidates or []))]
        self.key_candidates = list(dict.fromkeys(value for value in candidates if value is not None))
        self.required = bool(required)
        if self.required and self.key is None:
            raise WorkspaceEncryptionError(
                "Workspace encryption is required, but no OS-unwrapped database key was provided."
            )

    @classmethod
    def from_environment(cls, root: Path) -> "WorkspaceEncryption":
        required = os.environ.get(WORKSPACE_DB_REQUIRED_ENV, "").strip() == "1"
        primary = parse_workspace_key(os.environ.get(WORKSPACE_DB_KEY_ENV))
        previous = parse_workspace_key(os.environ.get(WORKSPACE_DB_PREVIOUS_KEY_ENV))
        recovery_passphrase = os.environ.get(WORKSPACE_DB_RECOVERY_PASSPHRASE_ENV, "")
        if primary is None and recovery_passphrase:
            primary, previous = load_workspace_recovery_keys(root, recovery_passphrase)
        return cls(root, primary, required=required, key_candidates=[previous] if previous else [])

    def set_primary_key(self, key: bytes, *, retain: list[bytes] | None = None) -> None:
        parsed = parse_workspace_key(key)
        assert parsed is not None
        self.key = parsed
        self.key_candidates = list(
            dict.fromkeys([parsed, *(value for value in (retain or self.key_candidates) if value is not None)])
        )

    @property
    def enabled(self) -> bool:
        return self.key is not None

    @property
    def key_id(self) -> str:
        return workspace_key_id(self.key)

    @staticmethod
    def is_encrypted_bytes(data: bytes) -> bool:
        return data.startswith(FILE_MAGIC)

    def _aad(self, role: str) -> bytes:
        clean_role = str(role or "workspace-file").strip().casefold()[:80]
        return b"vintrace-workspace-file-v1\0" + clean_role.encode("utf-8")

    def encrypt_bytes(self, data: bytes, *, role: str) -> bytes:
        if self.key is None:
            return data
        nonce = os.urandom(FILE_NONCE_BYTES)
        ciphertext = AESGCM(self.key).encrypt(nonce, data, self._aad(role))
        return FILE_MAGIC + nonce + ciphertext

    def decrypt_bytes(self, data: bytes, *, role: str) -> bytes:
        if not self.is_encrypted_bytes(data):
            return data
        if self.key is None:
            raise WorkspaceEncryptionError("This workspace file is encrypted, but its OS-backed key is unavailable.")
        start = len(FILE_MAGIC)
        nonce = data[start : start + FILE_NONCE_BYTES]
        ciphertext = data[start + FILE_NONCE_BYTES :]
        if len(nonce) != FILE_NONCE_BYTES or len(ciphertext) < 16:
            raise WorkspaceEncryptionError("Encrypted workspace file is truncated.")
        for key in self.key_candidates or [self.key]:
            if key is None:
                continue
            try:
                return AESGCM(key).decrypt(nonce, ciphertext, self._aad(role))
            except InvalidTag:
                continue
        raise WorkspaceEncryptionError("Encrypted workspace file failed authentication.")

    def read_bytes(self, path: Path, *, role: str) -> bytes:
        return self.decrypt_bytes(path.read_bytes(), role=role)

    def read_json(self, path: Path, *, role: str) -> Any:
        return json.loads(self.read_bytes(path, role=role).decode("utf-8"))

    def write_bytes_atomic(self, path: Path, data: bytes, *, role: str) -> None:
        payload = self.encrypt_bytes(data, role=role)
        atomic_write_bytes(path, payload)
        restrict_file_mode(path, 0o600)

    def write_json_atomic(self, path: Path, value: Any, *, role: str) -> None:
        data = json.dumps(value, separators=(",", ":")).encode("utf-8")
        self.write_bytes_atomic(path, data, role=role)

    def status(self) -> dict[str, Any]:
        return {
            "required": self.required,
            "enabled": self.enabled,
            "keyId": self.key_id,
            "databaseCipher": "SQLCipher 4" if self.enabled else "plaintext-development-mode",
            "sensitiveFilesCipher": "AES-256-GCM" if self.enabled else "plaintext-development-mode",
        }

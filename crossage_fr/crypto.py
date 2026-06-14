"""At-rest encryption primitive (PC-03).

A small, dependency-light (only `cryptography`) authenticated-encryption helper
used to optionally encrypt the most portable/exfiltratable workspace artifact —
the backup ZIP — at rest. It is passphrase-based (scrypt KDF -> AES-256-GCM), so
a backup file on a USB stick or in cloud storage is unreadable and
tamper-evident without the operator's passphrase.

Format (all binary, concatenated):
    MAGIC(12) | version(1) | salt(16) | nonce(12) | ciphertext+tag

This does NOT encrypt the live workspace SQLite DB in place — that is the larger
SQLCipher migration tracked separately. This module is the reusable building
block and the opt-in backup encryption path.
"""

from __future__ import annotations

import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

from crossage_fr.runtime_env import env_value


MAGIC = b"VINTRACEENC1"
_VERSION = 1
_SALT_LEN = 16
_NONCE_LEN = 12
# scrypt work factors (interactive-strength; ~tens of ms to derive a key).
_SCRYPT_N = 2**15
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LEN = 32


class DecryptionError(Exception):
    """Raised when a blob can't be decrypted (wrong passphrase or tampering)."""


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = Scrypt(salt=salt, length=_KEY_LEN, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)
    return kdf.derive(passphrase.encode("utf-8"))


def is_encrypted(data: bytes) -> bool:
    """True if ``data`` begins with this module's magic header."""
    return data[: len(MAGIC)] == MAGIC


def encrypt_bytes(data: bytes, passphrase: str) -> bytes:
    if not passphrase:
        raise ValueError("A non-empty passphrase is required to encrypt.")
    salt = os.urandom(_SALT_LEN)
    nonce = os.urandom(_NONCE_LEN)
    key = _derive_key(passphrase, salt)
    ciphertext = AESGCM(key).encrypt(nonce, data, MAGIC)  # MAGIC as associated data
    return MAGIC + bytes([_VERSION]) + salt + nonce + ciphertext


def decrypt_bytes(blob: bytes, passphrase: str) -> bytes:
    if not is_encrypted(blob):
        raise DecryptionError("Not a Vintrace-encrypted blob.")
    if not passphrase:
        raise DecryptionError("A passphrase is required to decrypt this backup.")
    offset = len(MAGIC)
    version = blob[offset]
    offset += 1
    if version != _VERSION:
        raise DecryptionError(f"Unsupported encryption version: {version}.")
    salt = blob[offset : offset + _SALT_LEN]
    offset += _SALT_LEN
    nonce = blob[offset : offset + _NONCE_LEN]
    offset += _NONCE_LEN
    ciphertext = blob[offset:]
    key = _derive_key(passphrase, salt)
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, MAGIC)
    except InvalidTag as exc:
        raise DecryptionError("Wrong passphrase or the backup has been modified.") from exc


def backup_passphrase() -> str:
    """The operator-configured backup passphrase, or "" if at-rest backup
    encryption is not enabled. Honors VINTRACE_BACKUP_PASSPHRASE (and the legacy
    CROSSAGE_ alias) via the standard precedence resolver."""
    return env_value("BACKUP_PASSPHRASE") or ""

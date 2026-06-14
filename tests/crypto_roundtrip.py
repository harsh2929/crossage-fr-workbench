"""Tests for the at-rest encryption primitive (PC-03).

Run: PYTHONPATH=. .venv/bin/python tests/crypto_roundtrip.py
"""

from __future__ import annotations

import os

from crossage_fr.crypto import (
    DecryptionError,
    MAGIC,
    backup_passphrase,
    decrypt_bytes,
    encrypt_bytes,
    is_encrypted,
)


def test_round_trip() -> None:
    data = os.urandom(4096) + b"vintrace workspace backup payload"
    blob = encrypt_bytes(data, "correct horse battery staple")
    assert is_encrypted(blob) and blob.startswith(MAGIC)
    assert not is_encrypted(data)
    assert decrypt_bytes(blob, "correct horse battery staple") == data


def test_wrong_passphrase_fails() -> None:
    blob = encrypt_bytes(b"secret embeddings", "passphrase-A")
    try:
        decrypt_bytes(blob, "passphrase-B")
        raise AssertionError("wrong passphrase must not decrypt")
    except DecryptionError:
        pass


def test_tamper_is_detected() -> None:
    blob = bytearray(encrypt_bytes(b"biometric data", "pw"))
    blob[-1] ^= 0x01  # flip a ciphertext/tag bit
    try:
        decrypt_bytes(bytes(blob), "pw")
        raise AssertionError("tampered ciphertext must fail authentication")
    except DecryptionError:
        pass


def test_unique_salts_and_nonces() -> None:
    # Same plaintext + passphrase must not produce identical blobs (random salt/nonce).
    a = encrypt_bytes(b"x", "pw")
    b = encrypt_bytes(b"x", "pw")
    assert a != b
    assert decrypt_bytes(a, "pw") == decrypt_bytes(b, "pw") == b"x"


def test_empty_passphrase_rejected() -> None:
    try:
        encrypt_bytes(b"x", "")
        raise AssertionError("empty passphrase must be rejected on encrypt")
    except ValueError:
        pass
    try:
        decrypt_bytes(encrypt_bytes(b"x", "pw"), "")
        raise AssertionError("empty passphrase must be rejected on decrypt")
    except DecryptionError:
        pass


def test_backup_passphrase_env() -> None:
    old = os.environ.pop("VINTRACE_BACKUP_PASSPHRASE", None)
    try:
        assert backup_passphrase() == ""
        os.environ["VINTRACE_BACKUP_PASSPHRASE"] = "from-env"
        assert backup_passphrase() == "from-env"
    finally:
        os.environ.pop("VINTRACE_BACKUP_PASSPHRASE", None)
        if old is not None:
            os.environ["VINTRACE_BACKUP_PASSPHRASE"] = old


def main() -> None:
    test_round_trip()
    test_wrong_passphrase_fails()
    test_tamper_is_detected()
    test_unique_salts_and_nonces()
    test_empty_passphrase_rejected()
    test_backup_passphrase_env()
    print("crypto roundtrip ok")


if __name__ == "__main__":
    main()

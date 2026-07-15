from __future__ import annotations

import ctypes
import ctypes.util
from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, Protocol


class CredentialBackend(Protocol):
    def get(self, service: str, account: str) -> str | None: ...
    def set(self, service: str, account: str, secret: str) -> None: ...
    def delete(self, service: str, account: str) -> bool: ...


class MemoryCredentialBackend:
    """Deterministic injectable backend for tests; never selected in production."""

    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def get(self, service: str, account: str) -> str | None:
        return self.values.get((service, account))

    def set(self, service: str, account: str, secret: str) -> None:
        self.values[(service, account)] = secret

    def delete(self, service: str, account: str) -> bool:
        return self.values.pop((service, account), None) is not None


class _MacOSKeychainBackend:
    """Small Security.framework wrapper with no command-line secret exposure."""

    _NOT_FOUND = -25300
    _DUPLICATE = -25299

    def __init__(self) -> None:
        security_path = ctypes.util.find_library("Security")
        core_path = ctypes.util.find_library("CoreFoundation")
        if not security_path or not core_path:
            raise RuntimeError("macOS Keychain frameworks are unavailable.")
        self.security = ctypes.CDLL(security_path)
        self.core = ctypes.CDLL(core_path)
        self.security.SecKeychainFindGenericPassword.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint32),
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self.security.SecKeychainFindGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainAddGenericPassword.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        self.security.SecKeychainAddGenericPassword.restype = ctypes.c_int32
        self.security.SecKeychainItemModifyAttributesAndData.argtypes = [
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
        ]
        self.security.SecKeychainItemModifyAttributesAndData.restype = ctypes.c_int32
        self.security.SecKeychainItemDelete.argtypes = [ctypes.c_void_p]
        self.security.SecKeychainItemDelete.restype = ctypes.c_int32
        self.security.SecKeychainItemFreeContent.argtypes = [ctypes.c_void_p, ctypes.c_void_p]
        self.security.SecKeychainItemFreeContent.restype = ctypes.c_int32
        self.core.CFRelease.argtypes = [ctypes.c_void_p]

    @staticmethod
    def _bytes(value: str) -> bytes:
        return str(value or "").encode("utf-8")

    @staticmethod
    def _check(status: int, operation: str, *, allow_not_found: bool = False) -> None:
        if status == 0 or (allow_not_found and status == _MacOSKeychainBackend._NOT_FOUND):
            return
        raise RuntimeError(f"macOS Keychain {operation} failed with status {status}.")

    def _find(self, service: str, account: str, *, include_secret: bool) -> tuple[int, ctypes.c_void_p, ctypes.c_void_p, int]:
        service_bytes = self._bytes(service)
        account_bytes = self._bytes(account)
        length = ctypes.c_uint32(0)
        data = ctypes.c_void_p()
        item = ctypes.c_void_p()
        status = self.security.SecKeychainFindGenericPassword(
            None,
            len(service_bytes),
            service_bytes,
            len(account_bytes),
            account_bytes,
            ctypes.byref(length) if include_secret else None,
            ctypes.byref(data) if include_secret else None,
            ctypes.byref(item),
        )
        return int(status), item, data, int(length.value)

    def get(self, service: str, account: str) -> str | None:
        status, item, data, length = self._find(service, account, include_secret=True)
        if status == self._NOT_FOUND:
            return None
        self._check(status, "read")
        try:
            return ctypes.string_at(data, length).decode("utf-8")
        finally:
            if data:
                self.security.SecKeychainItemFreeContent(None, data)
            if item:
                self.core.CFRelease(item)

    def set(self, service: str, account: str, secret: str) -> None:
        service_bytes = self._bytes(service)
        account_bytes = self._bytes(account)
        secret_bytes = self._bytes(secret)
        item = ctypes.c_void_p()
        status = int(self.security.SecKeychainAddGenericPassword(
            None,
            len(service_bytes),
            service_bytes,
            len(account_bytes),
            account_bytes,
            len(secret_bytes),
            secret_bytes,
            ctypes.byref(item),
        ))
        if status == self._DUPLICATE:
            find_status, existing, _, _ = self._find(service, account, include_secret=False)
            self._check(find_status, "find for update")
            try:
                self._check(
                    int(self.security.SecKeychainItemModifyAttributesAndData(existing, None, len(secret_bytes), secret_bytes)),
                    "update",
                )
            finally:
                if existing:
                    self.core.CFRelease(existing)
            return
        try:
            self._check(status, "write")
        finally:
            if item:
                self.core.CFRelease(item)

    def delete(self, service: str, account: str) -> bool:
        status, item, _, _ = self._find(service, account, include_secret=False)
        if status == self._NOT_FOUND:
            return False
        self._check(status, "find for delete")
        try:
            self._check(int(self.security.SecKeychainItemDelete(item)), "delete")
            return True
        finally:
            if item:
                self.core.CFRelease(item)


class _WindowsCredentialBackend:
    def __init__(self) -> None:
        import win32cred  # type: ignore[import-not-found]

        self.win32cred = win32cred

    @staticmethod
    def _target(service: str, account: str) -> str:
        return f"{service}/{account}"

    def get(self, service: str, account: str) -> str | None:
        try:
            row = self.win32cred.CredRead(self._target(service, account), self.win32cred.CRED_TYPE_GENERIC)
        except Exception as exc:
            if getattr(exc, "winerror", None) == 1168:
                return None
            raise RuntimeError("Windows Credential Manager read failed.") from exc
        blob = row.get("CredentialBlob", b"")
        if isinstance(blob, bytes):
            return blob.decode("utf-16-le") if b"\x00" in blob else blob.decode("utf-8")
        return str(blob or "")

    def set(self, service: str, account: str, secret: str) -> None:
        self.win32cred.CredWrite({
            "Type": self.win32cred.CRED_TYPE_GENERIC,
            "TargetName": self._target(service, account),
            "CredentialBlob": secret,
            "Persist": self.win32cred.CRED_PERSIST_LOCAL_MACHINE,
            "UserName": "Vintrace",
        }, 0)

    def delete(self, service: str, account: str) -> bool:
        try:
            self.win32cred.CredDelete(self._target(service, account), self.win32cred.CRED_TYPE_GENERIC)
            return True
        except Exception as exc:
            if getattr(exc, "winerror", None) == 1168:
                return False
            raise RuntimeError("Windows Credential Manager delete failed.") from exc


class _SecretToolBackend:
    def __init__(self) -> None:
        import shutil

        self.command = shutil.which("secret-tool")
        if not self.command:
            raise RuntimeError("The freedesktop Secret Service client is unavailable.")

    def _args(self, operation: str, service: str, account: str) -> list[str]:
        return [self.command, operation, "application", service, "account", account]

    def get(self, service: str, account: str) -> str | None:
        result = subprocess.run(self._args("lookup", service, account), capture_output=True, text=True, timeout=15, check=False)
        if result.returncode != 0:
            return None
        return result.stdout.rstrip("\n")

    def set(self, service: str, account: str, secret: str) -> None:
        args = [self.command, "store", f"--label=Vintrace inbound connector", "application", service, "account", account]
        result = subprocess.run(args, input=secret, capture_output=True, text=True, timeout=15, check=False)
        if result.returncode != 0:
            raise RuntimeError("Secret Service credential write failed.")

    def delete(self, service: str, account: str) -> bool:
        result = subprocess.run(self._args("clear", service, account), capture_output=True, text=True, timeout=15, check=False)
        return result.returncode == 0


def native_credential_backend() -> CredentialBackend | None:
    if str(os.environ.get("VINTRACE_DISABLE_OS_CREDENTIAL_VAULT", "") or "").strip() == "1":
        return None
    try:
        if sys.platform == "darwin":
            return _MacOSKeychainBackend()
        if sys.platform == "win32":
            return _WindowsCredentialBackend()
        return _SecretToolBackend()
    except Exception:
        return None


class ConnectorCredentialVault:
    """Workspace-scoped OS credential storage shared by desktop, MCP, and HTTP processes."""

    def __init__(self, workspace_root: str | Path, *, backend: CredentialBackend | None = None) -> None:
        workspace = str(Path(workspace_root).expanduser().resolve())
        workspace_hash = sha256(os.path.normcase(workspace).encode("utf-8")).hexdigest()[:20]
        self.service = f"com.vintrace.inbound-connectors.{workspace_hash}"
        self.backend = backend if backend is not None else native_credential_backend()

    @property
    def available(self) -> bool:
        return self.backend is not None

    @staticmethod
    def _account(provider: str, connection_id: str) -> str:
        token = f"{str(provider or '').strip().lower()}\n{str(connection_id or '').strip()}"
        return sha256(token.encode("utf-8")).hexdigest()

    @staticmethod
    def _clean(credential: dict[str, Any] | None) -> dict[str, str]:
        body = credential if isinstance(credential, dict) else {}
        return {
            key: str(body.get(key, "") or "")
            for key in ("accessToken", "username", "password")
            if str(body.get(key, "") or "")
        }

    def store(self, provider: str, connection_id: str, credential: dict[str, Any] | None) -> bool:
        clean = self._clean(credential)
        if not clean:
            return False
        if self.backend is None:
            return False
        payload = json.dumps(clean, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        self.backend.set(self.service, self._account(provider, connection_id), payload)
        return True

    def load(self, provider: str, connection_id: str) -> dict[str, str]:
        if self.backend is None:
            return {}
        payload = self.backend.get(self.service, self._account(provider, connection_id))
        if not payload:
            return {}
        try:
            parsed = json.loads(payload)
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
        return self._clean(parsed if isinstance(parsed, dict) else {})

    def delete(self, provider: str, connection_id: str) -> bool:
        if self.backend is None:
            return False
        return bool(self.backend.delete(self.service, self._account(provider, connection_id)))

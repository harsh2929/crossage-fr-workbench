from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
from typing import Any

from crossage_fr.runtime_env import env_value


MOBILE_CLIENT_TYPE = "mobile"
MOBILE_UNPAIRED_TOKEN_HASH = "0" * 64
MOBILE_MAX_CREDENTIAL_BYTES = 1024 * 1024
MOBILE_MAX_ASSET_BYTES = 8 * 1024 * 1024
MOBILE_PAIR_CODE_RE = re.compile(r"^[A-Za-z0-9_-]{40,128}$")
MOBILE_ACCOUNT_ID_RE = re.compile(r"^mobile-[A-Za-z0-9_-]{8,64}$")
MOBILE_ASSET_EXTENSIONS = frozenset({".html", ".js", ".css", ".json", ".webmanifest", ".png", ".webp"})
MOBILE_ALLOWED_TOOLS = frozenset(
    {
        "mobile_session",
        "list_image_capabilities",
        "get_image_library_overview",
        "search_images",
        "fetch_image_assets",
        "analyze_image_assets",
        "get_image_preview",
    }
)
MOBILE_ALLOWED_SCOPES = frozenset({"images:read", "images:preview"})


class MobilePairingError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = str(code or "mobile_pairing_failed")
        super().__init__(message)


def _utc_iso(now_seconds: int) -> str:
    return datetime.fromtimestamp(int(now_seconds), tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _unix_seconds(value: Any) -> int:
    if isinstance(value, bool) or value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value or "").strip()
    if text.isdigit():
        return int(text)
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())
    except ValueError:
        return 0


def _read_private_json(path: Path) -> dict[str, Any]:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise MobilePairingError("mobile_credentials_unavailable", "Mobile companion credentials are unavailable.") from exc
    try:
        file_stat = os.fstat(descriptor)
        if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size > MOBILE_MAX_CREDENTIAL_BYTES:
            raise MobilePairingError(
                "mobile_credentials_invalid",
                "Mobile companion credentials must be a regular JSON file no larger than 1 MB.",
            )
        if os.name != "nt" and stat.S_IMODE(file_stat.st_mode) & 0o077:
            raise MobilePairingError(
                "mobile_credentials_permissions",
                "Mobile companion credentials must have owner-only permissions (0600).",
            )
        chunks: list[bytes] = []
        remaining = MOBILE_MAX_CREDENTIAL_BYTES + 1
        while remaining > 0:
            chunk = os.read(descriptor, min(64 * 1024, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > MOBILE_MAX_CREDENTIAL_BYTES:
            raise MobilePairingError("mobile_credentials_invalid", "Mobile companion credentials are too large.")
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise MobilePairingError("mobile_credentials_invalid", "Mobile companion credentials are not valid JSON.") from exc
    finally:
        os.close(descriptor)
    if not isinstance(value, dict) or not isinstance(value.get("accounts"), list):
        raise MobilePairingError("mobile_credentials_invalid", "Mobile companion credentials have an invalid schema.")
    return value


def _write_private_json(path: Path, value: dict[str, Any]) -> None:
    directory = path.parent
    directory_stat = directory.lstat()
    if not stat.S_ISDIR(directory_stat.st_mode) or directory.is_symlink():
        raise MobilePairingError("mobile_credentials_invalid", "Mobile companion credential storage is invalid.")
    temporary = directory / f".mobile-companions-{os.getpid()}-{secrets.token_hex(8)}.tmp"
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(temporary, flags, 0o600)
    try:
        payload = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
        offset = 0
        while offset < len(payload):
            offset += os.write(descriptor, payload[offset:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        os.replace(temporary, path)
        if os.name != "nt":
            os.chmod(path, 0o600)
        try:
            directory_descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)
        except OSError:
            pass
    except Exception:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class _CredentialLock:
    def __init__(self, path: Path) -> None:
        self.path = Path(f"{path}.lock")
        self.descriptor: int | None = None

    def __enter__(self):
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        try:
            self.descriptor = os.open(self.path, flags, 0o600)
        except FileExistsError as exc:
            raise MobilePairingError(
                "mobile_credentials_busy",
                "Mobile companion credentials are busy; retry pairing.",
            ) from exc
        os.write(self.descriptor, f"{os.getpid()}\n".encode("ascii"))
        os.fsync(self.descriptor)
        return self

    def __exit__(self, _exc_type, _exc, _traceback) -> None:
        if self.descriptor is not None:
            os.close(self.descriptor)
            self.descriptor = None
        try:
            self.path.unlink()
        except OSError:
            pass


def exchange_mobile_pairing(
    credentials_path: Path | str | None,
    pairing_code: str,
    *,
    now: int | None = None,
) -> tuple[str, dict[str, Any]]:
    path = Path(credentials_path).expanduser().resolve() if credentials_path else None
    clean_code = str(pairing_code or "").strip()
    if path is None or not MOBILE_PAIR_CODE_RE.fullmatch(clean_code):
        raise MobilePairingError("mobile_pairing_invalid", "The mobile pairing link is invalid or expired.")
    current = int(time.time()) if now is None else int(now)
    digest = hashlib.sha256(clean_code.encode("utf-8")).hexdigest()
    with _CredentialLock(path):
        document = _read_private_json(path)
        selected: dict[str, Any] | None = None
        for raw in document.get("accounts", []):
            if not isinstance(raw, dict) or str(raw.get("clientType", "")) != MOBILE_CLIENT_TYPE:
                continue
            candidate = str(raw.get("pairingCodeSha256", "") or "").lower()
            if len(candidate) == 64 and hmac.compare_digest(candidate, digest):
                selected = raw
        if selected is None:
            raise MobilePairingError("mobile_pairing_invalid", "The mobile pairing link is invalid or expired.")
        account_id = str(selected.get("accountId", "") or "")
        scopes = tuple(str(value or "") for value in selected.get("scopes", []))
        tools = tuple(str(value or "") for value in selected.get("allowedTools", []))
        expires_at = _unix_seconds(selected.get("expiresAt"))
        pairing_expires_at = _unix_seconds(selected.get("pairingExpiresAt"))
        if (
            not MOBILE_ACCOUNT_ID_RE.fullmatch(account_id)
            or selected.get("readOnly") is not True
            or bool(selected.get("disabled"))
            or not scopes
            or not set(scopes).issubset(MOBILE_ALLOWED_SCOPES)
            or not tools
            or not set(tools).issubset(MOBILE_ALLOWED_TOOLS)
            or expires_at <= current
            or pairing_expires_at <= current
        ):
            raise MobilePairingError("mobile_pairing_invalid", "The mobile pairing link is invalid or expired.")
        session_token = secrets.token_urlsafe(32)
        selected["tokenSha256"] = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
        selected["pairedAt"] = _utc_iso(current)
        selected["credentialVersion"] = int(selected.get("credentialVersion", 0) or 0) + 1
        selected.pop("pairingCodeSha256", None)
        selected.pop("pairingExpiresAt", None)
        _write_private_json(path, document)
    return session_token, mobile_session_descriptor(selected, now=current)


def mobile_session_descriptor(account: dict[str, Any], *, now: int | None = None) -> dict[str, Any]:
    current = int(time.time()) if now is None else int(now)
    expires_at = _unix_seconds(account.get("expiresAt"))
    return {
        "accountId": str(account.get("accountId", "") or ""),
        "label": str(account.get("displayName", "Mobile device") or "Mobile device")[:64],
        "readOnly": True,
        "allowPreviews": "images:preview" in tuple(account.get("scopes", [])),
        "expiresAt": expires_at,
        "expiresInSeconds": max(0, expires_at - current),
    }


def mobile_assets_root() -> Path | None:
    configured = str(env_value("MOBILE_ASSETS_DIR") or "").strip()
    candidates = []
    if configured:
        candidates.append(Path(configured).expanduser())
    frozen_root = getattr(sys, "_MEIPASS", "")
    if frozen_root:
        candidates.append(Path(frozen_root) / "mobile-dist")
    candidates.append(Path(__file__).resolve().parent.parent / "mobile-dist")
    for candidate in candidates:
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if resolved.is_dir() and (resolved / "index.html").is_file():
            return resolved
    return None


def resolve_mobile_asset(asset_path: str) -> Path:
    root = mobile_assets_root()
    if root is None:
        raise FileNotFoundError("The mobile companion assets are not installed.")
    clean = str(asset_path or "index.html").replace("\\", "/").lstrip("/")
    if not clean or clean.endswith("/"):
        clean = f"{clean}index.html"
    if "\x00" in clean or any(part in {"", ".", ".."} for part in clean.split("/")):
        raise FileNotFoundError("Mobile companion asset was not found.")
    candidate = (root / clean).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise FileNotFoundError("Mobile companion asset was not found.") from exc
    if (
        candidate.suffix.lower() not in MOBILE_ASSET_EXTENSIONS
        or not candidate.is_file()
        or candidate.is_symlink()
        or candidate.stat().st_size > MOBILE_MAX_ASSET_BYTES
    ):
        raise FileNotFoundError("Mobile companion asset was not found.")
    return candidate


def mobile_asset_media_type(path: Path) -> str:
    if path.suffix.lower() == ".webmanifest":
        return "application/manifest+json"
    media_type, _encoding = mimetypes.guess_type(path.name)
    return media_type or "application/octet-stream"


def mobile_security_headers(*, document: bool = False) -> dict[str, str]:
    headers = {
        "Cache-Control": "private, no-store" if document else "public, max-age=31536000, immutable",
        "Content-Security-Policy": (
            "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; "
            "form-action 'none'; frame-ancestors 'none'; img-src 'self' blob: data:; "
            "manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self'"
        ),
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
    }
    return headers

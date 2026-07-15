from __future__ import annotations

from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import PackageNotFoundError, version as package_version
from pathlib import Path
from typing import Any, Iterable
import base64
import hashlib
import hmac
import ipaddress
import json
import math
import os
import re
import secrets
import socket
import threading
import time
import urllib.error
import urllib.request

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, x25519
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from crossage_fr.crypto import DecryptionError, decrypt_bytes, encrypt_bytes
from crossage_fr.store.workspace_encryption import WorkspaceEncryption, WorkspaceEncryptionError
from crossage_fr.workspace_registry import now_iso, restrict_file_mode


LOCAL_SYNC_PROTOCOL = "vintrace-local-sync-v1"
LOCAL_SYNC_SERVICE_TYPE = "_vintrace-sync._tcp.local."
LOCAL_SYNC_IDENTITY_ROLE = "local-sync-identity-v1"
LOCAL_SYNC_PEERS_ROLE = "local-sync-peers-v1"
LOCAL_SYNC_MAX_BODY_BYTES = 2 * 1024 * 1024
LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE = 500
LOCAL_SYNC_MAX_VALUE_BYTES = 32 * 1024
LOCAL_SYNC_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000
LOCAL_SYNC_INVITATION_SECONDS = 10 * 60
LOCAL_SYNC_FIELDS = (
    "title",
    "caption",
    "favorite",
    "rating",
    "colorLabel",
    "pickStatus",
    "hidden",
    "deletedAt",
    "dateOverride",
    "captureDate",
    "locationOverride",
    "locationHidden",
    "keywords",
)


def local_sync_runtime_report() -> dict[str, Any]:
    try:
        from zeroconf import ServiceBrowser, ServiceInfo, Zeroconf

        zeroconf_version = package_version("zeroconf")
        ifaddr_version = package_version("ifaddr")
        available = all(value is not None for value in (ServiceBrowser, ServiceInfo, Zeroconf))
        error = ""
    except (ImportError, PackageNotFoundError) as exc:
        zeroconf_version = ""
        ifaddr_version = ""
        available = False
        error = str(exc)
    return {
        "available": available,
        "zeroconfVersion": zeroconf_version,
        "ifaddrVersion": ifaddr_version,
        "serviceType": LOCAL_SYNC_SERVICE_TYPE,
        "internetService": False,
    } | ({"error": error} if error else {})


class LocalSyncError(RuntimeError):
    pass


class LocalSyncIntegrityError(LocalSyncError):
    pass


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _unb64(value: Any, *, expected: int | None = None) -> bytes:
    text = str(value or "").strip()
    if not text or not re.fullmatch(r"[A-Za-z0-9_-]+", text):
        raise LocalSyncIntegrityError("Local sync data contains invalid base64url.")
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (ValueError, TypeError) as exc:
        raise LocalSyncIntegrityError("Local sync data contains invalid base64url.") from exc
    if expected is not None and len(raw) != expected:
        raise LocalSyncIntegrityError("Local sync key material has an invalid length.")
    return raw


def _public_bytes(key: Any) -> bytes:
    return key.public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _private_bytes(key: Any) -> bytes:
    return key.private_bytes(
        serialization.Encoding.Raw,
        serialization.PrivateFormat.Raw,
        serialization.NoEncryption(),
    )


def _device_id(signing_public_key: bytes) -> str:
    return hashlib.sha256(b"vintrace-sync-device-v1\0" + signing_public_key).hexdigest()


def _utc_from_ms(value: int) -> str:
    return datetime.fromtimestamp(max(0, int(value)) / 1000, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ms_from_utc(value: Any) -> int:
    text = str(value or "").strip()
    if not text:
        return int(time.time() * 1000)
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return int(time.time() * 1000)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return max(0, int(parsed.timestamp() * 1000))


def _clean_label(value: Any, fallback: str = "Paired device") -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()[:64]
    return text or fallback


def _validate_json_value(value: Any, *, depth: int = 0) -> None:
    if depth > 3:
        raise LocalSyncIntegrityError("A local sync value is nested too deeply.")
    if value is None or isinstance(value, (str, bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise LocalSyncIntegrityError("A local sync value contains a non-finite number.")
        return
    if isinstance(value, list):
        if len(value) > 64:
            raise LocalSyncIntegrityError("A local sync value contains too many list items.")
        for item in value:
            _validate_json_value(item, depth=depth + 1)
        return
    if isinstance(value, dict):
        if len(value) > 32:
            raise LocalSyncIntegrityError("A local sync value contains too many object fields.")
        for key, item in value.items():
            if not isinstance(key, str) or not key or len(key) > 64:
                raise LocalSyncIntegrityError("A local sync value contains an invalid object key.")
            _validate_json_value(item, depth=depth + 1)
        return
    raise LocalSyncIntegrityError("A local sync value contains an unsupported JSON type.")


def _validate_operation_value(field: str, value: Any, *, tombstone: bool) -> None:
    if tombstone:
        if value is not None:
            raise LocalSyncIntegrityError("A tombstoned local sync field must contain null.")
        return
    if field in {"title", "caption", "deletedAt", "dateOverride", "captureDate"}:
        limits = {"title": 300, "caption": 4000, "deletedAt": 40, "dateOverride": 40, "captureDate": 40}
        if not isinstance(value, str) or len(value) > limits[field] or "\0" in value:
            raise LocalSyncIntegrityError(f"A local sync {field} value is invalid.")
        if field in {"deletedAt", "dateOverride", "captureDate"} and value and not re.fullmatch(
            r"\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+-]+Z?)?",
            value,
        ):
            raise LocalSyncIntegrityError(f"A local sync {field} value must use an ISO-like date.")
        return
    if field in {"favorite", "hidden", "locationHidden"}:
        if not isinstance(value, bool):
            raise LocalSyncIntegrityError(f"A local sync {field} value must be boolean.")
        return
    if field == "rating":
        if not isinstance(value, int) or isinstance(value, bool) or value < 0 or value > 5:
            raise LocalSyncIntegrityError("A local sync rating value must be an integer from 0 to 5.")
        return
    if field == "colorLabel":
        if value not in {"", "red", "yellow", "green", "blue", "purple"}:
            raise LocalSyncIntegrityError("A local sync color label is invalid.")
        return
    if field == "pickStatus":
        if value not in {"", "pick", "reject"}:
            raise LocalSyncIntegrityError("A local sync pick status is invalid.")
        return
    if field == "keywords":
        if not isinstance(value, list) or len(value) > 64:
            raise LocalSyncIntegrityError("A local sync keywords value is invalid.")
        folded: set[str] = set()
        for item in value:
            if not isinstance(item, str) or not item or len(item) > 64 or "\0" in item:
                raise LocalSyncIntegrityError("A local sync keyword is invalid.")
            key = item.casefold()
            if key in folded:
                raise LocalSyncIntegrityError("A local sync keywords value contains duplicates.")
            folded.add(key)
        return
    if field == "locationOverride":
        if not isinstance(value, dict):
            raise LocalSyncIntegrityError("A local sync location override must be an object.")
        _validate_json_value(value)
        return
    raise LocalSyncIntegrityError("A local sync operation field is unsupported.")


def _private_ip(value: Any) -> str:
    text = str(value or "").strip()
    try:
        address = ipaddress.ip_address(text)
    except ValueError as exc:
        raise LocalSyncError("Local sync endpoints must use a private, link-local, or loopback IP address.") from exc
    if address.version != 4 or not (address.is_private or address.is_link_local or address.is_loopback):
        raise LocalSyncError("Local sync endpoints must use a private, link-local, or loopback IPv4 address.")
    return str(address)


def _endpoint(host: Any, port: Any) -> tuple[str, int]:
    clean_host = _private_ip(host)
    try:
        clean_port = int(port)
    except (TypeError, ValueError) as exc:
        raise LocalSyncError("Local sync endpoint port is invalid.") from exc
    if clean_port < 1 or clean_port > 65535:
        raise LocalSyncError("Local sync endpoint port is invalid.")
    return clean_host, clean_port


def _operation_signing_payload(operation: dict[str, Any]) -> dict[str, Any]:
    return {
        key: operation[key]
        for key in (
            "protocol",
            "operationId",
            "originDeviceId",
            "originSeq",
            "signingPublicKey",
            "hlcPhysicalMs",
            "hlcLogical",
            "entityType",
            "entityKey",
            "field",
            "value",
            "tombstone",
            "createdAt",
        )
    }


def _operation_rank(operation: dict[str, Any]) -> tuple[int, int, str, int, str]:
    return (
        int(operation["hlcPhysicalMs"]),
        int(operation["hlcLogical"]),
        str(operation["originDeviceId"]),
        int(operation["originSeq"]),
        str(operation["operationId"]),
    )


def _register_rank(row: Any) -> tuple[int, int, str, int, str]:
    return (
        int(row["hlc_physical_ms"]),
        int(row["hlc_logical"]),
        str(row["origin_device_id"]),
        int(row["origin_seq"]),
        str(row["operation_id"]),
    )


class _SyncHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class LocalSyncManager:
    def __init__(self, workspace: Path, db: Any, encryption: WorkspaceEncryption) -> None:
        self.workspace = workspace.expanduser().resolve()
        self.db = db
        self.encryption = encryption
        self.root = self.workspace / "local-sync"
        self.identity_path = self.root / "identity.json"
        self.peers_path = self.root / "peers.json"
        self._lock = threading.RLock()
        self._server: _SyncHttpServer | None = None
        self._server_thread: threading.Thread | None = None
        self._invitations: dict[str, dict[str, Any]] = {}
        self._zeroconf: Any | None = None
        self._service_info: Any | None = None
        self._service_browser: Any | None = None
        self._discovery_error = ""
        self._discovered: dict[str, dict[str, Any]] = {}

    def _require_encryption(self) -> None:
        if not self.encryption.enabled:
            raise WorkspaceEncryptionError(
                "Encrypted local sync requires an active SQLCipher workspace and OS-unwrapped workspace key."
            )

    def _ensure_root(self) -> None:
        if self.root.exists() and self.root.is_symlink():
            raise LocalSyncIntegrityError("The local sync state directory cannot be a symlink.")
        self.root.mkdir(parents=True, exist_ok=True)
        restrict_file_mode(self.root, 0o700)

    def _validate_identity(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict) or value.get("schemaVersion") != 1 or value.get("protocol") != LOCAL_SYNC_PROTOCOL:
            raise LocalSyncIntegrityError("Local sync identity has an invalid schema.")
        signing_private = _unb64(value.get("signingPrivateKey"), expected=32)
        exchange_private = _unb64(value.get("exchangePrivateKey"), expected=32)
        signing = ed25519.Ed25519PrivateKey.from_private_bytes(signing_private)
        exchange = x25519.X25519PrivateKey.from_private_bytes(exchange_private)
        signing_public = _public_bytes(signing.public_key())
        exchange_public = _public_bytes(exchange.public_key())
        if not hmac.compare_digest(_b64(signing_public), str(value.get("signingPublicKey", ""))):
            raise LocalSyncIntegrityError("Local sync signing identity failed integrity validation.")
        if not hmac.compare_digest(_b64(exchange_public), str(value.get("exchangePublicKey", ""))):
            raise LocalSyncIntegrityError("Local sync exchange identity failed integrity validation.")
        expected_id = _device_id(signing_public)
        if not hmac.compare_digest(expected_id, str(value.get("deviceId", ""))):
            raise LocalSyncIntegrityError("Local sync device identity failed integrity validation.")
        return {
            **value,
            "deviceId": expected_id,
            "label": _clean_label(value.get("label"), "This device"),
        }

    def _new_identity(self, label: str) -> dict[str, Any]:
        signing = ed25519.Ed25519PrivateKey.generate()
        exchange = x25519.X25519PrivateKey.generate()
        signing_public = _public_bytes(signing.public_key())
        return {
            "schemaVersion": 1,
            "protocol": LOCAL_SYNC_PROTOCOL,
            "deviceId": _device_id(signing_public),
            "label": _clean_label(label, "This device"),
            "signingPrivateKey": _b64(_private_bytes(signing)),
            "signingPublicKey": _b64(signing_public),
            "exchangePrivateKey": _b64(_private_bytes(exchange)),
            "exchangePublicKey": _b64(_public_bytes(exchange.public_key())),
            "createdAt": now_iso(),
        }

    def _load_identity(self, *, create: bool = False, label: str = "") -> dict[str, Any] | None:
        self._require_encryption()
        self._ensure_root()
        if self.identity_path.is_symlink():
            raise LocalSyncIntegrityError("The local sync identity cannot be a symlink.")
        if self.identity_path.is_file():
            try:
                return self._validate_identity(
                    self.encryption.read_json(self.identity_path, role=LOCAL_SYNC_IDENTITY_ROLE)
                )
            except (OSError, ValueError, json.JSONDecodeError, WorkspaceEncryptionError) as exc:
                raise LocalSyncIntegrityError("The encrypted local sync identity is unreadable or modified.") from exc
        if not create:
            return None
        identity = self._new_identity(label)
        self.encryption.write_json_atomic(self.identity_path, identity, role=LOCAL_SYNC_IDENTITY_ROLE)
        return self._validate_identity(identity)

    def _write_identity(self, identity: dict[str, Any]) -> dict[str, Any]:
        clean = self._validate_identity(identity)
        self.encryption.write_json_atomic(self.identity_path, clean, role=LOCAL_SYNC_IDENTITY_ROLE)
        return clean

    def _validate_peer(self, value: Any) -> dict[str, Any]:
        if not isinstance(value, dict):
            raise LocalSyncIntegrityError("Local sync peer record is invalid.")
        device_id = str(value.get("deviceId", "")).lower()
        signing_public = _unb64(value.get("signingPublicKey"), expected=32)
        exchange_public = _unb64(value.get("exchangePublicKey"), expected=32)
        if not re.fullmatch(r"[a-f0-9]{64}", device_id) or not hmac.compare_digest(device_id, _device_id(signing_public)):
            raise LocalSyncIntegrityError("Local sync peer identity failed validation.")
        host, port = _endpoint(value.get("host"), value.get("port"))
        status = str(value.get("status", "active") or "active")
        if status not in {"active", "revoked"}:
            raise LocalSyncIntegrityError("Local sync peer status is invalid.")
        remote_clock = value.get("remoteClock", {})
        if not isinstance(remote_clock, dict) or len(remote_clock) > 128:
            raise LocalSyncIntegrityError("Local sync peer clock is invalid.")
        clean_clock: dict[str, int] = {}
        for key, sequence in remote_clock.items():
            if re.fullmatch(r"[a-f0-9]{64}", str(key)) and isinstance(sequence, int) and 0 <= sequence <= 2**63 - 1:
                clean_clock[str(key)] = sequence
        return {
            "deviceId": device_id,
            "label": _clean_label(value.get("label")),
            "signingPublicKey": _b64(signing_public),
            "exchangePublicKey": _b64(exchange_public),
            "host": host,
            "port": port,
            "status": status,
            "pairedAt": str(value.get("pairedAt", "") or now_iso())[:40],
            "revokedAt": str(value.get("revokedAt", "") or "")[:40],
            "lastSyncAt": str(value.get("lastSyncAt", "") or "")[:40],
            "lastError": re.sub(r"\s+", " ", str(value.get("lastError", "") or "")).strip()[:240],
            "remoteClock": clean_clock,
        }

    def _load_peers(self) -> dict[str, dict[str, Any]]:
        self._require_encryption()
        self._ensure_root()
        if self.peers_path.is_symlink():
            raise LocalSyncIntegrityError("The local sync peer roster cannot be a symlink.")
        if not self.peers_path.is_file():
            return {}
        try:
            payload = self.encryption.read_json(self.peers_path, role=LOCAL_SYNC_PEERS_ROLE)
        except (OSError, ValueError, json.JSONDecodeError, WorkspaceEncryptionError) as exc:
            raise LocalSyncIntegrityError("The encrypted local sync peer roster is unreadable or modified.") from exc
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or not isinstance(payload.get("peers"), list):
            raise LocalSyncIntegrityError("The local sync peer roster has an invalid schema.")
        peers = [self._validate_peer(item) for item in payload["peers"]]
        if len(peers) > 64 or len({peer["deviceId"] for peer in peers}) != len(peers):
            raise LocalSyncIntegrityError("The local sync peer roster exceeds its limit or contains duplicates.")
        return {peer["deviceId"]: peer for peer in peers}

    def _write_peers(self, peers: dict[str, dict[str, Any]]) -> None:
        clean = [self._validate_peer(peer) for peer in peers.values()]
        if len(clean) > 64:
            raise LocalSyncError("A workspace can pair with at most 64 local sync devices.")
        payload = {
            "schemaVersion": 1,
            "protocol": LOCAL_SYNC_PROTOCOL,
            "updatedAt": now_iso(),
            "peers": sorted(clean, key=lambda item: item["deviceId"]),
        }
        self.encryption.write_json_atomic(self.peers_path, payload, role=LOCAL_SYNC_PEERS_ROLE)

    def initialize(self, label: str = "") -> dict[str, Any]:
        with self._lock:
            identity = self._load_identity(create=True, label=label)
            assert identity is not None
            if label and _clean_label(label, "This device") != identity["label"]:
                identity = self._write_identity({**identity, "label": _clean_label(label, "This device")})
            return self.status()

    def _identity_keys(self, identity: dict[str, Any]) -> tuple[ed25519.Ed25519PrivateKey, x25519.X25519PrivateKey]:
        return (
            ed25519.Ed25519PrivateKey.from_private_bytes(_unb64(identity["signingPrivateKey"], expected=32)),
            x25519.X25519PrivateKey.from_private_bytes(_unb64(identity["exchangePrivateKey"], expected=32)),
        )

    def _next_hlc(self, conn: Any, *, now_ms: int | None = None) -> tuple[int, int, int]:
        identity = self._load_identity(create=True)
        assert identity is not None
        device_id = identity["deviceId"]
        rows = {
            str(row["state_key"]): str(row["state_value"])
            for row in conn.execute(
                "SELECT state_key, state_value FROM photo_sync_local_state WHERE state_key IN (?, ?, ?)",
                (f"seq:{device_id}", "hlcPhysicalMs", "hlcLogical"),
            ).fetchall()
        }
        sequence = int(rows.get(f"seq:{device_id}", "0") or 0) + 1
        physical_before = int(rows.get("hlcPhysicalMs", "0") or 0)
        logical_before = int(rows.get("hlcLogical", "0") or 0)
        wall = int(time.time() * 1000) if now_ms is None else max(0, int(now_ms))
        physical = max(wall, physical_before)
        logical = logical_before + 1 if physical == physical_before else 0
        timestamp = now_iso()
        conn.executemany(
            """
            INSERT INTO photo_sync_local_state(state_key, state_value, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value, updated_at=excluded.updated_at
            """,
            [
                (f"seq:{device_id}", str(sequence), timestamp),
                ("hlcPhysicalMs", str(physical), timestamp),
                ("hlcLogical", str(logical), timestamp),
            ],
        )
        return sequence, physical, logical

    def _merge_remote_hlc(self, conn: Any, physical: int, logical: int) -> None:
        rows = {
            str(row["state_key"]): int(row["state_value"] or 0)
            for row in conn.execute(
                "SELECT state_key, state_value FROM photo_sync_local_state WHERE state_key IN ('hlcPhysicalMs', 'hlcLogical')"
            ).fetchall()
        }
        wall = int(time.time() * 1000)
        local_physical = rows.get("hlcPhysicalMs", 0)
        local_logical = rows.get("hlcLogical", 0)
        merged_physical = max(wall, local_physical, physical)
        if merged_physical == local_physical == physical:
            merged_logical = max(local_logical, logical) + 1
        elif merged_physical == local_physical:
            merged_logical = local_logical + 1
        elif merged_physical == physical:
            merged_logical = logical + 1
        else:
            merged_logical = 0
        timestamp = now_iso()
        conn.executemany(
            """
            INSERT INTO photo_sync_local_state(state_key, state_value, updated_at)
            VALUES(?, ?, ?)
            ON CONFLICT(state_key) DO UPDATE SET state_value=excluded.state_value, updated_at=excluded.updated_at
            """,
            [("hlcPhysicalMs", str(merged_physical), timestamp), ("hlcLogical", str(merged_logical), timestamp)],
        )

    def _asset_sync_state(self, conn: Any, entity_key: str) -> dict[str, Any] | None:
        row = conn.execute(
            """
            SELECT a.asset_id, a.capture_date, m.title, m.caption, m.favorite, m.rating,
                m.color_label, m.pick_status, m.hidden,
                m.deleted_at, m.date_override, m.location_override_json, m.location_hidden
            FROM photo_assets AS a
            LEFT JOIN photo_asset_metadata AS m ON m.asset_id = a.asset_id
            WHERE LOWER(a.content_hash) = ?
            ORDER BY a.asset_id ASC
            LIMIT 1
            """,
            (entity_key,),
        ).fetchone()
        if row is None:
            return None
        try:
            location = json.loads(str(row["location_override_json"] or "{}"))
        except (json.JSONDecodeError, TypeError, ValueError):
            location = {}
        keywords = [
            str(item["name"] or "")
            for item in conn.execute(
                """
                SELECT k.name
                FROM photo_asset_keywords AS ak
                JOIN photo_keywords AS k ON k.keyword_id = ak.keyword_id
                WHERE ak.asset_id = ?
                ORDER BY LOWER(k.name), k.name
                """,
                (str(row["asset_id"]),),
            ).fetchall()
            if str(item["name"] or "")
        ]
        return {
            "title": str(row["title"] or ""),
            "caption": str(row["caption"] or ""),
            "favorite": bool(row["favorite"] or 0),
            "rating": max(0, min(5, int(row["rating"] or 0))),
            "colorLabel": str(row["color_label"] or ""),
            "pickStatus": str(row["pick_status"] or ""),
            "hidden": bool(row["hidden"] or 0),
            "deletedAt": str(row["deleted_at"] or ""),
            "dateOverride": str(row["date_override"] or ""),
            "captureDate": str(row["capture_date"] or ""),
            "locationOverride": location if isinstance(location, dict) else {},
            "locationHidden": bool(row["location_hidden"] or 0),
            "keywords": keywords[:64],
        }

    def _new_operation(
        self,
        identity: dict[str, Any],
        *,
        sequence: int,
        physical: int,
        logical: int,
        entity_key: str,
        field: str,
        value: Any,
        tombstone: bool = False,
    ) -> dict[str, Any]:
        _validate_operation_value(field, value, tombstone=tombstone)
        operation_id = "syncop_" + hashlib.sha256(
            f"{identity['deviceId']}:{sequence}".encode("ascii")
        ).hexdigest()[:40]
        operation = {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "operationId": operation_id,
            "originDeviceId": identity["deviceId"],
            "originSeq": sequence,
            "signingPublicKey": identity["signingPublicKey"],
            "hlcPhysicalMs": physical,
            "hlcLogical": logical,
            "entityType": "asset",
            "entityKey": entity_key,
            "field": field,
            "value": value,
            "tombstone": bool(tombstone),
            "createdAt": _utc_from_ms(physical),
        }
        signing, _ = self._identity_keys(identity)
        operation["signature"] = _b64(signing.sign(_canonical_json(_operation_signing_payload(operation))))
        return operation

    def _validate_operation(self, raw: Any) -> dict[str, Any]:
        if not isinstance(raw, dict) or raw.get("protocol") != LOCAL_SYNC_PROTOCOL:
            raise LocalSyncIntegrityError("A local sync operation has an invalid protocol.")
        operation_id = str(raw.get("operationId", ""))
        origin_device_id = str(raw.get("originDeviceId", "")).lower()
        entity_key = str(raw.get("entityKey", "")).lower()
        field = str(raw.get("field", ""))
        if not re.fullmatch(r"syncop_[a-f0-9]{40}", operation_id):
            raise LocalSyncIntegrityError("A local sync operation id is invalid.")
        if not re.fullmatch(r"[a-f0-9]{64}", origin_device_id) or not re.fullmatch(r"[a-f0-9]{64}", entity_key):
            raise LocalSyncIntegrityError("A local sync operation identity is invalid.")
        if raw.get("entityType") != "asset" or field not in LOCAL_SYNC_FIELDS:
            raise LocalSyncIntegrityError("A local sync operation field is unsupported.")
        try:
            sequence = int(raw.get("originSeq"))
            physical = int(raw.get("hlcPhysicalMs"))
            logical = int(raw.get("hlcLogical"))
        except (TypeError, ValueError) as exc:
            raise LocalSyncIntegrityError("A local sync operation clock is invalid.") from exc
        if sequence < 1 or sequence > 2**63 - 1 or physical < 0 or logical < 0 or logical > 2**31 - 1:
            raise LocalSyncIntegrityError("A local sync operation clock is out of range.")
        if physical > int(time.time() * 1000) + LOCAL_SYNC_CLOCK_SKEW_MS:
            raise LocalSyncIntegrityError("A local sync operation clock is too far in the future.")
        signing_public = _unb64(raw.get("signingPublicKey"), expected=32)
        if not hmac.compare_digest(origin_device_id, _device_id(signing_public)):
            raise LocalSyncIntegrityError("A local sync operation signer does not match its device id.")
        tombstone = raw.get("tombstone", False)
        if not isinstance(tombstone, bool):
            raise LocalSyncIntegrityError("A local sync operation tombstone flag is invalid.")
        value = raw.get("value")
        _validate_operation_value(field, value, tombstone=tombstone)
        try:
            value_bytes = _canonical_json(value)
        except (TypeError, ValueError) as exc:
            raise LocalSyncIntegrityError("A local sync operation value is not canonical JSON.") from exc
        if len(value_bytes) > LOCAL_SYNC_MAX_VALUE_BYTES:
            raise LocalSyncIntegrityError("A local sync operation value exceeds its size limit.")
        operation = {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "operationId": operation_id,
            "originDeviceId": origin_device_id,
            "originSeq": sequence,
            "signingPublicKey": _b64(signing_public),
            "hlcPhysicalMs": physical,
            "hlcLogical": logical,
            "entityType": "asset",
            "entityKey": entity_key,
            "field": field,
            "value": value,
            "tombstone": tombstone,
            "createdAt": str(raw.get("createdAt", "") or _utc_from_ms(physical))[:40],
        }
        expected_id = "syncop_" + hashlib.sha256(
            f"{origin_device_id}:{sequence}".encode("ascii")
        ).hexdigest()[:40]
        if not hmac.compare_digest(operation_id, expected_id):
            raise LocalSyncIntegrityError("A local sync operation id does not match its sequence.")
        signature = _unb64(raw.get("signature"), expected=64)
        try:
            ed25519.Ed25519PublicKey.from_public_bytes(signing_public).verify(
                signature,
                _canonical_json(_operation_signing_payload(operation)),
            )
        except InvalidSignature as exc:
            raise LocalSyncIntegrityError("A local sync operation signature is invalid.") from exc
        operation["signature"] = _b64(signature)
        return operation

    def _operation_from_row(self, row: Any) -> dict[str, Any]:
        try:
            value = json.loads(str(row["value_json"] or "null"))
        except json.JSONDecodeError as exc:
            raise LocalSyncIntegrityError("Stored local sync operation JSON is invalid.") from exc
        return {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "operationId": str(row["operation_id"]),
            "originDeviceId": str(row["origin_device_id"]),
            "originSeq": int(row["origin_seq"]),
            "signingPublicKey": str(row["signing_public_key"]),
            "signature": str(row["signature"]),
            "hlcPhysicalMs": int(row["hlc_physical_ms"]),
            "hlcLogical": int(row["hlc_logical"]),
            "entityType": str(row["entity_type"]),
            "entityKey": str(row["entity_key"]),
            "field": str(row["field_name"]),
            "value": value,
            "tombstone": bool(row["tombstone"]),
            "createdAt": str(row["created_at"]),
        }

    def _insert_operation(self, conn: Any, operation: dict[str, Any]) -> tuple[bool, bool]:
        value_json = _canonical_json(operation["value"]).decode("ascii")
        received = now_iso()
        cursor = conn.execute(
            """
            INSERT OR IGNORE INTO photo_sync_operations(
                operation_id, origin_device_id, origin_seq, signing_public_key, signature,
                hlc_physical_ms, hlc_logical, entity_type, entity_key, field_name,
                value_json, tombstone, created_at, received_at
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                operation["operationId"], operation["originDeviceId"], operation["originSeq"],
                operation["signingPublicKey"], operation["signature"], operation["hlcPhysicalMs"],
                operation["hlcLogical"], operation["entityType"], operation["entityKey"], operation["field"],
                value_json, int(operation["tombstone"]), operation["createdAt"], received,
            ),
        )
        if int(cursor.rowcount or 0) == 0:
            stored_row = conn.execute(
                """
                SELECT * FROM photo_sync_operations
                WHERE operation_id = ? OR (origin_device_id = ? AND origin_seq = ?)
                LIMIT 1
                """,
                (operation["operationId"], operation["originDeviceId"], operation["originSeq"]),
            ).fetchone()
            if stored_row is None:
                raise LocalSyncIntegrityError("A local sync operation could not be persisted consistently.")
            stored = self._operation_from_row(stored_row)
            if not hmac.compare_digest(_canonical_json(stored), _canonical_json(operation)):
                raise LocalSyncIntegrityError(
                    "A local sync signer reused an operation sequence with different content."
                )
            return False, False
        existing = conn.execute(
            """
            SELECT * FROM photo_sync_registers
            WHERE entity_type = ? AND entity_key = ? AND field_name = ?
            LIMIT 1
            """,
            (operation["entityType"], operation["entityKey"], operation["field"]),
        ).fetchone()
        operation_wins = existing is None or _operation_rank(operation) > _register_rank(existing)
        if existing is not None:
            existing_value = str(existing["value_json"] or "null")
            existing_tombstone = bool(existing["tombstone"])
            if existing_value != value_json or existing_tombstone != bool(operation["tombstone"]):
                winner = operation["operationId"] if operation_wins else str(existing["operation_id"])
                loser = str(existing["operation_id"]) if operation_wins else operation["operationId"]
                conflict_id = "syncconf_" + hashlib.sha256(
                    f"{operation['entityType']}:{operation['entityKey']}:{operation['field']}:{winner}:{loser}".encode("ascii")
                ).hexdigest()[:40]
                conn.execute(
                    """
                    INSERT OR IGNORE INTO photo_sync_conflicts(
                        conflict_id, entity_type, entity_key, field_name,
                        winner_operation_id, loser_operation_id, resolution, resolved_at
                    ) VALUES(?, ?, ?, ?, ?, ?, 'hlc-lww', ?)
                    """,
                    (conflict_id, operation["entityType"], operation["entityKey"], operation["field"], winner, loser, received),
                )
        if operation_wins:
            conn.execute(
                """
                INSERT INTO photo_sync_registers(
                    entity_type, entity_key, field_name, operation_id, origin_device_id,
                    origin_seq, hlc_physical_ms, hlc_logical, value_json, tombstone, updated_at
                ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(entity_type, entity_key, field_name) DO UPDATE SET
                    operation_id=excluded.operation_id,
                    origin_device_id=excluded.origin_device_id,
                    origin_seq=excluded.origin_seq,
                    hlc_physical_ms=excluded.hlc_physical_ms,
                    hlc_logical=excluded.hlc_logical,
                    value_json=excluded.value_json,
                    tombstone=excluded.tombstone,
                    updated_at=excluded.updated_at
                """,
                (
                    operation["entityType"], operation["entityKey"], operation["field"], operation["operationId"],
                    operation["originDeviceId"], operation["originSeq"], operation["hlcPhysicalMs"],
                    operation["hlcLogical"], value_json, int(operation["tombstone"]), received,
                ),
            )
        return True, operation_wins

    def capture_local_changes(self, *, limit: int = 500, now_ms: int | None = None) -> dict[str, Any]:
        self._require_encryption()
        identity = self._load_identity(create=True)
        assert identity is not None
        clean_limit = max(1, min(5000, int(limit or 500)))
        captured = fields = skipped = 0
        with self._lock, self.db.connect() as conn:
            dirty_rows = conn.execute(
                """
                SELECT entity_type, entity_key, local_asset_id, tombstone, dirty_at
                FROM photo_sync_dirty
                ORDER BY dirty_at ASC, entity_type ASC, entity_key ASC
                LIMIT ?
                """,
                (clean_limit,),
            ).fetchall()
            for dirty in dirty_rows:
                entity_key = str(dirty["entity_key"] or "").lower()
                if dirty["entity_type"] != "asset" or not re.fullmatch(r"[a-f0-9]{64}", entity_key):
                    skipped += 1
                    conn.execute("DELETE FROM photo_sync_dirty WHERE entity_type = ? AND entity_key = ?", (dirty["entity_type"], dirty["entity_key"]))
                    continue
                state = self._asset_sync_state(conn, entity_key)
                if state is not None:
                    self._apply_pending_registers_before_capture(conn, identity["deviceId"], entity_key, state)
                    state = self._asset_sync_state(conn, entity_key)
                if state is None and bool(dirty["tombstone"]):
                    state = {"deletedAt": str(dirty["dirty_at"] or now_iso())}
                if state is None:
                    skipped += 1
                    conn.execute("DELETE FROM photo_sync_dirty WHERE entity_type = 'asset' AND entity_key = ?", (entity_key,))
                    continue
                operation_now_ms = now_ms if now_ms is not None else _ms_from_utc(dirty["dirty_at"])
                for field, value in state.items():
                    if field not in LOCAL_SYNC_FIELDS:
                        continue
                    encoded = _canonical_json(value).decode("ascii")
                    register = conn.execute(
                        """
                        SELECT value_json, tombstone FROM photo_sync_registers
                        WHERE entity_type = 'asset' AND entity_key = ? AND field_name = ?
                        LIMIT 1
                        """,
                        (entity_key, field),
                    ).fetchone()
                    if register is not None and str(register["value_json"] or "null") == encoded and not bool(register["tombstone"]):
                        continue
                    sequence, physical, logical = self._next_hlc(conn, now_ms=operation_now_ms)
                    operation = self._new_operation(
                        identity,
                        sequence=sequence,
                        physical=physical,
                        logical=logical,
                        entity_key=entity_key,
                        field=field,
                        value=value,
                    )
                    inserted, _ = self._insert_operation(conn, operation)
                    fields += int(inserted)
                conn.execute("DELETE FROM photo_sync_dirty WHERE entity_type = 'asset' AND entity_key = ?", (entity_key,))
                captured += 1
        return {"capturedEntities": captured, "capturedOperations": fields, "skipped": skipped}

    def _apply_pending_registers_before_capture(
        self,
        conn: Any,
        local_device_id: str,
        entity_key: str,
        state: dict[str, Any],
    ) -> int:
        local_operation = conn.execute(
            """
            SELECT 1 FROM photo_sync_operations
            WHERE origin_device_id = ? AND entity_type = 'asset' AND entity_key = ?
            LIMIT 1
            """,
            (local_device_id, entity_key),
        ).fetchone()
        if local_operation is not None:
            return 0
        register_fields = {
            str(row["field_name"])
            for row in conn.execute(
                """
                SELECT field_name FROM photo_sync_registers
                WHERE entity_type = 'asset' AND entity_key = ?
                """,
                (entity_key,),
            ).fetchall()
        }
        defaults: dict[str, Any] = {
            "title": "",
            "caption": "",
            "favorite": False,
            "rating": 0,
            "colorLabel": "",
            "pickStatus": "",
            "hidden": False,
            "deletedAt": "",
            "dateOverride": "",
            "captureDate": "",
            "locationOverride": {},
            "locationHidden": False,
            "keywords": [],
        }
        fields = {
            field for field in register_fields
            if field in defaults and state.get(field) == defaults[field]
        }
        if not fields:
            return 0
        conn.execute(
            """
            INSERT INTO meta(key, value) VALUES('photoSyncApplying', '1')
            ON CONFLICT(key) DO UPDATE SET value='1'
            """
        )
        try:
            return self._apply_register_fields(conn, entity_key, fields)
        finally:
            conn.execute(
                """
                INSERT INTO meta(key, value) VALUES('photoSyncApplying', '0')
                ON CONFLICT(key) DO UPDATE SET value='0'
                """
            )

    def _apply_register_fields(self, conn: Any, entity_key: str, fields: set[str]) -> int:
        asset_rows = conn.execute(
            "SELECT asset_id FROM photo_assets WHERE LOWER(content_hash) = ? ORDER BY asset_id ASC",
            (entity_key,),
        ).fetchall()
        if not asset_rows:
            return 0
        placeholders = ",".join("?" for _ in fields)
        registers = conn.execute(
            f"""
            SELECT field_name, value_json, tombstone
            FROM photo_sync_registers
            WHERE entity_type = 'asset' AND entity_key = ? AND field_name IN ({placeholders})
            """,
            (entity_key, *sorted(fields)),
        ).fetchall()
        values: dict[str, Any] = {}
        for row in registers:
            try:
                values[str(row["field_name"])] = None if bool(row["tombstone"]) else json.loads(str(row["value_json"] or "null"))
            except json.JSONDecodeError as exc:
                raise LocalSyncIntegrityError("A local sync register contains invalid JSON.") from exc
        applied = 0
        for asset_row in asset_rows:
            kwargs: dict[str, Any] = {"asset_id": str(asset_row["asset_id"]), "conn": conn}
            if "title" in values:
                kwargs["title"] = str(values["title"] or "")[:300]
            if "caption" in values:
                kwargs["caption"] = str(values["caption"] or "")[:4000]
            if "favorite" in values:
                kwargs["favorite"] = bool(values["favorite"])
            if "rating" in values:
                kwargs["rating"] = int(values["rating"] or 0)
            if "colorLabel" in values:
                kwargs["color_label"] = str(values["colorLabel"] or "")
            if "pickStatus" in values:
                kwargs["pick_status"] = str(values["pickStatus"] or "")
            if "hidden" in values:
                kwargs["hidden"] = bool(values["hidden"])
            if "deletedAt" in values:
                deleted_at = str(values["deletedAt"] or "")[:40]
                kwargs["deleted_at"] = deleted_at or None
                kwargs["clear_deleted"] = not bool(deleted_at)
            if "dateOverride" in values:
                kwargs["date_override"] = str(values["dateOverride"] or "")[:40]
            if "captureDate" in values:
                kwargs["capture_date"] = str(values["captureDate"] or "")[:40]
            if "locationOverride" in values:
                kwargs["location_override"] = values["locationOverride"] if isinstance(values["locationOverride"], dict) else {}
            if "locationHidden" in values:
                kwargs["location_hidden"] = bool(values["locationHidden"])
            if "keywords" in values:
                kwargs["keywords"] = values["keywords"] if isinstance(values["keywords"], list) else []
            self.db.update_photo_asset_metadata(**kwargs)
            applied += 1
        return applied

    def merge_operations(self, operations: Iterable[Any], *, sender_device_id: str = "") -> dict[str, Any]:
        self._require_encryption()
        rows = list(operations)
        if len(rows) > LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE:
            raise LocalSyncError("A local sync page exceeds the operation limit.")
        validated = [self._validate_operation(row) for row in rows]
        inserted = duplicates = won = applied = pending = 0
        changed: dict[str, set[str]] = {}
        with self._lock, self.db.connect() as conn:
            for operation in validated:
                self._merge_remote_hlc(conn, operation["hlcPhysicalMs"], operation["hlcLogical"])
                was_inserted, operation_won = self._insert_operation(conn, operation)
                inserted += int(was_inserted)
                duplicates += int(not was_inserted)
                won += int(was_inserted and operation_won)
                if was_inserted and operation_won:
                    changed.setdefault(operation["entityKey"], set()).add(operation["field"])
            conn.execute(
                """
                INSERT INTO meta(key, value) VALUES('photoSyncApplying', '1')
                ON CONFLICT(key) DO UPDATE SET value='1'
                """
            )
            try:
                for entity_key, fields in changed.items():
                    count = self._apply_register_fields(conn, entity_key, fields)
                    applied += count
                    pending += int(count == 0)
            finally:
                conn.execute(
                    """
                    INSERT INTO meta(key, value) VALUES('photoSyncApplying', '0')
                    ON CONFLICT(key) DO UPDATE SET value='0'
                    """
                )
        return {
            "received": len(rows),
            "inserted": inserted,
            "duplicates": duplicates,
            "winningOperations": won,
            "appliedAssets": applied,
            "pendingAssets": pending,
            "senderDeviceId": str(sender_device_id or ""),
        }

    def clock(self) -> dict[str, int]:
        with self.db.connect() as conn:
            rows = conn.execute(
                "SELECT origin_device_id, MAX(origin_seq) AS max_seq FROM photo_sync_operations GROUP BY origin_device_id"
            ).fetchall()
        return {str(row["origin_device_id"]): int(row["max_seq"] or 0) for row in rows}

    @staticmethod
    def _clean_clock(value: Any) -> dict[str, int]:
        if not isinstance(value, dict) or len(value) > 128:
            raise LocalSyncIntegrityError("A local sync vector clock is invalid.")
        result: dict[str, int] = {}
        for key, raw_sequence in value.items():
            device_id = str(key or "").lower()
            if not re.fullmatch(r"[a-f0-9]{64}", device_id):
                raise LocalSyncIntegrityError("A local sync vector clock device id is invalid.")
            if not isinstance(raw_sequence, int) or raw_sequence < 0 or raw_sequence > 2**63 - 1:
                raise LocalSyncIntegrityError("A local sync vector clock sequence is invalid.")
            result[device_id] = raw_sequence
        return result

    def export_operations(self, known_clock: Any, *, limit: int = LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE) -> dict[str, Any]:
        clock = self._clean_clock(known_clock)
        clean_limit = max(1, min(LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE, int(limit or LOCAL_SYNC_MAX_OPERATIONS_PER_PAGE)))
        candidates: list[Any] = []
        with self.db.connect() as conn:
            origins = [str(row["origin_device_id"]) for row in conn.execute(
                "SELECT DISTINCT origin_device_id FROM photo_sync_operations ORDER BY origin_device_id"
            ).fetchall()]
            for origin in origins:
                candidates.extend(conn.execute(
                    """
                    SELECT * FROM photo_sync_operations
                    WHERE origin_device_id = ? AND origin_seq > ?
                    ORDER BY origin_seq ASC
                    LIMIT ?
                    """,
                    (origin, int(clock.get(origin, 0)), clean_limit + 1),
                ).fetchall())
        candidates.sort(key=lambda row: (
            int(row["hlc_physical_ms"]), int(row["hlc_logical"]),
            str(row["origin_device_id"]), int(row["origin_seq"]),
        ))
        has_more = len(candidates) > clean_limit
        selected = candidates[:clean_limit]
        return {
            "operations": [self._operation_from_row(row) for row in selected],
            "hasMore": has_more,
            "clock": self.clock(),
        }

    def _record_seen_request(self, sender_device_id: str, request_id: str) -> None:
        if not re.fullmatch(r"req_[a-f0-9]{32}", request_id):
            raise LocalSyncIntegrityError("A local sync request id is invalid.")
        with self.db.connect() as conn:
            cursor = conn.execute(
                "INSERT OR IGNORE INTO photo_sync_seen_requests(sender_device_id, request_id, seen_at) VALUES(?, ?, ?)",
                (sender_device_id, request_id, now_iso()),
            )
            if int(cursor.rowcount or 0) == 0:
                raise LocalSyncIntegrityError("A replayed local sync request was rejected.")
            conn.execute(
                """
                DELETE FROM photo_sync_seen_requests
                WHERE (sender_device_id, request_id) IN (
                    SELECT sender_device_id, request_id FROM photo_sync_seen_requests
                    ORDER BY seen_at DESC LIMIT -1 OFFSET 10000
                )
                """
            )

    @staticmethod
    def _derive_key(shared_secret: bytes, *, salt: bytes, info: bytes) -> bytes:
        return HKDF(algorithm=hashes.SHA256(), length=32, salt=salt, info=info).derive(shared_secret)

    def _pair_key(self, identity: dict[str, Any], remote_exchange_public: str, token: bytes, remote_id: str) -> bytes:
        _, exchange = self._identity_keys(identity)
        shared = exchange.exchange(x25519.X25519PublicKey.from_public_bytes(_unb64(remote_exchange_public, expected=32)))
        ids = ":".join(sorted((identity["deviceId"], remote_id))).encode("ascii")
        return self._derive_key(shared, salt=token, info=b"vintrace-sync-pair-v1\0" + ids)

    def _session_key(self, identity: dict[str, Any], peer: dict[str, Any]) -> bytes:
        _, exchange = self._identity_keys(identity)
        shared = exchange.exchange(x25519.X25519PublicKey.from_public_bytes(_unb64(peer["exchangePublicKey"], expected=32)))
        ids = ":".join(sorted((identity["deviceId"], peer["deviceId"]))).encode("ascii")
        salt = hashlib.sha256(b"vintrace-sync-session-salt-v1\0" + ids).digest()
        return self._derive_key(shared, salt=salt, info=b"vintrace-sync-session-v1\0" + ids)

    @staticmethod
    def _aad(sender_id: str, receiver_id: str, request_id: str, kind: str) -> bytes:
        return f"{LOCAL_SYNC_PROTOCOL}:{kind}:{sender_id}:{receiver_id}:{request_id}".encode("ascii")

    def _identity_public_record(self, identity: dict[str, Any], *, host: str, port: int) -> dict[str, Any]:
        body = {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "deviceId": identity["deviceId"],
            "label": identity["label"],
            "signingPublicKey": identity["signingPublicKey"],
            "exchangePublicKey": identity["exchangePublicKey"],
            "host": host,
            "port": port,
            "issuedAt": now_iso(),
        }
        signing, _ = self._identity_keys(identity)
        body["signature"] = _b64(signing.sign(_canonical_json(body)))
        return body

    def _validate_identity_record(self, value: Any, *, expected_device_id: str = "") -> dict[str, Any]:
        if not isinstance(value, dict) or value.get("protocol") != LOCAL_SYNC_PROTOCOL:
            raise LocalSyncIntegrityError("A local sync pairing identity is invalid.")
        signed_keys = (
            "protocol", "deviceId", "label", "signingPublicKey", "exchangePublicKey", "host", "port", "issuedAt"
        )
        if any(key not in value for key in signed_keys):
            raise LocalSyncIntegrityError("A local sync pairing identity is incomplete.")
        signing_public = _unb64(value.get("signingPublicKey"), expected=32)
        exchange_public = _unb64(value.get("exchangePublicKey"), expected=32)
        device_id = _device_id(signing_public)
        if expected_device_id and not hmac.compare_digest(device_id, expected_device_id):
            raise LocalSyncIntegrityError("A local sync pairing identity changed during the handshake.")
        signed = {key: value[key] for key in signed_keys}
        if not hmac.compare_digest(str(value.get("deviceId", "")), device_id):
            raise LocalSyncIntegrityError("A local sync pairing device id is invalid.")
        try:
            ed25519.Ed25519PublicKey.from_public_bytes(signing_public).verify(
                _unb64(value.get("signature"), expected=64), _canonical_json(signed)
            )
        except InvalidSignature as exc:
            raise LocalSyncIntegrityError("A local sync pairing signature is invalid.") from exc
        host, port = _endpoint(value.get("host"), value.get("port"))
        return {
            "deviceId": device_id,
            "label": _clean_label(value.get("label")),
            "signingPublicKey": _b64(signing_public),
            "exchangePublicKey": _b64(exchange_public),
            "host": host,
            "port": port,
            "status": "active",
            "pairedAt": now_iso(),
            "revokedAt": "",
            "lastSyncAt": "",
            "lastError": "",
            "remoteClock": {},
        }

    def _server_endpoint_for_record(self) -> tuple[str, int]:
        if self._server is None:
            raise LocalSyncError("Start local sync before pairing a peer.")
        port = int(self._server.server_address[1])
        addresses = self._advertised_addresses()
        return (addresses[0] if addresses else "127.0.0.1"), port

    def _advertised_addresses(self) -> list[str]:
        addresses: set[str] = set()
        try:
            for item in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET, socket.SOCK_STREAM):
                candidate = str(item[4][0])
                parsed = ipaddress.ip_address(candidate)
                if parsed.is_private or parsed.is_link_local:
                    addresses.add(candidate)
        except OSError:
            pass
        if not addresses:
            addresses.add("127.0.0.1")
        return sorted(addresses, key=lambda value: (value == "127.0.0.1", value))

    def create_invitation(self, *, host: str = "", expires_in_seconds: int = LOCAL_SYNC_INVITATION_SECONDS) -> dict[str, Any]:
        with self._lock:
            identity = self._load_identity(create=True)
            assert identity is not None
            if self._server is None:
                self.start_server(discovery=False)
            default_host, port = self._server_endpoint_for_record()
            advertised_host = _private_ip(host) if host else default_host
            ttl = max(60, min(1800, int(expires_in_seconds or LOCAL_SYNC_INVITATION_SECONDS)))
            invitation_id = "invite_" + secrets.token_hex(16)
            token = secrets.token_bytes(32)
            expires_at_ms = int(time.time() * 1000) + ttl * 1000
            payload = {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "invitationId": invitation_id,
                "deviceId": identity["deviceId"],
                "exchangePublicKey": identity["exchangePublicKey"],
                "host": advertised_host,
                "port": port,
                "token": _b64(token),
                "expiresAtMs": expires_at_ms,
            }
            self._invitations[invitation_id] = {
                "token": token,
                "expiresAtMs": expires_at_ms,
                "host": advertised_host,
                "port": port,
            }
            self._prune_invitations()
            return {
                "invitation": "vintrace-sync://pair/" + _b64(_canonical_json(payload)),
                "expiresAt": _utc_from_ms(expires_at_ms),
                "deviceId": identity["deviceId"],
                "host": advertised_host,
                "port": port,
            }

    def _prune_invitations(self) -> None:
        now_ms = int(time.time() * 1000)
        self._invitations = {
            key: value for key, value in self._invitations.items()
            if int(value.get("expiresAtMs", 0) or 0) > now_ms
        }

    @staticmethod
    def _parse_invitation(value: Any) -> dict[str, Any]:
        text = str(value or "").strip()
        prefix = "vintrace-sync://pair/"
        if not text.startswith(prefix):
            raise LocalSyncError("The local sync invitation is invalid.")
        try:
            payload = json.loads(_unb64(text[len(prefix):]).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalSyncError("The local sync invitation is invalid.") from exc
        if not isinstance(payload, dict) or payload.get("protocol") != LOCAL_SYNC_PROTOCOL:
            raise LocalSyncError("The local sync invitation uses an unsupported protocol.")
        invitation_id = str(payload.get("invitationId", ""))
        device_id = str(payload.get("deviceId", "")).lower()
        if not re.fullmatch(r"invite_[a-f0-9]{32}", invitation_id) or not re.fullmatch(r"[a-f0-9]{64}", device_id):
            raise LocalSyncError("The local sync invitation identity is invalid.")
        host, port = _endpoint(payload.get("host"), payload.get("port"))
        token = _unb64(payload.get("token"), expected=32)
        exchange = _b64(_unb64(payload.get("exchangePublicKey"), expected=32))
        expires = int(payload.get("expiresAtMs", 0) or 0)
        if expires <= int(time.time() * 1000) or expires > int(time.time() * 1000) + 31 * 60 * 1000:
            raise LocalSyncError("The local sync invitation has expired or has an invalid lifetime.")
        return {
            "invitationId": invitation_id,
            "deviceId": device_id,
            "host": host,
            "port": port,
            "token": token,
            "exchangePublicKey": exchange,
        }

    @staticmethod
    def _post_json(host: str, port: int, path: str, payload: dict[str, Any], *, timeout: float = 12.0) -> dict[str, Any]:
        host, port = _endpoint(host, port)
        raw = _canonical_json(payload)
        if len(raw) > LOCAL_SYNC_MAX_BODY_BYTES:
            raise LocalSyncError("The local sync request exceeds its size limit.")
        request = urllib.request.Request(
            f"http://{host}:{port}{path}",
            data=raw,
            headers={"Content-Type": "application/json", "Content-Length": str(len(raw))},
            method="POST",
        )
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        try:
            with opener.open(request, timeout=timeout) as response:
                body = response.read(LOCAL_SYNC_MAX_BODY_BYTES + 1)
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise LocalSyncError("The local sync peer could not be reached on the private network.") from exc
        if len(body) > LOCAL_SYNC_MAX_BODY_BYTES:
            raise LocalSyncError("The local sync response exceeds its size limit.")
        try:
            value = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalSyncIntegrityError("The local sync peer returned an invalid response.") from exc
        if not isinstance(value, dict):
            raise LocalSyncIntegrityError("The local sync peer returned an invalid response.")
        return value

    def accept_invitation(self, invitation: str, *, label: str = "", host: str = "") -> dict[str, Any]:
        parsed = self._parse_invitation(invitation)
        with self._lock:
            identity = self._load_identity(create=True, label=label)
            assert identity is not None
            if parsed["deviceId"] == identity["deviceId"]:
                raise LocalSyncError("A device cannot pair with itself.")
            if self._server is None:
                self.start_server(discovery=False)
            default_host, own_port = self._server_endpoint_for_record()
            own_host = _private_ip(host) if host else default_host
            key = self._pair_key(identity, parsed["exchangePublicKey"], parsed["token"], parsed["deviceId"])
            record = self._identity_public_record(identity, host=own_host, port=own_port)
            nonce = secrets.token_bytes(12)
            aad = self._aad(identity["deviceId"], parsed["deviceId"], parsed["invitationId"], "pair")
            envelope = {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "invitationId": parsed["invitationId"],
                "senderDeviceId": identity["deviceId"],
                "exchangePublicKey": identity["exchangePublicKey"],
                "nonce": _b64(nonce),
                "ciphertext": _b64(AESGCM(key).encrypt(nonce, _canonical_json(record), aad)),
            }
        response = self._post_json(parsed["host"], parsed["port"], "/pair", envelope)
        try:
            response_nonce = _unb64(response.get("nonce"), expected=12)
            plaintext = AESGCM(key).decrypt(
                response_nonce,
                _unb64(response.get("ciphertext")),
                self._aad(parsed["deviceId"], identity["deviceId"], parsed["invitationId"], "pair-response"),
            )
            peer_record = self._validate_identity_record(json.loads(plaintext.decode("utf-8")), expected_device_id=parsed["deviceId"])
        except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalSyncIntegrityError("The local sync pairing response failed authentication.") from exc
        with self._lock:
            peers = self._load_peers()
            peers[peer_record["deviceId"]] = peer_record
            self._write_peers(peers)
        return {"paired": True, "peer": self._public_peer(peer_record), "status": self.status()}

    def _handle_pair(self, envelope: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            identity = self._load_identity(create=True)
            assert identity is not None
            self._prune_invitations()
            invitation_id = str(envelope.get("invitationId", ""))
            pending = self._invitations.get(invitation_id)
            if pending is None:
                raise LocalSyncError("The local sync invitation is missing, expired, or already used.")
            sender_id = str(envelope.get("senderDeviceId", "")).lower()
            if not re.fullmatch(r"[a-f0-9]{64}", sender_id) or sender_id == identity["deviceId"]:
                raise LocalSyncIntegrityError("The local sync pairing sender is invalid.")
            key = self._pair_key(
                identity,
                str(envelope.get("exchangePublicKey", "")),
                bytes(pending["token"]),
                sender_id,
            )
            try:
                nonce = _unb64(envelope.get("nonce"), expected=12)
                plaintext = AESGCM(key).decrypt(
                    nonce,
                    _unb64(envelope.get("ciphertext")),
                    self._aad(sender_id, identity["deviceId"], invitation_id, "pair"),
                )
                peer_record = self._validate_identity_record(json.loads(plaintext.decode("utf-8")), expected_device_id=sender_id)
            except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise LocalSyncIntegrityError("The local sync pairing request failed authentication.") from exc
            if not hmac.compare_digest(peer_record["exchangePublicKey"], str(envelope.get("exchangePublicKey", ""))):
                raise LocalSyncIntegrityError("The local sync pairing exchange key changed during the handshake.")
            peers = self._load_peers()
            peers[peer_record["deviceId"]] = peer_record
            self._write_peers(peers)
            del self._invitations[invitation_id]
            own_host, own_port = _endpoint(pending.get("host"), pending.get("port"))
            response_record = self._identity_public_record(identity, host=own_host, port=own_port)
            response_nonce = secrets.token_bytes(12)
            response_aad = self._aad(identity["deviceId"], sender_id, invitation_id, "pair-response")
            return {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "nonce": _b64(response_nonce),
                "ciphertext": _b64(AESGCM(key).encrypt(response_nonce, _canonical_json(response_record), response_aad)),
            }

    def _public_peer(self, peer: dict[str, Any]) -> dict[str, Any]:
        return {
            "deviceId": peer["deviceId"],
            "label": peer["label"],
            "host": peer["host"],
            "port": peer["port"],
            "status": peer["status"],
            "pairedAt": peer["pairedAt"],
            "revokedAt": peer["revokedAt"],
            "lastSyncAt": peer["lastSyncAt"],
            "lastError": peer["lastError"],
        }

    def revoke_peer(self, device_id: str) -> dict[str, Any]:
        clean_id = str(device_id or "").lower()
        with self._lock:
            peers = self._load_peers()
            peer = peers.get(clean_id)
            if peer is None:
                raise LocalSyncError("The local sync peer was not found.")
            peer = {**peer, "status": "revoked", "revokedAt": now_iso(), "lastError": ""}
            peers[clean_id] = peer
            self._write_peers(peers)
            return {"revoked": True, "peer": self._public_peer(peer), "status": self.status()}

    def _handle_sync(self, envelope: dict[str, Any]) -> dict[str, Any]:
        identity = self._load_identity(create=True)
        assert identity is not None
        sender_id = str(envelope.get("senderDeviceId", "")).lower()
        request_id = str(envelope.get("requestId", ""))
        with self._lock:
            peers = self._load_peers()
            peer = peers.get(sender_id)
            if peer is None or peer["status"] != "active":
                raise LocalSyncError("This local sync peer is not authorized.")
        key = self._session_key(identity, peer)
        try:
            nonce = _unb64(envelope.get("nonce"), expected=12)
            plaintext = AESGCM(key).decrypt(
                nonce,
                _unb64(envelope.get("ciphertext")),
                self._aad(sender_id, identity["deviceId"], request_id, "sync"),
            )
            payload = json.loads(plaintext.decode("utf-8"))
        except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalSyncIntegrityError("The local sync request failed authentication.") from exc
        if (
            not isinstance(payload, dict)
            or payload.get("protocol") != LOCAL_SYNC_PROTOCOL
            or payload.get("type") != "sync"
            or payload.get("senderDeviceId") != sender_id
            or payload.get("receiverDeviceId") != identity["deviceId"]
            or payload.get("requestId") != request_id
        ):
            raise LocalSyncIntegrityError("The local sync request payload is invalid.")
        timestamp_ms = int(payload.get("timestampMs", 0) or 0)
        if abs(int(time.time() * 1000) - timestamp_ms) > LOCAL_SYNC_CLOCK_SKEW_MS:
            raise LocalSyncIntegrityError("The local sync request timestamp is outside the accepted window.")
        self._record_seen_request(sender_id, request_id)
        captured = self.capture_local_changes()
        known_clock = self._clean_clock(payload.get("knownClock", {}))
        merged = self.merge_operations(payload.get("operations", []), sender_device_id=sender_id)
        exported = self.export_operations(known_clock)
        with self._lock:
            peers = self._load_peers()
            current = peers.get(sender_id)
            if current is not None and current["status"] == "active":
                peers[sender_id] = {**current, "remoteClock": known_clock, "lastSyncAt": now_iso(), "lastError": ""}
                self._write_peers(peers)
        response_payload = {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "type": "sync-response",
            "senderDeviceId": identity["deviceId"],
            "receiverDeviceId": sender_id,
            "requestId": request_id,
            "timestampMs": int(time.time() * 1000),
            "clock": exported["clock"],
            "operations": exported["operations"],
            "hasMore": exported["hasMore"],
            "merge": merged,
            "capture": captured,
        }
        response_nonce = secrets.token_bytes(12)
        return {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "senderDeviceId": identity["deviceId"],
            "requestId": request_id,
            "nonce": _b64(response_nonce),
            "ciphertext": _b64(AESGCM(key).encrypt(
                response_nonce,
                _canonical_json(response_payload),
                self._aad(identity["deviceId"], sender_id, request_id, "sync-response"),
            )),
        }

    def sync_peer(self, device_id: str, *, max_rounds: int = 20) -> dict[str, Any]:
        clean_id = str(device_id or "").lower()
        identity = self._load_identity(create=True)
        assert identity is not None
        totals = {"sent": 0, "received": 0, "inserted": 0, "appliedAssets": 0, "pendingAssets": 0, "rounds": 0}
        for _ in range(max(1, min(50, int(max_rounds or 20)))):
            self.capture_local_changes()
            with self._lock:
                peers = self._load_peers()
                peer = peers.get(clean_id)
                if peer is None:
                    raise LocalSyncError("The local sync peer was not found.")
                if peer["status"] != "active":
                    raise LocalSyncError("The local sync peer has been revoked.")
            outbound = self.export_operations(peer.get("remoteClock", {}))
            request_id = "req_" + secrets.token_hex(16)
            payload = {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "type": "sync",
                "senderDeviceId": identity["deviceId"],
                "receiverDeviceId": clean_id,
                "requestId": request_id,
                "timestampMs": int(time.time() * 1000),
                "knownClock": self.clock(),
                "operations": outbound["operations"],
            }
            key = self._session_key(identity, peer)
            nonce = secrets.token_bytes(12)
            envelope = {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "senderDeviceId": identity["deviceId"],
                "requestId": request_id,
                "nonce": _b64(nonce),
                "ciphertext": _b64(AESGCM(key).encrypt(
                    nonce,
                    _canonical_json(payload),
                    self._aad(identity["deviceId"], clean_id, request_id, "sync"),
                )),
            }
            try:
                response = self._post_json(peer["host"], peer["port"], "/sync", envelope, timeout=30.0)
                response_nonce = _unb64(response.get("nonce"), expected=12)
                plaintext = AESGCM(key).decrypt(
                    response_nonce,
                    _unb64(response.get("ciphertext")),
                    self._aad(clean_id, identity["deviceId"], request_id, "sync-response"),
                )
                response_payload = json.loads(plaintext.decode("utf-8"))
            except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise LocalSyncIntegrityError("The local sync response failed authentication.") from exc
            if (
                not isinstance(response_payload, dict)
                or response_payload.get("protocol") != LOCAL_SYNC_PROTOCOL
                or response_payload.get("type") != "sync-response"
                or response_payload.get("senderDeviceId") != clean_id
                or response_payload.get("receiverDeviceId") != identity["deviceId"]
                or response_payload.get("requestId") != request_id
            ):
                raise LocalSyncIntegrityError("The local sync response payload is invalid.")
            response_clock = self._clean_clock(response_payload.get("clock", {}))
            merge = self.merge_operations(response_payload.get("operations", []), sender_device_id=clean_id)
            with self._lock:
                peers = self._load_peers()
                current = peers.get(clean_id)
                if current is None or current["status"] != "active":
                    raise LocalSyncError("The local sync peer was revoked while syncing.")
                peers[clean_id] = {
                    **current,
                    "remoteClock": response_clock,
                    "lastSyncAt": now_iso(),
                    "lastError": "",
                }
                self._write_peers(peers)
            totals["rounds"] += 1
            totals["sent"] += len(outbound["operations"])
            totals["received"] += int(merge["received"])
            totals["inserted"] += int(merge["inserted"])
            totals["appliedAssets"] += int(merge["appliedAssets"])
            totals["pendingAssets"] += int(merge["pendingAssets"])
            if not outbound["hasMore"] and not response_payload.get("hasMore"):
                break
        else:
            raise LocalSyncError("Local sync exceeded its bounded paging limit; run sync again to continue.")
        return {"ok": True, "peerDeviceId": clean_id, **totals, "status": self.status()}

    def _handler_class(self) -> type[BaseHTTPRequestHandler]:
        manager = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "VintraceLocalSync/1"
            sys_version = ""

            def log_message(self, _format: str, *_args: Any) -> None:
                return

            def _reply(self, status: int, payload: dict[str, Any]) -> None:
                body = _canonical_json(payload)
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self) -> None:  # noqa: N802
                if self.path == "/health":
                    self._reply(200, {"ok": True, "protocol": LOCAL_SYNC_PROTOCOL})
                else:
                    self._reply(404, {"ok": False})

            def do_POST(self) -> None:  # noqa: N802
                try:
                    length = int(self.headers.get("Content-Length", "0") or 0)
                except ValueError:
                    length = 0
                if length < 2 or length > LOCAL_SYNC_MAX_BODY_BYTES:
                    self._reply(413, {"ok": False, "error": "request-size"})
                    return
                try:
                    raw = self.rfile.read(length)
                    payload = json.loads(raw.decode("utf-8"))
                    if not isinstance(payload, dict):
                        raise ValueError("payload")
                    if self.path == "/pair":
                        response = manager._handle_pair(payload)
                    elif self.path == "/sync":
                        response = manager._handle_sync(payload)
                    else:
                        self._reply(404, {"ok": False})
                        return
                    self._reply(200, response)
                except LocalSyncIntegrityError:
                    self._reply(400, {"ok": False, "error": "authentication"})
                except (LocalSyncError, WorkspaceEncryptionError):
                    self._reply(403, {"ok": False, "error": "not-authorized"})
                except Exception:
                    self._reply(500, {"ok": False, "error": "internal"})

        return Handler

    def start_server(self, *, port: int = 0, discovery: bool = True) -> dict[str, Any]:
        with self._lock:
            self._require_encryption()
            self._load_identity(create=True)
            if self._server is None:
                clean_port = max(0, min(65535, int(port or 0)))
                try:
                    self._server = _SyncHttpServer(("0.0.0.0", clean_port), self._handler_class())
                except OSError as exc:
                    raise LocalSyncError("The encrypted local sync listener could not start on this device.") from exc
                self._server_thread = threading.Thread(
                    target=self._server.serve_forever,
                    name="vintrace-local-sync",
                    daemon=True,
                )
                self._server_thread.start()
            if discovery:
                self._start_discovery()
            return self.status()

    def stop_server(self) -> dict[str, Any]:
        with self._lock:
            self._stop_discovery()
            server = self._server
            self._server = None
            thread = self._server_thread
            self._server_thread = None
        if server is not None:
            server.shutdown()
            server.server_close()
        if thread is not None:
            thread.join(timeout=3)
        return self.status()

    def _start_discovery(self) -> None:
        if self._zeroconf is not None or self._server is None:
            return
        try:
            from zeroconf import ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf

            identity = self._load_identity(create=True)
            assert identity is not None
            addresses = [socket.inet_aton(value) for value in self._advertised_addresses()]
            port = int(self._server.server_address[1])
            beacon = {
                "protocol": LOCAL_SYNC_PROTOCOL,
                "deviceId": identity["deviceId"],
                "signingPublicKey": identity["signingPublicKey"],
                "exchangePublicKey": identity["exchangePublicKey"],
                "port": port,
                "nonce": _b64(secrets.token_bytes(12)),
            }
            signing, _ = self._identity_keys(identity)
            beacon["signature"] = _b64(signing.sign(_canonical_json(beacon)))
            properties = {key.encode("ascii"): str(value).encode("ascii") for key, value in beacon.items()}
            info = ServiceInfo(
                LOCAL_SYNC_SERVICE_TYPE,
                f"{identity['deviceId'][:20]}.{LOCAL_SYNC_SERVICE_TYPE}",
                addresses=addresses,
                port=port,
                properties=properties,
                server=f"{identity['deviceId'][:20]}.local.",
            )
            manager = self

            class Listener(ServiceListener):
                def add_service(self, zc: Any, type_: str, name: str) -> None:
                    manager._receive_service_info(zc.get_service_info(type_, name, timeout=2000))

                def update_service(self, zc: Any, type_: str, name: str) -> None:
                    manager._receive_service_info(zc.get_service_info(type_, name, timeout=2000))

                def remove_service(self, _zc: Any, _type: str, name: str) -> None:
                    manager._remove_service(name)

            zeroconf = Zeroconf()
            zeroconf.register_service(info)
            browser = ServiceBrowser(zeroconf, LOCAL_SYNC_SERVICE_TYPE, Listener())
            self._zeroconf = zeroconf
            self._service_info = info
            self._service_browser = browser
            self._discovery_error = ""
        except Exception as exc:
            self._discovery_error = re.sub(r"\s+", " ", str(exc)).strip()[:240] or "Bonjour discovery is unavailable."
            self._stop_discovery()

    def _receive_service_info(self, info: Any) -> None:
        if info is None:
            return
        try:
            properties = {
                (key.decode("ascii") if isinstance(key, bytes) else str(key)):
                (value.decode("ascii") if isinstance(value, bytes) else str(value))
                for key, value in dict(info.properties or {}).items()
            }
            signed = {key: properties[key] if key != "port" else int(properties[key]) for key in (
                "protocol", "deviceId", "signingPublicKey", "exchangePublicKey", "port", "nonce"
            )}
            if signed["protocol"] != LOCAL_SYNC_PROTOCOL:
                return
            signing_public = _unb64(signed["signingPublicKey"], expected=32)
            device_id = _device_id(signing_public)
            if device_id != signed["deviceId"]:
                return
            ed25519.Ed25519PublicKey.from_public_bytes(signing_public).verify(
                _unb64(properties.get("signature"), expected=64), _canonical_json(signed)
            )
            identity = self._load_identity(create=False)
            if identity is not None and device_id == identity["deviceId"]:
                return
            addresses = [value for value in info.parsed_addresses() if value]
            host = ""
            for value in addresses:
                try:
                    host = _private_ip(value)
                    break
                except LocalSyncError:
                    continue
            if not host:
                return
            host, port = _endpoint(host, signed["port"])
            with self._lock:
                peers = self._load_peers()
                paired = peers.get(device_id)
                if paired and paired["status"] == "active" and (paired["host"], paired["port"]) != (host, port):
                    peers[device_id] = {**paired, "host": host, "port": port, "lastError": ""}
                    self._write_peers(peers)
                    paired = peers[device_id]
                self._discovered[device_id] = {
                    "deviceId": device_id,
                    "host": host,
                    "port": port,
                    "paired": bool(paired and paired["status"] == "active"),
                    "lastSeenAt": now_iso(),
                    "serviceName": str(info.name or ""),
                }
        except (ValueError, LocalSyncError, LocalSyncIntegrityError, InvalidSignature):
            return

    def _remove_service(self, name: str) -> None:
        for device_id, row in list(self._discovered.items()):
            if row.get("serviceName") == name:
                del self._discovered[device_id]

    def _stop_discovery(self) -> None:
        zeroconf = self._zeroconf
        info = self._service_info
        self._service_browser = None
        self._service_info = None
        self._zeroconf = None
        if zeroconf is not None:
            try:
                if info is not None:
                    zeroconf.unregister_service(info)
            except Exception:
                pass
            try:
                zeroconf.close()
            except Exception:
                pass

    def export_recovery_bundle(self, passphrase: str) -> str:
        if len(str(passphrase or "")) < 12:
            raise LocalSyncError("A local sync recovery passphrase must contain at least 12 characters.")
        with self._lock:
            identity = self._load_identity(create=True)
            assert identity is not None
            peers = self._load_peers()
            payload = {
                "schemaVersion": 1,
                "protocol": LOCAL_SYNC_PROTOCOL,
                "createdAt": now_iso(),
                "identity": identity,
                "peers": sorted(peers.values(), key=lambda item: item["deviceId"]),
                "scope": "device-identity-and-peer-roster-only",
            }
            return "vtrecovery1:" + _b64(encrypt_bytes(_canonical_json(payload), passphrase))

    def restore_recovery_bundle(self, bundle: str, passphrase: str, *, confirm: bool = False) -> dict[str, Any]:
        if not confirm:
            raise LocalSyncError("Restoring local sync identity requires explicit confirmation.")
        text = str(bundle or "").strip()
        if not text.startswith("vtrecovery1:"):
            raise LocalSyncError("The local sync recovery bundle is invalid.")
        self._require_encryption()
        try:
            payload = json.loads(decrypt_bytes(_unb64(text.split(":", 1)[1]), passphrase).decode("utf-8"))
        except (DecryptionError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise LocalSyncIntegrityError("The local sync recovery bundle failed authentication.") from exc
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or payload.get("protocol") != LOCAL_SYNC_PROTOCOL:
            raise LocalSyncIntegrityError("The local sync recovery bundle has an invalid schema.")
        identity = self._validate_identity(payload.get("identity"))
        raw_peers = payload.get("peers", [])
        if not isinstance(raw_peers, list):
            raise LocalSyncIntegrityError("The local sync recovery peer roster is invalid.")
        peers = {peer["deviceId"]: peer for peer in (self._validate_peer(value) for value in raw_peers)}
        if len(peers) != len(raw_peers) or len(peers) > 64:
            raise LocalSyncIntegrityError("The local sync recovery peer roster contains duplicates or exceeds its limit.")
        self.stop_server()
        with self._lock:
            self._ensure_root()
            self._write_identity(identity)
            self._write_peers(peers)
        return {"restored": True, "deviceId": identity["deviceId"], "peerCount": len(peers), "status": self.status()}

    def conflicts(self, *, limit: int = 25) -> dict[str, Any]:
        clean_limit = max(1, min(200, int(limit or 25)))
        with self.db.connect() as conn:
            rows = conn.execute(
                """
                SELECT conflict_id, entity_type, entity_key, field_name,
                    winner_operation_id, loser_operation_id, resolution, resolved_at
                FROM photo_sync_conflicts
                ORDER BY resolved_at DESC, conflict_id DESC
                LIMIT ?
                """,
                (clean_limit,),
            ).fetchall()
            total = int(conn.execute("SELECT COUNT(*) FROM photo_sync_conflicts").fetchone()[0])
        return {
            "total": total,
            "conflicts": [
                {
                    "conflictId": str(row["conflict_id"]),
                    "entityType": str(row["entity_type"]),
                    "contentHashPrefix": str(row["entity_key"])[:12],
                    "field": str(row["field_name"]),
                    "winnerOperationId": str(row["winner_operation_id"]),
                    "loserOperationId": str(row["loser_operation_id"]),
                    "resolution": str(row["resolution"]),
                    "resolvedAt": str(row["resolved_at"]),
                }
                for row in rows
            ],
        }

    def status(self) -> dict[str, Any]:
        encryption_ready = bool(self.encryption.enabled)
        identity: dict[str, Any] | None = None
        peers: dict[str, dict[str, Any]] = {}
        error = ""
        if encryption_ready:
            try:
                identity = self._load_identity(create=False)
                peers = self._load_peers()
            except (LocalSyncError, WorkspaceEncryptionError) as exc:
                error = str(exc)
        with self.db.connect() as conn:
            counts = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM photo_sync_operations) AS operations,
                    (SELECT COUNT(*) FROM photo_sync_registers) AS registers,
                    (SELECT COUNT(*) FROM photo_sync_dirty) AS dirty,
                    (SELECT COUNT(*) FROM photo_sync_conflicts) AS conflicts,
                    (SELECT COUNT(*) FROM photo_assets WHERE COALESCE(content_hash, '') = '') AS assets_without_hash,
                    (SELECT COUNT(DISTINCT r.entity_key)
                     FROM photo_sync_registers AS r
                     LEFT JOIN photo_assets AS a ON LOWER(a.content_hash) = r.entity_key
                     WHERE a.asset_id IS NULL) AS pending_assets
                """
            ).fetchone()
        self._prune_invitations()
        server = self._server
        return {
            "protocol": LOCAL_SYNC_PROTOCOL,
            "available": encryption_ready and not error,
            "initialized": identity is not None,
            "deviceId": str(identity.get("deviceId", "") if identity else ""),
            "deviceLabel": str(identity.get("label", "") if identity else ""),
            "encryptionRequired": True,
            "encryptionReady": encryption_ready,
            "server": {
                "running": server is not None,
                "port": int(server.server_address[1]) if server is not None else 0,
                "addresses": self._advertised_addresses() if server is not None else [],
                "discoveryEnabled": self._zeroconf is not None,
                "discoveryError": self._discovery_error,
            },
            "discoveryRuntime": local_sync_runtime_report(),
            "peers": [self._public_peer(peer) for peer in sorted(peers.values(), key=lambda item: item["pairedAt"], reverse=True)],
            "discoveredPeers": [
                {key: row[key] for key in ("deviceId", "host", "port", "paired", "lastSeenAt")}
                for row in sorted(self._discovered.values(), key=lambda item: item["lastSeenAt"], reverse=True)[:32]
            ],
            "pendingInvitationCount": len(self._invitations),
            "counts": {
                "operations": int(counts["operations"] or 0),
                "registers": int(counts["registers"] or 0),
                "dirty": int(counts["dirty"] or 0),
                "conflicts": int(counts["conflicts"] or 0),
                "assetsWithoutContentHash": int(counts["assets_without_hash"] or 0),
                "pendingAssets": int(counts["pending_assets"] or 0),
            },
            "privacy": {
                "transport": "X25519 + HKDF-SHA256 + AES-256-GCM",
                "operationAuthentication": "Ed25519",
                "stateAtRest": "SQLCipher + workspace AES-256-GCM",
                "internetService": False,
                "mediaTransfer": False,
                "biometricTransfer": False,
                "generatedModelDataTransfer": False,
                "discoveryAdvertisesLibraryMetadata": False,
            },
            "scope": {
                "assetIdentity": "SHA-256 content hash",
                "fields": list(LOCAL_SYNC_FIELDS),
                "missingMedia": "metadata remains pending until the same original is present locally",
                "remoteDeletion": "Recently Deleted metadata only; local originals are never erased by a peer",
            },
            "recovery": {
                "bundleScope": "device identity and peer roster",
                "catalogRecovery": "Use an encrypted workspace backup for operations and conflict history",
            },
            "reason": error or ("Workspace encryption must be enabled before local sync." if not encryption_ready else ""),
        }

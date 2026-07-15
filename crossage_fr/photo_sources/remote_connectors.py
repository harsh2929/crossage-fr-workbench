from __future__ import annotations

from contextlib import AbstractContextManager
from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from io import BytesIO
import ipaddress
import json
import mimetypes
from pathlib import Path
import re
import socket
import time
from typing import Any, Callable, Iterable, Iterator
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET
from urllib.robotparser import RobotFileParser

from PIL import Image as PilImage

from .contracts import (
    NormalizedAlbum,
    NormalizedPhotoAsset,
    PhotoSourceLibrary,
    PhotoSourcePreview,
    PhotoSourceScopes,
    clean_strings,
)


SLACK_PROVIDER = "slack"
WEB_PROVIDER = "web"
GOOGLE_DRIVE_PROVIDER = "google_drive"
ONEDRIVE_PROVIDER = "onedrive"
DROPBOX_PROVIDER = "dropbox"
WEBDAV_PROVIDER = "webdav"

REMOTE_PHOTO_SOURCE_PROVIDERS = {
    SLACK_PROVIDER,
    WEB_PROVIDER,
    GOOGLE_DRIVE_PROVIDER,
    ONEDRIVE_PROVIDER,
    DROPBOX_PROVIDER,
    WEBDAV_PROVIDER,
}

REMOTE_PROVIDER_ALIASES = {
    "slack-files": SLACK_PROVIDER,
    "website": WEB_PROVIDER,
    "browser": WEB_PROVIDER,
    "web-browsing": WEB_PROVIDER,
    "google-drive": GOOGLE_DRIVE_PROVIDER,
    "drive": GOOGLE_DRIVE_PROVIDER,
    "microsoft-onedrive": ONEDRIVE_PROVIDER,
    "one-drive": ONEDRIVE_PROVIDER,
    "drop-box": DROPBOX_PROVIDER,
    "web-dav": WEBDAV_PROVIDER,
}

REMOTE_PROVIDER_LABELS = {
    SLACK_PROVIDER: "Slack",
    WEB_PROVIDER: "Web pages",
    GOOGLE_DRIVE_PROVIDER: "Google Drive",
    ONEDRIVE_PROVIDER: "OneDrive",
    DROPBOX_PROVIDER: "Dropbox",
    WEBDAV_PROVIDER: "WebDAV",
}

REMOTE_CAPABILITIES = {
    "incrementalSync": True,
    "managedImport": True,
    "referencedImport": False,
    "metadataPreview": True,
    "selectiveImport": True,
    "remoteDownload": True,
    "albumsFolders": True,
    "keywords": True,
    "favorites": True,
    "peopleFaces": False,
    "preciseLocation": False,
    "hidden": False,
    "deleted": True,
    "shared": True,
    "commentsLikes": False,
}

CONNECTOR_PUBLIC_CONFIG_KEYS = (
    "connectionId",
    "displayName",
    "urls",
    "baseUrl",
    "channelIds",
    "teamId",
    "folderId",
    "folderPath",
    "recursive",
    "includeVideos",
    "maxItems",
    "maxPages",
    "maxDownloadBytes",
    "respectRobots",
)

IMAGE_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png",
    ".tif", ".tiff", ".webp",
}
VIDEO_EXTENSIONS = {
    ".3gp", ".avi", ".m4v", ".mkv", ".mov", ".mp4", ".mpeg", ".mpg", ".webm",
}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS
MAX_DISCOVERY_ITEMS = 10_000
MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024
DEFAULT_DOWNLOAD_BYTES = 128 * 1024 * 1024
MAX_RESPONSE_BYTES = 16 * 1024 * 1024


class ConnectorNetworkError(RuntimeError):
    pass


class ConnectorCredentialError(ValueError):
    pass


def normalize_remote_provider(value: Any) -> str:
    provider = str(value or "").strip().lower().replace(" ", "_")
    provider = REMOTE_PROVIDER_ALIASES.get(provider, provider)
    if provider not in REMOTE_PHOTO_SOURCE_PROVIDERS:
        raise ValueError("Unknown inbound connector provider.")
    return provider


def connector_library_id(provider: str, connection_id: str) -> str:
    token = f"{normalize_remote_provider(provider)}\n{str(connection_id or '').strip()}"
    return f"remote_{sha256(token.encode('utf-8')).hexdigest()[:32]}"


def connector_uri(provider: str, connection_id: str) -> str:
    clean_provider = normalize_remote_provider(provider)
    clean_id = re.sub(r"[^A-Za-z0-9._-]+", "-", str(connection_id or "").strip())[:96]
    if not clean_id:
        raise ValueError("connectionId is required.")
    return f"connector://{clean_provider}/{clean_id}"


def _filename(value: Any, fallback: str = "remote-media") -> str:
    raw = str(value or "").replace("\\", "/").rsplit("/", 1)[-1]
    clean = re.sub(r"[^A-Za-z0-9._ -]+", "_", raw).strip(" .")[:180]
    return clean or fallback


def _iso_timestamp(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return raw[:80]
    return datetime.fromtimestamp(number, tz=timezone.utc).isoformat()


def _media_kind(mime_type: str, filename: str) -> str:
    mime = str(mime_type or "").lower()
    if mime.startswith("video/") or Path(filename).suffix.lower() in VIDEO_EXTENSIONS:
        return "video"
    return "image"


def _supported_media(mime_type: str, filename: str) -> bool:
    mime = str(mime_type or "").split(";", 1)[0].strip().lower()
    return mime.startswith(("image/", "video/")) or Path(filename).suffix.lower() in MEDIA_EXTENSIONS


def _public_ip(address: str) -> bool:
    try:
        value = ipaddress.ip_address(address)
    except ValueError:
        return False
    return not (
        value.is_private
        or value.is_loopback
        or value.is_link_local
        or value.is_multicast
        or value.is_reserved
        or value.is_unspecified
    )


def validate_remote_url(
    value: Any,
    *,
    allow_private_test: bool = False,
    allowed_hosts: Iterable[str] | None = None,
    resolve_dns: bool = True,
) -> str:
    raw = str(value or "").strip()
    parsed = urlparse(raw)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ConnectorNetworkError("Connector URLs must use HTTP or HTTPS.")
    if parsed.username or parsed.password:
        raise ConnectorNetworkError("Connector URLs cannot contain credentials.")
    host = str(parsed.hostname or "").strip().rstrip(".").lower()
    if not host:
        raise ConnectorNetworkError("Connector URL hostname is required.")
    if parsed.port is not None and parsed.port not in {80, 443} and not allow_private_test:
        raise ConnectorNetworkError("Connector URLs may use only standard HTTP ports.")
    if allowed_hosts:
        allowed = [str(item or "").strip().lower().lstrip(".") for item in allowed_hosts]
        if not any(host == item or host.endswith(f".{item}") for item in allowed if item):
            raise ConnectorNetworkError("The connector attempted to contact an unexpected host.")
    if not allow_private_test:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            if not _public_ip(host):
                raise ConnectorNetworkError("Private, loopback, and reserved network destinations are blocked.")
        if resolve_dns:
            try:
                addresses = {row[4][0] for row in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)}
            except OSError as exc:
                raise ConnectorNetworkError("Connector hostname could not be resolved.") from exc
            if not addresses or any(not _public_ip(address) for address in addresses):
                raise ConnectorNetworkError("Connector hostname resolves to a blocked network destination.")
    normalized = parsed._replace(fragment="")
    return urlunparse(normalized)


@dataclass
class HttpResponse:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str

    def json(self) -> dict[str, Any]:
        try:
            payload = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ConnectorNetworkError("Connector returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise ConnectorNetworkError("Connector returned an unexpected JSON payload.")
        return payload


Transport = Callable[..., HttpResponse]


class _ValidatingRedirectHandler(HTTPRedirectHandler):
    def __init__(self, validator: Callable[[str], str]):
        super().__init__()
        self.validator = validator

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        self.validator(str(newurl or ""))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SafeHttpTransport:
    def __init__(self, *, allow_private_test: bool = False, timeout_seconds: float = 20.0):
        self.allow_private_test = bool(allow_private_test)
        self.timeout_seconds = max(1.0, min(120.0, float(timeout_seconds)))

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        body: bytes | None = None,
        max_bytes: int = MAX_RESPONSE_BYTES,
        allowed_hosts: Iterable[str] | None = None,
    ) -> HttpResponse:
        clean_url = validate_remote_url(
            url,
            allow_private_test=self.allow_private_test,
            allowed_hosts=allowed_hosts,
        )
        validator = lambda candidate: validate_remote_url(  # noqa: E731
            candidate,
            allow_private_test=self.allow_private_test,
            allowed_hosts=allowed_hosts,
        )
        opener = build_opener(_ValidatingRedirectHandler(validator))
        request = Request(
            clean_url,
            data=body,
            headers={str(key): str(value) for key, value in (headers or {}).items()},
            method=str(method or "GET").upper(),
        )
        try:
            with opener.open(request, timeout=self.timeout_seconds) as response:
                limit = max(1, min(MAX_DOWNLOAD_BYTES, int(max_bytes or MAX_RESPONSE_BYTES)))
                declared_length = str(response.headers.get("Content-Length", "") or "").strip()
                try:
                    if declared_length and int(declared_length) > limit:
                        raise ConnectorNetworkError("Connector response exceeded the configured size limit.")
                except ValueError:
                    pass
                if not self.allow_private_test:
                    peer = _response_peer_ip(response)
                    if peer and not _public_ip(peer):
                        raise ConnectorNetworkError("Connector response came from a blocked network destination.")
                chunks: list[bytes] = []
                size = 0
                while True:
                    chunk = response.read(min(64 * 1024, limit + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > limit:
                        raise ConnectorNetworkError("Connector response exceeded the configured size limit.")
                return HttpResponse(
                    status=int(getattr(response, "status", 200) or 200),
                    headers={str(key).lower(): str(value) for key, value in response.headers.items()},
                    body=b"".join(chunks),
                    url=str(response.geturl() or clean_url),
                )
        except HTTPError as exc:
            retry_after = str(exc.headers.get("Retry-After", "") or "") if exc.headers else ""
            suffix = f" Retry after {retry_after} seconds." if retry_after else ""
            raise ConnectorNetworkError(f"Connector request failed with HTTP {exc.code}.{suffix}") from exc
        except URLError as exc:
            raise ConnectorNetworkError("Connector request could not reach the remote service.") from exc


def _response_peer_ip(response: Any) -> str:
    """Best-effort peer validation closes the common DNS-rebinding window."""
    candidates = [response]
    seen: set[int] = set()
    for _depth in range(6):
        next_candidates = []
        for candidate in candidates:
            if candidate is None or id(candidate) in seen:
                continue
            seen.add(id(candidate))
            for attribute in ("fp", "raw", "_sock", "sock", "_connection"):
                child = getattr(candidate, attribute, None)
                if child is not None:
                    next_candidates.append(child)
            getpeername = getattr(candidate, "getpeername", None)
            if callable(getpeername):
                try:
                    peer = getpeername()
                except OSError:
                    continue
                if isinstance(peer, tuple) and peer:
                    return str(peer[0] or "")
        candidates = next_candidates
    return ""


@dataclass
class RemoteMediaRecord:
    external_id: str
    filename: str
    mime_type: str
    download_url: str
    download_headers: dict[str, str] = field(default_factory=dict)
    title: str = ""
    caption: str = ""
    modified_at: str = ""
    created_at: str = ""
    width: int | None = None
    height: int | None = None
    size: int | None = None
    favorite: bool = False
    deleted: bool = False
    shared: bool = False
    albums: list[NormalizedAlbum] = field(default_factory=list)
    keywords: list[str] = field(default_factory=list)
    comments: list[dict[str, Any]] = field(default_factory=list)
    likes: list[dict[str, Any]] = field(default_factory=list)
    provenance: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


class _PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[dict[str, str]] = []
        self.links: list[str] = []
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {str(key).lower(): str(value or "") for key, value in attrs}
        lower = tag.lower()
        if lower == "title":
            self._in_title = True
        if lower == "img":
            src = values.get("src") or values.get("data-src") or values.get("data-original")
            if src:
                self.images.append({"url": src, "alt": values.get("alt", ""), "title": values.get("title", "")})
            srcset = values.get("srcset", "")
            if srcset:
                candidates = [part.strip().split(" ", 1)[0] for part in srcset.split(",") if part.strip()]
                if candidates:
                    self.images.append({"url": candidates[-1], "alt": values.get("alt", ""), "title": values.get("title", "")})
        elif lower in {"video", "source"}:
            src = values.get("src")
            declared_type = values.get("type", "").lower()
            if src and (lower == "video" or declared_type.startswith("video/") or Path(urlparse(src).path).suffix.lower() in VIDEO_EXTENSIONS):
                self.images.append({"url": src, "alt": "", "title": values.get("title", "")})
        elif lower == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key in {"og:image", "og:image:url", "twitter:image", "twitter:image:src"} and values.get("content"):
                self.images.append({"url": values["content"], "alt": "", "title": key})
        elif lower == "a" and values.get("href"):
            self.links.append(values["href"])

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title = f"{self.title} {data}".strip()[:300]


def _json_api(
    transport: Transport,
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    body: dict[str, Any] | None = None,
    allowed_hosts: Iterable[str] | None = None,
) -> dict[str, Any]:
    payload = json.dumps(body, separators=(",", ":")).encode("utf-8") if body is not None else None
    final_headers = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        final_headers["Content-Type"] = "application/json; charset=utf-8"
    response = transport(
        method,
        url,
        headers=final_headers,
        body=payload,
        max_bytes=MAX_RESPONSE_BYTES,
        allowed_hosts=allowed_hosts,
    )
    return response.json()


class RemoteConnectorAdapter:
    def __init__(
        self,
        provider: str,
        *,
        transport: Transport | None = None,
        allow_private_test: bool = False,
    ) -> None:
        self.provider = normalize_remote_provider(provider)
        safe_transport = SafeHttpTransport(allow_private_test=allow_private_test)
        self.transport = transport or safe_transport.request
        self.allow_private_test = bool(allow_private_test)
        self._connections: dict[str, dict[str, Any]] = {}
        self._records: dict[str, dict[str, RemoteMediaRecord]] = {}
        self._robots: dict[str, RobotFileParser | None] = {}
        self._last_discovery_complete: dict[str, bool] = {}

    @staticmethod
    def _within_budget(config: dict[str, Any]) -> bool:
        deadline = float(config.get("_deadlineMonotonic", 0.0) or 0.0)
        return not deadline or time.monotonic() < deadline

    def status(self) -> dict[str, Any]:
        requires_credential = self.provider not in {WEB_PROVIDER}
        return {
            "provider": self.provider,
            "supported": True,
            "available": True,
            "configured": len(self._connections),
            "requiresCredential": requires_credential,
            "readOnly": True,
            "networkAccess": "explicit-read-only",
            "capabilities": {**REMOTE_CAPABILITIES, "commentsLikes": self.provider == SLACK_PROVIDER},
            "error": "",
            "warnings": [],
        }

    def _credential(self, params: dict[str, Any]) -> dict[str, str]:
        nested = params.get("credential") if isinstance(params.get("credential"), dict) else {}
        return {
            "accessToken": str(nested.get("accessToken", params.get("accessToken", params.get("token", ""))) or "").strip(),
            "username": str(nested.get("username", params.get("username", "")) or "").strip(),
            "password": str(nested.get("password", params.get("password", "")) or ""),
        }

    def public_configuration(self, connection_id: str) -> dict[str, Any]:
        config = self._connections.get(self._connection_id(connection_id), {})
        return {
            key: config[key]
            for key in CONNECTOR_PUBLIC_CONFIG_KEYS
            if key in config
        }

    def connection_credential(self, connection_id: str) -> dict[str, str]:
        config = self._connections.get(self._connection_id(connection_id), {})
        credential = config.get("credential") if isinstance(config.get("credential"), dict) else {}
        return {
            key: value
            for key, value in self._credential({"credential": credential}).items()
            if value
        }

    def configure(self, params: dict[str, Any]) -> PhotoSourceLibrary:
        body = dict(params if isinstance(params, dict) else {})
        connection_id = str(body.get("connectionId", body.get("connectorId", "")) or "").strip()
        if not connection_id:
            seed = str(body.get("displayName", body.get("name", "")) or "").strip() or self.provider
            connection_id = f"{self.provider}-{sha256(seed.encode('utf-8')).hexdigest()[:12]}"
        display_name = " ".join(str(body.get("displayName", body.get("name", "")) or "").split()).strip()[:120]
        display_name = display_name or REMOTE_PROVIDER_LABELS[self.provider]
        credential = self._credential(body)
        if self.provider not in {WEB_PROVIDER} and not credential["accessToken"] and not (
            self.provider == WEBDAV_PROVIDER and credential["username"] and credential["password"]
        ):
            existing = self._connections.get(connection_id, {})
            existing_credential = existing.get("credential") if isinstance(existing.get("credential"), dict) else {}
            if not existing_credential:
                raise ConnectorCredentialError(f"{REMOTE_PROVIDER_LABELS[self.provider]} credentials are required.")
            credential = dict(existing_credential)
        urls = clean_strings(body.get("urls", body.get("url", [])), limit=100, max_length=2_000)
        if self.provider == WEB_PROVIDER and not urls:
            raise ValueError("At least one web page or media URL is required.")
        base_url = str(body.get("baseUrl", "") or "").strip()
        if self.provider == WEBDAV_PROVIDER and not base_url:
            raise ValueError("A WebDAV base URL is required.")
        config = {
            "connectionId": connection_id,
            "displayName": display_name,
            "credential": credential,
            "urls": urls,
            "baseUrl": base_url,
            "channelIds": clean_strings(body.get("channelIds", body.get("channels", [])), limit=100, max_length=80),
            "teamId": str(body.get("teamId", "") or "").strip()[:80],
            "folderId": str(body.get("folderId", body.get("rootId", "root")) or "root").strip()[:300],
            "folderPath": str(body.get("folderPath", body.get("path", "")) or "").strip()[:2_000],
            "recursive": bool(body.get("recursive", True)),
            "includeVideos": bool(body.get("includeVideos", True)),
            "maxItems": max(1, min(MAX_DISCOVERY_ITEMS, int(body.get("maxItems", 1_000) or 1_000))),
            "maxPages": max(1, min(50, int(body.get("maxPages", 5) or 5))),
            "maxDownloadBytes": max(1, min(MAX_DOWNLOAD_BYTES, int(body.get("maxDownloadBytes", DEFAULT_DOWNLOAD_BYTES) or DEFAULT_DOWNLOAD_BYTES))),
            "respectRobots": bool(body.get("respectRobots", True)),
        }
        self._connections[connection_id] = config
        path = connector_uri(self.provider, connection_id)
        public_config = {
            key: config[key]
            for key in CONNECTOR_PUBLIC_CONFIG_KEYS
            if key in config
        }
        return PhotoSourceLibrary(
            provider=self.provider,
            library_id=connector_library_id(self.provider, connection_id),
            path=path,
            name=display_name,
            available=True,
            status="ready",
            metadata={
                "connector": True,
                "connectionId": connection_id,
                "remote": True,
                "readOnly": True,
                "configured": True,
                "connectorConfig": public_config,
            },
        )

    def _connection_id(self, library_path: str) -> str:
        parsed = urlparse(str(library_path or ""))
        if parsed.scheme == "connector" and parsed.netloc == self.provider:
            return parsed.path.strip("/")
        return str(library_path or "").strip()

    def describe_library(self, library_path: str) -> PhotoSourceLibrary:
        connection_id = self._connection_id(library_path)
        config = self._connections.get(connection_id)
        if not config:
            raise ConnectorCredentialError("Reconnect this inbound source before continuing.")
        return self.configure({**config, "credential": config.get("credential", {})})

    def discover_libraries(self) -> list[PhotoSourceLibrary]:
        return [self.describe_library(connection_id) for connection_id in sorted(self._connections)]

    def forget(self, connection_id: str) -> bool:
        clean_id = self._connection_id(connection_id)
        existed = clean_id in self._connections
        config = self._connections.pop(clean_id, None)
        if isinstance(config, dict):
            credential = config.get("credential")
            if isinstance(credential, dict):
                credential.clear()
            config.clear()
        self._records.pop(clean_id, None)
        return existed

    def open_library(self, library_path: str) -> "RemoteConnectorLibrary":
        return RemoteConnectorLibrary(self, library_path)

    def _auth_headers(self, config: dict[str, Any]) -> dict[str, str]:
        credential = config.get("credential") if isinstance(config.get("credential"), dict) else {}
        token = str(credential.get("accessToken", "") or "")
        return {"Authorization": f"Bearer {token}"} if token else {}

    def _slack_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        headers = self._auth_headers(config)
        records: list[RemoteMediaRecord] = []
        channels = config.get("channelIds") or [""]
        for channel in channels:
            if not self._within_budget(config):
                break
            page = 1
            while len(records) < config["maxItems"] and page <= config["maxPages"] and self._within_budget(config):
                query = {"count": min(1_000, config["maxItems"] - len(records)), "page": page}
                if not config["includeVideos"]:
                    query["types"] = "images"
                if channel:
                    query["channel"] = channel
                if config.get("teamId"):
                    query["team_id"] = config["teamId"]
                payload = _json_api(
                    self.transport,
                    "GET",
                    f"https://slack.com/api/files.list?{urlencode(query)}",
                    headers=headers,
                    allowed_hosts=["slack.com"],
                )
                if not payload.get("ok"):
                    raise ConnectorNetworkError(f"Slack rejected the request: {str(payload.get('error') or 'unknown_error')[:100]}.")
                files = payload.get("files") if isinstance(payload.get("files"), list) else []
                for row in files:
                    if not isinstance(row, dict):
                        continue
                    name = _filename(row.get("name", row.get("title", "")), f"slack-{row.get('id', 'file')}")
                    mime = str(row.get("mimetype", "") or "")
                    if not _supported_media(mime, name) or (not config["includeVideos"] and _media_kind(mime, name) == "video"):
                        continue
                    external_id = str(row.get("id", "") or "").strip()
                    download_url = str(row.get("url_private_download", row.get("url_private", "")) or "").strip()
                    if not external_id or not download_url:
                        continue
                    channel_ids = clean_strings((row.get("channels") or []) + (row.get("groups") or []) + (row.get("ims") or []), limit=100, max_length=80)
                    albums = [NormalizedAlbum(album_id=f"slack-channel-{cid}", name=f"Slack {cid}") for cid in channel_ids]
                    records.append(RemoteMediaRecord(
                        external_id=external_id,
                        filename=name,
                        mime_type=mime,
                        download_url=download_url,
                        download_headers=headers,
                        title=str(row.get("title", "") or "")[:500],
                        caption=str(row.get("initial_comment", {}).get("comment", "") if isinstance(row.get("initial_comment"), dict) else "")[:2_000],
                        created_at=_iso_timestamp(row.get("timestamp", row.get("created", ""))),
                        modified_at=_iso_timestamp(row.get("updated", row.get("timestamp", ""))),
                        width=int(row.get("original_w", 0) or 0) or None,
                        height=int(row.get("original_h", 0) or 0) or None,
                        size=int(row.get("size", 0) or 0) or None,
                        shared=bool(row.get("is_public", False) or row.get("public_url_shared", False)),
                        albums=albums,
                        comments=[{"count": int(row.get("comments_count", 0) or 0)}] if row.get("comments_count") else [],
                        provenance={"provider": "slack", "channels": channel_ids, "userId": str(row.get("user", "") or "")},
                        metadata={"permalink": str(row.get("permalink", "") or ""), "mode": str(row.get("mode", "") or "")},
                    ))
                    if len(records) >= config["maxItems"]:
                        break
                paging = payload.get("paging") if isinstance(payload.get("paging"), dict) else {}
                pages = int(paging.get("pages", page) or page)
                if not files or page >= pages:
                    break
                page += 1
        return records

    def _google_drive_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        headers = self._auth_headers(config)
        records: list[RemoteMediaRecord] = []
        folder_id = str(config.get("folderId", "root") or "root")
        mime_query = "(mimeType contains 'image/' or mimeType contains 'video/')" if config["includeVideos"] else "mimeType contains 'image/'"
        folder_queue = [folder_id]
        visited_folders: set[str] = set()
        visited_files: set[str] = set()
        pages_fetched = 0
        while folder_queue and len(records) < config["maxItems"] and pages_fetched < config["maxPages"] and self._within_budget(config):
            current_folder = folder_queue.pop(0)
            if current_folder in visited_folders:
                continue
            visited_folders.add(current_folder)
            page_token = ""
            while len(records) < config["maxItems"] and pages_fetched < config["maxPages"] and self._within_budget(config):
                type_query = (
                    f"({mime_query} or mimeType = 'application/vnd.google-apps.folder')"
                    if config["recursive"] and folder_id != "all"
                    else mime_query
                )
                query: dict[str, Any] = {
                    "q": f"trashed = false and {type_query}" + (f" and '{current_folder}' in parents" if folder_id != "all" else ""),
                    "pageSize": min(1000, max(1, config["maxItems"] - len(records))),
                    "spaces": "drive",
                    "supportsAllDrives": "true",
                    "includeItemsFromAllDrives": "true",
                    "fields": "nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,imageMediaMetadata,videoMediaMetadata,parents,starred,trashed,capabilities(canDownload),driveId,description)",
                }
                if page_token:
                    query["pageToken"] = page_token
                payload = _json_api(self.transport, "GET", f"https://www.googleapis.com/drive/v3/files?{urlencode(query)}", headers=headers, allowed_hosts=["googleapis.com"])
                pages_fetched += 1
                files = payload.get("files") if isinstance(payload.get("files"), list) else []
                for row in files:
                    if not isinstance(row, dict):
                        continue
                    external_id = str(row.get("id", "") or "")
                    name = _filename(row.get("name"), f"drive-{external_id}")
                    mime = str(row.get("mimeType", "") or "")
                    if mime == "application/vnd.google-apps.folder":
                        if config["recursive"] and external_id and external_id not in visited_folders:
                            folder_queue.append(external_id)
                        continue
                    if external_id in visited_files or not bool((row.get("capabilities") or {}).get("canDownload", True)):
                        continue
                    if not external_id or not _supported_media(mime, name):
                        continue
                    visited_files.add(external_id)
                    image_meta = row.get("imageMediaMetadata") if isinstance(row.get("imageMediaMetadata"), dict) else {}
                    records.append(RemoteMediaRecord(
                        external_id=external_id,
                        filename=name,
                        mime_type=mime,
                        download_url=f"https://www.googleapis.com/drive/v3/files/{quote(external_id, safe='')}?alt=media&supportsAllDrives=true",
                        download_headers=headers,
                        title=name,
                        caption=str(row.get("description", "") or "")[:2_000],
                        created_at=str(row.get("createdTime", "") or ""),
                        modified_at=str(row.get("modifiedTime", "") or ""),
                        width=int(image_meta.get("width", 0) or 0) or None,
                        height=int(image_meta.get("height", 0) or 0) or None,
                        size=int(row.get("size", 0) or 0) or None,
                        favorite=bool(row.get("starred", False)),
                        albums=[NormalizedAlbum(album_id=f"gdrive-{parent}", name=f"Drive folder {parent}") for parent in clean_strings(row.get("parents", []), limit=20, max_length=200)],
                        provenance={"provider": "google_drive", "driveId": str(row.get("driveId", "") or ""), "parents": row.get("parents", [])},
                        metadata={"md5Checksum": str(row.get("md5Checksum", "") or ""), "imageMediaMetadata": image_meta},
                    ))
                    if len(records) >= config["maxItems"]:
                        break
                page_token = str(payload.get("nextPageToken", "") or "")
                if not page_token or not files:
                    break
            if folder_id == "all":
                break
        return records

    def _onedrive_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        headers = self._auth_headers(config)
        records: list[RemoteMediaRecord] = []
        folder_id = str(config.get("folderId", "root") or "root")
        initial = "https://graph.microsoft.com/v1.0/me/drive/root/children" if folder_id == "root" else f"https://graph.microsoft.com/v1.0/me/drive/items/{quote(folder_id, safe='')}/children"
        queue: list[tuple[str, str]] = [(initial + "?$top=200&$select=id,name,size,createdDateTime,lastModifiedDateTime,file,folder,parentReference,photo,video,deleted,shared", "")]
        visited: set[str] = set()
        pages_fetched = 0
        while queue and len(records) < config["maxItems"] and pages_fetched < config["maxPages"] and self._within_budget(config):
            url, folder_name = queue.pop(0)
            while url and len(records) < config["maxItems"] and pages_fetched < config["maxPages"] and self._within_budget(config):
                payload = _json_api(self.transport, "GET", url, headers=headers, allowed_hosts=["graph.microsoft.com"])
                pages_fetched += 1
                items = payload.get("value") if isinstance(payload.get("value"), list) else []
                for row in items:
                    if not isinstance(row, dict):
                        continue
                    external_id = str(row.get("id", "") or "")
                    if not external_id or external_id in visited:
                        continue
                    visited.add(external_id)
                    name = _filename(row.get("name"), f"onedrive-{external_id}")
                    if isinstance(row.get("folder"), dict):
                        if config["recursive"]:
                            queue.append((f"https://graph.microsoft.com/v1.0/me/drive/items/{quote(external_id, safe='')}/children?$top=200&$select=id,name,size,createdDateTime,lastModifiedDateTime,file,folder,parentReference,photo,video,deleted,shared", name))
                        continue
                    file_meta = row.get("file") if isinstance(row.get("file"), dict) else {}
                    mime = str(file_meta.get("mimeType", "") or "")
                    if not _supported_media(mime, name) or (not config["includeVideos"] and _media_kind(mime, name) == "video"):
                        continue
                    photo = row.get("photo") if isinstance(row.get("photo"), dict) else {}
                    parent = row.get("parentReference") if isinstance(row.get("parentReference"), dict) else {}
                    parent_id = str(parent.get("id", "") or "")
                    records.append(RemoteMediaRecord(
                        external_id=external_id,
                        filename=name,
                        mime_type=mime,
                        download_url=f"https://graph.microsoft.com/v1.0/me/drive/items/{quote(external_id, safe='')}/content",
                        download_headers=headers,
                        title=name,
                        created_at=str(row.get("createdDateTime", "") or ""),
                        modified_at=str(row.get("lastModifiedDateTime", "") or ""),
                        width=int(photo.get("width", 0) or 0) or None,
                        height=int(photo.get("height", 0) or 0) or None,
                        size=int(row.get("size", 0) or 0) or None,
                        deleted=bool(row.get("deleted")),
                        shared=bool(row.get("shared")),
                        albums=[NormalizedAlbum(album_id=f"onedrive-{parent_id}", name=folder_name or "OneDrive")],
                        provenance={"provider": "onedrive", "driveId": str(parent.get("driveId", "") or ""), "parentId": parent_id},
                        metadata={"hashes": file_meta.get("hashes", {})},
                    ))
                url = str(payload.get("@odata.nextLink", "") or "")
        return records

    def _dropbox_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        headers = self._auth_headers(config)
        records: list[RemoteMediaRecord] = []
        endpoint = "https://api.dropboxapi.com/2/files/list_folder"
        body: dict[str, Any] = {
            "path": str(config.get("folderPath", "") or ""),
            "recursive": bool(config["recursive"]),
            "include_deleted": True,
            "include_media_info": True,
            "limit": min(2_000, config["maxItems"]),
        }
        pages_fetched = 0
        while len(records) < config["maxItems"] and pages_fetched < config["maxPages"] and self._within_budget(config):
            payload = _json_api(self.transport, "POST", endpoint, headers=headers, body=body, allowed_hosts=["dropboxapi.com"])
            pages_fetched += 1
            entries = payload.get("entries") if isinstance(payload.get("entries"), list) else []
            for row in entries:
                if not isinstance(row, dict) or str(row.get(".tag", "")) not in {"file", "deleted"}:
                    continue
                external_id = str(row.get("id", row.get("path_lower", "")) or "")
                name = _filename(row.get("name"), f"dropbox-{sha256(external_id.encode()).hexdigest()[:8]}")
                mime = str(mimetypes.guess_type(name)[0] or "")
                if str(row.get(".tag")) == "deleted":
                    continue
                if not _supported_media(mime, name) or (not config["includeVideos"] and _media_kind(mime, name) == "video"):
                    continue
                media_info = row.get("media_info", {}).get("metadata", {}) if isinstance(row.get("media_info"), dict) else {}
                dimensions = media_info.get("dimensions") if isinstance(media_info.get("dimensions"), dict) else {}
                records.append(RemoteMediaRecord(
                    external_id=external_id,
                    filename=name,
                    mime_type=mime,
                    download_url="https://content.dropboxapi.com/2/files/download",
                    download_headers={**headers, "Dropbox-API-Arg": json.dumps({"path": str(row.get("path_lower", "") or "")}, separators=(",", ":"))},
                    title=name,
                    created_at=str(row.get("client_modified", "") or ""),
                    modified_at=str(row.get("server_modified", "") or ""),
                    width=int(dimensions.get("width", 0) or 0) or None,
                    height=int(dimensions.get("height", 0) or 0) or None,
                    size=int(row.get("size", 0) or 0) or None,
                    albums=[NormalizedAlbum(album_id=f"dropbox-{sha256(str(row.get('path_lower', '')).rsplit('/', 1)[0].encode()).hexdigest()[:20]}", name=str(row.get("path_display", "") or "").rsplit("/", 1)[0] or "Dropbox")],
                    provenance={"provider": "dropbox", "path": str(row.get("path_lower", "") or "")},
                    metadata={"contentHash": str(row.get("content_hash", "") or ""), "rev": str(row.get("rev", "") or "")},
                ))
            if not payload.get("has_more"):
                break
            endpoint = "https://api.dropboxapi.com/2/files/list_folder/continue"
            body = {"cursor": str(payload.get("cursor", "") or "")}
        return records

    def _web_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        records: list[RemoteMediaRecord] = []
        seen_media: set[str] = set()
        page_queue = list(config.get("urls", []))
        seen_pages: set[str] = set()

        def robots_allowed(candidate_url: str) -> bool:
            if not bool(config.get("respectRobots", True)):
                return True
            parsed = urlparse(candidate_url)
            origin = f"{parsed.scheme}://{parsed.netloc}"
            if origin not in self._robots:
                robots_url = validate_remote_url(f"{origin}/robots.txt", allow_private_test=self.allow_private_test)
                parser = RobotFileParser()
                parser.set_url(robots_url)
                try:
                    response = self.transport(
                        "GET",
                        robots_url,
                        headers={"Accept": "text/plain", "User-Agent": "VintraceConnector/1.0"},
                        max_bytes=512 * 1024,
                    )
                    parser.parse(response.body.decode("utf-8", errors="replace").splitlines())
                    self._robots[origin] = parser
                except ConnectorNetworkError:
                    self._robots[origin] = None
            rules = self._robots.get(origin)
            return True if rules is None else bool(rules.can_fetch("VintraceConnector", candidate_url))

        while page_queue and len(seen_pages) < config["maxPages"] and len(records) < config["maxItems"] and self._within_budget(config):
            page_url = validate_remote_url(page_queue.pop(0), allow_private_test=self.allow_private_test)
            if page_url in seen_pages:
                continue
            seen_pages.add(page_url)
            if not robots_allowed(page_url):
                continue
            guessed = mimetypes.guess_type(urlparse(page_url).path)[0] or ""
            if _supported_media(guessed, urlparse(page_url).path):
                candidates = [{"url": page_url, "alt": "", "title": ""}]
                page_title = urlparse(page_url).hostname or "Web"
            else:
                response = self.transport("GET", page_url, headers={"Accept": "text/html,application/xhtml+xml"}, max_bytes=MAX_RESPONSE_BYTES)
                content_type = str(response.headers.get("content-type", "") or "").lower()
                if content_type.startswith(("image/", "video/")):
                    candidates = [{"url": page_url, "alt": "", "title": ""}]
                    page_title = urlparse(page_url).hostname or "Web"
                else:
                    parser = _PageParser()
                    try:
                        parser.feed(response.body.decode("utf-8", errors="replace"))
                    except Exception as exc:
                        raise ConnectorNetworkError("Web page markup could not be parsed safely.") from exc
                    page_title = parser.title or urlparse(page_url).hostname or "Web"
                    candidates = parser.images
                    if config["recursive"]:
                        origin = urlparse(page_url)
                        for href in parser.links:
                            candidate_page = urljoin(page_url, href)
                            parsed = urlparse(candidate_page)
                            if parsed.scheme in {"http", "https"} and parsed.hostname == origin.hostname and candidate_page not in seen_pages:
                                page_queue.append(candidate_page)
            for candidate in candidates:
                media_url = validate_remote_url(urljoin(page_url, candidate["url"]), allow_private_test=self.allow_private_test)
                if media_url in seen_media:
                    continue
                seen_media.add(media_url)
                if not robots_allowed(media_url):
                    continue
                parsed_media = urlparse(media_url)
                name = _filename(Path(parsed_media.path).name, f"web-{sha256(media_url.encode()).hexdigest()[:12]}.jpg")
                mime = str(mimetypes.guess_type(name)[0] or "")
                if mime and not _supported_media(mime, name):
                    continue
                records.append(RemoteMediaRecord(
                    external_id=sha256(media_url.encode("utf-8")).hexdigest(),
                    filename=name,
                    mime_type=mime,
                    download_url=media_url,
                    title=str(candidate.get("title") or candidate.get("alt") or name)[:500],
                    caption=str(candidate.get("alt") or "")[:2_000],
                    albums=[NormalizedAlbum(album_id=f"web-{sha256(page_url.encode()).hexdigest()[:20]}", name=page_title[:200])],
                    provenance={"provider": "web", "pageUrl": page_url, "mediaUrl": media_url},
                    metadata={"pageTitle": page_title[:300]},
                ))
                if len(records) >= config["maxItems"]:
                    break
        return records

    def _webdav_records(self, config: dict[str, Any]) -> list[RemoteMediaRecord]:
        base_url = validate_remote_url(config.get("baseUrl"), allow_private_test=self.allow_private_test)
        credential = config.get("credential") if isinstance(config.get("credential"), dict) else {}
        headers = self._auth_headers(config)
        if not headers and credential.get("username"):
            import base64
            raw = f"{credential.get('username', '')}:{credential.get('password', '')}".encode("utf-8")
            headers = {"Authorization": f"Basic {base64.b64encode(raw).decode('ascii')}"}
        body = b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontenttype/><d:getcontentlength/><d:getlastmodified/><d:getetag/><d:resourcetype/></d:prop></d:propfind>'
        response = self.transport("PROPFIND", base_url, headers={**headers, "Depth": "infinity" if config["recursive"] else "1", "Content-Type": "application/xml"}, body=body, max_bytes=MAX_RESPONSE_BYTES)
        try:
            root = ET.fromstring(response.body)
        except ET.ParseError as exc:
            raise ConnectorNetworkError("WebDAV returned invalid XML.") from exc
        records: list[RemoteMediaRecord] = []
        for node in root.findall("{DAV:}response"):
            href = str(node.findtext("{DAV:}href", "") or "")
            prop = node.find(".//{DAV:}prop")
            if prop is None or prop.find("{DAV:}resourcetype/{DAV:}collection") is not None:
                continue
            media_url = validate_remote_url(urljoin(base_url, href), allow_private_test=self.allow_private_test)
            name = _filename(prop.findtext("{DAV:}displayname", "") or urlparse(media_url).path)
            mime = str(prop.findtext("{DAV:}getcontenttype", "") or mimetypes.guess_type(name)[0] or "")
            if not _supported_media(mime, name) or (not config["includeVideos"] and _media_kind(mime, name) == "video"):
                continue
            etag = str(prop.findtext("{DAV:}getetag", "") or "")
            records.append(RemoteMediaRecord(
                external_id=sha256((href + etag).encode("utf-8")).hexdigest(),
                filename=name,
                mime_type=mime,
                download_url=media_url,
                download_headers=headers,
                title=name,
                modified_at=str(prop.findtext("{DAV:}getlastmodified", "") or ""),
                size=int(prop.findtext("{DAV:}getcontentlength", "0") or 0) or None,
                albums=[NormalizedAlbum(album_id=f"webdav-{sha256(str(Path(urlparse(href).path).parent).encode()).hexdigest()[:20]}", name=Path(urlparse(href).path).parent.name or "WebDAV")],
                provenance={"provider": "webdav", "href": href},
                metadata={"etag": etag},
            ))
            if len(records) >= config["maxItems"]:
                break
        return records

    def fetch_records(self, library_path: str, *, time_budget_ms: int | None = None) -> list[RemoteMediaRecord]:
        connection_id = self._connection_id(library_path)
        stored_config = self._connections.get(connection_id)
        if not stored_config:
            raise ConnectorCredentialError("Reconnect this inbound source before continuing.")
        config = dict(stored_config)
        if time_budget_ms is not None:
            config["_deadlineMonotonic"] = time.monotonic() + max(100, min(30_000, int(time_budget_ms))) / 1000.0
        handlers = {
            SLACK_PROVIDER: self._slack_records,
            WEB_PROVIDER: self._web_records,
            GOOGLE_DRIVE_PROVIDER: self._google_drive_records,
            ONEDRIVE_PROVIDER: self._onedrive_records,
            DROPBOX_PROVIDER: self._dropbox_records,
            WEBDAV_PROVIDER: self._webdav_records,
        }
        records = handlers[self.provider](config)[: config["maxItems"]]
        self._last_discovery_complete[connection_id] = self._within_budget(config)
        self._records[connection_id] = {record.external_id: record for record in records}
        return records

    def _normalized(self, record: RemoteMediaRecord, library: PhotoSourceLibrary, scopes: PhotoSourceScopes) -> NormalizedPhotoAsset:
        return NormalizedPhotoAsset(
            provider=self.provider,
            library_id=library.library_id,
            external_id=record.external_id,
            filename=record.filename,
            original_filename=record.filename,
            media_kind=_media_kind(record.mime_type, record.filename),
            mime_type=record.mime_type,
            width=record.width,
            height=record.height,
            capture_date=record.created_at,
            original_date=record.created_at,
            modified_date=record.modified_at,
            added_date=record.created_at,
            title=record.title,
            caption=record.caption,
            favorite=record.favorite if scopes.favorites else False,
            deleted=record.deleted if scopes.deleted else False,
            shared=record.shared if scopes.shared else False,
            missing=True,
            cloud_asset=True,
            keywords=record.keywords if scopes.keywords else [],
            albums=record.albums if scopes.albums_folders else [],
            comments=record.comments if scopes.comments_likes else [],
            likes=record.likes if scopes.comments_likes else [],
            provenance=record.provenance,
            metadata={**record.metadata, "remoteSize": record.size, "connectorProvider": self.provider},
        )

    def preview(
        self,
        library_path: str,
        scopes: PhotoSourceScopes,
        *,
        item_limit: int = 5_000,
        sample_limit: int = 24,
        time_budget_ms: int = 1_500,
    ) -> PhotoSourcePreview:
        started = time.monotonic()
        library = self.describe_library(library_path)
        records = self.fetch_records(library_path, time_budget_ms=time_budget_ms)[: max(1, min(MAX_DISCOVERY_ITEMS, int(item_limit)))]
        connection_id = self._connection_id(library_path)
        discovery_complete = self._last_discovery_complete.get(connection_id, True)
        samples = []
        counts = {"assets": len(records), "images": 0, "videos": 0, "cloudAssets": len(records), "favorites": 0, "deleted": 0, "shared": 0}
        for record in records:
            kind = _media_kind(record.mime_type, record.filename)
            counts["videos" if kind == "video" else "images"] += 1
            counts["favorites"] += int(record.favorite)
            counts["deleted"] += int(record.deleted)
            counts["shared"] += int(record.shared)
            if len(samples) < max(0, min(100, int(sample_limit))):
                samples.append({
                    "externalId": record.external_id,
                    "filename": record.filename,
                    "title": record.title,
                    "captureDate": record.created_at,
                    "mediaKind": kind,
                    "favorite": bool(record.favorite),
                    "deleted": bool(record.deleted),
                    "cloudAsset": True,
                    "albumCount": len(record.albums),
                    "keywordCount": len(record.keywords),
                    "size": record.size,
                })
        return PhotoSourcePreview(
            provider=self.provider,
            library=library,
            scopes=scopes,
            counts=counts,
            samples=samples,
            scanned_count=len(records),
            complete=discovery_complete and len(records) < int(item_limit),
            elapsed_ms=max(0, int((time.monotonic() - started) * 1000)),
            warnings=[] if discovery_complete else ["Discovery stopped at the configured time budget; narrow the source or continue with a larger bounded request."],
            unsupported_fields=["peopleFaces", "preciseLocation"],
            capabilities={**REMOTE_CAPABILITIES, "commentsLikes": self.provider == SLACK_PROVIDER},
        )


class RemoteConnectorLibrary(AbstractContextManager["RemoteConnectorLibrary"]):
    def __init__(self, adapter: RemoteConnectorAdapter, library_path: str):
        self.adapter = adapter
        self.library = adapter.describe_library(library_path)
        self.library_path = self.library.path
        self.records: list[RemoteMediaRecord] | None = None

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        return None

    def _all_records(self) -> list[RemoteMediaRecord]:
        if self.records is None:
            self.records = self.adapter.fetch_records(self.library_path)
        return self.records

    def iter_assets(
        self,
        scopes: PhotoSourceScopes,
        *,
        after_external_id: str = "",
        limit: int | None = None,
    ) -> Iterator[NormalizedPhotoAsset]:
        emitted = 0
        after_seen = not bool(after_external_id)
        for record in self._all_records():
            if not after_seen:
                if record.external_id == after_external_id:
                    after_seen = True
                continue
            yield self.adapter._normalized(record, self.library, scopes)  # noqa: SLF001
            emitted += 1
            if limit is not None and emitted >= max(0, int(limit)):
                break

    def export_asset(
        self,
        external_id: str,
        destination: str,
        *,
        edited: bool = False,
        include_raw: bool = False,
        include_live_photo: bool = False,
        allow_photos_export: bool = False,
        timeout_seconds: int = 120,
    ) -> list[str]:
        del edited, include_raw, include_live_photo, allow_photos_export, timeout_seconds
        record = next((item for item in self._all_records() if item.external_id == external_id), None)
        if record is None:
            raise ValueError("Remote source item was not found.")
        connection_id = self.adapter._connection_id(self.library_path)  # noqa: SLF001
        config = self.adapter._connections.get(connection_id, {})  # noqa: SLF001
        max_bytes = int(config.get("maxDownloadBytes", DEFAULT_DOWNLOAD_BYTES) or DEFAULT_DOWNLOAD_BYTES)
        if record.size and record.size > max_bytes:
            raise ConnectorNetworkError("Remote media exceeds the configured download size limit.")
        allowed_hosts: list[str] | None = None
        if self.adapter.provider == SLACK_PROVIDER:
            allowed_hosts = ["slack.com", "slack-edge.com", "slack-files.com"]
        elif self.adapter.provider == GOOGLE_DRIVE_PROVIDER:
            allowed_hosts = ["googleapis.com", "googleusercontent.com"]
        elif self.adapter.provider == DROPBOX_PROVIDER:
            allowed_hosts = ["dropboxapi.com", "dropboxusercontent.com"]
        response = self.adapter.transport(
            "POST" if self.adapter.provider == DROPBOX_PROVIDER else "GET",
            record.download_url,
            headers=record.download_headers,
            max_bytes=max_bytes,
            allowed_hosts=allowed_hosts,
        )
        content_type = str(response.headers.get("content-type", record.mime_type) or record.mime_type).split(";", 1)[0].strip().lower()
        if not _supported_media(content_type, record.filename):
            raise ConnectorNetworkError("Remote response is not a supported image or video.")
        if not _verified_media_content(response.body, content_type, record.filename):
            raise ConnectorNetworkError("Remote response bytes do not match a supported image or video format.")
        target_root = Path(destination).expanduser().resolve()
        target_root.mkdir(parents=True, exist_ok=True)
        target = target_root / _filename(record.filename)
        partial = target_root / f".{target.name}.{uuid.uuid4().hex}.partial"
        try:
            partial.write_bytes(response.body)
            if not partial.is_file() or partial.stat().st_size <= 0:
                raise ConnectorNetworkError("Remote media download was empty.")
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
        return [str(target)]


def _verified_media_content(body: bytes, content_type: str, filename: str) -> bool:
    if not body or len(body) < 4:
        return False
    mime = str(content_type or "").lower()
    expected_kind = _media_kind(mime, filename)
    head = body[:64]
    if head.lstrip().lower().startswith((b"<!doctype html", b"<html", b"<?xml", b"{")):
        return False
    if expected_kind == "image":
        image_magic = (
            head.startswith(b"\xff\xd8\xff"),
            head.startswith(b"\x89PNG\r\n\x1a\n"),
            head.startswith((b"GIF87a", b"GIF89a")),
            head.startswith(b"BM"),
            head.startswith((b"II*\x00", b"MM\x00*")),
            head.startswith(b"RIFF") and head[8:12] == b"WEBP",
            len(head) >= 12 and head[4:8] == b"ftyp" and head[8:12] in {
                b"avif", b"avis", b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1"
            },
        )
        if any(image_magic):
            return True
        try:
            with PilImage.open(BytesIO(body)) as image:
                image.verify()
            return True
        except Exception:
            return False
    video_magic = (
        len(head) >= 12 and head[4:8] == b"ftyp",
        head.startswith(b"\x1a\x45\xdf\xa3"),
        head.startswith(b"RIFF") and head[8:12] == b"AVI ",
        head.startswith(b"OggS"),
        head.startswith(b"\x00\x00\x01\xba"),
        head.startswith(b"\x47") and len(body) >= 188,
    )
    return any(video_magic)


def build_remote_adapters(
    *,
    transport: Transport | None = None,
    allow_private_test: bool = False,
) -> dict[str, RemoteConnectorAdapter]:
    return {
        provider: RemoteConnectorAdapter(
            provider,
            transport=transport,
            allow_private_test=allow_private_test,
        )
        for provider in sorted(REMOTE_PHOTO_SOURCE_PROVIDERS)
    }

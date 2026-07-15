from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import contextvars
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import stat
import time
from typing import Any, Callable
from urllib.parse import urlparse

import anyio
import jwt
from jwt import PyJWKClient
from mcp.server.auth.provider import AccessToken

from crossage_fr.mobile_companion import (
    MOBILE_ACCOUNT_ID_RE,
    MOBILE_ALLOWED_SCOPES,
    MOBILE_ALLOWED_TOOLS,
    MOBILE_CLIENT_TYPE,
)
from crossage_fr.runtime_env import env_value


AGENT_SCOPES = (
    "images:read",
    "images:preview",
    "images:write",
    "images:destructive",
    "events:read",
    "images:admin",
)
DEFAULT_OAUTH_ALGORITHMS = ("RS256", "ES256", "EdDSA")
MAX_SERVICE_ACCOUNTS = 1000
MAX_SERVICE_ACCOUNT_FILE_BYTES = 1024 * 1024
_ACCOUNT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$")
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
_TOOL_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,127}$")


@dataclass(frozen=True)
class AgentPrincipal:
    principal_id: str
    auth_type: str
    scopes: tuple[str, ...]
    allowed_tools: tuple[str, ...] = ()
    subject: str = ""
    issuer: str = ""
    expires_at: int | None = None
    client_type: str = "service"
    read_only: bool = False
    display_name: str = ""

    def has_scope(self, required: str) -> bool:
        granted = set(self.scopes)
        if "images:admin" in granted:
            return True
        implications = {
            "images:destructive": {"images:write", "images:read"},
            "images:write": {"images:read"},
            "images:preview": {"images:read"},
        }
        expanded = set(granted)
        for scope in tuple(granted):
            expanded.update(implications.get(scope, set()))
        return required in expanded


_CURRENT_AGENT_PRINCIPAL: contextvars.ContextVar[AgentPrincipal | None] = contextvars.ContextVar(
    "vintrace_agent_principal",
    default=None,
)


def current_agent_principal() -> AgentPrincipal | None:
    return _CURRENT_AGENT_PRINCIPAL.get()


def set_current_agent_principal(principal: AgentPrincipal):
    return _CURRENT_AGENT_PRINCIPAL.set(principal)


def reset_current_agent_principal(token) -> None:
    _CURRENT_AGENT_PRINCIPAL.reset(token)


@dataclass(frozen=True)
class OAuthResourceConfig:
    issuer: str
    audience: str
    resource_url: str
    jwks_url: str
    algorithms: tuple[str, ...]


def _validated_http_url(value: str, *, label: str, allow_local_http: bool = False) -> str:
    clean = str(value or "").strip().rstrip("/")
    parsed = urlparse(clean)
    local = parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if not parsed.hostname or parsed.scheme not in ({"https"} | ({"http"} if allow_local_http and local else set())):
        raise ValueError(f"{label} must be an HTTPS URL (localhost HTTP is allowed for development).")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f"{label} cannot contain credentials, a query, or a fragment.")
    return clean


def oauth_resource_config_from_env() -> OAuthResourceConfig | None:
    values = {
        "issuer": str(env_value("MCP_OAUTH_ISSUER") or "").strip(),
        "audience": str(env_value("MCP_OAUTH_AUDIENCE") or "").strip(),
        "resource_url": str(env_value("MCP_OAUTH_RESOURCE_URL") or "").strip(),
        "jwks_url": str(env_value("MCP_OAUTH_JWKS_URL") or "").strip(),
    }
    if not any(values.values()):
        return None
    missing = [key for key in ("issuer", "resource_url", "jwks_url") if not values[key]]
    if missing:
        raise ValueError(f"OAuth resource-server configuration is incomplete; missing: {', '.join(missing)}.")
    issuer = _validated_http_url(values["issuer"], label="OAuth issuer", allow_local_http=True)
    resource_url = _validated_http_url(values["resource_url"], label="OAuth resource URL", allow_local_http=True)
    jwks_url = _validated_http_url(values["jwks_url"], label="OAuth JWKS URL", allow_local_http=True)
    audience = values["audience"] or resource_url
    algorithms = tuple(
        value.strip()
        for value in str(env_value("MCP_OAUTH_ALGORITHMS") or ",".join(DEFAULT_OAUTH_ALGORITHMS)).split(",")
        if value.strip()
    )
    if not algorithms or any(value not in DEFAULT_OAUTH_ALGORITHMS for value in algorithms):
        raise ValueError(f"OAuth JWT algorithms must be selected from: {', '.join(DEFAULT_OAUTH_ALGORITHMS)}.")
    return OAuthResourceConfig(
        issuer=issuer,
        audience=audience,
        resource_url=resource_url,
        jwks_url=jwks_url,
        algorithms=algorithms,
    )


def service_accounts_path_from_env() -> Path | None:
    value = str(env_value("MCP_SERVICE_ACCOUNTS_FILE") or "").strip()
    return Path(value).expanduser().resolve() if value else None


def mobile_accounts_path_from_env() -> Path | None:
    value = str(env_value("MOBILE_ACCOUNTS_FILE") or "").strip()
    return Path(value).expanduser().resolve() if value else None


def _expiry_timestamp(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return int(value)
    text = str(value or "").strip()
    if text.isdigit():
        return int(text)
    try:
        return int(datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp())
    except ValueError as exc:
        raise ValueError("Service-account expiresAt must be a Unix timestamp or ISO-8601 datetime.") from exc


class ServiceAccountStore:
    def __init__(self, path: Path | None) -> None:
        self.path = path
        self._cached_stamp: tuple[int, int, int, int] | None = None
        self._cached_accounts: tuple[dict[str, Any], ...] = ()

    def configured(self) -> bool:
        return self.path is not None

    def _load(self) -> tuple[dict[str, Any], ...]:
        if self.path is None:
            return ()
        try:
            file_stat = self.path.stat()
        except OSError as exc:
            raise ValueError("The configured MCP service-account file is unavailable.") from exc
        if not self.path.is_file() or file_stat.st_size > MAX_SERVICE_ACCOUNT_FILE_BYTES:
            raise ValueError("The MCP service-account file must be a regular JSON file no larger than 1 MB.")
        if os.name != "nt" and stat.S_IMODE(file_stat.st_mode) & 0o077:
            raise ValueError("The MCP service-account file must not be readable or writable by group/other users (use mode 0600).")
        stamp = (
            int(file_stat.st_mtime_ns),
            int(getattr(file_stat, "st_ctime_ns", int(file_stat.st_ctime * 1_000_000_000))),
            int(getattr(file_stat, "st_ino", 0)),
            int(file_stat.st_size),
        )
        if stamp == self._cached_stamp:
            return self._cached_accounts
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ValueError("The MCP service-account file is not valid JSON.") from exc
        rows = payload.get("accounts", []) if isinstance(payload, dict) else []
        if not isinstance(rows, list) or len(rows) > MAX_SERVICE_ACCOUNTS:
            raise ValueError(f"The service-account file must contain at most {MAX_SERVICE_ACCOUNTS} accounts.")
        accounts: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        for raw in rows:
            if not isinstance(raw, dict):
                raise ValueError("Every service-account entry must be an object.")
            account_id = str(raw.get("accountId", "") or "").strip()
            token_hash = str(raw.get("tokenSha256", "") or "").strip().lower()
            if not _ACCOUNT_ID_RE.fullmatch(account_id) or account_id in seen_ids:
                raise ValueError("Service-account IDs must be unique safe identifiers of 3-128 characters.")
            if not _SHA256_RE.fullmatch(token_hash):
                raise ValueError("Every service account requires a lowercase SHA-256 token hash.")
            scopes = tuple(dict.fromkeys(str(value or "").strip() for value in raw.get("scopes", []) if str(value or "").strip()))
            if not scopes or any(value not in AGENT_SCOPES for value in scopes):
                raise ValueError(f"Service-account scopes must be selected from: {', '.join(AGENT_SCOPES)}.")
            allowed_tools_raw = raw.get("allowedTools", [])
            if not isinstance(allowed_tools_raw, list) or len(allowed_tools_raw) > 256:
                raise ValueError("allowedTools must be a list containing at most 256 tool names.")
            allowed_tools = tuple(dict.fromkeys(str(value or "").strip() for value in allowed_tools_raw if str(value or "").strip()))
            if any(not _TOOL_NAME_RE.fullmatch(value) for value in allowed_tools):
                raise ValueError("allowedTools contains an invalid tool name.")
            client_type = str(raw.get("clientType", "service") or "service").strip().lower()
            if client_type not in {"service", MOBILE_CLIENT_TYPE}:
                raise ValueError("Service-account clientType must be service or mobile.")
            read_only = bool(raw.get("readOnly", False))
            expires_at = _expiry_timestamp(raw.get("expiresAt"))
            if read_only and any(scope in {"images:write", "images:destructive", "images:admin"} for scope in scopes):
                raise ValueError("A read-only service account cannot receive write, destructive, or admin scopes.")
            if client_type == MOBILE_CLIENT_TYPE:
                if not MOBILE_ACCOUNT_ID_RE.fullmatch(account_id):
                    raise ValueError("Mobile account IDs must use the mobile-<random> form.")
                if not read_only:
                    raise ValueError("Mobile accounts must be explicitly read-only.")
                if not set(scopes).issubset(MOBILE_ALLOWED_SCOPES):
                    raise ValueError("Mobile accounts can receive only images:read and images:preview.")
                if not allowed_tools or not set(allowed_tools).issubset(MOBILE_ALLOWED_TOOLS):
                    raise ValueError("Mobile accounts require a non-empty subset of the mobile read-only tool allowlist.")
                if expires_at is None:
                    raise ValueError("Mobile accounts must expire.")
                pairing_hash = str(raw.get("pairingCodeSha256", "") or "").strip().lower()
                if pairing_hash and not _SHA256_RE.fullmatch(pairing_hash):
                    raise ValueError("Mobile pairingCodeSha256 must be a lowercase SHA-256 hash.")
            accounts.append(
                {
                    "accountId": account_id,
                    "tokenSha256": token_hash,
                    "scopes": scopes,
                    "allowedTools": allowed_tools,
                    "expiresAt": expires_at,
                    "disabled": bool(raw.get("disabled", False)),
                    "clientType": client_type,
                    "readOnly": read_only,
                    "displayName": str(raw.get("displayName", "") or "").strip()[:64],
                }
            )
            seen_ids.add(account_id)
        self._cached_stamp = stamp
        self._cached_accounts = tuple(accounts)
        return self._cached_accounts

    def verify(self, token: str, *, now: int | None = None) -> AgentPrincipal | None:
        digest = hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()
        current = int(time.time()) if now is None else int(now)
        for account in self._load():
            if not hmac.compare_digest(digest, str(account["tokenSha256"])):
                continue
            expires_at = account.get("expiresAt")
            if bool(account.get("disabled")) or (expires_at is not None and int(expires_at) <= current):
                return None
            return AgentPrincipal(
                principal_id=str(account["accountId"]),
                auth_type="mobile" if account.get("clientType") == MOBILE_CLIENT_TYPE else "service-account",
                scopes=tuple(account["scopes"]),
                allowed_tools=tuple(account["allowedTools"]),
                subject=str(account["accountId"]),
                issuer="vintrace-service-accounts",
                expires_at=int(expires_at) if expires_at is not None else None,
                client_type=str(account.get("clientType", "service") or "service"),
                read_only=bool(account.get("readOnly", False)),
                display_name=str(account.get("displayName", "") or "")[:64],
            )
        return None


class AgentTokenVerifier:
    """Composite verifier for the local operator token, scoped service accounts, and OAuth JWTs."""

    def __init__(
        self,
        *,
        local_token: str = "",
        service_accounts_path: Path | None = None,
        mobile_accounts_path: Path | None = None,
        oauth: OAuthResourceConfig | None = None,
        oauth_key_resolver: Callable[[str], Any] | None = None,
    ) -> None:
        self.local_token = str(local_token or "")
        self.service_accounts = ServiceAccountStore(service_accounts_path)
        self.mobile_accounts = ServiceAccountStore(
            None if mobile_accounts_path == service_accounts_path else mobile_accounts_path
        )
        self.oauth = oauth
        self._oauth_key_resolver = oauth_key_resolver
        self._jwks = PyJWKClient(oauth.jwks_url, cache_keys=True) if oauth and oauth_key_resolver is None else None

    def configured(self) -> bool:
        return bool(
            self.local_token
            or self.service_accounts.configured()
            or self.mobile_accounts.configured()
            or self.oauth
        )

    def oauth_enabled(self) -> bool:
        return self.oauth is not None

    def validate_configuration(self) -> None:
        if self.service_accounts.configured():
            self.service_accounts._load()
        if self.mobile_accounts.configured():
            self.mobile_accounts._load()

    def _oauth_principal(self, token: str) -> AgentPrincipal | None:
        if self.oauth is None:
            return None
        try:
            if self._oauth_key_resolver is not None:
                key = self._oauth_key_resolver(token)
            elif self._jwks is not None:
                key = self._jwks.get_signing_key_from_jwt(token).key
            else:
                return None
            claims = jwt.decode(
                token,
                key=key,
                algorithms=list(self.oauth.algorithms),
                audience=self.oauth.audience,
                issuer=self.oauth.issuer,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
                leeway=30,
            )
        except Exception:
            return None
        raw_scopes = claims.get("scope", claims.get("scp", []))
        scopes = (
            tuple(value for value in raw_scopes.split() if value)
            if isinstance(raw_scopes, str)
            else tuple(str(value) for value in raw_scopes if str(value or "").strip())
            if isinstance(raw_scopes, list)
            else ()
        )
        scopes = tuple(dict.fromkeys(value for value in scopes if value in AGENT_SCOPES))
        if not scopes:
            return None
        client_id = str(claims.get("client_id", claims.get("azp", "oauth-client")) or "oauth-client")[:128]
        subject = str(claims.get("sub", "") or "")[:256]
        return AgentPrincipal(
            principal_id=f"{client_id}:{subject}" if subject else client_id,
            auth_type="oauth",
            scopes=scopes,
            subject=subject,
            issuer=str(claims.get("iss", "") or ""),
            expires_at=int(claims["exp"]),
        )

    async def verify_principal(self, token: str) -> AgentPrincipal | None:
        clean = str(token or "")
        if self.local_token and hmac.compare_digest(clean.encode("utf-8"), self.local_token.encode("utf-8")):
            return AgentPrincipal(
                principal_id="local-operator",
                auth_type="local-token",
                scopes=("images:admin",),
                subject="local-operator",
                issuer="vintrace-local",
                client_type="operator",
            )
        service_principal = await anyio.to_thread.run_sync(lambda: self.service_accounts.verify(clean))
        if service_principal is not None:
            return service_principal
        mobile_principal = await anyio.to_thread.run_sync(lambda: self.mobile_accounts.verify(clean))
        if mobile_principal is not None:
            return mobile_principal
        if self.oauth is not None:
            return await anyio.to_thread.run_sync(lambda: self._oauth_principal(clean))
        return None

    async def verify_token(self, token: str) -> AccessToken | None:
        principal = await self.verify_principal(token)
        if principal is None:
            return None
        return AccessToken(
            token=token,
            client_id=principal.principal_id,
            scopes=list(principal.scopes),
            expires_at=principal.expires_at,
            resource=self.oauth.resource_url if self.oauth else None,
            subject=principal.subject or None,
            claims={
                "iss": principal.issuer,
                "auth_type": principal.auth_type,
                "allowed_tools": list(principal.allowed_tools),
                "client_type": principal.client_type,
                "read_only": principal.read_only,
                "display_name": principal.display_name,
            },
        )

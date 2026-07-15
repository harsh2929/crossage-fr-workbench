from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import threading
import time
from typing import Any, Callable

from crossage_fr.runtime_env import env_value


ROUTINE_CURATION_ACTIONS = frozenset(
    {
        "add_photo_album_items",
        "move_photo_album_to_folder",
        "reorder_photo_album_folder_children",
        "reorder_photo_album_items",
        "save_photo_album",
        "save_photo_album_folder",
        "save_photo_keyword",
        "update_photo_asset_metadata",
        "update_photo_assets_metadata",
    }
)


def _bounded_int(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


@dataclass(frozen=True)
class DelegationPolicy:
    mode: str = "manual"
    minimum_confirmed_actions: int = 3
    maximum_affected_assets: int = 25
    trust_ttl_days: int = 30
    allowed_actions: frozenset[str] = ROUTINE_CURATION_ACTIONS

    @classmethod
    def from_env(cls) -> "DelegationPolicy":
        mode = str(env_value("MCP_DELEGATION_MODE") or "manual").strip().lower()
        if mode not in {"manual", "progressive"}:
            raise ValueError("MCP delegation mode must be manual or progressive.")
        configured = str(env_value("MCP_DELEGATION_ACTIONS") or "").strip()
        allowed = ROUTINE_CURATION_ACTIONS
        if configured:
            requested = frozenset(value.strip() for value in configured.split(",") if value.strip())
            unsupported = requested - ROUTINE_CURATION_ACTIONS
            if unsupported:
                raise ValueError(
                    "MCP delegation actions are not eligible for progressive trust: "
                    + ", ".join(sorted(unsupported))
                )
            allowed = requested
        return cls(
            mode=mode,
            minimum_confirmed_actions=_bounded_int(
                env_value("MCP_DELEGATION_MIN_CONFIRMED_ACTIONS"),
                default=3,
                minimum=1,
                maximum=100,
            ),
            maximum_affected_assets=_bounded_int(
                env_value("MCP_DELEGATION_MAX_ASSETS"),
                default=25,
                minimum=1,
                maximum=1_000,
            ),
            trust_ttl_days=_bounded_int(
                env_value("MCP_DELEGATION_TRUST_TTL_DAYS"),
                default=30,
                minimum=1,
                maximum=365,
            ),
            allowed_actions=allowed,
        )


@dataclass(frozen=True)
class DelegationDecision:
    allowed: bool
    reason: str
    confirmed_count: int
    required_count: int
    affected_assets: int


class ElicitationRateLimiter:
    def __init__(
        self,
        *,
        maximum_requests: int = 12,
        window_seconds: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.maximum_requests = max(1, min(100, int(maximum_requests)))
        self.window_seconds = max(1.0, min(3_600.0, float(window_seconds)))
        self.clock = clock
        self._history: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, principal: str) -> bool:
        clean_principal = str(principal or "anonymous")[:512]
        now = self.clock()
        cutoff = now - self.window_seconds
        with self._lock:
            recent = [timestamp for timestamp in self._history.get(clean_principal, []) if timestamp > cutoff]
            if len(recent) >= self.maximum_requests:
                self._history[clean_principal] = recent
                return False
            recent.append(now)
            self._history[clean_principal] = recent
            if len(self._history) > 1_024:
                stale = [key for key, values in self._history.items() if not values or values[-1] <= cutoff]
                for key in stale[: len(self._history) - 1_024]:
                    self._history.pop(key, None)
            return True


def affected_asset_count(payload: dict[str, Any] | None) -> int:
    body = payload if isinstance(payload, dict) else {}
    identifiers: set[str] = set()
    list_sizes: list[int] = []

    def visit(value: Any, key: str = "") -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                visit(child, str(child_key))
            return
        if isinstance(value, list):
            if key in {"assetIds", "sourcePaths", "updates", "items"}:
                list_sizes.append(len(value))
            for child in value:
                visit(child, key)
            return
        if key in {"assetId", "sourcePath"} and str(value or "").strip():
            identifiers.add(str(value))
        elif key in {"assetIds", "sourcePaths"} and str(value or "").strip():
            identifiers.add(str(value))

    visit(body)
    return max(1, len(identifiers), *(list_sizes or [0]))


class SQLiteDelegationTrust:
    """Principal/action trust evidence for operator-enabled routine delegation."""

    def __init__(
        self,
        database_path: Path,
        *,
        principal: Callable[[], str],
        policy: DelegationPolicy | None = None,
    ) -> None:
        self.database_path = Path(database_path)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self.principal = principal
        self.policy = policy or DelegationPolicy.from_env()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(str(self.database_path), timeout=10.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA busy_timeout=10000")
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS mcp_delegation_trust (
                    principal TEXT NOT NULL,
                    action TEXT NOT NULL,
                    confirmed_count INTEGER NOT NULL DEFAULT 0,
                    delegated_count INTEGER NOT NULL DEFAULT 0,
                    last_confirmed_at TEXT NOT NULL DEFAULT '',
                    last_delegated_at TEXT NOT NULL DEFAULT '',
                    PRIMARY KEY(principal, action)
                )
                """
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def record_confirmed(self, action: str) -> None:
        clean_action = str(action or "").strip()
        if clean_action not in ROUTINE_CURATION_ACTIONS:
            return
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO mcp_delegation_trust(
                    principal, action, confirmed_count, last_confirmed_at
                ) VALUES(?, ?, 1, ?)
                ON CONFLICT(principal, action) DO UPDATE SET
                    confirmed_count = confirmed_count + 1,
                    last_confirmed_at = excluded.last_confirmed_at
                """,
                (self.principal(), clean_action, self._now()),
            )

    def record_delegated(self, action: str) -> None:
        clean_action = str(action or "").strip()
        if clean_action not in ROUTINE_CURATION_ACTIONS:
            return
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE mcp_delegation_trust
                SET delegated_count = delegated_count + 1, last_delegated_at = ?
                WHERE principal = ? AND action = ?
                """,
                (self._now(), self.principal(), clean_action),
            )

    def decision(self, *, action: str, payload: dict[str, Any] | None, lane: str) -> DelegationDecision:
        clean_action = str(action or "").strip()
        affected = affected_asset_count(payload)
        required = self.policy.minimum_confirmed_actions
        if self.policy.mode != "progressive":
            return DelegationDecision(False, "manual_mode", 0, required, affected)
        if lane != "write" or clean_action not in self.policy.allowed_actions:
            return DelegationDecision(False, "action_not_eligible", 0, required, affected)
        if affected > self.policy.maximum_affected_assets:
            return DelegationDecision(False, "asset_limit_exceeded", 0, required, affected)
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT confirmed_count, last_confirmed_at
                FROM mcp_delegation_trust
                WHERE principal = ? AND action = ?
                """,
                (self.principal(), clean_action),
            ).fetchone()
        count = int(row["confirmed_count"] or 0) if row is not None else 0
        if row is None or count < required:
            return DelegationDecision(False, "trust_threshold_not_met", count, required, affected)
        try:
            last_confirmed = datetime.fromisoformat(str(row["last_confirmed_at"] or ""))
        except ValueError:
            last_confirmed = datetime.min.replace(tzinfo=timezone.utc)
        if last_confirmed.tzinfo is None:
            last_confirmed = last_confirmed.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - last_confirmed > timedelta(days=self.policy.trust_ttl_days):
            return DelegationDecision(False, "trust_expired", count, required, affected)
        return DelegationDecision(True, "trust_threshold_met", count, required, affected)

    def status(self, action: str) -> dict[str, Any]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT confirmed_count, delegated_count, last_confirmed_at, last_delegated_at
                FROM mcp_delegation_trust
                WHERE principal = ? AND action = ?
                """,
                (self.principal(), str(action or "").strip()),
            ).fetchone()
        return dict(row) if row is not None else {}

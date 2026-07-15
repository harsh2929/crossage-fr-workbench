from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile

from crossage_fr.mcp_delegation import (
    DelegationPolicy,
    ElicitationRateLimiter,
    SQLiteDelegationTrust,
    affected_asset_count,
)


def main() -> None:
    assert affected_asset_count({"assetId": "asset-1"}) == 1
    assert affected_asset_count({"updates": [{"assetId": "asset-1"}, {"assetId": "asset-2"}]}) == 2
    assert affected_asset_count({"assetIds": ["asset-1", "asset-2", "asset-3"]}) == 3

    clock = {"value": 100.0}
    limiter = ElicitationRateLimiter(maximum_requests=2, window_seconds=60, clock=lambda: clock["value"])
    assert limiter.allow("principal-a")
    assert limiter.allow("principal-a")
    assert not limiter.allow("principal-a")
    assert limiter.allow("principal-b")
    clock["value"] += 61
    assert limiter.allow("principal-a")

    owner = {"value": "principal-a"}
    progressive = DelegationPolicy(
        mode="progressive",
        minimum_confirmed_actions=2,
        maximum_affected_assets=2,
        trust_ttl_days=30,
    )
    with tempfile.TemporaryDirectory(prefix="vintrace-mcp-delegation-") as tmp:
        database = Path(tmp) / "mcp_delegation.sqlite3"
        trust = SQLiteDelegationTrust(database, principal=lambda: owner["value"], policy=progressive)
        action = "update_photo_asset_metadata"
        assert trust.decision(action=action, payload={"assetId": "asset-1"}, lane="write").reason == "trust_threshold_not_met"
        trust.record_confirmed(action)
        trust.record_confirmed(action)
        accepted = trust.decision(action=action, payload={"assetId": "asset-1"}, lane="write")
        assert accepted.allowed and accepted.confirmed_count == 2

        too_many = trust.decision(
            action=action,
            payload={"assetIds": ["asset-1", "asset-2", "asset-3"]},
            lane="write",
        )
        assert not too_many.allowed and too_many.reason == "asset_limit_exceeded"
        assert not trust.decision(action="delete_photo_album", payload={}, lane="destructive").allowed

        owner["value"] = "principal-b"
        isolated = trust.decision(action=action, payload={"assetId": "asset-1"}, lane="write")
        assert not isolated.allowed and isolated.confirmed_count == 0
        owner["value"] = "principal-a"

        restarted = SQLiteDelegationTrust(database, principal=lambda: owner["value"], policy=progressive)
        assert restarted.decision(action=action, payload={"assetId": "asset-1"}, lane="write").allowed
        restarted.record_delegated(action)
        assert restarted.status(action)["delegated_count"] == 1

        expired_at = (datetime.now(timezone.utc) - timedelta(days=31)).isoformat()
        with restarted._connect() as connection:
            connection.execute(
                "UPDATE mcp_delegation_trust SET last_confirmed_at = ? WHERE principal = ? AND action = ?",
                (expired_at, owner["value"], action),
            )
        expired = restarted.decision(action=action, payload={"assetId": "asset-1"}, lane="write")
        assert not expired.allowed and expired.reason == "trust_expired"

        manual = SQLiteDelegationTrust(
            Path(tmp) / "manual.sqlite3",
            principal=lambda: owner["value"],
            policy=DelegationPolicy(mode="manual"),
        )
        for _ in range(10):
            manual.record_confirmed(action)
        assert manual.decision(action=action, payload={}, lane="write").reason == "manual_mode"

    print("ok progressive delegation thresholds, limits, expiry, persistence, and principal isolation")


if __name__ == "__main__":
    main()

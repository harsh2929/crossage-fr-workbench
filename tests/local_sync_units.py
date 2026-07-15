#!/usr/bin/env python3
"""Acceptance coverage for encrypted local-first catalog synchronization."""

from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import time
from typing import Any

from crossage_fr.api_server import DesktopApi
import crossage_fr.local_sync as local_sync_module
from crossage_fr.local_sync import (
    LOCAL_SYNC_FIELDS,
    LocalSyncError,
    LocalSyncIntegrityError,
    LocalSyncManager,
)
from crossage_fr.store.workspace_db import WorkspaceDb
from crossage_fr.store.workspace_encryption import (
    FILE_MAGIC,
    WORKSPACE_DB_KEY_ENV,
    WORKSPACE_DB_REQUIRED_ENV,
    WorkspaceEncryption,
    WorkspaceEncryptionError,
    encode_workspace_key,
)
from crossage_fr.workspace_registry import now_iso


CONTENT = b"vintrace-local-sync-media-fixture-v1\0" + bytes(range(64))
CONTENT_HASH = hashlib.sha256(CONTENT).hexdigest()


def assert_raises(error_type: type[BaseException], callback: Any, contains: str = "") -> BaseException:
    try:
        callback()
    except error_type as exc:
        if contains:
            assert contains.casefold() in str(exc).casefold(), str(exc)
        return exc
    raise AssertionError(f"Expected {error_type.__name__}")


def make_manager(root: Path, name: str, *, encrypted: bool = True) -> tuple[WorkspaceDb, LocalSyncManager]:
    workspace = root / name
    encryption = WorkspaceEncryption(
        workspace,
        hashlib.sha256(f"local-sync-key:{name}".encode("utf-8")).digest() if encrypted else None,
        required=encrypted,
    )
    db = WorkspaceDb(workspace / "workspace.sqlite3", encryption=encryption)
    return db, LocalSyncManager(workspace, db, encryption)


def insert_asset(db: WorkspaceDb, root: Path, name: str, *, content_hash: str = CONTENT_HASH) -> tuple[str, Path]:
    source = root / f"{name}.jpg"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(CONTENT)
    asset_id = "asset_" + hashlib.sha256(str(source).encode("utf-8")).hexdigest()[:32]
    timestamp = now_iso()
    with db.connect() as conn:
        conn.execute(
            """
            INSERT INTO photo_assets(
                asset_id, source_path, content_hash, media_kind, mime_type,
                width, height, capture_date, added_at, updated_at
            ) VALUES(?, ?, ?, 'image', 'image/jpeg', 8, 8, '', ?, ?)
            """,
            (asset_id, str(source), content_hash, timestamp, timestamp),
        )
        conn.execute(
            "INSERT INTO photo_asset_metadata(asset_id, updated_at) VALUES(?, ?)",
            (asset_id, timestamp),
        )
    return asset_id, source


def metadata(db: WorkspaceDb, asset_id: str) -> dict[str, Any]:
    row = db.photo_asset_metadata_by_id(asset_id)
    return {**row, "keywords": db.list_photo_asset_keywords(asset_id)}


def operations(manager: LocalSyncManager) -> list[dict[str, Any]]:
    return manager.export_operations({})["operations"]


def pair(first: LocalSyncManager, second: LocalSyncManager) -> tuple[str, str, str]:
    first_status = first.initialize("Studio Mac")
    second_status = second.initialize("Travel laptop")
    invitation = first.create_invitation(host="127.0.0.1")
    accepted = second.accept_invitation(invitation["invitation"], host="127.0.0.1")
    assert accepted["paired"] is True
    first_id = str(first_status["deviceId"])
    second_id = str(second_status["deviceId"])
    assert accepted["peer"]["deviceId"] == first_id
    assert first.status()["peers"][0]["deviceId"] == second_id
    assert accepted["peer"]["host"] == "127.0.0.1"
    assert first.status()["peers"][0]["host"] == "127.0.0.1"
    return first_id, second_id, invitation["invitation"]


def test_encryption_is_mandatory(root: Path) -> None:
    _db, manager = make_manager(root, "unencrypted", encrypted=False)
    status = manager.status()
    assert status["available"] is False
    assert status["encryptionReady"] is False
    assert status["discoveryRuntime"]["zeroconfVersion"] == "0.149.17"
    assert status["discoveryRuntime"]["ifaddrVersion"] == "0.2.0"
    assert_raises(WorkspaceEncryptionError, lambda: manager.initialize("Unsafe"), "requires")
    assert not manager.root.exists()


def test_pair_sync_conflict_replay_revocation_and_recovery(root: Path) -> None:
    first_db, first = make_manager(root, "first")
    second_db, second = make_manager(root, "second")
    first_asset, first_source = insert_asset(first_db, root / "media-a", "shared")
    second_asset, second_source = insert_asset(second_db, root / "media-b", "shared")
    first_db.update_photo_asset_metadata(
        asset_id=first_asset,
        title="Summer harbor",
        caption="Edited on the studio device",
        favorite=True,
        location_override={"label": "Santa Cruz", "latitude": 36.9741, "longitude": -122.0308},
        keywords=["Family", "Harbor"],
        refresh_index=False,
    )
    first_id = second_id = invitation = ""
    try:
        first_id, second_id, invitation = pair(first, second)
        assert first.status()["server"]["discoveryEnabled"] is False
        assert second.status()["server"]["discoveryEnabled"] is False
        assert_raises(LocalSyncError, lambda: second.accept_invitation(invitation, host="127.0.0.1"))

        synced = second.sync_peer(first_id)
        assert synced["ok"] is True and synced["rounds"] >= 1, synced
        received = metadata(second_db, second_asset)
        assert received["title"] == "Summer harbor", received
        assert received["caption"] == "Edited on the studio device", received
        assert received["favorite"] is True, received
        assert received["locationOverride"]["label"] == "Santa Cruz", received
        assert received["keywords"] == ["Family", "Harbor"], received

        serialized = json.dumps(operations(first), sort_keys=True)
        assert str(first_source) not in serialized and str(second_source) not in serialized
        assert CONTENT.hex() not in serialized
        assert "embedding" not in serialized.casefold() and "biometric" not in serialized.casefold()
        assert set(row["field"] for row in operations(first)) <= set(LOCAL_SYNC_FIELDS)
        assert first_source.read_bytes() == CONTENT and second_source.read_bytes() == CONTENT

        fixed_ms = int(time.time() * 1000) + 10
        first_db.update_photo_asset_metadata(asset_id=first_asset, title="Studio choice", refresh_index=False)
        second_db.update_photo_asset_metadata(asset_id=second_asset, title="Travel choice", refresh_index=False)
        first.capture_local_changes(now_ms=fixed_ms)
        second.capture_local_changes(now_ms=fixed_ms)
        first_title = next(row for row in reversed(operations(first)) if row["field"] == "title")
        second_title = next(row for row in reversed(operations(second)) if row["field"] == "title")
        first.merge_operations([second_title], sender_device_id=second_id)
        second.merge_operations([first_title], sender_device_id=first_id)
        expected = "Studio choice" if first_id > second_id else "Travel choice"
        assert metadata(first_db, first_asset)["title"] == expected
        assert metadata(second_db, second_asset)["title"] == expected
        assert first.conflicts()["total"] >= 1 and second.conflicts()["total"] >= 1

        tampered = copy.deepcopy(first_title)
        tampered["value"] = "Unsigned replacement"
        assert_raises(LocalSyncIntegrityError, lambda: second.merge_operations([tampered]), "signature")
        invalid_type = copy.deepcopy(first_title)
        invalid_type["value"] = True
        assert_raises(LocalSyncIntegrityError, lambda: second.merge_operations([invalid_type]), "title")
        equivocation = copy.deepcopy(first_title)
        equivocation["value"] = "Validly signed alternate content"
        first_identity = first._load_identity(create=False)  # noqa: SLF001
        assert first_identity is not None
        signing, _exchange = first._identity_keys(first_identity)  # noqa: SLF001
        equivocation["signature"] = local_sync_module._b64(  # noqa: SLF001
            signing.sign(local_sync_module._canonical_json(local_sync_module._operation_signing_payload(equivocation)))  # noqa: SLF001
        )
        assert_raises(LocalSyncIntegrityError, lambda: second.merge_operations([equivocation]), "reused")
        request_id = "req_" + "a" * 32
        first._record_seen_request(second_id, request_id)  # noqa: SLF001
        assert_raises(
            LocalSyncIntegrityError,
            lambda: first._record_seen_request(second_id, request_id),  # noqa: SLF001
            "replayed",
        )

        recovery = first.export_recovery_bundle("correct horse battery staple")
        assert recovery.startswith("vtrecovery1:")
        assert first_id not in recovery and "Studio Mac" not in recovery
        _restored_db, restored = make_manager(root, "restored")
        original_restored_id = restored.initialize("Replacement")["deviceId"]
        assert original_restored_id != first_id
        assert_raises(LocalSyncError, lambda: restored.restore_recovery_bundle(recovery, "correct horse battery staple"), "confirmation")
        assert_raises(
            LocalSyncIntegrityError,
            lambda: restored.restore_recovery_bundle(recovery, "wrong passphrase", confirm=True),
            "authentication",
        )
        broken = recovery[:-1] + ("A" if recovery[-1] != "A" else "B")
        assert_raises(
            LocalSyncIntegrityError,
            lambda: restored.restore_recovery_bundle(broken, "correct horse battery staple", confirm=True),
            "authentication",
        )
        restored_result = restored.restore_recovery_bundle(recovery, "correct horse battery staple", confirm=True)
        assert restored_result["deviceId"] == first_id
        assert restored_result["peerCount"] == 1

        identity_raw = first.identity_path.read_bytes()
        peers_raw = first.peers_path.read_bytes()
        assert identity_raw.startswith(FILE_MAGIC) and peers_raw.startswith(FILE_MAGIC)
        assert first_id.encode("ascii") not in identity_raw
        assert second_id.encode("ascii") not in peers_raw
        assert b"Studio Mac" not in identity_raw and b"Travel laptop" not in peers_raw
        assert first.identity_path.stat().st_mode & 0o077 == 0
        assert first.peers_path.stat().st_mode & 0o077 == 0

        revoked = first.revoke_peer(second_id)
        assert revoked["peer"]["status"] == "revoked"
        assert_raises(LocalSyncError, lambda: second.sync_peer(first_id), "private network")
    finally:
        first.stop_server()
        second.stop_server()


def test_missing_media_registers_apply_after_import(root: Path) -> None:
    source_db, source = make_manager(root, "pending-source")
    target_db, target = make_manager(root, "pending-target")
    source_asset, _ = insert_asset(source_db, root / "pending-media", "source")
    source.initialize("Source")
    target.initialize("Target")
    source_db.update_photo_asset_metadata(
        asset_id=source_asset,
        title="Arrived before the original",
        favorite=True,
        keywords=["Pending", "Portable"],
        refresh_index=False,
    )
    source.capture_local_changes()
    merged = target.merge_operations(operations(source))
    assert merged["pendingAssets"] == 1
    assert target.status()["counts"]["pendingAssets"] == 1

    target_asset, _ = insert_asset(target_db, root / "pending-media", "target")
    captured = target.capture_local_changes()
    assert captured["capturedEntities"] == 1
    applied = metadata(target_db, target_asset)
    assert applied["title"] == "Arrived before the original", applied
    assert applied["favorite"] is True and applied["keywords"] == ["Pending", "Portable"], applied
    assert target.status()["counts"]["pendingAssets"] == 0


def test_desktop_api_contract_and_secret_redaction(root: Path) -> None:
    names = (
        WORKSPACE_DB_KEY_ENV,
        WORKSPACE_DB_REQUIRED_ENV,
        "VINTRACE_REGISTRY_HOME",
        "CROSSAGE_REGISTRY_HOME",
    )
    saved = {name: os.environ.get(name) for name in names}
    passphrase = "api recovery phrase 2026"
    try:
        registry = root / "api-registry"
        os.environ[WORKSPACE_DB_KEY_ENV] = encode_workspace_key(hashlib.sha256(b"local-sync-api-key").digest())
        os.environ[WORKSPACE_DB_REQUIRED_ENV] = "1"
        os.environ["VINTRACE_REGISTRY_HOME"] = str(registry)
        os.environ["CROSSAGE_REGISTRY_HOME"] = str(registry)
        api = DesktopApi(root / "api-workspace")
        status = api.handle("local_sync_status", {})["value"]
        assert status["encryptionReady"] is True and status["initialized"] is False
        initialized = api.handle("local_sync_initialize", {"label": "API device"})["value"]
        assert initialized["initialized"] is True
        started = api.handle("local_sync_start", {"discovery": False})["value"]
        assert started["server"]["running"] is True
        recovery = api.handle("local_sync_export_recovery", {"passphrase": passphrase})["value"]
        assert recovery["bundle"].startswith("vtrecovery1:")
        assert recovery["scope"] == "device-identity-and-peer-roster-only"
        conflicts = api.handle("local_sync_conflicts", {"limit": 10})["value"]
        assert conflicts == {"total": 0, "conflicts": []}
        stopped = api.handle("local_sync_stop", {})["value"]
        assert stopped["server"]["running"] is False
        assert_raises(ValueError, lambda: api.handle("local_sync_sync_peer", {}), "requires")
        audit = json.dumps(api.project._read_audit_rows(), sort_keys=True)  # noqa: SLF001
        assert passphrase not in audit and recovery["bundle"] not in audit
        assert "local_sync_export_recovery" in audit
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="vintrace-local-sync-") as tmp:
        root = Path(tmp)
        test_encryption_is_mandatory(root)
        test_pair_sync_conflict_replay_revocation_and_recovery(root)
        test_missing_media_registers_apply_after_import(root)
        test_desktop_api_contract_and_secret_redaction(root)
    print("all local_sync_units tests passed")


if __name__ == "__main__":
    main()

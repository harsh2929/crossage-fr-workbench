"""Durable tether-session and capture-ledger acceptance tests.

Run: PYTHONPATH=. CROSSAGE_FORCE_FALLBACK=1 .venv/bin/python tests/photo_tether_units.py
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from PIL import Image

from photo_folders_units import _api, _expect_raises


def _value(api, command: str, params: dict) -> dict:
    result = api.handle(command, params)
    value = result.get("value", {})
    assert isinstance(value, dict), result
    return value


def test_tether_capture_lifecycle_is_idempotent_and_links_real_import() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        incoming = Path(tmp) / "incoming"
        incoming.mkdir()
        photo = incoming / "frame-0001.jpg"
        Image.new("RGB", (32, 24), (30, 110, 180)).save(photo, quality=92)

        session = _value(
            api,
            "create_photo_tether_session",
            {
                "mode": "watch",
                "sourcePath": str(incoming),
                "storageMode": "referenced",
                "sourceLabel": "Studio watch",
                "namingTemplate": "shoot_{sequence:04}",
                "settings": {"autoResume": True, "includeExisting": False, "liveReview": True},
            },
        )
        session_id = session["sessionId"]
        assert session["status"] == "active" and session["nextSequence"] == 1, session

        reserved = _value(api, "reserve_photo_tether_sequence", {"sessionId": session_id})
        assert reserved == {"sessionId": session_id, "sequence": 1, "nextSequence": 2}, reserved

        stat = photo.stat()
        signature = f"{stat.st_size}:{stat.st_mtime_ns}"
        claim = _value(
            api,
            "claim_photo_tether_capture",
            {
                "sessionId": session_id,
                "sourcePath": str(photo),
                "sourceSignature": signature,
                "sizeBytes": stat.st_size,
                "sequence": reserved["sequence"],
                "metadata": {"origin": "watch"},
            },
        )
        assert claim["claimed"] is True and claim["duplicate"] is False, claim
        capture = claim["capture"]
        assert capture["sequence"] == 1 and capture["status"] == "pending", capture

        duplicate = _value(
            api,
            "claim_photo_tether_capture",
            {
                "sessionId": session_id,
                "sourcePath": str(photo),
                "sourceSignature": signature,
            },
        )
        assert duplicate["claimed"] is False and duplicate["duplicate"] is True, duplicate
        assert duplicate["capture"]["captureId"] == capture["captureId"], duplicate

        imported = api.import_photos(
            {
                "sourcePaths": [str(photo)],
                "storageMode": "referenced",
                "sourceKind": "camera",
                "sourceLabel": "Studio watch",
                "sourceDetail": f"Tether session {session_id}",
            }
        )
        assert imported["importedCount"] == 1 and imported["assets"], imported
        asset = imported["assets"][0]
        completed = _value(
            api,
            "complete_photo_tether_capture",
            {
                "captureId": capture["captureId"],
                "targetPath": imported["importedPaths"][0],
                "assetId": asset["assetId"],
                "importId": imported["importId"],
                "metadata": {"origin": "watch", "liveReview": True},
            },
        )
        assert completed["capture"]["status"] == "imported" and completed["idempotent"] is False, completed
        replay = _value(
            api,
            "complete_photo_tether_capture",
            {"captureId": capture["captureId"], "assetId": "must-not-double-count"},
        )
        assert replay["idempotent"] is True and replay["capture"]["assetId"] == asset["assetId"], replay

        status = _value(api, "photo_tether_status", {"sessionId": session_id})["session"]
        assert status["importedCount"] == 1 and status["failedCount"] == 0, status
        assert status["captures"][0]["importId"] == imported["importId"], status
        assert status["nextSequence"] == 2, status

        api.project.db.update_photo_tether_session_status(session_id, "stopped")
        recent = _value(api, "photo_tether_status", {})["recent"][0]
        assert recent["sessionId"] == session_id and recent["captures"][0]["assetId"] == asset["assetId"], recent


def test_tether_failure_retry_and_restart_recovery_are_counted_once() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        incoming = Path(tmp) / "camera"
        incoming.mkdir()
        first = incoming / "first.cr3"
        second = incoming / "second.nef"
        first.write_bytes(b"partial raw fixture")
        second.write_bytes(b"pending raw fixture")

        session = api.project.db.create_photo_tether_session(
            mode="watch",
            source_path=str(incoming),
            settings={"autoResume": True},
        )
        first_claim = api.project.db.claim_photo_tether_capture(
            session_id=session["sessionId"],
            source_path=str(first),
            source_signature="17:1",
            size_bytes=17,
        )["capture"]
        failed = api.project.db.fail_photo_tether_capture(first_claim["captureId"], "camera disconnected")
        assert failed["capture"]["status"] == "failed", failed
        api.project.db.fail_photo_tether_capture(first_claim["captureId"], "camera still disconnected")
        failed_status = api.project.db.photo_tether_session_by_id(session["sessionId"])
        assert failed_status and failed_status["failedCount"] == 1, failed_status

        reclaimed = api.project.db.claim_photo_tether_capture(
            session_id=session["sessionId"],
            source_path=str(first),
            source_signature="17:1",
            retry=True,
        )
        assert reclaimed["claimed"] is True and reclaimed["capture"]["status"] == "pending", reclaimed
        retried_status = api.project.db.photo_tether_session_by_id(session["sessionId"])
        assert retried_status and retried_status["failedCount"] == 0, retried_status
        api.project.db.complete_photo_tether_capture(reclaimed["capture"]["captureId"], asset_id="asset-recovered")

        second_claim = api.project.db.claim_photo_tether_capture(
            session_id=session["sessionId"],
            source_path=str(second),
            source_signature="19:2",
            size_bytes=19,
        )["capture"]
        recovered = _value(api, "recover_photo_tether_sessions", {})
        assert recovered["recoveredSessions"] == 1 and recovered["interruptedCaptures"] == 1, recovered
        after = api.project.db.photo_tether_session_by_id(session["sessionId"])
        assert after and after["status"] == "recoverable", after
        by_id = {capture["captureId"]: capture for capture in after["captures"]}
        assert by_id[second_claim["captureId"]]["status"] == "interrupted", by_id

        resumed = api.project.db.update_photo_tether_session_status(session["sessionId"], "active")
        assert resumed["status"] == "active", resumed
        replayed_recovery = api.project.db.recover_interrupted_photo_tether_sessions()
        assert replayed_recovery["recoveredSessions"] == 1 and replayed_recovery["interruptedCaptures"] == 0, replayed_recovery


def test_tether_rejects_invalid_states_and_competing_active_sessions() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        api = _api(tmp)
        first = Path(tmp) / "first"
        second = Path(tmp) / "second"
        first.mkdir()
        second.mkdir()
        session = api.project.db.create_photo_tether_session(mode="watch", source_path=str(first))
        _expect_raises(
            ValueError,
            lambda: api.project.db.create_photo_tether_session(mode="watch", source_path=str(second)),
            "already active",
        )
        stopped = api.project.db.update_photo_tether_session_status(session["sessionId"], "stopped")
        assert stopped["status"] == "stopped" and stopped["stoppedAt"], stopped
        _expect_raises(
            ValueError,
            lambda: api.project.db.reserve_photo_tether_sequence(session["sessionId"]),
            "not active",
        )
        next_session = api.project.db.create_photo_tether_session(mode="ptp", source_path=str(second))
        assert next_session["mode"] == "ptp", next_session
        _expect_raises(
            ValueError,
            lambda: api.project.db.update_photo_tether_session_status(session["sessionId"], "recoverable"),
            "cannot move",
        )


if __name__ == "__main__":
    test_tether_capture_lifecycle_is_idempotent_and_links_real_import()
    print("ok tether capture lifecycle and real import linkage")
    test_tether_failure_retry_and_restart_recovery_are_counted_once()
    print("ok tether failure retry and restart recovery")
    test_tether_rejects_invalid_states_and_competing_active_sessions()
    print("ok tether invalid-state and single-active-session guards")

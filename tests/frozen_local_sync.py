"""Frozen-backend acceptance for encrypted two-device local catalog sync."""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image


FILE_MAGIC = b"VINTRACE-WS-AESGCM\x01"


def encode_key(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode("ascii").rstrip("=")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def create_media(path: Path) -> None:
    image = Image.new("RGB", (48, 32), (24, 102, 148))
    image.save(path, format="JPEG", quality=91, optimize=False, progressive=False)


def environment(root: Path, workspace: Path, key: bytes) -> dict[str, str]:
    env = os.environ.copy()
    env.update({
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(root / "registry"),
        "CROSSAGE_REGISTRY_HOME": str(root / "registry"),
        "VINTRACE_WORKSPACE_DB_KEY": encode_key(key),
        "VINTRACE_REQUIRE_DB_ENCRYPTION": "1",
        "CROSSAGE_FORCE_FALLBACK": "1",
        "NO_PROXY": "*",
        "no_proxy": "*",
        "HTTP_PROXY": "",
        "HTTPS_PROXY": "",
        "ALL_PROXY": "",
    })
    return env


def start(executable: Path, workspace: Path, env: dict[str, str]) -> subprocess.Popen[str]:
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during startup: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("ready") is True:
            return process
        if row.get("ready") is False:
            raise AssertionError(row)


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during {command}: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def rpc_error(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during {command}: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        assert row.get("ok") is False, row
        return row.get("error", {}) if isinstance(row.get("error"), dict) else {}


def stop(process: subprocess.Popen[str] | None) -> None:
    if process is None:
        return
    if process.stdin is not None:
        process.stdin.close()
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def get_first_asset(process: subprocess.Popen[str], request_id: str) -> dict:
    result = rpc(process, request_id, "list_photo_assets", {"limit": 10})
    assert result.get("total") == 1 and len(result.get("items", [])) == 1, result
    return result["items"][0]


def main() -> None:
    value = str(os.environ.get("VINTRACE_LOCAL_SYNC_TEST_EXECUTABLE", "") or "").strip()
    if not value:
        raise SystemExit("VINTRACE_LOCAL_SYNC_TEST_EXECUTABLE is required.")
    executable = Path(value).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit(f"Frozen backend executable does not exist: {executable}")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-local-sync-") as tmp:
        root = Path(tmp)
        first_workspace = root / "first-workspace"
        second_workspace = root / "second-workspace"
        first_source = root / "first.jpg"
        second_source = root / "second.jpg"
        create_media(first_source)
        shutil.copyfile(first_source, second_source)
        source_sha256 = sha256_file(first_source)
        first_env = environment(root / "first", first_workspace, hashlib.sha256(b"frozen-local-sync-first").digest())
        second_env = environment(root / "second", second_workspace, hashlib.sha256(b"frozen-local-sync-second").digest())
        first = second = None
        try:
            first = start(executable, first_workspace, first_env)
            second = start(executable, second_workspace, second_env)
            first_status = rpc(first, "first-init", "local_sync_initialize", {"label": "Frozen studio"})["value"]
            second_status = rpc(second, "second-init", "local_sync_initialize", {"label": "Frozen travel"})["value"]
            assert first_status["discoveryRuntime"]["available"] is True, first_status
            assert first_status["discoveryRuntime"]["zeroconfVersion"] == "0.149.17", first_status
            assert first_status["discoveryRuntime"]["ifaddrVersion"] == "0.2.0", first_status

            first_import = rpc(first, "first-import", "import_photos", {
                "sourcePaths": [str(first_source)],
                "storageMode": "referenced",
                "sourceLabel": "Frozen local sync",
            })["value"]
            second_import = rpc(second, "second-import", "import_photos", {
                "sourcePaths": [str(second_source)],
                "storageMode": "referenced",
                "sourceLabel": "Frozen local sync",
            })["value"]
            assert first_import.get("importedCount") == 1 and second_import.get("importedCount") == 1
            first_asset_row = get_first_asset(first, "first-assets")
            get_first_asset(second, "second-assets")
            rpc(first, "edit", "update_photo_asset_metadata", {
                "assetId": first_asset_row["assetId"],
                "title": "Frozen harbor catalog marker",
                "caption": "Encrypted peer metadata",
                "favorite": True,
                "keywords": ["Frozen", "Peer"],
            })

            invitation = rpc(first, "invite", "local_sync_create_invitation", {"host": "127.0.0.1"})["value"]
            accepted = rpc(second, "accept", "local_sync_accept_invitation", {
                "invitation": invitation["invitation"],
                "host": "127.0.0.1",
            })["value"]
            assert accepted.get("paired") is True, accepted
            synced = rpc(second, "sync", "local_sync_sync_peer", {"deviceId": first_status["deviceId"]})["value"]
            assert synced.get("ok") is True and synced.get("inserted", 0) >= 1, synced
            updated = get_first_asset(second, "second-updated")
            updated_metadata = updated.get("metadata", {})
            assert updated_metadata.get("title") == "Frozen harbor catalog marker", updated
            assert updated_metadata.get("caption") == "Encrypted peer metadata", updated
            assert updated_metadata.get("favorite") is True, updated
            assert updated_metadata.get("keywords") == ["Frozen", "Peer"], updated
            assert sha256_file(first_source) == source_sha256 == sha256_file(second_source)

            stop(second)
            second = start(executable, second_workspace, second_env)
            persisted_status = rpc(second, "persisted-status", "local_sync_status", {})["value"]
            assert persisted_status["deviceId"] == second_status["deviceId"], persisted_status
            assert persisted_status["peers"][0]["deviceId"] == first_status["deviceId"], persisted_status
            persisted = get_first_asset(second, "persisted-asset")
            assert persisted.get("metadata", {}).get("title") == "Frozen harbor catalog marker", persisted

            revoked = rpc(first, "revoke", "local_sync_revoke_peer", {"deviceId": second_status["deviceId"]})["value"]
            assert revoked["peer"]["status"] == "revoked", revoked
            denied = rpc_error(second, "denied", "local_sync_sync_peer", {"deviceId": first_status["deviceId"]})
            assert denied.get("code") == "E-SYNC-LOCAL", denied
        finally:
            stop(second)
            stop(first)

        for workspace in (first_workspace, second_workspace):
            identity = workspace / "local-sync" / "identity.json"
            peers = workspace / "local-sync" / "peers.json"
            assert identity.read_bytes().startswith(FILE_MAGIC)
            assert peers.read_bytes().startswith(FILE_MAGIC)
            database = (workspace / "workspace.sqlite3").read_bytes()
            assert b"Frozen harbor catalog marker" not in database
            assert not database.startswith(b"SQLite format 3\x00")

    print(json.dumps({
        "frozen": True,
        "twoProcessPairing": True,
        "sqlcipherWorkspaces": True,
        "zeroconfRuntime": "0.149.17",
        "metadataConvergence": True,
        "restartPersistence": True,
        "revocationEnforced": True,
        "mediaTransfer": False,
        "biometricTransfer": False,
        "executableSha256": sha256_file(executable),
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

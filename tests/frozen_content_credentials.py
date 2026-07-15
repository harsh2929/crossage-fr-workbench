from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image


FILE_MAGIC = b"VINTRACE-WS-AESGCM\x01"


def encode_key(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode("ascii").rstrip("=")


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited during startup: {stderr[-2000:]}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def start_backend(executable: Path, workspace: Path, registry: Path, key: bytes) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update(
        {
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(registry),
            "CROSSAGE_REGISTRY_HOME": str(registry),
            "VINTRACE_WORKSPACE_DB_KEY": encode_key(key),
            "VINTRACE_REQUIRE_DB_ENCRYPTION": "1",
            "CROSSAGE_FORCE_FALLBACK": "1",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "NO_PROXY": "*",
            "no_proxy": "*",
            "HTTP_PROXY": "",
            "HTTPS_PROXY": "",
            "ALL_PROXY": "",
            "http_proxy": "",
            "https_proxy": "",
            "all_proxy": "",
        }
    )
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    wait_ready(process)
    return process


def stop_backend(process: subprocess.Popen[str]) -> None:
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


def main() -> None:
    executable = Path(
        str(
            os.environ.get("VINTRACE_CONTENT_CREDENTIALS_TEST_EXECUTABLE", "")
            or os.environ.get("VINTRACE_GENERATIVE_TEST_EXECUTABLE", "")
            or ""
        )
    ).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_CONTENT_CREDENTIALS_TEST_EXECUTABLE must point to the frozen backend.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-c2pa-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        source = root / "source.jpg"
        Image.new("RGB", (72, 48), (42, 96, 156)).save(source, quality=95)
        source_sha256 = hash_file(source)
        workspace_key = b"f" * 32

        process = start_backend(executable, workspace, registry, workspace_key)
        try:
            status = rpc(process, "status", "photo_content_credentials_status", {}).get("value", {})
            assert status.get("available") is True, status
            assert status.get("policyVersion") == "vintrace-c2pa-v1", status
            assert status.get("specVersion") == "2.4", status
            assert status.get("packageVersion") == "0.36.0", status
            assert status.get("nativeSdkVersion") == "0.89.0", status
            assert status.get("offline") is True and status.get("remoteManifestFetch") is False, status
            assert status.get("globallyTrusted") is False and status.get("timestamped") is False, status

            imported = rpc(
                process,
                "import",
                "import_photos",
                {"sourcePaths": [str(source)], "storageMode": "referenced"},
            ).get("value", {})
            assert imported.get("importedCount") == 1, imported
            asset_id = str(imported.get("assets", [{}])[0].get("assetId", ""))
            assert asset_id, imported
            rpc(
                process,
                "edit",
                "save_photo_edit_stack",
                {"assetId": asset_id, "operations": [{"kind": "image_crop_rotate", "rotateDegrees": 90}]},
            )
            exported = rpc(
                process,
                "rendered-export",
                "export_photo_selection",
                {
                    "sourcePaths": [str(source)],
                    "folder": str(root / "rendered-exports"),
                    "exportVariant": "rendered",
                    "renderFormat": "jpeg",
                    "allowRenderFallback": False,
                },
            ).get("value", {})
            assert exported.get("counts", {}).get("contentCredentialsSigned") == 1, exported
            row = exported.get("items", [{}])[0]
            assert row.get("contentCredentialStatus") == "signed", row
            signed_path = Path(str(row.get("targetPath", "")))
            assert signed_path.is_file() and hash_file(signed_path) != source_sha256, row
            summary = row.get("contentCredentials", {})
            assert summary.get("present") is True and summary.get("embedded") is True, summary
            assert summary.get("cryptographicallyValid") is True and summary.get("locallyTrusted") is True, summary
            assert summary.get("globallyTrusted") is False and summary.get("trustScope") == "workspace-local", summary
            assert summary.get("topLevelAiEdit") is False and summary.get("containsAiHistory") is False, summary
            assert [item.get("action") for item in summary.get("actions", [])] == ["c2pa.opened", "c2pa.edited"], summary
            assert str(source).encode() not in signed_path.read_bytes()

            identity_path = workspace / "content-credentials" / "signing-identity.json"
            identity_bytes = identity_path.read_bytes()
            assert identity_bytes.startswith(FILE_MAGIC), identity_bytes[:32]
            assert b"PRIVATE KEY" not in identity_bytes and b"CERTIFICATE" not in identity_bytes

            inbound = rpc(
                process,
                "import-signed",
                "import_photos",
                {"sourcePaths": [str(signed_path)], "storageMode": "referenced"},
            ).get("value", {})
            assert inbound.get("contentCredentials", {}).get("preservedCount") == 1, inbound
            signed_asset_id = str(inbound.get("assets", [{}])[0].get("assetId", ""))
            original_export = rpc(
                process,
                "original-export",
                "export_photo_selection",
                {
                    "sourcePaths": [str(signed_path)],
                    "folder": str(root / "original-exports"),
                    "exportVariant": "original",
                },
            ).get("value", {})
            original_row = original_export.get("items", [{}])[0]
            preserved_path = Path(str(original_row.get("targetPath", "")))
            assert preserved_path.read_bytes() == signed_path.read_bytes()
            assert original_row.get("contentCredentialStatus") == "preserved-original", original_row
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry, workspace_key)
        try:
            restarted_status = rpc(reopened, "restart-status", "photo_content_credentials_status", {}).get("value", {})
            assert restarted_status.get("identityPersisted") is True, restarted_status
            assert restarted_status.get("identityEncrypted") is True, restarted_status
            inspected = rpc(
                reopened,
                "inspect",
                "inspect_photo_content_credentials",
                {"assetId": signed_asset_id, "scope": "original"},
            ).get("value", {})
            restart_summary = inspected.get("contentCredentials", {})
            assert restart_summary.get("locallyTrusted") is True, inspected
            assert restart_summary.get("globallyTrusted") is False, inspected
            assert restart_summary.get("manifestId") == summary.get("manifestId"), inspected
        finally:
            stop_backend(reopened)

        print(
            json.dumps(
                {
                    "frozen": True,
                    "packageVersion": "0.36.0",
                    "nativeSdkVersion": "0.89.0",
                    "specVersion": "2.4",
                    "identityEncrypted": True,
                    "restartTrust": True,
                    "renderedSigned": True,
                    "ordinaryEditNotAi": True,
                    "originalCredentialPreserved": True,
                    "globallyTrusted": False,
                    "timestamped": False,
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()

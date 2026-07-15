from __future__ import annotations

from hashlib import sha256
import json
import os
from pathlib import Path
import subprocess
import tempfile

from PIL import Image


def wait_ready(process: subprocess.Popen[str]) -> None:
    assert process.stdout is not None
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during startup: {process.poll()}")
        row = json.loads(line)
        if row.get("ready") is True:
            return
        if row.get("ready") is False:
            raise AssertionError(row)


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": request_id, "command": command, "params": params}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") != request_id or "ok" not in row:
            continue
        if row.get("ok") is not True:
            raise AssertionError(row)
        result = row.get("result", {})
        value = result.get("value", result) if isinstance(result, dict) else {}
        return value if isinstance(value, dict) else {}


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = {
        **os.environ,
        "VINTRACE_WORKSPACE": str(workspace),
        "CROSSAGE_WORKSPACE": str(workspace),
        "VINTRACE_REGISTRY_HOME": str(registry),
        "CROSSAGE_REGISTRY_HOME": str(registry),
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
    process = subprocess.Popen(
        [str(executable), "--workspace", str(workspace)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
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
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def frozen_backend_executable() -> Path:
    configured = str(os.environ.get("VINTRACE_PORTABILITY_TEST_EXECUTABLE", "") or "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    root = Path(__file__).resolve().parents[1]
    names = ("crossage-backend.exe", "crossage-backend") if os.name == "nt" else ("crossage-backend",)
    candidates = [root / "backend-dist" / "crossage-backend" / name for name in names]
    candidates.extend(root / "backend-dist" / name for name in names)
    return next((candidate.resolve() for candidate in candidates if candidate.is_file()), candidates[0].resolve())


def main() -> None:
    executable = frozen_backend_executable()
    if not executable.is_file():
        raise SystemExit(
            "Build the frozen backend or set VINTRACE_PORTABILITY_TEST_EXECUTABLE to its executable."
        )

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-photo-portability-") as temp_value:
        root = Path(temp_value)
        source_workspace = root / "source-workspace"
        target_workspace = root / "target-workspace"
        export_root = root / "exports"
        managed_root = root / "managed"
        export_root.mkdir()
        managed_root.mkdir()
        original = root / "Frozen Portfolio.jpg"
        Image.new("RGB", (96, 72), (42, 116, 205)).save(original, quality=94)
        sidecar = original.with_suffix(".xmp")
        sidecar.write_text("<x:xmpmeta>frozen portability</x:xmpmeta>", encoding="utf-8")
        original_bytes = original.read_bytes()
        sidecar_bytes = sidecar.read_bytes()

        source = start_backend(executable, source_workspace, root / "source-registry")
        try:
            status = rpc(source, "status", "photo_catalog_status", {})
            assert status.get("formatVersion") == 1 and status.get("pathFree") is True, status
            imported = rpc(source, "seed", "import_photos", {
                "sourcePaths": [str(original)],
                "storageMode": "referenced",
                "sourceLabel": "Frozen portability acceptance",
            })
            assert imported.get("importedCount") == 1, imported
            rpc(source, "metadata", "update_photo_asset_metadata", {
                "sourcePath": str(original),
                "title": "Frozen portfolio",
                "rating": 5,
                "colorLabel": "blue",
                "pickStatus": "pick",
            })
            album = rpc(source, "album", "save_photo_album", {
                "name": "Frozen selects",
                "albumKind": "manual",
            })
            rpc(source, "membership", "add_photo_album_items", {
                "albumId": album["albumId"],
                "sourcePaths": [str(original)],
            })
            exported = rpc(source, "export", "export_open_photo_catalog", {
                "destination": str(export_root),
                "packageName": "frozen-roundtrip",
                "includeOriginals": True,
                "includeSidecars": True,
            })
            package = Path(exported["catalogPath"])
            exported_assets = int(exported.get("counts", {}).get("assets", 0) or 0)
            assert exported.get("verified") is True and exported_assets >= 1, exported
            assert exported.get("counts", {}).get("sidecars", 0) >= 1, exported
            inspected = rpc(source, "inspect", "inspect_open_photo_catalog", {
                "catalogPath": str(package),
                "verifyMedia": True,
            })
            assert inspected.get("fullyVerified") is True and inspected.get("semanticVerified") is True, inspected
        finally:
            stop_backend(source)

        assert original.read_bytes() == original_bytes and sidecar.read_bytes() == sidecar_bytes
        catalog_text = b"".join(
            path.read_bytes()
            for path in sorted(package.rglob("*"))
            if path.is_file() and path.suffix in {".json", ".ndjson"}
        )
        assert str(root).encode() not in catalog_text

        target = start_backend(executable, target_workspace, root / "target-registry")
        try:
            restored = rpc(target, "restore", "import_open_photo_catalog", {
                "catalogPath": str(package),
                "managedRoot": str(managed_root),
                "mergeByHash": True,
            })
            assert restored.get("verified") is True, restored
            assert restored.get("counts", {}).get("created") == exported_assets, restored
            page = rpc(target, "album-page", "list_photo_folder_items", {
                "folderId": f"album:{album['albumId']}",
                "sort": "manual",
                "previewBudget": 0,
            })
            assert len(page.get("items", [])) == 1, page
            item = page["items"][0]
            assert item.get("title") == "Frozen portfolio" and item.get("rating") == 5, item
            assert item.get("colorLabel") == "blue" and item.get("pickStatus") == "pick", item
            restored_original = Path(item["sourcePath"])
            assert restored_original.read_bytes() == original_bytes
            restored_sidecars = [path for path in managed_root.rglob("*.xmp") if path.is_file()]
            assert any(path.read_bytes() == sidecar_bytes for path in restored_sidecars), restored_sidecars
            repeated = rpc(target, "repeat", "import_open_photo_catalog", {
                "catalogPath": str(package),
                "managedRoot": str(managed_root),
                "mergeByHash": True,
            })
            assert repeated.get("counts", {}).get("created") == 0, repeated
            assert repeated.get("counts", {}).get("merged") == exported_assets, repeated
        finally:
            stop_backend(target)

        package_hash = sha256((package / "manifest.json").read_bytes()).hexdigest()
        assert len(package_hash) == 64
    print("frozen photo catalog portability ok")


if __name__ == "__main__":
    main()

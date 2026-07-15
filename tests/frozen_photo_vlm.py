from __future__ import annotations

from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile


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
        if not row.get("ok"):
            raise AssertionError(row)
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


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


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update(
        {
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_REGISTRY_HOME": str(registry),
            "CROSSAGE_REGISTRY_HOME": str(registry),
            "CROSSAGE_FORCE_FALLBACK": "1",
        }
    )
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
        process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_VLM_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    installed_root = Path(str(os.environ.get("VINTRACE_VLM_TEST_MODEL_ROOT", "") or "")).expanduser().resolve()
    fixture = Path(str(os.environ.get("VINTRACE_VLM_TEST_FIXTURE", "") or "tests/fixtures/ocr/paddleocr-general-ocr-002.jpg")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_VLM_TEST_EXECUTABLE must point to the frozen backend.")
    if not installed_root.is_dir():
        raise SystemExit("VINTRACE_VLM_TEST_MODEL_ROOT must point to a verified installed VLM root.")
    if not fixture.is_file():
        raise SystemExit(f"Missing VLM fixture: {fixture}")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-vlm-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        registry_model_root = registry / "models" / "vlm"
        registry_model_root.parent.mkdir(parents=True, exist_ok=True)
        try:
            registry_model_root.symlink_to(installed_root, target_is_directory=True)
        except OSError:
            shutil.copytree(installed_root, registry_model_root, copy_function=shutil.copy2)

        process = start_backend(executable, workspace, registry)
        try:
            status = rpc(process, "status", "photo_vlm_status", {"tier": "quality"}).get("value", {})
            assert status.get("catalogSha256") == "63a31351f11b68fdeb9f739061df5e1fc85fae6dd25914bb589eabe8af19cc75", status
            assert status.get("route", {}).get("tier") == "quality", status
            assert status.get("runtime", {}).get("revision") == "76f2798059575a96a12e4d34342165a4b6a6a312", status

            imported = rpc(
                process,
                "import",
                "import_photos",
                {"sourcePaths": [str(fixture)], "storageMode": "referenced", "sourceLabel": "Frozen VLM acceptance"},
            ).get("value", {})
            source_path = str((imported.get("importedPaths") or [str(fixture)])[0])
            rpc(
                process,
                "settings",
                "save_photo_library_settings",
                {
                    "localSettings": {
                        "localIntelligenceEnabled": True,
                        "noNetworkIntelligence": True,
                        "backgroundIndexingPaused": False,
                        "indexingPowerMode": "balanced",
                        "visionModelTier": "quality",
                    }
                },
            )
            result = rpc(
                process,
                "index",
                "index_photo_objects",
                {"sourcePaths": [source_path], "force": True, "useModel": True, "modelTier": "quality"},
            ).get("value", {})
            assert result.get("progress", {}).get("modelUpdated") == 1, result
            assert result.get("progress", {}).get("captionUpdated") == 1, result
            item = (result.get("items") or [{}])[0]
            metadata = item.get("assetMetadata", {})
            local_vision = metadata.get("localVision", {})
            assert local_vision.get("source") == "vlm-qwen3-vl", local_vision
            assert local_vision.get("model", {}).get("offline") is True, local_vision
            assert local_vision.get("model", {}).get("modelLicense") == "Apache-2.0", local_vision
            assert local_vision.get("caption"), local_vision
            assert len(local_vision.get("tags", [])) >= 3, local_vision
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            search = rpc(reopened, "search", "search_photo_library", {"query": "fuzhou"})
            groups = search.get("groups", {})
            if isinstance(groups, dict):
                photos = groups.get("photos", {})
            else:
                photos = next((group for group in groups if isinstance(group, dict) and group.get("id") == "photos"), {})
            assert int(photos.get("count", len(photos.get("items", []))) or 0) >= 1, search
            status = rpc(reopened, "object-status", "photo_object_index_status", {}).get("value", {})
            assert status.get("indexed", 0) >= 1, status
            agent_status = rpc(reopened, "agent-status", "photo_library_agent_status", {}).get("value", {})
            assert agent_status.get("available") is True, agent_status
            assert agent_status.get("offline") is True, agent_status
            agent = rpc(
                reopened,
                "agent-query",
                "query_photo_library_agent",
                {"query": "Which boarding pass mentions Fuzhou?", "modelTier": "quality"},
            ).get("value", {})
            assert agent.get("offline") is True, agent
            assert agent.get("answer"), agent
            assert agent.get("citations"), agent
            assert any(row.get("tool") == "search_images" and row.get("ok") for row in agent.get("toolTrace", [])), agent
            assert source_path not in json.dumps(agent), agent
        finally:
            stop_backend(reopened)

        print(
            json.dumps(
                {
                    "frozen": True,
                    "tier": "quality",
                    "runtimeRevision": "76f2798059575a96a12e4d34342165a4b6a6a312",
                    "captionPersisted": True,
                    "tagsPersisted": True,
                    "restartSearch": True,
                    "agentQuery": True,
                    "agentCitations": True,
                    "offline": True,
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()

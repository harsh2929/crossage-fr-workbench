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
        }
    )
    for key in ("CROSSAGE_FORCE_FALLBACK", "VINTRACE_FORCE_FALLBACK", "CROSSAGE_SAFE_MODE_ENGINE", "VINTRACE_SAFE_MODE_ENGINE"):
        env.pop(key, None)
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


def install_model_link(registry: Path, installed_root: Path) -> None:
    destination = registry / "models" / "vlm"
    destination.parent.mkdir(parents=True, exist_ok=True)
    try:
        destination.symlink_to(installed_root, target_is_directory=True)
    except OSError:
        shutil.copytree(installed_root, destination, copy_function=shutil.copy2)


def assert_quality_report(state: dict, *, enabled: bool) -> None:
    assert state.get("config", {}).get("safeModeMultimodal") is enabled, state.get("config")
    report = state.get("safeModeModel", {})
    if enabled:
        assert report.get("engine") == "multimodal-hybrid", report
        assert report.get("categoryAware") is True, report
        assert report.get("multimodalEnabled") is True, report
        assert report.get("modelTier") == "quality", report
        assert report.get("modelName") == "Qwen/Qwen3-VL-4B-Instruct-GGUF", report
        assert report.get("policyVersion") == "vintrace-visual-safety-v1", report
        assert report.get("csamHashMatching") is False, report
        assert report.get("fallback", {}).get("available") is True, report
    else:
        guardrail = report.get("multimodal", {})
        assert report.get("categoryAware") is False, report
        assert report.get("multimodalEnabled") is False, report
        assert guardrail.get("available") is True, report
        assert guardrail.get("modelTier") == "quality", report


def main() -> None:
    executable = Path(str(os.environ.get("VINTRACE_MULTIMODAL_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    installed_root = Path(str(os.environ.get("VINTRACE_VLM_TEST_MODEL_ROOT", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_MULTIMODAL_TEST_EXECUTABLE must point to the frozen backend.")
    if not installed_root.is_dir():
        raise SystemExit("VINTRACE_VLM_TEST_MODEL_ROOT must point to the verified installed VLM root.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-multimodal-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        install_model_link(registry, installed_root)

        process = start_backend(executable, workspace, registry)
        try:
            initial = rpc(process, "initial", "get_state", {"previewBudget": 0, "candidateLimit": 1})
            assert_quality_report(initial, enabled=False)
            enabled_state = rpc(
                process,
                "enable",
                "save_settings",
                {"safeMode": True, "safeModeMultimodal": True, "source": "frozen-acceptance"},
            )
            assert_quality_report(enabled_state, enabled=True)
        finally:
            stop_backend(process)

        reopened = start_backend(executable, workspace, registry)
        try:
            state = rpc(reopened, "reopened", "get_state", {"previewBudget": 0, "candidateLimit": 1})
            assert_quality_report(state, enabled=True)
        finally:
            stop_backend(reopened)

        print(
            json.dumps(
                {
                    "frozen": True,
                    "qualityTierRequired": True,
                    "policyVersion": "vintrace-visual-safety-v1",
                    "configPersisted": True,
                    "restartPersistence": True,
                    "fallbackPresent": True,
                    "csamHashMatching": False,
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()

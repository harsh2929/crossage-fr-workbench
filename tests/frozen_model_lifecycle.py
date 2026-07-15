"""Frozen-backend acceptance for packaged model lifecycle evidence and state."""

from __future__ import annotations

from pathlib import Path
import json
import os
import subprocess
import tempfile


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


def rpc(process: subprocess.Popen[str], request_id: str, command: str, params: dict, *, expect_ok: bool = True) -> dict:
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
        if bool(row.get("ok")) != expect_ok:
            raise AssertionError(row)
        if not expect_ok:
            error = row.get("error", {})
            return error if isinstance(error, dict) else {"message": str(error)}
        result = row.get("result", {})
        return result if isinstance(result, dict) else {}


def start_backend(executable: Path, workspace: Path, registry: Path) -> subprocess.Popen[str]:
    env = os.environ.copy()
    env.update({
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
    })
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
    executable = Path(str(os.environ.get("VINTRACE_MODEL_LIFECYCLE_TEST_EXECUTABLE", "") or "")).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_MODEL_LIFECYCLE_TEST_EXECUTABLE must point to the frozen backend.")
    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-model-lifecycle-") as tmp:
        root = Path(tmp)
        workspace = root / "workspace"
        registry = root / "registry"
        process = start_backend(executable, workspace, registry)
        try:
            status = rpc(process, "status", "model_lifecycle_status", {})
            assert status.get("policyVersion") == "2026-07-13.3", status
            assert status.get("policySha256") == "1b5a466c5f39d1a7deecbbbe83e5a961e91473444385fd31f7ddf485d9ccb8e6", status
            assert status.get("offlineOnly") is True, status
            assert status.get("ready") is True, status
            assert status.get("counts", {}).get("components") == 9, status
            assert status.get("counts", {}).get("blocked") == 0, status
            assert status.get("counts", {}).get("datasetManifestsVerified") == 9, status
            assert all(item.get("baseline", {}).get("integrity") is True for item in status.get("components", [])), status
            evaluated = rpc(process, "evaluate", "run_model_lifecycle_evaluation", {})
            assert evaluated.get("ready") is True, evaluated
        finally:
            stop_backend(process)

        state_path = workspace / "model-lifecycle" / "state.json"
        assert state_path.is_file() and not state_path.is_symlink(), state_path
        if os.name != "nt":
            assert state_path.stat().st_mode & 0o777 == 0o600, oct(state_path.stat().st_mode & 0o777)

        process = start_backend(executable, workspace, registry)
        try:
            restarted = rpc(process, "restart", "model_lifecycle_status", {})
            assert restarted.get("state", {}).get("configurationHistory") == 1, restarted
        finally:
            stop_backend(process)

        envelope = json.loads(state_path.read_text(encoding="utf-8"))
        envelope["payload"]["configurationHistory"][0]["configuration"]["modelPack"] = "tampered"
        state_path.write_text(json.dumps(envelope), encoding="utf-8")
        process = start_backend(executable, workspace, registry)
        try:
            failed = rpc(process, "tampered", "model_lifecycle_status", {}, expect_ok=False)
            assert failed.get("type") == "ModelLifecycleIntegrityError", failed
            assert "integrity" in str(failed.get("message", "")).lower(), failed
        finally:
            stop_backend(process)
    print("frozen model lifecycle acceptance ok")


if __name__ == "__main__":
    main()

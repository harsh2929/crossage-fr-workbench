from __future__ import annotations

import json
import os
from pathlib import Path
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


def rpc(process: subprocess.Popen[str], command: str) -> dict:
    assert process.stdin is not None and process.stdout is not None
    process.stdin.write(json.dumps({"id": "dependency-currency", "command": command, "params": {}}) + "\n")
    process.stdin.flush()
    while True:
        line = process.stdout.readline()
        if not line:
            raise AssertionError(f"Frozen backend exited during {command}: {process.poll()}")
        row = json.loads(line)
        if row.get("id") != "dependency-currency" or "ok" not in row:
            continue
        assert row.get("ok") is True, row
        result = row.get("result", {})
        value = result.get("value", result) if isinstance(result, dict) else {}
        return value if isinstance(value, dict) else {}


def main() -> None:
    executable = Path(
        str(os.environ.get("VINTRACE_DEPENDENCY_TEST_EXECUTABLE", "") or "")
    ).expanduser().resolve()
    if not executable.is_file():
        raise SystemExit("VINTRACE_DEPENDENCY_TEST_EXECUTABLE must point to the frozen backend.")

    with tempfile.TemporaryDirectory(prefix="vintrace-frozen-dependency-") as temp:
        root = Path(temp)
        workspace = root / "workspace"
        registry = root / "registry"
        env = {
            **os.environ,
            "CROSSAGE_FORCE_FALLBACK": "1",
            "CROSSAGE_WORKSPACE": str(workspace),
            "VINTRACE_WORKSPACE": str(workspace),
            "CROSSAGE_REGISTRY_HOME": str(registry),
            "VINTRACE_REGISTRY_HOME": str(registry),
        }
        process = subprocess.Popen(
            [str(executable), "--workspace", str(workspace)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
        )
        try:
            wait_ready(process)
            report = rpc(process, "runtime_self_test")
            checks = report.get("checks", [])
            runtime = next(
                (item for item in checks if item.get("name") == "ONNX Runtime 1.27.0"),
                None,
            )
            assert runtime is not None, report
            assert runtime.get("ok") is True, runtime
            value = runtime.get("value", {})
            assert value.get("packageVersion") == "1.27.0", value
            assert value.get("runtimeVersion") == "1.27.0", value
            assert value.get("nativeModulePresent") is True, value
            assert value.get("inferenceOutput") == [0.25, -1.5], value
            assert "CPUExecutionProvider" in value.get("providers", []), value
            assert value.get("frozen") is True, value
        finally:
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
        if process.returncode not in (0, None):
            stderr = process.stderr.read() if process.stderr is not None else ""
            raise AssertionError(f"Frozen backend exited with {process.returncode}: {stderr}")
    print("frozen dependency currency ok")


if __name__ == "__main__":
    main()

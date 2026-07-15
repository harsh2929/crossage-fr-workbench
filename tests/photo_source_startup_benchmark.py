from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import tempfile
from time import monotonic
from typing import Any


def read_json_line(process: subprocess.Popen[str], timeout_seconds: float) -> dict[str, Any]:
    selector = selectors.DefaultSelector()
    if process.stdout is None:
        raise RuntimeError("Backend stdout was not captured.")
    selector.register(process.stdout, selectors.EVENT_READ)
    deadline = monotonic() + timeout_seconds
    try:
        while monotonic() < deadline:
            if process.poll() is not None:
                stderr = process.stderr.read() if process.stderr is not None else ""
                raise RuntimeError(f"Backend exited with {process.returncode}: {stderr[-2000:]}")
            events = selector.select(max(0.01, deadline - monotonic()))
            if not events:
                continue
            line = process.stdout.readline()
            if not line:
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                return payload
    finally:
        selector.close()
    raise TimeoutError(f"Backend did not produce JSON within {timeout_seconds:.1f}s.")


def measure(command: list[str], workspace: Path, *, timeout_seconds: float) -> dict[str, Any]:
    env = {
        **os.environ,
        "CROSSAGE_FORCE_FALLBACK": "1",
        "CROSSAGE_WORKSPACE": str(workspace),
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
    }
    started = monotonic()
    process = subprocess.Popen(
        command,
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    try:
        startup_events = 0
        while True:
            payload = read_json_line(process, timeout_seconds)
            if payload.get("event") == "startup":
                startup_events += 1
                continue
            if "ready" in payload:
                if payload.get("ready") is not True:
                    raise RuntimeError(f"Backend startup failed: {payload}")
                break
        ready_ms = int((monotonic() - started) * 1000)
        request_started = monotonic()
        request = {"id": "photos-status", "command": "apple_photos_status", "params": {}}
        if process.stdin is None:
            raise RuntimeError("Backend stdin was not captured.")
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        while True:
            response = read_json_line(process, timeout_seconds)
            if response.get("id") != "photos-status" or response.get("event"):
                continue
            if response.get("ok") is not True:
                raise RuntimeError(f"Apple Photos status failed: {response}")
            status = response.get("result", {}).get("value", {})
            break
        status_ms = int((monotonic() - request_started) * 1000)
        return {
            "command": command,
            "readyMs": ready_ms,
            "applePhotosStatusMs": status_ms,
            "startupEvents": startup_events,
            "applePhotosAvailable": bool(status.get("available")),
            "dependencyVersion": str(status.get("dependencyVersion", "") or ""),
        }
    finally:
        if process.stdin is not None:
            process.stdin.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark source and frozen photo-source startup.")
    parser.add_argument("--frozen", default="backend-dist/crossage-backend/crossage-backend")
    parser.add_argument("--report", default="build/qa/photo-source-startup.json")
    parser.add_argument("--require-frozen", action="store_true")
    parser.add_argument("--ready-budget-ms", type=int, default=8_000)
    parser.add_argument("--photos-status-budget-ms", type=int, default=12_000)
    parser.add_argument("--timeout-seconds", type=float, default=30.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    source_python = os.environ.get("VINTRACE_SOURCE_PYTHON", "").strip() or sys.executable
    frozen = (root / args.frozen).resolve()
    targets = [("source", [source_python, "-m", "crossage_fr.api_server"])]
    if frozen.is_file():
        targets.append(("frozen", [str(frozen)]))
    elif args.require_frozen:
        raise FileNotFoundError(f"Frozen backend was not found: {frozen}")
    results: dict[str, Any] = {}
    failures: list[str] = []
    with tempfile.TemporaryDirectory(prefix="vintrace-startup-benchmark-") as temp:
        base = Path(temp)
        for name, command in targets:
            measurement = measure(command, base / name, timeout_seconds=args.timeout_seconds)
            measurement["readyBudgetMs"] = args.ready_budget_ms
            measurement["applePhotosStatusBudgetMs"] = args.photos_status_budget_ms
            measurement["passed"] = (
                measurement["readyMs"] <= args.ready_budget_ms
                and measurement["applePhotosStatusMs"] <= args.photos_status_budget_ms
            )
            results[name] = measurement
            if not measurement["passed"]:
                failures.append(name)
    report = {
        "schemaVersion": 1,
        "status": "failed" if failures else "passed",
        "results": results,
        "failures": failures,
    }
    report_path = (root / args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({"status": report["status"], "results": results, "report": str(report_path)}, sort_keys=True))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

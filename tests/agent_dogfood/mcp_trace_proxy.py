from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from typing import BinaryIO


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trace", required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("server command is required after --")

    trace_path = Path(args.trace).expanduser().resolve()
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    lock = threading.Lock()

    def record(direction: str, raw: bytes) -> None:
        text = raw.decode("utf-8", errors="replace").rstrip("\r\n")
        event: dict[str, object] = {"at": _stamp(), "direction": direction}
        try:
            event["message"] = json.loads(text)
        except json.JSONDecodeError:
            event["text"] = text[:4000]
        with lock, trace_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")

    child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert child.stdin is not None and child.stdout is not None and child.stderr is not None

    def forward(source: BinaryIO, destination: BinaryIO, direction: str) -> None:
        try:
            while True:
                line = source.readline()
                if not line:
                    break
                record(direction, line)
                destination.write(line)
                destination.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            try:
                destination.close()
            except OSError:
                pass

    def stderr_forward() -> None:
        while True:
            line = child.stderr.readline()
            if not line:
                break
            sys.stderr.buffer.write(line)
            sys.stderr.buffer.flush()

    threads = [
        threading.Thread(target=forward, args=(sys.stdin.buffer, child.stdin, "client_to_server"), daemon=True),
        threading.Thread(target=forward, args=(child.stdout, sys.stdout.buffer, "server_to_client"), daemon=True),
        threading.Thread(target=stderr_forward, daemon=True),
    ]
    for thread in threads:
        thread.start()
    return child.wait()


if __name__ == "__main__":
    raise SystemExit(main())

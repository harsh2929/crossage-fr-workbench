from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from crossage_fr.agent_telemetry import TRACE_FILENAME, evaluate_trace_file
from crossage_fr.workspace_registry import resolve_workspace


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate privacy and contract quality of local Vintrace MCP spans.")
    parser.add_argument("--trace", default="", help="Path to mcp-traces.jsonl; defaults to the active workspace.")
    parser.add_argument("--output", default="", help="Optional JSON report path.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.trace:
        trace_path = Path(args.trace).expanduser().resolve()
    else:
        workspace = resolve_workspace(os.environ.get("VINTRACE_WORKSPACE") or os.environ.get("CROSSAGE_WORKSPACE"))
        trace_path = workspace / "agent" / TRACE_FILENAME
    report = evaluate_trace_file(trace_path)
    payload = json.dumps(report, indent=2, sort_keys=True)
    print(payload)
    if args.output:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(payload + "\n", encoding="utf-8")
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
